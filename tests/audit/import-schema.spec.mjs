import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const importSchemaUrl = new URL('../../src/core/import-schema.js', import.meta.url);
const storageUrl = new URL('../../src/core/storage.js', import.meta.url);
const importExportUrl = new URL('../../src/services/import-export.js', import.meta.url);
const stateStoreUrl = new URL('../../src/core/state-store.js', import.meta.url);

const fixturesDir = new URL('../fixtures/import-export/', import.meta.url);
const readFixture = name => fs.readFile(new URL(name, fixturesDir), 'utf8');

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
  globalThis.window = { localStorage: createMemoryStorage(), setTimeout, clearTimeout };
  const ImportSchema = await import(`${importSchemaUrl.href}?is=${label}-${Date.now()}-${Math.random()}`);
  const StateStore = await import(stateStoreUrl.href);
  const Storage = await import(`${storageUrl.href}?is=${label}-${Date.now()}-${Math.random()}`);
  const ImportExport = await import(`${importExportUrl.href}?is=${label}-${Date.now()}-${Math.random()}`);
  Storage.setStorageScope(`${label}-user`);
  Storage.setWorkspaceScope(`${label}-workspace`);
  return {
    ImportSchema,
    StateStore,
    Storage,
    ImportExport,
    cleanup() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

function baseWorkspaceData(overrides = {}) {
  return {
    caseLibrary: [
      {
        id: 'case-1',
        name: 'Test Case',
        itemCode: 'IC-1',
        category: 'default',
        dimensions: { length: 20, width: 10, height: 10 },
        weight: 15,
        notes: 'Case standard instructions.',
      },
    ],
    packLibrary: [
      {
        id: 'pack-1',
        title: 'Test Load Plan',
        loadPlanNumber: 'LP-TEST1',
        customerReference: 'REF-1',
        notes: 'Load plan notes.',
        folderId: null,
        truck: { length: 200, width: 90, height: 90 },
        cases: [
          {
            id: 'instance-1',
            caseId: 'case-1',
            transform: {
              position: { x: 0, y: 5, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            instanceNotes: 'Instance notes.',
          },
        ],
      },
    ],
    folderLibrary: [],
    preferences: { theme: 'light' },
    ...overrides,
  };
}

// ── 1. New envelope round-trip parsing ──────────────────────────────────────

test('IMPORT-SCHEMA-1 new envelope round-trips through buildEnvelope/parseCargoPlannerEnvelope', async () => {
  const runtime = await createRuntime('roundtrip');
  try {
    const { ImportSchema } = runtime;
    const data = baseWorkspaceData();
    const json = ImportSchema.buildEnvelopeJSON({
      kind: ImportSchema.IMPORT_KIND.ACTIVE_WORKSPACE_BACKUP,
      data,
      appVersion: '1.0.0',
    });
    const parsed = JSON.parse(json);
    assert.equal(parsed.format, 'cargo-planner');
    assert.equal(parsed.kind, 'active-workspace-backup');
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(parsed.units, { length: 'in', weight: 'lb' });
    assert.ok(typeof parsed.createdAt === 'string' && parsed.createdAt.length > 0);

    const envelope = ImportSchema.parseCargoPlannerEnvelope(parsed, {
      expectedKinds: [ImportSchema.IMPORT_KIND.ACTIVE_WORKSPACE_BACKUP],
    });
    assert.equal(envelope.kind, 'active-workspace-backup');
    assert.equal(envelope.schemaVersion, 1);
    assert.deepEqual(envelope.data.caseLibrary, data.caseLibrary);
    assert.deepEqual(envelope.data.packLibrary, data.packLibrary);
  } finally {
    runtime.cleanup();
  }
});

// ── 2. Correct kind dispatch ─────────────────────────────────────────────────

test('IMPORT-SCHEMA-2 Storage.importAppJSON dispatches the active-workspace-backup envelope kind', async () => {
  const runtime = await createRuntime('kind-dispatch');
  try {
    const text = await readFixture('envelope-active-workspace-backup-v1.json');
    const imported = runtime.Storage.importAppJSON(text);
    assert.equal(imported.packLibrary[0].loadPlanNumber, 'LP-ENVELOPE1');
    assert.equal(imported.caseLibrary[0].itemCode, 'LA-001');
  } finally {
    runtime.cleanup();
  }
});

// ── 3. Wrong-kind rejection ──────────────────────────────────────────────────

test('IMPORT-SCHEMA-3 wrong file kind is rejected before any pack data is touched', async () => {
  const runtime = await createRuntime('wrong-kind');
  try {
    const text = await readFixture('envelope-wrong-kind.json'); // kind: workspace-backup
    assert.throws(
      () => runtime.ImportExport.parsePackImportJSON(text),
      error => error && error.code === 'IMPORT_WRONG_KIND'
    );
  } finally {
    runtime.cleanup();
  }
});

// ── 4. Unsupported future schema version rejection ──────────────────────────

test('IMPORT-SCHEMA-4 unsupported future schemaVersion is rejected without mutating state', async () => {
  const runtime = await createRuntime('future-version');
  try {
    runtime.StateStore.init(baseWorkspaceData());
    const before = runtime.StateStore.snapshot();
    const text = await readFixture('envelope-unsupported-schema-version.json');
    assert.throws(
      () => runtime.Storage.importAppJSON(text),
      error => error && error.code === 'IMPORT_UNSUPPORTED_SCHEMA_VERSION'
    );
    assert.deepEqual(runtime.StateStore.snapshot(), before, 'unsupported version must never touch state');
  } finally {
    runtime.cleanup();
  }
});

// ── 5. Malformed schema version rejection ───────────────────────────────────

test('IMPORT-SCHEMA-5 malformed schemaVersion (non-integer) is rejected with a distinct error code', async () => {
  const runtime = await createRuntime('malformed-version');
  try {
    const { ImportSchema } = runtime;
    for (const badVersion of ['1', 1.5, null, -1, 0]) {
      const envelope = ImportSchema.buildEnvelope({
        kind: ImportSchema.IMPORT_KIND.ACTIVE_WORKSPACE_BACKUP,
        data: baseWorkspaceData(),
      });
      envelope.schemaVersion = badVersion;
      const expectedCode = Number.isInteger(badVersion)
        ? 'IMPORT_UNSUPPORTED_SCHEMA_VERSION' // 0 / -1 are integers but out of range
        : 'IMPORT_MALFORMED_SCHEMA_VERSION';
      assert.throws(
        () => ImportSchema.parseCargoPlannerEnvelope(envelope),
        error => error && error.code === expectedCode,
        `schemaVersion ${JSON.stringify(badVersion)} must fail with ${expectedCode}`
      );
    }
  } finally {
    runtime.cleanup();
  }
});

// ── 6/7. Unit contract ───────────────────────────────────────────────────────

test('IMPORT-SCHEMA-6 declared canonical units (in/lb) validate successfully', async () => {
  const runtime = await createRuntime('units-ok');
  try {
    const { ImportSchema } = runtime;
    assert.deepEqual(ImportSchema.validateUnits({ length: 'in', weight: 'lb' }), { length: 'in', weight: 'lb' });
  } finally {
    runtime.cleanup();
  }
});

test('IMPORT-SCHEMA-7 unsupported unit declarations fail closed', async () => {
  const runtime = await createRuntime('units-bad');
  try {
    const { ImportSchema } = runtime;
    assert.throws(
      () => ImportSchema.validateUnits({ length: 'cm', weight: 'kg' }),
      error => error && error.code === 'IMPORT_UNSUPPORTED_UNITS'
    );
    assert.throws(
      () => ImportSchema.validateUnits(null),
      error => error && error.code === 'IMPORT_UNSUPPORTED_UNITS'
    );
    assert.throws(
      () => ImportSchema.validateUnits({ length: 'in', weight: 'oz' }),
      error => error && error.code === 'IMPORT_UNSUPPORTED_UNITS'
    );
  } finally {
    runtime.cleanup();
  }
});

// ── 8. Legacy Load Plan adaptation ───────────────────────────────────────────

test('IMPORT-SCHEMA-8 legacy raw {pack, bundledCases} Load Plan JSON still adapts correctly', async () => {
  const runtime = await createRuntime('legacy-pack');
  try {
    const text = await readFixture('legacy-load-plan-raw.json');
    const parsed = runtime.ImportExport.parsePackImportJSON(text);
    assert.equal(parsed.pack.id, 'pack-legacy-1');
    assert.equal(parsed.pack.loadPlanNumber, 'LP-LEGACY1');
    assert.equal(parsed.pack.cases[0].instanceNotes, 'Fragile — top load only.');
    assert.equal(parsed.bundledCases[0].notes, 'Standard handling instructions.');
  } finally {
    runtime.cleanup();
  }
});

test('IMPORT-SCHEMA-8B legacy quantity-era Load Plan JSON adapts to the current instance-only shape', async () => {
  // The obsolete quantity-target field itself is covered by the dedicated
  // sanitizeLegacyPackQuantityFields suite (tests/audit/quantity-controls-phase-1.spec.mjs);
  // this only confirms the new dispatch layer still routes such a file through
  // that same cleanup rather than rejecting or mis-adapting it.
  const runtime = await createRuntime('legacy-quantity');
  try {
    const text = await readFixture('legacy-quantity-cleanup-load-plan.json');
    const parsed = runtime.ImportExport.parsePackImportJSON(text);
    assert.equal(parsed.pack.id, 'pack-quantity-legacy-1');
    assert.equal(parsed.pack.cases.length, 1, 'the one real physical instance survives');
    assert.equal(parsed.pack.cases[0].caseId, 'case-quantity-legacy-1');
    assert.equal(parsed.bundledCases[0].id, 'case-quantity-legacy-1');
  } finally {
    runtime.cleanup();
  }
});

// ── 9. Legacy App backup adaptation ──────────────────────────────────────────

test('IMPORT-SCHEMA-9 legacy bare/{data} App backup JSON still adapts correctly', async () => {
  const runtime = await createRuntime('legacy-app');
  try {
    const text = await readFixture('legacy-app-backup.json');
    const imported = runtime.Storage.importAppJSON(text);
    assert.equal(imported.caseLibrary[0].itemCode, 'APP-LEGACY-1');
    assert.equal(imported.packLibrary[0].loadPlanNumber, 'LP-APPLEGACY1');
    assert.equal(imported.packLibrary[0].customerReference, 'CUST-99');
  } finally {
    runtime.cleanup();
  }
});

// ── 10. Legacy Workspace adaptation ──────────────────────────────────────────

test('IMPORT-SCHEMA-10 legacy folderless Workspace Backup JSON still adapts correctly', async () => {
  const runtime = await createRuntime('legacy-workspace');
  try {
    const text = await readFixture('legacy-workspace-backup-folderless.json');
    const imported = runtime.ImportExport.parseWorkspaceImportJSON(text);
    assert.equal(imported.caseLibrary[0].id, 'case-ws-legacy-1');
    assert.equal(imported.packLibrary[0].loadPlanNumber, 'LP-WSLEGACY1');
    assert.deepEqual(imported.folderLibrary, []);
    assert.equal(imported.workspaceName, 'Legacy Folderless Workspace');
  } finally {
    runtime.cleanup();
  }
});

// ── 11. Business identity fields preserved through adaptation ───────────────

test('IMPORT-SCHEMA-11 itemCode, loadPlanNumber, and customerReference survive the new envelope round trip', async () => {
  const runtime = await createRuntime('business-identity');
  try {
    const text = await readFixture('envelope-active-workspace-backup-v1.json');
    const imported = runtime.Storage.importAppJSON(text);
    assert.equal(imported.caseLibrary[0].itemCode, 'LA-001');
    assert.equal(imported.packLibrary[0].loadPlanNumber, 'LP-ENVELOPE1');
    assert.equal(imported.packLibrary[0].customerReference, 'PO-4471');
  } finally {
    runtime.cleanup();
  }
});

// ── 12. All three Notes domains preserved ───────────────────────────────────

test('IMPORT-SCHEMA-12 Case Standard Instructions, Instance Notes, and Load Plan Notes all survive the new envelope round trip', async () => {
  const runtime = await createRuntime('notes-domains');
  try {
    const text = await readFixture('envelope-active-workspace-backup-v1.json');
    const imported = runtime.Storage.importAppJSON(text);
    assert.equal(imported.caseLibrary[0].notes, 'Handle with care; standard rigging instructions apply.',
      'Case Standard Instructions must survive');
    assert.equal(imported.packLibrary[0].notes, 'Load rear-to-front; keep audio together.',
      'Load Plan Notes must survive');
    assert.equal(imported.packLibrary[0].cases[0].instanceNotes, 'Load last for quick offload at venue B.',
      'Instance Notes must survive');
  } finally {
    runtime.cleanup();
  }
});

// ── 13. Quantity remains instance cardinality ───────────────────────────────

test('IMPORT-SCHEMA-13 two instances of the same case remain two distinct instances (no persistent quantity)', async () => {
  const runtime = await createRuntime('instance-cardinality');
  try {
    const { ImportSchema } = runtime;
    const data = baseWorkspaceData();
    data.packLibrary[0].cases.push({
      id: 'instance-2',
      caseId: 'case-1',
      transform: {
        position: { x: 20, y: 5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    const json = ImportSchema.buildEnvelopeJSON({ kind: ImportSchema.IMPORT_KIND.ACTIVE_WORKSPACE_BACKUP, data });
    const imported = runtime.Storage.importAppJSON(json);
    assert.equal(imported.packLibrary[0].cases.length, 2, 'both physical instances must survive individually');
    const ids = imported.packLibrary[0].cases.map(inst => inst.id);
    assert.equal(new Set(ids).size, 2, 'instance ids must remain distinct, not collapsed into a count');
    assert.equal(Object.prototype.hasOwnProperty.call(data.caseLibrary[0], 'quantity'), false,
      'Case must never carry a persistent quantity field');
  } finally {
    runtime.cleanup();
  }
});

// ── 14. Derived/transient fields excluded from portable DTOs ────────────────

test('IMPORT-SCHEMA-14 projectPortableCase drops volume; projectPortablePack drops stats and thumbnail fields', async () => {
  const runtime = await createRuntime('portable-projection');
  try {
    const { ImportSchema } = runtime;
    const portableCase = ImportSchema.projectPortableCase({
      id: 'c1', name: 'Case', dimensions: { length: 1, width: 1, height: 1 }, volume: 999,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(portableCase, 'volume'), false);
    assert.equal(portableCase.id, 'c1');

    const portablePack = ImportSchema.projectPortablePack({
      id: 'p1',
      title: 'Pack',
      stats: { totalCases: 5 },
      thumbnail: 'data:image/png;base64,xyz',
      thumbnailUpdatedAt: 1700000000000,
      thumbnailSource: 'auto',
    });
    assert.equal(Object.prototype.hasOwnProperty.call(portablePack, 'stats'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(portablePack, 'thumbnail'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(portablePack, 'thumbnailUpdatedAt'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(portablePack, 'thumbnailSource'), false);
    assert.equal(portablePack.id, 'p1');
    assert.equal(portablePack.title, 'Pack');
  } finally {
    runtime.cleanup();
  }
});

// ── 15. Category metadata projection ─────────────────────────────────────────

test('IMPORT-SCHEMA-15 projectPortableCategories returns key/name/color only when customized', async () => {
  const runtime = await createRuntime('category-projection');
  try {
    const { ImportSchema } = runtime;
    assert.deepEqual(ImportSchema.projectPortableCategories({ categories: [] }), []);
    assert.deepEqual(ImportSchema.projectPortableCategories({}), []);
    assert.deepEqual(
      ImportSchema.projectPortableCategories({
        categories: [{ key: 'audio', name: 'Audio Gear', color: '#f59e0b', extraneous: 'drop-me' }],
      }),
      [{ key: 'audio', name: 'Audio Gear', color: '#f59e0b' }]
    );
  } finally {
    runtime.cleanup();
  }
});

// ── 16. New export -> parse -> portable DTO equivalence ─────────────────────

test('IMPORT-SCHEMA-16 a new-envelope Load Plan export parses back to an equivalent portable DTO', async () => {
  const runtime = await createRuntime('export-parse-equivalence');
  try {
    const { ImportSchema, ImportExport } = runtime;
    const rawPack = {
      id: 'pack-equiv-1',
      title: 'Equivalence Pack',
      loadPlanNumber: 'LP-EQUIV1',
      truck: { length: 200, width: 90, height: 90 },
      cases: [
        {
          id: 'instance-equiv-1',
          caseId: 'case-equiv-1',
          transform: { position: { x: 0, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        },
      ],
      stats: { totalCases: 1 },
      thumbnail: 'data:image/png;base64,unused',
    };
    const rawCase = {
      id: 'case-equiv-1', name: 'Equivalence Case',
      dimensions: { length: 10, width: 10, height: 10 }, weight: 12, volume: 1000,
    };
    const portablePack = ImportSchema.projectPortablePack(rawPack);
    const portableCase = ImportSchema.projectPortableCase(rawCase);
    const json = ImportSchema.buildEnvelopeJSON({
      kind: ImportSchema.IMPORT_KIND.LOAD_PLAN,
      data: { pack: portablePack, bundledCases: [portableCase] },
    });

    const parsed = ImportExport.parsePackImportJSON(json);
    assert.equal(parsed.pack.id, portablePack.id);
    assert.equal(parsed.pack.loadPlanNumber, portablePack.loadPlanNumber);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.pack, 'stats'), false,
      'the parsed DTO must not reintroduce stripped derived fields');
    assert.equal(parsed.bundledCases[0].id, portableCase.id);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.bundledCases[0], 'volume'), false);
  } finally {
    runtime.cleanup();
  }
});

// ── 17. Format dispatch happens before lossy normalization ─────────────────

test('IMPORT-SCHEMA-17 wrong kind and unsupported version are rejected before dangling references are ever evaluated', async () => {
  const runtime = await createRuntime('dispatch-before-normalize');
  try {
    const { ImportSchema, Storage, StateStore } = runtime;
    StateStore.init(baseWorkspaceData());
    const before = StateStore.snapshot();

    // Wrong kind, with data malformed enough that a graph validator would also
    // reject it (duplicate case ids) — must fail on the KIND check, not reach
    // the graph validator at all.
    const wrongKindDangling = ImportSchema.buildEnvelope({
      kind: ImportSchema.IMPORT_KIND.WORKSPACE_BACKUP,
      data: {
        caseLibrary: [{ id: 'dup' }, { id: 'dup' }],
        packLibrary: [],
        preferences: {},
      },
    });
    assert.throws(
      () => Storage.importAppJSON(JSON.stringify(wrongKindDangling)),
      error => error && error.code === 'IMPORT_WRONG_KIND'
    );

    // Unsupported schemaVersion, with the same malformed data — must fail on
    // the VERSION check before the graph validator ever runs.
    const futureDangling = ImportSchema.buildEnvelope({
      kind: ImportSchema.IMPORT_KIND.ACTIVE_WORKSPACE_BACKUP,
      data: {
        caseLibrary: [{ id: 'dup' }, { id: 'dup' }],
        packLibrary: [],
        preferences: {},
      },
    });
    futureDangling.schemaVersion = 2;
    assert.throws(
      () => Storage.importAppJSON(JSON.stringify(futureDangling)),
      error => error && error.code === 'IMPORT_UNSUPPORTED_SCHEMA_VERSION'
    );

    assert.deepEqual(StateStore.snapshot(), before, 'no rejected envelope may mutate state');
  } finally {
    runtime.cleanup();
  }
});

// ── 18. Recovery Safety Foundation graph validation is preserved verbatim ──

test('IMPORT-SCHEMA-18 the shared workspace graph validator still rejects dangling folder/case references with the historical messages', async () => {
  const runtime = await createRuntime('graph-validation-preserved');
  try {
    const { ImportSchema } = runtime;
    assert.throws(
      () => ImportSchema.validateWorkspaceGraph(
        { caseLibrary: [], packLibrary: [{ id: 'p1', folderId: 'missing-folder', cases: [] }], preferences: {} },
        { requirePreferences: true }
      ),
      /folderId.*does not exist/i
    );
    assert.throws(
      () => ImportSchema.validateWorkspaceGraph(
        { caseLibrary: [{ id: 'dup' }, { id: 'dup' }], packLibrary: [], preferences: {} },
        { requirePreferences: true }
      ),
      /duplicate id/i
    );
    assert.throws(
      () => ImportSchema.validateWorkspaceGraph({ caseLibrary: [], packLibrary: [], preferences: null }, { requirePreferences: true }),
      /preferences.*object/i
    );
  } finally {
    runtime.cleanup();
  }
});
