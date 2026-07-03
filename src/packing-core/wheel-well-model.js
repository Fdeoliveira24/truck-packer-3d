/**
 * @file wheel-well-model.js
 * @description The wheel-well physical model: blocked well bodies, rigid top
 * support faces, inner side faces, combined support/stability evaluation, and
 * the exact "inside truck box minus blocked bodies" containment test.
 *
 * Moved verbatim from autopack-solver.js so the SAME physical model serves the
 * solver AND the manual/reconciliation pipeline in pack-library. Before this
 * move, manual revalidation had no wheel-well model at all: solver-legal
 * placements resting on or bridging the well tops span zone seams, failed the
 * zone-containment test, had no rigid-top support, and were ejected to staging
 * by any manual edit — including deleting one unrelated box.
 *
 * The wheel wells are NOT cargo floor, but boxes may safely touch them, sit
 * over them, bridge across them, or be laterally restrained by them when
 * support and stability rules pass. Geometry is computed dynamically from the
 * active truck shapeConfig (no hardcoded well dimensions). Everything is gated
 * on this geometry: for Standard / Front Overhang trucks getWheelWellGeometry()
 * returns null and every caller falls back to its original behavior.
 *
 * Key invariant used throughout: for a wheelWells truck the union of usable
 * zones equals exactly (truck bounding box) MINUS (the two blocked well
 * bodies). So "inside the truck box AND not intersecting a blocked body" is an
 * exact obstacle-safety test — equivalent to multi-zone containment without
 * needing a general union-cover routine.
 * @module packing-core/wheel-well-model
 */

import {
  CONTAINMENT_EPS_INCHES,
  CONTACT_EPS,
  MIN_SUPPORT_FRACTION,
  aabbsOverlap,
  canSupportStack,
  hasStackCapacity,
  canSupportCandidateWeight,
} from './validation.js';

const GEOM_EPS = 0.05;

/**
 * Wheel-well stability: even with the centre of mass over support, a box may
 * not cantilever more than this fraction of its own length/width beyond the
 * supported area on any single side. Rejects unrealistic "balanced on an edge"
 * overhangs over the open channel/void that pure COM statics would permit.
 */
export const MAX_WHEELWELL_OVERHANG_FRACTION = 1 / 3;

function positiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function touches(a, b, epsilon = CONTACT_EPS) {
  return Math.abs(a - b) <= epsilon;
}

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
  const wellHeight = clamp(Number.isFinite(Number(cfg.wellHeight)) ? Number(cfg.wellHeight) : 0.35 * H, 0, H);
  const wellWidth = clamp(Number.isFinite(Number(cfg.wellWidth)) ? Number(cfg.wellWidth) : 0.15 * W, 0, W / 2);
  const wellLength = clamp(Number.isFinite(Number(cfg.wellLength)) ? Number(cfg.wellLength) : 0.35 * L, 0, L);
  const wellOffsetFromRear = clamp(Number.isFinite(Number(cfg.wellOffsetFromRear)) ? Number(cfg.wellOffsetFromRear) : 0.25 * L, 0, L);

  const wx0 = wellOffsetFromRear;
  const wx1 = clamp(wx0 + wellLength, wx0, L);
  const betweenHalfW = Math.max(0, W / 2 - wellWidth);

  // Degenerate wells (no height, no length, or full-width "wells" that leave no
  // shelf) carry no obstacle/support meaning — treat as a plain box.
  if (!(wellHeight > GEOM_EPS) || !(wx1 - wx0 > GEOM_EPS) || !(W / 2 - betweenHalfW > GEOM_EPS)) {
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

/**
 * Full-AABB / footprint collision with a blocked well body — never a
 * centre-only test, so a box may not be accepted just because its centre
 * clears the well.
 */
export function aabbIntersectsWheelWellBody(aabb, geometry) {
  if (!geometry || !aabb) return false;
  return geometry.blocked.some(body => aabbsOverlap(aabb, body));
}

/**
 * Exact obstacle-safe containment for wheelWells: inside the truck box AND not
 * intersecting either blocked well body (== contained in the union of usable
 * zones). A box resting flush on a well top (bottom y == wellHeight) does NOT
 * overlap the body, so direct top support is allowed.
 */
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

/**
 * Count how many wheel-well inner side faces the box is in flush lateral
 * contact with (touching the face while overlapping its x/y extent, without
 * penetrating the body). Diagnostic / stability tie-breaker only — lateral
 * contact never reduces the required vertical support.
 */
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

/**
 * Compute combined vertical support under a candidate footprint, drawing on
 * both packed cargo tops and the rigid wheel-well tops at the candidate bottom
 * level. Returns the supported fraction plus whether the centre of mass
 * projects onto the supported area extent (tip safety). Packed supports that
 * cannot bear the stack (noStackOnTop, at capacity, or too light) contribute
 * no area.
 */
export function computeWheelWellSupport(candidateAabb, packed, geometry, candidateItem = null, tolerance = CONTACT_EPS) {
  const bottom = candidateAabb.min.y;
  // Continuous truck floor: a candidate resting at the truck floor level is
  // fully supported by the real floor. The usable-zone split (rear / channel /
  // front) is bookkeeping, not a physical gap — a box straddling a zone seam
  // at floor level stands on solid floor. Blocked-body overlap is excluded
  // separately by every caller (isWheelWellSupportedAndStable /
  // isAabbWithinTruckMinusBlocked), so this can never grant support over a
  // well body.
  if (geometry && Math.abs(bottom - geometry.truckBox.min.y) <= tolerance) {
    return { fraction: 1, comSupported: true, overhangFraction: 0, supportCount: 1 };
  }
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

/**
 * A wheel-well-assisted placement is acceptable only when it does not penetrate
 * the body, has at least MIN_SUPPORT_FRACTION combined vertical support, and is
 * stable (centre of mass over the supported area). Lateral contact alone is
 * never enough — a box with no vertical support fails here regardless of how
 * many side faces it touches.
 */
export function isWheelWellSupportedAndStable(candidateAabb, packed, geometry, candidateItem = null) {
  if (!geometry || !candidateAabb) return false;
  if (aabbIntersectsWheelWellBody(candidateAabb, geometry)) return false;
  const { fraction, comSupported, overhangFraction } = computeWheelWellSupport(candidateAabb, packed, geometry, candidateItem);
  if (fraction + 1e-9 < MIN_SUPPORT_FRACTION) return false;
  if (!comSupported) return false;
  if (overhangFraction > MAX_WHEELWELL_OVERHANG_FRACTION + 1e-9) return false;
  return true;
}
