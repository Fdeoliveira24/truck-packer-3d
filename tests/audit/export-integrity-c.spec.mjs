/**
 * @file export-integrity-c.spec.mjs
 * @description Export Integrity C — portable round-trip and download
 *   reliability. Every portable export (Workspace Backup, App Backup, Load
 *   Plan JSON single/batch, Case Catalog) is checked against the importer or
 *   preflight that consumes it, in isolated in-memory state. Also covers the
 *   restore-limit single source of truth, deliverySequence null semantics,
 *   import repair disclosure, the pending-truck __packId boundary, the export
 *   filename contract, download DOM/object-URL cleanup, the duplicate
 *   activation guard, truthful "download started" wording and imported
 *   Screenshot resolution normalization.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function createMemoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => Array.from(values.keys())[index] || null,
    get length() { return values.size; },
  };
}

const memoryStorage = createMemoryStorage();
globalThis.window = { localStorage: memoryStorage, setTimeout, clearTimeout };

const StateStore = await import('../../src/core/state-store.js');
const Storage = await import('../../src/core/storage.js');
const Normalizer = await import('../../src/core/normalizer.js');
const Defaults = await import('../../src/core/defaults.js');
const Browser = await import('../../src/core/browser.js');
const Utils = await import('../../src/core/utils/index.js');
const ImportExport = await import('../../src/services/import-export.js');
const PackLibrary = await import('../../src/services/pack-library.js');
const CaseLibrary = await import('../../src/services/case-library.js');
const { createTruckChangeController } = await import('../../src/ui/truck-change-controller.js');

const read = rel => fs.readFile(`${repoRoot}${rel}`, 'utf8');

// ---------------------------------------------------------------------------
// Fixtures (normalized-shape records so durable projections compare exactly)
// ---------------------------------------------------------------------------

function caseRecord(overrides = {}) {
  return {
    id: 'case-1',
    name: 'Touring Audio Crate — 東京',
    itemCode: 'AUDIO-001',
    manufacturer: 'Acme',
    category: 'touring-audio',
    dimensions: { length: 20, width: 20, height: 20 },
    weight: 30,
    shape: 'box',
    canFlip: false,
    orientationLock: 'upright',
    stackable: true,
    noStackOnTop: false,
    maxStackCount: 2,
    isPallet: false,
    maxPalletWeight: 0,
    laneItem: null,
    loadPriority: 1,
    mustLoadLast: true,
    mustUnloadFirst: false,
    hazmatClass: null,
    stopGroup: 'Stop A',
    keepTogetherGroup: '',
    notes: 'Case Instructions — keep dry.',
    color: '#123abc',
    createdAt: 1700000000000,
    updatedAt: 1700000000100,
    ...overrides,
  };
}

function instanceRecord(id, x, overrides = {}) {
  return {
    id,
    caseId: 'case-1',
    transform: {
      position: { x, y: 10, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    orientationLocked: false,
    lockedRotation: null,
    orientedDims: null,
    deliverySequence: null,
    placement: 'packed',
    instanceNotes: null,
    ...overrides,
  };
}

function packRecord(overrides = {}) {
  return {
    id: 'pack-1',
    title: 'Arena / Night: 1',
    loadPlanNumber: 'LP-ARENA001',
    customerReference: 'PO-東京-44',
    client: 'Venue Client',
    projectName: 'World Tour',
    drawnBy: 'Planner',
    notes: 'Load Plan Notes — rear to front.',
    truck: {
      length: 240, width: 96, height: 100, shapeMode: 'wheelWells',
      shapeConfig: { wellHeight: 20, wellWidth: 10, wellLength: 60, wellOffsetFromRear: 90 },
    },
    cases: [
      instanceRecord('inst-1', 20, { deliverySequence: null, instanceNotes: 'Item Notes — fragile.' }),
      instanceRecord('inst-2', 50, { deliverySequence: 2 }),
      instanceRecord('inst-3', 80, { hidden: true, deliverySequence: 0 }),
      // The importers' canonical staging slot for this truck, so it round-trips exactly.
      instanceRecord('inst-4', 10, {
        placement: 'staged', transform: { position: { x: 10, y: 10, z: 70 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      }),
    ],
    folderId: 'folder-1',
    groups: [],
    stats: { totalCases: 99 },
    thumbnail: 'data:image/png;base64,AAAA',
    thumbnailUpdatedAt: 1,
    thumbnailSource: 'auto',
    thumbnailVisualSignature: 'sig',
    thumbnailViewSignature: 'view',
    thumbnailRenderVersion: 3,
    editorView: { cameraPosition: { x: 10, y: 10, z: 10 }, target: { x: 0, y: 0, z: 0 } },
    createdAt: 1700000000000,
    lastEdited: 1700000000200,
    ...overrides,
  };
}

function folderRecord(overrides = {}) {
  return {
    id: 'folder-1', name: 'Touring', scope: 'pack', parentFolderId: null, sortOrder: 0,
    createdAt: 1700000000000, updatedAt: 1700000000100, ...overrides,
  };
}

function workspaceState(overrides = {}) {
  return {
    currentScreen: 'editor',
    currentPackId: 'pack-1',
    selectedInstanceIds: ['inst-1'],
    autoPackResults: { runId: 'transient' },
    caseLibrary: [caseRecord()],
    packLibrary: [packRecord()],
    folderLibrary: [folderRecord()],
    preferences: {
      theme: 'dark',
      export: { screenshotResolution: '2560x1440', pdfIncludeStats: false },
      categories: [{ key: 'touring-audio', name: 'Touring Audio', color: '#123abc' }],
    },
    ...overrides,
  };
}

function init(state = workspaceState()) {
  StateStore.init(JSON.parse(JSON.stringify(state)));
}

const durableInstance = inst => ({
  id: inst.id,
  caseId: inst.caseId,
  transform: inst.transform,
  hidden: inst.hidden,
  groupId: inst.groupId,
  orientationLocked: inst.orientationLocked,
  deliverySequence: inst.deliverySequence,
  placement: inst.placement,
  instanceNotes: inst.instanceNotes,
});

const durablePack = pack => ({
  id: pack.id,
  title: pack.title,
  loadPlanNumber: pack.loadPlanNumber,
  customerReference: pack.customerReference,
  client: pack.client,
  projectName: pack.projectName,
  drawnBy: pack.drawnBy,
  notes: pack.notes,
  folderId: pack.folderId,
  groups: pack.groups,
  truck: {
    length: pack.truck.length, width: pack.truck.width, height: pack.truck.height,
    shapeMode: pack.truck.shapeMode, shapeConfig: pack.truck.shapeConfig,
  },
  cases: pack.cases.map(durableInstance),
});

const HANDLING_FIELDS = ['name', 'itemCode', 'category', 'dimensions', 'weight', 'shape', 'canFlip', 'orientationLock',
  'stackable', 'noStackOnTop', 'maxStackCount', 'isPallet', 'loadPriority', 'mustLoadLast', 'stopGroup', 'notes', 'color'];
const durableCase = c => Object.fromEntries(['id', ...HANDLING_FIELDS].map(key => [key, c[key]]));

function expectExportError(fn, pattern, code) {
  assert.throws(fn, error => {
    assert.match(error.message, pattern);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Fake DOM for download helpers
// ---------------------------------------------------------------------------

function installFakeDom({ clickFault = null, appendFault = null } = {}) {
  const record = { anchors: [], clicks: [], created: [], revoked: [], timers: [], body: [] };
  const previous = {
    document: globalThis.document,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
    setTimeout: globalThis.window.setTimeout,
  };
  let next = 0;
  URL.createObjectURL = blob => { const url = `blob:fake/${(next += 1)}`; record.created.push({ url, blob }); return url; };
  URL.revokeObjectURL = url => { record.revoked.push(url); };
  globalThis.window.setTimeout = (fn, ms) => { record.timers.push({ fn, ms }); return record.timers.length; };
  const body = {
    appendChild(node) {
      if (appendFault) throw new Error(appendFault);
      record.body.push(node);
      node.parentNode = body;
      return node;
    },
    removeChild(node) {
      record.body.splice(record.body.indexOf(node), 1);
      node.parentNode = null;
      return node;
    },
  };
  globalThis.document = {
    body,
    createElement(tag) {
      const node = {
        tag, href: '', download: '', parentNode: null,
        click() {
          if (clickFault) throw new Error(clickFault);
          record.clicks.push({ href: node.href, download: node.download, attached: record.body.includes(node) });
        },
      };
      record.anchors.push(node);
      return node;
    },
  };
  record.restore = () => {
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
    globalThis.window.setTimeout = previous.setTimeout;
  };
  record.flushTimers = () => record.timers.splice(0).forEach(timer => timer.fn());
  return record;
}

// ===========================================================================
// C23 / C28 — restore limits: one source of truth
// ===========================================================================

test('EXPORT-C-LIMITS restore limits are the importer constants and one shared count check', async () => {
  assert.deepEqual(
    Object.fromEntries(['maxBytes', 'maxCases', 'maxPacks', 'maxFolders', 'maxCategories', 'maxInstances']
      .map(key => [key, ImportExport.WORKSPACE_BACKUP_LIMITS[key]])),
    { maxBytes: 25 * 1024 * 1024, maxCases: 5000, maxPacks: 1000, maxFolders: 2000, maxCategories: 1000, maxInstances: 100000 },
    'limits verified from import-export.js source'
  );
  const exact = { cases: 5000, packs: 1000, folders: 2000, categories: 1000, instances: 100000 };
  assert.doesNotThrow(() => ImportExport.assertWorkspaceBackupCounts(exact), 'exact supported limits pass');
  for (const [key, label] of [['cases', 'Cases'], ['packs', 'Load Plans'], ['folders', 'folders'], ['categories', 'categories'], ['instances', 'instances']]) {
    const over = { ...exact, [key]: exact[key] + 1 };
    expectExportError(() => ImportExport.assertWorkspaceBackupCounts(over),
      new RegExp(`too many ${label} \\(${over[key]}; maximum ${exact[key]}\\)`), 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
  const source = await read('src/services/import-export.js');
  assert.equal((source.match(/maxCases: 5000/g) || []).length, 1, 'one limits table');
  assert.match(source, /function validateWorkspaceRestoreData[\s\S]*?assertWorkspaceBackupCounts\(\{/,
    'restore preflight uses the shared count check');
  assert.match(source, /function buildRestorableWorkspaceExportJSON[\s\S]*?assertWorkspaceBackupCounts\(\{/,
    'the exporter uses the same shared count check before serializing');
});

// ===========================================================================
// C1 / C27 / C28 — Workspace Backup self-preflight and round-trip
// ===========================================================================

test('EXPORT-C-WS-1 a minimal Workspace Backup passes its own restore preflight', () => {
  init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const json = ImportExport.buildRestorableWorkspaceExportJSON('Empty', 'org-1');
  const imported = ImportExport.parseWorkspaceImportJSON(json);
  assert.deepEqual([imported.caseLibrary.length, imported.packLibrary.length, imported.folderLibrary.length], [0, 0, 0]);
});

test('EXPORT-C-WS-2 representative Workspace Backup round-trips the durable contract through restore preflight', () => {
  init();
  const state = StateStore.get();
  const json = ImportExport.buildRestorableWorkspaceExportJSON('Main Workspace', 'org-1');
  const parsed = JSON.parse(json);
  assert.equal(parsed.kind, 'workspace-backup');
  assert.equal(parsed.scope.sourceWorkspaceName, 'Main Workspace');
  // C26: preferences, navigation, selection and solver/UI state are not portable.
  for (const key of ['preferences', 'currentPackId', 'selectedInstanceIds', 'autoPackResults', 'currentScreen']) {
    assert.equal(Object.hasOwn(parsed.data, key), false, `${key} is not exported`);
  }
  const exportedPack = parsed.data.packLibrary[0];
  for (const key of ['stats', 'thumbnail', 'thumbnailUpdatedAt', 'thumbnailSource', 'thumbnailRenderVersion']) {
    assert.equal(Object.hasOwn(exportedPack, key), false, `${key} is derived/transient`);
  }
  assert.deepEqual(exportedPack.editorView, state.packLibrary[0].editorView, 'Workspace keeps the normalized editorView');
  assert.deepEqual(parsed.data.categories, [{ key: 'touring-audio', name: 'Touring Audio', color: '#123abc' }],
    'referenced custom category metadata travels with the Cases');

  const plan = ImportExport.planWorkspaceRestore(ImportExport.parseWorkspaceImportJSON(json), { currentState: {} });
  assert.deepEqual(plan.packLibrary.map(durablePack), state.packLibrary.map(durablePack), 'durable Pack contract round-trips');
  assert.deepEqual(plan.caseLibrary.map(durableCase), state.caseLibrary.map(durableCase), 'durable Case contract round-trips');
  assert.deepEqual(plan.folderLibrary, state.folderLibrary);
  assert.deepEqual([plan.placementsRepaired, plan.placementsStaged], [0, 0], 'valid placements are kept exactly');
  assert.equal(plan.packLibrary[0].stats.totalCases, 4, 'stats are recomputed, not carried');
});

test('EXPORT-C-WS-3 malformed Workspace graphs refuse before any download', () => {
  const cases = [
    ['dangling Case reference', s => { s.packLibrary[0].cases[0].caseId = 'ghost'; }, /referenced case does not exist/],
    ['duplicate Case id', s => { s.caseLibrary.push(caseRecord({ name: 'Other', itemCode: 'OTHER-1' })); }, /duplicate id "case-1"/],
    ['duplicate Pack id', s => { s.packLibrary.push(packRecord({ loadPlanNumber: 'LP-OTHER01', cases: [] })); }, /duplicate id "pack-1"/],
    ['duplicate instance id', s => { s.packLibrary[0].cases[1].id = 'inst-1'; }, /duplicate id "inst-1"/],
    ['invalid folder reference', s => { s.packLibrary[0].folderId = 'folder-missing'; }, /referenced folder does not exist/],
    ['nested folder graph', s => { s.folderLibrary.push(folderRecord({ id: 'folder-2', parentFolderId: 'folder-1' })); }, /nested folder references are not supported/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const state = workspaceState();
    mutate(state);
    init(state);
    expectExportError(() => ImportExport.buildRestorableWorkspaceExportJSON('W', 'org-1'), pattern, 'WORKSPACE_BACKUP_INVALID');
    expectExportError(() => ImportExport.buildRestorableWorkspaceExportJSON('W', 'org-1'), /would not pass restore in this version/);
    assert.ok(label);
  }
});

test('EXPORT-C-WS-4 record limits fail before serialization and match the importer', () => {
  const blank = { caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} };
  const over = [
    ['Cases', { ...blank, caseLibrary: Array.from({ length: 5001 }, (_, i) => ({ id: `c${i}` })) }, 5001, 5000],
    ['Load Plans', { ...blank, packLibrary: Array.from({ length: 1001 }, (_, i) => ({ id: `p${i}`, cases: [] })) }, 1001, 1000],
    ['folders', { ...blank, folderLibrary: Array.from({ length: 2001 }, (_, i) => ({ id: `f${i}` })) }, 2001, 2000],
    ['instances', { ...blank, packLibrary: [{ id: 'p', cases: Array.from({ length: 100001 }, (_, i) => ({ id: `i${i}` })) }] }, 100001, 100000],
  ];
  for (const [label, state, count, max] of over) {
    StateStore.init(state);
    expectExportError(() => ImportExport.buildRestorableWorkspaceExportJSON('W', 'org-1'),
      new RegExp(`^Workspace Backup is too large to restore in this version\\. .*too many ${label} \\(${count}; maximum ${max}\\)`),
      'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
  // The importer reports the same limit with the same shared message.
  const envelope = JSON.stringify({
    format: 'cargo-planner', kind: 'workspace-backup', schemaVersion: 1, createdAt: '2026-09-28T00:00:00.000Z',
    appVersion: 'test', units: { length: 'in', weight: 'lb' },
    data: { caseLibrary: Array.from({ length: 5001 }, (_, i) => ({ id: `c${i}` })), packLibrary: [], folderLibrary: [] },
  });
  expectExportError(() => ImportExport.parseWorkspaceImportJSON(envelope),
    /^Workspace Backup contains too many Cases \(5001; maximum 5000\)\.$/, 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
});

test('EXPORT-C-WS-5 exact record-limit boundary passes as a real artifact; >1000 categories refuses', () => {
  const categories = count => Array.from({ length: count }, (_, i) => ({
    key: `cat-${i}`, name: `Category ${i}`, color: `#${(i + 1).toString(16).padStart(6, '0')}`,
  }));
  const cases = count => Array.from({ length: count }, (_, i) => caseRecord({
    id: `c${i}`, itemCode: `IC-${i}`, name: `Case ${i}`, category: `cat-${i % 1000}`,
  }));
  StateStore.init({
    caseLibrary: cases(5000),
    packLibrary: Array.from({ length: 1000 }, (_, i) => packRecord({ id: `p${i}`, loadPlanNumber: `LP-${i}`, folderId: null, cases: [] })),
    folderLibrary: Array.from({ length: 2000 }, (_, i) => folderRecord({ id: `f${i}` })),
    preferences: { categories: categories(1000) },
  });
  const json = ImportExport.buildRestorableWorkspaceExportJSON('Boundary', 'org-1');
  const imported = ImportExport.parseWorkspaceImportJSON(json);
  assert.deepEqual([imported.caseLibrary.length, imported.packLibrary.length, imported.folderLibrary.length, imported.categories.length],
    [5000, 1000, 2000, 1000]);

  StateStore.init({
    caseLibrary: Array.from({ length: 1001 }, (_, i) => caseRecord({ id: `c${i}`, itemCode: `IC-${i}`, category: `cat-${i}` })),
    packLibrary: [], folderLibrary: [], preferences: { categories: categories(1001) },
  });
  expectExportError(() => ImportExport.buildRestorableWorkspaceExportJSON('W', 'org-1'),
    /too large to restore in this version\. .*too many categories \(1001; maximum 1000\)/, 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
});

test('EXPORT-C-WS-6 byte limit is measured in UTF-8 on the exact artifact (boundary and >25 MiB)', () => {
  const { maxBytes } = ImportExport.WORKSPACE_BACKUP_LIMITS;
  assert.equal(ImportExport.assertWorkspaceBackupFileSize(maxBytes), maxBytes);
  expectExportError(() => ImportExport.assertWorkspaceBackupFileSize(maxBytes + 1), /too large/, 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');

  init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const json = ImportExport.buildRestorableWorkspaceExportJSON('Boundary', 'org-1');
  const padded = json + ' '.repeat(maxBytes - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(padded), maxBytes);
  assert.doesNotThrow(() => ImportExport.assertRestorableWorkspaceBackup(padded), 'exactly maxBytes restores');
  expectExportError(() => ImportExport.assertRestorableWorkspaceBackup(`${padded} `),
    /^Workspace Backup is too large to restore in this version\./, 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');

  // 9 × ~1M CJK characters: well under 25 Mi by string length, over it in UTF-8.
  StateStore.init({
    caseLibrary: Array.from({ length: 9 }, (_, i) => caseRecord({
      id: `c${i}`, itemCode: `IC-${i}`, category: 'default', notes: '東'.repeat(999999),
    })),
    packLibrary: [], folderLibrary: [], preferences: {},
  });
  const big = ImportExport.buildWorkspaceExportJSON('Big', 'org-1');
  assert.ok(big.length < maxBytes && Buffer.byteLength(big) > maxBytes, 'characters under, bytes over');
  assert.equal(new Blob([big]).size, Buffer.byteLength(big), 'the downloaded Blob has exactly the measured UTF-8 size');
  expectExportError(() => ImportExport.buildRestorableWorkspaceExportJSON('Big', 'org-1'),
    /^Workspace Backup is too large to restore in this version\./, 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
});

// ===========================================================================
// C2 / C29 — App Backup self-preflight
// ===========================================================================

test('EXPORT-C-APP-1 App Backup passes its own importer preflight and round-trips durable state', () => {
  init();
  const state = StateStore.get();
  const json = ImportExport.buildRestorableAppExportJSON();
  const parsed = JSON.parse(json);
  // Established App Backup contract: full local libraries + preferences; no
  // navigation, selection or solver state.
  assert.deepEqual(Object.keys(parsed.data).sort(), ['caseLibrary', 'folderLibrary', 'packLibrary', 'preferences']);
  assert.equal(parsed.data.preferences.theme, 'dark', 'required preferences shape retained');
  assert.equal(parsed.data.packLibrary[0].stats.totalCases, 99, 'App Backup keeps its full-state Pack record (recomputed on use)');
  const imported = ImportExport.parseAppImportJSON(json);
  assert.deepEqual(imported.packLibrary.map(durablePack), state.packLibrary.map(durablePack));
  assert.deepEqual(imported.caseLibrary.map(durableCase), state.caseLibrary.map(durableCase));
  assert.equal(imported.preferences.export.screenshotResolution, '2560x1440');
  assert.deepEqual(imported.importReport, { placementsRepaired: 0 });
});

test('EXPORT-C-APP-2 malformed App Backup graphs refuse before download', () => {
  for (const [mutate, pattern] of [
    [s => { s.packLibrary[0].cases[0].caseId = 'ghost'; }, /referenced case does not exist/],
    [s => { s.caseLibrary.push(caseRecord({ name: 'Dup', itemCode: 'DUP-1' })); }, /duplicate id "case-1"/],
    [s => { s.packLibrary[0].cases[1].id = 'inst-1'; }, /duplicate id "inst-1"/],
    [s => { s.packLibrary[0].folderId = 'folder-missing'; }, /referenced folder does not exist/],
  ]) {
    const state = workspaceState();
    mutate(state);
    init(state);
    expectExportError(() => ImportExport.buildRestorableAppExportJSON(), /^App Backup would not pass import in this version: /);
    expectExportError(() => ImportExport.buildRestorableAppExportJSON(), pattern);
  }
});

// ===========================================================================
// C4 / C5 / C30 — Load Plan JSON portability
// ===========================================================================

test('EXPORT-C-LP-1 Load Plan JSON re-imports into an isolated workspace with its durable contract', () => {
  init();
  const source = PackLibrary.getById('pack-1');
  const json = ImportExport.buildRestorablePackExportJSON(source);
  const parsed = JSON.parse(json);
  assert.equal(parsed.kind, 'pack');
  assert.deepEqual(parsed.data.bundledCases.map(c => c.id), ['case-1'], 'required Case definitions are bundled');
  for (const key of ['stats', 'thumbnail', 'thumbnailUpdatedAt', 'thumbnailSource', 'thumbnailRenderVersion', 'editorView']) {
    assert.equal(Object.hasOwn(parsed.data.pack, key), false, `${key} is not portable in a Load Plan`);
  }
  assert.equal(Object.hasOwn(parsed.data, 'unresolvedCaseRefs'), false);

  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const plan = PackLibrary.planPackImport(ImportExport.parsePackImportJSON(json));
  const imported = plan.pack;
  // D (safely normalized by the importer): new pack/instance ids, "(Imported)" title, no folder.
  assert.equal(imported.title, `${source.title} (Imported)`);
  assert.equal(imported.folderId, null);
  assert.equal(imported.loadPlanNumber, 'LP-ARENA001', 'business identity kept in a destination without a conflict');
  assert.equal(imported.customerReference, 'PO-東京-44');
  assert.deepEqual(imported.truck, source.truck, 'truck shape/config preserved');
  const byOrder = imported.cases.map(inst => ({ ...durableInstance(inst), id: null }));
  assert.deepEqual(byOrder, source.cases.map(inst => ({ ...durableInstance(inst), id: null })),
    'transforms, placement, hidden/staged, handling notes and delivery sequences (null, 0, 2) round-trip');
  assert.deepEqual([plan.placementsRepaired, plan.placementsStaged], [0, 0]);
});

test('EXPORT-C-LP-2 unresolved cargo fails before download; the diagnostic builder is unchanged', () => {
  const state = workspaceState();
  state.packLibrary[0].cases[1].caseId = 'deleted-case';
  state.packLibrary[0].cases[2].caseId = '';
  init(state);
  const pack = PackLibrary.getById('pack-1');
  expectExportError(() => ImportExport.buildRestorablePackExportJSON(pack),
    /^This load plan contains 2 unresolved cargo items and cannot be exported as a restorable Load Plan\./,
    'EXPORT_UNRESOLVED_CARGO');
  const payload = ImportExport.buildPackExportPayload(pack);
  assert.deepEqual(payload.unresolvedCaseRefs, ['deleted-case', 'unknown'], 'diagnostic projection kept for internal use');
  assert.match(ImportExport.buildPackExportJSON(pack), /"unresolvedCaseRefs"/);
  // planPackImport is not weakened: the diagnostic file still cannot import.
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  assert.throws(() => PackLibrary.planPackImport(ImportExport.parsePackImportJSON(ImportExport.buildPackExportJSON(pack))),
    /Pack import blocked/);
  expectExportError(() => ImportExport.buildRestorablePackExportJSON(null), /no longer exists/, 'EXPORT_SOURCE_MISSING');
});

test('EXPORT-C-LP-3 the exact artifact must pass the importer structural gates', () => {
  init();
  const json = ImportExport.buildRestorablePackExportJSON(PackLibrary.getById('pack-1'));
  const tamper = mutate => { const doc = JSON.parse(json); mutate(doc.data); return JSON.stringify(doc); };
  for (const [text, pattern] of [
    ['', /The file is empty/],
    ['{not json', /Invalid JSON/],
    [tamper(d => { d.bundledCases = []; }), /referenced case definition\(s\) are missing/],
    [tamper(d => { d.bundledCases[0].dimensions.length = 0; }), /invalid dimensions/],
    [tamper(d => { d.bundledCases.push({ ...d.bundledCases[0] }); }), /duplicate ids/],
    [tamper(d => { d.pack.truck.width = -1; }), /truck dimensions must be positive/],
    [tamper(d => { d.pack.loadPlanNumber = 'x'.repeat(65); }), /Business identity validation failed/],
    [JSON.stringify({ ...JSON.parse(json), kind: 'pack-batch' }), /Wrong file kind|non-empty packs/],
  ]) {
    expectExportError(() => ImportExport.assertRestorablePackExportJSON(text), pattern);
    expectExportError(() => ImportExport.assertRestorablePackExportJSON(text), /^Load Plan JSON would not pass import in this version: /);
  }
  // Load Plan import regenerates instance ids, so duplicate cargo ids are not an
  // importer requirement there (Workspace/App Backups do refuse them — see above).
  const dupIds = tamper(d => { d.pack.cases[1].id = d.pack.cases[0].id; });
  assert.doesNotThrow(() => ImportExport.assertRestorablePackExportJSON(dupIds));
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const ids = PackLibrary.planPackImport(ImportExport.parsePackImportJSON(dupIds)).pack.cases.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length, 'importer assigns fresh unique ids');
});

// ===========================================================================
// C6 — batch export: every selected Pack or nothing
// ===========================================================================

test('EXPORT-C-BATCH missing selections and unresolved Packs fail closed; valid batches re-import', async () => {
  const state = workspaceState();
  state.packLibrary.push(packRecord({ id: 'pack-2', title: 'Second', loadPlanNumber: 'LP-SECOND01', folderId: null }));
  state.packLibrary.push(packRecord({
    id: 'pack-3', title: 'Broken', loadPlanNumber: 'LP-BROKEN01', folderId: null,
    cases: [instanceRecord('b-1', 20, { caseId: 'deleted-case' })],
  }));
  init(state);
  const getById = id => PackLibrary.getById(id);
  expectExportError(() => ImportExport.resolvePackExportSelection(['pack-1', 'gone', 'pack-2'], getById),
    /^1 of the 3 selected load plans no longer exists\. Nothing was exported\./, 'EXPORT_SOURCE_MISSING');
  expectExportError(() => ImportExport.resolvePackExportSelection(['gone-a', 'gone-b'], getById),
    /^2 of the 2 selected load plans no longer exist\./);
  expectExportError(() => ImportExport.resolvePackExportSelection([], getById), /Select at least one/);
  expectExportError(() => ImportExport.buildRestorablePackBatchExportJSON([getById('pack-1'), null]), /no longer exists/);

  const broken = ImportExport.resolvePackExportSelection(['pack-1', 'pack-3'], getById);
  expectExportError(() => ImportExport.buildRestorablePackBatchExportJSON(broken),
    /^1 selected load plan contains unresolved cargo .*\("Broken"\)\. Nothing was exported\./, 'EXPORT_UNRESOLVED_CARGO');

  const packs = ImportExport.resolvePackExportSelection(['pack-2', 'pack-1'], getById);
  assert.deepEqual(packs.map(p => p.id), ['pack-2', 'pack-1'], 'selection order kept');
  const json = ImportExport.buildRestorablePackBatchExportJSON(packs);
  const entries = ImportExport.parsePackBatchImportJSON(json);
  assert.deepEqual(entries.map(e => e.pack.id), ['pack-2', 'pack-1']);
  assert.doesNotMatch(json, /__packId|unresolvedCaseRefs/);
  const source = await read('src/screens/packs-screen.js');
  assert.match(source, /ImportExport\.resolvePackExportSelection\(idsToExport,/);
  assert.doesNotMatch(source, /\.map\(id => PackLibrary\.getById\(id\)\)\.filter\(Boolean\)/, 'no silent omission');
});

// ===========================================================================
// C7 — deliverySequence null semantics
// ===========================================================================

test('EXPORT-C-SEQ deliverySequence: null/blank stay null, numbers are kept, garbage is null', () => {
  const caseMap = new Map([['case-1', caseRecord()]]);
  for (const [input, expected] of [
    [null, null], [undefined, null], ['', null], ['   ', null], [0, 0], [3, 3], [-1, -1], [2.5, 2.5],
    ['4', 4], [' 5 ', 5], ['abc', null], [NaN, null], [Infinity, null], [true, null], [[5], null], [{}, null],
  ]) {
    const inst = instanceRecord('i', 20, { deliverySequence: input });
    if (input === undefined) delete inst.deliverySequence;
    assert.equal(Normalizer.normalizeInstance(inst, caseMap).deliverySequence, expected, JSON.stringify(input));
  }
  // Round-trips through both normalizing importers.
  init();
  const sequences = pack => pack.cases.map(i => i.deliverySequence);
  const ws = ImportExport.planWorkspaceRestore(
    ImportExport.parseWorkspaceImportJSON(ImportExport.buildRestorableWorkspaceExportJSON('W', 'org-1')), { currentState: {} });
  assert.deepEqual(sequences(ws.packLibrary[0]), [null, 2, 0, null]);
  const app = ImportExport.parseAppImportJSON(ImportExport.buildRestorableAppExportJSON());
  assert.deepEqual(sequences(app.packLibrary[0]), [null, 2, 0, null]);
});

// ===========================================================================
// C8 / C31 — import repairs are disclosed
// ===========================================================================

test('EXPORT-C-REPAIR unsafe placements are still repaired and are reported, never "exact"', async () => {
  assert.equal(ImportExport.describePlacementRepairs({}), '');
  assert.equal(ImportExport.describePlacementRepairs({ placementsRepaired: 1 }), '1 cargo placement repaired for safety');
  assert.equal(ImportExport.describePlacementRepairs({ placementsRepaired: 2, placementsStaged: 3 }),
    '2 cargo placements repaired and 3 cargo placements moved to staging for safety');

  // Load Plan import: a malformed coordinate and an overlapping placement.
  init();
  const doc = JSON.parse(ImportExport.buildRestorablePackExportJSON(PackLibrary.getById('pack-1')));
  doc.data.pack.cases[0].transform.position = { x: 'abc', y: 10, z: 0 };
  doc.data.pack.cases[1].transform.position = { x: 81, y: 10, z: 0 }; // overlaps inst-3 at x=80
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const plan = PackLibrary.planPackImport(ImportExport.parsePackImportJSON(JSON.stringify(doc)));
  const [malformed, overlapping] = plan.pack.cases;
  assert.ok(['x', 'y', 'z'].every(axis => Number.isFinite(malformed.transform.position[axis])), 'repair produced a safe pose');
  assert.ok(plan.placementsRepaired + plan.placementsStaged >= 2, JSON.stringify(plan));
  assert.notEqual(overlapping.transform.position.x === 81 && overlapping.placement === 'packed', true,
    'the overlapping placement was not accepted as exact');
  assert.ok(ImportExport.describePlacementRepairs(plan).endsWith('for safety'));

  // App import: normalization of malformed poses is counted exactly.
  const state = workspaceState();
  state.packLibrary[0].cases[0].transform.position.x = 'NaN';
  state.packLibrary[0].cases[1].placement = 'floating';
  init(state);
  const app = ImportExport.parseAppImportJSON(Storage.exportAppJSON());
  assert.deepEqual(app.importReport, { placementsRepaired: 2 });
  assert.equal(app.packLibrary[0].cases[0].transform.position.x, -80, 'normalizer still supplies its safe fallback');
  assert.equal(Object.keys(app).includes('importReport'), false, 'the report is never persisted');

  const [packDialog, appDialog, settings] = await Promise.all([
    read('src/ui/overlays/import-pack-dialog.js'),
    read('src/ui/overlays/import-app-dialog.js'),
    read('src/ui/overlays/settings-overlay.js'),
  ]);
  assert.match(packDialog, /describePlacementRepairs\(result && result\.importStats\)/, 'single Load Plan import toast');
  assert.match(packDialog, /describePlacementRepairs\(repairTotals\)/, 'batch Load Plan import toast');
  assert.match(appDialog, /describePlacementRepairs\(imported\.importReport\)/);
  assert.match(settings, /describePlacementRepairs\(imported\.importReport\)/);
  assert.match(settings, /describePlacementRepairs\(plan\)/, 'Workspace restore result toast');
});

// ===========================================================================
// C9–C11 / C32 — the pending-truck __packId marker
// ===========================================================================

test('EXPORT-C-PACKID pending truck marker never reaches Pack data or portable files', async () => {
  // 1. The Editor pending truck carries the marker internally.
  const editor = await read('src/screens/editor-screen.js');
  assert.match(editor, /pendingTruck = nextTruck \? \{ \.\.\.nextTruck, __packId: pack\.id \} : null;/);
  assert.match(editor, /const next = \{\s*\.\.\.effectiveTruck,/, 'Update truck spreads the (pending) effective truck');

  // 2–4. A legitimate truck commit through the shared controller stores no marker,
  // keeps legitimate custom truck fields, and Undo/Redo stay clean.
  const state = workspaceState();
  state.packLibrary[0].truck.presetId = 'custom-53';
  init(state);
  const modals = [];
  const controller = createTruckChangeController({
    PackLibrary, CaseLibrary,
    UIComponents: { showModal: m => { modals.push(m); return { modal: null, owner: {} }; }, showToast() {} },
    documentRef: { createElement: () => ({ appendChild() {}, className: '', textContent: '' }) },
  });
  const pack = PackLibrary.getById('pack-1');
  const pendingTruck = { ...pack.truck, length: 260, __packId: pack.id };
  assert.equal(controller.request({ pack, nextTruck: pendingTruck, successMessage: 'Truck updated' }).status, 'preview');
  assert.equal(modals[0].actions.find(a => a.label === 'Apply change').onClick(), true);
  const committed = PackLibrary.getById('pack-1').truck;
  assert.equal(Object.hasOwn(committed, '__packId'), false);
  assert.equal(committed.length, 260);
  assert.equal(committed.presetId, 'custom-53', 'legitimate truck metadata preserved');
  assert.deepEqual(committed.shapeConfig, pack.truck.shapeConfig);
  Storage.setStorageScope('c-user');
  Storage.setWorkspaceScope('c-ws');
  Storage.saveNow();
  assert.ok([...memoryStorage.values.values()].every(raw => !raw.includes('__packId')), 'persisted Pack truck has no marker');
  StateStore.undo();
  assert.equal(PackLibrary.getById('pack-1').truck.length, 240);
  StateStore.redo();
  assert.equal(PackLibrary.getById('pack-1').truck.length, 260);
  assert.doesNotMatch(JSON.stringify(StateStore.get()), /__packId/, 'Undo/Redo introduce no marker');

  // Direct durable write boundary.
  PackLibrary.update('pack-1', { truck: { ...committed, __packId: 'pack-1' } });
  assert.equal(Object.hasOwn(PackLibrary.getById('pack-1').truck, '__packId'), false);

  // 5–8. Older stored data that already carries the marker never exports it.
  const polluted = workspaceState();
  polluted.packLibrary[0].truck = { ...polluted.packLibrary[0].truck, __packId: 'pack-1', presetId: 'custom-53' };
  init(polluted);
  const loadPlan = ImportExport.buildRestorablePackExportJSON(PackLibrary.getById('pack-1'));
  const workspace = ImportExport.buildRestorableWorkspaceExportJSON('W', 'org-1');
  const app = ImportExport.buildRestorableAppExportJSON();
  const batch = ImportExport.buildRestorablePackBatchExportJSON([PackLibrary.getById('pack-1')]);
  for (const [label, text] of [['Load Plan', loadPlan], ['Workspace', workspace], ['App', app], ['Batch', batch]]) {
    assert.doesNotMatch(text, /__packId/, `${label} export`);
    assert.match(text, /"presetId": "custom-53"/, `${label} keeps legitimate custom truck fields`);
  }
  assert.equal(PackLibrary.getById('pack-1').truck.__packId, 'pack-1', 'export never mutates stored state');

  // 9. Import normalization drops the known marker without touching geometry.
  const legacyApp = JSON.parse(app);
  legacyApp.data.packLibrary[0].truck.__packId = 'pack-1';
  const importedTruck = ImportExport.parseAppImportJSON(JSON.stringify(legacyApp)).packLibrary[0].truck;
  assert.equal(Object.hasOwn(importedTruck, '__packId'), false);
  assert.equal(importedTruck.length, 240);

  // 10. Narrow sanitization: only the marker goes.
  const clean = { length: 1, width: 2, height: 3, shapeMode: 'rect', shapeConfig: { a: 1 }, custom: { keep: true } };
  assert.equal(Normalizer.stripInternalTruckFields(clean), clean, 'clean trucks are returned untouched');
  assert.deepEqual(Normalizer.stripInternalTruckFields({ ...clean, __packId: 'x' }), clean);
  assert.deepEqual(Normalizer.INTERNAL_TRUCK_KEYS, ['__packId']);
});

// ===========================================================================
// C12–C15 / C33 — filename contract
// ===========================================================================

test('EXPORT-C-FILENAME export filenames are safe, useful and extension-correct', () => {
  const date = new Date(2026, 8, 28, 9, 5, 7);
  const stamp = '20260928-090507';
  const lp = (pack, ext = 'pdf') => Utils.buildLoadPlanFilename(pack, ext, { date });
  assert.equal(lp({ loadPlanNumber: 'LP-ABCD1234', title: 'Arena Show' }), `LP-ABCD1234-Arena-Show-${stamp}.pdf`);
  assert.equal(lp({ title: 'Arena Show' }, 'png'), `load-plan-Arena-Show-${stamp}.png`, 'no number → load-plan');
  assert.equal(lp({ loadPlanNumber: 'LP-1', title: '' }, 'json'), `LP-1-${stamp}.json`, 'empty title');
  assert.equal(lp({}, 'json'), `load-plan-${stamp}.json`, 'nothing known → useful fallback');
  assert.equal(lp({ id: 'uuid-internal', title: 'X' }), `load-plan-X-${stamp}.pdf`, 'internal id never used');
  assert.equal(lp({ loadPlanNumber: 'A/B\\C:D', title: 'x/y\\z:w' }), `A-B-C-D-x-y-z-w-${stamp}.pdf`, 'separators and colon');
  assert.equal(lp({ title: 'tab\there\u0000nul\u001fend' }), `load-plan-tab-here-nul-end-${stamp}.pdf`, 'control characters');
  assert.equal(lp({ title: '  many    spaces  ' }), `load-plan-many-spaces-${stamp}.pdf`, 'repeated whitespace');
  assert.equal(lp({ title: '..hidden.. ' }), `load-plan-hidden-${stamp}.pdf`, 'leading/trailing dots and spaces');
  assert.equal(lp({ title: 'Tournée Überseecontainer 東京' }), `load-plan-Tournée-Überseecontainer-東京-${stamp}.pdf`, 'readable Unicode kept');
  assert.equal(lp({ title: '////' }), `load-plan-${stamp}.pdf`, 'empty after sanitizing');
  assert.equal(lp({ title: 'report.json' }, '.JSON'), `load-plan-report-json-${stamp}.json`, 'extension appears exactly once, last');
  const long = lp({ loadPlanNumber: 'LP-1', title: '東'.repeat(500) });
  assert.ok(Buffer.byteLength(long) <= 200 && long.endsWith(`-${stamp}.pdf`), long);
  assert.equal((long.match(/\.pdf/g) || []).length, 1);
  assert.notEqual(Utils.buildLoadPlanFilename({ title: 'A' }, 'pdf', { date: new Date(2026, 0, 1, 0, 0, 0) }),
    Utils.buildLoadPlanFilename({ title: 'A' }, 'pdf', { date: new Date(2026, 0, 1, 0, 0, 1) }), 'separate exports differ');
  assert.equal(Utils.buildExportFilename(['workspace-backup', 'Acme / Tours: EU'], 'json', { date }),
    `workspace-backup-Acme-Tours-EU-${stamp}.json`);
  assert.equal(Utils.buildExportFilename('case-catalog', 'json', { date }), `case-catalog-${stamp}.json`);
  assert.equal(Utils.buildExportFilename('cases', 'xlsx', { date }), `cases-${stamp}.xlsx`);
  assert.equal(Utils.buildExportFilename('truck-packer-app-backup', 'json', { date }), `truck-packer-app-backup-${stamp}.json`);
  assert.match(Utils.formatFilenameTimestamp(), /^\d{8}-\d{6}$/);
});

test('EXPORT-C-FILENAME every export path uses the shared contract', async () => {
  const [app, packs, settings, ie] = await Promise.all([
    read('src/app.js'), read('src/screens/packs-screen.js'), read('src/ui/overlays/settings-overlay.js'),
    read('src/services/import-export.js'),
  ]);
  assert.match(app, /Utils\.buildLoadPlanFilename\(authority\.pack, 'png'\)/);
  assert.match(app, /doc\.save\(Utils\.buildLoadPlanFilename\(pack, 'pdf'\)\)/);
  assert.match(app, /Utils\.buildExportFilename\('truck-packer-app-backup', 'json'\)/);
  assert.match(app, /Utils\.buildExportFilename\(\['workspace-backup', safeName\], 'json'\)/);
  assert.match(packs, /Utils\.buildLoadPlanFilename\(pack, 'json'\)/);
  assert.match(packs, /Utils\.buildExportFilename\('load-plans', 'json'\)/);
  assert.match(settings, /Utils\.buildExportFilename\('truck-packer-app-backup', 'json'\)/);
  assert.match(ie, /Utils\.buildExportFilename\('case-catalog', 'json'\)/);
  assert.match(ie, /Utils\.buildExportFilename\('cases', extension\)/);
  assert.doesNotMatch(`${app}${packs}${settings}${ie}`, /toISOString\(\)\.slice\(0, 10\)\}\.json|todayDateStamp|function safeName\(/);
});

// ===========================================================================
// C17 / C34 — download DOM and object-URL cleanup
// ===========================================================================

test('EXPORT-C-DOWNLOAD successful downloads remove the anchor and revoke the Blob URL later', () => {
  const dom = installFakeDom();
  try {
    Browser.downloadText('a.json', '{"ok":true}');
    assert.equal(dom.anchors.length, 1);
    assert.deepEqual(dom.clicks, [{ href: 'blob:fake/1', download: 'a.json', attached: true }]);
    assert.equal(dom.body.length, 0, 'anchor removed');
    assert.deepEqual(dom.revoked, [], 'not revoked in the same task as the click');
    assert.deepEqual(dom.timers.map(t => t.ms), [Browser.OBJECT_URL_REVOKE_DELAY_MS]);
    dom.flushTimers();
    assert.deepEqual(dom.revoked, ['blob:fake/1'], 'revoked after the browser had time to consume it');

    Browser.downloadDataUrl('data:image/png;base64,AAAA', 'shot.png');
    assert.equal(dom.body.length, 0);
    assert.equal(dom.created.length, 1, 'data URLs create no object URL');
  } finally {
    dom.restore();
  }
});

test('EXPORT-C-DOWNLOAD failures remove the anchor, revoke immediately and surface the error', () => {
  for (const fault of [{ clickFault: 'click blocked' }, { appendFault: 'append blocked' }]) {
    const dom = installFakeDom(fault);
    try {
      assert.throws(() => Browser.downloadText('a.json', '{}'), /blocked/);
      assert.equal(dom.body.length, 0, 'no anchor left behind');
      assert.deepEqual(dom.revoked, ['blob:fake/1'], 'created URL revoked on failure');
      assert.deepEqual(dom.timers, []);
      assert.throws(() => Browser.downloadDataUrl('data:image/png;base64,AAAA', 's.png'), /blocked/);
      assert.equal(dom.body.length, 0);
    } finally {
      dom.restore();
    }
  }
  const dom = installFakeDom();
  try {
    assert.throws(() => Browser.downloadText('empty.json', ''), /empty\. Nothing was downloaded/);
    assert.throws(() => Browser.downloadDataUrl('', 'x.png'), /empty\. Nothing was downloaded/);
    assert.deepEqual([dom.created.length, dom.anchors.length], [0, 0], 'no URL or anchor for an empty artifact');
  } finally {
    dom.restore();
  }
});

// ===========================================================================
// C20 — artifact validation for Case exports
// ===========================================================================

test('EXPORT-C-ARTIFACT Case Catalog passes its importer; CSV/XLSX artifacts are checked before download', async () => {
  init();
  const dom = installFakeDom();
  const previousXLSX = globalThis.window.XLSX;
  try {
    const filename = ImportExport.downloadCaseCatalogExportJSON(CaseLibrary.getCases());
    assert.match(filename, /^case-catalog-\d{8}-\d{6}\.json$/);
    const text = await dom.created[0].blob.text();
    assert.equal(ImportExport.parseCaseCatalogImportJSON(text).length, 1);
    assert.equal(dom.clicks[0].download, filename);

    expectExportError(() => ImportExport.downloadCaseCatalogExportJSON([caseRecord(), caseRecord()]),
      /^Case Catalog would not pass import in this version: .*duplicate id/);
    assert.equal(dom.anchors.length, 1, 'refused catalog starts no download');

    const src = await read('vendor/xlsx.full.min.js');
    const moduleObj = { exports: {} };
    new Function('module', 'exports', 'require', src)(moduleObj, moduleObj.exports, () => ({}));
    globalThis.window.XLSX = moduleObj.exports;
    assert.match(ImportExport.downloadCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'csv' }), /^cases-\d{8}-\d{6}\.csv$/);
    assert.match(ImportExport.downloadCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'xlsx' }), /^cases-\d{8}-\d{6}\.xlsx$/);
    assert.equal(dom.clicks.length, 3);

    globalThis.window.XLSX = {
      ...moduleObj.exports,
      utils: { ...moduleObj.exports.utils, sheet_to_csv: () => '' },
      write: () => new ArrayBuffer(0),
    };
    expectExportError(() => ImportExport.downloadCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'csv' }), /missing its header row/);
    expectExportError(() => ImportExport.downloadCaseSpreadsheetExport(CaseLibrary.getCases(), { format: 'xlsx' }), /did not produce an XLSX file/);
    delete globalThis.window.XLSX;
    assert.throws(() => ImportExport.downloadCaseSpreadsheetExport(CaseLibrary.getCases()), /XLSX library not available/);
    assert.equal(dom.clicks.length, 3, 'no download for a failed artifact');
  } finally {
    globalThis.window.XLSX = previousXLSX;
    dom.restore();
  }
});

// ===========================================================================
// C16 / C35 — duplicate activation guard
// ===========================================================================

test('EXPORT-C-GUARD rapid repeats start one download; completion and failure release for retry', () => {
  const pending = [];
  const guard = Browser.createDownloadActionGuard({ schedule: (fn, ms) => pending.push({ fn, ms }) });
  let runs = 0;
  const ok = () => { runs += 1; return true; };
  assert.equal(guard.run('pdf', ok), true);
  assert.equal(guard.run('pdf', ok), false, 'double click ignored');
  assert.equal(runs, 1);
  assert.equal(guard.run('screenshot', ok), true, 'keys are independent');
  assert.deepEqual(pending.map(p => p.ms), [Browser.DOWNLOAD_ACTION_HOLD_MS, Browser.DOWNLOAD_ACTION_HOLD_MS]);
  pending.splice(0).forEach(p => p.fn());
  assert.equal(guard.run('pdf', ok), true, 'later re-export allowed');
  assert.equal(runs, 3);

  assert.equal(guard.run('json', () => false), false);
  assert.equal(guard.isActive('json'), false, 'a failed attempt releases immediately');
  assert.throws(() => guard.run('json', () => { throw new Error('boom'); }), /boom/);
  assert.equal(guard.isActive('json'), false, 'a thrown attempt releases immediately');
  assert.equal(guard.run('json', ok), true, 'retry after failure works');

  let nested = null;
  assert.equal(guard.run('slow', () => { nested = guard.run('slow', ok); return true; }), true);
  assert.equal(nested, false, 'activation during an in-flight export is ignored');
  assert.ok(Browser.DOWNLOAD_ACTION_HOLD_MS <= 1000, 'no long debounce');
});

test('EXPORT-C-GUARD every user export action runs through a download guard', async () => {
  const [app, packs, cases, settings] = await Promise.all([
    read('src/app.js'), read('src/screens/packs-screen.js'), read('src/screens/cases-screen.js'),
    read('src/ui/overlays/settings-overlay.js'),
  ]);
  assert.match(app, /return exportDownloadGuard\.run\('screenshot', exportScreenshot\);/);
  assert.match(app, /return exportDownloadGuard\.run\('pdf', exportPDF\);/);
  assert.match(app, /Utils\.downloadActionGuard\.run\('app-backup'/);
  assert.match(app, /Utils\.downloadActionGuard\.run\('workspace-backup'/);
  assert.match(packs, /Utils\.downloadActionGuard\.run\(`load-plan-json:\$\{packId\}`/);
  assert.match(packs, /Utils\.downloadActionGuard\.run\('load-plan-batch-json'/);
  assert.match(cases, /exportCases\('case-catalog-json'/);
  assert.match(cases, /exportCases\('cases-csv'/);
  assert.match(cases, /exportCases\('cases-xlsx'/);
  assert.match(cases, /Utils\.downloadActionGuard\.run\(key,/);
  assert.match(settings, /Utils\.downloadActionGuard\.run\('app-backup'/);
});

// ===========================================================================
// C18 / C19 / C36 — truthful, visible outcomes (real ExportService code)
// ===========================================================================

async function loadScreenshotService({ fault = null, pack = { id: 'p', title: 'Show / Night', loadPlanNumber: 'LP-ABC' } } = {}) {
  const appSource = await read('src/app.js');
  const constants = appSource.slice(appSource.indexOf('      const SCREENSHOT_RESOLUTIONS ='),
    appSource.indexOf('      function captureScreenshot('));
  const service = appSource.slice(appSource.indexOf('      function captureScreenshot('),
    appSource.indexOf('      function renderCameraToDataUrl('));
  const pending = [];
  const calls = { downloads: [], toasts: [], errors: [] };
  const guardSource = 'Utils.createDownloadActionGuard()';
  assert.ok(constants.includes(guardSource), 'ExportService owns one download guard');
  const deps = {
    THREE: {}, window: {}, document: {}, BillingService: {}, openSettingsOverlay() {}, ImportExport: {}, CategoryService: {},
    console: { error: error => calls.errors.push(error.message) },
    UIComponents: { showToast: (...args) => calls.toasts.push(args.slice(0, 2)) },
    PreferencesManager: { get: () => ({ export: { screenshotResolution: '1920x1080' } }) },
    Utils: {
      parseResolution: Utils.parseResolution,
      buildLoadPlanFilename: Utils.buildLoadPlanFilename,
      createDownloadActionGuard: () => Browser.createDownloadActionGuard({ schedule: fn => pending.push(fn) }),
      downloadDataUrl: (url, name) => {
        if (fault) throw new Error(fault);
        calls.downloads.push(name);
      },
    },
    StateStore: { get: () => pack.id },
    PackLibrary: { getById: id => (id === pack.id ? pack : null) },
    CaseLibrary: {},
    OperationLifecycle: { isBusy: () => false },
    EditorUI: { getExportScene: () => scene },
    SceneManager: { getScene: () => ({ background: null }), getCamera: () => ({}), render() {} },
    CaseScene: { beginExportCapture: () => () => {} },
    renderCameraToDataUrl: () => 'data:image/png;base64,AAAA',
  };
  const scene = { pack };
  const api = new Function(...Object.keys(deps), `${constants}${service}\nreturn { captureScreenshot };`)(...Object.values(deps));
  return { api, calls, release: () => pending.splice(0).forEach(fn => fn()) };
}

test('EXPORT-C-OUTCOME Screenshot: one download per activation, "download started", visible failure and retry', async () => {
  const { api, calls, release } = await loadScreenshotService();
  assert.equal(api.captureScreenshot(), true);
  assert.equal(api.captureScreenshot(), false, 'rapid second activation ignored');
  assert.equal(calls.downloads.length, 1);
  assert.match(calls.downloads[0], /^LP-ABC-Show-Night-\d{8}-\d{6}\.png$/);
  assert.deepEqual(calls.toasts, [['Screenshot download started', 'success']]);
  release();
  assert.equal(api.captureScreenshot(), true, 'later activation allowed');
  assert.equal(calls.downloads.length, 2);

  const failing = await loadScreenshotService({ fault: 'download blocked' });
  assert.equal(failing.api.captureScreenshot(), false);
  assert.deepEqual(failing.calls.toasts, [['Screenshot failed: download blocked', 'error']]);
  assert.equal(failing.api.captureScreenshot(), false, 'retry is attempted (not blocked) and fails visibly again');
  assert.equal(failing.calls.toasts.length, 2);
});

test('EXPORT-C-OUTCOME success says "download started"; failures are always visible', async () => {
  const files = ['src/app.js', 'src/screens/packs-screen.js', 'src/screens/cases-screen.js', 'src/ui/overlays/settings-overlay.js'];
  const sources = await Promise.all(files.map(read));
  const all = sources.join('\n');
  for (const stale of ['Screenshot saved', 'PDF exported', 'App JSON exported', 'Load plan JSON exported', 'Backup saved']) {
    assert.equal(all.includes(`'${stale}'`), false, `no "${stale}" wording`);
  }
  for (const started of ["'Screenshot download started'", "'PDF download started'", "'App Backup download started'",
    "'Workspace Backup download started'", "'Load plan JSON download started'"]) {
    assert.ok(all.includes(started), started);
  }
  const packs = sources[1];
  const exportPack = packs.slice(packs.indexOf('function exportPack('), packs.indexOf('async function deletePack('));
  assert.doesNotMatch(exportPack, /if \(!pack\) return;/, 'a missing Pack no longer fails silently');
  assert.match(exportPack, /toast\('Export failed: ' \+ \(err && err\.message\), 'error'\)/);
  const cases = sources[2];
  assert.match(cases, /UIComponents\.showToast\('Export failed: ' \+ \(err && err\.message\), 'error'\)/,
    'spreadsheet library failures are visible');
  assert.match(cases, /UIComponents\.showToast\('Download failed: ' \+ \(err && err\.message\), 'error'\)/, 'template download');
});

// ===========================================================================
// C22 — imported Screenshot resolution normalization
// ===========================================================================

test('EXPORT-C-RESOLUTION stored/imported Screenshot resolution normalizes to supported choices', async () => {
  assert.deepEqual([...Defaults.SCREENSHOT_RESOLUTIONS], ['1920x1080', '2560x1440', '3840x2160']);
  for (const value of ['99999x99999', '0x0', 'banana', '1280x720', '', null, 1920, { w: 1 }]) {
    assert.equal(Normalizer.normalizePreferences({ export: { screenshotResolution: value } }).export.screenshotResolution,
      '1920x1080', JSON.stringify(value));
  }
  for (const value of Defaults.SCREENSHOT_RESOLUTIONS) {
    assert.equal(Normalizer.normalizePreferences({ export: { screenshotResolution: value } }).export.screenshotResolution, value);
  }
  const state = workspaceState();
  state.preferences.export.screenshotResolution = '99999x99999';
  init(state);
  assert.equal(ImportExport.parseAppImportJSON(Storage.exportAppJSON()).preferences.export.screenshotResolution, '1920x1080',
    'App Backup import stores only a supported value');
  // A's capture-time guard remains defense in depth over the same product list.
  const app = await read('src/app.js');
  assert.match(app, /const SCREENSHOT_RESOLUTIONS = Object\.freeze\(\['1920x1080', '2560x1440', '3840x2160'\]\);/);
  const html = await read('index.html');
  for (const value of Defaults.SCREENSHOT_RESOLUTIONS) assert.ok(html.includes(`value="${value}"`), `Settings offers ${value}`);
});
