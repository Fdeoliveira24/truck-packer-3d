/**
 * @file import-schema.js
 * @description Portable data contract for Cargo Planner import/export files:
 *   the versioned envelope shape, format/kind/schemaVersion dispatch,
 *   structural validation, unit contract, category portability projection,
 *   and export-side DTO projection helpers. Every import/export path that
 *   reads or writes a Cargo Planner JSON file should route format/version
 *   recognition through this module so a new file shape is defined once and
 *   reused everywhere, instead of guessed ad hoc at each call site.
 *
 *   This module owns the CONTRACT only. It never touches StateStore,
 *   localStorage, or any application mutation — callers (core/storage.js,
 *   services/import-export.js) apply the validated/adapted data through their
 *   own existing normalization and persistence boundaries.
 * @module core/import-schema
 * @author Truck Packer 3D Team
 */

import { stripForbiddenCaseQuantityFields } from './cargo-canonical.js';

// ============================================================================
// SECTION: ENVELOPE CONSTANTS
// ============================================================================

export const CARGO_PLANNER_FORMAT = 'cargo-planner';
export const CURRENT_SCHEMA_VERSION = 1;

// Internal canonical physical units (see core/cargo-canonical.js:
// DIMENSION_MAX_INCHES, WEIGHT_MAX_LBS). Every stored/exported numeric
// dimension and weight is already in these units; the envelope simply states
// that explicitly instead of leaving it implicit.
export const CANONICAL_UNITS = Object.freeze({ length: 'in', weight: 'lb' });

// Kind wire values intentionally reuse the app's existing Pack/Load-Plan wire
// vocabulary ("pack", "pack-batch" — see the legacy pack-batch exportType)
// rather than introducing a competing "load-plan" wire identifier: the
// terminology migration to "Load Plan" is display-only, and internal/wire
// identifiers remain "pack" (see tests/audit/load-plan-terminology.spec.mjs).
export const IMPORT_KIND = Object.freeze({
  CASE_CATALOG: 'case-catalog',
  LOAD_PLAN: 'pack',
  LOAD_PLAN_BATCH: 'pack-batch',
  WORKSPACE_BACKUP: 'workspace-backup',
  ACTIVE_WORKSPACE_BACKUP: 'active-workspace-backup',
});

/** @type {Set<string>} */
const SUPPORTED_KINDS = new Set(Object.values(IMPORT_KIND));

export const IMPORT_SCHEMA_ERROR = Object.freeze({
  UNSUPPORTED_FORMAT: 'IMPORT_UNSUPPORTED_FORMAT',
  UNSUPPORTED_KIND: 'IMPORT_UNSUPPORTED_KIND',
  WRONG_KIND: 'IMPORT_WRONG_KIND',
  MALFORMED_SCHEMA_VERSION: 'IMPORT_MALFORMED_SCHEMA_VERSION',
  UNSUPPORTED_SCHEMA_VERSION: 'IMPORT_UNSUPPORTED_SCHEMA_VERSION',
  UNSUPPORTED_UNITS: 'IMPORT_UNSUPPORTED_UNITS',
  MALFORMED_STRUCTURE: 'IMPORT_MALFORMED_STRUCTURE',
});

export class ImportSchemaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ImportSchemaError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new ImportSchemaError(code, message, details);
}

export function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// ============================================================================
// SECTION: ENVELOPE SHELL — format / kind / schemaVersion / units dispatch
// ============================================================================

/** Whether a parsed JSON value self-identifies as a Cargo Planner envelope. */
export function isCargoPlannerEnvelope(parsed) {
  return isPlainRecord(parsed) && parsed.format === CARGO_PLANNER_FORMAT;
}

export function validateSchemaVersion(value) {
  if (!Number.isInteger(value)) {
    fail(
      IMPORT_SCHEMA_ERROR.MALFORMED_SCHEMA_VERSION,
      `Malformed schemaVersion: expected an integer, received ${JSON.stringify(value)}.`
    );
  }
  if (value < 1 || value > CURRENT_SCHEMA_VERSION) {
    fail(
      IMPORT_SCHEMA_ERROR.UNSUPPORTED_SCHEMA_VERSION,
      `Unsupported schemaVersion ${value}. This app supports schema version 1 through ${CURRENT_SCHEMA_VERSION}. ` +
        'Update the app, or re-export from a compatible version.'
    );
  }
  return value;
}

/**
 * Every currently supported file declares the fixed internal canonical units.
 * Unrecognized/unsupported unit declarations fail closed rather than being
 * silently reinterpreted or converted.
 */
export function validateUnits(units) {
  if (!isPlainRecord(units)) {
    fail(IMPORT_SCHEMA_ERROR.UNSUPPORTED_UNITS, 'Missing or invalid units declaration.');
  }
  if (units.length !== CANONICAL_UNITS.length) {
    fail(
      IMPORT_SCHEMA_ERROR.UNSUPPORTED_UNITS,
      `Unsupported length unit "${units.length}". Only "${CANONICAL_UNITS.length}" is currently supported.`
    );
  }
  if (units.weight !== CANONICAL_UNITS.weight) {
    fail(
      IMPORT_SCHEMA_ERROR.UNSUPPORTED_UNITS,
      `Unsupported weight unit "${units.weight}". Only "${CANONICAL_UNITS.weight}" is currently supported.`
    );
  }
  return { length: units.length, weight: units.weight };
}

/**
 * @param {string} kind
 * @returns {string}
 */
export function assertSupportedKind(kind) {
  if (typeof kind !== 'string' || !SUPPORTED_KINDS.has(kind)) {
    fail(IMPORT_SCHEMA_ERROR.UNSUPPORTED_KIND, `Unsupported or missing file kind ${JSON.stringify(kind)}.`);
  }
  return kind;
}

/**
 * @param {string} kind
 * @param {string|string[]} expectedKinds
 * @returns {string}
 */
export function assertExpectedKind(kind, expectedKinds) {
  const allowed = Array.isArray(expectedKinds) ? expectedKinds : [expectedKinds];
  if (!allowed.includes(kind)) {
    fail(
      IMPORT_SCHEMA_ERROR.WRONG_KIND,
      `Wrong file kind "${kind}". Expected ${allowed.join(' or ')}.`
    );
  }
  return kind;
}

/**
 * Validate and unwrap a parsed Cargo Planner envelope: format -> kind ->
 * schemaVersion -> units -> data-is-present. Every check throws BEFORE any
 * normalization/migration is attempted, so a wrong-kind or unsupported-version
 * file is rejected before any lossy adaptation runs. Callers that recognize
 * multiple kinds from one entry point pass `expectedKinds`; omit it to accept
 * any supported kind and dispatch on the returned `kind` themselves.
 * @param {any} parsed
 * @param {{ expectedKinds?: string|string[] }} [options]
 */
export function parseCargoPlannerEnvelope(parsed, { expectedKinds } = {}) {
  if (!isCargoPlannerEnvelope(parsed)) {
    fail(IMPORT_SCHEMA_ERROR.UNSUPPORTED_FORMAT, 'Not a Cargo Planner file (missing or invalid "format").');
  }
  const kind = assertSupportedKind(parsed.kind);
  if (expectedKinds) assertExpectedKind(kind, expectedKinds);
  const schemaVersion = validateSchemaVersion(parsed.schemaVersion);
  const units = validateUnits(parsed.units);
  if (!isPlainRecord(parsed.data) && !Array.isArray(parsed.data)) {
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, 'Missing or invalid "data" payload.');
  }
  return {
    kind,
    schemaVersion,
    units,
    scope: isPlainRecord(parsed.scope) ? parsed.scope : null,
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : null,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    data: parsed.data,
  };
}

/**
 * Build a versioned Cargo Planner envelope around an already-portable data
 * payload. Does not itself project/strip application state — pass data that
 * has already gone through the relevant projectPortable* helper.
 * @param {{ kind: string, data: Record<string, any>|any[], appVersion?: string,
 *   scope?: Record<string, any>|null, units?: { length: string, weight: string },
 *   createdAt?: string }} options
 */
export function buildEnvelope({ kind, data, appVersion = null, scope = null, units = CANONICAL_UNITS, createdAt }) {
  assertSupportedKind(kind);
  if (!isPlainRecord(data) && !Array.isArray(data)) {
    throw new Error('buildEnvelope requires a data payload (object or array).');
  }
  const envelope = {
    format: CARGO_PLANNER_FORMAT,
    kind,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: createdAt || new Date().toISOString(),
    appVersion,
    units: { length: units.length || CANONICAL_UNITS.length, weight: units.weight || CANONICAL_UNITS.weight },
    data,
  };
  if (scope) envelope.scope = scope;
  return envelope;
}

export function buildEnvelopeJSON(options) {
  return JSON.stringify(buildEnvelope(options), null, 2);
}

// ============================================================================
// SECTION: CATEGORY PORTABILITY
// ============================================================================

/**
 * Project the smallest portable category representation from preferences:
 * key, user-visible name, and color. Returns an empty array when the
 * workspace has not customized categories (the built-in defaults are already
 * known to every install, so there is nothing additive to carry). This never
 * reads or writes authorization/workspace-selection state — it is a pure
 * display-metadata projection for reconstructing Case/Load Plan category
 * chips on import, nothing more.
 */
export function projectPortableCategories(preferences) {
  const list = preferences && Array.isArray(preferences.categories) ? preferences.categories : [];
  return list
    .filter(c => c && typeof c === 'object' && c.key)
    .map(c => ({
      key: String(c.key),
      name: c.name ? String(c.name) : null,
      color: c.color ? String(c.color) : null,
    }));
}

// ============================================================================
// SECTION: PORTABLE DTO PROJECTION (export-side — strip derived/transient)
// ============================================================================

/** Case DTO minus `volume`, which every import path recomputes from dimensions. */
export function projectPortableCase(caseData) {
  const c = stripForbiddenCaseQuantityFields(caseData);
  const { volume: _volume, ...portable } = c;
  return portable;
}

/**
 * Load Plan DTO minus derived/transient fields: `stats` (recomputed from
 * cases on every import path), and the thumbnail cache (regenerated by the
 * editor, never authoritative data). Instance-level fields (including
 * `orientedDims`) are intentionally left untouched here — see
 * docs/engineering/autopack-engine-contract.md before stripping any placement
 * geometry field, since not every import path recomputes it unconditionally.
 */
export function projectPortablePack(pack) {
  const p = pack && typeof pack === 'object' ? pack : {};
  const { stats: _stats, thumbnail: _thumbnail, thumbnailUpdatedAt: _thumbnailUpdatedAt, thumbnailSource: _thumbnailSource, ...portable } = p;
  return portable;
}

/** Workspace Backup adds transient solver-result exclusions to the shared Pack DTO. */
export function projectPortableWorkspacePack(pack) {
  const portablePack = projectPortablePack(pack);
  const {
    autoPackAlternatives: _autoPackAlternatives,
    autopackAlternatives: _autopackAlternatives,
    packingSolutions: _packingSolutions,
    solutions: _solutions,
    ...portable
  } = portablePack;
  return portable;
}

/** Workspace folder DTO limited to the durable flat-folder contract. */
export function projectPortableFolder(folder) {
  const f = folder && typeof folder === 'object' ? folder : {};
  return {
    id: f.id,
    name: f.name,
    scope: f.scope,
    parentFolderId: f.parentFolderId == null ? null : f.parentFolderId,
    sortOrder: f.sortOrder,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

// ============================================================================
// SECTION: STRUCTURAL VALIDATION (shared graph-integrity primitives)
// ============================================================================

export function requireRestoreArray(data, key, { optional = false } = {}) {
  if (!Object.prototype.hasOwnProperty.call(data, key)) {
    if (optional) return [];
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Missing required ${key} array`);
  }
  if (!Array.isArray(data[key])) {
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid ${key}: expected an array`);
  }
  return data[key];
}

export function requireUniqueId(value, label, seen) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid ${label}: blank or missing id`);
  }
  const id = value.trim();
  if (seen.has(id)) {
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid ${label}: duplicate id "${id}"`);
  }
  seen.add(id);
  return id;
}

/**
 * Validate the shared Case/Pack/Folder reference graph used by both the
 * Active Workspace Backup (formerly "App Backup") and Workspace Backup data
 * shapes: unique ids, no dangling folderId/caseId references, no nested
 * folders. Throws BEFORE any normalization runs on a malformed shape or a
 * dangling reference, so invalid evidence is never partially applied.
 * Identical rules to the pre-existing App Restore graph check (moved here so
 * Workspace Backup gets the same rigor for free); no behavior change for the
 * App Backup path.
 * @param {Record<string, any>} data
 * @param {{ requirePreferences?: boolean }} [options]
 */
export function validateWorkspaceGraph(data, { requirePreferences = false } = {}) {
  if (!isPlainRecord(data)) {
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, 'Invalid data: expected an object');
  }
  if (requirePreferences && !isPlainRecord(data.preferences)) {
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, 'Invalid preferences: expected an object');
  }
  const cases = requireRestoreArray(data, 'caseLibrary');
  const packs = requireRestoreArray(data, 'packLibrary');
  const folders = requireRestoreArray(data, 'folderLibrary', { optional: true });
  const caseIds = new Set();
  const folderIds = new Set();
  const instanceIds = new Set();

  cases.forEach((caseData, index) => {
    if (!isPlainRecord(caseData)) {
      fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid caseLibrary[${index}]: expected an object`);
    }
    requireUniqueId(caseData.id, `caseLibrary[${index}]`, caseIds);
  });
  folders.forEach((folder, index) => {
    if (!isPlainRecord(folder)) {
      fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid folderLibrary[${index}]: expected an object`);
    }
    requireUniqueId(folder.id, `folderLibrary[${index}]`, folderIds);
    if (folder.parentFolderId != null && String(folder.parentFolderId).trim()) {
      fail(
        IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE,
        `Invalid folderLibrary[${index}]: nested folder references are not supported`
      );
    }
  });
  const packIds = new Set();
  packs.forEach((pack, packIndex) => {
    if (!isPlainRecord(pack)) {
      fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid packLibrary[${packIndex}]: expected an object`);
    }
    requireUniqueId(pack.id, `packLibrary[${packIndex}]`, packIds);
    if (pack.folderId != null && String(pack.folderId).trim()) {
      if (typeof pack.folderId !== 'string' || !folderIds.has(pack.folderId.trim())) {
        fail(
          IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE,
          `Invalid packLibrary[${packIndex}].folderId: referenced folder does not exist`
        );
      }
    }
    if (pack.cases != null && !Array.isArray(pack.cases)) {
      fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid packLibrary[${packIndex}].cases: expected an array`);
    }
    const instances = Array.isArray(pack.cases) ? pack.cases : [];
    instances.forEach((instance, instanceIndex) => {
      if (!isPlainRecord(instance)) {
        fail(
          IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE,
          `Invalid packLibrary[${packIndex}].cases[${instanceIndex}]: expected an object`
        );
      }
      requireUniqueId(instance.id, `packLibrary[${packIndex}].cases[${instanceIndex}]`, instanceIds);
      if (typeof instance.caseId !== 'string' || !instance.caseId.trim()) {
        fail(
          IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE,
          `Invalid packLibrary[${packIndex}].cases[${instanceIndex}].caseId: blank or missing reference`
        );
      }
      if (!caseIds.has(instance.caseId.trim())) {
        fail(
          IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE,
          `Invalid packLibrary[${packIndex}].cases[${instanceIndex}].caseId: referenced case does not exist`
        );
      }
    });
  });

  if (data.currentPackId != null && String(data.currentPackId).trim()) {
    if (typeof data.currentPackId !== 'string' || !packIds.has(data.currentPackId.trim())) {
      fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, 'Invalid currentPackId: referenced load plan does not exist');
    }
  }

  return { cases, packs, folders };
}

/**
 * Structural validation for the (not yet wired to any exporter/importer)
 * case-catalog kind: a portable, workspace-agnostic list of Cases. Defined
 * now so the format/kind/version dispatch already recognizes it, ahead of the
 * Cases JSON export/import UI that a later milestone will add.
 */
export function validateCaseCatalogGraph(data) {
  if (!isPlainRecord(data)) {
    fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, 'Invalid data: expected an object');
  }
  const cases = requireRestoreArray(data, 'caseLibrary');
  const caseIds = new Set();
  cases.forEach((caseData, index) => {
    if (!isPlainRecord(caseData)) {
      fail(IMPORT_SCHEMA_ERROR.MALFORMED_STRUCTURE, `Invalid caseLibrary[${index}]: expected an object`);
    }
    requireUniqueId(caseData.id, `caseLibrary[${index}]`, caseIds);
  });
  return { cases };
}
