// C4 committed assessment lifecycle. Historical repair/certification assertions
// are replaced below; UI containment and atomic deletion protections remain.
import test from 'node:test';

import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { runInNewContext } from 'node:vm';

import { buildOrganizedUnpackStagingCases } from '../../src/screens/editor-screen.js';

import { createTruckChangeController } from '../../src/ui/truck-change-controller.js';

import { formatCaseModalNumber } from '../../src/ui/overlays/case-modal.js';

import {
  formatCaseModalWeightNumber, inchesToUnit, unitToInches, poundsToUnit, unitToPounds,
} from '../../src/core/utils/index.js';

const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);

const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);

const caseLibraryPath = new URL('../../src/services/case-library.js', import.meta.url);

const normalizerPath = new URL('../../src/core/normalizer.js', import.meta.url);

const appSource = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

const RECT_TRUCK = { length: 120, width: 60, height: 60, shapeMode: 'rect' };

function freshModules() {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  return Promise.all([
    import(stateStorePath.href),
    import(`${packLibraryPath.href}${stamp}`),
    import(`${caseLibraryPath.href}${stamp}`),
  ]).then(([StateStore, PackLibrary, CaseLibrary]) => ({ StateStore, PackLibrary, CaseLibrary }));
}

function mkCase(overrides = {}) {
  return {
    id: 'case-a', name: 'A', manufacturer: 'QA', category: 'Default', color: '#9ca3af',
    dimensions: { length: 10, width: 10, height: 10 }, weight: 10, volume: 1000, shape: 'box',
    canFlip: true, stackable: true, orientationLock: 'any', noStackOnTop: false,
    maxStackCount: 0, isPallet: false,
    ...overrides,
  };
}

function mkInst(id, caseId, position, placement = 'packed') {
  return {
    id, caseId, placement, hidden: false, groupId: null,
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  };
}

function caseModalPhysicalRoundTrip(caseData, { lengthUnit, weightUnit }, { lengthStep = 0, weightStep = 0 } = {}) {
  const dimensions = Object.fromEntries(['length', 'width', 'height'].map(axis => {
    const shown = Number(formatCaseModalNumber(inchesToUnit(caseData.dimensions[axis], lengthUnit), lengthUnit));
    return [axis, unitToInches(shown + (axis === 'length' ? lengthStep : 0), lengthUnit)];
  }));
  const shownWeight = Number(formatCaseModalWeightNumber(poundsToUnit(caseData.weight, weightUnit)));
  return { ...caseData, dimensions, weight: unitToPounds(shownWeight + weightStep, weightUnit) };
}

function activePackFixture(caseId = 'case-a') {
  const baseInst = mkInst('base', caseId, { x: 60, y: 5, z: 0 });
  const childInst = mkInst('child', caseId, { x: 60, y: 15, z: 0 });
  return { id: 'pack-active', title: 'Active', truck: RECT_TRUCK, cases: [baseInst, childInst], lastEdited: 123, stats: {} };
}

test('A2 Case placement-change detection uses effective dimensions and weight, not raw strings or metadata', async () => {
  const { PackLibrary } = await freshModules();
  const original = mkCase({ dimensions: { length: 20, width: 12, height: 10 }, weight: 50 });
  const equivalent = {
    ...original,
    dimensions: { length: '20', width: '12', height: '10' },
    weight: '50', volume: 999, name: 'Renamed', notes: 'Updated', color: '#ff0000',
  };
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, equivalent), false);
  for (const axis of ['length', 'width', 'height']) {
    const changed = { ...original, dimensions: { ...original.dimensions, [axis]: original.dimensions[axis] + 1 } };
    assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, changed), true, `${axis} changes the envelope`);
  }
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, { ...original, weight: 51 }), true);
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, { ...original, weight: '50' }), false);
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(null, original), false, 'new Cases have no prior placement to invalidate');
});

test('F01-1/3/4/6 Case-modal dimension round trips are no-ops in in/ft/cm/m, but one displayed step is physical', async () => {
  const { PackLibrary } = await freshModules();
  const original = mkCase({ dimensions: { length: 47.3701, width: 26, height: 26 }, weight: 52.91 });
  for (const [lengthUnit, step] of [['in', 0.01], ['ft', 0.01], ['cm', 0.01], ['m', 0.0001]]) {
    const units = { lengthUnit, weightUnit: 'lb' };
    const noOp = { ...caseModalPhysicalRoundTrip(original, units), notes: 'Changed only notes' };
    assert.notEqual(noOp.dimensions.length, original.dimensions.length, `${lengthUnit} really does round-trip differently`);
    assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, noOp, units), false,
      `${lengthUnit} displayed value is physically unchanged`);
    assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, noOp), true,
      'non-modal callers retain exact canonical comparison');
    const edited = caseModalPhysicalRoundTrip(original, units, { lengthStep: step });
    assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, edited, units), true,
      `${lengthUnit} one-step edit remains detectable`);
  }
});

test('F01-2/5/6 Case-modal kg/lb weight round trips are no-ops, but one displayed step is physical', async () => {
  const { PackLibrary } = await freshModules();
  const original = mkCase({ dimensions: { length: 20, width: 20, height: 10 }, weight: 52.91 });
  for (const weightUnit of ['kg', 'lb']) {
    const units = { lengthUnit: 'in', weightUnit };
    const noOp = { ...caseModalPhysicalRoundTrip(original, units), name: 'Renamed', category: 'audio' };
    if (weightUnit === 'kg') assert.notEqual(noOp.weight, original.weight, 'kg conversion creates real numeric drift');
    assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, noOp, units), false);
    const edited = caseModalPhysicalRoundTrip(original, units, { weightStep: 0.01 });
    assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(original, edited, units), true,
      `${weightUnit} one-step edit remains detectable`);
  }
});

test('F01-7/10 active metric metadata-only Case Save preserves Pack and canonical physical values in one Undo/Redo step', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const units = { lengthUnit: 'cm', weightUnit: 'kg' };
  const caseA = mkCase({ dimensions: { length: 47.3701, width: 20, height: 10 }, weight: 52.91 });
  const pack = { id: 'pack-active', truck: RECT_TRUCK,
    cases: [mkInst('A', caseA.id, { x: 60, y: 5, z: 0 })], lastEdited: 123, stats: {} };
  StateStore.init({ currentScreen: 'editor', currentPackId: pack.id, selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {} });
  const before = StateStore.snapshot();
  const beforePacks = StateStore.get('packLibrary');
  let packWrites = 0;
  const unsubscribe = StateStore.subscribe(changes => { if (changes.packLibrary) packWrites++; });
  const incoming = { ...caseModalPhysicalRoundTrip(caseA, units), name: 'Renamed', notes: 'Changed notes', category: 'audio' };
  const result = PackLibrary.commitCaseHandlingRuleChange(incoming, null, units);
  unsubscribe();

  const after = StateStore.snapshot();
  assert.equal(result.packImpact, null);
  assert.equal(packWrites, 0, 'no revalidation Pack write');
  assert.equal(StateStore.get('packLibrary'), beforePacks, 'active Pack identity and lastEdited stay unchanged');
  assert.equal(after.packLibrary[0].lastEdited, 123);
  assert.deepEqual(after.caseLibrary[0].dimensions, caseA.dimensions, 'round-trip drift does not enter canonical storage');
  assert.equal(after.caseLibrary[0].weight, caseA.weight);
  assert.equal(after.caseLibrary[0].name, 'Renamed');
  assert.equal(after.caseLibrary[0].notes, 'Changed notes');
  assert.equal(after.caseLibrary[0].category, 'audio');
  assert.equal(StateStore.undo(), true);
  assert.deepEqual(StateStore.snapshot(), before);
  assert.equal(StateStore.undo(), false, 'one Case Save remains one history action');
  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.snapshot(), after);
});

function initFixture(StateStore, caseA, pack, currentScreen = 'editor') {
  StateStore.init({ currentScreen, currentPackId: pack.id, selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {} });
}

function incompleteInstance(kind, placement = 'packed') {
  const inst = mkInst('incomplete', kind === 'missing' ? 'missing-case' : 'case-a', { x: 90, y: 5, z: 0 }, placement);
  if (kind === 'malformed') inst.transform.position = null;
  return inst;
}

const editorSource = readFileSync(new URL('../../src/screens/editor-screen.js', import.meta.url), 'utf8');

function sourceFunction(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to).trim();
}

async function runProductionUnpack(StateStore, PackLibrary, CaseLibrary) {
  const fn = sourceFunction(editorSource, 'async function unpackAll()', 'function renderInspectorNoPack()');
  const unpack = runInNewContext(`(${fn})`, { StateStore, PackLibrary, CaseLibrary, buildOrganizedUnpackStagingCases,
    clearPendingTruck() {}, endAutoPackResultsPreview() {}, OperationLifecycle: null, UIComponents: { showToast() {} },
    requestAnimationFrame: fn => fn(), render() {} });
  await unpack();
}

test('HANDLING-RULES-P0A production Unpack commits staged cargo without certification in one Undo/Redo action', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  const caseA = mkCase();
  const pack = activePackFixture();
  pack.handlingRulesValidatedSignature = PackLibrary.buildHandlingRulesValiditySignature(pack, [caseA]);
  initFixture(StateStore, caseA, pack);
  const before = StateStore.snapshot();
  await runProductionUnpack(StateStore, PackLibrary, CaseLibrary);
  const after = StateStore.snapshot();
  assert.ok(after.packLibrary[0].cases.every(i => i.placement === 'staged'));
  assert.equal(after.packLibrary[0].handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after.packLibrary[0], [caseA]), false);
  assert.equal(StateStore.undo(), true);
  assert.deepEqual(StateStore.snapshot(), before);
  assert.equal(StateStore.undo(), false);
  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.snapshot(), after);
});

test('HANDLING-RULES-P0A partial production Unpack preserves unresolved packed cargo without certification', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  for (const signature of ['v1:OLD', undefined]) {
    const pack = { ...activePackFixture(), handlingRulesValidatedSignature: signature };
    pack.cases.push(incompleteInstance('missing'));
    initFixture(StateStore, mkCase(), pack);
    await runProductionUnpack(StateStore, PackLibrary, CaseLibrary);
    const after = PackLibrary.getById(pack.id);
    assert.deepEqual(after.cases.find(i => i.id === 'incomplete'), pack.cases[2]);
    assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
    assert.ok(after.cases.filter(i => i.id !== 'incomplete').every(i => i.placement === 'staged'));
  }
});

function truckHarness(PackLibrary, CaseLibrary) {
  const modals = [];
  const element = () => ({ appendChild() {}, querySelectorAll: () => [] });
  const controller = createTruckChangeController({ PackLibrary, CaseLibrary,
    documentRef: { createElement: element, addEventListener() {}, removeEventListener() {} },
    UIComponents: { showToast() {}, showModal(config) {
      modals.push(config);
      return { modal: element(), close() { config.onClose?.(); } };
    } },
  });
  return { controller, modals };
}

for (const customCommit of [false, true]) {
  test(`HANDLING-RULES-P0A Truck Change certifies final staged set atomically (${customCommit ? 'Packs callback' : 'default commit'})`, async () => {
    const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
    const caseA = mkCase();
    const pack = { ...activePackFixture(), cases: [mkInst('cargo', 'case-a', { x: 60, y: 5, z: 0 })] };
    pack.handlingRulesValidatedSignature = PackLibrary.buildHandlingRulesValiditySignature(pack, [caseA]);
    initFixture(StateStore, caseA, pack);
    const before = StateStore.snapshot();
    const { controller, modals } = truckHarness(PackLibrary, CaseLibrary);
    const options = { pack: PackLibrary.getById(pack.id), nextTruck: { ...RECT_TRUCK, length: 30 } };
    if (customCommit) {
      const src = readFileSync(new URL('../../src/screens/packs-screen.js', import.meta.url), 'utf8');
      const callback = src.match(/commit: (finalPack => PackLibrary\.update\(packId, \{[\s\S]*?\}\)),/)[1];
      options.commit = runInNewContext(`(${callback})`, { PackLibrary, packId: pack.id, metadata: { title: 'Updated' } });
    }
    assert.equal(controller.request(options).status, 'preview');
    assert.equal(modals[0].actions.find(a => a.label === 'Move to staging').onClick(), true);
    const after = StateStore.snapshot();
    assert.equal(after.packLibrary[0].cases[0].placement, 'staged');
    assert.equal(after.packLibrary[0].handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
    assert.equal(PackLibrary.isHandlingRulesValidationRequired(after.packLibrary[0], [caseA]), false);
    assert.equal(StateStore.undo(), true);
    assert.deepEqual(StateStore.snapshot(), before);
    assert.equal(StateStore.undo(), false);
    assert.equal(StateStore.redo(), true);
    assert.deepEqual(StateStore.snapshot(), after);
  });
}

for (const kind of ['missing', 'malformed']) {
  test(`HANDLING-RULES-P0A Truck Change with ${kind} packed cargo cannot commit or certify`, async () => {
    const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
    const pack = { ...activePackFixture(), cases: [incompleteInstance(kind)], handlingRulesValidatedSignature: 'v1:OLD' };
    initFixture(StateStore, mkCase(), pack);
    const before = StateStore.snapshot();
    const { controller, modals } = truckHarness(PackLibrary, CaseLibrary);
    controller.request({ pack, nextTruck: { ...RECT_TRUCK, length: 30 } });
    assert.deepEqual(modals[0].actions.map(a => a.label), ['Cancel']);
    assert.deepEqual(StateStore.snapshot(), before);
  });
}

test('HANDLING-RULES-P0A unchanged truck metadata save does not certify stale cargo', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  const pack = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:OLD' };
  initFixture(StateStore, mkCase(), pack);
  const { controller } = truckHarness(PackLibrary, CaseLibrary);
  const result = controller.request({ pack, nextTruck: { ...pack.truck }, commitWhenUnchanged: true,
    commit: finalPack => PackLibrary.update(pack.id, { title: 'Metadata only', cases: finalPack.cases,
      handlingRulesValidatedSignature: finalPack.handlingRulesValidatedSignature }) });
  assert.equal(result.status, 'committed');
  assert.equal(PackLibrary.getById(pack.id).handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(PackLibrary.getById(pack.id), CaseLibrary.getCases()), false);
});

test('HANDLING-RULES-P0A Truck Change staging failure cannot publish a signature or partial cargo', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  const pack = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:OLD' };
  initFixture(StateStore, mkCase(), pack);
  const before = StateStore.snapshot();
  const failingLibrary = { ...PackLibrary, stagePlacementIds(source, ids) {
    return { pack: source, stagedIds: [], failedIds: ids };
  } };
  const { controller, modals } = truckHarness(failingLibrary, CaseLibrary);
  controller.request({ pack, nextTruck: { ...RECT_TRUCK, length: 30 } });
  assert.equal(modals[0].actions.find(a => a.label === 'Move to staging').onClick(), false);
  assert.deepEqual(StateStore.snapshot(), before);
});

const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

const mainCss = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');

const packsSource = readFileSync(new URL('../../src/screens/packs-screen.js', import.meta.url), 'utf8');

const casesSource = readFileSync(new URL('../../src/screens/cases-screen.js', import.meta.url), 'utf8');

test('VALIDATION-STATUS-UI Editor markup: banner and generic viewport info icon are gone; a compact hidden status + short hint card + hidden action panel replace them', () => {
  // Removed presentations.
  assert.doesNotMatch(indexHtml, /viewport-hint-icon|Editor tips|Click to select\. Drag to move/, 'the generic viewport info icon is removed');
  assert.doesNotMatch(indexHtml, /handling-rules-banner/, 'the full-width Handling Rules banner is removed');
  assert.doesNotMatch(mainCss, /viewport-hint|handling-rules-banner|\.badge--warning/, 'their dedicated CSS is removed');
  // The legitimate Editor/Inspector help icons are untouched.
  assert.match(mainCss, /\.tp3d-editor-info-icon\[data-tooltip\]::after/, 'other help icons keep their tooltip rules');

  // New compact status: hidden by default (bottom-left corner is empty for a current Pack).
  assert.match(indexHtml, /<div\b[^>]*\bclass="tp3d-editor-validation-status"[^>]*\bid="editor-validation-status"[^>]*\bhidden(?:\s|>)/);
  const statusBtn = indexHtml.match(/<button\b[^>]*\bid="editor-validation-status-btn"[^>]*>/)?.[0] || '';
  assert.match(statusBtn, /type="button"/);
  assert.match(statusBtn, /aria-label="Load plan needs review"/, 'accessible name uses the new user-facing copy');
  assert.match(statusBtn, /aria-expanded="false"/, 'aria-expanded still belongs to the click-open panel');
  assert.match(statusBtn, /aria-controls="editor-validation-popover"/);
  assert.match(statusBtn, /aria-describedby="editor-validation-hint-body"/, 'the short hint is the accessible description');
  assert.doesNotMatch(statusBtn, /data-tooltip|title=/, 'the generic black tooltip is NOT used on the warning');

  // Short informational hint card: title + one short line, no action, DOM-ordered after the icon for the CSS sibling rule.
  const hint = indexHtml.match(/<div\b[^>]*\bid="editor-validation-hint"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(hint, /role="tooltip"/);
  assert.match(hint, /class="tp3d-status-card__title">Load plan needs review</);
  assert.match(hint, /id="editor-validation-hint-body">Assessment uses current cargo source\.</);
  assert.doesNotMatch(hint, /<button|<a\b|<input|Check Load Plan/, 'the hint is informational only — no action, no long paragraph');
  const iBtn = indexHtml.indexOf('id="editor-validation-status-btn"');
  const iHint = indexHtml.indexOf('id="editor-validation-hint"');
  const iPop = indexHtml.indexOf('id="editor-validation-popover"');
  assert.ok(iBtn < iHint && iHint < iPop, 'DOM order: icon, hint card, action panel');

  // Small action panel: hidden by default, locked copy, real button that keeps its id.
  const popover = indexHtml.match(/<div\b[^>]*\bid="editor-validation-popover"[\s\S]*?<\/button>\s*<\/div>/)?.[0] || '';
  assert.match(popover, /\bhidden\b/);
  assert.match(popover, /role="dialog"[\s\S]*aria-modal="false"/, 'a small non-modal panel, not an alert modal');
  assert.match(popover, /class="tp3d-editor-validation-popover__title"[^>]*>\s*Load plan needs review\s*</);
  const panelBody = (popover.match(/class="tp3d-editor-validation-popover__body"[^>]*>([\s\S]*?)<\/p>/)?.[1] || '').replace(/\s+/g, ' ').trim();
  assert.equal(panelBody, 'Check the current physical assessment and operational eligibility. Cargo stays in place.');
  assert.match(popover, /<button\b[^>]*\bid="editor-handling-rules-validate-btn"[^>]*\btype="button"[^>]*>\s*Check Load Plan\s*<\/button>/);
  // Hidden state is honoured by CSS.
  assert.match(mainCss, /\.tp3d-editor-validation-status\[hidden\]\s*\{\s*display:\s*none\s*;\s*\}/);
  assert.match(mainCss, /\.tp3d-editor-validation-popover\[hidden\]\s*\{\s*display:\s*none\s*;\s*\}/);
  // Restrained: an anchored panel with no backdrop, opening upward from the corner icon.
  const popCss = mainCss.match(/\.tp3d-editor-validation-popover\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(popCss, /position:\s*absolute;/);
  assert.match(popCss, /bottom:\s*calc\(14px \+ 32px \+ 8px\);/, 'opens upward from the corner icon');
  assert.doesNotMatch(mainCss, /tp3d-editor-validation[^{]*\{[^}]*(?:backdrop|background:\s*rgb\(0)/, 'no modal backdrop or dimming scrim');

  // The wrapper is a transparent, click-through layer over the canvas (so the 3D scene stays interactive) that is
  // a size container, letting the panel and hint card be capped to the canvas's OWN width. Without the cap the
  // panel is clipped by .canvas-wrap { overflow: hidden } when the side panels squeeze the canvas and the
  // Check Load Plan button becomes unreachable.
  const layerCss = mainCss.match(/\.tp3d-editor-validation-status\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(layerCss, /position:\s*absolute;[\s\S]*inset:\s*0;/);
  assert.match(layerCss, /pointer-events:\s*none;/, 'the layer never blocks the 3D scene');
  assert.match(layerCss, /container-type:\s*inline-size;/);
  assert.match(popCss, /pointer-events:\s*auto;/, 'the panel itself stays interactive');
  assert.match(popCss, /max-width:\s*min\(260px, calc\(100cqw - 28px\)\);/, 'never wider than the canvas');
  assert.match(popCss, /min-width:\s*min\(220px, calc\(100cqw - 28px\)\);/, 'and its minimum also yields to a narrow canvas');
  assert.doesNotMatch(mainCss, /tp3d-editor-validation-status__btn\[data-tooltip\]/, 'no generic-tooltip rules remain on the warning icon');
});

test('VALIDATION-STATUS-UI Editor styling: black at rest, amber on hover / keyboard focus / open, and a CSS-only hint that never overlaps the open panel', () => {
  const rest = mainCss.match(/\.tp3d-editor-validation-status__btn\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rest, /position:\s*absolute;/, 'anchored in the corner without the generic [data-tooltip] override');
  assert.match(rest, /width:\s*32px;[\s\S]*height:\s*32px;/, 'same general scale as the removed info icon');
  assert.match(rest, /color:\s*var\(--text-primary\);/, 'RESTING: normal primary text colour, not amber');
  assert.doesNotMatch(rest, /--warning|#f59e0b|rgb\(245/i, 'no permanent amber at rest');
  assert.match(rest, /background:\s*var\(--bg-elevated\);/, 'no heavy warning fill');

  const active = mainCss.match(/\.tp3d-editor-validation-status__btn:hover,\s*\.tp3d-editor-validation-status__btn\[aria-expanded='true'\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(active, /color:\s*var\(--warning, #f59e0b\);/, 'HOVER / OPEN: amber via the existing warning token');
  assert.match(active, /border-color:\s*var\(--warning, #f59e0b\);/);
  const focus = mainCss.match(/\.tp3d-editor-validation-status__btn:focus-visible\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(focus, /outline:\s*2px solid var\(--focus-ring\);/, 'a clear keyboard focus treatment is preserved');
  assert.match(focus, /color:\s*var\(--warning, #f59e0b\);/, 'the warning glyph keeps its meaning on focus');
  assert.doesNotMatch(focus, /border-color|box-shadow/, 'focus does not stack a warning border or glow over the shared ring');

  // Hint card: hidden until hover/focus, capped to the canvas, revealed only while the panel is NOT open.
  const hintCss = mainCss.match(/\.tp3d-editor-validation-status \.tp3d-editor-validation-hint\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(hintCss, /position:\s*absolute;/);
  assert.match(hintCss, /visibility:\s*hidden;/);
  assert.match(hintCss, /max-width:\s*min\(220px, calc\(100cqw - 28px\)\);/, 'capped to the canvas width');
  assert.match(mainCss, /\.tp3d-editor-validation-status__btn:is\(:hover, :focus-visible\):not\(\[aria-expanded='true'\]\) ~ \.tp3d-editor-validation-hint\s*\{\s*visibility:\s*visible;/,
    'shown on hover/focus, never while the action panel is open');
  // Pure CSS: the Editor keeps no JS state for the hint (nothing to leak, nothing to conflict with the panel).
  assert.doesNotMatch(editorSource, /editor-validation-hint/);
});

test('VALIDATION-STATUS-UI Editor source: dead hint/banner code is gone, helper renamed, and no second validation authority is introduced', () => {
  assert.doesNotMatch(editorSource, /viewportHintBtn|viewportHintOpen|setViewportHintOpen|handlingRulesBanner|renderHandlingRulesBanner|viewport-hint-icon/);
  assert.match(editorSource, /function renderHandlingRulesStatus\(pack\) \{/);
  assert.equal((editorSource.match(/renderHandlingRulesStatus\(/g) || []).length, 3, 'defined once, called for no-Pack and for a Pack');
  const region = statusRegion();
  assert.doesNotMatch(region.status, /validateLoadPlan|buildHandlingRulesValiditySignature|handlingRulesValidatedSignature|commitCaseHandlingRuleChange/,
    'the status/panel code decides nothing and validates nothing itself');
  assert.match(region.status, /PackLibrary\.assessCommittedPack\(/, 'staleness still comes from the existing authority');
  assert.equal((region.all.match(/PackLibrary\.validateLoadPlan\(/g) || []).length, 1, 'exactly one validateLoadPlan call: the existing Validate handler');
  assert.match(region.handler, /PackLibrary\.validateLoadPlan\(packId, CaseLibrary\.getCases\(\)\)/);
  assert.doesNotMatch(packsSource, /validateLoadPlan\(/, 'Load Plans management screens never validate');
});

function statusRegion() {
  const from = editorSource.indexOf('let validationPopoverOpen = false;');
  const to = editorSource.indexOf('\n    // Swap a button', from);
  assert.ok(from >= 0 && to > from);
  const all = editorSource.slice(from, to);
  const handlerFrom = all.indexOf("handlingRulesValidateBtn.addEventListener('click', () => {");
  assert.ok(handlerFrom >= 0);
  const statusEnd = all.indexOf('if (validationStatusBtn) {');
  return { all, status: all.slice(0, statusEnd), handler: all.slice(handlerFrom) };
}

class StatusFakeNode {}

function makeStatusEl(doc, name, children = []) {
  const el = new StatusFakeNode();
  Object.assign(el, { name, hidden: true, attrs: {}, listeners: {}, children });
  el.querySelectorAll = () => [];
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.addEventListener = (type, fn) => { (el.listeners[type] ||= []).push(fn); };
  el.focus = () => { doc.activeElement = el; };
  el.contains = node => node === el || children.some(c => c === node || c.contains(node));
  return el;
}

function fireOn(el, type, extra = {}) {
  const ev = {
    type,
    target: el,
    stopped: false,
    defaultPrevented: false,
    stopPropagation() { this.stopped = true; },
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  };
  (el.listeners[type] || []).slice().forEach(fn => fn(ev));
  return ev;
}

function fireOnDocument(doc, type, extra = {}) {
  const ev = { type, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {}, ...extra };
  doc.listeners.filter(l => l.type === type).slice().forEach(l => l.fn(ev));
  return ev;
}

function mountEditorStatus({ StateStore, PackLibrary, CaseLibrary }) {
  const doc = {
    activeElement: null,
    listeners: [],
    addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn, capture) {
      this.listeners = this.listeners.filter(l => !(l.type === type && l.fn === fn && l.capture === capture));
    },
  };
  const validateBtn = makeStatusEl(doc, 'validate');
  const popover = makeStatusEl(doc, 'popover', [validateBtn]);
  const statusBtn = makeStatusEl(doc, 'status-btn');
  const status = makeStatusEl(doc, 'status', [statusBtn, popover]);
  const autoPackBtn = makeStatusEl(doc, 'autopack');
  const leftBtn = makeStatusEl(doc, 'left');
  const rightBtn = makeStatusEl(doc, 'right');
  for (const btn of [autoPackBtn, leftBtn, rightBtn]) {
    btn.hidden = false;
    btn.disabled = false;
  }
  const toasts = [];
  const calls = { validate: [], render: 0 };
  const busy = { value: false };
  const spyLibrary = { ...PackLibrary, validateLoadPlan: (...args) => { calls.validate.push(args); return PackLibrary.validateLoadPlan(...args); } };
  let api;
  const ctx = {
    document: doc, Node: StatusFakeNode, StateStore, CaseLibrary, PackLibrary: spyLibrary,
    UIComponents: { showToast: (message, tone) => toasts.push({ message, tone }) },
    editorMutationBlocked: () => busy.value,
    render: () => {
      calls.render += 1;
      api.renderHandlingRulesStatus(spyLibrary.getById(StateStore.get('currentPackId')));
    },
    btnAutopack: autoPackBtn, btnLeft: leftBtn, btnRight: rightBtn,
    validationStatusEl: status, validationStatusBtn: statusBtn, validationPopoverEl: popover, handlingRulesValidateBtn: validateBtn,
  };
  api = runInNewContext(
    `(function () {\n${statusRegion().all}\nreturn { renderHandlingRulesStatus, setValidationPopoverOpen, isOpen: () => validationPopoverOpen };\n})()`,
    ctx
  );
  return { doc, api, status, statusBtn, popover, validateBtn, autoPackBtn, leftBtn, rightBtn, toasts, calls, busy, spyLibrary, ctx };
}

function runEditorRenderGate(StateStore, setValidationPopoverOpen) {
  const marker = '    function render() {';
  const from = editorSource.indexOf(marker);
  const to = editorSource.indexOf('      ensureScene();', from);
  assert.ok(from >= 0 && to > from);
  const gate = editorSource.slice(from + marker.length, to);
  return runInNewContext(`(function () {${gate}\nreturn true;\n})()`, { StateStore, setValidationPopoverOpen, previewScene: null });
}

const stalePackFixture = () => { const pack = activePackFixture(); pack.cases[1].transform.position.y = 18; return { ...pack, handlingRulesValidatedSignature: 'v1:OLD' }; };

test('VALIDATION-STATUS-UI Editor: a stale Pack shows ONE compact status; a current Pack shows nothing', async () => {
  const mods = await freshModules();
  const caseA = mkCase();
  initFixture(mods.StateStore, caseA, stalePackFixture());
  const m = mountEditorStatus(mods);
  const stale = mods.PackLibrary.getById('pack-active');
  assert.equal(mods.PackLibrary.isHandlingRulesValidationRequired(stale, [caseA]), true, 'fixture really is stale under the real authority');

  m.api.renderHandlingRulesStatus(stale);
  assert.equal(m.status.hidden, false, 'stale: the compact status is shown');
  assert.equal(m.popover.hidden, true, 'the panel stays closed until the icon is clicked');
  assert.equal(m.statusBtn.attrs['aria-expanded'], undefined, 'no state is written until the user interacts');

  const current = activePackFixture();
  mods.StateStore.set({ packLibrary: [current] });
  m.api.renderHandlingRulesStatus(current);
  assert.equal(m.status.hidden, true, 'current: the bottom-left corner is empty');
  m.api.renderHandlingRulesStatus(null);
  assert.equal(m.status.hidden, true, 'no Pack: nothing is shown');
});

test('VALIDATION-STATUS-UI Editor: clicking the icon only toggles the panel — it never validates or mutates cargo', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  const before = mods.StateStore.snapshot();
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));

  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), true);
  assert.equal(m.popover.hidden, false);
  assert.equal(m.statusBtn.attrs['aria-expanded'], 'true');
  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), false);
  assert.equal(m.popover.hidden, true);
  assert.equal(m.statusBtn.attrs['aria-expanded'], 'false');

  assert.equal(m.calls.validate.length, 0, 'opening/closing the panel never calls the validation authority');
  assert.equal(m.calls.render, 0);
  assert.deepEqual(mods.StateStore.snapshot(), before, 'and never touches cargo, signature, or history');
  assert.equal(mods.StateStore.undo(), false);
});

test('VALIDATION-STATUS-UI Editor: Validate Load Plan reuses the existing authority and toasts, closes the panel, and the status disappears once current', async () => {
  const mods = await freshModules();
  const caseA = mkCase();
  initFixture(mods.StateStore, caseA, stalePackFixture());
  const m = mountEditorStatus(mods);
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  fireOn(m.statusBtn, 'click');
  m.doc.activeElement = m.validateBtn;

  fireOn(m.validateBtn, 'click');
  assert.equal(m.calls.validate.length, 1, 'exactly one validation, through the existing PackLibrary.validateLoadPlan');
  assert.deepEqual(m.calls.validate[0], ['pack-active', mods.CaseLibrary.getCases()]);
  assert.equal(m.calls.render, 1, 'the existing handler re-renders');
  assert.equal(m.api.isOpen(), false, 'the panel closes as soon as the explicit action is taken');
  assert.deepEqual(m.toasts, [{ message: 'Load Plan checked: INVALID. Operational eligibility: blocked. Cargo unchanged.', tone: 'warning' }]);

  const after = mods.PackLibrary.getById('pack-active');
  assert.equal(mods.PackLibrary.isHandlingRulesValidationRequired(after, [caseA]), true, 'read-only Check leaves physical findings present');
  assert.equal(m.status.hidden, false, 'status remains until source is corrected');
  assert.equal(m.doc.activeElement, m.statusBtn, 'focus returns to the still-visible status');
  assert.equal(m.status.contains(m.doc.activeElement), true);
});

test('VALIDATION-STATUS-UI Editor: incomplete validation closes the panel and returns focus to the still-visible warning', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  m.ctx.PackLibrary.validateLoadPlan = () => ({ primary: 'INCOMPLETE', eligibility: { state: 'blocked' } });
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  fireOn(m.statusBtn, 'click');
  m.doc.activeElement = m.validateBtn;

  fireOn(m.validateBtn, 'click');

  assert.equal(m.api.isOpen(), false);
  assert.equal(m.status.hidden, false, 'incomplete validation leaves the stale warning visible');
  assert.equal(m.doc.activeElement, m.statusBtn, 'focus returns only after the warning is known to remain visible');
});

test('VALIDATION-STATUS-UI Editor: every validation outcome keeps its original toast copy and tone; a busy Editor never validates', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const outcomes = [
    ...[['VALID', 'eligible'], ['VALID', 'blocked'], ['INCOMPLETE', 'eligible'], ['INCOMPLETE', 'blocked'], ['INVALID', 'blocked']]
      .map(([primary, state]) => [{ primary, eligibility: { state } },
        `Load Plan checked: ${primary}. Operational eligibility: ${state}. Cargo unchanged.`,
        primary === 'VALID' && state === 'eligible' ? 'success' : 'warning']),
    [null, 'Validation failed. Please try again.', 'error'],
  ];
  for (const [result, message, tone] of outcomes) {
    const m = mountEditorStatus(mods);
    m.ctx.PackLibrary.validateLoadPlan = () => result;
    fireOn(m.validateBtn, 'click');
    assert.deepEqual(m.toasts, [{ message, tone }], `outcome ${JSON.stringify(result)}`);
  }
  const busy = mountEditorStatus(mods);
  busy.busy.value = true;
  fireOn(busy.validateBtn, 'click');
  assert.equal(busy.calls.validate.length, 0, 'editorMutationBlocked() still gates the action');
  assert.deepEqual(busy.toasts, []);
});

test('VALIDATION-STATUS-UI Editor: Escape and an outside press close the panel, a press inside does not, and document listeners never leak', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  assert.equal(m.doc.listeners.length, 0, 'nothing is registered while the panel is closed');

  fireOn(m.statusBtn, 'click');
  assert.deepEqual(m.doc.listeners.map(l => `${l.type}:${l.capture}`).sort(), ['keydown:true', 'pointerdown:true'],
    'exactly two capture-phase listeners exist only while open');

  // A press INSIDE the status area (icon or panel) leaves it open.
  fireOnDocument(m.doc, 'pointerdown', { target: m.validateBtn });
  fireOnDocument(m.doc, 'pointerdown', { target: m.statusBtn });
  assert.equal(m.api.isOpen(), true);
  // A press OUTSIDE closes it (capture phase, so the 3D canvas cannot swallow it).
  fireOnDocument(m.doc, 'pointerdown', { target: new StatusFakeNode() });
  assert.equal(m.api.isOpen(), false);
  assert.equal(m.doc.listeners.length, 0);

  // Escape closes, stops the event, and returns focus to the icon when focus was inside the panel.
  fireOn(m.statusBtn, 'click');
  m.doc.activeElement = m.validateBtn;
  const esc = fireOnDocument(m.doc, 'keydown', { key: 'Escape' });
  assert.equal(esc.stopped, true);
  assert.equal(m.api.isOpen(), false);
  assert.equal(m.doc.activeElement, m.statusBtn, 'keyboard focus returns to the icon');
  // Other keys do nothing.
  fireOn(m.statusBtn, 'click');
  fireOnDocument(m.doc, 'keydown', { key: 'Tab' });
  assert.equal(m.api.isOpen(), true);
  fireOn(m.statusBtn, 'click');

  // Many re-renders and open/close cycles: the listener count returns to zero every time.
  for (let i = 0; i < 5; i += 1) {
    m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
    fireOn(m.statusBtn, 'click');
    m.api.setValidationPopoverOpen(true); // already open: must not register a second pair
    assert.equal(m.doc.listeners.length, 2);
    fireOn(m.statusBtn, 'click');
    assert.equal(m.doc.listeners.length, 0);
  }
});

test('VALIDATION-STATUS-UI Editor: the panel closes when the Pack becomes current, switches, or the Editor is re-entered', async () => {
  const mods = await freshModules();
  const caseA = mkCase();
  initFixture(mods.StateStore, caseA, stalePackFixture());
  const m = mountEditorStatus(mods);
  const stale = mods.PackLibrary.getById('pack-active');

  m.api.renderHandlingRulesStatus(stale);
  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), true);
  m.api.renderHandlingRulesStatus(stale); // an unrelated re-render keeps it open
  assert.equal(m.api.isOpen(), true);

  mods.StateStore.set({ packLibrary: [activePackFixture()] });
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById(stale.id));
  assert.equal(m.api.isOpen(), false, 'no longer stale: closed');
  assert.equal(m.status.hidden, true);
  assert.equal(m.doc.listeners.length, 0);

  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), true);
  m.api.renderHandlingRulesStatus({ ...stale, id: 'another-pack' });
  assert.equal(m.api.isOpen(), false, 'a different Load Plan renders: closed');
  assert.equal(m.doc.listeners.length, 0);

  // Entering the Editor always starts closed.
  assert.match(editorSource, /function onActivated\(\) \{\s*\/\/[^\n]*\n\s*setValidationPopoverOpen\(false\);/);
});

test('VALIDATION-STATUS-UI Editor: leaving through the normal screen-render flow closes the panel and removes document listeners', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  fireOn(m.statusBtn, 'click');
  m.doc.activeElement = m.validateBtn;
  assert.equal(m.doc.listeners.length, 2);

  mods.StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
  runEditorRenderGate(mods.StateStore, m.api.setValidationPopoverOpen);

  assert.equal(m.api.isOpen(), false, 'render closes the panel before returning outside Editor');
  assert.equal(m.popover.hidden, true);
  assert.equal(m.doc.listeners.length, 0, 'both document capture listeners are removed immediately');
  const esc = fireOnDocument(m.doc, 'keydown', { key: 'Escape' });
  assert.equal(esc.stopped, false, 'Escape on another screen is not intercepted by stale Editor listeners');

  mods.StateStore.set({ currentScreen: 'editor' }, { skipHistory: true });
  assert.equal(m.api.isOpen(), false, 're-entering Editor begins with the panel closed');
  assert.equal(m.doc.listeners.length, 0, 're-entry does not accumulate document listeners');

  const screenRenderFlow = appSource.slice(
    appSource.indexOf('if (changes.currentScreen || changes._replace) {'),
    appSource.indexOf('if (changes.caseLibrary || changes.packLibrary', appSource.indexOf('if (changes.currentScreen || changes._replace) {'))
  );
  assert.match(screenRenderFlow, /AppShell\.renderShell\(\);\s*EditorUI\.render\(\);/,
    'every currentScreen notification invokes the Editor render gate, including navigation away');
});

function packStatusRegion() {
  const from = packsSource.indexOf("const PACK_STATUS_CARD_ID = 'tp3d-pack-status-card';");
  const to = packsSource.indexOf('function createPackNotesButton(', from);
  assert.ok(from >= 0 && to > from);
  return packsSource.slice(from, to);
}

function packScreenChangeCleanupRegion() {
  const from = packsSource.indexOf('function initToolbarDropdownCoordinator()');
  const to = packsSource.indexOf('\n    function applyFiltersVisibility()', from);
  assert.ok(from >= 0 && to > from);
  return packsSource.slice(from, to);
}

function mountPackStatus({ vw = 1000, vh = 800, stateStore = null } = {}) {
  const body = { children: [], appendChild(el) { this.children.push(el); el.isConnected = true; } };
  const win = {
    listeners: [],
    addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture: Boolean(capture) }); },
    removeEventListener(type, fn, capture) {
      this.listeners = this.listeners.filter(l => !(l.type === type && l.fn === fn && l.capture === Boolean(capture)));
    },
  };
  const makeEl = () => {
    const el = {
      dataset: {}, attrs: {}, listeners: {}, className: '', tabIndex: -1, innerHTML: '', id: '', style: {}, isConnected: true,
      classes: new Set(), rect: { left: 0, top: 0, right: 0, bottom: 0 }, offsetWidth: 186, offsetHeight: 56,
    };
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
    el.addEventListener = (type, fn) => { (el.listeners[type] ||= []).push(fn); };
    el.classList = { add: c => el.classes.add(c), remove: c => el.classes.delete(c), contains: c => el.classes.has(c) };
    el.getBoundingClientRect = () => el.rect;
    el.getAttribute = key => el.attrs[key];
    const texts = {};
    el.querySelector = key => texts[key] ||= { textContent: '' };
    return el;
  };
  const document = {
    createElement: makeEl,
    body,
    documentElement: { clientWidth: vw, clientHeight: vh },
    getElementById: id => body.children.find(el => el.id === id) || null,
  };
  let dropdownCloseCount = 0;
  const UIComponents = {
    registerDropdownSurface() {},
    closeAllDropdowns() { dropdownCloseCount += 1; },
  };
  const PreferencesManager = { get: () => ({ packsFiltersVisible: false }) };
  const screenCleanup = stateStore
    ? `
let toolbarDropdownCoordinatorInitialized = false;
const btnFiltersToggle = null;
function setFiltersVisible() {}
${packScreenChangeCleanupRegion()}
initToolbarDropdownCoordinator();`
    : '';
  const api = runInNewContext(
    `(function () {\n${packStatusRegion()}\n${screenCleanup}\nreturn { createPackValidationStatus, hidePackStatusCard, current: () => packStatusCardAnchor };\n})()`,
    { document, window: win, StateStore: stateStore, UIComponents, PreferencesManager }
  );
  const createStatus = api.createPackValidationStatus;
  api.createPackValidationStatus = (options = {}) => createStatus({ assessment: { primary: 'INVALID', eligibility: { state: 'eligible' } }, ...options });
  const place = (el, left, top, w = 28, h = 28) => { el.rect = { left, top, right: left + w, bottom: top + h }; return el; };
  const card = () => body.children.find(el => el.id === 'tp3d-pack-status-card');
  return {
    api, body, win, card, place,
    visible: () => Boolean(card() && card().classes.has('is-visible')),
    windowListeners: () => win.listeners.map(l => `${l.type}:${l.capture}`).sort(),
    dropdownCloseCount: () => dropdownCloseCount,
  };
}

test('VALIDATION-STATUS-UI Load Plans: the status icon uses the new accessible name, has NO generic tooltip, and stays contained (click and keyboard)', () => {
  const m = mountPackStatus();
  for (const [opts, expectedClass] of [[undefined, 'tp3d-validation-status'], [{ inline: true }, 'tp3d-validation-status tp3d-validation-status--inline']]) {
    const el = m.api.createPackValidationStatus(opts);
    assert.equal(el.className, expectedClass);
    assert.equal(el.attrs['aria-label'], 'Load plan: INVALID');
    assert.equal('data-tooltip' in el.attrs, false, 'the generic black tooltip is not used');
    assert.equal('title' in el.attrs, false, 'no native title tooltip either');
    assert.equal(el.attrs['aria-describedby'], 'tp3d-pack-status-card-body', 'the short card body is the accessible description');
    assert.equal(el.attrs.role, 'img', 'a status, not a button');
    assert.equal(el.attrs['data-pack-status'], 'validation');
    assert.equal(el.tabIndex, 0, 'focusable so the card is reachable by keyboard');
    assert.match(el.innerHTML, /fa-triangle-exclamation/);
    assert.match(el.innerHTML, /aria-hidden="true"/);
    // Neither a click nor Enter/Space can reach the card/row handlers (open, select, Notes, overflow).
    assert.equal(el.listeners.click.length, 1);
    assert.equal(fireOn(el, 'click').stopped, true, 'click must stop propagation');
    assert.equal(el.listeners.keydown.length, 1);
    for (const key of ['Enter', ' ']) {
      const ev = fireOn(el, 'keydown', { key });
      assert.equal(ev.stopped, true, `${JSON.stringify(key)} must stop propagation`);
      assert.equal(ev.defaultPrevented, true, `${JSON.stringify(key)} must prevent default`);
    }
    const tab = fireOn(el, 'keydown', { key: 'Tab' });
    assert.equal(tab.defaultPrevented, false, 'Tab keeps its native focus-navigation behavior');
    assert.equal(tab.stopped, true, 'the status remains contained inside its row/card');
    assert.equal(m.visible(), false, 'keyboard containment never opens or mutates the status card');
    assert.equal(el.listeners.click.length + el.listeners.keydown.length, 2, 'and it performs no action of its own');
  }
});

test('VALIDATION-STATUS-UI Load Plans: ONE shared informational card — created once, body-level, exact short copy, no action', () => {
  const m = mountPackStatus();
  const icons = [m.api.createPackValidationStatus(), m.api.createPackValidationStatus({ inline: true }), m.api.createPackValidationStatus()];
  assert.equal(m.body.children.length, 1, 'many icons share a single card element');
  const card = m.card();
  assert.match(card.className, /tp3d-status-card tp3d-status-card--floating/);
  assert.equal(card.attrs.role, 'tooltip');
  assert.match(card.innerHTML, /class="tp3d-status-card__title">Load plan needs review</);
  assert.match(card.innerHTML, /id="tp3d-pack-status-card-body">Assessment uses current cargo source\.</);
  assert.doesNotMatch(card.innerHTML, /<button|<a\b|<input|Check Load Plan|validat/i, 'informational only — no action and no technical wording');
  assert.equal(card.classes.has('is-visible'), false, 'hidden until hover/focus');
  assert.equal(m.win.listeners.length, 0, 'no document/window listeners exist while the card is hidden');
  assert.ok(icons.every(i => i.attrs['aria-describedby'] === 'tp3d-pack-status-card-body'));
});

test('VALIDATION-STATUS-UI Load Plans: hover or keyboard focus shows the ONE card; leave/blur hides it; a mouse-click focus never pins it; another icon is never hidden by a late event', () => {
  const m = mountPackStatus();
  const a = m.place(m.api.createPackValidationStatus(), 500, 300);

  fireOn(a, 'pointerenter');
  assert.equal(m.visible(), true, 'hover shows the card');
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), false, 'pointer leave hides it');

  fireOn(a, 'focus');
  assert.equal(m.visible(), true, 'keyboard focus shows the card');
  fireOn(a, 'blur');
  assert.equal(m.visible(), false, 'blur hides it');

  // Hover + focus together: still one card and one pair of listeners; it stays while either holds.
  fireOn(a, 'focus');
  fireOn(a, 'pointerenter');
  assert.equal(m.body.children.length, 1, 'never a duplicate card');
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true'], 'listeners registered exactly once');
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), true, 'still keyboard-focused');
  fireOn(a, 'blur');
  assert.equal(m.visible(), false);
  assert.equal(m.win.listeners.length, 0);

  // A mouse press also focuses the icon; that focus must not keep the card up once the pointer leaves.
  fireOn(a, 'pointerdown', { pointerType: 'mouse' });
  fireOn(a, 'pointerenter');
  fireOn(a, 'focus');
  assert.equal(m.visible(), true);
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), false, 'a click-focus does not pin the card');
  fireOn(a, 'blur');

  // A mouse press while already focused must not poison the next keyboard focus.
  fireOn(a, 'focus');
  fireOn(a, 'pointerdown', { pointerType: 'mouse' });
  fireOn(a, 'blur');
  fireOn(a, 'focus');
  assert.equal(m.visible(), true, 'blur clears stale mouse classification before the next keyboard focus');
  fireOn(a, 'blur');

  // Touch has no hover: the press focus keeps the card until blur.
  fireOn(a, 'pointerenter', { pointerType: 'touch' });
  fireOn(a, 'pointerdown', { pointerType: 'touch' });
  fireOn(a, 'pointerleave');
  fireOn(a, 'focus');
  assert.equal(m.visible(), true, 'touch focus keeps the card visible');
  fireOn(a, 'blur');
  assert.equal(m.visible(), false);

  // Ownership: a late leave/blur from icon A must not hide the card that icon B now owns.
  const b = m.place(m.api.createPackValidationStatus(), 500, 400);
  fireOn(a, 'pointerenter');
  fireOn(b, 'pointerenter');
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), true);
  assert.equal(m.api.current(), b);
  fireOn(b, 'pointerleave');
  assert.equal(m.visible(), false);
  assert.equal(m.api.current(), null);
  assert.equal(m.win.listeners.length, 0);
});

test('VALIDATION-STATUS-UI Load Plans: the card follows scroll/resize, hides when the icon leaves the view or the DOM, render() drops it, and listeners never leak', () => {
  const m = mountPackStatus();
  const a = m.place(m.api.createPackValidationStatus(), 500, 300);
  fireOn(a, 'pointerenter');
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true']);

  // The page scrolls: the card follows its icon.
  m.place(a, 500, 250);
  m.win.listeners.find(l => l.type === 'scroll').fn();
  assert.equal(m.card().style.top, `${250 - 6 - 56}px`);
  assert.equal(m.visible(), true);

  // The icon scrolls out of view: card hidden, listeners removed.
  m.place(a, 500, -100);
  m.win.listeners.find(l => l.type === 'scroll').fn();
  assert.equal(m.visible(), false);
  assert.equal(m.win.listeners.length, 0);
  assert.equal(m.api.current(), null);

  // The icon is removed from the DOM (a re-render) while shown.
  m.place(a, 500, 300);
  fireOn(a, 'pointerenter');
  assert.equal(m.visible(), true);
  a.isConnected = false;
  m.win.listeners.find(l => l.type === 'resize').fn();
  assert.equal(m.visible(), false);
  assert.equal(m.win.listeners.length, 0);

  // render() calls hidePackStatusCard() with no anchor: drops the card whoever owns it; a no-op when hidden.
  a.isConnected = true;
  m.api.hidePackStatusCard();
  for (let i = 0; i < 5; i += 1) {
    fireOn(a, 'pointerenter');
    fireOn(a, 'pointerleave');
    fireOn(a, 'pointerenter');
    assert.equal(m.win.listeners.length, 2, 'exactly one pair while shown');
    m.api.hidePackStatusCard();
    assert.equal(m.visible(), false);
    assert.equal(m.win.listeners.length, 0);
  }
  assert.match(packsSource, /function render\(modeOverride\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*hidePackStatusCard\(\);/,
    'the rebuild replaces every icon, so render() drops the shared card first');
});

test('VALIDATION-STATUS-UI Load Plans: screen changes hide the card, clear its anchor, and remove listeners without accumulation', async () => {
  const StateStore = await import(`${stateStorePath.href}?packs-status-exit=${Date.now()}-${Math.random()}`);
  StateStore.init({
    currentScreen: 'packs', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {},
  });
  const m = mountPackStatus({ stateStore: StateStore });
  const status = m.place(m.api.createPackValidationStatus(), 500, 300);

  fireOn(status, 'pointerenter');
  assert.equal(m.visible(), true);
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true']);

  StateStore.set({ currentScreen: 'editor' }, { skipHistory: true });
  assert.equal(m.dropdownCloseCount(), 1, 'the existing screen-change cleanup still closes dropdowns');
  assert.equal(m.visible(), false, 'leaving Load Plans hides the body-level card');
  assert.equal(m.api.current(), null, 'screen exit clears the shared card anchor');
  assert.deepEqual(m.windowListeners(), [], 'screen exit removes both temporary window listeners');

  StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
  assert.equal(m.visible(), false, 're-entering Load Plans begins with the card closed');
  assert.deepEqual(m.windowListeners(), []);
  fireOn(status, 'pointerleave');
  fireOn(status, 'pointerenter');
  assert.equal(m.visible(), true, 'the status card still opens normally after re-entry');
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true'], 're-entry registers only one listener pair');

  StateStore.set({ currentScreen: 'cases' }, { skipHistory: true });
  assert.equal(m.visible(), false);
  assert.equal(m.api.current(), null);
  assert.deepEqual(m.windowListeners(), [], 'a later exit removes the pair again without accumulation');
});

test('VALIDATION-STATUS-UI Load Plans: the card sits above the icon (Grid end-aligned, List start-aligned), flips below only without room, and stays inside the viewport', () => {
  const m = mountPackStatus({ vw: 1000, vh: 800 });
  const grid = m.place(m.api.createPackValidationStatus(), 500, 300);
  const list = m.place(m.api.createPackValidationStatus({ inline: true }), 500, 300);

  fireOn(grid, 'pointerenter');
  assert.equal(m.card().style.top, `${300 - 6 - 56}px`, 'above the icon, not over the metadata below it');
  assert.equal(m.card().style.left, `${528 - 186}px`, 'Grid: the card ends at the icon so it stays inside the Load Plan card');
  fireOn(grid, 'pointerleave');
  fireOn(list, 'pointerenter');
  assert.equal(m.card().style.top, `${300 - 6 - 56}px`);
  assert.equal(m.card().style.left, '500px', 'List: the card starts at the icon so the row above keeps its title uncovered');
  fireOn(list, 'pointerleave');

  m.place(grid, 500, 40);
  fireOn(grid, 'pointerenter');
  assert.equal(m.card().style.top, `${40 + 28 + 6}px`, 'no room above: flips below');
  fireOn(grid, 'pointerleave');

  m.place(grid, 20, 300);
  fireOn(grid, 'pointerenter');
  assert.equal(m.card().style.left, '8px', 'never past the left viewport edge');
  fireOn(grid, 'pointerleave');
  m.place(list, 980, 300);
  fireOn(list, 'pointerenter');
  assert.equal(m.card().style.left, `${1000 - 186 - 8}px`, 'never past the right viewport edge');
  fireOn(list, 'pointerleave');

  m.place(grid, 500, 900);
  fireOn(grid, 'pointerenter');
  assert.equal(m.visible(), false, 'an icon below the viewport never shows a floating card');
  assert.equal(m.win.listeners.length, 0);
});

test('VALIDATION-STATUS-UI Load Plans Grid: stale Pack gets the icon between the title and Notes; no chip, no long tooltip; the card ignores it', () => {
  const grid = packsSource.slice(packsSource.indexOf('function renderGridView(packs) {'), packsSource.indexOf('function buildPreview('));
  assert.ok(grid.length > 500);
  assert.doesNotMatch(grid, /badge--warning|validationBadge|Validation required/, 'the old chip is gone from the Grid');
  // P1-C: selection now LEADS the title in the header; only the warning, Notes and overflow trail.
  const cluster = grid.slice(grid.indexOf("actions.className = 'card-head-actions tp3d-management-card-actions'"), grid.indexOf('head.appendChild(selectCb)'));
  const iSel = cluster.indexOf('actions.appendChild(selectCb)');
  const iStatus = cluster.indexOf('actions.appendChild(createPackValidationStatus({ assessment }))');
  const iNotes = cluster.indexOf('actions.appendChild(createPackNotesButton(pack))');
  const iKebab = cluster.indexOf('actions.appendChild(kebabBtn)');
  assert.equal(iSel, -1, 'the checkbox is no longer in the trailing cluster');
  assert.ok(iStatus >= 0 && iStatus < iNotes && iNotes < iKebab, 'trailing order: [ warning ] [ Notes ] [ ⋮ ]');
  const iHeadSel = grid.indexOf('head.appendChild(selectCb)');
  const iHeadTitle = grid.indexOf('head.appendChild(titleWrap)');
  const iHeadActions = grid.indexOf('head.appendChild(actions)');
  assert.ok(iHeadSel >= 0 && iHeadSel < iHeadTitle && iHeadTitle < iHeadActions, 'header order: [ checkbox ] title [ warning / Notes / ⋮ ]');
  assert.match(cluster, /actions\.appendChild\(createPackValidationStatus\(\{ assessment \}\)\)/,
    'shown only when the existing authority says the Load Plan is stale');
  // The whole-card click handler skips the status (in addition to the status stopping propagation itself).
  const cardClick = grid.slice(grid.indexOf("card.addEventListener('click'"), grid.indexOf('openPack(pack.id);'));
  assert.match(cardClick, /targetEl\.closest\('\[data-pack-status\]'\)/);
});

test('VALIDATION-STATUS-UI Load Plans List: stale Pack gets the same icon beside the title; no chip and no new column', () => {
  const list = packsSource.slice(packsSource.indexOf('function renderListView(packs) {'), packsSource.indexOf('function renderGridView(packs) {'));
  assert.ok(list.length > 500);
  assert.doesNotMatch(list, /badge--warning|validationBadge|Validation required/, 'the old chip is gone from the List');
  assert.match(list, /title\.appendChild\(createPackValidationStatus\(\{ inline: true, assessment \}\)\)/);
  assert.equal((list.match(/\btr\.appendChild\(/g) || []).length, 12, 'the row keeps its existing 12 cells — no new column, no structure change');
  assert.equal((list.match(/createElement\('td'\)/g) || []).length, 12);
});

test('VALIDATION-STATUS-UI Scope: old technical copy is gone, the locked copy is present, and there is no Case-level warning', () => {
  const oldCopy = [/Validation required/, /Validate Load Plan/, /Handling Rules changed since this Load Plan was last validated/, /last validated/];
  for (const [name, src] of [['index.html', indexHtml], ['packs-screen.js', packsSource], ['editor-screen.js', editorSource], ['cases-screen.js', casesSource], ['main.css', mainCss]]) {
    for (const re of oldCopy) assert.doesNotMatch(src, re, `${name} must not carry ${re}`);
  }
  assert.doesNotMatch(packsSource, /referenced Case’s Handling Rules/, 'the explanation lives only in the Editor panel');
  assert.doesNotMatch(packStatusRegion(), /['"`]data-tooltip['"`]|data-tooltip=/, 'the Load Plans warning never sets the generic tooltip attribute');

  // Locked new copy.
  assert.equal((indexHtml.match(/Load plan needs review/g) || []).length, 3, 'Editor: icon name, hint title, panel title');
  assert.equal((indexHtml.match(/Assessment uses current cargo source\./g) || []).length, 1);
  assert.equal((indexHtml.match(/Check Load Plan/g) || []).length, 1);
  assert.match(packsSource, /Load plan needs review/);
  assert.match(packsSource, /Assessment uses current cargo source\./);

  // The internal names are NOT renamed by this copy change.
  assert.match(editorSource, /PackLibrary\.validateLoadPlan\(packId, CaseLibrary\.getCases\(\)\)/);
  assert.match(packsSource, /PackLibrary\.assessCommittedPack\(/);
  assert.doesNotMatch(casesSource, /isHandlingRulesValidationRequired|Load plan needs review|createPackValidationStatus|data-pack-status/,
    'no Case-level validation status exists or is implied');
});

test('VALIDATION-STATUS-UI Scope: Load Plans icon is amber (warning color) at rest and on hover/keyboard focus, since the free Font Awesome build has no outline warning glyph to lighten its weight instead; the shared card is a restrained token-based surface; the global tooltip system is untouched', () => {
  // PR #58 polish pass (2026-09): superseded the prior "black at rest, amber
  // only on hover" contract this test asserted — fa-regular
  // fa-triangle-exclamation is Pro-only on the FA 6.5.1 free build this
  // project loads (verified live: renders as a missing glyph), so instead of
  // swapping to a differently-shaped icon, the existing solid triangle stays
  // permanently in its warning color to read as attention-worthy at rest.
  const status = mainCss.match(/\.tp3d-validation-status\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(status, /color:\s*var\(--warning, #f59e0b\);/, 'RESTING: the icon is amber (warning color) at rest, not just on hover/focus');
  assert.doesNotMatch(status, /\bborder\s*:|background/, 'a compact icon: no chip fill and no border');
  assert.match(mainCss, /\.tp3d-validation-status:hover,\s*\.tp3d-validation-status:focus-visible\s*\{\s*color:\s*var\(--warning, #f59e0b\);\s*\}/,
    'HOVER and FOCUS-VISIBLE: amber via the existing warning token');
  assert.match(mainCss, /\.tp3d-validation-status:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);/, 'a clear keyboard focus treatment is preserved');
  assert.match(mainCss, /\.tp3d-validation-status--inline\s*\{/);

  const surface = mainCss.match(/\.tp3d-status-card\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(surface, /pointer-events:\s*none;/, 'never captures the pointer');
  for (const token of ['--bg-elevated', '--border-subtle', '--radius-md', '--shadow-md']) {
    assert.match(surface, new RegExp(`var\\(${token}\\)`), `uses the existing ${token} token`);
  }
  const cardCss = mainCss.slice(mainCss.indexOf('.tp3d-status-card {'), mainCss.indexOf('.tp3d-status-card--floating.is-visible'));
  assert.doesNotMatch(cardCss, /#[0-9a-f]{3,8}\b|rgb\(|--danger|--error|red\b/i, 'no hard-coded palette and no red/destructive styling');
  const floating = mainCss.match(/\.tp3d-status-card--floating\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(floating, /position:\s*fixed;/, 'fixed: no scrolling table wrapper or card edge can clip it');
  assert.match(floating, /visibility:\s*hidden;/);
  assert.match(mainCss, /\.tp3d-status-card--floating\.is-visible\s*\{\s*visibility:\s*visible;/);

  // The global tooltip system and the other help icons are untouched.
  assert.match(mainCss, /\[data-tooltip\]::after\s*\{[^}]*content:\s*attr\(data-tooltip\);/);
  assert.match(mainCss, /\.tp3d-editor-info-icon\[data-tooltip\]::after/);
});

function seedDeletion(StateStore, { cases, packs, currentScreen = 'cases', currentPackId = null, selectedInstanceIds = [] }) {
  StateStore.init({
    currentScreen, currentPackId, selectedInstanceIds,
    caseLibrary: cases, packLibrary: packs, folderLibrary: [], preferences: {},
  });
}

function watchStateWrites(StateStore) {
  const writes = [];
  const off = StateStore.subscribe(changes => writes.push(Object.keys(changes).sort()));
  return { writes, off };
}

function deletionPack(id, cases, extra = {}) {
  return { id, title: id, truck: RECT_TRUCK, cases, lastEdited: 123, stats: {}, ...extra };
}

function assertNoOrphanCaseIds(StateStore, ...deletedIds) {
  const remaining = new Set(StateStore.get('caseLibrary').map(c => c.id));
  for (const pack of StateStore.get('packLibrary')) {
    for (const inst of pack.cases) {
      for (const id of deletedIds) assert.notEqual(inst.caseId, id, `no instance in ${pack.id} may still reference deleted Case ${id}`);
    }
  }
  for (const id of deletedIds) assert.equal(remaining.has(id), false, `Case ${id} must be gone from the Case Library`);
}

function assertPersistedPackIsValid(PackLibrary, pack, caseLibrary, message) {
  const assessment = PackLibrary.assessCommittedPack(pack, caseLibrary);
  assert.equal(assessment.primary, 'VALID', message);
  assert.equal(assessment.eligibility.state, 'eligible', message);
}

test('CASE-DELETION A: an unused Case is deleted with no Pack change and exactly one atomic write', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a' });
  const caseUnused = mkCase({ id: 'case-unused' });
  const pack = deletionPack('pack-1', [mkInst('a1', 'case-a', { x: 60, y: 5, z: 0 })]);
  seedDeletion(StateStore, { cases: [caseA, caseUnused], packs: [pack] });
  const packsBefore = StateStore.get('packLibrary');
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['case-unused']);
  watch.off();

  assert.deepEqual(result, { deletedCaseIds: ['case-unused'], removedInstanceCount: 0, packImpacts: [] });
  assert.deepEqual(StateStore.get('caseLibrary').map(c => c.id), ['case-a']);
  assert.equal(StateStore.get('packLibrary'), packsBefore, 'the Pack Library must be the very same array — no Pack touched');
  assert.equal(watch.writes.length, 1, 'exactly one StateStore write');
  assert.deepEqual(watch.writes[0], ['caseLibrary']);
});

test('CASE-DELETION A2: an id that is not in the Case Library is a complete no-op (no write, no history)', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a' });
  seedDeletion(StateStore, { cases: [caseA], packs: [deletionPack('pack-1', [mkInst('a1', 'case-a', { x: 60, y: 5, z: 0 })])] });
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['does-not-exist']);
  watch.off();

  assert.deepEqual(result, { deletedCaseIds: [], removedInstanceCount: 0, packImpacts: [] });
  assert.equal(watch.writes.length, 0);
  assert.equal(StateStore.undo(), false, 'no history entry may be created');
});

test('CASE-DELETION B: a staged-only Case is removed without revalidating unrelated packed cargo and the signature is preserved exactly', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const library = [caseS, caseO];
  const other = mkInst('other', 'case-o', { x: 60, y: 5, z: 0 });
  const signature = PackLibrary.buildHandlingRulesValiditySignature({ cases: [other], truck: RECT_TRUCK }, library);
  const pack = deletionPack('pack-b', [
    other,
    mkInst('staged-1', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
    { ...mkInst('staged-hidden', 'case-s', { x: 200, y: 5, z: 20 }, 'staged'), hidden: true },
  ], { handlingRulesValidatedSignature: signature });
  seedDeletion(StateStore, { cases: library, packs: [pack] });
  const before = StateStore.get('packLibrary')[0];

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.deepEqual(after.cases.map(i => i.id), ['other']);
  assert.equal(after.cases[0], before.cases[0], 'unrelated packed cargo must be the identical object (never revalidated/moved)');
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false, 'a staged-only deletion must not create a false stale state');
  assert.equal(after.stats.totalCases, 1, 'stats are recomputed against the final Pack');
  assert.ok(after.lastEdited > 123, 'lastEdited is refreshed for a Pack whose cargo changed');
  assert.deepEqual(result.packImpacts, [{ packId: 'pack-b', removedInstanceCount: 2, revalidated: false, validationComplete: null, repositionedCount: 0, stagedCount: 0 }]);
  assertNoOrphanCaseIds(StateStore, 'case-s');
});

test('CASE-DELETION B2: a legacy unsigned Pack affected only by staged instances stays unsigned and is not made stale', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const pack = deletionPack('pack-legacy', [
    mkInst('other', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('staged-1', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [pack] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal('handlingRulesValidatedSignature' in after, false, 'no signature may be invented for a staged-only deletion');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
});

test('CASE-DELETION C: a packed floor item with no dependents is removed and remaining cargo stays valid without certification', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseF = mkCase({ id: 'case-f' });
  const caseO = mkCase({ id: 'case-o' });
  const library = [caseF, caseO];
  const floorItem = mkInst('floor', 'case-f', { x: 20, y: 5, z: 0 });
  const other = mkInst('other', 'case-o', { x: 60, y: 5, z: 0 });
  const priorSignature = PackLibrary.buildHandlingRulesValiditySignature({ cases: [floorItem, other], truck: RECT_TRUCK }, library);
  seedDeletion(StateStore, { cases: library, packs: [deletionPack('pack-c', [floorItem, other], { handlingRulesValidatedSignature: priorSignature })] });

  const result = PackLibrary.commitCaseDeletion(['case-f']);

  const after = StateStore.get('packLibrary')[0];
  const nextLibrary = StateStore.get('caseLibrary');
  assert.deepEqual(after.cases.map(i => i.id), ['other']);
  assert.equal(after.cases[0].placement, 'packed');
  assert.deepEqual(after.cases[0].transform.position, { x: 60, y: 5, z: 0 }, 'a valid remaining item does not move');
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, nextLibrary), false);
  assert.equal(after.stats.totalCases, 1);
  assert.ok(after.lastEdited > 123);
  assert.deepEqual(result.packImpacts, [{ packId: 'pack-c', removedInstanceCount: 1, revalidated: true, validationComplete: true, repositionedCount: 0, stagedCount: 0 }]);
});

test('CASE-DELETION D1: deleting a support Case re-settles the dependent above it — never left floating', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const pack = deletionPack('pack-d1', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const top = after.cases.find(i => i.id === 'top');
  assert.equal(after.cases.some(i => i.id === 'base'), false);
  assert.equal(top.placement, 'packed', 'a dependent that can legally settle stays packed');
  assert.equal(top.transform.position.y, 5, 'it drops onto the floor instead of floating at the old stack height (y=15)');
  assertPersistedPackIsValid(PackLibrary, after, StateStore.get('caseLibrary'), 'D1');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
  assert.equal(result.packImpacts[0].repositionedCount, 1);
  assert.equal(result.packImpacts[0].stagedCount, 0);
});

test('CASE-DELETION D2: a dependent that can no longer be legally supported anywhere moves to staging instead of staying packed', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  // 30-long dependent on two 10-long supports (67% >= MIN_SUPPORT_FRACTION 0.5).
  // Deleting one leaves 33%, and the 30-long floor cannot host it beside the survivor.
  const truck = { length: 30, width: 10, height: 30, shapeMode: 'rect' };
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const caseW = mkCase({ id: 'case-w', dimensions: { length: 30, width: 10, height: 10 }, volume: 3000 });
  const pack = { ...deletionPack('pack-d2', [
    mkInst('A', 'case-s', { x: 5, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 15, y: 5, z: 0 }),
    mkInst('D', 'case-w', { x: 15, y: 15, z: 0 }),
  ]), truck };
  seedDeletion(StateStore, { cases: [caseS, caseO, caseW], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const byId = new Map(after.cases.map(i => [i.id, i]));
  assert.equal(byId.has('A'), false);
  assert.equal(byId.get('D').placement, 'staged', 'the unsupportable dependent is staged, never left packed/floating');
  assert.equal(byId.get('B').placement, 'packed', 'unrelated packed cargo stays packed');
  assert.deepEqual(byId.get('B').transform.position, { x: 15, y: 5, z: 0 });
  assertPersistedPackIsValid(PackLibrary, after, StateStore.get('caseLibrary'), 'D2');
  assert.equal(result.packImpacts[0].stagedCount, 1);
  assert.equal(result.packImpacts[0].validationComplete, true);
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false,
    'a completed validation that staged the dependent is a certified, current result');
});

test('CASE-DELETION E1: a legacy unsigned Pack stays uncertified after a packed instance is deleted', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const pack = deletionPack('pack-e1', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  assert.equal('handlingRulesValidatedSignature' in pack, false, 'fixture is legacy/unsigned');
  seedDeletion(StateStore, { cases: [caseS, caseT], packs: [pack] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
});

test('CASE-DELETION E2: a legacy UNSIGNED Pack whose validation is incomplete cannot look current', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  // 'ghost' is a packed instance whose Case definition is already missing: the
  // whole-Pack validation can never complete.
  const pack = deletionPack('pack-e2', [
    mkInst('A', 'case-s', { x: 20, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('ghost', 'case-missing', { x: 90, y: 5, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal(result.packImpacts[0].validationComplete, false);
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), true,
    'the Pack must report review required');
  assert.deepEqual(after.cases.map(i => i.id), ['B', 'ghost'], 'the safest result is still committed: deleted instance gone, the rest preserved');
  assertNoOrphanCaseIds(StateStore, 'case-s');
});

test('CASE-DELETION F: an already-signed Pack drops its retired certificate after a Case deletion', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const library = [caseS, caseT];
  const base = mkInst('base', 'case-s', { x: 60, y: 5, z: 0 });
  const top = mkInst('top', 'case-t', { x: 60, y: 15, z: 0 });
  const priorSignature = PackLibrary.buildHandlingRulesValiditySignature({ cases: [base, top], truck: RECT_TRUCK }, library);
  seedDeletion(StateStore, { cases: library, packs: [deletionPack('pack-f', [base, top], { handlingRulesValidatedSignature: priorSignature })] });
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(StateStore.get('packLibrary')[0], library), false, 'fixture starts current');

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const nextLibrary = StateStore.get('caseLibrary');
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, nextLibrary), false);
});

test('CASE-DELETION G: one Case in several Load Plans — every affected Pack is processed, the unaffected Pack is the identical object, no orphan ids remain', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const packedPack = deletionPack('pack-packed', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  const stagedPack = deletionPack('pack-staged', [
    mkInst('o', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('s-staged', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
  ]);
  const untouchedPack = deletionPack('pack-untouched', [mkInst('u', 'case-o', { x: 30, y: 5, z: 0 })]);
  seedDeletion(StateStore, { cases: [caseS, caseT, caseO], packs: [packedPack, stagedPack, untouchedPack] });
  const before = StateStore.get('packLibrary');
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['case-s']);
  watch.off();

  const after = StateStore.get('packLibrary');
  assert.equal(after[2], before[2], 'a Pack without the Case is returned as the identical object');
  assert.equal(after[2].lastEdited, 123, 'no timestamp churn for an unaffected Pack');
  assert.ok(after[0].lastEdited > 123 && after[1].lastEdited > 123, 'both affected Packs are updated');
  assert.equal(after[0].cases.find(i => i.id === 'top').transform.position.y, 5);
  assert.deepEqual(after[1].cases.map(i => i.id), ['o']);
  assert.deepEqual(result.packImpacts.map(i => i.packId), ['pack-packed', 'pack-staged']);
  assert.equal(result.removedInstanceCount, 2);
  assertNoOrphanCaseIds(StateStore, 'case-s');
  assert.equal(watch.writes.length, 1, 'all Packs + the Case Library publish in a single write');
});

test('CASE-DELETION G2: bulk deletion of several Cases is one write and revalidates against the FINAL Case Library', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const caseT = mkCase({ id: 'case-t' });
  const pack = deletionPack('pack-bulk', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
    mkInst('o1', 'case-o', { x: 20, y: 5, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseO, caseT], packs: [pack] });
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['case-s', 'case-o']);
  watch.off();

  const after = StateStore.get('packLibrary')[0];
  assert.deepEqual(result.deletedCaseIds, ['case-s', 'case-o']);
  assert.deepEqual(StateStore.get('caseLibrary').map(c => c.id), ['case-t']);
  assert.deepEqual(after.cases.map(i => i.id), ['top']);
  assert.equal(after.cases[0].transform.position.y, 5);
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(result.packImpacts.length, 1, 'a Pack hit by several deleted Cases is revalidated once, not once per Case');
  assertNoOrphanCaseIds(StateStore, 'case-s', 'case-o');
  assert.equal(watch.writes.length, 1);
});

test('CASE-DELETION H: packed + staged + hidden + grouped target instances all go; only the physical packed impact drives repair; other groups are left alone', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const pack = deletionPack('pack-h', [
    mkInst('s-packed', 'case-s', { x: 60, y: 5, z: 0 }),
    { ...mkInst('s-hidden-packed', 'case-s', { x: 20, y: 5, z: 0 }), hidden: true },
    mkInst('s-staged', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
    { ...mkInst('s-staged-hidden', 'case-s', { x: 200, y: 5, z: 20 }, 'staged'), hidden: true },
    { ...mkInst('s-staged-grouped', 'case-s', { x: 200, y: 5, z: -20 }, 'staged'), groupId: 'g1' },
    mkInst('dependent', 'case-t', { x: 60, y: 15, z: 0 }),
    { ...mkInst('keeper', 'case-o', { x: 200, y: 5, z: 40 }, 'staged'), groupId: 'g1' },
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT, caseO], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const byId = new Map(after.cases.map(i => [i.id, i]));
  assert.deepEqual([...byId.keys()].sort(), ['dependent', 'keeper']);
  assert.equal(byId.get('dependent').placement, 'packed');
  assert.equal(byId.get('dependent').transform.position.y, 5, 'the dependent above the packed target settles');
  assert.equal(byId.get('keeper').groupId, 'g1', 'groupId is instance-local: a surviving group member is untouched (no group registry to clean)');
  assert.equal(result.packImpacts[0].removedInstanceCount, 5);
  assert.equal(result.packImpacts[0].revalidated, true, 'a physical (packed/hidden-packed) target instance triggers whole-Pack revalidation');
  assertNoOrphanCaseIds(StateStore, 'case-s');
  assertPersistedPackIsValid(PackLibrary, after, StateStore.get('caseLibrary'), 'H');
});

test('CASE-DELETION I: one deletion is one history action — Undo restores Case + Pack effects together, Redo re-applies them', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const packedPack = deletionPack('pack-i1', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ], { handlingRulesValidatedSignature: 'v1:case-s:any:1:0:0|case-t:any:1:0:0' });
  const stagedPack = deletionPack('pack-i2', [
    mkInst('o', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('s-staged', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT, caseO], packs: [packedPack, stagedPack] });
  const beforeCases = StateStore.get('caseLibrary');
  const beforePacks = StateStore.get('packLibrary');

  PackLibrary.commitCaseDeletion(['case-s']);
  const afterCases = StateStore.get('caseLibrary');
  const afterPacks = StateStore.get('packLibrary');
  assert.notDeepEqual(afterCases, beforeCases);
  assert.notDeepEqual(afterPacks, beforePacks);

  assert.equal(StateStore.undo(), true, 'a single Undo reverts the whole deletion');
  assert.deepEqual(StateStore.get('caseLibrary'), beforeCases, 'Undo restores the deleted Case');
  assert.deepEqual(StateStore.get('packLibrary'), beforePacks, 'Undo restores removed instances, repaired/staged cargo, signatures, stats and timestamps together');
  assert.equal(StateStore.undo(), false, 'there is no second history entry to undo');

  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.get('caseLibrary'), afterCases, 'Redo re-applies the Case deletion');
  assert.deepEqual(StateStore.get('packLibrary'), afterPacks, 'Redo re-applies the identical final Pack state');
  assert.equal(StateStore.redo(), false);
});

test('CASE-DELETION J1: incomplete validation with a previously-current signature keeps a signature that cannot equal the current one', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const library = [caseS, caseO];
  const cases = [
    mkInst('A', 'case-s', { x: 20, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('ghost', 'case-missing', { x: 90, y: 5, z: 0 }),
  ];
  const priorSignature = PackLibrary.buildHandlingRulesValiditySignature({ cases }, library);
  seedDeletion(StateStore, { cases: library, packs: [deletionPack('pack-j1', cases, { handlingRulesValidatedSignature: priorSignature })] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const nextLibrary = StateStore.get('caseLibrary');
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, nextLibrary), true, 'never stamped current after an unresolved validation');
});

test('CASE-DELETION J2: incomplete validation whose stored signature coincidentally equals the new one is downgraded to the non-current marker', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const nextLibrary = [caseO];
  const cases = [
    mkInst('A', 'case-s', { x: 20, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('ghost', 'case-missing', { x: 90, y: 5, z: 0 }),
  ];
  const coincidental = PackLibrary.buildHandlingRulesValiditySignature({ cases: cases.filter(i => i.id !== 'A'), truck: RECT_TRUCK }, nextLibrary);
  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [deletionPack('pack-j2', cases, { handlingRulesValidatedSignature: coincidental })] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'C4 never writes a validation certificate');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), true);
});

test('CASE-DELETION L: preparation failure publishes nothing — no partial Case deletion, no Pack mutated beforehand, no history entry', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const good = deletionPack('pack-good', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT], packs: [good] });
  // Second Pack throws when its instance is inspected — AFTER the first Pack has
  // already been fully prepared (Packs are prepared in order).
  const poisoned = mkInst('poison', 'case-t', { x: 60, y: 5, z: 0 });
  Object.defineProperty(poisoned, 'caseId', { enumerable: true, get() { throw new Error('boom'); } });
  StateStore.set({ packLibrary: [...StateStore.get('packLibrary'), deletionPack('pack-poison', [poisoned])] }, { skipHistory: true, skipNotify: true });
  const casesBefore = StateStore.get('caseLibrary');
  const packsBefore = StateStore.get('packLibrary');
  const watch = watchStateWrites(StateStore);

  assert.throws(() => PackLibrary.commitCaseDeletion(['case-s']), /boom/);
  watch.off();

  assert.equal(StateStore.get('caseLibrary'), casesBefore, 'the Case Library is untouched');
  assert.equal(StateStore.get('packLibrary'), packsBefore, 'the Pack Library is untouched');
  assert.equal(packsBefore[0].cases.length, 2, 'the already-prepared first Pack was never published');
  assert.equal(watch.writes.length, 0, 'nothing was published');
  assert.equal(StateStore.undo(), false, 'no history entry was created');
});

test('CASE-DELETION K1: deleted instances are pruned from the open Pack selection inside the same write; surviving ids (even repaired/staged ones) stay selected', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const pack = deletionPack('pack-k', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
    mkInst('keep', 'case-o', { x: 20, y: 5, z: 0 }),
  ]);
  seedDeletion(StateStore, {
    cases: [caseS, caseT, caseO], packs: [pack],
    currentPackId: 'pack-k', selectedInstanceIds: ['base', 'top', 'keep'],
  });
  const watch = watchStateWrites(StateStore);

  PackLibrary.commitCaseDeletion(['case-s']);
  watch.off();

  assert.deepEqual(StateStore.get('selectedInstanceIds'), ['top', 'keep'], 'only the removed id is pruned; unrelated selection is preserved in order');
  assert.equal(watch.writes.length, 1, 'selection pruning rides the same single write');
  assert.deepEqual(watch.writes[0], ['caseLibrary', 'packLibrary', 'selectedInstanceIds']);
  assert.equal(StateStore.undo(), true);
  assert.equal(StateStore.undo(), false, 'selection is transient and adds no history entry');
});

test('CASE-DELETION K2: selection is left exactly as-is when it does not reference removed instances, or when no Pack is open', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const openPack = deletionPack('pack-open', [mkInst('o1', 'case-o', { x: 20, y: 5, z: 0 })]);
  const otherPack = deletionPack('pack-other', [mkInst('s1', 'case-s', { x: 60, y: 5, z: 0 })]);

  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [openPack, otherPack], currentPackId: 'pack-open', selectedInstanceIds: ['o1'] });
  const selectionBefore = StateStore.get('selectedInstanceIds');
  PackLibrary.commitCaseDeletion(['case-s']);
  assert.equal(StateStore.get('selectedInstanceIds'), selectionBefore, 'open Pack unaffected: selection is the identical array');

  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [openPack, otherPack], currentPackId: null, selectedInstanceIds: ['s1'] });
  PackLibrary.commitCaseDeletion(['case-s']);
  assert.deepEqual(StateStore.get('selectedInstanceIds'), ['s1'], 'with no open Pack there is nothing to prune against');
});

test('CASE-DELETION M: deleting the last Case resets categories to Default inside the SAME write — one Undo restores both', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const categories = [
    { key: 'audio', name: 'Audio', color: '#f59e0b' },
    { key: 'default', name: 'Default', color: '#9ca3af' },
  ];
  const pack = deletionPack('pack-1', []);
  StateStore.init({
    currentScreen: 'cases', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [mkCase({ id: 'case-a', category: 'audio' })], packLibrary: [pack], folderLibrary: [],
    preferences: { units: { length: 'in', weight: 'lb' }, categories },
  });
  const packsBefore = StateStore.get('packLibrary');
  const watch = watchStateWrites(StateStore);

  PackLibrary.commitCaseDeletion(['case-a']);
  watch.off();

  assert.equal(watch.writes.length, 1, 'exactly one StateStore write');
  assert.deepEqual(watch.writes[0], ['caseLibrary', 'preferences']);
  assert.deepEqual(StateStore.get('caseLibrary'), []);
  assert.deepEqual(StateStore.get('preferences').categories, [{ key: 'default', name: 'Default', color: '#9ca3af' }]);
  assert.deepEqual(StateStore.get('preferences').units, { length: 'in', weight: 'lb' }, 'other preferences are preserved');
  assert.equal(StateStore.get('packLibrary'), packsBefore, 'no Pack touched');

  assert.equal(StateStore.undo(), true);
  assert.deepEqual(StateStore.get('caseLibrary').map(c => c.id), ['case-a']);
  assert.deepEqual(StateStore.get('preferences').categories, categories, 'one Undo restores Cases and categories together');
  assert.equal(StateStore.undo(), false, 'the deletion was a single history step');
});

test('CASE-DELETION M2: the empty-library reset is skipped when categories are already Default-only, and never runs while Cases remain', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const defaultOnly = [{ key: 'default', name: 'Default', color: '#9ca3af' }];
  StateStore.init({
    currentScreen: 'cases', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [mkCase({ id: 'case-a' })], packLibrary: [], folderLibrary: [],
    preferences: { categories: defaultOnly },
  });
  let watch = watchStateWrites(StateStore);
  PackLibrary.commitCaseDeletion(['case-a']);
  watch.off();
  assert.deepEqual(watch.writes, [['caseLibrary']], 'already Default-only: no redundant preferences write');

  StateStore.init({
    currentScreen: 'cases', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [mkCase({ id: 'case-a' }), mkCase({ id: 'case-b', category: 'audio' })], packLibrary: [], folderLibrary: [],
    preferences: { categories: [{ key: 'audio', name: 'Audio', color: '#f59e0b' }, ...defaultOnly] },
  });
  watch = watchStateWrites(StateStore);
  PackLibrary.commitCaseDeletion(['case-a']);
  watch.off();
  assert.deepEqual(watch.writes, [['caseLibrary']], 'Cases remain: categories are left alone');
});

test('CASE-DELETION UI: both Cases-screen delete paths delegate to the single orchestration, keep the toast, and warn about dependent cargo', () => {
  const single = casesSource.slice(casesSource.indexOf('async function deleteCase(caseId) {'), casesSource.indexOf('// Import Cases dialog extracted'));
  const bulk = casesSource.slice(casesSource.indexOf('async function bulkDeleteSelected() {'), casesSource.indexOf('function initTableHeaders() {'));
  assert.ok(single.length > 200 && bulk.length > 200);
  assert.match(single, /try\s*\{\s*result = PackLibrary\.commitCaseDeletion\(\[caseId\]\)/, 'single delete calls commitCaseDeletion inside try/catch');
  assert.match(bulk, /try\s*\{\s*result = PackLibrary\.commitCaseDeletion\(ids\)/, 'bulk delete calls commitCaseDeletion inside try/catch');
  for (const body of [single, bulk]) {
    assert.doesNotMatch(body, /StateStore\.set|computeStats|nextPackLibrary/, 'no ad-hoc per-screen Pack rebuilding remains');
  }
  assert.match(single, /Deleting it will remove those items\. Cargo that depended on them for support may be repositioned or moved to staging\./);
  assert.match(single, /UIComponents\.showToast\('Case deleted', 'info'\)/);
});

function makeToastSpy() {
  const calls = [];
  return { calls, showToast: (message, type) => calls.push({ message, type }) };
}

function buildDeleteCase({ caseData = { id: 'case-1', name: 'Case A' }, packs = [], confirmResult = true, mutationBlocked = false, commitCaseDeletion }) {
  const toast = makeToastSpy();
  const errors = [];
  const src = casesSource.slice(casesSource.indexOf('async function deleteCase(caseId) {'), casesSource.indexOf('// Import Cases dialog extracted')).trim();
  const context = {
    CaseLibrary: { getById: () => caseData },
    PackLibrary: { getPacks: () => packs, commitCaseDeletion },
    UIComponents: { confirm: async () => confirmResult, showToast: toast.showToast },
    mutationBlockedWhileBusy: () => mutationBlocked,
    console: { error: (...args) => errors.push(args) },
  };
  const deleteCase = runInNewContext(`(${src})`, context);
  return { deleteCase, toast, errors };
}

function buildBulkDelete({ selected = ['a', 'b'], confirmResult = true, mutationBlocked = false, commitCaseDeletion }) {
  const toast = makeToastSpy();
  const errors = [];
  const calls = { clearSelection: 0, render: 0 };
  const src = casesSource.slice(casesSource.indexOf('async function bulkDeleteSelected() {'), casesSource.indexOf('function initTableHeaders() {')).trim();
  const context = {
    selectedIds: new Set(selected),
    PackLibrary: { commitCaseDeletion },
    UIComponents: { confirm: async () => confirmResult, showToast: toast.showToast },
    mutationBlockedWhileBusy: () => mutationBlocked,
    clearSelection: () => { calls.clearSelection += 1; },
    render: () => { calls.render += 1; },
    console: { error: (...args) => errors.push(args) },
  };
  const bulkDeleteSelected = runInNewContext(`(${src})`, context);
  return { bulkDeleteSelected, toast, errors, calls };
}

test('CASE-DELETION UI-ERR single: a thrown preparation failure produces error feedback, never success, and is logged not swallowed', async () => {
  const { deleteCase, toast, errors } = buildDeleteCase({ commitCaseDeletion: () => { throw new Error('boom'); } });
  await deleteCase('case-1');
  assert.equal(toast.calls.length, 1, 'exactly one toast is shown');
  assert.equal(toast.calls[0].type, 'error');
  assert.match(toast.calls[0].message, /Couldn't delete this case\. Nothing was changed\./);
  assert.doesNotMatch(toast.calls[0].message, /boom/, 'internal error detail is not exposed to the user');
  assert.equal(errors.length, 1, 'the failure is logged for diagnostics');
});

test('CASE-DELETION UI-NOOP single: zero deletedCaseIds does not produce "Case deleted"', async () => {
  const { deleteCase, toast } = buildDeleteCase({ commitCaseDeletion: () => ({ deletedCaseIds: [] }) });
  await deleteCase('case-1');
  assert.deepEqual(toast.calls, [{ message: 'Case was already removed.', type: 'warning' }]);
});

test('CASE-DELETION UI-OK single: an actual successful result still shows "Case deleted"', async () => {
  const { deleteCase, toast } = buildDeleteCase({ commitCaseDeletion: () => ({ deletedCaseIds: ['case-1'] }) });
  await deleteCase('case-1');
  assert.deepEqual(toast.calls, [{ message: 'Case deleted', type: 'info' }]);
});

test('CASE-DELETION UI-ERR bulk: a thrown preparation failure produces error feedback and does not clear selection as a fake success', async () => {
  const { bulkDeleteSelected, toast, errors, calls } = buildBulkDelete({
    selected: ['a', 'b'],
    commitCaseDeletion: () => { throw new Error('boom'); },
  });
  await bulkDeleteSelected();
  assert.equal(toast.calls.length, 1);
  assert.equal(toast.calls[0].type, 'error');
  assert.match(toast.calls[0].message, /Couldn't delete the selected cases\. Nothing was changed\./);
  assert.doesNotMatch(toast.calls[0].message, /boom/, 'internal error detail is not exposed to the user');
  assert.equal(calls.clearSelection, 0, 'selection is not cleared as a fake success');
  assert.equal(calls.render, 0);
  assert.equal(errors.length, 1);
});

test('CASE-DELETION UI-NOOP bulk: zero deletedCaseIds is not reported as success and selection/UI state is preserved for retry', async () => {
  const { bulkDeleteSelected, toast, calls } = buildBulkDelete({
    selected: ['a', 'b'],
    commitCaseDeletion: () => ({ deletedCaseIds: [] }),
  });
  await bulkDeleteSelected();
  assert.equal(toast.calls.length, 1);
  assert.equal(toast.calls[0].type, 'warning');
  assert.doesNotMatch(toast.calls[0].message, /Deleted 0/);
  assert.equal(calls.clearSelection, 0, 'selection is preserved so the user can understand/retry');
  assert.equal(calls.render, 0);
});

test('CASE-DELETION UI-COUNT bulk: success feedback and cleanup use the actual deletedCaseIds count, not the originally selected count', async () => {
  const { bulkDeleteSelected, toast, calls } = buildBulkDelete({
    selected: ['a', 'b', 'c'],
    commitCaseDeletion: () => ({ deletedCaseIds: ['a', 'b'] }),
  });
  await bulkDeleteSelected();
  assert.deepEqual(toast.calls, [{ message: 'Deleted 2 case(s).', type: 'info' }]);
  assert.equal(calls.clearSelection, 1, 'a real successful deletion still clears the selection');
  assert.equal(calls.render, 1);
});

// C4's committed-load contract replaces durable freshness and implicit repair.
function freezeSource(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeSource);
    Object.freeze(value);
  }
  return value;
}

function sourcePose(instance) {
  const { id, ...source } = instance;
  return source;
}

test('C4 assessment population, precedence, eligibility and immutable inputs', async () => {
  const { PackLibrary } = await freshModules();
  const library = [mkCase(), mkCase({ id: 'heavy', weight: 20 })];
  const pack = activePackFixture();
  assert.equal(PackLibrary.assessCommittedPack(pack, library).primary, 'VALID');
  const unknownMass = library.map(c => ({ ...c, weight: null }));
  const incomplete = PackLibrary.assessCommittedPack(pack, unknownMass);
  assert.equal(incomplete.primary, 'INCOMPLETE');
  assert.ok(incomplete.unresolvedHard.length);
  const bad = { ...pack, cases: [{ ...pack.cases[0], hidden: true,
    transform: { ...pack.cases[0].transform, position: { x: -10, y: 5, z: 0 } } }] };
  assert.equal(PackLibrary.assessCommittedPack(bad, unknownMass).primary, 'INVALID', 'hard failure wins over unresolved mass');
  const staged = { ...bad, cases: bad.cases.map(i => ({ ...i, placement: 'staged', caseId: 'missing' })) };
  assert.equal(PackLibrary.assessCommittedPack(staged, []).primary, 'VALID', 'staged cargo is outside loaded assessment');
  const blocked = { ...pack, cases: [pack.cases[0], { ...pack.cases[1], caseId: 'heavy' }] };
  const snapshot = structuredClone({ blocked, library });
  const result = PackLibrary.assessCommittedPack(freezeSource(blocked), freezeSource(library));
  assert.equal(result.primary, 'VALID');
  assert.equal(result.eligibility.state, 'blocked', 'weight compatibility does not become physical INVALID');
  assert.ok(result.gates.some(g => g.property === 'supportWeight' && g.outcome === 'FAIL'));
  assert.ok(result.unverified.length && result.advisory.length);
  assert.deepEqual({ blocked, library }, snapshot, 'assessment mutates no source input');
});

test('C4 exact bounded cache reuses only matching C2 physical input and policy', async () => {
  const { PackLibrary } = await freshModules();
  const pack = activePackFixture(), library = [mkCase()];
  const base = PackLibrary.assessCommittedPack(pack, library);
  const displayOnly = { ...pack, title: 'Renamed', lastEdited: 999, handlingRulesValidatedSignature: 'v1:incomplete',
    cases: pack.cases.map(i => ({ ...i, hidden: !i.hidden, orientationLocked: true, lockedRotation: { x: 0, y: 1, z: 0 } })) };
  assert.strictEqual(PackLibrary.assessCommittedPack(displayOnly, [{ ...library[0], name: 'Label', notes: 'Note' }]), base);
  const changedCase = PackLibrary.assessCommittedPack(pack, [{ ...library[0], weight: 11 }]);
  assert.notStrictEqual(changedCase, base);
  assert.notEqual(changedCase.identity, base.identity);
  const changedPolicy = PackLibrary.assessCommittedPack(pack, library, {
    compatibility: { support50: false, wheelWellThird: true, supportWeight: true },
  });
  assert.notStrictEqual(changedPolicy, base);
  assert.notEqual(changedPolicy.identity, base.identity);
  const moved = structuredClone(pack);
  moved.cases[0].transform.position.x += 1;
  assert.notStrictEqual(PackLibrary.assessCommittedPack(moved, library), base);
  assert.notStrictEqual(PackLibrary.assessCommittedPack({ ...pack, truck: { ...pack.truck, length: 200 } }, library), base);
  assert.strictEqual(PackLibrary.assessCommittedPack(pack, library), base, 'identical source skips the solve');
  assert.ok(Object.isFrozen(base) && Object.isFrozen(base.hard), 'callers cannot corrupt a shared result');
  assert.equal(base.fresh, true);
  for (const malformed of [
    { ...pack, cases: [{ ...pack.cases[0], transform: { ...pack.cases[0].transform, position: null } }] },
    { ...pack, cases: [pack.cases[0], pack.cases[0]] },
    { ...pack, truck: { ...pack.truck, length: NaN } },
  ]) {
    const first = PackLibrary.assessCommittedPack(malformed, library);
    assert.equal(first.identity, null);
    assert.notStrictEqual(PackLibrary.assessCommittedPack(malformed, library), first, 'malformed source always assesses fresh');
  }
  for (let n = 0; n < 33; n++) {
    PackLibrary.assessCommittedPack({ ...pack, truck: { ...pack.truck, length: 300 + n } }, library);
  }
  assert.notStrictEqual(PackLibrary.assessCommittedPack(pack, library), base, 'bounded cache evicts old entries');
});

test('C4 normalization, hydration and open preserve INVALID and INCOMPLETE physical source', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const Normalizer = await import(normalizerPath.href);
  for (const incomplete of [false, true]) {
    const caseA = mkCase({ weight: incomplete ? null : 10 });
    const pack = { ...activePackFixture(), cases: [mkInst('saved', caseA.id,
      { x: incomplete ? 40 : -10, y: 5, z: 0 })], handlingRulesValidatedSignature: 'v1:CURRENT', groups: [{ id: 'group-1' }] };
    Object.assign(pack.cases[0], { hidden: true, groupId: 'group-1', orientationLocked: true,
      lockedRotation: { x: 0, y: Math.PI / 2, z: 0 } });
    const normalized = Normalizer.normalizeAppData({ caseLibrary: [caseA], packLibrary: [pack], preferences: {} });
    const restored = normalized.packLibrary[0];
    for (const key of ['transform', 'placement', 'hidden', 'groupId', 'orientationLocked', 'lockedRotation']) {
      assert.deepEqual(restored.cases[0][key], pack.cases[0][key]);
    }
    assert.equal(restored.handlingRulesValidatedSignature, undefined);
    StateStore.init({ ...normalized, currentScreen: 'packs', currentPackId: null });
    const before = structuredClone(restored);
    PackLibrary.open(pack.id);
    assert.deepEqual(PackLibrary.getById(pack.id), before);
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, incomplete ? 'INCOMPLETE' : 'INVALID');
    assert.deepEqual(PackLibrary.getById(pack.id), before);
    assert.equal(StateStore.undo(), false);
  }
  const missingPose = Normalizer.normalizeInstance({ id: 'missing', caseId: 'case-a', placement: 'packed', transform: {} }, new Map([['case-a', mkCase()]]));
  assert.deepEqual(missingPose.transform.position, { x: null, y: null, z: null }, 'no invented location for unresolved geometry');
});

test('C4 Case dimensions, orientation and unknown mass change assessment without touching any Pack', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  for (const change of [
    { dimensions: { length: 160, width: 10, height: 10 } },
    { orientationLock: 'upright' },
    { weight: null },
  ]) {
    const caseA = mkCase();
    const pack = activePackFixture();
    pack.cases[0].transform.rotation.x = Math.PI / 2;
    Object.assign(pack.cases[0], { hidden: true, groupId: 'saved-group', orientationLocked: true,
      lockedRotation: { x: 0, y: Math.PI / 2, z: 0 } });
    pack.groups = [{ id: 'saved-group', name: 'Keep group' }];
    const other = { ...structuredClone(pack), id: 'unseen' };
    initFixture(StateStore, caseA, pack);
    StateStore.set({ packLibrary: [pack, other] }, { skipHistory: true });
    StateStore.resetHistory();
    const before = StateStore.snapshot();
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'VALID');
    PackLibrary.commitCaseHandlingRuleChange({ ...caseA, ...change }, { key: 'qa', name: 'QA', color: '#112233' });
    assert.deepEqual(StateStore.get('packLibrary'), before.packLibrary, 'all IDs, poses, targets, groups, membership and timestamps preserved');
    const expected = change.weight === null ? 'INCOMPLETE' : 'INVALID';
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, expected);
    assert.equal(StateStore.undo(), true);
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'VALID');
    assert.deepEqual(StateStore.snapshot(), before, 'one Undo restores Case and category together');
    assert.equal(StateStore.undo(), false);
    assert.equal(StateStore.redo(), true);
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, expected);
    assert.equal(StateStore.redo(), false);
  }
});

test('C4 Check recomputes from committed source without writes, history, lastEdited or certification', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  for (const legacy of ['v1:incomplete', 'v1:case-a:any:1:0:0', undefined]) {
    const pack = { ...activePackFixture(), handlingRulesValidatedSignature: legacy };
    initFixture(StateStore, mkCase(), pack);
    StateStore.set({ autoPackResults: { packId: pack.id, preview: { cases: [] } } }, { skipHistory: true });
    const before = StateStore.snapshot();
    let writes = 0;
    const unsubscribe = StateStore.subscribe(() => writes++);
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'VALID', 'legacy incomplete flag is not authority');
    assert.equal(writes, 0);
    assert.equal(StateStore.undo(), false);
    assert.deepEqual(StateStore.snapshot(), before);
    unsubscribe();
    PackLibrary.commitCaseHandlingRuleChange({ ...mkCase(), noStackOnTop: true });
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'INVALID', 'legacy matching rule signature cannot certify a hard failure');
    const invalid = StateStore.snapshot();
    assert.equal(StateStore.undo(), true);
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'VALID');
    assert.equal(StateStore.redo(), true, 'Check never truncates redo');
    assert.deepEqual(StateStore.snapshot(), invalid);
    assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'INVALID');
  }
});

test('C4 duplicate assigns new IDs, preserves physical source and discards legacy certification', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const pack = activePackFixture();
  pack.handlingRulesValidatedSignature = 'v1:incomplete';
  initFixture(StateStore, mkCase({ noStackOnTop: true }), pack);
  const copied = PackLibrary.duplicate(pack.id);
  assert.notEqual(copied.id, pack.id);
  assert.ok(copied.cases.every((i, n) => i.id !== pack.cases[n].id));
  assert.deepEqual(copied.cases.map(sourcePose), pack.cases.map(sourcePose));
  assert.equal(copied.handlingRulesValidatedSignature, undefined);
  assert.equal(PackLibrary.validateLoadPlan(copied.id).primary, 'INVALID');
});

test('C4 Pack import and workspace restore preserve physical failures; malformed imports remain atomic', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const { planWorkspaceRestore } = await import('../../src/services/import-export.js');
  const caseA = mkCase({ noStackOnTop: true });
  const incoming = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:FOREIGN' };
  StateStore.init({ caseLibrary: [], packLibrary: [], preferences: {}, folderLibrary: [] });
  const before = StateStore.snapshot();
  const plan = PackLibrary.planPackImport({ pack: incoming, bundledCases: [caseA] });
  assert.deepEqual(plan.pack.cases.map(sourcePose), incoming.cases.map(sourcePose));
  assert.equal(plan.pack.handlingRulesValidatedSignature, undefined);
  assert.equal(plan.placementsRepaired, 0);
  assert.equal(plan.placementsStaged, 0);
  assert.equal(PackLibrary.assessCommittedPack(plan.pack, plan.newCases).primary, 'INVALID');
  const restored = planWorkspaceRestore({ caseLibrary: [caseA], packLibrary: [incoming], folderLibrary: [], categories: [] });
  assert.deepEqual(restored.packLibrary[0].cases.map(i => i.transform), incoming.cases.map(i => i.transform));
  assert.equal(restored.placementsRepaired + restored.placementsStaged, 0);
  assert.equal(PackLibrary.assessCommittedPack(restored.packLibrary[0], restored.caseLibrary).primary, 'INVALID');
  for (const payload of [
    { pack: incoming, bundledCases: [] },
    { pack: incoming, bundledCases: [{ ...caseA, dimensions: { length: 0, width: 10, height: 10 } }] },
    { pack: { ...incoming, cases: [{ ...incoming.cases[0], caseId: '' }] }, bundledCases: [caseA] },
  ]) assert.throws(() => PackLibrary.importPackPayload(payload));
  assert.deepEqual(StateStore.snapshot(), before);
  assert.equal(StateStore.undo(), false);
});

test('C4 local edits and removal adjust only acted cargo and actual causal dependents in one Undo step', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const pack = activePackFixture();
  const unrelated = mkInst('unrelated-invalid', 'case-a', { x: 400, y: 33, z: 0 });
  const staged = mkInst('unrelated-staged', 'case-a', { x: 10, y: 22, z: 80 }, 'staged');
  Object.assign(unrelated, { hidden: true, groupId: 'keep', orientationLocked: true, lockedRotation: { x: 0, y: 0.7, z: 0 } });
  Object.assign(staged, { packedProfile: 'legacy-cache' });
  pack.cases.push(unrelated, staged);
  initFixture(StateStore, mkCase(), pack);
  const before = StateStore.snapshot();
  const proposed = structuredClone(pack.cases);
  proposed[0].transform.position.x = 20;
  const result = PackLibrary.updateCasesWithManualRevalidation(pack.id, proposed, [mkCase()], { repairDependents: true });
  assert.equal(result.pack.cases.find(i => i.id === 'child').transform.position.y, 5, 'cargo losing its support settles safely');
  assert.deepEqual(result.pack.cases.slice(2), pack.cases.slice(2), 'unrelated packed and staged source is byte-equivalent');
  assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'INVALID', 'unrelated pre-existing failure remains visible');
  const after = StateStore.snapshot();
  assert.equal(StateStore.undo(), true);
  assert.deepEqual(StateStore.snapshot(), before);
  assert.equal(StateStore.undo(), false);
  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.snapshot(), after);
  StateStore.undo();
  PackLibrary.removeInstances(pack.id, ['base']);
  assert.equal(PackLibrary.getById(pack.id).cases.find(i => i.id === 'child').transform.position.y, 5);
  assert.deepEqual(PackLibrary.getById(pack.id).cases.filter(i => i.id.startsWith('unrelated')), pack.cases.slice(2));
});

test('C4 an equivalent support envelope does not authorize repair of an existing dependent finding', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ noStackOnTop: true });
  const pack = activePackFixture();
  initFixture(StateStore, caseA, pack);
  const proposed = structuredClone(pack.cases);
  proposed[0].transform.rotation.y = Math.PI / 2;
  const result = PackLibrary.updateCasesWithManualRevalidation(pack.id, proposed, [caseA], { repairDependents: true });
  assert.deepEqual(result.pack.cases[1], pack.cases[1], 'the existing invalid child is unaffected by the identical support envelope');
  assert.equal(PackLibrary.validateLoadPlan(pack.id).primary, 'INVALID');
});

test('C4 preserved invalid cargo remains an obstacle but cannot supply support for a new proposal', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const pack = { ...activePackFixture(), cases: [
    mkInst('floating', 'case-a', { x: 40, y: 15, z: 0 }),
    mkInst('proposal', 'case-a', { x: 10, y: 5, z: 80 }, 'staged'),
  ] };
  initFixture(StateStore, mkCase(), pack);
  const desiredPosition = { x: 40, y: 25, z: 0 };
  const proposal = PackLibrary.findManualVerticalPlacement(pack, [mkCase()], 'proposal', { mode: 'resolve', desiredPosition, exact: true });
  assert.equal(proposal.ok, false, 'a floating body is not rigid support');
  const cases = structuredClone(pack.cases);
  cases[1].placement = 'packed'; cases[1].transform.position = desiredPosition;
  const result = PackLibrary.updateCasesWithManualRevalidation(pack.id, cases, [mkCase()]);
  assert.notDeepEqual(result.pack.cases[1].transform.position, desiredPosition);
  assert.deepEqual(result.pack.cases[0], pack.cases[0], 'proposal correction does not move the unrelated invalid body');
});
