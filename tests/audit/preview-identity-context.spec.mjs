import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import * as THREE from 'three';
import * as CoreUtils from '../../src/core/utils/index.js';

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
const captureCode = appSource.slice(captureStart, captureEnd).replace('async function capturePackPreview(', 'async function productionCapturePackPreview(')
  // Export Integrity C: these suites issue separate programmatic exports back to
  // back; the double-click hold is proven in export-integrity-c.spec.mjs.
  .replace('Utils.createDownloadActionGuard()', 'Utils.createDownloadActionGuard({ schedule: release => release() })');
const readbackCode = appSource.slice(readbackStart, readbackEnd)
  .replace('function renderCameraToDataUrl(', 'function productionRenderCameraToDataUrl(')
  .replace('function renderPreviewToDataUrl(', 'function productionRenderPreviewToDataUrl(');
// Export Integrity A: the production Screenshot/PDF service (authority, clean
// capture, truck-centric Top/Side cameras) between the preview and readback code.
const exportCode = appSource.slice(captureEnd, readbackStart);
assert.ok(exportCode.includes('function generatePDF(') && exportCode.includes('function captureExportViews('),
  'app.js Screenshot/PDF export service is extractable');

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
import * as ImportExport from '/src/services/import-export.js';
import { createCasesScreen } from '/src/screens/cases-screen.js';

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
${exportCode}
const BillingService = { getProRuleSet: () => ({ canUseProFeature: true }) };
function openSettingsOverlay() {}
const getActiveWorkspaceKey = () => CoreStorage.getWorkspaceScope();
// Scene state an export view is rendered with (after its clean-capture setup).
function exportCaptureState() {
  const scene = SceneManager.getScene();
  const groups = {};
  (livePack()?.cases || []).forEach(inst => {
    const obj = CaseScene.getObject(inst.id);
    if (!obj) return;
    const mesh = obj.userData.mesh;
    const material = mesh && (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    groups[inst.id] = { visible: obj.visible, emissive: material && material.emissive ? material.emissive.getHex() : null };
  });
  return {
    background: scene.background ? scene.background.getHexString() : null,
    gizmo: CaseScene.getGizmoHandleMeshes().length > 0,
    grid: scene.getObjectByName('grid').visible,
    groups,
  };
}
function renderCameraToDataUrl(camera, width, height, options) {
  const state = exportCaptureState();
  const image = productionRenderCameraToDataUrl(camera, width, height, options);
  log.push({ type: 'readback', packId: StateStore.get('currentPackId'), screen: StateStore.get('currentScreen'), image,
    exportView: { camera, width, height, options, state } });
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

const ExportService = { captureScreenshot, generatePDF, capturePackPreview, clearPackPreview, capturePackPreviewFromLibrary, flushPackPreviewBeforeNavigation };
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
  ImportExport, ImportPackDialog: {}, createTableFooter, AppShell, ExportService,
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
  // ── Export Integrity A ────────────────────────────────────────────────
  downloads: null,
  pdfs: [],
  pdfFault: null,
  // Lazily installed so earlier suites run with unmodified browser APIs.
  installExportRecorders() {
    if (this.downloads) return;
    const q = this;
    const downloads = [];
    const blobs = new Map();
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = blob => { const url = createObjectURL.call(URL, blob); blobs.set(url, blob); return url; };
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.hasAttribute('download')) return anchorClick.call(this);
      downloads.push({ name: this.download, href: this.href, blob: blobs.get(this.href) || null });
      return undefined;
    };
    this.downloads = downloads;
    this.makePdf = () => {
      const doc = {
        pages: 1, images: [], texts: [], saved: null,
        internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
        setFontSize() {}, setFont() {}, line() {}, setPage() {},
        text(value, x, y) { doc.texts.push({ value, x, y, page: doc.pages }); },
        splitTextToSize: text => String(text).split('\\n'),
        getTextWidth: text => String(text).length * 5,
        addImage(data, format, x, y, w, h) {
          if (q.pdfFault === 'addImage') throw new Error('injected export fault: addImage');
          doc.images.push({ data, format, x, y, w, h, page: doc.pages });
        },
        addPage() { doc.pages += 1; },
        getNumberOfPages: () => doc.pages,
        save(name) { doc.saved = name; },
      };
      q.pdfs.push(doc);
      return doc;
    };
  },
  exportPdf() {
    const q = this;
    const before = q.pdfs.length;
    window.jspdf = { jsPDF: function () { return q.makePdf(); } };
    ExportService.generatePDF();
    return q.pdfs.length > before ? q.pdfs[q.pdfs.length - 1] : null;
  },
  exportViews() { return log.filter(e => e.type === 'readback' && e.exportView).map(e => e.exportView); },
  exportState() {
    const renderer = SceneManager.getRenderer();
    const camera = SceneManager.getCamera();
    return {
      size: renderer.getSize(new THREE.Vector2()).toArray(), ratio: renderer.getPixelRatio(),
      buffer: [renderer.domElement.width, renderer.domElement.height],
      viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
      scissor: renderer.getScissor(new THREE.Vector4()).toArray(), scissorTest: renderer.getScissorTest(),
      target: renderer.getRenderTarget(),
      autoClear: [renderer.autoClear, renderer.autoClearColor, renderer.autoClearDepth],
      tone: [renderer.toneMapping, renderer.toneMappingExposure, renderer.outputColorSpace],
      aspect: camera.aspect, projection: camera.projectionMatrix.toArray(), position: camera.position.toArray(),
      selection: StateStore.get('selectedInstanceIds'),
      scene: exportCaptureState(),
    };
  },
  async decodeImage(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  },
  // Independent references: the live display framebuffer, and the legacy
  // ordinary render-target readback that Screenshot/PDF used before.
  referenceDisplay(camera, width, height) {
    const renderer = SceneManager.getRenderer();
    const scene = SceneManager.getScene();
    const grid = scene.getObjectByName('grid');
    const gridVisible = grid.visible;
    const size = renderer.getSize(new THREE.Vector2());
    const ratio = renderer.getPixelRatio();
    const aspect = camera.aspect;
    const projection = camera.projectionMatrix.clone();
    const inverse = camera.projectionMatrixInverse.clone();
    try {
      grid.visible = false;
      renderer.setRenderTarget(null);
      renderer.setDrawingBufferSize(width, height, 1);
      renderer.setScissorTest(false);
      if (camera.isPerspectiveCamera) { camera.aspect = width / height; camera.updateProjectionMatrix(); }
      renderer.render(scene, camera);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(renderer.domElement, 0, 0);
      return context.getImageData(0, 0, width, height).data;
    } finally {
      grid.visible = gridVisible;
      if (camera.isPerspectiveCamera) camera.aspect = aspect;
      camera.projectionMatrix.copy(projection);
      camera.projectionMatrixInverse.copy(inverse);
      renderer.setDrawingBufferSize(size.x, size.y, ratio);
      SceneManager.render();
    }
  },
  referenceLegacy(camera, width, height) {
    const renderer = SceneManager.getRenderer();
    const scene = SceneManager.getScene();
    const grid = scene.getObjectByName('grid');
    const gridVisible = grid.visible;
    const aspect = camera.aspect;
    const target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat });
    const pixels = new Uint8Array(width * height * 4);
    try {
      grid.visible = false;
      renderer.setRenderTarget(target);
      if (camera.isPerspectiveCamera) { camera.aspect = width / height; camera.updateProjectionMatrix(); }
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } finally {
      renderer.setRenderTarget(null);
      grid.visible = gridVisible;
      if (camera.isPerspectiveCamera) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
      target.dispose();
      SceneManager.render();
    }
    const flipped = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) flipped.set(pixels.subarray((height - y - 1) * width * 4, (height - y) * width * 4), y * width * 4);
    return flipped;
  },
  // Lossless pre-encode pixels of every canvas an export encodes.
  async captureEncodes(fn) {
    const encode = HTMLCanvasElement.prototype.toDataURL;
    const frames = [];
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      frames.push({ width: this.width, height: this.height, args,
        pixels: this.getContext('2d').getImageData(0, 0, this.width, this.height).data });
      return encode.apply(this, args);
    };
    try { await fn(); } finally { HTMLCanvasElement.prototype.toDataURL = encode; }
    return frames;
  },
  maxDifference(a, b) {
    if (a.length !== b.length) return Infinity;
    let max = 0;
    for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
    return max;
  },
  ensureCasesUI() {
    if (!this.CasesUI) {
      this.CasesUI = createCasesScreen({
        Utils, UIComponents, PreferencesManager, CaseLibrary, PackLibrary, CategoryService, StateStore, ImportExport,
        ImportCasesDialog: {}, createTableFooter, CardDisplayOverlay: {}, OperationLifecycle,
      });
      this.CasesUI.init();
    }
    return this.CasesUI;
  },
  menuItem(label) {
    return [...document.querySelectorAll('.dropdown-menu .dropdown-item')].find(el => el.textContent.trim() === label) || null;
  },
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

// ── Export Integrity A: service boundary (Node) ──────────────────────────────
// The production Screenshot/PDF service with recorded collaborators. It proves
// the execution-time authority gate, the supported size bounds, the print
// background, the truck-centric exclusions, one-scale orthographic framing and
// restoration on failure. Real pixels are proven in Chromium below.
const exportConstantsCode = appSource.slice(appSource.indexOf('      const SCREENSHOT_RESOLUTIONS ='), captureEnd);
assert.ok(exportConstantsCode.includes('PDF_PRINT_BACKGROUND'), 'export constants are extractable');
const INCH = 0.05;
const worldBox = (x0, y0, z0, x1, y1, z1) => ({
  min: { x: x0 * INCH, y: y0 * INCH, z: z0 * INCH }, max: { x: x1 * INCH, y: y1 * INCH, z: z1 * INCH },
});

function loadExportService({
  busy = false, exportScene = 'current', currentPackId = 'fixture', resolution = '1920x1080',
  captureFault = null, authorityChangesAfterCapture = false,
} = {}) {
  // 240 in rect body + 96 in Front Overhang (x 240..336), 96 in wide, 100 in tall.
  const pack = {
    id: 'fixture', title: 'Fixture Plan',
    truck: { length: 240, width: 96, height: 100, shapeMode: 'frontBonus', shapeConfig: { bonusLength: 96, bonusHeight: 45 } },
    cases: ['inside', 'overhang', 'oog-edge', 'hidden', 'staged', 'parked-outside'].map(id => ({
      id, placement: id === 'staged' ? 'staged' : 'packed', hidden: id === 'hidden',
    })),
  };
  const aabbs = {
    inside: worldBox(10, 0, -20, 50, 40, 20),
    overhang: worldBox(300, 45, -12, 330, 70, 12),
    'oog-edge': worldBox(100, 0, 30, 140, 30, 70), // straddles the +z wall (48 in)
    hidden: worldBox(150, 0, -10, 400, 30, 10), // would widen framing if counted
    staged: worldBox(10, 0, 60, 60, 40, 110), // staging lane beyond the wall
    'parked-outside': worldBox(-200, 0, -20, -150, 30, 20),
  };
  const calls = { captures: [], downloads: [], toasts: [], begins: [], restores: 0, repaints: 0, errors: [] };
  const themeBackground = { theme: true };
  const scene = { background: themeBackground };
  const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 1000);
  const authority = { pack };
  let captured = false;
  const doc = {
    pages: 1, saved: null, images: [],
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
    getNumberOfPages: () => doc.pages, splitTextToSize: text => [text], getTextWidth: text => String(text).length * 5,
    setFontSize() {}, setFont() {}, text() {}, line() {}, setPage() {},
    addPage() { doc.pages += 1; },
    addImage(...args) { doc.images.push(args); },
    save(name) { doc.saved = name; },
  };
  const deps = {
    THREE,
    window: { __TP3D_BILLING: { getBillingState: () => ({ ok: true }) }, jspdf: { jsPDF: function () { return doc; } } },
    document: {
      createElement: () => ({ click() { calls.downloads.push(this.download); } }),
      body: { appendChild() {}, removeChild() {} },
    },
    console: { error: error => calls.errors.push(error.message) },
    BillingService: { getProRuleSet: () => ({ canUseProFeature: true }) },
    openSettingsOverlay() {},
    UIComponents: { showToast: (...args) => calls.toasts.push(args.slice(0, 2)) },
    PreferencesManager: {
      get: () => ({ export: { screenshotResolution: resolution, pdfIncludeStats: false }, units: { length: 'in', weight: 'lb' } }),
    },
    Utils: {
      parseResolution: CoreUtils.parseResolution, formatWeight: CoreUtils.formatWeight, formatDims: CoreUtils.formatDims,
      createDownloadActionGuard: CoreUtils.createDownloadActionGuard, buildLoadPlanFilename: CoreUtils.buildLoadPlanFilename,
      downloadDataUrl: (dataUrl, filename) => calls.downloads.push(filename),
    },
    StateStore: { get: key => (key === 'currentPackId' ? currentPackId : null) },
    PackLibrary: {
      getById: id => (id === pack.id ? pack : null),
      computeStats: () => ({ totalWeight: 0, totalCases: 6, packedCases: 3, volumePercent: 0 }),
      isHandlingRulesValidationRequired: () => false,
    },
    CaseLibrary: { getCases: () => [] },
    OperationLifecycle: { isBusy: () => busy },
    EditorUI: {
      getExportScene: () => {
        if (exportScene === 'none') return null;
        if (exportScene === 'other') return { pack: { ...pack } };
        if (authorityChangesAfterCapture && captured) return { pack };
        return authority;
      },
    },
    SceneManager: {
      getScene: () => scene, getCamera: () => camera, render: () => { calls.repaints += 1; },
      getTruckBoundsWorld: () => new THREE.Box3(new THREE.Vector3(0, 0, -48 * INCH), new THREE.Vector3(336 * INCH, 100 * INCH, 48 * INCH)),
      toWorld: inches => inches * INCH,
    },
    CaseScene: {
      beginExportCapture: ({ excludeIds }) => {
        calls.begins.push(excludeIds ? [...excludeIds].sort() : null);
        return () => { calls.restores += 1; };
      },
      getAabbWorld: id => aabbs[id] || null,
    },
    renderCameraToDataUrl: (view, width, height, options) => {
      if (captureFault) throw new Error(captureFault);
      captured = true;
      calls.captures.push({ camera: view, width, height, options, background: scene.background });
      return 'data:' + options.mimeType + ';base64,AAAA';
    },
    ImportExport: {
      buildCargoInstructionsManifest: () => ({ caseEntries: [], itemEntries: [] }),
      buildLoadPlanReport: () => ({
        title: pack.title, identity: [], lastEdited: null, population: { hidden: 0, unresolved: 0 },
        summary: [], optionalStats: [], summaryNotes: [], truck: { fields: [] }, review: [], rows: [], handling: [],
      }),
      toPdfText: value => String(value == null ? '' : value),
    },
    CategoryService: { meta: () => ({ name: 'Default' }) },
  };
  const service = new Function(...Object.keys(deps),
    `${exportConstantsCode}${exportCode}\nreturn { captureScreenshot, generatePDF };`)(...Object.values(deps));
  return { service, calls, scene, themeBackground, camera, doc };
}

// World extents an orthographic export camera sees (right = +x for both views;
// Top looks down -y with screen-up -z, Side looks along -z with screen-up +y).
function orthoExtents(camera, view) {
  const p = camera.position;
  return view === 'top'
    ? { x: [p.x + camera.left, p.x + camera.right], z: [p.z - camera.top, p.z - camera.bottom] }
    : { x: [p.x + camera.left, p.x + camera.right], y: [p.y + camera.bottom, p.y + camera.top] };
}

test('EXPORT-A service boundary: busy, unsynchronized or foreign scenes never capture, download or save', () => {
  const cases = [
    [{ busy: true }, ['Finish the current operation before exporting.', 'info']],
    [{ exportScene: 'none' }, ['The load plan is still changing. Try again when the scene settles.', 'info']],
    [{ exportScene: 'other' }, ['The load plan is still changing. Try again when the scene settles.', 'info']],
    [{ currentPackId: null }, ['Open a load plan first', 'warning']],
  ];
  for (const [options, toast] of cases) {
    const { service, calls, doc } = loadExportService(options);
    service.captureScreenshot();
    service.generatePDF();
    assert.equal(calls.captures.length, 0, JSON.stringify(options));
    assert.equal(calls.begins.length, 0);
    assert.deepEqual(calls.downloads, []);
    assert.equal(doc.saved, null);
    assert.deepEqual(calls.toasts, [toast, toast], JSON.stringify(options));
  }
});

test('EXPORT-A Screenshot uses only supported sizes, the theme background and a clean, restored capture', () => {
  for (const [resolution, expected] of [
    ['1920x1080', [1920, 1080]], ['2560x1440', [2560, 1440]], ['3840x2160', [3840, 2160]],
    ['99999x99999', [1920, 1080]], ['7680x4320', [1920, 1080]], ['1920x1080 ', [1920, 1080]], [undefined, [1920, 1080]],
  ]) {
    const { service, calls, scene, themeBackground, camera } = loadExportService({ resolution });
    service.captureScreenshot();
    assert.equal(calls.captures.length, 1, String(resolution));
    const [capture] = calls.captures;
    assert.deepEqual([capture.width, capture.height], expected, String(resolution));
    assert.equal(capture.camera, camera, 'the current runtime camera');
    assert.equal(capture.options.mimeType, 'image/png');
    assert.equal(capture.background, themeBackground, 'Screenshot keeps the Editor theme background');
    assert.deepEqual(calls.begins, [null], 'hidden cargo/interaction emphasis only; staged may appear in perspective');
    assert.equal(calls.restores, 1);
    assert.ok(calls.repaints >= 1, 'the live Editor is repainted after capture');
    assert.equal(scene.background, themeBackground);
    assert.equal(calls.downloads.length, 1);
    assert.match(calls.downloads[0], /^load-plan-Fixture-Plan-\d{8}-\d{6}\.png$/);
    assert.deepEqual(calls.toasts, [['Screenshot download started', 'success']]);
  }
});

test('EXPORT-A PDF views: print background, truck-centric exclusions and one-scale framing of the full truck', () => {
  const { service, calls, scene, themeBackground, camera, doc } = loadExportService();
  service.generatePDF();
  assert.deepEqual(calls.captures.map(c => [c.width, c.height, c.options.mimeType]),
    [[1419, 798, 'image/jpeg'], [1419, 769, 'image/jpeg'], [1419, 621, 'image/jpeg']],
    'Export Integrity B: views raster at ~192 PPI of the printed width');
  for (const capture of calls.captures) {
    assert.ok(capture.background instanceof THREE.Color, 'a deliberate print background replaces the UI theme');
    assert.equal(capture.background.getHexString(), 'ffffff');
  }
  assert.equal(calls.captures[0].camera, camera, 'perspective uses the current runtime camera');
  assert.deepEqual(calls.begins, [null, ['parked-outside', 'staged'], ['parked-outside', 'staged']],
    'staged and truck-external cargo are excluded from Top/Side only; hidden cargo is omitted by the clean capture');
  assert.equal(calls.restores, 3);
  assert.equal(scene.background, themeBackground, 'theme background restored after every view');
  assert.ok(calls.repaints >= 1);

  const [, top, side] = calls.captures;
  for (const { camera: ortho, width, height } of [top, side]) {
    assert.ok(ortho.isOrthographicCamera);
    assert.ok(Math.abs((ortho.right - ortho.left) / (ortho.top - ortho.bottom) - width / height) < 1e-9,
      'one world scale on both axes: frustum aspect equals the raster aspect');
  }
  const topExtent = orthoExtents(top.camera, 'top');
  const sideExtent = orthoExtents(side.camera, 'side');
  for (const extent of [topExtent, sideExtent]) {
    assert.ok(extent.x[0] <= 0 && extent.x[1] >= 336 * INCH, 'full length incl. the Front Overhang is framed');
    assert.ok(extent.x[0] > -150 * INCH, 'truck-external cargo does not widen the framing');
    assert.ok(extent.x[1] < 400 * INCH, 'hidden cargo does not widen the framing');
  }
  assert.ok(topExtent.z[0] <= -48 * INCH && topExtent.z[1] >= 70 * INCH, 'truck width and straddling cargo are framed');
  assert.ok(sideExtent.y[0] <= 0 && sideExtent.y[1] >= 100 * INCH, 'full truck height is framed');
  assert.equal(doc.images.length, 3);
  assert.match(doc.saved, /^load-plan-Fixture-Plan-\d{8}-\d{6}\.pdf$/);
  assert.deepEqual(calls.toasts, [['PDF download started', 'success']]);
});

test('EXPORT-A capture failure or a changed scene restores state and never downloads or saves', () => {
  for (const variant of [{ captureFault: 'injected export fault: render' }, { authorityChangesAfterCapture: true }]) {
    const shot = loadExportService(variant);
    shot.service.captureScreenshot();
    assert.deepEqual(shot.calls.downloads, []);
    assert.equal(shot.calls.restores, shot.calls.begins.length);
    assert.ok(shot.calls.repaints >= 1);
    assert.equal(shot.scene.background, shot.themeBackground);
    assert.equal(shot.calls.toasts.length, 1);
    assert.equal(shot.calls.toasts[0][1], 'error');
    assert.match(shot.calls.toasts[0][0], /^Screenshot failed: /);

    const pdf = loadExportService(variant);
    pdf.service.generatePDF();
    assert.equal(pdf.doc.saved, null);
    assert.equal(pdf.calls.restores, pdf.calls.begins.length);
    assert.equal(pdf.scene.background, pdf.themeBackground);
    assert.equal(pdf.calls.toasts.length, 1);
    assert.equal(pdf.calls.toasts[0][1], 'error');
    assert.match(pdf.calls.toasts[0][0], /^PDF export failed: /);
  }
  const changed = loadExportService({ authorityChangesAfterCapture: true });
  changed.service.captureScreenshot();
  assert.deepEqual(changed.calls.toasts, [['Screenshot failed: The load plan changed during export. Try again.', 'error']]);
});

test('EXPORT-A Workspace Backup dialog stays bound to its workspace scope, including A→B→A', async () => {
  const CoreStorage = await import('../../src/core/storage.js');
  const start = appSource.indexOf('    function openExportWorkspaceModal(');
  const end = appSource.indexOf('\n    function openImportAppDialog', start);
  assert.ok(start >= 0 && end > start, 'openExportWorkspaceModal is extractable');
  const element = () => ({ style: {}, appendChild() {} });
  const run = ({ workspaceId, switches = [] }) => {
    const calls = { modals: [], toasts: [], exports: [], downloads: [] };
    const deps = {
      CoreStorage,
      document: { createElement: element },
      UIComponents: {
        showModal: options => calls.modals.push(options),
        showToast: (...args) => calls.toasts.push(args.slice(0, 2)),
      },
      Utils: {
        escapeHtml: value => String(value), downloadText: name => calls.downloads.push(name),
        buildExportFilename: CoreUtils.buildExportFilename, downloadActionGuard: CoreUtils.createDownloadActionGuard(),
      },
      ImportExport: { buildRestorableWorkspaceExportJSON: (...args) => { calls.exports.push(args); return '{}'; } },
    };
    const open = new Function(...Object.keys(deps),
      `${appSource.slice(start, end)}\nreturn openExportWorkspaceModal;`)(...Object.values(deps));
    CoreStorage.setWorkspaceScope('org-a');
    open('Workspace A', workspaceId);
    switches.forEach(scope => CoreStorage.setWorkspaceScope(scope));
    const confirm = calls.modals[0]?.actions.find(action => action.label === 'Export Workspace Backup');
    if (confirm) confirm.onClick();
    return calls;
  };

  const current = run({ workspaceId: 'org-a' });
  assert.deepEqual(current.exports, [['Workspace A', 'org-a']], 'the opened workspace exports under its own identity');
  assert.equal(current.downloads.length, 1);

  for (const switches of [['org-b'], ['org-b', 'org-a']]) {
    const stale = run({ workspaceId: 'org-a', switches });
    assert.equal(stale.modals.length, 1);
    assert.deepEqual(stale.exports, [], `stale intent after ${switches.join('→')} exports nothing`);
    assert.deepEqual(stale.downloads, []);
    assert.deepEqual(stale.toasts, [['The active workspace changed. Nothing was exported.', 'warning']]);
  }

  const foreign = run({ workspaceId: 'org-b' });
  assert.deepEqual(foreign.modals, [], 'a Settings view of another workspace cannot open an export of this one');
  assert.deepEqual(foreign.exports, []);
  assert.deepEqual(foreign.toasts, [['This workspace is no longer active. Reopen Settings and try again.', 'warning']]);
  CoreStorage.setWorkspaceScope('no-org');
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
      // B's meshes are pickable once the render loop has drawn them (world
      // matrices update on render); wait for a frame after opening, not a delay.
      const opened = await page.evaluate(() => window.probe.SceneManager.getRenderer().info.render.frame);
      await page.waitForFunction(frame => window.probe.SceneManager.getRenderer().info.render.frame > frame,
        opened, { timeout: 10000 });
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

// ── Export Integrity A: real Chromium ───────────────────────────────────────
// Real Editor, scene, PacksUI/CasesUI and the production Screenshot/PDF service.
// Downloads and jsPDF are recorded in-page; nothing leaves the browser.
const settleExport = async page => {
  await page.waitForFunction(() => window.probe.op() === 'idle');
  await page.waitForTimeout(700);
  await page.waitForFunction(() => window.probe.op() === 'idle');
};
const installAttempts = page => page.evaluate(() => {
  const q = window.probe;
  q.installExportRecorders();
  // One Screenshot plus one PDF, reporting everything either one produced.
  q.attemptExports = () => {
    const downloads = q.downloads.length;
    q.mark();
    q.ExportService.captureScreenshot();
    const doc = q.exportPdf();
    return {
      views: q.exportViews().length,
      downloads: q.downloads.length - downloads,
      saved: doc ? doc.saved : null,
      toasts: q.log.filter(e => e.type === 'toast').map(e => [e.message, e.tone]),
    };
  };
  q.screenshotUrl = () => {
    const before = q.downloads.length;
    q.ExportService.captureScreenshot();
    return q.downloads.length > before ? q.downloads[q.downloads.length - 1].href : null;
  };
  q.pdfImages = () => {
    const doc = q.exportPdf();
    return doc && doc.saved ? doc.images.map(image => image.data) : null;
  };
});
const ALLOWED = { views: 4, downloads: 1 };
const expectRejected = (result, toast, label) => {
  assert.equal(result.views, 0, `${label}: no image rendered`);
  assert.equal(result.downloads, 0, `${label}: no download`);
  assert.equal(result.saved, null, `${label}: no PDF saved`);
  if (toast) assert.deepEqual(result.toasts, [[toast, 'info'], [toast, 'info']], label);
};
const expectAllowed = (result, label) => {
  assert.equal(result.views, ALLOWED.views, `${label}: Screenshot + three PDF views`);
  assert.equal(result.downloads, ALLOWED.downloads, `${label}: one PNG download`);
  assert.ok(result.saved, `${label}: PDF saved`);
};
const STILL_CHANGING = 'The load plan is still changing. Try again when the scene settles.';
const BUSY = 'Finish the current operation before exporting.';

test('EXPORT-A real Chromium visual export identity, authority and fidelity', { timeout: 300000 }, async t => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await installAttempts(page);

    await t.test('pixels: Screenshot equals the live display pipeline in light and dark themes, unlike the legacy render target', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        const scene = q.SceneManager.getScene();
        const theme = scene.background;
        const renderer = q.SceneManager.getRenderer();
        const results = [];
        try {
          for (const background of ['#f6f7fb', '#121318']) {
            scene.background = new THREE.Color(background);
            const camera = q.SceneManager.getCamera();
            const expected = q.referenceDisplay(camera, 1920, 1080);
            const legacy = q.referenceLegacy(camera, 1920, 1080);
            const before = q.downloads.length;
            const frames = await q.captureEncodes(() => q.ExportService.captureScreenshot());
            const frame = frames.find(f => f.width === 1920 && f.height === 1080);
            const download = q.downloads[before];
            const decoded = download ? await q.decodeImage(download.href) : null;
            results.push({
              background, encoder: frame ? frame.args : null,
              difference: frame ? q.maxDifference(frame.pixels, expected) : null,
              legacyDifference: q.maxDifference(expected, legacy),
              downloads: q.downloads.length - before, name: download ? download.name : null,
              size: decoded ? [decoded.width, decoded.height] : null,
              corner: decoded ? [...decoded.data.slice(0, 3)] : null,
              antialias: renderer.getContext().getContextAttributes().antialias,
              tone: [renderer.toneMapping === THREE.ACESFilmicToneMapping, renderer.toneMappingExposure, renderer.outputColorSpace],
            });
          }
        } finally {
          scene.background = theme;
          q.SceneManager.render();
        }
        return results;
      });
      for (const result of proof) {
        assert.deepEqual(result.encoder, ['image/png', 0.92]);
        assert.equal(result.difference, 0, `${result.background}: exported pixels equal the live display framebuffer`);
        assert.ok(result.legacyDifference > 16, `${result.background}: the legacy linear render target differs (${result.legacyDifference})`);
        assert.equal(result.downloads, 1);
        assert.match(result.name, /^(?:LP-[0-9A-Z-]+|load-plan)-Red-B-\d{8}-\d{6}\.png$/);
        assert.deepEqual(result.size, [1920, 1080]);
        const rgb = [1, 3, 5].map(i => parseInt(result.background.slice(i, i + 2), 16));
        assert.ok(rgb.every((value, i) => Math.abs(result.corner[i] - value) <= 1), `theme background kept: ${JSON.stringify(result)}`);
        assert.equal(result.antialias, true);
        assert.deepEqual(result.tone, [true, 1.15, 'srgb']);
      }
    });

    await t.test('pixels: PDF views use the same display transform on a print background, independent of a dark UI', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        const scene = q.SceneManager.getScene();
        const theme = scene.background;
        scene.background = new THREE.Color('#121318');
        try {
          q.mark();
          let doc = null;
          const frames = await q.captureEncodes(() => { doc = q.exportPdf(); });
          const views = q.exportViews();
          const dark = scene.background.getHexString();
          scene.background = new THREE.Color('#ffffff');
          const differences = views.map((view, i) => q.maxDifference(frames[i].pixels, q.referenceDisplay(view.camera, view.width, view.height)));
          const corners = [];
          for (const image of doc.images) corners.push([...(await q.decodeImage(image.data)).data.slice(0, 3)]);
          return {
            sizes: views.map(v => [v.width, v.height, v.options.mimeType, v.options.quality]),
            backgrounds: views.map(v => v.state.background), restoredBackground: dark,
            differences, corners, saved: doc.saved, formats: doc.images.map(image => image.format),
          };
        } finally {
          scene.background = theme;
          q.SceneManager.render();
        }
      });
      assert.deepEqual(proof.sizes, [[1419, 798, 'image/jpeg', 0.92], [1419, 769, 'image/jpeg', 0.9], [1419, 621, 'image/jpeg', 0.9]]);
      assert.deepEqual(proof.backgrounds, ['ffffff', 'ffffff', 'ffffff'], 'print background replaces the dark UI theme');
      assert.equal(proof.restoredBackground, '121318', 'the Editor theme background is restored');
      assert.deepEqual(proof.differences, [0, 0, 0], 'each PDF view equals the display pipeline render of its camera');
      for (const corner of proof.corners) assert.ok(corner.every(value => value >= 250), JSON.stringify(proof.corners));
      assert.deepEqual(proof.formats, ['JPEG', 'JPEG', 'JPEG']);
      assert.match(proof.saved, /^(?:LP-[0-9A-Z-]+|load-plan)-Red-B-\d{8}-\d{6}\.pdf$/);
    });

    for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
      await t.test(`orthographic ${shapeMode}: physical proportions, full truck framed, staged and hidden cargo absent from Top/Side`, async () => {
        await page.evaluate(shapeMode => {
          const q = window.probe;
          q.reset();
          const truck = { length: 240, width: 96, height: 100, shapeMode };
          if (shapeMode === 'frontBonus') truck.shapeConfig = { bonusLength: 96, bonusHeight: 45 };
          const pose = (id, caseId, x, y, z, extra = {}) => ({
            id, caseId, hidden: false, groupId: null, placement: 'packed',
            transform: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ...extra,
          });
          const cases = [
            pose('floor', 'qa-single', 60, 12, 0),
            pose('far', 'qa-carton', shapeMode === 'frontBonus' ? 300 : 220, shapeMode === 'frontBonus' ? 49 : 4, 0),
            pose('staged', 'qa-wide', 40, 10, 80, { placement: 'staged' }),
            pose('hidden', 'qa-tall', 150, 25, 0, { hidden: true }),
          ];
          q.PackLibrary.update(q.otherPackId, { truck, cases });
        }, shapeMode);
        await openPack(page, B);
        await settleExport(page);
        const proof = await page.evaluate(() => {
          const q = window.probe;
          q.mark();
          const doc = q.exportPdf();
          const views = q.exportViews();
          const truck = q.SceneManager.getTruckBoundsWorld();
          const far = q.CaseScene.getAabbWorld('far');
          const extent = (view, i) => {
            const c = view.camera; const p = c.position;
            return i === 1
              ? { h: [p.x + c.left, p.x + c.right], v: [p.z - c.top, p.z - c.bottom] }
              : { h: [p.x + c.left, p.x + c.right], v: [p.y + c.bottom, p.y + c.top] };
          };
          // Pixel proof for the side view: the captured frame equals a render
          // without staged cargo and differs from one where staged is shown.
          const side = views[2];
          const staged = q.CaseScene.getObject('staged');
          const hidden = q.CaseScene.getObject('hidden');
          const scene = q.SceneManager.getScene();
          const theme = scene.background;
          let withStaged = null; let withoutStaged = null;
          try {
            scene.background = new THREE.Color('#ffffff');
            hidden.visible = false;
            staged.visible = false;
            withoutStaged = q.referenceDisplay(side.camera, side.width, side.height);
            staged.visible = true;
            withStaged = q.referenceDisplay(side.camera, side.width, side.height);
          } finally {
            hidden.visible = true; staged.visible = true;
            scene.background = theme;
            q.SceneManager.render();
          }
          return {
            saved: doc.saved,
            aspects: views.slice(1).map(v => (v.camera.right - v.camera.left) / (v.camera.top - v.camera.bottom) - v.width / v.height),
            extents: views.slice(1).map((v, i) => extent(v, i + 1)),
            truck: { min: truck.min.toArray(), max: truck.max.toArray() },
            far: [far.min.x, far.max.x, far.min.y, far.max.y],
            visibility: views.map(v => ({ staged: v.state.groups.staged.visible, hidden: v.state.groups.hidden.visible,
              floor: v.state.groups.floor.visible, far: v.state.groups.far.visible })),
            sideCapture: side.image,
            stagedChangesSide: q.maxDifference(withStaged, withoutStaged),
            placements: q.cases().map(inst => [inst.id, inst.placement]),
            mismatches: q.sceneMismatches(),
            live: { staged: staged.visible, hidden: hidden.visible },
          };
        });
        assert.ok(proof.saved);
        assert.deepEqual(proof.mismatches, []);
        for (const delta of proof.aspects) assert.ok(Math.abs(delta) < 1e-9, 'uniform scale (no stretch)');
        const [top, side] = proof.extents;
        const [tMin, tMax] = [proof.truck.min, proof.truck.max];
        if (shapeMode === 'frontBonus') assert.ok(tMax[0] >= 336 * 0.05 - 1e-9, 'scene truck bounds include the overhang');
        for (const e of [top, side]) assert.ok(e.h[0] <= tMin[0] && e.h[1] >= tMax[0], `${shapeMode}: full truck length framed`);
        assert.ok(top.v[0] <= tMin[2] && top.v[1] >= tMax[2], 'full width framed');
        assert.ok(side.v[0] <= tMin[1] && side.v[1] >= tMax[1], 'full height framed');
        const [farMinX, farMaxX, farMinY, farMaxY] = proof.far;
        for (const e of [top, side]) assert.ok(e.h[0] <= farMinX && e.h[1] >= farMaxX, 'far/overhang cargo is inside the frame');
        assert.ok(side.v[0] <= farMinY && side.v[1] >= farMaxY);
        assert.deepEqual(proof.visibility, [
          { staged: true, hidden: false, floor: true, far: true },
          { staged: false, hidden: false, floor: true, far: true },
          { staged: false, hidden: false, floor: true, far: true },
        ], 'perspective may show staged cargo; Top/Side never; hidden cargo never');
        assert.ok(proof.stagedChangesSide > 0, 'staged cargo would project over the side silhouette if shown');
        assert.deepEqual(proof.live, { staged: true, hidden: true }, 'export visibility restored');
      });
    }

    await t.test('clean capture: selection, hover and gizmo never reach pixels; committed OOG warning stays; state restores', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        const shot = async () => (await q.captureEncodes(() => q.ExportService.captureScreenshot()))
          .find(f => f.width === 1920).pixels;
        const clean = await shot();
        q.StateStore.set({ selectedInstanceIds: ['b-cargo'] }, { skipHistory: true });
        q.CaseScene.setHover('b-cargo');
        const before = q.exportState();
        q.mark();
        const selected = await shot();
        const during = q.exportViews()[0].state;
        const after = q.exportState();
        // Committed out-of-gauge pose: the warning highlight must survive selection.
        const cases = q.cases();
        cases[0].transform.position.x = 220;
        q.PackLibrary.update(q.otherPackId, { cases });
        q.StateStore.set({ selectedInstanceIds: ['b-cargo'] }, { skipHistory: true });
        const oogBefore = q.exportState();
        q.mark();
        q.ExportService.captureScreenshot();
        const oogDuring = q.exportViews()[0].state;
        q.CaseScene.setHover(null);
        return {
          difference: q.maxDifference(clean, selected), before, during, after, oogBefore,
          oogDuring: oogDuring.groups['b-cargo'], oogGizmo: oogDuring.gizmo,
        };
      });
      assert.equal(proof.difference, 0, 'selection/hover/gizmo emphasis is absent from the exported pixels');
      assert.equal(proof.before.scene.gizmo, true, 'fixture: gizmo shown for the single selection');
      assert.notEqual(proof.before.scene.groups['b-cargo'].emissive, 0, 'fixture: selection emphasis shown live');
      assert.equal(proof.during.gizmo, false);
      assert.equal(proof.during.groups['b-cargo'].emissive, 0);
      assert.deepEqual(proof.after, proof.before, 'selection, hover, gizmo, grid, renderer and camera restored');
      assert.equal(proof.oogDuring.emissive, 0xcc3300, 'committed OOG warning visible in the export');
      assert.equal(proof.oogGizmo, false);
    });

    await t.test('camera policy: a pure camera focus in motion exports the instantaneous runtime view, not the persisted one', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        q.CaseScene.setHover(null);
        const camera = q.SceneManager.getCamera();
        const persisted = () => JSON.stringify(q.PackLibrary.getById(q.otherPackId).editorView);
        const before = { persisted: persisted(), position: camera.position.toArray() };
        const target = q.CaseScene.getObject('b-cargo').position.clone().add(new THREE.Vector3(3, 0, 2));
        q.SceneManager.focusOnWorldPoint(target, { duration: 700 });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const previewView = q.EditorUI.getPreviewView();
        q.mark();
        const frames = await q.captureEncodes(() => q.ExportService.captureScreenshot());
        const frame = frames.find(f => f.width === 1920);
        const view = q.exportViews()[0];
        const result = {
          previewBlocked: previewView === null,
          exported: Boolean(frame),
          sameCamera: view ? view.camera === camera : false,
          moved: JSON.stringify(camera.position.toArray()) !== JSON.stringify(before.position),
          persistedAtCapture: persisted() === before.persisted,
          difference: frame ? q.maxDifference(frame.pixels, q.referenceDisplay(camera, 1920, 1080)) : null,
        };
        await new Promise(resolve => setTimeout(resolve, 900));
        return result;
      });
      assert.equal(proof.previewBlocked, true, 'Preview waits for the camera to settle');
      assert.equal(proof.exported, true, 'a pure camera move never blocks a committed-cargo export');
      assert.equal(proof.sameCamera, true, 'the current runtime camera is used');
      assert.equal(proof.moved, true, 'fixture: the camera is mid-focus');
      assert.equal(proof.persistedAtCapture, true, 'fixture: the new view is not persisted yet');
      assert.equal(proof.difference, 0, 'pixels are the instantaneous runtime view, not the older persisted view');
      await settleExport(page);
    });

    await t.test('authority: unsynchronized, deleted, navigated, rescoped, held or moved scenes never export', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      expectAllowed(await page.evaluate(() => window.probe.attemptExports()), 'control');

      const unsynchronized = await page.evaluate(() => {
        const q = window.probe;
        const sync = q.CaseScene.sync;
        q.CaseScene.sync = () => {};
        try {
          const cases = q.cases();
          cases[0].transform.position.z += 4;
          q.PackLibrary.update(q.otherPackId, { cases });
          return q.attemptExports();
        } finally { q.CaseScene.sync = sync; q.EditorUI.render(); }
      });
      expectRejected(unsynchronized, STILL_CHANGING, 'wrong/unsynchronized scene');
      await settleExport(page);

      const moved = await page.evaluate(() => {
        const q = window.probe;
        const obj = q.CaseScene.getObject('b-cargo');
        const x = obj.position.x;
        obj.position.x += 0.5;
        const rejected = q.attemptExports();
        obj.position.x = x;
        return { rejected, restored: q.attemptExports() };
      });
      expectRejected(moved.rejected, STILL_CHANGING, 'scene-only pose');
      expectAllowed(moved.restored, 'committed pose again');
      await settleExport(page);

      const held = await page.evaluate(() => {
        const q = window.probe;
        const original = q.InteractionManager.hasProvisionalPose;
        q.InteractionManager.hasProvisionalPose = () => true;
        try { return q.attemptExports(); } finally { q.InteractionManager.hasProvisionalPose = original; }
      });
      expectRejected(held, STILL_CHANGING, 'gizmo hold / provisional pose');
      await settleExport(page);

      const rescoped = await page.evaluate(() => {
        const q = window.probe;
        q.CoreStorage.setWorkspaceScope('fixture-b');
        const away = q.attemptExports();
        q.CoreStorage.setWorkspaceScope('fixture-a');
        const back = q.attemptExports();
        q.EditorUI.render();
        return { away, back, rerendered: q.attemptExports() };
      });
      expectRejected(rescoped.away, STILL_CHANGING, 'workspace replacement');
      expectRejected(rescoped.back, STILL_CHANGING, 'A→B→A stale scene');
      expectAllowed(rescoped.rerendered, 'freshly rendered current scope');

      const navigated = await page.evaluate(() => {
        const q = window.probe;
        q.AppShell.navigate('packs');
        return q.attemptExports();
      });
      expectRejected(navigated, null, 'navigation away');

      await openPack(page, B);
      await settleExport(page);
      const deleted = await page.evaluate(() => {
        const q = window.probe;
        q.PackLibrary.remove(q.otherPackId);
        return q.attemptExports();
      });
      expectRejected(deleted, null, 'deleted Pack');
    });

    for (const kind of ['autopacking', 'unpacking', 'changingTruck', 'previewingTruckChange', 'capturingPreview']) {
      await t.test(`busy ${kind}: the service boundary rejects even if the toolbar were enabled`, async () => {
        await page.evaluate(() => window.probe.reset());
        await openPack(page, B);
        await settleExport(page);
        const proof = await page.evaluate(kind => {
          const q = window.probe;
          const token = q.OperationLifecycle.beginOperation(kind);
          try {
            const share = document.getElementById('btn-share').disabled;
            document.getElementById('btn-screenshot').disabled = false;
            document.getElementById('btn-pdf').disabled = false;
            return { share, attempt: q.attemptExports() };
          } finally { q.OperationLifecycle.finishOperation(token); }
        }, kind);
        assert.equal(proof.share, true, 'toolbar Share disabled while busy');
        expectRejected(proof.attempt, BUSY, kind);
      });
    }

    await t.test('real drag and rejected-drop return tween are never exported; committed pose exports after settling', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      const point = await page.evaluate(() => {
        const q = window.probe;
        const p = q.CaseScene.getObject('b-cargo').position.clone().project(q.SceneManager.getCamera());
        const rect = q.SceneManager.getRenderer().domElement.getBoundingClientRect();
        return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
      });
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 35, point.y + 20, { steps: 3 });
      const dragging = await page.evaluate(() => {
        const q = window.probe;
        const result = { provisional: q.InteractionManager.hasProvisionalPose(), attempt: q.attemptExports() };
        // Force the release to be rejected so the production return tween runs;
        // sample authority on the same pointerup, right after the release.
        const check = q.CaseScene.checkCollision;
        q.CaseScene.checkCollision = (...args) => ({ ...check(...args), collides: true });
        window.addEventListener('pointerup', () => {
          q.CaseScene.checkCollision = check;
          q.tween = { provisional: q.InteractionManager.hasProvisionalPose(), mismatches: q.sceneMismatches(), attempt: q.attemptExports() };
        }, { once: true });
        return result;
      });
      assert.equal(dragging.provisional, true);
      expectRejected(dragging.attempt, STILL_CHANGING, 'active drag');
      await page.mouse.up();
      const tween = await page.evaluate(() => window.probe.tween);
      assert.equal(tween.provisional, true, 'the return tween is provisional');
      assert.deepEqual(tween.mismatches, ['b-cargo'], 'fixture: the mesh is away from its committed pose');
      expectRejected(tween.attempt, STILL_CHANGING, 'rejected-drop return tween');
      // The return tween advances on render frames; wait for the committed pose
      // and the released provisional hold, not a delay.
      await page.waitForFunction(() => {
        const q = window.probe;
        return !q.InteractionManager.hasProvisionalPose() && q.sceneMismatches().length === 0;
      }, null, { timeout: 10000 });
      const settled = await page.evaluate(() => {
        const q = window.probe;
        return { provisional: q.InteractionManager.hasProvisionalPose(), mismatches: q.sceneMismatches(), attempt: q.attemptExports() };
      });
      assert.equal(settled.provisional, false);
      assert.deepEqual(settled.mismatches, []);
      expectAllowed(settled.attempt, 'after the return tween');
    });

    await t.test('committed truth: AutoPack animation, pending truck and Results browsing; Apply/Undo/Redo export exactly', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, A);
      await settleExport(page);
      await page.click('#btn-autopack');
      await page.waitForFunction(() => window.probe.op() === 'autopacking');
      expectRejected(await page.evaluate(() => window.probe.attemptExports()), BUSY, 'AutoPack animation');
      await page.waitForFunction(() => window.probe.op() === 'idle' && window.probe.results()?.options?.length > 1);
      await settleExport(page);
      const snapshot = () => page.evaluate(() => {
        const q = window.probe;
        return { shot: q.screenshotUrl(), pdf: q.pdfImages(), cases: q.casesJson(), truck: q.SceneManager.getTruckBoundsWorld().max.toArray() };
      });
      const a = await snapshot();
      assert.ok(a.shot && a.pdf, 'fixture: committed AutoPack layout exports');

      await page.getByRole('combobox', { name: /Trailer preset/ }).click();
      await page.getByRole('option', { name: '53 ft Dry Van (US)', exact: true }).click();
      await settleExport(page);
      const pending = await snapshot();
      assert.deepEqual(pending, a, 'a pending (uncommitted) truck choice never changes exported geometry');

      if (await page.locator('[aria-label="Restore AutoPack results"]').count()) {
        await page.click('[aria-label="Restore AutoPack results"]');
        await settleExport(page);
      }
      const arrow = await page.evaluate(() => {
        const next = document.querySelector('[aria-label="Next AutoPack option"]');
        return next && !next.disabled ? 'Next AutoPack option' : 'Previous AutoPack option';
      });
      await page.click(`[aria-label="${arrow}"]`);
      await settleExport(page);
      assert.deepEqual(await snapshot(), a, 'browsing a non-applied option never changes exported geometry');

      const apply = page.getByRole('button', { name: 'Apply this option' });
      assert.equal(await apply.isEnabled(), true, 'fixture: the browsed option is applicable');
      await apply.click();
      await settleExport(page);
      const b = await snapshot();
      assert.notEqual(b.cases, a.cases, 'fixture: B is a different committed layout');
      assert.notEqual(b.shot, a.shot);
      assert.notDeepEqual(b.pdf.slice(1), a.pdf.slice(1), 'Top/Side follow the committed layout');

      await page.evaluate(() => window.probe.StateStore.undo());
      await settleExport(page);
      assert.deepEqual(await snapshot(), a, 'Undo exports exactly committed A');
      await page.evaluate(() => window.probe.StateStore.redo());
      await settleExport(page);
      assert.deepEqual(await snapshot(), b, 'Redo exports exactly committed B');
    });

    await t.test('identity: stale Pack and Case export menus never export after a scope change, including A→B→A', async () => {
      await page.evaluate(() => window.probe.reset());
      await page.evaluate(() => window.probe.AppShell.navigate('packs'));
      await page.click('#packs-view-list');
      await page.getByRole('button', { name: 'More actions for Red B', exact: true }).filter({ visible: true }).click();
      const packMenu = await page.evaluate(async () => {
        const q = window.probe;
        const stale = q.menuItem('Export Load Plan JSON');
        const seedA = q.StateStore.snapshot();
        const seedB = structuredClone(seedA);
        seedB.packLibrary = seedB.packLibrary.map(pack => pack.id === q.otherPackId ? { ...pack, title: 'Imposter B' } : pack);
        q.mark();
        const before = q.downloads.length;
        q.CoreStorage.setWorkspaceScope('fixture-b');
        q.StateStore.replace(seedB, { resetHistory: true });
        stale.click();
        const afterB = q.downloads.length - before;
        q.CoreStorage.setWorkspaceScope('fixture-a');
        q.StateStore.replace(seedA, { resetHistory: true });
        stale.click();
        const afterABA = q.downloads.length - before;
        return { found: Boolean(stale), afterB, afterABA, toasts: q.log.filter(e => e.type === 'toast').map(e => [e.message, e.tone]) };
      });
      assert.equal(packMenu.found, true);
      assert.equal(packMenu.afterB, 0, 'reused Pack ID in another workspace: nothing exported');
      assert.equal(packMenu.afterABA, 0, 'A→B→A: the stale menu still exports nothing');
      assert.deepEqual(packMenu.toasts, [
        ['The workspace changed. Open the menu again to export.', 'warning'],
        ['The workspace changed. Open the menu again to export.', 'warning'],
      ]);
      await page.getByRole('button', { name: 'More actions for Red B', exact: true }).filter({ visible: true }).click();
      const fresh = await page.evaluate(async () => {
        const q = window.probe;
        const before = q.downloads.length;
        q.menuItem('Export Load Plan JSON').click();
        const download = q.downloads[before];
        return download ? JSON.parse(await download.blob.text()) : null;
      });
      assert.equal(fresh.data.pack.id, B);
      assert.equal(fresh.data.pack.title, 'Red B');

      const caseMenu = await page.evaluate(async () => {
        const q = window.probe;
        q.ensureCasesUI();
        q.AppShell.navigate('cases');
        document.getElementById('btn-cases-export').click();
        const stale = q.menuItem('Case Catalog (JSON)');
        const seedA = q.StateStore.snapshot();
        const seedB = structuredClone(seedA);
        seedB.caseLibrary = [{ ...seedA.caseLibrary[0], id: 'workspace-b-only', name: 'Workspace B Only' }];
        seedB.packLibrary = [];
        const before = q.downloads.length;
        q.mark();
        q.CoreStorage.setWorkspaceScope('fixture-b');
        q.StateStore.replace(seedB, { resetHistory: true });
        stale.click();
        const afterB = q.downloads.length - before;
        q.CoreStorage.setWorkspaceScope('fixture-a');
        q.StateStore.replace(seedA, { resetHistory: true });
        stale.click();
        const afterABA = q.downloads.length - before;
        const staleToasts = q.log.filter(e => e.type === 'toast').map(e => [e.message, e.tone]);
        // Fresh menu in the current scope reads definitions when chosen, not when opened.
        document.getElementById('btn-cases-export').click();
        const current = q.menuItem('Case Catalog (JSON)');
        q.CaseLibrary.upsert({ ...q.CaseLibrary.getCases()[0], id: 'added-after-open', name: 'Added After Open' });
        current.click();
        const download = q.downloads[q.downloads.length - 1];
        const payload = JSON.parse(await download.blob.text());
        return {
          found: Boolean(stale), afterB, afterABA, staleToasts,
          exported: payload.data.caseLibrary.map(c => c.id).sort(),
          live: q.CaseLibrary.getCases().map(c => c.id).sort(),
        };
      });
      assert.equal(caseMenu.found, true);
      assert.equal(caseMenu.afterB, 0, 'stale Case menu in another workspace: nothing exported');
      assert.equal(caseMenu.afterABA, 0, 'A→B→A: nothing exported');
      assert.deepEqual(caseMenu.staleToasts, [
        ['The workspace changed. Open Export again.', 'warning'],
        ['The workspace changed. Open Export again.', 'warning'],
      ]);
      assert.deepEqual(caseMenu.exported, caseMenu.live, 'definitions come from the current scope at click time');
      assert.ok(caseMenu.exported.includes('added-after-open'));
    });

    await t.test('restoration: render/copy/encode/context/clamp/blank/addImage failures download nothing and restore everything', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      const proof = await page.evaluate(() => {
        const q = window.probe;
        q.StateStore.set({ selectedInstanceIds: ['b-cargo'] }, { skipHistory: true });
        const renderer = q.SceneManager.getRenderer();
        const scene = q.SceneManager.getScene();
        const render = renderer.render;
        const copy = CanvasRenderingContext2D.prototype.drawImage;
        const encode = HTMLCanvasElement.prototype.toDataURL;
        const getContext = HTMLCanvasElement.prototype.getContext;
        const setBuffer = renderer.setDrawingBufferSize;
        const consoleError = console.error;
        const results = [];
        try {
          console.error = () => {};
          for (const fault of ['render', 'copy', 'encode', 'context', 'clamp', 'blank', 'addImage']) {
            for (const action of ['screenshot', 'pdf']) {
              if (fault === 'addImage' && action === 'screenshot') continue;
              const before = q.exportState();
              let sceneRenders = 0; let axisRenders = 0;
              renderer.render = function (s, c) {
                if (s === scene) sceneRenders++; else axisRenders++;
                if (fault === 'render' && sceneRenders === 1) throw new Error('injected export fault: render');
                return render.call(this, s, c);
              };
              if (fault === 'copy') CanvasRenderingContext2D.prototype.drawImage = () => { throw new Error('injected export fault: copy'); };
              if (fault === 'encode') HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('injected export fault: encode'); };
              if (fault === 'blank') HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
              if (fault === 'context') HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === '2d' ? null : getContext.call(this, type, ...args); };
              let bufferCalls = 0;
              if (fault === 'clamp') {
                renderer.setDrawingBufferSize = function (w, h, r) {
                  bufferCalls += 1;
                  return setBuffer.call(this, bufferCalls % 2 === 1 ? w - 64 : w, h, r);
                };
              }
              q.pdfFault = fault === 'addImage' ? 'addImage' : null;
              q.mark();
              const downloads = q.downloads.length;
              let doc = null;
              try {
                if (action === 'screenshot') q.ExportService.captureScreenshot(); else doc = q.exportPdf();
              } finally {
                renderer.render = render;
                CanvasRenderingContext2D.prototype.drawImage = copy;
                HTMLCanvasElement.prototype.toDataURL = encode;
                HTMLCanvasElement.prototype.getContext = getContext;
                renderer.setDrawingBufferSize = setBuffer;
                q.pdfFault = null;
              }
              results.push({
                fault, action, before, after: q.exportState(), axisRenders,
                downloads: q.downloads.length - downloads, saved: doc ? doc.saved : null,
                toasts: q.log.filter(e => e.type === 'toast').map(e => [e.message, e.tone]),
                authority: Boolean(q.EditorUI.getExportScene()),
              });
            }
          }
        } finally {
          console.error = consoleError;
        }
        return results;
      });
      for (const result of proof) {
        const label = `${result.action}/${result.fault}`;
        assert.deepEqual(result.after, result.before, `${label}: renderer, camera, background, grid, gizmo, selection and visibility restored`);
        assert.equal(result.downloads, 0, `${label}: no download`);
        assert.equal(result.saved, null, `${label}: no PDF saved`);
        assert.ok(result.axisRenders >= 1, `${label}: the normal Editor repaint ran`);
        assert.equal(result.toasts.length, 1, label);
        assert.equal(result.toasts[0][1], 'error', label);
        assert.match(result.toasts[0][0], result.action === 'screenshot' ? /^Screenshot failed: / : /^PDF export failed: /);
        assert.doesNotMatch(result.toasts[0][0], /saved|exported/i);
        assert.equal(result.authority, true, `${label}: the Editor stays exportable`);
      }
      const messages = Object.fromEntries(proof.map(r => [`${r.action}/${r.fault}`, r.toasts[0][0]]));
      assert.match(messages['screenshot/clamp'], /cannot capture 1920×1080/);
      assert.match(messages['screenshot/blank'], /could not be encoded/);
    });

    await t.test('size: supported 1080p/1440p/4K preferences capture exactly; malformed or oversized ones fall back safely', async () => {
      await page.evaluate(() => window.probe.reset());
      await openPack(page, B);
      await settleExport(page);
      const proof = await page.evaluate(async () => {
        const q = window.probe;
        const results = [];
        for (const value of ['1920x1080', '2560x1440', '3840x2160', '99999x99999', '0x0', 'huge']) {
          const preferences = structuredClone(q.StateStore.get('preferences'));
          preferences.export = { ...preferences.export, screenshotResolution: value };
          q.StateStore.set({ preferences }, { skipHistory: true });
          const url = q.screenshotUrl();
          const decoded = url ? await q.decodeImage(url) : null;
          results.push([value, decoded ? [decoded.width, decoded.height] : null]);
        }
        let direct = null;
        try { q.renderLegacy(q.SceneManager.getCamera(), 7680, 4320, { mimeType: 'image/png' }); } catch (error) { direct = error.message; }
        return { results, direct };
      });
      assert.deepEqual(proof.results, [
        ['1920x1080', [1920, 1080]], ['2560x1440', [2560, 1440]], ['3840x2160', [3840, 2160]],
        ['99999x99999', [1920, 1080]], ['0x0', [1920, 1080]], ['huge', [1920, 1080]],
      ]);
      assert.match(proof.direct, /^Unsupported image size 7680×4320$/);
    });

    assert.deepEqual(errors, [], 'no uncaught error or unhandled rejection');
  } finally {
    await browser.close();
  }
});
