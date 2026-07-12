// AutoPack Results floating panel (UI-only refinement). Source-contract tests
// for the panel in editor-screen.js: multiple results render a compact
// one-at-a-time carousel ("Option X of Y" + bordered, clamped Prev/Next); the
// header has a chevron collapse/expand toggle plus a separate close; collapsing
// leaves only the header (still the drag handle); applying still runs through
// the existing validated PackLibrary path; and carousel/minimize view state is
// UI-only (never written into the AutoPack result payload). No DOM/pixel testing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const enginePath = new URL('../../src/services/autopack-engine.js', import.meta.url);
const solutionPath = new URL('../../src/packing-core/solution.js', import.meta.url);
const stylesPath = new URL('../../styles/main.css', import.meta.url);

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `expected block between "${startNeedle}" and "${endNeedle}"`);
  return src.slice(start, end);
}

async function renderBlock() {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  return { src, render: sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()') };
}

test('AUTOPACK-CAROUSEL multi-result panel shows a compact Option X of Y carousel', async () => {
  const { render } = await renderBlock();

  assert.match(render, /const hasAlternates = options\.length > 1;/,
    'multiple-option detection must stay based on options.length');
  assert.equal(render.includes('View options'), false, 'no compact "View options" step should remain');
  assert.equal(render.includes('results.expanded'), false, 'the panel must not depend on an expanded toggle');

  const nav = sliceFn(render, 'if (hasAlternates) {', 'const stats = document.createElement');
  assert.match(nav, /tp3d-autopack-results__carousel-nav/, 'the carousel nav must render for multiple options');
  assert.match(nav, /`Option \$\{viewIndex \+ 1\} of \$\{options\.length\}`/,
    'the counter must show the 1-based option index out of the total');
});

test('AUTOPACK-CAROUSEL header has a chevron collapse/expand toggle separate from close', async () => {
  const { render } = await renderBlock();

  // Single chevron toggle: up = collapse, down = restore. Not a minus line.
  assert.match(render, /toggleBtn\.setAttribute\('aria-label', minimized \? 'Restore AutoPack results' : 'Minimize AutoPack results'\);/,
    'the toggle must carry the correct accessible label for each state');
  assert.match(render, /fa-chevron-\$\{minimized \? 'down' : 'up'\}/,
    'the toggle must use a chevron (down to expand, up to collapse), not a minus line');
  assert.equal(render.includes('fa-minus'), false, 'the collapse control must not be a minus/line icon');
  assert.match(render, /patchAutoPackResultsState\(\{ minimized: !minimized \}\)/,
    'the toggle must flip the UI-only minimized state');

  // Close stays a separate dismiss.
  assert.match(render, /closeBtn\.setAttribute\('aria-label', 'Close AutoPack results'\);/,
    'a close control with an accessible label must exist');
  assert.match(render, /closeBtn\.addEventListener\('click', \(\) => patchAutoPackResultsState\(\{ closed: true \}\)\);/,
    'close must remain separate from collapse');

  // 2×3 dot-grid drag grip on the header drag handle.
  assert.match(render, /grip\.className = 'tp3d-autopack-results__grip';/, 'the header must keep a drag grip');
  assert.match(render, /tp3d-autopack-results__grip-dot/, 'the grip must be a dot grid');
  assert.match(render, /for \(let dot = 0; dot < 6; dot \+= 1\)/, 'the grip must render six dots (2×3)');
  assert.match(render, /header\.dataset\.role = 'autopack-results-drag';/, 'the header must remain the drag handle');
});

test('AUTOPACK-CAROUSEL collapse leaves only the header (no chip, no second drag system)', async () => {
  const { render, src } = await renderBlock();

  assert.match(render, /const minimized = results\.minimized === true;/,
    'minimized must be read from UI-only panel state');
  assert.match(render, /minimized \? 'is-minimized'/, 'the collapsed panel must be marked with is-minimized');

  // The minimized branch renders only the header and returns before the body.
  const minIdx = render.indexOf('if (minimized) {');
  const bodyIdx = render.indexOf("body.className = 'tp3d-autopack-results__body'");
  assert.ok(minIdx >= 0 && bodyIdx > minIdx, 'the minimized early-return must precede the body build');
  const minBranch = sliceFn(render, 'if (minimized) {', 'const body = document.createElement');
  assert.match(minBranch, /placeAutoPackResultsEl\(panel\);/, 'collapsed state must place the header-only panel');
  assert.match(minBranch, /return;/, 'collapsed state must render nothing below the header');

  // No pill/chip remnants anywhere.
  assert.equal(render.includes('--chip'), false, 'the pill/chip markup must be gone');
  assert.equal(render.includes('chip-label'), false, 'the chip label must be gone');
  assert.equal(render.includes('AutoPack · '), false, 'the chip label text must be gone');

  // Shared placement reuses the one existing drag/position system.
  const place = sliceFn(src, 'const placeAutoPackResultsEl = el =>', 'const makeAutoPackGrip = () =>');
  assert.match(place, /clampAutoPackResultsPosition\(host, el, results\.position\)/,
    'shared placement must reuse the existing position clamp');
  assert.match(place, /attachAutoPackResultsDrag\(el, host\)/,
    'shared placement must reuse the existing drag attachment');

  // Styling: is-minimized divider control + no chip CSS.
  const css = await fs.readFile(stylesPath, 'utf8');
  assert.match(css, /\.tp3d-autopack-results:not\(\.is-minimized\) \.tp3d-autopack-results__header/,
    'the header divider must only apply when expanded');
  assert.equal(css.includes('--chip'), false, 'chip CSS must be removed');
});

test('AUTOPACK-CAROUSEL Prev/Next stay view-only and never apply or mutate', async () => {
  const { render } = await renderBlock();
  const nav = sliceFn(render, 'if (hasAlternates) {', 'const stats = document.createElement');

  assert.match(nav, /aria-label', 'Previous AutoPack option'/, 'a Previous control must be rendered');
  assert.match(nav, /aria-label', 'Next AutoPack option'/, 'a Next control must be rendered');
  assert.match(nav, /prevBtn\.disabled = viewIndex <= 0;/, 'Previous must clamp/disable at the first option');
  assert.match(nav, /nextBtn\.disabled = viewIndex >= options\.length - 1;/, 'Next must clamp/disable at the last option');
  assert.match(nav, /patchAutoPackResultsState\(\{ viewIndex: Math\.max\(0, viewIndex - 1\) \}\)/,
    'Previous must only move the view index');
  assert.match(nav, /patchAutoPackResultsState\(\{ viewIndex: Math\.min\(options\.length - 1, viewIndex \+ 1\) \}\)/,
    'Next must only move the view index');
  assert.equal(nav.includes('applyAutoPackResultOption'), false, 'Prev/Next must not apply a solution');
  assert.equal(nav.includes('PackLibrary'), false, 'Prev/Next must not mutate the pack');
});

test('AUTOPACK-CAROUSEL apply keeps the validated path, marks Applied with a check, drops the rerun note', async () => {
  const { render, src } = await renderBlock();

  assert.match(render, /apply\.addEventListener\('click', \(\) => applyAutoPackResultOption\(viewedOption\.id\)\);/,
    'carousel Apply must call the existing applyAutoPackResultOption path');
  assert.match(render, /apply\.disabled = isViewedCurrent \|\| stale;/,
    'Apply must be disabled for the applied option and for stale results');
  assert.match(render, /<i class="fa-solid fa-check"><\/i> Applied/,
    'the applied option button must show a check icon');
  assert.match(render, /tp3d-autopack-results__apply-btn--applied/, 'the applied button must carry its modifier class');
  assert.equal(render.includes('Rerun AutoPack after edits.'), false,
    'the rerun note text must not be rendered in the panel');

  const apply = sliceFn(src, 'function applyAutoPackResultOption(optionId)', 'function makeAutoPackResultStat(');
  assert.match(apply, /if \(isAutoPackResultsStale\(pack, results\)\)/, 'apply must keep the stale guard');
  assert.match(apply, /PackLibrary\.update\(pack\.id, \{ cases: cloneAutoPackCases\(option\.nextCases\) \}\)/,
    'apply must keep committing through PackLibrary.update');
  assert.match(apply, /StateStore\.set\(\{ selectedInstanceIds: \[\] \}/,
    'apply must keep clearing selection after swapping the load');
});

test('AUTOPACK-CAROUSEL view/minimize state is clamped; fresh results start at Option 1', async () => {
  const { render } = await renderBlock();

  assert.match(render, /const selectedIndex = Math\.max\(0, options\.findIndex\(option => option\.id === results\.selectedId\)\);/,
    'the applied option index must remain available independently from the visual page');
  assert.match(render, /Number\.isFinite\(Number\(results\.viewIndex\)\) \? Number\(results\.viewIndex\) : 0/,
    'a missing/invalid view index must fall back to index 0 so fresh results open at Option 1');
  assert.match(render, /Math\.min\(Math\.max\(0, requestedIndex\), options\.length - 1\)/,
    'the view index must be clamped into range every render');

  const engineSrc = await fs.readFile(enginePath, 'utf8');
  assert.equal(engineSrc.includes('viewIndex'), false, 'the result payload must not carry carousel view state');
  // minimized: true is intentionally set in the initial payload so each new AutoPack
  // run starts with the panel collapsed (the user expands it with the chevron toggle).
  assert.match(engineSrc, /minimized: true/, 'result payload must set minimized:true so the panel starts collapsed on every new run');
});

test('AUTOPACK-CAROUSEL fresh view starts on Balanced when a non-first option is selected', async () => {
  const { render } = await renderBlock();
  const viewBlock = sliceFn(
    render,
    'const selectedIndex = Math.max(0, options.findIndex(option => option.id === results.selectedId));',
    '\n\n      // Position + drag'
  );
  const resolveView = new Function(
    'results',
    'options',
    'hasAlternates',
    'currentOption',
    `${viewBlock}\nreturn { selectedIndex, requestedIndex, viewIndex, viewedOption };`
  );
  const options = [
    { id: 'default', label: 'Balanced (recommended)' },
    { id: 'compact-fill', label: 'Compact fill' },
    { id: 'stack-priority', label: 'Stack priority' },
  ];
  const view = resolveView(
    { selectedId: 'stack-priority', options },
    options,
    true,
    options[2]
  );

  assert.equal(view.selectedIndex, 2, 'the internally selected/applied option remains non-first');
  assert.equal(view.viewIndex, 0, 'a fresh missing viewIndex starts the visual carousel at Option 1');
  assert.equal(view.viewedOption.id, 'default', 'Option 1 is Balanced while selectedId remains unchanged');
});

test('AUTOPACK-CAROUSEL detail styling: bordered arrows, uppercase tiles, neutral status badge', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');

  assert.match(css, /\.tp3d-autopack-results__carousel-arrow \{[^}]*border: 1px solid var\(--border-subtle\);/,
    'carousel arrows must have a visible border');
  assert.match(css, /\.tp3d-autopack-results__carousel-arrow \{[^}]*border-radius: var\(--radius-sm\);/,
    'carousel arrows must be rounded squares');
  assert.match(css, /\.tp3d-autopack-results__stat-label \{[^}]*text-transform: uppercase;/,
    'metric labels must be uppercase like the reference');
  assert.match(css, /\.tp3d-autopack-results__stat-label \{[^}]*font-size: 10px;/,
    'metric labels must be small');
  assert.match(css, /\.tp3d-autopack-results__status \{\s*background: var\(--bg-hover\);/,
    'the status badge must be a neutral pill');
});

// Portfolio dedupe: two solutions that place the same physical cargo — just with
// a different permutation of interchangeable instance ids assigned to the same
// slots — must be treated as ONE option. Staleness detection must keep using the
// strict, id-aware signature so a real edit is never missed.
function makeAuditInstance(id, caseId, x, y, z) {
  return {
    id,
    caseId,
    hidden: false,
    placement: 'packed',
    transform: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 24, width: 24, height: 24 },
  };
}

async function loadAutoPackResultsStateForAudit() {
  const engineSrc = await fs.readFile(enginePath, 'utf8');
  const stateBlock = sliceFn(
    engineSrc,
    'function buildAutoPackResultsState(',
    '\n  function cancelAllTweens'
  );
  const createStateBuilder = new Function(
    'buildAutoPackResultOption',
    'buildAutoPackCaseRuleSignature',
    'CaseLibrary',
    `return (${stateBlock});`
  );
  return createStateBuilder(
    solution => ({ ...solution.auditOption }),
    () => 'case-rules-signature',
    { getById: () => null }
  );
}

test('AUTOPACK-CAROUSEL layout signature ignores interchangeable instance id permutation; strict signature does not', async () => {
  const Engine = await import(enginePath.href);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };

  const packA = {
    truck,
    cases: [
      makeAuditInstance('inst-1', 'case-A', 10, 12, 10),
      makeAuditInstance('inst-2', 'case-A', 40, 12, 10),
    ],
  };
  // Same two physical slots, instance ids swapped between them.
  const packB = {
    truck,
    cases: [
      makeAuditInstance('inst-2', 'case-A', 10, 12, 10),
      makeAuditInstance('inst-1', 'case-A', 40, 12, 10),
    ],
  };
  // A genuinely different physical layout (one case moved to a new slot).
  const packC = {
    truck,
    cases: [
      makeAuditInstance('inst-1', 'case-A', 10, 12, 10),
      makeAuditInstance('inst-2', 'case-A', 70, 12, 10),
    ],
  };

  assert.notEqual(
    Engine.buildAutoPackResultSignature(packA),
    Engine.buildAutoPackResultSignature(packB),
    'the strict signature (used for staleness) must stay sensitive to which instance id sits where'
  );
  assert.equal(
    Engine.buildAutoPackLayoutSignature(packA),
    Engine.buildAutoPackLayoutSignature(packB),
    'the dedupe-only layout signature must be invariant to interchangeable instance id permutation'
  );
  assert.notEqual(
    Engine.buildAutoPackLayoutSignature(packA),
    Engine.buildAutoPackLayoutSignature(packC),
    'a genuinely different packed position must still produce a different layout signature'
  );
});

test('AUTOPACK-CAROUSEL portfolio dedupe keys on the layout signature, not the strict per-instance signature', async () => {
  const engineSrc = await fs.readFile(enginePath, 'utf8');

  const optionStart = engineSrc.indexOf('function buildAutoPackResultOption(');
  const optionEnd = engineSrc.indexOf('\n  function buildAutoPackResultsState', optionStart);
  assert.ok(optionStart >= 0 && optionEnd > optionStart, 'buildAutoPackResultOption must exist');
  const optionBlock = engineSrc.slice(optionStart, optionEnd);
  assert.match(optionBlock, /signature: buildAutoPackResultSignature\(optionPack\),/,
    'each option must still carry the strict, id-aware signature');
  assert.match(optionBlock, /layoutSignature: buildAutoPackLayoutSignature\(optionPack\),/,
    'each option must also carry the dedupe-only layout signature');

  const stateStart = engineSrc.indexOf('function buildAutoPackResultsState(');
  const stateEnd = engineSrc.indexOf('\n  function cancelAllTweens', stateStart);
  assert.ok(stateStart >= 0 && stateEnd > stateStart, 'buildAutoPackResultsState must exist');
  const stateBlock = engineSrc.slice(stateStart, stateEnd);
  assert.match(stateBlock, /layoutSignatureToId\.has\(option\.layoutSignature\)/,
    'the option dedupe map must be keyed on the layout signature, not the strict per-instance signature');
  assert.match(stateBlock, /currentSignature: selectedOption\.signature,/,
    'the signature exposed for staleness detection must stay the strict, id-aware signature');
});

test('AUTOPACK-MAX-A participates in the existing physical-layout dedupe', async () => {
  const [Solution, Engine] = await Promise.all([
    import(solutionPath.href),
    import(enginePath.href),
  ]);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const identicalSolverResult = makeAdaptiveAuditResult('default', 1, true);
  const portfolio = Solution.runAdaptiveAutoPack({ truck, solveBudgetMs: 4000 }, () => identicalSolverResult);

  const maxCapacity = portfolio.solutions.find(solution => solution.id === 'max-capacity');
  const balanced = portfolio.solutions.find(solution => solution.id === 'default');
  assert.ok(maxCapacity && balanced, 'the raw portfolio contains both Balanced and Max Capacity attempts');

  const asPack = solution => ({
    truck,
    cases: Array.from(solution.placements, ([id, position]) =>
      makeAuditInstance(id, 'case-A', position.x, position.y, position.z)),
  });
  assert.equal(
    Engine.buildAutoPackLayoutSignature(asPack(maxCapacity)),
    Engine.buildAutoPackLayoutSignature(asPack(balanced)),
    'a physically identical Max Capacity result has the same dedupe key as Balanced'
  );

  const engineSrc = await fs.readFile(enginePath, 'utf8');
  const stateBlock = sliceFn(engineSrc, 'function buildAutoPackResultsState(', '\n  function cancelAllTweens');
  assert.equal(stateBlock.includes('max-capacity'), false,
    'the generic engine dedupe has no Max Capacity exception that could expose a fake duplicate');
  assert.match(stateBlock, /layoutSignatureToId\.has\(option\.layoutSignature\)/,
    'all options, including Max Capacity, collapse on an existing physical-layout signature');
});

test('AUTOPACK-MAX-A selected normal option owns its dedupe group without changing other first survivors', async () => {
  const buildState = await loadAutoPackResultsStateForAudit();
  const makeOption = (id, label, layoutSignature, signature) => ({
    id,
    label,
    layoutSignature,
    signature,
  });
  const makeSolution = auditOption => ({
    id: auditOption.id,
    placements: new Map(),
    auditOption,
  });

  const balanced = makeSolution(makeOption(
    'default',
    'Balanced (recommended)',
    'layout-balanced',
    'strict-balanced'
  ));
  const maxCapacity = makeSolution(makeOption(
    'max-capacity',
    'Max Capacity',
    'layout-shared',
    'strict-max'
  ));
  const constrained = makeSolution(makeOption(
    'constrained-first',
    'Constrained space first',
    'layout-shared',
    'strict-constrained'
  ));
  const packingSolution = {
    solutions: [balanced, maxCapacity, constrained],
    selected: constrained.id,
  };

  const selectedNormalState = buildState({
    packId: 'pack-selected-normal',
    packData: { cases: [] },
    packingSolution,
    selectedSolution: constrained,
    stagingMap: new Map(),
  });
  assert.deepEqual(
    selectedNormalState.options.map(option => option.id),
    ['default', 'constrained-first'],
    'the selected normal option replaces the earlier identical Max survivor at the same visible slot'
  );
  assert.equal(selectedNormalState.options[1].label, 'Constrained space first',
    'the surviving duplicate uses the selected normal label');
  assert.equal(selectedNormalState.options.some(option => option.id === 'max-capacity'), false,
    'identical Max Capacity dedupes away instead of stealing selection');
  assert.equal(selectedNormalState.selectedId, 'constrained-first',
    'Results selection stays owned by the normal solver winner');
  assert.equal(selectedNormalState.currentSignature, 'strict-constrained',
    'stale detection keeps the selected normal option strict signature');
  assert.equal(selectedNormalState.attemptedSolutionCount, 3,
    'dedupe still records every attempted raw solution');

  const unrelatedSelectedState = buildState({
    packId: 'pack-unrelated-selected',
    packData: { cases: [] },
    packingSolution: { ...packingSolution, selected: balanced.id },
    selectedSolution: balanced,
    stagingMap: new Map(),
  });
  assert.deepEqual(
    unrelatedSelectedState.options.map(option => option.id),
    ['default', 'max-capacity'],
    'a duplicate group that does not contain the selected option keeps its existing first survivor'
  );
  assert.equal(unrelatedSelectedState.selectedId, 'default');
  assert.equal(unrelatedSelectedState.currentSignature, 'strict-balanced');
});

test('AUTOPACK-CAROUSEL stale Apply button carries a reachable title and aria-label explanation', async () => {
  const { render } = await renderBlock();
  const optionBlock = sliceFn(render, 'const isViewedCurrent = viewedOption.id === results.selectedId;', 'panel.appendChild(body);');

  assert.match(optionBlock, /if \(stale\) \{\s*\n\s*const staleReason = /,
    'the disabled-but-not-applied case (stale) must set an explanatory reason');
  assert.match(optionBlock, /apply\.title = staleReason;/,
    'the stale Apply button must carry a hover tooltip explaining why it is disabled');
  assert.match(optionBlock, /apply\.setAttribute\('aria-label', staleReason\);/,
    'the stale Apply button must carry an accessible label explaining why it is disabled');
  assert.equal(optionBlock.includes("'Rerun AutoPack after edits.'"), false,
    'the stale explanation must not reuse the removed persistent panel text verbatim');
});

test('AUTOPACK-CAROUSEL stale badge renders in the header so carousel, compact, and minimized modes all show it', async () => {
  const { render } = await renderBlock();

  const badgeIdx = render.indexOf("staleBadge.className = 'tp3d-autopack-results__stale-badge'");
  const minimizedIdx = render.indexOf('if (minimized) {');
  const bodyIdx = render.indexOf("body.className = 'tp3d-autopack-results__body'");
  assert.ok(badgeIdx >= 0, 'the stale badge element must be created');
  assert.ok(minimizedIdx > badgeIdx,
    'the badge must be built in the header BEFORE the minimized early-return, so the collapsed chip still shows it');
  assert.ok(bodyIdx > badgeIdx,
    'the badge must be built before the body, so compact and carousel modes both show it');

  const headerBlock = render.slice(0, minimizedIdx);
  assert.match(headerBlock, /if \(stale\) \{/, 'the badge must render only when the results are stale');
  assert.match(headerBlock, /staleBadge\.textContent = 'Outdated — rerun AutoPack';/,
    'the badge must carry the agreed stale copy');
  assert.match(headerBlock, /titleWrap\.appendChild\(staleBadge\);/, 'the badge must be attached to the header title wrap');

  const css = await fs.readFile(stylesPath, 'utf8');
  assert.match(css, /\.tp3d-autopack-results__stale-badge \{/, 'the stale badge must have panel styling');
});

test('AUTOPACK-CAROUSEL apply is rejected while another operation owns the editor', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const apply = sliceFn(src, 'function applyAutoPackResultOption(optionId)', 'function makeAutoPackResultStat(');

  assert.match(apply, /OperationLifecycle\.isBusy\(\)/,
    'apply must check the operation lifecycle before mutating the pack');
  assert.match(apply, /Wait for the current operation to finish before applying AutoPack results\./,
    'the busy rejection must explain itself with a toast');
  const busyIdx = apply.indexOf('OperationLifecycle.isBusy()');
  const staleIdx = apply.indexOf('isAutoPackResultsStale(pack, results)');
  const updateIdx = apply.indexOf('PackLibrary.update(');
  assert.ok(busyIdx >= 0 && busyIdx < staleIdx && busyIdx < updateIdx,
    'the busy guard must run before the stale check and before any mutation');
});

function adaptiveAuditStrategyId(input = {}) {
  if (input.maxCapacityMode === true) return 'max-capacity';
  if (input.constrainedSpaceFirst === true) return 'constrained-first';
  if (input.stackFallbackImmediate === true) return 'stack-priority';
  if (input.enableStackPhase === false) return 'floor-first';
  if (input.layoutQuality === false) return 'compact-fill';
  return 'default';
}

function makeAdaptiveAuditResult(strategyId, packedCount = 2, complete = true) {
  const strategyOffset = {
    default: 0,
    'compact-fill': 5,
    'floor-first': 10,
    'stack-priority': 15,
    'max-capacity': 20,
    'constrained-first': 25,
  }[strategyId] || 0;
  const placements = new Map(Array.from({ length: packedCount }, (_, index) => [
    `item-${index}`,
    { x: strategyOffset + (index * 30), y: 1, z: 0 },
  ]));
  return {
    placements,
    rotations: new Map(),
    orientedDims: new Map(),
    retentionDependencies: new Map(),
    unpacked: complete ? [] : ['staged-item'],
    warnings: [],
    rejectionReasons: [],
    solveStatus: {
      complete,
      unpackedCount: complete ? 0 : 1,
      partialCauses: [],
    },
    phaseStats: {
      laneCount: 0,
      floorCount: strategyId === 'stack-priority' ? 0 : packedCount,
      stackCount: strategyId === 'stack-priority' ? packedCount : 0,
      fillerCount: 0,
      unpackedCount: complete ? 0 : 1,
    },
  };
}

function runAdaptiveAudit(Solution, truck, {
  complete = true,
  packedCounts = {},
  solveBudgetMs = 4000,
} = {}) {
  const calls = [];
  const result = Solution.runAdaptiveAutoPack({
    truck,
    zones: [],
    items: [],
    solveBudgetMs,
  }, input => {
    const id = adaptiveAuditStrategyId(input);
    calls.push({ id, input });
    return makeAdaptiveAuditResult(id, packedCounts[id] ?? 2, complete);
  });
  return { calls, result };
}

test('AUTOPACK-MAX-A raw Results order puts Max Capacity fifth and keeps Wheel Wells constrained sixth', async () => {
  const Solution = await import(solutionPath.href);
  const baseTruck = { length: 240, width: 96, height: 96 };
  const baseOrder = ['default', 'compact-fill', 'floor-first', 'stack-priority', 'max-capacity'];
  const baseRunOrder = ['default', 'compact-fill', 'floor-first', 'stack-priority', 'max-capacity'];
  const fixtures = [
    {
      name: 'Standard',
      truck: { ...baseTruck, shapeMode: 'rect' },
      expectedRun: baseRunOrder,
      expectedDisplay: baseOrder,
    },
    {
      name: 'Front Overhang',
      truck: { ...baseTruck, shapeMode: 'frontBonus' },
      expectedRun: baseRunOrder,
      expectedDisplay: baseOrder,
    },
    {
      name: 'Wheel Wells',
      truck: { ...baseTruck, shapeMode: 'wheelWells' },
      expectedRun: [...baseOrder, 'constrained-first'],
      expectedDisplay: [...baseOrder, 'constrained-first'],
    },
    {
      name: 'degenerate Wheel Wells',
      truck: { ...baseTruck, shapeMode: 'wheelWells', shapeConfig: { wellHeight: 0 } },
      expectedRun: baseRunOrder,
      expectedDisplay: baseOrder,
    },
  ];

  for (const fixture of fixtures) {
    const { calls, result } = runAdaptiveAudit(Solution, fixture.truck, { complete: true });
    assert.deepEqual(calls.map(call => call.id), fixture.expectedRun,
      `${fixture.name}: every intentional strategy runs once`);
    assert.deepEqual(result.solutions.map(solution => solution.id), fixture.expectedDisplay,
      `${fixture.name}: result order matches the intentional portfolio order`);
    assert.equal(result.selected, 'default', `${fixture.name}: Balanced wins packed-count ties`);
  }

  assert.equal(Solution.getPackingStrategy('floor-first').options.enableStackPhase, false,
    'Floor first must continue to disable the stack phase');
});

test('AUTOPACK-MAX-A preset metadata is exact and flows through the existing Results description path', async () => {
  const Solution = await import(solutionPath.href);
  const maxCapacity = Solution.getPackingStrategy('max-capacity');

  assert.ok(maxCapacity, 'Max Capacity must be a registered packing strategy');
  assert.equal(maxCapacity.label, 'Max Capacity');
  assert.equal(
    maxCapacity.description,
    'Physical-fit estimate; handling rules may be relaxed. Not a transport recommendation.'
  );
  assert.deepEqual(maxCapacity.options, { maxCapacityMode: true },
    'the preset must activate only the solver-local Max Capacity mode');

  const engineSrc = await fs.readFile(enginePath, 'utf8');
  const optionBlock = sliceFn(engineSrc, 'function buildAutoPackResultOption(', '\n  function buildAutoPackResultsState');
  assert.match(optionBlock, /label: getSolutionLabel\(solution, index\),/,
    'Max Capacity must use the existing generic preset-label path');
  assert.match(optionBlock, /description: getSolutionDescription\(solution\),/,
    'Max Capacity must use the existing generic preset-description path');
});

test('AUTOPACK-MAX-A uses one tight solve budget and no cleanup without changing normal budgets', async () => {
  const Solution = await import(solutionPath.href);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };

  const largeBudget = runAdaptiveAudit(Solution, truck, { solveBudgetMs: 6000 });
  assert.equal(largeBudget.calls.filter(call => call.id === 'max-capacity').length, 1,
    'Max Capacity runs exactly once');
  const largeMax = largeBudget.calls.find(call => call.id === 'max-capacity').input;
  assert.equal(largeMax.solveBudgetMs, 2000,
    'Max Capacity caps a larger primary budget at 2000ms');
  assert.equal(largeMax.cleanupBudgetMs, 0,
    'Max Capacity has no cleanup window');
  assert.equal(largeBudget.calls.find(call => call.id === 'default').input.solveBudgetMs, 6000,
    'the primary budget is unchanged');
  for (const id of ['compact-fill', 'floor-first', 'stack-priority']) {
    const input = largeBudget.calls.find(call => call.id === id).input;
    assert.equal(input.solveBudgetMs, 3000, `${id} keeps the existing secondary budget`);
    assert.equal(input.cleanupBudgetMs, undefined, `${id} does not inherit Max Capacity cleanup settings`);
  }

  const smallBudget = runAdaptiveAudit(Solution, truck, { solveBudgetMs: 1200 });
  const smallMax = smallBudget.calls.find(call => call.id === 'max-capacity').input;
  assert.equal(smallMax.solveBudgetMs, 1200,
    'Max Capacity uses the smaller positive primary budget instead of expanding it');
  assert.equal(smallMax.cleanupBudgetMs, 0);
  assert.equal(smallBudget.calls.find(call => call.id === 'compact-fill').input.solveBudgetMs, 2000,
    'the pre-existing secondary minimum remains unchanged');
});

test('AUTOPACK-MAX-A partial Wheel Wells load never reruns Max as recovery and opt-out skips it', async () => {
  const Solution = await import(solutionPath.href);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const expected = ['default', 'compact-fill', 'floor-first', 'stack-priority', 'max-capacity', 'constrained-first'];
  const { calls, result } = runAdaptiveAudit(Solution, truck, { complete: false });

  assert.deepEqual(calls.map(call => call.id), expected,
    'solver execution runs the normal portfolio, then exactly one separate Max Capacity solve');
  const displayOrder = ['default', 'compact-fill', 'floor-first', 'stack-priority', 'max-capacity', 'constrained-first'];
  assert.deepEqual(result.solutions.map(solution => solution.id), displayOrder,
    'no duplicate Stack priority or Constrained space first recovery result is appended');
  for (const id of expected) {
    assert.equal(calls.filter(call => call.id === id).length, 1, `${id} solver run occurs exactly once`);
  }

  const optedOutCalls = [];
  const optedOut = Solution.runAdaptiveAutoPack({ truck, strategyRecovery: false }, input => {
    const id = adaptiveAuditStrategyId(input);
    optedOutCalls.push(id);
    return makeAdaptiveAuditResult(id, 1, false);
  });
  assert.deepEqual(optedOutCalls, ['default'], 'strategyRecovery:false still opts out of portfolio and recovery');
  assert.deepEqual(optedOut.solutions.map(solution => solution.id), ['default'],
    'diagnostic opt-out returns only Balanced and skips Max Capacity');
});

test('AUTOPACK-CAROUSEL option descriptions come from the strategy presets and render in both panel modes', async () => {
  const Solution = await import(solutionPath.href);
  for (const preset of Solution.PACKING_STRATEGIES) {
    assert.ok(preset.description && preset.description.length > 0, `${preset.id} must carry a user-facing description`);
  }
  assert.doesNotMatch(Solution.getPackingStrategy('stack-priority').description, /^Recovery: /,
    'intentional Stack priority must not be described as recovery-only');
  assert.match(Solution.getPackingStrategy('stack-priority').description, /Stacks earlier/,
    'Stack priority description explains its intentional layout behavior');
  assert.doesNotMatch(Solution.getPackingStrategy('constrained-first').description, /^Recovery: /,
    'intentional Constrained space first must not be described as recovery-only');
  assert.match(Solution.getPackingStrategy('constrained-first').description, /Wheel Wells/,
    'Constrained space first description makes its Wheel Wells scope clear');

  const engineSrc = await fs.readFile(enginePath, 'utf8');
  const optionBlock = sliceFn(engineSrc, 'function buildAutoPackResultOption(', '\n  function buildAutoPackResultsState');
  assert.match(optionBlock, /description: getSolutionDescription\(solution\),/,
    'each result option must carry the preset description');

  const { render } = await renderBlock();
  assert.match(render, /const optionDescription = makeAutoPackResultDescription\(viewedOption\);/,
    'the carousel option must render the description line');
  assert.match(render, /const compactDescription = makeAutoPackResultDescription\(viewedOption\);/,
    'the single-option compact mode must render the description line too');
  assert.match(render, /if \(!hasAlternates\) \{/,
    'the compact description must be scoped to the single-option mode');
});

test('AUTOPACK-CAROUSEL Floor/Stacked stats derive from phaseStats and the Partial pill explains itself', async () => {
  const engineSrc = await fs.readFile(enginePath, 'utf8');
  const optionBlock = sliceFn(engineSrc, 'function buildAutoPackResultOption(', '\n  function buildAutoPackResultsState');
  assert.match(optionBlock,
    /const floorCount = \(Number\(phase\.laneCount\) \|\| 0\) \+ \(Number\(phase\.floorCount\) \|\| 0\) \+ \(Number\(phase\.fillerCount\) \|\| 0\);/,
    'Floor must sum every floor-level solver phase (lane + floor + filler)');
  assert.match(optionBlock, /const stackedCount = Number\(phase\.stackCount\) \|\| 0;/,
    'Stacked must be the solver stack phase count');
  assert.match(optionBlock, /solution\.phaseStats && typeof solution\.phaseStats === 'object'/,
    'phase stats must come from the solution phaseStats');
  assert.match(optionBlock, /partialCauses,/,
    'each option must carry the solve partialCauses');

  const { render } = await renderBlock();
  assert.match(render, /makeAutoPackResultStat\('Packed', formatAutoPackResultNumber\(viewedOption\.packedCount\)\)/,
    'Packed must stay a primary metric tile');
  assert.match(render, /makeAutoPackResultStat\('Staged', formatAutoPackResultNumber\(viewedOption\.stagedCount\)\)/,
    'Staged must stay a primary metric tile');
  assert.match(render, /makeAutoPackResultChip\('Floor', formatAutoPackResultNumber\(viewedOption\.floorCount\)\)/,
    'Floor must render as a secondary compact chip');
  assert.match(render, /makeAutoPackResultChip\('Stacked', formatAutoPackResultNumber\(viewedOption\.stackedCount\)\)/,
    'Stacked must render as a secondary compact chip');
  assert.match(render, /const partialReason = formatAutoPackPartialReason\(viewedOption\);/,
    'a partial option must derive a readable reason');
  assert.match(render, /status\.title = partialReason;/,
    'the Partial pill must carry the reason as a hover tooltip');
  assert.match(render, /status\.setAttribute\('aria-label', partialReason\);/,
    'the Partial pill reason must also be accessible');
});

test('AUTOPACK-CAROUSEL dedupe-collapsed results explain that other strategies produced the same layout', async () => {
  const { render } = await renderBlock();
  assert.match(render, /if \(!hasAlternates && Number\(results\.attemptedSolutionCount\) > options\.length\) \{/,
    'the note must appear only in single-option mode, where the collapse genuinely needs explaining');
  assert.match(render, /dedupeNote\.textContent = 'Other strategies produced the same layout\.';/,
    'the note must carry the agreed copy');

  const css = await fs.readFile(stylesPath, 'utf8');
  assert.match(css, /\.tp3d-autopack-results__dedupe-note \{/, 'the dedupe note must have panel styling');
  assert.match(css, /\.tp3d-autopack-results__option-desc \{/, 'the description line must have panel styling');
  assert.match(css, /\.tp3d-autopack-results__stat-chip \{/, 'the secondary metric chips must have panel styling');
});

test('AUTOPACK-CAROUSEL normal options keep packed-count ranking while Phase A Max Capacity never auto-selects', async () => {
  const Solution = await import(solutionPath.href);
  const makeResult = placementEntries => ({
    placements: new Map(placementEntries),
    rotations: new Map(),
    orientedDims: new Map(),
    retentionDependencies: new Map(),
    unpacked: [],
    warnings: [],
    rejectionReasons: [],
    solveStatus: { complete: true, unpackedCount: 0, partialCauses: [] },
    phaseStats: {},
  });

  // Tie: both strategies pack the same count (different layouts) — default wins.
  const tie = Solution.runPackingStrategies({}, ['default', 'compact-fill'], input =>
    input.layoutQuality === false
      ? makeResult([['a', { x: 9, y: 1, z: 0 }], ['b', { x: 20, y: 1, z: 0 }]])
      : makeResult([['a', { x: 0, y: 1, z: 0 }], ['b', { x: 30, y: 1, z: 0 }]]));
  assert.equal(tie.selected, 'default', 'Balanced (default) must win packed-count ties');

  // A strategy that genuinely packs more must beat the default.
  const better = Solution.runPackingStrategies({}, ['default', 'compact-fill'], input =>
    input.layoutQuality === false
      ? makeResult([['a', { x: 9, y: 1, z: 0 }], ['b', { x: 20, y: 1, z: 0 }], ['c', { x: 40, y: 1, z: 0 }]])
      : makeResult([['a', { x: 0, y: 1, z: 0 }], ['b', { x: 30, y: 1, z: 0 }]]));
  assert.equal(better.selected, 'compact-fill', 'an option that truly packs more must be selected');

  const standardTruck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const adaptiveTie = runAdaptiveAudit(Solution, standardTruck).result;
  assert.equal(adaptiveTie.selected, 'default', 'Balanced must also win normal-portfolio ties');

  const adaptiveBetter = runAdaptiveAudit(Solution, standardTruck, {
    packedCounts: { default: 2, 'compact-fill': 2, 'floor-first': 1, 'stack-priority': 3 },
  }).result;
  assert.equal(adaptiveBetter.selected, 'stack-priority',
    'a normal intentional option may be selected when it truly packs more cases');

  const maxPacksMost = runAdaptiveAudit(Solution, standardTruck, {
    packedCounts: {
      default: 2,
      'compact-fill': 2,
      'floor-first': 1,
      'stack-priority': 3,
      'max-capacity': 99,
    },
  }).result;
  assert.equal(maxPacksMost.solutions.find(solution => solution.id === 'max-capacity').placements.size, 99,
    'the higher-capacity Max result remains available for manual navigation and Apply');
  assert.equal(maxPacksMost.selected, 'stack-priority',
    'Max Capacity is excluded from automatic winner selection even when it packs far more');
  assert.equal(maxPacksMost.selectedSolution.id, 'stack-priority',
    'the layout immediately applied by AutoPack remains the best normal portfolio result');
});
