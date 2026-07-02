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
 * Only strategies that genuinely exist in the solver today are registered.
 * `default` is the production pipeline; `compact-fill` is the real
 * layout-quality-off variant (original waste-first density ordering — packs at
 * least as many cases, may mix orientations). Future strategies
 * (constrained-first reservation, wall-build, stack-priority) get presets here
 * only once the solver actually implements their semantics — never as renamed
 * aliases of existing options.
 *
 * The engine still calls solveAutoPack directly (that call is a pinned
 * AUTO-PACK-A1-R6 contract); routing it through runPackingStrategies is a
 * deliberate later step once multi-solution UI work starts. Until then the UI
 * consuming the direct solver result is exactly equivalent to consuming the
 * selected `default` solution — proven by test.
 * @module packing-core/solution
 */

import { solveAutoPack } from '../services/autopack-solver.js';

export const PACKING_STRATEGIES = Object.freeze([
  Object.freeze({
    id: 'default',
    strategy: 'front-first-balanced',
    label: 'Balanced (recommended)',
    description: 'Production pipeline: front-first, layout-quality ranked, wheel-well aware.',
    options: Object.freeze({}),
  }),
  Object.freeze({
    id: 'compact-fill',
    strategy: 'front-first-compact',
    label: 'Compact fill',
    description: 'Densest local packing without layout-quality re-ranking; may mix orientations.',
    options: Object.freeze({ layoutQuality: false }),
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
