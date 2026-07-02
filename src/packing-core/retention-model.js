/**
 * @file retention-model.js
 * @description Front Overhang deck-retention coverage model.
 *
 * The raised over-cab deck is legally usable only where a retaining barrier —
 * cargo whose front face is flush with the overhang step and which vertically
 * spans the deck level — prevents deck cargo from sliding rearward
 * (pack-library.evaluateFrontOverhangRearRetention is the per-candidate
 * authority; this module mirrors its retainer rules to answer the INVERSE
 * question: which z-intervals of the step are currently covered, and which are
 * still open). The solver's deck-wall pass uses the uncovered intervals to
 * intentionally build the missing barrier from leftover cargo — through the
 * ordinary hard-rule pipeline — instead of leaving the deck permanently unused
 * whenever a wall did not form by accident. Nothing here weakens retention:
 * deck placements are still individually validated against the real barrier.
 * @module packing-core/retention-model
 */

import { CONTAINMENT_EPS_INCHES, isAabbContainedInZone } from './validation.js';

/**
 * Maximum accepted gap between a retainer's front face and the overhang step.
 * Mirrors pack-library's REAR_RETENTION_MAX_STEP_GAP_INCHES.
 */
export const RETENTION_MAX_STEP_GAP = 0.05;

const EPS = CONTAINMENT_EPS_INCHES;

function entryAabb(entry) {
  if (!entry) return null;
  if (entry.aabb && entry.aabb.min && entry.aabb.max) return entry.aabb;
  return entry.min && entry.max ? entry : null;
}

/**
 * Whether a placement acts as a retaining-wall segment at the step: contained
 * in the main zone, front face flush with the step (within the accepted gap),
 * and vertically overlapping the deck level. Mirrors the retainer filter in
 * evaluateFrontOverhangRearRetention exactly.
 */
export function isRetainerAtStep(aabb, geometry) {
  if (!aabb || !geometry) return false;
  if (!isAabbContainedInZone(aabb, geometry.mainZone, EPS)) return false;
  const stepGap = geometry.stepX - aabb.max.x;
  if (stepGap < -EPS || stepGap > RETENTION_MAX_STEP_GAP + 1e-9) return false;
  return !(aabb.min.y > geometry.deckY + EPS || aabb.max.y < geometry.deckY - EPS);
}

/**
 * Compute the covered and uncovered z-intervals of the deck step for the
 * current placements. Pure; placements may be solver packed entries ({aabb})
 * or raw AABBs. Degenerate slivers narrower than the containment tolerance are
 * dropped from the uncovered list (no cargo can use them).
 *
 * @returns {{ covered: Array<{minZ,maxZ}>, uncovered: Array<{minZ,maxZ}> }}
 */
export function computeDeckRetentionCoverage(geometry, placements) {
  if (!geometry) return { covered: [], uncovered: [] };
  const spanMin = geometry.deckZone.min.z;
  const spanMax = geometry.deckZone.max.z;

  const intervals = [];
  for (const entry of placements || []) {
    const aabb = entryAabb(entry);
    if (!aabb || !isRetainerAtStep(aabb, geometry)) continue;
    const minZ = Math.max(spanMin, aabb.min.z);
    const maxZ = Math.min(spanMax, aabb.max.z);
    if (maxZ - minZ > EPS) intervals.push({ minZ, maxZ });
  }
  intervals.sort((a, b) => a.minZ - b.minZ || a.maxZ - b.maxZ);

  const covered = [];
  for (const interval of intervals) {
    const last = covered[covered.length - 1];
    if (!last || interval.minZ > last.maxZ + EPS) {
      covered.push({ minZ: interval.minZ, maxZ: interval.maxZ });
    } else {
      last.maxZ = Math.max(last.maxZ, interval.maxZ);
    }
  }

  const uncovered = [];
  let cursor = spanMin;
  for (const interval of covered) {
    if (interval.minZ - cursor > EPS) uncovered.push({ minZ: cursor, maxZ: interval.minZ });
    cursor = Math.max(cursor, interval.maxZ);
  }
  if (spanMax - cursor > EPS) uncovered.push({ minZ: cursor, maxZ: spanMax });

  return { covered, uncovered };
}
