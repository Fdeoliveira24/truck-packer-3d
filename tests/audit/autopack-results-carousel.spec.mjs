// AutoPack Results carousel polish (UI-only). Source-contract tests for the
// floating results panel in editor-screen.js: single result stays compact with
// no carousel arrows; multiple results render a one-at-a-time carousel with an
// "Option X of Y" counter and clamped Prev/Next; applying still runs through the
// existing validated PackLibrary path; and the carousel view index is UI-only
// (never written into the AutoPack result payload). No DOM/pixel testing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const enginePath = new URL('../../src/services/autopack-engine.js', import.meta.url);

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `expected block between "${startNeedle}" and "${endNeedle}"`);
  return src.slice(start, end);
}

test('AUTOPACK-CAROUSEL carousel controls render only for multiple options', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const render = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');

  // Expansion (and therefore the carousel) requires more than one option.
  assert.match(render, /const hasAlternates = options\.length > 1;/,
    'multiple-option detection must stay based on options.length');
  assert.match(render, /const expanded = results\.expanded === true && hasAlternates;/,
    'the carousel view is gated on expanded AND having alternates');

  // Nav (Prev / counter / Next) is built inside the `if (expanded)` branch only,
  // so a single result never renders carousel arrows.
  const nav = sliceFn(render, 'if (expanded) {', 'const stats = document.createElement');
  assert.match(nav, /tp3d-autopack-results__carousel-nav/,
    'the carousel nav must be built inside the expanded branch');
  assert.equal(render.includes('tp3d-autopack-results__list'), false,
    'the long expanded option list must be replaced by the carousel');

  // Single result stays compact with the existing "best load" summary.
  assert.match(render, /title\.textContent = expanded \? 'AutoPack Results' : 'Best load selected';/,
    'the compact single-result title must be preserved');
});

test('AUTOPACK-CAROUSEL multi-result panel shows an Option X of Y counter', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const render = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');
  const nav = sliceFn(render, 'if (expanded) {', 'const stats = document.createElement');

  assert.match(nav, /tp3d-autopack-results__counter/,
    'the carousel must render an index counter element');
  assert.match(nav, /`Option \$\{viewIndex \+ 1\} of \$\{options\.length\}`/,
    'the counter must display the 1-based option index out of the total');
});

test('AUTOPACK-CAROUSEL Prev/Next render, clamp at the ends, and only move the view', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const render = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');
  const nav = sliceFn(render, 'if (expanded) {', 'const stats = document.createElement');

  assert.match(nav, /aria-label', 'Previous option'/, 'a Previous control must be rendered');
  assert.match(nav, /aria-label', 'Next option'/, 'a Next control must be rendered');

  // Clamp (not wrap): disabled at the extremes.
  assert.match(nav, /prevBtn\.disabled = viewIndex <= 0;/, 'Previous must be disabled on the first option');
  assert.match(nav, /nextBtn\.disabled = viewIndex >= options\.length - 1;/, 'Next must be disabled on the last option');
  assert.match(nav, /patchAutoPackResultsState\(\{ viewIndex: Math\.max\(0, viewIndex - 1\) \}\)/,
    'Previous must clamp the view index at 0');
  assert.match(nav, /patchAutoPackResultsState\(\{ viewIndex: Math\.min\(options\.length - 1, viewIndex \+ 1\) \}\)/,
    'Next must clamp the view index at the last option');

  // Cycling the carousel must not apply or mutate the pack.
  assert.equal(nav.includes('applyAutoPackResultOption'), false,
    'Prev/Next must not apply a solution');
  assert.equal(nav.includes('PackLibrary'), false,
    'Prev/Next must not mutate the pack directly');
});

test('AUTOPACK-CAROUSEL apply uses the existing validated apply path', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const render = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');

  // The carousel Apply button routes through the unchanged applyAutoPackResultOption,
  // is disabled on the applied option or when stale, and marks the applied option.
  assert.match(render, /apply\.addEventListener\('click', \(\) => applyAutoPackResultOption\(viewedOption\.id\)\);/,
    'carousel Apply must call the existing applyAutoPackResultOption path');
  assert.match(render, /apply\.disabled = isViewedCurrent \|\| stale;/,
    'Apply must be disabled for the applied option and for stale results');
  assert.match(render, /applied\.textContent = 'Applied';/,
    'the applied option must be clearly marked');

  const apply = sliceFn(src, 'function applyAutoPackResultOption(optionId)', 'function makeAutoPackResultStat(');
  assert.match(apply, /if \(isAutoPackResultsStale\(pack, results\)\)/,
    'apply must keep the stale guard');
  assert.match(apply, /PackLibrary\.update\(pack\.id, \{ cases: cloneAutoPackCases\(option\.nextCases\) \}\)/,
    'apply must keep committing the chosen solution through PackLibrary.update');
  assert.match(apply, /StateStore\.set\(\{ selectedInstanceIds: \[\] \}/,
    'apply must keep clearing selection after swapping the load');
});

test('AUTOPACK-CAROUSEL view index is UI-only, defaulted and clamped, never in the payload', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const render = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');

  // Defaults to the applied option and clamps into range, so a re-run (fresh
  // results with no viewIndex) or a smaller option set can never point OOB.
  assert.match(render, /const selectedIndex = Math\.max\(0, options\.findIndex\(option => option\.id === results\.selectedId\)\);/,
    'the default view index must be the applied option index');
  assert.match(render, /Number\.isFinite\(Number\(results\.viewIndex\)\) \? Number\(results\.viewIndex\) : selectedIndex/,
    'a missing/invalid view index must fall back to the applied option');
  assert.match(render, /Math\.min\(Math\.max\(0, requestedIndex\), options\.length - 1\)/,
    'the view index must be clamped into range every render');
  assert.match(render, /const viewedOption = expanded \? \(options\[viewIndex\] \|\| currentOption\) : currentOption;/,
    'the viewed option must derive from the clamped index with a safe fallback');

  // Carousel view state must not be baked into the AutoPack result payload.
  const engineSrc = await fs.readFile(enginePath, 'utf8');
  assert.equal(engineSrc.includes('viewIndex'), false,
    'the AutoPack engine/result payload must not carry carousel view state');
});

test('AUTOPACK-CAROUSEL panel keeps its existing drag handle plus a visible grip', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const render = sliceFn(src, 'function renderAutoPackResultsPanel(pack)', 'function initEditorUI()');

  assert.match(render, /header\.dataset\.role = 'autopack-results-drag';/,
    'the header must remain the existing drag handle');
  assert.match(render, /grip\.className = 'tp3d-autopack-results__grip';/,
    'a visible drag grip affordance must be added to the header');
  assert.match(render, /attachAutoPackResultsDrag\(panel, host\);/,
    'the existing drag behavior must stay wired to the panel');
});
