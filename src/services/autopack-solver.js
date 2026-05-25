const RIGHT_ANGLE_RAD = Math.PI / 2;
const LONG_RATIO = 3;
const LONG_MIN_IN = 72;
const HEAVY_LBS = 150;
const FILLER_IN3 = 500;

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
    if (support.noStackOnTop || support.stackable === false) continue;
    const supportAabb = support.min && support.max
      ? support
      : getAabb(support.pos || support.position, support.dims || support.orientedDims || support.dimensions);
    if (Math.abs(bottom - supportAabb.max.y) > tolerance) continue;
    supportArea += computeXzOverlapArea(candidateAabb, supportAabb);
  }

  return Math.min(1, supportArea / candidateArea);
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

export function solveAutoPack() {
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
