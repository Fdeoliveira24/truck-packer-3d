import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runStripeFixtureCli } from '../../../scripts/billing-fixtures/stripe-cli.mjs';
import {
  APPROVED_STRIPE_FIXTURE_PROJECT_REF,
  requireStripeFixtureConfirmation,
  validateStripeFixtureEnvironment,
} from '../../../scripts/billing-fixtures/stripe-environment.mjs';
import {
  addStripeManifestObject,
  createStripeManifest,
  readStripeManifest,
  stripeFixtureObject,
  writeStripeManifest,
} from '../../../scripts/billing-fixtures/stripe-manifest.mjs';
import { maskFixtureDiagnostic } from '../../../scripts/billing-fixtures/mask.mjs';
import {
  REQUIRED_STRIPE_WEBHOOK_EVENTS,
  STRIPE_SIGNED_PROBE_EVENT,
} from '../../../scripts/billing-fixtures/stripe-webhook.mjs';

const PROJECT_REF = APPROVED_STRIPE_FIXTURE_PROJECT_REF;

function safeEnv(overrides = {}) {
  return {
    TP3D_FIXTURE_ENV: 'stripe-test',
    TP3D_FIXTURE_ALLOWED_PROJECT_REFS: PROJECT_REF,
    SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-secret',
    SUPABASE_ANON_KEY: 'fixture-anon-secret',
    STRIPE_SECRET_KEY: 'sk_test_fixture_secret',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture_secret',
    STRIPE_PRICE_PRO_MONTHLY: 'price_fixture_monthly',
    STRIPE_PRICE_PRO_YEARLY: 'price_fixture_yearly',
    ...overrides,
  };
}

test('S1 requires the exact stripe-test environment', () => {
  assert.throws(() => validateStripeFixtureEnvironment(safeEnv({ TP3D_FIXTURE_ENV: 'dev' })), {
    code: 'invalid_fixture_environment',
  });
});

test('S1 accepts only the approved allowlisted development project', () => {
  const config = validateStripeFixtureEnvironment(safeEnv());
  assert.equal(config.projectRef, PROJECT_REF);
  assert.throws(() => validateStripeFixtureEnvironment(safeEnv({
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    TP3D_FIXTURE_ALLOWED_PROJECT_REFS: 'abcdefghijklmnopqrst',
  })), { code: 'unapproved_development_project' });
});

test('S1 refuses an unknown project that is not allowlisted', () => {
  assert.throws(() => validateStripeFixtureEnvironment(safeEnv({
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  })), { code: 'project_not_allowlisted' });
});

test('S1 refuses a known production project even when allowlisted', () => {
  const productionRef = 'abcdefghijklmnopqrst';
  assert.throws(() => validateStripeFixtureEnvironment(safeEnv({
    SUPABASE_URL: `https://${productionRef}.supabase.co`,
    TP3D_FIXTURE_ALLOWED_PROJECT_REFS: productionRef,
  }), {
    approvedProjectRef: productionRef,
    knownProductionProjectRefs: [productionRef],
  }), { code: 'production_project' });
});

test('S1 hard-stops live and non-test Stripe keys', () => {
  assert.throws(() => validateStripeFixtureEnvironment(safeEnv({
    STRIPE_SECRET_KEY: 'sk_live_fixture_secret',
  })), { code: 'live_stripe_key' });
  assert.throws(() => validateStripeFixtureEnvironment(safeEnv({
    STRIPE_SECRET_KEY: 'rk_test_fixture_secret',
  })), { code: 'stripe_not_test_mode' });
});

test('S1 uses the exact development endpoint without retaining a webhook signing secret', () => {
  const config = validateStripeFixtureEnvironment(safeEnv({ STRIPE_WEBHOOK_SECRET: '' }));
  assert.equal(config.functionsUrl, `https://${PROJECT_REF}.supabase.co/functions/v1`);
  assert.equal(Object.hasOwn(config, 'webhookSecret'), false);
});

test('S1 webhook coverage includes the S2/S3 matrix and a disposable signed probe event', () => {
  assert.deepEqual(REQUIRED_STRIPE_WEBHOOK_EVENTS, [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.deleted',
    'customer.subscription.updated',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.payment_succeeded',
  ]);
  assert.equal(STRIPE_SIGNED_PROBE_EVENT, 'test_helpers.test_clock.created');
});

test('S1 seed and cleanup require explicit confirmation', () => {
  assert.throws(() => requireStripeFixtureConfirmation([], 'probe'), { code: 'confirmation_required' });
  assert.throws(() => requireStripeFixtureConfirmation([], 'seed'), { code: 'confirmation_required' });
  assert.throws(() => requireStripeFixtureConfirmation([], 'cleanup'), { code: 'confirmation_required' });
  assert.throws(() => requireStripeFixtureConfirmation([], 'safety'), { code: 'confirmation_required' });
  assert.doesNotThrow(() => requireStripeFixtureConfirmation(['--confirm'], 'probe'));
  assert.doesNotThrow(() => requireStripeFixtureConfirmation(['--confirm'], 'seed'));
  assert.doesNotThrow(() => requireStripeFixtureConfirmation(['--confirm'], 'cleanup'));
  assert.doesNotThrow(() => requireStripeFixtureConfirmation(['--confirm'], 'safety'));
});

test('S1 manifest binds environment, project, account, and run', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tp3d-stripe-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'manifest.json');
  const manifest = createStripeManifest({
    runId: '123e4567-e89b-42d3-a456-426614174000',
    projectRef: PROJECT_REF,
    stripeAccountId: 'acct_fixtureaccount123',
  });
  await writeStripeManifest(path, manifest);
  await assert.doesNotReject(() => readStripeManifest(path, {
    environment: 'stripe-test',
    projectRef: PROJECT_REF,
    stripeAccountId: 'acct_fixtureaccount123',
  }));
  await assert.rejects(() => readStripeManifest(path, { projectRef: 'abcdefghijklmnopqrst' }), {
    code: 'project_mismatch',
  });
  await assert.rejects(() => readStripeManifest(path, { stripeAccountId: 'acct_otheraccount123' }), {
    code: 'stripe_account_mismatch',
  });
});

test('S1 manifest object identities are immutable and exact-ID owned', () => {
  const manifest = createStripeManifest({
    runId: '123e4567-e89b-42d3-a456-426614174000',
    projectRef: PROJECT_REF,
    stripeAccountId: 'acct_fixtureaccount123',
  });
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('fixture.customer', 'stripe', 'stripe_customer', 'cus_fixtureone123', 'delete'),
  );
  assert.equal(manifest.objects.at(-1).cleanupAuthority, 'manifest-exact-id');
  assert.throws(() => addStripeManifestObject(
    manifest,
    stripeFixtureObject('fixture.customer', 'stripe', 'stripe_customer', 'cus_fixturetwo123', 'delete'),
  ), { code: 'fixture_key_reuse' });
});

test('S1 manifest allows one exact ID to represent distinct Supabase object types', () => {
  const manifest = createStripeManifest({
    runId: '123e4567-e89b-42d3-a456-426614174000',
    projectRef: PROJECT_REF,
    stripeAccountId: 'acct_fixtureaccount123',
  });
  const sharedId = '123e4567-e89b-42d3-a456-426614174001';
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('fixture.auth', 'supabase', 'auth_user', sharedId, 'delete'),
  );
  assert.doesNotThrow(() => addStripeManifestObject(
    manifest,
    stripeFixtureObject('fixture.profile', 'supabase', 'profile', sharedId, 'delete'),
  ));
});

test('S1 plan performs read-only checks and zero writes', async () => {
  let readChecks = 0;
  let writes = 0;
  const loggerOutput = [];
  const result = await runStripeFixtureCli({
    argv: ['plan'],
    env: safeEnv(),
    logger: { log: value => loggerOutput.push(value) },
    apiFactory: () => ({
      stripe: {},
      supabase: new Proxy({}, { get: () => () => { writes += 1; } }),
    }),
    readOnlyVerifier: async () => { readChecks += 1; return {}; },
  });
  assert.deepEqual(result, { command: 'plan', dryRun: true, writes: 0 });
  assert.equal(readChecks, 1);
  assert.equal(writes, 0);
  assert.doesNotMatch(loggerOutput.join('\n'), /sk_test|whsec|fixture-service-role-secret/);
});

test('S1 diagnostics mask secrets, JWTs, IDs, UUIDs, and emails', () => {
  const raw = [
    'sk_test_fixturesecret123',
    'whsec_fixturesecret123',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature123',
    'sub_fixtureidentifier123',
    '123e4567-e89b-42d3-a456-426614174000',
    'fixture-owner@example.test',
  ].join(' ');
  const masked = maskFixtureDiagnostic(raw);
  for (const value of raw.split(' ')) assert.doesNotMatch(masked, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('S1 Stripe scripts contain no deployment, linking, migration, reset, or broad cleanup command', async () => {
  const files = [
    'stripe-cli.mjs',
    'stripe-cleanup.mjs',
    'stripe-environment.mjs',
    'stripe-invoke.mjs',
    'stripe-manifest.mjs',
    'stripe-seed.mjs',
    'stripe-verify.mjs',
    'stripe-webhook.mjs',
  ];
  const source = (await Promise.all(files.map(file => readFile(
    new URL(`../../../scripts/billing-fixtures/${file}`, import.meta.url),
    'utf8',
  )))).join('\n');
  assert.doesNotMatch(source, /supabase\s+link|db\s+push|migration\s+apply|functions?\s+deploy|production\s+reset/i);
  assert.doesNotMatch(source, /delete.*(?:prefix|name)|(?:prefix|name).*delete/i);
  assert.doesNotMatch(source, /owner_id=is\.null|created_at=gte/i);

  const packageJson = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts.test, 'node --test tests/audit/*.spec.mjs');
  assert.doesNotMatch(packageJson.scripts.test, /stripe|fixture|integration/);
  assert.equal(packageJson.scripts['billing:fixtures:dev:seed'], 'node scripts/billing-fixtures/dev-cli.mjs seed');
  assert.equal(packageJson.scripts['test:billing:local'].includes('tests/local-db/'), true);
});

test('S1 fixture runtime never constructs or logs a webhook signing secret', async () => {
  const source = await readFile(
    new URL('../../../scripts/billing-fixtures/stripe-webhook.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /createHmac|stripe-signature|STRIPE_WEBHOOK_SECRET|whsec_/);
  assert.match(source, /row\?\.status === 'processed'/);
  assert.match(source, /accepted development webhook delivery/);
});
