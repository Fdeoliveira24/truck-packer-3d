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
  folderLibrary: [], preferences: Defaults.defaultPreferences,
});

let SceneManager = null;
const TrailerGeometry = createTrailerGeometry({ Utils, CorePackLibrary: PackLibrary, getSceneManager: () => SceneManager });
const AppShell = createAppShell({ StateStore, PackLibrary, Utils });
SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore });
const CaseScene = createCaseScene({ SceneManager, CaseLibrary, CategoryService, PackLibrary, StateStore, TrailerGeometry, Utils, PreferencesManager });
const OperationLifecycle = createOperationLifecycle();
const MeasurementTool = createMeasurementTool({ SceneManager, CaseScene, CaseLibrary, PackLibrary, StateStore, PreferencesManager, UIComponents, OperationLifecycle });
const AnnotationTool = createAnnotationTool({ SceneManager, CaseScene, CaseLibrary, PackLibrary, StateStore, UIComponents, OperationLifecycle });
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
  StateStore, OperationLifecycle, SceneManager, CaseScene, PackLibrary, CaseLibrary, InteractionManager, MeasurementTool, AnnotationTool, EditorUI, M, A, UIComponents,
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

async function openEditor(browser, viewport = { width: 1400, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(30000);
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
  assert.deepEqual(panel.tools.map(t => t.disabled), [false, true, true], 'Arrow and Draw are clearly unavailable');
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

test('annotations are read-only while an operation or a preview owns the Editor, the cause is named, and a passive capture changes nothing', { timeout: 150000 }, async t => {
  const browser = await launch();
  t.after(() => browser.close());
  const { page, errors } = await openPanel(browser);
  await seed(page, [{ title: 'First', ground: [520, 10] }, { title: 'Second', ...TOP_OF_B }]);
  await page.click('.tp3d-annot-row:first-child .tp3d-annot-row__select');
  await page.waitForSelector('.tp3d-annot-card.is-selected');
  const blockedText = () => page.evaluate(() => { const el = document.querySelector('.tp3d-annot-panel__blocked'); return el.hidden ? '' : el.textContent; });
  const controls = () => page.evaluate(() => ({
    tool: document.querySelector('.tp3d-annot-seg__btn[data-tool="callout"]').disabled,
    rows: [...document.querySelectorAll('.tp3d-annot-row__eye, .tp3d-annot-row__edit, .tp3d-annot-row__delete')].map(b => b.disabled),
  }));

  // A background thumbnail capture only reads pixels back: nothing is blocked.
  await page.evaluate(() => { window.__capture = window.probe.OperationLifecycle.beginOperation('capturingPreview'); });
  await page.waitForTimeout(300);
  assert.equal(await blockedText(), '', 'a passive capture is not an edit');
  assert.deepEqual(await controls(), { tool: false, rows: [false, false, false, false, false, false] });
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__capture));

  // AutoPack running: editing is read-only and the message names the cause; selecting and viewing still work.
  await page.evaluate(() => { window.__op = window.probe.OperationLifecycle.beginOperation('autopacking'); });
  await page.waitForFunction(() => !document.querySelector('.tp3d-annot-panel__blocked').hidden);
  assert.match(await blockedText(), /read-only while AutoPack is running/i);
  assert.deepEqual(await controls(), { tool: true, rows: [true, true, true, true, true, true] });
  await page.click('.tp3d-annot-card.is-selected [data-act="edit"]');
  assert.equal(await editorClosed(page), true, 'the editor does not open');
  await page.focus('.tp3d-annot-row:first-child .tp3d-annot-row__select');
  await page.keyboard.press('Delete');
  assert.equal(await count(page), 2, 'Delete is refused too');
  const head = await page.locator('.tp3d-annot-card.is-selected .tp3d-annot-card__head').boundingBox();
  await page.mouse.move(head.x + 40, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 120, head.y + 80, { steps: 5 });
  await page.mouse.up();
  assert.equal((await page.evaluate(() => window.probe.annotations()))[0].offset, null, 'a card cannot be moved');
  await page.click('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__select');
  assert.equal(await page.getAttribute('.tp3d-annot-row:nth-child(2) .tp3d-annot-row__select', 'aria-pressed'), 'true', 'selecting is not an edit');
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__op));
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-panel__blocked').hidden);
  assert.deepEqual(await controls(), { tool: false, rows: [false, false, false, false, false, false] }, 'editing resumes when the operation ends');

  // An unapplied AutoPack Results option on screen is not the committed Pack either: the banner says exactly
  // that, says how to get back, and the one-click way back uses the Editor's own landing (nothing is bypassed).
  await page.evaluate(() => {
    const { CaseScene } = window.probe;
    window.__realPreview = CaseScene.isTransientPreview;
    window.__realSync = CaseScene.sync;
    window.__syncs = [];
    CaseScene.sync = (pack, options) => { window.__syncs.push(Boolean(options && options.transientPreview)); return window.__realSync(pack, options); };
    CaseScene.isTransientPreview = () => true;
  });
  await page.waitForFunction(() => !document.querySelector('.tp3d-annot-panel__blocked').hidden);
  const banner = await blockedText();
  assert.match(banner, /read-only while an unapplied AutoPack option is being previewed/i);
  assert.match(banner, /Apply it in AutoPack Results, or return to your saved plan/);
  assert.equal(await page.evaluate(() => /read-only/.test(window.probe.hint())), false, 'the cause is stated once, not repeated under the banner');
  assert.deepEqual(await controls(), { tool: true, rows: [true, true, true, true, true, true] }, 'editing stays refused against transient poses');
  await page.click('.tp3d-annot-panel__blocked button');
  assert.ok((await page.evaluate(() => window.__syncs)).includes(false), 'Return to saved plan renders the committed Pack through the Editor');
  await page.evaluate(() => {
    const { CaseScene } = window.probe;
    CaseScene.isTransientPreview = window.__realPreview;
    CaseScene.sync = window.__realSync;
    window.probe.AnnotationTool.sync();
  });
  await page.waitForFunction(() => document.querySelector('.tp3d-annot-panel__blocked').hidden);
  assert.deepEqual(await controls(), { tool: false, rows: [false, false, false, false, false, false] }, 'once the committed plan shows, editing resumes');
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
  await page.waitForFunction(() => !document.querySelector('.tp3d-annot-panel__blocked').hidden);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tp3d-annot-seg--show .tp3d-annot-seg__btn, .tp3d-annot-seg--display .tp3d-annot-seg__btn')].every(b => !b.disabled)), true);
  await showButton(page, 'Selected').click();
  assert.deepEqual(await pressed(), ['All:false', 'Selected:true', 'Off:false']);
  await page.evaluate(() => window.probe.OperationLifecycle.finishOperation(window.__op));
  assert.deepEqual(await snapshot(), afterHide, 'still nothing written');

  // The mode never outlives the panel.
  await showButton(page, 'Off').click();
  await page.click('#btn-editor-annotations');
  await page.click('#btn-editor-annotations');
  await page.waitForSelector('.tp3d-annot-seg--show');
  assert.deepEqual(await pressed(), ['All:true', 'Selected:false', 'Off:false']);
  assert.deepEqual(await livePins(page), ['1', '2', '3']);
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
  assert.equal(await page.getAttribute('.tp3d-annot-seg__btn[data-tool="arrow"]', 'aria-label'), 'Arrow (not available yet)');
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
