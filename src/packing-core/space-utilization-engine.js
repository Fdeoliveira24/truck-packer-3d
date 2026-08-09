/**
 * @file space-utilization-engine.js
 * @description Pure, deterministic cargo-cube and orthogonal spatial-utilization analysis.
 * @module packing-core/space-utilization-engine
 */

import { volumeInCubicInches } from '../core/utils.js';
import { getWheelWellGeometry } from './wheel-well-model.js';

export const SPACE_UTILIZATION_NUMERIC_TOLERANCE = 1e-6;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPoint(point) {
  return Boolean(
    point &&
    finiteNumber(point.x) !== null &&
    finiteNumber(point.y) !== null &&
    finiteNumber(point.z) !== null
  );
}

function validDimensions(dimensions) {
  return Boolean(
    dimensions &&
    finiteNumber(dimensions.length) > 0 &&
    finiteNumber(dimensions.width) > 0 &&
    finiteNumber(dimensions.height) > 0
  );
}

function normalizeAabb(aabb) {
  if (!aabb || !validPoint(aabb.min) || !validPoint(aabb.max)) return null;
  const normalized = {
    min: {
      x: Number(aabb.min.x),
      y: Number(aabb.min.y),
      z: Number(aabb.min.z),
    },
    max: {
      x: Number(aabb.max.x),
      y: Number(aabb.max.y),
      z: Number(aabb.max.z),
    },
  };
  if (
    normalized.max.x <= normalized.min.x ||
    normalized.max.y <= normalized.min.y ||
    normalized.max.z <= normalized.min.z
  ) return null;
  return normalized;
}

function cloneAabb(aabb) {
  return {
    min: { ...aabb.min },
    max: { ...aabb.max },
  };
}

function aabbVolume(aabb) {
  if (!aabb) return 0;
  return Math.max(0, aabb.max.x - aabb.min.x) *
    Math.max(0, aabb.max.y - aabb.min.y) *
    Math.max(0, aabb.max.z - aabb.min.z);
}

function intersectAabbs(a, b) {
  if (!a || !b) return null;
  return normalizeAabb({
    min: {
      x: Math.max(a.min.x, b.min.x),
      y: Math.max(a.min.y, b.min.y),
      z: Math.max(a.min.z, b.min.z),
    },
    max: {
      x: Math.min(a.max.x, b.max.x),
      y: Math.min(a.max.y, b.max.y),
      z: Math.min(a.max.z, b.max.z),
    },
  });
}

function aabbsHavePositiveIntersection(a, b) {
  return Boolean(
    a && b &&
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function unionLength(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals
    .map(interval => [interval[0], interval[1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let start = sorted[0][0];
  let end = sorted[0][1];
  for (let index = 1; index < sorted.length; index++) {
    const next = sorted[index];
    if (next[0] <= end) {
      end = Math.max(end, next[1]);
      continue;
    }
    total += end - start;
    start = next[0];
    end = next[1];
  }
  return total + end - start;
}

function unionAreaYz(boxes) {
  const yCoordinates = uniqueSorted(boxes.flatMap(box => [box.min.y, box.max.y]));
  let area = 0;
  for (let index = 0; index < yCoordinates.length - 1; index++) {
    const y0 = yCoordinates[index];
    const y1 = yCoordinates[index + 1];
    if (y1 <= y0) continue;
    const zIntervals = boxes
      .filter(box => box.min.y < y1 && box.max.y > y0)
      .map(box => [box.min.z, box.max.z]);
    area += (y1 - y0) * unionLength(zIntervals);
  }
  return area;
}

function sweepUnionVolume(boxes) {
  const xCoordinates = uniqueSorted(boxes.flatMap(box => [box.min.x, box.max.x]));
  let volume = 0;
  for (let index = 0; index < xCoordinates.length - 1; index++) {
    const x0 = xCoordinates[index];
    const x1 = xCoordinates[index + 1];
    if (x1 <= x0) continue;
    const active = boxes.filter(box => box.min.x < x1 && box.max.x > x0);
    volume += (x1 - x0) * unionAreaYz(active);
  }
  return volume;
}

/**
 * Exact union volume for axis-aligned boxes. Disconnected boxes are separated
 * first, keeping the sweep small for normal non-overlapping load plans.
 */
function unionVolume(aabbs) {
  const boxes = (aabbs || []).map(normalizeAabb).filter(Boolean);
  if (!boxes.length) return 0;
  if (boxes.length === 1) return aabbVolume(boxes[0]);

  const parent = boxes.map((_, index) => index);
  const find = index => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const join = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      if (aabbsHavePositiveIntersection(boxes[a], boxes[b])) join(a, b);
    }
  }

  const groups = new Map();
  boxes.forEach((box, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(box);
  });

  let volume = 0;
  for (const group of groups.values()) {
    volume += group.length === 1 ? aabbVolume(group[0]) : sweepUnionVolume(group);
  }
  return volume;
}

function clipAabbToZones(aabb, zones) {
  return zones.map(zone => intersectAabbs(aabb, zone)).filter(Boolean);
}

function safeArrayCall(fn, value, diagnostics, reason) {
  if (typeof fn !== 'function') {
    diagnostics.geometry.push({ type: 'geometry', reason: `${reason} helper is unavailable` });
    return [];
  }
  try {
    const result = fn(value);
    if (Array.isArray(result)) return result;
  } catch {
    // The deterministic incomplete result below is preferable to leaking a
    // service-layer geometry exception into UI consumers.
  }
  diagnostics.geometry.push({ type: 'geometry', reason: `${reason} is unavailable or malformed` });
  return [];
}

function resolveCase(caseLibrary, caseId) {
  return (caseLibrary || []).find(caseData => caseData && caseData.id === caseId) || null;
}

function addUnresolvedDiagnostic(diagnostics, instanceId, caseId, reason) {
  diagnostics.unresolvedInstances.push({
    type: 'unresolved',
    instanceId,
    caseId,
    reason,
  });
}

/**
 * Calculate cargo cube plus exact orthogonal envelope utilization.
 *
 * The supplied adapters are the existing PackLibrary geometry authorities.
 * Keeping them injected avoids a packing-core -> service -> packing-core import
 * cycle while ensuring this engine never reinterprets truck shape modes.
 *
 * @param {{
 *   pack?: Record<string, any>,
 *   caseLibrary?: Array<Record<string, any>>,
 *   geometry?: {
 *     getTrailerUsableZones?: Function,
 *     getTrailerCapacityInches3?: Function,
 *     getFrontBonusBlockedZones?: Function,
 *     getInstanceEffectiveDims?: Function,
 *     makeAabb?: Function,
 *     isAabbInsideTruckGeometry?: Function,
 *   },
 *   numericTolerance?: number,
 * }} [input]
 */
export function computeSpaceUtilization({
  pack = {},
  caseLibrary = [],
  geometry = {},
  numericTolerance = SPACE_UTILIZATION_NUMERIC_TOLERANCE,
} = {}) {
  const toleranceValue = finiteNumber(numericTolerance);
  const tolerance = toleranceValue !== null && toleranceValue >= 0
    ? toleranceValue
    : SPACE_UTILIZATION_NUMERIC_TOLERANCE;
  const diagnostics = {
    numericTolerance: tolerance,
    geometry: [],
    unresolvedInstances: [],
    overlaps: [],
    outside: [],
    blockedRegions: [],
    blockedIntersections: [],
  };
  const truck = pack && typeof pack === 'object' ? pack.truck : null;
  const rawZones = safeArrayCall(
    geometry.getTrailerUsableZones,
    truck,
    diagnostics,
    'usable zones'
  );
  const zones = rawZones.map(normalizeAabb).filter(Boolean);
  if (zones.length !== rawZones.length || zones.length === 0) {
    diagnostics.geometry.push({ type: 'geometry', reason: 'usable zones are missing or malformed' });
  }

  let usableVolume = 0;
  if (typeof geometry.getTrailerCapacityInches3 !== 'function') {
    diagnostics.geometry.push({ type: 'geometry', reason: 'usable volume helper is unavailable' });
  } else {
    try {
      const resolvedVolume = finiteNumber(geometry.getTrailerCapacityInches3(truck));
      if (resolvedVolume !== null && resolvedVolume > 0) usableVolume = resolvedVolume;
      else diagnostics.geometry.push({ type: 'geometry', reason: 'usable volume is missing or malformed' });
    } catch {
      diagnostics.geometry.push({ type: 'geometry', reason: 'usable volume is unavailable or malformed' });
    }
  }

  const wheelWell = getWheelWellGeometry(truck || {});
  const wheelWellBlocked = wheelWell && Array.isArray(wheelWell.blocked) ? wheelWell.blocked : [];
  const frontBlocked = safeArrayCall(
    geometry.getFrontBonusBlockedZones,
    truck,
    diagnostics,
    'front blocked zones'
  );
  const blockedRegions = [
    ...wheelWellBlocked.map(aabb => ({ kind: 'wheel-well-body', aabb })),
    ...frontBlocked.map(aabb => ({ kind: 'cab-void', aabb })),
  ].map(region => ({ ...region, aabb: normalizeAabb(region.aabb) }))
    .filter(region => Boolean(region.aabb));
  diagnostics.blockedRegions = blockedRegions.map((region, index) => ({
    index,
    kind: region.kind,
    aabb: cloneAabb(region.aabb),
  }));

  const geometryResolved = diagnostics.geometry.length === 0 && usableVolume > 0 && zones.length > 0;
  const instances = Array.isArray(pack && pack.cases) ? pack.cases : [];
  const cases = Array.isArray(caseLibrary) ? caseLibrary : [];
  const instanceAabbs = [];
  const allAabbs = [];
  const clippedAabbs = [];
  const blockedIntersectionAabbs = [];
  let cargoCubeVolume = 0;
  let loadedCount = 0;
  let stagedCount = 0;
  let hiddenCount = 0;
  let unresolvedCount = 0;
  let totalClippedInstanceVolume = 0;

  for (const instance of instances) {
    if (instance && instance.hidden) {
      hiddenCount++;
      continue;
    }

    const instanceId = instance && instance.id != null ? String(instance.id) : null;
    const caseId = instance && instance.caseId != null ? String(instance.caseId) : null;
    const caseData = resolveCase(cases, instance && instance.caseId);

    if (!caseData) {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'Case definition is missing');
      continue;
    }
    if (!validDimensions(caseData.dimensions)) {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'Case dimensions are missing or malformed');
      continue;
    }
    const position = instance && instance.transform && instance.transform.position;
    if (!validPoint(position)) {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'Case position is missing or malformed');
      continue;
    }
    if (typeof geometry.getInstanceEffectiveDims !== 'function') {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'effective-dimensions helper is unavailable');
      continue;
    }

    let dimensions = null;
    try {
      dimensions = geometry.getInstanceEffectiveDims(instance, caseData);
    } catch {
      // Converted into a stable incomplete diagnostic below.
    }
    if (!validDimensions(dimensions)) {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'effective Case dimensions are missing or malformed');
      continue;
    }
    if (typeof geometry.makeAabb !== 'function') {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'AABB helper is unavailable');
      continue;
    }

    let aabb = null;
    try {
      aabb = normalizeAabb(geometry.makeAabb(position, dimensions));
    } catch {
      // Converted into a stable incomplete diagnostic below.
    }
    if (!aabb) {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'Case AABB is missing or malformed');
      continue;
    }

    if (!geometryResolved || typeof geometry.isAabbInsideTruckGeometry !== 'function') {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'truck geometry could not classify the Case');
      instanceAabbs.push({
        instanceId,
        caseId,
        placement: 'unresolved',
        dimensions: { ...dimensions },
        aabb: cloneAabb(aabb),
        clippedAabbs: [],
        envelopeVolume: aabbVolume(aabb),
        occupiedEnvelopeVolume: 0,
        outsideVolume: 0,
        blockedIntersectionVolume: 0,
      });
      continue;
    }

    let insideTruck;
    try {
      insideTruck = Boolean(geometry.isAabbInsideTruckGeometry(aabb, zones, wheelWell));
    } catch {
      unresolvedCount++;
      addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'truck geometry could not classify the Case');
      continue;
    }

    if (insideTruck) {
      loadedCount++;
      const caseCube = caseData.volume || volumeInCubicInches(caseData.dimensions);
      const numericCaseCube = finiteNumber(caseCube);
      if (numericCaseCube === null || numericCaseCube < 0) {
        unresolvedCount++;
        addUnresolvedDiagnostic(diagnostics, instanceId, caseId, 'Case cube volume is malformed');
        loadedCount--;
        continue;
      }
      cargoCubeVolume += numericCaseCube;
    } else {
      stagedCount++;
    }

    const instanceClips = clipAabbToZones(aabb, zones);
    const occupiedForInstance = unionVolume(instanceClips);
    const outsideForInstance = Math.max(0, aabbVolume(aabb) - occupiedForInstance);
    const instanceBlockedPieces = blockedRegions
      .map(region => intersectAabbs(aabb, region.aabb))
      .filter(Boolean);
    const blockedForInstance = unionVolume(instanceBlockedPieces);

    allAabbs.push(aabb);
    clippedAabbs.push(...instanceClips);
    blockedIntersectionAabbs.push(...instanceBlockedPieces);
    totalClippedInstanceVolume += occupiedForInstance;
    instanceAabbs.push({
      instanceId,
      caseId,
      placement: insideTruck ? 'loaded' : 'staged',
      dimensions: { ...dimensions },
      aabb: cloneAabb(aabb),
      clippedAabbs: instanceClips.map(cloneAabb),
      envelopeVolume: aabbVolume(aabb),
      occupiedEnvelopeVolume: occupiedForInstance,
      outsideVolume: outsideForInstance,
      blockedIntersectionVolume: blockedForInstance,
    });

    if (outsideForInstance > tolerance) {
      diagnostics.outside.push({
        type: 'outside',
        instanceId,
        caseId,
        volume: outsideForInstance,
      });
    }
    blockedRegions.forEach((region, regionIndex) => {
      const intersection = intersectAabbs(aabb, region.aabb);
      const volume = aabbVolume(intersection);
      if (volume <= tolerance) return;
      diagnostics.blockedIntersections.push({
        type: 'blocked-intersection',
        instanceId,
        caseId,
        blockedRegionIndex: regionIndex,
        kind: region.kind,
        volume,
      });
    });
  }

  for (let a = 0; a < instanceAabbs.length; a++) {
    const first = instanceAabbs[a];
    if (first.placement === 'unresolved') continue;
    for (let b = a + 1; b < instanceAabbs.length; b++) {
      const second = instanceAabbs[b];
      if (second.placement === 'unresolved') continue;
      const intersection = intersectAabbs(first.aabb, second.aabb);
      if (!intersection) continue;
      const volume = unionVolume(clipAabbToZones(intersection, zones));
      if (volume <= tolerance) continue;
      diagnostics.overlaps.push({
        type: 'overlap',
        instanceIds: [first.instanceId, second.instanceId],
        volume,
      });
    }
  }

  const occupiedEnvelopeVolume = unionVolume(clippedAabbs);
  const rawEnvelopeUnionVolume = unionVolume(allAabbs);
  const overlapVolume = Math.max(0, totalClippedInstanceVolume - occupiedEnvelopeVolume);
  const outsideVolume = Math.max(0, rawEnvelopeUnionVolume - occupiedEnvelopeVolume);
  const blockedIntersectionVolume = unionVolume(blockedIntersectionAabbs);
  const cargoCubePercent = usableVolume > 0 ? (cargoCubeVolume / usableVolume) * 100 : 0;
  const spatialUtilizationPercent = usableVolume > 0
    ? (occupiedEnvelopeVolume / usableVolume) * 100
    : 0;
  const invalid = geometryResolved && (
    overlapVolume > tolerance ||
    outsideVolume > tolerance ||
    blockedIntersectionVolume > tolerance
  );
  const incomplete = diagnostics.geometry.length > 0 || unresolvedCount > 0;

  return {
    status: invalid ? 'invalid' : incomplete ? 'incomplete' : 'ready',
    usableVolume,
    cargoCubeVolume,
    cargoCubePercent,
    occupiedEnvelopeVolume,
    spatialUtilizationPercent,
    overlapVolume,
    outsideVolume,
    blockedIntersectionVolume,
    loadedCount,
    stagedCount,
    hiddenCount,
    unresolvedCount,
    zones: zones.map(cloneAabb),
    instanceAabbs,
    diagnostics,
  };
}
