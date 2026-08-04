import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Quantity Controls — ecommerce-style workflow (FINAL model).
//
// The previous Target/Missing model (pack.caseRequirements) is rejected and
// removed. There is no persisted quantity target. The Editor Qty selector is
// ephemeral UI state only; clicking "+ Add" creates that many new physical
// instances (pack.cases entries), always staged. Derived values (inTruck,
// staged, inLoad, hidden) are computed from pack.cases via the same
// shape-aware truck-geometry classification Pack statistics already use.
//
// Executable coverage: normalizer.js, services/pack-library.js,
// services/import-export.js, services/case-library.js, and core/storage.js
// (via import-export.js) are UI-free modules, so this suite loads and calls
// them directly against an in-memory StateStore (same pattern as
// tests/audit/import-export.spec.mjs).
//
// Source-contract coverage: screens/editor-screen.js, screens/cases-screen.js,
// screens/packs-screen.js, and src/app.js render through the DOM/Three.js
// scene and have no jsdom harness in this suite (matching the existing
// convention in security-and-invariants.spec.mjs and
// inspector-case-notes.spec.mjs) — their wiring is verified by extracting the
// relevant function's source block and asserting on its contents rather than
// executing the UI.

const repoRoot = new URL('../../', import.meta.url);
const normalizerUrl = new URL('../../src/core/normalizer.js', import.meta.url);
const stateStoreUrl = new URL('../../src/core/state-store.js', import.meta.url);
const storageUrl = new URL('../../src/core/storage.js', import.meta.url);
const packLibraryUrl = new URL('../../src/services/pack-library.js', import.meta.url);
const caseLibraryUrl = new URL('../../src/services/case-library.js', import.meta.url);
const importExportUrl = new URL('../../src/services/import-export.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const casesScreenPath = new URL('../../src/screens/cases-screen.js', import.meta.url);
const packsScreenPath = new URL('../../src/screens/packs-screen.js', import.meta.url);
const cardDisplayOverlayPath = new URL('../../src/ui/overlays/card-display-overlay.js', import.meta.url);
const appJsPath = new URL('../../src/app.js', import.meta.url);
const autopackEnginePath = new URL('../../src/services/autopack-engine.js', import.meta.url);
const autopackSolverPath = new URL('../../src/services/autopack-solver.js', import.meta.url);
const indexHtmlPath = new URL('../../index.html', import.meta.url);

// IMPORTANT: state-store.js holds module-level singleton state (`let state =
// null` at module scope). pack-library.js, case-library.js, and
// import-export.js all import it via the plain specifier '../core/state-store.js'
// (no cache-busting query string) — so this loader must resolve it the exact
// same way, or StateStore.init() here would initialize a DIFFERENT module
// instance than the one those services actually read from.
async function loadModules() {
  const [CoreNormalizer, StateStore, CoreStorage, PackLibrary, CaseLibrary, ImportExport] = await Promise.all([
    import(normalizerUrl.href),
    import(stateStoreUrl.href),
    import(storageUrl.href),
    import(packLibraryUrl.href),
    import(caseLibraryUrl.href),
    import(importExportUrl.href),
  ]);
  return { CoreNormalizer, StateStore, CoreStorage, PackLibrary, CaseLibrary, ImportExport };
}

function baseCase(overrides = {}) {
  return {
    id: 'case-a',
    name: 'Case A',
    dimensions: { length: 10, width: 10, height: 10 },
    weight: 5,
    ...overrides,
  };
}

function rectTruck(overrides = {}) {
  return { length: 120, width: 60, height: 60, shapeMode: 'rect', shapeConfig: {}, ...overrides };
}

// Coordinate convention (documented at pack-library.js TRUCK_DIRECTION_MODEL):
// x=0..truck.length (rear..front), y=0..height (floor up), z=-width/2..width/2.
function insideInstance(overrides = {}) {
  return {
    id: 'inst-inside',
    caseId: 'case-a',
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

function outsideInstance(overrides = {}) {
  return {
    id: 'inst-outside',
    caseId: 'case-a',
    transform: {
      position: { x: -500, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: 'staged',
    ...overrides,
  };
}

function basePack(overrides = {}) {
  return {
    id: 'pack-1',
    title: 'Load Plan 1',
    loadPlanNumber: 'LP-0001',
    customerReference: null,
    truck: rectTruck(),
    cases: [],
    groups: [],
    stats: {},
    ...overrides,
  };
}

function legacyQuantityPack(overrides = {}) {
  return basePack({
    cases: [insideInstance({ id: 'legacy-physical-1' }), outsideInstance({ id: 'legacy-physical-2' })],
    caseRequirements: [{ caseId: 'case-a', requiredQuantity: 99 }],
    ...overrides,
  });
}

function createMemoryLocalStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function extractFunctionBlock(src, signature, endMarker = '\n    }') {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `expected to find "${signature}" in source`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `expected to find the end of "${signature}"`);
  return src.slice(start, end);
}

function aabbFor(position, dims) {
  return {
    min: { x: position.x - dims.length / 2, y: position.y - dims.height / 2, z: position.z - dims.width / 2 },
    max: { x: position.x + dims.length / 2, y: position.y + dims.height / 2, z: position.z + dims.width / 2 },
  };
}

function aabbsOverlap(a, b) {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

// ---------------------------------------------------------------------------
// Obsolete-code scan — the rejected Target/Missing model must leave nothing
// stored, normalized, exported, imported, duplicated, or referenced anywhere
// in production or active test code. Historical docs may still mention it.
// ---------------------------------------------------------------------------

test('obsolete-code scan: caseRequirements/requiredQuantity have no production or active-test references', async () => {
  const roots = ['src', 'tests'];
  const hits = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      if (full.endsWith(path.join('tests', 'audit', 'quantity-controls-phase-1.spec.mjs'))) continue;
      const text = await fs.readFile(full, 'utf8');
      if (!/caseRequirements|requiredQuantity/.test(text)) continue;
      if (path.normalize(full) === path.normalize(fileURLToPath(normalizerUrl))) {
        const start = text.indexOf('export function sanitizeLegacyPackQuantityFields');
        const end = start >= 0 ? text.indexOf('\n}', start) : -1;
        const outsideSanitizer = start >= 0 && end > start
          ? text.slice(0, start) + text.slice(end + 2)
          : text;
        if (!/caseRequirements|requiredQuantity/.test(outsideSanitizer)) continue;
      }
      hits.push(full);
    }
  }
  for (const root of roots) {
    await walk(path.join(fileURLToPath(repoRoot), root));
  }
  assert.deepEqual(hits, [], `caseRequirements/requiredQuantity must not appear in: ${hits.join(', ')}`);
});

// ===========================================================================
// EDITOR (Requirements 1-27)
// ===========================================================================

test('Requirement 1: Qty defaults to 1', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /const CASE_QTY_MIN = 1;/);
  assert.match(src, /function getCaseQtyDraft\(caseId\) \{\s*const stored = caseQtyDrafts\.get\(caseId\);\s*return Number\.isFinite\(stored\) \? stored : CASE_QTY_MIN;/);
});

test('Requirement 2: minus never drops below 1', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const setter = extractFunctionBlock(src, 'function setCaseQtyDraft(caseId, value) {', '\n    }');
  assert.match(setter, /Math\.max\(CASE_QTY_MIN, Math\.trunc\(value\)\)/);
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /minusBtn\.addEventListener\('click', \(\) => \{\s*commitDraft\(getCaseQtyDraft\(c\.id\) - 1\);/);
});

test('Requirement 3: plus increments (clamped by setCaseQtyDraft to CASE_QTY_MAX)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /const CASE_QTY_MAX = 10000;/);
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /plusBtn\.addEventListener\('click', \(\) => \{\s*commitDraft\(getCaseQtyDraft\(c\.id\) \+ 1\);/);
});

test('Requirement 4: direct integer input is accepted', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /const parseDirectEntry = \(\) => \{/);
  assert.match(block, /Number\.isInteger\(n\)/);
});

test('Requirement 5: Enter commits the direct-entry value', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /if \(ev\.key === 'Enter'\) \{\s*ev\.preventDefault\(\);\s*commitDraft\(parseDirectEntry\(\)\);/);
});

test('Requirement 6: blur commits the direct-entry value', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /input\.addEventListener\('blur', \(\) => \{\s*commitDraft\(parseDirectEntry\(\)\);/);
});

test('Requirement 7: Escape restores the prior valid value', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /else if \(ev\.key === 'Escape'\) \{\s*ev\.preventDefault\(\);\s*revertInput\(\);\s*input\.blur\(\);/);
});

test('Requirement 8: blank/zero/negative/non-numeric/NaN/infinite/fractional input restores the prior valid value', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  const parseBlock = extractFunctionBlock(block, 'const parseDirectEntry = () => {', '\n      };');
  assert.match(parseBlock, /if \(raw === ''\) return null;/);
  assert.match(parseBlock, /if \(!Number\.isFinite\(n\) \|\| !Number\.isInteger\(n\) \|\| n < CASE_QTY_MIN\) return null;/);
  assert.match(block, /const commitDraft = value => \{\s*if \(value === null\) \{\s*revertInput\(\);/);
});

test('Requirement 9: maximum is 10,000', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const setter = extractFunctionBlock(src, 'function setCaseQtyDraft(caseId, value) {', '\n    }');
  assert.match(setter, /Math\.min\(CASE_QTY_MAX, Math\.max\(CASE_QTY_MIN, Math\.trunc\(value\)\)\)/);
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /input\.max = String\(CASE_QTY_MAX\)/);
});

test('Requirement 10: the "+ Add" button label always remains exactly "+ Add" — never dynamic', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /addBtn\.innerHTML = '<i class="fa-solid fa-plus"><\/i> Add';/);
  assert.doesNotMatch(block, /Add \$\{/);
  // No Target/Missing-era dynamic labels survive anywhere in the file.
  assert.doesNotMatch(src, /Target met|Over target|Add \$\{status\.missing\}/);
});

test('Requirement 11: PackLibrary.addInstancesToStaging(pack, case, 5) creates exactly five physical instances', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [basePack()], folderLibrary: [], preferences: {} });
  const result = PackLibrary.addInstancesToStaging('pack-1', 'case-a', 5);
  assert.equal(result.requestedCount, 5);
  assert.equal(result.addedCount, 5);
  assert.equal(result.createdInstanceIds.length, 5);
  assert.equal(PackLibrary.getById('pack-1').cases.length, 5);
});

test('Requirement 12 & 13: every button-created instance is staged, none inside valid truck geometry', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [basePack()], folderLibrary: [], preferences: {} });
  PackLibrary.addInstancesToStaging('pack-1', 'case-a', 6);
  const counts = PackLibrary.getCaseInstanceCounts('pack-1', 'case-a');
  assert.equal(counts.staged, 6);
  assert.equal(counts.inTruck, 0);
});

test('Requirement 14: new staged instances do not overlap one another', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await loadModules();
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [basePack()], folderLibrary: [], preferences: {} });
  const result = PackLibrary.addInstancesToStaging('pack-1', 'case-a', 25);
  const caseData = CaseLibrary.getById('case-a');
  const pack = PackLibrary.getById('pack-1');
  const created = pack.cases.filter(i => result.createdInstanceIds.includes(i.id));
  const boxes = created.map(i => aabbFor(i.transform.position, caseData.dimensions));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!aabbsOverlap(boxes[i], boxes[j]), `created instance ${i} and ${j} must not overlap`);
    }
  }
});

test('Requirement 15: existing physical instances remain unchanged after a bulk add', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  const existing = insideInstance({ id: 'pre-existing' });
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [basePack({ cases: [existing] })], folderLibrary: [], preferences: {} });
  PackLibrary.addInstancesToStaging('pack-1', 'case-a', 3);
  const pack = PackLibrary.getById('pack-1');
  const stillThere = pack.cases.find(i => i.id === 'pre-existing');
  assert.deepEqual(stillThere, existing);
});

test('Requirement 16: bulk addition uses exactly one Pack update/history action, never one per instance', async () => {
  const src = await fs.readFile(packLibraryUrl, 'utf8');
  const block = extractFunctionBlock(src, 'export function addInstancesToStaging(packId, caseId, count) {', '\n}');
  const updateCalls = block.match(/\bupdate\(packId/g) || [];
  assert.equal(updateCalls.length, 1, 'addInstancesToStaging must call update() exactly once for the whole batch');
  assert.doesNotMatch(block, /\baddInstance\(pack/);
});

test('Requirement 17 & 18: Undo removes the entire batch, Redo restores the entire batch', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [basePack()], folderLibrary: [], preferences: {} });
  PackLibrary.addInstancesToStaging('pack-1', 'case-a', 8);
  assert.equal(PackLibrary.getById('pack-1').cases.length, 8);
  StateStore.undo();
  assert.equal(PackLibrary.getById('pack-1').cases.length, 0);
  StateStore.redo();
  assert.equal(PackLibrary.getById('pack-1').cases.length, 8);
});

test('Requirement 19: Qty resets to 1 after a successful Add', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /setCaseQtyDraft\(c\.id, CASE_QTY_MIN\);/);
});

test('Requirement 20: multiple newly created items are not all auto-selected (single-add selection is preserved/consistent)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function buildCaseQtyAddRow(c, pack) {', '\n      return section;\n    }');
  assert.match(block, /if \(result\.addedCount === 1\) \{\s*StateStore\.set\(\{ selectedInstanceIds: result\.createdInstanceIds \}/);
  // No unconditional selectedInstanceIds assignment covering the multi-add case.
  const selectionAssignments = block.match(/StateStore\.set\(\{ selectedInstanceIds:/g) || [];
  assert.equal(selectionAssignments.length, 1, 'only the single-add branch may set selectedInstanceIds');
});

test('Requirement 21: drag creates exactly one manually positioned instance', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [basePack()], folderLibrary: [], preferences: {} });
  const inst = PackLibrary.addInstance('pack-1', 'case-a', { x: 15, y: 5, z: 0 });
  assert.ok(inst);
  assert.equal(PackLibrary.getById('pack-1').cases.length, 1);
  assert.deepEqual(inst.transform.position, { x: 15, y: 5, z: 0 });
});

test('Requirement 22: drag does not use or reset the Qty draft', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function addCaseToPack(caseId, positionInches) {', '\n    }');
  assert.doesNotMatch(block, /caseQtyDrafts|getCaseQtyDraft|setCaseQtyDraft/);
  assert.match(block, /PackLibrary\.addInstance\(/);
});

test('Requirement 23: inLoad = inTruck + staged', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'i1' }), outsideInstance({ id: 'i2' }), outsideInstance({ id: 'i3' })] })],
    folderLibrary: [],
    preferences: {},
  });
  const counts = PackLibrary.getCaseInstanceCounts('pack-1', 'case-a');
  assert.equal(counts.inTruck, 1);
  assert.equal(counts.staged, 2);
  assert.equal(counts.inLoad, counts.inTruck + counts.staged);
});

test('Requirement 24: hidden instances are excluded from inTruck/staged/inLoad and counted separately', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'i1' }), outsideInstance({ id: 'i2', hidden: true })] })],
    folderLibrary: [],
    preferences: {},
  });
  const counts = PackLibrary.getCaseInstanceCounts('pack-1', 'case-a');
  assert.equal(counts.inTruck, 1);
  assert.equal(counts.staged, 0);
  assert.equal(counts.inLoad, 1);
  assert.equal(counts.hidden, 1);
});

test('Requirement 25: no-Load-Plan message replaces per-card controls, is not repeated on every card', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /qtyMessageEl\.textContent = 'Open a Load Plan to add quantities\.';/);
  assert.match(src, /qtyMessageEl\.hidden = Boolean\(browserPack\);/);
  const cardBlock = extractFunctionBlock(src, 'function buildCaseBrowserCard(c, lengthUnit, prefs, isSelected, pack) {', '\n      return card;\n    }');
  assert.match(cardBlock, /if \(pack\) \{\s*card\.appendChild\(buildCaseQtyAddRow\(c, pack\)\);\s*\}/);
});

test('Requirement 26: search/filter/group rerenders preserve untouched Case Qty drafts', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const renderStart = src.indexOf('function renderCaseBrowser');
  const helperStart = src.indexOf('function buildCaseBrowserCard');
  const renderBlock = src.slice(renderStart, helperStart);
  assert.doesNotMatch(renderBlock, /caseQtyDrafts\.clear\(\)/, 'renderCaseBrowser must never clear the session-only Qty draft map');
  // The Map is declared once at editor-screen module scope, not inside renderCaseBrowser.
  const drafMapDecls = (src.match(/const caseQtyDrafts = new Map\(\);/g) || []).length;
  assert.equal(drafMapDecls, 1);
});

test('Requirement 27: no Qty UI state is persisted to StateStore/localStorage/Pack/Case', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.doesNotMatch(src, /localStorage\.setItem\([^)]*[Qq]ty/);
  assert.doesNotMatch(src, /StateStore\.set\([^)]*caseQtyDrafts/);
  assert.doesNotMatch(src, /PackLibrary\.update\([^)]*caseQtyDrafts/);
});

// ===========================================================================
// CASES PAGE (Requirements 28-41)
// ===========================================================================

test('Requirement 28: workspace Quantity counts active non-hidden physical instances across all Load Plans', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [
      basePack({ id: 'p1', cases: [insideInstance({ id: 'a' }), outsideInstance({ id: 'b' })] }),
      basePack({ id: 'p2', cases: [insideInstance({ id: 'c' }), outsideInstance({ id: 'd', hidden: true })] }),
    ],
    folderLibrary: [],
    preferences: {},
  });
  const quantities = PackLibrary.getWorkspaceCaseQuantities();
  assert.equal(quantities.get('case-a'), 3);
});

test('Requirement 29: zero quantity for a Case with no physical instances anywhere', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({ caseLibrary: [baseCase(), baseCase({ id: 'case-b' })], packLibrary: [basePack()], folderLibrary: [], preferences: {} });
  const quantities = PackLibrary.getWorkspaceCaseQuantities();
  assert.equal(quantities.get('case-b') || 0, 0);
});

test('Requirement 30: singular/plural Grid chip text', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  assert.match(src, /qtyBadge\.textContent = `\$\{qty\} unit\$\{qty === 1 \? '' : 's'\}`;/);
});

test('Requirement 31: List column shows a plain numeric cell', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  assert.match(src, /tdQty\.textContent = String\(quantities\.get\(c\.id\) \|\| 0\);/);
});

test('Requirement 32: Quantity is a sort option', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  assert.match(src, /\{ key: 'quantity', label: 'Quantity' \}/);
  assert.match(src, /case 'quantity':\s*valA = quantities\.get\(a\.id\) \|\| 0;\s*valB = quantities\.get\(b\.id\) \|\| 0;/);
});

test('Requirement 33: numeric sort produces stable ties (Node Array#sort is stable)', () => {
  const items = [
    { id: 'x', qty: 5, order: 0 },
    { id: 'y', qty: 5, order: 1 },
    { id: 'z', qty: 5, order: 2 },
  ];
  const sorted = [...items].sort((a, b) => a.qty - b.qty);
  assert.deepEqual(sorted.map(i => i.id), ['x', 'y', 'z']);
});

test('Requirement 34: Grid and List share the same one-pass workspaceQuantities map for order parity', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  assert.match(src, /const workspaceQuantities = PackLibrary\.getWorkspaceCaseQuantities\(\);/);
  assert.match(src, /renderTable\(workspaceQuantities\);/);
  assert.match(src, /renderViewMode\(mode, workspaceQuantities\);/);
});

test('Requirement 35: Quantity Card Display controls Grid chip and List column visibility consistently', async () => {
  const casesSrc = await fs.readFile(casesScreenPath, 'utf8');
  assert.match(casesSrc, /badgePrefs\.showQuantity !== false/);
  assert.match(casesSrc, /set\('quantity', badgePrefs\.showQuantity !== false\);/);
  const overlaySrc = await fs.readFile(cardDisplayOverlayPath, 'utf8');
  assert.match(overlaySrc, /item\('Quantity', cases\.showQuantity !== false/);
});

test('Requirement 36: workspace isolation — quantities only reflect the currently active packLibrary', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'a' })] })],
    folderLibrary: [],
    preferences: {},
  });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 1);

  // Simulate a workspace switch: re-init with a different packLibrary.
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ id: 'other', cases: [insideInstance({ id: 'b' }), insideInstance({ id: 'c' })] })],
    folderLibrary: [],
    preferences: {},
  });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 2);
});

test('Requirement 37: Load Plan deletion immediately reduces derived Quantity', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [
      basePack({ id: 'p1', cases: [insideInstance({ id: 'a' })] }),
      basePack({ id: 'p2', cases: [insideInstance({ id: 'b' })] }),
    ],
    folderLibrary: [],
    preferences: {},
  });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 2);
  PackLibrary.remove('p2');
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 1);
});

test('Requirement 38: Load Plan duplication increases derived Quantity by the duplicated instance count', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'a' }), insideInstance({ id: 'b' })] })],
    folderLibrary: [],
    preferences: {},
  });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 2);
  PackLibrary.duplicate('pack-1');
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 4);
});

test('Requirement 39: hide/unhide updates derived Quantity', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'a' })] })],
    folderLibrary: [],
    preferences: {},
  });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 1);
  PackLibrary.updateInstance('pack-1', 'a', { hidden: true });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a') || 0, 0);
  PackLibrary.updateInstance('pack-1', 'a', { hidden: false });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), 1);
});

test('Requirement 40: folder assignment does not alter derived Quantity', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'a' })] })],
    folderLibrary: [{ id: 'f1', name: 'Folder', scope: 'pack', parentFolderId: null, sortOrder: 0, createdAt: 0, updatedAt: 0 }],
    preferences: {},
  });
  const before = PackLibrary.getWorkspaceCaseQuantities().get('case-a');
  PackLibrary.update('pack-1', { folderId: 'f1' });
  assert.equal(PackLibrary.getWorkspaceCaseQuantities().get('case-a'), before);
});

test('Requirement 41: workspace Quantity is aggregated once per render, not once per Case', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  const getWorkspaceCalls = src.match(/PackLibrary\.getWorkspaceCaseQuantities\(\)/g) || [];
  assert.equal(getWorkspaceCalls.length, 1, 'getWorkspaceCaseQuantities must be called exactly once per render() invocation');
});

// ===========================================================================
// LOAD PLANS PAGE (Requirements 42-51)
// ===========================================================================

test('Requirement 42: separate Cases/Packed columns are consolidated into one Cases Qty', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  assert.doesNotMatch(src, /showCasesCount|showPacked\b|compareCases\b|comparePacked\b/);
  assert.match(src, /\{ key: 'casesQty', label: 'Cases Qty' \}/);
  const html = await fs.readFile(indexHtmlPath, 'utf8');
  assert.doesNotMatch(html, /data-sort="cases"|data-sort="packed"/);
  assert.match(html, /data-sort="casesQty"/);
});

test('Requirement 43: List Cases Qty value is inTruck/total', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  assert.match(src, /tdCasesQty\.textContent = inTruckQty === null \|\| totalQty === null \? '—' : `\$\{inTruckQty\}\/\$\{totalQty\}`;/);
});

test('Requirement 43: Cases Qty sorting uses live non-hidden instances, never persisted stats', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  assert.match(src, /const casesQtyByPack = new Map\([\s\S]*\(pack\.cases \|\| \[\]\)\.reduce\(/);
  assert.match(src, /instance && !instance\.hidden \? 1 : 0/);
  assert.match(src, /const compareCasesQty = \(a, b\) => \(casesQtyByPack\.get\(a\) \|\| 0\) - \(casesQtyByPack\.get\(b\) \|\| 0\);/);
  assert.doesNotMatch(src, /totalCasesQty\s*=\s*p\s*=>[\s\S]*p\.stats/);
});

test('Requirement 44: Grid chip reads "Cases Qty: inTruck/total"', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  assert.match(src, /casesQtyBadge\.textContent = `Cases Qty: \$\{inTruck\}\/\$\{total\}`;/);
});

test('Requirement 45: Cases Qty Card Display option (default on)', async () => {
  const overlaySrc = await fs.readFile(cardDisplayOverlayPath, 'utf8');
  assert.match(overlaySrc, /item\('Cases Qty', packs\.showCasesQty !== false/);
  assert.doesNotMatch(overlaySrc, /item\('Cases Count'|item\('Packed'/);
  const defaultsSrc = await fs.readFile(new URL('../../src/core/defaults.js', import.meta.url), 'utf8');
  assert.match(defaultsSrc, /showCasesQty: true,/);
});

test('Requirement 46: legacy showCasesCount/showPacked preferences normalize into showCasesQty', async () => {
  const { CoreNormalizer } = await loadModules();
  const bothOn = CoreNormalizer.normalizePreferences({ gridCardBadges: { packs: { showCasesCount: true, showPacked: true } } });
  assert.equal(bothOn.gridCardBadges.packs.showCasesQty, true);

  const oneOff = CoreNormalizer.normalizePreferences({ gridCardBadges: { packs: { showCasesCount: true, showPacked: false } } });
  assert.equal(oneOff.gridCardBadges.packs.showCasesQty, false);

  const explicit = CoreNormalizer.normalizePreferences({
    gridCardBadges: { packs: { showCasesCount: false, showPacked: false, showCasesQty: true } },
  });
  assert.equal(explicit.gridCardBadges.packs.showCasesQty, true, 'an explicit showCasesQty must win over legacy flags');

  const missing = CoreNormalizer.normalizePreferences({});
  assert.equal(missing.gridCardBadges.packs.showCasesQty, true, 'missing values normalize to enabled');
});

test('Requirement 47: Grid and List derive Cases Qty from the same stats fields (no competing computation)', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const listUses = src.match(/stats\.packedCases/g) || [];
  const gridUses = src.match(/stats && Number\.isFinite\(stats\.packedCases\) \? stats\.packedCases : (0|null)/g) || [];
  assert.ok(listUses.length >= 2 && gridUses.length >= 1, 'both List and Grid must read stats.packedCases/totalCases/hiddenCases');
});

test('Requirement 48: hidden instances are excluded from the Cases Qty total', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'a' }), outsideInstance({ id: 'b', hidden: true })] })],
    folderLibrary: [],
    preferences: {},
  });
  const stats = PackLibrary.computeStats(PackLibrary.getById('pack-1'));
  const total = stats.totalCases - stats.hiddenCases;
  assert.equal(total, 1);
});

test('Requirement 49: Unpack preserves total, only the inTruck numerator changes', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'a' }), insideInstance({ id: 'b' })] })],
    folderLibrary: [],
    preferences: {},
  });
  const before = PackLibrary.computeStats(PackLibrary.getById('pack-1'));
  assert.equal(before.packedCases, 2);
  const totalBefore = before.totalCases - before.hiddenCases;

  // Simulate Unpack: move one instance outside the truck geometry.
  PackLibrary.updateInstance('pack-1', 'b', { transform: outsideInstance().transform });
  const after = PackLibrary.computeStats(PackLibrary.getById('pack-1'));
  const totalAfter = after.totalCases - after.hiddenCases;

  assert.equal(after.packedCases, 1);
  assert.equal(totalAfter, totalBefore, 'total physical quantity must not change from Unpack');
});

test('Requirement 50: Truck Change preserves total physical quantity', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  StateStore.init({
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ cases: [insideInstance({ id: 'a' }), insideInstance({ id: 'b' })] })],
    folderLibrary: [],
    preferences: {},
  });
  const before = PackLibrary.computeStats(PackLibrary.getById('pack-1'));
  const totalBefore = before.totalCases - before.hiddenCases;
  PackLibrary.update('pack-1', { truck: rectTruck({ length: 300, width: 100, height: 100 }) });
  const after = PackLibrary.computeStats(PackLibrary.getById('pack-1'));
  const totalAfter = after.totalCases - after.hiddenCases;
  assert.equal(totalAfter, totalBefore, 'a truck geometry change must never create or delete physical instances');
});

test('Requirement 51: Auto-Pack is untouched — it continues consuming only pack.cases, never Quantity Controls state', async () => {
  const [engineSrc, solverSrc] = await Promise.all([
    fs.readFile(autopackEnginePath, 'utf8'),
    fs.readFile(autopackSolverPath, 'utf8'),
  ]);
  const forbidden = /caseRequirements|requiredQuantity|caseQtyDrafts|getCaseQtyDraft|addInstancesToStaging/;
  assert.doesNotMatch(engineSrc, forbidden);
  assert.doesNotMatch(solverSrc, forbidden);
});

// ===========================================================================
// LEGACY QUANTITY-TARGET SANITATION
// ===========================================================================

test('legacy Pack normalization discards obsolete targets without changing physical instances', async () => {
  const { CoreNormalizer } = await loadModules();
  const caseA = baseCase();
  const legacy = legacyQuantityPack();
  const normalized = CoreNormalizer.normalizePack(legacy, new Map([[caseA.id, caseA]]));

  assert.equal(normalized.caseRequirements, undefined);
  assert.equal(normalized.cases.length, legacy.cases.length);
  assert.deepEqual(normalized.cases.map(instance => instance.caseId), legacy.cases.map(instance => instance.caseId));
});

test('legacy Load Plan JSON imports successfully and discards obsolete targets', async () => {
  const { StateStore, PackLibrary, ImportExport } = await loadModules();
  const caseA = baseCase();
  const legacy = legacyQuantityPack();
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });

  const parsed = ImportExport.parsePackImportJSON(JSON.stringify({ pack: legacy, bundledCases: [caseA] }));
  assert.equal(parsed.pack.caseRequirements, undefined);
  const imported = PackLibrary.importPackPayload(parsed);
  assert.equal(imported.caseRequirements, undefined);
  assert.equal(imported.cases.length, legacy.cases.length);
  assert.equal(StateStore.get('caseLibrary')[0].name, caseA.name);
  assert.deepEqual(StateStore.get('caseLibrary')[0].dimensions, caseA.dimensions);
});

test('legacy App Backup imports successfully and discards obsolete targets', async () => {
  const { ImportExport } = await loadModules();
  const caseA = baseCase();
  const legacy = legacyQuantityPack();
  const restored = ImportExport.parseAppImportJSON(JSON.stringify({
    app: 'Truck Packer 3D',
    data: {
      caseLibrary: [caseA],
      packLibrary: [legacy],
      folderLibrary: [],
      preferences: {},
    },
  }));

  assert.equal(restored.packLibrary[0].caseRequirements, undefined);
  assert.equal(restored.packLibrary[0].cases.length, legacy.cases.length);
  assert.equal(restored.caseLibrary[0].name, caseA.name);
  assert.deepEqual(restored.caseLibrary[0].dimensions, caseA.dimensions);
});

test('legacy Workspace import discards obsolete targets without changing libraries', async () => {
  const { ImportExport } = await loadModules();
  const caseA = baseCase();
  const legacy = legacyQuantityPack();
  const restored = ImportExport.parseWorkspaceImportJSON(JSON.stringify({
    app: 'Truck Packer 3D',
    exportType: 'workspace',
    schemaVersion: 'workspace-export-v1',
    workspaceName: 'Legacy Workspace',
    data: { caseLibrary: [caseA], packLibrary: [legacy], folderLibrary: [] },
  }));

  assert.equal(restored.packLibrary[0].caseRequirements, undefined);
  assert.equal(restored.packLibrary[0].cases.length, legacy.cases.length);
  assert.deepEqual(restored.caseLibrary, [caseA]);
});

test('new Load Plan, App Backup, and Workspace exports never emit obsolete targets or temporary Qty state', async () => {
  const { StateStore, ImportExport } = await loadModules();
  const caseA = baseCase();
  const legacy = legacyQuantityPack();
  StateStore.init({ caseLibrary: [caseA], packLibrary: [legacy], folderLibrary: [], preferences: {} });

  const exports = [
    ImportExport.buildPackExportJSON(legacy),
    ImportExport.buildAppExportJSON(),
    ImportExport.buildWorkspaceExportJSON('QA Workspace'),
  ];
  exports.forEach(json => {
    assert.doesNotMatch(json, /caseRequirements|requiredQuantity|caseQtyDrafts/);
    const parsed = JSON.parse(json);
    const packs = parsed.pack ? [parsed.pack] : parsed.data.packLibrary;
    assert.equal(packs[0].cases.length, legacy.cases.length);
  });
  assert.deepEqual(StateStore.get('caseLibrary'), [caseA]);
});

test('normal scoped storage load/save removes and persists the obsolete field without a schema bump', async () => {
  const { StateStore, CoreStorage } = await loadModules();
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const priorWindow = globalThis.window;
  const localStorage = createMemoryLocalStorage();
  const userId = 'quantity-sanitizer-user';
  const workspaceId = 'quantity-sanitizer-workspace';
  const userKey = `${CoreStorage.STORAGE_KEY}:${userId}`;
  const workspaceKey = `${userKey}:workspace:${workspaceId}`;
  const legacy = legacyQuantityPack();

  try {
    globalThis.window = { localStorage };
    CoreStorage.setStorageScope(userId);
    CoreStorage.setWorkspaceScope(workspaceId);
    localStorage.setItem(userKey, JSON.stringify({ version: '1.0.0', savedAt: 1, preferences: {} }));
    localStorage.setItem(workspaceKey, JSON.stringify({
      version: '1.0.0',
      savedAt: 1,
      caseLibrary: [baseCase()],
      packLibrary: [legacy],
      folderLibrary: [],
      currentPackId: legacy.id,
    }));

    const loaded = CoreStorage.load();
    assert.equal(loaded.packLibrary[0].caseRequirements, undefined);
    assert.equal(loaded.packLibrary[0].cases.length, legacy.cases.length);
    const rewritten = localStorage.getItem(workspaceKey);
    assert.doesNotMatch(rewritten, /caseRequirements|requiredQuantity/);
    assert.equal(JSON.parse(rewritten).version, '1.0.0');

    StateStore.init({
      caseLibrary: [baseCase()],
      packLibrary: [legacy],
      folderLibrary: [],
      preferences: {},
      currentPackId: legacy.id,
    });
    CoreStorage.saveNow();
    const saved = localStorage.getItem(workspaceKey);
    assert.doesNotMatch(saved, /caseRequirements|requiredQuantity/);
    assert.equal(JSON.parse(saved).packLibrary[0].cases.length, legacy.cases.length);
  } finally {
    CoreStorage.setStorageScope('anon');
    CoreStorage.setWorkspaceScope('no-org');
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
  }
});

test('Pack update and duplication boundaries cannot carry obsolete targets forward', async () => {
  const { StateStore, PackLibrary } = await loadModules();
  const legacy = legacyQuantityPack();
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [legacy], folderLibrary: [], preferences: {} });

  const updated = PackLibrary.update(legacy.id, { title: 'Updated Legacy Plan' });
  assert.equal(updated.caseRequirements, undefined);
  assert.equal(updated.cases.length, legacy.cases.length);

  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [legacy], folderLibrary: [], preferences: {} });
  const duplicated = PackLibrary.duplicate(legacy.id);
  assert.equal(duplicated.caseRequirements, undefined);
  assert.equal(duplicated.cases.length, legacy.cases.length);
});

// ===========================================================================
// DATA BOUNDARIES (Requirements 52-64)
// ===========================================================================

test('Requirement 52: Load Plan JSON export/import preserves every physical instance, repeats included, no Qty/caseRequirements field', async () => {
  const { StateStore, ImportExport } = await loadModules();
  const caseA = baseCase();
  const pack = basePack({ cases: [insideInstance({ id: 'i1' }), insideInstance({ id: 'i2' }), outsideInstance({ id: 'i3' })] });
  StateStore.init({ caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const payload = ImportExport.buildPackExportPayload(pack);
  assert.equal(payload.bundledCases.length, 1, 'repeated physical instances bundle one reusable Case definition');
  assert.equal(payload.bundledCases[0].id, 'case-a');
  const json = ImportExport.buildPackExportJSON(pack);
  assert.doesNotMatch(json, /caseRequirements/);
  const parsed = ImportExport.parsePackImportJSON(json);
  assert.equal(parsed.pack.cases.length, 3);
  const ids = parsed.pack.cases.map(i => i.id).sort();
  assert.deepEqual(ids, ['i1', 'i2', 'i3']);
});

test('Requirement 52: blank dangling Case references remain explicitly diagnosed as unknown', async () => {
  const { StateStore, ImportExport } = await loadModules();
  const pack = basePack({ cases: [insideInstance({ id: 'blank-ref', caseId: '' })] });
  StateStore.init({ caseLibrary: [], packLibrary: [pack], folderLibrary: [], preferences: {} });

  const payload = ImportExport.buildPackExportPayload(pack);
  assert.deepEqual(payload.unresolvedCaseRefs, ['unknown']);
  assert.equal(payload.pack.cases.length, 1, 'the malformed physical instance remains preserved for recovery');
  assert.equal(payload.pack.cases[0].caseId, '');
});

test('Requirement 53: App Backup export/import round-trips Case Library, Load Plans, physical instances, and preferences', async () => {
  const { StateStore, ImportExport } = await loadModules();
  const caseA = baseCase();
  const pack = basePack({ cases: [insideInstance({ id: 'i1' }), outsideInstance({ id: 'i2' })] });
  StateStore.init({
    caseLibrary: [caseA],
    packLibrary: [pack],
    folderLibrary: [],
    preferences: { gridCardBadges: { cases: { showQuantity: false }, packs: { showCasesQty: false } } },
  });
  const json = ImportExport.buildAppExportJSON();
  assert.doesNotMatch(json, /caseRequirements/);
  const restored = ImportExport.parseAppImportJSON(json);
  assert.equal(restored.packLibrary[0].cases.length, 2);
  assert.equal(restored.caseLibrary.length, 1);
  assert.equal(restored.preferences.gridCardBadges.cases.showQuantity, false);
  assert.equal(restored.preferences.gridCardBadges.packs.showCasesQty, false);
});

test('Requirement 54: Workspace export/import isolates quantities to the correct workspace with exact physical instance counts', async () => {
  const { StateStore, ImportExport } = await loadModules();
  const caseA = baseCase();
  const pack = basePack({ cases: [insideInstance({ id: 'i1' }), insideInstance({ id: 'i2' }), insideInstance({ id: 'i3' })] });
  StateStore.init({ caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {} });
  const json = ImportExport.buildWorkspaceExportJSON('QA Workspace');
  const restored = ImportExport.parseWorkspaceImportJSON(json);
  assert.equal(restored.packLibrary[0].cases.length, 3);
  assert.equal(restored.workspaceName, 'QA Workspace');
});

test('Requirement 55: no temporary Qty selector value ever appears in an export payload', async () => {
  const { StateStore, ImportExport } = await loadModules();
  const pack = basePack({ cases: [insideInstance()] });
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [pack], folderLibrary: [], preferences: {} });
  const packJson = ImportExport.buildPackExportJSON(pack);
  const appJson = ImportExport.buildAppExportJSON();
  const workspaceJson = ImportExport.buildWorkspaceExportJSON('QA');
  for (const json of [packJson, appJson, workspaceJson]) {
    assert.doesNotMatch(json, /caseQtyDrafts/);
    assert.doesNotMatch(json, /"qty"\s*:/i);
  }
});

test('Requirement 56: no caseRequirements field remains anywhere in normalized/exported data', async () => {
  const { StateStore, CoreNormalizer, ImportExport } = await loadModules();
  const pack = basePack({ cases: [insideInstance()] });
  StateStore.init({ caseLibrary: [baseCase()], packLibrary: [pack], folderLibrary: [], preferences: {} });
  const normalized = CoreNormalizer.normalizePack(pack, new Map([['case-a', baseCase()]]));
  assert.equal(normalized.caseRequirements, undefined);
  assert.doesNotMatch(ImportExport.buildPackExportJSON(pack), /caseRequirements/);
  assert.doesNotMatch(ImportExport.buildAppExportJSON(), /caseRequirements/);
});

test('Requirement 57: Case CSV/XLSX import/template has no Quantity storage field', async () => {
  const { ImportExport } = await loadModules();
  const csv = ImportExport.buildCasesTemplateCSV();
  const header = csv.split('\n')[0];
  assert.doesNotMatch(header, /quantity|qty/i);
});

test('Requirement 58: the only Load Plan CSV/manifest export (buildCargoInstructionsManifest) is a notes manifest, not a quantity export — no separate Case-quantity CSV/XLSX export exists', async () => {
  const src = await fs.readFile(new URL('../../src/services/import-export.js', import.meta.url), 'utf8');
  const exportedFns = [...src.matchAll(/^export function (\w+)/gm)].map(m => m[1]);
  const csvLikeExports = exportedFns.filter(name => /csv|manifest|template/i.test(name));
  assert.deepEqual(
    csvLikeExports.sort(),
    ['buildCargoInstructionsManifest', 'buildCasesTemplateCSV', 'downloadCasesTemplate'].sort()
  );
  const manifestBlock = extractFunctionBlock(src, 'export function buildCargoInstructionsManifest(pack, getCaseById = CaseLibrary.getById) {', '\n}');
  assert.doesNotMatch(manifestBlock, /caseRequirements|requiredQuantity|quantity:/i);
});

test('PDF checklist aggregation groups repeated resolved Case instances and preserves first-occurrence order', async () => {
  const { ImportExport } = await loadModules();
  const caseA = baseCase({ id: 'case-a', name: 'Shared Name' });
  const caseB = baseCase({ id: 'case-b', name: 'Shared Name', weight: 9 });
  const cases = new Map([[caseA.id, caseA], [caseB.id, caseB]]);
  const pack = basePack({
    cases: [
      insideInstance({ id: 'a1', caseId: 'case-a' }),
      insideInstance({ id: 'b1', caseId: 'case-b' }),
      outsideInstance({ id: 'a2', caseId: 'case-a' }),
    ],
  });

  const rows = ImportExport.buildCaseChecklistRows(pack, caseId => cases.get(caseId) || null);
  assert.deepEqual(rows.map(row => row.identityKey), ['case:case-a', 'case:case-b']);
  assert.deepEqual(rows.map(row => row.qty), [2, 1]);
  assert.equal(rows[0].caseData.name, rows[1].caseData.name, 'same display name remains two rows when caseIds differ');
});

test('PDF checklist unresolved references use deterministic fallback grouping', async () => {
  const { ImportExport } = await loadModules();
  const pack = basePack({
    cases: [
      insideInstance({ id: 'g1', caseId: 'ghost' }),
      outsideInstance({ id: 'g2', caseId: 'ghost' }),
      insideInstance({ id: 'o1', caseId: 'other-missing' }),
      insideInstance({ id: 'u1', caseId: '' }),
      outsideInstance({ id: 'u2', caseId: '' }),
    ],
  });

  const rows = ImportExport.buildCaseChecklistRows(pack, () => null);
  assert.deepEqual(
    rows.map(row => [row.identityKey, row.qty]),
    [['missing:ghost', 2], ['missing:other-missing', 1], ['missing:unknown', 2]]
  );
});

test('PDF checklist Qty sum equals the legacy included physical-instance set, including hidden instances', async () => {
  const { ImportExport } = await loadModules();
  const caseA = baseCase();
  const pack = basePack({
    cases: [
      insideInstance({ id: 'visible', hidden: false }),
      outsideInstance({ id: 'hidden', hidden: true }),
    ],
  });
  const rows = ImportExport.buildCaseChecklistRows(pack, () => caseA);
  assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), pack.cases.length);
  assert.equal(rows[0].qty, 2, 'aggregation must not silently change the old checklist hidden-item semantics');
});

test('PDF checklist aggregation leaves Cargo Instructions aggregation unchanged', async () => {
  const { ImportExport } = await loadModules();
  const caseA = baseCase({ notes: 'Keep upright.' });
  const pack = basePack({
    cases: [
      insideInstance({ id: 'item-1', instanceNotes: 'Unload first.' }),
      outsideInstance({ id: 'item-2', instanceNotes: null }),
    ],
  });
  const manifest = ImportExport.buildCargoInstructionsManifest(pack, () => caseA);
  assert.equal(manifest.caseEntries.length, 1, 'Case instructions remain aggregated once per reusable Case');
  assert.equal(manifest.caseEntries[0].caseNotes, 'Keep upright.');
  assert.equal(manifest.itemEntries.length, 1, 'Item Notes remain owned by their physical instance');
  assert.equal(manifest.itemEntries[0].itemNotes, 'Unload first.');
});

test('PDF source renders aggregated Qty rows while preserving views, Cargo Instructions, Summary, and pagination', async () => {
  const src = await fs.readFile(appJsPath, 'utf8');
  const pdfStart = src.indexOf('function generatePDF()');
  const pdfEnd = src.indexOf('\n      function getCurrentPack()', pdfStart);
  const pdfBlock = src.slice(pdfStart, pdfEnd);
  const checklistStart = src.indexOf('function buildChecklist(pack)');
  const checklistEnd = src.indexOf('\n      function renderCameraToDataUrl', checklistStart);
  const checklistBlock = src.slice(checklistStart, checklistEnd);

  for (const heading of ['PERSPECTIVE VIEW', 'TOP VIEW', 'SIDE VIEW', 'CASE CHECKLIST', 'CARGO INSTRUCTIONS', 'SUMMARY']) {
    assert.match(pdfBlock, new RegExp(heading));
  }
  for (const heading of ["doc.text('#', x0, y)", "doc.text('Qty', xQty, y)", "doc.text('Name', xName, y)", "doc.text('Category', xCategory, y)", "doc.text('Dims', xDims, y)", "doc.text('Unit Weight', xWeight, y)"]) {
    assert.ok(pdfBlock.includes(heading), `PDF checklist must contain ${heading}`);
  }
  assert.match(pdfBlock, /doc\.text\(String\(e\.qty\), xQty, y\)/);
  assert.match(pdfBlock, /writeChecklistHeader\(\)/, 'continuation pages retain checklist headers');
  assert.match(pdfBlock, /Page \$\{i\} of \$\{totalPages\}/, 'page footers remain intact');
  assert.match(pdfBlock, /ImportExport\.buildCargoInstructionsManifest\(pack\)/);
  assert.match(pdfBlock, /Cases loaded: \$\{stats\.totalCases\}/);
  assert.match(checklistBlock, /ImportExport\.buildCaseChecklistRows\(pack\)\.map\(row =>/);
  assert.doesNotMatch(checklistBlock, /\(pack\.cases \|\| \[\]\)\.map/,
    'the old one-output-row-per-instance checklist path must be absent');
  assert.doesNotMatch(pdfBlock, /caseRequirements|requiredQuantity|caseQtyDrafts|Target met|Over target/);
});

test('Requirement 59: PDF quantity aggregation reflects actual physical instances (stats.packedCases/totalCases), no Target/Missing/Qty-selector values', async () => {
  const src = await fs.readFile(appJsPath, 'utf8');
  assert.match(src, /doc\.text\(`Cases loaded: \$\{stats\.totalCases\}`, margin, y\);/);
  assert.match(src, /doc\.text\(`Packed \(in truck\): \$\{stats\.packedCases\}`, margin, y\);/);
  const pdfFnStart = src.indexOf('function generatePDF()');
  const pdfFnEnd = src.indexOf('\n      function buildChecklist', pdfFnStart);
  const pdfBlock = src.slice(pdfFnStart, pdfFnEnd > pdfFnStart ? pdfFnEnd : pdfFnStart + 20000);
  assert.doesNotMatch(pdfBlock, /caseRequirements|requiredQuantity|Target met|Over target|caseQtyDrafts/);
});

test('Requirement 60: PNG capture path has no stored Qty metadata', async () => {
  const src = await fs.readFile(appJsPath, 'utf8');
  const block = extractFunctionBlock(src, 'function captureScreenshot() {', '\n      }');
  assert.doesNotMatch(block, /caseQtyDrafts|caseRequirements|Qty/);
});

test('Requirement 61: no database migration was introduced for derived UI quantities', async () => {
  const migrationsDir = path.join(fileURLToPath(repoRoot), 'supabase', 'migrations');
  const entries = await fs.readdir(migrationsDir);
  for (const entry of entries) {
    if (!entry.endsWith('.sql')) continue;
    const text = await fs.readFile(path.join(migrationsDir, entry), 'utf8');
    assert.doesNotMatch(text, /caseRequirements|requiredQuantity|case_requirement/i, `${entry} must not reference the rejected quantity model`);
  }
});

test('Requirement 62: legacy Packs (saved before Quantity Controls, or with a stray legacy caseRequirements field) continue loading', async () => {
  const { CoreNormalizer } = await loadModules();
  const legacyPackNoField = { id: 'legacy-1', title: 'Legacy', truck: rectTruck(), cases: [insideInstance()] };
  const normalizedA = CoreNormalizer.normalizePack(legacyPackNoField, new Map([['case-a', baseCase()]]));
  assert.equal(normalizedA.cases.length, 1);
  assert.equal(normalizedA.caseRequirements, undefined);

  // A pack saved by an even older build with a stray caseRequirements array must not throw.
  const legacyPackWithField = { ...legacyPackNoField, caseRequirements: [{ caseId: 'case-a', requiredQuantity: 5 }] };
  const normalizedB = CoreNormalizer.normalizePack(legacyPackWithField, new Map([['case-a', baseCase()]]));
  assert.equal(normalizedB.cases.length, 1);
  assert.equal(normalizedB.caseRequirements, undefined, 'the stray legacy field must be dropped silently, never re-surfaced');
});

test('Requirement 63: existing folder relationships remain intact through normalization', async () => {
  const { CoreNormalizer } = await loadModules();
  const data = {
    caseLibrary: [baseCase()],
    packLibrary: [basePack({ folderId: 'f1', cases: [insideInstance()] })],
    folderLibrary: [{ id: 'f1', name: 'Folder A' }],
    preferences: {},
  };
  const normalized = CoreNormalizer.normalizeAppData(data);
  assert.equal(normalized.packLibrary[0].folderId, 'f1');
  assert.equal(normalized.folderLibrary[0].id, 'f1');
});

test('Requirement 64: existing security/invariant tests remain valid — the obsolete Target/Missing coupling was fully removed from that suite', async () => {
  const src = await fs.readFile(new URL('../../tests/audit/security-and-invariants.spec.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /getCaseQuantityStatus|setCaseRequirement|removeCaseRequirement|buildCaseQuantitySection|computeAddButtonState|configureQuantityAddButton/);
});

// ===========================================================================
// BUG 1 — Cases Card Display Handling/Quantity swap regression tests
//
// Root cause: the Handling <th> was looked up positionally via
// catTh.nextElementSibling. That was correct only while Handling sat
// immediately after Category in the header. Once a Quantity <th> was
// inserted between Category and Handling, "handlingTh" silently became a
// reference to an adjacent header instead — so changing the visible column
// order could silently connect Handling visibility to the wrong field. Keep
// the stable data-column="handling" selector (matching Notes) while Quantity
// remains independently addressable through data-sort="quantity".
// ===========================================================================

test('Cases List header order places Quantity between Manufacturer and Length while preserving the stable tail columns', async () => {
  const html = await fs.readFile(indexHtmlPath, 'utf8');
  const tableStart = html.indexOf('id="cases-tbody"');
  assert.ok(tableStart > 0, 'expected to find the Cases table');
  const headerBlock = html.slice(0, tableStart);
  const manufacturerIdx = headerBlock.lastIndexOf('data-sort="manufacturer"');
  const quantityIdx = headerBlock.lastIndexOf('data-sort="quantity"');
  const lengthIdx = headerBlock.lastIndexOf('data-sort="length"');
  const categoryIdx = headerBlock.lastIndexOf('data-sort="category"');
  const handlingIdx = headerBlock.lastIndexOf('data-column="handling"');
  const notesIdx = headerBlock.lastIndexOf('data-column="notes"');
  assert.ok(
    manufacturerIdx > 0 && quantityIdx > 0 && lengthIdx > 0 &&
      categoryIdx > 0 && handlingIdx > 0 && notesIdx > 0,
    'Manufacturer, Quantity, Length, Category, Handling, and Notes headers must all be present'
  );
  assert.ok(manufacturerIdx < quantityIdx, 'Quantity header must come after Manufacturer');
  assert.ok(quantityIdx < lengthIdx, 'Quantity header must come before Length');
  assert.ok(categoryIdx < handlingIdx, 'Handling header must come after Category');
  assert.ok(handlingIdx < notesIdx, 'Notes header must come after Handling');
});

test('Cases List row cells match the Quantity-between-Manufacturer-and-Length header order', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  const rowStart = src.indexOf("const tdMfg = document.createElement('td');");
  const rowEnd = src.indexOf("const tdActions = document.createElement('td');", rowStart);
  assert.ok(rowStart > 0 && rowEnd > rowStart, 'expected to find the Cases row-cell construction block');
  const rowBlock = src.slice(rowStart, rowEnd);
  const manufacturerIdx = rowBlock.indexOf('tr.appendChild(tdMfg)');
  const quantityIdx = rowBlock.indexOf('tr.appendChild(tdQty)');
  const lengthIdx = rowBlock.indexOf('tr.appendChild(tdLength)');
  const catIdx = rowBlock.indexOf("tr.appendChild(tdCat)");
  const handlingIdx = rowBlock.indexOf("tr.appendChild(tdHandling)");
  const notesIdx = rowBlock.indexOf("const tdNotes = document.createElement('td')");
  assert.ok(
    manufacturerIdx >= 0 && quantityIdx >= 0 && lengthIdx >= 0 &&
      catIdx >= 0 && handlingIdx >= 0 && notesIdx >= 0,
    'tdMfg, tdQty, tdLength, tdCat, tdHandling, and tdNotes must all be present'
  );
  assert.ok(manufacturerIdx < quantityIdx, 'tdQty must be appended after tdMfg');
  assert.ok(quantityIdx < lengthIdx, 'tdQty must be appended before tdLength');
  assert.ok(catIdx < handlingIdx, 'tdHandling must be appended after tdCat');
  assert.ok(handlingIdx < notesIdx, 'tdNotes must be appended after tdHandling');
});

test('applyListColumnVisibility looks up the Handling header by a stable data-column selector, not a positional DOM traversal', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function applyListColumnVisibility(prefs) {', '\n    }');
  assert.doesNotMatch(block, /nextElementSibling/,
    'the fragile catTh.nextElementSibling lookup must not return — it breaks silently whenever a column is inserted next to Handling');
  assert.match(block, /document\.querySelector\('#screen-cases table thead th\[data-column="handling"\]'\)/,
    'Handling header visibility must be looked up by its own stable data-column="handling" attribute');
  assert.match(block, /handlingTh\.style\.display = badgePrefs\.showHandling !== false \? '' : 'none'/,
    'the Handling header must be toggled by showHandling, not showQuantity');
  assert.match(block, /set\('quantity', badgePrefs\.showQuantity !== false\)/,
    'the Quantity header must remain toggled by showQuantity via the shared data-sort selector helper');
});

for (const [handlingOn, quantityOn] of [[true, true], [false, true], [true, false], [false, false]]) {
  test(`Cases List cell visibility: Handling ${handlingOn ? 'on' : 'off'}, Quantity ${quantityOn ? 'on' : 'off'} — each column responds only to its own flag`, async () => {
    const src = await fs.readFile(casesScreenPath, 'utf8');
    const rowStart = src.indexOf("const tdMfg = document.createElement('td');");
    const rowEnd = src.indexOf("const tdActions = document.createElement('td');", rowStart);
    const rowBlock = src.slice(rowStart, rowEnd);

    // Simulate the two independent guards exactly as written in source, using
    // this combination's badgePrefs values.
    const badgePrefs = { showHandling: handlingOn, showQuantity: quantityOn };
    /* eslint-disable no-unused-vars */
    const tdHandlingHidden = badgePrefs.showHandling === false;
    const tdQtyHidden = badgePrefs.showQuantity === false;
    /* eslint-enable no-unused-vars */
    assert.equal(tdHandlingHidden, !handlingOn);
    assert.equal(tdQtyHidden, !quantityOn);

    // Source-contract: the two guards are textually independent — neither
    // condition block for one field also assigns display:none to the other
    // field's cell (the exact defect this test suite would have caught).
    const handlingGuard = rowBlock.slice(
      rowBlock.indexOf('if (badgePrefs.showHandling === false) {'),
      rowBlock.indexOf('tr.appendChild(tdHandling)')
    );
    const qtyGuard = rowBlock.slice(
      rowBlock.indexOf('if (badgePrefs.showQuantity === false) {'),
      rowBlock.indexOf('tr.appendChild(tdQty)')
    );
    assert.match(handlingGuard, /tdHandling\.style\.display = 'none'/);
    assert.doesNotMatch(handlingGuard, /tdQty\.style\.display/);
    assert.match(qtyGuard, /tdQty\.style\.display = 'none'/);
    assert.doesNotMatch(qtyGuard, /tdHandling\.style\.display/);
  });
}

test('Cases Grid metadata follows the canonical Quantity, Dimensions, Volume, Weight, Category, Handling order', async () => {
  const src = await fs.readFile(casesScreenPath, 'utf8');
  const gridStart = src.indexOf("if (badgePrefs.showQuantity !== false) {");
  const gridEnd = src.indexOf("const selectCb = document.createElement('input');");
  const gridBlock = src.slice(gridStart, gridEnd);
  const fieldIndexes = [
    'showQuantity',
    'showDims',
    'showVolume',
    'showWeight',
    'showCategory',
    'showHandling',
  ].map(field => gridBlock.indexOf(`badgePrefs.${field}`));
  assert.ok(fieldIndexes.every(index => index >= 0), 'all canonical Grid fields must be present');
  assert.deepEqual(fieldIndexes, [...fieldIndexes].sort((a, b) => a - b),
    'Grid fields must be composed in canonical display order');

  const qtyChipBlock = gridBlock.slice(
    gridBlock.indexOf('if (badgePrefs.showQuantity'),
    gridBlock.indexOf('if (badgePrefs.showDims')
  );
  const handlingChipBlock = gridBlock.slice(gridBlock.indexOf('if (badgePrefs.showHandling'));
  assert.doesNotMatch(qtyChipBlock, /showHandling/, 'the Quantity chip must not reference showHandling');
  assert.doesNotMatch(handlingChipBlock, /showQuantity/, 'the Handling chip must not reference showQuantity');
  assert.match(qtyChipBlock, /qtyBadge\.textContent = `\$\{qty\} unit\$\{qty === 1 \? '' : 's'\}`;/);

  const cardAppendBlock = src.slice(
    src.indexOf('card.appendChild(head);', gridStart),
    src.indexOf('gridEl.appendChild(card);', gridStart)
  );
  const cardAppendIndexes = [
    'card.appendChild(head)',
    'card.appendChild(identityChips)',
    'card.appendChild(meta)',
    'card.appendChild(actions)',
  ].map(statement => cardAppendBlock.indexOf(statement));
  assert.ok(cardAppendIndexes.every(index => index >= 0));
  assert.deepEqual(cardAppendIndexes, [...cardAppendIndexes].sort((a, b) => a - b),
    'Grid DOM order must keep Name, identity, metadata, then Notes/actions');
});

test('Handling and Quantity defaults are independent and legacy-compatible: both default true, neither toggle affects the other via defaults/normalization', async () => {
  const { CoreNormalizer } = await loadModules();
  const defaults = CoreNormalizer.normalizePreferences({});
  assert.equal(defaults.gridCardBadges.cases.showHandling, true);
  assert.equal(defaults.gridCardBadges.cases.showQuantity, true);

  const handlingOffOnly = CoreNormalizer.normalizePreferences({
    gridCardBadges: { cases: { showHandling: false } },
  });
  assert.equal(handlingOffOnly.gridCardBadges.cases.showHandling, false);
  assert.equal(handlingOffOnly.gridCardBadges.cases.showQuantity, true,
    'disabling Handling must not affect the normalized Quantity preference');

  const quantityOffOnly = CoreNormalizer.normalizePreferences({
    gridCardBadges: { cases: { showQuantity: false } },
  });
  assert.equal(quantityOffOnly.gridCardBadges.cases.showQuantity, false);
  assert.equal(quantityOffOnly.gridCardBadges.cases.showHandling, true,
    'disabling Quantity must not affect the normalized Handling preference');

  // Preference persistence + rehydration round-trip (legacy object with only
  // a subset of keys saved, as a real localStorage snapshot might contain).
  const rehydrated = CoreNormalizer.normalizePreferences(
    CoreNormalizer.normalizePreferences({ gridCardBadges: { cases: { showHandling: false, showQuantity: false } } })
  );
  assert.equal(rehydrated.gridCardBadges.cases.showHandling, false);
  assert.equal(rehydrated.gridCardBadges.cases.showQuantity, false);
});

// ===========================================================================
// BUG 2 — Load Plans Grid reverting to List while idle
//
// Root cause: render(), updateViewButtons(), and updateBulkActions() each
// independently fell back to a FRESH `PreferencesManager.get().packsViewMode`
// read whenever they were called without an explicit modeOverride — which is
// how almost every rerender in this screen is triggered (search/sort/filter
// changes, StateStore subscriptions, dropdown closes, async completions,
// etc.). PreferencesManager.get() re-normalizes the ENTIRE live StateStore
// preferences object on every call, so any full-preferences overwrite that
// races in from elsewhere in the app (e.g. a workspace-scoped storage reload
// landing before the 250ms debounced save of an explicit Grid click has
// flushed to localStorage) is silently picked back up on the very next
// unrelated rerender, flipping the view back to whatever was last persisted
// (frequently 'list', a leftover from an earlier session). Fixed by
// introducing one canonical `currentViewMode` value that is populated from
// the persisted preference only once (first use / resolveViewMode's fallback
// branch), and is afterward changed ONLY by the explicit setViewMode() click
// handler — never re-derived from a live preferences read on every rerender.
// ===========================================================================

test('packs-screen.js declares one canonical currentViewMode value, initialized to null (no valid mode until first resolved)', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  assert.match(src, /let currentViewMode = null;/);
});

test('resolveViewMode() only falls back to the persisted preference when no canonical value is set yet (first-initialization only)', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function resolveViewMode() {', '\n    }');
  assert.match(block, /if \(currentViewMode === 'grid' \|\| currentViewMode === 'list'\) return currentViewMode;/,
    'an already-valid canonical value must be returned as-is, never replaced by a fallback read');
  assert.match(block, /currentViewMode = PreferencesManager\.get\(\)\.packsViewMode === 'list' \? 'list' : 'grid';/,
    'the fallback (first-initialization only) must normalize any non-"list" value to "grid"');
});

test('setViewMode() updates canonical state before persisting and rendering, in the required atomic order', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function setViewMode(mode) {', '\n    }');
  const canonicalIdx = block.indexOf('currentViewMode = nextMode;');
  const persistIdx = block.indexOf('PreferencesManager.set(prefs);');
  const renderIdx = block.indexOf('render(nextMode);');
  const buttonsIdx = block.indexOf('updateViewButtons(nextMode);');
  assert.ok(canonicalIdx >= 0 && persistIdx >= 0 && renderIdx >= 0 && buttonsIdx >= 0,
    'setViewMode must update canonical state, persist, render, and update buttons');
  assert.ok(canonicalIdx < persistIdx, '1. canonical state must be updated before persistence');
  assert.ok(persistIdx < renderIdx, '2. persistence must happen before the matching render');
  assert.ok(renderIdx < buttonsIdx, '3. render must happen before the button/ARIA update');
});

test('render(), updateViewButtons(), and updateBulkActions() resolve the view mode through resolveViewMode(), never a fresh PreferencesManager re-read', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  const renderBlock = extractFunctionBlock(src, 'function render(modeOverride) {', '\n      initFooter(mode);');
  assert.match(renderBlock, /modeOverride === 'list' \|\| modeOverride === 'grid' \? modeOverride : resolveViewMode\(\);/);

  const buttonsBlock = extractFunctionBlock(src, 'function updateViewButtons(modeOverride) {', '\n    }');
  assert.match(buttonsBlock, /: resolveViewMode\(\);/);

  const bulkBlock = extractFunctionBlock(src, 'function updateBulkActions() {', '\n    }');
  assert.match(bulkBlock, /const mode = resolveViewMode\(\);/);

  // No remaining call sites re-derive the mode from a fresh PreferencesManager
  // read outside resolveViewMode's own fallback branch and setViewMode's
  // persistence write (the only two places allowed to touch packsViewMode).
  const directReads = (src.match(/PreferencesManager\.get\(\)\.packsViewMode/g) || []).length;
  assert.equal(directReads, 1, 'exactly one direct read should remain: resolveViewMode\'s first-initialization fallback');
});

test('no timer, interval, or async completion writes packsViewMode or resets currentViewMode', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  assert.doesNotMatch(src, /setInterval/, 'no polling/correction timer may be introduced for view mode');
  // Every assignment to currentViewMode must be either the null initializer,
  // resolveViewMode's first-init fallback, or setViewMode's explicit write —
  // never inside a setTimeout/async callback.
  const assignments = [...src.matchAll(/currentViewMode\s*=(?!=)/g)];
  assert.equal(assignments.length, 3, 'currentViewMode must only ever be assigned in its declaration, resolveViewMode, and setViewMode');
});

test('resetWorkspaceState() does not touch currentViewMode or packsViewMode — workspace events must not alter Grid/List selection', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const block = extractFunctionBlock(src, 'function resetWorkspaceState() {', '\n    }');
  assert.doesNotMatch(block, /currentViewMode|packsViewMode|ViewMode/);
});

test('Load Plans and Cases view-mode state are fully independent (separate preference keys, separate module-level variables)', async () => {
  const [packsSrc, casesSrc] = await Promise.all([
    fs.readFile(packsScreenPath, 'utf8'),
    fs.readFile(casesScreenPath, 'utf8'),
  ]);
  assert.doesNotMatch(packsSrc, /casesViewMode/, 'Load Plans must never read or write the Cases view-mode key');
  assert.doesNotMatch(casesSrc, /packsViewMode|currentViewMode/, 'Cases must never read or write the Load Plans view-mode key/state');
});

test('normalizePreferences: an invalid persisted packsViewMode normalizes safely (any value other than "list" becomes "grid")', async () => {
  const { CoreNormalizer } = await loadModules();
  assert.equal(CoreNormalizer.normalizePreferences({ packsViewMode: 'list' }).packsViewMode, 'list');
  assert.equal(CoreNormalizer.normalizePreferences({ packsViewMode: 'grid' }).packsViewMode, 'grid');
  for (const invalid of [undefined, null, '', 'LIST', 'card', 42, {}]) {
    assert.equal(CoreNormalizer.normalizePreferences({ packsViewMode: invalid }).packsViewMode, 'grid');
  }
});
