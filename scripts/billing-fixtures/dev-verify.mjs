import { maskProjectRef, maskUuid } from './mask.mjs';
import { findManifestObjects, writeDevelopmentManifest } from './dev-manifest.mjs';

const TABLE_BY_TYPE = Object.freeze({
  profile: 'profiles',
  organization: 'organizations',
  organization_membership: 'organization_members',
  organization_invitation: 'organization_invites',
  billing_customer_projection: 'billing_customers',
  subscription_projection: 'subscriptions',
});

export async function verifyDevelopmentFixtures({ api, config, manifest, manifestPath, logger = console }) {
  const missing = [];
  for (const object of manifest.objects) {
    if (object.cleanupOwnership !== 'manifest' || object.cleanupState === 'absent') continue;
    if (object.objectType === 'auth_user') {
      const result = await api.request(
        `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(object.exactId)}`,
        { headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` } },
      );
      if (!result.ok) missing.push(object.fixtureKey);
      continue;
    }
    const table = TABLE_BY_TYPE[object.objectType];
    if (!table) continue;
    const result = await api.rest('GET', table, {
      query: `select=id&id=eq.${encodeURIComponent(object.exactId)}`,
    });
    if (!result.ok || !Array.isArray(result.body) || result.body.length !== 1) missing.push(object.fixtureKey);
  }
  if (missing.length) throw new Error(`Exact-ID verification failed for ${missing.length} fixture object(s).`);

  const owners = findManifestObjects(manifest, 'auth_user').length;
  manifest.phase = 'verified';
  manifest.evidence.lastVerifiedObjectCount = manifest.objects.filter(object => object.cleanupOwnership === 'manifest').length;
  await writeDevelopmentManifest(manifestPath, manifest);
  logger.log(`Verified exact fixture IDs in ${maskProjectRef(config.projectRef)} (run ${maskUuid(manifest.runId)}, users ${owners}).`);
  return { verified: true, objectCount: manifest.evidence.lastVerifiedObjectCount };
}
