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
const subscriberStart = appSource.indexOf('StateStore.subscribe((changes, _state, notification) => {', subscriberAnchor);
const subscriberEnd = appSource.indexOf('\n      });\n\n      try {\n        Router.init(', subscriberStart);
assert.ok(subscriberAnchor >= 0 && subscriberStart > subscriberAnchor && subscriberEnd > subscriberStart,
  'app.js StateStore render subscriber is extractable');
const appSubscriber = appSource.slice(subscriberStart + 'StateStore.subscribe('.length, subscriberEnd + '\n      }'.length);
const schedulerStart = appSource.indexOf('const PREVIEW_RENDER_VERSION =');
const schedulerEnd = appSource.indexOf('\n\nconst TP3D_BUILD_STAMP', schedulerStart);
assert.ok(schedulerStart >= 0 && schedulerEnd > schedulerStart, 'app.js preview scheduler is extractable');
const previewScheduler = appSource.slice(schedulerStart, schedulerEnd);
const previewVersionCode = appSource.slice(schedulerStart, appSource.indexOf(';', schedulerStart) + 1);

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
const readbackCode = appSource.slice(readbackStart, readbackEnd)
  .replace('function renderCameraToDataUrl(', 'function productionRenderCameraToDataUrl(')
  .replace('function renderPreviewToDataUrl(', 'function productionRenderPreviewToDataUrl(');

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
import * as Normalizer from '/src/core/normalizer.js';
const { editorViewSignature, normalizeEditorView } = Normalizer;
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

${previewVersionCode}
${captureCode}
${readbackCode}
const getActiveWorkspaceKey = () => CoreStorage.getWorkspaceScope();
function renderCameraToDataUrl(...args) {
  const image = productionRenderCameraToDataUrl(...args);
  log.push({ type: 'readback', packId: StateStore.get('currentPackId'), screen: StateStore.get('currentScreen'), image });
  return image;
}
function renderPreviewToDataUrl(...args) {
  const image = productionRenderPreviewToDataUrl(...args);
  log.push({ type: 'readback', packId: StateStore.get('currentPackId'), screen: StateStore.get('currentScreen'), image });
  return image;
}
function capturePackPreview(id, options) {
  log.push({ type: 'request', at: performance.now(), packId: id, source: options?.source, beforeDeparture: options?.beforeDeparture, busy: OperationLifecycle.isBusy(), identity: Boolean(EditorUI.getPreviewScene()) });
  return productionCapturePackPreview(id, options).then(result => { log.push({ type: 'captureResult', at: performance.now(), result }); return result; });
}
const createPreviewScheduler = new Function(PREVIEW_SCHEDULER + '\\nreturn createPackPreviewScheduler;')();
const AutoPackPreviewScheduler = createPreviewScheduler({
  StateStore, PackLibrary, OperationLifecycle, capturePackPreview, getVisualSignature: pack => CaseScene.getVisualSignature(pack), getActiveWorkspaceKey: () => getActiveWorkspaceKey() + '|' + CoreStorage.captureScopeContext().generation,
  getViewSignature: pack => Normalizer.editorViewSignature(
    Normalizer.normalizeEditorView(pack.editorView) || SceneManager.getDefaultEditorView(pack.truck)),
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
EditorUI.setPreviewViewSettledCallback(() => AutoPackPreviewScheduler.schedule());
const PacksUI = createPacksScreen({
  Utils, UIComponents, PreferencesManager, PackLibrary, CaseLibrary, StateStore, TrailerPresets,
  ImportExport: {}, ImportPackDialog: {}, createTableFooter, AppShell, ExportService,
  CardDisplayOverlay: {}, TruckChangeController, OperationLifecycle, featureFlags: {},
  persistNow() {}, toast: (...args) => UIComponents.showToast(...args), toAscii: value => value,
});
PacksUI.init();
const Storage = { saveSoon() { log.push({ type: 'save' }); CoreStorage.saveSoon(); }, saveNow: CoreStorage.saveNow };
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
const realUpdate = PackLibrary.updatePreview;
PackLibrary.updatePreview = (id, patch, options) => {
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
  PacksUI: { render() { log.push({ type: 'packsRender' }); PacksUI.render(); } }, CasesUI: { render() { log.push({ type: 'casesRender' }); } }, RecoverableErrorOverlay: { syncRecoverableErrorOverlay() {} },
}));
OperationLifecycle.subscribe(state => log.push({ type: 'op', at: now(), kind: state.kind }));
AppShell.navigate('editor');
EditorUI.render();

const livePack = () => PackLibrary.getById(StateStore.get('currentPackId'));
window.probe = {
  EditorUI, CaseScene, SceneManager, InteractionManager, PackLibrary, CoreStorage, CaseLibrary, CategoryService, Normalizer, AutoPackEngine, AutoPackPreviewScheduler, ExportService, PacksUI,
  previewVersion: PREVIEW_RENDER_VERSION,
  renderPreview: productionRenderPreviewToDataUrl,
  renderLegacy: productionRenderCameraToDataUrl,
  snapshotImage: () => productionRenderPreviewToDataUrl(SceneManager.getCamera(), 640, 360),
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
  StateStore.replace(structuredClone(seed), { resetHistory: true });
  PackLibrary.getPacks().forEach(pack => {
    pack.thumbnailVisualSignature = CaseScene.getVisualSignature(pack);
    pack.thumbnailViewSignature = Normalizer.editorViewSignature(
      Normalizer.normalizeEditorView(pack.editorView) || SceneManager.getDefaultEditorView(pack.truck));
  });
  StateStore.resetHistory();
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
  await page.waitForTimeout(650); // Beyond the production debounce; detect duplicates.
  await page.waitForFunction(() => window.probe.op() === 'idle');
};
const openPack = (page, id = A) => page.evaluate(id => {
  const q = window.probe;
  q.PackLibrary.open(id);
  q.AppShell.navigate('editor');
}, id);

test('PR-B scheduler skips signature work for an empty Pack without a thumbnail but checks a stale image', () => {
  const createScheduler = new Function(`${previewScheduler}\nreturn createPackPreviewScheduler;`)();
  const pack = { id: 'empty', cases: [], thumbnail: null, thumbnailVisualSignature: null };
  let signatureCalls = 0;
  let viewSignatureCalls = 0;
  let captureCalls = 0;
  let timer = null;
  const scheduler = createScheduler({
    StateStore: { get: key => key === 'currentScreen' ? 'editor' : pack.id },
    PackLibrary: { getById: () => pack },
    OperationLifecycle: { isBusy: () => false, subscribe: () => () => {} },
    capturePackPreview: () => { captureCalls += 1; return true; },
    getActiveWorkspaceKey: () => 'fixture-a',
    getVisualSignature: () => { signatureCalls += 1; return 'current-signature'; },
    getViewSignature: () => { viewSignatureCalls += 1; return 'current-view'; },
    setTimer: fn => { timer = fn; return 1; },
    clearTimer: () => { timer = null; },
  });
  try {
    assert.equal(scheduler.schedule(), false);
    assert.equal(signatureCalls, 0);
    assert.equal(viewSignatureCalls, 0);
    assert.equal(captureCalls, 0);
    pack.thumbnail = 'data:image/png;base64,stale';
    pack.thumbnailVisualSignature = 'old-signature';
    assert.equal(scheduler.schedule(), true);
    assert.equal(signatureCalls, 1);
    assert.equal(viewSignatureCalls, 1);
    timer();
    assert.equal(captureCalls, 1, 'the stale image still reaches the capture path that clears empty Packs');
  } finally {
    scheduler.dispose();
  }
});

test('fidelity: Screenshot and all PDF views retain their original capture helper and options', () => {
  const calls = [], toasts = [], downloads = [];
  const camera = { name: 'perspective' }, topCam = { name: 'top' }, sideCam = { name: 'side' };
  const doc = {
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
    getNumberOfPages: () => 1, splitTextToSize: text => [text],
  };
  for (const method of ['setFontSize', 'setFont', 'text', 'addImage', 'addPage', 'line', 'setPage', 'save']) doc[method] = () => {};
  const dependencies = {
    window: { __TP3D_BILLING: { getBillingState: () => ({ ok: true }) }, jspdf: { jsPDF: function () { return doc; } } },
    BillingService: { getProRuleSet: () => ({ canUseProFeature: true }) },
    getCurrentPack: () => ({ title: 'Fixture', truck: {}, cases: [] }),
    PreferencesManager: { get: () => ({ export: { screenshotResolution: '1920x1080', pdfIncludeStats: false }, units: {} }) },
    Utils: { parseResolution: () => ({ width: 1920, height: 1080 }) },
    SceneManager: { getCamera: () => camera },
    PackLibrary: { computeStats: () => ({ totalWeight: 0 }) },
    ImportExport: { buildCargoInstructionsManifest: () => ({ caseEntries: [], itemEntries: [] }) },
    buildOrthoCameras: () => ({ topCam, sideCam }), buildChecklist: () => [],
    renderCameraToDataUrl: (...args) => { calls.push(args); return 'data:fixture'; },
    renderPreviewToDataUrl: () => { assert.fail('export must not use the preview path'); },
    downloadDataUrl: (...args) => downloads.push(args), safeName: () => 'fixture',
    UIComponents: { showToast: (...args) => toasts.push(args) },
  };
  const start = appSource.indexOf('      function captureScreenshot(');
  const end = appSource.indexOf('      function getCurrentPack()', start);
  const exports = new Function(...Object.keys(dependencies), `${appSource.slice(start, end)}\nreturn { captureScreenshot, generatePDF };`)(...Object.values(dependencies));
  exports.captureScreenshot(); exports.generatePDF();
  assert.deepEqual(calls, [
    [camera, 1920, 1080, { mimeType: 'image/png', hideGrid: true }],
    [camera, 960, 540, { mimeType: 'image/jpeg', quality: 0.92, hideGrid: true }],
    [topCam, 960, 520, { mimeType: 'image/jpeg', quality: 0.9, hideGrid: true }],
    [sideCam, 960, 420, { mimeType: 'image/jpeg', quality: 0.9, hideGrid: true }],
  ]);
  assert.equal(downloads.length, 1);
  assert.deepEqual(toasts.map(args => args.slice(0, 2)), [['Screenshot saved', 'success'], ['PDF exported', 'success']]);
});

test('PR-A real Chromium preview identity and navigation', { timeout: 240000 }, async t => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await t.test('fidelity: display colors match direct rendering in light and dark scenes, JPEG is 640x360 q0.80', async () => {
      await openPack(page);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        const renderer = q.SceneManager.getRenderer();
        const actualScene = q.SceneManager.getScene;
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
        camera.position.set(0, 0, 5);
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 2));
        const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#3b82f6' }));
        scene.add(cube);
        q.SceneManager.getScene = () => scene;
        const size = renderer.getSize(new THREE.Vector2());
        const ratio = renderer.getPixelRatio();
        const encode = HTMLCanvasElement.prototype.toDataURL;
        const results = [];
        try {
          for (const background of ['#f6f7fb', '#121318']) {
            scene.background = new THREE.Color(background);
            // Independent reference: normal framebuffer with the live settings.
            renderer.setRenderTarget(null);
            renderer.setDrawingBufferSize(640, 360, 1);
            renderer.setScissorTest(false);
            camera.aspect = 640 / 360;
            camera.updateProjectionMatrix();
            renderer.render(scene, camera);
            const reference = document.createElement('canvas');
            reference.width = 640; reference.height = 360;
            const referenceContext = reference.getContext('2d');
            referenceContext.drawImage(renderer.domElement, 0, 0);
            const expected = referenceContext.getImageData(0, 0, 640, 360).data;
            renderer.setDrawingBufferSize(size.x, size.y, ratio);
            camera.aspect = 1; camera.updateProjectionMatrix();
            let encoderArgs = null;
            let maxDifference = 0;
            HTMLCanvasElement.prototype.toDataURL = function (...args) {
              encoderArgs = args;
              const actual = this.getContext('2d').getImageData(0, 0, 640, 360).data;
              actual.forEach((value, index) => { maxDifference = Math.max(maxDifference, Math.abs(value - expected[index])); });
              return encode.apply(this, args);
            };
            const image = q.renderPreview(camera, 640, 360);
            const decoded = new Image(); decoded.src = image; await decoded.decode();
            referenceContext.drawImage(decoded, 0, 0);
            const corner = [...referenceContext.getImageData(0, 0, 1, 1).data];
            results.push({ background, encoderArgs, maxDifference, corner,
              width: decoded.naturalWidth, height: decoded.naturalHeight, jpeg: image.startsWith('data:image/jpeg;base64,') });
          }
        } finally {
          HTMLCanvasElement.prototype.toDataURL = encode;
          q.SceneManager.getScene = actualScene;
          renderer.setDrawingBufferSize(size.x, size.y, ratio);
          q.SceneManager.render();
          cube.geometry.dispose(); cube.material.dispose();
        }
        return results;
      });
      for (const result of proof) {
        assert.deepEqual(result.encoderArgs, ['image/jpeg', 0.8]);
        assert.equal(result.maxDifference, 0, 'lossless pre-encode pixels equal independently rendered display pixels');
        assert.equal(result.width, 640); assert.equal(result.height, 360); assert.equal(result.jpeg, true);
        const expected = result.background === '#121318' ? [18, 19, 24] : [246, 247, 251];
        assert.ok(expected.every((value, i) => Math.abs(result.corner[i] - value) <= 3), JSON.stringify(result));
      }
    });

    await t.test('fidelity: renderer, grid, projection, CSS and ownership restore on success and render/copy/encode/repaint failure', async () => {
      const proof = await page.evaluate(() => {
        const q = window.probe;
        const renderer = q.SceneManager.getRenderer();
        const scene = q.SceneManager.getScene();
        const camera = q.SceneManager.getCamera();
        const grid = scene.getObjectByName('grid');
        const render = renderer.render;
        const copy = CanvasRenderingContext2D.prototype.drawImage;
        const encode = HTMLCanvasElement.prototype.toDataURL;
        const originalRatio = renderer.getPixelRatio();
        const target = new THREE.WebGLRenderTarget(32, 32);
        const snapshot = () => ({
          size: renderer.getSize(new THREE.Vector2()).toArray(), ratio: renderer.getPixelRatio(),
          buffer: [renderer.domElement.width, renderer.domElement.height],
          css: renderer.domElement.style.cssText,
          rect: renderer.domElement.getBoundingClientRect().toJSON(),
          viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
          scissor: renderer.getScissor(new THREE.Vector4()).toArray(), scissorTest: renderer.getScissorTest(),
          target: renderer.getRenderTarget() === target,
          aspect: camera.aspect, projection: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray(),
          grid: grid.visible, autoClear: [renderer.autoClear, renderer.autoClearColor, renderer.autoClearDepth],
          tone: [renderer.toneMapping, renderer.toneMappingExposure, renderer.outputColorSpace],
          pack: JSON.stringify(q.PackLibrary.getById(q.packId)), view: q.EditorUI.getPreviewView()?.signature,
        });
        const results = [];
        try {
          for (const fault of ['none', 'render', 'copy', 'encode', 'repaint']) {
            renderer.setPixelRatio(2);
            renderer.setRenderTarget(target);
            renderer.setViewport(3, 4, 27, 25);
            renderer.setScissor(5, 6, 20, 21);
            renderer.setScissorTest(true);
            grid.visible = fault !== 'copy';
            const before = snapshot();
            const authority = q.EditorUI.getPreviewScene();
            let renders = 0; let axis = 0; let message = null;
            renderer.render = function (s, c) {
              renders++;
              if (s !== scene) axis++;
              if ((fault === 'render' && renders === 1) || (fault === 'repaint' && s !== scene)) throw new Error('injected ' + fault);
              return render.call(this, s, c);
            };
            CanvasRenderingContext2D.prototype.drawImage = function (...args) {
              if (fault === 'copy') throw new Error('injected copy');
              return copy.apply(this, args);
            };
            HTMLCanvasElement.prototype.toDataURL = function (...args) {
              if (fault === 'encode') throw new Error('injected encode');
              return encode.apply(this, args);
            };
            try { q.renderPreview(camera, 640, 360); } catch (error) { message = error.message; }
            results.push({ fault, message, before, after: snapshot(), axis,
              sameAuthority: q.EditorUI.getPreviewScene() === authority });
          }
        } finally {
          renderer.render = render;
          CanvasRenderingContext2D.prototype.drawImage = copy;
          HTMLCanvasElement.prototype.toDataURL = encode;
          renderer.setRenderTarget(null); renderer.setPixelRatio(originalRatio);
          renderer.setScissorTest(false); grid.visible = true;
          q.SceneManager.render(); target.dispose();
        }
        return results;
      });
      for (const result of proof) {
        assert.deepEqual(result.after, result.before, result.fault);
        assert.equal(result.message, result.fault === 'none' ? null : 'injected ' + result.fault);
        assert.equal(result.sameAuthority, true);
        assert.equal(result.axis, 1, 'axis restored on the normal repaint only');
      }
    });

    await t.test('fidelity: oversized preview is rejected without replacing the image or its version', async () => {
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
        const pack = q.PackLibrary.getById(q.packId);
        const encode = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,' + 'A'.repeat(204804);
        q.mark();
        let accepted;
        try { accepted = await q.ExportService.capturePackPreview(q.packId, { source: 'manual' }); }
        finally { HTMLCanvasElement.prototype.toDataURL = encode; }
        return { accepted, samePack: pack === q.PackLibrary.getById(q.packId), op: q.op(),
          writes: q.log.filter(e => e.type === 'write').length,
          message: q.log.find(e => e.type === 'toast')?.message };
      });
      assert.equal(proof.accepted, false); assert.equal(proof.samePack, true);
      assert.equal(proof.op, 'idle'); assert.equal(proof.writes, 0);
      assert.match(proof.message, /Preview too large/);
    });

    for (const legacyVersion of [null, 1]) {
      await t.test(`fidelity: legacy version ${legacyVersion} refreshes once without refreshing other Packs or cleared previews`, async () => {
        await page.evaluate(async legacyVersion => {
          const q = window.probe;
          q.reset(); q.PackLibrary.open(q.packId); q.AppShell.navigate('editor');
          await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
          q.AppShell.navigate('packs');
          const image = q.PackLibrary.getById(q.packId).thumbnail;
          q.PackLibrary.updatePreview(q.packId, { thumbnailRenderVersion: legacyVersion });
          q.PackLibrary.updatePreview(q.otherPackId, { thumbnail: image, thumbnailRenderVersion: 1 });
          q.mark();
        }, legacyVersion);
        await openPack(page);
        await settlePreview(page);
        assert.equal((await counts(page)).readbacks, 1);
        assert.deepEqual(await page.evaluate(() => {
          const q = window.probe;
          return [q.PackLibrary.getById(q.packId).thumbnailRenderVersion, q.PackLibrary.getById(q.otherPackId).thumbnailRenderVersion];
        }), [2, 1]);
        await page.evaluate(() => { const q = window.probe; q.AppShell.navigate('packs'); q.mark(); });
        await openPack(page);
        await settlePreview(page);
        assert.equal((await counts(page)).readbacks, 0);
        await page.evaluate(() => {
          const q = window.probe;
          q.ExportService.clearPackPreview(q.packId);
          q.AppShell.navigate('packs');
          // Legacy Clear metadata has no version, but matching visual/view signatures.
          q.PackLibrary.updatePreview(q.packId, { thumbnailRenderVersion: null });
          q.mark();
        });
        await openPack(page);
        await settlePreview(page);
        assert.equal((await counts(page)).readbacks, 0);
        assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById(window.probe.packId).thumbnail), null);
      });
    }

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
        // Inject unknown freshness only; the pose comes from real pointer input.
        q.PackLibrary.getById(q.otherPackId).thumbnailVisualSignature = null;
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
          const cases = structuredClone(q.PackLibrary.getById(q.packId).cases);
          cases[0].transform.position.x += 10;
          q.PackLibrary.update(q.packId, { cases });
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
        q.PackLibrary.getById(q.packId).thumbnailVisualSignature = null;
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

    await t.test('PR-B animated AutoPack and Unpack each capture quietly once without preview render', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      await page.evaluate(() => window.probe.mark());
      await page.click('#btn-autopack');
      await page.waitForFunction(() => window.probe.op() === 'idle' && window.probe.results()?.options?.length > 0);
      await settlePreview(page);
      const animated = await counts(page);
      const attempts = await page.evaluate(() => window.probe.log.filter(e => e.type === 'request'));
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].busy, false);
      assert.equal(animated.readbacks, 1);
      assert.equal(animated.writes, 1);
      assert.equal(animated.successes, 0);
      t.diagnostic('Animated AutoPack: ' + JSON.stringify(animated));
      await page.evaluate(() => window.probe.mark());
      await page.click('#btn-unpack');
      await settlePreview(page);
      const unpack = await counts(page);
      assert.equal(unpack.readbacks, 1);
      assert.equal(unpack.writes, 1);
      assert.equal(await page.evaluate(() => window.probe.log.filter(e => e.type === 'render').length), 1);
      assert.equal(await page.evaluate(() => window.probe.log.filter(e => e.type === 'sync').length), 1);
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
        document.getElementById('btn-autopack').click();
      });
      await page.waitForFunction(() => window.probe.op() === 'idle' && window.probe.results()?.options?.length > 0);
      await settlePreview(page);
      const instant = await counts(page);
      assert.equal(instant.readbacks, 1);
      assert.equal(instant.writes, 1);
      assert.equal(instant.requests, 1);
      assert.equal(instant.successes, 0);
      assert.equal(await page.evaluate(() => window.probe.counts().packed), 301);
    });

    await t.test('PR-B updatePreview ignores non-object patches without changing preview metadata', async () => {
      const proof = await page.evaluate(() => {
        const q = window.probe;
        q.reset();
        q.CorePackLibrary.updatePreview(q.packId, {
          thumbnail: 'data:image/png;base64,fixture', thumbnailUpdatedAt: 123,
          thumbnailSource: 'manual', thumbnailVisualSignature: 'fixture-signature',
          thumbnailViewSignature: 'fixture-view', thumbnailRenderVersion: 2,
        });
        const before = q.PackLibrary.getById(q.packId);
        const fields = pack => ({
          thumbnail: pack.thumbnail, thumbnailUpdatedAt: pack.thumbnailUpdatedAt,
          thumbnailSource: pack.thumbnailSource, thumbnailVisualSignature: pack.thumbnailVisualSignature,
          thumbnailViewSignature: pack.thumbnailViewSignature, thumbnailRenderVersion: pack.thumbnailRenderVersion,
          lastEdited: pack.lastEdited, stats: pack.stats,
        });
        const expected = fields(before);
        const results = [null, undefined, false, 42, 'invalid', []].map(patch => {
          const updated = q.CorePackLibrary.updatePreview(q.packId, patch);
          return { sameFields: JSON.stringify(fields(updated)) === JSON.stringify(expected), sameStats: updated.stats === before.stats };
        });
        return results;
      });
      assert.deepEqual(proof, Array.from({ length: 6 }, () => ({ sameFields: true, sameStats: true })));
    });

    await t.test('PR-B preview write persists, refreshes Packs only, preserves camera and scene authority', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        q.mark();
        const pack = q.PackLibrary.getById(q.packId);
        const stats = pack.stats;
        const target = q.SceneManager.getControls().target;
        target.set(31, 12, -17);
        const before = target.toArray();
        const result = await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
        q.CoreStorage.saveNow();
        const saved = Object.values(localStorage).map(v => { try { return JSON.parse(v); } catch { return null; } })
          .find(v => v?.packLibrary?.some(p => p.id === q.packId));
        const stored = saved.packLibrary.find(p => p.id === q.packId);
        const normalized = q.Normalizer.normalizeAppData(saved).packLibrary.find(p => p.id === q.packId);
        const current = q.PackLibrary.getById(q.packId);
        const identity = q.EditorUI.getPreviewScene();
        return {
          result, before, after: target.toArray(), statsSame: stats === current.stats,
          lastEditedSame: pack.lastEdited === current.lastEdited,
          persisted: stored.thumbnail === current.thumbnail && stored.thumbnailVisualSignature === current.thumbnailVisualSignature && stored.thumbnailRenderVersion === 2,
          normalized: normalized.thumbnailVisualSignature === current.thumbnailVisualSignature && normalized.thumbnailRenderVersion === 2,
          runtimeOnly: !Object.hasOwn(q.StateStore.snapshot(), 'notification') && !Object.hasOwn(stored, 'notification'),
          authoritative: identity?.pack === current && q.CaseScene.getSyncedPack() === current,
          logs: q.log.map(e => e.type),
        };
      });
      assert.equal(proof.result, true);
      assert.equal(proof.persisted, true);
      assert.equal(proof.normalized, true);
      assert.equal(proof.runtimeOnly, true);
      assert.equal(proof.statsSame, true);
      assert.equal(proof.lastEditedSame, true);
      assert.equal(proof.authoritative, true);
      assert.ok(proof.after.every((value, index) => Math.abs(value - proof.before[index]) < 1e-10), 'camera target is unchanged within floating-point precision');
      assert.equal(proof.logs.filter(e => e === 'save').length, 1);
      assert.equal(proof.logs.filter(e => e === 'packsRender').length, 1);
      for (const type of ['render', 'sync', 'casesRender', 'subscriberRender']) assert.equal(proof.logs.includes(type), false, type);
    });

    for (const [kind, expected] of [['notes', 0], ['position', 1], ['name', 1], ['appearance', 1], ['category', 1], ['shadowedColor', 0], ['irrelevant', 0]]) {
      await t.test('PR-B freshness filters ' + kind, async () => {
        await page.evaluate(() => window.probe.reset());
        await openPack(page);
        await page.evaluate(kind => {
          const q = window.probe;
          q.mark();
          const pack = q.PackLibrary.getById(q.packId);
          if (kind === 'notes') q.PackLibrary.update(q.packId, { notes: 'nonvisual edit' });
          else if (kind === 'position') {
            const cases = structuredClone(pack.cases); cases[0].transform.position.x += 15;
            q.PackLibrary.update(q.packId, { cases });
          } else {
            const library = structuredClone(q.StateStore.get('caseLibrary'));
            const data = library.find(c => c.id === (kind === 'irrelevant' ? 'red-crate' : 'qa-carton'));
            if (kind === 'appearance') data.isPallet = true; // Current renderer uses wood material and pallet labels.
            else if (kind === 'category') data.category = 'preview-blue';
            else if (kind === 'shadowedColor') data.color = '#ffeedd'; // Category color wins in the current renderer.
            else data.name += ' changed';
            q.StateStore.set({ caseLibrary: library });
          }
        }, kind);
        await settlePreview(page);
        const result = await counts(page);
        assert.equal(result.readbacks, expected);
        assert.equal(result.writes, expected);
        assert.equal(result.successes, 0);
      });
    }

    await t.test('PR-B signature tracks current rendering fields with deterministic ordering', async () => {
      await page.evaluate(() => window.probe.reset());
      const proof = await page.evaluate(() => {
        const q = window.probe;
        const base = q.PackLibrary.getById(q.packId);
        const signature = pack => q.CaseScene.getVisualSignature(pack);
        const original = signature(base);
        const modified = edit => { const pack = structuredClone(base); edit(pack); return signature(pack); };
        const changed = [
          p => { p.truck.width += 1; }, p => { p.truck.shapeMode = 'wheelWells'; p.truck.shapeConfig = { wellHeight: 20 }; },
          p => { p.cases[0].transform.rotation.y = 1; }, p => { p.cases[0].hidden = true; },
          p => { p.cases[0].placement = 'packed'; }, p => { p.cases[0].orientedDims = { length: 8, width: 10, height: 12 }; },
        ].every(edit => modified(edit) !== original);
        const ignored = modified(p => {
          p.notes = 'n'; p.client = 'c'; p.title = 't'; p.projectName = 'p'; p.drawnBy = 'd'; p.lastEdited = 999999;
          p.thumbnail = 'data:irrelevant'; p.thumbnailVisualSignature = 'irrelevant'; p.customerReference = 'r';
          p.loadPlanNumber = 'LP-1234'; p.cases[0].transform.scale.x = 2;
          p.cases.reverse();
        }) === original;
        const a = { ...base, truck: { ...base.truck, shapeMode: 'wheelWells', shapeConfig: { wellWidth: 10, wellHeight: 20 } } };
        const b = { ...a, truck: { ...a.truck, shapeConfig: { wellHeight: 20, wellWidth: 10 } } };
        return { changed, ignored, ordered: signature(a) === signature(b) };
      });
      assert.deepEqual(proof, { changed: true, ignored: true, ordered: true });
    });

    await t.test('PR-B legacy future-clock Pack settles once and stays fresh after reload', async () => {
      await page.evaluate(() => {
        const q = window.probe; q.reset();
        const pack = q.PackLibrary.getById(q.packId);
        delete pack.thumbnailVisualSignature;
        pack.lastEdited = Date.now() + 1000000000000;
      });
      await openPack(page);
      await settlePreview(page);
      assert.equal((await counts(page)).writes, 1);
      await page.evaluate(() => {
        const q = window.probe;
        q.StateStore.replace(q.Normalizer.normalizeAppData(q.StateStore.snapshot()));
        q.AutoPackPreviewScheduler.schedule(); q.mark();
      });
      await settlePreview(page);
      assert.equal((await counts(page)).readbacks, 0);
    });

    await t.test('PR-B visual equivalence cannot authorize an ordinary unsynchronized Pack replacement', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      const rejected = await page.evaluate(() => {
        const q = window.probe;
        q.StateStore.set({ packLibrary: q.PackLibrary.getPacks().map(p => ({ ...p })) }, { skipNotify: true, skipHistory: true });
        return q.EditorUI.getPreviewScene() === null;
      });
      assert.equal(rejected, true);
    });

    await t.test('PR-B Case Library changes during frame wait reject the old scene/signature', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      const accepted = await page.evaluate(async () => {
        const q = window.probe; q.mark();
        const promise = q.ExportService.capturePackPreview(q.packId, { source: 'auto' });
        await new Promise(requestAnimationFrame);
        const library = structuredClone(q.StateStore.get('caseLibrary'));
        library[0].name = 'Changed during frame';
        q.StateStore.set({ caseLibrary: library });
        return promise;
      });
      assert.equal(accepted, false);
      await settlePreview(page);
      assert.equal((await counts(page)).writes, 1, 'only the replacement request captures final visual state');
      assert.equal((await counts(page)).successes, 0);
    });

    await t.test('PR-B deleting final cargo clears image without readback, render or history step', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      await page.evaluate(async () => {
        const q = window.probe;
        await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
        q.StateStore.resetHistory(); q.mark();
        q.PackLibrary.update(q.packId, { cases: [] });
      });
      await settlePreview(page);
      const proof = await page.evaluate(() => {
        const q = window.probe; const pack = q.PackLibrary.getById(q.packId);
        const cleared = pack.thumbnail === null && pack.thumbnailVisualSignature === q.CaseScene.getVisualSignature(pack);
        const renders = q.log.filter(e => e.type === 'render').length;
        const syncs = q.log.filter(e => e.type === 'sync').length;
        const reads = q.log.filter(e => e.type === 'readback').length;
        const undo = q.StateStore.undo();
        return { cleared, renders, syncs, reads, undo, restored: Boolean(q.PackLibrary.getById(q.packId).thumbnail),
          cases: q.PackLibrary.getById(q.packId).cases.length, extraUndo: q.StateStore.undo() };
      });
      assert.deepEqual(proof, { cleared: true, renders: 1, syncs: 1, reads: 0, undo: true, restored: true, cases: TOTAL, extraUndo: false });
    });

    await t.test('PR-B Clear stays cleared on reopen; Undo/Redo restore metadata; visual edits recapture', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      const history = await page.evaluate(async () => {
        const q = window.probe;
        await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
        const previous = q.PackLibrary.getById(q.packId);
        const image = previous.thumbnail; const signature = previous.thumbnailVisualSignature;
        q.ExportService.clearPackPreview(q.packId);
        const undo = q.StateStore.undo(); const restored = q.PackLibrary.getById(q.packId);
        const matches = restored.thumbnail === image && restored.thumbnailVisualSignature === signature;
        const redo = q.StateStore.redo();
        q.AppShell.navigate('packs'); q.mark(); q.AppShell.navigate('editor');
        return { undo, matches, redo, cleared: q.PackLibrary.getById(q.packId).thumbnail === null };
      });
      assert.deepEqual(history, { undo: true, matches: true, redo: true, cleared: true });
      await settlePreview(page);
      assert.equal((await counts(page)).writes, 0);
      await page.evaluate(() => {
        const q = window.probe; q.mark();
        const cases = structuredClone(q.PackLibrary.getById(q.packId).cases);
        cases[0].transform.position.x += 10; q.PackLibrary.update(q.packId, { cases });
      });
      await settlePreview(page);
      assert.equal((await counts(page)).writes, 1);
    });

    await t.test('PR-B rapid Undo/Redo captures final state once; capture preserves Redo', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page);
      await page.evaluate(() => {
        const q = window.probe; q.mark();
        const cases = structuredClone(q.PackLibrary.getById(q.packId).cases);
        cases[0].transform.position.x += 30;
        q.PackLibrary.update(q.packId, { cases });
        q.StateStore.undo(); q.StateStore.redo();
      });
      await settlePreview(page);
      assert.equal((await counts(page)).writes, 1);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        q.StateStore.undo();
        await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
        return { redo: q.StateStore.redo(), signature: q.PackLibrary.getById(q.packId).thumbnailVisualSignature };
      });
      assert.equal(proof.redo, true);
    });

    await t.test('Camera A/B views restore independently; settled orbit saves once and refreshes only A', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, A);
      const before = await page.evaluate(() => {
        const q = window.probe;
        q.mark();
        const controls = q.SceneManager.getControls();
        const defaultA = q.SceneManager.getEditorView();
        controls.dispatchEvent({ type: 'start' });
        q.SceneManager.getCamera().position.x += 6;
        controls.update();
        controls.dispatchEvent({ type: 'change' });
        controls.dispatchEvent({ type: 'change' });
        const during = q.PackLibrary.getById(q.packId).editorView;
        controls.dispatchEvent({ type: 'end' });
        return { defaultA, during };
      });
      assert.equal(before.during ?? null, null, 'change events do not persist an intermediate pose');
      await settlePreview(page);
      const savedA = await page.evaluate(() => {
        const q = window.probe;
        const pack = q.PackLibrary.getById(q.packId);
        return { view: pack.editorView, signature: pack.thumbnailViewSignature,
          expected: q.Normalizer.editorViewSignature(pack.editorView),
          writes: q.log.filter(e => e.type === 'write').length };
      });
      assert.notDeepEqual(savedA.view, before.defaultA);
      assert.equal(savedA.signature, savedA.expected);
      assert.equal(savedA.writes, 1, 'camera only refreshes the thumbnail once');
      await openPack(page, B);
      const initialB = await page.evaluate(() => window.probe.SceneManager.getEditorView());
      assert.notDeepEqual(initialB, savedA.view, 'B starts from its own default');
      await page.evaluate(() => {
        const q = window.probe;
        const controls = q.SceneManager.getControls();
        controls.dispatchEvent({ type: 'start' });
        q.SceneManager.getCamera().position.z += 7;
        controls.update();
        controls.dispatchEvent({ type: 'end' });
      });
      await settlePreview(page);
      const savedB = await page.evaluate(() => window.probe.PackLibrary.getById(window.probe.otherPackId).editorView);
      assert.notDeepEqual(savedB, savedA.view);
      await openPack(page, A);
      assert.deepEqual(await page.evaluate(() => window.probe.SceneManager.getEditorView()), savedA.view);
      await page.evaluate(() => window.probe.EditorUI.render());
      assert.deepEqual(await page.evaluate(() => window.probe.SceneManager.getEditorView()), savedA.view,
        'same-Pack render keeps the established view');
      await openPack(page, B);
      assert.deepEqual(await page.evaluate(() => window.probe.SceneManager.getEditorView()), savedB);
      const hydratedB = await page.evaluate(() => {
        const q = window.probe;
        q.CoreStorage.saveNow();
        const loaded = q.CoreStorage.load();
        if (!loaded?.packLibrary?.find(pack => pack.id === q.otherPackId)?.editorView) return null;
        q.StateStore.replace({ ...q.StateStore.snapshot(), ...loaded, currentScreen: 'editor' },
          { resetHistory: true });
        return q.SceneManager.getEditorView();
      });
      assert.deepEqual(hydratedB, savedB, 'persisted pose restores through the workspace storage load path');
      assert.deepEqual(await page.evaluate(() => window.probe.PackLibrary.getById(window.probe.packId).editorView), savedA.view,
        'B never overwrites A metadata');
    });

    await t.test('moving view rejects mid-orbit capture; focus saves its final pose; empty Pack avoids readback', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, A);
      const mid = await page.evaluate(async () => {
        const q = window.probe;
        q.mark();
        const controls = q.SceneManager.getControls();
        controls.dispatchEvent({ type: 'start' });
        q.SceneManager.getCamera().position.x += 4;
        controls.update();
        const accepted = await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
        const reads = q.log.filter(e => e.type === 'readback').length;
        controls.dispatchEvent({ type: 'end' });
        return { accepted, reads };
      });
      assert.deepEqual(mid, { accepted: false, reads: 0 });
      await settlePreview(page);
      assert.equal((await counts(page)).readbacks, 1, 'settled view captures once');
      await page.evaluate(() => {
        const q = window.probe;
        q.mark();
        q.SceneManager.focusOnWorldPoint(q.SceneManager.getControls().target.clone().addScalar(3), { duration: 90 });
      });
      await settlePreview(page);
      const focus = await page.evaluate(() => {
        const q = window.probe;
        return { saved: q.Normalizer.editorViewSignature(q.PackLibrary.getById(q.packId).editorView),
          live: q.EditorUI.getPreviewView()?.signature,
          writes: q.log.filter(e => e.type === 'write').length };
      });
      assert.equal(focus.saved, focus.live);
      assert.equal(focus.writes, 1);
      await openPack(page, 'empty-pack');
      await page.evaluate(() => {
        const q = window.probe;
        q.mark();
        const controls = q.SceneManager.getControls();
        controls.dispatchEvent({ type: 'start' });
        q.SceneManager.getCamera().position.x += 5;
        controls.update();
        controls.dispatchEvent({ type: 'end' });
      });
      await settlePreview(page);
      assert.equal((await counts(page)).readbacks, 0);
      assert.ok(await page.evaluate(() => window.probe.PackLibrary.getById('empty-pack').editorView));
    });

    await t.test('Clear stays intentional until camera changes; scope generation invalidates view authority', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, A);
      const manual = await page.evaluate(async () => {
        const q = window.probe;
        const captured = await q.ExportService.capturePackPreview(q.packId, { source: 'manual' });
        return { captured,
          stored: q.PackLibrary.getById(q.packId).thumbnailViewSignature,
          live: q.EditorUI.getPreviewView()?.signature };
      });
      assert.equal(manual.captured, true);
      assert.equal(manual.stored, manual.live, 'manual capture writes view freshness');
      await page.evaluate(() => {
        const q = window.probe;
        q.AppShell.navigate('packs');
        q.ExportService.clearPackPreview(q.packId);
        q.AppShell.navigate('editor');
        q.mark();
      });
      await settlePreview(page);
      assert.equal((await counts(page)).readbacks, 0);
      await page.evaluate(() => {
        const q = window.probe;
        const controls = q.SceneManager.getControls();
        controls.dispatchEvent({ type: 'start' });
        q.SceneManager.getCamera().position.z += 5;
        controls.update();
        controls.dispatchEvent({ type: 'end' });
      });
      await settlePreview(page);
      assert.equal((await counts(page)).readbacks, 1);
      assert.equal(await page.evaluate(() => {
        const q = window.probe;
        q.CoreStorage.setWorkspaceScope('fixture-new-generation');
        return q.EditorUI.getPreviewView();
      }), null);
      await page.evaluate(() => window.probe.reset());
    });

    await t.test('two rapid orbit endings coalesce to one preview; immediate departure saves the final view', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, A);
      const departure = await page.evaluate(() => {
        const q = window.probe;
        q.mark();
        const controls = q.SceneManager.getControls();
        for (let i = 0; i < 2; i += 1) {
          controls.dispatchEvent({ type: 'start' });
          q.SceneManager.getCamera().position.x += 3;
          controls.update();
          controls.dispatchEvent({ type: 'end' });
        }
        q.AppShell.navigate('packs');
        return { saved: q.PackLibrary.getById(q.packId).editorView,
          signature: q.PackLibrary.getById(q.packId).thumbnailViewSignature,
          reads: q.log.filter(e => e.type === 'readback').length };
      });
      assert.ok(departure.saved);
      assert.equal(departure.reads, 1, 'the departure flush captures the final settled view once');
      await openPack(page, A);
      await settlePreview(page);
      const after = await page.evaluate(() => {
        const q = window.probe;
        return { view: q.SceneManager.getEditorView(),
          stored: q.PackLibrary.getById(q.packId).editorView,
          signature: q.PackLibrary.getById(q.packId).thumbnailViewSignature,
          viewSignature: q.Normalizer.editorViewSignature(q.SceneManager.getEditorView()),
          reads: q.log.filter(e => e.type === 'readback').length };
      });
      assert.deepEqual(after.view, after.stored);
      assert.equal(after.reads, 1, 'reopening needs no duplicate preview');
      assert.equal(after.signature, after.viewSignature);
    });

    assert.deepEqual(errors.filter(e => !e.includes('injected scene sync failure')), [], 'no uncaught error or unhandled rejection');
  } finally {
    await browser.close();
  }
});
