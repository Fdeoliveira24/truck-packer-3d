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
 * - `constrained-first`: constrained (narrower) zones are reserved and filled
 *   with best-fitting cargo before the open floor phases run.
 * Leftover recovery runs inside EVERY strategy (it is part of the pipeline,
 * not a separate preset). The production engine routes through
 * runPackingStrategies and consumes the selected default solution; future
 * multi-solution UI can request additional strategies without engine changes.
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
    description: 'Production pipeline: front-first, layout-quality ranked, wheel-well aware, leftover recovery.',
    options: Object.freeze({}),
  }),
  Object.freeze({
    id: 'compact-fill',
    strategy: 'front-first-compact',
    label: 'Compact fill',
    description: 'Densest local packing without layout-quality re-ranking; may mix orientations.',
    options: Object.freeze({ layoutQuality: false }),
  }),
  Object.freeze({
    id: 'floor-first',
    strategy: 'floor-only',
    label: 'Floor first (no stacking)',
    description: 'Single-layer loading: nothing is placed on top of other cargo; unfittable items stage.',
    options: Object.freeze({ enableStackPhase: false }),
  }),
  Object.freeze({
    id: 'stack-priority',
    strategy: 'stack-priority',
    label: 'Stack priority',
    description: 'Items failing the floor try a safe supported stack immediately, favoring vertical use.',
    options: Object.freeze({ stackFallbackImmediate: true }),
  }),
  Object.freeze({
    id: 'constrained-first',
    strategy: 'constrained-space-first',
    label: 'Constrained space first',
    description: 'Reserves narrow zones (e.g. the wheel-well channel) for fitting cargo before open floor fills.',
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
// strategy. Recovery re-solves are pointless for loads staged ONLY for these.
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
 * Production AutoPack entry: run the default strategy, and — only when it
 * legitimately could not place everything — retry with the real alternate
 * strategies that can beat it on hard fits (stack-priority everywhere,
 * constrained-first on wheel-well trucks), then select the best practical
 * result: highest packed count first, ties preferring the default strategy's
 * layout-quality-ranked plan.
 *
 * Also always runs compact-fill and floor-first as second and third portfolio
 * options so users can compare the default's layout-quality plan against the
 * densest local-fill ordering (compact-fill) and a deliberate single-layer
 * no-stacking layout (floor-first). Both run under half the primary budget
 * (min 2 s) to keep the total main-thread time bounded; deduplication in the
 * engine removes them silently when a strategy produces the identical layout.
 *
 * Bounded on purpose:
 * - never retries when the primary miss was BUDGET-caused (more synchronous
 *   solving would burn more main-thread time for the same reason);
 * - never retries when every staged item is statically impossible;
 * - portfolio and recovery solves run under half the primary solve budget
 *   (min 2s) so the worst-case interactive wait stays capped;
 * - `strategyRecovery: false` opts out of recovery AND portfolio entirely
 *   (diagnostics/tests).
 * Hard rules are untouched — every strategy runs the same validation pipeline.
 */
export function runAdaptiveAutoPack(input, solve = solveAutoPack) {
  const primary = runPackingStrategies(input, ['default'], solve);
  const primarySolution = primary.selectedSolution;
  if (!primarySolution || input.strategyRecovery === false) return primary;

  // Bounded budget shared by every non-primary solve.
  const primaryBudget = Number(input.solveBudgetMs);
  const secondaryBudgetMs = Number.isFinite(primaryBudget) && primaryBudget > 0
    ? Math.max(2000, primaryBudget / 2)
    : undefined;
  const secondaryInput = secondaryBudgetMs !== undefined
    ? { ...input, solveBudgetMs: secondaryBudgetMs }
    : input;

  // Always offer compact-fill and floor-first as portfolio alternatives.
  // compact-fill: densest local-waste-first packing without layout-quality
  // re-ranking. floor-first: single-layer no-stacking layout; may pack fewer
  // cases on loads where stacking is required, but is a deliberate style
  // option for users who need a flat, accessible load. Both run under the
  // same secondary budget cap so the total main-thread time stays bounded.
  // Default stays first so index-order ties keep the default's layout-quality
  // plan as the auto-selected result.
  const portfolio = runPackingStrategies(secondaryInput, ['compact-fill', 'floor-first'], solve);

  const status = primarySolution.solveStatus || null;
  const complete = status
    ? status.complete === true
    : (primarySolution.unpacked || []).length === 0;
  const budgetCaused = Boolean(
    status && Array.isArray(status.partialCauses) && status.partialCauses.includes('budget')
  );

  // Recovery pass: only when default was partial and retrying with strategies
  // that can beat it on hard fits. compact-fill is intentionally excluded from
  // the recovery IDs — it is already part of the portfolio run above and must
  // not run twice.
  let recoverySolutions = [];
  if (!complete && !budgetCaused && recoveryCouldHelp(primarySolution)) {
    const recoveryIds = ['stack-priority'];
    if (getWheelWellGeometry(input.truck || {})) recoveryIds.push('constrained-first');
    const recovery = runPackingStrategies(secondaryInput, recoveryIds, solve);
    recoverySolutions = recovery.solutions;
  }

  // Default first, then compact-fill, then any recovery solutions.
  // Default wins all merit ties (index 0 in the sorted order).
  const allSolutions = [...primary.solutions, ...portfolio.solutions, ...recoverySolutions];
  const ranked = allSolutions.map((result, index) => ({ index, result }));
  const selected = [...ranked].sort(compareStrategyResults)[0].result;
  return {
    solutions: allSolutions,
    selected: selected.id,
    selectedSolution: selected,
  };
}
