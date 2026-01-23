/**
 * • LEGACY / NOT USED BY CURRENT RUNTIME IMPORT CHAIN
 * • Do NOT import this file unless you also reconcile storage/session APIs and key strategy.
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
  legacyAppV1: 'truckPacker3d:v1',
  appData: 'truckPacker3d:v2:data',
  session: 'truckPacker3d:v2:session',
};

export const DEFAULT_TRUCK = { length: 636, width: 102, height: 98 };
