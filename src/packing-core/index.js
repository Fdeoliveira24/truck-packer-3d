/**
 * @file index.js
 * @description Public surface of the AutoPack packing core. Consumers (engine,
 * solver, editor revalidation) import from here, never from the individual
 * packing-core modules, so the core can be reorganized without touching call
 * sites. See docs/engineering/autopack-core-engine-plan.md.
 * @module packing-core
 */

export { SURFACE_KINDS, BLOCKED_KINDS, makeSurface, makeBlockedVolume } from './domain.js';
export { buildSpaceModel, getConstrainedZones } from './space-model.js';
export {
  canonicalOrientationLock,
  RIGHT_ANGLE_RAD,
  normalizeRightAngle,
  normalizeRightAngleRotation,
  getOrientedDimsForRotation,
  buildOrientationCandidates,
} from './orientation.js';
