import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPROVED_DEVELOPMENT_PROJECT_REF,
  requireExplicitConfirmation,
  validateDevelopmentFixtureEnvironment,
} from '../../scripts/billing-fixtures/dev-environment.mjs';
import {
  createDevelopmentManifest,
  readDevelopmentManifest,
  writeDevelopmentManifest,
} from '../../scripts/billing-fixtures/dev-manifest.mjs';
import { runDevelopmentFixtureCli } from '../../scripts/billing-fixtures/dev-cli.mjs';

const SERVICE_KEY = 'fixture-service-role-secret-never-log';
const BASE_ENV = Object.freeze({
  TP3D_FIXTURE_ENV: 'dev',
  SUPABASE_URL: `https://${APPROVED_DEVELOPMENT_PROJECT_REF}.supabase.co`,
  TP3D_FIXTURE_ALLOWED_PROJECT_REFS: APPROVED_DEVELOPMENT_PROJECT_REF,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
});

function assertRefused(code, callback) {
  assert.throws(callback, error => error?.code === code);
}

test('DEV-FIXTURE-D1-1 wrong environment is refused', () => {
  assertRefused('invalid_fixture_environment', () => validateDevelopmentFixtureEnvironment({
    ...BASE_ENV,
    TP3D_FIXTURE_ENV: 'production',
  }));
});

test('DEV-FIXTURE-D1-2 unknown hosted project is refused even when allowlisted', () => {
  const unknown = 'abcdefghijklmnopqrst';
  assertRefused('unapproved_development_project', () => validateDevelopmentFixtureEnvironment({
    ...BASE_ENV,
    SUPABASE_URL: `https://${unknown}.supabase.co`,
    TP3D_FIXTURE_ALLOWED_PROJECT_REFS: unknown,
  }));
});

test('DEV-FIXTURE-D1-3 known production project is refused before allowlist approval', () => {
  const production = 'ponmlkjihgfedcbazyxw';
  assertRefused('production_project', () => validateDevelopmentFixtureEnvironment({
    ...BASE_ENV,
    SUPABASE_URL: `https://${production}.supabase.co`,
    TP3D_FIXTURE_ALLOWED_PROJECT_REFS: production,
  }, { knownProductionProjectRefs: [production] }));
});

test('DEV-FIXTURE-D1-4 missing allowlist is refused', () => {
  assertRefused('project_not_allowlisted', () => validateDevelopmentFixtureEnvironment({
    ...BASE_ENV,
    TP3D_FIXTURE_ALLOWED_PROJECT_REFS: '',
  }));
});

test('DEV-FIXTURE-D1-5 missing service-role key is refused', () => {
  assertRefused('missing_service_role_key', () => validateDevelopmentFixtureEnvironment({
    ...BASE_ENV,
    SUPABASE_SERVICE_ROLE_KEY: '',
  }));
});

test('DEV-FIXTURE-D1-6 any present Stripe key is refused', () => {
  assertRefused('stripe_key_forbidden', () => validateDevelopmentFixtureEnvironment({
    ...BASE_ENV,
    STRIPE_SECRET_KEY: 'sk_test_still_forbidden_here',
  }));
});

test('DEV-FIXTURE-D1-7 plan is a zero-network dry run with masked logs', async () => {
  let networkCalls = 0;
  const lines = [];
  const result = await runDevelopmentFixtureCli({
    argv: ['plan'],
    env: BASE_ENV,
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error('network must not be reached');
    },
    logger: { log: line => lines.push(String(line)) },
  });
  assert.equal(result.dryRun, true);
  assert.equal(networkCalls, 0);
  const output = lines.join('\n');
  assert.doesNotMatch(output, new RegExp(APPROVED_DEVELOPMENT_PROJECT_REF));
  assert.doesNotMatch(output, new RegExp(SERVICE_KEY));
});

test('DEV-FIXTURE-D1-8 seed requires explicit confirmation', () => {
  assertRefused('confirmation_required', () => requireExplicitConfirmation([], 'seed'));
});

test('DEV-FIXTURE-D1-9 cleanup requires explicit confirmation', () => {
  assertRefused('confirmation_required', () => requireExplicitConfirmation([], 'cleanup'));
});

test('DEV-FIXTURE-D1-10 manifest cross-project reuse is refused', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tp3d-dev-manifest-'));
  const path = join(directory, 'manifest.json');
  try {
    const manifest = createDevelopmentManifest({
      runId: '11111111-1111-4111-8111-111111111111',
      projectRef: APPROVED_DEVELOPMENT_PROJECT_REF,
    });
    await writeDevelopmentManifest(path, manifest);
    await assert.rejects(
      readDevelopmentManifest(path, { projectRef: 'abcdefghijklmnopqrst' }),
      error => error?.code === 'project_mismatch',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('DEV-FIXTURE-D1-11 manifest cross-environment reuse is refused', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tp3d-dev-manifest-'));
  const path = join(directory, 'manifest.json');
  try {
    const manifest = createDevelopmentManifest({
      runId: '22222222-2222-4222-8222-222222222222',
      projectRef: APPROVED_DEVELOPMENT_PROJECT_REF,
    });
    await writeDevelopmentManifest(path, manifest);
    await assert.rejects(
      readDevelopmentManifest(path, { environment: 'production' }),
      error => error?.code === 'environment_mismatch',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('DEV-FIXTURE-D1-12 manifest rejects credentials and fixture source has no Stripe client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tp3d-dev-manifest-'));
  const path = join(directory, 'manifest.json');
  try {
    const manifest = createDevelopmentManifest({
      runId: '33333333-3333-4333-8333-333333333333',
      projectRef: APPROVED_DEVELOPMENT_PROJECT_REF,
    });
    manifest.password = 'must-not-persist';
    await writeFile(path, `${JSON.stringify(manifest)}\n`);
    const raw = await readFile(path, 'utf8');
    assert.match(raw, /must-not-persist/);
    await assert.rejects(
      readDevelopmentManifest(path),
      error => error?.code === 'unexpected_manifest_key' || error?.code === 'invalid_manifest',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const sourceFiles = [
    'dev-cli.mjs',
    'dev-environment.mjs',
    'dev-manifest.mjs',
    'dev-seed.mjs',
    'dev-verify.mjs',
    'dev-cleanup.mjs',
    'dev-invoke.mjs',
  ];
  for (const file of sourceFiles) {
    const source = await readFile(new URL(`../../scripts/billing-fixtures/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['\"]stripe['\"]/i);
    assert.doesNotMatch(source, /api\.stripe\.com/i);
    assert.doesNotMatch(source, /supabase\s+(link|db\s+push|functions\s+deploy|db\s+reset)/i);
  }
});

test('DEV-FIXTURE-D1-13 manifest stores no password, JWT, key, authorization header, email, or Stripe ID fields', () => {
  const manifest = createDevelopmentManifest({
    runId: '44444444-4444-4444-8444-444444444444',
    projectRef: APPROVED_DEVELOPMENT_PROJECT_REF,
  });
  const raw = JSON.stringify(manifest);
  assert.doesNotMatch(raw, /password|jwt|service.?role|authorization|@fixtures\.tp3d\.test|stripe_(customer|subscription)|cus_|sub_/i);
});

test('DEV-FIXTURE-D1-14 development commands are not part of the default npm test command', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test tests/audit/*.spec.mjs');
  assert.doesNotMatch(pkg.scripts.test, /billing:fixtures:dev|test:billing:dev|tests\/integration\/dev-billing/);
});
