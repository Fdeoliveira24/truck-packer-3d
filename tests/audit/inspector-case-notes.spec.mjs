import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Inspector per-case Case Instructions/Notes (Case.notes).
//
// Case Instructions/Notes are a Case-template field (like Category and the
// other handling-rule metadata already on a Case), so the data-layer
// coverage below exercises the single shared normalizer (cargo-canonical.js)
// and the canonical update path (CaseLibrary.upsert) that the Cases-screen
// Case editor (case-modal.js) uses. Per the locked Cargo Instructions
// architecture (docs/engineering/cargo-instructions-ownership-contract.md),
// the Inspector renders Case Instructions/Notes as a read-only section in the
// combined Notes modal — it is never editable from the Editor.
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
const notesOverlayUrl = new URL('../../src/ui/overlays/notes-overlay.js', import.meta.url);
const appPath = new URL('../../src/app.js', import.meta.url);
const stylesPath = new URL('../../styles/main.css', import.meta.url);

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

test('the PDF Cargo Instructions manifest includes case.notes once per Case and instanceNotes once per owning Pack instance', async () => {
  const ImportExport = await import(importExportUrl.href);
  const notedCase = baseCase({ id: 'case-pdf', name: 'Pallet No-Top Conflict', notes: '  Keep upright.\nNo top loading.  ' });
  const otherCase = baseCase({ id: 'case-pdf-empty', name: 'No Instructions', notes: '   ' });
  const caseMap = new Map([[notedCase.id, notedCase], [otherCase.id, otherCase]]);
  const pack = {
    cases: [
      baseInstance(notedCase.id, { id: 'inst-pdf-1', instanceNotes: '  Deliver separately.\nInspect before loading.  ' }),
      baseInstance(notedCase.id, { id: 'inst-pdf-2', instanceNotes: '   ' }),
      baseInstance(otherCase.id, { id: 'inst-pdf-3' }),
    ],
  };

  const manifest = ImportExport.buildCargoInstructionsManifest(pack, caseId => caseMap.get(caseId) || null);
  assert.deepEqual(manifest.caseEntries, [{
    caseId: notedCase.id,
    caseName: notedCase.name,
    caseNotes: 'Keep upright.\nNo top loading.',
  }], 'Case Instructions/Notes must be emitted once even when multiple instances reference the same Case');
  assert.deepEqual(manifest.itemEntries, [{
    instanceId: 'inst-pdf-1',
    caseId: notedCase.id,
    instanceName: 'Pallet No-Top Conflict #1',
    itemNotes: 'Deliver separately.\nInspect before loading.',
  }], 'empty Item Notes must be omitted cleanly and a populated note must be emitted only for its owning instance');
});

test('generatePDF renders the Cargo Instructions manifest with separate Case and Item sections', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  assert.match(src, /ImportExport\.buildCargoInstructionsManifest\(pack\)/,
    'PDF export must build its note content through the export manifest helper');
  assert.match(src, /'CASE INFORMATION'/);
  assert.match(src, /\['Case Instructions\/Notes', entry\.caseNotes\]/,
    'PDF Case information must render case.notes through the manifest value');
  assert.match(src, /'ITEM DETAILS'/);
  assert.match(src, /\['Item Notes', entry\.itemNotes\]/,
    'PDF Item details must render instanceNotes through the manifest value');
});

// ---------------------------------------------------------------------------
// The Cases screen owns edits to the Case Library field through
// CaseLibrary.upsert(), while the Inspector reads that exact field. No
// duplicate Case-level notes property exists.
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

class NotesTestElement {
  constructor(tagName, documentRef) {
    this.tagName = String(tagName || '').toUpperCase();
    this.ownerDocument = documentRef;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this._classNames = new Set();
    this._textContent = '';
    this.isConnected = true;
    this.disabled = false;
    this.value = '';
    this.focusCount = 0;
    this.classList = {
      add: (...names) => {
        names.filter(Boolean).forEach(name => this._classNames.add(name));
      },
      contains: name => this._classNames.has(name),
    };
  }

  get className() {
    return Array.from(this._classNames).join(' ');
  }

  set className(value) {
    this._classNames = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length) return this.children.map(child => child.textContent).join('');
    return this._textContent;
  }

  set textContent(value) {
    this.children = [];
    this._textContent = String(value == null ? '' : value);
  }

  appendChild(child) {
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  click() {
    const event = {
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
    };
    (this.listeners.get('click') || []).forEach(handler => handler(event));
  }

  focus() {
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const isMatch = element => {
      if (selector === 'button') return element.tagName === 'BUTTON';
      if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
      if (selector.startsWith('#')) return element.id === selector.slice(1);
      return element.tagName === selector.toUpperCase();
    };
    const visit = element => {
      element.children.forEach(child => {
        if (isMatch(child)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }
}

function makeNotesOverlayHarness() {
  const documentListeners = new Map();
  const documentRef = {
    activeElement: null,
    createElement(tagName) {
      return new NotesTestElement(tagName, documentRef);
    },
    addEventListener(type, handler) {
      const handlers = documentListeners.get(type) || new Set();
      handlers.add(handler);
      documentListeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      documentListeners.get(type)?.delete(handler);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    escape() {
      for (const handler of documentListeners.get('keydown') || []) {
        handler({
          key: 'Escape',
          preventDefault() {},
          stopPropagation() {},
        });
      }
    },
  };
  const modals = [];
  const toasts = [];
  const UIComponents = {
    showToast(message, type, options) {
      toasts.push({ message, type, options });
    },
    showModal(config) {
      const modal = documentRef.createElement('div');
      const title = documentRef.createElement('div');
      title.className = 'modal-title';
      title.textContent = config.title;
      const footer = documentRef.createElement('div');
      footer.className = 'modal-footer';
      modal.appendChild(title);
      modal.appendChild(config.content);
      modal.appendChild(footer);
      const overlay = documentRef.createElement('div');
      overlay.appendChild(modal);
      let closed = false;
      const ref = {
        modal,
        overlay,
        close() {
          if (closed) return;
          closed = true;
          modal.isConnected = false;
          overlay.isConnected = false;
          config.onClose?.();
        },
      };
      modals.push({ config, ref, modal, overlay, get closed() { return closed; } });
      return ref;
    },
  };
  const findButton = (modalRecord, label) =>
    modalRecord.modal.querySelectorAll('button').find(button => button.textContent === label) || null;
  return { documentRef, UIComponents, modals, toasts, findButton };
}

async function flushNotesOverlayTasks() {
  await new Promise(resolve => setImmediate(resolve));
}

test('shared Notes overlay keeps one dialog, re-resolves before a trimmed Save, supports explicit Clear, and restores trigger focus', { concurrency: false }, async () => {
  const originalDocument = globalThis.document;
  const harness = makeNotesOverlayHarness();
  globalThis.document = harness.documentRef;
  let entity = { id: 'case-1', name: 'Case One', notes: '', updatedAt: 100 };
  const openingEntity = entity;
  const writes = [];
  const trigger = harness.documentRef.createElement('button');
  try {
    const { openNotesOverlay } = await import(`${notesOverlayUrl.href}?behavior=${Date.now()}-${Math.random()}`);
    const overlay = openNotesOverlay({
      UIComponents: harness.UIComponents,
      entityType: 'case',
      entityId: entity.id,
      capturedContext: 'workspace-a',
      getCurrentContext: () => 'workspace-a',
      resolveEntity: ({ entityId }) => entity && entity.id === entityId ? entity : null,
      readNote: current => current.notes,
      saveNote: ({ entity: current, value, cleared }) => {
        writes.push({ current, value, cleared });
        entity = { ...current, notes: value, updatedAt: current.updatedAt + 1 };
        return entity;
      },
      clearValue: null,
      title: 'Notes',
      subtitle: current => current.name,
      fieldLabel: 'Case Instructions/Notes',
      emptyText: 'No case instructions/notes yet.',
      getLastEdited: current => current.updatedAt,
      trigger,
    });
    assert.ok(overlay);
    assert.equal(harness.modals.length, 1, 'one UIComponents modal owns every state');
    assert.equal(harness.findButton(harness.modals[0], 'Add Note')?.tagName, 'BUTTON');

    harness.findButton(harness.modals[0], 'Add Note').click();
    await flushNotesOverlayTasks();
    const textarea = harness.modals[0].modal.querySelector('textarea');
    assert.ok(textarea, 'Add enters the edit state in the existing dialog');
    textarea.value = '   ';
    harness.findButton(harness.modals[0], 'Save').click();
    await flushNotesOverlayTasks();
    assert.equal(writes.length, 0, 'an empty Save cannot silently act as Clear');
    assert.equal(harness.toasts.at(-1).message, 'Enter a note before saving.');
    assert.equal(harness.modals[0].modal.querySelector('textarea'), textarea,
      'the empty draft remains available for correction');

    textarea.value = '  Keep upright  ';
    entity = { ...entity, name: 'Fresh Case Name' };
    harness.findButton(harness.modals[0], 'Save').click();
    await flushNotesOverlayTasks();

    assert.equal(writes.length, 1);
    assert.equal(writes[0].value, 'Keep upright', 'Save trims the draft');
    assert.equal(writes[0].cleared, false);
    assert.notEqual(writes[0].current, openingEntity, 'Save receives the freshly re-resolved entity');
    assert.equal(writes[0].current.name, 'Fresh Case Name');
    assert.equal(harness.modals.length, 1, 'Save updates the original overlay instead of stacking dialogs');

    harness.findButton(harness.modals[0], 'Clear').click();
    await flushNotesOverlayTasks();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].value, null, 'Case Clear uses the caller-owned null representation');
    assert.equal(writes[1].cleared, true, 'Clear is an explicit action');
    assert.ok(harness.findButton(harness.modals[0], 'Add Note'), 'Clear returns to the empty state');

    overlay.close();
    await flushNotesOverlayTasks();
    assert.equal(trigger.focusCount, 1, 'closing restores focus to the opening control');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('shared Notes overlay blocks stale context/deleted saves, preserves the draft, and closes the previous overlay before opening another', { concurrency: false }, async () => {
  const originalDocument = globalThis.document;
  const harness = makeNotesOverlayHarness();
  globalThis.document = harness.documentRef;
  let context = 'workspace-a';
  let entity = { id: 'pack-1', title: 'Plan One', notes: 'Original' };
  let saveCount = 0;
  let mutationAllowed = true;
  const config = {
    UIComponents: harness.UIComponents,
    entityType: 'load-plan',
    entityId: 'pack-1',
    capturedContext: 'workspace-a',
    getCurrentContext: () => context,
    resolveEntity: ({ entityId }) => entity && entity.id === entityId ? entity : null,
    readNote: current => current.notes,
    saveNote: ({ value }) => {
      saveCount += 1;
      entity = { ...entity, notes: value };
      return entity;
    },
    clearValue: '',
    title: 'Load Plan Notes',
    subtitle: current => current.title,
    fieldLabel: 'Load Plan Notes',
    mutationGuard: () => mutationAllowed,
    contextMessage: 'Workspace changed.',
    missingMessage: 'Load plan deleted.',
  };
  try {
    const { openNotesOverlay } = await import(`${notesOverlayUrl.href}?safety=${Date.now()}-${Math.random()}`);
    const first = openNotesOverlay(config);
    harness.findButton(harness.modals[0], 'Edit').click();
    await flushNotesOverlayTasks();
    const firstDraft = harness.modals[0].modal.querySelector('textarea');
    firstDraft.value = 'Do not lose this draft';
    mutationAllowed = false;
    harness.findButton(harness.modals[0], 'Save').click();
    await flushNotesOverlayTasks();
    assert.equal(saveCount, 0, 'the owner mutation guard runs before Save');
    assert.equal(firstDraft.value, 'Do not lose this draft');

    mutationAllowed = true;
    context = 'workspace-b';
    harness.findButton(harness.modals[0], 'Save').click();
    await flushNotesOverlayTasks();
    assert.equal(saveCount, 0, 'a context change blocks the write');
    assert.equal(firstDraft.value, 'Do not lose this draft', 'the blocked draft stays in place');
    assert.equal(harness.toasts.at(-1).message, 'Workspace changed.');

    context = 'workspace-a';
    entity = null;
    harness.findButton(harness.modals[0], 'Save').click();
    await flushNotesOverlayTasks();
    assert.equal(saveCount, 0, 'a deleted entity cannot be written');
    assert.equal(firstDraft.value, 'Do not lose this draft');
    assert.equal(harness.toasts.at(-1).message, 'Load plan deleted.');

    entity = { id: 'pack-1', title: 'Plan One', notes: '' };
    const second = openNotesOverlay(config);
    assert.equal(harness.modals.length, 2);
    assert.equal(harness.modals[0].closed, true, 'opening another Notes surface closes the previous overlay');
    assert.equal(harness.modals[1].closed, false);
    harness.documentRef.escape();
    await flushNotesOverlayTasks();
    assert.equal(harness.modals[1].closed, true, 'Escape closes the one active Notes overlay');
    first?.close();
    second?.close();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('editor-screen no longer defines the removed prototype Notes-editing modal (openCaseNotesModal)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.doesNotMatch(src, /openCaseNotesModal/, 'the original prototype Inspector Notes modal must remain removed');
});

test('the single-selection Inspector top summary card offers exactly one compact Notes button (progressive disclosure), not always-visible content blocks', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  assert.ok(singleBlock.length > 0, 'editor-screen must define renderSingleInspector(pack, inst, caseData, prefs)');

  const transformMarkerIdx = singleBlock.indexOf('=== Transform Card');
  const summaryCardBlock = transformMarkerIdx > 0 ? singleBlock.slice(0, transformMarkerIdx) : singleBlock;
  const actionsMarkerIdx = singleBlock.indexOf('=== Actions Card');
  const actionsCardBlock = actionsMarkerIdx > 0 ? singleBlock.slice(actionsMarkerIdx) : '';

  assert.match(summaryCardBlock, /openNotesModal\(pack, inst\)/, 'the Notes button must be built inside the top summary card');
  assert.match(summaryCardBlock, /label: 'Notes',/, 'a single compact Notes button must be present');
  assert.match(summaryCardBlock, /iconClass: 'fa-regular fa-file-lines'/,
    'the compact Notes button must render the approved document icon through the existing Font Awesome system');
  assert.doesNotMatch(summaryCardBlock, /'Applies to every unit of this Case\.'/,
    'the always-visible Standard Instructions content block must no longer render inline in the summary card');
  assert.doesNotMatch(summaryCardBlock, /Item Notes — only for this item in this Pack\./,
    'the always-visible Item Notes row must no longer render inline in the summary card');
  assert.doesNotMatch(actionsCardBlock, /openNotesModal/, 'the Notes button must NOT be in the Actions card');

  const multiBlock = extractFunctionBlock(src, 'function renderMultiInspector(pack, selected)');
  assert.doesNotMatch(multiBlock, /openNotesModal/, 'multi-selection Inspector must not offer Notes');

  const unresolvedBlock = extractFunctionBlock(src, 'function renderUnresolvedCaseInspector(pack, inst)');
  assert.doesNotMatch(unresolvedBlock, /openNotesModal/, 'an unresolved (missing case) selection must not offer Notes');
});

// ---------------------------------------------------------------------------
// Phase 2 — Item Notes (Pack-instance-owned instanceNotes).
//
// Item Notes describe one specific placed unit in one specific Pack — unlike
// Standard Instructions, this remains genuinely editable from the Inspector,
// so it keeps the proven Empty/Read/Edit modal pattern, retargeted at
// PackLibrary.updateInstance instead of CaseLibrary.upsert. See
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
// Cargo Instructions Phase 3 — Pack Notes (Pack-owned, pack.notes).
//
// Phase 3 adds a dedicated Inspector entry point that edits the third,
// Pack-owned notes tier (pack.notes) through the existing PackLibrary.update
// path. It introduces no data-layer field — pack.notes already exists — so the
// data-layer tests below characterize the existing behavior the new UI relies
// on (save, clear, ownership isolation, undo/redo, duplication, export/import,
// reload), and the source-contract tests pin openPackNotesModal to pack.notes
// only, never case.notes (Standard Instructions) or instanceNotes (Item Notes).
// editor-screen.js has no jsdom harness here, so the UI wiring is verified with
// source-contract assertions, matching the openNotesModal convention above.
// ---------------------------------------------------------------------------

test('PackLibrary.update(packId, { notes }) saves Pack Notes and leaves Case Standard Instructions and instance Item Notes untouched', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({ notes: 'Case Standard Instructions' });
  const inst = baseInstance(c.id, { instanceNotes: 'Item note stays put' });
  const pack = {
    id: 'pack-notes-p3',
    title: 'Pack Notes P3',
    notes: '',
    truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' },
    cases: [inst],
  };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  PackLibrary.update(pack.id, { notes: 'Deliver to dock 4 by 8am' });
  const afterSave = PackLibrary.getById(pack.id);
  assert.equal(afterSave.notes, 'Deliver to dock 4 by 8am', 'Pack Notes must persist on pack.notes');
  assert.equal(CaseLibrary.getById(c.id).notes, 'Case Standard Instructions',
    'a Pack Notes save must never touch case.notes (Standard Instructions)');
  assert.equal(afterSave.cases[0].instanceNotes, 'Item note stays put',
    'a Pack Notes save must never touch instanceNotes (Item Notes)');
});

test('Pack Notes clear saves as an empty string (matching existing pack.notes behavior), touching nothing else', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const CaseLibrary = await import(caseLibraryUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({ notes: 'Case note' });
  const inst = baseInstance(c.id, { instanceNotes: 'Item note' });
  const pack = { id: 'pack-notes-clear', title: 'Clear', notes: 'Existing pack note', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  PackLibrary.update(pack.id, { notes: '' });
  const afterClear = PackLibrary.getById(pack.id);
  assert.equal(afterClear.notes, '', 'cleared Pack Notes must save as an empty string, consistent with the existing pack.notes field');
  assert.equal(CaseLibrary.getById(c.id).notes, 'Case note', 'clearing Pack Notes must not touch Standard Instructions');
  assert.equal(afterClear.cases[0].instanceNotes, 'Item note', 'clearing Pack Notes must not touch Item Notes');
});

test('Pack Notes are Pack-owned: they live on pack.notes, and no instance carries a derived copy (so the value is identical regardless of which instance is selected)', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({ notes: 'Case note' });
  const instA = baseInstance(c.id, { id: 'inst-a' });
  const instB = baseInstance(c.id, { id: 'inst-b', transform: { position: { x: 40, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
  const pack = { id: 'pack-notes-owned', title: 'Owned', notes: 'Whole-load note', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [instA, instB] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const saved = PackLibrary.getById(pack.id);
  assert.equal(saved.notes, 'Whole-load note', 'Pack Notes live on pack.notes');
  assert.equal(saved.cases.find(i => i.id === 'inst-a').notes, undefined, 'an instance must not carry a copy of pack.notes');
  assert.equal(saved.cases.find(i => i.id === 'inst-b').notes, undefined, 'an instance must not carry a copy of pack.notes');
});

test('Pack Notes changes participate in StateStore undo/redo as a single history step', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({});
  const inst = baseInstance(c.id, {});
  const pack = { id: 'pack-notes-undo', title: 'Undo Pack Notes', notes: 'Original pack note', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  PackLibrary.update(pack.id, { notes: 'Updated pack note' });
  assert.equal(PackLibrary.getById(pack.id).notes, 'Updated pack note');
  StateStore.undo();
  assert.equal(PackLibrary.getById(pack.id).notes, 'Original pack note', 'packLibrary is already a significant/undoable state key');
  StateStore.redo();
  assert.equal(PackLibrary.getById(pack.id).notes, 'Updated pack note');
});

test('Existing Pack behavior is unchanged by Phase 3: whole-Pack duplication and JSON export/import preserve pack.notes (characterization)', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const ImportExport = await import(importExportUrl.href);
  const c = baseCase({});
  const inst = baseInstance(c.id, {});
  const pack = { id: 'pack-notes-rt', title: 'Pack Notes RT', notes: 'Preserve this whole-load note', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const copy = PackLibrary.duplicate(pack.id);
  assert.ok(copy && copy.id !== pack.id);
  assert.equal(copy.notes, 'Preserve this whole-load note', 'whole-Pack duplication must preserve pack.notes');

  const packPayload = ImportExport.parsePackImportJSON(ImportExport.buildPackExportJSON(pack));
  assert.equal(packPayload.pack.notes, 'Preserve this whole-load note', 'Pack JSON export/import must preserve pack.notes');

  const restoredApp = ImportExport.parseAppImportJSON(ImportExport.buildAppExportJSON());
  assert.equal(restoredApp.packLibrary.find(p => p.id === pack.id).notes, 'Preserve this whole-load note', 'app JSON export/import must preserve pack.notes');
});

test('Pack Notes persist across a reload: a stored pack.notes loads back intact via the StateStore.init load path', async () => {
  const StateStore = await import(stateStoreUrl.href);
  const PackLibrary = await import(packLibraryUrl.href);
  const c = baseCase({});
  const inst = baseInstance(c.id, {});
  const stored = { id: 'pack-notes-reload', title: 'Reload', notes: 'Notes that must survive reload', truck: { length: 300, width: 96, height: 110, shapeMode: 'rect' }, cases: [inst] };
  StateStore.init({ caseLibrary: [c], packLibrary: [stored], folderLibrary: [], preferences: {} });
  assert.equal(PackLibrary.getById('pack-notes-reload').notes, 'Notes that must survive reload',
    'a persisted pack.notes must load back intact (reload path)');
});

// --- editor-screen.js source-contract checks for the shared Load Plan Notes adapter ---

test('editor-screen delegates openPackNotesModal to the shared overlay and writes ONLY pack.notes via PackLibrary.update', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openPackNotesModal(pack, trigger = null)');
  assert.ok(block.length > 0, 'editor-screen must define the Load Plan Notes adapter');

  const packIdCaptureIdx = block.indexOf('const packId = pack.id;');
  const overlayCallIdx = block.indexOf('openNotesOverlay({');
  assert.ok(packIdCaptureIdx >= 0 && packIdCaptureIdx < overlayCallIdx,
    'packId must be captured before the shared overlay opens');

  assert.match(block, /resolveEntity: \(\{ entityId \}\) => PackLibrary\.getById\(entityId\)/,
    'the shared overlay re-resolves the current Load Plan by ID');
  assert.match(block, /saveNote: \(\{ entityId, value \}\) => \{[\s\S]*?PackLibrary\.update\(entityId, \{ notes: value \}\)/,
    'Save writes only pack.notes through PackLibrary.update');
  assert.match(block, /clearValue: ''/, 'Load Plan Clear retains the existing empty-string representation');
  assert.doesNotMatch(block, /CaseLibrary/, 'Load Plan Notes must never write Case Instructions/Notes (case.notes)');
  assert.doesNotMatch(block, /instanceNotes/, 'Pack Notes must never write Item Notes (instanceNotes)');
  assert.doesNotMatch(block, /updateInstance/, 'Pack Notes must never touch the per-instance update path');
  assert.doesNotMatch(block, /TruckChangeController/, 'a plain Pack text field must not go through the Truck Change controller');
  assert.doesNotMatch(block, /updateCasesWithManualRevalidation/, 'a plain text field must not trigger geometry/placement revalidation');
});

test('openPackNotesModal configures shared empty/read/edit safety, context, mutation, and focus behavior', async () => {
  const [src, overlaySource] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(notesOverlayUrl, 'utf8'),
  ]);
  const block = extractFunctionBlock(src, 'function openPackNotesModal(pack, trigger = null)');

  assert.equal((block.match(/openNotesOverlay\(/g) || []).length, 1,
    'the Editor has one shared Load Plan Notes overlay call');
  assert.match(block, /No notes for this load plan yet\./, 'the empty state must show the load-plan-level empty message');
  assert.match(block, /mutationGuard: \(\) => !editorMutationBlocked\(\)/,
    'Save and Clear must respect the editor operation lock');
  assert.match(block, /This load plan no longer exists\./, 'a missing Pack must surface a clear error instead of writing to the wrong load plan');
  assert.match(block, /userScope: CoreStorage\.getStorageScope\(\)/);
  assert.match(block, /workspaceScope: CoreStorage\.getWorkspaceScope\(\)/);
  assert.match(block, /packId: StateStore\.get\('currentPackId'\)/);
  assert.match(block, /\btrigger,\s*missingMessage:/,
    'the Inspector trigger is passed through for focus restoration');
  assert.match(overlaySource, /textarea\.value\.trim\(\)/,
    'the shared Save path trims drafts consistently');
  assert.match(overlaySource, /contextIsCurrent\(currentContext\)/);
  assert.match(overlaySource, /const entity = resolveCurrentEntity\(currentContext\)/);
  assert.match(overlaySource, /if \(draftTarget\) focusSoon\(draftTarget\)/,
    'blocked writes preserve and refocus the draft');
});

test('Load Plan Notes is absent from the viewport toolbar, whose five visible actions remain unchanged', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const html = await fs.readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const toolbarStart = html.indexOf('<div class="viewport-toolbar"');
  const toolbarEnd = html.indexOf('</div>', toolbarStart);
  const toolbarBlock = toolbarEnd > toolbarStart ? html.slice(toolbarStart, toolbarEnd) : '';

  assert.ok(toolbarBlock.length > 0, 'the Editor viewport toolbar must remain present');
  [
    ['btn-editor-left', 'Cases'],
    ['btn-autopack', 'AutoPack'],
    ['btn-unpack', 'Unpack'],
    ['btn-share', 'Share'],
    ['btn-editor-right', 'Inspector'],
  ].forEach(([id, label]) => {
    assert.match(toolbarBlock, new RegExp(`id="${id}"[\\s\\S]{0,180}${label}`),
      `the viewport toolbar must retain ${label}`);
  });
  assert.doesNotMatch(toolbarBlock, /btn-pack-notes|Load Plan Notes/,
    'Load Plan Notes must consume no viewport-toolbar space');
  assert.doesNotMatch(editorSrc, /btnPackNotes|btn-pack-notes/,
    'toolbar-specific Pack Notes DOM wiring and refresh handling must be removed');
});

test('the Truck Inspector header left-aligns Truck and reuses the selected-item Notes button pattern on the right', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const truckBlock = extractFunctionBlock(editorSrc, 'function renderTruckInspector(pack, prefs)');
  const singleBlock = extractFunctionBlock(editorSrc, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  const truckHeaderEnd = truckBlock.indexOf("const presetRow = document.createElement('div');");
  const truckHeaderBlock = truckHeaderEnd > 0 ? truckBlock.slice(0, truckHeaderEnd) : '';

  assert.ok(truckBlock.length > 0, 'editor-screen must define renderTruckInspector(pack, prefs)');
  assert.match(truckHeaderBlock, /truckHeader\.className = 'row space-between tp3d-editor-inspector-title-row'/,
    'the Truck header must reuse the existing single-selection anti-wrap title row');
  assert.match(truckHeaderBlock, /truckTitle\.classList\.add\('tp3d-editor-fw-semibold'\)[\s\S]*?truckTitle\.textContent = 'Truck'/,
    'Truck must remain the visible left-side heading');
  assert.match(truckHeaderBlock, /packNotesButton = makeActionButton\(\{\s*label: 'Load Plan Notes',\s*iconClass: 'fa-regular fa-file-lines'/,
    'Load Plan Notes must reuse makeActionButton with the established document icon and visible text');
  assert.match(singleBlock, /const notesButton = makeActionButton\(\{\s*label: 'Notes',\s*iconClass: 'fa-regular fa-file-lines'/,
    'the selected-item Notes control must retain the same makeActionButton and document-icon pattern');
  assert.doesNotMatch(truckHeaderBlock, /data-tooltip|setAttribute\('title'|tp3d-editor-info-icon/,
    'the visible Load Plan Notes button must not retain custom, native, or icon-only tooltip treatment');
  assert.doesNotMatch(truckHeaderBlock, /cardHeaderWithInfo|fa-circle-question/,
    'only the Truck-header question-mark help control must be removed');
  assert.match(editorSrc, /transformCard\.appendChild\(cardHeaderWithInfo\(/,
    'the Transform help control must remain');
  assert.match(editorSrc, /rotCard\.appendChild\(cardHeaderWithInfo\('Rotate \/ Flip'/,
    'the Rotate / Flip help control must remain');

  const truckTitleAppend = truckBlock.indexOf('truckHeader.appendChild(truckTitle);');
  const notesButtonAppend = truckBlock.indexOf('truckHeader.appendChild(packNotesButton);');
  assert.ok(truckTitleAppend >= 0 && notesButtonAppend > truckTitleAppend,
    'Truck must be appended before the right-aligned Load Plan Notes action in DOM order');
  assert.match(truckBlock, /onClick: event => \{[\s\S]*?const activePack = PackLibrary\.getById\(StateStore\.get\('currentPackId'\)\)[\s\S]*?openPackNotesModal\(activePack, event\.currentTarget\)/,
    'the action must re-resolve and open notes for the currently active Pack');
  assert.equal((editorSrc.match(/openPackNotesModal\(/g) || []).length, 2,
    'editor-screen must contain one modal definition and exactly one UI call path');
  assert.match(editorSrc, /if \(packNotesButton\) packNotesButton\.disabled = !pack \|\| busy/,
    'the Inspector action must remain blocked without a Pack or during an editor operation');
});

test('the Load Plan Notes dot follows trimmed pack.notes and shared Save/Clear updates rerender it immediately', async () => {
  const [editorSrc, appSrc, packLibrarySrc, overlaySrc] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(packLibraryUrl, 'utf8'),
    fs.readFile(notesOverlayUrl, 'utf8'),
  ]);
  const truckBlock = extractFunctionBlock(editorSrc, 'function renderTruckInspector(pack, prefs)');
  const modalBlock = extractFunctionBlock(editorSrc, 'function openPackNotesModal(pack, trigger = null)');

  assert.match(truckBlock, /const hasLoadPlanNotes = Boolean\(String\(pack\.notes \|\| ''\)\.trim\(\)\)/,
    'the indicator source must be the active Pack note after trimming');
  assert.match(truckBlock, /if \(hasLoadPlanNotes\) \{[\s\S]*?notesIndicator\.className = 'tp3d-notes-indicator-dot'[\s\S]*?packNotesButton\.appendChild\(notesIndicator\)/,
    'the existing orange notes dot must be appended only for a non-empty trimmed note');

  for (const emptyNote of ['', '   ', '\n\t', null, undefined]) {
    assert.equal(Boolean(String(emptyNote || '').trim()), false,
      'empty, whitespace-only, null, and missing notes must not qualify for the indicator');
  }
  assert.equal(Boolean(String('  Dock 4 at 8am  ').trim()), true,
    'a non-empty trimmed Load Plan note must qualify for the indicator');

  assert.match(modalBlock, /PackLibrary\.update\(entityId, \{ notes: value \}\)/,
    'the Editor adapter keeps using the existing PackLibrary.update path');
  assert.match(modalBlock, /clearValue: ''/, 'Clear keeps the Load Plan empty-string representation');
  assert.match(overlaySrc, /const trimmed = textarea\.value\.trim\(\)[\s\S]*?return writeValue\(trimmed, false, textarea\)/,
    'Save trims through the shared overlay');
  assert.match(overlaySrc, /writeValue\(clearValue, true/,
    'Clear is a distinct shared-overlay action');
  assert.match(packLibrarySrc, /StateStore\.set\(\{ packLibrary: nextPacks \}\)/,
    'PackLibrary.update must continue publishing the packLibrary change');
  assert.match(appSrc, /if \(changes\.caseLibrary \|\| changes\.packLibrary[\s\S]*?EditorUI\.render\(\);/,
    'a Save or Clear packLibrary change must synchronously rerender the Editor');
  assert.match(appSrc, /if \(changes\.currentPackId\) \{[\s\S]*?EditorUI\.render\(\);/,
    'switching Load Plans must rerender the indicator from the newly active Pack');
});

test('Load Plan Notes remains in the existing Truck context only; selection-specific Inspectors do not invent duplicate placements', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  [
    'function renderSingleInspector(pack, inst, caseData, prefs)',
    'function renderMultiInspector(pack, selected)',
    'function renderUnresolvedCaseInspector(pack, inst)',
  ].forEach(signature => {
    assert.doesNotMatch(extractFunctionBlock(editorSrc, signature), /openPackNotesModal|packNotesButton/,
      `${signature} must not duplicate the Load Plan Notes entry point`);
  });
});

// ---------------------------------------------------------------------------
// editor-screen.js source-contract checks for openNotesModal — the single,
// merged Notes modal. It presents Case Instructions/Notes (Case-owned,
// read-only) and Item Notes (Pack-instance-owned, editable) together for
// progressive disclosure, but the two fields are never merged: only Item
// Notes has a Save action, and only PackLibrary.updateInstance is ever
// called from this function.
// ---------------------------------------------------------------------------

test('editor-screen defines openNotesModal(pack, inst) and captures packId + instanceId before any modal opens', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
  assert.ok(block.length > 0, 'editor-screen must define openNotesModal(pack, inst)');

  const packIdCaptureIdx = block.indexOf('const packId = pack.id;');
  const instanceIdCaptureIdx = block.indexOf('const instanceId = inst.id;');
  assert.ok(packIdCaptureIdx >= 0 && instanceIdCaptureIdx >= 0, 'packId and instanceId must both be captured once from the passed-in pack/inst');
  const firstModalCallIdx = block.indexOf('UIComponents.showModal');
  assert.ok(packIdCaptureIdx < firstModalCallIdx && instanceIdCaptureIdx < firstModalCallIdx,
    'packId and instanceId must be captured before any modal is opened');
});

test('openNotesModal renders both Case Instructions/Notes (read-only) and Item Notes (editable) as clearly separated sections', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
  assert.match(block, /label\.textContent = 'Case Instructions\/Notes'/,
    'the Case-owned section uses the approved customer terminology');
  assert.match(block, /value\.textContent = 'No case instructions\/notes yet\.'/);
  assert.doesNotMatch(block, /Standard Case Instructions|No standard instructions\./);
  assert.match(block, /label\.textContent = 'Item Notes'/, 'the instance-owned section must be labeled Item Notes');
  assert.doesNotMatch(block, /Case-wide/, 'the Case-wide ownership badge must be removed — section titles alone carry ownership now');
  assert.doesNotMatch(block, /This item only/, 'the This item only ownership badge must be removed — section titles alone carry ownership now');
});

test('openNotesModal header renders the document icon, Notes title, and Case name in one compact hierarchy', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
  assert.match(block, /headingIconGlyph\.className = 'fa-regular fa-file-lines'/,
    'the modal header must reuse the approved document icon');
  assert.match(block, /headingTitle\.textContent = config\.title \|\| 'Notes'/,
    'Notes must remain the primary modal title');
  assert.match(block, /headingSubtitle\.textContent = config\.subtitle \|\| 'Case'/,
    'the selected Case name must be the modal header subtitle');
  assert.doesNotMatch(block, /wrap\.appendChild\(subtitle\)/,
    'the Case name must not remain a detached first row in the modal body');
});

test('openNotesModal Save writes through PackLibrary.updateInstance (the canonical Pack-instance update path), never CaseLibrary, TruckChangeController, or manual revalidation', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
  assert.match(block, /PackLibrary\.updateInstance\(packId, instanceId, \{ instanceNotes: trimmed \|\| null \}\)/,
    'Save must call PackLibrary.updateInstance with the captured packId/instanceId and a trimmed, null-on-empty value');
  assert.doesNotMatch(block, /CaseLibrary\.upsert/, 'Case Instructions/Notes is read-only here — nothing in this modal may write through CaseLibrary');
  assert.doesNotMatch(block, /TruckChangeController/, 'Item Notes must not go through the Truck Change controller');
  assert.doesNotMatch(block, /updateCasesWithManualRevalidation/, 'a plain text field must not trigger geometry/placement revalidation');
});

test('openNotesModal fails safely when the captured Pack/instance no longer exists, and Save failure preserves the draft instead of closing', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
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

test('openNotesModal reuses UIComponents.showModal for all three Item Notes states via a locally Escape-scoped wrapper (no bespoke modal markup, no shared-primitive change)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
  const showModalCalls = (block.match(/UIComponents\.showModal\(/g) || []).length;
  assert.equal(showModalCalls, 1, 'only the local showNotesModal wrapper should call UIComponents.showModal directly');
  const showNotesModalCalls = (block.match(/(?<!function )showNotesModal\(\{/g) || []).length;
  assert.equal(showNotesModalCalls, 3, 'Empty, Read, and Edit Item Notes states must each render through the local showNotesModal wrapper');

  assert.match(block, /No notes for this case yet\./, 'the fully empty state must show the approved case-level empty message');
  assert.match(block, /No notes for this item yet\./,
    'an empty Item Notes section must remain clear when Case Instructions/Notes exist');
  assert.match(block, /tp3d-notes-empty-state-icon/, 'the fully empty state must include the document icon');
  assert.match(block, /label: 'Add Note'/, 'Empty state must offer Add Note');
  assert.match(block, /label: 'Edit'/, 'Read state must offer Edit');
  assert.match(block, /label: 'Cancel'/, 'Edit state must offer Cancel');
  assert.match(block, /label: 'Save'/, 'Edit state must offer Save');
});

test('openNotesModal shows a Last edited timestamp using the existing pack.lastEdited field and Utils.formatRelativeTime (no new persistence field)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
  assert.match(block, /Last edited \$\{Utils\.formatRelativeTime\(currentPackForEdited\.lastEdited\)\}/,
    'Last edited must be derived from the existing pack.lastEdited field via the existing formatRelativeTime helper');
  assert.match(block, /lastEdited\.className = 'muted tp3d-notes-last-edited'/,
    'Last edited must use a dedicated muted secondary-text style below the Item Notes content');

  const css = await fs.readFile(stylesPath, 'utf8');
  const timestampRule = css.match(/\.tp3d-notes-last-edited\s*\{[^}]*\}/)?.[0] || '';
  assert.match(timestampRule, /font-size:\s*12px;/, 'Last edited must render at the approved 12px size');
});

test('the Notes button lives in the single-selection Inspector top summary card, and only for a single resolved selection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  const transformMarkerIdx = singleBlock.indexOf('=== Transform Card');
  const summaryCardBlock = transformMarkerIdx > 0 ? singleBlock.slice(0, transformMarkerIdx) : singleBlock;
  const actionsMarkerIdx = singleBlock.indexOf('=== Actions Card');
  const actionsCardBlock = actionsMarkerIdx > 0 ? singleBlock.slice(actionsMarkerIdx) : '';

  assert.match(summaryCardBlock, /openNotesModal\(pack, inst\)/, 'the Notes button must be built inside the top summary card');
  assert.doesNotMatch(actionsCardBlock, /openNotesModal/, 'the Notes button must NOT be in the Actions card');

  const multiBlock = extractFunctionBlock(src, 'function renderMultiInspector(pack, selected)');
  assert.doesNotMatch(multiBlock, /openNotesModal/, 'multi-selection Inspector must not offer Notes');

  const unresolvedBlock = extractFunctionBlock(src, 'function renderUnresolvedCaseInspector(pack, inst)');
  assert.doesNotMatch(unresolvedBlock, /openNotesModal/, 'an unresolved (missing case) selection must not offer Notes');
});

test('the Notes button title row never wraps the button below the case name, regardless of title length', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  assert.match(singleBlock, /titleRow\.className = 'row space-between tp3d-editor-inspector-title-row'/,
    'the title row must use the anti-wrap layout class so a long case name cannot push the Notes button to a new line');
});

test('the Notes button shows a subtle indicator dot only when Case Instructions/Notes or Item Notes exist', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleBlock = extractFunctionBlock(src, 'function renderSingleInspector(pack, inst, caseData, prefs)');
  assert.match(singleBlock, /const hasAnyNotes = Boolean\(String\(caseData\.notes \|\| ''\)\.trim\(\)\) \|\| Boolean\(String\(inst\.instanceNotes \|\| ''\)\.trim\(\)\)/,
    'the indicator must reflect either Case Instructions/Notes or Item Notes having content');
  assert.match(singleBlock, /if \(hasAnyNotes\) \{[\s\S]*?tp3d-notes-indicator-dot/, 'the dot must only be appended when hasAnyNotes is true');
});

test('the populated Case Instructions/Notes and Item Notes values are rendered with safe plain-text assignment, never innerHTML', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function openNotesModal(pack, inst)');
  assert.match(block, /value\.textContent = note;/, 'the populated Case Instructions/Notes value must be assigned via textContent, not innerHTML');
  assert.match(block, /content\.textContent = note;/, 'the populated Item Notes Read-state value must be assigned via textContent, not innerHTML');
  assert.doesNotMatch(block, /\.innerHTML\s*=/, 'no note value may ever be assigned via innerHTML');
  assert.match(block, /tp3d-case-notes-read/, 'the populated values must reuse the existing line-break-preserving read-only class');
});
