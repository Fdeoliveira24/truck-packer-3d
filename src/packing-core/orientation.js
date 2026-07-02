/**
 * @file orientation.js
 * @description Single import point for orientation policy inside the packing
 * core. Rotation math already has one source of truth (core/oriented-dims.js)
 * and candidate policy already has one live implementation
 * (autopack-solver.buildOrientationCandidates); this module re-exports them so
 * packing-core consumers never reach into services/core modules directly.
 * @module packing-core/orientation
 */

export { canonicalOrientationLock } from '../core/orientation.js';
export {
  RIGHT_ANGLE_RAD,
  normalizeRightAngle,
  normalizeRightAngleRotation,
  getOrientedDimsForRotation,
} from '../core/oriented-dims.js';
export { buildOrientationCandidates } from '../services/autopack-solver.js';
