/**
 * @file measurements.js
 * @description Pure Measurement Tool V1 data model (no THREE, no DOM). Owns the per-Load-Plan
 *   `measurements` schema, strict and lenient validation, anchor resolution with scene parity,
 *   derived validity, instance-ID remapping and measurement-specific length formatting.
 *
 *   Contract: docs/product/TP3D-MASTER-TODO-V6.md Section 4.1. A measurement is an illustrative,
 *   informational point-to-point ruler. It never influences cargo, collision, handling rules,
 *   assessment, AutoPack or PDF export. The distance is never stored; it is always recomputed
 *   from the currently resolved endpoints. All stored geometry is canonical inches.
 *
 *   A point can be placed anywhere that is visible: on any cargo surface (any shape), on the
 *   truck floor, wall or ceiling, or on the ground outside the truck. Three anchor kinds:
 *   - cargo: a point in the cargo's local frame; it follows the cargo's pose.
 *   - floor: a supported truck floor surface, revalidated by geometry against the current truck.
 *   - space: a fixed point in the Load Plan's coordinate space (ground, truck shell, free).
 * @module core/measurements
 */

import { getActualPoseDimensions } from './oriented-dims.js';
import { inchesToUnit } from './utils/index.js';

// ============================================================================
// SECTION: CONSTANTS
// ============================================================================

export const MEASUREMENT_SCHEMA_VERSION = 1;
export const MAX_MEASUREMENTS_PER_PACK = 100;
export const MEASUREMENT_TYPE_POINT_TO_POINT = 'point-to-point';
/** Wrapper that keeps an unreadable stored record verbatim so it is never silently dropped. */
export const MEASUREMENT_TYPE_UNREADABLE = 'unreadable';
export const MAX_MEASUREMENT_LABEL_LENGTH = 60;
export const BOX_FACES = Object.freeze(['+x', '-x', '+y', '-y', '+z', '-z']);
export const FLOOR_SURFACES = Object.freeze(['main', 'well-top', 'deck']);
/** Fixed-space surfaces. Truck-shell surfaces carry a truck signature; ground and free do not. */
export const SPACE_SURFACES = Object.freeze(['ground', 'wall-left', 'wall-right', 'wall-front', 'wall-rear', 'ceiling', 'free']);
const TRUCK_BOUND_SURFACES = new Set(['wall-left', 'wall-right', 'wall-front', 'wall-rear', 'ceiling']);

export const MEASUREMENT_STATUS = Object.freeze({
  VALID: 'valid',
  NEEDS_REVIEW: 'needs-review',
  UNRESOLVED: 'unresolved',
});

const MAX_ID_LENGTH = 64;
const MAX_INSTANCE_ID_LENGTH = 128;
const SIGNATURE_EPSILON = 1e-6;
const FLOOR_EPSILON = 0.01;
// The scene renders world units at 0.05 per inch and floors a cargo centre at 0.01 world units
// when no pose height is available (editor-screen applyTransform). Mirrored here for parity.
const SCENE_FALLBACK_HALF_HEIGHT_INCHES = 0.01 / 0.05;

// ============================================================================
// SECTION: SMALL HELPERS
// ============================================================================

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value) {
  return isFiniteNumber(value) && value > 0;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cloneJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return String(value);
  }
}

// ============================================================================
// SECTION: GEOMETRY SIGNATURE (CARGO)
// ============================================================================

/**
 * Physical signature of a Case definition: shape plus canonical dimensions. Stored on every
 * cargo anchor so a later change is detected and never silently re-anchored.
 * @param {any} caseData
 * @returns {{ shape: string, length: number, width: number, height: number } | null}
 */
export function getCargoGeometrySignature(caseData) {
  const dims = caseData && caseData.dimensions;
  if (!isRecord(dims) || !['length', 'width', 'height'].every(key => isPositiveNumber(dims[key]))) return null;
  const shape = String((caseData && caseData.shape) || 'box').trim().toLowerCase() || 'box';
  return { shape, length: dims.length, width: dims.width, height: dims.height };
}

function signaturesMatch(a, b) {
  return Boolean(a && b) && a.shape === b.shape &&
    Math.abs(a.length - b.length) <= SIGNATURE_EPSILON &&
    Math.abs(a.width - b.width) <= SIGNATURE_EPSILON &&
    Math.abs(a.height - b.height) <= SIGNATURE_EPSILON;
}

// ============================================================================
// SECTION: FACE MATH (CARGO-LOCAL FRAME)
// ============================================================================

// Local frame: X = Case length, Y = Case height, Z = Case width, origin at the cargo centre.
// New anchors store the local point directly (any shape). The face + (u, v) form is the earlier
// box-only encoding; it is still read so previously saved measurements keep resolving.
const FACE_FRAME = Object.freeze({
  '+x': { normal: 'x', sign: 1, u: 'z', v: 'y' },
  '-x': { normal: 'x', sign: -1, u: 'z', v: 'y' },
  '+y': { normal: 'y', sign: 1, u: 'x', v: 'z' },
  '-y': { normal: 'y', sign: -1, u: 'x', v: 'z' },
  '+z': { normal: 'z', sign: 1, u: 'x', v: 'y' },
  '-z': { normal: 'z', sign: -1, u: 'x', v: 'y' },
});

function halfExtents(signature) {
  return { x: signature.length / 2, y: signature.height / 2, z: signature.width / 2 };
}

/** Local (unrotated, centre-origin, inches) point for a face and normalized position. */
export function cargoLocalPointFromFace(face, u, v, signature) {
  const frame = FACE_FRAME[face];
  if (!frame || !signature) return null;
  const half = halfExtents(signature);
  const local = { x: 0, y: 0, z: 0 };
  local[frame.normal] = frame.sign * half[frame.normal];
  local[frame.u] = (u - 0.5) * 2 * half[frame.u];
  local[frame.v] = (v - 0.5) * 2 * half[frame.v];
  return local;
}

/**
 * Rotate a vector exactly as THREE.Euler order 'XYZ' (matrix Rx * Ry * Rz) does. Deliberately
 * not quantized so the result matches `group.rotation.set(x, y, z)` for any stored rotation.
 */
export function applyEulerXYZ(rotation, vector) {
  const a = Math.cos(rotation.x);
  const b = Math.sin(rotation.x);
  const c = Math.cos(rotation.y);
  const d = Math.sin(rotation.y);
  const e = Math.cos(rotation.z);
  const f = Math.sin(rotation.z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  return {
    x: c * e * vector.x - c * f * vector.y + d * vector.z,
    y: (af + be * d) * vector.x + (ae - bf * d) * vector.y - b * c * vector.z,
    z: (bf - ae * d) * vector.x + (be + af * d) * vector.y + a * c * vector.z,
  };
}

// ============================================================================
// SECTION: ANCHOR + RECORD CONSTRUCTION
// ============================================================================

/**
 * Anchor on any cargo surface, whatever its shape. `local` is the picked point in the cargo's local
 * frame (centre origin, inches), so it follows the cargo's translation and rotation.
 * @param {{ instanceId: string, local: { x: number, y: number, z: number }, caseData: any }} input
 * @returns {Record<string, any> | null} null when the Case has no usable geometry signature
 */
export function buildCargoAnchor({ instanceId, local, caseData }) {
  const signature = getCargoGeometrySignature(caseData);
  if (!signature || !instanceId || !local) return null;
  if (![local.x, local.y, local.z].every(isFiniteNumber)) return null;
  return {
    kind: 'cargo',
    instanceId: String(instanceId),
    local: { x: round(local.x, 4), y: round(local.y, 4), z: round(local.z, 4) },
    signature,
  };
}

/** Local (cargo-frame, inches) point of a cargo anchor, in either stored encoding. */
export function cargoAnchorLocal(anchor) {
  if (anchor && anchor.local) return anchor.local;
  return anchor ? cargoLocalPointFromFace(anchor.face, anchor.u, anchor.v, anchor.signature) : null;
}

/** @param {{ surface: string, point: { x: number, y: number, z: number } }} input */
export function buildFloorAnchor({ surface, point }) {
  if (!FLOOR_SURFACES.includes(surface) || !point) return null;
  if (![point.x, point.y, point.z].every(isFiniteNumber)) return null;
  return {
    kind: 'floor',
    surface,
    position: { x: round(point.x, 4), y: round(point.y, 4), z: round(point.z, 4) },
  };
}

/** Current truck signature used to detect that a truck-bound point no longer sits on its surface. */
export function getTruckSignature(truck) {
  const t = truck && typeof truck === 'object' ? truck : {};
  const num = value => (isFiniteNumber(Number(value)) ? Number(value) : 0);
  return {
    length: num(t.length),
    width: num(t.width),
    height: num(t.height),
    shapeMode: typeof t.shapeMode === 'string' ? t.shapeMode : 'rect',
  };
}

/**
 * Fixed point in the Load Plan's coordinate space (ground, truck wall/ceiling, or anywhere).
 * Truck-bound surfaces remember the truck so a later truck change is flagged, never relocated.
 * @param {{ surface: string, point: { x: number, y: number, z: number }, truck?: any }} input
 */
export function buildSpaceAnchor({ surface, point, truck }) {
  if (!SPACE_SURFACES.includes(surface) || !point) return null;
  if (![point.x, point.y, point.z].every(isFiniteNumber)) return null;
  const anchor = {
    kind: 'space',
    surface,
    position: { x: round(point.x, 4), y: round(point.y, 4), z: round(point.z, 4) },
  };
  if (TRUCK_BOUND_SURFACES.has(surface)) anchor.truck = getTruckSignature(truck);
  return anchor;
}

export function normalizeMeasurementLabel(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim().slice(0, MAX_MEASUREMENT_LABEL_LENGTH);
  return text || null;
}

/**
 * Move one endpoint of a point-to-point record to a new, deliberately chosen anchor (the owner may
 * drag an endpoint onto any supported surface, so the anchor kind may change). Pure: the stored
 * record is never mutated, an invalid anchor yields null and nothing is written, and the label,
 * identity and creation time are preserved. The distance is still derived, never stored.
 * @param {Record<string, any>} record
 * @param {'start' | 'end'} which
 * @param {Record<string, any>} anchor
 * @param {number} now
 * @returns {Record<string, any> | null}
 */
export function replaceMeasurementEndpoint(record, which, anchor, now) {
  if (which !== 'start' && which !== 'end') return null;
  if (!isRecord(record) || record.type !== MEASUREMENT_TYPE_POINT_TO_POINT) return null;
  if (!isFiniteNumber(now) || validateAnchor(anchor, which)) return null;
  const next = { ...record, [which]: anchor, updatedAt: now };
  return validatePointRecord(next) ? null : canonicalPointRecord(next);
}

/** New point-to-point record. `id` and `now` are injected so callers own identity and time. */
export function createMeasurementRecord({ id, start, end, label = null, now }) {
  return {
    id: String(id),
    type: MEASUREMENT_TYPE_POINT_TO_POINT,
    label: normalizeMeasurementLabel(label),
    start,
    end,
    createdAt: now,
    updatedAt: now,
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
  };
}

// ============================================================================
// SECTION: VALIDATION
// ============================================================================

function validateSignature(signature) {
  if (!isRecord(signature)) return 'signature must be an object';
  if (typeof signature.shape !== 'string' || !signature.shape.trim() || signature.shape.length > 24) {
    return 'signature.shape is invalid';
  }
  if (!['length', 'width', 'height'].every(key => isPositiveNumber(signature[key]))) {
    return 'signature dimensions must be positive numbers';
  }
  return null;
}

function validateAnchor(anchor, label) {
  if (!isRecord(anchor)) return `${label} must be an object`;
  if (anchor.kind === 'cargo') {
    if (typeof anchor.instanceId !== 'string' || !anchor.instanceId.trim() ||
        anchor.instanceId.length > MAX_INSTANCE_ID_LENGTH) return `${label}.instanceId is invalid`;
    if (anchor.local !== undefined) {
      const local = anchor.local;
      if (!isRecord(local) || ![local.x, local.y, local.z].every(isFiniteNumber)) {
        return `${label}.local must have finite x, y and z`;
      }
    } else {
      if (!BOX_FACES.includes(anchor.face)) return `${label}.face is invalid`;
      if (![anchor.u, anchor.v].every(n => isFiniteNumber(n) && n >= 0 && n <= 1)) {
        return `${label}.u and ${label}.v must be numbers from 0 to 1`;
      }
    }
    const signatureError = validateSignature(anchor.signature);
    return signatureError ? `${label}.${signatureError}` : null;
  }
  if (anchor.kind === 'space') {
    if (!SPACE_SURFACES.includes(anchor.surface)) return `${label}.surface is invalid`;
    const position = anchor.position;
    if (!isRecord(position) || ![position.x, position.y, position.z].every(isFiniteNumber)) {
      return `${label}.position must have finite x, y and z`;
    }
    if (TRUCK_BOUND_SURFACES.has(anchor.surface)) {
      const truck = anchor.truck;
      if (!isRecord(truck) || !['length', 'width', 'height'].every(key => isFiniteNumber(truck[key])) ||
          typeof truck.shapeMode !== 'string') return `${label}.truck is invalid`;
    }
    return null;
  }
  if (anchor.kind === 'floor') {
    if (!FLOOR_SURFACES.includes(anchor.surface)) return `${label}.surface is invalid`;
    const position = anchor.position;
    if (!isRecord(position) || ![position.x, position.y, position.z].every(isFiniteNumber)) {
      return `${label}.position must have finite x, y and z`;
    }
    return position.y < -FLOOR_EPSILON ? `${label}.position.y must not be negative` : null;
  }
  return `${label}.kind must be "cargo", "floor" or "space"`;
}

function validateRecordId(record) {
  return typeof record.id === 'string' && record.id.trim() && record.id.length <= MAX_ID_LENGTH
    ? null : 'id is invalid';
}

function validatePointRecord(record) {
  if (!isRecord(record)) return 'record must be an object';
  const idError = validateRecordId(record);
  if (idError) return idError;
  if (record.type !== MEASUREMENT_TYPE_POINT_TO_POINT) return 'type is not supported';
  if (record.schemaVersion !== MEASUREMENT_SCHEMA_VERSION) return 'schemaVersion is not supported';
  if (record.label != null && (typeof record.label !== 'string' ||
      record.label.length > MAX_MEASUREMENT_LABEL_LENGTH)) return 'label is invalid';
  if (!isFiniteNumber(record.createdAt) || !isFiniteNumber(record.updatedAt)) return 'timestamps are invalid';
  return validateAnchor(record.start, 'start') || validateAnchor(record.end, 'end');
}

function validateRecoveryRecord(record) {
  if (!isRecord(record)) return 'record must be an object';
  const idError = validateRecordId(record);
  if (idError) return idError;
  if (record.type !== MEASUREMENT_TYPE_UNREADABLE) return 'type is not unreadable';
  if (typeof record.reason !== 'string') return 'reason is invalid';
  return Object.hasOwn(record, 'original') ? null : 'original is missing';
}

function canonicalAnchor(anchor) {
  if (anchor.kind === 'cargo') {
    const base = {
      kind: 'cargo',
      instanceId: anchor.instanceId,
      signature: {
        shape: anchor.signature.shape,
        length: anchor.signature.length,
        width: anchor.signature.width,
        height: anchor.signature.height,
      },
    };
    if (anchor.local !== undefined) return { ...base, local: { x: anchor.local.x, y: anchor.local.y, z: anchor.local.z } };
    return { ...base, face: anchor.face, u: anchor.u, v: anchor.v };
  }
  if (anchor.kind === 'space') {
    const position = { x: anchor.position.x, y: anchor.position.y, z: anchor.position.z };
    return TRUCK_BOUND_SURFACES.has(anchor.surface)
      ? { kind: 'space', surface: anchor.surface, position, truck: { ...getTruckSignature(anchor.truck) } }
      : { kind: 'space', surface: anchor.surface, position };
  }
  return {
    kind: 'floor',
    surface: anchor.surface,
    position: { x: anchor.position.x, y: anchor.position.y, z: anchor.position.z },
  };
}

function canonicalPointRecord(record) {
  return {
    id: record.id,
    type: MEASUREMENT_TYPE_POINT_TO_POINT,
    label: record.label == null ? null : record.label,
    start: canonicalAnchor(record.start),
    end: canonicalAnchor(record.end),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
  };
}

function canonicalRecoveryRecord(record) {
  return {
    id: record.id,
    type: MEASUREMENT_TYPE_UNREADABLE,
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
    reason: record.reason,
    original: cloneJson(record.original),
  };
}

function uniqueId(base, used) {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}~${n++}`.slice(-MAX_ID_LENGTH);
  return id;
}

function wrapUnreadable(original, index, reason, used) {
  const sourceId = isRecord(original) && typeof original.id === 'string' && original.id.trim()
    ? original.id.trim().slice(0, MAX_ID_LENGTH - 8) : `unreadable-${index + 1}`;
  const id = uniqueId(sourceId, used);
  used.add(id);
  return {
    id,
    type: MEASUREMENT_TYPE_UNREADABLE,
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
    reason,
    original: cloneJson(original),
  };
}

const normalizedCache = new WeakMap();

/**
 * Lenient, NEVER-DESTRUCTIVE normalization for stored data and export projection. A valid record is
 * kept in canonical form; anything else (malformed, unknown schema version, duplicate id, a
 * non-list container) is wrapped verbatim as an `unreadable` recovery record so the original data
 * is preserved, surfaced to the user, and written back unchanged. Nothing is dropped, coerced into
 * geometry or truncated. Missing/null input yields an empty collection (older Load Plans).
 * @param {unknown} raw
 * @returns {Array<Record<string, any>>}
 */
export function normalizeMeasurements(raw) {
  if (raw == null) return [];
  const cacheable = typeof raw === 'object';
  if (cacheable && normalizedCache.has(raw)) return normalizedCache.get(raw);
  const used = new Set();
  let out;
  if (!Array.isArray(raw)) {
    out = [wrapUnreadable(raw, 0, 'The saved measurement list could not be read.', used)];
  } else {
    out = [];
    raw.forEach((entry, index) => {
      const pointError = validatePointRecord(entry);
      if (!pointError) {
        if (used.has(entry.id)) {
          out.push(wrapUnreadable(entry, index, 'Duplicate measurement ID in this Load Plan.', used));
          return;
        }
        used.add(entry.id);
        out.push(canonicalPointRecord(entry));
        return;
      }
      if (!validateRecoveryRecord(entry) && !used.has(entry.id)) {
        used.add(entry.id);
        out.push(canonicalRecoveryRecord(entry));
        return;
      }
      const reason = isRecord(entry) && entry.schemaVersion > MEASUREMENT_SCHEMA_VERSION
        ? 'Saved by a newer version of the app.'
        : 'The saved measurement could not be read.';
      out.push(wrapUnreadable(entry, index, reason, used));
    });
  }
  if (cacheable) {
    normalizedCache.set(raw, out);
    normalizedCache.set(out, out);
  }
  return out;
}

/**
 * Strict validation for import and restore. A structurally valid collection (point-to-point
 * records and explicit recovery records) is accepted, INCLUDING cargo anchors that reference
 * instances that do not exist (they resolve as Unresolved). Any malformed record, duplicate
 * measurement ID within the plan, or more than MAX_MEASUREMENTS_PER_PACK rejects the whole
 * collection; nothing is truncated or repaired.
 * @param {unknown} raw
 * @returns {{ ok: true, measurements: Array<Record<string, any>> } | { ok: false, error: string }}
 */
export function validateMeasurementCollection(raw) {
  if (raw == null) return { ok: true, measurements: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'expected an array' };
  if (raw.length > MAX_MEASUREMENTS_PER_PACK) {
    return { ok: false, error: `too many measurements (${raw.length}; maximum ${MAX_MEASUREMENTS_PER_PACK})` };
  }
  const ids = new Set();
  const measurements = [];
  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index];
    const pointError = validatePointRecord(entry);
    let canonical;
    if (!pointError) {
      canonical = canonicalPointRecord(entry);
    } else if (!validateRecoveryRecord(entry)) {
      canonical = canonicalRecoveryRecord(entry);
    } else {
      return { ok: false, error: `measurements[${index}] ${pointError}` };
    }
    if (ids.has(canonical.id)) {
      return { ok: false, error: `duplicate measurement id "${canonical.id}"` };
    }
    ids.add(canonical.id);
    measurements.push(canonical);
  }
  return { ok: true, measurements };
}

export function canAddMeasurement(measurements) {
  return normalizeMeasurements(measurements).length < MAX_MEASUREMENTS_PER_PACK;
}

// ============================================================================
// SECTION: INSTANCE-ID REMAPPING (DUPLICATE / IMPORT)
// ============================================================================

/**
 * Remap cargo anchors through a deterministic old-instance-ID to new-instance-ID map. An anchor
 * whose instance is not in the map is left exactly as it is (it stays Unresolved); a replacement
 * is never guessed. Floor anchors and recovery records are untouched.
 * @param {unknown} measurements
 * @param {Map<string, string> | Record<string, string>} idMap
 */
export function remapMeasurementInstanceIds(measurements, idMap) {
  const map = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));
  const remapAnchor = anchor => {
    if (!anchor || anchor.kind !== 'cargo' || !map.has(anchor.instanceId)) return anchor;
    return { ...anchor, instanceId: map.get(anchor.instanceId) };
  };
  return normalizeMeasurements(measurements).map(record => (
    record.type === MEASUREMENT_TYPE_POINT_TO_POINT
      ? { ...record, start: remapAnchor(record.start), end: remapAnchor(record.end) }
      : record
  ));
}

// ============================================================================
// SECTION: FLOOR SURFACES
// ============================================================================

/**
 * Supported truck floor surfaces from the authoritative usable zones: the floor of every usable
 * zone. Elevation 0 is the main floor; a raised floor is a Wheel Well top or the over-cab deck
 * depending on the truck shape. Walls, ceiling and end planes are `space` anchors (see
 * buildTruckShell); wheel-well side faces are not individually pickable.
 * @param {any} truck
 * @param {Array<{ min: {x:number,y:number,z:number}, max: {x:number,y:number,z:number} }>} zones
 */
export function buildFloorSurfaces(truck, zones) {
  const mode = truck && truck.shapeMode;
  return (Array.isArray(zones) ? zones : []).map(zone => ({
    surface: zone.min.y <= FLOOR_EPSILON ? 'main' : (mode === 'frontBonus' ? 'deck' : 'well-top'),
    elevation: zone.min.y,
    xMin: zone.min.x,
    xMax: zone.max.x,
    zMin: zone.min.z,
    zMax: zone.max.z,
  }));
}

/**
 * Outer envelope of the truck (all usable zones), used to pick walls, ceiling and the end planes.
 * @returns {{ xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number } | null}
 */
export function buildTruckShell(truck, zones) {
  const list = Array.isArray(zones) ? zones : [];
  if (!list.length) return null;
  return {
    xMin: Math.min(...list.map(z => z.min.x)),
    xMax: Math.max(...list.map(z => z.max.x)),
    yMin: Math.min(...list.map(z => z.min.y)),
    yMax: Math.max(...list.map(z => z.max.y)),
    zMin: Math.min(...list.map(z => z.min.z)),
    zMax: Math.max(...list.map(z => z.max.z)),
  };
}

function floorContains(floor, point) {
  return point.x >= floor.xMin - FLOOR_EPSILON && point.x <= floor.xMax + FLOOR_EPSILON &&
    point.z >= floor.zMin - FLOOR_EPSILON && point.z <= floor.zMax + FLOOR_EPSILON;
}

// ============================================================================
// SECTION: RESOLUTION + VALIDITY
// ============================================================================

const REASON_TEXT = Object.freeze({
  'cargo-missing': 'The cargo this point was placed on is no longer in this Load Plan.',
  'case-missing': 'The Case definition for this cargo is missing.',
  'case-changed': 'The Case size or shape changed. Delete and recreate this measurement to confirm it.',
  'pose-invalid': 'The cargo position or orientation could not be read.',
  'floor-missing': 'The floor surface for this point no longer exists.',
  'floor-changed': 'The floor at this point has changed. Delete and recreate this measurement to confirm it.',
  'truck-changed': 'The truck changed after this point was placed. Delete and recreate this measurement to confirm it.',
  unreadable: 'The saved data could not be read. The original is kept until you delete it.',
});

export function describeMeasurementReason(reason) {
  return REASON_TEXT[reason] || '';
}

export function measurementStatusLabel(status) {
  if (status === MEASUREMENT_STATUS.VALID) return 'Valid';
  if (status === MEASUREMENT_STATUS.NEEDS_REVIEW) return 'Needs review';
  return 'Unresolved';
}

/**
 * Committed world pose (inches) of a cargo instance, mirroring the scene's applyTransform:
 * translation is the stored centre, rotation is the stored Euler XYZ angles, transform.scale is
 * ignored, and the centre height is floored at half the oriented height.
 * @returns {{ center: {x:number,y:number,z:number}, rotation: {x:number,y:number,z:number} } | null}
 */
export function resolveCargoPose(instance, caseData) {
  const transform = instance && instance.transform;
  const position = transform && transform.position;
  const rotation = (transform && transform.rotation) || { x: 0, y: 0, z: 0 };
  if (!isRecord(position) || ![position.x, position.y, position.z].every(isFiniteNumber)) return null;
  if (![rotation.x, rotation.y, rotation.z].every(isFiniteNumber)) return null;
  const pose = getActualPoseDimensions(caseData, instance);
  const baseHeight = caseData && caseData.dimensions && caseData.dimensions.height;
  const halfHeight = pose.valid && pose.value ? pose.value.height / 2 : (isFiniteNumber(baseHeight) ? baseHeight / 2 : 0);
  const minimumY = halfHeight > 0 ? halfHeight : SCENE_FALLBACK_HALF_HEIGHT_INCHES;
  return {
    center: { x: position.x, y: Math.max(minimumY, position.y), z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
  };
}

/** World point (inches) of a cargo-local point under a committed pose. */
export function cargoLocalToWorld(pose, local) {
  const rotated = applyEulerXYZ(pose.rotation, local);
  return { x: rotated.x + pose.center.x, y: rotated.y + pose.center.y, z: rotated.z + pose.center.z };
}

function unresolved(reason) {
  return { status: MEASUREMENT_STATUS.UNRESOLVED, reason, point: null };
}

function needsReview(reason) {
  return { status: MEASUREMENT_STATUS.NEEDS_REVIEW, reason, point: null };
}

/**
 * @param {Record<string, any>} anchor
 * @param {{ instance?: any, caseData?: any }} context
 */
export function resolveCargoAnchor(anchor, { instance, caseData }) {
  if (!instance) return unresolved('cargo-missing');
  if (!caseData) return unresolved('case-missing');
  if (!signaturesMatch(getCargoGeometrySignature(caseData), anchor.signature)) return needsReview('case-changed');
  const pose = resolveCargoPose(instance, caseData);
  if (!pose) return unresolved('pose-invalid');
  const local = cargoAnchorLocal(anchor);
  return { status: MEASUREMENT_STATUS.VALID, reason: null, point: cargoLocalToWorld(pose, local) };
}

/**
 * @param {Record<string, any>} anchor
 * @param {{ floors?: ReturnType<typeof buildFloorSurfaces> }} context
 */
export function resolveFloorAnchor(anchor, { floors }) {
  const point = anchor.position;
  const surfaces = Array.isArray(floors) ? floors : [];
  const exact = surfaces.find(floor => floor.surface === anchor.surface &&
    Math.abs(floor.elevation - point.y) <= FLOOR_EPSILON && floorContains(floor, point));
  if (exact) return { status: MEASUREMENT_STATUS.VALID, reason: null, point: { x: point.x, y: point.y, z: point.z } };
  // The same spot is still on a floor, but not the one that was measured: never relocate.
  return surfaces.some(floor => floorContains(floor, point)) ? needsReview('floor-changed') : unresolved('floor-missing');
}

/**
 * A fixed-space point never moves. Ground and free points are always Valid; a point on the truck
 * shell is Valid only while the truck is the one it was placed on, otherwise Needs Review (the
 * point is never relocated onto the new truck).
 * @param {Record<string, any>} anchor
 * @param {{ truck?: any }} context
 */
export function resolveSpaceAnchor(anchor, { truck }) {
  const point = { x: anchor.position.x, y: anchor.position.y, z: anchor.position.z };
  if (!TRUCK_BOUND_SURFACES.has(anchor.surface)) return { status: MEASUREMENT_STATUS.VALID, reason: null, point };
  const stored = anchor.truck;
  const current = getTruckSignature(truck);
  const same = stored && stored.length === current.length && stored.width === current.width &&
    stored.height === current.height && stored.shapeMode === current.shapeMode;
  return same ? { status: MEASUREMENT_STATUS.VALID, reason: null, point } : needsReview('truck-changed');
}

export function resolveAnchor(anchor, context) {
  if (anchor.kind === 'cargo') return resolveCargoAnchor(anchor, context);
  if (anchor.kind === 'space') return resolveSpaceAnchor(anchor, context);
  return resolveFloorAnchor(anchor, context);
}

function resolvedMeasurement(record) {
  return {
    id: record.id,
    status: MEASUREMENT_STATUS.UNRESOLVED,
    reason: 'unreadable',
    start: null,
    end: null,
    distance: null,
    delta: null,
  };
}

/**
 * Derived validity and geometry for one measurement. The distance exists only when both anchors
 * resolve; Needs Review and Unresolved never carry a number.
 * @param {Record<string, any>} record normalized record
 * @param {{ getInstance: (id: string) => any, getCase: (id: string) => any, floors: any[], truck?: any }} context
 */
export function resolveMeasurement(record, context) {
  if (record.type !== MEASUREMENT_TYPE_POINT_TO_POINT) return resolvedMeasurement(record);
  const resolveOne = anchor => {
    if (anchor.kind === 'cargo') {
      const instance = context.getInstance(anchor.instanceId);
      const caseData = instance ? context.getCase(instance.caseId) : null;
      return resolveCargoAnchor(anchor, { instance, caseData });
    }
    if (anchor.kind === 'space') return resolveSpaceAnchor(anchor, { truck: context.truck });
    return resolveFloorAnchor(anchor, { floors: context.floors });
  };
  const start = resolveOne(record.start);
  const end = resolveOne(record.end);
  const worst = [start, end].find(r => r.status === MEASUREMENT_STATUS.UNRESOLVED) ||
    [start, end].find(r => r.status === MEASUREMENT_STATUS.NEEDS_REVIEW);
  if (worst) {
    return { id: record.id, status: worst.status, reason: worst.reason, start: null, end: null, distance: null, delta: null };
  }
  return {
    id: record.id,
    status: MEASUREMENT_STATUS.VALID,
    reason: null,
    start: start.point,
    end: end.point,
    ...measureBetween(start.point, end.point),
  };
}

/** Straight-line 3D distance and absolute axis deltas between two world points (inches). */
export function measureBetween(a, b) {
  const delta = { x: Math.abs(b.x - a.x), y: Math.abs(b.y - a.y), z: Math.abs(b.z - a.z) };
  return { distance: Math.hypot(delta.x, delta.y, delta.z), delta };
}

/** @returns {Array<ReturnType<typeof resolveMeasurement>>} one result per normalized record, in order */
export function resolveMeasurementList(measurements, context) {
  return normalizeMeasurements(measurements).map(record => resolveMeasurement(record, context));
}

// ============================================================================
// SECTION: DISPLAY
// ============================================================================

const DISPLAY_DECIMALS = Object.freeze({ in: 1, ft: 2, cm: 1, m: 3 });

/** Measurement-specific length text. The whole-inch app formatter is too coarse for a ruler. */
export function formatMeasurementLength(inches, unit = 'in') {
  const key = Object.hasOwn(DISPLAY_DECIMALS, unit) ? unit : 'in';
  const value = inchesToUnit(inches, key);
  return Number.isFinite(value) ? `${value.toFixed(DISPLAY_DECIMALS[key])} ${key}` : '—';
}

export function defaultMeasurementName(index) {
  return `Measurement ${index + 1}`;
}
