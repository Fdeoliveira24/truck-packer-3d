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
import { createUIComponents } from '../../src/ui/ui-components.js';
import { findMatchingTrailerPreset, packMatchesSearch } from '../../src/screens/packs-screen.js';
import { TrailerPresets } from '../../src/data/trailer-presets.js';

const LOAD_PLAN_NUMBER_PATTERN = /^LP-[0-9A-HJKMNP-TV-Z]{8}$/;
const INDEX_PATH = new URL('../../index.html', import.meta.url);
const CASE_MODAL_PATH = new URL('../../src/ui/overlays/case-modal.js', import.meta.url);
const CASES_SCREEN_PATH = new URL('../../src/screens/cases-screen.js', import.meta.url);
const CASE_LIBRARY_PATH = new URL('../../src/services/case-library.js', import.meta.url);
const PACKS_SCREEN_PATH = new URL('../../src/screens/packs-screen.js', import.meta.url);
const MAIN_CSS_PATH = new URL('../../styles/main.css', import.meta.url);
const UI_COMPONENTS_PATH = new URL('../../src/ui/ui-components.js', import.meta.url);

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
  const packListIdentity = packsSource.slice(
    packsSource.indexOf('function appendPackListIdentityMetadata'),
    packsSource.indexOf('function createPackIdentityChips')
  );
  const packGridIdentity = packsSource.slice(
    packsSource.indexOf('function createPackIdentityChips'),
    packsSource.indexOf('function openPackManagementNotes')
  );

  assert.match(caseGridIdentity, /title\.textContent = c\.name/);
  assert.match(caseGridIdentity, /const itemCode = String\(c\.itemCode \|\| ''\)\.trim\(\)/);
  assert.match(caseGridIdentity, /if \(itemCode && badgePrefs\.showItemCode !== false\)/);
  assert.match(caseGridIdentity, /createManagementIdentityChip\(`Code: \$\{itemCode\}`, `Item Code: \$\{itemCode\}`\)/);
  assert.match(caseGridIdentity, /createManagementIdentityChip\(manufacturer, `Manufacturer: \$\{manufacturer\}`\)/);
  assert.doesNotMatch(caseGridIdentity, /\bc\.id\b/);
  assert.match(caseListIdentity, /name\.textContent = c\.name/);
  assert.match(caseListIdentity, /const itemCodeValue = String\(c\.itemCode \|\| ''\)\.trim\(\)/);
  assert.match(caseListIdentity, /if \(itemCodeValue && badgePrefs\.showItemCode !== false\)/,
    'the Case identity preference applies to list metadata too');
  assert.match(caseListIdentity, /itemCodeMeta\.className = 'muted tp3d-management-secondary-text'/,
    'Case List keeps Item Code as compact secondary text');
  assert.doesNotMatch(caseListIdentity, /\bc\.id\b/);

  assert.match(packListIdentity, /function appendPackListIdentityMetadata/);
  assert.match(packListIdentity, /const loadPlanNumber = String\(pack\.loadPlanNumber \|\| ''\)\.trim\(\)/);
  assert.match(packListIdentity, /Load Plan Number: \$\{loadPlanNumber \|\| '—'\}/);
  assert.match(packListIdentity, /if \(showCustomerReference && customerReferenceValue\)/);
  assert.match(packGridIdentity, /function createPackIdentityChips/);
  assert.match(packGridIdentity, /createManagementIdentityChip\(loadPlanNumber, `Load Plan Number: \$\{loadPlanNumber\}`\)/);
  assert.match(packGridIdentity, /`Ref: \$\{customerReference\}`/);
  assert.doesNotMatch(`${packListIdentity}\n${packGridIdentity}`, /\bpack\.id\b/);
  assert.match(packsSource, /appendPackListIdentityMetadata\(titleWrap, pack, \{\s*showLoadPlanNumber: badgePrefs\.showLoadPlanNumber !== false,\s*showCustomerReference: badgePrefs\.showCustomerReference !== false,\s*\}\);/,
    'Load Plan List applies identity preferences to compact secondary text');
  assert.match(packsSource, /createPackIdentityChips\(pack, \{\s*showLoadPlanNumber: badgePrefs\.showLoadPlanNumber !== false,\s*showCustomerReference: badgePrefs\.showCustomerReference !== false,\s*\}\);/,
    'Load Plan Grid applies the same preferences to compact chips');
  assert.doesNotMatch(
    `${casesSource}\n${packsSource}`,
    /\b(?:inst|instance)\.(?:itemCode|loadPlanNumber|customerReference)\b/,
    'no packed-instance identifier field is introduced'
  );
});

test('BUSINESS-IDENTITY-UI Card Display toggles use existing defaults, persistence, and render refresh', () => {
  const defaults = Normalizer.normalizePreferences({});
  assert.equal(defaults.gridCardBadges.cases.showItemCode, true);
  assert.equal(defaults.gridCardBadges.cases.showManufacturer, true);
  assert.equal(defaults.gridCardBadges.cases.showHandling, true);
  assert.equal(defaults.gridCardBadges.cases.showNotes, true);
  assert.equal(defaults.gridCardBadges.packs.showLoadPlanNumber, true);
  assert.equal(defaults.gridCardBadges.packs.showCustomerReference, true);
  assert.equal(defaults.gridCardBadges.packs.showNotes, true);

  let preferences = defaults;
  let menuItems = [];
  let menuOptions = {};
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
      openDropdown(_anchor, items, options) {
        menuItems = items;
        menuOptions = options;
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
  assert.deepEqual(
    menuItems.slice(1).map(entry => entry.label),
    ['Item Code', 'Manufacturer', 'Quantity', 'Dimensions', 'Volume', 'Weight', 'Category', 'Handling', 'Notes']
  );
  assert.equal(menuOptions.width, 200);
  assert.equal(menuOptions.dropdownClass, 'tp3d-dropdown-card-display');
  assert.equal(menuOptions.manageTriggerState, true);
  assert.equal(findItem('Item Code').checked, true);
  assert.equal(findItem('Manufacturer').checked, true);
  assert.equal(findItem('Category').checked, true);
  assert.equal(findItem('Handling').checked, true);
  assert.equal(findItem('Notes').checked, true);
  findItem('Item Code').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showItemCode, false);
  assert.equal(casesRenderCount, 1);
  assert.equal(packsRenderCount, 0);
  assert.equal(findItem('Item Code').checked, false,
    'the reopened menu reads the persisted preference');
  findItem('Manufacturer').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showManufacturer, false);
  findItem('Category').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showCategory, false,
    'an existing Case control still persists through the same path');
  findItem('Handling').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showHandling, false);
  assert.equal(preferences.gridCardBadges.cases.showFlip, true,
    'the obsolete legacy Flip preference remains tolerated without controlling display');
  assert.equal(findItem('Handling').checked, false,
    'the reopened menu reads the persisted Handling preference');
  findItem('Notes').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.cases.showNotes, false);

  overlay.open({ screen: 'packs' });
  assert.deepEqual(
    menuItems.slice(1).map(entry => entry.label),
    [
      'Load Plan Number',
      'Customer Reference',
      'Notes',
      'Thumbnail',
      'Dimensions',
      'Shape',
      'Cases Qty',
      'Volume',
      'Weight',
      'Edited Time',
    ]
  );
  assert.equal(menuOptions.width, 216);
  assert.equal(findItem('Load Plan Number').checked, true);
  assert.equal(findItem('Customer Reference').checked, true);
  assert.equal(findItem('Notes').checked, true);
  assert.equal(findItem('Thumbnail').checked, true,
    'existing Load Plan Card Display controls remain present');
  findItem('Load Plan Number').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.packs.showLoadPlanNumber, false);
  assert.equal(preferences.gridCardBadges.packs.showCustomerReference, true,
    'Load Plan Number toggles independently');
  findItem('Customer Reference').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.packs.showCustomerReference, false);
  assert.equal(preferences.gridCardBadges.packs.showLoadPlanNumber, false,
    'Customer Reference toggles independently');
  findItem('Notes').onCheckboxChange();
  assert.equal(preferences.gridCardBadges.packs.showNotes, false,
    'Load Plan Notes toggles independently through the existing preference path');
  assert.equal(packsRenderCount, 3);
  assert.equal(casesRenderCount, 5);
  assert.equal(setCount, 8);

  const persisted = Normalizer.normalizePreferences(preferences);
  assert.equal(persisted.gridCardBadges.cases.showItemCode, false);
  assert.equal(persisted.gridCardBadges.cases.showManufacturer, false);
  assert.equal(persisted.gridCardBadges.cases.showHandling, false);
  assert.equal(persisted.gridCardBadges.cases.showNotes, false);
  assert.equal(persisted.gridCardBadges.packs.showLoadPlanNumber, false);
  assert.equal(persisted.gridCardBadges.packs.showCustomerReference, false);
  assert.equal(persisted.gridCardBadges.packs.showNotes, false);
  assert.equal(persisted.gridCardBadges.packs.showThumbnail, true,
    'unrelated saved controls are preserved');
  assert.equal(
    Normalizer.normalizePreferences({ gridCardBadges: { packs: {} } }).gridCardBadges.packs.showNotes,
    true,
    'an older saved preference object gains the additive enabled default'
  );
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
    casesSource.indexOf("const tdHandling = document.createElement('td')"),
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
    'the Case list header is independent from the tolerated legacy Flip preference');
  assert.match(casesSource, /manufacturer && badgePrefs\.showManufacturer !== false/,
    'Manufacturer visibility applies to Case cards');
  assert.match(casesSource, /if \(badgePrefs\.showManufacturer === false\) tdMfg\.style\.display = 'none'/,
    'Manufacturer visibility applies to Case list cells');
  assert.match(caseColumnVisibility, /set\('manufacturer', badgePrefs\.showManufacturer !== false\)/,
    'Manufacturer visibility applies to the matching Case list header');
  assert.doesNotMatch(casesSource, /appendCaseNotesPreview|tp3d-case-notes-preview|Instructions:\s*\$\{/,
    'Case note content is never previewed in management cards or rows');
  assert.match(casesSource, /if \(badgePrefs\.showNotes !== false\) actions\.appendChild\(createCaseNotesButton\(c\)\)/,
    'the Cases Notes preference controls the Grid action');
  assert.match(casesSource, /tdNotes\.hidden = badgePrefs\.showNotes === false/,
    'the Cases Notes preference controls each List cell');
  assert.match(caseColumnVisibility, /notesTh\.hidden = badgePrefs\.showNotes === false/,
    'the Cases Notes preference controls the List header');
  assert.doesNotMatch(casesSource, /badgePrefs\.showFlip !== false/,
    'the duplicate grid-only Flip display is removed');
  assert.doesNotMatch(casesSource, /badgePrefs\.showEditedTime !== false/,
    'the inaccessible grid-only Edited Time badge is removed');

  assert.match(packListIdentity, /showLoadPlanNumber: badgePrefs\.showLoadPlanNumber !== false/);
  assert.match(packListIdentity, /showCustomerReference: badgePrefs\.showCustomerReference !== false/);
  assert.match(packListIdentity, /title\.textContent = pack\.title \|\| 'Untitled Load Plan'/,
    'the Load Plan title remains primary and is never hidden');
  assert.match(packsSource, /if \(showCustomerReference && customerReferenceValue\)/,
    'empty Customer Reference values remain omitted even when enabled');
  assert.match(packsSource, /if \(badgePrefs\.showNotes !== false\) actions\.appendChild\(createPackNotesButton\(pack\)\)/,
    'the Load Plan Notes preference controls the Grid action');
  assert.match(packsSource, /tdNotes\.hidden = badgePrefs\.showNotes === false/);
  assert.match(packsSource, /notesTh\.hidden = badgePrefs\.showNotes === false/);
});

test('MANAGEMENT-NOTES Grid/List controls preserve ownership, placement, accessibility, and non-sortable presentation', async () => {
  const [html, casesSource, packsSource, cssSource] = await Promise.all([
    fs.readFile(INDEX_PATH, 'utf8'),
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
    fs.readFile(MAIN_CSS_PATH, 'utf8'),
  ]);
  const caseAdapter = casesSource.slice(
    casesSource.indexOf('function openCaseManagementNotes('),
    casesSource.indexOf('function createCaseNotesButton(')
  );
  const packAdapter = packsSource.slice(
    packsSource.indexOf('function openPackManagementNotes('),
    packsSource.indexOf('function createPackNotesButton(')
  );
  const caseButton = casesSource.slice(
    casesSource.indexOf('function createCaseNotesButton('),
    casesSource.indexOf('function initCasesUI(')
  );
  const packButton = packsSource.slice(
    packsSource.indexOf('function createPackNotesButton('),
    packsSource.indexOf('function initPacksUI(')
  );

  assert.match(caseAdapter, /resolveEntity: \(\{ entityId \}\) => CaseLibrary\.getById\(entityId\)/,
    'Case Notes re-resolves by the captured Case ID');
  assert.match(caseAdapter, /CaseLibrary\.upsert\(\{ \.\.\.entity, notes \}\)/,
    'Case Notes spreads the freshly resolved Case and changes only notes');
  assert.match(caseAdapter, /clearValue: null/);
  assert.doesNotMatch(caseAdapter, /PackLibrary|instanceNotes|updateInstance/,
    'Cases management cannot expose or mutate packed-instance Notes');

  assert.match(packAdapter, /resolveEntity: \(\{ entityId \}\) => PackLibrary\.getById\(entityId\)/,
    'Load Plan Notes re-resolves by the captured Load Plan ID');
  assert.match(packAdapter, /PackLibrary\.update\(entityId, \{ notes: String\(value \|\| ''\)\.trim\(\) \}\)/);
  assert.match(packAdapter, /clearValue: ''/);
  assert.doesNotMatch(packAdapter, /CaseLibrary|instanceNotes|updateInstance/,
    'Load Plan Notes never crosses into Case or packed-instance ownership');

  for (const [source, dataAttribute, ariaPrefix, entityLabel] of [
    [caseButton, 'data-case-notes', 'Open notes for', 'Case'],
    [packButton, 'data-pack-notes', 'Open load plan notes for', 'Load Plan'],
  ]) {
    assert.match(source, /btn\.type = 'button'/, 'Notes is a native keyboard-operable button');
    assert.match(source, new RegExp(`btn\\.setAttribute\\('${dataAttribute}', '1'\\)`));
    assert.doesNotMatch(source, /data-tooltip/,
      `${entityLabel} Notes buttons must not show hover tooltips in Grid or List`);
    assert.match(source, new RegExp(ariaPrefix));
    assert.match(source, /notes available/,
      'the accessible name communicates populated status without relying on the dot');
    assert.match(source, /const hasNotes = Boolean\(String\([^)]*\.notes \|\| ''\)\.trim\(\)\)/);
    assert.match(source, /if \(hasNotes\) \{[\s\S]*?indicator\.className = 'tp3d-notes-indicator-dot'[\s\S]*?indicator\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(source, /btn\.addEventListener\('keydown', ev => ev\.stopPropagation\(\)\)/,
      'button keyboard activation cannot bubble into a card Enter handler');
    assert.match(source, /btn\.addEventListener\('click', ev => \{\s*ev\.stopPropagation\(\);/,
      'button clicks cannot open the card/row, toggle selection, or open overflow');
  }

  const caseGridActions = casesSource.slice(
    casesSource.indexOf("actions.className = 'card-head-actions tp3d-cases-card-head-actions'"),
    casesSource.indexOf("const head = document.createElement('div')", casesSource.indexOf("actions.className = 'card-head-actions tp3d-cases-card-head-actions'"))
  );
  assert.ok(
    caseGridActions.indexOf('actions.appendChild(selectCb)') <
      caseGridActions.indexOf('actions.appendChild(createCaseNotesButton(c))') &&
      caseGridActions.indexOf('actions.appendChild(createCaseNotesButton(c))') <
      caseGridActions.indexOf('actions.appendChild(kebabBtn)'),
    'Case Grid action order is selection, Notes, overflow'
  );
  const packGridActions = packsSource.slice(
    packsSource.indexOf("actions.className = 'card-head-actions'"),
    packsSource.indexOf('head.appendChild(titleWrap)', packsSource.indexOf("actions.className = 'card-head-actions'"))
  );
  assert.ok(
    packGridActions.indexOf('actions.appendChild(selectCb)') <
      packGridActions.indexOf('actions.appendChild(createPackNotesButton(pack))') &&
      packGridActions.indexOf('actions.appendChild(createPackNotesButton(pack))') <
      packGridActions.indexOf('actions.appendChild(kebabBtn)'),
    'Load Plan Grid action order is selection, Notes, overflow'
  );

  const caseHeader = html.match(/<th[^>]*data-column="notes"[^>]*>Notes<\/th>/)?.[0] || '';
  const packHeaderMatches = html.match(/<th[^>]*data-column="notes"[^>]*>Notes<\/th>/g) || [];
  assert.ok(caseHeader, 'management List tables expose Notes headers');
  assert.equal(packHeaderMatches.length, 2, 'Cases and Load Plans each have exactly one Notes header');
  packHeaderMatches.forEach(header => assert.doesNotMatch(header, /data-sort/,
    'Notes headers are presentation controls, never sort fields'));
  assert.match(html, /<th[^>]*>Handling<\/th>\s*<th[^>]*data-column="notes"[^>]*>Notes<\/th>\s*<th class="col-actions"/,
    'Cases Notes sits after Handling and before actions');
  assert.match(html, /data-sort="edited"[\s\S]*?<\/th>\s*<th[^>]*data-column="notes"[^>]*>Notes<\/th>\s*<th class="col-actions"/,
    'Load Plan Notes sits after Edited and before actions');

  const caseListTail = casesSource.slice(
    casesSource.indexOf("const tdHandling = document.createElement('td')"),
    casesSource.indexOf('tbodyEl.appendChild(tr)', casesSource.indexOf("const tdHandling = document.createElement('td')"))
  );
  assert.ok(
    caseListTail.indexOf('tr.appendChild(tdHandling)') <
      caseListTail.indexOf('tr.appendChild(tdNotes)') &&
      caseListTail.indexOf('tr.appendChild(tdNotes)') <
      caseListTail.indexOf('tr.appendChild(tdActions)'),
    'Case List cells match the approved header order'
  );
  const packListTail = packsSource.slice(
    packsSource.indexOf("const tdEdited = document.createElement('td')"),
    packsSource.indexOf('tbodyEl.appendChild(tr)', packsSource.indexOf("const tdEdited = document.createElement('td')"))
  );
  assert.ok(
    packListTail.indexOf('tr.appendChild(tdEdited)') <
      packListTail.indexOf('tr.appendChild(tdNotes)') &&
      packListTail.indexOf('tr.appendChild(tdNotes)') <
      packListTail.indexOf('tr.appendChild(tdActions)'),
    'Load Plan List cells match the approved header order'
  );

  assert.match(cssSource, /\.tp3d-management-notes-col\s*\{[\s\S]*?width:\s*60px;[\s\S]*?min-width:\s*60px;/);
  assert.match(cssSource, /\.tp3d-management-notes-btn\s*\{/);
});

test('MANAGEMENT-METADATA Grid chips and List secondary text keep the approved compact hierarchy without Notes previews', async () => {
  const [casesSource, packsSource, cssSource] = await Promise.all([
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
    fs.readFile(MAIN_CSS_PATH, 'utf8'),
  ]);
  const caseGrid = casesSource.slice(
    casesSource.indexOf("const title = document.createElement('h3')"),
    casesSource.indexOf('gridEl.appendChild(card)', casesSource.indexOf("const title = document.createElement('h3')"))
  );
  const packGrid = packsSource.slice(
    packsSource.indexOf('function renderGridView(packs)'),
    packsSource.indexOf('function buildPreview(pack)')
  );
  const packChipHelper = packsSource.slice(
    packsSource.indexOf('function createPackIdentityChips('),
    packsSource.indexOf('function openPackManagementNotes(')
  );

  assert.match(caseGrid, /createManagementIdentityChip\(`Code: \$\{itemCode\}`/);
  assert.match(caseGrid, /createManagementIdentityChip\(manufacturer/);
  assert.match(caseGrid, /if \(itemCode && badgePrefs\.showItemCode !== false\)/,
    'empty optional Item Code chips are omitted');
  assert.match(caseGrid, /if \(manufacturer && badgePrefs\.showManufacturer !== false\)/,
    'empty optional Manufacturer chips are omitted');
  assert.ok(
    caseGrid.indexOf('card.appendChild(head)') <
      caseGrid.indexOf('card.appendChild(identityChips)') &&
      caseGrid.indexOf('card.appendChild(identityChips)') <
      caseGrid.indexOf('card.appendChild(meta)'),
    'Case Grid hierarchy is primary name/actions, identity chips, then cargo metadata'
  );

  assert.match(packChipHelper, /createManagementIdentityChip\(loadPlanNumber/);
  assert.match(packChipHelper, /`Ref: \$\{customerReference\}`/);
  assert.match(packChipHelper, /if \(showCustomerReference && customerReference\)/,
    'empty Customer Reference chips are omitted');
  assert.doesNotMatch(packChipHelper, /textContent = `Load Plan Number:/,
    'Grid chip copy omits the full Load Plan Number label');
  assert.ok(
    packGrid.indexOf('card.appendChild(head)') <
      packGrid.indexOf('card.appendChild(identityChips)') &&
      packGrid.indexOf('card.appendChild(identityChips)') <
      packGrid.indexOf('card.appendChild(meta)'),
    'Load Plan Grid hierarchy is primary title/actions, identity chips, then load metadata'
  );

  assert.doesNotMatch(`${casesSource}\n${packsSource}`, /appendCaseNotesPreview|tp3d-case-notes-preview|Instructions:\s*\$\{/,
    'management cards and rows contain no direct note-content previews');
  assert.match(cssSource, /\.tp3d-management-identity-chip\s*\{[\s\S]*?font-size:\s*12px;/);
  assert.match(cssSource, /\.tp3d-management-secondary-text\s*\{[\s\S]*?font-size:\s*12px;/);
  assert.match(cssSource, /\.tp3d-management-identity-chip__text\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(casesSource, /itemCodeMeta\.className = 'muted tp3d-management-secondary-text'/);
  assert.match(casesSource, /tdMfg\.classList\.add\('tp3d-management-secondary-text'\)/);
  assert.match(packsSource, /number\.className = 'muted tp3d-management-secondary-text'/);
  assert.match(packsSource, /customerReference\.className = 'muted tp3d-management-secondary-text'/);
});

test('BUSINESS-IDENTITY-SEARCH Case search includes Item Code with shared normalized semantics', () => {
  StateStore.init({
    caseLibrary: [
      baseCase({ id: 'case-name', name: 'Named Cargo', manufacturer: 'Northwind', itemCode: null, category: 'alpha' }),
      baseCase({ id: 'case-code', name: 'Code Cargo', manufacturer: 'Maker', itemCode: 'CASE-2', category: 'beta' }),
      baseCase({ id: 'case-accent', name: 'Accent Cargo', manufacturer: 'Maker', itemCode: 'CAFÉ-10', category: 'beta' }),
      baseCase({ id: 'uuid-only-secret', name: 'Ordinary Cargo', manufacturer: 'Maker', itemCode: null, category: 'beta' }),
    ],
    packLibrary: [],
    folderLibrary: [],
    preferences: {},
    currentPackId: null,
  });

  assert.deepEqual(CaseLibrary.search('named cargo', []).map(c => c.id), ['case-name'],
    'existing Case Name search remains available');
  assert.deepEqual(CaseLibrary.search('NORTHWIND', []).map(c => c.id), ['case-name'],
    'existing Manufacturer search remains case-insensitive');
  assert.deepEqual(CaseLibrary.search('ｃａｓｅ-２', []).map(c => c.id), ['case-code'],
    'Item Code search is NFKC-normalized and case-insensitive');
  assert.deepEqual(CaseLibrary.search('café-10', []).map(c => c.id), ['case-accent']);
  assert.deepEqual(CaseLibrary.search('cafe-10', []).map(c => c.id), [],
    'Item Code search keeps accents significant');
  assert.deepEqual(CaseLibrary.search('case-2', ['beta']).map(c => c.id), ['case-code'],
    'category filtering remains composed with shared search');
  assert.deepEqual(CaseLibrary.search('uuid-only-secret', []).map(c => c.id), [],
    'UUIDs are not searchable');
});

test('BUSINESS-IDENTITY-SEARCH Load Plan search covers approved fields and keeps duplicates', () => {
  const packs = [
    basePack({ id: 'title', title: 'Named Shipment', client: 'Client A', loadPlanNumber: 'LP-2' }),
    basePack({ id: 'client', title: 'Second', client: 'Northwind', loadPlanNumber: 'LP-10' }),
    basePack({
      id: 'reference-a',
      title: 'Third',
      client: '',
      loadPlanNumber: 'LP-20',
      customerReference: 'CAFÉ-ORDER',
    }),
    basePack({
      id: 'reference-b',
      title: 'Fourth',
      client: '',
      loadPlanNumber: 'LP-30',
      customerReference: 'CAFÉ-ORDER',
    }),
    basePack({ id: 'uuid-only-plan', title: 'Ordinary Plan', client: '', loadPlanNumber: 'LP-40' }),
  ];

  assert.deepEqual(packs.filter(pack => packMatchesSearch(pack, 'named shipment')).map(pack => pack.id), ['title']);
  assert.deepEqual(packs.filter(pack => packMatchesSearch(pack, 'NORTHWIND')).map(pack => pack.id), ['client']);
  assert.deepEqual(packs.filter(pack => packMatchesSearch(pack, 'ｌｐ-１０')).map(pack => pack.id), ['client']);
  assert.deepEqual(
    packs.filter(pack => packMatchesSearch(pack, 'café-order')).map(pack => pack.id),
    ['reference-a', 'reference-b'],
    'duplicate Customer References all remain in the result'
  );
  assert.deepEqual(packs.filter(pack => packMatchesSearch(pack, 'cafe-order')).map(pack => pack.id), [],
    'Load Plan search keeps accents significant');
  assert.deepEqual(packs.filter(pack => packMatchesSearch(pack, 'uuid-only-plan')).map(pack => pack.id), [],
    'internal Pack IDs are not searchable');
});

test('BUSINESS-IDENTITY-SORT natural comparison keeps empty values last and stable ties in source order', () => {
  assert.ok(Identity.compareBusinessIdentityValues('CASE-2', 'CASE-10', { direction: 'asc' }) < 0);
  assert.ok(Identity.compareBusinessIdentityValues('LP-2', 'LP-10', { direction: 'asc' }) < 0);
  assert.ok(Identity.compareBusinessIdentityValues('LP-2', 'LP-10', { direction: 'desc' }) > 0);
  assert.equal(Identity.compareBusinessIdentityValues('ＣＡＳＥ-２', 'case-2'), 0,
    'NFKC-equivalent and case-only differences compare equally');
  assert.notEqual(Identity.compareBusinessIdentityValues('CAFE-2', 'CAFÉ-2'), 0,
    'accents remain significant');
  assert.ok(Identity.compareBusinessIdentityValues(null, 'CASE-2', { direction: 'asc' }) > 0);
  assert.ok(Identity.compareBusinessIdentityValues(null, 'CASE-2', { direction: 'desc' }) > 0);
  assert.ok(Identity.compareBusinessIdentityValues('', 'CASE-2', { direction: 'desc' }) > 0);

  const naturalRecords = [
    { id: 'empty', value: null, index: 0 },
    { id: 'ten', value: 'CASE-10', index: 1 },
    { id: 'two', value: 'CASE-2', index: 2 },
  ];
  const naturalIds = direction =>
    naturalRecords
      .slice()
      .sort(
        (a, b) =>
          Identity.compareBusinessIdentityValues(a.value, b.value, { direction }) ||
          a.index - b.index
      )
      .map(record => record.id);
  assert.deepEqual(naturalIds('asc'), ['two', 'ten', 'empty']);
  assert.deepEqual(naturalIds('desc'), ['ten', 'two', 'empty']);

  const tiedRecords = [
    { id: 'first', value: 'CASE-2', index: 0 },
    { id: 'second', value: 'case-2', index: 1 },
  ];
  tiedRecords.sort(
    (a, b) =>
      Identity.compareBusinessIdentityValues(a.value, b.value, { direction: 'asc' }) ||
      a.index - b.index
  );
  assert.deepEqual(tiedRecords.map(record => record.id), ['first', 'second']);
});

test('BUSINESS-IDENTITY-SEARCH-SORT menus, pipelines, and shared Editor behavior follow the approved contract', async () => {
  const [indexSource, caseLibrarySource, casesSource, packsSource, editorSource] = await Promise.all([
    fs.readFile(INDEX_PATH, 'utf8'),
    fs.readFile(CASE_LIBRARY_PATH, 'utf8'),
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
    fs.readFile(new URL('../../src/screens/editor-screen.js', import.meta.url), 'utf8'),
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
    packsSource.indexOf('function render(modeOverride)'),
    packsSource.indexOf('function resetWorkspaceState')
  );
  const caseSortOptions = casesSource.slice(
    casesSource.indexOf('const sortOptions = ['),
    casesSource.indexOf("let sortBy = 'name'")
  );
  const packSortOptions = packsSource.slice(
    packsSource.indexOf('const sortOptions = ['),
    packsSource.indexOf('let activeFolderId')
  );

  assert.match(caseSearch, /matchesValue\(c\.name\).*matchesValue\(c\.manufacturer\).*matchesValue\(c\.itemCode\)/s);
  assert.doesNotMatch(caseSearch, /\bc\.id\b/);
  assert.match(editorSource, /CaseLibrary\.search\(q, caseBrowserGroupBy === 'category'/,
    'Item Code search intentionally reaches the Editor Case Browser');

  assert.match(indexSource, /id="cases-sort"[^>]*data-tooltip="Sort Cases"[^>]*aria-label="Sort Cases"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(indexSource, /id="packs-sort"[^>]*data-tooltip="Sort Load Plans"[^>]*aria-label="Sort Load Plans"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  for (const field of ['name', 'itemCode', 'manufacturer', 'length', 'width', 'height', 'volume', 'weight', 'category']) {
    assert.match(caseSortOptions, new RegExp(`key: '${field}'`));
  }
  for (const field of ['title', 'loadPlanNumber', 'casesQty', 'length', 'width', 'height', 'mode', 'volume', 'weight', 'edited']) {
    assert.match(packSortOptions, new RegExp(`key: '${field}'`));
  }
  assert.doesNotMatch(packSortOptions, /customerReference/,
    'Customer Reference is searchable but is not a sort option');

  assert.match(casesSource, /let sortBy = 'name'/, 'the default Case sort remains Name ascending');
  assert.match(casesSource, /let sortDir = 'asc'/);
  assert.match(packsSource, /let sortKey = 'edited-desc'/, 'the default Load Plan sort remains Edited descending');
  assert.match(caseSort, /compareBusinessIdentityValues\(a\.itemCode, b\.itemCode, \{ direction: sortDir \}\)/);
  assert.match(caseSort, /sourceOrder\.get\(a\).*sourceOrder\.get\(b\)/s);
  assert.doesNotMatch(caseSort, /badgePrefs|showItemCode/);
  assert.match(packRender, /compareBusinessIdentityValues\(a\.loadPlanNumber, b\.loadPlanNumber, \{ direction \}\)/);
  assert.match(packRender, /sourceOrder\.get\(a\).*sourceOrder\.get\(b\)/s);

  assert.match(casesSource, /function openSortMenu\(anchorEl\)/);
  assert.match(casesSource, /\{ type: 'header', label: 'Sort Cases' \}/);
  assert.doesNotMatch(casesSource, /Sort Cases ·|Sort cases:/);
  assert.match(casesSource, /function updateHeaderIcons\(\)[\s\S]*setAttribute\('data-tooltip', 'Sort Cases'\)/);
  assert.match(packsSource, /function openSortMenu\(anchorEl\)/);
  assert.match(packsSource, /\{ type: 'header', label: 'Sort Load Plans' \}/);
  assert.doesNotMatch(packsSource, /Sort Load Plans ·|Sort load plans:/);
  assert.match(packsSource, /function updateListHeaderIcons\(\)[\s\S]*setAttribute\('data-tooltip', 'Sort Load Plans'\)/);
  assert.match(casesSource, /renderGridView\(\(pageMeta && pageMeta\.slice\) \|\| \[\], prefs, workspaceQuantities \|\| new Map\(\)\)/);
  assert.match(casesSource, /casePageMeta\.slice\.forEach/);
  assert.match(packsSource, /renderListView\(pageMeta\.slice\)/);
  assert.match(packsSource, /renderGridView\(pageMeta\.slice\)/,
    'Grid and List consume the same ordered Load Plan IDs');

  assert.ok(caseSearch.indexOf('matchesValue(c.itemCode)') < caseSearch.indexOf('const caseCategory'));
  const caseRenderStart = casesSource.indexOf('function renderTable()');
  assert.ok(casesSource.indexOf('CaseLibrary.search(', caseRenderStart) < casesSource.indexOf('cases.sort(', caseRenderStart));
  assert.ok(casesSource.indexOf('cases.sort(', caseRenderStart) < casesSource.indexOf('const casePageMeta', caseRenderStart),
    'Case filtering and sorting happen before pagination');
  assert.ok(packRender.indexOf('.filter(p => packMatchesSearch(p, q))') < packRender.indexOf('packs.sort('));
  assert.ok(packRender.indexOf('packs.sort(') < packRender.indexOf('const pageMeta = getPageMeta(packs)'),
    'Load Plan filtering and sorting happen before pagination');
  assert.match(casesSource, /const datasetKey = `\$\{q\}::\$\{sortBy\}::\$\{sortDir\}/);
  assert.match(packRender, /const newDatasetKey = `\$\{q\}::\$\{sortKey\}/,
    'selection clearing remains keyed to search and sort changes');
  assert.doesNotMatch(caseSearch, /badgePrefs|showItemCode/);
  assert.doesNotMatch(packRender.slice(0, packRender.indexOf('const newDatasetKey')), /showLoadPlanNumber|showCustomerReference/,
    'Card Display visibility does not control search or sorting');

  assert.match(casesSource, /const allCases = CaseLibrary\.getCases\(\);/);
  assert.match(casesSource, /const hasLibraryCases = allCases\.length > 0;/);
  assert.match(casesSource, /'No cases yet'/);
  assert.match(casesSource, /'No matching cases'/);
  assert.match(packRender, /if \(!allPacks\.length\)/);
  assert.match(packRender, /if \(!packs\.length\)/);
});

test('BUSINESS-IDENTITY-SEARCH UX clear controls preserve focus, pagination, view state, and empty states', async () => {
  const [indexSource, casesSource, packsSource, cssSource] = await Promise.all([
    fs.readFile(INDEX_PATH, 'utf8'),
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
    fs.readFile(MAIN_CSS_PATH, 'utf8'),
  ]);

  assert.match(
    indexSource,
    /id="cases-search-clear"[\s\S]*?aria-label="Clear Cases search"[\s\S]*?hidden/
  );
  assert.match(
    indexSource,
    /id="packs-search-clear"[\s\S]*?aria-label="Clear Load Plans search"[\s\S]*?hidden/
  );
  assert.match(indexSource, /id="cases-search"[\s\S]*?aria-label="Search cases"/);
  assert.match(indexSource, /id="packs-search"[\s\S]*?aria-label="Search load plans"/);

  for (const [label, source, stateName] of [
    ['Cases', casesSource, 'casesListState'],
    ['Load Plans', packsSource, 'packsListState'],
  ]) {
    assert.match(source, /function updateSearchClearVisibility\(\)[\s\S]*searchClearEl\.hidden = searchEl\.value\.length === 0/,
      `${label} clear control is hidden only for an empty query`);
    assert.match(source, /return \(\) => \{[\s\S]*updateSearchClearVisibility\(\);[\s\S]*renderSearch\(\)/,
      `${label} updates clear visibility immediately while preserving debounced search rendering`);
    assert.match(source, /if \(ev\.key !== 'Escape'\) return;[\s\S]*ev\.preventDefault\(\);[\s\S]*ev\.stopPropagation\(\);[\s\S]*if \(searchEl\.value\) clearSearch\(\)/,
      `${label} Escape is contained and clears only a populated search`);
    assert.match(source, /searchClearEl\.addEventListener\('click', clearSearch\)/);

    const clearBlock = source.slice(
      source.indexOf('function clearSearch()'),
      source.indexOf('function clearSearch()') + 350
    );
    assert.match(clearBlock, /searchEl\.value = ''/);
    assert.match(clearBlock, new RegExp(`${stateName}\\.pageIndex = 0`));
    assert.match(clearBlock, /updateSearchClearVisibility\(\)/);
    assert.match(clearBlock, /render\(\)/);
    assert.match(clearBlock, /searchEl\.focus\(\)/,
      `${label} clear restores focus after the immediate render`);
    assert.doesNotMatch(clearBlock, /\.blur\(/);

    const setViewBlock = source.slice(source.indexOf('function setViewMode('), source.indexOf('function setViewMode(') + 400);
    assert.doesNotMatch(setViewBlock, /searchEl\.value\s*=/,
      `${label} Grid/List switching preserves the current query`);
  }

  assert.match(casesSource, /'No cases yet'/);
  assert.match(casesSource, /'No matching cases'/);
  assert.match(packsSource, /if \(!allPacks\.length\)/);
  assert.match(packsSource, /if \(!packs\.length\)/);
  assert.match(cssSource, /\.tp3d-search-clear\[hidden\]\s*\{[\s\S]*display: none/);
});

test('BUSINESS-IDENTITY-UI Load Plan secondary identity metadata uses the 12px shared styling hook', async () => {
  const [packsSource, cssSource] = await Promise.all([
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
    fs.readFile(MAIN_CSS_PATH, 'utf8'),
  ]);
  const identityMetadata = packsSource.slice(
    packsSource.indexOf('function appendPackListIdentityMetadata'),
    packsSource.indexOf('function createPackIdentityChips')
  );

  assert.equal(
    (identityMetadata.match(/className = 'muted tp3d-management-secondary-text'/g) || []).length,
    2,
    'Load Plan Number and Customer Reference share the narrow identity metadata hook'
  );
  assert.match(cssSource, /\.tp3d-management-secondary-text\s*\{[\s\S]*font-size:\s*12px;[\s\S]*line-height:\s*1\.45;/);
  assert.doesNotMatch(identityMetadata, /style\./, 'identity typography does not use inline styles');
});

test('BUSINESS-IDENTITY-UI management view switching stays atomic and Load Plan rows have no stats hover tooltip', async () => {
  const [casesSource, packsSource, uiSource] = await Promise.all([
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
    fs.readFile(UI_COMPONENTS_PATH, 'utf8'),
  ]);

  for (const [label, source, preference, fallback] of [
    ['Cases', casesSource, 'casesViewMode', 'list'],
    ['Load Plans', packsSource, 'packsViewMode', 'grid'],
  ]) {
    const setViewStart = source.indexOf('function setViewMode(mode)');
    const setViewBlock = source.slice(setViewStart, setViewStart + 900);
    const renderStart = source.indexOf('function render(modeOverride)');
    const renderBlock = source.slice(
      renderStart,
      source.indexOf('function resetWorkspaceState', renderStart)
    );

    assert.match(setViewBlock, /const nextMode = mode === '(?:list|grid)' \? '(?:list|grid)' : '(?:list|grid)'/);
    assert.match(setViewBlock, new RegExp(`prefs\\.${preference} = nextMode`));
    assert.match(setViewBlock, /updateViewButtons\(nextMode\)/);
    assert.match(setViewBlock, /render\(nextMode\)/,
      `${label} active button and renderer receive the same validated view mode`);
    if (label === 'Load Plans') {
      // Load Plans resolves its fallback through one canonical resolveViewMode()
      // helper rather than a fresh PreferencesManager re-read on every render —
      // see packs-screen.js's currentViewMode/resolveViewMode for why a fresh
      // re-read here was the root cause of Grid silently reverting to List.
      assert.match(
        renderBlock,
        /const mode = modeOverride === '(?:list|grid)' \|\| modeOverride === '(?:list|grid)'[\s\S]*\? modeOverride[\s\S]*: resolveViewMode\(\)/
      );
    } else {
      assert.match(
        renderBlock,
        new RegExp(`const mode = modeOverride === '(?:list|grid)' \\|\\| modeOverride === '(?:list|grid)'[\\s\\S]*\\? modeOverride[\\s\\S]*: PreferencesManager\\.get\\(\\)\\.${preference} \\|\\| '${fallback}'`)
      );
    }
  }

  const packRenderBlock = packsSource.slice(
    packsSource.indexOf('function render(modeOverride)'),
    packsSource.indexOf('function resetWorkspaceState')
  );
  const listBlock = packsSource.slice(
    packsSource.indexOf('function renderListView(packs)'),
    packsSource.indexOf('function applyListColumnVisibility')
  );

  assert.match(packRenderBlock, /if \(mode === 'list'\)[\s\S]*gridEl\.style\.display = 'none'[\s\S]*listEl\.style\.display = 'block'/);
  assert.match(packRenderBlock, /else \{[\s\S]*gridEl\.style\.display = 'grid'[\s\S]*listEl\.style\.display = 'none'/);

  assert.doesNotMatch(listBlock, /tdTitle\.setAttribute\('data-tooltip'/,
    'the Load Plan title cell no longer owns the unintended truck/stats tooltip');
  assert.doesNotMatch(packsSource, /function formatPackStats\(/,
    'the tooltip-only stats label generator is removed');
  assert.match(listBlock, /tr\.addEventListener\('click', \(\) => openPack\(pack\.id\)\)/,
    'removing the tooltip preserves row click behavior');

  assert.match(casesSource, /role: 'cases-sort'[\s\S]*menuSemantics: true/);
  assert.match(packsSource, /role: 'packs-sort'[\s\S]*menuSemantics: true/);
  assert.match(uiSource, /anchorEl\.setAttribute\('aria-haspopup', 'menu'\)/);
  assert.match(uiSource, /anchorEl\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(uiSource, /dropdown\.setAttribute\('role', 'menu'\)/);
  assert.match(uiSource, /btn\.setAttribute\('role', 'menuitem'\)/);
  assert.match(uiSource, /dropdownSemanticAnchorEl\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(uiSource, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]\.includes\(ev\.key\)/,
    'Sort menus support standard keyboard movement');
  assert.match(uiSource, /item\.onClick && item\.onClick\(\);[\s\S]*if \(manageTriggerState && anchorEl[\s\S]*anchorEl\.focus\(\)/,
    'keyboard selection returns focus to the Sort control');
});

test('BUSINESS-IDENTITY-UI compact toolbar dropdowns share one close coordinator', async () => {
  const [indexSource, casesSource, packsSource, uiSource, cssSource] = await Promise.all([
    fs.readFile(INDEX_PATH, 'utf8'),
    fs.readFile(CASES_SCREEN_PATH, 'utf8'),
    fs.readFile(PACKS_SCREEN_PATH, 'utf8'),
    fs.readFile(UI_COMPONENTS_PATH, 'utf8'),
    fs.readFile(MAIN_CSS_PATH, 'utf8'),
  ]);

  assert.match(uiSource, /const shouldToggleClosed = options\.toggle === true && Boolean\(existing\)/);
  assert.match(uiSource, /registeredDropdownSurfaces\.forEach\(surface =>/);
  assert.match(uiSource, /function registerDropdownSurface\(surface\)/);
  assert.match(uiSource, /if \(ev\.key !== 'Escape'\) return;[\s\S]*closeAllDropdowns\(\);[\s\S]*focusTarget\.focus\(\)/);
  assert.match(uiSource, /if \(dropdownSemanticAnchorEl\) dropdownSemanticAnchorEl\.setAttribute\('aria-expanded', 'false'\)/,
    'closing any managed toolbar menu clears the previous trigger state');

  for (const source of [casesSource, packsSource]) {
    assert.match(source, /UIComponents\.registerDropdownSurface\(\{/);
    assert.match(source, /UIComponents\.closeAllDropdowns\(\);[\s\S]*const prefs = PreferencesManager\.get\(\)/,
      'Grid/List switching closes an active toolbar popover before rendering the other view');
    assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(changes, 'currentScreen'\)[\s\S]*UIComponents\.closeAllDropdowns\(\)/,
      'screen changes close stale toolbar popovers');
    assert.match(source, /role: '(?:cases|packs)-sort'[\s\S]*dropdownClass: 'tp3d-dropdown-sort'[\s\S]*toggle: true/);
    assert.match(source, /width: 208,[\s\S]*role: '(?:cases|packs)-sort'/);
  }
  assert.match(packsSource, /role: 'trailer-presets'[\s\S]*menuSemantics: true,[\s\S]*toggle: true/);
  assert.match(casesSource, /role: 'categories'[\s\S]*menuSemantics: true/);
  assert.match(packsSource, /role: FOLDERS_DROPDOWN_ROLE[\s\S]*menuSemantics: true/);
  assert.match(indexSource, /id="cases-filters-toggle"[^>]*aria-haspopup="true"[^>]*aria-expanded="false"/);
  assert.match(indexSource, /id="packs-filters-toggle"[^>]*aria-haspopup="true"[^>]*aria-expanded="false"/);
  assert.match(cssSource, /\.tp3d-dropdown-sort \.dropdown-menu,[\s\S]*\.tp3d-dropdown-card-display \.dropdown-menu/);
  assert.match(cssSource, /\.tp3d-dropdown-sort \.dropdown-item,[\s\S]*white-space: nowrap/);
});

test('BUSINESS-IDENTITY-UI dropdown coordinator closes registered surfaces and restores Escape focus', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const listeners = new Map();
  let firstOpen = true;
  let secondOpen = false;
  let firstCloseCount = 0;
  let secondCloseCount = 0;
  let focusCount = 0;
  try {
    globalThis.document = {
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      },
    };
    globalThis.window = {
      clearTimeout() {},
      removeEventListener() {},
    };
    const ui = createUIComponents();
    ui.registerDropdownSurface({
      isOpen: () => firstOpen,
      close: () => {
        firstOpen = false;
        firstCloseCount += 1;
      },
      getAnchor: () => ({ focus: () => { focusCount += 1; } }),
    });
    ui.registerDropdownSurface({
      isOpen: () => secondOpen,
      close: () => {
        secondOpen = false;
        secondCloseCount += 1;
      },
    });

    ui.closeAllDropdowns();
    assert.equal(firstCloseCount, 1);
    assert.equal(secondCloseCount, 0);

    firstOpen = true;
    const escape = listeners.get('keydown');
    let prevented = false;
    let stopped = false;
    escape({
      key: 'Escape',
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
    });
    assert.equal(firstCloseCount, 2);
    assert.equal(focusCount, 1);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('BUSINESS-IDENTITY-UI Trailer Presets derive exactly one named or Custom selection from truck state', async () => {
  const presets = TrailerPresets.getAll();
  presets.forEach(preset => {
    assert.equal(findMatchingTrailerPreset({ ...preset.truck }, presets)?.id, preset.id);
  });
  assert.equal(
    findMatchingTrailerPreset({ length: 636, width: 102, height: 110, shapeMode: 'wheelWells' }, presets)?.id,
    '53ft_dry_van_us_wheel_wells',
    'shape mode participates in preset matching'
  );
  assert.equal(
    findMatchingTrailerPreset({ length: 635, width: 102, height: 110, shapeMode: 'rect' }, presets),
    null,
    'non-preset dimensions produce Custom status'
  );
  assert.equal(findMatchingTrailerPreset(null, presets), null);

  const packsSource = await fs.readFile(PACKS_SCREEN_PATH, 'utf8');
  const trailerMenu = packsSource.slice(
    packsSource.indexOf('function openTrailerPresetsMenu'),
    packsSource.indexOf('function toggleFiltersVisible')
  );
  assert.match(trailerMenu, /const matchingPreset = findMatchingTrailerPreset\(pack\.truck, presets\)/);
  assert.match(trailerMenu, /if \(!matchingPreset\)[\s\S]*label: 'Custom'[\s\S]*active: true[\s\S]*status: true[\s\S]*rightIcon: 'fa-solid fa-check'/);
  assert.match(trailerMenu, /const isActive = Boolean\(matchingPreset && matchingPreset\.id === p\.id\)/);
  assert.match(trailerMenu, /active: isActive,[\s\S]*rightIcon: isActive \? 'fa-solid fa-check' : ''/);
  assert.match(trailerMenu, /selected\.length === 0[\s\S]*Select a load plan first/);
  assert.match(trailerMenu, /selected\.length === 1/);
  assert.doesNotMatch(trailerMenu, /selectedPreset|presetId\s*=/,
    'selected state is derived without adding stored preset identity');
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
