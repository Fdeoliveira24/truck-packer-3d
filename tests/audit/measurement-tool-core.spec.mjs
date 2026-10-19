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
import { createCaseGeometry } from '../../src/editor/geometry-factory.js';

// geometry-factory.js reads the THREE global like the browser app does.
globalThis.THREE ??= THREE;

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

// Usable-zone fixtures (the shapes `getTrailerUsableZones` returns, as { min, max } boxes).
const zoneBox = (x0, y0, z0, x1, y1, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
// Front Overhang: the main box plus the raised over-cab deck. Length, width, height and shape mode
// stay identical while `bonus` (a shapeConfig value) moves the front wall and `deck` the deck height.
// As in the zone calculation, an overhang of length 0 contributes no zone at all.
const overhangZones = (bonus, deck = 30) => [zoneBox(0, 0, -50, 600, 90, 50), ...(bonus > 0 ? [zoneBox(600, deck, -50, 600 + bonus, 90, 50)] : [])];
const wellZones = wellHeight => [
  zoneBox(0, 0, -50, 100, 90, 50), zoneBox(100, 0, -30, 200, 90, 30),
  zoneBox(100, wellHeight, -50, 200, 90, -30), zoneBox(100, wellHeight, 30, 200, 90, 50), zoneBox(200, 0, -50, 600, 90, 50),
];
const rectZones = (length = 600, width = 100, height = 90) => [zoneBox(0, 0, -width / 2, length, height, width / 2)];
const RECT_TRUCK = { length: 600, width: 100, height: 90, shapeMode: 'rect' };
const OVERHANG_TRUCK = { length: 600, width: 100, height: 90, shapeMode: 'frontBonus', shapeConfig: { bonusLength: 100, bonusHeight: 30 } };
const WELLS_TRUCK = { length: 600, width: 100, height: 90, shapeMode: 'wheelWells' };
// The record shape written before the effective zones were remembered: the same anchor without them.
const withoutZones = anchor => { const legacy = JSON.parse(JSON.stringify(anchor)); delete legacy.truck.zones; return legacy; };

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
  const dangling = M.buildCargoAnchor({ instanceId: 'gone', local: { x: 24, y: 2, z: 3 }, caseData: caseData() });
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
  const zones = M.rectangularTruckZones(truck);
  const wall = M.buildSpaceAnchor({ surface: 'wall-left', point: { x: 5, y: 5, z: 51 }, truck, zones });
  assert.deepEqual(wall.truck, M.getTruckSignature(truck, zones));
  assert.deepEqual(wall.truck.zones, [[0, 0, -51, 636, 98, 51]], 'a new truck point always remembers the effective zones');
  assert.equal(M.buildSpaceAnchor({ surface: 'wall-left', point: { x: 5, y: 5, z: 51 }, truck }), null,
    'without the effective geometry a truck point is not created: a later change could not be detected');
  assert.equal(M.buildSpaceAnchor({ surface: 'wall-left', point: { x: 5, y: 5, z: 40 }, truck, zones }), null, 'a point must lie on the wall it names');
  assert.equal(M.buildSpaceAnchor({ surface: 'ceiling', point: { x: 5, y: 97, z: 0 }, truck, zones }), null);
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
  const wallTruck = WELLS_TRUCK;
  const wall = M.buildSpaceAnchor({ surface: 'wall-front', point: { x: 600, y: 40, z: 0 }, truck: wallTruck, zones: wellZones(30) });
  const floor = M.buildFloorAnchor({ surface: 'main', point: { x: 300, y: 0, z: 0 } });
  const list = [
    record('cargo-wall', anchor, wall),
    record('cargo-floor', anchor, floor),
    record('ground', ground(0, 60), ground(30, 100)),
  ];
  const context = overrides => ({
    getInstance: id => (id === 'inst-1' ? instance() : null),
    getCase: id => (id === 'case-1' ? data : null),
    floors: FLOORS, truck: wallTruck, zones: wellZones(30), ...overrides,
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
  // Any change to the effective geometry (size, shape, Wheel Well) flags the wall point.
  for (const [what, zones] of [['longer', rectZones(601)], ['wider', rectZones(600, 101)], ['taller', rectZones(600, 100, 91)],
    ['no wells', rectZones()], ['shorter wells', wellZones(20)]]) {
    const review = M.resolveMeasurementList(list, context({ zones }));
    assert.equal(review[0].reason, 'truck-changed', what);
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

test('floor surfaces come from the usable zones; the shell faces are covered by the physical-surface tests below', () => {
  assert.deepEqual(FLOORS.map(f => f.surface), ['main', 'well-top']);
  assert.equal(M.buildFloorSurfaces({ shapeMode: 'frontBonus' }, [
    { min: { x: 0, y: 0, z: -50 }, max: { x: 400, y: 90, z: 50 } },
    { min: { x: 400, y: 30, z: -50 }, max: { x: 500, y: 90, z: 50 } },
  ])[1].surface, 'deck');
  assert.deepEqual(M.getTruckShellFaces(RECT_TRUCK, undefined), [], 'with no geometry there is no surface to pick');
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
  const a = M.buildCargoAnchor({ instanceId: 'old-1', local: { x: 24, y: 2, z: 3 }, caseData: data });
  const b = M.buildCargoAnchor({ instanceId: 'unmapped', local: { x: 0, y: 16, z: 0 }, caseData: data });
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
  for (const reason of ['cargo-missing', 'case-missing', 'case-changed', 'pose-invalid', 'floor-missing', 'floor-changed', 'truck-changed', 'truck-unverified', 'cargo-ambiguous', 'distance-invalid', 'unreadable']) {
    assert.ok(M.describeMeasurementReason(reason).length > 10, reason);
  }
  assert.equal(M.describeMeasurementReason('nope'), '');
  assert.equal(M.defaultMeasurementName(0), 'Measurement 1');
});

// ============================================================================
// Audit remediation: truck configuration, cargo surfaces and arithmetic limits
// ============================================================================

test('P1-2 a truck wall remembers the effective truck geometry: a configuration change inside one shape mode is flagged', () => {
  const placedOn = overhangZones(100);
  const front = M.buildSpaceAnchor({ surface: 'wall-front', point: { x: 700, y: 60, z: 0 }, truck: OVERHANG_TRUCK, zones: placedOn });
  const left = M.buildSpaceAnchor({ surface: 'wall-left', point: { x: 650, y: 60, z: 50 }, truck: OVERHANG_TRUCK, zones: placedOn });
  assert.equal(front.truck.zones.length, 2, 'the signature carries the effective zones, not only L/W/H and the mode');
  const resolve = (anchor, zones, truck = OVERHANG_TRUCK) => M.resolveSpaceAnchor(anchor, { truck, zones });
  assert.equal(resolve(front, placedOn).status, 'valid', 'the same truck is Valid');

  // bonusLength 100 -> 150: length, width, height and shape mode are all unchanged.
  const longer = overhangZones(150);
  assert.deepEqual(M.getTruckSignature({ ...OVERHANG_TRUCK, shapeConfig: { bonusLength: 150, bonusHeight: 30 } }, longer).length, 600);
  for (const [name, anchor] of [['front wall', front], ['side wall', left]]) {
    const review = resolve(anchor, longer);
    assert.equal(review.status, M.MEASUREMENT_STATUS.NEEDS_REVIEW, `${name} must not stay Valid after the Front Overhang changed`);
    assert.equal(review.reason, 'truck-changed');
    assert.equal(review.point, null, 'a stale position is never offered');
  }
  const measured = M.resolveMeasurement(record('front-to-ground', front, ground(650, 0)), {
    getInstance: () => null, getCase: () => null, floors: [], truck: OVERHANG_TRUCK, zones: longer,
  });
  assert.deepEqual([measured.status, measured.distance], ['needs-review', null], 'no number is shown for an uncertain wall');

  // Same shape mode, same envelope, different Wheel Well geometry: also a different truck.
  const wells = M.buildSpaceAnchor({ surface: 'ceiling', point: { x: 300, y: 90, z: 0 }, truck: { length: 600, width: 100, height: 90, shapeMode: 'wheelWells' }, zones: wellZones(30) });
  assert.equal(resolve(wells, wellZones(30), { length: 600, width: 100, height: 90, shapeMode: 'wheelWells' }).status, 'valid');
  assert.equal(resolve(wells, wellZones(40), { length: 600, width: 100, height: 90, shapeMode: 'wheelWells' }).status, 'needs-review');
  // When the current geometry is not supplied, validity cannot be established: never Valid.
  assert.equal(M.resolveSpaceAnchor(front, { truck: OVERHANG_TRUCK }).status, 'needs-review');
  // Ground and free points never depend on the truck.
  assert.equal(M.resolveSpaceAnchor(ground(5, 5), { truck: OVERHANG_TRUCK, zones: longer }).status, 'valid');
});

test('P1-2 older anchors without stored zones are Valid only when the original geometry is provable', () => {
  const placedOn = overhangZones(100);
  // Records written before the effective zones were remembered: the same shape, without `truck.zones`.
  const legacyFront = withoutZones(M.buildSpaceAnchor({ surface: 'wall-front', point: { x: 700, y: 60, z: 0 }, truck: OVERHANG_TRUCK, zones: placedOn }));
  const legacyLeft = withoutZones(M.buildSpaceAnchor({ surface: 'wall-left', point: { x: 650, y: 60, z: 50 }, truck: OVERHANG_TRUCK, zones: placedOn }));
  assert.equal(Object.hasOwn(legacyFront.truck, 'zones'), false);
  const stored = record('old', legacyFront, ground(1, 1));
  const normalized = M.normalizeMeasurements([stored])[0];
  assert.equal(normalized.type, 'point-to-point', 'an older record is still readable');
  assert.equal(Object.hasOwn(normalized.start.truck, 'zones'), false, 'and is not rewritten with invented geometry');
  assert.deepEqual(normalized.start, legacyFront, 'the original anchor is retained exactly');
  assert.equal(M.validateMeasurementCollection([stored]).ok, true, 'and still imports');

  // A Front Overhang record never saved its configuration: unchanged outside dimensions prove nothing.
  const review = (anchor, truck, zones) => M.resolveSpaceAnchor(anchor, { truck, zones });
  for (const [what, zones] of [
    ['the very same geometry', placedOn], ['a longer overhang', overhangZones(150)],
    ['a different deck height that now swallows the point', overhangZones(100, 70)], ['a lower deck', overhangZones(100, 20)],
  ]) {
    const result = review(legacyFront, OVERHANG_TRUCK, zones);
    assert.equal(result.status, M.MEASUREMENT_STATUS.NEEDS_REVIEW, `a legacy Front Overhang wall point is not Valid: ${what}`);
    assert.equal(result.reason, 'truck-unverified');
    assert.equal(result.point, null, 'and offers no stale position');
  }
  assert.equal(review(legacyLeft, OVERHANG_TRUCK, placedOn).status, 'needs-review', 'the side wall of an unprovable truck is not provable either');
  assert.equal(review(legacyFront, OVERHANG_TRUCK, undefined).status, 'needs-review', 'unavailable current geometry never makes a record Valid');
  assert.match(M.describeMeasurementReason('truck-unverified'), /cannot be confirmed/);
  const wells = withoutZones(M.buildSpaceAnchor({ surface: 'ceiling', point: { x: 300, y: 90, z: 0 }, truck: WELLS_TRUCK, zones: wellZones(30) }));
  assert.equal(review(wells, WELLS_TRUCK, wellZones(30)).reason, 'truck-unverified', 'a legacy Wheel Well record is unprovable too');

  // A plain rectangular truck is fully described by its dimensions, so those records ARE provable.
  const rect = withoutZones(M.buildSpaceAnchor({ surface: 'ceiling', point: { x: 300, y: 90, z: 0 }, truck: RECT_TRUCK, zones: rectZones() }));
  assert.equal(review(rect, RECT_TRUCK, rectZones()).status, 'valid', 'rebuilt from its dimensions, the original geometry matches');
  assert.equal(review(rect, RECT_TRUCK, rectZones(600, 100, 80)).reason, 'truck-changed', 'a lower ceiling no longer holds the point');
  assert.equal(review(rect, RECT_TRUCK, rectZones(601)).reason, 'truck-changed');
  assert.equal(review(rect, RECT_TRUCK, overhangZones(100)).reason, 'truck-changed', 'a Front Overhang added to the truck is a change');
  assert.equal(review(rect, RECT_TRUCK, undefined).reason, 'truck-unverified', 'but not when the current zones are unavailable');
  assert.equal(review(rect, RECT_TRUCK, []).reason, 'truck-unverified');
  assert.equal(review(rect, RECT_TRUCK, overhangZones(0)).status, 'valid', 'an overhang of length 0 is the same physical truck');
  const malformed = { ...rect, truck: { ...rect.truck, length: 0 } };
  assert.equal(review(malformed, RECT_TRUCK, rectZones()).reason, 'truck-unverified', 'unusable stored dimensions prove nothing');
  assert.equal(M.validateMeasurementCollection([record('bad', { ...rect, position: { x: 300, y: 50, z: 0 } }, ground(1, 1))]).ok, false,
    'a provable record whose point is not on the surface it names is malformed');
});

test('P1-2 truck geometry is compared as effective zones: real changes are flagged, equivalent settings are not', () => {
  const make = (surface, point, truck, zones) => M.buildSpaceAnchor({ surface, point, truck, zones });
  const status = (anchor, zones) => M.resolveSpaceAnchor(anchor, { truck: {}, zones }).status;

  // Standard rectangular truck: every shell surface is Valid on the same truck and flagged when it changes.
  const surfaces = [['wall-front', { x: 600, y: 40, z: 0 }], ['wall-rear', { x: 0, y: 40, z: 0 }], ['wall-left', { x: 300, y: 40, z: 50 }],
    ['wall-right', { x: 300, y: 40, z: -50 }], ['ceiling', { x: 300, y: 90, z: 0 }]];
  for (const [surface, point] of surfaces) {
    const anchor = make(surface, point, RECT_TRUCK, rectZones());
    assert.equal(status(anchor, rectZones()), 'valid', `${surface}: same truck`);
    for (const [what, zones] of [['length', rectZones(601)], ['width', rectZones(600, 102)], ['height', rectZones(600, 100, 92)]]) {
      assert.equal(status(anchor, zones), 'needs-review', `${surface}: changed ${what}`);
    }
  }

  // Front Overhang: the length and the deck height both change the geometry; restoring them restores Valid.
  const front = make('wall-front', { x: 700, y: 60, z: 0 }, OVERHANG_TRUCK, overhangZones(100));
  assert.equal(status(front, overhangZones(100)), 'valid');
  assert.equal(status(front, overhangZones(150)), 'needs-review', 'changed bonus length');
  assert.equal(status(front, overhangZones(100, 70)), 'needs-review', 'changed deck height (the point is now in the cab void)');
  assert.equal(status(front, overhangZones(100, 50)), 'needs-review', 'any deck change is a real change, even where the point survives');
  assert.equal(status(front, overhangZones(100)), 'valid', 'restoring the original geometry makes it Valid again');

  // Wheel Wells: any change to a well's geometry is flagged.
  const ceiling = make('ceiling', { x: 300, y: 90, z: 0 }, WELLS_TRUCK, wellZones(30));
  assert.equal(status(ceiling, wellZones(30)), 'valid');
  assert.equal(status(ceiling, wellZones(40)), 'needs-review');
  assert.equal(status(ceiling, rectZones()), 'needs-review', 'removing the wells is a change');

  // Equivalent physical configurations are the same truck: the order of zones, the representation
  // ({ min, max } boxes or 6-number arrays) and settings that do not change the geometry are irrelevant.
  assert.equal(status(front, [...overhangZones(100)].reverse()), 'valid', 'zone order is irrelevant');
  assert.equal(status(front, overhangZones(100).map(z => [z.min.x, z.min.y, z.min.z, z.max.x, z.max.y, z.max.z])), 'valid', 'so is the representation');
  assert.equal(status(front, overhangZones(100).map(z => zoneBox(z.min.x + 1e-6, z.min.y, z.min.z, z.max.x, z.max.y, z.max.z))), 'valid', 'and float noise');
  const rectCeiling = make('ceiling', { x: 300, y: 90, z: 0 }, RECT_TRUCK, rectZones());
  assert.equal(status(rectCeiling, overhangZones(0)), 'valid', 'a Front Overhang of length 0 is a standard truck');

  // Missing or malformed current geometry is never Valid.
  for (const unusable of [undefined, null, [], 'x', [[1, 2, 3]], [zoneBox(0, 0, 0, NaN, 1, 1)]]) {
    assert.equal(status(front, unusable), 'needs-review', JSON.stringify(unusable));
  }
});

test('P1-2 the expanded signature is validated strictly on import and recovered non-destructively when stored', () => {
  const good = M.buildSpaceAnchor({ surface: 'wall-front', point: { x: 700, y: 60, z: 0 }, truck: OVERHANG_TRUCK, zones: overhangZones(100) });
  const withZones = zones => ({ ...good, truck: { ...good.truck, zones } });
  assert.equal(M.validateMeasurementCollection([record('ok', good, ground(1, 1))]).ok, true);
  assert.deepEqual(M.normalizeMeasurements([record('ok', good, ground(1, 1))])[0].start.truck.zones, good.truck.zones, 'canonical form keeps the zones');
  const malformed = [
    'not a list', [], [[1, 2, 3]], [[0, 0, 0, 1, 1, NaN]], [[5, 0, 0, 1, 1, 1]], [[0, 0, 0, 1e12, 1, 1]],
    Array.from({ length: 40 }, () => [0, 0, 0, 1, 1, 1]),
  ];
  for (const zones of malformed) {
    const bad = record('bad', withZones(zones), ground(1, 1));
    const strict = M.validateMeasurementCollection([bad]);
    assert.equal(strict.ok, false, `import rejects ${JSON.stringify(zones).slice(0, 40)}`);
    const stored = M.normalizeMeasurements([bad])[0];
    assert.equal(stored.type, M.MEASUREMENT_TYPE_UNREADABLE, 'stored data is wrapped, never dropped');
    assert.deepEqual(stored.original, JSON.parse(JSON.stringify(bad)), 'the original record is preserved verbatim');
  }
});

test('P2-3 a cargo-local point must lie on the saved physical surface (box, cylinder, drum)', () => {
  const box = M.getCargoGeometrySignature(caseData()); // 48 x 24 x 32: half extents x 24, y 16, z 12
  const on = (local, signature = box) => M.isLocalPointOnCargoSurface(local, signature);
  assert.equal(on({ x: 24, y: 3, z: -4 }), true, 'a face point');
  assert.equal(on({ x: -24, y: -16, z: 12 }), true, 'a corner');
  assert.equal(on({ x: 24.005, y: 0, z: 0 }), true, 'inside the documented rounding tolerance');
  assert.equal(on({ x: 24.5, y: 0, z: 0 }), false, 'half an inch off the face');
  assert.equal(on({ x: 1000, y: 0, z: 0 }), false, 'far outside the cargo');
  assert.equal(on({ x: 0, y: 0, z: 0 }), false, 'the cargo centre is not a surface point');
  assert.equal(on({ x: 20, y: 10, z: 5 }), false, 'a point inside the cargo is not a surface point');

  const cylinder = M.getCargoGeometrySignature(caseData({ shape: 'cylinder', dimensions: { length: 60, width: 20, height: 30 } }));
  assert.equal(on({ x: 0, y: 0, z: 10 }, cylinder), true, 'the side wall (radius = half of the smaller of width and height)');
  assert.equal(on({ x: 30, y: 3, z: 3 }, cylinder), true, 'an end cap');
  assert.equal(on({ x: 0, y: 0, z: 15 }, cylinder), false, 'the box corner outside the round body');
  assert.equal(on({ x: 0, y: 0, z: 0 }, cylinder), false);
  assert.equal(on({ x: 0, y: 0, z: 9 }, cylinder), false, 'a full inch inside the wall');
  assert.equal(on({ x: 0, y: 0, z: 9.915 }, cylinder), false, 'on the axis through a vertex of the 24-gon, 0.085 in inside the mesh');
  assert.equal(on({ x: 31, y: 0, z: 0 }, cylinder), false, 'beyond the end cap');
  assert.equal(on({ x: 0, y: 0, z: 10 }, { ...cylinder, shape: 'DRUM ' }), true, 'the shape name is read the way the signature builder normalizes it');

  // Strict import rejects, stored data is wrapped verbatim, and an endpoint move refuses it.
  const far = { ...M.buildCargoAnchor({ instanceId: 'i', local: { x: 1, y: 0, z: 0 }, caseData: caseData() }), local: { x: 1000, y: 0, z: 0 } };
  const farRecord = record('far', far, ground(1, 1));
  const strict = M.validateMeasurementCollection([farRecord]);
  assert.equal(strict.ok, false);
  assert.match(strict.error, /start/);
  assert.equal(M.normalizeMeasurements([farRecord])[0].type, M.MEASUREMENT_TYPE_UNREADABLE);
  assert.equal(M.replaceMeasurementEndpoint(record('m', ground(0, 0), ground(5, 5)), 'start', far, 2000), null);
  const resolved = M.resolveMeasurementList([farRecord], { getInstance: () => instance(), getCase: () => caseData(), floors: [], truck: {} })[0];
  assert.notEqual(resolved.status, 'valid', 'an off-surface point never yields a Valid distance');
  assert.equal(resolved.distance, null);
  // The earlier box face + (u, v) encoding is still read, and always lies on its face.
  const legacy = { kind: 'cargo', instanceId: 'i', face: '+x', u: 0.25, v: 0.75, signature: box };
  assert.equal(M.validateMeasurementCollection([record('legacy', legacy, ground(1, 1))]).ok, true);
  const legacyOnCylinder = { ...legacy, signature: cylinder, face: '+z', u: 0, v: 0 };
  assert.equal(M.validateMeasurementCollection([record('legacy-cyl', legacyOnCylinder, ground(1, 1))]).ok, false, 'a box corner is not on a round body');
});

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('P2-3 every point the real picker can produce on the real cargo meshes is accepted; points off the surface are not', () => {
  const WORLD = 0.05;
  const rng = mulberry32(20261018);
  const shapes = [
    ['box', 'box', { length: 48, width: 24, height: 32 }],
    ['small box', 'box', { length: 3, width: 2, height: 1.5 }],
    ['cylinder, width < height', 'cylinder', { length: 60, width: 20, height: 30 }],
    ['cylinder, height < width', 'cylinder', { length: 60, width: 40, height: 30 }],
    ['drum', 'drum', { length: 36, width: 22, height: 22 }],
    ['large drum', 'drum', { length: 240, width: 96, height: 96 }],
  ];
  for (const [name, shape, dims] of shapes) {
    const data = caseData({ shape, dimensions: dims });
    const signature = M.getCargoGeometrySignature(data);
    // The same geometry the Editor builds for this Case (src/editor/geometry-factory.js).
    const mesh = new THREE.Mesh(createCaseGeometry(data, inches => inches * WORLD), new THREE.MeshBasicMaterial());
    const group = new THREE.Group();
    group.add(mesh);
    group.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    group.position.set(rng() * 10, rng() * 10, rng() * 10);
    group.updateMatrixWorld(true);
    const reach = Math.max(dims.length, dims.width, dims.height) * WORLD;
    const raycaster = new THREE.Raycaster();
    let hits = 0;
    let capHits = 0;
    let wallHits = 0;
    for (let i = 0; i < 900; i++) {
      const direction = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      const origin = group.position.clone().addScaledVector(direction, reach * 4);
      const aim = new THREE.Vector3((rng() - 0.5) * dims.length, (rng() - 0.5) * dims.height, (rng() - 0.5) * dims.width)
        .multiplyScalar(WORLD).applyEuler(group.rotation).add(group.position);
      raycaster.set(origin, aim.sub(origin).normalize());
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit) continue;
      hits += 1;
      const local = mesh.worldToLocal(hit.point.clone()).multiplyScalar(1 / WORLD);
      const anchor = M.buildCargoAnchor({ instanceId: 'i', local, caseData: data });
      assert.equal(M.isLocalPointOnCargoSurface(anchor.local, signature), true, `${name}: pick ${i} at ${JSON.stringify(anchor.local)}`);
      assert.equal(M.validateMeasurementCollection([record(`m${i}`, anchor, ground(1, 1))]).ok, true, `${name}: pick ${i} saves`);
      // Along the hit face's own outward normal the distance to this convex solid is exactly the offset.
      const outBy = distance => ({
        x: anchor.local.x + hit.face.normal.x * distance, y: anchor.local.y + hit.face.normal.y * distance, z: anchor.local.z + hit.face.normal.z * distance,
      });
      assert.equal(M.isLocalPointOnCargoSurface(outBy(0.005), signature), true, `${name}: pick ${i} within the rounding tolerance`);
      assert.equal(M.isLocalPointOnCargoSurface(outBy(0.05), signature), false, `${name}: pick ${i} 0.05 in off the surface`);
      assert.equal(M.isLocalPointOnCargoSurface(outBy(0.5), signature), false, `${name}: pick ${i} moved half an inch off the surface`);
      if (Math.abs(hit.face.normal.x) > 0.99) capHits += 1; else wallHits += 1;
    }
    assert.ok(hits > 250, `${name}: enough samples (${hits})`);
    if (shape !== 'box') assert.ok(capHits > 20 && wallHits > 20, `${name}: both end caps (${capHits}) and the faceted wall (${wallHits}) are exercised`);
  }
});

// Exact distance (inches) from a cargo-local point to the surface of the REAL mesh the Editor builds for a
// Case: the nearest point of any of its triangles. An independent oracle for the surface predicate.
function meshSurfaceOracle(data, world = 0.05) {
  const geometry = createCaseGeometry(data, inches => inches * world);
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const vertex = i => new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).multiplyScalar(1 / world);
  const triangles = [];
  for (let i = 0; i < index.count; i += 3) triangles.push(new THREE.Triangle(vertex(index.getX(i)), vertex(index.getX(i + 1)), vertex(index.getX(i + 2))));
  const target = new THREE.Vector3();
  const distance = point => {
    const from = new THREE.Vector3(point.x, point.y, point.z);
    return Math.min(...triangles.map(triangle => triangle.closestPointToPoint(from, target).distanceTo(from)));
  };
  return { distance, triangles, vertexCount: position.count, vertex };
}
const SURFACE_TOLERANCE = 0.01 + 1e-6; // the documented rounding tolerance, for a cargo up to a metre long

test('P2-3 the surface distance agrees with the nearest point of the real mesh, inside and outside, for every shape', () => {
  const rng = mulberry32(5150);
  const shapes = [
    ['box', 'box', { length: 48, width: 24, height: 32 }], ['cylinder, width < height', 'cylinder', { length: 60, width: 20, height: 30 }],
    ['cylinder, height < width', 'cylinder', { length: 60, width: 40, height: 30 }], ['drum', 'drum', { length: 36, width: 22, height: 22 }],
    ['large drum', 'drum', { length: 240, width: 96, height: 96 }], ['short wide drum', 'drum', { length: 4, width: 90, height: 90 }],
  ];
  for (const [name, shape, dims] of shapes) {
    const data = caseData({ shape, dimensions: dims });
    const signature = M.getCargoGeometrySignature(data);
    const mesh = meshSurfaceOracle(data);
    const reach = Math.max(dims.length, dims.width, dims.height) / 2 + 3;
    let near = 0;
    for (let i = 0; i < 1500; i++) {
      // A third of the samples are anywhere near the cargo; the rest sit on a random mesh triangle pushed up
      // to 0.12 in along its normal, where the tolerance decisions are made.
      let point;
      if (i % 3 === 0) {
        point = { x: (rng() * 2 - 1) * reach, y: (rng() * 2 - 1) * reach, z: (rng() * 2 - 1) * reach };
      } else {
        const triangle = mesh.triangles[Math.floor(rng() * mesh.triangles.length)];
        const a = rng();
        const b = rng() * (1 - a);
        const base = triangle.a.clone().multiplyScalar(1 - a - b).addScaledVector(triangle.b, a).addScaledVector(triangle.c, b);
        const normal = triangle.getNormal(new THREE.Vector3());
        const push = (rng() * 2 - 1) * 0.12;
        point = { x: base.x + normal.x * push, y: base.y + normal.y * push, z: base.z + normal.z * push };
      }
      const expected = mesh.distance(point);
      const actual = M.distanceToCargoSurface(point, signature);
      assert.ok(Math.abs(actual - expected) < 2e-3, `${name}: ${JSON.stringify(point)} -> ${actual} vs mesh ${expected}`);
      if (Math.abs(expected - SURFACE_TOLERANCE) > 3e-3) {
        assert.equal(M.isLocalPointOnCargoSurface(point, signature), expected < SURFACE_TOLERANCE, `${name}: ${JSON.stringify(point)} at ${expected} in`);
      }
      if (expected < 0.2) near += 1;
    }
    assert.ok(near > 600, `${name}: the samples concentrate on the surface (${near})`);
  }
});

test('P2-3 cylinder and drum: facet centres, vertices, edges and caps follow the 24-sided mesh, not a circle', () => {
  assert.equal(M.CARGO_CYLINDER_SEGMENTS, 24);
  for (const dims of [{ length: 60, width: 20, height: 30 }, { length: 36, width: 22, height: 22 }, { length: 240, width: 96, height: 96 }, { length: 10, width: 44, height: 30 }]) {
    const data = caseData({ shape: 'cylinder', dimensions: dims });
    const signature = M.getCargoGeometrySignature(data);
    const mesh = meshSurfaceOracle(data);
    const radius = Math.min(dims.width, dims.height) / 2;
    const half = dims.length / 2;
    const apothem = radius * Math.cos(Math.PI / 24);
    const on = point => M.isLocalPointOnCargoSurface(point, signature);
    const at = (x, angle, r) => ({ x, y: r * Math.sin(angle), z: r * Math.cos(angle) });
    // The real mesh: every vertex it has is a surface point of the predicate.
    for (let i = 0; i < mesh.vertexCount; i++) {
      assert.ok(M.distanceToCargoSurface(mesh.vertex(i), signature) < 2e-3, `${dims.length}x${dims.width}x${dims.height}: mesh vertex ${i}`);
    }
    for (let k = 0; k < 24; k++) {
      const vertex = (k * Math.PI * 2) / 24;
      const centre = vertex + Math.PI / 24;
      // Side wall: vertex (the edge between two facets), facet centre, and points between them.
      assert.equal(on(at(0, vertex, radius)), true, `vertex ${k} is on the wall`);
      assert.equal(on(at(half * 0.6, centre, apothem)), true, `facet centre ${k} is on the wall`);
      assert.equal(on(at(0, vertex, radius + 0.05)), false, `0.05 in beyond vertex ${k}`);
      assert.equal(on(at(0, vertex, radius - 0.05)), false, `0.05 in inside vertex ${k}`);
      assert.equal(on(at(0, centre, apothem + 0.005)), true, `facet centre ${k}: inside the rounding tolerance, outside`);
      assert.equal(on(at(0, centre, apothem - 0.005)), true, `facet centre ${k}: inside the rounding tolerance, inside`);
      assert.equal(on(at(0, centre, apothem + 0.05)), false, `facet centre ${k}: 0.05 in outside the mesh`);
      assert.equal(on(at(0, centre, apothem - 0.05)), false, `facet centre ${k}: 0.05 in inside the mesh`);
      // The circle through the vertices bulges past the flat facet: that is NOT the mesh.
      assert.equal(on(at(0, centre, radius)), false, `facet centre ${k} on the circumscribed circle is outside the mesh`);
      // Cap corners and caps.
      for (const side of [-1, 1]) {
        assert.equal(on(at(side * half, vertex, radius)), true, `cap corner ${k}`);
        assert.equal(on(at(side * half, centre, apothem * 0.5)), true, `cap interior ${k}`);
        assert.equal(on(at(side * (half + 0.05), vertex, radius)), false, `cap corner ${k} pushed 0.05 in off the cap`);
        assert.equal(on(at(side * (half + 0.05), centre, apothem * 0.5)), false, `cap interior ${k} off the cap`);
        assert.equal(on(at(side * (half - 0.05), centre, apothem * 0.5)), false, `cap interior ${k} 0.05 in below the cap`);
        assert.equal(on(at(side * half, centre, radius)), false, `cap rim at the circumscribed circle ${k}: outside the polygon`);
        assert.equal(on(at(side * (half + 0.007), centre, apothem + 0.007)), true, `cap/wall edge ${k}: both offsets inside the tolerance`);
      }
    }
    assert.equal(on({ x: 0, y: 0, z: 0 }), false, 'the axis is inside the body');
  }
});

test('P1-1 the cargo instance ID invariant: identity keys, ambiguity and the single old-to-new map', () => {
  assert.equal(M.instanceIdentityKey('  a '), 'a', 'read exactly as the workspace validators and the normalizer read an ID');
  for (const blank of ['', '   ', null, undefined, 7, {}]) assert.equal(M.instanceIdentityKey(blank), null);
  const list = id => ({ id });
  assert.deepEqual(M.findAmbiguousInstanceIds([list('a'), list('b'), list('c')]), [], 'unique IDs: nothing is ambiguous');
  assert.deepEqual(M.findAmbiguousInstanceIds([list('a'), list('b'), list('a')]), ['a']);
  assert.deepEqual(M.findAmbiguousInstanceIds([list('a'), list('a '), list(' a')]), ['a'], 'IDs that differ only by surrounding space are the same ID');
  assert.deepEqual(M.findAmbiguousInstanceIds([list(''), list(''), list(null), null, undefined, list(5), list(5)]), [], 'blank or non-string IDs cannot be referenced');
  assert.deepEqual(M.findAmbiguousInstanceIds('nope'), []);

  let n = 0;
  const mint = () => `new-${++n}`;
  const { ids, idMap } = M.assignFreshInstanceIds([list('a'), list('b'), list('a'), list('c'), list('')], mint);
  assert.deepEqual(ids, ['new-1', 'new-2', 'new-3', 'new-4', 'new-5'], 'every instance gets its own fresh ID');
  assert.deepEqual([...idMap], [['b', 'new-2'], ['c', 'new-4']], 'an ambiguous or blank ID is never entered in the map: no anchor can land on an arbitrary instance');
  assert.deepEqual([...M.assignFreshInstanceIds(undefined, mint).idMap], []);

  // A stored plan that carries an ID twice: the anchor is Unresolved, never attached to one of them.
  const data = caseData();
  const dup = M.buildCargoAnchor({ instanceId: 'dup', local: { x: 24, y: 2, z: 3 }, caseData: data });
  const solo = M.buildCargoAnchor({ instanceId: 'solo', local: { x: 24, y: 2, z: 3 }, caseData: data });
  const instances = [instance({ id: 'dup' }), instance({ id: 'dup' }), instance({ id: 'solo' })];
  const ambiguous = new Set(M.findAmbiguousInstanceIds(instances));
  const context = {
    getInstance: id => instances.find(inst => inst.id === id) || null, getCase: () => data, floors: [], truck: {},
    isInstanceAmbiguous: id => ambiguous.has(M.instanceIdentityKey(id)),
  };
  const [a, b] = M.resolveMeasurementList([record('a', dup, ground(5, 5)), record('b', solo, ground(5, 5))], context);
  assert.deepEqual([a.status, a.reason, a.distance, a.start], ['unresolved', 'cargo-ambiguous', null, null]);
  assert.equal(b.status, 'valid', 'an unambiguous anchor in the same plan is unaffected');
  const without = M.resolveMeasurementList([record('a', dup, ground(5, 5))], { ...context, isInstanceAmbiguous: undefined })[0];
  assert.equal(without.status, 'valid', 'documents the hazard this guards: a plain lookup would quietly pick one of the duplicates');
});

// ============================================================================
// Final correction 1: only faces that physically exist are measurable truck surfaces
// ============================================================================
const faceLines = faces => faces.map(face => {
  const spans = [0, 1, 2].map(axis => (face.min[axis] === face.max[axis] ? `${'xyz'[axis]}=${face.min[axis]}` : `${'xyz'[axis]}[${face.min[axis]},${face.max[axis]}]`));
  return `${face.surface} ${spans.join(' ')}`;
}).sort();
const facesOf = (truck, zones) => M.getTruckShellFaces(truck, zones);
const onShell = (faces, surface, x, y, z) => M.pointOnTruckShell(surface, { x, y, z }, faces);
const built = (truck, zones, surface, x, y, z) => M.buildSpaceAnchor({ surface, point: { x, y, z }, truck, zones });

test('P1-3 a standard rectangular truck has exactly its five outer faces', () => {
  const faces = facesOf(RECT_TRUCK, rectZones());
  assert.deepEqual(faceLines(faces), [
    'ceiling x[0,600] y=90 z[-50,50]', 'wall-front x=600 y[0,90] z[-50,50]', 'wall-left x[0,600] y[0,90] z=50',
    'wall-rear x=0 y[0,90] z[-50,50]', 'wall-right x[0,600] y[0,90] z=-50',
  ]);
  for (const [surface, x, y, z] of [['wall-front', 600, 40, 0], ['wall-rear', 0, 40, 0], ['wall-left', 300, 40, 50], ['wall-right', 300, 40, -50], ['ceiling', 300, 90, 0]]) {
    assert.ok(built(RECT_TRUCK, rectZones(), surface, x, y, z), `${surface} is measurable`);
  }
  assert.equal(built(RECT_TRUCK, rectZones(), 'wall-front', 599, 40, 0), null, 'a point must be on the face, not near the truck');
  assert.equal(built(RECT_TRUCK, rectZones(), 'wall-front', 600, 91, 0), null, 'nor beyond its edge');
  assert.equal(built(RECT_TRUCK, rectZones(), 'wall-left', 300, 40, -50), null, 'nor on the opposite wall under the wrong name');
});

test('P1-3 Front Overhang: the cab void and the open seam are not walls; the real faces above the deck are', () => {
  const zones = overhangZones(100, 30);
  const faces = facesOf(OVERHANG_TRUCK, zones);
  assert.deepEqual(faceLines(faces), [
    'ceiling x[0,600] y=90 z[-50,50]', 'ceiling x[600,700] y=90 z[-50,50]',
    'wall-front x=700 y[30,90] z[-50,50]',
    'wall-left x[0,600] y[0,90] z=50', 'wall-left x[600,700] y[30,90] z=50',
    'wall-rear x=0 y[0,90] z[-50,50]',
    'wall-right x[0,600] y[0,90] z=-50', 'wall-right x[600,700] y[30,90] z=-50',
  ], 'exactly the faces the Editor draws: the main box without its front cap, and the raised deck without its rear cap');

  // The confirmed defect: on the bounding plane x = 700, but below the deck, in the cab void.
  for (const [what, y] of [['the middle of the void', 10], ['just under the deck', 29], ['the floor of the void', 0.5]]) {
    assert.equal(onShell(faces, 'wall-front', 700, y, 0), false, `(700, ${y}, 0): ${what} has no wall`);
    assert.equal(built(OVERHANG_TRUCK, zones, 'wall-front', 700, y, 0), null, `no anchor is built in ${what}`);
  }
  // The real front wall above the deck, including its lower edge.
  for (const y of [30, 31, 60, 90]) assert.ok(built(OVERHANG_TRUCK, zones, 'wall-front', 700, y, 0), `(700, ${y}, 0) is the real front wall`);
  // The seam where the deck joins the main box is open (not drawn), below and above the deck alike.
  assert.equal(onShell(faces, 'wall-front', 600, 10, 0), false, 'the main box has no front wall below the deck');
  assert.equal(onShell(faces, 'wall-front', 600, 60, 0), false, 'and the internal boundary above it is not a surface');
  assert.equal(onShell(faces, 'wall-rear', 600, 60, 0), false, 'nor is the deck\'s rear boundary');
  // Real main-body and deck side walls, ceiling and rear; nothing under the deck beside the void.
  assert.ok(built(OVERHANG_TRUCK, zones, 'wall-left', 300, 10, 50), 'main-body side wall, low');
  assert.ok(built(OVERHANG_TRUCK, zones, 'wall-right', 650, 60, -50), 'deck side wall above the deck');
  assert.equal(built(OVERHANG_TRUCK, zones, 'wall-left', 650, 10, 50), null, 'no side wall below the deck beside the cab void');
  assert.ok(built(OVERHANG_TRUCK, zones, 'ceiling', 650, 90, 0), 'ceiling over the deck');
  assert.equal(built(OVERHANG_TRUCK, zones, 'ceiling', 650, 60, 0), null, 'the deck is not a ceiling');
  assert.ok(built(OVERHANG_TRUCK, zones, 'wall-rear', 0, 5, 0), 'rear wall');
  // The deck is a floor, not a wall: its upward face is the 'deck' floor surface.
  const floors = M.buildFloorSurfaces(OVERHANG_TRUCK, zones);
  assert.deepEqual(floors.map(floor => [floor.surface, floor.elevation]), [['main', 0], ['deck', 30]]);
  assert.equal(M.resolveFloorAnchor(M.buildFloorAnchor({ surface: 'deck', point: { x: 650, y: 30, z: 0 } }), { floors }).status, 'valid', 'the raised deck stays measurable');
  assert.equal(M.resolveFloorAnchor(M.buildFloorAnchor({ surface: 'main', point: { x: 300, y: 0, z: 0 } }), { floors }).status, 'valid', 'and so does the main floor');
});

test('P1-3 deck height decides which part of the front wall exists', () => {
  for (const deck of [10, 30, 60, 89]) {
    const zones = overhangZones(100, deck);
    const faces = facesOf(OVERHANG_TRUCK, zones);
    assert.equal(onShell(faces, 'wall-front', 700, deck - 0.5, 0), false, `deck ${deck}: below the deck`);
    assert.equal(onShell(faces, 'wall-front', 700, deck + 0.5, 0), true, `deck ${deck}: above the deck`);
    assert.equal(onShell(faces, 'wall-left', 650, deck - 0.5, 50), false, `deck ${deck}: no deck side wall below the deck`);
  }
  // A deck at floor level leaves no void: the wall is a full-height face again.
  assert.equal(onShell(facesOf(OVERHANG_TRUCK, overhangZones(100, 0)), 'wall-front', 700, 1, 0), true);
});

test('P1-3 Wheel Wells: the shell is the full outer box; the wells are guide volumes and their zone boundaries are not walls', () => {
  const zones = wellZones(30);
  const faces = facesOf(WELLS_TRUCK, zones);
  assert.deepEqual(faceLines(faces), faceLines(facesOf(RECT_TRUCK, rectZones())), 'the Editor draws the same outer box as for a standard truck');
  // Side walls: over the wheel well bodies the wall is still the one the Editor draws.
  assert.ok(built(WELLS_TRUCK, zones, 'wall-left', 150, 10, 50), 'side wall beside a wheel well');
  assert.ok(built(WELLS_TRUCK, zones, 'wall-right', 50, 60, -50), 'side wall in the clear part');
  // Usable-zone boundaries inside the box (x = 100, 200; z = +-30) are not surfaces.
  for (const x of [100, 200]) {
    assert.equal(onShell(faces, 'wall-front', x, 60, 0), false, `internal zone boundary x = ${x}`);
    assert.equal(onShell(faces, 'wall-rear', x, 60, 0), false);
  }
  assert.equal(onShell(faces, 'wall-left', 150, 60, 30), false, 'the inner face of a wheel well is a guide, not a wall');
  assert.ok(built(WELLS_TRUCK, zones, 'ceiling', 150, 90, 0));
  // The wheel well top remains a measurable floor.
  const floors = M.buildFloorSurfaces(WELLS_TRUCK, zones);
  assert.equal(M.resolveFloorAnchor(M.buildFloorAnchor({ surface: 'well-top', point: { x: 150, y: 30, z: 40 } }), { floors }).status, 'valid');
  // Without usable zones there is no proof of the geometry, so nothing is built even for a box.
  assert.equal(built(WELLS_TRUCK, undefined, 'wall-left', 150, 10, 50), null);
});

test('P1-3 internal and coincident boundaries between volumes are removed, whatever their arrangement', () => {
  const box = (...v) => v;
  // Two volumes side by side in Z: the boundary z = 0 is internal, the end caps stay.
  const sideBySide = M.buildTruckShellFaces([box(0, 0, -50, 100, 90, 0), box(0, 0, 0, 100, 90, 50)]);
  assert.equal(M.pointOnTruckShell('wall-left', { x: 50, y: 40, z: 0 }, sideBySide), false, 'z = 0 is not a wall');
  assert.equal(M.pointOnTruckShell('wall-right', { x: 50, y: 40, z: 0 }, sideBySide), false);
  assert.ok(M.pointOnTruckShell('wall-left', { x: 50, y: 40, z: 50 }, sideBySide) && M.pointOnTruckShell('wall-right', { x: 50, y: 40, z: -50 }, sideBySide));
  assert.ok(M.pointOnTruckShell('wall-front', { x: 100, y: 40, z: -25 }, sideBySide) && M.pointOnTruckShell('wall-front', { x: 100, y: 40, z: 25 }, sideBySide));
  // Two volumes stacked in Y: the floor of the upper one hides the lower one's ceiling.
  const stacked = M.buildTruckShellFaces([box(0, 0, -50, 100, 45, 50), box(0, 45, -50, 100, 90, 50)]);
  assert.equal(M.pointOnTruckShell('ceiling', { x: 50, y: 45, z: 0 }, stacked), false, 'y = 45 is internal');
  assert.ok(M.pointOnTruckShell('ceiling', { x: 50, y: 90, z: 0 }, stacked));
  // A neighbour covering only part of a face leaves the rest exposed.
  const partial = M.buildTruckShellFaces([box(0, 0, -50, 100, 90, 50), box(100, 0, -50, 150, 90, 0)]);
  assert.equal(M.pointOnTruckShell('wall-left', { x: 125, y: 40, z: 0 }, partial), true, 'the neighbour\'s own side wall at z = 0 is its outer face');
  assert.equal(M.pointOnTruckShell('wall-front', { x: 100, y: 40, z: -25 }, partial), false, 'covered/open part of the shared cap');
  // Degenerate or malformed input produces no faces rather than invented ones.
  for (const bad of [null, undefined, 'x', []]) assert.deepEqual(M.buildTruckShellFaces(bad), []);
  assert.equal(M.buildTruckShellVolumes(RECT_TRUCK, [[1, 2, 3]]), null);
});

test('P1-3 equivalent physical trucks have the same faces; changed or missing geometry is never Valid', () => {
  const line = faces => faceLines(faces).join('\n');
  assert.equal(line(facesOf(OVERHANG_TRUCK, overhangZones(0, 30))), line(facesOf(RECT_TRUCK, rectZones())), 'an overhang of length 0 is a standard truck');
  assert.equal(line(facesOf(OVERHANG_TRUCK, [...overhangZones(100)].reverse())), line(facesOf(OVERHANG_TRUCK, overhangZones(100))), 'zone order is irrelevant');
  assert.equal(line(facesOf(OVERHANG_TRUCK, overhangZones(100).map(z => [z.min.x, z.min.y, z.min.z, z.max.x, z.max.y, z.max.z]))),
    line(facesOf(OVERHANG_TRUCK, overhangZones(100))), 'and so is the representation');

  const front = built(OVERHANG_TRUCK, overhangZones(100, 30), 'wall-front', 700, 60, 0);
  const status = (zones, truck = OVERHANG_TRUCK) => M.resolveSpaceAnchor(front, { truck, zones }).status;
  assert.equal(status(overhangZones(100, 30)), 'valid');
  assert.equal(status([...overhangZones(100, 30)].reverse()), 'valid', 'the same truck, zones listed differently');
  for (const [what, zones] of [['longer', overhangZones(150, 30)], ['deck raised past the point', overhangZones(100, 70)], ['deck lowered', overhangZones(100, 10)], ['no overhang', rectZones()]]) {
    assert.equal(status(zones), 'needs-review', what);
  }
  for (const unavailable of [undefined, null, [], 'x', [[1, 2, 3]]]) assert.equal(status(unavailable), 'needs-review', `unavailable geometry: ${JSON.stringify(unavailable)}`);
  assert.deepEqual(M.getTruckShellFaces(OVERHANG_TRUCK, []), [], 'no zones, no faces');
});

test('P1-3 a previously saved point on a surface that does not exist is never Valid and is never rewritten', () => {
  const zones = overhangZones(100, 30);
  // Written the way the previous build saved it: the bounding box accepted any point on the x = 700 plane.
  const synthetic = { kind: 'space', surface: 'wall-front', position: { x: 700, y: 10, z: 0 }, truck: M.getTruckSignature(OVERHANG_TRUCK, zones) };
  const stored = record('synthetic', synthetic, ground(1, 1));
  const strict = M.validateMeasurementCollection([stored]);
  assert.equal(strict.ok, false, 'import refuses it');
  assert.match(strict.error, /is not on a physical wall-front of its truck/);
  const kept = M.normalizeMeasurements([stored])[0];
  assert.equal(kept.type, M.MEASUREMENT_TYPE_UNREADABLE, 'a stored copy is kept as a recovery record');
  assert.deepEqual(kept.original, JSON.parse(JSON.stringify(stored)), 'verbatim: not deleted, relocated, clamped or reconstructed');
  const resolved = M.resolveMeasurementList([stored], { getInstance: () => null, getCase: () => null, floors: [], truck: OVERHANG_TRUCK, zones })[0];
  assert.deepEqual([resolved.status, resolved.reason, resolved.distance], ['unresolved', 'unreadable', null]);
  assert.equal(M.resolveSpaceAnchor(synthetic, { truck: OVERHANG_TRUCK, zones }).status, 'needs-review', 'resolved directly it is Needs Review, with no point');
  assert.equal(M.resolveSpaceAnchor(synthetic, { truck: OVERHANG_TRUCK, zones }).point, null);
  // An older record without zones on a shaped truck is unverifiable, never Valid.
  const legacy = JSON.parse(JSON.stringify(synthetic));
  delete legacy.truck.zones;
  assert.equal(M.resolveSpaceAnchor(legacy, { truck: OVERHANG_TRUCK, zones }).reason, 'truck-unverified');
  assert.equal(M.validateMeasurementCollection([record('legacy', legacy, ground(1, 1))]).ok, true, 'it is retained (readable), not rejected');
  // A standard truck's record that names a plane it is not on is malformed too.
  const wrong = { kind: 'space', surface: 'wall-front', position: { x: 300, y: 40, z: 0 }, truck: M.getTruckSignature(RECT_TRUCK, rectZones()) };
  assert.equal(M.validateMeasurementCollection([record('wrong', wrong, ground(1, 1))]).ok, false);
});

// ============================================================================
// Final identity correction: ambiguity is judged on the complete source, never on the survivors
// ============================================================================
let idCounter = 0;
const mintTestId = () => `minted-${++idCounter}`;

test('ID-3 canonicalization judges ambiguity on every source instance, including the ones that are discarded', () => {
  const decide = (ids, survivors) => {
    const out = M.canonicalizeInstanceIds(ids, mintTestId, survivors);
    return { ids: out.ids, mapped: [...out.idMap], contested: [...out.contestedKeys] };
  };
  // The audited case: "cargo" and " cargo " in the source; the second one is discarded.
  assert.deepEqual(decide(['cargo', ' cargo '], [true, false]), { ids: ['cargo', ' cargo '], mapped: [], contested: ['cargo'] },
    'the survivor is stored canonically, but nothing is mapped to it and the key is contested');
  assert.deepEqual(decide(['cargo', ' cargo '], [false, true]), { ids: ['cargo', 'cargo'], mapped: [], contested: ['cargo'] }, 'order does not matter');
  assert.deepEqual(decide([' cargo ', 'cargo'], [false, true]).contested, ['cargo']);
  assert.deepEqual(decide(['a', ' a ', 'a '], [true, false, false]).contested, ['a'], 'several discarded holders');
  assert.deepEqual(decide(['a', ' a ', 'a '], [true, true, false]), { ids: ['a', ' a ', 'a '], mapped: [], contested: [] },
    'still several survivors: every holder keeps its source string and the plan itself stays ambiguous');
  assert.deepEqual(decide(['cargo', ' cargo '], [true, true]), { ids: ['cargo', ' cargo '], mapped: [], contested: [] }, 'nothing discarded: unchanged behaviour');
  // Legitimate identities are unaffected, whatever else is discarded.
  assert.deepEqual(decide([' cargo '], [true]), { ids: ['cargo'], mapped: [['cargo', 'cargo']], contested: [] });
  assert.deepEqual(decide([' cargo ', 'other'], [true, false]), { ids: ['cargo', 'other'], mapped: [['cargo', 'cargo']], contested: [] }, 'an unrelated discarded instance changes nothing');
  assert.deepEqual(decide(['solo', 'dropped', ' dropped '], [true, false, false]), { ids: ['solo', 'dropped', ' dropped '], mapped: [['solo', 'solo']], contested: [] },
    'identities held only by discarded instances are not contested (nothing survives to mistake for them)');
  // A survivor with no ID is given one; a discarded instance is never given one.
  assert.deepEqual(decide(['', ' ', 'x'], [true, false, true]).ids, [`minted-${idCounter}`, ' ', 'x']);
  // Idempotent: the output of a decision is a fixed point.
  for (const [ids, survivors] of [[['cargo', ' cargo '], [true, false]], [['a', ' a '], [true, true]], [[' cargo '], [true]]]) {
    const first = M.canonicalizeInstanceIds(ids, mintTestId, survivors);
    const kept = first.ids.filter((_, i) => survivors[i]);
    const again = M.canonicalizeInstanceIds(kept, mintTestId);
    assert.deepEqual(again.ids, kept, `fixed point for ${JSON.stringify(ids)}`);
    assert.equal(again.contestedKeys.size, 0);
  }
});

test('ID-3 a measurement on a contested identity is withheld verbatim and can never resolve on the surviving cargo', () => {
  const data = caseData();
  const on = (id, name) => record(name, M.buildCargoAnchor({ instanceId: id, local: { x: 24, y: 2, z: 3 }, caseData: data }), ground(5, 5));
  const contestedA = on(' cargo ', 'contested-spaced');
  const contestedB = on('cargo', 'contested-exact');
  const mixed = record('mixed', M.buildCargoAnchor({ instanceId: 'cargo', local: { x: 24, y: 2, z: 3 }, caseData: data }),
    M.buildCargoAnchor({ instanceId: ' solo ', local: { x: 24, y: 2, z: 3 }, caseData: data }));
  const clear = on(' solo ', 'clear');
  const flat = record('flat', ground(1, 1), ground(2, 2));
  const dangling = on(' ghost ', 'dangling');
  const unreadable = { id: 'bad', type: 'point-to-point', start: { kind: 'mystery', instanceId: ' cargo ' } };
  const stored = [contestedA, contestedB, mixed, clear, flat, dangling, unreadable];
  const snapshot = JSON.stringify(stored);
  // Source: "cargo", " cargo " (discarded), " solo ". Survivors: cargo, solo.
  const identity = M.canonicalizeInstanceIds(['cargo', ' cargo ', ' solo '], mintTestId, [true, false, true]);
  const out = M.carryMeasurementsThroughIdentity(stored, identity);
  assert.equal(JSON.stringify(stored), snapshot, 'the stored input is not mutated');
  assert.equal(out.length, stored.length, 'nothing is dropped');
  assert.deepEqual(out.map(r => r.type), ['unreadable', 'unreadable', 'unreadable', 'point-to-point', 'point-to-point', 'point-to-point', 'unreadable']);
  assert.deepEqual(out[0].original, contestedA, 'the verbatim source record is preserved, spaces and all');
  assert.deepEqual(out[1].original, contestedB, 'an anchor spelled exactly like the survivor is just as contested');
  assert.deepEqual(out[2].original, mixed, 'a record with one contested endpoint is withheld whole, the other endpoint recoverable');
  assert.deepEqual(out.slice(0, 3).map(r => r.id), ['contested-spaced', 'contested-exact', 'mixed'], 'record identities are kept');
  assert.equal(out[3].start.instanceId, 'solo', 'an unambiguous anchor still follows its canonicalized cargo');
  assert.equal(out[4].type, 'point-to-point', 'a ground-only record is untouched');
  assert.equal(out[5].start.instanceId, ' ghost ', 'a dangling reference is left exactly as it is');
  assert.deepEqual(out[6].original, unreadable, 'an already unreadable record is untouched');

  // The decisive property: against the surviving cargo nothing contested is Valid.
  const survivors = [{ id: 'cargo', caseId: 'case-1', transform: instance().transform }, { id: 'solo', caseId: 'case-1', transform: instance().transform }];
  const context = {
    getInstance: id => survivors.find(inst => inst.id === M.instanceIdentityKey(id)) || null, getCase: () => data, floors: [], truck: {},
    isInstanceAmbiguous: id => new Set(M.findAmbiguousInstanceIds(survivors)).has(M.instanceIdentityKey(id)),
  };
  const statuses = M.resolveMeasurementList(out, context).map(r => `${r.status}:${r.reason}`);
  assert.deepEqual(statuses, ['unresolved:unreadable', 'unresolved:unreadable', 'unresolved:unreadable', 'valid:null', 'valid:null', 'unresolved:cargo-missing', 'unresolved:unreadable']);
  // The hazard this prevents: re-targeting alone leaves the record readable and Valid on the survivor.
  const onlyRemapped = M.remapMeasurementInstanceIds(stored, identity.idMap);
  assert.equal(M.resolveMeasurementList(onlyRemapped, context)[0].status, 'valid', 'without withholding, the discarded instance\'s reference would land on the survivor');

  // Idempotent: normalizing what came out (identity now taken from the survivors alone) changes nothing.
  const again = M.carryMeasurementsThroughIdentity(out, M.canonicalizeInstanceIds(survivors.map(inst => inst.id), mintTestId));
  assert.deepEqual(again, out);
});

test('P2-4 finite coordinates near the numeric limit are bounded, and a nonfinite distance is never Valid', () => {
  assert.equal(M.MAX_ANCHOR_COORDINATE_INCHES, 1000000);
  const free = x => ({ kind: 'space', surface: 'free', position: { x, y: 0, z: 0 } });
  const extremes = { ...record('big', ground(0, 0), ground(1, 0)), start: free(1.7e308), end: free(-1.7e308) };
  assert.equal(Number.isFinite(extremes.start.position.x) && Number.isFinite(extremes.end.position.x), true, 'each coordinate is individually finite');
  assert.equal(Number.isFinite(extremes.start.position.x - extremes.end.position.x), false, 'but their difference overflows');
  const strict = M.validateMeasurementCollection([extremes]);
  assert.equal(strict.ok, false, 'import rejects it');
  assert.match(strict.error, /start/);
  const stored = M.normalizeMeasurements([extremes])[0];
  assert.equal(stored.type, M.MEASUREMENT_TYPE_UNREADABLE, 'stored data is recovered, not dropped');
  assert.equal(stored.original.start.position.x, 1.7e308);
  assert.equal(M.buildSpaceAnchor({ surface: 'free', point: { x: 1.7e308, y: 0, z: 0 } }), null);
  assert.equal(M.buildFloorAnchor({ surface: 'main', point: { x: 1.7e308, y: 0, z: 0 } }), null);

  const MAX = M.MAX_ANCHOR_COORDINATE_INCHES;
  const atLimit = record('limit', free(MAX), free(-MAX));
  assert.equal(M.validateMeasurementCollection([atLimit]).ok, true, 'the bound itself is allowed');
  const limit = M.resolveMeasurementList([atLimit], { getInstance: () => null, getCase: () => null, floors: [], truck: {} })[0];
  assert.deepEqual([limit.status, limit.distance], ['valid', 2 * MAX]);
  // Legitimate measurements outside the truck, on supported ground, keep working.
  const yard = M.resolveMeasurementList([record('yard', ground(45000, -30000), ground(-1200, 800))], { getInstance: () => null, getCase: () => null, floors: [], truck: {} })[0];
  assert.equal(yard.status, 'valid');
  assert.ok(Number.isFinite(yard.distance) && yard.distance > 50000);

  // Cargo poses are outside what an anchor can bound: the resolved numbers are checked too.
  const data = caseData();
  const anchorOn = id => M.buildCargoAnchor({ instanceId: id, local: { x: 24, y: 0, z: 0 }, caseData: data });
  const at = (x, y, z) => instance({ transform: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 } } });
  const poses = { a: at(1.7e308, 100, 0), b: at(-1.7e308, 100, 0), c: at(0.85e308, 0.85e308, 0.85e308), d: at(-0.85e308, -0.85e308, -0.85e308) };
  const context = { getInstance: id => poses[id] || null, getCase: () => data, floors: [], truck: {} };
  for (const [first, second, why] of [['a', 'b', 'the difference overflows'], ['c', 'd', 'each difference is finite but the 3D distance overflows']]) {
    const result = M.resolveMeasurement(record(why, anchorOn(first), anchorOn(second)), context);
    assert.notEqual(result.status, 'valid', why);
    assert.equal(result.distance, null, `${why}: no Infinity or NaN is returned`);
    assert.equal(result.start, null);
    assert.equal(result.reason, 'distance-invalid');
  }
  assert.match(M.describeMeasurementReason('distance-invalid'), /could not be calculated/i);
});
