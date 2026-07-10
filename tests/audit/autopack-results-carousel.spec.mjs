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

test('AUTOPACK-CAROUSEL view/minimize state is clamped; panel starts collapsed on each new run', async () => {
  const { render } = await renderBlock();

  assert.match(render, /const selectedIndex = Math\.max\(0, options\.findIndex\(option => option\.id === results\.selectedId\)\);/,
    'the default view index must be the applied option index');
  assert.match(render, /Number\.isFinite\(Number\(results\.viewIndex\)\) \? Number\(results\.viewIndex\) : selectedIndex/,
    'a missing/invalid view index must fall back to the applied option');
  assert.match(render, /Math\.min\(Math\.max\(0, requestedIndex\), options\.length - 1\)/,
    'the view index must be clamped into range every render');

  const engineSrc = await fs.readFile(enginePath, 'utf8');
  assert.equal(engineSrc.includes('viewIndex'), false, 'the result payload must not carry carousel view state');
  // minimized: true is intentionally set in the initial payload so each new AutoPack
  // run starts with the panel collapsed (the user expands it with the chevron toggle).
  assert.match(engineSrc, /minimized: true/, 'result payload must set minimized:true so the panel starts collapsed on every new run');
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
