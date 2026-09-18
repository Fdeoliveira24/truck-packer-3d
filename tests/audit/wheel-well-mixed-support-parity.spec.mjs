import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeWheelWellSupport,
  getWheelWellGeometry,
  isWheelWellSupportedAndStable,
} from '../../src/packing-core/wheel-well-model.js';
import { computeXzOverlapArea } from '../../src/packing-core/validation.js';
import { solveAutoPack } from '../../src/services/autopack-solver.js';
import * as PackLibrary from '../../src/services/pack-library.js';

const WHEEL_TRUCK = {
  length: 120,
  width: 60,
  height: 60,
  shapeMode: 'wheelWells',
  shapeConfig: { wellHeight: 20, wellWidth: 12, wellLength: 40, wellOffsetFromRear: 40 },
};

const GEOMETRY = getWheelWellGeometry(WHEEL_TRUCK);
const CANDIDATE_AABB = aabb(40, 20, -30, 60, 30, -12);
const CANDIDATE_ITEM = { weight: 20 };

function aabb(minX, minY, minZ, maxX, maxY, maxZ) {
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

function cargoSupport(overrides = {}) {
  return {
    id: 'cargo-support',
    aabb: aabb(40, 0, -18, 80, 20, -12),
    caseData: {
      weight: 100,
      stackable: true,
      noStackOnTop: false,
      maxStackCount: 0,
      isPallet: false,
      ...overrides,
    },
  };
}

function expectGeometricSupportUnchanged(packed) {
  const support = computeWheelWellSupport(CANDIDATE_AABB, packed, GEOMETRY, CANDIDATE_ITEM);
  assert.equal(support.fraction, 2 / 3);
  assert.equal(support.comSupported, true);
  assert.equal(support.overhangFraction, 1 / 3);
  assert.equal(support.supportCount, 1);
}

test('E1 rigid Wheel-Well support cannot wash out noStackOnTop cargo contact', () => {
  const packed = [cargoSupport({ noStackOnTop: true })];
  expectGeometricSupportUnchanged(packed);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, packed, GEOMETRY, CANDIDATE_ITEM), false);
});

test('E2 rigid Wheel-Well support cannot wash out stackable:false cargo contact', () => {
  const packed = [cargoSupport({ stackable: false })];
  expectGeometricSupportUnchanged(packed);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, packed, GEOMETRY, CANDIDATE_ITEM), false);
});

test('E3 rigid Wheel-Well support cannot wash out cargo at maxStackCount', () => {
  const support = cargoSupport({ maxStackCount: 1 });
  const existingChild = {
    id: 'existing-child',
    aabb: aabb(60, 20, -18, 70, 25, -12),
    caseData: { weight: 1, stackable: true },
  };
  const packed = [support, existingChild];
  expectGeometricSupportUnchanged(packed);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, packed, GEOMETRY, CANDIDATE_ITEM), false);
});

test('E4 rigid Wheel-Well support cannot wash out a too-light cargo support', () => {
  const packed = [cargoSupport({ weight: 1 })];
  expectGeometricSupportUnchanged(packed);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, packed, GEOMETRY, CANDIDATE_ITEM), false);
});

test('E5 rigid Wheel-Well support may combine with fully legal cargo support', () => {
  const support = computeWheelWellSupport(CANDIDATE_AABB, [cargoSupport()], GEOMETRY, CANDIDATE_ITEM);
  assert.deepEqual(support, { fraction: 1, comSupported: true, overhangFraction: 0, supportCount: 2 });
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, [cargoSupport()], GEOMETRY, CANDIDATE_ITEM), true);
});

test('E6 rigid Wheel-Well support remains valid without cargo contact', () => {
  expectGeometricSupportUnchanged([]);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, [], GEOMETRY, CANDIDATE_ITEM), true);
});

test('E7 lateral-only cargo contact does not create a support veto', () => {
  const lateralCargo = {
    ...cargoSupport({ noStackOnTop: true }),
    aabb: aabb(40, 20, -12, 60, 30, -6),
  };
  assert.equal(computeXzOverlapArea(CANDIDATE_AABB, lateralCargo.aabb), 0);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, [lateralCargo], GEOMETRY, CANDIDATE_ITEM), true);
});

test('E8 cargo at a different support level does not create a support veto', () => {
  const lowerCargo = {
    ...cargoSupport({ noStackOnTop: true }),
    aabb: aabb(40, 0, -18, 80, 19, -12),
  };
  assert.ok(computeXzOverlapArea(CANDIDATE_AABB, lowerCargo.aabb) > 0.05);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, [lowerCargo], GEOMETRY, CANDIDATE_ITEM), true);
});

test('E9 edge-only XZ contact does not create a support veto', () => {
  const edgeCargo = {
    ...cargoSupport({ noStackOnTop: true }),
    aabb: aabb(60, 0, -18, 70, 20, -12),
  };
  assert.equal(computeXzOverlapArea(CANDIDATE_AABB, edgeCargo.aabb), 0);
  assert.equal(isWheelWellSupportedAndStable(CANDIDATE_AABB, [edgeCargo], GEOMETRY, CANDIDATE_ITEM), true);
});

function makeCase(id, dimensions, overrides = {}) {
  return {
    id,
    name: id,
    category: 'Default',
    color: '#999999',
    dimensions,
    volume: dimensions.length * dimensions.width * dimensions.height,
    weight: overrides.weight ?? 10,
    canFlip: true,
    stackable: overrides.stackable ?? true,
    noStackOnTop: overrides.noStackOnTop ?? false,
    maxStackCount: overrides.maxStackCount ?? 0,
    orientationLock: 'any',
    isPallet: overrides.isPallet ?? false,
    ...overrides,
  };
}

function makeInstance(id, position, packedProfile) {
  return {
    id,
    caseId: id,
    placement: 'packed',
    transform: {
      position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...(packedProfile ? { packedProfile } : {}),
  };
}

function makeMixedSupportPlan({ legalSupport = false, maxCapacity = false } = {}) {
  const supportCase = makeCase('support', { length: 40, width: 6, height: 20 }, legalSupport
    ? { weight: 100 }
    : { weight: 1, noStackOnTop: true, stackable: false, maxStackCount: 1 });
  const childCase = makeCase('child', { length: 20, width: 18, height: 10 }, { weight: 20 });
  const profile = maxCapacity ? 'max-capacity' : null;
  return {
    cases: [supportCase, childCase],
    pack: {
      id: 'mixed-support-pack',
      title: 'Mixed Support',
      truck: WHEEL_TRUCK,
      cases: [
        makeInstance('support', { x: 60, y: 10, z: -15 }, profile),
        makeInstance('child', { x: 50, y: 25, z: -21 }, profile),
      ],
    },
  };
}

test('E10 existing marked Max Capacity projection keeps approved mixed support valid', () => {
  const { cases, pack } = makeMixedSupportPlan({ maxCapacity: true });
  const reconciliation = PackLibrary.reconcilePlacementsForTruck(pack, pack.truck, cases);
  assert.deepEqual(reconciliation.invalid, []);
  assert.deepEqual(reconciliation.adjusted, []);
  assert.deepEqual(reconciliation.kept, ['support', 'child']);
});

test('solver final validation does not retain an illegal Wheel-Well mixed-support placement', () => {
  const truck = {
    length: 40,
    width: 60,
    height: 60,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 18, wellLength: 40, wellOffsetFromRear: 0 },
  };
  const locked = {
    orientationLock: 'upright',
    canFlip: false,
    orientationLocked: true,
    lockedRotation: { x: 0, y: 0, z: 0 },
  };
  const items = [
    {
      instanceId: 'support',
      caseId: 'support',
      dims: { l: 40, w: 24, h: 20 },
      weight: 1,
      noStackOnTop: true,
      stackable: false,
      ...locked,
    },
    {
      instanceId: 'candidate',
      caseId: 'candidate',
      dims: { l: 20, w: 27, h: 10 },
      weight: 20,
      stackable: true,
      ...locked,
    },
  ];
  const result = solveAutoPack({
    truck,
    zones: PackLibrary.getTrailerUsableZones(truck),
    items,
    constrainedSpaceFirst: true,
    enableWheelWellBridge: true,
    enableWheelWellFloorChannelCompaction: false,
    enableWheelWellFrontCompression: false,
    enableLeftoverPass: false,
    loadFrontFirst: false,
  });
  assert.equal(result.placements.has('support'), true);
  assert.equal(result.placements.has('candidate'), false);
  assert.deepEqual(result.unpacked, ['candidate']);
});

test('manual resolve and whole-Pack revalidation reject illegal Wheel-Well mixed support', () => {
  const { cases, pack } = makeMixedSupportPlan();
  const desiredPosition = pack.cases.find(instance => instance.id === 'child').transform.position;
  const manual = PackLibrary.findManualVerticalPlacement(pack, cases, 'child', {
    mode: 'resolve',
    desiredPosition,
  });
  assert.equal(manual.ok, false);
  assert.equal(manual.code, 'support-rules');

  const reconciliation = PackLibrary.reconcilePlacementsForTruck(pack, pack.truck, cases);
  assert.deepEqual(reconciliation.kept, ['support']);
  assert.deepEqual(reconciliation.invalid, ['child']);

  const revalidated = PackLibrary.revalidateManualPlacements(pack, cases, {
    preserveStagedPositions: true,
  });
  assert.deepEqual(revalidated.invalidIds, ['child']);
  assert.deepEqual(revalidated.stagedIds, ['child']);
  assert.equal(revalidated.pack.cases.find(instance => instance.id === 'child').placement, 'staged');
});

test('manual and reconciliation paths retain legal Wheel-Well mixed support', () => {
  const { cases, pack } = makeMixedSupportPlan({ legalSupport: true });
  const desiredPosition = pack.cases.find(instance => instance.id === 'child').transform.position;
  assert.deepEqual(
    PackLibrary.findManualVerticalPlacement(pack, cases, 'child', { mode: 'resolve', desiredPosition }),
    { ok: true, position: desiredPosition, fromBottom: 20, toBottom: 20, corrected: false }
  );

  const reconciliation = PackLibrary.reconcilePlacementsForTruck(pack, pack.truck, cases);
  assert.deepEqual(reconciliation.invalid, []);
  assert.deepEqual(reconciliation.kept, ['support', 'child']);

  const revalidated = PackLibrary.revalidateManualPlacements(pack, cases);
  assert.deepEqual(revalidated.invalidIds, []);
  assert.equal(revalidated.pack.cases.every(instance => instance.placement === 'packed'), true);
});
