import test from 'node:test';
import assert from 'node:assert/strict';

const importExportUrl = new URL('../../src/services/import-export.js', import.meta.url);
const stateStoreUrl = new URL('../../src/core/state-store.js', import.meta.url);

function installXlsxStub(rows) {
  globalThis.window = globalThis.window || {};
  globalThis.window.XLSX = {
    read() {
      return {
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: { __rows: rows },
        },
      };
    },
    utils: {
      sheet_to_json(sheet) {
        return sheet.__rows;
      },
    },
  };
}

async function loadImportExport() {
  return import(`${importExportUrl.href}?t=${Date.now()}-${Math.random()}`);
}

test('Max Capacity packedProfile survives generic pack, batch, app, and workspace JSON paths', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const ImportExport = await loadImportExport();
  const caseData = {
    id: 'case-max-profile',
    name: 'Max Profile Case',
    dimensions: { length: 10, width: 10, height: 10 },
    weight: 10,
    canFlip: true,
    stackable: true,
  };
  const instance = {
    id: 'instance-max-profile',
    caseId: caseData.id,
    transform: {
      position: { x: 20, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: 'packed',
    packedProfile: 'max-capacity',
  };
  const pack = {
    id: 'pack-max-profile',
    title: 'Max Profile Pack',
    truck: { length: 120, width: 60, height: 60, shapeMode: 'rect' },
    cases: [instance],
  };
  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [pack],
    folderLibrary: [],
    preferences: {},
  });

  const packPayload = ImportExport.parsePackImportJSON(ImportExport.buildPackExportJSON(pack));
  assert.equal(packPayload.pack.cases[0].packedProfile, 'max-capacity');

  const batchPayload = ImportExport.parsePackBatchImportJSON(JSON.stringify({
    exportType: 'pack-batch',
    packs: [{ pack, bundledCases: [caseData] }],
  }));
  assert.equal(batchPayload[0].pack.cases[0].packedProfile, 'max-capacity');

  const restoredApp = ImportExport.parseAppImportJSON(ImportExport.buildAppExportJSON());
  assert.equal(restoredApp.packLibrary[0].cases[0].packedProfile, 'max-capacity');

  const restoredWorkspace = ImportExport.parseWorkspaceImportJSON(
    ImportExport.buildWorkspaceExportJSON('QA Workspace')
  );
  assert.equal(restoredWorkspace.packLibrary[0].cases[0].packedProfile, 'max-capacity');
});

test('parseAndValidateSpreadsheet deduplicates duplicate names in the same file', async () => {
  installXlsxStub([
    ['name', 'length', 'width', 'height'],
    ['Case A', 10, 10, 10],
    ['Case A', 20, 20, 20],
  ]);

  const ImportExport = await loadImportExport();
  const parsed = await ImportExport.parseAndValidateSpreadsheet(
    {
      name: 'cases.csv',
      size: 120,
      async text() {
        return 'stub';
      },
    },
    []
  );

  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.duplicates.length, 1);
  assert.equal(parsed.errors.length, 0);
});

test('parseAndValidateSpreadsheet rejects unsupported file extensions', async () => {
  installXlsxStub([['name', 'length', 'width', 'height']]);
  const ImportExport = await loadImportExport();

  await assert.rejects(
    () =>
      ImportExport.parseAndValidateSpreadsheet(
        {
          name: 'malicious.json',
          size: 80,
          async text() {
            return '{}';
          },
        },
        []
      ),
    /Unsupported file type/
  );
});

test('parseAndValidateSpreadsheet enforces the maximum row limit', async () => {
  const rows = [['name', 'length', 'width', 'height']];
  for (let i = 0; i < 5001; i += 1) {
    rows.push([`Case ${i}`, 10, 10, 10]);
  }

  installXlsxStub(rows);
  const ImportExport = await loadImportExport();

  await assert.rejects(
    () =>
      ImportExport.parseAndValidateSpreadsheet(
        {
          name: 'too-many.csv',
          size: 1024,
          async text() {
            return 'stub';
          },
        },
        []
      ),
    /Too many rows/
  );
});

test('parseAndValidateSpreadsheet rejects oversized files', async () => {
  installXlsxStub([['name', 'length', 'width', 'height'], ['Case A', 10, 10, 10]]);
  const ImportExport = await loadImportExport();

  await assert.rejects(
    () =>
      ImportExport.parseAndValidateSpreadsheet(
        {
          name: 'huge.csv',
          size: 10 * 1024 * 1024 + 1,
          async text() {
            return 'stub';
          },
        },
        []
      ),
    /File too large/
  );
});

test('importCaseRows ignores invalid dimensions even if parse stage is bypassed', async () => {
  const ImportExport = await loadImportExport();
  const { nextCaseLibrary, added } = ImportExport.importCaseRows(
    [
      { name: 'Valid', length: 10, width: 10, height: 10, category: 'audio' },
      { name: 'Invalid', length: 10, width: -1, height: 10, category: 'audio' },
    ],
    []
  );

  assert.equal(added, 1);
  assert.equal(nextCaseLibrary.length, 1);
  assert.equal(nextCaseLibrary[0].name, 'Valid');
});
