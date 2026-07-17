import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { FixtureSafetyError } from './safety.mjs';

export const STRIPE_FIXTURE_KEY = 'tp3d-stripe-test-billing';
export const STRIPE_FIXTURE_VERSION = 1;
export const DEFAULT_STRIPE_MANIFEST_PATH = '.tp3d-fixtures/stripe-billing-manifest.json';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYSTEMS = new Set(['stripe', 'supabase']);
const CLEANUP_ACTIONS = new Set(['archive', 'cancel', 'delete', 'detach', 'expire', 'none']);
const OBJECT_TYPES = new Set([
  'stripe_account',
  'stripe_webhook_endpoint',
  'stripe_customer',
  'stripe_subscription',
  'stripe_payment_method',
  'stripe_invoice',
  'stripe_payment_intent',
  'stripe_charge',
  'stripe_balance_transaction',
  'stripe_price',
  'stripe_product',
  'stripe_coupon',
  'stripe_schedule',
  'stripe_test_clock',
  'stripe_checkout_session',
  'stripe_portal_session',
  'stripe_event',
  'auth_user',
  'profile',
  'organization',
  'organization_membership',
  'billing_customer_projection',
  'subscription_projection',
  'stripe_customer_projection',
  'webhook_event',
]);

function invalid(code, message) {
  throw new FixtureSafetyError(code, `Invalid Stripe fixture manifest: ${message}`);
}

export function resolveStripeManifestPath(env = process.env) {
  return resolve(String(env.TP3D_STRIPE_FIXTURE_MANIFEST_PATH || '').trim() || DEFAULT_STRIPE_MANIFEST_PATH);
}

export function stripeFixtureObject(
  fixtureKey,
  system,
  objectType,
  exactId,
  cleanupAction,
  creationState = 'created',
  cleanupState = 'pending',
) {
  return {
    fixtureKey,
    fixtureVersion: STRIPE_FIXTURE_VERSION,
    system,
    objectType,
    exactId: String(exactId),
    cleanupAuthority: 'manifest-exact-id',
    cleanupAction,
    creationState,
    cleanupState,
  };
}

export function createStripeManifest({ runId, projectRef, stripeAccountId }) {
  if (!UUID_RE.test(String(runId || ''))) invalid('invalid_run_id', 'run ID must be a UUID.');
  if (!String(stripeAccountId || '').startsWith('acct_')) {
    invalid('invalid_stripe_account', 'Stripe account ID is required.');
  }
  const now = new Date().toISOString();
  return {
    fixtureKey: STRIPE_FIXTURE_KEY,
    fixtureVersion: STRIPE_FIXTURE_VERSION,
    runId,
    environment: 'stripe-test',
    projectRef,
    stripeAccountId,
    phase: 'planned',
    createdAt: now,
    updatedAt: now,
    objects: [
      stripeFixtureObject('stripe.account', 'stripe', 'stripe_account', stripeAccountId, 'none', 'verified', 'not_applicable'),
    ],
    baseline: null,
    evidence: {},
  };
}

export function addStripeManifestObject(manifest, object) {
  validateStripeFixtureObject(object);
  const existing = manifest.objects.find(entry => entry.fixtureKey === object.fixtureKey);
  if (existing) {
    if (
      existing.system !== object.system ||
      existing.objectType !== object.objectType ||
      existing.exactId !== object.exactId
    ) {
      invalid('fixture_key_reuse', `fixture key ${object.fixtureKey} cannot change identity.`);
    }
    Object.assign(existing, object);
    return existing;
  }
  if (manifest.objects.some(entry =>
    entry.system === object.system &&
    entry.objectType === object.objectType &&
    entry.exactId === object.exactId)) {
    invalid('duplicate_object_id', 'object IDs must be unique within a system.');
  }
  manifest.objects.push({ ...object });
  return object;
}

export function findStripeManifestObject(manifest, fixtureKey) {
  return manifest.objects.find(entry => entry.fixtureKey === fixtureKey) || null;
}

export function findStripeManifestObjects(manifest, objectType) {
  return manifest.objects.filter(entry => entry.objectType === objectType);
}

export function validateStripeManifest(manifest, expected = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    invalid('invalid_manifest', 'root must be an object.');
  }
  if (manifest.fixtureKey !== STRIPE_FIXTURE_KEY || manifest.fixtureVersion !== STRIPE_FIXTURE_VERSION) {
    invalid('fixture_version_mismatch', 'fixture key or version is unsupported.');
  }
  if (!UUID_RE.test(String(manifest.runId || ''))) invalid('invalid_run_id', 'run ID must be a UUID.');
  if (manifest.environment !== 'stripe-test') invalid('environment_mismatch', 'environment must equal stripe-test.');
  if (!String(manifest.stripeAccountId || '').startsWith('acct_')) {
    invalid('invalid_stripe_account', 'Stripe account binding is malformed.');
  }
  if (!Array.isArray(manifest.objects)) invalid('invalid_objects', 'objects must be an array.');
  manifest.objects.forEach(validateStripeFixtureObject);
  const fixtureKeys = new Set();
  const objectKeys = new Set();
  for (const object of manifest.objects) {
    if (fixtureKeys.has(object.fixtureKey)) invalid('duplicate_fixture_key', 'fixture keys must be unique.');
    fixtureKeys.add(object.fixtureKey);
    const objectKey = `${object.system}:${object.objectType}:${object.exactId}`;
    if (objectKeys.has(objectKey)) invalid('duplicate_object_id', 'object IDs must be unique within a system.');
    objectKeys.add(objectKey);
  }
  if (expected.environment && expected.environment !== manifest.environment) {
    invalid('environment_mismatch', 'manifest belongs to another environment.');
  }
  if (expected.projectRef && expected.projectRef !== manifest.projectRef) {
    invalid('project_mismatch', 'manifest belongs to another Supabase project.');
  }
  if (expected.stripeAccountId && expected.stripeAccountId !== manifest.stripeAccountId) {
    invalid('stripe_account_mismatch', 'manifest belongs to another Stripe account.');
  }
  return manifest;
}

function validateStripeFixtureObject(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    invalid('invalid_object', 'fixture object must be an object.');
  }
  if (!String(object.fixtureKey || '').trim()) invalid('invalid_fixture_key', 'fixture key is required.');
  if (object.fixtureVersion !== STRIPE_FIXTURE_VERSION) invalid('fixture_version_mismatch', 'object version is unsupported.');
  if (!SYSTEMS.has(object.system)) invalid('invalid_system', 'object system is unsupported.');
  if (!OBJECT_TYPES.has(object.objectType)) invalid('invalid_object_type', 'object type is unsupported.');
  if (!String(object.exactId || '').trim()) invalid('missing_exact_id', 'exact object ID is required.');
  if (object.cleanupAuthority !== 'manifest-exact-id') {
    invalid('invalid_cleanup_authority', 'cleanup authority must be manifest-exact-id.');
  }
  if (!CLEANUP_ACTIONS.has(object.cleanupAction)) invalid('invalid_cleanup_action', 'cleanup action is unsupported.');
}

export async function readStripeManifest(path, expected = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') invalid('manifest_missing', 'manifest file does not exist.');
    invalid('manifest_read_failed', 'manifest could not be read.');
  }
  return validateStripeManifest(parsed, expected);
}

export async function writeStripeManifest(path, manifest) {
  validateStripeManifest(manifest);
  manifest.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
