import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import * as StateStore from '../../src/core/state-store.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import * as PreferencesManager from '../../src/services/preferences-manager.js';
import { editorViewSignature, normalizeEditorView, normalizePack, normalizePreferences } from '../../src/core/normalizer.js';
import { defaultPreferences } from '../../src/core/defaults.js';
import { projectPortablePack, projectPortableWorkspacePack } from '../../src/core/import-schema.js';

const viewA = {
  cameraPosition: { x: 30.123456, y: 18, z: 20 },
  target: { x: 14, y: 2, z: 0 },
};
const viewB = {
  cameraPosition: { x: 42, y: 24, z: -11 },
  target: { x: 20, y: 3, z: 1 },
};
const pack = id => ({
  id, title: id, truck: { length: 240, width: 96, height: 100 },
  cases: [], groups: [], stats: { totalCases: 0 }, lastEdited: 123,
  editorView: null, thumbnail: null, thumbnailVisualSignature: null,
  thumbnailViewSignature: null,
});
const seed = () => StateStore.init({
  currentScreen: 'editor', currentPackId: 'A', caseLibrary: [], folderLibrary: [],
  preferences: {}, packLibrary: [pack('A'), pack('B')],
});

test('Pack views normalize, persist independently and survive workspace hydration', () => {
  seed();
  assert.equal(normalizeEditorView({ ...viewA, target: { x: Infinity, y: 0, z: 0 } }), null);
  assert.equal(normalizeEditorView({ ...viewA, target: viewA.cameraPosition }), null);
  const a = PackLibrary.updateEditorView('A', viewA);
  const b = PackLibrary.updateEditorView('B', viewB);
  assert.equal(a.editorView.cameraPosition.x, 30.123);
  assert.equal(editorViewSignature(a.editorView), editorViewSignature(viewA));
  assert.notEqual(editorViewSignature(a.editorView), editorViewSignature(b.editorView));
  assert.equal(a.lastEdited, 123);
  assert.deepEqual(a.stats, { totalCases: 0 });
  const stored = JSON.parse(JSON.stringify(StateStore.snapshot().packLibrary));
  StateStore.replace({ ...StateStore.snapshot(), packLibrary: stored }, { resetHistory: true });
  assert.deepEqual(normalizePack(PackLibrary.getById('A')).editorView, normalizeEditorView(viewA));
  assert.deepEqual(normalizePack(PackLibrary.getById('B')).editorView, normalizeEditorView(viewB));
  assert.equal(normalizePack(pack('C')).editorView, null);
  assert.equal(editorViewSignature({ ...viewA, cameraPosition: { ...viewA.cameraPosition, x: 30.12349 } }),
    editorViewSignature(viewA), 'submillimeter camera noise is ignored');
});

test('projection and zoom metadata are Pack-owned and legacy poses stay Perspective', () => {
  seed();
  const ortho = { ...viewA, projection: 'orthographic', zoom: 2.5 };
  PackLibrary.updateEditorView('A', ortho);
  PackLibrary.updateEditorView('B', viewB);
  assert.equal(PackLibrary.getById('A').editorView.projection, 'orthographic');
  assert.equal(PackLibrary.getById('A').editorView.zoom, 2.5);
  assert.equal(PackLibrary.getById('B').editorView.projection, undefined);
  assert.notEqual(editorViewSignature(ortho), editorViewSignature(viewA));
  assert.notEqual(editorViewSignature(ortho), editorViewSignature({ ...ortho, zoom: 3 }));
  assert.equal(editorViewSignature({ ...viewA, projection: 'perspective' }), editorViewSignature(viewA));
  assert.equal(normalizeEditorView({ ...ortho, zoom: Infinity }).zoom, 1);
  assert.equal(normalizeEditorView({ ...ortho, zoom: -1 }).zoom, 1);
  assert.equal(normalizeEditorView({ ...ortho, projection: 'unknown' }).projection, 'perspective');
  const legacy = PackLibrary.getById('B');
  const promoted = PackLibrary.updateEditorView('B', { ...viewB, projection: 'perspective' });
  assert.notEqual(promoted, legacy, 'an explicit Perspective choice is retained even when its pose matches a legacy view');
  assert.equal(promoted.editorView.projection, 'perspective');
  assert.equal(promoted.lastEdited, legacy.lastEdited);
  assert.equal(StateStore.undo(), false);
});

test('Editor zoom steps preserve target and direction in both projections and stop at OrbitControls limits', async () => {
  const source = await readFile(new URL('../../src/editor/scene-runtime.js', import.meta.url), 'utf8');
  const start = source.indexOf('    function zoomStep(direction) {');
  const end = source.indexOf('    function focusOnWorldPoint(', start);
  assert.ok(start >= 0 && end > start);
  const target = new THREE.Vector3(1, 2, 3);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  camera.position.set(11, 2, 3);
  let changes = 0;
  let cancellations = 0;
  const controls = {
    target, enableDamping: true, minDistance: 6, maxDistance: 20,
    minZoom: 0.5, maxZoom: 2,
    update() {}, dispatchEvent(event) { if (event.type === 'change') changes++; },
  };
  const sandbox = { camera, controls, cancelFocus: () => { cancellations++; } };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  assert.equal(sandbox.zoomStep(1), true);
  assert.ok(camera.position.distanceTo(target) < 10);
  assert.deepEqual(target.toArray(), [1, 2, 3]);
  assert.equal(camera.position.y, 2);
  assert.equal(camera.position.z, 3);
  for (let i = 0; i < 20; i++) sandbox.zoomStep(-1);
  assert.equal(camera.position.distanceTo(target), 20);
  assert.equal(sandbox.zoomStep(-1), false);
  assert.equal(controls.enableDamping, true);

  const orthographic = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.01, 5000);
  orthographic.position.set(11, 2, 3);
  sandbox.camera = orthographic;
  assert.equal(sandbox.zoomStep(1), true);
  assert.ok(orthographic.zoom > 1);
  for (let i = 0; i < 20; i++) sandbox.zoomStep(1);
  assert.equal(orthographic.zoom, 2);
  assert.equal(sandbox.zoomStep(1), false);
  for (let i = 0; i < 20; i++) sandbox.zoomStep(-1);
  assert.equal(orthographic.zoom, 0.5);
  assert.deepEqual(orthographic.position.toArray(), [11, 2, 3]);
  assert.ok(changes > 2 && cancellations > 2);
});

test('Annotations, Measurement, camera and zoom controls hide independently, dismiss an open menu and hand focus to the viewport', async () => {
  const source = await readFile(new URL('../../src/screens/editor-screen.js', import.meta.url), 'utf8');
  const start = source.indexOf('    function syncViewportControls() {');
  const end = source.indexOf('    // Selection-only change.', start);
  assert.ok(start >= 0 && end > start);
  const build = (prefs, { active = null, menuOpen = false, withAnnotations = false, ...options } = {}) => {
    const control = () => { const el = { hidden: false }; el.contains = node => node === el; return el; };
    const state = { closes: 0, viewportFocuses: 0, menuOpen };
    const menuItem = {};
    const menu = { contains: node => node === menuItem };
    // The real Editor always has an Annotations button; most cases here pin the Measurement / Camera / Zoom
    // rules on their own, so the Annotations button is modelled only when a case asks for it.
    const controls = {
      zoomControlsEl: control(), btnView: control(), btnZoomIn: control(), btnZoomOut: control(), btnMeasure: control(),
      btnAnnotations: withAnnotations ? control() : null,
    };
    // The real tools own their button's visibility (Settings may also hide one while its mode is on).
    const MeasurementTool = { calls: 0, syncVisibility() { this.calls++; controls.btnMeasure.hidden = prefs.showMeasurementTool === false; } };
    const AnnotationTool = { calls: 0, syncVisibility() { this.calls++; controls.btnAnnotations.hidden = prefs.showAnnotations === false; } };
    const sandbox = {
      ...controls,
      MeasurementTool: options.withoutTool ? null : MeasurementTool,
      AnnotationTool: withAnnotations && !options.withoutAnnotationTool ? AnnotationTool : null,
      PreferencesManager: { get: () => prefs },
      UIComponents: { closeAllDropdowns: () => { state.closes++; state.menuOpen = false; } },
      document: {
        activeElement: active === 'menu' ? menuItem : active ? controls[active] : null,
        querySelector: selector => (selector === '[data-dropdown="1"][data-role="editor-view"]' && state.menuOpen ? menu : null),
      },
    };
    sandbox.viewportEl = { focus: () => { state.viewportFocuses++; sandbox.document.activeElement = sandbox.viewportEl; } };
    vm.createContext(sandbox);
    vm.runInContext(source.slice(start, end), sandbox);
    return { sandbox, state, controls };
  };

  for (const showMeasurementTool of [true, false]) {
    for (const [showCameraControls, showZoomControls] of [[true, true], [true, false], [false, true], [false, false]]) {
      const { sandbox, controls } = build({ showCameraControls, showZoomControls, showMeasurementTool });
      sandbox.syncViewportControls();
      assert.equal(controls.btnView.hidden, !showCameraControls, `camera ${showCameraControls} / zoom ${showZoomControls} / measure ${showMeasurementTool}`);
      assert.equal(controls.btnZoomIn.hidden, !showZoomControls);
      assert.equal(controls.btnZoomOut.hidden, !showZoomControls);
      assert.equal(controls.btnMeasure.hidden, !showMeasurementTool);
      assert.equal(controls.zoomControlsEl.hidden, !showMeasurementTool && !showCameraControls && !showZoomControls,
        'the floating group disappears only when no control remains, so no empty frame is left');
    }
  }

  // Without the tool object the ruler button still follows the preference.
  const noTool = build({ showMeasurementTool: false }, { withoutTool: true });
  noTool.sandbox.syncViewportControls();
  assert.equal(noTool.controls.btnMeasure.hidden, true);

  const legacy = build({});
  legacy.sandbox.syncViewportControls();
  assert.deepEqual([legacy.controls.btnView.hidden, legacy.controls.btnZoomIn.hidden, legacy.controls.btnMeasure.hidden, legacy.controls.zoomControlsEl.hidden],
    [false, false, false, false], 'records without any of the fields show every control');
  assert.equal(legacy.sandbox.MeasurementTool.calls, 1, 'the tool is told to reconcile its own visibility on every sync');

  // Hiding the ruler while it has focus hands focus to the viewport instead of dropping it.
  const focusedRuler = build({ showMeasurementTool: false }, { active: 'btnMeasure' });
  focusedRuler.sandbox.syncViewportControls();
  assert.equal(focusedRuler.state.viewportFocuses, 1, 'a hidden focused ruler hands focus to the viewport');
  assert.equal(focusedRuler.state.closes, 0, 'no Camera Views menu was open, so nothing is dismissed');

  const menuOpen = build({ showCameraControls: false, showZoomControls: true }, { active: 'menu', menuOpen: true });
  menuOpen.sandbox.syncViewportControls();
  assert.equal(menuOpen.state.closes, 1, 'hiding Camera Views dismisses its open menu');
  assert.equal(menuOpen.state.viewportFocuses, 1, 'focus moves from the removed menu to the viewport');

  const focusedCamera = build({ showCameraControls: false, showZoomControls: true }, { active: 'btnView' });
  focusedCamera.sandbox.syncViewportControls();
  assert.equal(focusedCamera.state.viewportFocuses, 1, 'a hidden focused button hands focus to the viewport');
  assert.equal(focusedCamera.state.closes, 0, 'no menu is open, so nothing is dismissed');

  const zoomOnly = build({ showCameraControls: true, showZoomControls: false }, { active: 'btnView', menuOpen: true });
  zoomOnly.sandbox.syncViewportControls();
  assert.equal(zoomOnly.state.closes, 0, 'a zoom-only change leaves the Camera Views menu open');
  assert.equal(zoomOnly.state.viewportFocuses, 0, 'and does not take focus from the visible camera button');

  // Annotations is a fourth independent control. The group hides only when all four are Off: the existing
  // button is never counted just because the element exists.
  for (const showAnnotations of [true, false]) {
    for (const showMeasurementTool of [true, false]) {
      for (const [showCameraControls, showZoomControls] of [[true, true], [true, false], [false, true], [false, false]]) {
        const label = `annotations ${showAnnotations} / measure ${showMeasurementTool} / camera ${showCameraControls} / zoom ${showZoomControls}`;
        const { sandbox, controls } = build({ showAnnotations, showMeasurementTool, showCameraControls, showZoomControls }, { withAnnotations: true });
        sandbox.syncViewportControls();
        assert.equal(controls.btnAnnotations.hidden, !showAnnotations, label);
        assert.equal(controls.btnMeasure.hidden, !showMeasurementTool, label);
        assert.equal(controls.btnView.hidden, !showCameraControls, label);
        assert.equal(controls.btnZoomIn.hidden, !showZoomControls, label);
        assert.equal(controls.btnZoomOut.hidden, !showZoomControls, label);
        assert.equal(controls.zoomControlsEl.hidden, !showAnnotations && !showMeasurementTool && !showCameraControls && !showZoomControls,
          `${label}: the group disappears only when none of the four remain`);
      }
    }
  }

  // Re-enabling Annotations alone brings the group back without enabling any other control.
  const allOffPrefs = { showAnnotations: false, showMeasurementTool: false, showCameraControls: false, showZoomControls: false };
  const allOff = build(allOffPrefs, { withAnnotations: true });
  allOff.sandbox.syncViewportControls();
  assert.equal(allOff.controls.zoomControlsEl.hidden, true, 'with all four Off no empty frame is left');
  allOffPrefs.showAnnotations = true;
  allOff.sandbox.syncViewportControls();
  assert.deepEqual(
    [allOff.controls.zoomControlsEl.hidden, allOff.controls.btnAnnotations.hidden, allOff.controls.btnMeasure.hidden, allOff.controls.btnView.hidden, allOff.controls.btnZoomIn.hidden, allOff.controls.btnZoomOut.hidden],
    [false, false, true, true, true, true],
    'turning Annotations back On shows the group with only the Annotations button'
  );

  // Without the tool object the Annotations button still follows the preference.
  const noAnnotationTool = build({ showAnnotations: false }, { withAnnotations: true, withoutAnnotationTool: true });
  noAnnotationTool.sandbox.syncViewportControls();
  assert.equal(noAnnotationTool.controls.btnAnnotations.hidden, true);

  const legacyAnnotations = build({}, { withAnnotations: true });
  legacyAnnotations.sandbox.syncViewportControls();
  assert.equal(legacyAnnotations.controls.btnAnnotations.hidden, false, 'a record without the field shows Annotations');
  assert.equal(legacyAnnotations.controls.zoomControlsEl.hidden, false);
  assert.equal(legacyAnnotations.sandbox.AnnotationTool.calls, 1, 'the tool is told to reconcile its own visibility on every sync');

  // Hiding the Annotations button while it has focus hands focus to the viewport, like the ruler.
  const focusedAnnotations = build({ showAnnotations: false }, { active: 'btnAnnotations', withAnnotations: true });
  focusedAnnotations.sandbox.syncViewportControls();
  assert.equal(focusedAnnotations.state.viewportFocuses, 1, 'a hidden focused Annotations button hands focus to the viewport');
  assert.equal(focusedAnnotations.state.closes, 0, 'no Camera Views menu was open, so nothing is dismissed');
  const shownAnnotations = build({ showAnnotations: true }, { active: 'btnAnnotations', withAnnotations: true });
  shownAnnotations.sandbox.syncViewportControls();
  assert.equal(shownAnnotations.state.viewportFocuses, 0, 'a visible Annotations button keeps focus');
});

test('showAnnotations defaults On for new and legacy records, only an explicit false turns it Off, and the choice survives a stored round trip', () => {
  assert.equal(defaultPreferences.showAnnotations, true, 'a new workspace starts with Annotations shown');
  for (const legacy of [undefined, null, {}, { showAnnotations: undefined }, { showAnnotations: null }]) {
    assert.equal(normalizePreferences(legacy).showAnnotations, true, 'an older record without a usable value shows Annotations');
  }
  const off = normalizePreferences({ showAnnotations: false });
  assert.equal(off.showAnnotations, false);
  assert.deepEqual(
    [off.showCameraControls, off.showZoomControls, off.showMeasurementTool], [true, true, true],
    'the other visibility preferences are not touched'
  );
  assert.equal(normalizePreferences(JSON.parse(JSON.stringify(off))).showAnnotations, false,
    'a stored, exported or recovered record keeps the choice');
  assert.equal(normalizePreferences(JSON.parse(JSON.stringify(normalizePreferences({})))).showAnnotations, true);
});

test('Camera and zoom visibility saves take the lightweight route and every other preference change does not', () => {
  seed(); // preferences: {} is a legacy record with neither visibility field
  const routes = [];
  const unsubscribe = StateStore.subscribe((changes, _state, notification) => {
    if (changes.preferences) routes.push(notification?.type ?? null);
  });
  try {
    const current = () => PreferencesManager.get();
    assert.equal(current().showCameraControls, true, 'a record without the camera field defaults to On');
    assert.equal(current().showZoomControls, true, 'a record without the zoom field defaults to On');
    PreferencesManager.set({ ...current(), showCameraControls: false });
    PreferencesManager.set({ ...current(), showZoomControls: false });
    PreferencesManager.set({ ...current(), showCameraControls: true, showZoomControls: true });
    assert.equal(current().showAnnotations, true, 'a record without the Annotations field defaults to On');
    PreferencesManager.set({ ...current(), showAnnotations: false });
    assert.equal(current().showAnnotations, false);
    PreferencesManager.set({ ...current(), showAnnotations: true, showCameraControls: false });
    PreferencesManager.set({ ...current(), showCameraControls: true });
    assert.deepEqual(routes, Array(6).fill('viewport-controls-preference'),
      'camera only, zoom only, Annotations only and any mix of the visibility switches are visibility-only, so no Editor render is requested');
    PreferencesManager.set({ ...current(), showCameraControls: false, labelFontSize: 20 });
    PreferencesManager.set({ ...current(), camera: { ...current().camera, defaultView: 'orthographic' } });
    PreferencesManager.set({ ...current(), showAnnotations: false, theme: 'dark' });
    assert.deepEqual(routes.slice(6), [null, null, null],
      'a visibility change saved with another preference, or a projection default change, uses the normal route');
    assert.equal(current().showAnnotations, false, 'the Annotations change saved with another preference is kept');
    assert.equal(current().showCameraControls, false);
    assert.equal(current().labelFontSize, 20, 'the other preference saved with it is kept');
    assert.equal(current().showZoomControls, true, 'the other visibility preference is untouched');
    assert.equal(current().camera.defaultView, 'orthographic');
  } finally { unsubscribe(); }
});

test('settled camera saves remain Pack-owned during an AutoPack preview', async () => {
  seed();
  const editor = await readFile(new URL('../../src/screens/editor-screen.js', import.meta.url), 'utf8');
  const start = editor.indexOf('    function isViewOwnerCurrent()');
  const end = editor.indexOf('    function scheduleViewSettle(', start);
  assert.ok(start >= 0 && end > start);
  const sourcePack = PackLibrary.getById('A');
  const sandbox = {
    StateStore, PackLibrary, normalizeEditorView, editorViewSignature,
    PreferencesManager: { get: () => ({ camera: { defaultView: 'perspective' } }) },
    CoreStorage: { isScopeContextCurrent: scope => scope === 'current' },
    SceneManager: { getEditorView: () => viewA, getDefaultEditorView: () => viewB },
    getPreviewScene: () => null,
    viewOwner: { packId: 'A', scope: 'current' }, viewRevision: 1,
    viewGestureActive: false, viewFocusActive: false, viewPendingEnd: false,
    pendingViewSave: true, onPreviewViewSettled: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(editor.slice(start, end), sandbox);
  assert.equal(sandbox.persistSettledView(), true, 'a transient cargo preview does not block camera saving');
  assert.equal(editorViewSignature(PackLibrary.getById('A').editorView), editorViewSignature(viewA));
  assert.equal(sandbox.pendingViewSave, false);
  assert.equal(PackLibrary.getById('A').cases, sourcePack.cases, 'camera saving cannot adopt preview cargo');
  assert.equal(StateStore.undo(), false, 'camera saving adds no cargo history step');
  assert.equal(PackLibrary.getById('B').editorView, null);

  sandbox.SceneManager.getEditorView = () => viewB;
  for (const flag of ['viewGestureActive', 'viewFocusActive', 'viewPendingEnd']) {
    sandbox[flag] = true;
    assert.equal(sandbox.persistSettledView(), false, `${flag} prevents an unsettled save`);
    sandbox[flag] = false;
  }
  assert.equal(sandbox.persistSettledView(0), false, 'an old revision cannot save');
  sandbox.viewOwner.scope = 'stale';
  assert.equal(sandbox.persistSettledView(), false, 'an old workspace cannot save');
  sandbox.viewOwner.scope = 'current';
  StateStore.set({ currentPackId: 'B' }, { skipHistory: true });
  assert.equal(sandbox.persistSettledView(), false, 'a departing Pack cannot save into the next Pack');
  assert.equal(PackLibrary.getById('B').editorView, null);
  assert.equal(editorViewSignature(PackLibrary.getById('A').editorView), editorViewSignature(viewA));
});

test('camera metadata is outside cargo Undo and preserves Redo', () => {
  seed();
  const notifications = [];
  const unsubscribe = StateStore.subscribe((_changes, _state, notification) => {
    if (notification) notifications.push(notification.type);
  });
  try {
    PackLibrary.updateEditorView('A', viewA);
    assert.equal(StateStore.undo(), false, 'view save adds no cargo step');
    assert.equal(notifications.at(-1), 'pack-view');
    const first = PackLibrary.getById('A');
    StateStore.set({ packLibrary: StateStore.get('packLibrary').map(p =>
      p.id === 'A' ? { ...p, notes: 'cargo edit' } : p) });
    assert.equal(StateStore.undo(), true);
    assert.equal(PackLibrary.getById('A').notes, undefined);
    PackLibrary.updateEditorView('A', viewB);
    assert.equal(StateStore.redo(), true, 'view save did not truncate cargo Redo');
    assert.equal(PackLibrary.getById('A').notes, 'cargo edit');
    assert.equal(editorViewSignature(PackLibrary.getById('A').editorView), editorViewSignature(viewB));
    assert.equal(PackLibrary.getById('A').lastEdited, first.lastEdited);
    assert.equal(PackLibrary.getById('B').editorView, null);
  } finally {
    unsubscribe();
  }
});

test('cargo Undo/Redo retains malformed history entries and the latest valid Pack view', () => {
  seed();
  PackLibrary.updateEditorView('A', viewA);
  assert.equal(StateStore.undo(), false, 'camera movement adds no cargo history step');

  const invalidEntries = [null, 7, 'legacy', {}, { id: '' }];
  StateStore.set({ packLibrary: [
    ...invalidEntries, { ...pack('A'), notes: 'older cargo' }, pack('B'),
  ] });
  StateStore.set({ packLibrary: [
    { ...pack('A'), notes: 'newer cargo' }, pack('B'),
  ] });
  PackLibrary.updateEditorView('A', viewB);

  assert.equal(StateStore.undo(), true, 'Undo reaches the preceding cargo edit');
  const restored = StateStore.get('packLibrary');
  assert.equal(restored.length, 7, 'Undo preserves history entry count and order');
  assert.deepEqual(restored.slice(0, invalidEntries.length), invalidEntries);
  assert.equal(restored[5].id, 'A');
  assert.equal(restored[5].notes, 'older cargo');
  assert.equal(editorViewSignature(restored[5].editorView), editorViewSignature(viewB));
  assert.equal(restored[6].id, 'B');

  assert.equal(StateStore.redo(), true, 'camera movement leaves Redo available');
  const redone = StateStore.get('packLibrary');
  assert.equal(redone.length, 2);
  assert.equal(redone[0].notes, 'newer cargo');
  assert.equal(editorViewSignature(redone[0].editorView), editorViewSignature(viewB));
  assert.equal(StateStore.redo(), false, 'camera movement adds no extra cargo history step');
});

test('Load Plan export excludes view; workspace backup retains it and strips thumbnail freshness', () => {
  const source = { ...pack('A'), editorView: viewA, thumbnail: 'data:image/jpeg;base64,AA',
    thumbnailVisualSignature: 'cargo', thumbnailViewSignature: 'camera', thumbnailRenderVersion: 2 };
  const portable = projectPortablePack(source);
  assert.equal(Object.hasOwn(portable, 'editorView'), false);
  assert.equal(Object.hasOwn(portable, 'thumbnailViewSignature'), false);
  assert.equal(Object.hasOwn(portable, 'thumbnailRenderVersion'), false);
  const backup = projectPortableWorkspacePack(source);
  assert.deepEqual(backup.editorView, normalizeEditorView(viewA));
  assert.equal(Object.hasOwn(backup, 'thumbnailViewSignature'), false);
  assert.equal(Object.hasOwn(backup, 'thumbnailRenderVersion'), false);
  assert.equal(normalizePack({ ...pack('A'), editorView: viewA,
    thumbnailViewSignature: 'camera' }).thumbnailViewSignature, 'camera');
});

test('view freshness schedules one debounced capture; fresh and empty Packs stay quiet', async () => {
  const app = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('const PREVIEW_RENDER_VERSION =');
  const end = app.indexOf('\n\nconst TP3D_BUILD_STAMP', start);
  assert.ok(start >= 0 && end > start);
  const sandbox = { Promise };
  vm.createContext(sandbox);
  vm.runInContext(`${app.slice(start, end)}\nglobalThis.createScheduler = createPackPreviewScheduler;`, sandbox);
  let timer = null;
  let active = { currentScreen: 'editor', currentPackId: 'A' };
  const packs = new Map([
    ['A', { id: 'A', cases: [{}], thumbnail: 'image', thumbnailVisualSignature: 'visual', thumbnailViewSignature: 'old' }],
    ['B', { id: 'B', cases: [], thumbnail: null, thumbnailVisualSignature: 'visual', thumbnailViewSignature: 'old' }],
  ]);
  const captures = [];
  const lifecycleSubscribers = [];
  const scheduler = sandbox.createScheduler({
    StateStore: { get: key => active[key] },
    PackLibrary: { getById: id => packs.get(id) },
    OperationLifecycle: { isBusy: () => false, subscribe: fn => {
      lifecycleSubscribers.push(fn); return () => {};
    } },
    capturePackPreview: id => { captures.push(id); return true; },
    getActiveWorkspaceKey: () => 'scope|1',
    getVisualSignature: () => 'visual',
    getViewSignature: () => 'new',
    setTimer: fn => { timer = fn; return fn; },
    clearTimer: () => { timer = null; },
  });
  assert.equal(scheduler.schedule(), true);
  assert.equal(scheduler.schedule(), true);
  assert.deepEqual(captures, []);
  timer();
  await Promise.resolve();
  assert.deepEqual(captures, ['A']);
  packs.get('A').thumbnailViewSignature = 'new';
  packs.get('A').thumbnailRenderVersion = 2;
  assert.equal(scheduler.schedule(), false);
  active = { ...active, currentPackId: 'B' };
  assert.equal(scheduler.schedule(), false, 'empty Pack never starts a readback');
  scheduler.dispose();
});
