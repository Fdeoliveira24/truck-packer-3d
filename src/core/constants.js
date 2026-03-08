/**
 * • LEGACY / NOT USED BY CURRENT RUNTIME IMPORT CHAIN
 * • Do NOT import this file unless you also reconcile storage/session APIs and key strategy.
 * • Runtime canonical storage key module: `src/core/storage.js`.
 * • Runtime canonical event module: `src/core/events.js`.
 * • If applicable: This module expects readJson/writeJson/removeKey from storage, but current core storage does not export them.
 */

/**
 * @file constants.js
 * @description Core primitives used across the application.
 * @module core/constants
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export const APP_NAME = 'Truck Packer 3D';
export const APP_VERSION = '1.0.0';

export const STORAGE_KEYS = {
  // Legacy compatibility constants only (v2 repo/session). Do not use for runtime app state.
  legacyAppV1: 'truckPacker3d:v1',
  appData: 'truckPacker3d:v2:data',
  session: 'truckPacker3d:v2:session',
};

export const DEFAULT_TRUCK = { length: 636, width: 102, height: 98 };
