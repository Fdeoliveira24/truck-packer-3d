import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = relativePath => readFileSync(join(repoRoot, relativePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const indexHtml = read('index.html');
const bootstrapSource = read('src/bootstrap/three-runtime.js');
const viteSource = read('vite.config.js');
const readme = read('README.md');
const appSource = read('src/app.js');

function git(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function runtimeBuildSources() {
  const distRoot = join(repoRoot, 'dist');
  if (!existsSync(distRoot)) return [];
  const paths = [];
  const visit = directory => {
    readdirSync(directory).forEach(name => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(?:html|js|mjs)$/u.test(name)) paths.push(readFileSync(path, 'utf8'));
    });
  };
  visit(distRoot);
  return paths;
}

function getThreeRuntimeGuardSource() {
  const match = appSource.match(
    /  async function ensureThreeRuntimeReady\(\) \{([\s\S]*?)\n  \}\n\n  if \(!\(await ensureThreeRuntimeReady\(\)\)\) return;/u
  );
  assert.ok(match, 'expected the Three.js startup guard before application initialization');
  return `async function ensureThreeRuntimeReady() {${match[1]}\n}`;
}

async function runThreeRuntimeGuard({ readiness = true, includeThree = true, includeOrbitControls = true } = {}) {
  const overlayCalls = [];
  const errorCalls = [];
  const bootState = {
    threeReady: Promise.resolve(readiness),
    showAppStatusOverlay(...args) {
      overlayCalls.push(args);
    },
  };
  const windowRef = { __TP3D_BOOT: bootState };
  if (includeThree) {
    windowRef.THREE = includeOrbitControls ? { OrbitControls() {} } : {};
  }
  const result = await runInNewContext(`(${getThreeRuntimeGuardSource()})()`, {
    console: {
      error(...args) {
        errorCalls.push(args);
      },
    },
    window: windowRef,
  });
  return { errorCalls, overlayCalls, result };
}

test('package.json pins Three.js exactly to 0.160.0', () => {
  assert.equal(packageJson.dependencies.three, '0.160.0');
});

test('package.json pins Vite exactly to 8.2.0', () => {
  assert.equal(packageJson.devDependencies.vite, '8.2.0');
  assert.match(packageJson.devDependencies.vite, /^\d+\.\d+\.\d+$/u);
  assert.equal(packageJson.engines.node, '^20.19.0 || >=22.12.0');
});

test('package-lock is present and eligible to be tracked', () => {
  assert.ok(existsSync(join(repoRoot, 'package-lock.json')));
  assert.notEqual(git(['check-ignore', '-q', 'package-lock.json']).status, 0);
  assert.equal(packageLock.packages[''].dependencies.three, '0.160.0');
  assert.equal(packageLock.packages[''].devDependencies.vite, '8.2.0');
});

test('Three.js core and OrbitControls originate from the same npm package', () => {
  assert.match(bootstrapSource, /import \* as THREE from 'three';/u);
  assert.match(bootstrapSource, /from 'three\/addons\/controls\/OrbitControls\.js';/u);
});

test('the temporary window.THREE compatibility object remains', () => {
  assert.match(bootstrapSource, /window\.THREE = \{ \.\.\.THREE, OrbitControls \};/u);
});

test('the bootstrap enforces Three.js revision 160', () => {
  assert.match(bootstrapSource, /THREE\.REVISION !== '160'/u);
});

test('OrbitControls remains exposed through window.THREE', () => {
  assert.match(bootstrapSource, /\{ \.\.\.THREE, OrbitControls \}/u);
  assert.match(bootstrapSource, /vendorReady\('three'\)/u);
});

test('application boot keeps the existing Three.js readiness promise as its sole contract', () => {
  assert.match(indexHtml, /__TP3D_BOOT\.threeReady = import\('\.\/src\/bootstrap\/three-runtime\.js'\)/u);
  assert.match(appSource, /bootState\.threeReady \? await bootState\.threeReady : false/u);
  assert.equal((indexHtml.match(/__TP3D_BOOT\.threeReady\s*=/gu) || []).length, 1);
  assert.doesNotMatch(appSource, /threeReady\s*=/u);
});

test('successful Three.js readiness permits application initialization', async () => {
  const outcome = await runThreeRuntimeGuard();
  assert.equal(outcome.result, true);
  assert.deepEqual(outcome.overlayCalls, []);
  assert.deepEqual(outcome.errorCalls, []);
});

test('false Three.js readiness stops initialization and requests the fatal startup overlay', async () => {
  const outcome = await runThreeRuntimeGuard({ readiness: false });
  assert.equal(outcome.result, false);
  assert.equal(outcome.errorCalls.length, 1);
  assert.equal(outcome.overlayCalls.length, 1);
  assert.equal(outcome.overlayCalls[0][0], 'fatal');
  assert.equal(
    outcome.overlayCalls[0][1].message,
    'Cargo Planner could not load its 3D rendering runtime. Start the application through the supported npm/Vite development or production build and reload.'
  );
});

test('rejected Three.js readiness stops initialization without a secondary startup path', async () => {
  const outcome = await runThreeRuntimeGuard({ readiness: Promise.reject(new Error('bootstrap failed')) });
  assert.equal(outcome.result, false);
  assert.equal(outcome.errorCalls.length, 1);
  assert.equal(outcome.overlayCalls.length, 1);
});

test('missing window.THREE stops initialization', async () => {
  const outcome = await runThreeRuntimeGuard({ includeThree: false });
  assert.equal(outcome.result, false);
  assert.equal(outcome.errorCalls.length, 1);
  assert.equal(outcome.overlayCalls.length, 1);
});

test('missing OrbitControls stops initialization', async () => {
  const outcome = await runThreeRuntimeGuard({ includeOrbitControls: false });
  assert.equal(outcome.result, false);
  assert.equal(outcome.errorCalls.length, 1);
  assert.equal(outcome.overlayCalls.length, 1);
});

test('the Three.js readiness guard runs before application systems are constructed', () => {
  const guardIndex = appSource.indexOf('if (!(await ensureThreeRuntimeReady())) return;');
  const uiConstructionIndex = appSource.indexOf('const UIComponents = createUIComponents();');
  assert.ok(guardIndex >= 0);
  assert.ok(uiConstructionIndex > guardIndex);
});

test('active runtime markup contains no Three.js CDN URL', () => {
  assert.doesNotMatch(indexHtml, /esm\.sh|cdn\.skypack\.dev|https?:\/\/[^'"\s>]*three/iu);
});

test('active runtime sources and build contain no old Three.js vendor dependency', () => {
  const activeSources = [indexHtml, bootstrapSource, ...runtimeBuildSources()].join('\n');
  assert.doesNotMatch(
    activeSources,
    /vendor\/(?:three(?:\.module|\.min)?\.js|OrbitControls(?:\.module)?\.js)|OrbitControls\.module\.js/iu
  );
});

test('Vite development port remains 5500', () => {
  assert.match(viteSource, /server:\s*\{[\s\S]*?port:\s*5500/u);
});

test('Vite uses strict ports for development and preview', () => {
  assert.equal((viteSource.match(/strictPort:\s*true/gu) || []).length, 2);
  assert.match(viteSource, /preview:\s*\{[\s\S]*?port:\s*5500/u);
});

test('all pre-existing package scripts remain unchanged', () => {
  const expectedScripts = {
    lint: 'npm run lint:js && npm run lint:css && npm run lint:html',
    test: 'node --test tests/audit/*.spec.mjs',
    'test:stress':
      'TP3D_STRESS=1 node --test --test-name-pattern "PHASE-E1|PHASE-E2A|PHASE-E2B|AUTO-PACK-A1-PERF-1" tests/audit/security-and-invariants.spec.mjs',
    'test:all': 'TP3D_STRESS=1 node --test tests/audit/*.spec.mjs',
    'billing:fixtures:plan': 'node scripts/billing-fixtures/cli.mjs plan',
    'billing:fixtures:verify-safety': 'node scripts/billing-fixtures/cli.mjs verify-safety',
    'billing:fixtures:dev:plan': 'node scripts/billing-fixtures/dev-cli.mjs plan',
    'billing:fixtures:dev:seed': 'node scripts/billing-fixtures/dev-cli.mjs seed',
    'billing:fixtures:dev:verify': 'node scripts/billing-fixtures/dev-cli.mjs verify',
    'billing:fixtures:dev:cleanup': 'node scripts/billing-fixtures/dev-cli.mjs cleanup',
    'test:billing:dev': 'node --test --test-concurrency=1 tests/integration/dev-billing/deployed-functions.spec.mjs',
    'billing:fixtures:stripe:plan': 'node scripts/billing-fixtures/stripe-cli.mjs plan',
    'billing:fixtures:stripe:probe': 'node scripts/billing-fixtures/stripe-cli.mjs probe',
    'billing:fixtures:stripe:seed': 'node scripts/billing-fixtures/stripe-cli.mjs seed',
    'billing:fixtures:stripe:verify': 'node scripts/billing-fixtures/stripe-cli.mjs verify',
    'billing:fixtures:stripe:safety': 'node scripts/billing-fixtures/stripe-cli.mjs safety',
    'test:billing:stripe': 'node --test --test-concurrency=1 tests/integration/stripe-billing/stripe-billing.spec.mjs',
    'billing:fixtures:stripe:cleanup': 'node scripts/billing-fixtures/stripe-cli.mjs cleanup',
    'local:billing:verify': 'node scripts/local-fixtures/environment.mjs',
    'test:billing:local':
      'node --test --test-concurrency=1 tests/local-db/billing-local.spec.mjs tests/local-db/ownership-local.spec.mjs tests/local-db/security-local.spec.mjs',
    'stress:ui': 'node tests/stress.spec.js',
    'lint:js': 'eslint "src/**/*.js" "index.html" --report-unused-disable-directives',
    'lint:css': 'stylelint "styles/**/*.css"',
    'lint:html': 'html-validate --config .htmlvalidate.json index.html',
    'lint:fix': 'npm run lint:js -- --fix && npm run lint:css -- --fix',
    typecheck: 'tsc --noEmit --allowJs --checkJs',
    format: 'prettier --write "**/*.{html,css,js,json,md}"',
    'format:check': 'prettier --check "**/*.{html,css,js,json,md}"',
    validate: 'npm run lint && npm run format:check',
    quality: "npm run lint:fix && npm run format && echo '✅ Code quality checks passed!'",
    'quality:ci': 'npm run validate > cleanup/reports/quality-report.txt 2>&1 || true',
    'lint:report': 'node cleanup/scripts/eslint-report.mjs',
  };
  Object.entries(expectedScripts).forEach(([name, command]) => assert.equal(packageJson.scripts[name], command));
});

test('generated build output remains ignored', () => {
  assert.equal(git(['check-ignore', '-q', 'dist/phase-1a-probe']).status, 0);
});

test('node_modules remains ignored', () => {
  assert.equal(git(['check-ignore', '-q', 'node_modules/phase-1a-probe']).status, 0);
});

test('scene, camera, lighting, material, geometry, packing, collision, and utilization owners are unchanged', () => {
  const protectedPaths = [
    'src/editor/scene-runtime.js',
    'src/screens/editor-screen.js',
    'src/editor/geometry-factory.js',
    'src/services/autopack-engine.js',
    'src/services/autopack-solver.js',
    'src/services/autopack-item-builder.js',
    'src/services/pack-library.js',
    'src/services/cog-service.js',
    'src/core/oriented-dims.js',
  ];
  assert.equal(git(['diff', '--name-only', '--', ...protectedPaths]).stdout.trim(), '');
});

test('no GLTF, DRACO, KTX2, Meshopt, or post-processing product integration was added', () => {
  const changedRuntimeSurface = [indexHtml, bootstrapSource, viteSource, JSON.stringify(packageJson)].join('\n');
  assert.doesNotMatch(
    changedRuntimeSurface,
    /GLTFLoader|DRACOLoader|KTX2Loader|Meshopt|postprocessing|EffectComposer/u
  );
});

test('no WebGPU integration was added', () => {
  assert.doesNotMatch([indexHtml, bootstrapSource, viteSource].join('\n'), /WebGPU/iu);
});

test('the documented browser floor remains unchanged', () => {
  assert.match(readme, /Chrome 90\+/u);
  assert.match(readme, /Firefox 103\+/u);
  assert.match(readme, /Safari 13\.1\+/u);
  assert.match(readme, /Edge 90\+/u);
  assert.match(viteSource, /target: \['chrome90', 'edge90', 'firefox103', 'safari13\.1'\]/u);
});

test('no unrelated dependency declaration changed', () => {
  const expectedDevDependencies = {
    '@eslint/js': '^10.0.1',
    eslint: '^10.8.0',
    'eslint-plugin-html': '^8.1.4',
    globals: '^17.8.0',
    'html-validate': '^11.6.0',
    pg: '^8.22.0',
    playwright: '^1.62.1',
    prettier: '^3.9.6',
    'prettier-plugin-organize-attributes': '^1.0.0',
    stripe: '^22.4.0',
    stylelint: '^17.14.1',
    'stylelint-config-html': '^1.1.0',
    'stylelint-config-standard': '^40.0.0',
    typescript: '^7.0.2',
    vite: '8.2.0',
  };
  assert.deepEqual(packageJson.devDependencies, expectedDevDependencies);
  assert.deepEqual(packageJson.dependencies, { three: '0.160.0' });
});

test('the migration does not add or weaken a Content Security Policy', () => {
  assert.doesNotMatch(indexHtml, /Content-Security-Policy/iu);
  assert.doesNotMatch([indexHtml, viteSource].join('\n'), /unsafe-eval/iu);
  assert.doesNotMatch(viteSource, /headers\s*:/u);
});
