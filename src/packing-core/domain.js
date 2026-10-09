/**
 * @file domain.js
 * @description Shared data-model vocabulary and physical source projections.
 * Pure constructors and interpretation only — no measurements, state or DOM.
 * See docs/engineering/autopack-core-engine-plan.md §3 for the full contract.
 * @module packing-core/domain
 */

import {
  DIMENSION_MAX_INCHES,
  PALLET_WEIGHT_MAX_LBS,
  STACK_COUNT_MAX,
  isCanonicalCaseMass,
} from '../core/cargo-canonical.js';
import { parseCaseOrientationLock } from '../core/orientation.js';
import { getPhysicalOrientationAxes } from '../core/oriented-dims.js';

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

// C1 source-only foundation for C2 assessment. These exports have no live
// consumers yet. Only successful values are canonical projection inputs;
// interpretation failures must not be used as assessment/cache identities.
// Never run permissive storage normalization or invent missing physical data.
function invalidPhysicalSource(field) {
  return { value: undefined, valid: false, field };
}

function isSourceRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSourceId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSourceNumber(value, min, max = Infinity) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Project a Case's physical source fields. Nullable weight is the sole mass
 * source; no separate knowledge flag. Handling fields retain their established
 * defaults when omitted, but explicit malformed values fail interpretation.
 * Planning preferences, display metadata, canFlip and safe extensions are not
 * assessment inputs. The pallet limit remains source data for an advisory.
 */
export function projectCasePhysicalSource(caseData) {
  if (!isSourceRecord(caseData) || !isSourceId(caseData.id)) return invalidPhysicalSource('id');
  const dimensions = {};
  for (const key of ['length', 'width', 'height']) {
    const value = caseData.dimensions?.[key];
    if (!isSourceNumber(value, 0, DIMENSION_MAX_INCHES) || value === 0) {
      return invalidPhysicalSource(`dimensions.${key}`);
    }
    dimensions[key] = value;
  }
  if (!isCanonicalCaseMass(caseData.weight)) return invalidPhysicalSource('weight');
  if (!['box', 'cylinder', 'drum'].includes(caseData.shape)) return invalidPhysicalSource('shape');
  const orientation = parseCaseOrientationLock(caseData.orientationLock);
  if (!orientation.valid) return invalidPhysicalSource('orientationLock');
  const booleans = {};
  for (const [key, fallback] of Object.entries({ noStackOnTop: false, stackable: true, isPallet: false })) {
    const value = caseData[key] === undefined ? fallback : caseData[key];
    if (typeof value !== 'boolean') return invalidPhysicalSource(key);
    booleans[key] = value;
  }
  const maxStackCount = caseData.maxStackCount === undefined ? 0 : caseData.maxStackCount;
  if (!isSourceNumber(maxStackCount, 0, STACK_COUNT_MAX) || !Number.isInteger(maxStackCount)) {
    return invalidPhysicalSource('maxStackCount');
  }
  const maxPalletWeight = caseData.maxPalletWeight === undefined ? 0 : caseData.maxPalletWeight;
  if (!isSourceNumber(maxPalletWeight, 0, PALLET_WEIGHT_MAX_LBS)) return invalidPhysicalSource('maxPalletWeight');
  return {
    value: {
      id: caseData.id,
      dimensions,
      weight: caseData.weight,
      shape: caseData.shape,
      orientationLock: orientation.value,
      noStackOnTop: booleans.noStackOnTop || !booleans.stackable,
      maxStackCount,
      isPallet: booleans.isPallet,
      maxPalletWeight,
    },
    valid: true,
  };
}

/**
 * Project every instance independently of visibility and saved membership.
 * C2 determines physical participation from measurements, never from hidden or
 * placement alone. Actual pose is position plus signed authored axes so equal
 * Euler representations compare equally without inventing Case symmetry.
 * Planning locks, profiles and the orientedDims cache are deliberately absent.
 */
export function projectInstancePhysicalSource(instance) {
  if (!isSourceRecord(instance) || !isSourceId(instance.id)) return invalidPhysicalSource('id');
  if (!isSourceId(instance.caseId)) return invalidPhysicalSource('caseId');
  if (!['packed', 'staged'].includes(instance.placement)) return invalidPhysicalSource('placement');
  const position = {};
  for (const axis of ['x', 'y', 'z']) {
    const value = instance.transform?.position?.[axis];
    if (typeof value !== 'number' || !Number.isFinite(value)) return invalidPhysicalSource(`position.${axis}`);
    position[axis] = value === 0 ? 0 : value;
  }
  const orientation = getPhysicalOrientationAxes(instance.transform?.rotation);
  if (!orientation.valid) return invalidPhysicalSource('rotation');
  const hidden = instance.hidden === undefined ? false : instance.hidden;
  if (typeof hidden !== 'boolean') return invalidPhysicalSource('hidden');
  return {
    value: {
      id: instance.id,
      caseId: instance.caseId,
      placement: instance.placement,
      pose: { position, axes: orientation.value },
      visibility: { hidden },
    },
    valid: true,
  };
}

/**
 * Copy target-space source geometry, not computed zones/supports. Only active
 * shape fields participate; bonusWidth is legacy display data, not geometry.
 * Missing optional shape fields stay absent for C2's geometry interpretation;
 * explicit malformed values are never clamped or replaced with default space.
 */
export function projectTargetSpaceSource(truck) {
  if (!isSourceRecord(truck)) return invalidPhysicalSource('truck');
  const dimensions = {};
  for (const key of ['length', 'width', 'height']) {
    const value = truck[key];
    if (!isSourceNumber(value, 0) || value === 0) return invalidPhysicalSource(key);
    dimensions[key] = value;
  }
  if (!['rect', 'wheelWells', 'frontBonus'].includes(truck.shapeMode)) return invalidPhysicalSource('shapeMode');
  const fields = truck.shapeMode === 'wheelWells'
    ? ['wellHeight', 'wellWidth', 'wellLength', 'wellOffsetFromRear']
    : truck.shapeMode === 'frontBonus' ? ['bonusLength', 'bonusHeight'] : [];
  if (fields.length && truck.shapeConfig !== undefined && !isSourceRecord(truck.shapeConfig)) {
    return invalidPhysicalSource('shapeConfig');
  }
  const shapeConfig = {};
  for (const key of fields) {
    const value = truck.shapeConfig?.[key];
    if (value === undefined) continue;
    if (!isSourceNumber(value, 0)) return invalidPhysicalSource(`shapeConfig.${key}`);
    shapeConfig[key] = value;
  }
  return { value: { ...dimensions, shapeMode: truck.shapeMode, shapeConfig }, valid: true };
}
