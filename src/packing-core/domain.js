/**
 * @file domain.js
 * @description Shared data-model vocabulary for the AutoPack packing core.
 * Pure constructors and constants only — no geometry, no state, no DOM.
 * See docs/engineering/autopack-core-engine-plan.md §3 for the full contract.
 * @module packing-core/domain
 */

/** Support surface kinds a solver may rest cargo on. */
export const SURFACE_KINDS = Object.freeze({
  FLOOR: 'floor',
  RAISED_FLOOR: 'raisedFloor',
  RIGID_TOP: 'rigidTop',
});

/** Blocked-volume kinds cargo must never intersect. */
export const BLOCKED_KINDS = Object.freeze({
  WHEEL_WELL_BODY: 'wheelWellBody',
  CAB_VOID: 'cabVoid',
});

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build a Surface record. A surface is a horizontal rectangle at height `y`
 * cargo may rest on. Rigid surfaces (zone floors, wheel-well tops) always bear
 * weight like the floor; cargo-top surfaces are modeled separately by the
 * solver's support rules, never here.
 */
export function makeSurface({ kind, y, minX, maxX, minZ, maxZ, zoneIndex = null }) {
  return {
    kind,
    y: finiteNumber(y),
    minX: finiteNumber(minX),
    maxX: finiteNumber(maxX),
    minZ: finiteNumber(minZ),
    maxZ: finiteNumber(maxZ),
    zoneIndex,
    rigid: true,
  };
}

/** Build a BlockedVolume record from an inch-space AABB. */
export function makeBlockedVolume(kind, aabb) {
  return {
    kind,
    min: { x: aabb.min.x, y: aabb.min.y, z: aabb.min.z },
    max: { x: aabb.max.x, y: aabb.max.y, z: aabb.max.z },
  };
}
