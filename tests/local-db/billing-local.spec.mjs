import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupLocalFixtureRun } from '../../scripts/local-fixtures/cleanup.mjs';
import { resolveLocalFixtureEnvironment } from '../../scripts/local-fixtures/environment.mjs';
import { createLocalFixtureRun } from '../../scripts/local-fixtures/harness.mjs';

const availability = await resolveLocalFixtureEnvironment({ allowUnavailable: true });

if (!availability.available) {
  test('local billing Gate B1', { skip: `SKIP: ${availability.reason}` }, () => {});
} else {
  test('local billing Gate B1 harness and core proof', async (t) => {
    const run = await createLocalFixtureRun({ label: 'gate-b1' });
    let cleanupProof = null;
    try {
      const owner = await run.signupUser('gate-b1-owner');
      const target = await run.signupUser('gate-b1-target');
      await run.addMember(owner.organization_id, target.userId, 'member');

      await t.test('local proxy is loopback-only and unauthenticated requests still fail closed', async () => {
        assert.equal(run.proxy.listenHost, '127.0.0.1');
        assert.equal(run.proxy.listenPort, 54321);
        assert.equal(run.proxy.targetHost, 'api.supabase.internal');
        assert.equal(run.proxy.targetPort, 8000);
        assert.equal(run.proxy.edgeSupabaseUrl, 'http://kong:8000');
        assert.ok(['127.0.0.1', 'localhost'].includes(new URL(run.environment.apiUrl).hostname));
        const absent = await run.callFunction('org-transfer-ownership', null, {
          body: { organization_id: owner.organization_id, new_owner_id: target.userId },
        });
        assert.equal(absent.status, 401);
        const invalid = await run.callFunction('org-member-role-update', 'invalid-local-jwt', {
          body: { organization_id: owner.organization_id, user_id: target.userId, role: 'admin' },
        });
        assert.equal(invalid.status, 401);
      });

      await t.test('A: signup trigger creates profile, default owner workspace, and no-card trial', () => {
        assert.equal(owner.profile_id, owner.userId);
        assert.equal(owner.current_organization_id, owner.organization_id);
        assert.equal(owner.owner_id, owner.userId);
        assert.equal(owner.role, 'owner');
        assert.equal(owner.billing_status, 'trialing');
        assert.equal(owner.stripe_subscription_id, null);
        assert.ok(new Date(owner.trial_ends_at).getTime() > Date.now());
        assert.equal(owner.rows.length, 1);
      });

      const direct = await run.setDirectSubscription(owner.organization_id, owner.userId, {
        suffix: 'b1-monthly',
        interval: 'month',
      });

      await t.test('B: direct active monthly billing returns direct identity and configured base limit', async () => {
        const response = await run.billingStatus(owner.jwt, owner.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.ok, true);
        assert.equal(response.body?.orgId, owner.organization_id);
        assert.equal(response.body?.billingOwnerUserId, owner.userId);
        assert.equal(response.body?.entitlementStatus, 'active');
        assert.equal(response.body?.status, 'active');
        assert.equal(response.body?.interval, 'month');
        assert.equal(response.body?.workspaceIncluded, true);
        assert.equal(response.body?.isPro, true);
        assert.ok(Number.isInteger(response.body?.workspaceLimit));
        assert.ok(response.body.workspaceLimit > 0);
        assert.equal(direct.subscription.organization_id, owner.organization_id);
        assert.equal(direct.billingCustomer.organization_id, owner.organization_id);
        assert.equal(direct.subscription.stripe_subscription_id, direct.billingCustomer.stripe_subscription_id);
        assert.equal(Object.hasOwn(response.body, 'includedOrgIds'), false);
      });

      await t.test('C: active billing blocks ownership transfer without mutation', async () => {
        const before = await run.snapshotOrganization(owner.organization_id);
        const response = await run.callFunction('org-transfer-ownership', owner.jwt, {
          body: { organization_id: owner.organization_id, new_owner_id: target.userId },
        });
        assert.equal(response.status, 409);
        assert.equal(response.body?.error, 'workspace_has_active_billing');
        const after = await run.snapshotOrganization(owner.organization_id);
        assert.deepEqual(after, before);
      });

      await t.test('D: generic member-to-owner mutation is rejected without changing canonical owner', async () => {
        const before = await run.snapshotOrganization(owner.organization_id);
        const response = await run.callFunction('org-member-role-update', owner.jwt, {
          body: { organization_id: owner.organization_id, user_id: target.userId, role: 'owner' },
        });
        assert.equal(response.status, 409);
        assert.equal(response.body?.error, 'ownership_change_requires_transfer');
        const after = await run.snapshotOrganization(owner.organization_id);
        assert.deepEqual(after, before);
      });
    } finally {
      cleanupProof = await cleanupLocalFixtureRun(run);
      await run.close();
    }

    await t.test('exact-ID cleanup leaves zero tracked or tagged residual rows', () => {
      assert.equal(cleanupProof?.residualTotal, 0);
      assert.equal(cleanupProof?.temporaryResourcesRemoved, true);
      assert.ok(Object.values(cleanupProof.exactResiduals).every(count => count === 0));
      assert.ok(Object.values(cleanupProof.taggedResiduals).every(count => Number(count) === 0));
    });
  });

  test('local billing Gate B2 status matrix', async (t) => {
    const run = await createLocalFixtureRun({ label: 'gate-b2-billing' });
    let cleanupProof = null;
    try {
      const noMapping = await run.signupUser('b2-no-mapping');
      await run.deleteBillingCustomer(noMapping.organization_id);
      await t.test('no usable billing mapping requires an owner subscription', async () => {
        const response = await run.billingStatus(noMapping.jwt, noMapping.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.entitlementStatus, 'owner_subscription_required');
        assert.equal(response.body?.workspaceIncluded, false);
        assert.equal(response.body?.isPro, false);
      });

      const trial = await run.signupUser('b2-trial');
      await t.test('no-card trial remains a direct trial entitlement', async () => {
        const response = await run.billingStatus(trial.jwt, trial.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.orgId, trial.organization_id);
        assert.equal(response.body?.entitlementStatus, 'trialing');
        assert.equal(response.body?.workspaceIncluded, true);
        assert.equal(response.body?.status, 'trialing');
        assert.equal(response.body?.isPro, true);
      });

      const expiredTrial = await run.signupUser('b2-expired-trial');
      await run.expireNoCardTrial(expiredTrial.organization_id);
      await t.test('expired no-card trial is fail-closed', async () => {
        const response = await run.billingStatus(expiredTrial.jwt, expiredTrial.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.entitlementStatus, 'trial_expired');
        assert.equal(response.body?.workspaceIncluded, false);
        assert.equal(response.body?.status, 'trial_expired');
        assert.equal(response.body?.isPro, false);
      });

      const directOwner = await run.signupUser('b2-direct-siblings');
      const annualWorkspace = await run.createOwnedWorkspace(directOwner.userId, 'direct-annual');
      const monthlyEnd = new Date(Date.now() + 31 * 86400000).toISOString();
      const annualEnd = new Date(Date.now() + 366 * 86400000).toISOString();
      await run.setDirectSubscription(directOwner.organization_id, directOwner.userId, {
        suffix: 'direct-monthly',
        interval: 'month',
        currentPeriodEnd: monthlyEnd,
      });
      await run.setDirectSubscription(annualWorkspace.organization.id, directOwner.userId, {
        suffix: 'direct-annual',
        interval: 'year',
        currentPeriodEnd: annualEnd,
      });
      let baseWorkspaceLimit = null;
      await t.test('monthly and annual directly paid siblings retain their own top-level identity', async () => {
        const monthly = await run.billingStatus(directOwner.jwt, directOwner.organization_id);
        const annual = await run.billingStatus(directOwner.jwt, annualWorkspace.organization.id);
        assert.equal(monthly.status, 200);
        assert.equal(annual.status, 200);
        assert.equal(monthly.body?.orgId, directOwner.organization_id);
        assert.equal(monthly.body?.entitlementStatus, 'active');
        assert.equal(monthly.body?.interval, 'month');
        assert.equal(new Date(monthly.body?.currentPeriodEnd).getTime(), new Date(monthlyEnd).getTime());
        assert.equal(annual.body?.orgId, annualWorkspace.organization.id);
        assert.equal(annual.body?.entitlementStatus, 'active');
        assert.equal(annual.body?.interval, 'year');
        assert.equal(new Date(annual.body?.currentPeriodEnd).getTime(), new Date(annualEnd).getTime());
        assert.equal(Object.hasOwn(monthly.body, 'includedOrgIds'), false);
        assert.equal(Object.hasOwn(annual.body, 'includedOrgIds'), false);
        assert.ok(Number.isInteger(monthly.body?.workspaceLimit));
        assert.equal(monthly.body.workspaceLimit, annual.body.workspaceLimit);
        baseWorkspaceLimit = monthly.body.workspaceLimit;
      });

      const coverageOwner = await run.signupUser('b2-owner-coverage');
      await run.setDirectSubscription(coverageOwner.organization_id, coverageOwner.userId, {
        suffix: 'coverage-direct',
        interval: 'month',
      });
      const directCoverage = await run.billingStatus(coverageOwner.jwt, coverageOwner.organization_id);
      assert.equal(directCoverage.status, 200);
      const coverageLimit = directCoverage.body?.workspaceLimit;
      assert.ok(Number.isInteger(coverageLimit) && coverageLimit > 1,
        'current base-paid workspace limit must support an included sibling without hardcoding its value');
      const siblingWorkspaces = [];
      for (let index = 0; index < coverageLimit; index += 1) {
        siblingWorkspaces.push(await run.createOwnedWorkspace(coverageOwner.userId, `coverage-${index}`));
      }
      await t.test('unpaid siblings are included only within the derived base-paid limit', async () => {
        const included = await run.billingStatus(coverageOwner.jwt, siblingWorkspaces[0].organization.id);
        const outside = await run.billingStatus(
          coverageOwner.jwt,
          siblingWorkspaces[siblingWorkspaces.length - 1].organization.id,
        );
        assert.equal(included.status, 200);
        assert.equal(included.body?.entitlementStatus, 'included_in_plan');
        assert.equal(included.body?.workspaceIncluded, true);
        assert.equal(included.body?.workspaceLimit, coverageLimit);
        assert.equal(outside.status, 200);
        assert.equal(outside.body?.entitlementStatus, 'workspace_limit_reached');
        assert.equal(outside.body?.workspaceIncluded, false);
        assert.equal(outside.body?.workspaceLimit, coverageLimit);
        assert.equal(outside.body?.workspaceCount, coverageLimit + 1);
      });

      const canceled = await run.signupUser('b2-canceled');
      await run.setDirectSubscription(canceled.organization_id, canceled.userId, {
        suffix: 'canceled',
        status: 'canceled',
        interval: 'month',
      });
      await t.test('canceled direct subscription no longer grants access', async () => {
        const response = await run.billingStatus(canceled.jwt, canceled.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.entitlementStatus, 'owner_subscription_required');
        assert.equal(response.body?.workspaceIncluded, false);
        assert.equal(response.body?.status, 'canceled');
        assert.equal(response.body?.isPro, false);
      });

      const archived = await run.signupUser('b2-archived');
      await run.archiveOrganization(archived.organization_id, archived.jwt);
      await t.test('archived requested organization is billing-unavailable', async () => {
        const response = await run.billingStatus(archived.jwt, archived.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.archived, true);
        assert.equal(response.body?.entitlementStatus, 'billing_unavailable');
        assert.equal(response.body?.workspaceIncluded, false);
        assert.equal(response.body?.isPro, false);
      });

      const unknownPrice = await run.signupUser('b2-unknown-price');
      await run.setDirectSubscription(unknownPrice.organization_id, unknownPrice.userId, {
        suffix: 'unknown-price',
        priceId: `price_unknown_${run.compactRunId}`,
        interval: 'year',
      });
      await t.test('unknown active price preserves the current base-plan fallback', async () => {
        const response = await run.billingStatus(unknownPrice.jwt, unknownPrice.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.entitlementStatus, 'active');
        assert.equal(response.body?.workspaceIncluded, true);
        assert.equal(response.body?.interval, 'year');
        assert.equal(response.body?.workspaceLimit, baseWorkspaceLimit);
        assert.equal(Object.hasOwn(response.body, 'unknownPriceId'), false);
      });

      const duplicate = await run.signupUser('b2-duplicate-active');
      await run.setDirectSubscription(duplicate.organization_id, duplicate.userId, {
        suffix: 'duplicate-a',
        interval: 'month',
      });
      await run.insertSubscription(duplicate.organization_id, duplicate.userId, {
        suffix: 'duplicate-b',
        interval: 'year',
      });
      await t.test('duplicate active rows for one requested organization fail closed', async () => {
        const response = await run.billingStatus(duplicate.jwt, duplicate.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.duplicateActiveMappings, true);
        assert.equal(response.body?.entitlementStatus, 'owner_subscription_required');
        assert.equal(response.body?.workspaceIncluded, false);
        assert.equal(response.body?.isPro, false);
      });

      const conflict = await run.signupUser('b2-conflict');
      const conflictSibling = await run.createOwnedWorkspace(conflict.userId, 'conflict-sibling');
      const conflictDirect = await run.setDirectSubscription(conflict.organization_id, conflict.userId, {
        suffix: 'conflict-source',
        interval: 'month',
      });
      await run.setBillingCustomer(conflictSibling.organization.id, {
        stripe_customer_id: conflictDirect.billingCustomer.stripe_customer_id,
        stripe_subscription_id: conflictDirect.subscription.stripe_subscription_id,
        status: 'active',
        plan_name: 'pro',
        billing_interval: 'month',
        current_period_end: conflictDirect.subscription.current_period_end,
        trial_ends_at: null,
      });
      await t.test('conflicting local projection records the current billing-customer fallback', async () => {
        const response = await run.billingStatus(conflict.jwt, conflictSibling.organization.id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.duplicateActiveMappings, false);
        assert.equal(response.body?.entitlementStatus, 'included_in_plan');
        assert.equal(response.body?.workspaceIncluded, true);
        assert.equal(response.body?.orgId, conflictSibling.organization.id);
      });

      const stale = await run.signupUser('b2-stale-subscription');
      await run.setBillingCustomer(stale.organization_id, {
        stripe_customer_id: `cus_stale_${run.compactRunId}`,
        stripe_subscription_id: `sub_stale_${run.compactRunId}`,
        status: 'active',
        plan_name: 'pro',
        billing_interval: 'month',
        current_period_end: new Date(Date.now() + 15 * 86400000).toISOString(),
        trial_ends_at: null,
      });
      await t.test('stale subscription identity keeps the current local projection fallback', async () => {
        const response = await run.billingStatus(stale.jwt, stale.organization_id);
        assert.equal(response.status, 200);
        assert.equal(response.body?.entitlementStatus, 'active');
        assert.equal(response.body?.workspaceIncluded, true);
        assert.equal(response.body?.status, 'active');
        assert.equal(response.body?.interval, 'month');
        assert.equal(response.body?.duplicateActiveMappings, false);
      });
    } finally {
      cleanupProof = await cleanupLocalFixtureRun(run);
      await run.close();
    }

    await t.test('Gate B2 billing cleanup leaves zero tracked or tagged residual rows', () => {
      assert.equal(cleanupProof?.residualTotal, 0);
      assert.equal(cleanupProof?.temporaryResourcesRemoved, true);
    });
  });
}
