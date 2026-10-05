/**
 * @file index.js
 * @description Public utilities entrypoint used across the application.
 * @module core/utils
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { uuid as uuidImpl } from '../../utils/uuid.js';
import { debounce as debounceImpl } from '../../utils/debounce.js';
import {
  deepClone as deepCloneImpl,
  sanitizeJSON as sanitizeJSONImpl,
  safeJsonParse as safeJsonParseImpl,
} from '../../utils/json.js';
import {
  downloadText,
  downloadBlob,
  downloadDataUrl,
  createDownloadActionGuard,
  downloadActionGuard,
  formatRelativeTime,
  getCssVar,
  hasWebGL,
} from '../browser.js';

// ============================================================================
// SECTION: CORE PRIMITIVES
// ============================================================================

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const uuid = uuidImpl;
export const debounce = debounceImpl;

export const safeJsonParse = safeJsonParseImpl;
export const sanitizeJSON = sanitizeJSONImpl;
export const deepClone = deepCloneImpl;

export {
  downloadText,
  downloadBlob,
  downloadDataUrl,
  createDownloadActionGuard,
  downloadActionGuard,
  formatRelativeTime,
  getCssVar,
  hasWebGL,
};

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

export function parseResolution(res) {
  const m = String(res || '').match(/^(\d+)x(\d+)$/);
  if (!m) return { width: 1920, height: 1080 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

// ============================================================================
// SECTION: EXPORT FILENAMES
// ============================================================================

// Export filenames are `{parts…}-{YYYYMMDD-HHmmss}.{ext}`. Each part keeps
// letters and digits of any script; every other run (path separators,
// reserved and control characters, whitespace, dots) becomes one hyphen. The
// name before the timestamp is bounded in UTF-8 bytes, so the extension always
// appears exactly once, last.
const EXPORT_FILENAME_PART_MAX_CHARS = 60;
const EXPORT_FILENAME_BASE_MAX_BYTES = 160;

function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}

export function sanitizeFilenamePart(value, maxChars = EXPORT_FILENAME_PART_MAX_CHARS) {
  const slug = String(value == null ? '' : value)
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}_]+/gu, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return Array.from(slug).slice(0, maxChars).join('').replace(/[-_]+$/, '');
}

export function formatFilenameTimestamp(date = new Date()) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * @param {unknown[]|unknown} parts
 * @param {string} extension
 * @param {{ date?: Date }} [options]
 */
export function buildExportFilename(parts, extension, { date = new Date() } = {}) {
  const joined = (Array.isArray(parts) ? parts : [parts])
    .map(part => sanitizeFilenamePart(part))
    .filter(Boolean)
    .join('-') || 'export';
  const chars = Array.from(joined);
  let bytes = utf8Bytes(joined);
  while (bytes > EXPORT_FILENAME_BASE_MAX_BYTES) bytes -= utf8Bytes(chars.pop() || '');
  const base = chars.join('').replace(/[-_]+$/, '') || 'export';
  const ext = sanitizeFilenamePart(extension).toLowerCase() || 'bin';
  return `${base}-${formatFilenameTimestamp(date)}.${ext}`;
}

/**
 * Load Plan files (PNG, PDF, JSON): `{Load Plan Number or load-plan}-{title}-…`.
 * The internal Pack id is never used.
 * @param {{ loadPlanNumber?: unknown, title?: unknown }|null|undefined} pack
 * @param {string} extension
 * @param {{ date?: Date }} [options]
 */
export function buildLoadPlanFilename(pack, extension, options) {
  const p = pack && typeof pack === 'object' ? pack : {};
  return buildExportFilename([sanitizeFilenamePart(p.loadPlanNumber) || 'load-plan', p.title], extension, options);
}

/**
 * @param {{ user?: any, sessionUser?: any, profile?: any }} [opts]
 */
export function getUserAvatarView({ user, sessionUser, profile } = {}) {
  const u = user && typeof user === 'object' ? user : null;
  const su = sessionUser && typeof sessionUser === 'object' ? sessionUser : null;

  const isAuthed = Boolean(u) || Boolean(su && (su.email || su.name));
  const userId = u && u.id ? String(u.id) : '';
  const email = u && u.email ? String(u.email) : su && su.email ? String(su.email) : '';

  let displayName = '';
  let derivedFromEmail = false;

  if (profile && typeof profile === 'object') {
    if (profile.full_name) displayName = String(profile.full_name);
    if (!displayName && (profile.first_name || profile.last_name)) {
      displayName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
    }
  }

  if (!displayName && u && u.user_metadata) {
    displayName = u.user_metadata.full_name || u.user_metadata.name || '';
  }

  // If a Supabase user exists but has no usable name metadata,
  // prefer deriving from the Supabase email before falling back to the demo session name.
  if (!displayName && email) {
    const prefix = email.split('@')[0];
    displayName = prefix || '';
    derivedFromEmail = Boolean(displayName);
  }

  if (!displayName && !u && su && su.name) {
    displayName = String(su.name || '').trim();
  }

  if (!displayName) displayName = isAuthed ? 'User' : 'Guest';

  let initials = '';
  if (displayName && displayName !== 'Guest') {
    const words = displayName.trim().split(/\s+/).filter(Boolean);

    if (words.length >= 2) {
      initials = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
      if (derivedFromEmail && words[0].length >= 2) initials = words[0].substring(0, 2).toUpperCase();
      else initials = (words[0][0] || '').toUpperCase();
    }
  }

  if (!initials && email) {
    const prefix = email.split('@')[0] || '';
    initials = prefix.length >= 2 ? prefix.substring(0, 2).toUpperCase() : (prefix[0] || '').toUpperCase();
  }

  if (!initials) initials = isAuthed ? 'U' : '?';

  const workspaceShareId = userId ? userId.slice(0, 8) : '';
  return { isAuthed, userId, email, displayName, initials, workspaceShareId };
}

export const lengthUnits = ['in', 'ft', 'cm', 'm'];
export const weightUnits = ['lb', 'kg'];

export function inchesToUnit(inches, unit) {
  switch (unit) {
    case 'in':
      return inches;
    case 'ft':
      return inches / 12;
    case 'mm':
      return inches * 25.4;
    case 'cm':
      return inches * 2.54;
    case 'm':
      return inches * 0.0254;
    default:
      return inches;
  }
}

export function unitToInches(value, unit) {
  switch (unit) {
    case 'in':
      return value;
    case 'ft':
      return value * 12;
    case 'mm':
      return value / 25.4;
    case 'cm':
      return value / 2.54;
    case 'm':
      return value / 0.0254;
    default:
      return value;
  }
}

export function poundsToUnit(lb, unit) {
  switch (unit) {
    case 'lb':
      return lb;
    case 'kg':
      return lb * 0.45359237;
    default:
      return lb;
  }
}

export function unitToPounds(value, unit) {
  switch (unit) {
    case 'lb':
      return value;
    case 'kg':
      return value / 0.45359237;
    default:
      return value;
  }
}

// The Case modal's editable numeric representation is also the precision
// boundary for deciding whether a Case Save changed physical cargo data.
export function formatCaseModalNumber(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const decimalsByUnit = { in: 2, ft: 2, cm: 2, m: 4 };
  const maxDecimals = decimalsByUnit[unit] ?? 2;
  return Number(n.toFixed(maxDecimals)).toString();
}

export function formatCaseModalWeightNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
}

export function formatLength(inches, unit, digits = 1) {
  const v = inchesToUnit(inches, unit);
  const fixed = unit === 'in' ? 0 : digits;
  return `${Number.isFinite(v) ? v.toFixed(fixed) : '—'} ${unit}`;
}

export function formatWeight(lb, unit, digits = 1) {
  const v = poundsToUnit(lb, unit);
  const fixed = unit === 'lb' ? 0 : digits;
  return `${Number.isFinite(v) ? v.toFixed(fixed) : '—'} ${unit}`;
}

export function formatDims(dimInches, lengthUnit) {
  const l = inchesToUnit(dimInches.length, lengthUnit);
  const w = inchesToUnit(dimInches.width, lengthUnit);
  const h = inchesToUnit(dimInches.height, lengthUnit);
  const fixed = lengthUnit === 'in' ? 0 : 1;
  return `${l.toFixed(fixed)}×${w.toFixed(fixed)}×${h.toFixed(fixed)} ${lengthUnit}`;
}

export function volumeInCubicInches(dimInches) {
  const { length, width, height } = dimInches;
  return Math.max(0, Number(length) * Number(width) * Number(height));
}

export function formatVolume(dimInches, lengthUnit) {
  const in3 = volumeInCubicInches(dimInches);
  if (!Number.isFinite(in3)) return '—';
  const isImperial = lengthUnit === 'in' || lengthUnit === 'ft';
  if (isImperial) {
    const ft3 = in3 / 1728;
    return `${ft3.toFixed(1)} ft³`;
  }
  const m3 = in3 * Math.pow(0.0254, 3);
  return `${m3.toFixed(3)} m³`;
}

// ============================================================================
// SECTION: STABLE UTILS OBJECT
// ============================================================================

export const Utils = {
  clamp,
  uuid,
  debounce,
  safeJsonParse,
  sanitizeJSON,
  deepClone,
  escapeHtml,
  parseResolution,
  getUserAvatarView,
  lengthUnits,
  weightUnits,
  inchesToUnit,
  unitToInches,
  poundsToUnit,
  unitToPounds,
  formatLength,
  formatWeight,
  formatDims,
  volumeInCubicInches,
  formatVolume,
  sanitizeFilenamePart,
  formatFilenameTimestamp,
  buildExportFilename,
  buildLoadPlanFilename,
  downloadText,
  downloadBlob,
  downloadDataUrl,
  createDownloadActionGuard,
  downloadActionGuard,
  formatRelativeTime,
  getCssVar,
  hasWebGL,
};

function isDebugEnabledLocal() {
  try {
    const q = globalThis.location && typeof globalThis.location.search === 'string' ? globalThis.location.search : '';
    const hasQuery = /\bdebug=1\b/.test(q);
    const hasStorage = globalThis.localStorage && globalThis.localStorage.getItem('tp3dDebug') === '1';
    return Boolean(hasQuery || hasStorage);
  } catch {
    return false;
  }
}

if (isDebugEnabledLocal()) Object.freeze(Utils);
