import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import pg from 'pg';

import { maskUuid } from '../billing-fixtures/mask.mjs';
import { resolveLocalFixtureEnvironment } from './environment.mjs';

const { Client } = pg;
const execFileAsync = promisify(execFile);
const LOCAL_ORIGIN = 'http://localhost:5500';
const CONFIG_PATH = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url));
const PROXY_IMAGE = 'alpine/socat:latest';
const PROXY_LISTENER = 'TCP4-LISTEN:54321,bind=127.0.0.1,fork,reuseaddr';
const PROXY_TARGET = 'TCP4:api.supabase.internal:8000';

export class LocalFixtureRequestError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'LocalFixtureRequestError';
    this.status = status;
    this.body = body;
  }
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: '[non-json response]' };
    }
  }
  return { status: response.status, body };
}

function futureIso(days = 30) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function pastIso(days = 1) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function createTrackedIds() {
  return {
    users: new Set(),
    organizations: new Set(),
    memberships: new Set(),
    billingCustomers: new Set(),
    subscriptions: new Set(),
    webhookEvents: new Set(),
  };
}

async function readLocalProjectId() {
  const config = await readFile(CONFIG_PATH, 'utf8');
  const match = config.match(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/m);
  if (!match) throw new Error('Local Supabase project_id is missing or malformed.');
  return match[1];
}

async function inspectEdgeRuntime(edgeContainer) {
  const { stdout } = await execFileAsync(
    'docker',
    ['inspect', edgeContainer, '--format', '{{json .Config.Env}}'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  const entries = JSON.parse(stdout);
  const environment = Object.fromEntries(entries.map((entry) => {
    const separator = entry.indexOf('=');
    return separator === -1 ? [entry, ''] : [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  if (Object.prototype.hasOwnProperty.call(environment, 'STRIPE_SECRET_KEY')) {
    throw new Error('Local Edge runtime contains STRIPE_SECRET_KEY; restart it with an explicit empty env file.');
  }
  if (environment.SUPABASE_URL !== 'http://kong:8000') {
    throw new Error('Local Edge runtime does not expose the expected internal Supabase gateway URL.');
  }
  return Object.freeze({ supabaseUrl: environment.SUPABASE_URL });
}

async function startLocalAuthProxy(run) {
  const projectId = await readLocalProjectId();
  const edgeContainer = `supabase_edge_runtime_${projectId}`;
  const edgeEnvironment = await inspectEdgeRuntime(edgeContainer);
  const containerName = `tp3d-local-auth-${run.compactRunId.slice(0, 12)}`;
  try {
    await execFileAsync('docker', [
      'run',
      '--detach',
      '--rm',
      '--pull=never',
      '--name', containerName,
      '--network', `container:${edgeContainer}`,
      PROXY_IMAGE,
      PROXY_LISTENER,
      PROXY_TARGET,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', containerName, '--format', '{{.State.Running}}'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    if (stdout.trim() !== 'true') throw new Error('Local Auth proxy did not remain running.');
  } catch (error) {
    await execFileAsync('docker', ['rm', '--force', containerName]).catch(() => {});
    throw new Error('Unable to start the exact local Edge Auth loopback proxy.', { cause: error });
  }
  return {
    containerName,
    edgeContainer,
    edgeSupabaseUrl: edgeEnvironment.supabaseUrl,
    listenHost: '127.0.0.1',
    listenPort: 54321,
    targetHost: 'api.supabase.internal',
    targetPort: 8000,
    removed: false,
  };
}

async function stopLocalAuthProxy(proxy) {
  if (!proxy || proxy.removed) return true;
  await execFileAsync('docker', ['rm', '--force', proxy.containerName], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  }).catch(async () => {
    try {
      await execFileAsync('docker', ['inspect', proxy.containerName]);
    } catch {
      proxy.removed = true;
      return;
    }
    throw new Error(`Temporary local Auth proxy ${proxy.containerName} could not be removed.`);
  });
  try {
    await execFileAsync('docker', ['inspect', proxy.containerName]);
  } catch {
    proxy.removed = true;
    return true;
  }
  throw new Error(`Temporary local Auth proxy ${proxy.containerName} still exists after cleanup.`);
}

export async function createLocalFixtureRun({ label = 'billing-local', writeLine = console.log } = {}) {
  const environment = await resolveLocalFixtureEnvironment();
  const runId = randomUUID();
  const compactRunId = runId.replaceAll('-', '');
  const db = new Client({ connectionString: environment.dbUrl });
  await db.connect();

  const run = {
    label,
    runId,
    compactRunId,
    environment,
    db,
    ids: createTrackedIds(),
    writeLine,
    closed: false,
    proxy: null,
  };

  try {
    run.proxy = await startLocalAuthProxy(run);
  } catch (error) {
    await db.end().catch(() => {});
    throw error;
  }
  run.removeTemporaryResources = () => stopLocalAuthProxy(run.proxy);

  run.query = (text, values = []) => db.query(text, values);

  run.withRollback = async (callback) => {
    await db.query('begin');
    try {
      return await callback(db);
    } finally {
      await db.query('rollback').catch(() => {});
    }
  };

  run.trackUserState = async (userId) => {
    run.ids.users.add(userId);
    const state = await db.query(`
      select
        p.id as profile_id,
        p.current_organization_id,
        o.id as organization_id,
        o.owner_id,
        o.name as organization_name,
        o.archived_at,
        m.id as membership_id,
        m.role,
        bc.id as billing_customer_id,
        bc.status as billing_status,
        bc.stripe_customer_id,
        bc.stripe_subscription_id,
        bc.trial_ends_at
      from public.profiles p
      left join public.organizations o on o.owner_id = p.id
      left join public.organization_members m
        on m.organization_id = o.id and m.user_id = p.id
      left join public.billing_customers bc on bc.organization_id = o.id
      where p.id = $1::uuid
      order by o.created_at asc, o.id asc
    `, [userId]);
    for (const row of state.rows) {
      if (row.organization_id) run.ids.organizations.add(row.organization_id);
      if (row.membership_id) run.ids.memberships.add(row.membership_id);
      if (row.billing_customer_id) run.ids.billingCustomers.add(String(row.billing_customer_id));
    }
    return state.rows;
  };

  run.signIn = async ({ email, password }) => {
    const response = await fetch(`${environment.apiUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: environment.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const result = await parseResponse(response);
    if (result.status !== 200 || !result.body?.access_token) {
      throw new LocalFixtureRequestError('Local fixture sign-in failed.', result);
    }
    return result.body.access_token;
  };

  run.signupUser = async (prefix = 'fixture-user') => {
    const email = `${prefix}+${runId}@local.tp3d.test`;
    const password = `LocalOnly!${compactRunId.slice(0, 20)}`;
    const response = await fetch(`${environment.apiUrl.replace(/\/$/, '')}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: environment.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const result = await parseResponse(response);
    if (result.status < 200 || result.status >= 300 || !result.body?.user?.id) {
      throw new LocalFixtureRequestError('Local fixture signup failed.', result);
    }
    const userId = result.body.user.id;
    const rows = await run.trackUserState(userId);
    const primary = rows.find(row => row.organization_id === row.current_organization_id) || rows[0];
    if (!primary?.profile_id || !primary.organization_id || !primary.membership_id) {
      throw new Error('Local signup trigger did not create the expected profile, workspace, and membership.');
    }
    const jwt = result.body.access_token || await run.signIn({ email, password });
    return { userId, email, password, jwt, rows, ...primary };
  };

  run.addMember = async (organizationId, userId, role = 'member') => {
    const result = await db.query(`
      insert into public.organization_members (organization_id, user_id, role)
      values ($1::uuid, $2::uuid, $3::public.org_member_role)
      returning id, organization_id, user_id, role
    `, [organizationId, userId, role]);
    const row = result.rows[0];
    run.ids.memberships.add(row.id);
    return row;
  };

  run.createOwnedWorkspace = async (userId, suffix = 'workspace') => {
    const organization = (await db.query(`
      insert into public.organizations (name, slug, owner_id)
      values ($1, $2, $3::uuid)
      returning id, name, slug, owner_id, created_at, archived_at
    `, [
      `Local ${suffix} ${run.runId}`,
      `local-${suffix}-${run.compactRunId}-${randomUUID().slice(0, 8)}`,
      userId,
    ])).rows[0];
    run.ids.organizations.add(organization.id);
    const membership = await run.addMember(organization.id, userId, 'owner');
    const billing = (await db.query(
      'select * from public.billing_customers where organization_id = $1::uuid',
      [organization.id],
    )).rows[0] || null;
    if (billing?.id) run.ids.billingCustomers.add(String(billing.id));
    return { organization, membership, billing };
  };

  run.setBillingCustomer = async (organizationId, updates = {}) => {
    const allowed = [
      'stripe_customer_id',
      'stripe_subscription_id',
      'status',
      'plan_name',
      'billing_interval',
      'current_period_start',
      'current_period_end',
      'cancel_at_period_end',
      'trial_ends_at',
    ];
    const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
    if (!entries.length) throw new Error('Local billing customer update has no approved fields.');
    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ');
    const result = await db.query(`
      update public.billing_customers
      set ${assignments}
      where organization_id = $1::uuid
      returning *
    `, [organizationId, ...entries.map(([, value]) => value)]);
    if (result.rowCount !== 1) throw new Error('Local billing customer update did not affect exactly one row.');
    run.ids.billingCustomers.add(String(result.rows[0].id));
    return result.rows[0];
  };

  run.deleteBillingCustomer = async (organizationId) => {
    const result = await db.query(
      'delete from public.billing_customers where organization_id = $1::uuid returning id',
      [organizationId],
    );
    result.rows.forEach(row => run.ids.billingCustomers.add(String(row.id)));
    return result.rowCount;
  };

  run.insertSubscription = async (
    organizationId,
    userId,
    {
      suffix = 'subscription',
      status = 'active',
      interval = 'month',
      priceId = null,
      stripeCustomerId = null,
      stripeSubscriptionId = null,
      currentPeriodEnd = futureIso(),
      trialEnd = null,
    } = {},
  ) => {
    const customerId = stripeCustomerId || `cus_local_${run.compactRunId}_${suffix}`;
    const subscriptionId = stripeSubscriptionId || `sub_local_${run.compactRunId}_${suffix}`;
    const resolvedPriceId = priceId || `price_local_${interval}_${run.compactRunId}_${suffix}`;
    const result = await db.query(`
      insert into public.subscriptions (
        organization_id, user_id, stripe_customer_id, stripe_subscription_id,
        status, price_id, interval, current_period_end, trial_end
      ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::public.billing_interval, $8::timestamptz, $9::timestamptz)
      returning *
    `, [
      organizationId,
      userId,
      customerId,
      subscriptionId,
      status,
      resolvedPriceId,
      interval,
      currentPeriodEnd,
      trialEnd,
    ]);
    const row = result.rows[0];
    run.ids.subscriptions.add(String(row.id));
    return row;
  };

  run.setDirectSubscription = async (
    organizationId,
    userId,
    { suffix = 'direct', status = 'active', interval = 'month', priceId = null, currentPeriodEnd = futureIso() } = {},
  ) => {
    const stripeCustomerId = `cus_local_${compactRunId}_${suffix}`;
    const stripeSubscriptionId = `sub_local_${compactRunId}_${suffix}`;
    const resolvedPriceId = priceId || `price_local_${interval}_${compactRunId}_${suffix}`;
    const subscription = await run.insertSubscription(organizationId, userId, {
      suffix,
      status,
      interval,
      priceId: resolvedPriceId,
      stripeCustomerId,
      stripeSubscriptionId,
      currentPeriodEnd,
    });
    const billingCustomer = await run.setBillingCustomer(organizationId, {
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      status,
      plan_name: 'pro',
      billing_interval: interval,
      current_period_end: currentPeriodEnd,
      trial_ends_at: null,
    });
    return { subscription, billingCustomer };
  };

  run.rest = async (path, jwt = null, { method = 'GET', body = null, prefer = null } = {}) => {
    const url = new URL(`${environment.apiUrl.replace(/\/$/, '')}/rest/v1/${String(path).replace(/^\//, '')}`);
    const bearer = jwt || environment.anonKey;
    const response = await fetch(url, {
      method,
      headers: {
        apikey: environment.anonKey,
        authorization: `Bearer ${bearer}`,
        accept: 'application/json',
        ...(prefer ? { prefer } : {}),
        ...(body === null ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });
    return parseResponse(response);
  };

  run.archiveOrganization = async (organizationId, jwt) => {
    const result = await run.callFunction('org-archive-workspace', jwt, {
      body: { organization_id: organizationId },
    });
    if (result.status !== 200 || !result.body?.archived_at) {
      throw new LocalFixtureRequestError('Local organization archive failed.', result);
    }
    return result.body.archived_at;
  };

  run.expireNoCardTrial = (organizationId) => run.setBillingCustomer(organizationId, {
    status: 'trialing',
    plan_name: 'pro',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    billing_interval: null,
    current_period_end: null,
    trial_ends_at: pastIso(),
  });

  run.removeWorkspaceForNoWorkspaceProof = async (userId, organizationId) => {
    await db.query(
      'update public.profiles set current_organization_id = null where id = $1::uuid and current_organization_id = $2::uuid',
      [userId, organizationId],
    );
    const result = await db.query(
      'delete from public.organizations where id = $1::uuid returning id',
      [organizationId],
    );
    if (result.rowCount !== 1) throw new Error('Exact local auto-workspace deletion failed.');
  };

  run.callFunction = async (functionName, jwt, { method = 'POST', body = null, query = {} } = {}) => {
    const url = new URL(`${environment.functionsUrl.replace(/\/$/, '')}/${functionName}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    const authHeaders = jwt
      ? { authorization: `Bearer ${jwt}`, 'x-user-jwt': jwt }
      : {};
    const response = await fetch(url, {
      method,
      headers: {
        apikey: environment.anonKey,
        ...authHeaders,
        origin: LOCAL_ORIGIN,
        ...(body === null ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });
    return parseResponse(response);
  };

  run.billingStatus = (jwt, organizationId) => run.callFunction('billing-status', jwt, {
    method: 'GET',
    query: { organization_id: organizationId },
  });

  run.snapshotOrganization = async (organizationId) => {
    const organization = await db.query(
      'select id, owner_id from public.organizations where id = $1::uuid',
      [organizationId],
    );
    const members = await db.query(`
        select user_id, role from public.organization_members
        where organization_id = $1::uuid order by user_id
      `, [organizationId]);
    const billingCustomers = await db.query(`
        select organization_id, stripe_customer_id, stripe_subscription_id, status, plan_name,
               billing_interval, current_period_end, trial_ends_at
        from public.billing_customers where organization_id = $1::uuid order by id
      `, [organizationId]);
    const subscriptions = await db.query(`
        select organization_id, user_id, stripe_customer_id, stripe_subscription_id, status,
               price_id, interval, current_period_end
        from public.subscriptions where organization_id = $1::uuid order by id
      `, [organizationId]);
    return {
      organization: organization.rows,
      members: members.rows,
      billingCustomers: billingCustomers.rows,
      subscriptions: subscriptions.rows,
    };
  };

  run.close = async () => {
    if (run.closed) return;
    run.closed = true;
    await db.end();
  };

  writeLine(`Local billing fixture run: ${maskUuid(runId)}`);
  writeLine('Local Edge Auth loopback: active (localhost to internal Supabase gateway)');
  return run;
}
