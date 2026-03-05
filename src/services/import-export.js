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

function indexMap(headers) {
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
    notes: find(['notes', 'note', 'description', 'desc']),
    color: find(['color', 'hex', 'casecolor']),
  };
}

function getField(row, idx) {
  if (idx == null) return '';
  return row[idx];
}

function parseBool(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  if (!s) return false;
  return ['true', '1', 'yes', 'y', 'on'].includes(s);
}

export function buildCasesTemplateCSV() {
  return [
    'name,manufacturer,category,length,width,height,weight,canFlip,notes',
    'Line Array Case,L-Acoustics,audio,48,24,32,125,false,',
    'Truss Section,Global Truss,lighting,120,12,12,45,true,',
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
  const duplicates = [];
  const valid = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(v => String(v || '').trim() === '')) continue;
    const rowNum = r + 1;
    const record = {
      name: String(getField(row, idx.name)).trim(),
      manufacturer: String(getField(row, idx.manufacturer)).trim(),
      category: String(getField(row, idx.category)).trim().toLowerCase() || 'default',
      length: Number(getField(row, idx.length)),
      width: Number(getField(row, idx.width)),
      height: Number(getField(row, idx.height)),
      weight: Number(getField(row, idx.weight)),
      canFlip: parseBool(getField(row, idx.canFlip)),
      notes: String(getField(row, idx.notes)).trim(),
      color: String(getField(row, idx.color)).trim(),
    };

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
      continue;
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }
    seenNames.add(nameKey);
    valid.push(record);
  }

  return { valid, errors, duplicates };
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
    const record = applyCaseDefaultColor({
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
      canFlip: Boolean(r.canFlip),
      notes: String(r.notes || '').trim(),
      color: String(r.color || '').trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    next.push(record);
    added++;
  });
  return { nextCaseLibrary: next, added };
}

export function buildPackExportPayload(pack) {
  return {
    app: 'Truck Packer 3D',
    version: APP_VERSION,
    exportedAt: Date.now(),
    pack,
    bundledCases: (pack.cases || []).map(i => CaseLibrary.getById(i.caseId)).filter(Boolean),
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

export function buildAppExportJSON() {
  return CoreStorage.exportAppJSON();
}

export function parseAppImportJSON(jsonText) {
  return CoreStorage.importAppJSON(jsonText);
}
