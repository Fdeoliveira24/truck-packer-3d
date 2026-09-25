import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// P0-SM-OF-10B: the non-modal AutoPack status keeps the Editor interactive, so
// an interaction during the small-load animation must never re-sync the meshes
// AutoPack is animating to their already-committed poses.
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
// frames the count of instances still short of their committed pose can drop
// by at most one batch more than the elapsed batch periods allow, however long
// a frame stalls; a scene re-sync lands every remaining instance at once.
const BATCH_SIZE = 4;
const BATCH_MS = 276;
const MIN_REMAINING = 12;

const repo = new URL('../../', import.meta.url);
const read = (path, encoding = 'utf8') => readFile(new URL(path, repo), encoding);

const appSource = await read('src/app.js');
const subscriberAnchor = appSource.indexOf("let prevScreen = StateStore.get('currentScreen');");
const subscriberStart = appSource.indexOf('StateStore.subscribe(changes => {', subscriberAnchor);
const subscriberEnd = appSource.indexOf('\n      });\n\n      try {\n        Router.init(', subscriberStart);
assert.ok(subscriberAnchor >= 0 && subscriberStart > subscriberAnchor && subscriberEnd > subscriberStart,
  'app.js StateStore render subscriber is extractable');
const appSubscriber = appSource.slice(subscriberStart + 'StateStore.subscribe('.length, subscriberEnd + '\n      }'.length);

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
import { createCaseScene, createInteractionManager, createEditorScreen } from '/src/screens/editor-screen.js';
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
  PackLibrary, runtimeWindow: window, SceneManager, StateStore, toast() {}, TrailerGeometry, UIComponents, Utils,
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
  const { Storage, StateStore, PreferencesManager, SceneManager, SettingsUI, EditorUI, AutoPackPreviewScheduler,
    PackLibrary, ExportService, AppShell, PacksUI, CasesUI, RecoverableErrorOverlay } = deps;
  const suspendAutoSave = false;
  let prevScreen = StateStore.get('currentScreen');
  return (\${APP_SUBSCRIBER});
\`);
StateStore.subscribe(createAppSubscriber({
  Storage, StateStore, PreferencesManager, SceneManager, SettingsUI: { loadForm() {} }, EditorUI,
  AutoPackPreviewScheduler: { schedule() {} }, PackLibrary, ExportService, AppShell,
  PacksUI: { render() {} }, CasesUI: { render() {} }, RecoverableErrorOverlay: { syncRecoverableErrorOverlay() {} },
}));
AppShell.navigate('editor');
EditorUI.render();

const THREE = window.THREE;
const canvas = () => SceneManager.getRenderer().domElement;
const livePack = () => PackLibrary.getById(packId);
const realSync = CaseScene.sync;
window.probe = {
  syncCalls: 0,
  canvasPointerDowns: 0,
  StateStore, OperationLifecycle, SceneManager, CaseScene,
  op: () => OperationLifecycle.currentOperation().kind,
  selection: () => (StateStore.get('selectedInstanceIds') || []).slice(),
  casesJson: () => JSON.stringify(livePack().cases),
  // Meshes not yet at their committed pose: AutoPack's remaining visual work.
  unplaced() {
    return livePack().cases.filter(inst => {
      const obj = CaseScene.getObject(inst.id);
      return obj && obj.position.distanceTo(SceneManager.vecInchesToWorld(inst.transform.position)) > 0.05;
    }).length;
  },
  // Per-frame landing rate while watching: animation lands batch by batch, so
  // each sample may drop by at most the batches that fit in its elapsed time
  // (plus one in flight); a scene re-sync lands everything at once.
  watch() {
    const state = { last: this.unplaced(), lastAt: performance.now(), maxDrop: 0, maxExcess: -Infinity, running: true };
    const sample = () => {
      const now = this.unplaced();
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
      const v = CaseScene.getObject(id).position.clone().project(camera);
      candidates.push([rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]);
    } else {
      for (let gy = 1; gy < 10; gy += 1) for (let gx = 1; gx < 16; gx += 1) {
        candidates.push([rect.left + (rect.width * gx) / 16, rect.top + (rect.height * gy) / 10]);
      }
    }
    const found = candidates.find(([x, y]) => usable(x, y) && hitAt(x, y) === id);
    return found ? { x: found[0], y: found[1] } : null;
  },
  cargoPoint() {
    for (const inst of livePack().cases) {
      const point = this.pointFor(inst.id);
      if (point) return { id: inst.id, ...point };
    }
    return null;
  },
};
CaseScene.sync = pack => {
  window.probe.syncCalls += 1;
  return realSync(pack);
};
canvas().addEventListener('pointerdown', () => { window.probe.canvasPointerDowns += 1; }, true);
window.__EDITOR_READY = true;
`;

const CONTENT_TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
};
const SERVED = ['/src/', '/styles/', '/vendor/', '/media/', '/node_modules/three/'];

test('P0-SM-OF-10B Editor interaction during an animated AutoPack never re-syncs the animating scene', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
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

    const probe = fn => page.evaluate(fn);
    const unplaced = () => probe(() => window.probe.unplaced());
    // Interact, then prove the interaction caused no scene re-sync and no snap.
    const noSnap = async (label, interact) => {
      const before = await probe(() => {
        window.probe.watch();
        return { unplaced: window.probe.unplaced(), syncs: window.probe.syncCalls };
      });
      assert.ok(before.unplaced >= MIN_REMAINING, `${label}: enough animation remains to observe a snap (${before.unplaced})`);
      await interact();
      const after = await probe(() => ({
        ...window.probe.unwatch(), unplaced: window.probe.unplaced(), syncs: window.probe.syncCalls, op: window.probe.op(),
      }));
      assert.ok(after.maxExcess <= 0,
        `${label}: cargo lands batch by batch, no mass snap (largest one-frame drop ${after.maxDrop}; ${before.unplaced} -> ${after.unplaced})`);
      assert.equal(after.syncs, before.syncs, `${label}: no CaseScene.sync while AutoPack animates`);
      assert.equal(after.op, 'autopacking', `${label}: AutoPack still owns the operation`);
      return after;
    };

    await page.click('#btn-autopack');
    await page.waitForFunction(count => document.querySelector('.autopack-loading-message')?.textContent ===
      'Placing cargo in the truck...' && window.probe.unplaced() < count, CARGO_COUNT);
    const committed = await probe(() => window.probe.casesJson());

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

    const cameraBeforeDrag = await probe(() => window.probe.camera());
    await noSnap('camera drag outside the card', async () => {
      await page.mouse.move(empty.x, empty.y);
      await page.mouse.down();
      await page.mouse.move(empty.x + 140, empty.y + 30, { steps: 8 });
      await page.mouse.up();
    });
    assert.notDeepEqual(await probe(() => window.probe.camera()), cameraBeforeDrag, 'camera orbit still works');

    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await noSnap('Ctrl+A select all', () => page.keyboard.press('Control+a'));
    assert.equal((await probe(() => window.probe.selection())).length, CARGO_COUNT, 'select all selected every case');
    await noSnap('Escape deselect', () => page.keyboard.press('Escape'));
    assert.deepEqual(await probe(() => window.probe.selection()), [], 'Escape cleared the selection');

    const cargo = await probe(() => window.probe.cargoPoint());
    assert.ok(cargo, 'a visible cargo item outside the status card exists');
    await noSnap('cargo click', () => page.mouse.click(cargo.x, cargo.y));
    assert.deepEqual(await probe(() => window.probe.selection()), [cargo.id], 'cargo click selects that case');
    assert.equal(await page.evaluate(id => window.probe.emissive(id), cargo.id), await probe(() => window.probe.accent()),
      'selected highlight updates without a pose re-sync');

    // AutoPack keeps animating on its own schedule, then completes normally.
    const progress = [await unplaced()];
    await page.waitForFunction(() => window.probe.op() === 'idle', null, { timeout: 60000 });
    progress.push(await unplaced());
    assert.ok(progress[0] > 0 && progress[1] === 0, `final layout reached (${progress.join(' -> ')})`);
    assert.equal(await probe(() => window.probe.casesJson()), committed, 'no Pack mutation besides the AutoPack commit');
    assert.equal(await page.locator('[data-tp3d-autopack-loading]').count(), 0, 'status closed by run cleanup');
    assert.ok(await probe(() => (window.probe.StateStore.get('autoPackResults')?.options || []).length > 0), 'Results published');
    assert.deepEqual(await probe(() => window.probe.selection()), [cargo.id], 'selection kept through completion');
    await page.waitForFunction(() => [...document.querySelectorAll('#editor-right button')]
      .some(button => button.textContent.trim() === 'Duplicate'));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
