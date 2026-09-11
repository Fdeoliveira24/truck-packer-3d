/**
 * @file import-export.js
 * @description UI-free service module for import export operations and state updates.
 * @module services/import-export
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as Utils from '../core/utils/index.js';
import * as Defaults from '../core/defaults.js';
import * as CoreStorage from '../core/storage.js';
import * as CoreNormalizer from '../core/normalizer.js';
import * as AppStateStore from '../core/state-store.js';
import * as CaseLibrary from './case-library.js';
import * as PackLibrary from './pack-library.js';
import { APP_VERSION } from '../core/version.js';
import { canonicalOrientationLock } from '../core/orientation.js';
import {
  migrateLoadPlanNumbers,
  normalizeBusinessIdentityLibraries,
} from '../core/business-identity.js';
import {
  IMPORT_KIND,
  isPlainRecord,
  isCargoPlannerEnvelope,
  parseCargoPlannerEnvelope,
  validateWorkspaceGraph,
  validateCaseCatalogGraph,
  buildEnvelopeJSON,
  projectPortableCategories,
  projectPortableCase,
  projectPortablePack,
} from '../core/import-schema.js';
import {
  parseCargoBoolean,
  parseCargoLane,
  parseCargoCount,
  parseCargoNonNegNumber,
  parseCargoDimension,
  parseCargoLoadPriority,
  parseCargoShape,
  applyCanonicalCargoFields,
  PALLET_WEIGHT_MAX_LBS,
  DIMENSION_MAX_INCHES,
  WEIGHT_MAX_LBS,
} from '../core/cargo-canonical.js';

// Human-readable fallback labels for structured preview warnings.
const ORIENTATION_LABELS = { any: 'Any', upright: 'Upright', onSide: 'On side' };
function orientationLabel(v) { return ORIENTATION_LABELS[v] || 'Any'; }
function laneLabel(v) { return v === true ? 'Always' : v === false ? 'Never' : 'Automatic'; }
function priorityLabel(v) { return v > 0 ? 'High' : v < 0 ? 'Low' : 'Normal'; }
function boolLabel(v) { return v ? 'Yes' : 'No'; }

// Build a structured per-row warning: { rowNum, field, value, fallback, reason,
// message }. The message format matches the examples shown in the preview and the
// downloadable report so the two are always identical.
function buildRowWarning(rowNum, field, rawValue, fallbackLabel) {
  const value = String(rawValue == null ? '' : rawValue);
  const reason = `is invalid; using ${fallbackLabel}`;
  return { rowNum, field, value, fallback: fallbackLabel, reason, message: `${field}: "${value}" ${reason}` };
}

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMPORT_EXTENSIONS = new Set(['csv', 'xlsx']);

export const WORKSPACE_BACKUP_LIMITS = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  maxDepth: 32,
  maxJsonNodes: 500000,
  maxStringChars: 1000000,
  maxCases: 5000,
  maxPacks: 1000,
  maxFolders: 2000,
  maxCategories: 1000,
  maxInstances: 100000,
});

export const WORKSPACE_RESTORE_FORBIDDEN = 'WORKSPACE_RESTORE_FORBIDDEN';
const WORKSPACE_RESTORE_PLAN = Symbol('workspace-restore-plan');

function applyCaseDefaultColor(caseObj) {
  const next = { ...(caseObj || {}) };
  const existing = String(next.color || '').trim();
  if (existing) return next;
  const key =
    String(next.category || 'default')
      .trim()
      .toLowerCase() || 'default';
  const cats = Defaults.categories || [];
  const found = cats.find(c => c.key === key) || cats.find(c => c.key === 'default');
  next.color = (found && found.color) || '#9ca3af';
  return next;
}

function normalizeHeader(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Single source of truth for recognized spreadsheet column names, shared by
// indexMap() (first-match lookup) and findDuplicateMappedHeaders() (collision
// detection) so the two can never silently drift apart. Item Code intentionally
// recognizes ONLY the aliases approved by business-identity-contract-v1.md §8
// rule 3 ("itemCode", "item_code", "item code" — all normalize to "itemcode")
// — SKU/Product Code/barcode/etc. must never silently map to Item Code (rule 4).
const FIELD_CANDIDATES = {
  name: ['name', 'casename', 'item', 'title'],
  itemCode: ['itemcode'],
  manufacturer: ['manufacturer', 'mfg', 'brand'],
  category: ['category', 'cat', 'type'],
  length: ['length', 'l'],
  width: ['width', 'w'],
  height: ['height', 'h'],
  lengthUnit: ['lengthunit', 'dimunit', 'dimensionunit'],
  weight: ['weight', 'wt'],
  weightUnit: ['weightunit', 'massunit'],
  canFlip: ['canflip', 'flippable', 'canrotate', 'flip'],
  orientationLock: ['orientationlock', 'orientation', 'orient'],
  noStackOnTop: ['nostackontop', 'notopload', 'notop', 'donotstackontop'],
  maxStackCount: ['maxstackcount', 'maxontop', 'maxstack'],
  isPallet: ['ispallet', 'pallet', 'loadbase', 'base'],
  maxPalletWeight: ['maxpalletweight', 'maxload', 'palletmaxweight', 'loadwarning'],
  laneItem: ['laneitem', 'lane', 'longitemlane'],
  loadPriority: ['loadpriority', 'priority', 'packingpriority'],
  shape: ['shape'],
  stackable: ['stackable'],
  hazmatClass: ['hazmatclass', 'hazmat'],
  mustLoadLast: ['mustloadlast'],
  mustUnloadFirst: ['mustunloadfirst'],
  stopGroup: ['stopgroup'],
  keepTogetherGroup: ['keeptogethergroup', 'keeptogether'],
  notes: ['notes', 'note', 'description', 'desc'],
  color: ['color', 'hex', 'casecolor'],
};

export function indexMap(headers) {
  const find = candidates => {
    for (const c of candidates) {
      const idx = headers.indexOf(c);
      if (idx > -1) return idx;
    }
    return null;
  };
  const map = {};
  for (const field of Object.keys(FIELD_CANDIDATES)) {
    map[field] = find(FIELD_CANDIDATES[field]);
  }
  return map;
}

// Detect header cells that collide on the SAME recognized field (e.g. two
// columns that both normalize to "name"). An arbitrary duplicate among
// UNRECOGNIZED extra columns is harmless and intentionally not reported here —
// only ambiguity in a column the importer would actually READ blocks the file.
export function findDuplicateMappedHeaders(headers) {
  const duplicates = [];
  for (const field of Object.keys(FIELD_CANDIDATES)) {
    const indices = [];
    headers.forEach((h, i) => {
      if (FIELD_CANDIDATES[field].includes(h)) indices.push(i);
    });
    if (indices.length > 1) duplicates.push({ field, indices });
  }
  return duplicates;
}

function getField(row, idx) {
  if (idx == null) return '';
  return row[idx];
}

// Boolean cell that warns when a non-blank value is not a recognized boolean
// (it still falls back to false so the row imports). Value parsing is delegated
// to the single typed canonical representation so the SAME raw value produces the
// SAME result here, at storage, and in comparison ("false" is never truthy).
export function parseBoolCell(raw, label) {
  const { value, valid } = parseCargoBoolean(raw, false);
  return { value, warning: valid ? null : `invalid ${label} "${raw}" (used No)` };
}

// Same contract as parseBoolCell but with a configurable fallback — needed for
// `stackable`, whose canonical default is TRUE (core/cargo-canonical.js), not
// the false default every other handling-rule boolean uses.
export function parseBoolCellDefault(raw, label, fallback) {
  const { value, valid } = parseCargoBoolean(raw, fallback);
  return { value, warning: valid ? null : `invalid ${label} "${raw}" (used ${fallback ? 'Yes' : 'No'})` };
}

export function parseShapeCell(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: 'box', warning: null };
  const { value, valid } = parseCargoShape(s);
  return { value, warning: valid ? null : `invalid shape "${raw}" (used Box)` };
}

export function parseLaneCellWarned(raw) {
  const { value, valid } = parseCargoLane(raw);
  return { value, warning: valid ? null : `invalid lane "${raw}" (used Automatic)` };
}

// Handling-rule cell parsers. Each returns the canonical value; the *Warned
// variants also return a human-readable warning string when the cell was
// present but invalid (the value falls back to the canonical default).
const KNOWN_ORIENTATION_SPELLINGS = new Set(['any', 'upright', 'onside', 'on-side', 'on side', 'on_side']);
export function parseOrientationLockCell(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: 'any', warning: null };
  const value = canonicalOrientationLock(s);
  if (value === 'any' && !KNOWN_ORIENTATION_SPELLINGS.has(s.toLowerCase())) {
    return { value: 'any', warning: `invalid orientation "${raw}" (used Any)` };
  }
  return { value, warning: null };
}

export function parseNonNegIntCell(raw, fieldLabel) {
  const s = String(raw || '').trim();
  if (!s) return { value: 0, warning: null };
  const n = Number(s);
  // Floor consistently with storage (the same decimal value yields the same stored
  // count before and after import). Still warn so the user sees the adjustment.
  const { value } = parseCargoCount(n);
  if (!Number.isFinite(n) || n < 0) {
    return { value, warning: `invalid ${fieldLabel} "${raw}" (used ${value})` };
  }
  if (!Number.isInteger(n)) {
    return { value, warning: `${fieldLabel} "${raw}" rounded down to ${value}` };
  }
  return { value, warning: null };
}

export function parseNonNegNumCell(raw, fieldLabel) {
  const { value, valid } = parseCargoNonNegNumber(raw, { max: PALLET_WEIGHT_MAX_LBS });
  return { value, warning: valid ? null : `invalid ${fieldLabel} "${raw}" (used ${value})` };
}

export function parseLoadPriorityCell(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'normal' || s === '0') return { value: 0, warning: null };
  if (s === 'low' || s === '-1') return { value: -1, warning: null };
  if (s === 'high' || s === '1') return { value: 1, warning: null };
  const n = Number(s);
  if (Number.isFinite(n)) return { value: n > 0 ? 1 : n < 0 ? -1 : 0, warning: null };
  return { value: 0, warning: `invalid priority "${raw}" (used Normal)` };
}

export function buildCasesTemplateCSV() {
  return [
    'name,itemCode,manufacturer,category,length,width,height,lengthUnit,weight,weightUnit,canFlip,orientationLock,noStackOnTop,maxStackCount,isPallet,maxPalletWeight,laneItem,loadPriority,notes',
    'Line Array Case,,L-Acoustics,audio,48,24,32,in,125,lb,false,upright,true,0,false,0,auto,normal,',
    'Truss Section,,Global Truss,lighting,120,12,12,in,45,lb,true,any,false,0,false,0,always,normal,',
    'Equipment Pallet,,Generic,default,48,40,6,in,60,lb,false,any,false,0,true,2000,never,low,',
  ].join('\n');
}

// Explicit spreadsheet unit contract (Milestone C): lengthUnit/weightUnit are
// OPTIONAL dedicated columns. A blank cell preserves the historical in/lb
// assumption (legacy files with no unit columns keep importing exactly as
// before); a present-but-unrecognized token is never silently reinterpreted
// as in/lb — it fails the row so a wrong unit can never be misread as inches.
function resolveLengthUnitCell(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return { unit: 'in', valid: true };
  return Utils.lengthUnits.includes(s) ? { unit: s, valid: true } : { unit: 'in', valid: false };
}
function resolveWeightUnitCell(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return { unit: 'lb', valid: true };
  return Utils.weightUnits.includes(s) ? { unit: s, valid: true } : { unit: 'lb', valid: false };
}

export function downloadCasesTemplate() {
  const csv = buildCasesTemplateCSV();
  Utils.downloadText('cases_template.csv', csv, 'text/csv');
}

export async function parseAndValidateSpreadsheet(file, existingCases = CaseLibrary.getCases()) {
  if (!window.XLSX) throw new Error('XLSX library not available');
  const fileName = String((file && file.name) || '').trim();
  const ext = String(fileName || '')
    .split('.')
    .pop()
    .toLowerCase()
    .trim();
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported file type. Please upload a .csv or .xlsx file.');
  }
  const fileSizeBytes = Number(file && file.size);
  if (Number.isFinite(fileSizeBytes) && fileSizeBytes > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`File too large. Max supported size is ${Math.floor(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB.`);
  }
  let workbook;
  if (ext === 'csv') {
    if (!file || typeof file.text !== 'function') throw new Error('Invalid CSV file handle');
    const text = await file.text();
    workbook = window.XLSX.read(text, { type: 'string' });
  } else {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Invalid XLSX file handle');
    const buf = await file.arrayBuffer();
    workbook = window.XLSX.read(buf, { type: 'array' });
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows || !rows.length) throw new Error('Empty file');
  const dataRowCount = Math.max(0, rows.length - 1);
  if (dataRowCount > MAX_IMPORT_ROWS) {
    throw new Error(`Too many rows (${dataRowCount}). Max supported rows: ${MAX_IMPORT_ROWS}.`);
  }

  const headerRow = rows[0].map(h => String(h || '').trim());
  const header = headerRow.map(normalizeHeader);
  const duplicateHeaders = findDuplicateMappedHeaders(header);
  if (duplicateHeaders.length) {
    const shown = duplicateHeaders
      .map(d => `"${headerRow[d.indices[0]] || d.field}"`)
      .join(', ');
    throw new Error(`Duplicate column detected for ${shown}. Remove the duplicate column and re-upload.`);
  }
  const idx = indexMap(header);

  const required = ['name', 'length', 'width', 'height'];
  const missing = required.filter(r => idx[r] == null);
  if (missing.length) throw new Error('Missing required columns: ' + missing.join(', '));

  const existingNames = new Set(
    (existingCases || []).map(c =>
      String(c.name || '')
        .trim()
        .toLowerCase()
    )
  );
  const seenNames = new Set(existingNames);
  const existingItemCodes = new Set(
    (existingCases || [])
      .map(c => String(c.itemCode || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const seenItemCodes = new Set(existingItemCodes);
  const errors = [];
  const warnings = []; // additive: non-blocking handling-rule cell warnings
  const duplicates = [];
  const valid = [];
  const invalidRows = []; // additive: [{rowNum, record, reasons}]
  const duplicateRows = []; // additive: [{rowNum, record}]

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(v => String(v || '').trim() === '')) continue;
    const rowNum = r + 1;
    const orientationParsed = parseOrientationLockCell(getField(row, idx.orientationLock));
    const maxStackParsed = parseNonNegIntCell(getField(row, idx.maxStackCount), 'max items on top');
    const palletWeightParsed = parseNonNegNumCell(getField(row, idx.maxPalletWeight), 'max load');
    const priorityParsed = parseLoadPriorityCell(getField(row, idx.loadPriority));
    const canFlipParsed = parseBoolCell(getField(row, idx.canFlip), 'allow flipping');
    const noTopParsed = parseBoolCell(getField(row, idx.noStackOnTop), 'no top load');
    const palletParsed = parseBoolCell(getField(row, idx.isPallet), 'pallet');
    const shapeParsed = parseShapeCell(getField(row, idx.shape));
    const stackableParsed = parseBoolCellDefault(getField(row, idx.stackable), 'stackable', true);
    const mustLoadLastParsed = parseBoolCell(getField(row, idx.mustLoadLast), 'must load last');
    const mustUnloadFirstParsed = parseBoolCell(getField(row, idx.mustUnloadFirst), 'must unload first');
    const laneParsed = parseLaneCellWarned(getField(row, idx.laneItem));
    // Explicit units (Milestone C): a blank unit cell preserves the historical
    // in/lb assumption; a present-but-unrecognized token is rejected below
    // rather than silently reinterpreted as inches/pounds.
    const lengthUnitRaw = getField(row, idx.lengthUnit);
    const weightUnitRaw = getField(row, idx.weightUnit);
    const lengthUnitParsed = resolveLengthUnitCell(lengthUnitRaw);
    const weightUnitParsed = resolveWeightUnitCell(weightUnitRaw);
    const rawLength = Number(getField(row, idx.length));
    const rawWidth = Number(getField(row, idx.width));
    const rawHeight = Number(getField(row, idx.height));
    const rawWeight = Number(getField(row, idx.weight));
    const record = {
      name: String(getField(row, idx.name)).trim(),
      itemCode: String(getField(row, idx.itemCode)).trim(),
      manufacturer: String(getField(row, idx.manufacturer)).trim(),
      category: String(getField(row, idx.category)).trim().toLowerCase() || 'default',
      length: lengthUnitParsed.valid ? Utils.unitToInches(rawLength, lengthUnitParsed.unit) : rawLength,
      width: lengthUnitParsed.valid ? Utils.unitToInches(rawWidth, lengthUnitParsed.unit) : rawWidth,
      height: lengthUnitParsed.valid ? Utils.unitToInches(rawHeight, lengthUnitParsed.unit) : rawHeight,
      weight: weightUnitParsed.valid ? Utils.unitToPounds(rawWeight, weightUnitParsed.unit) : rawWeight,
      // Handling rules (Cargo-Rule V1). canFlip only meaningful when policy is 'any'.
      canFlip: orientationParsed.value === 'any' && canFlipParsed.value,
      orientationLock: orientationParsed.value,
      noStackOnTop: noTopParsed.value,
      maxStackCount: maxStackParsed.value,
      isPallet: palletParsed.value,
      maxPalletWeight: palletWeightParsed.value,
      laneItem: laneParsed.value,
      loadPriority: priorityParsed.value,
      shape: shapeParsed.value,
      stackable: stackableParsed.value,
      hazmatClass: String(getField(row, idx.hazmatClass)).trim() || null,
      mustLoadLast: mustLoadLastParsed.value,
      mustUnloadFirst: mustUnloadFirstParsed.value,
      stopGroup: String(getField(row, idx.stopGroup)).trim(),
      keepTogetherGroup: String(getField(row, idx.keepTogetherGroup)).trim(),
      notes: String(getField(row, idx.notes)).trim(),
      color: String(getField(row, idx.color)).trim(),
    };

    // Structured per-row warnings (field / supplied value / fallback / reason) so
    // the preview can show exactly what was adjusted and why. Only fields whose
    // parser flagged the supplied value contribute a warning.
    const rowWarningSpecs = [
      { field: 'orientationLock', parsed: orientationParsed, raw: getField(row, idx.orientationLock), fallback: orientationLabel(orientationParsed.value) },
      { field: 'maxStackCount', parsed: maxStackParsed, raw: getField(row, idx.maxStackCount), fallback: String(maxStackParsed.value) },
      { field: 'maxPalletWeight', parsed: palletWeightParsed, raw: getField(row, idx.maxPalletWeight), fallback: String(palletWeightParsed.value) },
      { field: 'loadPriority', parsed: priorityParsed, raw: getField(row, idx.loadPriority), fallback: priorityLabel(priorityParsed.value) },
      { field: 'canFlip', parsed: canFlipParsed, raw: getField(row, idx.canFlip), fallback: boolLabel(canFlipParsed.value) },
      { field: 'noStackOnTop', parsed: noTopParsed, raw: getField(row, idx.noStackOnTop), fallback: boolLabel(noTopParsed.value) },
      { field: 'isPallet', parsed: palletParsed, raw: getField(row, idx.isPallet), fallback: boolLabel(palletParsed.value) },
      { field: 'laneItem', parsed: laneParsed, raw: getField(row, idx.laneItem), fallback: laneLabel(laneParsed.value) },
      { field: 'shape', parsed: shapeParsed, raw: getField(row, idx.shape), fallback: 'Box' },
      { field: 'stackable', parsed: stackableParsed, raw: getField(row, idx.stackable), fallback: boolLabel(stackableParsed.value) },
      { field: 'mustLoadLast', parsed: mustLoadLastParsed, raw: getField(row, idx.mustLoadLast), fallback: boolLabel(mustLoadLastParsed.value) },
      { field: 'mustUnloadFirst', parsed: mustUnloadFirstParsed, raw: getField(row, idx.mustUnloadFirst), fallback: boolLabel(mustUnloadFirstParsed.value) },
    ];
    const rowWarnings = [];
    for (const spec of rowWarningSpecs) {
      if (!spec.parsed.warning) continue;
      rowWarnings.push(buildRowWarning(rowNum, spec.field, spec.raw, spec.fallback));
    }
    // Data-sanity limits (Phase 3): warn on extreme dimensions/weight that would
    // be clamped at storage. Driven by the SAME typed parsers CaseLibrary.
    // buildStorableCase uses at commit time (core/cargo-canonical.js), so the
    // warning text can never drift from what is actually stored. Only the
    // "exceeds the maximum" case is surfaced here — a non-positive value is
    // already a blocking error below, not a silent-clamp warning.
    const dimSanityChecks = [
      { field: 'length', raw: record.length },
      { field: 'width', raw: record.width },
      { field: 'height', raw: record.height },
    ];
    for (const sc of dimSanityChecks) {
      const parsed = parseCargoDimension(sc.raw);
      if (!parsed.valid && Number.isFinite(sc.raw) && sc.raw > DIMENSION_MAX_INCHES) {
        rowWarnings.push({
          rowNum, field: sc.field, value: String(sc.raw), fallback: String(parsed.value),
          reason: `exceeds the maximum; using ${parsed.value}`,
          message: `${sc.field}: "${sc.raw}" exceeds the maximum; using ${parsed.value}`,
        });
      }
    }
    const weightSanity = parseCargoNonNegNumber(record.weight, { max: WEIGHT_MAX_LBS });
    if (!weightSanity.valid && Number.isFinite(record.weight) && record.weight > WEIGHT_MAX_LBS) {
      rowWarnings.push({
        rowNum, field: 'weight', value: String(record.weight), fallback: String(weightSanity.value),
        reason: `exceeds the maximum; using ${weightSanity.value}`,
        message: `weight: "${record.weight}" exceeds the maximum; using ${weightSanity.value}`,
      });
    }
    record.warnings = rowWarnings;
    rowWarnings.forEach(w => warnings.push(`Row ${rowNum}: ${w.message}`));

    const rowErrors = [];
    if (!record.name) rowErrors.push(`Row ${rowNum}: Missing required field 'name'`);
    if (!lengthUnitParsed.valid) {
      rowErrors.push(
        `Row ${rowNum}: Unknown length unit "${lengthUnitRaw}" (expected ${Utils.lengthUnits.join(', ')})`
      );
    }
    if (!weightUnitParsed.valid) {
      rowErrors.push(
        `Row ${rowNum}: Unknown weight unit "${weightUnitRaw}" (expected ${Utils.weightUnits.join(', ')})`
      );
    }
    if (!Number.isFinite(record.length) || record.length <= 0) {
      rowErrors.push(`Row ${rowNum}: Invalid number for 'length'`);
    }
    if (!Number.isFinite(record.width) || record.width <= 0) {
      rowErrors.push(`Row ${rowNum}: Invalid number for 'width'`);
    }
    if (!Number.isFinite(record.height) || record.height <= 0) {
      rowErrors.push(`Row ${rowNum}: Invalid number for 'height'`);
    }

    const nameKey = record.name.toLowerCase();
    if (record.name && seenNames.has(nameKey)) {
      duplicates.push(`Row ${rowNum}: Duplicate name "${record.name}" (skipped)`);
      duplicateRows.push({ rowNum, record });
      continue;
    }
    const itemCodeKey = record.itemCode.toLowerCase();
    if (itemCodeKey && seenItemCodes.has(itemCodeKey)) {
      duplicates.push(`Row ${rowNum}: Duplicate Item Code "${record.itemCode}" (skipped)`);
      duplicateRows.push({ rowNum, record });
      continue;
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      invalidRows.push({ rowNum, record, reasons: rowErrors.map(e => e.replace(`Row ${rowNum}: `, '')) });
      continue;
    }
    seenNames.add(nameKey);
    if (itemCodeKey) seenItemCodes.add(itemCodeKey);
    valid.push(record);
  }

  return { valid, errors, warnings, duplicates, invalidRows, duplicateRows };
}

export function importCaseRows(rows, existingCases = CaseLibrary.getCases()) {
  const now = Date.now();
  const existingNames = new Set(
    (existingCases || []).map(c =>
      String(c.name || '')
        .trim()
        .toLowerCase()
    )
  );
  // Defense in depth: itemCode uniqueness is re-checked here independent of
  // parseAndValidateSpreadsheet's preview-time check, so a caller that bypasses
  // the parse stage still cannot create a duplicate Item Code.
  const existingItemCodes = new Set(
    (existingCases || [])
      .map(c => String(c.itemCode || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const next = [...(existingCases || [])];
  let added = 0;
  rows.forEach(r => {
    const nameKey = String(r.name || '')
      .trim()
      .toLowerCase();
    if (!nameKey || existingNames.has(nameKey)) return;
    const itemCode = String(r.itemCode || '').trim() || null;
    const itemCodeKey = itemCode ? itemCode.toLowerCase() : null;
    if (itemCodeKey && existingItemCodes.has(itemCodeKey)) return;
    const rawLength = Number(r.length);
    const rawWidth = Number(r.width);
    const rawHeight = Number(r.height);
    if (!Number.isFinite(rawLength) || rawLength <= 0) return;
    if (!Number.isFinite(rawWidth) || rawWidth <= 0) return;
    if (!Number.isFinite(rawHeight) || rawHeight <= 0) return;
    // Clamp through the same domain validator buildStorableCase/upsert use, so
    // an extreme value parsed upstream (parseAndValidateSpreadsheet) is stored
    // at the SAME clamped value its preview warning already stated — never a
    // second, divergent coercion here.
    const length = parseCargoDimension(rawLength).value;
    const width = parseCargoDimension(rawWidth).value;
    const height = parseCargoDimension(rawHeight).value;
    const safeWeight = parseCargoNonNegNumber(Number(r.weight), { max: WEIGHT_MAX_LBS }).value;
    existingNames.add(nameKey);
    if (itemCodeKey) existingItemCodes.add(itemCodeKey);
    // Route the handling-rule fields through the single typed canonical
    // representation rather than re-coercing inline (no duplicated parsing rules).
    const record = applyCanonicalCargoFields(
      applyCaseDefaultColor({
        id: Utils.uuid(),
        name: String(r.name || '').trim(),
        itemCode,
        manufacturer: String(r.manufacturer || '').trim(),
        category:
          String(r.category || 'default')
            .trim()
            .toLowerCase() || 'default',
        dimensions: { length, width, height },
        weight: safeWeight,
        volume: Utils.volumeInCubicInches({
          length,
          width,
          height,
        }),
        canFlip: r.canFlip,
        orientationLock: r.orientationLock || 'any',
        noStackOnTop: r.noStackOnTop,
        maxStackCount: r.maxStackCount,
        isPallet: r.isPallet,
        maxPalletWeight: r.maxPalletWeight,
        laneItem: r.laneItem,
        loadPriority: r.loadPriority,
        shape: r.shape || 'box',
        stackable: r.stackable !== false,
        hazmatClass: String(r.hazmatClass || '').trim() || null,
        mustLoadLast: Boolean(r.mustLoadLast),
        mustUnloadFirst: Boolean(r.mustUnloadFirst),
        stopGroup: String(r.stopGroup || '').trim(),
        keepTogetherGroup: String(r.keepTogetherGroup || '').trim(),
        notes: String(r.notes || '').trim(),
        color: String(r.color || '').trim() || null,
        createdAt: now,
        updatedAt: now,
      })
    );
    next.push(record);
    added++;
  });
  return { nextCaseLibrary: next, added };
}

// ============================================================================
// SECTION: CASE CATALOG EXCHANGE (Milestone C)
// ============================================================================

function pad2(n) {
  return String(n).padStart(2, '0');
}
function todayDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Versioned, workspace-agnostic Case Catalog export (kind: case-catalog). */
export function buildCaseCatalogExportJSON(cases = CaseLibrary.getCases()) {
  const portableCases = (cases || []).map(projectPortableCase);
  const referencedCategoryKeys = new Set(
    portableCases.map(c => String((c && c.category) || 'default').trim().toLowerCase())
  );
  const categories = projectPortableCategories(AppStateStore.get('preferences') || {}).filter(c =>
    referencedCategoryKeys.has(c.key)
  );
  const data = { caseLibrary: portableCases };
  if (categories.length) data.categories = categories;
  return buildEnvelopeJSON({
    kind: IMPORT_KIND.CASE_CATALOG,
    data,
    appVersion: APP_VERSION,
  });
}

export function downloadCaseCatalogExportJSON(cases = CaseLibrary.getCases()) {
  Utils.downloadText(`cases-${todayDateStamp()}.json`, buildCaseCatalogExportJSON(cases), 'application/json');
}

/**
 * Validate a Case Catalog JSON file before any mutation. Only the new
 * versioned envelope is recognized — a case-catalog export is a new
 * Milestone C format with no legacy predecessor to stay compatible with.
 */
export function parseCaseCatalogImportPayloadJSON(jsonText) {
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
  if (!parsed) throw new Error('Invalid JSON');
  if (!isCargoPlannerEnvelope(parsed)) {
    throw new Error('Not a Case Catalog file. Expected a Cargo Planner case-catalog export.');
  }
  const envelope = parseCargoPlannerEnvelope(parsed, { expectedKinds: [IMPORT_KIND.CASE_CATALOG] });
  const { cases } = validateCaseCatalogGraph(envelope.data);
  return {
    cases,
    categories: Array.isArray(envelope.data.categories) ? envelope.data.categories : [],
  };
}

/** Backward-compatible cases-only view for callers that do not apply metadata. */
export function parseCaseCatalogImportJSON(jsonText) {
  return parseCaseCatalogImportPayloadJSON(jsonText).cases;
}

// Tabular Case export field order. Deliberate, documented encoding choices:
//   - `id` is a JSON-only portable-graph identity concern; a spreadsheet user
//     works from Name/Item Code, not a UUID, and CSV round-trip re-matches by
//     those (see planCaseCatalogImport reuse rules) rather than by id.
//   - `createdAt`/`updatedAt` are provenance metadata, not case data — an
//     import always stamps fresh timestamps, same as manual case creation.
//   - `volume` is derived and is recomputed from dimensions on every path.
// Every other current canonical Case field is a flat scalar and gets a
// column. Explicit lengthUnit/weightUnit columns are always written as
// "in"/"lb" on export (storage is already canonical) so a round-tripped file
// states its units exactly like a freshly authored one.
const CASE_SPREADSHEET_COLUMNS = [
  'name', 'itemCode', 'manufacturer', 'category',
  'length', 'width', 'height', 'lengthUnit', 'weight', 'weightUnit',
  'shape', 'canFlip', 'orientationLock', 'stackable', 'noStackOnTop', 'maxStackCount',
  'isPallet', 'maxPalletWeight', 'laneItem', 'loadPriority',
  'hazmatClass', 'mustLoadLast', 'mustUnloadFirst', 'stopGroup', 'keepTogetherGroup',
  'color', 'notes',
];

// OWASP CSV-injection guard: a cell whose text begins with a formula-trigger
// character opens as a formula the moment the file is opened in Excel/Sheets,
// not only when typed interactively. Prefixing a single quote neutralizes it
// the same way Excel's own "force text" convention does. This is export-only
// and intentionally lossy for a value that legitimately starts with one of
// these characters (it re-imports with a leading apostrophe) — a deliberate,
// documented safety trade-off, not an oversight.
const SPREADSHEET_FORMULA_TRIGGER = /^[=+\-@\t\r]/;
function sanitizeSpreadsheetText(value) {
  const s = String(value == null ? '' : value);
  return SPREADSHEET_FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

function caseToSpreadsheetRow(c) {
  const d = (c && c.dimensions) || {};
  return {
    name: sanitizeSpreadsheetText(c.name),
    itemCode: sanitizeSpreadsheetText(c.itemCode || ''),
    manufacturer: sanitizeSpreadsheetText(c.manufacturer || ''),
    category: sanitizeSpreadsheetText(c.category || 'default'),
    length: Number(d.length) || 0,
    width: Number(d.width) || 0,
    height: Number(d.height) || 0,
    lengthUnit: 'in',
    weight: Number(c.weight) || 0,
    weightUnit: 'lb',
    shape: sanitizeSpreadsheetText(c.shape || 'box'),
    canFlip: Boolean(c.canFlip),
    orientationLock: sanitizeSpreadsheetText(c.orientationLock || 'any'),
    stackable: c.stackable !== false,
    noStackOnTop: Boolean(c.noStackOnTop),
    maxStackCount: Number(c.maxStackCount) || 0,
    isPallet: Boolean(c.isPallet),
    maxPalletWeight: Number(c.maxPalletWeight) || 0,
    laneItem: c.laneItem === true ? 'always' : c.laneItem === false ? 'never' : 'auto',
    loadPriority: Number(c.loadPriority) || 0,
    hazmatClass: sanitizeSpreadsheetText(c.hazmatClass || ''),
    mustLoadLast: Boolean(c.mustLoadLast),
    mustUnloadFirst: Boolean(c.mustUnloadFirst),
    stopGroup: sanitizeSpreadsheetText(c.stopGroup || ''),
    keepTogetherGroup: sanitizeSpreadsheetText(c.keepTogetherGroup || ''),
    color: sanitizeSpreadsheetText(c.color || ''),
    notes: sanitizeSpreadsheetText(c.notes || ''),
  };
}

export function buildCaseSpreadsheetRows(cases = CaseLibrary.getCases()) {
  return (cases || []).map(caseToSpreadsheetRow);
}

/**
 * Build a Case Catalog spreadsheet export. `format` is 'csv' (default) or
 * 'xlsx'. Uses the SheetJS runtime already vendored for import (window.XLSX)
 * for correct RFC 4180 CSV quoting — no hand-rolled CSV writer, no new
 * dependency.
 */
export function buildCaseSpreadsheetExport(cases = CaseLibrary.getCases(), { format = 'csv' } = {}) {
  if (!window.XLSX) throw new Error('XLSX library not available');
  const rows = buildCaseSpreadsheetRows(cases);
  const sheet = window.XLSX.utils.json_to_sheet(rows, { header: CASE_SPREADSHEET_COLUMNS });
  if (format === 'xlsx') {
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, sheet, 'Cases');
    const content = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return { content, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  return { content: window.XLSX.utils.sheet_to_csv(sheet), mime: 'text/csv' };
}

export function downloadCaseSpreadsheetExport(cases = CaseLibrary.getCases(), { format = 'csv' } = {}) {
  const { content, mime } = buildCaseSpreadsheetExport(cases, { format });
  const filename = `cases-${todayDateStamp()}.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
  // Blob accepts binary (ArrayBuffer) chunks the same as a string, so the
  // shared downloadText helper works for both text and xlsx content.
  Utils.downloadText(filename, content, mime);
  return filename;
}

export function buildCargoInstructionsManifest(pack, getCaseById = CaseLibrary.getById) {
  const caseEntries = [];
  const itemEntries = [];
  const seenCaseIds = new Set();
  const instanceCountByCase = new Map();

  (Array.isArray(pack && pack.cases) ? pack.cases : []).forEach(inst => {
    if (!inst) return;
    const caseId = String(inst.caseId || '').trim();
    const caseData = caseId ? getCaseById(caseId) : null;
    const caseName = String((caseData && caseData.name) || `Missing case (${caseId || 'unknown'})`).trim();
    const occurrenceKey = caseId || caseName;
    const occurrence = (instanceCountByCase.get(occurrenceKey) || 0) + 1;
    instanceCountByCase.set(occurrenceKey, occurrence);

    const caseNotes = String((caseData && caseData.notes) || '').trim();
    if (caseId && caseNotes && !seenCaseIds.has(caseId)) {
      seenCaseIds.add(caseId);
      caseEntries.push({
        caseId,
        caseName,
        caseNotes,
      });
    }

    const itemNotes = String(inst.instanceNotes || '').trim();
    if (itemNotes) {
      itemEntries.push({
        instanceId: inst.id || null,
        caseId: caseId || null,
        instanceName: `${caseName} #${occurrence}`,
        itemNotes,
      });
    }
  });

  return { caseEntries, itemEntries };
}

/**
 * Aggregate the PDF checklist's existing physical-instance set by reusable
 * Case identity. Resolved Cases group strictly by caseId; unresolved references
 * use a deterministic missing-reference key. Input order defines row order.
 * Hidden instances remain included because the legacy checklist included every
 * entry in pack.cases.
 * @param {Record<string, any>} pack
 * @param {(caseId: string) => Record<string, any>|null} [getCaseById]
 * @returns {Array<{
 *   identityKey: string,
 *   qty: number,
 *   caseId: string|null,
 *   caseData: Record<string, any>|null
 * }>}
 */
export function buildCaseChecklistRows(pack, getCaseById = CaseLibrary.getById) {
  const rows = [];
  const rowsByIdentity = new Map();
  const instances = Array.isArray(pack && pack.cases) ? pack.cases : [];

  instances.forEach(instance => {
    const caseId = String(instance && instance.caseId ? instance.caseId : '').trim();
    const caseData = caseId ? getCaseById(caseId) : null;
    const identityKey = caseData ? `case:${caseId}` : `missing:${caseId || 'unknown'}`;
    let row = rowsByIdentity.get(identityKey);
    if (!row) {
      row = {
        identityKey,
        qty: 0,
        caseId: caseId || null,
        caseData: caseData || null,
      };
      rowsByIdentity.set(identityKey, row);
      rows.push(row);
    }
    row.qty += 1;
  });

  return rows;
}

export function buildPackExportPayload(pack) {
  const sanitizedPack = CoreNormalizer.sanitizeLegacyPackQuantityFields(pack);
  const exportedPack = {
    ...sanitizedPack,
    folderId: null,
  };
  const packCases = Array.isArray(sanitizedPack.cases) ? sanitizedPack.cases : [];
  // Bundled Case definitions and unresolved references reflect every Case
  // referenced by a physical (non-hidden) instance in this Load Plan. Dangling
  // instances (case deleted) are preserved (never silently dropped) but their
  // case definitions cannot be bundled — report them so a reader/re-import
  // knows the export is incomplete and will require repair.
  const bundledCases = [];
  const unresolvedCaseRefs = [];
  const seenCaseIds = new Set();
  const seenUnresolvedRefs = new Set();
  // Bundle every distinct Case referenced by ANY instance regardless of
  // hidden/packed/staged state — a hidden instance's Case definition must
  // still round-trip, or a self-contained export can fail on re-import merely
  // because its only instance of that Case was hidden at export time.
  packCases.forEach(instance => {
    if (!instance) return;
    const caseId = String(instance.caseId || '').trim();
    if (!caseId) {
      if (!seenUnresolvedRefs.has('unknown')) {
        seenUnresolvedRefs.add('unknown');
        unresolvedCaseRefs.push('unknown');
      }
      return;
    }
    if (seenCaseIds.has(caseId)) return;
    seenCaseIds.add(caseId);
    const caseData = CaseLibrary.getById(caseId);
    if (caseData) {
      bundledCases.push(caseData);
    } else if (!seenUnresolvedRefs.has(caseId)) {
      seenUnresolvedRefs.add(caseId);
      unresolvedCaseRefs.push(caseId);
    }
  });
  // Portable category metadata (Milestone C): only the categories actually
  // referenced by a bundled Case are carried, never the whole Preferences
  // object — enough to reproduce the user-visible chip identity for the Cases
  // this Load Plan depends on, nothing about unrelated workspace settings.
  const referencedCategoryKeys = new Set(
    bundledCases.map(c => String((c && c.category) || 'default').trim().toLowerCase())
  );
  const categories = projectPortableCategories(AppStateStore.get('preferences') || {}).filter(c =>
    referencedCategoryKeys.has(c.key)
  );
  const payload = {
    app: 'Truck Packer 3D',
    version: APP_VERSION,
    exportedAt: Date.now(),
    pack: exportedPack,
    bundledCases,
  };
  if (categories.length) payload.categories = categories;
  if (unresolvedCaseRefs.length) {
    payload.unresolvedCaseRefs = unresolvedCaseRefs;
    payload.unresolvedNote =
      `${unresolvedCaseRefs.length} case definition(s) referenced by this pack are missing ` +
      'and could not be bundled. Re-importing this pack will require repairing or removing ' +
      'those items.';
  }
  return payload;
}

/**
 * New exports use the versioned Cargo Planner v1 envelope (kind: "pack" — the
 * wire vocabulary intentionally stays "pack", see IMPORT_KIND). Legacy files
 * produced before this migration remain readable through parsePackImportJSON's
 * bare/{pack, bundledCases} fallback path — this function only changes what
 * NEW exports look like, never what old exports can still import.
 */
export function buildPackExportJSON(pack) {
  const payload = buildPackExportPayload(pack);
  const data = {
    pack: projectPortablePack(payload.pack),
    bundledCases: (payload.bundledCases || []).map(projectPortableCase),
  };
  if (payload.categories) data.categories = payload.categories;
  if (payload.unresolvedCaseRefs) {
    data.unresolvedCaseRefs = payload.unresolvedCaseRefs;
    data.unresolvedNote = payload.unresolvedNote;
  }
  return buildEnvelopeJSON({
    kind: IMPORT_KIND.LOAD_PLAN,
    data,
    appVersion: APP_VERSION,
    createdAt: new Date(payload.exportedAt).toISOString(),
  });
}

/**
 * Accepts either the new versioned Cargo Planner envelope (kind: load-plan)
 * or the legacy bare/`{pack, bundledCases}` shape. A new envelope with the
 * wrong kind, a malformed/unsupported schemaVersion, or unsupported units is
 * rejected before any pack data is touched (see core/import-schema.js).
 */
export function parsePackImportJSON(jsonText) {
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
  if (!parsed) throw new Error('Invalid JSON');
  if (isCargoPlannerEnvelope(parsed)) {
    const envelope = parseCargoPlannerEnvelope(parsed, { expectedKinds: [IMPORT_KIND.LOAD_PLAN] });
    if (!isPlainRecord(envelope.data) || !isPlainRecord(envelope.data.pack)) {
      throw new Error('Invalid load plan envelope: missing pack.');
    }
    return {
      ...envelope.data,
      pack: CoreNormalizer.sanitizeLegacyPackQuantityFields(envelope.data.pack),
    };
  }
  const payload = parsed.pack ? parsed : { pack: parsed };
  return {
    ...payload,
    pack: CoreNormalizer.sanitizeLegacyPackQuantityFields(payload.pack),
  };
}

/**
 * Batch export of multiple Load Plans (kind: pack-batch). Reuses the exact
 * same per-pack portable projection as buildPackExportJSON (buildPackExportPayload
 * + projectPortablePack/projectPortableCase) — no separate/divergent batch
 * serialization logic. Each Load Plan bundles/dedupes its own Case and
 * category definitions independently; a simple robust structure, not a
 * globally deduplicated one (batches are expected to be human-sized).
 */
export function buildPackBatchExportJSON(packs) {
  const list = Array.isArray(packs) ? packs.filter(Boolean) : [];
  if (!list.length) throw new Error('Select at least one load plan to export.');
  const entries = list.map(pack => {
    const payload = buildPackExportPayload(pack);
    const entry = {
      pack: projectPortablePack(payload.pack),
      bundledCases: (payload.bundledCases || []).map(projectPortableCase),
    };
    if (payload.categories) entry.categories = payload.categories;
    if (payload.unresolvedCaseRefs) {
      entry.unresolvedCaseRefs = payload.unresolvedCaseRefs;
      entry.unresolvedNote = payload.unresolvedNote;
    }
    return entry;
  });
  return buildEnvelopeJSON({
    kind: IMPORT_KIND.LOAD_PLAN_BATCH,
    data: { packs: entries },
    appVersion: APP_VERSION,
  });
}

export function downloadPackBatchExportJSON(packs) {
  Utils.downloadText(`load-plans-${todayDateStamp()}.json`, buildPackBatchExportJSON(packs), 'application/json');
}

/**
 * Accepts either the new versioned Cargo Planner envelope
 * (kind: load-plan-batch) or the legacy `{exportType: 'pack-batch', packs}`
 * shape. Dispatch and validation happen before any entry is normalized.
 */
export function parsePackBatchImportJSON(jsonText) {
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON');
  }
  const normalizeBatchEntries = packs => packs.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const payload = entry.pack ? entry : { pack: entry };
    return {
      ...payload,
      pack: CoreNormalizer.sanitizeLegacyPackQuantityFields(payload.pack),
    };
  });
  if (isCargoPlannerEnvelope(parsed)) {
    const envelope = parseCargoPlannerEnvelope(parsed, { expectedKinds: [IMPORT_KIND.LOAD_PLAN_BATCH] });
    const packs = isPlainRecord(envelope.data) ? envelope.data.packs : null;
    if (!Array.isArray(packs) || packs.length === 0) {
      throw new Error('Load plan batch file must contain a non-empty packs array.');
    }
    return normalizeBatchEntries(packs);
  }
  // Guard: reject App JSON mistakenly used here.
  if (Array.isArray(parsed.packLibrary) || Array.isArray(parsed.caseLibrary) || parsed.preferences) {
    throw new Error('This looks like App JSON. Use Import App Backup instead.');
  }
  // Guard: reject legacy Workspace JSON from the Load Plan Batch entry point
  // and direct the user to the dedicated destructive restore flow.
  if (parsed.exportType === 'workspace') {
    throw new Error('This is a Workspace Backup. Use Restore Workspace Backup in Settings instead.');
  }
  if (parsed.exportType !== 'pack-batch') {
    throw new Error('Not a load plan batch export. Expected exportType "pack-batch".');
  }
  if (!Array.isArray(parsed.packs) || parsed.packs.length === 0) {
    throw new Error('Load plan batch file must contain a non-empty packs array.');
  }
  // Normalize each entry to { pack, bundledCases } — same shape importPackPayload expects.
  return normalizeBatchEntries(parsed.packs);
}

export function buildAppExportJSON() {
  return CoreStorage.exportAppJSON();
}

export function parseAppImportJSON(jsonText) {
  return CoreStorage.importAppJSON(jsonText);
}

/**
 * Commit a parsed App Restore through the scoped, recoverable persistence boundary.
 * The visible store is replaced only after durable read-back succeeds, and the
 * prior store is restored if finalization fails while the same scope is active.
 * @param {Record<string, any>} imported
 * @param {{ StateStore?: any, Storage?: any, originScope?: any, pauseAutoSave?: Function }} [options]
 */
export function restoreAppImport(imported, {
  StateStore,
  Storage = CoreStorage,
  originScope,
  pauseAutoSave,
} = {}) {
  if (
    !StateStore ||
    typeof StateStore.snapshot !== 'function' ||
    typeof StateStore.replace !== 'function' ||
    typeof StateStore.resetHistory !== 'function'
  ) {
    throw new Error('App restore requires StateStore');
  }
  if (!Storage || typeof Storage.beginAppRestore !== 'function') {
    throw new Error('App restore requires acknowledged storage');
  }
  if (typeof pauseAutoSave !== 'function') {
    throw new Error('App restore requires autosave ownership');
  }

  Storage.assertScopeContextCurrent(originScope);
  const previousState = StateStore.snapshot();
  const nextState = {
    ...previousState,
    caseLibrary: imported.caseLibrary.map(applyCaseDefaultColor),
    packLibrary: imported.packLibrary,
    folderLibrary: imported.folderLibrary,
    preferences: imported.preferences,
    currentPackId: null,
    currentScreen: 'packs',
    selectedInstanceIds: [],
  };
  Storage.assertScopeContextCurrent(originScope);

  const resumeAutoSave = pauseAutoSave();
  if (typeof resumeAutoSave !== 'function') {
    throw new Error('App restore autosave owner did not provide a resume function');
  }
  let receipt = null;
  let stateActivated = false;
  let durableFinalized = false;
  let resumeAllowed = false;
  const recoveryRequired = (error, rollback = null) => {
    const recoveryMessage = rollback && rollback.recoverable
      ? 'Prior data remains in the recovery snapshot.'
      : 'Restore state could not be reconciled safely; reload before making changes.';
    return Object.assign(
      new Error(`${error && error.message ? error.message : 'App restore failed'}. ${recoveryMessage}`),
      {
        code: Storage.APP_RESTORE_RECOVERY_REQUIRED || 'APP_RESTORE_RECOVERY_REQUIRED',
        cause: error,
        recoverable: Boolean(rollback && rollback.recoverable),
      }
    );
  };

  try {
    receipt = Storage.beginAppRestore(nextState, { expectedScope: originScope });
    if (!receipt.ok) {
      if (receipt.rolledBack) resumeAllowed = true;
      const beginError = receipt.error || new Error('App restore persistence failed');
      if (!receipt.rolledBack) throw recoveryRequired(beginError, receipt);
      throw beginError;
    }

    Storage.assertScopeContextCurrent(originScope);
    // Keep the prior history intact until persistence is finalized. A failed
    // restore can then return to previousState without erasing existing Undo.
    StateStore.replace(nextState, { skipHistory: true });
    stateActivated = true;

    const finalized = Storage.finalizeAppRestore(receipt);
    if (!finalized.ok) throw finalized.error || new Error('App restore finalization failed');
    durableFinalized = true;
    StateStore.resetHistory();
    resumeAllowed = true;
    return { nextState, savedAt: finalized.savedAt };
  } catch (error) {
    if (!receipt || !receipt.ok) throw error;
    if (durableFinalized) {
      resumeAllowed = true;
      throw error;
    }

    const rollback = Storage.rollbackAppRestore(receipt);
    let priorStateRestored = !stateActivated;
    if (stateActivated && rollback.ok && Storage.isScopeContextCurrent(originScope)) {
      try {
        StateStore.replace(previousState, { skipHistory: true });
        priorStateRestored = true;
      } catch (stateRollbackError) {
        throw recoveryRequired(stateRollbackError, rollback);
      }
    }
    if (!rollback.ok) {
      throw recoveryRequired(error, rollback);
    }
    if (!priorStateRestored) throw recoveryRequired(error, rollback);
    resumeAllowed = true;
    throw error;
  } finally {
    if (resumeAllowed) resumeAutoSave();
  }
}

export function buildWorkspaceExportJSON(workspaceName, workspaceId = '') {
  return CoreStorage.exportWorkspaceJSON(workspaceName, workspaceId);
}

function workspaceBackupError(message, code = 'WORKSPACE_BACKUP_INVALID') {
  return Object.assign(new Error(message), { code });
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (const char of String(value || '')) {
    const point = char.codePointAt(0) || 0;
    if (point <= 0x7f) bytes += 1;
    else if (point <= 0x7ff) bytes += 2;
    else if (point <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export function assertWorkspaceBackupFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw workspaceBackupError('Workspace Backup size is invalid.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
  if (bytes > WORKSPACE_BACKUP_LIMITS.maxBytes) {
    throw workspaceBackupError(
      `Workspace Backup is too large (${bytes} bytes; maximum ${WORKSPACE_BACKUP_LIMITS.maxBytes}).`,
      'WORKSPACE_BACKUP_LIMIT_EXCEEDED'
    );
  }
  return bytes;
}

function validateWorkspaceJsonComplexity(value) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) continue;
    nodes += 1;
    if (nodes > WORKSPACE_BACKUP_LIMITS.maxJsonNodes) {
      throw workspaceBackupError('Workspace Backup contains too many JSON values.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
    }
    if (entry.depth > WORKSPACE_BACKUP_LIMITS.maxDepth) {
      throw workspaceBackupError('Workspace Backup nesting is too deep.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
    }
    const current = entry.value;
    if (typeof current === 'string') {
      if (current.length > WORKSPACE_BACKUP_LIMITS.maxStringChars) {
        throw workspaceBackupError('Workspace Backup contains an oversized text value.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
      }
      continue;
    }
    if (typeof current === 'number' && !Number.isFinite(current)) {
      throw workspaceBackupError('Workspace Backup contains a non-finite number.');
    }
    if (!current || typeof current !== 'object') continue;
    const keys = Object.keys(current);
    keys.forEach(key => {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw workspaceBackupError(`Workspace Backup contains a prohibited key "${key}".`);
      }
      if (key.length > WORKSPACE_BACKUP_LIMITS.maxStringChars) {
        throw workspaceBackupError('Workspace Backup contains an oversized property name.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
      }
      stack.push({ value: current[key], depth: entry.depth + 1 });
    });
  }
}

function parseWorkspaceJsonWithLimits(jsonText) {
  const text = typeof jsonText === 'string' ? jsonText : String(jsonText || '');
  assertWorkspaceBackupFileSize(utf8ByteLength(text));
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw workspaceBackupError(`Invalid JSON: ${error && error.message ? error.message : 'parse failed'}`);
  }
  validateWorkspaceJsonComplexity(raw);
  return Utils.sanitizeJSON(raw);
}

function requireWorkspaceRecord(value, label) {
  if (!isPlainRecord(value)) throw workspaceBackupError(`Invalid ${label}: expected an object.`);
  return value;
}

function requireWorkspaceText(value, label, { optional = false, nonBlank = false } = {}) {
  if (value == null && optional) return;
  if (typeof value !== 'string') throw workspaceBackupError(`Invalid ${label}: expected text.`);
  if (nonBlank && !value.trim()) throw workspaceBackupError(`Invalid ${label}: value is blank.`);
}

function requireFiniteNumber(value, label, {
  positive = false,
  max = Infinity,
  strictNumber = true,
} = {}) {
  if (strictNumber && typeof value !== 'number') {
    throw workspaceBackupError(`Invalid ${label}: expected a number.`);
  }
  const number = typeof value === 'number' ? value : Number(String(value == null ? '' : value).trim());
  if (!Number.isFinite(number) || (positive ? number <= 0 : false) || number > max) {
    throw workspaceBackupError(`Invalid ${label}: malformed physical value.`);
  }
  return number;
}

function validateWorkspaceCase(caseData, index, { legacy }) {
  const label = `caseLibrary[${index}]`;
  if (!legacy && Object.prototype.hasOwnProperty.call(caseData, 'volume')) {
    throw workspaceBackupError(`Invalid ${label}.volume: derived values are not portable.`);
  }
  requireWorkspaceText(caseData.name, `${label}.name`, { nonBlank: true });
  const dimensions = requireWorkspaceRecord(caseData.dimensions, `${label}.dimensions`);
  ['length', 'width', 'height'].forEach(axis => {
    const parsed = parseCargoDimension(dimensions[axis]);
    if (!parsed.valid || (!legacy && typeof dimensions[axis] !== 'number')) {
      throw workspaceBackupError(`Invalid ${label}.dimensions.${axis}: expected a positive canonical dimension.`);
    }
  });
  if (!legacy || caseData.weight != null) {
    const parsedWeight = parseCargoNonNegNumber(caseData.weight, { max: WEIGHT_MAX_LBS });
    if (!parsedWeight.valid || (!legacy && typeof caseData.weight !== 'number')) {
      throw workspaceBackupError(`Invalid ${label}.weight: expected a canonical non-negative weight.`);
    }
  }
  if (caseData.maxPalletWeight != null) {
    const parsed = parseCargoNonNegNumber(caseData.maxPalletWeight, { max: PALLET_WEIGHT_MAX_LBS });
    if (!parsed.valid || (!legacy && typeof caseData.maxPalletWeight !== 'number')) {
      throw workspaceBackupError(`Invalid ${label}.maxPalletWeight.`);
    }
  }
  if (caseData.maxStackCount != null) {
    if (
      !parseCargoCount(caseData.maxStackCount).valid ||
      (!legacy && typeof caseData.maxStackCount !== 'number')
    ) {
      throw workspaceBackupError(`Invalid ${label}.maxStackCount.`);
    }
  }
  if (caseData.loadPriority != null) {
    if (
      !parseCargoLoadPriority(caseData.loadPriority).valid ||
      (!legacy && typeof caseData.loadPriority !== 'number')
    ) {
      throw workspaceBackupError(`Invalid ${label}.loadPriority.`);
    }
  }
  ['canFlip', 'noStackOnTop', 'isPallet', 'stackable', 'mustLoadLast', 'mustUnloadFirst'].forEach(field => {
    if (caseData[field] != null) {
      if (
        !parseCargoBoolean(caseData[field], field === 'stackable').valid ||
        (!legacy && typeof caseData[field] !== 'boolean')
      ) {
        throw workspaceBackupError(`Invalid ${label}.${field}.`);
      }
    }
  });
  if (caseData.laneItem != null) {
    if (!parseCargoLane(caseData.laneItem).valid || (!legacy && typeof caseData.laneItem !== 'boolean')) {
      throw workspaceBackupError(`Invalid ${label}.laneItem.`);
    }
  }
  if (caseData.shape != null) {
    if (!parseCargoShape(caseData.shape).valid || (!legacy && typeof caseData.shape !== 'string')) {
      throw workspaceBackupError(`Invalid ${label}.shape.`);
    }
  }
  if (
    !legacy &&
    caseData.orientationLock != null &&
    (typeof caseData.orientationLock !== 'string' || !['any', 'upright', 'onSide'].includes(caseData.orientationLock))
  ) {
    throw workspaceBackupError(`Invalid ${label}.orientationLock.`);
  }
  ['createdAt', 'updatedAt'].forEach(field => {
    if (caseData[field] != null) {
      requireFiniteNumber(caseData[field], `${label}.${field}`, { strictNumber: !legacy });
    }
  });
  requireWorkspaceText(caseData.notes, `${label}.notes`, { optional: true });
  requireWorkspaceText(caseData.itemCode, `${label}.itemCode`, { optional: true });
  requireWorkspaceText(caseData.color, `${label}.color`, { optional: true });
}

function validateWorkspaceInstance(instance, packIndex, instanceIndex, { legacy }) {
  const label = `packLibrary[${packIndex}].cases[${instanceIndex}]`;
  const transform = requireWorkspaceRecord(instance.transform, `${label}.transform`);
  const position = requireWorkspaceRecord(transform.position, `${label}.transform.position`);
  const rotation = requireWorkspaceRecord(transform.rotation, `${label}.transform.rotation`);
  const scale = requireWorkspaceRecord(transform.scale, `${label}.transform.scale`);
  ['x', 'y', 'z'].forEach(axis => {
    requireFiniteNumber(position[axis], `${label}.transform.position.${axis}`, { strictNumber: !legacy });
    requireFiniteNumber(rotation[axis], `${label}.transform.rotation.${axis}`, { strictNumber: !legacy });
    requireFiniteNumber(scale[axis], `${label}.transform.scale.${axis}`, {
      positive: true,
      max: 1000,
      strictNumber: !legacy,
    });
  });
  if (instance.orientedDims != null) {
    const oriented = requireWorkspaceRecord(instance.orientedDims, `${label}.orientedDims`);
    ['length', 'width', 'height'].forEach(axis => {
      requireFiniteNumber(oriented[axis], `${label}.orientedDims.${axis}`, {
        positive: true,
        max: DIMENSION_MAX_INCHES,
        strictNumber: !legacy,
      });
    });
  }
  if (instance.deliverySequence != null) {
    requireFiniteNumber(instance.deliverySequence, `${label}.deliverySequence`, { strictNumber: !legacy });
  }
  if (instance.placement != null && instance.placement !== 'packed' && instance.placement !== 'staged') {
    throw workspaceBackupError(`Invalid ${label}.placement.`);
  }
  if (instance.hidden != null && typeof instance.hidden !== 'boolean') {
    throw workspaceBackupError(`Invalid ${label}.hidden.`);
  }
  if (instance.orientationLocked != null && typeof instance.orientationLocked !== 'boolean') {
    throw workspaceBackupError(`Invalid ${label}.orientationLocked.`);
  }
  if (instance.lockedRotation != null) {
    const lockedRotation = requireWorkspaceRecord(instance.lockedRotation, `${label}.lockedRotation`);
    ['x', 'y', 'z'].forEach(axis => {
      requireFiniteNumber(lockedRotation[axis], `${label}.lockedRotation.${axis}`, { strictNumber: !legacy });
    });
  }
  if (instance.packedProfile != null && instance.packedProfile !== 'max-capacity') {
    throw workspaceBackupError(`Invalid ${label}.packedProfile.`);
  }
  if (instance.packedProfile === 'max-capacity' && instance.placement !== 'packed') {
    throw workspaceBackupError(`Invalid ${label}.packedProfile: only packed instances may carry it.`);
  }
  requireWorkspaceText(instance.instanceNotes, `${label}.instanceNotes`, { optional: true });
}

function validateWorkspacePack(pack, packIndex, { legacy }) {
  const label = `packLibrary[${packIndex}]`;
  if (!legacy) {
    ['stats', 'thumbnail', 'thumbnailUpdatedAt', 'thumbnailSource', 'autoPackAlternatives',
      'autopackAlternatives', 'packingSolutions', 'solutions'].forEach(field => {
      if (Object.prototype.hasOwnProperty.call(pack, field)) {
        throw workspaceBackupError(`Invalid ${label}.${field}: transient values are not portable.`);
      }
    });
  }
  requireWorkspaceText(pack.title, `${label}.title`, { nonBlank: true });
  requireWorkspaceText(pack.notes, `${label}.notes`, { optional: true });
  requireWorkspaceText(pack.loadPlanNumber, `${label}.loadPlanNumber`, { optional: legacy });
  requireWorkspaceText(pack.customerReference, `${label}.customerReference`, { optional: true });
  const truck = requireWorkspaceRecord(pack.truck, `${label}.truck`);
  ['length', 'width', 'height'].forEach(axis => {
    const parsed = parseCargoDimension(truck[axis]);
    if (!parsed.valid || (!legacy && typeof truck[axis] !== 'number')) {
      throw workspaceBackupError(`Invalid ${label}.truck.${axis}: expected a positive canonical dimension.`);
    }
  });
  if (
    truck.shapeMode != null &&
    truck.shapeMode !== 'rect' &&
    truck.shapeMode !== 'wheelWells' &&
    truck.shapeMode !== 'frontBonus'
  ) {
    throw workspaceBackupError(`Invalid ${label}.truck.shapeMode.`);
  }
  if (truck.shapeConfig != null) {
    const shapeConfig = requireWorkspaceRecord(truck.shapeConfig, `${label}.truck.shapeConfig`);
    const configLimits = {
      wellHeight: Number(truck.height),
      wellWidth: Number(truck.width) / 2,
      wellLength: Number(truck.length),
      wellOffsetFromRear: Number(truck.length),
      bonusLength: Number(truck.length),
      bonusHeight: Number(truck.height),
      bonusWidth: Number(truck.width),
    };
    Object.entries(configLimits).forEach(([field, max]) => {
      if (!Object.prototype.hasOwnProperty.call(shapeConfig, field)) return;
      const value = requireFiniteNumber(shapeConfig[field], `${label}.truck.shapeConfig.${field}`, {
        max,
        strictNumber: !legacy,
      });
      if (value < 0) {
        throw workspaceBackupError(`Invalid ${label}.truck.shapeConfig.${field}: value must not be negative.`);
      }
    });
    const wellLength = Number(shapeConfig.wellLength);
    const wellOffset = Number(shapeConfig.wellOffsetFromRear);
    if (
      Number.isFinite(wellLength) &&
      Number.isFinite(wellOffset) &&
      wellLength + wellOffset > Number(truck.length)
    ) {
      throw workspaceBackupError(
        `Invalid ${label}.truck.shapeConfig: wheel-well length extends beyond the truck.`
      );
    }
  }
  if (!Array.isArray(pack.cases)) throw workspaceBackupError(`Invalid ${label}.cases: expected an array.`);
  pack.cases.forEach((instance, instanceIndex) => {
    validateWorkspaceInstance(instance, packIndex, instanceIndex, { legacy });
  });
  ['createdAt', 'lastEdited'].forEach(field => {
    if (pack[field] != null) {
      requireFiniteNumber(pack[field], `${label}.${field}`, { strictNumber: !legacy });
    }
  });
}

function validateWorkspaceFolder(folder, index) {
  const label = `folderLibrary[${index}]`;
  requireWorkspaceText(folder.name, `${label}.name`, { nonBlank: true });
  if (folder.scope != null && folder.scope !== 'pack') {
    throw workspaceBackupError(`Invalid ${label}.scope.`);
  }
  if (folder.sortOrder != null) {
    const sortOrder = requireFiniteNumber(folder.sortOrder, `${label}.sortOrder`, { max: Number.MAX_SAFE_INTEGER });
    if (sortOrder < 0 || !Number.isInteger(sortOrder)) {
      throw workspaceBackupError(`Invalid ${label}.sortOrder.`);
    }
  }
  ['createdAt', 'updatedAt'].forEach(field => {
    if (folder[field] != null) requireFiniteNumber(folder[field], `${label}.${field}`);
  });
}

function categoryFallbackName(key) {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Imported Category';
}

function validateWorkspaceCategories(data, cases, { legacy }) {
  if (Object.prototype.hasOwnProperty.call(data, 'categories') && !Array.isArray(data.categories)) {
    throw workspaceBackupError('Invalid categories: expected an array.');
  }
  const rawCategories = Array.isArray(data.categories) ? data.categories : [];
  if (rawCategories.length > WORKSPACE_BACKUP_LIMITS.maxCategories) {
    throw workspaceBackupError('Workspace Backup contains too many categories.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
  const referencedKeys = new Set();
  cases.forEach((caseData, index) => {
    if (caseData.category == null && legacy) {
      referencedKeys.add('default');
      return;
    }
    if (typeof caseData.category !== 'string' || !caseData.category.trim()) {
      throw workspaceBackupError(`Invalid caseLibrary[${index}].category: blank or missing reference.`);
    }
    referencedKeys.add(caseData.category.trim().toLowerCase());
  });

  const categoryByKey = new Map();
  rawCategories.forEach((category, index) => {
    if (!isPlainRecord(category)) {
      throw workspaceBackupError(`Invalid categories[${index}]: expected an object.`);
    }
    const key = typeof category.key === 'string' ? category.key.trim().toLowerCase() : '';
    if (!key) throw workspaceBackupError(`Invalid categories[${index}].key: blank or missing id.`);
    if (categoryByKey.has(key)) throw workspaceBackupError(`Invalid categories: duplicate key "${key}".`);
    requireWorkspaceText(category.name, `categories[${index}].name`, { nonBlank: !legacy });
    requireWorkspaceText(category.color, `categories[${index}].color`, { nonBlank: !legacy });
    const color = category.color == null ? null : String(category.color).trim().toLowerCase();
    if (color && !/^#[0-9a-f]{6}$/.test(color)) {
      throw workspaceBackupError(`Invalid categories[${index}].color.`);
    }
    if (!legacy && !referencedKeys.has(key)) {
      throw workspaceBackupError(`Invalid categories[${index}]: category "${key}" is not referenced by any Case.`);
    }
    categoryByKey.set(key, {
      key,
      name: category.name == null ? null : String(category.name).trim(),
      color,
    });
  });

  const builtInKeys = new Set(
    (Defaults.categories || [])
      .map(category => String((category && category.key) || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const warnings = [];
  referencedKeys.forEach(key => {
    if (builtInKeys.has(key) || categoryByKey.has(key)) return;
    if (!legacy) {
      throw workspaceBackupError(`Invalid category reference "${key}": portable metadata is missing.`);
    }
    const sourceCase = cases.find(caseData =>
      String((caseData && caseData.category) || 'default').trim().toLowerCase() === key
    );
    const sourceColor = String((sourceCase && sourceCase.color) || '').trim().toLowerCase();
    categoryByKey.set(key, {
      key,
      name: categoryFallbackName(key),
      color: /^#[0-9a-f]{6}$/.test(sourceColor) ? sourceColor : '#9ca3af',
    });
    warnings.push(`Legacy category "${key}" had no portable metadata; display metadata was reconstructed.`);
  });

  return {
    categories: Array.from(categoryByKey.values()).filter(category => referencedKeys.has(category.key)),
    warnings,
  };
}

function validateWorkspaceRestoreData(data, { legacy }) {
  if (!legacy && (Object.prototype.hasOwnProperty.call(data, 'preferences') ||
      Object.prototype.hasOwnProperty.call(data, 'currentPackId'))) {
    throw workspaceBackupError('Workspace Backup contains non-portable preference or navigation state.');
  }
  if (!legacy && !Array.isArray(data.folderLibrary)) {
    throw workspaceBackupError('Invalid folderLibrary: expected an array.');
  }
  const { cases, packs, folders } = validateWorkspaceGraph(data, { requirePreferences: false });
  if (cases.length > WORKSPACE_BACKUP_LIMITS.maxCases) {
    throw workspaceBackupError('Workspace Backup contains too many Cases.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
  if (packs.length > WORKSPACE_BACKUP_LIMITS.maxPacks) {
    throw workspaceBackupError('Workspace Backup contains too many Load Plans.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
  if (folders.length > WORKSPACE_BACKUP_LIMITS.maxFolders) {
    throw workspaceBackupError('Workspace Backup contains too many folders.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
  const instanceCount = packs.reduce((total, pack) =>
    total + (pack && Array.isArray(pack.cases) ? pack.cases.length : 0), 0);
  if (instanceCount > WORKSPACE_BACKUP_LIMITS.maxInstances) {
    throw workspaceBackupError('Workspace Backup contains too many instances.', 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }

  cases.forEach((caseData, index) => validateWorkspaceCase(caseData, index, { legacy }));
  packs.forEach((pack, index) => validateWorkspacePack(pack, index, { legacy }));
  folders.forEach(validateWorkspaceFolder);

  const warnings = [];
  let identityPacks = packs;
  if (legacy) {
    const missingLoadPlanNumbers = packs.filter(pack =>
      !pack || typeof pack.loadPlanNumber !== 'string' || !pack.loadPlanNumber.trim()
    ).length;
    if (missingLoadPlanNumbers) {
      identityPacks = migrateLoadPlanNumbers(packs).packLibrary;
      warnings.push(`${missingLoadPlanNumbers} legacy Load Plan Number(s) were generated during preflight.`);
    }
  }
  const identities = normalizeBusinessIdentityLibraries(cases, identityPacks);
  const categoryValidation = validateWorkspaceCategories(data, identities.caseLibrary, { legacy });
  warnings.push(...categoryValidation.warnings);
  const sanitizedPacks = CoreNormalizer.sanitizeLegacyPackQuantityLibrary(identities.packLibrary).packLibrary;
  if (sanitizedPacks.some((pack, index) => pack !== identities.packLibrary[index])) {
    warnings.push('Obsolete legacy quantity targets were removed; physical instances were preserved.');
  }

  return {
    caseLibrary: identities.caseLibrary,
    packLibrary: sanitizedPacks,
    folderLibrary: folders,
    categories: categoryValidation.categories,
    instanceCount,
    warnings,
  };
}

function requireValidWorkspaceCreatedAt(value) {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw workspaceBackupError('Workspace Backup createdAt is missing or invalid.');
  }
  return value;
}

/**
 * Parse and fully validate a Workspace Backup before normalization or mutation.
 * New v1 files are strict. Legacy `exportType: workspace` files adapt into the
 * same DTO with explicit migration warnings and keep folderless compatibility.
 */
export function parseWorkspaceImportJSON(jsonText) {
  const parsed = parseWorkspaceJsonWithLimits(jsonText);
  if (!isPlainRecord(parsed)) throw workspaceBackupError('Invalid JSON: expected an object.');

  if (isCargoPlannerEnvelope(parsed)) {
    const envelope = parseCargoPlannerEnvelope(parsed, { expectedKinds: [IMPORT_KIND.WORKSPACE_BACKUP] });
    const validated = validateWorkspaceRestoreData(envelope.data, { legacy: false });
    const scope = envelope.scope || {};
    return {
      ...validated,
      workspaceName: typeof scope.sourceWorkspaceName === 'string' ? scope.sourceWorkspaceName : '',
      sourceWorkspaceId: typeof scope.sourceWorkspaceId === 'string' ? scope.sourceWorkspaceId : '',
      schemaVersion: envelope.schemaVersion,
      createdAt: requireValidWorkspaceCreatedAt(envelope.createdAt),
      appVersion: envelope.appVersion,
      legacy: false,
      warnings: validated.warnings,
    };
  }

  if (parsed.exportType !== 'workspace') {
    throw workspaceBackupError(
      'Not a workspace export file. Please use a file exported with "Export Workspace Backup".'
    );
  }
  const data = requireWorkspaceRecord(parsed.data, 'workspace export data');
  const hadFolderLibrary = Object.prototype.hasOwnProperty.call(data, 'folderLibrary');
  const validated = validateWorkspaceRestoreData(data, { legacy: true });
  const warnings = ['Legacy Workspace Backup adapted to the current Replace restore contract.'];
  if (!hadFolderLibrary) warnings.push('Legacy backup had no folder library; an empty folder list will be restored.');
  warnings.push(...validated.warnings);
  const exportedAt = Number(parsed.exportedAt);
  const createdAt = Number.isFinite(exportedAt) && exportedAt > 0
    ? new Date(exportedAt).toISOString()
    : null;
  return {
    ...validated,
    workspaceName: parsed.workspaceName ? String(parsed.workspaceName) : '',
    sourceWorkspaceId: '',
    schemaVersion: 'legacy',
    createdAt,
    appVersion: parsed.appVersion ? String(parsed.appVersion) : null,
    legacy: true,
    warnings,
  };
}

function buildWorkspaceRestoreCategorySlice(cases, categories) {
  const referenced = [];
  const seen = new Set();
  (cases || []).forEach(caseData => {
    const key = String((caseData && caseData.category) || 'default').trim().toLowerCase() || 'default';
    if (!seen.has(key)) {
      seen.add(key);
      referenced.push(key);
    }
  });
  const importedByKey = new Map(
    (categories || []).map(category => [String(category.key || '').trim().toLowerCase(), category])
  );
  const builtInByKey = new Map(
    (Defaults.categories || [])
      .filter(category => category && category.key && category.key !== 'all')
      .map(category => [String(category.key).trim().toLowerCase(), category])
  );
  if (!importedByKey.size) return [];
  return referenced
    .map(key => importedByKey.get(key) || builtInByKey.get(key) || null)
    .filter(Boolean)
    .map(category => ({
      key: String(category.key).trim().toLowerCase(),
      name: category.name ? String(category.name) : null,
      color: category.color ? String(category.color).toLowerCase() : null,
    }));
}

function positionsDiffer(before, after) {
  if (!before || !after) return true;
  return ['x', 'y', 'z'].some(axis =>
    Math.abs(Number(before[axis]) - Number(after[axis])) > PackLibrary.PLACEMENT_EPS
  );
}

/** Pure Workspace Replace preflight. No StateStore or storage writes occur. */
export function planWorkspaceRestore(imported, {
  currentState = AppStateStore.snapshot(),
  destinationWorkspaceId = '',
  destinationWorkspaceName = '',
} = {}) {
  if (
    !imported ||
    !Array.isArray(imported.caseLibrary) ||
    !Array.isArray(imported.packLibrary) ||
    !Array.isArray(imported.folderLibrary) ||
    !Array.isArray(imported.categories)
  ) {
    throw workspaceBackupError('Workspace Restore requires a validated Workspace Backup DTO.');
  }
  const previous = currentState && typeof currentState === 'object' ? currentState : {};
  const normalized = CoreNormalizer.normalizeAppData({
    caseLibrary: imported.caseLibrary,
    packLibrary: imported.packLibrary,
    folderLibrary: imported.folderLibrary,
    preferences: previous.preferences || {},
    currentPackId: null,
  });
  if (
    normalized.caseLibrary.length !== imported.caseLibrary.length ||
    normalized.packLibrary.length !== imported.packLibrary.length ||
    normalized.folderLibrary.length !== imported.folderLibrary.length
  ) {
    throw workspaceBackupError('Workspace Restore normalization changed graph cardinality.');
  }

  let placementsPreserved = 0;
  let placementsRepaired = 0;
  let placementsStaged = 0;
  const repairedPacks = normalized.packLibrary.map(pack => {
    const beforeInstances = Array.isArray(pack.cases) ? pack.cases : [];
    const repaired = PackLibrary.repairRestoredPackPlacements(pack, normalized.caseLibrary);
    const afterInstances = Array.isArray(repaired.cases) ? repaired.cases : [];
    if (afterInstances.length !== beforeInstances.length) {
      throw workspaceBackupError('Workspace Restore placement repair changed instance cardinality.');
    }
    afterInstances.forEach((instance, index) => {
      const before = beforeInstances[index] || {};
      const beforePosition = before.transform && before.transform.position;
      const afterPosition = instance && instance.transform && instance.transform.position;
      const placementChanged = before.placement !== instance.placement;
      const positionChanged = positionsDiffer(beforePosition, afterPosition);
      if (instance.placement === 'staged' && before.placement !== 'staged') placementsStaged += 1;
      else if (placementChanged || positionChanged) placementsRepaired += 1;
      else placementsPreserved += 1;
    });
    return {
      ...repaired,
      stats: PackLibrary.computeStats(repaired, normalized.caseLibrary),
      thumbnail: null,
      thumbnailUpdatedAt: null,
      thumbnailSource: null,
    };
  });

  const expectedInstances = imported.packLibrary.reduce((total, pack) =>
    total + (pack && Array.isArray(pack.cases) ? pack.cases.length : 0), 0);
  const actualInstances = repairedPacks.reduce((total, pack) => total + pack.cases.length, 0);
  if (actualInstances !== expectedInstances) {
    throw workspaceBackupError('Workspace Restore normalization changed instance cardinality.');
  }

  const categorySlice = buildWorkspaceRestoreCategorySlice(normalized.caseLibrary, imported.categories);
  const plan = {
    mode: 'replace',
    sourceWorkspaceName: imported.workspaceName || '',
    sourceWorkspaceId: imported.sourceWorkspaceId || '',
    destinationWorkspaceId: String(destinationWorkspaceId || '').trim(),
    destinationWorkspaceName: String(destinationWorkspaceName || '').trim(),
    schemaVersion: imported.schemaVersion,
    createdAt: imported.createdAt || null,
    appVersion: imported.appVersion || null,
    legacy: Boolean(imported.legacy),
    warnings: Array.isArray(imported.warnings) ? [...imported.warnings] : [],
    integrityErrors: [],
    counts: {
      cases: normalized.caseLibrary.length,
      packs: repairedPacks.length,
      folders: normalized.folderLibrary.length,
      categories: imported.categories.length,
      instances: actualInstances,
    },
    placementsPreserved,
    placementsRepaired,
    placementsStaged,
    caseLibrary: normalized.caseLibrary,
    packLibrary: repairedPacks,
    folderLibrary: normalized.folderLibrary,
    categorySlice,
  };
  Object.defineProperty(plan, WORKSPACE_RESTORE_PLAN, { value: true });
  return plan;
}

export function canRestoreWorkspace(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized === 'owner' || normalized === 'admin';
}

/**
 * @param {{ role?: string, destinationWorkspaceId?: string,
 *   plannedDestinationWorkspaceId?: string, originScope?: any }} [options]
 */
export function assertWorkspaceRestoreAuthorized({
  role,
  destinationWorkspaceId,
  plannedDestinationWorkspaceId,
  originScope,
} = {}) {
  if (!canRestoreWorkspace(role)) {
    throw workspaceBackupError(
      'Workspace Restore requires an Owner or Admin role in the active destination workspace.',
      WORKSPACE_RESTORE_FORBIDDEN
    );
  }
  const destinationId = String(destinationWorkspaceId || '').trim();
  const plannedId = String(plannedDestinationWorkspaceId || '').trim();
  if (
    !destinationId ||
    !originScope ||
    originScope.workspaceScope !== destinationId ||
    (plannedId && plannedId !== destinationId)
  ) {
    throw Object.assign(new Error(CoreStorage.IMPORT_SCOPE_CHANGED_MESSAGE), {
      code: 'IMPORT_SCOPE_CHANGED',
    });
  }
  return true;
}

/**
 * Commit a validated Workspace Replace plan through the exact Milestone A
 * scoped recovery transaction. Source-file workspace metadata is never used
 * for authorization or destination selection.
 * @param {Record<string, any>} plan
 * @param {{ StateStore?: any, Storage?: any, originScope?: any,
 *   pauseAutoSave?: Function, authorization?: { role?: string,
 *   destinationWorkspaceId?: string } }} [options]
 */
export function restoreWorkspaceImport(plan, {
  StateStore,
  Storage = CoreStorage,
  originScope,
  pauseAutoSave,
  authorization,
} = {}) {
  if (!plan || /** @type {any} */ (plan)[WORKSPACE_RESTORE_PLAN] !== true) {
    throw workspaceBackupError('Workspace Restore requires a completed preflight plan.');
  }
  if (!StateStore || typeof StateStore.snapshot !== 'function') {
    throw new Error('Workspace restore requires StateStore');
  }
  Storage.assertScopeContextCurrent(originScope);
  assertWorkspaceRestoreAuthorized({
    ...(authorization || {}),
    plannedDestinationWorkspaceId: plan.destinationWorkspaceId,
    originScope,
  });
  Storage.assertScopeContextCurrent(originScope);
  const currentState = StateStore.snapshot();
  const currentPreferences = currentState && currentState.preferences && typeof currentState.preferences === 'object'
    ? currentState.preferences
    : {};
  const imported = {
    caseLibrary: plan.caseLibrary,
    packLibrary: plan.packLibrary,
    folderLibrary: plan.folderLibrary,
    preferences: {
      ...currentPreferences,
      categories: plan.categorySlice,
    },
  };
  const result = restoreAppImport(imported, {
    StateStore,
    Storage,
    originScope,
    pauseAutoSave,
  });
  return { ...result, plan };
}
