// import storage invariants: contract tests from the former security suite.

import {
  CARGO_BAD_ROW,
  CARGO_HEADER,
  HANDLING_FIELDS,
  RECON_CASE_LIB,
  RECON_RECT,
  RULED_CASE,
  appPath,
  assert,
  assertHostileCanonical,
  assertPackImportNoOverlaps,
  autoPackEnginePath,
  autoPackItemBuilderPath,
  beamCsvFixturePath,
  beamXlsxFixturePath,
  browserPath,
  casesScreenPath,
  createStabilizationMemoryStorage,
  editorScreenPath,
  findRowWarning,
  fs,
  fsSync,
  getPackImportAabb,
  helpModalPath,
  hostileRawCase,
  importAppDialogPath,
  importCasesDialogPath,
  importExportPath,
  importPackDialogPath,
  indexHtmlPath,
  installWindowXLSX,
  makeCsvFile,
  makeMultiCasePayload,
  makePackImportInstance,
  makePackImportPayload,
  makePackImportSafeCase,
  makeTruckChangeHarness,
  makeXlsxFile,
  normalizerPath,
  packImportStateSnapshot,
  packLibraryPath,
  packsScreenPath,
  phbSolverModules,
  phc2Aabb,
  phc2Instance,
  phcFrontOverhangTruck,
  readAppSource,
  reconInst,
  settingsOverlayPath,
  stateStorePath,
  storagePath,
  test,
  threeOrientedTruth,
  truckChangeControllerPath,
} from '../fixtures/security-invariants-support.mjs';

test('UI-COPY-EXPORT-IMPORT-1 copy uses scoped backup import export wording', async () => {
  const [settings, app, index, importApp, importPack, help, packs] = await Promise.all([
    fs.readFile(settingsOverlayPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(importAppDialogPath, 'utf8'),
    fs.readFile(importPackDialogPath, 'utf8'),
    fs.readFile(helpModalPath, 'utf8'),
    fs.readFile(packsScreenPath, 'utf8'),
  ]);

  assert.match(settings, /Release Notes[\s\S]*Verified product changes will appear here/,
    'Settings Resources must label Updates as Release Notes with neutral copy');
  assert.match(settings, /Export App Backup[\s\S]*Download local load plans, cases, folders, and preferences as a JSON backup/,
    'Settings Resources must scope App Backup export copy');
  assert.match(settings, /Import App Backup[\s\S]*Replace local load plans, cases, folders, and preferences from a backup JSON/,
    'Settings Resources must scope App Backup import copy');
  assert.match(settings, /Workspace Backup[\s\S]*Export Workspace Backup/,
    'Workspace General must use Workspace Backup wording');
  assert.match(app, /title:\s*['"]Export App Backup['"][\s\S]*label:\s*['"]Download App Backup['"]/,
    'App export modal must use backup title and CTA');
  assert.match(app, /title:\s*['"]Export Workspace Backup['"][\s\S]*label:\s*['"]Export Workspace Backup['"]/,
    'Workspace export modal must use backup title and CTA');
  assert.match(index, /Import Load Plan\(s\)/,
    'Load Plans screen header button must use Import Load Plan(s)');
  assert.doesNotMatch(index, />\s*Import Load Plan JSON\s*</,
    'Load Plans screen toolbar button must not say Import Load Plan JSON');
  assert.match(index, /Download Cases Template[\s\S]*Import Cases/,
    'Cases buttons must use explicit template and import labels');
  assert.match(importApp, /title:\s*['"]Import App Backup['"]/,
    'Import App dialog must use Import App Backup title');
  assert.match(importApp, /Replace Local App Data/,
    'Import App dialog must use scoped replacement CTA');
  assert.match(importPack, /title:\s*['"]Import Load Plan JSON['"]/,
    'Import Load Plan dialog must use Import Load Plan JSON title');
  assert.equal((packs.match(/label:\s*['"]Export Load Plan JSON['"]/g) || []).length, 2,
    'Both load plan context menus must use Export Load Plan JSON');
  assert.match(help, /Import \/ Export Help[\s\S]*Workspace Backup[\s\S]*Load Plan JSON[\s\S]*Cases CSV\/XLSX/,
    'Top-bar Help modal must match the import/export help scope');
});

test('UI-COPY-EXPORT-IMPORT-1 removes fake release notes and stale roadmap commitments', async () => {
  const [settings, app, index] = await Promise.all([
    fs.readFile(settingsOverlayPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(indexHtmlPath, 'utf8'),
  ]);
  const combined = `${settings}\n${app}\n${index}`;

  assert.doesNotMatch(combined, /\(Example\)|version:\s*['"]1\.1\.0['"]|date:\s*['"]2026-03-01['"]/,
    'Fake example release notes must not remain user-facing');
  assert.doesNotMatch(settings, /updatesData|roadmapData/,
    'Settings empty states must not leave unused static Updates/Roadmap arrays behind');
  assert.doesNotMatch(app, /quarter:\s*['"]Q1 2026['"]|quarter:\s*['"]Q2 2026['"]/,
    'Full-screen Roadmap data must not include Q1/Q2 stale commitments');
  assert.match(settings, /Verified release notes will appear here as the product changes/,
    'Settings Release Notes sub-view must render the neutral empty state');
  assert.match(settings, /Published roadmap items will appear here when they are ready to share/,
    'Settings Roadmap sub-view must render the neutral empty state');
});

test('import-cases dialog file chip clear does not close modal', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /ev\.stopPropagation\(\)/,
    'file chip clear x must call ev.stopPropagation() to avoid closing the modal');
});

test('import-cases dialog preview renders category color dots', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /tp3d-ic-cat-dot/,
    'category cells must render a tp3d-ic-cat-dot element for the color indicator');
});

test('import-cases dialog preview uses status circle elements', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /tp3d-ic-status-circle/,
    'status icons must be wrapped in tp3d-ic-status-circle for the soft circular background');
  assert.match(src, /tp3d-ic-status-circle--success/,
    'valid rows must use tp3d-ic-status-circle--success');
  assert.match(src, /tp3d-ic-status-circle--error/,
    'invalid rows must use tp3d-ic-status-circle--error');
});

test('import-cases dialog error report button uses bordered style', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /errReportBtn\.className\s*=\s*['"]btn['"]/,
    'error report button must use the base btn class (bordered secondary style)');
  assert.doesNotMatch(src, /errReportBtn\.className\s*=\s*['"]btn btn-ghost['"]/,
    'error report button must not be ghost (borderless)');
  assert.doesNotMatch(src, /errReportBtn\.className\s*=\s*['"]tp3d-ic-err-report-btn['"]/,
    'error report button must not use one-off custom class');
});

test('import-cases dialog parsed state uses compact file chip not the large dropzone', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /tp3d-ic-file-chip/,
    'parsed state must use a compact file chip element');
  assert.match(src, /showState\('dropzone'\)/,
    'file chip clear must call showState dropzone to return to empty state');
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON accepts valid batch envelope at runtime', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const batch = JSON.stringify({
    exportType: 'pack-batch',
    schemaVersion: 1,
    packs: [
      { pack: { truck: { dimensions: { length: 20, width: 8, height: 8 } }, cases: [] }, bundledCases: [] },
      { pack: { truck: { dimensions: { length: 20, width: 8, height: 8 } }, cases: [] }, bundledCases: [] },
    ],
  });
  const payloads = ImportExport.parsePackBatchImportJSON(batch);
  assert.equal(payloads.length, 2, 'batch parser must return one payload per packs entry');
  assert.ok(payloads[0] && payloads[0].pack, 'each payload must have a pack key');
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects wrong exportType', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({ packs: [{ pack: { truck: {}, cases: [] } }] })),
    /load plan batch/i,
    'must throw on missing or wrong exportType',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects App JSON', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({
      exportType: 'pack-batch',
      packLibrary: [],
      caseLibrary: [],
      packs: [{ pack: { truck: {}, cases: [] } }],
    })),
    /App JSON|App Backup/i,
    'batch parser must reject App JSON shape',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects workspace exportType', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({
      exportType: 'workspace',
      data: { packLibrary: [], caseLibrary: [] },
    })),
    /Workspace/i,
    'batch parser must reject workspace export',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects empty packs array', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({ exportType: 'pack-batch', packs: [] })),
    /non-empty/i,
    'batch parser must reject an empty packs array',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects top-level array', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify([{ pack: { truck: {}, cases: [] } }])),
    /Invalid JSON|Not a pack batch|pack batch/i,
    'batch parser must reject a top-level array',
  );
});

test('PACK-IMPORT-BATCH-1 import-pack-dialog routes pack-batch exportType to batch handler', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /['"]pack-batch['"]/,
    'import-pack-dialog must detect pack-batch exportType');
  assert.match(src, /parsePackBatchImportJSON/,
    'import-pack-dialog must call parsePackBatchImportJSON for batch files');
  assert.match(src, /parsePackImportJSON/,
    'import-pack-dialog must still call parsePackImportJSON for single-pack files');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog reads flat truck schema (not .dimensions)', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.ok(
    !src.includes('pack.truck.dimensions'),
    'import-pack-dialog must not read pack.truck.dimensions (flat schema: pack.truck.length/width/height)'
  );
  assert.match(src, /pack\.truck\s*\|\|/,
    'import-pack-dialog must use pack.truck || {} for truck accessor');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog validates truck dimensions are positive finite numbers', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /Number\.isFinite.*truckL|Number\.isFinite.*tL/,
    'import-pack-dialog must check Number.isFinite for truck length');
  assert.match(src, /truckL\s*<=\s*0|tL\s*<=\s*0/,
    'import-pack-dialog must reject truck.length <= 0');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog App JSON guard catches exportType app-backup', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /exportType.*app-backup|app-backup.*exportType/,
    'import-pack-dialog must detect exportType === "app-backup" as App JSON');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog renderCasesTable does not use .dimensions fallback for missing bundled cases', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.ok(
    !src.includes("bundledById.get(inst.caseId) || {}"),
    'import-pack-dialog must not fallback to {} for missing bundled case (hides unresolved data)'
  );
  assert.match(src, /hasDef|isResolved/,
    'import-pack-dialog must track whether case definition was resolved from bundledCases');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog shows unbundled case note in cases table', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /not bundled/,
    'import-pack-dialog must show a note when case definitions are not bundled');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog labels preview summary and hides unsupported Thumbnail chip', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /fa-solid fa-truck/,
    'Pack import preview summary must show a professional truck icon in the header block');
  assert.doesNotMatch(src, /createDetailItem\(['"]Title['"]/,
    'Pack import preview metadata must not duplicate title row under the summary header');
  assert.match(src, /createDetailItem\(['"]Project['"]/,
    'Pack import preview must label the project metadata item');
  assert.match(src, /createDetailItem\(['"]Client['"]/,
    'Pack import preview must label the client metadata item');
  assert.match(src, /createDetailItem\(['"]Truck['"]/,
    'Pack import preview must label the truck metadata item');
  assert.match(src, /createDetailItem\(['"]Categories['"]/,
    'Pack import preview must label the categories metadata item');
  assert.match(src, /tp3d-ip-summary-meta-item/,
    'Pack import preview must render compact inline metadata groups');
  assert.match(src, /tp3d-ip-summary-detail-value/,
    'Pack import preview metadata values must be rendered in dedicated value spans');
  assert.match(src, /tp3d-ip-cases-status-card/,
    'Pack import preview must render cases status cards');
  assert.match(src, /let activeCaseFilter = ['"]all['"]/,
    'Pack import preview must keep a local activeCaseFilter state for card toggles');
  assert.match(src, /activeCaseFilter === key \? ['"]all['"] : key/,
    'Cases status cards must toggle on/off by clicking the active filter again');
  assert.match(src, /renderCasesTable\(pack, bundledCases\)/,
    'Cases status card clicks must re-render the table with the selected filter');
  assert.match(src, /label:\s*['"]Ready['"]/,
    'Pack import preview must include Ready status label');
  assert.match(src, /label:\s*['"]Duplicates['"]/,
    'Pack import preview must include Duplicates status label');
  assert.match(src, /label:\s*['"]Invalid['"]/,
    'Pack import preview must include Invalid status label');
  assert.match(src, /labelEl\.textContent\s*=\s*label \+ ['"]: ['"]/,
    'Pack import preview labels must include a visible colon-space separator');
  assert.match(src, /const clientText = pack\.client \|\| pack\.clientName \|\| ['"]/,
    'Pack import preview must support client fallback from pack.clientName');
  assert.doesNotMatch(src, /label:\s*['"]Thumbnail['"]/,
    'Pack import empty-state structure chips must not show Thumbnail');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog normalizes invalid/edge-case errors with specific headings', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /function normalizeImportError\(/,
    'Import dialog must normalize edge-case errors before rendering');
  assert.match(src, /heading:\s*['"]Invalid JSON file['"]/,
    'Import dialog must label JSON parse failures clearly');
  assert.match(src, /heading:\s*['"]Missing required fields['"]/,
    'Import dialog must label missing required fields clearly');
  assert.match(src, /heading:\s*['"]Invalid truck size['"]/,
    'Import dialog must label invalid truck dimension failures clearly');
  assert.match(src, /renderError\(normalized\.message, normalized\.heading\)/,
    'Import dialog must pass normalized heading and message into inline error cards');
});

test('PACK-IMPORT-SCHEMA-1 single import success path closes modal after import', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /PackLibrary\.importPackPayload\(parsedPayload\.payload\)[\s\S]*modalObj\.close\(\)/,
    'Single-pack import success must close the modal after importing');
});

test('PACK-IMPORT-SCHEMA-1 pack import modal uses pack-only class and batch close is gated by imported count', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /classList\.add\(['"]tp3d-ic-modal['"],\s*['"]tp3d-ip-modal['"]\)/,
    'Pack import modal must include pack-only tp3d-ip-modal class alongside shared tp3d-ic-modal');
  assert.match(
    src,
    // Export Integrity C: disclosed placement repairs downgrade the tone to warning.
    /UIComponents\.showToast\(msg, imported > 0 && !repairs \? ['"]success['"] : ['"]warning['"]\);\s*if\s*\(imported\s*>\s*0\)\s*\{\s*modalObj\.close\(\);\s*\}/,
    'Batch import should close modal only when imported > 0'
  );
  assert.doesNotMatch(src, /imported\s*===\s*0[\s\S]*modalObj\.close\(\)/,
    'Batch import with zero successful imports must keep modal open');
});

test('PACK-IMPORT-SAFE-1 editor addCaseToPack uses PackLibrary safe staging and preserves explicit drop positions', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function addCaseToPack(caseId, positionInches)');
  const end = src.indexOf('\n\n    async function unpackAll()', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0,
    'editor-screen must define addCaseToPack(caseId, positionInches) before unpackAll');
  assert.doesNotMatch(block, /const cols\s*=\s*6/,
    'addCaseToPack must not keep hardcoded 6-column staging');
  assert.doesNotMatch(block, /stagedCount/,
    'addCaseToPack must not compute a custom stagedCount layout path');
  assert.match(block, /\?\s*PackLibrary\.addInstance\(packId,\s*caseId,\s*positionInches\)/,
    'addCaseToPack must preserve explicit positionInches for drag/drop placement');
  assert.match(block, /:\s*PackLibrary\.addInstance\(packId,\s*caseId\)/,
    'addCaseToPack must call PackLibrary.addInstance(packId, caseId) for normal Add button staging');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog distinguishes bundled and unresolved case definitions', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /Utils\.formatDims\(dims,\s*['"]m['"]\)/,
    'Bundled cases must show real formatted dimensions');
  assert.match(src, /Utils\.formatWeight\(wt,\s*['"]lb['"]/,
    'Bundled cases must show real formatted weight');
  assert.match(src, /getCategoryColor\(catName\)/,
    'Bundled case categories must render their category color');
  assert.match(src, /nameSpan\.textContent\s*=\s*inst\.caseId/,
    'Missing bundled cases must show the unresolved caseId');
  assert.match(src, /Case definitions not bundled/,
    'Missing bundled cases must show a clear unresolved note');
  assert.doesNotMatch(src, /\?\s*×\s*\?\s*×\s*\?/,
    'Missing bundled cases must not show fake unknown dimensions');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog batch row validation checks truck dimensions', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /Invalid truck dimensions/,
    'import-pack-dialog batch validation must report "Invalid truck dimensions"');
});

test('PACK-IMPORT-SAFE-1 import stays on Packs and does not auto-open imported pack', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-route' });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [
      { id: 'existing-pack', title: 'Existing Pack', truck: { length: 100, width: 60, height: 60 }, cases: [] },
    ],
    folderLibrary: [],
    preferences: {},
    currentScreen: 'packs',
    currentPackId: 'existing-pack',
    selectedInstanceIds: ['selected-before-import'],
  });

  const importedPack = PackLibrary.importPackPayload(makePackImportPayload(
    caseData,
    [makePackImportInstance(caseData.id, { id: 'inst-route', placement: 'packed', transform: {
      position: { x: 20, y: caseData.dimensions.height / 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    } })],
    { packId: 'pack-import-route', title: 'Route Import' }
  ));

  assert.equal(StateStore.get('currentScreen'), 'packs',
    'Pack import must not switch currentScreen to editor');
  assert.equal(StateStore.get('currentPackId'), 'existing-pack',
    'Pack import must not auto-open the imported pack');
  assert.deepEqual(StateStore.get('selectedInstanceIds'), [],
    'Pack import should clear stale editor selections');
  assert.ok(
    PackLibrary.getPacks().some(pack => pack.id === importedPack.id),
    'Imported pack must be added to the pack library for the Packs screen'
  );
});

test('PACK-IMPORT-SAFE-1 duplicate pack id is regenerated, title is suffixed, and duplicate bundled cases are reused', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  // Local case uses the helper's default cargo so the bundled cases below are
  // cargo-equivalent and may be safely reused (CARGO-RULE-V1 import-integrity).
  const existingCase = makePackImportSafeCase({
    id: 'case-existing',
    name: 'Shared Case Name',
  });

  StateStore.init({
    caseLibrary: [existingCase],
    packLibrary: [
      {
        id: 'pack-existing-id',
        title: 'Existing Pack',
        truck: { length: 120, width: 60, height: 60 },
        cases: [],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });

  const importedPack = PackLibrary.importPackPayload({
    pack: {
      id: 'pack-existing-id',
      title: 'Duplicate Id Pack',
      truck: { length: 120, width: 60, height: 60 },
      cases: [
        makePackImportInstance('case-existing', { id: 'inst-1', transform: { position: { x: 8, y: 4, z: -8 } } }),
        makePackImportInstance('incoming-dup-name', { id: 'inst-2', transform: { position: { x: 24, y: 4, z: -8 } } }),
      ],
    },
    bundledCases: [
      makePackImportSafeCase({ id: 'case-existing', name: 'Shared Case Name' }),
      makePackImportSafeCase({ id: 'incoming-dup-name', name: 'Shared Case Name' }),
    ],
  });

  const casesAfter = StateStore.get('caseLibrary') || [];
  assert.equal(casesAfter.length, 1,
    'Duplicate bundled cases by id/name must be reused and not added again');
  assert.ok(importedPack.id !== 'pack-existing-id',
    'Duplicate incoming pack id must be regenerated');
  assert.equal(importedPack.title, 'Duplicate Id Pack (Imported)',
    'Imported pack title must be suffixed with (Imported)');
  assert.ok(importedPack.cases.every(inst => inst.caseId === 'case-existing'),
    'Imported instances should reuse existing case ids for duplicate bundled definitions');
});

test('CARGO-RULE-V1 pack import with an unresolved case reference is blocked with no side effect', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const bad = {
    pack: { id: 'p', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ghost', { id: 'i', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [],
  };
  assert.throws(() => PackLibrary.importPackPayload(bad), /missing/i, 'unresolved reference must block the import');
  assert.equal((StateStore.get('caseLibrary') || []).length, 0, 'blocked import must not create any case (no fake fallback)');
  assert.equal((StateStore.get('packLibrary') || []).length, 0, 'blocked import must not save the pack');

  // A pack whose cases all resolve still imports (regression guard).
  const ok = {
    pack: { id: 'p2', title: 'P2', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('good', { id: 'j', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'good', name: 'Good' })],
  };
  PackLibrary.importPackPayload(ok);
  assert.equal((StateStore.get('packLibrary') || []).length, 1, 'a fully resolvable pack still imports');
});

test('CARGO-RULE-V1 batch import skips only the invalid pack; valid packs import', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const entries = [
    { pack: { id: 'good1', title: 'G1', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('c1', { id: 'a', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'c1', name: 'C1' })] },
    { pack: { id: 'bad', title: 'B', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('missing', { id: 'b', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [] },
    { pack: { id: 'good2', title: 'G2', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('c2', { id: 'd', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'c2', name: 'C2' })] },
  ];
  // Mirror the dialog's per-pack try/catch batch loop.
  let imported = 0, skipped = 0;
  for (const e of entries) {
    try { PackLibrary.importPackPayload(e); imported++; } catch { skipped++; }
  }
  assert.equal(imported, 2, 'two valid packs import');
  assert.equal(skipped, 1, 'the invalid pack is skipped');
  assert.equal((StateStore.get('packLibrary') || []).length, 2, 'only valid packs are saved');
});

test('CARGO-RULE-V2 atomic import: a valid import adds all cases + the pack (full before/after)', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  const payload = makeMultiCasePayload([
    makePackImportSafeCase({ id: 'b1', name: 'B1' }),
    makePackImportSafeCase({ id: 'b2', name: 'B2' }),
  ]);
  PackLibrary.importPackPayload(payload);
  assert.notDeepEqual(packImportStateSnapshot(StateStore), before, 'state changed on a valid import');
  assert.equal((StateStore.get('caseLibrary') || []).length, 2, 'both bundled cases added');
  assert.equal((StateStore.get('packLibrary') || []).length, 1, 'the pack was added');
});

for (const where of ['first', 'middle', 'last']) {
  test(`CARGO-RULE-V2 atomic import: malformed ${where} bundled case → no mutation at all`, async () => {
    const StateStore = await import(stateStorePath.href);
    const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
    // Seed an existing case so we can prove the existing library is untouched too.
    const seed = makePackImportSafeCase({ id: 'seed', name: 'Seed' });
    StateStore.init({ caseLibrary: [seed], packLibrary: [], folderLibrary: [], preferences: {} });
    const before = packImportStateSnapshot(StateStore);

    const good1 = makePackImportSafeCase({ id: 'g1', name: 'G1' });
    const good2 = makePackImportSafeCase({ id: 'g2', name: 'G2' });
    const bad = { id: 'bad', name: 'Bad', dimensions: { length: 0, width: 'x', height: -3 }, weight: 5 };
    const order = where === 'first' ? [bad, good1, good2] : where === 'middle' ? [good1, bad, good2] : [good1, good2, bad];

    assert.throws(() => PackLibrary.importPackPayload(makeMultiCasePayload(order)), /blocked/i,
      `malformed ${where} bundled case must block the import`);

    const after = packImportStateSnapshot(StateStore);
    assert.deepEqual(after, before, 'case + pack libraries are byte-equivalent after the failure (no partial mutation)');
    assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'only the pre-existing seed case remains');
    assert.equal((StateStore.get('packLibrary') || []).length, 0, 'no pack was saved');
  });
}

test('CARGO-RULE-V2 atomic import: blank/missing instance caseId is rejected with no side effect', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  for (const blank of ['', '   ', null, undefined]) {
    const payload = {
      pack: { id: 'pb', title: 'PB', truck: { length: 120, width: 60, height: 60 },
        cases: [makePackImportInstance(blank, { id: 'ib', transform: { position: { x: 5, y: 5, z: 0 } } })] },
      bundledCases: [makePackImportSafeCase({ id: 'unused', name: 'Unused' })],
    };
    assert.throws(() => PackLibrary.importPackPayload(payload), /blank or missing/i, `blank caseId (${JSON.stringify(blank)}) must block`);
  }
  assert.deepEqual(packImportStateSnapshot(StateStore), before, 'no state change after blank-caseId rejections');
});

test('CARGO-RULE-V2 atomic import: failure after a planned conflict leaves no local case changed', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Existing case forces an id-conflict plan for the first bundled case.
  const existing = makePackImportSafeCase({ id: 'dup', name: 'Existing Dup', weight: 999 });
  StateStore.init({ caseLibrary: [existing], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  // First bundled case conflicts (same id, different cargo → planned rename), the
  // last is malformed → the whole plan must abort with nothing committed.
  const conflicting = makePackImportSafeCase({ id: 'dup', name: 'Incoming Dup', weight: 1 });
  const bad = { id: 'bad2', name: 'Bad2', dimensions: null };
  assert.throws(() => PackLibrary.importPackPayload(makeMultiCasePayload([conflicting, bad])), /blocked/i);
  assert.deepEqual(packImportStateSnapshot(StateStore), before, 'planned conflict + later failure leaves the library byte-equivalent');
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'no conflict-renamed case was created');
});

test('CARGO-RULE-V2 atomic import: repeating a conflicting import three times is idempotent', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const existing = makePackImportSafeCase({ id: 'shared', name: 'Shared', weight: 10 });
  StateStore.init({ caseLibrary: [existing], packLibrary: [], folderLibrary: [], preferences: {} });
  // Different cargo than the local 'shared' (heavier) → forces a conflict copy.
  const mkConflict = () => ({
    pack: { id: 'pc', title: 'PC', truck: { length: 120, width: 60, height: 60 },
      cases: [makePackImportInstance('shared', { id: 'ic', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'shared', name: 'Shared', weight: 250 })],
  });
  PackLibrary.importPackPayload(mkConflict());
  const afterFirst = (StateStore.get('caseLibrary') || []).length;
  PackLibrary.importPackPayload(mkConflict());
  PackLibrary.importPackPayload(mkConflict());
  const afterThird = (StateStore.get('caseLibrary') || []).length;
  assert.equal(afterFirst, 2, 'first conflicting import creates exactly one (Imported) copy');
  assert.equal(afterThird, 2, 'two further identical conflicting imports reuse the copy (no Imported 2/3)');
  assert.equal((StateStore.get('packLibrary') || []).length, 3, 'each import still adds its pack');
});

test('CARGO-RULE-V2 planPackImport is pure: planning alone never mutates state', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  const plan = PackLibrary.planPackImport(makeMultiCasePayload([
    makePackImportSafeCase({ id: 'p1', name: 'P1' }),
    makePackImportSafeCase({ id: 'p2', name: 'P2' }),
  ]));
  assert.deepEqual(packImportStateSnapshot(StateStore), before, 'planPackImport must not write to StateStore');
  assert.equal(plan.newCases.length, 2, 'plan carries the two prepared new cases');
  assert.ok(plan.pack && plan.pack.stats, 'plan carries a fully built pack with stats');
});

test('CARGO-RULE-V3 extensions survive App Backup and Workspace normalization round-trips', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const appData = {
    caseLibrary: [{ id: 'cc', name: 'C', dimensions: { length: 10, width: 10, height: 10 }, importSourceKey: 'fp-123', customField: 'survives' }],
    packLibrary: [], folderLibrary: [],
  };
  const restored = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(appData)));
  const c = restored.caseLibrary[0];
  assert.equal(c.importSourceKey, 'fp-123', 'idempotence fingerprint survives App Backup restore');
  assert.equal(c.customField, 'survives', 'approved safe extension survives App Backup restore');
});

test('CARGO-RULE-V5 export reports unresolved refs and AutoPack excludes them', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}${stamp}`);
  const ItemBuilder = await import(`${autoPackItemBuilderPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  // Two unresolved + one resolved instance.
  const cases = { real: { id: 'real', dimensions: { length: 10, width: 10, height: 10 }, volume: 1000, shape: 'box' } };
  const instances = [
    { id: 'i1', caseId: 'ghost1', hidden: false },
    { id: 'i2', caseId: 'real', hidden: false },
    { id: 'i3', caseId: 'ghost2', hidden: false },
  ];
  const items = ItemBuilder.buildLegacyAutoPackItems({
    instances,
    getCaseById: (id) => cases[id] || null,
    volumeInCubicInches: (d) => d.length * d.width * d.height,
    orientationTools: { normalizeRightAngleRotation: PackLibrary.normalizeRightAngleRotation, getOrientedDimsForRotation: PackLibrary.getOrientedDimsForRotation },
  });
  assert.equal(items.length, 1, 'AutoPack item preparation drops both unresolved instances (never fake dims)');
  assert.equal(items[0].inst.id, 'i2', 'only the resolved instance becomes an AutoPack item');
});

test('CARGO-RULE-V1 existing dangling instance: stats expose it, export preserves it, no crash', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const dpack = { id: 'dp', title: 'Dangling', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ghost', { id: 'i', transform: { position: { x: 5, y: 5, z: 0 } } })] };
  StateStore.init({ caseLibrary: [], packLibrary: [dpack], folderLibrary: [], preferences: {} });
  const stats = PackLibrary.computeStats(dpack, []);
  assert.equal(stats.totalCases, 1, 'the stored instance is still counted');
  assert.equal(stats.packedCases, 0, 'unresolved item is not counted as packed');
  assert.equal(stats.unresolvedInstances, 1, 'stats expose the unresolved instance count');
  assert.equal(stats.totalWeight, null, 'complete mass is unknown for the unresolved item');
  assert.equal(stats.totalsComplete, false, 'totals are flagged incomplete when an instance is unresolved');
  assert.equal(stats.weightComplete, false, 'weight completeness flag is false');
  assert.equal(stats.volumeComplete, false, 'volume completeness flag is false');
  // Export preserves the dangling reference for recovery AND reports it explicitly.
  const payload = IE.buildPackExportPayload(dpack);
  assert.deepEqual(payload.unresolvedCaseRefs, ['ghost'], 'export reports the unresolved case ref');
  assert.match(payload.unresolvedNote, /missing/i, 'export carries a human-readable missing-definition note');
  const json = IE.buildPackExportJSON(dpack);
  assert.match(json, /"caseId":\s*"ghost"/, 'export keeps the unresolved caseId for recovery');

  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(editorSrc, /renderUnresolvedCaseInspector\(pack, inst\)/, 'Inspector shows an unresolved-case warning instead of an empty panel');
});

test('CARGO-RULE-V1 repeated conflicting pack import is idempotent (no Imported 2/3...)', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Local "Box" with DIFFERENT cargo so the bundled "Box" always conflicts.
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'box', name: 'Box', weight: 99 })], packLibrary: [], folderLibrary: [], preferences: {} });
  const payload = (n) => ({
    pack: { id: 'p', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('box', { id: `inst-${n}`, transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'box', name: 'Box', weight: 10 })],
  });

  const r1 = PackLibrary.importPackPayload(payload(1));
  assert.equal((StateStore.get('caseLibrary') || []).length, 2, 'first conflict creates one imported case');
  assert.equal(r1.caseConflicts.length, 1, 'first import reports one conflict');
  const importedId = r1.caseConflicts[0].newId;
  assert.equal(r1.cases[0].caseId, importedId, 'first instance remaps to the imported case');

  for (let n = 2; n <= 3; n++) {
    const r = PackLibrary.importPackPayload(payload(n));
    const lib = StateStore.get('caseLibrary') || [];
    assert.equal(lib.length, 2, `import ${n} must reuse the imported case (no growth)`);
    assert.equal(r.caseConflicts.length, 0, `import ${n} reports no new conflict`);
    assert.equal(r.cases[0].caseId, importedId, `import ${n} remaps to the same imported case id`);
    assert.equal(lib.filter(c => /\(Imported/.test(c.name)).length, 1, 'exactly one (Imported) case exists');
    assert.ok(!lib.some(c => /\(Imported [23]\)/.test(c.name)), 'no (Imported 2)/(Imported 3) names');
  }
  // Original local case stays unchanged.
  const original = (StateStore.get('caseLibrary') || []).find(c => c.id === 'box');
  assert.equal(Number(original.weight), 99, 'original local case unchanged');
});

test('CARGO-RULE-V1 pack import creates a renamed case on cargo conflict, remaps instances, leaves local unchanged', async () => {
  const StateStore = await import(stateStorePath.href);

  // Each scenario: a local case, and a bundled case that matches by name or id
  // but differs in one cargo-defining field. Each must NOT reuse the local case.
  const scenarios = [
    { label: 'different dimensions (same name)', local: { id: 'L1', name: 'Box A' }, bundled: { id: 'B1', name: 'Box A', dimensions: { length: 99, width: 10, height: 10 } } },
    { label: 'different maximum stack count (same name)', local: { id: 'L2', name: 'Box B', maxStackCount: 1 }, bundled: { id: 'B2', name: 'Box B', maxStackCount: 2 } },
    { label: 'different orientationLock (same name)', local: { id: 'L3', name: 'Box C' }, bundled: { id: 'B3', name: 'Box C', orientationLock: 'upright' } },
    { label: 'different stacking rule (same name)', local: { id: 'L4', name: 'Box D' }, bundled: { id: 'B4', name: 'Box D', noStackOnTop: true } },
    { label: 'same id, different cargo', local: { id: 'SAME', name: 'Box E' }, bundled: { id: 'SAME', name: 'Box E', weight: 777 } },
  ];

  for (const sc of scenarios) {
    const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
    const localCase = makePackImportSafeCase(sc.local);
    StateStore.init({ caseLibrary: [localCase], packLibrary: [], folderLibrary: [], preferences: {} });

    const bundledCase = makePackImportSafeCase(sc.bundled);
    const result = PackLibrary.importPackPayload({
      pack: {
        id: 'p1', title: 'Conflict Pack', truck: { length: 120, width: 60, height: 60 },
        cases: [makePackImportInstance(sc.bundled.id, { id: 'inst-x', transform: { position: { x: 10, y: 5, z: 0 } } })],
      },
      bundledCases: [bundledCase],
    });

    const lib = StateStore.get('caseLibrary') || [];
    assert.equal(lib.length, 2, `${sc.label}: a new local case must be created, not reused`);
    const original = lib.find(c => c.id === sc.local.id);
    assert.ok(original, `${sc.label}: original local case must still exist`);
    assert.equal(Number(original.dimensions.length), Number(localCase.dimensions.length), `${sc.label}: original local case must be unchanged`);
    assert.equal(Number(original.weight), Number(localCase.weight), `${sc.label}: original local weight unchanged`);
    const newCase = lib.find(c => c.id !== sc.local.id);
    assert.ok(newCase, `${sc.label}: a distinct new case id must be created`);
    assert.match(String(newCase.name), /\(Imported/, `${sc.label}: conflicting case must get an (Imported) name suffix`);
    assert.equal(result.cases[0].caseId, newCase.id, `${sc.label}: imported instance must remap to the new case id`);
    assert.equal(result.caseConflicts.length, 1, `${sc.label}: one conflict must be reported`);
  }
});

test('CARGO-RULE-V1 re-importing the same exported pack reuses cases (idempotent, no duplicate growth)', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });

  const bundled = [makePackImportSafeCase({ id: 'cc-1', name: 'Roundtrip Case', noStackOnTop: true, maxStackCount: 2, orientationLock: 'upright' })];
  const payload = () => ({
    pack: { id: 'rp', title: 'RT', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('cc-1', { id: 'i1', transform: { position: { x: 10, y: 5, z: 0 } } })] },
    bundledCases: bundled.map(c => ({ ...c })),
  });

  PackLibrary.importPackPayload(payload());
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'first import creates the case');
  const second = PackLibrary.importPackPayload(payload());
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'second import of the same pack reuses the case (no duplicate)');
  assert.equal(second.caseConflicts.length, 0, 'equivalent re-import reports no conflict');
  assert.equal(second.cases[0].caseId, 'cc-1', 'instance still references the original case id');
});

test('CARGO-RULE-V1 batch pack import applies the same cargo-conflict rule', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const localCase = makePackImportSafeCase({ id: 'bb-1', name: 'Batch Case' });
  StateStore.init({ caseLibrary: [localCase], packLibrary: [], folderLibrary: [], preferences: {} });

  // Two packs: one equivalent (reuse), one conflicting (new renamed case).
  const equivalent = { pack: { id: 'bp1', title: 'Eq', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('bb-1', { id: 'be1', transform: { position: { x: 10, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'bb-1', name: 'Batch Case' })] };
  const conflicting = { pack: { id: 'bp2', title: 'Cf', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('bb-2', { id: 'be2', transform: { position: { x: 10, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'bb-2', name: 'Batch Case', weight: 555 })] };

  const r1 = PackLibrary.importPackPayload(equivalent);
  assert.equal(r1.caseConflicts.length, 0, 'equivalent batch entry reuses local case');
  const r2 = PackLibrary.importPackPayload(conflicting);
  assert.equal(r2.caseConflicts.length, 1, 'conflicting batch entry creates a renamed case');
  const lib = StateStore.get('caseLibrary') || [];
  assert.equal(lib.length, 2, 'batch import adds exactly one new case for the conflict');
  assert.equal(r2.cases[0].caseId, r2.caseConflicts[0].newId, 'conflicting instance remaps to the new case');
});

test('PACK-IMPORT-SAFE-1 malformed transforms reject atomically while finite physical failures stay exact', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-invalid', dimensions: { length: 12, width: 12, height: 12 } });

  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = StateStore.snapshot();
  for (const transform of [undefined, null, [], {},
    { position: { x: 'bad', y: 6, z: 0 } }, { position: { x: 12, z: 0 } },
    { position: { x: Infinity, y: 6, z: 0 } }, { position: { x: 12, y: null, z: 0 } },
    { position: { x: 12, y: 6, z: 0 }, rotation: { x: NaN, y: 0, z: 0 } },
  ]) {
    const payload = makePackImportPayload(caseData, [makePackImportInstance(caseData.id, { transform })]);
    assert.throws(() => PackLibrary.planPackImport(payload), /Pack import blocked:.*transform/);
    assert.throws(() => PackLibrary.importPackPayload(payload), /Pack import blocked:.*transform/);
    assert.deepEqual(StateStore.snapshot(), before, 'neither bundled Cases nor a partial Pack may publish');
    assert.equal(StateStore.undo(), false);
  }
  for (const [position, rotation] of [
    [{ x: 999, y: 6, z: 999 }, { x: 0, y: 0, z: 0 }],
    [{ x: 12, y: 6, z: 0 }, { x: Math.PI, y: 0, z: 0 }],
  ]) {
    const definition = { ...caseData, orientationLock: 'upright' };
    const source = makePackImportInstance(caseData.id, { placement: 'packed', orientationLocked: true,
      lockedRotation: { x: 0, y: Math.PI / 2, z: 0 },
      transform: { position, rotation, scale: { x: 1, y: 1, z: 1 } } });
    const plan = PackLibrary.planPackImport(makePackImportPayload(definition, [source]));
    assert.deepEqual(plan.pack.cases[0].transform, source.transform);
    assert.equal(plan.pack.cases[0].placement, 'packed');
    assert.deepEqual(plan.pack.cases[0].lockedRotation, source.lockedRotation);
    assert.equal(plan.placementsRepaired + plan.placementsStaged, 0);
    assert.equal(PackLibrary.assessCommittedPack(plan.pack, plan.newCases).primary, 'INVALID');
  }
});

test('PACK-IMPORT-SAFE-1 duplicate finite transforms remain packed and assess as an overlap', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-dupe', dimensions: { length: 10, width: 10, height: 10 } });
  const duplicateTransform = { position: { x: 5, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };

  StateStore.init({ caseLibrary: [caseData], packLibrary: [], folderLibrary: [], preferences: {} });
  const importedPack = PackLibrary.importPackPayload(makePackImportPayload(
    caseData,
    [
      makePackImportInstance(caseData.id, { transform: duplicateTransform, placement: 'packed' }),
      makePackImportInstance(caseData.id, { transform: duplicateTransform, placement: 'packed' }),
    ],
    { truck: { length: 120, width: 60, height: 60 } }
  ));

  assert.deepEqual(importedPack.cases.map(inst => inst.transform), [duplicateTransform, duplicateTransform]);
  assert.ok(importedPack.cases.every(inst => inst.placement === 'packed'));
  const assessment = PackLibrary.assessCommittedPack(importedPack, StateStore.get('caseLibrary'));
  assert.equal(assessment.primary, 'INVALID');
  assert.ok(assessment.hard.some(finding => finding.property === 'collision' && finding.outcome === 'FAIL'));
});

test('PACK-IMPORT-SAFE-1 valid explicit non-overlapping in-truck placements are preserved', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-valid', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({ caseLibrary: [caseData], packLibrary: [], folderLibrary: [], preferences: {} });
  const importedPack = PackLibrary.importPackPayload(makePackImportPayload(
    caseData,
    [
      makePackImportInstance(caseData.id, { transform: { position: { x: 5, y: 5, z: -10 } } }),
      makePackImportInstance(caseData.id, { transform: { position: { x: 20, y: 5, z: -10 } } }),
    ],
    { truck: { length: 120, width: 60, height: 60 } }
  ));

  assertPackImportNoOverlaps(importedPack.cases, caseData);
  assert.deepEqual(
    importedPack.cases.map(inst => inst.transform.position.x).sort((a, b) => a - b),
    [5, 20],
    'Safe explicit imported X positions must be preserved'
  );
  assert.equal(PackLibrary.computeStats(importedPack, [caseData]).packedCases, 2,
    'Safe explicit imported placements should remain packed');
});

test('PACK-IMPORT-SAFE-1 addInstance default placement uses dynamic non-overlapping staging rows', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-add-staging', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-add-staging', title: 'Add Staging', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  for (let i = 0; i < 12; i++) {
    PackLibrary.addInstance('pack-add-staging', caseData.id);
  }
  const pack = PackLibrary.getById('pack-add-staging');
  assertPackImportNoOverlaps(pack.cases, caseData);

  const firstRowZ = Math.min(...pack.cases.map(inst => inst.transform.position.z));
  const firstRowCount = pack.cases.filter(inst => Math.abs(inst.transform.position.z - firstRowZ) < 0.001).length;
  assert.ok(firstRowCount > 6,
    'Dynamic staging grid should place more than six items in a row when the truck length allows it');
  assert.ok(pack.cases.every(inst => inst.transform.position.z > pack.truck.width / 2),
    'Default added instances should stage outside the truck until manually packed');
});

test('PACK-IMPORT-SAFE-1 explicit wheel-well blocked-body addInstance is staged outside the obstacle', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-add-wheelwell-blocked', dimensions: { length: 10, width: 10, height: 10 } });
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 35, wellWidth: 15, wellLength: 35, wellOffsetFromRear: 25 },
  };

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-add-wheelwell-blocked', title: 'Wheel Well Add', truck, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  const instance = PackLibrary.addInstance('pack-add-wheelwell-blocked', caseData.id, { x: 30, y: 5, z: -42 });
  const pack = PackLibrary.getById('pack-add-wheelwell-blocked');
  const aabb = getPackImportAabb(instance, caseData);

  assert.equal(instance.placement, 'staged',
    'an explicit drop intersecting a wheel-well body must be staged instead of packed');
  assert.equal(PackLibrary.aabbIntersectsWheelWellBlockedBody(aabb, truck), false,
    'the persisted staged position must not intersect the wheel-well blocked body');
  assert.ok(instance.transform.position.z > truck.width / 2,
    'blocked wheel-well drops should be moved to canonical staging outside the trailer footprint');
  assert.equal(pack.cases[0].transform.position.z, instance.transform.position.z,
    'the safe staged position must be persisted to the pack');
});

test('CARGO-RULE-V1 pack JSON export -> import round-trips all handling rules', async () => {
  const StateStore = await import(stateStorePath.href);
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [{ ...RULED_CASE }],
    packLibrary: [{ id: 'rt-pack', title: 'RT', truck: { length: 240, width: 96, height: 96 }, cases: [{ id: 'i1', caseId: 'rt-case', transform: { position: { x: 20, y: 9, z: 0 } } }] }],
    folderLibrary: [], preferences: {},
  });
  const pack = (StateStore.get('packLibrary') || [])[0];
  const json = IE.buildPackExportJSON(pack);

  // Wipe local data, then import the exported pack into an empty workspace.
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  PackLibrary.importPackPayload(IE.parsePackImportJSON(json));

  const lib = StateStore.get('caseLibrary') || [];
  const restored = lib.find(c => c.name === 'Ruled Case');
  assert.ok(restored, 'case restored from pack export');
  for (const f of HANDLING_FIELDS) {
    assert.deepEqual(restored[f], RULED_CASE[f], `pack round-trip preserves ${f}`);
  }
  assert.equal(restored.stackable, false, 'pack round-trip preserves stackable');
});

test('CARGO-RULE-V1 normalizeAppData (reload/import) preserves all handling rules', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const out = Normalizer.normalizeAppData({
    caseLibrary: [{ ...RULED_CASE }],
    packLibrary: [],
    folderLibrary: [],
  });
  const c = (out.caseLibrary || []).find(x => x.id === 'rt-case');
  assert.ok(c, 'case survives normalizeAppData');
  for (const f of HANDLING_FIELDS) {
    assert.deepEqual(c[f], RULED_CASE[f], `normalizeAppData preserves ${f}`);
  }
});

test('CARGO-RULE-V1 export/download action chains reach the right builder and sanitize filenames', async () => {
  const casesSrc = await fs.readFile(casesScreenPath, 'utf8');
  const packsSrc = await fs.readFile(packsScreenPath, 'utf8');
  // Cases template
  assert.match(casesSrc, /ImportExport\.downloadCasesTemplate\(\)/, 'cases template button calls downloadCasesTemplate');
  // Pack export -> restorable builder -> downloadText with the shared safe filename (Export Integrity C)
  assert.match(packsSrc, /ImportExport\.buildRestorablePackExportJSON\(pack\)/, 'pack export uses the restorable Load Plan builder');
  assert.match(packsSrc, /Utils\.downloadText\(Utils\.buildLoadPlanFilename\(pack, 'json'\), json\)/, 'pack export filename is sanitized');
});

test('CARGO-RULE-V1 workspace restore is exposed only in Settings; pack-batch guard points to it', async () => {
  const ieSrc = await fs.readFile(importExportPath, 'utf8');
  const callers = [];
  for (const p of ['../../src/app.js', '../../src/ui/overlays/import-pack-dialog.js', '../../src/ui/overlays/import-app-dialog.js', '../../src/ui/overlays/settings-overlay.js']) {
    const s = await fs.readFile(new URL(p, import.meta.url), 'utf8');
    if (/parseWorkspaceImportJSON/.test(s)) callers.push(p);
  }
  assert.deepEqual(callers, ['../../src/ui/overlays/settings-overlay.js'],
    'workspace restore must be wired only through the Settings permission/preflight flow');
  assert.match(ieSrc, /Use Restore Workspace Backup in Settings instead/,
    'the legacy pack-batch guard must point to the dedicated Workspace Restore action');
});

test('CARGO-RULE-V1 spreadsheet handling-cell parsers normalize and warn correctly', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  // Orientation
  assert.deepEqual(IE.parseOrientationLockCell(''), { value: 'any', valid: true, warning: null });
  assert.deepEqual(IE.parseOrientationLockCell('UPRIGHT'), { value: 'upright', valid: true, warning: null });
  assert.deepEqual(IE.parseOrientationLockCell('on-side'), { value: 'onSide', valid: true, warning: null });
  assert.deepEqual(IE.parseOrientationLockCell('on side'), { value: 'onSide', valid: true, warning: null });
  assert.equal(IE.parseOrientationLockCell('sideways').value, undefined);
  assert.equal(IE.parseOrientationLockCell('sideways').valid, false);
  assert.ok(IE.parseOrientationLockCell('sideways').warning, 'invalid orientation warns');
  // Non-neg int (maxStackCount)
  assert.deepEqual(IE.parseNonNegIntCell('', 'max'), { value: 0, warning: null });
  assert.deepEqual(IE.parseNonNegIntCell('3', 'max'), { value: 3, warning: null });
  assert.equal(IE.parseNonNegIntCell('-1', 'max').value, 0);
  assert.ok(IE.parseNonNegIntCell('-1', 'max').warning, 'negative warns');
  assert.ok(IE.parseNonNegIntCell('2.5', 'max').warning, 'non-integer warns');
  assert.ok(IE.parseNonNegIntCell('x', 'max').warning, 'non-numeric warns');
  // Non-neg num (maxPalletWeight)
  assert.deepEqual(IE.parseNonNegNumCell('2000', 'load'), { value: 2000, warning: null });
  assert.ok(IE.parseNonNegNumCell('-5', 'load').warning);
  // Lane tri-state — assert the PRODUCTION parser (parseLaneCellWarned) directly so
  // there is no test-only lane parser that can drift from production behavior.
  assert.equal(IE.parseLaneCellWarned('').value, null);
  assert.equal(IE.parseLaneCellWarned('auto').value, null);
  assert.equal(IE.parseLaneCellWarned('always').value, true);
  assert.equal(IE.parseLaneCellWarned('yes').value, true);
  assert.equal(IE.parseLaneCellWarned('never').value, false);
  assert.equal(IE.parseLaneCellWarned('0').value, false);
  // Priority
  assert.equal(IE.parseLoadPriorityCell('low').value, -1);
  assert.equal(IE.parseLoadPriorityCell('high').value, 1);
  assert.equal(IE.parseLoadPriorityCell('').value, 0);
  assert.equal(IE.parseLoadPriorityCell('5').value, 1);
  assert.ok(IE.parseLoadPriorityCell('bogus').warning);
});

test('CARGO-RULE-V1 CSV template columns all map through the parser (template/parser parity)', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const template = IE.buildCasesTemplateCSV();
  const headerLine = template.split('\n')[0];
  const normalized = headerLine.split(',').map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const idx = IE.indexMap(normalized);
  for (const f of ['name', 'length', 'width', 'height', 'weight', 'orientationLock', 'noStackOnTop', 'maxStackCount', 'isPallet', 'maxPalletWeight', 'laneItem', 'loadPriority', 'notes']) {
    assert.ok(idx[f] != null, `template column for ${f} must be recognized by the parser`);
  }
});

test('CARGO-RULE-V1 importCaseRows carries handling fields and defaults missing ones', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const baseRow = { name: 'Full Rules', length: 48, width: 24, height: 24, weight: 100 };
  const withRules = IE.importCaseRows([{ ...baseRow, canFlip: false, orientationLock: 'onSide', noStackOnTop: true, maxStackCount: 2, isPallet: true, maxPalletWeight: 1500, laneItem: false, loadPriority: 1 }], []);
  const full = withRules.nextCaseLibrary.find(c => c.name === 'Full Rules');
  assert.equal(full.orientationLock, 'onSide');
  assert.equal(full.noStackOnTop, true);
  assert.equal(full.maxStackCount, 2);
  assert.equal(full.isPallet, true);
  assert.equal(full.maxPalletWeight, 1500);
  assert.equal(full.laneItem, false);
  assert.equal(full.loadPriority, 1);

  const noRules = IE.importCaseRows([{ name: 'Bare', length: 48, width: 24, height: 24, weight: 10 }], []);
  const bare = noRules.nextCaseLibrary.find(c => c.name === 'Bare');
  assert.equal(bare.canFlip, undefined);
  assert.equal(bare.orientationLock, 'any');
  assert.equal(bare.noStackOnTop, false);
  assert.equal(bare.maxStackCount, 0);
  assert.equal(bare.isPallet, false);
  assert.equal(bare.maxPalletWeight, 0);
  assert.equal(bare.laneItem, null);
  assert.equal(bare.loadPriority, 0);
});

test('CARGO-RULE-V1 cases import preview uses the shared handling summary', async () => {
  const dialogPath = new URL('../../src/ui/overlays/import-cases-dialog.js', import.meta.url);
  const src = await fs.readFile(dialogPath, 'utf8');
  assert.match(src, /import \{ getCaseHandlingSummary \} from '\.\.\/\.\.\/services\/case-rule-summary\.js'/, 'import preview imports the shared summary');
  assert.match(src, /getCaseHandlingSummary\(record\)/, 'import preview renders the shared summary per row');
  assert.match(src, /'HANDLING'/, 'preview table has a Handling column');
});

test('CARGO-RULE-V1 normalizeInstance keeps oriented dims for unlocked rotated items (App Backup integrity)', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const HALF = Math.PI / 2;
  const caseMap = new Map([['c', { id: 'c', dimensions: { length: 30, width: 20, height: 10 } }]]);
  const mk = (rot, locked, stored) => ({ id: 'i', caseId: 'c', orientationLocked: locked, transform: { position: { x: 1, y: 1, z: 1 }, rotation: rot }, orientedDims: stored });
  const od = (rot, locked, stored) => Normalizer.normalizeInstance(mk(rot, locked, stored), caseMap).orientedDims;

  assert.equal(od({ x: 0, y: 0, z: 0 }, false), null, 'identity rotation needs no oriented dims');
  // Unlocked AutoPacked rotations must recompute (previously dropped to null).
  assert.deepEqual(od({ x: 0, y: HALF, z: 0 }, false), { length: 20, width: 30, height: 10 }, 'Y-only unlocked');
  assert.deepEqual(od({ x: HALF, y: 0, z: 0 }, false), { length: 30, width: 10, height: 20 }, 'X-tip unlocked');
  assert.deepEqual(od({ x: 0, y: 0, z: HALF }, false), { length: 10, width: 20, height: 30 }, 'Z-tip unlocked');
  // Compound rotation must match THREE.js Euler 'XYZ' (Rx*Ry*Rz). Verified against
  // a real THREE Box3 in the dedicated proof test below.
  assert.deepEqual(od({ x: HALF, y: 0, z: HALF }, false), { length: 10, width: 30, height: 20 }, 'compound unlocked');
  // Locked behaves as before.
  assert.deepEqual(od({ x: HALF, y: 0, z: 0 }, true), { length: 30, width: 10, height: 20 }, 'locked X-tip');
  // Recomputation is authoritative — stale/invalid stored dims are overridden when the case is known.
  assert.deepEqual(od({ x: HALF, y: 0, z: 0 }, false, { length: 99, width: 99, height: 99 }), { length: 30, width: 10, height: 20 }, 'stale stored dims recomputed');
  // Missing case → preserve the stored oriented dims (recomputation lacks context).
  assert.deepEqual(Normalizer.normalizeInstance(mk({ x: HALF, y: 0, z: 0 }, false, { length: 7, width: 8, height: 9 }), new Map()).orientedDims, { length: 7, width: 8, height: 9 }, 'missing case preserves stored');
});

test('C3 normalization preserves actual pose and exact intent independently without inventing targets', async () => {
  const Normalizer = await import(normalizerPath.href);
  const rotation = { x: Math.PI / 2, y: 0, z: 0 };
  const caseData = { id: 'c', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: 'upright', weight: null };
  const caseMap = new Map([['c', caseData]]);
  for (const lockedRotation of [null, undefined, { x: 0, y: Math.PI / 2, z: 0 }, { x: 0.35, y: 0, z: 0 }, { x: 0 }]) {
    const original = { id: 'i', caseId: 'c', orientationLocked: true, lockedRotation,
      canFlip: true, orientationLock: 'any', placement: 'packed', hidden: true, packedProfile: 'max-capacity',
      transform: { position: { x: 20, y: 10, z: 0 }, rotation }, orientedDims: { length: 99, width: 99, height: 99 } };
    const result = Normalizer.normalizeInstance(original, caseMap);
    assert.equal(result.orientationLocked, true);
    assert.deepEqual(result.lockedRotation, lockedRotation ?? null);
    assert.deepEqual(result.transform.rotation, rotation, 'saved forbidden pose is preserved');
    assert.deepEqual(result.transform.position, original.transform.position);
    assert.equal(result.placement, 'packed');
    assert.equal(result.hidden, true);
    assert.equal(result.packedProfile, 'max-capacity');
    assert.deepEqual(result.orientedDims, { length: 30, width: 10, height: 20 });
    assert.equal(Object.hasOwn(result, 'orientationLock'), false);
    assert.equal(Object.hasOwn(result, 'canFlip'), false);
  }
});

test('CARGO-RULE-V1 App Backup round-trip preserves an unlocked rotated instance physical size', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const HALF = Math.PI / 2;
  const appData = {
    caseLibrary: [{ id: 'cc', name: 'Rotated Case', dimensions: { length: 30, width: 20, height: 10 } }],
    packLibrary: [{
      id: 'pp', title: 'P', truck: { length: 240, width: 96, height: 96 },
      cases: [{ id: 'inst', caseId: 'cc', orientationLocked: false, placement: 'packed', transform: { position: { x: 20, y: 5, z: 0 }, rotation: { x: HALF, y: 0, z: 0 } }, orientedDims: { length: 30, width: 10, height: 20 } }],
    }],
    folderLibrary: [],
  };
  const out = Normalizer.normalizeAppData(appData);
  const inst = out.packLibrary[0].cases[0];
  assert.deepEqual(inst.orientedDims, { length: 30, width: 10, height: 20 }, 'unlocked rotated instance keeps its effective dims through backup restore');
  assert.deepEqual(inst.transform.rotation, { x: HALF, y: 0, z: 0 }, 'rotation preserved');
  // Effective height (20) differs from the case height (10), proving the rotated size survived.
  assert.notEqual(inst.orientedDims.height, 10, 'restored physical height reflects the rotation, not the unrotated case');
});

test('CARGO-RULE-V1 P1 restore matrix: App/Workspace/Pack/batch/autosave keep THREE-correct compound dims', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const H = Math.PI / 2;
  const caseDims = { length: 30, width: 20, height: 10 };
  const rot = { x: H, y: 0, z: H };
  const want = truth(caseDims, rot); // { length:10, width:30, height:20 }

  const mkPack = () => ({
    id: 'pp', title: 'P', truck: { length: 240, width: 96, height: 96 },
    cases: [{ id: 'inst', caseId: 'cc', orientationLocked: false, placement: 'packed', transform: { position: { x: 20, y: 5, z: 0 }, rotation: rot }, orientedDims: { length: 99, width: 99, height: 99 } }],
  });
  const mkApp = () => ({ caseLibrary: [{ id: 'cc', name: 'C', dimensions: caseDims }], packLibrary: [mkPack()], folderLibrary: [] });

  // App Backup restore.
  const app = Normalizer.normalizeAppData(mkApp());
  assert.deepEqual(app.packLibrary[0].cases[0].orientedDims, want, 'App Backup restore matches THREE (stale 99s overridden)');

  // Workspace normalization (same normalizeAppData entrypoint used by workspace import).
  const ws = Normalizer.normalizeAppData(mkApp());
  assert.deepEqual(ws.packLibrary[0].cases[0].orientedDims, want, 'Workspace restore matches THREE');

  // Pack JSON normalization (single pack with its bundled case map).
  const caseMap = new Map([['cc', { id: 'cc', dimensions: caseDims }]]);
  const packInst = Normalizer.normalizeInstance(mkPack().cases[0], caseMap);
  assert.deepEqual(packInst.orientedDims, want, 'Pack JSON restore matches THREE');

  // Local autosave reload (round-trip through JSON then normalize again).
  const reloaded = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(app)));
  assert.deepEqual(reloaded.packLibrary[0].cases[0].orientedDims, want, 'autosave reload is stable and THREE-correct');
});

test('CARGO-RULE-V1 P1 a valid physical placement stays valid after export and restore', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const H = Math.PI / 2;
  // Case 60L x 40W x 30H, tipped on X then turned on Z, placed inside a 240x96x96 truck.
  const caseDims = { length: 60, width: 40, height: 30 };
  const rot = { x: H, y: 0, z: H };
  const od = PackLib.getOrientedDimsForRotation(caseDims, rot);
  // Place so the oriented box sits fully inside the truck (floor at y=0, centered in z).
  const truck = { length: 240, width: 96, height: 96 };
  const appData = {
    caseLibrary: [{ id: 'cc', name: 'C', dimensions: caseDims }],
    packLibrary: [{
      id: 'pp', title: 'P', truck,
      cases: [{ id: 'inst', caseId: 'cc', orientationLocked: true, lockedRotation: rot, placement: 'packed',
        transform: { position: { x: od.length / 2 + 1, y: od.height / 2, z: 0 }, rotation: rot }, orientedDims: od }],
    }],
    folderLibrary: [],
  };
  const inBounds = (inst, t) => {
    const d = inst.orientedDims;
    const p = inst.transform.position;
    return (
      p.x - d.length / 2 >= -0.05 && p.x + d.length / 2 <= t.length + 0.05 &&
      p.y - d.height / 2 >= -0.05 && p.y + d.height / 2 <= t.height + 0.05 &&
      p.z - d.width / 2 >= -t.width / 2 - 0.05 && p.z + d.width / 2 <= t.width / 2 + 0.05
    );
  };
  const before = appData.packLibrary[0].cases[0];
  assert.ok(inBounds(Normalizer.normalizeInstance(before, new Map([['cc', { id: 'cc', dimensions: caseDims }]])), truck), 'placement valid before round-trip');
  const restored = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(appData)));
  const after = restored.packLibrary[0].cases[0];
  assert.deepEqual(after.orientedDims, od, 'oriented dims identical after export+restore');
  assert.ok(inBounds(after, truck), 'placement remains physically valid after export+restore');
});

test('CARGO-RULE-V1 spreadsheet invalid boolean and lane cells produce warnings (CSV/XLSX identical path)', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.deepEqual(IE.parseBoolCell('yes', 'allow flipping'), { value: true, warning: null });
  assert.deepEqual(IE.parseBoolCell('no', 'allow flipping'), { value: false, warning: null });
  assert.deepEqual(IE.parseBoolCell('', 'allow flipping'), { value: false, warning: null });
  assert.equal(IE.parseBoolCell('maybe', 'allow flipping').value, false);
  assert.ok(IE.parseBoolCell('maybe', 'allow flipping').warning, 'invalid boolean warns');
  assert.deepEqual(IE.parseLaneCellWarned('always'), { value: true, warning: null });
  assert.deepEqual(IE.parseLaneCellWarned(''), { value: null, warning: null });
  assert.equal(IE.parseLaneCellWarned('sometimes').value, null);
  assert.ok(IE.parseLaneCellWarned('sometimes').warning, 'invalid lane warns');
});

test('CARGO-RULE-V6 real CSV import produces structured per-row warnings (field/value/fallback/reason)', async () => {
  installWindowXLSX();
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const csv = `${CARGO_HEADER}\n${CARGO_BAD_ROW.replace('sideways', 'any')}`;
  const result = await IE.parseAndValidateSpreadsheet(makeCsvFile(csv), []);
  assert.equal(result.valid.length, 1, 'the row still imports with fallbacks');
  const rec = result.valid[0];
  assert.equal(findRowWarning(rec, 'canFlip'), null, 'retired canFlip is ignored');
  assert.equal(rec.orientationLock, 'any');
  // laneItem "sometimes" -> Automatic
  const lane = findRowWarning(rec, 'laneItem');
  assert.match(lane.message, /laneItem: "sometimes" is invalid; using Automatic/);
  // maxStackCount "2.7" floored to 2 (consistent with storage)
  const msc = findRowWarning(rec, 'maxStackCount');
  assert.ok(msc, 'maxStackCount warning present');
  assert.equal(msc.fallback, '2');
  // The aggregate/report warnings match the per-row messages exactly.
  assert.ok(result.warnings.some(w => w.includes('laneItem: "sometimes" is invalid; using Automatic')),
    'downloadable report warnings match the preview row messages');
});

test('CARGO-RULE-V6 real XLSX import yields identical structured warnings to CSV', async () => {
  installWindowXLSX();
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const aoa = [
    CARGO_HEADER.split(','),
    CARGO_BAD_ROW.replace('sideways', 'any').split(',').map((v, i) => (i >= 1 && i <= 4) ? Number(v) : v),
  ];
  const xlsxResult = await IE.parseAndValidateSpreadsheet(makeXlsxFile(aoa), []);
  const csvResult = await IE.parseAndValidateSpreadsheet(makeCsvFile(`${CARGO_HEADER}\n${CARGO_BAD_ROW.replace('sideways', 'any')}`), []);
  // CSV and XLSX must produce identical structured warnings (same fields/messages).
  const norm = res => (res.valid[0].warnings || []).map(w => `${w.field}|${w.value}|${w.fallback}`).sort();
  assert.deepEqual(norm(xlsxResult), norm(csvResult), 'XLSX and CSV warning sets are identical');
  assert.deepEqual(xlsxResult.warnings.slice().sort(), csvResult.warnings.slice().sort(),
    'XLSX and CSV downloadable-report warnings are identical');
});

test('CARGO-RULE-V8 matrix: App Backup / Workspace / autosave normalize hostile input identically', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const appData = { caseLibrary: [hostileRawCase()], packLibrary: [], folderLibrary: [] };
  // App Backup restore.
  const app = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(appData)));
  assertHostileCanonical(app.caseLibrary[0]);
  // Autosave reload (re-normalize the already-normalized data — must be stable).
  const reloaded = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(app)));
  assertHostileCanonical(reloaded.caseLibrary[0]);
  assert.deepEqual(reloaded.caseLibrary[0].dimensions, app.caseLibrary[0].dimensions, 'no stale dimension drift across reload');
});

test('CARGO-RULE-V8 matrix: CSV import sink (importCaseRows) canonicalizes hostile record', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const IE = await import(`${importExportPath.href}${stamp}`);
  // importCaseRows consumes a parsed record; feed hostile-but-parsed values.
  const rec = { name: 'Hostile', manufacturer: 'ACME', category: 'tools', length: 30, width: 20, height: 10, weight: 50,
    canFlip: 'false', stackable: 'no', noStackOnTop: 'maybe', isPallet: '1', maxStackCount: 3, maxPalletWeight: 'abc', laneItem: true, loadPriority: 1, shape: 'CYLINDER', customMeta: 'keep-me' };
  const { nextCaseLibrary } = IE.importCaseRows([rec], []);
  const c = nextCaseLibrary[0];
  // CSV has no stackable column (it is derived from no-top-load), so only assert the
  // fields the CSV path actually maps.
  assert.equal(c.canFlip, undefined); assert.equal(c.isPallet, true);
  assert.equal(c.maxPalletWeight, 0, 'malformed pallet weight -> 0'); assert.equal(c.laneItem, true);
  assert.ok(Number.isFinite(c.volume), 'volume finite');
});

test('CARGO-RULE-V8 matrix: Pack JSON import canonicalizes the bundled case and remaps the instance', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const pack = PackLibrary.importPackPayload({
    pack: { id: 'p', title: 'P', truck: { length: 240, width: 96, height: 96 },
      cases: [makePackImportInstance('hostile', { id: 'i', transform: { position: { x: 20, y: 5, z: 0 } } })] },
    bundledCases: [hostileRawCase()],
  });
  const stored = StateStore.get('caseLibrary').find(c => c.id === 'hostile') || StateStore.get('caseLibrary')[0];
  assertHostileCanonical(stored, { extensions: true });
  assert.ok(pack.cases.every(inst => StateStore.get('caseLibrary').some(c => c.id === inst.caseId)),
    'every imported instance remaps to a real stored case');
});

test('CARGO-RULE-V8 matrix: Pack batch JSON imports valid packs and skips malformed without partial mutation', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const entries = [
    { pack: { id: 'g1', title: 'G1', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('c1', { id: 'a', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'c1', name: 'C1' })] },
    { pack: { id: 'bad', title: 'B', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('m', { id: 'b', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [{ id: 'm', name: 'M', dimensions: null }] },
    { pack: { id: 'g2', title: 'G2', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('c2', { id: 'd', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'c2', name: 'C2' })] },
  ];
  let imported = 0, skipped = 0;
  const before = JSON.stringify(StateStore.get('caseLibrary'));
  for (const e of entries) { try { PackLibrary.importPackPayload(e); imported++; } catch { skipped++; } }
  assert.equal(imported, 2, 'two valid packs import');
  assert.equal(skipped, 1, 'the malformed pack is skipped');
  // The malformed entry left no orphan case (its bundled "m" never persisted).
  assert.equal(StateStore.get('caseLibrary').some(c => c.id === 'm'), false, 'malformed pack created no orphan case');
  assert.notEqual(JSON.stringify(StateStore.get('caseLibrary')), before, 'valid packs did add their cases');
});

test('CARGO-RULE-V8 matrix: compound-rotation instance + unresolved instance survive App Backup round-trip', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const H = Math.PI / 2;
  const caseDims = { length: 30, width: 20, height: 10 };
  const rot = { x: H, y: 0, z: H };
  const want = truth(caseDims, rot);
  const appData = {
    caseLibrary: [{ id: 'cc', name: 'C', dimensions: caseDims }],
    packLibrary: [{ id: 'pp', title: 'P', truck: { length: 240, width: 96, height: 96 }, cases: [
      { id: 'rot', caseId: 'cc', placement: 'packed', transform: { position: { x: 20, y: 5, z: 0 }, rotation: rot }, orientedDims: { length: 1, width: 1, height: 1 } },
      { id: 'ghost', caseId: 'missing', transform: { position: { x: 5, y: 5, z: 0 } } },
    ] }],
    folderLibrary: [],
  };
  const out = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(appData)));
  const insts = out.packLibrary[0].cases;
  const rotInst = insts.find(i => i.id === 'rot');
  assert.deepEqual(rotInst.orientedDims, want, 'compound oriented dims recomputed THREE-correctly (stale 1s overridden)');
  const ghost = insts.find(i => i.id === 'ghost');
  assert.ok(ghost, 'unresolved instance is preserved through restore, not deleted');
  assert.equal(ghost.caseId, 'missing', 'unresolved caseId preserved for repair');
});

test('C3 retired canFlip is stripped without changing physical permission or safe metadata', async () => {
  const Normalizer = await import(normalizerPath.href);
  const ImportExport = await import(importExportPath.href);
  const baseCase = { id: 'cf-1', name: 'Flip retired', dimensions: { length: 48, width: 24, height: 24 } };
  for (const canFlip of [undefined, true, false, 'maybe']) {
    for (const orientationLock of ['any', 'upright', 'onSide']) {
      const normalized = Normalizer.normalizeCase({ ...baseCase, canFlip, orientationLock,
        extension: { canFlip, keep: 'yes' } });
      assert.equal(normalized.canFlip, undefined);
      assert.equal(normalized.orientationLock, orientationLock);
      assert.deepEqual(normalized.extension, { keep: 'yes' });
      const imported = ImportExport.importCaseRows([{ name: 'Row', length: 48, width: 24, height: 24,
        weight: null, canFlip, orientationLock }], []);
      assert.equal(imported.nextCaseLibrary[0].canFlip, undefined);
      assert.equal(imported.nextCaseLibrary[0].orientationLock, orientationLock);
    }
  }
});

test('EDITOR movement paths reject collisions before persisting moved positions', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const wheelWellHelperStart = src.indexOf('function intersectsWheelWellBlockedBody(aabb)');
  const wheelWellHelperEnd = src.indexOf('\n\n    function checkCollision', wheelWellHelperStart);
  const wheelWellHelperBlock = wheelWellHelperStart >= 0 && wheelWellHelperEnd > wheelWellHelperStart
    ? src.slice(wheelWellHelperStart, wheelWellHelperEnd)
    : '';
  const collisionStart = src.indexOf('function checkCollision(instanceId, candidateWorldPos, ignoreIds)');
  const collisionEnd = src.indexOf('\n\n    /**', collisionStart);
  const collisionBlock = collisionStart >= 0 && collisionEnd > collisionStart ? src.slice(collisionStart, collisionEnd) : '';
  const nudgeStart = src.indexOf('function nudgeSelection(axis, deltaInches)');
  const nudgeEnd = src.indexOf('/**\n     * Keyboard shortcuts', nudgeStart);
  const nudgeBlock = nudgeStart >= 0 && nudgeEnd > nudgeStart ? src.slice(nudgeStart, nudgeEnd) : '';
  const applyStart = src.indexOf("savePos.addEventListener('click'");
  const applyEnd = src.indexOf('transformCard.appendChild(savePos)', applyStart);
  const applyBlock = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';

  assert.match(src, /function rejectMoveCollision\(instanceId, candidateWorld, ignoreSet\)/,
    'keyboard movement must share a collision rejection helper before persistence');
  assert.match(wheelWellHelperBlock, /aabbIntersectsWheelWellBlockedBody\(aabbWorldToInches\(aabb\), pack\.truck\)/,
    'shared movement collision must test wheel-well blocked-body penetration');
  assert.match(collisionBlock, /if \(blockedBody\) return \{ collides: true, insideTruck, blockedBody: true \};/,
    'wheel-well blocked-body penetration must be reported as a hard collision');
  assert.match(nudgeBlock, /rejectMoveCollision\(id, candidateWorld, ignoreSet\)[\s\S]*commitCasesWithManualRevalidation/,
    'keyboard nudge must reject immediate collision candidates before support-revalidating persistence');
  assert.match(nudgeBlock, /rejectMoveCollision\(id, obj\.position, ignoreSet\)[\s\S]*commitCasesWithManualRevalidation/,
    'keyboard nudge must re-check collision after gravity settling before support-revalidating persistence');
  assert.match(applyBlock, /CaseScene\.checkCollision\(inst\.id, candidateWorld, ignoreSet\)[\s\S]*updateCasesWithManualRevalidation/,
    'inspector position apply must reject immediate collision candidates before support-revalidating persistence');
  assert.match(applyBlock, /CaseScene\.checkCollision\(inst\.id, obj\.position, ignoreSet\)[\s\S]*updateCasesWithManualRevalidation/,
    'inspector position apply must re-check collision after gravity settling before support-revalidating persistence');
});

test('EDITOR rotate and flip paths reject unsafe candidates before persistence', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const rotateStart = src.indexOf('function rotateSelection(axis, delta)');
  const rotateEnd = src.indexOf('/**\n     * Nudge selected instances', rotateStart);
  const rotateBlock = rotateStart >= 0 && rotateEnd > rotateStart ? src.slice(rotateStart, rotateEnd) : '';
  const checkIndex = rotateBlock.indexOf('const check = CaseScene.checkCollision(id, obj.position, ignoreSet);');
  const rejectIndex = rotateBlock.indexOf('if (check.collides || (originalInsideTruck && !check.insideTruck))');
  const patchIndex = rotateBlock.indexOf('patchById.set(id, {', rejectIndex);
  const persistIndex = rotateBlock.indexOf('commitCasesWithManualRevalidation(packId, applyInstancePatches(pack, patchById))', patchIndex);

  assert.match(rotateBlock, /getActualPoseDimensions[\s\S]*obj\.userData\.halfWorld/,
    'manual rotate/flip validation must update the temporary oriented footprint before collision checks');
  assert.ok(checkIndex >= 0 && rejectIndex > checkIndex && patchIndex > rejectIndex && persistIndex > patchIndex,
    'manual rotate/flip must check collision and truck containment before support-revalidating PackLibrary persistence');
  assert.match(rotateBlock, /obj\.position\.copy\(originalWorld\);[\s\S]*obj\.rotation\.copy\(originalRotation\);/,
    'unsafe manual rotate/flip candidates must restore the visible object before returning');
  assert.match(rotateBlock, /Cannot rotate here: collision or truck boundary detected/,
    'unsafe manual rotate/flip candidates must notify the user instead of silently saving');
});

test('REPAIR-1C 10: corrected fixture imports identically from real CSV and real XLSX', async () => {
  installWindowXLSX();
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const csvText = fsSync.readFileSync(beamCsvFixturePath, 'utf8');
  const xlsxBytes = fsSync.readFileSync(beamXlsxFixturePath);
  const csvFile = new File([csvText], 'cargo_cases_valid.csv', { type: 'text/csv' });
  const xlsxFile = new File([new Uint8Array(xlsxBytes)], 'cargo_cases_valid.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const csvParsed = await IE.parseAndValidateSpreadsheet(csvFile, []);
  const xlsxParsed = await IE.parseAndValidateSpreadsheet(xlsxFile, []);
  // Same valid row count and identical handling for the two beams.
  assert.equal(csvParsed.valid.length, xlsxParsed.valid.length, 'CSV and XLSX produce the same valid row count');
  for (const name of ['Long Beam 144', 'Long Beam No Lane']) {
    const c = csvParsed.valid.find(r => r.name === name);
    const x = xlsxParsed.valid.find(r => r.name === name);
    assert.ok(c && x, `${name} present in both`);
    assert.equal(c.orientationLock, 'upright', `${name}: CSV imports as upright`);
    assert.equal(x.orientationLock, 'upright', `${name}: XLSX imports as upright`);
    assert.deepEqual(
      { l: c.length, w: c.width, h: c.height, flip: c.canFlip, lane: c.laneItem, ol: c.orientationLock },
      { l: x.length, w: x.width, h: x.height, flip: x.canFlip, lane: x.laneItem, ol: x.orientationLock },
      `${name}: CSV and XLSX import identically`);
  }
});

test('RECON controller always previews real changes and restores controls on every dismissal path', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const harness = makeTruckChangeHarness();
  const pack = { id: 'p', truck: RECON_RECT, cases: [reconInst('i', 30, 8, 0)] };
  const original = JSON.stringify(pack);
  let restores = 0;
  let commits = 0;
  let renderedScene = original;
  const previews = [];
  const controller = Controller.createTruckChangeController({
    PackLibrary: { ...PackLib, update: () => { commits++; return {}; } },
    CaseLibrary: { getCases: () => RECON_CASE_LIB },
    UIComponents: harness.UIComponents,
    documentRef: harness.documentRef,
  });
  const request = nextTruck => controller.request({
    pack,
    nextTruck,
    renderPreview: preview => {
      previews.push(preview);
      renderedScene = JSON.stringify(preview.pack);
    },
    restoreControls: () => {
      restores++;
      renderedScene = original;
    },
  });

  assert.equal(request({ ...RECON_RECT, length: 239 }).status, 'preview', 'all-kept geometry change still previews');
  assert.equal(previews.at(-1).pack.truck.length, 239, 'scene callback receives the proposed truck');
  assert.equal(JSON.stringify(pack), original, 'preview does not mutate source pack or StateStore data');
  harness.click(0, 'Cancel');
  assert.equal(renderedScene, original, 'Cancel restores the exact original scene snapshot');
  assert.equal(request({ ...RECON_RECT, width: 95 }).status, 'preview');
  harness.modals[1].ref.close(); // close button and overlay both use the modal close path
  assert.equal(renderedScene, original, 'X/overlay close restores the exact original scene snapshot');
  assert.equal(request({ ...RECON_RECT, height: 95 }).status, 'preview');
  harness.documentRef.escape();
  assert.equal(renderedScene, original, 'Escape restores the exact original scene snapshot');
  assert.equal(request({ ...RECON_RECT, length: 238 }).status, 'preview');
  harness.modals[3].ref.close();

  assert.equal(restores, 4, 'Cancel, X/overlay close, and Escape restore controls');
  assert.equal(commits, 0, 'no dismissal commits');
  assert.equal(JSON.stringify(pack), original, 'preview and dismissal do not mutate the pack');
  assert.equal(controller.isActive(), false, 'single-flight state releases after dismissal');
});

test('PHASE-C2 hidden retainers, rejected walls, deck-height changes, restore, and import repair stay safe', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const hiddenWall = { instanceId: 'hidden-wall', aabb: phc2Aabb(216, 240, 0, 48, -48, -30) };
  const deckItem = {
    instanceId: 'deck', caseId: 'deck', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'upright', canFlip: false, weight: 30,
  };
  const withHidden = Solver.solveAutoPack({
    truck, zones, loadFrontFirst: true, items: [deckItem], retentionPlacements: [hiddenWall],
  });
  assert.deepEqual(withHidden.retentionDependencies.get('deck'), ['hidden-wall'],
    'a physically valid hidden packed wall may retain deck cargo');
  for (const invalidWall of [
    { ...hiddenWall, placement: 'staged' },
    { ...hiddenWall, valid: false },
    { ...hiddenWall, aabb: phc2Aabb(216, 240, 0, 40, -48, -30) },
  ]) {
    const result = Solver.solveAutoPack({
      truck, zones, loadFrontFirst: true, items: [deckItem], retentionPlacements: [invalidWall],
    });
    assert.equal(result.retentionDependencies.has('deck'), false,
      'staged, invalid, malformed-height hidden walls cannot count');
  }

  const wallCase = { id: 'wall-case', dimensions: { length: 24, width: 18, height: 48 }, weight: 100, orientationLock: 'upright', canFlip: false };
  const deckCase = { id: 'deck-case', dimensions: { length: 24, width: 18, height: 16 }, weight: 30, orientationLock: 'upright', canFlip: false };
  const wallInst = phc2Instance('wall', wallCase.id, { x: 228, y: 24, z: -39 }, wallCase.dimensions);
  const deckInst = phc2Instance('deck', deckCase.id, { x: 256.8, y: 51.2, z: -39 }, deckCase.dimensions);
  const invalidated = PackLib.reconcilePlacementsForTruck(
    { id: 'invalidated', truck, cases: [{ ...wallInst, transform: { ...wallInst.transform, position: { x: 250, y: 24, z: -39 } } }, deckInst] },
    truck,
    [wallCase, deckCase]
  );
  assert.deepEqual(invalidated.invalid, ['wall', 'deck'], 'rejecting the wall also rejects its dependent deck item');

  const raisedTruck = { ...truck, shapeConfig: { ...truck.shapeConfig, bonusHeight: 60 } };
  const raised = PackLib.reconcilePlacementsForTruck(
    { id: 'raised', truck, cases: [wallInst, deckInst] }, raisedTruck, [wallCase, deckCase]
  );
  assert.ok(raised.invalid.includes('deck'), 'raising deckY above the wall invalidates the deck item');
  const raisedStaged = PackLib.stageInvalidPlacements(raised, raisedTruck, [wallCase, deckCase]);
  assert.equal(raisedStaged.cases.find(inst => inst.id === 'deck').placement, 'staged');

  const unsafe = { id: 'unsafe', truck, cases: [deckInst] };
  const restored = PackLib.repairRestoredPackPlacements(unsafe, [deckCase]);
  assert.deepEqual(restored.cases, unsafe.cases, 'C4 preserves saved physical failures');
  assert.equal(PackLib.assessCommittedPack(restored, [deckCase]).primary, 'INVALID');
  const importPlan = PackLib.planPackImport({ pack: unsafe, bundledCases: [deckCase] });
  assert.deepEqual(importPlan.pack.cases[0].transform, unsafe.cases[0].transform, 'C4 preserves imported physical pose');
  assert.equal(importPlan.pack.cases[0].placement, 'packed');
  assert.equal(PackLib.assessCommittedPack(importPlan.pack, importPlan.newCases).primary, 'INVALID');

  const shortNoTopItems = [
    { instanceId: 'short-base', caseId: 'base', dims: { l: 24, w: 18, h: 24 }, orientationLock: 'upright', canFlip: false, weight: 100, noStackOnTop: true },
    { instanceId: 'upper', caseId: 'upper', dims: { l: 24, w: 18, h: 24 }, orientationLock: 'upright', canFlip: false, weight: 30 },
  ];
  const noTop = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: shortNoTopItems });
  assert.equal(noTop.retentionDependencies.size, 0, 'short noStackOnTop base cannot gain an upper retaining wall');
});

test('AUTO-PACK-A1-PERF-1 AutoPack persists final state before animation and bypasses the planner for large loads', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const packStart = src.indexOf('async function pack()');
  const updateIndex = src.indexOf('PackLibrary.update(packId, { cases: nextCases });', packStart);
  const animationStartIndex = src.indexOf('const animationStartedAt = nowMs();', updateIndex);
  const animateCallIndex = src.indexOf('animatePlacements(', updateIndex);
  const largeBranchStart = src.indexOf('if (largeLoadSnap) {', updateIndex);
  const largeBranchEnd = src.indexOf('      } else {', largeBranchStart);
  const smallBranchEnd = src.indexOf('\n      animationMs = nowMs() - animationStartedAt;', largeBranchEnd);
  const largeBranch = largeBranchStart >= 0 && largeBranchEnd > largeBranchStart
    ? src.slice(largeBranchStart, largeBranchEnd)
    : '';
  const smallBranch = largeBranchEnd >= 0 && smallBranchEnd > largeBranchEnd
    ? src.slice(largeBranchEnd, smallBranchEnd)
    : '';

  assert.ok(updateIndex > packStart, 'AutoPack commits nextCases inside pack()');
  assert.ok(updateIndex < animationStartIndex, 'final case state is written before animation timing begins');
  assert.ok(updateIndex < animateCallIndex, 'final case state is written before any small-load animation call');
  assert.match(src, /const largeLoadSnap = shouldSnapLargeAutoPackLoad\(packedCount\);/,
    'AutoPack chooses the large-load strategy from actual packed placement count');
  assert.match(largeBranch, /animationMetrics\.skipped = true;[\s\S]*animationMetrics\.strategy = 'instant';[\s\S]*applyScenePoseFromCases\(nextCases\);/,
    'large loads snap live meshes to the already-persisted final state');
  assert.doesNotMatch(largeBranch, /animatePlacements|buildPlacementAnimationBatches|tweenInstanceToPosition/,
    'large loads must not enter the O(N^2) animation planner or per-mesh tween path');
  assert.match(smallBranch, /stageInstant\(stagingMap\);[\s\S]*animatePlacements\(/,
    'small loads still reset to staged pose and use the existing batched animation');
});

test('AUTO-PACK-A0B app and pack import paths do not strip orientation locks', async () => {
  const StateStore = await import(stateStorePath.href);
  const Storage = await import(`${storagePath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const lockedCase = {
    id: 'case-import-lock',
    name: 'Import Lock Case',
    dimensions: { length: 48, width: 24, height: 30 },
    weight: 10,
  };
  const lockedInstance = {
    id: 'inst-import-lock',
    caseId: lockedCase.id,
    transform: {
      position: { x: 4, y: 15, z: 6 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    orientationLocked: true,
    lockedRotation: { x: 0, y: Math.PI / 2, z: 0 },
    orientedDims: { length: 24, width: 48, height: 30 },
  };

  const importedApp = Storage.importAppJSON(JSON.stringify({
    app: 'Truck Packer 3D',
    data: {
      caseLibrary: [lockedCase],
      packLibrary: [
        {
          id: 'pack-app-import-lock',
          title: 'App Import Lock Pack',
          folderId: null,
          truck: { length: 100, width: 100, height: 100 },
          cases: [lockedInstance],
        },
      ],
      folderLibrary: [],
      preferences: {},
    },
  }));
  const appInst = importedApp.packLibrary[0].cases[0];
  assert.equal(appInst.orientationLocked, true,
    'App Import must preserve orientationLocked through normalizeAppData');
  assert.deepEqual(appInst.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 },
    'App Import must preserve lockedRotation through normalizeAppData');
  assert.deepEqual(appInst.orientedDims, { length: 24, width: 48, height: 30 },
    'App Import must keep safe orientedDims through normalizeAppData');
  assert.equal(importedApp.packLibrary[0].folderId, null,
    'App Import must preserve an explicit unfiled load plan');

  StateStore.init({
    caseLibrary: [lockedCase],
    packLibrary: [],
    folderLibrary: [],
    preferences: {},
  });
  const importedPack = PackLibrary.importPackPayload({
    pack: {
      id: 'pack-single-import-lock',
      title: 'Single Pack Import Lock',
      folderId: 'folder-should-clear',
      truck: { length: 100, width: 100, height: 100 },
      cases: [lockedInstance],
    },
    bundledCases: [],
  });
  const packInst = importedPack.cases[0];
  assert.equal(packInst.orientationLocked, true,
    'Single pack import must preserve orientationLocked from the imported instance');
  assert.deepEqual(packInst.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 },
    'Single pack import must preserve lockedRotation from the imported instance');
  assert.deepEqual(packInst.orientedDims, { length: 24, width: 48, height: 30 },
    'Single pack import must preserve orientedDims from the imported instance');
  assert.equal(importedPack.folderId, null,
    'Single pack import must still clear folderId');
});

test('TrialExpiredModal upgrades in-place when role resolves and never reads legacy session storage', async () => {
  const app = await readAppSource();

  // upgradeTrialModalToOwner helper exists for in-place DOM upgrade
  assert.match(app, /const upgradeTrialModalToOwner\s*=/);

  // Guard logic upgrades in-place instead of close/reopen
  assert.match(app, /if \(canManageBilling && !_trialModalCanManageBilling\)\s*\{\s*upgradeTrialModalToOwner\(/);

  // applyOrgContextFromBundle re-applies billing gate after role resolves (delegated to BillingService in Stage 1)
  assert.match(app, /BillingService\.applyAccessGateFromBilling\(BillingService\.getBillingState\(\),\s*\{\s*reason:\s*'bundle-role-resolved'\s*\}\)/);

  // resolveCanManageBillingForOrg never reads truckPacker3d:session:v1
  const fnMatch = app.match(/function resolveCanManageBillingForOrg\b[\s\S]*?return result;/);
  assert.ok(fnMatch, 'resolveCanManageBillingForOrg function must exist');
  assert.equal(fnMatch[0].includes('truckPacker3d:session:v1'), false,
    'resolveCanManageBillingForOrg must not read legacy session storage');
});

test('settings members confirms sensitive role changes and restores dropdown value on cancel', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function isSensitiveRoleChange\b[\s\S]*previous === 'owner' \|\| previous === 'admin' \|\| next === 'owner' \|\| next === 'admin'/,
    'owner/admin role changes must be classified as sensitive');
  assert.match(src, /roleSelect\.addEventListener\('change', async \(\) =>[\s\S]*UIComponents\.confirm\(/,
    'member role dropdown must confirm sensitive role changes before update');
  assert.match(src, /disabled: r === 'admin' && !isOwner/,
    'non-owners still cannot select the admin role');
  assert.match(src, /if \(!confirmed\) \{[\s\S]*roleSelect\.value = role;[\s\S]*return;/,
    'canceling role confirmation must restore the previous selected role');
  assert.match(src, /roleSelect\.value = nextRole;[\s\S]*updateMemberRole\(orgId, member, nextRole, currentUserId\)/,
    'confirmed role changes must proceed through the existing updateMemberRole path');
  assert.match(src, /updateMemberRole\(orgId, member, nextRole, currentUserId\)\.catch\(\(\) => \{[\s\S]*roleSelect\.value = role;/,
    'failed role updates restore the previous selected role');
});

test('phase 3C1 app maps invite accept failures to persistent handoff copy', async () => {
  const src = await readAppSource();
  const start = src.indexOf('const inviteHandoffNoticeId');
  const end = src.indexOf('if (!authListenerInstalled)', start);
  const inviteBlock = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(inviteBlock.length > 0, 'app invite handoff block must be present');
  assert.match(inviteBlock, /const inviteExpiredMessage = 'This invite link has expired\. Please ask the workspace owner to send a new invite\.'/,
    'expired invite failures must map to persistent expired copy');
  assert.match(inviteBlock, /const inviteRevokedMessage = 'This invite link is no longer valid\. Please ask the workspace owner to send a new invite\.'/,
    'revoked/no-longer-valid invite failures must map to persistent revoked copy');
  assert.match(inviteBlock, /const inviteWrongEmailMessage = 'Invite email does not match the signed-in account\.'/,
    'wrong-email guard copy must remain explicit');
  assert.match(inviteBlock, /const inviteGenericFailureMessage = 'This invite link could not be accepted\. Please ask the workspace owner to send a new invite\.'/,
    'generic invite failures must map to safe fallback copy');
  assert.match(inviteBlock, /function mapInviteAcceptFailureMessage\(error\)[\s\S]*includes\('expired'\)[\s\S]*inviteExpiredMessage/,
    'invite accept failure mapper must classify expired responses');
  assert.match(inviteBlock, /includes\('no longer valid'\) \|\| lower\.includes\('revoked'\)[\s\S]*inviteRevokedMessage/,
    'invite accept failure mapper must classify revoked/no-longer-valid responses');
  assert.match(inviteBlock, /includes\('invite email does not match'\)[\s\S]*inviteWrongEmailMessage/,
    'invite accept failure mapper must preserve email mismatch responses');
  // Rejection failures no longer call setInviteHandoffNotice (toast-only for signed-in users).
  // They must call clearInviteHandoffNotice() to clean up stale state, and show a toast.
  assert.match(inviteBlock, /clearInviteHandoffNotice\(\)/,
    'failed invite acceptance (signed-in) must clear stale handoff notice and rely on toast');
  assert.match(inviteBlock, /UIComponents\.showToast\(inviteMessage/,
    'failed invite acceptance must show a toast with the rejection message');
  assert.match(inviteBlock, /data-invite-handoff-message/,
    'persistent invite handoff notice element must have a stable DOM marker for browser validation');
});

test('phase 3C1 SIGNED_OUT event clears invite handoff notice to prevent stale notice persisting over auth overlay', async () => {
  const src = await readAppSource();

  // Find the onAuthStateChange handler — locate the isSignedOutEvent clearBillingState block
  const handlerStart = src.indexOf('SupabaseClient.onAuthStateChange(');
  const handlerEnd = src.indexOf('const authTruthForEvent = AuthService.getAuthTruthSnapshot()', handlerStart);
  const handlerBlock = handlerStart >= 0 && handlerEnd > handlerStart
    ? src.slice(handlerStart, handlerEnd)
    : '';

  assert.ok(handlerBlock.length > 0, 'onAuthStateChange handler block must be extractable');

  // clearInviteHandoffNotice must appear in the isSignedOutEvent branch
  const signedOutBranch = handlerBlock.match(/if\s*\(isSignedOutEvent\)[\s\S]*?(?=\}\s*else\s*if\s*\(isSignedInEvent)/);
  assert.ok(signedOutBranch, 'isSignedOutEvent branch must be present in handler');
  assert.match(signedOutBranch[0], /clearInviteHandoffNotice\(\)/,
    'SIGNED_OUT must call clearInviteHandoffNotice() to prevent stale notice persisting over the auth overlay');

  // clearBillingState and clearInviteHandoffNotice must both be in the same signed-out branch
  assert.match(signedOutBranch[0], /clearBillingState\(\)/,
    'SIGNED_OUT branch must still call clearBillingState()');
});

test('phase 3C1 signed-in invite rejection clears notice state instead of setting persistent error notice', async () => {
  const src = await readAppSource();
  const start = src.indexOf('async function tryAcceptPendingInvite(');
  const end = src.indexOf('if (!authListenerInstalled)', start);
  const fnBody = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fnBody.length > 0, 'tryAcceptPendingInvite must be extractable');

  // Rejection branches (result.ok=false and catch) must call clearInviteHandoffNotice, not set error notice
  const elseIdx = fnBody.indexOf("const inviteError = result && result.error ? result.error : '';");
  const catchIdx = fnBody.indexOf("const inviteError = err && err.message ? err.message : '';");
  assert.ok(elseIdx > 0, 'result.ok=false branch must be locatable');
  assert.ok(catchIdx > elseIdx, 'catch branch must be locatable after else branch');

  // Neither branch must call setInviteHandoffNotice with an error message
  const afterElse = fnBody.slice(elseIdx, catchIdx);
  const afterCatch = fnBody.slice(catchIdx);
  assert.doesNotMatch(afterElse, /setInviteHandoffNotice\([^)]*'error'\)/,
    'result.ok=false branch must not call setInviteHandoffNotice with error type');
  assert.doesNotMatch(afterCatch, /setInviteHandoffNotice\([^)]*'error'\)/,
    'catch branch must not call setInviteHandoffNotice with error type');

  // Both branches must call clearInviteHandoffNotice() to clean up stale state
  assert.match(afterElse, /clearInviteHandoffNotice\(\)/,
    'result.ok=false branch must call clearInviteHandoffNotice() to prevent persistent app-shell banner');
  assert.match(afterCatch, /clearInviteHandoffNotice\(\)/,
    'catch branch must call clearInviteHandoffNotice() to prevent persistent app-shell banner');

  // Both branches must still show the toast
  assert.match(afterElse, /UIComponents\.showToast\(inviteMessage/,
    'result.ok=false branch must show toast with invite failure message');
  assert.match(afterCatch, /UIComponents\.showToast\(inviteMessage/,
    'catch branch must show toast with invite failure message');
});

test('phase 0.7A-1 exportAppJSON exists and returns JSON.stringify output', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /return JSON\.stringify\(payload,\s*null,\s*2\)/,
    'exportAppJSON must return pretty JSON.stringify output');
});

test('phase 0.7A-1 exportAppJSON reads from StateStore and not raw localStorage scanning', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /StateStore\.get\(\)/,
    'exportAppJSON must read the in-memory StateStore snapshot');
  assert.doesNotMatch(fn, /localStorage|window\.localStorage|STORAGE_KEY|getScopedKey|getWorkspaceScopedKey/,
    'exportAppJSON must not scan raw localStorage keys');
});

test('phase 0.7A-1 exportAppJSON top-level payload keys remain limited', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /app:\s*'Truck Packer 3D'/,
    'exportAppJSON must include app');
  assert.match(fn, /version:\s*APP_VERSION/,
    'exportAppJSON must include version');
  assert.match(fn, /exportedAt:\s*Date\.now\(\)/,
    'exportAppJSON must include exportedAt');
  assert.match(fn, /data:\s*\{/,
    'exportAppJSON must include data object');
  assert.doesNotMatch(fn, /exportType:|schemaVersion:|appVersion:|workspaceName:|organization_id:|owner_id:|user_id:|\bemail:/,
    'exportAppJSON must not include workspace export or server identity top-level keys');
});

test('phase 0.7A-1 exportAppJSON data keys include sanitized local backup libraries only', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /caseLibrary:\s*\(state\.caseLibrary \|\| \[\]\)\.map\(projectPortableCase\)/,
    'exportAppJSON data must include canonical portable Case records');
  assert.match(fn, /sanitizeLegacyPackQuantityLibrary\(state\.packLibrary\)\.packLibrary/,
    'exportAppJSON must sanitize obsolete Pack quantity metadata');
  assert.match(fn, /packLibrary:\s*sanitizedPacks/,
    'exportAppJSON data must include the sanitized packLibrary');
  assert.match(fn, /folderLibrary:\s*Array\.isArray\(state\.folderLibrary\)/,
    'exportAppJSON data must include folderLibrary once folders are live');
  assert.match(fn, /preferences:\s*state\.preferences/,
    'exportAppJSON data must include preferences');
  assert.doesNotMatch(fn, /currentPackId/,
    'exportAppJSON must not export transient currentPackId');
  assert.doesNotMatch(fn, /billing|members|invites/,
    'exportAppJSON must not include billing, members, or invites in app export');
});

test('phase 0.7A-1 exportAppJSON does not export auth session token fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /access_token|refresh_token|id_token|bearer|authorization|service_role|apikey|apiKey/i,
    'exportAppJSON must not export auth/session token or key fields');
});

test('phase 0.7A-1 exportAppJSON does not export Stripe or billing fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /stripe_customer_id|stripe_subscription_id|customer_id|subscription_id|billing_customers|subscriptions/i,
    'exportAppJSON must not export Stripe or billing identifiers');
});

test('phase 0.7A-1 exportAppJSON does not export org server identity fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|\bemail\b|organization_members|auth\.users/i,
    'exportAppJSON must not export org/server identity fields');
});

test('phase 0.7A-1 buildAppExportJSON delegates to CoreStorage.exportAppJSON', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function buildAppExportJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'buildAppExportJSON must be extractable');
  assert.match(fn, /CoreStorage\.exportAppJSON\(\)/,
    'buildAppExportJSON must delegate to CoreStorage.exportAppJSON');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|stripe|billing|token|apikey|apiKey|localStorage/i,
    'buildAppExportJSON wrapper must not inject unsafe fields');
});

test('phase 0.7A-1 baseline app export does not include exportType', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /exportType/,
    'baseline app export must not include exportType yet');
});

test('phase 0.7A-2 exportWorkspaceJSON exists and returns the shared pretty v1 envelope', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /return buildEnvelopeJSON\(\{/,
    'exportWorkspaceJSON must return the shared pretty envelope JSON');
});

test('phase 0.7A-2 exportWorkspaceJSON marks workspace export schema', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /kind:\s*IMPORT_KIND\.WORKSPACE_BACKUP/,
    'workspace export must use the workspace-backup wire kind');
  assert.match(fn, /buildEnvelopeJSON\(\{/,
    'workspace export must use the shared cargo-planner v1 envelope');
  assert.match(fn, /appVersion:\s*APP_VERSION/,
    'workspace export must include appVersion from APP_VERSION');
  assert.match(fn, /sourceWorkspaceName/,
    'workspace export must include display-only source workspace name metadata');
  assert.match(fn, /sourceWorkspaceId/,
    'workspace export must include informational source workspace id metadata');
  assert.doesNotMatch(fn, /exportType:\s*'workspace'/,
    'new workspace exports must not continue emitting the legacy discriminator');
});

test('phase 0.7A-2 exportWorkspaceJSON reads from StateStore and not raw storage keys', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /StateStore\.get\(\)/,
    'workspace export must read the in-memory StateStore snapshot');
  assert.doesNotMatch(fn, /localStorage|window\.localStorage|STORAGE_KEY|getScopedKey|getWorkspaceScopedKey/,
    'workspace export must not scan raw localStorage keys');
});

test('phase 0.7A-2 exportWorkspaceJSON data is limited to workspace libraries', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /\bcaseLibrary,/,
    'workspace export must include caseLibrary');
  assert.match(fn, /packLibrary:\s*portablePacks\.map\(projectPortableWorkspacePack\)/,
    'workspace export must include the portable packLibrary projection');
  assert.match(fn, /folderLibrary:[\s\S]*?\.map\(projectPortableFolder\)/,
    'workspace export must include the portable folderLibrary projection');
  assert.doesNotMatch(fn, /preferences:\s*state\.preferences|currentPackId/,
    'workspace export must not include preferences or currentPackId');
});

test('phase 0.7A-2 exportWorkspaceJSON routes packs through the transient-field projection', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /portablePacks\.map\(projectPortableWorkspacePack\)/,
    'workspace export must route packs through the projection that omits thumbnails and stats');
});

test('phase 0.7A-2 exportWorkspaceJSON does not expose auth billing or server identity fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.doesNotMatch(fn, /access_token|refresh_token|id_token|bearer|authorization|service_role|apikey|apiKey/i,
    'workspace export must not include auth/session tokens or Supabase keys');
  assert.doesNotMatch(fn, /stripe_customer_id|stripe_subscription_id|customer_id|subscription_id|billing_customers|subscriptions/i,
    'workspace export must not include Stripe or billing identifiers');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|\bemail\b|organization_members|auth\.users|storage\.from/i,
    'workspace export must not include server identity, membership, auth table, or private storage fields');
});

test('phase 0.7A-2 buildWorkspaceExportJSON delegates to CoreStorage.exportWorkspaceJSON', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function buildWorkspaceExportJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'buildWorkspaceExportJSON must be extractable');
  assert.match(fn, /CoreStorage\.exportWorkspaceJSON\(workspaceName, workspaceId\)/,
    'buildWorkspaceExportJSON must delegate to CoreStorage.exportWorkspaceJSON');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|stripe|billing|token|apikey|apiKey|localStorage/i,
    'buildWorkspaceExportJSON wrapper must not inject unsafe fields');
});

test('phase 0.7A-2 parseWorkspaceImportJSON validates workspace export type', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function parseWorkspaceImportJSON(');
  const fn = start >= 0 ? src.slice(start) : '';

  assert.ok(fn, 'parseWorkspaceImportJSON must be extractable');
  assert.match(fn, /parsed\.exportType\s*!==\s*'workspace'/,
    'workspace import parser must require exportType workspace');
  assert.match(fn, /Not a workspace export file/,
    'workspace import parser must throw a clear non-workspace error');
});

test('phase 0.7A-2 parseWorkspaceImportJSON validates case and pack arrays', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  for (const [field, malformed] of [['caseLibrary', {}], ['packLibrary', {}]]) {
    const data = { caseLibrary: [], packLibrary: [], folderLibrary: [] };
    data[field] = malformed;
    assert.throws(
      () => ImportExport.parseWorkspaceImportJSON(JSON.stringify({ exportType: 'workspace', data })),
      new RegExp(`${field}.*array`, 'i'),
      `workspace import parser must reject a non-array ${field}`
    );
  }
  const parsed = ImportExport.parseWorkspaceImportJSON(JSON.stringify({
    exportType: 'workspace',
    workspaceName: 'Workspace A',
    data: { caseLibrary: [], packLibrary: [], folderLibrary: [] },
  }));
  assert.equal(parsed.workspaceName, 'Workspace A',
    'workspace import parser must return the legacy display name safely');
});

test('phase 0.7A-2 app exposes workspace export modal using existing download path', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function openExportWorkspaceModal(');
  const end = src.indexOf('\n    function openImportAppDialog', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'openExportWorkspaceModal must be extractable');
  assert.match(fn, /ImportExport\.buildRestorableWorkspaceExportJSON\(safeName, workspaceId\)/,
    'workspace export modal must build restore-preflighted workspace JSON through ImportExport');
  assert.match(fn, /Utils\.downloadText\(filename, json\)/,
    'workspace export modal must use existing downloadText path');
  assert.match(fn, /UIComponents\.showModal\(/,
    'workspace export modal must use existing modal pattern');
  assert.match(fn, /UIComponents\.showToast\(/,
    'workspace export modal must use existing toast pattern');
  assert.doesNotMatch(fn, /signOut|location\.reload|stripe|organization_id|owner_id|user_id|auth\.users|organization_members/i,
    'workspace export modal must not touch auth, reload, Stripe, or server identity data');
});

test('phase 0.7A-2 Settings General has Owner Admin gated Workspace Backup action', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /onExportWorkspace:\s*_onExportWorkspace/,
    'settings overlay must accept onExportWorkspace callback');
  assert.match(src, /exportWsBtn\.disabled = !isOwnerOrAdmin/,
    'workspace export action must remain disabled unless the current role is owner/admin');
  assert.match(src, /Export Workspace Backup/,
    'settings general must include Export Workspace Backup action label');
  assert.match(src, /_onExportWorkspace\(wsName, leaveOrgId\)/,
    'settings general export button must pass informational workspace name and id');
});

test('phase 0.7A-2 Settings includes archive export reminder without forcing archive export', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /Before archiving or making major workspace changes, you may export a workspace JSON backup\./,
    'archive section must include optional workspace export reminder');
  assert.doesNotMatch(src, /await _onExportWorkspace|if \(confirmed\) await _onExportWorkspace/,
    'archive flow must not force workspace export before archiving');
});

test('phase 0.7A-2 workspace export integration is wired into settings overlay only', async () => {
  const src = await readAppSource();

  assert.match(src, /onExportWorkspace:\s*openExportWorkspaceModal/,
    'app must wire openExportWorkspaceModal into settings overlay');
  assert.doesNotMatch(src, /window\.TruckPackerApp\.openExportWorkspace|window\.openExportWorkspace/,
    'workspace export must not add global browser entry points');
});

test('phase 0.7A-2 workspace export code avoids backend and lifecycle scope', async () => {
  const storageSrc = await fs.readFile(storagePath, 'utf8');
  const storageStart = storageSrc.indexOf('export function exportWorkspaceJSON(');
  const storageEnd = storageSrc.indexOf('\nexport function', storageStart + 1);
  const storageFn = storageStart >= 0 && storageEnd > storageStart ? storageSrc.slice(storageStart, storageEnd) : '';

  const importExportSrc = await fs.readFile(importExportPath, 'utf8');
  const buildStart = importExportSrc.indexOf('export function buildWorkspaceExportJSON(');
  const buildEnd = importExportSrc.indexOf('\nfunction ', buildStart + 1);
  const exportFns = buildStart >= 0 && buildEnd > buildStart
    ? importExportSrc.slice(buildStart, buildEnd)
    : '';
  const combined = `${storageFn}\n${exportFns}`;

  assert.doesNotMatch(combined, /supabase\/functions|functions\.invoke|createClient|serviceClient|EdgeFunction|migration/i,
    'workspace export must not add Edge Function or migration behavior');
  assert.doesNotMatch(combined, /billing-status|stripe|checkout|portal|webhook|billing_customers|subscriptions/i,
    'workspace export must not touch Stripe, billing-status, or billing tables');
  assert.doesNotMatch(combined, /archiveWorkspace|restoreWorkspace|transferOwnership|leaveWorkspace|requestAccountDeletion|purge/i,
    'workspace export must not touch workspace lifecycle or account deletion/purge flows');
});

test('APP-STABILIZATION-PHASE1 StateStore boundary replacement rebases history without changing same-scope undo', async () => {
  const StateStore = await import(`${stateStorePath.href}?phase1-history=${Date.now()}-${Math.random()}`);

  StateStore.init({ caseLibrary: [{ id: 'A-1' }], packLibrary: [], folderLibrary: [], preferences: {} });
  StateStore.set({ caseLibrary: [{ id: 'A-2' }] });
  assert.equal(StateStore.undo(), true, 'ordinary same-scope undo remains available');
  assert.deepEqual(StateStore.get('caseLibrary'), [{ id: 'A-1' }]);
  assert.equal(StateStore.redo(), true, 'ordinary same-scope redo remains available');

  let undoAvailableDuringNotification = null;
  StateStore.subscribe(changes => {
    if (changes && changes._replace) undoAvailableDuringNotification = StateStore.undo();
  });
  StateStore.replace(
    { caseLibrary: [{ id: 'B-1' }], packLibrary: [], folderLibrary: [], preferences: {} },
    { skipHistory: true, resetHistory: true }
  );

  assert.equal(undoAvailableDuringNotification, false,
    'history is reset before replacement subscribers are notified');
  assert.equal(StateStore.undo(), false, 'prior-scope history is unreachable after replacement');
  assert.equal(StateStore.redo(), false, 'prior-scope redo history is unreachable after replacement');
  assert.deepEqual(StateStore.get('caseLibrary'), [{ id: 'B-1' }]);
});

test('APP-STABILIZATION-PHASE1 debounce flush invokes the latest call once and cancel drops pending work', async () => {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let nextTimerId = 0;
  globalThis.window = {
    setTimeout(fn) {
      nextTimerId += 1;
      timers.set(nextTimerId, fn);
      return nextTimerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  try {
    const { debounce } = await import(`${browserPath.href}?phase1-debounce=${Date.now()}-${Math.random()}`);
    const calls = [];
    const receiver = { label: 'latest' };
    const debounced = debounce(function(value) {
      calls.push([this.label, value]);
    }, 250);

    debounced.call({ label: 'old' }, 'old');
    debounced.call(receiver, 'new');
    debounced.flush();
    assert.deepEqual(calls, [['latest', 'new']]);
    assert.equal(timers.size, 0, 'flush clears the delayed callback');

    debounced.call(receiver, 'cancelled');
    debounced.cancel();
    for (const fn of timers.values()) fn();
    assert.deepEqual(calls, [['latest', 'new']], 'cancelled work never executes');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('APP-STABILIZATION-PHASE1 pending autosave flushes into the outgoing scope before replacement', async () => {
  const originalWindow = globalThis.window;
  const localStorage = createStabilizationMemoryStorage();
  const timers = new Map();
  let nextTimerId = 0;
  globalThis.window = {
    localStorage,
    setTimeout(fn) {
      nextTimerId += 1;
      timers.set(nextTimerId, fn);
      return nextTimerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  try {
    const StateStore = await import(stateStorePath.href);
    const Storage = await import(`${storagePath.href}?phase1-autosave=${Date.now()}-${Math.random()}`);
    StateStore.init({ caseLibrary: [{ id: 'A-old' }], packLibrary: [], folderLibrary: [], preferences: {} });
    Storage.setStorageScope('user-A');
    Storage.setWorkspaceScope('org-A');
    Storage.saveNow();

    StateStore.set({ caseLibrary: [{ id: 'A-new' }] });
    Storage.saveSoon();
    Storage.flushPendingSave();
    assert.equal(timers.size, 0, 'flush removes the pending timer before scope changes');

    Storage.setStorageScope('user-B');
    Storage.setWorkspaceScope('org-B');
    StateStore.replace(
      { caseLibrary: [{ id: 'B' }], packLibrary: [], folderLibrary: [], preferences: {} },
      { skipHistory: true, resetHistory: true }
    );
    Storage.saveNow();
    for (const fn of timers.values()) fn();

    const savedA = JSON.parse(localStorage.getItem('truckPacker3d:v1:user-A:workspace:org-A'));
    const savedB = JSON.parse(localStorage.getItem('truckPacker3d:v1:user-B:workspace:org-B'));
    assert.deepEqual(savedA.caseLibrary, [{ id: 'A-new' }]);
    assert.deepEqual(savedB.caseLibrary, [{ id: 'B' }]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('C3 legacy stored zero mass loads as unknown without rewriting Cases or Pack poses', async () => {
  const originalWindow = globalThis.window;
  const { applyCanonicalCargoFields } = await import('../../src/core/cargo-canonical.js');
  const masses = [0, -0, '0', ' -0.00 ', '+0e2', '.0', null, 25.5, '12.5'];
  const cases = masses.map((weight, index) => ({
    id: `legacy-${index}`, name: `Saved Case ${index}`, weight, itemCode: null,
    dimensions: { length: 10, width: 12, height: 14 }, orientationLock: 'upright',
    notes: 'Keep saved metadata', createdAt: 12, canFlip: false,
  }));
  const pack = {
    id: 'saved-pack', loadPlanNumber: 'LP-00000001', customerReference: null,
    cases: [{ id: 'saved-instance', caseId: 'legacy-0', hidden: true, placement: 'staged',
      orientationLocked: true, lockedRotation: { x: 0, y: Math.PI / 2, z: 0 },
      orientedDims: { length: 12, width: 10, height: 14 },
      transform: { position: { x: -200, y: 7, z: 20 }, rotation: { x: 0, y: 0, z: 0 } } }],
  };
  const payload = { version: 'legacy', savedAt: 123, caseLibrary: cases,
    packLibrary: [pack], folderLibrary: [{ id: 'folder' }], currentPackId: pack.id };

  try {
    for (const sourceKey of ['truckPacker3d:v1', 'truckPacker3d:v1:legacy-user',
      'truckPacker3d:v1:legacy-user:workspace:legacy-org']) {
      const localStorage = createStabilizationMemoryStorage();
      globalThis.window = { localStorage, setTimeout, clearTimeout };
      const Storage = await import(`${storagePath.href}?c3-legacy=${encodeURIComponent(sourceKey)}`);
      Storage.setStorageScope('legacy-user');
      Storage.setWorkspaceScope('legacy-org');
      const original = JSON.stringify(payload);
      localStorage.setItem(sourceKey, original);
      const loaded = Storage.load();
      const canonical = loaded.caseLibrary.map(applyCanonicalCargoFields);
      assert.deepEqual(canonical.map(c => c.weight), [null, null, null, null, null, null, null, 25.5, 12.5]);
      assert.deepEqual(loaded.caseLibrary, cases.map(c => ({ ...c,
        weight: c.weight === 25.5 || c.weight === '12.5' ? c.weight : null })));
      assert.deepEqual(loaded.packLibrary, payload.packLibrary, 'load never repairs saved physical/planning state');
      assert.deepEqual(loaded.folderLibrary, payload.folderLibrary);
      assert.equal(loaded.currentPackId, pack.id);
      assert.equal(localStorage.getItem(sourceKey), original, 'reading does not overwrite the saved source');

      // The compatibility boundary must not silently convert other invalid mass.
      const invalidCases = [-1, 'bad', false, [], '1e-9999', 10000001].map((weight, i) => ({ ...cases[0], id: `bad-${i}`, weight }));
      localStorage.setItem(sourceKey, JSON.stringify({ ...payload, caseLibrary: invalidCases }));
      const invalid = Storage.load();
      assert.deepEqual(invalid.caseLibrary.map(c => c.weight), invalidCases.map(c => c.weight));
      invalid.caseLibrary.forEach(c => assert.throws(() => applyCanonicalCargoFields(c), /Invalid Case weight/));
    }
    [0, -0, '0'].forEach(weight => assert.throws(() => applyCanonicalCargoFields({ weight }), /Invalid Case weight/,
      'new writes and imports retain strict zero-mass rejection'));
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('APP-STABILIZATION-PHASE1 legacy combined storage stays intact until authoritative finalization', async () => {
  const originalWindow = globalThis.window;
  const localStorage = createStabilizationMemoryStorage();
  globalThis.window = {
    localStorage,
    setTimeout,
    clearTimeout,
  };
  const legacy = {
    version: 'legacy',
    savedAt: 7,
    preferences: { theme: 'dark' },
    caseLibrary: [{ id: 'legacy-case' }],
    packLibrary: [{ id: 'legacy-pack' }],
    folderLibrary: [{ id: 'legacy-folder' }],
    currentPackId: 'legacy-pack',
  };
  const legacyRaw = JSON.stringify(legacy);

  try {
    localStorage.setItem('truckPacker3d:v1', legacyRaw);
    const StateStore = await import(stateStorePath.href);
    const Storage = await import(`${storagePath.href}?phase1-legacy=${Date.now()}-${Math.random()}`);

    const anonLoaded = Storage.load();
    assert.equal(anonLoaded.caseLibrary[0].id, legacy.caseLibrary[0].id);
    assert.equal(anonLoaded.caseLibrary[0].itemCode, null,
      'legacy Cases receive the additive optional Item Code default in memory');
    assert.equal(anonLoaded.packLibrary[0].id, legacy.packLibrary[0].id);
    assert.match(anonLoaded.packLibrary[0].loadPlanNumber, /^LP-[0-9A-HJKMNP-TV-Z]{8}$/,
      'legacy Load Plans receive the additive required number in memory');
    assert.equal(anonLoaded.packLibrary[0].customerReference, null,
      'legacy Load Plans receive the additive optional Customer Reference default in memory');
    assert.equal(localStorage.getItem('truckPacker3d:v1'), legacyRaw,
      'anonymous loading never removes or rewrites the legacy source');

    Storage.setStorageScope('user-1');
    Storage.setWorkspaceScope('org-1');
    const scopedLoaded = Storage.load();
    StateStore.init({
      caseLibrary: scopedLoaded.caseLibrary,
      packLibrary: scopedLoaded.packLibrary,
      folderLibrary: scopedLoaded.folderLibrary,
      currentPackId: scopedLoaded.currentPackId,
      preferences: scopedLoaded.preferences,
    });
    const migrated = Storage.finalizeLegacyMigration();

    assert.equal(migrated.ok, true);
    assert.equal(localStorage.getItem('truckPacker3d:v1'), null,
      'base source is removed only after both split payloads verify');
    const userPayload = JSON.parse(localStorage.getItem('truckPacker3d:v1:user-1'));
    const workspacePayload = JSON.parse(localStorage.getItem('truckPacker3d:v1:user-1:workspace:org-1'));
    assert.deepEqual(userPayload.preferences, legacy.preferences);
    assert.equal(workspacePayload.caseLibrary[0].id, legacy.caseLibrary[0].id);
    assert.equal(workspacePayload.caseLibrary[0].itemCode, null);
    assert.equal(workspacePayload.packLibrary[0].id, legacy.packLibrary[0].id);
    assert.match(workspacePayload.packLibrary[0].loadPlanNumber, /^LP-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(workspacePayload.packLibrary[0].customerReference, null);
    assert.deepEqual(workspacePayload.folderLibrary, legacy.folderLibrary);
    assert.equal(workspacePayload.currentPackId, legacy.currentPackId);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('APP-STABILIZATION-PHASE1 failed or conflicting legacy migration preserves its source', async () => {
  const originalWindow = globalThis.window;
  const combined = {
    preferences: { theme: 'light' },
    caseLibrary: [{ id: 'legacy-case' }],
    packLibrary: [{ id: 'legacy-pack' }],
    folderLibrary: [],
    currentPackId: 'legacy-pack',
  };
  const combinedRaw = JSON.stringify(combined);

  try {
    const failingStorage = createStabilizationMemoryStorage();
    globalThis.window = { localStorage: failingStorage, setTimeout, clearTimeout };
    failingStorage.setItem('truckPacker3d:v1:user-fail', combinedRaw);
    const StateStore = await import(stateStorePath.href);
    const FailingStorage = await import(`${storagePath.href}?phase1-failure=${Date.now()}-${Math.random()}`);
    FailingStorage.setStorageScope('user-fail');
    FailingStorage.setWorkspaceScope('org-fail');
    const loaded = FailingStorage.load();
    StateStore.init({ ...loaded, selectedInstanceIds: [], currentScreen: 'packs' });
    failingStorage.setFailingKey('truckPacker3d:v1:user-fail:workspace:org-fail');
    assert.equal(FailingStorage.finalizeLegacyMigration().ok, false);
    assert.equal(failingStorage.getItem('truckPacker3d:v1:user-fail'), combinedRaw,
      'failed workspace write leaves the only combined source byte-for-byte intact');

    const conflictStorage = createStabilizationMemoryStorage();
    globalThis.window = { localStorage: conflictStorage, setTimeout, clearTimeout };
    conflictStorage.setItem('truckPacker3d:v1', combinedRaw);
    conflictStorage.setItem('truckPacker3d:v1:user-conflict', JSON.stringify({ preferences: {} }));
    const existingWorkspaceRaw = JSON.stringify({ caseLibrary: [{ id: 'existing' }], packLibrary: [] });
    conflictStorage.setItem('truckPacker3d:v1:user-conflict:workspace:org-conflict', existingWorkspaceRaw);
    const ConflictStorage = await import(`${storagePath.href}?phase1-conflict=${Date.now()}-${Math.random()}`);
    ConflictStorage.setStorageScope('user-conflict');
    ConflictStorage.setWorkspaceScope('org-conflict');
    ConflictStorage.load();
    const conflict = ConflictStorage.finalizeLegacyMigration();
    assert.equal(conflict.reason, 'workspace-exists');
    assert.equal(conflictStorage.getItem('truckPacker3d:v1'), combinedRaw,
      'conflicting legacy source remains available for recovery');
    assert.equal(conflictStorage.getItem('truckPacker3d:v1:user-conflict:workspace:org-conflict'), existingWorkspaceRaw,
      'an existing valid workspace is never overwritten');

    const changedSourceStorage = createStabilizationMemoryStorage();
    globalThis.window = { localStorage: changedSourceStorage, setTimeout, clearTimeout };
    changedSourceStorage.setItem('truckPacker3d:v1', combinedRaw);
    const ChangedSourceStorage = await import(`${storagePath.href}?phase1-source-change=${Date.now()}-${Math.random()}`);
    ChangedSourceStorage.setStorageScope('user-changed');
    ChangedSourceStorage.setWorkspaceScope('org-changed');
    ChangedSourceStorage.load();
    const newerSourceRaw = JSON.stringify({ ...combined, savedAt: 99 });
    changedSourceStorage.setItem('truckPacker3d:v1', newerSourceRaw);
    const sourceChanged = ChangedSourceStorage.finalizeLegacyMigration();
    assert.equal(sourceChanged.reason, 'source-changed');
    assert.equal(changedSourceStorage.getItem('truckPacker3d:v1'), newerSourceRaw,
      'a source changed by another tab is never removed or overwritten');
    assert.equal(changedSourceStorage.getItem('truckPacker3d:v1:user-changed:workspace:org-changed'), null,
      'a changed source is not copied into a destination under stale assumptions');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('APP-STABILIZATION-PHASE1 app flushes and resets history only at scoped boundaries', async () => {
  const src = await readAppSource();
  const workspaceScopeStart = src.indexOf('function setWorkspaceStorageScope(');
  const workspaceScopeEnd = src.indexOf('\n    function applyWorkspaceScopedLocalState(', workspaceScopeStart);
  const workspaceScopeFn = src.slice(workspaceScopeStart, workspaceScopeEnd);
  assert.ok(workspaceScopeFn.indexOf('flushPendingStorageSave()') < workspaceScopeFn.indexOf('Storage.setWorkspaceScope(scope)'),
    'workspace pending save flushes before the scope changes');

  const applyScopeStart = src.indexOf('function applyWorkspaceScopedLocalState(');
  const applyScopeEnd = src.indexOf('\n    applyPostLogoutLocalStateReset =', applyScopeStart);
  const applyScopeFn = src.slice(applyScopeStart, applyScopeEnd);
  assert.ok(applyScopeFn.indexOf('loadScopedStateOrSeed') < applyScopeFn.indexOf('restoreLiveWorkspaceUiState'),
    'same-workspace UI reconciliation happens only after the target scoped library loads');
  assert.ok(applyScopeFn.indexOf('restoreLiveWorkspaceUiState') < applyScopeFn.indexOf('suspendAutoSave = false'),
    'same-workspace UI reconciliation completes before autosave resumes');

  const resetStart = src.indexOf('function resetAppStateToEmpty(');
  const resetEnd = src.indexOf('\n    function loadScopedStateOrSeed(', resetStart);
  const resetFn = src.slice(resetStart, resetEnd);
  assert.match(resetFn, /resetHistory:\s*true/,
    'empty-state replacement rebases history');

  const loadStart = src.indexOf('function loadScopedStateOrSeed(');
  const loadEnd = src.indexOf('\n    \/\/ =+', loadStart);
  const loadFn = src.slice(loadStart, loadEnd);
  assert.equal((loadFn.match(/resetHistory:\s*true/g) || []).length, 3,
    'loaded, seeded, and empty workspace replacements all rebase history');

  const bundleStart = src.indexOf('async function applyOrgContextFromBundle(');
  const bundleEnd = src.indexOf('\n    async function refreshOrgContext(', bundleStart);
  const bundleFn = src.slice(bundleStart, bundleEnd);
  assert.match(bundleFn, /bundle\.partial !== true[\s\S]*nextOrgInActiveList[\s\S]*Storage\.finalizeLegacyMigration\(\)/,
    'legacy migration finalizes only after a full bundle confirms active membership');
});
