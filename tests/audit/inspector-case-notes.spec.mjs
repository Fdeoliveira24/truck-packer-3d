import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Inspector per-case Standard Instructions (Case.notes).
//
// Standard Instructions are a Case-template field (like Category and the
// other handling-rule metadata already on a Case), so the data-layer
// coverage below exercises the single shared normalizer (cargo-canonical.js)
// and the canonical update path (CaseLibrary.upsert) that the Cases-screen
// Case editor (case-modal.js) uses. Per the locked Cargo Instructions
// architecture (docs/engineering/cargo-instructions-ownership-contract.md),
// the Inspector renders Standard Instructions as an always-visible,
// read-only section — it is never editable from the Editor.
//
// editor-screen.js renders through Three.js/DOM and has no jsdom harness in
// this suite, so — matching the existing convention in
// security-and-invariants.spec.mjs — its Inspector wiring is verified with
// source-contract assertions against the extracted function block rather than
// executing the UI.

const cargoCanonicalUrl = new URL('../../src/core/cargo-canonical.js', import.meta.url);
const caseModelUrl = new URL('../../src/data/models/case.model.js', import.meta.url);
const normalizerUrl = new URL('../../src/core/normalizer.js', import.meta.url);
const stateStoreUrl = new URL('../../src/core/state-store.js', import.meta.url);
const caseLibraryUrl = new URL('../../src/services/case-library.js', import.meta.url);
const packLibraryUrl = new URL('../../src/services/pack-library.js', import.meta.url);
const importExportUrl = new URL('../../src/services/import-export.js', import.meta.url);
const autopackEngineUrl = new URL('../../src/services/autopack-engine.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);

function baseCase(overrides = {}) {
  return {
    id: 'case-notes-1',
    name: 'Notes Test Case',
    dimensions: { length: 10, width: 10, height: 10 },
    weight: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// cargo-canonical.js: single source of truth for the notes normalization rule
// ---------------------------------------------------------------------------

test('parseCargoNotes preserves a trimmed non-empty string', async () => {
  const { parseCargoNotes } = await import(cargoCanonicalUrl.href);
  assert.equal(parseCargoNotes('  Fragile, handle with care  '), 'Fragile, handle with care');
});

test('parseCargoNotes normalizes empty, whitespace-only, and non-string input to null', async () => {
  const { parseCargoNotes } = await import(cargoCanonicalUrl.href);
  assert.equal(parseCargoNotes(''), null);
  assert.equal(parseCargoNotes('   \n\t  '), null);
  assert.equal(parseCargoNotes(null), null);
  assert.equal(parseCargoNotes(undefined), null);
  assert.equal(parseCargoNotes(42), null);
  assert.equal(parseCargoNotes({ toString: () => 'x' }), null);
  assert.equal(parseCargoNotes(['x']), null);
});

// ---------------------------------------------------------------------------
// Model-level normalization (both normalizeCase implementations route through
// the same canonicalCargoForStorage(), so a raw case object gets the same
// notes value everywhere it is normalized).
// ---------------------------------------------------------------------------

test('data/models/case.model.js normalizeCase stores notes as string-or-null', async () => {
  const { normalizeCase } = await import(caseModelUrl.href);
  assert.equal(normalizeCase(baseCase({ notes: '  Ships upright only  ' })).notes, 'Ships upright only');
  assert.equal(normalizeCase(baseCase({ notes: '   ' })).notes, null);
  assert.equal(normalizeCase(baseCase({ notes: '' })).notes, null);
  assert.equal(normalizeCase(baseCase({})).notes, null);
  assert.equal(normalizeCase(baseCase({ notes: 7 })).notes, null);
});

test('core/normalizer.js normalizeCase stores notes as string-or-null (parity with the model normalizer)', async () => {
  const Normalizer = await import(normalizerUrl.href);
  const now = Date.now();
  assert.equal(Normalizer.normalizeCase(baseCase({ notes: '  Ships upright only  ' }), now).notes, 'Ships upright only');
  assert.equal(Normalizer.normalizeCase(baseCase({ notes: '   ' }), now).notes, null);
  assert.equal(Normalizer.normalizeCase(baseCase({}), now).notes, null);
  assert.equal(Normalizer.normalizeCase(baseCase({ notes: 7 }), now).notes, null);
});

// ---------------------------------------------------------------------------
// CaseLibrary.upsert is the canonical update path the Inspector Notes modal's
// Save button calls (mirroring the existing Set Category action's use of the
// same path). It must normalize exactly like the model normalizers.
// ---------------------------------------------------------------------------

test('CaseLibrary.upsert normalizes notes: trims real text, clears whitespace-only to null', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });

  CaseLibrary.upsert(baseCase({ notes: '  Keep flat, do not stack  ' }));
  assert.equal(CaseLibrary.getById('case-notes-1').notes, 'Keep flat, do not stack');

  CaseLibrary.upsert({ ...CaseLibrary.getById('case-notes-1'), notes: '   ' });
  assert.equal(CaseLibrary.getById('case-notes-1').notes, null, 'saving whitespace-only must clear the note (Empty state)');
});

test('CaseLibrary.upsert notes changes participate in StateStore undo/redo', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  StateStore.init({ caseLibrary: [baseCase({ notes: 'Original note' })], packLibrary: [], folderLibrary: [], preferences: {} });

  CaseLibrary.upsert({ ...CaseLibrary.getById('case-notes-1'), notes: 'Updated note' });
  assert.equal(CaseLibrary.getById('case-notes-1').notes, 'Updated note');

  StateStore.undo();
  assert.equal(CaseLibrary.getById('case-notes-1').notes, 'Original note',
    'Notes are stored on caseLibrary, which is already a significant/undoable state key — no new history plumbing is needed');
});

// ---------------------------------------------------------------------------
// Duplication: the Inspector's Duplicate action clones the pack *instance*
// only (same caseId), never the case template, so a duplicated instance
// resolves to the exact same case — and therefore the exact same note —
// without any dedicated copy step.
// ---------------------------------------------------------------------------

test('duplicating a selected instance preserves caseId, so the duplicate resolves to the same notes', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const noted = baseCase({ notes: 'Handle with two people' });
  const instance = {
    id: 'inst-1',
    caseId: noted.id,
    transform: {
      position: { x: 20, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: 'packed',
  };
  const pack = {
    id: 'pack-1',
    title: 'Notes Pack',
    truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' },
    cases: [instance],
  };
  StateStore.init({ caseLibrary: [noted], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const result = PackLibrary.duplicateInstancesSafely(pack.id, [instance], [noted]);
  assert.ok(result && result.newIds.length === 1, 'expected exactly one duplicated instance');
  const duplicatedInstance = result.pack.cases.find(i => i.id === result.newIds[0]);
  assert.equal(duplicatedInstance.caseId, noted.id, 'duplicate must reference the same case template, not a clone');
  assert.equal(CaseLibrary.getById(duplicatedInstance.caseId).notes, 'Handle with two people');
});

test('two Pack instances referencing the same Case resolve the current Standard Instructions live, with no per-instance snapshot', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  const noted = baseCase({ notes: 'Original instructions' });
  const instA = {
    id: 'inst-a',
    caseId: noted.id,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    hidden: false,
    groupId: null,
    placement: 'packed',
  };
  const instB = {
    id: 'inst-b',
    caseId: noted.id,
    transform: { position: { x: 20, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    hidden: false,
    groupId: null,
    placement: 'packed',
  };
  const pack = {
    id: 'pack-two',
    title: 'Two Instance Pack',
    truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' },
    cases: [instA, instB],
  };
  StateStore.init({ caseLibrary: [noted], packLibrary: [pack], folderLibrary: [], preferences: {} });

  // Neither instance stores a copy of notes — both resolve via caseId.
  assert.equal(instA.notes, undefined);
  assert.equal(instB.notes, undefined);
  assert.equal(CaseLibrary.getById(instA.caseId).notes, 'Original instructions');
  assert.equal(CaseLibrary.getById(instB.caseId).notes, 'Original instructions');

  CaseLibrary.upsert({ ...CaseLibrary.getById(noted.id), notes: 'Updated instructions' });

  assert.equal(CaseLibrary.getById(instA.caseId).notes, 'Updated instructions',
    'instance A must resolve the updated Case value on next lookup, with no reconciliation step needed');
  assert.equal(CaseLibrary.getById(instB.caseId).notes, 'Updated instructions',
    'instance B must resolve the same updated Case value independently');
});

// ---------------------------------------------------------------------------
// Import/export persistence
// ---------------------------------------------------------------------------

test('importCaseRows normalizes imported notes to string-or-null', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const ImportExport = await import(importExportUrl.href);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });

  const { nextCaseLibrary } = ImportExport.importCaseRows([
    { name: 'With note', length: 10, width: 10, height: 10, weight: 5, notes: '  Fragile  ' },
    { name: 'Whitespace note', length: 10, width: 10, height: 10, weight: 5, notes: '   ' },
    { name: 'No note field', length: 10, width: 10, height: 10, weight: 5 },
  ]);

  assert.equal(nextCaseLibrary.find(c => c.name === 'With note').notes, 'Fragile');
  assert.equal(nextCaseLibrary.find(c => c.name === 'Whitespace note').notes, null);
  assert.equal(nextCaseLibrary.find(c => c.name === 'No note field').notes, null);
});

test('a case note survives pack, pack-batch, app, and workspace JSON export/import round trips', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const ImportExport = await import(importExportUrl.href);
  const noted = baseCase({ notes: 'Round trip note' });
  const instance = {
    id: 'inst-rt',
    caseId: noted.id,
    transform: {
      position: { x: 20, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: 'packed',
  };
  const pack = {
    id: 'pack-rt',
    title: 'Round Trip Pack',
    truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' },
    cases: [instance],
  };
  StateStore.init({ caseLibrary: [noted], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const packPayload = ImportExport.parsePackImportJSON(ImportExport.buildPackExportJSON(pack));
  assert.equal(packPayload.bundledCases[0].notes, 'Round trip note');

  const batchPayload = ImportExport.parsePackBatchImportJSON(JSON.stringify({
    exportType: 'pack-batch',
    packs: [{ pack, bundledCases: [noted] }],
  }));
  assert.equal(batchPayload[0].bundledCases[0].notes, 'Round trip note');

  const restoredApp = ImportExport.parseAppImportJSON(ImportExport.buildAppExportJSON());
  assert.equal(restoredApp.caseLibrary.find(c => c.id === noted.id).notes, 'Round trip note');

  const restoredWorkspace = ImportExport.parseWorkspaceImportJSON(
    ImportExport.buildWorkspaceExportJSON('QA Workspace')
  );
  assert.equal(restoredWorkspace.caseLibrary.find(c => c.id === noted.id).notes, 'Round trip note');
});

test('a null (empty) case note survives the same JSON export/import round trips without becoming a literal string', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const ImportExport = await import(importExportUrl.href);
  const unnoted = baseCase({ notes: null });
  StateStore.init({ caseLibrary: [unnoted], packLibrary: [], folderLibrary: [], preferences: {} });

  const restoredApp = ImportExport.parseAppImportJSON(ImportExport.buildAppExportJSON());
  assert.equal(restoredApp.caseLibrary.find(c => c.id === unnoted.id).notes, null);
});

// ---------------------------------------------------------------------------
// Cases-screen and Inspector must edit the identical Case Library field: both
// ultimately call CaseLibrary.upsert() on the same case id, so a value written
// through one path is immediately visible through the other. No duplicate
// notes property exists, and no packed-instance note was introduced.
// ---------------------------------------------------------------------------

test('a note saved via the Cases-screen case-modal.js payload shape is visible to the Inspector\'s read-only render', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  StateStore.init({ caseLibrary: [baseCase({})], packLibrary: [], folderLibrary: [], preferences: {} });

  // case-modal.js's Save handler spreads its full form payload (including a
  // trimmed `notes` string) into CaseLibrary.upsert — simulate that shape.
  const casesScreenPayload = { ...CaseLibrary.getById('case-notes-1'), notes: String('  From Cases screen  ').trim() };
  CaseLibrary.upsert(casesScreenPayload);
  assert.equal(CaseLibrary.getById('case-notes-1').notes, 'From Cases screen',
    'a Cases-screen edit must be readable as the Inspector reads it: CaseLibrary.getById(caseId).notes');
});

test('data/models/case.model.js normalizeCase keeps notes and hazmatClass on the same string-or-null convention (no divergent representation introduced)', async () => {
  const { normalizeCase } = await import(caseModelUrl.href);
  const withBoth = normalizeCase(baseCase({ notes: '', hazmatClass: '' }));
  assert.equal(withBoth.notes, null);
  assert.equal(withBoth.hazmatClass, null,
    'hazmatClass already used null-for-empty before this feature; notes now matches its existing sibling, not a newly invented rule');
});

// ---------------------------------------------------------------------------
// editor-screen.js source-contract checks (no jsdom harness for this module;
// same style as the existing editor-screen coverage in
// security-and-invariants.spec.mjs).
// ---------------------------------------------------------------------------

function extractFunctionBlock(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) return '';
  const end = src.indexOf('\n    }', start);
  return end > start ? src.slice(start, end) : '';
}

// extractStandardInstructionsBlock isolates just the read-only Standard
// Instructions section within renderSingleInspector, so assertions about "no
// Save/Edit/Add action here" aren't accidentally satisfied by unrelated
// Inspector actions (e.g. Set Category) elsewhere in the same function.
function extractStandardInstructionsBlock(singleBlock) {
  const start = singleBlock.indexOf('// Standard Instructions:');
  if (start < 0) return '';
  const end = singleBlock.indexOf('inspectorEl.appendChild(card);', start);
  return end > start ? singleBlock.slice(start, end) : '';
}

test('editor-screen no longer defines a Notes-editing modal (openCaseNotesModal removed)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.doesNotMatch(src, /openCaseNotesModal/, 'the prototype Inspector Notes modal must be fully removed in favor of the read-only Standard Instructions card');
});

test('renderSingleInspector renders an always-visible, read-only Standard Instructions section in the top summary card', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  assert.ok(singleBlock.length > 0, 'editor-screen must define renderSingleInspector(pack, inst, caseData, prefs)');

  const transformMarkerIdx = singleBlock.indexOf('=== Transform Card');
  const summaryCardBlock = transformMarkerIdx > 0 ? singleBlock.slice(0, transformMarkerIdx) : singleBlock;
  const actionsMarkerIdx = singleBlock.indexOf('=== Actions Card');
  const actionsCardBlock = actionsMarkerIdx > 0 ? singleBlock.slice(actionsMarkerIdx) : '';

  assert.match(summaryCardBlock, /'Standard Instructions'/, 'the top summary card must render the Standard Instructions heading');
  assert.match(summaryCardBlock, /'Applies to every unit of this Case\.'/, 'the ownership description must be present');
  assert.match(summaryCardBlock, /'No standard instructions\.'/, 'the empty state copy must be present');
  assert.doesNotMatch(actionsCardBlock, /Standard Instructions/, 'Standard Instructions must not appear in the Actions card');

  const multiBlock = extractFunctionBlock(src, 'function renderMultiInspector(pack, selected)');
  assert.doesNotMatch(multiBlock, /Standard Instructions/, 'multi-selection Inspector must not render Standard Instructions');

  const unresolvedBlock = extractFunctionBlock(src, 'function renderUnresolvedCaseInspector(pack, inst)');
  assert.doesNotMatch(unresolvedBlock, /Standard Instructions/, 'an unresolved (missing case) selection must not render Standard Instructions');
});

test('the Standard Instructions section is non-interactive: no modal, no textarea, no Add/Edit/Save/Cancel action, no CaseLibrary mutation', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  const block = extractStandardInstructionsBlock(singleBlock);
  assert.ok(block.length > 0, 'must be able to isolate the Standard Instructions block');

  assert.doesNotMatch(block, /UIComponents\.showModal/, 'must not open a modal');
  assert.doesNotMatch(block, /createElement\('textarea'\)/, 'must not contain a textarea');
  assert.doesNotMatch(block, /label: 'Add/, 'must not offer an Add action');
  assert.doesNotMatch(block, /label: 'Edit'/, 'must not offer an Edit action');
  assert.doesNotMatch(block, /label: 'Save'/, 'must not offer a Save action');
  assert.doesNotMatch(block, /label: 'Cancel'/, 'must not offer a Cancel action');
  assert.doesNotMatch(block, /label: 'Clear'/, 'must not offer a Clear action');
  assert.doesNotMatch(block, /CaseLibrary\.upsert/, 'must never mutate CaseLibrary from the Inspector');
  assert.doesNotMatch(block, /PackLibrary\./, 'must never mutate the Pack or Pack instance');
  assert.doesNotMatch(block, /addEventListener\('click'/, 'must not attach a click handler (not interactive)');
});

test('the Standard Instructions value is rendered with safe plain-text assignment, never innerHTML', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  const block = extractStandardInstructionsBlock(singleBlock);

  assert.match(block, /instructionsValue\.textContent = note;/, 'the populated value must be assigned via textContent, not innerHTML');
  assert.doesNotMatch(block, /instructionsValue\.innerHTML/, 'the Standard Instructions value must never be assigned via innerHTML');
  assert.match(block, /tp3d-case-notes-read/, 'the populated value must reuse the existing line-break-preserving read-only class');
});

// ---------------------------------------------------------------------------
// Phase 2 — Item Notes (Pack-instance-owned instanceNotes).
//
// Item Notes describe one specific placed unit in one specific Pack — unlike
// Standard Instructions, this remains genuinely editable from the Inspector,
// so it keeps the proven Empty/Read/Edit modal pattern (formerly used for
// Standard Instructions), retargeted at PackLibrary.updateInstance instead
// of CaseLibrary.upsert. See
// docs/engineering/cargo-instructions-ownership-contract.md.
// ---------------------------------------------------------------------------

function baseInstance(caseId, overrides = {}) {
  return {
    id: 'inst-notes-1',
    caseId,
    transform: {
      position: { x: 20, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: 'packed',
    ...overrides,
  };
}

test('core/normalizer.js normalizeInstance stores instanceNotes as string-or-null', async () => {
  const Normalizer = await import(normalizerUrl.href);
  const caseMap = new Map();
  assert.equal(Normalizer.normalizeInstance(baseInstance('case-x', { instanceNotes: '  Dented corner  ' }), caseMap).instanceNotes, 'Dented corner');
  assert.equal(Normalizer.normalizeInstance(baseInstance('case-x', { instanceNotes: '   ' }), caseMap).instanceNotes, null);
  assert.equal(Normalizer.normalizeInstance(baseInstance('case-x', {}), caseMap).instanceNotes, null,
    'legacy instances with no instanceNotes field must normalize safely to null');
  assert.equal(Normalizer.normalizeInstance(baseInstance('case-x', { instanceNotes: 7 }), caseMap).instanceNotes, null);
  const multiline = 'Line one\nLine two';
  assert.equal(Normalizer.normalizeInstance(baseInstance('case-x', { instanceNotes: multiline }), caseMap).instanceNotes, multiline,
    'internal line breaks must be preserved');
});

test('PackLibrary.updateInstance saves instanceNotes on only the targeted instance, leaving the Case, Pack Notes, and sibling instances untouched', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({ notes: 'Case-level instructions' });
  const instA = baseInstance(c.id, { id: 'inst-a' });
  const instB = baseInstance(c.id, {
    id: 'inst-b',
    transform: { position: { x: 40, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  const pack = {
    id: 'pack-item-notes',
    title: 'Item Notes Pack',
    notes: 'Pack-level notes',
    truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' },
    cases: [instA, instB],
  };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  PackLibrary.updateInstance(pack.id, instA.id, { instanceNotes: 'Arrived with a dent' });
  const afterSave = PackLibrary.getById(pack.id);
  assert.equal(afterSave.cases.find(i => i.id === instA.id).instanceNotes, 'Arrived with a dent');
  assert.equal(afterSave.cases.find(i => i.id === instB.id).instanceNotes, undefined, 'the sibling instance must be untouched');
  assert.equal(afterSave.notes, 'Pack-level notes', 'Pack Notes must be untouched');
  assert.equal(CaseLibrary.getById(c.id).notes, 'Case-level instructions', 'Standard Instructions must be untouched');

  PackLibrary.updateInstance(pack.id, instA.id, { instanceNotes: null });
  assert.equal(PackLibrary.getById(pack.id).cases.find(i => i.id === instA.id).instanceNotes, null, 'clearing must save null');
});

test('PackLibrary.updateInstance instanceNotes changes participate in StateStore undo/redo as a single history step', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({});
  const inst = baseInstance(c.id, { instanceNotes: 'Original item note' });
  const pack = { id: 'pack-undo-notes', title: 'Undo Pack', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  PackLibrary.updateInstance(pack.id, inst.id, { instanceNotes: 'Updated item note' });
  assert.equal(PackLibrary.getById(pack.id).cases[0].instanceNotes, 'Updated item note');

  StateStore.undo();
  assert.equal(PackLibrary.getById(pack.id).cases[0].instanceNotes, 'Original item note',
    'packLibrary is already a significant/undoable state key — no new history plumbing is needed');

  StateStore.redo();
  assert.equal(PackLibrary.getById(pack.id).cases[0].instanceNotes, 'Updated item note');
});

test('two instances of the same Case can hold independent instanceNotes while still resolving the identical Standard Instructions', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({ notes: 'Shared Standard Instructions' });
  const instA = baseInstance(c.id, { id: 'inst-own-a' });
  const instB = baseInstance(c.id, {
    id: 'inst-own-b',
    transform: { position: { x: 40, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  const pack = { id: 'pack-own', title: 'Ownership Pack', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [instA, instB] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  PackLibrary.updateInstance(pack.id, instA.id, { instanceNotes: 'Item A: handle with care' });
  PackLibrary.updateInstance(pack.id, instB.id, { instanceNotes: 'Item B: repackaged in field' });

  const after = PackLibrary.getById(pack.id);
  assert.equal(after.cases.find(i => i.id === instA.id).instanceNotes, 'Item A: handle with care');
  assert.equal(after.cases.find(i => i.id === instB.id).instanceNotes, 'Item B: repackaged in field');
  assert.equal(CaseLibrary.getById(c.id).notes, 'Shared Standard Instructions', 'editing Item Notes must never mutate case.notes');
});

test('duplicating the whole Pack preserves Item Notes on every cloned instance', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({});
  const inst = baseInstance(c.id, { instanceNotes: 'Preserve me across Pack duplication' });
  const pack = { id: 'pack-dup-whole', title: 'Whole Pack Dup', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const copy = PackLibrary.duplicate(pack.id);
  assert.ok(copy && copy.id !== pack.id);
  assert.equal(copy.cases[0].instanceNotes, 'Preserve me across Pack duplication');
});

test('duplicating a single instance in the Editor starts the new instance with no Item Notes (does not copy the source instance\'s instanceNotes)', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({});
  const inst = baseInstance(c.id, { instanceNotes: 'Only true of the original unit' });
  const pack = { id: 'pack-dup-inst', title: 'Instance Dup', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const result = PackLibrary.duplicateInstancesSafely(pack.id, [inst], [c]);
  assert.ok(result && result.newIds.length === 1);
  const dup = result.pack.cases.find(i => i.id === result.newIds[0]);
  assert.equal(dup.instanceNotes, null, 'a freshly duplicated instance must not inherit the source instanceNotes');

  const original = result.pack.cases.find(i => i.id === inst.id);
  assert.equal(original.instanceNotes, 'Only true of the original unit', 'the original instance must be unaffected by the duplicate');
});

test('AutoPack repacking (buildAutoPackNextCases) preserves instanceNotes on a repositioned, non-hidden instance', async () => {
  const AutoPackEngine = await import(autopackEngineUrl.href);
  const inst = {
    id: 'inst-ap',
    caseId: 'case-ap',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    hidden: false,
    placement: 'staged',
    instanceNotes: 'Fragile top',
  };
  const placements = new Map([[inst.id, { x: 10, y: 5, z: 0 }]]);
  const rotations = new Map([[inst.id, { x: 0, y: 0, z: 0 }]]);
  const [next] = AutoPackEngine.buildAutoPackNextCases([inst], placements, rotations, new Map(), new Map());
  assert.equal(next.instanceNotes, 'Fragile top');
  assert.equal(next.placement, 'packed');
});

test('Truck Change reconciliation (reconcilePlacementsForTruck / canonical pose) preserves instanceNotes', async () => {
  const PackLibrary = await import(packLibraryUrl.href);
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
  const c = { id: 'case-recon', name: 'Recon Case', dimensions: { length: 10, width: 10, height: 10 }, weight: 10, category: 'Default' };
  const inst = {
    id: 'inst-recon',
    caseId: c.id,
    transform: { position: { x: 20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    hidden: false,
    groupId: null,
    placement: 'packed',
    instanceNotes: 'Preserve through reconciliation',
  };
  const pack = { id: 'pack-recon', truck, cases: [inst] };

  const result = PackLibrary.reconcilePlacementsForTruck(pack, truck, [c]);
  const reconciled = result.nextPack.cases.find(i => i.id === inst.id);
  assert.equal(reconciled.instanceNotes, 'Preserve through reconciliation');
});

test('toggling instance visibility or transform via PackLibrary.updateInstance preserves an unrelated instanceNotes value', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({});
  const inst = baseInstance(c.id, { instanceNotes: 'Survive a visibility toggle' });
  const pack = { id: 'pack-hidden-notes', title: 'Hidden Toggle Pack', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  PackLibrary.updateInstance(pack.id, inst.id, { hidden: true });
  assert.equal(PackLibrary.getById(pack.id).cases[0].instanceNotes, 'Survive a visibility toggle');

  PackLibrary.updateInstance(pack.id, inst.id, {
    transform: { position: { x: 60, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  assert.equal(PackLibrary.getById(pack.id).cases[0].instanceNotes, 'Survive a visibility toggle',
    'a position/rotation update must not disturb an unrelated field');
});

test('instanceNotes survives Pack, app, and workspace JSON export/import round trips, and legacy instances with no field remain valid', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const ImportExport = await import(importExportUrl.href);
  const c = baseCase({});
  const noted = baseInstance(c.id, { id: 'inst-rt-notes', instanceNotes: 'Round trip item note' });
  const legacy = baseInstance(c.id, {
    id: 'inst-rt-legacy',
    transform: { position: { x: 60, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  });
  const pack = {
    id: 'pack-rt-notes',
    title: 'Item Notes Round Trip',
    truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' },
    cases: [noted, legacy],
  };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const packPayload = ImportExport.parsePackImportJSON(ImportExport.buildPackExportJSON(pack));
  const notedOut = packPayload.pack.cases.find(i => i.id === noted.id);
  const legacyOut = packPayload.pack.cases.find(i => i.id === legacy.id);
  assert.equal(notedOut.instanceNotes, 'Round trip item note');
  assert.equal(legacyOut.instanceNotes ?? null, null, 'a legacy instance with no instanceNotes field must import safely');

  const restoredApp = ImportExport.parseAppImportJSON(ImportExport.buildAppExportJSON());
  const appPack = restoredApp.packLibrary.find(p => p.id === pack.id);
  assert.equal(appPack.cases.find(i => i.id === noted.id).instanceNotes, 'Round trip item note');

  const restoredWorkspace = ImportExport.parseWorkspaceImportJSON(ImportExport.buildWorkspaceExportJSON('QA Workspace'));
  const wsPack = restoredWorkspace.packLibrary.find(p => p.id === pack.id);
  assert.equal(wsPack.cases.find(i => i.id === noted.id).instanceNotes, 'Round trip item note');
});

// ---------------------------------------------------------------------------
// editor-screen.js source-contract checks for openInstanceNotesModal.
// ---------------------------------------------------------------------------

test('editor-screen defines openInstanceNotesModal(pack, inst) and captures packId + instanceId before any modal opens', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openInstanceNotesModal(pack, inst)');
  assert.ok(block.length > 0, 'editor-screen must define openInstanceNotesModal(pack, inst)');

  const packIdCaptureIdx = block.indexOf('const packId = pack.id;');
  const instanceIdCaptureIdx = block.indexOf('const instanceId = inst.id;');
  assert.ok(packIdCaptureIdx >= 0 && instanceIdCaptureIdx >= 0, 'packId and instanceId must both be captured once from the passed-in pack/inst');
  const firstModalCallIdx = block.indexOf('UIComponents.showModal');
  assert.ok(packIdCaptureIdx < firstModalCallIdx && instanceIdCaptureIdx < firstModalCallIdx,
    'packId and instanceId must be captured before any modal is opened');
});

test('openInstanceNotesModal Save writes through PackLibrary.updateInstance (the canonical Pack-instance update path), never CaseLibrary, TruckChangeController, or manual revalidation', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openInstanceNotesModal(pack, inst)');
  assert.match(block, /PackLibrary\.updateInstance\(packId, instanceId, \{ instanceNotes: trimmed \|\| null \}\)/,
    'Save must call PackLibrary.updateInstance with the captured packId/instanceId and a trimmed, null-on-empty value');
  assert.doesNotMatch(block, /CaseLibrary\.upsert/, 'Item Notes must never write through CaseLibrary — it is not Case-owned');
  assert.doesNotMatch(block, /TruckChangeController/, 'Item Notes must not go through the Truck Change controller');
  assert.doesNotMatch(block, /updateCasesWithManualRevalidation/, 'a plain text field must not trigger geometry/placement revalidation');
});

test('openInstanceNotesModal fails safely when the captured Pack/instance no longer exists, and Save failure preserves the draft instead of closing', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openInstanceNotesModal(pack, inst)');
  const guardCount = (block.match(/resolveInstance\(\)/g) || []).length;
  assert.ok(guardCount >= 2, 'both the state-resolve path and the Save handler must re-check resolveInstance() before acting');
  assert.match(block, /PackLibrary\.getById\(packId\)/, 'resolveInstance must re-resolve the Pack via packId, never trust a stale pack reference');
  assert.match(block, /currentPack\.cases \|\| \[\]\)\.find\(i => i\.id === instanceId\)/, 'resolveInstance must re-resolve the instance via instanceId');
  assert.match(block, /This item no longer exists\./, 'a missing Pack or instance must surface a clear error instead of silently updating the wrong item');

  const saveHandlerStart = block.indexOf("label: 'Save'");
  const saveHandlerBlock = block.slice(saveHandlerStart, block.indexOf('},', saveHandlerStart));
  assert.match(saveHandlerBlock, /if \(!resolveInstance\(\)\) \{[\s\S]*?return false;/,
    'Save failure (missing Pack/instance) must return false so showModal does NOT close — the draft and edit state are preserved');
});

test('openInstanceNotesModal reuses UIComponents.showModal for all three states via a locally Escape-scoped wrapper (no bespoke modal markup, no shared-primitive change)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openInstanceNotesModal(pack, inst)');
  const showModalCalls = (block.match(/UIComponents\.showModal\(/g) || []).length;
  assert.equal(showModalCalls, 1, 'only the local showNotesModal wrapper should call UIComponents.showModal directly');
  const showNotesModalCalls = (block.match(/(?<!function )showNotesModal\(\{/g) || []).length;
  assert.equal(showNotesModalCalls, 3, 'Empty, Read, and Edit states must each render through the local showNotesModal wrapper');

  assert.match(block, /No notes for this item yet\./, 'Empty state must show the approved empty message');
  assert.match(block, /label: 'Add Note'/, 'Empty state must offer Add Note');
  assert.match(block, /label: 'Edit'/, 'Read state must offer Edit');
  assert.match(block, /label: 'Cancel'/, 'Edit state must offer Cancel');
  assert.match(block, /label: 'Save'/, 'Edit state must offer Save');
});

test('the Item Notes control lives in the single-selection Inspector top summary card, distinct from Standard Instructions, and only for a single resolved selection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  const transformMarkerIdx = singleBlock.indexOf('=== Transform Card');
  const summaryCardBlock = transformMarkerIdx > 0 ? singleBlock.slice(0, transformMarkerIdx) : singleBlock;
  const actionsMarkerIdx = singleBlock.indexOf('=== Actions Card');
  const actionsCardBlock = actionsMarkerIdx > 0 ? singleBlock.slice(actionsMarkerIdx) : '';

  assert.match(summaryCardBlock, /openInstanceNotesModal\(pack, inst\)/, 'the Item Notes button must be built inside the top summary card');
  assert.doesNotMatch(actionsCardBlock, /openInstanceNotesModal/, 'the Item Notes button must NOT be in the Actions card');

  const multiBlock = extractFunctionBlock(src, 'function renderMultiInspector(pack, selected)');
  assert.doesNotMatch(multiBlock, /openInstanceNotesModal/, 'multi-selection Inspector must not offer Item Notes');

  const unresolvedBlock = extractFunctionBlock(src, 'function renderUnresolvedCaseInspector(pack, inst)');
  assert.doesNotMatch(unresolvedBlock, /openInstanceNotesModal/, 'an unresolved (missing case) selection must not offer Item Notes');
});

test('the Item Notes Read-state value is rendered with safe plain-text assignment, never innerHTML', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openInstanceNotesModal(pack, inst)');
  assert.match(block, /content\.textContent = note;/, 'the populated Read-state value must be assigned via textContent, not innerHTML');
  assert.doesNotMatch(block, /content\.innerHTML/, 'the Item Notes value must never be assigned via innerHTML');
  assert.match(block, /tp3d-case-notes-read/, 'the populated value must reuse the existing line-break-preserving read-only class');
});
