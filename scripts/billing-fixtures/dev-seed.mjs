import { randomBytes, randomUUID } from 'node:crypto';

import { maskProjectRef, maskUuid } from './mask.mjs';
import {
  addManifestObject,
  createDevelopmentManifest,
  fixtureObject,
  writeDevelopmentManifest,
} from './dev-manifest.mjs';
import { captureDevelopmentFingerprints } from './dev-invoke.mjs';

export const FULL_FIXTURE_ROLES = Object.freeze(['owner', 'admin', 'member', 'unrelated', 'invite-target']);

export function fixtureEmail(runId, role) {
  return `tp3d-fixture+${runId}-${role}@fixtures.tp3d.test`;
}

export function generateFixturePassword() {
  return `T!${randomBytes(24).toString('base64url')}9a`;
}

async function waitForTriggeredGraph(api, userId, { attempts = 20, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const memberships = await api.rest('GET', 'organization_members', {
      query: `select=id,organization_id,user_id,role&user_id=eq.${encodeURIComponent(userId)}&role=eq.owner`,
    });
    const profiles = await api.rest('GET', 'profiles', {
      query: `select=id,current_organization_id&id=eq.${encodeURIComponent(userId)}`,
    });
    if (memberships.ok && profiles.ok && memberships.body?.length === 1 && profiles.body?.length === 1) {
      const membership = memberships.body[0];
      const organizationId = String(membership.organization_id || '');
      const organizations = await api.rest('GET', 'organizations', {
        query: `select=id,owner_id,archived_at&id=eq.${encodeURIComponent(organizationId)}`,
      });
      const billing = await api.rest('GET', 'billing_customers', {
        query: `select=id,organization_id,status,trial_ends_at,stripe_customer_id,stripe_subscription_id&organization_id=eq.${encodeURIComponent(organizationId)}`,
      });
      if (organizations.ok && organizations.body?.length === 1 && billing.ok && billing.body?.length === 1) {
        return {
          profile: profiles.body[0],
          membership,
          organization: organizations.body[0],
          billing: billing.body[0],
        };
      }
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error('Signup trigger graph did not become ready.');
}

export async function seedDevelopmentFixtures({
  api,
  config,
  manifestPath,
  roles = FULL_FIXTURE_ROLES,
  logger = console,
}) {
  const runId = randomUUID();
  const manifest = createDevelopmentManifest({ runId, projectRef: config.projectRef });
  manifest.baseline = await captureDevelopmentFingerprints(api);
  await writeDevelopmentManifest(manifestPath, manifest);

  for (const role of roles) {
    const email = fixtureEmail(runId, role);
    const password = generateFixturePassword();
    const created = await api.adminCreateUser({ email, password });
    const userId = String(created?.id || created?.user?.id || '');
    if (!userId) throw new Error('Auth user creation returned no ID.');
    addManifestObject(manifest, fixtureObject(`${role}.auth_user`, 'auth_user', userId));
    await writeDevelopmentManifest(manifestPath, manifest);

    const graph = await waitForTriggeredGraph(api, userId);
    const organizationId = String(graph.organization.id);
    addManifestObject(manifest, fixtureObject(`${role}.profile`, 'profile', String(graph.profile.id)));
    addManifestObject(manifest, fixtureObject(`${role}.organization`, 'organization', organizationId));
    addManifestObject(
      manifest,
      fixtureObject(`${role}.owner_membership`, 'organization_membership', String(graph.membership.id)),
    );
    addManifestObject(
      manifest,
      fixtureObject(`${role}.billing_customer`, 'billing_customer_projection', String(graph.billing.id)),
    );
    await writeDevelopmentManifest(manifestPath, manifest);

    const jwt = await api.signInWithPassword(email, password);
    if (!jwt) throw new Error('Fixture JWT proof failed.');
  }

  manifest.phase = 'seeded';
  manifest.evidence.seededRoleCount = roles.length;
  await writeDevelopmentManifest(manifestPath, manifest);
  logger.log(`Seeded ${roles.length} disposable fixture user(s) in ${maskProjectRef(config.projectRef)} (run ${maskUuid(runId)}).`);
  return manifest;
}
