/**
 * @file annotation-lifecycle.spec.mjs
 * @description Pins how Annotations V1 data lives inside a Load Plan: the normalizer whitelist, writes that
 *   stay outside cargo Undo/Redo and never roll `lastEdited` back, derived validity when cargo, Cases or the
 *   truck change, duplicate and import instance-ID remapping, and export/backup projection plus strict
 *   restore validation. The pure model and layout are pinned in annotation-core.spec.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
// import-export.js reads the browser storage globals while it loads (as in measurement-tool-lifecycle.spec.mjs).
const memoryStorage = new Map();
globalThis.window ??= {
  localStorage: {
    getItem: key => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
    setItem: (key, value) => memoryStorage.set(key, String(value)),
    removeItem: key => memoryStorage.delete(key),
    key: index => Array.from(memoryStorage.keys())[index] || null,
    get length() { return memoryStorage.size; },
  },
  setTimeout, clearTimeout,
};
import * as StateStore from '../../src/core/state-store.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import * as ImportExport from '../../src/services/import-export.js';
import * as M from '../../src/core/measurements.js';
import * as A from '../../src/core/annotations.js';
import { normalizeAppData, normalizePack } from '../../src/core/normalizer.js';
import { projectPortablePack, projectPortableWorkspacePack, validateWorkspaceGraph } from '../../src/core/import-schema.js';
import * as CoreStorage from '../../src/core/storage.js';

const CASE = {
  id: 'case-1', name: 'Crate', itemCode: 'C-1', manufacturer: 'Test', category: 'audio',
  dimensions: { length: 48, width: 24, height: 32 }, weight: 50, shape: 'box',
  stackable: true, maxStackCount: 2, orientationLock: 'upright', color: '#111111',
};
const caseMap = new Map([[CASE.id, CASE]]);
const makePack = (id, extra = {}) => ({
  id, title: id, loadPlanNumber: `LP-${id}`, truck: { length: 240, width: 96, height: 100 },
  cases: [], groups: [], stats: { totalCases: 0 }, lastEdited: 123,
  editorView: null, thumbnail: null, thumbnailVisualSignature: null, thumbnailViewSignature: null,
  ...extra,
});
const solidInstance = id => ({
  id, caseId: CASE.id, placement: 'packed', hidden: false, groupId: null,
  transform: { position: { x: 60, y: 16, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
});
const seed = (packs = [makePack('A'), makePack('B')]) => StateStore.init({
  currentScreen: 'editor', currentPackId: packs[0].id, caseLibrary: [CASE],
  folderLibrary: [], preferences: {}, packLibrary: packs,
});
const ground = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
const onCargo = (instanceId, local = { x: 24, y: 2, z: 3 }) => M.buildCargoAnchor({ instanceId, local, caseData: CASE });
const note = (title = 'Fragile', anchor = ground(0, 60), extra = {}) => ({ anchor, title, ...extra });
const callout = (id, anchor = ground(0, 60), extra = {}) => A.createCalloutRecord({ id, anchor, title: 'Fragile', now: 1, ...extra });
const stored = id => PackLibrary.getById(id);
const statuses = id => PackLibrary.resolveAnnotations(id).map(r => `${r.status}${r.reason ? `:${r.reason}` : ''}`);
const snapshotOf = () => JSON.stringify([StateStore.get('packLibrary'), StateStore.get('caseLibrary')]);
const emptyDestination = () => StateStore.init({
  currentScreen: 'packs', currentPackId: null, caseLibrary: [CASE], folderLibrary: [], preferences: {}, packLibrary: [],
});

// ============================================================================
// SECTION: NORMALIZATION (G1) AND RECOVERY
// ============================================================================

test('normalizePack whitelists annotations: legacy plans get [], valid ones persist, malformed ones are kept as recovery records', () => {
  assert.deepEqual(normalizePack(makePack('A')).annotations, [], 'a plan saved before the feature has none');
  const good = callout('g');
  assert.deepEqual(normalizePack(makePack('A', { annotations: [good] })).annotations, A.normalizeAnnotations([good]));
  const malformed = { id: 'bad', type: 'callout', anchor: { kind: 'mystery' } };
  const kept = normalizePack(makePack('A', { annotations: [good, malformed] })).annotations;
  assert.equal(kept.length, 2, 'nothing is dropped');
  assert.equal(kept[1].type, A.ANNOTATION_TYPE_UNREADABLE);
  assert.deepEqual(kept[1].original, malformed, 'the original record is preserved verbatim for recovery');
  assert.deepEqual(normalizePack(makePack('A', { annotations: 'oops' })).annotations[0].original, 'oops');
  assert.deepEqual(normalizePack(makePack('A', { measurements: [{ id: 'x' }] })).annotations, [], 'measurements and annotations are separate collections');
});

test('a write keeps unreadable originals verbatim and an unrelated edit never touches stored annotations', () => {
  const rawBad = [{ id: 'bad-1', type: 'callout', title: '' }, 'garbage', { id: 'arrow-1', type: 'arrow', schemaVersion: 1 }];
  seed([makePack('A', { annotations: rawBad })]);
  assert.deepEqual(stored('A').annotations, rawBad, 'hydration keeps the raw stored value');
  PackLibrary.update('A', { notes: 'unrelated edit' });
  assert.deepEqual(stored('A').annotations, rawBad, 'an unrelated autosaved edit leaves malformed data verbatim');
  const added = PackLibrary.addCallout('A', note());
  assert.equal(added.ok, true);
  const unreadable = stored('A').annotations.filter(r => r.type === A.ANNOTATION_TYPE_UNREADABLE);
  assert.deepEqual(unreadable.map(r => r.original), rawBad, 'writing a callout wraps, never discards, what could not be read');
  assert.deepEqual(PackLibrary.resolveAnnotations('A').filter(r => r.reason === 'unreadable').length, 3);
  assert.equal(PackLibrary.updateCallout('A', unreadable[0].id, { title: 'x' }).reason, 'not-found', 'an unreadable record cannot be edited as a callout');
  assert.equal(PackLibrary.deleteAnnotation('A', added.annotation.id).ok, true);
  assert.equal(stored('A').annotations.length, 3, 'only the deliberately deleted record is gone');
  assert.equal(PackLibrary.deleteAnnotation('A', unreadable[1].id).ok, true, 'an unreadable record can be deleted deliberately');
  assert.equal(stored('A').annotations.length, 2);
});

// ============================================================================
// SECTION: WRITES (G2) — annotation-only edits
// ============================================================================

test('create, edit, move, hide and delete are annotation-only edits: lastEdited moves, cargo Undo does not', () => {
  seed();
  const notifications = [];
  const unsubscribe = StateStore.subscribe((_changes, _state, notification) => {
    if (notification) notifications.push(notification.type);
  });
  try {
    const before = stored('A');
    const cargoBefore = JSON.stringify(before.cases);
    const added = PackLibrary.addCallout('A', note('  Unload   first ', ground(10, 10), { description: 'Rear doors', color: 'blue', keepExpanded: true }));
    assert.equal(added.ok, true);
    assert.equal(notifications.at(-1), 'pack-annotations', 'derived notification: the app refreshes only the overlay and list');
    assert.ok(stored('A').lastEdited > before.lastEdited, 'creating a callout updates lastEdited');
    assert.equal(StateStore.undo(), false, 'and adds no cargo Undo step');
    assert.equal(stored('B').annotations, undefined, 'another Load Plan is untouched');
    assert.equal(JSON.stringify(stored('A').cases), cargoBefore, 'cargo is untouched');
    const [record] = PackLibrary.getAnnotations('A');
    assert.deepEqual([record.title, record.description, record.color, record.keepExpanded, record.hidden, record.offset], ['Unload first', 'Rear doors', 'blue', true, false, null]);

    const id = added.annotation.id;
    const edited = PackLibrary.updateCallout('A', id, { title: 'Unload last', description: '', color: 'red' });
    assert.equal(edited.ok, true);
    assert.deepEqual([PackLibrary.getAnnotations('A')[0].title, PackLibrary.getAnnotations('A')[0].description], ['Unload last', null]);
    const lastEdited = stored('A').lastEdited;
    const same = PackLibrary.updateCallout('A', id, { title: 'Unload last' });
    assert.equal(same.unchanged, true, 'an unchanged edit writes nothing');
    assert.equal(stored('A').lastEdited, lastEdited);
    assert.equal(PackLibrary.updateCallout('A', id, { title: '   ' }).reason, 'invalid', 'an empty title is refused');
    assert.equal(PackLibrary.updateCallout('A', 'nope', { title: 'x' }).reason, 'not-found');
    assert.equal(PackLibrary.updateCallout('missing', id, { title: 'x' }).reason, 'pack-not-found');

    assert.equal(PackLibrary.setCalloutOffset('A', id, { dx: 44.44, dy: -30 }).ok, true);
    assert.deepEqual(PackLibrary.getAnnotations('A')[0].offset, { dx: 44.4, dy: -30 });
    assert.deepEqual(PackLibrary.getAnnotations('A')[0].anchor, added.annotation.anchor, 'moving a card never moves the anchor');
    assert.equal(PackLibrary.setCalloutOffset('A', id, { dx: 99999, dy: 0 }).reason, 'invalid');
    assert.deepEqual(PackLibrary.getAnnotations('A')[0].offset, { dx: 44.4, dy: -30 }, 'a refused offset changes nothing');
    assert.equal(PackLibrary.setCalloutOffset('A', id, null).ok, true);
    assert.equal(PackLibrary.getAnnotations('A')[0].offset, null);

    assert.equal(PackLibrary.updateCallout('A', id, { hidden: true }).ok, true);
    assert.equal(PackLibrary.getAnnotations('A')[0].hidden, true, 'visibility is preserved with the Load Plan');

    const cargoAnchor = onCargo('inst-x');
    assert.equal(PackLibrary.reattachCallout('A', id, cargoAnchor).ok, true);
    const moved = PackLibrary.getAnnotations('A')[0];
    assert.equal(moved.anchor.kind, 'cargo', 'the anchor kind may change when the owner moves the marker');
    assert.equal(moved.createdAt, added.annotation.createdAt);
    assert.equal(moved.title, 'Unload last');
    assert.equal(PackLibrary.reattachCallout('A', id, { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } }).reason, 'invalid');
    assert.equal(PackLibrary.reattachCallout('A', id, { ...cargoAnchor, local: { x: 0, y: 0, z: 0 } }).reason, 'invalid', 'a point off the cargo surface is refused');
    assert.equal(PackLibrary.getAnnotations('A')[0].anchor.kind, 'cargo', 'refused moves change nothing');
    assert.equal(StateStore.undo(), false, 'no edit added a cargo Undo step');

    assert.equal(PackLibrary.deleteAnnotation('A', 'nope').reason, 'not-found');
    assert.equal(PackLibrary.deleteAnnotation('A', id).ok, true);
    assert.equal(PackLibrary.getAnnotations('A').length, 0);
    assert.equal(JSON.stringify(stored('A').cases), cargoBefore);
  } finally { unsubscribe(); }
});

test('the per-plan maximum of 200 is enforced on creation and a malformed callout is refused', () => {
  seed();
  for (let i = 0; i < 200; i++) assert.equal(PackLibrary.addCallout('A', note(`N${i}`, ground(i, 1))).ok, true);
  assert.equal(PackLibrary.getAnnotations('A').length, 200);
  const over = PackLibrary.addCallout('A', note('one too many'));
  assert.deepEqual([over.ok, over.reason], [false, 'limit']);
  assert.equal(PackLibrary.getAnnotations('A').length, 200, 'nothing is truncated or replaced');
  assert.equal(PackLibrary.addCallout('B', { anchor: null, title: 'x' }).reason, 'invalid');
  assert.equal(PackLibrary.addCallout('B', note('   ')).reason, 'invalid', 'a callout needs a title');
  assert.equal(PackLibrary.addCallout('missing', note()).reason, 'pack-not-found');
  assert.equal(PackLibrary.restoreAnnotation('A', callout('late'), 0).reason, 'limit');
});

test('cargo Undo/Redo keeps annotations and never rolls lastEdited back past an annotation edit', () => {
  seed();
  PackLibrary.addCallout('A', note('First'));
  StateStore.set({ packLibrary: StateStore.get('packLibrary').map(p => (p.id === 'A' ? { ...p, notes: 'cargo edit' } : p)) });
  const second = PackLibrary.addCallout('A', note('Second', ground(5, 5)));
  assert.equal(second.ok, true);
  PackLibrary.setCalloutOffset('A', second.annotation.id, { dx: 20, dy: 20 });
  const editedAt = stored('A').lastEdited;
  assert.equal(StateStore.undo(), true, 'the cargo edit is undone');
  assert.equal(stored('A').notes, undefined);
  assert.equal(PackLibrary.getAnnotations('A').length, 2, 'Undo neither erases nor resurrects annotations');
  assert.deepEqual(PackLibrary.getAnnotations('A')[1].offset, { dx: 20, dy: 20 }, 'including the latest card position');
  assert.ok(stored('A').lastEdited >= editedAt, 'Undo must not move lastEdited back past the annotation edit');
  assert.equal(StateStore.redo(), true);
  assert.equal(stored('A').notes, 'cargo edit');
  assert.equal(PackLibrary.getAnnotations('A').length, 2);
  assert.ok(stored('A').lastEdited >= editedAt);
});

test('measurements and annotations are independent collections: neither edit touches the other', () => {
  seed();
  const measured = PackLibrary.addMeasurement('A', { start: ground(0, 60), end: ground(40, 60) });
  const noted = PackLibrary.addCallout('A', note('Beside the ruler'));
  assert.equal(measured.ok && noted.ok, true);
  assert.equal(PackLibrary.deleteMeasurement('A', measured.measurement.id).ok, true);
  assert.equal(PackLibrary.getAnnotations('A').length, 1, 'deleting a measurement keeps the callout');
  PackLibrary.addMeasurement('A', { start: ground(1, 1), end: ground(9, 9) });
  assert.equal(PackLibrary.deleteAnnotation('A', noted.annotation.id).ok, true);
  assert.equal(PackLibrary.getMeasurements('A').length, 1, 'deleting a callout keeps the measurement');
});

test('deleting a callout can be put back once, with the same ID and position, and only while that is still right', () => {
  seed();
  const [one, two, three] = ['One', 'Two', 'Three'].map((title, i) => PackLibrary.addCallout('A', note(title, ground(i, 1))).annotation);
  const removed = PackLibrary.deleteAnnotation('A', two.id);
  assert.deepEqual([removed.ok, removed.index, removed.removed.id], [true, 1, two.id]);
  assert.deepEqual(PackLibrary.getAnnotations('A').map(r => r.title), ['One', 'Three']);
  const restored = PackLibrary.restoreAnnotation('A', removed.removed, removed.index);
  assert.equal(restored.ok, true);
  assert.deepEqual(PackLibrary.getAnnotations('A').map(r => r.id), [one.id, two.id, three.id], 'back in its place with its ID');
  assert.equal(PackLibrary.restoreAnnotation('A', removed.removed, 1).reason, 'exists', 'never duplicated');
  assert.equal(PackLibrary.restoreAnnotation('A', { id: 'x', type: 'callout' }, 0).reason, 'invalid');
  assert.equal(PackLibrary.restoreAnnotation('A', callout('tail'), 99).ok, true, 'an out-of-range position appends');
  assert.equal(PackLibrary.getAnnotations('A').at(-1).id, 'tail');
  assert.equal(StateStore.undo(), false, 'putting it back was not a cargo step either');
});

// ============================================================================
// SECTION: DERIVED VALIDITY FOLLOWS THE LOAD PLAN
// ============================================================================

test('deleting cargo leaves its callout stored as Unresolved and undoing the delete resolves it again', () => {
  seed();
  const inst = PackLibrary.addInstance('A', CASE.id, { x: 60, y: 16, z: 0 });
  assert.ok(inst && inst.id, 'a real instance is placed');
  PackLibrary.addCallout('A', note('On the crate', onCargo(inst.id, { x: 0, y: 16, z: 0 })));
  assert.deepEqual(statuses('A'), ['valid']);
  PackLibrary.removeInstances('A', [inst.id]);
  assert.equal(PackLibrary.getAnnotations('A').length, 1, 'editing cargo never deletes an annotation');
  const gone = PackLibrary.resolveAnnotations('A')[0];
  assert.deepEqual([gone.status, gone.reason, gone.point], ['unresolved', 'cargo-missing', null], 'no fabricated position');
  assert.equal(StateStore.undo(), true);
  assert.equal(PackLibrary.getById('A').cases.some(c => c.id === inst.id), true, 'Undo restores the same instance ID');
  assert.deepEqual(statuses('A'), ['valid'], 'the anchor resolves again; nothing was relocated');
});

test('cargo movement, rotation and staging carry the callout with the cargo and never edit the annotation', () => {
  seed();
  const inst = PackLibrary.addInstance('A', CASE.id, { x: 60, y: 16, z: 0 });
  PackLibrary.addCallout('A', note('Follows', onCargo(inst.id, { x: 24, y: 2, z: 3 })));
  const record = JSON.stringify(PackLibrary.getAnnotations('A'));
  const point = () => PackLibrary.resolveAnnotations('A')[0].point;
  const start = point();
  const pose = (position, rotation = { x: 0, y: 0, z: 0 }) => ({ transform: { position, rotation, scale: { x: 1, y: 1, z: 1 } } });
  assert.ok(PackLibrary.updateInstance('A', inst.id, pose({ x: 100, y: 16, z: 10 })));
  assert.deepEqual([point().x - start.x, point().z - start.z], [40, 10], 'moving the cargo moves the point with it');
  assert.ok(PackLibrary.updateInstance('A', inst.id, pose({ x: 100, y: 16, z: 10 }, { x: 0, y: Math.PI / 2, z: 0 })));
  assert.notDeepEqual(point(), { x: start.x + 40, y: start.y, z: start.z + 10 }, 'rotating the cargo rotates the point about it');
  assert.ok(PackLibrary.updateInstance('A', inst.id, { ...pose({ x: 500, y: 16, z: 200 }), placement: 'staged' }));
  assert.equal(PackLibrary.resolveAnnotations('A')[0].status, 'valid', 'a staged case keeps its callout');
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), record, 'the stored annotation never changed');
});

test('a Case size or shape change asks for review, restoring it recovers, and nothing is rewritten or relocated', () => {
  seed();
  const inst = PackLibrary.addInstance('A', CASE.id, { x: 60, y: 16, z: 0 });
  PackLibrary.addCallout('A', note('Sized', onCargo(inst.id)));
  const record = JSON.stringify(PackLibrary.getAnnotations('A'));
  const setCase = patch => StateStore.set({ caseLibrary: [{ ...CASE, ...patch }] }, { skipHistory: true });
  setCase({ dimensions: { ...CASE.dimensions, length: 60 } });
  assert.deepEqual(statuses('A'), ['needs-review:case-changed']);
  assert.equal(PackLibrary.resolveAnnotations('A')[0].point, null);
  setCase({ shape: 'cylinder' });
  assert.deepEqual(statuses('A'), ['needs-review:case-changed'], 'a shape change is a change too');
  setCase({});
  assert.deepEqual(statuses('A'), ['valid'], 'restoring the original definition returns it to Valid');
  setCase({ id: 'case-1', dimensions: undefined });
  assert.notEqual(statuses('A')[0], 'valid');
  setCase({});
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), record);
});

test('through the real zone calculation: a Front Overhang change flags a wall callout, restoring it makes it Valid again', () => {
  const truck = { length: 600, width: 100, height: 90, shapeMode: 'frontBonus', shapeConfig: { bonusLength: 100, bonusHeight: 30 } };
  seed([makePack('F', { truck })]);
  const withConfig = shapeConfig => StateStore.set({
    packLibrary: StateStore.get('packLibrary').map(p => (p.id === 'F' ? { ...p, truck: { ...p.truck, shapeConfig } } : p)),
  }, { skipHistory: true });
  const zones = PackLibrary.getMeasurementZones(stored('F'));
  const front = M.buildSpaceAnchor({ surface: 'wall-front', point: { x: 700, y: 60, z: 0 }, truck: stored('F').truck, zones });
  assert.ok(front, 'the front wall of the Front Overhang truck stands at x = 700');
  assert.equal(PackLibrary.addCallout('F', note('Cab wall', front)).ok, true);
  assert.deepEqual(statuses('F'), ['valid']);
  withConfig({ bonusLength: 150, bonusHeight: 30 });
  assert.deepEqual(statuses('F'), ['needs-review:truck-changed'], 'the wall moved: the callout is flagged, not relocated');
  assert.deepEqual(PackLibrary.getAnnotations('F')[0].anchor, front);
  withConfig({ bonusLength: 100, bonusHeight: 30 });
  assert.deepEqual(statuses('F'), ['valid']);
  // Ground and open-space callouts never depend on the truck.
  PackLibrary.addCallout('F', note('Yard', ground(900, 0)));
  withConfig({ bonusLength: 150, bonusHeight: 30 });
  assert.deepEqual(statuses('F'), ['needs-review:truck-changed', 'valid']);
});

// ============================================================================
// SECTION: DUPLICATE AND IMPORT (G3)
// ============================================================================

test('duplicating a Load Plan re-targets cargo anchors to the copy and leaves the original alone', () => {
  seed();
  const inst = PackLibrary.addInstance('A', CASE.id, { x: 60, y: 16, z: 0 });
  const cargo = onCargo(inst.id, { x: 3, y: 16, z: 1 });
  const floor = M.buildFloorAnchor({ surface: 'main', point: { x: 120, y: 0, z: 0 } });
  PackLibrary.addCallout('A', note('On cargo', cargo, { offset: { dx: 30, dy: -20 }, keepExpanded: true }));
  PackLibrary.addCallout('A', note('On floor', floor));
  PackLibrary.addCallout('A', note('Yard', ground(3, 3)));
  const original = JSON.stringify(PackLibrary.getAnnotations('A'));
  const copy = PackLibrary.duplicate('A');
  const copyIds = new Set(copy.cases.map(c => c.id));
  assert.equal(copyIds.has(inst.id), false, 'the copy has its own instance IDs');
  const [first, second, third] = PackLibrary.getAnnotations(copy.id);
  assert.equal(copyIds.has(first.anchor.instanceId), true, 'the cargo anchor follows its cargo into the copy');
  assert.deepEqual(first.anchor.local, cargo.local);
  assert.deepEqual([first.offset, first.keepExpanded], [{ dx: 30, dy: -20 }, true], 'presentation travels with it');
  assert.deepEqual(second.anchor, floor);
  assert.deepEqual(third.anchor, ground(3, 3));
  assert.deepEqual(statuses(copy.id), ['valid', 'valid', 'valid']);
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), original, 'the original plan keeps its anchors');
});

const importPayload = (annotations, cases = []) => ({
  pack: { id: 'incoming', title: 'Incoming', loadPlanNumber: 'LP-IMPORT', truck: { length: 240, width: 96, height: 100 }, cases, annotations },
  bundledCases: [],
});

test('importing a Load Plan remaps cargo anchors through the regenerated instance IDs', () => {
  seed([makePack('A')]);
  const list = [
    callout('c1', onCargo('old-1', { x: 1, y: 16, z: 2 })),
    callout('c2', onCargo('never-existed', { x: 0, y: 16, z: 0 })),
    callout('c3', ground(9, 9)),
  ];
  const plan = PackLibrary.planPackImport(importPayload(list, [solidInstance('old-1')]));
  const newId = plan.pack.cases[0].id;
  assert.notEqual(newId, 'old-1', 'imports regenerate instance IDs');
  assert.equal(plan.pack.annotations[0].anchor.instanceId, newId, 'the anchor is re-targeted through the same old-to-new map');
  assert.deepEqual(plan.pack.annotations[0].anchor.local, list[0].anchor.local);
  assert.equal(plan.pack.annotations[1].anchor.instanceId, 'never-existed', 'a valid reference to missing cargo is retained, never guessed');
  assert.deepEqual(plan.pack.annotations[2].anchor, list[2].anchor);
  assert.deepEqual(PackLibrary.planPackImport(importPayload(undefined)).pack.annotations, [], 'a file without annotations imports none');
});

test('a malformed, duplicated or over-limit annotation list rejects the whole Load Plan import', () => {
  seed([makePack('A')]);
  const valid = callout('ok');
  assert.doesNotThrow(() => PackLibrary.planPackImport(importPayload([valid])));
  const blocked = /Pack import blocked: the annotations are not valid/;
  assert.throws(() => PackLibrary.planPackImport(importPayload([{ ...valid, anchor: { kind: 'cargo' } }])), blocked);
  assert.throws(() => PackLibrary.planPackImport(importPayload([{ ...valid, title: '' }])), blocked);
  assert.throws(() => PackLibrary.planPackImport(importPayload([valid, valid])), /duplicate/);
  assert.throws(() => PackLibrary.planPackImport(importPayload('not a list')), blocked);
  const many = Array.from({ length: 201 }, (_, i) => callout(`c${i}`, ground(i, 1)));
  assert.throws(() => PackLibrary.planPackImport(importPayload(many)), /too many/);
  assert.equal(PackLibrary.planPackImport(importPayload(many.slice(0, 200))).pack.annotations.length, 200, 'exactly 200 is fine; nothing is truncated');
});

// ============================================================================
// SECTION: EXPORT, BACKUP AND RESTORE (G4)
// ============================================================================

test('export and backup project annotations explicitly and restore validation is strict', () => {
  const list = [
    callout('a', ground(0, 60), { title: 'Kept', description: 'Rear doors', color: 'green' }),
    callout('b', onCargo('gone'), { offset: { dx: 10, dy: 10 } }),
  ];
  const withList = makePack('A', { annotations: list });
  for (const project of [projectPortablePack, projectPortableWorkspacePack]) {
    assert.deepEqual(project(withList).annotations, A.normalizeAnnotations(list), `${project.name} carries annotations`);
    assert.equal(Object.hasOwn(project(makePack('A')), 'annotations'), false, 'a plan without any exports no empty field');
    assert.equal(project(makePack('A', { annotations: [{ id: 'x' }] })).annotations[0].type, A.ANNOTATION_TYPE_UNREADABLE,
      'an unreadable record is exported, not dropped');
  }
  const graph = packs => ({ caseLibrary: [], packLibrary: packs, folderLibrary: [] });
  assert.doesNotThrow(() => validateWorkspaceGraph(graph([withList])), 'a dangling cargo reference is accepted (Unresolved)');
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { annotations: [{ ...list[0], anchor: { kind: 'x' } }] })])), /annotations/);
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { annotations: [list[0], list[0]] })])), /duplicate/);
  const many = Array.from({ length: 201 }, (_, i) => callout(`m${i}`, ground(i, 1)));
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { annotations: many })])), /too many/);
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { annotations: 'nope' })])), /annotations/);
});

test('export self-preflight applies the importer\'s annotation rules to the exact artifact', () => {
  const many = Array.from({ length: 201 }, (_, i) => callout(`m${i}`, ground(i, 1)));
  const fine = [callout('a', ground(0, 60), { title: 'Kept' }), callout('b', onCargo('gone'))];
  const unreadable = { id: 'x', type: 'callout', anchor: { kind: 'mystery' } };
  seed([
    makePack('OVER', { cases: [solidInstance('o1')], annotations: many }),
    makePack('FINE', { cases: [solidInstance('f1')], annotations: fine }),
    makePack('ODD', { cases: [solidInstance('d1')], annotations: [unreadable] }),
  ]);
  const over = PackLibrary.getById('OVER');
  const overBefore = JSON.stringify(over);
  const refused = error => error.code === 'EXPORT_PREFLIGHT_FAILED' && /annotations are not valid \(too many annotations \(201; maximum 200\)\)/.test(error.message);
  assert.throws(() => ImportExport.buildRestorablePackExportJSON(over), refused, 'single export refuses an over-cap collection');
  assert.throws(() => ImportExport.buildRestorablePackBatchExportJSON([PackLibrary.getById('FINE'), over]), refused, 'batch export refuses it too');
  assert.equal(JSON.stringify(PackLibrary.getById('OVER')), overBefore, 'nothing is truncated, repaired or rewritten in the saved plan');

  const json = ImportExport.buildRestorablePackExportJSON(PackLibrary.getById('FINE'));
  const tampered = JSON.parse(json);
  tampered.data.pack.annotations = [{ ...fine[0], anchor: { kind: 'cargo' } }];
  assert.throws(() => ImportExport.assertRestorablePackExportJSON(JSON.stringify(tampered)), /annotations are not valid/);
  tampered.data.pack.annotations = [fine[0], fine[0]];
  assert.throws(() => ImportExport.assertRestorablePackExportJSON(JSON.stringify(tampered)), /duplicate annotation id/);

  assert.doesNotThrow(() => ImportExport.buildRestorablePackExportJSON({ ...PackLibrary.getById('FINE'), annotations: many.slice(0, 200) }));
  const oddJson = ImportExport.buildRestorablePackExportJSON(PackLibrary.getById('ODD'));
  const batchJson = ImportExport.buildRestorablePackBatchExportJSON([PackLibrary.getById('FINE'), PackLibrary.getById('ODD')]);
  emptyDestination();
  const roundTrip = payload => PackLibrary.planPackImport(ImportExport.parsePackImportJSON(payload)).pack.annotations;
  assert.deepEqual(roundTrip(json).map(r => r.id), ['a', 'b']);
  assert.deepEqual(roundTrip(json)[0], fine[0], 'a callout round-trips exactly');
  const odd = roundTrip(oddJson);
  assert.equal(odd[0].type, A.ANNOTATION_TYPE_UNREADABLE);
  assert.deepEqual(odd[0].original, unreadable, 'a record the app could not read is exported and restored untouched');
  const batch = ImportExport.parsePackBatchImportJSON(batchJson);
  assert.deepEqual(batch.map(entry => entry.pack.annotations.length), [2, 1]);
});

test('Workspace Backup and Active Workspace Backup carry annotations and restore them with their cargo', () => {
  const plan = makePack('S', {
    loadPlanNumber: 'LP-S', cases: [solidInstance(' cargo ')],
    annotations: [callout('a', onCargo(' cargo '), { offset: { dx: 12, dy: -8 }, keepExpanded: true, hidden: true }), callout('b', ground(4, 4))],
  });
  seed([plan]);
  assert.deepEqual(statuses('S'), ['valid', 'valid'], 'control: before backup both spell the same identity');
  const workspaceJson = ImportExport.buildWorkspaceExportJSON('Probe', 'ws-1');
  const appJson = ImportExport.buildAppExportJSON();
  const check = (cases, annotations, label) => {
    assert.equal(cases[0].id, 'cargo', `${label}: the cargo ID is canonical`);
    assert.equal(annotations[0].anchor.instanceId, 'cargo', `${label}: the anchor followed it`);
    assert.deepEqual([annotations[0].offset, annotations[0].keepExpanded, annotations[0].hidden], [{ dx: 12, dy: -8 }, true, true], `${label}: presentation survives`);
    assert.equal(annotations.length, 2, `${label}: nothing dropped`);
  };
  const imported = ImportExport.parseWorkspaceImportJSON(workspaceJson);
  const restore = ImportExport.planWorkspaceRestore(imported, { currentState: StateStore.snapshot() });
  check(restore.packLibrary[0].cases, restore.packLibrary[0].annotations, 'Workspace Backup');
  StateStore.init({ currentScreen: 'editor', currentPackId: 'S', caseLibrary: restore.caseLibrary, folderLibrary: [], preferences: {}, packLibrary: restore.packLibrary });
  assert.deepEqual(statuses('S'), ['valid', 'valid'], 'and they resolve after the restore');
  const again = normalizeAppData({ caseLibrary: restore.caseLibrary, packLibrary: restore.packLibrary, folderLibrary: [], preferences: {} });
  assert.deepEqual(again.packLibrary[0].annotations, restore.packLibrary[0].annotations, 'restoring restored data changes nothing');

  const app = ImportExport.parseAppImportJSON(appJson);
  check(app.packLibrary[0].cases, app.packLibrary[0].annotations, 'Active Workspace Backup');
  assert.doesNotThrow(() => ImportExport.assertRestorableWorkspaceBackup(workspaceJson));
  // Legacy full export projects the same way.
  assert.deepEqual(JSON.parse(CoreStorage.exportAppJSON()).data.packLibrary[0].annotations.map(r => r.id), ['a', 'b']);
  seed([makePack('Z')]);
  assert.equal(Object.hasOwn(JSON.parse(CoreStorage.exportAppJSON()).data.packLibrary[0], 'annotations'), false, 'no annotations, no field');
});

test('custom colors survive save, duplicate, Load Plan import/export, Workspace Backup and restore; a malformed color is never silently replaced', () => {
  seed();
  const added = PackLibrary.addCallout('A', note('Custom', ground(10, 10), { color: '#FFA500' }));
  assert.equal(added.ok, true);
  assert.equal(PackLibrary.getAnnotations('A')[0].color, '#ffa500', 'stored canonical');
  assert.equal(PackLibrary.addCallout('A', note('Bad', ground(11, 11), { color: 'orange' })).reason, 'invalid', 'a malformed color is refused at write');
  assert.equal(PackLibrary.addCallout('A', note('Bad', ground(11, 11), { color: '#12' })).reason, 'invalid');
  assert.equal(PackLibrary.getAnnotations('A').length, 1, 'refused writes store nothing');
  assert.equal(PackLibrary.updateCallout('A', added.annotation.id, { color: 'javascript:1' }).reason, 'invalid');
  assert.equal(PackLibrary.getAnnotations('A')[0].color, '#ffa500', 'and the stored color is unchanged');
  assert.equal(PackLibrary.updateCallout('A', added.annotation.id, { color: '#00ff7f' }).ok, true);
  assert.equal(PackLibrary.updateCallout('A', added.annotation.id, { color: 'red' }).ok, true, 'back to a built-in name');
  assert.equal(PackLibrary.updateCallout('A', added.annotation.id, { color: '#00FF7F' }).ok, true);
  assert.equal(PackLibrary.getAnnotations('A')[0].color, '#00ff7f');

  const copy = PackLibrary.duplicate('A');
  assert.equal(PackLibrary.getAnnotations(copy.id)[0].color, '#00ff7f', 'duplicate');

  const exported = JSON.parse(CoreStorage.exportAppJSON()).data.packLibrary.find(p => p.id === 'A').annotations;
  assert.equal(exported[0].color, '#00ff7f', 'export');
  assert.equal(PackLibrary.planPackImport(importPayload(exported)).pack.annotations[0].color, '#00ff7f', 'Load Plan import');
  const blocked = /Pack import blocked: the annotations are not valid/;
  for (const color of ['#00ff7', 'teal', '#00ff7fff', 'url(x)']) {
    assert.throws(() => PackLibrary.planPackImport(importPayload([{ ...exported[0], color }])), blocked, `import refuses ${color}`);
  }

  const workspaceJson = ImportExport.buildWorkspaceExportJSON('Probe', 'ws-1');
  const restore = ImportExport.planWorkspaceRestore(ImportExport.parseWorkspaceImportJSON(workspaceJson), { currentState: StateStore.snapshot() });
  assert.deepEqual(restore.packLibrary.find(p => p.id === 'A').annotations.map(r => r.color), ['#00ff7f'], 'Workspace Backup and restore');
  const tampered = JSON.parse(workspaceJson);
  tampered.data.packLibrary.find(p => p.id === 'A').annotations[0].color = 'not-a-color';
  assert.throws(() => ImportExport.assertRestorableWorkspaceBackup(JSON.stringify(tampered)), /color|annotation/i, 'restore validation is strict');

  // A stored record with a malformed color is preserved verbatim for recovery, not defaulted to Ink.
  const stored = { ...exported[0], color: 'not-a-color' };
  const kept = normalizePack(makePack('R', { annotations: [stored] })).annotations;
  assert.equal(kept[0].type, A.ANNOTATION_TYPE_UNREADABLE);
  assert.deepEqual(kept[0].original, stored);
});

test('the generic Pack update cannot write annotations: invalid, over-cap or any other patch leaves state, lastEdited, notifications and history alone', () => {
  seed();
  PackLibrary.addCallout('A', note('Keep', ground(10, 10)));
  const notifications = [];
  const unsubscribe = StateStore.subscribe((_changes, _state, notification) => { if (notification) notifications.push(notification.type); });
  try {
    const before = JSON.stringify(stored('A'));
    const edited = stored('A').lastEdited;
    const stateBefore = JSON.stringify(StateStore.snapshot().packLibrary);
    const valid = n => Array.from({ length: n }, (_, i) => callout(`g${i}`, ground(i, 1)));
    assert.equal(PackLibrary.update('A', { annotations: valid(201) }), null, 'over the cap');
    assert.equal(PackLibrary.update('A', { annotations: [callout('bad', ground(1, 1), { color: 'url(x)' })] }), null, 'an invalid color');
    assert.equal(PackLibrary.update('A', { annotations: [] }), null, 'even an empty list: the dedicated writers own deletion');
    assert.equal(PackLibrary.update('A', { annotations: valid(2), title: 'Sneaky' }), null, 'a mixed patch is refused as a whole');
    assert.equal(JSON.stringify(stored('A')), before, 'the Pack is untouched');
    assert.equal(stored('A').lastEdited, edited);
    assert.equal(JSON.stringify(StateStore.snapshot().packLibrary), stateBefore);
    assert.deepEqual(notifications, [], 'no notification');
    assert.equal(StateStore.undo(), false, 'and no history step');
    // Legacy updates and whole-Pack patches that merely repeat the stored annotations still work.
    assert.ok(PackLibrary.update('A', { title: 'Renamed' }), 'an ordinary update');
    assert.equal(stored('A').title, 'Renamed');
    assert.deepEqual(PackLibrary.getAnnotations('A').map(r => r.title), ['Keep'], 'annotations survive');
    assert.ok(PackLibrary.update('A', { ...stored('A'), title: 'Whole-Pack patch' }), 'a whole-Pack patch repeating the same annotations');
    assert.equal(stored('A').title, 'Whole-Pack patch');
    assert.equal(PackLibrary.getAnnotations('A').length, 1);
  } finally {
    unsubscribe();
  }
});

// ============================================================================
// SECTION: CARGO IDENTITY SURVIVES NORMALIZATION
// ============================================================================

test('normalization canonicalizes a cargo ID, carries its annotation with it and is idempotent', () => {
  const raw = makePack('S', {
    loadPlanNumber: 'LP-S', cases: [solidInstance(' cargo ')],
    annotations: [callout('a', onCargo(' cargo '))],
  });
  const normalized = normalizePack(raw, caseMap, 1);
  assert.equal(normalized.cases[0].id, 'cargo');
  assert.equal(normalized.annotations[0].anchor.instanceId, 'cargo', 'the anchor follows it through an explicit map');
  assert.deepEqual(normalized.annotations[0].anchor.local, raw.annotations[0].anchor.local);
  assert.equal(raw.annotations[0].anchor.instanceId, ' cargo ', 'the raw input was not mutated');
  const twice = normalizePack(normalized, caseMap, 1);
  const thrice = normalizePack(twice, caseMap, 1);
  assert.deepEqual(twice, normalized);
  assert.deepEqual(thrice, normalized);
  assert.equal(thrice.annotations, twice.annotations, 'an unchanged list is returned as is, not rebuilt');
  seed([normalized]);
  assert.deepEqual(statuses('S'), ['valid']);
});

test('an annotation on cargo whose ID another item shares is never resolved onto an arbitrary item', () => {
  const noCase = id => ({ ...solidInstance(id), caseId: '' }); // normalization discards an instance with no Case reference
  const raw = makePack('X', { loadPlanNumber: 'LP-X', cases: [solidInstance('cargo'), noCase(' cargo ')], annotations: [callout('a', onCargo(' cargo '))] });
  // The stored plan as written is ambiguous: Unresolved, nothing rewritten.
  seed([{ ...raw, cases: raw.cases.map(c => ({ ...c, caseId: CASE.id })) }]);
  assert.deepEqual(statuses('X'), ['unresolved:cargo-ambiguous']);
  // Normalization must not let the survivor inherit the reference.
  const normalized = normalizePack(raw, caseMap, 1);
  assert.deepEqual(normalized.cases.map(c => c.id), ['cargo']);
  assert.equal(normalized.annotations[0].type, A.ANNOTATION_TYPE_UNREADABLE, 'the annotation is withheld into the recovery record');
  assert.deepEqual(normalized.annotations[0].original, raw.annotations[0], 'verbatim');
  seed([normalized]);
  assert.deepEqual(statuses('X'), ['unresolved:unreadable'], 'never Valid on the surviving cargo');
  assert.deepEqual(normalizePack(normalized, caseMap, 1), normalized);
  // A damaged stored plan is kept as is, and duplicating it never guesses the ambiguous anchor.
  seed([{ ...raw, cases: [solidInstance('dup'), solidInstance('dup'), solidInstance('solo')], annotations: [callout('amb', onCargo('dup')), callout('ok', onCargo('solo'))] }]);
  const copy = PackLibrary.duplicate('X');
  const ids = new Set(copy.cases.map(c => c.id));
  const [ambiguous, clear] = PackLibrary.getAnnotations(copy.id);
  assert.equal(ambiguous.anchor.instanceId, 'dup', 'the ambiguous anchor is left exactly as it was');
  assert.equal(ids.has(clear.anchor.instanceId), true, 'the unambiguous anchor follows its cargo');
  assert.deepEqual(statuses(copy.id), ['unresolved:cargo-ambiguous', 'valid'].map(s => (s === 'unresolved:cargo-ambiguous' ? 'unresolved:cargo-missing' : s)),
    'in the copy the ambiguous anchor names no cargo at all');
});

// ============================================================================
// SECTION: ARROWS (V1B.1) — writers, derived validity, duplicate, import, backup, identity
// ============================================================================

const floorAnchor = (x = 120) => M.buildFloorAnchor({ surface: 'main', point: { x, y: 0, z: 0 } });
const arrowRecord = (id, start = ground(0, 60), end = ground(40, 60), extra = {}) => A.createArrowRecord({ id, start, end, now: 1, ...extra });
const top = instanceId => onCargo(instanceId, { x: 0, y: 16, z: 0 });
const solidAt = (id, x) => ({ ...solidInstance(id), transform: { ...solidInstance(id).transform, position: { x, y: 16, z: 0 } } });
const twoCrates = packId => ['first', 'second'].map((_, i) => PackLibrary.addInstance(packId, CASE.id, { x: 60 + i * 100, y: 16, z: 0 }));
const wrapperOf = (id, original, reason = 'Saved by a newer version of the app.') => ({ id, type: 'unreadable', schemaVersion: 1, reason, original });
const setLastEdited = (packId, value) => StateStore.set({
  packLibrary: StateStore.get('packLibrary').map(p => (p.id === packId ? { ...p, lastEdited: value } : p)),
}, { skipHistory: true });

test('arrow writers are annotation-only edits: lastEdited moves, cargo Undo does not, cargo and callouts stay untouched', () => {
  seed();
  const [a, b] = twoCrates('A');
  const callout1 = PackLibrary.addCallout('A', note('Beside', ground(3, 3))).annotation;
  StateStore.resetHistory();
  setLastEdited('A', 123);
  const notifications = [];
  const unsubscribe = StateStore.subscribe((_changes, _state, notification) => { if (notification) notifications.push(notification.type); });
  try {
    const cargoBefore = JSON.stringify(stored('A').cases);
    const calloutBefore = JSON.stringify(PackLibrary.getAnnotations('A')[0]);
    const added = PackLibrary.addArrow('A', { start: top(a.id), end: top(b.id), color: '#FFA500', width: 'bold' });
    assert.equal(added.ok, true);
    assert.deepEqual([added.annotation.type, added.annotation.color, added.annotation.width, added.annotation.hidden], ['arrow', '#ffa500', 'bold', false]);
    assert.equal(notifications.at(-1), 'pack-annotations', 'the derived notification: only the overlay and list refresh');
    assert.ok(stored('A').lastEdited > 123, 'creating an arrow updates lastEdited');
    assert.equal(StateStore.undo(), false, 'and adds no cargo Undo step');
    assert.equal(stored('B').annotations, undefined, 'another Load Plan is untouched');
    const id = added.annotation.id;

    assert.equal(PackLibrary.updateArrow('A', id, { color: 'red', width: 'thin', hidden: true }).ok, true);
    const edited = PackLibrary.getAnnotations('A')[1];
    assert.deepEqual([edited.color, edited.width, edited.hidden], ['red', 'thin', true]);
    assert.deepEqual([edited.start, edited.end, edited.createdAt], [added.annotation.start, added.annotation.end, added.annotation.createdAt]);
    const editedAt = stored('A').lastEdited;
    assert.equal(PackLibrary.updateArrow('A', id, { width: 'thin' }).unchanged, true, 'an unchanged edit writes nothing');
    assert.equal(stored('A').lastEdited, editedAt);
    assert.equal(PackLibrary.updateArrow('A', id, { width: 'huge' }).reason, 'invalid');
    assert.equal(PackLibrary.updateArrow('A', id, { color: 'javascript:1' }).reason, 'invalid');
    assert.equal(PackLibrary.updateArrow('A', 'nope', { width: 'bold' }).reason, 'not-found');
    assert.equal(PackLibrary.updateArrow('missing', id, { width: 'bold' }).reason, 'pack-not-found');
    assert.equal(PackLibrary.updateArrow('A', callout1.id, { width: 'bold' }).reason, 'not-found', 'a callout is not an arrow');
    assert.equal(PackLibrary.updateCallout('A', id, { title: 'x' }).reason, 'not-found', 'nor an arrow a callout');
    assert.equal(PackLibrary.reattachCallout('A', id, ground(1, 1)).reason, 'not-found');

    const toFloor = floorAnchor(100);
    assert.equal(PackLibrary.moveArrowEndpoint('A', id, 'end', toFloor).ok, true);
    const moved = PackLibrary.getAnnotations('A')[1];
    assert.deepEqual([moved.start, moved.end, moved.createdAt, moved.width], [added.annotation.start, toFloor, added.annotation.createdAt, 'thin'], 'only that end moved');
    assert.equal(PackLibrary.moveArrowEndpoint('A', id, 'end', toFloor).unchanged, true);
    const refused = JSON.stringify(PackLibrary.getAnnotations('A'));
    assert.equal(PackLibrary.moveArrowEndpoint('A', id, 'middle', ground(9, 9)).reason, 'invalid');
    assert.equal(PackLibrary.moveArrowEndpoint('A', id, 'end', { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } }).reason, 'invalid');
    assert.equal(PackLibrary.moveArrowEndpoint('A', id, 'end', { ...top(a.id), local: { x: 0, y: 0, z: 0 } }).reason, 'invalid', 'a point off the cargo surface');
    assert.equal(PackLibrary.moveArrowEndpoint('A', id, 'end', added.annotation.start).reason, 'invalid', 'both ends on the same point');
    assert.equal(PackLibrary.moveArrowEndpoint('A', callout1.id, 'end', ground(9, 9)).reason, 'not-found');
    assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), refused, 'refused moves change nothing');

    const removed = PackLibrary.deleteAnnotation('A', id);
    assert.deepEqual([removed.ok, removed.index, removed.removed.type], [true, 1, 'arrow']);
    assert.equal(PackLibrary.restoreAnnotation('A', removed.removed, removed.index).ok, true, 'the type-agnostic Undo puts an arrow back');
    assert.deepEqual(PackLibrary.getAnnotations('A').map(r => r.id), [callout1.id, id]);
    assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')[0]), calloutBefore, 'the callout is byte-identical');
    assert.equal(JSON.stringify(stored('A').cases), cargoBefore, 'cargo is untouched');
    assert.equal(StateStore.undo(), false, 'no arrow edit added a cargo Undo step');
  } finally { unsubscribe(); }
});

test('an arrow is only written against ends that resolve now and sit at least half an inch apart; a refused write changes nothing', () => {
  seed([makePack('A'), makePack('D', { cases: [solidInstance('dup'), solidInstance('dup')] })]);
  const [a, b] = twoCrates('A');
  StateStore.resetHistory();
  const before = snapshotOf();
  const refuse = (input, reason, packId = 'A') => {
    assert.equal(PackLibrary.addArrow(packId, input).reason, reason, JSON.stringify(Object.keys(input)));
    assert.equal(snapshotOf(), before, 'nothing was written');
  };
  refuse({ start: top('gone'), end: top(b.id) }, 'unresolved');
  refuse({ start: top(a.id), end: floorAnchor(1000) }, 'unresolved');
  refuse({ start: onCargo('dup'), end: ground(40, 60) }, 'unresolved', 'D');
  refuse({ start: ground(10, 10), end: ground(10.4, 10) }, 'too-short');
  refuse({ start: ground(10, 10), end: ground(10, 10) }, 'invalid');
  refuse({ start: ground(10, 10), end: ground(40, 10), width: 'huge' }, 'invalid');
  refuse({ start: ground(10, 10), end: ground(40, 10), color: 'url(x)' }, 'invalid');
  refuse({ start: null, end: ground(40, 10) }, 'invalid');
  assert.equal(PackLibrary.addArrow('missing', { start: ground(1, 1), end: ground(9, 9) }).reason, 'pack-not-found');
  StateStore.set({ caseLibrary: [{ ...CASE, dimensions: { ...CASE.dimensions, length: 60 } }] }, { skipHistory: true });
  const resized = snapshotOf();
  assert.equal(PackLibrary.addArrow('A', { start: top(a.id), end: ground(40, 60) }).reason, 'unresolved', 'Needs Review is refused too');
  assert.equal(snapshotOf(), resized);
  StateStore.set({ caseLibrary: [CASE] }, { skipHistory: true });

  assert.equal(PackLibrary.addArrow('A', { start: ground(10, 10), end: ground(10.5, 10) }).ok, true, 'exactly half an inch is long enough');
  for (const [start, end] of [[top(a.id), top(b.id)], [top(a.id), floorAnchor()], [floorAnchor(), ground(2, 2)], [ground(2, 2), top(b.id)]]) {
    assert.equal(PackLibrary.addArrow('A', { start, end }).ok, true, `${start.kind} to ${end.kind}`);
  }

  // Moving an end: the new anchor must resolve; a broken other end only means the length is not checked.
  const arrow = PackLibrary.addArrow('A', { start: top(a.id), end: ground(40, 60) }).annotation;
  assert.equal(PackLibrary.moveArrowEndpoint('A', arrow.id, 'end', top('gone')).reason, 'unresolved');
  assert.equal(PackLibrary.moveArrowEndpoint('A', arrow.id, 'end', M.buildSpaceAnchor({ surface: 'free', point: { x: 60, y: 32.2, z: 0 } })).reason, 'too-short', 'it would end on top of its tail');
  PackLibrary.removeInstances('A', [a.id]);
  assert.equal(PackLibrary.resolveAnnotations('A').at(-1).startReason, 'cargo-missing');
  assert.equal(PackLibrary.moveArrowEndpoint('A', arrow.id, 'end', ground(40, 20)).ok, true, 'the healthy end of a broken arrow can still move');
  assert.equal(PackLibrary.moveArrowEndpoint('A', arrow.id, 'start', onCargo(a.id, { x: 5, y: 16, z: 0 })).reason, 'unresolved', 'but not onto cargo that is gone');
  assert.equal(PackLibrary.moveArrowEndpoint('A', arrow.id, 'start', top(a.id)).unchanged, true, 'naming the very anchor it already has writes nothing');
  assert.equal(PackLibrary.moveArrowEndpoint('A', arrow.id, 'start', ground(3, 3)).ok, true, 'repairing the broken end');
  assert.equal(PackLibrary.resolveAnnotations('A').at(-1).status, 'valid');
});

test('arrows share the per-plan maximum of 200 with callouts and recovery records, and the generic Pack update cannot write them', () => {
  seed([makePack('A', { annotations: [{ id: 'junk' }] }), makePack('B')]);
  for (let i = 0; i < 198; i++) assert.equal(PackLibrary.addCallout('A', note(`N${i}`, ground(i, 1))).ok, true);
  const last = PackLibrary.addArrow('A', { start: ground(0, 60), end: ground(40, 60) });
  assert.equal(last.ok, true);
  assert.equal(PackLibrary.getAnnotations('A').length, 200, '198 callouts + 1 recovery record + 1 arrow');
  const before = JSON.stringify(PackLibrary.getAnnotations('A'));
  assert.equal(PackLibrary.addArrow('A', { start: ground(1, 60), end: ground(41, 60) }).reason, 'limit');
  assert.equal(PackLibrary.addCallout('A', note('over')).reason, 'limit');
  assert.equal(PackLibrary.restoreAnnotation('A', arrowRecord('late'), 0).reason, 'limit');
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), before, 'nothing is truncated or replaced');

  PackLibrary.deleteAnnotation('A', last.annotation.id);
  const written = stored('A');
  assert.equal(PackLibrary.update('A', { annotations: [arrowRecord('sneak')] }), null, 'the generic writer refuses arrows');
  assert.equal(PackLibrary.update('A', { annotations: [] }), null);
  assert.equal(PackLibrary.update('A', { annotations: [arrowRecord('sneak')], title: 'Sneaky' }), null, 'a mixed patch is refused whole');
  assert.equal(stored('A'), written, 'the Pack is untouched');
  PackLibrary.addArrow('B', { start: ground(0, 60), end: ground(40, 60) });
  assert.ok(PackLibrary.update('B', { ...stored('B'), title: 'Whole-Pack patch' }), 'a whole-Pack patch repeating the same annotations still works');
  assert.equal(PackLibrary.getAnnotations('B').length, 1);
});

test('cargo Undo/Redo keeps arrows and never rolls lastEdited back past an arrow edit', () => {
  seed();
  PackLibrary.addArrow('A', { start: ground(0, 60), end: ground(40, 60) });
  StateStore.set({ packLibrary: StateStore.get('packLibrary').map(p => (p.id === 'A' ? { ...p, notes: 'cargo edit' } : p)) });
  const second = PackLibrary.addArrow('A', { start: ground(5, 5), end: floorAnchor(50) });
  PackLibrary.updateArrow('A', second.annotation.id, { width: 'bold', hidden: true });
  const editedAt = stored('A').lastEdited;
  assert.equal(StateStore.undo(), true, 'the cargo edit is undone');
  assert.equal(stored('A').notes, undefined);
  assert.equal(PackLibrary.getAnnotations('A').length, 2, 'Undo neither erases nor resurrects arrows');
  assert.deepEqual([PackLibrary.getAnnotations('A')[1].width, PackLibrary.getAnnotations('A')[1].hidden], ['bold', true], 'including the latest edit');
  assert.ok(stored('A').lastEdited >= editedAt);
  assert.equal(StateStore.redo(), true);
  assert.equal(stored('A').notes, 'cargo edit');
  assert.equal(PackLibrary.getAnnotations('A').length, 2);
  assert.ok(stored('A').lastEdited >= editedAt);
});

test('each arrow end follows its own cargo: moving, deleting or resizing one flags the arrow, never edits or relocates it', () => {
  seed();
  const [a, b] = twoCrates('A');
  PackLibrary.addArrow('A', { start: top(a.id), end: top(b.id) });
  const record = JSON.stringify(PackLibrary.getAnnotations('A'));
  const resolved = () => PackLibrary.resolveAnnotations('A')[0];
  const first = resolved();
  assert.deepEqual([first.status, first.start.x, first.end.x], ['valid', 60, 160]);
  const pose = (position, rotation = { x: 0, y: 0, z: 0 }) => ({ transform: { position, rotation, scale: { x: 1, y: 1, z: 1 } } });
  assert.ok(PackLibrary.updateInstance('A', b.id, pose({ x: 200, y: 16, z: 10 })));
  assert.deepEqual([resolved().start, resolved().end.x, resolved().end.z], [first.start, 200, 10], 'only the end on the moved cargo moved');
  assert.ok(PackLibrary.updateInstance('A', a.id, { ...pose({ x: 500, y: 16, z: 200 }), placement: 'staged' }));
  assert.equal(resolved().status, 'valid', 'a staged case keeps its arrow');
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), record, 'the stored arrow never changed');

  PackLibrary.removeInstances('A', [b.id]);
  assert.equal(PackLibrary.getAnnotations('A').length, 1, 'editing cargo never deletes an arrow');
  const gone = resolved();
  assert.deepEqual([gone.status, gone.reason, gone.start, gone.end], ['unresolved', 'cargo-missing', null, null], 'no half arrow, no fabricated position');
  assert.deepEqual([gone.startStatus, gone.endStatus, gone.endReason], ['valid', 'unresolved', 'cargo-missing'], 'the broken end is named');
  assert.equal(StateStore.undo(), true);
  assert.equal(resolved().status, 'valid', 'Undo restores the same instance ID and the arrow resolves again');
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), record);

  const setCase = patch => StateStore.set({ caseLibrary: [{ ...CASE, ...patch }] }, { skipHistory: true });
  setCase({ dimensions: { ...CASE.dimensions, length: 60 } });
  assert.deepEqual([resolved().status, resolved().reason, resolved().start, resolved().end], ['needs-review', 'case-changed', null, null]);
  setCase({});
  assert.equal(resolved().status, 'valid', 'restoring the definition recovers it');
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), record, 'nothing was rewritten or relocated');
});

test('duplicating a Load Plan re-targets each arrow end to its own copied cargo; unmapped ends stay exact and wrappers are copied verbatim', () => {
  seed();
  const [a, b] = twoCrates('A');
  assert.deepEqual(stored('A').cases.map(c => c.id), [a.id, b.id]);
  PackLibrary.addArrow('A', { start: top(a.id), end: top(b.id), color: 'blue', width: 'bold' });
  PackLibrary.addArrow('A', { start: top(b.id), end: floorAnchor() });
  PackLibrary.addArrow('A', { start: ground(2, 2), end: top(a.id) });
  PackLibrary.addCallout('A', note('On a', top(a.id)));
  const original = JSON.stringify(PackLibrary.getAnnotations('A'));
  const copy = PackLibrary.duplicate('A');
  const [copyA, copyB] = copy.cases.map(c => c.id);
  assert.equal(new Set([a.id, b.id, copyA, copyB]).size, 4);
  const [one, two, three, note1] = PackLibrary.getAnnotations(copy.id);
  assert.deepEqual([one.start.instanceId, one.end.instanceId], [copyA, copyB], 'each end follows its own cargo, not swapped');
  assert.deepEqual([one.color, one.width], ['blue', 'bold'], 'presentation travels with it');
  assert.deepEqual([two.start.instanceId, two.end], [copyB, floorAnchor()], 'cargo to floor');
  assert.deepEqual([three.start, three.end.instanceId], [ground(2, 2), copyA], 'space to cargo');
  assert.equal(note1.anchor.instanceId, copyA);
  assert.deepEqual(statuses(copy.id), ['valid', 'valid', 'valid', 'valid']);
  assert.equal(JSON.stringify(PackLibrary.getAnnotations('A')), original, 'the original plan keeps its anchors');

  // A damaged plan: an ambiguous ID is never mapped, an unknown ID stays exact, a wrapper is not touched.
  const inner = arrowRecord('inner', onCargo('solo'), ground(1, 1));
  seed([makePack('X', {
    loadPlanNumber: 'LP-X', cases: [solidInstance('dup'), solidInstance('dup'), solidAt('solo', 160)],
    annotations: [arrowRecord('amb', onCargo('dup'), onCargo('solo')), arrowRecord('mix', onCargo('solo'), onCargo('stranger')), wrapperOf('w', inner)],
  })]);
  assert.deepEqual(statuses('X'), ['unresolved:cargo-ambiguous', 'unresolved:cargo-missing', 'unresolved:unreadable']);
  const damaged = PackLibrary.duplicate('X');
  const soloCopy = damaged.cases[2].id;
  const [amb, mix, wrapper] = PackLibrary.getAnnotations(damaged.id);
  assert.deepEqual([amb.start.instanceId, amb.end.instanceId], ['dup', soloCopy], 'the ambiguous end is left exactly as it was');
  assert.deepEqual([mix.start.instanceId, mix.end.instanceId], [soloCopy, 'stranger'], 'an unknown end is left exactly as it was');
  assert.deepEqual(wrapper, wrapperOf('w', inner), 'a wrapper is copied verbatim, its contents never remapped');
  assert.deepEqual(statuses(damaged.id), ['unresolved:cargo-missing', 'unresolved:cargo-missing', 'unresolved:unreadable'], 'in the copy neither dangling end names any cargo');
});

test('importing a Load Plan remaps both arrow ends through the regenerated IDs; a damaged or unsupported record rejects the whole import', () => {
  seed([makePack('A')]);
  const inner = arrowRecord('inner', onCargo('old-1', { x: 1, y: 16, z: 2 }), ground(1, 1));
  const list = [
    arrowRecord('a1', onCargo('old-1', { x: 1, y: 16, z: 2 }), onCargo('old-2', { x: 3, y: 16, z: 0 })),
    arrowRecord('a2', onCargo('never-existed', { x: 0, y: 16, z: 0 }), ground(9, 9)),
    arrowRecord('a3', onCargo(' old-2 ', { x: 0, y: 16, z: 0 }), floorAnchor()),
    wrapperOf('w', inner),
  ];
  const plan = PackLibrary.planPackImport(importPayload(list, [solidInstance('old-1'), solidAt('old-2', 160)]));
  const [new1, new2] = plan.pack.cases.map(c => c.id);
  assert.equal(new1 !== 'old-1' && new2 !== 'old-2', true, 'imports regenerate instance IDs');
  const out = plan.pack.annotations;
  assert.deepEqual([out[0].start.instanceId, out[0].end.instanceId], [new1, new2], 'each end through the same old-to-new map');
  assert.deepEqual([out[0].start.local, out[0].end.local], [list[0].start.local, list[0].end.local]);
  assert.deepEqual([out[1].start.instanceId, out[1].end], ['never-existed', ground(9, 9)], 'a valid reference to missing cargo is retained, never guessed');
  assert.equal(out[2].start.instanceId, new2, 'a trimmed-equal ID follows the map too');
  assert.deepEqual(out[3], list[3], 'a wrapper is accepted verbatim: not remapped, not converted');
  assert.equal(out[3].original.start.instanceId, 'old-1');

  const blocked = /Pack import blocked: the annotations are not valid/;
  const good = list[1];
  const rejected = [
    ['unknown width', { ...good, width: 'huge' }], ['unknown key', { ...good, label: 'Door' }], ['same point', { ...good, end: good.start }],
    ['later schema', { ...good, schemaVersion: 2 }], ['draw', { id: 'd', type: 'draw', schemaVersion: 1, points: [1, 2] }], ['missing end', { ...good, end: undefined }],
  ];
  for (const [label, record] of rejected) assert.throws(() => PackLibrary.planPackImport(importPayload([good, record])), blocked, label);
  assert.throws(() => PackLibrary.planPackImport(importPayload([good, { ...good }])), /duplicate/);
  assert.equal(PackLibrary.planPackImport(importPayload(Array.from({ length: 200 }, (_, i) => arrowRecord(`r${i}`, ground(i, 1), ground(i, 40))))).pack.annotations.length, 200);
  assert.throws(() => PackLibrary.planPackImport(importPayload(Array.from({ length: 201 }, (_, i) => arrowRecord(`r${i}`, ground(i, 1), ground(i, 40))))), /too many/);
});

test('arrows survive export, Load Plan import/export, Workspace Backup and restore; a tampered arrow or a draw is refused', () => {
  const inner = arrowRecord('inner', onCargo(' c1 '), ground(1, 1));
  const list = [
    arrowRecord('a', onCargo(' c1 '), onCargo('c2'), { color: '#ABCDEF', width: 'thin', hidden: true }),
    arrowRecord('b', ground(4, 4), floorAnchor()),
    callout('c', ground(1, 1)),
    wrapperOf('w', inner),
  ];
  const plan = makePack('S', { loadPlanNumber: 'LP-S', cases: [solidAt(' c1 ', 60), solidAt('c2', 160)], annotations: list });
  seed([plan]);
  assert.deepEqual(statuses('S'), ['valid', 'valid', 'valid', 'unresolved:unreadable']);
  for (const project of [projectPortablePack, projectPortableWorkspacePack]) {
    assert.deepEqual(project(plan).annotations, A.normalizeAnnotations(list), `${project.name} carries arrows`);
  }
  const check = (cases, annotations, label) => {
    assert.deepEqual(cases.map(c => c.id), ['c1', 'c2'], `${label}: the cargo IDs are canonical`);
    assert.deepEqual([annotations[0].start.instanceId, annotations[0].end.instanceId], ['c1', 'c2'], `${label}: both ends followed`);
    assert.deepEqual([annotations[0].color, annotations[0].width, annotations[0].hidden], ['#abcdef', 'thin', true], `${label}: presentation survives`);
    assert.deepEqual(annotations[1], list[1], `${label}: an arrow between non-cargo anchors is exact`);
    assert.deepEqual(annotations[3], list[3], `${label}: the wrapper is exact, its ' c1 ' untouched`);
    assert.equal(annotations.length, 4, `${label}: nothing dropped`);
  };
  const workspaceJson = ImportExport.buildWorkspaceExportJSON('Probe', 'ws-1');
  const restore = ImportExport.planWorkspaceRestore(ImportExport.parseWorkspaceImportJSON(workspaceJson), { currentState: StateStore.snapshot() });
  check(restore.packLibrary[0].cases, restore.packLibrary[0].annotations, 'Workspace Backup');
  StateStore.init({ currentScreen: 'editor', currentPackId: 'S', caseLibrary: restore.caseLibrary, folderLibrary: [], preferences: {}, packLibrary: restore.packLibrary });
  assert.deepEqual(statuses('S'), ['valid', 'valid', 'valid', 'unresolved:unreadable'], 'and they resolve after the restore');
  const again = normalizeAppData({ caseLibrary: restore.caseLibrary, packLibrary: restore.packLibrary, folderLibrary: [], preferences: {} });
  assert.deepEqual(again.packLibrary[0].annotations, restore.packLibrary[0].annotations, 'restoring restored data changes nothing');
  const app = ImportExport.parseAppImportJSON(ImportExport.buildAppExportJSON());
  check(app.packLibrary[0].cases, app.packLibrary[0].annotations, 'Active Workspace Backup');
  assert.deepEqual(JSON.parse(CoreStorage.exportAppJSON()).data.packLibrary[0].annotations.map(r => r.id), ['a', 'b', 'c', 'w']);
  assert.doesNotThrow(() => ImportExport.assertRestorableWorkspaceBackup(workspaceJson));

  const tamper = mutate => {
    const copy = JSON.parse(workspaceJson);
    mutate(copy.data.packLibrary[0].annotations);
    return JSON.stringify(copy);
  };
  assert.throws(() => ImportExport.assertRestorableWorkspaceBackup(tamper(l => { l[0].width = 'huge'; })), /annotation/i);
  assert.throws(() => ImportExport.assertRestorableWorkspaceBackup(tamper(l => { l[0].label = 'x'; })), /annotation/i);
  assert.throws(() => ImportExport.assertRestorableWorkspaceBackup(tamper(l => { l[0].end = l[0].start; })), /annotation/i);
  assert.throws(() => ImportExport.assertRestorableWorkspaceBackup(tamper(l => { l.push({ id: 'd', type: 'draw', schemaVersion: 1, points: [] }); })), /annotation/i, 'draw is not accepted until V1B.2');
  assert.throws(() => ImportExport.assertRestorableWorkspaceBackup(tamper(l => { l[1].id = 'a'; })), /duplicate/i);

  // A single Load Plan exported and imported again: ends follow the regenerated IDs, nothing else changes.
  seed([makePack('P', { loadPlanNumber: 'LP-P', cases: [solidAt('p1', 60), solidAt('p2', 160)], annotations: [arrowRecord('a', top('p1'), top('p2'), { width: 'bold' })] })]);
  const exported = ImportExport.buildRestorablePackExportJSON(PackLibrary.getById('P'));
  emptyDestination();
  const imported = PackLibrary.planPackImport(ImportExport.parsePackImportJSON(exported)).pack;
  const [n1, n2] = imported.cases.map(c => c.id);
  assert.deepEqual([imported.annotations[0].start.instanceId, imported.annotations[0].end.instanceId, imported.annotations[0].width], [n1, n2, 'bold']);
  assert.equal(n1 !== 'p1' && n2 !== 'p2', true);
});

test('normalization canonicalizes both arrow ends, withholds an arrow on a contested ID and never converts a wrapper', () => {
  const inner = arrowRecord('inner', onCargo(' c1 '), ground(1, 1));
  const raw = makePack('S', {
    loadPlanNumber: 'LP-S', cases: [solidAt(' c1 ', 60), solidAt(' c2 ', 160)],
    annotations: [arrowRecord('a', onCargo(' c1 '), onCargo(' c2 ')), wrapperOf('w', inner)],
  });
  const normalized = normalizePack(raw, caseMap, 1);
  assert.deepEqual(normalized.cases.map(c => c.id), ['c1', 'c2']);
  assert.deepEqual([normalized.annotations[0].start.instanceId, normalized.annotations[0].end.instanceId], ['c1', 'c2']);
  assert.deepEqual(normalized.annotations[1], raw.annotations[1], 'the wrapper keeps its original ID spelling: nothing reached inside it');
  assert.equal(raw.annotations[0].start.instanceId, ' c1 ', 'the raw input was not mutated');
  const twice = normalizePack(normalized, caseMap, 1);
  assert.deepEqual(twice, normalized);
  assert.deepEqual(normalizePack(twice, caseMap, 1), normalized);
  assert.equal(normalizePack(twice, caseMap, 1).annotations, twice.annotations, 'an unchanged list is returned as is');
  seed([normalized]);
  assert.deepEqual(statuses('S'), ['valid', 'unresolved:unreadable'], 'the wrapper has a unique holder to resolve onto, and still does not');

  const noCase = id => ({ ...solidInstance(id), caseId: '' }); // normalization discards an instance with no Case reference
  const rawX = makePack('X', {
    loadPlanNumber: 'LP-X', cases: [solidInstance('cargo'), noCase(' cargo '), solidAt('other', 160)],
    annotations: [
      arrowRecord('on-start', onCargo(' cargo '), onCargo('other')), arrowRecord('on-end', onCargo('other'), onCargo(' cargo ')),
      arrowRecord('fine', onCargo('other'), ground(1, 1)),
    ],
  });
  seed([{ ...rawX, cases: rawX.cases.map(c => ({ ...c, caseId: CASE.id })) }]);
  assert.deepEqual(statuses('X'), ['unresolved:cargo-ambiguous', 'unresolved:cargo-ambiguous', 'valid'], 'as written, the plan is ambiguous: nothing rewritten');
  const normalizedX = normalizePack(rawX, caseMap, 1);
  assert.deepEqual(normalizedX.cases.map(c => c.id), ['cargo', 'other']);
  assert.deepEqual(normalizedX.annotations.slice(0, 2).map(r => r.type), [A.ANNOTATION_TYPE_UNREADABLE, A.ANNOTATION_TYPE_UNREADABLE], 'either end contested withholds the whole arrow');
  assert.deepEqual(normalizedX.annotations.slice(0, 2).map(r => r.original), rawX.annotations.slice(0, 2), 'verbatim');
  assert.equal(normalizedX.annotations[2].type, A.ANNOTATION_TYPE_ARROW);
  seed([normalizedX]);
  assert.deepEqual(statuses('X'), ['unresolved:unreadable', 'unresolved:unreadable', 'valid'], 'never Valid on the surviving cargo');
  assert.deepEqual(normalizePack(normalizedX, caseMap, 1), normalizedX, 'idempotent');
});

test('an older unreadable wrapper holding a valid arrow stays inert through every write; draw stays unsupported', () => {
  const inner = arrowRecord('inner', onCargo('c1'), ground(40, 60));
  const wrapper = wrapperOf('w', inner);
  const drawRaw = { id: 'drw', type: 'draw', schemaVersion: 1, points: [1, 2] };
  seed([makePack('A', { loadPlanNumber: 'LP-A', cases: [solidInstance('c1')], annotations: [wrapper, drawRaw] })]);
  assert.deepEqual(statuses('A'), ['unresolved:unreadable', 'unresolved:unreadable'], 'c1 exists and the arrow validates, but the wrapper is not resurrected');
  const added = PackLibrary.addArrow('A', { start: ground(0, 60), end: ground(40, 60) });
  assert.equal(added.ok, true);
  const kept = stored('A').annotations;
  assert.deepEqual(kept[0], wrapper, 'a write wraps, never converts or discards');
  assert.deepEqual([kept[1].type, kept[1].reason, kept[1].original], ['unreadable', 'Saved by a newer version of the app.', drawRaw], 'draw is kept and explained');
  assert.equal(PackLibrary.updateArrow('A', 'w', { width: 'bold' }).reason, 'not-found', 'a wrapper cannot be edited as an arrow');
  assert.equal(PackLibrary.moveArrowEndpoint('A', 'w', 'end', ground(9, 9)).reason, 'not-found');
  assert.equal(PackLibrary.restoreAnnotation('A', drawRaw, 0).reason, 'invalid', 'draw cannot be written yet');
  assert.equal(PackLibrary.restoreAnnotation('A', { ...inner, id: 'fresh' }, 0).ok, true, 'while a real arrow can');
  const copy = PackLibrary.duplicate('A');
  assert.deepEqual(PackLibrary.getAnnotations(copy.id).filter(r => r.type === 'unreadable').map(r => r.original), [inner, drawRaw], 'duplicate copies wrappers verbatim');
  assert.deepEqual(JSON.parse(CoreStorage.exportAppJSON()).data.packLibrary.find(p => p.id === 'A').annotations.filter(r => r.id === 'w'), [wrapper], 'and exports it verbatim');
  assert.equal(PackLibrary.deleteAnnotation('A', 'w').ok, true, 'the owner can still delete it deliberately');
  assert.equal(PackLibrary.getAnnotations('A').some(r => r.id === 'w'), false);
});
