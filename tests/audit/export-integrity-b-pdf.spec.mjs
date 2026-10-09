import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import * as CoreUtils from '../../src/core/utils/index.js';
import * as StateStore from '../../src/core/state-store.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import * as CaseLibrary from '../../src/services/case-library.js';
import * as CategoryService from '../../src/services/category-service.js';
import * as ImportExport from '../../src/services/import-export.js';

// Export Integrity B: the production PDF service (app.js ExportService, same
// slice anchors as preview-identity-context.spec.mjs) runs against the real
// services and the app's own vendored jsPDF 2.5.1. Every text, image and page
// call is recorded with its page and real font metrics, so layout bounds,
// pagination and content are asserted on the document jsPDF actually builds.
const repo = new URL('../../', import.meta.url);
const appSource = await readFile(new URL('src/app.js', repo), 'utf8');
const captureEnd = appSource.indexOf('      function captureScreenshot(');
const readbackStart = appSource.indexOf('      function renderCameraToDataUrl(');
const exportConstantsCode = appSource.slice(appSource.indexOf('      const SCREENSHOT_RESOLUTIONS ='), captureEnd);
const exportCode = appSource.slice(captureEnd, readbackStart);
assert.ok(exportCode.includes('function generatePDF(') && exportCode.includes('function createPdfWriter('),
  'app.js PDF export service is extractable');

const jspdfSandbox = { atob, btoa, console, setTimeout, clearTimeout, TextEncoder, TextDecoder };
jspdfSandbox.self = jspdfSandbox;
vm.createContext(jspdfSandbox);
vm.runInContext(await readFile(new URL('vendor/jspdf.umd.min.js', repo), 'utf8'), jspdfSandbox);
const { jsPDF: RealJsPDF } = jspdfSandbox.jspdf;

// 1×1 baseline JPEG: a real image stream for jsPDF.addImage.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z';

const PAGE = { width: 612, height: 792, margin: 40 };
const INCH = 0.05;

function recordingJsPDF(record) {
  return function RecordingJsPDF(options) {
    record.docs += 1;
    const doc = new RealJsPDF(options);
    const page = () => doc.internal.getCurrentPageInfo().pageNumber;
    const font = () => ({ size: doc.getFontSize(), style: doc.getFont().fontStyle });
    const { text, addImage, addPage } = doc;
    doc.text = function (value, x, y, opts) {
      const values = Array.isArray(value) ? value : [value];
      values.forEach(line => record.texts.push({
        text: String(line), x, y, page: page(), ...font(), width: doc.getTextWidth(String(line)), align: opts && opts.align,
      }));
      return text.apply(this, arguments);
    };
    doc.addImage = function (data, format, x, y, w, h) {
      record.images.push({ data, format, x, y, w, h, page: page() });
      return addImage.apply(this, arguments);
    };
    doc.addPage = function () {
      record.addPages += 1;
      return addPage.apply(this, arguments);
    };
    doc.save = name => { record.saved = name; record.output = doc.output(); record.pages = doc.getNumberOfPages(); };
    return doc;
  };
}

function baseCase(overrides = {}) {
  return {
    id: 'case-a', name: 'Crate A', category: 'default',
    dimensions: { length: 40, width: 30, height: 20 }, weight: 100, ...overrides,
  };
}

function instance(id, caseId, position, overrides = {}) {
  return {
    id, caseId, hidden: false, groupId: null, placement: 'packed',
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ...overrides,
  };
}

function basePack(overrides = {}) {
  return {
    id: 'pack-b', title: 'Plan B', loadPlanNumber: 'LP-2026-0042', customerReference: 'PO-77812',
    client: 'Acme Logistics', projectName: 'Autumn Tour', drawnBy: 'Dispatch Desk', notes: '',
    truck: { length: 240, width: 96, height: 100, shapeMode: 'rect', shapeConfig: {} },
    cases: [], groups: [], stats: {}, createdAt: 1_700_000_000_000, lastEdited: 1_790_000_000_000,
    ...overrides,
  };
}

// Mixed population: 3 in truck (one hidden), 1 staged, 2 unresolved (missing Case).
function mixedPack(overrides = {}) {
  return basePack({
    cases: [
      instance('a1', 'case-a', { x: 30, y: 10, z: 0 }),
      instance('a2', 'case-a', { x: 80, y: 10, z: 0 }),
      instance('a3', 'case-a', { x: 30, y: 10, z: 80 }, { placement: 'staged' }),
      instance('b1', 'case-b', { x: 150, y: 10, z: 0 }, { hidden: true }),
      instance('g1', 'ghost', { x: 200, y: 10, z: 0 }),
      instance('g2', 'ghost', { x: 200, y: 30, z: 0 }),
    ],
    ...overrides,
  });
}

function setup({ pack = mixedPack(), cases = [baseCase(), baseCase({ id: 'case-b', name: 'Crate B', weight: 40 })],
  units = { length: 'in', weight: 'lb' }, pdfIncludeStats = true } = {}) {
  StateStore.init({
    caseLibrary: cases, packLibrary: [pack], folderLibrary: [],
    preferences: { units, export: { pdfIncludeStats, screenshotResolution: '1920x1080' }, categories: [] },
  });
  return pack.id;
}

function runPdf(packId, { refused = false } = {}) {
  const record = { docs: 0, texts: [], images: [], captures: [], addPages: 0, saved: null, toasts: [], errors: [] };
  const truck = PackLibrary.getById(packId).truck;
  const scene = { background: null };
  const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 1000);
  const authority = { pack: PackLibrary.getById(packId) };
  const deps = {
    THREE,
    window: { __TP3D_BILLING: { getBillingState: () => ({ ok: true }) }, jspdf: { jsPDF: recordingJsPDF(record) } },
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    console: { error: error => record.errors.push(error.stack || error.message) },
    BillingService: { getProRuleSet: () => ({ canUseProFeature: true }) },
    openSettingsOverlay() {},
    UIComponents: { showToast: (...args) => record.toasts.push(args.slice(0, 2)) },
    PreferencesManager: { get: () => StateStore.get('preferences') },
    Utils: CoreUtils,
    StateStore: { get: key => (key === 'currentPackId' ? packId : StateStore.get(key)) },
    PackLibrary, CaseLibrary, CategoryService, ImportExport,
    OperationLifecycle: { isBusy: () => false },
    EditorUI: { getExportScene: () => authority },
    SceneManager: {
      getScene: () => scene, getCamera: () => camera, render() {},
      getTruckBoundsWorld: () => new THREE.Box3(
        new THREE.Vector3(0, 0, (-truck.width / 2) * INCH),
        new THREE.Vector3(truck.length * INCH, truck.height * INCH, (truck.width / 2) * INCH)),
      toWorld: inches => inches * INCH,
    },
    CaseScene: { beginExportCapture: () => () => {}, getAabbWorld: () => null },
    renderCameraToDataUrl: (view, width, height, options) => {
      record.captures.push({ width, height, options });
      return JPEG;
    },
  };
  const service = new Function(...Object.keys(deps),
    `${exportConstantsCode}${exportCode}\nreturn { generatePDF };`)(...Object.values(deps));
  service.generatePDF();
  if (refused) return record;
  assert.deepEqual(record.errors, [], 'PDF export must not throw');
  assert.ok(record.saved, `PDF saved (toasts: ${JSON.stringify(record.toasts)})`);
  return record;
}

const body = record => record.texts.filter(t => t.align !== 'center');
const allText = record => body(record).map(t => t.text).join('\n');
const prose = record => allText(record).replace(/\n/g, ' ');
const pageOf = (record, text) => (body(record).find(t => t.text.includes(text)) || {}).page;
const WINANSI = /^[\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;

function assertInsidePage(record) {
  const { width, height, margin } = PAGE;
  for (const t of body(record)) {
    assert.ok(t.y >= margin - 1e-6 && t.y <= height - margin + 1e-6, `baseline inside margins: ${JSON.stringify(t)}`);
    assert.ok(t.x >= margin - 1e-6, `left margin: ${JSON.stringify(t)}`);
    assert.ok(t.x + t.width <= width - margin + 0.5, `right margin: ${JSON.stringify(t)}`);
    assert.match(t.text, WINANSI, `text is in the built-in font's character set: ${JSON.stringify(t.text)}`);
  }
  for (const image of record.images) {
    assert.ok(image.x >= margin && image.y >= margin, 'image top-left inside the margins');
    assert.ok(image.x + image.w <= width - margin + 1e-6, 'image inside the right margin');
    assert.ok(image.y + image.h <= height - margin + 1e-6, `image inside the bottom margin: ${JSON.stringify(image)}`);
  }
  const footers = record.texts.filter(t => t.align === 'center');
  assert.deepEqual(footers.map(f => [f.page, f.text]),
    Array.from({ length: record.pages }, (_, i) => [i + 1, `Page ${i + 1} of ${record.pages}`]),
    'every page carries a correct "Page i of N" footer');
}


// "Label: value" fields print the bold label and the value on one baseline;
// a wrapped value continues on the following baselines at the value column.
function fieldLines(record, label) {
  const texts = body(record);
  const index = texts.findIndex(t => t.text === `${label}: ` && t.style === 'bold');
  if (index < 0) return null;
  const first = texts[index + 1];
  const lines = [first.text];
  for (let i = index + 2; i < texts.length && texts[i].x === first.x && texts[i].style === 'normal'; i++) {
    lines.push(texts[i].text);
  }
  return lines;
}
const fieldValue = (record, label) => (fieldLines(record, label) || []).join(' ');
const columnText = (record, x, page) => body(record).filter(t => t.x === x && (page == null || t.page === page));

test('EXPORT-B identity: Load Plan Number, Customer Reference, Client, Project, Drawn by and timestamps', () => {
  const record = runPdf(setup());
  assertInsidePage(record);
  const header = body(record).filter(t => t.page === 1);
  assert.equal(header[0].text, 'Plan B');
  assert.equal(header[0].size, 22);
  assert.deepEqual(
    ['Load Plan Number', 'Customer Reference', 'Client', 'Project', 'Drawn by'].map(label => fieldValue(record, label)),
    ['LP-2026-0042', 'PO-77812', 'Acme Logistics', 'Autumn Tour', 'Dispatch Desk']);
  const labels = header.filter(t => t.style === 'bold' && t.text.endsWith(': ')).map(t => t.text);
  assert.deepEqual(labels.slice(0, 7), ['Load Plan Number: ', 'Customer Reference: ', 'Client: ', 'Project: ',
    'Drawn by: ', 'Generated: ', 'Last edited: '], 'identity precedes the generated/last-edited context');
  const lastEdited = new Date(1_790_000_000_000);
  assert.match(fieldValue(record, 'Last edited'), new RegExp(`\\b${lastEdited.getFullYear()}\\b`));
  assert.match(fieldValue(record, 'Generated'), new RegExp(`\\b${new Date().getFullYear()}\\b`));
  assert.notEqual(fieldValue(record, 'Generated'), fieldValue(record, 'Last edited'));
  assert.doesNotMatch(allText(record), /Revision|Version \d/i, 'no invented revision identity');
});

test('EXPORT-B missing optional business fields are omitted cleanly', () => {
  const record = runPdf(setup({
    pack: mixedPack({ customerReference: null, client: '', projectName: '   ', drawnBy: undefined, lastEdited: undefined }),
  }));
  assertInsidePage(record);
  assert.equal(fieldValue(record, 'Load Plan Number'), 'LP-2026-0042');
  for (const label of ['Customer Reference', 'Client', 'Project', 'Drawn by', 'Last edited']) {
    assert.equal(fieldLines(record, label), null, `${label} is omitted when absent`);
  }
  assert.doesNotMatch(allText(record), /undefined|null|NaN/);
});

test('EXPORT-B cargo populations and loaded weight reconcile with computeStats; legacy wording is gone', () => {
  const packId = setup();
  const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
  const record = runPdf(packId);
  assertInsidePage(record);
  assert.deepEqual(
    ['Total cargo items', 'In truck', 'Staged (outside the truck)', 'Hidden from view', 'Unresolved'].map(label => fieldValue(record, label)),
    [stats.totalCases, stats.packedCases, stats.stagedCases, stats.hiddenCases, stats.unresolvedInstances].map(String));
  assert.deepEqual([stats.totalCases, stats.packedCases, stats.stagedCases, stats.hiddenCases, stats.unresolvedInstances],
    [6, 3, 1, 1, 2], 'hidden visibility overlaps the loaded population');
  assert.equal(stats.totalWeight, null, 'unresolved cargo makes the loaded total unavailable');
  assert.equal(stats.weightComplete, false);
  assert.equal(fieldValue(record, 'Loaded weight (in truck)'), '— (incomplete)',
    'a partial known subtotal must not be presented as the loaded total');
  assert.match(fieldValue(record, 'Volume used (in truck)'), /^\d+\.\d% of usable truck volume \(incomplete\)$/);
  const text = allText(record);
  assert.doesNotMatch(text, /Cases loaded|Total weight|^Weight:/m, 'no legacy population or weight labels');
  assert.match(prose(record), /Staged cargo is not in the truck\. Cargo parked beside the truck may appear in the perspective view but is left out of the top and side views\./);
  assert.match(text, /Hidden is a visibility count\. Hidden cargo is not shown in PDF views; cargo in the truck still counts in loaded weight and volume\./);

  const resolvedPack = mixedPack();
  resolvedPack.cases = resolvedPack.cases.filter(inst => inst.caseId !== 'ghost');
  const resolvedId = setup({ pack: resolvedPack });
  const resolvedStats = PackLibrary.computeStats(PackLibrary.getById(resolvedId));
  assert.equal(resolvedStats.totalWeight, 240, 'complete loaded mass includes the hidden crate and excludes staged cargo');
  assert.equal(resolvedStats.weightComplete, true);
  assert.equal(fieldValue(runPdf(resolvedId), 'Loaded weight (in truck)'), '240 lb');
});

test('EXPORT-B checklist rows carry reconciled status quantities; missing and same-name Cases stay explicit', () => {
  const cases = [baseCase(), baseCase({ id: 'case-b', name: 'Crate B', weight: 40 }),
    baseCase({ id: 'case-a2', name: 'Crate A', itemCode: 'CA-2', weight: 7 })];
  const pack = mixedPack();
  pack.cases.push(instance('c1', 'case-a2', { x: 120, y: 10, z: 0 }), instance('c2', 'case-a2', { x: 30, y: 10, z: 90 }));
  const packId = setup({ pack, cases });
  const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
  const report = ImportExport.buildLoadPlanReport(PackLibrary.getById(packId), { stats });
  assert.deepEqual(report.rows.map(row => [row.name, row.itemCode, row.qty, row.counts]), [
    ['Crate A', '', 3, { inTruck: 2, staged: 1, hidden: 0, unresolved: 0 }],
    ['Crate B', '', 1, { inTruck: 1, staged: 0, hidden: 1, unresolved: 0 }],
    ['Missing case definition (ghost)', '', 2, { inTruck: 0, staged: 0, hidden: 0, unresolved: 2 }],
    ['Crate A', 'CA-2', 2, { inTruck: 1, staged: 1, hidden: 0, unresolved: 0 }],
  ], 'same-name Cases with different ids stay separate rows; the missing definition is its own unresolved row');
  for (const row of report.rows) {
    const { inTruck, staged, hidden, unresolved } = row.counts;
    assert.equal(inTruck + staged + unresolved, row.qty, `${row.name} physical statuses reconcile`);
    assert.ok(hidden <= row.qty, `${row.name} hidden visibility is a subset`);
  }
  const sum = key => report.rows.reduce((total, row) => total + row.counts[key], 0);
  assert.deepEqual([sum('inTruck'), sum('staged'), sum('hidden'), sum('unresolved')],
    [stats.packedCases, stats.stagedCases, stats.hiddenCases, stats.unresolvedInstances]);

  const record = runPdf(packId);
  assertInsidePage(record);
  const checklistPage = pageOf(record, 'CASE CHECKLIST');
  const header = body(record).filter(t => t.page === checklistPage && t.style === 'bold' && t.size === 8).map(t => t.text);
  assert.deepEqual(header, ['#', 'Case', 'Category', 'Base dims (L×W×H)', 'Unit weight', 'Qty', 'In truck', 'Staged',
    'Hidden', 'Unresolved']);
  const row = name => {
    const cell = body(record).find(t => t.page === checklistPage && t.text === name);
    return body(record).filter(t => t.page === checklistPage && t.y === cell.y).map(t => t.text);
  };
  assert.deepEqual(row('Missing case definition (ghost)'), ['3', 'Missing case definition (ghost)', '—', '—', '—', '2', '0', '0', '0', '2']);
  assert.deepEqual(row('Crate B'), ['2', 'Crate B', 'Default', '40×30×20 in', '40 lb', '1', '1', '0', '1', '0']);
  assert.ok(body(record).some(t => t.text === 'Item Code: CA-2'), 'the Item Code identifies the second "Crate A"');
  assert.match(allText(record), /\(In truck \+ Staged \+ Unresolved = Qty\)\. Hidden is a separate visibility count\./);
});

test('EXPORT-B hidden unresolved cargo remains visible in both reporting dimensions without invented totals', () => {
  const pack = mixedPack();
  pack.cases.find(inst => inst.id === 'g1').hidden = true;
  const packId = setup({ pack });
  const livePack = PackLibrary.getById(packId);
  const stats = PackLibrary.computeStats(livePack);
  const report = ImportExport.buildLoadPlanReport(livePack, { stats });
  assert.deepEqual(report.population, { total: 6, inTruck: 3, staged: 1, hidden: 2, unresolved: 2 });
  assert.deepEqual(report.rows.find(row => row.name.includes('ghost')).counts,
    { inTruck: 0, staged: 0, hidden: 1, unresolved: 2 });
  assert.equal(stats.totalWeight, null, 'a missing Case makes total weight unavailable rather than contributing zero');
  const record = runPdf(packId);
  assertInsidePage(record);
  assert.equal(fieldValue(record, 'Hidden from view'), '2');
  assert.equal(fieldValue(record, 'Unresolved'), '2');
  assert.equal(fieldValue(record, 'Loaded weight (in truck)'), '— (incomplete)');
});

test('EXPORT-B status classification reconciles for duplicate ids and unusable truck geometry', () => {
  const duplicate = basePack({ cases: [
    instance('same', 'case-a', { x: 30, y: 10, z: 0 }),
    instance('same', 'case-a', { x: 30, y: 10, z: 90 }),
    instance('same', 'ghost', { x: 30, y: 10, z: 0 }),
    instance('same', 'case-a', { x: 60, y: 10, z: 0 }, { hidden: true }),
  ] });
  setup({ pack: duplicate });
  const duplicateStats = PackLibrary.computeStats(duplicate);
  const { statuses } = PackLibrary.getStatsInstanceStatuses(duplicate, duplicateStats);
  const tally = statuses.reduce((counts, status) => ({ ...counts, [status]: (counts[status] || 0) + 1 }), {});
  assert.deepEqual(tally, { inTruck: 2, staged: 1, unresolved: 1 }, 'physical statuses include hidden packed cargo');
  assert.throws(() => ImportExport.buildLoadPlanReport(duplicate, { stats: duplicateStats }),
    /Duplicate cargo instance IDs make this load plan invalid for a trustworthy PDF export\./,
    'the report itself refuses duplicate instance ids');

  const noTruck = basePack({ truck: { length: 0, width: 0, height: 0, shapeMode: 'rect' },
    cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })] });
  setup({ pack: noTruck });
  const stats = PackLibrary.computeStats(noTruck);
  const unclassified = ImportExport.buildLoadPlanReport(noTruck, { stats });
  assert.equal(stats.unresolvedInstances, 1);
  assert.deepEqual(unclassified.population, { total: 1, inTruck: 0, staged: 0, hidden: 0, unresolved: 1 });
  assert.match(unclassified.review.map(entry => entry.text).join(' '), /could not be fully resolved/);
  assert.throws(() => ImportExport.buildLoadPlanReport(noTruck, { stats: { ...stats } }), /statistics are unavailable/,
    'persisted stats without the live classification are refused, never guessed');
});

// Canonical OOG and pallet warnings carry an instance id but no occurrence.
// With duplicate ids the SAME warning comes from either occurrence, so the
// PDF refuses the Load Plan instead of guessing which "<Case> #n" it means.
const DUPLICATE_REFUSAL = ['PDF export failed: Duplicate cargo instance IDs make this load plan invalid for a trustworthy PDF export.', 'error'];

function assertRefused(record) {
  assert.equal(record.docs, 0, 'refused before any PDF document is created');
  assert.equal(record.captures.length, 0, 'no view is captured');
  assert.equal(record.saved, null, 'nothing is saved');
  assert.deepEqual(record.texts, [], 'no "<Case> #n" attribution is ever written');
  assert.deepEqual(record.toasts, [DUPLICATE_REFUSAL]);
}

test('EXPORT-B duplicate instance ids: an OOG warning from either occurrence is refused, never attributed', () => {
  const oog = id => instance(id, 'case-a', { x: 30, y: 10, z: 40 });
  const inside = id => instance(id, 'case-a', { x: 80, y: 10, z: 0 });
  const warnings = [];
  for (const [label, order, uniqueLabel] of [
    ['first occurrence out of gauge', ids => [oog(ids[0]), inside(ids[1])], 'Crate A #1'],
    ['second occurrence out of gauge', ids => [inside(ids[0]), oog(ids[1])], 'Crate A #2'],
  ]) {
    const pack = basePack({ cases: order(['x', 'x']) });
    setup({ pack });
    const stats = PackLibrary.computeStats(pack);
    warnings.push(stats.oogWarnings);
    assertRefused(runPdf(pack.id, { refused: true }));

    const unique = basePack({ id: 'pack-unique', cases: order(['x1', 'x2']) });
    const record = runPdf(setup({ pack: unique }));
    assertInsidePage(record);
    assert.match(allText(record), new RegExp(`• ${uniqueLabel} extends past the right side\\.`), `${label}: unique ids keep exact attribution`);
    assert.equal((allText(record).match(/extends past the right side/g) || []).length, 1);
  }
  assert.deepEqual(warnings[0], warnings[1], 'the canonical warning cannot tell the occurrences apart');
  assert.deepEqual(warnings[0], [{ instanceId: 'x', caseId: 'case-a', caseName: 'Crate A', issues: ['protrudesRight'] }]);
});

test('EXPORT-B duplicate instance ids: a pallet warning from either occurrence is refused, never attributed', () => {
  const pallet = baseCase({ id: 'case-p', name: 'Pallet', isPallet: true, maxPalletWeight: 100,
    dimensions: { length: 48, width: 40, height: 6 }, weight: 30 });
  const heavy = baseCase({ id: 'case-h', name: 'Heavy', weight: 150 });
  const loaded = id => instance(id, 'case-p', { x: 60, y: 3, z: 0 });
  const empty = id => instance(id, 'case-p', { x: 160, y: 3, z: 0 });
  const load = instance('h1', 'case-h', { x: 60, y: 16, z: 0 });
  const warnings = [];
  for (const [label, order, uniqueLabel] of [
    ['first pallet overloaded', ids => [loaded(ids[0]), empty(ids[1]), load], 'Pallet #1'],
    ['second pallet overloaded', ids => [empty(ids[0]), loaded(ids[1]), load], 'Pallet #2'],
  ]) {
    const pack = basePack({ cases: order(['p', 'p']) });
    setup({ pack, cases: [baseCase(), pallet, heavy] });
    warnings.push(PackLibrary.computeStats(pack).palletWarnings);
    assertRefused(runPdf(pack.id, { refused: true }));

    const unique = basePack({ id: 'pack-unique', cases: order(['p1', 'p2']) });
    const record = runPdf(setup({ pack: unique, cases: [baseCase(), pallet, heavy] }));
    assertInsidePage(record);
    assert.match(allText(record), new RegExp(`• ${uniqueLabel}: 150 lb on top exceeds its 100 lb max load warning\\.`),
      `${label}: unique ids keep exact attribution`);
  }
  assert.equal(warnings[0].length, 1);
  assert.deepEqual(warnings[0], warnings[1], 'the canonical pallet warning cannot tell the occurrences apart');
  assert.equal(warnings[0][0].palletInstanceId, 'p');
});

test('EXPORT-B duplicate instance ids are refused even without warnings; ids compare like backup import', () => {
  for (const ids of [['dup', 'dup'], ['dup', ' dup ']]) {
    const pack = basePack({ cases: [instance(ids[0], 'case-a', { x: 30, y: 10, z: 0 }), instance(ids[1], 'case-a', { x: 80, y: 10, z: 0 })] });
    setup({ pack });
    assert.deepEqual(PackLibrary.computeStats(pack).oogWarnings, []);
    assertRefused(runPdf(pack.id, { refused: true }));
  }
});

test('EXPORT-B status columns appear only when that population exists', () => {
  const pack = basePack({ cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })] });
  const record = runPdf(setup({ pack }));
  const page = pageOf(record, 'CASE CHECKLIST');
  const header = body(record).filter(t => t.page === page && t.style === 'bold' && t.size === 8).map(t => t.text);
  assert.deepEqual(header, ['#', 'Case', 'Category', 'Base dims (L×W×H)', 'Unit weight', 'Qty', 'In truck', 'Staged']);
  assert.match(allText(record), /\(In truck \+ Staged = Qty\)/);
});

test('EXPORT-B base dimensions are labelled as such and never claim a rotated footprint', () => {
  const rotated = instance('r1', 'case-a', { x: 40, y: 20, z: 0 }, {
    transform: { position: { x: 40, y: 20, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: Math.PI / 2 }, scale: { x: 1, y: 1, z: 1 } },
    orientedDims: { length: 20, width: 40, height: 30 },
  });
  const record = runPdf(setup({ pack: basePack({ cases: [rotated] }) }));
  assertInsidePage(record);
  const text = allText(record);
  assert.ok(body(record).some(t => t.text === 'Base dims (L×W×H)'));
  assert.ok(body(record).some(t => t.text === '40×30×20 in'), 'the Case catalog dimensions');
  assert.ok(!body(record).some(t => /^20×40×30/.test(t.text)), 'the rotated footprint is not presented');
  assert.doesNotMatch(text, /^Dims$|Placed dims|Oriented/m);
  assert.match(prose(record), /Base dims are the Case’s catalog dimensions \(L×W×H\), not the placed orientation of each item\./);
});

test('EXPORT-B units follow the user preferences for truck, checklist, weights and handling', () => {
  const pallet = baseCase({ id: 'case-p', name: 'Pallet', isPallet: true, maxPalletWeight: 2000,
    dimensions: { length: 48, width: 40, height: 6 }, weight: 50 });
  const pack = basePack({ cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 }), instance('p1', 'case-p', { x: 100, y: 3, z: 0 })] });
  const inches = runPdf(setup({ pack, cases: [baseCase(), pallet] }));
  assert.equal(fieldValue(inches, 'Truck dimensions (L×W×H)'), '240×96×100 in');
  assert.ok(body(inches).some(t => t.text === '40×30×20 in') && body(inches).some(t => t.text === '100 lb'));
  assert.equal(fieldValue(inches, 'Loaded weight (in truck)'), '150 lb');

  const metric = runPdf(setup({ pack: structuredClone(pack), cases: [baseCase(), pallet], units: { length: 'cm', weight: 'kg' } }));
  assertInsidePage(metric);
  assert.equal(fieldValue(metric, 'Truck dimensions (L×W×H)'), '609.6×243.8×254.0 cm');
  assert.ok(body(metric).some(t => t.text === '101.6×76.2×50.8 cm'), 'checklist uses the same length unit as the truck');
  assert.ok(body(metric).some(t => t.text === '45.4 kg'), 'unit weight in kg');
  assert.equal(fieldValue(metric, 'Loaded weight (in truck)'), '68.0 kg');
  assert.match(allText(metric), /Max load warning: 907\.2 kg/, 'the pallet load warning uses the weight preference');
  assert.doesNotMatch(allText(metric), /\d (in|lb)\b|Truck \(in\)/, 'no hard-coded imperial units remain');
});

test('EXPORT-B truck shape and configuration: Standard, Wheel Wells and Front Overhang', () => {
  const standard = runPdf(setup({ pack: basePack({ cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })] }) }));
  assert.equal(fieldValue(standard, 'Truck shape'), 'Standard');
  assert.equal(fieldLines(standard, 'Wheel Wells'), null);
  assert.equal(fieldLines(standard, 'Front Overhang'), null);

  const wells = runPdf(setup({ pack: basePack({
    truck: { length: 240, width: 96, height: 100, shapeMode: 'wheelWells',
      shapeConfig: { wellHeight: 10, wellWidth: 12, wellLength: 48, wellOffsetFromRear: 60 } },
    cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })],
  }) }));
  assertInsidePage(wells);
  assert.equal(fieldValue(wells, 'Truck shape'), 'Wheel Wells');
  assert.equal(fieldValue(wells, 'Wheel Wells'), 'Length 48 in · Width 12 in · Height 10 in · Offset from rear 60 in');

  const defaults = runPdf(setup({ pack: basePack({
    truck: { length: 240, width: 96, height: 100, shapeMode: 'wheelWells', shapeConfig: {} }, cases: [],
  }) }));
  assert.equal(fieldValue(defaults, 'Wheel Wells'), 'Length 84 in · Width 14 in · Height 35 in · Offset from rear 60 in',
    'unset configuration reports the geometry the packer actually uses');

  const overhang = runPdf(setup({ pack: basePack({
    truck: { length: 240, width: 96, height: 100, shapeMode: 'frontBonus', shapeConfig: { bonusLength: 60, bonusHeight: 45 } },
    cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })],
  }) }));
  assert.equal(fieldValue(overhang, 'Truck shape'), 'Front Overhang');
  assert.equal(fieldValue(overhang, 'Front Overhang'), 'Length 60 in · Deck height 45 in');
  assert.equal(fieldValue(overhang, 'Truck dimensions (L×W×H)'), '240×96×100 in');
});

test('EXPORT-B handling rules supplement the preserved Case Instructions and Item Notes', () => {
  const ruled = baseCase({
    id: 'case-r', name: 'Road Case', itemCode: 'RC-9', notes: 'Keep dry.', orientationLock: 'upright', noStackOnTop: true,
    maxStackCount: 2, isPallet: true, maxPalletWeight: 500, laneItem: true, loadPriority: 1, mustLoadLast: true,
    mustUnloadFirst: true, hazmatClass: '3', stopGroup: 'Stop 1', keepTogetherGroup: 'Audio',
  });
  const plain = baseCase();
  const pack = basePack({ cases: [
    instance('r1', 'case-r', { x: 30, y: 10, z: 0 }, { deliverySequence: 2, instanceNotes: 'Fragile corner.' }),
    instance('r2', 'case-r', { x: 80, y: 10, z: 0 }, { deliverySequence: 1 }),
    instance('a1', 'case-a', { x: 150, y: 10, z: 0 }),
  ] });
  const record = runPdf(setup({ pack, cases: [ruled, plain] }));
  assertInsidePage(record);
  const text = allText(record);
  assert.match(text, /HANDLING RULES\nRoad Case \(Item Code: RC-9\)\n/);
  const rules = text.slice(text.indexOf('Road Case (Item Code: RC-9)')).split('\n').slice(1, 4).join(' ');
  for (const rule of ['Upright', 'No top load', 'Max 2 on top', 'Pallet base', 'Max load warning: 500 lb', 'Lane: Always',
    'Priority: High', 'Must load last', 'Must unload first', 'Hazmat class: 3', 'Stop group: Stop 1', 'Keep together: Audio',
    'Delivery sequence: 1, 2']) {
    assert.ok(rules.includes(rule), `handling rule "${rule}" in ${rules}`);
  }
  assert.doesNotMatch(text, /Crate A \(Item Code|^Crate A\n(?!.*Default)/m, 'a Case with only default rules gets no handling entry');
  assert.doesNotMatch(text, /\bfragile\b(?! corner)/i, 'no invented fragility rule');
  const order = ['HANDLING RULES', 'CARGO INSTRUCTIONS', 'CASE INFORMATION', 'Keep dry.', 'ITEM DETAILS', 'Road Case #1', 'Fragile corner.'];
  const positions = order.map(needle => text.indexOf(needle));
  assert.ok(positions.every((pos, i) => pos >= 0 && (i === 0 || pos > positions[i - 1])), JSON.stringify(positions));
});

test('EXPORT-B instance names use the Cargo Instructions occurrence numbering', () => {
  const noted = baseCase({ id: 'case-r', name: 'Road Case' });
  const pack = basePack({ cases: [
    instance('h1', 'case-r', { x: 30, y: 10, z: 0 }, { hidden: true, instanceNotes: 'n1' }),
    instance('o1', 'case-r', { x: 60, y: 10, z: 40 }, { instanceNotes: 'n2' }),
  ] });
  setup({ pack, cases: [noted] });
  const manifest = ImportExport.buildCargoInstructionsManifest(PackLibrary.getById(pack.id));
  const record = runPdf(pack.id);
  assert.deepEqual(manifest.itemEntries.map(entry => entry.instanceName), ['Road Case #1', 'Road Case #2']);
  assert.match(allText(record), /• Road Case #2 extends past the right side\./,
    'the out-of-gauge item is named exactly like its Item Notes entry');
});

const reviewSection = record => {
  const text = allText(record);
  const start = text.indexOf('LOAD PLAN REVIEW');
  return start < 0 ? null : text.slice(start, text.indexOf('LOAD SUMMARY'));
};

test('EXPORT-B "Load plan needs review" prints with statistics on and off', () => {
  for (const pdfIncludeStats of [true, false]) {
    const record = runPdf(setup({ pdfIncludeStats, pack: basePack({
      handlingRulesValidatedSignature: 'hr-v1:stale', cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })],
    }) }));
    assertInsidePage(record);
    assert.match((reviewSection(record) || '').replace(/\n/g, ' '), /Load plan needs review A case’s loading rules changed after this plan was last checked\. Review the plan to make sure the cargo still follows the latest rules\./);
    assert.doesNotMatch(allText(record), /certif|complian|safety score|pass\/fail/i);
  }
  const current = basePack({ cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })] });
  setup({ pack: current });
  current.handlingRulesValidatedSignature = PackLibrary.buildHandlingRulesValiditySignature(current, CaseLibrary.getCases());
  assert.equal(reviewSection(runPdf(current.id)), null, 'a current signature needs no review');
});

test('EXPORT-B Max Capacity review notice is independent of statistics and claims no per-case relaxation', () => {
  const pack = () => basePack({ cases: [
    instance('m1', 'case-a', { x: 30, y: 10, z: 0 }, { packedProfile: 'max-capacity' }),
    instance('m2', 'case-a', { x: 80, y: 10, z: 0 }, { packedProfile: 'max-capacity' }),
    instance('n1', 'case-a', { x: 130, y: 10, z: 0 }),
  ] });
  for (const pdfIncludeStats of [true, false]) {
    const record = runPdf(setup({ pdfIncludeStats, pack: pack() }));
    const review = reviewSection(record) || '';
    assert.match(review, /Max Capacity placements\n2 cases in the truck were placed with the more permissive Max Capacity handling profile\./);
    assert.match(review.replace(/\n/g, ' '), /This does not identify which handling rules, if any, were relaxed for an individual case\. Review these placements before treating the plan as transport-ready\./);
    assert.doesNotMatch(allText(record), /violat|unsafe|rule was relaxed|relaxed rules?:/i);
    assert.equal(fieldValue(record, 'Max Capacity profile cases') || null, pdfIncludeStats ? '2' : null,
      'the profile count stays an optional statistic');
  }
});

test('EXPORT-B unresolved cargo warning prints with statistics on and off', () => {
  for (const pdfIncludeStats of [true, false]) {
    const record = runPdf(setup({ pdfIncludeStats }));
    assert.match((reviewSection(record) || '').replace(/\n/g, ' '),
      /Incomplete cargo data 2 cargo items could not be fully resolved, so loaded weight and volume totals may be incomplete\. Reason: Case definition is missing\./);
    assert.equal(fieldValue(record, 'Unresolved'), '2');
    assert.equal(fieldLines(record, 'Volume used (in truck)') !== null, pdfIncludeStats, 'volume stays optional');
  }
});

test('EXPORT-B out-of-gauge and pallet warnings reuse the canonical warnings', () => {
  const pallet = baseCase({ id: 'case-p', name: 'Pallet', isPallet: true, maxPalletWeight: 100,
    dimensions: { length: 48, width: 40, height: 6 }, weight: 30 });
  const heavy = baseCase({ id: 'case-h', name: 'Heavy', weight: 150 });
  const pack = basePack({ cases: [
    instance('p1', 'case-p', { x: 60, y: 3, z: 0 }),
    instance('h1', 'case-h', { x: 60, y: 16, z: 0 }),
    instance('o1', 'case-a', { x: 150, y: 10, z: 40 }),
    instance('s1', 'case-a', { x: 30, y: 10, z: 90 }, { placement: 'staged' }),
  ] });
  const packId = setup({ pack, cases: [baseCase(), pallet, heavy], pdfIncludeStats: false });
  const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
  assert.deepEqual(stats.oogWarnings.map(w => w.instanceId).sort(), ['o1'],
    'canonical OOG warnings exclude explicitly staged cargo');
  assert.equal(stats.palletWarnings.length, 1);
  const review = reviewSection(runPdf(packId)) || '';
  assert.match(review, /Out-of-gauge cargo\n• Crate A #1 extends past the right side\.\n/);
  assert.doesNotMatch(review, /Crate A #2/, 'explicitly staged cargo is not out-of-gauge, as in the Editor');
  assert.match(review, /Pallet load warnings\n• Pallet #1: 150 lb on top exceeds its 100 lb max load warning\./);
});

test('EXPORT-B no review section when nothing applies', () => {
  const record = runPdf(setup({ pack: basePack({ cases: [instance('a1', 'case-a', { x: 30, y: 10, z: 0 })] }) }));
  assert.equal(reviewSection(record), null);
  assert.equal(fieldValue(record, 'Loaded weight (in truck)'), '100 lb', 'complete totals carry no incomplete marker');
  assert.doesNotMatch(allText(record), /Staged cargo is not in|Hidden cargo is not shown/);
});

test('EXPORT-B long title and identity values wrap inside the margins', () => {
  const long = word => Array.from({ length: 40 }, (_, i) => `${word}${i}`).join(' ');
  const record = runPdf(setup({ pack: mixedPack({
    title: long('Title'), loadPlanNumber: `LPN-${'9'.repeat(160)}`, customerReference: long('Ref'),
    client: long('Client'), projectName: long('Project'), drawnBy: long('Drawer'),
  }) }));
  assertInsidePage(record);
  const titleLines = body(record).filter(t => t.size === 22);
  assert.ok(titleLines.length >= 3, 'the title wraps');
  assert.equal(titleLines.map(t => t.text).join(' '), long('Title'), 'the whole title prints, in order');
  for (const [label, value] of [['Customer Reference', long('Ref')], ['Client', long('Client')],
    ['Project', long('Project')], ['Drawn by', long('Drawer')]]) {
    const lines = fieldLines(record, label);
    assert.ok(lines.length >= 2, `${label} wraps`);
    assert.equal(lines.join(' '), value, `${label} prints in full`);
  }
  assert.equal(fieldLines(record, 'Load Plan Number').join(''), `LPN-${'9'.repeat(160)}`, 'an unbroken value is split, not cut');
});

test('EXPORT-B long Load Plan Notes continue across pages in order', () => {
  const notes = Array.from({ length: 150 }, (_, i) => `Paragraph ${i + 1}: strap the row, check the load bars and record the seal.`).join('\n');
  const record = runPdf(setup({ pack: mixedPack({ notes }) }));
  assertInsidePage(record);
  const noteLines = body(record).filter(t => /^Paragraph \d+:/.test(t.text));
  assert.equal(noteLines.length, 150, 'no note line is dropped');
  assert.deepEqual(noteLines.map(t => Number(t.text.match(/\d+/)[0])), Array.from({ length: 150 }, (_, i) => i + 1));
  assert.ok(new Set(noteLines.map(t => t.page)).size >= 3, 'notes span pages');
  assert.ok(body(record).some(t => t.text === 'Load Plan Notes' && t.style === 'bold'), 'exact Load Plan Notes heading');
});

test('EXPORT-B each view prints whole: heading and image share a page inside the margins', () => {
  for (let lines = 0; lines <= 60; lines += 4) {
    const notes = Array.from({ length: lines }, (_, i) => `Note line ${i}`).join('\n');
    const record = runPdf(setup({ pack: mixedPack({ notes: notes || '' }) }));
    assertInsidePage(record);
    assert.equal(record.images.length, 3);
    ['PERSPECTIVE VIEW', 'TOP VIEW', 'SIDE VIEW'].forEach((heading, i) => {
      const title = body(record).find(t => t.text === heading);
      const image = record.images[i];
      assert.equal(title.page, image.page, `${heading} heading stays with its image (${lines} note lines)`);
      assert.equal(image.y, title.y + 16);
      assert.ok(image.y + image.h + 16 <= PAGE.height - PAGE.margin + 1e-6, `${heading} keeps its spacing above the margin`);
    });
  }
});

test('EXPORT-B view rasters print at >= 180 PPI within the capture bounds and keep their aspect', () => {
  const record = runPdf(setup());
  assert.deepEqual(record.captures.map(c => [c.width, c.height]), [[1419, 798], [1419, 769], [1419, 621]]);
  record.captures.forEach((capture, i) => {
    const image = record.images[i];
    const ppi = capture.width / (image.w / 72);
    assert.ok(ppi >= 180 && ppi <= 200, `view ${i} prints at ${ppi.toFixed(1)} PPI`);
    assert.ok(capture.width <= 3840 && capture.height <= 2160);
    assert.ok(Math.abs(image.h / image.w - capture.height / capture.width) < 1e-9, 'placed at the raster aspect');
  });
  assert.ok(Math.abs(798 / 1419 - 9 / 16) < 0.001 && Math.abs(769 / 1419 - 13 / 24) < 0.001 && Math.abs(621 / 1419 - 7 / 16) < 0.001);
});

test('EXPORT-B checklist continuation headers and an oversized row that spans pages', () => {
  const cases = [baseCase(), ...Array.from({ length: 90 }, (_, i) => baseCase({ id: `c${i}`, name: `Case ${i}` }))];
  const giant = baseCase({ id: 'giant', name: Array.from({ length: 700 }, (_, i) => `segment${i}`).join(' ') });
  cases.push(giant);
  const pack = basePack({ cases: [
    ...Array.from({ length: 90 }, (_, i) => instance(`i${i}`, `c${i}`, { x: 30, y: 10, z: 0 })),
    instance('g1', 'giant', { x: 30, y: 10, z: 0 }),
  ] });
  const record = runPdf(setup({ pack, cases }));
  assertInsidePage(record);
  const continued = body(record).filter(t => t.text === 'CASE CHECKLIST (continued)');
  assert.ok(continued.length >= 3, 'continuation pages are labelled');
  for (const marker of continued) {
    const header = body(record).filter(t => t.page === marker.page && t.style === 'bold' && t.size === 8).map(t => t.text);
    assert.deepEqual(header.slice(0, 8), ['#', 'Case', 'Category', 'Base dims (L×W×H)', 'Unit weight', 'Qty', 'In truck', 'Staged'],
      `page ${marker.page} repeats the column header`);
  }
  const caseColumn = body(record).find(t => t.text === 'Case' && t.style === 'bold').x;
  const giantLines = body(record).filter(t => t.x === caseColumn && /segment\d/.test(t.text));
  assert.equal(giantLines.map(t => t.text).join(' '), giant.name, 'the oversized name prints in full, in order');
  assert.ok(new Set(giantLines.map(t => t.page)).size >= 2, 'the oversized row continues on the next page');
  const rowNumbers = body(record).filter(t => t.x === PAGE.margin && t.size === 8 && t.style === 'normal' && /^\d+$/.test(t.text));
  assert.deepEqual(rowNumbers.map(t => Number(t.text)), Array.from({ length: 91 }, (_, i) => i + 1), 'every row prints once');
});

test('EXPORT-B long Cargo Instructions and handling entries paginate without loss', () => {
  const words = count => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
  const cases = Array.from({ length: 12 }, (_, i) => baseCase({
    id: `n${i}`, name: `Noted ${i}`, notes: words(400), stopGroup: words(60), mustLoadLast: true,
  }));
  const pack = basePack({ cases: cases.map((c, i) => instance(`x${i}`, c.id, { x: 20 + i * 15, y: 10, z: 0 }, { instanceNotes: words(300) })) });
  const record = runPdf(setup({ pack, cases }));
  assertInsidePage(record);
  const text = allText(record);
  assert.equal((text.match(/CASE INFORMATION/g) || []).length, 12);
  assert.equal((text.match(/ITEM DETAILS/g) || []).length, 12);
  const notesPages = new Set(body(record).filter(t => /word\d/.test(t.text)).map(t => t.page));
  assert.ok(notesPages.size >= 8, 'instructions span many pages');
  const joined = body(record).filter(t => t.x === PAGE.margin + 12 && /^word/.test(t.text)).map(t => t.text).join(' ');
  assert.equal((joined.match(/word399\b/g) || []).length, 12, 'every Case note reaches its last word');
  assert.equal((joined.match(/word299\b/g) || []).length, 12 + 12, 'every Item Note and Case note keep their last words');
});

test('EXPORT-B review block and variable summary paginate inside the margins', () => {
  const cases = [baseCase()];
  const pack = basePack({
    title: Array.from({ length: 180 }, (_, i) => `Long${i}`).join(' '),
    cases: Array.from({ length: 70 }, (_, i) => instance(`o${i}`, 'case-a', { x: 20 + i * 2, y: 10, z: 40 })),
  });
  const record = runPdf(setup({ pack, cases }));
  assertInsidePage(record);
  const oog = body(record).filter(t => /^• Crate A #\d+ extends past the right side\.$/.test(t.text));
  assert.equal(oog.length, 70, 'every canonical warning prints');
  assert.ok(new Set(oog.map(t => t.page)).size >= 2, 'the review block continues on the next page');
  const summaryHeading = body(record).find(t => t.text === 'LOAD SUMMARY');
  const firstField = body(record).find(t => t.text === 'Total cargo items: ');
  assert.equal(summaryHeading.page, firstField.page, 'a section heading never ends a page alone');
});

test('EXPORT-B Unicode text never breaks the PDF and supported Latin text is exact', () => {
  assert.equal(ImportExport.toPdfText('São Paulo — “Zürich” ½ × ° € Œuvre ß'), 'São Paulo — “Zürich” ½ × ° € Œuvre ß');
  assert.equal(ImportExport.toPdfText('Łódź Żółć ĄĘ Đakovo ẞ'), 'Lódz Zólc AE Dakovo SS', 'ó is Latin-1 and kept exactly');
  assert.equal(ImportExport.toPdfText('東京 😀 Ωμέγα'), '?? ? ?????');
  assert.equal(ImportExport.toPdfText('3:45 PM EDT\ttab​|﻿|é|− 5'), '3:45 PM EDT tab||é|- 5');
  assert.equal(ImportExport.toPdfText('line 1\r\nline 2\rline 3'), 'line 1\nline 2\nline 3');
  assert.equal(ImportExport.toPdfText(null), '');
  const inputs = ['東京 😀 👨‍👩‍👧', '\ud800 lone surrogate', 'Ωμέγα Łódź', 'تجربة', 'עברית', '\u0000\u0007bell'];
  for (const value of inputs) {
    const mapped = ImportExport.toPdfText(value);
    assert.equal(ImportExport.toPdfText(value), mapped, 'deterministic');
    assert.match(mapped, WINANSI);
  }

  const unicodeCase = baseCase({ name: 'Caixa São João — Łódź 東京', notes: 'Ωμέγα 😀 notes', itemCode: 'ÇÃ-1' });
  const pack = mixedPack({ title: 'Plan Łódź — Café 東京', client: 'São Paulo — “Zürich”', notes: 'Emoji 😀 and narrow space' });
  const before = structuredClone(pack);
  const record = runPdf(setup({ pack, cases: [unicodeCase, baseCase({ id: 'case-b', name: 'Crate B' })] }));
  assertInsidePage(record);
  assert.equal(body(record)[0].text, 'Plan Lódz — Café ??');
  assert.equal(fieldValue(record, 'Client'), 'São Paulo — “Zürich”', 'supported Latin text prints exactly');
  assert.ok(body(record).some(t => t.text === 'Caixa São João — Lódz ??'));
  assert.ok(body(record).some(t => t.text === 'Emoji ? and narrow space'));
  const textObjects = record.output.match(/\nBT\n[\s\S]*?\nET\n/g) || [];
  assert.ok(textObjects.length > 50);
  assert.ok(textObjects.every(block => !block.includes('\u0000')), 'no text fell back to two-byte encoding');
  assert.deepEqual(PackLibrary.getById(pack.id), before, 'application data is unchanged');
  assert.equal(CaseLibrary.getById('case-a').name, 'Caixa São João — Łódź 東京');
});
