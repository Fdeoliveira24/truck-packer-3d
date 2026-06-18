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
import * as CaseLibrary from './case-library.js';
import { APP_VERSION } from '../core/version.js';
import { canonicalOrientationLock } from '../core/orientation.js';
import {
  parseCargoBoolean,
  parseCargoLane,
  parseCargoCount,
  parseCargoNonNegNumber,
  applyCanonicalCargoFields,
  PALLET_WEIGHT_MAX_LBS,
} from '../core/cargo-canonical.js';

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMPORT_EXTENSIONS = new Set(['csv', 'xlsx']);

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

export function indexMap(headers) {
  const find = candidates => {
    for (const c of candidates) {
      const idx = headers.indexOf(c);
      if (idx > -1) return idx;
    }
    return null;
  };
  return {
    name: find(['name', 'casename', 'item', 'title']),
    manufacturer: find(['manufacturer', 'mfg', 'brand']),
    category: find(['category', 'cat', 'type']),
    length: find(['length', 'l']),
    width: find(['width', 'w']),
    height: find(['height', 'h']),
    weight: find(['weight', 'wt']),
    canFlip: find(['canflip', 'flippable', 'canrotate', 'flip']),
    orientationLock: find(['orientationlock', 'orientation', 'orient']),
    noStackOnTop: find(['nostackontop', 'notopload', 'notop', 'donotstackontop']),
    maxStackCount: find(['maxstackcount', 'maxontop', 'maxstack']),
    isPallet: find(['ispallet', 'pallet', 'loadbase', 'base']),
    maxPalletWeight: find(['maxpalletweight', 'maxload', 'palletmaxweight', 'loadwarning']),
    laneItem: find(['laneitem', 'lane', 'longitemlane']),
    loadPriority: find(['loadpriority', 'priority', 'packingpriority']),
    notes: find(['notes', 'note', 'description', 'desc']),
    color: find(['color', 'hex', 'casecolor']),
  };
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
    'name,manufacturer,category,length,width,height,weight,canFlip,orientationLock,noStackOnTop,maxStackCount,isPallet,maxPalletWeight,laneItem,loadPriority,notes',
    'Line Array Case,L-Acoustics,audio,48,24,32,125,false,upright,true,0,false,0,auto,normal,',
    'Truss Section,Global Truss,lighting,120,12,12,45,true,any,false,0,false,0,always,normal,',
    'Equipment Pallet,Generic,default,48,40,6,60,false,any,false,0,true,2000,never,low,',
  ].join('\n');
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
    const laneParsed = parseLaneCellWarned(getField(row, idx.laneItem));
    const record = {
      name: String(getField(row, idx.name)).trim(),
      manufacturer: String(getField(row, idx.manufacturer)).trim(),
      category: String(getField(row, idx.category)).trim().toLowerCase() || 'default',
      length: Number(getField(row, idx.length)),
      width: Number(getField(row, idx.width)),
      height: Number(getField(row, idx.height)),
      weight: Number(getField(row, idx.weight)),
      // Handling rules (Cargo-Rule V1). canFlip only meaningful when policy is 'any'.
      canFlip: orientationParsed.value === 'any' && canFlipParsed.value,
      orientationLock: orientationParsed.value,
      noStackOnTop: noTopParsed.value,
      maxStackCount: maxStackParsed.value,
      isPallet: palletParsed.value,
      maxPalletWeight: palletWeightParsed.value,
      laneItem: laneParsed.value,
      loadPriority: priorityParsed.value,
      notes: String(getField(row, idx.notes)).trim(),
      color: String(getField(row, idx.color)).trim(),
    };

    [orientationParsed.warning, maxStackParsed.warning, palletWeightParsed.warning, priorityParsed.warning,
      canFlipParsed.warning, noTopParsed.warning, palletParsed.warning, laneParsed.warning]
      .filter(Boolean)
      .forEach(w => warnings.push(`Row ${rowNum}: ${w}`));

    const rowErrors = [];
    if (!record.name) rowErrors.push(`Row ${rowNum}: Missing required field 'name'`);
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

    if (rowErrors.length) {
      errors.push(...rowErrors);
      invalidRows.push({ rowNum, record, reasons: rowErrors.map(e => e.replace(`Row ${rowNum}: `, '')) });
      continue;
    }
    seenNames.add(nameKey);
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
  const next = [...(existingCases || [])];
  let added = 0;
  rows.forEach(r => {
    const nameKey = String(r.name || '')
      .trim()
      .toLowerCase();
    if (!nameKey || existingNames.has(nameKey)) return;
    const length = Number(r.length);
    const width = Number(r.width);
    const height = Number(r.height);
    if (!Number.isFinite(length) || length <= 0) return;
    if (!Number.isFinite(width) || width <= 0) return;
    if (!Number.isFinite(height) || height <= 0) return;
    const weightRaw = Number(r.weight);
    const safeWeight = Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : 0;
    existingNames.add(nameKey);
    // Route the handling-rule fields through the single typed canonical
    // representation rather than re-coercing inline (no duplicated parsing rules).
    const record = applyCanonicalCargoFields(
      applyCaseDefaultColor({
        id: Utils.uuid(),
        name: String(r.name || '').trim(),
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

export function buildPackExportPayload(pack) {
  const exportedPack = {
    ...(pack || {}),
    folderId: null,
  };
  const packCases = Array.isArray(pack && pack.cases) ? pack.cases : [];
  return {
    app: 'Truck Packer 3D',
    version: APP_VERSION,
    exportedAt: Date.now(),
    pack: exportedPack,
    bundledCases: packCases.map(i => CaseLibrary.getById(i.caseId)).filter(Boolean),
  };
}

export function buildPackExportJSON(pack) {
  const payload = buildPackExportPayload(pack);
  return JSON.stringify(payload, null, 2);
}

export function parsePackImportJSON(jsonText) {
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
  if (!parsed) throw new Error('Invalid JSON');
  const payload = parsed.pack ? parsed : { pack: parsed };
  return payload;
}

export function parsePackBatchImportJSON(jsonText) {
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON');
  }
  // Guard: reject App JSON mistakenly used here.
  if (Array.isArray(parsed.packLibrary) || Array.isArray(parsed.caseLibrary) || parsed.preferences) {
    throw new Error('This looks like App JSON. Use Import App Backup instead.');
  }
  // Guard: reject Workspace JSON. Workspace import is not available yet — only
  // workspace export exists today, so do not point users at a missing action.
  if (parsed.exportType === 'workspace') {
    throw new Error('This is a Workspace export. Workspace import is not available yet — use a Pack or App Backup file.');
  }
  if (parsed.exportType !== 'pack-batch') {
    throw new Error('Not a pack batch export. Expected exportType "pack-batch".');
  }
  if (!Array.isArray(parsed.packs) || parsed.packs.length === 0) {
    throw new Error('Pack batch file must contain a non-empty packs array.');
  }
  // Normalize each entry to { pack, bundledCases } — same shape importPackPayload expects.
  return parsed.packs.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    return entry.pack ? entry : { pack: entry };
  });
}

export function buildAppExportJSON() {
  return CoreStorage.exportAppJSON();
}

export function parseAppImportJSON(jsonText) {
  return CoreStorage.importAppJSON(jsonText);
}

export function buildWorkspaceExportJSON(workspaceName) {
  return CoreStorage.exportWorkspaceJSON(workspaceName);
}

export function parseWorkspaceImportJSON(jsonText) {
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
  if (parsed.exportType !== 'workspace') {
    throw new Error('Not a workspace export file. Please use a file exported with "Export Workspace Data".');
  }
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  if (!Array.isArray(data.caseLibrary)) throw new Error('Missing caseLibrary in workspace export');
  if (!Array.isArray(data.packLibrary)) throw new Error('Missing packLibrary in workspace export');
  if (data.folderLibrary != null && !Array.isArray(data.folderLibrary)) {
    throw new Error('Invalid folderLibrary in workspace export');
  }
  return {
    caseLibrary: data.caseLibrary,
    packLibrary: data.packLibrary,
    folderLibrary: Array.isArray(data.folderLibrary) ? data.folderLibrary : [],
    workspaceName: parsed.workspaceName ? String(parsed.workspaceName) : '',
  };
}
