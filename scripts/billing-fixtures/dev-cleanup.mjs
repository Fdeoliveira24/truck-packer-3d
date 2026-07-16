import { captureDevelopmentFingerprints, compareDevelopmentFingerprints } from './dev-invoke.mjs';
import { maskProjectRef, maskUuid } from './mask.mjs';
import { writeDevelopmentManifest } from './dev-manifest.mjs';

const CLEANUP_ORDER = Object.freeze([
  ['organization_invitation', 'organization_invites'],
  ['subscription_projection', 'subscriptions'],
  ['billing_customer_projection', 'billing_customers'],
  ['organization_membership', 'organization_members'],
  ['organization', 'organizations'],
  ['profile', 'profiles'],
]);

async function objectExists(api, table, exactId) {
  const result = await api.rest('GET', table, {
    query: `select=id&id=eq.${encodeURIComponent(exactId)}`,
  });
  return result.ok && Array.isArray(result.body) && result.body.length > 0;
}

export async function cleanupDevelopmentFixtures({
  api,
  config,
  manifest,
  manifestPath,
  logger = console,
}) {
  const failures = [];
  let alreadyAbsent = 0;

  for (const [objectType, table] of CLEANUP_ORDER) {
    for (const object of manifest.objects.filter(entry => entry.objectType === objectType)) {
      if (object.cleanupOwnership !== 'manifest') continue;
      if (!(await objectExists(api, table, object.exactId))) {
        object.cleanupState = 'absent';
        alreadyAbsent += 1;
        continue;
      }
      const result = await api.rest('DELETE', table, {
        query: `id=eq.${encodeURIComponent(object.exactId)}`,
        prefer: 'return=minimal',
      });
      if (!result.ok || await objectExists(api, table, object.exactId)) {
        failures.push(object.fixtureKey);
      } else {
        object.cleanupState = 'absent';
      }
      await writeDevelopmentManifest(manifestPath, manifest);
    }
  }

  for (const object of manifest.objects.filter(entry => entry.objectType === 'auth_user')) {
    if (object.cleanupOwnership !== 'manifest') continue;
    const result = await api.adminDeleteUser(object.exactId);
    if (result.ok || result.status === 404 || result.status === 422) {
      object.cleanupState = 'absent';
      if (!result.ok) alreadyAbsent += 1;
    } else {
      failures.push(object.fixtureKey);
    }
    await writeDevelopmentManifest(manifestPath, manifest);
  }

  const after = await captureDevelopmentFingerprints(api);
  const collateralDifferences = compareDevelopmentFingerprints(manifest.baseline, after);
  manifest.evidence.cleanup = {
    alreadyAbsent,
    failures: failures.length,
    collateralDifferences,
    after,
  };
  manifest.phase = failures.length || collateralDifferences.length ? 'cleanup_failed' : 'cleaned';
  await writeDevelopmentManifest(manifestPath, manifest);

  if (failures.length || collateralDifferences.length) {
    throw new Error(
      `Cleanup failed: ${failures.length} exact-ID removal failure(s), ${collateralDifferences.length} collateral fingerprint difference(s).`,
    );
  }
  logger.log(`Cleaned exact fixture IDs in ${maskProjectRef(config.projectRef)} (run ${maskUuid(manifest.runId)}; already absent ${alreadyAbsent}).`);
  return { cleaned: true, alreadyAbsent, collateralDifferences };
}
