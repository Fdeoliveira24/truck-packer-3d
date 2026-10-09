/**
 * @file validation.js
 * @description The single hard-rule validation authority for packing decisions.
 *
 * Every geometric/physical hard-rule predicate lives here exactly once:
 * containment, collision, support fraction, support-side stacking rules
 * (noStackOnTop / stackable:false), maxStackCount capacity, and the
 * child-vs-support weight check with the pallet bypass. The AutoPack solver and
 * the pack-library manual/reconciliation pipeline both delegate here, so a rule
 * or tolerance can never silently diverge between "what AutoPack accepts" and
 * "what manual revalidation accepts".
 *
 * Front Overhang rear retention intentionally stays single-sourced in
 * pack-library (evaluateFrontOverhangRearRetention) — it already has exactly one
 * implementation, and both the solver and reconciliation import it from there.
 * Moving it here would only add an import cycle risk without removing any
 * duplication.
 *
 * This module is deliberately dependency-free (no services/core imports) so it
 * can be imported from anywhere — including pack-library itself — without
 * cycles. Do not weaken any rule or tolerance here; scoring must never create
 * validity (see docs/engineering/autopack-engine-contract.md).
 * @module packing-core/validation
 */

/** Canonical trailer-containment tolerance shared by every placement path. */
export const CONTAINMENT_EPS_INCHES = 0.05;

/** Shared epsilon for AABB overlap checks across all placement code paths. */
export const PLACEMENT_EPS = 0.001;

/** Minimum fraction of a case's bottom face that must be covered by supporters. */
export const MIN_SUPPORT_FRACTION = 0.5;

/** Flush-contact tolerance for face/top adjacency checks. */
export const CONTACT_EPS = 0.05;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Strict-interior AABB overlap: touching faces within epsilon do NOT overlap. */
export function aabbsOverlap(a, b, epsilon = PLACEMENT_EPS) {
  if (!a || !b) return false;
  return a.min.x < b.max.x - epsilon &&
    a.max.x > b.min.x + epsilon &&
    a.min.y < b.max.y - epsilon &&
    a.max.y > b.min.y + epsilon &&
    a.min.z < b.max.z - epsilon &&
    a.max.z > b.min.z + epsilon;
}

/** Whether an AABB overlaps any AABB in the list. */
export function overlapsAny(aabb, otherAabbs, epsilon = PLACEMENT_EPS) {
  return (otherAabbs || []).some(other => aabbsOverlap(aabb, other, epsilon));
}

/** Inch-space containment of an AABB in one zone, with the canonical tolerance. */
export function isAabbContainedInZone(aabb, zone, epsilon = CONTAINMENT_EPS_INCHES) {
  if (!aabb || !zone) return false;
  return aabb.min.x >= zone.min.x - epsilon &&
    aabb.max.x <= zone.max.x + epsilon &&
    aabb.min.y >= zone.min.y - epsilon &&
    aabb.max.y <= zone.max.y + epsilon &&
    aabb.min.z >= zone.min.z - epsilon &&
    aabb.max.z <= zone.max.z + epsilon;
}

/** Inch-space containment in ANY usable zone. */
export function isAabbContainedInAnyZone(aabb, zones, epsilon = CONTAINMENT_EPS_INCHES) {
  return (zones || []).some(zone => isAabbContainedInZone(aabb, zone, epsilon));
}

/** Footprint (X/Z) overlap area between two AABBs. */
export function computeXzOverlapArea(a, b) {
  if (!a || !b) return 0;
  const overlapL = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const overlapW = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
  return overlapL * overlapW;
}

/**
 * Fraction of the candidate's bottom face covered by supporter AABBs whose top
 * face is flush (within tolerance) with the candidate's bottom. The floor is
 * not a supporter — callers treat fraction 0 as "rests on the floor or falls".
 */
export function computeSupportFraction(candidateAabb, supporterAabbs, tolerance = PLACEMENT_EPS) {
  if (!candidateAabb) return 0;
  const footprintL = candidateAabb.max.x - candidateAabb.min.x;
  const footprintW = candidateAabb.max.z - candidateAabb.min.z;
  const candidateArea = Math.max(1e-9, footprintL * footprintW);
  const bottom = candidateAabb.min.y;
  let supportArea = 0;

  for (const sup of supporterAabbs || []) {
    if (!sup) continue;
    if (Math.abs(bottom - sup.max.y) > tolerance) continue;
    supportArea += computeXzOverlapArea(candidateAabb, sup);
  }

  return Math.min(1, supportArea / candidateArea);
}

/**
 * Support-side stacking permission: nothing may rest on a case whose rules say
 * noStackOnTop or stackable:false. Takes the case/cargo RULES object (case data
 * or normalized item), not a placement wrapper — callers unwrap their own shape.
 */
export function rulesAllowStackOnTop(rules = {}) {
  return !(rules.noStackOnTop || rules.stackable === false);
}

/**
 * Direct-child stack cap from cargo rules; 0 = unlimited. Returned RAW (not
 * floored): the solver compares child counts against the raw value while the
 * manual pipeline floors at its call site, and canonicalization
 * (core/cargo-canonical.js) already floors stored values — flooring here would
 * silently change the solver's comparison for non-canonical diagnostic input.
 */
export function rulesMaxStackCount(rules = {}) {
  const maxStackCount = finiteNumber(rules.maxStackCount, 0);
  return maxStackCount > 0 ? maxStackCount : 0;
}

/**
 * Child-vs-support weight rule with the pallet bypass: a pallet support accepts
 * any child weight; otherwise the child must not out-weigh the support.
 */
export function weightAllowsSupport(candidateWeight, supportWeight, supportIsPallet) {
  if (supportIsPallet === true) return true;
  return finiteNumber(candidateWeight, 0) <= finiteNumber(supportWeight, 0);
}

// ---------------------------------------------------------------------------
// Placement-shaped rule helpers. A "placement" here is any of the shapes the
// app actually passes around: a solver packed placement ({ item: { item } }),
// a reconciliation node ({ caseData }), or a raw rules object. Unwrapping once
// here lets the solver and the manual pipeline share the SAME support-side
// stacking, capacity, and weight decisions on their native shapes.
// ---------------------------------------------------------------------------

/** Unwrap the cargo-rule source from any placement-like shape. */
export function getPlacementRules(placement = {}) {
  return (placement.item && placement.item.item) || placement.item || placement.caseData || placement;
}

/** Support-side stacking permission for a placement-like value. */
export function canSupportStack(placement = {}) {
  return rulesAllowStackOnTop(getPlacementRules(placement));
}

/** Weight carried by a placement-like value (normalized item weight wins). */
export function getPlacementWeight(placement = {}) {
  if (placement.item && Number.isFinite(Number(placement.item.weight))) {
    return finiteNumber(placement.item.weight, 0);
  }
  return finiteNumber(getPlacementRules(placement).weight, 0);
}

/** Whether a placement-like value acts as a pallet support. */
export function isPalletSupport(placement = {}) {
  const rules = getPlacementRules(placement);
  return rules.isPallet === true || placement.isPallet === true;
}

/** Child-vs-support weight check for placement-like values. */
export function canSupportCandidateWeight(candidateItem, support) {
  if (!candidateItem) return true;
  return weightAllowsSupport(
    finiteNumber(support?.fixed === true ? candidateItem.actualWeight ?? candidateItem.weight : candidateItem.weight, 0),
    getPlacementWeight(support),
    isPalletSupport(support)
  );
}

/** Direct-child stack cap for a placement-like value; 0 = unlimited. */
export function getMaxStackCount(placement = {}) {
  return rulesMaxStackCount(getPlacementRules(placement));
}

/** Count items resting directly on this support's top face. */
export function countDirectStackChildren(support, packed, tolerance = CONTACT_EPS) {
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

/** Whether a support still has direct-child capacity under its maxStackCount. */
export function hasStackCapacity(placement, packed) {
  const maxStackCount = getMaxStackCount(placement);
  return !maxStackCount || countDirectStackChildren(placement, packed) < maxStackCount;
}

// C2 measurements. 1e-9 is the existing zone-degeneracy numerical precision,
// in inches for distances (not a physical clearance or stability allowance).
// Legacy CONTACT_EPS permits visible gaps and must not manufacture C2 contact.
export const MEASUREMENT_EPS = 1e-9;

/** Exact interval union; never close a real gap between intervals. */
export function measureIntervalUnion(intervals) {
  const merged = [];
  for (const interval of intervals.filter(i => i.max > i.min).map(i => ({ ...i }))
    .sort((a, b) => a.min - b.min || a.max - b.max)) {
    const last = merged[merged.length - 1];
    if (!last || interval.min > last.max) merged.push(interval);
    else last.max = Math.max(last.max, interval.max);
  }
  return { intervals: merged, length: merged.reduce((sum, i) => sum + i.max - i.min, 0) };
}

/** Axis-aligned rectangle union by disjoint X slabs, without double counting. */
export function measureContactUnion(patches) {
  const rectangles = patches.filter(p => p.maxX > p.minX && p.maxZ > p.minZ);
  const xs = [...new Set(rectangles.flatMap(p => [p.minX, p.maxX]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const intervals = rectangles.filter(p => p.minX < xs[i] && p.maxX > xs[i - 1])
      .map(p => ({ min: p.minZ, max: p.maxZ }));
    area += (xs[i] - xs[i - 1]) * measureIntervalUnion(intervals).length;
  }
  return area;
}

const crossXZ = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Counterclockwise horizontal hull; degenerate input stays degenerate. */
export function supportConvexHull(points) {
  const unique = [...new Map(points.map(p => [`${p.x}|${p.z}`, { x: p.x, z: p.z }])).values()]
    .sort((a, b) => a.x - b.x || a.z - b.z);
  if (unique.length < 3) return unique;
  const half = list => {
    const out = [];
    for (const p of list) {
      while (out.length > 1 && crossXZ(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  return [...half(unique).slice(0, -1), ...half([...unique].reverse()).slice(0, -1)];
}

export function contactPatchCorners(patch) {
  return [
    { x: patch.minX, z: patch.minZ }, { x: patch.maxX, z: patch.minZ },
    { x: patch.maxX, z: patch.maxZ }, { x: patch.minX, z: patch.maxZ },
  ];
}

/** Signed distance from a resultant to the closest CCW hull edge, in inches. */
export function supportHullMargin(hull, point) {
  if (hull.length < 3) return { margin: null, inside: false };
  let margin = Infinity;
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length];
    margin = Math.min(margin, crossXZ(a, b, point) / Math.hypot(b.x - a.x, b.z - a.z));
  });
  return { margin, inside: margin > MEASUREMENT_EPS };
}

/** Surfaces carry {supportId, y, minX,maxX,minZ,maxZ}; input is resolved geometry. */
export function measureSupportContacts(aabb, surfaces) {
  const bearingPlane = aabb.min.y;
  const patches = [];
  for (const surface of surfaces) {
    if (Math.abs(surface.y - bearingPlane) > MEASUREMENT_EPS) continue;
    const patch = { supportId: surface.supportId, y: bearingPlane,
      minX: Math.max(aabb.min.x, surface.minX), maxX: Math.min(aabb.max.x, surface.maxX),
      minZ: Math.max(aabb.min.z, surface.minZ), maxZ: Math.min(aabb.max.z, surface.maxZ) };
    if (patch.maxX > patch.minX && patch.maxZ > patch.minZ) patches.push(patch);
  }
  patches.sort((a, b) => a.supportId.localeCompare(b.supportId) || a.minX - b.minX || a.minZ - b.minZ);
  const area = measureContactUnion(patches);
  const length = aabb.max.x - aabb.min.x, width = aabb.max.z - aabb.min.z;
  const hull = supportConvexHull(patches.flatMap(contactPatchCorners));
  const extension = patches.length ? {
    rear: Math.max(0, Math.min(...patches.map(p => p.minX)) - aabb.min.x),
    front: Math.max(0, aabb.max.x - Math.max(...patches.map(p => p.maxX))),
    left: Math.max(0, Math.min(...patches.map(p => p.minZ)) - aabb.min.z),
    right: Math.max(0, aabb.max.z - Math.max(...patches.map(p => p.maxZ))),
  } : null;
  return { bearingPlane, patches, area, footprintArea: length * width,
    coverage: area / (length * width), hull, extension,
    extensionFraction: extension ? Math.max(extension.rear / length, extension.front / length,
      extension.left / width, extension.right / width) : null,
    units: { distance: 'in', area: 'in2' } };
}

/**
 * Nonnegative vertical statics over point contacts. Rectangular patches are
 * exactly represented by their corners: every admissible patch wrench is a
 * convex combination of corner forces. Three balance equations (F, F*x, F*z)
 * have extreme solutions on at most three points. Enumerate those vertices,
 * retaining per-support wrench bounds rather than selecting an arbitrary split.
 * Coordinate residuals use numerical inch precision; wrench uniqueness uses
 * relative numerical precision. Force values are gravity-equivalent lb loads.
 */
export function solveContactReactions(force, resultant, contacts) {
  if (!(typeof force === 'number' && Number.isFinite(force) && force > 0) ||
      !resultant || !Number.isFinite(resultant.x) || !Number.isFinite(resultant.z)) {
    return { outcome: 'UNRESOLVED', reason: 'missing-demand', reactions: [] };
  }
  const points = [...new Map(contacts.map(p => [`${p.supportId}|${p.x}|${p.z}`, p])).values()];
  if (points.some(p => typeof p.supportId !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.z) ||
      !Number.isFinite(force * p.x) || !Number.isFinite(force * p.z))) {
    return { outcome: 'UNRESOLVED', reason: 'unresolved-contact-geometry', reactions: [] };
  }
  // A truthful computational limit, not a physical rule or a fallback split.
  if (points.length > 64) return { outcome: 'UNRESOLVED', reason: 'reaction-enumeration-limit', reactions: [] };
  const ids = [...new Set(points.map(p => p.supportId))].sort();
  const extrema = new Map(ids.map(id => [id, {
    force: { min: Infinity, max: -Infinity },
    momentX: { min: Infinity, max: -Infinity }, momentZ: { min: Infinity, max: -Infinity },
  }]));
  let vertices = 0;
  const accept = (indices, weights) => {
    if (weights.some(w => !Number.isFinite(w) || w < -MEASUREMENT_EPS)) return;
    const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
    if (!(sum > 0)) return;
    const normalized = weights.map(w => Math.max(0, w) / sum);
    const x = indices.reduce((s, index, i) => s + points[index].x * normalized[i], 0);
    const z = indices.reduce((s, index, i) => s + points[index].z * normalized[i], 0);
    if (Math.abs(x - resultant.x) > MEASUREMENT_EPS || Math.abs(z - resultant.z) > MEASUREMENT_EPS) return;
    const byId = new Map(ids.map(id => [id, { force: 0, momentX: 0, momentZ: 0 }]));
    indices.forEach((index, i) => {
      const p = points[index], f = force * normalized[i], wrench = byId.get(p.supportId);
      wrench.force += f; wrench.momentX += f * p.x; wrench.momentZ += f * p.z;
    });
    byId.forEach((wrench, id) => {
      for (const key of ['force', 'momentX', 'momentZ']) {
        extrema.get(id)[key].min = Math.min(extrema.get(id)[key].min, wrench[key]);
        extrema.get(id)[key].max = Math.max(extrema.get(id)[key].max, wrench[key]);
      }
    });
    vertices++;
  };
  for (let i = 0; i < points.length; i++) {
    accept([i], [1]);
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j], dx = b.x - a.x, dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;
      if (length2 > 0) {
        const t = ((resultant.x - a.x) * dx + (resultant.z - a.z) * dz) / length2;
        accept([i, j], [1 - t, t]);
      }
      for (let k = j + 1; k < points.length; k++) {
        const c = points[k], determinant = crossXZ(a, b, c);
        if (determinant === 0) continue;
        const u = crossXZ(resultant, b, c) / determinant;
        const v = crossXZ(a, resultant, c) / determinant;
        accept([i, j, k], [u, v, 1 - u - v]);
      }
    }
  }
  if (!vertices) return { outcome: 'FAIL', reason: 'no-nonnegative-equilibrium', reactions: [] };
  const reactions = ids.map(supportId => {
    const bounds = extrema.get(supportId);
    const determined = Object.values(bounds).every(b =>
      b.max - b.min <= MEASUREMENT_EPS * Math.max(1, Math.abs(b.min), Math.abs(b.max)));
    return { supportId, bounds, determined,
      force: determined ? bounds.force.min : null,
      momentX: determined ? bounds.momentX.min : null,
      momentZ: determined ? bounds.momentZ.min : null };
  });
  return { outcome: 'PASS', determined: reactions.every(r => r.determined), reactions,
    vertices, conservation: 'force-and-moments', units: { force: 'lb', moment: 'lb-in' } };
}
