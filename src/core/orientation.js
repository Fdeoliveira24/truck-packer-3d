/**
 * @file orientation.js
 * @description Single canonical source for the case `orientationLock` value.
 * Pure module so it can be used by core normalizers, the data
 * model, services (solver, pack-library, import-export, case-rule-summary) and
 * UI (case modal) without circular dependencies.
 *
 * Canonical stored values: 'any' | 'upright' | 'onSide'.
 * All accepted spellings (case-insensitive, trimmed) map to one of these; any
 * unrecognized / blank / null / undefined value maps to 'any'.
 * @module core/orientation
 */

import { getPhysicalOrientationAxes } from './oriented-dims.js';

export function canonicalOrientationLock(value) {
  const s = String(value == null ? 'any' : value)
    .trim()
    .toLowerCase();
  if (s === 'upright') return 'upright';
  if (s === 'onside' || s === 'on-side' || s === 'on side' || s === 'on_side') return 'onSide';
  return 'any';
}

/**
 * Strict C1 interpretation. Human boundaries may explicitly permit the blank
 * default; malformed explicit values never become 'any'. The permissive helper
 * above remains wired only until the coordinated C3 runtime cutover.
 */
export function parseCaseOrientationLock(raw, { allowDefault = false } = {}) {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    return allowDefault ? { value: 'any', valid: true } : { value: undefined, valid: false };
  }
  if (typeof raw !== 'string' ||
      !['any', 'upright', 'onside', 'on-side', 'on side', 'on_side'].includes(raw.trim().toLowerCase())) {
    return { value: undefined, valid: false };
  }
  return { value: canonicalOrientationLock(raw), valid: true };
}

/**
 * Case physical permission, independent of canFlip, profiles and instance
 * planning targets. Upright requires authored +Y to map to world +Y; onSide
 * requires one of the four authored side faces to face down. Only supported
 * right-angle poses are considered. Live callers switch to this in C3.
 */
export function isCasePhysicalOrientationAllowed(caseData, rotation) {
  const permission = parseCaseOrientationLock(caseData?.orientationLock);
  const axes = getPhysicalOrientationAxes(rotation);
  if (!permission.valid || !axes.valid) return false;
  if (permission.value === 'upright') return axes.value.y.y === 1;
  if (permission.value === 'onSide') return axes.value.y.y === 0;
  return true;
}
