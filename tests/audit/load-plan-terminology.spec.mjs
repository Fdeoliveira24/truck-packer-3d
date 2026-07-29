import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Customer-facing "Load Plan" terminology contract.
//
// Locked product decision: "Load Plan" is the customer-facing name for the
// business object that the code calls a Pack. "Pack" remains the internal
// technical term (PackLibrary, pack.id, pack.notes, packLibrary, the
// pack-batch export key) and remains the name of the Auto-Pack action.
//
// This suite therefore asserts two things that must stay true together:
//   1. customer-visible strings say "Load Plan";
//   2. the internal Pack architecture and the persisted JSON schema are
//      unchanged, and no parallel loadPlan* field was introduced.
//
// The screens render through Three.js/DOM with no jsdom harness in this
// suite, so — matching the existing convention in
// security-and-invariants.spec.mjs — UI copy is verified with source-contract
// assertions rather than by executing the UI. Assertions deliberately target
// specific literals; they must not reject legitimate internal uses of the
// word "pack" (Auto-Pack, Unpack, repack, packed items, packing rules).

const indexHtmlPath = new URL('../../index.html', import.meta.url);
const appShellPath = new URL('../../src/ui/app-shell.js', import.meta.url);
const packsScreenPath = new URL('../../src/screens/packs-screen.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const casesScreenPath = new URL('../../src/screens/cases-screen.js', import.meta.url);
const importPackDialogPath = new URL('../../src/ui/overlays/import-pack-dialog.js', import.meta.url);
const importAppDialogPath = new URL('../../src/ui/overlays/import-app-dialog.js', import.meta.url);
const helpModalPath = new URL('../../src/ui/overlays/help-modal.js', import.meta.url);
const errorOverlayPath = new URL('../../src/ui/error-overlay.js', import.meta.url);
const keyboardManagerPath = new URL('../../src/ui/keyboard-manager.js', import.meta.url);
const normalizerPath = new URL('../../src/core/normalizer.js', import.meta.url);
const importExportPath = new URL('../../src/services/import-export.js', import.meta.url);
const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const appPath = new URL('../../src/app.js', import.meta.url);

const SRC_DIR = new URL('../../src/', import.meta.url);

async function readAllSrcFiles() {
  /** @type {Array<{path: string, text: string}>} */
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) {
        if (entry.name === 'vendor') continue;
        await walk(child);
      } else if (entry.name.endsWith('.js')) {
        out.push({ path: child.pathname, text: await fs.readFile(child, 'utf8') });
      }
    }
  }
  await walk(SRC_DIR);
  return out;
}

// ---------------------------------------------------------------------------
// 1. Customer-facing surfaces say "Load Plan"
// ---------------------------------------------------------------------------

test('LOAD-PLAN-TERM-1 primary navigation and screen heading say Load Plans', async () => {
  const [html, shell] = await Promise.all([
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(appShellPath, 'utf8'),
  ]);

  assert.match(html, /data-nav="packs"[\s\S]{0,160}Load Plans/,
    'the sidebar nav button must be labelled Load Plans (its data-nav="packs" hook is internal and must not change)');
  assert.match(html, /<h1 id="topbar-title">Load Plans<\/h1>/,
    'the topbar heading must default to Load Plans');
  assert.match(shell, /packs:\s*\{\s*title:\s*'Load Plans'/,
    'the app shell screen title map must render Load Plans for the packs screen');

  // The nav/route key itself stays "packs".
  assert.match(html, /data-nav="packs"/, 'the nav route identifier must remain packs');
  assert.match(shell, /^\s*packs:\s*\{/m, 'the screen title map key must remain packs');
});

test('LOAD-PLAN-TERM-2 create/edit/duplicate/delete actions are customer-labelled Load Plan', async () => {
  const [html, packs] = await Promise.all([
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(packsScreenPath, 'utf8'),
  ]);

  assert.match(html, /New Load Plan/, 'the primary create button must say New Load Plan');
  assert.match(html, /Import Load Plan\(s\)/, 'the import button must say Import Load Plan(s)');

  assert.match(packs, /title:\s*'New Load Plan'/, 'the create modal title must say New Load Plan');
  assert.match(packs, /title:\s*'Edit Load Plan'/, 'the edit modal title must say Edit Load Plan');
  assert.match(packs, /title:\s*'Rename Load Plan'/, 'the rename modal title must say Rename Load Plan');
  assert.match(packs, /title:\s*'Delete load plan\?'/, 'the single delete confirm must say Delete load plan?');
  assert.match(packs, /title:\s*'Delete load plans\?'/, 'the bulk delete confirm must say Delete load plans?');
  assert.match(packs, /showToast\('Load plan duplicated'/, 'duplicate must confirm with Load plan duplicated');
  assert.match(packs, /showToast\('Load plan created'/, 'create must confirm with Load plan created');
  assert.match(packs, /showToast\('Load plan deleted'/, 'delete must confirm with Load plan deleted');

  // Stale customer-facing nouns must be gone from this screen.
  assert.doesNotMatch(packs, /'Untitled Pack'/, 'the untitled fallback must read Untitled Load Plan');
  assert.doesNotMatch(packs, /title:\s*'New Pack'/, 'no create modal may still say New Pack');
  assert.doesNotMatch(packs, /showToast\('Pack (created|deleted|duplicated|updated)'/,
    'no lifecycle toast may still say Pack');
});

test('LOAD-PLAN-TERM-3 empty, filtered-empty and search copy say load plans', async () => {
  const [html, packs] = await Promise.all([
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(packsScreenPath, 'utf8'),
  ]);

  assert.match(html, /placeholder="Search load plans\.\.\."/, 'the search input placeholder must say load plans');
  assert.match(html, /aria-label="Search load plans"/, 'the search input accessible name must say load plans');
  assert.match(html, />No load plans yet</, 'the empty-library state must say No load plans yet');
  assert.match(html, /Create your first load plan to start planning\./,
    'the empty-library helper text must say load plan');
  assert.match(html, /No matching load plans/, 'the filtered-empty state must say No matching load plans');
  assert.match(html, /aria-label="Select all visible load plans"/,
    'the select-all checkbox accessible name must say load plans');

  assert.match(packs, /No matching load plans for/, 'the keyed filtered-empty message must say load plans');
});

test('LOAD-PLAN-TERM-4 the Editor Pack Notes surface is presented as Load Plan Notes', async () => {
  const [html, editor] = await Promise.all([
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(editorScreenPath, 'utf8'),
  ]);

  assert.doesNotMatch(html, /id="btn-pack-notes"/,
    'Load Plan Notes must not remain in the viewport toolbar');
  assert.match(editor, /setAttribute\('aria-label', 'Open Load Plan Notes'\)/,
    'the Inspector action must identify itself as Open Load Plan Notes');
  assert.match(editor, /setAttribute\('data-tooltip', 'Load Plan Notes'\)/,
    'the Inspector action tooltip must say Load Plan Notes');
  assert.match(editor, /title:\s*'Load Plan Notes',/, 'the notes modal must be titled Load Plan Notes');
  assert.match(editor, /No notes for this load plan yet\./, 'the empty notes state must say load plan');
  assert.match(editor, /This load plan no longer exists\./, 'the missing-record error must say load plan');

  assert.doesNotMatch(editor, /title:\s*'Pack Notes',/, 'no notes modal may still be titled Pack Notes');
});

test('LOAD-PLAN-TERM-5 cross-screen references to the business object say load plan', async () => {
  const [cases, importPack, importApp, help, errorOverlay, keyboard, editor] = await Promise.all([
    fs.readFile(casesScreenPath, 'utf8'),
    fs.readFile(importPackDialogPath, 'utf8'),
    fs.readFile(importAppDialogPath, 'utf8'),
    fs.readFile(helpModalPath, 'utf8'),
    fs.readFile(errorOverlayPath, 'utf8'),
    fs.readFile(keyboardManagerPath, 'utf8'),
    fs.readFile(editorScreenPath, 'utf8'),
  ]);

  assert.match(cases, /used in \$\{packsUsing\.length\} load plan\(s\)/,
    'the Cases delete warning must count load plans');
  assert.match(importPack, /title:\s*'Import Load Plan JSON'/, 'the import dialog title must say Load Plan JSON');
  assert.match(importApp, /use Import Load Plan\./, 'the app-import hint must point at Import Load Plan');
  assert.match(help, /<strong>Load Plan JSON<\/strong>/, 'the Help modal must document Load Plan JSON');
  assert.match(errorOverlay, /'Load plan not found'/, 'the 404 overlay must say Load plan not found');
  assert.match(errorOverlay, /'Back to Load Plans'/, 'the 404 overlay CTA must say Back to Load Plans');
  assert.match(keyboard, /title:\s*'Open Load Plan',/, 'the quick-open palette must say Open Load Plan');
  assert.match(editor, /Go to Load Plans/, 'the empty-editor CTA must say Go to Load Plans');
});

// ---------------------------------------------------------------------------
// 2. Auto-Pack and packing-process language are deliberately preserved
// ---------------------------------------------------------------------------

test('LOAD-PLAN-TERM-6 Auto-Pack, Unpack and packing-process language are unchanged', async () => {
  const [html, editor, keyboard] = await Promise.all([
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(keyboardManagerPath, 'utf8'),
  ]);

  assert.match(html, /id="btn-autopack"[\s\S]{0,200}AutoPack/, 'the AutoPack toolbar button must stay AutoPack');
  assert.match(html, /data-tooltip="AutoPack \(Ctrl\/Cmd\+P\)"/, 'the AutoPack tooltip must be unchanged');
  assert.match(html, /id="btn-unpack"[\s\S]{0,200}Unpack/, 'the Unpack toolbar button must stay Unpack');

  assert.match(editor, /title: 'Unpack'/, 'Unpack toasts must keep the Unpack title');
  assert.match(editor, /packed case/, '"packed case" describes a placed item and must be preserved');
  assert.match(keyboard, /AutoPackEngine\.pack\(\)/, 'the AutoPack shortcut must still call the engine');

  // The renamed nouns must not have leaked into the packing action vocabulary.
  assert.doesNotMatch(html, /Auto ?Load ?Plan/i, 'AutoPack must never be renamed to an AutoLoadPlan variant');
  assert.doesNotMatch(editor, /Un ?Load ?Plan/i, 'Unpack must never be renamed to an UnLoadPlan variant');
});

// ---------------------------------------------------------------------------
// 3. Internal architecture and persisted schema are untouched
// ---------------------------------------------------------------------------

test('LOAD-PLAN-TERM-7 internal Pack API surface is unchanged', async () => {
  const [packs, editor, app, packLibrary] = await Promise.all([
    fs.readFile(packsScreenPath, 'utf8'),
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(packLibraryPath, 'utf8'),
  ]);

  assert.match(packLibrary, /export function update\(/, 'PackLibrary.update must still exist');
  assert.match(editor, /PackLibrary\.update\(/, 'the Editor must still persist through PackLibrary.update');
  assert.match(editor, /PackLibrary\.getById\(packId\)/, 'the Editor must still resolve packs by pack id');
  assert.match(packs, /PackLibrary\./, 'the Load Plans screen must still call PackLibrary');
  assert.match(app, /currentPackId/, 'the currentPackId state key must be unchanged');
  assert.match(app, /import \* as CorePackLibrary from '\.\/services\/pack-library\.js'/,
    'the PackLibrary module path must be unchanged');
});

test('LOAD-PLAN-TERM-8 persisted and exchanged schema keys are unchanged', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);

  const pack = Normalizer.normalizePack({
    id: 'lp-schema-1',
    title: 'Schema Fixture',
    notes: 'pack level note',
    truck: { length: 100, width: 90, height: 80 },
    cases: [],
  });

  // Internal field names survive normalization.
  assert.equal(pack.id, 'lp-schema-1', 'pack.id must remain the identity field');
  assert.equal(pack.notes, 'pack level note', 'pack.notes must remain the Pack-owned notes field');
  assert.ok(Object.prototype.hasOwnProperty.call(pack, 'title'), 'pack.title must remain the title field');

  // Export payload keys survive a real round trip.
  const json = IE.buildPackExportJSON(pack);
  const parsed = JSON.parse(json);
  const payloadPack = parsed.pack || parsed;
  assert.ok(payloadPack, 'the export payload must still expose a pack object');
  assert.equal(payloadPack.id, 'lp-schema-1', 'exported pack.id must be unchanged');
  assert.equal(payloadPack.notes, 'pack level note', 'exported pack.notes must be unchanged');

  const reimported = IE.parsePackImportJSON(json);
  assert.equal((reimported.pack || reimported).id, 'lp-schema-1',
    'a pack export must still re-import through the unchanged pack key');

  // The batch discriminator is a wire value, not display copy.
  const ieSrc = await fs.readFile(importExportPath, 'utf8');
  assert.match(ieSrc, /exportType !== 'pack-batch'/, 'the pack-batch exportType discriminator must be unchanged');
  assert.match(ieSrc, /Array\.isArray\(parsed\.packs\)/, 'the packs array key must be unchanged');
  assert.match(ieSrc, /Missing packLibrary in workspace export/, 'the packLibrary key must be unchanged');
});

test('LOAD-PLAN-TERM-9 no parallel loadPlan* field, key or compatibility wrapper was introduced', async () => {
  const files = await readAllSrcFiles();

  const offenders = [];
  for (const { path, text } of files) {
    // Identifier-shaped loadPlan usages only. Display copy such as
    // "load plan" / "Load Plan" is expected and must not be flagged.
    const matches = text.match(/\bloadPlan[A-Za-z0-9_]*\b|\bLoadPlan[A-Za-z0-9_]*\b|['"]load-plan-[a-z]+['"]/g);
    if (matches) offenders.push(`${path}: ${[...new Set(matches)].join(', ')}`);
  }
  assert.deepEqual(offenders, [],
    'no loadPlanId / loadPlanNotes / LoadPlanLibrary style identifier may be introduced — Pack stays the internal term');

  // Belt and braces on the two explicitly forbidden duplicate fields.
  const all = files.map(f => f.text).join('\n');
  assert.doesNotMatch(all, /loadPlanId/, 'loadPlanId must not exist');
  assert.doesNotMatch(all, /loadPlanNotes/, 'loadPlanNotes must not exist');
});

// ---------------------------------------------------------------------------
// 4. Cargo Instructions three-tier ownership is untouched by the rename
// ---------------------------------------------------------------------------

test('LOAD-PLAN-TERM-10 Cargo Instructions tier ownership is unchanged by the terminology pass', async () => {
  const editor = await fs.readFile(editorScreenPath, 'utf8');

  // Same block-extraction convention as inspector-case-notes.spec.mjs: the
  // function body ends at its closing brace at 4-space indentation.
  const start = editor.indexOf('function openPackNotesModal(pack)');
  assert.ok(start > -1, 'openPackNotesModal must still exist under its internal name');
  const end = editor.indexOf('\n    }', start);
  const block = end > start ? editor.slice(start, end) : '';
  assert.ok(block.length > 0, 'the openPackNotesModal body must be extractable');

  assert.match(block, /PackLibrary\.update\(/, 'Load Plan Notes must still save through PackLibrary.update');
  assert.doesNotMatch(block, /CaseLibrary/, 'Load Plan Notes must never write Standard Instructions (case.notes)');
  assert.doesNotMatch(block, /instanceNotes/, 'Load Plan Notes must never write Item Notes (instanceNotes)');
  assert.doesNotMatch(block, /updateInstance/, 'Load Plan Notes must never touch the per-instance update path');

  // The other two tiers keep their own customer-facing names.
  assert.match(editor, /Standard Instructions/, 'Standard Instructions (Case-owned) must keep its name');
  assert.match(editor, /Item Notes/, 'Item Notes (instance-owned) must keep its name');
});
