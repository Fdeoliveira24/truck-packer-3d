import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const importSchemaUrl = new URL('../../src/core/import-schema.js', import.meta.url);
const storageUrl = new URL('../../src/core/storage.js', import.meta.url);
const stateStoreUrl = new URL('../../src/core/state-store.js', import.meta.url);
const importExportUrl = new URL('../../src/services/import-export.js', import.meta.url);

function createMemoryStorage() {
  const values = new Map();
  const failedWrites = new Map();
  const mismatchedReads = new Map();
  const mismatchAfterWrite = new Set();
  const writes = [];
  return {
    values,
    writes,
    failWrites(key, count = Infinity) {
      failedWrites.set(key, count);
    },
    mismatchNextReadAfterWrite(key) {
      mismatchAfterWrite.add(key);
    },
    clearWriteLog() {
      writes.length = 0;
    },
    get length() {
      return values.size;
    },
    getItem(key) {
      const remaining = mismatchedReads.get(key) || 0;
      if (remaining > 0) {
        if (remaining === 1) mismatchedReads.delete(key);
        else mismatchedReads.set(key, remaining - 1);
        return '__workspace_readback_mismatch__';
      }
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      const remaining = failedWrites.get(key);
      if (remaining > 0) {
        if (Number.isFinite(remaining)) failedWrites.set(key, remaining - 1);
        throw new Error(`quota:${key}`);
      }
      values.set(key, String(value));
      writes.push({ key, value: String(value) });
      if (mismatchAfterWrite.delete(key)) mismatchedReads.set(key, 1);
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
  };
}

function destinationState(label = 'destination') {
  return {
    currentScreen: 'cases',
    currentPackId: `${label}-pack`,
    selectedInstanceIds: ['old-selection'],
    caseLibrary: [
      {
        id: `${label}-case`,
        name: 'Destination Case',
        itemCode: 'DEST-1',
        category: 'default',
        dimensions: { length: 12, width: 12, height: 12 },
        weight: 10,
      },
    ],
    packLibrary: [
      {
        id: `${label}-pack`,
        title: 'Destination Load Plan',
        loadPlanNumber: 'LP-DEST-1',
        customerReference: 'DEST-REF',
        folderId: null,
        truck: { length: 200, width: 90, height: 90, shapeMode: 'rect', shapeConfig: {} },
        cases: [],
      },
    ],
    folderLibrary: [],
    preferences: {
      theme: 'dark',
      caseCardDensity: 'compact',
      categories: [{ key: 'stale-only', name: 'Stale Only', color: '#111111' }],
    },
  };
}

function portableCase(overrides = {}) {
  return {
    id: 'case-source-1',
    name: 'Touring Audio Crate — 東京',
    itemCode: 'AUDIO-001',
    manufacturer: 'Acme',
    category: 'touring-audio',
    dimensions: { length: 20, width: 10, height: 10 },
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
    notes: 'Standard Instructions — keep dry.',
    color: '#123abc',
    createdAt: 1700000000000,
    updatedAt: 1700000000100,
    ...overrides,
  };
}

function portableInstance(overrides = {}) {
  return {
    id: 'instance-source-1',
    caseId: 'case-source-1',
    transform: {
      position: { x: 20, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    orientationLocked: false,
    placement: 'packed',
    instanceNotes: 'Item Notes — unload at stop 2.',
    ...overrides,
  };
}

function portableFolder(overrides = {}) {
  return {
    id: 'folder-source-1',
    name: 'Touring',
    scope: 'pack',
    parentFolderId: null,
    sortOrder: 100,
    createdAt: 1700000000000,
    updatedAt: 1700000000100,
    ...overrides,
  };
}

function portablePack(overrides = {}) {
  return {
    id: 'pack-source-1',
    title: 'Arena Load Plan',
    loadPlanNumber: 'LP-SOURCE-1',
    customerReference: 'PO-東京-44',
    client: 'Venue Client',
    projectName: 'World Tour',
    drawnBy: 'Planner',
    notes: 'Load Plan Notes — rear to front.',
    truck: { length: 200, width: 90, height: 90, shapeMode: 'rect', shapeConfig: {} },
    cases: [portableInstance()],
    folderId: 'folder-source-1',
    groups: [],
    createdAt: 1700000000000,
    lastEdited: 1700000000200,
    ...overrides,
  };
}

function sourceWorkspaceData(overrides = {}) {
  return {
    caseLibrary: [portableCase()],
    packLibrary: [portablePack()],
    folderLibrary: [portableFolder()],
    categories: [{ key: 'touring-audio', name: 'Touring Audio', color: '#123abc' }],
    ...overrides,
  };
}

function workspaceEnvelope(ImportSchema, data = sourceWorkspaceData(), overrides = {}) {
  const envelope = ImportSchema.buildEnvelope({
    kind: ImportSchema.IMPORT_KIND.WORKSPACE_BACKUP,
    data,
    appVersion: 'test',
    scope: {
      sourceWorkspaceId: 'source-workspace-id',
      sourceWorkspaceName: 'Source Workspace',
      role: 'owner',
    },
    createdAt: '2026-09-11T12:00:00.000Z',
  });
  return JSON.stringify({ ...envelope, ...overrides });
}

async function createRuntime(label) {
  const originalWindow = globalThis.window;
  const localStorage = createMemoryStorage();
  globalThis.window = { localStorage, setTimeout, clearTimeout };
  const ImportSchema = await import(importSchemaUrl.href);
  const StateStore = await import(stateStoreUrl.href);
  const Storage = await import(`${storageUrl.href}?workspace-d=${label}-${Date.now()}-${Math.random()}`);
  const ImportExport = await import(`${importExportUrl.href}?workspace-d=${label}-${Date.now()}-${Math.random()}`);
  const userScope = `${label}-user`;
  const workspaceScope = `${label}-workspace`;
  Storage.setStorageScope(userScope);
  Storage.setWorkspaceScope(workspaceScope);
  StateStore.init(destinationState(label));
  Storage.saveNow();
  const scopedKey = `truckPacker3d:v1:${userScope}`;
  const workspaceKey = `${scopedKey}:workspace:${workspaceScope}`;
  let pauseCount = 0;
  let resumeCount = 0;
  let paused = false;
  const pauseAutoSave = () => {
    const previous = paused;
    paused = true;
    pauseCount += 1;
    Storage.cancelPendingSave();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      paused = previous;
      resumeCount += 1;
    };
  };
  return {
    ImportSchema,
    StateStore,
    Storage,
    ImportExport,
    localStorage,
    userScope,
    workspaceScope,
    scopedKey,
    workspaceKey,
    recoveryKey: `${workspaceKey}:app-restore-recovery`,
    pauseAutoSave,
    get pauseCount() { return pauseCount; },
    get resumeCount() { return resumeCount; },
    get paused() { return paused; },
    cleanup() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

function preparePlan(runtime, data = sourceWorkspaceData()) {
  const imported = runtime.ImportExport.parseWorkspaceImportJSON(
    workspaceEnvelope(runtime.ImportSchema, data)
  );
  return runtime.ImportExport.planWorkspaceRestore(imported, {
    currentState: runtime.StateStore.snapshot(),
    destinationWorkspaceId: runtime.workspaceScope,
    destinationWorkspaceName: 'Destination Workspace',
  });
}

function restorePlan(runtime, plan, role = 'owner', Storage = runtime.Storage) {
  return runtime.ImportExport.restoreWorkspaceImport(plan, {
    StateStore: runtime.StateStore,
    Storage,
    originScope: runtime.Storage.captureScopeContext(),
    pauseAutoSave: runtime.pauseAutoSave,
    authorization: { role, destinationWorkspaceId: runtime.workspaceScope },
  });
}

test('MILESTONE-D-1 Workspace Backup export is a self-contained portable v1 graph', async () => {
  const runtime = await createRuntime('export-v1');
  try {
    const caseData = { ...portableCase(), volume: 2000 };
    const pack = {
      ...portablePack(),
      stats: { totalCases: 99 },
      thumbnail: 'data:image/png;base64,secret-size',
      thumbnailUpdatedAt: 123,
      thumbnailSource: 'auto',
      solutions: [{ transient: true }],
    };
    runtime.StateStore.init({
      currentScreen: 'editor',
      currentPackId: pack.id,
      selectedInstanceIds: [pack.cases[0].id],
      caseLibrary: [caseData],
      packLibrary: [pack],
      folderLibrary: [{ ...portableFolder(), transient: 'drop-me' }],
      preferences: {
        theme: 'dark',
        authToken: 'must-not-export',
        categories: [
          { key: 'touring-audio', name: 'Touring Audio', color: '#123abc', extra: 'drop' },
          { key: 'unused', name: 'Unused', color: '#abcdef' },
        ],
      },
      billing: { status: 'active' },
    });

    const parsed = JSON.parse(runtime.ImportExport.buildWorkspaceExportJSON(
      'Source Workspace',
      'source-workspace-id'
    ));
    assert.equal(parsed.format, 'cargo-planner');
    assert.equal(parsed.kind, 'workspace-backup');
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(parsed.units, { length: 'in', weight: 'lb' });
    assert.equal(parsed.scope.sourceWorkspaceName, 'Source Workspace');
    assert.equal(parsed.scope.sourceWorkspaceId, 'source-workspace-id');
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.scope, 'role'), false);
    assert.equal(parsed.data.caseLibrary.length, 1);
    assert.equal(parsed.data.packLibrary.length, 1);
    assert.equal(parsed.data.folderLibrary.length, 1);
    assert.deepEqual(parsed.data.categories, [
      { key: 'touring-audio', name: 'Touring Audio', color: '#123abc' },
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.data, 'preferences'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.data, 'currentPackId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.data.caseLibrary[0], 'volume'), false);
    for (const field of ['stats', 'thumbnail', 'thumbnailUpdatedAt', 'thumbnailSource', 'solutions']) {
      assert.equal(Object.prototype.hasOwnProperty.call(parsed.data.packLibrary[0], field), false, field);
    }
    assert.deepEqual(Object.keys(parsed.data.folderLibrary[0]).sort(), [
      'createdAt', 'id', 'name', 'parentFolderId', 'scope', 'sortOrder', 'updatedAt',
    ]);
    assert.doesNotMatch(JSON.stringify(parsed), /authToken|billing|selectedInstanceIds|must-not-export/);

    runtime.StateStore.init({
      ...destinationState('missing-category-metadata'),
      caseLibrary: [portableCase()],
      packLibrary: [portablePack()],
      folderLibrary: [portableFolder()],
      preferences: { theme: 'dark', categories: [] },
    });
    assert.throws(
      () => runtime.ImportExport.buildWorkspaceExportJSON('Source Workspace', 'source-workspace-id'),
      /category metadata is missing.*touring-audio/i,
      'a referenced custom category must never be exported without its portable display metadata'
    );
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-2 preflight is pure and preserves the complete portable business graph', async () => {
  const runtime = await createRuntime('preflight');
  try {
    const before = runtime.StateStore.snapshot();
    const data = sourceWorkspaceData({
      packLibrary: [portablePack({
        cases: [portableInstance({ packedProfile: 'max-capacity' })],
      })],
    });
    const plan = preparePlan(runtime, data);
    assert.deepEqual(runtime.StateStore.snapshot(), before, 'preflight must not mutate StateStore');
    assert.equal(plan.mode, 'replace');
    assert.equal(plan.sourceWorkspaceName, 'Source Workspace');
    assert.equal(plan.destinationWorkspaceName, 'Destination Workspace');
    assert.deepEqual(plan.counts, { cases: 1, packs: 1, folders: 1, categories: 1, instances: 1 });
    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.createdAt, '2026-09-11T12:00:00.000Z');
    assert.deepEqual(plan.integrityErrors, []);
    assert.equal(plan.placementsPreserved, 1);
    assert.equal(plan.placementsRepaired, 0);
    assert.equal(plan.placementsStaged, 0);
    assert.equal(plan.caseLibrary[0].itemCode, 'AUDIO-001');
    assert.equal(plan.caseLibrary[0].notes, 'Standard Instructions — keep dry.');
    assert.equal(plan.packLibrary[0].loadPlanNumber, 'LP-SOURCE-1');
    assert.equal(plan.packLibrary[0].customerReference, 'PO-東京-44');
    assert.equal(plan.packLibrary[0].notes, 'Load Plan Notes — rear to front.');
    assert.equal(plan.packLibrary[0].cases[0].instanceNotes, 'Item Notes — unload at stop 2.');
    assert.equal(plan.packLibrary[0].cases.length, 1);
    assert.equal(plan.packLibrary[0].cases[0].id, 'instance-source-1');
    assert.equal(plan.packLibrary[0].cases[0].placement, 'packed');
    assert.equal(plan.packLibrary[0].cases[0].packedProfile, 'max-capacity');
    assert.deepEqual(plan.packLibrary[0].cases[0].transform.position, { x: 20, y: 5, z: 0 });
    assert.equal(plan.packLibrary[0].folderId, 'folder-source-1');
    assert.deepEqual(plan.categorySlice, [
      { key: 'touring-audio', name: 'Touring Audio', color: '#123abc' },
    ]);
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-3 valid Replace restore uses scoped recovery and preserves unrelated preferences', async () => {
  const runtime = await createRuntime('replace-success');
  try {
    const plan = preparePlan(runtime);
    runtime.localStorage.clearWriteLog();
    const result = restorePlan(runtime, plan, 'owner');
    assert.ok(result.savedAt > 0);
    const state = runtime.StateStore.snapshot();
    assert.equal(state.currentScreen, 'packs');
    assert.equal(state.currentPackId, null);
    assert.deepEqual(state.selectedInstanceIds, []);
    assert.equal(state.caseLibrary[0].id, 'case-source-1');
    assert.equal(state.packLibrary[0].id, 'pack-source-1');
    assert.equal(state.folderLibrary[0].id, 'folder-source-1');
    assert.equal(state.preferences.theme, 'dark');
    assert.equal(state.preferences.caseCardDensity, 'compact');
    assert.deepEqual(state.preferences.categories, [
      { key: 'touring-audio', name: 'Touring Audio', color: '#123abc' },
    ]);
    assert.equal(state.preferences.categories.some(category => category.key === 'stale-only'), false);
    assert.equal(runtime.StateStore.undo(), false, 'Replace restore rebases Undo history');
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
    const userPayload = JSON.parse(runtime.localStorage.getItem(runtime.scopedKey));
    const workspacePayload = JSON.parse(runtime.localStorage.getItem(runtime.workspaceKey));
    assert.equal(userPayload.preferences.caseCardDensity, 'compact');
    assert.equal(workspacePayload.caseLibrary[0].id, 'case-source-1');
    assert.equal(workspacePayload.packLibrary[0].cases.length, 1);
    assert.equal(runtime.pauseCount, 1);
    assert.equal(runtime.resumeCount, 1);
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-4 placement preflight preserves valid poses and stages unsafe poses', async () => {
  const runtime = await createRuntime('placement-repair');
  try {
    const unsafe = portableInstance({
      transform: {
        position: { x: 1000, y: 5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      placement: 'packed',
    });
    const data = sourceWorkspaceData({
      packLibrary: [portablePack({ cases: [portableInstance(), { ...unsafe, id: 'instance-source-2' }] })],
    });
    const plan = preparePlan(runtime, data);
    assert.equal(plan.packLibrary[0].cases.length, 2);
    assert.deepEqual(plan.packLibrary[0].cases[0].transform.position, { x: 20, y: 5, z: 0 });
    assert.equal(plan.packLibrary[0].cases[0].placement, 'packed');
    assert.equal(plan.packLibrary[0].cases[1].placement, 'staged');
    assert.equal(plan.placementsPreserved, 1);
    assert.equal(plan.placementsStaged, 1);
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-5 authorization is owner/admin only and source metadata grants nothing', async () => {
  for (const role of ['owner', 'admin']) {
    const runtime = await createRuntime(`role-${role}`);
    try {
      const plan = preparePlan(runtime);
      const result = restorePlan(runtime, plan, role);
      assert.ok(result.savedAt > 0, `${role} should be allowed`);
    } finally {
      runtime.cleanup();
    }
  }

  const runtime = await createRuntime('role-member');
  try {
    const beforeState = runtime.StateStore.snapshot();
    const beforeWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
    const plan = preparePlan(runtime);
    assert.equal(plan.sourceWorkspaceId, 'source-workspace-id');
    assert.throws(
      () => restorePlan(runtime, plan, 'member'),
      error => error && error.code === 'WORKSPACE_RESTORE_FORBIDDEN'
    );
    assert.deepEqual(runtime.StateStore.snapshot(), beforeState);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), beforeWorkspace);
    assert.equal(runtime.pauseCount, 0);
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-6 workspace/user switch and A-to-B-to-A invalidate preview plans', async () => {
  const runtime = await createRuntime('scope-switch');
  try {
    const before = runtime.StateStore.snapshot();
    const plan = preparePlan(runtime);
    const originScope = runtime.Storage.captureScopeContext();
    runtime.Storage.setWorkspaceScope('workspace-b');
    runtime.Storage.setWorkspaceScope(runtime.workspaceScope);
    assert.throws(
      () => runtime.ImportExport.restoreWorkspaceImport(plan, {
        StateStore: runtime.StateStore,
        Storage: runtime.Storage,
        originScope,
        pauseAutoSave: runtime.pauseAutoSave,
        authorization: { role: 'owner', destinationWorkspaceId: runtime.workspaceScope },
      }),
      error => error && error.code === 'IMPORT_SCOPE_CHANGED'
    );
    assert.deepEqual(runtime.StateStore.snapshot(), before);

    const userPlan = preparePlan(runtime);
    const userOrigin = runtime.Storage.captureScopeContext();
    runtime.Storage.setStorageScope('different-user');
    assert.throws(
      () => runtime.ImportExport.restoreWorkspaceImport(userPlan, {
        StateStore: runtime.StateStore,
        Storage: runtime.Storage,
        originScope: userOrigin,
        pauseAutoSave: runtime.pauseAutoSave,
        authorization: { role: 'owner', destinationWorkspaceId: runtime.workspaceScope },
      }),
      error => error && error.code === 'IMPORT_SCOPE_CHANGED'
    );
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-7 structural, category, physical, identity, kind, and version corruption fail closed', async () => {
  const runtime = await createRuntime('corruption');
  try {
    const cases = [
      ['malformed collection', data => { data.caseLibrary = {}; }, /caseLibrary.*array/i],
      ['missing v1 folder collection', data => { delete data.folderLibrary; }, /folderLibrary.*array/i],
      ['duplicate Case id', data => { data.caseLibrary.push({ ...portableCase(), name: 'Second' }); }, /duplicate id/i],
      ['duplicate Pack id', data => { data.packLibrary.push({ ...portablePack(), title: 'Second', loadPlanNumber: 'LP-SECOND', cases: [] }); }, /duplicate id/i],
      ['duplicate folder id', data => { data.folderLibrary.push({ ...portableFolder(), name: 'Second' }); }, /duplicate id/i],
      ['duplicate instance id', data => { data.packLibrary[0].cases.push({ ...portableInstance() }); }, /duplicate id/i],
      ['missing Case reference', data => { data.packLibrary[0].cases[0].caseId = 'missing'; }, /caseId.*does not exist/i],
      ['dangling folder reference', data => { data.packLibrary[0].folderId = 'missing'; }, /folderId.*does not exist/i],
      ['invalid category reference', data => { data.categories = []; }, /category reference.*metadata is missing/i],
      ['malformed physical value', data => { data.caseLibrary[0].dimensions.length = -1; }, /dimension/i],
      ['non-canonical Infinity text', data => { data.caseLibrary[0].weight = 'Infinity'; }, /weight/i],
      ['malformed truck shape config', data => {
        data.packLibrary[0].truck.shapeMode = 'wheelWells';
        data.packLibrary[0].truck.shapeConfig = { wellHeight: 'Infinity' };
      }, /shapeConfig\.wellHeight/i],
      ['transient Pack field', data => { data.packLibrary[0].stats = { totalCases: 1 }; }, /transient values/i],
      ['non-portable preferences', data => { data.preferences = { theme: 'dark' }; }, /non-portable preference/i],
      ['duplicate Item Code', data => {
        data.caseLibrary.push({ ...portableCase(), id: 'case-source-2', name: 'Second Case' });
      }, /business identity validation failed.*itemCode/i],
      ['duplicate Load Plan Number', data => {
        data.packLibrary.push({ ...portablePack(), id: 'pack-source-2', title: 'Second Pack', cases: [] });
      }, /business identity validation failed.*loadPlanNumber/i],
    ];
    for (const [label, mutate, expected] of cases) {
      const data = structuredClone(sourceWorkspaceData());
      mutate(data);
      assert.throws(
        () => runtime.ImportExport.parseWorkspaceImportJSON(workspaceEnvelope(runtime.ImportSchema, data)),
        expected,
        label
      );
    }

    const nonFiniteJson = workspaceEnvelope(runtime.ImportSchema).replace('"weight":30', '"weight":NaN');
    assert.throws(
      () => runtime.ImportExport.parseWorkspaceImportJSON(nonFiniteJson),
      /Invalid JSON/i,
      'NaN is not valid JSON and must fail before workspace planning'
    );

    const future = JSON.parse(workspaceEnvelope(runtime.ImportSchema));
    future.schemaVersion = 2;
    assert.throws(
      () => runtime.ImportExport.parseWorkspaceImportJSON(JSON.stringify(future)),
      error => error && error.code === 'IMPORT_UNSUPPORTED_SCHEMA_VERSION'
    );
    const wrongKind = JSON.parse(workspaceEnvelope(runtime.ImportSchema));
    wrongKind.kind = 'active-workspace-backup';
    assert.throws(
      () => runtime.ImportExport.parseWorkspaceImportJSON(JSON.stringify(wrongKind)),
      error => error && error.code === 'IMPORT_WRONG_KIND'
    );
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-8 byte, depth, string, and entity limits reject before planning', async () => {
  const runtime = await createRuntime('limits');
  try {
    assert.throws(
      () => runtime.ImportExport.assertWorkspaceBackupFileSize(
        runtime.ImportExport.WORKSPACE_BACKUP_LIMITS.maxBytes + 1
      ),
      error => error && error.code === 'WORKSPACE_BACKUP_LIMIT_EXCEEDED'
    );

    const deep = JSON.parse(workspaceEnvelope(runtime.ImportSchema));
    let cursor = deep;
    for (let i = 0; i < runtime.ImportExport.WORKSPACE_BACKUP_LIMITS.maxDepth + 2; i += 1) {
      cursor.extra = {};
      cursor = cursor.extra;
    }
    assert.throws(
      () => runtime.ImportExport.parseWorkspaceImportJSON(JSON.stringify(deep)),
      /nesting is too deep/i
    );

    const longText = JSON.parse(workspaceEnvelope(runtime.ImportSchema));
    longText.data.caseLibrary[0].notes =
      'x'.repeat(runtime.ImportExport.WORKSPACE_BACKUP_LIMITS.maxStringChars + 1);
    assert.throws(
      () => runtime.ImportExport.parseWorkspaceImportJSON(JSON.stringify(longText)),
      /oversized text/i
    );

    const tooManyCases = sourceWorkspaceData({
      caseLibrary: Array.from(
        { length: runtime.ImportExport.WORKSPACE_BACKUP_LIMITS.maxCases + 1 },
        (_, index) => ({ id: `limit-case-${index}` })
      ),
      packLibrary: [],
      folderLibrary: [],
      categories: [],
    });
    assert.throws(
      () => runtime.ImportExport.parseWorkspaceImportJSON(
        workspaceEnvelope(runtime.ImportSchema, tooManyCases)
      ),
      /too many Cases/i
    );
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-9 storage write/read-back/finalization failures roll back with no false success', async () => {
  for (const mode of ['write', 'readback', 'finalize']) {
    const runtime = await createRuntime(`failure-${mode}`);
    try {
      const beforeState = runtime.StateStore.snapshot();
      const beforeUser = runtime.localStorage.getItem(runtime.scopedKey);
      const beforeWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
      const plan = preparePlan(runtime);
      let Storage = runtime.Storage;
      if (mode === 'write') runtime.localStorage.failWrites(runtime.workspaceKey, 1);
      if (mode === 'readback') runtime.localStorage.mismatchNextReadAfterWrite(runtime.workspaceKey);
      if (mode === 'finalize') {
        Storage = {
          ...runtime.Storage,
          finalizeAppRestore() {
            return { ok: false, error: new Error('forced finalization failure') };
          },
        };
      }
      assert.throws(
        () => restorePlan(runtime, plan, 'owner', Storage),
        mode === 'finalize' ? /forced finalization failure/i : /quota|read-back|verification/i,
        mode
      );
      assert.deepEqual(runtime.StateStore.snapshot(), beforeState, `${mode}: visible state`);
      assert.equal(runtime.localStorage.getItem(runtime.scopedKey), beforeUser, `${mode}: user bytes`);
      assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), beforeWorkspace, `${mode}: workspace bytes`);
      assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null, `${mode}: marker cleared after exact rollback`);
      assert.equal(runtime.resumeCount, 1, `${mode}: autosave resumed after safe rollback`);
    } finally {
      runtime.cleanup();
    }
  }
});

test('MILESTONE-D-10 ambiguous rollback preserves recovery marker and autosave ownership', async () => {
  const runtime = await createRuntime('rollback-ambiguous');
  try {
    const plan = preparePlan(runtime);
    const Storage = {
      ...runtime.Storage,
      finalizeAppRestore() {
        return { ok: false, error: new Error('forced finalization failure') };
      },
      rollbackAppRestore() {
        return {
          ok: false,
          rolledBack: false,
          recoverable: true,
          error: new Error('forced rollback ambiguity'),
        };
      },
    };
    assert.throws(
      () => restorePlan(runtime, plan, 'owner', Storage),
      error => error && error.code === 'APP_RESTORE_RECOVERY_REQUIRED' && error.recoverable === true
    );
    assert.notEqual(runtime.localStorage.getItem(runtime.recoveryKey), null);
    assert.equal(runtime.paused, true);
    assert.equal(runtime.resumeCount, 0);
    assert.equal(runtime.Storage.saveSoon(), false, 'normal autosave remains blocked by unresolved marker');
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-11 legacy Workspace Backup and App Restore compatibility remain intact', async () => {
  const runtime = await createRuntime('legacy');
  try {
    const legacyWorkspace = await fs.readFile(
      new URL('../fixtures/import-export/legacy-workspace-backup-folderless.json', import.meta.url),
      'utf8'
    );
    const importedWorkspace = runtime.ImportExport.parseWorkspaceImportJSON(legacyWorkspace);
    assert.equal(importedWorkspace.legacy, true);
    assert.deepEqual(importedWorkspace.folderLibrary, []);
    assert.match(importedWorkspace.warnings.join(' '), /Legacy Workspace Backup/i);
    const plan = runtime.ImportExport.planWorkspaceRestore(importedWorkspace, {
      currentState: runtime.StateStore.snapshot(),
      destinationWorkspaceId: runtime.workspaceScope,
      destinationWorkspaceName: 'Destination Workspace',
    });
    assert.equal(plan.caseLibrary[0].id, 'case-ws-legacy-1');
    assert.equal(plan.packLibrary[0].loadPlanNumber, 'LP-WSLEGACY1');

    const legacyWorkspaceWithFolder = JSON.stringify({
      exportType: 'workspace',
      workspaceName: 'Legacy Foldered Workspace',
      appVersion: 'legacy-test',
      exportedAt: 1700000000000,
      data: sourceWorkspaceData(),
    });
    const importedFolderedWorkspace = runtime.ImportExport.parseWorkspaceImportJSON(
      legacyWorkspaceWithFolder
    );
    assert.equal(importedFolderedWorkspace.legacy, true);
    assert.equal(importedFolderedWorkspace.folderLibrary.length, 1);
    assert.equal(importedFolderedWorkspace.folderLibrary[0].id, 'folder-source-1');
    const folderedPlan = runtime.ImportExport.planWorkspaceRestore(importedFolderedWorkspace, {
      currentState: runtime.StateStore.snapshot(),
      destinationWorkspaceId: runtime.workspaceScope,
      destinationWorkspaceName: 'Destination Workspace',
    });
    assert.equal(folderedPlan.packLibrary[0].folderId, 'folder-source-1');

    const legacyApp = await fs.readFile(
      new URL('../fixtures/import-export/legacy-app-backup.json', import.meta.url),
      'utf8'
    );
    const appImported = runtime.ImportExport.parseAppImportJSON(legacyApp);
    assert.equal(appImported.caseLibrary[0].itemCode, 'APP-LEGACY-1');
    assert.equal(appImported.packLibrary[0].loadPlanNumber, 'LP-APPLEGACY1');

    const activeV1 = await fs.readFile(
      new URL('../fixtures/import-export/envelope-active-workspace-backup-v1.json', import.meta.url),
      'utf8'
    );
    const activeImported = runtime.ImportExport.parseAppImportJSON(activeV1);
    assert.equal(activeImported.packLibrary[0].loadPlanNumber, 'LP-ENVELOPE1');
  } finally {
    runtime.cleanup();
  }
});

test('MILESTONE-D-12 Settings exposes a role-gated Choose → Preflight → Replace flow and honest backup copy', async () => {
  const [settings, app, appDialog] = await Promise.all([
    fs.readFile(new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/ui/overlays/import-app-dialog.js', import.meta.url), 'utf8'),
  ]);
  assert.match(settings, /Restore Workspace Backup/);
  assert.match(settings, /Restore preflight/);
  assert.match(settings, /Replace Active Workspace/);
  assert.match(settings, /restoreWsBtn\.disabled = !isOwnerOrAdmin/);
  assert.match(settings, /getRoleForOrg\(plan\.destinationWorkspaceId\)/);
  assert.match(settings, /assertScopeContextCurrent\(originScope\)/);
  assert.match(app, /-backup-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.json/);
  assert.match(app, /Workspace Backup download started/);
  assert.match(settings, /Other account workspaces/);
  assert.match(appDialog, /Other account workspaces/);
});

function performanceState(caseCount, packCount) {
  const categories = Array.from({ length: caseCount }, (_, index) => ({
    key: `perf-category-${index}`,
    name: `Performance Category ${index}`,
    color: `#${(index % 0xffffff).toString(16).padStart(6, '0')}`,
  }));
  const cases = Array.from({ length: caseCount }, (_, index) => portableCase({
    id: `perf-case-${index}`,
    name: `Performance Case ${index}`,
    itemCode: `PERF-${index}`,
    category: categories[index].key,
    color: categories[index].color,
  }));
  const folders = Array.from({ length: packCount }, (_, index) => portableFolder({
    id: `perf-folder-${index}`,
    name: `Performance Folder ${index}`,
    sortOrder: index * 100,
  }));
  const packs = Array.from({ length: packCount }, (_, packIndex) => {
    const start = Math.floor((packIndex * caseCount) / packCount);
    const end = Math.floor(((packIndex + 1) * caseCount) / packCount);
    const instances = cases.slice(start, end).map((caseData, instanceIndex) => portableInstance({
      id: `perf-instance-${packIndex}-${instanceIndex}`,
      caseId: caseData.id,
      placement: 'staged',
      transform: {
        position: { x: -100 - (instanceIndex * 25), y: 5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }));
    return portablePack({
      id: `perf-pack-${packIndex}`,
      title: `Performance Load Plan ${packIndex}`,
      loadPlanNumber: `LP-PERF-${packIndex}`,
      customerReference: `PERF-REF-${packIndex}`,
      folderId: folders[packIndex].id,
      cases: instances,
    });
  });
  return {
    currentScreen: 'packs',
    currentPackId: null,
    selectedInstanceIds: [],
    caseLibrary: cases,
    packLibrary: packs,
    folderLibrary: folders,
    preferences: { theme: 'light', categories },
  };
}

test('MILESTONE-D-13 performance fixtures cover 100/1,000 Cases, 100 Load Plans, instances, folders, and categories', async t => {
  const runtime = await createRuntime('performance');
  try {
    for (const [caseCount, packCount] of [[100, 10], [1000, 100]]) {
      runtime.StateStore.init(performanceState(caseCount, packCount));
      const serializeStart = performance.now();
      const json = runtime.ImportExport.buildWorkspaceExportJSON('Performance Workspace', runtime.workspaceScope);
      const serializeMs = performance.now() - serializeStart;
      const parseStart = performance.now();
      const imported = runtime.ImportExport.parseWorkspaceImportJSON(json);
      const parseMs = performance.now() - parseStart;
      const planStart = performance.now();
      const plan = runtime.ImportExport.planWorkspaceRestore(imported, {
        currentState: destinationState('performance-destination'),
        destinationWorkspaceId: runtime.workspaceScope,
        destinationWorkspaceName: 'Performance Destination',
      });
      const planMs = performance.now() - planStart;
      assert.equal(plan.counts.cases, caseCount);
      assert.equal(plan.counts.packs, packCount);
      assert.equal(plan.counts.folders, packCount);
      assert.equal(plan.counts.categories, caseCount);
      assert.equal(plan.counts.instances, caseCount);
      assert.ok(serializeMs < 10000, `serialize ${caseCount}: ${serializeMs}ms`);
      assert.ok(parseMs < 10000, `parse ${caseCount}: ${parseMs}ms`);
      assert.ok(planMs < 10000, `plan ${caseCount}: ${planMs}ms`);
      t.diagnostic(
        `${caseCount} Cases / ${packCount} Load Plans / ${caseCount} instances: ` +
        `serialize=${serializeMs.toFixed(1)}ms parse=${parseMs.toFixed(1)}ms plan=${planMs.toFixed(1)}ms ` +
        `bytes=${Buffer.byteLength(json, 'utf8')}`
      );
    }
  } finally {
    runtime.cleanup();
  }
});
