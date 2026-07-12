/**
 * @file solution.js
 * @description Multi-strategy solution model for AutoPack.
 *
 * A PackingSolution is an array of StrategyResult objects — one per requested
 * strategy — plus the id of the solution the UI should show by default. Each
 * StrategyResult carries the full solver output (placements, rotations,
 * orientedDims, retention dependencies, unpacked ids, warnings, structured
 * rejection reasons, phase stats), so future multi-solution UI can navigate
 * variants without re-solving.
 *
 * Only strategies that genuinely exist in the solver are registered — every
 * preset maps to real solver mechanics, never a renamed alias:
 * - `default`: the full production pipeline (front-first, layout-quality
 *   ranked, wheel-well aware, leftover recovery built in).
 * - `compact-fill`: layout-quality re-ranking off — original waste-first
 *   density ordering; packs at least as many cases, may mix orientations.
 * - `floor-first`: stacking disabled — nothing is ever lifted onto cargo;
 *   items that fit no floor position stage with an honest reason.
 * - `stack-priority`: an item that fails the floor is offered a safe supported
 *   stack immediately (favors vertical use over floor spread).
 * - `max-capacity`: a physical-fit estimate that may relax handling rules but
 *   still uses the same containment, collision, support, and blocked-body
 *   validation pipeline. Phase A never auto-selects this option.
 * - `constrained-first`: constrained (narrower) zones are reserved and filled
 *   with best-fitting cargo before the open floor phases run.
 * Leftover recovery runs inside EVERY strategy (it is part of the pipeline,
 * not a separate preset). The production engine applies the selected solution
 * and exposes every distinct strategy result to the AutoPack Results carousel.
 * @module packing-core/solution
 */

import { solveAutoPack } from '../services/autopack-solver.js';
import { getWheelWellGeometry } from './wheel-well-model.js';
import { REJECTION_CODES } from './explain.js';

export const PACKING_STRATEGIES = Object.freeze([
  Object.freeze({
    id: 'default',
    strategy: 'front-first-balanced',
    label: 'Balanced (recommended)',
    description: 'Best overall load quality; tidy rows, wheel-well aware.',
    options: Object.freeze({}),
  }),
  Object.freeze({
    id: 'compact-fill',
    strategy: 'front-first-compact',
    label: 'Compact fill',
    description: 'Densest fill; may mix orientations.',
    options: Object.freeze({ layoutQuality: false }),
  }),
  Object.freeze({
    id: 'floor-first',
    strategy: 'floor-only',
    label: 'Floor first (no stacking)',
    description: 'Single layer only — nothing stacked; extra items stage.',
    options: Object.freeze({ enableStackPhase: false }),
  }),
  Object.freeze({
    id: 'stack-priority',
    strategy: 'stack-priority',
    label: 'Stack priority',
    description: 'Stacks earlier to use vertical space.',
    options: Object.freeze({ stackFallbackImmediate: true }),
  }),
  Object.freeze({
    id: 'max-capacity',
    strategy: 'max-capacity',
    label: 'Max Capacity',
    description: 'Physical-fit estimate; handling rules may be relaxed. Not a transport recommendation.',
    options: Object.freeze({ maxCapacityMode: true }),
  }),
  Object.freeze({
    id: 'constrained-first',
    strategy: 'constrained-space-first',
    label: 'Constrained space first',
    description: 'Fills narrow Wheel Wells spaces before open floor.',
    options: Object.freeze({ constrainedSpaceFirst: true }),
  }),
]);

export function getPackingStrategy(id) {
  return PACKING_STRATEGIES.find(strategy => strategy.id === id) || null;
}

function toStrategyResult(preset, result) {
  return {
    id: preset.id,
    strategy: preset.strategy,
    placements: result.placements,
    rotations: result.rotations,
    orientedDims: result.orientedDims,
    retentionDependencies: result.retentionDependencies,
    unpacked: result.unpacked,
    warnings: result.warnings,
    rejectionReasons: result.rejectionReasons,
    solveStatus: result.solveStatus,
    phaseStats: result.phaseStats,
    stats: result.phaseStats,
  };
}

function placementCount(result) {
  return result && result.placements instanceof Map ? result.placements.size : 0;
}

function unpackedCount(result) {
  return Array.isArray(result && result.unpacked) ? result.unpacked.length : Number.MAX_SAFE_INTEGER;
}

function compareStrategyResults(a, b) {
  const packedDelta = placementCount(b.result) - placementCount(a.result);
  if (packedDelta) return packedDelta;
  const unpackedDelta = unpackedCount(a.result) - unpackedCount(b.result);
  if (unpackedDelta) return unpackedDelta;
  return a.index - b.index;
}

/**
 * Run the requested strategies over one PackingInput-shaped solver input and
 * return the PackingSolution envelope. When multiple strategies are requested,
 * the selected default is the highest packed-count solution, with request order
 * retained as the deterministic tie-break.
 *
 * @param {object} input - solveAutoPack input (truck, zones, items, options)
 * @param {string[]} [strategyIds=['default']]
 * @param {(input: object) => object} [solve=solveAutoPack] - injectable for tests
 */
export function runPackingStrategies(input, strategyIds = ['default'], solve = solveAutoPack) {
  const ids = Array.isArray(strategyIds) && strategyIds.length ? strategyIds : ['default'];
  const ranked = ids.map((id, index) => {
    const preset = getPackingStrategy(id);
    if (!preset) {
      throw new Error(`Unknown packing strategy: ${id}`);
    }
    const result = toStrategyResult(preset, solve({ ...input, ...preset.options }));
    return { index, result };
  });
  const solutions = ranked.map(entry => entry.result);
  const selected = [...ranked].sort(compareStrategyResults)[0]?.result || solutions[0];
  return {
    solutions,
    selected: selected ? selected.id : null,
    selectedSolution: selected || null,
  };
}

// Rejection codes no alternate strategy can ever overcome: the item statically
// cannot exist in this truck (or there is no usable space at all), or the
// orientation policy excludes every fitting pose — identical under every
// normal recovery strategy. Max Capacity is a separate, non-recovery analysis.
// Recovery re-solves are pointless for loads staged ONLY for these.
const STATIC_REJECTION_CODES = new Set([
  REJECTION_CODES.NO_FIT_ANY_SURFACE,
  REJECTION_CODES.NO_USABLE_SPACE,
  REJECTION_CODES.ORIENTATION_LOCKED,
]);

function recoveryCouldHelp(solution) {
  const reasons = Array.isArray(solution.rejectionReasons) ? solution.rejectionReasons : [];
  // No structured reasons for the staged items → assume a retry could help.
  if (!reasons.length) return (solution.unpacked || []).length > 0;
  return reasons.some(reason => !STATIC_REJECTION_CODES.has(reason.code));
}

/**
 * Production AutoPack entry: run the default strategy, then an intentional
 * ordered portfolio of real alternatives. Stack-priority and the Phase A
 * Max Capacity physical-fit estimate are always offered; constrained-first is
 * offered only when Wheel Wells geometry exists. Max Capacity is display-only
 * for automatic ranking in Phase A: users may apply it explicitly, but it can
 * never replace the best normal portfolio result by default. If the default
 * legitimately could not place everything, any remaining recovery strategies
 * may run only when they were not already attempted as portfolio options.
 *
 * Normal portfolio options run under half the primary budget (min 2 s). Max
 * Capacity runs exactly once under min(primary budget, 2 s), with no cleanup
 * window. Deduplication in the engine removes an option silently when it
 * produces a physically identical layout.
 *
 * Bounded on purpose:
 * - never retries when the primary miss was BUDGET-caused (more synchronous
 *   solving would burn more main-thread time for the same reason);
 * - never retries when every staged item is statically impossible;
 * - normal portfolio and recovery solves run under half the primary solve budget
 *   (min 2s) so the worst-case interactive wait stays capped;
 * - `strategyRecovery: false` opts out of recovery AND portfolio entirely
 *   (diagnostics/tests).
 * Physical validity is untouched — every strategy runs the same containment,
 * collision, support, blocked-body, and retention validation pipeline.
 */
export function runAdaptiveAutoPack(input, solve = solveAutoPack) {
  const primary = runPackingStrategies(input, ['default'], solve);
  const primarySolution = primary.selectedSolution;
  if (!primarySolution || input.strategyRecovery === false) return primary;

  // Per-solve budget cap applied to every non-primary solve.
  const primaryBudget = Number(input.solveBudgetMs);
  const secondaryBudgetMs = Number.isFinite(primaryBudget) && primaryBudget > 0
    ? Math.max(2000, primaryBudget / 2)
    : undefined;
  const secondaryInput = secondaryBudgetMs !== undefined
    ? { ...input, solveBudgetMs: secondaryBudgetMs }
    : input;

  // Always offer compact-fill, floor-first, and stack-priority as intentional
  // normal portfolio alternatives. constrained-first is meaningful only when
  // actual Wheel Wells geometry exists, so Standard and Front Overhang never
  // run it.
  // compact-fill: densest local-waste-first packing without layout-quality
  // re-ranking. floor-first: single-layer no-stacking layout; may pack fewer
  // cases on loads where stacking is required, but is a deliberate style
  // option for users who need a flat, accessible load. Stack-priority offers
  // safe supported stacking earlier instead of waiting for a partial default
  // result. All run under the same per-solve secondary budget cap.
  // Default stays first so index-order ties keep the default's layout-quality
  // plan as the auto-selected result.
  const hasWheelWellGeometry = Boolean(getWheelWellGeometry(input.truck || {}));
  const portfolioIds = ['compact-fill', 'floor-first', 'stack-priority'];
  const portfolio = runPackingStrategies(secondaryInput, portfolioIds, solve);

  // Phase A: Max Capacity is a separate, manually selectable physical-fit
  // estimate. Run it exactly once with a tighter main-thread budget and no
  // cleanup window. It is recorded as already attempted so no future recovery
  // list can rerun it, and excluded from automatic winner ranking below.
  const maxCapacityBudgetMs = Number.isFinite(primaryBudget) && primaryBudget > 0
    ? Math.min(primaryBudget, 2000)
    : 2000;
  const maxCapacity = runPackingStrategies({
    ...input,
    solveBudgetMs: maxCapacityBudgetMs,
    cleanupBudgetMs: 0,
  }, ['max-capacity'], solve);

  // Keep the raw/call order honest: the Wheel Wells-only constrained option is
  // evaluated after Max Capacity and displayed after it. It remains part of
  // the normal automatically selectable portfolio.
  const constrainedPortfolio = hasWheelWellGeometry
    ? runPackingStrategies(secondaryInput, ['constrained-first'], solve)
    : { solutions: [] };
  const normalPortfolioSolutions = [
    ...portfolio.solutions,
    ...constrainedPortfolio.solutions,
  ];
  const attemptedStrategyIds = new Set([
    'default',
    ...portfolioIds,
    'max-capacity',
    ...(hasWheelWellGeometry ? ['constrained-first'] : []),
  ]);

  const status = primarySolution.solveStatus || null;
  const complete = status
    ? status.complete === true
    : (primarySolution.unpacked || []).length === 0;
  const budgetCaused = Boolean(
    status && Array.isArray(status.partialCauses) && status.partialCauses.includes('budget')
  );

  // Recovery pass: only when default was partial and retrying could help. Any
  // strategy already run as an intentional portfolio option is filtered out,
  // preventing duplicate synchronous solves and duplicate recovery entries.
  let recoverySolutions = [];
  if (!complete && !budgetCaused && recoveryCouldHelp(primarySolution)) {
    const recoveryIds = ['stack-priority'];
    if (hasWheelWellGeometry) recoveryIds.push('constrained-first');
    const remainingRecoveryIds = recoveryIds.filter(id => !attemptedStrategyIds.has(id));
    if (remainingRecoveryIds.length) {
      const recovery = runPackingStrategies(secondaryInput, remainingRecoveryIds, solve);
      recoverySolutions = recovery.solutions;
    }
  }

  // Rank only the normal portfolio. Max Capacity may pack more only by relaxing
  // handling rules, so Phase A must never auto-apply it.
  const selectableSolutions = [
    ...primary.solutions,
    ...normalPortfolioSolutions,
    ...recoverySolutions,
  ];
  const ranked = selectableSolutions.map((result, index) => ({ index, result }));
  const selected = [...ranked].sort(compareStrategyResults)[0].result;

  // Raw Results order: Balanced, Compact, Floor, Stack, Max, then the optional
  // Wheel Wells constrained strategy. Recovery results (if any) stay last.
  const allSolutions = [
    ...primary.solutions,
    ...portfolio.solutions,
    ...maxCapacity.solutions,
    ...constrainedPortfolio.solutions,
    ...recoverySolutions,
  ];
  return {
    solutions: allSolutions,
    selected: selected.id,
    selectedSolution: selected,
  };
}
