import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Annotations V1A interaction contract.
//
// Drives the REAL Editor runtime in Chromium, the way measurement-tool-interaction.spec.mjs does:
// index.html markup, main.css, three r185 + OrbitControls, SceneManager, CaseScene, the real
// InteractionManager/EditorUI/KeyboardManager wired with the real AnnotationTool, and app.js's own
// StateStore render subscriber extracted verbatim. Disposable in-memory data only: every non-local
// request is aborted and auth, billing, storage scope and persistence are not involved.

const ORIGIN = 'http://localhost:5597';
const repo = new URL('../../', import.meta.url);
const read = (path, encoding = 'utf8') => readFile(new URL(path, repo), encoding);

const appSource = await read('src/app.js');
const subscriberAnchor = appSource.indexOf("let prevScreen = StateStore.get('currentScreen');");
const subscriberStart = appSource.indexOf('StateStore.subscribe(', subscriberAnchor);
const subscriberEnd = appSource.indexOf('\n      });\n\n      try {\n        Router.init(', subscriberStart);
assert.ok(subscriberAnchor >= 0 && subscriberStart > subscriberAnchor && subscriberEnd > subscriberStart,
  'app.js StateStore render subscriber is extractable');
const appSubscriber = appSource.slice(subscriberStart + 'StateStore.subscribe('.length, subscriberEnd + '\n      }'.length);
assert.match(appSubscriber, /notification\?\.type === 'pack-annotations'\) \{\s*PacksUI\.render\(\);\s*EditorUI\.syncAnnotations\(\);\s*AutoPackPreviewScheduler\.schedule\(\);\s*return;/,
  'an annotation-only write refreshes the card and the overlay without a scene or Inspector render, and re-requests the preview freshness check');

const importMap = JSON.stringify({
  imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' },
});
const rawIndex = await read('index.html');
assert.ok(rawIndex.includes('<head>'), 'index.html head is present');
const indexHtml = rawIndex.replace('<head>', `<head><script type="importmap">${importMap}</script>`);

const bootstrap = `
import { createUIComponents } from '/src/ui/ui-components.js';
import { createKeyboardManager } from '/src/ui/keyboard-manager.js';
import { createAppShell } from '/src/ui/app-shell.js';
import { createOperationLifecycle } from '/src/core/operation-lifecycle.js';
import { TrailerPresets } from '/src/data/trailer-presets.js';
import { createSceneRuntime } from '/src/editor/scene-runtime.js';
import { createTrailerGeometry } from '/src/editor/trailer-geometry.js';
import { createMeasurementTool } from '/src/editor/measurement-tool.js';
import { createAnnotationTool } from '/src/editor/annotation-tool.js';
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
import * as M from '/src/core/measurements.js';
import * as A from '/src/core/annotations.js';

const APP_SUBSCRIBER = ${JSON.stringify(appSubscriber)};

await window.__TP3D_BOOT.threeReady;
const UIComponents = createUIComponents();
const Utils = { ...CoreUtils, ...BrowserUtils };
const StateStore = {
  init: CoreStateStore.init, get: CoreStateStore.get, set: CoreStateStore.set, replace: CoreStateStore.replace,
  snapshot: CoreStateStore.snapshot, resetHistory: CoreStateStore.resetHistory, undo: CoreStateStore.undo,
  redo: CoreStateStore.redo, subscribe: CoreStateStore.subscribe,
};

const cases = Defaults.seedCases().slice(0, 2);
cases.forEach(c => { c.volume = Utils.volumeInCubicInches(c.dimensions); });
const packId = 'fixture-pack';
const packed = (id, caseData, x, z) => ({
  id, caseId: caseData.id, hidden: false, groupId: null, placement: 'packed',
  transform: { position: { x, y: caseData.dimensions.height / 2, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
});
StateStore.init({
  currentScreen: 'editor', currentPackId: packId, selectedInstanceIds: [], caseLibrary: cases,
  packLibrary: [{ id: packId, title: 'Fixture', truck: { length: 636, width: 102, height: 110, shapeMode: 'rect' },
    cases: [packed('cargo-a', cases[0], 70, -20), packed('cargo-b', cases[1], 300, 20)], groups: [], createdAt: 1, lastEdited: 1 }],
  folderLibrary: [], preferences: { ...Defaults.defaultPreferences, ...(window.__TEST_PREFERENCES || {}) },
});

let SceneManager = null;
const TrailerGeometry = createTrailerGeometry({ Utils, CorePackLibrary: PackLibrary, getSceneManager: () => SceneManager });
const AppShell = createAppShell({ StateStore, PackLibrary, Utils });
SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore });
const CaseScene = createCaseScene({ SceneManager, CaseLibrary, CategoryService, PackLibrary, StateStore, TrailerGeometry, Utils, PreferencesManager });
const OperationLifecycle = createOperationLifecycle();
const MeasurementTool = createMeasurementTool({ SceneManager, CaseScene, CaseLibrary, PackLibrary, StateStore, PreferencesManager, UIComponents, OperationLifecycle });
const AnnotationTool = createAnnotationTool({ SceneManager, CaseScene, CaseLibrary, PackLibrary, StateStore, PreferencesManager, UIComponents, OperationLifecycle });
const InteractionManager = createInteractionManager({ SceneManager, CaseScene, StateStore, PackLibrary, CaseLibrary, PreferencesManager, UIComponents, OperationLifecycle, MeasurementTool, AnnotationTool });
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
  CaseScene, InteractionManager, TruckChangeController, OperationLifecycle, MeasurementTool, AnnotationTool,
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

const canvas = () => SceneManager.getRenderer().domElement;
const livePack = () => PackLibrary.getById(packId);
window.probe = {
  StateStore, OperationLifecycle, SceneManager, CaseScene, PackLibrary, CaseLibrary, InteractionManager, MeasurementTool, AnnotationTool, EditorUI, PreferencesManager, M, A, UIComponents,
  annotations: () => PackLibrary.getAnnotations(packId),
  resolved: () => PackLibrary.resolveAnnotations(packId),
  hint: () => { const el = document.querySelector('.tp3d-annot-panel__hint'); return el ? el.textContent : ''; },
  selection: () => (StateStore.get('selectedInstanceIds') || []).slice(),
  casesJson: () => JSON.stringify(livePack().cases),
  cargoIds: () => livePack().cases.map(c => c.id),
  camera() { const p = SceneManager.getCamera().position; return [p.x, p.y, p.z].map(n => +n.toFixed(4)).join(','); },
  // Screen point (client px) of a point given in Load Plan inches.
  screenOf(x, y, z) {
    const rect = canvas().getBoundingClientRect();
    const v = SceneManager.vecInchesToWorld({ x, y, z }).project(SceneManager.getCamera());
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  },
  // Screen point of a cargo's centre: the ray through it meets that cargo's own surface first.
  cargoPoint(id) {
    const rect = canvas().getBoundingClientRect();
    const v = CaseScene.getObject(id).position.clone().project(SceneManager.getCamera());
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  },
  sceneObjectCount() { let n = 0; SceneManager.getScene().traverse(() => { n += 1; }); return n; },
  canvasData() {
    const r = SceneManager.getRenderer();
    r.render(SceneManager.getScene(), SceneManager.getCamera());
    return canvas().toDataURL();
  },
  box: selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
  },
};
window.__EDITOR_READY = true;
`;

const CONTENT_TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
};
const SERVED = ['/src/', '/styles/', '/vendor/', '/media/', '/node_modules/three/'];

async function openEditor(browser, viewport = { width: 1400, height: 900 }, { preferences = null } = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(30000);
  // Preferences as they would have been stored before this boot (a "reload" with a saved choice).
  if (preferences) await page.addInitScript(stored => { window.__TEST_PREFERENCES = stored; }, preferences);
  const errors = [];
  page.on('pageerror', error => errors.push(`${error.message}\n${error.stack}`));
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
  await page.waitForFunction(() => document.querySelector('#viewport canvas') && window.probe.SceneManager.getCamera());
  return { page, errors };
}

const launch = () => chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const point = (page, x, y, z) => page.evaluate(([px, py, pz]) => window.probe.screenOf(px, py, pz), [x, y, z]);
const count = page => page.evaluate(() => window.probe.annotations().length);
const click = async (page, p) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); };
const GROUND_A = [100, 0, 70];
const GROUND_B = [260, 0, 80];

// Seed callouts through the real PackLibrary write path (not the creation UI): `{ title, ground: [x, z] }` or
// `{ title, cargo: id, local }`. Returns the stored records.
const seed = (page, specs) => page.evaluate(list => list.map(spec => {
  const { M, PackLibrary, CaseLibrary } = window.probe;
  const pack = PackLibrary.getById('fixture-pack');
  let anchor;
  if (spec.ground) {
    anchor = M.buildSpaceAnchor({ surface: 'ground', point: { x: spec.ground[0], y: 0, z: spec.ground[1] } });
  } else {
    const inst = pack.cases.find(c => c.id === spec.cargo);
    anchor = M.buildCargoAnchor({ instanceId: inst.id, local: spec.local, caseData: CaseLibrary.getById(inst.caseId) });
  }
  const outcome = PackLibrary.addCallout('fixture-pack', { anchor, title: spec.title, description: spec.description || null, color: spec.color, keepExpanded: Boolean(spec.keepExpanded), offset: spec.offset || null });
  if (!outcome.ok) throw new Error(`seed failed: ${outcome.reason}`);
  return outcome.annotation;
}), specs);
const TOP_OF_A = { cargo: 'cargo-a', local: { x: 0, y: 16, z: 0 } };
// Off-centre, so a click at the cargo's centre reaches the canvas and not this marker.
const TOP_OF_B = { cargo: 'cargo-b', local: { x: 14, y: 12, z: -14 } };

// A page with the Annotations panel open and no tool armed.
async function openPanel(browser, viewport) {
  const opened = await openEditor(browser, viewport);
  await opened.page.click('#btn-editor-annotations');
  await opened.page.waitForFunction(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed') === 'true');
  return opened;
}
// The editor card is created the first time it is needed.
const editorClosed = page => page.evaluate(() => { const el = document.querySelector('.tp3d-annot-editor'); return !el || el.hidden; });
const escapeConsumed = page => page.evaluate(() => {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.getElementById('viewport').dispatchEvent(ev);
  return ev.defaultPrevented;
});
// The first candidate ground point whose screen position is the canvas itself (not a card, the editor or the panel).
async function freePoint(page, candidates) {
  for (const candidate of candidates) {
    const at = await point(page, ...candidate);
    const free = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('#viewport canvas'), at);
    if (free) return at;
  }
  throw new Error('no uncovered point');
}
const pinCentreOf = (page, selector = '.tp3d-annot-pin:not(.is-draft)') => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, selector);

// A page with the Annotations panel open and the Callout tool armed (the camera is settled so picks work).
async function openArmed(browser, viewport) {
  const opened = await openEditor(browser, viewport);
  const { page } = opened;
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed') === 'true');
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await page.waitForFunction(() => /place a callout/i.test(window.probe.hint()));
  return opened;
}

// Click the scene to start a callout, fill the editor card and save it. Returns the saved record.
async function addCallout(page, at, title, extra = {}) {
  const before = await count(page);
  await click(page, at);
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', title);
  if (extra.description) await page.fill('.tp3d-annot-editor__textarea', extra.description);
  if (extra.color) await page.click(`.tp3d-annot-swatch[data-color="${extra.color}"]`);
  if (extra.keepExpanded) await page.check('.tp3d-annot-editor__keep input');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(n => window.probe.annotations().length === n + 1, before);
  return page.evaluate(() => window.probe.annotations().at(-1));
}

test('the Annotations control is the first button of the stack and opens a compact panel with the three tool slots', { timeout: 90000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openEditor(browser);
  const stack = await page.locator('#editor-zoom-controls > button').evaluateAll(buttons => buttons.map(b => b.id));
  assert.deepEqual(stack, ['btn-editor-annotations', 'btn-editor-measure', 'btn-editor-view', 'btn-editor-zoom-in', 'btn-editor-zoom-out']);
  assert.equal(await page.locator('#btn-editor-annotations i').getAttribute('class'), 'fa-solid fa-marker');
  assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').hidden), true, 'closed until asked for');

  await page.click('#btn-editor-annotations');
  assert.equal(await page.evaluate(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed')), 'true');
  const panel = await page.evaluate(() => ({
    hidden: document.getElementById('editor-annotation-panel').hidden,
    title: document.querySelector('.tp3d-annot-panel__title').textContent,
    badgeShown: getComputedStyle(document.querySelector('.tp3d-annot-panel__count')).display !== 'none',
    tools: [...document.querySelectorAll('.tp3d-annot-seg--tools .tp3d-annot-seg__btn')].map(b => ({ tool: b.dataset.tool, disabled: b.disabled, pressed: b.getAttribute('aria-pressed') })),
    show: [...document.querySelectorAll('.tp3d-annot-seg--show .tp3d-annot-seg__btn')].map(b => [b.textContent, b.getAttribute('aria-pressed')]),
    display: [...document.querySelectorAll('.tp3d-annot-seg--display .tp3d-annot-seg__btn')].map(b => [b.textContent, b.getAttribute('aria-pressed')]),
    empty: !document.querySelector('.tp3d-annot-panel__empty').hidden,
  }));
  assert.equal(panel.hidden, false);
  assert.equal(panel.title, 'Annotations');
  assert.equal(panel.badgeShown, false, 'no count badge while there are no annotations');
  assert.deepEqual(panel.tools.map(t => t.tool), ['callout', 'arrow', 'draw']);
  assert.deepEqual(panel.tools.map(t => t.disabled), [false, false, true], 'Callout and Arrow are available; Draw is clearly unavailable');
  assert.deepEqual(panel.show, [['All', 'true'], ['Selected', 'false'], ['Off', 'false']]);
  assert.deepEqual(panel.display, [['Markers', 'true'], ['Labels', 'false'], ['Cards', 'false']]);
  assert.equal(panel.empty, true);
  assert.deepEqual(errors, []);
});

test('creating a callout: a click opens the editor, Cancel writes nothing, Save writes exactly one record and cargo, camera and Undo are untouched', { timeout: 120000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  const before = await page.evaluate(() => ({ cases: window.probe.casesJson(), camera: window.probe.camera(), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited }));

  // A click on the ground starts a callout: the editor opens with focus in the title, Save needs a title.
  await click(page, await point(page, ...GROUND_A));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('tp3d-annot-editor__input')), true, 'focus starts in the title');
  assert.equal(await page.locator('.tp3d-annot-btn--primary').isDisabled(), true, 'Save needs a title');
  assert.match(await page.locator('.tp3d-annot-editor__target-text').textContent(), /Attached to Ground/);
  assert.equal(await page.evaluate(() => !document.querySelector('.tp3d-annot-pin.is-draft').hidden), true, 'a temporary marker shows where it will attach');
  assert.equal(await count(page), 0, 'nothing is stored while the card is open');

  // Cancel (Escape from the title field) writes nothing and leaves the Load Plan exactly as it was.
  await page.keyboard.type('Draft');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tp3d-annot-editor', { state: 'hidden' });
  assert.equal(await count(page), 0);
  assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited), before.edited, 'cancelling never edits the Load Plan');
  assert.equal(await page.evaluate(() => !!document.querySelector('.tp3d-annot-pin.is-draft') && document.querySelector('.tp3d-annot-pin.is-draft').hidden), true);
  assert.match(await page.evaluate(() => window.probe.hint()), /place a callout/i, 'the tool stays armed');

  // Save creates exactly one persistent annotation.
  const saved = await addCallout(page, await point(page, ...GROUND_A), '  Unload   first ', { description: 'Rear doors', color: 'blue', keepExpanded: true });
  assert.equal(await count(page), 1);
  assert.deepEqual([saved.type, saved.title, saved.description, saved.color, saved.keepExpanded, saved.hidden, saved.offset], ['callout', 'Unload first', 'Rear doors', 'blue', true, false, null]);
  assert.deepEqual([saved.anchor.kind, saved.anchor.surface], ['space', 'ground'], 'the ground outside any cargo is a supported anchor');
  assert.equal(await page.evaluate(() => window.probe.casesJson()), before.cases, 'cargo is never moved');
  assert.equal(await page.evaluate(() => window.probe.camera()), before.camera, 'placing never orbits the camera');
  assert.ok(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited) > before.edited, 'lastEdited is updated');
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'no cargo Undo step was created');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'cargo selection is untouched');

  // The saved callout is selected: its card is expanded, the marker numbered, the list row present.
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  const view = await page.evaluate(() => ({
    card: document.querySelector('.tp3d-annot-card.is-selected .tp3d-annot-card__title').textContent,
    desc: document.querySelector('.tp3d-annot-card.is-selected .tp3d-annot-card__desc').textContent,
    target: document.querySelector('.tp3d-annot-card.is-selected .tp3d-annot-card__target').textContent,
    pin: document.querySelector('.tp3d-annot-pin.is-selected .tp3d-annot-pin__badge').textContent,
    rows: document.querySelectorAll('.tp3d-annot-row').length,
    badge: document.querySelector('.tp3d-annot-panel__count').textContent,
    hint: window.probe.hint(),
  }));
  assert.deepEqual(view, { card: 'Unload first', desc: 'Rear doors', target: 'Ground', pin: '1', rows: 1, badge: '1', hint: 'Callout saved to Ground.' });
  assert.deepEqual(errors, []);
});

test('presets only fill editable text, and the card can be reopened to change it', { timeout: 120000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  await click(page, await point(page, ...GROUND_A));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.click('.tp3d-annot-chip:has-text("Heavy")');
  assert.equal(await page.inputValue('.tp3d-annot-editor__input'), 'HEAVY');
  assert.match(await page.inputValue('.tp3d-annot-editor__textarea'), /Use two people or a lift/);
  assert.equal(await page.getAttribute('.tp3d-annot-chip:has-text("Heavy")', 'aria-pressed'), 'true');
  await page.fill('.tp3d-annot-editor__input', 'HEAVY — LEFT SIDE');
  assert.equal(await page.getAttribute('.tp3d-annot-chip:has-text("Heavy")', 'aria-pressed'), 'false', 'editing the title detaches it from the preset');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  const [saved] = await page.evaluate(() => window.probe.annotations());
  assert.equal(saved.title, 'HEAVY — LEFT SIDE');
  assert.equal(Object.keys(saved).includes('preset'), false, 'the preset is never stored');

  // Edit from the card: the same record changes, the anchor does not.
  await page.click('.tp3d-annot-card.is-selected [data-act="edit"]');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  assert.equal(await page.inputValue('.tp3d-annot-editor__input'), 'HEAVY — LEFT SIDE');
  assert.equal(await page.locator('.tp3d-annot-editor__heading').textContent(), 'Edit callout');
  await page.fill('.tp3d-annot-editor__input', 'HEAVY');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations()[0].title === 'HEAVY');
  const [edited] = await page.evaluate(() => window.probe.annotations());
  assert.deepEqual([edited.id, edited.anchor, edited.createdAt], [saved.id, saved.anchor, saved.createdAt]);
  assert.equal(await count(page), 1);
  assert.deepEqual(errors, []);
});

test('a callout on cargo is anchored to that instance and follows it when the cargo moves; the record never changes', { timeout: 120000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  const saved = await addCallout(page, await page.evaluate(() => window.probe.cargoPoint('cargo-a')), 'On the case');
  assert.equal(saved.anchor.kind, 'cargo');
  assert.equal(saved.anchor.instanceId, 'cargo-a', 'the instance ID, never the Case ID');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'a click on cargo with the tool armed never selects it');

  const pinCentre = () => page.evaluate(() => {
    const r = document.querySelector('.tp3d-annot-pin:not(.is-draft)').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const expected = () => page.evaluate(() => {
    const [r] = window.probe.resolved();
    return window.probe.screenOf(r.point.x, r.point.y, r.point.z);
  });
  const near = (a, b, tol = 2.5) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
  await page.waitForSelector('.tp3d-annot-pin.is-selected:not(.is-draft)');
  assert.ok(near(await pinCentre(), await expected()), 'the marker sits on the picked surface point');

  const record = JSON.stringify(await page.evaluate(() => window.probe.annotations()));
  const firstPin = await pinCentre();
  await page.evaluate(() => {
    const inst = window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === 'cargo-a');
    window.probe.PackLibrary.updateInstance('fixture-pack', 'cargo-a', {
      transform: { ...inst.transform, position: { ...inst.transform.position, x: inst.transform.position.x + 120, z: inst.transform.position.z + 20 } },
    });
  });
  await page.waitForFunction(old => {
    const r = document.querySelector('.tp3d-annot-pin:not(.is-draft)').getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - old.x) > 20;
  }, firstPin);
  assert.ok(near(await pinCentre(), await expected()), 'after the cargo moved the marker is on the same spot of the cargo');
  assert.equal(JSON.stringify(await page.evaluate(() => window.probe.annotations())), record, 'the stored annotation is unchanged by cargo movement');
  assert.equal((await page.evaluate(() => window.probe.resolved()))[0].status, 'valid');
  assert.deepEqual(errors, []);
});

test('selecting an annotation clears the cargo selection, selecting cargo clears the annotation, and Delete acts only on its owner', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const [first] = await seed(page, [{ title: 'On the ground', ground: [520, 10] }, { title: 'On case B', ...TOP_OF_B }]);
  await page.waitForSelector('.tp3d-annot-row >> nth=1');

  // Cargo selected, then an annotation picked from the list: the cargo selection is cleared.
  await click(page, await page.evaluate(() => window.probe.cargoPoint('cargo-b')));
  await page.waitForFunction(() => window.probe.selection().includes('cargo-b'));
  await page.click('.tp3d-annot-row:first-child .tp3d-annot-row__select');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'annotation selection clears the cargo selection');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  assert.equal(await page.getAttribute('.tp3d-annot-row:first-child .tp3d-annot-row__select', 'aria-pressed'), 'true');

  // Delete removes the annotation only; cargo is never deleted as a side effect.
  const cargoBefore = await page.evaluate(() => window.probe.casesJson());
  await page.focus('.tp3d-annot-row:first-child .tp3d-annot-row__select');
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  assert.equal(await page.evaluate(() => window.probe.casesJson()), cargoBefore, 'no cargo was deleted');
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'and no cargo Undo step exists');
  assert.match(await page.locator('.tp3d-annot-panel__undo').textContent(), /Callout deleted\. Cargo is unchanged\./);

  // The panel's one-level Undo brings back the same record in the same place, independent of cargo history.
  await page.click('.tp3d-annot-panel__undo-btn');
  await page.waitForFunction(() => window.probe.annotations().length === 2);
  const restored = await page.evaluate(() => window.probe.annotations());
  assert.deepEqual([restored[0].id, restored[0].title], [first.id, 'On the ground']);
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-panel__undo').hidden), true);

  // Cargo clicked: the annotation is deselected.
  await click(page, await page.evaluate(() => window.probe.cargoPoint('cargo-a')));
  await page.waitForFunction(() => window.probe.selection().includes('cargo-a'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-row.is-selected, .tp3d-annot-card.is-selected').length), 0, 'selecting cargo deselects the annotation');

  // Delete with the cargo selection acts on cargo exactly as before and never on an annotation.
  await page.focus('#viewport');
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => !window.probe.cargoIds().includes('cargo-a'));
  assert.equal(await count(page), 2, 'annotations are untouched by a cargo delete');
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), true, 'cargo Delete stays undoable through cargo history');
  assert.equal(await count(page), 2, 'and Undo never touches annotations');
  assert.deepEqual(errors, []);
});

test('one Escape closes one owner: an open card, then the armed tool, then the selection; the rest is left to the Editor', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  await seed(page, [{ title: 'Seeded', ground: [260, 80] }]);
  const toolOn = () => page.evaluate(() => document.querySelector('.tp3d-annot-seg__btn[data-tool="callout"]').getAttribute('aria-pressed') === 'true');
  const cardOpen = () => page.evaluate(() => !document.querySelector('.tp3d-annot-editor').hidden);

  await click(page, await point(page, ...GROUND_A));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.focus('#viewport'); // focus outside the text field: the global owner handles the key
  await page.keyboard.press('Escape');
  assert.equal(await cardOpen(), false, '1: the open card closes first');
  assert.equal(await toolOn(), true, 'the tool is still armed');
  assert.equal(await count(page), 1, 'and nothing was written');
  await page.keyboard.press('Escape');
  assert.equal(await toolOn(), false, '2: the next Escape disarms the tool');
  assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').hidden), false, 'the panel stays open');

  await page.click('.tp3d-annot-pin:not(.is-draft)');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  await page.focus('#viewport');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-card.is-selected').length), 0, '3: then the annotation selection');

  // With cargo selected and nothing of ours to close, the existing handler keeps Escape.
  await click(page, await page.evaluate(() => window.probe.cargoPoint('cargo-a')));
  await page.waitForFunction(() => window.probe.selection().includes('cargo-a'));
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], '4: cargo is deselected by the Editor, as before');
  assert.equal(await escapeConsumed(page), false, 'with nothing to close the key is not consumed');

  // A text field that owns Escape keeps it.
  await click(page, await page.evaluate(() => window.probe.cargoPoint('cargo-a')));
  assert.deepEqual(errors, []);
});

test('dragging a card changes only its screen offset: the anchor, the marker and cargo stay put, and the card follows the marker', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const [saved] = await seed(page, [{ title: 'Movable', ...TOP_OF_A }]);
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  const before = await page.evaluate(() => ({ cases: window.probe.casesJson(), camera: window.probe.camera(), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited }));
  const markerBefore = await pinCentreOf(page);
  const head = await page.locator('.tp3d-annot-card.is-selected .tp3d-annot-card__head').boundingBox();
  const grab = { x: head.x + 40, y: head.y + head.height / 2 };

  // Escape mid-drag restores the card and writes nothing.
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 120, grab.y + 90, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal((await page.evaluate(() => window.probe.annotations()))[0].offset, null, 'a cancelled drag writes nothing');
  assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited), before.edited);

  // A real drag stores one offset.
  const cardBefore = await page.locator('.tp3d-annot-card.is-selected').boundingBox();
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 70, grab.y + 50, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => window.probe.annotations()[0].offset !== null);
  const [dragged] = await page.evaluate(() => window.probe.annotations());
  assert.deepEqual(dragged.anchor, saved.anchor, 'the anchor never changes');
  assert.equal(await page.evaluate(() => window.probe.casesJson()), before.cases, 'cargo is never moved');
  assert.equal(await page.evaluate(() => window.probe.camera()), before.camera);
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'a card move is not a cargo Undo step');
  const markerAfter = await pinCentreOf(page);
  assert.ok(Math.abs(markerAfter.x - markerBefore.x) < 1 && Math.abs(markerAfter.y - markerBefore.y) < 1, 'the marker did not move');
  const cardAfter = await page.locator('.tp3d-annot-card.is-selected').boundingBox();
  assert.ok(Math.abs(cardAfter.x - cardBefore.x - 70) < 2 && Math.abs(cardAfter.y - cardBefore.y - 50) < 2, 'the card moved with the pointer');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-card.is-selected').length), 1, 'a drag does not deselect it');
  const offsetOf = async () => {
    const card = await page.locator('.tp3d-annot-card.is-selected').boundingBox();
    const pin = await pinCentreOf(page);
    return { dx: card.x - pin.x, dy: card.y - pin.y };
  };
  const stored = await offsetOf();
  assert.ok(Math.abs(stored.dx - dragged.offset.dx) < 2 && Math.abs(stored.dy - dragged.offset.dy) < 2, 'the stored offset is marker-relative');

  // Orbit the camera: the marker moves with the cargo and the card keeps its offset from it.
  const box = await page.evaluate(() => window.probe.box('#viewport canvas'));
  await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.3 + 80, box.y + box.h * 0.8 + 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(c => window.probe.camera() !== c, before.camera);
  await page.waitForTimeout(400);
  const movedMarker = await pinCentreOf(page);
  assert.ok(Math.abs(movedMarker.x - markerAfter.x) + Math.abs(movedMarker.y - markerAfter.y) > 5, 'the marker followed the cargo through the orbit');
  const after = await offsetOf();
  assert.ok(Math.abs(after.dx - stored.dx) < 2 && Math.abs(after.dy - stored.dy) < 2, 'the card kept its offset from the marker');
  assert.deepEqual(errors, []);
});

test('annotations pause while an operation owns the Editor: graphics and editing are gone, records are untouched, and the pause ends by itself', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'First', ground: [520, 10], keepExpanded: true }, { title: 'Second', ...TOP_OF_B }]);
  await page.click('.tp3d-annot-row:first-child .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  const paused = () => page.evaluate(() => (/paused/.test(window.probe.hint()) ? window.probe.hint() : ''));
  const controls = () => page.evaluate(() => ({
    tool: document.querySelector('.tp3d-annot-seg__btn[data-tool="callout"]').disabled,
    rows: [...document.querySelectorAll('.tp3d-annot-row__select, .tp3d-annot-row__eye, .tp3d-annot-row__edit, .tp3d-annot-row__delete')].map(b => b.disabled),
  }));
  const graphics = () => page.evaluate(() => ({
    pins: document.querySelectorAll('.tp3d-annot-pin:not([hidden])').length,
    cards: document.querySelectorAll('.tp3d-annot-card:not([hidden])').length,
    leaders: [...document.querySelectorAll('.tp3d-annot-svg__leader, .tp3d-annot-svg__under')].filter(el => el.getAttribute('d')).length,
    chips: [...document.querySelectorAll('.tp3d-annot-pin__chip')].filter(el => !el.hidden).length,
  }));
  const before = await page.evaluate(() => ({ json: JSON.stringify(window.probe.annotations()), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited }));
  assert.equal((await graphics()).pins, 2);

  // A background thumbnail capture only reads pixels back: nothing pauses.
  await page.evaluate(() => { window.__capture = window.probe.OperationLifecycle.beginOperation('capturingPreview'); });
  await page.waitForTimeout(300);
  assert.equal(await paused(), '', 'a passive capture is not a pause');
  assert.equal((await graphics()).pins, 2);
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__capture));

  // AutoPack running: a short status, no graphics of any kind, no editing, no selection.
  await page.evaluate(() => { window.__op = window.probe.OperationLifecycle.beginOperation('autopacking'); });
  await page.waitForFunction(() => /paused/.test(window.probe.hint()));
  assert.equal(await paused(), 'Annotations paused during AutoPack.');
  assert.deepEqual(await graphics(), { pins: 0, cards: 0, leaders: 0, chips: 0 }, 'the cargo scene is clean');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-panel__blocked').length), 0, 'no banner, only the compact status line');
  assert.deepEqual(await controls(), { tool: true, rows: Array(8).fill(true) }, 'creation, selection and editing are refused');
  await page.focus('#viewport');
  await page.keyboard.press('Delete');
  assert.equal(await count(page), 2, 'Delete is refused too');
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__op));
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  assert.equal((await graphics()).pins, 2, 'the pins come back from the unchanged records');
  assert.deepEqual(await controls(), { tool: false, rows: Array(8).fill(false) }, 'editing resumes when the operation ends');
  assert.deepEqual(await page.evaluate(() => ({ json: JSON.stringify(window.probe.annotations()), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited })), before, 'records and lastEdited never changed');

  // An unfinished editor does not survive a pause, and nothing it held is written.
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Unsaved');
  await page.evaluate(() => { window.__op = window.probe.OperationLifecycle.beginOperation('unpacking'); });
  await page.waitForFunction(() => /paused during Unpack/.test(window.probe.hint()));
  assert.equal(await editorClosed(page), true);
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__op));
  assert.equal((await page.evaluate(() => window.probe.annotations()))[1].title, 'Second');
  assert.deepEqual(errors, []);
});

test('the overlay is DOM above the canvas: no scene objects are added and the canvas pixels are unchanged', { timeout: 120000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const base = await page.evaluate(() => ({ pixels: window.probe.canvasData(), objects: window.probe.sceneObjectCount() }));
  await seed(page, [{ title: 'One', ground: [520, 10], keepExpanded: true }, { title: 'Two', ...TOP_OF_B }, { title: 'Three', ...TOP_OF_A }]);
  await page.click('.tp3d-annot-seg--display .tp3d-annot-seg__btn:has-text("Cards")');
  await page.waitForSelector('.tp3d-annot-card:not([hidden])');
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 3);
  const drawn = await page.evaluate(() => ({ pixels: window.probe.canvasData(), objects: window.probe.sceneObjectCount() }));
  assert.equal(drawn.objects, base.objects, 'no scene object is added');
  assert.equal(drawn.pixels, base.pixels, 'markers, cards and leaders never reach the canvas pixels (and so never a Screenshot, PDF view or thumbnail)');
  const placement = await page.evaluate(() => ({
    insideViewport: Boolean(document.querySelector('#viewport .tp3d-annot-pin, #viewport .tp3d-annot-card, #viewport .tp3d-annot-svg')),
    layerParent: document.getElementById('editor-annotation-layer').parentElement.classList.contains('canvas-wrap'),
    clickThrough: getComputedStyle(document.getElementById('editor-annotation-layer')).pointerEvents,
  }));
  assert.deepEqual(placement, { insideViewport: false, layerParent: true, clickThrough: 'none' });
  assert.deepEqual(errors, []);
});

test('Needs Review and Unresolved callouts stay stored and flagged, are never drawn, and Re-attach is the owner\'s deliberate remedy', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'On case A', cargo: 'cargo-a', local: { x: 12, y: 16, z: 8 } }, { title: 'On case B', ...TOP_OF_B }, { title: 'On ground', ground: [520, 10] }]);
  const drawnPins = () => page.evaluate(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 3);
  const stored = JSON.stringify(await page.evaluate(() => window.probe.annotations()));
  const row = n => page.evaluate(i => {
    const el = document.querySelectorAll('.tp3d-annot-row')[i];
    return { sub: el.querySelector('.tp3d-annot-row__sub').textContent, issue: el.querySelector('.tp3d-annot-row__issue').hidden ? '' : el.querySelector('.tp3d-annot-row__issue').textContent.trim(), reattach: !el.querySelector('.tp3d-annot-row__issue .tp3d-annot-btn').hidden, flagged: el.querySelector('.tp3d-annot-row__badge').classList.contains('is-flagged') };
  }, n);

  // A Case size change asks for review: no number position is invented and the record is untouched.
  await page.evaluate(() => {
    const { StateStore } = window.probe;
    const caseId = window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === 'cargo-b').caseId;
    window.__caseB = StateStore.get('caseLibrary').find(c => c.id === caseId);
    StateStore.set({ caseLibrary: StateStore.get('caseLibrary').map(c => (c.id === caseId ? { ...c, dimensions: { ...c.dimensions, length: c.dimensions.length + 6 } } : c)) }, { skipHistory: true });
  });
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 2);
  const review = await row(1);
  assert.equal(review.sub, 'Needs review');
  assert.match(review.issue, /size or shape changed/i);
  assert.equal(review.reattach, true);
  assert.equal(review.flagged, true, 'a dashed ring, never a placed dot');
  assert.equal(JSON.stringify(await page.evaluate(() => window.probe.annotations())), stored, 'nothing is rewritten or relocated');

  // Deleting the cargo leaves its callout Unresolved with an explanation.
  await page.evaluate(() => window.probe.PackLibrary.removeInstances('fixture-pack', ['cargo-a']));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 1);
  const gone = await row(0);
  assert.equal(gone.sub, 'Unresolved');
  assert.match(gone.issue, /no longer in this Load Plan/);
  assert.equal(await count(page), 3, 'editing cargo never deletes an annotation');
  assert.equal(await drawnPins(), 1);

  // Re-attach: Escape cancels without writing; a click on a surface moves only the marker.
  const edited = await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited);
  await page.click('.tp3d-annot-row:first-child .tp3d-annot-row__issue .tp3d-annot-btn');
  await page.waitForFunction(() => /re-attach this callout/i.test(window.probe.hint()));
  await page.focus('#viewport');
  await page.keyboard.press('Escape');
  assert.doesNotMatch(await page.evaluate(() => window.probe.hint()), /re-attach this callout/i);
  assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited), edited, 'a cancelled re-attach writes nothing');
  await page.click('.tp3d-annot-row:first-child .tp3d-annot-row__issue .tp3d-annot-btn');
  await page.waitForFunction(() => /re-attach this callout/i.test(window.probe.hint()));
  const cargoBefore = await page.evaluate(() => window.probe.casesJson());
  await click(page, await point(page, ...GROUND_A));
  await page.waitForFunction(() => window.probe.resolved()[0].status === 'valid');
  const [reattached] = await page.evaluate(() => window.probe.annotations());
  assert.deepEqual([reattached.anchor.kind, reattached.anchor.surface, reattached.title], ['space', 'ground', 'On case A'], 'the same callout, on its new surface');
  assert.equal(await page.evaluate(() => window.probe.casesJson()), cargoBefore, 'cargo is never touched');
  // Cargo Undo restores the cargo (and the Case library of that moment); annotations are carried across unchanged.
  const afterReattach = JSON.stringify(await page.evaluate(() => window.probe.annotations()));
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), true, 'the earlier cargo delete is the only cargo history step');
  await page.waitForFunction(() => window.probe.resolved().every(r => r.status === 'valid'));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 3);
  assert.equal(JSON.stringify(await page.evaluate(() => window.probe.annotations())), afterReattach, 'Undo neither erases nor rolls back an annotation edit (the re-attach stays)');
  assert.deepEqual((await page.evaluate(() => window.probe.annotations()))[1], JSON.parse(stored)[1], 'and the callout that needed review is Valid again, exactly as it was stored');
  assert.deepEqual(errors, []);
});

test('Markers, Labels and Cards are view-level, kept-expanded and Hide are saved with the Load Plan', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'Kept', ground: [520, 10], keepExpanded: true }, { title: 'Plain B', ...TOP_OF_B }, { title: 'Plain C', ground: [200, -30] }]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 3);
  const visible = (selector) => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(el => !el.hidden).length, selector);
  assert.equal(await visible('.tp3d-annot-card'), 1, 'Markers: only the kept-expanded callout shows a card');
  assert.equal(await visible('.tp3d-annot-pin__chip'), 0, 'and no labels');
  const stored = JSON.stringify(await page.evaluate(() => window.probe.annotations()));

  await page.click('.tp3d-annot-seg--display .tp3d-annot-seg__btn:has-text("Labels")');
  await page.waitForFunction(() => [...document.querySelectorAll('.tp3d-annot-pin__chip')].some(el => !el.hidden));
  const labels = await page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-pin__chip')].filter(el => !el.hidden).map(el => el.textContent).sort());
  assert.ok(labels.length >= 1 && labels.every(text => ['Plain B', 'Plain C'].includes(text)), 'Labels: a title beside each marker without a card');
  assert.equal(await visible('.tp3d-annot-card'), 1);

  await page.click('.tp3d-annot-seg--display .tp3d-annot-seg__btn:has-text("Cards")');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-card:not([hidden])').length >= 3);
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-seg--display [aria-pressed="true"]').textContent), 'Cards');
  assert.equal(JSON.stringify(await page.evaluate(() => window.probe.annotations())), stored, 'the display mode is a view setting: nothing was written');

  // Hide / Show is saved with the Load Plan.
  await page.click('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__eye');
  await page.waitForFunction(() => window.probe.annotations()[2].hidden === true);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 2);
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__sub').textContent), 'Ground · Hidden');
  assert.equal(await page.getAttribute('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__eye', 'aria-label'), 'Show Plain C');
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'Hide is not a cargo Undo step');
  await page.click('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__eye');
  await page.waitForFunction(() => window.probe.annotations()[2].hidden === false);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 3);
  assert.deepEqual(errors, []);
});

test('Labels mode in a crowded view draws only labels that cover no other label or marker; every marker stays', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  // Four markers a few pixels apart on one case: their labels would pile up.
  await seed(page, [-17, -6, 5, 16].map((x, i) => ({ title: `Latch number ${i + 1}`, cargo: 'cargo-a', local: { x, y: 16, z: i % 2 ? 6 : -6 } })));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 4);
  await page.click('.tp3d-annot-seg--display .tp3d-annot-seg__btn:has-text("Labels")');
  await page.waitForFunction(() => [...document.querySelectorAll('.tp3d-annot-pin__chip')].some(el => !el.hidden));
  const shown = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const pins = [...document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])')].map(el => ({ el, rect: rect(el) }));
    const chips = pins.filter(({ el }) => !el.querySelector('.tp3d-annot-pin__chip').hidden).map(({ el }) => ({ own: el, rect: rect(el.querySelector('.tp3d-annot-pin__chip')) }));
    const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
    const badge = el => rect(el.querySelector('.tp3d-annot-pin__badge') || el);
    return {
      pins: pins.length,
      chips: chips.length,
      chipOverChip: chips.some((a, i) => chips.slice(i + 1).some(b => overlap(a.rect, b.rect))),
      chipOverMarker: chips.some(c => pins.some(p => p.el !== c.own && overlap(c.rect, badge(p.el)))),
    };
  });
  assert.equal(shown.pins, 4, 'every marker stays drawn');
  assert.ok(shown.chips >= 1 && shown.chips < 4, `crowded labels are dropped, not piled up (${shown.chips} of 4 drawn)`);
  assert.equal(shown.chipOverChip, false, 'no label covers another label');
  assert.equal(shown.chipOverMarker, false, 'and no label covers another marker');
  assert.equal(await count(page), 4, 'nothing was written or removed');
  assert.deepEqual(errors, []);
});

test('automatically placed cards and labels keep clear of the open panel and of every marker', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [
    { title: 'FRAGILE', description: 'Check packaging condition before loading.', ...TOP_OF_A },
    { title: 'THIS SIDE UP', description: 'Keep upright during loading.', ground: [330, 25] },
    { title: 'HEAVY', description: 'Use two people or a lift.', ground: [400, 60] },
    { title: 'CUSTOMER PICKUP', description: 'Keep accessible for scheduled collection.', ...TOP_OF_B },
    { title: 'Rear doors', ground: [470, 20] },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 5);
  const overlapsPanel = () => page.evaluate(() => {
    const panel = document.getElementById('editor-annotation-panel').getBoundingClientRect();
    const hit = r => Math.min(r.right, panel.right) > Math.max(r.left, panel.left) && Math.min(r.bottom, panel.bottom) > Math.max(r.top, panel.top);
    const shown = selector => [...document.querySelectorAll(selector)].filter(el => !el.hidden && el.getClientRects().length).map(el => el.getBoundingClientRect());
    return {
      pinsNearPanel: shown('.tp3d-annot-pin:not(.is-draft)').filter(r => r.left < panel.left && r.right > panel.left - 215 && r.top < panel.bottom && r.bottom > panel.top).length,
      cards: shown('.tp3d-annot-card').length,
      cardsOnPanel: shown('.tp3d-annot-card').filter(hit).length,
      chips: shown('.tp3d-annot-pin__chip').length,
      chipsOnPanel: shown('.tp3d-annot-pin__chip').filter(hit).length,
    };
  });
  await page.click('.tp3d-annot-seg--display .tp3d-annot-seg__btn:has-text("Cards")');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-card:not([hidden])').length === 5);
  const cards = await overlapsPanel();
  assert.ok(cards.pinsNearPanel >= 1, 'the scene has a marker whose right-hand card slot would sit under the panel');
  assert.equal(cards.cards, 5);
  assert.equal(cards.cardsOnPanel, 0, 'no automatically placed card is hidden under the panel');
  await page.click('.tp3d-annot-seg--display .tp3d-annot-seg__btn:has-text("Labels")');
  await page.waitForFunction(() => [...document.querySelectorAll('.tp3d-annot-pin__chip')].some(el => !el.hidden));
  const labels = await overlapsPanel();
  assert.ok(labels.chips >= 1);
  assert.equal(labels.chipsOnPanel, 0, 'and no label is hidden under it');
  assert.deepEqual(errors, []);
});

const livePins = page => page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-pin:not(.is-draft)')].filter(el => !el.hidden).map(el => el.querySelector('.tp3d-annot-pin__badge').textContent));
const liveCards = page => page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-card')].filter(el => !el.hidden).map(el => el.getAttribute('aria-label')));
const showButton = (page, label) => page.locator(`.tp3d-annot-seg--show .tp3d-annot-seg__btn:has-text("${label}")`);
const displayButton = (page, label) => page.locator(`.tp3d-annot-seg--display .tp3d-annot-seg__btn:has-text("${label}")`);
const dialogButton = (page, name) => page.locator('.modal-overlay, .modal').getByRole('button', { name });
const editorInside = page => page.evaluate(() => { const ed = document.querySelector('.tp3d-annot-editor'); return Boolean(ed && !ed.hidden && ed.contains(document.activeElement)); });

test('hiding the callout being edited closes its editor; unsaved changes need an explicit decision; unrelated hides leave it open', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'First', ground: [520, 10] }, { title: 'Second', ...TOP_OF_B }]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 2);
  const record = n => page.evaluate(i => window.probe.annotations()[i], n);
  const eye = n => page.click(`.tp3d-annot-row:nth-child(${n}) .tp3d-annot-row__eye`);

  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  // Hiding another callout does not touch the open editor.
  await eye(2);
  await page.waitForFunction(() => window.probe.annotations()[1].hidden === true);
  assert.equal(await editorClosed(page), false, 'an unrelated hide leaves the editor open');
  await eye(2);
  await page.waitForFunction(() => window.probe.annotations()[1].hidden === false);
  assert.equal(await editorClosed(page), false);

  // Hiding the one being edited (nothing unsaved) closes the editor, with no dialog and nothing committed.
  const before = JSON.stringify(await record(0));
  await eye(1);
  await page.waitForFunction(() => window.probe.annotations()[0].hidden === true);
  assert.equal(await editorClosed(page), true, 'the editor closed');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.modal-overlay, .modal').length), 0, 'no dialog for a clean editor');
  assert.equal(await page.evaluate(() => { const el = document.querySelector('.tp3d-annot-pin.is-draft'); return !el || el.hidden; }), true, 'no marker preview is left');
  assert.equal(await editorInside(page), false, 'focus is not stranded in the closed editor');
  const hidden = await record(0);
  assert.deepEqual([hidden.title, hidden.hidden], ['First', true]);
  assert.equal(JSON.stringify({ ...hidden, hidden: false, updatedAt: 0 }), JSON.stringify({ ...JSON.parse(before), updatedAt: 0 }), 'only the hidden flag changed');
  // Show restores it normally; Escape and the keyboard still work afterwards.
  await eye(1);
  await page.waitForFunction(() => window.probe.annotations()[0].hidden === false);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 2);
  await page.focus('#viewport');
  await page.keyboard.press('Escape');

  // With unsaved changes: Keep editing changes nothing; Discard and hide closes without saving them.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Unsaved title');
  await eye(1);
  await dialogButton(page, 'Keep editing').click();
  assert.equal(await editorClosed(page), false, 'declining leaves the editor open');
  assert.equal(await page.inputValue('.tp3d-annot-editor__input'), 'Unsaved title', 'with its unsaved text');
  assert.deepEqual([(await record(0)).hidden, (await record(0)).title], [false, 'First'], 'and the visibility and record unchanged');
  await eye(1);
  await dialogButton(page, 'Discard and hide').click();
  await page.waitForFunction(() => window.probe.annotations()[0].hidden === true);
  assert.equal(await editorClosed(page), true);
  assert.equal((await record(0)).title, 'First', 'the unsaved text was never committed');
  assert.equal(await count(page), 2);
  await eye(1);
  await page.waitForFunction(() => window.probe.annotations()[0].hidden === false);
  assert.deepEqual(errors, []);
});

test('Show All / Selected / Off is view state: it filters the overlay, never writes, never overrides Hide, and Off ends invisible gestures', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'One', ground: [520, 10], keepExpanded: true }, { title: 'Two', ...TOP_OF_B }, { title: 'Three', ground: [200, -30] }]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 3);
  const pressed = () => page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-seg--show .tp3d-annot-seg__btn')].map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`));
  assert.deepEqual(await pressed(), ['All:true', 'Selected:false', 'Off:false'], 'All is the default');
  const snapshot = () => page.evaluate(() => ({ json: JSON.stringify(window.probe.annotations()), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited, cases: window.probe.casesJson() }));
  const base = await snapshot();
  assert.deepEqual(await livePins(page), ['1', '2', '3']);

  // Selected: only the selected callout (and its card) is drawn; the list stays complete.
  await showButton(page, 'Selected').click();
  assert.deepEqual(await livePins(page), [], 'nothing selected: no graphics (the kept-expanded card too)');
  assert.deepEqual(await liveCards(page), []);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-row').length), 3, 'the list is still available');
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  assert.deepEqual(await livePins(page), ['2']);
  assert.equal((await liveCards(page)).length, 1, 'only the selected card');
  await page.click('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-row:nth-child(3)').classList.contains('is-selected'));
  assert.deepEqual(await livePins(page), ['3'], 'selecting another callout moves the view to it');

  // A callout's own Hide always wins over the global mode.
  await page.click('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__eye');
  await page.waitForFunction(() => window.probe.annotations()[2].hidden === true);
  assert.deepEqual(await livePins(page), [], 'a hidden callout is not drawn even when selected');
  await showButton(page, 'All').click();
  assert.deepEqual(await livePins(page), ['1', '2']);
  await page.click('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__eye');
  await page.waitForFunction(() => window.probe.annotations()[2].hidden === false);
  const afterHide = await snapshot();

  // Off: no pins, labels, cards or leader lines; the panel stays; creation and gestures are unavailable.
  await showButton(page, 'Off').click();
  assert.deepEqual(await livePins(page), []);
  const graphics = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.tp3d-annot-card')].filter(el => !el.hidden).length,
    chips: [...document.querySelectorAll('.tp3d-annot-pin__chip')].filter(el => !el.hidden && el.closest('.tp3d-annot-pin') && !el.closest('.tp3d-annot-pin').hidden).length,
    leaders: [...document.querySelectorAll('.tp3d-annot-svg__leader, .tp3d-annot-svg__under')].filter(el => el.getAttribute('d')).length,
    panelShown: !document.getElementById('editor-annotation-panel').hidden,
    tool: document.querySelector('.tp3d-annot-seg__btn[data-tool="callout"]').disabled,
    rows: [...document.querySelectorAll('.tp3d-annot-row__select, .tp3d-annot-row__edit')].every(b => b.disabled),
    hint: window.probe.hint(),
  }));
  assert.deepEqual([graphics.cards, graphics.chips, graphics.leaders, graphics.panelShown, graphics.tool, graphics.rows], [0, 0, 0, true, true, true]);
  assert.match(graphics.hint, /hidden in the view/i);
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'cargo selection untouched');
  await click(page, await point(page, ...GROUND_A));
  assert.equal(await count(page), 3, 'a click on the scene creates nothing while Off');
  assert.equal(await editorClosed(page), true);
  await page.focus('#viewport');
  await page.keyboard.press('Delete');
  assert.equal(await count(page), 3, 'Delete cannot remove an annotation that cannot be seen');

  // None of the mode changes wrote anything, bumped lastEdited or became a cargo Undo step.
  assert.deepEqual(await snapshot(), afterHide);
  assert.equal(afterHide.cases, base.cases);
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false);

  // Back to All (the kept-expanded callout shows its card again).
  await showButton(page, 'All').click();
  assert.deepEqual(await livePins(page), ['1', '2', '3']);
  assert.equal((await liveCards(page)).length, 1);

  // Off with an unfinished new callout: nothing happens until the owner decides; a clean one just closes.
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await click(page, await freePoint(page, [GROUND_A, GROUND_B, [60, 0, 60]]));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await showButton(page, 'Off').click();
  assert.equal(await editorClosed(page), true, 'a new callout with nothing typed has nothing to lose: it closes');
  assert.deepEqual(await pressed(), ['All:false', 'Selected:false', 'Off:true']);
  await showButton(page, 'All').click();
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await click(page, await freePoint(page, [GROUND_A, GROUND_B, [60, 0, 60]]));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Typed draft');
  await showButton(page, 'Off').click();
  await dialogButton(page, 'Keep editing').click();
  assert.equal(await editorClosed(page), false, 'declining keeps the editor');
  assert.equal(await page.inputValue('.tp3d-annot-editor__input'), 'Typed draft');
  assert.deepEqual(await pressed(), ['All:true', 'Selected:false', 'Off:false'], 'and the mode is unchanged');
  await showButton(page, 'Off').click();
  await dialogButton(page, 'Discard and turn off').click();
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-seg--show [aria-pressed="true"]').textContent === 'Off');
  assert.equal(await editorClosed(page), true);
  assert.equal(await count(page), 3, 'the unsaved callout was never written');
  assert.deepEqual(await page.evaluate(() => document.querySelector('.tp3d-annot-seg__btn[data-tool="callout"]').getAttribute('aria-pressed')), 'false', 'the tool is disarmed');

  // The view controls stay usable while an operation makes editing read-only.
  await page.evaluate(() => { window.__op = window.probe.OperationLifecycle.beginOperation('autopacking'); });
  await page.waitForFunction(() => /paused/.test(window.probe.hint()));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-seg--show .tp3d-annot-seg__btn, .tp3d-annot-seg--display .tp3d-annot-seg__btn')].every(b => !b.disabled)), true);
  await showButton(page, 'Selected').click();
  assert.deepEqual(await pressed(), ['All:false', 'Selected:true', 'Off:false']);
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__op));
  assert.deepEqual(await snapshot(), afterHide, 'still nothing written');

  // The mode belongs to the Load Plan session, not to the panel: closing, collapsing and reopening keep it.
  await showButton(page, 'Off').click();
  await page.click('#btn-editor-annotations');
  await page.click('#btn-editor-annotations');
  await page.waitForSelector('.tp3d-annot-seg--show');
  assert.deepEqual(await pressed(), ['All:false', 'Selected:false', 'Off:true'], 'Off survives closing and reopening the panel');
  assert.deepEqual(await livePins(page), [], 'and the graphics stay off while the panel is closed');
  await page.click('#btn-editor-annotations');
  assert.deepEqual(await livePins(page), [], 'closed panel, still off');
  await page.click('#btn-editor-annotations');
  await page.click('.tp3d-annot-panel__toggle');
  await page.click('.tp3d-annot-panel__toggle');
  assert.deepEqual(await pressed(), ['All:false', 'Selected:false', 'Off:true'], 'and collapsing');
  // It ends with the session: another Load Plan starts at All.
  await page.evaluate(() => {
    const copy = window.probe.PackLibrary.duplicate('fixture-pack');
    window.__otherPack = copy.id;
    window.probe.StateStore.set({ currentPackId: copy.id }, { skipHistory: true });
  });
  await page.click('#btn-editor-annotations');
  await page.waitForSelector('.tp3d-annot-seg--show');
  assert.deepEqual(await pressed(), ['All:true', 'Selected:false', 'Off:false'], 'another Load Plan starts at All');
  assert.equal((await livePins(page)).length, 3);
  assert.deepEqual(errors, []);
});

test('Markers / Labels / Cards switch cleanly in every state: identity, numbering, selection and the saved data never change', { timeout: 300000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  // No annotations: switching is harmless.
  for (const label of ['Labels', 'Cards', 'Markers', 'Cards', 'Labels', 'Markers']) await displayButton(page, label).click();
  assert.deepEqual(await livePins(page), []);

  await seed(page, [
    { title: 'Selected one', description: 'Chosen', ...TOP_OF_A },
    { title: 'Kept open', description: 'Always expanded', ground: [520, 10], keepExpanded: true },
    { title: 'Hidden one', ground: [200, -30] },
    { title: 'Behind', cargo: 'cargo-b', local: { x: 10, y: -12, z: 10 } },
    { title: 'Plain', ground: [330, 25] },
  ]);
  await page.click('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__eye');
  await page.waitForFunction(() => window.probe.annotations()[2].hidden === true);
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  await page.waitForTimeout(300);
  const base = await page.evaluate(() => ({ json: JSON.stringify(window.probe.annotations()), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited }));
  const state = async () => page.evaluate(() => {
    const visible = sel => [...document.querySelectorAll(sel)].filter(el => !el.hidden);
    const pins = visible('.tp3d-annot-pin:not(.is-draft)');
    return {
      pins: pins.map(el => el.querySelector('.tp3d-annot-pin__badge').textContent),
      cards: visible('.tp3d-annot-card').map(el => el.getAttribute('aria-label')),
      chips: pins.filter(el => !el.querySelector('.tp3d-annot-pin__chip').hidden).map(el => el.querySelector('.tp3d-annot-pin__chip').textContent),
      selected: [...document.querySelectorAll('.tp3d-annot-row.is-selected')].map(el => el.dataset.annotId),
      numbers: [...document.querySelectorAll('.tp3d-annot-row__badge')].map(el => el.textContent),
      selectedCards: visible('.tp3d-annot-card.is-selected').length,
      data: JSON.stringify(window.probe.annotations()),
      edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited,
    };
  });
  const check = async (mode, label) => {
    await displayButton(page, mode).click();
    await page.waitForFunction(m => [...document.querySelectorAll('.tp3d-annot-seg--display .tp3d-annot-seg__btn')].find(b => b.textContent === m).getAttribute('aria-pressed') === 'true', mode);
    const now = await state();
    assert.deepEqual(now.pins.sort(), ['1', '2', '4', '5'], `${label}: every visible callout keeps its marker (the hidden one stays hidden)`);
    assert.deepEqual(now.numbers, ['1', '2', '3', '4', '5'], `${label}: numbering is stable`);
    assert.equal(new Set(now.cards).size, now.cards.length, `${label}: no duplicate cards`);
    assert.equal(now.selectedCards, 1, `${label}: the selected callout keeps its expanded card`);
    assert.ok(now.cards.some(text => /Kept open/.test(text)), `${label}: the kept-expanded callout keeps its card`);
    assert.equal(now.selected.length, 1, `${label}: the selection survives`);
    assert.equal(now.data, base.json, `${label}: nothing was written`);
    assert.equal(now.edited, base.edited, `${label}: lastEdited is untouched`);
    if (mode === 'Markers') {
      assert.deepEqual(now.chips, [], 'Markers: no labels');
      assert.equal(now.cards.length, 2, 'Markers: only the selected and kept-expanded cards');
    } else if (mode === 'Labels') {
      assert.ok(now.chips.length >= 1, 'Labels: titles beside markers');
      assert.equal(now.cards.length, 2, 'Labels: the selected and kept-expanded cards only');
      assert.ok(!now.chips.some(text => /Selected one|Kept open/.test(text)), 'Labels: a callout with a card has no duplicate label');
    } else {
      assert.ok(now.cards.length >= 3, 'Cards: every eligible callout within the budget');
      assert.ok(now.cards.length <= 4, 'Cards: never the hidden one');
      assert.deepEqual(now.chips, [], 'Cards: no stray labels');
    }
    return now;
  };
  for (const mode of ['Labels', 'Cards', 'Markers', 'Cards', 'Labels', 'Markers', 'Labels', 'Cards']) await check(mode, `switch to ${mode}`);

  // After orbiting and zooming the camera, and in Cards mode again.
  const box = await page.evaluate(() => window.probe.box('#viewport canvas'));
  await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.85);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.3 + 120, box.y + box.h * 0.85 + 30, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.8);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(500);
  for (const mode of ['Markers', 'Labels', 'Cards', 'Markers']) await displayButton(page, mode).click();
  const afterCamera = await state();
  assert.equal(afterCamera.data, base.json);
  assert.equal(afterCamera.edited, base.edited);
  assert.equal(new Set(afterCamera.cards).size, afterCamera.cards.length);
  assert.equal(afterCamera.selectedCards, 1);
  assert.deepEqual(afterCamera.numbers, ['1', '2', '3', '4', '5']);
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'view switching is not a cargo Undo step');
  assert.deepEqual(errors, []);
});

test('a crowded scene falls back to labels and markers without losing any marker, and keeps the selected and kept-expanded cards first', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, Array.from({ length: 40 }, (_, i) => ({
    title: `Callout ${i + 1}`, description: 'Dense', ground: [20 + (i % 10) * 20, -40 + Math.floor(i / 10) * 20], keepExpanded: i === 31,
  })));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 40);
  await page.click('.tp3d-annot-row:nth-child(7) .tp3d-annot-row__select');
  await displayButton(page, 'Cards').click();
  await page.waitForTimeout(400);
  const now = await page.evaluate(() => ({
    pins: [...document.querySelectorAll('.tp3d-annot-pin:not(.is-draft)')].filter(el => !el.hidden).length,
    cards: [...document.querySelectorAll('.tp3d-annot-card')].filter(el => !el.hidden).map(el => el.getAttribute('aria-label')),
    notice: [...document.querySelectorAll('.tp3d-annot-overflow')].filter(el => !el.hidden).length,
  }));
  assert.equal(now.pins, 40, 'no marker is ever hidden by the card budget');
  assert.ok(now.cards.length >= 2 && now.cards.length < 40, `the budget caps the cards (${now.cards.length})`);
  assert.ok(now.cards.some(text => /^Callout 7:/.test(text)), 'the selected callout has its card');
  assert.ok(now.cards.some(text => /^Callout 32:/.test(text)), 'and so does the kept-expanded one');
  assert.equal(now.notice, 1, 'the overflow is explained');
  assert.deepEqual(errors, []);
});

test('custom colors: one native color swatch beside the five names; the color is applied everywhere, readable, and saved as #rrggbb', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  const style = selector => page.evaluate(sel => { const el = document.querySelector(sel); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, fg: cs.color }; }, selector);
  await click(page, await freePoint(page, [GROUND_A, GROUND_B]));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-swatches .tp3d-annot-swatch').length), 6, 'five names plus one custom');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-swatch__input').type), 'color', 'a native, accessible color input');
  assert.equal(await page.getAttribute('.tp3d-annot-swatch__input', 'aria-label'), 'Custom color');
  await page.fill('.tp3d-annot-editor__input', 'Yellow note');
  await page.fill('.tp3d-annot-swatch__input', '#ffff00');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-swatch--custom').classList.contains('is-selected')), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-swatch[aria-pressed="true"]').length), 0, 'no built-in swatch stays selected');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  const [first] = await page.evaluate(() => window.probe.annotations());
  assert.equal(first.color, '#ffff00', 'stored as canonical #rrggbb in the one existing color field');
  assert.deepEqual(Object.keys(first).sort(), ['anchor', 'color', 'createdAt', 'description', 'hidden', 'id', 'keepExpanded', 'offset', 'schemaVersion', 'title', 'type', 'updatedAt']);
  await page.waitForSelector('.tp3d-annot-pin:not(.is-draft):not([hidden])');
  assert.deepEqual(await style('.tp3d-annot-pin:not(.is-draft) .tp3d-annot-pin__badge'), { bg: 'rgb(255, 255, 0)', fg: 'rgb(17, 19, 24)' }, 'marker and number: dark text on a light color');
  assert.deepEqual(await style('.tp3d-annot-row__badge'), { bg: 'rgb(255, 255, 0)', fg: 'rgb(17, 19, 24)' }, 'list swatch');
  assert.deepEqual(await style('.tp3d-annot-card.is-selected .tp3d-annot-card__swatch'), { bg: 'rgb(255, 255, 0)', fg: 'rgb(17, 19, 24)' }, 'card accent');

  // A very dark custom color gets a white number; dark theme does not change a chosen color.
  if ((await page.getAttribute('.tp3d-annot-seg__btn[data-tool="callout"]', 'aria-pressed')) !== 'true') await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await click(page, await freePoint(page, [GROUND_B, GROUND_A, [60, 0, 60]]));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Dark note');
  await page.fill('.tp3d-annot-swatch__input', '#000000');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations().length === 2);
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  assert.deepEqual(await style('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__badge'), { bg: 'rgb(0, 0, 0)', fg: 'rgb(255, 255, 255)' });
  assert.equal((await page.evaluate(() => window.probe.annotations()))[1].color, '#000000');

  // Editing: reopen shows the custom color selected; a built-in name replaces it with no leftover styling.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  assert.equal(await page.inputValue('.tp3d-annot-swatch__input'), '#ffff00');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-swatch--custom').classList.contains('is-selected')), true);
  await page.click('.tp3d-annot-swatch[data-color="red"]');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-swatch--custom').classList.contains('is-selected')), false);
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations()[0].color === 'red');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__badge').style.getPropertyValue('--annot-color')), '', 'no leftover inline color');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__badge').dataset.color), 'red');

  // Choosing the custom swatch again brings back the color picked earlier.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.click('.tp3d-annot-swatch__input');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-swatch--custom').classList.contains('is-selected')), true);
  await page.click('.tp3d-annot-btn:not(.tp3d-annot-btn--primary):not(.tp3d-annot-btn--danger)');
  // A color is information only: cargo and assessment are untouched.
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------------------------------------
// Stabilization: security, selection ownership, AutoPack/Unpack isolation, offscreen markers, stale dialogs
// ---------------------------------------------------------------------------------------------------------
const HTML_TITLE = '<img src=x onerror=window.__xss=1>';

test('user-authored titles are always literal text: a saved or imported HTML-looking title never becomes DOM or runs script', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: HTML_TITLE, description: '<b onmouseover=window.__xss=2>bold</b>', ...TOP_OF_B }]);
  const inspect = async label => {
    await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
    await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
    await page.fill('.tp3d-annot-editor__input', `${HTML_TITLE}!`);
    await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__eye');
    await page.waitForSelector('.modal');
    const dialog = await page.evaluate(() => ({
      text: document.querySelector('.modal-body').textContent,
      elements: document.querySelectorAll('.modal-body img, .modal-body script, .modal-body b, .modal-body [onerror]').length,
      xss: window.__xss === undefined ? null : window.__xss,
    }));
    assert.match(dialog.text, /<img src=x onerror=window\.__xss=1>/, `${label}: the title is shown literally`);
    assert.equal(dialog.elements, 0, `${label}: no element was created from it`);
    assert.equal(dialog.xss, null, `${label}: no script ran`);
    await dialogButton(page, 'Keep editing').click();
    await page.click('.tp3d-annot-btn:not(.tp3d-annot-btn--primary):not(.tp3d-annot-btn--danger)');
  };
  await inspect('saved');
  // Everywhere else the title and description are drawn: rows, cards, labels, accessible names.
  await page.waitForSelector('.tp3d-annot-card.is-selected'); // editing it selected it
  const drawn = await page.evaluate(() => ({
    injected: document.querySelectorAll('.tp3d-annot-layer img, #editor-annotation-panel img, .tp3d-annot-card b, #editor-annotation-panel b, #editor-annotation-layer img').length,
    rowName: document.querySelector('.tp3d-annot-row__name').textContent,
    cardTitle: document.querySelector('.tp3d-annot-card__title').textContent,
    xss: window.__xss === undefined ? null : window.__xss,
  }));
  assert.deepEqual([drawn.injected, drawn.rowName, drawn.cardTitle, drawn.xss], [0, HTML_TITLE, HTML_TITLE, null]);

  // An imported Load Plan carries the same text through the import gate and the same dialog.
  await page.evaluate(title => {
    const { A, M, PackLibrary, StateStore } = window.probe;
    const record = A.createCalloutRecord({ id: 'imp', anchor: M.buildSpaceAnchor({ surface: 'ground', point: { x: 300, y: 0, z: 40 } }), title, now: 5 });
    const plan = PackLibrary.planPackImport({ pack: { id: 'incoming', title: 'Incoming', loadPlanNumber: 'LP-IMPORTED', truck: { length: 636, width: 102, height: 110 }, cases: [], annotations: [record] }, bundledCases: [] });
    StateStore.set({ packLibrary: [...StateStore.get('packLibrary'), plan.pack], currentPackId: plan.pack.id }, { skipHistory: true });
  }, HTML_TITLE);
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row').length === 1);
  await inspect('imported');
  assert.deepEqual(errors, []);
});

test('selecting an annotation by marker drag or by deletion Undo always clears the cargo selection, and a held pose is respected', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'Movable', ground: [520, 10] }, { title: 'Second', ground: [200, -30] }]);
  const cargoJson = () => page.evaluate(() => window.probe.casesJson());
  const selectCargo = () => page.evaluate(() => { window.probe.InteractionManager.setSelection(['cargo-a']); });
  const isSelected = () => page.evaluate(() => document.querySelector('.tp3d-annot-row.is-selected') && document.querySelector('.tp3d-annot-row.is-selected').dataset.annotId);
  const base = await cargoJson();

  // Cargo selected, then drag an initially unselected marker onto another surface.
  await selectCargo();
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), ['cargo-a']);
  const firstAnchor = await page.evaluate(() => JSON.stringify(window.probe.annotations()[0].anchor));
  const start = await pinCentreOf(page, '.tp3d-annot-pin:not(.is-draft)[data-annot-id]');
  const to = await point(page, ...GROUND_A);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + to.x) / 2, (start.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(first => JSON.stringify(window.probe.annotations()[0].anchor) !== first, firstAnchor);
  assert.ok(await isSelected(), 'the dragged callout is selected');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'and the cargo is no longer selected');
  await page.focus('#viewport');
  await page.keyboard.press('ArrowRight');
  assert.equal(await cargoJson(), base, 'an arrow key cannot move cargo while a callout is selected');

  // Cargo selected, then delete and Undo an annotation.
  await selectCargo();
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__delete');
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), ['cargo-a'], 'deleting alone leaves the cargo selection');
  await page.click('.tp3d-annot-panel__undo-btn');
  await page.waitForFunction(() => window.probe.annotations().length === 2);
  assert.ok(await isSelected(), 'the restored callout is selected');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'and the cargo is not');
  await page.focus('#viewport');
  await page.keyboard.press('ArrowRight');
  assert.equal(await cargoJson(), base, 'arrow keys do not reach cargo');
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  assert.deepEqual(await page.evaluate(() => window.probe.cargoIds().length), 2, 'Delete acts on the annotation only');
  await page.click('.tp3d-annot-panel__undo-btn');
  await page.waitForFunction(() => window.probe.annotations().length === 2);

  // Deselecting either owner leaves nothing selected.
  await page.focus('#viewport');
  await page.keyboard.press('Escape');
  assert.equal(await isSelected(), null);
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), []);
  await selectCargo();
  assert.equal(await isSelected(), null, 'selecting cargo deselects the annotation');

  // A held pose is never abandoned: the Undo restores the callout but does not take the selection.
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__delete');
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  await page.evaluate(() => { window.__hold = window.probe.InteractionManager.hasProvisionalPose; window.probe.InteractionManager.hasProvisionalPose = () => true; });
  await page.click('.tp3d-annot-panel__undo-btn');
  await page.waitForFunction(() => window.probe.annotations().length === 2);
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), ['cargo-a'], 'the held pose keeps its cargo selection');
  assert.equal(await isSelected(), null, 'and the callout is not selected beside it');
  await page.evaluate(() => { window.probe.InteractionManager.hasProvisionalPose = window.__hold; });
  assert.deepEqual(errors, []);
});

// The editor card's controls are reachable by an ordinary click: each one is the topmost element at its own centre.
const editorControls = page => page.evaluate(() => {
  const editor = document.querySelector('.tp3d-annot-editor');
  if (!editor || editor.hidden) return null;
  const cancelSelector = '.tp3d-annot-editor__foot .tp3d-annot-btn:not(.tp3d-annot-btn--primary):not(.tp3d-annot-btn--danger)';
  return Object.fromEntries([['title', '.tp3d-annot-editor__input'], ['save', '.tp3d-annot-btn--primary'], ['cancel', cancelSelector]].map(([name, selector]) => {
    const el = editor.querySelector(selector);
    if (!el) return [name, false];
    // The fields live in a scrolling body that gives up height before any button is hidden; a field the card is
    // too short to show is reached by scrolling (the wheel, or the focus a Tab brings). Save and Cancel never scroll.
    if (name === 'title') el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    // `true` when the control is topmost at its centre, otherwise what covers it (so a failure names the culprit).
    return [name, hit === el || el.contains(hit) ? true : `${hit ? `${hit.tagName}.${hit.className}` : 'nothing'}`];
  }));
});
const REACHABLE = { title: true, save: true, cancel: true };
// The topmost element at five points across a control's width: a control only partly covered fails, not just one covered at its centre.
// `true` when it is topmost at every point, otherwise what covers it (so a failure names the culprit).
const unobstructed = (page, selector) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return 'missing';
  const r = el.getBoundingClientRect();
  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const hit = document.elementFromPoint(r.left + r.width * fraction, r.top + r.height / 2);
    if (hit !== el && !el.contains(hit)) return `${hit ? `${hit.tagName}.${hit.className}` : 'nothing'} at ${Math.round(fraction * 100)}% of ${Math.round(r.width)}px`;
  }
  return true;
}, selector);
const boxOf = (page, selector) => page.evaluate(sel => window.probe.box(sel), selector);
// Toasts are transient (about 3 s) and paint above the editor, so on a slow runner one can still be up when a reachability check
// runs. Wait for them to expire (no sleeps, nothing removed or hidden). One that never goes away is a finding: fail with its
// text and box, never pass over it. A toast that was waited out is named in the test's diagnostics.
const toastsOnScreen = page => page.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map(el => {
  const r = el.getBoundingClientRect();
  return { text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 120), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
}));
const quietToasts = async (page, message, t) => {
  const seen = await toastsOnScreen(page);
  if (!seen.length) return;
  t.diagnostic(`${message}: waited for ${seen.length} toast(s) to expire: ${JSON.stringify(seen)}`);
  try {
    await page.waitForFunction(() => !document.querySelector('#toast-container .toast'), null, { timeout: 15000 });
  } catch {
    assert.fail(`${message}: a toast is still on screen after 15 s: ${JSON.stringify(await toastsOnScreen(page))}`);
  }
};
// Two animation frames: the overlays redraw on their own frame loops, so a state change is settled only after one.
const frames = (page, n = 2) => page.evaluate(count => new Promise(resolve => {
  const step = left => (left <= 0 ? resolve() : window.requestAnimationFrame(() => step(left - 1)));
  step(count);
}), n);
const overlaps = (a, b) => Boolean(a && b) && !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);

test('real AutoPack: clean while it runs or previews; on the applied committed layout annotations are visible and editable beside Results (expanded, minimized or dragged) and Results never changes', { timeout: 480000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'On cargo', ...TOP_OF_A, keepExpanded: true }, { title: 'On ground', ground: [520, 10] }, { title: 'Hidden one', ground: [300, 30] }]);
  await page.click('.tp3d-annot-row:nth-child(3) .tp3d-annot-row__eye');
  await page.waitForFunction(() => window.probe.annotations()[2].hidden === true);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 2);
  // A saved measurement beside the callouts: both kinds of saved graphics follow the same committed-scene rule.
  await page.evaluate(() => {
    const { M, PackLibrary } = window.probe;
    const at = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
    if (!PackLibrary.addMeasurement('fixture-pack', { start: at(100, 70), end: at(260, 80) }).ok) throw new Error('measurement seed failed');
  });
  // A segment group exists before it is first drawn (display none): only a drawn line counts.
  const segments = () => page.evaluate(() => [...document.querySelectorAll('.tp3d-measure-svg__segment')].filter(group => group.style.display !== 'none').length);
  await page.waitForFunction(() => [...document.querySelectorAll('.tp3d-measure-svg__segment')].filter(group => group.style.display !== 'none').length === 1);
  const records = () => page.evaluate(() => JSON.stringify(window.probe.annotations()));
  const measurementsNow = () => page.evaluate(() => JSON.stringify(window.probe.PackLibrary.getMeasurements('fixture-pack')));
  const resultsState = () => page.evaluate(() => JSON.stringify(window.probe.StateStore.get('autoPackResults')));
  const cargoNow = () => page.evaluate(() => window.probe.casesJson());
  const before = await records();
  const measurementsBefore = await measurementsNow();
  // Sample every frame: a pin, card, editor, line or label drawn while an operation is running would show up here.
  await page.evaluate(() => {
    window.__samples = [];
    // After every callback of the frame has run: what is sampled is what the frame paints.
    const tick = () => window.requestAnimationFrame(() => window.setTimeout(() => {
      window.__samples.push({
        busy: window.probe.OperationLifecycle.isBusy(),
        drawn: document.querySelectorAll('.tp3d-annot-pin:not([hidden]), .tp3d-annot-card:not([hidden]), .tp3d-annot-editor:not([hidden]), .tp3d-measure-label:not([hidden])').length
          + [...document.querySelectorAll('.tp3d-measure-svg__segment')].filter(group => group.style.display !== 'none').length,
      });
      tick();
    }, 0));
    tick();
  });
  // An editor left open when AutoPack starts is closed, and what it held is not written.
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Unsaved during AutoPack');
  await page.click('#btn-autopack');
  await page.waitForFunction(() => window.probe.OperationLifecycle.isBusy());
  await page.waitForFunction(() => /paused during AutoPack/.test(window.probe.hint()));
  assert.equal(await editorClosed(page), true, 'the editor cannot stay open over AutoPack');
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults') && !window.probe.OperationLifecycle.isBusy(), null, { timeout: 120000 });
  assert.equal(await records(), before, 'AutoPack never rewrote an annotation; the unsaved text was not saved');
  assert.equal(await measurementsNow(), measurementsBefore, 'nor a measurement');

  const samples = await page.evaluate(() => window.__samples);
  assert.ok(samples.some(sample => sample.busy), 'the run was observed');
  assert.equal(samples.filter(sample => sample.busy && sample.drawn > 0).length, 0, 'no marker, card, editor, line or label is ever drawn while AutoPack runs');

  // Results open over the committed layout: the saved graphics are back and nothing waits for Results to close.
  const drawable = () => page.evaluate(() => window.probe.annotations().filter((r, i) => !r.hidden && window.probe.resolved()[i].status === 'valid').length);
  const pinsNow = () => page.evaluate(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length);
  const graphics = () => page.evaluate(() => document.querySelectorAll('.tp3d-annot-pin:not([hidden]), .tp3d-annot-card:not([hidden]), .tp3d-annot-editor:not([hidden]), .tp3d-measure-label:not([hidden])').length
    + [...document.querySelectorAll('.tp3d-measure-svg__segment')].filter(group => group.style.display !== 'none').length);
  const editingControls = () => page.evaluate(() => ({ tool: document.querySelector('.tp3d-annot-seg__btn[data-tool="callout"]').disabled, edit: document.querySelector('.tp3d-annot-row__edit').disabled }));
  const resultsBox = () => boxOf(page, '[data-role="autopack-results-panel"]');
  const toggle = page.locator('[data-focus-key="results-toggle"]');
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), false, 'the committed layout is displayed');
  assert.equal(await page.evaluate(() => /Annotation editing paused/.test(document.body.textContent)), false, 'no "editing paused" message anywhere');
  assert.equal(await pinsNow(), await drawable(), 'every eligible annotation is drawn again, the individually hidden one is not');
  assert.ok(await pinsNow() >= 1);
  assert.equal(await segments(), 1, 'and so is the saved measurement');
  assert.deepEqual(await editingControls(), { tool: false, edit: false }, 'creating and editing are available with Results open');
  assert.equal(await page.evaluate(() => ![...document.querySelectorAll('.tp3d-annot-panel button')].some(b => /return|apply|preview|autopack/i.test(b.textContent))), true, 'no Annotations control touches AutoPack Results');
  if (await page.evaluate(() => window.probe.StateStore.get('autoPackResults').minimized)) await toggle.click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === false);
  assert.ok(await resultsBox(), 'Results is expanded');
  const results = await resultsState();
  const cargo = await cargoNow();
  const appliedPill = () => page.evaluate(() => Boolean(document.querySelector('.tp3d-autopack-results__current-pill')));
  const stale = () => page.evaluate(() => Boolean(document.querySelector('.tp3d-autopack-results__stale-badge')));
  const wasApplied = await appliedPill();
  assert.equal(await stale(), false);
  const untouched = async message => {
    assert.equal(await resultsState(), results, `${message}: AutoPack Results state is unchanged`);
    assert.equal(await cargoNow(), cargo, `${message}: cargo is unchanged`);
    assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), false, `${message}: still the committed layout`);
    assert.equal(await appliedPill(), wasApplied, `${message}: the Applied marker is as it was`);
    assert.equal(await stale(), false, `${message}: Results did not go stale`);
    assert.equal(await measurementsNow(), measurementsBefore, `${message}: measurements are unchanged`);
  };

  // 1. Editing with Results expanded: every control is reachable and the card keeps clear of Results.
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.waitForTimeout(250);
  assert.deepEqual(await editorControls(page), REACHABLE, 'Save, Cancel and the title field are reachable with Results expanded');
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await resultsBox()), false, 'the editor does not sit under Results');
  await page.fill('.tp3d-annot-editor__input', 'Edited beside Results');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations()[1].title === 'Edited beside Results');
  assert.equal(await editorClosed(page), true);
  await untouched('after an edit with Results expanded');
  assert.ok(await resultsBox(), 'Results is still showing');

  // 2. Creating a callout with Results open: the Callout tool works and the new record is saved.
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await page.waitForFunction(() => /place a callout/i.test(window.probe.hint()));
  const free = await freePoint(page, [GROUND_A, GROUND_B, [140, 0, 60], [200, 0, 75], [60, 0, 40]]);
  const countBefore = await count(page);
  await click(page, free);
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.waitForTimeout(250);
  assert.deepEqual(await editorControls(page), REACHABLE, 'a new callout editor is reachable with Results expanded');
  await page.fill('.tp3d-annot-editor__input', 'New beside Results');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(n => window.probe.annotations().length === n + 1, countBefore);
  await untouched('after creating a callout with Results expanded');
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]'); // disarm

  // 3. Results minimized over the committed layout: still editable.
  await toggle.click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === true);
  const minimizedResults = await resultsState();
  assert.deepEqual(await editingControls(), { tool: false, edit: false }, 'editing is available with Results minimized');
  assert.equal(await pinsNow(), await drawable());
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.waitForTimeout(250);
  assert.deepEqual(await editorControls(page), REACHABLE, 'reachable with Results minimized');
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await resultsBox()), false);
  await page.fill('.tp3d-annot-editor__input', 'Edited while minimized');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations()[0].title === 'Edited while minimized');
  assert.equal(await resultsState(), minimizedResults, 'Results stayed minimized and unchanged');
  assert.equal(await cargoNow(), cargo);
  await toggle.click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === false);
  assert.equal(await resultsState(), results, 'back to the exact expanded state');

  // 4. Results dragged onto the open editor, then elsewhere, then the viewport resized: the editor keeps clear.
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  const dragResultsTo = async (cx, cy) => {
    const head = await boxOf(page, '[data-role="autopack-results-drag"]');
    const startX = head.x + 40;
    const startY = head.y + head.h / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(cx, cy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  let editorBox = await boxOf(page, '.tp3d-annot-editor');
  await dragResultsTo(editorBox.x + editorBox.w / 2, editorBox.y + 40);
  const dragged = JSON.parse(await resultsState());
  assert.ok(dragged.position, 'Results was moved by its owner');
  for (let step = 0; step < 3; step++) {
    editorBox = await boxOf(page, '.tp3d-annot-editor');
    const card = await resultsBox();
    assert.equal(overlaps(editorBox, card), false, `step ${step}: the editor is not under the dragged Results card`);
    assert.deepEqual(await editorControls(page), REACHABLE, `step ${step}: Save, Cancel and the title field stay reachable`);
    if (step === 0) await dragResultsTo(editorBox.x + 20, editorBox.y + editorBox.h - 40);
    if (step === 1) await dragResultsTo(120, 180);
  }
  await page.setViewportSize({ width: 960, height: 680 });
  await page.waitForTimeout(400);
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await resultsBox()), false, 'still clear after the viewport shrinks');
  assert.deepEqual(await editorControls(page), REACHABLE, 'and reachable');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(400);
  assert.deepEqual(await editorControls(page), REACHABLE, 'and reachable after it grows back');
  // The keyboard reaches Save from the title field and Enter on the title saves.
  await page.focus('.tp3d-annot-editor__input');
  let reachedSave = false;
  for (let i = 0; i < 16 && !reachedSave; i++) {
    await page.keyboard.press('Tab');
    reachedSave = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('tp3d-annot-btn--primary'));
  }
  assert.equal(reachedSave, true, 'Tab reaches Save inside the editor');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-editor').hidden);
  const afterDrag = JSON.parse(await resultsState());
  assert.deepEqual({ ...afterDrag, position: null }, { ...JSON.parse(results), position: null }, 'moving Results changed only its position');
  assert.equal(await cargoNow(), cargo);
  assert.equal(await measurementsNow(), measurementsBefore);
  assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), false);
  const savedSoFar = await records();
  assert.notEqual(savedSoFar, before, 'the owner edits were written');
  // Put Results back where it was for the preview checks below.
  await dragResultsTo(700, 700);

  // 5. An unapplied option is a transient layout: everything is hidden, editing is refused, and closing Results does not reveal it.
  await page.click('[aria-label="Next AutoPack option"]');
  await page.waitForFunction(() => window.probe.CaseScene.isTransientPreview());
  await page.waitForFunction(() => /paused during AutoPack preview/.test(window.probe.hint()));
  await frames(page);
  assert.equal(await graphics(), 0, 'unapplied preview: no annotation or measurement graphics');
  assert.deepEqual(await editingControls(), { tool: true, edit: true }, 'and no editing');
  await page.click('[aria-label="Close AutoPack results"]');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), true, 'the preview is not ended by closing Results (existing behavior)');
  assert.equal(await graphics(), 0, 'closing Results during an unapplied preview must not reveal graphics on transient poses');
  assert.deepEqual(await editingControls(), { tool: true, edit: true });
  // Back to the applied option: committed again, and editing needs nothing else.
  await page.click('#btn-autopack-results-reopen');
  await page.click('[aria-label="Previous AutoPack option"]');
  await page.waitForFunction(() => !window.probe.CaseScene.isTransientPreview());
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  await frames(page);
  assert.equal(await pinsNow(), await drawable(), 'committed layout again: drawn');
  assert.equal(await segments(), 1);
  assert.deepEqual(await editingControls(), { tool: false, edit: false }, 'and editable straight away, with Results still open');

  // 6. Reopening Results with an editor open keeps the editor open, clear of the card.
  await page.click('[aria-label="Close AutoPack results"]');
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').closed === true);
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.click('#btn-autopack-results-reopen');
  await page.waitForSelector('[data-role="autopack-results-panel"]');
  await page.waitForTimeout(300);
  assert.equal(await editorClosed(page), false, 'reopening Results does not close the editor');
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await resultsBox()), false);
  assert.deepEqual(await editorControls(page), REACHABLE);
  await page.click('.tp3d-annot-editor__foot .tp3d-annot-btn:not(.tp3d-annot-btn--primary):not(.tp3d-annot-btn--danger)'); // Cancel

  // 7. Applying an option (the owner's own action): the committed layout shows, annotations return, editing is available.
  await page.click('[aria-label="Next AutoPack option"]');
  await page.waitForFunction(() => window.probe.CaseScene.isTransientPreview());
  await frames(page);
  assert.equal(await graphics(), 0);
  await page.getByRole('button', { name: 'Apply this option' }).click();
  await page.waitForFunction(() => !window.probe.CaseScene.isTransientPreview() && !window.probe.OperationLifecycle.isBusy());
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  await frames(page);
  assert.equal(await pinsNow(), await drawable(), 'after Apply the committed layout shows its annotations again');
  assert.equal(await segments(), 1, 'and its measurement');
  assert.deepEqual(await editingControls(), { tool: false, edit: false });
  const lastEditedAfterApply = await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited);
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Edited after Apply');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations()[1].title === 'Edited after Apply');
  assert.ok(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited) >= lastEditedAfterApply);
  assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), false);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.tp3d-autopack-results__current-pill'))), true, 'the applied option is still marked Applied after an annotation edit');
  assert.equal(await stale(), false, 'and an informational edit does not make Results stale');
  await page.click('[aria-label="Close AutoPack results"]');
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').closed === true);
  assert.deepEqual(await editingControls(), { tool: false, edit: false }, 'editing is unchanged once Results closes');
  assert.deepEqual(errors, []);
});

test('an editor whose marker is out of view still keeps clear of AutoPack Results, and returns to its corner when Results moves away', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  // The cargo a callout sits on can be out of view (AutoPack moved it, the camera left it): no marker to place the card by.
  await seed(page, [{ title: 'Out of view', ground: [100000, 100000] }]);
  await page.click('.tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await frames(page, 4);
  const corner = await boxOf(page, '.tp3d-annot-editor');
  // A stand-in for the Results card (the editor reads the card's rectangle from the DOM, wherever it is).
  const placeCard = (left, top) => page.evaluate(([x, y]) => {
    let card = document.querySelector('[data-role="autopack-results-panel"]');
    if (!card) {
      card = document.createElement('section');
      card.setAttribute('data-role', 'autopack-results-panel');
      card.style.cssText = 'position:absolute;width:420px;height:236px;z-index:12;background:#fff;border:1px solid #888';
      document.querySelector('.canvas-wrap').appendChild(card);
    }
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }, [left, top]);
  const card = () => boxOf(page, '[data-role="autopack-results-panel"]');
  await placeCard(corner.x - 300 + 20, 20); // over the editor's corner (card position is relative to .canvas-wrap)
  await frames(page, 6);
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await card()), false, 'the editor leaves the corner Results covers');
  assert.deepEqual(await editorControls(page), REACHABLE, 'and Save, Cancel and the title field are reachable');
  await placeCard(160, 300);
  await frames(page, 6);
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await card()), false, 'it follows Results to a new spot');
  assert.deepEqual(await editorControls(page), REACHABLE);
  await page.evaluate(() => document.querySelector('[data-role="autopack-results-panel"]').remove());
  await frames(page, 6);
  const back = await boxOf(page, '.tp3d-annot-editor');
  assert.deepEqual([back.x, back.y], [corner.x, corner.y], 'with Results gone the editor is back in its corner (the display-only shift left no trace)');
  assert.equal(await page.evaluate(() => window.probe.annotations()[0].title), 'Out of view', 'nothing was written');
  assert.deepEqual(errors, []);
});

test('the desktop panel stays clear of AutoPack Results wherever either is dragged (below, over its header, minimized, resized) and returns exactly when Results moves away', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, Array.from({ length: 6 }, (_, index) => ({ title: `Callout ${index + 1}`, ground: [100 + index * 30, 10] })));
  await frames(page, 4);
  const panel = () => boxOf(page, '#editor-annotation-panel');
  const card = () => boxOf(page, '[data-role="autopack-results-panel"]');
  const wrap = () => boxOf(page, '.canvas-wrap');
  const fitState = () => page.evaluate(() => {
    const style = document.getElementById('editor-annotation-panel').style;
    return { transform: style.transform, limit: style.getPropertyValue('--tp3d-annot-panel-limit'), maxHeight: style.maxHeight };
  });
  // Buttons the panel shows (inside its box and, for rows, inside the scrolled list) that something else is drawn over.
  const covered = () => page.evaluate(() => {
    const root = document.getElementById('editor-annotation-panel');
    const panelRect = root.getBoundingClientRect();
    const listRect = root.querySelector('.tp3d-annot-panel__list').getBoundingClientRect();
    return [...root.querySelectorAll('button')].filter(button => {
      const r = button.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const inPanel = x >= panelRect.left && x <= panelRect.right && y >= panelRect.top && y <= panelRect.bottom;
      const inList = !button.closest('.tp3d-annot-panel__list') || (y >= listRect.top && y <= listRect.bottom);
      return r.width > 0 && r.height > 0 && inPanel && inList;
    }).filter(button => {
      const r = button.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(top && (top === button || button.contains(top)));
    }).length;
  });
  // A stand-in for the Results card (the panel reads its rectangle from the DOM), placed in viewport coordinates.
  const placeCard = ({ x, y, w = 420, h = 236 }) => page.evaluate(([left, top, width, height]) => {
    const host = document.querySelector('.canvas-wrap');
    const origin = host.getBoundingClientRect();
    let stand = document.querySelector('[data-role="autopack-results-panel"]');
    if (!stand) {
      stand = document.createElement('section');
      stand.setAttribute('data-role', 'autopack-results-panel');
      stand.style.cssText = 'position:absolute;z-index:12;background:#fff;border:1px solid #888;box-sizing:border-box';
      host.appendChild(stand);
    }
    Object.assign(stand.style, { left: `${left - origin.left}px`, top: `${top - origin.top}px`, width: `${width}px`, height: `${height}px` });
  }, [x, y, w, h]);
  const removeCard = () => page.evaluate(() => document.querySelector('[data-role="autopack-results-panel"]')?.remove());
  const settled = async () => { await frames(page, 6); return panel(); };
  // Clear of the card, inside the space between the toolbar and the viewport controls, every shown control reachable.
  const assertClear = async (label, expectedBox = null) => {
    const shown = expectedBox || await panel();
    const stand = await card();
    const host = await wrap();
    assert.equal(overlaps(shown, stand), false, `${label}: the panel does not touch Results`);
    assert.equal(await covered(), 0, `${label}: every control it shows is reachable`);
    assert.ok(shown.x >= host.x + 9 && shown.r <= host.r - 57 && shown.y >= host.y + 63 && shown.b <= host.b - 9, `${label}: it stays between the toolbar and the viewport controls`);
  };
  assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').classList.contains('is-compact')), false, 'a desktop-width viewport');
  const full = await panel();
  assert.equal(await covered(), 0);
  assert.deepEqual(await fitState(), { transform: '', limit: '', maxHeight: '' }, 'no Results, no override');

  // 1. Results over the lower rows (its default place): the panel gives up height and its list scrolls.
  await placeCard({ x: full.x - 120, y: full.y + 260 });
  const below = await settled();
  assert.ok(below.h < full.h, 'the panel gives up height instead of running under Results');
  await assertClear('below');
  assert.equal(await page.evaluate(() => { const list = document.querySelector('#editor-annotation-panel .tp3d-annot-panel__list'); return list.scrollHeight > list.clientHeight; }), true, 'the rows that no longer fit scroll');
  await page.evaluate(() => { const rows = document.querySelectorAll('#editor-annotation-panel .tp3d-annot-row'); rows[rows.length - 1].scrollIntoView({ block: 'nearest' }); });
  await frames(page, 2);
  assert.equal(await covered(), 0, 'the last row is reachable once scrolled to');

  // 2. Results dragged over the panel's own header: the panel moves to the nearest clear spot.
  await placeCard({ x: full.x - 160, y: full.y - 30 });
  const aside = await settled();
  assert.notDeepEqual([aside.x, aside.y], [full.x, full.y], 'the panel moves out from under Results');
  await assertClear('over the header');

  // 3. Minimized Results (a 52 px chip) over the header: clear as well.
  await placeCard({ x: full.x - 160, y: full.y - 10, h: 52 });
  await settled();
  await assertClear('minimized chip');

  // 4. Results gone: the stylesheet's own spot, exactly, and nothing is left behind.
  await removeCard();
  const back = await settled();
  assert.deepEqual([back.x, back.y, back.h], [full.x, full.y, full.h], 'with Results gone the panel is exactly where it was');
  assert.deepEqual(await fitState(), { transform: '', limit: '', maxHeight: '' }, 'and no override is left behind');

  // 5. The owner drags the panel somewhere else; Results then covers it. The dragged place is only a preference.
  const grip = async () => page.evaluate(() => { const r = document.querySelector('#editor-annotation-panel .tp3d-annot-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const dragBy = async (dx, dy) => {
    const from = await grip();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
    return { release: () => page.mouse.up() };
  };
  const owner = await dragBy(-300, 120);
  await owner.release();
  const dropped = await settled();
  assert.ok(dropped.x < full.x - 100, 'the owner moved the panel');
  await placeCard({ x: dropped.x - 40, y: dropped.y + 40 });
  await settled();
  await assertClear('dragged panel');
  await removeCard();
  const home = await settled();
  assert.deepEqual([home.x, home.y, home.h], [dropped.x, dropped.y, dropped.h], 'with Results gone it returns to where the owner dropped it');

  // 6. Dragging a panel that is currently shown aside starts from where it is shown, and settles clear on release.
  await placeCard({ x: dropped.x - 40, y: dropped.y + 40 });
  const shown = await settled();
  const second = await dragBy(30, -30); // up: a panel shown aside near the bottom edge cannot go further down
  const during = await panel();
  assert.ok(Math.abs(during.x - (shown.x + 30)) <= 1 && Math.abs(during.y - (shown.y - 30)) <= 1, 'no jump when a drag starts from the shifted panel');
  await second.release();
  await settled();
  await assertClear('after dragging from the shifted spot');
  await removeCard();
  await settled();

  // 7. The window resizes while Results sits over the panel: it re-fits.
  const spot = await panel();
  await placeCard({ x: spot.x - 100, y: spot.y + 60 });
  await settled();
  await page.setViewportSize({ width: 1150, height: 720 });
  await frames(page, 8);
  await assertClear('after a resize');
  await removeCard();
  await frames(page, 6);
  assert.deepEqual(await fitState(), { transform: '', limit: '', maxHeight: '' });

  assert.equal(await page.evaluate(() => window.probe.annotations().length), 6, 'nothing was written');
  assert.deepEqual(errors, []);
});

test('N01: at 1100x620 with both sidebars open, 24 callouts and applied AutoPack Results, the callout editor is never under the Annotations panel: every control takes an ordinary click, the panel yields only while the editor is open, and nothing else changes', { timeout: 300000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser, { width: 1100, height: 620 });
  await seed(page, Array.from({ length: 24 }, (_, index) => ({ title: `Callout ${index + 1}`, ground: [20 + (index % 8) * 60, -40 + Math.floor(index / 8) * 40] })));
  await page.evaluate(() => {
    const { M, PackLibrary } = window.probe;
    const at = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
    if (!PackLibrary.addMeasurement('fixture-pack', { start: at(100, 70), end: at(260, 80) }).ok) throw new Error('measurement seed failed');
  });

  // A real AutoPack, then the applied committed layout with Results expanded at its default spot.
  await page.click('#btn-autopack');
  await page.waitForFunction(() => window.probe.OperationLifecycle.isBusy());
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults') && !window.probe.OperationLifecycle.isBusy(), null, { timeout: 120000 });
  await page.waitForFunction(() => !window.probe.CaseScene.isTransientPreview());
  const toggle = page.locator('[data-focus-key="results-toggle"]');
  if (await page.evaluate(() => window.probe.StateStore.get('autoPackResults').minimized)) await toggle.click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === false);
  // The "Packed N of N cases" toast sits over the top of the panel for a few seconds: start from a quiet screen.
  const toastsGone = () => page.waitForFunction(() => !document.querySelector('#toast-container .toast'), null, { timeout: 30000 });
  await toastsGone();
  await frames(page, 3);

  const SAVE = '.tp3d-annot-editor .tp3d-annot-btn--primary';
  const CANCEL = '.tp3d-annot-editor__foot .tp3d-annot-btn:not(.tp3d-annot-btn--primary):not(.tp3d-annot-btn--danger)';
  const TITLE = '.tp3d-annot-editor__input';
  const PANEL = '#editor-annotation-panel';
  const resultsBox = () => boxOf(page, '[data-role="autopack-results-panel"]');
  const panelState = () => page.evaluate(sel => { const el = document.querySelector(sel); const style = getComputedStyle(el); return { visibility: style.visibility, pointer: style.pointerEvents, display: style.display }; }, PANEL);
  const sweep = async message => {
    assert.deepEqual(await editorControls(page), REACHABLE, `${message}: Title, Save and Cancel are the topmost elements at their centres`);
    assert.equal(await unobstructed(page, SAVE), true, `${message}: Save is clear along its whole width`);
    assert.equal(await unobstructed(page, CANCEL), true, `${message}: Cancel is clear along its whole width`);
    const editor = await boxOf(page, '.tp3d-annot-editor');
    assert.equal(overlaps(editor, await resultsBox()), false, `${message}: Results does not cover the editor`);
    assert.equal(overlaps(editor, await boxOf(page, '#editor-zoom-controls')), false, `${message}: nor do the viewport controls`);
    return editor;
  };
  const stable = async message => {
    const seen = await page.evaluate(() => new Promise(resolve => {
      const rects = new Set();
      let left = 6;
      const step = () => {
        const el = document.querySelector('.tp3d-annot-editor:not([hidden])');
        if (el) { const r = el.getBoundingClientRect(); rects.add([r.left, r.top, r.width, r.height].map(n => n.toFixed(1)).join(',')); }
        left -= 1;
        if (left > 0) window.requestAnimationFrame(step); else resolve([...rects]);
      };
      window.requestAnimationFrame(step);
    }));
    assert.equal(seen.length, 1, `${message}: the editor does not jitter (one rectangle over 6 frames)`);
  };
  const resultsState = () => page.evaluate(() => JSON.stringify(window.probe.StateStore.get('autoPackResults')));
  const records = () => page.evaluate(() => window.probe.annotations());
  const measurementsNow = () => page.evaluate(() => JSON.stringify(window.probe.PackLibrary.getMeasurements('fixture-pack')));
  const appliedPill = () => page.evaluate(() => Boolean(document.querySelector('.tp3d-autopack-results__current-pill')));
  const results0 = await resultsState();
  const cargo0 = await page.evaluate(() => window.probe.casesJson());
  const measurements0 = await measurementsNow();
  const records0 = await records();
  const applied0 = await appliedPill();
  assert.equal(records0.length, 24);
  assert.ok((await resultsBox()).h > 150, 'Results is expanded');
  const panelHome = await boxOf(page, PANEL);
  assert.equal((await panelState()).visibility, 'visible');
  assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), false, 'the applied committed layout is shown');

  // 1. Edit the first callout.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await frames(page, 3);
  const editor = await sweep('with Results expanded');
  // The scenario is the tight one: the panel and the editor genuinely share space, and the panel is the one that gives way.
  assert.equal(overlaps(await boxOf(page, PANEL), editor), true, 'precondition: there is no room for the panel beside the editor');
  assert.deepEqual(await panelState(), { visibility: 'hidden', pointer: 'none', display: 'flex' }, 'the panel yields (kept in place, not painted, not clickable) while the editor is open');
  assert.deepEqual(await boxOf(page, PANEL), panelHome, 'and it never moves or resizes');
  const titleFocused = () => page.evaluate(() => Boolean(document.activeElement && document.activeElement.classList.contains('tp3d-annot-editor__input')));
  assert.equal(await titleFocused(), true, 'keyboard focus is in the editor title');
  await stable('with Results expanded');

  // 2. The title takes a real pointer click, the edit is typed, and Save takes an ordinary click.
  await page.click(TITLE);
  assert.equal(await titleFocused(), true, 'the title field has the focus after a pointer click');
  assert.equal(await page.inputValue(TITLE), 'Callout 1', 'the title is readable');
  await page.fill(TITLE, 'Edited under pressure');
  await page.click(SAVE, { timeout: 5000 });
  await page.waitForFunction(() => window.probe.annotations()[0].title === 'Edited under pressure');
  assert.equal(await editorClosed(page), true);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('editor-annotation-panel')).visibility === 'visible');
  assert.deepEqual(await boxOf(page, PANEL), panelHome, 'with the editor closed the panel is exactly where it was');
  await toastsGone();
  assert.equal(await unobstructed(page, '.tp3d-annot-seg__btn[data-tool="callout"]'), true, 'and its controls are reachable again');
  const after = await records();
  assert.deepEqual(after.slice(1), records0.slice(1), 'no other callout changed');
  assert.deepEqual(after[0].anchor, records0[0].anchor, 'the edited callout keeps its anchor');

  // 3. Reopen, change the text and Cancel with an ordinary click: nothing is saved.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await frames(page, 3);
  await sweep('after reopening');
  await page.fill(TITLE, 'Discard me');
  await page.click(CANCEL, { timeout: 5000 });
  await page.waitForFunction(() => { const el = document.querySelector('.tp3d-annot-editor'); return !el || el.hidden; });
  assert.equal((await records())[0].title, 'Edited under pressure', 'Cancel left the saved text');

  // 4. Results minimized: the editor is still clear of the panel's takeover and Save still takes a click.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await toggle.click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === true);
  await frames(page, 3);
  await sweep('with Results minimized');
  await stable('with Results minimized');
  await toggle.click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === false);
  await frames(page, 3);
  await sweep('with Results expanded again');

  // 5. A larger window leaves room for both; a return to 1100x620 takes the panel back out of the way again, with no jitter.
  for (const [width, height] of [[1400, 900], [1100, 620]]) {
    await page.setViewportSize({ width, height });
    await frames(page, 3);
    const laidOut = await sweep(`after resizing to ${width}x${height}`);
    await stable(`at ${width}x${height}`);
    const hidden = (await panelState()).visibility === 'hidden';
    assert.equal(hidden, overlaps(await boxOf(page, PANEL), laidOut), `at ${width}x${height} the panel yields exactly when the editor needs its space`);
    if (width === 1400) assert.equal(hidden, false, 'with room for both, the panel stays visible beside the editor');
  }
  await page.click(CANCEL, { timeout: 5000 });
  await page.waitForFunction(() => { const el = document.querySelector('.tp3d-annot-editor'); return !el || el.hidden; });
  await page.setViewportSize({ width: 1100, height: 620 });
  await frames(page, 3);
  assert.deepEqual(await boxOf(page, PANEL), panelHome, 'after every transition the panel is where the owner had it');

  // 6. Nothing but the one edited title changed.
  assert.equal(await resultsState(), results0, 'AutoPack Results: run, options, selection and applied option are unchanged');
  assert.equal(await appliedPill(), applied0, 'the Applied marker is as it was');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.tp3d-autopack-results__stale-badge'))), false, 'Results did not go stale');
  assert.equal(await page.evaluate(() => window.probe.casesJson()), cargo0, 'cargo positions and quantities are unchanged');
  assert.equal(await measurementsNow(), measurements0, 'measurements are unchanged');
  assert.deepEqual((await records()).slice(1), records0.slice(1));
  assert.deepEqual(errors, []);
});

test('N01: the panel yields to an open editor only while they share space: an editor dragged over it, a panel dragged over the editor and a resize leave the panel\'s own position and every record untouched', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser); // 1400x900: room for both
  await seed(page, [{ title: 'One', ground: [100, 10] }, { title: 'Two', ground: [200, 30] }, { title: 'Three', ground: [300, -20] }]);
  const PANEL = '#editor-annotation-panel';
  const EDITOR = '.tp3d-annot-editor:not([hidden])';
  const SAVE = '.tp3d-annot-editor .tp3d-annot-btn--primary';
  const CANCEL = '.tp3d-annot-editor__foot .tp3d-annot-btn:not(.tp3d-annot-btn--primary):not(.tp3d-annot-btn--danger)';
  const records0 = await page.evaluate(() => JSON.stringify(window.probe.annotations()));
  const cargo0 = await page.evaluate(() => window.probe.casesJson());
  const panelVisible = () => page.evaluate(sel => getComputedStyle(document.querySelector(sel)).visibility === 'visible', PANEL);
  const sweep = async message => {
    await quietToasts(page, message, t);
    const controls = await editorControls(page);
    // A failure names what covers the control; the toasts on screen at that moment (text and box) are added to it.
    const toasts = JSON.stringify(controls) === JSON.stringify(REACHABLE) ? '' : ` (toasts on screen: ${JSON.stringify(await toastsOnScreen(page))})`;
    assert.deepEqual(controls, REACHABLE, `${message}: Title, Save and Cancel are reachable${toasts}`);
    assert.equal(await unobstructed(page, SAVE), true, `${message}: Save is clear along its whole width`);
    assert.equal(await unobstructed(page, CANCEL), true, `${message}: Cancel is clear along its whole width`);
  };
  const dragFrom = async (grab, to) => {
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move((grab.x + to.x) / 2, (grab.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await frames(page, 3);
  };
  const centre = box => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
  // The editor drags by its header (a press on a button there does not start a drag); the heading text is the plain part of it.
  const headPoint = async () => { const b = await boxOf(page, '.tp3d-annot-editor__heading'); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
  const gripPoint = async () => { const b = await boxOf(page, `${PANEL} .tp3d-annot-grip`); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
  const editorOpen = async () => {
    await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
    await page.waitForSelector(EDITOR);
    await frames(page, 3);
  };
  const editorClose = async () => {
    await page.click(CANCEL, { timeout: 5000 });
    await page.waitForFunction(() => { const el = document.querySelector('.tp3d-annot-editor'); return !el || el.hidden; });
    await frames(page, 3);
  };

  // Room for both: nothing yields and nothing overlaps.
  await editorOpen();
  assert.equal(await panelVisible(), true, 'with room for both the panel stays');
  assert.equal(overlaps(await boxOf(page, EDITOR), await boxOf(page, PANEL)), false);
  // The panel's "Editing callout" hint is shown while an editor is open, so the box to hold steady is the one with the editor open.
  const panelBeside = await boxOf(page, PANEL);
  await sweep('beside the panel');

  // The owner drags the editor over the panel: the panel yields, in place, and the editor stays usable.
  await dragFrom(await headPoint(), centre(await boxOf(page, PANEL)));
  assert.equal(overlaps(await boxOf(page, EDITOR), await boxOf(page, PANEL)), true, 'precondition: the owner put the editor over the panel');
  assert.equal(await panelVisible(), false, 'the panel yields to the editor the owner placed');
  assert.deepEqual(await boxOf(page, PANEL), panelBeside, 'without moving or resizing');
  await sweep('over the panel');

  // Dragged away again, the panel is back at once and exactly where it was.
  await dragFrom(await headPoint(), { x: 400, y: 450 });
  assert.equal(overlaps(await boxOf(page, EDITOR), await boxOf(page, PANEL)), false, 'precondition: the editor is clear of the panel again');
  assert.equal(await panelVisible(), true, 'the panel returns when the editor leaves');
  assert.deepEqual(await boxOf(page, PANEL), panelBeside);
  await sweep('after moving away');

  // The owner drags the panel over the open editor and drops it there: the editor wins, the panel's dropped position is kept.
  await dragFrom(await gripPoint(), centre(await boxOf(page, EDITOR)));
  const dropped = await boxOf(page, PANEL);
  assert.notDeepEqual([dropped.x, dropped.y], [panelBeside.x, panelBeside.y], 'precondition: the panel was moved');
  assert.equal(overlaps(await boxOf(page, EDITOR), dropped), true, 'precondition: the panel was dropped over the editor');
  assert.equal(await panelVisible(), false, 'the panel yields once it is dropped over the editor');
  await sweep('with the panel dropped over it');
  await editorClose();
  assert.equal(await panelVisible(), true, 'closing the editor restores the panel');
  const restored = await boxOf(page, PANEL);
  assert.deepEqual([restored.x, restored.y], [dropped.x, dropped.y], "at the position the owner dropped it, not a position the editor chose");

  // A smaller window: the editor is placed for it and stays usable; the panel yields only if they share space.
  await page.setViewportSize({ width: 1100, height: 620 });
  await frames(page, 4);
  await editorOpen();
  await sweep('at 1100x620');
  assert.equal(await panelVisible(), !overlaps(await boxOf(page, EDITOR), await boxOf(page, PANEL)), 'the panel yields exactly when it shares space with the editor');
  await editorClose();
  assert.equal(await panelVisible(), true);

  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), records0, 'no record changed');
  assert.equal(await page.evaluate(() => window.probe.casesJson()), cargo0, 'cargo is unchanged');
  assert.deepEqual(errors, []);
});

test('real Unpack: the overlay is hidden for the whole animation and returns afterwards from unchanged records', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'On cargo', ...TOP_OF_A, keepExpanded: true }, { title: 'On ground', ground: [520, 10] }]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 2);
  const before = await page.evaluate(() => JSON.stringify(window.probe.annotations()));
  await page.evaluate(() => {
    window.__samples = [];
    const tick = () => {
      window.__samples.push({
        busy: window.probe.OperationLifecycle.isBusy(),
        drawn: document.querySelectorAll('.tp3d-annot-pin:not([hidden]), .tp3d-annot-card:not([hidden])').length,
      });
      window.requestAnimationFrame(tick);
    };
    tick();
  });
  await page.click('#btn-unpack');
  await page.waitForFunction(() => window.__samples.some(sample => sample.busy));
  await page.waitForFunction(() => !window.probe.OperationLifecycle.isBusy());
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length >= 1);
  const samples = await page.evaluate(() => window.__samples);
  assert.equal(samples.filter(sample => sample.busy && sample.drawn > 0).length, 0, 'nothing drawn during Unpack');
  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), before, 'records unchanged');
  assert.equal(await page.evaluate(() => /paused/.test(window.probe.hint())), false);
  assert.deepEqual(errors, []);
});

test('initially offscreen or behind-camera callouts leave no ghost marker, then appear when the camera reaches them', { timeout: 200000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const opened = await openEditor(browser);
  const { page, errors } = opened;
  await seed(page, [
    { title: 'Far east', ground: [100000, 100000] },
    { title: 'Far west', ground: [-100000, -100000] },
    { title: 'Far north', ground: [100000, -100000] },
    { title: 'Far south', ground: [-100000, 100000] },
  ]);
  await page.click('#btn-editor-annotations');
  await page.waitForTimeout(600);
  const pins = () => page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-pin:not(.is-draft)')].map(el => ({
    hidden: el.hidden, label: el.getAttribute('aria-label'), transform: el.style.transform, focusable: !el.hidden && el.tabIndex >= 0,
  })));
  let state = await pins();
  assert.ok(state.length >= 1);
  assert.equal(state.filter(p => !p.hidden).length, 0, 'nothing is shown for positions that are offscreen or behind the camera');
  assert.equal(state.filter(p => p.focusable).length, 0, 'and no keyboard target is left behind');
  assert.ok(state.filter(p => !p.hidden).every(p => p.label), 'nothing visible lacks an accessible name');
  // Bring one into view.
  await page.evaluate(() => {
    const { SceneManager } = window.probe;
    const controls = SceneManager.getControls(); const cam = SceneManager.getCamera();
    const target = SceneManager.vecInchesToWorld({ x: 100000, y: 0, z: 100000 });
    controls.target.copy(target);
    cam.position.copy(target.clone().add(cam.position.clone().sub(SceneManager.vecInchesToWorld({ x: 300, y: 0, z: 0 })).setLength(3000)));
    controls.update();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.tp3d-annot-pin:not(.is-draft)')].some(el => !el.hidden && el.style.transform), null, { timeout: 20000 });
  state = await pins();
  const shown = state.filter(p => !p.hidden);
  assert.ok(shown.length >= 1 && shown.every(p => p.transform && p.label), 'a marker that comes into view is placed and named');
  assert.deepEqual(errors, []);
});

test('a pending Show Off confirmation only ever applies to the session that asked: Load Plan change, A to B to A and workspace replacement void it', { timeout: 300000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'Kept', ground: [520, 10] }]);
  const ask = async () => {
    await page.click('#btn-editor-annotations').catch(() => {});
    if (await page.evaluate(() => document.getElementById('editor-annotation-panel').hidden)) await page.click('#btn-editor-annotations');
    await page.waitForSelector('.tp3d-annot-seg--show');
    await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__edit');
    await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
    await page.fill('.tp3d-annot-editor__input', 'Typed');
    await showButton(page, 'Off').click();
    await page.waitForSelector('.modal');
  };
  const answer = async () => { await dialogButton(page, 'Discard and turn off').click(); await page.waitForTimeout(300); };
  const recordsOf = id => page.evaluate(pid => JSON.stringify(window.probe.PackLibrary.getAnnotations(pid)), id);
  const drawn = () => page.evaluate(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length);

  // Pack A -> Pack B while pending.
  await ask();
  const packB = await page.evaluate(() => { const copy = window.probe.PackLibrary.duplicate('fixture-pack'); window.probe.StateStore.set({ currentPackId: copy.id }, { skipHistory: true }); return copy.id; });
  await page.waitForFunction(() => document.getElementById('editor-annotation-panel').hidden);
  assert.equal(await drawn(), 1, 'the new Load Plan shows its annotation');
  const storedA = await recordsOf('fixture-pack');
  await answer();
  assert.equal(await drawn(), 1, 'a stale answer does not hide the new Load Plan');
  assert.equal(await recordsOf('fixture-pack'), storedA);
  await page.click('#btn-editor-annotations');
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-seg--show [aria-pressed="true"]').textContent), 'All');
  await page.click('#btn-editor-annotations');

  // A -> B -> A while pending.
  await page.evaluate(() => window.probe.StateStore.set({ currentPackId: 'fixture-pack' }, { skipHistory: true }));
  await ask();
  await page.evaluate(id => window.probe.StateStore.set({ currentPackId: id }, { skipHistory: true }), packB);
  await page.evaluate(() => window.probe.StateStore.set({ currentPackId: 'fixture-pack' }, { skipHistory: true }));
  await page.waitForFunction(() => document.getElementById('editor-annotation-panel').hidden);
  await answer();
  assert.equal(await drawn(), 1, 'coming back to the same plan does not resurrect the old answer');
  assert.equal(await recordsOf('fixture-pack'), storedA);

  // Workspace / session replacement while pending.
  await ask();
  await page.evaluate(() => window.probe.StateStore.replace(window.probe.StateStore.snapshot()));
  await page.waitForFunction(() => document.getElementById('editor-annotation-panel').hidden);
  await answer();
  assert.equal(await drawn(), 1, 'a replaced workspace is not affected');
  assert.equal(await recordsOf('fixture-pack'), storedA, 'and no record changed');

  // In the same session the answer still works.
  await ask();
  await answer();
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-seg--show [aria-pressed="true"]').textContent === 'Off');
  assert.equal(await drawn(), 0);
  assert.deepEqual(errors, []);
});

test('unreadable stored annotations are preserved, flagged and deletable; writing a callout never discards them', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openEditor(browser);
  const raw = [{ id: 'bad', type: 'callout', title: '' }, { id: 'arrow-1', type: 'arrow', schemaVersion: 1, a: {}, b: {} }];
  await page.evaluate(list => {
    const { StateStore } = window.probe;
    StateStore.set({ packLibrary: StateStore.get('packLibrary').map(p => ({ ...p, annotations: list })) }, { skipHistory: true });
  }, raw);
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row').length === 2);
  assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-panel__notice').hidden), false, 'the recovery condition is surfaced');
  assert.match(await page.locator('.tp3d-annot-panel__notice').textContent(), /couldn't be read\. The original data is kept/);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-row')].map(el => ({
    name: el.querySelector('.tp3d-annot-row__name').textContent, selectable: !el.querySelector('.tp3d-annot-row__select').disabled,
    editable: !el.querySelector('.tp3d-annot-row__edit').hidden, issue: el.querySelector('.tp3d-annot-row__issue').textContent,
  })));
  assert.deepEqual(rows.map(r => [r.name, r.selectable, r.editable]), [['Unreadable annotation', false, false], ['Unreadable annotation', false, false]]);
  assert.match(rows[0].issue, /could not be read\. The original is kept until you delete it/);

  const [added] = await seed(page, [{ title: 'New', ground: [520, 10] }]);
  const after = await page.evaluate(() => window.probe.annotations());
  assert.equal(after.length, 3);
  assert.deepEqual(after.filter(r => r.type === 'unreadable').map(r => r.original), raw, 'writing a callout keeps the originals verbatim');
  assert.equal(after.at(-1).id, added.id);
  await page.click('.tp3d-annot-row:first-child .tp3d-annot-row__delete');
  await page.waitForFunction(() => window.probe.annotations().length === 2);
  assert.match(await page.locator('.tp3d-annot-panel__undo').textContent(), /Unreadable annotation deleted/);
  await page.click('.tp3d-annot-panel__undo-btn');
  await page.waitForFunction(() => window.probe.annotations().length === 3);
  assert.deepEqual((await page.evaluate(() => window.probe.annotations())).filter(r => r.type === 'unreadable').map(r => r.original), raw, 'Undo restores it verbatim');
  assert.deepEqual(errors, []);
});

test('Annotations and Measurement never own the scene together, and saved callouts stay drawn while Measurement is on', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  await seed(page, [{ title: 'Drawn', ground: [520, 10] }]);
  await page.waitForSelector('.tp3d-annot-pin:not(.is-draft):not([hidden])');
  await page.click('#btn-editor-measure');
  await page.waitForFunction(() => document.getElementById('btn-editor-measure').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.evaluate(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed')), 'false', 'starting Measurement closes the Annotations panel');
  assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').hidden), true);
  assert.equal(await page.evaluate(() => window.probe.AnnotationTool.isActive()), false, 'and disarms the Callout tool');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length), 1, 'saved callouts stay drawn');
  await click(page, await point(page, ...GROUND_A));
  await page.waitForFunction(() => /second point/i.test(document.querySelector('.tp3d-measure-panel__hint').textContent));
  assert.equal(await count(page), 1, 'a click in Measurement Mode never starts a callout');
  assert.equal(await editorClosed(page), true);

  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.getElementById('btn-editor-measure').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.evaluate(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed')), 'true', 'opening Annotations leaves Measurement Mode');
  assert.equal(await page.evaluate(() => window.probe.MeasurementTool.isActive()), false);
  assert.deepEqual(errors, []);
});

// A drawn measurement line's centre in client px (the overlay is passive, so this is where the canvas is hit).
const lineCentre = page => page.evaluate(() => {
  const group = [...document.querySelectorAll('.tp3d-measure-svg__segment')].find(g => g.style.display !== 'none');
  if (!group) return null;
  const n = group.querySelector('.tp3d-measure-svg__line').getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
  const origin = document.getElementById('editor-measure-labels').getBoundingClientRect();
  return { x: origin.left + (n[0] + n[2]) / 2, y: origin.top + (n[1] + n[3]) / 2 };
});

test('Annotations and a saved measurement are on screen together, and only the tool that owns the scene receives input', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'On cargo', ...TOP_OF_A }, { title: 'On ground', ground: [520, 10] }]);
  await page.evaluate(() => {
    const { M, PackLibrary } = window.probe;
    const at = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
    if (!PackLibrary.addMeasurement('fixture-pack', { start: at(100, 70), end: at(260, 80) }).ok) throw new Error('measurement seed failed');
  });
  const drawnPins = () => page.evaluate(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length);
  const drawnLines = () => page.evaluate(() => [...document.querySelectorAll('.tp3d-measure-svg__segment')].filter(g => g.style.display !== 'none').length);
  const ruler = () => page.evaluate(() => window.probe.MeasurementTool.isActive());
  const layerState = () => page.evaluate(() => {
    const layer = document.querySelector('.tp3d-annot-layer');
    return { viewOnly: layer.classList.contains('is-view-only'), inert: layer.inert };
  });
  // Saved lines are an inert view beneath the callout layer (so they never cross an expanded card or the editor); while the
  // ruler owns the scene its live lines, labels and grips are above the (then view-only) callouts.
  const stacking = () => page.evaluate(() => ({
    lines: Number(getComputedStyle(document.getElementById('editor-measure-labels')).zIndex),
    callouts: Number(getComputedStyle(document.querySelector('.tp3d-annot-layer')).zIndex),
  }));
  const savedRecords = () => page.evaluate(() => JSON.stringify([window.probe.annotations(), window.probe.PackLibrary.getMeasurements('fixture-pack'), window.probe.casesJson()]));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 2 && [...document.querySelectorAll('.tp3d-measure-svg__segment')].some(g => g.style.display !== 'none'));
  const before = await savedRecords();

  // 1. Annotations open, ruler off: both are drawn, and the passive line does not get in the callouts' way.
  assert.equal(await ruler(), false);
  assert.deepEqual([await drawnPins(), await drawnLines()], [2, 1], 'callouts and the saved line are drawn together');
  const passive = await stacking();
  assert.ok(passive.lines < passive.callouts, 'the saved line is drawn beneath the callouts');
  assert.deepEqual(await layerState(), { viewOnly: false, inert: false }, 'callouts are interactive while Annotations owns the scene');
  const centre = await lineCentre(page);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('#viewport canvas'), centre), true, 'the line never catches the pointer');
  await click(page, await pinCentreOf(page));
  await page.waitForSelector('.tp3d-annot-card.is-selected, .tp3d-annot-pin.is-selected');

  // 2. The ruler takes the scene: callouts stay drawn but cannot be touched; the ruler gets the click, Delete and Escape.
  await page.click('#btn-editor-measure');
  await page.waitForFunction(() => window.probe.MeasurementTool.isActive());
  await frames(page);
  assert.equal(await page.evaluate(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed')), 'false', 'the Annotations panel closes');
  assert.deepEqual([await drawnPins(), await drawnLines()], [2, 1], 'both stay drawn while the ruler is on');
  assert.deepEqual(await layerState(), { viewOnly: true, inert: true }, 'callouts are view only while the ruler owns the scene');
  const live = await stacking();
  assert.ok(live.lines > live.callouts, 'while the ruler owns the scene its lines, labels and grips are above the callouts');
  const pin = await pinCentreOf(page);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('#viewport canvas'), pin), true, 'a marker does not intercept the ruler\'s click');
  await click(page, pin);
  await page.waitForFunction(() => /second point/i.test(document.querySelector('.tp3d-measure-panel__hint').textContent));
  assert.equal(await editorClosed(page), true, 'the click started a measurement, not a callout editor');
  await page.keyboard.press('Delete');
  await frames(page, 4);
  assert.equal(await count(page), 2, 'Delete never removes a callout while the ruler owns the scene');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.probe.MeasurementTool.isActive());
  assert.equal(await count(page), 2, 'Escape ended the ruler and nothing else');
  assert.equal(await savedRecords(), before, 'neither tool wrote anything');

  // 3. Ruler off again: the line stays as a view, callouts are interactive again (no stale selection or focus trap).
  await frames(page);
  assert.deepEqual([await drawnPins(), await drawnLines()], [2, 1]);
  assert.deepEqual(await layerState(), { viewOnly: false, inert: false });
  assert.deepEqual(await stacking(), passive, 'with the ruler off the saved line goes back beneath the callouts');
  const selectedPinIndex = () => page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])')].findIndex(pin => pin.classList.contains('is-selected')));
  assert.equal(await selectedPinIndex(), 0, 'the callout selected before the ruler is still selected (the ruler never changed it)');
  await click(page, await pinCentreOf(page, '.tp3d-annot-pin:not(.is-draft):not([hidden]):not(.is-selected)'));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin.is-selected').length === 1 && !document.querySelector('.tp3d-annot-pin:not(.is-draft):not([hidden])').classList.contains('is-selected'));
  assert.equal(await selectedPinIndex(), 1, 'a click on another marker selects that callout');
  assert.equal(await ruler(), false, 'selecting a callout never starts the ruler');

  // 4. Opening Annotations from the ruler leaves the ruler: both remain on screen and the Callout tool owns clicks.
  await page.click('#btn-editor-measure');
  await page.waitForFunction(() => window.probe.MeasurementTool.isActive());
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => !window.probe.MeasurementTool.isActive());
  await frames(page);
  assert.deepEqual([await drawnPins(), await drawnLines()], [2, 1]);
  assert.deepEqual(await layerState(), { viewOnly: false, inert: false });
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await page.waitForFunction(() => /place a callout/i.test(window.probe.hint()));
  const onLine = await lineCentre(page);
  await click(page, onLine);
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  assert.equal(await ruler(), false);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tp3d-measure-svg__marker')].filter(marker => marker.style.display !== 'none').length), 0, 'the line shows no ruler marker');
  assert.deepEqual(await stacking(), passive, 'while a callout is being written the saved line is drawn beneath its editor');
  await page.keyboard.press('Escape'); // closes the editor (one owner per Escape)
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-editor').hidden);
  assert.deepEqual(await stacking(), passive, 'and it stays beneath the callouts once the editor closes');
  assert.equal(await savedRecords(), before, 'a cancelled draft on top of the line wrote nothing');
  assert.deepEqual(errors, []);
});

test('a marker facing away from the camera or hidden behind cargo is hollow and dashed; a visible one is solid', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  // Top of a case (faces up, in view), the underside of a case (faces down, away from the camera) and the ground
  // directly under another case (seen only through the cargo).
  await seed(page, [
    { title: 'Top', ...TOP_OF_A },
    { title: 'Underside', cargo: 'cargo-b', local: { x: 10, y: -12, z: 10 } },
    { title: 'Under the case', ground: [300, 20] },
    { title: 'Clear ground', ground: [520, 10] },
  ]);
  // A marker is measured before it is first drawn: there is no solid-then-hollow flash to wait out.
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 4);
  const classes = await page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-pin:not(.is-draft)')].map(el => ({ title: el.title, hollow: el.classList.contains('is-hollow') })));
  const byTitle = Object.fromEntries(classes.map(c => [c.title, c.hollow]));
  assert.equal(byTitle.Top, false, 'faces the camera');
  assert.equal(byTitle['Clear ground'], false, 'nothing in front of it');
  assert.equal(byTitle.Underside, true, 'faces away from the camera');
  assert.equal(byTitle['Under the case'], true, 'seen only through the cargo that stands on it');
  assert.deepEqual(errors, []);
});

test('dragging a marker onto another surface re-attaches that callout only: Escape and a refused drop change nothing, cargo never moves', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const [saved] = await seed(page, [{ title: 'Marker', ground: [520, 10], offset: { dx: 60, dy: -50 } }]);
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  const before = await page.evaluate(() => ({ cases: window.probe.casesJson(), camera: window.probe.camera(), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited }));
  const start = await pinCentreOf(page);
  const drag = async (to, { escape = false } = {}) => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + to.x) / 2, (start.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    if (escape) await page.keyboard.press('Escape');
    await page.mouse.up();
  };

  // Escape mid-drag, and a drop that is refused: the original anchor stays and nothing is written.
  await drag(await point(page, ...GROUND_A), { escape: true });
  assert.deepEqual((await page.evaluate(() => window.probe.annotations()))[0].anchor, saved.anchor, 'Escape restores the marker');
  // A drop on cargo is refused while the Editor holds a scene-only pose (the mesh is not where the plan says).
  await page.evaluate(() => { window.__hold = window.probe.InteractionManager.hasProvisionalPose; window.probe.InteractionManager.hasProvisionalPose = () => true; });
  await drag(await page.evaluate(() => window.probe.cargoPoint('cargo-b')));
  assert.deepEqual((await page.evaluate(() => window.probe.annotations()))[0].anchor, saved.anchor, 'a refused drop leaves it where it was');
  assert.match(await page.evaluate(() => window.probe.hint()), /held case/i, 'and says why');
  await page.evaluate(() => { window.probe.InteractionManager.hasProvisionalPose = window.__hold; });
  assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited), before.edited, 'neither wrote anything');
  assert.deepEqual(await pinCentreOf(page), start, 'the marker is back where it was');

  // A drop on cargo re-attaches to that instance; the card offset is kept, so the card travels with the marker.
  await drag(await page.evaluate(() => window.probe.cargoPoint('cargo-b')));
  await page.waitForFunction(() => window.probe.annotations()[0].anchor.kind === 'cargo');
  const [moved] = await page.evaluate(() => window.probe.annotations());
  assert.equal(moved.anchor.instanceId, 'cargo-b');
  assert.deepEqual([moved.id, moved.title, moved.offset, moved.createdAt], [saved.id, 'Marker', { dx: 60, dy: -50 }, saved.createdAt]);
  assert.equal(await page.evaluate(() => window.probe.casesJson()), before.cases, 'cargo is never moved');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'and never selected');
  assert.equal(await page.evaluate(() => window.probe.camera()), before.camera, 'a marker drag never orbits');
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'a re-attach is not a cargo Undo step');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-card.is-selected').length), 1, 'the callout stays selected');
  assert.deepEqual(errors, []);
});

test('the marker of a new callout can be moved before saving, so the card never attaches to the wrong place', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  await click(page, await point(page, ...GROUND_A));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  assert.match(await page.locator('.tp3d-annot-editor__target-text').textContent(), /Attached to Ground/);
  // Clicking elsewhere with the tool armed moves the temporary marker.
  await page.fill('.tp3d-annot-editor__input', 'Moved before saving');
  const first = await pinCentreOf(page, '.tp3d-annot-pin.is-draft');
  await click(page, await freePoint(page, [[520, 0, 10], [440, 0, -40], [200, 0, -60]]));
  await page.waitForFunction(() => /Marker moved/.test(window.probe.hint()));
  const second = await pinCentreOf(page, '.tp3d-annot-pin.is-draft');
  assert.ok(Math.abs(second.x - first.x) + Math.abs(second.y - first.y) > 20, 'the temporary marker moved');
  assert.equal(await page.inputValue('.tp3d-annot-editor__input'), 'Moved before saving', 'typed text survives moving the marker');
  assert.equal(await count(page), 0, 'nothing is stored until Save');
  // Dragging the temporary marker moves it too: onto cargo, which renames what it is attached to.
  const to = await freePoint(page, [[300, 16, 20], [300, 24, 20], [300, 8, 20]].map(([x, , z]) => [x, 0, z]).concat([[60, 0, 80]]));
  const target = await page.evaluate(() => window.probe.cargoPoint('cargo-b'));
  const dropOn = (await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector('#viewport canvas'), target)) ? target : to;
  await page.mouse.move(second.x, second.y);
  await page.mouse.down();
  await page.mouse.move(dropOn.x, dropOn.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => /Marker moved/.test(window.probe.hint()) && !document.querySelector('.tp3d-annot-pin.is-draft').classList.contains('is-dragging'));
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'cargo is never selected by it');
  await page.click('.tp3d-annot-btn--primary');
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  const [saved] = await page.evaluate(() => window.probe.annotations());
  assert.equal(saved.title, 'Moved before saving');
  assert.ok(['cargo', 'space'].includes(saved.anchor.kind), 'attached where the marker was last dropped');
  if (saved.anchor.kind === 'cargo') assert.equal(saved.anchor.instanceId, 'cargo-b');
  assert.deepEqual(errors, []);
});

test('the panel and its callouts work from the keyboard, and a callout is named for assistive technology', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'UNLOAD FIRST', ground: [520, 10] }]);
  await page.waitForSelector('.tp3d-annot-pin:not(.is-draft):not([hidden])');
  const label = await page.getAttribute('.tp3d-annot-pin:not(.is-draft)', 'aria-label');
  assert.equal(label, 'Callout 1: UNLOAD FIRST');
  await page.focus('.tp3d-annot-pin:not(.is-draft)');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  assert.equal(await page.getAttribute('.tp3d-annot-pin:not(.is-draft)', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('.tp3d-annot-card.is-selected', 'aria-label'), 'Callout 1: UNLOAD FIRST');
  // Edit from the card with the keyboard, Enter in the title saves.
  await page.focus('.tp3d-annot-card.is-selected [data-act="edit"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('tp3d-annot-editor__input')), true);
  await page.keyboard.press('End');
  await page.keyboard.type(' — REAR');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.probe.annotations()[0].title === 'UNLOAD FIRST — REAR');
  assert.equal(await editorClosed(page), true);
  // The tool buttons and display modes are real buttons with pressed state.
  await page.focus('.tp3d-annot-seg__btn[data-tool="callout"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.getAttribute('.tp3d-annot-seg__btn[data-tool="callout"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('.tp3d-annot-seg__btn[data-tool="draw"]', 'aria-label'), 'Draw (not available yet)');
  assert.equal(await page.getAttribute('.tp3d-annot-seg__btn[data-tool="arrow"]', 'aria-label'), null, 'Arrow is a real, named tool now');
  assert.deepEqual(errors, []);
});

test('cargo Undo/Redo never erases or resurrects annotations, and a cargo Undo during an unfinished marker drag cancels only the drag', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const [saved] = await seed(page, [{ title: 'Stays', ground: [520, 10] }]);
  const annotationEditedAt = await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited);
  await page.evaluate(() => {
    const inst = window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === 'cargo-b');
    window.probe.PackLibrary.updateInstance('fixture-pack', 'cargo-b', { transform: { ...inst.transform, position: { ...inst.transform.position, x: inst.transform.position.x + 60 } } });
  });
  await page.focus('#viewport');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.probe.casesJson().includes('"x":300'));
  assert.equal(await count(page), 1, 'Undo keeps the annotation');
  assert.ok(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited) >= annotationEditedAt, 'and never rolls lastEdited back past the annotation edit');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(() => window.probe.casesJson().includes('"x":360'));
  assert.equal(await count(page), 1, 'Redo keeps it too');

  // Ctrl+Z mid-drag cancels the drag and leaves cargo history alone.
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-pin.is-selected');
  const start = await pinCentreOf(page);
  const to = await point(page, ...GROUND_A);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.keyboard.press('Control+z');
  await page.mouse.up();
  assert.deepEqual((await page.evaluate(() => window.probe.annotations()))[0].anchor, saved.anchor, 'the drag was cancelled');
  assert.ok((await page.evaluate(() => window.probe.casesJson())).includes('"x":360'), 'cargo history was not touched');
  assert.deepEqual(errors, []);
});

test('leaving the Load Plan or swapping the workspace closes the panel and drops every unsaved gesture', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openArmed(browser);
  await seed(page, [{ title: 'Kept', ground: [520, 10] }]);
  await click(page, await point(page, ...GROUND_A));
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Unsaved');
  // A workspace swap replaces the whole state: nothing from the old one may linger.
  await page.evaluate(() => window.probe.StateStore.replace(window.probe.StateStore.snapshot()));
  await page.waitForFunction(() => document.getElementById('editor-annotation-panel').hidden);
  assert.equal(await page.evaluate(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed')), 'false');
  assert.equal(await editorClosed(page), true, 'the unsaved card is gone');
  assert.equal(await page.evaluate(() => window.probe.AnnotationTool.isActive()), false);
  assert.equal(await count(page), 1, 'the saved callout stays; the unsaved one wrote nothing');
  assert.equal(await page.evaluate(() => document.getElementById('viewport').style.cursor || getComputedStyle(document.querySelector('#viewport canvas')).cursor !== 'crosshair'), true);
  // Reopening shows it again.
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row').length === 1);
  assert.deepEqual(errors, []);
});

test('on a narrow viewport with AutoPack Results open the editor sheet stays clear of Results, opens on its title and keeps Save and Cancel reachable', { timeout: 480000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'UNLOAD FIRST', ground: [520, 10] }]);
  await page.click('#btn-autopack');
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults') && !window.probe.OperationLifecycle.isBusy(), null, { timeout: 120000 });
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 30000 }); // the "Packed N cases" toast is transient and not part of this layout
  if (await page.evaluate(() => window.probe.StateStore.get('autoPackResults').minimized)) await page.locator('[data-focus-key="results-toggle"]').click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === false);
  // A laptop-sized window with both side panels open leaves a canvas narrower than 500px: the editor becomes a sheet.
  await page.setViewportSize({ width: 960, height: 680 });
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-layer').classList.contains('is-compact'));
  const resultsState = () => page.evaluate(() => JSON.stringify(window.probe.StateStore.get('autoPackResults')));
  const resultsBox = () => boxOf(page, '[data-role="autopack-results-panel"]');
  const cargo = await page.evaluate(() => window.probe.casesJson());
  const results = await resultsState();
  assert.equal(overlaps(await boxOf(page, '#editor-annotation-panel'), await resultsBox()), false, 'the compact panel rides clear of Results, so its rows and tools stay clickable');
  // The first thing the owner sees is the title field: not scrolled out of a short card.
  const titleInView = () => page.evaluate(() => {
    const input = document.querySelector('.tp3d-annot-editor__input').getBoundingClientRect();
    const body = document.querySelector('.tp3d-annot-editor__body').getBoundingClientRect();
    return input.top >= body.top - 0.5 && input.bottom <= body.bottom + 0.5;
  });
  const openEditorFromRow = async () => {
    await page.click('.tp3d-annot-row__edit'); // an ordinary click: it fails if Results covers the row
    await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
    await frames(page, 4);
  };
  const checkSheet = async label => {
    const editor = await boxOf(page, '.tp3d-annot-editor');
    assert.equal(await page.evaluate(() => document.querySelector('.tp3d-annot-editor').classList.contains('is-sheet')), true, `${label}: the sheet`);
    assert.equal(overlaps(editor, await resultsBox()), false, `${label}: the sheet does not sit under Results`);
    assert.deepEqual(await editorControls(page), REACHABLE, `${label}: Save, Cancel and the title field are reachable`);
    assert.equal(await titleInView(), true, `${label}: the title field is in view when the sheet opens`);
    assert.equal(await resultsState(), results, `${label}: Results is exactly as it was`);
    assert.equal(await page.evaluate(() => window.probe.casesJson()), cargo, `${label}: cargo is unchanged`);
  };
  const dismiss = async () => {
    await page.click('.tp3d-annot-editor__foot .tp3d-annot-btn:not(.tp3d-annot-btn--primary):not(.tp3d-annot-btn--danger)');
    await page.waitForFunction(() => document.querySelector('.tp3d-annot-editor').hidden);
  };

  // Results expanded, wherever it sits: bottom (default), then dragged to the top.
  await openEditorFromRow();
  await checkSheet('Results at the bottom');
  await dismiss();
  const head = await boxOf(page, '[data-role="autopack-results-drag"]');
  await page.mouse.move(head.x + 40, head.y + head.h / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 40, 150, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = JSON.parse(await resultsState());
  assert.ok(afterDrag.position, 'Results was moved by its owner');
  const movedResults = await resultsState();
  await openEditorFromRow();
  const editor = await boxOf(page, '.tp3d-annot-editor');
  assert.equal(overlaps(editor, await resultsBox()), false, 'Results at the top: the sheet is clear');
  assert.deepEqual(await editorControls(page), REACHABLE);
  assert.equal(await titleInView(), true);
  assert.equal(await resultsState(), movedResults);

  // Moving Results while the editor is open: the sheet follows it out of the way.
  const head2 = await boxOf(page, '[data-role="autopack-results-drag"]');
  await page.mouse.move(head2.x + 40, head2.y + head2.h / 2);
  await page.mouse.down();
  await page.mouse.move(head2.x + 40, 430, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await resultsBox()), false, 'the open sheet keeps clear of Results moved over it');
  assert.deepEqual(await editorControls(page), REACHABLE);
  await dismiss();

  // Minimized: the chip is the obstacle.
  await page.locator('[data-focus-key="results-toggle"]').click();
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults').minimized === true);
  await openEditorFromRow();
  assert.equal(overlaps(await boxOf(page, '.tp3d-annot-editor'), await resultsBox()), false, 'minimized Results: the sheet is clear');
  assert.deepEqual(await editorControls(page), REACHABLE);
  assert.equal(await titleInView(), true);
  await dismiss();
  assert.equal(await page.evaluate(() => window.probe.casesJson()), cargo, 'cargo never changed');
  assert.deepEqual(errors, []);
});

test('on a narrow viewport the panel is a bottom sheet clear of the controls and the status button, cards are narrower and the editor is a sheet', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser, { width: 390, height: 800 });
  await seed(page, [{ title: 'UNLOAD FIRST', description: 'Place near the rear doors.', ground: [520, 10] }]);
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  const geometry = await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; };
    return { wrap: { l: wrap.left, t: wrap.top, r: wrap.right, b: wrap.bottom }, panel: rect('#editor-annotation-panel'), controls: rect('#editor-zoom-controls'), card: rect('.tp3d-annot-card.is-selected'), compact: document.getElementById('editor-annotation-panel').classList.contains('is-compact') };
  });
  assert.equal(geometry.compact, true);
  const inside = r => r.l >= geometry.wrap.l - 0.5 && r.r <= geometry.wrap.r + 0.5 && r.t >= geometry.wrap.t - 0.5 && r.b <= geometry.wrap.b + 0.5;
  assert.ok(inside(geometry.panel), 'the panel stays inside the viewport');
  assert.ok(geometry.panel.r <= geometry.controls.l + 0.5, 'and leaves the right-hand controls reachable');
  assert.ok(geometry.panel.b <= geometry.wrap.b - 46, 'and sits above the Load plan status button (14px inset, 32px high)');
  assert.ok(inside(geometry.card), 'the card is clamped inside the viewport');
  assert.equal(Math.round(geometry.card.w), 176, 'cards use the narrower width');

  // The editor replaces the panel as a bottom sheet.
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  const aim = await point(page, 300, 0, 10);
  await click(page, aim);
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  const sheet = await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const r = document.querySelector('.tp3d-annot-editor').getBoundingClientRect();
    return { sheet: document.querySelector('.tp3d-annot-editor').classList.contains('is-sheet'), inside: r.left >= wrap.left && r.right <= document.getElementById('editor-zoom-controls').getBoundingClientRect().left + 0.5 && r.bottom <= wrap.bottom - 46 && r.top >= wrap.top, panelShown: getComputedStyle(document.getElementById('editor-annotation-panel')).display !== 'none' };
  });
  assert.deepEqual(sheet, { sheet: true, inside: true, panelShown: false });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('editor-annotation-panel')).display !== 'none');
  assert.deepEqual(errors, []);
});

// ============================================================================
// Annotations V1B.1: directional arrows. A shaft and a solid head drawn as SVG in the same overlay (never a scene
// object), placed with two clicks (tail, then head), moved one end at a time by two end handles.
// ============================================================================
const armArrow = async page => {
  await page.click('.tp3d-annot-seg__btn[data-tool="arrow"]');
  await page.waitForFunction(() => /arrow tail/i.test(window.probe.hint()));
};
const tailShown = page => page.evaluate(() => {
  const dot = document.querySelector('.tp3d-annot-arrow__tail');
  return Boolean(dot) && dot.style.display !== 'none';
});
// The camera keeps easing for a moment after a drag: wait until it has been still for several frames, so the same
// pixel picks the same scene point again.
const cameraSettled = page => page.evaluate(() => new Promise(resolve => {
  let last = window.probe.camera();
  let still = 0;
  const step = () => {
    const now = window.probe.camera();
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 12) resolve();
    else window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}));
// A drag that orbits the camera: press, move well past the click threshold, release, then let the camera settle.
const orbit = async (page, from, dx = 40, dy = 0) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  await cameraSettled(page);
};
// Only arrows that actually have a shape: a hidden or unresolved arrow keeps an empty group.
const arrowGraphics = page => page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow:not(.is-preview)')]
  .filter(group => group.querySelector('.tp3d-annot-arrow__shaft').getAttribute('d'))
  .map(group => ({
    id: group.dataset.annotId,
    occluded: group.classList.contains('is-occluded'),
    selected: group.classList.contains('is-selected'),
    head: Boolean(group.querySelector('.tp3d-annot-arrow__head').getAttribute('d')),
  })));
// An arrow saved through the real writer (not the creation UI). Each end is `[x, z]` on the ground or `{ cargo, local }`.
const seedArrow = (page, from, to, extra = {}) => page.evaluate(({ from, to, extra }) => {
  const { M, PackLibrary, CaseLibrary } = window.probe;
  const pack = PackLibrary.getById('fixture-pack');
  const anchorOf = spec => {
    if (Array.isArray(spec)) return M.buildSpaceAnchor({ surface: 'ground', point: { x: spec[0], y: 0, z: spec[1] } });
    const inst = pack.cases.find(c => c.id === spec.cargo);
    return M.buildCargoAnchor({ instanceId: inst.id, local: spec.local, caseData: CaseLibrary.getById(inst.caseId) });
  };
  const outcome = PackLibrary.addArrow('fixture-pack', { start: anchorOf(from), end: anchorOf(to), ...extra });
  if (!outcome.ok) throw new Error(`arrow seed failed: ${outcome.reason}`);
  return outcome.annotation;
}, { from, to, extra });
const gripsShown = page => page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-handle:not([hidden])')].map(el => ({ end: el.dataset.end, label: el.getAttribute('aria-label'), tag: el.tagName })));
const gripCentre = (page, end) => page.evaluate(which => {
  const el = document.querySelector(`.tp3d-annot-handle[data-end="${which}"]:not([hidden])`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, end);
const rowOf = (page, index) => page.evaluate(i => {
  const el = document.querySelectorAll('.tp3d-annot-row')[i];
  const ends = [...el.querySelectorAll('.tp3d-annot-row__end')].filter(line => !line.hidden).map(line => ({ text: line.firstChild.textContent, button: line.querySelector('button').textContent }));
  return {
    name: el.querySelector('.tp3d-annot-row__name').textContent, sub: el.querySelector('.tp3d-annot-row__sub').textContent,
    selected: el.classList.contains('is-selected'), flagged: el.querySelector('.tp3d-annot-row__badge').classList.contains('is-flagged'),
    issueShown: !el.querySelector('.tp3d-annot-row__issue').hidden, ends, selectDisabled: el.querySelector('.tp3d-annot-row__select').disabled,
  };
}, index);
const endButton = (id, end) => `.tp3d-annot-row[data-annot-id="${id}"] .tp3d-annot-row__end button[data-end="${end}"]`;
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

test('creating an arrow: two clicks save exactly one record, orbiting never creates or cancels one, a head too close writes nothing, and the tool stays armed', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const before = await page.evaluate(() => ({ cases: window.probe.casesJson(), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited }));
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-seg--tools .tp3d-annot-seg__btn')].map(b => b.disabled)), [false, false, true], 'Arrow is available, Draw is not');
  await armArrow(page);
  assert.equal(await page.getAttribute('.tp3d-annot-seg__btn[data-tool="arrow"]', 'aria-pressed'), 'true');
  assert.equal(await page.locator('.tp3d-annot-panel__arrow-title').textContent(), 'New arrows look', 'the look controls are for the next arrow while none is selected');

  // A drag that orbits the camera is not a click: it places nothing.
  const cameraBefore = await page.evaluate(() => window.probe.camera());
  await orbit(page, await freePoint(page, [GROUND_A, GROUND_B]));
  assert.notEqual(await page.evaluate(() => window.probe.camera()), cameraBefore, 'the camera orbited');
  assert.equal(await tailShown(page), false, 'a camera drag never places a tail');
  assert.equal(await count(page), 0);
  assert.match(await page.evaluate(() => window.probe.hint()), /arrow tail/i);

  // First click: the tail exists on screen only.
  const tailAt = await freePoint(page, [GROUND_A]);
  await click(page, tailAt);
  await page.waitForFunction(() => /arrow should point/i.test(window.probe.hint()));
  assert.equal(await tailShown(page), true, 'a dot marks the tail');
  assert.equal(await count(page), 0, 'nothing is stored after the first click');
  assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited), before.edited);

  // A head on top of the tail (the same pixel) is refused: nothing is written and the tail stays for another try.
  await click(page, tailAt);
  await page.waitForFunction(() => /too close to the tail/i.test(window.probe.hint()));
  assert.equal(await count(page), 0, 'no partial or zero-length record');
  assert.equal(await tailShown(page), true);

  // Orbiting between the clicks keeps the pending tail on the scene point it was placed on.
  await orbit(page, await freePoint(page, [GROUND_B]));
  assert.equal(await tailShown(page), true, 'a camera drag never cancels the pending arrow');
  assert.equal(await count(page), 0);
  assert.match(await page.evaluate(() => window.probe.hint()), /arrow should point|too close/i);

  // The head: exactly one record, the tool stays armed, the new arrow is selected and drawn.
  await click(page, await freePoint(page, [GROUND_B]));
  await page.waitForFunction(() => window.probe.annotations().length === 1);
  const [saved] = await page.evaluate(() => window.probe.annotations());
  assert.deepEqual([saved.type, saved.schemaVersion, saved.color, saved.width, saved.hidden], ['arrow', 1, 'ink', 'regular', false]);
  assert.deepEqual([saved.start.kind, saved.start.surface, saved.end.kind, saved.end.surface], ['space', 'ground', 'space', 'ground']);
  assert.ok(near(saved.start.position.x, GROUND_A[0], 1.5) && near(saved.start.position.z, GROUND_A[2], 1.5), 'the tail is where the first click was');
  assert.ok(near(saved.end.position.x, GROUND_B[0], 1.5) && near(saved.end.position.z, GROUND_B[2], 1.5), 'the head is where the second click was');
  assert.equal(await page.evaluate(() => window.probe.casesJson()), before.cases, 'cargo is never moved');
  assert.ok(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited) > before.edited, 'lastEdited is updated');
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'no cargo Undo step was created');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'cargo selection is untouched');
  assert.equal(await tailShown(page), false);
  assert.equal(await page.getAttribute('.tp3d-annot-seg__btn[data-tool="arrow"]', 'aria-pressed'), 'true', 'the tool stays armed for the next arrow');
  assert.match(await page.evaluate(() => window.probe.hint()), /Arrow saved/);
  // The saved arrow is drawn but not selected: the next click starts another one, and nothing offers its handles yet.
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 1);
  assert.deepEqual((await arrowGraphics(page)).map(({ occluded, selected, head }) => ({ occluded, selected, head })), [{ occluded: false, selected: false, head: true }]);
  assert.deepEqual(await gripsShown(page), [], 'no end handles while a tool owns the scene');
  const row = await rowOf(page, 0);
  assert.deepEqual([row.name, row.sub, row.selected, row.flagged], ['Arrow 1', 'Ground → Ground', false, false], 'the row is named, numbered and says where it is attached');
  assert.equal(await page.locator('.tp3d-annot-panel__count').textContent(), '1');
  assert.equal(await page.locator('.tp3d-annot-panel__arrow-title').textContent(), 'New arrows look', 'with no arrow selected the look controls are for the next arrows');
  const stored = () => page.evaluate(() => JSON.stringify(window.probe.annotations()));
  const edited = () => page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited);
  const placeArrow = async (from, to) => {
    const count = await page.evaluate(() => window.probe.annotations().length);
    await click(page, await freePoint(page, [from]));
    await page.waitForFunction(() => /arrow should point/i.test(window.probe.hint()));
    await click(page, await freePoint(page, [to]));
    await page.waitForFunction(n => window.probe.annotations().length === n + 1, count);
    assert.equal(await page.evaluate(() => window.probe.annotations().length), count + 1, 'exactly one record per arrow');
    return page.evaluate(() => window.probe.annotations().at(-1));
  };
  const selectedRows = () => page.evaluate(() => document.querySelectorAll('.tp3d-annot-row.is-selected').length);

  // With none selected, the look sets what the next arrows start with: it writes nothing, and every new arrow gets it.
  const beforeDefaults = { json: await stored(), edited: await edited() };
  await page.click('.tp3d-annot-panel__arrow .tp3d-annot-swatch[data-color="red"]');
  await page.click('.tp3d-annot-seg--width .tp3d-annot-seg__btn[data-width="bold"]');
  await frames(page, 3);
  assert.deepEqual({ json: await stored(), edited: await edited() }, beforeDefaults, 'choosing defaults writes nothing');
  const second = await placeArrow(GROUND_B, GROUND_A);
  assert.deepEqual([second.color, second.width], ['red', 'bold'], 'the next arrow starts with the defaults just chosen');
  assert.ok(near(second.start.position.x, GROUND_B[0], 1.5) && near(second.end.position.x, GROUND_A[0], 1.5), 'tail first, head second');
  assert.deepEqual((await page.evaluate(() => window.probe.annotations()))[0], saved, 'the first arrow is untouched');
  assert.deepEqual([await selectedRows(), (await rowOf(page, 1)).name, await page.getAttribute('.tp3d-annot-seg__btn[data-tool="arrow"]', 'aria-pressed')], [0, 'Arrow 2', 'true'], 'saving again selects nothing and keeps the tool armed');
  const third = await placeArrow(GROUND_A, GROUND_B);
  assert.deepEqual([third.color, third.width], ['red', 'bold'], 'repeated creation keeps the defaults');

  // A selected arrow is edited on its own: one record changes, the others and the defaults do not.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-panel__arrow-title').textContent === 'Arrow 1 look');
  const beforeEdit = await page.evaluate(() => window.probe.annotations());
  await page.click('.tp3d-annot-panel__arrow .tp3d-annot-swatch[data-color="blue"]');
  await page.click('.tp3d-annot-seg--width .tp3d-annot-seg__btn[data-width="thin"]');
  await page.waitForFunction(() => window.probe.annotations()[0].color === 'blue' && window.probe.annotations()[0].width === 'thin');
  const afterEdit = await page.evaluate(() => window.probe.annotations());
  assert.deepEqual([afterEdit[0].id, afterEdit[0].start, afterEdit[0].end, afterEdit[0].createdAt], [saved.id, saved.start, saved.end, saved.createdAt], 'only the look changed; the ends are untouched');
  assert.deepEqual(afterEdit.slice(1), beforeEdit.slice(1), 'no other arrow is written');
  assert.equal(afterEdit.length, 3, 'editing never adds or removes a record');
  const fourth = await placeArrow(GROUND_B, GROUND_A);
  assert.deepEqual([fourth.color, fourth.width], ['red', 'bold'], 'editing an arrow did not change what new arrows start with');
  assert.equal(await selectedRows(), 0, 'starting an arrow ends the selection');
  assert.deepEqual((await page.evaluate(() => window.probe.annotations())).slice(0, 3).map(({ color, width }) => [color, width]), [['blue', 'thin'], ['red', 'bold'], ['red', 'bold']]);

  // A custom color is one more color: stored as #rrggbb, drawn with it, and again only for the arrow being edited.
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-panel__arrow-title').textContent === 'Arrow 2 look');
  await page.fill('.tp3d-annot-panel__arrow .tp3d-annot-swatch__input', '#12ab34');
  await page.waitForFunction(() => window.probe.annotations()[1].color === '#12ab34');
  await frames(page, 3);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tp3d-annot-arrow.is-selected .tp3d-annot-arrow__shaft')).stroke), 'rgb(18, 171, 52)');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tp3d-annot-arrow.is-selected .tp3d-annot-arrow__shaft')).strokeWidth), '5px', 'bold is a constant 5 screen pixels');
  const fifth = await placeArrow(GROUND_A, GROUND_B);
  assert.deepEqual([fifth.color, fifth.width], ['red', 'bold'], 'a custom color on one arrow is not a new default');
  assert.deepEqual(errors, []);
});

test('an arrow joins two surfaces, follows cargo that moves, and its end handles move one end at a time: Escape and a refused drop change nothing', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const saved = await seedArrow(page, TOP_OF_A, GROUND_B.length ? [GROUND_B[0], GROUND_B[2]] : [0, 0]);
  assert.equal(saved.start.kind, 'cargo');
  assert.equal(saved.start.instanceId, 'cargo-a', 'the instance ID, never the Case ID');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length >= 1);
  assert.match((await rowOf(page, 0)).sub, /^.+ → Ground$/, 'the row says where each end is attached');

  // The tail sits on the picked point of the cargo's top, and follows the cargo when it moves; the record never changes.
  const layerOrigin = () => page.evaluate(() => { const r = document.getElementById('editor-annotation-layer').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const tailOnScreen = () => page.evaluate(() => { const n = document.querySelector('.tp3d-annot-arrow:not(.is-preview) .tp3d-annot-arrow__shaft').getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number); return { x: n[0], y: n[1] }; });
  const expectedTail = async () => {
    const at = await page.evaluate(() => { const [r] = window.probe.resolved(); return window.probe.screenOf(r.start.x, r.start.y, r.start.z); });
    const origin = await layerOrigin();
    return { x: at.x - origin.x, y: at.y - origin.y };
  };
  const first = await tailOnScreen();
  const expected = await expectedTail();
  assert.ok(near(first.x, expected.x, 2.5) && near(first.y, expected.y, 2.5), 'the tail is on the picked surface point');
  const record = JSON.stringify(await page.evaluate(() => window.probe.annotations()));
  await page.evaluate(() => {
    const inst = window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === 'cargo-a');
    window.probe.PackLibrary.updateInstance('fixture-pack', 'cargo-a', {
      transform: { ...inst.transform, position: { ...inst.transform.position, x: inst.transform.position.x + 120, z: inst.transform.position.z + 20 } },
    });
  });
  await page.waitForFunction(old => {
    const n = document.querySelector('.tp3d-annot-arrow:not(.is-preview) .tp3d-annot-arrow__shaft').getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
    return Math.abs(n[0] - old.x) > 20;
  }, first);
  const moved = await tailOnScreen();
  const expectedMoved = await expectedTail();
  assert.ok(near(moved.x, expectedMoved.x, 2.5) && near(moved.y, expectedMoved.y, 2.5), 'after the cargo moved the tail is on the same spot of the cargo');
  assert.equal(JSON.stringify(await page.evaluate(() => window.probe.annotations())), record, 'the stored arrow is unchanged by cargo movement');

  // Select it from the list: two named, focusable end handles appear and the cargo stays unselected.
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-handle:not([hidden])').length === 2);
  assert.deepEqual(await gripsShown(page), [
    { end: 'start', label: 'Arrow 1 tail handle. Drag it, or press Enter and click the scene.', tag: 'BUTTON' },
    { end: 'end', label: 'Arrow 1 head handle. Drag it, or press Enter and click the scene.', tag: 'BUTTON' },
  ]);
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), []);
  const before = await page.evaluate(() => ({ cases: window.probe.casesJson(), camera: window.probe.camera(), edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited, json: JSON.stringify(window.probe.annotations()) }));
  const head = await gripCentre(page, 'end');
  const drag = async (to, { escape = false } = {}) => {
    await page.mouse.move(head.x, head.y);
    await page.mouse.down();
    await page.mouse.move((head.x + to.x) / 2, (head.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    if (escape) await page.keyboard.press('Escape');
    await page.mouse.up();
  };

  // Escape mid-drag, and a drop that is refused: the head stays where it was and nothing is written.
  await drag(await page.evaluate(() => window.probe.cargoPoint('cargo-b')), { escape: true });
  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), before.json, 'Escape restores the end');
  await page.evaluate(() => { window.__hold = window.probe.InteractionManager.hasProvisionalPose; window.probe.InteractionManager.hasProvisionalPose = () => true; });
  await drag(await page.evaluate(() => window.probe.cargoPoint('cargo-b')));
  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), before.json, 'a refused drop leaves it where it was');
  assert.match(await page.evaluate(() => window.probe.hint()), /held case/i, 'and says why');
  await page.evaluate(() => { window.probe.InteractionManager.hasProvisionalPose = window.__hold; });
  assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited), before.edited, 'neither wrote anything');

  // A drop on other cargo moves the head only: same arrow, same tail, cargo untouched, no cargo Undo step.
  await drag(await page.evaluate(() => window.probe.cargoPoint('cargo-b')));
  await page.waitForFunction(() => window.probe.annotations()[0].end.kind === 'cargo');
  const [after] = await page.evaluate(() => window.probe.annotations());
  const [original] = JSON.parse(before.json);
  assert.equal(after.end.instanceId, 'cargo-b');
  assert.deepEqual([after.id, after.start, after.color, after.width, after.createdAt], [original.id, original.start, original.color, original.width, original.createdAt], 'only the head moved');
  assert.equal(await page.evaluate(() => window.probe.casesJson()), before.cases, 'cargo never moves');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), [], 'and is never selected');
  assert.equal(await page.evaluate(() => window.probe.camera()), before.camera, 'a handle drag never orbits');
  // The only Undo step is this test's own cargo move; the handle drag added none, and Undo leaves the arrow as moved.
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), true, 'the cargo move above is the one step');
  assert.equal(await page.evaluate(() => window.probe.StateStore.undo()), false, 'a handle drag is not a cargo Undo step');
  assert.equal((await page.evaluate(() => window.probe.annotations()))[0].end.instanceId, 'cargo-b', 'Undo never takes back an arrow edit');
  assert.match(await page.evaluate(() => window.probe.hint()), /Arrow head moved/);
  assert.equal((await arrowGraphics(page)).length, 1);
  assert.equal((await gripsShown(page)).length, 2, 'the arrow stays selected');

  // The keyboard route: Enter on a handle waits for a click on the scene, which sets that end. (A click right after
  // a drag is deliberately swallowed for one tick, so let that tick pass: timers of equal delay fire in order.)
  await page.evaluate(() => new Promise(resolve => window.setTimeout(resolve, 0)));
  await page.focus('.tp3d-annot-handle[data-end="start"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /set the arrow tail/i.test(window.probe.hint()));
  await click(page, await freePoint(page, [GROUND_A]));
  await page.waitForFunction(() => window.probe.annotations()[0].start.kind === 'space');
  assert.equal((await page.evaluate(() => window.probe.annotations()))[0].end.instanceId, 'cargo-b', 'the head is untouched');
  assert.deepEqual(errors, []);
});

test('Valid, Needs Review and Unresolved arrows: only a Valid one is drawn, each broken end is explained on its own, and Re-attach repairs one end at a time', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const ids = [
    (await seedArrow(page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]])).id,
    (await seedArrow(page, TOP_OF_B, [520, 10])).id,
    (await seedArrow(page, { cargo: 'cargo-a', local: { x: -10, y: 16, z: 0 } }, { cargo: 'cargo-a', local: { x: 10, y: 16, z: 0 } })).id,
  ];
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row').length === 3);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 3);
  const stored = JSON.stringify(await page.evaluate(() => window.probe.annotations()));
  assert.deepEqual((await arrowGraphics(page)).map(g => g.id).sort(), [...ids].sort(), 'all three are Valid and drawn');

  // A Case size change asks for review of the arrow on that Case: nothing is drawn or relocated, and the record is untouched.
  await page.evaluate(() => {
    const { StateStore } = window.probe;
    const caseId = window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === 'cargo-b').caseId;
    StateStore.set({ caseLibrary: StateStore.get('caseLibrary').map(c => (c.id === caseId ? { ...c, dimensions: { ...c.dimensions, length: c.dimensions.length + 6 } } : c)) }, { skipHistory: true });
  });
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 2);
  const review = await rowOf(page, 1);
  assert.equal(review.sub, 'Needs review');
  assert.equal(review.flagged, true, 'a dashed ring, never a placed glyph');
  assert.deepEqual(review.ends.map(e => [e.button, /size or shape changed/i.test(e.text)]), [['Re-attach tail', true]], 'only the tail needs attention, with its own reason and action');
  assert.match(review.ends[0].text, /^Tail: /);
  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), stored, 'nothing is rewritten or relocated');

  // Deleting the cargo both ends sit on leaves that arrow Unresolved, with a reason for each end and a Re-attach for each.
  await page.evaluate(() => window.probe.PackLibrary.removeInstances('fixture-pack', ['cargo-a']));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 1);
  const gone = await rowOf(page, 2);
  assert.equal(gone.sub, 'Unresolved');
  assert.deepEqual(gone.ends.map(e => e.button), ['Re-attach tail', 'Re-attach head']);
  assert.ok(gone.ends.every(e => /no longer in this Load Plan/.test(e.text)));
  assert.equal(await count(page), 3, 'editing cargo never deletes an annotation');
  assert.deepEqual((await arrowGraphics(page)).map(g => g.id), [ids[0]], 'no partial or invalid arrow is drawn');

  // Re-attach the tail: Escape cancels without writing; a click on a surface moves only that end.
  const edited = await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited);
  await page.click(endButton(ids[2], 'start'));
  await page.waitForFunction(() => /set the arrow tail/i.test(window.probe.hint()));
  await page.focus('#viewport');
  await page.keyboard.press('Escape');
  assert.doesNotMatch(await page.evaluate(() => window.probe.hint()), /set the arrow tail/i);
  assert.equal(await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited), edited, 'a cancelled re-attach writes nothing');
  await page.click(endButton(ids[2], 'start'));
  await page.waitForFunction(() => /set the arrow tail/i.test(window.probe.hint()));
  await click(page, await freePoint(page, [GROUND_A]));
  await page.waitForFunction(id => window.probe.annotations().find(r => r.id === id).start.kind === 'space', ids[2]);
  assert.deepEqual((await rowOf(page, 2)).ends.map(e => e.button), ['Re-attach head'], 'the repaired end is no longer listed');
  assert.equal((await rowOf(page, 2)).sub, 'Unresolved', 'the arrow stays broken until both ends resolve');
  assert.equal((await arrowGraphics(page)).length, 1, 'and is still not drawn');
  await page.click(endButton(ids[2], 'end'));
  await page.waitForFunction(() => /set the arrow head/i.test(window.probe.hint()));
  await click(page, await freePoint(page, [GROUND_B]));
  await page.waitForFunction(id => window.probe.resolved().find(r => r.id === id).status === 'valid', ids[2]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 2);
  const [, , repaired] = await page.evaluate(() => window.probe.annotations());
  assert.equal(repaired.id, ids[2], 'the same arrow, repaired');
  assert.deepEqual([repaired.start.kind, repaired.end.kind], ['space', 'space']);
  assert.deepEqual(errors, []);
});

test('an unfinished arrow is dropped without writing by Escape (one owner per press), closing the panel, Show Off, Measurement Mode, an operation, a preview, a cargo move, a pointer cancel and a Load Plan change', { timeout: 300000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const edited = () => page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited);
  const before = await edited();
  const armed = () => page.evaluate(() => document.querySelector('.tp3d-annot-seg__btn[data-tool="arrow"]').getAttribute('aria-pressed') === 'true');
  const startArrow = async (at = GROUND_A) => {
    if (!(await armed())) await armArrow(page);
    await click(page, at.length === 3 ? await freePoint(page, [at]) : at);
    await page.waitForFunction(() => /arrow should point/i.test(window.probe.hint()));
    assert.equal(await tailShown(page), true);
  };
  const nothingWritten = async message => {
    await page.waitForFunction(() => { const dot = document.querySelector('.tp3d-annot-arrow__tail'); return !dot || dot.style.display === 'none'; });
    assert.equal(await tailShown(page), false, `${message}: the tail is gone`);
    assert.equal(await count(page), 0, `${message}: nothing was stored`);
    assert.equal(await edited(), before, `${message}: the Load Plan was not edited`);
  };

  // Escape: the unfinished arrow first, then the armed tool (one owner per press).
  await startArrow();
  assert.equal(await escapeConsumed(page), true);
  await page.waitForFunction(() => !/arrow should point/i.test(window.probe.hint()));
  await nothingWritten('Escape');
  assert.equal(await armed(), true, 'the first Escape ends only the unfinished arrow');
  assert.equal(await escapeConsumed(page), true);
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-seg__btn[data-tool="arrow"]').getAttribute('aria-pressed') === 'false');
  assert.equal(await escapeConsumed(page), false, 'with nothing left to close the Editor handles Escape');

  // Switching tool, closing the panel and Show Off.
  await startArrow();
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await nothingWritten('switching tool');
  await armArrow(page);
  await startArrow();
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.getElementById('editor-annotation-panel').hidden);
  await nothingWritten('closing the panel');
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => !document.getElementById('editor-annotation-panel').hidden);
  await startArrow();
  await page.click('.tp3d-annot-seg--show .tp3d-annot-seg__btn:has-text("Off")');
  await page.waitForFunction(() => /hidden in the view/i.test(window.probe.hint()));
  await nothingWritten('Show Off');
  assert.equal(await armed(), false, 'Show Off also disarms the tool');
  await page.click('.tp3d-annot-seg--show .tp3d-annot-seg__btn:has-text("All")');

  // An operation that owns the Editor, a transient preview, and Measurement Mode.
  await startArrow();
  await page.evaluate(() => { window.__op = window.probe.OperationLifecycle.beginOperation('autopacking'); });
  await page.waitForFunction(() => /paused during AutoPack/.test(window.probe.hint()));
  await nothingWritten('AutoPack');
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__op));
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  await startArrow();
  await page.evaluate(() => { window.__preview = window.probe.CaseScene.isTransientPreview; window.probe.CaseScene.isTransientPreview = () => true; });
  await page.waitForFunction(() => /paused during AutoPack preview/.test(window.probe.hint()));
  await nothingWritten('an AutoPack preview');
  await page.evaluate(() => { window.probe.CaseScene.isTransientPreview = window.__preview; });
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  await startArrow();
  await page.click('#btn-editor-measure');
  await page.waitForFunction(() => window.probe.MeasurementTool.isActive());
  await page.waitForFunction(() => { const dot = document.querySelector('.tp3d-annot-arrow__tail'); return !dot || dot.style.display === 'none'; });
  assert.equal(await tailShown(page), false, 'Measurement Mode takes the scene: the tail is gone');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.probe.MeasurementTool.isActive());
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => !document.getElementById('editor-annotation-panel').hidden);
  await nothingWritten('Measurement Mode');

  // A cargo pose change under the tail, and a pointer interaction that is cancelled.
  await armArrow(page);
  await click(page, await page.evaluate(() => window.probe.cargoPoint('cargo-a')));
  await page.waitForFunction(() => /arrow should point/i.test(window.probe.hint()));
  await page.evaluate(() => {
    const inst = window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === 'cargo-a');
    window.probe.PackLibrary.updateInstance('fixture-pack', 'cargo-a', { transform: { ...inst.transform, position: { ...inst.transform.position, x: inst.transform.position.x + 30 } } });
  });
  await page.waitForFunction(() => /cargo changed/i.test(window.probe.hint()));
  assert.equal(await tailShown(page), false, 'cargo moved under the tail');
  assert.equal(await count(page), 0);
  const moved = await page.evaluate(() => window.probe.PackLibrary.getById('fixture-pack').lastEdited);
  await startArrow(GROUND_A);
  const at = await freePoint(page, [GROUND_B]);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.evaluate(() => document.querySelector('#viewport canvas').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
  await page.mouse.up();
  await page.waitForFunction(() => /Placement cancelled/.test(window.probe.hint()));
  assert.equal(await tailShown(page), false, 'a cancelled pointer interaction drops the unfinished arrow');
  assert.equal(await count(page), 0);
  assert.equal(await edited(), moved);

  // A Load Plan change ends the session: nothing from the old one lingers.
  await startArrow();
  await page.evaluate(() => window.probe.StateStore.replace(window.probe.StateStore.snapshot()));
  await page.waitForFunction(() => document.getElementById('editor-annotation-panel').hidden);
  assert.equal(await tailShown(page), false);
  assert.equal(await count(page), 0);
  assert.equal(await page.evaluate(() => window.probe.AnnotationTool.isActive()), false);
  assert.deepEqual(errors, []);
});

test('an arrow hidden by cargo is dashed with a hollow head even when selected; a clear one is solid, and it is measured before it is first drawn', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  // A clear ground arrow, and one whose middle runs under cargo-a (seen only through the cargo that stands on it).
  const clear = await seedArrow(page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]]);
  const hidden = await seedArrow(page, [20, -20], [120, -20]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 2);
  const byId = async () => Object.fromEntries((await arrowGraphics(page)).map(g => [g.id, g]));
  let state = await byId();
  assert.equal(state[clear.id].occluded, false, 'nothing in front of it');
  assert.equal(state[hidden.id].occluded, true, 'part of it is behind cargo');
  const look = id => page.evaluate(arrowId => {
    const group = document.querySelector(`.tp3d-annot-arrow[data-annot-id="${arrowId}"]`);
    return { shaftDash: getComputedStyle(group.querySelector('.tp3d-annot-arrow__shaft')).strokeDasharray, headDash: getComputedStyle(group.querySelector('.tp3d-annot-arrow__head')).strokeDasharray };
  }, id);
  assert.deepEqual(await look(clear.id), { shaftDash: 'none', headDash: 'none' });
  assert.notEqual((await look(hidden.id)).shaftDash, 'none', 'a dashed shaft');
  assert.notEqual((await look(hidden.id)).headDash, 'none', 'and a hollow, dashed head');

  // Selecting it changes the halo and shows the handles, and never makes it look unobstructed.
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow.is-selected').length === 1);
  state = await byId();
  assert.deepEqual([state[hidden.id].selected, state[hidden.id].occluded], [true, true], 'selected and still marked as hidden');
  assert.notEqual((await look(hidden.id)).shaftDash, 'none');
  assert.equal((await gripsShown(page)).length, 2);
  // When the cargo moves off it, the arrow is in the clear again: the state follows the scene and nothing is stored.
  const stored = await page.evaluate(() => JSON.stringify(window.probe.annotations()));
  await page.evaluate(() => {
    const inst = window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === 'cargo-a');
    window.probe.PackLibrary.updateInstance('fixture-pack', 'cargo-a', { transform: { ...inst.transform, position: { ...inst.transform.position, z: inst.transform.position.z + 200 } } });
  });
  await page.waitForFunction(id => !document.querySelector(`.tp3d-annot-arrow[data-annot-id="${id}"]`).classList.contains('is-occluded'), hidden.id);
  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), stored, 'occlusion is derived, never saved');
  assert.deepEqual(errors, []);
});

test('a selected arrow stays one slim arrow: every width keeps its stroke with at most a hairline edge, a hidden one stays one dashed arrow, and the end grips never cover the arrowhead', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  // One clear ground arrow per width, and one whose middle runs under cargo-a.
  const arrows = [
    await seedArrow(page, [100, 62], [260, 66], { color: 'blue', width: 'thin' }),
    await seedArrow(page, [100, 76], [260, 80], { color: 'green', width: 'regular' }),
    await seedArrow(page, [100, 90], [260, 94], { color: 'red', width: 'bold' }),
    await seedArrow(page, [20, -20], [120, -20], { color: 'violet', width: 'regular' }),
  ];
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 4);
  const stored = await page.evaluate(() => JSON.stringify(window.probe.annotations()));
  const looks = id => page.evaluate(arrowId => {
    const group = document.querySelector(`.tp3d-annot-arrow[data-annot-id="${arrowId}"]`);
    const css = selector => getComputedStyle(group.querySelector(selector));
    const accentProbe = document.createElement('i');
    accentProbe.style.color = 'var(--accent-primary)';
    document.body.append(accentProbe);
    const accent = getComputedStyle(accentProbe).color;
    accentProbe.remove();
    const read = selector => ({ stroke: css(selector).stroke, width: parseFloat(css(selector).strokeWidth), dash: css(selector).strokeDasharray });
    return { accent, shaft: read('.tp3d-annot-arrow__shaft'), under: read('.tp3d-annot-arrow__under'), underHead: read('.tp3d-annot-arrow__under-head'), head: read('.tp3d-annot-arrow__head') };
  }, id);
  const gripRing = end => page.evaluate(which => {
    const el = document.querySelector(`.tp3d-annot-handle[data-end="${which}"]:not([hidden])`);
    const ring = getComputedStyle(el, '::before');
    return { diameter: parseFloat(ring.width), fill: ring.backgroundColor };
  }, end);
  const select = async index => {
    await page.click(`.tp3d-annot-row:nth-child(${index + 1}) .tp3d-annot-row__select`);
    await page.waitForFunction(id => document.querySelector(`.tp3d-annot-arrow[data-annot-id="${id}"]`).classList.contains('is-selected'), arrows[index].id);
    await frames(page, 3);
  };
  const SHAFT = { thin: 2, regular: 3, bold: 5 };
  const unselected = [];
  for (const arrow of arrows) unselected.push(await looks(arrow.id));

  for (const [index, width] of ['thin', 'regular', 'bold'].entries()) {
    await select(index);
    const own = await looks(arrows[index].id);
    assert.equal(own.shaft.width, SHAFT[width], `${width}: the selected shaft keeps its preset width`);
    assert.equal(own.shaft.stroke, unselected[index].shaft.stroke, `${width}: the authored color is untouched by selection`);
    assert.notEqual(own.shaft.stroke, own.accent, `${width}: the shaft is never recolored to the selection color`);
    assert.equal(unselected[index].under.width, SHAFT[width] + 4, `${width}: an unselected arrow keeps a neutral halo`);
    assert.notEqual(unselected[index].under.stroke, own.accent);
    // The selection edge is a hairline: one pixel a side, never wider than the neutral halo it replaces.
    assert.equal(own.under.stroke, own.accent, `${width}: the edge uses the selection color`);
    assert.equal(own.under.width, SHAFT[width] + 2, `${width}: one pixel a side, so a selected Thin arrow is still thin`);
    assert.equal(own.underHead.width, 2, `${width}: the head edge is a hairline too`);
    assert.equal(own.under.dash, 'none');
    // Every other arrow is left exactly as it was.
    for (const other of arrows.filter((_, i) => i !== index)) {
      const now = await looks(other.id);
      const was = unselected[arrows.indexOf(other)];
      assert.deepEqual([now.under.width, now.under.stroke, now.shaft.width], [was.under.width, was.under.stroke, was.shaft.width], 'an unselected arrow does not change');
    }
    // The grips: a filled tail ring and a hollow head ring no larger than the smallest arrowhead, so direction stays readable.
    assert.equal((await gripsShown(page)).length, 2, `${width}: both end grips`);
    const [tail, head] = [await gripRing('start'), await gripRing('end')];
    assert.ok(head.diameter <= 12 && tail.diameter <= 12, `${width}: grips are no larger than the smallest arrowhead (12 px)`);
    assert.equal(head.fill, 'rgba(0, 0, 0, 0)', `${width}: the head grip is hollow, so the arrowhead shows through it`);
    assert.notEqual(tail.fill, 'rgba(0, 0, 0, 0)', `${width}: the tail grip is filled`);
  }

  // Hidden by cargo and selected: one dashed arrow. The halo follows the shaft's dashes in the same neutral tone as before
  // selection, so no continuous line (and no solid orange sheath) shows through the gaps.
  await select(3);
  const hidden = await looks(arrows[3].id);
  assert.equal((await arrowGraphics(page)).find(g => g.id === arrows[3].id).occluded, true, 'it is behind cargo');
  assert.notEqual(hidden.shaft.dash, 'none', 'a dashed shaft');
  assert.equal(hidden.under.dash, hidden.shaft.dash, 'the halo is dashed with the same pattern, on the same path');
  assert.notEqual(hidden.under.stroke, hidden.accent, 'no orange sheath behind the dashes');
  assert.notEqual(hidden.underHead.stroke, hidden.accent, 'nor around the hollow head');
  assert.equal(hidden.under.width, SHAFT.regular + 4, 'the halo is as wide as an unselected one');
  assert.notEqual(hidden.head.dash, 'none', 'the head stays hollow and dashed');
  assert.equal((await gripsShown(page)).length, 2, 'the grips and the list row still mark the selection');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tp3d-annot-row.is-selected').length), 1);

  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), stored, 'styling never writes a record');
  assert.deepEqual(errors, []);
});
test('occlusion follows the synchronized scene: cargo moved off or onto a ground arrow or marker re-measures it, also when the meshes synchronize after the first measurement, and an unchanged scene is never re-measured', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  // An arrow whose middle runs under cargo-a, and a callout on the ground under cargo-b (each seen only through that cargo).
  const arrow = await seedArrow(page, [20, -20], [120, -20]);
  await seed(page, [{ title: 'Under the case', ground: [300, 20] }]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 1 && document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 1);
  // Count every occlusion measurement (each reads the scene's raycast meshes) and note when the last one ran.
  await page.evaluate(() => {
    const { CaseScene } = window.probe;
    const real = CaseScene.getRaycastMeshes.bind(CaseScene);
    window.__rays = 0;
    window.__rayAt = performance.now();
    CaseScene.getRaycastMeshes = () => { window.__rays += 1; window.__rayAt = performance.now(); return real(); };
  });
  const looks = () => page.evaluate(id => ({
    arrow: document.querySelector(`.tp3d-annot-arrow[data-annot-id="${id}"]`).classList.contains('is-occluded'),
    marker: document.querySelector('.tp3d-annot-pin:not(.is-draft)').classList.contains('is-hollow'),
  }), arrow.id);
  const becomes = async (expected, label) => {
    await page.waitForFunction(([id, want]) => {
      const a = document.querySelector(`.tp3d-annot-arrow[data-annot-id="${id}"]`).classList.contains('is-occluded');
      const m = document.querySelector('.tp3d-annot-pin:not(.is-draft)').classList.contains('is-hollow');
      return a === want.arrow && m === want.marker;
    }, [arrow.id, expected]);
    assert.deepEqual(await looks(), expected, label);
  };
  // No measurement has run for a moment: the next change meets a refresh that is due, which is the ordinary case. One
  // cargo moves per step, as in a single Load Plan edit (a second change right behind it would re-measure by itself).
  const quiet = () => page.waitForFunction(() => performance.now() - window.__rayAt > 150);
  const moveCargo = (id, delta) => page.evaluate(([cargo, by]) => {
    const { PackLibrary } = window.probe;
    const inst = PackLibrary.getById('fixture-pack').cases.find(c => c.id === cargo);
    PackLibrary.updateInstance('fixture-pack', cargo, { transform: { ...inst.transform, position: { ...inst.transform.position, z: inst.transform.position.z + by } } });
  }, [id, delta]);
  const rays = () => page.evaluate(() => window.__rays);
  const sceneZ = id => page.evaluate(cargo => window.probe.CaseScene.getObject(cargo).position.z, id);
  const committedZ = id => page.evaluate(cargo => window.probe.PackLibrary.getById('fixture-pack').cases.find(c => c.id === cargo).transform.position.z, id);
  await becomes({ arrow: true, marker: true }, 'both start behind cargo');
  const stored = await page.evaluate(() => JSON.stringify(window.probe.annotations()));
  const camera = await page.evaluate(() => window.probe.camera());

  // 1. The ordinary Editor path, both ways: a Load Plan edit moves one cargo (no drag) and the view never moves.
  await quiet();
  await moveCargo('cargo-a', 200);
  await becomes({ arrow: false, marker: true }, 'cargo-a moved off the arrow: only the arrow is in the clear');
  await quiet();
  await moveCargo('cargo-b', 200);
  await becomes({ arrow: false, marker: false }, 'cargo-b moved off the marker: both are in the clear');
  await quiet();
  await moveCargo('cargo-a', -200);
  await becomes({ arrow: true, marker: false }, 'cargo-a moved back onto the arrow');
  await quiet();
  await moveCargo('cargo-b', -200);
  await becomes({ arrow: true, marker: true }, 'cargo-b moved back onto the marker');

  // 2. The meshes synchronize AFTER the tool measured: the scene sync is held, the change is measured against the old layout,
  //    then the sync completes and the new layout is measured from the synchronized scene with no camera move.
  for (const [id, hiddenAfter] of [['cargo-a', { arrow: false, marker: true }], ['cargo-b', { arrow: false, marker: false }]]) {
    await quiet();
    await page.evaluate(() => {
      const { CaseScene } = window.probe;
      window.__realSync = CaseScene.sync;
      CaseScene.sync = () => {}; // the Editor's render reaches the tool, but the scene does not synchronize yet
    });
    const before = await rays();
    const heldZ = await sceneZ(id);
    await moveCargo(id, 200);
    await page.waitForFunction(count => window.__rays > count, before);
    await quiet();
    assert.equal(await sceneZ(id), heldZ, `${id}: the scene still holds the old layout`);
    assert.notEqual(await committedZ(id), heldZ, `${id}: while the committed layout has moved`);
    assert.notDeepEqual(await looks(), hiddenAfter, `${id}: measured against the old layout while the scene had not synchronized`);
    await page.evaluate(() => {
      const { CaseScene, PackLibrary } = window.probe;
      CaseScene.sync = window.__realSync;
      CaseScene.sync(PackLibrary.getById('fixture-pack'));
    });
    await becomes(hiddenAfter, `${id}: the completed sync re-measures the new layout`);
    assert.notEqual(await sceneZ(id), heldZ, `${id}: the scene now shows the committed layout`);
  }
  assert.equal(await page.evaluate(() => window.probe.camera()), camera, 'no camera move was needed');

  // 3. An unchanged scene is never re-measured: re-syncing the same layout, and frames passing, run no more rays.
  await quiet();
  const settledRays = await rays();
  const revision = await page.evaluate(() => window.probe.CaseScene.getGeometryRevision());
  await page.evaluate(() => window.probe.CaseScene.sync(window.probe.PackLibrary.getById('fixture-pack')));
  await frames(page, 12);
  assert.equal(await page.evaluate(() => window.probe.CaseScene.getGeometryRevision()), revision, 'syncing the same layout is not a change');
  assert.equal(await rays(), settledRays, 'nothing moved, so nothing was measured again');
  assert.equal(await page.evaluate(() => JSON.stringify(window.probe.annotations())), stored, 'occlusion is derived, never saved');
  assert.deepEqual(errors, []);
});

test('arrows and a saved measurement are on screen together; while Measurement Mode owns the scene the arrows stay drawn but take no input', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const arrow = await seedArrow(page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]]);
  await page.evaluate(() => {
    const { M, PackLibrary } = window.probe;
    const at = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
    if (!PackLibrary.addMeasurement('fixture-pack', { start: at(100, 90), end: at(260, 100) }).ok) throw new Error('measurement seed failed');
  });
  const drawnLines = () => page.evaluate(() => [...document.querySelectorAll('.tp3d-measure-svg__segment')].filter(g => g.style.display !== 'none').length);
  await page.waitForFunction(() => [...document.querySelectorAll('.tp3d-measure-svg__segment')].some(g => g.style.display !== 'none'));
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-handle:not([hidden])').length === 2);
  const saved = () => page.evaluate(() => JSON.stringify([window.probe.annotations(), window.probe.PackLibrary.getMeasurements('fixture-pack'), window.probe.casesJson()]));
  const before = await saved();
  assert.deepEqual([(await arrowGraphics(page)).length, await drawnLines()], [1, 1], 'the arrow and the saved line are drawn together');
  const stacking = await page.evaluate(() => ({ lines: Number(getComputedStyle(document.getElementById('editor-measure-labels')).zIndex), annotations: Number(getComputedStyle(document.querySelector('.tp3d-annot-layer')).zIndex) }));
  assert.ok(stacking.lines < stacking.annotations, 'the saved line is drawn beneath the arrow layer');

  // Measurement Mode takes the scene: the arrow stays drawn as a view, its handles take no input, Delete and Escape are the ruler's.
  await page.click('#btn-editor-measure');
  await page.waitForFunction(() => window.probe.MeasurementTool.isActive());
  await frames(page, 3);
  assert.deepEqual([(await arrowGraphics(page)).length, await drawnLines()], [1, 1], 'both stay drawn while the ruler is on');
  assert.deepEqual(await page.evaluate(() => ({ viewOnly: document.querySelector('.tp3d-annot-layer').classList.contains('is-view-only'), inert: document.querySelector('.tp3d-annot-layer').inert })), { viewOnly: true, inert: true });
  assert.deepEqual(await gripsShown(page), [], 'no handle is offered while another tool owns the scene');
  await page.keyboard.press('Delete');
  await frames(page, 3);
  assert.equal(await count(page), 1, 'Delete never removes the arrow while the ruler owns the scene');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.probe.MeasurementTool.isActive());
  assert.equal(await saved(), before, 'neither tool wrote anything');
  await page.waitForFunction(() => !document.querySelector('.tp3d-annot-layer').classList.contains('is-view-only'));
  assert.equal((await arrowGraphics(page))[0].id, arrow.id);
  assert.deepEqual(errors, []);
});

test('arrows are DOM and SVG above the canvas: no scene objects are added, the canvas pixels are unchanged, and unreadable recovery records stay inert', { timeout: 180000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const base = await page.evaluate(() => ({ pixels: window.probe.canvasData(), objects: window.probe.sceneObjectCount() }));
  const first = await seedArrow(page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]], { color: 'blue', width: 'thin' });
  await seedArrow(page, TOP_OF_B, TOP_OF_A, { color: 'green', width: 'bold' });
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 2);
  const drawn = await page.evaluate(() => ({ pixels: window.probe.canvasData(), objects: window.probe.sceneObjectCount() }));
  assert.equal(drawn.objects, base.objects, 'no scene object is added');
  assert.equal(drawn.pixels, base.pixels, 'arrows never reach the canvas pixels (and so never a Screenshot, PDF view or thumbnail)');
  assert.deepEqual(await page.evaluate(() => ({
    insideViewport: Boolean(document.querySelector('#viewport .tp3d-annot-arrow, #viewport .tp3d-annot-handle')),
    svgInLayer: document.getElementById('editor-annotation-layer').contains(document.querySelector('.tp3d-annot-svg .tp3d-annot-arrow')),
    clickThrough: getComputedStyle(document.querySelector('.tp3d-annot-svg')).pointerEvents,
    label: document.getElementById('editor-annotation-layer').getAttribute('aria-label'),
  })), { insideViewport: false, svgInLayer: true, clickThrough: 'none', label: 'Annotations' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tp3d-annot-arrow[data-annot-id] .tp3d-annot-arrow__shaft')).strokeWidth), '2px', 'thin is a constant 2 screen pixels');

  // A recovery record that merely wraps a perfectly valid arrow stays inert: not listed as an arrow, never drawn, never edited.
  const original = JSON.parse(JSON.stringify(first));
  await page.evaluate(({ original }) => {
    const { StateStore, PackLibrary } = window.probe;
    PackLibrary.deleteAnnotation('fixture-pack', original.id);
    const pack = PackLibrary.getById('fixture-pack');
    StateStore.set({ packLibrary: StateStore.get('packLibrary').map(p => (p.id === pack.id ? { ...p, annotations: [{ id: 'wrapped', type: 'unreadable', schemaVersion: 1, reason: 'Saved by a newer version of the app.', original }, ...p.annotations] } : p)) }, { skipHistory: true });
  }, { original });
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row').length === 2);
  const wrapper = await rowOf(page, 0);
  assert.deepEqual([wrapper.name, wrapper.selectDisabled, wrapper.flagged], ['Unreadable annotation', true, true]);
  assert.equal((await arrowGraphics(page)).length, 1, 'only the real arrow is drawn');
  await seedArrow(page, [GROUND_B[0], GROUND_B[2]], [GROUND_A[0], GROUND_A[2]]);
  assert.deepEqual((await page.evaluate(() => window.probe.annotations())).find(r => r.id === 'wrapped').original, original, 'writing an arrow keeps the wrapped original verbatim');
  assert.deepEqual(errors, []);
});

test('real AutoPack: arrows are clean while it runs, and on the applied layout they are drawn and editable beside Results, which never changes', { timeout: 480000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  const arrow = await seedArrow(page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]]);
  await page.evaluate(() => {
    const { M, PackLibrary } = window.probe;
    const at = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
    if (!PackLibrary.addMeasurement('fixture-pack', { start: at(100, 90), end: at(260, 100) }).ok) throw new Error('measurement seed failed');
  });
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-handle:not([hidden])').length === 2);
  const segments = () => page.evaluate(() => [...document.querySelectorAll('.tp3d-measure-svg__segment')].filter(g => g.style.display !== 'none').length);
  await page.waitForFunction(() => [...document.querySelectorAll('.tp3d-measure-svg__segment')].some(g => g.style.display !== 'none'));
  const records = () => page.evaluate(() => JSON.stringify(window.probe.annotations()));
  const before = await records();
  await page.evaluate(() => {
    window.__samples = [];
    const tick = () => window.requestAnimationFrame(() => window.setTimeout(() => {
      window.__samples.push({
        busy: window.probe.OperationLifecycle.isBusy(),
        drawn: [...document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft, .tp3d-annot-svg .tp3d-annot-arrow__head')].filter(el => el.getAttribute('d')).length
          + document.querySelectorAll('.tp3d-annot-handle:not([hidden])').length,
      });
      tick();
    }, 0));
    tick();
  });
  await page.click('#btn-autopack');
  await page.waitForFunction(() => window.probe.OperationLifecycle.isBusy());
  await page.waitForFunction(() => /paused during AutoPack/.test(window.probe.hint()));
  await page.waitForFunction(() => window.probe.StateStore.get('autoPackResults') && !window.probe.OperationLifecycle.isBusy(), null, { timeout: 120000 });
  assert.equal(await records(), before, 'AutoPack never rewrote an arrow');
  const samples = await page.evaluate(() => window.__samples);
  assert.ok(samples.some(s => s.busy), 'the run was observed');
  assert.equal(samples.filter(s => s.busy && s.drawn > 0).length, 0, 'no arrow, head or handle is ever drawn while AutoPack runs');

  // Results open over the committed layout: the arrow, its handles and the saved measurement are back; editing is available.
  await page.waitForFunction(() => !/paused/.test(window.probe.hint()));
  assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), false, 'the committed layout is displayed');
  await page.waitForFunction(id => document.querySelector(`.tp3d-annot-arrow[data-annot-id="${id}"] .tp3d-annot-arrow__shaft`).getAttribute('d'), arrow.id);
  assert.equal(await segments(), 1, 'the saved measurement is back too');
  // AutoPack replaces the cargo selection, which also ends an annotation selection (as it does for a callout):
  // picking the arrow from the list offers its handles again beside Results.
  assert.equal((await rowOf(page, 0)).selected, false);
  await page.click('.tp3d-annot-row .tp3d-annot-row__select');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-handle:not([hidden])').length === 2);
  assert.deepEqual(await page.evaluate(() => [document.querySelector('.tp3d-annot-seg__btn[data-tool="arrow"]').disabled, document.querySelector('.tp3d-annot-row__eye').disabled]), [false, false], 'creating and editing are available with Results open');
  const results = await page.evaluate(() => JSON.stringify(window.probe.StateStore.get('autoPackResults')));
  const cargo = await page.evaluate(() => window.probe.casesJson());
  const pill = () => page.evaluate(() => Boolean(document.querySelector('.tp3d-autopack-results__current-pill')));
  const wasApplied = await pill();
  const untouched = async message => {
    assert.equal(await page.evaluate(() => JSON.stringify(window.probe.StateStore.get('autoPackResults'))), results, `${message}: AutoPack Results state is unchanged`);
    assert.equal(await page.evaluate(() => window.probe.casesJson()), cargo, `${message}: cargo is unchanged`);
    assert.equal(await page.evaluate(() => window.probe.CaseScene.isTransientPreview()), false, `${message}: still the committed layout`);
    assert.equal(await pill(), wasApplied, `${message}: the Applied marker is as it was`);
  };
  await page.click('.tp3d-annot-panel__arrow .tp3d-annot-swatch[data-color="violet"]');
  await page.waitForFunction(id => window.probe.annotations().find(r => r.id === id).color === 'violet', arrow.id);
  await untouched('editing an arrow');
  await page.click('.tp3d-annot-row .tp3d-annot-row__eye');
  await page.waitForFunction(id => window.probe.annotations().find(r => r.id === id).hidden === true, arrow.id);
  await frames(page, 3);
  assert.equal((await arrowGraphics(page)).length, 0, 'Hide takes it off the view');
  await page.click('.tp3d-annot-row .tp3d-annot-row__eye');
  await page.waitForFunction(id => window.probe.annotations().find(r => r.id === id).hidden === false, arrow.id);
  await untouched('hiding and showing an arrow');
  await armArrow(page);
  const tail = await freePoint(page, [[300, 0, 70], [200, 0, 40], GROUND_A]);
  const head = await freePoint(page, [[420, 0, 80], [480, 0, 60], GROUND_B]);
  await click(page, tail);
  await click(page, head);
  await page.waitForFunction(() => window.probe.annotations().length === 2);
  await untouched('placing an arrow');
  assert.deepEqual(errors, []);
});

test('the arrow look controls never push the rows out of reach beside Results: the panel stays clear, every row and control is reachable by scrolling, and it grows back when Results moves away', { timeout: 240000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'Callout 1', ground: [100, 10] }, { title: 'Callout 2', ground: [140, 10] }]);
  for (const [from, to] of [[[60, -20], [180, -20]], [[10, -30], [10, 40]], [[250, -30], [330, 10]], [[300, 30], [420, 30]]]) await seedArrow(page, from, to);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row').length === 6);
  const panel = () => boxOf(page, '#editor-annotation-panel');
  // Every button the panel has, once scrolled into view (the rows scroll, and so does the body while the look controls show), takes the click.
  const unreachable = () => page.evaluate(() => [...document.querySelectorAll('#editor-annotation-panel button')].filter(button => {
    const r = button.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).filter(button => {
    button.scrollIntoView({ block: 'nearest' });
    const r = button.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(top && (top === button || button.contains(top)));
  }).map(button => button.getAttribute('aria-label') || button.textContent.trim()));
  // A stand-in for the Results card (the panel reads its rectangle from the DOM), below the panel.
  const placeCard = ({ x, y, w = 420, h = 236 }) => page.evaluate(([left, top, width, height]) => {
    const host = document.querySelector('.canvas-wrap');
    const origin = host.getBoundingClientRect();
    let stand = document.querySelector('[data-role="autopack-results-panel"]');
    if (!stand) {
      stand = document.createElement('section');
      stand.setAttribute('data-role', 'autopack-results-panel');
      stand.style.cssText = 'position:absolute;z-index:12;background:#fff;border:1px solid #888;box-sizing:border-box';
      host.appendChild(stand);
    }
    Object.assign(stand.style, { left: `${left - origin.left}px`, top: `${top - origin.top}px`, width: `${width}px`, height: `${height}px` });
  }, [x, y, w, h]);
  const removeCard = () => page.evaluate(() => document.querySelector('[data-role="autopack-results-panel"]')?.remove());
  const lookShown = () => page.evaluate(() => { const el = document.querySelector('.tp3d-annot-panel__arrow'); return Boolean(el) && !el.hidden; });
  const check = async label => {
    const shown = await panel();
    const stand = await boxOf(page, '[data-role="autopack-results-panel"]');
    assert.equal(overlaps(shown, stand), false, `${label}: the panel does not touch Results`);
    assert.deepEqual(await unreachable(), [], `${label}: every row and control can be reached`);
    assert.ok(await lookShown(), `${label}: the arrow look controls are showing`);
  };
  await page.click('.tp3d-annot-row[data-type="arrow"] .tp3d-annot-row__select');
  await page.waitForFunction(() => !document.querySelector('.tp3d-annot-panel__arrow')?.hidden);
  await frames(page, 4);
  const full = await panel();
  assert.deepEqual(await unreachable(), [], 'no Results: everything is reachable');

  // Results below the panel's top part: the panel gives up height, the rows and the look controls scroll together.
  await placeCard({ x: full.x - 120, y: full.y + 230 });
  await frames(page, 8);
  const limited = await panel();
  assert.ok(limited.h < full.h, 'the panel gives up height instead of running under Results');
  await check('arrow selected');

  // The same with only the Arrow tool armed (the look controls are for the next arrow).
  await page.evaluate(() => window.probe.AnnotationTool.isActive());
  await page.focus('#viewport');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row.is-selected').length === 0);
  await armArrow(page);
  await frames(page, 8);
  await check('arrow tool armed');

  // Results away: the panel returns to exactly its full size (a limited panel can grow back).
  await removeCard();
  await frames(page, 8);
  assert.ok(near((await panel()).h, full.h, 1), 'the panel is back to its full height');
  assert.deepEqual(errors, []);
});

test('beside expanded Results the panel never runs under the card and never loses its rows to the look controls: at 1100x620 (also with the Outdated header), at every height down to its floor and compact, Show, the tools, every row, Re-attach and the look controls stay reachable', { timeout: 420000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser, { width: 1100, height: 620 });
  // Two callouts, three Valid arrows and an arrow whose tail sat on cargo that is now gone (Unresolved, with Re-attach).
  await seed(page, [{ title: 'Callout 1', ground: [100, 10] }, { title: 'Callout 2', ground: [140, 10] }]);
  for (const [from, to] of [[[60, -20], [180, -20]], [[10, -30], [10, 40]], [[250, -30], [330, 10]]]) await seedArrow(page, from, to);
  const broken = await seedArrow(page, TOP_OF_B, [520, 10]);
  await page.evaluate(() => window.probe.PackLibrary.removeInstances('fixture-pack', ['cargo-b']));
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row').length === 6);
  const panel = () => boxOf(page, '#editor-annotation-panel');
  const card = () => boxOf(page, '[data-role="autopack-results-panel"]');
  const flows = () => page.evaluate(() => document.querySelector('#editor-annotation-panel .tp3d-annot-panel__body').classList.contains('is-flow'));
  // A stand-in for the Results card (the panel reads its rectangle from the DOM), placed in viewport coordinates.
  const placeCard = ({ x, y, w = 420, h = 237 }) => page.evaluate(([left, top, width, height]) => {
    const host = document.querySelector('.canvas-wrap');
    const origin = host.getBoundingClientRect();
    let stand = document.querySelector('[data-role="autopack-results-panel"]');
    if (!stand) {
      stand = document.createElement('section');
      stand.setAttribute('data-role', 'autopack-results-panel');
      stand.style.cssText = 'position:absolute;z-index:12;background:#fff;border:1px solid #888;box-sizing:border-box';
      host.appendChild(stand);
      // The Editor's own render drops a Results card it did not create when a row is selected: put the stand-in back in
      // the same task, so it stays where the real card would stay through every click below.
      window.__standInObserver = new MutationObserver(() => { if (!stand.isConnected) host.appendChild(stand); });
      window.__standInObserver.observe(host, { childList: true });
    }
    Object.assign(stand.style, { left: `${left - origin.left}px`, top: `${top - origin.top}px`, width: `${width}px`, height: `${height}px` });
  }, [x, y, w, h]);
  const removeCard = () => page.evaluate(() => {
    if (window.__standInObserver) window.__standInObserver.disconnect();
    window.__standInObserver = null;
    document.querySelector('[data-role="autopack-results-panel"]')?.remove();
  });
  // Every visible button the panel has, once scrolled into view, takes the click (nothing is drawn over it).
  const unreachable = () => page.evaluate(() => [...document.querySelectorAll('#editor-annotation-panel button')].filter(button => {
    const r = button.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).filter(button => {
    button.scrollIntoView({ block: 'nearest' });
    const r = button.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(top && (top === button || button.contains(top)));
  }).map(button => button.getAttribute('aria-label') || button.textContent.trim()));
  const inventory = () => page.evaluate(() => {
    const visible = el => el.getClientRects().length > 0;
    const root = document.getElementById('editor-annotation-panel');
    return {
      show: [...root.querySelectorAll('.tp3d-annot-seg--show .tp3d-annot-seg__btn')].filter(visible).length,
      tools: [...root.querySelectorAll('.tp3d-annot-seg--tools .tp3d-annot-seg__btn')].filter(visible).length,
      rows: [...root.querySelectorAll('.tp3d-annot-row__select')].filter(visible).length,
      reattach: [...root.querySelectorAll('button')].filter(b => /^Re-attach/.test(b.textContent.trim()) && visible(b)).length,
      look: [...root.querySelectorAll('.tp3d-annot-panel__arrow .tp3d-annot-seg__btn, .tp3d-annot-panel__arrow .tp3d-annot-swatch')].filter(visible).length,
    };
  });
  // At the top of the body, with no scrolling: do the tool and Show buttons (and the first row) take a click, or does a pinned
  // footer sit over them?
  const hittableAtTop = () => page.evaluate(() => {
    document.querySelector('#editor-annotation-panel .tp3d-annot-panel__body').scrollTop = 0;
    const hit = selector => {
      const el = document.querySelector(`#editor-annotation-panel ${selector}`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(top && (top === el || el.contains(top)));
    };
    return { tools: hit('.tp3d-annot-seg--tools .tp3d-annot-seg__btn'), show: hit('.tp3d-annot-seg--show .tp3d-annot-seg__btn'), row: hit('.tp3d-annot-row__select') };
  });
  const assertUsable = async (label, { look = true, rowAtTop = true } = {}) => {
    const shown = await panel();
    const stand = await card();
    assert.equal(overlaps(shown, stand), false, `${label}: the panel does not touch Results`);
    const top = await hittableAtTop();
    assert.deepEqual([top.tools, top.show], [true, true], `${label}: the tool and Show buttons are in reach without scrolling`);
    if (rowAtTop) assert.equal(top.row, true, `${label}: so is the first row`);
    assert.deepEqual(await unreachable(), [], `${label}: every control it has can be reached`);
    const have = await inventory();
    assert.deepEqual([have.show, have.tools, have.rows, have.reattach > 0, look ? have.look > 0 : true], [3, 3, 6, true, true], `${label}: Show, the tools, every row, Re-attach and the look controls are all there`);
  };

  // An arrow is selected, so its look controls are showing. With no card the panel is at its full size and pins them.
  await page.click('.tp3d-annot-row[data-type="arrow"] .tp3d-annot-row__select');
  await page.waitForFunction(() => !document.querySelector('.tp3d-annot-panel__arrow')?.hidden);
  await frames(page, 6);
  const full = await panel();
  assert.equal(await flows(), false, 'room enough: the look controls stay pinned under the scrolling rows');
  assert.deepEqual(await unreachable(), [], 'no Results: everything is reachable');

  // 1. Normal expanded Results at 1100x620 (the geometry of the real card): 213 px above it.
  await placeCard({ x: full.x - 129, y: full.y + 219, h: 237 });
  await frames(page, 8);
  const normal = await panel();
  assert.ok(near(normal.h, 213, 1.5) && normal.y === full.y, 'it gives up height and keeps its place');
  assert.equal(await flows(), true, 'too short for pinned controls: everything scrolls under the header');
  await assertUsable('normal Results');

  // 2. The Outdated header makes the card taller: 198 px above it, two short of the preferred minimum. No cliff.
  await placeCard({ x: full.x - 129, y: full.y + 204, h: 252 });
  await frames(page, 8);
  const outdated = await panel();
  const outdatedCard = await card();
  assert.ok(near(outdated.h, 198, 1.5) && outdated.y === full.y, 'still docked above the card, a little shorter');
  await assertUsable('Outdated Results');
  // Show, selecting a row and Re-attach take real clicks (they are scrolled to and must not be covered).
  await page.click('.tp3d-annot-seg--show .tp3d-annot-seg__btn:has-text("Selected")');
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-seg--show .tp3d-annot-seg__btn[aria-pressed="true"]').textContent.trim() === 'Selected');
  await page.click('.tp3d-annot-seg--show .tp3d-annot-seg__btn:has-text("All")');
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-seg--show .tp3d-annot-seg__btn[aria-pressed="true"]').textContent.trim() === 'All');
  await page.click('.tp3d-annot-row[data-type="arrow"] .tp3d-annot-row__select >> nth=1');
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-row.is-selected').length === 1);
  await page.click(endButton(broken.id, 'start'));
  await page.waitForFunction(() => /set the arrow tail/i.test(window.probe.hint()));
  await page.focus('#viewport');
  await page.keyboard.press('Escape');
  assert.doesNotMatch(await page.evaluate(() => window.probe.hint()), /set the arrow tail/i, 'Re-attach was reachable and Escape cancels it');
  assert.deepEqual(await card(), outdatedCard, 'Results never moved');
  await page.waitForFunction(() => window.probe.hint() === ''); // the status line is gone: the rows sit where they settle

  // 3. Every height from plenty of room down to the floor: the panel is exactly as tall as the room, never under the card.
  for (const room of [260, 236, 213, 200, 199, 198, 190, 175, 160, 150]) {
    await placeCard({ x: full.x - 129, y: full.y + room + 6, h: 237 });
    await frames(page, 6);
    const shown = await panel();
    assert.ok(near(shown.h, Math.min(full.h, room), 1.5), `${room} px of room: the panel is ${Math.round(shown.h)} px (the room, not a cliff)`);
    await assertUsable(`${room} px of room`, { rowAtTop: room >= 198 });
  }
  // Below the floor nothing useful fits: V1A's rule applies (the panel is left where it is and the card stays on top).
  await placeCard({ x: full.x - 129, y: full.y + 140 + 6, h: 237 });
  await frames(page, 6);
  assert.ok(near((await panel()).h, full.h, 1), 'under the floor the panel is not squeezed into a sliver');

  // 4. The owner's dragged place is a preference: the fit is temporary and ends when Results moves away.
  await removeCard();
  await frames(page, 6);
  const home = await panel();
  assert.deepEqual([home.x, home.y, home.h], [full.x, full.y, full.h], 'with Results gone the panel is back exactly');
  assert.equal(await flows(), false, 'and its look controls are pinned again');
  const grip = () => page.evaluate(() => { const r = document.querySelector('#editor-annotation-panel .tp3d-annot-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const from = await grip();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 120, from.y - 20, { steps: 6 });
  await page.mouse.up();
  await frames(page, 6);
  const dropped = await panel();
  assert.ok(dropped.x < full.x - 80, 'the owner moved the panel');
  await placeCard({ x: dropped.x - 129, y: dropped.y + 204, h: 252 });
  await frames(page, 8);
  assert.ok(near((await panel()).h, 198, 1.5), 'the dragged panel is fitted above the card too');
  await assertUsable('dragged panel beside Outdated Results');
  await removeCard();
  await frames(page, 6);
  const back = await panel();
  assert.deepEqual([back.x, back.y, back.h], [dropped.x, dropped.y, dropped.h], 'with Results gone it returns to where the owner dropped it');

  // 5. Compact: the bottom sheet rides above the card and scrolls as a whole.
  await page.setViewportSize({ width: 500, height: 740 });
  await frames(page, 8);
  const wrap = await boxOf(page, '.canvas-wrap');
  assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').classList.contains('is-compact')), true);
  await placeCard({ x: wrap.x + 60, y: wrap.b - 280, w: 380, h: 250 });
  await frames(page, 10);
  assert.equal(await flows(), true, 'compact: the sheet scrolls as a whole');
  await assertUsable('compact');
  assert.equal(await page.evaluate(() => window.probe.annotations().length), 6, 'nothing was written');
  assert.deepEqual(errors, []);
});

// ============================================================================
// Settings > Show Annotations: a visibility switch like Show Camera Controls, Show Zoom Controls and Show
// Measurement Tool. Off hides the button and every graphic and ends whatever was unfinished; the records
// (and their own hidden flags) are never touched; On draws them again from those records.
// ============================================================================
// The same PreferencesManager.set the Settings overlay's Save changes calls.
const setShowAnnotations = (page, show) => page.evaluate(value => {
  const { PreferencesManager } = window.probe;
  PreferencesManager.set({ ...PreferencesManager.get(), showAnnotations: value });
}, show);
const annotationsButtonShown = page => page.evaluate(() => {
  const button = document.getElementById('btn-editor-annotations');
  return !button.hidden && getComputedStyle(button).display !== 'none';
});
const layerGraphics = page => page.evaluate(() => {
  const shown = selector => [...document.querySelectorAll(selector)].filter(el => !el.hidden).length;
  return {
    hidden: document.getElementById('editor-annotation-layer').hidden,
    pins: shown('.tp3d-annot-pin:not(.is-draft)'),
    cards: shown('.tp3d-annot-card'),
    arrows: document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow:not(.is-preview) .tp3d-annot-arrow__shaft[d]:not([d=""])').length,
    grips: shown('.tp3d-annot-handle'),
  };
});
const annotationState = page => page.evaluate(() => ({
  json: JSON.stringify(window.probe.annotations()),
  edited: window.probe.PackLibrary.getById('fixture-pack').lastEdited,
  cases: window.probe.casesJson(),
  camera: window.probe.camera(),
}));
const nothingUnderway = page => page.evaluate(() => {
  const tool = window.probe.AnnotationTool;
  return !tool.isActive() && !tool.hasDraft() && tool.selectedId() === null;
});

test('Show Annotations Off hides the button and every saved callout and arrow, ends each unfinished gesture without writing and keeps every record; On draws them again from the unchanged records, with no gesture or selection brought back', { timeout: 420000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await cameraSettled(page);
  const [, hiddenOne] = await seed(page, [{ title: 'Kept', ...TOP_OF_B }, { title: 'Hidden one', ground: [200, -30] }]);
  const arrow = await seedArrow(page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]]);
  await page.evaluate(id => {
    if (!window.probe.PackLibrary.updateCallout('fixture-pack', id, { hidden: true }).ok) throw new Error('hide failed');
  }, hiddenOne.id);
  const drawnAsSaved = () => page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 1 &&
    document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow:not(.is-preview) .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 1);
  await drawnAsSaved();
  await cameraSettled(page);
  const base = await annotationState(page);
  assert.equal(JSON.parse(base.json).length, 3);
  assert.equal(JSON.parse(base.json)[1].hidden, true, 'one callout carries its own Hide');

  const expectOff = async label => {
    assert.equal(await annotationsButtonShown(page), false, `${label}: the button is gone`);
    assert.deepEqual(await layerGraphics(page), { hidden: true, pins: 0, cards: 0, arrows: 0, grips: 0 }, `${label}: no callout, card, arrow or end handle is drawn`);
    assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').hidden), true, `${label}: the panel is closed`);
    assert.equal(await nothingUnderway(page), true, `${label}: no armed tool, re-attach, editor or selection is left`);
    assert.equal(await tailShown(page), false, `${label}: no arrow tail is left`);
    assert.equal(await editorClosed(page), true, `${label}: no editor card is left`);
    assert.deepEqual(await annotationState(page), base, `${label}: nothing was written and the view did not move`);
  };
  // Back On: drawn from the saved records and each one's own Hide; the panel stays closed and nothing resumes.
  const turnOnAndReopen = async label => {
    await setShowAnnotations(page, true);
    await drawnAsSaved();
    assert.equal(await annotationsButtonShown(page), true, `${label}: the button is back`);
    assert.equal(await page.getAttribute('#btn-editor-annotations', 'aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').hidden), true, `${label}: the panel is not reopened for the owner`);
    assert.equal(await nothingUnderway(page), true, `${label}: no gesture or selection comes back`);
    assert.deepEqual(await livePins(page), ['1'], `${label}: only the callout without its own Hide is drawn`);
    assert.deepEqual(await annotationState(page), base, `${label}: the records are exactly as saved`);
    await page.click('#btn-editor-annotations');
    await page.waitForFunction(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed') === 'true');
    assert.deepEqual(
      await page.evaluate(() => ['callout', 'arrow'].map(tool => document.querySelector(`.tp3d-annot-seg__btn[data-tool="${tool}"]`).getAttribute('aria-pressed'))),
      ['false', 'false'], `${label}: no tool is armed again`
    );
  };

  // 1. An unsaved callout in its editor card.
  const groundFree = await freePoint(page, [[150, 0, -10], [470, 0, -5], [380, 0, 60]]);
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await page.waitForFunction(() => /place a callout/i.test(window.probe.hint()));
  await click(page, groundFree);
  await page.waitForSelector('.tp3d-annot-editor:not([hidden])');
  await page.fill('.tp3d-annot-editor__input', 'Unsaved');
  await setShowAnnotations(page, false);
  await expectOff('an unsaved callout');
  await turnOnAndReopen('an unsaved callout');

  // 2. The first click of a new arrow.
  await armArrow(page);
  await click(page, await freePoint(page, [[150, 0, -10], [470, 0, -5], [380, 0, 60]]));
  await page.waitForFunction(() => /arrow should point/i.test(window.probe.hint()));
  assert.equal(await tailShown(page), true);
  await setShowAnnotations(page, false);
  await expectOff('an unfinished arrow');
  await turnOnAndReopen('an unfinished arrow');

  // 3. A pending Re-attach of an arrow end (a click on its end handle), with the arrow selected.
  await page.click(`.tp3d-annot-row[data-annot-id="${arrow.id}"] .tp3d-annot-row__select`);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-handle:not([hidden])').length === 2);
  const grip = await gripCentre(page, 'end');
  await click(page, grip);
  await page.waitForFunction(() => window.probe.AnnotationTool.isActive());
  await setShowAnnotations(page, false);
  await expectOff('a pending re-attach');
  await turnOnAndReopen('a pending re-attach');

  // 4. A marker drag still in progress (the button is still held down), then the release after Off.
  const marker = await pinCentreOf(page);
  await page.mouse.move(marker.x, marker.y);
  await page.mouse.down();
  await page.mouse.move(marker.x + 40, marker.y + 25, { steps: 4 });
  await page.mouse.move(marker.x + 80, marker.y + 50, { steps: 4 });
  await page.waitForFunction(() => { const ring = document.querySelector('.tp3d-annot-svg__ghost'); return Boolean(ring) && ring.style.display !== 'none'; });
  await setShowAnnotations(page, false);
  await page.mouse.up();
  await expectOff('a marker drag');
  await turnOnAndReopen('a marker drag');

  // 5. A selected annotation is deselected, never restored by turning the setting back On.
  await page.click('.tp3d-annot-row:nth-child(1) .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  await setShowAnnotations(page, false);
  await expectOff('a selection');
  await turnOnAndReopen('a selection');

  // While Off nothing answers: the marker's old position is just the 3D view, and the tool cannot be opened.
  await setShowAnnotations(page, false);
  assert.equal(await escapeConsumed(page), false, 'Escape belongs to the Editor again');
  await click(page, marker);
  assert.equal(await nothingUnderway(page), true, 'a click where the marker was selects no annotation');
  assert.deepEqual(await page.evaluate(() => window.probe.selection()), ['cargo-b'], 'it reaches the 3D view and selects the cargo under it');
  await page.evaluate(() => window.probe.InteractionManager.setSelection([]));
  assert.deepEqual(await page.evaluate(() => [window.probe.AnnotationTool.openPanel(), window.probe.AnnotationTool.togglePanel()]), [false, false], 'the panel cannot be opened');
  assert.equal(await page.evaluate(() => document.getElementById('editor-annotation-panel').hidden), true);
  const stack = await page.locator('#editor-zoom-controls > button:not([hidden])').evaluateAll(buttons => buttons.map(b => b.id));
  assert.deepEqual(stack, ['btn-editor-measure', 'btn-editor-view', 'btn-editor-zoom-in', 'btn-editor-zoom-out'], 'the other controls keep their order and their own preferences');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('btn-editor-measure')).borderTopWidth), '0px', 'the first visible button carries no stray separator');
  await expectOff('while Off');

  // The view mode is independent: Show Off set before the setting went Off is still Off afterwards.
  await setShowAnnotations(page, true);
  await drawnAsSaved();
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed') === 'true');
  await showButton(page, 'Off').click();
  await page.waitForFunction(() => /hidden in the view/i.test(window.probe.hint()));
  await setShowAnnotations(page, false);
  await setShowAnnotations(page, true);
  assert.deepEqual(await layerGraphics(page), { hidden: false, pins: 0, cards: 0, arrows: 0, grips: 0 }, 'the Show Off view mode is kept: nothing is drawn');
  await page.click('#btn-editor-annotations');
  await page.waitForFunction(() => document.getElementById('btn-editor-annotations').getAttribute('aria-pressed') === 'true');
  await showButton(page, 'All').click();
  await drawnAsSaved();

  // Ordinary use resumes: a callout is placed and saved the usual way, as exactly one record.
  await page.click('.tp3d-annot-seg__btn[data-tool="callout"]');
  await page.waitForFunction(() => /place a callout/i.test(window.probe.hint()));
  const saved = await addCallout(page, await freePoint(page, [[150, 0, -10], [470, 0, -5], [380, 0, 60]]), 'After re-enable');
  assert.equal(saved.title, 'After re-enable');
  assert.equal(await count(page), 4);
  assert.equal(JSON.parse(base.json)[1].hidden, true);
  assert.equal(await page.evaluate(() => window.probe.annotations()[1].hidden), true, 'the callout that was hidden by its owner is still hidden');
  assert.deepEqual(errors, []);
});

test('Show Annotations is a visibility-only change: no Editor render, scene sync, theme refresh, camera or selection change; it follows the other three switches in the group; a saved Off holds after a workspace replacement and a fresh start', { timeout: 300000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openEditor(browser);
  await cameraSettled(page);
  await seed(page, [{ title: 'Kept', ...TOP_OF_B }]);
  await seedArrow(page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]]);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 1 &&
    document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 1);
  await cameraSettled(page);
  const base = await annotationState(page);

  // Count every heavy Editor path, and record which store keys each preference write touches.
  await page.evaluate(() => {
    const { EditorUI, CaseScene, SceneManager, StateStore } = window.probe;
    const spy = { render: 0, sync: 0, theme: 0, writes: [], results: StateStore.get('autoPackResults') };
    for (const [owner, name, key] of [[EditorUI, 'render', 'render'], [CaseScene, 'sync', 'sync'], [SceneManager, 'refreshTheme', 'theme']]) {
      const original = owner[name];
      owner[name] = (...args) => { spy[key] += 1; return original.apply(owner, args); };
    }
    StateStore.subscribe((changes, _state, notification) => spy.writes.push({ keys: Object.keys(changes).sort().join(','), route: notification?.type ?? null }));
    window.__spy = spy;
  });
  const spyNow = () => page.evaluate(() => ({ render: window.__spy.render, sync: window.__spy.sync, theme: window.__spy.theme, writes: window.__spy.writes.slice() }));
  const scene = () => page.evaluate(() => ({ objects: window.probe.sceneObjectCount(), selection: window.probe.selection(), camera: window.probe.camera() }));
  const sceneBefore = await scene();

  await setShowAnnotations(page, false);
  assert.equal(await annotationsButtonShown(page), false);
  assert.deepEqual((await layerGraphics(page)).arrows + (await layerGraphics(page)).pins, 0, 'every saved callout and arrow is off the view');
  await setShowAnnotations(page, true);
  await page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 1);
  const light = await spyNow();
  assert.deepEqual([light.render, light.sync, light.theme], [0, 0, 0], 'no Editor render, no scene sync and no theme refresh');
  assert.deepEqual(light.writes, [
    { keys: 'preferences', route: 'viewport-controls-preference' },
    { keys: 'preferences', route: 'viewport-controls-preference' },
  ], 'only the preference changed, on the lightweight route: no Pack, cargo, selection or AutoPack Results state');
  assert.deepEqual(await scene(), sceneBefore, 'scene objects, selection and camera are untouched');
  assert.equal(await page.evaluate(() => window.probe.StateStore.get('autoPackResults') === window.__spy.results), true, 'AutoPack Results state is the same object');
  assert.deepEqual(await annotationState(page), base, 'no record, Load Plan timestamp or cargo changed');

  // Saved together with another preference it takes the ordinary route and still ends up applied.
  await page.evaluate(() => {
    const { PreferencesManager } = window.probe;
    PreferencesManager.set({ ...PreferencesManager.get(), showAnnotations: false, labelFontSize: 16 });
  });
  await page.waitForFunction(() => document.getElementById('btn-editor-annotations').hidden);
  assert.ok((await spyNow()).render > 0, 'a mixed save renders the Editor');
  assert.equal(await annotationsButtonShown(page), false, 'and Annotations is still hidden by it');
  assert.deepEqual(await layerGraphics(page), { hidden: true, pins: 0, cards: 0, arrows: 0, grips: 0 });
  await page.evaluate(() => {
    const { PreferencesManager } = window.probe;
    PreferencesManager.set({ ...PreferencesManager.get(), showAnnotations: true, labelFontSize: 12 });
  });
  await page.waitForFunction(() => !document.getElementById('btn-editor-annotations').hidden &&
    document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 1);

  // The four switches are independent, and the floating group stays only while one is On.
  const setPref = (key, value) => page.evaluate(([name, on]) => {
    const { PreferencesManager } = window.probe;
    PreferencesManager.set({ ...PreferencesManager.get(), [name]: on });
  }, [key, value]);
  const groupShown = () => page.evaluate(() => getComputedStyle(document.getElementById('editor-zoom-controls')).display !== 'none');
  const visibleButtons = () => page.locator('#editor-zoom-controls > button:not([hidden])').evaluateAll(buttons => buttons.map(b => b.id));
  await setPref('showMeasurementTool', false);
  assert.deepEqual(await visibleButtons(), ['btn-editor-annotations', 'btn-editor-view', 'btn-editor-zoom-in', 'btn-editor-zoom-out'], 'the ruler alone is hidden');
  await setPref('showCameraControls', false);
  await setPref('showZoomControls', false);
  assert.deepEqual(await visibleButtons(), ['btn-editor-annotations']);
  assert.equal(await groupShown(), true, 'Annotations alone keeps the group');
  await setPref('showAnnotations', false);
  assert.deepEqual(await visibleButtons(), []);
  assert.equal(await groupShown(), false, 'all four Off: the group disappears and leaves no empty frame');
  await setPref('showAnnotations', true);
  assert.deepEqual(await visibleButtons(), ['btn-editor-annotations'], 'turning Annotations back On brings the group back with only that button');
  assert.equal(await groupShown(), true);
  assert.equal(await page.evaluate(() => window.probe.PreferencesManager.get().showMeasurementTool), false, 'the other switches were not touched');
  await setPref('showMeasurementTool', true);
  await setPref('showCameraControls', true);
  await setPref('showZoomControls', true);
  assert.deepEqual(await visibleButtons(), ['btn-editor-annotations', 'btn-editor-measure', 'btn-editor-view', 'btn-editor-zoom-in', 'btn-editor-zoom-out']);

  // Hiding the button while it holds keyboard focus hands focus back to the 3D view.
  await page.focus('#btn-editor-annotations');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-editor-annotations');
  await setPref('showAnnotations', false);
  assert.equal(await page.evaluate(() => { const active = document.activeElement; return active.isConnected && active.id !== 'btn-editor-annotations' && active !== document.body; }), true, 'focus did not fall into the page background');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#viewport'))), true, 'it returned to the 3D view');

  // A workspace replacement (a restore or import) keeps the saved Off.
  await page.evaluate(() => window.probe.StateStore.replace(window.probe.StateStore.snapshot()));
  await page.waitForFunction(() => document.getElementById('btn-editor-annotations').hidden);
  assert.deepEqual(await layerGraphics(page), { hidden: true, pins: 0, cards: 0, arrows: 0, grips: 0 });
  assert.equal(await page.evaluate(() => window.probe.PreferencesManager.get().showAnnotations), false);
  assert.equal(await count(page), 2, 'the saved callout and arrow are still stored');
  assert.deepEqual(errors, []);

  // A fresh start with Off already stored: no button and no graphics from the first paint; On draws what was saved.
  const reloaded = await openEditor(browser, undefined, { preferences: { showAnnotations: false } });
  await cameraSettled(reloaded.page);
  assert.equal(await annotationsButtonShown(reloaded.page), false, 'a saved Off is still Off after reload');
  await seed(reloaded.page, [{ title: 'Saved earlier', ...TOP_OF_B }]);
  await seedArrow(reloaded.page, [GROUND_A[0], GROUND_A[2]], [GROUND_B[0], GROUND_B[2]]);
  await frames(reloaded.page, 4);
  assert.deepEqual(await layerGraphics(reloaded.page), { hidden: true, pins: 0, cards: 0, arrows: 0, grips: 0 }, 'saved records are not drawn while Off');
  assert.equal(await count(reloaded.page), 2);
  await setShowAnnotations(reloaded.page, true);
  await reloaded.page.waitForFunction(() => document.querySelectorAll('.tp3d-annot-pin:not(.is-draft):not([hidden])').length === 1 &&
    document.querySelectorAll('.tp3d-annot-svg .tp3d-annot-arrow:not(.is-preview) .tp3d-annot-arrow__shaft[d]:not([d=""])').length === 1);
  assert.equal(await annotationsButtonShown(reloaded.page), true);
  assert.deepEqual(reloaded.errors, []);
});
