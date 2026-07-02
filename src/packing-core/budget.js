/**
 * @file budget.js
 * @description Solve-time budget for AutoPack: a small monotonic stopwatch the
 * solver checks between work units so a large load returns the best PARTIAL
 * plan (with warnings and structured rejection reasons) instead of freezing
 * the browser tab. Hard rules are never weakened — the budget only limits how
 * many items get a placement attempt; everything placed is fully validated.
 *
 * The solver itself defaults to UNLIMITED so pure/offline callers (tests,
 * diagnostics, node scripts) stay deterministic; the runtime engine passes
 * DEFAULT_SOLVE_BUDGET_MS because it is the interactive, main-thread caller.
 * True background solving (Web Worker) remains a later architecture phase.
 * @module packing-core/budget
 */

/** Interactive main-thread solve budget passed by the runtime engine. */
export const DEFAULT_SOLVE_BUDGET_MS = 12000;

function defaultClock() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return () => performance.now();
  }
  return () => Date.now();
}

/**
 * Create a solve budget. A non-finite or non-positive limit yields an
 * unlimited budget (expired() is always false) — the deterministic mode used
 * by tests and non-interactive callers.
 *
 * @param {number} [maxMs] - wall-clock limit in milliseconds
 * @param {() => number} [now] - injectable clock for tests
 */
export function createSolveBudget(maxMs, now) {
  const limit = Number(maxMs);
  const unlimited = !Number.isFinite(limit) || limit <= 0;
  const clock = typeof now === 'function' ? now : defaultClock();
  const startedAt = clock();
  let expiredFlag = false;

  return {
    unlimited,
    limitMs: unlimited ? Infinity : limit,
    elapsedMs() {
      return clock() - startedAt;
    },
    /** Sticky: once expired, stays expired for the rest of the solve. */
    expired() {
      if (unlimited) return false;
      if (!expiredFlag && clock() - startedAt >= limit) expiredFlag = true;
      return expiredFlag;
    },
  };
}
