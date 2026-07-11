/**
 * @file pack-library.js
 * @description UI-free service module for pack library operations and state updates.
 * @module services/pack-library
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as StateStore from '../core/state-store.js';
import * as Utils from '../core/utils/index.js';
import * as CoreNormalizer from '../core/normalizer.js';
import * as CaseLibrary from './case-library.js';
import { canonicalOrientationLock } from '../core/orientation.js';
import {
  normalizeRightAngle,
  normalizeRightAngleRotation,
  getOrientedDimsForRotation,
} from '../core/oriented-dims.js';
import { cargoComparisonKey, cargoFieldsEqual } from '../core/cargo-canonical.js';
// Hard-rule predicates and tolerances come from the single validation authority
// shared with the AutoPack solver (packing-core/validation.js), so manual
// revalidation and AutoPack can never silently diverge on a rule or epsilon.
// Imported directly (not via packing-core/index.js) to keep the graph cycle-free.
import {
  CONTAINMENT_EPS_INCHES,
  PLACEMENT_EPS,
  MIN_SUPPORT_FRACTION,
  aabbsOverlap as validationAabbsOverlap,
  isAabbContainedInZone as validationAabbContainedInZone,
  isAabbContainedInAnyZone as validationAabbContainedInAnyZone,
  computeSupportFraction as validationComputeSupportFraction,
  rulesAllowStackOnTop,
  rulesMaxStackCount,
  weightAllowsSupport,
} from '../packing-core/validation.js';
// The wheel-well physical model shared with the solver: manual revalidation
// must accept the same legal on-well/bridge poses AutoPack produces, or any
// manual edit near the wells ejects solver-legal cargo to staging.
import {
  getWheelWellGeometry,
  isAabbWithinTruckMinusBlocked,
  isWheelWellSupportedAndStable,
} from '../packing-core/wheel-well-model.js';
import { repairDependentPlacements } from '../packing-core/repair.js';
import { computeCoG } from './cog-service.js';
import { computePalletWarnings } from './oog-service.js';

// Re-export the shared tolerances so existing consumers importing them from
// pack-library keep working while the single source lives in packing-core.
export { CONTAINMENT_EPS_INCHES, PLACEMENT_EPS, MIN_SUPPORT_FRACTION };

// Re-export the shared oriented-dimension helpers so existing consumers that
// import them from pack-library (autopack-engine, editor-screen) keep working
// while the single source of truth lives in core/oriented-dims.js.
export { normalizeRightAngleRotation, getOrientedDimsForRotation };

function getDims(truck) {
  const t = truck && typeof truck === 'object' ? truck : {};
  const length = Math.max(0, Number(t.length) || 0);
  const width = Math.max(0, Number(t.width) || 0);
  const height = Math.max(0, Number(t.height) || 0);
  return { length, width, height };
}

function getMode(truck) {
  const mode = truck && truck.shapeMode;
  if (mode === 'wheelWells' || mode === 'frontBonus' || mode === 'rect') return mode;
  return 'rect';
}

function getConfig(truck) {
  const cfg = truck && truck.shapeConfig;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function zone(min, max) {
  return { min: { ...min }, max: { ...max } };
}

function sanitizeZones(zones) {
  const EPS = 1e-9;
  return (zones || []).filter(z => {
    const dx = z.max.x - z.min.x;
    const dy = z.max.y - z.min.y;
    const dz = z.max.z - z.min.z;
    return dx > EPS && dy > EPS && dz > EPS;
  });
}

/**
 * Truck/container coordinate convention (inches), shared by usable-zone
 * geometry, canonical staging (getStagingLayout), and manual placement:
 *  - X = truck length, x=0 is the rear / loading-door end, x=truck.length
 *    is the front / cab end (frontBonus sits at the high-X end).
 *  - Y = height, y=0 is the floor.
 *  - Z = width, centered on 0 (z=-truck.width/2 is left, z=+truck.width/2
 *    is right); wheel wells are measured from the rear (low-X) end via
 *    wellOffsetFromRear.
 * This is documentation of the existing convention only - no geometry here
 * changes as a result.
 */
export const TRUCK_DIRECTION_MODEL = Object.freeze({
  lengthAxis: 'x',
  widthAxis: 'z',
  heightAxis: 'y',
  rear: { axis: 'x', value: 0 },
  front: { axis: 'x', value: 'truck.length' },
  floor: { axis: 'y', value: 0 },
  left: { axis: 'z', value: '-truck.width / 2' },
  right: { axis: 'z', value: 'truck.width / 2' },
});

/**
 * Resolve TRUCK_DIRECTION_MODEL's symbolic bounds to concrete numbers for a
 * given truck. Pure description of the existing coordinate convention; does
 * not affect any geometry or placement math.
 */
export function getTruckDirectionModel(truck) {
  const { length: L, width: W } = getDims(truck);
  return {
    lengthAxis: TRUCK_DIRECTION_MODEL.lengthAxis,
    widthAxis: TRUCK_DIRECTION_MODEL.widthAxis,
    heightAxis: TRUCK_DIRECTION_MODEL.heightAxis,
    rear: { axis: 'x', value: 0 },
    front: { axis: 'x', value: L },
    floor: { axis: 'y', value: 0 },
    left: { axis: 'z', value: -W / 2 },
    right: { axis: 'z', value: W / 2 },
  };
}

/**
 * Shape-mode semantics for getTrailerUsableZones(truck) (G2 audit; G2.2B
 * true front-overhang update):
 *  - 'rect' (Standard): the entire 0..truck.length x 0..height x
 *    -width/2..width/2 box is a single usable zone.
 *  - 'wheelWells' (Box + Wheel Wells): the outer box/mesh is unchanged; the
 *    wheel-well volumes (low-height strips near the side walls) are not part
 *    of any returned zone, so an item placed there can render inside the
 *    outer trailer box while still being classified outside the usable
 *    zones (placement 'staged').
 *  - 'frontBonus' (Box + Front Overhang): the main zone is always the full
 *    0..truck.length x 0..height x -width/2..width/2 box (identical to
 *    'rect'). bonusHeight is the deck height / cab clearance, measured from
 *    the main floor (NOT the usable cargo height of the overhang). When
 *    bonusLength > 0, a second zone is appended immediately in front of the
 *    main box, modeling a raised over-cab deck that is flush with the main
 *    box's ceiling and spans the full trailer width:
 *    x: truck.length..truck.length+bonusLength, y: bonusHeight..height,
 *    z: -width/2..width/2 (bonusHeight clamped to <= height; usable overhang
 *    cargo height = height - bonusHeight). The space below the deck
 *    (x > truck.length, y < bonusHeight) is the unusable "cab void" - see
 *    getFrontBonusBlockedZones() - and is not part of any usable zone.
 *    bonusWidth is retained on shapeConfig for backward compatibility only
 *    and is not used in this geometry. A missing, invalid, or non-positive
 *    bonusLength defaults to 0, the overhang zone is then sanitized away,
 *    and frontBonus is geometrically equivalent to 'rect'. A missing or
 *    invalid bonusHeight defaults to 0.45 * height so the overhang never
 *    accidentally creates a floor-level deck.
 */
function getTrailerUsableZones(truck) {
  const { length: L, width: W, height: H } = getDims(truck);
  const mode = getMode(truck);
  const cfg = getConfig(truck);

  if (!L || !W || !H) return [];

  if (mode === 'frontBonus') {
    const bonusLengthRaw = Number(cfg.bonusLength);
    const bonusHeightRaw = Number(cfg.bonusHeight);

    const bonusLength = Math.max(0, Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0);
    const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : 0.45 * H, 0, H);

    const zones = [
      zone({ x: 0, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 }),
      zone({ x: L, y: bonusHeight, z: -W / 2 }, { x: L + bonusLength, y: H, z: W / 2 }),
    ];
    return sanitizeZones(zones);
  }

  if (mode === 'wheelWells') {
    const wellHeightRaw = Number(cfg.wellHeight);
    const wellWidthRaw = Number(cfg.wellWidth);
    const wellLengthRaw = Number(cfg.wellLength);
    const wellOffsetRaw = Number(cfg.wellOffsetFromRear);

    const wellHeight = Utils.clamp(Number.isFinite(wellHeightRaw) ? wellHeightRaw : 0.35 * H, 0, H);
    const wellWidth = Utils.clamp(Number.isFinite(wellWidthRaw) ? wellWidthRaw : 0.15 * W, 0, W / 2);
    const wellLength = Utils.clamp(Number.isFinite(wellLengthRaw) ? wellLengthRaw : 0.35 * L, 0, L);
    const wellOffsetFromRear = Utils.clamp(Number.isFinite(wellOffsetRaw) ? wellOffsetRaw : 0.25 * L, 0, L);

    const wx0 = wellOffsetFromRear;
    const wx1 = Utils.clamp(wx0 + wellLength, wx0, L);
    const betweenHalfW = Math.max(0, W / 2 - wellWidth);

    const zones = [
      zone({ x: 0, y: 0, z: -W / 2 }, { x: wx0, y: H, z: W / 2 }),
      zone({ x: wx0, y: 0, z: -betweenHalfW }, { x: wx1, y: H, z: betweenHalfW }),
      zone({ x: wx0, y: wellHeight, z: -W / 2 }, { x: wx1, y: H, z: -betweenHalfW }),
      zone({ x: wx0, y: wellHeight, z: betweenHalfW }, { x: wx1, y: H, z: W / 2 }),
      zone({ x: wx1, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 }),
    ];
    return sanitizeZones(zones);
  }

  return [zone({ x: 0, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 })];
}

/**
 * G2.2: getFrontBonusBlockedZones() returns the "cab void" beneath the
 * raised over-cab deck (x: truck.length..truck.length+bonusLength,
 * y: 0..bonusHeight, full trailer width). This space is structurally
 * occupied by the cab and is never part of a usable zone - mirrors the
 * wheel-well blocked-zone shape so visuals/tests/warning logic can treat it
 * the same way as a blocked wheel-well volume.
 */
function getFrontBonusBlockedZones(truck) {
  const { length: L, width: W, height: H } = getDims(truck);
  const mode = getMode(truck);
  const cfg = getConfig(truck);
  if (mode !== 'frontBonus') return [];
  if (!L || !W || !H) return [];

  const bonusLengthRaw = Number(cfg.bonusLength);
  const bonusHeightRaw = Number(cfg.bonusHeight);

  const bonusLength = Math.max(0, Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0);
  const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : 0.45 * H, 0, H);

  const zones = [zone({ x: L, y: 0, z: -W / 2 }, { x: L + bonusLength, y: bonusHeight, z: W / 2 })];
  return sanitizeZones(zones);
}

/**
 * Wheel-well blocked bodies occupy the lower side-wall strips inside the
 * otherwise rectangular trailer shell. They are collision obstacles, not
 * staging/work-floor space.
 */
function getWheelWellsBlockedZones(truck) {
  const { length: L, width: W, height: H } = getDims(truck);
  const mode = getMode(truck);
  const cfg = getConfig(truck);
  if (mode !== 'wheelWells') return [];
  if (!L || !W || !H) return [];

  const wellHeightRaw = Number(cfg.wellHeight);
  const wellWidthRaw = Number(cfg.wellWidth);
  const wellLengthRaw = Number(cfg.wellLength);
  const wellOffsetRaw = Number(cfg.wellOffsetFromRear);

  const wellHeight = Utils.clamp(Number.isFinite(wellHeightRaw) ? wellHeightRaw : 0.35 * H, 0, H);
  const wellWidth = Utils.clamp(Number.isFinite(wellWidthRaw) ? wellWidthRaw : 0.15 * W, 0, W / 2);
  const wellLength = Utils.clamp(Number.isFinite(wellLengthRaw) ? wellLengthRaw : 0.35 * L, 0, L);
  const wellOffsetFromRear = Utils.clamp(Number.isFinite(wellOffsetRaw) ? wellOffsetRaw : 0.25 * L, 0, L);

  const wx0 = wellOffsetFromRear;
  const wx1 = Utils.clamp(wx0 + wellLength, wx0, L);
  const betweenHalfW = Math.max(0, W / 2 - wellWidth);

  const zones = [
    zone({ x: wx0, y: 0, z: -W / 2 }, { x: wx1, y: wellHeight, z: -betweenHalfW }),
    zone({ x: wx0, y: 0, z: betweenHalfW }, { x: wx1, y: wellHeight, z: W / 2 }),
  ];
  return sanitizeZones(zones);
}

function getTrailerCapacityInches3(truck) {
  const zones = getTrailerUsableZones(truck);
  return zones.reduce((sum, z) => {
    const dx = z.max.x - z.min.x;
    const dy = z.max.y - z.min.y;
    const dz = z.max.z - z.min.z;
    return sum + Math.max(0, dx) * Math.max(0, dy) * Math.max(0, dz);
  }, 0);
}

/** Maximum accepted gap between a retaining wall's front face and the overhang step. */
export const REAR_RETENTION_MAX_STEP_GAP_INCHES = 0.05;

/** Rear retention requires the candidate's complete width; vertical support uses a separate rule. */
export const MIN_REAR_RETENTION_WIDTH_FRACTION = 1.0;

const aabbContainedInZone = validationAabbContainedInZone;

/**
 * Resolve the true raised Front Overhang deck and its main-floor step geometry.
 * Wheel-well raised zones never extend beyond truck.length and therefore cannot
 * activate this contract.
 */
export function getFrontOverhangRetentionGeometry(truck, zonesOverride = null) {
  const t = truck && typeof truck === 'object' ? truck : {};
  if (getMode(t) !== 'frontBonus') return null;
  const length = Math.max(0, Number(t.length) || 0);
  const zones = Array.isArray(zonesOverride) ? zonesOverride : getTrailerUsableZones(t);
  const deckZone = zones
    .filter(z =>
      z && z.min && z.max &&
      z.min.y > CONTAINMENT_EPS_INCHES &&
      z.max.x > length + CONTAINMENT_EPS_INCHES &&
      Math.abs(z.min.x - length) <= CONTAINMENT_EPS_INCHES
    )
    .sort((a, b) => b.max.x - a.max.x || a.min.y - b.min.y)[0] || null;
  if (!deckZone) return null;
  const stepX = deckZone.min.x;
  const mainZone = zones.find(z =>
    z && z.min && z.max &&
    Math.abs(z.min.y) <= CONTAINMENT_EPS_INCHES &&
    Math.abs(z.max.x - stepX) <= CONTAINMENT_EPS_INCHES &&
    z.min.z <= deckZone.min.z + CONTAINMENT_EPS_INCHES &&
    z.max.z >= deckZone.max.z - CONTAINMENT_EPS_INCHES
  ) || null;
  if (!mainZone) return null;
  return { stepX, deckY: deckZone.min.y, deckZone, mainZone };
}

function retentionPlacementEntry(value, index) {
  if (!value) return null;
  const aabb = value.aabb || (value.min && value.max ? value : null);
  if (!aabb) return null;
  const id = value.instanceId || value.id || `retainer-${index}`;
  return { id, aabb, placement: value.placement, valid: value.valid, rejected: value.rejected };
}

/**
 * Pure per-candidate Front Overhang rear-retention evaluation. Callers pass only
 * placements that have already survived their ordinary hard validity rules.
 */
export function evaluateFrontOverhangRearRetention(
  candidateAabb,
  acceptedPlacements,
  truck,
  zonesOverride = null
) {
  const geometry = getFrontOverhangRetentionGeometry(truck, zonesOverride);
  if (!geometry || !aabbContainedInZone(candidateAabb, geometry.deckZone)) {
    return {
      required: false,
      retained: true,
      coveredWidth: 0,
      candidateWidth: Math.max(0, Number(candidateAabb?.max?.z) - Number(candidateAabb?.min?.z)),
      coverageFraction: 1,
      retainerIds: [],
      geometry,
    };
  }

  const candidateMinZ = candidateAabb.min.z;
  const candidateMaxZ = candidateAabb.max.z;
  const candidateWidth = Math.max(0, candidateMaxZ - candidateMinZ);
  const intervals = [];
  (acceptedPlacements || []).forEach((value, index) => {
    const entry = retentionPlacementEntry(value, index);
    if (!entry || entry.placement === 'staged' || entry.valid === false || entry.rejected === true) return;
    const aabb = entry.aabb;
    if (!aabbContainedInZone(aabb, geometry.mainZone)) return;
    const stepGap = geometry.stepX - aabb.max.x;
    if (stepGap < -CONTAINMENT_EPS_INCHES ||
        stepGap > REAR_RETENTION_MAX_STEP_GAP_INCHES + 1e-9) return;
    if (aabb.min.y > geometry.deckY + CONTAINMENT_EPS_INCHES ||
        aabb.max.y < geometry.deckY - CONTAINMENT_EPS_INCHES) return;
    const minZ = Math.max(candidateMinZ, aabb.min.z);
    const maxZ = Math.min(candidateMaxZ, aabb.max.z);
    if (maxZ - minZ <= CONTAINMENT_EPS_INCHES) return;
    intervals.push({ minZ, maxZ, id: entry.id });
  });

  intervals.sort((a, b) => a.minZ - b.minZ || a.maxZ - b.maxZ || String(a.id).localeCompare(String(b.id)));
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (!last || interval.minZ > last.maxZ) {
      merged.push({ minZ: interval.minZ, maxZ: interval.maxZ, ids: new Set([interval.id]) });
      continue;
    }
    last.maxZ = Math.max(last.maxZ, interval.maxZ);
    last.ids.add(interval.id);
  }
  const coveredWidth = merged.reduce((sum, interval) => sum + Math.max(0, interval.maxZ - interval.minZ), 0);
  const requiredWidth = candidateWidth * MIN_REAR_RETENTION_WIDTH_FRACTION;
  const retained = candidateWidth > 0 && coveredWidth + CONTAINMENT_EPS_INCHES >= requiredWidth;
  return {
    required: true,
    retained,
    coveredWidth,
    candidateWidth,
    coverageFraction: candidateWidth > 0 ? Math.min(1, coveredWidth / candidateWidth) : 0,
    retainerIds: retained
      ? [...new Set(merged.flatMap(interval => [...interval.ids]))].sort((a, b) => String(a).localeCompare(String(b)))
      : [],
    geometry,
  };
}

/**
 * Inch-space containment contract: all AABBs and usable zones passed here use
 * inches, and all active trailer-containment callers share the same physical
 * tolerance through CONTAINMENT_EPS_INCHES (single source: packing-core).
 */
const isAabbContainedInAnyZone = validationAabbContainedInAnyZone;

export function createOrientationLockPatch(rotation = {}, dimensions = {}) {
  const lockedRotation = normalizeRightAngleRotation(rotation);
  return {
    orientationLocked: true,
    lockedRotation,
    orientedDims: getOrientedDimsForRotation(dimensions, lockedRotation),
  };
}

export function clearOrientationLockPatch() {
  return {
    orientationLocked: false,
    lockedRotation: null,
    orientedDims: null,
  };
}

/**
 * Returns true if the given rotation is permitted by the case's orientation policy.
 * Mirrors the orientation gates AutoPack uses in buildOrientationCandidates() without
 * importing the solver.
 *
 * - 'upright'        : only Y-axis rotation allowed (rx === 0 and rz === 0 after normalization)
 * - 'onside'/'on-side': only non-upright rotations allowed
 * - 'any' or missing : all rotations allowed (no restriction)
 */
export function isOrientationAllowedByCasePolicy(caseData = {}, rotation = {}) {
  const locked = normalizeRightAngleRotation(rotation);
  const rx = normalizeRightAngle(locked.x);
  const rz = normalizeRightAngle(locked.z);
  const isUpright = rx === 0 && rz === 0;
  const lock = canonicalOrientationLock(caseData.orientationLock);
  if (lock === 'upright') return isUpright;
  if (lock === 'onSide') return !isUpright;
  return true;
}

function isFinitePositive(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function finiteOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeTransformPosition(position) {
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function normalizeTransformRotation(rotation) {
  const src = rotation && typeof rotation === 'object' ? rotation : {};
  return {
    x: finiteOr(src.x, 0),
    y: finiteOr(src.y, 0),
    z: finiteOr(src.z, 0),
  };
}

function normalizeTransformScale(scale) {
  const src = scale && typeof scale === 'object' ? scale : {};
  return {
    x: isFinitePositive(src.x) ? Number(src.x) : 1,
    y: isFinitePositive(src.y) ? Number(src.y) : 1,
    z: isFinitePositive(src.z) ? Number(src.z) : 1,
  };
}

function normalizeDims(dims, fallback = { length: 24, width: 24, height: 24 }) {
  const src = dims && typeof dims === 'object' ? dims : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    length: isFinitePositive(src.length) ? Number(src.length) : finiteOr(fb.length, 24),
    width: isFinitePositive(src.width) ? Number(src.width) : finiteOr(fb.width, 24),
    height: isFinitePositive(src.height) ? Number(src.height) : finiteOr(fb.height, 24),
  };
}

function getInstanceEffectiveDims(inst, caseData) {
  const baseDims = normalizeDims(caseData && caseData.dimensions);
  const orientedDims = inst && inst.orientedDims;
  if (
    orientedDims &&
    isFinitePositive(orientedDims.length) &&
    isFinitePositive(orientedDims.width) &&
    isFinitePositive(orientedDims.height)
  ) {
    return normalizeDims(orientedDims, baseDims);
  }
  return baseDims;
}

function hasPositiveFiniteDims(dims) {
  return Boolean(
    dims &&
    isFinitePositive(dims.length) &&
    isFinitePositive(dims.width) &&
    isFinitePositive(dims.height)
  );
}

function rotationsEqual(a, b, tolerance = 1e-6) {
  const ar = normalizeRightAngleRotation(a || {});
  const br = normalizeRightAngleRotation(b || {});
  return Math.abs(ar.x - br.x) <= tolerance &&
    Math.abs(ar.y - br.y) <= tolerance &&
    Math.abs(ar.z - br.z) <= tolerance;
}

function dimensionsEqual(a, b, tolerance = 1e-6) {
  return hasPositiveFiniteDims(a) && hasPositiveFiniteDims(b) &&
    Math.abs(Number(a.length) - Number(b.length)) <= tolerance &&
    Math.abs(Number(a.width) - Number(b.width)) <= tolerance &&
    Math.abs(Number(a.height) - Number(b.height)) <= tolerance;
}

/**
 * Resolve an instance's physical dimensions without inventing fallback geometry.
 * Rotation is the source of truth; stored orientedDims are accepted only when they
 * agree with the shared THREE-compatible right-angle helper.
 */
export function getCanonicalInstanceEffectiveDims(inst, caseData) {
  const base = caseData && caseData.dimensions;
  if (!hasPositiveFiniteDims(base)) {
    return { ok: false, reason: 'missing or malformed case dimensions' };
  }

  const transformRotation = normalizeRightAngleRotation(
    inst && inst.transform && inst.transform.rotation ? inst.transform.rotation : {}
  );
  const lockedRotation = inst && inst.orientationLocked === true
    ? normalizeRightAngleRotation(inst.lockedRotation || {})
    : null;
  const lockConsistent = inst && inst.orientationLocked === true
    ? Boolean(inst.lockedRotation) && rotationsEqual(transformRotation, lockedRotation)
    : true;
  const rotation = transformRotation;
  const dims = getOrientedDimsForRotation(base, rotation);
  if (!hasPositiveFiniteDims(dims)) {
    return { ok: false, reason: 'rotation produced invalid dimensions' };
  }

  const stored = inst && inst.orientedDims;
  const storedValid = hasPositiveFiniteDims(stored);
  const storedConsistent = storedValid && dimensionsEqual(stored, dims);
  const orientationAllowed = isOrientationAllowedByCasePolicy(caseData, rotation);

  return {
    ok: true,
    dims: { length: dims.length, width: dims.width, height: dims.height },
    rotation,
    orientationAllowed,
    lockConsistent,
    storedConsistent,
  };
}

function applyCanonicalInstancePose(inst, canonical) {
  const next = Utils.deepClone(inst);
  next.transform = next.transform && typeof next.transform === 'object' ? next.transform : {};
  next.transform.rotation = { ...canonical.rotation };
  next.orientedDims = { ...canonical.dims };
  return next;
}

function makeAabb(position, dims) {
  return {
    min: {
      x: position.x - dims.length / 2,
      y: position.y - dims.height / 2,
      z: position.z - dims.width / 2,
    },
    max: {
      x: position.x + dims.length / 2,
      y: position.y + dims.height / 2,
      z: position.z + dims.width / 2,
    },
  };
}

const aabbsOverlap = validationAabbsOverlap;

export function aabbIntersectsWheelWellBlockedBody(aabb, truck) {
  if (!aabb) return false;
  return getWheelWellsBlockedZones(truck).some(blocked => aabbsOverlap(aabb, blocked));
}

export function aabbIntersectsFrontBonusBlockedBody(aabb, truck) {
  if (!aabb) return false;
  return getFrontBonusBlockedZones(truck).some(blocked => aabbsOverlap(aabb, blocked));
}

function overlapsAny(aabb, acceptedAabbs) {
  return (acceptedAabbs || []).some(other => aabbsOverlap(aabb, other));
}

function getSafeImportedPlacement(pack, inst, caseData, acceptedAabbs) {
  const position = normalizeTransformPosition(inst && inst.transform && inst.transform.position);
  if (!position) return null;
  const dims = getInstanceEffectiveDims(inst, caseData);
  const aabb = makeAabb(position, dims);
  const zones = getTrailerUsableZones(pack && pack.truck);
  if (aabbIntersectsWheelWellBlockedBody(aabb, pack && pack.truck) ||
      aabbIntersectsFrontBonusBlockedBody(aabb, pack && pack.truck)) return null;
  if (!isAabbContainedInAnyZone(aabb, zones)) return null;
  if (overlapsAny(aabb, acceptedAabbs)) return null;
  return { position, dims, aabb };
}

/**
 * Canonical staging-zone layout shared by every "place outside the trailer"
 * path (Add Case default placement, AutoPack overflow/unpacked items, Unpack
 * All, and Duplicate-to-staging). Defines a single gap and origin so staged
 * items always land in one consistent strip beside the trailer instead of
 * each caller drifting with its own offset formula.
 *
 * originX: 0 matches the rear / loading-door end of TRUCK_DIRECTION_MODEL
 * (x=0); the staging row runs alongside the trailer from the rear toward
 * the front (x=truck.length).
 */
export function getStagingLayout(truck, options = {}) {
  const t = truck && typeof truck === 'object' ? truck : {};
  const truckL = Math.max(Number(t.length) || 120, 1);
  const truckW = Math.max(Number(t.width) || 96, 1);
  const gap = Number(options.gap) > 0 ? Number(options.gap) : 12;
  const defaultOriginZ = truckW / 2 + gap;
  const originZ = Number.isFinite(Number(options.originZ)) ? Number(options.originZ) : defaultOriginZ;
  return {
    gap,
    truckL,
    truckW,
    originX: 0,
    originZ,
  };
}

export function findSafeStagingPosition(pack, dims, acceptedAabbs, options = {}) {
  const truck = pack && pack.truck ? pack.truck : {};
  const layout = getStagingLayout(truck, options);
  const truckL = Math.max(layout.truckL, dims.length);
  const gap = layout.gap;
  const stepX = Math.max(1, dims.length + gap);
  const stepZ = Math.max(1, dims.width + gap);
  const minX = layout.originX + dims.length / 2;
  const maxX = Math.max(minX, truckL - dims.length / 2);
  const availableX = Math.max(0, maxX - minX);
  const cols = Math.max(1, Math.floor(availableX / stepX) + 1);
  const startZ = layout.originZ + dims.width / 2;
  const accepted = Array.isArray(acceptedAabbs) ? acceptedAabbs : [];
  const maxRows = Math.max(200, Math.ceil((accepted.length + 1) / cols) + 20);

  for (let row = 0; row < maxRows; row++) {
    for (let col = 0; col < cols; col++) {
      const position = {
        x: Math.min(minX + col * stepX, maxX),
        y: dims.height / 2,
        z: startZ + row * stepZ,
      };
      const aabb = makeAabb(position, dims);
      if (!overlapsAny(aabb, accepted)) return { position, aabb };
    }
  }

  let overflowZ = startZ;
  for (const aabb of accepted) {
    if (Number.isFinite(Number(aabb && aabb.max && aabb.max.z))) {
      overflowZ = Math.max(overflowZ, Number(aabb.max.z) + gap + dims.width / 2);
    }
  }
  const fallback = { x: minX, y: dims.height / 2, z: overflowZ };
  for (let attempt = 0; attempt < 1000; attempt++) {
    const position = { ...fallback, z: overflowZ + attempt * stepZ };
    const aabb = makeAabb(position, dims);
    if (!overlapsAny(aabb, accepted)) return { position, aabb };
  }
  return { position: fallback, aabb: makeAabb(fallback, dims) };
}

function getDuplicateSourcePosition(inst, dims) {
  return normalizeTransformPosition(inst && inst.transform && inst.transform.position) || {
    x: 0,
    y: Math.max(1, dims.height / 2),
    z: 0,
  };
}

function buildDuplicateSourcePayload(sourceInstances, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  return (Array.isArray(sourceInstances) ? sourceInstances : [])
    .map(inst => {
      if (!inst || !inst.caseId) return null;
      const caseData = caseMap.get(inst.caseId);
      if (!caseData) return null;
      const dims = getInstanceEffectiveDims(inst, caseData);
      if (!hasPositiveFiniteDims(dims)) return null;
      return {
        inst,
        caseData,
        dims,
        position: getDuplicateSourcePosition(inst, dims),
      };
    })
    .filter(Boolean);
}

function buildDuplicatePayloadBounds(payload) {
  const initial = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  return payload.reduce((bounds, item) => {
    const aabb = makeAabb(item.position, item.dims);
    bounds.min.x = Math.min(bounds.min.x, aabb.min.x);
    bounds.min.y = Math.min(bounds.min.y, aabb.min.y);
    bounds.min.z = Math.min(bounds.min.z, aabb.min.z);
    bounds.max.x = Math.max(bounds.max.x, aabb.max.x);
    bounds.max.y = Math.max(bounds.max.y, aabb.max.y);
    bounds.max.z = Math.max(bounds.max.z, aabb.max.z);
    return bounds;
  }, initial);
}

function buildDuplicateExistingAabbs(pack, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  return (pack && Array.isArray(pack.cases) ? pack.cases : [])
    .filter(inst => inst && inst.hidden !== true)
    .map(inst => {
      const caseData = caseMap.get(inst.caseId);
      if (!caseData) return null;
      const dims = getInstanceEffectiveDims(inst, caseData);
      if (!hasPositiveFiniteDims(dims)) return null;
      return makeAabb(getDuplicateSourcePosition(inst, dims), dims);
    })
    .filter(Boolean);
}

function duplicateAabbIsInsideTruckGeometry(pack, aabb) {
  if (!aabb ||
      aabbIntersectsWheelWellBlockedBody(aabb, pack && pack.truck) ||
      aabbIntersectsFrontBonusBlockedBody(aabb, pack && pack.truck)) return false;
  const zones = getTrailerUsableZones(pack && pack.truck);
  return isAabbInsideTruckGeometry(aabb, zones, getWheelWellGeometry(pack && pack.truck));
}

function buildDuplicateExistingEntries(pack, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  return (pack && Array.isArray(pack.cases) ? pack.cases : [])
    .filter(inst => inst && inst.hidden !== true)
    .map(inst => {
      const caseData = caseMap.get(inst.caseId);
      if (!caseData) return null;
      const dims = getInstanceEffectiveDims(inst, caseData);
      if (!hasPositiveFiniteDims(dims)) return null;
      const position = getDuplicateSourcePosition(inst, dims);
      return {
        id: inst.id,
        inst,
        caseData,
        dims,
        position,
        aabb: makeAabb(position, dims),
      };
    })
    .filter(Boolean);
}

function buildDuplicateAcceptedSupportEntries(pack, caseLibrary) {
  const zones = getTrailerUsableZones(pack && pack.truck);
  const wheelWell = getWheelWellGeometry(pack && pack.truck);
  const accepted = [];
  const entries = buildDuplicateExistingEntries(pack, caseLibrary)
    .filter(entry => entry.inst.placement !== 'staged' && duplicateAabbIsInsideTruckGeometry(pack, entry.aabb))
    .sort((a, b) =>
      a.aabb.min.y - b.aabb.min.y ||
      a.aabb.min.x - b.aabb.min.x ||
      a.aabb.min.z - b.aabb.min.z ||
      String(a.id).localeCompare(String(b.id))
    );

  for (const entry of entries) {
    const candidate = { id: entry.id, caseData: entry.caseData };
    if (!aabbIsFullyValid(candidate, entry.aabb, accepted, zones, pack && pack.truck, RECON_TOL, wheelWell)) {
      continue;
    }
    accepted.push({ id: entry.id, aabb: entry.aabb, caseData: entry.caseData });
  }

  return { accepted, zones, wheelWell };
}

function duplicatePackedGroupIsFullyValid(pack, records, caseLibrary) {
  const { accepted, zones, wheelWell } = buildDuplicateAcceptedSupportEntries(pack, caseLibrary);
  const ordered = [...records].sort((a, b) =>
    a.aabb.min.y - b.aabb.min.y ||
    a.aabb.min.x - b.aabb.min.x ||
    a.aabb.min.z - b.aabb.min.z ||
    String(a.inst?.id || '').localeCompare(String(b.inst?.id || ''))
  );

  for (const record of ordered) {
    const candidate = { id: record.inst?.id, caseData: record.caseData };
    if (!aabbIsFullyValid(candidate, record.aabb, accepted, zones, pack && pack.truck, RECON_TOL, wheelWell)) {
      return false;
    }
    accepted.push({ id: record.inst?.id, aabb: record.aabb, caseData: record.caseData });
  }

  return true;
}

function duplicateOffsetIsSafe(pack, payload, existingAabbs, offset, requirePacked, caseLibrary) {
  const candidateAabbs = [];
  const records = [];
  for (const item of payload) {
    const position = {
      x: item.position.x + offset.x,
      y: item.position.y + offset.y,
      z: item.position.z + offset.z,
    };
    const aabb = makeAabb(position, item.dims);
    if (overlapsAny(aabb, existingAabbs)) return false;
    if (overlapsAny(aabb, candidateAabbs)) return false;
    candidateAabbs.push(aabb);
    records.push({ ...item, position, aabb });
  }
  if (requirePacked && !duplicatePackedGroupIsFullyValid(pack, records, caseLibrary)) return false;
  return true;
}

function findDuplicateOffset(pack, payload, existingAabbs, caseLibrary) {
  if (!payload.length) return null;
  const bounds = buildDuplicatePayloadBounds(payload);
  const spanX = Math.max(1, bounds.max.x - bounds.min.x);
  const spanZ = Math.max(1, bounds.max.z - bounds.min.z);
  const sourceInsideTruck = payload.every(item =>
    duplicateAabbIsInsideTruckGeometry(pack, makeAabb(item.position, item.dims))
  );
  const insideOffsets = [
    { x: spanX, y: 0, z: 0 },
    { x: -spanX, y: 0, z: 0 },
    { x: 0, y: 0, z: spanZ },
    { x: 0, y: 0, z: -spanZ },
    { x: spanX, y: 0, z: spanZ },
    { x: spanX, y: 0, z: -spanZ },
    { x: -spanX, y: 0, z: spanZ },
    { x: -spanX, y: 0, z: -spanZ },
  ];
  if (sourceInsideTruck) {
    const packedOffset = insideOffsets.find(offset =>
      duplicateOffsetIsSafe(pack, payload, existingAabbs, offset, true, caseLibrary)
    );
    if (packedOffset) return { offset: packedOffset, staged: false };
  }

  const groupDims = {
    length: spanX,
    width: spanZ,
    height: Math.max(1, bounds.max.y - bounds.min.y),
  };
  const staged = findSafeStagingPosition(pack, groupDims, existingAabbs);
  const groupCenter = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const stagedOffset = {
    x: staged.position.x - groupCenter.x,
    y: staged.position.y - groupCenter.y,
    z: staged.position.z - groupCenter.z,
  };
  if (duplicateOffsetIsSafe(pack, payload, existingAabbs, stagedOffset, false, caseLibrary)) {
    return { offset: stagedOffset, staged: true };
  }
  return null;
}

export function buildSafeDuplicateInstances(pack, sourceInstances, caseLibrary = CaseLibrary.getCases()) {
  if (!pack) return { cases: [], newInstances: [], newIds: [], placement: null, offset: null };
  const payload = buildDuplicateSourcePayload(sourceInstances, caseLibrary);
  if (!payload.length) {
    return {
      cases: Array.isArray(pack.cases) ? pack.cases : [],
      newInstances: [],
      newIds: [],
      placement: null,
      offset: null,
    };
  }

  const placement = findDuplicateOffset(pack, payload, buildDuplicateExistingAabbs(pack, caseLibrary), caseLibrary);
  if (!placement) {
    return {
      cases: Array.isArray(pack.cases) ? pack.cases : [],
      newInstances: [],
      newIds: [],
      placement: null,
      offset: null,
    };
  }

  const placementState = placement.staged ? 'staged' : 'packed';
  const newInstances = payload.map(item => {
    const next = Utils.deepClone(item.inst);
    next.id = Utils.uuid();
    next.transform = {
      ...Utils.deepClone(item.inst.transform || {}),
      position: {
        x: item.position.x + placement.offset.x,
        y: item.position.y + placement.offset.y,
        z: item.position.z + placement.offset.z,
      },
      rotation: normalizeTransformRotation(item.inst.transform && item.inst.transform.rotation),
      scale: normalizeTransformScale(item.inst.transform && item.inst.transform.scale),
    };
    next.hidden = false;
    next.placement = placementState;
    return next;
  });

  return {
    cases: [...(Array.isArray(pack.cases) ? pack.cases : []), ...newInstances],
    newInstances,
    newIds: newInstances.map(inst => inst.id),
    placement: placementState,
    offset: placement.offset,
  };
}

export function duplicateInstancesSafely(packId, sourceInstances, caseLibrary = CaseLibrary.getCases()) {
  const pack = getById(packId);
  if (!pack) return null;
  const result = buildSafeDuplicateInstances(pack, sourceInstances, caseLibrary);
  if (!result.newIds.length) return null;
  const updated = update(packId, { cases: result.cases });
  return { ...result, pack: updated || { ...pack, cases: result.cases } };
}

/**
 * Canonical staging-row bounds derived from the same S1 staging layout used
 * by findSafeStagingPosition: a tight envelope around the neat row/column
 * grid where AutoPack overflow, Unpack All, Add Case, and Duplicate fallback
 * place items beside the trailer. This is intentionally small — it is not
 * the manual work area (see getStagingWorkAreaBounds).
 */
export function getStagingBounds(truck, options = {}) {
  const layout = getStagingLayout(truck, options);
  const margin = Number(options.margin) > 0 ? Number(options.margin) : layout.gap;
  const depth = Number(options.depth) > 0 ? Number(options.depth) : Math.max(layout.truckL, layout.truckW * 2);
  return {
    min: { x: layout.originX - margin, y: 0, z: layout.originZ - margin },
    max: { x: layout.truckL + margin, y: Infinity, z: layout.originZ + depth },
  };
}

/**
 * Large manual "work floor" bounds around the trailer/container. Unlike
 * getStagingBounds (the tight canonical staging-row envelope), this spans
 * both sides of the trailer in Z and a generous margin before/after it in X,
 * so users can drag staged items several feet away to organize, group, and
 * inspect them from any camera angle. Scales with truck size instead of a
 * fixed constant.
 */
export function getStagingWorkAreaBounds(truck, options = {}) {
  const t = truck && typeof truck === 'object' ? truck : {};
  const truckL = Math.max(Number(t.length) || 120, 1);
  const truckW = Math.max(Number(t.width) || 96, 1);
  const marginX = Number(options.marginX) > 0 ? Number(options.marginX) : Math.max(120, truckL * 0.25);
  const marginZ = Number(options.marginZ) > 0 ? Number(options.marginZ) : Math.max(180, truckW * 3);
  return {
    min: { x: -marginX, y: 0, z: -(truckW / 2 + marginZ) },
    max: { x: truckL + marginX, y: Infinity, z: truckW / 2 + marginZ },
  };
}

/**
 * Whether an inch-based AABB is inside the large manual staging work area
 * for this pack's truck. Used to validate manual drag/rotate/flip of staged
 * items so they can be organized away from the trailer without drifting off
 * the visible work floor.
 */
export function isAabbInStagingZone(pack, aabb, options = {}) {
  const bounds = getStagingWorkAreaBounds(pack && pack.truck, options);
  const EPS = 0.05;
  return (
    aabb.min.x >= bounds.min.x - EPS &&
    aabb.max.x <= bounds.max.x + EPS &&
    aabb.min.y >= bounds.min.y - EPS &&
    aabb.max.y <= bounds.max.y + EPS &&
    aabb.min.z >= bounds.min.z - EPS &&
    aabb.max.z <= bounds.max.z + EPS
  );
}

/**
 * Derive the "packed" | "staged" placement state for an instance from its
 * final AABB: inside the trailer's usable zones is "packed", anything
 * outside (including the staging zone) is "staged".
 */
function getPlacementForAabb(pack, aabb) {
  if (aabbIntersectsWheelWellBlockedBody(aabb, pack && pack.truck) ||
      aabbIntersectsFrontBonusBlockedBody(aabb, pack && pack.truck)) return 'staged';
  const zones = getTrailerUsableZones(pack && pack.truck);
  return isAabbInsideTruckGeometry(aabb, zones, getWheelWellGeometry(pack && pack.truck))
    ? 'packed'
    : 'staged';
}

function buildAcceptedAabbs(pack, instances, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  const acceptedAabbs = [];
  (instances || []).forEach(inst => {
    const caseData = caseMap.get(inst && inst.caseId);
    const position = normalizeTransformPosition(inst && inst.transform && inst.transform.position);
    if (!position) return;
    const dims = getInstanceEffectiveDims(inst, caseData);
    acceptedAabbs.push(makeAabb(position, dims));
  });
  return acceptedAabbs;
}

function repairPackInstancePlacements(pack, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  const acceptedAabbs = [];
  const nextCases = (pack.cases || []).map(inst => {
    const next = Utils.deepClone(inst);
    const caseData = caseMap.get(next.caseId);
    const dims = getInstanceEffectiveDims(next, caseData);
    next.transform = next.transform && typeof next.transform === 'object' ? next.transform : {};
    next.transform.rotation = normalizeTransformRotation(next.transform.rotation);
    next.transform.scale = normalizeTransformScale(next.transform.scale);

    const safeImported = getSafeImportedPlacement(pack, next, caseData, acceptedAabbs);
    if (safeImported) {
      next.transform.position = safeImported.position;
      next.placement = 'packed';
      acceptedAabbs.push(safeImported.aabb);
      return next;
    }

    const staged = findSafeStagingPosition(pack, dims, acceptedAabbs);
    next.transform.position = staged.position;
    next.placement = 'staged';
    acceptedAabbs.push(staged.aabb);
    return next;
  });

  return repairRestoredPackPlacements({ ...pack, cases: nextCases }, caseLibrary);
}

// ============================================================================
// SECTION: SHARED PLACEMENT VALIDATION CONSTANTS AND HELPERS
// PLACEMENT_EPS, MIN_SUPPORT_FRACTION, and computeSupportFraction are re-exported
// from packing-core/validation.js (the single validation authority) so
// editor-screen.js and every placement validator share one epsilon,
// support-fraction threshold, and coverage computation.
// ============================================================================

export const computeSupportFraction = validationComputeSupportFraction;

// ============================================================================
// SECTION: TRUCK GEOMETRY CHANGE RECONCILIATION
// When the truck preset/mode/dimensions/wheel-wells/overhang change, every placed
// instance must be revalidated against the NEW geometry. Valid placements are kept
// EXACTLY; an invalid one may be corrected only by a safe vertical snap to a valid
// floor/deck/support (unchanged X/Z, no collision, valid support); the rest are
// reported as "invalid" for the user to repack, stage, or cancel. Stacks are
// validated bottom-up as dependency groups so a support is never moved while its
// children are left floating — children inherit their support's vertical delta.
// ============================================================================

const RECON_TOL = 0.05; // matches CONTAINMENT_EPS_INCHES

function reconXzOverlapArea(a, b) {
  const ox = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const oz = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
  return ox * oz;
}

function aabbRestsOnZoneFloor(aabb, zones, tol = RECON_TOL) {
  return (zones || []).some(z =>
    Math.abs(aabb.min.y - z.min.y) <= tol &&
    aabb.min.x >= z.min.x - tol && aabb.max.x <= z.max.x + tol &&
    aabb.min.z >= z.min.z - tol && aabb.max.z <= z.max.z + tol &&
    aabb.max.y <= z.max.y + tol
  );
}

function directChildCount(support, accepted, tol = RECON_TOL) {
  return (accepted || []).filter(child =>
    child !== support &&
    Math.abs(child.aabb.min.y - support.aabb.max.y) <= tol &&
    reconXzOverlapArea(child.aabb, support.aabb) > 0.05
  ).length;
}

function supportCanCarry(candidate, support, accepted) {
  const rules = support.caseData || {};
  if (!rulesAllowStackOnTop(rules)) return false;
  // Manual pipeline floors the cap at its boundary (canonicalization already
  // floors stored values; this keeps legacy data behavior unchanged).
  const limit = Math.max(0, Math.floor(rulesMaxStackCount(rules)));
  if (limit && directChildCount(support, accepted) >= limit) return false;
  return weightAllowsSupport(
    Math.max(0, Number(candidate.caseData && candidate.caseData.weight) || 0),
    Math.max(0, Number(rules.weight) || 0),
    rules.isPallet === true
  );
}

function aabbIsSupported(candidate, aabb, accepted, zones, tol = RECON_TOL) {
  if (aabbRestsOnZoneFloor(aabb, zones, tol)) return true;
  const supporters = (accepted || []).filter(support =>
    Math.abs(aabb.min.y - support.aabb.max.y) <= tol &&
    reconXzOverlapArea(aabb, support.aabb) > 0.05
  );
  if (!supporters.length) return false;
  if (supporters.some(support => !supportCanCarry(candidate, support, accepted))) return false;
  return computeSupportFraction(aabb, supporters.map(support => support.aabb), tol) >= MIN_SUPPORT_FRACTION;
}

/**
 * Containment for manual/reconciliation checks: inside the usable zones, OR —
 * for wheelWells trucks — inside the exact truck-minus-blocked union. The union
 * form accepts solver-legal poses that span zone seams (resting on or bridging
 * the rigid well tops) which single-zone containment can never express.
 */
function isAabbInsideTruckGeometry(aabb, zones, wheelWell) {
  if (isAabbContainedInAnyZone(aabb, zones)) return true;
  return Boolean(wheelWell) && isAabbWithinTruckMinusBlocked(aabb, wheelWell);
}

function aabbIsFullyValid(candidate, aabb, accepted, zones, truck, tol = RECON_TOL, wheelWell = null) {
  const physicallySupported = wheelWell
    ? isWheelWellSupportedAndStable(
      aabb,
      accepted,
      wheelWell,
      { weight: Number(candidate?.caseData?.weight) || 0 }
    )
    : aabbIsSupported(candidate, aabb, accepted, zones, tol);
  return isAabbInsideTruckGeometry(aabb, zones, wheelWell) &&
    !aabbIntersectsWheelWellBlockedBody(aabb, truck) &&
    !aabbIntersectsFrontBonusBlockedBody(aabb, truck) &&
    !overlapsAny(aabb, (accepted || []).map(entry => entry.aabb)) &&
    physicallySupported &&
    evaluateFrontOverhangRearRetention(aabb, accepted, truck, zones).retained;
}

// Candidate floor/deck/support bottom-Y levels under a footprint at its current
// X/Z, lowest first (so a safe snap chooses the lowest valid resting surface).
// Rigid wheel-well tops count as candidate resting levels too; the full
// validity check decides whether the combined support/stability rules pass.
function candidateSnapBottoms(curAabb, accepted, zones, tol = RECON_TOL, wheelWell = null) {
  const footprintArea = Math.max(1e-9, (curAabb.max.x - curAabb.min.x) * (curAabb.max.z - curAabb.min.z));
  const bottoms = [];
  for (const z of zones || []) {
    if (curAabb.min.x >= z.min.x - tol && curAabb.max.x <= z.max.x + tol &&
        curAabb.min.z >= z.min.z - tol && curAabb.max.z <= z.max.z + tol) {
      bottoms.push(z.min.y);
    }
  }
  for (const support of accepted || []) {
    if (reconXzOverlapArea(curAabb, support.aabb) >= 0.5 * footprintArea) {
      bottoms.push(support.aabb.max.y);
    }
  }
  for (const top of wheelWell ? wheelWell.tops : []) {
    if (reconXzOverlapArea(curAabb, top) > 0.05) bottoms.push(top.max.y);
  }
  return [...new Set(bottoms.map(b => Math.round(b * 1e6) / 1e6))].sort((a, b) => a - b);
}

// Toast-ready reasons for manual vertical placement outcomes, keyed by code.
const MANUAL_VERTICAL_REASONS = {
  'invalid-selection': 'Select one placed case to move vertically.',
  'staged-case': 'Staged cases cannot be moved vertically. Place the case in the truck first.',
  'already-resting': 'This case is already resting on the nearest valid surface.',
  'no-level-above': 'No valid support level above this case at its current spot.',
  'no-level-below': 'No valid support level below this case at its current spot.',
  'blocked-collision': 'Another case or a blocked zone is in the way.',
  'no-clearance-above': 'Not enough clearance above for this case.',
  'support-rules': 'The surface there cannot support this case (stacking or weight rules).',
  'needs-rear-retention': 'The raised deck needs rear retention at the step before this case can rest there.',
  'outside-truck': 'The requested position is outside the truck.',
};

function manualVerticalFailure(code) {
  return { ok: false, code, reason: MANUAL_VERTICAL_REASONS[code] || 'Cannot move this case vertically.' };
}

// Explain why the nearest rejected level failed, mirroring aabbIsFullyValid's
// factor order so the toast names the first hard rule that actually blocked it.
function explainInvalidLevel(node, aabb, accepted, zones, truck, wheelWell, mode) {
  if (!isAabbInsideTruckGeometry(aabb, zones, wheelWell)) {
    return manualVerticalFailure(mode === 'up' ? 'no-clearance-above' : 'blocked-collision');
  }
  if (aabbIntersectsWheelWellBlockedBody(aabb, truck) ||
      aabbIntersectsFrontBonusBlockedBody(aabb, truck) ||
      overlapsAny(aabb, (accepted || []).map(entry => entry.aabb))) {
    return manualVerticalFailure('blocked-collision');
  }
  const physicallySupported = wheelWell
    ? isWheelWellSupportedAndStable(aabb, accepted, wheelWell, { weight: Number(node?.caseData?.weight) || 0 })
    : aabbIsSupported(node, aabb, accepted, zones, RECON_TOL);
  if (!physicallySupported) return manualVerticalFailure('support-rules');
  if (!evaluateFrontOverhangRearRetention(aabb, accepted, truck, zones).retained) {
    return manualVerticalFailure('needs-rear-retention');
  }
  return manualVerticalFailure('blocked-collision');
}

/**
 * Manual vertical placement resolver for ONE placed instance. Finds the next
 * valid support level above/below the case at its current X/Z ('up'/'down'),
 * the nearest valid resting surface below ('drop'), or validates/corrects a
 * requested position ('resolve', with options.desiredPosition). Every candidate
 * level flows through the same candidateSnapBottoms + aabbIsFullyValid pipeline
 * used by reconciliation, so a result can never fake support, penetrate blocked
 * wheel-well bodies, or bypass Front Overhang rear retention. Pure: reads the
 * given pack and never mutates state.
 */
export function findManualVerticalPlacement(pack, caseLibrary, instanceId, options = {}) {
  const mode = options && typeof options.mode === 'string' ? options.mode : '';
  if (!['up', 'down', 'drop', 'resolve'].includes(mode)) return manualVerticalFailure('invalid-selection');
  const source = pack && typeof pack === 'object' ? pack : {};
  const truck = source.truck && typeof source.truck === 'object' ? source.truck : {};
  const zones = getTrailerUsableZones(truck);
  const wheelWell = getWheelWellGeometry(truck);
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));

  let target = null;
  const accepted = [];
  for (const inst of (Array.isArray(source.cases) ? source.cases : [])) {
    if (!inst) continue;
    const isTarget = inst.id === instanceId;
    if (inst.placement === 'staged') {
      if (isTarget) return manualVerticalFailure('staged-case');
      continue; // staged cargo sits outside the truck and is never an obstacle
    }
    const caseData = caseMap.get(inst.caseId);
    const pos = normalizeTransformPosition(inst.transform && inst.transform.position);
    const canonical = caseData ? getCanonicalInstanceEffectiveDims(inst, caseData) : { ok: false };
    if (!caseData || !pos || !canonical.ok) {
      if (isTarget) return manualVerticalFailure('invalid-selection');
      continue; // unresolved/malformed neighbors cannot participate as obstacles
    }
    const node = {
      inst,
      caseData,
      canonical,
      dims: canonical.dims,
      curPos: pos,
      curAabb: makeAabb(pos, canonical.dims),
    };
    if (isTarget) target = node;
    else accepted.push({ ...node, aabb: node.curAabb, position: pos });
  }
  if (!target) return manualVerticalFailure('invalid-selection');
  if (!target.canonical.orientationAllowed || !target.canonical.lockConsistent) {
    return manualVerticalFailure('invalid-selection');
  }

  const dims = target.dims;
  let probe = target.curAabb;
  let referenceBottom = target.curAabb.min.y;
  let anchorX = target.curPos.x;
  let anchorZ = target.curPos.z;
  if (mode === 'resolve') {
    const desired = normalizeTransformPosition(options.desiredPosition);
    if (!desired) return manualVerticalFailure('invalid-selection');
    probe = makeAabb(desired, dims);
    referenceBottom = probe.min.y;
    anchorX = desired.x;
    anchorZ = desired.z;
    // Deliberate out-of-truck moves stay on the caller's legacy staging path.
    if (!(zones || []).some(z => reconXzOverlapArea(probe, z) > 0)) {
      return manualVerticalFailure('outside-truck');
    }
    if (aabbIsFullyValid(target, probe, accepted, zones, truck, RECON_TOL, wheelWell)) {
      return {
        ok: true,
        position: desired,
        fromBottom: target.curAabb.min.y,
        toBottom: probe.min.y,
        corrected: false,
      };
    }
  }

  const levels = candidateSnapBottoms(probe, accepted, zones, RECON_TOL, wheelWell);
  let candidates;
  if (mode === 'up') {
    candidates = levels.filter(b => b > referenceBottom + RECON_TOL);
  } else if (mode === 'down') {
    candidates = levels.filter(b => b < referenceBottom - RECON_TOL).reverse();
  } else if (mode === 'drop') {
    candidates = levels.filter(b => b <= referenceBottom + RECON_TOL).reverse();
  } else {
    candidates = [...levels].sort((a, b) =>
      Math.abs(a - referenceBottom) - Math.abs(b - referenceBottom) || a - b);
  }

  if (!candidates.length) {
    if (mode === 'up') return manualVerticalFailure('no-level-above');
    if (mode === 'down' || mode === 'drop') return manualVerticalFailure('no-level-below');
    return manualVerticalFailure('blocked-collision');
  }

  for (const bottom of candidates) {
    const sPos = { x: anchorX, y: bottom + dims.height / 2, z: anchorZ };
    const sAabb = makeAabb(sPos, dims);
    if (!aabbIsFullyValid(target, sAabb, accepted, zones, truck, RECON_TOL, wheelWell)) continue;
    if (mode === 'drop' && Math.abs(bottom - referenceBottom) <= RECON_TOL) {
      return manualVerticalFailure('already-resting');
    }
    return {
      ok: true,
      position: sPos,
      fromBottom: target.curAabb.min.y,
      toBottom: bottom,
      corrected: mode === 'resolve',
    };
  }

  // Nothing passed. Down keeps the honest "no legal level below" statement (the
  // current supporter blocks the column by construction); other modes explain
  // the nearest rejected level so the toast names the blocking hard rule.
  if (mode === 'down') return manualVerticalFailure('no-level-below');
  const nearest = candidates[0];
  const nearestAabb = makeAabb({ x: anchorX, y: nearest + dims.height / 2, z: anchorZ }, dims);
  return explainInvalidLevel(target, nearestAabb, accepted, zones, truck, wheelWell, mode);
}

/**
 * PURE: revalidate every placed instance of `pack` against `nextTruck`. Returns
 * { nextPack, kept, adjusted, invalid, summary, acceptedAabbs } with NO mutation.
 * - kept: ids whose current placement is fully valid (kept exactly).
 * - adjusted: [{ id, fromY, toY }] safely snapped vertically (X/Z unchanged).
 * - invalid: ids that cannot be kept or safely snapped (left at current position
 *   in the preview; the caller resolves them via repack/stage/cancel).
 */
export function reconcilePlacementsForTruck(pack, nextTruck, caseLibrary, options = {}) {
  const basePack = pack && typeof pack === 'object' ? pack : {};
  const preserveStagedPositions = options.preserveStagedPositions === true;
  const zones = getTrailerUsableZones(nextTruck);
  const wheelWell = getWheelWellGeometry(nextTruck);
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  const allInstances = Array.isArray(basePack.cases) ? basePack.cases : [];
  const indexById = new Map(allInstances.map((inst, i) => [inst, i]));
  const packedNodes = [];
  const stagedNodes = [];
  const unresolved = [];
  const malformed = [];

  for (const inst of allInstances) {
    const caseData = caseMap.get(inst && inst.caseId);
    const pos = normalizeTransformPosition(inst && inst.transform && inst.transform.position);
    if (!inst) continue;
    if (!caseData) {
      unresolved.push({ id: inst.id, caseId: inst.caseId, name: inst.name || inst.caseId || 'Unknown case' });
      continue;
    }
    if (!pos) {
      malformed.push({ id: inst.id, caseId: inst.caseId, reason: 'missing or malformed position' });
      continue;
    }
    const canonical = getCanonicalInstanceEffectiveDims(inst, caseData);
    if (!canonical.ok) {
      malformed.push({ id: inst.id, caseId: inst.caseId, reason: canonical.reason });
      continue;
    }
    const canonicalInst = applyCanonicalInstancePose(inst, canonical);
    const node = {
      inst,
      canonicalInst,
      caseData,
      canonical,
      dims: canonical.dims,
      curPos: pos,
      curAabb: makeAabb(pos, canonical.dims),
    };
    if (inst.placement === 'staged') stagedNodes.push(node);
    else packedNodes.push(node); // hidden packed cargo remains physical cargo
  }

  const order = [...packedNodes].sort((x, y) =>
    (x.curAabb.min.y - y.curAabb.min.y) || (indexById.get(x.inst) - indexById.get(y.inst))
  );

  const accepted = [];
  const resultByInst = new Map();
  const kept = []; const adjusted = []; const invalid = [];
  const invalidReasons = {};

  for (const node of order) {
    const { inst, dims, curPos, canonical } = node;
    if (!canonical.orientationAllowed || !canonical.lockConsistent) {
      invalid.push(inst.id);
      invalidReasons[inst.id] = canonical.orientationAllowed
        ? 'exact instance lock does not match the stored rotation'
        : 'orientation violates the case policy';
      resultByInst.set(inst, { status: 'invalid', position: curPos, node });
      continue;
    }

    const currentAabb = makeAabb(curPos, dims);
    if (aabbIsFullyValid(node, currentAabb, accepted, zones, nextTruck, RECON_TOL, wheelWell)) {
      const entry = { ...node, aabb: currentAabb, position: curPos };
      accepted.push(entry);
      kept.push(inst.id);
      resultByInst.set(inst, { status: 'kept', position: curPos, node });
      continue;
    }

    // 2) Safe vertical snap: same X/Z, lowest valid floor/deck/support level.
    let snapped = null;
    for (const bottom of candidateSnapBottoms(node.curAabb, accepted, zones, RECON_TOL, wheelWell)) {
      const sPos = { x: curPos.x, y: bottom + dims.height / 2, z: curPos.z };
      const sAabb = makeAabb(sPos, dims);
      if (aabbIsFullyValid(node, sAabb, accepted, zones, nextTruck, RECON_TOL, wheelWell)) {
        snapped = { pos: sPos, aabb: sAabb };
        break;
      }
    }
    if (snapped) {
      accepted.push({ ...node, aabb: snapped.aabb, position: snapped.pos });
      adjusted.push({ id: inst.id, fromY: curPos.y, toY: snapped.pos.y });
      resultByInst.set(inst, { status: 'adjusted', position: snapped.pos, node });
      continue;
    }

    // 3) Invalid — leave at current position; the user resolves it.
    invalid.push(inst.id);
    invalidReasons[inst.id] = 'not safely placeable in the proposed truck geometry';
    resultByInst.set(inst, { status: 'invalid', position: curPos, node });
  }

  // Existing staged cargo is outside the active load plan. Keep a safe staging
  // pose exactly; only repair it when it is floating, colliding, or inside the truck.
  const stagingAccepted = [];
  const stagedUnchanged = [];
  const stagedAdjusted = [];
  const packedAabbs = accepted.map(entry => entry.aabb);
  const stagedOrder = [...stagedNodes].sort((a, b) => indexById.get(a.inst) - indexById.get(b.inst));
  for (const node of stagedOrder) {
    const current = node.curAabb;
    const insideTruck = isAabbContainedInAnyZone(current, zones);
    const blockedBody = aabbIntersectsWheelWellBlockedBody(current, nextTruck) ||
      aabbIntersectsFrontBonusBlockedBody(current, nextTruck);
    const collidesStaged = overlapsAny(current, stagingAccepted);
    const collides = overlapsAny(current, [...packedAabbs, ...stagingAccepted]);
    const onFloor = Math.abs(current.min.y) <= RECON_TOL;
    const reachable = isAabbInStagingZone({ truck: nextTruck }, current);
    if (preserveStagedPositions && !insideTruck && !blockedBody && !collidesStaged) {
      const position = onFloor ? node.curPos : { ...node.curPos, y: node.dims.height / 2 };
      const aabb = onFloor ? current : makeAabb(position, node.dims);
      if (!overlapsAny(aabb, stagingAccepted)) {
        stagingAccepted.push(aabb);
        stagedUnchanged.push(node.inst.id);
        resultByInst.set(node.inst, { status: 'staged-unchanged', position, node });
        continue;
      }
    }
    if (!insideTruck && !blockedBody && !collides && onFloor && reachable) {
      stagingAccepted.push(current);
      stagedUnchanged.push(node.inst.id);
      resultByInst.set(node.inst, { status: 'staged-unchanged', position: node.curPos, node });
      continue;
    }
    const staged = findSafeStagingPosition(
      { truck: nextTruck },
      node.dims,
      [...packedAabbs, ...stagingAccepted]
    );
    stagingAccepted.push(staged.aabb);
    stagedAdjusted.push(node.inst.id);
    resultByInst.set(node.inst, { status: 'staged-adjusted', position: staged.position, node });
  }

  const nextCases = allInstances.map(inst => {
    const r = resultByInst.get(inst);
    if (!r) return inst; // unresolved/malformed are preserved and block confirmation
    const next = applyCanonicalInstancePose(inst, r.node.canonical);
    next.transform.position = r.position;
    next.placement = r.status.startsWith('staged') ? 'staged' : 'packed';
    return next;
  });

  return {
    nextPack: { ...basePack, truck: nextTruck, cases: nextCases },
    kept,
    adjusted,
    invalid,
    invalidReasons,
    stagedUnchanged,
    stagedAdjusted,
    unresolved,
    malformed,
    summary: {
      kept: kept.length,
      adjusted: adjusted.length,
      invalid: invalid.length,
      stagedUnchanged: stagedUnchanged.length,
      stagedAdjusted: stagedAdjusted.length,
      unresolved: unresolved.length,
      malformed: malformed.length,
    },
    acceptedPlacements: accepted,
    acceptedAabbs: accepted.map(entry => entry.aabb),
    stagingAabbs: stagingAccepted,
  };
}

export function stagePlacementIds(pack, ids, nextTruck, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  const targetSet = new Set(ids || []);
  const cases = (pack && pack.cases) || [];
  const accepted = [];
  for (const inst of cases) {
    if (!inst || targetSet.has(inst.id)) continue;
    const canonical = getCanonicalInstanceEffectiveDims(inst, caseMap.get(inst.caseId));
    const pos = normalizeTransformPosition(inst.transform && inst.transform.position);
    if (canonical.ok && pos) accepted.push(makeAabb(pos, canonical.dims));
  }
  const targets = cases
    .map((inst, index) => ({ inst, index }))
    .filter(e => targetSet.has(e.inst.id))
    .sort((a, b) =>
      String(a.inst.caseId).localeCompare(String(b.inst.caseId)) || a.index - b.index);

  const positioned = new Map();
  const stagedIds = [];
  const failedIds = [];
  const warnings = [];
  for (const { inst } of targets) {
    const canonical = getCanonicalInstanceEffectiveDims(inst, caseMap.get(inst.caseId));
    if (!canonical.ok) {
      failedIds.push(inst.id);
      warnings.push(`Item ${inst.id} could not be staged: ${canonical.reason}.`);
      continue;
    }
    const staged = findSafeStagingPosition({ truck: nextTruck }, canonical.dims, accepted);
    accepted.push(staged.aabb);
    positioned.set(inst.id, { position: staged.position, canonical });
    stagedIds.push(inst.id);
  }

  const nextCases = cases.map(inst => {
    const staged = positioned.get(inst.id);
    if (!staged) return inst;
    const next = applyCanonicalInstancePose(inst, staged.canonical);
    next.transform.position = staged.position;
    next.placement = 'staged';
    return next;
  });
  return {
    pack: { ...pack, truck: nextTruck, cases: nextCases },
    stagedIds,
    failedIds,
    warnings,
  };
}

// Organized staging for invalid packed items. Existing staged items were already
// handled by reconciliation and are not moved again.
export function stageInvalidPlacements(reconResult, nextTruck, caseLibrary) {
  return stagePlacementIds(
    reconResult.nextPack,
    reconResult.invalid || [],
    nextTruck,
    caseLibrary
  ).pack;
}

/**
 * PURE load/import repair. Existing valid poses are retained, while packed poses
 * that fail current geometry (including Front Overhang rear retention) move to
 * deterministic staging. Unresolved or malformed references remain untouched so
 * callers can continue surfacing their existing integrity diagnostics.
 */
export function repairRestoredPackPlacements(pack, caseLibrary) {
  const source = pack && typeof pack === 'object' ? pack : {};
  const truck = source.truck && typeof source.truck === 'object' ? source.truck : {};
  const reconciliation = reconcilePlacementsForTruck(source, truck, caseLibrary);
  if (!reconciliation.invalid.length) return reconciliation.nextPack;
  return stagePlacementIds(
    reconciliation.nextPack,
    reconciliation.invalid,
    truck,
    caseLibrary
  ).pack;
}

/**
 * Local repair of reconciliation-invalid placements: try to re-settle each
 * affected case INSIDE the truck (same X/Z drop first, then nearby legal
 * anchors) through the full aabbIsFullyValid pipeline before staging is even
 * considered. Never moves valid placements; never rearranges the load.
 * Returns updated cases plus the ids repaired and the ids still invalid.
 */
function repairInvalidPlacementsLocally(reconResult, truck, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  const zones = getTrailerUsableZones(truck);
  const wheelWell = getWheelWellGeometry(truck);
  const invalidSet = new Set(reconResult.invalid || []);
  const accepted = [...(reconResult.acceptedPlacements || [])];
  const cases = (reconResult.nextPack && reconResult.nextPack.cases) || [];

  const nodes = cases
    .map((inst, index) => ({ inst, index }))
    .filter(entry => invalidSet.has(entry.inst.id))
    .map(entry => {
      const caseData = caseMap.get(entry.inst.caseId);
      const canonical = getCanonicalInstanceEffectiveDims(entry.inst, caseData);
      const position = normalizeTransformPosition(entry.inst.transform && entry.inst.transform.position);
      if (!caseData || !canonical.ok || !canonical.orientationAllowed || !canonical.lockConsistent || !position) {
        return null;
      }
      return {
        id: entry.inst.id,
        inst: entry.inst,
        caseData,
        canonical,
        dims: canonical.dims,
        position,
        index: entry.index,
      };
    })
    .filter(Boolean)
    // Bottom-up so lower dependents become support for the ones above them.
    .sort((a, b) => (a.position.y - b.position.y) || (a.index - b.index));

  const positioned = new Map();
  const { repaired } = repairDependentPlacements(nodes, {
    zones,
    neighborAabbs: () => accepted.map(entry => entry.aabb),
    bottomsFor: (node, x, z) => {
      const probe = makeAabb({ x, y: node.dims.height / 2, z }, node.dims);
      return candidateSnapBottoms(probe, accepted, zones, RECON_TOL, wheelWell);
    },
    validate: (node, position) => {
      const aabb = makeAabb(position, node.dims);
      return aabbIsFullyValid(node, aabb, accepted, zones, truck, RECON_TOL, wheelWell);
    },
    onRepaired: (node, position) => {
      const aabb = makeAabb(position, node.dims);
      accepted.push({ ...node, aabb, position });
      positioned.set(node.id, { position, canonical: node.canonical });
    },
  });

  const nextCases = cases.map(inst => {
    const entry = positioned.get(inst.id);
    if (!entry) return inst;
    const next = applyCanonicalInstancePose(inst, entry.canonical);
    next.transform.position = entry.position;
    next.placement = 'packed';
    return next;
  });

  const repairedIds = repaired.map(entry => entry.id);
  const repairedSet = new Set(repairedIds);
  return {
    pack: { ...reconResult.nextPack, cases: nextCases },
    repairedIds,
    stillInvalidIds: (reconResult.invalid || []).filter(id => !repairedSet.has(id)),
  };
}

export function revalidateManualPlacements(pack, caseLibrary, options = {}) {
  const source = pack && typeof pack === 'object' ? pack : {};
  const truck = source.truck && typeof source.truck === 'object' ? source.truck : {};
  const reconciliation = reconcilePlacementsForTruck(source, truck, caseLibrary, {
    preserveStagedPositions: options.preserveStagedPositions !== false,
  });
  let nextPack = reconciliation.nextPack;
  let stagedIds = [];
  let failedIds = [];
  let warnings = [];
  let repairedIds = [];
  let invalidForStaging = reconciliation.invalid || [];

  // Local repair before staging (delete/removal path): re-settle affected
  // dependents inside the truck when legally possible so removing one box
  // never ejects cargo that still has a valid nearby resting place.
  if (options.repairDependents === true && invalidForStaging.length) {
    const repair = repairInvalidPlacementsLocally(reconciliation, truck, caseLibrary);
    nextPack = repair.pack;
    repairedIds = repair.repairedIds;
    invalidForStaging = repair.stillInvalidIds;
  }

  if (invalidForStaging.length) {
    const staged = stagePlacementIds(nextPack, invalidForStaging, truck, caseLibrary);
    nextPack = staged.pack;
    stagedIds = staged.stagedIds;
    failedIds = staged.failedIds;
    warnings = staged.warnings || [];
  }

  return {
    pack: nextPack,
    adjustedIds: (reconciliation.adjusted || []).map(entry => entry.id),
    repairedIds,
    stagedIds,
    failedIds,
    warnings,
    invalidIds: reconciliation.invalid || [],
    summary: {
      adjusted: (reconciliation.adjusted || []).length,
      repaired: repairedIds.length,
      staged: stagedIds.length,
      failed: failedIds.length,
    },
  };
}

export function updateCasesWithManualRevalidation(packId, nextCases, caseLibrary = CaseLibrary.getCases(), options = {}) {
  const pack = getById(packId);
  if (!pack) return null;
  const proposed = { ...pack, cases: Array.isArray(nextCases) ? nextCases : [] };
  const result = revalidateManualPlacements(proposed, caseLibrary, options);
  const updated = update(packId, { cases: result.pack.cases });
  return { ...result, pack: updated || result.pack };
}

// Repack the invalid items into the NEW truck's free floor/deck space front-first
// (high +X first), without moving any kept/adjusted item or changing AutoPack
// scoring. Items that still do not fit fall back to organized staging.
function findRepackFloorPosition(node, zones, accepted, truck, wheelWell = null) {
  const dims = node.dims;
  const orderedZones = [...zones].sort((a, b) => b.max.x - a.max.x); // front-first
  const STEP_MIN = 2;
  for (const z of orderedZones) {
    if (dims.height > (z.max.y - z.min.y) + RECON_TOL) continue;
    const stepX = Math.max(STEP_MIN, dims.length / 2);
    const stepZ = Math.max(STEP_MIN, dims.width / 2);
    for (let cx = z.max.x - dims.length / 2; cx >= z.min.x + dims.length / 2 - RECON_TOL; cx -= stepX) {
      for (let cz = z.min.z + dims.width / 2; cz <= z.max.z - dims.width / 2 + RECON_TOL; cz += stepZ) {
        const pos = { x: cx, y: z.min.y + dims.height / 2, z: cz };
        const aabb = makeAabb(pos, dims);
        if (aabbIsFullyValid(node, aabb, accepted, zones, truck, RECON_TOL, wheelWell)) return { position: pos, aabb };
      }
    }
  }
  return null;
}

export function repackInvalidPlacements(reconResult, nextTruck, caseLibrary) {
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  const zones = getTrailerUsableZones(nextTruck);
  const wheelWell = getWheelWellGeometry(nextTruck);
  const invalidSet = new Set(reconResult.invalid || []);
  const accepted = [...(reconResult.acceptedPlacements || [])];
  const cases = (reconResult.nextPack && reconResult.nextPack.cases) || [];
  const footprint = inst => {
    const canonical = getCanonicalInstanceEffectiveDims(inst, caseMap.get(inst.caseId));
    return canonical.ok ? canonical.dims.length * canonical.dims.width : -1;
  };
  const targets = cases
    .map((inst, index) => ({ inst, index }))
    .filter(e => invalidSet.has(e.inst.id))
    .sort((a, b) =>
      footprint(b.inst) - footprint(a.inst) ||
      String(a.inst.caseId).localeCompare(String(b.inst.caseId)) || a.index - b.index);

  const positioned = new Map();
  const repackedIds = [];
  const failedIds = [];
  const warnings = [];
  for (const { inst } of targets) {
    const caseData = caseMap.get(inst.caseId);
    const canonical = getCanonicalInstanceEffectiveDims(inst, caseData);
    if (!canonical.ok || !canonical.orientationAllowed || !canonical.lockConsistent) {
      failedIds.push(inst.id);
      warnings.push(`Item ${inst.id} could not be repacked: ${canonical.reason || 'hard orientation rule failed'}.`);
      continue;
    }
    const node = { inst, caseData, canonical, dims: canonical.dims };
    const placed = findRepackFloorPosition(node, zones, accepted, nextTruck, wheelWell);
    if (placed) {
      accepted.push({ ...node, position: placed.position, aabb: placed.aabb });
      positioned.set(inst.id, { position: placed.position, canonical });
      repackedIds.push(inst.id);
    } else {
      failedIds.push(inst.id);
      warnings.push(`Item ${inst.id} could not fit in the proposed truck geometry.`);
    }
  }

  const nextCases = cases.map(inst => {
    const p = positioned.get(inst.id);
    if (!p) return inst;
    const next = applyCanonicalInstancePose(inst, p.canonical);
    next.transform.position = p.position;
    next.placement = 'packed';
    return next;
  });
  return {
    pack: { ...reconResult.nextPack, truck: nextTruck, cases: nextCases },
    repackedIds,
    stagedIds: [],
    failedIds,
    warnings,
    acceptedPlacements: accepted,
  };
}

export {
  getTrailerUsableZones,
  getTrailerCapacityInches3,
  isAabbContainedInAnyZone,
  getFrontBonusBlockedZones,
  getWheelWellsBlockedZones,
};

export function getPacks() {
  return StateStore.get('packLibrary') || [];
}

export function getById(packId) {
  return getPacks().find(p => p.id === packId) || null;
}

export function create(packData) {
  const now = Date.now();
  const rawTruck = packData.truck || { length: 636, width: 102, height: 98 };
  const shapeMode =
    rawTruck &&
      (rawTruck.shapeMode === 'wheelWells' || rawTruck.shapeMode === 'frontBonus' || rawTruck.shapeMode === 'rect')
      ? rawTruck.shapeMode
      : 'rect';
  const shapeConfig =
    rawTruck && rawTruck.shapeConfig && typeof rawTruck.shapeConfig === 'object' && !Array.isArray(rawTruck.shapeConfig)
      ? Utils.deepClone(rawTruck.shapeConfig)
      : {};
  const truck = {
    length: Number(rawTruck.length) || 636,
    width: Number(rawTruck.width) || 102,
    height: Number(rawTruck.height) || 98,
    shapeMode,
    shapeConfig,
  };
  const pack = {
    id: Utils.uuid(),
    title: packData.title || 'Untitled Pack',
    client: packData.client || '',
    projectName: packData.projectName || '',
    drawnBy: packData.drawnBy || '',
    notes: packData.notes || '',
    folderId: null,
    truck,
    cases: [],
    groups: [],
    stats: {
      totalCases: 0,
      hiddenCases: 0,
      packedCases: 0,
      volumeUsed: 0,
      volumePercent: 0,
      totalWeight: 0,
      cog: null,
      oogWarnings: [],
      palletWarnings: [],
    },
    createdAt: now,
    lastEdited: now,
    thumbnail: null,
    thumbnailUpdatedAt: null,
    thumbnailSource: null,
  };
  StateStore.set({ packLibrary: [...getPacks(), pack] });
  return pack;
}

export function update(packId, patch) {
  const packs = getPacks();
  const idx = packs.findIndex(p => p.id === packId);
  if (idx === -1) return null;
  const now = Date.now();
  const cloned = Utils.deepClone(patch);
  const prev = packs[idx];
  const next = { ...prev, ...cloned };

  const lastEditedKeys = ['title', 'client', 'projectName', 'drawnBy', 'notes', 'truck', 'cases', 'groups'];
  const hasLastEditedKey = Object.keys(cloned || {}).some(k => lastEditedKeys.includes(k));
  next.lastEdited = hasLastEditedKey ? now : prev.lastEdited || now;
  next.stats = computeStats(next);
  const nextPacks = packs.map((p, i) => (i === idx ? next : p));
  StateStore.set({ packLibrary: nextPacks });
  return next;
}

export function remove(packId) {
  const packs = getPacks().filter(p => p.id !== packId);
  const current = StateStore.get('currentPackId');
  StateStore.set(
    { packLibrary: packs, currentPackId: current === packId ? null : current, selectedInstanceIds: [] },
    { skipHistory: true }
  );
}

export function duplicate(packId) {
  const pack = getById(packId);
  if (!pack) return null;
  const now = Date.now();
  const copy = Utils.deepClone(pack);
  copy.id = Utils.uuid();
  copy.title = pack.title + ' (Copy)';
  copy.createdAt = now;
  copy.lastEdited = now;
  copy.thumbnail = null;
  copy.thumbnailUpdatedAt = null;
  copy.thumbnailSource = null;
  copy.cases = (copy.cases || []).map(i => ({ ...i, id: Utils.uuid() }));
  StateStore.set({ packLibrary: [...getPacks(), copy] });
  return copy;
}

export function open(packId) {
  const pack = getById(packId);
  if (!pack) return null;
  StateStore.set({ currentPackId: packId, selectedInstanceIds: [] }, { skipHistory: true });
  return pack;
}

export function addInstance(packId, caseId, position) {
  const pack = getById(packId);
  if (!pack) return null;
  const caseData = CaseLibrary.getById(caseId);
  if (!caseData) return null;
  const explicitPosition = normalizeTransformPosition(position);
  const dims = normalizeDims(caseData.dimensions);
  const acceptedAabbs = buildAcceptedAabbs(pack, pack.cases || [], CaseLibrary.getCases());
  const explicitAabb = explicitPosition ? makeAabb(explicitPosition, dims) : null;
  const needsSafeStaging = !explicitPosition ||
    aabbIntersectsWheelWellBlockedBody(explicitAabb, pack.truck) ||
    aabbIntersectsFrontBonusBlockedBody(explicitAabb, pack.truck);
  const staged = needsSafeStaging ? findSafeStagingPosition(pack, dims, acceptedAabbs) : null;
  const finalPosition = needsSafeStaging ? staged.position : explicitPosition;
  const finalAabb = needsSafeStaging ? staged.aabb : explicitAabb;
  const instance = {
    id: Utils.uuid(),
    caseId,
    transform: {
      position: finalPosition,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: getPlacementForAabb(pack, finalAabb),
  };
  const nextCases = [...(pack.cases || []), instance];
  update(packId, { cases: nextCases });
  return instance;
}

export function updateInstance(packId, instanceId, patch) {
  const pack = getById(packId);
  if (!pack) return null;
  const nextInstances = (pack.cases || []).map(i => (i.id === instanceId ? { ...i, ...Utils.deepClone(patch) } : i));
  return update(packId, { cases: nextInstances });
}

export function removeInstances(packId, instanceIds) {
  const pack = getById(packId);
  if (!pack) return null;
  const requestedDeletedIds = Array.isArray(instanceIds) ? instanceIds : [];
  const idSet = new Set(requestedDeletedIds);
  const deletedInstanceIds = (pack.cases || [])
    .filter(i => i && idSet.has(i.id))
    .map(i => i.id);
  const nextInstances = (pack.cases || []).filter(i => !idSet.has(i.id));
  // Delete path enables local dependent repair: affected cases are re-settled
  // inside the truck when legally possible; only truly unplaceable ones stage.
  const result = updateCasesWithManualRevalidation(packId, nextInstances, CaseLibrary.getCases(), {
    repairDependents: true,
  });
  if (!result) return null;

  const deletedSet = new Set(deletedInstanceIds);
  const dependentStagedIds = (result.stagedIds || []).filter(id => !deletedSet.has(id));
  const dependentRepairedIds = (result.repairedIds || []).filter(id => !deletedSet.has(id));
  const mutation = {
    type: 'removeInstances',
    requestedDeletedIds: [...requestedDeletedIds],
    deletedInstanceIds,
    dependentStagedIds,
    dependentStagedCount: dependentStagedIds.length,
    dependentRepairedIds,
    dependentRepairedCount: dependentRepairedIds.length,
    finalSelectionIds: [],
    revalidation: {
      adjustedIds: result.adjustedIds || [],
      repairedIds: result.repairedIds || [],
      stagedIds: result.stagedIds || [],
      failedIds: result.failedIds || [],
      invalidIds: result.invalidIds || [],
      summary: result.summary || {},
      warnings: result.warnings || [],
    },
  };

  return {
    ...result.pack,
    pack: result.pack,
    mutation,
    deletedInstanceIds,
    requestedDeletedIds: [...requestedDeletedIds],
    dependentStagedIds,
    dependentStagedCount: dependentStagedIds.length,
    dependentRepairedIds,
    dependentRepairedCount: dependentRepairedIds.length,
    finalSelectionIds: [],
    revalidation: mutation.revalidation,
  };
}

function computeShapeAwareOOGWarnings(pack, caseLibrary) {
  if (!pack || !Array.isArray(pack.cases) || !pack.truck) return [];
  const zonesInches = getTrailerUsableZones(pack.truck);
  const oogWheelWell = getWheelWellGeometry(pack.truck);
  const truck = pack.truck || {};
  const truckL = Number(truck.length) || 0;
  const truckW = Number(truck.width) || 0;
  const truckH = Number(truck.height) || 0;
  const halfW = truckW / 2;
  // Shape-aware front boundary: for frontBonus this is truck.length + bonusLength
  // (the far edge of the cab-over overhang deck), not raw truck.length. For
  // rect/wheelWells every zone's max.x is truck.length, so this is equivalent
  // to the previous truckL-based check.
  const maxUsableX = zonesInches.length ? Math.max(...zonesInches.map(z => z.max.x)) : truckL;
  const caseMap = new Map((caseLibrary || []).map(c => [c.id, c]));
  const warnings = [];

  (pack.cases || []).forEach(inst => {
    if (!inst || inst.hidden) return;
    const caseData = caseMap.get(inst.caseId);
    if (!caseData) return;
    const dims = inst.orientedDims || caseData.dimensions || { length: 0, width: 0, height: 0 };
    const pos = inst.transform && inst.transform.position ? inst.transform.position : { x: 0, y: 0, z: 0 };
    const half = { x: dims.length / 2, y: dims.height / 2, z: dims.width / 2 };
    const aabb = {
      min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
      max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
    };
    if (isAabbInsideTruckGeometry(aabb, zonesInches, oogWheelWell)) return;

    const issues = [];
    if (aabb.min.x < -0.05) issues.push('protrudesRear');
    if (aabb.max.x > maxUsableX + 0.05) issues.push('protrudesFront');
    if (aabb.min.y < -0.05) issues.push('belowFloor');
    if (aabb.max.y > truckH + 0.05) issues.push('exceedsHeight');
    if (aabb.min.z < -halfW - 0.05) issues.push('protrudesLeft');
    if (aabb.max.z > halfW + 0.05) issues.push('protrudesRight');
    if (!issues.length) issues.push('outsideUsableZone');

    warnings.push({
      instanceId: inst.id,
      caseId: inst.caseId,
      caseName: caseData.name || 'Unknown',
      issues,
    });
  });

  return warnings;
}

export function computeStats(pack, caseLibraryOverride) {
  const zonesInches = getTrailerUsableZones(pack && pack.truck);
  const statsWheelWell = getWheelWellGeometry(pack && pack.truck);
  const truckVol = getTrailerCapacityInches3(pack && pack.truck);
  let usedIn3 = 0;
  let totalWeight = 0;
  let packedCases = 0;
  let stagedCases = 0;
  let hiddenCases = 0;
  let unresolvedInstances = 0;
  const getCase = caseId => {
    if (Array.isArray(caseLibraryOverride)) return caseLibraryOverride.find(c => c.id === caseId) || null;
    return CaseLibrary.getById(caseId);
  };
  (pack.cases || []).forEach(inst => {
    if (inst.hidden) hiddenCases++;
    const c = getCase(inst.caseId);
    if (!c) {
      // Instance references a missing case definition. Do not silently treat the
      // totals as complete and never invent dimensions — surface it so the
      // editor/Inspector/Stats/PDF/export can warn and the totals read incomplete.
      if (!inst.hidden) unresolvedInstances++;
      return;
    }
    if (inst.hidden) return;
    const dims = c.dimensions || { length: 0, width: 0, height: 0 };
    // Use oriented dimensions from AutoPack if available, else fall back to original
    const od = inst.orientedDims || null;
    const effDims = od || dims;
    const pos = inst.transform && inst.transform.position ? inst.transform.position : { x: 0, y: 0, z: 0 };
    const half = { x: effDims.length / 2, y: effDims.height / 2, z: effDims.width / 2 };
    const aabb = {
      min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
      max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
    };
    const insideTruck = isAabbInsideTruckGeometry(aabb, zonesInches, statsWheelWell);
    if (!insideTruck) {
      stagedCases++;
      return;
    }
    packedCases++;
    usedIn3 += c.volume || Utils.volumeInCubicInches(dims);
    totalWeight += Number(c.weight) || 0;
  });
  const volumePercent = truckVol > 0 ? (usedIn3 / truckVol) * 100 : 0;
  const caseLib = Array.isArray(caseLibraryOverride) ? caseLibraryOverride : CaseLibrary.getCases();
  const cog = computeCoG(pack, caseLib);
  const oogWarnings = computeShapeAwareOOGWarnings(pack, caseLib);
  const palletWarnings = computePalletWarnings(pack, caseLib);
  // Completeness: when any instance is unresolved, weight/volume/utilization totals
  // are necessarily incomplete (we never fabricate the missing item's physical
  // contribution). Surfaces must avoid any "complete"/"fits all" wording when false.
  const totalsComplete = unresolvedInstances === 0;
  return {
    totalCases: (pack.cases || []).length,
    hiddenCases,
    packedCases,
    stagedCases,
    unresolvedInstances,
    volumeUsed: usedIn3,
    volumePercent,
    totalWeight,
    cog,
    oogWarnings,
    palletWarnings,
    totalsComplete,
    weightComplete: totalsComplete,
    volumeComplete: totalsComplete,
    utilizationComplete: totalsComplete,
  };
}

// Cargo equivalence and the import fingerprint share one typed canonical
// representation (core/cargo-canonical.js): the SAME raw value yields the SAME
// canonical result in every path, "false" is never truthy, malformed numbers are
// never silently 0, and an invalid value never equals a valid default. The
// comparison is PHYSICAL only — manufacturer/category (display taxonomy) are
// excluded so casing/taxonomy differences never fork a separate physical case.
// The fingerprint is stamped onto a conflict-imported case as `importSourceKey`
// so re-importing the same conflicting pack reuses the existing copy (idempotence).
const cargoRulesEquivalent = cargoFieldsEqual;
const cargoFingerprint = cargoComparisonKey;

// A bundled case definition is "complete" (storable) only if it is an object
// with a non-blank id and finite positive dimensions. Anything else is malformed
// and must block the whole import before any mutation. Returns an error string,
// or null when the definition is valid.
function validateBundledCaseDefinition(c) {
  if (!c || typeof c !== 'object') return 'bundled case definition is not an object';
  if (!String(c.id || '').trim()) return 'bundled case definition is missing an id';
  const d = c.dimensions;
  if (!d || typeof d !== 'object') return `bundled case "${c.id}" is missing dimensions`;
  const ok = v => Number.isFinite(Number(v)) && Number(v) > 0;
  if (!ok(d.length) || !ok(d.width) || !ok(d.height)) {
    return `bundled case "${c.id}" has invalid dimensions`;
  }
  return null;
}

// PURE preflight: parse, validate, canonicalize and plan a pack import WITHOUT
// mutating the case library, pack library, or StateStore. Returns a complete
// import plan ({ currentCases, currentPacks, newCases, pack, caseConflicts }) or
// throws with zero side effects. The single state commit happens only in
// importPackPayload after the entire plan succeeds.
export function planPackImport(payload) {
  const now = Date.now();
  const incomingPack = payload && payload.pack;
  if (!incomingPack || !incomingPack.truck || !Array.isArray(incomingPack.cases)) {
    throw new Error('Invalid pack format');
  }

  const bundled = Array.isArray(payload.bundledCases) ? payload.bundledCases : [];
  const currentCases = CaseLibrary.getCases();
  const currentPacks = getPacks();

  // Reject blank/missing instance caseId up front — these can never resolve to a
  // real case and previously slipped past the missing-reference gate.
  const blankRefCount = (incomingPack.cases || []).filter(
    inst => !inst || !String(inst.caseId || '').trim()
  ).length;
  if (blankRefCount) {
    throw new Error(
      `Pack import blocked: ${blankRefCount} instance(s) have a blank or missing case reference.`
    );
  }

  // Validate every bundled case definition. A malformed bundled case (anywhere in
  // the list — first, middle, or last) blocks the entire import atomically.
  for (const c of bundled) {
    const err = validateBundledCaseDefinition(c);
    if (err) throw new Error(`Pack import blocked: ${err}.`);
  }

  const caseById = new Map(currentCases.map(c => [c.id, c]));
  const caseByName = new Map(
    currentCases.map(c => [
      String(c.name || '')
        .trim()
        .toLowerCase(),
      c,
    ])
  );

  // Integrity gate: every instance must reference a case that resolves to either
  // an existing local case or a bundled case definition. Block the whole pack
  // import otherwise — never save a partial pack as a successful import.
  const bundledIds = new Set(bundled.filter(b => b && b.id).map(b => b.id));
  const unresolvedRefs = [...new Set(
    (incomingPack.cases || [])
      .map(inst => inst && inst.caseId)
      .filter(cid => cid && !caseById.has(cid) && !bundledIds.has(cid))
  )];
  if (unresolvedRefs.length) {
    const shown = unresolvedRefs.slice(0, 3).join(', ') + (unresolvedRefs.length > 3 ? ', …' : '');
    throw new Error(
      `Pack import blocked: ${unresolvedRefs.length} referenced case definition(s) are missing (${shown}). ` +
      'The pack file must bundle every case its instances use.'
    );
  }

  const caseIdMap = new Map();
  const caseConflicts = [];
  const newCases = [];
  // Index of previously-imported cases by their source fingerprint, so repeated
  // conflicting imports reuse the first imported copy (idempotence).
  const caseByImportKey = new Map();
  currentCases.forEach(c => {
    if (c && c.importSourceKey) caseByImportKey.set(String(c.importSourceKey), c);
  });

  const makeUniqueImportedName = name => {
    const base = String(name || 'Imported Case').trim() || 'Imported Case';
    let candidate = `${base} (Imported)`;
    let n = 2;
    while (caseByName.has(candidate.trim().toLowerCase())) {
      candidate = `${base} (Imported ${n})`;
      n += 1;
    }
    return candidate;
  };

  // Plan adoption of a bundled case as a new local case (no mutation). On a cargo
  // conflict, regenerate the id and give a unique "(Imported)" name so the imported
  // pack keeps its intended behavior and the existing local case is never
  // overwritten. With no conflict the imported id is preserved so re-importing the
  // same pack is idempotent (it will match by id next time). The fully prepared,
  // canonical case is accumulated in `newCases` and committed once by the caller.
  const planNewCase = (c, conflictKind, fingerprint) => {
    const copy = Utils.deepClone(c);
    if (conflictKind) {
      copy.id = Utils.uuid();
      copy.name = makeUniqueImportedName(c.name);
    } else {
      copy.id = c.id;
    }
    // Stamp the source fingerprint so a future identical import reuses this copy.
    copy.importSourceKey = fingerprint;
    const storable = CaseLibrary.buildStorableCase(copy);
    newCases.push(storable);
    caseIdMap.set(c.id, storable.id);
    caseById.set(storable.id, storable);
    caseByImportKey.set(fingerprint, storable);
    const newNameKey = String(storable.name || '').trim().toLowerCase();
    if (newNameKey) caseByName.set(newNameKey, storable);
    if (conflictKind) {
      caseConflicts.push({
        kind: conflictKind,
        importedId: c.id,
        importedName: String(c.name || ''),
        newId: storable.id,
        newName: storable.name,
      });
    }
    return storable;
  };

  bundled.forEach(c => {
    if (!c || !c.id) return;
    const nameKey = String(c.name || '')
      .trim()
      .toLowerCase();
    const fingerprint = cargoFingerprint(c);
    const localById = caseById.get(c.id);
    // Same id with equivalent cargo → reuse the local case.
    if (localById && cargoRulesEquivalent(localById, c)) {
      caseIdMap.set(c.id, c.id);
      return;
    }
    const localByName = nameKey ? caseByName.get(nameKey) : null;
    // Same name (different id) with equivalent cargo → reuse the local case.
    if (localByName && cargoRulesEquivalent(localByName, c)) {
      caseIdMap.set(c.id, localByName.id);
      return;
    }
    // Idempotence: if this exact cargo was already imported as a conflict copy,
    // reuse it instead of creating (Imported 2), (Imported 3), ...
    const priorImport = caseByImportKey.get(fingerprint);
    if (priorImport) {
      caseIdMap.set(c.id, priorImport.id);
      return;
    }
    // True id/name conflict → renamed new case; otherwise a brand-new case that
    // keeps the imported id. Both are stamped with the source fingerprint.
    const conflictKind = localById ? 'id-conflict' : localByName ? 'name-conflict' : null;
    planNewCase(c, conflictKind, fingerprint);
  });

  const pack = Utils.deepClone(incomingPack);
  pack.id = currentPacks.some(p => p.id === pack.id) ? Utils.uuid() : pack.id || Utils.uuid();
  pack.title = pack.title ? `${pack.title} (Imported)` : 'Imported Pack';
  pack.folderId = null;
  pack.createdAt = pack.createdAt || now;
  pack.lastEdited = now;

  pack.cases = (pack.cases || []).map(inst => {
    const next = Utils.deepClone(inst);
    next.id = Utils.uuid();
    next.caseId = caseIdMap.get(next.caseId) || next.caseId;
    return next;
  });

  // Final reference validation against the planned final case set.
  const finalCases = [...currentCases, ...newCases];
  const finalCaseIds = new Set(finalCases.map(c => c.id));
  const stillUnresolved = pack.cases.filter(inst => !finalCaseIds.has(inst.caseId));
  if (stillUnresolved.length) {
    throw new Error(
      `Pack import blocked: ${stillUnresolved.length} instance reference(s) could not be resolved after planning.`
    );
  }

  const rawTruck = pack.truck && typeof pack.truck === 'object' ? pack.truck : {};
  pack.truck = CoreNormalizer.normalizeTruck(rawTruck);
  // Repair placements and compute stats against the PLANNED final case set, not
  // the live store (which is not mutated until the commit below).
  const repairedPack = repairPackInstancePlacements(pack, finalCases);
  pack.cases = repairedPack.cases;
  pack.stats = computeStats(pack, finalCases);

  return { currentCases, currentPacks, newCases, finalCases, pack, caseConflicts };
}

export function importPackPayload(payload) {
  const plan = planPackImport(payload);

  // Single atomic state commit: all planned new cases + the new pack persist
  // together, or (on any preflight throw above) nothing at all.
  StateStore.set(
    {
      caseLibrary: plan.finalCases,
      packLibrary: [...plan.currentPacks, plan.pack],
      selectedInstanceIds: [],
    },
    { skipHistory: false }
  );

  // Surface case conflicts to the import UI without persisting them on the pack
  // (non-enumerable so JSON serialization to storage ignores it).
  Object.defineProperty(plan.pack, 'caseConflicts', {
    value: plan.caseConflicts,
    enumerable: false,
    configurable: true,
  });

  return plan.pack;
}
