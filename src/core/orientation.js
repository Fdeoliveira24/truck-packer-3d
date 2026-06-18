/**
 * @file orientation.js
 * @description Single canonical source for the case `orientationLock` value.
 * Dependency-free leaf module so it can be used by core normalizers, the data
 * model, services (solver, pack-library, import-export, case-rule-summary) and
 * UI (case modal) without circular dependencies.
 *
 * Canonical stored values: 'any' | 'upright' | 'onSide'.
 * All accepted spellings (case-insensitive, trimmed) map to one of these; any
 * unrecognized / blank / null / undefined value maps to 'any'.
 * @module core/orientation
 */

export function canonicalOrientationLock(value) {
  const s = String(value == null ? 'any' : value)
    .trim()
    .toLowerCase();
  if (s === 'upright') return 'upright';
  if (s === 'onside' || s === 'on-side' || s === 'on side' || s === 'on_side') return 'onSide';
  return 'any';
}
