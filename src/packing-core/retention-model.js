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

import {
  CONTAINMENT_EPS_INCHES, isAabbContainedInZone, MEASUREMENT_EPS, measureIntervalUnion,
} from './validation.js';

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

/**
 * C2 per-body rearward blocking measurement. Callers supply physically loaded
 * blockers with geometry/support qualification, never visibility-filtered rows.
 * Keep the established step-adjacency allowance, but measure actual Z union
 * and true positive vertical overlap with THIS body (including upper cargo).
 * A geometric pass says nothing about restraint strength or anchorage.
 */
export function measureRearBlocking(aabb, blockers, geometry) {
  if (!geometry || aabb.max.x <= geometry.stepX + MEASUREMENT_EPS) {
    return { applicable: false, outcome: 'NOT_APPLICABLE' };
  }
  const contacts = [];
  const uncertain = [];
  for (const blocker of blockers) {
    const b = blocker.aabb;
    if (!b || b.min.x >= geometry.stepX || b.max.x > aabb.min.x + MEASUREMENT_EPS) continue;
    const stepGap = geometry.stepX - b.max.x;
    if (stepGap < -MEASUREMENT_EPS || stepGap > RETENTION_MAX_STEP_GAP + MEASUREMENT_EPS) continue;
    const verticalOverlap = Math.min(aabb.max.y, b.max.y) - Math.max(aabb.min.y, b.min.y);
    const min = Math.max(aabb.min.z, b.min.z), max = Math.min(aabb.max.z, b.max.z);
    if (verticalOverlap <= MEASUREMENT_EPS || max <= min) continue;
    const patch = { id: blocker.id, min, max, verticalOverlap, stepGap };
    if (blocker.qualification === 'PASS') contacts.push(patch);
    else if (blocker.qualification === 'UNRESOLVED') uncertain.push(patch);
  }
  const union = measureIntervalUnion(contacts);
  const requiredWidth = aabb.max.z - aabb.min.z;
  const complete = union.length >= requiredWidth - MEASUREMENT_EPS;
  const possible = measureIntervalUnion([...contacts, ...uncertain]).length >= requiredWidth - MEASUREMENT_EPS;
  return { applicable: true, outcome: complete ? 'PASS' : possible ? 'UNRESOLVED' : 'FAIL',
    requiredWidth, coveredWidth: union.length, intervals: union.intervals, contacts, uncertain,
    path: { stepX: geometry.stepX, bodyRearX: aabb.min.x, minZ: aabb.min.z, maxZ: aabb.max.z }, units: 'in' };
}
