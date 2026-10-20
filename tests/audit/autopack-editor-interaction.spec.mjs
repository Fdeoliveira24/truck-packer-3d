import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// P0-SM-OF-10B: the non-modal AutoPack status keeps the Editor interactive, so
// an interaction during the small-load animation must never re-sync the meshes
// AutoPack is animating to their presented candidate poses.
//
// This drives the REAL Editor runtime in Chromium: index.html markup, main.css,
// three r185 + OrbitControls, SceneManager, CaseScene, InteractionManager,
// EditorUI, KeyboardManager and AutoPackEngine with the real solver over
// PackLibrary/CaseLibrary/StateStore and UIComponents, constructed as app.js
// constructs them, plus app.js's own StateStore render subscriber extracted
// verbatim. Disposable in-memory data only: every non-local request is aborted,
// and auth, billing, storage scope and persistence are not involved.

const ORIGIN = 'http://localhost:5599';
const CARGO_COUNT = 60;
// AutoPack lands at most four instances per 276 ms batch. Between two animation
// frames the count of instances still short of their presented pose can drop
// by at most one batch more than the elapsed batch periods allow, however long
// a frame stalls; a scene re-sync lands every remaining instance at once.
const BATCH_SIZE = 4;
const BATCH_MS = 276;
const MIN_REMAINING = 12;

const repo = new URL('../../', import.meta.url);
const read = (path, encoding = 'utf8') => readFile(new URL(path, repo), encoding);

const appSource = await read('src/app.js');
const subscriberAnchor = appSource.indexOf("let prevScreen = StateStore.get('currentScreen');");
const subscriberStart = appSource.indexOf('StateStore.subscribe(', subscriberAnchor);
const subscriberEnd = appSource.indexOf('\n      });\n\n      try {\n        Router.init(', subscriberStart);
assert.ok(subscriberAnchor >= 0 && subscriberStart > subscriberAnchor && subscriberEnd > subscriberStart,
  'app.js StateStore render subscriber is extractable');
const appSubscriber = appSource.slice(subscriberStart + 'StateStore.subscribe('.length, subscriberEnd + '\n      }'.length);
assert.match(appSubscriber, /if \(notification\?\.type === 'pack-preview'\) \{\s*PacksUI\.render\(\);\s*return;/,
  'derived preview notifications refresh Packs without reconstructing Editor or Cases');

const importMap = JSON.stringify({
  imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' },
});
const rawIndex = await read('index.html');
assert.ok(rawIndex.includes('<head>'), 'index.html head is present');
const indexHtml = rawIndex.replace('<head>', `<head><script type="importmap">${importMap}</script>`);

// Replaces /src/app.js: the Editor stack exactly as app.js wires it, minus auth,
// billing backend, storage scopes and the other screens.
const bootstrap = `
import { createUIComponents } from '/src/ui/ui-components.js';
import { createKeyboardManager } from '/src/ui/keyboard-manager.js';
import { createAppShell } from '/src/ui/app-shell.js';
import { createOperationLifecycle } from '/src/core/operation-lifecycle.js';
import { TrailerPresets } from '/src/data/trailer-presets.js';
import { createSceneRuntime } from '/src/editor/scene-runtime.js';
import { createTrailerGeometry } from '/src/editor/trailer-geometry.js';
import { createCaseScene, createInteractionManager, createEditorScreen, orderAutoPackResultOptions } from '/src/screens/editor-screen.js';
import { createTruckChangeController } from '/src/ui/truck-change-controller.js';
import * as CoreUtils from '/src/core/utils/index.js';
import * as BrowserUtils from '/src/core/browser.js';
import * as Defaults from '/src/core/defaults.js';
import * as CoreStateStore from '/src/core/state-store.js';
import * as CategoryService from '/src/services/category-service.js';
import * as CaseLibrary from '/src/services/case-library.js';
import * as PackLibrary from '/src/services/pack-library.js';
import { createAutoPackEngine } from '/src/services/autopack-engine.js';
import * as PreferencesManager from '/src/services/preferences-manager.js';

const APP_SUBSCRIBER = ${JSON.stringify(appSubscriber)};
const CARGO_COUNT = ${CARGO_COUNT};

await window.__TP3D_BOOT.threeReady;
const UIComponents = createUIComponents();
const Utils = { ...CoreUtils, ...BrowserUtils };
const StateStore = {
  init: CoreStateStore.init, get: CoreStateStore.get, set: CoreStateStore.set, replace: CoreStateStore.replace,
  snapshot: CoreStateStore.snapshot, resetHistory: CoreStateStore.resetHistory, undo: CoreStateStore.undo,
  redo: CoreStateStore.redo, subscribe: CoreStateStore.subscribe,
};

const cases = Defaults.seedCases().filter(c => Math.max(c.dimensions.length, c.dimensions.width, c.dimensions.height) <= 48);
cases.forEach(c => { c.volume = Utils.volumeInCubicInches(c.dimensions); });
const packId = 'fixture-pack';
const instances = Array.from({ length: CARGO_COUNT }, (_, i) => {
  const c = cases[i % cases.length];
  return {
    id: 'cargo-' + i, caseId: c.id, hidden: false, groupId: null, placement: 'staged',
    transform: {
      position: { x: -120 - (i % 10) * 50, y: c.dimensions.height / 2, z: -200 + Math.floor(i / 10) * 60 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    },
  };
});
StateStore.init({
  currentScreen: 'editor', currentPackId: packId, selectedInstanceIds: [], caseLibrary: cases,
  packLibrary: [{ id: packId, title: 'Fixture', truck: { length: 636, width: 102, height: 110, shapeMode: 'rect' },
    cases: instances, groups: [], createdAt: 1, lastEdited: 1 }],
  folderLibrary: [], preferences: Defaults.defaultPreferences,
});

let SceneManager = null;
const TrailerGeometry = createTrailerGeometry({ Utils, CorePackLibrary: PackLibrary, getSceneManager: () => SceneManager });
const AppShell = createAppShell({ StateStore, PackLibrary, Utils });
SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore });
const CaseScene = createCaseScene({ SceneManager, CaseLibrary, CategoryService, PackLibrary, StateStore, TrailerGeometry, Utils, PreferencesManager });
const OperationLifecycle = createOperationLifecycle();
const InteractionManager = createInteractionManager({ SceneManager, CaseScene, StateStore, PackLibrary, CaseLibrary, PreferencesManager, UIComponents, OperationLifecycle });
const ExportService = { captureScreenshot() {}, generatePDF() {}, capturePackPreview: () => false, clearPackPreview: () => false };
window.__TP3D_BILLING = { getBillingState: () => ({ ok: true, orgId: '' }) };
const AutoPackEngine = createAutoPackEngine({
  CaseLibrary, CaseScene, OperationLifecycle, capturePackPreview: () => false,
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
const Storage = { saveSoon() {}, saveNow() {} };
const KeyboardManager = createKeyboardManager({
  StateStore, PackLibrary, CaseLibrary, CaseScene, SceneManager, InteractionManager, AutoPackEngine,
  OperationLifecycle, UIComponents, AppShell, Storage, Utils,
});

document.body.dataset.auth = 'signed_in';
AppShell.init();
EditorUI.init();
KeyboardManager.init();
const createAppSubscriber = new Function('deps', \`
  const { Storage, StateStore, PreferencesManager, SceneManager, EditorUI, AutoPackPreviewScheduler,
    PackLibrary, ExportService, AppShell, PacksUI, CasesUI, RecoverableErrorOverlay } = deps;
  const suspendAutoSave = false;
  let prevScreen = StateStore.get('currentScreen');
  return (\${APP_SUBSCRIBER});
\`);
StateStore.subscribe(createAppSubscriber({
  Storage, StateStore, PreferencesManager, SceneManager, EditorUI,
  AutoPackPreviewScheduler: { schedule() {} }, PackLibrary, ExportService, AppShell,
  PacksUI: { render() {} }, CasesUI: { render() {} }, RecoverableErrorOverlay: { syncRecoverableErrorOverlay() {} },
}));
AppShell.navigate('editor');
EditorUI.render();

const THREE = window.THREE;
const canvas = () => SceneManager.getRenderer().domElement;
const livePack = () => PackLibrary.getById(packId);
const realSync = CaseScene.sync;
const realSetSelected = CaseScene.setSelected;
window.probe = {
  syncCalls: 0,
  setSelectedCalls: 0,
  canvasPointerDowns: 0,
  toasts: [],
  opLog: [],
  StateStore, OperationLifecycle, SceneManager, CaseScene, AppShell, UIComponents, EditorUI, CaseLibrary,
  InteractionManager, AutoPackEngine, Utils, CategoryService, PackLibrary,
  async management() {
    const { createCasesScreen } = await import('/src/screens/cases-screen.js');
    const { createPacksScreen } = await import('/src/screens/packs-screen.js');
    const { createTableFooter } = await import('/src/ui/table-footer.js');
    // The production footer is hidden for a single record; include two fixtures
    // so Grid footer and List header/footer select-all controls are exercised.
    const packs = StateStore.get('packLibrary');
    StateStore.set({ packLibrary: [...packs, { ...packs[0], id: 'fixture-second', title: 'Second fixture', cases: [] }] },
      { skipHistory: true });
    const common = { Utils, UIComponents, PreferencesManager, PackLibrary, CaseLibrary, StateStore,
      createTableFooter, OperationLifecycle, ImportExport: {}, CardDisplayOverlay: {} };
    const CasesUI = createCasesScreen({ ...common, CategoryService, ImportCasesDialog: {} });
    const PacksUI = createPacksScreen({ ...common, TrailerPresets, AppShell, ExportService,
      TruckChangeController, ImportPackDialog: {}, featureFlags: { trailerPresetsEnabled: true },
      persistNow() {}, toast: UIComponents.showToast, toAscii: value => value });
    CasesUI.init();
    PacksUI.init();
    CasesUI.render();
    PacksUI.render();
    return true;
  },
  op: () => OperationLifecycle.currentOperation().kind,
  selection: () => (StateStore.get('selectedInstanceIds') || []).slice(),
  casesJson: () => JSON.stringify(livePack().cases),
  poses: () => JSON.stringify(livePack().cases.map(inst => CaseScene.getObject(inst.id).position.toArray())),
  committedCases: () => structuredClone(livePack().cases),
  viewedCandidate() {
    const results = StateStore.get('autoPackResults');
    if (!results || results.packId !== livePack().id) return null;
    if (this.op() === 'autopacking') return results.options.find(option => option.id === results.preferredId);
    const options = orderAutoPackResultOptions(results.options);
    return options[Number.isInteger(results.viewIndex) ? results.viewIndex : 0] || null;
  },
  transient: () => CaseScene.isTransientPreview(),
  remainingAt(cases) {
    return cases.filter(inst => {
      const obj = CaseScene.getObject(inst.id);
      return obj && obj.position.distanceTo(SceneManager.vecInchesToWorld(inst.transform.position)) > 0.05;
    }).length;
  },
  committedRemaining() { return this.remainingAt(livePack().cases); },
  // Presentation progress follows the viewed candidate while the scene is
  // transient. Committed Pack poses are a separate authority and oracle.
  presentationRemaining() {
    const candidate = this.transient() ? this.viewedCandidate() : null;
    return this.remainingAt(candidate ? candidate.nextCases : livePack().cases);
  },
  // Per-frame landing rate while watching: animation lands batch by batch, so
  // each sample may drop by at most the batches that fit in its elapsed time
  // (plus one in flight); a scene re-sync lands everything at once.
  watch() {
    const state = { last: this.presentationRemaining(), lastAt: performance.now(), maxDrop: 0, maxExcess: -Infinity, running: true };
    const sample = () => {
      const now = this.presentationRemaining();
      const at = performance.now();
      const drop = state.last - now;
      const allowed = ${BATCH_SIZE} * (Math.ceil((at - state.lastAt) / ${BATCH_MS}) + 1);
      state.maxDrop = Math.max(state.maxDrop, drop);
      state.maxExcess = Math.max(state.maxExcess, drop - allowed);
      state.last = now;
      state.lastAt = at;
    };
    const tick = () => {
      if (!state.running) return;
      sample();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.watchState = { state, sample };
  },
  unwatch() {
    const { state, sample } = this.watchState;
    state.running = false;
    sample();
    return { maxDrop: state.maxDrop, maxExcess: state.maxExcess };
  },
  emissive(id) {
    const mesh = CaseScene.getObject(id).userData.mesh;
    return (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).emissive.getHex();
  },
  accent: () => new THREE.Color(Utils.getCssVar('--accent-primary') || '#ff9f1c').getHex(),
  camera() {
    const p = SceneManager.getCamera().position;
    return { x: p.x, y: p.y, z: p.z };
  },
  // A canvas point outside the status card whose ray hits cargo \`id\` (or no
  // cargo at all when id is null), found by the same raycast the Editor uses.
  pointFor(id) {
    const camera = SceneManager.getCamera();
    const rect = canvas().getBoundingClientRect();
    const card = document.querySelector('.autopack-loading-modal');
    const avoid = card ? card.getBoundingClientRect() : null;
    const ray = new THREE.Raycaster();
    const hitAt = (x, y) => {
      ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(CaseScene.getRaycastMeshes(), false)[0];
      return hit ? hit.object.userData.instanceId : null;
    };
    const usable = (x, y) => document.elementFromPoint(x, y) === canvas() &&
      !(avoid && x > avoid.left - 24 && x < avoid.right + 24 && y > avoid.top - 24 && y < avoid.bottom + 24);
    const candidates = [];
    if (id) {
      const object = CaseScene.getObject(id);
      const v = object.position.clone().project(camera);
      candidates.push([rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]);
      // The center can be off-canvas or under the status card while another part
      // of the same cargo is visible: also sample its projected bounds, clipped
      // to the canvas. The center stays first, so any cargo it already found
      // resolves to the same point.
      const box = new THREE.Box3().setFromObject(object);
      const xs = [];
      const ys = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        xs.push(rect.left + ((p.x + 1) / 2) * rect.width);
        ys.push(rect.top + ((1 - p.y) / 2) * rect.height);
      }
      const x0 = Math.max(rect.left, Math.min(...xs));
      const x1 = Math.min(rect.right, Math.max(...xs));
      const y0 = Math.max(rect.top, Math.min(...ys));
      const y1 = Math.min(rect.bottom, Math.max(...ys));
      if (x1 > x0 && y1 > y0) {
        for (let gy = 1; gy < 6; gy += 1) for (let gx = 1; gx < 6; gx += 1) {
          candidates.push([x0 + ((x1 - x0) * gx) / 6, y0 + ((y1 - y0) * gy) / 6]);
        }
      }
    } else {
      for (let gy = 1; gy < 10; gy += 1) for (let gx = 1; gx < 16; gx += 1) {
        candidates.push([rect.left + (rect.width * gx) / 16, rect.top + (rect.height * gy) / 10]);
      }
    }
    // A bounds-sampled point must sit inside the cargo's silhouette, not on its
    // edge where a sub-pixel difference decides the hit. The center is unchanged.
    const solid = (x, y) => [[2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) =>
      usable(x + dx, y + dy) && hitAt(x + dx, y + dy) === id);
    const found = candidates.find(([x, y], index) => usable(x, y) && hitAt(x, y) === id &&
      (!id || index === 0 || solid(x, y)));
    return found ? { x: found[0], y: found[1] } : null;
  },
  cargoPoint() {
    for (const inst of livePack().cases) {
      const point = this.pointFor(inst.id);
      if (point) return { id: inst.id, ...point };
    }
    return null;
  },
  // A cargo point that stays valid for the click that follows: the cargo already
  // rests at its presented pose (it cannot move again during this run) and the
  // camera has not moved since the previous call (orbit damping has settled).
  settledCargoPoint() {
    const camera = SceneManager.getCamera();
    const last = this.lastCamera;
    this.lastCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    if (!last || last.position.distanceTo(camera.position) > 1e-3 ||
        1 - Math.abs(last.quaternion.dot(camera.quaternion)) > 1e-8) return null;
    const candidate = this.transient() ? this.viewedCandidate() : null;
    const presented = new Map((candidate ? candidate.nextCases : livePack().cases).map(inst => [inst.id, inst]));
    for (const inst of livePack().cases) {
      const target = presented.get(inst.id);
      const object = CaseScene.getObject(inst.id);
      if (!target || !object ||
          object.position.distanceTo(SceneManager.vecInchesToWorld(target.transform.position)) > 0.05) continue;
      const point = this.pointFor(inst.id);
      if (point) return { id: inst.id, ...point };
    }
    return null;
  },
};
CaseScene.sync = (...args) => {
  window.probe.syncCalls += 1;
  return realSync(...args);
};
CaseScene.setSelected = ids => {
  window.probe.setSelectedCalls += 1;
  return realSetSelected(ids);
};
OperationLifecycle.subscribe(state => window.probe.opLog.push({ kind: state.kind, at: performance.now() }));
new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
  if (node.nodeType === 1) window.probe.toasts.push(node.textContent.replace(/\\s+/g, ' ').trim());
}))).observe(document.getElementById('toast-container'), { childList: true });
canvas().addEventListener('pointerdown', () => { window.probe.canvasPointerDowns += 1; }, true);
window.__EDITOR_READY = true;
`;

const CONTENT_TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
};
const SERVED = ['/src/', '/styles/', '/vendor/', '/media/', '/node_modules/three/'];
// Transient stage toasts the status card replaced as the only running-progress channel.
const PROGRESS_TOAST = /Building load plan|Checking fit|Preparing final layout/;

async function openEditor(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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

// Gesture/Unpack tests require a packed committed baseline, so obtain it via
// the same explicit Apply boundary the user must use for INCOMPLETE Results.
async function applyPreferredNormalResult(page) {
  const before = await page.evaluate(() => {
    const p = window.probe;
    const r = p.StateStore.get('autoPackResults');
    return { cases: p.casesJson(), selected: r.selectedId, adopted: r.adoptedOptionIds,
      assessment: r.options.find(option => option.id === r.preferredId).assessment.primary,
      minimized: r.minimized, transient: p.transient() };
  });
  assert.equal(before.assessment, 'INCOMPLETE');
  assert.equal(before.selected, null);
  assert.deepEqual(before.adopted, []);
  assert.equal(before.minimized, false, 'unadopted Results start reviewable');
  assert.equal(before.transient, true);
  const apply = page.locator('[data-focus-key="results-apply"]');
  assert.equal(await apply.isEnabled(), true, 'the preferred INCOMPLETE candidate is eligible');
  await apply.click();
  assert.notEqual(await page.evaluate(() => window.probe.casesJson()), before.cases);
  assert.equal(await page.evaluate(() => window.probe.committedRemaining()), 0);
  assert.equal(await page.evaluate(() => window.probe.transient()), false);
}

test('C3 browser Case mass uses blank unknown and rejects zero or negative input', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.locator('[data-role="editor-new-case"]').click();
    await page.getByLabel('Name (required)', { exact: true }).fill('C3 unknown mass');
    const weight = page.getByLabel('Weight (lb)', { exact: true });
    assert.equal(await weight.inputValue(), '');
    assert.equal(await page.getByText('Allow flipping', { exact: true }).count(), 0);
    for (const invalid of ['0', '-1']) {
      await weight.fill(invalid);
      await page.locator('.modal-footer button').filter({ hasText: 'Save' }).click();
      assert.equal(await weight.getAttribute('aria-invalid'), 'true');
    }
    await weight.fill('');
    await page.locator('.modal-footer button').filter({ hasText: 'Save' }).click();
    assert.equal(await page.locator('.modal-overlay').count(), 0);
    const saved = await page.evaluate(() => window.probe.CaseLibrary.getCases().find(c => c.name === 'C3 unknown mass'));
    assert.equal(saved.weight, null);
    await page.evaluate(async id => {
      const p = window.probe;
      const { openCaseModal } = await import('/src/ui/overlays/case-modal.js');
      const PreferencesManager = await import('/src/services/preferences-manager.js');
      openCaseModal({ Utils: p.Utils, UIComponents: p.UIComponents, PreferencesManager,
        CaseLibrary: p.CaseLibrary, CategoryService: p.CategoryService, PackLibrary: p.PackLibrary,
        existing: p.CaseLibrary.getById(id) });
    }, saved.id);
    assert.equal(await weight.inputValue(), '');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('C3 browser Inspector fixes and releases committed orientation with focus, Undo and physical state preserved', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.evaluate(() => {
      const p = window.probe;
      const pack = p.PackLibrary.getById('fixture-pack');
      const c = { ...p.CaseLibrary.getCases()[0], id: 'c3-inspector-case', name: 'C3 orientation',
        orientationLock: 'any', weight: null, dimensions: { length: 20, width: 10, height: 6 } };
      const inst = { id: 'c3-inspector-item', caseId: c.id, placement: 'packed', hidden: false,
        orientationLocked: false, lockedRotation: null, orientedDims: { length: 999, width: 999, height: 999 },
        transform: { position: { x: 60, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } };
      p.StateStore.set({ caseLibrary: [c], packLibrary: [{ ...pack, cases: [inst] }] }, { skipHistory: true });
      p.InteractionManager.setSelection([inst.id]);
    });
    const action = page.locator('[data-focus-key="action-autopack-orientation"]');

    const current = () => page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').cases[0]);
    const before = await current();
    assert.equal(await action.count(), 1);
    await action.focus();
    await page.keyboard.press('Enter');
    const active = await current();
    assert.deepEqual(active, { ...before, orientationLocked: true, lockedRotation: before.transform.rotation });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'action-autopack-orientation');
    assert.equal((await action.textContent()).trim(), 'Unlock for AutoPack');
    assert.equal(await action.getAttribute('aria-pressed'), 'true');
    await page.locator('#viewport').focus();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual((await current()).lockedRotation, active.lockedRotation, 'position-only nudge preserves the target');
    const beforeRotation = await current();
    await page.locator('#inspector-body button').filter({ hasText: /^Turn$/ }).click();
    const rotated = await current();
    assert.equal(rotated.orientationLocked, true);
    assert.deepEqual(rotated.lockedRotation, rotated.transform.rotation);
    assert.notDeepEqual(rotated.transform.rotation, beforeRotation.transform.rotation);
    await page.evaluate(() => window.probe.StateStore.undo());
    assert.deepEqual(await current(), beforeRotation, 'one Undo restores pose and target');
    await action.click();
    assert.deepEqual(await current(), { ...beforeRotation, orientationLocked: false, lockedRotation: null });
    await page.locator('#inspector-body button').filter({ hasText: /^Turn$/ }).click();
    assert.equal((await current()).orientationLocked, false, 'unlocked rotation stays unlocked');
    assert.equal((await current()).lockedRotation, null);

    // The same single-instance action is available for hidden and staged rows.
    for (const placement of ['packed', 'staged']) {
      await page.evaluate(placement => {
        const p = window.probe, pack = p.PackLibrary.getById('fixture-pack');
        const inst = pack.cases[0];
        p.PackLibrary.update(pack.id, { cases: [{ ...inst, placement, hidden: true, packedProfile: 'max-capacity',
          transform: { ...inst.transform, position: placement === 'staged' ? { x: -80, y: 3, z: 90 } : inst.transform.position } }] });
      }, placement);
      const unchanged = await current();
      await action.click();
      assert.deepEqual(await current(), { ...unchanged, orientationLocked: true, lockedRotation: unchanged.transform.rotation });
      await action.click();
      assert.deepEqual(await current(), unchanged);
    }
    await page.evaluate(() => {
      const p = window.probe, pack = p.PackLibrary.getById('fixture-pack');
      p.StateStore.set({ caseLibrary: p.CaseLibrary.getCases().map(c => ({ ...c, orientationLock: 'upright' })),
        packLibrary: [{ ...pack, cases: [{ ...pack.cases[0], orientationLocked: true,
          lockedRotation: { x: Math.PI, y: 0, z: 0 } }] }] }, { skipHistory: true });
    });
    assert.equal(await page.locator('[data-role="autopack-orientation-status"]').count(), 0);
    const conflict = await current();
    await action.click();
    assert.deepEqual(await current(), { ...conflict, orientationLocked: false, lockedRotation: null });
    const beforeUprightTurn = await current();
    await page.locator('#inspector-body button').filter({ hasText: /^Turn$/ }).click();
    const upright = await current();
    assert.notDeepEqual(upright.transform.rotation, beforeUprightTurn.transform.rotation, 'upright allows yaw');
    assert.equal(upright.orientationLocked, false);
    for (const label of ['Tip', 'Flip']) {
      await page.locator('#inspector-body button').filter({ hasText: new RegExp(`^${label}$`) }).click();
      assert.deepEqual(await current(), upright, `upright refuses ${label} without staging or rotation`);
    }
    await page.evaluate(() => {
      const p = window.probe;
      p.StateStore.set({ caseLibrary: p.CaseLibrary.getCases().map(c => ({ ...c, orientationLock: 'onSide' })) },
        { skipHistory: true });
    });
    assert.deepEqual(await current(), upright, 'changing Case permission preserves the saved pose');
    await page.locator('#inspector-body button').filter({ hasText: /^Tip$/ }).click();
    const side = await current();
    assert.notDeepEqual(side.transform.rotation, upright.transform.rotation, 'onSide accepts a side face');
    assert.equal(side.orientationLocked, false);
    await page.locator('#inspector-body button').filter({ hasText: /^Tip$/ }).click();
    assert.deepEqual(await current(), side, 'onSide refuses authored top or bottom down');
    await page.evaluate(() => window.probe.InteractionManager.setSelection(['c3-inspector-item', 'other']));
    assert.equal(await action.count(), 0, 'bulk Inspector has no activation action');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('C3 browser Max Capacity preserves upright permission, exact target and known or unknown mass', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.evaluate(() => {
      const p = window.probe, pack = p.PackLibrary.getById('fixture-pack');
      const base = p.CaseLibrary.getCases()[0];
      const cases = [
        { ...base, id: 'c3-max-upright', orientationLock: 'upright', noStackOnTop: true, weight: 21,
          dimensions: { length: 20, width: 20, height: 10 } },
        { ...base, id: 'c3-max-exact', orientationLock: 'any', noStackOnTop: true, weight: 13,
          dimensions: { length: 20, width: 10, height: 20 } },
        { ...base, id: 'c3-max-unknown', orientationLock: 'upright', noStackOnTop: true, weight: null,
          dimensions: { length: 10, width: 20, height: 20 } },
      ];
      const instances = cases.map((c, index) => ({ id: `c3-max-item-${index}`, caseId: c.id,
        hidden: false, placement: 'staged', orientationLocked: index === 1,
        lockedRotation: index === 1 ? { x: Math.PI / 2, y: 0, z: 0 } : null,
        transform: { position: { x: 10 + index * 25, y: 5, z: 100 },
          rotation: { x: index === 1 ? Math.PI / 2 : 0, y: 0, z: 0 } } }));
      p.StateStore.set({ selectedInstanceIds: [], autoPackResults: null, caseLibrary: cases,
        packLibrary: [{ ...pack, truck: { length: 30, width: 20, height: 20, shapeMode: 'rect' }, cases: instances }] },
      { skipHistory: true });
    });
    await page.locator('#btn-autopack').click();
    await page.waitForFunction(() => window.probe.op() === 'idle' &&
      window.probe.StateStore.get('autoPackResults')?.options?.some(option => option.id === 'max-capacity'));
    if (await page.evaluate(() => window.probe.StateStore.get('autoPackResults').minimized)) {
      await page.locator('[data-focus-key="results-toggle"]').click();
    }
    for (let index = 0; index < 3; index++) {
      if ((await page.locator('.tp3d-autopack-results__option-title').textContent()) === 'Max Capacity') break;
      await page.locator('[data-focus-key="results-next"]').click();
    }
    assert.equal(await page.locator('.tp3d-autopack-results__option-title').textContent(), 'Max Capacity');
    await page.locator('[data-focus-key="results-apply"]').click();
    const result = await page.evaluate(async () => {
      const p = window.probe;
      const { isCasePhysicalOrientationAllowed } = await import('/src/core/orientation.js');
      const pack = p.PackLibrary.getById('fixture-pack');
      return { cases: pack.cases, weights: p.CaseLibrary.getCases().map(c => c.weight), stats: p.PackLibrary.computeStats(pack),
        allowed: pack.cases.every(inst => isCasePhysicalOrientationAllowed(p.CaseLibrary.getById(inst.caseId), inst.transform.rotation)) };
    });
    assert.equal(result.allowed, true);
    assert.equal(result.cases.filter(inst => inst.placement === 'packed').length, 3);
    const locked = result.cases.find(inst => inst.id === 'c3-max-item-1');
    assert.equal(locked.orientationLocked, true);
    assert.deepEqual(locked.lockedRotation, { x: Math.PI / 2, y: 0, z: 0 });
    assert.deepEqual(locked.transform.rotation, locked.lockedRotation);
    assert.deepEqual(result.weights, [21, 13, null]);
    assert.equal(result.stats.totalWeight, null);
    assert.equal(result.stats.weightComplete, false);
    assert.equal(result.stats.cog, null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix bounds document scrolling while both Editor panels and management content scroll', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const before = await page.evaluate(() => window.probe.casesJson());
    for (const size of [{ width: 1400, height: 900 }, { width: 1280, height: 600 }, { width: 1000, height: 480 }]) {
      await page.setViewportSize(size);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#viewport canvas').getBoundingClientRect();
        const host = document.querySelector('#viewport').getBoundingClientRect();
        return Math.abs(canvas.height - host.height) < 1 && Math.abs(canvas.width - host.width) < 1;
      });
      const metrics = await page.evaluate(() => {
        window.scrollTo(0, 100000);
        const selectors = ['html', 'body', '#app', '.main', '.content', '.content.editor-mode',
          '#screen-editor', '.editor-shell', '#editor-left', '.canvas-wrap', '#editor-right'];
        return selectors.map(selector => {
          const el = document.querySelector(selector);
          return { selector, height: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
        });
      });
      assert.equal(metrics[0].scrollTop, 0, JSON.stringify({ size, metrics }));
      assert.equal(metrics[0].scrollHeight, size.height, 'root cannot acquire blank scrollable space');
      assert.equal(await page.locator('.topbar').evaluate(el => el.getBoundingClientRect().top), 0);
      assert.equal(await page.locator('#app').evaluate(el => el.getBoundingClientRect().width), size.width,
        'no document scrollbar or white gutter');
      if (size.height <= 600) {
        for (const selector of ['#editor-left .panel-body', '#inspector-body']) {
          const panel = page.locator(selector);
          const scroll = await panel.evaluate(el => {
            el.scrollTop = 100000;
            return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
          });
          assert.ok(scroll.top > 0 && scroll.top === scroll.max, `${selector} retains internal scrolling`);
          assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
          await panel.evaluate(el => { el.scrollTop = 0; });
        }
      }
    }
    await page.evaluate(async () => { await window.probe.management(); window.probe.AppShell.navigate('cases'); });
    await page.locator('#cases-view-grid').click();
    assert.ok(await page.locator('.content').evaluate(el => { el.scrollTop = 100000; return el.scrollTop; }) > 0,
      'non-Editor content retains its own scrolling');
    assert.equal(await page.evaluate(() => window.probe.casesJson()), before);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix separates pointer focus from keyboard focus and preserves scene Inspector selection', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const before = await page.evaluate(() => window.probe.casesJson());
    assert.equal(await page.getByLabel('Select placed case').count(), 0);
    assert.match(await page.locator('#inspector-body').textContent(), /Truck.*Load Summary.*Space Utilization/s);
    const empty = await page.evaluate(() => window.probe.pointFor(null));
    assert.ok(empty);
    // Focus inherited from keyboard navigation is the failing pointer path.
    await page.locator('#btn-editor-left').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewport');
    const keyboard = await page.locator('#viewport').evaluate(el => {
      const css = getComputedStyle(el);
      return { style: css.outlineStyle, width: parseFloat(css.outlineWidth), rect: el.getBoundingClientRect().toJSON() };
    });
    assert.equal(keyboard.style, 'solid');
    assert.ok(keyboard.width > 0 && keyboard.width <= 2, 'restrained keyboard outline');
    await page.mouse.click(empty.x, empty.y);
    assert.equal(await page.locator('#viewport').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewport', 'pointer still owns cargo shortcuts');
    assert.deepEqual(await page.locator('#viewport').evaluate(el => el.getBoundingClientRect().toJSON()), keyboard.rect,
      'focus does not change layout');
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + 8, empty.y + 8);
    await page.mouse.up();
    assert.equal(await page.locator('#viewport').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#viewport').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    const cargo = await page.evaluate(() => window.probe.cargoPoint());
    assert.ok(cargo);
    await page.mouse.click(cargo.x, cargo.y);
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), [cargo.id]);
    assert.equal(await page.getByRole('button', { name: /Apply position/ }).count(), 1);
    assert.equal(await page.getByLabel('Select placed case').count(), 0);
    await page.keyboard.press('Control+a');
    assert.match(await page.locator('#inspector-body').textContent(), /selected/i);
    assert.equal(await page.getByLabel('Select placed case').count(), 0);
    await page.keyboard.press('Escape');
    assert.match(await page.locator('#inspector-body').textContent(), /Truck.*Load Summary.*Space Utilization/s);
    assert.equal(await page.evaluate(() => window.probe.casesJson()), before, 'presentation interactions preserve cargo');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// Viewport focus modality: pointer-origin focus stays visually clean through
// transform shortcuts; only Tab / Shift+Tab exposes the keyboard cue.
async function prepareModalityFixture(page) {
  // Disposable fixture data: every case may turn, tip, roll and flip; count camera focus requests.
  await page.evaluate(() => {
    const { StateStore, SceneManager } = window.probe;
    StateStore.set({ caseLibrary: StateStore.get('caseLibrary').map(c => ({ ...c, orientationLock: 'any', canFlip: true })) },
      { skipHistory: true });
    window.probe.focusCalls = 0;
    const focusOnWorldPoint = SceneManager.focusOnWorldPoint;
    SceneManager.focusOnWorldPoint = (...args) => { window.probe.focusCalls += 1; return focusOnWorldPoint(...args); };
  });
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const sameAngle = (a, b) => {
    const d = (((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return d < 1e-6 || 2 * Math.PI - d < 1e-6;
  };
  const viewportState = id => page.evaluate(id => {
    const el = document.querySelector('#viewport');
    const css = getComputedStyle(el);
    const inst = JSON.parse(window.probe.casesJson()).find(i => i.id === id);
    return { owns: document.activeElement === el, outline: css.outlineStyle, outlineWidth: css.outlineWidth,
      rotation: inst.transform.rotation, z: inst.transform.position.z };
  }, id);
  const pressTransforms = async (id, expectOutline) => {
    const start = await viewportState(id);
    const steps = [
      ['r', v => sameAngle(v.rotation.y, start.rotation.y + Math.PI / 2)],
      ['t', v => sameAngle(v.rotation.x, start.rotation.x + Math.PI / 2)],
      ['e', v => sameAngle(v.rotation.z, start.rotation.z + Math.PI / 2)],
      ['f', v => sameAngle(v.rotation.x, start.rotation.x + (3 * Math.PI) / 2)],
      ['ArrowRight', v => near(v.z, start.z + 1)],
      ['x', () => true],
      ['Meta', () => true],
    ];
    for (const [key, applied] of steps) {
      await page.keyboard.press(key);
      const v = await viewportState(id);
      assert.ok(v.owns, `${key}: the viewport keeps shortcut ownership`);
      assert.equal(v.outline, expectOutline, `${key}: focus cue ${expectOutline === 'none' ? 'stays hidden' : 'stays visible'}`);
      assert.ok(applied(v), `${key}: the shortcut still applies its transform`);
    }
  };
  return { viewportState, pressTransforms };
}

test('UI hotfix pointer-origin viewport focus stays visually clean through transform shortcuts', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const { viewportState, pressTransforms } = await prepareModalityFixture(page);
    // Enter keyboard modality first so the pointer's programmatic focus could inherit it.
    await page.locator('#btn-editor-left').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.probe.cargoPoint() !== null);
    const cargo = await page.evaluate(() => window.probe.cargoPoint());
    await page.mouse.click(cargo.x, cargo.y);
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), [cargo.id]);
    const clicked = await viewportState(cargo.id);
    assert.ok(clicked.owns, 'pointer interaction gives the viewport shortcut ownership');
    assert.equal(clicked.outline, 'none', 'pointer interaction shows no focus cue');
    await pressTransforms(cargo.id, 'none');
    await pressTransforms(cargo.id, 'none');
    assert.equal(await page.evaluate(() => window.probe.focusCalls), 0, 'no shortcut focuses the camera');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix keyboard-origin viewport focus keeps its cue through transform shortcuts until Tab leaves', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const { viewportState, pressTransforms } = await prepareModalityFixture(page);
    // A non-primary press on the unfocused viewport must not mark later keyboard focus as pointer-owned.
    await page.locator('#btn-editor-left').focus();
    const empty = await page.evaluate(() => window.probe.pointFor(null));
    await page.mouse.click(empty.x, empty.y, { button: 'right' });
    await page.locator('#btn-editor-left').focus();
    await page.keyboard.press('Shift+Tab');
    await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-0']));
    const reached = await viewportState('cargo-0');
    assert.ok(reached.owns, 'Shift+Tab reaches the viewport');
    assert.deepEqual([reached.outline, reached.outlineWidth], ['solid', '2px'], 'keyboard focus shows the restrained cue');
    await pressTransforms('cargo-0', 'solid');
    await page.keyboard.press('Tab');
    const left = await viewportState('cargo-0');
    assert.ok(!left.owns, 'Tab leaves the viewport');
    assert.equal(left.outline, 'none', 'the cue leaves with focus');
    assert.equal(await page.evaluate(() => window.probe.focusCalls), 0, 'no shortcut focuses the camera');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix Print and P are unhandled while viewport transform keys keep their ownership', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const result = await page.evaluate(() => {
      let packCalls = 0, devCalls = 0;
      window.probe.AutoPackEngine.pack = async () => { packCalls++; };
      window.probe.SceneManager.toggleDevOverlay = () => { devCalls++; };
      const send = (target, key, modifiers = {}) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const viewport = document.querySelector('#viewport');
      const share = document.querySelector('#btn-share');
      const print = [viewport, share, document.body].flatMap(target =>
        [{ ctrlKey: true }, { metaKey: true }, {}].map(modifiers => send(target, 'p', modifiers)));
      const spatial = ['r', 't', 'e', 'f', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      // With no selection these real listeners consume only viewport-owned keys
      // without invoking a substantive operation or mutating any fixture cargo.
      const ownership = spatial.map(key => ({ key, viewport: send(viewport, key), share: send(share, key),
        input: send(document.querySelector('#editor-case-search'), key), body: send(document.body, key) }));
      return { print, packCalls, devCalls, ownership };
    });
    assert.equal(result.packCalls, 0);
    assert.equal(result.devCalls, 0);
    assert.ok(result.print.every(prevented => !prevented), 'Print remains available to the browser');
    for (const item of result.ownership) assert.deepEqual(item,
      { key: item.key, viewport: true, share: false, input: false, body: false });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix selected-case Inspector mirrors the Truck header with compact metadata and separate rule sets', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const truckHeading = await page.locator('#inspector-body .tp3d-editor-inspector-title-row .tp3d-editor-fw-semibold')
      .evaluate(el => ({ text: el.textContent, font: [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight] }));
    assert.equal(truckHeading.text, 'Truck');
    // Disposable fixture data: case-level rules and a long name on cargo-7's case,
    // plus an instance-level lock, so every section of the card renders.
    const fixture = await page.evaluate(() => {
      const { StateStore, Utils, CategoryService } = window.probe;
      const [pack] = StateStore.get('packLibrary');
      const caseId = pack.cases.find(i => i.id === 'cargo-7').caseId;
      const cases = StateStore.get('caseLibrary').map(c => c.id !== caseId ? c : {
        ...c, name: 'Extremely long fixture case name that wraps instead of colliding with Notes',
        weight: 52.91, orientationLock: 'upright', laneItem: false, loadPriority: 1,
      });
      StateStore.set({
        caseLibrary: cases,
        packLibrary: [{ ...pack, cases: pack.cases.map(i => (i.id === 'cargo-7' ? { ...i, orientationLocked: true } : i)) }],
      }, { skipHistory: true });
      const caseData = cases.find(c => c.id === caseId);
      const probe = document.createElement('span');
      probe.style.background = CategoryService.meta(caseData.category || 'default').color;
      document.body.appendChild(probe);
      const categoryColor = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        name: caseData.name, manufacturer: caseData.manufacturer,
        dims: Utils.formatDims(caseData.dimensions, StateStore.get('preferences').units.length),
        volume: Utils.formatVolume(caseData.dimensions, StateStore.get('preferences').units.length),
        weight: `${caseData.weight.toFixed(2)} lb`,
        category: CategoryService.meta(caseData.category || 'default').name, categoryColor,
      };
    });
    assert.ok(fixture.manufacturer, 'the seed case carries a manufacturer');
    await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-7']));
    const card = page.locator('#inspector-body .card').first();
    const inspect = () => card.evaluate(el => {
      const rect = node => node.getBoundingClientRect();
      const css = node => getComputedStyle(node);
      const header = el.querySelector('.tp3d-editor-inspector-title-row');
      const heading = header.querySelector('.tp3d-editor-fw-semibold');
      const notes = [...header.querySelectorAll('button')].find(button => /Notes/.test(button.textContent));
      const name = el.querySelector('.tp3d-editor-case-name');
      const meta = [...el.querySelectorAll('.tp3d-editor-case-meta > *')];
      const cardRect = rect(el);
      return {
        heading: heading.textContent, headingFont: [css(heading).fontSize, css(heading).fontWeight],
        notesInHeader: Boolean(notes), headingClearsNotes: rect(heading).right <= rect(notes).left,
        notesInside: rect(notes).right <= cardRect.right + 0.5,
        name: name.textContent, nameTitle: name.title, nameBelowHeader: rect(name).top >= rect(header).bottom,
        nameColor: css(name).color, nameWeight: Number(css(name).fontWeight), nameSize: parseFloat(css(name).fontSize),
        meta: meta.map(chip => ({
          text: chip.textContent, pill: chip.classList.contains('tp3d-editor-meta-chip'),
          radius: parseFloat(css(chip).borderTopLeftRadius), border: css(chip).borderTopStyle,
          color: css(chip).color, size: parseFloat(css(chip).fontSize),
          dot: chip.querySelector('.chip-dot') ? css(chip.querySelector('.chip-dot')).backgroundColor : null,
          width: rect(chip).width, right: rect(chip).right, top: Math.round(rect(chip).top),
        })),
        rules: [...el.querySelectorAll('.tp3d-editor-rules-heading')].map(h => ({
          text: h.textContent, color: css(h).color, weight: Number(css(h).fontWeight), size: parseFloat(css(h).fontSize),
          chips: [...h.nextElementSibling.querySelectorAll('.tp3d-handling-chip')].map(chip =>
            ({ text: chip.textContent, instance: chip.classList.contains('tp3d-handling-chip-instance'),
              size: parseFloat(css(chip).fontSize) })),
        })),
        cardWidth: cardRect.width, cardRight: cardRect.right, overflow: el.scrollWidth - el.clientWidth,
      };
    });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const view = await inspect();
      assert.equal(view.heading, 'Cases');
      assert.deepEqual(view.headingFont, truckHeading.font, 'Cases uses the Truck heading type');
      assert.ok(view.notesInHeader && view.headingClearsNotes && view.notesInside, 'Notes stays in the header row');
      assert.equal(view.name, fixture.name);
      assert.equal(view.nameTitle, fixture.name);
      assert.ok(view.nameBelowHeader, 'the case name sits below the Cases / Notes header');
      assert.ok(view.nameWeight >= 600 && view.nameSize > 14, 'the name is semibold and above body size');
      assert.deepEqual(view.meta.map(chip => chip.text),
        [fixture.dims, fixture.volume, fixture.weight, fixture.manufacturer, fixture.category],
        'dimensions, canonical volume, two-decimal weight, manufacturer, then category');
      for (const chip of view.meta) {
        assert.ok(chip.pill && chip.radius >= 8 && chip.border === 'solid', `${chip.text} is a rounded bordered pill`);
        assert.equal(chip.color, view.nameColor, `${chip.text} uses normal text color`);
        assert.ok(chip.size < view.nameSize, `${chip.text} is quieter than the name`);
        assert.ok(chip.width < view.cardWidth / 2 + 40, `${chip.text} is content-sized, not a full-width field`);
      }
      assert.equal(view.meta[4].dot, fixture.categoryColor, 'Category keeps its color dot');
      assert.deepEqual(view.rules.map(rule => rule.text), ['Handling rules']);
      const [caseRules] = view.rules;
      assert.equal(caseRules.color, view.nameColor, 'Handling rules heading uses primary, not muted, text');
      assert.ok(caseRules.weight >= 600 && caseRules.chips.every(chip => chip.size < caseRules.size));
      assert.deepEqual(caseRules.chips, [
        { text: 'Upright', instance: false, size: caseRules.chips[0].size },
        { text: 'Lane: Never', instance: false, size: caseRules.chips[0].size },
        { text: 'Priority: High', instance: false, size: caseRules.chips[0].size },
      ], 'case-level policy stays in its own set');
      assert.ok(view.overflow <= 0, 'no horizontal overflow');
    }
    // A narrow Inspector wraps metadata and rules without colliding or overflowing.
    await card.evaluate(el => { el.style.width = '200px'; });
    const narrow = await inspect();
    assert.ok(narrow.headingClearsNotes && narrow.notesInside, 'Notes remains reachable at narrow widths');
    assert.ok(narrow.overflow <= 0 && narrow.meta.every(chip => chip.right <= narrow.cardRight + 0.5));
    assert.ok(new Set(narrow.meta.map(chip => chip.top)).size > 1, 'metadata wraps onto another line');
    await card.evaluate(el => { el.style.width = ''; });
    const metric = await page.evaluate(() => {
      const { StateStore, InteractionManager, Utils } = window.probe;
      const prefs = StateStore.get('preferences');
      StateStore.set({ preferences: { ...prefs, units: { length: 'cm', weight: 'kg' } } }, { skipHistory: true });
      InteractionManager.setSelection(['cargo-7']);
      const chips = [...document.querySelectorAll('#inspector-body .card .tp3d-editor-case-meta > *')]
        .map(el => el.textContent);
      const caseId = StateStore.get('packLibrary')[0].cases.find(i => i.id === 'cargo-7').caseId;
      const c = StateStore.get('caseLibrary').find(item => item.id === caseId);
      return { chips, dims: Utils.formatDims(c.dimensions, 'cm'), volume: Utils.formatVolume(c.dimensions, 'cm'),
        weight: `${(c.weight * 0.453592).toFixed(2)} kg`, manufacturer: c.manufacturer,
        category: window.probe.CategoryService.meta(c.category || 'default').name };
    });
    assert.deepEqual(metric.chips,
      [metric.dims, metric.volume, metric.weight, metric.manufacturer, metric.category],
      'Inspector follows Case Browser unit preferences');
    assert.equal(await page.locator('#inspector-body').getByText('Handling rules (case)').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('hidden packed cargo keeps one physical pose through Hide, selection, drag, and Show', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const id = 'cargo-7';
    await page.evaluate(id => {
      const { StateStore } = window.probe;
      const [pack] = StateStore.get('packLibrary');
      const source = pack.cases.find(inst => inst.id === id);
      const c = StateStore.get('caseLibrary').find(item => item.id === source.caseId);
      const packed = { ...source, placement: 'packed', hidden: false,
        transform: { ...source.transform, position: { x: 318, y: c.dimensions.height / 2, z: 0 } } };
      StateStore.set({ packLibrary: [{ ...pack, cases: [packed] }], selectedInstanceIds: [] }, { skipHistory: true });
    }, id);

    const pose = () => page.evaluate(id => {
      const { PackLibrary, StateStore, SceneManager, CaseScene } = window.probe;
      const inst = PackLibrary.getById(StateStore.get('currentPackId')).cases.find(item => item.id === id);
      const group = CaseScene.getObject(id);
      const mesh = group.userData.mesh;
      // A snapshot can precede the next render after a synchronous fixture edit.
      // Box3 updates the mesh, but not its parents; measure one current hierarchy.
      group.updateWorldMatrix(true, true);
      const bounds = new window.THREE.Box3().setFromObject(mesh);
      const handle = CaseScene.getGizmoHandleMeshes()[0];
      const gizmo = handle ? handle.parent.parent : null;
      const vec = value => value ? value.toArray() : null;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return {
        saved: { ...inst.transform.position }, hidden: inst.hidden,
        expected: vec(SceneManager.vecInchesToWorld(inst.transform.position)),
        group: vec(group.getWorldPosition(group.position.clone())),
        mesh: vec(mesh.getWorldPosition(mesh.position.clone())),
        meshBoundsCenter: vec(bounds.getCenter(group.position.clone())),
        meshBoundsMinY: bounds.min.y,
        meshLocal: vec(mesh.position),
        gizmoTarget: CaseScene.getGizmoTargetId(),
        gizmo: gizmo ? vec(gizmo.getWorldPosition(gizmo.position.clone())) : null,
        selected: window.probe.selection(),
        opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
      };
    }, id);
    const close = (actual, expected, label) => {
      assert.ok(actual && expected, `${label}: missing position`);
      assert.equal(actual.length, expected.length, `${label}: dimension mismatch`);
      for (let axis = 0; axis < actual.length; axis += 1) {
        assert.ok(Math.abs(actual[axis] - expected[axis]) < 0.01,
          `${label} axis ${axis}: ${JSON.stringify({ actual, expected })}`);
      }
    };
    const aligned = (state, label, matchSaved = true) => {
      if (matchSaved) close(state.group, state.expected, `${label} group/saved`);
      close(state.mesh, state.group, `${label} rendered mesh/group`);
      close(state.meshBoundsCenter, state.group, `${label} rendered geometry center/group`);
      close(state.meshLocal, [0, 0, 0], `${label} mesh local origin`);
      if (state.gizmo) {
        close([state.gizmo[0], state.gizmo[2]], [state.group[0], state.group[2]], `${label} gizmo x/z`);
        assert.ok(state.gizmo[1] > state.group[1], `${label} gizmo sits above the same Case, not at another cargo pose`);
      }
    };

    const before = await pose();
    aligned(before, 'before Hide');
    assert.ok(Math.abs(before.meshBoundsMinY) < 0.01, 'the known packed Case rests at floor level');
    assert.deepEqual(before.selected, []);
    const visiblePoint = await page.evaluate(id => window.probe.pointFor(id), id);
    assert.ok(visiblePoint, 'the known floor-level packed Case is raycastable');
    await page.mouse.click(visiblePoint.x, visiblePoint.y);
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), [id]);
    await page.locator('#inspector-body').getByRole('button', { name: 'Hide' }).click();
    const hidden = await pose();
    aligned(hidden, 'after Hide');
    assert.ok(Math.abs(hidden.meshBoundsMinY) < 0.01, 'Hide does not lift the rendered cargo off the floor');
    assert.equal(hidden.hidden, true);
    assert.deepEqual(hidden.saved, before.saved, 'Hide preserves the authoritative transform');
    assert.ok(hidden.transparent && hidden.opacity > 0 && hidden.opacity < 1 && !hidden.depthWrite,
      'hidden cargo retains its translucent visual contract');
    await page.locator('#inspector-body').getByRole('button', { name: 'Deselect' }).click();
    const hiddenPoint = await page.evaluate(id => window.probe.pointFor(id), id);
    assert.ok(hiddenPoint, 'the hidden mesh remains pickable at the saved cargo pose');
    await page.mouse.click(hiddenPoint.x, hiddenPoint.y);
    const selected = await pose();
    aligned(selected, 'hidden selected');
    assert.deepEqual(selected.selected, [id]);
    assert.equal(selected.gizmoTarget, id);
    assert.deepEqual(selected.saved, before.saved, 'selection does not teleport the saved Case');

    await page.mouse.move(hiddenPoint.x, hiddenPoint.y);
    await page.mouse.down();
    const grabbed = await pose();
    aligned(grabbed, 'hidden grab start');
    assert.deepEqual(grabbed.saved, before.saved, 'grabbing starts from the saved pose');
    await page.mouse.move(hiddenPoint.x + 12, hiddenPoint.y + 6, { steps: 3 });
    const dragging = await pose();
    aligned(dragging, 'hidden drag preview', false);
    assert.ok(dragging.group.some((value, axis) => Math.abs(value - grabbed.group[axis]) > 0.01),
      'the real pointer gesture starts a spatial drag preview');
    assert.equal(dragging.gizmoTarget, id);
    assert.deepEqual(dragging.saved, before.saved, 'preview motion does not commit before release');
    await page.mouse.up();
    const released = await pose();
    aligned(released, 'hidden drag release');
    assert.equal(released.hidden, true);
    await page.locator('#inspector-body').getByRole('button', { name: 'Show' }).click();
    const shown = await pose();
    aligned(shown, 'after Show');
    assert.equal(shown.hidden, false);
    assert.deepEqual(shown.saved, released.saved, 'Show preserves the committed transform');
    assert.equal(shown.opacity, 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix Space Utilization renders only in the Truck Inspector, including lifecycle refreshes', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const before = await page.evaluate(() => window.probe.casesJson());
    const inspector = () => page.evaluate(() => {
      const body = document.querySelector('#inspector-body');
      const gauges = [...body.querySelectorAll('[data-role="space-utilization-gauge"]')];
      return { gauges: gauges.length, text: gauges.map(g => g.textContent.replace(/\s+/g, ' ').trim()).join('|'),
        headings: [...body.querySelectorAll(':scope > .card')].map(card => card.textContent.trim().split(/\s{2,}|\n/)[0]) };
    });
    // A real lifecycle transition (preview capture follows edits) refreshes the gauge.
    const lifecycleTick = () => page.evaluate(() => {
      const { OperationLifecycle } = window.probe;
      OperationLifecycle.finishOperation(OperationLifecycle.beginOperation('capturingPreview'));
    });
    const truck = await inspector();
    assert.equal(truck.gauges, 1, 'the Truck Inspector owns Space Utilization');
    assert.match(truck.text, /Space Utilization/);
    await lifecycleTick();
    assert.deepEqual(await inspector(), truck, 'a lifecycle refresh neither duplicates nor changes the Truck gauge');

    await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-7']));
    assert.equal((await inspector()).gauges, 0, 'single selection has no Space Utilization');
    await lifecycleTick();
    assert.equal((await inspector()).gauges, 0, 'a lifecycle refresh never adds it to the single-selection Inspector');

    await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-1', 'cargo-2']));
    assert.match(await page.locator('#inspector-body').textContent(), /selected/i, 'the multi-selection Inspector renders');
    assert.equal((await inspector()).gauges, 0, 'multi-selection has no Truck Space Utilization card');
    await lifecycleTick();
    assert.equal((await inspector()).gauges, 0, 'a lifecycle refresh never adds it to the multi-selection Inspector');

    await page.evaluate(() => window.probe.InteractionManager.setSelection([]));
    assert.deepEqual(await inspector(), truck, 'deselecting restores the same Truck gauge through normal render');
    assert.equal(await page.evaluate(() => window.probe.casesJson()), before, 'Pack data is unchanged');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix F flips the selected case in either letter case and no Focus Selected shortcut remains', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    // Disposable fixture data: allow cargo-0's case to flip, and count camera focus requests.
    await page.evaluate(() => {
      const { StateStore, SceneManager } = window.probe;
      const caseId = StateStore.get('packLibrary')[0].cases.find(i => i.id === 'cargo-0').caseId;
      StateStore.set({ caseLibrary: StateStore.get('caseLibrary').map(c =>
        (c.id === caseId ? { ...c, orientationLock: 'any', canFlip: true } : c)) }, { skipHistory: true });
      window.probe.focusCalls = 0;
      const focusOnWorldPoint = SceneManager.focusOnWorldPoint;
      SceneManager.focusOnWorldPoint = (...args) => { window.probe.focusCalls += 1; return focusOnWorldPoint(...args); };
    });
    const instance = () => page.evaluate(() => JSON.parse(window.probe.casesJson()).find(i => i.id === 'cargo-0').transform);
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    // Tab, not a shortcut, is how keyboard users reach the viewport.
    await page.locator('#btn-editor-left').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewport');
    await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-0']));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewport');

    await page.keyboard.press('f');
    assert.ok(near((await instance()).rotation.x, Math.PI), 'F flips 180 degrees');
    await page.keyboard.press('Shift+F');
    assert.ok(near((await instance()).rotation.x, 0), 'Shift+F is still Flip, not Focus Selected');
    assert.equal(await page.evaluate(() => window.probe.focusCalls), 0, 'F never focuses or zooms the camera');

    const offViewport = await page.evaluate(() => {
      const before = window.probe.casesJson();
      const event = new KeyboardEvent('keydown', { key: 'F', shiftKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return { prevented: event.defaultPrevented, unchanged: window.probe.casesJson() === before, focusCalls: window.probe.focusCalls };
    });
    assert.deepEqual(offViewport, { prevented: false, unchanged: true, focusCalls: 0 }, 'no app-level Shift+F shortcut remains');

    await page.locator('#viewport').focus();
    await page.keyboard.press('r');
    assert.ok(near((await instance()).rotation.y, Math.PI / 2), 'R still turns');
    await page.keyboard.press('t');
    assert.ok(near((await instance()).rotation.x, Math.PI / 2), 'T still tips');
    await page.keyboard.press('e');
    assert.ok(near((await instance()).rotation.z, Math.PI / 2), 'E still rolls');
    const z = (await instance()).position.z;
    await page.keyboard.press('ArrowRight');
    assert.ok(near((await instance()).position.z, z + 1), 'arrows still nudge');
    assert.equal(await page.evaluate(() => window.probe.focusCalls), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// Shortcut contract: dispatch a keydown to the focused element and report
// whether the app claimed it and whether any fixture cargo changed.
function keySender(page) {
  return (key, init = {}) => page.evaluate(({ key, init }) => {
    const before = window.probe.casesJson();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    document.activeElement.dispatchEvent(event);
    return { prevented: event.defaultPrevented, changed: window.probe.casesJson() !== before };
  }, { key, init });
}

test('Shortcut contract: viewport cargo keys are bare keys; browser combinations pass through untouched', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await prepareModalityFixture(page);
    await page.locator('#btn-editor-left').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewport');
    await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-0']));
    const send = keySender(page);
    const untouched = { prevented: false, changed: false };

    // Cmd/Ctrl/Alt + R/T/E/F (Find, Reload, hard Reload, ...) and Cmd/Ctrl arrows are the browser's.
    const combos = [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true },
      { metaKey: true, shiftKey: true }, { altKey: true, shiftKey: true }];
    for (const key of ['r', 't', 'e', 'f']) {
      for (const init of combos) {
        const shifted = init.shiftKey ? key.toUpperCase() : key;
        assert.deepEqual(await send(shifted, init), untouched, `${JSON.stringify(init)} ${shifted}: never transforms`);
      }
    }
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      for (const init of [{ metaKey: true }, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }]) {
        assert.deepEqual(await send(key, init), untouched, `${JSON.stringify(init)} ${key}: never nudges`);
      }
    }
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      assert.deepEqual(await send(key, { altKey: true }), untouched, `Alt+${key}: Back/Forward, never a nudge`);
    }
    // Removed app shortcuts are not intercepted on the viewport or the page.
    for (const [key, init] of [['o', { metaKey: true }], ['o', { ctrlKey: true }], ['s', { metaKey: true }],
      ['s', { ctrlKey: true }], ['A', { metaKey: true, shiftKey: true }], ['A', { ctrlKey: true, shiftKey: true }]]) {
      assert.deepEqual(await send(key, init), untouched, `${JSON.stringify(init)} ${key}: not intercepted`);
    }
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), ['cargo-0']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.modal-overlay').length), 0, 'no Open Load Plan dialog');

    // Bare and Shift+letter keep their transforms; F is Flip, never a camera focus.
    const pose = () => page.evaluate(() => JSON.parse(window.probe.casesJson()).find(i => i.id === 'cargo-0').transform);
    const sameAngle = (a, b) => {
      const d = (((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return d < 1e-6 || 2 * Math.PI - d < 1e-6;
    };
    let start = await pose();
    for (const [key, axis, turn] of [['r', 'y', Math.PI / 2], ['Shift+R', 'y', Math.PI / 2], ['t', 'x', Math.PI / 2],
      ['Shift+E', 'z', Math.PI / 2], ['f', 'x', Math.PI], ['Shift+F', 'x', Math.PI]]) {
      await page.keyboard.press(key);
      const next = await pose();
      assert.ok(sameAngle(next.rotation[axis], start.rotation[axis] + turn), `${key}: applies its transform`);
      start = next;
    }
    assert.equal(await page.evaluate(() => window.probe.focusCalls), 0, 'no key focuses the camera');

    // Auto-repeat: discrete transforms are consumed without acting; nudges keep repeating.
    for (const key of ['r', 'T', 'e', 'F']) {
      assert.deepEqual(await send(key, { repeat: true }), { prevented: true, changed: false }, `${key} auto-repeat`);
    }
    start = await pose();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await send('ArrowRight', { repeat: true }), { prevented: true, changed: true }, 'arrow auto-repeat nudges');
    assert.deepEqual(await send('ArrowUp', { shiftKey: true, repeat: true }), { prevented: true, changed: true });
    let next = await pose();
    assert.ok(Math.abs(next.position.z - (start.position.z + 2)) < 1e-6, 'bare arrows nudge 1" per press');
    assert.ok(Math.abs(next.position.x - (start.position.x + 6)) < 1e-6, 'Shift+arrows nudge 6" per press');
    await page.keyboard.press('Shift+ArrowLeft');
    next = await pose();
    assert.ok(Math.abs(next.position.z - (start.position.z - 4)) < 1e-6);

    // Alt/Option Up, Down and Shift+Down still route to the validated vertical move
    // (a staged fixture case is refused by PackLibrary.findManualVerticalPlacement).
    const verticalRefusals = () => page.evaluate(() =>
      window.probe.toasts.filter(text => /Staged cases cannot be moved vertically/.test(text)).length);
    const before = await verticalRefusals();
    for (const init of [{ altKey: true }, { altKey: true, shiftKey: true }]) {
      assert.deepEqual(await send('ArrowUp', init), { prevented: true, changed: false });
      assert.deepEqual(await send('ArrowDown', init), { prevented: true, changed: false });
    }
    assert.equal(await verticalRefusals(), before + 4, 'every Alt vertical key reached the validated vertical service');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Shortcut contract: Load Plans filter chips toggle once per Enter or Space', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.evaluate(async () => { await window.probe.management(); window.probe.AppShell.navigate('packs'); });
    if (await page.locator('#packs-filters-toggle').getAttribute('aria-expanded') !== 'true') {
      await page.locator('#packs-filters-toggle').click();
    }
    const active = id => page.locator(`#${id}`).evaluate(el => el.classList.contains('active'));
    for (const id of ['packs-filter-chip-empty', 'packs-filter-chip-partial', 'packs-filter-chip-full']) {
      assert.equal(await active(id), false);
      await page.locator(`#${id}`).focus();
      await page.keyboard.press('Enter');
      assert.equal(await active(id), true, `${id}: Enter toggles exactly once`);
      assert.equal(await active('packs-filter-chip-all'), false);
      await page.keyboard.press('Space');
      assert.equal(await active(id), false, `${id}: Space toggles exactly once`);
      assert.equal(await active('packs-filter-chip-all'), true);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Shortcut contract: one owner per Escape across popup, selection, Qty field, drawer and sidebar', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const before = await page.evaluate(() => window.probe.casesJson());
    const selection = () => page.evaluate(() => window.probe.selection());
    const select = () => page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-0']));
    const toggle = page.locator('#editor-case-filters-toggle');

    // Desktop: the open Case Browser filter popup takes the first Escape wherever focus is,
    // and holds Editor keys until it closes.
    await select();
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.locator('#viewport').focus();
    const send = keySender(page);
    assert.deepEqual(await send('r'), { prevented: false, changed: false }, 'Editor keys wait while the popup is open');
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'the popup closed first');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor-case-filters-toggle', 'focus returns to its toggle');
    assert.deepEqual(await selection(), ['cargo-0'], 'the same Escape did not also deselect');
    await page.keyboard.press('Escape');
    assert.deepEqual(await selection(), [], 'the next Escape clears the selection');

    // A modal still owns Escape ahead of the Editor selection (PR #85 registry).
    await select();
    await page.locator('[data-role="editor-new-case"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.modal-overlay').length), 0);
    assert.deepEqual(await selection(), ['cargo-0'], 'closing the modal did not deselect');

    // Mobile: deselect, Qty revert, drawer and sidebar each consume their own Escape.
    await page.setViewportSize({ width: 390, height: 640 });
    await page.locator('#btn-editor-left').click();
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.deepEqual(await selection(), [], 'the first Escape deselects');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'true', 'and leaves the drawer open');
    const qty = page.locator('.tp3d-editor-case-qty-input').first();
    const draft = await qty.inputValue();
    await qty.fill('7');
    await page.keyboard.press('Escape');
    assert.equal(await qty.inputValue(), draft, 'Escape reverts the Qty field');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'true', 'without also closing the drawer');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'false', 'an unclaimed Escape closes the drawer');

    await select();
    await page.locator('#btn-sidebar').click();
    assert.equal(await page.locator('#btn-sidebar').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.deepEqual(await selection(), [], 'the selection takes this Escape');
    assert.equal(await page.locator('#btn-sidebar').getAttribute('aria-expanded'), 'true', 'the sidebar stays open');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#btn-sidebar').getAttribute('aria-expanded'), 'false', 'the next Escape closes the sidebar');
    assert.equal(await page.evaluate(() => window.probe.casesJson()), before, 'Escape layering never changes cargo');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Shortcut contract F-19: default-open Load Plans/Cases filter owners never outlive navigation into the Editor', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    // Production boot order on a hash-less URL: state starts on Load Plans, the
    // management screens register their filter surfaces from the default-open
    // preferences, and no route navigation has happened yet.
    const boot = await page.evaluate(async () => {
      const { StateStore, UIComponents } = window.probe;
      StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
      await window.probe.management();
      const prefs = StateStore.get('preferences');
      return {
        prefs: [prefs.packsFiltersVisible, prefs.casesFiltersVisible],
        activeOwners: UIComponents.modalOwnership.getOwners().filter(owner => owner.isActive()).length,
      };
    });
    assert.deepEqual(boot.prefs, [true, true], 'fixture uses the default-open filter preferences');
    assert.equal(boot.activeOwners, 2, 'reproduced: both default-open filter surfaces are active owners before any navigation');
    const send = keySender(page);
    // On Load Plans the key manager has nothing to own, so an active owner changes nothing.
    for (const [key, init] of [['c', { metaKey: true }], ['a', { ctrlKey: true }], ['d', { metaKey: true }], ['z', { ctrlKey: true }]]) {
      assert.equal((await send(key, init)).prevented, false, `Load Plans ${key}: browser behavior`);
    }
    // Every path into the Editor sets currentScreen, which closes every filter surface.
    await page.evaluate(() => window.probe.AppShell.navigate('editor'));
    assert.equal(await page.evaluate(() =>
      window.probe.UIComponents.modalOwnership.getOwners().filter(owner => owner.isActive()).length), 0,
    'no filter owner survives into the Editor');
    await page.locator('#viewport').focus();
    await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-0']));
    assert.deepEqual(await send('ArrowRight'), { prevented: true, changed: true }, 'Editor keys are live after boot');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix primary actions keep the bright brand fill with white text and icons in both themes', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    const before = await page.evaluate(() => window.probe.casesJson());
    const sample = async selector => page.locator(selector).evaluateAll(elements => elements.map(el => {
      const css = getComputedStyle(el);
      return { text: el.textContent.trim(), color: css.color, bg: css.backgroundColor,
        icons: [...el.querySelectorAll('i')].map(i => getComputedStyle(i).color) };
    }));
    // Approved default brand pairing: the bright Cargo Planner accent with white
    // labels and icons in both themes. A darker (brown) fill must not be
    // substituted for it; the resulting contrast is a known, accepted limitation.
    const BRAND = 'rgb(255, 159, 28)';
    const BRAND_HOVER = 'rgb(255, 181, 71)';
    const WHITE = 'rgb(255, 255, 255)';
    const assertActions = (samples, fill) => {
      assert.ok(samples.length > 0);
      for (const s of samples) {
        assert.equal(s.bg, fill, s.text);
        assert.equal(s.color, WHITE, s.text);
        assert.ok(s.icons.every(color => color === WHITE), s.text);
      }
    };
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.mouse.move(5, 5);
      const resting = await sample('#screen-editor .btn-primary');
      assertActions(resting, BRAND);
      assert.ok(resting.some(s => /Add/.test(s.text)));
      assert.ok(resting.some(s => /Update truck/.test(s.text)));
      assert.ok(resting.some(s => /Category/.test(s.text)));
      assert.ok(resting.some(s => s.icons.length > 0), 'icon-bearing primary actions are covered');
      await page.getByRole('button', { name: 'Category', exact: true }).hover();
      assertActions(await sample('.tp3d-browser-tab.btn-primary'), BRAND_HOVER);
      await page.getByRole('button', { name: /Update truck/ }).hover();
      assertActions(await sample('#inspector-body .btn-primary:hover'), BRAND_HOVER);
      await page.mouse.move(5, 5);
      await page.evaluate(() => window.probe.InteractionManager.setSelection(['cargo-7']));
      assertActions(await sample('#inspector-body .btn-primary'), BRAND);
      assert.match(await page.getByRole('button', { name: /Apply position/ }).textContent(), /Apply position/);
      await page.evaluate(() => window.probe.InteractionManager.setSelection([]));
      await page.locator('[data-role="editor-new-case"]').click();
      assertActions(await sample('.modal-footer .btn-primary'), BRAND);
      await page.keyboard.press('Escape');
    }
    assert.equal(await page.evaluate(() => window.probe.casesJson()), before);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('UI hotfix management Grid, List and select-all checkboxes share computed visuals', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    await page.evaluate(() => window.probe.management());
    const before = await page.evaluate(() => JSON.stringify([window.probe.StateStore.get('caseLibrary'),
      window.probe.StateStore.get('packLibrary')]));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const byState = new Map();
      for (const screen of ['cases', 'packs']) {
        await page.evaluate(screen => window.probe.AppShell.navigate(screen), screen);
        for (const mode of ['grid', 'list']) {
          await page.locator(`#${screen}-view-${mode}`).click();
          for (const state of ['unchecked', 'checked', 'disabled', 'checked-disabled', 'hover', 'focus']) {
            const inputs = page.locator(`#screen-${screen} input[type="checkbox"]:visible`);
            assert.ok(await inputs.count() >= 2,
              `${theme} ${screen} ${mode} ${state}: real row/card controls plus select-all are rendered`);
            await inputs.evaluateAll((elements, state) => elements.forEach(el => {
              el.checked = state.startsWith('checked');
              el.disabled = state.includes('disabled');
              el.blur();
            }), state);
            await page.mouse.move(5, 5);
            const samples = [];
            for (const el of await inputs.all()) {
              if (state === 'hover') await el.hover();
              if (state === 'focus') { await page.keyboard.press('Tab'); await el.focus(); }
              samples.push(await el.evaluate(el => {
                const c = getComputedStyle(el), glyph = getComputedStyle(el, '::after');
                return { width: c.width, height: c.height, border: c.border, bg: c.backgroundColor,
                  radius: c.borderRadius, opacity: c.opacity, cursor: c.cursor, outline: c.outline,
                  offset: c.outlineOffset, glyph: [glyph.content, glyph.color, glyph.fontFamily, glyph.opacity] };
              }));
            }
            const expected = byState.get(state) || samples[0];
            byState.set(state, expected);
            for (const sample of samples) assert.deepEqual(sample, expected, `${theme} ${screen} ${mode} ${state}`);
            assert.equal(expected.width, '16px');
            assert.equal(expected.height, '16px');
            if (state.startsWith('checked')) {
              assert.equal(expected.bg, 'rgb(255, 159, 28)');
              assert.match(expected.border, /rgb\(255, 159, 28\)/);
              assert.equal(expected.glyph[3], '1');
            }
          }
        }
      }
    }
    assert.equal(await page.evaluate(() => JSON.stringify([window.probe.StateStore.get('caseLibrary'),
      window.probe.StateStore.get('packLibrary')])), before, 'management view/selection styles preserve records');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Editor View commands fit truck bounds and preserve Pack camera ownership', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const cargoBefore = await page.evaluate(() => window.probe.casesJson());
    const views = [
      ['Fit Truck', 'fit'], ['Isometric', 'isometric'], ['Front', 'front'],
      ['Rear', 'rear'], ['Left', 'left'], ['Right', 'right'], ['Top', 'top'],
    ];
    assert.equal(await page.getByRole('button', { name: 'Camera Views', exact: true }).count(), 1);
    assert.equal(await page.locator('#viewport-toolbar #btn-editor-view').count(), 0,
      'Camera Views is no longer a top toolbar action');
    const stack = await page.locator('#editor-zoom-controls > button').evaluateAll(buttons =>
      buttons.map(button => ({ id: button.id, top: button.getBoundingClientRect().top, left: button.getBoundingClientRect().left })));
    assert.deepEqual(stack.map(item => item.id), ['btn-editor-measure', 'btn-editor-view', 'btn-editor-zoom-in', 'btn-editor-zoom-out'],
      'Measurement Tool, camera, Zoom In, Zoom Out from top to bottom');
    assert.ok(stack.every((item, index) => index === 0 || stack[index - 1].top < item.top) && new Set(stack.map(item => item.left)).size === 1,
      'the four buttons form one aligned vertical column');
    assert.equal(await page.locator('#btn-editor-view i').getAttribute('class'), 'fa-solid fa-video',
      'a video-camera icon, not a photograph camera');
    await page.locator('#btn-editor-view').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#btn-editor-view').getAttribute('aria-expanded'), 'true');
    const placement = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const button = rect('#btn-editor-view');
      const menu = rect('[data-role="editor-view"]');
      const overlaps = other => !(menu.right <= other.left || other.right <= menu.left ||
        menu.bottom <= other.top || other.bottom <= menu.top);
      return {
        gap: button.left - menu.right, raised: button.top - menu.top,
        inside: menu.left >= 0 && menu.top >= 0 &&
          menu.right <= innerWidth && menu.bottom <= innerHeight,
        coversZoom: overlaps(rect('#btn-editor-zoom-in')) || overlaps(rect('#btn-editor-zoom-out')),
        coversCamera: overlaps(button),
      };
    });
    assert.ok(placement.gap >= 0 && placement.gap <= 12, `the menu opens beside the camera button, to its left (${placement.gap}px)`);
    assert.ok(placement.raised >= 24, `and sits a little higher than the button (${placement.raised}px)`);
    assert.equal(placement.inside, true, 'and stays inside the browser window');
    assert.equal(placement.coversZoom || placement.coversCamera, false, 'without covering the camera or zoom buttons');
    assert.deepEqual(await page.locator('#btn-editor-view').evaluate(el => {
      const style = getComputedStyle(el);
      return [style.color, style.backgroundColor];
    }), ['rgb(255, 159, 28)', 'rgba(255, 159, 28, 0.14)'],
    'the open camera button uses the design.md brand orange, not the brown readable-accent text color');
    const presetGroup = page.locator('[data-role="editor-view"] [role="group"][aria-label="Camera view"]');
    const projectionGroup = page.locator('[data-role="editor-view"] [role="group"][aria-label="Projection"]');
    assert.deepEqual(await presetGroup.locator('[role="menuitemradio"]').allTextContents(),
      views.map(([label]) => label));
    assert.deepEqual(await projectionGroup.locator('[role="menuitemradio"]').allTextContents(),
      ['Perspective', 'Orthographic']);
    assert.equal(await projectionGroup.getByRole('menuitemradio', { checked: true }).textContent(), 'Perspective');
    assert.deepEqual(await page.locator('[data-role="editor-view"] .dropdown-menu > div')
      .evaluateAll(rows => rows.filter(row => ['Camera View', 'Projection'].includes(row.textContent.trim()))
        .map(row => [row.textContent.trim(), getComputedStyle(row).fontSize])),
    [['Camera View', '14px'], ['Projection', '14px']]);
    assert.equal(await presetGroup.getByRole('menuitemradio', { checked: true }).count(), 0,
      'the opening camera is not an explicitly selected preset');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Isometric');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-editor-view');
    assert.equal(await page.locator('#btn-editor-view').getAttribute('aria-expanded'), 'false');

    for (const [label, key] of views) {
      await page.locator('#btn-editor-view').click();
      assert.equal(await page.locator('#btn-editor-view').getAttribute('aria-expanded'), 'true',
        `${label} menu opens`);
      assert.equal(await page.getByRole('menuitemradio', { name: label, exact: true }).count(), 1,
        `${label} has an accessible menu item name`);
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      const proof = await page.evaluate(key => {
        const { SceneManager, PackLibrary, StateStore } = window.probe;
        const pack = PackLibrary.getById(StateStore.get('currentPackId'));
        const expected = SceneManager.getPresetEditorView(pack.truck, key);
        const actual = SceneManager.getEditorView();
        const saved = pack.editorView || SceneManager.getDefaultEditorView(pack.truck);
        const fields = ['cameraPosition', 'target'];
        const delta = Math.max(...fields.flatMap(field => ['x', 'y', 'z'].map(axis =>
          Math.abs(actual[field][axis] - expected[field][axis]))));
        const savedDelta = Math.max(...fields.flatMap(field => ['x', 'y', 'z'].map(axis =>
          Math.abs(saved[field][axis] - actual[field][axis]))));
        const direction = Object.fromEntries(['x', 'y', 'z'].map(axis =>
          [axis, actual.cameraPosition[axis] - actual.target[axis]]));
        return { delta, savedDelta, direction, hasSavedView: Boolean(pack.editorView),
          perspective: SceneManager.getCamera().isPerspectiveCamera };
      }, key);
      assert.ok(proof.delta < 0.002, `${label} applies the fitted view`);
      assert.ok(proof.savedDelta < 0.002, `${label} saves through the Pack`);
      if (key !== 'fit') assert.equal(proof.hasSavedView, true);
      assert.equal(proof.perspective, true);
      if (key === 'front') assert.ok(proof.direction.x > 0 && Math.abs(proof.direction.z) < 0.002);
      if (key === 'rear') assert.ok(proof.direction.x < 0 && Math.abs(proof.direction.z) < 0.002);
      if (key === 'left') assert.ok(proof.direction.z > 0 && Math.abs(proof.direction.x) < 0.002);
      if (key === 'right') assert.ok(proof.direction.z < 0 && Math.abs(proof.direction.x) < 0.002);
      if (key === 'top') assert.ok(proof.direction.y > 0 && Math.abs(proof.direction.x) < 0.002);
      await page.locator('#btn-editor-view').click();
      const selected = page.getByRole('menuitemradio', { name: label, checked: true });
      assert.equal(await selected.count(), 1, `${label} alone is checked after selection`);
      assert.equal(await presetGroup.getByRole('menuitemradio', { checked: true }).count(), 1);
      assert.equal(await selected.locator('i').getAttribute('aria-hidden'), 'true');
      assert.equal(await selected.locator('i').evaluate(icon => getComputedStyle(icon).color), 'rgb(255, 159, 28)');
      const menuSpacing = await selected.evaluate(row => {
        const menu = row.closest('[data-role="editor-view"]').getBoundingClientRect();
        const label = row.querySelector('span').getBoundingClientRect();
        const icon = row.querySelector('i').getBoundingClientRect();
        return { width: menu.width, left: label.left - menu.left, right: menu.right - icon.right,
          iconAfterLabel: icon.left > label.right };
      });
      assert.ok(menuSpacing.width <= 160, `${label} uses a compact View menu`);
      assert.ok(Math.abs(menuSpacing.left - menuSpacing.right) <= 2,
        `${label} has balanced left and right spacing: ${JSON.stringify(menuSpacing)}`);
      assert.equal(menuSpacing.iconAfterLabel, true, `${label} checkmark follows the text`);
      await page.keyboard.press('Escape');
    }
    assert.equal(await page.evaluate(() => window.probe.casesJson()), cargoBefore);
    assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false,
      'camera commands add no cargo history');

    await page.locator('#btn-editor-view').click();
    await page.getByRole('menuitemradio', { name: 'Isometric', exact: true }).click();
    const beforeOrbit = await page.evaluate(() => window.probe.SceneManager.getEditorView());
    const canvas = await page.locator('#viewport canvas').boundingBox();
    assert.ok(canvas);
    const midX = canvas.x + canvas.width / 2;
    const midY = canvas.y + canvas.height / 2;
    await page.mouse.move(midX, midY);
    await page.mouse.down();
    await page.mouse.move(midX + 70, midY + 40, { steps: 6 });
    await page.mouse.up();
    await page.evaluate(() => window.probe.EditorUI.flushPendingView());
    const freeView = await page.evaluate(() => {
      const { SceneManager, PackLibrary, StateStore, EditorUI } = window.probe;
      const pack = PackLibrary.getById(StateStore.get('currentPackId'));
      const moved = SceneManager.getEditorView();
      EditorUI.render();
      return { moved, afterRender: SceneManager.getEditorView(), saved: pack.editorView };
    });
    assert.deepEqual(freeView.afterRender, freeView.moved, 'same-Pack render retains manual orbit');
    const cameraDelta = (a, b) => Math.max(...['cameraPosition', 'target'].flatMap(field =>
      ['x', 'y', 'z'].map(axis => Math.abs(a[field][axis] - b[field][axis]))));
    assert.ok(cameraDelta(freeView.moved, beforeOrbit) > 0.05,
      `free orbit moves away from the preset: ${JSON.stringify(freeView)}`);
    assert.ok(cameraDelta(freeView.saved, freeView.moved) < 0.02,
      `manual orbit settles into Pack metadata: ${JSON.stringify(freeView)}`);
    await page.locator('#btn-editor-view').click();
    assert.equal(await presetGroup.getByRole('menuitemradio', { checked: true }).count(), 0,
      'manual orbit clears the selected preset');
    await page.getByRole('menuitemradio', { name: 'Fit Truck' }).click();
    const reframed = await page.evaluate(() => {
      const { SceneManager, PackLibrary, StateStore } = window.probe;
      const pack = PackLibrary.getById(StateStore.get('currentPackId'));
      return { view: SceneManager.getEditorView(), saved: pack.editorView,
        opening: SceneManager.getDefaultEditorView(pack.truck),
        truck: pack.truck };
    });
    const direction = view => {
      const vector = ['x', 'y', 'z'].map(axis => view.cameraPosition[axis] - view.target[axis]);
      const length = Math.hypot(...vector);
      return vector.map(component => component / length);
    };
    assert.ok(Math.hypot(...direction(freeView.moved).map((component, index) =>
      component - direction(reframed.view)[index])) < 0.002,
    'Fit Truck preserves the manually chosen direction');
    assert.ok(cameraDelta(reframed.view, reframed.opening) > 0.05,
      'Fit Truck does not restore the opening camera angle');
    assert.ok(cameraDelta(reframed.view, reframed.saved) < 0.002);
    assert.equal(reframed.view.target.x, reframed.truck.length * 0.05 / 2);
    await page.locator('#btn-editor-view').click();
    assert.equal(await page.getByRole('menuitemradio', { name: 'Fit Truck', checked: true }).count(), 1);
    await page.keyboard.press('Escape');
    await page.mouse.move(midX, midY);
    await page.mouse.wheel(0, -280);
    await page.locator('#btn-editor-view').click();
    assert.equal(await presetGroup.getByRole('menuitemradio', { checked: true }).count(), 0,
      'manual zoom clears the selected preset');
    await page.getByRole('menuitemradio', { name: 'Fit Truck' }).click();

    await page.evaluate(() => {
      const { SceneManager } = window.probe;
      SceneManager.focusOnWorldPoint(SceneManager.getControls().target.clone().addScalar(4), { duration: 600 });
    });
    await page.locator('#btn-editor-view').click();
    assert.equal(await presetGroup.getByRole('menuitemradio', { checked: true }).count(), 0,
      'focusing a Case clears the selected preset');
    await page.getByRole('menuitemradio', { name: 'Front', exact: true }).click();
    await page.waitForTimeout(650);
    const afterFocus = await page.evaluate(() => {
      const { SceneManager, PackLibrary, StateStore } = window.probe;
      const pack = PackLibrary.getById(StateStore.get('currentPackId'));
      return { actual: SceneManager.getEditorView(), expected: SceneManager.getPresetEditorView(pack.truck, 'front'),
        saved: pack.editorView };
    });
    assert.ok(cameraDelta(afterFocus.actual, afterFocus.expected) < 0.002,
      'a pending focus animation cannot overwrite a View command');
    assert.ok(cameraDelta(afterFocus.saved, afterFocus.expected) < 0.002);

    // Project every physical envelope corner through the real runtime camera.
    // The front bonus extends +X; wheel wells stay inside the standard envelope.
    for (const width of [1400, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const fit = await page.evaluate(keys => {
        const { SceneManager } = window.probe;
        SceneManager.resize();
        const trucks = [
          { length: 120, width: 72, height: 70, shapeMode: 'rect' },
          { length: 636, width: 102, height: 110, shapeMode: 'wheelWells',
            shapeConfig: { wellWidth: 10, wellHeight: 20 } },
          { length: 2400, width: 120, height: 120, shapeMode: 'frontBonus',
            shapeConfig: { bonusLength: 180, bonusHeight: 50 } },
        ];
        let maxProjected = 0;
        let maxDistance = 0;
        for (const truck of trucks) {
          const length = truck.length + (truck.shapeMode === 'frontBonus' ? truck.shapeConfig.bonusLength : 0);
          for (const key of keys) {
            SceneManager.applyEditorView(SceneManager.getPresetEditorView(truck, key));
            const camera = SceneManager.getCamera();
            camera.updateMatrixWorld();
            maxDistance = Math.max(maxDistance, camera.position.distanceTo(SceneManager.getControls().target));
            for (const x of [0, length]) for (const y of [0, truck.height]) {
              for (const z of [-truck.width / 2, truck.width / 2]) {
                const p = new window.THREE.Vector3(
                  SceneManager.toWorld(x), SceneManager.toWorld(y), SceneManager.toWorld(z)).project(camera);
                maxProjected = Math.max(maxProjected, Math.abs(p.x), Math.abs(p.y));
              }
            }
          }
        }
        return { maxProjected, maxDistance };
      }, views.map(([, key]) => key));
      assert.ok(fit.maxProjected < 1, `${width}px viewport fits every truck and view (${fit.maxProjected})`);
      if (width === 320) assert.ok(fit.maxDistance > 220, 'large narrow fit exceeds the legacy orbit cap');
    }
    const ownership = await page.evaluate(() => {
      const { SceneManager, PackLibrary, StateStore, EditorUI } = window.probe;
      const first = PackLibrary.getById('fixture-pack');
      const saved = JSON.stringify(first.editorView);
      const second = { ...first, id: 'camera-second', truck: { length: 240, width: 90, height: 80, shapeMode: 'rect' },
        cases: [], editorView: null };
      StateStore.set({ packLibrary: [first, second], currentPackId: second.id }, { skipHistory: true });
      EditorUI.render();
      const secondView = SceneManager.getEditorView();
      const secondDefault = SceneManager.getDefaultEditorView(second.truck);
      StateStore.set({ currentPackId: first.id }, { skipHistory: true });
      EditorUI.render();
      return { secondView, secondDefault, firstUnchanged: JSON.stringify(PackLibrary.getById(first.id).editorView) === saved,
        firstOpening: SceneManager.getEditorView(), firstDefault: SceneManager.getDefaultEditorView(first.truck) };
    });
    assert.deepEqual(ownership.secondView, ownership.secondDefault, 'switching Packs fits the new truck');
    assert.deepEqual(ownership.firstOpening, ownership.firstDefault, 'reopening preserves the current truck-centered policy');
    assert.equal(ownership.firstUnchanged, true, 'switching Packs does not overwrite prior camera metadata');
    await page.locator('#btn-editor-view').click();
    assert.equal(await presetGroup.getByRole('menuitemradio', { checked: true }).count(), 0,
      'opening another Pack clears the prior Pack selection');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Editor projection switches keep camera scale, controls, presets and Pack ownership', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const cargoBefore = await page.evaluate(() => window.probe.casesJson());
    const before = await page.evaluate(() => {
      const { SceneManager } = window.probe;
      const camera = SceneManager.getCamera();
      return { view: SceneManager.getEditorView(), visibleHeight: 2 * camera.position.distanceTo(SceneManager.getControls().target) *
        Math.tan(camera.fov * Math.PI / 360) };
    });
    await page.locator('#btn-editor-view').click();
    await page.getByRole('menuitemradio', { name: 'Orthographic' }).click();
    const ortho = await page.evaluate(() => {
      const { SceneManager, PackLibrary, StateStore } = window.probe;
      const camera = SceneManager.getCamera();
      return { view: SceneManager.getEditorView(), saved: PackLibrary.getById(StateStore.get('currentPackId')).editorView,
        isOrtho: camera.isOrthographicCamera, controlsCamera: SceneManager.getControls().object === camera,
        visibleHeight: (camera.top - camera.bottom) / camera.zoom };
    });
    assert.equal(ortho.isOrtho, true);
    assert.equal(ortho.controlsCamera, true);
    assert.deepEqual(ortho.view, ortho.saved);
    assert.ok(Math.abs(ortho.visibleHeight / before.visibleHeight - 1) < 0.02);
    assert.deepEqual(ortho.view.target, before.view.target);
    await page.locator('#btn-editor-view').click();
    assert.equal(await page.getByRole('group', { name: 'Projection' })
      .getByRole('menuitemradio', { name: 'Orthographic', checked: true }).count(), 1);
    assert.equal(await page.getByRole('group', { name: 'Camera view' })
      .getByRole('menuitemradio', { checked: true }).count(), 0);
    await page.keyboard.press('Escape');

    const canvas = await page.locator('#viewport canvas').boundingBox();
    assert.ok(canvas);
    const x = canvas.x + canvas.width / 2;
    const y = canvas.y + canvas.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(250);
    await page.evaluate(() => window.probe.EditorUI.flushPendingView());
    const zoomed = await page.evaluate(() => {
      const { SceneManager, PackLibrary, StateStore } = window.probe;
      return { zoom: SceneManager.getCamera().zoom,
        saved: PackLibrary.getById(StateStore.get('currentPackId')).editorView.zoom };
    });
    assert.ok(zoomed.zoom > ortho.view.zoom);
    assert.equal(zoomed.saved, Math.round(zoomed.zoom * 1000) / 1000);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + 35, y + 20, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    assert.notDeepEqual(await page.evaluate(() => window.probe.SceneManager.getEditorView().target), ortho.view.target);

    for (const label of ['Fit Truck', 'Isometric', 'Front', 'Rear', 'Left', 'Right', 'Top']) {
      await page.locator('#btn-editor-view').click();
      await page.getByRole('group', { name: 'Camera view' }).getByRole('menuitemradio', { name: label, exact: true }).click();
      assert.equal(await page.evaluate(() => window.probe.SceneManager.getCamera().isOrthographicCamera), true);
    }
    await page.locator('#btn-editor-view').click();
    await page.getByRole('group', { name: 'Camera view' }).getByRole('menuitemradio', { name: 'Isometric' }).click();
    await page.evaluate(() => {
      const { SceneManager, CaseScene, PackLibrary, StateStore } = window.probe;
      const first = PackLibrary.getById(StateStore.get('currentPackId')).cases[0];
      const target = CaseScene.getObject(first.id).position;
      SceneManager.applyEditorView({ projection: 'orthographic', zoom: 1,
        target: { x: target.x, y: target.y, z: target.z },
        cameraPosition: { x: target.x + 20, y: target.y + 20, z: target.z + 20 } });
    });
    const cargo = await page.evaluate(() => window.probe.cargoPoint());
    assert.ok(cargo, 'Orthographic raycasting finds a visible Case');
    await page.mouse.click(cargo.x, cargo.y);
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), [cargo.id]);
    const beforeDrag = await page.evaluate(() => ({
      cases: window.probe.casesJson(), poses: window.probe.poses(),
    }));
    await page.mouse.move(cargo.x, cargo.y);
    await page.mouse.down();
    await page.mouse.move(cargo.x + 35, cargo.y + 20, { steps: 5 });
    const duringDrag = await page.evaluate(() => ({
      cases: window.probe.casesJson(), poses: window.probe.poses(),
    }));
    assert.notEqual(duringDrag.poses, beforeDrag.poses, 'Orthographic drag moves a provisional Case pose');
    assert.equal(duringDrag.cases, beforeDrag.cases, 'drag does not commit before release');
    await page.evaluate(() => window.probe.SceneManager.getRenderer().domElement.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await page.mouse.up();
    await page.waitForFunction(start => window.probe.SceneManager.getControls().enabled &&
      window.probe.poses() === start, beforeDrag.poses, { timeout: 10000 });
    await page.locator('#btn-editor-view').click();
    await page.getByRole('menuitemradio', { name: 'Perspective' }).click();
    assert.equal(await page.evaluate(() => window.probe.SceneManager.getControls().object ===
      window.probe.SceneManager.getCamera() && window.probe.SceneManager.getCamera().isPerspectiveCamera), true);
    const precedence = await page.evaluate(() => {
      const { StateStore, PackLibrary, EditorUI, SceneManager } = window.probe;
      const first = PackLibrary.getById('fixture-pack');
      const saved = JSON.stringify(first.editorView);
      const fresh = { ...first, id: 'projection-fresh', cases: [], editorView: null };
      const legacy = { ...first, id: 'projection-legacy', cases: [], editorView: {
        cameraPosition: { x: 999, y: 888, z: 777 }, target: { x: 1, y: 2, z: 3 } } };
      StateStore.set({ preferences: { ...StateStore.get('preferences'), camera: { defaultView: 'orthographic' } } },
        { skipHistory: true });
      EditorUI.render();
      const explicitUnaffected = SceneManager.getCamera().isPerspectiveCamera;
      StateStore.set({ packLibrary: [first, fresh, legacy], currentPackId: fresh.id }, { skipHistory: true });
      EditorUI.render();
      const freshDefault = SceneManager.getCamera().isOrthographicCamera;
      StateStore.set({ preferences: { ...StateStore.get('preferences'), camera: { defaultView: 'perspective' } } },
        { skipHistory: true });
      EditorUI.render();
      const unchangedWithoutApply = SceneManager.getCamera().isOrthographicCamera &&
        PackLibrary.getById(fresh.id).editorView === null;
      const staleApplyRejected = EditorUI.applyCameraProjection('perspective', first.id) === false;
      const appliedCurrent = EditorUI.applyCameraProjection('perspective', fresh.id);
      const currentDefault = SceneManager.getCamera().isPerspectiveCamera;
      const freshExplicit = PackLibrary.getById(fresh.id).editorView?.projection === 'perspective';
      StateStore.set({ currentPackId: legacy.id }, { skipHistory: true });
      EditorUI.render();
      const legacyPerspective = SceneManager.getCamera().isPerspectiveCamera;
      const legacyOpening = SceneManager.getEditorView();
      const legacyExpected = SceneManager.getDefaultEditorView(legacy.truck);
      const legacyApplied = EditorUI.applyCameraProjection('perspective', legacy.id);
      const legacyExplicit = PackLibrary.getById(legacy.id).editorView?.projection === 'perspective';
      StateStore.set({ currentPackId: first.id }, { skipHistory: true });
      EditorUI.render();
      const savedChoice = PackLibrary.getById(first.id).editorView?.projection === 'perspective';
      return { explicitUnaffected, freshDefault, legacyPerspective,
        unchangedWithoutApply, staleApplyRejected, appliedCurrent, currentDefault, freshExplicit,
        legacyApplied, legacyExplicit, savedChoice,
        legacyOpening, legacyExpected, firstUnchanged: JSON.stringify(PackLibrary.getById(first.id).editorView) === saved };
    });
    assert.equal(precedence.explicitUnaffected, true);
    assert.equal(precedence.freshDefault, true);
    assert.equal(precedence.unchangedWithoutApply, true);
    assert.equal(precedence.staleApplyRejected, true);
    assert.equal(precedence.appliedCurrent, true);
    assert.equal(precedence.currentDefault, true);
    assert.equal(precedence.freshExplicit, true);
    assert.equal(precedence.legacyApplied, true);
    assert.equal(precedence.legacyExplicit, true);
    assert.equal(precedence.savedChoice, true);
    assert.equal(precedence.legacyPerspective, true);
    assert.deepEqual(precedence.legacyOpening, precedence.legacyExpected);
    assert.equal(precedence.firstUnchanged, true);

    for (const width of [1200, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const framing = await page.evaluate(() => {
        const { SceneManager, EditorUI } = window.probe;
        SceneManager.resize();
        const trucks = [
          { length: 120, width: 72, height: 70, shapeMode: 'rect' },
          { length: 636, width: 102, height: 110, shapeMode: 'wheelWells',
            shapeConfig: { wellWidth: 10, wellHeight: 20 } },
          { length: 2400, width: 120, height: 120, shapeMode: 'frontBonus',
            shapeConfig: { bonusLength: 180, bonusHeight: 50 } },
        ];
        let maxProjected = 0;
        for (const truck of trucks) {
          const length = truck.length + (truck.shapeMode === 'frontBonus' ? truck.shapeConfig.bonusLength : 0);
          for (const preset of ['fit', 'isometric', 'front', 'rear', 'left', 'right', 'top']) {
            SceneManager.applyEditorView(SceneManager.getPresetEditorView(truck, preset, 'orthographic'));
            const camera = SceneManager.getCamera();
            camera.updateMatrixWorld();
            for (const x of [0, length]) for (const y of [0, truck.height]) {
              for (const z of [-truck.width / 2, truck.width / 2]) {
                const projected = new window.THREE.Vector3(
                  SceneManager.toWorld(x), SceneManager.toWorld(y), SceneManager.toWorld(z)).project(camera);
                maxProjected = Math.max(maxProjected, Math.abs(projected.x), Math.abs(projected.y));
              }
            }
          }
        }
        EditorUI.render();
        return maxProjected;
      });
      assert.ok(framing < 1, `${width}px Orthographic view fits custom truck bounds (${framing})`);
    }
    assert.equal(await page.evaluate(() => window.probe.casesJson()), cargoBefore);
    assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Editor accessibility fixture keeps focusable regions, selection, Share and narrow toolbar usable', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const desktopToolbarRows = await page.locator('#viewport-toolbar').evaluate(toolbar =>
      new Set([...toolbar.querySelectorAll('button:not(.tp3d-toolbar-hidden-action)')]
        .map(button => Math.round(button.getBoundingClientRect().top))).size);
    assert.equal(desktopToolbarRows, 1, 'desktop viewport toolbar keeps all five actions on one row');
    assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    assert.equal(await page.locator('#btn-sidebar').getAttribute('aria-expanded'), 'false');
    await page.locator('#btn-sidebar').click();
    assert.equal(await page.locator('#btn-sidebar').getAttribute('aria-expanded'), 'true');
    await page.locator('#btn-sidebar').click();

    const names = await page.locator('#editor-right [role="combobox"], #editor-right input[type="number"]').evaluateAll(elements =>
      elements.slice(0, 7).map(el => ({
        name: el.getAttribute('aria-label') || el.labels?.[0]?.textContent?.trim() || '', id: el.id,
      })));
    assert.ok(names.every(item => item.name && item.id), 'Inspector controls have accessible names');

    // After closing the drawer, require the same raycastable cargo point across
    // three frames so an in-flight layout/scene update cannot stale the click.
    const cargo = await (await page.waitForFunction(() => {
      const point = window.probe.settledCargoPoint();
      const previous = window.probe.accessibilityPoint;
      const stable = point && previous && point.id === previous.id &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5;
      window.probe.accessibilityPoint = point ? { ...point, frames: stable ? previous.frames + 1 : 1 } : null;
      return window.probe.accessibilityPoint?.frames >= 3 ? point : null;
    })).jsonValue();
    await page.mouse.click(cargo.x, cargo.y);
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), [cargo.id]);
    assert.equal(await page.getByLabel('Select placed case').count(), 0);
    const before = await page.evaluate(() => window.probe.casesJson());
    await page.locator('#btn-share').focus();
    await page.keyboard.press('r');
    assert.equal(await page.evaluate(() => window.probe.casesJson()), before,
      'single-character transform key from Share does not mutate cargo');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#btn-share').getAttribute('aria-expanded'), 'true');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Screenshot/);
    await page.keyboard.press('ArrowDown');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Export PDF/);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-share');

    await page.setViewportSize({ width: 900, height: 768 });
    assert.equal(await page.locator('#editor-left').evaluate(el => getComputedStyle(el).visibility), 'visible');
    await page.setViewportSize({ width: 899, height: 768 });
    assert.equal(await page.locator('#editor-left').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.setViewportSize({ width: 768, height: 600 });
    assert.equal(await page.locator('#editor-right').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    for (const width of [496, 495, 480, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 568 });
      const visible = await page.locator('#viewport-toolbar').evaluate(toolbar => {
        const canvas = toolbar.closest('.canvas-wrap').getBoundingClientRect();
        return [...toolbar.querySelectorAll('button:not(.tp3d-toolbar-hidden-action)')].map(button => {
          const rect = button.getBoundingClientRect();
          return rect.left >= canvas.left && rect.right <= canvas.right && rect.top >= canvas.top && rect.bottom <= canvas.bottom;
        });
      });
      assert.deepEqual(visible, [true, true, true, true, true], `toolbar fits at ${width}px`);
      const controls = await page.locator('#editor-zoom-controls').evaluate(group => {
        const canvas = group.closest('.canvas-wrap').getBoundingClientRect();
        const toolbar = document.getElementById('viewport-toolbar').getBoundingClientRect();
        const rect = group.getBoundingClientRect();
        return {
          inside: rect.left >= canvas.left && rect.right <= canvas.right && rect.top >= canvas.top && rect.bottom <= canvas.bottom,
          clearOfToolbar: rect.top >= toolbar.bottom || rect.bottom <= toolbar.top ||
            rect.left >= toolbar.right || rect.right <= toolbar.left,
        };
      });
      assert.deepEqual(controls, { inside: true, clearOfToolbar: true }, `camera and zoom controls fit clear of the toolbar at ${width}px`);
    }
    assert.equal(await page.locator('#editor-left').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    assert.equal(await page.locator('#editor-right').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.locator('#btn-editor-left').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-left-close');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'true');
    await page.locator('#editor-case-filters-toggle').click();
    const filter = page.locator('#editor-case-chips button').nth(1);
    await filter.focus();
    const filterKey = await filter.getAttribute('data-filter-key');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#editor-case-chips button').nth(1).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#editor-case-filters-toggle').getAttribute('aria-expanded'), 'true',
      'the filter popup stays open after a keyboard selection');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.filterKey), filterKey,
      'focus stays on the rebuilt chip for the same filter');
    // One owner per Escape: the filter popup first, then the selection, then the drawer.
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editor-case-filters-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor-case-filters-toggle');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), [cargo.id], 'the popup Escape keeps the selection');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'the next Escape clears the selection');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'true', 'and does not also close the drawer');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-editor-left');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Editor Case Browser filters: one-popup multi-select, visible active state, clear/recovery, workspace reset, no data writes', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    // Fixture-only setup (no history): Manufacturer spelling variants, a blank
    // Manufacturer and one very long Category name.
    await page.evaluate(() => {
      const { StateStore } = window.probe;
      const manufacturers = { 'Line Array Case': 'Acme', 'Subwoofer Crate': ' ACME ', 'Guitar Rack': '' };
      const longName = 'Extremely Long Category Name For Narrow Filter Popup Checks';
      StateStore.set({
        caseLibrary: StateStore.get('caseLibrary').map(c => ({ ...c, manufacturer: manufacturers[c.name] })),
        preferences: {
          ...StateStore.get('preferences'),
          categories: [
            { key: 'audio', name: 'Audio', color: '#f59e0b' }, { key: 'lighting', name: 'Lighting', color: '#3b82f6' },
            { key: 'stage', name: 'Stage', color: '#10b981' }, { key: 'backline', name: 'Backline', color: '#ec4899' },
            { key: 'default', name: 'Default', color: '#9ca3af' }, { key: 'longcat', name: longName, color: '#6366f1' },
          ],
        },
      }, { skipHistory: true });
      StateStore.resetHistory();
      window.__filterWrites = [];
      StateStore.subscribe(changes => window.__filterWrites.push(Object.keys(changes).sort().join(',')));
    });
    const baseline = await page.evaluate(() => JSON.stringify({
      caseLibrary: window.probe.StateStore.get('caseLibrary'), preferences: window.probe.StateStore.get('preferences'),
      cargo: window.probe.casesJson(), lastEdited: window.probe.StateStore.get('packLibrary')[0].lastEdited,
      keys: Object.keys(window.probe.StateStore.get()).sort(),
    }));

    const toggle = page.locator('#editor-case-filters-toggle');
    const chip = key => page.locator(`#editor-case-chips [data-filter-key="${key}"]`);
    const search = page.locator('#editor-case-search');
    const visibleCases = () => page.locator('#editor-case-list .tp3d-editor-case-browser-card .tp3d-editor-fw-semibold')
      .allTextContents();
    const state = () => page.evaluate(() => {
      const shown = el => (el && !el.hidden ? el.textContent : '');
      const toggleEl = document.getElementById('editor-case-filters-toggle');
      return {
        expanded: toggleEl.getAttribute('aria-expanded'),
        open: toggleEl.classList.contains('btn-primary'),
        label: toggleEl.getAttribute('aria-label'),
        badge: shown(toggleEl.querySelector('.tp3d-filter-active-count')),
        tabs: [...document.querySelectorAll('.tp3d-browser-tab')].map(btn => [
          btn.dataset.groupBy, btn.getAttribute('aria-pressed'), shown(btn.querySelector('.tp3d-browser-tab-count')),
          btn.getAttribute('aria-label'),
        ]),
        pressed: [...document.querySelectorAll('#editor-case-chips button[aria-pressed="true"]')]
          .map(b => b.dataset.filterKey).sort(),
        focusKey: document.activeElement?.dataset?.filterKey ?? null,
        activeId: document.activeElement?.id || '',
        chipsScrollTop: document.getElementById('editor-case-chips').scrollTop,
      };
    });
    // Mouse-click a chip where it currently sits inside the (scrolled) popup, so
    // the click itself never scrolls the popup.
    const clickChipInPlace = async key => {
      const point = await page.evaluate(k => {
        const popup = document.getElementById('editor-case-chips').getBoundingClientRect();
        const rect = document.querySelector(`#editor-case-chips [data-filter-key="${k}"]`).getBoundingClientRect();
        return rect.top >= popup.top && rect.bottom <= popup.bottom
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      }, key);
      assert.ok(point, `${key} chip is visible inside the popup`);
      await page.mouse.click(point.x, point.y);
    };
    const waitForCases = expected => page.waitForFunction(names => JSON.stringify(
      [...document.querySelectorAll('#editor-case-list .tp3d-editor-case-browser-card .tp3d-editor-fw-semibold')]
        .map(el => el.textContent).sort()) === JSON.stringify(names), expected.slice().sort());
    const emptyState = () => page.evaluate(() => {
      const el = document.querySelector('#editor-case-list .tp3d-editor-case-empty');
      return el && { message: el.querySelector('p').textContent, actions: [...el.querySelectorAll('button')].map(b => b.textContent) };
    });

    // MULTI-SELECT: three Category values in one popup session (mouse + Space).
    await toggle.click();
    await page.evaluate(() => {
      const popup = document.getElementById('editor-case-chips');
      popup.style.maxHeight = '120px';
      popup.scrollTop = 20;
    });
    await clickChipInPlace('audio');
    let s = await state();
    assert.equal(s.expanded, 'true', 'a chip click inside the rebuilt popup is not an outside click');
    assert.equal(s.focusKey, 'audio', 'focus returns to the rebuilt chip for the same filter');
    assert.equal(s.chipsScrollTop, 20, 'popup scroll position is kept across the rebuild');
    await clickChipInPlace('lighting');
    await chip('stage').focus();
    await page.keyboard.press('Space');
    s = await state();
    assert.equal(s.expanded, 'true', 'keyboard activation also keeps the popup open');
    assert.equal(s.focusKey, 'stage');
    assert.deepEqual(s.pressed, ['audio', 'lighting', 'stage']);
    assert.deepEqual((await visibleCases()).sort(), ['Line Array Case', 'Subwoofer Crate'], 'Category values OR together');
    assert.equal(s.badge, '3');
    assert.equal(s.label, 'Toggle filters, 3 active');
    assert.deepEqual(s.tabs, [['category', 'true', '3', 'Category, 3 selected'], ['manufacturer', 'false', '', null]]);

    // ESCAPE closes only the popup, restores focus to the toggle, keeps the count.
    await page.keyboard.press('Escape');
    s = await state();
    assert.equal(s.expanded, 'false');
    assert.equal(s.activeId, 'editor-case-filters-toggle');
    assert.equal(s.open, false, 'yellow still means popup open only');
    assert.equal(s.badge, '3', 'a closed popup still shows the current-mode active count');

    // OUTSIDE CLICK and TOGGLE close the popup.
    await toggle.click();
    await page.locator('#editor-left-title').click();
    assert.equal((await state()).expanded, 'false', 'a real outside click closes the popup');
    await toggle.click();
    await toggle.click();
    assert.equal((await state()).expanded, 'false', 'the toggle closes the popup');

    // LONG LABEL keeps its count visible and exposes the full label.
    await toggle.click();
    const longChip = await chip('longcat').evaluate(el => {
      const label = el.querySelector('.tp3d-browser-chip-label');
      const count = el.querySelector('.tp3d-browser-chip-count');
      const chipRect = el.getBoundingClientRect();
      const countRect = count.getBoundingClientRect();
      return {
        truncated: label.scrollWidth > label.clientWidth,
        countVisible: countRect.width > 0 && countRect.right <= chipRect.right + 0.5 && count.scrollWidth <= count.clientWidth + 0.5,
        count: count.textContent, title: el.title, aria: el.getAttribute('aria-label'),
      };
    });
    assert.deepEqual(longChip, {
      truncated: true, countVisible: true, count: ': 0',
      title: 'Extremely Long Category Name For Narrow Filter Popup Checks: 0',
      aria: 'Extremely Long Category Name For Narrow Filter Popup Checks: 0',
    });
    await page.keyboard.press('Escape');

    // MODE SWITCH: Category selections are retained and visible but inactive.
    await page.locator('.tp3d-browser-tab[data-group-by="manufacturer"]').click();
    s = await state();
    assert.equal(s.badge, '', 'the badge follows the active mode');
    assert.equal(s.label, 'Toggle filters');
    assert.deepEqual(s.tabs, [['category', 'false', '3', 'Category, 3 selected'], ['manufacturer', 'true', '', null]]);
    assert.equal((await visibleCases()).length, 3, 'inactive Category selections do not filter Manufacturer mode');
    const manufacturerView = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('#editor-case-chips button')].map(b => [b.dataset.filterKey, b.textContent]),
      list: [...document.querySelectorAll('#editor-case-list > *')].map(el => (el.classList.contains('tp3d-editor-mfg-group-header')
        ? `# ${el.textContent}` : el.querySelector('.tp3d-editor-fw-semibold').textContent)),
    }));
    assert.deepEqual(manufacturerView.chips,
      [['all', 'All: 3'], ['acme', 'Acme: 2'], ['__no_manufacturer__', '(No manufacturer): 1']],
      'Acme / " ACME " share one normalized option; no-manufacturer stays last');
    assert.deepEqual(manufacturerView.list,
      ['# Acme', 'Line Array Case', 'Subwoofer Crate', '# (No manufacturer)', 'Guitar Rack'],
      'the list groups by the same normalized key and label as the options');
    await toggle.click();
    await chip('__no_manufacturer__').click();
    s = await state();
    assert.equal(s.expanded, 'true');
    assert.equal(s.badge, '1');
    assert.deepEqual(s.tabs.map(tab => tab[2]), ['3', '1']);
    assert.deepEqual(await visibleCases(), ['Guitar Rack']);

    // Back to Category: its selections reapply; Manufacturer's stay retained.
    await page.locator('.tp3d-browser-tab[data-group-by="category"]').click();
    s = await state();
    assert.equal(s.badge, '3');
    assert.deepEqual(s.tabs.map(tab => tab[2]), ['3', '1']);
    assert.deepEqual(await page.evaluate(() => {
      const panel = document.getElementById('editor-left').getBoundingClientRect();
      const plus = document.querySelector('.tp3d-editor-new-case-btn').getBoundingClientRect();
      return {
        countsInsideTabs: [...document.querySelectorAll('.tp3d-browser-tab')].map(btn => {
          const count = btn.querySelector('.tp3d-browser-tab-count').getBoundingClientRect();
          return count.width > 0 && count.right <= btn.getBoundingClientRect().right + 0.5;
        }),
        newCaseInsidePanel: plus.right <= panel.right,
      };
    }), { countsInsideTabs: [true, true], newCaseInsidePanel: true }, 'retained counts never push the tab row out of the panel');
    assert.deepEqual((await visibleCases()).sort(), ['Line Array Case', 'Subwoofer Crate']);

    // "All" clears only the current mode.
    await toggle.click();
    await chip('all').click();
    s = await state();
    assert.equal(s.expanded, 'true');
    assert.deepEqual(s.pressed, ['all']);
    assert.deepEqual(s.tabs.map(tab => tab[2]), ['', '1']);
    assert.equal((await visibleCases()).length, 3);
    await chip('audio').click();
    await page.keyboard.press('Escape');

    // ZERO RESULTS: truthful message and recovery; Clear filters clears BOTH modes.
    await search.fill('guitar');
    await page.waitForFunction(() => document.querySelector('#editor-case-list .tp3d-editor-case-empty'));
    assert.deepEqual(await emptyState(), { message: 'No cases match.', actions: ['Clear search', 'Clear filters'] });
    await page.getByRole('button', { name: 'Clear search' }).click();
    assert.equal(await search.inputValue(), '');
    assert.equal((await state()).activeId, 'editor-case-search');
    assert.deepEqual((await visibleCases()).sort(), ['Line Array Case', 'Subwoofer Crate'], 'Clear search keeps the filters');
    await search.fill('guitar');
    await page.waitForFunction(() => document.querySelector('#editor-case-list .tp3d-editor-case-empty'));
    await page.getByRole('button', { name: 'Clear filters' }).click();
    s = await state();
    assert.deepEqual(s.tabs.map(tab => tab[2]), ['', ''], 'Clear filters clears Category AND Manufacturer');
    assert.equal(s.badge, '');
    assert.equal(s.activeId, 'editor-case-filters-toggle');
    assert.equal(await search.inputValue(), 'guitar', 'Clear filters keeps the search');
    assert.deepEqual(await visibleCases(), ['Guitar Rack']);
    await search.fill('zz-no-such-case');
    await page.waitForFunction(() => document.querySelector('#editor-case-list .tp3d-editor-case-empty'));
    assert.deepEqual(await emptyState(), { message: 'No cases match.', actions: ['Clear search'] });
    await page.getByRole('button', { name: 'Clear search' }).click();
    assert.equal((await visibleCases()).length, 3);

    // DATA SAFETY: filtering wrote nothing to StateStore (no history, no data).
    assert.deepEqual(await page.evaluate(() => window.__filterWrites), [], 'filter/search interaction never writes StateStore');
    assert.equal(await page.evaluate(() => JSON.stringify({
      caseLibrary: window.probe.StateStore.get('caseLibrary'), preferences: window.probe.StateStore.get('preferences'),
      cargo: window.probe.casesJson(), lastEdited: window.probe.StateStore.get('packLibrary')[0].lastEdited,
      keys: Object.keys(window.probe.StateStore.get()).sort(),
    })), baseline);
    assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'no history entry was created');

    // PACK CHANGE in the same workspace keeps the filter state.
    await toggle.click();
    await chip('audio').click();
    await page.keyboard.press('Escape');
    await search.fill('line');
    await waitForCases(['Line Array Case']);
    await page.evaluate(() => {
      const { StateStore } = window.probe;
      const packId = StateStore.get('currentPackId');
      StateStore.set({ currentPackId: null });
      StateStore.set({ currentPackId: packId });
    });
    assert.equal((await state()).badge, '1');
    assert.equal(await search.inputValue(), 'line');
    assert.deepEqual(await visibleCases(), ['Line Array Case']);

    // WORKSPACE RESET clears both modes, search, mode and popup.
    await page.locator('.tp3d-browser-tab[data-group-by="manufacturer"]').click();
    await toggle.click();
    await chip('acme').click();
    await page.evaluate(() => window.probe.EditorUI.resetWorkspaceState());
    s = await state();
    assert.equal(s.expanded, 'false');
    assert.equal(s.badge, '');
    assert.deepEqual(s.tabs, [['category', 'true', '', null], ['manufacturer', 'false', '', null]]);
    assert.equal(await search.inputValue(), '');
    await page.evaluate(() => window.probe.EditorUI.render());
    assert.equal((await visibleCases()).length, 3);

    // RENDER PURITY: an empty Case Library renders "No cases yet." without
    // writing Preferences or history (the reset belongs to Case deletion).
    const purity = await page.evaluate(() => {
      const { StateStore, EditorUI } = window.probe;
      const prefsBefore = JSON.stringify(StateStore.get('preferences'));
      const writes = [];
      const off = StateStore.subscribe(changes => writes.push(Object.keys(changes).sort().join(',')));
      StateStore.set({ currentPackId: null, caseLibrary: [] }, { skipHistory: true });
      StateStore.resetHistory();
      EditorUI.render();
      off();
      const empty = document.querySelector('#editor-case-list .tp3d-editor-case-empty');
      return {
        writes, prefsSame: JSON.stringify(StateStore.get('preferences')) === prefsBefore, undo: StateStore.undo(),
        message: empty && empty.textContent, actions: empty ? empty.querySelectorAll('button').length : -1,
      };
    });
    assert.deepEqual(purity, { writes: ['caseLibrary,currentPackId'], prefsSame: true, undo: false, message: 'No cases yet.', actions: 0 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Editor Case Browser filter popup fits the Case Browser: a long list scrolls to a reachable, unclipped last option', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    // Fixture-only (no history): enough categories that the popup must scroll.
    await page.evaluate(() => {
      const { StateStore } = window.probe;
      const categories = Array.from({ length: 40 }, (_, i) => ({
        key: `qa-${i}`, name: `QA Category ${String(i).padStart(2, '0')}`, color: '#6366f1',
      }));
      StateStore.set({
        preferences: { ...StateStore.get('preferences'), categories: [{ key: 'default', name: 'Default', color: '#9ca3af' }, ...categories] },
      }, { skipHistory: true });
    });
    const toggle = page.locator('#editor-case-filters-toggle');
    // A chip counts as visible only if it sits inside the popup's scroll box AND
    // inside the clipping Case Browser body, and is the element actually hit there.
    const measure = () => page.evaluate(() => {
      const popup = document.getElementById('editor-case-chips');
      const rect = popup.getBoundingClientRect();
      const body = popup.closest('.panel-body').getBoundingClientRect();
      const panel = document.getElementById('editor-left').getBoundingClientRect();
      const visible = el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.top >= rect.top - 0.5 && r.bottom <= rect.bottom + 0.5 && r.bottom <= body.bottom + 0.5 && Boolean(hit && el.contains(hit));
      };
      const chips = [...popup.querySelectorAll('button')];
      const focused = popup.contains(document.activeElement) ? document.activeElement : null;
      return {
        height: rect.height,
        needsScroll: popup.scrollHeight > popup.clientHeight,
        withinBody: rect.top >= body.top && rect.bottom <= body.bottom + 0.5 && rect.bottom <= innerHeight,
        withinPanel: rect.left >= panel.left - 0.5 && rect.right <= panel.right + 0.5,
        horizontalOverflow: popup.scrollWidth > popup.clientWidth || document.documentElement.scrollWidth > innerWidth,
        lastKey: chips[chips.length - 1].dataset.filterKey,
        lastVisible: visible(chips[chips.length - 1]),
        focusKey: focused ? focused.dataset.filterKey : null,
        focusedVisible: focused ? visible(focused) : null,
      };
    });

    // Headless Chromium hides scrollbars (--hide-scrollbars), so assert the loaded
    // persistent-scrollbar rule instead of a rendered width.
    assert.equal(await page.evaluate(() => [...document.styleSheets]
      .flatMap(sheet => { try { return [...sheet.cssRules]; } catch { return []; } })
      .some(rule => rule.selectorText === '#editor-case-chips::-webkit-scrollbar' && rule.style.width === '8px')), true,
    'the filter popup styles a persistent (non-overlay) scrollbar');

    for (const size of [{ width: 1400, height: 900 }, { width: 1400, height: 560 }, { width: 390, height: 640 }]) {
      const label = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      if (size.width < 900 && !await page.locator('#editor-left').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#btn-editor-left').click();
      }
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `${label}: popup opens`);
      let m = await measure();
      assert.ok(m.height >= 72, `${label}: popup has usable height (${m.height})`);
      assert.equal(m.needsScroll, true, `${label}: the fixture list must require scrolling`);
      assert.equal(m.withinBody, true, `${label}: popup ends inside the clipping Case Browser body and viewport`);
      assert.equal(m.withinPanel, true, `${label}: popup stays inside the Case Browser`);
      assert.equal(m.horizontalOverflow, false, `${label}: no horizontal overflow`);

      await page.locator('#editor-case-chips').evaluate(el => { el.scrollTop = el.scrollHeight; });
      m = await measure();
      assert.equal(m.lastVisible, true, `${label}: the last option is reachable and not clipped by an ancestor`);

      await page.locator(`#editor-case-chips [data-filter-key="${m.lastKey}"]`).focus();
      await page.keyboard.press('Space');
      m = await measure();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `${label}: popup stays open`);
      assert.equal(m.focusKey, m.lastKey, `${label}: focus stays on the activated option`);
      assert.equal(m.focusedVisible, true, `${label}: the focused option remains visible`);
      await page.keyboard.press('Space');
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Editor fixture keeps rebuilt focus, rejects invalid truck input and exposes modal errors', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const beforeTruck = await page.evaluate(() => JSON.stringify(window.probe.StateStore.get('packLibrary')[0].truck));
    await page.locator('[data-focus-key="truck-length"]').fill('');
    await page.locator('#inspector-body button').filter({ hasText: 'Update truck' }).click();
    assert.equal(await page.locator('[data-focus-key="truck-length"]').getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('[data-focus-key="truck-length"]').locator('..').textContent(), /Enter at least/);
    assert.equal(await page.evaluate(() => JSON.stringify(window.probe.StateStore.get('packLibrary')[0].truck)), beforeTruck);
    assert.equal(await page.locator('.modal-overlay').count(), 0);

    await page.locator('[data-focus-key="truck-length"]').fill('636');
    const preset = page.locator('[data-focus-key="truck-preset"]');
    await preset.focus();
    await preset.click();
    await page.getByRole('listbox', { name: 'Trailer preset' }).getByRole('option').nth(1).click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'truck-preset');
    const shape = page.locator('[data-focus-key="truck-shape"]');
    await shape.focus();
    await shape.click();
    await page.getByRole('listbox', { name: 'Trailer Shape Mode' }).getByRole('option', { name: 'Wheel Wells' }).click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'truck-shape');

    await page.locator('[data-role="editor-new-case"]').click();
    assert.equal(await page.locator('#toast-container').evaluate(el => el.parentElement === document.body), true);
    const fields = await page.locator('.modal input[required], .modal [role="combobox"]').evaluateAll(elements =>
      elements.map(el => ({ name: el.labels?.[0]?.textContent?.trim() || el.getAttribute('aria-label'), required: el.required })));
    assert.ok(fields.some(field => field.name?.startsWith('Name') && field.required));
    assert.ok(fields.filter(field => /Length|Width|Height/.test(field.name || '')).every(field => field.required));
    await page.locator('.modal-footer button').filter({ hasText: 'Save' }).click();
    const name = page.locator('.modal input[required]').first();
    assert.equal(await name.getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('.modal .tp3d-field-error:not([hidden])').first().textContent(), /Name is required/);
    await page.setViewportSize({ width: 320, height: 568 });
    const toastBounds = await page.evaluate(() => {
      window.probe.UIComponents.showToast('This validation message explains the required value for the selected case field.', 'warning');
      const toast = document.querySelector('#toast-container .toast:last-child');
      const rect = toast.getBoundingClientRect();
      return { left: rect.left, right: rect.right, parent: toast.parentElement.parentElement === document.body };
    });
    assert.equal(toastBounds.parent, true);
    assert.ok(toastBounds.left >= 0 && toastBounds.right <= 320, 'modal toast fits the 320px viewport');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForFunction(() => document.querySelector('#toast-container')?.parentElement?.classList.contains('canvas-wrap'));
    const contrast = await page.evaluate(() => {
      const luminance = value => {
        const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const ratio = (a, b) => {
        const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      return ['light', 'dark'].map(theme => {
        document.documentElement.dataset.theme = theme;
        document.querySelector('[data-focus-key="truck-length"]').focus();
        const primary = getComputedStyle(document.querySelector('#inspector-body .btn-primary'));
        const label = getComputedStyle(document.querySelector('#inspector-body .tp3d-editor-dims-row .label'));
        const panel = getComputedStyle(document.querySelector('#inspector-body .card'));
        const input = getComputedStyle(document.querySelector('[data-focus-key="truck-length"]'));
        return {
          theme,
          primary: [primary.color, primary.backgroundColor],
          label: ratio(label.color, panel.backgroundColor),
          focus: {
            color: input.outlineColor,
            width: input.outlineWidth,
            style: input.outlineStyle,
            contrast: ratio(input.outlineColor, panel.backgroundColor),
          },
        };
      });
    });
    for (const sample of contrast) {
      // White on the bright brand accent is the approved primary pairing; its
      // contrast is a known product limitation, so it is pinned, not gated.
      assert.deepEqual(sample.primary, ['rgb(255, 255, 255)', 'rgb(255, 159, 28)'], `${sample.theme} primary pairing`);
      assert.ok(sample.label >= 4.5, `${sample.theme} dimension label contrast ${sample.label}`);
      // The approved brand ring is below 3:1 on light surfaces. Keep its
      // measured contrast visible without reviving the rejected brown/blue cue.
      assert.deepEqual([sample.focus.color, sample.focus.width, sample.focus.style],
        ['rgb(255, 159, 28)', '2px', 'solid'], `${sample.theme} visible brand focus`);
      assert.ok(Number.isFinite(sample.focus.contrast), `${sample.theme} focus contrast is measured`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Editor fixture holds Inspector totals at Updating… while AutoPack loads, then keeps Results focus through controls, close and reopen', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const totals = () => page.evaluate(() => {
      const body = document.querySelector('#inspector-body');
      const summary = body.querySelector('.tp3d-editor-stats-card');
      const gauge = body.querySelector('[data-role="space-utilization-gauge"]');
      const clean = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const title = gauge?.querySelector('.tp3d-util-gauge__title');
      const headline = gauge?.querySelector('.tp3d-util-gauge__headline');
      const headlineIndent = title && headline
        ? Math.round(headline.getBoundingClientRect().left - title.getBoundingClientRect().left) : null;
      const font = el => {
        if (!el) return null;
        const style = getComputedStyle(el);
        return { size: style.fontSize, weight: style.fontWeight, color: style.color, family: style.fontFamily };
      };
      return { op: window.probe.op(), summary: clean(summary), gaugeState: gauge?.dataset.state ?? null, gauge: clean(gauge),
        headlineIndent, gaugeFont: font(headline), summaryFont: font(summary?.querySelector('[data-role="load-summary-updating"]')) };
    });
    const source = await page.evaluate(() => window.probe.casesJson());
    await page.locator('#btn-autopack').click();
    await page.waitForFunction(count => document.querySelector('.autopack-loading-message')?.textContent ===
      'Placing cargo in the truck...' && window.probe.presentationRemaining() < count && window.probe.presentationRemaining() > 0, CARGO_COUNT);
    const loading = await totals();
    assert.equal(loading.op, 'autopacking', 'sampled while AutoPack still owns the Editor');
    assert.equal(loading.summary, 'Load Summary Updating…',
      'Load Summary stays present and coherent while the operation owns the Editor');
    assert.equal(loading.gaugeState, 'updating', 'Space Utilization reads Updating while cargo is visibly loading');
    assert.equal(loading.headlineIndent, 0, 'Updating… is left-aligned with the Space Utilization title');
    assert.ok(loading.summaryFont, 'Load Summary shows its Updating… line');
    assert.deepEqual(loading.gaugeFont, loading.summaryFont,
      'Space Utilization Updating… uses the same font size, weight, colour and family as Load Summary Updating…');
    assert.doesNotMatch(loading.gauge, /%|ft³|previous/, 'no interim, fake progressive or previous utilization');
    await page.waitForFunction(() => window.probe.op() === 'idle' &&
      (window.probe.StateStore.get('autoPackResults')?.options || []).length > 0, null, { timeout: 90000 });
    const candidate = await page.evaluate(() => {
      const p = window.probe;
      const pack = p.PackLibrary.getById(p.StateStore.get('currentPackId'));
      const r = p.StateStore.get('autoPackResults');
      const option = p.viewedCandidate();
      const stats = p.PackLibrary.computeStats({ ...pack, cases: option.nextCases });
      return { packed: stats.packedCases, staged: stats.stagedCases, percent: stats.volumePercent.toFixed(1),
        preferred: r.preferredId, selected: r.selectedId, adopted: r.adoptedOptionIds,
        assessment: option.assessment.primary, cases: p.casesJson(), transient: p.transient(), remaining: p.presentationRemaining() };
    });
    assert.equal(candidate.preferred, 'default');
    assert.equal(candidate.assessment, 'INCOMPLETE');
    assert.equal(candidate.selected, null);
    assert.deepEqual(candidate.adopted, []);
    assert.equal(candidate.cases, source, 'the committed Pack stays unchanged');
    assert.equal(candidate.transient, true);
    assert.equal(candidate.remaining, 0, 'presentation reaches the preferred candidate');
    const done = await totals();
    assert.match(done.summary, new RegExp(`^Load Summary In truck ?${candidate.packed} Staged ?${candidate.staged} Total weight ?\\d`),
      'the existing C5A preview Load Summary describes the viewed candidate');
    assert.equal(done.gaugeState, 'valid');
    assert.ok(done.gauge.includes(`${candidate.percent}% Occupied`), `the viewed candidate utilization returns (${done.gauge})`);
    await page.setViewportSize({ width: 320, height: 568 });
    const resultsFit = await page.locator('[data-role="autopack-results-panel"]').evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      const canvas = panel.closest('.canvas-wrap').getBoundingClientRect();
      return rect.left >= canvas.left && rect.right <= canvas.right &&
        rect.top >= canvas.top && rect.bottom <= canvas.bottom;
    });
    assert.equal(resultsFit, true, 'short-height Results remains inside the canvas');
    const next = page.locator('[data-focus-key="results-next"]');
    if (await next.count()) {
      await next.focus();
      await next.click();
      const afterNext = await page.evaluate(() => document.activeElement.dataset.focusKey);
      assert.ok(['results-next', 'results-prev'].includes(afterNext));
    }
    const toggle = page.locator('[data-focus-key="results-toggle"]');
    await toggle.focus();
    await toggle.click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'results-toggle');
    await page.locator('[data-focus-key="results-toggle"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'results-toggle');
    await page.locator('[data-focus-key="results-close"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-autopack-results-reopen',
      'closing hands focus to the restore control that reverses it');

    const corner = () => page.evaluate(() => {
      const layer = document.getElementById('editor-utility-stack').getBoundingClientRect();
      const box = el => {
        if (!el || el.hidden || !el.getClientRects().length) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left - layer.left, bottom: layer.bottom - r.bottom, top: layer.bottom - r.top };
      };
      const reopen = document.getElementById('btn-autopack-results-reopen');
      return {
        reopen: box(reopen),
        warning: document.getElementById('editor-validation-status').hidden ? null
          : box(document.getElementById('editor-validation-status-btn')),
        reopenName: reopen.getAttribute('aria-label'),
        reopenFocusable: reopen.tabIndex >= 0 && !reopen.hidden,
      };
    });
    const showWarning = visible => page.evaluate(on => {
      document.getElementById('editor-validation-status').hidden = !on;
    }, visible);
    // C4 derives the warning from the committed physical assessment, so this
    // layout check must explicitly create the "results only" state instead of
    // assuming AutoPack leaves the warning hidden.
    await showWarning(false);
    const resultsOnly = await corner();
    assert.equal(resultsOnly.reopenName, 'Reopen AutoPack Results');
    assert.equal(resultsOnly.reopenFocusable, true);
    assert.deepEqual(resultsOnly.reopen && [resultsOnly.reopen.left, resultsOnly.reopen.bottom], [14, 14],
      'alone, the restore control takes the normal bottom-left slot');
    assert.equal(resultsOnly.warning, null);
    await showWarning(true);
    const both = await corner();
    assert.deepEqual([both.warning.left, both.warning.bottom], [14, 14], 'the warning keeps its own corner slot');
    assert.equal(both.reopen.left, 14);
    assert.equal(both.reopen.bottom, both.warning.top + 8, 'the restore control sits one slot above the warning');
    await showWarning(false);

    const before = await page.evaluate(() => {
      const p = window.probe;
      const pack = p.PackLibrary.getById(p.StateStore.get('currentPackId'));
      return { cases: p.casesJson(), lastEdited: pack.lastEdited, runId: p.StateStore.get('autoPackResults').runId,
        ops: p.opLog.length };
    });
    await page.locator('#btn-autopack-results-reopen').click();
    const reopened = await page.evaluate(() => {
      const p = window.probe;
      const results = p.StateStore.get('autoPackResults');
      const panel = document.querySelector('[data-role="autopack-results-panel"]');
      return {
        cases: p.casesJson(), lastEdited: p.PackLibrary.getById(p.StateStore.get('currentPackId')).lastEdited,
        runId: results.runId, closed: results.closed, minimized: results.minimized,
        newOps: p.opLog.length, expanded: Boolean(panel) && !panel.classList.contains('is-minimized'),
        focus: document.activeElement.dataset.focusKey, reopenHidden: document.getElementById('btn-autopack-results-reopen').hidden,
      };
    });
    assert.equal(reopened.runId, before.runId, 'the same Results run is reopened');
    assert.equal(reopened.closed, false);
    assert.equal(reopened.minimized, false);
    assert.equal(reopened.expanded, true, 'the reopened panel is expanded');
    assert.equal(reopened.newOps, before.ops, 'no operation (AutoPack or otherwise) ran');
    assert.equal(reopened.cases, before.cases, 'no cargo mutation');
    assert.equal(reopened.lastEdited, before.lastEdited, 'lastEdited is untouched');
    assert.equal(reopened.focus, 'results-toggle', 'focus moves into the reopened panel');
    assert.equal(reopened.reopenHidden, true, 'open Results hide the restore control');
    await showWarning(true);
    const warningOnly = await corner();
    assert.equal(warningOnly.reopen, null);
    assert.deepEqual(warningOnly.warning, both.warning, 'without the restore control the warning layout is unchanged');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('C5B authored staging survives every frame and normal Result; preview mass stays unknown through Apply and history', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const source = await page.evaluate(() => {
      const p = window.probe;
      const pack = p.PackLibrary.getById(p.StateStore.get('currentPackId'));
      const definition = { ...p.CaseLibrary.getCases()[0], id: 'oversized', name: 'Authored staging',
        dimensions: { length: 800, width: 10, height: 20 }, volume: 160000, orientationLock: 'upright', weight: 200 };
      const staged = { id: 'authored', caseId: definition.id, placement: 'staged', hidden: false,
        transform: { position: { x: 400, y: 10, z: 463 }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        orientedDims: { length: 999, width: 998, height: 997 } };
      const incoming = { ...structuredClone(staged), id: 'formerly-packed', placement: 'packed',
        transform: { ...structuredClone(staged.transform), position: { x: 400, y: 10, z: 0 } } };
      const hidden = { ...structuredClone(staged), id: 'hidden-staged', hidden: true,
        transform: { ...structuredClone(staged.transform), position: { x: 400, y: 10, z: 1300 } } };
      p.StateStore.set({ caseLibrary: [...p.CaseLibrary.getCases().map((c, index) => index === 0 ? { ...c, weight: null } : c), definition],
        packLibrary: [{ ...pack, cases: [...pack.cases, staged, incoming, hidden] }], selectedInstanceIds: [] }, { skipHistory: true });
      p.StateStore.resetHistory();
      p.c5bWrites = 0;
      p.StateStore.subscribe(changes => { if (changes.packLibrary) p.c5bWrites++; });
      p.c5bFrames = [];
      p.c5bWatching = true;
      const sample = () => {
        const object = p.CaseScene.getObject('authored');
        p.c5bFrames.push({ position: object.position.toArray(), rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
          halfWorld: { ...object.userData.halfWorld } });
        if (p.c5bWatching) requestAnimationFrame(sample);
      };
      sample();
      return JSON.stringify(p.PackLibrary.getById(pack.id));
    });
    await page.locator('#btn-autopack').click();
    await page.waitForFunction(() => window.probe.op() === 'idle' &&
      window.probe.StateStore.get('autoPackResults')?.options?.length > 0, null, { timeout: 90000 });
    const after = await page.evaluate(() => {
      const p = window.probe;
      p.c5bWatching = false;
      const r = p.StateStore.get('autoPackResults');
      return { frames: p.c5bFrames, writes: p.c5bWrites, selected: r.selectedId,
        source: JSON.stringify(p.PackLibrary.getById(p.StateStore.get('currentPackId'))),
        normalIds: r.options.filter(option => option.id !== 'max-capacity').map(option => option.id) };
    });
    assert.equal(after.selected, null, 'INCOMPLETE results require explicit Apply');
    assert.equal(after.source, source, 'the entire committed Pack, stats and lastEdited stay unchanged');
    assert.equal(after.writes, 0);
    assert.ok(after.frames.length > 2, 'real animation frames were observed');
    for (const frame of after.frames) assert.deepEqual(frame, after.frames[0],
      'pre-solve staging, animation and final presentation never jump the authored leftover');
    assert.ok(after.normalIds.length >= 2, 'multiple real normal solver options exercise shared staging');
    const read = () => page.evaluate(async () => {
      const p = window.probe;
      const { buildAppliedAutoPackCases } = await import('/src/screens/editor-screen.js');
      const { getActualPoseDimensions } = await import('/src/core/oriented-dims.js');
      const { getAabb, aabbsOverlap } = await import('/src/services/autopack-solver.js');
      const pack = p.PackLibrary.getById(p.StateStore.get('currentPackId'));
      const option = p.viewedCandidate();
      const cases = buildAppliedAutoPackCases(option, structuredClone, pack.cases);
      const candidate = { ...pack, cases };
      const stats = p.PackLibrary.computeStats(candidate);
      const authored = cases.find(inst => inst.id === 'authored');
      const hidden = cases.find(inst => inst.id === 'hidden-staged');
      const incoming = cases.find(inst => inst.id === 'formerly-packed');
      const bounds = inst => {
        const dims = getActualPoseDimensions(p.CaseLibrary.getById(inst.caseId), inst).value;
        return getAabb(inst.transform.position, { l: dims.length, w: dims.width, h: dims.height });
      };
      const body = document.querySelector('#inspector-body');
      return { authored, hidden, incoming, stats: { packed: stats.packedCases, staged: stats.stagedCases,
        totalWeight: stats.totalWeight, weightComplete: stats.weightComplete, percent: stats.volumePercent.toFixed(1) },
        overlap: [authored, hidden].some(inst => aabbsOverlap(bounds(incoming), bounds(inst))),
        sceneMatches: cases.filter(inst => !inst.hidden).every(inst => p.CaseScene.getObject(inst.id).position
          .distanceTo(p.SceneManager.vecInchesToWorld(inst.transform.position)) < 1e-6),
        counts: [...body.querySelectorAll('.tp3d-editor-stats-card .row b')].map(el => el.textContent),
        gauge: body.querySelector('[data-role="space-utilization-gauge"]').textContent,
        writes: p.c5bWrites };
    });
    const original = JSON.parse(source);
    const authored = original.cases.find(inst => inst.id === 'authored');
    const hidden = original.cases.find(inst => inst.id === 'hidden-staged');
    for (const id of after.normalIds) {
      // Use the existing Results controls to reach each normal strategy.
      while (await page.evaluate(target => window.probe.viewedCandidate().id !== target, id)) {
        const currentIndex = await page.evaluate(() => window.probe.StateStore.get('autoPackResults').viewIndex || 0);
        const targetIndex = await page.evaluate(async target => {
          const { orderAutoPackResultOptions } = await import('/src/screens/editor-screen.js');
          return orderAutoPackResultOptions(window.probe.StateStore.get('autoPackResults').options).findIndex(o => o.id === target);
        }, id);
        await page.locator(`[data-focus-key="results-${targetIndex > currentIndex ? 'next' : 'prev'}"]`).click();
      }
      const viewed = await read();
      assert.deepEqual(viewed.authored.transform, authored.transform);
      assert.deepEqual(viewed.authored.orientedDims, { length: 10, width: 800, height: 20 });
      assert.deepEqual(viewed.hidden, hidden);
      assert.equal(viewed.incoming.placement, 'staged');
      assert.equal(viewed.overlap, false, 'new staging avoids existing visible and hidden footprints');
      assert.equal(viewed.sceneMatches, true);
      assert.equal(viewed.stats.totalWeight, null);
      assert.equal(viewed.stats.weightComplete, false);
      assert.deepEqual(viewed.counts, [String(viewed.stats.packed), String(viewed.stats.staged), '—']);
      assert.ok(viewed.gauge.includes(`${viewed.stats.percent}%`));
      assert.equal(viewed.writes, 0, 'browsing leaves persistence untouched');
    }
    assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'preview creates no history');
    await page.locator('[data-focus-key="results-apply"]').click();
    const applied = await read();
    assert.equal(applied.writes, 1, 'Apply makes one canonical commit');
    assert.deepEqual(applied.authored.transform, authored.transform);
    const committed = await page.evaluate(() => window.probe.casesJson());
    assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), true);
    assert.equal(await page.evaluate(() => window.probe.casesJson()), JSON.stringify(original.cases));
    assert.equal(await page.evaluate(() => window.probe.StateStore.redo()), true);
    assert.equal(await page.evaluate(() => window.probe.casesJson()), committed);
    assert.equal((await read()).sceneMatches, true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Results carousel: Balanced leads, arrows live-preview the 3D load and Inspector without touching the Pack, Apply commits', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const source = await page.evaluate(() => window.probe.casesJson());
    await page.locator('#btn-autopack').click();
    await page.waitForFunction(() => window.probe.op() === 'idle' &&
      (window.probe.StateStore.get('autoPackResults')?.options || []).length > 0, null, { timeout: 90000 });
    const ids = await page.evaluate(() => window.probe.StateStore.get('autoPackResults').options.map(option => option.id));
    assert.deepEqual([...ids].sort(), ['default', 'floor-first', 'max-capacity'],
      'fixture precondition: Balanced, Floor first and Max Capacity survive dedupe');
    // Every StateStore change from here on: browsing may only touch Results.
    await page.evaluate(() => {
      const p = window.probe;
      p.changeLog = [];
      p.StateStore.subscribe(changes => { p.changeLog.push(Object.keys(changes).sort().join(',')); });
    });
    const changesSince = start => page.evaluate(from => window.probe.changeLog.slice(from), start);
    const changeCount = () => page.evaluate(() => window.probe.changeLog.length);
    const initial = await page.evaluate(() => {
      const p = window.probe;
      const r = p.StateStore.get('autoPackResults');
      return { preferred: r.preferredId, selected: r.selectedId, adopted: r.adoptedOptionIds,
        primary: r.options.find(option => option.id === r.preferredId).assessment.primary,
        minimized: r.minimized, cases: p.casesJson(), transient: p.transient() };
    });
    assert.equal(initial.preferred, 'default');
    assert.equal(initial.selected, null);
    assert.deepEqual(initial.adopted, []);
    assert.equal(initial.primary, 'INCOMPLETE');
    assert.equal(initial.minimized, false);
    assert.equal(initial.cases, source);
    assert.equal(initial.transient, true);
    const view = () => page.evaluate(() => {
      const panel = document.querySelector('[data-role="autopack-results-panel"]');
      const pick = selector => panel.querySelector(selector);
      const clean = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const style = el => (el ? { bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color } : null);
      const status = pick('.tp3d-autopack-results__status');
      const note = pick('.tp3d-autopack-results__relaxed-note');
      return {
        counter: clean(pick('.tp3d-autopack-results__counter')),
        title: clean(pick('.tp3d-autopack-results__option-title')),
        description: clean(pick('.tp3d-autopack-results__option-desc')),
        status: clean(status), statusClass: status?.className ?? '', statusStyle: style(status),
        recommended: clean(pick('.tp3d-autopack-results__recommended-pill')),
        applied: clean(pick('.tp3d-autopack-results__current-pill')), appliedStyle: style(pick('.tp3d-autopack-results__current-pill')),
        note: clean(note), noteFits: note ? note.offsetHeight > 0 && note.scrollWidth <= note.clientWidth + 1 : null,
        noteTitle: note?.getAttribute('title') ?? null, noteColor: style(note)?.color ?? null,
        noteIconColor: note ? getComputedStyle(note.querySelector('i')).color : null,
        text: clean(panel),
      };
    });
    const step = async focusKey => {
      await page.locator(`[data-focus-key="${focusKey}"]`).click();
      return view();
    };
    // What the 3D scene and the Truck Inspector show, against an option's
    // layout (the projection Apply commits) and against the committed Pack.
    const sceneState = optionId => page.evaluate(async id => {
      const p = window.probe;
      const EditorScreen = await import('/src/screens/editor-screen.js');
      const Gauge = await import('/src/ui/space-utilization-gauge.js');
      const pack = p.PackLibrary.getById(p.StateStore.get('currentPackId'));
      const option = p.StateStore.get('autoPackResults').options.find(item => item.id === id);
      const cases = EditorScreen.buildAppliedAutoPackCases(option, value => structuredClone(value), pack.cases);
      const atPose = list => list.every(inst => p.CaseScene.getObject(inst.id).position
        .distanceTo(p.SceneManager.vecInchesToWorld(inst.transform.position)) <= 0.05);
      const expected = Gauge.buildSpaceUtilizationResult({ ...pack, cases }, p.PackLibrary);
      const expectedStats = p.PackLibrary.computeStats({ ...pack, cases });
      const body = document.querySelector('#inspector-body');
      const clean = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      return {
        showsOption: atPose(cases),
        showsPack: atPose(pack.cases),
        transient: p.CaseScene.isTransientPreview(),
        summary: clean(body.querySelector('.tp3d-editor-stats-card')),
        displayedWeight: clean(body.querySelector('.tp3d-editor-stats-card .row:last-child b')),
        gauge: clean(body.querySelector('[data-role="space-utilization-gauge"]')),
        expectedInTruck: expected.loadedCount,
        expectedStaged: expected.stagedCount,
        expectedPercent: expected.percentage.toFixed(1),
        expectedWeight: p.Utils.formatWeight(expectedStats.totalWeight, 'lb'),
      };
    }, optionId);
    const showsInspector = (scene, label) => {
      assert.match(scene.summary, new RegExp(`In truck ?${scene.expectedInTruck} Staged ?${scene.expectedStaged}\\b`),
        `${label}: Load Summary matches the layout in the scene`);
      assert.ok(scene.gauge.includes(`${scene.expectedPercent}% Occupied`),
        `${label}: Space Utilization matches the layout in the scene (${scene.gauge})`);
      assert.equal(scene.displayedWeight, scene.expectedWeight,
        `${label}: loaded weight matches the same viewed candidate (${scene.summary})`);
    };
    const packJson = () => page.evaluate(() => window.probe.casesJson());
    let balancedPack = await packJson();

    // A + C: the default starting view (First option) opens on Balanced, Option 1.
    const balanced = await view();
    assert.equal(balanced.counter, 'Option 1 of 3', 'A: Balanced is Option 1');
    assert.equal(balanced.title, 'Balanced', 'C: the fresh default view shows Balanced, with no hard-coded "(recommended)"');
    assert.equal(balanced.recommended, null, 'INCOMPLETE is not Recommended');
    assert.equal(balanced.applied, null, 'INCOMPLETE is not auto-adopted');
    assert.match(balanced.text, /Needs review/);
    assert.equal(balanced.status, 'Complete');
    assert.match(balanced.statusClass, /tp3d-autopack-results__status--complete/);
    assert.equal(balanced.statusStyle.color, 'rgb(4, 120, 87)', 'Complete reads in the success colour');
    assert.doesNotMatch(balanced.text, /\bFloor\b|\bStacked\b|profile/, 'no Floor/Stacked or profile-count chips');
    const balancedScene = await sceneState('default');
    assert.equal(balancedScene.showsOption, true, 'the scene shows the preferred candidate');
    assert.equal(balancedScene.showsPack, false, 'the source Pack has not adopted that candidate');
    assert.equal(balancedScene.transient, true);
    showsInspector(balancedScene, 'Balanced');

    // B + D + E + F: the right arrow shows the Max Capacity card AND its 3D load.
    const browseStart = await changeCount();
    const max = await step('results-next');
    assert.equal(max.counter, 'Option 2 of 3', 'B: Max Capacity is Option 2');
    assert.equal(max.title, 'Max Capacity', 'D: the right arrow shows the Max Capacity card');
    assert.equal(max.description, 'Relaxed handling comparison');
    assert.equal(max.note, 'Handling rules relaxed. Review before transport.', 'the warning is visible text');
    assert.equal(max.noteFits, true, 'the warning is not clipped');
    assert.equal(max.noteTitle, null, 'the warning does not rely on hover');
    assert.equal(max.noteIconColor, 'rgb(232, 117, 0)', 'the warning icon carries the orange warning token');
    assert.equal(max.noteColor, 'rgb(26, 26, 31)', 'the warning copy stays neutral, readable text');
    assert.equal(max.recommended, null, 'Max Capacity is never Recommended');
    assert.equal(max.applied, null);
    assert.doesNotMatch(max.text, /Max Capacity profile|Floor \d|Stacked/i, 'no Floor/Stacked or profile-count chips');
    const maxScene = await sceneState('max-capacity');
    assert.equal(maxScene.showsOption, true, 'E: the 3D scene shows the Max Capacity layout');
    assert.equal(maxScene.showsPack, false, 'E: the scene differs from the committed source layout');
    assert.equal(maxScene.transient, true, 'E: the scene is marked as a transient preview');
    showsInspector(maxScene, 'Max Capacity preview');
    assert.equal(await packJson(), balancedPack, 'F: Pack.cases is unchanged while browsing');
    assert.deepEqual(await changesSince(browseStart), ['autoPackResults'],
      'F: browsing writes only transient Results state (no Pack, history, autosave or lastEdited write)');

    // Visibility never changes the viewed candidate or committed source.
    await page.locator('[data-focus-key="results-toggle"]').click();
    assert.equal((await sceneState('max-capacity')).showsOption, true, 'minimized Results retain the viewed candidate');
    await page.locator('[data-focus-key="results-toggle"]').click();
    assert.equal((await sceneState('max-capacity')).showsOption, true, 'expanding resumes the viewed option');
    await page.locator('[data-focus-key="results-close"]').click();
    const closedScene = await sceneState('max-capacity');
    assert.equal(closedScene.showsOption && closedScene.transient && !closedScene.showsPack, true, 'closed Results retain an uncommitted candidate');
    assert.equal(closedScene.summary, maxScene.summary, 'closing keeps the candidate Load Summary');
    assert.equal(closedScene.gauge, maxScene.gauge, 'closing keeps the candidate Space Utilization');
    await page.locator('#btn-autopack-results-reopen').click();
    assert.equal((await view()).counter, 'Option 2 of 3', 'reopening keeps the viewed option');
    assert.equal((await sceneState('max-capacity')).showsOption, true, 'and its live preview');

    // G: the left arrow restores the preferred transient Balanced candidate.
    const back = await step('results-prev');
    assert.equal(back.counter, 'Option 1 of 3', 'G: the left arrow returns to Balanced');
    assert.equal(back.applied, null);
    assert.equal(back.recommended, null);
    const backScene = await sceneState('default');
    assert.equal(backScene.showsOption, true, 'G: the Balanced candidate is restored');
    assert.equal(backScene.showsPack, false);
    assert.equal(backScene.transient, true);
    assert.equal(backScene.summary, balancedScene.summary, 'G: the preferred candidate Load Summary returns');
    assert.equal(backScene.gauge, balancedScene.gauge, 'G: the preferred candidate Space Utilization returns');
    assert.equal(await packJson(), balancedPack, 'G: still no Pack change');
    assert.deepEqual([...new Set(await changesSince(browseStart))], ['autoPackResults'],
      'minimize, close, reopen and browsing only ever wrote Results state');
    assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'AutoPack and browsing created no Undo');

    const balancedApplyStart = await changeCount();
    await page.locator('[data-focus-key="results-apply"]').click();
    assert.equal((await changesSince(balancedApplyStart)).filter(keys => keys.split(',').includes('packLibrary')).length, 1,
      'explicit Apply commits the preferred INCOMPLETE candidate exactly once');
    assert.equal((await view()).applied, 'Applied');
    const committedBalancedScene = await sceneState('default');
    assert.equal(committedBalancedScene.showsPack && committedBalancedScene.showsOption && !committedBalancedScene.transient, true);
    balancedPack = await packJson();
    assert.notEqual(balancedPack, source, 'only explicit Apply adopted Balanced');

    await step('results-next');
    const floor = await step('results-next');
    assert.equal(floor.counter, 'Option 3 of 3');
    assert.equal(floor.status, 'Partial');
    assert.match(floor.statusClass, /tp3d-autopack-results__status--partial/);
    assert.notDeepEqual(floor.statusStyle, balanced.statusStyle, 'Partial and Complete look different');
    assert.equal(floor.recommended, null);
    assert.equal(floor.applied, null);
    assert.equal((await sceneState('floor-first')).showsOption, true, 'every browsed option previews its own layout');

    await page.locator('[data-focus-key="results-apply"]').click();
    const floorApplied = await view();
    assert.equal(floorApplied.counter, 'Option 3 of 3', 'an explicit browse stays put after Apply');
    assert.equal(floorApplied.applied, 'Applied', 'Floor first is now Applied');
    assert.deepEqual(floorApplied.appliedStyle, { bg: 'rgb(255, 159, 28)', color: 'rgb(255, 255, 255)' },
      'Applied keeps the brand orange/white treatment');
    assert.equal(floorApplied.recommended, null, 'Applied does not make it Recommended');
    const floorScene = await sceneState('floor-first');
    assert.equal(floorScene.showsPack && floorScene.showsOption && !floorScene.transient, true,
      'after Apply the scene is the committed Pack again');

    // Undo/Redo during a preview step only the committed Pack, end the preview
    // on the new Applied option, and leave the restored scene capturable.
    const floorPackJson = await packJson();
    await page.evaluate(() => {
      const p = window.probe;
      p.settledCalls = 0;
      p.EditorUI.setPreviewViewSettledCallback(() => { p.settledCalls += 1; });
    });
    const historyStep = name => page.evaluate(async action => {
      const p = window.probe;
      const before = p.settledCalls;
      p.StateStore[action]();
      await new Promise(resolve => setTimeout(resolve, 0));
      return { capturable: Boolean(p.EditorUI.getPreviewScene()), settled: p.settledCalls - before };
    }, name);
    assert.equal((await step('results-prev')).title, 'Max Capacity');
    assert.equal((await sceneState('max-capacity')).transient, true, 'Max Capacity previews over the applied Floor first');
    const undo = await historyStep('undo');
    const afterUndo = await view();
    assert.equal(afterUndo.counter, 'Option 1 of 3', 'Undo lands the view on the new Applied option (Balanced)');
    assert.equal(afterUndo.applied, 'Applied');
    const undoScene = await sceneState('default');
    assert.equal(undoScene.showsPack && !undoScene.transient, true, 'the canonical scene is restored after Undo');
    assert.equal(await packJson(), balancedPack, 'Undo stepped only the committed Pack (back to Balanced)');
    assert.equal(undo.capturable, true, 'the restored scene is capture authority again (no refused thumbnail)');
    assert.ok(undo.settled > 0, 'ending the preview re-requests the thumbnail freshness check');
    await step('results-next');
    assert.equal((await sceneState('max-capacity')).transient, true, 'Max Capacity previews over Balanced');
    const redo = await historyStep('redo');
    const afterRedo = await view();
    assert.equal(afterRedo.counter, 'Option 3 of 3', 'Redo lands the view on the new Applied option (Floor first)');
    assert.equal(afterRedo.applied, 'Applied');
    const redoScene = await sceneState('floor-first');
    assert.equal(redoScene.showsPack && !redoScene.transient, true, 'the canonical scene is restored after Redo');
    assert.equal(await packJson(), floorPackJson, 'Redo stepped only the committed Pack (back to Floor first)');
    assert.equal(redo.capturable, true);
    assert.ok(redo.settled > 0);
    await page.evaluate(() => window.probe.EditorUI.setPreviewViewSettledCallback(null));

    const maxBetween = await step('results-prev');
    assert.equal(maxBetween.counter, 'Option 2 of 3');
    await step('results-prev');
    const recommendedOnly = await view();
    assert.equal(recommendedOnly.recommended, null, 'explicit Apply does not upgrade the run assessment to Recommended');
    assert.equal(recommendedOnly.applied, null, 'without being Applied');

    // Starting view preference over the real render: each simulated NEW run
    // (fresh runId, nothing browsed) opens per the saved preference.
    const startState = () => page.evaluate(() => {
      const r = window.probe.StateStore.get('autoPackResults');
      return { cases: window.probe.casesJson(), selectedId: r.selectedId, ids: r.options.map(option => option.id) };
    });
    const beforeStart = await startState();
    const setStartView = startView => page.evaluate(value => {
      const p = window.probe;
      p.StateStore.set({ preferences: { ...p.StateStore.get('preferences'), autoPackResultsStartView: value } },
        { skipHistory: true });
    }, startView);
    const newRun = async startView => {
      await setStartView(startView);
      await page.evaluate(value => {
        const p = window.probe;
        const r = p.StateStore.get('autoPackResults');
        p.StateStore.set({ autoPackResults: { ...r, runId: `start-${value}`, viewIndex: undefined } }, { skipHistory: true });
      }, startView);
      return view();
    };
    const startFirst = await newRun('first');
    assert.equal(startFirst.counter, 'Option 1 of 3', 'First option opens on Balanced');
    assert.equal(startFirst.title, 'Balanced');
    const startApplied = await newRun('applied');
    assert.equal(startApplied.counter, 'Option 3 of 3', 'Applied option opens on the committed Floor first plan');
    assert.equal(startApplied.applied, 'Applied');
    const startRecommended = await newRun('recommended');
    assert.equal(startRecommended.counter, 'Option 1 of 3', 'Recommended starting view falls back without a selected normal Result');
    assert.equal(startRecommended.recommended, null, 'Recommended starting view falls back without a VALID auto-adopted result');
    assert.equal(startRecommended.applied, null, 'the Recommended plan is not Applied');
    await setStartView('applied');
    assert.equal((await view()).counter, 'Option 1 of 3', 'a preference change never moves an open run');
    assert.deepEqual(await startState(), beforeStart,
      'starting views change no Pack cargo, selectedId or stored option order');

    // H: Max Capacity commits only when Apply is clicked.
    const floorPack = await packJson();
    const maxAgain = await step('results-next');
    assert.equal(maxAgain.title, 'Max Capacity');
    assert.equal((await sceneState('max-capacity')).showsOption, true);
    assert.equal(await packJson(), floorPack, 'H: viewing Max Capacity commits nothing');
    // Selection is view-only. A deliberate manual mutation instead ends the
    // preview on committed authority (covered by the focused C5A Node test).
    const selectionOnly = await page.evaluate(async () => {
      const p = window.probe;
      const id = p.PackLibrary.getById(p.StateStore.get('currentPackId')).cases[0].id;
      const before = p.casesJson();
      p.InteractionManager.setSelection([id]);
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = { unchanged: p.casesJson() === before, selected: p.selection(), transient: p.CaseScene.isTransientPreview() };
      p.InteractionManager.setSelection([]);
      return result;
    });
    assert.equal(selectionOnly.unchanged, true, 'selection never commits previewed poses');
    assert.equal(selectionOnly.selected.length, 1);
    assert.equal(selectionOnly.transient, true, 'selection alone keeps the viewed candidate');
    const applyStart = await changeCount();
    await page.locator('[data-focus-key="results-apply"]').click();
    const maxApplied = await view();
    assert.equal(maxApplied.applied, 'Applied', 'H: Apply commits Max Capacity');
    assert.notEqual(await packJson(), floorPack, 'H: the Pack now holds the Max Capacity layout');
    assert.equal((await changesSince(applyStart)).filter(keys => keys.split(',').includes('packLibrary')).length, 1,
      'H: Apply is one canonical Pack write');
    const maxCommitted = await sceneState('max-capacity');
    assert.equal(maxCommitted.showsPack && maxCommitted.showsOption && !maxCommitted.transient, true,
      'H: the committed scene now is the Max Capacity layout');

    assert.equal(maxApplied.note, 'Handling rules relaxed. Review before transport.',
      'the applied Max Capacity still warns on the Results card');
    const profile = () => page.evaluate(() => {
      const p = window.probe;
      const body = document.querySelector('#inspector-body');
      const stats = p.PackLibrary.computeStats(p.PackLibrary.getById(p.StateStore.get('currentPackId')));
      return {
        notice: Boolean(body.querySelector('[data-role="relaxed-handling-profile"]')) ||
          /Relaxed handling profile|Still part of the applied Max Capacity plan/.test(body.textContent),
        summary: (body.querySelector('.tp3d-editor-stats-card')?.textContent || '').replace(/\s+/g, ' ').trim(),
        count: stats.maxCapacityProfileCount,
      };
    });
    const afterMax = await profile();
    assert.ok(afterMax.count > 0, 'applying Max Capacity still marks the packed Cases in canonical stats');
    assert.equal(afterMax.notice, false, 'the Inspector repeats no relaxed-profile notice');
    assert.match(afterMax.summary, /^Load Summary In truck ?\d+ Staged ?\d+ Total weight ?[\d.,]+ ?(lb|kg)$/,
      'Load Summary shows only In truck, Staged and Total weight');

    const darkNote = await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      const note = document.querySelector('[data-role="autopack-results-panel"] .tp3d-autopack-results__relaxed-note');
      const colors = {
        icon: getComputedStyle(note.querySelector('i')).color,
        text: getComputedStyle(note).color,
        success: getComputedStyle(document.documentElement).getPropertyValue('--success-readable').trim(),
      };
      document.documentElement.setAttribute('data-theme', 'light');
      return colors;
    });
    assert.equal(darkNote.icon, 'rgb(255, 189, 102)', 'dark theme warning icon uses the readable warning token');
    assert.equal(darkNote.text, 'rgb(255, 255, 255)', 'dark theme warning copy stays neutral text');
    assert.equal(darkNote.success, '#6ee7b7', 'dark theme switches the success text token');

    await page.evaluate(() => {
      window.probe.StateStore.set({ autoPackResults: null }, { skipHistory: true });
      window.probe.EditorUI.render();
    });
    assert.equal(await page.locator('[data-role="autopack-results-panel"]').count(), 0, 'Results are gone (as after a reload)');
    assert.deepEqual(await profile(), afterMax, 'the membership count derives from the Pack, not from Results');

    await page.evaluate(() => window.probe.StateStore.undo());
    const undone = await profile();
    assert.equal(undone.count, 0, 'Undo returns the count to zero');
    assert.equal(undone.notice, false);
    await page.evaluate(() => window.probe.StateStore.redo());
    assert.equal((await profile()).count, afterMax.count, 'Redo restores the canonical count');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Results preview ends before Unpack claims the Editor; refused and successful operations retain committed authority', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.locator('#btn-autopack').click();
    await page.waitForFunction(() => window.probe.op() === 'idle' &&
      (window.probe.StateStore.get('autoPackResults')?.options || []).length > 1, null, { timeout: 90000 });
    await applyPreferredNormalResult(page);
    // Record what the scene shows at the instant an operation claims the Editor,
    // and every StateStore change (to prove restoration writes nothing durable).
    await page.evaluate(() => {
      const p = window.probe;
      p.sceneAtPack = () => {
        const pack = p.PackLibrary.getById(p.StateStore.get('currentPackId'));
        return pack.cases.every(inst => p.CaseScene.getObject(inst.id).position
          .distanceTo(p.SceneManager.vecInchesToWorld(inst.transform.position)) <= 0.05);
      };
      p.changeLog = [];
      p.StateStore.subscribe(changes => { p.changeLog.push(Object.keys(changes).sort().join(',')); });
      p.opClaims = [];
      p.refuseKind = null;
      const begin = p.OperationLifecycle.beginOperation;
      p.OperationLifecycle.beginOperation = (kind, meta) => {
        p.opClaims.push({ kind, transient: p.CaseScene.isTransientPreview(), atPack: p.sceneAtPack(),
          packWrites: p.changeLog.filter(keys => keys.split(',').includes('packLibrary')).length });
        return p.refuseKind === kind ? null : begin(kind, meta);
      };
    });
    const state = () => page.evaluate(() => {
      const p = window.probe;
      const pack = p.PackLibrary.getById(p.StateStore.get('currentPackId'));
      const panel = document.querySelector('[data-role="autopack-results-panel"]');
      return {
        transient: p.CaseScene.isTransientPreview(), atPack: p.sceneAtPack(), op: p.op(),
        appliedShown: Boolean(panel?.querySelector('.tp3d-autopack-results__current-pill')),
        cases: p.casesJson(), truck: JSON.stringify(pack.truck), lastEdited: pack.lastEdited,
        packWrites: p.changeLog.filter(keys => keys.split(',').includes('packLibrary')).length,
      };
    });
    const lastClaim = () => page.evaluate(() => window.probe.opClaims.at(-1) || null);
    const preview = async label => {
      await page.locator('[data-focus-key="results-next"]').click();
      const s = await state();
      assert.equal(s.transient && !s.atPack, true, `${label}: a non-Applied option is previewed`);
    };
    const committedScene = (s, label) => {
      assert.equal(s.transient, false, `${label}: no transient preview remains`);
      assert.equal(s.atPack, true, `${label}: the scene shows the committed Pack`);
      assert.equal(s.appliedShown, true, `${label}: Results show the Applied option`);
    };
    const base = await state();
    assert.equal(base.transient, false);
    // B: refused Unpack.
    await preview('B');
    await page.evaluate(() => { window.probe.refuseKind = 'unpacking'; });
    await page.locator('#btn-unpack').click();
    await page.waitForFunction(() => window.probe.opClaims.at(-1)?.kind === 'unpacking');
    await page.evaluate(() => { window.probe.refuseKind = null; });
    assert.deepEqual(await lastClaim(), { kind: 'unpacking', transient: false, atPack: true, packWrites: 0 },
      'B: the committed scene was restored before Unpack tried to claim the Editor');
    const refused = await state();
    committedScene(refused, 'B');
    assert.equal(refused.cases, base.cases, 'B: a refused Unpack changes no cargo');

    // G: every restoration so far wrote no Pack, history or lastEdited.
    assert.equal(refused.packWrites, 0, 'G: restoration never wrote the Pack (no history or autosave input)');
    assert.equal(refused.lastEdited, base.lastEdited, 'G: lastEdited unchanged');

    // A: Unpack from a preview.
    await preview('A');
    await page.locator('#btn-unpack').click();
    await page.waitForFunction(() => window.probe.opClaims.at(-1)?.kind === 'unpacking' && window.probe.op() === 'idle');
    assert.deepEqual(await lastClaim(), { kind: 'unpacking', transient: false, atPack: true, packWrites: 0 },
      'A: the committed scene was restored before Unpack claimed the Editor');
    const unpacked = await state();
    assert.equal(unpacked.packWrites, 1, 'A: only the Unpack itself wrote the Pack');
    assert.notEqual(unpacked.cases, base.cases);
    assert.equal(unpacked.transient, false);
    assert.equal(unpacked.atPack, true, 'A: the scene shows the staged Pack');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Editor fixture cancels a selected cargo-group pointer stroke without a Pack commit', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.locator('#btn-autopack').click();
    await page.waitForFunction(() => window.probe.op() === 'idle' &&
      (window.probe.StateStore.get('autoPackResults')?.options || []).length > 0, null, { timeout: 90000 });
    await applyPreferredNormalResult(page);
    await page.locator('[data-focus-key="results-close"]').click();
    const cargo = await page.evaluate(() => window.probe.cargoPoint());
    assert.ok(cargo, 'a visible cargo mesh is available for the disposable gesture');
    const before = await page.evaluate(id => {
      const p = window.probe;
      const other = p.StateStore.get('packLibrary')[0].cases.find(inst => inst.id !== id).id;
      p.StateStore.set({ selectedInstanceIds: [id, other] }, { skipHistory: true });
      return { cases: p.casesJson(), poses: p.poses(), selection: p.selection() };
    }, cargo.id);
    await page.mouse.move(cargo.x, cargo.y);
    await page.mouse.down();
    await page.mouse.move(cargo.x + 35, cargo.y + 20, { steps: 5 });
    const duringPoses = JSON.parse(await page.evaluate(() => window.probe.poses()));
    const startPoses = JSON.parse(before.poses);
    assert.ok(duringPoses.some((pose, index) => pose.some((value, axis) =>
      Math.abs(value - startPoses[index][axis]) > 1e-3)), 'the group gesture reached a provisional pose');
    await page.evaluate(() => {
      const canvas = window.probe.SceneManager.getRenderer().domElement;
      canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    });
    await page.mouse.up();
    // The cancel tweens the group back over animation frames; wait for the
    // actual poses (same 1e-6 tolerance) and re-enabled controls, not a delay.
    await page.waitForFunction(start => {
      const p = window.probe;
      const poses = JSON.parse(p.poses());
      return p.SceneManager.getControls().enabled && poses.every((pose, index) =>
        pose.every((value, axis) => Math.abs(value - start[index][axis]) < 1e-6));
    }, startPoses, { timeout: 10000 });
    const after = await page.evaluate(() => ({
      cases: window.probe.casesJson(), poses: window.probe.poses(),
      selection: window.probe.selection(), controlsEnabled: window.probe.SceneManager.getControls().enabled,
    }));
    assert.equal(after.cases, before.cases);
    const endPoses = JSON.parse(after.poses);
    assert.ok(endPoses.every((pose, index) => pose.every((value, axis) =>
      Math.abs(value - startPoses[index][axis]) < 1e-6)), 'every scene pose returned to its pre-drag position');
    assert.deepEqual(after.selection, before.selection);
    assert.equal(after.controlsEnabled, true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('P0-SM-OF-10B Editor interaction during an animated AutoPack never re-syncs the animating scene', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);

    const probe = fn => page.evaluate(fn);
    const presentationRemaining = () => probe(() => window.probe.presentationRemaining());
    // Interact, then prove the interaction caused no scene re-sync and no snap.
    const noSnap = async (label, interact) => {
      const before = await probe(() => {
        window.probe.watch();
        return { presentationRemaining: window.probe.presentationRemaining(), syncs: window.probe.syncCalls };
      });
      assert.ok(before.presentationRemaining >= MIN_REMAINING, `${label}: enough animation remains to observe a snap (${before.presentationRemaining})`);
      await interact();
      const after = await probe(() => ({
        ...window.probe.unwatch(), presentationRemaining: window.probe.presentationRemaining(), syncs: window.probe.syncCalls, op: window.probe.op(),
      }));
      assert.ok(after.maxExcess <= 0,
        `${label}: cargo lands batch by batch, no mass snap (largest one-frame drop ${after.maxDrop}; ${before.presentationRemaining} -> ${after.presentationRemaining})`);
      assert.equal(after.syncs, before.syncs, `${label}: no CaseScene.sync while AutoPack animates`);
      assert.equal(after.op, 'autopacking', `${label}: AutoPack still owns the operation`);
      return after;
    };

    const source = await probe(() => window.probe.casesJson());
    await page.click('#btn-autopack');
    await page.waitForFunction(count => document.querySelector('.autopack-loading-message')?.textContent ===
      'Placing cargo in the truck...' && window.probe.presentationRemaining() < count, CARGO_COUNT);
    const committed = await probe(() => window.probe.casesJson());
    assert.equal(committed, source, 'INCOMPLETE presentation begins without a Pack commit');

    const empty = await probe(() => window.probe.pointFor(null));
    assert.ok(empty, 'an empty canvas point outside the status card exists');
    const downsBeforeEmpty = await probe(() => window.probe.canvasPointerDowns);
    await noSnap('empty canvas click', () => page.mouse.click(empty.x, empty.y));
    assert.equal(await probe(() => window.probe.canvasPointerDowns), downsBeforeEmpty + 1, 'the scene receives the click');
    assert.deepEqual(await probe(() => window.probe.selection()), [], 'empty click clears selection');

    const card = await probe(() => {
      const r = document.querySelector('.autopack-loading-modal').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const cameraBeforeCard = await probe(() => window.probe.camera());
    const downsBeforeCard = await probe(() => window.probe.canvasPointerDowns);
    await noSnap('status card click', () => page.mouse.click(card.x, card.y));
    assert.equal(await probe(() => window.probe.canvasPointerDowns), downsBeforeCard, 'the card absorbs its own click');
    assert.deepEqual(await probe(() => window.probe.selection()), [], 'status card click selects nothing');
    assert.deepEqual(await probe(() => window.probe.camera()), cameraBeforeCard, 'status card click moves no camera');

    const viewBeforeDrag = await probe(() => window.probe.SceneManager.getEditorView());
    await noSnap('camera drag outside the card', async () => {
      await page.mouse.move(empty.x, empty.y);
      await page.mouse.down();
      await page.mouse.move(empty.x + 140, empty.y + 30, { steps: 8 });
      await page.mouse.up();
    });
    assert.notDeepEqual(await probe(() => window.probe.camera()), viewBeforeDrag.cameraPosition, 'camera orbit still works');
    // Keep the subsequent cargo-click probe truck-facing after the orbit check.
    await page.evaluate(view => window.probe.SceneManager.applyEditorView(view), viewBeforeDrag);

    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await noSnap('Ctrl+A select all', () => page.keyboard.press('Control+a'));
    assert.equal((await probe(() => window.probe.selection())).length, CARGO_COUNT, 'select all selected every case');
    await noSnap('Escape deselect', () => page.keyboard.press('Escape'));
    assert.deepEqual(await probe(() => window.probe.selection()), [], 'Escape cleared the selection');

    // AutoPack keeps authored staging where it was authored, so cargo reaches
    // the visible canvas only as it lands. Wait for one visible, unobstructed
    // cargo that is already at rest (a moving one is gone before the click)
    // while enough animation remains to observe a snap (a batch of margin
    // covers the frames between this probe and noSnap's own check), then assert.
    const found = await page.waitForFunction(min => window.probe.settledCargoPoint() ||
      (window.probe.presentationRemaining() < min ? 'animation exhausted' : null), MIN_REMAINING + BATCH_SIZE);
    const cargo = await found.jsonValue();
    assert.ok(cargo && cargo.id, 'a visible cargo item outside the status card exists');
    await noSnap('cargo click', () => page.mouse.click(cargo.x, cargo.y));
    assert.deepEqual(await probe(() => window.probe.selection()), [cargo.id], 'cargo click selects that case');
    assert.equal(await page.evaluate(id => window.probe.emissive(id), cargo.id), await probe(() => window.probe.accent()),
      'selected highlight updates without a pose re-sync');

    // AutoPack keeps animating on its own schedule, then completes normally.
    const progress = [await presentationRemaining()];
    await page.waitForFunction(() => window.probe.op() === 'idle', null, { timeout: 60000 });
    progress.push(await presentationRemaining());
    assert.ok(progress[0] > 0 && progress[1] === 0, `final layout reached (${progress.join(' -> ')})`);
    assert.equal(await probe(() => window.probe.casesJson()), committed, 'interaction and INCOMPLETE presentation never commit the candidate');
    assert.equal(await probe(() => window.probe.transient()), true, 'the final candidate stays transient');
    assert.equal(await page.locator('[data-tp3d-autopack-loading]').count(), 0, 'status closed by run cleanup');
    assert.ok(await probe(() => (window.probe.StateStore.get('autoPackResults')?.options || []).length > 0), 'Results published');
    assert.deepEqual(await probe(() => window.probe.selection()), [cargo.id], 'selection kept through completion');
    await page.waitForFunction(() => [...document.querySelectorAll('#editor-right button')]
      .some(button => button.textContent.trim() === 'Duplicate'));
    const toasts = await probe(() => window.probe.toasts.slice());
    assert.deepEqual(toasts.filter(text => PROGRESS_TOAST.test(text)), [], 'the status card is the only running-progress channel');
    assert.ok(toasts.some(text => /Needs review\. Review the preferred option before applying\./.test(text)),
      `INCOMPLETE completion requests review (${toasts.join(' | ')})`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('P0-SM-OF-10B a selection change outside the Editor never touches the scene; re-entry renders it', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const probe = fn => page.evaluate(fn);
    const target = 'cargo-7';

    await page.click('#btn-autopack');
    await page.waitForFunction(count => document.querySelector('.autopack-loading-message')?.textContent ===
      'Placing cargo in the truck...' && window.probe.presentationRemaining() < count, CARGO_COUNT);

    // Leave the Editor mid-animation and change the selection while the in-flight
    // batch wait still owns the operation: the busy path must not run off-screen.
    const departed = await page.evaluate(id => {
      const p = window.probe;
      p.AppShell.navigate('packs');
      p.departedAt = performance.now();
      p.departurePoses = p.poses();
      p.countsAtDeparture = { setSelected: p.setSelectedCalls, sync: p.syncCalls };
      p.StateStore.set({ selectedInstanceIds: [id] }, { skipHistory: true });
      return {
        screen: p.StateStore.get('currentScreen'), op: p.op(), selection: p.selection(),
        setSelected: p.setSelectedCalls - p.countsAtDeparture.setSelected, sync: p.syncCalls - p.countsAtDeparture.sync,
      };
    }, target);
    assert.equal(departed.screen, 'packs');
    assert.equal(departed.op, 'autopacking', 'the in-flight batch wait still owns the operation');
    assert.deepEqual(departed.selection, [target]);
    assert.equal(departed.setSelected, 0, 'an off-Editor selection change never touches CaseScene');
    assert.equal(departed.sync, 0, 'an off-Editor selection change never re-syncs the scene');

    // Departure invalidated the run: the operation releases within the batch wait,
    // and nothing deferred fires against the hidden scene when it does.
    await page.waitForFunction(() => window.probe.op() === 'idle', null, { timeout: 5000 });
    await page.waitForTimeout(600);
    const released = await probe(() => {
      const p = window.probe;
      const idle = p.opLog.find(entry => entry.kind === 'idle' && entry.at >= p.departedAt);
      return {
        releaseMs: idle ? idle.at - p.departedAt : null,
        posesUnchanged: p.poses() === p.departurePoses,
        setSelected: p.setSelectedCalls - p.countsAtDeparture.setSelected,
        sync: p.syncCalls - p.countsAtDeparture.sync,
        results: p.StateStore.get('autoPackResults'),
        status: document.querySelectorAll('[data-tp3d-autopack-loading]').length,
      };
    });
    assert.ok(released.releaseMs !== null && released.releaseMs < 1000,
      `the operation is released promptly after departure (${released.releaseMs} ms)`);
    assert.equal(released.posesUnchanged, true, 'no stale scene write after departure');
    assert.equal(released.setSelected, 0, 'no deferred selection render fires off-Editor');
    assert.equal(released.sync, 0, 'no deferred full render fires off-Editor');
    assert.equal(released.results, null, 'a departed run publishes no Results');
    assert.equal(released.status, 0, 'run cleanup closed the status');

    // Re-entering the Editor renders the committed Pack and the current selection.
    await probe(() => window.probe.AppShell.navigate('editor'));
    await page.waitForFunction(() => [...document.querySelectorAll('#editor-right button')]
      .some(button => button.textContent.trim() === 'Duplicate'));
    const back = await page.evaluate(id => ({
      committedRemaining: window.probe.committedRemaining(),
      transient: window.probe.transient(),
      selection: window.probe.selection(),
      emissive: window.probe.emissive(id),
      accent: window.probe.accent(),
      synced: window.probe.syncCalls > window.probe.countsAtDeparture.sync,
      autopackButton: document.getElementById('btn-autopack').textContent.trim(),
    }), target);
    assert.equal(back.synced, true, 're-entry runs the normal Editor render');
    assert.equal(back.committedRemaining, 0, 're-entry shows the committed Pack');
    assert.equal(back.transient, false, 'the departed candidate is not resurrected');
    assert.deepEqual(back.selection, [target]);
    assert.equal(back.emissive, back.accent, 're-entry highlights the current selection');
    assert.equal(back.autopackButton, 'AutoPack', 're-entry shows the idle operation state');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
