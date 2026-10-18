/**
 * @file measurement-tool-lifecycle.spec.mjs
 * @description Pins how Measurement Tool V1 data lives inside a Load Plan: the normalizer whitelist
 *   (G1), writes that stay outside cargo Undo/Redo and never roll `lastEdited` back (G2), duplicate
 *   and import instance-ID remapping (G3), and export/backup projection plus strict restore
 *   validation (G4). The pure model is pinned in measurement-tool-core.spec.mjs.
 *   Contract: docs/product/TP3D-MASTER-TODO-V6.md Section 4.1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as StateStore from '../../src/core/state-store.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import * as PreferencesManager from '../../src/services/preferences-manager.js';
import * as M from '../../src/core/measurements.js';
import { normalizePack, normalizePreferences } from '../../src/core/normalizer.js';
import { projectPortablePack, projectPortableWorkspacePack, validateWorkspaceGraph } from '../../src/core/import-schema.js';

const CASE = {
  id: 'case-1', name: 'Crate', itemCode: 'C-1', manufacturer: 'Test', category: 'audio',
  dimensions: { length: 48, width: 24, height: 32 }, weight: 50, shape: 'box',
  stackable: true, maxStackCount: 2, orientationLock: 'upright', color: '#111111',
};
const makePack = (id, extra = {}) => ({
  id, title: id, loadPlanNumber: `LP-${id}`, truck: { length: 240, width: 96, height: 100 },
  cases: [], groups: [], stats: { totalCases: 0 }, lastEdited: 123,
  editorView: null, thumbnail: null, thumbnailVisualSignature: null, thumbnailViewSignature: null,
  ...extra,
});
const seed = (packs = [makePack('A'), makePack('B')]) => StateStore.init({
  currentScreen: 'editor', currentPackId: packs[0].id, caseLibrary: [CASE],
  folderLibrary: [], preferences: {}, packLibrary: packs,
});
const ground = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
const pair = (n = 1) => ({ start: ground(0, 60), end: ground(10 * n, 60) });
const stored = id => PackLibrary.getById(id);

test('G1 normalizePack whitelists measurements: legacy plans get [], valid ones persist, malformed ones are kept as recovery records', () => {
  assert.deepEqual(normalizePack(makePack('A')).measurements, [], 'a plan saved before the feature has none');
  const good = M.createMeasurementRecord({ id: 'g', ...pair(), now: 1 });
  assert.deepEqual(normalizePack(makePack('A', { measurements: [good] })).measurements, M.normalizeMeasurements([good]));
  const malformed = { id: 'bad', type: 'point-to-point', start: { kind: 'mystery' } };
  const kept = normalizePack(makePack('A', { measurements: [good, malformed] })).measurements;
  assert.equal(kept.length, 2, 'nothing is dropped');
  assert.equal(kept[1].type, M.MEASUREMENT_TYPE_UNREADABLE);
  assert.deepEqual(kept[1].original, malformed, 'the original record is preserved verbatim for recovery');
});

test('G1 a write keeps unreadable originals verbatim and an unrelated edit never touches stored measurements', () => {
  const rawBad = [{ id: 'bad-1', type: 'point-to-point', start: { kind: 'mystery' } }, 'garbage'];
  seed([makePack('A', { measurements: rawBad })]);
  assert.deepEqual(stored('A').measurements, rawBad, 'hydration keeps the raw stored value');
  PackLibrary.update('A', { notes: 'unrelated edit' });
  assert.deepEqual(stored('A').measurements, rawBad, 'an unrelated autosaved edit leaves malformed data verbatim');
  const added = PackLibrary.addMeasurement('A', pair());
  assert.equal(added.ok, true);
  const unreadable = stored('A').measurements.filter(r => r.type === M.MEASUREMENT_TYPE_UNREADABLE);
  assert.deepEqual(unreadable.map(r => r.original), rawBad, 'writing a measurement wraps, never discards, what could not be read');
  assert.equal(PackLibrary.resolveMeasurements('A').filter(r => r.reason === 'unreadable').length, 2);
  const removed = PackLibrary.deleteMeasurement('A', added.measurement.id);
  assert.equal(removed.ok, true);
  assert.equal(stored('A').measurements.length, 2, 'only the deliberately deleted record is gone');
});

test('showMeasurementTool defaults On, is a boolean preference and takes the lightweight visibility route', () => {
  assert.equal(normalizePreferences({}).showMeasurementTool, true);
  assert.equal(normalizePreferences({ showMeasurementTool: false }).showMeasurementTool, false);
  seed();
  const routes = [];
  const unsubscribe = StateStore.subscribe((changes, _state, notification) => {
    if (changes.preferences) routes.push(notification?.type ?? null);
  });
  try {
    const current = () => PreferencesManager.get();
    assert.equal(current().showMeasurementTool, true, 'a record without the field shows the ruler');
    PreferencesManager.set({ ...current(), showMeasurementTool: false });
    PreferencesManager.set({ ...current(), showMeasurementTool: true });
    assert.deepEqual(routes, ['viewport-controls-preference', 'viewport-controls-preference'],
      'toggling the ruler is visibility-only: no Editor render is requested');
    PreferencesManager.set({ ...current(), showMeasurementTool: false, labelFontSize: 20 });
    assert.equal(routes.at(-1), null, 'saved together with another preference it uses the normal route');
    assert.equal(current().showMeasurementTool, false);
    assert.equal(current().labelFontSize, 20);
  } finally { unsubscribe(); }
});

test('G2 add, rename, move and delete are measurement-only edits: lastEdited moves, cargo Undo does not', () => {
  seed();
  const notifications = [];
  const unsubscribe = StateStore.subscribe((_changes, _state, notification) => {
    if (notification) notifications.push(notification.type);
  });
  try {
    const before = stored('A');
    const added = PackLibrary.addMeasurement('A', pair());
    assert.equal(added.ok, true);
    assert.equal(notifications.at(-1), 'pack-measurements', 'derived notification: the app refreshes only the overlay and list');
    assert.ok(stored('A').lastEdited > before.lastEdited, 'creating a measurement updates lastEdited');
    assert.equal(StateStore.undo(), false, 'and adds no cargo Undo step');
    assert.equal(stored('B').measurements, undefined, 'another Load Plan is untouched');

    const id = added.measurement.id;
    const renamed = PackLibrary.renameMeasurement('A', id, '  Door   gap ');
    assert.equal(renamed.ok, true);
    assert.equal(PackLibrary.getMeasurements('A')[0].label, 'Door gap');
    const same = PackLibrary.renameMeasurement('A', id, 'Door gap');
    assert.equal(same.unchanged, true, 'an unchanged name writes nothing');
    assert.equal(PackLibrary.renameMeasurement('A', 'nope', 'x').reason, 'not-found');

    const edited = stored('A').lastEdited;
    const cargoAnchor = M.buildCargoAnchor({ instanceId: 'inst-x', local: { x: 1, y: 2, z: 3 }, caseData: CASE });
    const moved = PackLibrary.moveMeasurementEndpoint('A', id, 'end', cargoAnchor);
    assert.equal(moved.ok, true);
    const record = PackLibrary.getMeasurements('A')[0];
    assert.equal(record.end.kind, 'cargo', 'the anchor kind may change when an endpoint is dragged onto another surface');
    assert.deepEqual(record.start, added.measurement.start, 'the other endpoint is untouched');
    assert.equal(record.label, 'Door gap');
    assert.equal(record.createdAt, added.measurement.createdAt);
    assert.ok(stored('A').lastEdited >= edited);
    assert.equal(notifications.at(-1), 'pack-measurements');
    assert.equal(StateStore.undo(), false, 'moving an endpoint adds no cargo Undo step either');
    assert.equal(PackLibrary.moveMeasurementEndpoint('A', id, 'end', { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } }).reason, 'invalid');
    assert.equal(PackLibrary.moveMeasurementEndpoint('A', 'nope', 'end', cargoAnchor).reason, 'not-found');
    assert.equal(PackLibrary.moveMeasurementEndpoint('missing', id, 'end', cargoAnchor).reason, 'pack-not-found');
    assert.equal(PackLibrary.getMeasurements('A')[0].end.kind, 'cargo', 'a refused move changes nothing');

    assert.equal(PackLibrary.deleteMeasurement('A', 'nope').reason, 'not-found');
    assert.equal(PackLibrary.deleteMeasurement('A', id).ok, true);
    assert.equal(PackLibrary.getMeasurements('A').length, 0);
  } finally { unsubscribe(); }
});

test('the per-plan maximum of 100 is enforced on creation and a malformed record is refused', () => {
  seed();
  for (let i = 0; i < 100; i++) assert.equal(PackLibrary.addMeasurement('A', pair(i + 1)).ok, true);
  assert.equal(PackLibrary.getMeasurements('A').length, 100);
  const over = PackLibrary.addMeasurement('A', pair(101));
  assert.deepEqual([over.ok, over.reason], [false, 'limit']);
  assert.equal(PackLibrary.getMeasurements('A').length, 100, 'nothing is truncated or replaced');
  assert.equal(PackLibrary.addMeasurement('B', { start: null, end: ground(1, 1) }).reason, 'invalid');
  assert.equal(PackLibrary.addMeasurement('missing', pair()).reason, 'pack-not-found');
});

test('G2 cargo Undo/Redo keeps measurements and never rolls lastEdited back past a measurement edit', () => {
  seed();
  PackLibrary.addMeasurement('A', pair());
  StateStore.set({ packLibrary: StateStore.get('packLibrary').map(p => (p.id === 'A' ? { ...p, notes: 'cargo edit' } : p)) });
  const second = PackLibrary.addMeasurement('A', pair(2));
  assert.equal(second.ok, true);
  const editedAt = stored('A').lastEdited;
  assert.equal(PackLibrary.getMeasurements('A').length, 2);
  assert.equal(StateStore.undo(), true, 'the cargo edit is undone');
  assert.equal(stored('A').notes, undefined);
  assert.equal(PackLibrary.getMeasurements('A').length, 2, 'Undo neither erases nor resurrects measurements');
  assert.ok(stored('A').lastEdited >= editedAt, 'Undo must not move lastEdited back past the measurement edit');
  assert.equal(StateStore.redo(), true);
  assert.equal(stored('A').notes, 'cargo edit');
  assert.equal(PackLibrary.getMeasurements('A').length, 2);
  assert.ok(stored('A').lastEdited >= editedAt);
});

test('deleting cargo leaves its measurement stored as Unresolved and undoing the delete resolves it again', () => {
  seed();
  const inst = PackLibrary.addInstance('A', CASE.id, { x: 60, y: 16, z: 0 });
  assert.ok(inst && inst.id, 'a real instance is placed');
  const anchor = M.buildCargoAnchor({ instanceId: inst.id, local: { x: 0, y: 16, z: 0 }, caseData: CASE });
  PackLibrary.addMeasurement('A', { start: anchor, end: ground(100, 0) });
  assert.equal(PackLibrary.resolveMeasurements('A')[0].status, 'valid');
  PackLibrary.removeInstances('A', [inst.id]);
  assert.equal(PackLibrary.getMeasurements('A').length, 1, 'editing cargo never deletes a measurement');
  const gone = PackLibrary.resolveMeasurements('A')[0];
  assert.deepEqual([gone.status, gone.reason, gone.distance], ['unresolved', 'cargo-missing', null]);
  assert.equal(StateStore.undo(), true);
  assert.equal(PackLibrary.getById('A').cases.some(c => c.id === inst.id), true, 'Undo restores the same instance ID');
  assert.equal(PackLibrary.resolveMeasurements('A')[0].status, 'valid', 'the anchor resolves again; nothing was relocated');
});

test('G3 duplicating a Load Plan re-targets cargo anchors to the copy and leaves the original alone', () => {
  seed();
  const inst = PackLibrary.addInstance('A', CASE.id, { x: 60, y: 16, z: 0 });
  const cargo = M.buildCargoAnchor({ instanceId: inst.id, local: { x: 3, y: 16, z: 1 }, caseData: CASE });
  const floor = M.buildFloorAnchor({ surface: 'main', point: { x: 120, y: 0, z: 0 } });
  PackLibrary.addMeasurement('A', { start: cargo, end: floor });
  PackLibrary.addMeasurement('A', pair(3));
  const original = JSON.stringify(PackLibrary.getMeasurements('A'));
  const copy = PackLibrary.duplicate('A');
  const copyIds = new Set(copy.cases.map(c => c.id));
  assert.equal(copyIds.has(inst.id), false, 'the copy has its own instance IDs');
  const [first, second] = PackLibrary.getMeasurements(copy.id);
  assert.equal(copyIds.has(first.start.instanceId), true, 'the cargo anchor follows its cargo into the copy');
  assert.deepEqual(first.start.local, cargo.local);
  assert.deepEqual(first.end, floor, 'floor anchors are carried unchanged');
  assert.deepEqual(second.start, pair(3).start, 'ground anchors are carried unchanged');
  assert.deepEqual(PackLibrary.resolveMeasurements(copy.id).map(r => r.status), ['valid', 'valid']);
  assert.equal(JSON.stringify(PackLibrary.getMeasurements('A')), original, 'the original plan keeps its anchors');
});

const importPayload = (measurements, cases = []) => ({
  pack: { id: 'incoming', title: 'Incoming', loadPlanNumber: 'LP-IMPORT', truck: { length: 240, width: 96, height: 100 }, cases, measurements },
  bundledCases: [],
});
const importedInstance = id => ({
  id, caseId: CASE.id, placement: 'packed',
  transform: { position: { x: 60, y: 16, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
});

test('G3 importing a Load Plan remaps cargo anchors through the regenerated instance IDs', () => {
  seed([makePack('A')]);
  const anchor = M.buildCargoAnchor({ instanceId: 'old-1', local: { x: 1, y: 16, z: 2 }, caseData: CASE });
  const ghost = M.buildCargoAnchor({ instanceId: 'never-existed', local: { x: 0, y: 0, z: 0 }, caseData: CASE });
  const list = [
    M.createMeasurementRecord({ id: 'm1', start: anchor, end: ground(90, 0), now: 1 }),
    M.createMeasurementRecord({ id: 'm2', start: ghost, end: ground(95, 0), now: 1 }),
  ];
  const plan = PackLibrary.planPackImport(importPayload(list, [importedInstance('old-1')]));
  const newId = plan.pack.cases[0].id;
  assert.notEqual(newId, 'old-1', 'imports regenerate instance IDs');
  assert.equal(plan.pack.measurements[0].start.instanceId, newId, 'the anchor is re-targeted through the same old-to-new map');
  assert.deepEqual(plan.pack.measurements[0].start.local, anchor.local);
  assert.equal(plan.pack.measurements[1].start.instanceId, 'never-existed',
    'a structurally valid reference to missing cargo is retained, never guessed (it resolves as Unresolved)');
});

test('G4 a malformed, duplicated or over-limit measurement list rejects the whole Load Plan import', () => {
  seed([makePack('A')]);
  const valid = M.createMeasurementRecord({ id: 'ok', ...pair(), now: 1 });
  assert.doesNotThrow(() => PackLibrary.planPackImport(importPayload([valid])));
  const blocked = /Pack import blocked: the measurements are not valid/;
  assert.throws(() => PackLibrary.planPackImport(importPayload([{ ...valid, end: { kind: 'cargo' } }])), blocked);
  assert.throws(() => PackLibrary.planPackImport(importPayload([valid, valid])), /duplicate/);
  assert.throws(() => PackLibrary.planPackImport(importPayload('not a list')), blocked);
  const many = Array.from({ length: 101 }, (_, i) => M.createMeasurementRecord({ id: `m${i}`, ...pair(i + 1), now: 1 }));
  assert.throws(() => PackLibrary.planPackImport(importPayload(many)), /too many/);
  assert.equal(PackLibrary.planPackImport(importPayload(many.slice(0, 100))).pack.measurements.length, 100, 'exactly 100 is fine; nothing is truncated');
});

test('G4 export and backup project measurements explicitly and restore validation is strict', () => {
  const list = [
    M.createMeasurementRecord({ id: 'a', ...pair(), now: 1, label: 'Kept' }),
    M.createMeasurementRecord({ id: 'b', start: M.buildCargoAnchor({ instanceId: 'gone', local: { x: 1, y: 2, z: 3 }, caseData: CASE }), end: ground(5, 5), now: 1 }),
  ];
  const withList = makePack('A', { measurements: list });
  for (const project of [projectPortablePack, projectPortableWorkspacePack]) {
    assert.deepEqual(project(withList).measurements, M.normalizeMeasurements(list), `${project.name} carries measurements`);
    assert.equal(Object.hasOwn(project(makePack('A')), 'measurements'), false, 'a plan without any exports no empty field');
    const recovery = project(makePack('A', { measurements: [{ id: 'x' }] })).measurements;
    assert.equal(recovery[0].type, M.MEASUREMENT_TYPE_UNREADABLE, 'an unreadable record is exported, not dropped');
  }
  const graph = packs => ({ caseLibrary: [], packLibrary: packs, folderLibrary: [] });
  assert.doesNotThrow(() => validateWorkspaceGraph(graph([withList])), 'a dangling cargo reference is accepted (Unresolved)');
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { measurements: [{ ...list[0], start: { kind: 'x' } }] })])), /measurements/);
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { measurements: [list[0], list[0]] })])), /duplicate/);
  const many = Array.from({ length: 101 }, (_, i) => M.createMeasurementRecord({ id: `m${i}`, ...pair(i + 1), now: 1 }));
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { measurements: many })])), /too many/);
  assert.throws(() => validateWorkspaceGraph(graph([makePack('A', { measurements: 'nope' })])), /measurements/);
});
