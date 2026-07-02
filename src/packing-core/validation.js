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
    finiteNumber(candidateItem.weight, 0),
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
