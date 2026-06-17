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
import { computeCoG } from './cog-service.js';
import { computePalletWarnings } from './oog-service.js';

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

function getTrailerCapacityInches3(truck) {
  const zones = getTrailerUsableZones(truck);
  return zones.reduce((sum, z) => {
    const dx = z.max.x - z.min.x;
    const dy = z.max.y - z.min.y;
    const dz = z.max.z - z.min.z;
    return sum + Math.max(0, dx) * Math.max(0, dy) * Math.max(0, dz);
  }, 0);
}

export const CONTAINMENT_EPS_INCHES = 0.05;

/**
 * Inch-space containment contract: all AABBs and usable zones passed here use
 * inches, and all active trailer-containment callers share the same physical
 * tolerance through CONTAINMENT_EPS_INCHES.
 */
function isAabbContainedInAnyZone(aabb, zones) {
  // Bug 5 fix: add small epsilon tolerance for floating-point rounding.
  // AutoPack places items with fp arithmetic, so a box at x=0.0000000001
  // would fail an exact >= 0 check. 0.05 inches is imperceptible visually.
  const EPS = CONTAINMENT_EPS_INCHES;
  for (const z of zones || []) {
    if (
      aabb.min.x >= z.min.x - EPS &&
      aabb.max.x <= z.max.x + EPS &&
      aabb.min.y >= z.min.y - EPS &&
      aabb.max.y <= z.max.y + EPS &&
      aabb.min.z >= z.min.z - EPS &&
      aabb.max.z <= z.max.z + EPS
    ) {
      return true;
    }
  }
  return false;
}

const RIGHT_ANGLE_RAD = Math.PI / 2;

function normalizeRightAngle(value) {
  const raw = Number(value) || 0;
  let turns = Math.round(raw / RIGHT_ANGLE_RAD) % 4;
  if (turns < 0) turns += 4;
  return turns * RIGHT_ANGLE_RAD;
}

export function normalizeRightAngleRotation(rotation = {}) {
  return {
    x: normalizeRightAngle(rotation.x),
    y: normalizeRightAngle(rotation.y),
    z: normalizeRightAngle(rotation.z),
  };
}

function rotateVectorXYZ(vec, rotation) {
  let x = vec.x;
  let y = vec.y;
  let z = vec.z;
  const rx = normalizeRightAngle(rotation.x);
  const ry = normalizeRightAngle(rotation.y);
  const rz = normalizeRightAngle(rotation.z);
  // Apply Z first (THREE.js Euler 'XYZ' is matrix Rx*Ry*Rz, so Rz acts on the vector first)
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const xz = x * cosZ - y * sinZ;
  const yz = x * sinZ + y * cosZ;
  x = xz;
  y = yz;
  // Apply Y second
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const xy = x * cosY + z * sinY;
  const zy = -x * sinY + z * cosY;
  x = xy;
  z = zy;
  // Apply X last
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const yx = y * cosX - z * sinX;
  const zx = y * sinX + z * cosX;
  return { x, y: yx, z: zx };
}

export function getOrientedDimsForRotation(dimensions = {}, rotation = {}) {
  const length = Math.max(0, Number(dimensions.length) || 0);
  const width = Math.max(0, Number(dimensions.width) || 0);
  const height = Math.max(0, Number(dimensions.height) || 0);
  const locked = normalizeRightAngleRotation(rotation);
  const axes = [
    rotateVectorXYZ({ x: length, y: 0, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: height, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: 0, z: width }, locked),
  ];
  const out = axes.reduce(
    (acc, axis) => ({
      length: acc.length + Math.abs(axis.x),
      height: acc.height + Math.abs(axis.y),
      width: acc.width + Math.abs(axis.z),
    }),
    { length: 0, width: 0, height: 0 }
  );
  return {
    length: Math.round(out.length * 1e6) / 1e6,
    width: Math.round(out.width * 1e6) / 1e6,
    height: Math.round(out.height * 1e6) / 1e6,
  };
}

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
  const rawLock = String(caseData.orientationLock || 'any').trim().toLowerCase();
  const lock = rawLock === 'on-side' ? 'onside' : rawLock;
  if (lock === 'upright') return isUpright;
  if (lock === 'onside') return !isUpright;
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

function aabbsOverlap(a, b) {
  const EPS = 0.001;
  return (
    a.min.x < b.max.x - EPS &&
    a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS &&
    a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS &&
    a.max.z > b.min.z + EPS
  );
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
  return {
    gap,
    truckL,
    truckW,
    originX: 0,
    originZ: truckW / 2 + gap,
  };
}

export function findSafeStagingPosition(pack, dims, acceptedAabbs) {
  const truck = pack && pack.truck ? pack.truck : {};
  const layout = getStagingLayout(truck);
  const truckL = Math.max(layout.truckL, dims.length);
  const gap = layout.gap;
  const stepX = Math.max(1, dims.length + gap);
  const stepZ = Math.max(1, dims.width + gap);
  const minX = layout.originX + dims.length / 2;
  const maxX = Math.max(minX, truckL - dims.length / 2);
  const availableX = Math.max(0, maxX - minX);
  const cols = Math.max(1, Math.floor(availableX / stepX) + 1);
  const startZ = layout.originZ + dims.width / 2;

  for (let row = 0; row < 200; row++) {
    for (let col = 0; col < cols; col++) {
      const position = {
        x: Math.min(minX + col * stepX, maxX),
        y: Math.max(1, dims.height / 2),
        z: startZ + row * stepZ,
      };
      const aabb = makeAabb(position, dims);
      if (!overlapsAny(aabb, acceptedAabbs)) return { position, aabb };
    }
  }

  const fallback = {
    x: layout.originX - gap - dims.length / 2,
    y: Math.max(1, dims.height / 2),
    z: startZ,
  };
  return { position: fallback, aabb: makeAabb(fallback, dims) };
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
  const zones = getTrailerUsableZones(pack && pack.truck);
  return isAabbContainedInAnyZone(aabb, zones) ? 'packed' : 'staged';
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

  return { ...pack, cases: nextCases };
}

export { getTrailerUsableZones, getTrailerCapacityInches3, isAabbContainedInAnyZone, getFrontBonusBlockedZones };

// ============================================================================
// SECTION: SHARED PLACEMENT VALIDATION CONSTANTS AND HELPERS
// These are exported so that editor-screen.js and future placement validators
// all use the same epsilon and support-fraction threshold.
// ============================================================================

/** Shared epsilon for AABB overlap checks across all placement code paths. */
export const PLACEMENT_EPS = 0.001;

/** Minimum fraction of a case's bottom face that must be covered by supporters. */
export const MIN_SUPPORT_FRACTION = 0.5;

/**
 * Compute what fraction of the candidate's bottom face is covered by supporter AABBs.
 * Works with plain {min,max} objects in any consistent coordinate space (inches or world units).
 *
 * Floor is not a supporter — callers should treat fraction=0 as "falls to floor".
 * Touching faces (otherAabb.max.y === candidate.min.y ± tolerance) count as support.
 * Tiny-corner overlap produces a fraction well below MIN_SUPPORT_FRACTION.
 *
 * @param {{ min: {x,y,z}, max: {x,y,z} }} candidateAabb
 * @param {Array<{ min: {x,y,z}, max: {x,y,z} }>} supporterAabbs
 * @param {number} [tolerance=PLACEMENT_EPS] - Y tolerance for flush-top detection
 * @returns {number} fraction in [0, 1]
 */
export function computeSupportFraction(candidateAabb, supporterAabbs, tolerance = PLACEMENT_EPS) {
  if (!candidateAabb) return 0;
  const footprintL = candidateAabb.max.x - candidateAabb.min.x;
  const footprintW = candidateAabb.max.z - candidateAabb.min.z;
  const candidateArea = Math.max(1e-9, footprintL * footprintW);
  const bottom = candidateAabb.min.y;
  let supportArea = 0;

  for (const sup of supporterAabbs || []) {
    if (!sup) continue;
    // Only count surfaces whose top face is flush with the candidate's bottom face.
    if (Math.abs(bottom - sup.max.y) > tolerance) continue;
    const overlapL = Math.max(0, Math.min(candidateAabb.max.x, sup.max.x) - Math.max(candidateAabb.min.x, sup.min.x));
    const overlapW = Math.max(0, Math.min(candidateAabb.max.z, sup.max.z) - Math.max(candidateAabb.min.z, sup.min.z));
    supportArea += overlapL * overlapW;
  }

  return Math.min(1, supportArea / candidateArea);
}

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
  const staged = explicitPosition
    ? null
    : findSafeStagingPosition(
        pack,
        dims,
        buildAcceptedAabbs(pack, pack.cases || [], CaseLibrary.getCases())
      );
  const finalPosition = explicitPosition || staged.position;
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
    placement: getPlacementForAabb(pack, makeAabb(finalPosition, dims)),
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
  const idSet = new Set(instanceIds || []);
  const nextInstances = (pack.cases || []).filter(i => !idSet.has(i.id));
  return update(packId, { cases: nextInstances });
}

function computeShapeAwareOOGWarnings(pack, caseLibrary) {
  if (!pack || !Array.isArray(pack.cases) || !pack.truck) return [];
  const zonesInches = getTrailerUsableZones(pack.truck);
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
    if (isAabbContainedInAnyZone(aabb, zonesInches)) return;

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
  const truckVol = getTrailerCapacityInches3(pack && pack.truck);
  let usedIn3 = 0;
  let totalWeight = 0;
  let packedCases = 0;
  let hiddenCases = 0;
  const getCase = caseId => {
    if (Array.isArray(caseLibraryOverride)) return caseLibraryOverride.find(c => c.id === caseId) || null;
    return CaseLibrary.getById(caseId);
  };
  (pack.cases || []).forEach(inst => {
    if (inst.hidden) hiddenCases++;
    const c = getCase(inst.caseId);
    if (!c) return;
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
    const insideTruck = isAabbContainedInAnyZone(aabb, zonesInches);
    if (!insideTruck) return;
    packedCases++;
    usedIn3 += c.volume || Utils.volumeInCubicInches(dims);
    totalWeight += Number(c.weight) || 0;
  });
  const volumePercent = truckVol > 0 ? (usedIn3 / truckVol) * 100 : 0;
  const caseLib = Array.isArray(caseLibraryOverride) ? caseLibraryOverride : CaseLibrary.getCases();
  const cog = computeCoG(pack, caseLib);
  const oogWarnings = computeShapeAwareOOGWarnings(pack, caseLib);
  const palletWarnings = computePalletWarnings(pack, caseLib);
  return {
    totalCases: (pack.cases || []).length,
    hiddenCases,
    packedCases,
    volumeUsed: usedIn3,
    volumePercent,
    totalWeight,
    cog,
    oogWarnings,
    palletWarnings,
  };
}

// Cargo-defining fields used to decide whether a bundled imported case is
// equivalent to a local case. Transient fields (ids, timestamps, runtime
// state, instance transforms) are intentionally excluded.
function normalizeOrientationLockValue(v) {
  const s = String(v == null ? 'any' : v).trim().toLowerCase();
  if (s === 'upright') return 'upright';
  if (s === 'onside' || s === 'on-side' || s === 'on side') return 'onside';
  return 'any';
}

function laneTriStateValue(v) {
  return v === true ? true : v === false ? false : null;
}

function cargoRulesEquivalent(a, b) {
  if (!a || !b) return false;
  const n = x => Number(x) || 0;
  const s = x => String(x == null ? '' : x).trim().toLowerCase();
  const ad = a.dimensions || {};
  const bd = b.dimensions || {};
  return (
    s(a.name) === s(b.name) &&
    s(a.manufacturer) === s(b.manufacturer) &&
    s(a.category) === s(b.category) &&
    n(ad.length) === n(bd.length) &&
    n(ad.width) === n(bd.width) &&
    n(ad.height) === n(bd.height) &&
    n(a.weight) === n(b.weight) &&
    Boolean(a.canFlip) === Boolean(b.canFlip) &&
    normalizeOrientationLockValue(a.orientationLock) === normalizeOrientationLockValue(b.orientationLock) &&
    Boolean(a.noStackOnTop) === Boolean(b.noStackOnTop) &&
    (a.stackable !== false) === (b.stackable !== false) &&
    n(a.maxStackCount) === n(b.maxStackCount) &&
    Boolean(a.isPallet) === Boolean(b.isPallet) &&
    n(a.maxPalletWeight) === n(b.maxPalletWeight) &&
    laneTriStateValue(a.laneItem) === laneTriStateValue(b.laneItem) &&
    n(a.loadPriority) === n(b.loadPriority) &&
    s(a.shape || 'box') === s(b.shape || 'box')
  );
}

export function importPackPayload(payload) {
  const now = Date.now();
  const incomingPack = payload && payload.pack;
  if (!incomingPack || !incomingPack.truck || !Array.isArray(incomingPack.cases)) {
    throw new Error('Invalid pack format');
  }

  const bundled = Array.isArray(payload.bundledCases) ? payload.bundledCases : [];
  const currentCases = CaseLibrary.getCases();
  const currentPacks = getPacks();

  const caseById = new Map(currentCases.map(c => [c.id, c]));
  const caseByName = new Map(
    currentCases.map(c => [
      String(c.name || '')
        .trim()
        .toLowerCase(),
      c,
    ])
  );
  const caseIdMap = new Map();
  const caseConflicts = [];

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

  // Adopt a bundled case as a new local case. On a cargo conflict, regenerate
  // the id and give a unique "(Imported)" name so the imported pack keeps its
  // intended behavior and the existing local case is never overwritten. With
  // no conflict the imported id is preserved so re-importing the same pack is
  // idempotent (it will match by id next time).
  const adoptNewCase = (c, conflictKind) => {
    const copy = Utils.deepClone(c);
    if (conflictKind) {
      copy.id = Utils.uuid();
      copy.name = makeUniqueImportedName(c.name);
    } else {
      copy.id = c.id;
    }
    copy.createdAt = copy.createdAt || now;
    copy.updatedAt = now;
    copy.volume = copy.volume || Utils.volumeInCubicInches(copy.dimensions || { length: 0, width: 0, height: 0 });
    CaseLibrary.upsert(copy);
    caseIdMap.set(c.id, copy.id);
    caseById.set(copy.id, copy);
    const newNameKey = String(copy.name || '').trim().toLowerCase();
    if (newNameKey) caseByName.set(newNameKey, copy);
    if (conflictKind) {
      caseConflicts.push({
        kind: conflictKind,
        importedId: c.id,
        importedName: String(c.name || ''),
        newId: copy.id,
        newName: copy.name,
      });
    }
    return copy;
  };

  bundled.forEach(c => {
    if (!c || !c.id) return;
    const nameKey = String(c.name || '')
      .trim()
      .toLowerCase();
    const localById = caseById.get(c.id);
    if (localById) {
      // Same id: reuse only when the cargo definition is equivalent.
      if (cargoRulesEquivalent(localById, c)) {
        caseIdMap.set(c.id, c.id);
      } else {
        adoptNewCase(c, 'id-conflict');
      }
      return;
    }
    const localByName = nameKey ? caseByName.get(nameKey) : null;
    if (localByName) {
      // Same name, different id: reuse only when the cargo definition matches.
      if (cargoRulesEquivalent(localByName, c)) {
        caseIdMap.set(c.id, localByName.id);
      } else {
        adoptNewCase(c, 'name-conflict');
      }
      return;
    }
    // No id or name match: adopt as a new local case, preserving the imported id.
    adoptNewCase(c, null);
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

  const rawTruck = pack.truck && typeof pack.truck === 'object' ? pack.truck : {};
  pack.truck = CoreNormalizer.normalizeTruck(rawTruck);
  const repairedPack = repairPackInstancePlacements(pack, CaseLibrary.getCases());
  pack.cases = repairedPack.cases;

  pack.stats = computeStats(pack, CaseLibrary.getCases());

  StateStore.set(
    {
      caseLibrary: CaseLibrary.getCases(),
      packLibrary: [...currentPacks, pack],
      selectedInstanceIds: [],
    },
    { skipHistory: false }
  );

  // Surface case conflicts to the import UI without persisting them on the pack
  // (non-enumerable so JSON serialization to storage ignores it).
  Object.defineProperty(pack, 'caseConflicts', {
    value: caseConflicts,
    enumerable: false,
    configurable: true,
  });

  return pack;
}
