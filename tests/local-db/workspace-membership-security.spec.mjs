import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { cleanupLocalFixtureRun } from '../../scripts/local-fixtures/cleanup.mjs';
import { createLocalFixtureRun } from '../../scripts/local-fixtures/harness.mjs';

const execFileAsync = promisify(execFile);
const enabled = process.env.TP3D_LOCAL_DB_INTEGRATION === '1';

const apiUrl = String(process.env.TP3D_LOCAL_API_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const anonKey = String(process.env.TP3D_LOCAL_ANON_KEY || '');
const serviceRoleKey = String(process.env.TP3D_LOCAL_SERVICE_ROLE_KEY || '');
const dbContainer = String(process.env.TP3D_LOCAL_DB_CONTAINER || 'supabase_db_Truck_Packer_3D');
const browserOrigin = 'http://localhost:5500';
let sharedProxyRun = null;

test.before(async () => {
  if (!enabled) return;
  sharedProxyRun = await createLocalFixtureRun({
    label: 'workspace-membership-security',
    writeLine: () => {},
  });
});

test.after(async () => {
  if (!sharedProxyRun) return;
  await cleanupLocalFixtureRun(sharedProxyRun);
  await sharedProxyRun.close();
  sharedProxyRun = null;
});

function requiredEnvironment() {
  assert.ok(anonKey.startsWith('eyJ'), 'TP3D_LOCAL_ANON_KEY must be the local JWT anon key');
  assert.ok(serviceRoleKey.startsWith('eyJ'), 'TP3D_LOCAL_SERVICE_ROLE_KEY must be the local JWT service-role key');
  assert.match(apiUrl, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/,
    'local integration refuses non-loopback Supabase URLs');
}

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function signUp(email, password) {
  const { response, body } = await request('/auth/v1/signup', {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `local signup failed: ${JSON.stringify(body)}`);
  if (body && body.access_token && body.user) return { user: body.user, token: body.access_token };

  const signedIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signedIn.response.status, 200, `local sign-in failed: ${JSON.stringify(signedIn.body)}`);
  return { user: signedIn.body.user, token: signedIn.body.access_token };
}

async function rest(path, { method = 'GET', body, jwt = serviceRoleKey, prefer = '' } = {}) {
  const key = jwt === serviceRoleKey ? serviceRoleKey : anonKey;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return request(`/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function edge(functionName, token, body = {}) {
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    Origin: browserOrigin,
  };
  if (token) {
    headers['x-user-jwt'] = token;
  }
  return request(`/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function rows(path, options) {
  const result = await rest(path, options);
  assert.ok(result.response.ok, `REST ${path} failed: ${JSON.stringify(result.body)}`);
  return Array.isArray(result.body) ? result.body : [];
}

async function sql(statement) {
  return execFileAsync('docker', [
    'exec', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atc', statement,
  ]);
}

const rpcEntitlementConfig = Object.freeze({
  version: 1,
  trial_limit: 1,
  pro_limit: 3,
  business_limit: 10,
  business_price_ids: ['price_packet2_business'],
});

async function seedProjectedSubscription(account, suffix, {
  status = 'active',
  interval = 'month',
  priceId = `price_packet2_${interval}`,
  currentPeriodEnd = new Date(Date.now() + 30 * 86400000).toISOString(),
} = {}) {
  const stripeCustomerId = `cus_packet2_${suffix}`;
  const stripeSubscriptionId = `sub_packet2_${suffix}`;
  const subscription = await rest('subscriptions', {
    method: 'POST',
    body: {
      organization_id: account.organizationId,
      user_id: account.user.id,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      status,
      price_id: priceId,
      interval,
      current_period_end: currentPeriodEnd,
    },
    prefer: 'return=representation',
  });
  assert.equal(subscription.response.status, 201, JSON.stringify(subscription.body));
  const billing = await rest(`billing_customers?organization_id=eq.${account.organizationId}`, {
    method: 'PATCH',
    body: {
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      status,
      plan_name: 'pro',
      billing_interval: interval,
      current_period_end: currentPeriodEnd,
      trial_ends_at: null,
    },
    prefer: 'return=representation',
  });
  assert.equal(billing.response.status, 200, JSON.stringify(billing.body));
  return { stripeCustomerId, stripeSubscriptionId };
}

test('local workspace creation and membership mutation boundary', { skip: !enabled }, async (t) => {
  requiredEnvironment();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const password = `Local-${randomUUID()}-A1!`;
  const accounts = [];
  const createdOrgIds = new Set();

  const createAccount = async (label) => {
    const account = await signUp(`tp3d-${label}-${suffix}@example.test`, password);
    accounts.push(account);
    const orgs = await rows(`organizations?owner_id=eq.${account.user.id}&select=id,name,owner_id&order=created_at.asc`);
    orgs.forEach(org => createdOrgIds.add(org.id));
    return account;
  };

  const owner = await createAccount('owner');
  const member = await createAccount('member');
  const invitee = await createAccount('invitee');
  const newOwner = await createAccount('new-owner');

  t.after(async () => {
    const userIds = accounts.map(account => `'${account.user.id}'`).join(',');
    if (userIds) {
      await sql(`
        delete from public.organizations where owner_id in (${userIds});
        delete from auth.users where id in (${userIds});
      `);
    }
  });

  const initialOrgs = await rows(`organizations?owner_id=eq.${owner.user.id}&select=id,name,owner_id`);
  assert.equal(initialOrgs.length, 1, 'signup must still create exactly one default workspace');
  const initialOrgId = initialOrgs[0].id;
  const initialMemberships = await rows(
    `organization_members?organization_id=eq.${initialOrgId}&user_id=eq.${owner.user.id}&select=role`,
  );
  assert.deepEqual(initialMemberships.map(row => row.role), ['owner']);
  const initialProfiles = await rows(`profiles?id=eq.${owner.user.id}&select=current_organization_id`);
  assert.equal(initialProfiles[0]?.current_organization_id, initialOrgId);
  const initialTrials = await rows(`billing_customers?organization_id=eq.${initialOrgId}&select=organization_id`);
  assert.equal(initialTrials.length, 1, 'signup owner membership must seed one billing row');

  owner.organizationId = initialOrgId;
  const memberInitialOrg = (await rows(
    `organizations?owner_id=eq.${member.user.id}&select=id&order=created_at.asc`,
  ))[0];
  member.organizationId = memberInitialOrg.id;
  await seedProjectedSubscription(owner, `boundary-owner-${suffix}`);
  await seedProjectedSubscription(member, `boundary-member-${suffix}`);

  const insertGrant = await sql(`
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'organizations'
      and grantee = 'authenticated'
      and privilege_type = 'INSERT';
  `);
  assert.equal(insertGrant.stdout.trim(), '0',
    'authenticated must not retain table-level organization INSERT');
  const updateGrant = await sql(`
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'organizations'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE';
  `);
  assert.equal(updateGrant.stdout.trim(), '1',
    'authenticated organization UPDATE must remain available through RLS');
  const insertPolicy = await sql(`
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'organizations'
      and policyname = 'organizations_insert_owner_self';
  `);
  assert.equal(insertPolicy.stdout.trim(), '0',
    'the obsolete authenticated organization INSERT policy must be absent');

  const directOrganizationId = randomUUID();
  const directOrganizationName = `Direct Insert ${suffix}`;
  const directOrganizationInsert = await rest('organizations', {
    method: 'POST',
    jwt: owner.token,
    body: {
      id: directOrganizationId,
      name: directOrganizationName,
      slug: directOrganizationId,
      owner_id: owner.user.id,
    },
    prefer: 'return=representation',
  });
  assert.equal(directOrganizationInsert.response.status, 403);
  assert.equal(directOrganizationInsert.body?.code, '42501');
  const directOrganizationRows = await rows(`organizations?id=eq.${directOrganizationId}&select=id`);
  assert.equal(directOrganizationRows.length, 0, 'denied direct INSERT must create no organization row');
  const directMembershipRows = await rows(
    `organization_members?organization_id=eq.${directOrganizationId}&select=id`,
  );
  assert.equal(directMembershipRows.length, 0, 'denied direct INSERT must create no membership row');
  const directBillingRows = await rows(`billing_customers?organization_id=eq.${directOrganizationId}&select=id`);
  assert.equal(directBillingRows.length, 0, 'denied direct INSERT must create no billing or trial row');

  const unauthenticated = await edge('org-create-workspace', '', { name: 'Unauthorized Workspace' });
  assert.equal(unauthenticated.response.status, 401);
  const invalidName = await edge('org-create-workspace', owner.token, { name: '   ' });
  assert.equal(invalidName.response.status, 400);
  assert.doesNotMatch(JSON.stringify(invalidName.body), /sql|postgres|organization_members|details|hint/i);

  const created = await edge('org-create-workspace', owner.token, {
    name: '  Secure   Workspace  ',
    owner_id: member.user.id,
    role: 'member',
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.organization.name, 'Secure Workspace');
  assert.equal(created.body.organization.owner_id, owner.user.id,
    'caller-supplied owner_id must be ignored');
  assert.equal(created.body.membership.role, 'owner');
  const workspaceId = created.body.organization.id;
  createdOrgIds.add(workspaceId);

  const createdOrganizations = await rows(`organizations?id=eq.${workspaceId}&select=id,name,owner_id,slug`);
  assert.equal(createdOrganizations.length, 1);
  assert.equal(createdOrganizations[0].owner_id, owner.user.id);
  const authenticatedOrganizationRead = await rest(
    `organizations?id=eq.${workspaceId}&select=id,name,owner_id`,
    { jwt: owner.token },
  );
  assert.equal(authenticatedOrganizationRead.response.status, 200,
    'authenticated organization SELECT must remain available through RLS');
  assert.deepEqual(authenticatedOrganizationRead.body, [{
    id: workspaceId,
    name: 'Secure Workspace',
    owner_id: owner.user.id,
  }]);
  const ownerDescriptionUpdate = await rest(`organizations?id=eq.${workspaceId}`, {
    method: 'PATCH',
    jwt: owner.token,
    body: { name: 'Secure Workspace Updated' },
    prefer: 'return=representation',
  });
  assert.equal(ownerDescriptionUpdate.response.status, 200,
    `owner organization UPDATE failed: ${JSON.stringify(ownerDescriptionUpdate.body)}`);
  assert.equal(ownerDescriptionUpdate.body?.[0]?.name, 'Secure Workspace Updated');
  const createdMemberships = await rows(`organization_members?organization_id=eq.${workspaceId}&select=user_id,role`);
  assert.deepEqual(createdMemberships, [{ user_id: owner.user.id, role: 'owner' }]);
  const currentProfile = await rows(`profiles?id=eq.${owner.user.id}&select=current_organization_id`);
  assert.equal(currentProfile[0]?.current_organization_id, workspaceId);
  const createdTrialRows = await rows(`billing_customers?organization_id=eq.${workspaceId}&select=organization_id,status`);
  assert.equal(createdTrialRows.length, 1, 'workspace owner membership must fire the trial seed exactly once');

  const retryA = await edge('org-create-workspace', member.token, { name: 'Explicit Duplicate Name' });
  const retryB = await edge('org-create-workspace', member.token, { name: 'Explicit Duplicate Name' });
  assert.equal(retryA.response.status, 200);
  assert.equal(retryB.response.status, 200);
  assert.notEqual(retryA.body.organization.id, retryB.body.organization.id,
    'accepted retries intentionally create distinct workspaces');
  createdOrgIds.add(retryA.body.organization.id);
  createdOrgIds.add(retryB.body.organization.id);

  const rollbackName = `Rollback ${suffix}`;
  const missingActorId = randomUUID();
  const rollback = await rest('rpc/tp3d_create_workspace', {
    method: 'POST',
    body: {
      p_actor_id: missingActorId,
      p_name: rollbackName,
      p_entitlement_config: rpcEntitlementConfig,
    },
    prefer: 'return=representation',
  });
  assert.equal(rollback.response.ok, false, 'missing actor must fail inside the transaction');
  const rollbackRows = await rows(`organizations?name=eq.${encodeURIComponent(rollbackName)}&select=id`);
  assert.equal(rollbackRows.length, 0, 'failed RPC must leave no partial organization');

  const directInsert = await rest('organization_members', {
    method: 'POST',
    jwt: owner.token,
    body: { organization_id: workspaceId, user_id: member.user.id, role: 'member' },
    prefer: 'return=representation',
  });
  assert.equal(directInsert.response.status, 403);
  assert.equal(directInsert.body?.code, '42501');

  const directUpdate = await rest(
    `organization_members?organization_id=eq.${workspaceId}&user_id=eq.${owner.user.id}`,
    { method: 'PATCH', jwt: owner.token, body: { role: 'admin' }, prefer: 'return=representation' },
  );
  assert.equal(directUpdate.response.status, 403);
  assert.equal(directUpdate.body?.code, '42501');

  const directDelete = await rest(
    `organization_members?organization_id=eq.${workspaceId}&user_id=eq.${owner.user.id}`,
    { method: 'DELETE', jwt: owner.token, prefer: 'return=representation' },
  );
  assert.equal(directDelete.response.status, 403);
  assert.equal(directDelete.body?.code, '42501');

  const canonicalAfterDenials = await rows(`organizations?id=eq.${workspaceId}&select=owner_id`);
  assert.equal(canonicalAfterDenials[0]?.owner_id, owner.user.id);
  const ownerAfterDenials = await rows(
    `organization_members?organization_id=eq.${workspaceId}&user_id=eq.${owner.user.id}&select=role`,
  );
  assert.equal(ownerAfterDenials[0]?.role, 'owner');
  const ownerSelect = await rest(
    `organization_members?organization_id=eq.${workspaceId}&select=user_id,role`,
    { jwt: owner.token },
  );
  assert.equal(ownerSelect.response.status, 200, 'authenticated SELECT must remain available through RLS');

  const serviceInsert = await rest('organization_members', {
    method: 'POST',
    body: { organization_id: workspaceId, user_id: member.user.id, role: 'member' },
    prefer: 'return=representation',
  });
  assert.equal(serviceInsert.response.status, 201, JSON.stringify(serviceInsert.body));
  const serviceUpdate = await rest(
    `organization_members?organization_id=eq.${workspaceId}&user_id=eq.${member.user.id}`,
    { method: 'PATCH', body: { role: 'admin' }, prefer: 'return=representation' },
  );
  assert.equal(serviceUpdate.response.status, 200);
  const serviceDelete = await rest(
    `organization_members?organization_id=eq.${workspaceId}&user_id=eq.${member.user.id}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  assert.equal(serviceDelete.response.status, 200);

  await rest('organization_members', {
    method: 'POST',
    body: { organization_id: workspaceId, user_id: member.user.id, role: 'member' },
  });
  const ownerRoleRejected = await edge('org-member-role-update', owner.token, {
    org_id: workspaceId,
    user_id: member.user.id,
    role: 'owner',
  });
  assert.equal(ownerRoleRejected.response.status, 409);
  assert.equal(ownerRoleRejected.body?.error, 'ownership_change_requires_transfer');
  const roleUpdated = await edge('org-member-role-update', owner.token, {
    org_id: workspaceId,
    user_id: member.user.id,
    role: 'admin',
  });
  assert.equal(roleUpdated.response.status, 200, JSON.stringify(roleUpdated.body));
  const adminDescriptionUpdate = await rest(`organizations?id=eq.${workspaceId}`, {
    method: 'PATCH',
    jwt: member.token,
    body: { city: 'Fixture City' },
    prefer: 'return=representation',
  });
  assert.equal(adminDescriptionUpdate.response.status, 200,
    `admin organization UPDATE failed: ${JSON.stringify(adminDescriptionUpdate.body)}`);
  assert.equal(adminDescriptionUpdate.body?.[0]?.city, 'Fixture City');
  const memberRemoved = await edge('org-member-remove', owner.token, {
    org_id: workspaceId,
    user_id: member.user.id,
  });
  assert.equal(memberRemoved.response.status, 200, JSON.stringify(memberRemoved.body));

  await rest('organization_members', {
    method: 'POST',
    body: { organization_id: workspaceId, user_id: member.user.id, role: 'member' },
  });
  const memberLeft = await edge('org-leave-workspace', member.token, { organization_id: workspaceId });
  assert.equal(memberLeft.response.status, 200, JSON.stringify(memberLeft.body));
  const primaryOwnerLeave = await edge('org-leave-workspace', owner.token, { organization_id: workspaceId });
  assert.equal(primaryOwnerLeave.response.status, 409, 'canonical owner must not leave without transfer');

  const inviteToken = `invite-${suffix}`;
  const inviteInsert = await rest('organization_invites', {
    method: 'POST',
    body: {
      organization_id: workspaceId,
      email: invitee.user.email,
      role: 'member',
      status: 'pending',
      token: inviteToken,
      invited_by: owner.user.id,
    },
    prefer: 'return=representation',
  });
  assert.equal(inviteInsert.response.status, 201, JSON.stringify(inviteInsert.body));
  const inviteAccepted = await edge('org-invite-accept', invitee.token, { token: inviteToken });
  assert.equal(inviteAccepted.response.status, 200, JSON.stringify(inviteAccepted.body));
  const acceptedMembership = await rows(
    `organization_members?organization_id=eq.${workspaceId}&user_id=eq.${invitee.user.id}&select=role`,
  );
  assert.equal(acceptedMembership[0]?.role, 'member');

  const transferWorkspace = await edge('org-create-workspace', owner.token, { name: 'Transfer Workspace' });
  assert.equal(transferWorkspace.response.status, 200);
  const transferOrgId = transferWorkspace.body.organization.id;
  createdOrgIds.add(transferOrgId);
  await rest('organization_members', {
    method: 'POST',
    body: { organization_id: transferOrgId, user_id: newOwner.user.id, role: 'member' },
  });
  const transfer = await edge('org-transfer-ownership', owner.token, {
    organization_id: transferOrgId,
    new_owner_id: newOwner.user.id,
  });
  assert.equal(transfer.response.status, 200, JSON.stringify(transfer.body));
  const transferredOrg = await rows(`organizations?id=eq.${transferOrgId}&select=owner_id`);
  assert.equal(transferredOrg[0]?.owner_id, newOwner.user.id);
  const transferredRoles = await rows(
    `organization_members?organization_id=eq.${transferOrgId}&select=user_id,role&order=user_id.asc`,
  );
  assert.deepEqual(new Map(transferredRoles.map(row => [row.user_id, row.role])),
    new Map([[owner.user.id, 'admin'], [newOwner.user.id, 'owner']]));

  const paidWorkspace = await edge('org-create-workspace', owner.token, { name: 'Paid Transfer Guard' });
  assert.equal(paidWorkspace.response.status, 200);
  const paidOrgId = paidWorkspace.body.organization.id;
  createdOrgIds.add(paidOrgId);
  await rest('organization_members', {
    method: 'POST',
    body: { organization_id: paidOrgId, user_id: newOwner.user.id, role: 'member' },
  });
  const activeBilling = await rest(`billing_customers?organization_id=eq.${paidOrgId}`, {
    method: 'PATCH',
    body: { status: 'active' },
    prefer: 'return=representation',
  });
  assert.equal(activeBilling.response.status, 200);
  const blockedTransfer = await edge('org-transfer-ownership', owner.token, {
    organization_id: paidOrgId,
    new_owner_id: newOwner.user.id,
  });
  assert.equal(blockedTransfer.response.status, 409);
  assert.equal(blockedTransfer.body?.error, 'workspace_has_active_billing');
});

test('local Packet 2 workspace limits are authoritative and concurrency-safe', { skip: !enabled }, async (t) => {
  requiredEnvironment();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const password = `Local-${randomUUID()}-B2!`;
  const accounts = [];

  const createAccount = async (label) => {
    const account = await signUp(`tp3d-packet2-${label}-${suffix}@example.test`, password);
    const organization = (await rows(
      `organizations?owner_id=eq.${account.user.id}&select=id,owner_id,archived_at&order=created_at.asc`,
    ))[0];
    assert.ok(organization?.id, `${label} signup must create one owner workspace`);
    const result = { ...account, organizationId: organization.id };
    accounts.push(result);
    return result;
  };

  const ownerWorkspaceRows = (account) => rows(
    `organizations?owner_id=eq.${account.user.id}&select=id,archived_at&order=created_at.asc`,
  );

  t.after(async () => {
    const userIds = accounts.map(account => `'${account.user.id}'`).join(',');
    if (userIds) {
      await sql(`
        delete from public.organizations where owner_id in (${userIds});
        delete from auth.users where id in (${userIds});
      `);
    }
  });

  await t.test('trial owner is exactly at the one-workspace limit and malformed names stay sanitized', async () => {
    const trialOwner = await createAccount('trial');
    const before = await ownerWorkspaceRows(trialOwner);
    assert.equal(before.length, 1);

    const rejected = await edge('org-create-workspace', trialOwner.token, { name: 'Trial Overflow' });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.body?.code, 'workspace_limit_reached');
    assert.match(String(rejected.body?.error || ''), /workspace limit reached/i);
    assert.deepEqual(await ownerWorkspaceRows(trialOwner), before,
      'limit rejection must leave the trial owner workspace set byte-equivalent');

    const malformed = await edge('org-create-workspace', trialOwner.token, { name: '   ' });
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body?.code, 'invalid_workspace_name');
    assert.doesNotMatch(JSON.stringify(malformed.body), /sql|postgres|details|hint|stripe|service.role/i);
  });

  await t.test('paid monthly owner succeeds below limit, rejects at limit, and archived workspaces still count', async () => {
    const monthly = await createAccount('monthly');
    await seedProjectedSubscription(monthly, `monthly-${suffix}`, { interval: 'month' });

    const second = await edge('org-create-workspace', monthly.token, { name: 'Monthly Two' });
    const third = await edge('org-create-workspace', monthly.token, { name: 'Monthly Three' });
    assert.equal(second.response.status, 200, JSON.stringify(second.body));
    assert.equal(third.response.status, 200, JSON.stringify(third.body));
    assert.equal((await ownerWorkspaceRows(monthly)).length, 3);

    const atLimit = await edge('org-create-workspace', monthly.token, { name: 'Monthly Four' });
    assert.equal(atLimit.response.status, 409);
    assert.equal(atLimit.body?.code, 'workspace_limit_reached');

    const archived = await edge('org-archive-workspace', monthly.token, {
      organization_id: second.body.organization.id,
    });
    assert.equal(archived.response.status, 200, JSON.stringify(archived.body));
    const rowsAfterArchive = await ownerWorkspaceRows(monthly);
    assert.equal(rowsAfterArchive.length, 3);
    assert.ok(rowsAfterArchive.some(row => row.archived_at), 'one owner workspace must be archived');

    const archivedStillCounts = await edge('org-create-workspace', monthly.token, {
      name: 'Archived Does Not Free Capacity',
    });
    assert.equal(archivedStillCounts.response.status, 409);
    assert.equal(archivedStillCounts.body?.code, 'workspace_limit_reached');
    assert.equal((await ownerWorkspaceRows(monthly)).length, 3);
  });

  await t.test('paid yearly and payment-grace owners retain the existing paid fallback limit', async () => {
    const yearly = await createAccount('yearly');
    await seedProjectedSubscription(yearly, `yearly-${suffix}`, { interval: 'year' });
    const yearlyCreated = await edge('org-create-workspace', yearly.token, { name: 'Yearly Two' });
    assert.equal(yearlyCreated.response.status, 200, JSON.stringify(yearlyCreated.body));

    const grace = await createAccount('grace');
    await seedProjectedSubscription(grace, `grace-${suffix}`, {
      status: 'past_due',
      interval: 'month',
      currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    const graceCreated = await edge('org-create-workspace', grace.token, { name: 'Grace Two' });
    assert.equal(graceCreated.response.status, 200, JSON.stringify(graceCreated.body));
  });

  await t.test('member/admin access never borrows another owner plan', async () => {
    const paidOwner = await createAccount('foreign-paid-owner');
    const memberOnly = await createAccount('foreign-admin');
    await seedProjectedSubscription(paidOwner, `foreign-paid-${suffix}`);
    const membership = await rest('organization_members', {
      method: 'POST',
      body: {
        organization_id: paidOwner.organizationId,
        user_id: memberOnly.user.id,
        role: 'admin',
      },
      prefer: 'return=representation',
    });
    assert.equal(membership.response.status, 201, JSON.stringify(membership.body));

    const rejected = await edge('org-create-workspace', memberOnly.token, { name: 'Borrowed Plan' });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.body?.code, 'workspace_limit_reached');
    assert.equal((await ownerWorkspaceRows(memberOnly)).length, 1);
  });

  await t.test('inactive, unavailable, and ambiguous billing states fail closed without residue', async () => {
    const inactive = await createAccount('inactive');
    await seedProjectedSubscription(inactive, `inactive-${suffix}`, { status: 'canceled' });
    const inactiveBefore = await ownerWorkspaceRows(inactive);
    const inactiveResult = await edge('org-create-workspace', inactive.token, { name: 'Inactive Two' });
    assert.equal(inactiveResult.response.status, 503);
    assert.equal(inactiveResult.body?.code, 'workspace_entitlement_unavailable');
    assert.deepEqual(await ownerWorkspaceRows(inactive), inactiveBefore);

    const unavailable = await createAccount('unavailable');
    const removedBilling = await sql(`
      delete from public.billing_customers
      where organization_id = '${unavailable.organizationId}'::uuid
      returning id;
    `);
    assert.match(removedBilling.stdout, /DELETE 1/);
    const unavailableResult = await edge('org-create-workspace', unavailable.token, { name: 'Unavailable Two' });
    assert.equal(unavailableResult.response.status, 503);
    assert.equal(unavailableResult.body?.code, 'workspace_entitlement_unavailable');
    assert.equal((await ownerWorkspaceRows(unavailable)).length, 1);

    const ambiguous = await createAccount('ambiguous');
    await seedProjectedSubscription(ambiguous, `ambiguous-a-${suffix}`);
    const secondSubscription = await rest('subscriptions', {
      method: 'POST',
      body: {
        organization_id: ambiguous.organizationId,
        user_id: ambiguous.user.id,
        stripe_customer_id: `cus_packet2_ambiguous_b_${suffix}`,
        stripe_subscription_id: `sub_packet2_ambiguous_b_${suffix}`,
        status: 'active',
        price_id: 'price_packet2_month',
        interval: 'month',
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
      prefer: 'return=representation',
    });
    assert.equal(secondSubscription.response.status, 201, JSON.stringify(secondSubscription.body));
    const ambiguousResult = await edge('org-create-workspace', ambiguous.token, { name: 'Ambiguous Two' });
    assert.equal(ambiguousResult.response.status, 409);
    assert.equal(ambiguousResult.body?.code, 'workspace_billing_identity_unsafe');
    assert.equal((await ownerWorkspaceRows(ambiguous)).length, 1);
    assert.doesNotMatch(JSON.stringify(ambiguousResult.body), /sql|postgres|subscription|stripe|details|hint/i);
  });

  await t.test('same-owner concurrent requests serialize at one remaining slot with no partial residue', async () => {
    const concurrent = await createAccount('concurrent');
    await seedProjectedSubscription(concurrent, `concurrent-${suffix}`);
    const second = await edge('org-create-workspace', concurrent.token, { name: 'Concurrent Existing Two' });
    assert.equal(second.response.status, 200, JSON.stringify(second.body));

    const beforeOrganizations = await ownerWorkspaceRows(concurrent);
    assert.equal(beforeOrganizations.length, 2);
    const beforeMembershipCount = (await rows(
      `organization_members?user_id=eq.${concurrent.user.id}&role=eq.owner&select=id`,
    )).length;
    const beforeBillingCount = (await rows(
      `billing_customers?organization_id=in.(${beforeOrganizations.map(row => row.id).join(',')})&select=id`,
    )).length;

    const results = await Promise.all([
      edge('org-create-workspace', concurrent.token, { name: 'Concurrent Candidate A' }),
      edge('org-create-workspace', concurrent.token, { name: 'Concurrent Candidate B' }),
    ]);
    const statuses = results.map(result => result.response.status).sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);
    const rejected = results.find(result => result.response.status === 409);
    assert.equal(rejected.body?.code, 'workspace_limit_reached');

    const afterOrganizations = await ownerWorkspaceRows(concurrent);
    assert.equal(afterOrganizations.length, beforeOrganizations.length + 1);
    const afterMembershipCount = (await rows(
      `organization_members?user_id=eq.${concurrent.user.id}&role=eq.owner&select=id`,
    )).length;
    const afterBillingCount = (await rows(
      `billing_customers?organization_id=in.(${afterOrganizations.map(row => row.id).join(',')})&select=id`,
    )).length;
    assert.equal(afterMembershipCount, beforeMembershipCount + 1,
      'exactly one owner membership may be added');
    assert.equal(afterBillingCount, beforeBillingCount + 1,
      'exactly one billing placeholder may be added by the membership trigger');
    assert.equal(afterMembershipCount, afterOrganizations.length,
      'every created organization must have exactly one canonical owner membership');
    assert.equal(afterBillingCount, afterOrganizations.length,
      'every created organization must have exactly one billing row and no trial residue');
  });

  await t.test('different owners do not share the serialization lock', async () => {
    const ownerA = await createAccount('parallel-a');
    const ownerB = await createAccount('parallel-b');
    await seedProjectedSubscription(ownerA, `parallel-a-${suffix}`);
    await seedProjectedSubscription(ownerB, `parallel-b-${suffix}`);

    const [createdA, createdB] = await Promise.all([
      edge('org-create-workspace', ownerA.token, { name: 'Parallel A Two' }),
      edge('org-create-workspace', ownerB.token, { name: 'Parallel B Two' }),
    ]);
    assert.equal(createdA.response.status, 200, JSON.stringify(createdA.body));
    assert.equal(createdB.response.status, 200, JSON.stringify(createdB.body));
    assert.equal((await ownerWorkspaceRows(ownerA)).length, 2);
    assert.equal((await ownerWorkspaceRows(ownerB)).length, 2);
  });
});
