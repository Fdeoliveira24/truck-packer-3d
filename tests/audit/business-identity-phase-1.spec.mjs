import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import * as Identity from '../../src/core/business-identity.js';
import * as Normalizer from '../../src/core/normalizer.js';
import * as StateStore from '../../src/core/state-store.js';
import * as Storage from '../../src/core/storage.js';
import * as CaseLibrary from '../../src/services/case-library.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import { createCardDisplayOverlay } from '../../src/ui/overlays/card-display-overlay.js';

const LOAD_PLAN_NUMBER_PATTERN = /^LP-[0-9A-HJKMNP-TV-Z]{8}$/;
const CASE_MODAL_PATH = new URL('../../src/ui/overlays/case-modal.js', import.meta.url);
const CASES_SCREEN_PATH = new URL('../../src/screens/cases-screen.js', import.meta.url);
const CASE_LIBRARY_PATH = new URL('../../src/services/case-library.js', import.meta.url);
const PACKS_SCREEN_PATH = new URL('../../src/screens/packs-screen.js', import.meta.url);

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
      loadPlanNumber: 'LP-00000000',
      customerReference: ' CUSTOMER-2 ',
      createdAt: 301,
      lastEdited: 401,
    }),
  ];
  const sourceBytes = JSON.stringify(source);
  const attempts = [];
  const migrated = Identity.migrateLoadPlanNumbers(source, {
    randomValues(length, attempt) {
      attempts.push(attempt);
      return new Uint8Array(length).fill(attempt);
    },
  });

  assert.equal(migrated.changed, true);
  assert.deepEqual(attempts, [0, 1],
    'a missing Pack retries a candidate reserved by a later existing Pack');
  assert.deepEqual(source.map(pack => pack.id), ['pack-a', 'pack-b']);
  assert.equal(JSON.stringify(source), sourceBytes, 'the source collection is not mutated');
  assert.equal(migrated.packLibrary[0].loadPlanNumber, 'LP-11111111');
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

test('BUSINESS-IDENTITY-PHASE1 migration reserves an existing number before a later missing Pack', () => {
  const source = [
    basePack({ id: 'pack-a', loadPlanNumber: 'LP-00000000' }),
    basePack({ id: 'pack-b', createdAt: 301, lastEdited: 401 }),
  ];
  const attempts = [];
  const migrated = Identity.migrateLoadPlanNumbers(source, {
    randomValues(length, attempt) {
      attempts.push(attempt);
      return new Uint8Array(length).fill(attempt);
    },
  });

  assert.deepEqual(attempts, [0, 1]);
  assert.strictEqual(migrated.packLibrary[0], source[0]);
  assert.equal(migrated.packLibrary[1].loadPlanNumber, 'LP-11111111');
  assert.equal(migrated.packLibrary[1].createdAt, 301);
  assert.equal(migrated.packLibrary[1].lastEdited, 401);
  assert.deepEqual(migrated.packLibrary.map(pack => pack.id), ['pack-a', 'pack-b']);
});

test('BUSINESS-IDENTITY-PHASE1 migration reserves each generated number for later missing Packs', () => {
  const attempts = [];
  const migrated = Identity.migrateLoadPlanNumbers([
    basePack({ id: 'pack-a' }),
    basePack({ id: 'pack-b', createdAt: 301, lastEdited: 401 }),
  ], {
    randomValues(length, attempt) {
      attempts.push(attempt);
      return new Uint8Array(length).fill(attempt);
    },
  });

  assert.deepEqual(
    migrated.packLibrary.map(pack => pack.loadPlanNumber),
    ['LP-00000000', 'LP-11111111']
  );
  assert.deepEqual(attempts, [0, 0, 1]);
});

test('BUSINESS-IDENTITY-PHASE1 migration rejects duplicate pre-existing numbers during pre-scan', () => {
  assert.throws(
    () => Identity.migrateLoadPlanNumbers([
      basePack({ id: 'pack-a', loadPlanNumber: 'LP-DUPLICATE' }),
      basePack({ id: 'pack-b', loadPlanNumber: ' lp-duplicate ' }),
      basePack({ id: 'pack-c' }),
    ], {
      randomValues() {
        throw new Error('generation must not run before existing numbers are validated');
      },
    }),
    error =>
      error instanceof Identity.BusinessIdentityError &&
      error.code === 'not_unique' &&
      error.conflictId === 'pack-a'
  );
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
  CaseLibrary.upsert(baseCase({
    id: 'case-blank',
    name: 'Case Blank',
    itemCode: '   ',
  }));
  assert.equal(CaseLibrary.getById('case-blank').itemCode, null);
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
    customerReference: '   ',
  });
  const thirdPack = PackLibrary.create({
    title: 'Third',
    customerReference: 'CUSTOMER-REF',
  });
  assert.equal(firstPack.loadPlanNumber, 'lp-manual',
    'display casing is preserved after trimming');
  assert.equal(firstPack.customerReference, 'CUSTOMER-REF');
  assert.match(secondPack.loadPlanNumber, LOAD_PLAN_NUMBER_PATTERN,
    'a blank number is generated at creation');
  assert.equal(secondPack.customerReference, null);
  assert.equal(thirdPack.customerReference, 'CUSTOMER-REF',
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

test('BUSINESS-IDENTITY-UI Case create/edit uses Phase 1 validation and persists normalized Item Codes', async () => {
  const source = await fs.readFile(CASE_MODAL_PATH, 'utf8');
  const itemFieldIndex = source.indexOf("const fItemCode = createIdentityField(doc, 'Item Code'");
  const manufacturerFieldIndex = source.indexOf("const fMfg = createField(doc, 'Manufacturer'");
  const nameAppendIndex = source.indexOf('content.appendChild(fName.wrap)');
  const itemAppendIndex = source.indexOf('content.appendChild(fItemCode.wrap)');
  const manufacturerAppendIndex = source.indexOf('content.appendChild(fMfg.wrap)');

  assert.ok(itemFieldIndex > 0 && itemFieldIndex < manufacturerFieldIndex,
    'Item Code is declared immediately after the primary Case Name');
  assert.ok(nameAppendIndex < itemAppendIndex && itemAppendIndex < manufacturerAppendIndex,
    'Item Code is rendered between Case Name and the remaining fields');
  assert.match(source, /fItemCode\.input\.value = initial\.itemCode \|\| '';/,
    'editing reads the existing Item Code');
  assert.match(source, /checkItemCodeAvailability\(\s*fItemCode\.input\.value,\s*CaseLibrary\.getCases\(\),\s*\{ excludeId: initial\.id \}/,
    'saving delegates optional normalization and workspace uniqueness to Phase 1');
  assert.match(source, /itemCode: itemCodeResult\.value,/,
    'saving passes the normalized nullable value to CaseLibrary');
  assert.match(source, /Item Code already in use\./);
  assert.match(source, /Item Code is too long\./);
  assert.match(source, /Item Code cannot contain line breaks or control characters\./);
});

test('BUSINESS-IDENTITY-UI Load Plan create/edit validates and saves Number and Customer Reference', async () => {
  const source = await fs.readFile(PACKS_SCREEN_PATH, 'utf8');
  const createStart = source.indexOf('function openNewPackModal()');
  const editStart = source.indexOf('function openEditPackModal(packId)');
  const renameStart = source.indexOf('function openRename', editStart);
  const createBlock = source.slice(createStart, editStart);
  const editBlock = source.slice(editStart, renameStart);

  assert.match(createBlock, /Leave blank to generate automatically\./,
    'new Load Plans explain automatic generation');
  assert.ok(
    createBlock.indexOf('content.appendChild(title.wrap)') <
      createBlock.indexOf('content.appendChild(loadPlanNumber.wrap)') &&
      createBlock.indexOf('content.appendChild(loadPlanNumber.wrap)') <
      createBlock.indexOf('content.appendChild(customerReference.wrap)') &&
      createBlock.indexOf('content.appendChild(customerReference.wrap)') <
      createBlock.indexOf('content.appendChild(client.wrap)'),
    'new fields follow Title in the approved order'
  );
  assert.match(createBlock, /numberRequired: false/,
    'a new Load Plan may leave its number blank for generation');
  assert.match(createBlock, /loadPlanNumber: identity\.loadPlanNumber,\s*customerReference: identity\.customerReference,/,
    'create passes normalized identity values to PackLibrary');
  assert.match(createBlock, /showToast\('Load plan created', 'success', \{ title: pack\.loadPlanNumber \}\)/,
    'the generated number is visible after creation');

  assert.match(editBlock, /loadPlanNumber\.input\.value = pack\.loadPlanNumber \|\| '';/,
    'editing reads the existing Load Plan Number');
  assert.match(editBlock, /customerReference\.input\.value = pack\.customerReference \|\| '';/,
    'editing reads the existing Customer Reference');
  assert.match(editBlock, /numberRequired: true,\s*excludeId: packId,/,
    'existing Load Plans require a unique number while excluding themselves');
  assert.match(editBlock, /loadPlanNumber: identity\.loadPlanNumber,\s*customerReference: identity\.customerReference,/,
    'edit persists both normalized identity values');
  assert.match(source, /if \(code === 'required'\) return `\$\{label\} is required\.`;/);
  assert.match(source, /if \(code === 'not_unique'\) return `\$\{label\} already in use\.`;/);
  assert.match(source, /return `\$\{label\} cannot contain line breaks or control characters\.`;/);
  assert.match(source, /identityErrorMessage\(numberResult, 'Load Plan Number'\)/);
  assert.match(source, /identityErrorMessage\(customerResult, 'Customer Reference'\)/);
});

test('BUSINESS-IDENTITY-UI management views keep names primary and identifiers conditional without UUID exposure', async () => {
  const [casesSource, packsSource] = await Promise.all([
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
  ]);
  const caseGridIdentity = casesSource.slice(
    casesSource.indexOf("const title = document.createElement('h3')"),
    casesSource.indexOf("const meta = document.createElement('div')", casesSource.indexOf("const title = document.createElement('h3')"))
  );
  const caseListIdentity = casesSource.slice(
    casesSource.indexOf("const tdName = document.createElement('td')"),
    casesSource.indexOf("const tdMfg = document.createElement('td')")
  );
  const packIdentity = packsSource.slice(
    packsSource.indexOf('function appendPackIdentityMetadata'),
    packsSource.indexOf('function initPacksUI')
  );

  assert.match(caseGridIdentity, /title\.textContent = c\.name/);
  assert.match(caseGridIdentity, /if \(c\.itemCode && badgePrefs\.showItemCode !== false\)/);
  assert.match(caseGridIdentity, /Item Code: \$\{c\.itemCode\}/);
  assert.doesNotMatch(caseGridIdentity, /\bc\.id\b/);
  assert.match(caseListIdentity, /name\.textContent = c\.name/);
  assert.match(caseListIdentity, /if \(c\.itemCode && badgePrefs\.showItemCode !== false\)/,
    'the Case identity preference applies to list metadata too');
  assert.doesNotMatch(caseListIdentity, /\bc\.id\b/);

  assert.match(packIdentity, /if \(showLoadPlanNumber\)/);
  assert.match(packIdentity, /Load Plan Number: \$\{pack\.loadPlanNumber \|\| '—'\}/);
  assert.match(packIdentity, /if \(showCustomerReference && pack\.customerReference\)/);
  assert.doesNotMatch(packIdentity, /\bpack\.id\b/);
  const identityPreferenceCalls = packsSource.match(
    /appendPackIdentityMetadata\(titleWrap, pack, \{\s*showLoadPlanNumber: badgePrefs\.showLoadPlanNumber !== false,\s*showCustomerReference: badgePrefs\.showCustomerReference !== false,\s*\}\);/g
  ) || [];
  assert.equal(identityPreferenceCalls.length, 2,
    'Load Plan grid and list views both apply the identity Card Display preferences');
  assert.doesNotMatch(
    `${casesSource}\n${packsSource}`,
    /\b(?:inst|instance)\.(?:itemCode|loadPlanNumber|customerReference)\b/,
    'no packed-instance identifier field is introduced'
  );
});

test('BUSINESS-IDENTITY-UI Card Display toggles use existing defaults, persistence, and render refresh', () => {
  const defaults = Normalizer.normalizePreferences({});
  assert.equal(defaults.gridCardBadges.cases.showItemCode, true);
  assert.equal(defaults.gridCardBadges.cases.showHandling, true);
  assert.equal(defaults.gridCardBadges.packs.showLoadPlanNumber, true);
  assert.equal(defaults.gridCardBadges.packs.showCustomerReference, true);

  let preferences = defaults;
  let menuItems = [];
  let setCount = 0;
  let casesRenderCount = 0;
  let packsRenderCount = 0;
  const anchors = {
    'cases-card-display': { id: '' },
    'packs-card-display': { id: '' },
  };
  const overlay = createCardDisplayOverlay({
    documentRef: {
      getElementById(id) {
        return anchors[id] || null;
      },
      querySelector() {
        return null;
      },
    },
    UIComponents: {
      closeAllDropdowns() {},
      openDropdown(_anchor, items) {
        menuItems = items;
      },
    },
    PreferencesManager: {
      get() {
        return preferences;
      },
      set(next) {
        preferences = next;
        setCount += 1;
      },
    },
    Defaults: { defaultPreferences: defaults },
    Utils: {
      deepClone(value) {
        return structuredClone(value);
      },
    },
    getCasesUI: () => ({ render: () => { casesRenderCount += 1; } }),
    getPacksUI: () => ({ render: () => { packsRenderCount += 1; } }),
  });

  const findItem = label => menuItems.find(entry => entry.label === label);

  overlay.open({ screen: 'cases' });
  assert.equal(findItem('Show Item Code').checked, true);
  assert.equal(findItem('Show Category').checked, true,
    'existing Case Card Display controls remain present');
  assert.equal(findItem('Show Handling').checked, true);
  findItem('Show Item Code').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showItemCode, false);
  assert.equal(casesRenderCount, 1);
  assert.equal(packsRenderCount, 0);
  assert.equal(findItem('Show Item Code').checked, false,
    'the reopened menu reads the persisted preference');
  findItem('Show Category').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showCategory, false,
    'an existing Case control still persists through the same path');
  findItem('Show Handling').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showHandling, false);
  assert.equal(preferences.gridCardBadges.cases.showFlip, true,
    'Handling toggles independently from the existing Flip badge');
  assert.equal(findItem('Show Handling').checked, false,
    'the reopened menu reads the persisted Handling preference');

  overlay.open({ screen: 'packs' });
  assert.equal(findItem('Show Load Plan Number').checked, true);
  assert.equal(findItem('Show Customer Reference').checked, true);
  assert.equal(findItem('Show Thumbnail').checked, true,
    'existing Load Plan Card Display controls remain present');
  findItem('Show Load Plan Number').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.packs.showLoadPlanNumber, false);
  assert.equal(preferences.gridCardBadges.packs.showCustomerReference, true,
    'Load Plan Number toggles independently');
  findItem('Show Customer Reference').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.packs.showCustomerReference, false);
  assert.equal(preferences.gridCardBadges.packs.showLoadPlanNumber, false,
    'Customer Reference toggles independently');
  assert.equal(packsRenderCount, 2);
  assert.equal(casesRenderCount, 3);
  assert.equal(setCount, 5);

  const persisted = Normalizer.normalizePreferences(preferences);
  assert.equal(persisted.gridCardBadges.cases.showItemCode, false);
  assert.equal(persisted.gridCardBadges.cases.showHandling, false);
  assert.equal(persisted.gridCardBadges.packs.showLoadPlanNumber, false);
  assert.equal(persisted.gridCardBadges.packs.showCustomerReference, false);
  assert.equal(persisted.gridCardBadges.packs.showThumbnail, true,
    'unrelated saved controls are preserved');
});

test('BUSINESS-IDENTITY-UI Card Display fields have grid/list parity without cross-field coupling', async () => {
  const [casesSource, packsSource] = await Promise.all([
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
  ]);
  const caseGridHandling = casesSource.slice(
    casesSource.indexOf('if (badgePrefs.showHandling !== false)'),
    casesSource.indexOf("const selectCb = document.createElement('input')")
  );
  const caseListHandling = casesSource.slice(
    casesSource.indexOf("const tdFlip = document.createElement('td')"),
    casesSource.indexOf("const tdActions = document.createElement('td')")
  );
  const caseColumnVisibility = casesSource.slice(
    casesSource.indexOf('function applyListColumnVisibility(prefs)'),
    casesSource.indexOf('function chip(')
  );
  const packListStart = packsSource.indexOf('function renderListView(packs)');
  const packListIdentity = packsSource.slice(
    packListStart,
    packsSource.indexOf('const stats = PackLibrary.computeStats(pack)', packListStart)
  );

  assert.match(caseGridHandling, /if \(badgePrefs\.showHandling !== false\)/,
    'Handling controls Case grid handling chips');
  assert.match(caseListHandling, /if \(badgePrefs\.showHandling === false\)/,
    'Handling controls the Case list cell');
  assert.doesNotMatch(caseListHandling, /showFlip/,
    'the Flip badge preference no longer controls the whole Handling column');
  assert.match(caseColumnVisibility, /handlingTh\.style\.display = badgePrefs\.showHandling !== false/,
    'Handling controls the matching Case list header');
  assert.doesNotMatch(caseColumnVisibility, /showFlip/,
    'the Case list header is independent from the grid-only Flip badge');

  assert.match(packListIdentity, /showLoadPlanNumber: badgePrefs\.showLoadPlanNumber !== false/);
  assert.match(packListIdentity, /showCustomerReference: badgePrefs\.showCustomerReference !== false/);
  assert.match(packListIdentity, /title\.textContent = pack\.title \|\| 'Untitled Load Plan'/,
    'the Load Plan title remains primary and is never hidden');
  assert.match(packsSource, /if \(showCustomerReference && pack\.customerReference\)/,
    'empty Customer Reference values remain omitted even when enabled');
});

test('BUSINESS-IDENTITY-UI identifiers do not change search/sort and Cases distinguish empty library from no matches', async () => {
  const [caseLibrarySource, casesSource, packsSource] = await Promise.all([
    fs.readFile(CASE_LIBRARY_PATH, 'utf8'),
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
  ]);
  const caseSearch = caseLibrarySource.slice(
    caseLibrarySource.indexOf('export function search(query, categoryKeys)'),
    caseLibrarySource.indexOf('export function countsByCategory')
  );
  const caseSort = casesSource.slice(
    casesSource.indexOf('// Sort cases'),
    casesSource.indexOf('const casePageMeta')
  );
  const packRender = packsSource.slice(
    packsSource.indexOf('function render()'),
    packsSource.indexOf('function resetWorkspaceState')
  );

  assert.doesNotMatch(caseSearch, /itemCode|loadPlanNumber|customerReference/);
  assert.doesNotMatch(caseSort, /itemCode|loadPlanNumber|customerReference/);
  assert.doesNotMatch(packRender, /itemCode|loadPlanNumber|customerReference/);
  assert.match(packRender, /\(p\.title \|\| ''\).*includes\(q\).*p\.client/s,
    'Load Plan search remains Title/Client only');

  assert.match(casesSource, /const allCases = CaseLibrary\.getCases\(\);/);
  assert.match(casesSource, /const hasLibraryCases = allCases\.length > 0;/);
  assert.match(casesSource, /'No cases yet'/);
  assert.match(casesSource, /'No matching cases'/);
  assert.match(packRender, /if \(!allPacks\.length\)/);
  assert.match(packRender, /if \(!packs\.length\)/);
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
