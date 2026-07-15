import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { runFixtureCommand } from '../../scripts/billing-fixtures/cli.mjs';
import {
  createFixtureManifest,
  validateFixtureManifest,
} from '../../scripts/billing-fixtures/manifest.mjs';
import {
  maskEmail,
  maskProjectRef,
  maskStripeId,
  maskUserId,
  maskUuid,
  redactSecret,
} from '../../scripts/billing-fixtures/mask.mjs';
import {
  parseSupabaseProjectRef,
  validateFixtureEnvironment,
} from '../../scripts/billing-fixtures/safety.mjs';

const SAFE_REF = 'abcdefghijklmnopqrst';
const OTHER_REF = 'tsrqponmlkjihgfedcba';
const SAFE_URL = `https://${SAFE_REF}.supabase.co`;

function safeEnv(overrides = {}) {
  return {
    TP3D_FIXTURE_ENV: 'dev',
    TP3D_FIXTURE_ALLOWED_PROJECT_REFS: SAFE_REF,
    SUPABASE_URL: SAFE_URL,
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

test('billing fixture safety rejects a missing fixture environment', () => {
  assert.throws(
    () => validateFixtureEnvironment(safeEnv({ TP3D_FIXTURE_ENV: undefined })),
    /TP3D_FIXTURE_ENV must equal dev/,
  );
});

test('billing fixture safety rejects every environment other than dev', () => {
  for (const value of ['test', 'staging', 'production', 'prod', 'DEV']) {
    assert.throws(() => validateFixtureEnvironment(safeEnv({ TP3D_FIXTURE_ENV: value })), /must equal dev/);
  }
});

test('billing fixture safety rejects a missing Supabase URL', () => {
  assert.throws(() => validateFixtureEnvironment(safeEnv({ SUPABASE_URL: undefined })), /SUPABASE_URL is required/);
});

test('billing fixture safety rejects malformed, local, credentialed, and non-project URLs', () => {
  for (const value of [
    'not-a-url',
    'http://127.0.0.1:54321',
    `http://${SAFE_REF}.supabase.co`,
    `https://user:secret@${SAFE_REF}.supabase.co`,
    `https://${SAFE_REF}.functions.supabase.co`,
    `https://${SAFE_REF}.supabase.co/rest/v1`,
  ]) {
    assert.throws(() => parseSupabaseProjectRef(value), /hosted Supabase project URL/);
  }
});

test('billing fixture safety rejects a project that is not explicitly allowlisted', () => {
  assert.throws(
    () => validateFixtureEnvironment(safeEnv({ TP3D_FIXTURE_ALLOWED_PROJECT_REFS: OTHER_REF })),
    /Supabase project is not allowlisted/,
  );
});

test('billing fixture safety accepts an allowlisted hosted dev project for dry-run use', () => {
  const result = validateFixtureEnvironment(safeEnv());
  assert.deepEqual(result, { environment: 'dev', projectRef: SAFE_REF, stripeMode: 'not-configured' });
});

test('billing fixture safety refuses a known production ref even when allowlisted', () => {
  assert.throws(
    () => validateFixtureEnvironment(safeEnv(), { knownProductionProjectRefs: [SAFE_REF] }),
    /Known production Supabase projects are never allowed/,
  );
});

test('billing fixture safety rejects live and non-test Stripe keys without echoing them', () => {
  for (const key of ['sk_live_do_not_log_this', 'rk_test_not_a_secret_key', 'secret_value']) {
    assert.throws(
      () => validateFixtureEnvironment(safeEnv({ STRIPE_SECRET_KEY: key })),
      error => error.message.includes('Stripe key is not test mode') && !error.message.includes(key),
    );
  }
});

test('billing fixture safety accepts a test-mode Stripe key without returning it', () => {
  const key = 'sk_test_do_not_print_this';
  const result = validateFixtureEnvironment(safeEnv({ STRIPE_SECRET_KEY: key }));
  assert.equal(result.stripeMode, 'test');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(key));
});

test('billing fixture safety permits DB-only planning without a Stripe key', () => {
  const result = validateFixtureEnvironment(safeEnv({ STRIPE_SECRET_KEY: undefined }));
  assert.equal(result.stripeMode, 'not-configured');
});

test('fixture manifest rejects cross-project reuse', () => {
  const manifest = createFixtureManifest({ environment: 'dev', projectRef: SAFE_REF });
  assert.throws(
    () => validateFixtureManifest(manifest, { environment: 'dev', projectRef: OTHER_REF }),
    /project binding does not match/,
  );
});

test('fixture manifest rejects cross-environment reuse', () => {
  const manifest = createFixtureManifest({ environment: 'dev', projectRef: SAFE_REF });
  assert.throws(
    () => validateFixtureManifest(manifest, { environment: 'staging', projectRef: SAFE_REF }),
    /environment binding does not match/,
  );
});

test('fixture manifest rejects duplicate stable fixture keys', () => {
  const manifest = clone(createFixtureManifest({ environment: 'dev', projectRef: SAFE_REF }));
  manifest.fixtures[1].fixtureKey = manifest.fixtures[0].fixtureKey;
  assert.throws(
    () => validateFixtureManifest(manifest, { environment: 'dev', projectRef: SAFE_REF }),
    /fixture keys must be unique/,
  );
});

test('fixture manifest rejects invalid fixture versions', () => {
  const manifest = clone(createFixtureManifest({ environment: 'dev', projectRef: SAFE_REF }));
  manifest.fixtures[0].fixtureVersion = 0;
  assert.throws(
    () => validateFixtureManifest(manifest, { environment: 'dev', projectRef: SAFE_REF }),
    /fixtureVersion must be a positive integer/,
  );
});

test('fixture manifests are deeply immutable and run IDs are unique', () => {
  const first = createFixtureManifest({ environment: 'dev', projectRef: SAFE_REF });
  const second = createFixtureManifest({ environment: 'dev', projectRef: SAFE_REF });
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.fixtures));
  assert.ok(Object.isFrozen(first.fixtures[0]));
  assert.notEqual(first.fixtureRunId, second.fixtureRunId);
  assert.throws(() => { first.fixtures[0].organizationId = 'changed'; }, TypeError);
});

test('masking helpers never disclose complete identifiers, emails, or secrets', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const customer = 'cus_customerabcdef1234';
  const subscription = 'sub_subscriptionabcd9876';
  const email = 'fixture-user@example.test';
  const outputs = [
    maskProjectRef(SAFE_REF),
    maskUuid(uuid),
    maskUserId(uuid),
    maskStripeId(customer),
    maskStripeId(subscription),
    maskEmail(email),
    redactSecret('sk_test_never_print'),
  ];
  const joined = outputs.join('\n');
  for (const raw of [SAFE_REF, uuid, customer, subscription, email, 'sk_test_never_print']) {
    assert.ok(!joined.includes(raw), `masked output must not include ${raw}`);
  }
  assert.equal(maskUuid(null), '[invalid-uuid]');
  assert.equal(maskStripeId('sub_x'), '[invalid-stripe-id]');
  assert.equal(maskEmail('malformed'), '[invalid-email]');
});

test('plan command performs no network call and prints masked no-write output', () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => {
    networkCalls += 1;
    throw new Error('network access is forbidden');
  };
  try {
    const output = [];
    const result = runFixtureCommand({ command: 'plan', env: safeEnv(), writeLine: line => output.push(line) });
    assert.equal(networkCalls, 0);
    assert.equal(result.manifest.fixtures.length, 9);
    assert.match(output.join('\n'), /NO WRITES/);
    assert.match(output.join('\n'), /Network access: not used/);
    assert.match(output.join('\n'), /Database\/Stripe writes: not implemented/);
    assert.ok(!output.join('\n').includes(SAFE_REF), 'raw project ref must stay masked');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('future seed, reset, and cleanup commands hard-fail before any write surface', () => {
  for (const command of ['seed', 'reset', 'cleanup']) {
    assert.throws(
      () => runFixtureCommand({ command, env: safeEnv(), writeLine: () => {} }),
      /Fixture writes are not implemented in the safety-foundation branch/,
    );
  }
});

test('fixture tooling imports no Supabase or Stripe client and contains no network/write primitive', async () => {
  const paths = [
    '../../scripts/billing-fixtures/cli.mjs',
    '../../scripts/billing-fixtures/safety.mjs',
    '../../scripts/billing-fixtures/manifest.mjs',
    '../../scripts/billing-fixtures/mask.mjs',
  ];
  const sources = await Promise.all(paths.map(path => fs.readFile(new URL(path, import.meta.url), 'utf8')));
  const source = sources.join('\n');
  assert.doesNotMatch(source, /from\s+['"](?:@supabase|stripe|node:https|node:http)/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\.(?:insert|update|upsert|delete|rpc)\s*\(|auth\.admin/);
  assert.doesNotMatch(source, /billing-status\/index|stripe-create-|stripe-webhook|org-transfer-ownership/);
});

test('environment example uses a fake test-mode Stripe placeholder', async () => {
  const source = await fs.readFile(new URL('../../supabase/functions/.env.example', import.meta.url), 'utf8');
  assert.match(source, /^STRIPE_SECRET_KEY=sk_test_replace_me$/m);
  assert.doesNotMatch(source, /^STRIPE_SECRET_KEY=sk_live_/m);
});
