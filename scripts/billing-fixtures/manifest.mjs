import { randomUUID } from 'node:crypto';

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXTURE_KEY_RE = /^tp3d\.billing\.[a-z0-9-]+\.[a-z0-9-]+$/;
const STRIPE_CUSTOMER_RE = /^cus_[A-Za-z0-9]+$/;
const STRIPE_SUBSCRIPTION_RE = /^sub_[A-Za-z0-9]+$/;

const MANIFEST_KEYS = [
  'schemaVersion',
  'environment',
  'supabaseProjectRef',
  'fixtureRunId',
  'createdAt',
  'fixtures',
];

const FIXTURE_KEYS = [
  'fixtureKey',
  'fixtureVersion',
  'environment',
  'supabaseProjectRef',
  'fixtureRunId',
  'organizationId',
  'userIds',
  'stripeCustomerIds',
  'stripeSubscriptionIds',
  'fixtureType',
  'createdAt',
  'expectedCleanupOwnership',
  'scenarioClassification',
];

export const DEFAULT_FIXTURE_SCENARIOS = Object.freeze([
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.two-direct-siblings',
    fixtureVersion: 1,
    fixtureType: 'supabase-stripe',
    scenarioClassification: 'stripe-sandbox-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.newest-direct-outside-slots',
    fixtureVersion: 1,
    fixtureType: 'supabase-stripe',
    scenarioClassification: 'stripe-sandbox-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.active-trialing-siblings',
    fixtureVersion: 1,
    fixtureType: 'supabase-stripe',
    scenarioClassification: 'stripe-sandbox-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.paid-canceled-sibling',
    fixtureVersion: 1,
    fixtureType: 'supabase-stripe',
    scenarioClassification: 'cross-system-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.archived-paid-sibling',
    fixtureVersion: 1,
    fixtureType: 'supabase-stripe',
    scenarioClassification: 'cross-system-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.coupon-active',
    fixtureVersion: 1,
    fixtureType: 'stripe',
    scenarioClassification: 'stripe-sandbox-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.duplicate-direct-mapping',
    fixtureVersion: 1,
    fixtureType: 'supabase',
    scenarioClassification: 'destructive-fixture-review-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.conflicting-org-binding',
    fixtureVersion: 1,
    fixtureType: 'supabase-stripe',
    scenarioClassification: 'destructive-fixture-review-required',
  }),
  Object.freeze({
    fixtureKey: 'tp3d.billing.f12.unpaid-owner-coverage',
    fixtureVersion: 1,
    fixtureType: 'supabase',
    scenarioClassification: 'local-db-candidate',
  }),
]);

export class ManifestValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManifestValidationError';
    this.code = code;
  }
}

function invalid(code, message) {
  throw new ManifestValidationError(code, `Invalid fixture manifest: ${message}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value || {}).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validateIdList(value, pattern, code, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !pattern.test(item))) {
    invalid(code, `${label} must contain valid immutable identifiers only.`);
  }
}

export function validateFixtureManifest(manifest, expectedBinding = {}) {
  if (!manifest || typeof manifest !== 'object' || !hasExactKeys(manifest, MANIFEST_KEYS)) {
    invalid('invalid_manifest_shape', 'top-level structure is not recognized.');
  }
  if (manifest.schemaVersion !== 1) invalid('invalid_schema_version', 'schemaVersion must equal 1.');
  if (manifest.environment !== 'dev') invalid('invalid_environment', 'environment must equal dev.');
  if (!PROJECT_REF_RE.test(manifest.supabaseProjectRef || '')) {
    invalid('invalid_project_ref', 'Supabase project reference is malformed.');
  }
  if (!UUID_RE.test(manifest.fixtureRunId || '')) invalid('invalid_run_id', 'fixture run ID is malformed.');
  if (!validIsoTimestamp(manifest.createdAt)) invalid('invalid_created_at', 'creation timestamp is malformed.');
  if (expectedBinding.environment !== manifest.environment) {
    invalid('environment_mismatch', 'environment binding does not match the active safety context.');
  }
  if (expectedBinding.projectRef !== manifest.supabaseProjectRef) {
    invalid('project_mismatch', 'project binding does not match the active safety context.');
  }
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    invalid('missing_fixtures', 'at least one fixture scenario is required.');
  }

  const seenKeys = new Set();
  for (const fixture of manifest.fixtures) {
    if (!fixture || typeof fixture !== 'object' || !hasExactKeys(fixture, FIXTURE_KEYS)) {
      invalid('invalid_fixture_shape', 'fixture structure is not recognized.');
    }
    if (!FIXTURE_KEY_RE.test(fixture.fixtureKey || '')) {
      invalid('invalid_fixture_key', 'fixture key is malformed.');
    }
    if (seenKeys.has(fixture.fixtureKey)) invalid('duplicate_fixture_key', 'fixture keys must be unique.');
    seenKeys.add(fixture.fixtureKey);
    if (!Number.isInteger(fixture.fixtureVersion) || fixture.fixtureVersion < 1) {
      invalid('invalid_fixture_version', 'fixtureVersion must be a positive integer.');
    }
    if (fixture.environment !== manifest.environment || fixture.environment !== expectedBinding.environment) {
      invalid('environment_mismatch', 'fixture environment binding does not match.');
    }
    if (
      fixture.supabaseProjectRef !== manifest.supabaseProjectRef ||
      fixture.supabaseProjectRef !== expectedBinding.projectRef
    ) {
      invalid('project_mismatch', 'fixture project binding does not match.');
    }
    if (fixture.fixtureRunId !== manifest.fixtureRunId) invalid('run_id_mismatch', 'fixture run ID does not match.');
    if (fixture.createdAt !== manifest.createdAt) invalid('created_at_mismatch', 'fixture timestamp does not match.');
    if (fixture.organizationId !== null && !UUID_RE.test(fixture.organizationId || '')) {
      invalid('invalid_organization_id', 'organization ID must be null or a UUID.');
    }
    validateIdList(fixture.userIds, UUID_RE, 'invalid_user_ids', 'userIds');
    validateIdList(fixture.stripeCustomerIds, STRIPE_CUSTOMER_RE, 'invalid_customer_ids', 'stripeCustomerIds');
    validateIdList(
      fixture.stripeSubscriptionIds,
      STRIPE_SUBSCRIPTION_RE,
      'invalid_subscription_ids',
      'stripeSubscriptionIds',
    );
    if (typeof fixture.fixtureType !== 'string' || !/^[a-z][a-z-]+$/.test(fixture.fixtureType)) {
      invalid('invalid_fixture_type', 'fixtureType is malformed.');
    }
    if (fixture.expectedCleanupOwnership !== 'manifest-ids-only') {
      invalid('invalid_cleanup_ownership', 'cleanup ownership must be manifest-ids-only.');
    }
    if (
      typeof fixture.scenarioClassification !== 'string' ||
      !/^[a-z][a-z-]+$/.test(fixture.scenarioClassification)
    ) {
      invalid('invalid_scenario_classification', 'scenario classification is malformed.');
    }
  }

  return manifest;
}

export function createFixtureManifest({
  environment,
  projectRef,
  fixtureRunId = randomUUID(),
  createdAt = new Date().toISOString(),
  scenarios = DEFAULT_FIXTURE_SCENARIOS,
} = {}) {
  const fixtures = scenarios.map(scenario => ({
    fixtureKey: scenario.fixtureKey,
    fixtureVersion: scenario.fixtureVersion,
    environment,
    supabaseProjectRef: projectRef,
    fixtureRunId,
    organizationId: null,
    userIds: [],
    stripeCustomerIds: [],
    stripeSubscriptionIds: [],
    fixtureType: scenario.fixtureType,
    createdAt,
    expectedCleanupOwnership: 'manifest-ids-only',
    scenarioClassification: scenario.scenarioClassification,
  }));
  const manifest = {
    schemaVersion: 1,
    environment,
    supabaseProjectRef: projectRef,
    fixtureRunId,
    createdAt,
    fixtures,
  };
  validateFixtureManifest(manifest, { environment, projectRef });
  return deepFreeze(manifest);
}
