const RIGHT_ANGLE_RAD = Math.PI / 2;
const LONG_RATIO = 3;
const LONG_MIN_IN = 72;
const HEAVY_LBS = 150;
const FILLER_IN3 = 6000;
const MIN_SUPPORT_FRACTION = 0.5;
const CONTACT_EPS = 0.05;
const COMPACTION_PASSES = 3;

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

  const rawLock = String(item.orientationLock || 'any').trim().toLowerCase();
  const lock = rawLock === 'onside' || rawLock === 'on-side' ? 'onside' : rawLock;
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

  if (lock === 'onside') {
    add(d.h, d.w, d.l, 0, 0, RIGHT_ANGLE_RAD);
    add(d.w, d.h, d.l, RIGHT_ANGLE_RAD, 0, RIGHT_ANGLE_RAD);
  }

  if (canFlip && lock !== 'onside') {
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
  const dims = readDims(item.dims || item.dimensions || item.orientedDims);
  const sorted = [dims.l, dims.w, dims.h].sort((a, b) => b - a);
  const longest = sorted[0] || 0;
  const middle = sorted[1] || 1;
  const shape = String(item.shape || '').trim().toLowerCase();
  const laneByShape = shape === 'cylinder' || shape === 'drum';
  const laneByDims = longest >= LONG_MIN_IN || longest / Math.max(1, middle) >= LONG_RATIO;

  if (item.laneItem === true) return 'LANE_ITEM';
  if (item.laneItem !== false && (laneByShape || laneByDims)) return 'LANE_ITEM';
  if (item.noStackOnTop || item.stackable === false) return 'FRAGILE_BASE';
  if (finiteNumber(item.weight, 0) >= HEAVY_LBS) return 'HEAVY_BASE';
  if (dims.l * dims.w * dims.h <= FILLER_IN3) return 'FILLER';
  return 'STANDARD';
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

function isAabbContainedInZone(aabb, zone, epsilon = 0.05) {
  return aabb.min.x >= zone.min.x - epsilon &&
    aabb.max.x <= zone.max.x + epsilon &&
    aabb.min.y >= zone.min.y - epsilon &&
    aabb.max.y <= zone.max.y + epsilon &&
    aabb.min.z >= zone.min.z - epsilon &&
    aabb.max.z <= zone.max.z + epsilon;
}

export function isAabbContainedInAnyZone(aabb, zones = [], epsilon = 0.05) {
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

  return {
    id,
    item,
    dims,
    candidates,
    volume: dims.l * dims.w * dims.h,
    footprint: dims.l * dims.w,
    weight: finiteNumber(item.weight, 0),
    index,
    className: classifyAutoPackItem({ ...item, dims }),
  };
}

function sortItemsForFloor(items) {
  return [...items].sort((a, b) => {
    const priorityDelta = finiteNumber(b.item.loadPriority, 0) - finiteNumber(a.item.loadPriority, 0);
    if (priorityDelta) return priorityDelta;
    const footprintDelta = b.footprint - a.footprint;
    if (footprintDelta) return footprintDelta;
    const weightDelta = b.weight - a.weight;
    if (weightDelta) return weightDelta;
    const volumeDelta = b.volume - a.volume;
    if (volumeDelta) return volumeDelta;
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
    const weightDelta = a.weight - b.weight;
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
    const priorityDelta = finiteNumber(b.item.loadPriority, 0) - finiteNumber(a.item.loadPriority, 0);
    if (priorityDelta) return priorityDelta;
    const maxLength = item => Math.max(0, ...item.candidates.map(candidate => candidate.l));
    const minWidth = item => Math.min(Infinity, ...item.candidates.map(candidate => candidate.w));
    const lengthDelta = maxLength(b) - maxLength(a);
    if (lengthDelta) return lengthDelta;
    const widthDelta = minWidth(a) - minWidth(b);
    if (widthDelta) return widthDelta;
    const volumeDelta = b.volume - a.volume;
    if (volumeDelta) return volumeDelta;
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

function buildFloorCandidates(candidate, zone, packed, loadFrontFirst) {
  const xMins = [
    zone.min.x,
    zone.max.x - candidate.l,
  ];
  const zMins = [
    zone.min.z,
    zone.max.z - candidate.w,
  ];
  for (const placement of packed) {
    const p = placement.aabb;
    xMins.push(
      p.max.x,
      p.min.x - candidate.l,
      p.min.x,
      p.max.x - candidate.l
    );
    zMins.push(
      p.max.z,
      p.min.z - candidate.w,
      p.min.z,
      p.max.z - candidate.w
    );
  }

  const sortedX = uniqueSorted(xMins, (a, b) => loadFrontFirst ? b - a : a - b);
  const sortedZ = uniqueSorted(zMins, (a, b) => a - b);
  const placements = [];

  for (const xMin of sortedX) {
    for (const zMin of sortedZ) {
      const x = xMin + candidate.l / 2;
      const y = zone.min.y + candidate.h / 2;
      const z = zMin + candidate.w / 2;
      const position = { x, y, z };
      const dims = { l: candidate.l, w: candidate.w, h: candidate.h };
      const aabb = getAabb(position, dims);
      placements.push({ position, dims, aabb, zone });
    }
  }

  return placements;
}

function scoreFloorCandidate(candidate, loadFrontFirst, packed = []) {
  const xPrimary = loadFrontFirst ? -candidate.aabb.max.x : candidate.aabb.min.x;
  const wallContacts = wallContactCount(candidate.aabb, candidate.zone, loadFrontFirst);
  const faceContacts = countFaceContacts(candidate.aabb, packed);
  return [
    xPrimary,
    candidate.aabb.min.y,
    candidate.dims.w,
    -(wallContacts + Math.min(3, faceContacts)),
    candidate.aabb.min.z,
    candidate.dims.h,
    candidate.dims.l * candidate.dims.w,
  ];
}

function compareScore(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function findFloorPlacement(item, zones, packed, loadFrontFirst) {
  let best = null;
  let bestScore = null;

  for (const orientation of item.candidates) {
    for (const zone of zones) {
      if (orientation.l > zone.max.x - zone.min.x + 0.05) continue;
      if (orientation.w > zone.max.z - zone.min.z + 0.05) continue;
      if (orientation.h > zone.max.y - zone.min.y + 0.05) continue;

      for (const candidate of buildFloorCandidates(orientation, zone, packed, loadFrontFirst)) {
        if (!isAabbContainedInAnyZone(candidate.aabb, zones)) continue;
        if (collidesPacked(candidate.aabb, packed)) continue;
        const score = scoreFloorCandidate(candidate, loadFrontFirst, packed);
        if (!best || compareScore(score, bestScore) < 0) {
          best = { ...candidate, orientation };
          bestScore = score;
        }
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
  return [
    -orientation.l,
    candidate.aabb.min.y,
    candidate.aabb.min.z,
    xPrimary,
    orientation.w,
  ];
}

function findLanePlacement(item, zones, packed, loadFrontFirst) {
  let best = null;
  let bestScore = null;

  for (const orientation of getLaneOrientations(item)) {
    for (const zone of zones) {
      if (orientation.l > zone.max.x - zone.min.x + 0.05) continue;
      if (orientation.w > zone.max.z - zone.min.z + 0.05) continue;
      if (orientation.h > zone.max.y - zone.min.y + 0.05) continue;

      for (const candidate of buildFloorCandidates(orientation, zone, packed, loadFrontFirst)) {
        if (!isAabbContainedInAnyZone(candidate.aabb, zones)) continue;
        if (collidesPacked(candidate.aabb, packed)) continue;
        const score = scoreLaneCandidate(candidate, orientation, loadFrontFirst);
        if (!best || compareScore(score, bestScore) < 0) {
          best = { ...candidate, orientation };
          bestScore = score;
        }
      }
    }
  }

  return best;
}

function stackAnchorMins(supportMin, supportMax, itemSize) {
  return uniqueSorted(
    [
      supportMin,
      supportMax - itemSize,
      supportMin + ((supportMax - supportMin) - itemSize) / 2,
    ],
    (a, b) => a - b
  );
}

function buildStackCandidates(orientation, support) {
  const xMins = stackAnchorMins(support.aabb.min.x, support.aabb.max.x, orientation.l);
  const zMins = stackAnchorMins(support.aabb.min.z, support.aabb.max.z, orientation.w);
  const placements = [];

  for (const xMin of xMins) {
    for (const zMin of zMins) {
      const position = {
        x: xMin + orientation.l / 2,
        y: support.aabb.max.y + orientation.h / 2,
        z: zMin + orientation.w / 2,
      };
      const dims = { l: orientation.l, w: orientation.w, h: orientation.h };
      const aabb = getAabb(position, dims);
      placements.push({ position, dims, aabb });
    }
  }

  return placements;
}

function scoreStackCandidate(candidate, loadFrontFirst) {
  const xPrimary = loadFrontFirst ? -candidate.aabb.max.x : candidate.aabb.min.x;
  return [
    candidate.aabb.min.y,
    -candidate.supportFraction,
    xPrimary,
    candidate.aabb.min.z,
  ];
}

function findStackPlacement(item, zones, packed, loadFrontFirst) {
  let best = null;
  let bestScore = null;

  for (const orientation of item.candidates) {
    for (const support of packed) {
      if (!canSupportStack(support) || !hasStackCapacity(support, packed)) continue;

      for (const candidate of buildStackCandidates(orientation, support)) {
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

function updateRecordedPlacement(output, placement, candidate) {
  placement.pos = candidate.position;
  placement.dims = candidate.dims;
  placement.aabb = candidate.aabb;
  placement.zone = candidate.zone || placement.zone || null;
  output.placements.set(placement.instanceId, candidate.position);
  output.orientedDims.set(placement.instanceId, {
    length: candidate.dims.l,
    width: candidate.dims.w,
    height: candidate.dims.h,
  });
}

function isPlacementOnZoneFloor(aabb, zones) {
  return zones.some(zone =>
    isAabbContainedInZone(aabb, zone) &&
    Math.abs(aabb.min.y - zone.min.y) <= CONTACT_EPS
  );
}

function compactFloorPlacements(output, packed, zones, loadFrontFirst) {
  for (let pass = 0; pass < COMPACTION_PASSES; pass++) {
    let moved = false;
    for (const placement of packed) {
      if (placement.phase === 'stack') continue;
      if (!isPlacementOnZoneFloor(placement.aabb, zones)) continue;
      const others = packed.filter(other => other !== placement);
      const rotation = output.rotations.get(placement.instanceId) || { x: 0, y: 0, z: 0 };
      const orientation = {
        l: placement.dims.l,
        w: placement.dims.w,
        h: placement.dims.h,
        rotation,
      };
      let best = {
        position: placement.pos,
        dims: placement.dims,
        aabb: placement.aabb,
        zone: placement.zone,
      };
      let bestScore = scoreFloorCandidate(best, loadFrontFirst, others);

      for (const zone of zones) {
        if (orientation.l > zone.max.x - zone.min.x + CONTACT_EPS) continue;
        if (orientation.w > zone.max.z - zone.min.z + CONTACT_EPS) continue;
        if (orientation.h > zone.max.y - zone.min.y + CONTACT_EPS) continue;
        for (const candidate of buildFloorCandidates(orientation, zone, others, loadFrontFirst)) {
          if (!isAabbContainedInAnyZone(candidate.aabb, zones)) continue;
          if (collidesPacked(candidate.aabb, others)) continue;
          const score = scoreFloorCandidate(candidate, loadFrontFirst, others);
          if (compareScore(score, bestScore) < 0) {
            best = candidate;
            bestScore = score;
          }
        }
      }

      if (
        Math.abs(best.position.x - placement.pos.x) > CONTACT_EPS ||
        Math.abs(best.position.y - placement.pos.y) > CONTACT_EPS ||
        Math.abs(best.position.z - placement.pos.z) > CONTACT_EPS
      ) {
        updateRecordedPlacement(output, placement, best);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function validatePackedPlacements(output, packed, zones) {
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

  if (!rejected.length) return accepted;

  output.placements.clear();
  output.rotations.clear();
  output.orientedDims.clear();
  for (const placement of accepted) {
    output.placements.set(placement.instanceId, placement.pos);
    output.rotations.set(placement.instanceId, placement.orientation?.rotation || { x: 0, y: 0, z: 0 });
    output.orientedDims.set(placement.instanceId, {
      length: placement.dims.l,
      width: placement.dims.w,
      height: placement.dims.h,
    });
  }

  const unpacked = new Set(output.unpacked);
  for (const { placement, reason } of rejected) {
    unpacked.add(placement.instanceId);
    output.warnings.push(`Item ${placement.instanceId} was staged after validation: ${reason}.`);
  }
  output.unpacked = [...unpacked];
  return accepted;
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
  const packed = [];

  if (!truck.length || !truck.width || !truck.height || !floorZones.length) {
    output.unpacked = items.map(item => item.id);
    output.warnings.push('AutoPack floor solver skipped: missing truck dimensions or usable zones.');
    output.phaseStats.unpackedCount = output.unpacked.length;
    return output;
  }

  const deferred = [];
  const laneItems = sortItemsForLane(items.filter(item => item.className === 'LANE_ITEM'));
  const mainFloorItems = sortItemsForFloor(items.filter(item =>
    item.className !== 'LANE_ITEM' && item.className !== 'FILLER'
  ));
  const fillerItems = items.filter(item => item.className === 'FILLER');
  let laneCount = 0;
  let floorCount = 0;
  let fillerCount = 0;

  for (const item of laneItems) {
    const placement = findLanePlacement(item, floorZones, packed, loadFrontFirst);
    if (!placement) {
      output.unpacked.push(item.id);
      output.warnings.push(`Lane item ${item.id} could not fit in a safe lengthwise lane.`);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'lane');
    laneCount++;
  }

  for (const item of mainFloorItems) {
    const placement = findFloorPlacement(item, floorZones, packed, loadFrontFirst);
    if (!placement) {
      deferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'floor');
    floorCount++;
  }

  compactFloorPlacements(output, packed, floorZones, loadFrontFirst);

  const fillerQueue = sortItemsForFiller([...deferred, ...fillerItems]);
  const stackDeferred = [];
  for (const item of fillerQueue) {
    const placement = findFloorPlacement(item, floorZones, packed, loadFrontFirst);
    if (!placement) {
      stackDeferred.push(item);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'filler');
    fillerCount++;
  }

  compactFloorPlacements(output, packed, floorZones, loadFrontFirst);

  let stackCount = 0;
  for (const item of sortItemsForStack(stackDeferred)) {
    const placement = findStackPlacement(item, floorZones, packed, loadFrontFirst);
    if (!placement) {
      output.unpacked.push(item.id);
      output.warnings.push(`Item ${item.id} could not fit on the floor or on a safe supported stack.`);
      continue;
    }

    recordPlacement(output, packed, item, placement, 'stack');
    stackCount++;
  }

  const validatedPacked = validatePackedPlacements(output, packed, floorZones);
  if (validatedPacked.length !== packed.length) {
    packed.length = 0;
    packed.push(...validatedPacked);
  }

  output.phaseStats.laneCount = laneCount;
  output.phaseStats.floorCount = floorCount;
  output.phaseStats.stackCount = stackCount;
  output.phaseStats.fillerCount = fillerCount;
  output.phaseStats.unpackedCount = output.unpacked.length;
  refreshPhaseStats(output, packed);
  return output;
}
