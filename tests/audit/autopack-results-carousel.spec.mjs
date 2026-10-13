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
const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const solutionPath = new URL('../../src/packing-core/solution.js', import.meta.url);
const stylesPath = new URL('../../styles/main.css', import.meta.url);

test('A3 Results Apply preserves immutable fixed rows and profiles while changing only solver-owned cargo', async () => {
  const EditorScreen = await import(editorScreenPath.href);
  const Engine = await import(enginePath.href);
  const fixed = {
    id: 'fixed', caseId: 'hidden', hidden: true, placement: 'packed', packedProfile: 'max-capacity',
    transform: { position: { x: 10, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 20, width: 10, height: 10 },
  };
  const unresolved = {
    id: 'missing', caseId: 'deleted', hidden: false, placement: 'packed',
    transform: { position: { x: 30, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 10, width: 10, height: 10 },
  };
  const movable = {
    id: 'move', caseId: 'known', hidden: false, placement: 'packed',
    transform: { position: { x: 50, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    orientedDims: { length: 10, width: 10, height: 10 },
  };
  const current = [fixed, unresolved, movable];
  const chosen = structuredClone(current);
  chosen[0].transform.position.x = 999;
  chosen[1].transform.position.x = 999;
  chosen[2].transform.position.x = 60;
  const option = { id: 'max-capacity', movableIds: ['move'], nextCases: chosen };
  const applied = EditorScreen.buildAppliedAutoPackCases(option, structuredClone, current);
  assert.equal(JSON.stringify(applied[0]), JSON.stringify(fixed));
  assert.equal(JSON.stringify(applied[1]), JSON.stringify(unresolved));
  assert.equal(applied[2].transform.position.x, 60);
  assert.equal(applied[2].packedProfile, 'max-capacity');
  const pack = { truck: { length: 100, width: 20, height: 20 }, cases: applied };
  assert.equal(
    Engine.buildAutoPackResultSignature(pack),
    Engine.buildAutoPackResultSignature({ ...pack, cases: [fixed, unresolved, chosen[2]] }, 'max-capacity', new Set(['move'])),
    'option signature stamps only the movable instance'
  );
});

test('F06 current Results producer records movement identity while legacy whole-load Apply remains supported', async () => {
  const [engineSource, EditorScreen, StateStore, Storage] = await Promise.all([
    fs.readFile(enginePath, 'utf8'), import(editorScreenPath.href),
    import(new URL('../../src/core/state-store.js', import.meta.url).href),
    import(new URL('../../src/core/storage.js', import.meta.url).href),
  ]);
  const optionBuilder = sliceFn(engineSource, 'function buildAutoPackResultOption(', 'function buildAutoPackResultsState(');
  const resultsBuilder = sliceFn(engineSource, 'function buildAutoPackResultsState(', 'function cancelAllTweens(');
  assert.match(optionBuilder, /movableIds: \[\.\.\.resolvedMovableIds\]/,
    'every current engine option must carry its exact physically resolved movable population');
  assert.match(resultsBuilder, /buildAutoPackResultOption\(solution, index, packData, stagingMap, movableIds, excludedIds\)/,
    'all current result options share that producer');

  const current = [{ id: 'one', caseId: 'case-one', placement: 'packed',
    transform: { position: { x: 5, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }];
  const chosen = structuredClone(current);
  chosen[0].transform.position.x = 15;
  assert.equal(EditorScreen.buildAppliedAutoPackCases(
    { id: 'default', nextCases: chosen }, structuredClone, current)?.[0].transform.position.x,
  15, 'legacy whole-load direct Apply may omit movableIds');
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {},
    autoPackResults: { options: [{ nextCases: chosen }] } });
  assert.equal(Object.hasOwn(JSON.parse(Storage.exportAppJSON()).data, 'autoPackResults'), false,
    'transient Results are excluded from App Backup');
});

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
  const { src, render } = await renderBlock();

  assert.match(sliceFn(src, 'function resolveAutoPackResultsView(pack) {', '// Transient live preview'),
    /const hasAlternates = options\.length > 1;/, 'multiple-option detection must stay based on options.length');
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
  assert.match(render, /patchAutoPackResultsState\(\{ minimized: !minimized \}, results\.runId\)/,
    'the toggle must flip the UI-only minimized state');

  // Close stays a separate dismiss.
  assert.match(render, /closeBtn\.setAttribute\('aria-label', 'Close AutoPack results'\);/,
    'a close control with an accessible label must exist');
  assert.match(render, /closeBtn\.addEventListener\('click', \(\) => patchAutoPackResultsState\(\{ closed: true \}, results\.runId\)\);/,
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
  assert.match(place, /attachAutoPackResultsDrag\(el, host, results\.runId\)/,
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
  assert.match(nav, /patchAutoPackResultsState\(\{ viewIndex: Math\.max\(0, viewIndex - 1\), previewEnded: false \}, results\.runId\)/,
    'Previous must only move the view index');
  assert.match(nav, /patchAutoPackResultsState\(\{ viewIndex: Math\.min\(options\.length - 1, viewIndex \+ 1\), previewEnded: false \}, results\.runId\)/,
    'Next must only move the view index');
  assert.equal(nav.includes('applyAutoPackResultOption'), false, 'Prev/Next must not apply a solution');
  assert.equal(nav.includes('PackLibrary'), false, 'Prev/Next must not mutate the pack');
});

test('AUTOPACK-CAROUSEL apply keeps the validated path, marks Applied with a check, drops the rerun note', async () => {
  const { render, src } = await renderBlock();

  assert.match(render, /apply\.addEventListener\('click', \(\) => applyAutoPackResultOption\(viewedOption\.id, results\.runId\)\);/,
    'carousel Apply must call the existing applyAutoPackResultOption path');
  assert.match(render, /apply\.disabled = isViewedCurrent \|\| stale \|\|/,
    'Apply must be disabled for the applied option and for stale results');
  assert.match(render, /<i class="fa-solid fa-check"><\/i> Applied/,
    'the applied option button must show a check icon');
  assert.match(render, /tp3d-autopack-results__apply-btn--applied/, 'the applied button must carry its modifier class');
  assert.equal(render.includes('Rerun AutoPack after edits.'), false,
    'the rerun note text must not be rendered in the panel');

  const apply = sliceFn(src, 'function applyAutoPackResultOption(optionId, expectedRunId)', 'function makeAutoPackResultStat(');
  assert.match(apply, /if \(isAutoPackResultsStale\(pack, results, option\)\)/, 'apply must keep the stale guard');
  assert.match(apply, /buildAppliedAutoPackCases\(option, cloneAutoPackCases, pack\.cases\) : prepared\?\.cases;/,
    'apply must derive the applied option cases through the profile-aware builder');
  // Source-level production wiring coverage (not behavioral Apply execution).
  assert.doesNotMatch(apply, /handlingRulesValidatedSignature|buildHandlingRulesValiditySignature/,
    'C4 Apply commits source without persisting a validation certificate');
  assert.match(apply, /getAppliedAutoPackOption\(projectedPack, \{ \.\.\.results, adoptedOptionIds \}, caseId => CaseLibrary\.getById\(caseId\)\) !== option/,
    'Apply must refuse a proposal that cannot become the exact unambiguous applied option');
  assert.equal((apply.match(/PackLibrary\.update\(/g) || []).length, 1,
    'Apply must publish cases through one Pack update');
  assert.match(apply, /PackLibrary\.update\(pack\.id, \{\s*cases: appliedCases,?\s*\}\)/,
    'apply must commit the applied source through one PackLibrary.update call');
  assert.match(apply, /StateStore\.set\(\{ selectedInstanceIds: \[\] \}, \{ skipHistory: true, skipNotify: true \}\)/,
    'apply must clear selection without a separate render');
  assert.equal(apply.includes('selectedId: option.id'), false, 'Apply must derive live authority without a Results write');
  assert.equal(apply.includes('render();'), false, 'the Pack update already drives Editor render');
});

test('AUTOPACK-CAROUSEL view/minimize state is clamped; fresh results open on the starting view', async () => {
  const { src, render } = await renderBlock();
  const resolver = sliceFn(src, 'function resolveAutoPackResultsView(pack) {', '// Transient live preview');

  assert.match(render, /const view = resolveAutoPackResultsView\(pack\);/,
    'the card reads the one shared viewed-option resolution');
  assert.match(resolver, /const selectedIndex = Math\.max\(0, options\.findIndex\(option => option === currentOption\)\);/,
    'the applied option index must remain available independently from the visual page');
  assert.match(resolver, /const requestedIndex = Number\.isInteger\(results\.viewIndex\) \? results\.viewIndex : startIndex;/,
    'only an explicit browsed index overrides the run starting view');
  assert.match(resolver, /Math\.min\(Math\.max\(0, requestedIndex\), options\.length - 1\)/,
    'the view index must be clamped into range every render');

  const engineSrc = await fs.readFile(enginePath, 'utf8');
  assert.equal(engineSrc.includes('viewIndex'), false, 'the result payload must not carry carousel view state');
  assert.match(engineSrc, /minimized: selectedId !== null/, 'adopted runs start collapsed; review-required runs start expanded');
});

// The production viewed-option resolver (shared by the Results card, the 3D
// scene and the Inspector) plus the production once-per-run starting view
// getter, over given display-ordered options and Applied option, driven by a
// mutable stand-in for the saved preference.
async function startViewHarness(initialStartView) {
  const [{ src }, EditorScreen] = await Promise.all([renderBlock(), import(editorScreenPath.href)]);
  const getterSource = sliceFn(src, 'let autoPackResultsStart = null;', '// The single viewed-option resolution');
  const resolverSource = sliceFn(src, 'function resolveAutoPackResultsView(pack) {', '// Transient live preview');
  const prefs = { autoPackResultsStartView: initialStartView };
  const reads = [];
  const PreferencesManager = { get: () => { reads.push(prefs.autoPackResultsStartView); return { ...prefs }; } };
  const getAutoPackResultsStartIndex = new Function('PreferencesManager', 'resolveAutoPackResultsStartIndex',
    `${getterSource}\nreturn getAutoPackResultsStartIndex;`)(PreferencesManager, EditorScreen.resolveAutoPackResultsStartIndex);
  const resolveView = (results, currentOption) => new Function('getAutoPackResultsState', 'orderAutoPackResultOptions',
    'getAppliedAutoPackOption', 'CaseLibrary', 'getAutoPackResultsStartIndex',
    `${resolverSource}\nreturn resolveAutoPackResultsView;`)(
    () => results, list => list, () => currentOption, {}, getAutoPackResultsStartIndex);
  return {
    EditorScreen, prefs, reads, getAutoPackResultsStartIndex,
    view: (results, options, currentOption) =>
      resolveView({ ...results, options, packId: 'pack', closed: false }, currentOption)({ id: 'pack' }),
  };
}

test('AUTOPACK-CAROUSEL fresh view follows the starting view, keeps an explicit browse; Balanced leads and Max Capacity follows', async () => {
  const harness = await startViewHarness('first');
  const { EditorScreen } = harness;
  const raw = [
    { id: 'default', label: 'Balanced' },
    { id: 'compact-fill', label: 'Compact fill' },
    { id: 'stack-priority', label: 'Stack priority' },
    { id: 'max-capacity', label: 'Max Capacity' },
  ];
  const options = EditorScreen.orderAutoPackResultOptions(raw);
  assert.deepEqual(options.map(option => option.id), ['default', 'max-capacity', 'compact-fill', 'stack-priority'],
    'Balanced leads, Max Capacity follows, the other standard plans keep their solver order');
  assert.deepEqual(raw.map(option => option.id), ['default', 'compact-fill', 'stack-priority', 'max-capacity'],
    'display ordering never reorders the stored Results options');
  const [balanced, maxCapacity, compact, stack] = options;
  let runs = 0;
  // Each call is a NEW Results run (fresh runId) opened under the given preference.
  const freshRun = (startView, currentOption, results = {}) => {
    harness.prefs.autoPackResultsStartView = startView;
    return harness.view({ runId: `run-${++runs}`, selectedId: 'default', ...results }, options, currentOption);
  };

  assert.equal(freshRun('first', compact).viewedOption, balanced,
    'First option: a fresh run opens on display index 0 (Balanced) even though Compact fill is Applied');
  assert.equal(freshRun('first', compact).viewIndex, 0);
  assert.equal(freshRun('applied', compact).viewedOption, compact,
    'Applied option: a fresh run opens on the unique Applied plan');
  assert.equal(freshRun('applied', maxCapacity).viewIndex, 1, 'Applied may be Max Capacity after the user applied it');
  assert.equal(freshRun('recommended', compact).viewedOption, balanced,
    'Recommended option: a fresh run opens on results.selectedId, independent of Applied');
  assert.equal(freshRun('recommended', balanced, { selectedId: 'stack-priority' }).viewedOption, stack,
    'Recommended follows the run selectedId; Balanced is not permanently Recommended');
  assert.equal(freshRun('applied', null).viewIndex, 0,
    'with no unique Applied option (Outdated or ambiguous), Applied falls back to the first option');
  assert.equal(freshRun('recommended', balanced, { selectedId: 'missing' }).viewIndex, 0,
    'an unresolved Recommended plan falls back to the first option');
  assert.equal(freshRun('recommended', compact, { selectedId: 'max-capacity' }).viewedOption, balanced,
    'a Max Capacity selectedId is never treated as Recommended; the view falls back to the first option');
  assert.equal(freshRun('bogus', compact).viewIndex, 0, 'an unknown stored value behaves as First option');

  assert.equal(freshRun('applied', compact, { viewIndex: 1 }).viewedOption, maxCapacity,
    'an explicit browse to Max Capacity is kept even though the preference points at Applied');
  assert.equal(freshRun('first', compact, { viewIndex: 3 }).viewIndex, 3,
    'an explicit browse is never forced back to the starting view');
  assert.equal(freshRun('first', balanced, { viewIndex: 99 }).viewIndex, options.length - 1, 'explicit indices are clamped');

  // The pure resolver over the raw solver order: Recommended can never land on
  // Max Capacity, and nothing it reads is changed.
  const frozenRaw = Object.freeze(raw.map(option => Object.freeze({ ...option })));
  const frozenResults = Object.freeze({ selectedId: 'max-capacity' });
  assert.equal(EditorScreen.resolveAutoPackResultsStartIndex(frozenRaw, frozenResults, null, 'recommended'), 0);
  assert.notEqual(frozenRaw[0].id, 'max-capacity', 'that fallback is the first raw option, not Max Capacity');
  assert.equal(EditorScreen.resolveAutoPackResultsStartIndex(frozenRaw, { selectedId: 'compact-fill' }, null, 'recommended'), 1);
  assert.equal(EditorScreen.resolveAutoPackResultsStartIndex(frozenRaw, null, frozenRaw[3], 'applied'), 3,
    'Applied may legitimately be Max Capacity after the user applied it');
  assert.equal(EditorScreen.resolveAutoPackResultsStartIndex(frozenRaw, null, { id: 'default' }, 'applied'), 0,
    'Applied matches the option object itself, never a look-alike id');
  assert.equal(EditorScreen.resolveAutoPackResultsStartIndex([], null, null, 'first'), 0);
  assert.equal(EditorScreen.resolveAutoPackResultsStartIndex(undefined, undefined, undefined, undefined), 0);
});

test('AUTOPACK-RESULTS-START preference defaults to First option and the starting view is resolved once per run', async () => {
  const [harness, Normalizer, Defaults] = await Promise.all([
    startViewHarness('applied'),
    import(new URL('../../src/core/normalizer.js', import.meta.url).href),
    import(new URL('../../src/core/defaults.js', import.meta.url).href),
  ]);
  assert.equal(Defaults.defaultPreferences.autoPackResultsStartView, 'first');
  assert.deepEqual([...Defaults.AUTOPACK_RESULTS_START_VIEWS], ['first', 'applied', 'recommended']);
  const legacy = Normalizer.normalizePreferences({ theme: 'dark', units: { length: 'ft', weight: 'lb' } });
  assert.equal(legacy.autoPackResultsStartView, 'first', 'a legacy record missing the field normalizes to First option');
  assert.equal(legacy.showAutoPackLoadingOverlay, true, 'a legacy record keeps the AutoPack loading screen ON');
  for (const value of ['first', 'applied', 'recommended']) {
    assert.equal(Normalizer.normalizePreferences({ autoPackResultsStartView: value }).autoPackResultsStartView, value);
  }
  for (const value of [0, 1, 2, '1', 'Applied', null, {}, 'max-capacity']) {
    assert.equal(Normalizer.normalizePreferences({ autoPackResultsStartView: value }).autoPackResultsStartView, 'first',
      `${JSON.stringify(value)} is not a named starting view and never persists as an option index`);
  }

  const options = harness.EditorScreen.orderAutoPackResultOptions([
    { id: 'default' }, { id: 'compact-fill' }, { id: 'max-capacity' },
  ]);
  const [balanced, maxCapacity, compact] = options;
  const runA = { runId: 'run-A', selectedId: 'default' };
  assert.equal(harness.view(runA, options, compact).viewedOption, compact, 'run A opens on its Applied plan');
  harness.prefs.autoPackResultsStartView = 'first';
  assert.equal(harness.view(runA, options, compact).viewedOption, compact,
    'changing the preference never moves an already open run');
  assert.equal(harness.view(runA, options, balanced).viewedOption, compact,
    'a later Apply, Undo or Redo does not move an unbrowsed run');
  assert.equal(harness.view(runA, options, null).viewedOption, compact, 'nor does the run going Outdated');
  assert.equal(harness.view({ ...runA, viewIndex: 1 }, options, null).viewedOption, maxCapacity, 'an explicit browse still wins');
  assert.equal(harness.view({ runId: 'run-B', selectedId: 'default' }, options, compact).viewedOption, balanced,
    'the next NEW run uses the current preference');
  assert.deepEqual(harness.reads, ['applied', 'first'], 'the preference is read exactly once per run');
});

test('AUTOPACK-CAROUSEL detail styling: bordered arrows, uppercase tiles, semantic status badges', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');

  assert.match(css, /\.tp3d-autopack-results__carousel-arrow \{[^}]*border: 1px solid var\(--border-subtle\);/,
    'carousel arrows must have a visible border');
  assert.match(css, /\.tp3d-autopack-results__carousel-arrow \{[^}]*border-radius: var\(--radius-sm\);/,
    'carousel arrows must be rounded squares');
  assert.match(css, /\.tp3d-autopack-results__stat-label \{[^}]*text-transform: uppercase;/,
    'metric labels must be uppercase like the reference');
  assert.match(css, /\.tp3d-autopack-results__stat-label \{[^}]*font-size: 10px;/,
    'metric labels must be small');
  assert.match(css, /\.tp3d-autopack-results__status--complete \{[^}]*background: rgb\(16, 185, 129, 0\.12\);[^}]*color: var\(--success-readable\);/,
    'Complete uses a soft success tint with readable success text');
  assert.match(css, /\.tp3d-autopack-results__status--partial \{[^}]*border-color: rgb\(245, 158, 11, 0\.36\);[^}]*background: rgb\(245, 158, 11, 0\.14\);[^}]*color: var\(--text-primary\);/,
    'Partial uses a soft amber border and tint with neutral, readable copy');
  assert.match(css, /\.tp3d-autopack-results__current-pill \{[^}]*background: var\(--accent-primary\);[^}]*color: var\(--accent-foreground\);/,
    'Applied keeps the brand orange fill on the white/orange primary contract');
  assert.match(css, /\.tp3d-autopack-results__recommended-pill \{[^}]*border-color: var\(--border-strong\);[^}]*background: transparent;/,
    'Recommended is a restrained neutral outline');
  assert.match(css, /\.tp3d-autopack-results__relaxed-note \{[^}]*border: 1px solid rgb\(245, 158, 11, 0\.36\);[^}]*color: var\(--text-primary\);[^}]*white-space: normal;/,
    'the Max Capacity warning keeps an amber border, neutral copy, and wraps instead of truncating');
  assert.match(css, /\.tp3d-autopack-results__relaxed-note i \{[^}]*color: var\(--warning-readable\);/,
    'the Max Capacity warning icon carries the orange warning token');
  assert.match(css, /--warning-readable: #e87500;/, 'the light warning token is the corrected orange');
  assert.match(css, /:root \{[\s\S]*?--success-readable: #047857;/, 'light theme defines readable success text');
  assert.match(css, /\[data-theme='dark'\] \{[\s\S]*?--success-readable: #6ee7b7;/, 'dark theme defines readable success text');
  const resultsCss = sliceFn(css, '.tp3d-autopack-results {', '/* Muted one-line strategy description');
  assert.doesNotMatch(resultsCss, /gradient\(|--info|text-shadow/, 'no gradients, blue status palette or glows');

  const { render } = await renderBlock();
  assert.match(render, /tp3d-autopack-results__status--\$\{viewedOption\.status === 'complete' \? 'complete' : 'partial'\}/,
    'Complete and Partial carry distinct semantic classes');
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

function makeStalenessAuditPack() {
  const packed = makeAuditInstance('packed-1', 'case-A', 30, 12, 0);
  packed.packedProfile = 'max-capacity';
  const staged = makeAuditInstance('staged-1', 'case-B', 20, 12, 80);
  staged.placement = 'staged';
  staged.packedProfile = 'max-capacity';
  return {
    id: 'staleness-pack',
    truck: { length: 240, width: 96, height: 96, shapeMode: 'rect' },
    cases: [packed, staged],
  };
}

test('AUTOPACK-STALE staged position, rotation, dimensions, and profile metadata do not change the strict signature', async () => {
  const Engine = await import(enginePath.href);
  const pack = makeStalenessAuditPack();
  const baseline = Engine.buildAutoPackResultSignature(pack);
  const stagedOnlyPack = { ...pack, cases: [structuredClone(pack.cases[1])] };
  const stagedFields = JSON.parse(Engine.buildAutoPackResultSignature(stagedOnlyPack)).cases[0];

  assert.equal(stagedFields.id, 'staged-1');
  assert.equal(stagedFields.caseId, 'case-B');
  assert.equal(stagedFields.placement, 'staged');
  assert.equal(stagedFields.hidden, false);
  assert.equal('position' in stagedFields, false, 'staged position must be excluded');
  assert.equal('rotation' in stagedFields, false, 'staged rotation must be excluded');
  assert.equal('orientedDims' in stagedFields, false, 'staged dimensions must be excluded');
  assert.equal('packedProfile' in stagedFields, false, 'staged profile metadata must be excluded');

  const mutations = [
    ['position', next => { next.cases[1].transform.position.x += 37; }],
    ['rotation', next => { next.cases[1].transform.rotation.y = Math.PI / 2; }],
    ['orientedDims', next => { next.cases[1].orientedDims = { length: 10, width: 24, height: 24 }; }],
    ['packedProfile', next => { delete next.cases[1].packedProfile; }],
  ];
  for (const [label, mutate] of mutations) {
    const next = structuredClone(pack);
    mutate(next);
    assert.equal(Engine.buildAutoPackResultSignature(next), baseline,
      `staged ${label}-only changes must keep Results current`);
  }

  const movedStaged = structuredClone(pack);
  movedStaged.cases[1].transform.position.x += 37;
  assert.notEqual(Engine.buildAutoPackLayoutSignature(movedStaged), Engine.buildAutoPackLayoutSignature(pack),
    'the separate physical-layout dedupe signature must retain its existing staged-pose behavior');
});

test('AUTOPACK-STALE packed pose and packed Max Capacity profile remain protected', async () => {
  const Engine = await import(enginePath.href);
  const pack = makeStalenessAuditPack();
  const baseline = Engine.buildAutoPackResultSignature(pack);
  const packedFields = JSON.parse(baseline).cases.find(inst => inst.id === 'packed-1');

  assert.deepEqual(packedFields.position, { x: 30, y: 12, z: 0 });
  assert.deepEqual(packedFields.rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(packedFields.orientedDims, { length: 24, width: 24, height: 24 });
  assert.equal(packedFields.packedProfile, 'max-capacity');

  const mutations = [
    ['position', next => { next.cases[0].transform.position.x += 1; }],
    ['rotation', next => { next.cases[0].transform.rotation.y = Math.PI / 2; }],
    ['orientedDims', next => { next.cases[0].orientedDims.length += 1; }],
    ['packedProfile', next => { delete next.cases[0].packedProfile; }],
  ];
  for (const [label, mutate] of mutations) {
    const next = structuredClone(pack);
    mutate(next);
    assert.notEqual(Engine.buildAutoPackResultSignature(next), baseline,
      `packed ${label} changes must invalidate Results`);
  }

  const optionPack = makeStalenessAuditPack();
  delete optionPack.cases[0].packedProfile;
  const appliedMax = structuredClone(optionPack);
  appliedMax.cases[0].packedProfile = 'max-capacity';
  delete appliedMax.cases[1].packedProfile;
  assert.equal(
    Engine.buildAutoPackResultSignature(optionPack, 'max-capacity'),
    Engine.buildAutoPackResultSignature(appliedMax),
    'a Max Capacity option signature must match its durable applied packed profile'
  );

  const engineSrc = await fs.readFile(enginePath, 'utf8');
  const optionBlock = sliceFn(engineSrc, 'function buildAutoPackResultOption(', '\n  function buildAutoPackResultsState');
  assert.match(optionBlock,
    /signature: buildAutoPackResultSignature\(optionPack, id === 'max-capacity' \? 'max-capacity' : null, resolvedMovableIds\),/,
    'option signatures must project the packed profile only for cargo that Apply may change');
});

test('AUTOPACK-STALE membership, quantity, identity, and hidden-state changes still invalidate', async () => {
  const Engine = await import(enginePath.href);
  const pack = makeStalenessAuditPack();
  const baseline = Engine.buildAutoPackResultSignature(pack);
  const mutations = [
    ['staged to packed', next => { next.cases[1].placement = 'packed'; }],
    ['packed to staged', next => { next.cases[0].placement = 'staged'; }],
    ['added instance', next => { next.cases.push(makeAuditInstance('added-1', 'case-A', 70, 12, 0)); }],
    ['deleted instance', next => { next.cases.splice(1, 1); }],
    ['duplicated instance', next => {
      const duplicate = structuredClone(next.cases[0]);
      duplicate.id = 'packed-copy';
      next.cases.push(duplicate);
    }],
    ['hidden state', next => { next.cases[1].hidden = true; }],
    ['case identity', next => { next.cases[1].caseId = 'case-C'; }],
  ];

  for (const [label, mutate] of mutations) {
    const next = structuredClone(pack);
    mutate(next);
    assert.notEqual(Engine.buildAutoPackResultSignature(next), baseline,
      `${label} must invalidate Results`);
  }
});

test('AUTOPACK-STALE truck, case definitions, and instance handling rules remain protected', async () => {
  const Engine = await import(enginePath.href);
  const pack = makeStalenessAuditPack();
  const changedTruck = structuredClone(pack);
  changedTruck.truck.length += 1;
  assert.notEqual(Engine.buildAutoPackResultSignature(changedTruck), Engine.buildAutoPackResultSignature(pack),
    'truck geometry changes must invalidate Results');

  const changedInstanceRule = structuredClone(pack);
  changedInstanceRule.cases[1].orientationLock = 'upright';
  changedInstanceRule.cases[1].canFlip = true;
  assert.equal(Engine.buildAutoPackResultSignature(changedInstanceRule), Engine.buildAutoPackResultSignature(pack),
    'retired instance physical overrides have no permission or freshness authority');
  changedInstanceRule.cases[1].orientationLocked = true;
  changedInstanceRule.cases[1].lockedRotation = { x: 0, y: Math.PI / 2, z: 0 };
  assert.notEqual(Engine.buildAutoPackResultSignature(changedInstanceRule), Engine.buildAutoPackResultSignature(pack),
    'exact instance planning constraints invalidate Results even when the instance is staged');

  const caseData = {
    id: 'case-A',
    dimensions: { length: 24, width: 24, height: 24 },
    weight: 10,
    orientationLock: 'any',
    maxStackCount: 3,
  };
  const caseRuleSignature = overrides => Engine.buildAutoPackCaseRuleSignature(
    { cases: [makeAuditInstance('case-rule-inst', 'case-A', 10, 12, 0)] },
    () => ({ ...caseData, ...overrides })
  );
  const baselineRules = caseRuleSignature({});
  assert.notEqual(caseRuleSignature({ dimensions: { length: 25, width: 24, height: 24 } }), baselineRules,
    'case dimension changes must invalidate Results');
  assert.notEqual(caseRuleSignature({ weight: 11 }), baselineRules,
    'case weight changes must invalidate Results');
  assert.notEqual(caseRuleSignature({ maxStackCount: 2 }), baselineRules,
    'case handling-rule changes must invalidate Results');
});

test('AUTOPACK-STALE production stale comparison stays current after staged-only movement', async () => {
  const [Engine, EditorScreen] = await Promise.all([
    import(enginePath.href),
    import(editorScreenPath.href),
  ]);
  const casesById = new Map([
    ['case-A', { id: 'case-A', dimensions: { length: 24, width: 24, height: 24 }, weight: 10 }],
    ['case-B', { id: 'case-B', dimensions: { length: 24, width: 24, height: 24 }, weight: 10 }],
  ]);
  const getCaseById = id => casesById.get(id) || null;
  const isStale = (pack, results) => !EditorScreen.getAppliedAutoPackOption(pack, results, getCaseById);
  const pack = makeStalenessAuditPack();
  const signature = Engine.buildAutoPackResultSignature(pack);
  const results = {
    packId: pack.id,
    caseRuleSignature: Engine.buildAutoPackCaseRuleSignature(pack, getCaseById),
    options: [{ id: 'max-capacity', signature, layoutSignature: Engine.buildAutoPackLayoutSignature(pack) }],
  };

  const movedStaged = structuredClone(pack);
  movedStaged.cases[1].transform.position.x += 40;
  movedStaged.cases[1].transform.rotation.y = Math.PI / 2;
  movedStaged.cases[1].orientedDims = { length: 24, width: 12, height: 24 };
  assert.equal(isStale(movedStaged, results), false,
    'the production comparison must not show Outdated after staged-only pose edits');

  const movedPacked = structuredClone(pack);
  movedPacked.cases[0].transform.position.x += 1;
  assert.equal(isStale(movedPacked, results), true,
    'the production comparison must still show Outdated after a packed edit');

  const stagedIntoTruck = structuredClone(pack);
  stagedIntoTruck.cases[1].placement = 'packed';
  assert.equal(isStale(stagedIntoTruck, results), true,
    'the production comparison must show Outdated after staged-to-packed membership changes');
});

function makeAutoPackStagingItem(id, caseData, rotation = { x: 0, y: 0, z: 0 }) {
  return {
    inst: {
      id,
      caseId: caseData.id,
      hidden: false,
      placement: 'packed',
      packedProfile: 'max-capacity',
      transform: {
        position: { x: 20, y: 10, z: 0 },
        rotation,
        scale: { x: 1, y: 1, z: 1 },
      },
      orientedDims: { length: 999, width: 998, height: 997 },
    },
    caseData,
    orientations: [{
      l: caseData.dimensions.height,
      w: caseData.dimensions.length,
      h: caseData.dimensions.width,
      rotX: Math.PI / 2,
      rotY: 0,
      rotZ: Math.PI / 2,
    }],
  };
}

function autoPackStagedAabb(staged) {
  const dims = staged.orientedDims;
  const position = staged.position;
  return {
    min: {
      x: position.x - dims.length / 2,
      y: position.y - dims.height / 2,
      z: position.z - dims.width / 2,
    },
    max: {
      x: position.x + dims.length / 2,
      y: position.y + dims.height / 2,
      z: position.z + dims.width / 2,
    },
  };
}

function autoPackStagedAabbsOverlap(a, b, tolerance = 1e-9) {
  return a.min.x < b.max.x - tolerance && a.max.x > b.min.x + tolerance &&
    a.min.y < b.max.y - tolerance && a.max.y > b.min.y + tolerance &&
    a.min.z < b.max.z - tolerance && a.max.z > b.min.z + tolerance;
}

test('C5B staging reserves authored, hidden and excluded footprints before any new allocation', async () => {
  const [Engine, PackLibrary] = await Promise.all([import(enginePath.href), import(packLibraryPath.href)]);
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
  const caseData = { id: 'c', dimensions: { length: 30, width: 10, height: 20 } };
  const incoming = makeAutoPackStagingItem('incoming', caseData);
  const authored = makeAutoPackStagingItem('authored', caseData, { x: 0, y: Math.PI / 2, z: 0 });
  authored.inst.placement = 'staged';
  authored.inst.transform.position = { x: 15, y: 10, z: 57 };
  const hidden = structuredClone(authored);
  hidden.inst.id = 'hidden';
  hidden.inst.hidden = true;
  hidden.inst.transform.position.x = 57;
  const excluded = structuredClone(authored);
  excluded.inst.id = 'excluded';
  excluded.inst.transform.position.x = 99;
  const sourceItems = [incoming, authored, hidden, excluded];
  const before = structuredClone(sourceItems);
  const options = { sourceItems, excludedIds: new Set(['excluded']) };
  const map = Engine.buildAutoPackStagingMap([incoming, authored, excluded], truck,
    PackLibrary.findSafeStagingPosition, options);
  assert.deepEqual(map.get('authored'), {
    position: authored.inst.transform.position, rotation: authored.inst.transform.rotation,
    orientedDims: { length: 10, width: 30, height: 20 },
  }, 'authored staging keeps its transform and derives bounds from actual rotation, never the stale cache');
  for (const item of [authored, hidden, excluded]) {
    assert.equal(autoPackStagedAabbsOverlap(autoPackStagedAabb(map.get('incoming')), autoPackStagedAabb({
      position: item.inst.transform.position, orientedDims: { length: 10, width: 30, height: 20 },
    })), false, `newly staged cargo avoids ${item.inst.id}`);
  }
  assert.equal(map.has('hidden'), false, 'hidden poses are reserved without taking mutation ownership');
  assert.equal(map.has('excluded'), false, 'excluded poses are reserved without taking mutation ownership');
  const reversed = Engine.buildAutoPackStagingMap([excluded, authored, incoming], truck,
    PackLibrary.findSafeStagingPosition, { ...options, sourceItems: [...sourceItems].reverse() });
  assert.deepEqual([...reversed].sort(), [...map].sort(), 'reservation and allocation are independent of item order');
  const next = Engine.buildAutoPackNextCases(sourceItems.map(item => item.inst), new Map(), new Map(), new Map(), map, options.excludedIds);
  assert.deepEqual(next[2], hidden.inst, 'hidden source is byte-equivalent');
  assert.deepEqual(next[3], excluded.inst, 'excluded source is byte-equivalent');
  assert.deepEqual(sourceItems, before, 'allocation never mutates source data');
});

test('C5B unsafe eligible staging falls back without guessing unresolved geometry or resetting authored rotation', async () => {
  const [Engine, PackLibrary, Editor] = await Promise.all([
    import(enginePath.href), import(packLibraryPath.href), import(editorScreenPath.href),
  ]);
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
  const caseData = { id: 'c', dimensions: { length: 30, width: 10, height: 20 } };
  const unsafe = makeAutoPackStagingItem('unsafe', caseData, { x: Math.PI / 2, y: 0, z: Math.PI / 2 });
  unsafe.inst.placement = 'staged';
  unsafe.inst.transform.position = { x: 50, y: 90, z: 100 };
  const missing = { inst: { ...structuredClone(unsafe.inst), id: 'missing', caseId: 'deleted' }, caseData: null };
  const malformed = { inst: { ...structuredClone(unsafe.inst), id: 'malformed' },
    caseData: { ...caseData, dimensions: { ...caseData.dimensions, length: Infinity } } };
  const invalidRotation = structuredClone(unsafe);
  invalidRotation.inst.id = 'invalid-rotation';
  invalidRotation.inst.transform.rotation.x = 0.3;
  const invalidPackedRotation = structuredClone(invalidRotation);
  invalidPackedRotation.inst.id = 'invalid-packed-rotation';
  invalidPackedRotation.inst.placement = 'packed';
  const invalidPosition = structuredClone(unsafe);
  invalidPosition.inst.id = 'invalid-position';
  invalidPosition.inst.transform.position.x = NaN;
  const items = [unsafe, missing, malformed, invalidRotation, invalidPosition, invalidPackedRotation];
  const source = items.map(item => item.inst);
  const before = structuredClone(source);
  const map = Engine.buildAutoPackStagingMap(items, truck, PackLibrary.findSafeStagingPosition);
  for (const item of [unsafe, invalidPosition]) {
    const pose = map.get(item.inst.id);
    assert.deepEqual(pose.rotation, item.inst.transform.rotation, 'fallback retains a trustworthy authored rotation');
    assert.deepEqual(pose.orientedDims, { length: 20, width: 30, height: 10 });
    assert.equal(pose.position.y, 5, 'fallback is grounded');
    assert.ok(pose.position.z - pose.orientedDims.width / 2 > truck.width / 2);
  }
  assert.equal(autoPackStagedAabbsOverlap(...[...map.values()].map(autoPackStagedAabb)), false);
  for (const item of [missing, malformed, invalidRotation, invalidPackedRotation]) assert.equal(map.has(item.inst.id), false,
    `${item.inst.id}: no invented footprint or staging pose`);
  const next = Engine.buildAutoPackNextCases(source, new Map(), new Map(), new Map(), map);
  for (const index of [1, 2, 3, 5]) assert.deepEqual(next[index], source[index], 'unresolved source stays exact');
  const applied = Editor.buildAppliedAutoPackCases({ id: 'default', nextCases: next,
    movableIds: ['unsafe', 'invalid-position'], stagingSourceSignatures: Object.fromEntries(source
      .map(inst => [inst.id, Engine.buildAutoPackSourceSignature({ cases: [inst] })])) }, structuredClone, source);
  assert.deepEqual(applied, next, 'normal Apply carries the exact resolved atomic staging poses');
  assert.deepEqual(source, before, 'fallback does not rewrite source');
});

test('C5B candidate materialization and Apply retain unresolved instances without acquiring staging ownership', async () => {
  const [Engine, Editor, PackLibrary, engineSource] = await Promise.all([
    import(enginePath.href), import(editorScreenPath.href), import(packLibraryPath.href), fs.readFile(enginePath, 'utf8'),
  ]);
  const caseData = { id: 'malformed', dimensions: { length: 0, width: 10, height: 20 }, weight: null };
  const missing = { id: 'missing', caseId: 'deleted', placement: 'staged', hidden: false,
    packedProfile: 'max-capacity', transform: { position: { x: -40, y: 7, z: 80 }, rotation: { x: 0.3, y: 0, z: 0 } },
    orientedDims: { length: 99, width: 98, height: 97 }, notes: 'unresolved source' };
  const malformed = { ...structuredClone(missing), id: 'malformed', caseId: caseData.id };
  const pack = { id: 'p', truck: { length: 120, width: 60, height: 60, shapeMode: 'rect', shapeConfig: {} },
    cases: [missing, malformed] };
  const dependencies = {
    buildAutoPackNextCases: Engine.buildAutoPackNextCases,
    getSolutionLabel: solution => solution.id, getSolutionDescription: () => '',
    PackLibrary: { computeStats: subject => PackLibrary.computeStats(subject, [caseData]) },
    CaseLibrary: { getCases: () => [caseData] },
    assessNormalAutoPackCandidate: Engine.assessNormalAutoPackCandidate,
    buildAutoPackSourceSignature: Engine.buildAutoPackSourceSignature,
    buildAutoPackResultSignature: Engine.buildAutoPackResultSignature,
    buildAutoPackLayoutSignature: Engine.buildAutoPackLayoutSignature,
    cloneForAutoPackResults: structuredClone,
  };
  const buildOption = new Function(...Object.keys(dependencies),
    `${sliceFn(engineSource, 'function buildAutoPackResultOption(', 'function buildAutoPackResultsState(')}\nreturn buildAutoPackResultOption;`)(...Object.values(dependencies));
  const option = buildOption({ id: 'default', placements: new Map(), unpacked: ['malformed'] },
    0, pack, new Map(), new Set(['malformed']), new Set(['missing']));
  assert.deepEqual(option.nextCases, pack.cases, 'candidate keeps unresolved source geometry and metadata exactly');
  assert.deepEqual(option.movableIds, [], 'no guessed geometry earns mutation authority');
  assert.deepEqual(option.stagingSourceSignatures, {});
  assert.deepEqual(Editor.buildAppliedAutoPackCases(option, structuredClone, pack.cases), pack.cases,
    'Apply cannot reset rotation, dimensions, profile or instance membership');
});

test('AUTOPACK-STAGING identity pose ignores prior and candidate rotations', async () => {
  const Engine = await import(`${enginePath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = {
    id: 'staging-case',
    name: 'Staging Case',
    dimensions: { length: 30, width: 20, height: 10 },
    orientationLock: 'onSide',
    canFlip: true,
  };
  const identityPrior = makeAutoPackStagingItem('identity-prior', caseData);
  const rotatedPrior = makeAutoPackStagingItem(
    'rotated-prior',
    caseData,
    { x: 0, y: Math.PI / 2, z: 0 }
  );

  for (const item of [identityPrior, rotatedPrior]) {
    const pose = Engine.buildStagedPose(item);
    assert.deepEqual(pose.rotation, { x: 0, y: 0, z: 0 },
      'newly staged packed cargo uses identity staging rotation');
    assert.deepEqual(pose.dims, caseData.dimensions,
      'staging dimensions must derive from the identity rotation and real case dimensions');
    assert.notDeepEqual(pose.rotation, {
      x: item.orientations[0].rotX,
      y: item.orientations[0].rotY,
      z: item.orientations[0].rotZ,
    }, 'the solver/item-prep candidate rotation must not leak into staged rendering');
  }

  assert.equal(Engine.buildStagedPose({ caseData: null }), null,
    'unresolved case references must not receive fabricated staging geometry');
});

test('AUTOPACK-STAGING rows are aligned, grounded, non-overlapping, deterministic, and truck-mode safe', async () => {
  const [Engine, PackLibrary] = await Promise.all([
    import(`${enginePath.href}?t=${Date.now()}-${Math.random()}`),
    import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`),
  ]);
  const caseData = {
    id: 'uniform-staging-case',
    name: 'Uniform Staging Case',
    dimensions: { length: 20, width: 10, height: 12 },
    orientationLock: 'any',
    canFlip: true,
  };
  const items = Array.from({ length: 7 }, (_, index) => makeAutoPackStagingItem(
    `staged-${String(index).padStart(2, '0')}`,
    caseData,
    index % 2 ? { x: 0, y: Math.PI / 2, z: 0 } : { x: 0, y: 0, z: 0 }
  ));
  const trucks = [
    { length: 84, width: 60, height: 60, shapeMode: 'rect' },
    { length: 84, width: 60, height: 60, shapeMode: 'wheelWells' },
    { length: 84, width: 60, height: 60, shapeMode: 'frontBonus' },
  ];
  const maps = trucks.map(truck => Engine.buildAutoPackStagingMap(
    items,
    truck,
    PackLibrary.findSafeStagingPosition
  ));
  const serialize = map => JSON.stringify(Array.from(map.entries()));
  assert.equal(serialize(maps[1]), serialize(maps[0]),
    'Wheel Wells must use the same external staged-leftover pose as Standard');
  assert.equal(serialize(maps[2]), serialize(maps[0]),
    'Front Overhang must use the same external staged-leftover pose as Standard');
  const repeated = Engine.buildAutoPackStagingMap(items, trucks[0], PackLibrary.findSafeStagingPosition);
  assert.equal(serialize(repeated), serialize(maps[0]),
    'repeating the same AutoPack staging input must produce byte-equivalent poses');

  const staged = [...maps[0].values()];
  assert.equal(staged.length, 7);
  assert.equal(staged.every(pose => JSON.stringify(pose.rotation) === JSON.stringify({ x: 0, y: 0, z: 0 })), true,
    'mixed prior/candidate rotations must stage uniformly');
  assert.equal(staged.every(pose => JSON.stringify(pose.orientedDims) === JSON.stringify(caseData.dimensions)), true,
    'every staged footprint must match the identity render pose');
  assert.equal(staged.every(pose => pose.position.y - pose.orientedDims.height / 2 === 0), true,
    'every staged case bottom must rest on the staging ground');
  assert.equal(staged.every(pose => pose.position.z - pose.orientedDims.width / 2 > trucks[0].width / 2), true,
    'every staged case must remain outside the truck width');

  const rows = new Map();
  for (const pose of staged) {
    if (!rows.has(pose.position.z)) rows.set(pose.position.z, []);
    rows.get(pose.position.z).push(pose.position.x);
  }
  assert.deepEqual([...rows.values()].map(xs => xs.sort((a, b) => a - b)), [
    [10, 42, 74],
    [10, 42, 74],
    [10],
  ], 'staged leftovers must use aligned uniform rows and a same-origin partial row');

  const aabbs = staged.map(autoPackStagedAabb);
  for (let left = 0; left < aabbs.length; left += 1) {
    for (let right = left + 1; right < aabbs.length; right += 1) {
      assert.equal(autoPackStagedAabbsOverlap(aabbs[left], aabbs[right]), false,
        `staged AABBs ${left} and ${right} must not overlap`);
    }
  }
});

test('AUTOPACK-STAGING Results preview and Apply share poses while packed solver output stays exact', async () => {
  const [Engine, EditorScreen] = await Promise.all([
    import(`${enginePath.href}?t=${Date.now()}-${Math.random()}`),
    import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`),
  ]);
  const packedPosition = { x: 80, y: 6, z: 0 };
  const packedRotation = { x: 0, y: Math.PI / 2, z: 0 };
  const packedDims = { length: 10, width: 20, height: 12 };
  const stagedPose = {
    position: { x: 10, y: 6, z: 42 },
    rotation: { x: 0, y: 0, z: 0 },
    orientedDims: { length: 20, width: 10, height: 12 },
  };
  const sourceCases = [
    {
      id: 'packed', caseId: 'case-a', hidden: false, placement: 'staged',
      transform: { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    },
    {
      id: 'staged', caseId: 'case-a', hidden: false, placement: 'packed', packedProfile: 'max-capacity',
      transform: { position: { x: 2, y: 2, z: 2 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } },
      orientedDims: { length: 12, width: 20, height: 10 },
    },
    {
      id: 'unresolved', caseId: 'missing', hidden: false, placement: 'packed', packedProfile: 'max-capacity',
      transform: { position: { x: 3, y: 3, z: 3 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
      orientedDims: { length: 99, width: 98, height: 97 },
    },
  ];
  const previewCases = Engine.buildAutoPackNextCases(
    sourceCases,
    new Map([['packed', packedPosition]]),
    new Map([['packed', packedRotation]]),
    new Map([['packed', packedDims]]),
    new Map([['staged', stagedPose]])
  );

  assert.deepEqual(previewCases[0].transform.position, packedPosition,
    'packed position must remain exact solver output');
  assert.deepEqual(previewCases[0].transform.rotation, packedRotation,
    'packed rotation must remain exact solver output');
  assert.deepEqual(previewCases[0].orientedDims, packedDims,
    'packed dimensions must remain exact solver output');
  assert.deepEqual({
    position: previewCases[1].transform.position,
    rotation: previewCases[1].transform.rotation,
    orientedDims: previewCases[1].orientedDims,
  }, stagedPose, 'the Results staged pose must persist position, rotation, and dimensions atomically');

  const normalApplied = EditorScreen.buildAppliedAutoPackCases(
    { id: 'default', nextCases: previewCases },
    value => structuredClone(value)
  );
  const maxApplied = EditorScreen.buildAppliedAutoPackCases(
    { id: 'max-capacity', nextCases: previewCases },
    value => structuredClone(value)
  );
  for (const applied of [normalApplied, maxApplied]) {
    assert.deepEqual({
      position: applied[1].transform.position,
      rotation: applied[1].transform.rotation,
      orientedDims: applied[1].orientedDims,
    }, stagedPose, 'Apply must save the exact staged pose shown by Results');
    assert.equal(Object.hasOwn(applied[1], 'packedProfile'), false,
      'staged leftovers must never retain a Max Capacity profile');
  }
  assert.equal(maxApplied[0].packedProfile, 'max-capacity',
    'a packed Max Capacity placement must retain the applied profile');
  assert.equal(Object.hasOwn(normalApplied[0], 'packedProfile'), false,
    'normal strategy packed placements must remain unmarked');

  assert.deepEqual(previewCases[2].transform, sourceCases[2].transform,
    'unresolved instances without a staging pose must keep their transform');
  assert.deepEqual(previewCases[2].orientedDims, sourceCases[2].orientedDims,
    'unresolved instances must not receive fabricated dimensions');
  assert.deepEqual(previewCases[2], sourceCases[2],
    'an unresolved instance with no staging pose stays byte-equivalent, including metadata');
});

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

test('AUTOPACK-CAROUSEL portfolio dedupe uses physical layout rather than interchangeable instance ids', async () => {
  const Engine = await import(enginePath.href);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'rect' };
  const a = { truck, cases: [makeAuditInstance('a', 'c', 20, 12, 0), makeAuditInstance('b', 'c', 50, 12, 0)] };
  const b = { truck, cases: [makeAuditInstance('b', 'c', 20, 12, 0), makeAuditInstance('a', 'c', 50, 12, 0)] };
  const option = (id, pack) => ({ id, signature: Engine.buildAutoPackResultSignature(pack),
    layoutSignature: Engine.buildAutoPackLayoutSignature(pack), assessment: { primary: 'VALID', eligibility: { state: 'eligible' } } });
  const raw = [option('default', a), option('compact-fill', b)];
  assert.notEqual(raw[0].signature, raw[1].signature);
  const result = Engine.deduplicateAutoPackResultOptions(raw);
  assert.deepEqual(result.options.map(o => o.id), ['default']);
  assert.equal(result.deduplicatedSolutionCount, 1);
});

test('AUTOPACK-MAX-A stays distinct from a normal result with the same physical layout', async () => {
  const Engine = await import(enginePath.href);
  const normal = { id: 'default', layoutSignature: 'same-layout', assessment: { primary: 'VALID', eligibility: { state: 'eligible' } } };
  const max = { id: 'max-capacity', layoutSignature: 'same-layout', assessment: null };
  const result = Engine.deduplicateAutoPackResultOptions([normal, max]);
  assert.deepEqual(result.options.map(o => o.id), ['default', 'max-capacity']);
  assert.equal(result.deduplicatedSolutionCount, 0);
  assert.equal(Engine.selectPreferredNormalAutoPackOption(result.options), normal);
});

test('C5A dedupe preserves meaningful assessment and fixed ownership while preference ignores packed count', async () => {
  const Engine = await import(enginePath.href);
  const valid = { primary: 'VALID', eligibility: { state: 'eligible' } };
  const incomplete = property => ({ primary: 'INCOMPLETE', eligibility: { state: 'eligible' },
    hard: [{ property, outcome: 'UNRESOLVED', subject: 'arbitrary-instance-id' }] });
  const option = (id, assessment, fixedLayoutSignature = 'fixed-A') => ({ id, assessment, fixedLayoutSignature,
    packedCount: id === 'default' ? 1 : 20, layoutSignature: 'same-layout' });
  const raw = [option('default', valid), option('compact-fill', valid),
    option('floor-first', incomplete('source.case')), option('stack-priority', incomplete('load.equilibrium')),
    option('max-capacity', null), option('constrained-first', valid, 'fixed-B')];
  const result = Engine.deduplicateAutoPackResultOptions(raw);
  assert.deepEqual(result.options.map(o => o.id), ['default', 'floor-first', 'stack-priority', 'max-capacity', 'constrained-first']);
  assert.equal(result.deduplicatedSolutionCount, 1);
  assert.equal(Engine.selectPreferredNormalAutoPackOption(result.options).id, 'default');
  const unknown = option('default', incomplete('load.equilibrium'));
  assert.equal(Engine.selectPreferredNormalAutoPackOption([unknown, option('floor-first', valid)]), unknown);
});

test('AUTOPACK-CAROUSEL stale Apply button carries a reachable title and aria-label explanation', async () => {
  const { render } = await renderBlock();
  const optionBlock = sliceFn(render, 'const isViewedCurrent = viewedOption === currentOption;', 'panel.appendChild(body);');

  assert.match(optionBlock, /if \(stale\) \{\s*\n\s*const staleReason = /,
    'the disabled-but-not-applied case (stale) must set an explanatory reason');
  assert.match(optionBlock, /apply\.title = staleReason;/,
    'the stale Apply button must carry a hover tooltip explaining why it is disabled');
  assert.match(optionBlock, /apply\.setAttribute\('aria-label', `Apply this option\. \$\{staleReason\}`\);/,
    'the stale Apply button must retain its visible label and explain why it is disabled');
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
  const apply = sliceFn(src, 'function applyAutoPackResultOption(optionId, expectedRunId)', 'function makeAutoPackResultStat(');

  assert.match(apply, /OperationLifecycle\.isBusy\(\)/,
    'apply must check the operation lifecycle before mutating the pack');
  assert.match(apply, /Wait for the current operation to finish before applying AutoPack results\./,
    'the busy rejection must explain itself with a toast');
  const busyIdx = apply.indexOf('OperationLifecycle.isBusy()');
  const staleIdx = apply.indexOf('isAutoPackResultsStale(pack, results, option)');
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

test('AUTOPACK-RESULTS Balanced leads and Max Capacity displays second while ranking, selection and the raw order stay standard-only', async () => {
  const [Solution, EditorScreen] = await Promise.all([import(solutionPath.href), import(editorScreenPath.href)]);
  const fixtures = [
    { truck: { length: 240, width: 96, height: 96, shapeMode: 'rect' },
      display: ['default', 'max-capacity', 'compact-fill', 'floor-first', 'stack-priority'] },
    { truck: { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' },
      display: ['default', 'max-capacity', 'compact-fill', 'floor-first', 'stack-priority', 'constrained-first'] },
  ];
  for (const { truck, display } of fixtures) {
    const { result } = runAdaptiveAudit(Solution, truck, {
      packedCounts: { default: 2, 'compact-fill': 2, 'floor-first': 1, 'stack-priority': 3, 'max-capacity': 99 },
    });
    const rawIds = result.solutions.map(solution => solution.id);
    assert.deepEqual(EditorScreen.orderAutoPackResultOptions(result.solutions).map(solution => solution.id), display,
      `${truck.shapeMode}: Balanced, Max Capacity, then the other standard plans in solver order`);
    assert.deepEqual(result.solutions.map(solution => solution.id), rawIds, 'display ordering does not mutate the solution list');
    assert.equal(rawIds.indexOf('max-capacity'), 4, 'the raw solver order (dedupe input) still lists Max Capacity after the standard portfolio');
    assert.equal(result.selected, 'stack-priority', 'Max Capacity packing far more is still never auto-selected');
    assert.equal(result.selectedSolution.id, 'stack-priority', 'the core search hint remains independent from C5A assessed adoption');
  }
  assert.deepEqual(EditorScreen.orderAutoPackResultOptions([{ id: 'default' }, { id: 'compact-fill' }]).map(option => option.id),
    ['default', 'compact-fill'], 'without Max Capacity the solver order is unchanged');
  assert.deepEqual(EditorScreen.orderAutoPackResultOptions([{ id: 'compact-fill' }, { id: 'floor-first' }, { id: 'max-capacity' }])
    .map(option => option.id), ['compact-fill', 'max-capacity', 'floor-first'],
  'when Balanced was deduped away, the first standard plan in solver order leads');
  assert.deepEqual(EditorScreen.orderAutoPackResultOptions([{ id: 'max-capacity' }]).map(option => option.id), ['max-capacity']);
  assert.deepEqual(EditorScreen.orderAutoPackResultOptions(undefined), []);
});

test('AUTOPACK-RESULTS Recommended follows the run selectedId, stays independent of Applied, and Max Capacity warns in visible text', async () => {
  const { render } = await renderBlock();
  const optionBlock = sliceFn(render, 'const isViewedCurrent = viewedOption === currentOption;', 'panel.appendChild(body);');
  assert.match(optionBlock,
    /const isViewedRecommended = viewedOption\.id === results\.selectedId && viewedOption\.id !== 'max-capacity' &&/,
    'Recommended is the preferred VALID eligible normal result and can never be Max Capacity');
  assert.match(optionBlock,
    /if \(isViewedRecommended\) \{\s*badges\.appendChild\(makeAutoPackResultPill\('tp3d-autopack-results__recommended-pill', 'Recommended'\)\);\s*\}/,
    'Recommended renders as its own text badge');
  assert.match(optionBlock,
    /if \(isViewedCurrent\) \{\s*badges\.appendChild\(makeAutoPackResultPill\('tp3d-autopack-results__current-pill', 'Applied', 'fa-solid fa-check'\)\);\s*\}/,
    'Applied renders independently, so Recommended and Applied may sit on different plans or together');
  const relaxed = sliceFn(optionBlock, "if (viewedOption.id === 'max-capacity') {", 'const actions = document.createElement');
  assert.match(relaxed, /'Handling rules relaxed\. Review before transport\.'/, 'the relaxed-handling warning is visible text');
  assert.doesNotMatch(relaxed, /\.title =|aria-label/, 'the warning meaning does not live only in a tooltip or label');
  assert.doesNotMatch(render, /Max Capacity profile|maxCapacityChip/, 'the redundant Max Capacity profile count chip is gone');
  assert.doesNotMatch(render, /normal transport recommendation/i);
});

test('AUTOPACK-MAX-A preset metadata is exact and flows through the existing Results description path', async () => {
  const Solution = await import(solutionPath.href);
  const maxCapacity = Solution.getPackingStrategy('max-capacity');

  assert.ok(maxCapacity, 'Max Capacity must be a registered packing strategy');
  assert.equal(maxCapacity.label, 'Max Capacity');
  assert.equal(maxCapacity.description, 'Relaxed handling comparison');
  assert.equal(Solution.getPackingStrategy('default').label, 'Balanced',
    'Recommended is a per-run badge, never hard-coded into the Balanced label');
  for (const preset of Solution.PACKING_STRATEGIES) {
    assert.doesNotMatch(`${preset.label} ${preset.description}`, /recommend/i,
      `${preset.id} copy makes no recommendation or transport claim`);
  }
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
  assert.match(render, /if \(!hasAlternates && !viewedOption\.assessment && currentOption\) \{/,
    'the compact description must be scoped to the single-option mode');
});

test('AUTOPACK-CAROUSEL Floor/Stacked stay solver diagnostics off the Results card and the Partial pill explains itself', async () => {
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
  assert.doesNotMatch(render, /'Floor'|'Stacked'|floorCount|stackedCount|makeAutoPackResultChip|stat-chip/,
    'frozen solver-provenance Floor/Stacked values are not presented on the Results card');
  assert.match(render, /const partialReason = formatAutoPackPartialReason\(viewedOption\);/,
    'a partial option must derive a readable reason');
  assert.match(render, /status\.title = partialReason;/,
    'the Partial pill must carry the reason as a hover tooltip');
  assert.match(render, /status\.setAttribute\('aria-label', `Partial\. \$\{partialReason\}`\);/,
    'the Partial pill label and reason must also be accessible');
});

test('AUTOPACK-CAROUSEL dedupe-collapsed results explain that other strategies produced the same layout', async () => {
  const { render } = await renderBlock();
  assert.match(render, /results\.deduplicatedSolutionCount > 0 : Number\(results\.attemptedSolutionCount\) > options\.length/,
    'the note must appear only in single-option mode, where the collapse genuinely needs explaining');
  assert.match(render, /dedupeNote\.textContent = 'Other strategies produced the same layout\.';/,
    'the note must carry the agreed copy');

  const css = await fs.readFile(stylesPath, 'utf8');
  assert.match(css, /\.tp3d-autopack-results__dedupe-note \{/, 'the dedupe note must have panel styling');
  assert.match(css, /\.tp3d-autopack-results__option-desc \{/, 'the description line must have panel styling');
  assert.equal(css.includes('tp3d-autopack-results__stat-chip'), false, 'the removed metric chips leave no styling behind');
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

function resultsSyncPack(id, packedX, stagedX = 100) {
  return {
    id: 'results-sync-pack',
    truck: { length: 240, width: 96, height: 96, shapeMode: 'rect' },
    editorView: { camera: id },
    cases: [
      { id: 'packed', caseId: 'case-A', placement: packedX === null ? 'staged' : 'packed',
        transform: { position: { x: packedX ?? 5, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        orientedDims: { length: 24, width: 24, height: 24 }, notes: 'original' },
      { id: 'staged', caseId: 'case-A', placement: 'staged',
        transform: { position: { x: stagedX, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        orientedDims: { length: 24, width: 24, height: 24 }, notes: 'original' },
    ],
  };
}

async function resultsSyncFixture({ maxCapacity = false } = {}) {
  const [Engine, EditorScreen, StateStore, source] = await Promise.all([
    import(enginePath.href), import(editorScreenPath.href),
    import(new URL('../../src/core/state-store.js', import.meta.url).href),
    fs.readFile(editorScreenPath, 'utf8'),
  ]);
  const caseData = { id: 'case-A', dimensions: { length: 24, width: 24, height: 24 }, weight: 10,
    shape: 'box', orientationLock: 'upright' };
  const getCaseById = id => id === caseData.id ? caseData : null;
  const pre = resultsSyncPack('view', null);
  const winner = resultsSyncPack('view', 20);
  const alternate = resultsSyncPack('view', 60, 120);
  const option = (id, pack) => ({
    id,
    nextCases: structuredClone(pack.cases),
    signature: Engine.buildAutoPackResultSignature(pack, id === 'max-capacity' ? 'max-capacity' : null),
    layoutSignature: Engine.buildAutoPackLayoutSignature(pack),
  });
  const options = [option('default', winner), option(maxCapacity ? 'max-capacity' : 'floor-first', alternate)];
  const results = {
    runId: 'run-A', packId: winner.id, options,
    selectedId: options[0].id, currentSignature: options[0].signature,
    caseRuleSignature: Engine.buildAutoPackCaseRuleSignature(winner, getCaseById),
    viewIndex: 0,
  };
  StateStore.init({ currentPackId: winner.id, currentScreen: 'editor',
    selectedInstanceIds: ['packed'], packLibrary: [pre], caseLibrary: [caseData] });
  StateStore.set({ packLibrary: [winner] }); // The already committed AutoPack winner.
  StateStore.set({ autoPackResults: results }, { skipHistory: true });
  const writes = [];
  const notifications = [];
  const unsubscribe = StateStore.subscribe((changes, state) => {
    notifications.push({ keys: Object.keys(changes), selection: [...(state.selectedInstanceIds || [])] });
  });
  const PackLibrary = {
    getById: id => StateStore.get('packLibrary').find(pack => pack.id === id) || null,
    buildHandlingRulesValiditySignature: () => 'validated',
    update: (id, patch) => {
      writes.push({ id, patch });
      const pack = PackLibrary.getById(id);
      const next = { ...pack, ...structuredClone(patch) };
      StateStore.set({ packLibrary: [next] });
      return next;
    },
  };
  const applied = () => EditorScreen.getAppliedAutoPackOption(PackLibrary.getById(winner.id), StateStore.get('autoPackResults'), getCaseById);
  const applySource = sliceFn(source, 'function applyAutoPackResultOption(optionId, expectedRunId)', 'function makeAutoPackResultStat(');
  const apply = new Function('getAutoPackResultsState', 'OperationLifecycle', 'UIComponents', 'PackLibrary',
    'StateStore', 'isAutoPackResultsStale', 'getAppliedAutoPackOption', 'CaseLibrary',
    'buildAppliedAutoPackCases', 'cloneAutoPackCases', 'CaseScene', 'prepareNormalAutoPackResultApply',
    `${applySource}\nreturn applyAutoPackResultOption;`)(
    () => StateStore.get('autoPackResults'), { isBusy: () => false }, { showToast() {} }, PackLibrary,
    StateStore, (pack, result, option) => !Engine.isAutoPackResultsFresh(pack, result, getCaseById, { maxCapacity: option?.id === 'max-capacity' }),
    EditorScreen.getAppliedAutoPackOption, { getById: getCaseById, getCases: () => [caseData] },
    EditorScreen.buildAppliedAutoPackCases, structuredClone, { setSelected() {} }, EditorScreen.prepareNormalAutoPackResultApply
  );
  const patchSource = sliceFn(source, 'function patchAutoPackResultsState(patch, expectedRunId)', 'function isAutoPackResultsStale(');
  const patchResults = new Function('getAutoPackResultsState', 'StateStore', `${patchSource}\nreturn patchAutoPackResultsState;`)(
    () => StateStore.get('autoPackResults'), StateStore);
  return { Engine, EditorScreen, StateStore, pre, winner, alternate, options, results,
    getCaseById, applied, apply, patchResults, writes, notifications, unsubscribe, PackLibrary, caseData };
}

test('AUTOPACK-RESULTS live Pack controls Applied through Apply, Undo, Redo, and pre-run Undo', async () => {
  const f = await resultsSyncFixture();
  try {
    assert.equal(f.applied(), f.options[0], 'the committed winner is initially Applied');
    const before = structuredClone(f.PackLibrary.getById(f.winner.id));
    f.patchResults({ viewIndex: 1 }, 'run-A');
    assert.deepEqual(f.PackLibrary.getById(f.winner.id), before, 'browsing changes no Pack or camera');
    assert.equal(f.applied(), f.options[0], 'browsing B does not change Applied');
    assert.equal(f.notifications.filter(event => event.keys.includes('packLibrary')).length, 0,
      'browsing schedules no Pack preview or cargo history');
    f.apply(f.options[1].id, 'run-A');
    assert.equal(f.writes.length, 1, 'Apply commits exactly once');
    assert.equal(f.applied(), f.options[1]);
    assert.equal(f.StateStore.get('autoPackResults').selectedId, f.options[0].id,
      'legacy selectedId is no longer written as live authority');
    assert.deepEqual(f.StateStore.get('selectedInstanceIds'), []);
    assert.deepEqual(f.notifications.filter(event => event.keys.includes('packLibrary')).map(event => event.selection), [[]],
      'selection is cleared before the single cargo notification');
    assert.equal(f.PackLibrary.getById(f.winner.id).editorView.camera, 'view');
    assert.equal(f.StateStore.undo(), true);
    assert.equal(f.applied(), f.options[0], 'Undo truthfully marks A Applied');
    assert.equal(f.StateStore.redo(), true);
    assert.equal(f.applied(), f.options[1], 'Redo truthfully marks B Applied');
    assert.equal(f.StateStore.undo(), true);
    assert.equal(f.StateStore.undo(), true);
    assert.equal(f.applied(), null, 'pre-AutoPack layout matches no result');
    assert.equal(f.StateStore.redo(), true);
    assert.equal(f.applied(), f.options[0], 'Redo restores a current winner');
  } finally { f.unsubscribe(); }
});

test('AUTOPACK-RESULTS Apply preserves allowed staged pose and current metadata, but takes chosen packed/staged layout', async () => {
  const f = await resultsSyncFixture();
  try {
    const edited = structuredClone(f.winner);
    edited.cases[0].notes = 'edited after solve';
    edited.cases[1].notes = 'staged note';
    edited.cases[1].transform.position.x = 135;
    edited.cases[1].transform.rotation.y = Math.PI / 2;
    edited.cases[1].orientedDims = { length: 24, width: 12, height: 24 };
    f.StateStore.set({ packLibrary: [edited] });
    assert.equal(f.applied(), f.options[0], 'allowed edits keep Results current');
    f.apply(f.options[1].id, 'run-A');
    const [packed, staged] = f.PackLibrary.getById(f.winner.id).cases;
    assert.equal(packed.transform.position.x, 60, 'chosen packed solver pose wins');
    assert.equal(packed.notes, 'edited after solve', 'current metadata survives');
    assert.equal(staged.transform.position.x, 135, 'current staged position survives');
    assert.equal(staged.transform.rotation.y, Math.PI / 2, 'current staged rotation survives');
    assert.deepEqual(staged.orientedDims, { length: 24, width: 12, height: 24 });
    assert.equal(staged.notes, 'staged note');
    assert.equal(f.applied(), f.options[1]);

    const toStaging = { id: 'floor-first', nextCases: structuredClone(f.alternate.cases) };
    toStaging.nextCases[0].placement = 'staged';
    toStaging.nextCases[0].transform.position.x = 200;
    const changed = f.EditorScreen.buildAppliedAutoPackCases(toStaging, structuredClone, [packed, staged]);
    assert.equal(changed[0].transform.position.x, 200, 'packed-to-staged uses chosen safe staging pose');
    const missing = f.EditorScreen.buildAppliedAutoPackCases(toStaging, structuredClone, [packed]);
    assert.equal(missing, null, 'membership mismatch fails without a partial result');

    const toPacked = { id: 'floor-first', nextCases: structuredClone(f.alternate.cases) };
    toPacked.nextCases[1].placement = 'packed';
    toPacked.nextCases[1].transform.position.x = 75;
    toPacked.nextCases[1].orientedDims = { length: 12, width: 24, height: 24 };
    const packedAgain = f.EditorScreen.buildAppliedAutoPackCases(toPacked, structuredClone, [packed, staged]);
    assert.equal(packedAgain[1].transform.position.x, 75, 'staged-to-packed takes the solver pose');
    assert.equal(packedAgain[1].notes, 'staged note', 'staged-to-packed keeps current metadata');

    const mismatchedId = structuredClone([packed, staged]);
    mismatchedId[1].id = 'replacement';
    assert.equal(f.EditorScreen.buildAppliedAutoPackCases(toPacked, structuredClone, mismatchedId), null);
  } finally { f.unsubscribe(); }
});

test('AUTOPACK-RESULTS scope, truck, empty options, and significant edits fail closed', async () => {
  const f = await resultsSyncFixture();
  try {
    const pendingTruck = { ...f.winner.truck, length: 300 };
    assert.notDeepEqual(pendingTruck, f.PackLibrary.getById(f.winner.id).truck);
    assert.equal(f.applied(), f.options[0], 'an uncommitted form truck has no Results authority');
    const committedTruck = structuredClone(f.winner);
    committedTruck.truck.length = 300;
    f.StateStore.set({ packLibrary: [committedTruck] });
    assert.equal(f.applied(), null, 'a committed truck change stales Results');
    f.apply(f.options[1].id, 'run-A');
    assert.equal(f.writes.length, 0, 'stale Apply mutates nothing');

    f.StateStore.set({ packLibrary: [f.winner], currentPackId: 'another-pack' }, { skipHistory: true });
    assert.equal(f.EditorScreen.getAppliedAutoPackOption({ ...f.winner, id: 'another-pack' }, f.results, f.getCaseById), null,
      'Results cannot claim another Pack');
    f.apply(f.options[1].id, 'run-A');
    assert.equal(f.writes.length, 0, 'Pack switch cannot Apply old Results');
    f.StateStore.set({ currentPackId: f.winner.id }, { skipHistory: true });
    assert.equal(f.applied(), f.options[0], 'return to unchanged Pack restores valid Results');
    f.StateStore.set({ autoPackResults: { ...f.results, options: [] } }, { skipHistory: true });
    f.apply(f.options[1].id, 'run-A');
    assert.equal(f.writes.length, 0, 'zero options have no valid action');
    assert.equal(f.applied(), null);
    f.StateStore.set({ autoPackResults: { ...f.results, options: [f.options[0]] } }, { skipHistory: true });
    assert.equal(f.applied(), f.options[0], 'one option has an unambiguous applied state');
    f.StateStore.replace({ currentPackId: f.winner.id, currentScreen: 'editor',
      packLibrary: [f.winner], caseLibrary: [f.getCaseById('case-A')] }, { resetHistory: true });
    assert.equal(f.StateStore.get('autoPackResults'), undefined, 'workspace replacement carries no transient Results');
  } finally { f.unsubscribe(); }
});

test('AUTOPACK-RESULTS Max Capacity profiles, ambiguity, and old-run actions fail or resolve safely', async () => {
  const f = await resultsSyncFixture({ maxCapacity: true });
  try {
    f.apply('max-capacity', 'run-A');
    assert.equal(f.applied(), f.options[1]);
    assert.equal(f.PackLibrary.getById(f.winner.id).cases[0].packedProfile, 'max-capacity');
    assert.equal(Object.hasOwn(f.PackLibrary.getById(f.winner.id).cases[1], 'packedProfile'), false);
    f.StateStore.undo();
    assert.equal(f.applied(), f.options[0]);
    f.StateStore.redo();
    assert.equal(f.applied(), f.options[1]);
    f.apply('default', 'run-A');
    assert.equal(Object.hasOwn(f.PackLibrary.getById(f.winner.id).cases[0], 'packedProfile'), false);
    const writes = f.writes.length;
    f.StateStore.set({ autoPackResults: { ...f.results, runId: 'run-B' } }, { skipHistory: true });
    f.apply('max-capacity', 'run-A');
    f.patchResults({ viewIndex: 1, minimized: true, closed: true, position: { x: 2, y: 2 } }, 'run-A');
    assert.equal(f.writes.length, writes, 'old Apply cannot write into a new run');
    assert.equal(f.StateStore.get('autoPackResults').viewIndex, 0, 'old panel patches cannot alter a new run');

    const collision = structuredClone(f.winner);
    collision.cases[1].transform.position.x = 140;
    const a = { ...f.options[0], layoutSignature: f.Engine.buildAutoPackLayoutSignature(f.winner) };
    const b = { ...f.options[0], id: 'same-strict', layoutSignature: f.Engine.buildAutoPackLayoutSignature(collision) };
    const ambiguous = { ...f.results, options: [a, b] };
    assert.equal(f.EditorScreen.getAppliedAutoPackOption(f.winner, ambiguous, f.getCaseById), a,
      'an exact existing layout signature may disambiguate staged-pose collisions');
    const moved = structuredClone(f.winner);
    moved.cases[1].transform.position.x = 150;
    assert.equal(f.EditorScreen.getAppliedAutoPackOption(moved, ambiguous, f.getCaseById), null,
      'otherwise duplicate strict matches are stale, never guessed');
    f.StateStore.set({ packLibrary: [f.winner], autoPackResults: ambiguous }, { skipHistory: true });
    const beforeAmbiguousApply = f.writes.length;
    f.apply('same-strict', 'run-A');
    assert.equal(f.writes.length, beforeAmbiguousApply,
      'Apply refuses a strict-collision option that staged-pose preservation cannot distinguish');
  } finally { f.unsubscribe(); }
});

function reopenControl(f, source) {
  const syncSource = sliceFn(source, 'function syncAutoPackResultsReopen(pack, results, options)', 'function reopenAutoPackResults()');
  const reopenSource = sliceFn(source, 'function reopenAutoPackResults()', 'function clampAutoPackResultsPosition(');
  const button = { hidden: true, dataset: {} };
  const focused = [];
  const deps = ['resultsReopenBtn', 'getAutoPackResultsState', 'StateStore', 'patchAutoPackResultsState',
    'getAutoPackResultsHost', 'HTMLElement'];
  class FakeElement { focus() { focused.push('results-toggle'); } }
  const toggle = new FakeElement();
  const host = { querySelector: () => ({ querySelector: () => toggle }) };
  const make = body => new Function(...deps, body)(
    button, () => f.StateStore.get('autoPackResults'), f.StateStore, f.patchResults, () => host, FakeElement);
  return {
    button, focused, reopenSource,
    sync: make(`${syncSource}\nreturn syncAutoPackResultsReopen;`),
    reopen: make(`${reopenSource}\nreturn reopenAutoPackResults;`),
  };
}

test('AUTOPACK-RESULTS closed Results reopen the same run without rerunning AutoPack or touching the Pack', async () => {
  const f = await resultsSyncFixture();
  try {
    const source = await fs.readFile(editorScreenPath, 'utf8');
    const control = reopenControl(f, source);
    assert.doesNotMatch(control.reopenSource, /AutoPackEngine|PackLibrary|applyAutoPackResultOption|\.pack\(/,
      'reopening never reruns AutoPack, applies an option, or writes the Pack');
    const pack = f.PackLibrary.getById(f.winner.id);
    const open = f.StateStore.get('autoPackResults');
    control.sync(pack, open, open.options);
    assert.equal(control.button.hidden, true, 'open Results need no restore control');

    f.patchResults({ closed: true, minimized: true, position: { x: 30, y: 40 }, viewIndex: 1 }, 'run-A');
    const closed = f.StateStore.get('autoPackResults');
    control.sync(pack, closed, closed.options);
    assert.equal(control.button.hidden, false, 'closed Results for the current Pack show the restore control');
    assert.equal(control.button.dataset.runId, 'run-A', 'the control is bound to the closed run');

    const packBefore = f.StateStore.get('packLibrary');
    const packJson = JSON.stringify(packBefore);
    const seen = f.notifications.length;
    control.reopen();
    const reopened = f.StateStore.get('autoPackResults');
    assert.equal(reopened.closed, false, 'reopen clears closed');
    assert.equal(reopened.minimized, false, 'reopen expands the panel');
    assert.deepEqual(reopened.position, { x: 30, y: 40 }, 'the saved panel position is kept');
    assert.equal(reopened.viewIndex, 1, 'the browsed option is kept');
    assert.equal(reopened.runId, 'run-A', 'the same run is reopened');
    assert.equal(reopened.options, closed.options, 'the existing options are reused, not rebuilt');
    assert.equal(reopened.selectedId, closed.selectedId);
    assert.deepEqual(f.notifications.slice(seen).map(event => event.keys), [['autoPackResults']],
      'only the transient Results state changes: no Pack, autosave-relevant or history write');
    assert.equal(f.StateStore.get('packLibrary'), packBefore, 'the Pack library is the same object');
    assert.equal(JSON.stringify(f.StateStore.get('packLibrary')), packJson, 'no Pack field (including lastEdited) changed');
    assert.equal(f.writes.length, 0, 'no PackLibrary update ran');
    assert.equal(f.applied(), f.options[0], 'Applied derivation is unchanged');
    assert.deepEqual(control.focused, ['results-toggle'], 'focus moves into the reopened panel');
    assert.equal(f.StateStore.undo(), true);
    assert.equal(f.PackLibrary.getById(f.winner.id).cases[0].placement, 'staged',
      'Undo still steps back over the AutoPack commit: reopening added no history entry');
    f.StateStore.redo();

    f.patchResults({ closed: true }, 'run-A');
    f.StateStore.set({ autoPackResults: { ...f.StateStore.get('autoPackResults'), runId: 'run-B' } }, { skipHistory: true });
    control.reopen();
    assert.equal(f.StateStore.get('autoPackResults').closed, true, 'a control bound to an older run cannot reopen a newer one');
    const runB = f.StateStore.get('autoPackResults');
    control.sync(pack, runB, runB.options);
    f.StateStore.set({ currentPackId: 'another-pack' }, { skipHistory: true });
    control.reopen();
    assert.equal(f.StateStore.get('autoPackResults').closed, true, 'Results never reopen over another Pack');

    control.sync({ ...pack, id: 'another-pack' }, runB, runB.options);
    assert.equal(control.button.hidden, true, 'Results for another Pack show no restore control');
    control.sync(pack, runB, []);
    assert.equal(control.button.hidden, true, 'empty Results show no restore control');
    control.sync(null, runB, runB.options);
    assert.equal(control.button.hidden, true, 'no Pack, no restore control');
    control.sync(pack, null, []);
    assert.equal(control.button.hidden, true);
    assert.equal(control.button.dataset.runId, undefined, 'a hidden control carries no run');
  } finally { f.unsubscribe(); }
});

test('AUTOPACK-RESULTS-START starting view never changes selectedId, the Pack, Applied or ranking, and reopen keeps the viewed option', async () => {
  const f = await resultsSyncFixture({ maxCapacity: true });
  try {
    const [source, engineSrc, solutionSrc, harness] = await Promise.all([
      fs.readFile(editorScreenPath, 'utf8'), fs.readFile(enginePath, 'utf8'), fs.readFile(solutionPath, 'utf8'),
      startViewHarness('first'),
    ]);
    assert.doesNotMatch(`${engineSrc}\n${solutionSrc}`, /autoPackResultsStartView/,
      'the solver and Results builder never read the starting view');
    const current = () => f.StateStore.get('autoPackResults');
    const display = () => f.EditorScreen.orderAutoPackResultOptions(current().options);
    const viewed = () => harness.view(current(), display(), f.applied()).viewedOption.id;
    const pack = () => f.PackLibrary.getById(f.winner.id);
    assert.deepEqual(display().map(option => option.id), ['default', 'max-capacity'], 'Balanced leads, Max Capacity follows');
    // Apply Max Capacity first so Applied, Recommended and First differ.
    f.apply('max-capacity', 'run-A');
    assert.equal(f.applied().id, 'max-capacity');
    const writesBefore = f.writes.length;
    const packBefore = f.StateStore.get('packLibrary');
    const packJson = JSON.stringify(packBefore);
    const results = current();
    const resultsJson = JSON.stringify(results);
    const seen = f.notifications.length;

    const expected = { first: 'default', applied: 'max-capacity', recommended: 'default' };
    for (const [index, startView] of ['first', 'applied', 'recommended'].entries()) {
      harness.prefs.autoPackResultsStartView = startView;
      const run = { ...results, runId: `start-${index}`, viewIndex: undefined };
      assert.equal(harness.view(run, display(), f.applied()).viewedOption.id, expected[startView], startView);
    }
    assert.equal(current(), results, 'resolving the starting view writes no Results state');
    assert.equal(JSON.stringify(results), resultsJson, 'selectedId, options and their stored order are untouched');
    assert.equal(results.selectedId, 'default', 'the solver selectedId stays the standard plan');
    assert.deepEqual(results.options.map(option => option.id), ['default', 'max-capacity'],
      'the stored solver order keeps Max Capacity behind the standard plan (dedupe and ranking unchanged)');
    assert.equal(f.StateStore.get('packLibrary'), packBefore, 'the Pack library is the same object');
    assert.equal(JSON.stringify(f.StateStore.get('packLibrary')), packJson, 'committed Pack cargo is unchanged');
    assert.equal(f.writes.length, writesBefore, 'no PackLibrary update ran');
    assert.equal(f.notifications.length, seen, 'no state notification at all');
    assert.equal(f.applied().id, 'max-capacity', 'Applied matching is unchanged');

    // Browsed run: close and reopen keep the browsed option, not the preference.
    const control = reopenControl(f, source);
    harness.prefs.autoPackResultsStartView = 'first';
    f.patchResults({ viewIndex: undefined }, 'run-A');
    assert.equal(viewed(), 'default', 'run A opens on the First option');
    f.patchResults({ viewIndex: 1 }, 'run-A');
    assert.equal(viewed(), 'max-capacity');
    f.patchResults({ closed: true }, 'run-A');
    control.sync(pack(), current(), current().options);
    control.reopen();
    assert.equal(current().closed, false);
    assert.equal(current().viewIndex, 1, 'reopen keeps the browsed index');
    assert.equal(viewed(), 'max-capacity', 'reopen shows the browsed option instead of re-applying First option');

    // Unbrowsed run: reopened after the preference changes, it keeps its start.
    f.StateStore.set({ autoPackResults: { ...current(), runId: 'run-B', viewIndex: undefined } }, { skipHistory: true });
    harness.prefs.autoPackResultsStartView = 'applied';
    assert.equal(viewed(), 'max-capacity', 'run B opens on its Applied plan');
    f.patchResults({ closed: true }, 'run-B');
    harness.prefs.autoPackResultsStartView = 'first';
    control.sync(pack(), current(), current().options);
    control.reopen();
    assert.equal(current().closed, false);
    assert.equal(current().viewIndex, undefined, 'reopening writes no view index');
    assert.equal(viewed(), 'max-capacity', 'reopening an unbrowsed run keeps its starting option');
    assert.equal(f.writes.length, writesBefore, 'close and reopen never touched the Pack');
  } finally { f.unsubscribe(); }
});

// The production preview projection (with the shared resolver and start getter)
// over the real Results fixture, with a controllable operation.
function previewProjector(f, source, getOperation) {
  const deps = {
    getAutoPackResultsState: () => f.StateStore.get('autoPackResults'),
    orderAutoPackResultOptions: f.EditorScreen.orderAutoPackResultOptions,
    getAppliedAutoPackOption: f.EditorScreen.getAppliedAutoPackOption,
    CaseLibrary: { getById: f.getCaseById },
    PreferencesManager: { get: () => ({ autoPackResultsStartView: 'first' }) },
    resolveAutoPackResultsStartIndex: f.EditorScreen.resolveAutoPackResultsStartIndex,
    OperationLifecycle: { currentOperation: getOperation },
    StateStore: f.StateStore,
    buildAppliedAutoPackCases: f.EditorScreen.buildAppliedAutoPackCases,
    isAutoPackResultsFresh: f.Engine.isAutoPackResultsFresh,
    cloneAutoPackCases: structuredClone,
  };
  const body = [
    sliceFn(source, 'let autoPackResultsStart = null;', '// The single viewed-option resolution'),
    sliceFn(source, 'function resolveAutoPackResultsView(pack) {', '// Transient live preview'),
    sliceFn(source, 'let autoPackResultsPreview = null;', 'function isAutoPackResultsStale('),
  ].join('\n');
  return new Function(...Object.keys(deps), `${body}\nreturn getAutoPackResultsPreviewPack;`)(...Object.values(deps));
}

test('C5A fresh INCOMPLETE Apply needs no prior Applied match and is one undoable source action', async () => {
  const f = await resultsSyncFixture();
  try {
    f.caseData.weight = null;
    const sourcePack = structuredClone(f.pre);
    sourcePack.lastEdited = 123;
    const option = { ...f.options[0], sourceSignature: f.Engine.buildAutoPackSourceSignature(f.winner),
      assessment: f.Engine.assessNormalAutoPackCandidate(f.winner, [f.caseData]) };
    const results = { ...f.results, options: [option], selectedId: null, preferredId: 'default',
      adoptedOptionIds: [], minimized: false,
      sourceSignature: f.Engine.buildAutoPackSourceSignature(sourcePack),
      caseRuleSignature: f.Engine.buildAutoPackCaseRuleSignature(sourcePack, f.getCaseById),
      caseAuthoritySignature: f.Engine.buildAutoPackCaseRuleSignature(sourcePack, f.getCaseById, { exact: true }) };
    f.StateStore.replace({ ...f.StateStore.get(), packLibrary: [sourcePack], autoPackResults: results }, { resetHistory: true });
    assert.equal(f.applied(), null, 'a matching or animated candidate is not adoption evidence');
    const before = structuredClone(f.PackLibrary.getById(sourcePack.id));
    f.apply('default', 'run-A');
    assert.equal(f.writes.length, 1);
    assert.equal(f.applied()?.id, 'default');
    assert.equal(f.StateStore.get('autoPackResults').selectedId, null, 'explicit Apply does not create Recommended');
    assert.equal(f.StateStore.get('autoPackResults').options[0].assessment.primary, 'INCOMPLETE');
    assert.deepEqual(f.PackLibrary.getById(sourcePack.id).cases, f.winner.cases, 'exact viewed pose is committed without a second solve');
    assert.equal(f.StateStore.undo(), true);
    assert.deepEqual(f.PackLibrary.getById(sourcePack.id), before);
    assert.equal(f.StateStore.undo(), false, 'view/action metadata adds no extra history step');
  } finally { f.unsubscribe(); }
});

test('C5A legacy Max Apply remains available when the normal preferred candidate was not adopted', async () => {
  const f = await resultsSyncFixture({ maxCapacity: true });
  try {
    f.caseData.weight = null;
    const normal = { ...f.options[0], sourceSignature: f.Engine.buildAutoPackSourceSignature(f.winner),
      assessment: f.Engine.assessNormalAutoPackCandidate(f.winner, [f.caseData]) };
    const max = { ...f.options[1], assessment: null };
    const results = { ...f.results, options: [normal, max], selectedId: null, preferredId: 'default', adoptedOptionIds: [],
      sourceSignature: f.Engine.buildAutoPackSourceSignature(f.pre), sourceLegacySignature: f.Engine.buildAutoPackResultSignature(f.pre),
      caseRuleSignature: f.Engine.buildAutoPackCaseRuleSignature(f.pre, f.getCaseById),
      caseAuthoritySignature: f.Engine.buildAutoPackCaseRuleSignature(f.pre, f.getCaseById, { exact: true }) };
    f.StateStore.replace({ ...f.StateStore.get(), packLibrary: [f.pre], autoPackResults: results }, { resetHistory: true });
    assert.equal(f.applied(), null);
    f.apply('max-capacity', 'run-A');
    assert.equal(f.writes.length, 1, 'C5A does not turn Max into a comparison-only result');
    const pack = f.PackLibrary.getById(f.pre.id);
    assert.equal(pack.cases[0].packedProfile, 'max-capacity');
    assert.equal(pack.cases[0].transform.position.x, f.alternate.cases[0].transform.position.x);
    assert.deepEqual(pack.cases[1].transform, f.pre.cases[1].transform, 'legacy Max staged-pose compatibility stays unchanged');
    assert.equal(f.applied()?.id, 'max-capacity');
    assert.equal(f.caseData.weight, null, 'unknown mass is not fabricated');
    assert.equal(f.StateStore.get('autoPackResults').options.find(option => option.id === 'max-capacity').assessment, null, 'normal assessment policy is not applied to Max');
  } finally { f.unsubscribe(); }
});

test('C5A Apply reassesses INVALID and blocked candidates rather than trusting cached claims', async () => {
  const [Engine, Editor] = await Promise.all([import(enginePath.href), import(editorScreenPath.href)]);
  const truck = { length: 100, width: 60, height: 60, shapeMode: 'rect', shapeConfig: {} };
  const definitions = [10, 20].map((weight, i) => ({ id: `c${i}`, dimensions: { length: 20, width: 20, height: 10 },
    weight, shape: 'box', orientationLock: 'upright' }));
  const inst = (id, caseId, y, placement = 'packed') => ({ id, caseId, placement,
    transform: { position: { x: 30, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
  const getCase = id => definitions.find(c => c.id === id);
  for (const kind of ['invalid', 'blocked']) {
    const source = { id: 'p', truck, cases: [inst('base', 'c0', 5, 'staged'), inst('child', 'c1', 5, 'staged')] };
    const candidate = { ...source, cases: [inst('base', 'c0', 5), inst('child', 'c1', kind === 'invalid' ? 40 : 15)] };
    const option = { id: 'default', nextCases: candidate.cases,
      signature: Engine.buildAutoPackResultSignature(candidate), sourceSignature: Engine.buildAutoPackSourceSignature(candidate),
      assessment: { primary: 'VALID', eligibility: { state: 'eligible' } } };
    const results = { packId: source.id, options: [option], adoptedOptionIds: [],
      sourceSignature: Engine.buildAutoPackSourceSignature(source),
      caseAuthoritySignature: Engine.buildAutoPackCaseRuleSignature(source, getCase, { exact: true }) };
    const actual = Engine.assessNormalAutoPackCandidate(candidate, definitions);
    assert.equal(actual.primary, kind === 'invalid' ? 'INVALID' : 'VALID');
    if (kind === 'blocked') assert.equal(actual.eligibility.state, 'blocked', 'known heavier child keeps the active normal gate');
    const before = structuredClone(source);
    assert.equal(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), null, kind);
    assert.deepEqual(source, before, 'reassessment does not repair or mutate source');
  }
});

test('C5A normal Case authority tracks current planning inputs and cached volume without changing legacy Max freshness', async () => {
  const [Engine, Editor] = await Promise.all([import(enginePath.href), import(editorScreenPath.href)]);
  const caseData = { id: 'c', dimensions: { length: 10, width: 10, height: 10 }, weight: 10,
    shape: 'box', orientationLock: 'upright', mustLoadLast: false, mustUnloadFirst: false,
    stopGroup: 'stop-A', keepTogetherGroup: 'group-A', volume: 1000, name: 'Box', color: '#334455' };
  const source = { id: 'p', truck: { length: 100, width: 40, height: 40, shapeMode: 'rect' },
    cases: [{ id: 'i', caseId: 'c', placement: 'staged',
      transform: { position: { x: -20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }] };
  const candidate = structuredClone(source);
  candidate.cases[0].placement = 'packed'; candidate.cases[0].transform.position.x = 30;
  const option = { id: 'default', nextCases: candidate.cases,
    sourceSignature: Engine.buildAutoPackSourceSignature(candidate) };
  const getCase = id => id === caseData.id ? caseData : null;
  const results = { packId: source.id, options: [option], adoptedOptionIds: [],
    sourceSignature: Engine.buildAutoPackSourceSignature(source),
    sourceLegacySignature: Engine.buildAutoPackResultSignature(source),
    caseRuleSignature: Engine.buildAutoPackCaseRuleSignature(source, getCase),
    caseAuthoritySignature: Engine.buildAutoPackCaseRuleSignature(source, getCase, { exact: true }) };
  const before = structuredClone(source);
  assert.ok(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), 'initial Case authority matches');
  for (const [field, value] of [
    ['mustLoadLast', true], ['mustUnloadFirst', true], ['stopGroup', 'stop-B'],
    ['keepTogetherGroup', 'group-B'], ['volume', 1000.000001],
  ]) {
    const original = caseData[field];
    caseData[field] = value;
    assert.equal(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), null,
      `${field}: changing current Case authority stales normal Apply`);
    assert.equal(Engine.buildAutoPackCaseRuleSignature(source, getCase), results.caseRuleSignature,
      `${field}: the legacy Case signature is unchanged`);
    assert.equal(Engine.isAutoPackResultsFresh(source, results, getCase, { maxCapacity: true }), true,
      `${field}: Max retains C4 freshness semantics`);
    assert.deepEqual(source, before, 'the Pack, poses and membership remain unchanged');
    caseData[field] = original;
    assert.ok(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), 'restoring authority restores freshness');
  }
  for (const [field, value] of [['name', 'Renamed Box'], ['color', '#abcdef']]) {
    caseData[field] = value;
    assert.equal(Engine.buildAutoPackCaseRuleSignature(source, getCase, { exact: true }), results.caseAuthoritySignature);
    assert.ok(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), `${field}: presentation metadata stays fresh`);
  }
  assert.deepEqual(source, before);
});

test('C5A exact source, Case authority and workspace departure invalidate normal Apply', async () => {
  const [Engine, Editor, Storage] = await Promise.all([import(enginePath.href), import(editorScreenPath.href),
    import(new URL('../../src/core/storage.js', import.meta.url).href)]);
  const caseData = { id: 'c', dimensions: { length: 10, width: 10, height: 10 }, weight: 10, shape: 'box', orientationLock: 'upright' };
  const source = { id: 'p', truck: { length: 100, width: 40, height: 40, shapeMode: 'rect' },
    cases: [{ id: 'i', caseId: 'c', placement: 'staged', transform: { position: { x: -20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }] };
  const candidate = structuredClone(source);
  candidate.cases[0].placement = 'packed'; candidate.cases[0].transform.position.x = 30;
  const option = { id: 'default', nextCases: candidate.cases, sourceSignature: Engine.buildAutoPackSourceSignature(candidate) };
  const getCase = () => caseData;
  const results = { packId: source.id, options: [option], adoptedOptionIds: [], scope: Storage.captureScopeContext(),
    sourceSignature: Engine.buildAutoPackSourceSignature(source),
    caseAuthoritySignature: Engine.buildAutoPackCaseRuleSignature(source, getCase, { exact: true }) };
  assert.ok(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase));
  source.cases[0].transform.position.x -= 0.00001;
  assert.equal(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), null, 'tiny staged edit cannot be overwritten');
  source.cases[0].transform.position.x = -20;
  caseData.dimensions.length += 0.00001;
  assert.equal(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), null, 'Case dimensions have no display tolerance');
  caseData.dimensions.length = 10;
  const oldScope = Storage.getWorkspaceScope();
  try {
    Storage.setWorkspaceScope('C5A-other-workspace');
    Storage.setWorkspaceScope(oldScope);
    assert.equal(Editor.prepareNormalAutoPackResultApply(source, results, option, getCase), null, 'depart-return generation remains stale');
  } finally { Storage.setWorkspaceScope(oldScope); }
});

test('C5A complete normal assessment includes retained hidden physical cargo', async () => {
  const Engine = await import(enginePath.href);
  const definition = { id: 'c', dimensions: { length: 10, width: 10, height: 10 }, weight: 10, shape: 'box', orientationLock: 'upright' };
  const pack = { id: 'p', truck: { length: 100, width: 40, height: 40, shapeMode: 'rect' }, cases: [
    { id: 'fixed', caseId: 'c', hidden: true, placement: 'packed', transform: { position: { x: 30, y: 25, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } },
    { id: 'moving', caseId: 'c', placement: 'staged', transform: { position: { x: -20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } },
  ] };
  const before = structuredClone(pack);
  const assessment = Engine.assessNormalAutoPackCandidate(pack, [definition]);
  assert.equal(assessment.primary, 'INVALID', 'the retained floating body cannot disappear from assessment');
  assert.ok(assessment.hard.some(finding => finding.subject === 'fixed' && finding.outcome === 'FAIL'));
  assert.deepEqual(pack, before);
});

test('C5A metric solver bearing contact uses source dimensions without losing physical support', async () => {
  const [Engine, Solver, PackLibrary] = await Promise.all([import(enginePath.href),
    import(new URL('../../src/services/autopack-solver.js', import.meta.url).href), import(packLibraryPath.href)]);
  const definition = { id: 'metric', dimensions: { length: 20.123456789, width: 15.987654321, height: 12.34567891 },
    weight: 10, shape: 'box', orientationLock: 'upright' };
  const truck = { length: 100, width: 60, height: 60, shapeMode: 'rect' };
  const source = { id: 'metric-pack', truck, cases: [{ id: 'metric-i', caseId: definition.id, placement: 'staged',
    transform: { position: { x: -40, y: definition.dimensions.height / 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } }] };
  const before = structuredClone(definition);
  const solve = Solver.solveAutoPack({ truck, zones: PackLibrary.getTrailerUsableZones(truck), loadFrontFirst: true,
    items: [{ instanceId: 'metric-i', ...definition, dims: definition.dimensions }] });
  assert.equal(solve.placements.size, 1, 'the production solver places this known-fit metric Case');
  const candidate = { ...source, cases: Engine.buildAutoPackNextCases(source.cases, solve.placements, solve.rotations, solve.orientedDims, new Map()) };
  assert.equal(Engine.assessNormalAutoPackCandidate(candidate, [definition]).primary, 'VALID', 'computationally flush bearing survives exact-source assessment');
  const separated = structuredClone(candidate);
  separated.cases[0].transform.position.y += 0.000002;
  assert.equal(Engine.assessNormalAutoPackCandidate(separated, [definition]).primary, 'INVALID', 'a gap larger than the contact allowance is not support');
  assert.deepEqual(definition, before, 'Case dimensions stay exact');
});

test('C5A a normal source signature cannot take ownership of an existing staged transform', async () => {
  const [Engine, Editor] = await Promise.all([import(enginePath.href), import(editorScreenPath.href)]);
  const source = { id: 'staged', caseId: 'c', placement: 'staged',
    transform: { position: { x: -100, y: 5, z: 70 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
    orientedDims: { length: 10, width: 10, height: 10 } };
  const proposed = structuredClone(source);
  proposed.transform.position.x = -200;
  proposed.transform.rotation.y = 0;
  const option = { id: 'default', movableIds: [source.id], nextCases: [proposed],
    sourceSignature: Engine.buildAutoPackSourceSignature({ cases: [proposed] }) };
  const applied = Editor.buildAppliedAutoPackCases(option, structuredClone, [source]);
  assert.deepEqual(applied, [source], 'position, rotation and dimensional cache remain source-owned');
  assert.equal(proposed.transform.position.x, -200, 'projection does not rewrite the stored candidate');
  const resolved = { ...option, stagingSourceSignatures: {
    [source.id]: Engine.buildAutoPackSourceSignature({ cases: [source] }),
  } };
  const edited = structuredClone(source);
  edited.transform.position.z += 10;
  assert.deepEqual(Editor.buildAppliedAutoPackCases(resolved, structuredClone, [edited]), [edited],
    'allocator evidence cannot overwrite a subsequent manual staged edit, including after legacy Max adoption');
  assert.deepEqual(Editor.buildAppliedAutoPackCases({ ...resolved, id: 'max-capacity' }, structuredClone, [source]), [source],
    'Max retains its legacy staged-pose ownership even when allocator evidence exists');
});

test('C5A Inspector Apply Position restores committed scene before validation and adds only one history action', async () => {
  const f = await resultsSyncFixture();
  try {
    const source = await fs.readFile(editorScreenPath, 'utf8');
    f.caseData.weight = null;
    const pack = structuredClone(f.pre);
    const option = { ...f.options[0], sourceSignature: f.Engine.buildAutoPackSourceSignature(f.winner),
      assessment: f.Engine.assessNormalAutoPackCandidate(f.winner, [f.caseData]) };
    const results = { ...f.results, options: [option], selectedId: null, adoptedOptionIds: [], preferredId: 'default',
      sourceSignature: f.Engine.buildAutoPackSourceSignature(pack),
      caseRuleSignature: f.Engine.buildAutoPackCaseRuleSignature(pack, f.getCaseById),
      caseAuthoritySignature: f.Engine.buildAutoPackCaseRuleSignature(pack, f.getCaseById, { exact: true }) };
    f.StateStore.replace({ ...f.StateStore.get(), packLibrary: [pack], autoPackResults: results }, { resetHistory: true });
    const preview = previewProjector(f, source, () => ({ busy: false }));
    let transient = true, validations = 0, applyPosition;
    const vec = p => ({ x: p.x, y: p.y, z: p.z,
      clone() { return vec(this); }, copy(v) { Object.assign(this, { x: v.x, y: v.y, z: v.z }); return this; } });
    const obj = { position: vec(option.nextCases[0].transform.position) };
    const CaseScene = { isTransientPreview: () => transient, getObject: () => obj,
      checkCollision() {
        assert.equal(transient, false, 'collision validation never sees the transient candidate');
        if (validations++ === 0) assert.equal(obj.position.x, pack.cases[0].transform.position.x);
        return { collides: false };
      }, setCollision() {}, settleY: () => 12, applyOOGHighlights() {} };
    const deps = {
      getAutoPackResultsPreviewPack: preview, PackLibrary: f.PackLibrary, StateStore: f.StateStore,
      resolveAutoPackResultsView: () => ({ options: [option], currentOption: f.applied(), results: f.StateStore.get('autoPackResults') }),
      patchAutoPackResultsState: f.patchResults, CaseScene,
      render() {
        const committed = f.PackLibrary.getById(pack.id);
        assert.equal(preview(committed), null, 'preview identity ends before the scene returns to source');
        transient = false;
        obj.position.copy(committed.cases[0].transform.position);
      }, OperationLifecycle: { isBusy: () => false }, UIComponents: { showToast() {} },
    };
    const boundaries = sliceFn(source, 'function landAutoPackResultsViewOnApplied()', 'function getPreviewScene()') +
      sliceFn(source, 'function editorMutationBlocked(', 'function setSelectionFromDeleteResult(');
    const blocked = new Function(...Object.keys(deps), `${boundaries}\nreturn editorMutationBlocked;`)(...Object.values(deps));
    assert.equal(blocked(), false, 'a non-geometric/read-only guard leaves preview alone');
    assert.equal(transient, true);
    const normalProjection = sliceFn(source, 'function withoutPackedProfile(', '// Shortcut hint name');
    const buildNormalHandlingPack = new Function(`${normalProjection}\nreturn buildNormalHandlingPack;`)();
    const handler = sliceFn(source, "savePos.addEventListener('click', () => {", 'transformCard.appendChild(savePos);');
    const handlerDeps = {
      savePos: { addEventListener(_type, callback) { applyPosition = callback; } }, editorMutationBlocked: blocked,
      Utils: { unitToInches: n => n }, lengthUnit: 'in', fX: { input: { value: '43' } },
      fY: { input: { value: '12' } }, fZ: { input: { value: '0' } },
      inst: pack.cases[0], pack, CaseScene, SceneManager: { vecInchesToWorld: vec, vecWorldToInches: p => ({ x:p.x,y:p.y,z:p.z }), focusOnWorldPoint() {} },
      UIComponents: deps.UIComponents, buildNormalHandlingPack, PackLibrary: f.PackLibrary,
      CaseLibrary: { getCases: () => [f.caseData] },
    };
    new Function(...Object.keys(handlerDeps), handler)(...Object.values(handlerDeps));
    applyPosition();
    assert.equal(validations, 2, 'both initial and final scene checks use committed authority');
    assert.equal(f.writes.length, 1);
    assert.equal(f.PackLibrary.getById(pack.id).cases[0].transform.position.x, 43);
    assert.equal(f.StateStore.get('autoPackResults').previewEnded, true);
    assert.equal(f.StateStore.undo(), true);
    assert.deepEqual(f.PackLibrary.getById(pack.id), pack);
    assert.equal(f.StateStore.undo(), false, 'ending preview creates no history action');
  } finally { f.unsubscribe(); }
});

test('C5A an ordinary manual mutation ends persistent preview without an assessment lock', async () => {
  const [Editor, Three] = await Promise.all([import(editorScreenPath.href), import('three')]);
  const previousThree = globalThis.THREE;
  globalThis.THREE = Three;
  try {
    let preview = true, busy = false, ended = 0, removed = 0;
    const state = { currentPackId: 'p', selectedInstanceIds: ['i'],
      autoPackResults: { closed: true, assessment: { primary: 'INVALID' } } };
    const interaction = Editor.createInteractionManager({
      SceneManager: {}, CaseLibrary: {}, PreferencesManager: {},
      StateStore: { get: key => state[key], set: patch => Object.assign(state, patch) },
      CaseScene: { isTransientPreview: () => preview, setSelected() {} },
      PackLibrary: { removeInstances(packId, ids) {
        assert.equal(preview, false, 'mutation starts from committed scene');
        assert.equal(packId, 'p'); assert.deepEqual(ids, ['i']); removed += 1;
        return { deletedInstanceIds: ids, finalSelectionIds: [] };
      } },
      OperationLifecycle: { isBusy: () => busy }, UIComponents: { showToast() {} },
    });
    interaction.setBeforeSceneMutation(() => { preview = false; ended += 1; });
    busy = true;
    interaction.deleteSelection();
    assert.equal(ended, 0, 'an owning operation is still protected');
    assert.equal(removed, 0);
    busy = false;
    interaction.deleteSelection();
    assert.equal(ended, 1);
    assert.equal(removed, 1, 'hidden Results and INVALID assessment do not revoke manual editing');
    assert.deepEqual(state.selectedInstanceIds, []);
  } finally { globalThis.THREE = previousThree; }
});

test('C5A navigation and Pack departure end persistent preview without a source or history action', async () => {
  const f = await resultsSyncFixture({ maxCapacity: true });
  let unsubscribeContext;
  try {
    const source = await fs.readFile(editorScreenPath, 'utf8');
    const contextSubscription = sliceFn(source,
      'StateStore.subscribe((changes, _state, notification) => {',
      '// Ends a transient Results preview');
    let transient = true;
    const scene = { isTransientPreview: () => transient,
      sync(pack) {
        assert.equal(pack, f.PackLibrary.getById(f.winner.id));
        transient = false;
      } };
    unsubscribeContext = new Function('StateStore', 'CaseScene', 'PackLibrary', 'getAutoPackResultsState',
      `let viewOwner = null, previewScene = null;
       function invalidateViewOwner() {}
       function landAutoPackResultsViewOnApplied() {}
       return ${contextSubscription}`)(f.StateStore, scene, f.PackLibrary, () => f.StateStore.get('autoPackResults'));
    const preview = previewProjector(f, source, () => ({ busy: false }));
    const before = structuredClone(f.PackLibrary.getById(f.winner.id));
    f.patchResults({ viewIndex: 1, closed: true, minimized: true }, 'run-A');
    assert.ok(preview(before), 'the hidden card retains its preview');
    f.StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
    assert.equal(transient, false, 'navigation restores committed scene authority');
    f.StateStore.set({ currentScreen: 'editor' }, { skipHistory: true });
    assert.equal(preview(before), null, 'returning never silently resumes the candidate');
    assert.equal(f.StateStore.get('autoPackResults').viewIndex, 1, 'Results keep the same viewed identity');
    f.patchResults({ previewEnded: false }, 'run-A');
    assert.ok(preview(before), 'the user can explicitly preview the option again');
    f.StateStore.set({ currentPackId: 'another-pack' }, { skipHistory: true });
    f.StateStore.set({ currentPackId: f.winner.id }, { skipHistory: true });
    assert.equal(preview(before), null, 'Pack departure also ends the preview');
    assert.deepEqual(f.PackLibrary.getById(f.winner.id), before);
    assert.equal(f.writes.length, 0);
    assert.equal(f.StateStore.undo(), true);
    assert.deepEqual(f.PackLibrary.getById(f.winner.id), f.pre, 'only the existing AutoPack adoption is undoable');
    assert.equal(f.StateStore.undo(), false, 'context/view changes added no history');
  } finally { unsubscribeContext?.(); f.unsubscribe(); }
});

test('AUTOPACK-RESULTS-PREVIEW close/minimize retain the viewed scene until an authority transition', async () => {
  const f = await resultsSyncFixture({ maxCapacity: true });
  try {
    const source = await fs.readFile(editorScreenPath, 'utf8');
    let operation = { busy: false, kind: 'idle' };
    const preview = previewProjector(f, source, () => operation);
    const pack = () => f.PackLibrary.getById(f.winner.id);
    const maxOption = f.options[1];
    const packBefore = f.StateStore.get('packLibrary');
    const packJson = JSON.stringify(packBefore);

    f.patchResults({ viewIndex: 0 }, 'run-A');
    assert.equal(preview(pack()), null, 'viewing the Applied option (Balanced) shows the committed Pack');
    f.patchResults({ viewIndex: 1 }, 'run-A');
    const projected = preview(pack());
    assert.ok(projected, 'viewing another option previews it');
    assert.notEqual(projected, pack(), 'the preview is a separate object, never the Pack');
    assert.equal(projected.id, pack().id);
    assert.deepEqual(projected.cases, f.EditorScreen.buildAppliedAutoPackCases(maxOption, structuredClone, pack().cases),
      'the preview is exactly the layout Apply would commit');
    assert.equal(preview(pack()), projected, 'unchanged inputs reuse the same projection');

    for (const [label, patch] of [['minimized', { minimized: true }], ['closed', { closed: true }]]) {
      f.patchResults(patch, 'run-A');
      assert.deepEqual(preview(pack()).cases, projected.cases, `${label} Results retain the uncommitted candidate`);
      f.patchResults({ minimized: false, closed: false }, 'run-A');
      assert.ok(preview(pack()), `${label}: restored Results resume the same viewed option`);
    }
    for (const kind of ['autopacking', 'unpacking', 'changingTruck', 'previewingTruckChange']) {
      operation = { busy: true, kind };
      assert.equal(preview(pack()), null, `${kind} owns the scene: the committed Pack shows`);
    }
    operation = { busy: true, kind: 'capturingPreview' };
    assert.ok(preview(pack()), 'a thumbnail capture does not drop the preview (capture is refused instead)');
    operation = { busy: false, kind: 'idle' };
    assert.equal(preview({ ...pack(), id: 'another-pack' }), null, 'another Pack shows its own committed layout');
    assert.equal(f.StateStore.get('packLibrary'), packBefore, 'browsing never replaces the Pack library');
    assert.equal(JSON.stringify(f.StateStore.get('packLibrary')), packJson, 'browsing never writes the Pack');
    assert.equal(f.writes.length, 0);

    const moved = structuredClone(pack());
    moved.cases[0].transform.position.x += 7;
    f.StateStore.set({ packLibrary: [moved] });
    assert.equal(preview(pack()), null, 'Outdated Results restore the committed Pack');
    assert.equal(f.StateStore.undo(), true);
    assert.ok(preview(pack()), 'back to a current run, the viewed option previews again');

    f.apply(maxOption.id, 'run-A');
    assert.equal(f.writes.length, 1, 'only Apply writes the Pack');
    assert.equal(preview(pack()), null, 'after Apply the viewed option is the committed Pack');
    f.patchResults({ viewIndex: 0 }, 'run-A');
    assert.ok(preview(pack()), 'Balanced is now the non-Applied option and previews');

    f.StateStore.set({ autoPackResults: null }, { skipHistory: true });
    assert.equal(preview(pack()), null, 'a newer AutoPack run (Results cleared) restores the committed Pack');
  } finally { f.unsubscribe(); }
});

test('AUTOPACK-RESULTS-PREVIEW one viewed option drives card, scene and Inspector; scene authority stays Pack-only', async () => {
  const { src, render } = await renderBlock();
  const editorRender = sliceFn(src, '    function render() {\n      const previousPreviewScene', 'function renderSelection()');
  assert.match(editorRender, /const resultsPreviewPack = getAutoPackResultsPreviewPack\(pack\);\n\s*CaseScene\.sync\(resultsPreviewPack \|\| pack, \{ transientPreview: Boolean\(resultsPreviewPack\) \}\);/,
    'the scene syncs the preview of the card\'s viewed option, else the Pack');
  assert.match(editorRender, /if \(initialized && CaseScene\.getSyncedPack\(\) === pack\) \{/,
    'preview/export scene authority is still published only for the committed Pack');
  assert.match(src, /if \(StateStore\.get\('currentScreen'\) !== 'editor' && CaseScene\.isTransientPreview\(\)\) \{\n\s*CaseScene\.sync\(PackLibrary\.getById\(StateStore\.get\('currentPackId'\)\)\);/,
    'leaving the Editor restores the committed Pack');
  const unpack = sliceFn(src, 'async function unpackAll() {', 'function renderInspectorNoPack()');
  assert.ok(unpack.indexOf('endAutoPackResultsPreview();') >= 0 &&
    unpack.indexOf('endAutoPackResultsPreview();') < unpack.indexOf("beginOperation('unpacking'"),
  'Unpack ends a Results preview before it claims the lifecycle slot');
  const truck = sliceFn(src, 'function applyTruckGeometryChange(pack, nextTruck, successMsg) {', 'function renderTruckInspector(');
  assert.ok(truck.indexOf('endAutoPackResultsPreview();') >= 0 &&
    truck.indexOf('endAutoPackResultsPreview();') < truck.indexOf('OperationLifecycle.isBusy()') &&
    truck.indexOf('endAutoPackResultsPreview();') < truck.indexOf("beginOperation('changingTruck'"),
  'Truck Change ends a Results preview before its busy check and lifecycle slot');
  const exportScene = sliceFn(src, 'function getExportScene() {', 'const shellEl');
  assert.match(exportScene, /endAutoPackResultsPreview\(\);\n\s*const scene = getPreviewScene\(\);/,
    'visual export ends a Results preview before resolving authority');
  assert.match(render, /const view = resolveAutoPackResultsView\(pack\);/, 'the card reads the same view resolution');
  const preview = sliceFn(src, 'function getAutoPackResultsPreviewPack(pack) {', 'function isAutoPackResultsStale(');
  assert.match(preview, /const view = resolveAutoPackResultsView\(pack\);/, 'the scene reads the same view resolution');
  const inspector = sliceFn(src, 'function renderTruckInspector(pack, prefs)', 'function renderMultiInspector(');
  assert.match(inspector, /const viewedPack = getAutoPackResultsPreviewPack\(pack\) \|\| pack;/);
  assert.match(inspector, /PackLibrary\.computeStats\(viewedPack\)/, 'loaded mass uses the viewed subject');
  assert.match(inspector, /buildSpaceUtilizationResult\(viewedPack, PackLibrary\)/, 'counts use that same subject');
  assert.match(sliceFn(src, 'function renderSpaceUtilizationSection(pack)', 'function renderUnresolvedCaseInspector('),
    /buildSpaceUtilizationResult\(getAutoPackResultsPreviewPack\(pack\) \|\| pack, PackLibrary\)/,
    'Space Utilization uses the same candidate-or-committed resolution');
  assert.doesNotMatch(src, /relaxed-handling-profile|Relaxed handling profile/,
    'the Inspector repeats no relaxed-profile notice; the Results card carries the Max Capacity warning');
});
