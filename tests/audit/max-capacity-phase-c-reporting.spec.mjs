// Max Capacity Phase C reporting — canonical statistic and its consumers.
// Contract C (active Max Capacity profile membership, not per-case relaxation
// evidence): see docs/audits/max-capacity-phase-c-packed-profile-semantics-audit-2026-07-18.md.
// No DOM harness in this repo — UI/PDF pieces are source-contract tests
// (fs.readFile + slice a named function's body), matching
// tests/audit/autopack-results-carousel.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const appPath = new URL('../../src/app.js', import.meta.url);

const RECT_TRUCK = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
const MAX_PROFILE = 'max-capacity';

function makeCase(id, overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id, name: id, category: 'Default', color: '#999999', dimensions,
    volume: dimensions.length * dimensions.width * dimensions.height,
    weight: overrides.weight ?? 10, canFlip: overrides.canFlip ?? true,
    stackable: overrides.stackable ?? true, noStackOnTop: overrides.noStackOnTop ?? false,
    maxStackCount: overrides.maxStackCount ?? 0, orientationLock: overrides.orientationLock || 'any',
    ...overrides,
  };
}

function makeInstance(id, caseId, position, overrides = {}) {
  return {
    id, caseId,
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    hidden: false, groupId: null, placement: 'packed', ...overrides,
  };
}

function marked(inst) { return { ...inst, packedProfile: MAX_PROFILE }; }

async function loadPackLibrary(cases, instances, truck = RECT_TRUCK, packId = 'pack-phase-c-rpt') {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({
    caseLibrary: cases,
    packLibrary: [{ id: packId, title: 'Phase C Reporting', truck, cases: instances }],
    folderLibrary: [],
    preferences: {},
  });
  return { StateStore, PackLibrary, packId };
}

// ── computeStats(): the canonical statistic ──────────────────────────────────

test('PHASE-C-RPT-1 zero maxCapacityProfileCount for a normal pack with no Max Capacity instances', async () => {
  const caseData = makeCase('normal-case');
  const instances = [
    makeInstance('a', caseData.id, { x: 10, y: 5, z: 0 }),
    makeInstance('b', caseData.id, { x: 30, y: 5, z: 0 }),
  ];
  const { PackLibrary, packId } = await loadPackLibrary([caseData], instances);
  const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
  assert.equal(stats.maxCapacityProfileCount, 0);
});

test('PHASE-C-RPT-2 correct count for packed Max Capacity profile instances', async () => {
  const caseData = makeCase('marked-case');
  const instances = [
    marked(makeInstance('a', caseData.id, { x: 10, y: 5, z: 0 })),
    marked(makeInstance('b', caseData.id, { x: 30, y: 5, z: 0 })),
    marked(makeInstance('c', caseData.id, { x: 50, y: 5, z: 0 })),
  ];
  const { PackLibrary, packId } = await loadPackLibrary([caseData], instances);
  const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
  assert.equal(stats.maxCapacityProfileCount, 3);
  assert.equal(stats.packedCases, 3, 'sanity: all three are also counted as ordinary packed cases');
});

test('PHASE-C-RPT-3 staged/geometrically-outside instances are never counted, even if the raw field is present', async () => {
  const caseData = makeCase('staged-case');
  // Positioned outside the truck bounds (length 120) and NOT flagged placement:'staged'
  // in the raw data - computeStats() classifies by live geometry, not the stored
  // placement string, so this must still be excluded (matches "Packed in truck").
  const outside = marked(makeInstance('outside', caseData.id, { x: 500, y: 5, z: 0 }));
  const explicitlyStaged = marked(makeInstance('staged', caseData.id, { x: 10, y: 5, z: 0 }, { placement: 'staged' }));
  const { PackLibrary, packId } = await loadPackLibrary([caseData], [outside, explicitlyStaged]);
  const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
  assert.equal(stats.maxCapacityProfileCount, 0);
  assert.equal(stats.stagedCases >= 1, true);
});

test('PHASE-C-RPT-4 mixed normal and Max Capacity packed instances count only the marked ones', async () => {
  const caseData = makeCase('mixed-case');
  const instances = [
    marked(makeInstance('m1', caseData.id, { x: 10, y: 5, z: 0 })),
    makeInstance('n1', caseData.id, { x: 30, y: 5, z: 0 }),
    marked(makeInstance('m2', caseData.id, { x: 50, y: 5, z: 0 })),
    makeInstance('n2', caseData.id, { x: 70, y: 5, z: 0 }),
  ];
  const { PackLibrary, packId } = await loadPackLibrary([caseData], instances);
  const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
  assert.equal(stats.maxCapacityProfileCount, 2);
  assert.equal(stats.packedCases, 4);
});

test('PHASE-C-RPT-5 duplicate behavior is unchanged and stays consistent with Contract C', async () => {
  const caseData = makeCase('dup-case');
  const original = marked(makeInstance('dup-orig', caseData.id, { x: 20, y: 5, z: 0 }));
  const { PackLibrary, packId } = await loadPackLibrary([caseData], [original]);
  const pack = PackLibrary.getById(packId);
  const before = PackLibrary.computeStats(pack);
  assert.equal(before.maxCapacityProfileCount, 1);

  const result = PackLibrary.duplicateInstancesSafely(packId, [pack.cases[0]], [caseData]);
  assert.equal(result.newIds.length, 1, 'duplicate must still succeed (no duplicate-path change)');
  const dup = result.cases.find(c => c.id === result.newIds[0]);
  assert.equal(dup.placement, 'packed');
  assert.equal(dup.packedProfile, MAX_PROFILE, 'duplicate must still retain the marker (Contract C, unchanged)');

  const after = PackLibrary.computeStats({ ...pack, cases: result.cases });
  assert.equal(after.maxCapacityProfileCount, 2, 'canonical count correctly includes the duplicate');
});

test('PHASE-C-RPT-6 count returns to zero after Max Capacity cases are removed or unpacked', async () => {
  const caseData = makeCase('remove-case');
  const instances = [
    marked(makeInstance('r1', caseData.id, { x: 10, y: 5, z: 0 })),
    marked(makeInstance('r2', caseData.id, { x: 30, y: 5, z: 0 })),
  ];
  const { PackLibrary, packId } = await loadPackLibrary([caseData], instances);
  assert.equal(PackLibrary.computeStats(PackLibrary.getById(packId)).maxCapacityProfileCount, 2);

  const removed = PackLibrary.removeInstances(packId, ['r1']);
  assert.equal(PackLibrary.computeStats(removed.pack).maxCapacityProfileCount, 1, 'removing one marked instance decrements the count');

  const unpacked = { ...removed.pack, cases: removed.pack.cases.map(c => ({ ...c, placement: 'staged' })) };
  assert.equal(PackLibrary.computeStats(unpacked).maxCapacityProfileCount, 0, 'unpacking the remaining marked instance returns the count to zero');
});

// ── Canonical Stats card consumer (source-contract) ──────────────────────────

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `expected block between "${startNeedle}" and "${endNeedle}"`);
  return src.slice(start, end);
}

test('PHASE-C-RPT-7 renderTruckInspector Stats card reads the canonical stats.maxCapacityProfileCount value', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = sliceFn(src, 'function renderTruckInspector(pack, prefs)', 'function renderMultiInspector(pack, selected)');
  assert.match(block, /const stats = PackLibrary\.computeStats\(pack\);/, 'must read from the canonical computeStats() call already in this function, not a separate derivation');
  assert.match(block, /const maxCapacityProfileCount = stats\.maxCapacityProfileCount \|\| 0;/, 'must read the value directly off the canonical stats object');
  assert.match(block, /maxCapacityProfileCount > 0/, 'row must be conditional on a positive count');
  assert.match(block, /Max Capacity profile/, 'row label must describe profile membership, not relaxation evidence');
  assert.equal(block.includes('Rules violated'), false);
  assert.equal(block.includes('Unsafe cases'), false);
  assert.equal(block.includes('Relaxed cases'), false);
  assert.equal(block.includes('requiring relaxation'), false);
});

// ── AutoPack Results panel pre-Apply indicator (source-contract) ────────────

test('PHASE-C-RPT-8 the Max Capacity Results chip is gated on viewedOption.id === "max-capacity" plus a positive count, and reuses packedCount', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');
  assert.match(block, /if \(viewedOption\.id === 'max-capacity' && Number\(viewedOption\.packedCount\) > 0\) \{/,
    'the chip must be gated to the Max Capacity option AND a positive candidate count (matches the zero-state convention used elsewhere)');
  const gated = sliceFn(block, "if (viewedOption.id === 'max-capacity' && Number(viewedOption.packedCount) > 0) {", 'metrics.appendChild(statChips);');
  assert.match(gated, /makeAutoPackResultChip\('Max Capacity profile', formatAutoPackResultNumber\(viewedOption\.packedCount\)\)/,
    'must reuse the existing chip helper and the candidate\'s own packedCount - no new engine field, no duplicated counting logic');
});

test('PHASE-C-RPT-9 standard strategies never render the Max Capacity indicator', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const block = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');
  // Only one call site appends the Max Capacity chip, and it is inside the
  // id === 'max-capacity' guard - so no other strategy (Compact Fill, Stack
  // Priority, Floor First, Constrained Space First, etc.) can ever render it.
  const chipCallSites = block.match(/makeAutoPackResultChip\('Max Capacity profile'/g) || [];
  assert.equal(chipCallSites.length, 1, 'exactly one call site for the Max Capacity chip, and it is the gated one asserted in PHASE-C-RPT-8');
});

// ── PDF/report summary (source-contract) ─────────────────────────────────────

test('PHASE-C-RPT-10 PDF summary includes the Max Capacity profile line only when the count is positive', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const block = sliceFn(src, 'function generatePDF()', 'doc.save(`${safeName(pack.title)}-plan.pdf`);');
  assert.match(block, /const maxCapacityProfileCount = stats\.maxCapacityProfileCount \|\| 0;/, 'must read from the canonical stats object already computed for this PDF');
  assert.match(block, /if \(maxCapacityProfileCount > 0\) \{/, 'the summary line must be conditional on a positive count (omitted at zero)');
  const gated = sliceFn(block, 'if (maxCapacityProfileCount > 0) {', 'doc.text(`Volume used:');
  assert.match(gated, /Max Capacity profile cases: \$\{maxCapacityProfileCount\}/, 'wording must describe profile membership, not individual violations');
  assert.equal(gated.includes('Rules violated'), false);
  assert.equal(gated.includes('Unsafe'), false);
});
