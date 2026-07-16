import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupLocalFixtureRun } from '../../scripts/local-fixtures/cleanup.mjs';
import { resolveLocalFixtureEnvironment } from '../../scripts/local-fixtures/environment.mjs';
import { createLocalFixtureRun } from '../../scripts/local-fixtures/harness.mjs';

const availability = await resolveLocalFixtureEnvironment({ allowUnavailable: true });

function rolesByUser(snapshot) {
  return new Map(snapshot.members.map(row => [row.user_id, row.role]));
}

if (!availability.available) {
  test('local ownership Gate B2', { skip: `SKIP: ${availability.reason}` }, () => {});
} else {
  test('local ownership Gate B2 Edge and RPC matrix', async (t) => {
    const run = await createLocalFixtureRun({ label: 'gate-b2-ownership' });
    let cleanupProof = null;
    try {
      const owner = await run.signupUser('b2-owner');
      const target = await run.signupUser('b2-target');
      const admin = await run.signupUser('b2-admin');
      const outsider = await run.signupUser('b2-outsider');
      const coverageOwner = await run.signupUser('b2-coverage-owner');

      const transferable = await run.createOwnedWorkspace(owner.userId, 'transfer-no-direct');
      await run.addMember(transferable.organization.id, target.userId, 'member');
      await t.test('no direct billing permits transfer and preserves one canonical owner', async () => {
        const response = await run.callFunction('org-transfer-ownership', owner.jwt, {
          body: { organization_id: transferable.organization.id, new_owner_id: target.userId },
        });
        assert.equal(response.status, 200);
        let snapshot = await run.snapshotOrganization(transferable.organization.id);
        assert.equal(snapshot.organization[0]?.owner_id, target.userId);
        assert.equal(rolesByUser(snapshot).get(target.userId), 'owner');
        assert.equal(rolesByUser(snapshot).get(owner.userId), 'admin');
        assert.equal(snapshot.members.filter(row => row.role === 'owner').length, 1);

        const restored = await run.callFunction('org-transfer-ownership', target.jwt, {
          body: { organization_id: transferable.organization.id, new_owner_id: owner.userId },
        });
        assert.equal(restored.status, 200);
        snapshot = await run.snapshotOrganization(transferable.organization.id);
        assert.equal(snapshot.organization[0]?.owner_id, owner.userId);
        assert.equal(rolesByUser(snapshot).get(owner.userId), 'owner');
        assert.equal(rolesByUser(snapshot).get(target.userId), 'admin');
        assert.equal(snapshot.members.filter(row => row.role === 'owner').length, 1);
      });

      const paid = await run.createOwnedWorkspace(owner.userId, 'transfer-active');
      await run.addMember(paid.organization.id, target.userId, 'member');
      await run.setDirectSubscription(paid.organization.id, owner.userId, {
        suffix: 'transfer-active',
        interval: 'month',
      });
      await t.test('active direct billing blocks transfer without mutation', async () => {
        const before = await run.snapshotOrganization(paid.organization.id);
        const response = await run.callFunction('org-transfer-ownership', owner.jwt, {
          body: { organization_id: paid.organization.id, new_owner_id: target.userId },
        });
        assert.equal(response.status, 409);
        assert.equal(response.body?.error, 'workspace_has_active_billing');
        assert.deepEqual(await run.snapshotOrganization(paid.organization.id), before);
      });

      await run.setDirectSubscription(coverageOwner.organization_id, coverageOwner.userId, {
        suffix: 'sibling-coverage-source',
        interval: 'month',
      });
      const coveredSibling = await run.createOwnedWorkspace(coverageOwner.userId, 'covered-transfer');
      await run.addMember(coveredSibling.organization.id, target.userId, 'member');
      await t.test('sibling owner-plan coverage alone does not block transfer', async () => {
        const coveredStatus = await run.billingStatus(coverageOwner.jwt, coveredSibling.organization.id);
        assert.equal(coveredStatus.status, 200);
        assert.equal(coveredStatus.body?.entitlementStatus, 'included_in_plan');
        const response = await run.callFunction('org-transfer-ownership', coverageOwner.jwt, {
          body: { organization_id: coveredSibling.organization.id, new_owner_id: target.userId },
        });
        assert.equal(response.status, 200);
        const snapshot = await run.snapshotOrganization(coveredSibling.organization.id);
        assert.equal(snapshot.organization[0]?.owner_id, target.userId);
      });

      const authorization = await run.createOwnedWorkspace(owner.userId, 'transfer-authorization');
      await run.addMember(authorization.organization.id, target.userId, 'member');
      await t.test('non-owner and missing-target transfer checks fail safely', async () => {
        const nonOwner = await run.callFunction('org-transfer-ownership', outsider.jwt, {
          body: { organization_id: authorization.organization.id, new_owner_id: target.userId },
        });
        assert.equal(nonOwner.status, 403);
        const missingTarget = await run.callFunction('org-transfer-ownership', owner.jwt, {
          body: { organization_id: authorization.organization.id, new_owner_id: outsider.userId },
        });
        assert.equal(missingTarget.status, 404);
        const snapshot = await run.snapshotOrganization(authorization.organization.id);
        assert.equal(snapshot.organization[0]?.owner_id, owner.userId);
        assert.equal(snapshot.members.filter(row => row.role === 'owner').length, 1);
      });

      const roles = await run.createOwnedWorkspace(owner.userId, 'role-matrix');
      await run.addMember(roles.organization.id, target.userId, 'member');
      await run.addMember(roles.organization.id, admin.userId, 'admin');
      await t.test('owner role-update supports member/admin changes and same-role no-op', async () => {
        const promote = await run.callFunction('org-member-role-update', owner.jwt, {
          body: { organization_id: roles.organization.id, user_id: target.userId, role: 'admin' },
        });
        assert.equal(promote.status, 200);
        assert.equal(promote.body?.member?.role, 'admin');
        const demote = await run.callFunction('org-member-role-update', owner.jwt, {
          body: { organization_id: roles.organization.id, user_id: target.userId, role: 'member' },
        });
        assert.equal(demote.status, 200);
        assert.equal(demote.body?.member?.role, 'member');
        const noOp = await run.callFunction('org-member-role-update', owner.jwt, {
          body: { organization_id: roles.organization.id, user_id: target.userId, role: 'member' },
        });
        assert.equal(noOp.status, 200);
        assert.equal(noOp.body?.role, 'member');
      });

      await t.test('generic owner mutations and admin authority escalation remain rejected', async () => {
        const promoteOwner = await run.callFunction('org-member-role-update', owner.jwt, {
          body: { organization_id: roles.organization.id, user_id: target.userId, role: 'owner' },
        });
        assert.equal(promoteOwner.status, 409);
        assert.equal(promoteOwner.body?.error, 'ownership_change_requires_transfer');
        const demoteCanonical = await run.callFunction('org-member-role-update', owner.jwt, {
          body: { organization_id: roles.organization.id, user_id: owner.userId, role: 'admin' },
        });
        assert.equal(demoteCanonical.status, 409);
        assert.equal(demoteCanonical.body?.error, 'ownership_change_requires_transfer');
        const adminManagesOwner = await run.callFunction('org-member-role-update', admin.jwt, {
          body: { organization_id: roles.organization.id, user_id: owner.userId, role: 'member' },
        });
        assert.equal(adminManagesOwner.status, 409);
        const ownerPromotesTarget = await run.callFunction('org-member-role-update', owner.jwt, {
          body: { organization_id: roles.organization.id, user_id: target.userId, role: 'admin' },
        });
        assert.equal(ownerPromotesTarget.status, 200);
        const adminManagesAdmin = await run.callFunction('org-member-role-update', admin.jwt, {
          body: { organization_id: roles.organization.id, user_id: target.userId, role: 'member' },
        });
        assert.equal(adminManagesAdmin.status, 403);
        const snapshot = await run.snapshotOrganization(roles.organization.id);
        assert.equal(snapshot.organization[0]?.owner_id, owner.userId);
        assert.equal(snapshot.members.filter(row => row.role === 'owner').length, 1);
      });

      const rpcWorkspace = await run.createOwnedWorkspace(owner.userId, 'rpc-atomic');
      await run.addMember(rpcWorkspace.organization.id, target.userId, 'member');
      await t.test('ownership RPC updates organization and both roles atomically and restores cleanly', async () => {
        await run.query(
          'select public.tp3d_transfer_workspace_ownership($1::uuid, $2::uuid, $3::uuid)',
          [rpcWorkspace.organization.id, target.userId, owner.userId],
        );
        let snapshot = await run.snapshotOrganization(rpcWorkspace.organization.id);
        assert.equal(snapshot.organization[0]?.owner_id, target.userId);
        assert.equal(rolesByUser(snapshot).get(target.userId), 'owner');
        assert.equal(rolesByUser(snapshot).get(owner.userId), 'admin');
        assert.equal(snapshot.members.filter(row => row.role === 'owner').length, 1);

        await run.query(
          'select public.tp3d_transfer_workspace_ownership($1::uuid, $2::uuid, $3::uuid)',
          [rpcWorkspace.organization.id, owner.userId, target.userId],
        );
        snapshot = await run.snapshotOrganization(rpcWorkspace.organization.id);
        assert.equal(snapshot.organization[0]?.owner_id, owner.userId);
        assert.equal(rolesByUser(snapshot).get(owner.userId), 'owner');
        assert.equal(rolesByUser(snapshot).get(target.userId), 'admin');
        assert.equal(snapshot.members.filter(row => row.role === 'owner').length, 1);
      });
    } finally {
      cleanupProof = await cleanupLocalFixtureRun(run);
      await run.close();
    }

    await t.test('Gate B2 ownership cleanup leaves zero tracked or tagged residual rows', () => {
      assert.equal(cleanupProof?.residualTotal, 0);
      assert.equal(cleanupProof?.temporaryResourcesRemoved, true);
    });
  });
}
