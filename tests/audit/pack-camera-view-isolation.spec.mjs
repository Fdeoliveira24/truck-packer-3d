import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as StateStore from '../../src/core/state-store.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import { editorViewSignature, normalizeEditorView, normalizePack } from '../../src/core/normalizer.js';
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
