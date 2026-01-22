/**
 * @file loader.js
 * @description Loads external vendor libraries at runtime via dynamic imports.
 * @module vendor/loader
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export async function loadThree({ version = '0.160.0' } = {}) {
  if (window.THREE && window.THREE.OrbitControls) return window.THREE;
  const v = String(version || '0.160.0');
  const base = `https://esm.sh/three@${v}`;
  try {
    const ThreeModule = await import(base);
    const Orbit = await import(`${base}/examples/jsm/controls/OrbitControls.js`);
    window.THREE = { ...ThreeModule, OrbitControls: Orbit.OrbitControls };
    return window.THREE;
  } catch (err) {
    console.error('[Vendor] Three load failed', err);
    throw err;
  }
}

export function listCdnFailures() {
  const failures =
    window.__TP3D_BOOT && Array.isArray(window.__TP3D_BOOT.cdnFailures) ? window.__TP3D_BOOT.cdnFailures : [];
  return failures.slice();
}
