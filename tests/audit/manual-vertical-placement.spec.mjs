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
// validated resolve path with dependent repair and honest outcome toasts,
// while multi-select, staged-case, and out-of-truck releases keep the legacy
// settle/staging path byte-for-byte.
test('MANUAL-VERTICAL drag release for a single packed case resolves through validated placement', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishDrag()');
  const end = src.indexOf('\n\n    function resetDrag()', start);
  assert.ok(start >= 0 && end > start, 'finishDrag block must exist');
  const block = src.slice(start, end);

  assert.match(block, /const singleDraggedInst = groupIds\.length === 1/,
    'the validated release branch must be gated to a single dragged case');
  assert.match(block, /singleDraggedInst\.placement !== 'staged'/,
    'staged-case drag release must keep the legacy path');
  assert.match(block, /mode: 'resolve',\s*\n\s*desiredPosition: SceneManager\.vecWorldToInches\(obj\.position\)/,
    'release must resolve the dragged position through findManualVerticalPlacement');
  assert.match(block, /updateCasesWithManualRevalidation\(packId, nextCases, CaseLibrary\.getCases\(\), \{\s*\n\s*repairDependents: true,/,
    'the validated release must commit with dependent repair');
  assert.match(block, /formatVerticalMoveMessage\(result, instanceId/,
    'release toasts must report the actual post-commit outcome');
  assert.match(block, /result\.stagedIds\.includes\(instanceId\)/,
    'a release that ends staged must never claim a plain success');
  assert.match(block, /revertGroupToStart\(groupIds, startMap\);\s*\n\s*UIComponents\.showToast\(resolved\.reason/,
    'rule-blocked releases must revert with the blocking reason');
  assert.match(block, /resolved\.code !== 'outside-truck' && resolved\.code !== 'invalid-selection'/,
    'out-of-truck releases must fall through to the legacy staging path');
  // The legacy path must remain intact for multi-select and staged releases.
  assert.match(block, /CaseScene\.settleY\(id\)/,
    'the legacy settle path must remain for multi-select and staged releases');
  assert.match(block, /isAabbContainedInAnyZone\(aabb, zonesInches\) \? 'packed' : 'staged'/,
    'legacy zone-containment placement classification must remain unchanged');
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
