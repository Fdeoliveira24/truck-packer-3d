/**
 * @file cargo-canonical.js
 * @description Single source of truth for typed canonicalization of cargo-rule
 *   fields. Every path that stores, normalizes, compares, or fingerprints a case
 *   must route through here so the SAME raw value produces the SAME canonical
 *   result everywhere (model normalization, app/workspace normalization,
 *   CaseLibrary.upsert, spreadsheet parsing, pack-import preflight, conflict
 *   comparison, fingerprints/import keys, duplicate/reuse decisions).
 *
 *   Design rules (Cargo-Rule V1, Phase 3):
 *   - Booleans never use general JS truthiness. "false"/"no"/"0"/0 are FALSE;
 *     unknown strings are INVALID (fall back to the field default).
 *   - Numbers reject malformed strings, NaN and Infinity. Out-of-bounds values
 *     are clamped to practical data-sanity limits (so e.g. 1e300 can never yield
 *     an infinite volume). Invalid inputs are NOT silently treated as a valid 0
 *     in COMPARISON — they get a distinct sentinel so an invalid value never
 *     equals a valid default.
 *   - One field list, two thin assemblers: canonicalCargoForStorage (invalid ->
 *     safe default) and cargoComparisonKey (invalid -> distinct sentinel).
 *
 * @module core/cargo-canonical
 * @author Truck Packer 3D Team
 */

import { canonicalOrientationLock } from './orientation.js';

// Practical application data limits (NOT vehicle legality limits). They exist so
// absurd values cannot produce infinite volume or break comparison/storage.
export const DIMENSION_MAX_INCHES = 100000;     // ~1.5 miles; no real case approaches this
export const WEIGHT_MAX_LBS = 10000000;         // 10 million lb
export const PALLET_WEIGHT_MAX_LBS = 10000000;
export const STACK_COUNT_MAX = 100000;
export const LOAD_PRIORITY_ABS_MAX = 1000000;

const BOOL_TRUE_TOKENS = new Set(['true', '1', 'yes', 'y', 'on']);
const BOOL_FALSE_TOKENS = new Set(['false', '0', 'no', 'n', 'off']);
const LANE_AUTO_TOKENS = new Set(['', 'auto', 'automatic']);
const LANE_TRUE_TOKENS = new Set(['always', 'true', 'yes', '1', 'y']);
const LANE_FALSE_TOKENS = new Set(['never', 'false', 'no', '0', 'n']);
const SHAPE_TOKENS = new Set(['box', 'cylinder', 'drum']);

// Each parser returns { value, valid }. `value` is always STORAGE-SAFE (already
// defaulted/clamped); `valid` is false when the raw input was malformed or out of
// bounds, which the comparison layer uses to emit a distinct sentinel.

export function parseCargoBoolean(raw, fallback = false) {
  if (raw === true) return { value: true, valid: true };
  if (raw === false) return { value: false, valid: true };
  if (typeof raw === 'number') {
    if (raw === 1) return { value: true, valid: true };
    if (raw === 0) return { value: false, valid: true };
    return { value: fallback, valid: false };
  }
  if (raw == null) return { value: fallback, valid: true };
  const s = String(raw).trim().toLowerCase();
  if (s === '') return { value: fallback, valid: true };
  if (BOOL_TRUE_TOKENS.has(s)) return { value: true, valid: true };
  if (BOOL_FALSE_TOKENS.has(s)) return { value: false, valid: true };
  return { value: fallback, valid: false };
}

export function parseCargoNonNegNumber(raw, { max = Infinity } = {}) {
  if (raw == null || raw === '') return { value: 0, valid: true };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return { value: 0, valid: false };
  if (n > max) return { value: max, valid: false };
  return { value: n, valid: true };
}

export function parseCargoCount(raw, { max = STACK_COUNT_MAX } = {}) {
  if (raw == null || raw === '') return { value: 0, valid: true };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return { value: 0, valid: false };
  const floored = Math.floor(n);
  if (floored > max) return { value: max, valid: false };
  // Decimals are floored consistently (the same before and after storage).
  return { value: floored, valid: true };
}

export function parseCargoDimension(raw, { max = DIMENSION_MAX_INCHES } = {}) {
  const n = typeof raw === 'number' ? raw : Number(String(raw == null ? '' : raw).trim());
  if (!Number.isFinite(n) || n <= 0) return { value: 0, valid: false };
  if (n > max) return { value: max, valid: false };
  return { value: n, valid: true };
}

export function parseCargoLane(raw) {
  if (raw === true) return { value: true, valid: true };
  if (raw === false) return { value: false, valid: true };
  if (raw == null) return { value: null, valid: true };
  const s = String(raw).trim().toLowerCase();
  if (LANE_AUTO_TOKENS.has(s)) return { value: null, valid: true };
  if (LANE_TRUE_TOKENS.has(s)) return { value: true, valid: true };
  if (LANE_FALSE_TOKENS.has(s)) return { value: false, valid: true };
  return { value: null, valid: false };
}

export function parseCargoLoadPriority(raw) {
  if (raw == null || raw === '') return { value: 0, valid: true };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { value: 0, valid: false };
  const clamped = Math.max(-LOAD_PRIORITY_ABS_MAX, Math.min(LOAD_PRIORITY_ABS_MAX, n));
  return { value: clamped, valid: clamped === n };
}

export function parseCargoShape(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (s === '') return { value: 'box', valid: true };
  if (SHAPE_TOKENS.has(s)) return { value: s, valid: true };
  return { value: 'box', valid: false };
}

// Notes are free text, not a cargo rule, but they route through the same single
// source of truth as every other case field so a case-template note is stored the
// same way (string, or null when absent) whether it comes from the Inspector
// Notes modal, CaseLibrary.upsert, or spreadsheet import.
export function parseCargoNotes(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

// Storage-safe canonical cargo fields. Invalid inputs become the documented safe
// default/clamp. Used by case model normalization, app/workspace normalization,
// and CaseLibrary.upsert so storage is always typed and consistent.
export function canonicalCargoForStorage(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    canFlip: parseCargoBoolean(c.canFlip, false).value,
    noStackOnTop: parseCargoBoolean(c.noStackOnTop, false).value,
    isPallet: parseCargoBoolean(c.isPallet, false).value,
    stackable: parseCargoBoolean(c.stackable, true).value,
    maxStackCount: parseCargoCount(c.maxStackCount).value,
    maxPalletWeight: parseCargoNonNegNumber(c.maxPalletWeight, { max: PALLET_WEIGHT_MAX_LBS }).value,
    laneItem: parseCargoLane(c.laneItem).value,
    loadPriority: parseCargoLoadPriority(c.loadPriority).value,
    orientationLock: canonicalOrientationLock(c.orientationLock),
    shape: parseCargoShape(c.shape).value,
    notes: parseCargoNotes(c.notes),
  };
}

// Apply canonical cargo fields onto a full case object IN PLACE-ish (returns a
// shallow copy), preserving every other field (incl. safe extensions). Dimensions
// and weight are handled by the storage layer (buildStorableCase) which already
// coerces them; this only governs the handling-rule fields.
export function applyCanonicalCargoFields(c) {
  const src = c && typeof c === 'object' ? c : {};
  return { ...src, ...canonicalCargoForStorage(src) };
}

// ---------------------------------------------------------------------------
// Comparison / fingerprint — PHYSICAL identity only.
//
// COMPARISON IDENTITY DECISION (Cargo-Rule V1, Phase 3):
//   manufacturer and category are DISPLAY taxonomy/metadata. A difference in
//   category casing or manufacturer must NOT fork a separate physical case, so
//   they are EXCLUDED from physical equivalence and the import fingerprint.
//   `name` is retained because it is the human identity and is already used as a
//   reuse key. On reuse, the existing local case's display metadata is
//   authoritative (an equivalent imported case never overwrites it).
// ---------------------------------------------------------------------------
function sentinel(parsed, rawValue) {
  // A distinct, deterministic token for invalid inputs so an invalid value never
  // compares equal to a valid default, but two identical invalid raws do match.
  return parsed.valid ? parsed.value : `∅:${String(rawValue)}`;
}

export function cargoComparisonKey(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const d = c.dimensions && typeof c.dimensions === 'object' ? c.dimensions : {};
  const s = x => String(x == null ? '' : x).trim().toLowerCase();
  return JSON.stringify([
    s(c.name),
    sentinel(parseCargoDimension(d.length), d.length),
    sentinel(parseCargoDimension(d.width), d.width),
    sentinel(parseCargoDimension(d.height), d.height),
    sentinel(parseCargoNonNegNumber(c.weight, { max: WEIGHT_MAX_LBS }), c.weight),
    sentinel(parseCargoShape(c.shape), c.shape),
    sentinel(parseCargoBoolean(c.canFlip, false), c.canFlip),
    canonicalOrientationLock(c.orientationLock),
    sentinel(parseCargoBoolean(c.noStackOnTop, false), c.noStackOnTop),
    sentinel(parseCargoBoolean(c.stackable, true), c.stackable),
    sentinel(parseCargoCount(c.maxStackCount), c.maxStackCount),
    sentinel(parseCargoBoolean(c.isPallet, false), c.isPallet),
    sentinel(parseCargoNonNegNumber(c.maxPalletWeight, { max: PALLET_WEIGHT_MAX_LBS }), c.maxPalletWeight),
    sentinel(parseCargoLane(c.laneItem), c.laneItem),
    sentinel(parseCargoLoadPriority(c.loadPriority), c.loadPriority),
  ]);
}

export function cargoFieldsEqual(a, b) {
  if (!a || !b) return false;
  return cargoComparisonKey(a) === cargoComparisonKey(b);
}

// ---------------------------------------------------------------------------
// Safe extension-field policy.
//   Known fields are canonicalized above. Approved unknown metadata survives
//   upsert/autosave/App-Backup/Workspace/Pack round-trips, but prototype keys,
//   functions, symbols, and non-finite numbers are never preserved.
// ---------------------------------------------------------------------------
const UNSAFE_EXTENSION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_EXTENSION_DEPTH = 6;

function isSafeScalar(v) {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v))
  );
}

function sanitizeExtensionValue(v, depth) {
  if (depth > MAX_EXTENSION_DEPTH) return undefined;
  if (isSafeScalar(v)) return v;
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) {
      const s = sanitizeExtensionValue(item, depth + 1);
      if (s !== undefined) out.push(s);
    }
    return out;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      if (UNSAFE_EXTENSION_KEYS.has(k)) continue;
      const s = sanitizeExtensionValue(v[k], depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined; // functions, symbols, undefined, NaN, Infinity
}

export function pickSafeExtensions(raw, knownKeys) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const known = knownKeys instanceof Set ? knownKeys : new Set(knownKeys || []);
  const out = {};
  for (const k of Object.keys(src)) {
    if (known.has(k) || UNSAFE_EXTENSION_KEYS.has(k)) continue;
    const s = sanitizeExtensionValue(src[k], 0);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

// Canonical set of fields the case normalizers emit. Anything outside this set is
// treated as a (safe) extension field by pickSafeExtensions.
export const CANONICAL_CASE_KEYS = new Set([
  'id', 'name', 'manufacturer', 'category', 'dimensions', 'weight', 'volume',
  'shape', 'stackable', 'maxStackCount', 'orientationLock', 'noStackOnTop',
  'isPallet', 'maxPalletWeight', 'hazmatClass', 'laneItem', 'loadPriority',
  'mustLoadLast', 'mustUnloadFirst', 'stopGroup', 'keepTogetherGroup', 'canFlip',
  'notes', 'color', 'createdAt', 'updatedAt',
]);
