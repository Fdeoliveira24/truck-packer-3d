import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  NEAR_DUPLICATE_DEFINITION,
  STRATEGY_IDS,
  buildPlacementSignatures,
  buildMarkdownReport,
  compareStrategySolutions,
  runStrategyAudit,
  stableStringify,
} from '../../scripts/autopack-strategy-audit.mjs';
import { PACKING_STRATEGIES, runAdaptiveAutoPack } from '../../src/packing-core/solution.js';
import { getTrailerUsableZones } from '../../src/services/pack-library.js';
import { createAutoPackStrategyAuditFixtures } from '../fixtures/autopack-strategy-audit-fixtures.mjs';

const report = runStrategyAudit({ repeats: 2 });

function fixture(id) {
  const value = report.fixtures.find(entry => entry.id === id);
  assert.ok(value, `fixture ${id} must exist`);
  return value;
}

function strategy(fixtureResult, id) {
  const value = fixtureResult.strategyResults.find(entry => entry.strategyId === id);
  assert.ok(value, `strategy ${id} must exist for ${fixtureResult.id}`);
  return value;
}

function result(packedRows, unpacked = []) {
  const placements = new Map();
  const rotations = new Map();
  const orientedDims = new Map();
  for (const row of packedRows) {
    placements.set(row.id, { ...row.position });
    rotations.set(row.id, { ...(row.rotation || { x: 0, y: 0, z: 0 }) });
    orientedDims.set(row.id, { ...row.dims });
  }
  return {
    placements,
    rotations,
    orientedDims,
    retentionDependencies: new Map(),
    unpacked,
  };
}

test('STRATEGY-AUDIT registry and adaptive order match the six production presets', () => {
  assert.deepEqual(STRATEGY_IDS, [
    'default',
    'compact-fill',
    'floor-first',
    'stack-priority',
    'max-capacity',
    'constrained-first',
  ]);
  assert.deepEqual(
    PACKING_STRATEGIES.map(entry => entry.strategy),
    [
      'front-first-balanced',
      'front-first-compact',
      'floor-only',
      'stack-priority',
      'max-capacity',
      'constrained-space-first',
    ]
  );
  assert.deepEqual(fixture('control-one-item').adaptivePortfolio.attemptedStrategyIds, [
    'default',
    'compact-fill',
    'floor-first',
    'stack-priority',
    'max-capacity',
  ]);
  assert.deepEqual(fixture('wheel-wells-channel-shelf').adaptivePortfolio.attemptedStrategyIds, [
    'default',
    'compact-fill',
    'floor-first',
    'stack-priority',
    'max-capacity',
    'constrained-first',
  ]);
});

test('STRATEGY-AUDIT canonical machine evidence contains no runtime fields', () => {
  const runtimeKeys = [];
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (key.toLowerCase().includes('runtime')) runtimeKeys.push(key);
      visit(nested);
    }
  };
  visit(report);
  assert.deepEqual(runtimeKeys, []);
});

test('STRATEGY-AUDIT fixtures are fresh, deterministic literals with no random source', async () => {
  const first = createAutoPackStrategyAuditFixtures();
  const second = createAutoPackStrategyAuditFixtures();
  assert.equal(first.length, 15);
  assert.equal(stableStringify(first), stableStringify(second));
  first[0].items[0].weight = 999;
  assert.notEqual(first[0].items[0].weight, second[0].items[0].weight, 'fixture calls must not share item objects');

  const source = await fs.readFile(
    new URL('../fixtures/autopack-strategy-audit-fixtures.mjs', import.meta.url),
    'utf8'
  );
  assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('Date.now'), false);
});

test('STRATEGY-AUDIT repeated signatures, geometry, canonical stats, and source immutability all pass', () => {
  assert.equal(report.aggregate.allDeterministic, true);
  assert.equal(report.aggregate.inputMutationDetected, false);
  assert.equal(report.aggregate.invalidPlacementCount, 0);
  assert.equal(report.aggregate.canonicalAgreementFailures, 0);
  assert.equal(report.aggregate.totalStrategyRuns, 90);
  for (const fixtureResult of report.fixtures) {
    assert.equal(fixtureResult.determinism.stable, true, fixtureResult.id);
    assert.equal(fixtureResult.inputMutationDetected, false, fixtureResult.id);
    for (const strategyResult of fixtureResult.strategyResults) {
      assert.equal(strategyResult.invalidPlacementCount, 0, `${fixtureResult.id}/${strategyResult.strategyId}`);
      assert.deepEqual(strategyResult.canonicalAgreement, {
        packedCount: true,
        stagedCount: true,
        phaseTotal: true,
      });
      assert.equal(
        strategyResult.packedCount + strategyResult.stagedCount,
        strategyResult.requestedCount,
        `${fixtureResult.id}/${strategyResult.strategyId}: accounting must close`
      );
    }
  }
});

test('STRATEGY-AUDIT intentional convergence and physical dedupe are recognized', () => {
  for (const fixtureId of ['control-one-item', 'floor-fit-convergence', 'zero-pack-oversize']) {
    const fixtureResult = fixture(fixtureId);
    assert.equal(
      new Set(fixtureResult.strategyResults.map(entry => entry.signatures.physicalLayoutSha256)).size,
      1,
      fixtureId
    );
    assert.equal(fixtureResult.adaptivePortfolio.uniquePhysicalLayoutCount, 1, fixtureId);
  }
  assert.equal(
    report.aggregate.pairSummary['default__compact-fill'].exactPhysicalLayoutFixtures,
    14,
    'Compact fill converges broadly but differs on the dedicated Wheel Wells yaw-control fixture'
  );
  const yawControl = fixture('layout-quality-yaw-control');
  assert.notEqual(
    strategy(yawControl, 'default').signatures.physicalLayoutSha256,
    strategy(yawControl, 'compact-fill').signatures.physicalLayoutSha256
  );
  assert.equal(strategy(yawControl, 'default').packedCount, strategy(yawControl, 'compact-fill').packedCount);
});

test('STRATEGY-AUDIT Floor first remains a truthful no-stacking strategy', () => {
  for (const fixtureResult of report.fixtures) {
    const floor = strategy(fixtureResult, 'floor-first');
    assert.equal(floor.phaseCounts.stacked, 0, fixtureResult.id);
    assert.equal(floor.maxSupportDepth <= 1, true, fixtureResult.id);
  }
  assert.equal(strategy(fixture('identical-over-demand'), 'floor-first').packedCount, 15);
  assert.equal(strategy(fixture('identical-over-demand'), 'default').packedCount, 60);
});

test('STRATEGY-AUDIT C3 Max search is independent, Case-constrained, and never auto-applied', () => {
  const relaxedWin = fixture('fragile-no-stack');
  assert.ok(strategy(relaxedWin, 'max-capacity').packedCount > strategy(relaxedWin, 'default').packedCount,
    'remaining stacking preferences can distinguish the independent Max result');
  assert.equal(relaxedWin.adaptivePortfolio.selectedStrategyId, 'default');
  const identical = fixture('identical-over-demand');
  assert.equal(strategy(identical, 'max-capacity').packedCount, 60,
    'canonical mass and signed orientation coverage characterize this C3 fixture');
  assert.equal(strategy(identical, 'default').packedCount, 60);
  const locked = fixture('orientation-locked-tight');
  assert.equal(strategy(locked, 'default').packedCount, 0);
  assert.equal(strategy(locked, 'max-capacity').packedCount, 0,
    'Max cannot clear an exact target to fit a different face');
  assert.equal(locked.adaptivePortfolio.selectedStrategyId, 'default');
});

test('STRATEGY-AUDIT constrained and special-geometry semantics are observable', () => {
  const wheel = fixture('wheel-wells-channel-shelf');
  const balanced = strategy(wheel, 'default');
  const constrained = strategy(wheel, 'constrained-first');
  assert.equal(constrained.packedCount, 52);
  assert.equal(balanced.packedCount, 40);
  assert.ok(constrained.wheelWellUsage.channelCount > balanced.wheelWellUsage.channelCount);
  assert.ok(constrained.wheelWellUsage.raisedShelfCount > balanced.wheelWellUsage.raisedShelfCount);
  assert.equal(wheel.adaptivePortfolio.selectedStrategyId, 'constrained-first');

  const front = fixture('front-overhang-retention');
  assert.ok(strategy(front, 'default').frontOverhangUseCount > 0);
  assert.equal(strategy(front, 'floor-first').frontOverhangUseCount, 0);
});

test('STRATEGY-AUDIT partial and zero-result fixtures keep honest accounting', () => {
  const zero = fixture('zero-pack-oversize');
  for (const strategyResult of zero.strategyResults) {
    assert.equal(strategyResult.packedCount, 0);
    assert.equal(strategyResult.stagedCount, 3);
    assert.equal(strategyResult.solveStatus.complete, false);
    assert.ok(strategyResult.solveStatus.partialCauses.includes('fit'));
  }
  const partial = strategy(fixture('identical-over-demand'), 'floor-first');
  assert.equal(partial.solveStatus.complete, false);
  assert.equal(partial.phaseCounts.unpacked, partial.stagedCount);
});

test('STRATEGY-AUDIT signatures ignore interchangeable ids but retain physical pose changes', () => {
  const sourceFixture = createAutoPackStrategyAuditFixtures().find(entry => entry.id === 'floor-fit-convergence');
  const dims = { length: 30, width: 20, height: 18 };
  const a = result(
    [
      { id: sourceFixture.items[0].instanceId, position: { x: 15, y: 9, z: -20 }, dims },
      { id: sourceFixture.items[1].instanceId, position: { x: 15, y: 9, z: 0 }, dims },
    ],
    sourceFixture.items.slice(2).map(item => item.instanceId)
  );
  const swapped = result(
    [
      { id: sourceFixture.items[0].instanceId, position: { x: 15, y: 9, z: 0 }, dims },
      { id: sourceFixture.items[1].instanceId, position: { x: 15, y: 9, z: -20 }, dims },
    ],
    sourceFixture.items.slice(2).map(item => item.instanceId)
  );
  const moved = result(
    [
      { id: sourceFixture.items[0].instanceId, position: { x: 16, y: 9, z: -20 }, dims },
      { id: sourceFixture.items[1].instanceId, position: { x: 15, y: 9, z: 0 }, dims },
    ],
    sourceFixture.items.slice(2).map(item => item.instanceId)
  );

  const sigA = buildPlacementSignatures(sourceFixture, a);
  const sigSwapped = buildPlacementSignatures(sourceFixture, swapped);
  const sigMoved = buildPlacementSignatures(sourceFixture, moved);
  assert.equal(sigA.physicalLayout, sigSwapped.physicalLayout);
  assert.notEqual(sigA.identityAware, sigSwapped.identityAware);
  assert.notEqual(sigA.physicalLayout, sigMoved.physicalLayout);
});

test('STRATEGY-AUDIT near-duplicate threshold is explicit and sound', () => {
  const sourceFixture = createAutoPackStrategyAuditFixtures().find(entry => entry.id === 'control-one-item');
  const id = sourceFixture.items[0].instanceId;
  const dims = { length: 20, width: 20, height: 20 };
  const baseline = result([{ id, position: { x: 10, y: 10, z: -20 }, dims }]);
  const near = result([{ id, position: { x: 10.5, y: 10, z: -20 }, dims }]);
  const far = result([{ id, position: { x: 12, y: 10, z: -20 }, dims }]);
  assert.equal(compareStrategySolutions(sourceFixture, baseline, near).nearDuplicate, true);
  assert.equal(compareStrategySolutions(sourceFixture, baseline, far).nearDuplicate, false);

  const thresholdFixture = createAutoPackStrategyAuditFixtures().find(entry => entry.id === 'identical-over-demand');
  const rows = thresholdFixture.items.slice(0, 11).map((item, index) => ({
    id: item.instanceId,
    position: { x: 2 + index * 10, y: 2, z: 0 },
    dims: { length: 4, width: 4, height: 4 },
  }));
  const moveFirst = count =>
    result(
      rows.map((row, index) => ({
        ...row,
        position: { ...row.position, z: index < count ? 0.5 : 0 },
      })),
      thresholdFixture.items.slice(11).map(item => item.instanceId)
    );
  const thresholdBaseline = result(rows, thresholdFixture.items.slice(11).map(item => item.instanceId));
  assert.equal(compareStrategySolutions(thresholdFixture, thresholdBaseline, moveFirst(2)).nearDuplicate, true);
  assert.equal(compareStrategySolutions(thresholdFixture, thresholdBaseline, moveFirst(3)).nearDuplicate, false);

  const markdown = buildMarkdownReport(report);
  assert.equal(report.nearDuplicateDefinition, NEAR_DUPLICATE_DEFINITION);
  assert.ok(markdown.includes(`Pairwise near-duplicate means ${NEAR_DUPLICATE_DEFINITION}.`));
});

test('STRATEGY-AUDIT adaptive portfolio never mutates caller-owned items', () => {
  const sourceFixture = createAutoPackStrategyAuditFixtures().find(entry => entry.id === 'fragile-no-stack');
  const input = {
    truck: sourceFixture.truck,
    zones: getTrailerUsableZones(sourceFixture.truck),
    items: sourceFixture.items,
    ...sourceFixture.inputOptions,
  };
  const before = stableStringify(input);
  const adaptive = runAdaptiveAutoPack(input);
  assert.equal(stableStringify(input), before);
  assert.equal(adaptive.selected, 'default');
  assert.ok(adaptive.solutions.some(entry => entry.id === 'max-capacity'));
});
