import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const enabled = process.env.TP3D_LOCAL_DB_INTEGRATION === '1';

const apiUrl = String(process.env.TP3D_LOCAL_API_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const anonKey = String(process.env.TP3D_LOCAL_ANON_KEY || '');
const serviceRoleKey = String(process.env.TP3D_LOCAL_SERVICE_ROLE_KEY || '');
const dbContainer = String(process.env.TP3D_LOCAL_DB_CONTAINER || 'supabase_db_Truck_Packer_3D');
const browserOrigin = 'http://localhost:5500';

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
    'Content-Type': 'application/json',
    Origin: browserOrigin,
  };
  if (token) {
    headers.Authorization = `Bearer ${anonKey}`;
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
  const createdMemberships = await rows(`organization_members?organization_id=eq.${workspaceId}&select=user_id,role`);
  assert.deepEqual(createdMemberships, [{ user_id: owner.user.id, role: 'owner' }]);
  const currentProfile = await rows(`profiles?id=eq.${owner.user.id}&select=current_organization_id`);
  assert.equal(currentProfile[0]?.current_organization_id, workspaceId);
  const createdTrialRows = await rows(`billing_customers?organization_id=eq.${workspaceId}&select=organization_id,status`);
  assert.equal(createdTrialRows.length, 1, 'workspace owner membership must fire the trial seed exactly once');

  const retryA = await edge('org-create-workspace', owner.token, { name: 'Explicit Duplicate Name' });
  const retryB = await edge('org-create-workspace', owner.token, { name: 'Explicit Duplicate Name' });
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
    body: { p_actor_id: missingActorId, p_name: rollbackName },
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
