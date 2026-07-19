import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// AUDIT-ONLY behavior-characterization suite for the Max Capacity Phase C
// packed-profile semantics audit (branch audit/max-capacity-phase-c-profile-semantics).
// Characterizes repackInvalidPlacements() (previously untested for packedProfile
// anywhere in the suite) and cross-shape-mode Truck Change, both flagged as gaps
// in the prior audit rounds.
// ---------------------------------------------------------------------------

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

// ── repackInvalidPlacements(): success path, no relaxation needed ───────────

test('TC-CHAR-repack-1 successfully repacked marked instance keeps the marker even when the new floor spot needs no relaxation', async () => {
  const caseData = makeCase('repack-floor');
  const inst = marked(makeInstance('repack-inst', caseData.id, { x: 20, y: 5, z: 0 }));
  const { PackLibrary } = await loadPackLibrary([caseData], [inst]);

  const smallTruck = { length: 15, width: 60, height: 60, shapeMode: 'rect' };
  const recon = PackLibrary.reconcilePlacementsForTruck(
    { id: 'p', truck: RECT_TRUCK, cases: [inst] }, smallTruck, [caseData]);
  assert.deepEqual(recon.invalid, ['repack-inst'], 'sanity: original position is outside the shrunk truck');

  const outcome = PackLibrary.repackInvalidPlacements(recon, smallTruck, [caseData]);
  assert.deepEqual(outcome.repackedIds, ['repack-inst']);
  const repacked = outcome.pack.cases.find(c => c.id === 'repack-inst');
  assert.equal(repacked.placement, 'packed');
  assert.equal(repacked.packedProfile, MAX_PROFILE,
    'repackInvalidPlacements does NOT re-derive whether the new position needs relaxation - ' +
    'it unconditionally carries the existing marker forward via applyCanonicalInstancePose(), ' +
    'confirming this path behaves like provenance/mode-membership (Contract A/C), not a live ' +
    're-check of relaxed-validation necessity (Contract B).');
});

// ── repackInvalidPlacements(): the floor-only search cannot recreate a stack ─

test('TC-CHAR-repack-2 repack search is floor-only and cannot rebuild a relaxation-dependent stacked relationship', async () => {
  const supportCase = makeCase('repack-support', { stackable: false, noStackOnTop: true, maxStackCount: 1, weight: 5 });
  const childCase = makeCase('repack-child', { weight: 50 });
  const support = marked(makeInstance('rp-support', supportCase.id, { x: 20, y: 5, z: 0 }));
  const child = marked(makeInstance('rp-child', childCase.id, { x: 20, y: 15, z: 0 }));
  const { PackLibrary } = await loadPackLibrary([supportCase, childCase], [support, child]);

  // Shrink the truck length so BOTH the support and the child's (x=20) column
  // falls outside, forcing both into reconResult.invalid.
  const smallTruck = { length: 15, width: 60, height: 60, shapeMode: 'rect' };
  const recon = PackLibrary.reconcilePlacementsForTruck(
    { id: 'p', truck: RECT_TRUCK, cases: [support, child] }, smallTruck, [supportCase, childCase]);
  assert.equal(recon.invalid.length, 2, 'sanity: both members fall outside the shrunk truck');

  const outcome = PackLibrary.repackInvalidPlacements(recon, smallTruck, [supportCase, childCase]);
  const repackedChild = outcome.pack.cases.find(c => c.id === 'rp-child');
  // The support gets a floor slot; the child, if repacked, lands on a DIFFERENT
  // floor slot (not stacked on the support) because findRepackFloorPosition only
  // ever tries y = zone floor. If there is not enough floor area for both, the
  // child fails to repack entirely (failedIds) rather than being stacked.
  if (outcome.repackedIds.includes('rp-child')) {
    assert.equal(Math.abs(repackedChild.transform.position.y - 5) < 0.06, true,
      'child was repacked to a FLOOR level (y≈5 for these dims), not stacked on the support - ' +
      'repackInvalidPlacements never attempts an elevated/supported candidate position');
  } else {
    assert.equal(outcome.failedIds.includes('rp-child'), true,
      'child could not be repacked at all - confirms repack cannot reconstruct a stacked/support-dependent relationship');
  }
});

// ── repackInvalidPlacements(): failure path is a pure pass-through ──────────

test('TC-CHAR-repack-3 a repack failure leaves the instance (placement + marker) completely untouched, reported via failedIds', async () => {
  const bigCase = makeCase('too-big', { dimensions: { length: 200, width: 200, height: 200 } });
  const inst = marked(makeInstance('too-big-inst', bigCase.id, { x: 20, y: 100, z: 0 }));
  const { PackLibrary } = await loadPackLibrary([bigCase], [inst]);

  const tinyTruck = { length: 15, width: 15, height: 15, shapeMode: 'rect' };
  const recon = PackLibrary.reconcilePlacementsForTruck(
    { id: 'p', truck: RECT_TRUCK, cases: [inst] }, tinyTruck, [bigCase]);
  assert.deepEqual(recon.invalid, ['too-big-inst']);

  const outcome = PackLibrary.repackInvalidPlacements(recon, tinyTruck, [bigCase]);
  assert.deepEqual(outcome.repackedIds, []);
  assert.deepEqual(outcome.failedIds, ['too-big-inst']);
  assert.deepEqual(outcome.stagedIds, [], 'repackInvalidPlacements ALWAYS returns an empty stagedIds array - it never stages anything itself, by design (caller decides)');
  const untouched = outcome.pack.cases.find(c => c.id === 'too-big-inst');
  assert.equal(untouched.placement, 'packed', 'failure leaves placement UNCHANGED (still packed, not auto-staged)');
  assert.equal(untouched.packedProfile, MAX_PROFILE, 'failure leaves the marker UNCHANGED - purely a pass-through pending a later user/controller decision');
});

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
