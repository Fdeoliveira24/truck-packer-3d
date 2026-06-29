import {
  CONTAINMENT_EPS_INCHES,
  evaluateFrontOverhangRearRetention,
  getFrontOverhangRetentionGeometry,
} from './pack-library.js';
import { canonicalOrientationLock } from '../core/orientation.js';
import {
  RIGHT_ANGLE_RAD,
  normalizeRightAngleRotation,
  getOrientedDimsForRotation as getOrientedDimsForRotationCanonical,
} from '../core/oriented-dims.js';

const LONG_RATIO = 4;
const LONG_MIN_IN = 96;
const HEAVY_LBS = 150;
const FILLER_IN3 = 6000;
const MIN_SUPPORT_FRACTION = 0.5;
// Wheel-well stability: even with the centre of mass over support, a box may not
// cantilever more than this fraction of its own length/width beyond the supported
// area on any single side. Rejects unrealistic "balanced on an edge" overhangs
// over the open channel/void that pure COM statics would otherwise permit.
const MAX_WHEELWELL_OVERHANG_FRACTION = 1 / 3;
const CONTACT_EPS = 0.05;
const FREE_RECT_EPS = 0.05;
const BASE_ANCHOR_CAP = 18;
const MAX_ANCHOR_CAP = 24;
const REPEATED_BATCH_MIN = 8;
const FORWARD_RETENTION_Y_PENALTY = 10000;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback = 0) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function readDims(dims = {}) {
  return {
    l: positiveNumber(dims.l ?? dims.length, 0),
    w: positiveNumber(dims.w ?? dims.width, 0),
    h: positiveNumber(dims.h ?? dims.height, 0),
  };
}

// Thin adapter over the shared canonical helper: the solver works in {l,w,h}
// space, the shared module in {length,width,height}. The rotation math is the
// single source of truth in core/oriented-dims.js.
function getOrientedDimsForRotation(dims, rotation) {
  const d = readDims(dims);
  const o = getOrientedDimsForRotationCanonical(
    { length: d.l, width: d.w, height: d.h },
    rotation
  );
  return { l: o.length, w: o.width, h: o.height };
}

function makeCandidate(l, w, h, rotation, locked = false) {
  return {
    l,
    w,
    h,
    rotation: normalizeRightAngleRotation(rotation),
    locked,
  };
}

export function buildOrientationCandidates(dims = {}, item = {}) {
  const d = readDims(dims);
  if (!d.l || !d.w || !d.h) return [];

  if (item.orientationLocked === true) {
    const lockedRotation = normalizeRightAngleRotation(
      item.lockedRotation ||
        (item.transform && item.transform.rotation) ||
        item.rotation ||
        {}
    );
    const oriented = getOrientedDimsForRotation(d, lockedRotation);
    return [makeCandidate(oriented.l, oriented.w, oriented.h, lockedRotation, true)];
  }

  const lock = canonicalOrientationLock(item.orientationLock); // 'any' | 'upright' | 'onSide'
  const canFlip = item.canFlip === true;
  const seen = new Set();
  const candidates = [];

  // Rotation is the single source of truth. A candidate stores its right-angle
  // rotation and DERIVES its effective dimensions from that rotation through the
  // shared THREE-compatible helper — never a separately handwritten permutation
  // that can disagree with the rotation for compound right angles.
  function add(x, y, z) {
    const rotation = normalizeRightAngleRotation({ x, y, z });
    const o = getOrientedDimsForRotation(d, rotation);
    if (!(o.l > 0 && o.w > 0 && o.h > 0)) return;
    // Deduplicate by the derived effective dimensions: two rotations that produce
    // the same physical box are one packing candidate (e.g. a cube collapses to 1).
    const key = `${o.l}|${o.w}|${o.h}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(makeCandidate(o.l, o.w, o.h, rotation));
  }

  if (lock === 'upright' || lock === 'any') {
    add(0, 0, 0);
    add(0, RIGHT_ANGLE_RAD, 0);
  }

  if (lock === 'onSide') {
    add(0, 0, RIGHT_ANGLE_RAD);
    add(RIGHT_ANGLE_RAD, 0, RIGHT_ANGLE_RAD);
  }

  // canFlip may only introduce tipped (non-upright) faces when the case policy
  // is 'any'. 'upright' must keep the item upright even when canFlip is true,
  // and 'onside' already produced its side faces above. This matches the manual
  // rotate policy in pack-library.isOrientationAllowedByCasePolicy.
  if (canFlip && lock === 'any') {
    add(0, 0, RIGHT_ANGLE_RAD);
    add(RIGHT_ANGLE_RAD, 0, RIGHT_ANGLE_RAD);
    add(RIGHT_ANGLE_RAD, 0, 0);
    add(RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD, 0);
  }

  return candidates;
}

export function getAabb(position = {}, dims = {}) {
  const d = readDims(dims);
  const x = finiteNumber(position.x, 0);
  const y = finiteNumber(position.y, 0);
  const z = finiteNumber(position.z, 0);
  return {
    min: { x: x - d.l / 2, y: y - d.h / 2, z: z - d.w / 2 },
    max: { x: x + d.l / 2, y: y + d.h / 2, z: z + d.w / 2 },
  };
}

export function aabbsOverlap(a, b, epsilon = 0.001) {
  if (!a || !b) return false;
  return a.min.x < b.max.x - epsilon &&
    a.max.x > b.min.x + epsilon &&
    a.min.y < b.max.y - epsilon &&
    a.max.y > b.min.y + epsilon &&
    a.min.z < b.max.z - epsilon &&
    a.max.z > b.min.z + epsilon;
}

export function computeXzOverlapArea(a, b) {
  if (!a || !b) return 0;
  const overlapL = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const overlapW = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
  return overlapL * overlapW;
}

export function computeSupportFraction(candidateAabb, supports = [], tolerance = 0.05) {
  if (!candidateAabb) return 0;
  const candidateArea = Math.max(
    1e-9,
    (candidateAabb.max.x - candidateAabb.min.x) *
      (candidateAabb.max.z - candidateAabb.min.z)
  );
  const bottom = candidateAabb.min.y;
  let supportArea = 0;

  for (const support of supports || []) {
    if (!support) continue;
    if (!canSupportStack(support)) continue;
    const supportAabb = support.min && support.max
      ? support
      : getAabb(support.pos || support.position, support.dims || support.orientedDims || support.dimensions);
    if (Math.abs(bottom - supportAabb.max.y) > tolerance) continue;
    supportArea += computeXzOverlapArea(candidateAabb, supportAabb);
  }

  return Math.min(1, supportArea / candidateArea);
}

function getPlacementRules(placement = {}) {
  return (placement.item && placement.item.item) || placement.item || placement.caseData || placement;
}

function canSupportStack(placement = {}) {
  const rules = getPlacementRules(placement);
  return !(rules.noStackOnTop || rules.stackable === false);
}

function getPlacementWeight(placement = {}) {
  if (placement.item && Number.isFinite(Number(placement.item.weight))) {
    return finiteNumber(placement.item.weight, 0);
  }
  return finiteNumber(getPlacementRules(placement).weight, 0);
}

function isPalletSupport(placement = {}) {
  const rules = getPlacementRules(placement);
  return rules.isPallet === true || placement.isPallet === true;
}

function canSupportCandidateWeight(candidateItem, support) {
  if (!candidateItem) return true;
  if (isPalletSupport(support)) return true;
  const candidateWeight = finiteNumber(candidateItem.weight, 0);
  const supportWeight = getPlacementWeight(support);
  return candidateWeight <= supportWeight;
}

export function classifyAutoPackItem(item = {}) {
  const dims = getClassificationDims(item);
  const floorDims = [dims.l, dims.w].sort((a, b) => b - a);
  const longest = floorDims[0] || 0;
  const middle = floorDims[1] || 1;
  const laneByDims = longest >= LONG_MIN_IN && longest / Math.max(1, middle) >= LONG_RATIO;

  if (item.laneItem === true) return 'LANE_ITEM';
  if (item.laneItem !== false && laneByDims) return 'LANE_ITEM';
  if (item.noStackOnTop || item.stackable === false) return 'FRAGILE_BASE';
  if (finiteNumber(item.weight, 0) >= HEAVY_LBS) return 'HEAVY_BASE';
  if (dims.l * dims.w * dims.h <= FILLER_IN3) return 'FILLER';
  return 'STANDARD';
}

function getClassificationDims(item = {}) {
  if (item.classificationDims) return readDims(item.classificationDims);
  const dims = readDims(item.dims || item.dimensions || item.orientedDims);
  if (item.orientationLocked === true) {
    const lockedCandidate = buildOrientationCandidates(dims, item)[0] || null;
    if (lockedCandidate) {
      return { l: lockedCandidate.l, w: lockedCandidate.w, h: lockedCandidate.h };
    }
  }
  return dims;
}

function makeEmptyOutput() {
  return {
    placements: new Map(),
    rotations: new Map(),
    orientedDims: new Map(),
    retentionDependencies: new Map(),
    unpacked: [],
    warnings: [],
    phaseStats: {
      laneCount: 0,
      floorCount: 0,
      stackCount: 0,
      fillerCount: 0,
      unpackedCount: 0,
    },
  };
}

function normalizeTruck(truck = {}) {
  return {
    length: positiveNumber(truck.length, 0),
    width: positiveNumber(truck.width, 0),
    height: positiveNumber(truck.height, 0),
  };
}

function normalizeZone(raw = {}) {
  const min = raw.min || {};
  const max = raw.max || {};
  return {
    min: {
      x: finiteNumber(min.x, 0),
      y: finiteNumber(min.y, 0),
      z: finiteNumber(min.z, 0),
    },
    max: {
      x: finiteNumber(max.x, 0),
      y: finiteNumber(max.y, 0),
      z: finiteNumber(max.z, 0),
    },
  };
}

function normalizeZones(zones = []) {
  return (Array.isArray(zones) ? zones : [])
    .map(normalizeZone)
    .filter(zone =>
      zone.max.x > zone.min.x &&
      zone.max.y > zone.min.y &&
      zone.max.z > zone.min.z
    );
}

function isAabbContainedInZone(aabb, zone, epsilon = CONTAINMENT_EPS_INCHES) {
  return aabb.min.x >= zone.min.x - epsilon &&
    aabb.max.x <= zone.max.x + epsilon &&
    aabb.min.y >= zone.min.y - epsilon &&
    aabb.max.y <= zone.max.y + epsilon &&
    aabb.min.z >= zone.min.z - epsilon &&
    aabb.max.z <= zone.max.z + epsilon;
}

export function isAabbContainedInAnyZone(aabb, zones = [], epsilon = CONTAINMENT_EPS_INCHES) {
  return (zones || []).some(zone => isAabbContainedInZone(aabb, zone, epsilon));
}

function collidesPacked(aabb, packed) {
  return packed.some(placement => aabbsOverlap(aabb, placement.aabb));
}

function intervalsOverlap(aMin, aMax, bMin, bMax, epsilon = CONTACT_EPS) {
  return aMin < bMax - epsilon && aMax > bMin + epsilon;
}

function touches(a, b, epsilon = CONTACT_EPS) {
  return Math.abs(a - b) <= epsilon;
}

function countFaceContacts(aabb, packed) {
  let contacts = 0;
  for (const placement of packed) {
    const other = placement.aabb;
    const yOverlap = intervalsOverlap(aabb.min.y, aabb.max.y, other.min.y, other.max.y);
    if (!yOverlap) continue;
    const xOverlap = intervalsOverlap(aabb.min.x, aabb.max.x, other.min.x, other.max.x);
    const zOverlap = intervalsOverlap(aabb.min.z, aabb.max.z, other.min.z, other.max.z);
    if (zOverlap && (touches(aabb.max.x, other.min.x) || touches(aabb.min.x, other.max.x))) contacts++;
    if (xOverlap && (touches(aabb.max.z, other.min.z) || touches(aabb.min.z, other.max.z))) contacts++;
  }
  return contacts;
}

function wallContactCount(aabb, zone, loadFrontFirst) {
  if (!zone) return 0;
  let contacts = 0;
  if (loadFrontFirst ? touches(aabb.max.x, zone.max.x) : touches(aabb.min.x, zone.min.x)) contacts++;
  if (touches(aabb.min.z, zone.min.z)) contacts++;
  if (touches(aabb.max.z, zone.max.z)) contacts++;
  return contacts;
}

function getMaxStackCount(placement = {}) {
  const maxStackCount = finiteNumber(getPlacementRules(placement).maxStackCount, 0);
  return maxStackCount > 0 ? maxStackCount : 0;
}

function countDirectStackChildren(support, packed, tolerance = 0.05) {
  const supportTop = support.aabb.max.y;
  let count = 0;
  for (const placement of packed) {
    if (placement === support) continue;
    if (Math.abs(placement.aabb.min.y - supportTop) > tolerance) continue;
    if (computeXzOverlapArea(placement.aabb, support.aabb) <= 0.05) continue;
    count++;
  }
  return count;
}

function hasStackCapacity(placement, packed) {
  const maxStackCount = getMaxStackCount(placement);
  return !maxStackCount || countDirectStackChildren(placement, packed) < maxStackCount;
}

function getCandidateSupports(candidateAabb, packed, tolerance = 0.05) {
  const bottom = candidateAabb.min.y;
  return packed.filter(placement =>
    Math.abs(bottom - placement.aabb.max.y) <= tolerance &&
    computeXzOverlapArea(candidateAabb, placement.aabb) > 0.05
  );
}

function supportsCandidate(candidateAabb, packed, candidateItem = null) {
  const supports = getCandidateSupports(candidateAabb, packed);
  if (!supports.length) return false;
  if (supports.some(support => !canSupportStack(support) || !hasStackCapacity(support, packed))) return false;
  if (supports.some(support => !canSupportCandidateWeight(candidateItem, support))) return false;
  return computeSupportFraction(candidateAabb, supports) >= MIN_SUPPORT_FRACTION;
}

function normalizeItem(item = {}, index = 0) {
  const dims = readDims(item.dims || item.dimensions || item.orientedDims);
  const id = item.instanceId || item.id || `autopack-item-${index}`;
  const candidates = buildOrientationCandidates(dims, item)
    .filter(candidate => candidate.l > 0 && candidate.w > 0 && candidate.h > 0)
    .sort((a, b) => {
      const footprintDelta = (b.l * b.w) - (a.l * a.w);
      if (footprintDelta) return footprintDelta;
      const heightDelta = b.h - a.h;
      if (heightDelta) return heightDelta;
      return b.l - a.l;
    });
  const classificationDims = item.orientationLocked === true && candidates[0]
    ? { l: candidates[0].l, w: candidates[0].w, h: candidates[0].h }
    : dims;

  return {
    id,
    item,
    dims,
    candidates,
    volume: dims.l * dims.w * dims.h,
    footprint: dims.l * dims.w,
    weight: finiteNumber(item.weight, 0),
    index,
    className: classifyAutoPackItem({ ...item, classificationDims }),
  };
}

function normalizedItemFrom(value = {}) {
  if (Array.isArray(value.candidates)) return value;
  if (value.item && Array.isArray(value.item.candidates)) return value.item;
  return null;
}

function layoutGroupKey(value = {}) {
  const normalized = normalizedItemFrom(value);
  const source = normalized ? normalized.item : (value.item || value);
  const dims = normalized ? normalized.dims : readDims(source?.dims || source?.dimensions);
  return [
    'cargo',
    source?.caseId || '',
    dims.l,
    dims.w,
    dims.h,
    canonicalOrientationLock(source?.orientationLock),
    source?.orientationLocked === true ? 'locked' : 'unlocked',
    source?.canFlip === true ? 'flip' : 'no-flip',
    source?.noStackOnTop === true ? 'no-top' : 'top-ok',
    source?.stackable === false ? 'no-stack' : 'stack-ok',
    finiteNumber(source?.maxStackCount, 0),
  ].join('|');
}

function stableTextCompare(a, b) {
  const aText = String(a);
  const bText = String(b);
  if (aText === bText) return 0;
  return aText < bText ? -1 : 1;
}

function createLayoutGroupTieBreaker(items, layoutQualityEnabled, groupUniverse = items) {
  if (!layoutQualityEnabled) return (a, b) => a.index - b.index;
  const groupCounts = new Map();
  for (const item of groupUniverse || []) {
    const key = layoutGroupKey(item);
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }
  return (a, b) => {
    const aKey = layoutGroupKey(a);
    const bKey = layoutGroupKey(b);
    const countDelta = (groupCounts.get(bKey) || 0) - (groupCounts.get(aKey) || 0);
    if (countDelta) return countDelta;
    const groupDelta = stableTextCompare(aKey, bKey);
    if (groupDelta) return groupDelta;
    return stableTextCompare(a.id, b.id);
  };
}

function sortItemsForFloor(items, layoutQualityEnabled = false, groupUniverse = items) {
  const tieBreak = createLayoutGroupTieBreaker(items, layoutQualityEnabled, groupUniverse);
  return [...items].sort((a, b) => {
    const footprintDelta = b.footprint - a.footprint;
    if (footprintDelta) return footprintDelta;
    const weightDelta = b.weight - a.weight;
    if (weightDelta) return weightDelta;
    const volumeDelta = b.volume - a.volume;
    if (volumeDelta) return volumeDelta;
    const priorityDelta = finiteNumber(b.item.loadPriority, 0) - finiteNumber(a.item.loadPriority, 0);
    if (priorityDelta) return priorityDelta;
    return tieBreak(a, b);
  });
}

function sortItemsForFiller(items, layoutQualityEnabled = false, groupUniverse = items) {
  const tieBreak = createLayoutGroupTieBreaker(items, layoutQualityEnabled, groupUniverse);
  return [...items].sort((a, b) => {
    const footprintDelta = a.footprint - b.footprint;
    if (footprintDelta) return footprintDelta;
    const volumeDelta = a.volume - b.volume;
    if (volumeDelta) return volumeDelta;
    const priorityDelta = finiteNumber(b.item.loadPriority, 0) - finiteNumber(a.item.loadPriority, 0);
    if (priorityDelta) return priorityDelta;
    const weightDelta = b.weight - a.weight;
    if (weightDelta) return weightDelta;
    return tieBreak(a, b);
  });
}

function sortItemsForStack(items, layoutQualityEnabled = false, groupUniverse = items) {
  const tieBreak = createLayoutGroupTieBreaker(items, layoutQualityEnabled, groupUniverse);
  return [...items].sort((a, b) => {
    const weightDelta = b.weight - a.weight;
    if (weightDelta) return weightDelta;
    const footprintDelta = b.footprint - a.footprint;
    if (footprintDelta) return footprintDelta;
    const volumeDelta = b.volume - a.volume;
    if (volumeDelta) return volumeDelta;
    return tieBreak(a, b);
  });
}

function sortItemsForLane(items, layoutQualityEnabled = false, groupUniverse = items) {
  const tieBreak = createLayoutGroupTieBreaker(items, layoutQualityEnabled, groupUniverse);
  return [...items].sort((a, b) => {
    const maxLength = item => Math.max(0, ...item.candidates.map(candidate => candidate.l));
    const minWidth = item => Math.min(Infinity, ...item.candidates.map(candidate => candidate.w));
    const lengthDelta = maxLength(b) - maxLength(a);
    if (lengthDelta) return lengthDelta;
    const widthDelta = minWidth(a) - minWidth(b);
    if (widthDelta) return widthDelta;
    const volumeDelta = b.volume - a.volume;
    if (volumeDelta) return volumeDelta;
    const priorityDelta = finiteNumber(b.item.loadPriority, 0) - finiteNumber(a.item.loadPriority, 0);
    if (priorityDelta) return priorityDelta;
    return tieBreak(a, b);
  });
}

function sortZonesForFloor(zones, loadFrontFirst) {
  return [...zones].sort((a, b) => {
    const ax = loadFrontFirst ? a.max.x : a.min.x;
    const bx = loadFrontFirst ? b.max.x : b.min.x;
    if (ax !== bx) return loadFrontFirst ? bx - ax : ax - bx;
    if (a.min.y !== b.min.y) return a.min.y - b.min.y;
    return a.min.z - b.min.z;
  });
}

function uniqueSorted(values, comparator) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = Math.round(value * 1000000) / 1000000;
    const key = String(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out.sort(comparator);
}

function compareScore(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function makeFreeRect(zone, index = 0) {
  return {
    id: `zone-${index}`,
    zone,
    minX: zone.min.x,
    maxX: zone.max.x,
    minZ: zone.min.z,
    maxZ: zone.max.z,
  };
}

function freeRectLength(rect) {
  return rect.maxX - rect.minX;
}

function freeRectWidth(rect) {
  return rect.maxZ - rect.minZ;
}

function freeRectArea(rect) {
  return Math.max(0, freeRectLength(rect)) * Math.max(0, freeRectWidth(rect));
}

function freeRectHasArea(rect) {
  return freeRectLength(rect) > FREE_RECT_EPS && freeRectWidth(rect) > FREE_RECT_EPS;
}

function freeRectContains(outer, inner) {
  return outer.zone === inner.zone &&
    outer.minX <= inner.minX + FREE_RECT_EPS &&
    outer.maxX >= inner.maxX - FREE_RECT_EPS &&
    outer.minZ <= inner.minZ + FREE_RECT_EPS &&
    outer.maxZ >= inner.maxZ - FREE_RECT_EPS;
}

function freeRectsEqual(a, b) {
  return a.zone === b.zone &&
    Math.abs(a.minX - b.minX) <= FREE_RECT_EPS &&
    Math.abs(a.maxX - b.maxX) <= FREE_RECT_EPS &&
    Math.abs(a.minZ - b.minZ) <= FREE_RECT_EPS &&
    Math.abs(a.maxZ - b.maxZ) <= FREE_RECT_EPS;
}

function normalizeFreeRects(rects) {
  const filtered = (rects || []).filter(freeRectHasArea);
  const unique = [];
  for (const rect of filtered) {
    if (unique.some(existing => freeRectsEqual(existing, rect))) continue;
    unique.push(rect);
  }
  return unique.filter((rect, index) =>
    !unique.some((other, otherIndex) =>
      otherIndex !== index &&
      freeRectContains(other, rect) &&
      freeRectArea(other) >= freeRectArea(rect) - FREE_RECT_EPS
    )
  );
}

function createRetentionContext(truck, zones, fixedPlacements = []) {
  return {
    truck,
    zones,
    geometry: getFrontOverhangRetentionGeometry(truck, zones),
    fixedPlacements: Array.isArray(fixedPlacements) ? fixedPlacements : [],
  };
}

function evaluateCandidateRetention(aabb, packed, retentionContext) {
  if (!retentionContext?.geometry) return { required: false, retained: true, retainerIds: [] };
  return evaluateFrontOverhangRearRetention(
    aabb,
    [...retentionContext.fixedPlacements, ...(packed || [])],
    retentionContext.truck,
    retentionContext.zones
  );
}

function candidateHasRearRetention(aabb, packed, retentionContext) {
  return evaluateCandidateRetention(aabb, packed, retentionContext).retained;
}

function placementsHaveRearRetention(placements, retentionContext) {
  if (!retentionContext?.geometry) return true;
  const all = [...retentionContext.fixedPlacements, ...(placements || [])];
  return (placements || []).every(placement =>
    evaluateFrontOverhangRearRetention(
      placement.aabb,
      all.filter(other => other !== placement),
      retentionContext.truck,
      retentionContext.zones
    ).retained
  );
}

function createFloorState(zones, frontSurfaceFirst = false, retentionContext = null) {
  return {
    freeRects: normalizeFreeRects(zones.map((zone, index) => makeFreeRect(zone, index))),
    frontSurfaceFirst: frontSurfaceFirst === true,
    retentionContext,
  };
}

function rectIntersectsAabb(rect, aabb) {
  return rect.minX < aabb.max.x - FREE_RECT_EPS &&
    rect.maxX > aabb.min.x + FREE_RECT_EPS &&
    rect.minZ < aabb.max.z - FREE_RECT_EPS &&
    rect.maxZ > aabb.min.z + FREE_RECT_EPS;
}

function subtractAabbFromFreeRect(rect, aabb) {
  if (!rectIntersectsAabb(rect, aabb)) return [rect];
  const out = [];

  if (aabb.min.x > rect.minX + FREE_RECT_EPS) {
    out.push({ ...rect, maxX: aabb.min.x });
  }
  if (aabb.max.x < rect.maxX - FREE_RECT_EPS) {
    out.push({ ...rect, minX: aabb.max.x });
  }
  if (aabb.min.z > rect.minZ + FREE_RECT_EPS) {
    out.push({ ...rect, maxZ: aabb.min.z });
  }
  if (aabb.max.z < rect.maxZ - FREE_RECT_EPS) {
    out.push({ ...rect, minZ: aabb.max.z });
  }

  return out;
}

function occupyFloorSpace(floorState, placement) {
  if (!floorState || !placement || !placement.zone) return;
  const next = [];
  for (const rect of floorState.freeRects) {
    if (rect.zone !== placement.zone) {
      next.push(rect);
      continue;
    }
    next.push(...subtractAabbFromFreeRect(rect, placement.aabb));
  }
  floorState.freeRects = normalizeFreeRects(next);
}

function scoreFloorSurface(aabb, loadFrontFirst, frontSurfaceFirst) {
  const xPrimary = loadFrontFirst ? -aabb.max.x : aabb.min.x;
  return frontSurfaceFirst
    ? [xPrimary, aabb.min.y]
    : [aabb.min.y, xPrimary];
}

function aabbAxisGap(aMin, aMax, bMin, bMax) {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

function aabbLayoutDistance(a, b) {
  return aabbAxisGap(a.min.x, a.max.x, b.min.x, b.max.x) +
    aabbAxisGap(a.min.y, a.max.y, b.min.y, b.max.y) +
    aabbAxisGap(a.min.z, a.max.z, b.min.z, b.max.z);
}

function orientationsMatch(a = {}, b = {}) {
  const ar = normalizeRightAngleRotation(a.rotation || {});
  const br = normalizeRightAngleRotation(b.rotation || {});
  return Math.abs(finiteNumber(a.l) - finiteNumber(b.l)) <= FREE_RECT_EPS &&
    Math.abs(finiteNumber(a.w) - finiteNumber(b.w)) <= FREE_RECT_EPS &&
    Math.abs(finiteNumber(a.h) - finiteNumber(b.h)) <= FREE_RECT_EPS &&
    ar.x === br.x && ar.y === br.y && ar.z === br.z;
}

// E2B: wheel-well geometry has zones of unequal cross-trailer (z) width — the
// full-width front/rear zones plus the narrow center channel between the wheel
// wells. "A zone narrower than the widest zone" is geometry-driven, so it is false
// for Standard (one zone, the widest) and never changes Standard behavior.
function narrowChannelZones(zones) {
  const widths = (zones || []).map(zone => zone.max.z - zone.min.z);
  if (widths.length < 2) return [];
  const widest = Math.max(...widths);
  return (zones || []).filter(zone => (zone.max.z - zone.min.z) < widest - FREE_RECT_EPS);
}

// E2B: is this stack candidate inside a narrow wheel-well channel zone? Channel
// stacks must follow the floor block+filler footprint below them instead of
// re-packing the supporter surface in a denser-but-misaligned arrangement.
function aabbInNarrowChannel(aabb, channelZones) {
  return (channelZones || []).some(zone =>
    aabb.min.x >= zone.min.x - FREE_RECT_EPS && aabb.max.x <= zone.max.x + FREE_RECT_EPS &&
    aabb.min.z >= zone.min.z - FREE_RECT_EPS && aabb.max.z <= zone.max.z + FREE_RECT_EPS
  );
}

// E1: how well a stack candidate "follows" the layer directly beneath it. Returns
// [orientationMismatch, columnMismatch] (0 = follows, 1 = does not). A candidate
// that keeps the same yaw as a supporter AND lands squarely on one supporter's
// footprint (aligned X and Z extents) forms a broad stable block instead of a
// straddling/rotated tower. Lower is better. Hard support rules already passed.
function scoreStackSupportMatch(candidateAabb, orientation, supports) {
  if (!supports || !supports.length) return [1, 1];
  const orientationMismatch = supports.some(support =>
    orientationsMatch(orientation, support.orientation || {})
  ) ? 0 : 1;
  const columnMismatch = supports.some(support =>
    support.aabb &&
    Math.abs(support.aabb.min.x - candidateAabb.min.x) <= FREE_RECT_EPS &&
    Math.abs(support.aabb.max.x - candidateAabb.max.x) <= FREE_RECT_EPS &&
    Math.abs(support.aabb.min.z - candidateAabb.min.z) <= FREE_RECT_EPS &&
    Math.abs(support.aabb.max.z - candidateAabb.max.z) <= FREE_RECT_EPS
  ) ? 0 : 1;
  return [orientationMismatch, columnMismatch];
}

function scoreLayoutGroupContinuity(
  aabb,
  orientation,
  item,
  packed,
  loadFrontFirst,
  layoutQualityEnabled
) {
  if (!layoutQualityEnabled) return { continuity: [], orientationPenalty: 0, surfaceOrientationPenalty: 0 };
  const groupKey = layoutGroupKey(item);
  const matches = (packed || []).filter(placement => layoutGroupKey(placement) === groupKey);
  if (!matches.length) {
    return { continuity: [0, 0, 0, 0, 0], orientationPenalty: 0, surfaceOrientationPenalty: 0 };
  }

  const candidateFront = loadFrontFirst ? aabb.max.x : aabb.min.x;
  const sameSurface = matches.filter(placement =>
    Math.abs(placement.aabb.min.y - aabb.min.y) <= CONTACT_EPS
  );
  const sameRow = sameSurface.filter(placement => {
    const placementFront = loadFrontFirst ? placement.aabb.max.x : placement.aabb.min.x;
    return Math.abs(placementFront - candidateFront) <= CONTACT_EPS;
  });
  const sameRowContacts = sameRow.filter(placement => touches(aabb, placement.aabb));
  const nearestDistance = Math.min(...matches.map(placement =>
    aabbLayoutDistance(aabb, placement.aabb)
  ));
  const orientationPenalty = sameRow.length && !sameRow.some(placement =>
    orientationsMatch(orientation, placement.orientation)
  ) ? 1 : 0;
  // E2A: orientation consistency across the WHOLE active surface, not only the row.
  // Sub-grid / leftover same-case cases often land in a fresh row (no same-row
  // neighbor yet), so the per-row orientationPenalty cannot fire and they would
  // flip to shave local waste. Penalizing a yaw that no same-surface case already
  // uses pulls those isolated cases back to the established floor yaw. Additive and
  // consumed ONLY by the Standard/Wheel Wells floor/lane quality branches, so the
  // Front Overhang and quality-off score arrays are byte-identical.
  const surfaceOrientationPenalty = sameSurface.length && !sameSurface.some(placement =>
    orientationsMatch(orientation, placement.orientation)
  ) ? 1 : 0;

  return {
    continuity: [
      sameSurface.length ? 0 : 1,
      sameRow.length ? 0 : 1,
      sameRowContacts.length ? 0 : 1,
      nearestDistance,
      -sameRowContacts.length,
    ],
    orientationPenalty,
    surfaceOrientationPenalty,
  };
}

function scoreFreeRectCandidate(
  candidate,
  loadFrontFirst,
  packed = [],
  frontSurfaceFirst = false,
  item = null,
  orientation = null,
  layoutQualityEnabled = false
) {
  const rect = candidate.freeRect;
  const leftoverX = Math.max(0, freeRectLength(rect) - candidate.dims.l);
  const leftoverZ = Math.max(0, freeRectWidth(rect) - candidate.dims.w);
  const wasteArea = Math.max(0, freeRectArea(rect) - candidate.dims.l * candidate.dims.w);
  const wallContacts = wallContactCount(candidate.aabb, candidate.zone, loadFrontFirst);
  const faceContacts = countFaceContacts(candidate.aabb, packed);
  const contactScore = wallContacts + Math.min(8, faceContacts);
  const groupScore = scoreLayoutGroupContinuity(
    candidate.aabb,
    orientation,
    item,
    packed,
    loadFrontFirst,
    frontSurfaceFirst || layoutQualityEnabled
  );
  // Front Overhang true high-+X raised surface ordering (Phase C) — unchanged, so the
  // overhang deck/wall behavior and its byte baselines stay exactly as before.
  if (frontSurfaceFirst) {
    return [
      ...scoreFloorSurface(candidate.aabb, loadFrontFirst, true),
      ...groupScore.continuity,
      -contactScore,
      Math.min(leftoverX, leftoverZ),
      wasteArea,
      leftoverZ,
      groupScore.orientationPenalty,
      candidate.aabb.min.z,
      leftoverX,
    ];
  }
  // E2A: Standard / Wheel Wells front-first floor WITH layout quality (only on the
  // ordinary/leftover/filler floor path — the repeated-batch grid and B2C forward-
  // wall completion are intentionally left on the no-quality path so their proven
  // shelf-grid + legal alternate-yaw completion behavior is unchanged). Keep Phase
  // B's [lowest-layer, high-X] primary fill, then cluster onto the active same-case
  // surface/row and rank ORIENTATION CONSISTENCY (orientationPenalty then the
  // surface-wide penalty) ABOVE contact density and free-rect waste — the audited
  // fix, since the old path put waste before any orientation signal. Quality only
  // re-ranks already-legal candidates (hard filters ran in findFloorPlacement), so
  // a case that fits only rotated still places: placement count cannot drop.
  if (layoutQualityEnabled) {
    return [
      ...scoreFloorSurface(candidate.aabb, loadFrontFirst, false),
      groupScore.continuity[0],
      groupScore.continuity[1],
      groupScore.continuity[2],
      groupScore.orientationPenalty,
      groupScore.surfaceOrientationPenalty,
      -contactScore,
      groupScore.continuity[3],
      groupScore.continuity[4],
      Math.min(leftoverX, leftoverZ),
      wasteArea,
      leftoverZ,
      candidate.aabb.min.z,
      leftoverX,
    ];
  }
  // Layout quality disabled (repeated-grid / B2C completion / compaction / repack /
  // diagnostic opt-out): original ordering, byte-identical to the E1 baseline.
  return [
    ...scoreFloorSurface(candidate.aabb, loadFrontFirst, false),
    -contactScore,
    Math.min(leftoverX, leftoverZ),
    wasteArea,
    leftoverZ,
    candidate.aabb.min.z,
    leftoverX,
  ];
}

function clampAnchor(value, min, max, size) {
  const lower = min;
  const upper = max - size;
  if (value < lower - FREE_RECT_EPS || value > upper + FREE_RECT_EPS) return null;
  if (Math.abs(value - lower) <= FREE_RECT_EPS) return lower;
  if (Math.abs(value - upper) <= FREE_RECT_EPS) return upper;
  return value;
}

function isPlacementOnRectFloor(placement, rect) {
  if (!placement || !placement.aabb || !rect?.zone) return false;
  if (Math.abs(placement.aabb.min.y - rect.zone.min.y) > CONTACT_EPS) return false;
  return isAabbContainedInZone(placement.aabb, rect.zone) || rectIntersectsAabb(rect, placement.aabb);
}

function capAnchorValues(values, maxCount, scoreAnchor, comparator) {
  const unique = uniqueSorted(values, comparator);
  if (unique.length <= maxCount) return unique;
  return unique
    .map(value => ({ value, score: scoreAnchor(value) }))
    .sort((a, b) => a.score - b.score || comparator(a.value, b.value))
    .slice(0, maxCount)
    .map(entry => entry.value)
    .sort(comparator);
}

function anchorCapForPackedCount(packed = []) {
  const count = Array.isArray(packed) ? packed.length : 0;
  return Math.min(MAX_ANCHOR_CAP, BASE_ANCHOR_CAP + Math.floor(count / 30) * 2);
}

function buildAxisAnchors(rect, orientation, packed, loadFrontFirst, axis) {
  const isX = axis === 'x';
  const min = isX ? rect.minX : rect.minZ;
  const max = isX ? rect.maxX : rect.maxZ;
  const size = isX ? orientation.l : orientation.w;
  const primary = isX && loadFrontFirst ? max - size : min;
  const secondary = isX && loadFrontFirst ? min : max - size;
  const raw = [primary, secondary, min, max - size];

  for (const placement of packed) {
    if (!isPlacementOnRectFloor(placement, rect)) continue;
    const pMin = isX ? placement.aabb.min.x : placement.aabb.min.z;
    const pMax = isX ? placement.aabb.max.x : placement.aabb.max.z;
    raw.push(pMin, pMax, pMin - size, pMax - size);
  }

  const anchors = [];
  for (const value of raw) {
    const clamped = clampAnchor(value, min, max, size);
    if (clamped === null) continue;
    anchors.push(clamped);
  }

  const comparator = isX && loadFrontFirst ? (a, b) => b - a : (a, b) => a - b;
  const scoreAnchor = value => {
    if (!isX) {
      return Math.min(Math.abs(value - min), Math.abs((value + size) - max));
    }
    return loadFrontFirst ? Math.abs((value + size) - max) : Math.abs(value - min);
  };

  return capAnchorValues(anchors, anchorCapForPackedCount(packed), scoreAnchor, comparator);
}

function buildFreeRectCandidates(orientation, floorState, loadFrontFirst, packed = []) {
  const placements = [];
  for (const rect of floorState.freeRects) {
    const zone = rect.zone;
    if (orientation.l > freeRectLength(rect) + FREE_RECT_EPS) continue;
    if (orientation.w > freeRectWidth(rect) + FREE_RECT_EPS) continue;
    if (orientation.h > zone.max.y - zone.min.y + FREE_RECT_EPS) continue;

    const xMins = buildAxisAnchors(rect, orientation, packed, loadFrontFirst, 'x');
    const zMins = buildAxisAnchors(rect, orientation, packed, loadFrontFirst, 'z');

    for (const xMin of xMins) {
      for (const zMin of zMins) {
        const position = {
          x: xMin + orientation.l / 2,
          y: zone.min.y + orientation.h / 2,
          z: zMin + orientation.w / 2,
        };
        const dims = { l: orientation.l, w: orientation.w, h: orientation.h };
        const aabb = getAabb(position, dims);
        placements.push({ position, dims, aabb, zone, freeRect: rect });
      }
    }
  }
  return placements;
}

function findFloorPlacement(item, floorState, packed, loadFrontFirst, options = {}) {
  let best = null;
  let bestScore = null;
  const requiredFloorY = Number.isFinite(options.floorY) ? options.floorY : null;

  for (const orientation of item.candidates) {
    for (const candidate of buildFreeRectCandidates(orientation, floorState, loadFrontFirst, packed)) {
      if (requiredFloorY !== null && Math.abs(candidate.aabb.min.y - requiredFloorY) > CONTACT_EPS) continue;
      if (!isAabbContainedInZone(candidate.aabb, candidate.zone)) continue;
      if (collidesPacked(candidate.aabb, packed)) continue;
      if (!candidateHasRearRetention(candidate.aabb, packed, floorState.retentionContext)) continue;
      const score = scoreFreeRectCandidate(
        candidate,
        loadFrontFirst,
        packed,
        floorState.frontSurfaceFirst,
        item,
        orientation,
        options.layoutQualityEnabled === true
      );
      if (!best || compareScore(score, bestScore) < 0) {
        best = { ...candidate, orientation };
        bestScore = score;
      }
    }
  }

  return best;
}

function getLaneOrientations(item) {
  return [...item.candidates].sort((a, b) => {
    const lengthDelta = b.l - a.l;
    if (lengthDelta) return lengthDelta;
    const widthDelta = a.w - b.w;
    if (widthDelta) return widthDelta;
    return a.h - b.h;
  });
}

function scoreLaneCandidate(
  candidate,
  orientation,
  loadFrontFirst,
  frontSurfaceFirst = false,
  item = null,
  packed = [],
  layoutQualityEnabled = false
) {
  const rectWaste = candidate.freeRect
    ? Math.max(0, freeRectArea(candidate.freeRect) - orientation.l * orientation.w)
    : 0;
  // Phase B keeps lane length and the lowest layer ahead of high-X. Phase C moves
  // the shared Front Overhang surface score ahead of lane length so a legal raised
  // forward deck candidate cannot lose merely because its independent floor is high.
  const surfaceScore = scoreFloorSurface(candidate.aabb, loadFrontFirst, frontSurfaceFirst);
  const groupScore = scoreLayoutGroupContinuity(
    candidate.aabb,
    orientation,
    item,
    packed,
    loadFrontFirst,
    frontSurfaceFirst || layoutQualityEnabled
  );
  // Front Overhang raised-surface ordering — unchanged.
  if (frontSurfaceFirst) {
    return [
      ...surfaceScore,
      ...groupScore.continuity,
      -orientation.l,
      rectWaste,
      groupScore.orientationPenalty,
      candidate.aabb.min.z,
      orientation.w,
    ];
  }
  // E2A: Standard / Wheel Wells lanes keep lane-length-first, then same-case row
  // continuity and consistent yaw (orientationPenalty + surface penalty) ahead of
  // free-rect waste.
  if (layoutQualityEnabled) {
    return [
      -orientation.l,
      ...surfaceScore,
      ...groupScore.continuity,
      groupScore.orientationPenalty,
      groupScore.surfaceOrientationPenalty,
      rectWaste,
      candidate.aabb.min.z,
      orientation.w,
    ];
  }
  return [-orientation.l, ...surfaceScore, rectWaste, candidate.aabb.min.z, orientation.w];
}

function findLanePlacement(item, floorState, packed, loadFrontFirst, layoutQualityEnabled = false) {
  let best = null;
  let bestScore = null;

  for (const orientation of getLaneOrientations(item)) {
    for (const candidate of buildFreeRectCandidates(orientation, floorState, loadFrontFirst, packed)) {
      if (!isAabbContainedInZone(candidate.aabb, candidate.zone)) continue;
      if (collidesPacked(candidate.aabb, packed)) continue;
      if (!candidateHasRearRetention(candidate.aabb, packed, floorState.retentionContext)) continue;
      const score = scoreLaneCandidate(
        candidate,
        orientation,
        loadFrontFirst,
        floorState.frontSurfaceFirst,
        item,
        packed,
        layoutQualityEnabled
      );
      if (!best || compareScore(score, bestScore) < 0) {
        best = { ...candidate, orientation };
        bestScore = score;
      }
    }
  }

  return best;
}

export function repeatedBatchKey(item) {
  if (!item || item.className === 'LANE_ITEM' || !item.candidates.length) return '';
  const source = item.item || {};
  const lockKey = source.orientationLocked === true
    ? JSON.stringify(normalizeRightAngleRotation(source.lockedRotation || source.transform?.rotation || {}))
    : 'unlocked';
  return [
    source.caseId || '',
    item.dims.l,
    item.dims.w,
    item.dims.h,
    source.canFlip === true ? 'flip' : 'no-flip',
    // Canonical orientation so aliases (onside/on-side/onSide) batch together and
    // an accepted spelling never changes the batch key.
    canonicalOrientationLock(source.orientationLock),
    lockKey,
    source.noStackOnTop === true ? 'no-top' : 'top-ok',
    source.stackable === false ? 'no-stack' : 'stack-ok',
    finiteNumber(source.maxStackCount, 0),
    finiteNumber(item.weight ?? source.weight, 0),
  ].join('|');
}

function buildRepeatedBatches(items, layoutQualityEnabled = false) {
  const groups = new Map();
  for (const item of items || []) {
    const key = repeatedBatchKey(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()]
    .map(group => layoutQualityEnabled
      ? [...group].sort((a, b) => stableTextCompare(a.id, b.id))
      : group
    )
    .filter(group => group.length >= REPEATED_BATCH_MIN)
    .sort((a, b) => {
      const footprintDelta = b[0].footprint - a[0].footprint;
      if (footprintDelta) return footprintDelta;
      const weightDelta = repeatedGroupWeight(b) - repeatedGroupWeight(a);
      if (weightDelta) return weightDelta;
      const countDelta = b.length - a.length;
      if (countDelta) return countDelta;
      return layoutQualityEnabled
        ? stableTextCompare(layoutGroupKey(a[0]), layoutGroupKey(b[0]))
        : a[0].index - b[0].index;
    });
}

function repeatedGroupWeight(group = []) {
  return group.reduce((max, item) => Math.max(max, finiteNumber(item.weight, 0)), 0);
}

function scoreRepeatedOrientation(orientation, floorState, orderIndex, groupSize = 0) {
  let floorCapacity = 0;
  let bestRows = 0;
  let bestCols = 0;
  let wastedWidth = 0;
  let wastedLength = 0;

  for (const rect of floorState.freeRects || []) {
    const cols = Math.floor((freeRectLength(rect) + FREE_RECT_EPS) / orientation.l);
    const rows = Math.floor((freeRectWidth(rect) + FREE_RECT_EPS) / orientation.w);
    if (cols <= 0 || rows <= 0) continue;
    floorCapacity += cols * rows;
    bestRows = Math.max(bestRows, rows);
    bestCols = Math.max(bestCols, cols);
    wastedWidth += freeRectWidth(rect) - rows * orientation.w;
    wastedLength += freeRectLength(rect) - cols * orientation.l;
  }

  const fitsWholeGroup = groupSize > 0 && floorCapacity >= groupSize;
  if (fitsWholeGroup) {
    return [
      0,
      orientation.h,
      wastedWidth,
      wastedLength,
      -bestRows,
      -bestCols,
      orderIndex,
    ];
  }

  return [
    1,
    -floorCapacity,
    -bestRows,
    -bestCols,
    wastedWidth,
    wastedLength,
    orderIndex,
  ];
}

function chooseRepeatedBatchOrientation(group, floorState) {
  const first = group && group[0];
  if (!first || !first.candidates.length) return null;
  let best = null;
  let bestScore = null;
  first.candidates.forEach((orientation, orderIndex) => {
    const score = scoreRepeatedOrientation(orientation, floorState, orderIndex, group.length);
    if (score[0] === 1 && score[1] === 0) return;
    if (!best || compareScore(score, bestScore) < 0) {
      best = orientation;
      bestScore = score;
    }
  });
  return best;
}

function repeatedOrientationMatches(candidate, preferred) {
  if (!candidate || !preferred) return false;
  const candidateRotation = normalizeRightAngleRotation(candidate.rotation || {});
  const preferredRotation = normalizeRightAngleRotation(preferred.rotation || {});
  return Math.abs(candidate.l - preferred.l) <= FREE_RECT_EPS &&
    Math.abs(candidate.w - preferred.w) <= FREE_RECT_EPS &&
    Math.abs(candidate.h - preferred.h) <= FREE_RECT_EPS &&
    candidateRotation.x === preferredRotation.x &&
    candidateRotation.y === preferredRotation.y &&
    candidateRotation.z === preferredRotation.z;
}

function preferRepeatedOrientation(item, preferred) {
  const candidates = Array.isArray(item && item.candidates) ? item.candidates : [];
  return [
    ...candidates.filter(candidate => repeatedOrientationMatches(candidate, preferred)),
    ...candidates.filter(candidate => !repeatedOrientationMatches(candidate, preferred)),
  ];
}

function findRepeatedForwardWallCompletion(
  item,
  preferredOrientation,
  proposedPlacement,
  floorState,
  packed,
  loadFrontFirst
) {
  const completionItem = {
    ...item,
    candidates: preferRepeatedOrientation(item, preferredOrientation),
  };
  const placementOptions = floorState.frontSurfaceFirst
    ? {}
    : { floorY: proposedPlacement.aabb.min.y };
  const candidate = findFloorPlacement(
    completionItem,
    floorState,
    packed,
    loadFrontFirst,
    placementOptions
  );
  if (!candidate) return null;

  const candidateFront = loadFrontFirst ? candidate.aabb.max.x : candidate.aabb.min.x;
  const proposedFront = loadFrontFirst
    ? proposedPlacement.aabb.max.x
    : proposedPlacement.aabb.min.x;
  const isMoreForward = loadFrontFirst
    ? candidateFront > proposedFront + FREE_RECT_EPS
    : candidateFront < proposedFront - FREE_RECT_EPS;
  return isMoreForward ? candidate : null;
}

function placeRepeatedBatchFloor(group, orientation, floorState, packed, output, loadFrontFirst) {
  if (!group.length || !orientation) return [];
  const queue = [...group];
  const rects = [...(floorState.freeRects || [])]
    .sort((a, b) => {
      const ax = loadFrontFirst ? -a.maxX : a.minX;
      const bx = loadFrontFirst ? -b.maxX : b.minX;
      if (ax !== bx) return ax - bx;
      if (a.zone.min.y !== b.zone.min.y) return a.zone.min.y - b.zone.min.y;
      return a.minZ - b.minZ;
    });

  for (const rect of rects) {
    if (!queue.length) break;
    if (orientation.h > rect.zone.max.y - rect.zone.min.y + FREE_RECT_EPS) continue;
    const cols = Math.floor((freeRectLength(rect) + FREE_RECT_EPS) / orientation.l);
    const rows = Math.floor((freeRectWidth(rect) + FREE_RECT_EPS) / orientation.w);
    if (cols <= 0 || rows <= 0) continue;

    for (let col = 0; col < cols && queue.length; col++) {
      const xMin = loadFrontFirst
        ? rect.maxX - (col + 1) * orientation.l
        : rect.minX + col * orientation.l;
      for (let row = 0; row < rows && queue.length; row++) {
        const zMin = rect.minZ + row * orientation.w;
        const position = {
          x: xMin + orientation.l / 2,
          y: rect.zone.min.y + orientation.h / 2,
          z: zMin + orientation.w / 2,
        };
        const dims = { l: orientation.l, w: orientation.w, h: orientation.h };
        const aabb = getAabb(position, dims);
        if (!isAabbContainedInZone(aabb, rect.zone)) continue;
        if (collidesPacked(aabb, packed)) continue;
        if (!candidateHasRearRetention(aabb, packed, floorState.retentionContext)) continue;

        // Before advancing this repeated grid farther rearward, let the production
        // floor search use every legal orientation. B2C restricts this completion
        // to the same layer; Phase C additionally permits a truly farther-forward
        // raised overhang surface. Repeat because mixed walls can need several items.
        while (queue.length) {
          const completion = findRepeatedForwardWallCompletion(
            queue[0],
            orientation,
            { position, dims, aabb, zone: rect.zone, freeRect: rect },
            floorState,
            packed,
            loadFrontFirst
          );
          if (!completion) break;
          const completionItem = queue.shift();
          const lockedCompletion = { ...completion, lockedGrid: true };
          recordPlacement(output, packed, completionItem, lockedCompletion, 'floor');
          occupyFloorSpace(floorState, lockedCompletion);
        }
        if (!queue.length) break;
        if (collidesPacked(aabb, packed)) continue;
        const item = queue.shift();
        const placement = { position, dims, aabb, zone: rect.zone, freeRect: rect, orientation, lockedGrid: true };
        recordPlacement(output, packed, item, placement, 'floor');
        occupyFloorSpace(floorState, placement);
      }
    }
  }
  return queue;
}

function completeRepeatedGroupFloor(group, preferredOrientation, floorState, packed, output, loadFrontFirst) {
  const unresolved = [];
  for (const item of group) {
    const completionItem = {
      ...item,
      candidates: preferRepeatedOrientation(item, preferredOrientation),
    };
    const placement = findFloorPlacement(completionItem, floorState, packed, loadFrontFirst);
    if (!placement) {
      unresolved.push(item);
      continue;
    }
    recordPlacement(output, packed, item, placement, 'floor');
    occupyFloorSpace(floorState, placement);
  }
  return unresolved;
}

function placeRepeatedFloorBatches(
  items,
  floorState,
  packed,
  output,
  loadFrontFirst,
  layoutQualityEnabled = false
) {
  const remaining = new Set(items || []);
  for (const group of buildRepeatedBatches(items, layoutQualityEnabled)) {
    const activeGroup = group.filter(item => remaining.has(item));
    if (activeGroup.length < REPEATED_BATCH_MIN) continue;
    const orientation = chooseRepeatedBatchOrientation(activeGroup, floorState);
    if (!orientation) continue;
    const gridLeftovers = placeRepeatedBatchFloor(activeGroup, orientation, floorState, packed, output, loadFrontFirst);
    // Phase B2A: finish every legal floor position for this same repeated group
    // before another caseId group can consume the opening. The shelf orientation
    // remains the first preference, while every original policy-approved
    // orientation remains available to complete residual forward strips.
    const notPlaced = completeRepeatedGroupFloor(
      gridLeftovers,
      orientation,
      floorState,
      packed,
      output,
      loadFrontFirst
    );
    const notPlacedSet = new Set(notPlaced);
    for (const item of activeGroup) {
      if (!notPlacedSet.has(item)) remaining.delete(item);
    }
  }
  return [...remaining];
}

function stackRectContains(outer, inner) {
  return Math.abs(outer.yLevel - inner.yLevel) <= FREE_RECT_EPS &&
    outer.minX <= inner.minX + FREE_RECT_EPS &&
    outer.maxX >= inner.maxX - FREE_RECT_EPS &&
    outer.minZ <= inner.minZ + FREE_RECT_EPS &&
    outer.maxZ >= inner.maxZ - FREE_RECT_EPS;
}

function mergeAdjacentStackRects(rects) {
  const merged = normalizeFreeRects(rects);
  let changed = true;
  while (changed) {
    changed = false;
    let mergePair = null;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i];
        const b = merged[j];
        if (Math.abs(a.yLevel - b.yLevel) > FREE_RECT_EPS) continue;
        const sameX = Math.abs(a.minX - b.minX) <= FREE_RECT_EPS &&
          Math.abs(a.maxX - b.maxX) <= FREE_RECT_EPS;
        const sameZ = Math.abs(a.minZ - b.minZ) <= FREE_RECT_EPS &&
          Math.abs(a.maxZ - b.maxZ) <= FREE_RECT_EPS;
        const zAdjacent = sameX &&
          (Math.abs(a.maxZ - b.minZ) <= FREE_RECT_EPS || Math.abs(b.maxZ - a.minZ) <= FREE_RECT_EPS);
        const xAdjacent = sameZ &&
          (Math.abs(a.maxX - b.minX) <= FREE_RECT_EPS || Math.abs(b.maxX - a.minX) <= FREE_RECT_EPS);

        if (!zAdjacent && !xAdjacent) continue;
        mergePair = {
          i,
          j,
          rect: {
            ...a,
            minX: Math.min(a.minX, b.minX),
            maxX: Math.max(a.maxX, b.maxX),
            minZ: Math.min(a.minZ, b.minZ),
            maxZ: Math.max(a.maxZ, b.maxZ),
          },
        };
        break;
      }
      if (mergePair) break;
    }
    if (mergePair) {
      merged.splice(mergePair.j, 1);
      merged.splice(mergePair.i, 1, mergePair.rect);
      changed = true;
    }
  }
  return merged.filter((rect, index) =>
    !merged.some((other, otherIndex) =>
      otherIndex !== index &&
      stackRectContains(other, rect) &&
      freeRectArea(other) >= freeRectArea(rect) - FREE_RECT_EPS
    )
  );
}

export function buildStackLayerFreeRects(packed, yLevel) {
  let rects = [];
  for (const support of packed || []) {
    if (!support?.aabb || Math.abs(support.aabb.max.y - yLevel) > CONTACT_EPS) continue;
    if (!canSupportStack(support) || !hasStackCapacity(support, packed)) continue;
    rects.push({
      id: `stack-layer-${support.instanceId}`,
      zone: null,
      yLevel,
      minX: support.aabb.min.x,
      maxX: support.aabb.max.x,
      minZ: support.aabb.min.z,
      maxZ: support.aabb.max.z,
    });
  }

  rects = mergeAdjacentStackRects(rects);
  for (const placement of packed || []) {
    if (!placement?.aabb || Math.abs(placement.aabb.min.y - yLevel) > CONTACT_EPS) continue;
    rects = rects.flatMap(rect => subtractAabbFromFreeRect(rect, placement.aabb));
    rects = mergeAdjacentStackRects(rects);
  }
  return rects.filter(freeRectHasArea);
}

function buildStackAxisAnchors(rect, orientation, packed, loadFrontFirst, axis) {
  const isX = axis === 'x';
  const min = isX ? rect.minX : rect.minZ;
  const max = isX ? rect.maxX : rect.maxZ;
  const size = isX ? orientation.l : orientation.w;
  const raw = [
    isX && loadFrontFirst ? max - size : min,
    isX && loadFrontFirst ? min : max - size,
    min,
    max - size,
    min + ((max - min) - size) / 2,
  ];

  for (const placement of packed || []) {
    if (!placement?.aabb) continue;
    if (Math.abs(placement.aabb.min.y - rect.yLevel) > CONTACT_EPS &&
        Math.abs(placement.aabb.max.y - rect.yLevel) > CONTACT_EPS) continue;
    const pMin = isX ? placement.aabb.min.x : placement.aabb.min.z;
    const pMax = isX ? placement.aabb.max.x : placement.aabb.max.z;
    raw.push(pMin, pMax, pMin - size, pMax - size);
  }

  const anchors = [];
  for (const value of raw) {
    const clamped = clampAnchor(value, min, max, size);
    if (clamped !== null) anchors.push(clamped);
  }

  const comparator = isX && loadFrontFirst ? (a, b) => b - a : (a, b) => a - b;
  const scoreAnchor = value => {
    if (!isX) {
      return Math.min(Math.abs(value - min), Math.abs((value + size) - max));
    }
    return loadFrontFirst ? Math.abs((value + size) - max) : Math.abs(value - min);
  };
  return capAnchorValues(anchors, anchorCapForPackedCount(packed), scoreAnchor, comparator);
}

function buildStackCandidates(orientation, packed, yLevel, loadFrontFirst) {
  const placements = [];

  for (const rect of buildStackLayerFreeRects(packed, yLevel)) {
    if (orientation.l > freeRectLength(rect) + FREE_RECT_EPS) continue;
    if (orientation.w > freeRectWidth(rect) + FREE_RECT_EPS) continue;
    const xMins = buildStackAxisAnchors(rect, orientation, packed, loadFrontFirst, 'x');
    const zMins = buildStackAxisAnchors(rect, orientation, packed, loadFrontFirst, 'z');

    for (const xMin of xMins) {
      for (const zMin of zMins) {
        const position = {
          x: xMin + orientation.l / 2,
          y: yLevel + orientation.h / 2,
          z: zMin + orientation.w / 2,
        };
        const dims = { l: orientation.l, w: orientation.w, h: orientation.h };
        const aabb = getAabb(position, dims);
        placements.push({ position, dims, aabb, freeRect: rect });
      }
    }
  }

  return placements;
}

function buildWheelWellStackCandidates(orientation, packed, geometry, loadFrontFirst) {
  return buildWheelWellBridgeCandidates(orientation, packed, geometry)
    .map(candidate => {
      const { fraction } = computeWheelWellSupport(candidate.aabb, packed, geometry, null);
      return {
        ...candidate,
        freeRect: null,
        supportFraction: fraction,
        wheelWellCandidate: true,
      };
    })
    .sort((a, b) => {
      const ax = loadFrontFirst ? -a.aabb.max.x : a.aabb.min.x;
      const bx = loadFrontFirst ? -b.aabb.max.x : b.aabb.min.x;
      if (ax !== bx) return ax - bx;
      return a.aabb.min.z - b.aabb.min.z;
    });
}

function candidateHasForwardRetention(aabb, packed, zones, loadFrontFirst) {
  const zoneLimit = loadFrontFirst
    ? Math.max(...(zones || []).map(zone => zone.max.x))
    : Math.min(...(zones || []).map(zone => zone.min.x));
  if (Number.isFinite(zoneLimit)) {
    if (loadFrontFirst && Math.abs(aabb.max.x - zoneLimit) <= CONTACT_EPS) return true;
    if (!loadFrontFirst && Math.abs(aabb.min.x - zoneLimit) <= CONTACT_EPS) return true;
  }

  return (packed || []).some(placement => {
    if (!placement?.aabb) return false;
    const faceContact = loadFrontFirst
      ? Math.abs(placement.aabb.min.x - aabb.max.x) <= CONTACT_EPS
      : Math.abs(aabb.min.x - placement.aabb.max.x) <= CONTACT_EPS;
    return faceContact &&
      intervalsOverlap(aabb.min.y, aabb.max.y, placement.aabb.min.y, placement.aabb.max.y) &&
      intervalsOverlap(aabb.min.z, aabb.max.z, placement.aabb.min.z, placement.aabb.max.z);
  });
}

export function scoreStackCandidate(
  candidate,
  loadFrontFirst,
  groupScore = null,
  supportMatch = null,
  channelMirror = false,
  forwardRetentionPenalty = 0
) {
  const xPrimary = loadFrontFirst ? -candidate.aabb.max.x : candidate.aabb.min.x;
  const yPrimary = candidate.aabb.min.y + forwardRetentionPenalty * FORWARD_RETENTION_Y_PENALTY;
  const wasteArea = candidate.freeRect
    ? Math.max(0, freeRectArea(candidate.freeRect) - candidate.dims.l * candidate.dims.w)
    : 0;
  // Among equally valid candidates on the same stack level (hard rules already
  // filtered upstream: containment, collision, support fraction, support capacity,
  // no-top-load, max direct children, orientation), FRONT position must win before
  // support waste. xPrimary therefore comes ahead of wasteArea so front supports
  // are filled before center/rear ones in front-first modes (incl. Wheel Wells).
  const primary = [
    yPrimary,
    -candidate.supportFraction,
    xPrimary,
  ];
  if (!groupScore) {
    return [
      ...primary,
      wasteArea,
      candidate.aabb.min.z,
    ];
  }
  const orientationMismatch = supportMatch ? supportMatch[0] : 1;
  const columnMismatch = supportMatch ? supportMatch[1] : 1;
  // E2B: inside a narrow wheel-well channel, a layer must FOLLOW the block+filler
  // footprint directly below it. The channel floor is already a clean primary block
  // plus one contiguous alternate-yaw filler strip; greedy stacking otherwise
  // re-packs the supporter surface into a denser-LOOKING but misaligned arrangement
  // (different z-bands per layer) that actually fits FEWER cases per layer. Ranking
  // the support match (same yaw + aligned column as the supporter) directly after
  // [layer, support] — i.e. AHEAD of the front-position key — makes each candidate
  // land squarely on the case below, so every channel layer reproduces the footprint
  // beneath it. For identical cases that footprint was itself front-packed, so this
  // does not sacrifice front density; it only stops the per-layer re-shuffle. Scoped
  // to the channel only, so full-width zones, Standard and the E1 baselines keep the
  // waste-first ordering exactly.
  if (channelMirror) {
    return [
      yPrimary,
      -candidate.supportFraction,
      orientationMismatch,
      columnMismatch,
      xPrimary,
      wasteArea,
      ...groupScore.continuity,
      groupScore.orientationPenalty,
      candidate.aabb.min.z,
    ];
  }
  // E1: after layer/support/front, FREE-RECT WASTE stays the last density-driving
  // key — every layout-quality preference ranks BELOW it, so quality only breaks
  // ties that cost no packing space and the placed count never drops for appearance.
  // Within an equal-waste tie a candidate that follows the layer below wins: same
  // yaw as its supporter (orientationMismatch), then same-case row/block continuity,
  // then an aligned footprint column (columnMismatch). For identical cases both yaw
  // options share one footprint area (equal waste), so the flip is eliminated; an
  // irregular gap that genuinely packs tighter rotated keeps it.
  return [
    ...primary,
    wasteArea,
    orientationMismatch,
    ...groupScore.continuity,
    columnMismatch,
    groupScore.orientationPenalty,
    candidate.aabb.min.z,
  ];
}

function findStackPlacement(
  item,
  zones,
  packed,
  loadFrontFirst,
  layoutQualityEnabled = false,
  retentionContext = null,
  wheelWell = null
) {
  let best = null;
  let bestScore = null;
  // E2B: wheel-well channel stacks must follow the floor block+filler footprint.
  const channelZones = layoutQualityEnabled ? narrowChannelZones(zones) : [];
  const yLevels = uniqueSorted(
    packed
      .filter(placement => canSupportStack(placement) && hasStackCapacity(placement, packed))
      .map(placement => placement.aabb.max.y),
    (a, b) => a - b
  );

  for (const orientation of item.candidates) {
    /** @type {Array<any>} */
    const candidates = [];
    for (const yLevel of yLevels) {
      candidates.push(...buildStackCandidates(orientation, packed, yLevel, loadFrontFirst));
    }
    if (wheelWell) {
      candidates.push(...buildWheelWellStackCandidates(orientation, packed, wheelWell, loadFrontFirst));
    }

    for (const candidate of candidates) {
      const wheelWellCandidate = candidate.wheelWellCandidate === true;
      if (wheelWellCandidate) {
        if (!isAabbWithinTruckMinusBlocked(candidate.aabb, wheelWell)) continue;
        if (!isWheelWellSupportedAndStable(candidate.aabb, packed, wheelWell, item)) continue;
      } else if (!isAabbContainedInAnyZone(candidate.aabb, zones)) {
        continue;
      }
      if (collidesPacked(candidate.aabb, packed)) continue;
      if (!wheelWellCandidate && !supportsCandidate(candidate.aabb, packed, item)) continue;
      if (!candidateHasRearRetention(candidate.aabb, packed, retentionContext)) continue;

      const supports = getCandidateSupports(candidate.aabb, packed)
        .filter(candidateSupport =>
          canSupportStack(candidateSupport) &&
          canSupportCandidateWeight(item, candidateSupport)
      );
      const supportFraction = wheelWellCandidate
        ? candidate.supportFraction
        : computeSupportFraction(candidate.aabb, supports);
      const scoredCandidate = { ...candidate, supportFraction, orientation };
      const groupScore = layoutQualityEnabled
        ? scoreLayoutGroupContinuity(
          candidate.aabb,
          orientation,
          item,
          packed,
          loadFrontFirst,
          true
        )
        : null;
        const supportMatch = layoutQualityEnabled
          ? scoreStackSupportMatch(candidate.aabb, orientation, supports)
          : null;
        const channelMirror = channelZones.length > 0 && aabbInNarrowChannel(candidate.aabb, channelZones);
        const forwardRetentionPenalty =
          wheelWell &&
          candidate.aabb.min.y >= wheelWell.wellHeight - CONTACT_EPS &&
          !candidateHasForwardRetention(candidate.aabb, packed, zones, loadFrontFirst)
            ? 1
            : 0;
        const score = scoreStackCandidate(
          scoredCandidate,
          loadFrontFirst,
          groupScore,
          supportMatch,
          channelMirror,
          forwardRetentionPenalty
        );
        if (!best || compareScore(score, bestScore) < 0) {
          best = scoredCandidate;
          bestScore = score;
        }
    }
  }

  return best;
}

function recordPlacement(output, packed, item, placement, phase) {
  const packedPlacement = {
    instanceId: item.id,
    item,
    pos: placement.position,
    dims: placement.dims,
    aabb: placement.aabb,
    orientation: placement.orientation,
    phase,
    zone: placement.zone || null,
    lockedGrid: placement.lockedGrid === true,
  };
  packed.push(packedPlacement);
  output.placements.set(item.id, placement.position);
  output.rotations.set(item.id, placement.orientation.rotation);
  output.orientedDims.set(item.id, {
    length: placement.dims.l,
    width: placement.dims.w,
    height: placement.dims.h,
  });
  return packedPlacement;
}

function isPlacementOnZoneFloor(aabb, zones) {
  return zones.some(zone =>
    isAabbContainedInZone(aabb, zone) &&
    Math.abs(aabb.min.y - zone.min.y) <= CONTACT_EPS
  );
}

function getPlacementZone(placement, zones) {
  if (placement.zone && isAabbContainedInZone(placement.aabb, placement.zone)) return placement.zone;
  return zones.find(zone => isAabbContainedInZone(placement.aabb, zone)) || null;
}

function candidateCompactionAnchors(placement, others, zone, loadFrontFirst, axis) {
  const isX = axis === 'x';
  const size = isX ? placement.dims.l : placement.dims.w;
  const min = isX ? zone.min.x : zone.min.z;
  const max = isX ? zone.max.x : zone.max.z;
  const raw = [
    min,
    max - size,
    isX && loadFrontFirst ? max - size : min,
  ];

  for (const other of others) {
    if (!other?.aabb) continue;
    if (Math.abs(other.aabb.min.y - placement.aabb.min.y) > CONTACT_EPS) continue;
    const overlapsCrossAxis = isX
      ? intervalsOverlap(placement.aabb.min.z, placement.aabb.max.z, other.aabb.min.z, other.aabb.max.z)
      : intervalsOverlap(placement.aabb.min.x, placement.aabb.max.x, other.aabb.min.x, other.aabb.max.x);
    if (!overlapsCrossAxis) continue;
    const otherMin = isX ? other.aabb.min.x : other.aabb.min.z;
    const otherMax = isX ? other.aabb.max.x : other.aabb.max.z;
    raw.push(otherMin - size, otherMax);
  }

  const anchors = [];
  for (const value of raw) {
    const clamped = clampAnchor(value, min, max, size);
    if (clamped !== null) anchors.push(clamped);
  }

  const comparator = isX && loadFrontFirst ? (a, b) => b - a : (a, b) => a - b;
  return uniqueSorted(anchors, comparator);
}

function scoreCompactionCandidate(
  aabb,
  zone,
  loadFrontFirst,
  others,
  placement = null,
  layoutQualityEnabled = false
) {
  const xPrimary = loadFrontFirst ? -aabb.max.x : aabb.min.x;
  const contactScore = wallContactCount(aabb, zone, loadFrontFirst) + Math.min(8, countFaceContacts(aabb, others));
  const sideDistance = Math.min(
    Math.abs(aabb.min.z - zone.min.z),
    Math.abs(aabb.max.z - zone.max.z)
  );
  if (!layoutQualityEnabled || !placement) {
    return [xPrimary, -contactScore, sideDistance, aabb.min.z];
  }
  const groupScore = scoreLayoutGroupContinuity(
    aabb,
    placement.orientation,
    placement.item,
    others,
    loadFrontFirst,
    true
  );
  return [
    xPrimary,
    ...groupScore.continuity,
    -contactScore,
    sideDistance,
    aabb.min.z,
  ];
}

function compactFloorPlacements(
  output,
  packed,
  zones,
  loadFrontFirst,
  frontSurfaceFirst = false,
  retentionContext = null
) {
  const compactable = packed.filter(placement =>
    !placement.lockedGrid &&
    placement.phase !== 'stack' &&
    isPlacementOnZoneFloor(placement.aabb, zones)
  );
  if (!compactable.length) {
    return rebuildFloorStateFromPacked(zones, packed, frontSurfaceFirst, retentionContext);
  }

  let changed = false;
  const ordered = [...compactable].sort((a, b) => {
    const ax = loadFrontFirst ? -a.aabb.max.x : a.aabb.min.x;
    const bx = loadFrontFirst ? -b.aabb.max.x : b.aabb.min.x;
    if (ax !== bx) return ax - bx;
    return a.aabb.min.z - b.aabb.min.z;
  });

  for (let pass = 0; pass < 2; pass++) {
    for (const placement of ordered) {
      const zone = getPlacementZone(placement, zones);
      if (!zone) continue;
      const others = packed.filter(other => other !== placement);
      const xAnchors = candidateCompactionAnchors(placement, others, zone, loadFrontFirst, 'x');
      const zAnchors = candidateCompactionAnchors(placement, others, zone, loadFrontFirst, 'z');
      let best = null;
      let bestScore = scoreCompactionCandidate(
        placement.aabb,
        zone,
        loadFrontFirst,
        others,
        placement,
        frontSurfaceFirst
      );

      for (const xMin of xAnchors) {
        for (const zMin of zAnchors) {
          const position = {
            x: xMin + placement.dims.l / 2,
            y: placement.pos.y,
            z: zMin + placement.dims.w / 2,
          };
          const aabb = getAabb(position, placement.dims);
          if (!isAabbContainedInZone(aabb, zone)) continue;
          if (collidesPacked(aabb, others)) continue;
          const candidatePlacement = { ...placement, pos: position, aabb, zone };
          if (!placementsHaveRearRetention([...others, candidatePlacement], retentionContext)) continue;
          const score = scoreCompactionCandidate(
            aabb,
            zone,
            loadFrontFirst,
            others,
            placement,
            frontSurfaceFirst
          );
          if (compareScore(score, bestScore) < 0) {
            best = { position, aabb, zone, score };
            bestScore = score;
          }
        }
      }

      if (!best) continue;
      placement.pos = best.position;
      placement.aabb = best.aabb;
      placement.zone = best.zone;
      changed = true;
    }
  }

  if (changed) {
    writeOutputPlacements(output, packed);
  }
  return rebuildFloorStateFromPacked(zones, packed, frontSurfaceFirst, retentionContext);
}

function writeOutputPlacements(output, placements) {
  output.placements.clear();
  output.rotations.clear();
  output.orientedDims.clear();
  for (const placement of placements) {
    output.placements.set(placement.instanceId, placement.pos);
    output.rotations.set(placement.instanceId, placement.orientation?.rotation || { x: 0, y: 0, z: 0 });
    output.orientedDims.set(placement.instanceId, {
      length: placement.dims.l,
      width: placement.dims.w,
      height: placement.dims.h,
    });
  }
}

function stageRejectedPlacements(output, rejected) {
  const unpacked = new Set(output.unpacked);
  for (const { placement, reason } of rejected) {
    unpacked.add(placement.instanceId);
    output.warnings.push(`Item ${placement.instanceId} was staged after validation: ${reason}.`);
  }
  output.unpacked = [...unpacked];
}

function validatePackedPlacements(output, packed, zones) {
  const options = arguments[3] || {};
  const stageRejected = options.stageRejected !== false;
  const retentionContext = options.retentionContext || null;
  // wheelWells geometry (null for every other mode). When present, containment
  // becomes the exact "inside truck box minus blocked well bodies" test and the
  // rigid wheel-well tops are admissible support — strictly ADDITIVE: every
  // single-zone-contained placement still passes exactly as before, only safe
  // bridge/top placements gain acceptance.
  const wheelWell = options.wheelWell || null;
  const accepted = [];
  const rejected = [];

  const validationOrder = retentionContext?.geometry
    ? [...packed].sort((a, b) =>
      a.aabb.min.y - b.aabb.min.y ||
      stableTextCompare(a.instanceId, b.instanceId)
    )
    : packed;
  for (const placement of validationOrder) {
    let reason = '';
    if (wheelWell && aabbIntersectsWheelWellBody(placement.aabb, wheelWell)) {
      reason = 'penetrates the wheel-well body';
    } else if (
      wheelWell
        ? !isAabbWithinTruckMinusBlocked(placement.aabb, wheelWell)
        : !isAabbContainedInAnyZone(placement.aabb, zones)
    ) {
      reason = 'outside usable zones';
    } else if (collidesPacked(placement.aabb, accepted)) {
      reason = 'overlaps another packed item';
    } else if (
      !isPlacementOnZoneFloor(placement.aabb, zones) &&
      !supportsCandidate(placement.aabb, accepted, placement.item) &&
      !(wheelWell && isWheelWellSupportedAndStable(placement.aabb, accepted, wheelWell, placement.item))
    ) {
      reason = 'does not have safe stack support';
    } else if (!candidateHasRearRetention(placement.aabb, accepted, retentionContext)) {
      reason = 'does not have complete rear retention at the overhang step';
    }

    if (reason) {
      rejected.push({ placement, reason });
    } else {
      accepted.push(placement);
    }
  }

  if (!rejected.length) return { accepted, rejected };

  if (stageRejected) {
    writeOutputPlacements(output, accepted);
    stageRejectedPlacements(output, rejected);
  }

  return { accepted, rejected };
}

function rebuildFloorStateFromPacked(
  zones,
  packed,
  frontSurfaceFirst = false,
  retentionContext = null
) {
  const floorState = createFloorState(zones, frontSurfaceFirst, retentionContext);
  for (const placement of packed) {
    if (!isPlacementOnZoneFloor(placement.aabb, zones)) continue;
    occupyFloorSpace(floorState, placement);
  }
  return floorState;
}

function repackRejectedPlacements(
  output,
  accepted,
  rejected,
  zones,
  loadFrontFirst,
  frontSurfaceFirst = false,
  retentionContext = null
) {
  if (!rejected.length) return { packed: accepted, rejected: [] };
  const repacked = [...accepted];
  const floorState = rebuildFloorStateFromPacked(
    zones,
    repacked,
    frontSurfaceFirst,
    retentionContext
  );
  const stillRejected = [];

  writeOutputPlacements(output, repacked);

  const retryTieBreak = createLayoutGroupTieBreaker(
    rejected.map(entry => entry.placement.item),
    frontSurfaceFirst
  );
  const retryQueue = [...rejected].sort((a, b) => {
    const yDelta = a.placement.aabb.min.y - b.placement.aabb.min.y;
    if (yDelta) return yDelta;
    return retryTieBreak(a.placement.item, b.placement.item);
  });

  for (const rejectedPlacement of retryQueue) {
    const item = rejectedPlacement.placement.item;
    const floorPlacement = findFloorPlacement(item, floorState, repacked, loadFrontFirst);
    if (floorPlacement) {
      recordPlacement(output, repacked, item, floorPlacement, 'floor');
      occupyFloorSpace(floorState, floorPlacement);
      continue;
    }

    const stackPlacement = findStackPlacement(
      item,
      zones,
      repacked,
      loadFrontFirst,
      frontSurfaceFirst,
      retentionContext
    );
    if (stackPlacement) {
      recordPlacement(output, repacked, item, stackPlacement, 'stack');
      continue;
    }

    stillRejected.push(rejectedPlacement);
  }

  return { packed: repacked, rejected: stillRejected };
}

function refreshPhaseStats(output, packed) {
  output.phaseStats.laneCount = packed.filter(placement => placement.phase === 'lane').length;
  output.phaseStats.floorCount = packed.filter(placement => placement.phase === 'floor').length;
  output.phaseStats.stackCount = packed.filter(placement => placement.phase === 'stack').length;
  output.phaseStats.fillerCount = packed.filter(placement => placement.phase === 'filler').length;
  output.phaseStats.unpackedCount = output.unpacked.length;
}

function recordRetentionDependencies(output, packed, retentionContext) {
  output.retentionDependencies.clear();
  if (!retentionContext?.geometry) return;
  const all = [...retentionContext.fixedPlacements, ...(packed || [])];
  for (const placement of packed || []) {
    const evaluation = evaluateFrontOverhangRearRetention(
      placement.aabb,
      all.filter(other => other !== placement),
      retentionContext.truck,
      retentionContext.zones
    );
    if (evaluation.required && evaluation.retained) {
      output.retentionDependencies.set(placement.instanceId, evaluation.retainerIds);
    }
  }
}

// ============================================================================
// WHEEL WELLS: physical obstacle / support / contact geometry
//
// The wheel wells are NOT cargo floor, but boxes may safely touch them, sit
// over them, bridge across them, or be laterally restrained by them when
// support and stability rules pass. This block models the wheel wells as real
// physical surfaces computed dynamically from the active truck shapeConfig (no
// hardcoded well dimensions), and validates that placements never penetrate the
// blocked body, receive enough vertical support, and stay stable (centre of
// mass over support). Everything here is gated on wheelWells geometry: for
// Standard / Front Overhang trucks getWheelWellGeometry() returns null and all
// callers fall back to their original behaviour byte-for-byte.
//
// Key invariant used throughout: for a wheelWells truck the union of usable
// zones equals exactly (truck bounding box) MINUS (the two blocked well
// bodies). So "inside the truck box AND not intersecting a blocked body" is an
// exact, provably-correct obstacle-safety test — equivalent to multi-zone
// containment without needing a general union-cover routine.
// ============================================================================
export function getWheelWellGeometry(truck = {}) {
  if (!truck || truck.shapeMode !== 'wheelWells') return null;
  const L = positiveNumber(truck.length, 0);
  const W = positiveNumber(truck.width, 0);
  const H = positiveNumber(truck.height, 0);
  if (!L || !W || !H) return null;

  const cfg =
    truck.shapeConfig && typeof truck.shapeConfig === 'object' && !Array.isArray(truck.shapeConfig)
      ? truck.shapeConfig
      : {};
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const wellHeight = clamp(Number.isFinite(Number(cfg.wellHeight)) ? Number(cfg.wellHeight) : 0.35 * H, 0, H);
  const wellWidth = clamp(Number.isFinite(Number(cfg.wellWidth)) ? Number(cfg.wellWidth) : 0.15 * W, 0, W / 2);
  const wellLength = clamp(Number.isFinite(Number(cfg.wellLength)) ? Number(cfg.wellLength) : 0.35 * L, 0, L);
  const wellOffsetFromRear = clamp(Number.isFinite(Number(cfg.wellOffsetFromRear)) ? Number(cfg.wellOffsetFromRear) : 0.25 * L, 0, L);

  const wx0 = wellOffsetFromRear;
  const wx1 = clamp(wx0 + wellLength, wx0, L);
  const betweenHalfW = Math.max(0, W / 2 - wellWidth);

  // Degenerate wells (no height, no length, or full-width "wells" that leave no
  // shelf) carry no obstacle/support meaning — treat as a plain box.
  if (!(wellHeight > FREE_RECT_EPS) || !(wx1 - wx0 > FREE_RECT_EPS) || !(W / 2 - betweenHalfW > FREE_RECT_EPS)) {
    return null;
  }

  const truckBox = { min: { x: 0, y: 0, z: -W / 2 }, max: { x: L, y: H, z: W / 2 } };
  // Blocked well bodies (cargo must never intersect these).
  const blocked = [
    { min: { x: wx0, y: 0, z: -W / 2 }, max: { x: wx1, y: wellHeight, z: -betweenHalfW } },
    { min: { x: wx0, y: 0, z: betweenHalfW }, max: { x: wx1, y: wellHeight, z: W / 2 } },
  ];
  // Top support rectangles (thin slabs at y = wellHeight): rigid support faces.
  const tops = blocked.map(body => ({
    min: { x: body.min.x, y: wellHeight, z: body.min.z },
    max: { x: body.max.x, y: wellHeight, z: body.max.z },
  }));
  // Inner side faces toward the centre channel (lateral contact/restraint).
  const sides = [
    { min: { x: wx0, y: 0, z: -betweenHalfW }, max: { x: wx1, y: wellHeight, z: -betweenHalfW } },
    { min: { x: wx0, y: 0, z: betweenHalfW }, max: { x: wx1, y: wellHeight, z: betweenHalfW } },
  ];

  return { wx0, wx1, wellHeight, wellWidth, betweenHalfW, truckBox, blocked, tops, sides };
}

// Full-AABB / footprint collision with a blocked well body — never a centre-only
// test, so a box may not be accepted just because its centre clears the well.
export function aabbIntersectsWheelWellBody(aabb, geometry) {
  if (!geometry || !aabb) return false;
  return geometry.blocked.some(body => aabbsOverlap(aabb, body));
}

// Exact obstacle-safe containment for wheelWells: inside the truck box AND not
// intersecting either blocked well body (== contained in the union of usable
// zones). A box resting flush on a well top (bottom y == wellHeight) does NOT
// overlap the body, so direct top support is allowed.
export function isAabbWithinTruckMinusBlocked(aabb, geometry, epsilon = CONTAINMENT_EPS_INCHES) {
  if (!geometry || !aabb) return false;
  const t = geometry.truckBox;
  const withinBox =
    aabb.min.x >= t.min.x - epsilon &&
    aabb.max.x <= t.max.x + epsilon &&
    aabb.min.y >= t.min.y - epsilon &&
    aabb.max.y <= t.max.y + epsilon &&
    aabb.min.z >= t.min.z - epsilon &&
    aabb.max.z <= t.max.z + epsilon;
  return withinBox && !aabbIntersectsWheelWellBody(aabb, geometry);
}

// Count how many wheel-well inner side faces the box is in flush lateral contact
// with (touching the face while overlapping its x/y extent, without penetrating
// the body). Diagnostic / stability tie-breaker only — lateral contact never
// reduces the required vertical support.
export function countWheelWellSideContacts(aabb, geometry) {
  if (!geometry || !aabb) return 0;
  let contacts = 0;
  for (const side of geometry.sides) {
    const xOverlap = aabb.min.x < side.max.x - CONTACT_EPS && aabb.max.x > side.min.x + CONTACT_EPS;
    const yOverlap = aabb.min.y < side.max.y - CONTACT_EPS && aabb.max.y > side.min.y + CONTACT_EPS;
    if (!xOverlap || !yOverlap) continue;
    if (touches(aabb.min.z, side.min.z) || touches(aabb.max.z, side.min.z)) contacts++;
  }
  return contacts;
}

// Compute combined vertical support under a candidate footprint, drawing on both
// packed cargo tops and the rigid wheel-well tops at the candidate bottom level.
// Returns the supported fraction plus whether the centre of mass projects onto
// the supported area extent (tip safety). Packed supports that cannot bear the
// stack (noStackOnTop, at capacity, or too light) contribute no area.
export function computeWheelWellSupport(candidateAabb, packed, geometry, candidateItem = null, tolerance = CONTACT_EPS) {
  const bottom = candidateAabb.min.y;
  const footprint = Math.max(
    1e-9,
    (candidateAabb.max.x - candidateAabb.min.x) * (candidateAabb.max.z - candidateAabb.min.z)
  );
  const overlaps = [];
  let supportArea = 0;

  const consider = supportAabb => {
    if (Math.abs(bottom - supportAabb.max.y) > tolerance) return;
    const ox0 = Math.max(candidateAabb.min.x, supportAabb.min.x);
    const ox1 = Math.min(candidateAabb.max.x, supportAabb.max.x);
    const oz0 = Math.max(candidateAabb.min.z, supportAabb.min.z);
    const oz1 = Math.min(candidateAabb.max.z, supportAabb.max.z);
    const ow = ox1 - ox0;
    const od = oz1 - oz0;
    if (ow <= 0 || od <= 0) return;
    supportArea += ow * od;
    overlaps.push({ minX: ox0, maxX: ox1, minZ: oz0, maxZ: oz1 });
  };

  for (const placement of packed || []) {
    if (!canSupportStack(placement)) continue;
    if (!hasStackCapacity(placement, packed)) continue;
    if (!canSupportCandidateWeight(candidateItem, placement)) continue;
    consider(placement.aabb);
  }
  for (const top of geometry ? geometry.tops : []) {
    consider(top); // rigid surface: always bears weight, like the floor
  }

  const fraction = Math.min(1, supportArea / footprint);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const o of overlaps) {
    if (o.minX < minX) minX = o.minX;
    if (o.maxX > maxX) maxX = o.maxX;
    if (o.minZ < minZ) minZ = o.minZ;
    if (o.maxZ > maxZ) maxZ = o.maxZ;
  }
  const cx = (candidateAabb.min.x + candidateAabb.max.x) / 2;
  const cz = (candidateAabb.min.z + candidateAabb.max.z) / 2;
  const comSupported =
    overlaps.length > 0 &&
    cx >= minX - CONTACT_EPS &&
    cx <= maxX + CONTACT_EPS &&
    cz >= minZ - CONTACT_EPS &&
    cz <= maxZ + CONTACT_EPS;

  // Largest single-side cantilever beyond the supported area, as a fraction of
  // the box extent on that axis. A box flush-supported on all sides reads 0; a
  // beam half hanging over the open channel reads ~0.5.
  const bx = Math.max(1e-9, candidateAabb.max.x - candidateAabb.min.x);
  const bz = Math.max(1e-9, candidateAabb.max.z - candidateAabb.min.z);
  const overhangFraction = overlaps.length > 0
    ? Math.max(
      Math.max(0, minX - candidateAabb.min.x) / bx,
      Math.max(0, candidateAabb.max.x - maxX) / bx,
      Math.max(0, minZ - candidateAabb.min.z) / bz,
      Math.max(0, candidateAabb.max.z - maxZ) / bz
    )
    : 1;

  return { fraction, comSupported, overhangFraction, supportCount: overlaps.length };
}

// A wheel-well-assisted placement is acceptable only when it does not penetrate
// the body, has at least MIN_SUPPORT_FRACTION combined vertical support, and is
// stable (centre of mass over the supported area). Lateral contact alone is
// never enough — a box with no vertical support fails here regardless of how
// many side faces it touches.
export function isWheelWellSupportedAndStable(candidateAabb, packed, geometry, candidateItem = null) {
  if (!geometry || !candidateAabb) return false;
  if (aabbIntersectsWheelWellBody(candidateAabb, geometry)) return false;
  const { fraction, comSupported, overhangFraction } = computeWheelWellSupport(candidateAabb, packed, geometry, candidateItem);
  if (fraction + 1e-9 < MIN_SUPPORT_FRACTION) return false;
  if (!comSupported) return false;
  if (overhangFraction > MAX_WHEELWELL_OVERHANG_FRACTION + 1e-9) return false;
  return true;
}

// Deterministic candidate poses for a box resting on the wheel-well tops
// (bottom flush at y = wellHeight), spanning a well top plus the adjacent
// channel/cargo as support allows.
function buildWheelWellBridgeCandidates(orientation, packed, geometry) {
  const { wx0, wx1, wellHeight, betweenHalfW, truckBox } = geometry;
  const l = orientation.l;
  const w = orientation.w;
  const h = orientation.h;
  if (!(l > 0) || !(w > 0) || !(h > 0)) return [];
  if (wellHeight + h > truckBox.max.y + CONTAINMENT_EPS_INCHES) return [];

  const y = wellHeight + h / 2;
  const W2 = truckBox.max.z;

  const xAnchors = new Set([wx0 + l / 2, wx1 - l / 2]);
  for (let xMin = wx1 - l; xMin >= wx0 - FREE_RECT_EPS; xMin -= l) {
    xAnchors.add(xMin + l / 2);
  }
  for (let xMin = wx0; xMin <= wx1 - l + FREE_RECT_EPS; xMin += l) {
    xAnchors.add(xMin + l / 2);
  }
  const zAnchors = new Set([
    -W2 + w / 2, // left wall-flush
    W2 - w / 2, // right wall-flush
    -betweenHalfW - w / 2, // fully on left well top
    betweenHalfW + w / 2, // fully on right well top
    -betweenHalfW, // straddle left inner edge (bridge over channel)
    betweenHalfW, // straddle right inner edge
  ]);
  for (const placement of packed) {
    if (Math.abs(placement.aabb.max.y - wellHeight) > CONTACT_EPS) continue;
    xAnchors.add(placement.aabb.min.x + l / 2);
    xAnchors.add(placement.aabb.max.x - l / 2);
    zAnchors.add(placement.aabb.min.z + w / 2);
    zAnchors.add(placement.aabb.max.z - w / 2);
  }

  const out = [];
  for (const rawX of xAnchors) {
    const xc = Math.min(Math.max(rawX, wx0 + l / 2), wx1 - l / 2);
    for (const rawZ of zAnchors) {
      const zc = Math.min(Math.max(rawZ, -W2 + w / 2), W2 - w / 2);
      const position = { x: xc, y, z: zc };
      const aabb = getAabb(position, { l, w, h });
      out.push({ position, dims: { l, w, h }, aabb, orientation });
    }
  }
  return out;
}

function scoreWheelWellBridge(candidate, geometry, packed, loadFrontFirst, item) {
  const { fraction } = computeWheelWellSupport(candidate.aabb, packed, geometry, item);
  const lateral = countWheelWellSideContacts(candidate.aabb, geometry) + wallContactCount(candidate.aabb, geometry.truckBox, loadFrontFirst);
  const xKey = loadFrontFirst ? -candidate.aabb.max.x : candidate.aabb.min.x;
  // Lower is better: load front-first, prefer more lateral restraint and more
  // support, then a stable deterministic tie-break on position.
  return [xKey, -lateral, -fraction, candidate.aabb.min.z, candidate.aabb.min.x];
}

function findWheelWellBridgePlacement(item, packed, geometry, loadFrontFirst) {
  let best = null;
  let bestScore = null;
  for (const orientation of item.candidates) {
    for (const candidate of buildWheelWellBridgeCandidates(orientation, packed, geometry)) {
      if (!isAabbWithinTruckMinusBlocked(candidate.aabb, geometry)) continue;
      if (collidesPacked(candidate.aabb, packed)) continue;
      if (!isWheelWellSupportedAndStable(candidate.aabb, packed, geometry, item)) continue;
      const score = scoreWheelWellBridge(candidate, geometry, packed, loadFrontFirst, item);
      if (!best || compareScore(score, bestScore) < 0) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

// Additive wheelWells-only placement pass: give a queue of items a chance to
// rest on the wheel-well tops (alone or bridging onto adjacent supported cargo).
// It never moves or re-scores an already-placed item, so Standard and Front
// Overhang are untouched. Returns the count newly placed.
function placeWheelWellBridges(output, packed, itemsById, geometry, loadFrontFirst) {
  if (!geometry || !geometry.tops.length || !output.unpacked.length) return 0;
  const stillUnpacked = [];
  let placed = 0;
  for (const id of output.unpacked) {
    const item = itemsById.get(id);
    const placement = item ? findWheelWellBridgePlacement(item, packed, geometry, loadFrontFirst) : null;
    if (placement) {
      recordPlacement(output, packed, item, placement, 'stack');
      placed++;
    } else {
      stillUnpacked.push(id);
    }
  }
  output.unpacked = stillUnpacked;
  return placed;
}

// --- Two-step "build-up then bridge" strategy (fixed wheel-well geometry) -----
// The wheel-well top plane (y = wellHeight) is only useful as a bridge surface
// when there is COPLANAR support next to a well top. Bridging a box wider than
// the well top onto the open channel would float or tip, so we must first build
// stable support in the channel up to the plane — but ONLY when the cargo
// dimensions actually allow a whole number of layers to land exactly on the
// plane. We never resize the wells and never fake support: if no orientation
// tiles the well height, the build-up is skipped and bridging simply does not
// happen for those boxes.

const WELL_PLANE_EPS = CONTACT_EPS;

// Pick a single deterministic "riser" orientation whose height divides the
// fixed well height into k exact layers and whose footprint fits the channel.
// Larger footprint first (fills the channel faster), then fewer layers, then a
// stable dims tie-break. Returns null when nothing tiles the plane.
export function planWheelWellRiser(unpackedIds, itemsById, geometry) {
  const { wellHeight, wx0, wx1, betweenHalfW } = geometry;
  const channelLen = wx1 - wx0;
  const channelWid = 2 * betweenHalfW;
  const options = [];
  const seen = new Set();
  for (const id of unpackedIds) {
    const item = itemsById.get(id);
    if (!item) continue;
    for (const o of item.candidates) {
      if (!(o.h > 0) || !(o.l > 0) || !(o.w > 0)) continue;
      const k = Math.round(wellHeight / o.h);
      if (k < 1 || Math.abs(k * o.h - wellHeight) > WELL_PLANE_EPS) continue;
      if (o.l > channelLen + FREE_RECT_EPS || o.w > channelWid + FREE_RECT_EPS) continue;
      const key = `${o.l.toFixed(4)}x${o.w.toFixed(4)}x${o.h.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ l: o.l, w: o.w, h: o.h, k });
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => (b.l * b.w) - (a.l * a.w) || a.k - b.k || b.h - a.h || a.l - b.l || a.w - b.w);
  return options[0];
}

function findItemOrientation(item, l, w, h) {
  return (item.candidates || []).find(o =>
    Math.abs(o.l - l) < 1e-6 && Math.abs(o.w - w) < 1e-6 && Math.abs(o.h - h) < 1e-6) || null;
}

// Fill EMPTY channel columns with full riser stacks that reach the plane exactly.
// A column is committed only if every one of its k layers is body-safe, in
// bounds, and collision-free against everything already packed (including
// main-loop channel cargo) — otherwise the column is skipped, so we never
// half-build a stack whose top falls short of the plane. Layer j rests on the
// floor (j=0) or fully on the layer below, so support is exact by construction.
export function buildChannelRisersToPlane(output, packed, itemsById, geometry, riser) {
  const { wx0, wx1, betweenHalfW } = geometry;
  const minZ = -betweenHalfW;
  const maxZ = betweenHalfW;
  const { l, w, h, k } = riser;
  if (!(l > 0) || !(w > 0) || !(h > 0) || k < 1) return 0;

  const pool = [];
  for (const id of output.unpacked) {
    const item = itemsById.get(id);
    const orientation = item ? findItemOrientation(item, l, w, h) : null;
    if (orientation) pool.push({ id, item, orientation });
  }
  if (pool.length < k) return 0; // not even one full column can reach the plane

  let cursor = 0;
  let placed = 0;
  const placedIds = new Set();
  for (let xc = wx0 + l / 2; xc <= wx1 - l / 2 + FREE_RECT_EPS; xc += l) {
    for (let zc = minZ + w / 2; zc <= maxZ - w / 2 + FREE_RECT_EPS; zc += w) {
      if (pool.length - cursor < k) break; // no items left to complete a column
      const columnAabbs = [];
      let ok = true;
      for (let j = 0; j < k; j++) {
        const y = h * j + h / 2;
        const aabb = getAabb({ x: xc, y, z: zc }, { l, w, h });
        if (!isAabbWithinTruckMinusBlocked(aabb, geometry) || collidesPacked(aabb, packed)) { ok = false; break; }
        columnAabbs.push(aabb);
      }
      if (!ok) continue;
      for (let j = 0; j < k; j++) {
        const { id, item, orientation } = pool[cursor++];
        recordPlacement(output, packed, item, {
          position: { x: xc, y: h * j + h / 2, z: zc }, dims: { l, w, h }, aabb: columnAabbs[j], orientation,
        }, 'floor');
        placedIds.add(id);
        placed++;
      }
    }
  }
  if (placed) output.unpacked = output.unpacked.filter(id => !placedIds.has(id));
  return placed;
}

// Two-step wheel-well strategy: (1) build coplanar channel support up to the
// fixed well-top plane when cargo dimensions allow, then (2) place safe
// bridge/contact placements that draw combined support from the well tops plus
// that freshly-built (or pre-existing) coplanar cargo. Every placement still
// passes the same support/stability gate; step 2 is exactly the existing bridge
// pass, now with real coplanar support to lean on.
function placeWheelWellBuildUpBridges(output, packed, itemsById, geometry, loadFrontFirst) {
  if (!geometry || !geometry.tops.length || !output.unpacked.length) return 0;
  let placed = 0;
  const riser = planWheelWellRiser(output.unpacked, itemsById, geometry);
  if (riser) placed += buildChannelRisersToPlane(output, packed, itemsById, geometry, riser);
  placed += placeWheelWellBridges(output, packed, itemsById, geometry, loadFrontFirst);
  return placed;
}

function shouldRunPreStackWheelWellBridge(geometry, items) {
  if (!geometry || !geometry.tops.length || !items || !items.length) return false;
  const wellSpan = geometry.wx1 - geometry.wx0;
  const minLength = Math.min(
    ...items.flatMap(item => (item.candidates || []).map(candidate => candidate.l).filter(l => l > 0))
  );
  return Number.isFinite(minLength) && wellSpan >= minLength * 4;
}

export function solveAutoPack(input = {}) {
  const truck = normalizeTruck(input.truck || {});
  const zones = normalizeZones(input.zones || []);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const output = makeEmptyOutput();
  if (!rawItems.length) return output;

  const items = rawItems.map(normalizeItem);
  const loadFrontFirst = input.loadFrontFirst === true || input.loadDirection === 'front_to_rear';
  const floorZones = sortZonesForFloor(zones, loadFrontFirst);
  // Phase C: only a raised usable surface extending beyond the truck's main
  // high-X boundary changes floor/deck priority. Wheel-well raised zones remain
  // inside truck.length, so Standard and Wheel Wells retain byte-identical scores.
  const frontSurfaceFirst = loadFrontFirst && floorZones.some(zone =>
    zone.min.y > CONTACT_EPS && zone.max.x > truck.length + FREE_RECT_EPS
  );
  // E1: same-case layout-quality scoring (consistent yaw, contiguous rows, broad
  // stacked blocks that follow the layer below) is INDEPENDENT of frontSurfaceFirst
  // (which stays only for true high-+X raised-surface ordering). Default ON for
  // every truck mode — Standard, Wheel Wells and Front Overhang — so it no longer
  // rides on the Front Overhang-only flag. Hard validity is still filtered first.
  const layoutQualityEnabled = input.layoutQuality !== false;
  const retentionContext = createRetentionContext(
    input.truck || {},
    floorZones,
    input.retentionPlacements
  );
  const floorState = createFloorState(floorZones, frontSurfaceFirst, retentionContext);
  const packed = [];

  if (!truck.length || !truck.width || !truck.height || !floorZones.length) {
    output.unpacked = items.map(item => item.id);
    output.warnings.push('AutoPack floor solver skipped: missing truck dimensions or usable zones.');
    output.phaseStats.unpackedCount = output.unpacked.length;
    return output;
  }

  const deferred = [];
  // E2A scope: layout quality now also drives the ORDINARY/leftover/filler floor and
  // lane SCORERS (the audited defect — these gated continuity behind the Front
  // Overhang-only frontSurfaceFirst flag) via the explicit `layoutQualityEnabled`
  // option below. The repeated-batch shelf grid, the B2C forward-wall completion,
  // floor compaction and the validation repack are DELIBERATELY left on the
  // no-quality path: they already produce a clean single-majority-orientation grid
  // with legal alternate-yaw residual completion, and forcing the anti-yaw-mix
  // preference there would fight that proven behavior. The repeated-grid layer/block
  // builder is E2B. E1's stacking-phase quality (layoutQualityEnabled) is unchanged.
  const laneItems = sortItemsForLane(
    items.filter(item => item.className === 'LANE_ITEM'),
    frontSurfaceFirst,
    items
  );
  const nonLaneItems = items.filter(item => item.className !== 'LANE_ITEM');
  let laneCount = 0;
  let floorCount = 0;
  let fillerCount = 0;

  for (const item of laneItems) {
    const placement = findLanePlacement(item, floorState, packed, loadFrontFirst, layoutQualityEnabled);
    if (!placement) {
      item.lanePlacementFailed = true;
      deferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'lane');
    occupyFloorSpace(floorState, placement);
    laneCount++;
  }

  const remainingNonLaneItems = placeRepeatedFloorBatches(
    nonLaneItems,
    floorState,
    packed,
    output,
    loadFrontFirst,
    frontSurfaceFirst
  );
  const mainFloorItems = sortItemsForFloor(
    remainingNonLaneItems.filter(item => item.className !== 'FILLER'),
    frontSurfaceFirst,
    items
  );
  const fillerItems = remainingNonLaneItems.filter(item => item.className === 'FILLER');

  for (const item of mainFloorItems) {
    const placement = findFloorPlacement(item, floorState, packed, loadFrontFirst, { layoutQualityEnabled });
    if (!placement) {
      deferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'floor');
    occupyFloorSpace(floorState, placement);
    floorCount++;
  }

  floorState.freeRects = compactFloorPlacements(
    output,
    packed,
    floorZones,
    loadFrontFirst,
    frontSurfaceFirst,
    retentionContext
  ).freeRects;

  const fillerQueue = [
    ...sortItemsForFloor(deferred, frontSurfaceFirst, items),
    ...sortItemsForFiller(fillerItems, frontSurfaceFirst, items),
  ];
  const stackDeferred = [];
  for (const item of fillerQueue) {
    const placement = findFloorPlacement(item, floorState, packed, loadFrontFirst, { layoutQualityEnabled });
    if (!placement) {
      stackDeferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'filler');
    occupyFloorSpace(floorState, placement);
    fillerCount++;
  }

  floorState.freeRects = compactFloorPlacements(
    output,
    packed,
    floorZones,
    loadFrontFirst,
    frontSurfaceFirst,
    retentionContext
  ).freeRects;

  // Wheel Wells physical geometry (null for every other truck mode). The opt-in
  // pre-stack pass runs only after floor/filler has created real lower support.
  // That keeps the gravity/Tetris rule (no top-first well loading) while letting
  // safe well-top opportunities close the wheel-well span before ordinary stacks
  // grow into avoidable rear/upper blocks.
  const wheelWell = getWheelWellGeometry(input.truck || {});
  const itemsById = new Map(items.map(it => [it.id, it]));
  let stackQueue = sortItemsForStack(stackDeferred, layoutQualityEnabled, items);
  let stackCount = 0;
  if (
    wheelWell &&
    input.enableWheelWellBridge === true &&
    stackQueue.length &&
    shouldRunPreStackWheelWellBridge(wheelWell, stackQueue)
  ) {
    const previousUnpacked = output.unpacked;
    output.unpacked = stackQueue.map(item => item.id);
    placeWheelWellBuildUpBridges(output, packed, itemsById, wheelWell, loadFrontFirst);
    const stillUnpacked = new Set(output.unpacked);
    stackQueue = stackQueue.filter(item => stillUnpacked.has(item.id));
    output.unpacked = previousUnpacked;
  }

  for (const item of stackQueue) {
    const placement = findStackPlacement(
      item,
      floorZones,
      packed,
      loadFrontFirst,
      layoutQualityEnabled,
      retentionContext,
      input.enableWheelWellBridge === true ? wheelWell : null
    );
    if (!placement) {
      output.unpacked.push(item.id);
      if (item.lanePlacementFailed) {
        output.warnings.push(`Lane item ${item.id} could not fit in a safe lengthwise lane or any fallback floor/stack position.`);
      } else {
        output.warnings.push(`Item ${item.id} could not fit on the floor or on a safe supported stack.`);
      }
      continue;
    }

    recordPlacement(output, packed, item, placement, 'stack');
    stackCount++;
  }

  // Carry wheel-well geometry into validation as defence in depth. The remaining
  // opt-in pass is a final leftover sweep; production Wheel Wells now also runs
  // the same safe well-top logic before ordinary stacking so front/middle support
  // opportunities are not starved by rear stack placements.
  if (wheelWell && input.enableWheelWellBridge === true) {
    stackCount += placeWheelWellBuildUpBridges(output, packed, itemsById, wheelWell, loadFrontFirst);
  }

  const initialValidation = validatePackedPlacements(output, packed, floorZones, {
    stageRejected: false,
    retentionContext,
    wheelWell,
  });
  const repackedValidation = repackRejectedPlacements(
    output,
    initialValidation.accepted,
    initialValidation.rejected,
    floorZones,
    loadFrontFirst,
    frontSurfaceFirst,
    retentionContext
  );
  const finalValidation = validatePackedPlacements(output, repackedValidation.packed, floorZones, {
    stageRejected: false,
    retentionContext,
    wheelWell,
  });
  if (finalValidation.rejected.length || repackedValidation.rejected.length) {
    const staged = new Map();
    for (const rejected of [...repackedValidation.rejected, ...finalValidation.rejected]) {
      staged.set(rejected.placement.instanceId, rejected);
    }
    stageRejectedPlacements(output, [...staged.values()]);
    writeOutputPlacements(output, finalValidation.accepted);
  }

  if (finalValidation.accepted.length !== packed.length) {
    packed.length = 0;
    packed.push(...finalValidation.accepted);
  }

  output.phaseStats.laneCount = laneCount;
  output.phaseStats.floorCount = floorCount;
  output.phaseStats.stackCount = stackCount;
  output.phaseStats.fillerCount = fillerCount;
  output.phaseStats.unpackedCount = output.unpacked.length;
  refreshPhaseStats(output, packed);
  recordRetentionDependencies(output, packed, retentionContext);
  return output;
}
