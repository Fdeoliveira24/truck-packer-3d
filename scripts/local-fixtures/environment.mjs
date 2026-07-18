import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import pg from 'pg';

const execFileAsync = promisify(execFile);
const { Client } = pg;

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const REQUIRED_MIGRATION_COUNT = 30;

export class LocalFixtureSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalFixtureSafetyError';
    this.code = code;
  }
}

export class LocalFixtureUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocalFixtureUnavailableError';
    this.code = 'local_supabase_unavailable';
  }
}

function refuse(code, message) {
  throw new LocalFixtureSafetyError(code, `Refusing local billing fixtures: ${message}`);
}

function parseLocalUrl(rawValue, label, allowedProtocols) {
  let parsed;
  try {
    parsed = new URL(String(rawValue || '').trim());
  } catch {
    refuse('invalid_local_url', `${label} is missing or malformed.`);
  }

  if (!allowedProtocols.has(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    refuse('non_local_url', `${label} must target localhost or 127.0.0.1.`);
  }
  if (parsed.hostname.endsWith('.supabase.co')) {
    refuse('hosted_supabase_url', `${label} must never target a hosted Supabase project.`);
  }
  return parsed.toString();
}

export function assertLocalFixtureProcessSafety(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, 'STRIPE_SECRET_KEY')) {
    refuse('stripe_secret_present', 'STRIPE_SECRET_KEY must be absent, including test-mode keys.');
  }
}

async function readStatusJson() {
  try {
    const { stdout } = await execFileAsync('supabase', ['status', '-o', 'json'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new LocalFixtureUnavailableError('local `supabase status` returned unreadable output.');
    }
    throw new LocalFixtureUnavailableError(
      'local Supabase is not running; run `supabase start` before the local billing tests.',
    );
  }
}

function normalizeStatus(status) {
  const apiUrl = parseLocalUrl(status.API_URL, 'Supabase API URL', new Set(['http:', 'https:']));
  const functionsUrl = parseLocalUrl(
    status.FUNCTIONS_URL || `${apiUrl.replace(/\/$/, '')}/functions/v1`,
    'Supabase Functions URL',
    new Set(['http:', 'https:']),
  );
  const dbUrl = parseLocalUrl(status.DB_URL, 'Supabase database URL', new Set(['postgres:', 'postgresql:']));
  const anonKey = String(status.ANON_KEY || '').trim();
  const serviceRoleKey = String(status.SERVICE_ROLE_KEY || '').trim();
  if (!anonKey || !serviceRoleKey) {
    refuse('missing_local_credentials', 'local credentials must come from `supabase status`.');
  }
  return { apiUrl, functionsUrl, dbUrl, anonKey, serviceRoleKey };
}

async function inspectDatabase(dbUrl) {
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const migrations = await client.query(
      'select count(*)::integer as count from supabase_migrations.schema_migrations',
    );
    const migrationCount = Number(migrations.rows[0]?.count || 0);
    const grants = await client.query(`
      select
        has_table_privilege('authenticated', 'public.organizations', 'SELECT') as authenticated_org_select,
        has_table_privilege('authenticated', 'public.organization_members', 'SELECT') as authenticated_member_select,
        has_table_privilege('authenticated', 'public.organization_members', 'INSERT') as authenticated_member_insert,
        has_table_privilege('authenticated', 'public.organization_members', 'UPDATE') as authenticated_member_update,
        has_table_privilege('authenticated', 'public.organization_members', 'DELETE') as authenticated_member_delete,
        has_table_privilege('service_role', 'public.billing_customers', 'INSERT') as service_billing_insert,
        has_table_privilege('service_role', 'public.subscriptions', 'UPDATE') as service_subscription_update,
        has_sequence_privilege('service_role', 'public.billing_customers_id_seq', 'USAGE') as service_billing_sequence,
        has_sequence_privilege('service_role', 'public.subscriptions_id_seq', 'USAGE') as service_subscription_sequence,
        has_function_privilege('service_role', 'public.tp3d_create_workspace(uuid,text,jsonb)', 'EXECUTE') as service_workspace_create,
        has_function_privilege('authenticated', 'public.tp3d_create_workspace(uuid,text,jsonb)', 'EXECUTE') as authenticated_workspace_create
    `);
    const grantState = grants.rows[0] || {};
    const grantsActive = Boolean(
      grantState.authenticated_org_select &&
      grantState.authenticated_member_select &&
      !grantState.authenticated_member_insert &&
      !grantState.authenticated_member_update &&
      !grantState.authenticated_member_delete &&
      grantState.service_billing_insert &&
      grantState.service_subscription_update &&
      grantState.service_billing_sequence &&
      grantState.service_subscription_sequence &&
      grantState.service_workspace_create &&
      !grantState.authenticated_workspace_create
    );
    return { migrationCount, grantsActive, grantState };
  } catch {
    throw new LocalFixtureUnavailableError(
      'the local Supabase database is not reachable; run `supabase start` and `supabase db reset --local`.',
    );
  } finally {
    await client.end().catch(() => {});
  }
}

export async function resolveLocalFixtureEnvironment({ allowUnavailable = false } = {}) {
  assertLocalFixtureProcessSafety();
  try {
    const status = normalizeStatus(await readStatusJson());
    const database = await inspectDatabase(status.dbUrl);
    if (database.migrationCount !== REQUIRED_MIGRATION_COUNT) {
      refuse(
        'migration_count_mismatch',
        `expected ${REQUIRED_MIGRATION_COUNT} local migrations, found ${database.migrationCount}; run a clean local reset.`,
      );
    }
    if (!database.grantsActive) {
      refuse('explicit_api_grants_missing', 'the explicit local API grants are not active.');
    }
    return Object.freeze({ available: true, ...status, ...database });
  } catch (error) {
    if (allowUnavailable && error instanceof LocalFixtureUnavailableError) {
      return Object.freeze({ available: false, reason: error.message });
    }
    throw error;
  }
}

async function runFromTerminal() {
  try {
    const result = await resolveLocalFixtureEnvironment({ allowUnavailable: true });
    if (!result.available) {
      console.log(`SKIP local billing fixtures: ${result.reason}`);
      return;
    }
    console.log('Local billing fixture verification: PASS');
    console.log('Target: localhost only');
    console.log(`Applied migrations: ${result.migrationCount}`);
    console.log('Explicit API grants: active');
    console.log('Stripe environment: absent');
  } catch (error) {
    const message = error instanceof LocalFixtureSafetyError
      ? error.message
      : 'Local billing fixture verification failed safely.';
    console.error(message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runFromTerminal();
}
