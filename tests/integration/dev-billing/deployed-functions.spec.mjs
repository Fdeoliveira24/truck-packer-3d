import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateDevelopmentFixtureEnvironment } from '../../../scripts/billing-fixtures/dev-environment.mjs';
import {
  addManifestObject,
  findManifestObject,
  readDevelopmentManifest,
  resolveDevManifestPath,
  fixtureObject,
  writeDevelopmentManifest,
} from '../../../scripts/billing-fixtures/dev-manifest.mjs';
import { createDevelopmentApi } from '../../../scripts/billing-fixtures/dev-invoke.mjs';
import {
  fixtureEmail,
  generateFixturePassword,
} from '../../../scripts/billing-fixtures/dev-seed.mjs';

const UNSAFE_ERROR_RE = /(select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|sqlstate|postgrest|stack\s*trace|authorization\s*:|bearer\s+[a-z0-9._-]+)/i;
const FULL_STRIPE_ID_RE = /\b(?:cus|sub|price)_[A-Za-z0-9]{8,}\b/;

function objectId(manifest, fixtureKey) {
  const object = findManifestObject(manifest, fixtureKey);
  assert.ok(object, `missing manifest object ${fixtureKey}`);
  return object.exactId;
}

function assertSafeErrorResponse(result) {
  const raw = JSON.stringify(result.body ?? null);
  assert.doesNotMatch(raw, UNSAFE_ERROR_RE);
  assert.doesNotMatch(raw, FULL_STRIPE_ID_RE);
}

async function singleRow(api, table, query, message) {
  const result = await api.rest('GET', table, { query });
  assert.equal(result.status, 200, `${message}: HTTP ${result.status}`);
  assert.equal(result.body.length, 1, `${message}: expected one row`);
  return result.body[0];
}

async function persistObject(manifest, manifestPath, object) {
  addManifestObject(manifest, object);
  await writeDevelopmentManifest(manifestPath, manifest);
}

async function issueJwt(api, manifest, role) {
  const userId = objectId(manifest, `${role}.auth_user`);
  const password = generateFixturePassword();
  return api.getUserJwt(userId, fixtureEmail(manifest.runId, role), password);
}

async function inviteUser({ api, manifest, manifestPath, ownerJwt, targetJwt, targetRole, orgId, key }) {
  const invite = await api.invoke('org-invite', {
    jwt: ownerJwt,
    body: {
      organization_id: orgId,
      email: fixtureEmail(manifest.runId, targetRole),
      role: 'member',
    },
  });
  assert.equal(invite.status, 200);
  const inviteId = String(invite.body?.invite?.id || '');
  assert.ok(inviteId);
  await persistObject(
    manifest,
    manifestPath,
    fixtureObject(`${key}.invite`, 'organization_invitation', inviteId),
  );
  const inviteToken = new URL(invite.body.invite_link).searchParams.get('invite_token');
  assert.ok(inviteToken);
  const accepted = await api.invoke('org-invite-accept', {
    jwt: targetJwt,
    body: { token: inviteToken },
  });
  assert.equal(accepted.status, 200);
  const targetUserId = objectId(manifest, `${targetRole}.auth_user`);
  const membership = await singleRow(
    api,
    'organization_members',
    `select=id,organization_id,user_id,role&organization_id=eq.${orgId}&user_id=eq.${targetUserId}`,
    `${key} membership`,
  );
  await persistObject(
    manifest,
    manifestPath,
    fixtureObject(`${key}.membership`, 'organization_membership', String(membership.id)),
  );
  return { invite, accepted, membership };
}

test('deployed development billing function matrix', async t => {
  const config = validateDevelopmentFixtureEnvironment(process.env);
  const manifestPath = resolveDevManifestPath(process.env);
  const manifest = await readDevelopmentManifest(manifestPath, {
    projectRef: config.projectRef,
    environment: config.environment,
  });
  assert.ok(['verified', 'tested'].includes(manifest.phase), 'seeded fixtures must be verified before D2');
  const api = createDevelopmentApi(config);

  const ownerId = objectId(manifest, 'owner.auth_user');
  const adminId = objectId(manifest, 'admin.auth_user');
  const memberId = objectId(manifest, 'member.auth_user');
  const unrelatedId = objectId(manifest, 'unrelated.auth_user');
  const inviteTargetId = objectId(manifest, 'invite-target.auth_user');
  const primaryOrgId = objectId(manifest, 'owner.organization');
  const primaryBillingId = objectId(manifest, 'owner.billing_customer');
  const ownerMembershipId = objectId(manifest, 'owner.owner_membership');

  const [ownerJwt, adminJwt, memberJwt, unrelatedJwt, inviteTargetJwt] = await Promise.all([
    issueJwt(api, manifest, 'owner'),
    issueJwt(api, manifest, 'admin'),
    issueJwt(api, manifest, 'member'),
    issueJwt(api, manifest, 'unrelated'),
    issueJwt(api, manifest, 'invite-target'),
  ]);

  let secondaryOrgId;
  let secondaryBillingId;
  let unknownSubscriptionId;

  await t.test('D2-1 signup trigger created profile, owner membership, workspace, and no-card trial', async () => {
    const profile = await singleRow(api, 'profiles', `select=id,current_organization_id&id=eq.${ownerId}`, 'owner profile');
    const org = await singleRow(api, 'organizations', `select=id,owner_id,archived_at&id=eq.${primaryOrgId}`, 'owner organization');
    const membership = await singleRow(api, 'organization_members', `select=id,role& id=eq.${ownerMembershipId}`.replace('& ', '&'), 'owner membership');
    const billing = await singleRow(api, 'billing_customers', `select=id,status,trial_ends_at,stripe_customer_id,stripe_subscription_id&id=eq.${primaryBillingId}`, 'owner trial');
    assert.equal(profile.current_organization_id, primaryOrgId);
    assert.equal(org.owner_id, ownerId);
    assert.equal(org.archived_at, null);
    assert.equal(membership.role, 'owner');
    assert.equal(billing.status, 'trialing');
    assert.ok(new Date(billing.trial_ends_at).getTime() > Date.now());
    assert.equal(billing.stripe_customer_id, null);
    assert.equal(billing.stripe_subscription_id, null);
  });

  await t.test('D2-2 org-create-workspace creates canonical second workspace without duplicate trial', async () => {
    const created = await api.invoke('org-create-workspace', {
      jwt: ownerJwt,
      body: { name: 'Disposable Development Fixture Workspace' },
    });
    assert.equal(created.status, 200);
    secondaryOrgId = String(created.body?.organization?.id || '');
    assert.ok(secondaryOrgId);
    assert.equal(created.body.organization.owner_id, ownerId);
    assert.equal(created.body.membership.role, 'owner');
    await persistObject(manifest, manifestPath, fixtureObject('owner.secondary_organization', 'organization', secondaryOrgId));
    await persistObject(
      manifest,
      manifestPath,
      fixtureObject('owner.secondary_membership', 'organization_membership', String(created.body.membership.id)),
    );
    const billing = await singleRow(
      api,
      'billing_customers',
      `select=id,status,trial_ends_at,stripe_customer_id,stripe_subscription_id&organization_id=eq.${secondaryOrgId}`,
      'secondary billing placeholder',
    );
    secondaryBillingId = String(billing.id);
    await persistObject(
      manifest,
      manifestPath,
      fixtureObject('owner.secondary_billing_customer', 'billing_customer_projection', secondaryBillingId),
    );
    assert.equal(billing.status, null);
    assert.equal(billing.trial_ends_at, null);
    const profile = await singleRow(api, 'profiles', `select=current_organization_id&id=eq.${ownerId}`, 'updated owner profile');
    assert.equal(profile.current_organization_id, secondaryOrgId);
  });

  await t.test('D2-3 direct no-card trial billing-status is active trialing', async () => {
    const result = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
      query: `organization_id=${primaryOrgId}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.entitlementStatus, 'trialing');
    assert.equal(result.body.status, 'trialing');
    assert.equal(result.body.isPro, true);
    assert.equal(result.body.unknownPriceId, false);
  });

  await t.test('D2-4 workspace with no direct mapping returns the current fail-closed limit result', async () => {
    const result = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
      query: `organization_id=${secondaryOrgId}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.entitlementStatus, 'workspace_limit_reached');
    assert.equal(result.body.workspaceIncluded, false);
    assert.equal(result.body.isActive, false);
  });

  await t.test('D2-4a omitted organization ID uses the profile current workspace fallback', async () => {
    const result = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.orgId, secondaryOrgId);
    assert.equal(result.body.entitlementStatus, 'workspace_limit_reached');
    assert.equal(result.body.workspaceIncluded, false);
  });

  await t.test('D2-5 safely represented expired no-card trial returns trial_expired', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const updated = await api.rest('PATCH', 'billing_customers', {
      query: `id=eq.${primaryBillingId}`,
      body: { status: 'trial_expired', trial_ends_at: past },
      prefer: 'return=representation',
    });
    assert.equal(updated.status, 200);
    const result = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
      query: `organization_id=${primaryOrgId}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.entitlementStatus, 'trial_expired');
    assert.equal(result.body.isPro, false);
  });

  await t.test('D2-6 unknown active Price projection uses paid fallback without raw Price ID', async () => {
    const suffix = manifest.runId.replaceAll('-', '').slice(0, 20);
    const inserted = await api.rest('POST', 'subscriptions', {
      body: {
        organization_id: secondaryOrgId,
        user_id: ownerId,
        stripe_customer_id: `cus_fixture_${suffix}`,
        stripe_subscription_id: `sub_fixture_${suffix}`,
        status: 'active',
        price_id: `price_fixture_unknown_${suffix}`,
        interval: 'month',
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      prefer: 'return=representation',
    });
    assert.equal(inserted.status, 201);
    unknownSubscriptionId = String(inserted.body?.[0]?.id || '');
    assert.ok(unknownSubscriptionId);
    await persistObject(
      manifest,
      manifestPath,
      fixtureObject('owner.unknown_price_subscription', 'subscription_projection', unknownSubscriptionId),
    );
    const result = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
      query: `organization_id=${secondaryOrgId}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.entitlementStatus, 'active');
    assert.equal(result.body.isPro, true);
    assert.equal(result.body.unknownPriceId, true);
    assert.doesNotMatch(JSON.stringify(result.body), /price_fixture_unknown/);
  });

  await t.test('D2-6a paid owner fallback still includes an eligible sibling workspace', async () => {
    const result = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
      query: `organization_id=${primaryOrgId}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.orgId, primaryOrgId);
    assert.equal(result.body.entitlementStatus, 'included_in_plan');
    assert.equal(result.body.workspaceIncluded, true);
    assert.equal(result.body.unknownPriceId, true);
    assert.doesNotMatch(JSON.stringify(result.body), /price_fixture_unknown/);
  });

  await t.test('D2-7 unrelated user cannot read another organization billing status', async () => {
    const result = await api.invoke('billing-status', {
      jwt: unrelatedJwt,
      method: 'GET',
      query: `organization_id=${primaryOrgId}`,
    });
    assert.equal(result.status, 403);
    assertSafeErrorResponse(result);
  });

  let adminPrimaryMembership;
  await t.test('D2-8 invitation acceptance creates member through approved server path', async () => {
    const flow = await inviteUser({
      api,
      manifest,
      manifestPath,
      ownerJwt,
      targetJwt: adminJwt,
      targetRole: 'admin',
      orgId: primaryOrgId,
      key: 'primary.admin',
    });
    adminPrimaryMembership = flow.membership;
    assert.equal(flow.membership.role, 'member');
    assert.equal(flow.invite.body.invite.email, fixtureEmail(manifest.runId, 'admin'));
  });

  await t.test('D2-9 owner changes member to admin', async () => {
    const result = await api.invoke('org-member-role-update', {
      jwt: ownerJwt,
      body: { organization_id: primaryOrgId, user_id: adminId, role: 'admin' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.member.role, 'admin');
  });

  await t.test('D2-10 owner changes admin to member', async () => {
    const result = await api.invoke('org-member-role-update', {
      jwt: ownerJwt,
      body: { organization_id: primaryOrgId, user_id: adminId, role: 'member' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.member.role, 'member');
  });

  await t.test('D2-11 generic owner mutation is rejected with ownership_change_requires_transfer', async () => {
    const result = await api.invoke('org-member-role-update', {
      jwt: ownerJwt,
      body: { organization_id: primaryOrgId, user_id: ownerId, role: 'member' },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'ownership_change_requires_transfer');
  });

  await t.test('D2-12 direct authenticated membership INSERT is denied', async () => {
    const result = await api.rest('POST', 'organization_members', {
      jwt: unrelatedJwt,
      body: { organization_id: primaryOrgId, user_id: unrelatedId, role: 'member' },
      prefer: 'return=representation',
    });
    if (result.ok) {
      const createdId = String(result.body?.[0]?.id || '');
      if (createdId) {
        await persistObject(manifest, manifestPath, fixtureObject('unexpected.direct_insert', 'organization_membership', createdId));
      }
    }
    assert.equal(result.ok, false);
    assert.ok([401, 403].includes(result.status));
  });

  await t.test('D2-13 direct authenticated membership UPDATE is denied', async () => {
    const result = await api.rest('PATCH', 'organization_members', {
      jwt: unrelatedJwt,
      query: `id=eq.${ownerMembershipId}`,
      body: { role: 'member' },
      prefer: 'return=representation',
    });
    assert.equal(result.ok, false);
    assert.ok([401, 403].includes(result.status));
  });

  await t.test('D2-14 direct authenticated membership DELETE is denied', async () => {
    const result = await api.rest('DELETE', 'organization_members', {
      jwt: unrelatedJwt,
      query: `id=eq.${adminPrimaryMembership.id}`,
      prefer: 'return=representation',
    });
    assert.equal(result.ok, false);
    assert.ok([401, 403].includes(result.status));
  });

  await t.test('D2-15 owner removes member through org-member-remove', async () => {
    const result = await api.invoke('org-member-remove', {
      jwt: ownerJwt,
      body: { organization_id: primaryOrgId, user_id: adminId },
    });
    assert.equal(result.status, 200);
    const rows = await api.rest('GET', 'organization_members', {
      query: `select=id&organization_id=eq.${primaryOrgId}&user_id=eq.${adminId}`,
    });
    assert.equal(rows.body.length, 0);
  });

  await t.test('D2-16 member leaves through org-leave-workspace', async () => {
    await inviteUser({
      api,
      manifest,
      manifestPath,
      ownerJwt,
      targetJwt: memberJwt,
      targetRole: 'member',
      orgId: primaryOrgId,
      key: 'primary.member',
    });
    const result = await api.invoke('org-leave-workspace', {
      jwt: memberJwt,
      body: { organization_id: primaryOrgId },
    });
    assert.equal(result.status, 200);
    const rows = await api.rest('GET', 'organization_members', {
      query: `select=id&organization_id=eq.${primaryOrgId}&user_id=eq.${memberId}`,
    });
    assert.equal(rows.body.length, 0);
  });

  await t.test('D2-17 pending invite can be revoked and unaffiliated user cannot manage invites', async () => {
    const invited = await api.invoke('org-invite', {
      jwt: ownerJwt,
      body: {
        organization_id: primaryOrgId,
        email: fixtureEmail(manifest.runId, 'invite-target'),
        role: 'member',
      },
    });
    assert.equal(invited.status, 200);
    const inviteId = String(invited.body.invite.id);
    await persistObject(manifest, manifestPath, fixtureObject('primary.revoked_invite', 'organization_invitation', inviteId));
    const forbidden = await api.invoke('org-invite-revoke', {
      jwt: unrelatedJwt,
      body: { organization_id: primaryOrgId, invite_id: inviteId },
    });
    assert.equal(forbidden.status, 403);
    const revoked = await api.invoke('org-invite-revoke', {
      jwt: ownerJwt,
      body: { organization_id: primaryOrgId, invite_id: inviteId },
    });
    assert.equal(revoked.status, 200);
  });

  await t.test('D2-18 valid no-billing ownership transfer succeeds and remains synchronized', async () => {
    await inviteUser({
      api,
      manifest,
      manifestPath,
      ownerJwt,
      targetJwt: inviteTargetJwt,
      targetRole: 'invite-target',
      orgId: primaryOrgId,
      key: 'primary.transfer_target',
    });
    const transfer = await api.invoke('org-transfer-ownership', {
      jwt: ownerJwt,
      body: { organization_id: primaryOrgId, new_owner_id: inviteTargetId },
    });
    assert.equal(transfer.status, 200);
    let org = await singleRow(api, 'organizations', `select=owner_id&id=eq.${primaryOrgId}`, 'transferred org');
    assert.equal(org.owner_id, inviteTargetId);
    let ownerRows = await api.rest('GET', 'organization_members', {
      query: `select=user_id,role&organization_id=eq.${primaryOrgId}&role=eq.owner`,
    });
    assert.equal(ownerRows.body.length, 1);
    assert.equal(ownerRows.body[0].user_id, inviteTargetId);

    const transferBack = await api.invoke('org-transfer-ownership', {
      jwt: inviteTargetJwt,
      body: { organization_id: primaryOrgId, new_owner_id: ownerId },
    });
    assert.equal(transferBack.status, 200);
    org = await singleRow(api, 'organizations', `select=owner_id&id=eq.${primaryOrgId}`, 'restored owner org');
    assert.equal(org.owner_id, ownerId);
    ownerRows = await api.rest('GET', 'organization_members', {
      query: `select=user_id,role&organization_id=eq.${primaryOrgId}&role=eq.owner`,
    });
    assert.equal(ownerRows.body.length, 1);
    assert.equal(ownerRows.body[0].user_id, ownerId);
  });

  await t.test('D2-19 active direct projection blocks ownership transfer', async () => {
    await inviteUser({
      api,
      manifest,
      manifestPath,
      ownerJwt,
      targetJwt: adminJwt,
      targetRole: 'admin',
      orgId: secondaryOrgId,
      key: 'secondary.billing_transfer_target',
    });
    const result = await api.invoke('org-transfer-ownership', {
      jwt: ownerJwt,
      body: { organization_id: secondaryOrgId, new_owner_id: adminId },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'workspace_has_active_billing');
    const org = await singleRow(api, 'organizations', `select=owner_id&id=eq.${secondaryOrgId}`, 'billing-blocked org');
    assert.equal(org.owner_id, ownerId);
  });

  await t.test('D2-20 archive returns billing unavailable and restore preserves limit checks', async () => {
    const archived = await api.invoke('org-archive-workspace', {
      jwt: ownerJwt,
      body: { organization_id: secondaryOrgId },
    });
    assert.equal(archived.status, 200);
    const billing = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
      query: `organization_id=${secondaryOrgId}`,
    });
    assert.equal(billing.status, 200);
    assert.equal(billing.body.archived, true);
    assert.equal(billing.body.entitlementStatus, 'billing_unavailable');
    const restored = await api.invoke('org-restore-workspace', {
      jwt: ownerJwt,
      body: { organization_id: secondaryOrgId },
    });
    assert.equal(restored.status, 200);
    const org = await singleRow(api, 'organizations', `select=archived_at,owner_id&id=eq.${secondaryOrgId}`, 'restored org');
    assert.equal(org.archived_at, null);
    assert.equal(org.owner_id, ownerId);
  });

  await t.test('D2-21 non-owner checkout rejects before any Stripe request', async () => {
    const result = await api.invoke('stripe-create-checkout-session', {
      jwt: adminJwt,
      body: { organization_id: secondaryOrgId, interval: 'month' },
    });
    assert.equal(result.status, 403);
    assertSafeErrorResponse(result);
  });

  await t.test('D2-22 invalid checkout interval returns sanitized 400 before Stripe access', async () => {
    const result = await api.invoke('stripe-create-checkout-session', {
      jwt: ownerJwt,
      body: { organization_id: secondaryOrgId, interval: 'century' },
    });
    assert.equal(result.status, 400);
    assertSafeErrorResponse(result);
  });

  await t.test('D2-23 non-owner portal rejects before any Stripe request', async () => {
    const result = await api.invoke('stripe-create-portal-session', {
      jwt: adminJwt,
      body: { organization_id: secondaryOrgId },
    });
    assert.equal(result.status, 403);
    assertSafeErrorResponse(result);
  });

  await t.test('D2-24 unmapped organization portal fails closed before Stripe API use', async () => {
    const result = await api.invoke('stripe-create-portal-session', {
      jwt: ownerJwt,
      body: { organization_id: primaryOrgId },
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'no_billing_mapping_for_organization');
    assertSafeErrorResponse(result);
  });

  await t.test('D2-25 source contract proves all safe checkout/portal paths precede Stripe API calls', async () => {
    const checkout = await readFile(new URL('../../../supabase/functions/stripe-create-checkout-session/index.ts', import.meta.url), 'utf8');
    const portal = await readFile(new URL('../../../supabase/functions/stripe-create-portal-session/index.ts', import.meta.url), 'utf8');
    const checkoutHandler = checkout.slice(checkout.indexOf('Deno.serve'));
    const portalHandler = portal.slice(portal.indexOf('Deno.serve'));
    assert.ok(checkoutHandler.indexOf('memberRole !== "owner"') < checkoutHandler.indexOf('hasBlockingStripeSubscription('));
    assert.ok(checkoutHandler.indexOf('if (!interval)') < checkoutHandler.indexOf('const stripe = stripeClient()'));
    assert.ok(portalHandler.indexOf('role !== "owner"') < portalHandler.indexOf('stripe.billingPortal.sessions.create'));
    assert.ok(portalHandler.indexOf('no_billing_mapping_for_organization') < portalHandler.indexOf('stripe.billingPortal.sessions.create'));
  });

  await t.test('D2-26 missing JWT returns 401', async () => {
    const result = await api.invoke('billing-status', {
      method: 'GET',
      query: `organization_id=${primaryOrgId}`,
    });
    assert.equal(result.status, 401);
    assertSafeErrorResponse(result);
  });

  await t.test('D2-27 invalid JWT returns 401', async () => {
    const result = await api.invoke('billing-status', {
      jwt: 'not-a-valid-jwt',
      method: 'GET',
      query: `organization_id=${primaryOrgId}`,
    });
    assert.equal(result.status, 401);
    assertSafeErrorResponse(result);
  });

  await t.test('D2-28 malformed organization ID returns safe 400', async () => {
    const result = await api.invoke('billing-status', {
      jwt: ownerJwt,
      method: 'GET',
      query: 'organization_id=not-a-uuid',
    });
    assert.equal(result.status, 400);
    assertSafeErrorResponse(result);
  });

  await t.test('D2-29 no deployed error response exposes server or payment secrets', async () => {
    const errors = await Promise.all([
      api.invoke('org-member-role-update', { jwt: ownerJwt, body: {} }),
      api.invoke('org-transfer-ownership', { jwt: ownerJwt, body: {} }),
      api.invoke('org-invite', { jwt: unrelatedJwt, body: { organization_id: primaryOrgId, email: fixtureEmail(manifest.runId, 'member') } }),
      api.invoke('stripe-create-portal-session', { jwt: ownerJwt, body: { organization_id: primaryOrgId } }),
    ]);
    errors.forEach(assertSafeErrorResponse);
  });

  assert.ok(unknownSubscriptionId);
  assert.ok(secondaryBillingId);
});
