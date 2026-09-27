import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// PR-A integration: real markup, Editor, PackLibrary, scope generation, Three.js,
// app capture/readback, scheduler and render subscriber. No backend or persistence.
const ORIGIN = 'http://localhost:5599';

const repo = new URL('../../', import.meta.url);
const read = (path, encoding = 'utf8') => readFile(new URL(path, repo), encoding);

const appSource = await read('src/app.js');
const subscriberAnchor = appSource.indexOf("let prevScreen = StateStore.get('currentScreen');");
const subscriberStart = appSource.indexOf('StateStore.subscribe(changes => {', subscriberAnchor);
const subscriberEnd = appSource.indexOf('\n      });\n\n      try {\n        Router.init(', subscriberStart);
assert.ok(subscriberAnchor >= 0 && subscriberStart > subscriberAnchor && subscriberEnd > subscriberStart,
  'app.js StateStore render subscriber is extractable');
const appSubscriber = appSource.slice(subscriberStart + 'StateStore.subscribe('.length, subscriberEnd + '\n      }'.length);
const schedulerStart = appSource.indexOf('function createPackPreviewScheduler({');
const schedulerEnd = appSource.indexOf('\n\nconst TP3D_BUILD_STAMP', schedulerStart);
assert.ok(schedulerStart >= 0 && schedulerEnd > schedulerStart, 'app.js preview scheduler is extractable');
const previewScheduler = appSource.slice(schedulerStart, schedulerEnd);

const importMap = JSON.stringify({
  imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' },
});
const rawIndex = await read('index.html');
assert.ok(rawIndex.includes('<head>'), 'index.html head is present');
const indexHtml = rawIndex.replace('<head>', `<head><script type="importmap">${importMap}</script>`);

const captureStart = appSource.indexOf('      function estimateDataUrlBytes(');
const captureEnd = appSource.indexOf('      function captureScreenshot(', captureStart);
const readbackStart = appSource.indexOf('      function renderCameraToDataUrl(');
const readbackEnd = appSource.indexOf('      return { captureScreenshot, generatePDF,', readbackStart);
assert.ok(captureStart >= 0 && captureEnd > captureStart && readbackEnd > readbackStart);
const captureCode = appSource.slice(captureStart, captureEnd).replace('async function capturePackPreview(', 'async function productionCapturePackPreview(');
const readbackCode = appSource.slice(readbackStart, readbackEnd).replace('function renderCameraToDataUrl(', 'function productionRenderCameraToDataUrl(');

const FIXTURE_CASES = [
  { id: 'qa-carton', name: 'QA Carton', dims: { length: 12, width: 10, height: 8 }, qty: 20 },
  { id: 'qa-long', name: 'QA Long', dims: { length: 60, width: 18, height: 16 }, qty: 5 },
  { id: 'qa-wide', name: 'QA Wide', dims: { length: 30, width: 40, height: 20 }, qty: 3 },
  { id: 'qa-tall', name: 'QA Tall', dims: { length: 20, width: 20, height: 50 }, qty: 4 },
  { id: 'qa-single', name: 'QA Single', dims: { length: 24, width: 24, height: 24 }, qty: 1 },
];
const TOTAL = FIXTURE_CASES.reduce((sum, c) => sum + c.qty, 0);

const bootstrap = `
import * as CoreStorage from '/src/core/storage.js';
import { createPacksScreen } from '/src/screens/packs-screen.js';
import { createTableFooter } from '/src/ui/table-footer.js';
import { createUIComponents } from '/src/ui/ui-components.js';
import { createKeyboardManager } from '/src/ui/keyboard-manager.js';
import { createAppShell } from '/src/ui/app-shell.js';
import { createOperationLifecycle } from '/src/core/operation-lifecycle.js';
import { TrailerPresets } from '/src/data/trailer-presets.js';
import { createSceneRuntime } from '/src/editor/scene-runtime.js';
import { createTrailerGeometry } from '/src/editor/trailer-geometry.js';
import { createCaseScene, createInteractionManager, createEditorScreen } from '/src/screens/editor-screen.js';
import { createTruckChangeController } from '/src/ui/truck-change-controller.js';
import * as CoreUtils from '/src/core/utils/index.js';
import * as BrowserUtils from '/src/core/browser.js';
import * as Defaults from '/src/core/defaults.js';
import * as CoreStateStore from '/src/core/state-store.js';
import * as CategoryService from '/src/services/category-service.js';
import * as CaseLibrary from '/src/services/case-library.js';
import * as CorePackLibrary from '/src/services/pack-library.js';
import { createAutoPackEngine } from '/src/services/autopack-engine.js';
import * as PreferencesManager from '/src/services/preferences-manager.js';

const APP_SUBSCRIBER = ${JSON.stringify(appSubscriber)};
const PREVIEW_SCHEDULER = ${JSON.stringify(previewScheduler)};
const FIXTURE_CASES = ${JSON.stringify(FIXTURE_CASES)};

await window.__TP3D_BOOT.threeReady;
await import('/vendor/tween.umd.js');
CoreStorage.setWorkspaceScope('fixture-a');
const UIComponents = createUIComponents();
const Utils = { ...CoreUtils, ...BrowserUtils };
const StateStore = {
  init: CoreStateStore.init, get: CoreStateStore.get, set: CoreStateStore.set, replace: CoreStateStore.replace,
  snapshot: CoreStateStore.snapshot, resetHistory: CoreStateStore.resetHistory, undo: CoreStateStore.undo,
  redo: CoreStateStore.redo, subscribe: CoreStateStore.subscribe,
};
// The real PackLibrary behind a fault-injection seam: probe.fault, when set,
// makes the next Editor call of that method fail; otherwise it delegates.
const faults = {};
const PackLibrary = { ...CorePackLibrary };
for (const name of ['update', 'getStagingLayout']) {
  PackLibrary[name] = (...args) => {
    const fault = faults[name];
    if (fault) {
      delete faults[name];
      return fault(...args);
    }
    return CorePackLibrary[name](...args);
  };
}

const cases = FIXTURE_CASES.map(c => ({
  id: c.id, name: c.name, manufacturer: 'QA', category: 'default', color: '#9ca3af',
  dimensions: { ...c.dims }, weight: 20, volume: c.dims.length * c.dims.width * c.dims.height,
  canFlip: false, stackable: true, orientationLock: 'any', noStackOnTop: false, maxStackCount: 0, isPallet: false,
}));
const packId = 'fixture-pack';
const otherPackId = 'fixture-other-pack';
let serial = 0;
const instances = [];
FIXTURE_CASES.forEach(c => {
  for (let i = 0; i < c.qty; i += 1) {
    const n = serial++;
    instances.push({
      id: 'cargo-' + String(n).padStart(2, '0'), caseId: c.id, hidden: false, groupId: null, placement: 'staged',
      transform: {
        position: { x: -200 - (n % 8) * 70, y: c.dims.height / 2, z: -260 + Math.floor(n / 8) * 70 },
        rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    });
  }
});
StateStore.init({
  currentScreen: 'editor', currentPackId: packId, selectedInstanceIds: [], caseLibrary: cases,
  packLibrary: [
    { id: packId, title: 'Fixture', truck: { length: 240, width: 96, height: 100, shapeMode: 'rect' },
      cases: instances, groups: [], createdAt: 1, lastEdited: 1 },
    { id: otherPackId, title: 'Other', truck: { length: 240, width: 96, height: 100, shapeMode: 'rect' },
      cases: [], groups: [], createdAt: 1, lastEdited: 1 },
  ],
  folderLibrary: [], preferences: Defaults.defaultPreferences,
});

let SceneManager = null;
const TrailerGeometry = createTrailerGeometry({ Utils, CorePackLibrary, getSceneManager: () => SceneManager });
const AppShell = createAppShell({ StateStore, PackLibrary, Utils, beforeNavigate: (a, b) => ExportService.flushPackPreviewBeforeNavigation?.(a, b) });
SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore });
const CaseScene = createCaseScene({ SceneManager, CaseLibrary, CategoryService, PackLibrary, StateStore, TrailerGeometry, Utils, PreferencesManager });
const OperationLifecycle = createOperationLifecycle();
const InteractionManager = createInteractionManager({ SceneManager, CaseScene, StateStore, PackLibrary, CaseLibrary, PreferencesManager, UIComponents, OperationLifecycle });

${captureCode}
${readbackCode}
const getActiveWorkspaceKey = () => CoreStorage.getWorkspaceScope();
function renderCameraToDataUrl(...args) {
  const image = productionRenderCameraToDataUrl(...args);
  log.push({ type: 'readback', packId: StateStore.get('currentPackId'), screen: StateStore.get('currentScreen'), image });
  return image;
}
function capturePackPreview(id, options) {
  log.push({ type: 'request', at: performance.now(), packId: id, source: options?.source, beforeDeparture: options?.beforeDeparture, busy: OperationLifecycle.isBusy(), identity: Boolean(EditorUI.getPreviewScene()) });
  return productionCapturePackPreview(id, options).then(result => { log.push({ type: 'captureResult', at: performance.now(), result }); return result; });
}
const createPreviewScheduler = new Function(PREVIEW_SCHEDULER + '\\nreturn createPackPreviewScheduler;')();
const AutoPackPreviewScheduler = createPreviewScheduler({
  StateStore, PackLibrary, OperationLifecycle, capturePackPreview, getActiveWorkspaceKey: () => getActiveWorkspaceKey() + '|' + CoreStorage.captureScopeContext().generation,
});

const ExportService = { captureScreenshot() {}, generatePDF() {}, capturePackPreview, clearPackPreview, capturePackPreviewFromLibrary, flushPackPreviewBeforeNavigation };
window.__TP3D_BILLING = { getBillingState: () => ({ ok: true, orgId: '' }) };
const AutoPackEngine = createAutoPackEngine({
  CaseLibrary, CaseScene, OperationLifecycle, capturePackPreview,
  getActiveOrgIdForBilling: () => '', getOrgRoleHydrationState: () => 'ready',
  getProRuleSet: () => ({ canUseProFeature: true }), getWorkspaceSwitchState: () => null,
  maybeScheduleBillingRefresh() {}, normalizeOrgIdForBilling: value => value, openSettingsOverlay() {},
  PackLibrary, runtimeWindow: window, SceneManager, StateStore, toast: (...args) => UIComponents.showToast(...args),
  TrailerGeometry, UIComponents, Utils,
});
const TruckChangeController = createTruckChangeController({ PackLibrary, CaseLibrary, UIComponents, documentRef: document });
const EditorUI = createEditorScreen({
  StateStore, PackLibrary, CaseLibrary, PreferencesManager, UIComponents, Utils, TrailerGeometry, CategoryService,
  AutoPackEngine, ExportService, SystemOverlay: { show() {}, hide() {} }, TrailerPresets, AppShell, SceneManager,
  CaseScene, InteractionManager, TruckChangeController, OperationLifecycle,
});
const PacksUI = createPacksScreen({
  Utils, UIComponents, PreferencesManager, PackLibrary, CaseLibrary, StateStore, TrailerPresets,
  ImportExport: {}, ImportPackDialog: {}, createTableFooter, AppShell, ExportService,
  CardDisplayOverlay: {}, TruckChangeController, OperationLifecycle, featureFlags: {},
  persistNow() {}, toast: (...args) => UIComponents.showToast(...args), toAscii: value => value,
});
PacksUI.init();
const Storage = { saveSoon() {}, saveNow() {} };
const KeyboardManager = createKeyboardManager({
  StateStore, PackLibrary, CaseLibrary, CaseScene, SceneManager, InteractionManager, AutoPackEngine,
  OperationLifecycle, UIComponents, AppShell, Storage, Utils,
});

document.body.dataset.auth = 'signed_in';
AppShell.init();
EditorUI.init();
KeyboardManager.init();

const log = [];
const now = () => performance.now();
// Every full Editor render with an open Pack calls SceneManager.setTruck exactly
// once (render() is its only caller on this path), whoever triggered it.
const realSetTruck = SceneManager.setTruck;
SceneManager.setTruck = (...args) => {
  log.push({ type: 'render', at: now(), op: OperationLifecycle.currentOperation().kind });
  return realSetTruck(...args);
};
const realUpdate = PackLibrary.update;
PackLibrary.update = (id, patch, options) => {
  const screen = StateStore.get('currentScreen');
  const result = realUpdate(id, patch, options);
  if (result && Object.hasOwn(patch, 'thumbnail')) log.push({ type: 'write', packId: id, screen, source: patch.thumbnailSource });
  return result;
};
const realToast = UIComponents.showToast;
UIComponents.showToast = (...args) => {
  log.push({ type: 'toast', message: args[0], tone: args[1] });
  return realToast(...args);
};
const realSync = CaseScene.sync;
CaseScene.sync = pack => {
  log.push({ type: 'sync', at: now() });
  return realSync(pack);
};
const createAppSubscriber = new Function('deps', \`
  const { Storage, StateStore, PreferencesManager, SceneManager, SettingsUI, EditorUI, AutoPackPreviewScheduler,
    PackLibrary, ExportService, AppShell, PacksUI, CasesUI, RecoverableErrorOverlay } = deps;
  const suspendAutoSave = false;
  let prevScreen = StateStore.get('currentScreen');
  return (\${APP_SUBSCRIBER});
\`);
StateStore.subscribe(changes => log.push({ type: 'notify', at: now(), keys: Object.keys(changes).sort().join(',') }));
StateStore.subscribe(createAppSubscriber({
  Storage, StateStore, PreferencesManager, SceneManager, SettingsUI: { loadForm() {} },
  EditorUI: { ...EditorUI, render: () => { log.push({ type: 'subscriberRender', at: now() }); EditorUI.render(); } },
  AutoPackPreviewScheduler: {
    schedule: () => { log.push({ type: 'previewSchedule', at: now() }); return AutoPackPreviewScheduler.schedule(); },
  },
  PackLibrary, ExportService, AppShell,
  PacksUI, CasesUI: { render() {} }, RecoverableErrorOverlay: { syncRecoverableErrorOverlay() {} },
}));
OperationLifecycle.subscribe(state => log.push({ type: 'op', at: now(), kind: state.kind }));
AppShell.navigate('editor');
EditorUI.render();

const livePack = () => PackLibrary.getById(StateStore.get('currentPackId'));
window.probe = {
  EditorUI, CaseScene, SceneManager, InteractionManager, PackLibrary, CoreStorage, AutoPackEngine, AutoPackPreviewScheduler, ExportService, PacksUI,
  snapshotImage: () => productionRenderCameraToDataUrl(SceneManager.getCamera(), 320, 180, { mimeType: 'image/jpeg', quality: 0.72, hideGrid: true }),
  log, faults, packId, otherPackId, StateStore, OperationLifecycle, AppShell, CorePackLibrary,
  toasts: [],
  op: () => OperationLifecycle.currentOperation().kind,
  mark() { log.length = 0; this.toasts.length = 0; },
  results: () => StateStore.get('autoPackResults'),
  resultsJson: () => JSON.stringify(StateStore.get('autoPackResults')),
  panelCount: () => document.querySelectorAll('[data-role="autopack-results-panel"]').length,
  casesJson: () => JSON.stringify(livePack().cases),
  cases: () => JSON.parse(JSON.stringify(livePack().cases)),
  counts() {
    const list = livePack().cases;
    return {
      total: list.length,
      packed: list.filter(inst => inst.placement === 'packed').length,
      staged: list.filter(inst => inst.placement === 'staged').length,
      ids: list.map(inst => inst.id),
    };
  },
  loadSummary() {
    const card = document.querySelector('.tp3d-editor-stats-card');
    if (!card) return null;
    const value = label => {
      const row = [...card.querySelectorAll('.row')].find(r => r.textContent.includes(label));
      return row ? Number(row.querySelector('b').textContent) : null;
    };
    return { inTruck: value('In truck'), staged: value('Staged') };
  },
  readouts: () => [...document.querySelectorAll('.tp3d-editor-case-qty-readout')].map(el => el.textContent.trim()),
  // Scene mesh positions (inches) against the committed Pack transforms.
  sceneMismatches() {
    return livePack().cases.filter(inst => {
      const obj = CaseScene.getObject(inst.id);
      return !obj || obj.position.distanceTo(SceneManager.vecInchesToWorld(inst.transform.position)) > 1e-6;
    }).map(inst => inst.id);
  },
  unpackButton: () => document.getElementById('btn-unpack').textContent.trim(),
};
new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
  if (node.nodeType === 1) window.probe.toasts.push(node.textContent.replace(/\\s+/g, ' ').trim());
}))).observe(document.getElementById('toast-container'), { childList: true });
const seed = StateStore.snapshot();
seed.currentScreen = 'packs';
seed.currentPackId = null;
seed.packLibrary[0].thumbnailUpdatedAt = 1;
seed.caseLibrary.push({ ...seed.caseLibrary[0], id: 'red-crate', name: 'RED CRATE B', color: '#ef2222', dimensions: { length: 90, width: 80, height: 80 } });
seed.packLibrary[1] = { ...seed.packLibrary[1], title: 'Red B', thumbnailUpdatedAt: 1, cases: [{
  ...seed.packLibrary[0].cases[0], id: 'b-cargo', caseId: 'red-crate', placement: 'packed',
  transform: { position: { x: 160, y: 40, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
}] };
seed.packLibrary.push({ ...seed.packLibrary[1], id: 'empty-pack', title: 'Empty', cases: [] });
window.probe.reset = () => {
  const op = OperationLifecycle.currentOperation();
  if (op.busy) OperationLifecycle.finishOperation(op.token);
  CoreStorage.setWorkspaceScope('fixture-a');
  StateStore.replace(structuredClone(seed));
  window.probe.mark();
};
window.probe.reset();
window.__EDITOR_READY = true;
`;

const CONTENT_TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
};
const SERVED = ['/src/', '/styles/', '/vendor/', '/media/', '/node_modules/three/'];

async function openEditor(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Console errors count too, except resources this harness deliberately does
  // not serve and the one failure a test injects on purpose.
  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'error' && !/Failed to load resource|injected update failure/.test(text)) errors.push(text);
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: indexHtml });
    if (url.pathname === '/src/app.js') return route.fulfill({ contentType: 'text/javascript', body: bootstrap });
    const ext = url.pathname.slice(url.pathname.lastIndexOf('.'));
    if (!SERVED.some(prefix => url.pathname.startsWith(prefix)) || !CONTENT_TYPES[ext]) {
      return route.fulfill({ status: 404, body: '' });
    }
    const text = /^\.(js|mjs|css|svg|json)$/.test(ext);
    const body = await read(url.pathname.slice(1), text ? 'utf8' : undefined).catch(() => null);
    return body === null
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({ contentType: CONTENT_TYPES[ext], body });
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.__EDITOR_READY === true);
  return { page, errors };
}

const launch = () => chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const A = 'fixture-pack';
const B = 'fixture-other-pack';
const counts = page => page.evaluate(() => {
  const q = window.probe;
  return {
    requests: q.log.filter(e => e.type === 'request').length,
    readbacks: q.log.filter(e => e.type === 'readback').length,
    writes: q.log.filter(e => e.type === 'write').length,
    successes: q.log.filter(e => e.type === 'toast' && e.message === 'Preview captured').length,
    op: q.op(), screen: q.StateStore.get('currentScreen'), packId: q.StateStore.get('currentPackId'),
  };
});
const settlePreview = async page => {
  await page.waitForFunction(() => window.probe.op() === 'idle');
  await page.waitForTimeout(650); // Beyond both production preview producers; detect duplicates.
  await page.waitForFunction(() => window.probe.op() === 'idle');
};
const openPack = (page, id = A) => page.evaluate(id => {
  const q = window.probe;
  q.PackLibrary.open(id);
  q.AppShell.navigate('editor');
}, id);

test('PR-A real Chromium preview identity and navigation', { timeout: 240000 }, async t => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    for (const mode of ['list', 'grid']) {
      await t.test(`manual ${mode} opens B, captures B pixels once and stays in Editor`, async () => {
        await page.evaluate(() => window.probe.reset());
        await openPack(page, B);
        await page.waitForTimeout(100);
        const expectedB = await page.evaluate(() => window.probe.snapshotImage());
        await openPack(page, A);
        await page.evaluate(async () => {
          const q = window.probe;
          await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
          q.AppShell.navigate('packs');
          q.mark();
        });
        const originalA = await page.evaluate(() => window.probe.PackLibrary.getById(window.probe.packId).thumbnail);
        assert.notEqual(originalA, expectedB, 'A and B render distinguishable images');
        await page.click(`#packs-view-${mode}`);
        await page.getByRole('button', { name: 'More actions for Red B', exact: true }).filter({ visible: true }).click();
        await page.getByText('Capture Preview', { exact: true }).click();
        await page.waitForFunction(() => window.probe.log.some(e => e.type === 'write'));
        await settlePreview(page);
        assert.deepEqual(await counts(page), { requests: 1, readbacks: 1, writes: 1, successes: 1, op: 'idle', screen: 'editor', packId: B });
        const proof = await page.evaluate(() => {
          const q = window.probe;
          return {
            a: q.PackLibrary.getById(q.packId).thumbnail,
            b: q.PackLibrary.getById(q.otherPackId).thumbnail,
            sync: q.CaseScene.getSyncedPack().id,
            writeBeforeSuccess: q.log.findIndex(e => e.type === 'write') < q.log.findIndex(e => e.type === 'toast' && e.tone === 'success'),
          };
        });
        assert.equal(proof.a, originalA);
        assert.equal(proof.b, expectedB, 'accepted image equals the independently rendered B image');
        assert.equal(proof.sync, B);
        assert.equal(proof.writeBeforeSuccess, true);
      });
    }

    await t.test('deleted A meshes cannot supply B; empty target opens without readback/success', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      await page.evaluate(() => {
        const q = window.probe;
        q.AppShell.navigate('packs');
        q.PackLibrary.remove(q.packId);
        q.mark();
      });
      await page.getByRole('button', { name: 'More actions for Red B', exact: true }).filter({ visible: true }).click();
      await page.getByText('Capture Preview', { exact: true }).click();
      await page.waitForFunction(() => window.probe.log.some(e => e.type === 'write'));
      await settlePreview(page);
      assert.equal((await counts(page)).writes, 1);
      assert.equal(await page.evaluate(() => window.probe.CaseScene.getObject('cargo-00') === null), true);
      assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById(window.probe.otherPackId).thumbnail === window.probe.snapshotImage()), true);
      await page.evaluate(() => { window.probe.AppShell.navigate('packs'); window.probe.mark(); });
      await page.getByRole('button', { name: 'More actions for Empty', exact: true }).filter({ visible: true }).click();
      await page.getByText('Capture Preview', { exact: true }).click();
      await settlePreview(page);
      const result = await counts(page);
      assert.equal(result.packId, 'empty-pack');
      assert.equal(result.screen, 'editor');
      assert.equal(result.readbacks, 0);
      assert.equal(result.writes, 0);
      assert.equal(result.successes, 0);
      assert.equal(await page.evaluate(() => window.probe.log.some(e => e.message === 'There are no cases to preview.')), true);
    });

    for (const source of ['manual', 'auto']) {
      for (const race of ['pack', 'screen', 'workspace', 'replace', 'delete']) {
        await t.test(`${source} ${race} departure/return permanently kills the old frame wait`, async () => {
          await page.evaluate(() => window.probe.reset());
          await openPack(page);
          const proof = await page.evaluate(async ({ source, race }) => {
            const q = window.probe;
            q.mark();
            const before = q.CoreStorage.captureScopeContext();
            const capture = q.ExportService.capturePackPreview(q.packId, { source, quiet: source === 'auto' });
            await new Promise(requestAnimationFrame);
            if (race === 'pack') {
              q.StateStore.set({ currentPackId: q.otherPackId });
              q.StateStore.set({ currentPackId: q.packId });
            } else if (race === 'screen') {
              q.AppShell.navigate('cases'); q.AppShell.navigate('editor');
            } else if (race === 'workspace') {
              const snapshot = q.StateStore.snapshot();
              q.CoreStorage.setWorkspaceScope('fixture-b');
              q.AutoPackEngine.bumpWorkspaceGeneration();
              q.StateStore.replace(structuredClone(snapshot));
              q.CoreStorage.setWorkspaceScope('fixture-a');
              q.AutoPackEngine.bumpWorkspaceGeneration();
              q.StateStore.replace(structuredClone(snapshot));
            } else if (race === 'replace') q.StateStore.replace(q.StateStore.snapshot());
            else q.PackLibrary.remove(q.packId);
            return { result: await capture, before: before.generation, after: q.CoreStorage.captureScopeContext().generation };
          }, { source, race });
          assert.equal(proof.result, false);
          if (race === 'workspace') assert.equal(proof.after, proof.before + 2);
          await settlePreview(page);
          const result = await counts(page);
          assert.equal(result.requests, 1, 'fresh re-entry does not request another capture');
          assert.equal(result.readbacks, 0);
          assert.equal(result.writes, 0);
          assert.equal(result.successes, 0);
          assert.equal(result.op, 'idle');
        });
      }
    }

    await t.test('committed visual edit then immediate leave flushes exactly once before navigation', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      const expected = await page.evaluate(() => {
        const q = window.probe;
        q.mark();
        const cases = structuredClone(q.PackLibrary.getById(q.packId).cases);
        cases[0].transform.position.x += 40;
        q.PackLibrary.update(q.packId, { cases });
        const image = q.snapshotImage();
        q.AppShell.navigate('packs');
        return image;
      });
      await settlePreview(page);
      assert.deepEqual(await counts(page), { requests: 1, readbacks: 1, writes: 1, successes: 0, op: 'idle', screen: 'packs', packId: A });
      const proof = await page.evaluate(() => {
        const q = window.probe;
        const pack = q.PackLibrary.getById(q.packId);
        return {
          image: pack.thumbnail,
          screens: q.log.filter(e => ['readback', 'write'].includes(e.type)).map(e => e.screen),
          card: [...document.querySelectorAll('#packs-grid img, #packs-list img')].some(e => e.src === pack.thumbnail),
          toasts: q.log.filter(e => e.type === 'toast'),
        };
      });
      assert.equal(proof.image, expected);
      assert.deepEqual(proof.screens, ['editor', 'editor']);
      assert.equal(proof.card, true);
      assert.deepEqual(proof.toasts, []);
      await page.evaluate(() => { window.probe.mark(); window.probe.AppShell.navigate('editor'); });
      await settlePreview(page);
      assert.equal((await counts(page)).requests, 0, 'successful departure makes re-entry already fresh');
    });

    await t.test('real drag departure skips provisional pixels and recovers after off-screen release', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await page.waitForTimeout(100);
      const point = await page.evaluate(() => {
        const q = window.probe;
        const camera = q.SceneManager.getCamera();
        const p = q.CaseScene.getObject('b-cargo').position.clone().project(camera);
        const rect = q.SceneManager.getRenderer().domElement.getBoundingClientRect();
        return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
      });
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 35, point.y + 20, { steps: 3 });
      const departure = await page.evaluate(() => {
        const q = window.probe;
        const provisional = q.InteractionManager.hasProvisionalPose();
        const mismatches = q.sceneMismatches();
        // Inject stale timestamps only; the pose comes from real pointer input.
        q.PackLibrary.getById(q.otherPackId).lastEdited = Date.now();
        q.mark();
        q.AppShell.navigate('packs');
        return { provisional, mismatches, screen: q.StateStore.get('currentScreen'), writes: q.log.filter(e => e.type === 'write').length };
      });
      await page.mouse.up();
      assert.equal(departure.provisional, true);
      assert.deepEqual(departure.mismatches, ['b-cargo']);
      assert.equal(departure.screen, 'packs');
      assert.equal(departure.writes, 0);
      await page.evaluate(() => window.probe.AppShell.navigate('editor'));
      await settlePreview(page);
      const result = await counts(page);
      assert.equal(result.requests, 1);
      assert.equal(result.readbacks, 1);
      assert.equal(result.writes, 1);
      assert.equal(result.successes, 0);
      assert.equal(result.op, 'idle');
      assert.deepEqual(await page.evaluate(() => window.probe.sceneMismatches()), []);
    });

    for (const kind of ['autopacking', 'unpacking', 'changingTruck', 'previewingTruckChange', 'capturingPreview', 'provisionalPose']) {
      await t.test(`${kind} departure skips readback; re-entry creates one new request`, async () => {
        await page.evaluate(() => window.probe.reset());
        await openPack(page);
        const proof = await page.evaluate(async kind => {
          const q = window.probe;
          q.mark();
          const original = q.InteractionManager.hasProvisionalPose;
          const token = kind === 'provisionalPose' ? null : q.OperationLifecycle.beginOperation(kind);
          if (!token) q.InteractionManager.hasProvisionalPose = () => true;
          q.PackLibrary.update(q.packId, { notes: 'dirty fixture' });
          q.AppShell.navigate('packs');
          const before = { screen: q.StateStore.get('currentScreen'), writes: q.log.filter(e => e.type === 'write').length };
          await new Promise(resolve => setTimeout(resolve, 350));
          q.AppShell.navigate('editor');
          q.InteractionManager.hasProvisionalPose = original;
          if (token) q.OperationLifecycle.finishOperation(token);
          return before;
        }, kind);
        assert.deepEqual(proof, { screen: 'packs', writes: 0 });
        await settlePreview(page);
        const result = await counts(page);
        assert.equal(result.requests, 1);
        assert.equal(result.readbacks, 1);
        assert.equal(result.writes, 1);
        assert.equal(result.successes, 0);
        assert.equal(result.op, 'idle');
      });
    }

    await t.test('stale activation coalesces Pack-open/screen requests; fresh activation does nothing', async () => {
      await page.evaluate(() => {
        const q = window.probe;
        q.reset();
        q.PackLibrary.update(q.packId, { notes: 'stale while inactive' });
        q.mark();
      });
      await openPack(page);
      await settlePreview(page);
      assert.equal((await counts(page)).writes, 1);
      assert.equal((await counts(page)).requests, 1);
      await page.evaluate(() => {
        const q = window.probe;
        q.AppShell.navigate('packs'); q.mark(); q.AppShell.navigate('editor');
      });
      await settlePreview(page);
      assert.equal((await counts(page)).requests, 0);
    });

    await t.test('missing target, failed synchronization and unavailable renderer never report success', async () => {
      for (const fault of ['deleted', 'sync', 'renderer', 'sceneReset', 'busy']) {
        await page.evaluate(() => window.probe.reset());
        await openPack(page);
        const result = await page.evaluate(async fault => {
          const q = window.probe;
          q.AppShell.navigate('packs'); q.mark();
          const sync = q.CaseScene.sync;
          const renderer = q.SceneManager.getRenderer;
          const token = fault === 'busy' ? q.OperationLifecycle.beginOperation('unpacking') : null;
          if (fault === 'sync') q.CaseScene.sync = () => { throw new Error('injected scene sync failure'); };
          const result = await q.ExportService.capturePackPreviewFromLibrary(q.otherPackId, id => {
            if (fault === 'deleted') { q.PackLibrary.remove(id); return; }
            q.PackLibrary.open(id); q.AppShell.navigate('editor');
            if (fault === 'renderer') q.SceneManager.getRenderer = () => null;
            if (fault === 'sceneReset') q.CaseScene.clear();
          });
          q.CaseScene.sync = sync;
          q.SceneManager.getRenderer = renderer;
          if (token) q.OperationLifecycle.finishOperation(token);
          return result;
        }, fault);
        assert.equal(result, false);
        const stat = await counts(page);
        assert.equal(stat.writes, 0);
        assert.equal(stat.successes, 0);
        assert.equal(stat.op, 'idle');
        if (fault === 'busy') assert.equal(stat.screen, 'packs');
      }
    });

    await t.test('animated AutoPack duplicate and Unpack thumbnail render remain PR-B baseline', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      await page.evaluate(() => window.probe.mark());
      await page.click('#btn-autopack');
      await page.waitForFunction(() => window.probe.op() === 'idle' && window.probe.results()?.options?.length > 0);
      await settlePreview(page);
      const animated = await counts(page);
      const attempts = await page.evaluate(() => window.probe.log.filter(e => e.type === 'request'));
      assert.equal(attempts.length, 2, 'both existing preview producers remain');
      assert.equal(attempts[0].busy, false);
      // Slow software WebGL can keep the first capture busy at the engine's
      // unchanged 60 ms timer. Only that existing busy guard may reject it.
      const accepted = attempts.filter(e => !e.busy).length;
      assert.equal(animated.readbacks, accepted);
      assert.equal(animated.writes, accepted);
      assert.equal(animated.successes, attempts[1].busy ? 0 : 1, 'existing engine preview toast remains deferred');
      t.diagnostic('Animated AutoPack: ' + JSON.stringify(animated));
      await page.evaluate(() => window.probe.mark());
      await page.click('#btn-unpack');
      await settlePreview(page);
      const unpack = await counts(page);
      assert.equal(unpack.readbacks, 1);
      assert.equal(unpack.writes, 1);
      assert.equal(await page.evaluate(() => window.probe.log.filter(e => e.type === 'render').length), 2);
      assert.equal(await page.evaluate(() => window.probe.results()), null);
      assert.deepEqual(await page.evaluate(() => window.probe.sceneMismatches()), []);
    });
    await t.test('301-case instant AutoPack keeps one valid preview', async () => {
      await page.evaluate(() => {
        const q = window.probe;
        q.reset();
        const seed = q.StateStore.snapshot();
        const base = seed.packLibrary[0].cases[0];
        seed.packLibrary[0].cases = Array.from({ length: 301 }, (_, i) => ({ ...structuredClone(base), id: 'instant-' + i }));
        q.StateStore.replace(seed);
        q.PackLibrary.open(q.packId); q.AppShell.navigate('editor'); q.mark();
      });
      await page.click('#btn-autopack');
      await page.waitForFunction(() => window.probe.op() === 'idle' && window.probe.results()?.options?.length > 0);
      await settlePreview(page);
      const instant = await counts(page);
      assert.equal(instant.readbacks, 1);
      assert.equal(instant.writes, 1);
      assert.equal(await page.evaluate(() => window.probe.counts().packed), 301);
    });
    assert.deepEqual(errors.filter(e => !e.includes('injected scene sync failure')), [], 'no uncaught error or unhandled rejection');
  } finally {
    await browser.close();
  }
});
