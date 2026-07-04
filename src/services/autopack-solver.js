import {
  evaluateFrontOverhangRearRetention,
  getFrontOverhangRetentionGeometry,
} from './pack-library.js';
// Hard-rule predicates and tolerances come from the single validation authority
// (packing-core/validation.js) so AutoPack and manual revalidation can never
// silently diverge. Imported directly (not via packing-core/index.js) to keep
// the module graph cycle-free.
import {
  CONTAINMENT_EPS_INCHES,
  aabbsOverlap,
  computeXzOverlapArea,
  isAabbContainedInZone,
  isAabbContainedInAnyZone,
  rulesAllowStackOnTop,
  canSupportCandidateWeight,
  hasStackCapacity,
  getMaxStackCount,
} from '../packing-core/validation.js';
// The wheel-well physical model lives in packing-core so the manual pipeline
// (pack-library reconciliation/repair) applies the exact same body/top/support
// rules as the solver. Re-exported below so existing consumers keep working.
import {
  getWheelWellGeometry,
  aabbIntersectsWheelWellBody,
  isAabbWithinTruckMinusBlocked,
  countWheelWellSideContacts,
  computeWheelWellSupport,
  isWheelWellSupportedAndStable,
} from '../packing-core/wheel-well-model.js';

export {
  getWheelWellGeometry,
  aabbIntersectsWheelWellBody,
  isAabbWithinTruckMinusBlocked,
  countWheelWellSideContacts,
  computeWheelWellSupport,
  isWheelWellSupportedAndStable,
};
import {
  REJECTION_CODES,
  makeRejectionReason,
  rejectionCodeForValidationReason,
  summarizeSolveStatus,
} from '../packing-core/explain.js';
import { createSolveBudget } from '../packing-core/budget.js';
import { computeDeckRetentionCoverage } from '../packing-core/retention-model.js';
import { canonicalOrientationLock } from '../core/orientation.js';
import { canonicalCargoForStorage } from '../core/cargo-canonical.js';

export { aabbsOverlap, computeXzOverlapArea, isAabbContainedInAnyZone };
import {
  RIGHT_ANGLE_RAD,
  normalizeRightAngleRotation,
  rotateVectorXYZ,
  getOrientedDimsForRotation as getOrientedDimsForRotationCanonical,
} from '../core/oriented-dims.js';

const LONG_RATIO = 4;
const LONG_MIN_IN = 96;
const HEAVY_LBS = 150;
const FILLER_IN3 = 6000;
const MIN_SUPPORT_FRACTION = 0.5;
const MAX_DEFAULT_FRONT_COMPRESSION_PLACEMENTS = 500;
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

  // ROTATE vs FLIP product contract:
  // - Rotating (footprint yaw: length/width swap, height axis unchanged) is
  //   ALWAYS available when the orientation policy allows the face — it never
  //   requires "Allow flipping". Both upright yaws are generated for
  //   'any'/'upright', and BOTH footprint yaws of every side face are
  //   generated for 'onSide'.
  // - Flipping/tipping (resting on another face, vertical height changes) is
  //   generated only when the policy permits it: canFlip under 'any', or the
  //   'onSide' policy itself. Scoring chooses among candidates, so a tipped
  //   pose is used only when it genuinely fits/scores better.
  if (lock === 'upright' || lock === 'any') {
    add(0, 0, 0);
    add(0, RIGHT_ANGLE_RAD, 0);
  }

  if (lock === 'onSide') {
    // Physical uprightness test: raw euler components can COMPOSE back to an
    // upright pose (e.g. X90+Y90 keeps the height axis vertical), so onSide
    // candidates are filtered by where the rotation actually sends the case's
    // own height axis — never by the euler components alone.
    const addSide = (x, y, z) => {
      const heightAxis = rotateVectorXYZ({ x: 0, y: 1, z: 0 }, normalizeRightAngleRotation({ x, y, z }));
      if (Math.abs(Math.abs(heightAxis.y) - 1) < 1e-9) return;
      add(x, y, z);
    };
    addSide(0, 0, RIGHT_ANGLE_RAD);
    addSide(RIGHT_ANGLE_RAD, 0, RIGHT_ANGLE_RAD);
    // Footprint yaw variants of the side faces: a case lying on its side may
    // still be rotated on the floor. Appended after the historical two so the
    // dims-dedupe keeps existing rotations for already-covered triples.
    addSide(0, RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD);
    addSide(RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD);
    addSide(RIGHT_ANGLE_RAD, 0, 0);
    addSide(RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD, 0);
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
    // Complete the side-face yaw coverage (all 6 distinct face×yaw triples of
    // a box). Appended last: pure dedupe no-ops for triples already covered.
    add(0, RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD);
    add(RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD);
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
  return rulesAllowStackOnTop(getPlacementRules(placement));
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
    rejectionReasons: [],
    solveStatus: { complete: true, unpackedCount: 0, partialCauses: [] },
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

function getCandidateSupports(candidateAabb, packed, tolerance = 0.05) {
  const bottom = candidateAabb.min.y;
  return packed.filter(placement =>
    Math.abs(bottom - placement.aabb.max.y) <= tolerance &&
    computeXzOverlapArea(candidateAabb, placement.aabb) > 0.05
  );
}

function supportsCandidate(candidateAabb, packed, candidateItem = null, capacityCache = null) {
  const supports = getCandidateSupports(candidateAabb, packed);
  if (!supports.length) return false;
  if (supports.some(support =>
    !canSupportStack(support) ||
    !(capacityCache ? capacityCache.hasCapacity(support) : hasStackCapacity(support, packed))
  )) return false;
  if (supports.some(support => !canSupportCandidateWeight(candidateItem, support))) return false;
  return computeSupportFraction(candidateAabb, supports) >= MIN_SUPPORT_FRACTION;
}

/**
 * Per-call stack-capacity cache. Direct-child counting scans the whole packed
 * list per support (O(n) each, O(n²)+ across a findStackPlacement call). The
 * packed list does not change WITHIN one placement search, so bucket the
 * placements by bottom level once and memoize counts per support. Exact same
 * tolerance and overlap rules as validation.countDirectStackChildren.
 */
function createStackCapacityCache(packed) {
  const tolerance = CONTACT_EPS;
  const bucketOf = value => Math.round(value / tolerance);
  const byBottom = new Map();
  for (const placement of packed) {
    const key = bucketOf(placement.aabb.min.y);
    let bucket = byBottom.get(key);
    if (!bucket) byBottom.set(key, bucket = []);
    bucket.push(placement);
  }
  const counts = new Map();
  const countChildren = support => {
    let count = counts.get(support);
    if (count !== undefined) return count;
    const top = support.aabb.max.y;
    const topBucket = bucketOf(top);
    count = 0;
    for (let key = topBucket - 1; key <= topBucket + 1; key++) {
      for (const child of byBottom.get(key) || []) {
        if (child === support) continue;
        if (Math.abs(child.aabb.min.y - top) > tolerance) continue;
        if (computeXzOverlapArea(child.aabb, support.aabb) <= 0.05) continue;
        count++;
      }
    }
    counts.set(support, count);
    return count;
  };
  return {
    hasCapacity(placement) {
      const maxStackCount = getMaxStackCount(placement);
      return !maxStackCount || countChildren(placement) < maxStackCount;
    },
  };
}

function normalizeItem(item = {}, index = 0) {
  const source = { ...item, ...canonicalCargoForStorage(item) };
  const dims = readDims(source.dims || source.dimensions || source.orientedDims);
  const id = source.instanceId || source.id || `autopack-item-${index}`;
  const candidates = buildOrientationCandidates(dims, source)
    .filter(candidate => candidate.l > 0 && candidate.w > 0 && candidate.h > 0)
    .sort((a, b) => {
      const footprintDelta = (b.l * b.w) - (a.l * a.w);
      if (footprintDelta) return footprintDelta;
      const heightDelta = b.h - a.h;
      if (heightDelta) return heightDelta;
      return b.l - a.l;
    });
  const classificationDims = source.orientationLocked === true && candidates[0]
    ? { l: candidates[0].l, w: candidates[0].w, h: candidates[0].h }
    : dims;

  return {
    id,
    item: source,
    dims,
    candidates,
    volume: dims.l * dims.w * dims.h,
    footprint: dims.l * dims.w,
    weight: finiteNumber(source.weight, 0),
    index,
    className: classifyAutoPackItem({ ...source, classificationDims }),
  };
}

function normalizedItemFrom(value = {}) {
  if (Array.isArray(value.candidates)) return value;
  if (value.item && Array.isArray(value.item.candidates)) return value.item;
  return null;
}

// Group keys are pure functions of fields that never change after item
// normalization, and layout-quality scoring recomputes them for EVERY packed
// placement per candidate — a hot string-building loop on large loads.
// Memoized per normalized-item identity.
const layoutGroupKeyCache = new WeakMap();

function layoutGroupKey(value = {}) {
  const normalized = normalizedItemFrom(value);
  if (normalized) {
    const cached = layoutGroupKeyCache.get(normalized);
    if (cached !== undefined) return cached;
  }
  const source = normalized ? normalized.item : (value.item || value);
  const dims = normalized ? normalized.dims : readDims(source?.dims || source?.dimensions);
  const key = [
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
  if (normalized) layoutGroupKeyCache.set(normalized, key);
  return key;
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

function baseSupportRank(item = {}) {
  return canSupportStack({ item }) ? 0 : 1;
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
    const supportDelta = baseSupportRank(a) - baseSupportRank(b);
    if (supportDelta) return supportDelta;
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
    const supportDelta = baseSupportRank(a) - baseSupportRank(b);
    if (supportDelta) return supportDelta;
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
    const supportDelta = baseSupportRank(a) - baseSupportRank(b);
    if (supportDelta) return supportDelta;
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

// Per-solve group index: layout-quality scoring needs "all packed placements
// of this item's group" for EVERY candidate — filtering the whole packed list
// each time was an O(n)-per-candidate hot loop. The index is rebuilt only when
// the placement array identity or length changes (placements are appended,
// never removed, during search phases; compaction moves placements in place,
// which does not change group membership).
let groupIndexState = { packed: null, length: -1, map: null };

function groupPlacementsFor(packed, groupKey) {
  const list = packed || [];
  if (groupIndexState.packed !== list || groupIndexState.length !== list.length) {
    const map = new Map();
    for (const placement of list) {
      const key = layoutGroupKey(placement);
      let group = map.get(key);
      if (!group) map.set(key, group = []);
      group.push(placement);
    }
    groupIndexState = { packed: list, length: list.length, map };
  }
  return groupIndexState.map.get(groupKey) || [];
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
  const matches = groupPlacementsFor(packed, groupKey);
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
  // Front Overhang keeps the richer continuity branch and lets a retained
  // forward deck surface compete on front position once the hard retention gate
  // has passed.
  if (frontSurfaceFirst) {
    return [
      ...scoreFloorSurface(candidate.aabb, loadFrontFirst, true),
      ...groupScore.continuity,
      groupScore.orientationPenalty,
      groupScore.surfaceOrientationPenalty,
      -contactScore,
      Math.min(leftoverX, leftoverZ),
      wasteArea,
      leftoverZ,
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
  // Phase B keeps lane length and the lowest layer ahead of high-X. Front Overhang
  // moves the shared raised-surface score ahead of lane length so a retained
  // forward deck candidate can win when it is physically legal.
  const surfaceScore = scoreFloorSurface(candidate.aabb, loadFrontFirst, frontSurfaceFirst);
  const groupScore = scoreLayoutGroupContinuity(
    candidate.aabb,
    orientation,
    item,
    packed,
    loadFrontFirst,
    frontSurfaceFirst || layoutQualityEnabled
  );
  // Front Overhang keeps this branch for continuity scoring, with raised-surface
  // ordering supplied by scoreFloorSurface().
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
      const supportDelta = baseSupportRank(a[0]) - baseSupportRank(b[0]);
      if (supportDelta) return supportDelta;
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

function placeRepeatedBatchFloor(group, orientation, floorState, packed, output, loadFrontFirst, budget = null) {
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
    if (budget && budget.expired()) break;
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
  layoutQualityEnabled = false,
  budget = null
) {
  const remaining = new Set(items || []);
  for (const group of buildRepeatedBatches(items, layoutQualityEnabled)) {
    // Remaining groups flow to the ordinary floor loop, which stages them with
    // an honest budget reason if the main budget is spent.
    if (budget && budget.expired()) break;
    const activeGroup = group.filter(item => remaining.has(item));
    if (activeGroup.length < REPEATED_BATCH_MIN) continue;
    const orientation = chooseRepeatedBatchOrientation(activeGroup, floorState);
    if (!orientation) continue;
    const gridLeftovers = placeRepeatedBatchFloor(activeGroup, orientation, floorState, packed, output, loadFrontFirst, budget);
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

export function buildStackLayerFreeRects(packed, yLevel, capacityCache = null) {
  let rects = [];
  for (const support of packed || []) {
    if (!support?.aabb || Math.abs(support.aabb.max.y - yLevel) > CONTACT_EPS) continue;
    if (!canSupportStack(support)) continue;
    if (!(capacityCache ? capacityCache.hasCapacity(support) : hasStackCapacity(support, packed))) continue;
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

function buildStackCandidates(orientation, packed, yLevel, loadFrontFirst, layerRects = null) {
  const placements = [];

  for (const rect of layerRects || buildStackLayerFreeRects(packed, yLevel)) {
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
  wheelWell = null,
  budget = null
) {
  let best = null;
  let bestScore = null;
  // E2B: wheel-well channel stacks must follow the floor block+filler footprint.
  const channelZones = layoutQualityEnabled ? narrowChannelZones(zones) : [];
  // Capacity answers are stable within one placement search — memoize them so
  // the yLevel filter and per-candidate support checks stop rescanning packed.
  const capacityCache = createStackCapacityCache(packed);
  const yLevels = uniqueSorted(
    packed
      .filter(placement => canSupportStack(placement) && capacityCache.hasCapacity(placement))
      .map(placement => placement.aabb.max.y),
    (a, b) => a - b
  );

  // The free-rect layer decomposition is identical for every orientation of the
  // same item — compute it once per level (instead of per orientation × level).
  // This removes the dominant repeated cost of large-load stacking.
  const layerRectsByLevel = new Map();
  const layerRectsFor = yLevel => {
    let rects = layerRectsByLevel.get(yLevel);
    if (!rects) {
      rects = buildStackLayerFreeRects(packed, yLevel, capacityCache);
      layerRectsByLevel.set(yLevel, rects);
    }
    return rects;
  };

  for (const orientation of item.candidates) {
    // One expensive item must not burn past the hard cleanup deadline.
    if (budget && budget.cleanupExpired()) break;
    /** @type {Array<any>} */
    const candidates = [];
    for (const yLevel of yLevels) {
      candidates.push(...buildStackCandidates(orientation, packed, yLevel, loadFrontFirst, layerRectsFor(yLevel)));
    }
    if (wheelWell) {
      candidates.push(...buildWheelWellStackCandidates(orientation, packed, wheelWell, loadFrontFirst));
    }

    for (const candidate of candidates) {
      const wheelWellCandidate = candidate.wheelWellCandidate === true;
      const containedInUsableZone = isAabbContainedInAnyZone(candidate.aabb, zones);
      if (wheelWellCandidate) {
        if (!isAabbWithinTruckMinusBlocked(candidate.aabb, wheelWell)) continue;
        if (!isWheelWellSupportedAndStable(candidate.aabb, packed, wheelWell, item)) continue;
      } else if (!containedInUsableZone) {
        if (!wheelWell || !isAabbWithinTruckMinusBlocked(candidate.aabb, wheelWell)) continue;
        if (!isWheelWellSupportedAndStable(candidate.aabb, packed, wheelWell, item)) continue;
      }
      if (!wheelWellCandidate && containedInUsableZone && !supportsCandidate(candidate.aabb, packed, item, capacityCache)) {
        continue;
      }
      if (collidesPacked(candidate.aabb, packed)) continue;
      if (!candidateHasRearRetention(candidate.aabb, packed, retentionContext)) continue;

      const supports = getCandidateSupports(candidate.aabb, packed)
        .filter(candidateSupport =>
          canSupportStack(candidateSupport) &&
          canSupportCandidateWeight(item, candidateSupport)
      );
      const supportFraction = wheelWellCandidate
        ? candidate.supportFraction
        : (!containedInUsableZone && wheelWell)
          ? computeWheelWellSupport(candidate.aabb, packed, wheelWell, item).fraction
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

function stackBatchBudgetExpired(budget, useCleanupBudget = false) {
  if (!budget) return false;
  return useCleanupBudget ? budget.cleanupExpired() : budget.expired();
}

function scoreRepeatedStackOrientation(orientation, layerRects, groupSize = 0) {
  let capacity = 0;
  let bestRows = 0;
  let bestCols = 0;
  let wastedWidth = 0;
  let wastedLength = 0;

  for (const rect of layerRects || []) {
    const cols = Math.floor((freeRectLength(rect) + FREE_RECT_EPS) / orientation.l);
    const rows = Math.floor((freeRectWidth(rect) + FREE_RECT_EPS) / orientation.w);
    if (cols <= 0 || rows <= 0) continue;
    capacity += cols * rows;
    bestRows = Math.max(bestRows, rows);
    bestCols = Math.max(bestCols, cols);
    wastedWidth += freeRectWidth(rect) - rows * orientation.w;
    wastedLength += freeRectLength(rect) - cols * orientation.l;
  }

  return [
    capacity > 0 ? 0 : 1,
    groupSize > 0 && capacity >= groupSize ? 0 : 1,
    -capacity,
    orientation.h,
    wastedWidth,
    wastedLength,
    -bestRows,
    -bestCols,
  ];
}

function rankedRepeatedStackOrientations(group, layerRects) {
  const first = group && group[0];
  if (!first || !first.candidates.length) return [];
  return first.candidates
    .map((orientation, orderIndex) => ({
      orientation,
      score: [
        ...scoreRepeatedStackOrientation(orientation, layerRects, group.length),
        orderIndex,
      ],
    }))
    .filter(entry => entry.score[0] === 0)
    .sort((a, b) => compareScore(a.score, b.score))
    .map(entry => entry.orientation);
}

function stackBatchLayerLevels(packed) {
  const capacityCache = createStackCapacityCache(packed);
  return uniqueSorted(
    packed
      .filter(placement => canSupportStack(placement) && capacityCache.hasCapacity(placement))
      .map(placement => placement.aabb.max.y),
    (a, b) => a - b
  );
}

function stackBatchCellMins(rect, orientation, loadFrontFirst) {
  const cols = Math.floor((freeRectLength(rect) + FREE_RECT_EPS) / orientation.l);
  const rows = Math.floor((freeRectWidth(rect) + FREE_RECT_EPS) / orientation.w);
  if (cols <= 0 || rows <= 0) return [];

  const cells = [];
  for (let col = 0; col < cols; col++) {
    const xMin = loadFrontFirst
      ? rect.maxX - (col + 1) * orientation.l
      : rect.minX + col * orientation.l;
    for (let row = 0; row < rows; row++) {
      cells.push({ xMin, zMin: rect.minZ + row * orientation.w });
    }
  }
  return cells;
}

function repeatedStackCandidateIsLegal(candidate, item, zones, packed, retentionContext, wheelWell) {
  const containedInUsableZone = isAabbContainedInAnyZone(candidate.aabb, zones);
  if (wheelWell) {
    if (!isAabbWithinTruckMinusBlocked(candidate.aabb, wheelWell)) return false;
  } else if (!containedInUsableZone) {
    return false;
  }

  if (collidesPacked(candidate.aabb, packed)) return false;

  if (containedInUsableZone) {
    if (!supportsCandidate(candidate.aabb, packed, item)) return false;
  } else if (!wheelWell || !isWheelWellSupportedAndStable(candidate.aabb, packed, wheelWell, item)) {
    return false;
  }

  return candidateHasRearRetention(candidate.aabb, packed, retentionContext);
}

function placeRepeatedStackGroup(
  group,
  zones,
  packed,
  output,
  loadFrontFirst,
  retentionContext,
  wheelWell,
  budget = null,
  useCleanupBudget = false
) {
  const queue = [...(group || [])];
  let placed = 0;
  let progress = true;

  while (queue.length && progress && !stackBatchBudgetExpired(budget, useCleanupBudget)) {
    progress = false;
    const levels = stackBatchLayerLevels(packed);

    for (const yLevel of levels) {
      if (!queue.length || stackBatchBudgetExpired(budget, useCleanupBudget)) break;
      const layerRects = buildStackLayerFreeRects(packed, yLevel);
      const orientations = rankedRepeatedStackOrientations(queue, layerRects);
      if (!orientations.length) continue;

      const rects = [...layerRects].sort((a, b) => {
        const ax = loadFrontFirst ? -a.maxX : a.minX;
        const bx = loadFrontFirst ? -b.maxX : b.minX;
        if (ax !== bx) return ax - bx;
        return a.minZ - b.minZ;
      });

      for (const orientation of orientations) {
        let orientationPlaced = false;
        for (const rect of rects) {
          if (!queue.length || stackBatchBudgetExpired(budget, useCleanupBudget)) break;
          if (orientation.l > freeRectLength(rect) + FREE_RECT_EPS) continue;
          if (orientation.w > freeRectWidth(rect) + FREE_RECT_EPS) continue;

          for (const { xMin, zMin } of stackBatchCellMins(rect, orientation, loadFrontFirst)) {
            if (!queue.length || stackBatchBudgetExpired(budget, useCleanupBudget)) break;
            const item = queue[0];
            const dims = { l: orientation.l, w: orientation.w, h: orientation.h };
            const position = {
              x: xMin + orientation.l / 2,
              y: yLevel + orientation.h / 2,
              z: zMin + orientation.w / 2,
            };
            const aabb = getAabb(position, dims);
            const candidate = { position, dims, aabb, orientation, freeRect: rect };
            if (!repeatedStackCandidateIsLegal(candidate, item, zones, packed, retentionContext, wheelWell)) {
              continue;
            }

            recordPlacement(output, packed, item, candidate, 'stack');
            queue.shift();
            placed++;
            progress = true;
            orientationPlaced = true;
          }
        }
        if (orientationPlaced) break;
      }

      if (progress) break;
    }
  }

  return { placed, remaining: queue };
}

function placeRepeatedStackBatches(
  items,
  zones,
  packed,
  output,
  loadFrontFirst,
  layoutQualityEnabled,
  retentionContext,
  wheelWell,
  budget = null,
  useCleanupBudget = false
) {
  const remaining = new Set(items || []);
  for (const group of buildRepeatedBatches(items, layoutQualityEnabled)) {
    if (stackBatchBudgetExpired(budget, useCleanupBudget)) break;
    const activeGroup = group.filter(item => remaining.has(item));
    if (activeGroup.length < REPEATED_BATCH_MIN) continue;
    const result = placeRepeatedStackGroup(
      activeGroup,
      zones,
      packed,
      output,
      loadFrontFirst,
      retentionContext,
      wheelWell,
      budget,
      useCleanupBudget
    );
    const stillRemaining = new Set(result.remaining);
    for (const item of activeGroup) {
      if (!stillRemaining.has(item)) remaining.delete(item);
    }
  }
  return [...remaining];
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

function getCompatibleCompactionZones(placement, zones, allowCompatibleZoneMoves = false) {
  const currentZone = getPlacementZone(placement, zones);
  if (!allowCompatibleZoneMoves) return currentZone ? [currentZone] : [];
  const floorY = placement?.aabb?.min?.y;
  if (!Number.isFinite(floorY)) return currentZone ? [currentZone] : [];
  const dims = placement.dims || {};
  const compatible = (zones || []).filter(zone =>
    Math.abs(zone.min.y - floorY) <= CONTACT_EPS &&
    dims.l <= zone.max.x - zone.min.x + FREE_RECT_EPS &&
    dims.w <= zone.max.z - zone.min.z + FREE_RECT_EPS &&
    dims.h <= zone.max.y - zone.min.y + FREE_RECT_EPS
  );
  if (currentZone && !compatible.includes(currentZone)) compatible.push(currentZone);
  return compatible;
}

function compactFloorPlacements(
  output,
  packed,
  zones,
  loadFrontFirst,
  frontSurfaceFirst = false,
  retentionContext = null,
  options = {}
) {
  const includeLockedGrid = options.includeLockedGrid === true;
  const allowCompatibleZoneMoves = options.allowCompatibleZoneMoves === true;
  const allowedPhases = Array.isArray(options.phases) && options.phases.length
    ? new Set(options.phases)
    : null;
  const compactable = packed.filter(placement =>
    (includeLockedGrid || !placement.lockedGrid) &&
    (!allowedPhases || allowedPhases.has(placement.phase)) &&
    placement.phase !== 'stack' &&
    isPlacementOnZoneFloor(placement.aabb, zones)
  );
  if (!compactable.length) {
    return rebuildFloorStateFromPacked(zones, packed, frontSurfaceFirst, retentionContext);
  }

  // E2B fix: the narrow wheel-well centre channel has lateral (z) slack the floor
  // pass already resolves into clean, wall-flush, column-aligned lanes. Letting
  // compaction also move channel boxes along z lets different rows hug opposite
  // channel walls (sideDistance rewards either wall equally), producing a zigzag
  // floor and mirror-misaligned stacks above it. Inside a channel zone, keep each
  // box in its established lane and compact it forward (x) only. Full-width zones
  // and Standard (no narrow channel zone) are unaffected.
  const channelZones = narrowChannelZones(zones);
  const widestZoneWidth = zones.length
    ? Math.max(...zones.map(z => z.max.z - z.min.z))
    : 0;

  let changed = false;
  const ordered = [...compactable].sort((a, b) => {
    const ax = loadFrontFirst ? -a.aabb.max.x : a.aabb.min.x;
    const bx = loadFrontFirst ? -b.aabb.max.x : b.aabb.min.x;
    if (ax !== bx) return ax - bx;
    return a.aabb.min.z - b.aabb.min.z;
  });

  const compactionBudget = options.budget || null;
  for (let pass = 0; pass < 2 && !(compactionBudget && compactionBudget.cleanupExpired()); pass++) {
    for (const placement of ordered) {
      // Quality-only pass: bail mid-sweep at the hard cleanup deadline. Every
      // move already accepted remains fully validated.
      if (compactionBudget && compactionBudget.cleanupExpired()) break;
      const others = packed.filter(other => other !== placement);
      const placementInChannel =
        channelZones.length > 0 && aabbInNarrowChannel(placement.aabb, channelZones);
      let best = null;
      let bestScore = scoreCompactionCandidate(
        placement.aabb,
        getPlacementZone(placement, zones),
        loadFrontFirst,
        others,
        placement,
        frontSurfaceFirst
      );

      for (const zone of getCompatibleCompactionZones(placement, zones, allowCompatibleZoneMoves)) {
        const xAnchors = candidateCompactionAnchors(placement, others, zone, loadFrontFirst, 'x');
        const zoneIsChannel =
          channelZones.length > 0 && (zone.max.z - zone.min.z) < widestZoneWidth - FREE_RECT_EPS;
        const zAnchors = (placementInChannel && zoneIsChannel)
          ? [clampAnchor(placement.aabb.min.z, zone.min.z, zone.max.z, placement.dims.w)]
              .filter(value => value !== null)
          : candidateCompactionAnchors(placement, others, zone, loadFrontFirst, 'z');

        for (const xMin of xAnchors) {
          for (const zMin of zAnchors) {
            const position = {
              x: xMin + placement.dims.l / 2,
              y: zone.min.y + placement.dims.h / 2,
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

function getFrontCompressionBounds(placement, zones, wheelWell) {
  const zone = getPlacementZone(placement, zones);
  if (zone) return { minX: zone.min.x, maxX: zone.max.x };
  if (wheelWell && isAabbWithinTruckMinusBlocked(placement.aabb, wheelWell)) {
    return { minX: wheelWell.truckBox.min.x, maxX: wheelWell.truckBox.max.x };
  }
  return null;
}

function placementHasValidVerticalSupport(placement, packedWithoutPlacement, zones, wheelWell) {
  const containedInUsableZone = isAabbContainedInAnyZone(placement.aabb, zones);
  return isPlacementOnZoneFloor(placement.aabb, zones) ||
    (containedInUsableZone && supportsCandidate(placement.aabb, packedWithoutPlacement, placement.item)) ||
    (wheelWell && !containedInUsableZone && isWheelWellSupportedAndStable(
      placement.aabb,
      packedWithoutPlacement,
      wheelWell,
      placement.item
    )) ||
    (wheelWell && isWheelWellSupportedAndStable(
      placement.aabb,
      packedWithoutPlacement,
      wheelWell,
      placement.item
    ));
}

function placementPassesCompressionRules(placement, packedWithoutPlacement, zones, retentionContext, wheelWell) {
  if (wheelWell && aabbIntersectsWheelWellBody(placement.aabb, wheelWell)) return false;
  if (wheelWell
    ? !isAabbWithinTruckMinusBlocked(placement.aabb, wheelWell)
    : !isAabbContainedInAnyZone(placement.aabb, zones)
  ) return false;
  if (collidesPacked(placement.aabb, packedWithoutPlacement)) return false;
  if (!placementHasValidVerticalSupport(placement, packedWithoutPlacement, zones, wheelWell)) return false;
  return candidateHasRearRetention(placement.aabb, packedWithoutPlacement, retentionContext);
}

function directSupportDependents(placement, packed) {
  return (packed || []).filter(child =>
    child !== placement &&
    Math.abs(child.aabb.min.y - placement.aabb.max.y) <= CONTACT_EPS &&
    computeXzOverlapArea(child.aabb, placement.aabb) > 0.05
  );
}

function movedPlacementPreservesDependents(placement, candidate, packed, zones, retentionContext, wheelWell) {
  const dependents = directSupportDependents(placement, packed);
  if (!dependents.length) return true;
  const candidatePacked = packed.map(entry => entry === placement ? candidate : entry);
  for (const child of dependents) {
    const packedWithoutChild = candidatePacked.filter(entry => entry !== child);
    if (!placementHasValidVerticalSupport(child, packedWithoutChild, zones, wheelWell)) return false;
    if (!candidateHasRearRetention(child.aabb, packedWithoutChild, retentionContext)) return false;
  }
  return true;
}

function shouldFrontCompressPlacement(placement, zones) {
  if (!placement || placement.lockedGrid) return false;
  return !isPlacementOnZoneFloor(placement.aabb, zones);
}

function collectForwardCompressionAnchors(placement, others, bounds, loadFrontFirst, wheelWell) {
  const maxAnchors = 32;
  const size = placement.dims.l;
  const currentMin = placement.aabb.min.x;
  const min = bounds.minX;
  const max = bounds.maxX;
  const raw = [
    loadFrontFirst ? max - size : min,
    currentMin,
  ];
  const pushSupportAnchors = supportAabb => {
    raw.push(
      supportAabb.min.x,
      supportAabb.max.x - size,
      supportAabb.max.x - size * MIN_SUPPORT_FRACTION,
      supportAabb.max.x - size / 2
    );
  };

  for (const other of others || []) {
    if (!other?.aabb) continue;
    const yOverlap = intervalsOverlap(placement.aabb.min.y, placement.aabb.max.y, other.aabb.min.y, other.aabb.max.y);
    const zOverlap = intervalsOverlap(placement.aabb.min.z, placement.aabb.max.z, other.aabb.min.z, other.aabb.max.z);
    if (yOverlap && zOverlap) {
      raw.push(loadFrontFirst ? other.aabb.min.x - size : other.aabb.max.x);
    }
    if (Math.abs(placement.aabb.min.y - other.aabb.max.y) <= CONTACT_EPS &&
        computeXzOverlapArea(placement.aabb, other.aabb) > 0.05) {
      pushSupportAnchors(other.aabb);
    }
  }

  if (wheelWell) {
    for (const top of wheelWell.tops || []) {
      if (Math.abs(placement.aabb.min.y - top.max.y) > CONTACT_EPS) continue;
      if (computeXzOverlapArea(placement.aabb, top) <= 0.05) continue;
      pushSupportAnchors(top);
    }
  }

  return uniqueSorted(raw, loadFrontFirst ? (a, b) => b - a : (a, b) => a - b)
    .map(value => clampAnchor(value, min, max, size))
    .filter(value => value !== null)
    .filter(value => loadFrontFirst
      ? value > currentMin + CONTACT_EPS
      : value < currentMin - CONTACT_EPS)
    .slice(0, maxAnchors);
}

function compressWheelWellPlacementsForward(output, packed, zones, loadFrontFirst, retentionContext, wheelWell, budget = null) {
  if (!wheelWell || !packed.length) return { changed: false, moved: 0 };
  const ordered = [...packed].sort((a, b) =>
    a.aabb.min.y - b.aabb.min.y ||
    (loadFrontFirst ? b.aabb.max.x - a.aabb.max.x : a.aabb.min.x - b.aabb.min.x) ||
    a.aabb.min.z - b.aabb.min.z ||
    stableTextCompare(a.instanceId, b.instanceId)
  );
  let moved = 0;

  for (const placement of ordered) {
    // Quality-only pass: time-budgeted so it can never become a freeze source.
    if (budget && budget.cleanupExpired()) break;
    if (!shouldFrontCompressPlacement(placement, zones)) continue;
    const bounds = getFrontCompressionBounds(placement, zones, wheelWell);
    if (!bounds) continue;
    const others = packed.filter(other => other !== placement);
    const anchors = collectForwardCompressionAnchors(placement, others, bounds, loadFrontFirst, wheelWell);
    let accepted = null;

    for (const xMin of anchors) {
      const position = {
        x: xMin + placement.dims.l / 2,
        y: placement.pos.y,
        z: placement.pos.z,
      };
      const aabb = getAabb(position, placement.dims);
      const candidate = {
        ...placement,
        pos: position,
        aabb,
        zone: placement.zone && isAabbContainedInZone(aabb, placement.zone) ? placement.zone : getPlacementZone({ ...placement, aabb }, zones),
      };
      if (!placementPassesCompressionRules(candidate, others, zones, retentionContext, wheelWell)) continue;
      if (!movedPlacementPreservesDependents(placement, candidate, packed, zones, retentionContext, wheelWell)) continue;
      accepted = candidate;
      break;
    }

    if (!accepted) continue;
    placement.pos = accepted.pos;
    placement.aabb = accepted.aabb;
    placement.zone = accepted.zone;
    moved++;
  }

  if (moved) writeOutputPlacements(output, packed);
  return { changed: moved > 0, moved };
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
    // Structured mirror of the same reason text (one source of truth for both).
    output.rejectionReasons.push(makeRejectionReason(
      placement.instanceId,
      rejectionCodeForValidationReason(reason),
      'validation',
      `Staged after final validation: ${reason}.`
    ));
  }
  output.unpacked = [...unpacked];
}

function frontOverhangValidationRank(placement, retentionContext) {
  const geometry = retentionContext?.geometry;
  const aabb = placement?.aabb;
  if (!geometry || !aabb) return 0;
  if (isAabbContainedInZone(aabb, geometry.deckZone)) return 2;
  const stepGap = geometry.stepX - aabb.max.x;
  const isStepRetainer =
    isAabbContainedInZone(aabb, geometry.mainZone) &&
    stepGap >= -CONTAINMENT_EPS_INCHES &&
    stepGap <= CONTACT_EPS + 1e-9 &&
    !(aabb.min.y > geometry.deckY + CONTAINMENT_EPS_INCHES ||
      aabb.max.y < geometry.deckY - CONTAINMENT_EPS_INCHES);
  return isStepRetainer ? 0 : 1;
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
      frontOverhangValidationRank(a, retentionContext) - frontOverhangValidationRank(b, retentionContext) ||
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
    } else if (!placementHasValidVerticalSupport(placement, accepted, zones, wheelWell)) {
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

// ---------------------------------------------------------------------------
// LEFTOVER RECOVERY: after the floor/filler/stack phases (and, for Wheel Wells,
// the well-top build-up/bridge pass) some staged leftovers can still fit
// remaining LEGAL holes — compaction and earlier placements changed the world
// since each leftover's original attempt. This pass retries exactly those
// leftovers through the ordinary findFloorPlacement / findStackPlacement
// hard-rule pipelines (containment, collision, support, retention, zone
// height) against the FINAL layout, so it can only ADD legal placements: no
// bridge faking, no blocked-body entry, no floating, no shelf forcing. It is
// generic across space types: in constrained geometries (wheel-well center
// channel, future narrow zones) channel-fitting and smaller cartons are
// retried first; in single-zone spaces it is a plain smallest-first retry.
// ---------------------------------------------------------------------------

/**
 * Deterministic leftover retry order: channel-fitting cartons first (they are
 * the only ones that can use the constrained opening), then smaller footprint,
 * then smaller volume, then stable id order.
 */
export function sortConstrainedLeftoverQueue(items, channelZones) {
  const channelWidth = (channelZones || []).length
    ? Math.max(...channelZones.map(zone => zone.max.z - zone.min.z))
    : 0;
  const fitsChannel = item => (item.candidates || []).some(o => o.w <= channelWidth + FREE_RECT_EPS)
    ? 0
    : 1;
  return [...(items || [])].sort((a, b) =>
    fitsChannel(a) - fitsChannel(b) ||
    a.footprint - b.footprint ||
    a.volume - b.volume ||
    stableTextCompare(a.id, b.id)
  );
}

// ---------------------------------------------------------------------------
// FRONT OVERHANG: deck retaining-wall pass. The raised deck is legally usable
// only behind cargo that is flush with the overhang step and spans the deck
// level (C2 retention). Until now that wall only formed by accident, so the
// deck stayed unused whenever front cargo was too short. This pass
// intentionally builds the missing wall segments FROM LEFTOVERS ONLY, through
// the ordinary hard-rule pipeline (containment, collision, full support rules)
// — every wall segment is legal front cargo in its own right, and the deck is
// still gated per candidate by candidateHasRearRetention plus final
// validation. Nothing is moved, nothing is faked, retention is not weakened.
// ---------------------------------------------------------------------------
function wallBottomsAt(packed, mainZone, minX, maxX, minZ, maxZ) {
  const bottoms = [mainZone.min.y];
  for (const placement of packed) {
    const ox = Math.min(maxX, placement.aabb.max.x) - Math.max(minX, placement.aabb.min.x);
    const oz = Math.min(maxZ, placement.aabb.max.z) - Math.max(minZ, placement.aabb.min.z);
    if (ox > 0.05 && oz > 0.05) bottoms.push(placement.aabb.max.y);
  }
  return uniqueSorted(bottoms, (a, b) => a - b);
}

function buildDeckRetentionWall(output, packed, itemsById, retentionContext, budget) {
  const geometry = retentionContext?.geometry;
  if (!geometry || !output.unpacked.length) return 0;
  const { stepX, deckY, deckZone, mainZone } = geometry;

  const deckL = deckZone.max.x - deckZone.min.x;
  const deckW = deckZone.max.z - deckZone.min.z;
  const deckH = deckZone.max.y - deckZone.min.y;
  const leftovers = output.unpacked.map(id => itemsById.get(id)).filter(Boolean);
  // Build the wall only when some leftover could actually use the deck behind it.
  const anyDeckFit = leftovers.some(item => item.candidates.some(o =>
    o.l <= deckL + FREE_RECT_EPS && o.w <= deckW + FREE_RECT_EPS && o.h <= deckH + FREE_RECT_EPS));
  if (!anyDeckFit) return 0;

  const tallest = item => Math.max(0, ...item.candidates.map(o => o.h));
  const queue = [...leftovers].sort((a, b) =>
    tallest(b) - tallest(a) ||
    b.footprint - a.footprint ||
    stableTextCompare(a.id, b.id)
  );
  const placedIds = new Set();
  let placed = 0;
  let progress = true;
  let guard = queue.length * 4 + 8;

  while (progress && guard-- > 0) {
    progress = false;
    if (budget && budget.cleanupExpired()) break;
    const { uncovered } = computeDeckRetentionCoverage(geometry, packed);
    if (!uncovered.length) break;
    const target = uncovered[0];
    // A below-plane base is only worth placing while a remaining leftover could
    // still span the deck level on top of it.
    const maxRemainingHeight = Math.max(0, ...queue.filter(item => !placedIds.has(item.id)).map(tallest));

    let stepPlaced = false;
    for (const item of queue) {
      if (placedIds.has(item.id)) continue;
      for (const orientation of item.candidates) {
        const xMin = stepX - orientation.l;
        if (xMin < mainZone.min.x - FREE_RECT_EPS) continue;
        const zAnchors = uniqueSorted(
          [target.minZ, target.maxZ - orientation.w]
            .map(z => clampAnchor(z, mainZone.min.z, mainZone.max.z, orientation.w))
            .filter(z => z !== null),
          (a, b) => a - b
        );
        for (const zMin of zAnchors) {
          for (const bottom of wallBottomsAt(packed, mainZone, xMin, stepX, zMin, zMin + orientation.w)) {
            if (bottom + orientation.h > mainZone.max.y + FREE_RECT_EPS) continue;
            const position = {
              x: xMin + orientation.l / 2,
              y: bottom + orientation.h / 2,
              z: zMin + orientation.w / 2,
            };
            const dims = { l: orientation.l, w: orientation.w, h: orientation.h };
            const aabb = getAabb(position, dims);
            if (!isAabbContainedInZone(aabb, mainZone)) continue;
            if (collidesPacked(aabb, packed)) continue;
            const onFloor = Math.abs(aabb.min.y - mainZone.min.y) <= CONTACT_EPS;
            if (!onFloor && !supportsCandidate(aabb, packed, item)) continue;
            // The segment must progress the wall: span the deck level itself,
            // or be a base a remaining leftover could still span from.
            const spansDeck = aabb.max.y >= deckY - CONTACT_EPS && aabb.min.y <= deckY + CONTACT_EPS;
            const buildsToward = aabb.max.y <= deckY + CONTACT_EPS &&
              aabb.max.y + maxRemainingHeight >= deckY - CONTACT_EPS;
            if (!spansDeck && !buildsToward) continue;
            recordPlacement(
              output,
              packed,
              item,
              { position, dims, aabb, orientation, zone: mainZone },
              onFloor ? 'floor' : 'stack'
            );
            placedIds.add(item.id);
            placed++;
            progress = true;
            stepPlaced = true;
            break;
          }
          if (stepPlaced) break;
        }
        if (stepPlaced) break;
      }
      if (stepPlaced) break;
    }
  }

  if (placed) output.unpacked = output.unpacked.filter(id => !placedIds.has(id));
  return placed;
}

function frontOverhangRetentionPlacements(retentionContext, packed) {
  return [
    ...(Array.isArray(retentionContext?.fixedPlacements) ? retentionContext.fixedPlacements : []),
    ...(packed || []),
  ];
}

function frontOverhangDeckFillZones(retentionContext, packed) {
  const geometry = retentionContext?.geometry;
  if (!geometry) return [];
  return computeDeckRetentionCoverage(geometry, frontOverhangRetentionPlacements(retentionContext, packed)).covered
    .map(interval => ({
      min: {
        x: geometry.deckZone.min.x,
        y: geometry.deckY,
        z: Math.max(geometry.deckZone.min.z, interval.minZ),
      },
      max: {
        x: geometry.deckZone.max.x,
        y: geometry.deckZone.max.y,
        z: Math.min(geometry.deckZone.max.z, interval.maxZ),
      },
    }))
    .filter(zone =>
      zone.max.x - zone.min.x > FREE_RECT_EPS &&
      zone.max.y - zone.min.y > FREE_RECT_EPS &&
      zone.max.z - zone.min.z > FREE_RECT_EPS
    );
}

function createFrontOverhangDeckFillState(retentionContext, packed) {
  const zones = frontOverhangDeckFillZones(retentionContext, packed);
  if (!zones.length) return null;
  return rebuildFloorStateFromPacked(zones, packed, false, retentionContext);
}

function scoreFrontOverhangDeckFillCandidate(candidate, orientation, item, packed, retentionContext) {
  const geometry = retentionContext?.geometry;
  const rect = candidate.freeRect;
  const leftoverX = rect ? Math.max(0, freeRectLength(rect) - candidate.dims.l) : 0;
  const leftoverZ = rect ? Math.max(0, freeRectWidth(rect) - candidate.dims.w) : 0;
  const wasteArea = rect ? Math.max(0, freeRectArea(rect) - candidate.dims.l * candidate.dims.w) : 0;
  const groupScore = scoreLayoutGroupContinuity(
    candidate.aabb,
    orientation,
    item,
    packed,
    false,
    true
  );
  return [
    Math.max(0, candidate.aabb.min.x - (geometry?.stepX || candidate.aabb.min.x)),
    ...groupScore.continuity,
    candidate.aabb.min.z,
    groupScore.orientationPenalty,
    groupScore.surfaceOrientationPenalty,
    Math.min(leftoverX, leftoverZ),
    wasteArea,
    leftoverX,
    leftoverZ,
    orientation.h,
  ];
}

function findFrontOverhangDeckFillPlacement(item, floorState, packed, retentionContext) {
  const geometry = retentionContext?.geometry;
  if (!geometry || !floorState?.freeRects?.length) return null;
  const { deckZone, deckY } = geometry;

  let best = null;
  let bestScore = null;
  for (const orientation of item.candidates || []) {
    if (orientation.h > deckZone.max.y - deckY + FREE_RECT_EPS) continue;
    for (const candidate of buildFreeRectCandidates(orientation, floorState, false, packed)) {
      if (Math.abs(candidate.aabb.min.y - deckY) > CONTACT_EPS) continue;
      if (!isAabbContainedInZone(candidate.aabb, deckZone)) continue;
      if (collidesPacked(candidate.aabb, packed)) continue;
      if (!candidateHasRearRetention(candidate.aabb, packed, retentionContext)) continue;
      const scoredCandidate = {
        ...candidate,
        orientation,
        deckFill: true,
      };
      const score = scoreFrontOverhangDeckFillCandidate(scoredCandidate, orientation, item, packed, retentionContext);
      if (!best || compareScore(score, bestScore) < 0) {
        best = scoredCandidate;
        bestScore = score;
      }
    }
  }

  return best;
}

function placeFrontOverhangDeckFill(
  queue,
  output,
  packed,
  retentionContext,
  loadFrontFirst,
  budget = null,
  groupUniverse = null
) {
  if (!retentionContext?.geometry || !Array.isArray(queue) || !queue.length) {
    return { remaining: queue || [], placed: 0 };
  }

  const floorState = createFrontOverhangDeckFillState(retentionContext, packed);
  if (!floorState?.freeRects?.length) return { remaining: queue, placed: 0 };

  const original = [...queue];
  const ranked = sortItemsForFloor(original, true, groupUniverse || original);
  const placedIds = new Set();
  let placed = 0;
  for (const item of ranked) {
    if (placedIds.has(item.id)) continue;
    if (budget && budget.cleanupExpired()) {
      break;
    }
    const placement = findFrontOverhangDeckFillPlacement(
      item,
      floorState,
      packed,
      retentionContext
    );
    if (!placement) continue;
    recordPlacement(output, packed, item, placement, 'floor');
    occupyFloorSpace(floorState, placement);
    placedIds.add(item.id);
    placed++;
  }

  return {
    remaining: original.filter(item => !placedIds.has(item.id)),
    placed,
  };
}

function placeFrontOverhangDeckFillFromUnpacked(
  output,
  packed,
  itemsById,
  retentionContext,
  loadFrontFirst,
  budget = null,
  groupUniverse = null
) {
  if (!retentionContext?.geometry || !output.unpacked.length) return 0;
  const queue = output.unpacked.map(id => itemsById.get(id)).filter(Boolean);
  const eligibleIds = new Set(queue.map(item => item.id));
  const deckFill = placeFrontOverhangDeckFill(
    queue,
    output,
    packed,
    retentionContext,
    loadFrontFirst,
    budget,
    groupUniverse
  );
  if (!deckFill.placed) return 0;
  const remainingIds = new Set(deckFill.remaining.map(item => item.id));
  output.unpacked = output.unpacked.filter(id => !eligibleIds.has(id) || remainingIds.has(id));
  return deckFill.placed;
}

// Wheel Wells continuous-floor seam candidates: ordinary floor candidates come
// from per-zone free rects, so they can never straddle the rear/channel/front
// zone seams even though the truck floor is physically continuous there. When
// zone lengths are not multiples of the cargo length this wastes a strip at
// every seam. This generator proposes floor-level (bottom at the truck floor)
// poses that straddle a seam, validated by the exact truck-minus-blocked
// containment, collision, and the wheel-well support model (which recognizes
// the continuous floor). Never raised, never bridged, never inside a body.
function findWheelWellSeamFloorPlacement(item, packed, geometry, loadFrontFirst) {
  const floorY = geometry.truckBox.min.y;
  const seams = [geometry.wx0, geometry.wx1];
  let best = null;
  let bestScore = null;

  for (const orientation of item.candidates) {
    const { l, w, h } = orientation;
    if (floorY + h > geometry.truckBox.max.y + CONTAINMENT_EPS_INCHES) continue;
    const xRaw = [];
    for (const seam of seams) xRaw.push(seam - l / 2);
    const zRaw = [-geometry.betweenHalfW, geometry.betweenHalfW - w];
    for (const placement of packed) {
      if (Math.abs(placement.aabb.min.y - floorY) > CONTACT_EPS) continue;
      xRaw.push(placement.aabb.max.x, placement.aabb.min.x - l);
      zRaw.push(placement.aabb.min.z, placement.aabb.max.z - w, placement.aabb.min.z - w, placement.aabb.max.z);
    }
    // Only genuinely seam-straddling poses: everything else is the ordinary
    // floor pass's job. A straddler overlaps the well x-range, so its width
    // must sit inside the channel walls (the union check would reject the rest
    // anyway; the pre-filter just avoids wasted candidates).
    const xCands = uniqueSorted(xRaw, loadFrontFirst ? (a, b) => b - a : (a, b) => a - b)
      .filter(xMin => seams.some(seam => xMin < seam - FREE_RECT_EPS && xMin + l > seam + FREE_RECT_EPS))
      .slice(0, 16);
    const zCands = uniqueSorted(zRaw, (a, b) => a - b)
      .filter(zMin => zMin >= -geometry.betweenHalfW - FREE_RECT_EPS &&
        zMin + w <= geometry.betweenHalfW + FREE_RECT_EPS)
      .slice(0, 12);

    for (const xMin of xCands) {
      for (const zMin of zCands) {
        const position = { x: xMin + l / 2, y: floorY + h / 2, z: zMin + w / 2 };
        const dims = { l, w, h };
        const aabb = getAabb(position, dims);
        if (!isAabbWithinTruckMinusBlocked(aabb, geometry)) continue;
        if (collidesPacked(aabb, packed)) continue;
        if (!isWheelWellSupportedAndStable(aabb, packed, geometry, item)) continue;
        const score = [loadFrontFirst ? -aabb.max.x : aabb.min.x, aabb.min.z, h];
        if (!best || compareScore(score, bestScore) < 0) {
          best = { position, dims, aabb, orientation, zone: null };
          bestScore = score;
        }
      }
    }
  }

  return best;
}

export function placeLeftoverRecovery(
  output,
  packed,
  itemsById,
  floorZones,
  loadFrontFirst,
  retentionContext,
  wheelWell,
  layoutQualityEnabled,
  wheelWellBridge = null,
  budget = null,
  allowStack = true
) {
  if (!output.unpacked.length) return 0;
  let floorState = rebuildFloorStateFromPacked(floorZones, packed, false, retentionContext);

  const channelZones = narrowChannelZones(floorZones);
  let queue = sortConstrainedLeftoverQueue(
    output.unpacked.map(id => itemsById.get(id)).filter(Boolean),
    channelZones
  );
  const placedIds = new Set();
  let placed = 0;

  if (retentionContext?.geometry && queue.length && !(budget && budget.cleanupExpired())) {
    const deckFill = placeFrontOverhangDeckFill(
      queue,
      output,
      packed,
      retentionContext,
      loadFrontFirst,
      budget,
      queue
    );
    if (deckFill.placed) {
      for (const item of queue) {
        if (!deckFill.remaining.includes(item)) placedIds.add(item.id);
      }
      placed += deckFill.placed;
      queue = deckFill.remaining;
      floorState = rebuildFloorStateFromPacked(floorZones, packed, false, retentionContext);
    }
  }

  if (allowStack && queue.length && !(budget && budget.cleanupExpired())) {
    const stackRemaining = placeRepeatedStackBatches(
      queue,
      floorZones,
      packed,
      output,
      loadFrontFirst,
      layoutQualityEnabled,
      retentionContext,
      wheelWellBridge,
      budget,
      true
    );
    const stackRemainingSet = new Set(stackRemaining);
    for (const item of queue) {
      if (!stackRemainingSet.has(item)) {
        placedIds.add(item.id);
        placed++;
      }
    }
    queue = stackRemaining;
  }

  for (const item of queue) {
    if (budget && budget.cleanupExpired()) break;
    let placement = floorState.freeRects.length
      ? findFloorPlacement(item, floorState, packed, loadFrontFirst, { layoutQualityEnabled })
      : null;
    let phase = 'filler';
    if (!placement && wheelWell) {
      // Continuous-floor seam retry: legal floor poses straddling the zone
      // seams that per-zone free rects can never generate.
      placement = findWheelWellSeamFloorPlacement(item, packed, wheelWell, loadFrontFirst);
    }
    if (!placement && allowStack) {
      // Final safe stack/raised attempt against the FINAL layout: compaction and
      // earlier leftover rescues changed the world since the main stack phase, so
      // a supported stack (or, with bridge geometry, a legal well-top pose) may
      // exist now. Same hard-rule pipeline as the main phase — nothing is forced.
      placement = findStackPlacement(
        item,
        floorZones,
        packed,
        loadFrontFirst,
        layoutQualityEnabled,
        retentionContext,
        wheelWellBridge,
        budget
      );
      phase = 'stack';
    }
    if (!placement) continue;
    recordPlacement(output, packed, item, placement, phase);
    occupyFloorSpace(floorState, placement);
    placedIds.add(item.id);
    placed++;
  }

  if (placed) output.unpacked = output.unpacked.filter(id => !placedIds.has(id));
  return placed;
}

// Back-compat alias from when this pass was Wheel Wells-only.
export { placeLeftoverRecovery as placeWheelWellConstrainedLeftovers };

function orientationFitsZone(orientation, zone) {
  return orientation.l <= zone.max.x - zone.min.x + FREE_RECT_EPS &&
    orientation.w <= zone.max.z - zone.min.z + FREE_RECT_EPS &&
    orientation.h <= zone.max.y - zone.min.y + FREE_RECT_EPS;
}

function orientationsFitSomeZone(orientations, zones) {
  return (orientations || []).some(orientation =>
    (zones || []).some(zone => orientationFitsZone(orientation, zone))
  );
}

function buildRuleRejectionContext(item = {}) {
  const source = item.item || item;
  return {
    rules: {
      orientationLock: canonicalOrientationLock(source.orientationLock),
      orientationLocked: source.orientationLocked === true,
      canFlip: source.canFlip === true,
      noStackOnTop: source.noStackOnTop === true,
      stackable: source.stackable !== false,
      maxStackCount: finiteNumber(source.maxStackCount, 0),
      laneItem: source.laneItem === true ? 'always' : source.laneItem === false ? 'never' : 'auto',
      loadPriority: finiteNumber(source.loadPriority, 0),
      candidates: Array.isArray(item.candidates) ? item.candidates.length : 0,
    },
  };
}

/**
 * Diagnose WHY an item ended unplaced, using only statically provable facts
 * (zone cross-sections, orientation policy, wheel-well channel/shelf widths).
 * Dynamic failures (space simply full) fall back to NO_STACK_CANDIDATE with the
 * item's existing warning text as detail. Diagnosis never changes placement.
 */
function diagnoseUnplacedItem(item, zones, wheelWell, fallbackDetail) {
  const ruleContext = buildRuleRejectionContext(item);
  if (!orientationsFitSomeZone(item.candidates, zones)) {
    const unrestricted = buildOrientationCandidates(item.dims, { orientationLock: 'any', canFlip: true });
    if (orientationsFitSomeZone(unrestricted, zones)) {
      return makeRejectionReason(
        item.id,
        REJECTION_CODES.ORIENTATION_LOCKED,
        'stack',
        'An orientation that fits exists, but the case orientation policy or instance lock excludes it.',
        ruleContext
      );
    }
    return makeRejectionReason(
      item.id,
      REJECTION_CODES.NO_FIT_ANY_SURFACE,
      'stack',
      'No allowed orientation fits any usable surface of this truck.',
      ruleContext
    );
  }

  if (wheelWell) {
    const channelWidth = 2 * wheelWell.betweenHalfW;
    const shelfWidth = wheelWell.wellWidth;
    const tooWideForChannel = item.candidates.every(o => o.w > channelWidth + FREE_RECT_EPS);
    const tooWideForShelf = item.candidates.every(o => o.w > shelfWidth + FREE_RECT_EPS);
    const context = { ...ruleContext, channelWidth, shelfWidth, tooWideForChannel, tooWideForShelf };
    // TOO_WIDE_FOR_CHANNEL is only claimed when it is provable for every allowed
    // orientation. Shelf width alone is never a primary cause here (most cargo is
    // wider than a wheel-well shelf); it stays available as context and for the
    // future shelf-targeted leftover pass.
    if (tooWideForChannel) {
      return makeRejectionReason(
        item.id,
        REJECTION_CODES.TOO_WIDE_FOR_CHANNEL,
        'stack',
        'Every allowed orientation is wider than the center channel between the wheel wells, and no other valid position remained.',
        context
      );
    }
    return makeRejectionReason(item.id, REJECTION_CODES.NO_STACK_CANDIDATE, 'stack', fallbackDetail, context);
  }

  return makeRejectionReason(item.id, REJECTION_CODES.NO_STACK_CANDIDATE, 'stack', fallbackDetail, ruleContext);
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
  const wheelWell = getWheelWellGeometry(input.truck || {});
  const wheelWellFloorChannelCompaction =
    wheelWell && input.enableWheelWellFloorChannelCompaction !== false;
  const floorCompactionOptions = wheelWellFloorChannelCompaction
    ? { includeLockedGrid: true, allowCompatibleZoneMoves: true, phases: ['floor', 'filler'] }
    : {};

  if (!truck.length || !truck.width || !truck.height || !floorZones.length) {
    output.unpacked = items.map(item => item.id);
    output.warnings.push('AutoPack floor solver skipped: missing truck dimensions or usable zones.');
    output.rejectionReasons = items.map(item => makeRejectionReason(
      item.id,
      REJECTION_CODES.NO_USABLE_SPACE,
      'floor',
      'Missing truck dimensions or usable zones.'
    ));
    output.phaseStats.unpackedCount = output.unpacked.length;
    output.solveStatus = summarizeSolveStatus(output.unpacked, output.rejectionReasons);
    return output;
  }

  // Structured rejection reasons for items the main loop cannot place. Recorded
  // per id and merged at the end so an item later placed by the wheel-well pass
  // (or re-staged by validation with a more specific reason) is never mislabeled.
  const mainLoopRejections = new Map();

  // Solve-time budget: the interactive engine passes solveBudgetMs so a huge
  // load returns the best PARTIAL plan instead of freezing the tab. Default is
  // unlimited (deterministic) for pure/offline callers. When the budget trips,
  // remaining queue items are staged with a structured reason; everything
  // already placed still goes through full validation below — hard rules are
  // never relaxed for speed.
  // Cleanup contract: when the MAIN budget trips, placement search stops and
  // remaining items stage with honest reasons — but a BOUNDED cleanup window
  // still runs leftover recovery, compaction, and front compression so the
  // returned layout is never an abruptly-truncated, uncompacted mess.
  const budget = createSolveBudget(input.solveBudgetMs, undefined, input.cleanupBudgetMs);
  let budgetExhausted = false;
  const stopForBudget = (remainingItems, phase) => {
    budgetExhausted = true;
    for (const leftover of remainingItems) {
      output.unpacked.push(leftover.id);
      mainLoopRejections.set(leftover.id, makeRejectionReason(
        leftover.id,
        REJECTION_CODES.SOLVE_BUDGET_EXCEEDED,
        phase,
        'AutoPack reached its time budget before this item could be tried; it was staged.'
      ));
    }
  };

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
  let stackCount = 0;
  // Strategy mechanics (packing-core/solution.js registers the presets):
  // - enableStackPhase:false → floor-first: nothing is ever lifted onto cargo.
  // - stackFallbackImmediate → stack-priority: an item that fails the floor is
  //   offered a safe supported stack right away instead of waiting for the
  //   final stack phase (favors vertical use over floor spread).
  const stackPhaseEnabled = input.enableStackPhase !== false;
  const stackFallbackImmediate = stackPhaseEnabled && input.stackFallbackImmediate === true;
  const wheelWellBridgeGeometry = input.enableWheelWellBridge === true ? wheelWell : null;
  const tryImmediateStack = item => {
    if (!stackFallbackImmediate) return false;
    const stackPlacement = findStackPlacement(
      item,
      floorZones,
      packed,
      loadFrontFirst,
      layoutQualityEnabled,
      retentionContext,
      wheelWellBridgeGeometry,
      budget
    );
    if (!stackPlacement) return false;
    recordPlacement(output, packed, item, stackPlacement, 'stack');
    stackCount++;
    return true;
  };

  for (let i = 0; i < laneItems.length; i++) {
    if (budget.expired()) {
      stopForBudget(laneItems.slice(i), 'lane');
      break;
    }
    const item = laneItems[i];
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

  // constrained-space-first strategy: reserve the constrained (narrower) zones
  // by filling them with best-fitting cargo BEFORE the open full-width floor
  // phases consume the flexible items — wide cargo that can never use a narrow
  // channel keeps the open zones. Geometry-driven (zones narrower than the
  // widest zone), so Standard and Front Overhang have no constrained zones and
  // are untouched. Every placement goes through the ordinary hard-rule floor
  // pipeline; occupancy is mirrored into the main floor state so later phases
  // see the reserved space.
  const constrainedReserved = new Set();
  if (input.constrainedSpaceFirst === true) {
    const constrainedZones = narrowChannelZones(floorZones);
    if (constrainedZones.length) {
      const constrainedState = createFloorState(constrainedZones, frontSurfaceFirst, retentionContext);
      const maxConstrainedWidth = Math.max(...constrainedZones.map(zone => zone.max.z - zone.min.z));
      const fitting = sortConstrainedLeftoverQueue(
        nonLaneItems.filter(item => item.candidates.some(o => o.w <= maxConstrainedWidth + FREE_RECT_EPS)),
        constrainedZones
      );
      for (const item of fitting) {
        if (budget.expired()) break;
        const placement = findFloorPlacement(item, constrainedState, packed, loadFrontFirst, { layoutQualityEnabled });
        if (!placement) continue;
        recordPlacement(output, packed, item, placement, 'floor');
        occupyFloorSpace(constrainedState, placement);
        occupyFloorSpace(floorState, placement);
        constrainedReserved.add(item);
        floorCount++;
      }
    }
  }

  const remainingNonLaneItems = placeRepeatedFloorBatches(
    constrainedReserved.size
      ? nonLaneItems.filter(item => !constrainedReserved.has(item))
      : nonLaneItems,
    floorState,
    packed,
    output,
    loadFrontFirst,
    frontSurfaceFirst,
    budget
  );
  const mainFloorItems = sortItemsForFloor(
    remainingNonLaneItems.filter(item => item.className !== 'FILLER'),
    frontSurfaceFirst,
    items
  );
  const fillerItems = remainingNonLaneItems.filter(item => item.className === 'FILLER');

  for (let i = 0; i < mainFloorItems.length; i++) {
    if (budget.expired()) {
      stopForBudget(mainFloorItems.slice(i), 'floor');
      break;
    }
    const item = mainFloorItems[i];
    const placement = findFloorPlacement(item, floorState, packed, loadFrontFirst, { layoutQualityEnabled });
    if (!placement) {
      if (tryImmediateStack(item)) continue;
      deferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'floor');
    occupyFloorSpace(floorState, placement);
    floorCount++;
  }

  // Compaction is a quality pass over already-valid placements — it runs while
  // the bounded CLEANUP window remains (with internal per-placement budget
  // checks) so a main-budget hit still gets a tidy layout, never unbounded.
  floorState.freeRects = (budget.cleanupExpired()
    ? rebuildFloorStateFromPacked(floorZones, packed, frontSurfaceFirst, retentionContext)
    : compactFloorPlacements(
      output,
      packed,
      floorZones,
      loadFrontFirst,
      frontSurfaceFirst,
      retentionContext,
      { ...floorCompactionOptions, budget }
    )).freeRects;

  const fillerQueue = [
    ...sortItemsForFloor(deferred, frontSurfaceFirst, items),
    ...sortItemsForFiller(fillerItems, frontSurfaceFirst, items),
  ];
  const stackDeferred = [];
  for (let i = 0; i < fillerQueue.length; i++) {
    if (budget.expired()) {
      stopForBudget(fillerQueue.slice(i), 'filler');
      break;
    }
    const item = fillerQueue[i];
    const placement = findFloorPlacement(item, floorState, packed, loadFrontFirst, { layoutQualityEnabled });
    if (!placement) {
      if (tryImmediateStack(item)) continue;
      stackDeferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'filler');
    occupyFloorSpace(floorState, placement);
    fillerCount++;
  }

  floorState.freeRects = (budget.cleanupExpired()
    ? rebuildFloorStateFromPacked(floorZones, packed, frontSurfaceFirst, retentionContext)
    : compactFloorPlacements(
      output,
      packed,
      floorZones,
      loadFrontFirst,
      frontSurfaceFirst,
      retentionContext,
      { ...floorCompactionOptions, budget }
    )).freeRects;

  // Wheel Wells physical geometry (null for every other truck mode). Wheel-well
  // candidates are considered inside the ordinary stack scorer below, so the
  // global order remains gravity-like: lower valid stack levels beat higher
  // well-top/bridge placements, then front position breaks ties.
  const itemsById = new Map(items.map(it => [it.id, it]));
  let stackQueue = sortItemsForStack(stackDeferred, layoutQualityEnabled, items);

  if (stackPhaseEnabled && stackQueue.length && !budget.expired()) {
    const beforeBatch = stackQueue.length;
    stackQueue = placeRepeatedStackBatches(
      stackQueue,
      floorZones,
      packed,
      output,
      loadFrontFirst,
      layoutQualityEnabled,
      retentionContext,
      wheelWellBridgeGeometry,
      budget
    );
    stackCount += beforeBatch - stackQueue.length;
    if (stackQueue.length && !budget.cleanupExpired()) {
      const deckFill = placeFrontOverhangDeckFill(
        stackQueue,
        output,
        packed,
        retentionContext,
        loadFrontFirst,
        budget,
        items
      );
      stackQueue = deckFill.remaining;
      floorCount += deckFill.placed;
    }
    if (output.unpacked.length && !budget.cleanupExpired()) {
      floorCount += placeFrontOverhangDeckFillFromUnpacked(
        output,
        packed,
        itemsById,
        retentionContext,
        loadFrontFirst,
        budget,
        items
      );
    }
  }

  for (let i = 0; i < stackQueue.length; i++) {
    if (budget.expired()) {
      stopForBudget(stackQueue.slice(i), 'stack');
      break;
    }
    const item = stackQueue[i];
    // floor-first strategy: never lift cargo onto other cargo — an item that
    // found no floor position stays staged with an honest reason.
    const placement = stackPhaseEnabled
      ? findStackPlacement(
        item,
        floorZones,
        packed,
        loadFrontFirst,
        layoutQualityEnabled,
        retentionContext,
        wheelWellBridgeGeometry,
        budget
      )
      : null;
    if (!placement) {
      output.unpacked.push(item.id);
      const warning = !stackPhaseEnabled
        ? `Item ${item.id} could not fit on the floor (stacking is disabled by the floor-first strategy).`
        : item.lanePlacementFailed
          ? `Lane item ${item.id} could not fit in a safe lengthwise lane or any fallback floor/stack position.`
          : `Item ${item.id} could not fit on the floor or on a safe supported stack.`;
      output.warnings.push(warning);
      mainLoopRejections.set(item.id, !stackPhaseEnabled
        ? makeRejectionReason(item.id, REJECTION_CODES.NO_FLOOR_CANDIDATE, 'floor', warning)
        : diagnoseUnplacedItem(item, floorZones, wheelWell, warning));
      continue;
    }

    recordPlacement(output, packed, item, placement, 'stack');
    stackCount++;
    if (!budget.cleanupExpired()) {
      if (i + 1 < stackQueue.length) {
        const deckFill = placeFrontOverhangDeckFill(
          stackQueue.slice(i + 1),
          output,
          packed,
          retentionContext,
          loadFrontFirst,
          budget,
          items
        );
        if (deckFill.placed) {
          stackQueue = [...stackQueue.slice(0, i + 1), ...deckFill.remaining];
          floorCount += deckFill.placed;
        }
      }
      if (output.unpacked.length) {
        floorCount += placeFrontOverhangDeckFillFromUnpacked(
          output,
          packed,
          itemsById,
          retentionContext,
          loadFrontFirst,
          budget,
          items
        );
      }
    }
  }

  // Carry wheel-well geometry into validation as defence in depth. The remaining
  // opt-in pass is a final leftover sweep; production Wheel Wells now also runs
  // the same safe well-top logic before ordinary stacking so front/middle support
  // opportunities are not starved by rear stack placements.
  if (wheelWell && input.enableWheelWellBridge === true && stackPhaseEnabled && !budget.cleanupExpired()) {
    stackCount += placeWheelWellBuildUpBridges(output, packed, itemsById, wheelWell, loadFrontFirst);
  }

  // If the main/stack phases naturally created deck-height retention at the
  // overhang step, immediately fill retained deck sections from staged
  // leftovers. The generic leftover pass below can still fill other legal holes.
  if (retentionContext?.geometry && output.unpacked.length && !budget.cleanupExpired()) {
    floorCount += placeFrontOverhangDeckFillFromUnpacked(
      output,
      packed,
      itemsById,
      retentionContext,
      loadFrontFirst,
      budget,
      items
    );
  }

  // Front Overhang deck enablement: intentionally complete the retaining wall
  // from leftovers so the raised deck becomes legally usable (C2 retention
  // rules unchanged). The leftover recovery below then fills the deck through
  // the ordinary hard-rule pipeline, which still gates every deck pose on the
  // real barrier via candidateHasRearRetention.
  if (retentionContext?.geometry && input.enableDeckRetentionWall !== false && !budget.cleanupExpired()) {
    floorCount += buildDeckRetentionWall(output, packed, itemsById, retentionContext, budget);
    if (output.unpacked.length && !budget.cleanupExpired()) {
      floorCount += placeFrontOverhangDeckFillFromUnpacked(
        output,
        packed,
        itemsById,
        retentionContext,
        loadFrontFirst,
        budget,
        items
      );
    }
  }

  // Leftover recovery (all space types): retry staged leftovers into remaining
  // legal floor holes — and, when nothing at floor level works, one final safe
  // supported stack/raised attempt against the FINAL layout (compaction and
  // earlier leftovers changed the world since each item's original attempt).
  // Channel-fitting and smaller cartons go first in constrained geometries.
  // Runs BEFORE final validation so every rescued placement is re-checked by
  // the same hard-rule pipeline as everything else.
  // Leftover recovery is the last chance for staged items — including items
  // the MAIN budget staged — so it runs under the bounded cleanup window.
  const leftoverPassEnabled = input.enableLeftoverPass !== false &&
    (!wheelWell || input.enableWheelWellLeftoverPass !== false);
  if (leftoverPassEnabled && !budget.cleanupExpired()) {
    const MAX_LEFTOVER_RECOVERY_PASSES = 4;
    for (let pass = 0; pass < MAX_LEFTOVER_RECOVERY_PASSES; pass++) {
      if (!output.unpacked.length || budget.cleanupExpired()) break;
      const placedThisPass = placeLeftoverRecovery(
        output,
        packed,
        itemsById,
        floorZones,
        loadFrontFirst,
        retentionContext,
        wheelWell,
        layoutQualityEnabled,
        wheelWellBridgeGeometry,
        budget,
        stackPhaseEnabled
      );
      if (!placedThisPass) break;
      fillerCount += placedThisPass;
    }
  }

  if (budgetExhausted) {
    output.warnings.push(
      `AutoPack reached its ${Math.round(budget.limitMs)}ms time budget and returned the best partial plan; ` +
      'remaining items were staged.'
    );
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

  const runWheelWellFrontCompression =
    wheelWell &&
    !budget.cleanupExpired() &&
    input.enableWheelWellFrontCompression !== false &&
    (input.enableWheelWellFrontCompression === true || packed.length <= MAX_DEFAULT_FRONT_COMPRESSION_PLACEMENTS);
  if (runWheelWellFrontCompression) {
    compressWheelWellPlacementsForward(
      output,
      packed,
      floorZones,
      loadFrontFirst,
      retentionContext,
      wheelWell,
      budget
    );
  }

  output.phaseStats.laneCount = laneCount;
  output.phaseStats.floorCount = floorCount;
  output.phaseStats.stackCount = stackCount;
  output.phaseStats.fillerCount = fillerCount;
  output.phaseStats.unpackedCount = output.unpacked.length;
  refreshPhaseStats(output, packed);
  recordRetentionDependencies(output, packed, retentionContext);
  // Merge main-loop diagnoses for items that stayed unplaced. Validation-staged
  // items already carry their (more specific) validation reason; items rescued by
  // the wheel-well pass are no longer unpacked and get no reason.
  const explained = new Set(output.rejectionReasons.map(reason => reason.instanceId));
  for (const id of output.unpacked) {
    if (explained.has(id)) continue;
    const reason = mainLoopRejections.get(id);
    if (reason) output.rejectionReasons.push(reason);
  }
  // Completion contract: complete vs partial, and WHY it is partial
  // (fit / safety / rules / budget) — derived from the structured reasons.
  output.solveStatus = summarizeSolveStatus(output.unpacked, output.rejectionReasons);
  return output;
}
