import { CONTAINMENT_EPS_INCHES } from './pack-library.js';
import { canonicalOrientationLock } from '../core/orientation.js';

const RIGHT_ANGLE_RAD = Math.PI / 2;
const LONG_RATIO = 4;
const LONG_MIN_IN = 96;
const HEAVY_LBS = 150;
const FILLER_IN3 = 6000;
const MIN_SUPPORT_FRACTION = 0.5;
const CONTACT_EPS = 0.05;
const FREE_RECT_EPS = 0.05;
const BASE_ANCHOR_CAP = 18;
const MAX_ANCHOR_CAP = 24;
const REPEATED_BATCH_MIN = 8;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback = 0) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function normalizeRightAngle(value) {
  let turns = Math.round((Number(value) || 0) / RIGHT_ANGLE_RAD) % 4;
  if (turns < 0) turns += 4;
  return turns * RIGHT_ANGLE_RAD;
}

function normalizeRightAngleRotation(rotation = {}) {
  return {
    x: normalizeRightAngle(rotation.x),
    y: normalizeRightAngle(rotation.y),
    z: normalizeRightAngle(rotation.z),
  };
}

function readDims(dims = {}) {
  return {
    l: positiveNumber(dims.l ?? dims.length, 0),
    w: positiveNumber(dims.w ?? dims.width, 0),
    h: positiveNumber(dims.h ?? dims.height, 0),
  };
}

function rotateVectorXYZ(vec, rotation) {
  let x = vec.x;
  let y = vec.y;
  let z = vec.z;
  const rx = normalizeRightAngle(rotation.x);
  const ry = normalizeRightAngle(rotation.y);
  const rz = normalizeRightAngle(rotation.z);

  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  y = y1;
  z = z1;

  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const x2 = x * cosY + z * sinY;
  const z2 = -x * sinY + z * cosY;
  x = x2;
  z = z2;

  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const x3 = x * cosZ - y * sinZ;
  const y3 = x * sinZ + y * cosZ;
  return { x: x3, y: y3, z };
}

function getOrientedDimsForRotation(dims, rotation) {
  const d = readDims(dims);
  const locked = normalizeRightAngleRotation(rotation);
  const axes = [
    rotateVectorXYZ({ x: d.l, y: 0, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: d.h, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: 0, z: d.w }, locked),
  ];
  const out = axes.reduce(
    (acc, axis) => ({
      l: acc.l + Math.abs(axis.x),
      h: acc.h + Math.abs(axis.y),
      w: acc.w + Math.abs(axis.z),
    }),
    { l: 0, w: 0, h: 0 }
  );
  return {
    l: Math.round(out.l * 1e6) / 1e6,
    w: Math.round(out.w * 1e6) / 1e6,
    h: Math.round(out.h * 1e6) / 1e6,
  };
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

  function add(l, w, h, x, y, z) {
    const key = `${l}|${w}|${h}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(makeCandidate(l, w, h, { x, y, z }));
  }

  if (lock === 'upright' || lock === 'any') {
    add(d.l, d.w, d.h, 0, 0, 0);
    add(d.w, d.l, d.h, 0, RIGHT_ANGLE_RAD, 0);
  }

  if (lock === 'onSide') {
    add(d.h, d.w, d.l, 0, 0, RIGHT_ANGLE_RAD);
    add(d.w, d.h, d.l, RIGHT_ANGLE_RAD, 0, RIGHT_ANGLE_RAD);
  }

  // canFlip may only introduce tipped (non-upright) faces when the case policy
  // is 'any'. 'upright' must keep the item upright even when canFlip is true,
  // and 'onside' already produced its side faces above. This matches the manual
  // rotate policy in pack-library.isOrientationAllowedByCasePolicy.
  if (canFlip && lock === 'any') {
    add(d.h, d.w, d.l, 0, 0, RIGHT_ANGLE_RAD);
    add(d.w, d.h, d.l, RIGHT_ANGLE_RAD, 0, RIGHT_ANGLE_RAD);
    add(d.l, d.h, d.w, RIGHT_ANGLE_RAD, 0, 0);
    add(d.h, d.l, d.w, RIGHT_ANGLE_RAD, RIGHT_ANGLE_RAD, 0);
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

function sortItemsForFloor(items) {
  return [...items].sort((a, b) => {
    const footprintDelta = b.footprint - a.footprint;
    if (footprintDelta) return footprintDelta;
    const weightDelta = b.weight - a.weight;
    if (weightDelta) return weightDelta;
    const volumeDelta = b.volume - a.volume;
    if (volumeDelta) return volumeDelta;
    const priorityDelta = finiteNumber(b.item.loadPriority, 0) - finiteNumber(a.item.loadPriority, 0);
    if (priorityDelta) return priorityDelta;
    return a.index - b.index;
  });
}

function sortItemsForFiller(items) {
  return [...items].sort((a, b) => {
    const footprintDelta = a.footprint - b.footprint;
    if (footprintDelta) return footprintDelta;
    const volumeDelta = a.volume - b.volume;
    if (volumeDelta) return volumeDelta;
    const priorityDelta = finiteNumber(b.item.loadPriority, 0) - finiteNumber(a.item.loadPriority, 0);
    if (priorityDelta) return priorityDelta;
    const weightDelta = b.weight - a.weight;
    if (weightDelta) return weightDelta;
    return a.index - b.index;
  });
}

function sortItemsForStack(items) {
  return [...items].sort((a, b) => {
    const weightDelta = b.weight - a.weight;
    if (weightDelta) return weightDelta;
    const footprintDelta = b.footprint - a.footprint;
    if (footprintDelta) return footprintDelta;
    const volumeDelta = b.volume - a.volume;
    if (volumeDelta) return volumeDelta;
    return a.index - b.index;
  });
}

function sortItemsForLane(items) {
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
    return a.index - b.index;
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

function createFloorState(zones) {
  return {
    freeRects: normalizeFreeRects(zones.map((zone, index) => makeFreeRect(zone, index))),
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

function scoreFreeRectCandidate(candidate, loadFrontFirst, packed = []) {
  const rect = candidate.freeRect;
  const leftoverX = Math.max(0, freeRectLength(rect) - candidate.dims.l);
  const leftoverZ = Math.max(0, freeRectWidth(rect) - candidate.dims.w);
  const wasteArea = Math.max(0, freeRectArea(rect) - candidate.dims.l * candidate.dims.w);
  const wallContacts = wallContactCount(candidate.aabb, candidate.zone, loadFrontFirst);
  const faceContacts = countFaceContacts(candidate.aabb, packed);
  const xPrimary = loadFrontFirst ? -candidate.aabb.max.x : candidate.aabb.min.x;
  const contactScore = wallContacts + Math.min(8, faceContacts);
  return [
    candidate.aabb.min.y,
    -contactScore,
    Math.min(leftoverX, leftoverZ),
    wasteArea,
    xPrimary,
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

function findFloorPlacement(item, floorState, packed, loadFrontFirst) {
  let best = null;
  let bestScore = null;

  for (const orientation of item.candidates) {
    for (const candidate of buildFreeRectCandidates(orientation, floorState, loadFrontFirst, packed)) {
      if (!isAabbContainedInZone(candidate.aabb, candidate.zone)) continue;
      if (collidesPacked(candidate.aabb, packed)) continue;
      const score = scoreFreeRectCandidate(candidate, loadFrontFirst, packed);
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

function scoreLaneCandidate(candidate, orientation, loadFrontFirst) {
  const xPrimary = loadFrontFirst ? -candidate.aabb.max.x : candidate.aabb.min.x;
  const rectWaste = candidate.freeRect
    ? Math.max(0, freeRectArea(candidate.freeRect) - orientation.l * orientation.w)
    : 0;
  return [
    -orientation.l,
    candidate.aabb.min.y,
    rectWaste,
    candidate.aabb.min.z,
    xPrimary,
    orientation.w,
  ];
}

function findLanePlacement(item, floorState, packed, loadFrontFirst) {
  let best = null;
  let bestScore = null;

  for (const orientation of getLaneOrientations(item)) {
    for (const candidate of buildFreeRectCandidates(orientation, floorState, loadFrontFirst, packed)) {
      if (!isAabbContainedInZone(candidate.aabb, candidate.zone)) continue;
      if (collidesPacked(candidate.aabb, packed)) continue;
      const score = scoreLaneCandidate(candidate, orientation, loadFrontFirst);
      if (!best || compareScore(score, bestScore) < 0) {
        best = { ...candidate, orientation };
        bestScore = score;
      }
    }
  }

  return best;
}

function repeatedBatchKey(item) {
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
    String(source.orientationLock || 'any'),
    lockKey,
    source.noStackOnTop === true ? 'no-top' : 'top-ok',
    source.stackable === false ? 'no-stack' : 'stack-ok',
    finiteNumber(source.maxStackCount, 0),
  ].join('|');
}

function buildRepeatedBatches(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = repeatedBatchKey(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()]
    .filter(group => group.length >= REPEATED_BATCH_MIN)
    .sort((a, b) => {
      const footprintDelta = b[0].footprint - a[0].footprint;
      if (footprintDelta) return footprintDelta;
      const weightDelta = repeatedGroupWeight(b) - repeatedGroupWeight(a);
      if (weightDelta) return weightDelta;
      const countDelta = b.length - a.length;
      if (countDelta) return countDelta;
      return a[0].index - b[0].index;
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
        const item = queue.shift();
        item.candidates = [orientation];
        const placement = { position, dims, aabb, zone: rect.zone, freeRect: rect, orientation, lockedGrid: true };
        recordPlacement(output, packed, item, placement, 'floor');
        occupyFloorSpace(floorState, placement);
      }
    }
  }

  for (const item of queue) {
    item.candidates = [orientation];
  }
  return queue;
}

function placeRepeatedFloorBatches(items, floorState, packed, output, loadFrontFirst) {
  const remaining = new Set(items || []);
  for (const group of buildRepeatedBatches(items)) {
    const activeGroup = group.filter(item => remaining.has(item));
    if (activeGroup.length < REPEATED_BATCH_MIN) continue;
    const orientation = chooseRepeatedBatchOrientation(activeGroup, floorState);
    if (!orientation) continue;
    const notPlaced = placeRepeatedBatchFloor(activeGroup, orientation, floorState, packed, output, loadFrontFirst);
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

function scoreStackCandidate(candidate, loadFrontFirst) {
  const xPrimary = loadFrontFirst ? -candidate.aabb.max.x : candidate.aabb.min.x;
  const wasteArea = candidate.freeRect
    ? Math.max(0, freeRectArea(candidate.freeRect) - candidate.dims.l * candidate.dims.w)
    : 0;
  return [
    candidate.aabb.min.y,
    -candidate.supportFraction,
    wasteArea,
    xPrimary,
    candidate.aabb.min.z,
  ];
}

function findStackPlacement(item, zones, packed, loadFrontFirst) {
  let best = null;
  let bestScore = null;
  const yLevels = uniqueSorted(
    packed
      .filter(placement => canSupportStack(placement) && hasStackCapacity(placement, packed))
      .map(placement => placement.aabb.max.y),
    (a, b) => a - b
  );

  for (const orientation of item.candidates) {
    for (const yLevel of yLevels) {
      for (const candidate of buildStackCandidates(orientation, packed, yLevel, loadFrontFirst)) {
        if (!isAabbContainedInAnyZone(candidate.aabb, zones)) continue;
        if (collidesPacked(candidate.aabb, packed)) continue;
        if (!supportsCandidate(candidate.aabb, packed, item)) continue;

        const supports = getCandidateSupports(candidate.aabb, packed)
          .filter(candidateSupport =>
            canSupportStack(candidateSupport) &&
            canSupportCandidateWeight(item, candidateSupport)
          );
        const supportFraction = computeSupportFraction(candidate.aabb, supports);
        const scoredCandidate = { ...candidate, supportFraction, orientation };
        const score = scoreStackCandidate(scoredCandidate, loadFrontFirst);
        if (!best || compareScore(score, bestScore) < 0) {
          best = scoredCandidate;
          bestScore = score;
        }
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

function scoreCompactionCandidate(aabb, zone, loadFrontFirst, others) {
  const xPrimary = loadFrontFirst ? -aabb.max.x : aabb.min.x;
  const contactScore = wallContactCount(aabb, zone, loadFrontFirst) + Math.min(8, countFaceContacts(aabb, others));
  const sideDistance = Math.min(
    Math.abs(aabb.min.z - zone.min.z),
    Math.abs(aabb.max.z - zone.max.z)
  );
  return [
    xPrimary,
    -contactScore,
    sideDistance,
    aabb.min.z,
  ];
}

function compactFloorPlacements(output, packed, zones, loadFrontFirst) {
  const compactable = packed.filter(placement =>
    !placement.lockedGrid &&
    placement.phase !== 'stack' &&
    isPlacementOnZoneFloor(placement.aabb, zones)
  );
  if (!compactable.length) return rebuildFloorStateFromPacked(zones, packed);

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
      let bestScore = scoreCompactionCandidate(placement.aabb, zone, loadFrontFirst, others);

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
          const score = scoreCompactionCandidate(aabb, zone, loadFrontFirst, others);
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
  return rebuildFloorStateFromPacked(zones, packed);
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
  const accepted = [];
  const rejected = [];

  for (const placement of packed) {
    let reason = '';
    if (!isAabbContainedInAnyZone(placement.aabb, zones)) {
      reason = 'outside usable zones';
    } else if (collidesPacked(placement.aabb, accepted)) {
      reason = 'overlaps another packed item';
    } else if (
      !isPlacementOnZoneFloor(placement.aabb, zones) &&
      !supportsCandidate(placement.aabb, accepted, placement.item)
    ) {
      reason = 'does not have safe stack support';
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

function rebuildFloorStateFromPacked(zones, packed) {
  const floorState = createFloorState(zones);
  for (const placement of packed) {
    if (!isPlacementOnZoneFloor(placement.aabb, zones)) continue;
    occupyFloorSpace(floorState, placement);
  }
  return floorState;
}

function repackRejectedPlacements(output, accepted, rejected, zones, loadFrontFirst) {
  if (!rejected.length) return { packed: accepted, rejected: [] };
  const repacked = [...accepted];
  const floorState = rebuildFloorStateFromPacked(zones, repacked);
  const stillRejected = [];

  writeOutputPlacements(output, repacked);

  const retryQueue = [...rejected].sort((a, b) => {
    const yDelta = a.placement.aabb.min.y - b.placement.aabb.min.y;
    if (yDelta) return yDelta;
    return a.placement.item.index - b.placement.item.index;
  });

  for (const rejectedPlacement of retryQueue) {
    const item = rejectedPlacement.placement.item;
    const floorPlacement = findFloorPlacement(item, floorState, repacked, loadFrontFirst);
    if (floorPlacement) {
      recordPlacement(output, repacked, item, floorPlacement, 'floor');
      occupyFloorSpace(floorState, floorPlacement);
      continue;
    }

    const stackPlacement = findStackPlacement(item, zones, repacked, loadFrontFirst);
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

export function solveAutoPack(input = {}) {
  const truck = normalizeTruck(input.truck || {});
  const zones = normalizeZones(input.zones || []);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const output = makeEmptyOutput();
  if (!rawItems.length) return output;

  const items = rawItems.map(normalizeItem);
  const loadFrontFirst = input.loadFrontFirst === true || input.loadDirection === 'front_to_rear';
  const floorZones = sortZonesForFloor(zones, loadFrontFirst);
  const floorState = createFloorState(floorZones);
  const packed = [];

  if (!truck.length || !truck.width || !truck.height || !floorZones.length) {
    output.unpacked = items.map(item => item.id);
    output.warnings.push('AutoPack floor solver skipped: missing truck dimensions or usable zones.');
    output.phaseStats.unpackedCount = output.unpacked.length;
    return output;
  }

  const deferred = [];
  const laneItems = sortItemsForLane(items.filter(item => item.className === 'LANE_ITEM'));
  const nonLaneItems = items.filter(item => item.className !== 'LANE_ITEM');
  let laneCount = 0;
  let floorCount = 0;
  let fillerCount = 0;

  for (const item of laneItems) {
    const placement = findLanePlacement(item, floorState, packed, loadFrontFirst);
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
    loadFrontFirst
  );
  const mainFloorItems = sortItemsForFloor(remainingNonLaneItems.filter(item =>
    item.className !== 'FILLER'
  ));
  const fillerItems = remainingNonLaneItems.filter(item => item.className === 'FILLER');

  for (const item of mainFloorItems) {
    const placement = findFloorPlacement(item, floorState, packed, loadFrontFirst);
    if (!placement) {
      deferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'floor');
    occupyFloorSpace(floorState, placement);
    floorCount++;
  }

  floorState.freeRects = compactFloorPlacements(output, packed, floorZones, loadFrontFirst).freeRects;

  const fillerQueue = [
    ...sortItemsForFloor(deferred),
    ...sortItemsForFiller(fillerItems),
  ];
  const stackDeferred = [];
  for (const item of fillerQueue) {
    const placement = findFloorPlacement(item, floorState, packed, loadFrontFirst);
    if (!placement) {
      stackDeferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'filler');
    occupyFloorSpace(floorState, placement);
    fillerCount++;
  }

  floorState.freeRects = compactFloorPlacements(output, packed, floorZones, loadFrontFirst).freeRects;

  let stackCount = 0;
  for (const item of sortItemsForStack(stackDeferred)) {
    const placement = findStackPlacement(item, floorZones, packed, loadFrontFirst);
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

  const initialValidation = validatePackedPlacements(output, packed, floorZones, { stageRejected: false });
  const repackedValidation = repackRejectedPlacements(
    output,
    initialValidation.accepted,
    initialValidation.rejected,
    floorZones,
    loadFrontFirst
  );
  const finalValidation = validatePackedPlacements(output, repackedValidation.packed, floorZones, { stageRejected: false });
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
  return output;
}
