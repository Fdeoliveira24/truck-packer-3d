// Manual vertical placement v1 (Move Up / Move Down / Drop to Surface / resolve).
// Behavior tests for PackLibrary.findManualVerticalPlacement and its commit path:
// every accepted level must pass the same hard-rule pipeline as reconciliation
// (containment, collision, support fraction, stack/no-top/weight rules, wheel-well
// blocked bodies and stability, Front Overhang rear retention). No DOM required.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);
const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);

const RECT_TRUCK = { length: 120, width: 60, height: 60, shapeMode: 'rect' };

const WHEEL_WELL_TRUCK = {
  length: 120,
  width: 60,
  height: 60,
  shapeMode: 'wheelWells',
  shapeConfig: { wellHeight: 20, wellWidth: 12, wellLength: 40, wellOffsetFromRear: 40 },
};

const FRONT_OVERHANG_TRUCK = {
  length: 100,
  width: 60,
  height: 60,
  shapeMode: 'frontBonus',
  shapeConfig: { bonusLength: 30, bonusHeight: 24 },
};

function makeVerticalCase(overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id: overrides.id || 'case-vertical',
    name: overrides.name || 'Vertical Box',
    manufacturer: 'QA',
    category: 'Default',
    color: '#9ca3af',
    dimensions,
    weight: overrides.weight || 10,
    volume: dimensions.length * dimensions.width * dimensions.height,
    canFlip: true,
    stackable: true,
    ...overrides,
  };
}

function makeVerticalInstance(caseId, id, position, overrides = {}) {
  return {
    id,
    caseId,
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    hidden: false,
    groupId: null,
    placement: 'packed',
    ...overrides,
  };
}

async function setupVerticalPack({ cases, instances, truck = RECT_TRUCK, packId = 'pack-vertical' }) {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({
    caseLibrary: cases,
    packLibrary: [{ id: packId, title: 'Manual Vertical Placement', truck, cases: instances }],
    folderLibrary: [],
    preferences: {},
  });
  return { StateStore, PackLibrary, packId };
}

async function loadEditorScreenModule() {
  return import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
}

async function buildOrganizedUnpackLayout({ cases, instances, truck = RECT_TRUCK }) {
  const EditorScreen = await loadEditorScreenModule();
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const casesById = new Map(cases.map(caseData => [caseData.id, caseData]));
  return EditorScreen.buildOrganizedUnpackStagingCases({
    instances,
    stagingLayout: PackLibrary.getStagingLayout(truck),
    getCaseById: caseId => casesById.get(caseId),
    getCanonicalInstanceEffectiveDims: PackLibrary.getCanonicalInstanceEffectiveDims,
  });
}

function stagedAabb(inst) {
  const dims = inst.orientedDims;
  const position = inst.transform.position;
  return {
    min: {
      x: position.x - dims.length / 2,
      y: position.y - dims.height / 2,
      z: position.z - dims.width / 2,
    },
    max: {
      x: position.x + dims.length / 2,
      y: position.y + dims.height / 2,
      z: position.z + dims.width / 2,
    },
  };
}

function aabbsOverlap(a, b, tolerance = 1e-9) {
  return a.min.x < b.max.x - tolerance && a.max.x > b.min.x + tolerance &&
    a.min.y < b.max.y - tolerance && a.max.y > b.min.y + tolerance &&
    a.min.z < b.max.z - tolerance && a.max.z > b.min.z + tolerance;
}

test('MANUAL-VERTICAL move up performs a stack reorder that ends fully supported', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-up' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'b', { x: 20, y: 15, z: 0 }),
    ],
  });

  const pack = PackLibrary.getById(packId);
  const resolved = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'a', { mode: 'up' });
  assert.equal(resolved.ok, true, 'move up must find the level on top of the dependent');
  assert.equal(resolved.toBottom, 20, 'the next valid level above must be the dependent top');
  assert.equal(resolved.position.y, 25, 'target center Y must be level + half height');
  assert.equal(resolved.position.x, 20, 'X must not change');
  assert.equal(resolved.position.z, 0, 'Z must not change');

  const nextCases = pack.cases.map(item =>
    item.id === 'a'
      ? { ...item, transform: { ...item.transform, position: resolved.position } }
      : item
  );
  const result = PackLibrary.updateCasesWithManualRevalidation(packId, nextCases, [caseData], {
    repairDependents: true,
  });
  const byId = new Map(result.pack.cases.map(inst => [inst.id, inst]));
  assert.equal(byId.get('b').transform.position.y, 5,
    'the former dependent must re-settle onto the floor');
  assert.equal(byId.get('a').transform.position.y, 15,
    'the moved case must end resting on the re-settled dependent');
  assert.equal(result.pack.cases.every(inst => inst.placement === 'packed'), true,
    'the reordered stack must stay fully packed');
  assert.equal(result.adjustedIds.includes('b'), true,
    'the dependent adjustment must be reported');
  assert.deepEqual(result.stagedIds, [], 'no case may be staged by a legal stack reorder');
});

test('MANUAL-VERTICAL move up is rejected by missing clearance above', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-ceiling' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    truck: { ...RECT_TRUCK, height: 25 },
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'b', { x: 20, y: 15, z: 0 }),
    ],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData], 'a', { mode: 'up' });
  assert.equal(resolved.ok, false, 'move up must fail when the stack would exceed the truck');
  assert.equal(resolved.code, 'no-clearance-above', 'the ceiling must be named as the blocker');
  assert.equal(typeof resolved.reason, 'string', 'a toast-ready reason must be returned');
});

test('MANUAL-VERTICAL move up onto a no-stack case reports support-rules', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-base' });
  const noStack = makeVerticalCase({ id: 'case-vertical-nostack', stackable: false });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData, noStack],
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(noStack.id, 'b', { x: 20, y: 15, z: 0 }),
    ],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData, noStack], 'a', { mode: 'up' });
  assert.equal(resolved.ok, false, 'a no-stack case must never become support');
  assert.equal(resolved.code, 'support-rules', 'the stacking rule must be named as the blocker');
});

test('MANUAL-VERTICAL move down from a floating pose lands on the nearest valid surface below', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-float' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [makeVerticalInstance(caseData.id, 'a', { x: 20, y: 25, z: 0 })],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData], 'a', { mode: 'down' });
  assert.equal(resolved.ok, true, 'move down must recover a floating case');
  assert.equal(resolved.toBottom, 0, 'the nearest valid level below is the floor');
  assert.equal(resolved.position.y, 5, 'the case must rest exactly on the floor');
});

test('MANUAL-VERTICAL move down on a directly stacked case reports no-level-below', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-stacked' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'b', { x: 20, y: 15, z: 0 }),
    ],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData], 'b', { mode: 'down' });
  assert.equal(resolved.ok, false, 'the supporter occupies the column below');
  assert.equal(resolved.code, 'no-level-below', 'move down must answer honestly');
});

test('MANUAL-VERTICAL drop on a resting case reports already-resting', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-resting' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'b', { x: 20, y: 15, z: 0 }),
    ],
  });

  const pack = PackLibrary.getById(packId);
  const floorDrop = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'a', { mode: 'drop' });
  assert.equal(floorDrop.ok, false, 'a floor-resting case has nothing to drop to');
  assert.equal(floorDrop.code, 'already-resting', 'drop must be an honest no-op on the floor');
  const stackDrop = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'b', { mode: 'drop' });
  assert.equal(stackDrop.code, 'already-resting', 'drop must be an honest no-op on a valid support');
});

test('MANUAL-VERTICAL drop recovers a floating case onto the nearest surface below', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-drop' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'base', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'floater', { x: 20, y: 40, z: 0 }),
    ],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData], 'floater', { mode: 'drop' });
  assert.equal(resolved.ok, true, 'drop must land the floating case');
  assert.equal(resolved.toBottom, 10, 'the nearest valid surface below is the base top');
  assert.equal(resolved.position.y, 15, 'the case must rest exactly on the base top');
});

test('MANUAL-VERTICAL resolve corrects a floating desired position to the nearest valid level', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-resolve' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 })],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData], 'a',
    { mode: 'resolve', desiredPosition: { x: 60, y: 30, z: 0 } });
  assert.equal(resolved.ok, true, 'a floating typed position must be correctable');
  assert.equal(resolved.corrected, true, 'the correction must be reported honestly');
  assert.equal(resolved.position.y, 5, 'the corrected level is the floor at the typed X/Z');
  assert.equal(resolved.position.x, 60, 'the typed X must be honored');
});

test('MANUAL-VERTICAL resolve honors a valid raised desired position exactly', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-raised' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'c', { x: 40, y: 5, z: 0 }),
    ],
  });

  const pack = PackLibrary.getById(packId);
  const resolved = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'c',
    { mode: 'resolve', desiredPosition: { x: 20, y: 15, z: 0 } });
  assert.equal(resolved.ok, true, 'a legal raised position must be accepted');
  assert.equal(resolved.corrected, false, 'no correction may be reported for a legal position');
  assert.equal(resolved.position.y, 15, 'the typed raised Y must be honored exactly');

  const nextCases = pack.cases.map(item =>
    item.id === 'c'
      ? { ...item, transform: { ...item.transform, position: resolved.position } }
      : item
  );
  const result = PackLibrary.updateCasesWithManualRevalidation(packId, nextCases, [caseData], {
    repairDependents: true,
  });
  const committed = result.pack.cases.find(inst => inst.id === 'c');
  assert.equal(committed.transform.position.y, 15, 'the raised placement must survive the commit');
  assert.equal(committed.placement, 'packed', 'the raised placement must stay packed');
  assert.deepEqual(result.adjustedIds, [], 'no case may be moved by a fully valid commit');
});

test('MANUAL-VERTICAL resolve rejects a desired position onto a no-stack case', async () => {
  const noStack = makeVerticalCase({ id: 'case-vertical-nostack-base', stackable: false });
  const caseData = makeVerticalCase({ id: 'case-vertical-mover' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [noStack, caseData],
    instances: [
      makeVerticalInstance(noStack.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'c', { x: 40, y: 5, z: 0 }),
    ],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [noStack, caseData], 'c',
    { mode: 'resolve', desiredPosition: { x: 20, y: 15, z: 0 } });
  assert.equal(resolved.ok, false,
    'resolve must never settle onto a case that cannot carry cargo');
  assert.equal(resolved.code, 'support-rules', 'the stacking rule must be named as the blocker');
});

test('MANUAL-VERTICAL staged candidate may become packed only through manual revalidation', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-stage-into-truck' });
  const noStack = makeVerticalCase({ id: 'case-vertical-stage-nostack', stackable: false });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData, noStack],
    instances: [
      makeVerticalInstance(noStack.id, 'no-top', { x: 40, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'staged-case', { x: 160, y: 5, z: 0 }, { placement: 'staged' }),
    ],
  });

  const pack = PackLibrary.getById(packId);
  const validCandidate = pack.cases.map(item =>
    item.id === 'staged-case'
      ? { ...item, transform: { ...item.transform, position: { x: 20, y: 5, z: 0 } }, placement: 'packed' }
      : item
  );
  const validPreflight = PackLibrary.revalidateManualPlacements(
    { ...pack, cases: validCandidate },
    [caseData, noStack],
    { repairDependents: true }
  );
  const validSelf = validPreflight.pack.cases.find(inst => inst.id === 'staged-case');
  assert.equal(validSelf.placement, 'packed', 'a staged case proposed at a valid truck floor pose may become packed');
  const committed = PackLibrary.updateCasesWithManualRevalidation(packId, validCandidate, [caseData, noStack], {
    repairDependents: true,
  });
  assert.equal(
    committed.pack.cases.find(inst => inst.id === 'staged-case').placement,
    'packed',
    'the final commit must still run through updateCasesWithManualRevalidation'
  );

  const { PackLibrary: BlockedPackLibrary, packId: blockedPackId } = await setupVerticalPack({
    cases: [caseData, noStack],
    truck: { ...RECT_TRUCK, length: 10, width: 10 },
    instances: [
      makeVerticalInstance(noStack.id, 'no-top', { x: 5, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'blocked-staged', { x: 40, y: 5, z: 0 }, { placement: 'staged' }),
    ],
    packId: 'pack-stage-blocked',
  });
  const blockedPack = BlockedPackLibrary.getById(blockedPackId);
  const invalidCandidate = blockedPack.cases.map(item =>
    item.id === 'blocked-staged'
      ? { ...item, transform: { ...item.transform, position: { x: 5, y: 15, z: 0 } }, placement: 'packed' }
      : item
  );
  const invalidPreflight = BlockedPackLibrary.revalidateManualPlacements(
    { ...blockedPack, cases: invalidCandidate },
    [caseData, noStack],
    { repairDependents: true }
  );
  assert.notEqual(
    invalidPreflight.pack.cases.find(inst => inst.id === 'blocked-staged').placement,
    'packed',
    'a staged case proposed onto a no-top-load support must not become packed'
  );

  const outsideCandidate = pack.cases.map(item =>
    item.id === 'staged-case'
      ? { ...item, transform: { ...item.transform, position: { x: 160, y: 5, z: 0 } }, placement: 'packed' }
      : item
  );
  const outsidePreflight = PackLibrary.revalidateManualPlacements(
    { ...pack, cases: outsideCandidate },
    [caseData, noStack],
    { repairDependents: true }
  );
  const outsideSelf = outsidePreflight.pack.cases.find(inst => inst.id === 'staged-case');
  assert.notEqual(
    outsideSelf.transform.position.x,
    160,
    'outside staged candidates are not accepted at the user drop X/Z by raw revalidation'
  );
});

test('MANUAL-VERTICAL wheel wells: drop lands on the rigid well top and never inside the blocked body', async () => {
  const caseData = makeVerticalCase({
    id: 'case-vertical-shelf',
    dimensions: { length: 20, width: 10, height: 10 },
  });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    truck: WHEEL_WELL_TRUCK,
    instances: [makeVerticalInstance(caseData.id, 'shelf-case', { x: 60, y: 45, z: 24 })],
  });

  const pack = PackLibrary.getById(packId);
  const dropped = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'shelf-case', { mode: 'drop' });
  assert.equal(dropped.ok, true, 'drop over the shelf must land on the rigid well top');
  assert.equal(dropped.toBottom, 20, 'the resting level must be the well height, never inside the body');

  const nextCases = pack.cases.map(item =>
    item.id === 'shelf-case'
      ? { ...item, transform: { ...item.transform, position: dropped.position } }
      : item
  );
  const result = PackLibrary.updateCasesWithManualRevalidation(packId, nextCases, [caseData], {
    repairDependents: true,
  });
  const committed = result.pack.cases.find(inst => inst.id === 'shelf-case');
  assert.equal(committed.transform.position.y, 25, 'the on-shelf pose must survive the commit');
  assert.equal(committed.placement, 'packed', 'the on-shelf pose must stay packed');

  const down = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData], 'shelf-case', { mode: 'down' });
  assert.equal(down.ok, false, 'the blocked well body must never offer a level inside it');
  assert.equal(down.code, 'no-level-below', 'moving down into the well body must be refused');
});

test('MANUAL-VERTICAL front overhang: deck placement without rear retention is rejected', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-deck' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    truck: FRONT_OVERHANG_TRUCK,
    instances: [makeVerticalInstance(caseData.id, 'mover', { x: 50, y: 5, z: 0 })],
  });

  const resolved = PackLibrary.findManualVerticalPlacement(
    PackLibrary.getById(packId), [caseData], 'mover',
    { mode: 'resolve', desiredPosition: { x: 110, y: 29, z: 0 } });
  assert.equal(resolved.ok, false, 'the unretained deck must reject cargo');
  assert.equal(resolved.code, 'needs-rear-retention', 'rear retention must be named as the blocker');
});

test('MANUAL-VERTICAL front overhang: deck placement with rear retention succeeds', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-deck-ok' });
  const retainerCase = makeVerticalCase({
    id: 'case-vertical-retainer',
    dimensions: { length: 20, width: 20, height: 30 },
    weight: 40,
  });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData, retainerCase],
    truck: FRONT_OVERHANG_TRUCK,
    instances: [
      makeVerticalInstance(retainerCase.id, 'retainer', { x: 90, y: 15, z: 0 }),
      makeVerticalInstance(caseData.id, 'mover', { x: 50, y: 5, z: 0 }),
    ],
  });

  const pack = PackLibrary.getById(packId);
  const resolved = PackLibrary.findManualVerticalPlacement(pack, [caseData, retainerCase], 'mover',
    { mode: 'resolve', desiredPosition: { x: 110, y: 29, z: 0 } });
  assert.equal(resolved.ok, true, 'a retained deck placement must be accepted');
  assert.equal(resolved.corrected, false, 'the typed deck position is already legal');

  const nextCases = pack.cases.map(item =>
    item.id === 'mover'
      ? { ...item, transform: { ...item.transform, position: resolved.position } }
      : item
  );
  const result = PackLibrary.updateCasesWithManualRevalidation(packId, nextCases, [caseData, retainerCase], {
    repairDependents: true,
  });
  const committed = result.pack.cases.find(inst => inst.id === 'mover');
  assert.equal(committed.transform.position.y, 29, 'the deck placement must survive the commit');
  assert.equal(committed.placement, 'packed', 'the deck placement must stay packed');
});

test('MANUAL-VERTICAL a validated raised placement survives revalidation unchanged', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-survive' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'c', { x: 20, y: 15, z: 0 }),
    ],
  });

  const revalidated = PackLibrary.revalidateManualPlacements(PackLibrary.getById(packId), [caseData]);
  assert.deepEqual(revalidated.adjustedIds, [], 'a valid raised placement must not be adjusted');
  assert.deepEqual(revalidated.stagedIds, [], 'a valid raised placement must not be staged');
  const kept = revalidated.pack.cases.find(inst => inst.id === 'c');
  assert.equal(kept.transform.position.y, 15, 'the raised Y must be kept exactly');
});

test('MANUAL-VERTICAL dependent cascade is reported when a support moves', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-cascade' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'b', { x: 20, y: 15, z: 0 }),
      makeVerticalInstance(caseData.id, 'c', { x: 20, y: 25, z: 0 }),
    ],
  });

  const pack = PackLibrary.getById(packId);
  const resolved = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'a', { mode: 'up' });
  assert.equal(resolved.ok, true, 'the bottom case must be liftable to the top of the stack');
  assert.equal(resolved.toBottom, 30, 'the first collision-free level above is the stack top');

  const nextCases = pack.cases.map(item =>
    item.id === 'a'
      ? { ...item, transform: { ...item.transform, position: resolved.position } }
      : item
  );
  const result = PackLibrary.updateCasesWithManualRevalidation(packId, nextCases, [caseData], {
    repairDependents: true,
  });
  const byId = new Map(result.pack.cases.map(inst => [inst.id, inst]));
  assert.equal(result.adjustedIds.includes('b'), true, 'dependent b adjustment must be reported');
  assert.equal(result.adjustedIds.includes('c'), true, 'dependent c adjustment must be reported');
  assert.deepEqual(result.stagedIds, [], 'a legal cascade must not stage anything');
  assert.equal(byId.get('b').transform.position.y, 5, 'b must re-settle to the floor');
  assert.equal(byId.get('c').transform.position.y, 15, 'c must re-settle onto b');
  assert.equal(byId.get('a').transform.position.y, 25, 'a must end above the re-settled stack');
  assert.equal(result.pack.cases.every(inst => inst.placement === 'packed'), true,
    'the cascaded stack must stay fully packed');
});

test('MANUAL-VERTICAL staged cases and invalid selections fail safely', async () => {
  const caseData = makeVerticalCase({ id: 'case-vertical-guard' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'packed-case', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'staged-case', { x: 160, y: 5, z: 0 }, { placement: 'staged' }),
    ],
  });

  const pack = PackLibrary.getById(packId);
  const staged = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'staged-case', { mode: 'up' });
  assert.equal(staged.ok, false, 'staged cases must be refused');
  assert.equal(staged.code, 'staged-case', 'the staged state must be named');
  const missing = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'nope', { mode: 'up' });
  assert.equal(missing.code, 'invalid-selection', 'unknown instances must fail safely');
  const badMode = PackLibrary.findManualVerticalPlacement(pack, [caseData], 'packed-case', { mode: 'sideways' });
  assert.equal(badMode.code, 'invalid-selection', 'unsupported modes must fail safely');
});

test('MANUAL-GROUP legal floor and stacked moves preserve exact rigid offsets', async () => {
  const caseData = makeVerticalCase({ id: 'case-group-rigid' });
  const instances = [
    makeVerticalInstance(caseData.id, 'floor-a', { x: 20, y: 5, z: -10 }),
    makeVerticalInstance(caseData.id, 'floor-b', { x: 20, y: 5, z: 10 }),
    makeVerticalInstance(caseData.id, 'stack-base', { x: 50, y: 5, z: 0 }),
    makeVerticalInstance(caseData.id, 'stack-child', { x: 50, y: 15, z: 0 }),
  ];
  const { PackLibrary, packId } = await setupVerticalPack({ cases: [caseData], instances });
  const EditorScreen = await loadEditorScreenModule();
  const pack = PackLibrary.getById(packId);
  const movedIds = ['floor-a', 'floor-b', 'stack-base', 'stack-child'];
  const proposed = pack.cases.map(inst => {
    if (!movedIds.includes(inst.id)) return inst;
    return {
      ...inst,
      transform: {
        ...inst.transform,
        position: { ...inst.transform.position, x: inst.transform.position.x + 30 },
      },
    };
  });
  const preflight = PackLibrary.revalidateManualPlacements(
    { ...pack, cases: proposed },
    [caseData],
    { repairDependents: true }
  );

  assert.deepEqual(EditorScreen.validateAtomicManualGroupResult(proposed, preflight, movedIds), { ok: true },
    'a legal rigid group move must survive preflight without selected-case correction');
  const validatedById = new Map(preflight.pack.cases.map(inst => [inst.id, inst]));
  movedIds.forEach(id => {
    const expected = proposed.find(inst => inst.id === id).transform.position;
    assert.deepEqual(validatedById.get(id).transform.position, expected, `${id} must keep its exact proposed pose`);
  });
  assert.equal(
    validatedById.get('stack-child').transform.position.y - validatedById.get('stack-base').transform.position.y,
    10,
    'a selected stack must not reorder, climb, or self-settle'
  );
});

test('MANUAL-GROUP cargo and selected-sibling overlaps fail atomic preflight', async () => {
  const caseData = makeVerticalCase({ id: 'case-group-overlap' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'obstacle', { x: 60, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'selected-a', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'selected-b', { x: 40, y: 5, z: 0 }),
    ],
  });
  const EditorScreen = await loadEditorScreenModule();
  const pack = PackLibrary.getById(packId);
  const movedIds = ['selected-a', 'selected-b'];

  const cargoOverlap = pack.cases.map(inst => {
    if (inst.id === 'selected-a') {
      return { ...inst, transform: { ...inst.transform, position: { x: 60, y: 5, z: 0 } } };
    }
    if (inst.id === 'selected-b') {
      return { ...inst, transform: { ...inst.transform, position: { x: 80, y: 5, z: 0 } } };
    }
    return inst;
  });
  const cargoResult = PackLibrary.revalidateManualPlacements(
    { ...pack, cases: cargoOverlap },
    [caseData],
    { repairDependents: true }
  );
  assert.equal(EditorScreen.validateAtomicManualGroupResult(cargoOverlap, cargoResult, movedIds).ok, false,
    'a selected case corrected away from non-selected cargo must reject the whole group');

  const siblingOverlap = pack.cases.map(inst => movedIds.includes(inst.id)
    ? { ...inst, transform: { ...inst.transform, position: { x: 90, y: 5, z: 0 } } }
    : inst);
  const siblingResult = PackLibrary.revalidateManualPlacements(
    { ...pack, cases: siblingOverlap },
    [caseData],
    { repairDependents: true }
  );
  assert.equal(EditorScreen.validateAtomicManualGroupResult(siblingOverlap, siblingResult, movedIds).ok, false,
    'selected siblings that require separation must reject atomically');
});

test('MANUAL-GROUP Front Overhang cab void cannot survive as staged data', async () => {
  const caseData = makeVerticalCase({ id: 'case-group-cab' });
  const proposed = [
    makeVerticalInstance(caseData.id, 'cab-case', { x: 115, y: 5, z: 0 }, { placement: 'staged' }),
    makeVerticalInstance(caseData.id, 'outside-case', { x: 30, y: 5, z: 50 }, { placement: 'staged' }),
  ];
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: proposed,
    truck: FRONT_OVERHANG_TRUCK,
  });
  const EditorScreen = await loadEditorScreenModule();
  const pack = PackLibrary.getById(packId);
  const cabAabb = {
    min: { x: 110, y: 0, z: -5 },
    max: { x: 120, y: 10, z: 5 },
  };
  assert.equal(PackLibrary.aabbIntersectsFrontBonusBlockedBody(cabAabb, FRONT_OVERHANG_TRUCK), true,
    'the staged candidate must intersect the canonical cab-void blocked body');

  const preflight = PackLibrary.revalidateManualPlacements(pack, [caseData], { repairDependents: true });
  const cabCase = preflight.pack.cases.find(inst => inst.id === 'cab-case');
  const repairedCabAabb = {
    min: { x: cabCase.transform.position.x - 5, y: cabCase.transform.position.y - 5, z: cabCase.transform.position.z - 5 },
    max: { x: cabCase.transform.position.x + 5, y: cabCase.transform.position.y + 5, z: cabCase.transform.position.z + 5 },
  };
  assert.equal(PackLibrary.aabbIntersectsFrontBonusBlockedBody(repairedCabAabb, FRONT_OVERHANG_TRUCK), false,
    'revalidation must move staged cargo out of the cab void');
  assert.notDeepEqual(cabCase.transform.position, proposed[0].transform.position,
    'the illegal staged cab-void transform must not be preserved');
  assert.equal(EditorScreen.validateAtomicManualGroupResult(pack.cases, preflight, ['cab-case', 'outside-case']).ok, false,
    'a group preflight must reject when cab-void repair changes a selected transform');

  PackLibrary.updateCasesWithManualRevalidation(packId, pack.cases, [caseData], { repairDependents: true });
  const persistedCabCase = PackLibrary.getById(packId).cases.find(inst => inst.id === 'cab-case');
  const persistedCabAabb = {
    min: { x: persistedCabCase.transform.position.x - 5, y: persistedCabCase.transform.position.y - 5, z: persistedCabCase.transform.position.z - 5 },
    max: { x: persistedCabCase.transform.position.x + 5, y: persistedCabCase.transform.position.y + 5, z: persistedCabCase.transform.position.z + 5 },
  };
  assert.equal(PackLibrary.aabbIntersectsFrontBonusBlockedBody(persistedCabAabb, FRONT_OVERHANG_TRUCK), false,
    'the committed pack state must not retain a staged transform in the cab void');
});

test('MANUAL-GROUP Wheel Wells blocked body rejects while legal channel and top poses remain exact', async () => {
  const caseData = makeVerticalCase({ id: 'case-group-wheel' });
  const blockedGroup = [
    makeVerticalInstance(caseData.id, 'blocked', { x: 50, y: 5, z: 24 }, { placement: 'staged' }),
    makeVerticalInstance(caseData.id, 'outside', { x: 20, y: 5, z: 50 }, { placement: 'staged' }),
  ];
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: blockedGroup,
    truck: WHEEL_WELL_TRUCK,
  });
  const EditorScreen = await loadEditorScreenModule();
  const blockedPack = PackLibrary.getById(packId);
  const blockedResult = PackLibrary.revalidateManualPlacements(blockedPack, [caseData], { repairDependents: true });
  assert.equal(EditorScreen.validateAtomicManualGroupResult(
    blockedPack.cases,
    blockedResult,
    ['blocked', 'outside']
  ).ok, false, 'a selected Wheel Wells blocked-body pose must reject atomically');

  const legalCases = [
    makeVerticalInstance(caseData.id, 'channel', { x: 50, y: 5, z: 0 }),
    makeVerticalInstance(caseData.id, 'well-top', { x: 50, y: 25, z: 24 }),
  ];
  const legalResult = PackLibrary.revalidateManualPlacements(
    { ...blockedPack, cases: legalCases },
    [caseData],
    { repairDependents: true }
  );
  assert.deepEqual(EditorScreen.validateAtomicManualGroupResult(
    legalCases,
    legalResult,
    ['channel', 'well-top']
  ), { ok: true }, 'legal Wheel Wells channel and rigid-top placements must remain accepted');
});

test('MANUAL-GROUP legal outside-truck staging preserves the selected poses', async () => {
  const caseData = makeVerticalCase({ id: 'case-group-staging' });
  const stagedCases = [
    makeVerticalInstance(caseData.id, 'staged-a', { x: 20, y: 5, z: 50 }, { placement: 'staged' }),
    makeVerticalInstance(caseData.id, 'staged-b', { x: 40, y: 5, z: 50 }, { placement: 'staged' }),
  ];
  const { PackLibrary, packId } = await setupVerticalPack({ cases: [caseData], instances: stagedCases });
  const EditorScreen = await loadEditorScreenModule();
  const pack = PackLibrary.getById(packId);
  const result = PackLibrary.revalidateManualPlacements(pack, [caseData], { repairDependents: true });

  assert.deepEqual(EditorScreen.validateAtomicManualGroupResult(
    pack.cases,
    result,
    ['staged-a', 'staged-b']
  ), { ok: true }, 'non-colliding floor-normalized staging poses must remain legal');
  assert.deepEqual(result.pack.cases.map(inst => inst.transform.position), stagedCases.map(inst => inst.transform.position),
    'legal outside-truck staging must keep exact group offsets');
});

test('MANUAL-GROUP accepted support move reports non-selected dependent repair honestly', async () => {
  const caseData = makeVerticalCase({ id: 'case-group-message' });
  const { PackLibrary, packId } = await setupVerticalPack({
    cases: [caseData],
    instances: [
      makeVerticalInstance(caseData.id, 'selected-support', { x: 20, y: 5, z: 0 }),
      makeVerticalInstance(caseData.id, 'dependent', { x: 20, y: 15, z: 0 }),
      makeVerticalInstance(caseData.id, 'selected-peer', { x: 40, y: 5, z: 0 }),
    ],
  });
  const EditorScreen = await loadEditorScreenModule();
  const pack = PackLibrary.getById(packId);
  const movedIds = ['selected-support', 'selected-peer'];
  const proposed = pack.cases.map(inst => {
    if (inst.id === 'selected-support') {
      return { ...inst, transform: { ...inst.transform, position: { x: 70, y: 5, z: 0 } } };
    }
    if (inst.id === 'selected-peer') {
      return { ...inst, transform: { ...inst.transform, position: { x: 90, y: 5, z: 0 } } };
    }
    return inst;
  });
  const result = PackLibrary.revalidateManualPlacements(
    { ...pack, cases: proposed },
    [caseData],
    { repairDependents: true }
  );

  assert.deepEqual(EditorScreen.validateAtomicManualGroupResult(proposed, result, movedIds), { ok: true },
    'dependent repair must not invalidate an otherwise exact selected group');
  assert.equal(result.adjustedIds.includes('dependent'), true,
    'the non-selected dependent must be reported as adjusted');
  assert.match(
    EditorScreen.formatManualGroupMoveMessage(result, movedIds, 'Placed 2 cases.'),
    /1 nearby case was re-settled\./,
    'group outcome copy must disclose the non-selected dependent repair'
  );
  assert.match(
    EditorScreen.formatManualGroupMoveMessage({ stagedIds: ['dependent'] }, movedIds, 'Placed 2 cases.'),
    /1 dependent case was moved to staging because its support changed\./,
    'group outcome copy must disclose a non-selected dependent staged by revalidation'
  );
});

test('MANUAL-GROUP swept AABB detects tunneling while allowing exact contact', async () => {
  const EditorScreen = await loadEditorScreenModule();
  const movingStart = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 10, y: 10, z: 10 },
  };
  const movingEnd = {
    min: { x: 30, y: 0, z: 0 },
    max: { x: 40, y: 10, z: 10 },
  };
  const crossedObstacle = {
    min: { x: 15, y: 0, z: 0 },
    max: { x: 25, y: 10, z: 10 },
  };
  const crossingTime = EditorScreen.getSweptAabbCollisionTime(
    movingStart,
    movingEnd,
    crossedObstacle
  );
  assert.equal(Number.isFinite(crossingTime), true,
    'a clear start and clear endpoint must still detect an obstacle crossed between pointer events');
  assert.ok(crossingTime > 0 && crossingTime < 1,
    'the swept hit must occur inside the movement segment');

  const tangentObstacle = {
    min: { x: 15, y: 10, z: 0 },
    max: { x: 25, y: 20, z: 10 },
  };
  assert.equal(
    EditorScreen.getSweptAabbCollisionTime(movingStart, movingEnd, tangentObstacle),
    null,
    'moving with exact face contact must remain legal'
  );

  const awayEnd = {
    min: { x: -20, y: 0, z: 0 },
    max: { x: -10, y: 10, z: 10 },
  };
  const touchingObstacle = {
    min: { x: 10, y: 0, z: 0 },
    max: { x: 20, y: 10, z: 10 },
  };
  assert.equal(
    EditorScreen.getSweptAabbCollisionTime(movingStart, awayEnd, touchingObstacle),
    null,
    'a box touching an obstacle must still be able to move away'
  );
});

test('MANUAL-GROUP surface following applies the greatest required lift to every member', async () => {
  const EditorScreen = await loadEditorScreenModule();
  const halfWorld = { x: 5, y: 5, z: 5 };
  const members = [
    { id: 'left', start: { x: 0, y: 5, z: 0 }, halfWorld },
    { id: 'right', start: { x: 20, y: 5, z: 0 }, halfWorld },
  ];
  const surfaces = [
    { kind: 'truck-floor', min: { x: -100, z: -100 }, max: { x: 100, z: 100 }, topY: 0 },
    { kind: 'box-top', min: { x: 25, z: -5 }, max: { x: 35, z: 5 }, topY: 20 },
  ];
  const preview = EditorScreen.computeRigidGroupSurfaceFollowingDelta({
    members,
    surfaces,
    deltaX: 10,
    deltaZ: 0,
    minOverlapFraction: 0.02,
  });

  assert.equal(preview.ok, true, 'a valid rigid group must produce a shared preview delta');
  assert.equal(preview.deltaY, 20,
    'the member over the 20-unit box top must lift the entire group by 20 units');
  assert.deepEqual(
    members.map(member => member.start.y + preview.deltaY),
    [25, 25],
    'every member must receive exactly the same Y delta'
  );
});

test('MANUAL-GROUP surface following preserves a selected vertical stack as one rigid shape', async () => {
  const EditorScreen = await loadEditorScreenModule();
  const halfWorld = { x: 5, y: 5, z: 5 };
  const members = [
    { id: 'base', start: { x: 0, y: 5, z: 0 }, halfWorld },
    { id: 'child', start: { x: 0, y: 15, z: 0 }, halfWorld },
  ];
  const preview = EditorScreen.computeRigidGroupSurfaceFollowingDelta({
    members,
    surfaces: [
      { kind: 'truck-floor', min: { x: -100, z: -100 }, max: { x: 100, z: 100 }, topY: 0 },
      { kind: 'wheel-well-top', min: { x: 5, z: -5 }, max: { x: 15, z: 5 }, topY: 10 },
    ],
    deltaX: 10,
    deltaZ: 0,
    minOverlapFraction: 0.02,
  });
  const nextBaseY = members[0].start.y + preview.deltaY;
  const nextChildY = members[1].start.y + preview.deltaY;

  assert.equal(preview.deltaY, 10, 'the base must rise onto the wheel-well top');
  assert.equal(nextChildY - nextBaseY, 10,
    'the selected child must keep its exact vertical offset instead of settling independently');
});

test('MANUAL-GROUP surface following lifts across cargo between clear pointer endpoints', async () => {
  const EditorScreen = await loadEditorScreenModule();
  const halfWorld = { x: 5, y: 5, z: 5 };
  const preview = EditorScreen.computeRigidGroupSurfaceFollowingDelta({
    members: [
      { id: 'a', start: { x: 0, y: 5, z: 0 }, halfWorld },
      { id: 'b', start: { x: 20, y: 5, z: 0 }, halfWorld },
    ],
    surfaces: [
      { kind: 'truck-floor', min: { x: -100, z: -100 }, max: { x: 100, z: 100 }, topY: 0 },
      { kind: 'box-top', min: { x: 30, z: -5 }, max: { x: 40, z: 5 }, topY: 20 },
    ],
    fromDeltaX: 0,
    fromDeltaZ: 0,
    deltaX: 60,
    deltaZ: 0,
    minOverlapFraction: 0.02,
  });

  assert.equal(preview.deltaY, 20,
    'a clear endpoint beyond cargo must still lift the group over the crossed box top');
});

// V2A keyboard precision movement: the editor keyboard map must route vertical
// shortcuts through the validated moveSelectionVertical path and use a
// step-aware X/Z nudge instead of the removed raw Shift Y-nudge.
test('MANUAL-VERTICAL keyboard map routes Alt arrows to validated vertical moves with step-aware nudges', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function onKeyDown(ev)');
  const end = src.indexOf('function onMove(ev)', start);
  assert.ok(start >= 0 && end > start, 'onKeyDown block must exist before onMove');
  const block = src.slice(start, end);

  assert.match(block, /const nudge = ev\.shiftKey \? 6 : 1/,
    'arrow nudges must use a 1-inch step and a 6-inch Shift coarse step');
  assert.doesNotMatch(block, /nudgeSelection\('y'/,
    'the raw keyboard Y-nudge must stay removed; vertical moves go through validation');
  assert.match(block, /if \(ev\.altKey\) \{ moveSelectionVertical\('up'\); \}/,
    'Alt+ArrowUp must trigger the validated Move Up');
  assert.match(block, /if \(ev\.altKey\) \{ moveSelectionVertical\(ev\.shiftKey \? 'drop' : 'down'\); \}/,
    'Alt+ArrowDown must trigger Move Down and Alt+Shift+ArrowDown must trigger Drop');
  assert.match(block, /case 'ArrowLeft':\s*\n\s*nudgeSelection\('z', -nudge\)/,
    'ArrowLeft must nudge Z with the step-aware delta');
  assert.match(block, /case 'ArrowRight':\s*\n\s*nudgeSelection\('z', nudge\)/,
    'ArrowRight must nudge Z with the step-aware delta');
});

test('MANUAL-VERTICAL vertical placement buttons expose keyboard shortcut hints', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /Move up to the next valid level \(Alt\+↑\)/,
    'the Up button must advertise its shortcut');
  assert.match(src, /Move down to the next valid level \(Alt\+↓\)/,
    'the Down button must advertise its shortcut');
  assert.match(src, /Drop to nearest valid surface \(Alt\+Shift\+↓\)/,
    'the Drop button must advertise its shortcut');
  assert.match(src, /btn\.title = hint;/,
    'shortcut hints must be native title tooltips on the vertical buttons');
});

// V2B validated drag release: a single packed case must release through the
// validated resolve path with dependent repair and honest outcome toasts.
// Fix C: a single staged case may preflight as packed through manual
// revalidation. Multi-select uses a separate atomic group preflight, while a
// single out-of-truck release keeps the legacy settle/staging path.
test('MANUAL-VERTICAL drag release for a single packed case resolves through validated placement', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishDrag()');
  const end = src.indexOf('\n\n    function resetDrag()', start);
  assert.ok(start >= 0 && end > start, 'finishDrag block must exist');
  const block = src.slice(start, end);

  assert.match(block, /const singleDraggedInst = groupIds\.length === 1/,
    'the validated release branch must be gated to a single dragged case');
  assert.match(block, /singleDraggedInst\.placement !== 'staged'/,
    'the existing packed-case resolver must stay limited to packed cases');
  assert.match(block, /mode: 'resolve',\s*\n\s*desiredPosition: SceneManager\.vecWorldToInches\(obj\.position\)/,
    'release must resolve the dragged position through findManualVerticalPlacement');
  assert.match(block, /updateCasesWithManualRevalidation\(packId, nextCases, CaseLibrary\.getCases\(\), \{\s*\n\s*repairDependents: true,/,
    'the validated release must commit with dependent repair');
  assert.match(block, /formatVerticalMoveMessage\(result, instanceId/,
    'release toasts must report the actual post-commit outcome');
  assert.match(block, /result\.stagedIds\.includes\(instanceId\)/,
    'a release that ends staged must never claim a plain success');
  assert.match(block, /revertGroupToStart\(groupIds, startMap\);\s*\n\s*UIComponents\.showToast\(resolved\.reason/,
    'non-surface-following rule-blocked releases must still revert with the blocking reason');
  assert.match(block, /resolved\.code !== 'outside-truck' && resolved\.code !== 'invalid-selection'/,
    'out-of-truck releases must fall through to the legacy staging path');
  assert.match(block, /singleDraggedInst && singleDraggedInst\.placement === 'staged' &&\s*\n\s*tryCommitStagedIntoTruck\(packId, pack, singleDraggedInst, obj, groupIds, startMap\)/,
    'a single staged release must get a narrow staged-to-packed transition path before legacy staging');
  assert.match(src, /function tryCommitStagedIntoTruck\(packId, pack, inst, obj, groupIds, startMap\) \{[\s\S]*PackLibrary\.revalidateManualPlacements\(\s*\n\s*\{ \.\.\.pack, cases: candidateCases \},\s*\n\s*CaseLibrary\.getCases\(\),\s*\n\s*\{ repairDependents: true \}/,
    'staged-to-packed preflight must use pure manual revalidation with dependent repair');
  assert.match(src, /PackLibrary\.updateCasesWithManualRevalidation\(\s*\n\s*packId,\s*\n\s*candidateCases,\s*\n\s*CaseLibrary\.getCases\(\),\s*\n\s*\{ repairDependents: true \}/,
    'accepted staged-to-packed releases must still commit through manual revalidation with dependent repair');
  assert.match(src, /preflightSelf\.placement === 'packed' &&[\s\S]*positionsShareManualXZ\(preflightSelf\.transform\.position, desiredPosition\)/,
    'staged-to-packed acceptance must reject self-repairs that change the dragged case X/Z');
  assert.match(src, /stagedCandidateIsInsideUsableTruckZone\(pack, inst, desiredPosition\)[\s\S]*Cannot place this staged case in the truck safely/,
    'inside-truck staged candidates rejected by hard rules must not fall through as successful placements');
  assert.match(src, /if \(stagedCandidateIsInsideUsableTruckZone\(pack, inst, desiredPosition\)\) \{[\s\S]*return true;\s*\n\s*\}\s*\n\s*return false;/,
    'outside-truck staged candidates must fall through to the legacy staged release path');
  assert.match(block, /groupIds\.length > 1 && tryCommitAtomicManualGroup\(packId, pack, groupIds, startMap\)/,
    'multi-select release must route through the atomic group preflight');
  assert.ok(
    block.indexOf('tryCommitAtomicManualGroup(packId, pack, groupIds, startMap)') < block.indexOf('CaseScene.settleY(id)'),
    'atomic multi-select handling must run before the legacy single-case settle path'
  );
  // The legacy path remains only for a single out-of-truck release.
  assert.match(block, /CaseScene\.settleY\(id\)/,
    'the legacy settle path must remain for a single out-of-truck release');
  assert.match(block, /isAabbContainedInAnyZone\(aabb, zonesInches\) \? 'packed' : 'staged'/,
    'legacy zone-containment placement classification must remain unchanged');
  assert.match(block, /placementValue === 'staged'[\s\S]*finalPos = \{ \.\.\.pos, y: Math\.max\(0, halfY\) \};/,
    'single staged releases that remain staged must not persist elevated staged Y');
});

test('MANUAL-GROUP editor release preflights atomically, repairs dependents, and warns the whole selection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const atomicStart = src.indexOf('function tryCommitAtomicManualGroup(');
  const atomicEnd = src.indexOf('\n\n    function applyInstancePatches', atomicStart);
  assert.ok(atomicStart >= 0 && atomicEnd > atomicStart, 'atomic manual group commit helper must exist');
  const atomicBlock = src.slice(atomicStart, atomicEnd);

  assert.match(atomicBlock, /PackLibrary\.revalidateManualPlacements\([\s\S]*\{ repairDependents: true \}/,
    'group placement must run a pure preflight with dependent repair enabled');
  assert.match(atomicBlock, /validateAtomicManualGroupResult\(candidate\.cases, preflight, groupIds\)/,
    'preflight must require exact selected-case transforms and placement states');
  assert.match(atomicBlock, /if \(!atomicResult\.ok[\s\S]*revertAtomicManualGroup\(/,
    'any selected correction must revert the visible group before persistence');
  assert.match(atomicBlock, /commitCasesWithManualRevalidation\(packId, candidate\.cases, \{ repairDependents: true \}\)/,
    'an accepted group must commit with dependent repair enabled');
  assert.match(atomicBlock, /formatManualGroupMoveMessage\(result, groupIds, baseMessage\)/,
    'the accepted outcome must report non-selected repaired or staged cargo');

  const dragStart = src.indexOf('function updateDrag(ev)');
  const dragEnd = src.indexOf('function revertGroupToStart', dragStart);
  const dragBlock = src.slice(dragStart, dragEnd);
  assert.match(dragBlock, /const anyCollides = applyDragCandidates\(groupIds, candidates, ignoreSet\);/,
    'Alt group drag must keep the conservative swept live-preview guard');
  assert.match(dragBlock, /applyDragCandidates\(groupIds, candidates, ignoreSet, \{[\s\S]*sweep: !\(groupIds\.length > 1 && surfaceFollowingDrag\)/,
    'normal rigid surface-following must use endpoint collision checks after lifting onto terrain');

  const applyStart = src.indexOf('function applyDragCandidates(groupIds, candidates, ignoreSet, options = {})');
  const applyEnd = src.indexOf('\n\n    function startDrag()', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, 'atomic live-preview helper must exist');
  const applyBlock = src.slice(applyStart, applyEnd);
  assert.match(applyBlock, /CaseScene\.checkSweptCollision\(id, accepted, candidate, ignoreSet\)/,
    'non-surface-following group movement must retain swept collision protection');
  assert.match(applyBlock, /options\.sweep !== false[\s\S]*CaseScene\.checkCollision\(id, candidate, ignoreSet\)/,
    'rigid terrain following must still reject true endpoint overlaps');
  assert.match(applyBlock, /if \(!blocked\) \{[\s\S]*obj\.position\.copy\(candidate\)/,
    'multi-select meshes must advance only when the entire rigid candidate is clear');
  assert.match(applyBlock, /dragGroupPreviewBlocked = blocked;/,
    'the release path must know when the pointer remains over an invalid candidate');

  const finishStart = src.indexOf('function finishDrag()');
  const finishEnd = src.indexOf('\n\n    function resetDrag()', finishStart);
  const finishBlock = src.slice(finishStart, finishEnd);
  assert.match(finishBlock, /groupIds\.length > 1 && dragGroupPreviewBlocked[\s\S]*revertGroupToStart\(groupIds, startMap\)/,
    'releasing while the live group candidate is blocked must revert the whole selection');
  assert.match(finishBlock, /if \(anyCollides && groupIds\.length === 1\)/,
    'raw scene overlap must not outrank tolerant atomic revalidation for a near-flush group');

  const collisionStart = src.indexOf('function checkCollision(instanceId, candidateWorldPos, ignoreIds)');
  const collisionEnd = src.indexOf('\n\n    function getBlockedAabbsWorld()', collisionStart);
  const collisionBlock = src.slice(collisionStart, collisionEnd);
  assert.match(collisionBlock, /intersectsWheelWellBlockedBody\(aabb\) \|\| intersectsFrontOverhangCabVoid\(aabb\)/,
    'live collision must treat both Wheel Wells bodies and the Front Overhang cab void as hard blocked volumes');

  const sweptStart = src.indexOf('function getBlockedAabbsWorld()');
  const sweptEnd = src.indexOf('\n\n    /**', sweptStart);
  const sweptBlock = src.slice(sweptStart, sweptEnd);
  assert.match(sweptBlock, /PackLibrary\.getWheelWellsBlockedZones\(truck\)/,
    'swept preview must include canonical Wheel Wells blocked bodies');
  assert.match(sweptBlock, /PackLibrary\.getFrontBonusBlockedZones\(truck\)/,
    'swept preview must include the canonical Front Overhang cab void');

  const surfaceStart = src.indexOf('function getSurfaceFollowingPreviewSurfaces(instanceId, ignoreIds)');
  const surfaceEnd = src.indexOf('\n\n    function getSurfaceFollowingPreview(', surfaceStart);
  const surfaceBlock = src.slice(surfaceStart, surfaceEnd);
  assert.match(surfaceBlock, /if \(ignoreSet && ignoreSet\.has\(otherId\)\) continue;/,
    'selected siblings must be excluded from the group terrain surface set');
  assert.match(src, /function getRigidGroupSurfaceFollowingPreview\([\s\S]*computeRigidGroupSurfaceFollowingDelta\([\s\S]*surfaces: getSurfaceFollowingPreviewSurfaces\(null, ignoreSet\)/,
    'group terrain preview must sample all members against one shared non-selected surface set');
  assert.match(src, /fromDeltaX[\s\S]*fromDeltaZ[\s\S]*getRigidGroupSurfaceFollowingPreview\(/,
    'normal group drag must carry its last accepted horizontal delta into terrain crossing checks');
});

test('MANUAL-VERTICAL alt-drag shows a throttled release-outcome preview for a single packed case', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function updateDrag(ev)');
  const end = src.indexOf('function revertGroupToStart', start);
  assert.ok(start >= 0 && end > start, 'updateDrag block must exist');
  const block = src.slice(start, end);

  assert.match(block, /DRAG_PREVIEW_THROTTLE_MS/,
    'the alt-drag validity preview must be throttled');
  assert.match(block, /groupIds\.length === 1 && !anyCollides/,
    'the preview must be limited to a single non-colliding dragged case');
  assert.match(block, /previewInst\.placement !== 'staged'/,
    'staged-case drags must not run the packed-placement preview');
  assert.match(block, /!resolved\.ok && resolved\.code !== 'outside-truck'/,
    'staging-bound drags must not be flagged invalid by the preview');
});

test('MANUAL-VERTICAL empty orbit drag preserves selection and pending pose', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /const CLICK_DRAG_THRESHOLD_PX = 3;/,
    'empty orbit classification must share the existing click-vs-drag threshold');

  const moveStart = src.indexOf('function onMove(ev)');
  const moveEnd = src.indexOf('\n\n    function onDown(ev)', moveStart);
  assert.ok(moveStart >= 0 && moveEnd > moveStart, 'onMove block must exist');
  const moveBlock = src.slice(moveStart, moveEnd);
  assert.match(moveBlock, /Math\.hypot\(dx, dy\) > CLICK_DRAG_THRESHOLD_PX\) startDrag\(\);/,
    'case drag start must keep using the shared movement threshold');

  const upStart = src.indexOf('function onUp(ev)');
  const upEnd = src.indexOf('\n\n    /**\n     * V3A vertical gizmo drag', upStart);
  assert.ok(upStart >= 0 && upEnd > upStart, 'onUp block must accept the pointerup event');
  const upBlock = src.slice(upStart, upEnd);
  const emptyStart = upBlock.indexOf('if (!pressed.instanceId)');
  const emptyEnd = upBlock.indexOf('const current = getSelection()', emptyStart);
  assert.ok(emptyStart >= 0 && emptyEnd > emptyStart, 'empty click/orbit branch must exist');
  const emptyBlock = upBlock.slice(emptyStart, emptyEnd);

  assert.match(emptyBlock, /const dx = ev && Number\.isFinite\(ev\.clientX\) \? ev\.clientX - pressed\.clientX : 0;/,
    'empty pointerup must compare the release point to the original empty press');
  assert.match(emptyBlock, /if \(Math\.hypot\(dx, dy\) > CLICK_DRAG_THRESHOLD_PX\) \{\s*\n\s*pressed = null;\s*\n\s*return;\s*\n\s*\}/,
    'empty orbit drags must clear only the transient press and return');
  const orbitStart = emptyBlock.indexOf('if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX)');
  const clickStart = emptyBlock.indexOf('if (!pressed.shift)', orbitStart);
  assert.ok(orbitStart >= 0 && clickStart > orbitStart, 'orbit branch must precede empty-click deselect');
  const orbitBlock = emptyBlock.slice(orbitStart, clickStart);
  assert.equal(orbitBlock.includes('setSelection('), false,
    'empty orbit drag must not clear selection');
  assert.equal(orbitBlock.includes('cancelPendingPose'), false,
    'empty orbit drag must not cancel a pending manual pose');
  assert.match(emptyBlock, /if \(!pressed\.shift\) setSelection\(\[\]\);/,
    'empty click below the threshold must keep the existing deselect behavior');
});

// V3A vertical gizmo handle: pure scale helper + source-slice contracts for
// pointer routing, attach gating, and release-path reuse. No pixel testing.
test('MANUAL-VERTICAL computeGizmoScale keeps the handle usable across the zoom range', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('export function computeGizmoScale');
  assert.ok(start >= 0, 'computeGizmoScale must be exported for unit testing');
  const end = src.indexOf('\n}', start) + 2;
  const computeGizmoScale = new Function(
    `${src.slice(start, end).replace('export ', '')}; return computeGizmoScale;`
  )();
  assert.equal(computeGizmoScale(0), 0.35, 'scale must clamp at the close-zoom minimum');
  assert.equal(computeGizmoScale(1000), 3.5, 'scale must clamp at the far-zoom maximum');
  assert.ok(Math.abs(computeGizmoScale(40) - 1.8) < 1e-9, 'scale must grow linearly in the working range');
  assert.equal(computeGizmoScale(NaN), 0.35, 'non-finite distances must fall back to the minimum');
});

test('MANUAL-VERTICAL gizmo handles take raycast priority and attach to one live case by mode', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const downStart = src.indexOf('function onDown(ev)');
  const downEnd = src.indexOf('function onUp(ev)', downStart);
  assert.ok(downStart >= 0 && downEnd > downStart, 'onDown block must exist');
  const downBlock = src.slice(downStart, downEnd);
  const gizmoIdx = downBlock.indexOf('beginGizmoDrag()');
  const caseIdx = downBlock.indexOf('raycastFirst()');
  assert.ok(gizmoIdx >= 0 && caseIdx > gizmoIdx,
    'pointer-down must test gizmo handles before case picking');

  const refreshStart = src.indexOf('function refreshGizmo()');
  const refreshEnd = src.indexOf('function detachGizmo()', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'refreshGizmo block must exist');
  const refreshBlock = src.slice(refreshStart, refreshEnd);
  assert.match(refreshBlock, /ids\.length === 1 && instances\.has\(ids\[0\]\)/,
    'the gizmo must require exactly one selected, live case');
  assert.match(refreshBlock, /targetMode = inst\.placement === 'staged' \? 'staged' : 'packed';/,
    'the gizmo must attach staged cases in limited staged mode and packed cases in full mode');
  assert.match(refreshBlock, /gizmoTargetMode = targetMode;/,
    'the selected case mode must be stored with the gizmo target');
  assert.match(src, /function getGizmoTargetMode\(\) \{\s*\n\s*return gizmoTargetMode;\s*\n\s*\}/,
    'InteractionManager must be able to distinguish packed and staged gizmo targets');
  assert.match(src, /gizmoTargetMode = null;\s*\n\s*if \(gizmoGroup\) gizmoGroup\.visible = false;/,
    'detaching the gizmo must clear staged/packed mode');
  assert.match(refreshBlock, /detachGizmo\(\);/,
    'no selection, multi-select, or removed cases must detach the gizmo');
  assert.match(src, /applyHover\(hoveredId\);\s*\n\s*refreshGizmo\(\);\s*\n\s*\}/,
    'setSelected must refresh the gizmo on selection changes');
  assert.match(src, /applyDragging\(draggedId\);\s*\n\s*refreshGizmo\(\);/,
    'scene sync must refresh the gizmo after pack mutations');
});

test('MANUAL-VERTICAL staged gizmo uses the legacy staged drag release and keeps staged Y non-persistent', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishGizmoDrag()');
  const end = src.indexOf('\n\n    function cancelGizmoDrag()', start);
  assert.ok(start >= 0 && end > start, 'finishGizmoDrag block must exist');
  const block = src.slice(start, end);

  const stagedStart = block.indexOf("if (stagedGizmo || (inst && inst.placement === 'staged'))");
  const stagedEnd = block.indexOf('\n      if (typeof PackLibrary.findManualVerticalPlacement', stagedStart);
  const resolverStart = block.indexOf('const resolved = PackLibrary.findManualVerticalPlacement', stagedEnd);
  assert.ok(stagedStart >= 0 && stagedEnd > stagedStart && resolverStart > stagedEnd,
    'staged gizmo release must branch before the packed manual vertical resolver');
  const stagedBlock = block.slice(stagedStart, stagedEnd);
  assert.equal(stagedBlock.includes('PackLibrary.findManualVerticalPlacement('), false,
    'staged gizmo release must not call findManualVerticalPlacement');
  assert.match(stagedBlock, /if \(axis === 'y'\) \{[\s\S]*const floorCenterY = Math\.max\(half \|\| 0\.01, 0\.01\);[\s\S]*obj\.position\.y = floorCenterY;/,
    'staged Y handle movement must be reset to staging-floor center before release');
  assert.match(stagedBlock, /Staged vertical stacking is not supported yet/,
    'staged Y handle must give an honest unsupported-stacking message');
  assert.match(stagedBlock, /finishDrag\(\);\s*\n\s*CaseScene\.refreshGizmo\(\);\s*\n\s*return;/,
    'staged X/Z handle releases must reuse the existing staged drag release path');

  const packedBlock = block.slice(resolverStart);
  assert.match(packedBlock, /PackLibrary\.findManualVerticalPlacement\(pack, CaseLibrary\.getCases\(\), instanceId, \{/,
    'packed gizmo releases must still use the existing full manual vertical resolver');
  assert.match(packedBlock, /gizmoPending = \{ instanceId \};/,
    'packed gizmo pending-pose behavior must remain available');
});

test('MANUAL-VERTICAL gizmo drag reuses the Alt-drag math and the validated release path', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function beginGizmoDrag()');
  const end = src.indexOf('function onDblClick(ev)', start);
  assert.ok(start >= 0 && end > start, 'gizmo drag functions must exist before onDblClick');
  const block = src.slice(start, end);

  assert.match(block, /if \(operationsBusy\(\)\) return false;/,
    'gizmo drags must respect the operation lifecycle lock');
  assert.match(block, /controls\.enabled = false;/,
    'gizmo drags must disable OrbitControls for the stroke');
  assert.match(block, /updateDrag\(\{ altKey: true \}\);/,
    'gizmo movement must reuse the Alt-drag vertical-plane math and preview');
  assert.match(block, /function finishGizmoDrag\(\) \{[\s\S]*?finishDrag\(\);/,
    'gizmo release must ride the existing validated finishDrag path');
  assert.match(block, /revertGroupToStart\(groupIds, startMap\);\s*\n\s*resetDrag\(\);/,
    'Escape cancel must revert the pose and restore controls');
});

test('MANUAL-VERTICAL gizmo renders on top with token-driven colors', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function createGizmo()');
  const end = src.indexOf('function setGizmoActive(', start);
  assert.ok(start >= 0 && end > start, 'createGizmo block must exist');
  const block = src.slice(start, end);
  assert.match(block, /depthTest: false/, 'handles must render over cargo');
  assert.match(block, /renderOrder = 999/, 'handles must draw late in the frame');
  const colorStart = src.indexOf('function gizmoColor(');
  const colorBlock = src.slice(colorStart, start);
  assert.match(colorBlock, /getCssVar\('--success'\)/, 'idle handle color must come from theme tokens');
  assert.match(colorBlock, /getCssVar\('--accent-primary'\)/, 'active handle color must come from theme tokens');
});

// V3B: X/Z handles + scene-only pending pose (lift → carry → drop). Source
// contracts only — validation stays in PackLibrary, no pixel testing.
test('MANUAL-VERTICAL gizmo builds X/Y/Z handles with per-axis colors and orientations', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function createGizmo()');
  const end = src.indexOf('function setGizmoActive(', start);
  assert.ok(start >= 0 && end > start, 'createGizmo block must exist');
  const block = src.slice(start, end);
  assert.match(block, /\['x', 'y', 'z'\]\.forEach/, 'the gizmo must build one handle per axis');
  assert.match(block, /handle\.rotation\.z = -Math\.PI \/ 2;/, 'the X handle must be rotated onto the X axis');
  assert.match(block, /handle\.rotation\.x = Math\.PI \/ 2;/, 'the Z handle must be rotated onto the Z axis');
  assert.match(block, /hit\.userData\.gizmoHandle = axis;/, 'each grab proxy must carry its axis tag');
  const colorStart = src.indexOf('function gizmoColor(');
  const colorBlock = src.slice(colorStart, start);
  assert.match(colorBlock, /getCssVar\('--error'\)/, 'the X handle must use the app X-axis tone');
  assert.match(colorBlock, /getCssVar\('--info'\)/, 'the Z handle must use the app Z-axis tone');
  assert.match(src, /function getGizmoHandleMeshes\(\)[\s\S]*?return gizmoHitMeshes;/,
    'packed targets expose all axis grab proxies when the gizmo is visible');
});

// Visual polish pass: staged cases expose X/Z only (staged vertical stacking is
// unsupported), the arrows are slimmed, and per-axis tracking drives the toggle.
// Source contracts only — no pixel testing, no movement/validation change.
test('MANUAL-VERTICAL staged gizmo hides the Y control and raycasts X/Z only', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  // createGizmo tracks each axis handle so individual axes can toggle visibility.
  const createStart = src.indexOf('function createGizmo()');
  const createEnd = src.indexOf('function buildGizmoAxisHandle(', createStart);
  assert.ok(createStart >= 0 && createEnd > createStart, 'createGizmo block must exist');
  const createBlock = src.slice(createStart, createEnd);
  assert.match(createBlock, /gizmoAxisHandles\[axis\] = handle;/,
    'createGizmo must record each axis handle for per-axis visibility control');
  assert.match(createBlock, /opacity: GIZMO_IDLE_OPACITY,/,
    'idle handle opacity must come from the soft shared constant');

  // The idle opacity constant must be soft (lighter than the old heavy 0.92).
  assert.match(src, /const GIZMO_IDLE_OPACITY = 0\.8;/,
    'idle gizmo opacity must be softened for a lighter, professional look');

  // Each axis grab proxy is tracked, and the generous proxy is preserved.
  const buildStart = src.indexOf('function buildGizmoAxisHandle(');
  const buildEnd = src.indexOf('function setGizmoActive(', buildStart);
  assert.ok(buildStart >= 0 && buildEnd > buildStart, 'buildGizmoAxisHandle block must exist');
  const buildBlock = src.slice(buildStart, buildEnd);
  assert.match(buildBlock, /gizmoAxisHitMeshes\[axis\] = hit;/,
    'each axis grab proxy must be tracked for staged filtering');
  assert.match(buildBlock, /CylinderGeometry\(0\.3, 0\.3, 2\.6, 8\)/,
    'the generous invisible hit proxy must be preserved after slimming the arrow');

  // refreshGizmo hides the Y visual handle for staged, keeps it for packed.
  const refreshStart = src.indexOf('function refreshGizmo()');
  const refreshEnd = src.indexOf('function detachGizmo()', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'refreshGizmo block must exist');
  const refreshBlock = src.slice(refreshStart, refreshEnd);
  assert.match(refreshBlock, /gizmoAxisHandles\.y\) gizmoAxisHandles\.y\.visible = targetMode !== 'staged';/,
    'staged mode must hide the Y visual handle while packed keeps it');

  // getGizmoHandleMeshes drops the Y proxy for staged targets only.
  const ghmStart = src.indexOf('function getGizmoHandleMeshes()');
  const ghmEnd = src.indexOf('function getGizmoTargetId()', ghmStart);
  assert.ok(ghmStart >= 0 && ghmEnd > ghmStart, 'getGizmoHandleMeshes block must exist');
  const ghmBlock = src.slice(ghmStart, ghmEnd);
  assert.match(ghmBlock, /if \(!gizmoGroup \|\| !gizmoGroup\.visible\) return \[\];/,
    'a hidden gizmo exposes no grab proxies');
  assert.match(ghmBlock, /gizmoTargetMode === 'staged'/,
    'staged targets must filter the vertical grab proxy');
  assert.match(ghmBlock, /\['x', 'z'\]\.map\(axis => gizmoAxisHitMeshes\[axis\]\)/,
    'staged targets expose only the X and Z grab proxies');
  assert.match(ghmBlock, /return gizmoHitMeshes;/,
    'packed targets still expose all axis grab proxies');
});

test('MANUAL-VERTICAL X/Z strokes constrain movement to one axis and surface-follow Y', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function beginGizmoDrag()');
  const end = src.indexOf('function onDblClick(ev)', start);
  assert.ok(start >= 0 && end > start, 'gizmo drag functions must exist before onDblClick');
  const block = src.slice(start, end);

  assert.match(block, /dragPlane\.set\(new THREE\.Vector3\(0, 1, 0\), -obj\.position\.y\);/,
    'the horizontal stroke plane must sit at the case’s current height');
  assert.match(block, /if \(gizmoAxis === 'x' \|\| gizmoAxis === 'z'\)/,
    'X/Z strokes must dispatch to the axis-constrained update');
  assert.match(block, /gizmoAxis === 'x' \? next\.x : dragStartPosWorld\.x,/,
    'an X stroke must move X only');
  assert.match(block, /gizmoAxis === 'z' \? next\.z : dragStartPosWorld\.z/,
    'a Z stroke must move Z only');
  assert.match(block, /Math\.max\(half \|\| 0\.01, dragStartPosWorld\.y\),/,
    'X/Z strokes must start from the lifted Y so a raised case can be carried');
  const axisStart = block.indexOf('function updateGizmoAxisDrag()');
  const axisEnd = block.indexOf('\n\n    function finishGizmoDrag()', axisStart);
  assert.ok(axisStart >= 0 && axisEnd > axisStart, 'updateGizmoAxisDrag block must exist');
  const axisBlock = block.slice(axisStart, axisEnd);
  assert.equal(axisBlock.includes("getGizmoTargetMode() === 'staged'"), false,
    'horizontal gizmo surface-following must not be limited to staged cases');
  assert.match(axisBlock, /CaseScene\.getSurfaceFollowingPreview\(draggingId, candidate\)[\s\S]*candidate\.y = Math\.max\(half \|\| 0\.01, preview\.centerY\);[\s\S]*CaseScene\.checkCollision\(draggingId, candidate, new Set\(\[draggingId\]\)\)/,
    'X/Z gizmo strokes must apply preview Y before collision preview');
  assert.match(block, /updateDrag\(\{ altKey: true \}\);/,
    'the Y stroke must keep reusing the Alt-drag vertical-plane math');
});

test('MANUAL-VERTICAL a held pose stays scene-only until a validated drop commits it', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function beginGizmoDrag()');
  const end = src.indexOf('function onDblClick(ev)', start);
  const block = src.slice(start, end);

  assert.match(block, /if \(resolved\.ok && resolved\.corrected !== true\)/,
    'a directly valid release must commit immediately through finishDrag');
  assert.match(block, /gizmoPending = \{ instanceId \};\s*\n\s*resetDrag\(\);/,
    'a not-directly-valid release must hold a scene-only pose and restore controls');
  const resolveStart = block.indexOf('function resolvePendingPose()');
  const resolveEnd = block.indexOf('function cancelPendingPose()', resolveStart);
  assert.ok(resolveStart >= 0 && resolveEnd > resolveStart, 'resolvePendingPose must exist');
  const resolveBlock = block.slice(resolveStart, resolveEnd);
  assert.match(resolveBlock, /mode: 'resolve',/,
    'the drop must resolve through findManualVerticalPlacement');
  assert.match(resolveBlock, /updateCasesWithManualRevalidation\(packId, nextCases, CaseLibrary\.getCases\(\), \{\s*\n\s*repairDependents: true,/,
    'the drop must commit with dependent repair');
  assert.match(resolveBlock, /UIComponents\.showToast\(resolved\.reason \|\| 'Cannot place the held case here\.', 'error'\);/,
    'a rule-blocked drop must keep holding with the named reason');
  assert.match(block, /CaseScene\.sync\(PackLibrary\.getById\(StateStore\.get\('currentPackId'\)\)\);/,
    'cancelling a hold must restore the committed pack pose');
});

test('MANUAL-VERTICAL every hold exit is wired: Enter, Drop, Escape, selection, drag, sync', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /case 'Enter':\s*\n\s*if \(resolvePendingPose\(\)\)/,
    'Enter must place a held case');
  assert.match(src, /else if \(gizmoPending\) \{\s*\n\s*cancelPendingPose\(\);/,
    'Escape must cancel a held case when no stroke is active');
  assert.match(src, /if \(mode === 'drop'\) \{\s*\n\s*resolvePendingPose\(\);\s*\n\s*return;/,
    'the Drop action must place a held case');
  assert.match(src, /gizmoPending && \(ids\.length !== 1 \|\| ids\[0\] !== gizmoPending\.instanceId\)/,
    'changing selection away from a held case must cancel the hold');
  assert.match(src, /if \(gizmoPending\) cancelPendingPose\(\);\s*\n\s*draggingId = pressed\.instanceId;/,
    'starting a normal drag must first resolve the hold safely');
  assert.match(src, /refreshGizmo\(\);\s*\n\s*if \(pendingPoseWatcher\) pendingPoseWatcher\(\);/,
    'pack-level scene syncs must notify the hold watcher');
  assert.match(src, /CaseScene\.setPendingPoseWatcher\(onScenePendingInvalidated\);/,
    'the InteractionManager must register the hold watcher');
});

// V4A-1 surface-following preview height helper: pure, preview-only terrain
// math for the future ghost drag. It must never validate placement rules —
// commits keep going through PackLibrary.
async function loadSurfaceFollowingPreviewY() {
  const EditorScreen = await loadEditorScreenModule();
  assert.equal(typeof EditorScreen.computeSurfaceFollowingPreviewY, 'function',
    'computeSurfaceFollowingPreviewY must be exported for unit testing');
  return EditorScreen.computeSurfaceFollowingPreviewY;
}

const PREVIEW_HALF = { x: 5, y: 5, z: 5 };
const PREVIEW_FLOOR = { kind: 'truck-floor', min: { x: 0, z: -30 }, max: { x: 120, z: 30 }, topY: 0 };

test('MANUAL-VERTICAL preview Y rests on the floor and rides the highest overlapping top', async () => {
  const previewY = await loadSurfaceFollowingPreviewY();

  const onFloor = previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [PREVIEW_FLOOR] });
  assert.equal(onFloor.ok, true, 'a floor under the footprint must produce a preview height');
  assert.equal(onFloor.centerY, 5, 'floor resting center must be topY + half height');
  assert.equal(onFloor.bottomY, 0, 'floor resting bottom must be the floor top');
  assert.equal(onFloor.surface.kind, 'truck-floor', 'the selected surface must be returned');
  assert.equal(onFloor.overlapFraction, 1, 'a fully contained footprint overlaps completely');

  const lifted = previewY({
    halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [PREVIEW_FLOOR], clearance: 0.5,
  });
  assert.equal(lifted.centerY, 5.5, 'clearance must lift the preview center');
  assert.equal(lifted.bottomY, 0.5, 'clearance must lift the preview bottom');

  const boxTop = { kind: 'box-top', min: { x: 15, z: -5 }, max: { x: 25, z: 5 }, topY: 10 };
  const ridden = previewY({
    halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [PREVIEW_FLOOR, boxTop],
  });
  assert.equal(ridden.ok, true, 'an overlapping box top must be rideable');
  assert.equal(ridden.centerY, 15, 'the highest overlapping top must win over the floor');
  assert.equal(ridden.surface.kind, 'box-top', 'the winning surface must be the box top');
});

test('MANUAL-VERTICAL preview Y ignores tiny overlaps and accepts every visual surface kind', async () => {
  const previewY = await loadSurfaceFollowingPreviewY();
  const slimBox = { kind: 'box-top', min: { x: 23, z: 3 }, max: { x: 33, z: 13 }, topY: 10 };

  const overFloor = previewY({
    halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [PREVIEW_FLOOR, slimBox],
  });
  assert.equal(overFloor.centerY, 5,
    'a 4% overlap must stay below the default threshold and fall back to the floor');
  const alone = previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [slimBox] });
  assert.equal(alone.ok, false, 'a tiny overlap alone must not produce a surface');
  assert.equal(alone.reason, 'no-surface', 'tiny-overlap misses must report no-surface');

  const wellTop = { kind: 'wheel-well-top', min: { x: 15, z: -5 }, max: { x: 25, z: 5 }, topY: 20 };
  assert.equal(previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [wellTop] }).centerY, 25,
    'wheel-well tops must be visual terrain');
  const deck = { kind: 'front-deck', min: { x: 15, z: -5 }, max: { x: 25, z: 5 }, topY: 24 };
  assert.equal(previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [deck] }).centerY, 29,
    'the front overhang deck must be visual terrain');
  const staging = { kind: 'staging-floor', min: { x: 0, z: 35 }, max: { x: 120, z: 65 }, topY: 0 };
  const staged = previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 40, surfaces: [staging] });
  assert.equal(staged.ok, true, 'the staging floor must be visual terrain');
  assert.equal(staged.surface.kind, 'staging-floor', 'the staging surface must be returned');

  const stagedTop = { kind: 'staged-box-top', min: { x: 15, z: -5 }, max: { x: 25, z: 5 }, topY: 16 };
  assert.equal(previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [stagedTop] }).centerY, 21,
    'staged/outside case tops must be visual terrain without becoming placement validation');
});

test('MANUAL-VERTICAL preview Y fails safely on misses and bad input', async () => {
  const previewY = await loadSurfaceFollowingPreviewY();

  const empty = previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: [] });
  assert.deepEqual({ ok: empty.ok, reason: empty.reason }, { ok: false, reason: 'no-surface' },
    'no surfaces must report no-surface');
  const far = previewY({
    halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0,
    surfaces: [{ kind: 'truck-floor', min: { x: 200, z: -30 }, max: { x: 300, z: 30 }, topY: 0 }],
  });
  assert.equal(far.reason, 'no-surface', 'non-overlapping surfaces must report no-surface');

  assert.equal(previewY({ centerX: 20, centerZ: 0, surfaces: [PREVIEW_FLOOR] }).reason, 'bad-input',
    'a missing halfWorld must report bad-input');
  assert.equal(previewY({ halfWorld: { x: 0, y: 5, z: 5 }, centerX: 20, centerZ: 0, surfaces: [PREVIEW_FLOOR] }).reason,
    'bad-input', 'non-positive half extents must report bad-input');
  assert.equal(previewY({ halfWorld: PREVIEW_HALF, centerX: NaN, centerZ: 0, surfaces: [PREVIEW_FLOOR] }).reason,
    'bad-input', 'a non-finite center must report bad-input');
  assert.equal(previewY({ halfWorld: PREVIEW_HALF, centerX: 20, centerZ: 0, surfaces: 'nope' }).reason,
    'bad-input', 'a non-array surface list must report bad-input');
});

test('MANUAL-VERTICAL preview helper is exported, preview-only, and draft-free', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /export function computeSurfaceFollowingPreviewY\(\{/,
    'the preview helper must be exported from editor-screen.js');
  assert.match(src, /NOT a placement validator/,
    'the helper must document that it never validates placement');
  assert.equal(src.includes('manualDraft'), false,
    'no manualDraft state may appear in editor-screen.js');
});

test('MANUAL-VERTICAL surface-following preview surfaces come only from scene and geometry sources', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function getSurfaceFollowingPreviewSurfaces(instanceId, ignoreIds)');
  const end = src.indexOf('\n\n    function getSurfaceFollowingPreview(instanceId', start);
  assert.ok(start >= 0 && end > start, 'surface-following surface collector must exist');
  const block = src.slice(start, end);

  assert.match(block, /TrailerGeometry\.getTrailerUsableZones\(truck\)/,
    'truck floor, wheel-well shelf, and front-deck surfaces must derive from usable zones');
  assert.match(block, /TrailerGeometry\.zonesInchesToWorld\(zonesInches\)/,
    'preview surfaces must be converted into world coordinates before drag math');
  assert.match(src, /return 'truck-floor';/,
    'floor-level usable zones must be tagged as truck-floor');
  assert.match(src, /truck && truck\.shapeMode === 'wheelWells' \? 'wheel-well-top' : 'front-deck'/,
    'raised usable zones must be tagged as wheel-well tops or front deck');
  assert.match(block, /PackLibrary\.getStagingWorkAreaBounds\(truck\)/,
    'staging floor must come from the manual staging work area bounds');
  assert.match(block, /kind: 'staging-floor'/,
    'the manual staging work area must be exposed as a preview floor');
  assert.match(block, /const kind = otherInst && otherInst\.placement === 'staged' \? 'staged-box-top' : 'box-top';/,
    'packed and staged case tops must be exposed as distinct rideable preview surfaces');
  assert.match(block, /kind,\s*\n\s*min: \{ x: aabb\.min\.x, z: aabb\.min\.z \},/,
    'case tops must pass the chosen rideable surface kind into the preview collector');
  assert.equal(block.includes("if (otherInst && otherInst.placement === 'staged') continue;"), false,
    'staged case tops must not be skipped by the preview surface collector');
  assert.match(block, /Preview-only terrain: staged tops can lift the ghost[\s\S]*validation still keeps staged Y floor-normalized/,
    'staged top previews must document that they do not add persistent staged stacking');
  assert.match(block, /if \(otherId === instanceId\) continue;/,
    'the dragged case must never generate its own support surface');
  assert.match(src, /const SURFACE_PREVIEW_DRAG_MIN_OVERLAP = 0\.02;/,
    'drag-time preview should start riding surfaces before visible side penetration is obvious');
  assert.match(src, /minOverlapFraction: SURFACE_PREVIEW_DRAG_MIN_OVERLAP,/,
    'interactive drag must use the lower drag-time overlap threshold');
  assert.match(src, /getSurfaceFollowingPreview,/,
    'CaseScene must expose the preview query to InteractionManager without changing the data model');
});

test('MANUAL-VERTICAL normal single-case drag applies preview Y before collision checks', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /let surfaceFollowingDrag = false;/,
    'normal drag must track whether the surface-following preview is active');
  assert.match(src, /function canSurfaceFollowNormalDrag\(instanceId, groupIds\) \{[\s\S]*groupIds\.includes\(instanceId\)[\s\S]*return groupIds\.every\(id => packIds\.has\(id\)\);/,
    'surface-following must accept a complete instance-based drag group, including staged cases');
  assert.match(src, /surfaceFollowingDrag = canSurfaceFollowNormalDrag\(draggingId, dragGroupIds\);/,
    'startDrag must enable surface-following only after final drag group selection is known');
  assert.match(src, /surfaceFollowingDrag = false;\s*\n\s*pressed = null;/,
    'resetDrag must clear the transient surface-following flag');

  const start = src.indexOf('function updateDrag(ev)');
  const end = src.indexOf('\n\n    /**\n     * Tween', start);
  assert.ok(start >= 0 && end > start, 'updateDrag block must exist');
  const block = src.slice(start, end);
  const normalStart = block.indexOf('const intersection = tmpVec3;\n      const ok = raycaster.ray.intersectPlane(dragPlane');
  assert.ok(normalStart >= 0, 'normal X/Z drag block must exist');
  const altBlock = block.slice(block.indexOf('if (altKey)'), normalStart);
  const normalBlock = block.slice(normalStart);

  assert.match(altBlock, /surfaceFollowingDrag = false;/,
    'Alt-drag must disable surface-following so the V2B vertical drag path stays unchanged');
  assert.equal(altBlock.includes('getSurfaceFollowingPreview'), false,
    'Alt-drag must not use the surface-following helper');
  assert.match(normalBlock, /surfaceFollowingDrag && id === draggingId[\s\S]*CaseScene\.getSurfaceFollowingPreview\(id, candidate\)[\s\S]*candidate\.y = Math\.max\(half, preview\.centerY\);[\s\S]*candidates\.set\(id, candidate\);[\s\S]*applyDragCandidates\(groupIds, candidates, ignoreSet, \{/,
    'normal drag must raise the visual candidate from preview surfaces before the shared collision preview runs');
  assert.match(src, /if \(groupIds\.length === 1\) \{[\s\S]*CaseScene\.checkCollision\(id, candidate, ignoreSet\);[\s\S]*obj\.position\.copy\(candidate\)/,
    'the shared preview helper must preserve the existing single-case point-collision path');
  assert.match(src, /function updateGizmoAxisDrag\(\)[\s\S]*CaseScene\.getSurfaceFollowingPreview\(draggingId, candidate\)[\s\S]*candidate\.y = Math\.max\(half \|\| 0\.01, preview\.centerY\);/,
    'X/Z gizmo strokes must also use preview Y without changing normal drag behavior');
});

test('MANUAL-VERTICAL normal drag and revert keep the gizmo attached to the moved case', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function updateDrag(ev)');
  const end = src.indexOf('\n\n    /**\n     * Tween', start);
  assert.ok(start >= 0 && end > start, 'updateDrag block must exist');
  const block = src.slice(start, end);
  const normalStart = block.indexOf('const intersection = tmpVec3;\n      const ok = raycaster.ray.intersectPlane(dragPlane');
  assert.ok(normalStart >= 0, 'normal X/Z drag block must exist');
  const altBlock = block.slice(block.indexOf('if (altKey)'), normalStart);
  const normalBlock = block.slice(normalStart);

  assert.match(altBlock, /CaseScene\.updateGizmoTransform\(\);\s*\n\s*return;/,
    'Alt/Y movement must sync the gizmo before returning');
  assert.match(normalBlock, /applyDragCandidates\(groupIds, candidates, ignoreSet, \{[\s\S]*?\}\);\s*\n\s*CaseScene\.updateGizmoTransform\(\);\s*\n\s*\}/,
    'normal X/Z movement must apply the guarded group preview and then sync the gizmo');

  const revertStart = src.indexOf('function revertGroupToStart(groupIds, startMap)');
  const revertEnd = src.indexOf('\n\n    function finishDrag()', revertStart);
  assert.ok(revertStart >= 0 && revertEnd > revertStart, 'revertGroupToStart block must exist');
  const revertBlock = src.slice(revertStart, revertEnd);
  assert.match(revertBlock, /\.onUpdate\(\(\) => CaseScene\.updateGizmoTransform\(\)\)/,
    'animated invalid-release reverts must keep the gizmo synced during tween movement');
  assert.match(revertBlock, /\.onComplete\(\(\) => CaseScene\.updateGizmoTransform\(\)\)/,
    'animated invalid-release reverts must sync the gizmo at tween completion');
  assert.match(revertBlock, /o\.position\.copy\(s\);\s*\n\s*CaseScene\.updateGizmoTransform\(\);/,
    'non-animated reverts must sync the gizmo after snapping back');
});

test('MANUAL-VERTICAL surface-following invalid releases hold scene-only pending pose', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishDrag()');
  const end = src.indexOf('\n\n    function resetDrag()', start);
  assert.ok(start >= 0 && end > start, 'finishDrag block must exist');
  const block = src.slice(start, end);

  assert.match(block, /mode: 'resolve',\s*\n\s*desiredPosition: SceneManager\.vecWorldToInches\(obj\.position\)/,
    'release must still resolve the preview pose through PackLibrary validation');
  assert.match(block, /updateCasesWithManualRevalidation\(packId, nextCases, CaseLibrary\.getCases\(\), \{\s*\n\s*repairDependents: true,/,
    'valid/corrected releases must still commit with dependent repair');
  assert.match(block, /if \(surfaceFollowingDrag\) \{\s*\n\s*const firstHold = !gizmoPending;\s*\n\s*gizmoPending = \{ instanceId \};\s*\n\s*resetDrag\(\);\s*\n\s*CaseScene\.setDragging\(instanceId\);/,
    'surface-following rule-blocked releases must hold the scene pose instead of persisting it');
  assert.match(block, /CaseScene\.setCollision\(instanceId, true\);/,
    'a held rule-blocked preview must remain visibly invalid');
  assert.match(block, /resolved\.code !== 'outside-truck' && resolved\.code !== 'invalid-selection'/,
    'outside-truck releases must keep the legacy staging path rather than becoming a hold');
  assert.match(block, /if \(anyCollides && groupIds\.length === 1\) \{[\s\S]*revertGroupToStart\(groupIds, startMap\);[\s\S]*Cannot place here: collision detected/,
    'hard physical single-case collisions must still revert immediately');
});

test('MAX-CAPACITY-B manual commits clear only edited profiles while rejected previews stay persistent-state pure', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /function withoutPackedProfile\(inst\) \{\s*const next = \{ \.\.\.inst \};\s*delete next\.packedProfile;\s*return next;/,
    'manual commits must have one explicit per-instance profile clearing helper');
  assert.match(src, /function applyInstancePatches\(pack, patchById\) \{[\s\S]*withoutPackedProfile\(\{ \.\.\.inst, \.\.\.patch \}\) : inst;/,
    'rotate, flip, nudge, and atomic group patches must clear only patched instance profiles');
  assert.match(src, /function buildStagedToPackedCandidateCases\([\s\S]*withoutPackedProfile\(\{[\s\S]*placement: 'packed'/,
    'staged-to-packed manual commits must return to normal handling');

  for (const functionName of ['moveSelectionVertical', 'resolvePendingPose', 'finishDrag']) {
    const start = src.indexOf(`function ${functionName}(`);
    const end = src.indexOf('\n\n    function ', start + 1);
    assert.ok(start >= 0 && end > start, `${functionName} block must exist`);
    assert.match(src.slice(start, end), /buildNormalHandlingPack\(pack, \[/,
      `${functionName} must validate the edited instance without its persisted Max profile`);
  }

  const inspectorStart = src.indexOf("savePos.addEventListener('click'");
  const inspectorEnd = src.indexOf('// Vertical placement row:', inspectorStart);
  assert.ok(inspectorStart >= 0 && inspectorEnd > inspectorStart, 'Inspector Apply Position block must exist');
  assert.match(src.slice(inspectorStart, inspectorEnd), /buildNormalHandlingPack\(pack, \[inst\.id\]\)/,
    'Inspector position commits must clear only the edited profile');

  const unpackStart = src.indexOf('async function unpackAll()');
  const unpackEnd = src.indexOf('\n\n    function renderInspectorNoPack()', unpackStart);
  assert.ok(unpackStart >= 0 && unpackEnd > unpackStart, 'Unpack block must exist');
  assert.match(src.slice(unpackStart, unpackEnd), /const nextCases = organized\.cases;/,
    'Unpack must commit the profile-cleared organized staging result');
  const organizedStart = src.indexOf('export function buildOrganizedUnpackStagingCases({');
  const organizedEnd = src.indexOf('\n\nexport function createCaseScene', organizedStart);
  assert.ok(organizedStart >= 0 && organizedEnd > organizedStart,
    'the organized staging helper must exist');
  assert.match(src.slice(organizedStart, organizedEnd), /cases: sourceInstances\.map\(inst => withoutPackedProfile\(stagedById\.get\(inst\.id\) \|\| inst\)\),/,
    'Unpack must remove profiles from every instance, including unresolved items left in place');

  const finishStart = src.indexOf('function finishDrag()');
  const finishEnd = src.indexOf('\n\n    function resetDrag()', finishStart);
  const finishBlock = src.slice(finishStart, finishEnd);
  assert.match(finishBlock, /revertGroupToStart\(groupIds, startMap\);[\s\S]*return;/,
    'rejected drag paths must revert before any persistent profile-clearing candidate is committed');
  assert.match(finishBlock, /withoutPackedProfile\(\{[\s\S]*placement: placementValue/,
    'successful legacy drag/stage commits must clear profiles for moved members');
});

test('ORGANIZED-UNPACK identical mixed-rotation cases form deterministic aligned rows', async () => {
  const caseData = makeVerticalCase({
    id: 'organized-identical',
    name: 'Organized Identical',
    dimensions: { length: 20, width: 10, height: 12 },
  });
  const rotations = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: Math.PI / 2, z: 0 },
    { x: Math.PI / 2, y: 0, z: 0 },
  ];
  const instances = Array.from({ length: 7 }, (_, index) => makeVerticalInstance(
    caseData.id,
    `organized-${String(index).padStart(2, '0')}`,
    { x: 10 + index, y: 6, z: index },
    {
      transform: {
        position: { x: 10 + index, y: 6, z: index },
        rotation: rotations[index % rotations.length],
        scale: { x: 1, y: 1, z: 1 },
      },
      orientedDims: index % 2
        ? { length: 10, width: 20, height: 12 }
        : { length: 20, width: 10, height: 12 },
      packedProfile: 'max-capacity',
    }
  ));

  const first = await buildOrganizedUnpackLayout({
    cases: [caseData],
    instances,
    truck: { ...RECT_TRUCK, length: 84 },
  });
  assert.equal(first.movedCount, 7, 'every resolved instance must move to organized staging');
  assert.equal(first.cases.every(inst => inst.placement === 'staged'), true,
    'every resolved case must be staged');
  assert.equal(first.cases.every(inst => !Object.hasOwn(inst, 'packedProfile')), true,
    'Unpack must remove every Max Capacity profile marker');
  assert.equal(first.cases.every(inst => JSON.stringify(inst.transform.rotation) === JSON.stringify({ x: 0, y: 0, z: 0 })), true,
    'mixed packed rotations must reset to one deterministic staging rotation');
  assert.equal(first.cases.every(inst => JSON.stringify(inst.orientedDims) === JSON.stringify(caseData.dimensions)), true,
    'staging dimensions must match the deterministic zero rotation');
  assert.equal(first.cases.every(inst => inst.transform.position.y === caseData.dimensions.height / 2), true,
    'every staged case must rest on the staging ground');

  const rows = new Map();
  for (const inst of first.cases) {
    const z = inst.transform.position.z;
    if (!rows.has(z)) rows.set(z, []);
    rows.get(z).push(inst.transform.position.x);
  }
  const rowXs = [...rows.values()].map(values => values.sort((a, b) => a - b));
  assert.deepEqual(rowXs[0], [10, 42, 74], 'the first row must use one uniform 32-inch column grid');
  assert.deepEqual(rowXs[1], [10, 42, 74], 'every full row must align to the same X origin and grid');
  assert.deepEqual(rowXs[2], [10], 'the partial final row must restart at the same X origin');

  const aabbs = first.cases.map(stagedAabb);
  for (let left = 0; left < aabbs.length; left += 1) {
    for (let right = left + 1; right < aabbs.length; right += 1) {
      assert.equal(aabbsOverlap(aabbs[left], aabbs[right]), false,
        `staged AABBs ${left} and ${right} must not overlap`);
    }
  }

  const repeated = await buildOrganizedUnpackLayout({
    cases: [caseData],
    instances: first.cases,
    truck: { ...RECT_TRUCK, length: 84 },
  });
  const poses = cases => cases.map(inst => ({
    id: inst.id,
    placement: inst.placement,
    position: inst.transform.position,
    rotation: inst.transform.rotation,
    orientedDims: inst.orientedDims,
  }));
  assert.equal(JSON.stringify(poses(repeated.cases)), JSON.stringify(poses(first.cases)),
    'repeated Unpack must produce byte-equivalent staged poses');
});

test('ORGANIZED-UNPACK case groups stay separated, ordered, and truck-mode invariant', async () => {
  const largeCase = makeVerticalCase({
    id: 'organized-large',
    name: 'Large Group',
    dimensions: { length: 30, width: 20, height: 16 },
  });
  const smallCase = makeVerticalCase({
    id: 'organized-small',
    name: 'Small Group',
    dimensions: { length: 10, width: 8, height: 6 },
  });
  const instances = [
    makeVerticalInstance(smallCase.id, 'small-2', { x: 1, y: 3, z: 1 }),
    makeVerticalInstance(largeCase.id, 'large-2', { x: 2, y: 8, z: 2 }, {
      transform: {
        position: { x: 2, y: 8, z: 2 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
    makeVerticalInstance(smallCase.id, 'small-1', { x: 3, y: 3, z: 3 }),
    makeVerticalInstance(largeCase.id, 'large-1', { x: 4, y: 8, z: 4 }),
  ];
  const cases = [largeCase, smallCase];
  const trucks = [RECT_TRUCK, WHEEL_WELL_TRUCK, FRONT_OVERHANG_TRUCK];
  const layouts = [];
  for (const truck of trucks) {
    layouts.push(await buildOrganizedUnpackLayout({ cases, instances, truck }));
  }

  const reference = JSON.stringify(layouts[0].cases.map(inst => ({
    id: inst.id,
    position: inst.transform.position,
    rotation: inst.transform.rotation,
    dims: inst.orientedDims,
  })));
  assert.equal(JSON.stringify(layouts[1].cases.map(inst => ({
    id: inst.id,
    position: inst.transform.position,
    rotation: inst.transform.rotation,
    dims: inst.orientedDims,
  }))), reference, 'Wheel Wells must use the same safe organized staging result');
  assert.equal(JSON.stringify(layouts[2].cases.map(inst => ({
    id: inst.id,
    position: inst.transform.position,
    rotation: inst.transform.rotation,
    dims: inst.orientedDims,
  }))), reference, 'Front Overhang must use the same safe organized staging result');

  const staged = layouts[0].cases;
  const largeZ = staged.filter(inst => inst.caseId === largeCase.id).map(inst => stagedAabb(inst));
  const smallZ = staged.filter(inst => inst.caseId === smallCase.id).map(inst => stagedAabb(inst));
  assert.ok(Math.max(...largeZ.map(aabb => aabb.max.z)) < Math.min(...smallZ.map(aabb => aabb.min.z)),
    'larger-footprint groups must stay closest to the truck with a clear band gap');
  const aabbs = staged.map(stagedAabb);
  for (let left = 0; left < aabbs.length; left += 1) {
    for (let right = left + 1; right < aabbs.length; right += 1) {
      assert.equal(aabbsOverlap(aabbs[left], aabbs[right]), false,
        'separate organized groups must not overlap');
    }
  }
});

test('ORGANIZED-UNPACK unresolved references remain untouched without fabricated geometry', async () => {
  const resolvedCase = makeVerticalCase({
    id: 'organized-resolved',
    dimensions: { length: 18, width: 12, height: 10 },
  });
  const unresolved = makeVerticalInstance('missing-case', 'unresolved', { x: 77, y: 13, z: -44 }, {
    transform: {
      position: { x: 77, y: 13, z: -44 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    orientedDims: { length: 99, width: 77, height: 26 },
    packedProfile: 'max-capacity',
  });
  const resolved = makeVerticalInstance(resolvedCase.id, 'resolved', { x: 20, y: 5, z: 0 }, {
    packedProfile: 'max-capacity',
  });
  const result = await buildOrganizedUnpackLayout({
    cases: [resolvedCase],
    instances: [unresolved, resolved],
  });

  assert.equal(result.movedCount, 1, 'only the resolved instance may receive a staged pose');
  const unresolvedAfter = result.cases.find(inst => inst.id === unresolved.id);
  assert.deepEqual(unresolvedAfter.transform, unresolved.transform,
    'an unresolved instance must keep its exact transform');
  assert.deepEqual(unresolvedAfter.orientedDims, unresolved.orientedDims,
    'an unresolved instance must not receive fabricated or replacement dimensions');
  assert.equal(unresolvedAfter.placement, unresolved.placement,
    'an unresolved instance must keep its safe existing placement classification');
  assert.equal(Object.hasOwn(unresolvedAfter, 'packedProfile'), false,
    'Unpack must still remove the Max Capacity marker from unresolved instances');
});
