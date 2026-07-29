import test from 'node:test';
import assert from 'node:assert/strict';

import * as Identity from '../../src/core/business-identity.js';
import * as Normalizer from '../../src/core/normalizer.js';
import * as StateStore from '../../src/core/state-store.js';
import * as Storage from '../../src/core/storage.js';
import * as CaseLibrary from '../../src/services/case-library.js';
import * as PackLibrary from '../../src/services/pack-library.js';

const LOAD_PLAN_NUMBER_PATTERN = /^LP-[0-9A-HJKMNP-TV-Z]{8}$/;

function baseCase(overrides = {}) {
  return {
    id: 'case-1',
    name: 'Case One',
    dimensions: { length: 20, width: 10, height: 5 },
    weight: 12,
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function basePack(overrides = {}) {
  return {
    id: 'pack-1',
    title: 'Plan One',
    truck: { length: 300, width: 96, height: 96, shapeMode: 'rect', shapeConfig: {} },
    cases: [],
    groups: [],
    createdAt: 300,
    lastEdited: 400,
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
  };
}

test('BUSINESS-IDENTITY-PHASE1 display normalization, validation results, and workspace comparison follow the contract', () => {
  assert.equal(Identity.normalizeBusinessIdentityDisplay('  ＡbＣ-01  '), 'AbC-01');
  assert.equal(Identity.normalizeBusinessIdentityComparison('  ＡbＣ-01  '), 'abc-01');
  assert.deepEqual(
    Identity.validateBusinessIdentityValue('   ', { field: 'itemCode' }),
    { ok: true, value: null, comparison: null, error: null }
  );

  const cases = [{ id: 'case-a', itemCode: 'Item-01' }];
  const itemConflict = Identity.checkItemCodeAvailability('  item-01  ', cases);
  assert.equal(itemConflict.available, false);
  assert.equal(itemConflict.error.code, 'not_unique');
  assert.equal(Identity.checkItemCodeAvailability(null, cases).available, true,
    'Item Code remains optional');

  const packs = [{ id: 'pack-a', loadPlanNumber: 'LP-CUSTOM' }];
  const planConflict = Identity.checkLoadPlanNumberAvailability('lp-custom', packs);
  assert.equal(planConflict.available, false);
  assert.equal(planConflict.conflictId, 'pack-a');
});

test('BUSINESS-IDENTITY-PHASE1 invalid type, length, controls, and line breaks produce core validation errors', () => {
  const invalidValues = [
    [123, 'invalid_type'],
    ['X'.repeat(65), 'too_long'],
    ['ABC\u0000DEF', 'control_character'],
    ['ABC\nDEF', 'control_character'],
    ['ABC\u2028DEF', 'control_character'],
  ];

  for (const field of ['itemCode', 'loadPlanNumber', 'customerReference']) {
    for (const [value, code] of invalidValues) {
      const result = Identity.validateBusinessIdentityValue(value, {
        field,
        required: field === 'loadPlanNumber',
      });
      assert.equal(result.ok, false, `${field} rejects ${code}`);
      assert.equal(result.error.code, code);
      assert.throws(
        () => Identity.assertBusinessIdentityValue(value, {
          field,
          required: field === 'loadPlanNumber',
        }),
        error => error instanceof Identity.BusinessIdentityError && error.code === code
      );
    }
  }
});

test('BUSINESS-IDENTITY-PHASE1 generator uses Crockford Base32, retries collisions, and stops at its bound', () => {
  assert.match(Identity.generateLoadPlanNumber([]), LOAD_PLAN_NUMBER_PATTERN);

  const attempts = [];
  const retried = Identity.generateLoadPlanNumber(
    [{ id: 'existing', loadPlanNumber: 'LP-00000000' }],
    {
      randomValues(length, attempt) {
        attempts.push(attempt);
        return new Uint8Array(length).fill(attempt);
      },
    }
  );
  assert.equal(retried, 'LP-11111111');
  assert.deepEqual(attempts, [0, 1]);

  assert.throws(
    () => Identity.generateLoadPlanNumber(
      [{ id: 'existing', loadPlanNumber: 'LP-00000000' }],
      {
        maxAttempts: 2,
        randomValues: length => new Uint8Array(length),
      }
    ),
    error =>
      error instanceof Identity.BusinessIdentityError &&
      error.code === 'collision_retry_exhausted'
  );
});

test('BUSINESS-IDENTITY-PHASE1 pure migration is additive, idempotent, stable, and preserves metadata, timestamps, and order', () => {
  const source = [
    basePack({
      id: 'pack-a',
      title: 'A',
      notes: 'keep notes',
      customMetadata: { keep: true },
    }),
    basePack({
      id: 'pack-b',
      title: 'B',
      loadPlanNumber: 'LP-EXISTING',
      customerReference: ' CUSTOMER-2 ',
      createdAt: 301,
      lastEdited: 401,
    }),
  ];
  const sourceBytes = JSON.stringify(source);
  const migrated = Identity.migrateLoadPlanNumbers(source, {
    randomValues: length => new Uint8Array(length).fill(2),
  });

  assert.equal(migrated.changed, true);
  assert.deepEqual(source.map(pack => pack.id), ['pack-a', 'pack-b']);
  assert.equal(JSON.stringify(source), sourceBytes, 'the source collection is not mutated');
  assert.equal(migrated.packLibrary[0].loadPlanNumber, 'LP-22222222');
  const { loadPlanNumber: _number, ...migratedFirstWithoutNumber } = migrated.packLibrary[0];
  assert.deepEqual(migratedFirstWithoutNumber, source[0],
    'migration adds only the missing Load Plan Number');
  assert.strictEqual(migrated.packLibrary[1], source[1],
    'an already-numbered Load Plan is not rewritten');

  const onceBytes = JSON.stringify(migrated.packLibrary);
  const repeated = Identity.migrateLoadPlanNumbers(migrated.packLibrary, {
    randomValues() {
      throw new Error('randomness must not run after migration');
    },
  });
  assert.equal(repeated.changed, false);
  assert.strictEqual(repeated.packLibrary, migrated.packLibrary);
  assert.equal(JSON.stringify(repeated.packLibrary), onceBytes);
});

test('BUSINESS-IDENTITY-PHASE1 canonical normalization accepts legacy JSON and remains stable on repeat', () => {
  const legacy = {
    caseLibrary: [
      baseCase({ id: 'case-a', name: 'A' }),
      baseCase({ id: 'case-b', name: 'B', createdAt: 101, updatedAt: 201 }),
    ],
    packLibrary: [
      basePack({
        id: 'pack-a',
        cases: [{
          id: 'instance-a',
          caseId: 'case-a',
          transform: {
            position: { x: 20, y: 2.5, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        }],
      }),
      basePack({
        id: 'pack-b',
        createdAt: 301,
        lastEdited: 401,
        loadPlanNumber: 'LP-EXISTING',
      }),
    ],
    folderLibrary: [],
    preferences: {},
    currentPackId: 'pack-a',
  };

  const normalized = Normalizer.normalizeAppData(legacy);
  assert.deepEqual(normalized.caseLibrary.map(c => c.itemCode), [null, null]);
  assert.match(normalized.packLibrary[0].loadPlanNumber, LOAD_PLAN_NUMBER_PATTERN);
  assert.equal(normalized.packLibrary[0].customerReference, null);
  assert.equal(normalized.packLibrary[1].loadPlanNumber, 'LP-EXISTING');
  assert.deepEqual(normalized.caseLibrary.map(c => c.id), ['case-a', 'case-b']);
  assert.deepEqual(normalized.packLibrary.map(p => p.id), ['pack-a', 'pack-b']);
  assert.deepEqual(normalized.packLibrary.map(p => [p.createdAt, p.lastEdited]), [[300, 400], [301, 401]]);
  assert.equal(normalized.packLibrary[0].cases[0].id, 'instance-a');
  assert.equal(normalized.packLibrary[0].cases[0].caseId, 'case-a');

  const repeated = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(normalized)));
  assert.equal(repeated.packLibrary[0].loadPlanNumber, normalized.packLibrary[0].loadPlanNumber);
  assert.deepEqual(
    repeated.packLibrary.map(pack => ({
      id: pack.id,
      loadPlanNumber: pack.loadPlanNumber,
      customerReference: pack.customerReference,
      createdAt: pack.createdAt,
      lastEdited: pack.lastEdited,
    })),
    normalized.packLibrary.map(pack => ({
      id: pack.id,
      loadPlanNumber: pack.loadPlanNumber,
      customerReference: pack.customerReference,
      createdAt: pack.createdAt,
      lastEdited: pack.lastEdited,
    }))
  );
});

test('BUSINESS-IDENTITY-PHASE1 Case and Load Plan core APIs normalize, enforce uniqueness, and preserve duplication semantics', () => {
  StateStore.init({
    caseLibrary: [baseCase({ itemCode: 'ITEM-01' })],
    packLibrary: [],
    folderLibrary: [],
    preferences: {},
    currentPackId: null,
  });

  CaseLibrary.upsert(baseCase({
    id: 'case-2',
    name: 'Case Two',
    itemCode: '  ＩＴＥＭ-０２  ',
  }));
  assert.equal(CaseLibrary.getById('case-2').itemCode, 'ITEM-02');
  assert.throws(
    () => CaseLibrary.upsert(baseCase({ id: 'case-3', itemCode: 'item-02' })),
    error => error instanceof Identity.BusinessIdentityError && error.code === 'not_unique'
  );

  const caseCopy = CaseLibrary.duplicate('case-1');
  assert.equal(caseCopy.itemCode, null);
  assert.equal(CaseLibrary.getById(caseCopy.id).itemCode, null);

  const firstPack = PackLibrary.create({
    title: 'First',
    loadPlanNumber: '  lp-manual  ',
    customerReference: ' CUSTOMER-REF ',
  });
  const secondPack = PackLibrary.create({
    title: 'Second',
    customerReference: 'CUSTOMER-REF',
  });
  assert.equal(firstPack.loadPlanNumber, 'lp-manual',
    'display casing is preserved after trimming');
  assert.equal(firstPack.customerReference, 'CUSTOMER-REF');
  assert.equal(secondPack.customerReference, 'CUSTOMER-REF',
    'Customer Reference remains non-unique');
  assert.throws(
    () => PackLibrary.update(secondPack.id, { loadPlanNumber: 'LP-MANUAL' }),
    error => error instanceof Identity.BusinessIdentityError && error.code === 'not_unique'
  );
  assert.throws(
    () => PackLibrary.update(firstPack.id, { loadPlanNumber: '   ' }),
    error => error instanceof Identity.BusinessIdentityError && error.code === 'required'
  );

  PackLibrary.update(firstPack.id, {
    cases: [{
      id: 'instance-1',
      caseId: 'case-1',
      transform: {
        position: { x: 20, y: 2.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  });
  const sourceInstance = PackLibrary.getById(firstPack.id).cases[0];
  const packCopy = PackLibrary.duplicate(firstPack.id);
  assert.notEqual(packCopy.loadPlanNumber.toLowerCase(), firstPack.loadPlanNumber.toLowerCase());
  assert.equal(packCopy.customerReference, null);
  assert.notEqual(packCopy.cases[0].id, sourceInstance.id);
  assert.equal(packCopy.cases[0].caseId, sourceInstance.caseId);
  assert.equal(CaseLibrary.getById('case-1').itemCode, 'ITEM-01',
    'whole-Load-Plan duplication retains referenced Case Item Codes');
});

test('BUSINESS-IDENTITY-PHASE1 workspace load persists one stable migration outside ordinary Undo history', () => {
  const originalWindow = globalThis.window;
  const localStorage = memoryStorage();
  const workspaceKey = 'truckPacker3d:v1:identity-user:workspace:identity-org';
  const payload = {
    version: 'test',
    savedAt: 77,
    caseLibrary: [
      baseCase({ id: 'case-a', customMetadata: { keep: true } }),
      baseCase({ id: 'case-b', createdAt: 101, updatedAt: 201 }),
    ],
    packLibrary: [
      basePack({
        id: 'pack-a',
        notes: 'keep notes',
        customMetadata: { keep: true },
      }),
      basePack({
        id: 'pack-b',
        loadPlanNumber: 'LP-EXISTING',
        createdAt: 301,
        lastEdited: 401,
      }),
    ],
    folderLibrary: [],
    currentPackId: 'pack-a',
  };

  try {
    globalThis.window = { localStorage, setTimeout, clearTimeout };
    Storage.setStorageScope('identity-user');
    Storage.setWorkspaceScope('identity-org');
    localStorage.setItem('truckPacker3d:v1:identity-user', JSON.stringify({
      version: 'test',
      savedAt: 70,
      preferences: {},
    }));
    localStorage.setItem(workspaceKey, JSON.stringify(payload));

    const firstLoad = Storage.load();
    const generated = firstLoad.packLibrary[0].loadPlanNumber;
    assert.match(generated, LOAD_PLAN_NUMBER_PATTERN);
    assert.deepEqual(firstLoad.caseLibrary.map(c => c.itemCode), [null, null]);
    assert.deepEqual(firstLoad.packLibrary.map(p => p.customerReference), [null, null]);
    assert.deepEqual(firstLoad.caseLibrary.map(c => c.id), ['case-a', 'case-b']);
    assert.deepEqual(firstLoad.packLibrary.map(p => p.id), ['pack-a', 'pack-b']);
    assert.deepEqual(firstLoad.packLibrary.map(p => [p.createdAt, p.lastEdited]), [[300, 400], [301, 401]]);

    const storedAfterFirstLoad = localStorage.getItem(workspaceKey);
    const storedPayload = JSON.parse(storedAfterFirstLoad);
    assert.equal(storedPayload.savedAt, 77, 'migration does not rewrite the save timestamp');
    assert.equal(storedPayload.packLibrary[0].loadPlanNumber, generated);
    assert.deepEqual(storedPayload.packLibrary[0].customMetadata, { keep: true });

    const secondLoad = Storage.load();
    assert.equal(secondLoad.packLibrary[0].loadPlanNumber, generated);
    assert.equal(localStorage.getItem(workspaceKey), storedAfterFirstLoad,
      'a second migration pass is byte-stable');

    StateStore.init({
      ...secondLoad,
      currentScreen: 'packs',
      selectedInstanceIds: [],
    });
    assert.equal(StateStore.undo(), false, 'migration is the initial state, not an Undo entry');
    StateStore.set({ caseLibrary: [...StateStore.get('caseLibrary')] });
    assert.equal(StateStore.undo(), true);
    assert.equal(StateStore.get('packLibrary')[0].loadPlanNumber, generated,
      'ordinary Undo cannot remove the required migrated number');

    Storage.saveNow();
    const canonicalStored = JSON.parse(localStorage.getItem(workspaceKey));
    assert.equal(canonicalStored.caseLibrary[0].itemCode, null);
    assert.equal(canonicalStored.packLibrary[0].loadPlanNumber, generated);
    assert.equal(canonicalStored.packLibrary[0].customerReference, null);
  } finally {
    Storage.setStorageScope('anon');
    Storage.setWorkspaceScope('no-org');
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('BUSINESS-IDENTITY-PHASE1 additive fields survive canonical App JSON import and export', () => {
  const imported = Storage.importAppJSON(JSON.stringify({
    data: {
      caseLibrary: [baseCase({ itemCode: ' CASE-EXPORT ' })],
      packLibrary: [basePack({
        loadPlanNumber: ' PLAN-EXPORT ',
        customerReference: ' CUSTOMER-EXPORT ',
      })],
      folderLibrary: [],
      preferences: {},
    },
  }));

  assert.equal(imported.caseLibrary[0].itemCode, 'CASE-EXPORT');
  assert.equal(imported.packLibrary[0].loadPlanNumber, 'PLAN-EXPORT');
  assert.equal(imported.packLibrary[0].customerReference, 'CUSTOMER-EXPORT');

  StateStore.init(imported);
  const exported = JSON.parse(Storage.exportAppJSON());
  assert.equal(exported.data.caseLibrary[0].itemCode, 'CASE-EXPORT');
  assert.equal(exported.data.packLibrary[0].loadPlanNumber, 'PLAN-EXPORT');
  assert.equal(exported.data.packLibrary[0].customerReference, 'CUSTOMER-EXPORT');
});
