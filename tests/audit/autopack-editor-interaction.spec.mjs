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
const realSetSelected = CaseScene.setSelected;
window.probe = {
  syncCalls: 0,
  setSelectedCalls: 0,
  canvasPointerDowns: 0,
  toasts: [],
  opLog: [],
  StateStore, OperationLifecycle, SceneManager, CaseScene, AppShell, UIComponents, EditorUI, CaseLibrary,
  op: () => OperationLifecycle.currentOperation().kind,
  selection: () => (StateStore.get('selectedInstanceIds') || []).slice(),
  casesJson: () => JSON.stringify(livePack().cases),
  poses: () => JSON.stringify(livePack().cases.map(inst => CaseScene.getObject(inst.id).position.toArray())),
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

    const names = await page.locator('#editor-right select, #editor-right input[type="number"]').evaluateAll(elements =>
      elements.slice(0, 7).map(el => ({ name: el.labels?.[0]?.textContent?.trim() || '', id: el.id })));
    assert.ok(names.every(item => item.name && item.id), 'Inspector controls have native labels');

    await page.locator('[data-focus-key="instance-chooser"]').selectOption('cargo-7');
    assert.deepEqual(await page.evaluate(() => window.probe.selection()), ['cargo-7']);
    assert.equal(await page.locator('[data-focus-key="instance-chooser"]').inputValue(), 'cargo-7');
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
    // First Escape closes only the filter popup; the drawer closes on the next one.
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editor-case-filters-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor-case-filters-toggle');
    assert.equal(await page.locator('#btn-editor-left').getAttribute('aria-expanded'), 'true');
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
    await preset.selectOption({ index: 1 });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'truck-preset');
    const shape = page.locator('[data-focus-key="truck-shape"]');
    await shape.focus();
    await shape.selectOption('wheelWells');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'truck-shape');

    await page.locator('[data-role="editor-new-case"]').click();
    assert.equal(await page.locator('#toast-container').evaluate(el => el.parentElement === document.body), true);
    const fields = await page.locator('.modal input[required], .modal select').evaluateAll(elements =>
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
          primary: ratio(primary.color, primary.backgroundColor),
          label: ratio(label.color, panel.backgroundColor),
          focus: ratio(input.outlineColor, panel.backgroundColor),
        };
      });
    });
    for (const sample of contrast) {
      assert.ok(sample.primary >= 4.5, `${sample.theme} primary text contrast ${sample.primary}`);
      assert.ok(sample.label >= 4.5, `${sample.theme} dimension label contrast ${sample.label}`);
      assert.ok(sample.focus >= 3, `${sample.theme} focus contrast ${sample.focus}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Editor fixture preserves AutoPack Results focus through controls and close', { timeout: 120000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    await page.locator('#btn-autopack').click();
    await page.waitForFunction(() => window.probe.op() === 'idle' &&
      (window.probe.StateStore.get('autoPackResults')?.options || []).length > 0, null, { timeout: 90000 });
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
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-autopack');
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
    await page.waitForTimeout(350);
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
    const toasts = await probe(() => window.probe.toasts.slice());
    assert.deepEqual(toasts.filter(text => PROGRESS_TOAST.test(text)), [], 'the status card is the only running-progress channel');
    assert.ok(toasts.some(text => /Packed \d+ of \d+ cases/.test(text)), `completion toast remains (${toasts.join(' | ')})`);
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
      'Placing cargo in the truck...' && window.probe.unplaced() < count, CARGO_COUNT);

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
      unplaced: window.probe.unplaced(),
      selection: window.probe.selection(),
      emissive: window.probe.emissive(id),
      accent: window.probe.accent(),
      synced: window.probe.syncCalls > window.probe.countsAtDeparture.sync,
      autopackButton: document.getElementById('btn-autopack').textContent.trim(),
    }), target);
    assert.equal(back.synced, true, 're-entry runs the normal Editor render');
    assert.equal(back.unplaced, 0, 're-entry shows the committed Pack');
    assert.deepEqual(back.selection, [target]);
    assert.equal(back.emissive, back.accent, 're-entry highlights the current selection');
    assert.equal(back.autopackButton, 'AutoPack', 're-entry shows the idle operation state');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
