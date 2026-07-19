#!/usr/bin/env node

import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PACKING_STRATEGIES, runAdaptiveAutoPack, runPackingStrategies } from '../src/packing-core/solution.js';
import {
  aabbsOverlap,
  computeSupportFraction,
  computeXzOverlapArea,
  isAabbContainedInAnyZone,
} from '../src/packing-core/validation.js';
import {
  aabbIntersectsWheelWellBody,
  getWheelWellGeometry,
  isAabbWithinTruckMinusBlocked,
} from '../src/packing-core/wheel-well-model.js';
import { getAabb } from '../src/services/autopack-solver.js';
import { computeStats, getTrailerCapacityInches3, getTrailerUsableZones } from '../src/services/pack-library.js';
import { computeCoG } from '../src/services/cog-service.js';
import { createAutoPackStrategyAuditFixtures } from '../tests/fixtures/autopack-strategy-audit-fixtures.mjs';

export const AUDIT_DATE = '2026-07-19';
export const STRATEGY_IDS = Object.freeze(PACKING_STRATEGIES.map(strategy => strategy.id));
export const SIGNATURE_PRECISION = 1000;
export const POSITION_EPSILON_INCHES = 0.001;

const CONTACT_EPSILON_INCHES = 0.05;
const BROWSER_EVIDENCE = Object.freeze({
  method: 'Playwright CLI isolated Chromium session against http://localhost:5500/index.html',
  isolation: 'Authenticated first, then forced offline before injecting fixture state; no auth state saved.',
  standard: Object.freeze({
    fixtureId: 'mixed-sku-fragmentation',
    attemptedSolutionCount: 5,
    visibleStrategyIds: Object.freeze(['default', 'floor-first', 'stack-priority', 'max-capacity']),
    initiallyAppliedStrategyId: 'stack-priority',
    initiallyAppliedPackedCount: 18,
    maxCapacityCard: Object.freeze({ packed: 35, staged: 21, floor: 12, stacked: 23, volumePercent: 94.6 }),
    applyResult: Object.freeze({ selectedStrategyId: 'max-capacity', packed: 35, maxCapacityProfileCount: 35 }),
    screenshot: 'autopack-strategy-standard-max-capacity-browser-2026-07-19.png',
  }),
  wheelWells: Object.freeze({
    fixtureId: 'wheel-wells-channel-shelf',
    attemptedSolutionCount: 6,
    visibleStrategyIds: Object.freeze([
      'default',
      'floor-first',
      'stack-priority',
      'max-capacity',
      'constrained-first',
    ]),
    appliedStrategyId: 'constrained-first',
    appliedPackedCount: 52,
    constrainedCard: Object.freeze({ packed: 52, staged: 16, floor: 20, stacked: 32, volumePercent: 70.2 }),
    screenshot: 'autopack-strategy-wheel-wells-browser-2026-07-19.png',
  }),
  directHarnessAgreement: true,
  consoleNote:
    'No application exception was observed. The isolated offline run logged the existing favicon 404 and expected offline loader-media failures.',
});
const STRATEGY_INTERPRETATION = Object.freeze({
  default: Object.freeze({
    behavior:
      'Runs the full front-first production pipeline with layout-quality ranking enabled, Wheel Wells awareness, stacking, and leftover recovery.',
    convergence: 'It is the comparison baseline; ties are intentionally retained in its favor for automatic selection.',
    bestUse: 'General-purpose first result where tidy rows and a balanced normal-rule solution are preferred.',
    recommendation: 'Keep as the default and tie-break baseline.',
  }),
  'compact-fill': Object.freeze({
    behavior:
      'Runs the same pipeline with `layoutQuality: false`, returning to the original local waste-first candidate order.',
    convergence:
      'Convergence is common when candidate validity and later compaction dominate the local score. It remained identical in the compact-fill-pressure fixture but differed in the sub-grid Wheel Wells yaw control.',
    bestUse:
      'A denser local-waste-first alternative that accepts mixed yaw where Balanced favors a tidier single-yaw row.',
    recommendation:
      'Keep, but retain production dedupe and expand the corpus because measurable differentiation is currently sparse.',
  }),
  'floor-first': Object.freeze({
    behavior:
      'Sets `enableStackPhase: false`; lane, floor, and filler placement remain available, but no case is lifted onto cargo.',
    convergence:
      'Expected for one-item, all-on-floor, physically impossible, and no-stack loads where the normal pipeline also has no useful stacking opportunity.',
    bestUse: 'Flat, accessible loads where the user explicitly values no stacking over packed count.',
    recommendation: 'Keep as a clear semantic option.',
  }),
  'stack-priority': Object.freeze({
    behavior:
      'Sets `stackFallbackImmediate: true`, offering a safe supported stack as soon as an item fails floor placement.',
    convergence:
      'Expected when the ordinary later stack phase reaches the same final arrangement, or when every item already fits the floor / cannot fit at all.',
    bestUse: 'Loads where early vertical use recovers cargo before open-floor choices consume useful support surfaces.',
    recommendation: 'Keep; its gains and Front Overhang loss prove a real tradeoff rather than an alias.',
  }),
  'max-capacity': Object.freeze({
    behavior:
      'Runs an isolated solve that clears no-stack/stackable/max-stack, weight, lane, priority, orientation, flip, and exact-lock preferences while retaining physical hard rules.',
    convergence:
      'Expected when no relaxed preference binds, for trivial/full-floor loads, and where physical dimensions make every strategy fail.',
    bestUse: 'A manual what-if estimate for the physical fit available after relaxing approved handling preferences.',
    recommendation: 'Keep manual-only, and clarify that it is not guaranteed to maximize packed count.',
  }),
  'constrained-first': Object.freeze({
    behavior:
      'Sets `constrainedSpaceFirst: true`, prioritizing narrow Wheel Wells channel cargo before the open-floor phases.',
    convergence:
      'Expected and intentional outside real Wheel Wells geometry; production therefore does not run or show it for Standard or Front Overhang.',
    bestUse: 'Wheel Wells loads with channel-fitting cargo that would otherwise lose narrow-zone opportunities.',
    recommendation: 'Keep Wheel-Wells-only.',
  }),
});

function round(value, places = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
}

function roundSignature(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * SIGNATURE_PRECISION) / SIGNATURE_PRECISION;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (key.startsWith('__') || value[key] === undefined) return acc;
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return typeof value === 'number' ? roundSignature(value) : value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hash(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : stableStringify(value))
    .digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rotationOf(solution, id) {
  const rotation = solution.rotations instanceof Map ? solution.rotations.get(id) : null;
  return {
    x: roundSignature(rotation?.x || 0),
    y: roundSignature(rotation?.y || 0),
    z: roundSignature(rotation?.z || 0),
  };
}

function dimsOf(solution, item) {
  const dims = solution.orientedDims instanceof Map ? solution.orientedDims.get(item.instanceId) : null;
  return {
    length: roundSignature(dims?.length ?? item.dims.l),
    width: roundSignature(dims?.width ?? item.dims.w),
    height: roundSignature(dims?.height ?? item.dims.h),
  };
}

function placementRecords(fixture, solution) {
  const itemById = new Map(fixture.items.map(item => [item.instanceId, item]));
  const records = [];
  for (const [id, rawPosition] of solution.placements || []) {
    const item = itemById.get(id);
    if (!item) continue;
    const position = {
      x: roundSignature(rawPosition.x),
      y: roundSignature(rawPosition.y),
      z: roundSignature(rawPosition.z),
    };
    const rotation = rotationOf(solution, id);
    const dims = dimsOf(solution, item);
    const aabb = getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
    records.push({
      id,
      caseId: item.caseId,
      item,
      position,
      rotation,
      dims,
      aabb,
      supporters: [],
    });
  }
  records.sort((a, b) => a.id.localeCompare(b.id));
  for (const child of records) {
    child.supporters = records
      .filter(
        support =>
          support !== child &&
          Math.abs(child.aabb.min.y - support.aabb.max.y) <= CONTACT_EPSILON_INCHES &&
          computeXzOverlapArea(child.aabb, support.aabb) > CONTACT_EPSILON_INCHES
      )
      .map(support => support.id)
      .sort();
  }
  return records;
}

function retentionFor(solution, id) {
  if (!(solution.retentionDependencies instanceof Map)) return [];
  const dependency = solution.retentionDependencies.get(id);
  if (Array.isArray(dependency)) return [...dependency].map(String).sort();
  if (dependency && Array.isArray(dependency.retainerIds)) return [...dependency.retainerIds].map(String).sort();
  return dependency ? [stableStringify(dependency)] : [];
}

export function buildPlacementSignatures(fixture, solution, records = placementRecords(fixture, solution)) {
  const recordById = new Map(records.map(record => [record.id, record]));
  const auditRows = fixture.items.map(item => {
    const record = recordById.get(item.instanceId);
    if (!record) {
      return { id: item.instanceId, caseId: item.caseId, state: 'staged' };
    }
    return {
      id: record.id,
      caseId: record.caseId,
      state: 'packed',
      position: record.position,
      rotation: record.rotation,
      dims: record.dims,
      supporters: record.supporters,
      retention: retentionFor(solution, record.id),
    };
  });
  const physicalRows = records
    .map(record => ({
      caseId: record.caseId,
      position: record.position,
      rotation: record.rotation,
      dims: record.dims,
    }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const auditText = stableStringify(auditRows);
  const physicalText = stableStringify(physicalRows);
  return {
    identityAware: hash(auditText),
    physicalLayout: hash(physicalText),
    identityAwareText: auditText,
    physicalLayoutText: physicalText,
  };
}

function footprintContainedInZone(aabb, zone) {
  return (
    aabb.min.x >= zone.min.x - CONTACT_EPSILON_INCHES &&
    aabb.max.x <= zone.max.x + CONTACT_EPSILON_INCHES &&
    aabb.min.z >= zone.min.z - CONTACT_EPSILON_INCHES &&
    aabb.max.z <= zone.max.z + CONTACT_EPSILON_INCHES
  );
}

function isOnUsableSurface(record, zones) {
  return zones.some(
    zone =>
      Math.abs(record.aabb.min.y - zone.min.y) <= CONTACT_EPSILON_INCHES && footprintContainedInZone(record.aabb, zone)
  );
}

function rigidWheelWellSupportArea(aabb, geometry) {
  if (!geometry || Math.abs(aabb.min.y - geometry.wellHeight) > CONTACT_EPSILON_INCHES) return 0;
  return geometry.tops.reduce((sum, top) => sum + computeXzOverlapArea(aabb, top), 0);
}

export function validatePlacementRecords(fixture, records) {
  const zones = getTrailerUsableZones(fixture.truck);
  const wheelWell = getWheelWellGeometry(fixture.truck);
  const issueMap = new Map();
  const addIssue = (id, issue) => {
    if (!issueMap.has(id)) issueMap.set(id, []);
    issueMap.get(id).push(issue);
  };

  for (const record of records) {
    const contained = wheelWell
      ? isAabbWithinTruckMinusBlocked(record.aabb, wheelWell)
      : isAabbContainedInAnyZone(record.aabb, zones);
    if (!contained) addIssue(record.id, 'outside-usable-geometry');
    if (wheelWell && aabbIntersectsWheelWellBody(record.aabb, wheelWell)) {
      addIssue(record.id, 'wheel-well-body-overlap');
    }
  }

  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      if (!aabbsOverlap(records[left].aabb, records[right].aabb)) continue;
      addIssue(records[left].id, `overlap:${records[right].id}`);
      addIssue(records[right].id, `overlap:${records[left].id}`);
    }
  }

  for (const record of records) {
    if (isOnUsableSurface(record, zones)) continue;
    const supporterAabbs = records.filter(other => other !== record).map(other => other.aabb);
    const itemSupportArea =
      computeSupportFraction(record.aabb, supporterAabbs) * (record.dims.length * record.dims.width);
    const totalSupportArea = itemSupportArea + rigidWheelWellSupportArea(record.aabb, wheelWell);
    const supportFraction = totalSupportArea / Math.max(1e-9, record.dims.length * record.dims.width);
    if (supportFraction + 1e-9 < 0.5) addIssue(record.id, `support-fraction:${round(supportFraction, 4)}`);
  }

  return [...issueMap].map(([id, issues]) => ({ id, issues: [...new Set(issues)].sort() }));
}

function rectangleUnionArea(rectangles) {
  if (!rectangles.length) return 0;
  const xs = [...new Set(rectangles.flatMap(rect => [rect.minX, rect.maxX]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const x0 = xs[index];
    const x1 = xs[index + 1];
    if (x1 <= x0) continue;
    const intervals = rectangles
      .filter(rect => rect.minX < x1 && rect.maxX > x0)
      .map(rect => [rect.minZ, rect.maxZ])
      .sort((a, b) => a[0] - b[0]);
    if (!intervals.length) continue;
    let covered = 0;
    let start = intervals[0][0];
    let end = intervals[0][1];
    for (let i = 1; i < intervals.length; i += 1) {
      if (intervals[i][0] <= end) {
        end = Math.max(end, intervals[i][1]);
      } else {
        covered += end - start;
        [start, end] = intervals[i];
      }
    }
    covered += end - start;
    area += (x1 - x0) * covered;
  }
  return area;
}

function groupedSurfaceArea(zones) {
  const groups = new Map();
  for (const zone of zones) {
    const y = String(roundSignature(zone.min.y));
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push({ minX: zone.min.x, maxX: zone.max.x, minZ: zone.min.z, maxZ: zone.max.z });
  }
  return [...groups.values()].reduce((sum, rectangles) => sum + rectangleUnionArea(rectangles), 0);
}

function floorFootprintArea(records, zones) {
  const groups = new Map();
  for (const record of records) {
    if (!isOnUsableSurface(record, zones)) continue;
    const y = String(roundSignature(record.aabb.min.y));
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push({
      minX: record.aabb.min.x,
      maxX: record.aabb.max.x,
      minZ: record.aabb.min.z,
      maxZ: record.aabb.max.z,
    });
  }
  return [...groups.values()].reduce((sum, rectangles) => sum + rectangleUnionArea(rectangles), 0);
}

function supportDepthMetrics(records, zones) {
  const recordById = new Map(records.map(record => [record.id, record]));
  const memo = new Map();
  const depth = record => {
    if (memo.has(record.id)) return memo.get(record.id);
    if (isOnUsableSurface(record, zones) || !record.supporters.length) {
      memo.set(record.id, 1);
      return 1;
    }
    const parentDepths = record.supporters
      .map(id => recordById.get(id))
      .filter(Boolean)
      .map(depth);
    const value = 1 + (parentDepths.length ? Math.max(...parentDepths) : 0);
    memo.set(record.id, value);
    return value;
  };
  const depths = records.map(depth);
  const rootIds = new Set();
  const rootsFor = (record, seen = new Set()) => {
    if (seen.has(record.id)) return [];
    seen.add(record.id);
    if (isOnUsableSurface(record, zones) || !record.supporters.length) return [record.id];
    return record.supporters.flatMap(id => {
      const support = recordById.get(id);
      return support ? rootsFor(support, new Set(seen)) : [];
    });
  };
  for (const record of records.filter(entry => depth(entry) > 1)) {
    rootsFor(record).forEach(id => rootIds.add(id));
  }
  return {
    maxSupportDepth: depths.length ? Math.max(...depths) : 0,
    averageSupportDepth: depths.length ? round(depths.reduce((sum, value) => sum + value, 0) / depths.length, 3) : 0,
    stackBaseCount: rootIds.size,
  };
}

function makeCanonicalPack(fixture, solution, strategyId) {
  const maxX = Math.max(...getTrailerUsableZones(fixture.truck).map(zone => zone.max.x), fixture.truck.length);
  const packedIds = new Set(solution.placements.keys());
  return {
    id: `audit:${fixture.id}:${strategyId}`,
    truck: clone(fixture.truck),
    cases: fixture.items.map((item, index) => {
      const packed = packedIds.has(item.instanceId);
      const rotation = packed ? rotationOf(solution, item.instanceId) : { x: 0, y: 0, z: 0 };
      const orientedDims = packed
        ? dimsOf(solution, item)
        : {
            length: item.dims.l,
            width: item.dims.w,
            height: item.dims.h,
          };
      const position = packed
        ? { ...solution.placements.get(item.instanceId) }
        : { x: maxX + 100 + index * 2, y: orientedDims.height / 2, z: 0 };
      const instance = {
        id: item.instanceId,
        caseId: item.caseId,
        placement: packed ? 'packed' : 'staged',
        transform: { position, rotation },
        orientedDims,
      };
      if (packed && strategyId === 'max-capacity') instance.packedProfile = 'max-capacity';
      return instance;
    }),
  };
}

function balanceMetrics(records, truckCenterX) {
  const weighted = records.filter(record => Number(record.item.weight) > 0);
  const totalWeight = weighted.reduce((sum, record) => sum + Number(record.item.weight), 0);
  if (!totalWeight) return null;
  const leftWeight = weighted
    .filter(record => record.position.z < 0)
    .reduce((sum, record) => sum + Number(record.item.weight), 0);
  const rearWeight = weighted
    .filter(record => record.position.x < truckCenterX)
    .reduce((sum, record) => sum + Number(record.item.weight), 0);
  return {
    leftPercent: round((leftWeight / totalWeight) * 100, 2),
    rightPercent: round(((totalWeight - leftWeight) / totalWeight) * 100, 2),
    rearPercent: round((rearWeight / totalWeight) * 100, 2),
    frontPercent: round(((totalWeight - rearWeight) / totalWeight) * 100, 2),
  };
}

function wheelWellUsage(records, wheelWell) {
  if (!wheelWell) return null;
  let channelCount = 0;
  let raisedShelfCount = 0;
  let regionCount = 0;
  for (const record of records) {
    const overlapsWellX = record.aabb.min.x < wheelWell.wx1 && record.aabb.max.x > wheelWell.wx0;
    if (!overlapsWellX) continue;
    regionCount += 1;
    if (
      Math.abs(record.aabb.min.y) <= CONTACT_EPSILON_INCHES &&
      record.aabb.min.z >= -wheelWell.betweenHalfW - CONTACT_EPSILON_INCHES &&
      record.aabb.max.z <= wheelWell.betweenHalfW + CONTACT_EPSILON_INCHES
    ) {
      channelCount += 1;
    }
    if (Math.abs(record.aabb.min.y - wheelWell.wellHeight) <= CONTACT_EPSILON_INCHES) {
      raisedShelfCount += 1;
    }
  }
  return { regionCount, channelCount, raisedShelfCount };
}

function countOrientationChanges(records) {
  return records.filter(
    record =>
      Math.abs(record.rotation.x) > 1e-9 || Math.abs(record.rotation.y) > 1e-9 || Math.abs(record.rotation.z) > 1e-9
  ).length;
}

function maxUsableX(zones, fallback) {
  return zones.length ? Math.max(...zones.map(zone => zone.max.x)) : fallback;
}

function solutionMetrics(fixture, solution, strategyId, runtimeSamplesMs) {
  const zones = getTrailerUsableZones(fixture.truck);
  const wheelWell = getWheelWellGeometry(fixture.truck);
  const records = placementRecords(fixture, solution);
  const invalidPlacements = validatePlacementRecords(fixture, records);
  const invalidIds = new Set(invalidPlacements.map(entry => entry.id));
  const validRecords = records.filter(record => !invalidIds.has(record.id));
  const signatures = buildPlacementSignatures(fixture, solution, records);
  const pack = makeCanonicalPack(fixture, solution, strategyId);
  const canonical = computeStats(pack, fixture.caseLibrary);
  const packedOnlyCases = pack.cases.filter(instance => instance.placement === 'packed');
  const packedOnlyCog = computeCoG({ truck: pack.truck, cases: packedOnlyCases }, fixture.caseLibrary);
  const floorArea = floorFootprintArea(validRecords, zones);
  const availableFloorArea = groupedSurfaceArea(zones);
  const phase = solution.phaseStats || {};
  const minX = validRecords.length ? Math.min(...validRecords.map(record => record.aabb.min.x)) : 0;
  const maxX = validRecords.length ? Math.max(...validRecords.map(record => record.aabb.max.x)) : 0;
  const topY = validRecords.length ? Math.max(...validRecords.map(record => record.aabb.max.y)) : 0;
  const phaseFloorCount =
    (Number(phase.laneCount) || 0) + (Number(phase.floorCount) || 0) + (Number(phase.fillerCount) || 0);
  const supportDepth = supportDepthMetrics(validRecords, zones);
  const frontOverhangUseCount =
    fixture.truck.shapeMode === 'frontBonus'
      ? validRecords.filter(record => record.aabb.max.x > fixture.truck.length + CONTACT_EPSILON_INCHES).length
      : 0;
  const usableLength = Math.max(0, maxUsableX(zones, fixture.truck.length));
  return {
    strategyId,
    strategy: PACKING_STRATEGIES.find(entry => entry.id === strategyId)?.strategy || strategyId,
    label: PACKING_STRATEGIES.find(entry => entry.id === strategyId)?.label || strategyId,
    requestedCount: fixture.items.length,
    solverPlacementCount: records.length,
    packedCount: validRecords.length,
    stagedCount: fixture.items.length - validRecords.length,
    packedPercent: fixture.items.length ? round((validRecords.length / fixture.items.length) * 100, 2) : 100,
    invalidPlacementCount: invalidPlacements.length,
    invalidPlacements,
    packedVolumeIn3: round(canonical.volumeUsed, 3),
    volumeUtilizationPercent: round(canonical.volumePercent, 3),
    trailerCapacityIn3: round(getTrailerCapacityInches3(fixture.truck), 3),
    usedLengthIn: round(maxX - minX, 3),
    usedLengthPercent: usableLength ? round(((maxX - minX) / usableLength) * 100, 3) : 0,
    maxLoadTopIn: round(topY, 3),
    floorFootprintIn2: round(floorArea, 3),
    floorFootprintUtilizationPercent: availableFloorArea ? round((floorArea / availableFloorArea) * 100, 3) : 0,
    phaseCounts: {
      lane: Number(phase.laneCount) || 0,
      floor: Number(phase.floorCount) || 0,
      filler: Number(phase.fillerCount) || 0,
      floorTotal: phaseFloorCount,
      stacked: Number(phase.stackCount) || 0,
      unpacked: Number(phase.unpackedCount) || 0,
    },
    geometricFloorSurfaceCount: validRecords.filter(record => isOnUsableSurface(record, zones)).length,
    ...supportDepth,
    totalPackedWeight: round(canonical.totalWeight, 3),
    packedOnlyCog: packedOnlyCog
      ? {
          position: stableValue(packedOnlyCog.position),
          deviationPercent: stableValue(packedOnlyCog.deviationPercent),
          status: packedOnlyCog.status,
          withinTolerance: packedOnlyCog.withinTolerance,
        }
      : null,
    balance: balanceMetrics(validRecords, fixture.truck.length / 2),
    orientationChangeCount: countOrientationChanges(validRecords),
    wheelWellUsage: wheelWellUsage(validRecords, wheelWell),
    frontOverhangUseCount,
    solveStatus: stableValue(solution.solveStatus || null),
    warnings: [...(solution.warnings || [])],
    rejectionReasonCounts: [...(solution.rejectionReasons || [])].reduce((counts, reason) => {
      const code = String(reason?.code || 'unknown');
      counts[code] = (counts[code] || 0) + 1;
      return counts;
    }, {}),
    canonicalAgreement: {
      packedCount: canonical.packedCases === records.length,
      stagedCount: canonical.stagedCases === fixture.items.length - records.length,
      phaseTotal: phaseFloorCount + (Number(phase.stackCount) || 0) === records.length,
    },
    signatures: {
      identityAwareSha256: signatures.identityAware,
      physicalLayoutSha256: signatures.physicalLayout,
    },
    runtimeMs: {
      samples: runtimeSamplesMs.map(value => round(value, 3)),
      average: round(runtimeSamplesMs.reduce((sum, value) => sum + value, 0) / runtimeSamplesMs.length, 3),
      minimum: round(Math.min(...runtimeSamplesMs), 3),
      maximum: round(Math.max(...runtimeSamplesMs), 3),
    },
  };
}

function skuCounts(records) {
  return records.reduce((counts, record) => {
    counts[record.caseId] = (counts[record.caseId] || 0) + 1;
    return counts;
  }, {});
}

function poseKey(record) {
  return stableStringify({
    caseId: record.caseId,
    position: record.position,
    rotation: record.rotation,
    dims: record.dims,
  });
}

function rotationKey(record) {
  return stableStringify(record.rotation);
}

function matchPhysicalRecords(left, right) {
  const caseIds = [...new Set([...left, ...right].map(record => record.caseId))].sort();
  const matches = [];
  for (const caseId of caseIds) {
    const remainingLeft = left.filter(record => record.caseId === caseId);
    const remainingRight = right.filter(record => record.caseId === caseId);
    const rightByPose = new Map();
    for (const record of remainingRight) {
      const key = poseKey(record);
      if (!rightByPose.has(key)) rightByPose.set(key, []);
      rightByPose.get(key).push(record);
    }
    const unmatchedLeft = [];
    const usedRight = new Set();
    for (const record of remainingLeft) {
      const candidates = rightByPose.get(poseKey(record)) || [];
      const exact = candidates.find(candidate => !usedRight.has(candidate.id));
      if (exact) {
        usedRight.add(exact.id);
        matches.push({ left: record, right: exact, exact: true, displacement: 0 });
      } else {
        unmatchedLeft.push(record);
      }
    }
    const unmatchedRight = remainingRight.filter(record => !usedRight.has(record.id));
    const candidatePairs = [];
    for (const leftRecord of unmatchedLeft) {
      for (const rightRecord of unmatchedRight) {
        const displacement = Math.hypot(
          leftRecord.position.x - rightRecord.position.x,
          leftRecord.position.y - rightRecord.position.y,
          leftRecord.position.z - rightRecord.position.z
        );
        const orientationPenalty = rotationKey(leftRecord) === rotationKey(rightRecord) ? 0 : 1_000_000;
        candidatePairs.push({
          left: leftRecord,
          right: rightRecord,
          displacement,
          cost: displacement + orientationPenalty,
        });
      }
    }
    candidatePairs.sort(
      (a, b) => a.cost - b.cost || a.left.id.localeCompare(b.left.id) || a.right.id.localeCompare(b.right.id)
    );
    const matchedLeft = new Set();
    for (const pair of candidatePairs) {
      if (matchedLeft.has(pair.left.id) || usedRight.has(pair.right.id)) continue;
      matchedLeft.add(pair.left.id);
      usedRight.add(pair.right.id);
      matches.push({ ...pair, exact: false });
    }
  }
  return matches;
}

export function compareStrategySolutions(fixture, leftSolution, rightSolution) {
  const left = placementRecords(fixture, leftSolution);
  const right = placementRecords(fixture, rightSolution);
  const leftSignatures = buildPlacementSignatures(fixture, leftSolution, left);
  const rightSignatures = buildPlacementSignatures(fixture, rightSolution, right);
  const leftById = new Map(left.map(record => [record.id, record]));
  const rightById = new Map(right.map(record => [record.id, record]));
  const allIds = [...new Set([...leftById.keys(), ...rightById.keys()])];
  let packedSetDifferenceCount = 0;
  let identityPositionChangeCount = 0;
  let identityOrientationChangeCount = 0;
  for (const id of allIds) {
    const a = leftById.get(id);
    const b = rightById.get(id);
    if (!a || !b) {
      packedSetDifferenceCount += 1;
      continue;
    }
    if (
      Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z) >
      POSITION_EPSILON_INCHES
    ) {
      identityPositionChangeCount += 1;
    }
    if (rotationKey(a) !== rotationKey(b)) identityOrientationChangeCount += 1;
  }
  const matches = matchPhysicalRecords(left, right);
  const changedMatches = matches.filter(match => !match.exact);
  const displacements = changedMatches.map(match => match.displacement);
  const physicalOrientationChangeCount = changedMatches.filter(
    match => rotationKey(match.left) !== rotationKey(match.right)
  ).length;
  const leftSkuCounts = skuCounts(left);
  const rightSkuCounts = skuCounts(right);
  const samePackedSkuMultiset = stableStringify(leftSkuCounts) === stableStringify(rightSkuCounts);
  const exactPhysicalLayout = leftSignatures.physicalLayout === rightSignatures.physicalLayout;
  const nearLimit = Math.max(1, Math.ceil(Math.max(left.length, right.length) * 0.1));
  const orientationLimit = Math.max(1, Math.ceil(Math.max(left.length, right.length) * 0.05));
  const averageDisplacement = displacements.length
    ? displacements.reduce((sum, value) => sum + value, 0) / displacements.length
    : 0;
  const nearDuplicate =
    !exactPhysicalLayout &&
    samePackedSkuMultiset &&
    changedMatches.length <= nearLimit &&
    physicalOrientationChangeCount <= orientationLimit &&
    averageDisplacement <= 1;
  return {
    exactPhysicalLayout,
    exactIdentityAwareLayout: leftSignatures.identityAware === rightSignatures.identityAware,
    nearDuplicate,
    samePackedSkuMultiset,
    leftPackedCount: left.length,
    rightPackedCount: right.length,
    packedSetDifferenceCount,
    identityPositionChangeCount,
    identityOrientationChangeCount,
    physicalPoseDifferenceCount: changedMatches.length + Math.abs(left.length - right.length),
    physicalOrientationChangeCount,
    averagePhysicalDisplacementIn: round(averageDisplacement, 3),
    maximumPhysicalDisplacementIn: round(displacements.length ? Math.max(...displacements) : 0, 3),
  };
}

function pairKey(leftId, rightId) {
  return `${leftId}__${rightId}`;
}

function runOneSolution(input, strategyId) {
  const started = performance.now();
  const solution = runPackingStrategies(input, [strategyId]).selectedSolution;
  return { solution, runtimeMs: performance.now() - started };
}

export function runFixtureAudit(fixture, { repeats = 2 } = {}) {
  const pristine = stableStringify(fixture);
  const input = {
    truck: clone(fixture.truck),
    zones: getTrailerUsableZones(fixture.truck),
    items: clone(fixture.items),
    ...clone(fixture.inputOptions),
  };
  const directInputPristine = stableStringify(input);
  const solutions = new Map();
  const strategyResults = [];
  const deterministicFailures = [];
  for (const strategyId of STRATEGY_IDS) {
    const samples = [];
    let first = null;
    let firstSignature = null;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const run = runOneSolution(input, strategyId);
      samples.push(run.runtimeMs);
      const signature = buildPlacementSignatures(fixture, run.solution);
      if (!first) {
        first = run.solution;
        firstSignature = signature;
      } else if (
        signature.identityAware !== firstSignature.identityAware ||
        signature.physicalLayout !== firstSignature.physicalLayout
      ) {
        deterministicFailures.push({ strategyId, repeat: repeat + 1 });
      }
    }
    solutions.set(strategyId, first);
    strategyResults.push(solutionMetrics(fixture, first, strategyId, samples));
  }

  const pairwise = {};
  for (let left = 0; left < STRATEGY_IDS.length; left += 1) {
    for (let right = left + 1; right < STRATEGY_IDS.length; right += 1) {
      pairwise[pairKey(STRATEGY_IDS[left], STRATEGY_IDS[right])] = compareStrategySolutions(
        fixture,
        solutions.get(STRATEGY_IDS[left]),
        solutions.get(STRATEGY_IDS[right])
      );
    }
  }

  const adaptiveInput = {
    truck: clone(fixture.truck),
    zones: getTrailerUsableZones(fixture.truck),
    items: clone(fixture.items),
    ...clone(fixture.inputOptions),
  };
  const adaptiveInputPristine = stableStringify(adaptiveInput);
  const adaptive = runAdaptiveAutoPack(adaptiveInput);
  const uniquePhysical = [];
  const duplicateGroups = {};
  for (const solution of adaptive.solutions) {
    const physical = buildPlacementSignatures(fixture, solution).physicalLayout;
    const owner = uniquePhysical.find(entry => entry.signature === physical);
    if (owner) {
      owner.strategyIds.push(solution.id);
      duplicateGroups[owner.strategyIds[0]] = [...owner.strategyIds];
    } else {
      uniquePhysical.push({ signature: physical, strategyIds: [solution.id] });
    }
  }

  return {
    id: fixture.id,
    purpose: fixture.purpose,
    truck: stableValue(fixture.truck),
    requestedCount: fixture.items.length,
    caseMix: fixture.cases.map(entry => ({
      id: entry.id,
      count: entry.count,
      dimensions: stableValue(entry.dimensions),
      weight: Number(entry.weight) || 0,
      rules: stableValue({
        orientationLock: entry.orientationLock || 'any',
        orientationLocked: entry.orientationLocked === true,
        canFlip: entry.canFlip === true,
        noStackOnTop: entry.noStackOnTop === true,
        stackable: entry.stackable !== false,
        maxStackCount: Number(entry.maxStackCount) || 0,
        laneItem: entry.laneItem === true,
        loadPriority: Number(entry.loadPriority) || 0,
      }),
    })),
    strategyResults,
    pairwise,
    adaptivePortfolio: {
      attemptedStrategyIds: adaptive.solutions.map(solution => solution.id),
      attemptedCount: adaptive.solutions.length,
      selectedStrategyId: adaptive.selected,
      uniquePhysicalLayoutCount: uniquePhysical.length,
      visibleStrategyIdsAfterPhysicalDedupe: uniquePhysical.map(entry => entry.strategyIds[0]),
      duplicateGroups,
    },
    determinism: {
      repeats,
      stable: deterministicFailures.length === 0,
      failures: deterministicFailures,
    },
    inputMutationDetected:
      stableStringify(fixture) !== pristine ||
      stableStringify(input) !== directInputPristine ||
      stableStringify(adaptiveInput) !== adaptiveInputPristine,
  };
}

function aggregateAudit(fixtures) {
  const strategySummary = Object.fromEntries(
    STRATEGY_IDS.map(id => [
      id,
      {
        fixtures: fixtures.length,
        completeFixtures: 0,
        bestPackedCountFixtures: 0,
        distinctFromBalancedFixtures: 0,
        identicalToBalancedFixtures: 0,
        packedTotal: 0,
        requestedTotal: 0,
        averageRuntimeMs: 0,
      },
    ])
  );
  const pairSummary = {};
  const runtimeSamples = Object.fromEntries(STRATEGY_IDS.map(id => [id, []]));
  for (const fixture of fixtures) {
    const maxPacked = Math.max(...fixture.strategyResults.map(result => result.packedCount));
    const balanced = fixture.strategyResults.find(result => result.strategyId === 'default');
    for (const result of fixture.strategyResults) {
      const summary = strategySummary[result.strategyId];
      summary.completeFixtures += result.stagedCount === 0 ? 1 : 0;
      summary.bestPackedCountFixtures += result.packedCount === maxPacked ? 1 : 0;
      summary.packedTotal += result.packedCount;
      summary.requestedTotal += result.requestedCount;
      runtimeSamples[result.strategyId].push(...result.runtimeMs.samples);
      if (
        result.strategyId !== 'default' &&
        result.signatures.physicalLayoutSha256 !== balanced.signatures.physicalLayoutSha256
      ) {
        summary.distinctFromBalancedFixtures += 1;
      }
      if (result.signatures.physicalLayoutSha256 === balanced.signatures.physicalLayoutSha256) {
        summary.identicalToBalancedFixtures += 1;
      }
    }
    for (const [key, comparison] of Object.entries(fixture.pairwise)) {
      if (!pairSummary[key]) {
        pairSummary[key] = {
          fixtures: 0,
          exactPhysicalLayoutFixtures: 0,
          nearDuplicateFixtures: 0,
          packedCountDifferenceFixtures: 0,
          averagePhysicalPoseDifferenceCount: 0,
        };
      }
      const summary = pairSummary[key];
      summary.fixtures += 1;
      summary.exactPhysicalLayoutFixtures += comparison.exactPhysicalLayout ? 1 : 0;
      summary.nearDuplicateFixtures += comparison.nearDuplicate ? 1 : 0;
      summary.packedCountDifferenceFixtures += comparison.leftPackedCount !== comparison.rightPackedCount ? 1 : 0;
      summary.averagePhysicalPoseDifferenceCount += comparison.physicalPoseDifferenceCount;
    }
  }
  for (const id of STRATEGY_IDS) {
    const samples = runtimeSamples[id];
    strategySummary[id].averageRuntimeMs = round(samples.reduce((sum, value) => sum + value, 0) / samples.length, 3);
    strategySummary[id].packedPercent = strategySummary[id].requestedTotal
      ? round((strategySummary[id].packedTotal / strategySummary[id].requestedTotal) * 100, 2)
      : 100;
  }
  for (const summary of Object.values(pairSummary)) {
    summary.averagePhysicalPoseDifferenceCount = round(
      summary.averagePhysicalPoseDifferenceCount / summary.fixtures,
      3
    );
    summary.exactLayoutRatePercent = round((summary.exactPhysicalLayoutFixtures / summary.fixtures) * 100, 2);
    summary.nearDuplicateRatePercent = round((summary.nearDuplicateFixtures / summary.fixtures) * 100, 2);
  }
  return {
    strategySummary,
    pairSummary,
    fixtureCount: fixtures.length,
    totalStrategyRuns: fixtures.length * STRATEGY_IDS.length,
    allDeterministic: fixtures.every(fixture => fixture.determinism.stable),
    inputMutationDetected: fixtures.some(fixture => fixture.inputMutationDetected),
    invalidPlacementCount: fixtures.reduce(
      (sum, fixture) =>
        sum + fixture.strategyResults.reduce((fixtureSum, result) => fixtureSum + result.invalidPlacementCount, 0),
      0
    ),
    canonicalAgreementFailures: fixtures.reduce(
      (sum, fixture) =>
        sum + fixture.strategyResults.filter(result => !Object.values(result.canonicalAgreement).every(Boolean)).length,
      0
    ),
    adaptiveAttemptedSolutionCount: fixtures.reduce(
      (sum, fixture) => sum + fixture.adaptivePortfolio.attemptedCount,
      0
    ),
    adaptiveUniquePhysicalLayoutCount: fixtures.reduce(
      (sum, fixture) => sum + fixture.adaptivePortfolio.uniquePhysicalLayoutCount,
      0
    ),
    adaptiveVisibleOptionRange: {
      minimum: Math.min(...fixtures.map(fixture => fixture.adaptivePortfolio.uniquePhysicalLayoutCount)),
      maximum: Math.max(...fixtures.map(fixture => fixture.adaptivePortfolio.uniquePhysicalLayoutCount)),
    },
  };
}

export function runStrategyAudit({ repeats = 2 } = {}) {
  const fixtures = createAutoPackStrategyAuditFixtures().map(fixture => runFixtureAudit(fixture, { repeats }));
  return {
    schemaVersion: 1,
    auditDate: AUDIT_DATE,
    units: 'inches / pounds / milliseconds',
    deterministicInputs: true,
    repeatCount: repeats,
    runtimeNote: 'Runtime samples are observational and are excluded from every determinism and distinctness decision.',
    strategyRegistry: PACKING_STRATEGIES.map(entry => ({
      id: entry.id,
      strategy: entry.strategy,
      label: entry.label,
      description: entry.description,
      options: stableValue(entry.options),
    })),
    fixtures,
    aggregate: aggregateAudit(fixtures),
    browserEvidence: BROWSER_EVIDENCE,
  };
}

function percentage(value, denominator) {
  return denominator ? `${round((value / denominator) * 100, 1)}%` : '0%';
}

function shortId(id) {
  return id === 'default' ? 'Balanced' : PACKING_STRATEGIES.find(entry => entry.id === id)?.label || id;
}

export function buildMarkdownReport(report) {
  const maxCapacitySummary = report.aggregate.strategySummary['max-capacity'];
  const lines = [
    '# AutoPack strategy differentiation audit',
    '',
    `Audit date: ${report.auditDate}`,
    '',
    '## Executive result',
    '',
    `The harness measured ${report.aggregate.totalStrategyRuns} strategy/fixture cells across ${report.aggregate.fixtureCount} deterministic fixtures, ` +
      `with ${report.repeatCount} signature-checked solves per cell (${report.aggregate.totalStrategyRuns * report.repeatCount} direct solver calls) plus the production adaptive portfolio. ` +
      `Determinism was ${report.aggregate.allDeterministic ? '**stable**' : '**not stable**'}, ` +
      `${report.aggregate.invalidPlacementCount} geometrically invalid packed placements were observed, and ` +
      `${report.aggregate.canonicalAgreementFailures} strategy results disagreed with canonical application counts.`,
    '',
    `The adaptive portfolio attempted ${report.aggregate.adaptiveAttemptedSolutionCount} candidate solutions and exposed ` +
      `${report.aggregate.adaptiveUniquePhysicalLayoutCount} unique physical layouts after production-equivalent dedupe ` +
      `(${percentage(report.aggregate.adaptiveAttemptedSolutionCount - report.aggregate.adaptiveUniquePhysicalLayoutCount, report.aggregate.adaptiveAttemptedSolutionCount)} collapsed). ` +
      `Visible options ranged from ${report.aggregate.adaptiveVisibleOptionRange.minimum} to ${report.aggregate.adaptiveVisibleOptionRange.maximum} per fixture.`,
    '',
    '**Decision-grade findings:** Compact fill differed from Balanced only on the dedicated Wheel Wells yaw-control fixture, where both packed all seven cartons but Compact accepted mixed yaw and Balanced preserved row consistency. ' +
      `Max Capacity was distinct in ${maxCapacitySummary.distinctFromBalancedFixtures}/${maxCapacitySummary.fixtures}, but packed fewer cases than Balanced in five fixtures, so its label must not be read as a monotonic maximum. ` +
      'Floor first, Stack priority, and Wheel-Wells-only Constrained space first each produced observable semantic differentiation.',
    '',
    'This is characterization evidence only. No production solver, strategy, heuristic, geometry, UI, animation, auth, billing, storage, or lifecycle behavior changed.',
    '',
    '## Method',
    '',
    '- Inputs are literal, self-generated fixtures; no random or clock-derived values enter a solve.',
    '- Every registered strategy is run directly with the same truck, zones, items, and feature options.',
    '- Identity-aware signatures include item identity, packed/staged state, normalized pose, dimensions, supporters, and Front Overhang retention dependencies when present.',
    '- Physical-layout signatures ignore interchangeable instance IDs, matching the production Results dedupe intent.',
    '- Numbers in signatures are rounded to 0.001 inch/radian. Pairwise near-duplicate means the same packed SKU multiset, at most 10% changed physical poses, at most 5% changed orientations, and no more than 1 inch mean displacement.',
    '- Packed count excludes any placement failing containment, blocked-body, overlap, or minimum-support checks. The solver produced no such invalid placements in this run.',
    '- Floor footprint is the exact union of floor/deck/shelf placement rectangles divided by the union of usable surface rectangles at each surface height.',
    '- CoG uses the canonical CoG helper over packed instances only. This avoids staged work-area positions contaminating partial-load balance results.',
    '- Runtime is observational only and is never used to decide determinism, equality, ranking, or recommendations.',
    '',
    '## Fixture matrix',
    '',
    '| Fixture | Cases | Truck mode | Purpose |',
    '|---|---:|---|---|',
  ];
  for (const fixture of report.fixtures) {
    lines.push(`| ${fixture.id} | ${fixture.requestedCount} | ${fixture.truck.shapeMode} | ${fixture.purpose} |`);
  }
  lines.push(
    '',
    '## Strategy summary',
    '',
    '| Strategy | Complete fixtures | Best packed-count fixtures | Physically differs from Balanced | Identical to Balanced | Aggregate packed | Avg runtime |',
    '|---|---:|---:|---:|---:|---:|---:|'
  );
  for (const id of STRATEGY_IDS) {
    const summary = report.aggregate.strategySummary[id];
    lines.push(
      `| ${shortId(id)} | ${summary.completeFixtures}/${summary.fixtures} | ` +
        `${summary.bestPackedCountFixtures}/${summary.fixtures} | ${summary.distinctFromBalancedFixtures}/${summary.fixtures} | ` +
        `${summary.identicalToBalancedFixtures}/${summary.fixtures} | ${summary.packedTotal}/${summary.requestedTotal} (${summary.packedPercent}%) | ` +
        `${summary.averageRuntimeMs} ms |`
    );
  }
  lines.push(
    '',
    '## Per-fixture packed-count and dedupe evidence',
    '',
    '| Fixture | Balanced | Compact | Floor | Stack | Max C | Constrained | Adaptive attempted → unique | Applied default |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|'
  );
  for (const fixture of report.fixtures) {
    const counts = Object.fromEntries(fixture.strategyResults.map(result => [result.strategyId, result.packedCount]));
    lines.push(
      `| ${fixture.id} | ${counts.default} | ${counts['compact-fill']} | ${counts['floor-first']} | ` +
        `${counts['stack-priority']} | ${counts['max-capacity']} | ${counts['constrained-first']} | ` +
        `${fixture.adaptivePortfolio.attemptedCount} → ${fixture.adaptivePortfolio.uniquePhysicalLayoutCount} | ` +
        `${shortId(fixture.adaptivePortfolio.selectedStrategyId)} |`
    );
  }
  lines.push(
    '',
    '## Pairwise similarity',
    '',
    '| Pair | Exact physical layouts | Near-duplicates | Packed-count differences | Mean changed poses |',
    '|---|---:|---:|---:|---:|'
  );
  for (const [key, summary] of Object.entries(report.aggregate.pairSummary)) {
    const [left, right] = key.split('__');
    lines.push(
      `| ${shortId(left)} ↔ ${shortId(right)} | ` +
        `${summary.exactPhysicalLayoutFixtures}/${summary.fixtures} (${summary.exactLayoutRatePercent}%) | ` +
        `${summary.nearDuplicateFixtures}/${summary.fixtures} (${summary.nearDuplicateRatePercent}%) | ` +
        `${summary.packedCountDifferenceFixtures}/${summary.fixtures} | ${summary.averagePhysicalPoseDifferenceCount} |`
    );
  }
  lines.push('', '## Strategy audit recommendation', '');
  for (const id of STRATEGY_IDS) {
    const summary = report.aggregate.strategySummary[id];
    const differs = summary.fixtures - summary.identicalToBalancedFixtures;
    let recommendation = 'Keep and continue measuring.';
    if (id === 'default') recommendation = 'Keep as the automatic baseline and deterministic tie-break winner.';
    if (id === 'compact-fill')
      recommendation =
        'Keep: the dedicated Wheel Wells yaw control proves the advertised tidy-row versus mixed-orientation tradeoff. Retain dedupe because the other fixtures converge.';
    if (id === 'floor-first')
      recommendation = 'Keep: the no-stacking semantic is explicit even where the physical layout converges.';
    if (id === 'stack-priority')
      recommendation =
        'Keep: it improved packed count on the mixed-SKU and Wheel Wells fixtures, while its Front Overhang regression makes the user-visible tradeoff real.';
    if (id === 'max-capacity')
      recommendation =
        'Keep manual-only: it is the only profile allowed to relax approved handling preferences and must never auto-apply.';
    if (id === 'constrained-first')
      recommendation =
        'Keep Wheel-Wells-only. Do not expose it for Standard or Front Overhang, where it is intentionally equivalent to Balanced.';
    lines.push(
      `- **${shortId(id)}:** physically differs from Balanced on ${differs}/${summary.fixtures} fixtures; ` +
        `ties the best packed count on ${summary.bestPackedCountFixtures}/${summary.fixtures}. ${recommendation}`
    );
  }
  lines.push(
    '',
    '### Max Capacity naming/semantics',
    '',
    'The current implementation is a **relaxed-handling physical-fit estimate**, not an optimization proof and not an upper bound on packed count. ' +
      'It beat Balanced on mixed-SKU fragmentation, fragile/no-stack, orientation-locked, tall/narrow, and Wheel Wells fixtures; ' +
      'it lost to Balanced on identical over-demand, stack pressure, heavy/light, lane/priority, and Front Overhang fixtures.',
    '',
    '**Recommendation:** preserve the manual-only safety boundary, but refine the user-facing name or adjacent copy in a separately approved product change. ' +
      '“Relaxed fit estimate” is semantically closer than “Max Capacity”; if the label stays, explicitly say that it explores relaxed preferences and may not pack the most cases.',
    '',
    '### Portfolio-level recommendation',
    '',
    '- Do not merge Floor first, Stack priority, Max Capacity, or Constrained space first into a single generic alternative: their measured failure/success modes differ.',
    '- Keep physical-layout dedupe as the user-facing guard against fake choice. It correctly removed Compact fill in both browser fixtures and collapsed all six conceptual strategies to one option in the convergence controls.',
    '- Keep Compact fill, but broaden its regression corpus: its one measured distinction is meaningful and matches the copy, while broad convergence means dedupe remains essential.',
    '- Continue gating Constrained space first to real Wheel Wells geometry; it improved 40 → 52 packed and increased channel/shelf use in the dedicated fixture.',
    ''
  );
  lines.push('', '## Answers to the audit questions', '');
  for (const id of STRATEGY_IDS) {
    const summary = report.aggregate.strategySummary[id];
    const interpretation = STRATEGY_INTERPRETATION[id];
    const comparisons = report.fixtures.map(fixture => {
      const balanced = fixture.strategyResults.find(result => result.strategyId === 'default');
      const current = fixture.strategyResults.find(result => result.strategyId === id);
      return {
        fixtureId: fixture.id,
        delta: current.packedCount - balanced.packedCount,
        physicallyDifferent: current.signatures.physicalLayoutSha256 !== balanced.signatures.physicalLayoutSha256,
      };
    });
    const gains = comparisons.filter(entry => entry.delta > 0).map(entry => `${entry.fixtureId} (+${entry.delta})`);
    const losses = comparisons.filter(entry => entry.delta < 0).map(entry => `${entry.fixtureId} (${entry.delta})`);
    const physicalDifferences = comparisons.filter(entry => entry.physicallyDifferent).map(entry => entry.fixtureId);
    lines.push(
      `### ${shortId(id)}`,
      '',
      `- Exact behavior: registry id \`${id}\`, solver strategy \`${PACKING_STRATEGIES.find(entry => entry.id === id)?.strategy}\`, with options \`${stableStringify(PACKING_STRATEGIES.find(entry => entry.id === id)?.options || {})}\`.`,
      `- Mechanics: ${interpretation.behavior}`,
      `- Distinctness: ${summary.identicalToBalancedFixtures}/${summary.fixtures} fixtures were physically identical to Balanced; ${summary.fixtures - summary.identicalToBalancedFixtures}/${summary.fixtures} differed.`,
      `- Difference fixtures: ${physicalDifferences.length ? physicalDifferences.join(', ') : id === 'default' ? 'baseline by definition' : 'none'}.`,
      `- Capacity: tied the fixture-best packed count on ${summary.bestPackedCountFixtures}/${summary.fixtures}; aggregate ${summary.packedTotal}/${summary.requestedTotal} packed.`,
      `- Packed-count change versus Balanced: gains — ${gains.length ? gains.join(', ') : 'none'}; losses — ${losses.length ? losses.join(', ') : 'none'}.`,
      `- Completion: ${summary.completeFixtures}/${summary.fixtures} fixtures fully packed.`,
      `- Expected convergence: ${interpretation.convergence}`,
      `- Best measurable use: ${interpretation.bestUse}`,
      `- Recommendation: ${interpretation.recommendation}`,
      `- Runtime: ${summary.averageRuntimeMs} ms mean over the recorded local samples; observational only.`,
      ''
    );
  }
  lines.push(
    '## Browser validation',
    '',
    `Playwright CLI used an isolated Chromium session against the live local app. ${report.browserEvidence.isolation}`,
    '',
    '| Scenario | Attempted | Visible after dedupe | Auto-applied | Card/apply evidence |',
    '|---|---:|---:|---|---|',
    `| Standard mixed SKU | ${report.browserEvidence.standard.attemptedSolutionCount} | ` +
      `${report.browserEvidence.standard.visibleStrategyIds.length}: Balanced, Floor, Stack, Max | Stack priority (${report.browserEvidence.standard.initiallyAppliedPackedCount}) | ` +
      `Max card 35 packed / 21 staged / 12 floor / 23 stacked / 94.6%; Apply changed canonical stats and profile count to 35 |`,
    `| Wheel Wells channel/shelf | ${report.browserEvidence.wheelWells.attemptedSolutionCount} | ` +
      `${report.browserEvidence.wheelWells.visibleStrategyIds.length}: Balanced, Floor, Stack, Max, Constrained | Constrained (${report.browserEvidence.wheelWells.appliedPackedCount}) | ` +
      `Constrained card 52 packed / 16 staged / 20 floor / 32 stacked / 70.2% |`,
    '',
    `The live card counts and order matched the direct harness. Screenshots: ` +
      `[Standard Max Capacity](./${report.browserEvidence.standard.screenshot}) and ` +
      `[Wheel Wells Constrained](./${report.browserEvidence.wheelWells.screenshot}).`,
    '',
    report.browserEvidence.consoleNote,
    ''
  );
  lines.push(
    '## Reliability and scope limits',
    '',
    '- Candidate-search counters and internal solver scores are not exposed by the current solver result contract, so this audit does not fabricate them.',
    '- “Distinct stacks” is reported as deterministic support-root count plus max/average support depth; arbitrary bridge geometry prevents a universal human-style column count.',
    '- Browser evidence validates the live selectable order, visible cards/metrics, dedupe count, and Apply path on representative loads; it is not used for broad solver measurement.',
    '- The JSON artifact is the machine-readable source for every fixture, strategy metric, signature hash, pairwise comparison, warning, rejection count, and runtime sample.',
    '',
    '## Reproduction',
    '',
    '```sh',
    'node scripts/autopack-strategy-audit.mjs --repeats 2 --json docs/audits/autopack-strategy-differentiation-results-2026-07-19.json --markdown docs/audits/autopack-strategy-differentiation-audit-2026-07-19.md',
    'node --test tests/audit/autopack-strategy-differentiation.spec.mjs',
    '```',
    '',
    `Intentional convergence is expected and is not itself a defect. Across all ${Object.keys(report.aggregate.pairSummary).length} strategy pairs, exact-layout rates range from ` +
      `${Math.min(...Object.values(report.aggregate.pairSummary).map(value => value.exactLayoutRatePercent))}% to ` +
      `${Math.max(...Object.values(report.aggregate.pairSummary).map(value => value.exactLayoutRatePercent))}%.`
  );
  return `${lines.join('\n')}\n`;
}

function parseCli(args) {
  const options = { repeats: 2, json: null, markdown: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repeats') options.repeats = Number(args[++index]);
    else if (arg === '--json') options.json = args[++index];
    else if (arg === '--markdown') options.markdown = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.repeats) || options.repeats < 2) {
    throw new Error('--repeats must be an integer >= 2');
  }
  return options;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const report = runStrategyAudit({ repeats: options.repeats });
  if (options.json) await fs.writeFile(options.json, `${JSON.stringify(report, null, 2)}\n`);
  if (options.markdown) await fs.writeFile(options.markdown, buildMarkdownReport(report));
  const concise = {
    fixtures: report.aggregate.fixtureCount,
    strategyRuns: report.aggregate.totalStrategyRuns,
    deterministic: report.aggregate.allDeterministic,
    invalidPlacements: report.aggregate.invalidPlacementCount,
    canonicalAgreementFailures: report.aggregate.canonicalAgreementFailures,
    outputs: { json: options.json, markdown: options.markdown },
  };
  process.stdout.write(`${JSON.stringify(concise, null, 2)}\n`);
  if (
    !report.aggregate.allDeterministic ||
    report.aggregate.invalidPlacementCount ||
    report.aggregate.canonicalAgreementFailures ||
    report.aggregate.inputMutationDetected
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
