/**
 * @file explain.js
 * @description Machine-readable rejection reasons for staged/unplaced cargo.
 *
 * The solver reports WHY a case could not be packed as structured data
 * ({ instanceId, code, phase, detail, context }) alongside the existing
 * free-text warnings, so the UI can eventually explain staging without string
 * parsing. Codes are additive: adding a code never changes placement behavior.
 * A rejection carries the most specific code the failing phase can PROVE;
 * NO_STACK_CANDIDATE is the honest fallback when an item failed every dynamic
 * floor/stack attempt without a statically provable cause.
 * See docs/engineering/autopack-core-engine-plan.md §6.
 * @module packing-core/explain
 */

export const REJECTION_CODES = Object.freeze({
  /** Truck dimensions or usable zones are missing/degenerate. */
  NO_USABLE_SPACE: 'NO_USABLE_SPACE',
  /** No allowed orientation fits any usable zone's cross-section. */
  NO_FIT_ANY_SURFACE: 'NO_FIT_ANY_SURFACE',
  /** An unrestricted orientation would fit, but the lock/policy excludes it. */
  ORIENTATION_LOCKED: 'ORIENTATION_LOCKED',
  /** Wheel Wells: every allowed orientation is wider than the center channel. */
  TOO_WIDE_FOR_CHANNEL: 'TOO_WIDE_FOR_CHANNEL',
  /** Wheel Wells: every allowed orientation is wider than the raised shelf. */
  TOO_WIDE_FOR_SHELF: 'TOO_WIDE_FOR_SHELF',
  /** No valid floor candidate remained. */
  NO_FLOOR_CANDIDATE: 'NO_FLOOR_CANDIDATE',
  /** No valid floor or supported stack candidate remained (terminal fallback). */
  NO_STACK_CANDIDATE: 'NO_STACK_CANDIDATE',
  /** Final validation: pose penetrates a blocked wheel-well body. */
  BLOCKED_BY_WHEEL_WELL: 'BLOCKED_BY_WHEEL_WELL',
  /** Final validation: pose is outside every usable zone. */
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  /** Final validation: pose overlaps another packed item. */
  COLLISION: 'COLLISION',
  /** Final validation: pose lacks safe vertical support. */
  UNSUPPORTED: 'UNSUPPORTED',
  /** Final validation: Front Overhang deck pose lacks complete rear retention. */
  NO_RETENTION: 'NO_RETENTION',
  /** The solve-time budget was reached before this item could be tried. */
  SOLVE_BUDGET_EXCEEDED: 'SOLVE_BUDGET_EXCEEDED',
});

/** Build one structured RejectionReason record. */
export function makeRejectionReason(instanceId, code, phase, detail, context = null) {
  return {
    instanceId,
    code,
    phase,
    detail: String(detail || ''),
    context: context || null,
  };
}

/**
 * High-level cause classes for a partial solve. A solve is partial when any
 * item stayed unpacked; the causes say WHY in product terms:
 * - fit: geometry — the item does not fit the remaining/any space;
 * - safety: support/stability/collision/retention/blocked-body rules;
 * - rules: cargo handling rules (orientation locks, stacking permissions);
 * - budget: the interactive time budget stopped the solve early.
 */
export const PARTIAL_CAUSES = Object.freeze({
  FIT: 'fit',
  SAFETY: 'safety',
  RULES: 'rules',
  BUDGET: 'budget',
});

/** Classify one rejection code into a PARTIAL_CAUSES class. */
export function classifyRejectionCause(code) {
  switch (code) {
    case REJECTION_CODES.SOLVE_BUDGET_EXCEEDED:
      return PARTIAL_CAUSES.BUDGET;
    case REJECTION_CODES.ORIENTATION_LOCKED:
      return PARTIAL_CAUSES.RULES;
    case REJECTION_CODES.BLOCKED_BY_WHEEL_WELL:
    case REJECTION_CODES.OUT_OF_BOUNDS:
    case REJECTION_CODES.COLLISION:
    case REJECTION_CODES.UNSUPPORTED:
    case REJECTION_CODES.NO_RETENTION:
      return PARTIAL_CAUSES.SAFETY;
    default:
      // NO_USABLE_SPACE, NO_FIT_ANY_SURFACE, TOO_WIDE_*, NO_FLOOR/STACK_CANDIDATE
      return PARTIAL_CAUSES.FIT;
  }
}

/**
 * Summarize a solve into the engine's completion contract: whether everything
 * packed, how many items stayed staged, and the distinct partial causes
 * (derived from the structured rejection reasons — one per unpacked item).
 */
export function summarizeSolveStatus(unpackedIds, rejectionReasons) {
  const unpackedCount = Array.isArray(unpackedIds) ? unpackedIds.length : 0;
  const causes = new Set();
  for (const reason of rejectionReasons || []) {
    causes.add(classifyRejectionCause(reason.code));
  }
  return {
    complete: unpackedCount === 0,
    unpackedCount,
    partialCauses: [...causes].sort(),
  };
}

/**
 * Map the solver's final-validation reason text (the exact strings
 * validatePackedPlacements has always produced for warnings) to a code, so
 * warnings and structured reasons stay one source of truth.
 */
export function rejectionCodeForValidationReason(reason) {
  const text = String(reason || '');
  if (text.includes('wheel-well body')) return REJECTION_CODES.BLOCKED_BY_WHEEL_WELL;
  if (text.includes('outside usable zones')) return REJECTION_CODES.OUT_OF_BOUNDS;
  if (text.includes('overlaps another packed item')) return REJECTION_CODES.COLLISION;
  if (text.includes('safe stack support')) return REJECTION_CODES.UNSUPPORTED;
  if (text.includes('rear retention')) return REJECTION_CODES.NO_RETENTION;
  return REJECTION_CODES.NO_STACK_CANDIDATE;
}
