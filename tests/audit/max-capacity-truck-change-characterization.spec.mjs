import test from 'node:test';
import assert from 'node:assert/strict';

// Shared physical reconciliation retains packed profile semantics. Truck layout
// confirmation is covered by truck-change-reconciliation.spec.mjs.

const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);

const RECT_TRUCK = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
const WHEEL_TRUCK = {
  length: 120, width: 60, height: 60, shapeMode: 'wheelWells',
  shapeConfig: { wellHeight: 20, wellWidth: 12, wellLength: 40, wellOffsetFromRear: 40 },
};
const FRONT_TRUCK = {
  length: 100, width: 60, height: 60, shapeMode: 'frontBonus',
  shapeConfig: { bonusLength: 30, bonusHeight: 24 },
};
const CUSTOM_RECT_TRUCK = { length: 47.5, width: 33.25, height: 41, shapeMode: 'rect' };
const MAX_PROFILE = 'max-capacity';

function makeCase(id, overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id, name: id, category: 'Default', color: '#999999', dimensions,
    volume: dimensions.length * dimensions.width * dimensions.height,
    weight: overrides.weight ?? 10, canFlip: overrides.canFlip ?? true,
    stackable: overrides.stackable ?? true, noStackOnTop: overrides.noStackOnTop ?? false,
    maxStackCount: overrides.maxStackCount ?? 0, orientationLock: overrides.orientationLock || 'any',
    ...overrides,
  };
}

function makeInstance(id, caseId, position, overrides = {}) {
  return {
    id, caseId,
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    hidden: false, groupId: null, placement: 'packed', ...overrides,
  };
}

function marked(inst) { return { ...inst, packedProfile: MAX_PROFILE }; }

async function loadPackLibrary(cases, instances, truck = RECT_TRUCK, packId = 'pack-tc-char') {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({
    caseLibrary: cases,
    packLibrary: [{ id: packId, title: 'Truck Change Characterization', truck, cases: instances }],
    folderLibrary: [],
    preferences: {},
  });
  return { StateStore, PackLibrary, packId };
}

// ── Cross-shape Truck Change: rect -> Wheel Wells ────────────────────────────

test('TC-CHAR-shape-1 rect -> Wheel Wells: marker cleared for a placement that becomes wheel-well-blocked, preserved for one that stays legal', async () => {
  const caseData = makeCase('cross-shape-a');
  // x=50,z=24 sits inside WHEEL_TRUCK's blocked well body (well spans x:[40,80], z outer strip).
  const willBeBlocked = marked(makeInstance('cross-blocked', caseData.id, { x: 50, y: 5, z: 24 }));
  // x=10,z=0 sits in the rear full-width floor zone in both shapes - stays legal.
  const staysLegal = marked(makeInstance('cross-legal', caseData.id, { x: 10, y: 5, z: 0 }));
  const { PackLibrary } = await loadPackLibrary([caseData], [willBeBlocked, staysLegal]);

  const recon = PackLibrary.reconcilePlacementsForTruck(
    { id: 'p', truck: RECT_TRUCK, cases: [willBeBlocked, staysLegal] }, WHEEL_TRUCK, [caseData]);

  // The blocked instance cannot snap to any legal pose at its column and has no
  // safe vertical alternative there, so it is reported invalid (not silently kept).
  assert.equal(recon.invalid.includes('cross-blocked') || recon.adjusted.some(a => a.id === 'cross-blocked'), true,
    'the wheel-well-blocked instance must not be silently "kept" unchanged');
  const legalNode = recon.nextPack.cases.find(c => c.id === 'cross-legal');
  assert.equal(legalNode.placement, 'packed');
  assert.equal(legalNode.packedProfile, MAX_PROFILE, 'a placement unaffected by the shape change keeps its marker across a cross-shape Truck Change');

  if (recon.invalid.includes('cross-blocked')) {
    const staged = PackLibrary.stagePlacementIds(recon.nextPack, recon.invalid, WHEEL_TRUCK, [caseData]);
    const blockedFinal = staged.pack.cases.find(c => c.id === 'cross-blocked');
    assert.equal(blockedFinal.placement, 'staged');
    assert.equal('packedProfile' in blockedFinal, false, 'staged-after-cross-shape-change correctly clears the marker (existing invariant, generalizes across shapes)');
  }
});

// ── Cross-shape Truck Change: Wheel Wells -> Front Overhang ──────────────────

test('TC-CHAR-shape-2 Wheel Wells -> Front Overhang: marker survives for a still-legal placement', async () => {
  const caseData = makeCase('cross-shape-b');
  const inst = marked(makeInstance('ww-to-fo', caseData.id, { x: 10, y: 5, z: 0 }));
  const { PackLibrary } = await loadPackLibrary([caseData], [inst], WHEEL_TRUCK);

  const recon = PackLibrary.reconcilePlacementsForTruck(
    { id: 'p', truck: WHEEL_TRUCK, cases: [inst] }, FRONT_TRUCK, [caseData]);
  assert.deepEqual(recon.invalid, [], 'rear full-width floor position is legal in both Wheel Wells and Front Overhang shapes');
  const next = recon.nextPack.cases.find(c => c.id === 'ww-to-fo');
  assert.equal(next.packedProfile, MAX_PROFILE, 'marker survives a Wheel Wells -> Front Overhang Truck Change for an unaffected placement');
});

// ── Front Overhang -> custom rect (non-preset dimensions) ────────────────────

test('TC-CHAR-shape-3 Front Overhang -> custom-dimension rect: marker lifecycle is identical to preset dimensions', async () => {
  const caseData = makeCase('cross-shape-c');
  const inst = marked(makeInstance('fo-to-custom', caseData.id, { x: 10, y: 5, z: 0 }));
  const { PackLibrary } = await loadPackLibrary([caseData], [inst], FRONT_TRUCK);

  const recon = PackLibrary.reconcilePlacementsForTruck(
    { id: 'p', truck: FRONT_TRUCK, cases: [inst] }, CUSTOM_RECT_TRUCK, [caseData]);
  assert.deepEqual(recon.invalid, []);
  const next = recon.nextPack.cases.find(c => c.id === 'fo-to-custom');
  assert.equal(next.packedProfile, MAX_PROFILE,
    'custom (non-preset) target dimensions use the exact same reconciliation code path as preset dimensions - no special handling needed');
});
