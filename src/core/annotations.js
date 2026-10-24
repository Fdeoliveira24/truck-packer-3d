/**
 * @file annotations.js
 * @description Pure Annotations V1 data model (no THREE, no DOM). Owns the per-Load-Plan `annotations`
 *   collection: schema, strict and lenient validation, never-destructive normalization, derived
 *   validity, instance-ID remapping and the small text/format helpers the Editor UI shares.
 *
 *   An annotation is informational authored content ("this is what the crew should know here"). It never
 *   influences cargo, collision, handling rules, assessment, Space Utilization, AutoPack or the existing
 *   PDF. Annotations belong to exactly one Load Plan, are stored separately from cargo and measurements,
 *   and live outside cargo Undo/Redo (see core/state-store.js).
 *
 *   V1A stores one record type, `callout`: a titled note attached to a point on a supported surface.
 *   The point is a Measurement anchor (core/measurements.js) so the cargo identity policy, truck shell
 *   faces and surface validation are shared with the Measurement Tool, never re-implemented:
 *   - cargo: a point in the cargo's local frame + instance ID + geometry signature (follows the cargo);
 *   - floor: a supported truck floor surface, revalidated by geometry;
 *   - space: a fixed point (truck wall/ceiling/end plane, ground, open space).
 *   The card is placed relative to its marker by a screen-space offset (`offset`), so moving a card never
 *   moves the anchor or any cargo. Nothing derived is stored: status, number, face normal, occlusion and
 *   screen position are all recomputed.
 *
 *   V1B.1 adds `arrow`: a directional line between two independent anchors (`start` is the tail, `end` the
 *   head). Each endpoint is a Measurement anchor of any kind, so an arrow can run from one cargo item to the
 *   floor or to another item, and each follows its own cargo identity. An arrow is drawable only while BOTH
 *   endpoints resolve as Valid; otherwise the record is kept and each endpoint explains itself.
 *
 *   A later release adds `draw`. A record this version does not understand (including that) is kept
 *   verbatim as an `unreadable` recovery record, never dropped. A recovery record is inert: nothing here
 *   converts one back into an annotation, because the identity decisions that were made while it was
 *   wrapped (see carryAnnotationsThroughIdentity) cannot be re-established from the stored data.
 * @module core/annotations
 */

import {
  MEASUREMENT_STATUS,
  canonicalAnchorRecord,
  cargoAnchorLocal,
  instanceIdentityKey,
  resolveAnchor,
  validateAnchorRecord,
} from './measurements.js';

// ============================================================================
// SECTION: CONSTANTS
// ============================================================================

export const ANNOTATION_SCHEMA_VERSION = 1;
/** Every annotation type together (callouts, arrows and later drawings, plus recovery records) in one Load Plan. */
export const MAX_ANNOTATIONS_PER_PACK = 200;
export const ANNOTATION_TYPE_CALLOUT = 'callout';
export const ANNOTATION_TYPE_ARROW = 'arrow';
/** Wrapper that keeps an unreadable stored record verbatim so it is never silently dropped. */
export const ANNOTATION_TYPE_UNREADABLE = 'unreadable';
export const MAX_CALLOUT_TITLE_LENGTH = 48;
export const MAX_CALLOUT_DESCRIPTION_LENGTH = 140;
/** Largest card offset from its marker, in CSS pixels, in either axis. */
export const MAX_CARD_OFFSET_PX = 2000;
export const ANNOTATION_COLORS = Object.freeze(['ink', 'blue', 'green', 'red', 'violet']);
export const DEFAULT_ANNOTATION_COLOR = 'ink';
export const ANNOTATION_STATUS = MEASUREMENT_STATUS;
export const ARROW_WIDTHS = Object.freeze(['thin', 'regular', 'bold']);
export const DEFAULT_ARROW_WIDTH = 'regular';
/** A new or moved arrow must span at least this much between its resolved endpoints (inches). */
export const MIN_ARROW_LENGTH_INCHES = 0.5;

const MAX_ID_LENGTH = 64;
/** Record types a later release writes. An older build keeps them untouched and says why. */
const FUTURE_TYPES = new Set(['draw']);
/** The only top-level keys an arrow may carry; any other key makes the record unreadable, never dropped. */
const ARROW_KEYS = new Set(['id', 'type', 'schemaVersion', 'color', 'width', 'hidden', 'start', 'end', 'createdAt', 'updatedAt']);

/**
 * Optional starting texts for the callout editor. Picking one only fills the title and description,
 * which stay editable; the preset itself is never stored and carries no meaning for cargo or any rule.
 */
export const CALLOUT_PRESETS = Object.freeze([
  Object.freeze({ key: 'Fragile', title: 'FRAGILE', description: 'Handle with care. Check packaging before loading.' }),
  Object.freeze({ key: 'Unload First', title: 'UNLOAD FIRST', description: 'Place near rear doors. Required at first delivery stop.' }),
  Object.freeze({ key: 'This Side Up', title: 'THIS SIDE UP', description: 'Keep upright during loading and transport.' }),
  Object.freeze({ key: 'Heavy', title: 'HEAVY', description: 'Use two people or a lift. Check weight before moving.' }),
  Object.freeze({ key: 'Customer Pickup', title: 'CUSTOMER PICKUP', description: 'Keep accessible for scheduled collection.' }),
]);

// ============================================================================
// SECTION: SMALL HELPERS
// ============================================================================

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, digits = 1) {
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

/** One line of text: whitespace runs (including line breaks) collapse to a single space. */
function collapseText(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

export function normalizeCalloutTitle(value) {
  return collapseText(value).slice(0, MAX_CALLOUT_TITLE_LENGTH).trim();
}

/** @returns {string | null} null when empty */
export function normalizeCalloutDescription(value) {
  const text = collapseText(value).slice(0, MAX_CALLOUT_DESCRIPTION_LENGTH).trim();
  return text || null;
}

// #111318 as a relative luminance (sRGB), and the contrast every number on a marker must reach.
const NEAR_BLACK_LUMINANCE = 0.0066;
const MIN_NUMBER_CONTRAST = 4.5;
const CUSTOM_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** True for a custom annotation color: exactly `#RRGGBB` (six hex digits, any case). */
export function isCustomAnnotationColor(value) {
  return typeof value === 'string' && CUSTOM_COLOR_PATTERN.test(value);
}

/** True for a built-in color name or a custom `#RRGGBB` value. */
export function isValidAnnotationColor(value) {
  return ANNOTATION_COLORS.includes(value) || isCustomAnnotationColor(value);
}

/**
 * The stored form of a valid color: a built-in name unchanged, a custom color as lower-case `#rrggbb`.
 * Null for anything else, so a write can refuse it instead of quietly storing a different color.
 * @returns {string | null}
 */
export function canonicalAnnotationColor(value) {
  if (ANNOTATION_COLORS.includes(value)) return value;
  return isCustomAnnotationColor(value) ? value.toLowerCase() : null;
}

/** A color that is safe to draw: the canonical value, or the default for anything unrecognised (display only). */
export function normalizeAnnotationColor(value) {
  return canonicalAnnotationColor(value) || DEFAULT_ANNOTATION_COLOR;
}

/**
 * Foreground (number text) for a custom color. White or the app's near-black when either reaches 4.5:1;
 * otherwise pure black, which does for every background that neither of those serves (mid-tones).
 */
export function annotationForegroundFor(color) {
  if (!isCustomAnnotationColor(color)) return null;
  const channel = index => {
    const c = parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  const contrastWith = foregroundLuminance => (Math.max(luminance, foregroundLuminance) + 0.05) / (Math.min(luminance, foregroundLuminance) + 0.05);
  for (const [foreground, foregroundLuminance] of [['#ffffff', 1], ['#111318', NEAR_BLACK_LUMINANCE]]) {
    if (contrastWith(foregroundLuminance) >= MIN_NUMBER_CONTRAST) return foreground;
  }
  return '#000000';
}

/** A stored or requested card offset, validated and rounded; null means "placed automatically". */
export function normalizeCardOffset(value) {
  if (!isRecord(value) || !isFiniteNumber(value.dx) || !isFiniteNumber(value.dy)) return null;
  if (Math.abs(value.dx) > MAX_CARD_OFFSET_PX || Math.abs(value.dy) > MAX_CARD_OFFSET_PX) return null;
  return { dx: round(value.dx), dy: round(value.dy) };
}

// ============================================================================
// SECTION: RECORD CONSTRUCTION
// ============================================================================

/**
 * New callout record. Text is normalized here; `id` and `now` are injected so callers own identity and
 * time. The record is not validated: callers pass it through validateAnnotationCollection.
 * @param {{ id: string, anchor: Record<string, any>, title: string, description?: string | null,
 *   color?: string, keepExpanded?: boolean, hidden?: boolean, offset?: { dx: number, dy: number } | null, now: number }} input
 */
export function createCalloutRecord({ id, anchor, title, description = null, color = DEFAULT_ANNOTATION_COLOR, keepExpanded = false, hidden = false, offset = null, now }) {
  return {
    id: String(id),
    type: ANNOTATION_TYPE_CALLOUT,
    title: normalizeCalloutTitle(title),
    description: normalizeCalloutDescription(description),
    // An invalid color is kept as given so the validation gate refuses the write; it is never replaced.
    color: canonicalAnnotationColor(color) || color,
    keepExpanded: keepExpanded === true,
    hidden: hidden === true,
    anchor,
    offset: normalizeCardOffset(offset),
    createdAt: now,
    updatedAt: now,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
  };
}

/**
 * Pure edit of a callout's text and presentation. Unknown patch keys are ignored; the anchor, identity and
 * creation time are preserved. Null when the result would not be a valid callout (for example an empty title).
 * @param {Record<string, any>} record
 * @param {{ title?: string, description?: string | null, color?: string, keepExpanded?: boolean, hidden?: boolean }} patch
 * @param {number} now
 */
export function editCalloutRecord(record, patch, now) {
  if (!isRecord(record) || record.type !== ANNOTATION_TYPE_CALLOUT || !isFiniteNumber(now) || !isRecord(patch)) return null;
  /** @type {Record<string, any>} */
  const next = { ...record, updatedAt: now };
  if (Object.hasOwn(patch, 'title')) next.title = normalizeCalloutTitle(patch.title);
  if (Object.hasOwn(patch, 'description')) next.description = normalizeCalloutDescription(patch.description);
  if (Object.hasOwn(patch, 'color')) next.color = canonicalAnnotationColor(patch.color) || patch.color;
  if (Object.hasOwn(patch, 'keepExpanded')) next.keepExpanded = patch.keepExpanded === true;
  if (Object.hasOwn(patch, 'hidden')) next.hidden = patch.hidden === true;
  return validateCalloutRecord(next) ? null : canonicalCalloutRecord(next);
}

/**
 * Move a callout's marker to a new, deliberately chosen anchor (the owner dragged the marker, or
 * re-attached the callout). The card offset is kept, so the card travels with the marker.
 */
export function reattachCalloutRecord(record, anchor, now) {
  if (!isRecord(record) || record.type !== ANNOTATION_TYPE_CALLOUT || !isFiniteNumber(now)) return null;
  if (validateAnchorRecord(anchor, 'anchor')) return null;
  const next = { ...record, anchor, updatedAt: now };
  return validateCalloutRecord(next) ? null : canonicalCalloutRecord(next);
}

/** Set (or with null, clear) the card's screen offset from its marker. Nothing else changes. */
export function offsetCalloutRecord(record, offset, now) {
  if (!isRecord(record) || record.type !== ANNOTATION_TYPE_CALLOUT || !isFiniteNumber(now)) return null;
  if (offset !== null && !normalizeCardOffset(offset)) return null;
  const next = { ...record, offset: offset === null ? null : normalizeCardOffset(offset), updatedAt: now };
  return validateCalloutRecord(next) ? null : canonicalCalloutRecord(next);
}

/**
 * New arrow record: `start` is the tail, `end` the head. `id` and `now` are injected so callers own identity
 * and time. The record is not validated (an invalid color or width is kept as given, so the gate refuses it
 * instead of storing a different value); callers pass it through validateAnnotationCollection.
 * @param {{ id: string, start: Record<string, any>, end: Record<string, any>, color?: string, width?: string,
 *   hidden?: boolean, now: number }} input
 */
export function createArrowRecord({ id, start, end, color = DEFAULT_ANNOTATION_COLOR, width = DEFAULT_ARROW_WIDTH, hidden = false, now }) {
  return {
    id: String(id),
    type: ANNOTATION_TYPE_ARROW,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    color: canonicalAnnotationColor(color) || color,
    width,
    hidden: hidden === true,
    start,
    end,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Pure edit of an arrow's presentation. Unknown patch keys are ignored; the endpoints, identity and creation
 * time are preserved. Null when the result would not be a valid arrow (for example an unknown width).
 * @param {Record<string, any>} record
 * @param {{ color?: string, width?: string, hidden?: boolean }} patch
 * @param {number} now
 */
export function editArrowRecord(record, patch, now) {
  if (!isRecord(record) || record.type !== ANNOTATION_TYPE_ARROW || !isFiniteNumber(now) || !isRecord(patch)) return null;
  /** @type {Record<string, any>} */
  const next = { ...record, updatedAt: now };
  if (Object.hasOwn(patch, 'color')) next.color = canonicalAnnotationColor(patch.color) || patch.color;
  if (Object.hasOwn(patch, 'width')) next.width = patch.width;
  if (Object.hasOwn(patch, 'hidden')) next.hidden = patch.hidden === true;
  return validateArrowRecord(next) ? null : canonicalArrowRecord(next);
}

/**
 * Replace one endpoint with a new, deliberately chosen anchor (a grip drag or Re-attach). The other endpoint,
 * the presentation, the identity and the creation time are preserved. Null for an unknown endpoint name or a
 * result that is not a valid arrow (an invalid anchor, or both endpoints naming the same point).
 * @param {Record<string, any>} record
 * @param {'start' | 'end'} which
 * @param {Record<string, any>} anchor
 * @param {number} now
 */
export function replaceArrowEndpoint(record, which, anchor, now) {
  if (which !== 'start' && which !== 'end') return null;
  if (!isRecord(record) || record.type !== ANNOTATION_TYPE_ARROW || !isFiniteNumber(now)) return null;
  const next = { ...record, [which]: anchor, updatedAt: now };
  return validateArrowRecord(next) ? null : canonicalArrowRecord(next);
}

// ============================================================================
// SECTION: VALIDATION
// ============================================================================

function validateRecordId(record) {
  return typeof record.id === 'string' && record.id.trim() && record.id.length <= MAX_ID_LENGTH
    ? null : 'id is invalid';
}

/** @returns {string | null} the first problem with a stored callout, or null when it is a valid callout */
export function validateCalloutRecord(record) {
  if (!isRecord(record)) return 'record must be an object';
  const idError = validateRecordId(record);
  if (idError) return idError;
  if (record.type !== ANNOTATION_TYPE_CALLOUT) return 'type is not supported';
  if (record.schemaVersion !== ANNOTATION_SCHEMA_VERSION) return 'schemaVersion is not supported';
  if (typeof record.title !== 'string' || !record.title.trim() || record.title.length > MAX_CALLOUT_TITLE_LENGTH) {
    return 'title is invalid';
  }
  if (record.description != null && (typeof record.description !== 'string' ||
      record.description.length > MAX_CALLOUT_DESCRIPTION_LENGTH)) return 'description is invalid';
  if (!isValidAnnotationColor(record.color)) return 'color is invalid';
  if (typeof record.keepExpanded !== 'boolean' || typeof record.hidden !== 'boolean') return 'display flags are invalid';
  if (record.offset != null) {
    const { offset } = record;
    if (!isRecord(offset) || !isFiniteNumber(offset.dx) || !isFiniteNumber(offset.dy) ||
        Math.abs(offset.dx) > MAX_CARD_OFFSET_PX || Math.abs(offset.dy) > MAX_CARD_OFFSET_PX) return 'offset is invalid';
  }
  if (!isFiniteNumber(record.createdAt) || !isFiniteNumber(record.updatedAt)) return 'timestamps are invalid';
  return validateAnchorRecord(record.anchor, 'anchor');
}

/**
 * Strict structural validity of a stored arrow. It judges the record only: whether the cargo an endpoint
 * names still exists, or how long the arrow currently is, are derived and never decide validity. An
 * unsupported top-level key is a problem (the record is then kept verbatim as unreadable) rather than
 * something to drop, so nothing a newer or damaged writer stored is silently lost.
 * @returns {string | null} the first problem with a stored arrow, or null when it is a valid arrow
 */
export function validateArrowRecord(record) {
  if (!isRecord(record)) return 'record must be an object';
  const idError = validateRecordId(record);
  if (idError) return idError;
  if (record.type !== ANNOTATION_TYPE_ARROW) return 'type is not supported';
  if (record.schemaVersion !== ANNOTATION_SCHEMA_VERSION) return 'schemaVersion is not supported';
  if (Object.keys(record).some(key => !ARROW_KEYS.has(key))) return 'record has an unsupported field';
  if (!isValidAnnotationColor(record.color)) return 'color is invalid';
  if (!ARROW_WIDTHS.includes(record.width)) return 'width is invalid';
  if (typeof record.hidden !== 'boolean') return 'display flags are invalid';
  if (!isFiniteNumber(record.createdAt) || !isFiniteNumber(record.updatedAt)) return 'timestamps are invalid';
  const anchorError = validateAnchorRecord(record.start, 'start') || validateAnchorRecord(record.end, 'end');
  if (anchorError) return anchorError;
  return JSON.stringify(canonicalAnchorRecord(record.start)) === JSON.stringify(canonicalAnchorRecord(record.end))
    ? 'start and end are the same point' : null;
}

function validateRecoveryRecord(record) {
  if (!isRecord(record)) return 'record must be an object';
  const idError = validateRecordId(record);
  if (idError) return idError;
  if (record.type !== ANNOTATION_TYPE_UNREADABLE) return 'type is not unreadable';
  if (typeof record.reason !== 'string') return 'reason is invalid';
  return Object.hasOwn(record, 'original') ? null : 'original is missing';
}

function canonicalCalloutRecord(record) {
  return {
    id: record.id,
    type: ANNOTATION_TYPE_CALLOUT,
    title: record.title,
    description: record.description == null ? null : record.description,
    color: canonicalAnnotationColor(record.color) || record.color,
    keepExpanded: record.keepExpanded,
    hidden: record.hidden,
    anchor: canonicalAnchorRecord(record.anchor),
    offset: record.offset == null ? null : { dx: record.offset.dx, dy: record.offset.dy },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
  };
}

function canonicalArrowRecord(record) {
  return {
    id: record.id,
    type: ANNOTATION_TYPE_ARROW,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    color: canonicalAnnotationColor(record.color) || record.color,
    width: record.width,
    hidden: record.hidden,
    start: canonicalAnchorRecord(record.start),
    end: canonicalAnchorRecord(record.end),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function canonicalRecoveryRecord(record) {
  return {
    id: record.id,
    type: ANNOTATION_TYPE_UNREADABLE,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
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
    type: ANNOTATION_TYPE_UNREADABLE,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    reason,
    original: cloneJson(original),
  };
}

function unreadableReason(entry) {
  if (isRecord(entry) && (entry.schemaVersion > ANNOTATION_SCHEMA_VERSION ||
      (typeof entry.type === 'string' && FUTURE_TYPES.has(entry.type)))) {
    return 'Saved by a newer version of the app.';
  }
  return 'The saved annotation could not be read.';
}

/**
 * The one place that knows which authored record types this version understands. A record of any other
 * type, or one that fails its own type's validation, reports that problem and is never repaired.
 * @returns {{ record: Record<string, any> | null, error: string | null }} exactly one of the two is set
 */
function readAuthoredRecord(entry) {
  if (isRecord(entry) && entry.type === ANNOTATION_TYPE_ARROW) {
    const error = validateArrowRecord(entry);
    return error ? { record: null, error } : { record: canonicalArrowRecord(entry), error: null };
  }
  const error = validateCalloutRecord(entry);
  return error ? { record: null, error } : { record: canonicalCalloutRecord(entry), error: null };
}

const normalizedCache = new WeakMap();

/**
 * Lenient, NEVER-DESTRUCTIVE normalization for stored data and export projection. A valid record is
 * kept in canonical form; anything else (malformed, unknown schema version or type, duplicate id, a
 * non-list container) is wrapped verbatim as an `unreadable` recovery record so the original data
 * is preserved, surfaced to the user, and written back unchanged. Nothing is dropped, coerced into
 * geometry or truncated. Missing/null input yields an empty collection (older Load Plans).
 * @param {unknown} raw
 * @returns {Array<Record<string, any>>}
 */
export function normalizeAnnotations(raw) {
  if (raw == null) return [];
  const cacheable = typeof raw === 'object';
  if (cacheable && normalizedCache.has(raw)) return normalizedCache.get(raw);
  const used = new Set();
  let out;
  if (!Array.isArray(raw)) {
    out = [wrapUnreadable(raw, 0, 'The saved annotation list could not be read.', used)];
  } else {
    out = [];
    raw.forEach((entry, index) => {
      const authored = readAuthoredRecord(entry);
      if (authored.record) {
        if (used.has(entry.id)) {
          out.push(wrapUnreadable(entry, index, 'Duplicate annotation ID in this Load Plan.', used));
          return;
        }
        used.add(entry.id);
        out.push(authored.record);
        return;
      }
      if (!validateRecoveryRecord(entry) && !used.has(entry.id)) {
        used.add(entry.id);
        out.push(canonicalRecoveryRecord(entry));
        return;
      }
      out.push(wrapUnreadable(entry, index, unreadableReason(entry), used));
    });
  }
  if (cacheable) {
    normalizedCache.set(raw, out);
    normalizedCache.set(out, out);
  }
  return out;
}

/**
 * Strict validation for import and restore. A structurally valid collection (callouts, arrows and explicit
 * recovery records) is accepted, INCLUDING cargo anchors that reference instances that do not exist
 * (they resolve as Unresolved). Any malformed record, a record type this version does not write (such as
 * `draw`), a duplicate annotation ID within the plan, or more than MAX_ANNOTATIONS_PER_PACK rejects the
 * whole collection; nothing is truncated or repaired.
 * @param {unknown} raw
 * @returns {{ ok: true, annotations: Array<Record<string, any>> } | { ok: false, error: string }}
 */
export function validateAnnotationCollection(raw) {
  if (raw == null) return { ok: true, annotations: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'expected an array' };
  if (raw.length > MAX_ANNOTATIONS_PER_PACK) {
    return { ok: false, error: `too many annotations (${raw.length}; maximum ${MAX_ANNOTATIONS_PER_PACK})` };
  }
  const ids = new Set();
  const annotations = [];
  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index];
    const authored = readAuthoredRecord(entry);
    let canonical;
    if (authored.record) {
      canonical = authored.record;
    } else if (!validateRecoveryRecord(entry)) {
      canonical = canonicalRecoveryRecord(entry);
    } else {
      return { ok: false, error: `annotations[${index}] ${authored.error}` };
    }
    if (ids.has(canonical.id)) {
      return { ok: false, error: `duplicate annotation id "${canonical.id}"` };
    }
    ids.add(canonical.id);
    annotations.push(canonical);
  }
  return { ok: true, annotations };
}

// ============================================================================
// SECTION: INSTANCE-ID REMAPPING (DUPLICATE / IMPORT / NORMALIZATION)
// ============================================================================

/** The anchors a record is attached to: one for a callout, two independent ones for an arrow, none for a recovery record. */
function anchorsOf(record) {
  if (record.type === ANNOTATION_TYPE_CALLOUT) return [record.anchor];
  if (record.type === ANNOTATION_TYPE_ARROW) return [record.start, record.end];
  return [];
}

/** The anchor itself when the map has no different instance for it; a floor or space anchor never has one. */
function remapAnchorInstance(anchor, map) {
  if (anchor.kind !== 'cargo') return anchor;
  const key = instanceIdentityKey(anchor.instanceId);
  const next = key === null ? undefined : map.get(key);
  return next === undefined || next === anchor.instanceId ? anchor : { ...anchor, instanceId: next };
}

/**
 * Remap cargo anchors through a deterministic old-instance-ID to new-instance-ID map keyed by the shared
 * identity key (instanceIdentityKey in core/measurements.js), so an anchor naming `" cargo "` follows the
 * instance the map knows as `"cargo"`. An arrow's two endpoints are remapped independently, each by its
 * own cargo. An anchor whose instance is not in the map is left exactly as it is (it stays Unresolved); a
 * replacement is never guessed. Floor and space anchors and recovery records are untouched. If nothing
 * changes the normalized list itself is returned.
 * @param {unknown} annotations
 * @param {Map<string, string> | Record<string, string>} idMap
 */
export function remapAnnotationInstanceIds(annotations, idMap) {
  const map = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));
  const records = normalizeAnnotations(annotations);
  const remapped = records.map(record => {
    if (record.type === ANNOTATION_TYPE_CALLOUT) {
      const anchor = remapAnchorInstance(record.anchor, map);
      return anchor === record.anchor ? record : { ...record, anchor };
    }
    if (record.type === ANNOTATION_TYPE_ARROW) {
      const start = remapAnchorInstance(record.start, map);
      const end = remapAnchorInstance(record.end, map);
      return start === record.start && end === record.end ? record : { ...record, start, end };
    }
    return record;
  });
  return remapped.every((record, index) => record === records[index]) ? records : remapped;
}

const CONTESTED_IDENTITY_REASON =
  'The cargo this annotation was placed on shared its ID with another cargo item in the source, so which one it meant cannot be determined. The original is kept.';

/**
 * Carries a Load Plan's annotations through the cargo identity decision made by canonicalizeInstanceIds
 * (core/measurements.js), as one step so neither half can be forgotten: anchors naming a canonicalized
 * instance follow it, and an annotation anchored on a CONTESTED key (an ID the source gave to several
 * items, of which only one survived) is withheld whole and verbatim into the unreadable recovery record,
 * so the surviving cargo never inherits the reference. An arrow is withheld whole when EITHER endpoint is
 * on a contested key (the other endpoint's remap is discarded with it: the wrapper keeps the record as
 * it came in). Nothing here ever unwraps a recovery record, and the wrapper is not inspected: its
 * contents were not carried through any earlier identity decision, so it cannot be trusted to name the
 * cargo it appears to name.
 * @param {unknown} rawAnnotations the stored annotations as they came in
 * @param {{ idMap: Map<string, string>, contestedKeys: Set<string> }} identity from canonicalizeInstanceIds
 */
export function carryAnnotationsThroughIdentity(rawAnnotations, identity) {
  const records = remapAnnotationInstanceIds(rawAnnotations, identity.idMap);
  if (!identity.contestedKeys.size) return records;
  const contested = record => anchorsOf(record).some(anchor => anchor.kind === 'cargo' &&
    identity.contestedKeys.has(instanceIdentityKey(anchor.instanceId)));
  const targets = new Set(records.flatMap((record, index) => (contested(record) ? [index] : [])));
  if (!targets.size) return records;
  // normalizeAnnotations yields one record per stored entry, so the stored entry at the same position is
  // the original; the (already canonical) record stands in only if that alignment ever fails.
  const aligned = Array.isArray(rawAnnotations) && rawAnnotations.length === records.length;
  const used = new Set(records.filter((_, index) => !targets.has(index)).map(record => record.id));
  return records.map((record, index) => (targets.has(index)
    ? wrapUnreadable(aligned ? rawAnnotations[index] : record, index, CONTESTED_IDENTITY_REASON, used)
    : record));
}

// ============================================================================
// SECTION: RESOLUTION + VALIDITY
// ============================================================================

const REASON_TEXT = Object.freeze({
  'cargo-missing': 'The cargo this callout was attached to is no longer in this Load Plan. Re-attach it to another surface, or delete it.',
  'cargo-ambiguous': 'More than one cargo item in this Load Plan has the same ID, so the cargo this callout belongs to cannot be identified.',
  'case-missing': 'The Case definition for this cargo is missing, so where this callout points cannot be checked.',
  'case-changed': 'The Case size or shape changed, so this callout may no longer point to the right place. Re-attach it to confirm.',
  'pose-invalid': 'The cargo position or orientation could not be read.',
  'floor-missing': 'The floor surface for this callout no longer exists. Re-attach it to another surface, or delete it.',
  'floor-changed': 'The floor at this spot has changed. Re-attach this callout to confirm it.',
  'truck-changed': 'The truck changed after this callout was placed. Re-attach it to confirm.',
  'truck-unverified': 'The truck this callout was placed on cannot be confirmed. Re-attach it to confirm.',
  'point-invalid': 'The position of this callout could not be calculated.',
  unreadable: 'The saved data could not be read. The original is kept until you delete it.',
});

export function describeAnnotationReason(reason) {
  return REASON_TEXT[reason] || '';
}

export function annotationStatusLabel(status) {
  if (status === ANNOTATION_STATUS.VALID) return 'Valid';
  if (status === ANNOTATION_STATUS.NEEDS_REVIEW) return 'Needs review';
  return 'Unresolved';
}

function isFinitePoint(point) {
  return Boolean(point) && [point.x, point.y, point.z].every(isFiniteNumber);
}

/**
 * Derived validity and committed position (inches) for one annotation. A position exists only when the
 * anchor resolves; Needs Review and Unresolved never carry one (nothing is fabricated or relocated).
 * An arrow has no single `point`: it reports `start` and `end` positions (both or neither) plus the
 * status and reason of each endpoint.
 * @param {Record<string, any>} record normalized record
 * @param {Parameters<typeof resolveAnchor>[1]} context the same context the Measurement Tool resolves with
 * @returns {{ id: string, status: string, reason: string | null, point: { x: number, y: number, z: number } | null,
 *   start?: { x: number, y: number, z: number } | null, end?: { x: number, y: number, z: number } | null,
 *   startStatus?: string, endStatus?: string, startReason?: string | null, endReason?: string | null }}
 */
export function resolveAnnotation(record, context) {
  if (record.type === ANNOTATION_TYPE_ARROW) return resolveArrow(record, context);
  if (record.type !== ANNOTATION_TYPE_CALLOUT) {
    return { id: record.id, status: ANNOTATION_STATUS.UNRESOLVED, reason: 'unreadable', point: null };
  }
  const resolution = resolveAnchor(record.anchor, context);
  if (resolution.status !== ANNOTATION_STATUS.VALID) {
    return { id: record.id, status: resolution.status, reason: resolution.reason, point: null };
  }
  // A pose can place cargo anywhere: Valid always carries a finite position.
  if (!isFinitePoint(resolution.point)) {
    return { id: record.id, status: ANNOTATION_STATUS.UNRESOLVED, reason: 'point-invalid', point: null };
  }
  return { id: record.id, status: ANNOTATION_STATUS.VALID, reason: null, point: resolution.point };
}

/**
 * Both endpoints of an arrow resolved separately. The whole arrow takes the worst endpoint's status
 * (Unresolved dominates Needs Review, as for a measurement) and carries positions only when BOTH are Valid,
 * so a half-resolved arrow can never be drawn as if it pointed somewhere. Each endpoint keeps its own
 * status and reason so the owner can see which end needs attention. A Valid endpoint whose position is not
 * a finite number counts as Unresolved (`point-invalid`).
 */
function resolveArrow(record, context) {
  const [start, end] = [record.start, record.end].map(anchor => {
    const resolution = resolveAnchor(anchor, context);
    return resolution.status === ANNOTATION_STATUS.VALID && !isFinitePoint(resolution.point)
      ? { status: ANNOTATION_STATUS.UNRESOLVED, reason: 'point-invalid', point: null } : resolution;
  });
  const endpoints = { startStatus: start.status, endStatus: end.status, startReason: start.reason, endReason: end.reason };
  const worst = [start, end].find(r => r.status === ANNOTATION_STATUS.UNRESOLVED) ||
    [start, end].find(r => r.status === ANNOTATION_STATUS.NEEDS_REVIEW);
  if (worst) {
    return { id: record.id, status: worst.status, reason: worst.reason, point: null, start: null, end: null, ...endpoints };
  }
  return { id: record.id, status: ANNOTATION_STATUS.VALID, reason: null, point: null, start: start.point, end: end.point, ...endpoints };
}

/**
 * Whether an arrow may be WRITTEN (created, or an endpoint moved), judged against the committed layout.
 * This is a write-time rule only: it is never applied to stored, imported or restored data, and a stored
 * arrow that later becomes too short (cargo moved) simply is not drawn.
 *  - Creation (`moved` null): both endpoints must resolve Valid, and be at least MIN_ARROW_LENGTH_INCHES apart.
 *  - A moved endpoint (`moved` 'start' | 'end'): that endpoint must resolve Valid. The other endpoint may be
 *    broken (moving an endpoint is how a broken arrow is repaired, one end at a time); the length is
 *    checked only when both ends can be placed.
 * A Needs Review or Unresolved endpoint, including cargo whose ID is ambiguous, is refused: a new arrow is
 * only ever attached to something that currently resolves.
 * @param {Record<string, any>} record the arrow as it would be stored
 * @param {Parameters<typeof resolveAnchor>[1]} context
 * @param {'start' | 'end' | null} [moved]
 * @returns {'unresolved' | 'too-short' | null}
 */
export function arrowPlacementProblem(record, context, moved = null) {
  const start = resolveAnchor(record.start, context);
  const end = resolveAnchor(record.end, context);
  const placeable = resolution => resolution.status === ANNOTATION_STATUS.VALID && isFinitePoint(resolution.point);
  const required = moved === 'start' ? [start] : moved === 'end' ? [end] : [start, end];
  if (!required.every(placeable)) return 'unresolved';
  if (!placeable(start) || !placeable(end)) return null;
  const length = Math.hypot(end.point.x - start.point.x, end.point.y - start.point.y, end.point.z - start.point.z);
  return length < MIN_ARROW_LENGTH_INCHES ? 'too-short' : null;
}

/** @returns {Array<ReturnType<typeof resolveAnnotation>>} one result per normalized record, in order */
export function resolveAnnotationList(annotations, context) {
  return normalizeAnnotations(annotations).map(record => resolveAnnotation(record, context));
}

// ============================================================================
// SECTION: DISPLAY
// ============================================================================

/** 1-based number of each callout, in stored order. Other record types have none. */
export function calloutNumbers(records) {
  const numbers = new Map();
  (Array.isArray(records) ? records : []).forEach(record => {
    if (record && record.type === ANNOTATION_TYPE_CALLOUT) numbers.set(record.id, numbers.size + 1);
  });
  return numbers;
}

const NON_CARGO_TARGETS = Object.freeze({
  main: 'Truck floor',
  'well-top': 'Wheel Well top',
  deck: 'Over-cab deck',
  ground: 'Ground',
  free: 'Open space',
  'wall-left': 'Truck left wall',
  'wall-right': 'Truck right wall',
  'wall-front': 'Truck front wall',
  'wall-rear': 'Truck rear wall',
  ceiling: 'Truck ceiling',
});

/**
 * What a callout is attached to, for the "attached to" line. Cargo anchors need the Case name, which
 * only the caller knows (`caseName`); a missing name falls back to a plain "Cargo".
 * @param {Record<string, any>} anchor
 * @param {string | null} [caseName]
 */
export function describeAnchorTarget(anchor, caseName = null) {
  if (!isRecord(anchor)) return '';
  if (anchor.kind === 'cargo') return caseName ? String(caseName) : 'Cargo';
  return NON_CARGO_TARGETS[anchor.surface] || 'Surface';
}

// ============================================================================
// SECTION: SURFACE NORMAL (derived, for the facing test only)
// ============================================================================

// Inward normals of the truck shell faces (the faces are seen from inside the truck).
const SPACE_NORMALS = Object.freeze({
  'wall-rear': [1, 0, 0],
  'wall-front': [-1, 0, 0],
  'wall-right': [0, 0, 1],
  'wall-left': [0, 0, -1],
  ceiling: [0, -1, 0],
  ground: [0, 1, 0],
});
const END_CAP_TOLERANCE_INCHES = 0.05;

/**
 * The outward normal of the surface an anchor sits on, derived (never stored) so the Editor can draw a
 * marker hollow when its surface faces away from the camera. `frame: 'local'` is the cargo's own frame
 * (rotate it with the cargo); `'world'` is the Load Plan frame. Null when there is no meaningful surface
 * (open space). A box point takes the face it lies on; a cylinder or drum takes its end cap or, on the
 * side wall, the radial direction.
 * @param {Record<string, any>} anchor
 * @returns {{ frame: 'local' | 'world', x: number, y: number, z: number } | null}
 */
export function anchorSurfaceNormal(anchor) {
  if (!isRecord(anchor)) return null;
  if (anchor.kind === 'floor') return { frame: 'world', x: 0, y: 1, z: 0 };
  if (anchor.kind === 'space') {
    const normal = SPACE_NORMALS[anchor.surface];
    return normal ? { frame: 'world', x: normal[0], y: normal[1], z: normal[2] } : null;
  }
  if (anchor.kind !== 'cargo') return null;
  const local = cargoAnchorLocal(anchor);
  const signature = anchor.signature;
  if (!local || !isRecord(signature)) return null;
  const half = { x: signature.length / 2, y: signature.height / 2, z: signature.width / 2 };
  const shape = String(signature.shape || '').trim().toLowerCase();
  if (shape === 'cylinder' || shape === 'drum') {
    if (half.x - Math.abs(local.x) <= END_CAP_TOLERANCE_INCHES) return { frame: 'local', x: Math.sign(local.x) || 1, y: 0, z: 0 };
    const radial = Math.hypot(local.y, local.z);
    return radial > 1e-9 ? { frame: 'local', x: 0, y: local.y / radial, z: local.z / radial } : { frame: 'local', x: 0, y: 1, z: 0 };
  }
  const ratios = [Math.abs(local.x) / half.x, Math.abs(local.y) / half.y, Math.abs(local.z) / half.z];
  const axis = ratios.indexOf(Math.max(...ratios));
  /** @type {{ frame: 'local' | 'world', x: number, y: number, z: number, [axis: string]: any }} */
  const normal = { frame: 'local', x: 0, y: 0, z: 0 };
  const key = ['x', 'y', 'z'][axis];
  normal[key] = Math.sign(local[key]) || 1;
  return normal;
}
