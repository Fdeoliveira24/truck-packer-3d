import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupLocalFixtureRun } from '../../scripts/local-fixtures/cleanup.mjs';
import { resolveLocalFixtureEnvironment } from '../../scripts/local-fixtures/environment.mjs';
import { createLocalFixtureRun } from '../../scripts/local-fixtures/harness.mjs';

const availability = await resolveLocalFixtureEnvironment({ allowUnavailable: true });

function assertPostgrestDenied(response, label) {
  assert.equal(response.status, 403, `${label} must return authenticated permission denied`);
  assert.equal(response.body?.code, '42501', `${label} must be denied by PostgreSQL privileges`);
}

async function expectPgCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

if (!availability.available) {
  test('local security Gate B2', { skip: `SKIP: ${availability.reason}` }, () => {});
} else {
  test('local security Gate B2 RLS, constraints, and no-workspace matrix', async (t) => {
    const run = await createLocalFixtureRun({ label: 'gate-b2-security' });
    let cleanupProof = null;
    try {
      const owner = await run.signupUser('b2-security-owner');
      const unrelated = await run.signupUser('b2-security-unrelated');

      await t.test('authenticated own profile, workspace, and membership reads succeed', async () => {
        const profile = await run.rest(`profiles?id=eq.${owner.userId}&select=id,current_organization_id`, owner.jwt);
        const organization = await run.rest(`organizations?id=eq.${owner.organization_id}&select=id,owner_id`, owner.jwt);
        const membership = await run.rest(
          `organization_members?organization_id=eq.${owner.organization_id}&select=user_id,role`,
          owner.jwt,
        );
        assert.equal(profile.status, 200);
        assert.deepEqual(profile.body, [{ id: owner.userId, current_organization_id: owner.organization_id }]);
        assert.equal(organization.status, 200);
        assert.deepEqual(organization.body, [{ id: owner.organization_id, owner_id: owner.userId }]);
        assert.equal(membership.status, 200);
        assert.deepEqual(membership.body, [{ user_id: owner.userId, role: 'owner' }]);
      });

      await t.test('unrelated organization rows remain hidden by RLS', async () => {
        const organization = await run.rest(
          `organizations?id=eq.${unrelated.organization_id}&select=id,owner_id`,
          owner.jwt,
        );
        const membership = await run.rest(
          `organization_members?organization_id=eq.${unrelated.organization_id}&select=user_id,role`,
          owner.jwt,
        );
        assert.equal(organization.status, 200);
        assert.deepEqual(organization.body, []);
        assert.equal(membership.status, 200);
        assert.deepEqual(membership.body, []);
      });

      await t.test('billing projections and webhook events are not browser-readable', async () => {
        assertPostgrestDenied(await run.rest('billing_customers?select=id', owner.jwt), 'billing_customers SELECT');
        assertPostgrestDenied(await run.rest('subscriptions?select=id', owner.jwt), 'subscriptions SELECT');
        assertPostgrestDenied(await run.rest('webhook_events?select=id', owner.jwt), 'webhook_events SELECT');
      });

      await t.test('anon remains denied', async () => {
        const profile = await run.rest('profiles?select=id', null);
        assert.equal(profile.status, 401);
        assert.equal(profile.body?.code, '42501');
        const membership = await run.rest('organization_members?select=id', null);
        assert.equal(membership.status, 401);
        assert.equal(membership.body?.code, '42501');
      });

      await t.test('direct authenticated membership DML and owner replacement are blocked', async () => {
        const insert = await run.rest('organization_members', owner.jwt, {
          method: 'POST',
          body: { organization_id: owner.organization_id, user_id: unrelated.userId, role: 'owner' },
          prefer: 'return=representation',
        });
        const update = await run.rest(
          `organization_members?organization_id=eq.${owner.organization_id}&user_id=eq.${owner.userId}`,
          owner.jwt,
          { method: 'PATCH', body: { role: 'admin' }, prefer: 'return=representation' },
        );
        const remove = await run.rest(
          `organization_members?organization_id=eq.${owner.organization_id}&user_id=eq.${owner.userId}`,
          owner.jwt,
          { method: 'DELETE', prefer: 'return=representation' },
        );
        const replaceOwner = await run.rest(`organizations?id=eq.${owner.organization_id}`, owner.jwt, {
          method: 'PATCH',
          body: { owner_id: unrelated.userId },
          prefer: 'return=representation',
        });
        assertPostgrestDenied(insert, 'membership INSERT');
        assertPostgrestDenied(update, 'membership UPDATE');
        assertPostgrestDenied(remove, 'membership DELETE');
        assert.equal(replaceOwner.status, 403);
        const snapshot = await run.snapshotOrganization(owner.organization_id);
        assert.equal(snapshot.organization[0]?.owner_id, owner.userId);
        assert.deepEqual(snapshot.members.map(row => row.role), ['owner']);
      });

      const direct = await run.setDirectSubscription(owner.organization_id, owner.userId, {
        suffix: 'constraint-source',
        interval: 'month',
      });
      await t.test('raw constraints reject duplicate subscription, billing customer, and membership identities', async () => {
        await expectPgCode(run.withRollback(db => db.query(`
          insert into public.subscriptions (
            organization_id, user_id, stripe_customer_id, stripe_subscription_id,
            status, price_id, interval, current_period_end
          ) values ($1::uuid, $2::uuid, $3, $4, 'active', $5, 'month', now() + interval '30 days')
        `, [
          owner.organization_id,
          owner.userId,
          `cus_duplicate_${run.compactRunId}`,
          direct.subscription.stripe_subscription_id,
          `price_duplicate_${run.compactRunId}`,
        ])), '23505');

        await expectPgCode(run.withRollback(db => db.query(`
          insert into public.billing_customers (organization_id, status)
          values ($1::uuid, 'trialing')
        `, [owner.organization_id])), '23505');

        await expectPgCode(run.withRollback(db => db.query(`
          insert into public.organization_members (organization_id, user_id, role)
          values ($1::uuid, $2::uuid, 'owner')
        `, [owner.organization_id, owner.userId])), '23505');
      });

      await t.test('currently permitted adversarial billing shapes are proven only inside rollback transactions', async () => {
        const adversarialWorkspace = await run.createOwnedWorkspace(owner.userId, 'adversarial');
        const secondWorkspace = await run.createOwnedWorkspace(owner.userId, 'adversarial-second');
        await run.withRollback(async (db) => {
          await db.query(`
            insert into public.subscriptions (
              organization_id, user_id, stripe_customer_id, stripe_subscription_id,
              status, price_id, interval, current_period_end
            ) values
              ($1::uuid, $2::uuid, $3, $4, 'active', $5, 'month', now() + interval '30 days'),
              ($1::uuid, $2::uuid, $6, $7, 'active', $8, 'year', now() + interval '365 days')
          `, [
            adversarialWorkspace.organization.id,
            owner.userId,
            `cus_adversarial_a_${run.compactRunId}`,
            `sub_adversarial_a_${run.compactRunId}`,
            `price_adversarial_a_${run.compactRunId}`,
            `cus_adversarial_b_${run.compactRunId}`,
            `sub_adversarial_b_${run.compactRunId}`,
            `price_adversarial_b_${run.compactRunId}`,
          ]);
          const twoActive = await db.query(
            'select count(*)::integer as count from public.subscriptions where organization_id = $1::uuid and status = $2',
            [adversarialWorkspace.organization.id, 'active'],
          );
          assert.equal(twoActive.rows[0]?.count, 2);

          const sharedSubscriptionId = `sub_shared_projection_${run.compactRunId}`;
          await db.query(`
            update public.billing_customers
            set stripe_subscription_id = $2, status = 'active'
            where organization_id = any($1::uuid[])
          `, [[adversarialWorkspace.organization.id, secondWorkspace.organization.id], sharedSubscriptionId]);
          const duplicatedProjection = await db.query(
            'select count(*)::integer as count from public.billing_customers where stripe_subscription_id = $1',
            [sharedSubscriptionId],
          );
          assert.equal(duplicatedProjection.rows[0]?.count, 2);
        });
        const persisted = await run.query(
          'select count(*)::integer as count from public.subscriptions where organization_id = $1::uuid',
          [adversarialWorkspace.organization.id],
        );
        assert.equal(persisted.rows[0]?.count, 0);
      });

      const noWorkspace = await run.signupUser('b2-no-workspace');
      await t.test('true no-workspace fixture removes only its exact auto-created graph', async () => {
        await run.removeWorkspaceForNoWorkspaceProof(noWorkspace.userId, noWorkspace.organization_id);
        const state = await run.query(`
          select
            (select count(*)::integer from public.organizations where id = $1::uuid) as organizations,
            (select count(*)::integer from public.organization_members where organization_id = $1::uuid) as memberships,
            (select count(*)::integer from public.billing_customers where organization_id = $1::uuid) as billing,
            (select current_organization_id from public.profiles where id = $2::uuid) as current_organization_id,
            (select count(*)::integer from auth.users where id = $2::uuid) as users
        `, [noWorkspace.organization_id, noWorkspace.userId]);
        assert.equal(state.rows[0]?.organizations, 0);
        assert.equal(state.rows[0]?.memberships, 0);
        assert.equal(state.rows[0]?.billing, 0);
        assert.equal(state.rows[0]?.current_organization_id, null);
        assert.equal(state.rows[0]?.users, 1);
      });
    } finally {
      cleanupProof = await cleanupLocalFixtureRun(run);
      await run.close();
    }

    await t.test('Gate B2 security cleanup leaves zero tracked or tagged residual rows', () => {
      assert.equal(cleanupProof?.residualTotal, 0);
      assert.equal(cleanupProof?.temporaryResourcesRemoved, true);
    });
  });
}
