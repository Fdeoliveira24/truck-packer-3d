/**
 * @file measurement-tool-core.spec.mjs
 * @description Pins the pure Measurement Tool V1 data model (src/core/measurements.js): schema,
 *   lenient never-destructive normalization versus strict validation, anchor construction, scene
 *   parity of the cargo-local resolver, derived validity, endpoint replacement, instance-ID
 *   remapping and display formatting. Contract: docs/product/TP3D-MASTER-TODO-V6.md Section 4.1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as M from '../../src/core/measurements.js';

const caseData = (overrides = {}) => ({
  id: 'case-1', name: 'Crate', shape: 'box',
  dimensions: { length: 48, width: 24, height: 32 },
  ...overrides,
});
const instance = (overrides = {}) => ({
  id: 'inst-1', caseId: 'case-1', placement: 'packed',
  transform: {
    position: { x: 60, y: 100, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
  ...overrides,
});
const ground = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
const record = (id, start, end, extra = {}) => M.createMeasurementRecord({ id, start, end, now: 1000, ...extra });
const FLOORS = M.buildFloorSurfaces({ shapeMode: 'wheelWells' }, [
  { min: { x: 0, y: 0, z: -50 }, max: { x: 600, y: 90, z: 50 } },
  { min: { x: 100, y: 12, z: -50 }, max: { x: 200, y: 90, z: -30 } },
]);

test('the per-plan maximum is 100 and a new record carries the current schema', () => {
  assert.equal(M.MAX_MEASUREMENTS_PER_PACK, 100);
  const created = record('m1', ground(0, 0), ground(10, 0), { label: '  Door   to  wall ' });
  assert.deepEqual(Object.keys(created).sort(),
    ['createdAt', 'end', 'id', 'label', 'schemaVersion', 'start', 'type', 'updatedAt']);
  assert.equal(created.type, 'point-to-point');
  assert.equal(created.schemaVersion, M.MEASUREMENT_SCHEMA_VERSION);
  assert.equal(created.label, 'Door to wall', 'labels are trimmed and whitespace collapsed');
  assert.equal(M.normalizeMeasurementLabel('x'.repeat(200)).length, M.MAX_MEASUREMENT_LABEL_LENGTH);
  assert.equal(M.normalizeMeasurementLabel('   '), null);
  assert.equal(M.normalizeMeasurementLabel(null), null);
});

test('G1 normalization is lenient and never destructive: malformed data is wrapped verbatim, never dropped', () => {
  assert.deepEqual(M.normalizeMeasurements(undefined), [], 'older Load Plans normalize to an empty list');
  assert.deepEqual(M.normalizeMeasurements(null), []);
  const good = record('good', ground(0, 0), ground(10, 0));
  const badAnchor = { ...record('bad-anchor', ground(0, 0), ground(1, 0)), end: { kind: 'mystery' } };
  const newer = { ...record('future', ground(0, 0), ground(1, 0)), schemaVersion: 99 };
  const out = M.normalizeMeasurements([good, badAnchor, 'garbage', newer, good]);
  assert.equal(out.length, 5, 'every stored entry survives');
  assert.equal(out[0].type, 'point-to-point');
  assert.equal(out[1].type, M.MEASUREMENT_TYPE_UNREADABLE);
  assert.deepEqual(out[1].original, badAnchor, 'the original malformed data is preserved verbatim');
  assert.equal(out[2].type, M.MEASUREMENT_TYPE_UNREADABLE);
  assert.equal(out[2].original, 'garbage');
  assert.match(out[3].reason, /newer version/i, 'a newer schema version is kept, not interpreted');
  assert.equal(out[3].original.schemaVersion, 99);
  assert.match(out[4].reason, /duplicate/i, 'a duplicate ID is wrapped, not silently merged');
  assert.equal(new Set(out.map(r => r.id)).size, out.length, 'recovery records get unique IDs');
  const container = M.normalizeMeasurements({ not: 'a list' });
  assert.equal(container.length, 1);
  assert.equal(container[0].type, M.MEASUREMENT_TYPE_UNREADABLE, 'a non-list container is preserved too');
  assert.deepEqual(M.normalizeMeasurements(out), out, 'normalizing an already normalized list is a no-op');
  assert.deepEqual(M.normalizeMeasurements(out).map(r => r.original), out.map(r => r.original));
});

test('G4 strict validation rejects malformed structure, duplicate IDs and more than 100, but accepts dangling cargo', () => {
  const dangling = M.buildCargoAnchor({ instanceId: 'gone', local: { x: 1, y: 2, z: 3 }, caseData: caseData() });
  const valid = [record('a', ground(0, 0), ground(5, 0)), record('b', dangling, ground(9, 9))];
  const checked = M.validateMeasurementCollection(valid);
  assert.equal(checked.ok, true, 'a reference to a missing instance is structurally valid (it resolves as Unresolved)');
  assert.equal(checked.measurements.length, 2);
  assert.equal(M.validateMeasurementCollection(undefined).ok, true);
  assert.equal(M.validateMeasurementCollection('nope').ok, false);
  const bad = M.validateMeasurementCollection([{ ...valid[0], start: { kind: 'cargo' } }]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /measurements\[0\]|start/);
  const dup = M.validateMeasurementCollection([valid[0], { ...valid[1], id: 'a' }]);
  assert.equal(dup.ok, false);
  assert.match(dup.error, /duplicate/);
  const many = Array.from({ length: 101 }, (_, i) => record(`m${i}`, ground(0, 0), ground(i + 1, 0)));
  assert.equal(M.validateMeasurementCollection(many.slice(0, 100)).ok, true);
  const tooMany = M.validateMeasurementCollection(many);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /too many/);
  assert.equal(M.canAddMeasurement(many.slice(0, 99)), true);
  assert.equal(M.canAddMeasurement(many.slice(0, 100)), false);
  const recovery = M.normalizeMeasurements([{ id: 'x', type: 'point-to-point', start: 1 }]);
  assert.equal(M.validateMeasurementCollection(recovery).ok, true, 'an explicit recovery record round-trips through strict validation');
});

test('anchors: any cargo shape, supported surfaces only, truck-bound surfaces remember the truck', () => {
  const cargo = M.buildCargoAnchor({ instanceId: 'i', local: { x: 1.23456789, y: 0, z: -2 }, caseData: caseData() });
  assert.equal(cargo.kind, 'cargo');
  assert.deepEqual(cargo.local, { x: 1.2346, y: 0, z: -2 }, 'the local point is rounded, not a world coordinate');
  assert.deepEqual(cargo.signature, { shape: 'box', length: 48, width: 24, height: 32 });
  const drum = M.buildCargoAnchor({ instanceId: 'd', local: { x: 0, y: 12, z: 0 }, caseData: caseData({ shape: 'cylinder' }) });
  assert.equal(drum.signature.shape, 'cylinder', 'cylinders and drums anchor on their real surface point');
  assert.equal(M.buildCargoAnchor({ instanceId: 'i', local: { x: 0, y: 0, z: 0 }, caseData: { dimensions: null } }), null,
    'a Case without usable geometry cannot be anchored');
  assert.equal(M.buildCargoAnchor({ instanceId: 'i', local: { x: NaN, y: 0, z: 0 }, caseData: caseData() }), null);
  assert.equal(M.buildFloorAnchor({ surface: 'roof', point: { x: 0, y: 0, z: 0 } }), null);
  assert.equal(M.buildSpaceAnchor({ surface: 'sky', point: { x: 0, y: 0, z: 0 } }), null, 'sky is not a supported surface');
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const wall = M.buildSpaceAnchor({ surface: 'wall-left', point: { x: 5, y: 5, z: 51 }, truck });
  assert.deepEqual(wall.truck, M.getTruckSignature(truck));
  assert.equal(Object.hasOwn(ground(1, 1), 'truck'), false, 'ground points are independent of the truck');
  for (const surface of ['wall-left', 'wall-right', 'wall-front', 'wall-rear', 'ceiling']) {
    assert.ok(M.SPACE_SURFACES.includes(surface));
  }
});

test('the cargo-local resolver matches THREE for every right-angle rotation and ignores scale', () => {
  const steps = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const local = { x: 11, y: -7, z: 5 };
  const data = caseData();
  let checked = 0;
  for (const rx of steps) for (const ry of steps) for (const rz of steps) {
    const inst = instance({ transform: { position: { x: 70, y: 100, z: -12 }, rotation: { x: rx, y: ry, z: rz }, scale: { x: 3, y: 3, z: 3 } } });
    const pose = M.resolveCargoPose(inst, data);
    const object = new THREE.Object3D();
    object.position.set(70, 100, -12);
    object.rotation.set(rx, ry, rz); // THREE's default order is XYZ, the order the scene applies
    object.updateMatrixWorld(true);
    const expected = object.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
    const actual = M.cargoLocalToWorld(pose, local);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9 && Math.abs(actual.y - expected.y) < 1e-9 && Math.abs(actual.z - expected.z) < 1e-9,
      `rotation (${rx}, ${ry}, ${rz})`);
    checked += 1;
  }
  assert.equal(checked, 64);
  const low = M.resolveCargoPose(instance({ transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }), data);
  assert.equal(low.center.y, 16, 'the centre is floored at half the oriented height, like the scene');
});

test('validity is derived: only Valid carries a distance; changes flag Needs Review, never relocate', () => {
  const data = caseData();
  const anchor = M.buildCargoAnchor({ instanceId: 'inst-1', local: { x: 0, y: 16, z: 0 }, caseData: data });
  const wallTruck = { length: 600, width: 100, height: 90, shapeMode: 'wheelWells' };
  const wall = M.buildSpaceAnchor({ surface: 'wall-front', point: { x: 600, y: 40, z: 0 }, truck: wallTruck });
  const floor = M.buildFloorAnchor({ surface: 'main', point: { x: 300, y: 0, z: 0 } });
  const list = [
    record('cargo-wall', anchor, wall),
    record('cargo-floor', anchor, floor),
    record('ground', ground(0, 60), ground(30, 100)),
  ];
  const context = overrides => ({
    getInstance: id => (id === 'inst-1' ? instance() : null),
    getCase: id => (id === 'case-1' ? data : null),
    floors: FLOORS, truck: wallTruck, ...overrides,
  });
  const resolved = M.resolveMeasurementList(list, context());
  assert.deepEqual(resolved.map(r => r.status), ['valid', 'valid', 'valid']);
  const flat = M.resolveMeasurementList([record('flat', ground(0, 0), ground(30, 40))], context())[0];
  assert.equal(flat.distance, 50, 'straight-line 3D distance in canonical inches');
  assert.deepEqual(flat.delta, { x: 30, y: 0, z: 40 });
  const climb = M.resolveMeasurementList([record('climb', ground(0, 0), M.buildSpaceAnchor({ surface: 'free', point: { x: 0, y: 12, z: 5 } }))], context())[0];
  assert.equal(climb.distance, 13, 'the vertical component counts: 3D, not plan distance');

  const missingCargo = M.resolveMeasurementList(list, context({ getInstance: () => null }));
  assert.equal(missingCargo[0].status, M.MEASUREMENT_STATUS.UNRESOLVED);
  assert.equal(missingCargo[0].reason, 'cargo-missing');
  assert.equal(missingCargo[0].distance, null, 'Unresolved never carries a number');
  assert.equal(missingCargo[2].status, 'valid', 'a ground-only measurement is unaffected by cargo changes');
  const noCase = M.resolveMeasurementList(list, context({ getCase: () => null }));
  assert.equal(noCase[0].reason, 'case-missing');
  for (const changed of [caseData({ dimensions: { length: 49, width: 24, height: 32 } }), caseData({ shape: 'cylinder' })]) {
    const review = M.resolveMeasurementList(list, context({ getCase: () => changed }));
    assert.equal(review[0].status, M.MEASUREMENT_STATUS.NEEDS_REVIEW);
    assert.equal(review[0].reason, 'case-changed');
    assert.equal(review[0].distance, null, 'Needs Review never carries a number');
  }
  for (const truck of [{ ...wallTruck, length: 601 }, { ...wallTruck, width: 101 }, { ...wallTruck, height: 91 }, { ...wallTruck, shapeMode: 'rect' }]) {
    const review = M.resolveMeasurementList(list, context({ truck }));
    assert.equal(review[0].reason, 'truck-changed', JSON.stringify(truck));
    assert.equal(review[1].status, 'valid', 'a floor point is revalidated by geometry, not by truck dimensions');
    assert.equal(review[2].status, 'valid', 'ground points never move');
  }
  const moved = M.resolveMeasurementList(list, context({ floors: [{ ...FLOORS[0], surface: 'deck' }] }));
  assert.equal(moved[1].reason, 'floor-changed', 'the same spot on a different surface is flagged, never re-targeted');
  const gone = M.resolveMeasurementList(list, context({ floors: [] }));
  assert.equal(gone[1].reason, 'floor-missing');
  const wellTop = M.resolveFloorAnchor(M.buildFloorAnchor({ surface: 'well-top', point: { x: 150, y: 12, z: -40 } }), { floors: FLOORS });
  assert.equal(wellTop.status, 'valid', 'a Wheel Well top is a supported floor');
  const recovery = M.resolveMeasurementList(M.normalizeMeasurements([{ id: 'x' }]), context())[0];
  assert.equal(recovery.reason, 'unreadable');
  assert.equal(recovery.distance, null);
});

test('floor surfaces and the truck shell come from the usable zones', () => {
  assert.deepEqual(FLOORS.map(f => f.surface), ['main', 'well-top']);
  assert.equal(M.buildFloorSurfaces({ shapeMode: 'frontBonus' }, [
    { min: { x: 0, y: 0, z: -50 }, max: { x: 400, y: 90, z: 50 } },
    { min: { x: 400, y: 30, z: -50 }, max: { x: 500, y: 90, z: 50 } },
  ])[1].surface, 'deck');
  assert.deepEqual(M.buildTruckShell({}, [
    { min: { x: 0, y: 0, z: -50 }, max: { x: 600, y: 90, z: 50 } },
    { min: { x: 600, y: 30, z: -50 }, max: { x: 700, y: 100, z: 50 } },
  ]), { xMin: 0, xMax: 700, yMin: 0, yMax: 100, zMin: -50, zMax: 50 });
  assert.equal(M.buildTruckShell({}, []), null);
});

test('replaceMeasurementEndpoint moves one endpoint, may change the anchor kind and never mutates or fabricates', () => {
  const data = caseData();
  const original = Object.freeze(record('m1', ground(0, 60), ground(30, 100), { label: 'Door gap' }));
  const cargo = M.buildCargoAnchor({ instanceId: 'inst-1', local: { x: 4, y: 16, z: 1 }, caseData: data });
  const moved = M.replaceMeasurementEndpoint(original, 'start', cargo, 2000);
  assert.equal(moved.start.kind, 'cargo', 'a deliberate drag may change the anchor kind');
  assert.deepEqual(moved.end, original.end, 'the other endpoint is untouched');
  assert.equal(moved.id, 'm1');
  assert.equal(moved.label, 'Door gap');
  assert.equal(moved.createdAt, 1000);
  assert.equal(moved.updatedAt, 2000);
  assert.equal(original.start.kind, 'space', 'the stored record is never mutated');
  assert.equal(M.validateMeasurementCollection([moved]).ok, true, 'the result is a valid stored record');
  const other = M.replaceMeasurementEndpoint(original, 'end', M.buildFloorAnchor({ surface: 'main', point: { x: 5, y: 0, z: 5 } }), 3000);
  assert.equal(other.end.kind, 'floor');
  assert.deepEqual(other.start, original.start);
  assert.equal(M.replaceMeasurementEndpoint(original, 'middle', cargo, 2000), null);
  assert.equal(M.replaceMeasurementEndpoint(original, 'start', { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } }, 2000), null,
    'an invalid anchor writes nothing');
  assert.equal(M.replaceMeasurementEndpoint(original, 'start', null, 2000), null);
  assert.equal(M.replaceMeasurementEndpoint(original, 'start', cargo, NaN), null);
  const unreadable = M.normalizeMeasurements([{ id: 'x' }])[0];
  assert.equal(M.replaceMeasurementEndpoint(unreadable, 'start', cargo, 2000), null, 'recovery records are never edited');
});

test('G3 remapping re-targets only mapped cargo anchors and never guesses', () => {
  const data = caseData();
  const a = M.buildCargoAnchor({ instanceId: 'old-1', local: { x: 1, y: 2, z: 3 }, caseData: data });
  const b = M.buildCargoAnchor({ instanceId: 'unmapped', local: { x: 0, y: 0, z: 0 }, caseData: data });
  const floor = M.buildFloorAnchor({ surface: 'main', point: { x: 5, y: 0, z: 5 } });
  const list = [record('m1', a, floor), record('m2', b, ground(1, 1))];
  const recovery = M.normalizeMeasurements([...list, { id: 'broken' }]);
  const remapped = M.remapMeasurementInstanceIds(recovery, new Map([['old-1', 'new-1']]));
  assert.equal(remapped[0].start.instanceId, 'new-1');
  assert.deepEqual(remapped[0].start.local, a.local, 'the local point is carried over unchanged');
  assert.deepEqual(remapped[0].end, floor);
  assert.equal(remapped[1].start.instanceId, 'unmapped', 'an unmapped anchor stays as it is (Unresolved), never replaced');
  assert.equal(remapped[2].type, M.MEASUREMENT_TYPE_UNREADABLE);
  assert.equal(recovery[0].start.instanceId, 'old-1', 'the input is not mutated');
  assert.equal(M.remapMeasurementInstanceIds(recovery, { 'old-1': 'new-2' })[0].start.instanceId, 'new-2', 'a plain object map works too');
});

test('lengths use the measurement-specific precision and the user length unit', () => {
  assert.equal(M.formatMeasurementLength(12.345, 'in'), '12.3 in');
  assert.equal(M.formatMeasurementLength(12, 'ft'), '1.00 ft');
  assert.equal(M.formatMeasurementLength(100, 'cm'), '254.0 cm');
  assert.equal(M.formatMeasurementLength(100, 'm'), '2.540 m');
  assert.equal(M.formatMeasurementLength(10, 'furlong'), '10.0 in', 'an unknown unit falls back to inches');
  assert.equal(M.formatMeasurementLength(NaN, 'in'), '—');
  assert.equal(M.measurementStatusLabel('valid'), 'Valid');
  assert.equal(M.measurementStatusLabel('needs-review'), 'Needs review');
  assert.equal(M.measurementStatusLabel('unresolved'), 'Unresolved');
  for (const reason of ['cargo-missing', 'case-missing', 'case-changed', 'pose-invalid', 'floor-missing', 'floor-changed', 'truck-changed', 'unreadable']) {
    assert.ok(M.describeMeasurementReason(reason).length > 10, reason);
  }
  assert.equal(M.describeMeasurementReason('nope'), '');
  assert.equal(M.defaultMeasurementName(0), 'Measurement 1');
});
