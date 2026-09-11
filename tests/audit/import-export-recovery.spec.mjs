import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const storageUrl = new URL('../../src/core/storage.js', import.meta.url);
const stateStoreUrl = new URL('../../src/core/state-store.js', import.meta.url);
const importExportUrl = new URL('../../src/services/import-export.js', import.meta.url);
const importAppDialogUrl = new URL('../../src/ui/overlays/import-app-dialog.js', import.meta.url);
const settingsOverlayUrl = new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url);
const importCasesDialogUrl = new URL('../../src/ui/overlays/import-cases-dialog.js', import.meta.url);
const importPackDialogUrl = new URL('../../src/ui/overlays/import-pack-dialog.js', import.meta.url);
const appUrl = new URL('../../src/app.js', import.meta.url);

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
    clearFailures() {
      failedWrites.clear();
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
        return '__readback_mismatch__';
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

function createTimerHarness() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimeout(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      callbacks.delete(id);
    },
    runAll() {
      while (callbacks.size > 0) {
        const pending = Array.from(callbacks.values());
        callbacks.clear();
        pending.forEach(callback => callback());
      }
    },
    get pendingCount() {
      return callbacks.size;
    },
  };
}

function oldState(label = 'old') {
  return {
    currentScreen: 'packs',
    currentPackId: `${label}-pack`,
    selectedInstanceIds: [],
    caseLibrary: [
      {
        id: `${label}-case`,
        name: `${label} Case`,
        dimensions: { length: 10, width: 10, height: 10 },
        weight: 10,
      },
    ],
    packLibrary: [
      {
        id: `${label}-pack`,
        title: `${label} Pack`,
        loadPlanNumber: `LP-${label.toUpperCase()}`,
        folderId: null,
        truck: { length: 120, width: 60, height: 60 },
        cases: [],
      },
    ],
    folderLibrary: [],
    preferences: { theme: 'light' },
  };
}

function appBackup(overrides = {}) {
  const data = {
    caseLibrary: [
      {
        id: 'new-case',
        name: 'New Case',
        dimensions: { length: 20, width: 10, height: 10 },
        weight: 15,
      },
    ],
    packLibrary: [
      {
        id: 'new-pack',
        title: 'New Pack',
        loadPlanNumber: 'LP-NEW',
        folderId: 'new-folder',
        truck: { length: 200, width: 90, height: 90 },
        cases: [
          {
            id: 'new-instance',
            caseId: 'new-case',
            transform: {
              position: { x: 10, y: 5, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
          },
        ],
      },
    ],
    folderLibrary: [
      {
        id: 'new-folder',
        name: 'New Folder',
        scope: 'pack',
        parentFolderId: null,
      },
    ],
    preferences: { theme: 'dark' },
    ...overrides,
  };
  return JSON.stringify({ app: 'Truck Packer 3D', version: 'test', data });
}

async function createRuntime(label) {
  const originalWindow = globalThis.window;
  const localStorage = createMemoryStorage();
  const timers = createTimerHarness();
  globalThis.window = {
    localStorage,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  const StateStore = await import(stateStoreUrl.href);
  const Storage = await import(`${storageUrl.href}?recovery=${label}-${Date.now()}-${Math.random()}`);
  const ImportExport = await import(`${importExportUrl.href}?recovery=${label}-${Date.now()}-${Math.random()}`);
  Storage.setStorageScope(`${label}-user`);
  Storage.setWorkspaceScope(`${label}-workspace`);
  StateStore.init(oldState(label));
  Storage.saveNow();
  const scopedKey = `truckPacker3d:v1:${label}-user`;
  const workspaceKey = `${scopedKey}:workspace:${label}-workspace`;
  let autoSaveSuspended = false;
  let autoSavePauseCount = 0;
  let autoSaveResumeCount = 0;
  const unsubscribers = [];
  const pauseAutoSave = () => {
    const previous = autoSaveSuspended;
    autoSaveSuspended = true;
    autoSavePauseCount += 1;
    Storage.cancelPendingSave();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      autoSaveSuspended = previous;
      autoSaveResumeCount += 1;
    };
  };
  return {
    originalWindow,
    localStorage,
    StateStore,
    Storage,
    ImportExport,
    timers,
    scopedKey,
    workspaceKey,
    recoveryKey: `${workspaceKey}:app-restore-recovery`,
    pauseAutoSave,
    enableAutoSave() {
      const unsubscribe = StateStore.subscribe(changes => {
        if (
          !autoSaveSuspended &&
          (
            changes.preferences ||
            changes.caseLibrary ||
            changes.packLibrary ||
            changes.folderLibrary ||
            changes.currentPackId ||
            changes._undo ||
            changes._redo ||
            changes._replace
          )
        ) {
          Storage.saveSoon();
        }
      });
      unsubscribers.push(unsubscribe);
    },
    get autoSaveSuspended() {
      return autoSaveSuspended;
    },
    get autoSavePauseCount() {
      return autoSavePauseCount;
    },
    get autoSaveResumeCount() {
      return autoSaveResumeCount;
    },
    cleanup() {
      Storage.cancelPendingSave();
      unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

for (const [name, override, message] of [
  ['caseLibrary object', { caseLibrary: {} }, /caseLibrary.*array/i],
  ['packLibrary object', { packLibrary: {} }, /packLibrary.*array/i],
  ['folderLibrary object', { folderLibrary: {} }, /folderLibrary.*array/i],
]) {
  test(`RECOVERY-PASS-A malformed ${name} fails before state mutation`, async () => {
    const runtime = await createRuntime(`malformed-${name.split(' ')[0]}`);
    try {
      const before = runtime.StateStore.snapshot();
      assert.throws(() => runtime.Storage.importAppJSON(appBackup(override)), message);
      assert.deepEqual(runtime.StateStore.snapshot(), before);
    } finally {
      runtime.cleanup();
    }
  });
}

for (const [name, preferences] of [
  ['null', null],
  ['string', 'dark'],
  ['number', 7],
  ['array', [{ theme: 'dark' }]],
]) {
  test(`RECOVERY-STABILIZATION malformed preferences ${name} fails before state mutation`, async () => {
    const runtime = await createRuntime(`malformed-preferences-${name}`);
    try {
      const before = runtime.StateStore.snapshot();
      assert.throws(
        () => runtime.Storage.importAppJSON(appBackup({ preferences })),
        /preferences.*object/i
      );
      assert.deepEqual(runtime.StateStore.snapshot(), before);
    } finally {
      runtime.cleanup();
    }
  });
}

test('RECOVERY-PASS-A missing optional legacy folderLibrary is accepted when no folder is referenced', async () => {
  const runtime = await createRuntime('legacy-folders');
  try {
    const raw = JSON.parse(appBackup());
    delete raw.data.folderLibrary;
    raw.data.packLibrary[0].folderId = null;
    const imported = runtime.Storage.importAppJSON(JSON.stringify(raw));
    assert.deepEqual(imported.folderLibrary, []);
    assert.equal(imported.packLibrary[0].folderId, null);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A valid Cases, Packs, and Folders restore as one graph', async () => {
  const runtime = await createRuntime('valid-graph');
  try {
    const imported = runtime.Storage.importAppJSON(appBackup());
    assert.equal(imported.folderLibrary[0].id, 'new-folder');
    assert.equal(imported.packLibrary[0].folderId, 'new-folder');
    assert.equal(imported.packLibrary[0].cases[0].caseId, 'new-case');

    const originScope = runtime.Storage.captureScopeContext();
    const result = runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope,
      pauseAutoSave: runtime.pauseAutoSave,
    });
    assert.equal(result.nextState.folderLibrary[0].id, 'new-folder');
    assert.equal(runtime.StateStore.get('packLibrary')[0].folderId, 'new-folder');
    assert.equal(JSON.parse(runtime.localStorage.getItem(runtime.workspaceKey)).folderLibrary[0].id, 'new-folder');
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A dangling folder reference blocks destructive restore', async () => {
  const runtime = await createRuntime('dangling-folder');
  try {
    const before = runtime.StateStore.snapshot();
    assert.throws(
      () => runtime.Storage.importAppJSON(appBackup({ folderLibrary: [] })),
      /folderId.*does not exist/i
    );
    assert.deepEqual(runtime.StateStore.snapshot(), before);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A duplicate and blank graph identities fail before normalization', async () => {
  const runtime = await createRuntime('identity-graph');
  try {
    const duplicate = JSON.parse(appBackup());
    duplicate.data.caseLibrary.push({ ...duplicate.data.caseLibrary[0] });
    assert.throws(() => runtime.Storage.importAppJSON(JSON.stringify(duplicate)), /duplicate id/i);

    const blank = JSON.parse(appBackup());
    blank.data.packLibrary[0].cases[0].caseId = '   ';
    assert.throws(() => runtime.Storage.importAppJSON(JSON.stringify(blank)), /blank or missing reference/i);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A persistence failure cannot produce a successful restore', async () => {
  const runtime = await createRuntime('persistence-fail');
  try {
    const imported = runtime.Storage.importAppJSON(appBackup());
    const originScope = runtime.Storage.captureScopeContext();
    const beforeState = runtime.StateStore.snapshot();
    const beforeUser = runtime.localStorage.getItem(runtime.scopedKey);
    const beforeWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
    runtime.localStorage.failWrites(runtime.recoveryKey, 1);

    assert.throws(
      () => runtime.ImportExport.restoreAppImport(imported, {
        StateStore: runtime.StateStore,
        Storage: runtime.Storage,
        originScope,
        pauseAutoSave: runtime.pauseAutoSave,
      }),
      /quota/
    );
    assert.deepEqual(runtime.StateStore.snapshot(), beforeState);
    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), beforeUser);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), beforeWorkspace);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A first scoped data-write failure rolls back and clears staging', async () => {
  const runtime = await createRuntime('first-write-fail');
  try {
    const imported = runtime.Storage.importAppJSON(appBackup());
    const beforeUser = runtime.localStorage.getItem(runtime.scopedKey);
    const beforeWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
    runtime.localStorage.failWrites(runtime.scopedKey, 1);

    assert.throws(() => runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope: runtime.Storage.captureScopeContext(),
      pauseAutoSave: runtime.pauseAutoSave,
    }), /quota/);
    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), beforeUser);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), beforeWorkspace);
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A later write failure leaves a durable prior snapshot that load can recover', async () => {
  const runtime = await createRuntime('later-fail');
  try {
    const imported = runtime.Storage.importAppJSON(appBackup());
    const originScope = runtime.Storage.captureScopeContext();
    const beforeUser = runtime.localStorage.getItem(runtime.scopedKey);
    const beforeWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
    runtime.localStorage.failWrites(runtime.workspaceKey);

    assert.throws(() => runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope,
      pauseAutoSave: runtime.pauseAutoSave,
    }), /quota/);
    assert.ok(runtime.localStorage.getItem(runtime.recoveryKey), 'recovery snapshot remains durable');

    runtime.localStorage.clearFailures();
    runtime.Storage.load();
    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), beforeUser);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), beforeWorkspace);
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-STABILIZATION restart forward-finalizes fully durable candidate payloads', async () => {
  const runtime = await createRuntime('durable-restart');
  try {
    const imported = runtime.Storage.importAppJSON(appBackup());
    const candidateState = {
      ...runtime.StateStore.snapshot(),
      caseLibrary: imported.caseLibrary,
      packLibrary: imported.packLibrary,
      folderLibrary: imported.folderLibrary,
      preferences: imported.preferences,
      currentPackId: null,
    };
    const receipt = runtime.Storage.beginAppRestore(candidateState, {
      expectedScope: runtime.Storage.captureScopeContext(),
    });
    assert.equal(receipt.ok, true);
    assert.ok(runtime.localStorage.getItem(runtime.recoveryKey));

    const RestartStorage = await import(
      `${storageUrl.href}?recovery-restart=${Date.now()}-${Math.random()}`
    );
    RestartStorage.setStorageScope('durable-restart-user');
    RestartStorage.setWorkspaceScope('durable-restart-workspace');
    const loaded = RestartStorage.load();

    assert.equal(loaded.packLibrary[0].id, 'new-pack');
    assert.equal(loaded.preferences.theme, 'dark');
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-STABILIZATION volatile savedAt changes preserve candidate fingerprint identity', async () => {
  const runtime = await createRuntime('stable-fingerprint');
  try {
    const imported = runtime.Storage.importAppJSON(appBackup());
    const candidateState = {
      ...runtime.StateStore.snapshot(),
      caseLibrary: imported.caseLibrary,
      packLibrary: imported.packLibrary,
      folderLibrary: imported.folderLibrary,
      preferences: imported.preferences,
      currentPackId: null,
    };
    const receipt = runtime.Storage.beginAppRestore(candidateState, {
      expectedScope: runtime.Storage.captureScopeContext(),
    });
    assert.equal(receipt.ok, true);

    const userPayload = JSON.parse(receipt.userRaw);
    const workspacePayload = JSON.parse(receipt.workspaceRaw);
    userPayload.savedAt += 1000;
    workspacePayload.savedAt += 1000;
    runtime.localStorage.setItem(receipt.scopedKey, JSON.stringify(userPayload));
    runtime.localStorage.setItem(receipt.workspaceKey, JSON.stringify(workspacePayload));

    const RestartStorage = await import(
      `${storageUrl.href}?stable-fingerprint=${Date.now()}-${Math.random()}`
    );
    RestartStorage.setStorageScope('stable-fingerprint-user');
    RestartStorage.setWorkspaceScope('stable-fingerprint-workspace');
    const loaded = RestartStorage.load();

    assert.equal(loaded.packLibrary[0].id, 'new-pack');
    assert.equal(loaded.preferences.theme, 'dark');
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A read-back mismatch fails and rolls storage back', async () => {
  const runtime = await createRuntime('readback-mismatch');
  try {
    const imported = runtime.Storage.importAppJSON(appBackup());
    const originScope = runtime.Storage.captureScopeContext();
    const beforeUser = runtime.localStorage.getItem(runtime.scopedKey);
    const beforeWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
    runtime.localStorage.mismatchNextReadAfterWrite(runtime.workspaceKey);

    assert.throws(() => runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope,
      pauseAutoSave: runtime.pauseAutoSave,
    }), /read-back verification/i);
    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), beforeUser);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), beforeWorkspace);
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A success is reported only after durable scoped read-back and finalization', async () => {
  const runtime = await createRuntime('durable-success');
  try {
    runtime.enableAutoSave();
    const imported = runtime.Storage.importAppJSON(appBackup());
    const result = runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope: runtime.Storage.captureScopeContext(),
      pauseAutoSave: runtime.pauseAutoSave,
    });
    const userPayload = JSON.parse(runtime.localStorage.getItem(runtime.scopedKey));
    const workspacePayload = JSON.parse(runtime.localStorage.getItem(runtime.workspaceKey));
    assert.equal(result.savedAt, userPayload.savedAt);
    assert.equal(result.savedAt, workspacePayload.savedAt);
    assert.equal(workspacePayload.packLibrary[0].id, 'new-pack');
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
    assert.equal(runtime.autoSavePauseCount, 1);
    assert.equal(runtime.autoSaveResumeCount, 1);
    assert.equal(runtime.autoSaveSuspended, false);

    runtime.localStorage.clearWriteLog();
    runtime.StateStore.set({ preferences: { theme: 'after-success' } });
    assert.equal(runtime.timers.pendingCount, 1);
    runtime.timers.runAll();
    assert.equal(JSON.parse(runtime.localStorage.getItem(runtime.scopedKey)).preferences.theme, 'after-success');
    assert.ok(runtime.localStorage.writes.length > 0);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-STABILIZATION real finalization verification failure rolls back and resumes autosave', async () => {
  const runtime = await createRuntime('finalize-fail');
  try {
    runtime.enableAutoSave();
    const imported = runtime.Storage.importAppJSON(appBackup());
    const beforeState = runtime.StateStore.snapshot();
    const beforeUser = runtime.localStorage.getItem(runtime.scopedKey);
    const beforeWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
    const storageWithFailedFinalize = {
      ...runtime.Storage,
      beginAppRestore(...args) {
        const receipt = runtime.Storage.beginAppRestore(...args);
        assert.equal(receipt.ok, true);
        runtime.localStorage.setItem(
          receipt.workspaceKey,
          receipt.recoveryRecord.priorWorkspaceRaw
        );
        return receipt;
      },
    };

    assert.throws(() => runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: storageWithFailedFinalize,
      originScope: runtime.Storage.captureScopeContext(),
      pauseAutoSave: runtime.pauseAutoSave,
    }), /durable state changed before finalization/i);
    assert.deepEqual(runtime.StateStore.snapshot(), beforeState);
    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), beforeUser);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), beforeWorkspace);
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), null);
    assert.equal(runtime.autoSaveSuspended, false);
    assert.equal(runtime.autoSaveResumeCount, 1);

    runtime.localStorage.clearWriteLog();
    runtime.StateStore.set({ preferences: { theme: 'after-rollback' } });
    assert.equal(runtime.timers.pendingCount, 1);
    runtime.timers.runAll();
    assert.equal(JSON.parse(runtime.localStorage.getItem(runtime.scopedKey)).preferences.theme, 'after-rollback');
    assert.ok(runtime.localStorage.writes.length > 0);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-STABILIZATION unresolved rollback owns autosave and load fails with structured recovery error', async () => {
  const runtime = await createRuntime('unresolved-autosave');
  try {
    runtime.enableAutoSave();
    runtime.StateStore.set({ preferences: { theme: 'queued-before-restore' } });
    assert.equal(runtime.timers.pendingCount, 1, 'pre-restore autosave is pending');

    const imported = runtime.Storage.importAppJSON(appBackup());
    const storageWithForeignWrite = {
      ...runtime.Storage,
      beginAppRestore(...args) {
        const receipt = runtime.Storage.beginAppRestore(...args);
        assert.equal(receipt.ok, true);
        const foreignWorkspace = JSON.parse(receipt.workspaceRaw);
        foreignWorkspace.caseLibrary[0].name = 'Concurrent foreign edit';
        runtime.localStorage.setItem(receipt.workspaceKey, JSON.stringify(foreignWorkspace));
        return receipt;
      },
    };

    assert.throws(
      () => runtime.ImportExport.restoreAppImport(imported, {
        StateStore: runtime.StateStore,
        Storage: storageWithForeignWrite,
        originScope: runtime.Storage.captureScopeContext(),
        pauseAutoSave: runtime.pauseAutoSave,
      }),
      error => error && error.code === 'APP_RESTORE_RECOVERY_REQUIRED'
    );
    assert.equal(runtime.autoSavePauseCount, 1);
    assert.equal(runtime.autoSaveResumeCount, 0);
    assert.equal(runtime.autoSaveSuspended, true);
    assert.equal(runtime.timers.pendingCount, 0, 'pre-restore debounce was cancelled');
    assert.ok(runtime.localStorage.getItem(runtime.recoveryKey));

    const frozenUser = runtime.localStorage.getItem(runtime.scopedKey);
    const frozenWorkspace = runtime.localStorage.getItem(runtime.workspaceKey);
    const frozenRecovery = runtime.localStorage.getItem(runtime.recoveryKey);
    runtime.localStorage.clearWriteLog();

    runtime.StateStore.set({ preferences: { theme: 'must-not-save' } });
    assert.equal(runtime.Storage.saveSoon(), false);
    runtime.Storage.saveNow();
    runtime.timers.runAll();

    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), frozenUser);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), frozenWorkspace);
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), frozenRecovery);
    assert.deepEqual(runtime.localStorage.writes, []);

    assert.throws(
      () => runtime.Storage.load(),
      error =>
        error &&
        error.code === 'APP_RESTORE_RECOVERY_REQUIRED' &&
        /recovery/i.test(error.message)
    );
    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), frozenUser);
    assert.equal(runtime.localStorage.getItem(runtime.workspaceKey), frozenWorkspace);
    assert.equal(runtime.localStorage.getItem(runtime.recoveryKey), frozenRecovery);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A user change after parse aborts before mutation', async () => {
  const runtime = await createRuntime('user-change');
  try {
    const originScope = runtime.Storage.captureScopeContext();
    const imported = runtime.Storage.importAppJSON(appBackup());
    const before = runtime.StateStore.snapshot();
    runtime.Storage.setStorageScope('different-user');

    assert.throws(() => runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope,
      pauseAutoSave: runtime.pauseAutoSave,
    }), /signed-in user or active workspace changed/i);
    assert.deepEqual(runtime.StateStore.snapshot(), before);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A workspace change after parse aborts before mutation', async () => {
  const runtime = await createRuntime('workspace-change');
  try {
    const originScope = runtime.Storage.captureScopeContext();
    const imported = runtime.Storage.importAppJSON(appBackup());
    const before = runtime.StateStore.snapshot();
    runtime.Storage.setWorkspaceScope('different-workspace');

    assert.throws(() => runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope,
      pauseAutoSave: runtime.pauseAutoSave,
    }), /signed-in user or active workspace changed/i);
    assert.deepEqual(runtime.StateStore.snapshot(), before);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-STABILIZATION A to B to A scope round trip still invalidates the captured generation', async () => {
  const runtime = await createRuntime('scope-round-trip');
  try {
    const originScope = runtime.Storage.captureScopeContext();
    runtime.Storage.setWorkspaceScope('workspace-b');
    runtime.Storage.setWorkspaceScope('scope-round-trip-workspace');

    assert.equal(runtime.Storage.getWorkspaceScope(), originScope.workspaceScope);
    assert.equal(runtime.Storage.isScopeContextCurrent(originScope), false);
    assert.throws(
      () => runtime.Storage.assertScopeContextCurrent(originScope),
      error => error && error.code === 'IMPORT_SCOPE_CHANGED'
    );
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A stale import leaves the newly active workspace byte-equivalent', async () => {
  const runtime = await createRuntime('stale-destination');
  try {
    const originScope = runtime.Storage.captureScopeContext();
    const imported = runtime.Storage.importAppJSON(appBackup());
    runtime.Storage.setWorkspaceScope('workspace-b');
    const destinationState = oldState('workspace-b');
    runtime.StateStore.init(destinationState);
    runtime.Storage.saveNow();
    const destinationKey = `${runtime.scopedKey}:workspace:workspace-b`;
    const beforeUser = runtime.localStorage.getItem(runtime.scopedKey);
    const beforeWorkspace = runtime.localStorage.getItem(destinationKey);
    const beforeState = runtime.StateStore.snapshot();

    assert.throws(() => runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope,
      pauseAutoSave: runtime.pauseAutoSave,
    }), /signed-in user or active workspace changed/i);
    assert.equal(runtime.localStorage.getItem(runtime.scopedKey), beforeUser);
    assert.equal(runtime.localStorage.getItem(destinationKey), beforeWorkspace);
    assert.deepEqual(runtime.StateStore.snapshot(), beforeState);
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A App Restore rebases history and is not a normal Undo rollback', async () => {
  const runtime = await createRuntime('undo-boundary');
  try {
    runtime.StateStore.set({ caseLibrary: [...runtime.StateStore.get('caseLibrary')] });
    const imported = runtime.Storage.importAppJSON(appBackup());
    runtime.ImportExport.restoreAppImport(imported, {
      StateStore: runtime.StateStore,
      Storage: runtime.Storage,
      originScope: runtime.Storage.captureScopeContext(),
      pauseAutoSave: runtime.pauseAutoSave,
    });
    assert.equal(runtime.StateStore.undo(), false);
    assert.equal(runtime.StateStore.get('caseLibrary')[0].id, 'new-case');
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-STABILIZATION failed restore preserves the pre-attempt Undo history', async () => {
  const runtime = await createRuntime('undo-rollback');
  try {
    runtime.StateStore.set({
      caseLibrary: [
        ...runtime.StateStore.get('caseLibrary'),
        {
          id: 'pre-restore-edit',
          name: 'Pre-restore edit',
          dimensions: { length: 8, width: 8, height: 8 },
          weight: 4,
        },
      ],
    });
    const editedState = runtime.StateStore.snapshot();
    const imported = runtime.Storage.importAppJSON(appBackup());
    const storageWithFailedFinalize = {
      ...runtime.Storage,
      beginAppRestore(...args) {
        const receipt = runtime.Storage.beginAppRestore(...args);
        assert.equal(receipt.ok, true);
        runtime.localStorage.setItem(
          receipt.workspaceKey,
          receipt.recoveryRecord.priorWorkspaceRaw
        );
        return receipt;
      },
    };

    assert.throws(
      () => runtime.ImportExport.restoreAppImport(imported, {
        StateStore: runtime.StateStore,
        Storage: storageWithFailedFinalize,
        originScope: runtime.Storage.captureScopeContext(),
        pauseAutoSave: runtime.pauseAutoSave,
      }),
      /durable state changed before finalization/i
    );
    assert.deepEqual(runtime.StateStore.snapshot(), editedState);
    assert.equal(runtime.StateStore.undo(), true);
    assert.equal(
      runtime.StateStore.get('caseLibrary').some(item => item.id === 'pre-restore-edit'),
      false
    );
  } finally {
    runtime.cleanup();
  }
});

test('RECOVERY-PASS-A both App entry paths share one restore transaction and all import dialogs bind scope', async () => {
  const [appDialog, settingsOverlay, casesDialog, packDialog, app] = await Promise.all([
    fs.readFile(importAppDialogUrl, 'utf8'),
    fs.readFile(settingsOverlayUrl, 'utf8'),
    fs.readFile(importCasesDialogUrl, 'utf8'),
    fs.readFile(importPackDialogUrl, 'utf8'),
    fs.readFile(appUrl, 'utf8'),
  ]);
  assert.match(appDialog, /ImportExport\.restoreAppImport\(imported, \{/);
  assert.match(settingsOverlay, /ImportExport\.restoreAppImport\(imported, \{/);
  assert.doesNotMatch(appDialog, /StateStore\.replace\(nextState|Storage\.saveNow\(\)/);
  assert.match(appDialog, /pauseAutoSave:\s*pauseAutoSaveForAppRestore/);
  assert.match(settingsOverlay, /pauseAutoSave:\s*pauseAutoSaveForAppRestore/);
  assert.match(app, /function pauseAutoSaveForAppRestore\(\)/);
  assert.match(app, /Storage\.cancelPendingSave\(\)/);

  for (const source of [casesDialog, packDialog]) {
    assert.match(source, /captureScopeContext\(\)/);
    assert.match(source, /isScopeContextCurrent\(parsedScope\)/);
  }
  assert.match(casesDialog, /Storage = CoreStorage/);
  assert.match(packDialog, /Storage = CoreStorage/);
  assert.ok(app.includes('createImportPackDialog({') && app.includes('createImportCasesDialog({'));
});
