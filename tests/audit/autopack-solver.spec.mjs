// autopack solver: contract tests from the former security suite.

import { runInNewContext } from 'node:vm';
import { runAdaptiveAutoPack } from '../../src/packing-core/solution.js';

import {
  PHB_DIMS,
  R1_HALF,
  WW_SUPPORT_TRUCK,
  assert,
  assertNoFloatFrames,
  assertStackSafeOutput,
  autoPackEnginePath,
  autoPackItemBuilderPath,
  autoPackSolverPath,
  createHash,
  createPackPreviewSchedulerHarness,
  e1AssertSafe,
  e1Items,
  e1LayerFollowFraction,
  e1Placed,
  e2aFlips,
  e2bChannelStackLayers,
  editorScreenPath,
  fs,
  keyboardManagerPath,
  maxAAssertPhysicalSafety,
  maxAPlaced,
  maxAResultBytes,
  normalizerPath,
  operationLifecyclePath,
  orientedDimsPath,
  p5Modules,
  p8Item,
  p8PackedEntry,
  p8WheelWellTruck,
  packLibraryPath,
  packingCoreValidationPath,
  phb2AssertAnimationBatches,
  phb2AssertDirectStackLimit,
  phb2AssertSafe,
  phb2FloorCount,
  phb2FloorHole,
  phb2SequentialForwardViolation,
  phbOverlapXZ,
  phbPlaced,
  phbSolverModules,
  phc2Aabb,
  phcFrontOverhangTruck,
  phcResultBytes,
  phdAlternatingItems,
  phdRowFragmentCount,
  phdSpatialRows,
  phdSplitRunCount,
  r1Truth,
  r1bAssertAtomicFloor,
  r1bComposeStaged,
  r1bImportBeam,
  r1bModules,
  r1cSolverItem,
  r1dRound,
  r1eCartonItems,
  r1eLexLess,
  r1eOverlapXZ,
  r1ePlaced,
  r1eStackCandidate,
  readAppSource,
  runEnginePack,
  stressCounts,
  stressTest,
  test,
  testAabbInsidePhysicalTrailer,
  testAabbOnPhysicalFloor,
  threeOrientedTruth,
  trailerGeometryPath,
  wwAabb,
} from '../fixtures/security-invariants-support.mjs';

test('PLACEMENT-STATE-S2 AutoPack records placement from solver results', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const start = src.indexOf('export function buildAutoPackNextCases(');
  const end = src.indexOf('\nexport function createAutoPackEngine', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /const isPacked = placements instanceof Map && placements\.has\(inst\.id\);/,
    'AutoPack must classify packed vs staged by solver placement membership');
  assert.match(block, /placement: isPacked \? 'packed' : 'staged',/,
    'AutoPack must mark solver-placed cases as packed and overflow/staged cases as staged');
});

function a3Fixed(Solver, id, position, dims, rules = {}) {
  return {
    instanceId: id, fixed: true, item: { weight: 30, ...rules }, pos: position, dims,
    aabb: Solver.getAabb(position, dims),
  };
}

function a3Item(id, dims, rules = {}) {
  return { instanceId: id, caseId: id, dims, orientationLock: 'upright', canFlip: false, weight: 20, ...rules };
}

test('A3 Standard fixed hidden cargo blocks every strategy, stays output-free, and empty context preserves parity', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(autoPackEnginePath.href);
  const truck = { length: 40, width: 20, height: 20, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const caseData = { id: 'base', dimensions: { length: 20, width: 20, height: 10 }, weight: 30, orientationLock: 'upright' };
  const hidden = {
    id: 'hidden', caseId: 'base', hidden: true, placement: 'packed',
    transform: { position: { x: 30, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 20, width: 20, height: 10 }, instanceNotes: 'keep',
  };
  const before = JSON.stringify(hidden);
  const context = Engine.buildAutoPackPhysicalContext(
    { truck, cases: [hidden] }, () => caseData, PackLib.getCanonicalInstanceEffectiveDims, zones
  );
  assert.equal(context.ok, true);
  const item = a3Item('movable', { l: 20, w: 20, h: 10 });
  const portfolio = runAdaptiveAutoPack({ truck, zones, items: [item], fixedPlacements: context.fixedPlacements, loadFrontFirst: true });
  assert.deepEqual(portfolio.solutions.map(option => option.id),
    ['default', 'compact-fill', 'floor-first', 'stack-priority', 'max-capacity']);
  for (const option of portfolio.solutions) {
    assert.deepEqual([...option.placements.keys()], ['movable'], `${option.id} owns only the movable item`);
    const pos = option.placements.get('movable');
    const od = option.orientedDims.get('movable');
    const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
    assert.equal(Solver.aabbsOverlap(aabb, context.fixedPlacements[0].aabb), false, `${option.id} respects hidden collision`);
    assert.equal(option.unpacked.includes('hidden'), false);
  }
  const chosen = portfolio.selectedSolution;
  const composed = Engine.buildAutoPackNextCases(
    [hidden, { id: 'movable', caseId: 'base', placement: 'staged', transform: { position: { x: -20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }],
    chosen.placements, chosen.rotations, chosen.orientedDims, new Map()
  );
  assert.equal(JSON.stringify(composed[0]), before, 'hidden persisted fields are byte-identical');
  const absent = Solver.solveAutoPack({ truck, zones, items: [item], loadFrontFirst: true });
  const empty = Solver.solveAutoPack({ truck, zones, items: [item], fixedPlacements: [], loadFrontFirst: true });
  assert.deepEqual([...empty.placements], [...absent.placements]);
  assert.deepEqual([...empty.orientedDims], [...absent.orientedDims]);
  assert.deepEqual(empty.phaseStats, absent.phaseStats);
});

test('A3 fixed support uses normal no-stack, direct-child cap, weight, and Max Capacity strictness', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(autoPackEnginePath.href);
  const truck = { length: 20, width: 20, height: 30, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const basePos = { x: 10, y: 5, z: 0 };
  const baseDims = { l: 20, w: 20, h: 10 };
  const child = a3Item('child', { l: 20, w: 20, h: 10 }, { weight: 20 });
  const solve = (fixed, item = child, extra = {}) => Solver.solveAutoPack({
    truck, zones, items: [item], fixedPlacements: fixed, loadFrontFirst: true, ...extra,
  });
  const base = a3Fixed(Solver, 'base', basePos, baseDims, { weight: 30 });
  const allowed = solve([base]);
  assert.equal(allowed.placements.get('child')?.y, 15, 'movable child may use resolved fixed support');
  assert.equal(allowed.placements.has('base'), false);
  for (const rule of [{ noStackOnTop: true }, { stackable: false }]) {
    assert.deepEqual(solve([a3Fixed(Solver, 'base', basePos, baseDims, rule)]).unpacked, ['child']);
    assert.deepEqual(solve([a3Fixed(Solver, 'base', basePos, baseDims, rule)], child, { maxCapacityMode: true }).unpacked,
      ['child'], 'Max may not relax a fixed support rule');
  }
  const hiddenInst = { id: 'hidden-base', caseId: 'base', hidden: true, placement: 'packed', packedProfile: 'max-capacity',
    transform: { position: basePos, rotation: { x: 0, y: 0, z: 0 } }, orientedDims: { length: 20, width: 20, height: 10 } };
  const blockedCase = { id: 'base', dimensions: { length: 20, width: 20, height: 10 }, weight: 30, noStackOnTop: true };
  const canonicalContext = Engine.buildAutoPackPhysicalContext(
    { truck, cases: [hiddenInst] }, () => blockedCase, PackLib.getCanonicalInstanceEffectiveDims, zones
  );
  assert.equal(canonicalContext.ok, true);
  assert.deepEqual(solve(canonicalContext.fixedPlacements, child, { maxCapacityMode: true }).unpacked, ['child'],
    'canonical fixed rules remain strict even when its saved profile is Max Capacity');
  const heavyChild = a3Item('heavy', { l: 20, w: 20, h: 10 }, { weight: 31 });
  assert.deepEqual(solve([base], heavyChild).unpacked, ['heavy']);
  assert.deepEqual(solve([base], heavyChild, { maxCapacityMode: true }).unpacked, ['heavy'],
    'Max must compare the real movable weight against fixed support');

  const fullHeightBase = a3Fixed(Solver, 'base', basePos, baseDims, { weight: 30, maxStackCount: 1 });
  const existingChild = a3Fixed(Solver, 'existing', { x: 5, y: 15, z: 0 }, { l: 10, w: 20, h: 10 }, { noStackOnTop: true });
  const secondChild = a3Item('second', { l: 10, w: 20, h: 10 }, { weight: 10 });
  assert.deepEqual(solve([fullHeightBase, existingChild], secondChild).unpacked, ['second'],
    'existing fixed direct child consumes the only slot');
  assert.equal(solve([{ ...fullHeightBase, item: { weight: 30, maxStackCount: 2 } }, existingChild], secondChild).placements.size, 1);
});

test('F03 committed Max support survives fixed preflight without relaxing new movable cargo', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(autoPackEnginePath.href);
  const baseCase = { id: 'base', dimensions: { length: 20, width: 20, height: 10 }, weight: 30, noStackOnTop: true };
  const childCase = { id: 'child', dimensions: { length: 20, width: 20, height: 10 }, weight: 20 };
  const cases = [baseCase, childCase];
  const byId = id => cases.find(item => item.id === id) || null;
  const packed = (id, caseId, y, profile = 'max-capacity') => ({
    id, caseId, hidden: true, placement: 'packed', packedProfile: profile,
    transform: { position: { x: 10, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 20, width: 20, height: 10 },
  });
  for (const truck of [
    { length: 20, width: 20, height: 30, shapeMode: 'rect' },
    { length: 60, width: 40, height: 30, shapeMode: 'wheelWells',
      shapeConfig: { wellOffsetFromRear: 20, wellLength: 20, wellHeight: 10, wellWidth: 8 } },
  ]) {
    const zones = PackLib.getTrailerUsableZones(truck);
    const pack = { truck, cases: [packed('base-1', 'base', 5), packed('child-1', 'child', 15)] };
    assert.deepEqual(PackLib.reconcilePlacementsForTruck(pack, truck, cases).invalid, [],
      'committed Max pair is accepted by reconciliation');
    const context = Engine.buildAutoPackPhysicalContext(pack, byId, PackLib.getCanonicalInstanceEffectiveDims, zones);
    assert.equal(context.ok, true, `${truck.shapeMode} fixed preflight preserves the same committed relationship`);
    assert.equal(context.fixedPlacements.length, 2);
    assert.equal(context.fixedPlacements[0].item.weight, 30, 'support keeps its real weight');
    assert.equal(context.fixedPlacements[0].item.noStackOnTop, true, 'stored support rule stays canonical');
    const newMaxChild = a3Item('new-child', { l: 20, w: 20, h: 10 }, { weight: 20 });
    const solved = Solver.solveAutoPack({ truck, zones, items: [newMaxChild],
      fixedPlacements: [context.fixedPlacements[0]], maxCapacityMode: true });
    const newPosition = solved.placements.get('new-child');
    if (newPosition) {
      const newDims = solved.orientedDims.get('new-child');
      const newAabb = Solver.getAabb(newPosition, { l: newDims.length, w: newDims.width, h: newDims.height });
      assert.equal(
        Math.abs(newAabb.min.y - context.fixedPlacements[0].aabb.max.y) <= 0.05 &&
          Solver.computeXzOverlapArea(newAabb, context.fixedPlacements[0].aabb) > 0.05,
        false, 'new movable Max child cannot use the fixed no-stack support'
      );
    } else {
      assert.deepEqual(solved.unpacked, ['new-child']);
    }

    const ordinary = { ...pack, cases: pack.cases.map(inst => ({ ...inst, packedProfile: undefined })) };
    assert.deepEqual(PackLib.reconcilePlacementsForTruck(ordinary, truck, cases).invalid, ['child-1']);
    const rejected = Engine.buildAutoPackPhysicalContext(
      ordinary, byId, PackLib.getCanonicalInstanceEffectiveDims, zones);
    assert.equal(rejected.ok, false);
    assert.match(rejected.reason, /no safe fixed support/);
  }
});

test('A3 unresolved packed geometry is collision-only while unresolved staged cargo is excluded', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(autoPackEnginePath.href);
  const Normalizer = await import(normalizerPath.href);
  const truck = { length: 20, width: 20, height: 20, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const unresolved = {
    id: 'missing', caseId: 'deleted', placement: 'packed', hidden: false,
    transform: { position: { x: 10, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 20, width: 20, height: 10 },
  };
  const normalized = Normalizer.normalizeInstance(unresolved, new Map());
  assert.deepEqual(normalized.orientedDims, unresolved.orientedDims, 'identity missing-Case size survives hydration');
  const staged = { ...structuredClone(unresolved), id: 'staged', placement: 'staged' };
  const context = Engine.buildAutoPackPhysicalContext(
    { truck, cases: [unresolved, staged] }, () => null, PackLib.getCanonicalInstanceEffectiveDims, zones
  );
  assert.equal(context.ok, true);
  assert.equal(context.unresolvedPackedCount, 1);
  assert.equal(context.unresolvedStagedCount, 1);
  assert.equal(context.fixedPlacements[0].collisionOnly, true);
  const item = a3Item('movable', { l: 20, w: 20, h: 10 });
  const result = Solver.solveAutoPack({ truck, zones, items: [item], fixedPlacements: context.fixedPlacements });
  assert.deepEqual(result.unpacked, ['movable'], 'blocker fills floor and is not a trusted stack support');
  assert.equal(result.placements.has('missing'), false);
  const composed = Engine.buildAutoPackNextCases([unresolved, staged], result.placements, result.rotations,
    result.orientedDims, new Map(), context.excludedIds);
  assert.deepEqual(composed, [unresolved, staged], 'neither unresolved item gains mutation authority');
  assert.equal(Engine.buildAutoPackPhysicalContext(
    { truck, cases: [{ ...unresolved, orientedDims: null }] }, () => null, PackLib.getCanonicalInstanceEffectiveDims, zones
  ).ok, false, 'unknown packed dimensions fail closed');
  const malformedPosition = Normalizer.normalizeInstance({
    ...unresolved, transform: { ...unresolved.transform, position: { x: null, y: 5, z: 0 } },
  }, new Map());
  assert.equal(malformedPosition.transform.position.x, null, 'hydration does not fabricate missing-Case position');
  assert.equal(Engine.buildAutoPackPhysicalContext(
    { truck, cases: [malformedPosition] }, () => null, PackLib.getCanonicalInstanceEffectiveDims, zones
  ).ok, false);
  const visibleSupport = {
    id: 'support', caseId: 'base', placement: 'packed', hidden: false,
    transform: { position: { x: 10, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 20, width: 20, height: 10 },
  };
  const restingBlocker = {
    ...unresolved,
    transform: { ...unresolved.transform, position: { x: 10, y: 15, z: 0 } },
  };
  const unsafe = Engine.buildAutoPackPhysicalContext(
    { truck, cases: [restingBlocker, visibleSupport] },
    id => id === 'base' ? { dimensions: visibleSupport.orientedDims, weight: 30 } : null,
    PackLib.getCanonicalInstanceEffectiveDims, zones
  );
  assert.equal(unsafe.ok, false, 'unresolved fixed blocker cannot be left resting on movable cargo');
  assert.match(unsafe.reason, /rests on cargo AutoPack would move/);
});

test('A3 Wheel Wells fixed context blocks collision and supplies only legitimate structural support', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 60, width: 40, height: 30, shapeMode: 'wheelWells',
    shapeConfig: { wellOffsetFromRear: 20, wellLength: 20, wellHeight: 10, wellWidth: 8 } };
  const zones = PackLib.getTrailerUsableZones(truck);
  const fixed = [
    a3Fixed(Solver, 'rear', { x: 10, y: 15, z: 0 }, { l: 20, w: 40, h: 30 }),
    a3Fixed(Solver, 'front', { x: 50, y: 15, z: 0 }, { l: 20, w: 40, h: 30 }),
    a3Fixed(Solver, 'channel', { x: 30, y: 5, z: 0 }, { l: 20, w: 24, h: 10 }),
  ];
  const item = a3Item('bridge', { l: 20, w: 40, h: 10 });
  const options = { truck, zones, items: [item], fixedPlacements: fixed, loadFrontFirst: true, enableWheelWellBridge: true };
  const portfolio = runAdaptiveAutoPack(options);
  assert.ok(portfolio.solutions.some(option => option.id === 'constrained-first'));
  for (const option of portfolio.solutions) {
    for (const [id, pos] of option.placements) {
      const dims = option.orientedDims.get(id);
      const aabb = Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height });
      assert.equal(fixed.some(entry => Solver.aabbsOverlap(aabb, entry.aabb)), false, `${option.id} cannot overlap fixed Wheel Wells cargo`);
    }
    assert.equal(option.placements.has('channel'), false);
  }
  const placed = portfolio.solutions.find(option => option.placements.has('bridge'));
  assert.ok(placed, 'resolved fixed channel cargo completes real well-top support');
  const bridgePos = placed.placements.get('bridge');
  assert.equal(bridgePos.y, 15);
  assert.equal(Solver.isWheelWellSupportedAndStable(
    Solver.getAabb(bridgePos, { l: 20, w: 40, h: 10 }), [], Solver.getWheelWellGeometry(truck), item
  ), false, 'well tops alone do not justify the bridge');
});

test('A3 Front Overhang uses the same hidden fixed cargo for retention and collision, and rejects movable retention dependencies', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(autoPackEnginePath.href);
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const retainerCase = { id: 'wall', dimensions: { length: 24, width: 18, height: 48 }, weight: 30 };
  const retainer = { id: 'wall-1', caseId: 'wall', hidden: true, placement: 'packed',
    transform: { position: { x: 228, y: 24, z: -39 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 24, width: 18, height: 48 } };
  const context = Engine.buildAutoPackPhysicalContext(
    { truck, cases: [retainer] }, () => retainerCase, PackLib.getCanonicalInstanceEffectiveDims, zones
  );
  assert.equal(context.ok, true);
  const deck = a3Item('deck', { l: 24, w: 18, h: 16 }, { weight: 20 });
  const result = Solver.solveAutoPack({ truck, zones, items: [deck], fixedPlacements: context.fixedPlacements, loadFrontFirst: true });
  assert.deepEqual(result.retentionDependencies.get('deck'), ['wall-1'], 'hidden retainer still meets current threshold');
  for (const [id, pos] of result.placements) {
    const dims = result.orientedDims.get(id);
    assert.equal(Solver.aabbsOverlap(Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height }),
      context.fixedPlacements[0].aabb), false, 'retainer is also ordinary collision context');
  }
  const deckCase = { id: 'deck-case', dimensions: { length: 24, width: 18, height: 16 }, weight: 20 };
  const fixedDeck = { id: 'fixed-deck', caseId: 'deck-case', hidden: true, placement: 'packed',
    transform: { position: { x: 252, y: 51.2, z: -39 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 24, width: 18, height: 16 } };
  const visibleRetainer = { ...retainer, id: 'visible-wall', hidden: false };
  const byId = id => id === 'deck-case' ? deckCase : retainerCase;
  const unsafe = Engine.buildAutoPackPhysicalContext(
    { truck, cases: [fixedDeck, visibleRetainer] }, byId, PackLib.getCanonicalInstanceEffectiveDims, zones
  );
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.reason, /rear retention/);
});

test('PLACEMENT-STATE-S2 unpackAll records "staged" placement for every case', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function unpackAll()');
  const end = src.indexOf('\n    function renderInspectorNoPack', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  const helperStart = src.indexOf('export function buildOrganizedUnpackStagingCases(');
  const helperEnd = src.indexOf('\nexport function createEditorScreen', helperStart);
  const helperBlock = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';

  assert.ok(block.length > 0, 'editor-screen must define unpackAll()');
  assert.match(block, /buildOrganizedUnpackStagingCases\(\{/,
    'unpackAll must delegate the complete staged-pose construction to the organized helper');
  assert.match(helperBlock, /placement:\s*'staged',/,
    'the organized helper must mark every resolved case as staged placement');
});

test('UNPACK-CATEGORY-GROUPING staging order keeps case types contiguous and stable', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(typeof EditorScreen.groupInstancesForUnpackStaging, 'function',
    'editor-screen must expose case-type groups so Unpack can stage each case type in its own band');

  const casesById = new Map([
    ['alpha-case', { id: 'alpha-case', category: 'Alpha' }],
    ['beta-case', { id: 'beta-case', category: 'beta' }],
    ['default-case', { id: 'default-case', category: 'default' }],
  ]);
  const instances = [
    { id: 'a-1', caseId: 'alpha-case' },
    { id: 'b-1', caseId: 'beta-case' },
    { id: 'a-2', caseId: 'alpha-case' },
    { id: 'd-1', caseId: 'default-case' },
    { id: 'b-2', caseId: 'beta-case' },
    { id: 'missing-1', caseId: 'missing-case' },
  ];

  const groups = EditorScreen
    .groupInstancesForUnpackStaging(instances, caseId => casesById.get(caseId))
    .map(group => ({ categoryKey: group.categoryKey, ids: group.instances.map(inst => inst.id) }));
  assert.deepEqual(groups, [
    { categoryKey: 'alpha-case', ids: ['a-1', 'a-2'] },
    { categoryKey: 'beta-case', ids: ['b-1', 'b-2'] },
    { categoryKey: 'default-case', ids: ['d-1'] },
    { categoryKey: 'missing-case', ids: ['missing-1'] },
  ], 'unpack staging must keep each case type (caseId) as an explicit contiguous group');
});

test('UNPACK-CATEGORY-GROUPING unpackAll allocates staging slots in grouped order', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function unpackAll()');
  const end = src.indexOf('\n    function renderInspectorNoPack', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /const stagingLayout = PackLibrary\.getStagingLayout\(livePack\.truck \|\| \{\}\);/,
    'unpackAll must derive category staging bands from the canonical staging layout');
  assert.match(block, /buildOrganizedUnpackStagingCases\(\{[\s\S]*instances: livePack\.cases \|\| \[\][\s\S]*stagingLayout/,
    'unpackAll must pass the current cases and canonical staging layout to the organized grouped helper');
});

test('A1.1B AutoPack engine defaults every truck mode to front-first loading', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  // The single source of truth for load direction is the loadFrontFirst flag.
  // It must be unconditionally true so Standard, Wheel Wells, and Front Overhang
  // all pack front-first.
  assert.match(engineSrc, /const loadFrontFirst = true;/,
    'autopack-engine.js must set loadFrontFirst = true for all truck modes');
  // It must no longer gate the direction on a single mode (the old rear-first
  // default for Standard/Wheel Wells).
  assert.doesNotMatch(engineSrc, /loadFrontFirst\s*=\s*mode\s*===\s*['"]frontBonus['"]/,
    'autopack-engine.js must not restrict front-first loading to frontBonus');
});

test('AUTO-PACK-A1-3 AutoPack staging delegates to the canonical staging helper', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const stagingStart = engineSrc.indexOf('function buildStagingMap(packItems, truck)');
  const stagingEnd = engineSrc.indexOf('\n  async function animatePlacements', stagingStart);
  const stagingBlock = stagingStart >= 0 && stagingEnd > stagingStart ? engineSrc.slice(stagingStart, stagingEnd) : '';

  assert.match(stagingBlock, /buildAutoPackStagingMap\(packItems, truck, PackLibrary\.findSafeStagingPosition\)/,
    'staged/unpacked items must delegate to the canonical staging-map helper');
});

test('AUTO-PACK-A1-R1 normalizers add logistics defaults and preserve explicit values', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const now = Date.now();

  const coreDefault = Normalizer.normalizeCase({
    id: 'case-defaults',
    name: 'Defaults',
    dimensions: { length: 48, width: 24, height: 24 },
  }, now);
  assert.equal(coreDefault.laneItem, null);
  assert.equal(coreDefault.loadPriority, 0);
  assert.equal(coreDefault.mustLoadLast, false);
  assert.equal(coreDefault.mustUnloadFirst, false);
  assert.equal(coreDefault.stopGroup, '');
  assert.equal(coreDefault.keepTogetherGroup, '');

  const normalized = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-logistics',
        name: 'Logistics Case',
        dimensions: { length: 96, width: 12, height: 12 },
        laneItem: false,
        loadPriority: 7,
        mustLoadLast: true,
        mustUnloadFirst: true,
        stopGroup: 'Stop A',
        keepTogetherGroup: 'Rack Group',
      },
    ],
    packLibrary: [
      {
        id: 'pack-logistics',
        title: 'Logistics Pack',
        truck: { length: 120, width: 48, height: 48 },
        cases: [
          {
            id: 'inst-logistics',
            caseId: 'case-logistics',
            deliverySequence: 3,
          },
        ],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });
  const normalizedCase = normalized.caseLibrary[0];
  const normalizedInstance = normalized.packLibrary[0].cases[0];

  assert.equal(normalizedCase.laneItem, false,
    'case-level laneItem override must survive normalizeAppData');
  assert.equal(normalizedCase.loadPriority, 7,
    'case-level loadPriority must survive normalizeAppData');
  assert.equal(normalizedCase.mustLoadLast, true,
    'case-level mustLoadLast must survive normalizeAppData');
  assert.equal(normalizedCase.mustUnloadFirst, true,
    'case-level mustUnloadFirst must survive normalizeAppData');
  assert.equal(normalizedCase.stopGroup, 'Stop A',
    'case-level stopGroup must survive normalizeAppData');
  assert.equal(normalizedCase.keepTogetherGroup, 'Rack Group',
    'case-level keepTogetherGroup must survive normalizeAppData');
  assert.equal(normalizedInstance.deliverySequence, 3,
    'instance-level deliverySequence must survive normalizeAppData');

  const normalizedDefaultInstance = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-instance-default',
        name: 'Instance Default',
        dimensions: { length: 24, width: 24, height: 24 },
      },
    ],
    packLibrary: [
      {
        id: 'pack-instance-default',
        title: 'Instance Default Pack',
        cases: [{ id: 'inst-default', caseId: 'case-instance-default' }],
      },
    ],
    folderLibrary: [],
    preferences: {},
  }).packLibrary[0].cases[0];

  assert.equal(normalizedDefaultInstance.deliverySequence, null,
    'instance-level deliverySequence default must be null');
});

test('AUTO-PACK-A1-R1 solver scaffold is pure and returns the expected output shape', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  const executableSrc = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /import\s+.*from\s+['"][^'"]*(?:three|supabase|stripe|billing|state-store|ui-components)/i,
    'solver scaffold must not import app infrastructure or payment/auth dependencies');
  assert.doesNotMatch(executableSrc, /\b(?:window|document|localStorage|StateStore|UIComponents)\b/,
    'solver scaffold must remain independent of browser globals and app state');

  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const output = Solver.solveAutoPack({
    truck: { length: 120, width: 48, height: 48 },
    zones: [],
    items: [],
  });

  assert.ok(output.placements instanceof Map,
    'solveAutoPack must expose placements as a Map');
  assert.ok(output.rotations instanceof Map,
    'solveAutoPack must expose rotations as a Map');
  assert.ok(output.orientedDims instanceof Map,
    'solveAutoPack must expose orientedDims as a Map');
  assert.deepEqual(output.unpacked, []);
  assert.deepEqual(output.warnings, []);
  assert.deepEqual(output.phaseStats, {
    laneCount: 0,
    floorCount: 0,
    stackCount: 0,
    fillerCount: 0,
    unpackedCount: 0,
  });

  assert.equal(
    Solver.classifyAutoPackItem({ dimensions: { length: 96, width: 12, height: 12 } }),
    'LANE_ITEM',
    'long aspect-ratio items must be classified as lane candidates'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ dimensions: { length: 60, width: 20, height: 20 } }),
    'STANDARD',
    'ratio-3 medium boxes must not be auto-classified as lane items'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ dimensions: { length: 72, width: 48, height: 40 } }),
    'STANDARD',
    'blocky cases with one large dimension must not be auto-classified as lane items'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ shape: 'drum', dimensions: { length: 24, width: 24, height: 24 } }),
    'STANDARD',
    'short round shapes must not be forced into long-item lane handling'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ laneItem: true, shape: 'drum', dimensions: { length: 24, width: 24, height: 24 } }),
    'LANE_ITEM',
    'laneItem=true must still allow manual lane classification for round items'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ laneItem: false, shape: 'drum', dimensions: { length: 24, width: 24, height: 24 } }),
    'STANDARD',
    'laneItem=false must prevent automatic lane classification'
  );
  assert.equal(
    Solver.classifyAutoPackItem({
      orientationLocked: true,
      lockedRotation: { z: Math.PI / 2 },
      dimensions: { length: 120, width: 12, height: 12 },
    }),
    'STANDARD',
    'manual orientation locks must classify by effective floor footprint instead of raw long dimension'
  );
  assert.equal(
    Solver.computeSupportFraction(
      Solver.getAabb({ x: 0, y: 15, z: 0 }, { l: 20, w: 20, h: 10 }),
      [Solver.getAabb({ x: 0, y: 5, z: 0 }, { l: 20, w: 20, h: 10 })]
    ),
    1,
    'support math must report full footprint support when AABBs align'
  );
});

test('AUTO-PACK-A1-R3 floor solver packs rectangular floor positions without gaps or overlaps', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = Array.from({ length: 4 }, (_, index) => ({
    instanceId: `box-${index + 1}`,
    dims: { l: 48, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 4);

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    const dims = { l: od.length, w: od.width, h: od.height };
    return Solver.getAabb(pos, dims);
  });

  for (let i = 0; i < packed.length; i++) {
    assert.equal(packed[i].min.y, 0, 'floor solver must keep floor-fit boxes on the floor');
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true,
      'floor solver must keep every packed AABB inside a usable zone');
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'floor solver must not overlap packed floor items');
    }
  }

  const bounds = packed.reduce(
    (acc, aabb) => ({
      minX: Math.min(acc.minX, aabb.min.x),
      maxX: Math.max(acc.maxX, aabb.max.x),
      minZ: Math.min(acc.minZ, aabb.min.z),
      maxZ: Math.max(acc.maxZ, aabb.max.z),
      area: acc.area + (aabb.max.x - aabb.min.x) * (aabb.max.z - aabb.min.z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, area: 0 }
  );
  assert.equal(bounds.area, (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ),
    'exact floor-fit boxes should form one gap-free floor block even when yaw rotation is selected');
  assert.equal(bounds.minX, 0,
    'gap-free floor block should start against the load-side wall');
  assert.equal(bounds.minZ, -24);
  assert.equal(bounds.maxZ, 24,
    'gap-free floor block should use the full truck width');
});

test('AUTO-PACK-A1-R3 floor solver consumes supplied wheel-well usable zones', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 30, width: 48, height: 48 };
  const zones = [
    { min: { x: 0, y: 0, z: -8 }, max: { x: 30, y: 48, z: 8 } },
    { min: { x: 0, y: 15, z: -24 }, max: { x: 30, y: 48, z: -8 } },
    { min: { x: 0, y: 15, z: 8 }, max: { x: 30, y: 48, z: 24 } },
  ];
  const items = Array.from({ length: 3 }, (_, index) => ({
    instanceId: `well-${index + 1}`,
    dims: { l: 30, w: 16, h: 10 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);

  const bottoms = [];
  for (const item of items) {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
    bottoms.push(aabb.min.y);
    assert.equal(Solver.isAabbContainedInAnyZone(aabb, zones), true,
      'wheel-well floor solver must use supplied usable zones instead of a plain rectangle');
  }
  assert.equal(bottoms.includes(15), true,
    'wheel-well side zones must place items at the elevated well floor, not inside the blocked well volume');
});

test('AUTO-PACK-A1-R3 floor solver respects front-bonus height and width zones', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [
    { min: { x: 0, y: 0, z: -24 }, max: { x: 80, y: 48, z: 24 } },
    { min: { x: 80, y: 0, z: -12 }, max: { x: 120, y: 20, z: 12 } },
  ];
  const items = [
    { instanceId: 'short-bonus', loadPriority: 2, dims: { l: 30, w: 20, h: 15 } },
    { instanceId: 'tall-main', loadPriority: 1, dims: { l: 30, w: 20, h: 30 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, []);

  const short = Solver.getAabb(output.placements.get('short-bonus'), { l: 30, w: 20, h: 15 });
  const tallOd = output.orientedDims.get('tall-main');
  const tall = Solver.getAabb(output.placements.get('tall-main'), {
    l: tallOd.length,
    w: tallOd.width,
    h: tallOd.height,
  });

  assert.equal(short.min.x >= 80, true,
    'front-to-rear floor pass should use the valid short front-bonus zone first');
  assert.equal(tall.max.x <= 80, true,
    'items taller than the front bonus must stay in the main trailer zone');
  assert.equal(Solver.isAabbContainedInAnyZone(short, zones), true);
  assert.equal(Solver.isAabbContainedInAnyZone(tall, zones), true);
});

test('AUTO-PACK-A1-R4 stack phase runs only after floor positions are exhausted', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 48, z: 24 } }];
  const items = Array.from({ length: 6 }, (_, index) => ({
    instanceId: `cube-${index + 1}`,
    dims: { l: 24, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 6);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 4,
    'floor pass must fill the four valid floor cells before stack phase runs');
  assert.equal(output.phaseStats.stackCount, 2,
    'stack pass must place the remaining cubes only after the floor is full');

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  assert.equal(packed.filter(aabb => aabb.min.y === 0).length, 4);
  assert.equal(packed.filter(aabb => aabb.min.y === 24).length, 2);

  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'stacked output must not collide with floor or stack placements');
    }
  }
});

test('AUTO-PACK-A1-R4 stack phase requires meaningful support area', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'small-support', laneItem: true, dims: { l: 16, w: 16, h: 24 } },
    { instanceId: 'large-top', loadPriority: 1, dims: { l: 24, w: 24, h: 12 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 1);
  assert.deepEqual(output.unpacked, ['large-top']);
  assert.equal(output.phaseStats.stackCount, 0,
    'a large item must not be stacked on a small support with less than 50% support');
});

test('AUTO-PACK-A1-R4 stack phase enforces maxStackCount for direct support children', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 48, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'wide-base', loadPriority: 3, maxStackCount: 1, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'top-a', loadPriority: 2, stackable: false, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'top-b', loadPriority: 1, stackable: false, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, ['top-b']);
  assert.equal(output.phaseStats.floorCount, 1);
  assert.equal(output.phaseStats.stackCount, 1,
    'maxStackCount=1 must allow only one direct child on the wide base');
});

test('AUTO-PACK-A1-R5.5 stack phase blocks heavy items on lighter non-pallet supports', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'priority-light-base', laneItem: true, loadPriority: 100, weight: 20, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'heavy-deferred', loadPriority: 1, weight: 220, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 1);
  assert.deepEqual(output.unpacked, ['heavy-deferred']);
  assert.equal(output.phaseStats.stackCount, 0,
    'loadPriority must not allow a heavier item to stack on a lighter non-pallet support');
});

test('AUTO-PACK-A1-R5.5 stack phase allows light items on heavier supports', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'heavy-base', loadPriority: 10, weight: 220, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'light-top', loadPriority: 1, weight: 20, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 1,
    'lighter items may still stack on heavier safe supports');
});

test('AUTO-PACK-A1-R5.5 pallet supports are exempt from support-weight comparison', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'pallet-base', loadPriority: 10, isPallet: true, weight: 20, dims: { l: 24, w: 24, h: 12 } },
    { instanceId: 'heavy-pallet-load', loadPriority: 1, weight: 220, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 1,
    'pallet support behavior should not be derived from pallet tare weight');
});

test('5A stacking prefers the lower layer before opening a higher layer', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 120 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 120, z: 24 } }];
  const items = [
    { instanceId: 'A', dims: { l: 48, w: 48, h: 24 }, weight: 1000 },
    { instanceId: 'C1', dims: { l: 24, w: 48, h: 24 }, weight: 10 },
    { instanceId: 'C2', dims: { l: 24, w: 48, h: 24 }, weight: 10 },
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  const aabb = id => {
    const od = out.orientedDims.get(id);
    return Solver.getAabb(out.placements.get(id), { l: od.length, w: od.width, h: od.height });
  };
  assert.equal(aabb('C1').min.y, 24);
  assert.equal(aabb('C2').min.y, 24,
    'both children fill the single lower stack layer; the lexicographic score must not push one to a needless higher layer');
});

test('5A repeated identical cases pack with no overlaps and a safe stacking contract', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 96 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 96, z: 24 } }];
  const items = Array.from({ length: 12 }, (_, i) => ({ instanceId: `r${i}`, dims: { l: 24, w: 24, h: 24 }, weight: 50 }));
  const itemsById = new Map(items.map(it => [it.instanceId, it]));
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  assert.equal(out.placements.size, 12);
  assert.deepEqual(out.unpacked, []);
  assertStackSafeOutput(Solver, out, itemsById, zones, 'repeated-cases');
});

test('5A final solver output independently satisfies the stacking-safety contract', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);

  // Real multi-layer stacking onto a maxStackCount-limited base.
  const capTruck = { length: 72, width: 24, height: 72 };
  const capZones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 72, y: 72, z: 12 } }];
  const capItems = [
    { instanceId: 'base', dims: { l: 72, w: 24, h: 24 }, weight: 1000, maxStackCount: 2 },
    { instanceId: 'c1', dims: { l: 24, w: 24, h: 24 }, weight: 10 },
    { instanceId: 'c2', dims: { l: 24, w: 24, h: 24 }, weight: 10 },
    { instanceId: 'c3', dims: { l: 24, w: 24, h: 24 }, weight: 10 },
  ];
  const capOut = Solver.solveAutoPack({ truck: capTruck, zones: capZones, items: capItems, loadFrontFirst: true });
  assertStackSafeOutput(Solver, capOut, new Map(capItems.map(it => [it.instanceId, it])), capZones, 'maxStack-tower');

  // Mixed weights and a noStackOnTop base in the same run.
  const mixTruck = { length: 48, width: 48, height: 120 };
  const mixZones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 120, z: 24 } }];
  const mixItems = [
    { instanceId: 'frag', dims: { l: 48, w: 48, h: 24 }, weight: 1500, noStackOnTop: true },
    { instanceId: 'heavy', dims: { l: 24, w: 24, h: 24 }, weight: 900 },
    ...Array.from({ length: 8 }, (_, i) => ({ instanceId: `m${i}`, dims: { l: 24, w: 24, h: 24 }, weight: 100 })),
  ];
  const mixOut = Solver.solveAutoPack({ truck: mixTruck, zones: mixZones, items: mixItems, loadFrontFirst: true });
  assertStackSafeOutput(Solver, mixOut, new Map(mixItems.map(it => [it.instanceId, it])), mixZones, 'mixed-weights');
});

test('5A engine adapter forwards stacking metadata from caseData to the solver', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const start = src.indexOf('runAdaptiveAutoPack({');
  assert.ok(start !== -1, 'engine must call runAdaptiveAutoPack');
  const block = src.slice(start, start + 1400);
  assert.match(block, /const rules = getSolverCargoRules\(inst, caseData\);/,
    'engine must normalize solver cargo rules before forwarding them');
  assert.match(block, /noStackOnTop:\s*rules\.noStackOnTop/, 'engine must forward noStackOnTop from normalized case rules');
  assert.match(block, /stackable:\s*rules\.stackable/, 'engine must forward stackable from normalized case rules');
  assert.match(block, /maxStackCount:\s*rules\.maxStackCount/, 'engine must forward maxStackCount from normalized case rules');
  assert.match(block, /isPallet:\s*rules\.isPallet/, 'engine must forward isPallet from normalized case rules');
  assert.match(block, /weight:\s*caseData\.weight/, 'engine must forward weight from caseData');
  assert.match(block, /enableWheelWellBridge:\s*mode === 'wheelWells'/,
    'production AutoPack must activate bridge/build-up only for Wheel Wells');
});

test('AUTO-PACK-A1-R5 lane phase places long items lengthwise before normal boxes', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'tube-a', dims: { l: 96, w: 8, h: 8 } },
    { instanceId: 'tube-b', dims: { l: 96, w: 8, h: 8 } },
    { instanceId: 'normal-box-a', loadPriority: 100, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'normal-box-b', loadPriority: 100, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.laneCount, 2,
    'long aspect-ratio items must be placed by the lane phase before normal floor items');
  assert.equal(output.phaseStats.floorCount, 2);

  const aabbs = new Map();
  for (const item of items) {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    const dims = { l: od.length, w: od.width, h: od.height };
    const aabb = Solver.getAabb(pos, dims);
    aabbs.set(item.instanceId, aabb);
    assert.equal(Solver.isAabbContainedInAnyZone(aabb, zones), true);
  }

  for (const tubeId of ['tube-a', 'tube-b']) {
    const od = output.orientedDims.get(tubeId);
    assert.equal(od.length, 96,
      'lane phase must keep tube/truss items aligned lengthwise along X');
    assert.equal(od.width, 8);
    assert.equal(od.height, 8);
    assert.equal(aabbs.get(tubeId).min.y, 0,
      'lane items should sit on the floor lane, not float or stack');
  }

  const packed = [...aabbs.values()];
  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'lane reservations must prevent normal boxes from colliding with long items');
    }
  }
});

test('AUTO-PACK-A1-R5 lane phase unpacks long items that cannot fit a safe lengthwise lane', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'oversize-rail', dims: { l: 144, w: 8, h: 8 } },
    { instanceId: 'normal-box', dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.has('oversize-rail'), false);
  assert.deepEqual(output.unpacked, ['oversize-rail']);
  assert.equal(output.phaseStats.laneCount, 0);
  assert.equal(output.phaseStats.floorCount, 1,
    'normal boxes should still use the floor phase when an oversized lane item is unpacked');
  assert.match(output.warnings.join('\n'), /oversize-rail.*lengthwise lane/,
    'oversized lane failures should be reported as lane placement failures');
});

test('AUTO-PACK-A1-R6.3 failed lane items retry through safe stack path before staging', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 48, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'lane-base', laneItem: true, weight: 100, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'lane-top-retry', laneItem: true, weight: 20, dims: { l: 48, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2,
    'failed lane item must be retried through the normal safe placement pipeline before staging');
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.laneCount, 1);
  assert.equal(output.phaseStats.stackCount, 1,
    'lane retry should be allowed to use a safe supported stack after floor lane space is full');

  const topDims = output.orientedDims.get('lane-top-retry');
  const topAabb = Solver.getAabb(output.placements.get('lane-top-retry'), {
    l: topDims.length,
    w: topDims.width,
    h: topDims.height,
  });
  assert.equal(topAabb.min.y, 24,
    'retried lane item should sit on the safe support instead of being staged');
});

test('AUTO-PACK-A1-R6.1 filler pass uses floor voids before stacking', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 60, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 60, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'large-a', dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'large-b', dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'small-filler', dims: { l: 12, w: 24, h: 12 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 2,
    'large floor items should be placed before the filler pass');
  assert.equal(output.phaseStats.fillerCount, 1,
    'small floor-gap item must be counted as filler placement');
  assert.equal(output.phaseStats.stackCount, 0,
    'filler pass must use remaining floor voids before stack phase');

  const fillerPos = output.placements.get('small-filler');
  const fillerDims = output.orientedDims.get('small-filler');
  const fillerAabb = Solver.getAabb(fillerPos, {
    l: fillerDims.length,
    w: fillerDims.width,
    h: fillerDims.height,
  });
  assert.equal(fillerAabb.min.y, 0,
    'filler placement must remain on the floor when a valid floor void exists');
  assert.equal(Solver.isAabbContainedInAnyZone(fillerAabb, zones), true);
});

test('AUTO-PACK-A1-R6.1 floor candidates and compaction keep mixed-width rows tight', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 60, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 60, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'row-a', dims: { l: 60, w: 20, h: 12 } },
    { instanceId: 'row-b', dims: { l: 60, w: 20, h: 12 } },
    { instanceId: 'row-fill', dims: { l: 60, w: 8, h: 8 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.equal(output.phaseStats.stackCount, 0);

  const floorAabbs = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  }).sort((a, b) => a.min.z - b.min.z);

  assert.equal(floorAabbs[0].min.z, -24,
    'mixed-width floor row should start against the left wall');
  assert.equal(floorAabbs.at(-1).max.z, 24,
    'mixed-width floor row should end against the right wall');
  for (let i = 1; i < floorAabbs.length; i++) {
    assert.equal(floorAabbs[i - 1].max.z, floorAabbs[i].min.z,
      'mixed-width floor row should have no gap between adjacent cases');
  }
  for (let i = 0; i < floorAabbs.length; i++) {
    assert.equal(floorAabbs[i].min.y, 0);
    for (let j = i + 1; j < floorAabbs.length; j++) {
      assert.equal(Solver.aabbsOverlap(floorAabbs[i], floorAabbs[j]), false);
    }
  }
});

test('AUTO-PACK-A1-R6.1 stack scoring fills lower layers before higher layers', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 72, z: 12 } }];
  const items = Array.from({ length: 3 }, (_, index) => ({
    instanceId: `layer-${index + 1}`,
    dims: { l: 24, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 1);
  assert.equal(output.phaseStats.stackCount, 2);

  const bottoms = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.y;
  }).sort((a, b) => a - b);
  assert.deepEqual(bottoms, [0, 24, 48],
    'stack phase must build supported lower layers before placing higher layers');
});

test('AUTO-PACK-A1-R6.3 stack order supports descending-weight multi-layer stacks', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 96 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 96, z: 12 } }];
  const items = [100, 90, 80, 70].map((weight, index) => ({
    instanceId: `weighted-layer-${index + 1}`,
    weight,
    dims: { l: 24, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4,
    'lighter upper cases should keep stacking when each support is heavier than the case above');
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 3);

  const bottoms = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.y;
  }).sort((a, b) => a - b);
  assert.deepEqual(bottoms, [0, 24, 48, 72],
    'descending-weight stack order should build every lower layer before staging valid upper layers');
});

test('AUTO-PACK-A1-R6.1 solver keeps final validation gate for unsafe packed placements', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  // TypeScript 7 checkJs migration: the 4th parameter was previously read via
  // `arguments[3]` (untypeable under checkJs) and is now a named `options = {}`
  // parameter — same runtime contract, just declared instead of implicit.
  assert.match(src, /function validatePackedPlacements\(output, packed, zones, options = \{\}\)/,
    'solver must keep a final validation sweep before returning live placements');
  assert.match(src, /outside usable zones/,
    'validation gate must reject out-of-zone placements');
  assert.match(src, /overlaps another packed item/,
    'validation gate must reject packed overlaps');
  assert.match(src, /does not have safe stack support/,
    'validation gate must reject floating or unsupported stacks');
  assert.match(src, /output\.unpacked = \[\.\.\.unpacked\];/,
    'validation failures must be staged through the existing unpacked output path');
});

test('A2 equal-count repack hands final accepted records to every later solver consumer', async () => {
  // The public solver has no deterministic fixture known to force a rejected
  // placement to repack at a new pose while preserving the accepted count.
  // Pin and execute the narrow production handoff instead of adding a hook.
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  const start = src.indexOf('  const finalValidation = validatePackedPlacements(');
  const end = src.indexOf('  const runWheelWellFrontCompression =', start);
  assert.ok(start >= 0 && end > start, 'the final-validation handoff exists');
  const handoffRegion = src.slice(start, end);
  const handoff = handoffRegion.match(/\n  packed\.length = 0;\n  packed\.push\(\.\.\.finalValidation\.accepted\);\n/);
  assert.ok(handoff, 'the final accepted array must replace packed unconditionally');
  assert.doesNotMatch(handoffRegion, /finalValidation\.accepted\.length\s*!==\s*packed\.length/,
    'equal length must not stand in for equal placement identity');

  const oldA = { instanceId: 'A', pos: { x: 50 }, phase: 'stack' };
  const finalA = { instanceId: 'A', pos: { x: 30 }, phase: 'floor' };
  const b = { instanceId: 'B', pos: { x: 10 }, phase: 'floor' };
  const packed = [oldA, b];
  const accepted = [finalA, b];
  runInNewContext(handoff[0], { packed, finalValidation: { accepted } });
  assert.equal(packed.length, 2, 'the repair retained the same placement count');
  assert.equal(packed[0], finalA, 'the changed pose and phase now own the mutable working array');

  const statsStart = src.indexOf('function refreshPhaseStats(output, packed) {');
  const statsEnd = src.indexOf('\nfunction recordRetentionDependencies(', statsStart);
  assert.ok(statsStart >= 0 && statsEnd > statsStart);
  const output = { phaseStats: {}, unpacked: [] };
  runInNewContext(`${src.slice(statsStart, statsEnd)}\nrefreshPhaseStats(output, packed);`, { output, packed });
  assert.equal(output.phaseStats.floorCount, 2, 'a downstream phase consumer sees the final phase');
  assert.equal(output.phaseStats.stackCount, 0, 'the stale pre-repack phase is gone');

  const laterRegion = src.slice(end, src.indexOf('  return output;', end));
  for (const consumer of [
    'compressWheelWellPlacementsForward(',
    'refreshPhaseStats(output, packed);',
    'recordRetentionDependencies(output, packed, retentionContext);',
  ]) {
    assert.ok(laterRegion.includes(consumer), `${consumer} must consume packed after the handoff`);
  }
  assert.match(handoffRegion, /writeOutputPlacements\(output, finalValidation\.accepted\);/,
    'a final rejection rebuilds all output maps from accepted records');
  const repackRegion = src.slice(src.indexOf('function repackRejectedPlacements('), statsStart);
  assert.match(repackRegion, /writeOutputPlacements\(output, repacked\);/,
    'repack starts maps from accepted records');
  assert.match(repackRegion, /recordPlacement\(output, repacked, item, (?:floorPlacement|stackPlacement), '(?:floor|stack)'\);/,
    'each repaired record also updates the output maps');
});

test('AUTO-PACK-A1-R6.3 floor compaction rebuilds free space before filler and stack phases', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(src, /function compactFloorPlacements\(\s*output,\s*packed,\s*zones,\s*loadFrontFirst,\s*frontSurfaceFirst = false,\s*retentionContext = null,\s*options = \{\}\s*\)/,
    'solver must keep a dedicated floor compaction pass');
  assert.match(src, /const includeLockedGrid = options\.includeLockedGrid === true;/,
    'floor compaction must keep locked-grid movement opt-in for shape-specific passes');
  assert.match(src, /const allowCompatibleZoneMoves = options\.allowCompatibleZoneMoves === true;/,
    'floor compaction must keep cross-zone movement opt-in for shape-specific passes');
  assert.doesNotMatch(src, /function compactFloorPlacements[\s\S]*?\{\s*void output;\s*void packed;\s*void zones;\s*void loadFrontFirst;/,
    'floor compaction must not regress to the old no-op implementation');
  assert.match(src, /floorState\.freeRects = \(budget\.cleanupExpired\(\)[\s\S]*?compactFloorPlacements\(\s*output,\s*packed,\s*floorZones,\s*loadFrontFirst,\s*frontSurfaceFirst,\s*retentionContext,\s*\{ \.\.\.floorCompactionOptions, budget \}\s*\)\)\.freeRects;/,
    'compaction must rebuild the free-space map before later placement phases use it while respecting cleanup budget');
  assert.match(src, /writeOutputPlacements\(output, packed\);/,
    'accepted compaction moves must be reflected in the solver output maps');
});

test('AUTO-PACK-A1-R6.3 large mixed packs use bounded scaled anchor caps', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(src, /const BASE_ANCHOR_CAP = 18;/,
    'small packs must keep the previous 18-anchor baseline');
  assert.match(src, /const MAX_ANCHOR_CAP = 24;/,
    'large-pack anchor expansion must stay bounded for solver runtime');
  assert.match(src, /function anchorCapForPackedCount\(packed = \[\]\)/,
    'anchor cap must scale from packed count instead of using a fixed magic value');
  assert.match(src, /Math\.min\(MAX_ANCHOR_CAP, BASE_ANCHOR_CAP \+ Math\.floor\(count \/ 30\) \* 2\)/,
    'anchor scaling must ramp gradually for large mixed packs');
  const scaledCapUses = src.match(/capAnchorValues\(anchors, anchorCapForPackedCount\(packed\), scoreAnchor, comparator\)/g) || [];
  assert.equal(scaledCapUses.length, 2,
    'floor and stack anchor builders must both use the scaled bounded cap');
});

test('AUTO-PACK-A1-R6.2 free-space floor pass does not stage an item that fits a remaining floor rectangle', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 72, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 72, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'wide-left', orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 30, h: 24 } },
    { instanceId: 'side-void-fit', orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 18, h: 24 } },
    { instanceId: 'front-a', orientationLocked: true, lockedRotation: {}, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'front-b', orientationLocked: true, lockedRotation: {}, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 0,
    'free-space floor pass must consume real floor rectangles before stacking');

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(packed[i].min.y, 0);
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false);
    }
  }

  const sideVoid = Solver.getAabb(
    output.placements.get('side-void-fit'),
    {
      l: output.orientedDims.get('side-void-fit').length,
      w: output.orientedDims.get('side-void-fit').width,
      h: output.orientedDims.get('side-void-fit').height,
    }
  );
  assert.equal(sideVoid.min.x, 0,
    'item that exactly fits the side floor void should stay in that void instead of moving forward or staging');
});

test('AUTO-PACK-A1-R6.2 Basic Fit keeps footprint compactness ahead of loadPriority', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 96, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 96, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'large-a', loadPriority: 0, orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'large-b', loadPriority: 0, orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'priority-small', loadPriority: 999, orientationLocked: true, lockedRotation: {}, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);

  const largeADims = output.orientedDims.get('large-a');
  const largeBDims = output.orientedDims.get('large-b');
  const smallDims = output.orientedDims.get('priority-small');
  const largeA = Solver.getAabb(output.placements.get('large-a'), {
    l: largeADims.length,
    w: largeADims.width,
    h: largeADims.height,
  });
  const largeB = Solver.getAabb(output.placements.get('large-b'), {
    l: largeBDims.length,
    w: largeBDims.width,
    h: largeBDims.height,
  });
  const small = Solver.getAabb(output.placements.get('priority-small'), {
    l: smallDims.length,
    w: smallDims.width,
    h: smallDims.height,
  });
  assert.deepEqual([largeA.min.x, largeB.min.x].sort((a, b) => a - b), [0, 0],
    'larger footprint items should form the rear floor row before a high-priority small case in Basic Fit');
  assert.equal(small.min.x >= 48, true,
    'loadPriority must not be allowed to create a sparse rear floor row in Basic Fit');
});

test('AUTO-PACK-A1-R6.2 long lanes reserve strips without wasting adjacent floor width', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'long-truss', dims: { l: 120, w: 12, h: 12 } },
    { instanceId: 'box-a', dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'box-b', dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'box-c', dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.laneCount, 1);
  assert.equal(output.phaseStats.floorCount, 3,
    'normal boxes should use the floor width left beside the long lane');

  const packed = items.map(item => {
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(output.placements.get(item.instanceId), {
      l: od.length,
      w: od.width,
      h: od.height,
    });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false);
    }
  }
});

test('AUTO-PACK-A1-R6.2 stack free-space fills the lower support layer before higher layers', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 72, z: 24 } }];
  const items = [
    { instanceId: 'base', weight: 300, dims: { l: 48, w: 48, h: 24 } },
    ...Array.from({ length: 5 }, (_, index) => ({
      instanceId: `top-${index + 1}`,
      weight: 20,
      dims: { l: 24, w: 24, h: 24 },
    })),
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 6);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 1);
  assert.equal(output.phaseStats.stackCount, 5);

  const topBottoms = items.slice(1).map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.y;
  });
  assert.equal(topBottoms.filter(y => y === 24).length, 4,
    'stack pass should fill all four lower layer cells on the base before using a higher layer');
  assert.equal(topBottoms.filter(y => y === 48).length, 1,
    'only the remaining item should advance to the next stack layer');
});

test('AUTO-PACK-A1-R6.3 floor allocator keeps placeable mixed cases out of staging', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 60, height: 60 };
  const zones = [{ min: { x: 0, y: 0, z: -30 }, max: { x: 120, y: 60, z: 30 } }];
  const dims = [
    [60, 20, 20],
    [60, 20, 20],
    [60, 20, 20],
    [48, 30, 20],
    [12, 20, 12],
    [60, 30, 20],
    [20, 20, 20],
    [60, 20, 20],
    [48, 30, 20],
    [48, 30, 20],
  ];
  const items = dims.map(([l, w, h], index) => ({
    instanceId: `gap-regression-${index + 1}`,
    orientationLocked: true,
    lockedRotation: {},
    dims: { l, w, h },
    weight: 20,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, items.length,
    'free-space allocator must not stage a compatible item when packed-edge floor/stack space remains');
  assert.deepEqual(output.unpacked, []);

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'packed-edge gap refill must not create collisions');
    }
  }
});

test('AUTO-PACK-A1-R6.3 stack surface builder merges adjacent supports into one usable layer', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const supportDims = { l: 24, w: 24, h: 24 };
  const supports = [
    { instanceId: 'support-a', pos: { x: 12, y: 12, z: -12 } },
    { instanceId: 'support-b', pos: { x: 36, y: 12, z: -12 } },
    { instanceId: 'support-c', pos: { x: 12, y: 12, z: 12 } },
    { instanceId: 'support-d', pos: { x: 36, y: 12, z: 12 } },
  ].map(support => ({
    instanceId: support.instanceId,
    item: { item: { weight: 100 } },
    aabb: Solver.getAabb(support.pos, supportDims),
  }));

  const rects = Solver.buildStackLayerFreeRects(supports, 24);
  assert.equal(rects.some(rect =>
    rect.minX === 0 &&
    rect.maxX === 48 &&
    rect.minZ === -24 &&
    rect.maxZ === 24
  ), true,
  'stack phase must see adjacent same-height support cases as one usable supported surface');
});

test('AUTO-PACK-A1-R6.4 repeated non-flippable cases keep one shelf-grid orientation plus legal residual completion', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98 };
  const zones = [{ min: { x: 0, y: 0, z: -51 }, max: { x: 636, y: 98, z: 51 } }];
  const items = Array.from({ length: 78 }, (_, index) => ({
    instanceId: `repeated-panel-${index + 1}`,
    caseId: 'wide-flat-scenic-panel',
    dims: { l: 60, w: 20, h: 20 },
    weight: 180,
    canFlip: false,
    stackable: true,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 78);
  assert.deepEqual(output.unpacked, []);

  const dimsCounts = new Map();
  for (const dims of output.orientedDims.values()) {
    const key = JSON.stringify(dims);
    dimsCounts.set(key, (dimsCounts.get(key) || 0) + 1);
  }
  assert.equal(dimsCounts.get(JSON.stringify({ length: 60, width: 20, height: 20 })), 77,
    'the repeated shelf grid keeps its selected majority orientation');
  assert.equal(dimsCounts.get(JSON.stringify({ length: 20, width: 60, height: 20 })), 1,
    'one alternate-yaw case completes the otherwise usable residual floor strip');

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones, 0.001), true,
      'repeated shelf-grid placements must stay fully inside the trailer AABB');
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'repeated shelf-grid placements must not overlap');
    }
  }

  const floorLayer = packed.filter(aabb => aabb.min.y === 0);
  assert.equal(floorLayer.length, 51,
    'repeated 60x20x20 cases should fill the 10 by 5 shelf grid and its one legal residual floor opening before stacking');
  const firstColumnCenters = items.slice(0, 5).map(item => output.placements.get(item.instanceId));
  assert.deepEqual(firstColumnCenters.map(pos => pos.x), [30, 30, 30, 30, 30],
    'batch grid should fill width at the current load-side X slice before advancing length');
  assert.deepEqual(firstColumnCenters.map(pos => pos.z), [-41, -21, -1, 19, 39],
    'batch grid should create contiguous width rows without midpoint gaps');
});

test('AUTO-PACK-A1-R6.4 repeated batch compaction does not break shelf rows', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98 };
  const zones = [{ min: { x: 0, y: 0, z: -51 }, max: { x: 636, y: 98, z: 51 } }];
  const items = Array.from({ length: 78 }, (_, index) => ({
    instanceId: `flat-panel-${index + 1}`,
    caseId: 'flat-panel',
    dims: { l: 48, w: 24, h: 24 },
    weight: 80,
    canFlip: false,
    stackable: true,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 78);
  assert.deepEqual(output.unpacked, []);

  const firstRow = items.slice(0, 4).map(item => output.placements.get(item.instanceId));
  assert.deepEqual(firstRow.map(pos => pos.x), [24, 24, 24, 24]);
  assert.deepEqual(firstRow.map(pos => pos.z), [-39, -15, 9, 33],
    'floor compaction must not split a deterministic repeated-case row');
  assert.equal(output.phaseStats.floorCount, 52);
  assert.equal(output.phaseStats.stackCount, 26);
});

test('AUTO-PACK-A1-R6.5 repeated flippable flat panels prefer low shelf orientation when the batch fits', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98 };
  const zones = [{ min: { x: 0, y: 0, z: -51 }, max: { x: 636, y: 98, z: 51 } }];
  const items = Array.from({ length: 36 }, (_, index) => ({
    instanceId: `wide-flat-panel-${index + 1}`,
    caseId: 'wide-flat-panel',
    dims: { l: 70, w: 24, h: 10 },
    weight: 180,
    canFlip: true,
    stackable: true,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 36);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 0,
    'a repeated flat-panel batch that fits on the floor should not stand panels upright or stack them');

  for (const item of items) {
    const orientedDims = output.orientedDims.get(item.instanceId);
    assert.deepEqual(orientedDims, { length: 70, width: 24, height: 10 },
      'repeated flippable flat panels should stay in the low shelf orientation when the full batch fits');
    const aabb = Solver.getAabb(output.placements.get(item.instanceId), {
      l: orientedDims.length,
      w: orientedDims.width,
      h: orientedDims.height,
    });
    assert.equal(Solver.isAabbContainedInAnyZone(aabb, zones, 0.001), true,
      'flat-panel shelf placements must remain fully inside the trailer');
  }
});

test('AUTO-PACK-A1-R6.5 repeated same-footprint heavy groups reserve floor before light groups', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 130, width: 100, height: 100 };
  const zones = [{ min: { x: 0, y: 0, z: -50 }, max: { x: 130, y: 100, z: 50 } }];
  const heavyItems = Array.from({ length: 8 }, (_, index) => ({
    instanceId: `heavy-cube-${index + 1}`,
    caseId: 'heavy-cube',
    dims: { l: 24, w: 24, h: 24 },
    weight: 300,
    canFlip: false,
  }));
  const lightItems = Array.from({ length: 8 }, (_, index) => ({
    instanceId: `light-cube-${index + 1}`,
    caseId: 'light-cube',
    dims: { l: 24, w: 24, h: 24 },
    weight: 10,
    canFlip: false,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items: [...lightItems, ...heavyItems] });
  assert.equal(output.placements.size, 16);
  assert.deepEqual(output.unpacked, []);

  const heavyMaxX = Math.max(...heavyItems.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).max.x;
  }));
  const lightMinX = Math.min(...lightItems.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.x;
  }));

  assert.ok(heavyMaxX <= lightMinX + 0.001,
    'same-footprint repeated heavy groups should occupy the load-side floor before lighter groups');
});

test('AUTO-PACK-A1-R6 live AutoPack routes through the logistics solver from the runtime engine only', async () => {
  const appSrc = await readAppSource();
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const solutionSrc = await fs.readFile(new URL('../../src/packing-core/solution.js', import.meta.url), 'utf8');

  assert.doesNotMatch(appSrc, /autopack-solver\.js|solveAutoPack/,
    'app.js must stay an orchestrator consumer and must not import the solver directly');
  assert.match(engineSrc, /import \{ getPackingStrategy, runAdaptiveAutoPack \} from '\.\.\/packing-core\/solution\.js';/,
    'A1-R6 must route runtime AutoPack through the packing-core solution runner');
  assert.match(engineSrc, /const packingSolution = runAdaptiveAutoPack\(\{/,
    'runtime AutoPack must call the adaptive core-engine path for live placement');
  assert.match(engineSrc, /const solverResult = packingSolution \? packingSolution\.selectedSolution : null;/,
    'runtime AutoPack must apply the selected core solution to the scene');
  assert.match(solutionSrc, /export function runPackingStrategies\(input, strategyIds = \['default'\], solve = solveAutoPack\)/,
    'packing-core must own strategy execution and keep solveAutoPack injectable');
  assert.match(solutionSrc, /export function runAdaptiveAutoPack\(input, solve = solveAutoPack\)/,
    'packing-core must expose the adaptive production entry point');
});

test('AUTO-PACK-A1-R6 live adapter preserves runtime gates, zones, and orientation metadata', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  assert.match(engineSrc, /getProRuleSet\(_bs, activeRole\)/,
    'A1-R6 must preserve the billing/pro gate in the runtime engine');
  assert.match(engineSrc, /function isActiveRunValid\(run\) \{[\s\S]*?run\.workspaceGeneration !== workspaceGeneration[\s\S]*?OperationLifecycle\.isCurrent\(run\.token\)/,
    'A1-R6 must preserve the stale-run guard (workspace generation, plus the E-UX operation-token check)');
  assert.match(engineSrc, /const physicalContextZones = TrailerGeometry\.getTrailerUsableZones\(packData\.truck\);[\s\S]*const zones = physicalContextZones;/,
    'A1-R6 must continue using TrailerGeometry as the single usable-zone source');
  assert.match(engineSrc, /stageInstant\(stagingMap\);/,
    'A1-R6 must preserve pre-run staging before solver placement');
  assert.match(engineSrc, /animatePlacements\(\s*placements,\s*rotations,\s*orientedDimsMap,/,
    'A1-R6 must keep the existing animation path');
  assert.match(engineSrc, /PackLibrary\.update\(packId, \{ cases: nextCases \}\);/,
    'A1-R6 must keep the existing persistence path');
  assert.match(engineSrc, /orientationLocked: inst\.orientationLocked,/,
    'A1-R6 must pass manual orientation lock state to the logistics solver');
  assert.match(engineSrc, /lockedRotation: inst\.lockedRotation,/,
    'A1-R6 must pass locked rotations to the logistics solver');
  assert.match(engineSrc, /orientedDims: inst\.orientedDims,/,
    'A1-R6 must pass oriented dimensions to the logistics solver');
});

test('AUTO-PACK-A1-CLEAN-1 app keeps legacy scanner isolated outside app.js', async () => {
  const appSrc = await readAppSource();
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const itemBuilderSrc = await fs.readFile(autoPackItemBuilderPath, 'utf8');

  assert.match(engineSrc, /import \{ buildLegacyAutoPackItems \} from '\.\/autopack-item-builder\.js';/,
    'the AutoPack runtime must import live item preparation from the item-builder module');
  assert.doesNotMatch(appSrc, /function buildOrientations\(dims, caseData, inst/,
    'app.js must not keep legacy orientation generation inline');
  assert.doesNotMatch(appSrc, /function findRestingY\(cx, cz, halfL, halfW, packed\)/,
    'app.js must not keep legacy gravity placement inline');
  assert.doesNotMatch(appSrc, /function capXAnchorsSorted\(arr, maxCount\)/,
    'app.js must not keep the legacy X-anchor scanner inline');
  assert.doesNotMatch(appSrc, /const X_TIGHTNESS_WEIGHT = 0\.8;/,
    'app.js must not carry the legacy scoring constant inline');
  assert.match(itemBuilderSrc, /function buildOrientations\(dims, caseData, inst, orientationTools\)/,
    'the live item builder must own orientation candidate preparation');
});

test('AUTO-PACK-A1-CLEAN-2 app delegates AutoPack runtime without carrying orchestration inline', async () => {
  const appSrc = await readAppSource();
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  assert.match(appSrc, /import \{ createAutoPackEngine \} from '\.\/services\/autopack-engine\.js';/,
    'app.js must import the AutoPack runtime factory');
  assert.match(appSrc, /const AutoPackEngine = createAutoPackEngine\(\{/,
    'app.js must construct AutoPack through the runtime factory');
  assert.doesNotMatch(appSrc, /function buildStagingMap\(packItems, truck\)/,
    'app.js must not keep AutoPack staging inline');
  assert.doesNotMatch(appSrc, /function animatePlacements\(placements, rotations, orientedDimsMap/,
    'app.js must not keep AutoPack animation inline');
  assert.doesNotMatch(appSrc, /const legacyResult = await solveLegacyAutoPack\(\{/,
    'app.js must not call the legacy solver directly after A1-CLEAN-2');
  assert.match(engineSrc, /export function createAutoPackEngine\(\{/,
    'the runtime module must expose the AutoPack engine factory');
  assert.doesNotMatch(engineSrc, /capturePackPreview\(packId, \{ source: 'auto'/,
    'AutoPack must leave automatic preview capture to the central scheduler');
  assert.match(appSrc, /if \(previewContextChanged \|\| changes\.packLibrary \|\| changes\.caseLibrary \|\|\s*changes\.preferences \|\| changes\._undo \|\| changes\._redo\) AutoPackPreviewScheduler\.schedule\(\);/,
    'the central scheduler must observe committed Pack changes');
  assert.match(engineSrc, /PackLibrary\.update\(packId, \{ cases: nextCases \}\);/,
    'the runtime module must preserve pack persistence');
});

test('AUTO-PACK-A0 orientation lock helpers normalize rotation and compute oriented dimensions', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { length: 48, width: 24, height: 30 };

  assert.deepEqual(
    PackLibrary.getOrientedDimsForRotation(dims, { x: 0, y: Math.PI / 2, z: 0 }),
    { length: 24, width: 48, height: 30 },
    'Y-locked orientation must swap truck length/width extents'
  );
  assert.deepEqual(
    PackLibrary.getOrientedDimsForRotation(dims, { x: Math.PI / 2, y: 0, z: 0 }),
    { length: 48, width: 30, height: 24 },
    'X-locked orientation must move original width into height'
  );

  const patch = PackLibrary.createOrientationLockPatch({ x: 0, y: Math.PI / 2, z: 0 }, dims);
  assert.equal(patch.orientationLocked, true);
  assert.deepEqual(patch.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 });
  assert.deepEqual(patch.orientedDims, { length: 24, width: 48, height: 30 });
  assert.deepEqual(
    PackLibrary.clearOrientationLockPatch(),
    { orientationLocked: false, lockedRotation: null, orientedDims: null },
    'reset data support must clear the orientation lock contract'
  );
});

test('AUTO-PACK-A0 manual editor rotate and flip paths set per-instance orientation locks', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const rotateStart = src.indexOf('function rotateSelection(axis, delta)');
  const rotateEnd = src.indexOf('/**\n     * Nudge selected instances', rotateStart);
  const rotateBlock = rotateStart >= 0 && rotateEnd > rotateStart ? src.slice(rotateStart, rotateEnd) : '';
  const multiStart = src.indexOf('function renderMultiInspector(pack, selected)');
  const multiEnd = src.indexOf('// === Actions Card ===', multiStart);
  const multiBlock = multiStart >= 0 && multiEnd > multiStart ? src.slice(multiStart, multiEnd) : '';
  const singleStart = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)');
  const singleEnd = src.indexOf('\n    /**\n     * Creates a card header row', singleStart);
  const singleBlock = singleStart >= 0 && singleEnd > singleStart ? src.slice(singleStart, singleEnd) : '';

  assert.match(src, /function createManualOrientationLockPatch\(PackLibrary, CaseLibrary, inst, rotation\)/,
    'editor must have a narrow helper for manual orientation locks');
  assert.match(rotateBlock, /createManualOrientationLockPatch\(PackLibrary, CaseLibrary, inst, rot\)/,
    'keyboard rotate/flip path must lock manual orientation');
  assert.match(multiBlock, /rotateSelection\(axis,\s*delta\)/,
    'multi-select Rotate All must route through rotateSelection (not direct PackLibrary.updateInstance per item)');
  assert.match(singleBlock, /rotateSelection\(axis,\s*delta\)/,
    'single inspector Rotate/Flip must route through rotateSelection (not a deferred rAF+direct-persist path)');
  assert.match(singleBlock, /TODO\(AUTO-PACK-A0\): when reset-orientation UI is added, apply PackLibrary\.clearOrientationLockPatch\(\)/,
    'no reset UI exists yet, so reset support must remain documented without broad UI changes');
});

test('AUTO-PACK-A0 AutoPack respects locked orientation and keeps unlocked orientation generation', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const src = await fs.readFile(autoPackItemBuilderPath, 'utf8');
  const lockedStart = src.indexOf('function buildLockedOrientation(dims, inst, orientationTools)');
  const buildEnd = src.indexOf('\nexport function buildLegacyAutoPackItems', lockedStart);
  const block = lockedStart >= 0
    ? src.slice(lockedStart, buildEnd > lockedStart ? buildEnd : src.length)
    : '';

  assert.match(block, /inst\.orientationLocked !== true/,
    'locked orientation path must be gated by the per-instance orientationLocked flag');
  assert.match(block, /inst\.lockedRotation[\s\S]*inst\.transform && inst\.transform\.rotation/,
    'AutoPack must prefer the stored lockedRotation and fall back to the current instance rotation');
  assert.match(block, /orientationTools\.normalizeRightAngleRotation\(sourceRotation\)/,
    'locked rotations must be normalized to right-angle editor rotations');
  assert.match(block, /orientationTools\.getOrientedDimsForRotation\(dims, lockedRotation\)/,
    'locked orientation dimensions must come from the shared geometry helper');
  assert.match(block, /if \(lockedOrientation\) return \[lockedOrientation\];[\s\S]*tryOri\(0, 0, 0\)/,
    'locked items must test only one orientation while unlocked items keep normal orientation candidates (rotation-derived dims)');
  assert.match(src, /const orientations = buildOrientations\(d, caseData, inst, orientationTools\)/,
    'AutoPack item setup must pass the instance into orientation generation');
  assert.match(engineSrc, /buildLegacyAutoPackItems\(\{[\s\S]*orientationTools:/,
    'AutoPack runtime orchestration must supply orientation helpers to the item builder');
});

test('REPAIR-1 A: every production AutoPack candidate dimension matches a real THREE Box3', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const caseDims = { length: 30, width: 20, height: 10 };
  const solverDims = { l: 30, w: 20, h: 10 };

  // Active path candidates across policies — iterate the REAL candidates produced
  // by production code (not the helper compared with itself).
  const policies = [
    { orientationLock: 'any', canFlip: false },
    { orientationLock: 'any', canFlip: true },
    { orientationLock: 'upright', canFlip: true },
    { orientationLock: 'onSide', canFlip: false },
    { orientationLock: 'onSide', canFlip: true },
  ];
  for (const item of policies) {
    const cands = Solver.buildOrientationCandidates(solverDims, item);
    assert.ok(cands.length > 0, `candidates exist for ${JSON.stringify(item)}`);
    for (const c of cands) {
      assert.deepEqual({ l: c.l, w: c.w, h: c.h }, r1Truth(caseDims, c.rotation, truth),
        `candidate dims must equal THREE for rotation ${JSON.stringify(c.rotation)} (${JSON.stringify(item)})`);
    }
  }

  // Locked rotations: identity, single, compound, negative, 270deg, >360deg.
  const lockRots = [
    { x: 0, y: 0, z: 0 },
    { x: R1_HALF, y: 0, z: 0 },
    { x: 0, y: 0, z: R1_HALF },
    { x: R1_HALF, y: 0, z: R1_HALF },
    { x: R1_HALF, y: R1_HALF, z: R1_HALF },
    { x: -R1_HALF, y: 0, z: 0 },
    { x: 3 * R1_HALF, y: 0, z: 0 },
    { x: 2 * Math.PI + R1_HALF, y: 0, z: R1_HALF },
  ];
  for (const rot of lockRots) {
    const cands = Solver.buildOrientationCandidates(solverDims, { orientationLocked: true, lockedRotation: rot });
    assert.equal(cands.length, 1, `locked rotation yields exactly one candidate (${JSON.stringify(rot)})`);
    assert.deepEqual({ l: cands[0].l, w: cands[0].w, h: cands[0].h }, r1Truth(caseDims, cands[0].rotation, truth),
      `locked candidate dims must equal THREE for ${JSON.stringify(rot)}`);
  }
});

test('REPAIR-1 B: 30x20x10 compound regression — no mis-sized geometry is accepted', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const caseDims = { length: 30, width: 20, height: 10 };

  // The exact defect: the X90+Z90 candidate must report the THREE size 10x30x20,
  // NOT the historical hardcoded 20x10x30 (which rendered 30in wide).
  const cands = Solver.buildOrientationCandidates({ l: 30, w: 20, h: 10 }, { orientationLock: 'any', canFlip: true });
  const xz = cands.find(c => Math.abs(c.rotation.x - R1_HALF) < 1e-9 && Math.abs(c.rotation.z - R1_HALF) < 1e-9 && Math.abs(c.rotation.y) < 1e-9);
  assert.ok(xz, 'the X+Z compound candidate exists');
  assert.deepEqual({ l: xz.l, w: xz.w, h: xz.h }, { l: 10, w: 30, h: 20 }, 'X+Z candidate is THREE-correct 10x30x20');
  assert.notDeepEqual({ l: xz.l, w: xz.w, h: xz.h }, { l: 20, w: 10, h: 30 }, 'X+Z must NOT claim the old 20x10x30');

  const assertInBoundsAndConsistent = (res, truck) => {
    for (const [id, od] of res.orientedDims) {
      const rot = res.rotations.get(id);
      assert.deepEqual({ l: od.length, w: od.width, h: od.height }, r1Truth(caseDims, rot, truth),
        'every placed orientedDims equals THREE for its chosen rotation');
      const pos = res.placements.get(id);
      const EPS = 0.05;
      assert.ok(pos.x - od.length / 2 >= -EPS && pos.x + od.length / 2 <= truck.length + EPS, 'length (x) within truck');
      assert.ok(pos.z - od.width / 2 >= -truck.width / 2 - EPS && pos.z + od.width / 2 <= truck.width / 2 + EPS, 'width (z) within truck');
      assert.ok(pos.y - od.height / 2 >= -EPS && pos.y + od.height / 2 <= truck.height + EPS, 'height (y) within truck');
    }
  };

  // (1) Tight truck exactly matching the rendered X+Z size (10x30x20) must accept
  // the item by an honest, in-bounds orientation — never by the old wrong dims.
  const tight = { length: 20, width: 10, height: 30 };
  const r1 = Solver.solveAutoPack({ truck: tight, zones: PackLib.getTrailerUsableZones(tight), loadFrontFirst: true,
    items: [{ instanceId: 'i1', caseId: 'c', dims: { l: 30, w: 20, h: 10 }, canFlip: true, orientationLock: 'any' }] });
  assertInBoundsAndConsistent(r1, tight);

  // (2) A truck that ONLY the correct X+Y orientation (20x10x30) fits — the item
  // must pack, and its rendered geometry must be in-bounds.
  const roomy = { length: 22, width: 12, height: 32 };
  const r2 = Solver.solveAutoPack({ truck: roomy, zones: PackLib.getTrailerUsableZones(roomy), loadFrontFirst: true,
    items: [{ instanceId: 'i1', caseId: 'c', dims: { l: 30, w: 20, h: 10 }, canFlip: true, orientationLock: 'any' }] });
  assert.equal(r2.placements.size, 1, 'the item packs via the correct orientation');
  assertInBoundsAndConsistent(r2, roomy);
  const od = r2.orientedDims.get('i1');
  assert.deepEqual({ l: od.length, w: od.width, h: od.height }, { l: 20, w: 10, h: 30 }, 'packed as the honest 20x10x30 (X+Y)');
});

test('REPAIR-1 C: Standard / Wheel Wells / Front Overhang placements are THREE-consistent and contained', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const caseDims = { length: 30, width: 20, height: 10 };
  const modes = [
    { shapeMode: 'rect' },
    { shapeMode: 'wheelWells' },
    { shapeMode: 'frontBonus' },
  ];
  for (const extra of modes) {
    const truck = { length: 240, width: 96, height: 96, ...extra };
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = [0, 1, 2, 3].map(i => ({ instanceId: `i${i}`, caseId: 'c', dims: { l: 30, w: 20, h: 10 }, canFlip: true, orientationLock: 'any' }));
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.ok(res.placements.size > 0, `at least one placement in ${extra.shapeMode}`);
    const aabbs = [];
    for (const [id, od] of res.orientedDims) {
      const rot = res.rotations.get(id);
      assert.deepEqual({ l: od.length, w: od.width, h: od.height }, r1Truth(caseDims, rot, truth),
        `${extra.shapeMode}: placed orientedDims equals THREE for its rotation`);
      const pos = res.placements.get(id);
      const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
      assert.equal(PackLib.isAabbContainedInAnyZone(aabb, zones), true, `${extra.shapeMode}: placed AABB sits inside a usable zone (no blocked region)`);
      aabbs.push(aabb);
    }
    for (let a = 0; a < aabbs.length; a++) {
      for (let b = a + 1; b < aabbs.length; b++) {
        assert.equal(Solver.aabbsOverlap(aabbs[a], aabbs[b]), false, `${extra.shapeMode}: placed items do not overlap`);
      }
    }
  }
});

test('REPAIR-1 D: active solver and live item-prep agree; upright+canFlip never tips', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const ItemBuilder = await import(`${autoPackItemBuilderPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const orientationTools = {
    normalizeRightAngleRotation: PackLib.normalizeRightAngleRotation,
    getOrientedDimsForRotation: PackLib.getOrientedDimsForRotation,
  };
  const caseDimsObj = { length: 30, width: 20, height: 10 };
  const itemPrepDimSet = (lock, canFlip) => {
    const cases = { c: { id: 'c', dimensions: caseDimsObj, orientationLock: lock, canFlip, shape: 'box', volume: 6000 } };
    const items = ItemBuilder.buildLegacyAutoPackItems({
      instances: [{ id: 'i', caseId: 'c', hidden: false }],
      getCaseById: id => cases[id] || null,
      volumeInCubicInches: d => d.length * d.width * d.height,
      orientationTools,
    });
    return new Set(items[0].orientations.map(o => `${o.l}|${o.w}|${o.h}`));
  };
  const activeDimSet = (lock, canFlip) =>
    new Set(Solver.buildOrientationCandidates({ l: 30, w: 20, h: 10 }, { orientationLock: lock, canFlip }).map(c => `${c.l}|${c.w}|${c.h}`));

  for (const lock of ['any', 'upright', 'onSide']) {
    for (const canFlip of [false, true]) {
      assert.deepEqual(itemPrepDimSet(lock, canFlip), activeDimSet(lock, canFlip),
        `active and live item-prep candidate dimension sets agree for ${lock}+${canFlip}`);
    }
  }

  // Live upright + canFlip:true must NOT generate any tipped face (height must
  // stay the case height = 10). This was the historical lock !== 'onSide' bug.
  const cases = { c: { id: 'c', dimensions: caseDimsObj, orientationLock: 'upright', canFlip: true, shape: 'box', volume: 6000 } };
  const items = ItemBuilder.buildLegacyAutoPackItems({
    instances: [{ id: 'i', caseId: 'c', hidden: false }],
    getCaseById: id => cases[id] || null,
    volumeInCubicInches: d => d.length * d.width * d.height,
    orientationTools,
  });
  assert.ok(items[0].orientations.every(o => o.h === 10 && o.rotX === 0 && o.rotZ === 0),
    'upright + canFlip:true produces upright/yaw candidates only (no tips)');

  // Exact locked rotation agreement (compound).
  const lockedRot = { x: R1_HALF, y: 0, z: R1_HALF };
  const activeLocked = Solver.buildOrientationCandidates({ l: 30, w: 20, h: 10 }, { orientationLocked: true, lockedRotation: lockedRot });
  assert.equal(activeLocked.length, 1);
  assert.deepEqual({ l: activeLocked[0].l, w: activeLocked[0].w, h: activeLocked[0].h }, { l: 10, w: 30, h: 20 },
    'active locked compound candidate matches THREE (10x30x20)');
});

test('REPAIR-1 E: candidate deduplication is by derived dimensions (cube => 1, asymmetric => distinct)', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  // Documented rule: two rotations that yield the SAME effective box are ONE
  // physical packing candidate. A cube collapses to a single candidate.
  const cube = Solver.buildOrientationCandidates({ l: 10, w: 10, h: 10 }, { orientationLock: 'any', canFlip: true });
  assert.equal(cube.length, 1, 'a cube yields exactly one physical candidate');
  // Square cross-section (l=w): upright yaw rotations are identical footprints.
  const square = Solver.buildOrientationCandidates({ l: 10, w: 10, h: 30 }, { orientationLock: 'any', canFlip: false });
  assert.equal(square.length, 1, 'a square upright footprint dedups its two yaw candidates to one');
  // Fully asymmetric: each generated face is a distinct physical candidate.
  const asym = Solver.buildOrientationCandidates({ l: 30, w: 20, h: 10 }, { orientationLock: 'any', canFlip: true });
  const keys = asym.map(c => `${c.l}|${c.w}|${c.h}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate physical candidates among asymmetric faces');
});

test('REPAIR-1B A: a staged unpacked item uses the deterministic identity pose on the staging floor', async () => {
  const mods = await r1bModules();
  const truth = await threeOrientedTruth();
  const truck = { length: 240, width: 96, height: 96 };
  const caseObj = { id: 'c', name: 'OnSide', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: 'onSide', canFlip: false, shape: 'box', volume: 6000 };
  const staged = r1bComposeStaged(mods, caseObj, truck);
  assert.ok(staged.position && Number.isFinite(staged.position.y), 'staged position exists');
  assert.ok(staged.rotation && [staged.rotation.x, staged.rotation.y, staged.rotation.z].every(Number.isFinite), 'staged rotation is canonical');
  assert.ok(staged.orientedDims && staged.orientedDims.height > 0, 'staged orientedDims exists');
  r1bAssertAtomicFloor(mods, caseObj, staged, truth, 'onSide generic');
  assert.deepEqual(staged.rotation, { x: 0, y: 0, z: 0 },
    'visual staging uses identity even when the case packing policy is onSide');
});

test('REPAIR-1B B: Long Beam fixtures stage atomic and on the floor (corrected upright fixture, Repair 1C)', async () => {
  const mods = await r1bModules();
  const truth = await threeOrientedTruth();
  const truck = { length: 240, width: 96, height: 96 };

  // Repair 1C corrected the fixtures: long beams are UPRIGHT so they lie horizontal
  // lengthwise and never stand 144/120in tall. The atomic-pose-on-floor contract
  // (Repair 1B) still holds — staging Y, rotation and orientedDims all agree.
  const beam144 = await r1bImportBeam('Long Beam 144');
  assert.equal(beam144.orientationLock, 'upright', 'Long Beam 144 imports as upright (lies horizontal)');
  const s144 = r1bComposeStaged(mods, beam144, truck);
  r1bAssertAtomicFloor(mods, beam144, s144, truth, 'Long Beam 144');
  assert.equal(s144.orientedDims.height, 8, 'Long Beam 144 staged height is its true 8in (horizontal lengthwise)');
  assert.notEqual(s144.orientedDims.height, 144, 'Long Beam 144 never stands 144in tall');
  assert.ok(s144.rotation.x === 0 && s144.rotation.z === 0, 'Long Beam 144 stays upright (height axis vertical)');
  assert.ok(Math.abs(s144.position.y - s144.orientedDims.height / 2) <= 0.05, 'no float: bottom on floor');

  const beamNL = await r1bImportBeam('Long Beam No Lane');
  assert.equal(beamNL.orientationLock, 'upright', 'Long Beam No Lane imports as upright');
  const sNL = r1bComposeStaged(mods, beamNL, truck);
  r1bAssertAtomicFloor(mods, beamNL, sNL, truth, 'Long Beam No Lane');
  assert.equal(sNL.orientedDims.height, 10, 'Long Beam No Lane staged height is its true 10in (horizontal)');
  assert.notEqual(sNL.orientedDims.height, 120, 'Long Beam No Lane never stands 120in tall');
  assert.ok(Math.abs(sNL.position.y - sNL.orientedDims.height / 2) <= 0.05, 'no float: bottom on floor');
});

test('REPAIR-1B C: Long Beam staging rests on the floor in Standard / Wheel Wells / Front Overhang', async () => {
  const mods = await r1bModules();
  const truth = await threeOrientedTruth();
  const beam = await r1bImportBeam('Long Beam 144');
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    const truck = { length: 240, width: 96, height: 96, shapeMode };
    const staged = r1bComposeStaged(mods, beam, truck);
    r1bAssertAtomicFloor(mods, beam, staged, truth, `Long Beam 144 / ${shapeMode}`);
    const bottom = staged.position.y - staged.orientedDims.height / 2;
    assert.ok(Math.abs(bottom) <= 0.05, `${shapeMode}: staged beam bottom on floor`);
  }
});

test('REPAIR-1B D: orientation-policy staging matrix always uses identity while pose, dims and THREE agree', async () => {
  const mods = await r1bModules();
  const truth = await threeOrientedTruth();
  const truck = { length: 240, width: 96, height: 96 };
  const H = Math.PI / 2;
  const base = { id: 'c', name: 'C', dimensions: { length: 30, width: 20, height: 10 }, shape: 'box', volume: 6000 };
  const policies = [
    { orientationLock: 'any', canFlip: false },
    { orientationLock: 'any', canFlip: true },
    { orientationLock: 'upright', canFlip: false },
    { orientationLock: 'upright', canFlip: true },
    { orientationLock: 'onSide', canFlip: false },
    { orientationLock: 'onSide', canFlip: true },
  ];
  for (const p of policies) {
    const caseObj = { ...base, orientationLock: p.orientationLock, canFlip: p.canFlip };
    const staged = r1bComposeStaged(mods, caseObj, truck);
    r1bAssertAtomicFloor(mods, caseObj, staged, truth, `${p.orientationLock}+${p.canFlip}`);
    assert.deepEqual(staged.rotation, { x: 0, y: 0, z: 0 },
      `${p.orientationLock}+${p.canFlip}: packing policy does not rotate visual staging`);
  }
  // Exact instance locks remain metadata for packing/manual placement and do not
  // rotate cargo in the visual staging area.
  const locked = r1bComposeStaged(mods, { ...base, orientationLock: 'any', canFlip: true }, truck,
    { orientationLocked: true, lockedRotation: { x: H, y: 0, z: H } });
  r1bAssertAtomicFloor(mods, base, locked, truth, 'exact compound lock');
  assert.deepEqual(locked.rotation, { x: 0, y: 0, z: 0 }, 'exact lock does not override identity staging');
  assert.deepEqual(locked.orientedDims, base.dimensions, 'identity staging uses real base dimensions');
});

test('REPAIR-1B E: staged pose is deterministic identity, ignoring policy, locks, and stale instance pose', async () => {
  const mods = await r1bModules();
  const truth = await threeOrientedTruth();
  const truck = { length: 240, width: 96, height: 96 };
  const caseObj = { id: 'c', name: 'C', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: 'onSide', canFlip: false, shape: 'box', volume: 6000 };

  // (a) An unlocked instance carrying a stale orientedDims + an unlocked manual
  // rotation must NOT leak into the staged pose — it comes from the shared
  // deterministic identity staging contract.
  const clean = r1bComposeStaged(mods, caseObj, truck);
  const withStale = r1bComposeStaged(mods, caseObj, truck, {
    orientedDims: { length: 99, width: 99, height: 99 },
    transform: { rotation: { x: 0, y: 0, z: 0 } },
  });
  assert.deepEqual(withStale.orientedDims, clean.orientedDims, 'stale stored orientedDims is ignored');
  assert.deepEqual(withStale.rotation, clean.rotation, 'unlocked manual rotation does not override policy staging');
  r1bAssertAtomicFloor(mods, caseObj, withStale, truth, 'stale-ignored');

  // (b) A valid exact lock stays as metadata but does not rotate visual staging.
  const H = Math.PI / 2;
  const lockedCase = { ...caseObj, orientationLock: 'any' };
  const locked = r1bComposeStaged(mods, lockedCase, truck, { orientationLocked: true, lockedRotation: { x: H, y: 0, z: 0 } });
  assert.deepEqual(locked.rotation, { x: 0, y: 0, z: 0 }, 'exact lock does not override staged identity');
  assert.deepEqual(locked.orientedDims, lockedCase.dimensions, 'exact-lock item stages with identity dimensions');
  r1bAssertAtomicFloor(mods, lockedCase, locked, truth, 'exact lock metadata preserved outside pose');
});

test('REPAIR-1B F: packed placements still rest on the floor and Stats use the same dims (no regression)', async () => {
  const mods = await r1bModules();
  const truth = await threeOrientedTruth();
  const { Solver, PackLib } = mods;
  // Packed floor placement must touch the floor (bottom ~ 0) and stay self-consistent.
  const truck = { length: 240, width: 96, height: 96 };
  const items = [0, 1, 2].map(i => ({ instanceId: `i${i}`, caseId: 'c', dims: { l: 30, w: 20, h: 10 }, canFlip: true, orientationLock: 'any' }));
  const res = Solver.solveAutoPack({ truck, zones: PackLib.getTrailerUsableZones(truck), loadFrontFirst: true, items });
  assert.ok(res.placements.size > 0, 'items pack');
  for (const [id, od] of res.orientedDims) {
    const rot = res.rotations.get(id);
    const t = truth({ length: 30, width: 20, height: 10 }, rot);
    assert.deepEqual({ l: od.length, w: od.width, h: od.height }, { l: t.length, w: t.width, h: t.height }, 'packed orientedDims == THREE');
    const pos = res.placements.get(id);
    const bottom = pos.y - od.height / 2;
    // Floor placements rest on the floor; stacked ones rest on a support (>0).
    assert.ok(bottom >= -0.05, 'packed item is not below the floor');
  }
  // Stats/OOG consume the same effective dimensions as the rendered pose: a stored
  // rotated instance's orientedDims equals the THREE result for its rotation.
  const H = Math.PI / 2;
  const normPath = new URL('../../src/core/normalizer.js', import.meta.url);
  const Normalizer = await import(`${normPath.href}?t=${Date.now()}-${Math.random()}`);
  const appData = {
    caseLibrary: [{ id: 'cc', name: 'C', dimensions: { length: 30, width: 20, height: 10 } }],
    packLibrary: [{ id: 'pp', title: 'P', truck, cases: [
      { id: 'inst', caseId: 'cc', placement: 'staged', transform: { position: { x: 5, y: 5, z: 0 }, rotation: { x: H, y: 0, z: H } }, orientedDims: { length: 1, width: 1, height: 1 } },
    ] }],
    folderLibrary: [],
  };
  const out = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(appData)));
  const inst = out.packLibrary[0].cases[0];
  const want = truth({ length: 30, width: 20, height: 10 }, { x: H, y: 0, z: H });
  assert.deepEqual(inst.orientedDims, { length: want.length, width: want.width, height: want.height },
    'Stats/OOG read the same THREE-correct oriented dims as the rendered pose');
});

test('REPAIR-1C 1: upright+canFlip:false keeps the horizontal lengthwise pose and never stands tall', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const cands = Solver.buildOrientationCandidates({ l: 144, w: 8, h: 8 }, { orientationLock: 'upright', canFlip: false });
  // Identity (horizontal lengthwise) is present.
  assert.ok(cands.some(c => c.l === 144 && c.w === 8 && c.h === 8 && c.rotation.x === 0 && c.rotation.z === 0),
    'the natural horizontal 144x8x8 lengthwise pose is a candidate');
  // No candidate stands the beam 144in (or 8x144) tall.
  assert.ok(cands.every(c => c.h === 8), 'no upright candidate exceeds the 8in case height (never stands tall)');
});

test('REPAIR-1C 2: onSide (the old fixture) excludes identity and may stand the beam tall', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const cands = Solver.buildOrientationCandidates({ l: 144, w: 8, h: 8 }, { orientationLock: 'onSide', canFlip: false });
  assert.ok(!cands.some(c => c.l === 144 && c.h === 8 && c.rotation.x === 0 && c.rotation.z === 0),
    'onSide excludes the horizontal lengthwise (upright) pose — this is why the old fixture failed');
  assert.ok(cands.some(c => c.h === 144), 'onSide includes a 144in-tall standing candidate');
});

test('REPAIR-1C 3+4: lane Always and lane Never both pack the corrected beam horizontally', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const truck = { length: 240, width: 96, height: 96 };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const [label, laneItem] of [['lane Always', true], ['lane Never', false]]) {
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true,
      items: [r1cSolverItem({ orientationLock: 'upright', canFlip: false, laneItem })] });
    assert.ok(res.placements.has('i'), `${label}: the corrected beam packs`);
    const od = res.orientedDims.get('i');
    assert.deepEqual({ l: od.length, w: od.width, h: od.height }, { l: 144, w: 8, h: 8 }, `${label}: packs horizontal lengthwise 144x8x8`);
    const pos = res.placements.get('i');
    assert.ok(Math.abs(pos.y - 4) <= 0.05, `${label}: rests on the floor (y=4)`);
  }
  // Lane Never is classified as a normal (non-lane) item; Always is a lane item.
  assert.equal(Solver.classifyAutoPackItem({ dims: { l: 144, w: 8, h: 8 }, laneItem: true, orientationLock: 'upright' }), 'LANE_ITEM', 'lane Always → lane phase');
  assert.notEqual(Solver.classifyAutoPackItem({ dims: { l: 144, w: 8, h: 8 }, laneItem: false, orientationLock: 'upright' }), 'LANE_ITEM', 'lane Never → skips the forced lane phase');
});

test('REPAIR-1C 6: a correctly-configured beam that still cannot fit stages atomic on the floor', async () => {
  const mods = await r1bModules();
  const truth = await threeOrientedTruth();
  // A 144in beam in a too-short truck still cannot pack, but its staged pose is
  // atomic and rests on the floor (upright → horizontal, height 8).
  const truck = { length: 100, width: 96, height: 96 };
  const caseObj = { id: 'c', name: 'Beam', dimensions: { length: 144, width: 8, height: 8 }, orientationLock: 'upright', canFlip: false, shape: 'box', volume: 144 * 8 * 8 };
  const staged = r1bComposeStaged(mods, caseObj, truck);
  r1bAssertAtomicFloor(mods, caseObj, staged, truth, 'unfittable upright beam');
  assert.equal(staged.orientedDims.height, 8, 'stays horizontal (8in high), not standing');
});

test('REPAIR-1C 7+8+9: corrected beam — every placed item is THREE-correct, contained, horizontal, no overlap (3 modes)', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  // Wheel Wells now use the shared physical model instead of a simplified
  // single-zone-only check, so a lengthwise beam may legally span compatible
  // floor/channel space as long as it does not intersect blocked well bodies.
  const mustPack = { rect: true, wheelWells: true, frontBonus: true };
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    const truck = { length: 240, width: 96, height: 96, shapeMode };
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = [0, 1, 2].map(i => ({ instanceId: `i${i}`, caseId: 'c', dims: { l: 144, w: 8, h: 8 }, orientationLock: 'upright', canFlip: false, laneItem: true }));
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    if (mustPack[shapeMode]) assert.ok(res.placements.size > 0, `${shapeMode}: corrected beams pack (a 240in lengthwise lane exists)`);
    const aabbs = [];
    for (const [id, od] of res.orientedDims) {
      const rot = res.rotations.get(id);
      const t = truth({ length: 144, width: 8, height: 8 }, rot);
      assert.deepEqual({ l: od.length, w: od.width, h: od.height }, { l: t.length, w: t.width, h: t.height }, `${shapeMode}: packed dims == THREE`);
      assert.equal(od.height, 8, `${shapeMode}: stays horizontal (never stands tall)`);
      const pos = res.placements.get(id);
      const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
      assert.equal(testAabbInsidePhysicalTrailer(PackLib, aabb, zones, truck), true,
        `${shapeMode}: contained in physically allowed trailer geometry (no blocked region / out-of-bounds)`);
      assert.equal(testAabbOnPhysicalFloor(PackLib, aabb, zones, truck), true,
        `${shapeMode}: lengthwise beam rests on a valid floor/surface`);
      aabbs.push(aabb);
    }
    for (let a = 0; a < aabbs.length; a++) for (let b = a + 1; b < aabbs.length; b++) {
      assert.equal(Solver.aabbsOverlap(aabbs[a], aabbs[b]), false, `${shapeMode}: no overlap`);
    }
  }
});

test('REPAIR-1D 1+2+3: old onSide 144x8x8 beam — the former ~68in transient gap is zero on every frame', async () => {
  const caseObj = { id: 'c', name: 'OldBeam', dimensions: { length: 144, width: 8, height: 8 }, orientationLock: 'onSide', canFlip: false, shape: 'box', volume: 144 * 8 * 8, weight: 50 };
  const truck = { length: 240, width: 96, height: 96 };
  const { frames } = await runEnginePack({ caseObj, instances: [{ id: 'i', caseId: 'c', hidden: false, transform: { position: { x: 0, y: 4, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }], truck });
  // Visual staging now ignores packing policy and uses deterministic identity,
  // so this beam lies flat at its real base height on every captured frame.
  assertNoFloatFrames(frames, ['i'], 'onSide 144 beam');
  const rafFrames = frames.filter(f => f.label === 'raf');
  assert.ok(rafFrames.length >= 1, 'at least one staging frame was scheduled');
  assert.ok(rafFrames.every(f => f.objs.i.sizeY === 8),
    'the staged object uses identity orientation (rendered 8in tall) on every staging frame');
});

test('REPAIR-1D 4: corrected upright Long Beams stay on the floor on every frame', async () => {
  const truck = { length: 240, width: 96, height: 96 };
  for (const [name, dims] of [['Long Beam 144', { length: 144, width: 8, height: 8 }], ['Long Beam No Lane', { length: 120, width: 10, height: 10 }]]) {
    const caseObj = { id: 'c', name, dimensions: dims, orientationLock: 'upright', canFlip: false, shape: 'box', volume: dims.length * dims.width * dims.height, weight: 50 };
    const { frames } = await runEnginePack({ caseObj, instances: [{ id: 'i', caseId: 'c', hidden: false, transform: { position: { x: 0, y: dims.height / 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }], truck });
    assertNoFloatFrames(frames, ['i'], name);
    assert.ok(frames.filter(f => f.label === 'raf').every(f => f.objs.i.sizeY === dims.height), `${name}: stays horizontal (rendered height ${dims.height}) every frame`);
  }
});

test('REPAIR-1D 5: an exact compound orientation lock keeps metadata but stages in identity on the floor', async () => {
  const H = Math.PI / 2;
  const caseObj = { id: 'c', name: 'Locked', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: 'any', canFlip: true, shape: 'box', volume: 6000, weight: 40 };
  const truck = { length: 240, width: 96, height: 96 };
  const inst = { id: 'i', caseId: 'c', hidden: false, orientationLocked: true, lockedRotation: { x: H, y: 0, z: H }, transform: { position: { x: 0, y: 5, z: 0 }, rotation: { x: H, y: 0, z: H } } };
  const { frames } = await runEnginePack({ caseObj, instances: [inst], truck });
  assertNoFloatFrames(frames, ['i'], 'exact compound lock');
  assert.ok(frames.filter(f => f.label === 'raf').every(f => f.objs.i.sizeY === 10),
    'exact-lock cargo uses the deterministic 10in identity staging height every frame');
});

test('REPAIR-1D 6+10: packed pose differs from staging pose — every frame on the floor; scene == StateStore', async () => {
  // any+canFlip:true: staging uses orientations[0] (identity, 30x20x10), the solver
  // may pack a different face. Either way every frame rests on the floor.
  const caseObj = { id: 'c', name: 'Multi', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: 'any', canFlip: true, shape: 'box', volume: 6000, weight: 40 };
  const truck = { length: 240, width: 96, height: 96 };
  const { frames, objects, storedPack, THREE } = await runEnginePack({ caseObj, instances: [{ id: 'i', caseId: 'c', hidden: false, transform: { position: { x: 0, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }], truck });
  assertNoFloatFrames(frames, ['i'], 'packed-differs');
  // Scene and StateStore agree at the end: the rendered object's height matches the
  // stored effective dims (orientedDims if present, else base height).
  const inst = storedPack.cases[0];
  const obj = objects.get('i'); obj.updateMatrixWorld(true);
  const size = new THREE.Vector3(); new THREE.Box3().setFromObject(obj).getSize(size);
  const storedH = inst.orientedDims ? inst.orientedDims.height : caseObj.dimensions.height;
  assert.equal(r1dRound(size.y), storedH, 'final rendered height equals the stored effective height (scene == StateStore)');
});

test('REPAIR-1D 7: running AutoPack twice keeps every frame on the floor', async () => {
  const caseObj = { id: 'c', name: 'OnSideTwice', dimensions: { length: 144, width: 8, height: 8 }, orientationLock: 'onSide', canFlip: false, shape: 'box', volume: 144 * 8 * 8, weight: 50 };
  const truck = { length: 240, width: 96, height: 96 };
  const ctx = await runEnginePack({ caseObj, instances: [{ id: 'i', caseId: 'c', hidden: false, transform: { position: { x: 0, y: 4, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }], truck });
  assertNoFloatFrames(ctx.frames, ['i'], 'first run');
  // Second run on the same engine/scene/state.
  ctx.frames.length = 0;
  await ctx.engine.pack();
  ctx.snapshot('final2');
  assertNoFloatFrames(ctx.frames, ['i'], 'second run');
});

test('REPAIR-1D 8+9: no float frames in Standard / Wheel Wells / Front Overhang; packed stays contained, non-overlapping, THREE-consistent', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const caseObj = { id: 'c', name: 'Beam', dimensions: { length: 144, width: 8, height: 8 }, orientationLock: 'upright', canFlip: false, shape: 'box', volume: 144 * 8 * 8, weight: 50 };
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    const truck = { length: 240, width: 96, height: 96, shapeMode };
    const instances = [0, 1, 2].map(i => ({ id: `i${i}`, caseId: 'c', hidden: false, transform: { position: { x: 0, y: 4, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }));
    const { frames, storedPack } = await runEnginePack({ caseObj, instances, truck });
    assertNoFloatFrames(frames, instances.map(i => i.id), `engine ${shapeMode}`);
    // Packed regression: the solver result (the source of truth the engine persists)
    // is contained, non-overlapping, THREE-consistent — unchanged by the staging fix.
    const zones = PackLib.getTrailerUsableZones(truck);
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: instances.map(i => ({ instanceId: i.id, caseId: 'c', dims: { l: 144, w: 8, h: 8 }, orientationLock: 'upright', canFlip: false })) });
    const aabbs = [];
    for (const [id, od] of res.orientedDims) {
      const t = truth({ length: 144, width: 8, height: 8 }, res.rotations.get(id));
      assert.deepEqual({ l: od.length, w: od.width, h: od.height }, { l: t.length, w: t.width, h: t.height }, `${shapeMode}: packed dims == THREE`);
      const aabb = Solver.getAabb(res.placements.get(id), { l: od.length, w: od.width, h: od.height });
      assert.equal(testAabbInsidePhysicalTrailer(PackLib, aabb, zones, truck), true,
        `${shapeMode}: contained in physically allowed trailer geometry`);
      assert.equal(testAabbOnPhysicalFloor(PackLib, aabb, zones, truck), true,
        `${shapeMode}: packed beam rests on a valid floor/surface`);
      aabbs.push(aabb);
    }
    for (let a = 0; a < aabbs.length; a++) for (let b = a + 1; b < aabbs.length; b++) {
      assert.equal(Solver.aabbsOverlap(aabbs[a], aabbs[b]), false, `${shapeMode}: no overlap`);
    }
  }
});

test('REPAIR-1E scoring: front beats waste at equal support; support and level still dominate; deterministic', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const score = c => Solver.scoreStackCandidate(c, true); // loadFrontFirst (high +X = front)

  // The exact tuple order: [bottomY, -supportFraction, xPrimary, wasteArea, minZ].
  assert.deepEqual(score(r1eStackCandidate({ x: 200, bottomY: 16, waste: 400, sf: 1 })),
    [16, -1, -224, 400, 0], 'tuple is [bottomY, -supportFraction, xPrimary, wasteArea, minZ]');

  // 1) Front (high x) wins over rear EVEN with much higher waste (equal support, level).
  const front = score(r1eStackCandidate({ x: 200, waste: 400, sf: 1 })); // lots of waste, but front
  const rear = score(r1eStackCandidate({ x: 10, waste: 0, sf: 1 }));    // zero waste, but rear
  assert.ok(r1eLexLess(front, rear), 'front position wins before support waste');

  // 2) Higher support fraction still wins over a more-front lower-support candidate (hard-rule quality preserved).
  const frontLowSup = score(r1eStackCandidate({ x: 200, sf: 0.6 }));
  const rearHighSup = score(r1eStackCandidate({ x: 10, sf: 0.95 }));
  assert.ok(r1eLexLess(rearHighSup, frontLowSup), 'support fraction still outranks front position');

  // 3) A lower stack level still wins over a higher one regardless of x/waste.
  const low = score(r1eStackCandidate({ x: 10, bottomY: 16, waste: 0 }));
  const high = score(r1eStackCandidate({ x: 200, bottomY: 32, waste: 999 }));
  assert.ok(r1eLexLess(low, high), 'lower stack level outranks a higher level');

  // 4) Deterministic.
  assert.deepEqual(score(r1eStackCandidate({ x: 123, waste: 7, sf: 0.8 })), score(r1eStackCandidate({ x: 123, waste: 7, sf: 0.8 })), 'deterministic');
});

test('REPAIR-1E Wheel Wells: 188 cartons fill front supports before center/rear; safe, supported, deterministic', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const caseDims = { length: 24, width: 18, height: 16 };
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);

  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: r1eCartonItems(188) });
  const P = r1ePlaced(Solver, res, caseDims);
  assert.ok(P.length > 0, 'cartons pack');
  assert.ok(P.some(p => p.minY > 0.5), 'stacking occurs');

  // Hard safety: no overlap, all contained (no OOB / blocked-zone), THREE-consistent dims.
  for (const p of P) {
    assert.equal(PackLib.isAabbContainedInAnyZone(p.aabb, zones), true, `contained ${p.id}`);
    const t = truth(caseDims, res.rotations.get(p.id));
    assert.deepEqual({ l: p.od.length, w: p.od.width, h: p.od.height }, { l: t.length, w: t.width, h: t.height }, `THREE dims ${p.id}`);
  }
  for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
    assert.equal(Solver.aabbsOverlap(P[a].aabb, P[b].aabb), false, `no overlap ${a},${b}`);
  }
  // Supported stacks: every stacked carton has support fraction >= MIN against the layer below.
  for (const p of P.filter(x => x.minY > 0.5)) {
    const supports = P.filter(s => Math.abs(s.maxY - p.minY) < 0.5 && r1eOverlapXZ(p, s)).map(s => s.aabb);
    assert.ok(Solver.computeSupportFraction(p.aabb, supports) >= PackLib.MIN_SUPPORT_FRACTION - 1e-9, `stacked ${p.id} is supported`);
  }

  // FRONT-FIRST CONTRACT: on the partial top stack level, every USED support is at
  // least as front (high +X) as every UNUSED support — no valid front support cell
  // is left empty while rear supports receive equivalent stacked cartons.
  const topY = Math.max(...P.map(p => Math.round(p.minY)));
  const topItems = P.filter(p => Math.round(p.minY) === topY);
  const supports = P.filter(p => Math.abs(p.maxY - topY) < 0.5);
  const usedX = [], unusedX = [];
  for (const s of supports) (topItems.some(t => r1eOverlapXZ(t, s)) ? usedX : unusedX).push(s.pos.x);
  assert.ok(usedX.length > 0 && unusedX.length > 0, 'the top level is partial (front-first is observable)');
  assert.ok(Math.min(...usedX) >= Math.max(...unusedX), `front-first fill: every used support (minX=${Math.min(...usedX)}) is more front than every unused support (maxX=${Math.max(...unusedX)})`);

  // Deterministic repeat.
  const res2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: r1eCartonItems(188) });
  assert.equal(JSON.stringify([...res2.placements.entries()]), JSON.stringify([...res.placements.entries()]), 'repeat run is deterministic');
});

test('REPAIR-1E Wheel Wells: 420 cartons pack to capacity, safe, supported, deterministic', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const caseDims = { length: 24, width: 18, height: 16 };
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);

  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: r1eCartonItems(420) });
  const P = r1ePlaced(Solver, res, caseDims);
  assert.ok(P.length >= 188, 'a large number of cartons pack');
  assert.ok(P.some(p => p.minY > 0.5), 'stacking occurs');
  for (const p of P) {
    assert.equal(PackLib.isAabbContainedInAnyZone(p.aabb, zones), true, `contained ${p.id}`);
  }
  for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
    assert.equal(Solver.aabbsOverlap(P[a].aabb, P[b].aabb), false, `no overlap ${a},${b}`);
  }
  for (const p of P.filter(x => x.minY > 0.5)) {
    const supports = P.filter(s => Math.abs(s.maxY - p.minY) < 0.5 && r1eOverlapXZ(p, s)).map(s => s.aabb);
    assert.ok(Solver.computeSupportFraction(p.aabb, supports) >= PackLib.MIN_SUPPORT_FRACTION - 1e-9, `stacked ${p.id} is supported`);
  }
  const res2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: r1eCartonItems(420) });
  assert.equal(JSON.stringify([...res2.placements.entries()]), JSON.stringify([...res.placements.entries()]), 'repeat run is deterministic');
});

test('REPAIR-1E Standard mode remains front-first when stacking', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const caseDims = { length: 24, width: 18, height: 16 };
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: r1eCartonItems(220) });
  const P = r1ePlaced(Solver, res, caseDims);
  assert.ok(P.some(p => p.minY > 0.5), 'stacking occurs in Standard mode');
  const topY = Math.max(...P.map(p => Math.round(p.minY)));
  const topItems = P.filter(p => Math.round(p.minY) === topY);
  const supports = P.filter(p => Math.abs(p.maxY - topY) < 0.5);
  const usedX = [], unusedX = [];
  for (const s of supports) (topItems.some(t => r1eOverlapXZ(t, s)) ? usedX : unusedX).push(s.pos.x);
  if (unusedX.length > 0) {
    assert.ok(Math.min(...usedX) >= Math.max(...unusedX), 'Standard mode stacks front-first too');
  } else {
    assert.ok(usedX.length > 0, 'Standard mode top level fully used (still front-first fill order)');
  }
});

test('REPAIR-1E maxStackCount 1 and 2 still cap direct children on a support', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const caseDims = { length: 24, width: 18, height: 16 };
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const cap of [1, 2]) {
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: r1eCartonItems(188, { maxStackCount: cap }) });
    const P = r1ePlaced(Solver, res, caseDims);
    // Count DIRECT children resting on each support (child.minY == support.maxY).
    for (const support of P) {
      const directChildren = P.filter(c => c !== support && Math.abs(c.minY - support.maxY) < 0.5 && r1eOverlapXZ(c, support));
      assert.ok(directChildren.length <= cap, `maxStackCount ${cap}: support ${support.id} has ${directChildren.length} direct children (<= ${cap})`);
    }
  }
});

test('PHASE-B front-first floor: identical boxes fill complete front rows before a partial rear row (Std/WW/FrontOverhang × counts)', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truth = await threeOrientedTruth();
  const report = [];
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    for (const n of [6, 40, 120]) {
      const truck = { length: 240, width: 96, height: 96, shapeMode };
      const zones = PackLib.getTrailerUsableZones(truck);
      const usableMaxX = Math.max(...zones.map(z => z.max.x));
      const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: Array.from({ length: n }, (_, i) => ({ instanceId: `i${i}`, caseId: 'c', dims: { l: 24, w: 18, h: 16 }, shape: 'box', orientationLock: 'any', canFlip: false, weight: 30 })) });
      const P = phbPlaced(Solver, res, PHB_DIMS);
      assert.ok(P.length > 0, `${shapeMode}/${n}: packs`);
      // Safety + THREE consistency.
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) assert.equal(Solver.aabbsOverlap(P[i].aabb, P[j].aabb), false, `${shapeMode}/${n}: no overlap`);
      for (const p of P) {
        assert.equal(PackLib.isAabbContainedInAnyZone(p.aabb, zones), true, `${shapeMode}/${n}: contained`);
        const t = truth(PHB_DIMS, res.rotations.get(p.id));
        assert.deepEqual({ l: p.od.length, w: p.od.width, h: p.od.height }, { l: t.length, w: t.width, h: t.height }, `${shapeMode}/${n}: THREE dims`);
        if (p.minY > 0.5) {
          const supports = P.filter(s => s !== p && Math.abs(s.maxY - p.minY) < 0.5 && phbOverlapXZ(p, s)).map(s => s.aabb);
          assert.ok(PackLib.computeSupportFraction(p.aabb, supports, 0.05) >= PackLib.MIN_SUPPORT_FRACTION, `${shapeMode}/${n}: supported`);
        }
      }
      // Floor layer front-first.
      const floor = P.filter(p => p.minY < 0.5);
      const byX = {}; for (const p of floor) { const k = Math.round(p.pos.x); byX[k] = (byX[k] || 0) + 1; }
      const levels = Object.keys(byX).map(Number).sort((a, b) => b - a); // front (high x) first
      const counts = levels.map(x => byX[x]);
      // Nose occupied: the front-most floor item reaches the usable front edge.
      assert.ok(usableMaxX - Math.max(...floor.map(p => p.pos.x + p.od.length / 2)) <= 0.5, `${shapeMode}/${n}: the nose (front edge) is occupied`);
      // first-10 placement X (front->rear) for the report.
      const first10 = [...P].map(p => p.pos.x).sort((a, b) => b - a).slice(0, 10).map(x => Math.round(x));
      report.push(`${shapeMode}/${n}: packed=${P.length} first10X=[${first10.join(',')}] floorRows(x:count)=${levels.map((x, i) => `${x}:${counts[i]}`).join(' ')}`);
      if (shapeMode === 'rect' || shapeMode === 'frontBonus') {
        // Uniform full-width zone: every front row is FULL; only the rear-most may be partial.
        const maxCount = Math.max(...counts);
        assert.ok(counts.slice(0, -1).every(c => c === maxCount), `${shapeMode}/${n}: all front floor rows are full before a partial rear row (front-first)`);
      } else {
        // Wheel Wells: the full-width front zone (x beyond the wells) fills before the narrow middle.
        const frontZoneItems = floor.filter(p => p.pos.x - p.od.length / 2 >= 144 - 0.5).length;
        const narrowItems = floor.filter(p => p.pos.x < 144).length;
        if (narrowItems > 0) assert.ok(frontZoneItems >= 4, `${shapeMode}/${n}: the full-width front zone is used before the narrow middle`);
      }
    }
  }
  // Determinism (high count, wheelWells).
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const mk = () => Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: Array.from({ length: 80 }, (_, i) => ({ instanceId: `i${i}`, caseId: 'c', dims: { l: 24, w: 18, h: 16 }, shape: 'box', orientationLock: 'any', canFlip: false, weight: 30 })) });
  assert.equal(JSON.stringify([...mk().placements]), JSON.stringify([...mk().placements]), 'floor placement is deterministic on repeat');
  // Surface the X report in the assertion message of a always-true check (visible on -v).
  assert.ok(report.length === 9, `front-first floor X report:\n  ${report.join('\n  ')}`);
});

test('PHASE-B front-first lane: long items load front-to-rear; a 4th lane fills an open front z-lane instead of the rear', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truth = await threeOrientedTruth();
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  // 4 long lane items (120x10x10) all fit width-wise at the front (4 z-lanes in 96in).
  const items = Array.from({ length: 4 }, (_, i) => ({ instanceId: `L${i}`, caseId: 'c', dims: { l: 120, w: 10, h: 10 }, shape: 'box', orientationLock: 'upright', canFlip: false, laneItem: true, weight: 30 }));
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(res.placements.size, 4, 'all four lane items pack');
  const P = phbPlaced(Solver, res, { length: 120, width: 10, height: 10 });
  // Front-first: every lane item shares the same front x (none pushed to the rear
  // while a front z-lane is open) — the Phase B fix (was: 4th lane at the rear).
  const xs = P.map(p => Math.round(p.pos.x));
  assert.equal(new Set(xs).size, 1, `all lane items share the front x-row (front-first), got ${xs.join(',')}`);
  assert.ok(Math.max(...P.map(p => p.pos.x + p.od.length / 2)) >= 240 - 0.5, 'lane row reaches the nose');
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) assert.equal(Solver.aabbsOverlap(P[i].aabb, P[j].aabb), false, 'no lane overlap');
  for (const p of P) {
    assert.equal(PackLib.isAabbContainedInAnyZone(p.aabb, zones), true, 'lane contained');
    const t = truth({ length: 120, width: 10, height: 10 }, res.rotations.get(p.id));
    assert.deepEqual({ l: p.od.length, w: p.od.width, h: p.od.height }, { l: t.length, w: t.width, h: t.height }, 'lane THREE dims');
  }
  // Deterministic.
  const res2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(JSON.stringify([...res.placements]), JSON.stringify([...res2.placements]), 'lane placement deterministic');
});

test('PHASE-B lane Automatic / Always / Never classify and place without regressions', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const lane of [null, true, false]) {
    const items = Array.from({ length: 3 }, (_, i) => ({ instanceId: `x${i}`, caseId: 'c', dims: { l: 120, w: 10, h: 10 }, shape: 'box', orientationLock: 'upright', canFlip: false, laneItem: lane, weight: 30 }));
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(res.placements.size, 3, `lane=${lane}: all pack`);
    const P = phbPlaced(Solver, res, { length: 120, width: 10, height: 10 });
    assert.ok(Math.max(...P.map(p => p.pos.x + p.od.length / 2)) >= 240 - 0.5, `lane=${lane}: front-loaded (nose used)`);
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) assert.equal(Solver.aabbsOverlap(P[i].aabb, P[j].aabb), false, `lane=${lane}: no overlap`);
    for (const p of P) assert.equal(PackLib.isAabbContainedInAnyZone(p.aabb, zones), true, `lane=${lane}: contained`);
  }
  // lane=true is a LANE_ITEM; false/null go through ordinary floor — both front-loaded.
  assert.equal(Solver.classifyAutoPackItem({ dims: { l: 120, w: 10, h: 10 }, laneItem: true, orientationLock: 'upright' }), 'LANE_ITEM', 'Always → lane phase');
  assert.notEqual(Solver.classifyAutoPackItem({ dims: { l: 120, w: 10, h: 10 }, laneItem: false, orientationLock: 'upright' }), 'LANE_ITEM', 'Never → ordinary floor');
});

test('PHASE-B tighter rear vs open front: front wins; no rear/middle cell taken while a front cell is open', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  // A handful of identical boxes that do NOT fill the front row: every placed
  // floor item must sit in the single front-most row (no rear/middle cell taken).
  const items = Array.from({ length: 3 }, (_, i) => ({ instanceId: `b${i}`, caseId: 'c', dims: { l: 24, w: 18, h: 16 }, shape: 'box', orientationLock: 'any', canFlip: false, weight: 30 }));
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const P = phbPlaced(Solver, res, PHB_DIMS).filter(p => p.minY < 0.5);
  const xs = P.map(p => Math.round(p.pos.x));
  assert.equal(new Set(xs).size, 1, `a partial floor fills one front row only (no rear/middle cell while front open), got x=${xs.join(',')}`);
  assert.ok(Math.max(...P.map(p => p.pos.x + p.od.length / 2)) >= 240 - 0.5, 'the front row is at the nose');
});

test('PHASE-B2A repeated groups preserve legal yaw candidates and exhaust same-case floor openings first', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const fixtures = [
    { label: 'wheelWells-100-24x18', mode: 'wheelWells', count: 100, dims: { l: 24, w: 18, h: 16 }, expectedFloor: 43 },
    { label: 'standard-64-42x10', mode: 'rect', count: 64, dims: { l: 42, w: 10, h: 16 }, expectedFloor: 53 },
    { label: 'standard-100-42x10', mode: 'rect', count: 100, dims: { l: 42, w: 10, h: 16 }, expectedFloor: 53 },
  ];

  for (const fixture of fixtures) {
    const truck = { length: 240, width: 96, height: 96, shapeMode: fixture.mode };
    const zones = PackLib.getTrailerUsableZones(truck);
    const itemSpec = {
      caseId: 'A', dims: fixture.dims, orientationLock: 'any', canFlip: false, weight: 30,
    };
    const items = Array.from({ length: fixture.count }, (_, index) => ({
      ...itemSpec,
      instanceId: `A${index}`,
    }));
    const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(phb2FloorCount(result, zones, Solver), fixture.expectedFloor, `${fixture.label}: legal residual floor slots are used`);
    assert.equal(phb2FloorHole(Solver, result, zones, itemSpec), null, `${fixture.label}: no legal floor opening remains while identical cases stack`);
    assert.deepEqual(result.unpacked, [], `${fixture.label}: all cases resolve`);
    phb2AssertSafe(Solver, PackLib, result, zones, fixture.label, truck);
    const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(JSON.stringify([...result.placements]), JSON.stringify([...repeat.placements]), `${fixture.label}: deterministic layout`);
    assert.equal(JSON.stringify([...result.orientedDims]), JSON.stringify([...repeat.orientedDims]), `${fixture.label}: deterministic orientations`);
  }
});

test('PHASE-B2A mixed repeated groups complete legal A strips before B consumes floor space', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const aSpec = { caseId: 'A', dims: { l: 42, w: 10, h: 16 }, orientationLock: 'any', canFlip: false, weight: 30 };
  const bSpec = { caseId: 'B', dims: { l: 20, w: 10, h: 16 }, orientationLock: 'any', canFlip: false, weight: 20 };
  const items = [
    ...Array.from({ length: 64 }, (_, index) => ({ ...aSpec, instanceId: `A${index}` })),
    ...Array.from({ length: 20 }, (_, index) => ({ ...bSpec, instanceId: `B${index}` })),
  ];
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(phb2FloorCount(result, zones, Solver), 54, 'mixed fixture uses 53 A floor slots before the one remaining B floor slot');
  assert.deepEqual(result.placements.get('A2'), { x: 219, y: 8, z: 41 }, 'A completes the proven forward strip before its rear grid cell');
  assert.deepEqual(result.orientedDims.get('A2'), { length: 42, width: 10, height: 16 }, 'A forward strip uses the legal alternate yaw');
  assert.deepEqual(result.placements.get('B0'), { x: 20, y: 8, z: 41 }, 'B begins only in the rear residual strip after A completion');
  assert.ok([...result.placements.keys()].indexOf('A2') < [...result.placements.keys()].indexOf('B0'),
    'the active A group completes its forward wall before B receives floor space');
  assert.equal(phb2SequentialForwardViolation(
    Solver,
    result,
    zones,
    new Map(items.map(item => [item.instanceId, item]))
  ), null, 'mixed groups never advance rearward past a legal same-case wall completion');
  assert.equal(phb2FloorHole(Solver, result, zones, aSpec), null, 'no legal A floor opening is left behind');
  phb2AssertSafe(Solver, PackLib, result, zones, 'mixed A/B', truck);
});

test('PHASE-B2A identical-case matrix stays safe and deterministic in Standard, Wheel Wells, and real Front Overhang geometry', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truth = await threeOrientedTruth();
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    for (const count of [6, 20, 40, 100]) {
      const truck = {
        length: 240, width: 96, height: 96, shapeMode,
        ...(shapeMode === 'frontBonus' ? { shapeConfig: { bonusLength: 48, bonusHeight: 43.2 } } : {}),
      };
      const zones = PackLib.getTrailerUsableZones(truck);
      const itemSpec = { caseId: 'A', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'any', canFlip: false, weight: 30 };
      const items = Array.from({ length: count }, (_, index) => ({ ...itemSpec, instanceId: `i${index}` }));
      const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
      phb2AssertSafe(Solver, PackLib, result, zones, `${shapeMode}/${count}`, truck);
      for (const [id, dims] of result.orientedDims) {
        const expected = truth(PHB_DIMS, result.rotations.get(id));
        assert.deepEqual(dims, expected, `${shapeMode}/${count}: ${id} uses THREE-compatible dimensions`);
      }
      if (shapeMode !== 'frontBonus' && phb2FloorCount(result, zones, Solver) < count) {
        assert.equal(phb2FloorHole(Solver, result, zones, itemSpec), null,
          `${shapeMode}/${count}: no legal floor hole remains before stacking`);
      }
      if (shapeMode === 'frontBonus') {
        const deck = zones.find(zone => zone.min.y > 0.05 && zone.max.x > truck.length + 0.05);
        assert.equal([...result.placements].some(([id, position]) => {
          const dims = result.orientedDims.get(id);
          return Solver.isAabbContainedInAnyZone(
            Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height }),
            [deck]
          );
        }), false, `${shapeMode}/${count}: an empty raised deck is ineligible without a retaining wall`);
      }
      const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
      assert.equal(JSON.stringify([...result.placements]), JSON.stringify([...repeat.placements]), `${shapeMode}/${count}: deterministic`);
    }
  }
});

test('PHASE-B2C exact forward-wall regressions place alternate orientations before rear grid cells', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const fixtures = [
    {
      label: 'Wheel Wells 24x18',
      truck: { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' },
      dims: { l: 24, w: 18, h: 16 },
      completionId: 'i22',
      completionPosition: { x: 132, y: 8, z: 23.4 },
      completionDims: { length: 24, width: 18, height: 16 },
      rearFrontEdge: 126,
    },
    {
      label: 'Standard 42x10',
      truck: { length: 240, width: 96, height: 96, shapeMode: 'rect' },
      dims: { l: 42, w: 10, h: 16 },
      completionId: 'i2',
      completionPosition: { x: 219, y: 8, z: 41 },
      completionDims: { length: 42, width: 10, height: 16 },
      rearFrontEdge: 230,
    },
  ];

  for (const fixture of fixtures) {
    const zones = PackLib.getTrailerUsableZones(fixture.truck);
    const itemSpec = {
      caseId: 'A', dims: fixture.dims, orientationLock: 'any', canFlip: false, weight: 30,
    };
    const items = Array.from({ length: 100 }, (_, index) => ({ ...itemSpec, instanceId: `i${index}` }));
    const result = Solver.solveAutoPack({ truck: fixture.truck, zones, loadFrontFirst: true, items });
    const order = [...result.placements.keys()];
    const firstRearId = [...result.placements].find(([id, position]) => {
      const dims = result.orientedDims.get(id);
      const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
      return Math.abs(aabb.min.y) <= 0.05 && Math.abs(aabb.max.x - fixture.rearFrontEdge) <= 0.05;
    })?.[0];
    assert.deepEqual(result.placements.get(fixture.completionId), fixture.completionPosition,
      `${fixture.label}: exact alternate-orientation completion position`);
    assert.deepEqual(result.orientedDims.get(fixture.completionId), fixture.completionDims,
      `${fixture.label}: exact completion orientation dimensions`);
    assert.ok(firstRearId && order.indexOf(fixture.completionId) < order.indexOf(firstRearId),
      `${fixture.label}: forward wall completion precedes the first ${fixture.rearFrontEdge}-front grid cell`);
    assert.equal(phb2SequentialForwardViolation(
      Solver,
      result,
      zones,
      new Map(items.map(item => [item.instanceId, item]))
    ), null, `${fixture.label}: sequential forward-wall oracle passes`);
  }
});

test('PHASE-B2C sequential oracle, hard rules, and B2B animation hold for 100 identical cases in every geometry', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truth = await threeOrientedTruth();
  const dimensionFixtures = [
    { label: '24x18', dims: { l: 24, w: 18, h: 16 } },
    { label: '42x10', dims: { l: 42, w: 10, h: 16 } },
  ];

  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    for (const dimensionFixture of dimensionFixtures) {
      const truck = {
        length: 240, width: 96, height: 96, shapeMode,
        ...(shapeMode === 'frontBonus'
          ? { shapeConfig: { bonusLength: 28.8, bonusWidth: 96, bonusHeight: 43.2 } }
          : {}),
      };
      const zones = PackLib.getTrailerUsableZones(truck);
      const itemSpec = {
        caseId: 'A',
        dims: dimensionFixture.dims,
        orientationLock: 'any',
        canFlip: false,
        weight: 30,
        maxStackCount: 2,
      };
      const items = Array.from({ length: 100 }, (_, index) => ({ ...itemSpec, instanceId: `i${index}` }));
      const itemSpecsById = new Map(items.map(item => [item.instanceId, item]));
      const label = `${shapeMode}/${dimensionFixture.label}`;
      const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
      const placementSnapshot = JSON.stringify([...result.placements]);
      const rotationSnapshot = JSON.stringify([...result.rotations]);

      assert.deepEqual(result.unpacked, [], `${label}: every case resolves`);
      assert.equal(phb2SequentialForwardViolation(Solver, result, zones, itemSpecsById), null,
        `${label}: no rearward transition skips a legal same-layer forward candidate`);
      phb2AssertSafe(Solver, PackLib, result, zones, label, truck);
      phb2AssertDirectStackLimit(Solver, result, 2, label);

      const legalOrientations = Solver.buildOrientationCandidates(itemSpec.dims, itemSpec);
      for (const [id, dims] of result.orientedDims) {
        const rotation = result.rotations.get(id);
        assert.deepEqual(dims, truth({
          length: dimensionFixture.dims.l,
          width: dimensionFixture.dims.w,
          height: dimensionFixture.dims.h,
        }, rotation), `${label}: ${id} uses THREE dimensions`);
        assert.ok(legalOrientations.some(candidate =>
          candidate.l === dims.length && candidate.w === dims.width && candidate.h === dims.height &&
          candidate.rotation.x === rotation.x && candidate.rotation.y === rotation.y && candidate.rotation.z === rotation.z
        ), `${label}: ${id} uses a policy-approved orientation`);
      }

      const caseIds = new Map(items.map(item => [item.instanceId, item.caseId]));
      const batches = Engine.buildPlacementAnimationBatches(result.placements, result.orientedDims, caseIds, 4);
      phb2AssertAnimationBatches(Solver, result, caseIds, batches, `${label}/animation`);
      assert.equal(JSON.stringify([...result.placements]), placementSnapshot,
        `${label}: B2B animation planning does not mutate solver positions`);
      assert.equal(JSON.stringify([...result.rotations]), rotationSnapshot,
        `${label}: B2B animation planning does not mutate solver rotations`);

      const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
      assert.equal(JSON.stringify([...repeat.placements]), placementSnapshot, `${label}: deterministic positions`);
      assert.equal(JSON.stringify([...repeat.rotations]), rotationSnapshot, `${label}: deterministic rotations`);
    }
  }
});

test('PHASE-C2 floor-first (enableStackPhase:false) never stacks cargo, even where the default strategy builds a retention wall', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const restsOnAnyFloor = aabb => zones.some(zone => Math.abs(aabb.min.y - zone.min.y) <= 0.05);

  // Enough identical cargo to overflow the main floor so the default strategy
  // resorts to stacking (proves the fixture is non-vacuous).
  const items = Array.from({ length: 100 }, (_, index) => ({
    instanceId: `fo${index}`, caseId: 'fo-crowded', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'any', canFlip: false, weight: 30,
  }));

  const defaultResult = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const defaultStackedIds = [...defaultResult.placements].filter(([id, pos]) => {
    const dims = defaultResult.orientedDims.get(id);
    return !restsOnAnyFloor(Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height }));
  });
  assert.ok(defaultStackedIds.length > 0,
    'fixture must actually exercise stacking under the default strategy, or the floor-first assertion below is vacuous');

  const floorFirstResult = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableStackPhase: false });
  for (const [id, pos] of floorFirstResult.placements) {
    const dims = floorFirstResult.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height });
    assert.ok(restsOnAnyFloor(aabb),
      `floor-first placement ${id} must rest on a zone floor (main or deck), never on top of another case`);
  }
  assert.equal(floorFirstResult.phaseStats.stackCount, 0, 'floor-first must report zero stacked placements');
});

test('PHASE-E2B Standard and Wheel Wells solver bytes match the E2B channel-layer baseline', async () => {
  // E2B keeps every E2A/E1 result and additionally makes wheel-well CHANNEL stack
  // layers follow the footprint below them (the support-match is ranked ahead of the
  // front key, but only for candidates inside a narrow channel). The floor is
  // untouched, so the forward-density / floor-hole / B2A / B2C oracles are unchanged.
  // Only the two STACKED wheel-well fixtures shift (24x18/100 and 42x10/100): their
  // channel layers stop drifting into a per-layer re-shuffle. Placement count and
  // yaw-mix are unchanged and the layout stays collision/containment safe. Standard
  // (no narrow channel) and the smaller wheel-well counts are byte-identical to E2A.
  const { Solver, PackLib } = await phbSolverModules();
  const baselines = new Map([
    ['rect/24x18/6', '044feae3a855bdde870013be934591e0cda21562eb9fc634791ba9b839ecff03'],
    ['rect/24x18/20', '0561b56233172e29db53116236e717433123a1a7ec83f921bf85647e278abcc7'],
    ['rect/24x18/40', '58568e03af8882cba8bb32e89142f6c84954a2be9cc921703ac1880d656efa56'],
    ['rect/24x18/100', '18695a66089b5032c5ec8ab443f5ca127ba08237dbda20ce8e2cc9f9a793abd1'],
    ['rect/42x10/100', 'dc9fe480c13d0737aee269323d2118bf53f60eb8ae8754b8e64b276a5022e9a7'],
    ['wheelWells/24x18/6', '044feae3a855bdde870013be934591e0cda21562eb9fc634791ba9b839ecff03'],
    ['wheelWells/24x18/20', '0561b56233172e29db53116236e717433123a1a7ec83f921bf85647e278abcc7'],
    ['wheelWells/24x18/40', 'f50bbb6728343bc36bcbb04e92ff238831236c7b5720dc32d9145508930275ed'],
    // E2B: channel stack layers now follow the footprint below (no per-layer drift).
    ['wheelWells/24x18/100', '0b858a4b86dffb0b4c7bbc8d332c75df5c2628082bc9909ace21874dec1bbf3d'],
    // Channel-floor alignment fix: the narrow-channel floor compaction no longer
    // shuffles rows laterally between the two channel walls, so the 42x10 channel
    // settles into a single column-aligned lane set (matching the clean
    // compaction-off layout). Packed count, yaw-mix, and hard-safety are unchanged;
    // every other rect/* and wheelWells/* fixture stays byte-identical.
    ['wheelWells/42x10/100', '223e8cb8da2fa2a3f85d01796736f182628b7d36a5cc2ea6f9d802d013929895'],
  ]);
  const dimensionFixtures = [
    { label: '24x18', dims: { l: 24, w: 18, h: 16 }, counts: [6, 20, 40, 100] },
    { label: '42x10', dims: { l: 42, w: 10, h: 16 }, counts: [100] },
  ];
  for (const shapeMode of ['rect', 'wheelWells']) {
    for (const fixture of dimensionFixtures) {
      for (const count of fixture.counts) {
        const truck = { length: 240, width: 96, height: 96, shapeMode };
        const zones = PackLib.getTrailerUsableZones(truck);
        const items = Array.from({ length: count }, (_, index) => ({
          instanceId: `i${index}`, caseId: 'A', dims: fixture.dims,
          orientationLock: 'any', canFlip: false, weight: 30, maxStackCount: 2,
        }));
        const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
        const hash = createHash('sha256').update(phcResultBytes(result)).digest('hex');
        assert.equal(hash, baselines.get(`${shapeMode}/${fixture.label}/${count}`),
          `${shapeMode}/${fixture.label}/${count}: byte-equivalent to the E2B channel-layer baseline`);
      }
    }
  }
});

stressTest('PHASE-E1 Standard 800 identical 24x18: one yaw, every stacked case follows an aligned supporter, no placement regression, deterministic', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truth = await threeOrientedTruth();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = e1Items(800, { l: 24, w: 18, h: 16 });
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
  assert.ok(res.placements.size >= off.placements.size, `E1 never drops placements vs quality-off (${res.placements.size} >= ${off.placements.size})`);
  const P = e1Placed(Solver, res);
  // Single consistent yaw across floor and every stack layer (no flip).
  const yaws = new Set(P.map(p => `${Math.round(p.od.length)}x${Math.round(p.od.width)}`));
  assert.equal(yaws.size, 1, `identical cases keep one yaw, got ${[...yaws].join(',')}`);
  // Layers follow the first layer footprint: every stacked case is squarely supported.
  const follow = e1LayerFollowFraction(P);
  assert.ok(follow.stacked > 0, 'the load stacks (multi-layer)');
  assert.equal(follow.following, follow.stacked, `every stacked case follows an aligned same-yaw supporter (${follow.following}/${follow.stacked})`);
  // Broad blocks, not scattered towers: quality-off vs on tower-column comparison.
  const offFollow = e1LayerFollowFraction(e1Placed(Solver, off));
  assert.ok(follow.fraction >= offFollow.fraction, `E1 layer-follow is no worse than quality-off (${follow.fraction.toFixed(2)} >= ${offFollow.fraction.toFixed(2)})`);
  e1AssertSafe(Solver, PackLib, P, zones, 'std/24x18/800');
  for (const p of P) {
    const t = truth({ length: 24, width: 18, height: 16 }, res.rotations.get(p.id));
    assert.deepEqual({ l: p.od.length, w: p.od.width, h: p.od.height }, { l: t.length, w: t.width, h: t.height }, 'std/24x18/800: THREE dims');
  }
  const res2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(JSON.stringify([...res.placements]), JSON.stringify([...res2.placements]), 'deterministic on repeat');
});

stressTest('PHASE-E1 Standard 800 cube and 42x10 stay safe, broad, and lose no placements', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const dims of [{ l: 20, w: 20, h: 20 }, { l: 42, w: 10, h: 16 }]) {
    const items = e1Items(800, dims);
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    assert.ok(res.placements.size >= off.placements.size, `${dims.l}x${dims.w}: no placement regression (${res.placements.size} >= ${off.placements.size})`);
    const P = e1Placed(Solver, res);
    e1AssertSafe(Solver, PackLib, P, zones, `std/${dims.l}x${dims.w}/800`);
    const follow = e1LayerFollowFraction(P);
    assert.equal(follow.following, follow.stacked, `${dims.l}x${dims.w}: every stacked case follows an aligned supporter`);
    const res2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(JSON.stringify([...res.placements]), JSON.stringify([...res2.placements]), `${dims.l}x${dims.w}: deterministic`);
  }
});

test('PHASE-E1 Wheel Wells 100 and 800 identical 24x18: improved stack layer continuity, no hard-rule or placement regression', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const n of stressCounts([100, 800])) {
    const items = e1Items(n, { l: 24, w: 18, h: 16 });
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    assert.ok(res.placements.size >= off.placements.size, `WW/${n}: no placement regression (${res.placements.size} >= ${off.placements.size})`);
    const P = e1Placed(Solver, res);
    e1AssertSafe(Solver, PackLib, P, zones, `ww/24x18/${n}`);
    if (n === 800) {
      // Stacks exist and follow the layer below at least as well as quality-off.
      const follow = e1LayerFollowFraction(P);
      const offFollow = e1LayerFollowFraction(e1Placed(Solver, off));
      assert.ok(follow.stacked > 0 && follow.fraction >= offFollow.fraction,
        `WW/800: stack layer continuity not worse than quality-off (${follow.fraction.toFixed(2)} >= ${offFollow.fraction.toFixed(2)})`);
    }
    const res2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(JSON.stringify([...res.placements]), JSON.stringify([...res2.placements]), `WW/${n}: deterministic`);
  }
});

stressTest('PHASE-E1 Wheel Wells 800 cube: no safety or capacity regression', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = e1Items(800, { l: 20, w: 20, h: 20 });
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
  assert.ok(res.placements.size >= off.placements.size, `WW cube: no capacity regression (${res.placements.size} >= ${off.placements.size})`);
  e1AssertSafe(Solver, PackLib, e1Placed(Solver, res), zones, 'ww/cube/800');
});

test('PHASE-E1 honors canFlip:false (no tipping) and orientationLock upright/any across modes', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  for (const shapeMode of ['rect', 'wheelWells']) {
    const truck = { length: 636, width: 102, height: 98, shapeMode };
    const zones = PackLib.getTrailerUsableZones(truck);
    // canFlip:false, lock 'any' → only upright yaw rotations (no tipped faces): height stays 16.
    const resAny = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: e1Items(120, { l: 24, w: 18, h: 16 }, { canFlip: false, orientationLock: 'any' }) });
    for (const [, od] of resAny.orientedDims) {
      assert.equal(od.height, 16, `${shapeMode}: canFlip:false never tips (height stays 16)`);
    }
    // orientationLock:'upright' → footprint may yaw but height is fixed upright.
    const resUp = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: e1Items(120, { l: 24, w: 18, h: 16 }, { canFlip: true, orientationLock: 'upright' }) });
    for (const [, od] of resUp.orientedDims) {
      assert.equal(od.height, 16, `${shapeMode}: orientationLock upright stays upright even with canFlip`);
    }
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, resAny), zones, `${shapeMode}/canflip-false`);
  }
});

test('PHASE-E1 leaves Front Overhang C2 rear-retention unchanged (deck still requires valid retention)', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const n of [6, 20, 40, 100]) {
    const items = e1Items(n, { l: 24, w: 18, h: 16 }, { caseId: 'A', maxStackCount: 2 });
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    // C2 invariant preserved: with no retaining wall the deck stays unused.
    assert.equal(res.retentionDependencies.size, 0, `FO/${n}: no invalid deck dependency (C2 unchanged)`);
    const onDeck = e1Placed(Solver, res).filter(p => p.minY > 0.5 + 43.2 - 0.5 && p.pos.x > 240.5);
    assert.equal(onDeck.length, 0, `FO/${n}: deck stays unused without retention (C2 unchanged)`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, res), zones, `FO/${n}`);
  }
});

test('PHASE-E2A floor quality unifies sub-grid same-case yaw outside Front Overhang (fails with quality off), no placement loss, deterministic', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  // 7 identical cases is below the repeated-batch threshold (8), so every case is
  // placed by the scored findFloorPlacement path that E2A re-ranks — the exact path
  // the audit found was discarding continuity for Standard/Wheel Wells.
  for (const shapeMode of ['rect', 'wheelWells']) {
    const truck = { length: 240, width: 96, height: 96, shapeMode };
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = e1Items(7, { l: 24, w: 18, h: 16 }, { caseId: 'A', maxStackCount: 2 });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.ok(on.placements.size >= off.placements.size, `${shapeMode}/7: no placement regression`);
    assert.ok(e2aFlips(Solver, on) <= e2aFlips(Solver, off), `${shapeMode}/7: yaw mixing never worse with quality on`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, `e2a/${shapeMode}/7`);
    const on2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...on2.placements]), `${shapeMode}/7: deterministic`);
  }
  // Wheel Wells specifically: quality off leaves a flipped case, quality on unifies
  // the row to a single yaw — this assertion fails on the pre-E2A solver.
  const wwTruck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const wwZones = PackLib.getTrailerUsableZones(wwTruck);
  const wwItems = e1Items(7, { l: 24, w: 18, h: 16 }, { caseId: 'A', maxStackCount: 2 });
  const wwOff = Solver.solveAutoPack({ truck: wwTruck, zones: wwZones, loadFrontFirst: true, items: wwItems, layoutQuality: false });
  const wwOn = Solver.solveAutoPack({ truck: wwTruck, zones: wwZones, loadFrontFirst: true, items: wwItems });
  assert.ok(e2aFlips(Solver, wwOff) > 0, 'pre-E2A floor mixes yaw for sub-grid Wheel Wells (baseline of the bug)');
  assert.equal(e2aFlips(Solver, wwOn), 0, 'E2A unifies sub-grid Wheel Wells floor to a single yaw');
});

test('PHASE-E2A Standard identical 24x18 (61/100/300/800): single floor yaw, canFlip honored, no placement regression, deterministic', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const n of stressCounts([61, 100, 300, 800])) {
    const items = e1Items(n, { l: 24, w: 18, h: 16 });
    const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    assert.ok(on.placements.size >= off.placements.size, `Std/${n}: no placement regression (${on.placements.size} >= ${off.placements.size})`);
    assert.equal(e2aFlips(Solver, on), 0, `Std/${n}: identical cases keep a single yaw`);
    for (const [, od] of on.orientedDims) assert.equal(od.height, 16, `Std/${n}: canFlip:false never tips (height 16)`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, `e2a/std/${n}`);
    if (n <= 300) {
      const on2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
      assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...on2.placements]), `Std/${n}: deterministic`);
    }
  }
});

test('PHASE-E2A Wheel Wells identical 24x18 (100/300/800): no regression, yaw-mix bounded by channel geometry, deterministic', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const n of stressCounts([100, 300, 800])) {
    const items = e1Items(n, { l: 24, w: 18, h: 16 });
    const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    assert.ok(on.placements.size >= off.placements.size, `WW/${n}: no placement regression (${on.placements.size} >= ${off.placements.size})`);
    assert.ok(e2aFlips(Solver, on) <= e2aFlips(Solver, off), `WW/${n}: yaw mixing never worse than quality off`);
    // Residual flips are the geometrically-forced 71.4" wheel-well channel fillers
    // (a third 24" footprint cannot fit, so a rotated case fills the leftover strip).
    // Bound them well below a third of the load so a real scatter regression trips.
    assert.ok(e2aFlips(Solver, on) <= on.placements.size * 0.15, `WW/${n}: yaw-mix bounded (${e2aFlips(Solver, on)}/${on.placements.size})`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, `e2a/ww/${n}`);
    if (n <= 300) {
      const on2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
      assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...on2.placements]), `WW/${n}: deterministic`);
    }
  }
});

test('PHASE-E2A Standard 42x10 and cube cases stay clean (single yaw, safe, no regression)', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const dims of [{ l: 42, w: 10, h: 16 }, { l: 20, w: 20, h: 20 }]) {
    const items = e1Items(300, dims);
    const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    assert.ok(on.placements.size >= off.placements.size, `${dims.l}x${dims.w}: no placement regression`);
    assert.equal(e2aFlips(Solver, on), 0, `${dims.l}x${dims.w}: single yaw on full-width truck`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, `e2a/clean/${dims.l}x${dims.w}`);
  }
});

test('PHASE-E2A leaves Front Overhang C2 rear-retention and deck gating unchanged', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const n of [6, 20, 40, 100]) {
    const items = e1Items(n, { l: 24, w: 18, h: 16 }, { caseId: 'A', maxStackCount: 2 });
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(res.retentionDependencies.size, 0, `FO/${n}: no invalid deck dependency (C2 unchanged under E2A)`);
    const onDeck = e1Placed(Solver, res).filter(p => p.minY > 0.5 + 43.2 - 0.5 && p.pos.x > 240.5);
    assert.equal(onDeck.length, 0, `FO/${n}: deck stays unused without retention (C2 unchanged under E2A)`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, res), zones, `e2a/FO/${n}`);
  }
});

test('PHASE-E2B Wheel Wells channel stack layers follow the floor footprint (uniform, no drift), placement non-decreasing, deterministic', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const n of stressCounts([100, 300, 800])) {
    const items = e1Items(n, { l: 24, w: 18, h: 16 });
    const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    assert.ok(on.placements.size >= off.placements.size, `WW/${n}: no placement regression (${on.placements.size} >= ${off.placements.size})`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, `e2b/ww/${n}`);
    // Channel stack layers must be uniform (every full stacked layer holds the same
    // count) — i.e. each layer follows the one below instead of drifting. The final
    // (top) layer may be a partial remainder, so compare the full layers only.
    const layers = e2bChannelStackLayers(Solver, on);
    if (layers.length >= 2) {
      const full = layers.slice(0, -1);
      const uniform = full.every(c => c === full[0]);
      assert.ok(uniform, `WW/${n}: channel stack layers are uniform (no drift), got [${layers.join(',')}]`);
    }
    const on2 = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...on2.placements]), `WW/${n}: deterministic`);
  }
});

stressTest('PHASE-E2B Wheel Wells x800 keeps at least the E2A placed count (701) and channel layers no longer drift', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = e1Items(800, { l: 24, w: 18, h: 16 });
  const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.ok(on.placements.size >= 701, `WW/800: placed count at least the E2A baseline of 701 (got ${on.placements.size})`);
  const layers = e2bChannelStackLayers(Solver, on);
  // E2A drifted (e.g. one full layer at 28 and a partial 7); E2B's full channel
  // stack layers are all equal.
  const full = layers.slice(0, -1);
  assert.ok(full.length >= 1 && full.every(c => c === full[0]),
    `WW/800: channel stack layers uniform, got [${layers.join(',')}]`);
  e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, 'e2b/ww/800');
});

test('PHASE-E2B leaves Standard, 42x10, cube and canFlip:false behavior unchanged (no regression)', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const dims of [{ l: 24, w: 18, h: 16 }, { l: 42, w: 10, h: 16 }, { l: 20, w: 20, h: 20 }]) {
    const items = e1Items(300, dims);
    const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, layoutQuality: false });
    assert.ok(on.placements.size >= off.placements.size, `Std ${dims.l}x${dims.w}: no placement regression`);
    // Standard has no narrow channel, so E2B leaves it single-yaw and upright.
    assert.equal(e2aFlips(Solver, on), 0, `Std ${dims.l}x${dims.w}: single yaw on the full-width truck`);
    for (const [, od] of on.orientedDims) assert.equal(od.height, dims.h, `Std ${dims.l}x${dims.w}: canFlip:false never tips`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, `e2b/std/${dims.l}x${dims.w}`);
  }
});

test('PHASE-E2B leaves Front Overhang C2 rear-retention and deck gating unchanged', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  for (const n of [6, 20, 40, 100]) {
    const items = e1Items(n, { l: 24, w: 18, h: 16 }, { caseId: 'A', maxStackCount: 2 });
    const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(res.retentionDependencies.size, 0, `FO/${n}: no invalid deck dependency (C2 unchanged under E2B)`);
    const onDeck = e1Placed(Solver, res).filter(p => p.minY > 0.5 + 43.2 - 0.5 && p.pos.x > 240.5);
    assert.equal(onDeck.length, 0, `FO/${n}: deck stays unused without retention (C2 unchanged under E2B)`);
    e1AssertSafe(Solver, PackLib, e1Placed(Solver, res), zones, `e2b/FO/${n}`);
  }
});

test('PHASE-D stable global grouping removes avoidable A/B row fragments and preserves Phase C progression', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = phdAlternatingItems(7, 7);
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const rows = phdSpatialRows(Solver, result, items);
  const beforeRows = [
    { row: '0|240', cases: 'ABAB' },
    { row: '0|222', cases: 'ABAB' },
    { row: '0|204', cases: 'ABAB' },
    { row: '0|186', cases: 'AB' },
  ];

  assert.equal(result.placements.size, 14, 'grouping does not reduce placed quantity');
  assert.deepEqual(rows.map(row => ({ row: row.row, cases: row.cases })), [
    { row: '0|240', cases: 'AAAA' },
    { row: '0|222', cases: 'AAAB' },
    { row: '0|204', cases: 'BBBB' },
    { row: '0|186', cases: 'BB' },
  ], 'matching cases remain globally contiguous while the unretained deck stays empty');
  assert.ok(phdSplitRunCount(rows) < phdSplitRunCount(beforeRows),
    'complete-layout split runs improve from the recorded pre-Phase-D baseline');
  assert.ok(phdRowFragmentCount(rows) < phdRowFragmentCount(beforeRows),
    'within-row fragments improve from the recorded pre-Phase-D baseline');
  assert.deepEqual(rows.filter(row => row.row.startsWith('0|')).map(row => row.cases.length), [4, 4, 4, 2],
    'full main-floor rows precede the partial final row');

  const specsById = new Map(items.map(item => [item.instanceId, item]));
  assert.equal(phb2SequentialForwardViolation(
    Solver, result, zones, specsById, { sameLayerOnly: true }
  ), null, 'group continuity never skips a legal candidate on its eligible surface');
  phb2AssertSafe(Solver, PackLib, result, zones, 'Phase D grouped floor', truck);
  phb2AssertDirectStackLimit(Solver, result, 2, 'Phase D grouped floor');

  const snapshot = phcResultBytes(result);
  const reversed = Solver.solveAutoPack({
    truck, zones, loadFrontFirst: true, items: [...items].reverse(),
  });
  const repeated = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(phcResultBytes(reversed), snapshot,
    'equal-priority group layout is independent of alternating input order');
  assert.equal(phcResultBytes(repeated), snapshot, 'repeated AutoPack is byte-deterministic');

  const caseIds = new Map(items.map(item => [item.instanceId, item.caseId]));
  const placementSnapshot = JSON.stringify([...result.placements]);
  const batches = Engine.buildPlacementAnimationBatches(
    result.placements,
    result.orientedDims,
    caseIds,
    4,
    { frontSurfaceFirst: true, zones }
  );
  phb2AssertAnimationBatches(Solver, result, caseIds, batches, 'Phase D grouped floor animation');
  assert.equal(JSON.stringify([...result.placements]), placementSnapshot,
    'group-aware animation does not mutate the solver map');
});

test('PHASE-D groups equal-priority lanes and keeps equal-capacity row orientations consistent', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const laneTruck = phcFrontOverhangTruck();
  const laneZones = PackLib.getTrailerUsableZones(laneTruck);
  const laneItems = phdAlternatingItems(3, 3, {
    dims: { l: 120, w: 10, h: 10 }, orientationLock: 'upright', laneItem: true,
  });
  const laneResult = Solver.solveAutoPack({
    truck: laneTruck, zones: laneZones, loadFrontFirst: true, items: laneItems,
  });
  const laneRows = phdSpatialRows(Solver, laneResult, laneItems);
  assert.deepEqual(laneRows.map(row => row.cases), ['AAABBB'],
    'matching long cargo forms one contiguous front lane wall');
  phb2AssertSafe(Solver, PackLib, laneResult, laneZones, 'Phase D grouped lanes', laneTruck);

  const rotationTruck = {
    length: 120, width: 50, height: 72, shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 28.8, bonusWidth: 50, bonusHeight: 30 },
  };
  const rotationZones = PackLib.getTrailerUsableZones(rotationTruck);
  const rotationItems = Array.from({ length: 6 }, (_, index) => ({
    instanceId: `R${index}`, caseId: 'R', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'any', canFlip: false, weight: 30,
  }));
  const rotationResult = Solver.solveAutoPack({
    truck: rotationTruck, zones: rotationZones, loadFrontFirst: true, items: rotationItems,
  });
  const rotationRows = phdSpatialRows(Solver, rotationResult, rotationItems);
  for (const row of rotationRows) {
    assert.equal(new Set(row.orientations).size, 1,
      `${row.row}: equal-capacity row retains one orientation`);
  }
  phb2AssertSafe(Solver, PackLib, rotationResult, rotationZones, 'Phase D orientation continuity', rotationTruck);

  const mixedItems = [];
  for (let index = 0; index < 3; index++) {
    mixedItems.push({
      instanceId: `fit${index}`, caseId: 'fit', dims: { l: 24, w: 18, h: 16 },
      orientationLock: 'any', canFlip: false, weight: 100, maxStackCount: 2,
    });
    mixedItems.push({
      instanceId: `tall${index}`, caseId: 'tall', dims: { l: 24, w: 18, h: 60 },
      orientationLock: 'upright', canFlip: false, weight: 30, maxStackCount: 2,
    });
  }
  const mixed = Solver.solveAutoPack({
    truck: laneTruck, zones: laneZones, loadFrontFirst: true, items: mixedItems,
  });
  for (const [id, position] of mixed.placements) {
    const dims = mixed.orientedDims.get(id);
    const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
    if (id.startsWith('fit')) {
      const onDeck = aabb.min.x >= 240 - 0.05 && Math.abs(aabb.min.y - 43.2) <= 0.05;
      if (onDeck) {
        assert.ok((mixed.retentionDependencies.get(id) || []).some(retainerId => retainerId.startsWith('tall')),
          `${id}: grouping preserves retention dependencies for deck cargo`);
      } else {
        assert.ok(aabb.max.x <= 240 + 0.05, `${id}: unretained cargo stays on the main-floor side`);
      }
    } else {
      assert.ok(aabb.max.x <= 240 + 0.05 && Math.abs(aabb.min.y) <= 0.05,
        `${id}: grouping never overrides the deck height limit`);
    }
  }
  phb2AssertSafe(Solver, PackLib, mixed, laneZones, 'Phase D mixed height', laneTruck);
});

test('PHASE-D stack groups remain contiguous, supported, deterministic, and animation-safe', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 48, width: 36, height: 48, shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 24, bonusWidth: 36, bonusHeight: 24 },
  };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = phdAlternatingItems(7, 7, {
    dims: { l: 24, w: 18, h: 12 }, orientationLock: 'upright', canFlip: false,
  });
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const rows = phdSpatialRows(Solver, result, items);

  assert.equal(result.placements.size, 10, 'unsafe unretained deck overflow is staged instead of counted as placed');
  assert.equal(result.phaseStats.stackCount, 7, 'fixture exercises production stack placement without unretained deck overflow');
  assert.equal(result.unpacked.length, 4, 'items that cannot fit safely are reported');
  assert.equal(phdRowFragmentCount(rows), 0,
    'no stack/floor row returns to a case group after another group starts');
  phb2AssertSafe(Solver, PackLib, result, zones, 'Phase D grouped stacks', truck);
  phb2AssertDirectStackLimit(Solver, result, 2, 'Phase D grouped stacks');
  const deckY = truck.shapeConfig.bonusHeight;
  const overhangPlaced = phbPlaced(Solver, result, PHB_DIMS).filter(p => p.aabb.min.x >= truck.length - 0.05);
  assert.ok(overhangPlaced.length > 0,
    'retained covered Front Overhang sections are used once a legal retainer exists');
  const directDeckPlacements = overhangPlaced.filter(p => Math.abs(p.aabb.min.y - deckY) <= 0.05);
  assert.ok(directDeckPlacements.length > 0,
    'at least one overhang row rests directly on the configured deck height');
  for (const placement of overhangPlaced) {
    assert.ok(placement.aabb.min.y >= deckY - 0.05,
      `${placement.id}: overhang cargo must not occupy the cab void below deckY`);
    assert.ok((result.retentionDependencies.get(placement.id) || []).length > 0,
      `${placement.id}: overhang cargo must keep rear-retention dependencies`);
  }

  const repeated = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(phcResultBytes(repeated), phcResultBytes(result),
    'stacked grouping is byte-deterministic on repeated AutoPack');

  const caseIds = new Map(items.map(item => [item.instanceId, item.caseId]));
  const snapshot = JSON.stringify([...result.placements]);
  const batches = Engine.buildPlacementAnimationBatches(
    result.placements,
    result.orientedDims,
    caseIds,
    4,
    { frontSurfaceFirst: true, zones }
  );
  phb2AssertAnimationBatches(Solver, result, caseIds, batches, 'Phase D grouped stack animation');
  assert.equal(JSON.stringify([...result.placements]), snapshot,
    'stack animation planning leaves solver maps unchanged');
});

test('PHASE-B2B production animation planner preserves semantic boundaries (Std/WW/real FrontOverhang × 6/20/40/100)', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truth = await threeOrientedTruth();
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    for (const n of [6, 20, 40, 100]) {
      const truck = {
        length: 240, width: 96, height: 96, shapeMode,
        ...(shapeMode === 'frontBonus' ? { shapeConfig: { bonusLength: 48, bonusHeight: 43.2 } } : {}),
      };
      const zones = PackLib.getTrailerUsableZones(truck);
      const items = Array.from({ length: n }, (_, index) => ({ instanceId: `i${index}`, caseId: 'c', dims: { l: 24, w: 18, h: 16 }, shape: 'box', orientationLock: 'any', canFlip: false, weight: 30 }));
      const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
      const placementSnapshot = JSON.stringify([...result.placements]);
      const caseIds = new Map(items.map(item => [item.instanceId, item.caseId]));
      const batches4 = Engine.buildPlacementAnimationBatches(result.placements, result.orientedDims, caseIds, 4);
      const batches1 = Engine.buildPlacementAnimationBatches(result.placements, result.orientedDims, caseIds, 1);
      const order4 = phb2AssertAnimationBatches(Solver, result, caseIds, batches4, `${shapeMode}/${n}/batch4`);
      const order1 = phb2AssertAnimationBatches(Solver, result, caseIds, batches1, `${shapeMode}/${n}/batch1`);
      assert.deepEqual(order4.map(record => record.id), order1.map(record => record.id),
        `${shapeMode}/${n}: batch-size shadows preserve one semantic animation order`);
      assert.equal(JSON.stringify([...result.placements]), placementSnapshot,
        `${shapeMode}/${n}: animation planning does not mutate final solver positions`);
      phb2AssertSafe(Solver, PackLib, result, zones, `${shapeMode}/${n}/animation`, truck);
      for (const [id, dims] of result.orientedDims) {
        assert.deepEqual(dims, truth(PHB_DIMS, result.rotations.get(id)), `${shapeMode}/${n}: ${id} THREE dimensions`);
      }
      const repeat = Engine.buildPlacementAnimationBatches(result.placements, result.orientedDims, caseIds, 4);
      assert.equal(JSON.stringify(batches4), JSON.stringify(repeat), `${shapeMode}/${n}: deterministic animation batches`);
    }
  }
});

test('PHASE-B2B mixed case groups and support dependencies never share a semantic batch', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = [
    ...Array.from({ length: 64 }, (_, index) => ({ instanceId: `A${index}`, caseId: 'A', dims: { l: 42, w: 10, h: 16 }, orientationLock: 'any', canFlip: false, weight: 30 })),
    ...Array.from({ length: 20 }, (_, index) => ({ instanceId: `B${index}`, caseId: 'B', dims: { l: 20, w: 10, h: 16 }, orientationLock: 'any', canFlip: false, weight: 20 })),
  ];
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const caseIds = new Map(items.map(item => [item.instanceId, item.caseId]));
  const batches = Engine.buildPlacementAnimationBatches(result.placements, result.orientedDims, caseIds, 4);
  const order = phb2AssertAnimationBatches(Solver, result, caseIds, batches, 'mixed A/B');
  assert.ok(order.findIndex(record => record.id === 'A2') < order.findIndex(record => record.id === 'B0'),
    'the A alternate-yaw forward completion animates before B begins in the rear strip');
});

test('PHASE-B2B engine uses the production row-aware planner and never blind-slices semantic batches', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const start = src.indexOf('async function animatePlacements(');
  const end = src.indexOf('\n  function prepareObjectForPlacement(', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  assert.ok(block, 'animatePlacements block found');
  assert.match(block, /buildPlacementAnimationBatches\([\s\S]*placements,[\s\S]*orientedDimsMap,[\s\S]*caseIdMap,[\s\S]*ANIMATION_BATCH_SIZE/,
    'animatePlacements delegates semantic ordering to the production batch planner');
  assert.doesNotMatch(block, /entries\.slice\(i, i \+ ANIMATION_BATCH_SIZE\)/,
    'animatePlacements must not blindly slice across semantic boundaries');
});

test('AUTO-PACK-A0B AutoPack animation cannot leave the run promise stuck when tweens stop ticking', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const tweenStart = src.indexOf('function tweenInstanceToPosition(run, instanceId, positionInches, duration');
  const tweenEnd = src.indexOf('\n  function sleep(ms)', tweenStart);
  const block = tweenStart >= 0 && tweenEnd > tweenStart ? src.slice(tweenStart, tweenEnd) : '';

  assert.match(block, /const finish = \(\) =>/,
    'AutoPack tween bridge must use an idempotent finish helper');
  assert.match(block, /const fallbackDelay = Math\.max\(250, \(Number\(duration\) \|\| 0\) \+ TWEEN_FALLBACK_GRACE_MS\)/,
    'AutoPack tween bridge must define a bounded but not visually aggressive fallback delay');
  assert.match(block, /fallback = runtimeWindow\.setTimeout\(\(\) => \{[\s\S]*fallbackCount \+= 1;[\s\S]*finish\(\);[\s\S]*\}, fallbackDelay\)/,
    'AutoPack tween bridge must resolve even if the tween loop does not tick');
  assert.match(block, /if \(fallback !== null\) runtimeWindow\.clearTimeout\(fallback\);/,
    'AutoPack tween completion must clear the fallback through the shared finish path');
  assert.match(block, /\.onComplete\(finish\)/,
    'AutoPack tween completion must resolve through the same finish path as the fallback');
});

test('AUTO-PACK-A1-ANIM-1 AutoPack yields after staging before synchronous solving', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const packStart = src.indexOf('async function pack()');
  const solverStart = src.indexOf('const solverStartedAt = nowMs();', packStart);
  const block = packStart >= 0 && solverStart > packStart ? src.slice(packStart, solverStart) : '';

  assert.match(block, /stageInstant\(stagingMap\);[\s\S]*?await waitForAnimationFrames\(2\);\s*if \(isRunStale\(\)\) return;/,
    'AutoPack must allow staged items to paint before the synchronous solver can block the UI thread');
  assert.match(src, /function waitForAnimationFrames\(count = 1\)/,
    'AutoPack runtime must include an animation-frame yield helper');
});

test('AUTO-PACK-A1-ANIM-1 AutoPack animates placements in batches with fallback metrics', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const animateStart = src.indexOf('async function animatePlacements');
  const animateEnd = src.indexOf('\n  function prepareObjectForPlacement', animateStart);
  const block = animateStart >= 0 && animateEnd > animateStart ? src.slice(animateStart, animateEnd) : '';
  const tweenStart = src.indexOf('function tweenInstanceToPosition(run, instanceId, positionInches, duration');
  const tweenEnd = src.indexOf('\n  function sleep(ms)', tweenStart);
  const tweenBlock = tweenStart >= 0 && tweenEnd > tweenStart ? src.slice(tweenStart, tweenEnd) : '';

  assert.match(src, /const ANIMATION_BATCH_SIZE = 4;/,
    'AutoPack animation formally uses bounded batches of at most four items');
  assert.match(src, /const TWEEN_FALLBACK_GRACE_MS = 90;/,
    'AutoPack animation fallback must be short enough that large packs cannot look frozen for many seconds');
  assert.match(block, /buildPlacementAnimationBatches\(/,
    'AutoPack animation must use row/group/dependency-aware batches');
  assert.doesNotMatch(block, /entries\.slice\(i, i \+ ANIMATION_BATCH_SIZE\)/,
    'AutoPack animation must not blind-slice across semantic boundaries');
  assert.match(block, /batch\.forEach\(\(\[id, pos\]\) => \{[\s\S]*tweenInstanceToPosition\(run, id, pos, ANIMATION_DURATION_MS, metrics\);[\s\S]*\}\);/,
    'AutoPack animation must start each batch without awaiting per-object tween callbacks');
  assert.match(block, /await sleep\(ANIMATION_DURATION_MS \+ ANIMATION_BATCH_GAP_MS\);[\s\S]*snapInstanceToPosition\(id, pos\);/,
    'AutoPack animation must use a deterministic batch window and then snap the batch to final positions');
  assert.match(block, /metrics\.batches \+= 1;[\s\S]*metrics\.animated \+= batch\.length;/,
    'AutoPack animation must record batch and animated item counts');
  assert.match(tweenBlock, /metrics\) \{ metrics\.fallbackCount \+= 1; \}/,
    'AutoPack tween fallback must report fallback hits for diagnostics');
});

test('AUTO-PACK-A1-ANIM-1 AutoPack diagnostics report solver and animation timing', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const packStart = src.indexOf('async function pack()');
  const endStart = src.indexOf("if (diag && typeof diag.autopackEnd === 'function')", packStart);
  const endBlock = endStart >= 0 ? src.slice(endStart, src.indexOf('\n      previewRun = run;', endStart)) : '';

  // ESLint 10's no-useless-assignment rule flagged the `= 0` initializers as
  // dead stores: every reachable path assigns solverMs/animationMs from
  // nowMs() - startedAt before any read (verified — both assignments happen
  // before the sole read site in the diagnostics block below), so declaring
  // them without an initializer is runtime-equivalent.
  assert.match(src, /let runStartedAt;[\s\S]*let solverMs;[\s\S]*let animationMs;[\s\S]*const animationMetrics = \{ animated: 0, batches: 0, fallbackCount: 0 \};[\s\S]*runStartedAt = nowMs\(\);/,
    'AutoPack must initialize timing and animation metrics for each run');
  assert.match(src, /const solverStartedAt = nowMs\(\);[\s\S]*const packingSolution = runAdaptiveAutoPack\(\{[\s\S]*const solverResult = packingSolution \? packingSolution\.selectedSolution : null;[\s\S]*solverMs = nowMs\(\) - solverStartedAt;/,
    'AutoPack must measure synchronous adaptive solver time');
  assert.match(src, /const animationStartedAt = nowMs\(\);[\s\S]*animatePlacements\([\s\S]*animationMetrics[\s\S]*animationMs = nowMs\(\) - animationStartedAt;/,
    'AutoPack must measure animation time');
  assert.match(endBlock, /timings: \{[\s\S]*solverMs: Math\.round\(solverMs\),[\s\S]*animationMs: Math\.round\(animationMs\),[\s\S]*totalMs: Math\.round\(nowMs\(\) - runStartedAt\),[\s\S]*\}/,
    'AutoPack diagnostics must include solver, animation, and total timing');
  assert.match(endBlock, /animation: \{ \.\.\.animationMetrics \}/,
    'AutoPack diagnostics must include animation batch and fallback metrics');
});

test('AUTO-PACK-A1-PERF-1 AutoPack snaps large placement counts and keeps small counts animated', async () => {
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);

  assert.equal(Engine.LARGE_LOAD_ANIMATION_THRESHOLD, 300,
    'large-load animation cutoff is explicit and testable');
  assert.equal(Engine.shouldSnapLargeAutoPackLoad(0), false, 'empty loads do not use the large-load branch');
  assert.equal(Engine.shouldSnapLargeAutoPackLoad(300), false, 'the threshold remains in the normal animation path');
  assert.equal(Engine.shouldSnapLargeAutoPackLoad(301), true, 'the first count above the threshold snaps instantly');
  assert.equal(Engine.shouldSnapLargeAutoPackLoad(800), true, '800-case large loads skip the long animation path');
  assert.equal(Engine.shouldSnapLargeAutoPackLoad(1200), true, '1200-case large loads skip the long animation path');
});

stressTest('AUTO-PACK-A1-PERF-1 1200 identical cartons are safe solver outputs and qualify for instant rendering', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const fixtures = [
    { shapeMode: 'rect', expectedMinimumPlaced: 840 },
    { shapeMode: 'wheelWells', expectedMinimumPlaced: 706 },
  ];

  for (const fixture of fixtures) {
    const truck = { length: 636, width: 102, height: 98, shapeMode: fixture.shapeMode };
    const zones = PackLib.getTrailerUsableZones(truck);
    const result = Solver.solveAutoPack({
      truck,
      zones,
      loadFrontFirst: true,
      items: e1Items(1200, { l: 24, w: 18, h: 16 }),
    });
    const legacyAnimationMs = Math.ceil(result.placements.size / 4) * (260 + 16);

    assert.ok(result.placements.size >= fixture.expectedMinimumPlaced,
      `${fixture.shapeMode}: 1200-case capacity does not regress below the audited large-load baseline`);
    assert.equal(Engine.shouldSnapLargeAutoPackLoad(result.placements.size), true,
      `${fixture.shapeMode}: packed placement count chooses instant rendering`);
    assert.ok(legacyAnimationMs >= 45000,
      `${fixture.shapeMode}: old batched animation would be long enough to look frozen (${legacyAnimationMs}ms)`);
    phb2AssertSafe(Solver, PackLib, result, zones, `${fixture.shapeMode}/1200/perf`, truck);
  }
});

test('AUTO-PACK-A1-PERF-1 buildAutoPackNextCases is animation-independent and preserves packed/staged semantics', async () => {
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const sourceCases = [
    {
      id: 'packed',
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      orientedDims: { length: 1, width: 1, height: 1 },
    },
    {
      id: 'staged-rotated',
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    },
    {
      id: 'staged-identity',
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
      orientedDims: { length: 99, width: 99, height: 99 },
    },
    {
      id: 'hidden',
      hidden: true,
      transform: { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    },
  ];
  const packedPosition = { x: 10, y: 20, z: 30 };
  const packedRotation = { x: 0, y: Math.PI / 2, z: 0 };
  const packedDims = { length: 30, width: 10, height: 20 };
  const rotatedStaged = {
    position: { x: -10, y: 5, z: 4 },
    rotation: { x: Math.PI / 2, y: 0, z: 0 },
    orientedDims: { length: 6, width: 4, height: 8 },
  };
  const identityStaged = {
    position: { x: -20, y: 6, z: 4 },
    rotation: { x: 0, y: 0, z: 0 },
    orientedDims: { length: 7, width: 5, height: 9 },
  };

  const nextCases = Engine.buildAutoPackNextCases(
    sourceCases,
    new Map([['packed', packedPosition]]),
    new Map([['packed', packedRotation]]),
    new Map([['packed', packedDims]]),
    new Map([
      ['staged-rotated', rotatedStaged],
      ['staged-identity', identityStaged],
    ])
  );

  assert.equal(nextCases[0].placement, 'packed', 'placed items are marked packed');
  assert.deepEqual(nextCases[0].transform.position, packedPosition, 'packed position comes from solver placements');
  assert.deepEqual(nextCases[0].transform.rotation, packedRotation, 'packed rotation comes from solver rotations');
  assert.deepEqual(nextCases[0].orientedDims, packedDims, 'packed orientedDims come from solver dimensions');
  assert.equal(nextCases[1].placement, 'staged', 'unpacked items with staging poses are marked staged');
  assert.deepEqual(nextCases[1].transform.position, rotatedStaged.position, 'staged position comes from the staging map');
  assert.deepEqual(nextCases[1].transform.rotation, rotatedStaged.rotation, 'staged rotation stays atomic with staging position');
  assert.deepEqual(nextCases[1].orientedDims, rotatedStaged.orientedDims, 'non-identity staged poses keep orientedDims');
  assert.equal(nextCases[2].placement, 'staged', 'identity staged items are also persisted as staged');
  assert.deepEqual(nextCases[2].orientedDims, identityStaged.orientedDims,
    'identity staged poses persist dimensions matching the staging-map rotation');
  assert.equal(nextCases[3], sourceCases[3], 'hidden instances remain unchanged');
});

test('AUTO-PACK-A0C staged unpacked items use an atomic pose (position+rotation+orientedDims agree)', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const stagingStart = src.indexOf('export function buildStagedPose(item)');
  const stagingEnd = src.indexOf('\nexport function createAutoPackEngine', stagingStart);
  const stagingBlock = stagingStart >= 0 && stagingEnd > stagingStart ? src.slice(stagingStart, stagingEnd) : '';
  const persistStart = src.indexOf('export function buildAutoPackNextCases(');
  const persistEnd = src.indexOf('\nexport function createAutoPackEngine', persistStart);
  const persistBlock = persistStart >= 0 && persistEnd > persistStart ? src.slice(persistStart, persistEnd) : '';

  assert.doesNotMatch(stagingBlock, /item\.inst && item\.inst\.orientedDims/,
    'buildStagedPose must not read stale inst.orientedDims from a previous AutoPack run (RC-4 fix)');
  assert.doesNotMatch(stagingBlock, /item\.orientations\[0\]/,
    'visual staging does not inherit solver orientation-policy candidates');
  assert.match(stagingBlock, /item && item\.caseData && item\.caseData\.dimensions/,
    'staging starts from the real case dimensions');
  assert.match(stagingBlock, /rotation = \{ x: 0, y: 0, z: 0 \}/,
    'staging uses the deterministic identity rotation');
  assert.match(stagingBlock, /getOrientedDimsForRotation\(base, rotation\)/,
    'staging dimensions are derived from the exact stored staging rotation');
  // The staged item persists the same identity pose that produced its staging
  // position, not its prior packed rotation.
  assert.match(persistBlock, /rot = staged\.rotation/,
    'unpacked staged items take the staging-orientation rotation, keeping the pose atomic');
  assert.match(persistBlock, /od = staged\.orientedDims/,
    'unpacked staged items take the staging-orientation orientedDims, so render height matches staging Y');
});

test('AUTO-PACK-A0C computeStats OOG warnings use oriented dimensions and shape-aware zones', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const lockedCase = {
    id: 'locked-wide',
    name: 'Locked Wide',
    dimensions: { length: 20, width: 70, height: 10 },
    weight: 10,
  };
  const rectPack = {
    id: 'rect-oriented',
    truck: { length: 80, width: 40, height: 20, shapeMode: 'rect', shapeConfig: {} },
    cases: [{
      id: 'inst-oriented',
      caseId: lockedCase.id,
      hidden: false,
      orientedDims: { length: 70, width: 20, height: 10 },
      transform: {
        position: { x: 35, y: 5, z: 10 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  };
  assert.equal(PackLibrary.computeStats(rectPack, [lockedCase]).oogWarnings.length, 0,
    'valid rotated cases must not be flagged out-of-gauge by raw unrotated dimensions');

  const shortCase = {
    id: 'short-bonus',
    name: 'Short Bonus',
    dimensions: { length: 30, width: 24, height: 18 },
    weight: 10,
  };
  const frontPack = {
    id: 'front-oriented',
    truck: {
      length: 240,
      width: 96,
      height: 72,
      shapeMode: 'frontBonus',
      shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
    },
    cases: [{
      id: 'inst-front',
      caseId: shortCase.id,
      hidden: false,
      orientedDims: { length: 24, width: 30, height: 18 },
      transform: {
        position: { x: 228, y: 9, z: -12 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  };
  assert.equal(PackLibrary.computeStats(frontPack, [shortCase]).oogWarnings.length, 0,
    'valid front-bonus placements must use shape-aware usable zones before warning');

  const blockedWheelPack = {
    id: 'wheel-blocked',
    truck: {
      length: 100,
      width: 100,
      height: 100,
      shapeMode: 'wheelWells',
      shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
    },
    cases: [{
      id: 'inst-wheel-blocked',
      caseId: shortCase.id,
      hidden: false,
      orientedDims: { length: 10, width: 10, height: 10 },
      transform: {
        position: { x: 40, y: 5, z: 40 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  };
  const blockedWarnings = PackLibrary.computeStats(blockedWheelPack, [shortCase]).oogWarnings;
  assert.equal(blockedWarnings.length, 1,
    'items inside blocked wheel-well volume must still be reported as outside usable geometry');
  assert.deepEqual(blockedWarnings[0].issues, ['outsideUsableZone']);
});

test('AUTO-PACK-A0 trailer geometry helpers block wheel wells and preserve front bonus shape awareness', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  const wheelTruck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
  };
  const wheelZones = PackLibrary.getTrailerUsableZones(wheelTruck);
  assert.equal(wheelZones.length, 5,
    'wheelWells geometry must remain decomposed into shape-aware usable zones');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 35, y: 5, z: 35 },
    max: { x: 45, y: 15, z: 45 },
  }, wheelZones), false,
  'low boxes inside wheel well blocked volume must not be considered placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 35, y: 25, z: 35 },
    max: { x: 45, y: 35, z: 45 },
  }, wheelZones), true,
  'boxes above wheel well height may use the above-well zone');

  const frontBonusTruck = {
    length: 100,
    width: 100,
    height: 50,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 20, bonusWidth: 40, bonusHeight: 30 },
  };
  const frontZones = PackLibrary.getTrailerUsableZones(frontBonusTruck);
  // Overhang zone (raised deck): x:100..120, y:30..50 (bonusHeight..height), z:-50..50 (full width).
  // Cab void (blocked): x:100..120, y:0..30 (0..bonusHeight), z:-50..50 (full width).
  assert.equal(frontZones.length, 2,
    'frontBonus geometry must remain split between main body and front overhang zone');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 85, y: 5, z: -10 },
    max: { x: 95, y: 25, z: 10 },
  }, frontZones), true,
  'box inside the main body near the front must be placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 85, y: 35, z: -10 },
    max: { x: 95, y: 45, z: 10 },
  }, frontZones), true,
  'box inside the main body up to its full height must be placeable, even near the front');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 105, y: 35, z: -10 },
    max: { x: 115, y: 45, z: 10 },
  }, frontZones), true,
  'box resting on the raised overhang deck (y >= bonusHeight) must be placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 105, y: 5, z: -10 },
    max: { x: 115, y: 25, z: 10 },
  }, frontZones), false,
  'box entirely below the deck (in the cab void) must not be placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 105, y: 35, z: -40 },
    max: { x: 115, y: 45, z: 40 },
  }, frontZones), true,
  'overhang spans the full trailer width (ignoring bonusWidth=40); a box wider than bonusWidth but within truck.width must be placeable on the deck');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 95, y: 30, z: -10 },
    max: { x: 105, y: 45, z: 10 },
  }, frontZones), false,
  'a box straddling the main box and the raised overhang must not be placeable (cannot pass through the overhang structure)');
});

test('AUTO-PACK-A0 AutoPack keeps zone containment and stacking guards wired', async () => {
  const trailerGeometrySrc = await fs.readFile(trailerGeometryPath, 'utf8');
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  assert.match(engineSrc, /const physicalContextZones = TrailerGeometry\.getTrailerUsableZones\(packData\.truck\);[\s\S]*const zones = physicalContextZones;/,
    'AutoPack must continue deriving usable zones from trailer geometry');
  assert.match(trailerGeometrySrc, /if \(mode === 'frontBonus'\)[\s\S]*if \(mode === 'wheelWells'\)/,
    'trailer-geometry.js must keep frontBonus and wheelWells branches');
});

test('AUTO-PACK-A0B normalizeInstance preserves manual orientation lock metadata', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const normalized = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-locked',
        name: 'Locked Case',
        dimensions: { length: 48, width: 24, height: 30 },
      },
    ],
    packLibrary: [
      {
        id: 'pack-locked',
        title: 'Locked Pack',
        cases: [
          {
            id: 'inst-locked',
            caseId: 'case-locked',
            transform: {
              position: { x: 1, y: 15, z: 2 },
              rotation: { x: 0, y: Math.PI / 2, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            hidden: true,
            groupId: 'group-1',
            orientationLocked: true,
            lockedRotation: { x: 0, y: Math.PI / 2, z: 0 },
            orientedDims: { length: 999, width: 999, height: 999 },
          },
        ],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });
  const inst = normalized.packLibrary[0].cases[0];

  assert.equal(inst.orientationLocked, true,
    'normalizeInstance must preserve orientationLocked=true');
  assert.deepEqual(inst.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 },
    'normalizeInstance must preserve normalized lockedRotation');
  assert.deepEqual(inst.orientedDims, { length: 24, width: 48, height: 30 },
    'normalizeInstance must recompute safe orientedDims from case dimensions and lockedRotation');
  assert.deepEqual(inst.transform.rotation, { x: 0, y: Math.PI / 2, z: 0 },
    'normalizeInstance must not drop transform rotation');
  assert.equal(inst.hidden, true,
    'normalizeInstance must keep hidden state');
  assert.equal(inst.groupId, 'group-1',
    'normalizeInstance must keep groupId');
});

test('AUTO-PACK-A0B clipboard and duplicate flows preserve orientation lock metadata', async () => {
  const src = await fs.readFile(keyboardManagerPath, 'utf8');
  const duplicateStart = src.indexOf('function duplicateSelected(');
  const duplicateEnd = src.indexOf('\n    function copySelected(', duplicateStart);
  const duplicateBlock = duplicateStart >= 0 && duplicateEnd > duplicateStart ? src.slice(duplicateStart, duplicateEnd) : '';
  const copyStart = src.indexOf('function copySelected(');
  const copyEnd = src.indexOf('\n    function pasteClipboard(', copyStart);
  const copyBlock = copyStart >= 0 && copyEnd > copyStart ? src.slice(copyStart, copyEnd) : '';
  const pasteStart = src.indexOf('function pasteClipboard(');
  const pasteEnd = src.indexOf('\n    function toggleGrid(', pasteStart);
  const pasteBlock = pasteStart >= 0 && pasteEnd > pasteStart ? src.slice(pasteStart, pasteEnd) : '';
  const packLibSrc = await fs.readFile(packLibraryPath, 'utf8');
  const safeStart = packLibSrc.indexOf('export function buildSafeDuplicateInstances(');
  const safeEnd = packLibSrc.indexOf('\nexport function duplicateInstancesSafely', safeStart);
  const safeBlock = safeStart >= 0 && safeEnd > safeStart ? packLibSrc.slice(safeStart, safeEnd) : '';

  assert.match(copyBlock, /\.map\(i => Utils\.deepClone\(i\)\)/,
    'copySelected must copy the full instance metadata, including orientation locks');
  assert.match(duplicateBlock, /PackLibrary\.duplicateInstancesSafely\(packId,\s*source,\s*CaseLibrary\.getCases\(\)\)/,
    'duplicateSelected must route through the shared safe duplicate helper');
  assert.match(pasteBlock, /PackLibrary\.duplicateInstancesSafely\(packId,\s*clipboard,\s*CaseLibrary\.getCases\(\)\)/,
    'pasteClipboard must route clipboard instances through the shared safe duplicate helper');
  assert.match(safeBlock, /const next = Utils\.deepClone\(item\.inst\)/,
    'shared safe duplicate helper must preserve full instance metadata');
  assert.match(safeBlock, /next\.id = Utils\.uuid\(\)/,
    'shared safe duplicate helper must assign new ids after cloning metadata');
});

test('AUTO-PACK-A0B editor snapping uses usable-zone walls, not missing TrailerGeometry dimensions', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const helperStart = src.indexOf('function getSnapWallCandidatesWorld()');
  const helperEnd = src.indexOf('\n    /**\n     * Snap a world position', helperStart);
  const helperBlock = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';
  const snapStart = src.indexOf('function snapToNearest(instanceId, worldPos)');
  const snapEnd = src.indexOf('\n    /** Highlight instances', snapStart);
  const snapBlock = snapStart >= 0 && snapEnd > snapStart ? src.slice(snapStart, snapEnd) : '';

  assert.match(helperBlock, /TrailerGeometry\.getTrailerUsableZones\(truck\)/,
    'snap walls must come from shape-aware trailer usable zones');
  assert.match(helperBlock, /TrailerGeometry\.zonesInchesToWorld\(zonesInches\)/,
    'snap walls must convert usable zones into world coordinates');
  assert.match(helperBlock, /SceneManager\.getTruckBoundsWorld\(\)/,
    'snap walls may only use rectangular scene bounds as a no-pack fallback');
  assert.doesNotMatch(snapBlock, /TrailerGeometry\.(?:length|width)/,
    'snapToNearest must not depend on missing TrailerGeometry.length or TrailerGeometry.width properties');
  assert.match(snapBlock, /const wallCandidates = getSnapWallCandidatesWorld\(\)/,
    'snapToNearest must use the shape-aware wall candidate helper');
});

test('OPERATION-LIFECYCLE allows only one mutating operation at a time', async () => {
  const { createOperationLifecycle } = await import(`${operationLifecyclePath.href}?t=${Date.now()}-${Math.random()}`);
  const op = createOperationLifecycle();
  assert.equal(op.isBusy(), false, 'starts idle');
  assert.equal(op.currentOperation().kind, 'idle');

  const t1 = op.beginOperation('autopacking', { packId: 'p1' });
  assert.ok(t1, 'first operation gets a token');
  assert.equal(op.isBusy(), true);
  assert.equal(op.currentOperation().kind, 'autopacking');

  // A second operation cannot start while busy.
  assert.equal(op.beginOperation('unpacking'), null, 'second op blocked while busy');
  assert.equal(op.beginOperation('changingTruck'), null, 'truck change blocked while busy');
  assert.equal(op.currentOperation().kind, 'autopacking', 'active op unchanged by blocked attempts');
});

test('OPERATION-LIFECYCLE finish returns to idle and only the owning token may finish', async () => {
  const { createOperationLifecycle } = await import(`${operationLifecyclePath.href}?t=${Date.now()}-${Math.random()}`);
  const op = createOperationLifecycle();
  const t1 = op.beginOperation('autopacking');

  // A stale/incorrect token cannot finish the active operation.
  assert.equal(op.finishOperation('op-bogus'), false, 'wrong token cannot finish');
  assert.equal(op.finishOperation(null), false, 'null token cannot finish');
  assert.equal(op.isBusy(), true, 'still busy after bogus finish');
  assert.equal(op.isCurrent(t1), true);

  assert.equal(op.finishOperation(t1), true, 'owning token finishes');
  assert.equal(op.isBusy(), false, 'idle after finish');
  assert.equal(op.isCurrent(t1), false, 'old token is no longer current');

  // A second begin yields a DIFFERENT token; the old token can never finish it.
  const t2 = op.beginOperation('unpacking');
  assert.notEqual(t2, t1, 'new operation has a fresh token');
  assert.equal(op.finishOperation(t1), false, 'stale token cannot finish a newer operation');
  assert.equal(op.isBusy(), true, 'newer operation still active');
  assert.equal(op.finishOperation(t2), true);
  assert.equal(op.isBusy(), false);
});

test('OPERATION-LIFECYCLE assertIdle, subscribe, and invalid kinds behave correctly', async () => {
  const { createOperationLifecycle, OPERATION_KINDS } = await import(`${operationLifecyclePath.href}?t=${Date.now()}-${Math.random()}`);
  const op = createOperationLifecycle();
  assert.equal(OPERATION_KINDS.AUTOPACKING, 'autopacking');

  // Invalid / idle kinds never claim the slot.
  assert.equal(op.beginOperation('idle'), null, 'idle is not a claimable op');
  assert.equal(op.beginOperation('nonsense'), null, 'unknown kind cannot claim the slot');
  assert.equal(op.beginOperation(), null, 'missing kind cannot claim the slot');
  assert.equal(op.isBusy(), false);

  // assertIdle throws only while busy.
  assert.doesNotThrow(() => op.assertIdle('should be idle'));
  const events = [];
  const unsub = op.subscribe(snap => events.push(snap.kind));
  assert.equal(events[0], 'idle', 'subscribe fires immediately with current state');
  const tok = op.beginOperation('capturingPreview');
  assert.equal(events[events.length - 1], 'capturingPreview', 'subscriber notified on begin');
  assert.throws(() => op.assertIdle('busy now'), /busy now/, 'assertIdle throws the caller message while busy');
  assert.throws(() => op.assertIdle(), /progress/, 'assertIdle default message names the conflict');
  op.finishOperation(tok);
  assert.equal(events[events.length - 1], 'idle', 'subscriber notified on finish');
  unsub();
  op.beginOperation('autopacking');
  assert.equal(events[events.length - 1], 'idle', 'unsubscribed callback receives no further events');
});

test('PACK-PREVIEW-SCHEDULER retains a busy request and captures once the lifecycle returns idle', async () => {
  const runtime = await createPackPreviewSchedulerHarness();
  const operationToken = runtime.OperationLifecycle.beginOperation('autopacking');
  assert.ok(operationToken);
  runtime.scheduler.schedule();
  runtime.runTimers();
  assert.equal(runtime.captures.length, 0, 'busy lifecycle does not discard or execute the request');

  runtime.OperationLifecycle.finishOperation(operationToken);
  assert.equal(runtime.captures.length, 1, 'idle notification executes the one pending capture');
});

test('OPERATION-LIFECYCLE is wired into the AutoPack engine and editor unpack/truck paths', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  // Engine claims/releases the lifecycle slot around a pack run.
  assert.match(engineSrc, /OperationLifecycle|operationLifecycle/, 'engine receives the operation lifecycle');
  assert.match(engineSrc, /beginOperation\(\s*['"]autopacking['"]/, 'engine claims the autopacking slot');
  assert.match(engineSrc, /finishOperation\(/, 'engine releases the slot when the run ends');
  // Editor guards unpack and routes truck changes through the lifecycle.
  assert.match(editorSrc, /beginOperation\(\s*['"]unpacking['"]/, 'unpack claims the unpacking slot');
  assert.match(editorSrc, /OperationLifecycle|operationLifecycle/, 'editor receives the operation lifecycle');
});

test('OPERATION-LIFECYCLE: truck dropdowns update pending state and only Update Truck previews', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  // The preset/shape dropdown change handlers must NOT call the reconciliation/
  // preview path directly any more; only the explicit Update-truck commit does.
  const presetHandler = editorSrc.match(/presetSelect\.addEventListener\('change'[\s\S]{0,400}?\}\);/);
  assert.ok(presetHandler, 'preset change handler exists');
  assert.doesNotMatch(presetHandler[0], /applyTruckGeometryChange\(/,
    'preset change must update pending truck only, not call applyTruckGeometryChange');
  const shapeHandler = editorSrc.match(/shapeSelect\.addEventListener\('change'[\s\S]{0,1200}?\}\);/);
  assert.ok(shapeHandler, 'shape change handler exists');
  assert.doesNotMatch(shapeHandler[0], /applyTruckGeometryChange\(/,
    'shape change must update pending truck only, not call applyTruckGeometryChange');
});

test('OPERATION-LIFECYCLE-AMEND InteractionManager receives the lifecycle and guards its mutating actions', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const appSrc = await readAppSource();

  // Factory accepts the lifecycle and app.js injects it at construction.
  const factory = editorSrc.match(/export function createInteractionManager\(\{[\s\S]*?\}\) \{/);
  assert.ok(factory && /OperationLifecycle/.test(factory[0]), 'createInteractionManager must accept OperationLifecycle');
  assert.match(appSrc, /createInteractionManager\(\{[\s\S]*?OperationLifecycle,[\s\S]*?\}\);/,
    'app.js must inject OperationLifecycle into InteractionManager at construction');
  // The lifecycle must exist before InteractionManager is built (no late-binding race).
  assert.ok(
    appSrc.indexOf('const OperationLifecycle = createOperationLifecycle();') <
      appSrc.indexOf('const InteractionManager = createInteractionManager('),
    'OperationLifecycle must be created before InteractionManager',
  );

  // Each mutating InteractionManager action checks the lock.
  const guarded = ['function rotateSelection(', 'function nudgeSelection(', 'function deleteSelection(', 'function startDrag('];
  for (const fn of guarded) {
    const start = editorSrc.indexOf(fn);
    assert.ok(start >= 0, `${fn} must exist`);
    const block = editorSrc.slice(start, start + 400);
    assert.match(block, /operationsBusy\(\)/, `${fn.trim()} must early-out while an operation is busy`);
  }
});

test('OPERATION-LIFECYCLE-AMEND global keyboard mutations are blocked while busy', async () => {
  const keyboardSrc = await fs.readFile(keyboardManagerPath, 'utf8');
  assert.match(keyboardSrc, /function mutationBlockedWhileBusy\(\)[\s\S]*?OperationLifecycle\.isBusy\(\)/,
    'app keyboard manager must have a busy-guard helper backed by the lifecycle');
  const functionBlock = fn => {
    const start = keyboardSrc.indexOf(fn);
    assert.ok(start >= 0, `${fn} must exist`);
    const end = keyboardSrc.indexOf('\n    function ', start + fn.length);
    return keyboardSrc.slice(start, end > start ? end : undefined);
  };
  for (const fn of ['function pasteClipboard(', 'function undo()', 'function redo()']) {
    assert.match(functionBlock(fn), /if \(mutationBlockedWhileBusy\(\)\) return true;/, `${fn} must be blocked while busy`);
  }
  // Duplicate is not owned while busy: it mutates nothing and leaves Cmd/Ctrl+D to the browser.
  assert.match(functionBlock('function duplicateSelected('), /if \(!inEditor\(\) \|\| operationBusy\(\)\) return false;/,
    'duplicateSelected must be blocked while busy');
  // Delete shortcut routes through InteractionManager.deleteSelection (guarded above).
  assert.match(keyboardSrc, /function deleteSelected\(\)[\s\S]*?InteractionManager\.deleteSelection\(\)/,
    'delete shortcut must route through the guarded InteractionManager.deleteSelection');
});

test('OPERATION-LIFECYCLE-AMEND editor panel add/duplicate/delete mutations are blocked while busy', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(editorSrc, /function editorMutationBlocked\(\)[\s\S]*?OperationLifecycle\.isBusy\(\)/,
    'editor must have a busy-guard helper backed by the lifecycle');
  const addStart = editorSrc.indexOf('function addCaseToPack(');
  assert.match(editorSrc.slice(addStart, addStart + 220), /if \(editorMutationBlocked\(\)\) return;/,
    'addCaseToPack must be blocked while busy');
  const dupStart = editorSrc.indexOf('function duplicateSelection(');
  assert.match(editorSrc.slice(dupStart, dupStart + 220), /if \(editorMutationBlocked\(\)\) return;/,
    'duplicateSelection must be blocked while busy');
  // Inspector "Delete item/Delete" buttons guard the shared delete feedback path.
  const guardedDeletes = editorSrc.match(/onClick: \(\) => \{\s*if \(editorMutationBlocked\(\)\) return;\s*deleteInstancesWithFeedback\(/g) || [];
  assert.ok(guardedDeletes.length >= 2, 'inspector delete buttons must guard deleteInstancesWithFeedback with the busy check');
});

test('OPERATION-LIFECYCLE-AMEND pending truck config card renders the pending (effective) truck mode', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  // The config card mode + base values come from effectiveTruck (pending or committed),
  // so selecting Wheel Wells shows its settings before commit; the scene stays committed.
  assert.match(editorSrc, /=== Shape Config Card[\s\S]*?const currentMode = effectiveTruck && effectiveTruck\.shapeMode/,
    'config card mode must follow the effective (pending) truck, not committed pack.truck');
  assert.doesNotMatch(editorSrc, /const currentMode = pack\.truck && pack\.truck\.shapeMode \? pack\.truck\.shapeMode : 'rect';/,
    'config card must not key its mode off committed pack.truck');
  // Config commit payloads keep the pending dims/mode.
  assert.doesNotMatch(editorSrc, /const nextTruck = \{ \.\.\.pack\.truck, shapeConfig: nextCfg \};/,
    'config save/reset must commit from the effective truck so pending shape/dims are preserved');
});

test('PACKING-CORE-P5 Standard truck normalizes to a single-floor SpaceModel with zone parity', async () => {
  const { Core, PackLib } = await p5Modules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const model = Core.buildSpaceModel(truck);
  assert.deepEqual(model.zones, PackLib.getTrailerUsableZones(truck), 'zones are the production usable zones');
  assert.deepEqual(model.blocked, [], 'Standard has no blocked volumes');
  assert.equal(model.wheelWell, null, 'no wheel-well geometry');
  assert.equal(model.retention, null, 'no retention geometry');
  assert.equal(model.constrainedZones.length, 0, 'a single zone is never constrained');
  assert.equal(model.surfaces.length, 1, 'one surface');
  assert.deepEqual(
    { kind: model.surfaces[0].kind, y: model.surfaces[0].y, rigid: model.surfaces[0].rigid },
    { kind: 'floor', y: 0, rigid: true },
    'the single surface is the rigid floor'
  );
  assert.deepEqual(model.bounds, { min: { x: 0, y: 0, z: -51 }, max: { x: 636, y: 98, z: 51 } }, 'bounds are the truck box');
  assert.equal(model.loadFrontFirst, true, 'front-first is the engine default');
});

test('PACKING-CORE-P5 Wheel Wells truck normalizes zones, blocked bodies, rigid tops, and channel parity', async () => {
  const { Core, Solver, PackLib } = await p5Modules();
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const model = Core.buildSpaceModel(truck);
  const zones = PackLib.getTrailerUsableZones(truck);
  const blocked = PackLib.getWheelWellsBlockedZones(truck);
  const geometry = Solver.getWheelWellGeometry(truck);

  assert.deepEqual(model.zones, zones, 'zones are the production 5-zone split');
  assert.equal(model.blocked.length, 2, 'two blocked well bodies');
  model.blocked.forEach((body, i) => {
    assert.equal(body.kind, 'wheelWellBody', `blocked[${i}] kind`);
    assert.deepEqual({ min: body.min, max: body.max }, { min: blocked[i].min, max: blocked[i].max },
      `blocked[${i}] equals the production blocked zone`);
  });
  assert.deepEqual(model.wheelWell, geometry, 'wheel-well physical geometry is the solver geometry, unmodified');

  const floors = model.surfaces.filter(s => s.kind === 'floor');
  const raised = model.surfaces.filter(s => s.kind === 'raisedFloor');
  const rigidTops = model.surfaces.filter(s => s.kind === 'rigidTop');
  assert.equal(floors.length, 3, 'rear + channel + front floors');
  assert.equal(raised.length, 2, 'two raised shelf zones');
  assert.equal(rigidTops.length, 2, 'two rigid well tops');
  rigidTops.forEach((top, i) => {
    assert.deepEqual(
      { y: top.y, minX: top.minX, maxX: top.maxX, minZ: top.minZ, maxZ: top.maxZ },
      {
        y: geometry.tops[i].min.y,
        minX: geometry.tops[i].min.x,
        maxX: geometry.tops[i].max.x,
        minZ: geometry.tops[i].min.z,
        maxZ: geometry.tops[i].max.z,
      },
      `rigid top ${i} matches solver geometry top`
    );
  });
  // The constrained-zone definition must agree with the solver's channel notion:
  // exactly the zones strictly narrower than the widest zone (the center channel).
  const widest = Math.max(...zones.map(z => z.max.z - z.min.z));
  assert.deepEqual(
    model.constrainedZones,
    zones.filter(z => (z.max.z - z.min.z) < widest - 0.05),
    'constrained zones are the narrow channel zones'
  );
});

test('PACKING-CORE-P5 Front Overhang truck normalizes deck, cab void, and retention parity', async () => {
  const { Core, PackLib } = await p5Modules();
  const truck = {
    length: 240, width: 96, height: 96, shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusHeight: 43.2 },
  };
  const model = Core.buildSpaceModel(truck);
  const zones = PackLib.getTrailerUsableZones(truck);
  assert.deepEqual(model.zones, zones, 'zones are the production main + deck zones');
  assert.equal(model.blocked.length, 1, 'one cab void');
  assert.equal(model.blocked[0].kind, 'cabVoid', 'cab void kind');
  assert.deepEqual(
    { min: model.blocked[0].min, max: model.blocked[0].max },
    (() => { const [v] = PackLib.getFrontBonusBlockedZones(truck); return { min: v.min, max: v.max }; })(),
    'cab void equals the production blocked zone'
  );
  assert.deepEqual(model.retention, PackLib.getFrontOverhangRetentionGeometry(truck, zones),
    'retention geometry is the production step geometry');
  assert.equal(model.wheelWell, null, 'no wheel-well geometry');
  const kinds = model.surfaces.map(s => s.kind).sort();
  assert.deepEqual(kinds, ['floor', 'raisedFloor'], 'main floor + raised deck surfaces');
  assert.equal(model.bounds.max.x, 300, 'bounds extend over the deck (240 + 60)');
});

test('PACKING-CORE-P5 degenerate configs collapse exactly like production geometry', async () => {
  const { Core, Solver, PackLib } = await p5Modules();
  // Zero-height wells: blocked zones sanitize away and solver geometry is null.
  const flatWells = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells', shapeConfig: { wellHeight: 0 } };
  const flatModel = Core.buildSpaceModel(flatWells);
  assert.deepEqual(flatModel.zones, PackLib.getTrailerUsableZones(flatWells), 'zones still match production');
  assert.deepEqual(flatModel.blocked, [], 'no blocked bodies for zero-height wells');
  assert.equal(flatModel.wheelWell, Solver.getWheelWellGeometry(flatWells), 'wheel-well geometry matches (null)');
  assert.equal(flatModel.surfaces.filter(s => s.kind === 'rigidTop').length, 0, 'no rigid tops');
  // Zero-length overhang: frontBonus is geometrically a plain box.
  const flatBonus = { length: 240, width: 96, height: 96, shapeMode: 'frontBonus', shapeConfig: { bonusLength: 0 } };
  const bonusModel = Core.buildSpaceModel(flatBonus);
  assert.equal(bonusModel.zones.length, 1, 'overhang zone sanitized away');
  assert.equal(bonusModel.retention, null, 'no retention geometry without a deck');
  // Malformed truck: empty model, no throw.
  const emptyModel = Core.buildSpaceModel(null);
  assert.deepEqual(emptyModel.zones, [], 'no zones for malformed truck');
  assert.deepEqual(emptyModel.blocked, [], 'no blocked volumes for malformed truck');
});

test('PACKING-CORE-P5 solver output is identical when zones come from the SpaceModel', async () => {
  const { Core, Solver, PackLib } = await p5Modules();
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    const truck = shapeMode === 'frontBonus'
      ? { length: 240, width: 96, height: 96, shapeMode, shapeConfig: { bonusLength: 60, bonusHeight: 43.2 } }
      : { length: 636, width: 102, height: 98, shapeMode };
    const items = Array.from({ length: 40 }, (_, i) => ({
      instanceId: `i${i}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
      orientationLock: 'any', canFlip: false, weight: 30,
    }));
    const direct = Solver.solveAutoPack({
      truck, zones: PackLib.getTrailerUsableZones(truck), loadFrontFirst: true, items,
    });
    const viaModel = Solver.solveAutoPack({
      truck, zones: Core.buildSpaceModel(truck).zones, loadFrontFirst: true, items,
    });
    assert.equal(
      JSON.stringify([...direct.placements]),
      JSON.stringify([...viaModel.placements]),
      `${shapeMode}: placements identical via SpaceModel zones`
    );
    assert.deepEqual(direct.unpacked, viaModel.unpacked, `${shapeMode}: unpacked identical`);
  }
});

test('PACKING-CORE-P6 containment and overlap agree across solver, pack-library, and validation', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Validation = await import(`${packingCoreValidationPath.href}${stamp}`);
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const zones = PackLib.getTrailerUsableZones({ length: 636, width: 102, height: 98, shapeMode: 'wheelWells' });
  const mk = (min, max) => ({ min, max });
  const fixtures = [
    mk({ x: 0, y: 0, z: -51 }, { x: 24, y: 16, z: -33 }),           // rear floor, wall-flush
    mk({ x: -0.04, y: 0, z: -51 }, { x: 24, y: 16, z: -33 }),      // inside eps tolerance
    mk({ x: -0.06, y: 0, z: -51 }, { x: 24, y: 16, z: -33 }),      // outside eps tolerance
    mk({ x: 200, y: 0, z: -20 }, { x: 224, y: 16, z: -2 }),        // center channel
    mk({ x: 200, y: 0, z: -51 }, { x: 224, y: 16, z: -33 }),       // inside a blocked well body
    mk({ x: 630, y: 90, z: 0 }, { x: 660, y: 110, z: 20 }),        // out of bounds front/top
  ];
  for (const [i, aabb] of fixtures.entries()) {
    assert.equal(
      Solver.isAabbContainedInAnyZone(aabb, zones),
      PackLib.isAabbContainedInAnyZone(aabb, zones),
      `fixture ${i}: solver and pack-library containment agree`
    );
    assert.equal(
      Solver.isAabbContainedInAnyZone(aabb, zones),
      Validation.isAabbContainedInAnyZone(aabb, zones),
      `fixture ${i}: containment comes from the shared authority`
    );
  }
  const a = mk({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
  const touching = mk({ x: 10, y: 0, z: 0 }, { x: 20, y: 10, z: 10 });
  const overlapping = mk({ x: 9.9, y: 0, z: 0 }, { x: 20, y: 10, z: 10 });
  assert.equal(Validation.aabbsOverlap(a, touching), false, 'flush faces never overlap');
  assert.equal(Validation.aabbsOverlap(a, overlapping), true, 'interior penetration overlaps');
  assert.equal(Solver.aabbsOverlap(a, overlapping), Validation.aabbsOverlap(a, overlapping),
    'solver overlap is the shared authority');
  assert.equal(
    PackLib.computeSupportFraction(a, [mk({ x: 0, y: -10, z: 0 }, { x: 5, y: 0, z: 10 })]),
    Validation.computeSupportFraction(a, [mk({ x: 0, y: -10, z: 0 }, { x: 5, y: 0, z: 10 })]),
    'support fraction is the shared authority (half footprint = 0.5)'
  );
});

test('PACKING-CORE-P6 support-side stacking rules agree between AutoPack and manual reconciliation', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Validation = await import(`${packingCoreValidationPath.href}${stamp}`);
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);

  // Rule-level agreement on the shared predicates.
  assert.equal(Validation.rulesAllowStackOnTop({ noStackOnTop: true }), false, 'no-top-load blocks support');
  assert.equal(Validation.rulesAllowStackOnTop({ stackable: false }), false, 'stackable:false blocks support');
  assert.equal(Validation.rulesAllowStackOnTop({}), true, 'default allows support');
  assert.equal(Validation.rulesMaxStackCount({ maxStackCount: 0 }), 0, '0 = unlimited');
  assert.equal(Validation.rulesMaxStackCount({ maxStackCount: 2 }), 2, 'cap preserved');
  assert.equal(Validation.weightAllowsSupport(50, 30, false), false, 'heavier child rejected');
  assert.equal(Validation.weightAllowsSupport(50, 30, true), true, 'pallet bypasses the weight rule');

  // Behavioral agreement: a noStackOnTop base gets no children from the solver,
  // and manual reconciliation refuses the same stacked pose.
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = [
    { instanceId: 'base', caseId: 'B', dims: { l: 48, w: 48, h: 12 }, orientationLock: 'upright', canFlip: false, weight: 100, noStackOnTop: true },
    { instanceId: 'child', caseId: 'C', dims: { l: 240, w: 96, h: 12 }, orientationLock: 'upright', canFlip: false, weight: 10 },
  ];
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const basePos = res.placements.get('base');
  const childPos = res.placements.get('child');
  if (basePos && childPos) {
    assert.ok(Math.abs((childPos.y - 6) - (basePos.y + 6)) > 0.05,
      'solver never rests the child on the noStackOnTop base');
  }

  const caseLib = [
    { id: 'B', name: 'Base', dimensions: { length: 48, width: 48, height: 12 }, weight: 100, noStackOnTop: true },
    { id: 'C', name: 'Child', dimensions: { length: 24, width: 24, height: 12 }, weight: 10 },
  ];
  const pack = {
    truck,
    cases: [
      { id: 'i-base', caseId: 'B', placement: 'packed', transform: { position: { x: 216, y: 6, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } },
      { id: 'i-child', caseId: 'C', placement: 'packed', transform: { position: { x: 216, y: 18, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } },
    ],
  };
  const recon = PackLib.reconcilePlacementsForTruck(pack, truck, caseLib);
  assert.ok(recon.kept.includes('i-base'), 'base placement is valid');
  assert.equal(recon.kept.includes('i-child'), false,
    'manual reconciliation refuses a child resting on a noStackOnTop base (same rule as AutoPack)');
});

test('PACKING-CORE-P7 solver output carries structured rejection reasons for every unpacked item', async () => {
  const { Core, Solver, PackLib } = await p5Modules();
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = [
    // Fits fine.
    { instanceId: 'ok', caseId: 'A', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'any', canFlip: false, weight: 30 },
    // Too large for the truck in every orientation.
    { instanceId: 'oversized', caseId: 'B', dims: { l: 300, w: 120, h: 120 }, orientationLock: 'any', canFlip: true, weight: 30 },
    // Would fit on its side, but upright is locked (h 120 > truck height 96).
    { instanceId: 'locked-tall', caseId: 'C', dims: { l: 24, w: 18, h: 120 }, orientationLock: 'upright', canFlip: false, weight: 30 },
  ];
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.ok(Array.isArray(res.rejectionReasons), 'rejectionReasons is part of the solver output');
  const byId = new Map(res.rejectionReasons.map(r => [r.instanceId, r]));
  assert.equal(res.placements.has('ok'), true, 'the packable item packs');
  assert.equal(byId.has('ok'), false, 'packed items carry no rejection reason');
  assert.equal(byId.get('oversized')?.code, Core.REJECTION_CODES.NO_FIT_ANY_SURFACE, 'oversized → NO_FIT_ANY_SURFACE');
  assert.equal(byId.get('locked-tall')?.code, Core.REJECTION_CODES.ORIENTATION_LOCKED, 'lock excludes the only fitting pose → ORIENTATION_LOCKED');
  for (const id of res.unpacked) {
    assert.ok(byId.has(id), `unpacked ${id} carries a structured reason`);
    assert.ok(byId.get(id).detail.length > 0, `${id}: reason has human-readable detail`);
  }
});

test('PACKING-CORE-P7 Wheel Wells reports channel-width rejections with provable context', async () => {
  const { Core, Solver, PackLib } = await p5Modules();
  const truck = {
    length: 240, width: 96, height: 96, shapeMode: 'wheelWells',
    shapeConfig: { wellOffsetFromRear: 80, wellLength: 80, wellHeight: 34, wellWidth: 14.4 },
  };
  const zones = PackLib.getTrailerUsableZones(truck);
  // Two blockers exactly fill the full-width rear and front floor zones so only
  // the channel remains; the target is wider than the channel in every yaw.
  const items = [
    { instanceId: 'blocker-rear', caseId: 'B', dims: { l: 80, w: 96, h: 90 }, orientationLock: 'upright', canFlip: false, weight: 500 },
    { instanceId: 'blocker-front', caseId: 'B', dims: { l: 80, w: 96, h: 90 }, orientationLock: 'upright', canFlip: false, weight: 500 },
    { instanceId: 'too-wide', caseId: 'T', dims: { l: 70, w: 70, h: 90 }, orientationLock: 'upright', canFlip: false, weight: 100 },
  ];
  const res = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(res.unpacked.includes('too-wide'), true, 'the wide case cannot be placed');
  const reason = res.rejectionReasons.find(r => r.instanceId === 'too-wide');
  assert.ok(reason, 'the wide case carries a structured reason');
  assert.equal(reason.code, Core.REJECTION_CODES.TOO_WIDE_FOR_CHANNEL, 'channel width is the provable cause');
  assert.ok(reason.context && reason.context.channelWidth > 0, 'context includes the channel width');
  assert.ok(reason.context.tooWideForChannel === true, 'context proves the width claim');
});

test('PACKING-CORE-P7 rejection reasons never change placements (parity with pre-reason baseline)', async () => {
  const { Solver, PackLib } = await p5Modules();
  // Byte-parity is already pinned by the PHASE-E2B baseline test; here we assert
  // the reason plumbing is inert for a representative mixed load in all modes.
  for (const shapeMode of ['rect', 'wheelWells', 'frontBonus']) {
    const truck = shapeMode === 'frontBonus'
      ? { length: 240, width: 96, height: 96, shapeMode, shapeConfig: { bonusLength: 60, bonusHeight: 43.2 } }
      : { length: 240, width: 96, height: 96, shapeMode };
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = Array.from({ length: 60 }, (_, i) => ({
      instanceId: `i${i}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
      orientationLock: 'any', canFlip: false, weight: 30,
    }));
    const a = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const b = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    assert.equal(JSON.stringify([...a.placements]), JSON.stringify([...b.placements]), `${shapeMode}: deterministic with reasons`);
    assert.equal(a.rejectionReasons.length, a.unpacked.length, `${shapeMode}: one reason per unpacked item`);
  }
});

test('PACKING-CORE-P7 validation-staged items carry the mapped validation reason code', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Explain = await import(`../../src/packing-core/explain.js${stamp}`);
  assert.equal(Explain.rejectionCodeForValidationReason('penetrates the wheel-well body'), 'BLOCKED_BY_WHEEL_WELL');
  assert.equal(Explain.rejectionCodeForValidationReason('outside usable zones'), 'OUT_OF_BOUNDS');
  assert.equal(Explain.rejectionCodeForValidationReason('overlaps another packed item'), 'COLLISION');
  assert.equal(Explain.rejectionCodeForValidationReason('does not have safe stack support'), 'UNSUPPORTED');
  assert.equal(Explain.rejectionCodeForValidationReason('does not have complete rear retention at the overhang step'), 'NO_RETENTION');
});

test('PACKING-CORE-P8 leftover pass fills a legal channel hole and refuses too-wide cartons', async () => {
  const { Solver, PackLib } = await p5Modules();
  const truck = p8WheelWellTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const wheelWell = Solver.getWheelWellGeometry(truck);
  assert.ok(wheelWell, 'fixture produces wheel-well geometry');

  // Rear and front full-width floor zones fully occupied; only the channel is open.
  const blockerRear = p8Item(Solver, 'blocker-rear', { l: 80, w: 96, h: 90 }, { noStackOnTop: true });
  const blockerFront = p8Item(Solver, 'blocker-front', { l: 80, w: 96, h: 90 }, { noStackOnTop: true });
  const packed = [
    p8PackedEntry(Solver, blockerRear, { x: 40, y: 45, z: 0 }),
    p8PackedEntry(Solver, blockerFront, { x: 200, y: 45, z: 0 }),
  ];

  const fits = p8Item(Solver, 'fits-channel', { l: 24, w: 18, h: 16 });
  const tooWide = p8Item(Solver, 'too-wide', { l: 70, w: 70, h: 16 });
  const itemsById = new Map([[fits.id, fits], [tooWide.id, tooWide]]);
  const output = {
    placements: new Map(), rotations: new Map(), orientedDims: new Map(),
    retentionDependencies: new Map(), unpacked: ['too-wide', 'fits-channel'],
    warnings: [], rejectionReasons: [],
    phaseStats: { laneCount: 0, floorCount: 0, stackCount: 0, fillerCount: 0, unpackedCount: 2 },
  };

  const placed = Solver.placeWheelWellConstrainedLeftovers(
    output, packed, itemsById, zones, true, null, wheelWell, true
  );
  assert.equal(placed, 1, 'exactly the channel-fitting carton is rescued');
  assert.deepEqual(output.unpacked, ['too-wide'], 'the too-wide carton is never forced');
  const pos = output.placements.get('fits-channel');
  assert.ok(pos, 'rescued placement recorded');
  const od = output.orientedDims.get('fits-channel');
  const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  assert.equal(PackLib.isAabbContainedInAnyZone(aabb, zones), true, 'rescue is inside usable zones');
  assert.equal(Solver.aabbIntersectsWheelWellBody(aabb, wheelWell), false, 'rescue never enters a blocked body');
  assert.ok(Math.abs(aabb.min.y) <= 0.05, 'rescue rests on the floor (no floating)');
  const channel = zones.find(z => z.min.y <= 0.05 && (z.max.z - z.min.z) < 96 - 0.05);
  assert.ok(aabb.min.x >= channel.min.x - 0.05 && aabb.max.x <= channel.max.x + 0.05,
    'rescue landed in the center channel (the only remaining opening)');
});

test('PACKING-CORE-P8 leftover queue prioritizes channel-fitting then smaller cartons deterministically', async () => {
  const { Solver, PackLib } = await p5Modules();
  const truck = p8WheelWellTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const channelZones = zones.filter(z => z.min.y <= 0.05 && (z.max.z - z.min.z) < 96 - 0.05);
  const wide = p8Item(Solver, 'a-wide', { l: 70, w: 70, h: 16 });        // cannot use the channel
  const bigFits = p8Item(Solver, 'b-big', { l: 40, w: 30, h: 16 });     // fits channel, larger
  const smallFits = p8Item(Solver, 'c-small', { l: 20, w: 15, h: 16 }); // fits channel, smaller
  const ordered = Solver.sortConstrainedLeftoverQueue([wide, bigFits, smallFits], channelZones);
  assert.deepEqual(ordered.map(i => i.id), ['c-small', 'b-big', 'a-wide'],
    'channel-fitting first, smaller footprint first, non-fitting last');
});

test('PACKING-CORE-P8 pass is inert for Standard and Front Overhang and gated by option for Wheel Wells', async () => {
  const { Solver, PackLib } = await p5Modules();
  for (const shapeMode of ['rect', 'frontBonus']) {
    const truck = shapeMode === 'frontBonus'
      ? { length: 240, width: 96, height: 96, shapeMode, shapeConfig: { bonusLength: 60, bonusHeight: 43.2 } }
      : { length: 240, width: 96, height: 96, shapeMode };
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = Array.from({ length: 50 }, (_, i) => ({
      instanceId: `i${i}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
      orientationLock: 'any', canFlip: false, weight: 30,
    }));
    const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellLeftoverPass: false });
    assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...off.placements]),
      `${shapeMode}: pass on/off byte-identical (no wheel-well geometry)`);
  }
  // Wheel Wells: the pass can only add placements, never drop them, and stays rule-safe.
  const truck = p8WheelWellTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = Array.from({ length: 90 }, (_, i) => ({
    instanceId: `i${i}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'any', canFlip: false, weight: 30,
  }));
  const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellLeftoverPass: false });
  assert.ok(on.placements.size >= off.placements.size,
    `leftover pass never drops placements (${on.placements.size} >= ${off.placements.size})`);
  e1AssertSafe(Solver, PackLib, e1Placed(Solver, on), zones, 'p8/ww/90');
  const rerun = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...rerun.placements]), 'deterministic with the pass on');
});

test('PACKING-CORE-P9 default solution is byte-equivalent to the direct solver call', async () => {
  const { Core, Solver, PackLib } = await p5Modules();
  for (const shapeMode of ['rect', 'wheelWells']) {
    const truck = { length: 240, width: 96, height: 96, shapeMode };
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = Array.from({ length: 50 }, (_, i) => ({
      instanceId: `i${i}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
      orientationLock: 'any', canFlip: false, weight: 30,
    }));
    const input = { truck, zones, loadFrontFirst: true, items };
    const direct = Solver.solveAutoPack(input);
    const solution = Core.runPackingStrategies(input);
    assert.equal(solution.selected, 'default', 'default strategy is selected');
    assert.equal(solution.selectedSolution, solution.solutions[0], 'selectedSolution is the first solution');
    const sel = solution.selectedSolution;
    assert.equal(JSON.stringify([...sel.placements]), JSON.stringify([...direct.placements]),
      `${shapeMode}: placements identical to the direct call`);
    assert.deepEqual(sel.unpacked, direct.unpacked, `${shapeMode}: unpacked identical`);
    assert.equal(sel.rejectionReasons.length, direct.rejectionReasons.length, `${shapeMode}: reasons identical`);
    assert.deepEqual(sel.stats, direct.phaseStats, `${shapeMode}: stats mirror phaseStats`);
  }
});

test('PACKING-CORE-P9 multiple strategies produce independent deterministic solutions', async () => {
  const { Core, Solver, PackLib } = await p5Modules();
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = Array.from({ length: 60 }, (_, i) => ({
    instanceId: `i${i}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'any', canFlip: false, weight: 30,
  }));
  const input = { truck, zones, loadFrontFirst: true, items };
  const solution = Core.runPackingStrategies(input, ['default', 'compact-fill']);
  assert.equal(solution.solutions.length, 2, 'one StrategyResult per requested strategy');
  assert.deepEqual(solution.solutions.map(s => s.id), ['default', 'compact-fill'], 'ids preserved in order');
  const compactDirect = Solver.solveAutoPack({ ...input, layoutQuality: false });
  assert.equal(
    JSON.stringify([...solution.solutions[1].placements]),
    JSON.stringify([...compactDirect.placements]),
    'compact-fill is exactly the real layout-quality-off solver variant'
  );
  const again = Core.runPackingStrategies(input, ['default', 'compact-fill']);
  for (let i = 0; i < 2; i++) {
    assert.equal(
      JSON.stringify([...solution.solutions[i].placements]),
      JSON.stringify([...again.solutions[i].placements]),
      `strategy ${i} deterministic on repeat`
    );
  }
});

test('PACKING-CORE-P9 unknown strategy ids fail loudly and the registry stays honest', async () => {
  const { Core } = await p5Modules();
  assert.throws(() => Core.runPackingStrategies({ truck: {}, zones: [], items: [] }, ['wall-build']),
    /Unknown packing strategy/, 'unregistered strategies are a programming error, never a silent fallback');
  for (const preset of Core.PACKING_STRATEGIES) {
    assert.ok(preset.id && preset.strategy && preset.label, `${preset.id}: complete descriptor`);
    assert.ok(Object.isFrozen(preset), `${preset.id}: descriptor frozen`);
  }
  assert.equal(Core.getPackingStrategy('default').id, 'default', 'default strategy registered');
  assert.equal(Core.getPackingStrategy('nope'), null, 'unknown lookup returns null');
});

test('AUTOPACK-MAX-A absent and false flags are byte-identical in Standard, Wheel Wells, and Front Overhang', async () => {
  const { Solver, PackLib } = await p5Modules();
  const trucks = [
    { label: 'Standard', truck: { length: 240, width: 96, height: 96, shapeMode: 'rect' } },
    { label: 'Wheel Wells', truck: WW_SUPPORT_TRUCK },
    { label: 'Front Overhang', truck: phcFrontOverhangTruck() },
  ];
  for (const { label, truck } of trucks) {
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = Array.from({ length: 18 }, (_, index) => ({
      instanceId: `${label}-${index}`,
      caseId: 'parity-case',
      dims: { l: 24, w: 18, h: 16 },
      orientationLock: 'any',
      canFlip: false,
      weight: 30,
      maxStackCount: 2,
      laneItem: false,
      loadPriority: index % 3 - 1,
    }));
    const input = { truck, zones, loadFrontFirst: true, items };
    const absent = Solver.solveAutoPack(input);
    const explicitlyFalse = Solver.solveAutoPack({ ...input, maxCapacityMode: false });
    assert.equal(maxAResultBytes(explicitlyFalse), maxAResultBytes(absent),
      `${label}: maxCapacityMode:false is byte-identical to the unchanged normal solver path`);
  }
});

test('AUTOPACK-MAX-A relaxes maxStackCount as a direct-child cap', async () => {
  const { Solver, PackLib } = await p5Modules();
  const truck = { length: 48, width: 48, height: 12, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = [
    { instanceId: 'base', caseId: 'base', dims: { l: 48, w: 48, h: 6 }, orientationLock: 'upright', canFlip: false, weight: 100, maxStackCount: 1 },
    { instanceId: 'child-a', caseId: 'child', dims: { l: 24, w: 48, h: 6 }, orientationLock: 'upright', canFlip: false, weight: 20 },
    { instanceId: 'child-b', caseId: 'child', dims: { l: 24, w: 48, h: 6 }, orientationLock: 'upright', canFlip: false, weight: 20 },
  ];
  const normal = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const max = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, maxCapacityMode: true });
  assert.equal(normal.placements.size, 2, 'normal solver enforces one direct child');
  assert.equal(max.placements.size, 3, 'Max permits both direct children');
  const baseDims = max.orientedDims.get('base');
  const baseAabb = Solver.getAabb(max.placements.get('base'), { l: baseDims.length, w: baseDims.width, h: baseDims.height });
  const directChildren = ['child-a', 'child-b'].filter(id => {
    const dims = max.orientedDims.get(id);
    const aabb = Solver.getAabb(max.placements.get(id), { l: dims.length, w: dims.width, h: dims.height });
    return Math.abs(aabb.min.y - baseAabb.max.y) <= 0.05 && Solver.computeXzOverlapArea(aabb, baseAabb) > 0.05;
  });
  assert.deepEqual(directChildren, ['child-a', 'child-b'], 'both relaxed children are genuinely supported by the capped base');
});

test('AUTOPACK-MAX-A relaxes child-vs-support weight without weakening support geometry', async () => {
  const { Solver, PackLib } = await p5Modules();
  const truck = { length: 48, width: 48, height: 12, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = [
    { instanceId: 'light-base', caseId: 'base', dims: { l: 48, w: 48, h: 6 }, orientationLock: 'upright', canFlip: false, weight: 10 },
    { instanceId: 'heavy-child', caseId: 'child', dims: { l: 24, w: 24, h: 6 }, orientationLock: 'upright', canFlip: false, weight: 100 },
  ];
  const normal = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const max = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, maxCapacityMode: true });
  assert.equal(normal.placements.size, 1, 'normal solver rejects a child heavier than its non-pallet support');
  assert.equal(max.placements.size, 2, 'Max neutralizes the crushing/weight rule');
  const placed = maxAPlaced(Solver, max, items);
  const base = placed.find(item => item.id === 'light-base');
  const child = placed.find(item => item.id === 'heavy-child');
  assert.equal(Math.abs(child.aabb.min.y - base.aabb.max.y) <= 0.05, true, 'relaxed child still has exact vertical contact');
  assert.ok(PackLib.computeSupportFraction(child.aabb, [base.aabb], 0.05) >= PackLib.MIN_SUPPORT_FRACTION,
    'relaxed child still has the ordinary minimum footprint support');
});

test('AUTOPACK-MAX-A neutralizes lane and load-priority handling', async () => {
  const { Solver, PackLib } = await p5Modules();
  const laneTruck = { length: 120, width: 20, height: 20, shapeMode: 'rect' };
  const laneZones = PackLib.getTrailerUsableZones(laneTruck);
  const laneItems = [{
    instanceId: 'lane', caseId: 'lane', dims: { l: 120, w: 10, h: 10 },
    orientationLock: 'upright', canFlip: false, weight: 20, laneItem: true,
  }];
  const normalLane = Solver.solveAutoPack({ truck: laneTruck, zones: laneZones, loadFrontFirst: true, items: laneItems });
  const maxLane = Solver.solveAutoPack({ truck: laneTruck, zones: laneZones, loadFrontFirst: true, items: laneItems, maxCapacityMode: true });
  assert.equal(normalLane.phaseStats.laneCount, 1, 'normal solver honors the forced-lane classification');
  assert.equal(maxLane.phaseStats.laneCount, 0, 'Max neutralizes lane handling and uses the ordinary floor path');

  const priorityTruck = { length: 24, width: 24, height: 12, shapeMode: 'rect' };
  const priorityZones = PackLib.getTrailerUsableZones(priorityTruck);
  const priorityItems = [
    { instanceId: 'a-low', caseId: 'same', dims: { l: 24, w: 24, h: 12 }, orientationLock: 'upright', canFlip: false, weight: 20, loadPriority: -1 },
    { instanceId: 'z-high', caseId: 'same', dims: { l: 24, w: 24, h: 12 }, orientationLock: 'upright', canFlip: false, weight: 20, loadPriority: 1 },
  ];
  const normalPriority = Solver.solveAutoPack({ truck: priorityTruck, zones: priorityZones, loadFrontFirst: true, items: priorityItems });
  const maxPriority = Solver.solveAutoPack({ truck: priorityTruck, zones: priorityZones, loadFrontFirst: true, items: priorityItems, maxCapacityMode: true });
  assert.deepEqual([...normalPriority.placements.keys()], ['z-high'], 'normal solver loads the high-priority item first');
  assert.deepEqual([...maxPriority.placements.keys()], ['a-low'], 'Max neutralizes priority and falls back to deterministic id order');
});

test('AUTOPACK-MAX-A relaxes case orientation policy and per-instance orientation locks', async () => {
  const { Solver, PackLib } = await p5Modules();
  const truck = { length: 12, width: 24, height: 48, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const fixtures = [
    {
      label: 'case policy',
      item: { instanceId: 'case-policy', caseId: 'case', dims: { l: 48, w: 24, h: 12 }, orientationLock: 'upright', canFlip: false, weight: 20 },
    },
    {
      label: 'instance lock',
      item: {
        instanceId: 'instance-lock', caseId: 'case', dims: { l: 48, w: 24, h: 12 },
        orientationLock: 'any', canFlip: true, orientationLocked: true,
        lockedRotation: { x: 0, y: 0, z: 0 }, weight: 20,
      },
    },
  ];
  for (const { label, item } of fixtures) {
    const normal = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: [item] });
    const max = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: [item], maxCapacityMode: true });
    assert.equal(normal.placements.size, 0, `${label}: stored orientation cannot fit the narrow floor`);
    assert.equal(max.placements.size, 1, `${label}: Max may choose a physically valid tipped orientation`);
    assert.deepEqual(max.orientedDims.get(item.instanceId), { length: 12, width: 24, height: 48 },
      `${label}: the fitting pose uses the real rotated dimensions`);
    assert.equal(max.rotations.get(item.instanceId).z, Math.PI / 2, `${label}: the fitting pose is a canonical quarter turn`);
  }
});

test('AUTOPACK-MAX-A preserves physical geometry, support, blocked bodies, stability, and retention in all truck modes', async () => {
  const { Solver, PackLib } = await p5Modules();
  const Oriented = await import(`${orientedDimsPath.href}?t=${Date.now()}-${Math.random()}`);

  const standardTruck = { length: 48, width: 48, height: 24, shapeMode: 'rect' };
  const standardZones = PackLib.getTrailerUsableZones(standardTruck);
  const standardItems = ['standard-a', 'standard-b'].map(instanceId => ({
    instanceId, caseId: 'standard', dims: { l: 48, w: 48, h: 12 },
    orientationLock: 'upright', canFlip: false, noStackOnTop: true, stackable: false, weight: 20,
  }));
  const standardResult = Solver.solveAutoPack({
    truck: standardTruck, zones: standardZones, loadFrontFirst: true,
    items: standardItems, maxCapacityMode: true,
  });
  assert.equal(standardResult.placements.size, 2, 'Standard fixture exercises a relaxed but supported stack');
  maxAAssertPhysicalSafety({
    Solver, PackLib, Oriented, result: standardResult,
    truck: standardTruck, zones: standardZones, items: standardItems, label: 'Max/Standard',
  });

  const wheelTruck = WW_SUPPORT_TRUCK;
  const wheelZones = PackLib.getTrailerUsableZones(wheelTruck);
  const wheelItems = Array.from({ length: 70 }, (_, index) => ({
    instanceId: `wheel-${index}`, caseId: 'wheel', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'upright', canFlip: false, noStackOnTop: true, stackable: false,
    maxStackCount: 1, weight: 30,
  }));
  const wheelResult = Solver.solveAutoPack({
    truck: wheelTruck, zones: wheelZones, loadFrontFirst: true, items: wheelItems,
    maxCapacityMode: true, enableWheelWellBridge: true,
  });
  assert.equal(wheelResult.placements.size, wheelItems.length, 'Wheel Wells fixture packs every relaxed item');
  assert.ok(wheelResult.phaseStats.stackCount > 0, 'Wheel Wells fixture exercises non-floor support validation');
  maxAAssertPhysicalSafety({
    Solver, PackLib, Oriented, result: wheelResult,
    truck: wheelTruck, zones: wheelZones, items: wheelItems, label: 'Max/Wheel Wells',
  });
  const wheelWell = Solver.getWheelWellGeometry(wheelTruck);
  const bodyProbe = wwAabb(80, 0, -46, 100, 10, -38);
  assert.equal(Solver.aabbIntersectsWheelWellBody(bodyProbe, wheelWell), true,
    'Max does not alter the blocked-body predicate');
  const halfCantilever = wwAabb(80, 18, -48, 100, 28, -24);
  const halfSupport = Solver.computeWheelWellSupport(halfCantilever, [], wheelWell, { weight: 0 });
  assert.ok(halfSupport.fraction >= PackLib.MIN_SUPPORT_FRACTION, 'cantilever probe reaches minimum raw support fraction');
  assert.equal(Solver.isWheelWellSupportedAndStable(halfCantilever, [], wheelWell, { weight: 0 }), false,
    'Max still rejects a half-channel cantilever whose COM/overhang is unsafe');

  const frontTruck = phcFrontOverhangTruck();
  const frontZones = PackLib.getTrailerUsableZones(frontTruck);
  const retainingWall = {
    instanceId: 'fixed-wall',
    aabb: phc2Aabb(216, 240, 0, 48, -48, -30),
  };
  const frontItems = [{
    instanceId: 'deck', caseId: 'deck', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'upright', canFlip: false, noStackOnTop: true, stackable: false, weight: 30,
  }];
  const frontResult = Solver.solveAutoPack({
    truck: frontTruck, zones: frontZones, loadFrontFirst: true, items: frontItems,
    retentionPlacements: [retainingWall], maxCapacityMode: true,
  });
  assert.deepEqual(frontResult.retentionDependencies.get('deck'), ['fixed-wall'],
    'Max deck cargo records its real rear-retention dependency');
  maxAAssertPhysicalSafety({
    Solver, PackLib, Oriented, result: frontResult,
    truck: frontTruck, zones: frontZones, items: frontItems, label: 'Max/Front Overhang',
    fixedPlacements: [retainingWall],
  });
});
