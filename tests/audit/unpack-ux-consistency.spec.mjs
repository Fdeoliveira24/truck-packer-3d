import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// P0-UNPACK-UX: a successful Unpack discards the packed solution, so the
// AutoPack Results describing it disappear in the same transition; the Pack
// commit is painted by exactly one full Editor render; and organized staging
// uses its own compact edge-to-edge spacing (4 in within a Case type, 8 in
// between Case-type groups) without touching the canonical staging gap.
//
// This drives the REAL Editor runtime in Chromium: index.html markup, main.css,
// three r185, SceneManager, CaseScene, InteractionManager, EditorUI and
// AutoPackEngine with the real solver over PackLibrary/CaseLibrary/StateStore,
// constructed as app.js constructs them, plus app.js's own StateStore
// subscriber and automatic preview scheduler extracted verbatim. The preview
// capture itself (a WebGL readback) is replaced by its StateStore-visible
// effect: a capturingPreview operation that writes the thumbnail fields.
// Disposable in-memory data only: every non-local request is aborted, and
// auth, billing, storage scope and persistence are not involved.

const ORIGIN = 'http://localhost:5598';
const ITEM_GAP = 4;
const GROUP_GAP = 8;
const EPS = 1e-6;

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

// Mixed Case types: small cartons (large group, two rows), long cases (two
// rows), wide cases, tall cases and a one-item group.
const FIXTURE_CASES = [
  { id: 'qa-carton', name: 'QA Carton', dims: { length: 12, width: 10, height: 8 }, qty: 20 },
  { id: 'qa-long', name: 'QA Long', dims: { length: 60, width: 18, height: 16 }, qty: 5 },
  { id: 'qa-wide', name: 'QA Wide', dims: { length: 30, width: 40, height: 20 }, qty: 3 },
  { id: 'qa-tall', name: 'QA Tall', dims: { length: 20, width: 20, height: 50 }, qty: 4 },
  { id: 'qa-single', name: 'QA Single', dims: { length: 24, width: 24, height: 24 }, qty: 1 },
];
const TOTAL = FIXTURE_CASES.reduce((sum, c) => sum + c.qty, 0);

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
import * as CorePackLibrary from '/src/services/pack-library.js';
import { createAutoPackEngine } from '/src/services/autopack-engine.js';
import * as PreferencesManager from '/src/services/preferences-manager.js';

const APP_SUBSCRIBER = ${JSON.stringify(appSubscriber)};
const PREVIEW_SCHEDULER = ${JSON.stringify(previewScheduler)};
const FIXTURE_CASES = ${JSON.stringify(FIXTURE_CASES)};

await window.__TP3D_BOOT.threeReady;
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
const AppShell = createAppShell({ StateStore, PackLibrary, Utils });
SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore });
const CaseScene = createCaseScene({ SceneManager, CaseLibrary, CategoryService, PackLibrary, StateStore, TrailerGeometry, Utils, PreferencesManager });
const OperationLifecycle = createOperationLifecycle();
const InteractionManager = createInteractionManager({ SceneManager, CaseScene, StateStore, PackLibrary, CaseLibrary, PreferencesManager, UIComponents, OperationLifecycle });

// Automatic preview capture as the app runs it: app.js's own scheduler; the
// capture keeps its operation slot, frame wait and thumbnail write, and skips
// only the WebGL readback.
async function capturePackPreview(previewPackId) {
  if (OperationLifecycle.isBusy()) return false;
  const token = OperationLifecycle.beginOperation('capturingPreview', { packId: previewPackId, source: 'auto' });
  if (!token) return false;
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!OperationLifecycle.isCurrent(token) || !PackLibrary.getById(previewPackId)) return false;
    window.probe.log.push({ type: 'previewWrite', at: performance.now() });
    CorePackLibrary.update(previewPackId, {
      thumbnail: 'data:image/jpeg;base64,AAAA', thumbnailUpdatedAt: Date.now(), thumbnailSource: 'auto',
    }, { skipHistory: true });
    return true;
  } finally {
    OperationLifecycle.finishOperation(token);
  }
}
const createPreviewScheduler = new Function(PREVIEW_SCHEDULER + '\\nreturn createPackPreviewScheduler;')();
const AutoPackPreviewScheduler = createPreviewScheduler({
  StateStore, PackLibrary, OperationLifecycle, capturePackPreview, getActiveWorkspaceKey: () => 'fixture-workspace',
});

const ExportService = { captureScreenshot() {}, generatePDF() {}, capturePackPreview, clearPackPreview: () => false };
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

const log = [];
const now = () => performance.now();
// Every full Editor render with an open Pack calls SceneManager.setTruck exactly
// once (render() is its only caller on this path), whoever triggered it.
const realSetTruck = SceneManager.setTruck;
SceneManager.setTruck = (...args) => {
  log.push({ type: 'render', at: now(), op: OperationLifecycle.currentOperation().kind });
  return realSetTruck(...args);
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
  PacksUI: { render() {} }, CasesUI: { render() {} }, RecoverableErrorOverlay: { syncRecoverableErrorOverlay() {} },
}));
OperationLifecycle.subscribe(state => log.push({ type: 'op', at: now(), kind: state.kind }));
AppShell.navigate('editor');
EditorUI.render();

const livePack = () => PackLibrary.getById(StateStore.get('currentPackId'));
window.probe = {
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

// Settle: no operation running and the automatic preview it scheduled written.
async function settle(page) {
  await page.waitForFunction(() => window.probe.op() === 'idle', null, { timeout: 60000 });
  await page.waitForTimeout(700);
  await page.waitForFunction(() => window.probe.op() === 'idle', null, { timeout: 10000 });
}

// AutoPack the fixture with the real engine and wait for published Results.
async function autoPack(page) {
  await page.click('#btn-autopack');
  await page.waitForFunction(() => (window.probe.results()?.options || []).length > 0 && window.probe.op() === 'idle',
    null, { timeout: 60000 });
  await settle(page);
}

function stagedAabb(inst) {
  const { length, width, height } = inst.orientedDims;
  const p = inst.transform.position;
  return {
    min: { x: p.x - length / 2, y: p.y - height / 2, z: p.z - width / 2 },
    max: { x: p.x + length / 2, y: p.y + height / 2, z: p.z + width / 2 },
  };
}

function overlaps(a, b) {
  return a.min.x < b.max.x - EPS && a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS && a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS && a.max.z > b.min.z + EPS;
}

// Edge-to-edge clearances of an organized staging result, measured on the
// occupied AABBs (not on grid origins or centers).
function measureStaging(cases) {
  const groups = new Map();
  for (const inst of cases) {
    if (!groups.has(inst.caseId)) groups.set(inst.caseId, []);
    groups.get(inst.caseId).push(stagedAabb(inst));
  }
  const rowGaps = [];
  const columnGaps = [];
  const bands = [];
  for (const [caseId, aabbs] of groups) {
    const rows = new Map();
    for (const aabb of aabbs) {
      const key = aabb.min.z.toFixed(6);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(aabb);
    }
    const rowList = [...rows.values()].sort((a, b) => a[0].min.z - b[0].min.z);
    rowList.forEach(row => {
      row.sort((a, b) => a.min.x - b.min.x);
      for (let i = 1; i < row.length; i += 1) rowGaps.push(row[i].min.x - row[i - 1].max.x);
    });
    for (let i = 1; i < rowList.length; i += 1) {
      columnGaps.push(Math.min(...rowList[i].map(a => a.min.z)) - Math.max(...rowList[i - 1].map(a => a.max.z)));
    }
    bands.push({
      caseId,
      rows: rowList.length,
      minZ: Math.min(...aabbs.map(a => a.min.z)),
      maxZ: Math.max(...aabbs.map(a => a.max.z)),
      minX: Math.min(...aabbs.map(a => a.min.x)),
      maxX: Math.max(...aabbs.map(a => a.max.x)),
    });
  }
  bands.sort((a, b) => a.minZ - b.minZ);
  const bandGaps = bands.slice(1).map((band, i) => band.minZ - bands[i].maxZ);
  return { rowGaps, columnGaps, bandGaps, bands };
}

function unpackWindow(log) {
  const start = log.findIndex(entry => entry.type === 'op' && entry.kind === 'unpacking');
  const end = log.findIndex((entry, i) => i > start && entry.type === 'op' && entry.kind === 'idle');
  return { start, end, entries: start >= 0 && end > start ? log.slice(start, end + 1) : [] };
}

test('P0-UNPACK-UX successful Unpack clears Results in its one commit render and stages compactly', { timeout: 180000 }, async t => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const probe = fn => page.evaluate(fn);

    await autoPack(page);
    const before = await probe(() => ({
      counts: window.probe.counts(),
      results: window.probe.results(),
      panel: window.probe.panelCount(),
      cases: window.probe.cases(),
    }));
    assert.equal(before.counts.total, TOTAL);
    assert.ok(before.counts.packed > 0, `AutoPack packed cargo (${before.counts.packed}/${TOTAL})`);
    assert.equal(before.results.packId, await probe(() => window.probe.packId), 'Results describe this Pack');
    assert.ok(before.results.options.length > 0, 'Results carry at least one option');
    assert.equal(before.panel, 1, 'the Results panel is visible before Unpack');
    t.diagnostic(`before Unpack: packed ${before.counts.packed}, staged ${before.counts.staged}, results options ${before.results.options.length}`);

    await probe(() => window.probe.mark());
    await page.click('#btn-unpack');
    await page.waitForFunction(() => window.probe.log.some(e => e.type === 'op' && e.kind === 'unpacking') &&
      window.probe.op() === 'idle');
    const atIdle = await probe(() => ({
      log: window.probe.log.slice(),
      results: window.probe.results(),
      panel: window.probe.panelCount(),
      counts: window.probe.counts(),
      cases: window.probe.cases(),
      summary: window.probe.loadSummary(),
      readouts: window.probe.readouts(),
      scene: window.probe.sceneMismatches(),
      button: window.probe.unpackButton(),
      toasts: window.probe.toasts.slice(),
    }));
    const txn = unpackWindow(atIdle.log);
    const count = type => txn.entries.filter(entry => entry.type === type).length;
    t.diagnostic(`Unpack timeline: ${txn.entries.map(e => e.type === 'op' ? `op:${e.kind}` : e.type === 'notify' ? `notify(${e.keys})` : e.type).join(' -> ')}`);
    t.diagnostic(`Unpack transaction: full renders ${count('render')}, CaseScene.sync ${count('sync')}, subscriber renders ${count('subscriberRender')}`);
    t.diagnostic(`after Unpack: Results ${atIdle.results ? `present (${atIdle.results.options.length} options)` : 'null'}, panel ${atIdle.panel}, ` +
      `packed ${atIdle.counts.packed}, staged ${atIdle.counts.staged}`);
    const geometry = measureStaging(atIdle.cases);
    t.diagnostic(`same-type row gaps ${[...new Set(geometry.rowGaps.map(g => g.toFixed(3)))].join(',')}; ` +
      `row-to-row ${[...new Set(geometry.columnGaps.map(g => g.toFixed(3)))].join(',')}; ` +
      `group-to-group ${geometry.bandGaps.map(g => g.toFixed(3)).join(',')}`);

    // One commit notification, painted by the one full render it drives.
    assert.deepEqual(txn.entries.filter(e => e.type === 'notify').map(e => e.keys), ['packLibrary'],
      'the Unpack commit is one StateStore notification');
    assert.equal(count('subscriberRender'), 1, 'the commit notification drives one Editor render');
    assert.equal(count('render'), 1, 'no second full Editor render for the same commit');
    assert.equal(count('sync'), 1, 'one CaseScene.sync for the commit');
    const renderEntry = txn.entries.find(e => e.type === 'render');
    assert.equal(renderEntry.op, 'unpacking', 'the commit render runs inside the Unpack operation');

    // Results discarded with the packed solution, in the same transition.
    assert.equal(atIdle.results, null, 'successful Unpack clears the AutoPack Results state');
    assert.equal(atIdle.panel, 0, 'the Results panel is gone');

    // Authoritative Pack: everything staged, nothing lost or duplicated.
    assert.equal(atIdle.counts.total, TOTAL, 'no Case lost or added');
    assert.equal(new Set(atIdle.counts.ids).size, TOTAL, 'no duplicate instance');
    assert.deepEqual([...atIdle.counts.ids].sort(), [...before.counts.ids].sort(), 'same instance ids');
    assert.equal(atIdle.counts.packed, 0, 'authoritative packed count is 0');
    assert.equal(atIdle.counts.staged, TOTAL, 'every instance is staged');
    assert.deepEqual(atIdle.summary, { inTruck: 0, staged: TOTAL }, 'Load Summary agrees');
    assert.ok(atIdle.readouts.length === FIXTURE_CASES.length &&
      atIdle.readouts.every(text => / 0 in truck /.test(` ${text} `)),
      `Case Browser agrees (${atIdle.readouts.join(' | ')})`);
    assert.deepEqual(atIdle.scene, [], 'scene meshes sit at the committed staged poses');
    assert.equal(atIdle.button, 'Unpack', 'toolbar returns to idle');
    assert.ok(atIdle.toasts.some(text => text.includes(`Moved ${TOTAL} cases to staging.`)), 'completion toast');

    // Only placement fields changed; handling rules / metadata preserved.
    const beforeById = new Map(before.cases.map(inst => [inst.id, inst]));
    for (const inst of atIdle.cases) {
      const prior = beforeById.get(inst.id);
      assert.equal(inst.caseId, prior.caseId);
      assert.equal(inst.hidden, prior.hidden);
      assert.equal(inst.groupId, prior.groupId);
      assert.equal(Object.hasOwn(inst, 'packedProfile'), false, 'no packed profile after Unpack');
      assert.deepEqual(inst.transform.rotation, { x: 0, y: 0, z: 0 }, 'canonical staging rotation');
      assert.deepEqual(inst.transform.scale, prior.transform.scale);
      const spec = FIXTURE_CASES.find(c => c.id === inst.caseId);
      assert.deepEqual(inst.orientedDims, spec.dims, 'canonical effective dimensions');
      assert.equal(inst.transform.position.y, spec.dims.height / 2, 'resting on the staging floor');
    }

    // Compact organized staging, measured edge to edge on occupied bounds.
    const aabbs = atIdle.cases.map(stagedAabb);
    for (let a = 0; a < aabbs.length; a += 1) {
      for (let b = a + 1; b < aabbs.length; b += 1) {
        assert.equal(overlaps(aabbs[a], aabbs[b]), false, `staged ${atIdle.cases[a].id} / ${atIdle.cases[b].id} overlap`);
      }
    }
    assert.ok(geometry.rowGaps.length > 0 && geometry.columnGaps.length > 0, 'fixture exercises columns and rows');
    for (const gap of [...geometry.rowGaps, ...geometry.columnGaps]) {
      assert.ok(Math.abs(gap - ITEM_GAP) < EPS, `same-type edge gap ${gap} is ${ITEM_GAP} in`);
    }
    assert.equal(geometry.bandGaps.length, FIXTURE_CASES.length - 1, 'one band per Case type');
    for (const gap of geometry.bandGaps) {
      assert.ok(Math.abs(gap - GROUP_GAP) < EPS, `group-to-group edge gap ${gap} is ${GROUP_GAP} in`);
    }
    const footprints = geometry.bands.map(band => {
      const spec = FIXTURE_CASES.find(c => c.id === band.caseId);
      return spec.dims.length * spec.dims.width;
    });
    assert.deepEqual(footprints, [...footprints].sort((a, b) => b - a), 'larger footprints stay nearest the truck');
    const truck = { length: 240, width: 96 };
    assert.ok(Math.abs(geometry.bands[0].minZ - (truck.width / 2 + 12)) < EPS,
      'the first group starts at the canonical staging origin');
    assert.ok(geometry.bands.every(band => band.minX >= -EPS && band.maxX <= truck.length + EPS),
      'every group stays within the canonical staging strip');

    // The remaining render comes from the automatic preview write, after the
    // Unpack operation released the slot.
    await page.waitForFunction(() => window.probe.log.some(e => e.type === 'previewWrite'), null, { timeout: 10000 });
    await settle(page);
    const after = await probe(() => window.probe.log.slice());
    const idleAt = unpackWindow(after).end;
    const later = after.slice(idleAt + 1);
    t.diagnostic(`after Unpack released: ${later.map(e => e.type === 'op' ? `op:${e.kind}` : e.type === 'notify' ? `notify(${e.keys})` : e.type).join(' -> ')}`);
    const previewWrite = later.findIndex(e => e.type === 'previewWrite');
    assert.ok(previewWrite >= 0, 'the automatic preview capture ran after Unpack');
    assert.equal(later.slice(0, previewWrite).filter(e => e.type === 'render').length, 0,
      'no render between the Unpack release and the preview write');
    assert.equal(later.slice(previewWrite).filter(e => e.type === 'render').length, 1,
      'the preview subsystem write drives one further render (P0-Preview Integrity)');
    assert.equal(await probe(() => window.probe.results()), null, 'Results stay cleared');

    // Undo restores the packed cargo in one step; generated Results are not
    // reconstructed. Redo stages it again.
    const undone = await probe(() => {
      window.probe.StateStore.undo();
      return { cases: window.probe.cases(), results: window.probe.results(), panel: window.probe.panelCount() };
    });
    assert.deepEqual(undone.cases, before.cases, 'one Undo restores the packed Pack exactly');
    assert.equal(undone.results, null, 'Undo does not reconstruct AutoPack Results');
    assert.equal(undone.panel, 0);
    const redone = await probe(() => {
      window.probe.StateStore.redo();
      return { cases: window.probe.cases(), results: window.probe.results() };
    });
    assert.deepEqual(redone.cases, atIdle.cases, 'one Redo restores the staged Pack exactly');
    assert.equal(redone.results, null);
    await settle(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('P0-UNPACK-UX a rejected or failed Unpack keeps the Pack and its Results intact', { timeout: 180000 }, async t => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const probe = fn => page.evaluate(fn);
    await autoPack(page);
    const baseline = await probe(() => ({ results: window.probe.resultsJson(), cases: window.probe.casesJson() }));
    assert.ok(JSON.parse(baseline.results).options.length > 0);

    const expectIntact = async label => {
      await page.waitForFunction(() => window.probe.op() === 'idle');
      const state = await probe(() => ({
        results: window.probe.resultsJson(),
        cases: window.probe.casesJson(),
        panel: window.probe.panelCount(),
        renders: window.probe.log.filter(e => e.type === 'render').length,
        notifies: window.probe.log.filter(e => e.type === 'notify' && e.keys !== 'selectedInstanceIds').map(e => e.keys),
        toasts: window.probe.toasts.slice(),
      }));
      assert.equal(state.results, baseline.results, `${label}: Results unchanged`);
      assert.equal(state.cases, baseline.cases, `${label}: Pack unchanged, no partial staging`);
      return state;
    };

    // 1. Operation acquisition rejected: another operation owns the slot.
    await probe(() => {
      window.probe.mark();
      window.probe.heldToken = window.probe.OperationLifecycle.beginOperation('changingTruck', { packId: window.probe.packId });
      document.getElementById('btn-unpack').disabled = false;
      document.getElementById('btn-unpack').click();
    });
    await page.waitForTimeout(100);
    const rejected = await probe(() => ({
      op: window.probe.op(),
      renders: window.probe.log.filter(e => e.type === 'render').length,
      notifies: window.probe.log.filter(e => e.type === 'notify').length,
      toasts: window.probe.toasts.slice(),
      results: window.probe.resultsJson(),
      cases: window.probe.casesJson(),
      panel: window.probe.panelCount(),
    }));
    assert.equal(rejected.op, 'changingTruck', 'rejected Unpack never takes the slot');
    assert.equal(rejected.renders, 0, 'rejected Unpack renders nothing');
    assert.equal(rejected.notifies, 0, 'rejected Unpack writes no state');
    assert.ok(rejected.toasts.some(text => text.includes('Another operation is in progress')));
    assert.equal(rejected.results, baseline.results, 'rejected: Results unchanged');
    assert.equal(rejected.cases, baseline.cases, 'rejected: Pack unchanged');
    assert.equal(rejected.panel, 1, 'rejected: Results panel still shown');
    await probe(() => window.probe.OperationLifecycle.finishOperation(window.probe.heldToken));
    await page.waitForFunction(() => window.probe.op() === 'idle');

    // 2. Pack becomes stale before commit: the user leaves during the frame yield.
    await probe(() => {
      window.probe.mark();
      document.getElementById('btn-unpack').click();
      window.probe.AppShell.navigate('packs');
    });
    const stale = await expectIntact('stale before commit');
    assert.equal(stale.notifies.includes('packLibrary'), false, 'stale Unpack commits nothing');
    assert.equal(stale.toasts.some(text => text.includes('to staging.')), false, 'no completion toast');
    await probe(() => window.probe.AppShell.navigate('editor'));
    await page.waitForFunction(() => window.probe.panelCount() === 1);

    // 3. The authoritative Pack update throws.
    await probe(() => {
      window.probe.mark();
      window.probe.faults.update = () => { throw new Error('injected update failure'); };
      document.getElementById('btn-unpack').click();
    });
    const threw = await expectIntact('update throws');
    assert.equal(threw.renders, 0, 'failed update renders nothing');
    assert.deepEqual(threw.notifies, [], 'failed update notifies nothing');
    assert.equal(threw.panel, 1, 'failed update: Results panel still shown');
    assert.ok(threw.toasts.some(text => text.includes('Unpack failed')), 'failure is reported');

    // 4. The authoritative Pack update refuses (no committed Pack).
    await probe(() => {
      window.probe.mark();
      window.probe.faults.update = () => null;
      document.getElementById('btn-unpack').click();
    });
    const refused = await expectIntact('update refuses');
    assert.equal(refused.renders, 0, 'refused update renders nothing');
    assert.deepEqual(refused.notifies, [], 'refused update notifies nothing');
    assert.equal(refused.toasts.some(text => text.includes('to staging.')), false, 'no completion toast');

    // 5. Staging layout cannot be built: nothing moves to staging, so the
    // packed solution was not discarded and its Results stay.
    await probe(() => {
      window.probe.mark();
      window.probe.faults.getStagingLayout = () => ({});
      document.getElementById('btn-unpack').click();
    });
    await page.waitForFunction(() => window.probe.log.some(e => e.type === 'op' && e.kind === 'unpacking') &&
      window.probe.op() === 'idle');
    const unbuilt = await probe(() => ({
      results: window.probe.resultsJson(),
      counts: window.probe.counts(),
      panel: window.probe.panelCount(),
      toasts: window.probe.toasts.slice(),
    }));
    assert.equal(unbuilt.results, baseline.results, 'no staged move: Results unchanged');
    assert.equal(unbuilt.panel, 1, 'no staged move: Results panel still shown');
    assert.ok(unbuilt.toasts.some(text => text.includes('Moved 0 cases to staging.')));
    t.diagnostic(`layout failure: packed ${unbuilt.counts.packed}, staged ${unbuilt.counts.staged}`);

    await settle(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('P0-UNPACK-UX Unpack keeps Results that describe a different Pack', { timeout: 180000 }, async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openEditor(browser);
    const probe = fn => page.evaluate(fn);
    await autoPack(page);
    const results = await probe(() => window.probe.resultsJson());
    // Open the other Pack, give it cargo, and Unpack it.
    await probe(() => {
      const p = window.probe;
      p.StateStore.set({ currentPackId: p.otherPackId, selectedInstanceIds: [] }, { skipHistory: true });
      p.CorePackLibrary.update(p.otherPackId, { cases: [{
        id: 'other-1', caseId: 'qa-single', hidden: false, groupId: null, placement: 'packed',
        transform: { position: { x: 12, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      }] });
      p.mark();
    });
    await settle(page);
    await probe(() => window.probe.mark());
    await page.click('#btn-unpack');
    await page.waitForFunction(() => window.probe.log.some(e => e.type === 'op' && e.kind === 'unpacking') &&
      window.probe.op() === 'idle');
    assert.equal(await probe(() => window.probe.counts().staged), 1, 'the other Pack was unpacked');
    assert.equal(await probe(() => window.probe.resultsJson()), results,
      'Results that describe another Pack are not the solution this Unpack discarded');
    await settle(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
