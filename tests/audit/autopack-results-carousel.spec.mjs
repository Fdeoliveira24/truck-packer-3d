// AutoPack Results floating panel (UI-only refinement). Source-contract tests
// for the panel in editor-screen.js: multiple results render a compact
// one-at-a-time carousel ("Option X of Y" + clamped Prev/Next); the header has
// separate minimize and close controls; minimize collapses to a small draggable
// chip that restores the panel; applying still runs through the existing
// validated PackLibrary path; and carousel/minimize view state is UI-only
// (never written into the AutoPack result payload). No DOM/pixel testing.
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

  // Carousel is driven purely by having alternates — no "expanded"/"View options"
  // intermediate step remains from the earlier iteration.
  assert.match(render, /const hasAlternates = options\.length > 1;/,
    'multiple-option detection must stay based on options.length');
  assert.equal(render.includes('View options'), false,
    'the compact "View options" intermediate must be gone');
  assert.equal(render.includes('results.expanded'), false,
    'the panel must no longer depend on an expanded toggle');

  const nav = sliceFn(render, 'if (hasAlternates) {', 'const stats = document.createElement');
  assert.match(nav, /tp3d-autopack-results__carousel-nav/,
    'the carousel nav must render for multiple options');
  assert.match(nav, /`Option \$\{viewIndex \+ 1\} of \$\{options\.length\}`/,
    'the counter must show the 1-based option index out of the total');
});

test('AUTOPACK-CAROUSEL header exposes separate minimize and close controls', async () => {
  const { render } = await renderBlock();

  assert.match(render, /minimizeBtn\.setAttribute\('aria-label', 'Minimize AutoPack results'\);/,
    'a minimize control with an accessible label must exist');
  assert.match(render, /minimizeBtn\.addEventListener\('click', \(\) => patchAutoPackResultsState\(\{ minimized: true \}\)\);/,
    'minimize must set UI-only minimized state, not close');
  assert.match(render, /closeBtn\.setAttribute\('aria-label', 'Close AutoPack results'\);/,
    'a close control with an accessible label must exist');
  assert.match(render, /closeBtn\.addEventListener\('click', \(\) => patchAutoPackResultsState\(\{ closed: true \}\)\);/,
    'close must remain a separate dismiss action');

  // A visible drag grip hints the existing header drag handle.
  assert.match(render, /grip\.className = 'tp3d-autopack-results__grip';/,
    'the header must keep a visible drag grip');
  assert.match(render, /header\.dataset\.role = 'autopack-results-drag';/,
    'the header must remain the existing drag handle');
});

test('AUTOPACK-CAROUSEL minimize collapses to a compact draggable chip that restores', async () => {
  const { render, src } = await renderBlock();
  const chip = sliceFn(render, 'if (minimized) {', "const panel = document.createElement('section');");

  // Compact chip/pill.
  assert.match(chip, /tp3d-autopack-results--chip/, 'minimized state must render a chip modifier');
  assert.match(chip, /tp3d-autopack-results__chip-label/, 'the chip must show a short label');
  assert.match(chip, /`AutoPack · Option \$\{viewIndex \+ 1\} of \$\{options\.length\}`/,
    'the multi chip label must summarize the current option');
  assert.match(chip, /return;/, 'the minimized branch must render only the chip');

  // Restore + close on the chip, restore returns to the panel.
  assert.match(chip, /restoreBtn\.setAttribute\('aria-label', 'Restore AutoPack results'\);/,
    'the chip must have an accessible restore control');
  assert.match(chip, /patchAutoPackResultsState\(\{ minimized: false \}\)/,
    'restore must clear the minimized state');
  assert.match(chip, /patchAutoPackResultsState\(\{ closed: true \}\)/,
    'the chip must keep close separate from restore');

  // Chip reuses the existing drag role + shared placement (no second drag system).
  assert.match(chip, /inner\.dataset\.role = 'autopack-results-drag';/,
    'the chip must reuse the existing drag-handle role');
  assert.match(chip, /placeAutoPackResultsEl\(chip\);/,
    'the chip must go through the shared position/drag placement');

  const place = sliceFn(src, 'const placeAutoPackResultsEl = el =>', 'const makeAutoPackGrip = () =>');
  assert.match(place, /clampAutoPackResultsPosition\(host, el, results\.position\)/,
    'shared placement must reuse the existing position clamp');
  assert.match(place, /attachAutoPackResultsDrag\(el, host\)/,
    'shared placement must reuse the existing drag attachment');

  // Chip pill styling exists in the scoped CSS.
  const css = await fs.readFile(stylesPath, 'utf8');
  assert.match(css, /\.tp3d-autopack-results--chip/, 'the chip must have scoped pill styling');
  assert.match(css, /\.tp3d-autopack-results__chip-inner/, 'the chip inner drag row must be styled');
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

test('AUTOPACK-CAROUSEL apply keeps the existing validated apply path and stale guard', async () => {
  const { render, src } = await renderBlock();

  assert.match(render, /apply\.addEventListener\('click', \(\) => applyAutoPackResultOption\(viewedOption\.id\)\);/,
    'carousel Apply must call the existing applyAutoPackResultOption path');
  assert.match(render, /apply\.disabled = isViewedCurrent \|\| stale;/,
    'Apply must be disabled for the applied option and for stale results');
  assert.match(render, /applied\.textContent = 'Applied';/, 'the applied option must be clearly marked');
  assert.match(render, /const stale = isAutoPackResultsStale\(pack, results\);/,
    'the stale check must remain');
  assert.match(render, /note\.textContent = 'Rerun AutoPack after edits\.';/,
    'stale results must still surface the rerun note');

  const apply = sliceFn(src, 'function applyAutoPackResultOption(optionId)', 'function makeAutoPackResultStat(');
  assert.match(apply, /if \(isAutoPackResultsStale\(pack, results\)\)/, 'apply must keep the stale guard');
  assert.match(apply, /PackLibrary\.update\(pack\.id, \{ cases: cloneAutoPackCases\(option\.nextCases\) \}\)/,
    'apply must keep committing through PackLibrary.update');
  assert.match(apply, /StateStore\.set\(\{ selectedInstanceIds: \[\] \}/,
    'apply must keep clearing selection after swapping the load');
});

test('AUTOPACK-CAROUSEL view/minimize state is UI-only, clamped, and absent from the payload', async () => {
  const { render } = await renderBlock();

  assert.match(render, /const minimized = results\.minimized === true;/,
    'minimized must be read from UI-only panel state');
  assert.match(render, /const selectedIndex = Math\.max\(0, options\.findIndex\(option => option\.id === results\.selectedId\)\);/,
    'the default view index must be the applied option index');
  assert.match(render, /Number\.isFinite\(Number\(results\.viewIndex\)\) \? Number\(results\.viewIndex\) : selectedIndex/,
    'a missing/invalid view index must fall back to the applied option');
  assert.match(render, /Math\.min\(Math\.max\(0, requestedIndex\), options\.length - 1\)/,
    'the view index must be clamped into range every render');

  // Neither carousel nor minimize view state may be baked into the result payload.
  const engineSrc = await fs.readFile(enginePath, 'utf8');
  assert.equal(engineSrc.includes('viewIndex'), false,
    'the AutoPack engine/result payload must not carry carousel view state');
  assert.equal(engineSrc.includes('minimized'), false,
    'the AutoPack engine/result payload must not carry minimize state');
});
