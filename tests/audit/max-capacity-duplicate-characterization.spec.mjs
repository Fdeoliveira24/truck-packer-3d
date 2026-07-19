import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// AUDIT-ONLY behavior-characterization suite for the Max Capacity Phase C
// packed-profile semantics audit (branch audit/max-capacity-phase-c-profile-semantics).
// These tests establish GROUND TRUTH about whether packedProfile is load-bearing
// for a duplicate's physical validity before any fix is proposed. They do not
// assert a "should" outcome for a fix; they characterize CURRENT behavior and,
// where a hypothetical unconditional-strip fix is simulated, characterize what
// that would break.
// ---------------------------------------------------------------------------

const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);

const RECT_TRUCK = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
const MAX_PROFILE = 'max-capacity';

function makeCase(id, overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id,
    name: id,
    category: 'Default',
    color: '#999999',
    dimensions,
    volume: dimensions.length * dimensions.width * dimensions.height,
    weight: overrides.weight ?? 10,
    canFlip: overrides.canFlip ?? true,
    stackable: overrides.stackable ?? true,
    noStackOnTop: overrides.noStackOnTop ?? false,
    maxStackCount: overrides.maxStackCount ?? 0,
    orientationLock: overrides.orientationLock || 'any',
    ...overrides,
  };
}

function makeInstance(id, caseId, position, overrides = {}) {
  return {
    id,
    caseId,
    transform: {
      position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: 'packed',
    ...overrides,
  };
}

function marked(inst) {
  return { ...inst, packedProfile: MAX_PROFILE };
}

function stripProfile(inst) {
  const next = { ...inst };
  delete next.packedProfile;
  return next;
}

async function loadPackLibrary(cases, instances, truck = RECT_TRUCK, packId = 'pack-dup-char') {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({
    caseLibrary: cases,
    packLibrary: [{ id: packId, title: 'Duplicate Characterization', truck, cases: instances }],
    folderLibrary: [],
    preferences: {},
  });
  return { StateStore, PackLibrary, packId };
}

// ── Scenario A: marked instance duplicated onto open floor ──────────────────
// Strict rules are trivially sufficient (nothing to support, floor rest is
// always valid). The marker plays NO role in this placement's validity.

test('DUP-CHAR-A open-floor duplicate: current behavior + marker is provably inert', async () => {
  const caseData = makeCase('floor-case');
  const original = marked(makeInstance('floor-orig', caseData.id, { x: 20, y: 5, z: 0 }));
  const { PackLibrary, packId } = await loadPackLibrary([caseData], [original]);
  const pack = PackLibrary.getById(packId);

  const result = PackLibrary.duplicateInstancesSafely(packId, [pack.cases[0]], [caseData]);
  assert.ok(result && result.newIds.length === 1, 'A: a collision-free floor position must be found');
  const dup = result.cases.find(c => c.id === result.newIds[0]);

  assert.equal(dup.placement, 'packed', 'A: duplicate lands packed');
  assert.equal(dup.packedProfile, MAX_PROFILE, 'A: CURRENT behavior retains the marker on a packed duplicate');

  // Immediate revalidation (same truck) must agree with the fresh duplicate.
  const immediate = PackLibrary.reconcilePlacementsForTruck(
    { id: packId, truck: RECT_TRUCK, cases: result.cases }, RECT_TRUCK, [caseData]);
  const dupImmediate = immediate.nextPack.cases.find(c => c.id === dup.id);
  assert.equal(dupImmediate.placement, 'packed', 'A: immediate revalidation agrees the duplicate is packed');
  assert.equal(dupImmediate.packedProfile, MAX_PROFILE, 'A: revalidation preserves the marker (marked-instance invariant)');

  // Simulate the proposed "always strip on duplicate" fix and re-validate.
  const strippedCases = result.cases.map(c => (c.id === dup.id ? stripProfile(c) : c));
  const afterStrip = PackLibrary.reconcilePlacementsForTruck(
    { id: packId, truck: RECT_TRUCK, cases: strippedCases }, RECT_TRUCK, [caseData]);
  const dupAfterStrip = afterStrip.nextPack.cases.find(c => c.id === dup.id);
  assert.equal(dupAfterStrip.placement, 'packed',
    'A: stripping the marker changes NOTHING here -> the marker was inert (safe to strip in this scenario)');
});

// ── Scenario B: marked instance stacked on a support, but strict rules alone
// already make the placement valid (permissive support, light child) ────────

test('DUP-CHAR-B strict-sufficient stack duplicate: marker retained but still inert', async () => {
  const supportCase = makeCase('permissive-support', {
    dimensions: { length: 20, width: 20, height: 10 },
    stackable: true,
    noStackOnTop: false,
    maxStackCount: 0,
    weight: 100,
  });
  const childCase = makeCase('light-child', { weight: 5 });
  const support = marked(makeInstance('b-support', supportCase.id, { x: 20, y: 5, z: 0 }));
  const child = marked(makeInstance('b-child', childCase.id, { x: 20, y: 15, z: 0 }));

  const { PackLibrary, packId } = await loadPackLibrary([supportCase, childCase], [support, child]);
  const pack = PackLibrary.getById(packId);

  const result = PackLibrary.duplicateInstancesSafely(packId, pack.cases, [supportCase, childCase]);
  assert.equal(result.newIds.length, 2, 'B: both group members must duplicate together');
  const dupSupport = result.cases.find(c => c.caseId === supportCase.id && !c.id.startsWith('b-'));
  const dupChild = result.cases.find(c => c.caseId === childCase.id && !c.id.startsWith('b-'));
  assert.ok(dupSupport && dupChild, 'B: duplicate pair located');
  assert.equal(dupSupport.placement, 'packed');
  assert.equal(dupChild.placement, 'packed', 'B: strict rules alone already validate this stack');
  assert.equal(dupChild.packedProfile, MAX_PROFILE, 'B: CURRENT behavior retains the marker');

  // Strip both duplicate members and re-validate under the SAME truck.
  const stripped = result.cases.map(c =>
    (c.id === dupSupport.id || c.id === dupChild.id) ? stripProfile(c) : c);
  const afterStrip = PackLibrary.reconcilePlacementsForTruck(
    { id: packId, truck: RECT_TRUCK, cases: stripped }, RECT_TRUCK, [supportCase, childCase]);
  const childAfterStrip = afterStrip.nextPack.cases.find(c => c.id === dupChild.id);
  assert.equal(childAfterStrip.placement, 'packed',
    'B: stripping the marker changes NOTHING -> permissive support means the marker was inert here too');
});

// ── Scenario C: marked instance stacked on a support where the placement is
// ONLY valid because Max Capacity relaxation (noStackOnTop/maxStackCount/weight)
// is active — the mirror of MAX-CAPACITY-B4's recipe, run through Duplicate. ──

test('DUP-CHAR-C relaxation-dependent stack duplicate: marker is LOAD-BEARING, stripping it breaks the duplicate', async () => {
  const supportCase = makeCase('strict-support', {
    stackable: false,
    noStackOnTop: true,
    maxStackCount: 1,
    weight: 5,
  });
  const childCase = makeCase('heavy-child', { weight: 50 });
  const support = marked(makeInstance('c-support', supportCase.id, { x: 20, y: 5, z: 0 }));
  const child = marked(makeInstance('c-child', childCase.id, { x: 20, y: 15, z: 0 }));

  const { PackLibrary, packId } = await loadPackLibrary([supportCase, childCase], [support, child]);
  const pack = PackLibrary.getById(packId);

  // Sanity check (mirrors MAX-CAPACITY-B4): the ORIGINAL marked pair is valid as-is.
  const originalCheck = PackLibrary.reconcilePlacementsForTruck(
    { id: packId, truck: RECT_TRUCK, cases: pack.cases }, RECT_TRUCK, [supportCase, childCase]);
  assert.deepEqual(originalCheck.invalid, [], 'C: sanity check - original marked-to-marked stack is valid');

  const result = PackLibrary.duplicateInstancesSafely(packId, pack.cases, [supportCase, childCase]);
  assert.equal(result.newIds.length, 2, 'C: the duplicate-eligibility check uses the SOURCE instances (still marked), so the group duplicates together');
  const dupSupport = result.cases.find(c => c.caseId === supportCase.id && !['c-support', 'c-child'].includes(c.id));
  const dupChild = result.cases.find(c => c.caseId === childCase.id && !['c-support', 'c-child'].includes(c.id));
  assert.ok(dupSupport && dupChild, 'C: duplicate pair located');
  assert.equal(dupSupport.placement, 'packed');
  assert.equal(dupChild.placement, 'packed',
    'C: CURRENT behavior lands the duplicate packed, because duplicatePackedGroupIsFullyValid() validated it using the SOURCE instances (still marked) before packedProfile was ever assigned/stripped on the clone');
  assert.equal(dupChild.packedProfile, MAX_PROFILE, 'C: CURRENT behavior retains the marker on the packed duplicate');

  // Immediate revalidation with the CURRENT (marker-preserving) behavior must agree.
  const immediate = PackLibrary.reconcilePlacementsForTruck(
    { id: packId, truck: RECT_TRUCK, cases: result.cases }, RECT_TRUCK, [supportCase, childCase]);
  assert.deepEqual(immediate.invalid, [], 'C: with the marker preserved, revalidation agrees the duplicate stack is still valid');

  // Now simulate the proposed "always strip packedProfile on duplicate" fix.
  // IMPORTANT (a real discovery from this characterization run): reconcilePlacementsForTruck()
  // does NOT flip an unrevalidatable instance's `placement` field to 'staged' by itself - a
  // node that fails aabbIsFullyValid() and has no safe vertical snap is left in the returned
  // pack with `placement` UNCHANGED ('packed') and its id is reported separately in
  // `result.invalid`. Production Truck Change (src/ui/truck-change-controller.js:77,375)
  // always follows reconcile with PackLibrary.stagePlacementIds(nextPack, recon.invalid, ...)
  // to actually move those ids to staged. So the correct signal to check here is
  // `result.invalid`, not `nextPack.cases[...].placement` - checking placement alone would
  // have silently missed this exact defect class.
  const stripped = result.cases.map(c =>
    (c.id === dupSupport.id || c.id === dupChild.id) ? stripProfile(c) : c);
  const afterStrip = PackLibrary.reconcilePlacementsForTruck(
    { id: packId, truck: RECT_TRUCK, cases: stripped }, RECT_TRUCK, [supportCase, childCase]);

  assert.equal(afterStrip.invalid.includes(dupChild.id), true,
    'C: CONFIRMED - unconditionally stripping packedProfile on this duplicate makes a previously-packed, ' +
    'previously-VALID instance fail revalidation (reported via result.invalid) with no explanation to the user. ' +
    'The naive "always delete on duplicate" fix is UNSAFE for this scenario.');

  // Show what production Truck Change actually does next: stage the invalid id(s).
  const staged = PackLibrary.stagePlacementIds(afterStrip.nextPack, afterStrip.invalid, RECT_TRUCK, [supportCase, childCase]);
  const childFinal = staged.pack.cases.find(c => c.id === dupChild.id);
  assert.equal(childFinal.placement, 'staged',
    'C: end-to-end, the production Truck Change pipeline (reconcile + stagePlacementIds) DOES ' +
    'silently move this previously-packed duplicate to staging once the marker is stripped.');
  assert.equal('packedProfile' in childFinal, false, 'C: staged instance correctly has no marker (existing invariant)');
});

// ── Scenario C-partial: only one side of the pair loses the marker ──────────
// Confirms the mechanism precisely: relaxation requires BOTH sides marked.

test('DUP-CHAR-C-partial one-sided marker loss on a duplicated dependent pair also breaks validity', async () => {
  const supportCase = makeCase('strict-support-2', {
    stackable: false,
    noStackOnTop: true,
    maxStackCount: 1,
    weight: 5,
  });
  const childCase = makeCase('heavy-child-2', { weight: 50 });
  const support = marked(makeInstance('cp-support', supportCase.id, { x: 20, y: 5, z: 0 }));
  const child = marked(makeInstance('cp-child', childCase.id, { x: 20, y: 15, z: 0 }));

  const { PackLibrary, packId } = await loadPackLibrary([supportCase, childCase], [support, child]);
  const pack = PackLibrary.getById(packId);
  const result = PackLibrary.duplicateInstancesSafely(packId, pack.cases, [supportCase, childCase]);
  const dupSupport = result.cases.find(c => c.caseId === supportCase.id && !['cp-support', 'cp-child'].includes(c.id));
  const dupChild = result.cases.find(c => c.caseId === childCase.id && !['cp-support', 'cp-child'].includes(c.id));

  // Strip only the CHILD's marker; leave the support marked.
  const stripped = result.cases.map(c => (c.id === dupChild.id ? stripProfile(c) : c));
  const afterStrip = PackLibrary.reconcilePlacementsForTruck(
    { id: packId, truck: RECT_TRUCK, cases: stripped }, RECT_TRUCK, [supportCase, childCase]);
  assert.equal(afterStrip.invalid.includes(dupChild.id), true,
    'C-partial: one-sided marker loss on a dependent duplicate also invalidates it (matches MAX-CAPACITY-B5 semantics for duplicates)');
  const staged = PackLibrary.stagePlacementIds(afterStrip.nextPack, afterStrip.invalid, RECT_TRUCK, [supportCase, childCase]);
  const childFinal = staged.pack.cases.find(c => c.id === dupChild.id);
  assert.equal(childFinal.placement, 'staged', 'C-partial: end-to-end pipeline confirms it gets staged');
});
