import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { FixtureSafetyError } from './safety.mjs';

export const DEV_FIXTURE_KEY = 'tp3d-deployed-development-billing';
export const DEV_FIXTURE_VERSION = 1;
export const DEFAULT_DEV_MANIFEST_PATH = '.tp3d-fixtures/development-billing-manifest.json';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_TYPES = new Set([
  'fixture_run',
  'supabase_project',
  'auth_user',
  'profile',
  'organization',
  'organization_membership',
  'organization_invitation',
  'billing_customer_projection',
  'subscription_projection',
  'checkout_session_reference',
  'portal_session_reference',
]);
const MANIFEST_KEYS = new Set([
  'fixtureKey',
  'fixtureVersion',
  'runId',
  'environment',
  'projectRef',
  'phase',
  'createdAt',
  'updatedAt',
  'objects',
  'baseline',
  'evidence',
]);
const OBJECT_KEYS = new Set([
  'fixtureKey',
  'fixtureVersion',
  'objectType',
  'exactId',
  'cleanupOwnership',
  'creationState',
  'cleanupState',
]);

function invalid(code, message) {
  throw new FixtureSafetyError(code, `Invalid development fixture manifest: ${message}`);
}

export function resolveDevManifestPath(env = process.env) {
  const configured = String(env.TP3D_FIXTURE_MANIFEST_PATH || '').trim();
  return resolve(configured || DEFAULT_DEV_MANIFEST_PATH);
}

export function createDevelopmentManifest({ runId, projectRef, environment = 'dev' }) {
  if (!UUID_RE.test(runId)) invalid('invalid_run_id', 'run ID must be a UUID.');
  const now = new Date().toISOString();
  return {
    fixtureKey: DEV_FIXTURE_KEY,
    fixtureVersion: DEV_FIXTURE_VERSION,
    runId,
    environment,
    projectRef,
    phase: 'planned',
    createdAt: now,
    updatedAt: now,
    objects: [
      fixtureObject('run', 'fixture_run', runId, 'none', 'present', 'not_applicable'),
      fixtureObject('project', 'supabase_project', projectRef, 'none', 'present', 'not_applicable'),
    ],
    baseline: null,
    evidence: {},
  };
}

export function fixtureObject(
  fixtureKey,
  objectType,
  exactId,
  cleanupOwnership = 'manifest',
  creationState = 'created',
  cleanupState = 'pending',
) {
  return {
    fixtureKey,
    fixtureVersion: DEV_FIXTURE_VERSION,
    objectType,
    exactId: String(exactId),
    cleanupOwnership,
    creationState,
    cleanupState,
  };
}

export function addManifestObject(manifest, object) {
  validateFixtureObject(object);
  const existing = manifest.objects.find(entry => entry.fixtureKey === object.fixtureKey);
  if (existing) {
    if (existing.objectType !== object.objectType || existing.exactId !== object.exactId) {
      invalid('fixture_key_reuse', `fixture key ${object.fixtureKey} cannot change identity.`);
    }
    Object.assign(existing, object);
    return existing;
  }
  manifest.objects.push({ ...object });
  return object;
}

export function findManifestObject(manifest, fixtureKey) {
  return manifest.objects.find(entry => entry.fixtureKey === fixtureKey) || null;
}

export function findManifestObjects(manifest, objectType) {
  return manifest.objects.filter(entry => entry.objectType === objectType);
}

export function validateDevelopmentManifest(manifest, expected = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    invalid('invalid_manifest', 'root must be an object.');
  }
  if (Object.keys(manifest).some(key => !MANIFEST_KEYS.has(key))) {
    invalid('unexpected_manifest_key', 'manifest contains an unsupported field.');
  }
  if (manifest.fixtureKey !== DEV_FIXTURE_KEY || manifest.fixtureVersion !== DEV_FIXTURE_VERSION) {
    invalid('fixture_version_mismatch', 'fixture key or version is unsupported.');
  }
  if (!UUID_RE.test(String(manifest.runId || ''))) invalid('invalid_run_id', 'run ID must be a UUID.');
  if (manifest.environment !== 'dev') invalid('environment_mismatch', 'environment must equal dev.');
  if (!Array.isArray(manifest.objects)) invalid('invalid_objects', 'objects must be an array.');
  manifest.objects.forEach(validateFixtureObject);
  const keys = new Set();
  for (const object of manifest.objects) {
    if (keys.has(object.fixtureKey)) invalid('duplicate_fixture_key', 'fixture keys must be unique.');
    keys.add(object.fixtureKey);
  }
  if (expected.projectRef && manifest.projectRef !== expected.projectRef) {
    invalid('project_mismatch', 'manifest belongs to another Supabase project.');
  }
  if (expected.environment && manifest.environment !== expected.environment) {
    invalid('environment_mismatch', 'manifest belongs to another environment.');
  }
  return manifest;
}

function validateFixtureObject(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    invalid('invalid_object', 'fixture object must be an object.');
  }
  if (Object.keys(object).some(key => !OBJECT_KEYS.has(key))) {
    invalid('unexpected_object_key', 'fixture object contains an unsupported field.');
  }
  if (!String(object.fixtureKey || '').trim()) invalid('invalid_fixture_key', 'fixture key is required.');
  if (object.fixtureVersion !== DEV_FIXTURE_VERSION) invalid('fixture_version_mismatch', 'object version is unsupported.');
  if (!OBJECT_TYPES.has(object.objectType)) invalid('invalid_object_type', 'object type is unsupported.');
  if (!String(object.exactId || '').trim()) invalid('missing_exact_id', 'exact object ID is required.');
  if (!['manifest', 'none'].includes(object.cleanupOwnership)) {
    invalid('invalid_cleanup_ownership', 'cleanup ownership is unsupported.');
  }
}

export async function readDevelopmentManifest(path, expected = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') invalid('manifest_missing', 'manifest file does not exist.');
    invalid('manifest_read_failed', 'manifest could not be read.');
  }
  return validateDevelopmentManifest(parsed, expected);
}

export async function writeDevelopmentManifest(path, manifest) {
  validateDevelopmentManifest(manifest);
  manifest.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
