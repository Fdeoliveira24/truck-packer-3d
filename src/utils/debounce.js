/**
 * @file debounce.js
 * @description Small debounce helper for rate-limiting frequently-fired callbacks.
 * @module utils/debounce
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function debounce(fn, waitMs = 200) {
  let t = 0;
  return (...args) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), waitMs);
  };
}
