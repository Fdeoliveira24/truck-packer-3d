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

/**
 * Run the requested strategies over one PackingInput-shaped solver input and
 * return the PackingSolution envelope. The first requested strategy is the
 * selected default handed to the current single-solution UI.
 *
 * @param {object} input - solveAutoPack input (truck, zones, items, options)
 * @param {string[]} [strategyIds=['default']]
 * @param {(input: object) => object} [solve=solveAutoPack] - injectable for tests
 */
export function runPackingStrategies(input, strategyIds = ['default'], solve = solveAutoPack) {
  const ids = Array.isArray(strategyIds) && strategyIds.length ? strategyIds : ['default'];
  const solutions = ids.map(id => {
    const preset = getPackingStrategy(id);
    if (!preset) {
      throw new Error(`Unknown packing strategy: ${id}`);
    }
    return toStrategyResult(preset, solve({ ...input, ...preset.options }));
  });
  return {
    solutions,
    selected: solutions[0].id,
    selectedSolution: solutions[0],
  };
}
