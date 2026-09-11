/**
 * @file milestone-c-import-export.spec.mjs
 * @description Behavioral tests for Milestone C — Complete Cases + Load Plan
 *   Exchange: Case Catalog JSON/CSV/XLSX exchange, explicit spreadsheet units,
 *   the v1 Load Plan envelope migration, hidden-instance Case bundling, the
 *   Case semantic conflict (safe-reuse) fix, Load Plan Number conflict
 *   handling, category portability, placement-repair reporting, and batch
 *   Load Plan export/import. Reuses the createRuntime pattern from
 *   tests/audit/import-schema.spec.mjs. A focused new file (rather than
 *   extending that spec or import-export.spec.mjs) keeps this milestone's
 *   many behavioral cases from making either existing file unmanageable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const stateStoreUrl = new URL('../../src/core/state-store.js', import.meta.url);
const importExportUrl = new URL('../../src/services/import-export.js', import.meta.url);
const caseLibraryUrl = new URL('../../src/services/case-library.js', import.meta.url);
const packLibraryUrl = new URL('../../src/services/pack-library.js', import.meta.url);
const categoryServiceUrl = new URL('../../src/services/category-service.js', import.meta.url);

// The real SheetJS vendor bundle (checked into vendor/, loaded via CDN script
// at runtime) is evaluated here as a plain CommonJS module so CSV/XLSX tests
// exercise the ACTUAL RFC-4180 writer/parser the app ships, not a hand-rolled
// stub. Package.json's "type": "module" would otherwise make a bare
// require()/import() of this UMD bundle resolve to an empty namespace.
function loadRealXLSX() {
  const src = fs.readFileSync(`${repoRoot}vendor/xlsx.full.min.js`, 'utf8');
  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', src);
  fn(moduleObj, moduleObj.exports, () => ({}));
  return moduleObj.exports;
}
const RealXLSX = loadRealXLSX();

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => Array.from(values.keys())[index] || null,
    get length() {
      return values.size;
    },
  };
}

async function createRuntime(label) {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: createMemoryStorage(), setTimeout, clearTimeout, XLSX: RealXLSX };
  const StateStore = await import(stateStoreUrl.href);
  const ImportExport = await import(`${importExportUrl.href}?mc=${label}-${Date.now()}-${Math.random()}`);
  const CaseLibrary = await import(`${caseLibraryUrl.href}?mc=${label}-${Date.now()}-${Math.random()}`);
  const PackLibrary = await import(`${packLibraryUrl.href}?mc=${label}-${Date.now()}-${Math.random()}`);
  const CategoryService = await import(`${categoryServiceUrl.href}?mc=${label}-${Date.now()}-${Math.random()}`);
  return {
    StateStore,
    ImportExport,
    CaseLibrary,
    PackLibrary,
    CategoryService,
    cleanup() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

function baseCase(overrides = {}) {
  return {
    id: 'case-1',
    name: 'Line Array Case',
    itemCode: 'LA-001',
    manufacturer: 'L-Acoustics',
    category: 'audio',
    dimensions: { length: 48, width: 24, height: 32 },
    weight: 125,
    shape: 'box',
    stackable: true,
    maxStackCount: 2,
    orientationLock: 'upright',
    noStackOnTop: false,
    isPallet: false,
    maxPalletWeight: 0,
    hazmatClass: null,
    laneItem: null,
    loadPriority: 0,
    mustLoadLast: true,
    mustUnloadFirst: false,
    stopGroup: 'stop-1',
    keepTogetherGroup: 'grp-a',
    canFlip: false,
    notes: 'Handle with care; standard rigging instructions apply.',
    color: '#111111',
    ...overrides,
  };
}

// Default position is a genuinely valid resting pose for baseCase()'s
// 48x24x32 dimensions inside basePack()'s 200x90x90 truck (half-extents
// 24/16/12 keep the AABB safely within [0,200]x[0,90]x[-45,45]) — tests that
// assert "preserved, not repaired" depend on this actually being valid.
function instanceFor(caseId, overrides = {}) {
  return {
    id: overrides.id || `inst-${caseId}`,
    caseId,
    placement: 'packed',
    transform: {
      position: { x: 30, y: 16, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...overrides,
  };
}

function basePack(overrides = {}) {
  return {
    id: 'pack-1',
    title: 'Test Load Plan',
    loadPlanNumber: 'LP-TEST1',
    truck: { length: 200, width: 90, height: 90 },
    cases: [],
    ...overrides,
  };
}

// ── 1. Case Catalog JSON export/import round trip ──────────────────────────

test('MILESTONE-C-1 Case Catalog JSON export round-trips every portable Case field', async () => {
  const rt = await createRuntime('catalog-json-roundtrip');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    CaseLibrary.upsert(baseCase());

    const json = ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases());
    const envelope = JSON.parse(json);
    assert.equal(envelope.format, 'cargo-planner');
    assert.equal(envelope.kind, 'case-catalog');
    assert.equal(envelope.schemaVersion, 1);
    assert.deepEqual(envelope.units, { length: 'in', weight: 'lb' });

    const cases = ImportExport.parseCaseCatalogImportJSON(json);
    assert.equal(cases.length, 1);
    const c = cases[0];
    assert.equal(c.id, 'case-1');
    assert.equal(c.name, 'Line Array Case');
    assert.equal(c.itemCode, 'LA-001');
    assert.equal(c.manufacturer, 'L-Acoustics');
    assert.equal(c.category, 'audio');
    assert.deepEqual(c.dimensions, { length: 48, width: 24, height: 32 });
    assert.equal(c.weight, 125);
    assert.equal(c.shape, 'box');
    assert.equal(c.stackable, true);
    assert.equal(c.maxStackCount, 2);
    assert.equal(c.orientationLock, 'upright');
    assert.equal(c.isPallet, false);
    assert.equal(c.mustLoadLast, true);
    assert.equal(c.mustUnloadFirst, false);
    assert.equal(c.stopGroup, 'stop-1');
    assert.equal(c.keepTogetherGroup, 'grp-a');
    assert.equal(c.notes, 'Handle with care; standard rigging instructions apply.');
    assert.equal(c.color, '#111111');
    assert.equal(Object.prototype.hasOwnProperty.call(c, 'volume'), false,
      'derived volume must not be part of the portable payload');
  } finally {
    rt.cleanup();
  }
});

// ── 2. Case Catalog import conflict semantics ───────────────────────────────

test('MILESTONE-C-2 planCaseCatalogImport reuses an identical case and never overwrites a different local one', async () => {
  const rt = await createRuntime('catalog-reuse');
  try {
    const { StateStore, CaseLibrary } = rt;
    StateStore.init({ caseLibrary: [baseCase()], packLibrary: [], folderLibrary: [], preferences: {} });

    const identicalPlan = CaseLibrary.planCaseCatalogImport([baseCase()]);
    assert.equal(identicalPlan.newCases.length, 0);
    assert.equal(identicalPlan.reused.length, 1);
    assert.equal(identicalPlan.conflicts.length, 0);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-3 planCaseCatalogImport creates a renamed conflict copy when the same id has materially different cargo', async () => {
  const rt = await createRuntime('catalog-conflict');
  try {
    const { StateStore, CaseLibrary } = rt;
    const local = baseCase({ itemCode: 'LA-LOCAL', mustLoadLast: false });
    StateStore.init({ caseLibrary: [local], packLibrary: [], folderLibrary: [], preferences: {} });

    const plan = CaseLibrary.planCaseCatalogImport([baseCase()]); // itemCode LA-001, mustLoadLast true
    assert.equal(plan.newCases.length, 1, 'materially different cargo on the same id must create a new case');
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].kind, 'id-conflict');
    assert.notEqual(plan.newCases[0].id, local.id);
    assert.notEqual(plan.newCases[0].name, local.name);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-4 planCaseCatalogImport rejects an unresolvable Item Code conflict instead of silently duplicating it', async () => {
  const rt = await createRuntime('catalog-itemcode-conflict');
  try {
    const { StateStore, CaseLibrary } = rt;
    const local = baseCase({ id: 'some-other-id', name: 'Different Name' }); // same itemCode LA-001
    StateStore.init({ caseLibrary: [local], packLibrary: [], folderLibrary: [], preferences: {} });

    const plan = CaseLibrary.planCaseCatalogImport([baseCase()]);
    assert.equal(plan.newCases.length, 0);
    assert.equal(plan.rejected.length, 1);
    assert.equal((CaseLibrary.getCases() || []).length, 1, 'planning must never mutate the case library');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-5 planCaseCatalogImport rejects malformed rows (bad id / missing dimensions) and continues past them', async () => {
  const rt = await createRuntime('catalog-malformed');
  try {
    const { StateStore, CaseLibrary } = rt;
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });

    const badId = { ...baseCase(), id: '' };
    const badDims = baseCase({ id: 'bad-dims', dimensions: { length: -1, width: 0, height: 10 } });
    const good = baseCase({ id: 'good-1', name: 'Good Case', itemCode: 'GOOD-1' });
    const plan = CaseLibrary.planCaseCatalogImport([badId, badDims, good]);
    assert.equal(plan.rejected.length, 2);
    assert.equal(plan.newCases.length, 1);
    assert.equal(plan.newCases[0].id, 'good-1');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-6 importCaseCatalogPayload commits the plan atomically to the Case Library', async () => {
  const rt = await createRuntime('catalog-commit');
  try {
    const { StateStore, CaseLibrary } = rt;
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const plan = CaseLibrary.importCaseCatalogPayload([baseCase()]);
    assert.equal(plan.newCases.length, 1);
    assert.equal(CaseLibrary.getCases().length, 1);
    assert.equal(CaseLibrary.getCases()[0].itemCode, 'LA-001');
  } finally {
    rt.cleanup();
  }
});

// ── 3. Case Catalog CSV/XLSX round trip ─────────────────────────────────────

test('MILESTONE-C-7 Case Catalog CSV round trip preserves core + operational fields and Item Code', async () => {
  const rt = await createRuntime('csv-roundtrip');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    StateStore.init({ caseLibrary: [baseCase()], packLibrary: [], folderLibrary: [], preferences: {} });

    const { content: csv, mime } = ImportExport.buildCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'csv' });
    assert.equal(mime, 'text/csv');
    assert.match(csv, /Line Array Case/);
    assert.match(csv, /LA-001/);

    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      { name: 'cases.csv', size: csv.length, async text() { return csv; } },
      []
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.valid.length, 1);
    const row = parsed.valid[0];
    assert.equal(row.itemCode, 'LA-001');
    assert.equal(row.mustLoadLast, true);
    assert.equal(row.stopGroup, 'stop-1');
    assert.equal(row.keepTogetherGroup, 'grp-a');
    assert.equal(row.length, 48);
    assert.equal(row.width, 24);
    assert.equal(row.height, 32);
    assert.equal(row.weight, 125);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-8 Case Catalog CSV survives commas, quotes, newlines, and Unicode in notes/name', async () => {
  const rt = await createRuntime('csv-special-chars');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    const tricky = baseCase({
      id: 'tricky',
      itemCode: 'TRK-1',
      name: 'Café Ünïcödé 日本語',
      notes: 'Contains, a comma; a "quoted phrase"; and\na newline. Emoji: 🎉',
    });
    StateStore.init({ caseLibrary: [tricky], packLibrary: [], folderLibrary: [], preferences: {} });

    const { content: csv } = ImportExport.buildCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'csv' });
    assert.match(csv, /Café Ünïcödé 日本語/);

    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      { name: 'unicode.csv', size: csv.length, async text() { return csv; } },
      []
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.valid.length, 1);
    assert.equal(parsed.valid[0].name, 'Café Ünïcödé 日本語');
    assert.match(parsed.valid[0].notes, /Contains, a comma; a "quoted phrase"; and\nA newline\.|Contains, a comma; a "quoted phrase"; and\na newline\./);
    assert.match(parsed.valid[0].notes, /🎉/);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-9 Case Catalog CSV export is safe against spreadsheet formula injection', async () => {
  const rt = await createRuntime('csv-formula-injection');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    const evil = baseCase({ id: 'evil', itemCode: 'EVIL-1', name: '=1+1', notes: '+cmd|/c calc', stopGroup: '@SUM(A1)' });
    StateStore.init({ caseLibrary: [evil], packLibrary: [], folderLibrary: [], preferences: {} });

    const { content: csv } = ImportExport.buildCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'csv' });
    const dataLine = csv.split('\n').find(l => l.includes('EVIL-1'));
    assert.ok(dataLine, 'exported row must be present');
    assert.match(dataLine, /'=1\+1/, 'a leading = must be neutralized with a leading apostrophe');
    assert.doesNotMatch(dataLine, /^=1\+1|,=1\+1,/, 'a raw leading = must never reach the CSV cell');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-10 duplicate normalized spreadsheet headers are rejected clearly', async () => {
  const rt = await createRuntime('csv-duplicate-headers');
  try {
    const { ImportExport } = rt;
    const rows = [
      ['name', 'length', 'width', 'height', 'Name'],
      ['Case A', 10, 10, 10, 'Duplicate Column Value'],
    ];
    globalThis.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => rows },
    };
    await assert.rejects(
      () => ImportExport.parseAndValidateSpreadsheet(
        { name: 'dup.csv', size: 10, async text() { return 'stub'; } },
        []
      ),
      /Duplicate column/
    );
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-11 explicit spreadsheet units convert cm/kg to canonical in/lb', async () => {
  const rt = await createRuntime('csv-units-metric');
  try {
    const { ImportExport } = rt;
    const rows = [
      ['name', 'length', 'width', 'height', 'lengthUnit', 'weight', 'weightUnit'],
      ['Metric Case', 100, 50, 50, 'cm', 10, 'kg'],
    ];
    globalThis.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => rows },
    };
    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      { name: 'metric.csv', size: 10, async text() { return 'stub'; } },
      []
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.valid.length, 1);
    assert.ok(Math.abs(parsed.valid[0].length - 39.3700787) < 0.001);
    assert.ok(Math.abs(parsed.valid[0].weight - 22.0462262) < 0.001);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-12 an unrecognized spreadsheet unit fails closed instead of silently being read as inches/pounds', async () => {
  const rt = await createRuntime('csv-units-unknown');
  try {
    const { ImportExport } = rt;
    const rows = [
      ['name', 'length', 'width', 'height', 'lengthUnit'],
      ['Bad Unit Case', 10, 10, 10, 'furlongs'],
    ];
    globalThis.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => rows },
    };
    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      { name: 'bad-unit.csv', size: 10, async text() { return 'stub'; } },
      []
    );
    assert.equal(parsed.valid.length, 0);
    assert.ok(parsed.errors.some(e => /Unknown length unit/.test(e)));
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-13 a legacy spreadsheet with no unit columns still imports as in/lb (backward compatible)', async () => {
  const rt = await createRuntime('csv-units-legacy');
  try {
    const { ImportExport } = rt;
    const rows = [
      ['name', 'length', 'width', 'height', 'weight'],
      ['Legacy Case', 48, 24, 32, 125],
    ];
    globalThis.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => rows },
    };
    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      { name: 'legacy.csv', size: 10, async text() { return 'stub'; } },
      []
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.valid[0].length, 48);
    assert.equal(parsed.valid[0].weight, 125);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-14 extreme dimension/weight values are clamped with a warning that matches what is actually stored', async () => {
  const rt = await createRuntime('csv-extreme-values');
  try {
    const { StateStore, ImportExport } = rt;
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const rows = [
      ['name', 'length', 'width', 'height', 'weight'],
      ['Huge Case', 1e12, 24, 32, 1e12],
    ];
    globalThis.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => rows },
    };
    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      { name: 'huge.csv', size: 10, async text() { return 'stub'; } },
      []
    );
    assert.equal(parsed.valid.length, 1);
    const rowWarnings = parsed.valid[0].warnings;
    const lengthWarning = rowWarnings.find(w => w.field === 'length');
    assert.ok(lengthWarning, 'an extreme length must produce a warning');
    assert.equal(lengthWarning.fallback, '100000');

    const result = ImportExport.importCaseRows(parsed.valid);
    const stored = result.nextCaseLibrary.find(c => c.name === 'Huge Case');
    assert.equal(stored.dimensions.length, 100000,
      'the warning-stated fallback must equal the value actually stored (single source of truth)');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-15 negative dimensions are rejected, never silently stored as negative', async () => {
  const rt = await createRuntime('negative-dims');
  try {
    const { CaseLibrary } = rt;
    const stored = CaseLibrary.buildStorableCase({
      id: 'neg-1', name: 'Negative Case', dimensions: { length: -10, width: 10, height: 10 }, weight: -5,
    });
    assert.equal(stored.dimensions.length, 0, 'a negative dimension must never be stored as negative');
    assert.equal(stored.weight, 0, 'a negative weight must never be stored as negative');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-16 duplicate Item Codes in a spreadsheet import are skipped, not silently duplicated', async () => {
  const rt = await createRuntime('csv-duplicate-itemcode');
  try {
    const { ImportExport } = rt;
    const rows = [
      ['name', 'itemCode', 'length', 'width', 'height'],
      ['Case One', 'DUP-1', 10, 10, 10],
      ['Case Two', 'DUP-1', 20, 20, 20],
    ];
    globalThis.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => rows },
    };
    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      { name: 'dup-itemcode.csv', size: 10, async text() { return 'stub'; } },
      []
    );
    assert.equal(parsed.valid.length, 1);
    assert.equal(parsed.duplicates.length, 1);
    assert.match(parsed.duplicates[0], /Duplicate Item Code/);
  } finally {
    rt.cleanup();
  }
});

// ── 4. Load Plan v1 envelope ─────────────────────────────────────────────

test('MILESTONE-C-17 Single Load Plan export uses the v1 Cargo Planner envelope (kind: pack)', async () => {
  const rt = await createRuntime('pack-v1-envelope');
  try {
    const { StateStore, ImportExport } = rt;
    const c = baseCase();
    StateStore.init({ caseLibrary: [c], packLibrary: [], folderLibrary: [], preferences: {} });
    const pack = basePack({
      customerReference: 'PO-1',
      notes: 'Load rear-to-front.',
      cases: [instanceFor(c.id, { instanceNotes: 'Fragile.' })],
    });
    const json = ImportExport.buildPackExportJSON(pack);
    const envelope = JSON.parse(json);
    assert.equal(envelope.format, 'cargo-planner');
    assert.equal(envelope.kind, 'pack');
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.data.pack.loadPlanNumber, 'LP-TEST1');
    assert.equal(envelope.data.pack.customerReference, 'PO-1');
    assert.equal(envelope.data.pack.notes, 'Load rear-to-front.');
    assert.equal(envelope.data.pack.cases[0].instanceNotes, 'Fragile.');
    assert.equal(Object.prototype.hasOwnProperty.call(envelope.data.pack, 'stats'), false);

    const parsed = ImportExport.parsePackImportJSON(json);
    assert.equal(parsed.pack.loadPlanNumber, 'LP-TEST1');
    assert.equal(parsed.pack.customerReference, 'PO-1');
    assert.equal(parsed.bundledCases[0].id, c.id);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-18 a hidden-only instance still has its Case bundled and the Load Plan re-imports successfully', async () => {
  const rt = await createRuntime('hidden-instance-bundling');
  try {
    const { StateStore, ImportExport, PackLibrary } = rt;
    const c = baseCase();
    const pack = basePack({
      cases: [instanceFor(c.id, { id: 'hidden-inst', hidden: true, placement: 'staged' })],
    });
    StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

    const payload = ImportExport.buildPackExportPayload(pack);
    assert.equal(payload.bundledCases.length, 1, 'a hidden instance case must still be bundled');

    const json = ImportExport.buildPackExportJSON(pack);
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const imported = PackLibrary.importPackPayload(ImportExport.parsePackImportJSON(json));
    assert.equal(imported.cases.length, 1, 'the hidden-only load plan must import without a missing-case error');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-19 packed and staged instances both survive export/import unchanged', async () => {
  const rt = await createRuntime('packed-staged-survive');
  try {
    const { StateStore, ImportExport, PackLibrary } = rt;
    const c = baseCase();
    const packedInst = instanceFor(c.id, { id: 'packed-1', placement: 'packed' });
    const stagedInst = instanceFor(c.id, { id: 'staged-1', placement: 'staged', transform: { position: { x: -500, y: 16, z: 500 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
    const pack = basePack({ cases: [packedInst, stagedInst] });
    StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

    const json = ImportExport.buildPackExportJSON(pack);
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const imported = PackLibrary.importPackPayload(ImportExport.parsePackImportJSON(json));
    assert.equal(imported.cases.length, 2);
    assert.ok(imported.cases.some(i => i.placement === 'packed'));
    assert.ok(imported.cases.some(i => i.placement === 'staged'));
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-20 truck shape configuration (wheel wells) survives export/import', async () => {
  const rt = await createRuntime('truck-shape-config');
  try {
    const { StateStore, ImportExport, PackLibrary } = rt;
    const c = baseCase();
    const pack = basePack({
      truck: {
        length: 300, width: 96, height: 96, shapeMode: 'wheelWells',
        shapeConfig: { wellHeight: 20, wellWidth: 12, wellLength: 80, wellOffsetFromRear: 40 },
      },
      cases: [],
    });
    StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });
    const json = ImportExport.buildPackExportJSON(pack);
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const imported = PackLibrary.importPackPayload(ImportExport.parsePackImportJSON(json));
    assert.equal(imported.truck.shapeMode, 'wheelWells');
    assert.equal(imported.truck.shapeConfig.wellHeight, 20);
  } finally {
    rt.cleanup();
  }
});

// ── 5. Case semantic conflict (safe reuse) ──────────────────────────────────

test('MILESTONE-C-21 a physically identical bundled Case with a different mustLoadLast is NOT silently reused', async () => {
  const rt = await createRuntime('semantic-conflict-mustloadlast');
  try {
    const { StateStore, PackLibrary } = rt;
    const localCase = baseCase({ id: 'shared-id', itemCode: 'LOCAL-CODE', mustLoadLast: false });
    StateStore.init({ caseLibrary: [localCase], packLibrary: [], folderLibrary: [], preferences: {} });

    const bundledCase = baseCase({ id: 'shared-id', itemCode: 'BUNDLED-CODE', mustLoadLast: true });
    const payload = {
      pack: basePack({ id: 'incoming', cases: [instanceFor('shared-id', { id: 'i1' })] }),
      bundledCases: [bundledCase],
    };
    const plan = PackLibrary.planPackImport(payload);
    assert.equal(plan.newCases.length, 1,
      'a different mustLoadLast must force a new case, never silently reuse the local one');
    assert.equal(plan.caseConflicts.length, 1);
    const importedCase = plan.finalCases.find(c => c.id === plan.pack.cases[0].caseId);
    assert.equal(importedCase.mustLoadLast, true, 'the imported operational rule must survive, not be discarded');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-22 a physically identical bundled Case with a different hazmatClass/stopGroup is NOT silently reused', async () => {
  const rt = await createRuntime('semantic-conflict-hazmat');
  try {
    const { StateStore, PackLibrary } = rt;
    const localCase = baseCase({ id: 'shared-id-2', itemCode: 'LOCAL-CODE-2', hazmatClass: null, stopGroup: '' });
    StateStore.init({ caseLibrary: [localCase], packLibrary: [], folderLibrary: [], preferences: {} });

    const bundledCase = baseCase({ id: 'shared-id-2', itemCode: 'BUNDLED-CODE-2', hazmatClass: 'Class 9', stopGroup: 'stop-hazmat' });
    const payload = {
      pack: basePack({ id: 'incoming-2', cases: [instanceFor('shared-id-2', { id: 'i2' })] }),
      bundledCases: [bundledCase],
    };
    const plan = PackLibrary.planPackImport(payload);
    assert.equal(plan.newCases.length, 1, 'a different hazmatClass/stopGroup must force a new case');
    const importedCase = plan.finalCases.find(c => c.id === plan.pack.cases[0].caseId);
    assert.equal(importedCase.hazmatClass, 'Class 9');
    assert.equal(importedCase.stopGroup, 'stop-hazmat');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-23 a truly identical bundled Case (including operational fields) IS safely reused', async () => {
  const rt = await createRuntime('semantic-safe-reuse');
  try {
    const { StateStore, PackLibrary } = rt;
    const localCase = baseCase({ id: 'shared-id-3', itemCode: 'LOCAL-CODE-3' });
    StateStore.init({ caseLibrary: [localCase], packLibrary: [], folderLibrary: [], preferences: {} });

    const bundledCase = baseCase({ id: 'shared-id-3', itemCode: 'LOCAL-CODE-3' });
    const payload = {
      pack: basePack({ id: 'incoming-3', cases: [instanceFor('shared-id-3', { id: 'i3' })] }),
      bundledCases: [bundledCase],
    };
    const plan = PackLibrary.planPackImport(payload);
    assert.equal(plan.newCases.length, 0, 'a genuinely identical case (including operational fields) must be reused');
    assert.equal(plan.pack.cases[0].caseId, 'shared-id-3');
  } finally {
    rt.cleanup();
  }
});

// ── 6. Load Plan Number conflict ────────────────────────────────────────────

test('MILESTONE-C-24 importing a Load Plan Number that already exists blocks with a distinguishable error (never silently renumbered)', async () => {
  const rt = await createRuntime('lpn-conflict');
  try {
    const { StateStore, PackLibrary } = rt;
    StateStore.init({
      caseLibrary: [],
      packLibrary: [basePack({ id: 'existing', loadPlanNumber: 'LP-CONFLICT' })],
      folderLibrary: [],
      preferences: {},
    });
    const payload = { pack: basePack({ id: 'incoming', loadPlanNumber: 'LP-CONFLICT', cases: [] }), bundledCases: [] };
    assert.throws(
      () => PackLibrary.planPackImport(payload),
      err => err && err.name === 'BusinessIdentityError' && err.field === 'loadPlanNumber' && err.code === 'not_unique'
    );
    assert.equal((PackLibrary.getPacks() || []).length, 1, 'preflight must never mutate state');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-25 clearing the conflicting Load Plan Number lets the same file import with a freshly generated number', async () => {
  const rt = await createRuntime('lpn-conflict-resolved');
  try {
    const { StateStore, PackLibrary } = rt;
    StateStore.init({
      caseLibrary: [],
      packLibrary: [basePack({ id: 'existing', loadPlanNumber: 'LP-CONFLICT' })],
      folderLibrary: [],
      preferences: {},
    });
    const payload = { pack: basePack({ id: 'incoming', loadPlanNumber: 'LP-CONFLICT', cases: [] }), bundledCases: [] };
    payload.pack.loadPlanNumber = null; // simulates the dialog's "Assign New Load Plan Number" retry
    const plan = PackLibrary.planPackImport(payload);
    assert.match(plan.pack.loadPlanNumber, /^LP-/);
    assert.notEqual(plan.pack.loadPlanNumber, 'LP-CONFLICT');
  } finally {
    rt.cleanup();
  }
});

// ── 7. Category portability ─────────────────────────────────────────────────

test('MILESTONE-C-26 a Load Plan export carries only the categories its bundled Cases reference, not the whole Preferences object', async () => {
  const rt = await createRuntime('category-scope');
  try {
    const { StateStore, ImportExport } = rt;
    const audioCase = baseCase({ id: 'audio-case', category: 'audio' });
    StateStore.init({
      caseLibrary: [audioCase],
      packLibrary: [],
      folderLibrary: [],
      preferences: {
        categories: [
          { key: 'audio', name: 'Audio Gear', color: '#f59e0b' },
          { key: 'lighting', name: 'Lighting Rig', color: '#3b82f6' },
        ],
        theme: 'dark',
      },
    });
    const pack = basePack({ cases: [instanceFor('audio-case')] });
    const payload = ImportExport.buildPackExportPayload(pack);
    assert.deepEqual(payload.categories, [{ key: 'audio', name: 'Audio Gear', color: '#f59e0b' }],
      'only the referenced category is carried, not lighting or theme');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-27 importing category metadata into an uncustomized workspace applies the custom name/color', async () => {
  const rt = await createRuntime('category-apply');
  try {
    const { StateStore, ImportExport, PackLibrary, CategoryService } = rt;
    const audioCase = baseCase({ id: 'audio-case-2', category: 'audio' });
    StateStore.init({
      caseLibrary: [audioCase], packLibrary: [], folderLibrary: [],
      preferences: { categories: [{ key: 'audio', name: 'Audio Gear', color: '#f59e0b' }] },
    });
    const json = ImportExport.buildPackExportJSON(basePack({ cases: [instanceFor('audio-case-2')] }));

    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const imported = PackLibrary.importPackPayload(ImportExport.parsePackImportJSON(json));
    assert.equal(imported.categoryConflicts.length, 0);
    const audioMeta = CategoryService.all().find(c => c.key === 'audio');
    assert.equal(audioMeta.name, 'Audio Gear',
      'the imported custom name must apply when the importing workspace has not customized this category');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-28 importing category metadata never overwrites a category the local workspace already customized', async () => {
  const rt = await createRuntime('category-conflict');
  try {
    const { StateStore, ImportExport, PackLibrary, CategoryService } = rt;
    const audioCase = baseCase({ id: 'audio-case-3', category: 'audio' });
    StateStore.init({
      caseLibrary: [audioCase], packLibrary: [], folderLibrary: [],
      preferences: { categories: [{ key: 'audio', name: 'Exported Name', color: '#f59e0b' }] },
    });
    const json = ImportExport.buildPackExportJSON(basePack({ cases: [instanceFor('audio-case-3')] }));

    StateStore.init({
      caseLibrary: [], packLibrary: [], folderLibrary: [],
      preferences: { categories: [{ key: 'audio', name: 'My Local Name', color: '#000000' }] },
    });
    const imported = PackLibrary.importPackPayload(ImportExport.parsePackImportJSON(json));
    assert.equal(imported.categoryConflicts.length, 1);
    assert.equal(imported.categoryConflicts[0].key, 'audio');
    const audioMeta = CategoryService.all().find(c => c.key === 'audio');
    assert.equal(audioMeta.name, 'My Local Name', 'the local customization must never be silently overwritten');
  } finally {
    rt.cleanup();
  }
});

// ── 8. Placement repair reporting ───────────────────────────────────────────

test('MILESTONE-C-29 planPackImport reports a valid packed instance as preserved, not repaired', async () => {
  const rt = await createRuntime('repair-preserved');
  try {
    const { StateStore, PackLibrary } = rt;
    const c = baseCase();
    StateStore.init({ caseLibrary: [c], packLibrary: [], folderLibrary: [], preferences: {} });
    const payload = {
      pack: basePack({ cases: [instanceFor(c.id, { id: 'valid-inst', placement: 'packed' })] }),
      bundledCases: [c],
    };
    const plan = PackLibrary.planPackImport(payload);
    assert.equal(plan.placementsPreserved, 1);
    assert.equal(plan.placementsRepaired, 0);
    assert.equal(plan.placementsStaged, 0);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-30 planPackImport reports an out-of-bounds instance as moved to staging', async () => {
  const rt = await createRuntime('repair-staged');
  try {
    const { StateStore, PackLibrary } = rt;
    const c = baseCase();
    StateStore.init({ caseLibrary: [c], packLibrary: [], folderLibrary: [], preferences: {} });
    const payload = {
      pack: basePack({
        cases: [instanceFor(c.id, {
          id: 'oob-inst', placement: 'packed',
          transform: { position: { x: 99999, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        })],
      }),
      bundledCases: [c],
    };
    const plan = PackLibrary.planPackImport(payload);
    assert.equal(plan.placementsStaged, 1);
    assert.equal(plan.pack.cases[0].placement, 'staged');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-31 the preview plan and the committed result use the same deterministic planPackImport call', async () => {
  const rt = await createRuntime('preview-commit-parity');
  try {
    const { StateStore, PackLibrary } = rt;
    const c = baseCase();
    StateStore.init({ caseLibrary: [c], packLibrary: [], folderLibrary: [], preferences: {} });
    const payload = {
      pack: basePack({ cases: [instanceFor(c.id, { id: 'parity-inst' })] }),
      bundledCases: [c],
    };
    const preview = PackLibrary.planPackImport(payload);
    StateStore.init({ caseLibrary: [c], packLibrary: [], folderLibrary: [], preferences: {} });
    const committed = PackLibrary.importPackPayload(payload);
    assert.equal(preview.placementsPreserved, committed.importStats.placementsPreserved);
    assert.equal(preview.reusedCaseCount, committed.importStats.reusedCaseCount);
  } finally {
    rt.cleanup();
  }
});

// ── 9. Batch export/import ──────────────────────────────────────────────────

test('MILESTONE-C-32 batch export uses the v1 envelope (kind: pack-batch) and reuses the single-pack portable projection', async () => {
  const rt = await createRuntime('batch-envelope');
  try {
    const { StateStore, ImportExport } = rt;
    const c = baseCase();
    const packA = basePack({ id: 'batch-a', loadPlanNumber: 'LP-BATCH-A', cases: [instanceFor(c.id, { id: 'a1' })] });
    const packB = basePack({ id: 'batch-b', loadPlanNumber: 'LP-BATCH-B', cases: [instanceFor(c.id, { id: 'b1' })] });
    StateStore.init({ caseLibrary: [c], packLibrary: [packA, packB], folderLibrary: [], preferences: {} });

    const json = ImportExport.buildPackBatchExportJSON([packA, packB]);
    const envelope = JSON.parse(json);
    assert.equal(envelope.format, 'cargo-planner');
    assert.equal(envelope.kind, 'pack-batch');
    assert.equal(envelope.data.packs.length, 2);
    assert.equal(envelope.data.packs[0].pack.loadPlanNumber, 'LP-BATCH-A');
    assert.equal(Object.prototype.hasOwnProperty.call(envelope.data.packs[0].pack, 'stats'), false);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-33 batch export refuses an empty selection', async () => {
  const rt = await createRuntime('batch-empty');
  try {
    const { ImportExport } = rt;
    assert.throws(() => ImportExport.buildPackBatchExportJSON([]), /at least one/i);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-34 batch import round-trips multiple Load Plans and dedupes a Case shared across them', async () => {
  const rt = await createRuntime('batch-roundtrip');
  try {
    const { StateStore, ImportExport, CaseLibrary, PackLibrary } = rt;
    const c = baseCase();
    const packA = basePack({
      id: 'batch-a2', loadPlanNumber: 'LP-BATCH-A2',
      cases: [
        instanceFor(c.id, { id: 'a2-1' }),
        instanceFor(c.id, { id: 'a2-2', transform: { position: { x: 90, y: 16, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }),
      ],
    });
    const packB = basePack({ id: 'batch-b2', loadPlanNumber: 'LP-BATCH-B2', cases: [instanceFor(c.id, { id: 'b2-1' })] });
    StateStore.init({ caseLibrary: [c], packLibrary: [packA, packB], folderLibrary: [], preferences: {} });

    const json = ImportExport.buildPackBatchExportJSON([packA, packB]);
    const entries = ImportExport.parsePackBatchImportJSON(json);
    assert.equal(entries.length, 2);

    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    for (const entry of entries) PackLibrary.importPackPayload(entry);

    assert.equal(PackLibrary.getPacks().length, 2);
    assert.equal(CaseLibrary.getCases().length, 1, 'the shared case must be deduped across the batch, not duplicated');
    const totalInstances = PackLibrary.getPacks().reduce((sum, p) => sum + p.cases.length, 0);
    assert.equal(totalInstances, 3, 'instance identity/count must survive — no quantity collapse');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-35 a legacy exportType: pack-batch file still imports (batch legacy compatibility)', async () => {
  const rt = await createRuntime('batch-legacy');
  try {
    const { StateStore, ImportExport, CaseLibrary, PackLibrary } = rt;
    const c = baseCase({ id: 'legacy-batch-case' });
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const legacyJson = JSON.stringify({
      exportType: 'pack-batch',
      packs: [
        { pack: basePack({ id: 'legacy-p1', loadPlanNumber: 'LP-LEGACYBATCH1', cases: [instanceFor(c.id, { id: 'lp1-i1' })] }), bundledCases: [c] },
      ],
    });
    const entries = ImportExport.parsePackBatchImportJSON(legacyJson);
    assert.equal(entries.length, 1);
    const imported = PackLibrary.importPackPayload(entries[0]);
    assert.equal(imported.loadPlanNumber, 'LP-LEGACYBATCH1');
  } finally {
    rt.cleanup();
  }
});

// ── 10. Legacy compatibility guard ──────────────────────────────────────────

test('MILESTONE-C-36 a legacy bare {pack, bundledCases} Load Plan file still imports through the migrated exporter\'s parser', async () => {
  const rt = await createRuntime('legacy-single-pack');
  try {
    const { StateStore, ImportExport, PackLibrary } = rt;
    const c = baseCase({ id: 'legacy-single-case' });
    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const legacyJson = JSON.stringify({
      pack: basePack({ id: 'legacy-single', loadPlanNumber: 'LP-LEGACYSINGLE1', cases: [instanceFor(c.id, { id: 'ls-i1' })] }),
      bundledCases: [c],
    });
    const parsed = ImportExport.parsePackImportJSON(legacyJson);
    const imported = PackLibrary.importPackPayload(parsed);
    assert.equal(imported.loadPlanNumber, 'LP-LEGACYSINGLE1');
  } finally {
    rt.cleanup();
  }
});

// ── 11. Performance sanity (no obvious accidental O(n^2) blowup) ───────────

test('MILESTONE-C-37 Case Catalog export/import/plan scale roughly linearly for 1, 100, and 1000 cases', async () => {
  const rt = await createRuntime('perf-sanity');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    const timings = {};
    for (const n of [1, 100, 1000]) {
      const cases = Array.from({ length: n }, (_, i) => baseCase({
        id: `perf-case-${i}`, itemCode: `PERF-${i}`, name: `Perf Case ${i}`,
      }));
      StateStore.init({ caseLibrary: cases, packLibrary: [], folderLibrary: [], preferences: {} });
      const t0 = performance.now();
      const json = ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases());
      const parsed = ImportExport.parseCaseCatalogImportJSON(json);
      StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
      const plan = CaseLibrary.planCaseCatalogImport(parsed);
      const elapsed = performance.now() - t0;
      timings[n] = elapsed;
      assert.equal(plan.newCases.length, n);
    }
    // A generous, non-flaky upper bound — this is a smoke check against an
    // accidental O(n^3)+ regression, not a strict performance budget.
    assert.ok(timings[1000] < 2000, `1000-case catalog import took ${timings[1000]}ms — investigate for a complexity regression`);
  } finally {
    rt.cleanup();
  }
});

// ── 12. Final acceptance follow-ups ─────────────────────────────────────────

test('MILESTONE-C-38 Case Catalog export includes only key/name/color for a referenced custom category', async () => {
  const rt = await createRuntime('catalog-category-export');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    const customCase = baseCase({ category: 'touring-audio' });
    StateStore.init({
      caseLibrary: [customCase],
      packLibrary: [],
      folderLibrary: [],
      preferences: {
        categories: [{ key: 'touring-audio', name: 'Touring Audio', color: '#123abc' }],
        theme: 'dark',
      },
    });

    const envelope = JSON.parse(ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases()));
    assert.deepEqual(envelope.data.categories, [
      { key: 'touring-audio', name: 'Touring Audio', color: '#123abc' },
    ]);
    assert.deepEqual(Object.keys(envelope.data.categories[0]).sort(), ['color', 'key', 'name']);
    assert.equal(Object.prototype.hasOwnProperty.call(envelope.data, 'preferences'), false);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-39 Case Catalog import recreates referenced custom category display metadata', async () => {
  const rt = await createRuntime('catalog-category-roundtrip');
  try {
    const { StateStore, ImportExport, CaseLibrary, CategoryService } = rt;
    const customCase = baseCase({ category: 'touring-audio' });
    StateStore.init({
      caseLibrary: [customCase], packLibrary: [], folderLibrary: [],
      preferences: { categories: [{ key: 'touring-audio', name: 'Touring Audio', color: '#123abc' }] },
    });
    const json = ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases());
    const payload = ImportExport.parseCaseCatalogImportPayloadJSON(json);

    StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
    const plan = CaseLibrary.importCaseCatalogPayload(payload.cases, payload.categories);

    assert.equal(plan.newCases.length, 1);
    assert.equal(plan.categoryConflicts.length, 0);
    assert.deepEqual(CategoryService.meta('touring-audio'), {
      key: 'touring-audio', name: 'Touring Audio', color: '#123abc',
    });
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-40 built-in Case categories need no metadata and do not pollute destination preferences', async () => {
  const rt = await createRuntime('catalog-category-built-in');
  try {
    const { StateStore, ImportExport, CaseLibrary, CategoryService } = rt;
    StateStore.init({
      caseLibrary: [baseCase({ category: 'audio' })], packLibrary: [], folderLibrary: [],
      preferences: { theme: 'light' },
    });
    const json = ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases());
    const envelope = JSON.parse(json);
    assert.equal(Object.prototype.hasOwnProperty.call(envelope.data, 'categories'), false);

    const payload = ImportExport.parseCaseCatalogImportPayloadJSON(json);
    StateStore.init({
      caseLibrary: [], packLibrary: [], folderLibrary: [],
      preferences: { theme: 'dark' },
    });
    CaseLibrary.importCaseCatalogPayload(payload.cases, payload.categories);

    assert.deepEqual(StateStore.get('preferences'), { theme: 'dark' });
    assert.equal(CategoryService.meta('audio').key, 'audio');
    assert.ok(CategoryService.meta('audio').name);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-41 Case Catalog category import preserves unrelated destination category metadata and preferences', async () => {
  const rt = await createRuntime('catalog-category-additive');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    StateStore.init({
      caseLibrary: [baseCase({ category: 'touring-audio' })], packLibrary: [], folderLibrary: [],
      preferences: { categories: [{ key: 'touring-audio', name: 'Touring Audio', color: '#123abc' }] },
    });
    const payload = ImportExport.parseCaseCatalogImportPayloadJSON(
      ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases())
    );

    const unrelated = { key: 'local-only', name: 'Local Only', color: '#abcdef' };
    StateStore.init({
      caseLibrary: [], packLibrary: [], folderLibrary: [],
      preferences: { categories: [unrelated], theme: 'dark', caseCardDensity: 'compact' },
    });
    CaseLibrary.importCaseCatalogPayload(payload.cases, payload.categories);

    const preferences = StateStore.get('preferences');
    assert.deepEqual(preferences.categories.find(c => c.key === 'local-only'), unrelated);
    assert.equal(preferences.theme, 'dark');
    assert.equal(preferences.caseCardDensity, 'compact');
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-42 Case Catalog category conflict deterministically keeps destination customization', async () => {
  const rt = await createRuntime('catalog-category-conflict');
  try {
    const { StateStore, ImportExport, CaseLibrary, CategoryService } = rt;
    StateStore.init({
      caseLibrary: [baseCase({ category: 'touring-audio' })], packLibrary: [], folderLibrary: [],
      preferences: { categories: [{ key: 'touring-audio', name: 'Exported Name', color: '#123abc' }] },
    });
    const payload = ImportExport.parseCaseCatalogImportPayloadJSON(
      ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases())
    );

    StateStore.init({
      caseLibrary: [], packLibrary: [], folderLibrary: [],
      preferences: { categories: [{ key: 'touring-audio', name: 'Local Name', color: '#000000' }] },
    });
    const plan = CaseLibrary.importCaseCatalogPayload(payload.cases, payload.categories);

    assert.equal(plan.categoryConflicts.length, 1);
    assert.equal(plan.categoryConflicts[0].key, 'touring-audio');
    assert.equal(plan.categoriesToAdd.length, 0);
    assert.deepEqual(CategoryService.meta('touring-audio'), {
      key: 'touring-audio', name: 'Local Name', color: '#000000',
    });
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-43 Case Catalog export omits category metadata not referenced by an exported Case', async () => {
  const rt = await createRuntime('catalog-category-unreferenced');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    StateStore.init({
      caseLibrary: [baseCase({ category: 'touring-audio' })],
      packLibrary: [],
      folderLibrary: [],
      preferences: {
        categories: [
          { key: 'touring-audio', name: 'Touring Audio', color: '#123abc' },
          { key: 'unused-lighting', name: 'Unused Lighting', color: '#ff00ff' },
        ],
      },
    });

    const envelope = JSON.parse(ImportExport.buildCaseCatalogExportJSON(CaseLibrary.getCases()));
    assert.deepEqual(envelope.data.categories.map(c => c.key), ['touring-audio']);
  } finally {
    rt.cleanup();
  }
});

test('MILESTONE-C-44 real SheetJS XLSX binary round-trip returns canonical imported Case rows', async () => {
  const rt = await createRuntime('xlsx-real-binary-roundtrip');
  try {
    const { StateStore, ImportExport, CaseLibrary } = rt;
    const xlsxCase = baseCase({
      id: 'xlsx-unicode',
      name: 'Café Road Case 日本語 🎛️',
      itemCode: 'ÜNICODE-007',
      dimensions: { length: 47.5, width: 23.25, height: 31.75 },
      weight: 126.5,
      maxStackCount: 4,
      notes: 'Crème brûlée — façade input; keep dry ☔',
    });
    StateStore.init({ caseLibrary: [xlsxCase], packLibrary: [], folderLibrary: [], preferences: {} });

    const { content, mime } = ImportExport.buildCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'xlsx' });
    const bytes = content instanceof ArrayBuffer
      ? new Uint8Array(content)
      : (ArrayBuffer.isView(content)
        ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
        : Uint8Array.from(content));
    assert.equal(mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(bytes.byteLength > 4);
    assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x50, 0x4b], 'XLSX output must be a real ZIP binary');

    const workbook = RealXLSX.read(bytes, { type: 'array' });
    const exportedRows = RealXLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    assert.equal(exportedRows[0].lengthUnit, 'in');
    assert.equal(exportedRows[0].weightUnit, 'lb');

    const exactBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = await ImportExport.parseAndValidateSpreadsheet(
      {
        name: 'cases-round-trip.xlsx',
        size: bytes.byteLength,
        async arrayBuffer() { return exactBuffer; },
      },
      []
    );

    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.valid.length, 1);
    const row = parsed.valid[0];
    assert.deepEqual(
      { length: row.length, width: row.width, height: row.height },
      { length: 47.5, width: 23.25, height: 31.75 }
    );
    assert.equal(row.weight, 126.5);
    assert.equal(row.itemCode, 'ÜNICODE-007');
    assert.equal(row.maxStackCount, 4);
    assert.equal(row.name, 'Café Road Case 日本語 🎛️');
    assert.equal(row.notes, 'Crème brûlée — façade input; keep dry ☔');
  } finally {
    rt.cleanup();
  }
});
