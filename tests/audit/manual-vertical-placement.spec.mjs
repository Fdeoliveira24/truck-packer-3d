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

test('MANUAL-VERTICAL gizmo handles take raycast priority and attach only to one packed case', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const downStart = src.indexOf('function onDown(ev)');
  const downEnd = src.indexOf('function onUp()', downStart);
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
  assert.match(refreshBlock, /placement !== 'staged'/,
    'the gizmo must never attach to a staged case');
  assert.match(refreshBlock, /detachGizmo\(\);/,
    'anything else must detach the gizmo');
  assert.match(src, /applyHover\(hoveredId\);\s*\n\s*refreshGizmo\(\);\s*\n\s*\}/,
    'setSelected must refresh the gizmo on selection changes');
  assert.match(src, /applyDragging\(draggedId\);\s*\n\s*refreshGizmo\(\);/,
    'scene sync must refresh the gizmo after pack mutations');
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
  assert.match(src, /return gizmoGroup && gizmoGroup\.visible \? gizmoHitMeshes : \[\];/,
    'all axis grab proxies must be raycastable when the gizmo is visible');
});

test('MANUAL-VERTICAL X/Z strokes constrain movement to one axis at the lifted height', async () => {
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
    'X/Z strokes must keep the lifted Y so a raised case can be carried');
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
// commits keep going through PackLibrary. Evaluated from source (no THREE).
async function loadSurfaceFollowingPreviewY() {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('export function computeSurfaceFollowingPreviewY');
  // The destructured-parameter block closes at column 0, so slice to the next
  // top-level declaration instead of the first "\n}".
  const end = src.indexOf('\nfunction getUnpackCategoryKey', start);
  assert.ok(start >= 0 && end > start, 'computeSurfaceFollowingPreviewY must be exported for unit testing');
  return new Function(
    `${src.slice(start, end).replace('export ', '')}; return computeSurfaceFollowingPreviewY;`
  )();
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
