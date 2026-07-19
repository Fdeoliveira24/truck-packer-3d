import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Inspector per-case Notes.
//
// Notes are a Case-template field (like Category and the other handling-rule
// metadata already on a Case), so the data-layer coverage below exercises the
// single shared normalizer (cargo-canonical.js) and the canonical update path
// (CaseLibrary.upsert) that the Inspector's Notes modal also uses.
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
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const uiComponentsPath = new URL('../../src/ui/ui-components.js', import.meta.url);

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

test('a note saved via the Cases-screen case-modal.js payload shape is visible to the Inspector, and vice versa', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  StateStore.init({ caseLibrary: [baseCase({})], packLibrary: [], folderLibrary: [], preferences: {} });

  // case-modal.js's Save handler spreads its full form payload (including a
  // trimmed `notes` string) into CaseLibrary.upsert — simulate that shape.
  const casesScreenPayload = { ...CaseLibrary.getById('case-notes-1'), notes: String('  From Cases screen  ').trim() };
  CaseLibrary.upsert(casesScreenPayload);
  assert.equal(CaseLibrary.getById('case-notes-1').notes, 'From Cases screen',
    'a Cases-screen edit must be readable as the Inspector Notes modal reads it: CaseLibrary.getById(caseId).notes');

  // openCaseNotesModal's Save handler spreads the latest record plus the raw
  // textarea value — simulate that shape from the Inspector side.
  CaseLibrary.upsert({ ...CaseLibrary.getById('case-notes-1'), notes: 'From Inspector' });
  assert.equal(CaseLibrary.getById('case-notes-1').notes, 'From Inspector',
    'an Inspector edit must be the same field the Cases-screen case-modal.js reads via initial.notes');
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

test('editor-screen defines openCaseNotesModal(caseData) and captures the case identity before any modal opens', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openCaseNotesModal(caseData)');
  assert.ok(block.length > 0, 'editor-screen must define openCaseNotesModal(caseData)');

  const idCaptureIdx = block.indexOf('const caseId = caseData.id;');
  assert.ok(idCaptureIdx >= 0, 'caseId must be captured once from the passed-in caseData');
  const firstModalCallIdx = block.indexOf('UIComponents.showModal');
  assert.ok(idCaptureIdx < firstModalCallIdx, 'caseId must be captured before any modal is opened');
});

test('openCaseNotesModal Save writes through CaseLibrary.upsert (the canonical case-template update path), never a pack/instance mutation', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openCaseNotesModal(caseData)');
  assert.match(block, /CaseLibrary\.upsert\(\{\s*\.\.\.latest,\s*notes:\s*textarea\.value\s*\}\)/,
    'Save must call CaseLibrary.upsert with the captured case plus the raw textarea value (normalization is delegated to the shared canonical parser)');
  assert.doesNotMatch(block, /PackLibrary\.(update|updateCasesWithManualRevalidation)/,
    'Notes must not go through a pack/instance update path — the note belongs to the case template');
});

test('openCaseNotesModal fails safely when the captured case no longer exists, and Save failure preserves the draft instead of closing', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openCaseNotesModal(caseData)');
  const guardCount = (block.match(/CaseLibrary\.getById\(caseId\)/g) || []).length;
  assert.ok(guardCount >= 2, 'both the state-resolve path and the Save handler must re-check CaseLibrary.getById(caseId) before acting');
  assert.match(block, /This case no longer exists\./, 'a missing case must surface a clear error instead of silently updating the wrong case');

  const saveHandlerStart = block.indexOf("label: 'Save'");
  const saveHandlerBlock = block.slice(saveHandlerStart, block.indexOf('},', saveHandlerStart));
  assert.match(saveHandlerBlock, /if \(!latest\) \{[\s\S]*?return false;/,
    'Save failure (missing case) must return false so showModal does NOT close — the draft and edit state are preserved, per the approved Save-failure contract');
});

test('openCaseNotesModal reuses UIComponents.showModal for all three states via a locally Escape-scoped wrapper (no bespoke modal markup, no shared-primitive change)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openCaseNotesModal(caseData)');
  const showModalCalls = (block.match(/UIComponents\.showModal\(/g) || []).length;
  assert.equal(showModalCalls, 1, 'only the local showNotesModal wrapper should call UIComponents.showModal directly');
  const showNotesModalCalls = (block.match(/(?<!function )showNotesModal\(\{/g) || []).length;
  assert.equal(showNotesModalCalls, 3, 'Empty, Read, and Edit states must each render through the local showNotesModal wrapper');

  assert.match(block, /No notes for this case yet\./, 'Empty state must show the approved empty message');
  assert.match(block, /label: 'Add note'/, 'Empty state must offer Add note (only action; × and backdrop cover Close)');
  assert.match(block, /label: 'Edit'/, 'Read state must offer Edit');
  assert.match(block, /label: 'Cancel'/, 'Edit state must offer Cancel');
  assert.match(block, /label: 'Save'/, 'Edit state must offer Save');
  assert.match(block, /label: 'Close'/, 'Read state must offer Close');
  assert.match(block, /placeholder = 'Add details about handling, defects, or special instructions\.\.\.'/,
    'Edit state textarea must use the approved placeholder');
  assert.match(block, /title: `Notes — \$\{caseLabel\}`/, 'every state must title the modal with Notes and the selected case name');
});

test('openCaseNotesModal handles Escape locally (matching the existing truck-change-controller.js pattern), without touching the shared showModal primitive', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(editorSrc, 'function openCaseNotesModal(caseData)');
  assert.match(block, /function showNotesModal\(config\)/, 'a local wrapper must own Escape handling for this feature only');
  assert.match(block, /ev\.key === 'Escape'/);
  assert.match(block, /document\.addEventListener\('keydown', handleEscape\)/);
  assert.match(block, /document\.removeEventListener\('keydown', handleEscape\)/,
    'the local keydown listener must be removed on close to avoid leaking a document-level listener per modal open');

  // The shared primitive itself must remain exactly as it was before this
  // feature: truck-change-controller.js already implements its own capture-
  // phase Escape handling on top of showModal precisely because showModal does
  // not provide it globally. A generic bubble-phase Escape handler added to
  // showModal would run alongside that existing handler for every Truck Change
  // modal — an interaction this feature must not introduce.
  const uiSrc = await fs.readFile(uiComponentsPath, 'utf8');
  const showModalStart = uiSrc.indexOf('function showModal(config)');
  const showModalEnd = uiSrc.indexOf('\n  function showAutoPackLoadingOverlay', showModalStart);
  const showModalBlock = showModalStart >= 0 && showModalEnd > showModalStart ? uiSrc.slice(showModalStart, showModalEnd) : '';
  assert.ok(showModalBlock.length > 0, 'ui-components must still define showModal(config)');
  assert.doesNotMatch(showModalBlock, /Escape/, 'showModal must not gain global Escape handling for this feature');
});

test('the Inspector Notes button lives in the top case-summary card, not the Actions card, and only for a single resolved selection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  assert.ok(singleBlock.length > 0, 'editor-screen must define renderSingleInspector(pack, inst, caseData, prefs)');

  // Isolate the summary-card header (up to the Transform card comment) and the
  // Actions card separately so button placement is checked structurally, not
  // just by presence anywhere in the function.
  const transformMarkerIdx = singleBlock.indexOf('=== Transform Card');
  const summaryCardBlock = transformMarkerIdx > 0 ? singleBlock.slice(0, transformMarkerIdx) : singleBlock;
  const actionsMarkerIdx = singleBlock.indexOf('=== Actions Card');
  const actionsCardBlock = actionsMarkerIdx > 0 ? singleBlock.slice(actionsMarkerIdx) : '';

  assert.match(summaryCardBlock, /openCaseNotesModal\(caseData\)/,
    'the Notes button must be built inside the top summary card, alongside the case-name header');
  assert.match(summaryCardBlock, /titleRow\.className = 'row space-between'/,
    'the summary card must reuse the existing row/space-between header pattern (same as Transform/Rotate cardHeaderWithInfo) rather than a new layout system');
  assert.doesNotMatch(actionsCardBlock, /openCaseNotesModal/, 'the Notes button must NOT be in the Actions card');

  const multiBlock = extractFunctionBlock(src, 'function renderMultiInspector(pack, selected)');
  assert.doesNotMatch(multiBlock, /openCaseNotesModal/, 'multi-selection Inspector must not offer Notes');

  const unresolvedBlock = extractFunctionBlock(src, 'function renderUnresolvedCaseInspector(pack, inst)');
  assert.doesNotMatch(unresolvedBlock, /openCaseNotesModal/, 'an unresolved (missing case) selection must not offer Notes');
});

test('the Notes button is built fresh via the existing makeActionButton helper (no new button component, no persisted DOM/listener reuse across rerenders)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  assert.match(singleBlock, /const notesButton = makeActionButton\(\{\s*\n\s*label: 'Notes',/,
    'the Notes button must reuse the same makeActionButton helper as every other Inspector action button');
  assert.match(singleBlock, /titleRow\.appendChild\(notesButton\);/);
});
