/**
 * @file annotation-core.spec.mjs
 * @description Pins the pure Annotations V1 model (src/core/annotations.js) and its screen-space layout
 *   (src/core/annotation-layout.js): schema and caps, strict versus never-destructive lenient handling of
 *   stored data, derived validity (Valid / Needs Review / Unresolved without fabricated positions),
 *   instance-ID remapping, and the card placement rules. How annotations live inside a Load Plan
 *   (history, duplicate, import, export, backup) is pinned in annotation-lifecycle.spec.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/core/measurements.js';
import * as A from '../../src/core/annotations.js';
import * as L from '../../src/core/annotation-layout.js';

const CASE = {
  id: 'case-1', name: 'Crate', shape: 'box',
  dimensions: { length: 48, width: 24, height: 32 },
};
const instance = (overrides = {}) => ({
  id: 'inst-1', caseId: 'case-1', placement: 'packed',
  transform: { position: { x: 60, y: 100, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  ...overrides,
});
const ground = (x, z) => M.buildSpaceAnchor({ surface: 'ground', point: { x, y: 0, z } });
const onCargo = (instanceId, local = { x: 24, y: 2, z: 3 }) => M.buildCargoAnchor({ instanceId, local, caseData: CASE });
const callout = (id, anchor = ground(5, 5), extra = {}) => A.createCalloutRecord({ id, anchor, title: 'Fragile', now: 1000, ...extra });
const FLOORS = M.buildFloorSurfaces({ shapeMode: 'rect' }, [{ min: { x: 0, y: 0, z: -50 }, max: { x: 600, y: 90, z: 50 } }]);
const context = (overrides = {}) => ({
  getInstance: id => (id === 'inst-1' ? instance() : null),
  getCase: id => (id === 'case-1' ? CASE : null),
  floors: FLOORS,
  ...overrides,
});

// ============================================================================
// SECTION: SCHEMA, CAPS AND TEXT
// ============================================================================

test('the proposed caps and the record shape are exactly the ones the contract names', () => {
  assert.equal(A.MAX_ANNOTATIONS_PER_PACK, 200);
  assert.equal(A.MAX_CALLOUT_TITLE_LENGTH, 48);
  assert.equal(A.MAX_CALLOUT_DESCRIPTION_LENGTH, 140);
  assert.equal(A.MAX_CARD_OFFSET_PX, 2000);
  assert.deepEqual([...A.ANNOTATION_COLORS], ['ink', 'blue', 'green', 'red', 'violet']);
  const created = callout('c1', ground(0, 0), { description: '  Handle   with care ', color: 'red', keepExpanded: true });
  assert.deepEqual(Object.keys(created).sort(),
    ['anchor', 'color', 'createdAt', 'description', 'hidden', 'id', 'keepExpanded', 'offset', 'schemaVersion', 'title', 'type', 'updatedAt']);
  assert.deepEqual([created.type, created.schemaVersion, created.description, created.hidden, created.offset], ['callout', 1, 'Handle with care', false, null]);
  assert.equal(A.validateCalloutRecord(created), null);
  assert.equal(Object.hasOwn(created, 'author'), false, 'no author identity is invented');
  assert.equal(Object.hasOwn(created, 'status'), false, 'nothing derived is stored');
});

test('titles and descriptions are one normalized line within their caps; an unknown color falls back to Ink', () => {
  assert.equal(A.normalizeCalloutTitle('  UNLOAD \n FIRST  '), 'UNLOAD FIRST');
  assert.equal(A.normalizeCalloutTitle('x'.repeat(80)).length, 48);
  assert.equal(A.normalizeCalloutTitle('   '), '');
  assert.equal(A.normalizeCalloutDescription('   '), null);
  assert.equal(A.normalizeCalloutDescription('y'.repeat(300)).length, 140);
  assert.equal(A.normalizeAnnotationColor('magenta'), 'ink');
  assert.equal(A.normalizeAnnotationColor('violet'), 'violet');
  assert.deepEqual(A.normalizeCardOffset({ dx: 10.04, dy: -3.06 }), { dx: 10, dy: -3.1 });
  assert.equal(A.normalizeCardOffset({ dx: 2001, dy: 0 }), null, 'an offset beyond the bound is not stored');
  assert.equal(A.normalizeCardOffset({ dx: NaN, dy: 0 }), null);
  assert.equal(A.normalizeCardOffset(null), null);
});

test('presets only fill editable text: five fixed texts that fit the caps and are never part of a record', () => {
  assert.deepEqual(A.CALLOUT_PRESETS.map(p => p.key), ['Fragile', 'Unload First', 'This Side Up', 'Heavy', 'Customer Pickup']);
  for (const preset of A.CALLOUT_PRESETS) {
    assert.ok(preset.title.length <= A.MAX_CALLOUT_TITLE_LENGTH, preset.key);
    assert.ok(preset.description.length <= A.MAX_CALLOUT_DESCRIPTION_LENGTH, preset.key);
    assert.equal(A.validateCalloutRecord(callout('p', ground(1, 1), { title: preset.title, description: preset.description })), null);
  }
  assert.equal(Object.keys(callout('p')).includes('preset'), false);
});

test('colors: the five built-in names stay valid and a custom color is exactly #RRGGBB, stored lower-case, never replaced', () => {
  for (const name of A.ANNOTATION_COLORS) assert.equal(A.validateCalloutRecord(callout('n', ground(1, 1), { color: name })), null, name);
  const custom = callout('c', ground(1, 1), { color: '#A1b2C3' });
  assert.equal(custom.color, '#a1b2c3', 'canonical lower-case #rrggbb');
  assert.equal(A.validateCalloutRecord(custom), null);
  assert.deepEqual(Object.keys(custom).sort(), Object.keys(callout('d')).sort(), 'no second color field is added');
  // Unsafe or malformed values are refused by the validation gate, not swapped for the default.
  for (const value of ['#fff', '#12345', '#1234567', 'a1b2c3', '#gggggg', 'rgb(0,0,0)', 'url(javascript:alert(1))', '#a1b2c3;x', ' #a1b2c3', 'red;', '', null, 7]) {
    const made = callout('x', ground(1, 1), { color: value });
    assert.notEqual(A.validateCalloutRecord(made), null, `refused: ${String(value)}`);
    assert.equal(A.validateAnnotationCollection([made]).ok, false, `collection refuses ${String(value)}`);
    assert.equal(A.editCalloutRecord(callout('e'), { color: value }, 2000), null, `an edit refuses ${String(value)}`);
  }
  assert.equal(A.editCalloutRecord(callout('e'), { color: '#00FF7F' }, 2000).color, '#00ff7f');
  assert.equal(A.editCalloutRecord(callout('e'), { color: 'violet' }, 2000).color, 'violet');
  assert.equal(A.validateCalloutRecord({ ...callout('s'), color: '#ABCDEF' }), null, 'upper-case hex is a valid stored value and is canonicalised on write');
  assert.equal(A.normalizeAnnotations([{ ...callout('s'), color: '#ABCDEF' }])[0].color, '#abcdef');
  // A stored record with a malformed color is kept verbatim as a recovery record, never defaulted.
  const malformed = { ...callout('m'), color: 'pink' };
  const [kept] = A.normalizeAnnotations([malformed]);
  assert.equal(kept.type, A.ANNOTATION_TYPE_UNREADABLE);
  assert.deepEqual(kept.original, malformed);
  // Display helpers: an unknown value draws as the default, and the foreground contrasts with a custom color.
  assert.equal(A.normalizeAnnotationColor('#12AB34'), '#12ab34');
  assert.equal(A.normalizeAnnotationColor('nope'), 'ink');
  assert.equal(A.annotationForegroundFor('ink'), null);
  const ratio = (a, b) => {
    const lum = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const color of ['#000000', '#ffffff', '#ffff00', '#fde68a', '#0b1020', '#7f7f7f', '#ff9f1c', '#2f6fed', '#f5f5f5', '#101010']) {
    assert.ok(ratio(color, A.annotationForegroundFor(color)) >= 4.5, `readable number on ${color}`);
  }
});

const luminanceOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrastOf = (a, b) => { const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('every accepted marker number reaches 4.5:1: custom colors around the foreground switch and every built-in color in both themes', async () => {
  // Threshold cases: mid-tones neither white nor the near-black text can serve get pure black.
  for (const color of ['#7a7a7a', '#767676', '#777777', '#808080', '#757575', '#6e6e6e', '#8a8a8a', '#959595', '#8b8b8b', '#ff0000', '#00ff00', '#0000ff', '#ffa500', '#808000', '#008080', '#800080']) {
    assert.ok(contrastOf(color, A.annotationForegroundFor(color)) >= 4.5, `${color} -> ${A.annotationForegroundFor(color)} ${contrastOf(color, A.annotationForegroundFor(color)).toFixed(2)}`);
  }
  // A sweep of the whole gray ramp and of saturated hues.
  for (let v = 0; v < 256; v += 3) {
    const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    assert.ok(contrastOf(hex, A.annotationForegroundFor(hex)) >= 4.5, hex);
  }
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
    const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    assert.ok(contrastOf(hex, A.annotationForegroundFor(hex)) >= 4.5, hex);
  }
  // The built-in colors are stylesheet tokens: check what is actually shipped, in both themes.
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../styles/main.css', import.meta.url), 'utf8');
  const block = (start, end) => css.slice(css.indexOf(start), css.indexOf(end, css.indexOf(start)));
  const themes = { light: block(':root {', '/* ================================\n  Dark Theme Tokens'), dark: block("[data-theme='dark'] {", '/* ================================\n  Base Reset') };
  for (const [name, text] of Object.entries(themes)) {
    const token = key => (text.match(new RegExp(`--annot-${key}:\\s*(#[0-9a-fA-F]{6});`)) || [])[1];
    for (const color of ['ink', 'blue', 'green', 'red', 'violet']) {
      const foreground = color === 'ink' ? token('on-ink') : token('on-color');
      assert.ok(token(color) && foreground, `${name} ${color} tokens exist`);
      assert.ok(contrastOf(token(color), foreground) >= 4.5, `${name} ${color}: ${contrastOf(token(color), foreground).toFixed(2)}`);
    }
  }
});

test('validation names the first problem in a stored callout', () => {
  const ok = callout('v');
  assert.equal(A.validateCalloutRecord(ok), null);
  const bad = (patch, pattern) => assert.match(A.validateCalloutRecord({ ...ok, ...patch }) || '', pattern, JSON.stringify(patch).slice(0, 60));
  bad({ id: '' }, /id/);
  bad({ id: 'x'.repeat(65) }, /id/);
  bad({ type: 'arrow' }, /type/);
  bad({ schemaVersion: 2 }, /schemaVersion/);
  bad({ title: '' }, /title/);
  bad({ title: '   ' }, /title/);
  bad({ title: 'x'.repeat(49) }, /title/);
  bad({ title: 7 }, /title/);
  bad({ description: 'y'.repeat(141) }, /description/);
  bad({ description: 5 }, /description/);
  bad({ color: 'pink' }, /color/);
  bad({ keepExpanded: 'yes' }, /flags/);
  bad({ hidden: 1 }, /flags/);
  bad({ offset: { dx: 5000, dy: 0 } }, /offset/);
  bad({ offset: { dx: 'a', dy: 0 } }, /offset/);
  bad({ createdAt: 'now' }, /timestamps/);
  bad({ anchor: null }, /anchor/);
  bad({ anchor: { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } } }, /surface/);
  // A cargo point must lie on the saved cargo surface, exactly as for measurements.
  bad({ anchor: { ...onCargo('inst-1'), local: { x: 0, y: 0, z: 0 } } }, /not on the surface/);
  assert.equal(A.validateCalloutRecord({ ...ok, description: null, offset: { dx: -2000, dy: 2000 } }), null, 'the bounds themselves are allowed');
});

// ============================================================================
// SECTION: STORED DATA (lenient, never destructive) AND IMPORT (strict)
// ============================================================================

test('lenient normalization never drops, coerces or truncates what it cannot read', () => {
  assert.deepEqual(A.normalizeAnnotations(undefined), []);
  assert.deepEqual(A.normalizeAnnotations(null), []);
  const good = callout('good');
  const malformed = { id: 'bad', type: 'callout', title: '', anchor: { kind: 'mystery' } };
  const future = { id: 'arr', type: 'arrow', schemaVersion: 1, a: {}, b: {} };
  const newer = { ...good, id: 'newer', schemaVersion: 9 };
  const list = [good, malformed, 'garbage', 42, null, future, newer];
  const frozen = JSON.stringify(list);
  const out = A.normalizeAnnotations(list);
  assert.equal(JSON.stringify(list), frozen, 'the stored input is not mutated');
  assert.equal(out.length, list.length, 'nothing is dropped');
  assert.deepEqual(out[0], good);
  assert.equal(out[1].type, A.ANNOTATION_TYPE_UNREADABLE);
  assert.deepEqual(out[1].original, malformed, 'the original is kept verbatim for recovery');
  assert.deepEqual(out[2].original, 'garbage');
  assert.deepEqual(out[4].original, null);
  assert.equal(out[5].reason, 'Saved by a newer version of the app.', 'a record of a later release is preserved and explained');
  assert.deepEqual(out[5].original, future);
  assert.equal(out[6].reason, 'Saved by a newer version of the app.');
  assert.equal(new Set(out.map(r => r.id)).size, out.length, 'recovery IDs are unique');
  // The wrapper is itself stable: normalizing normalized data changes nothing.
  assert.equal(A.normalizeAnnotations(out), out);
  assert.deepEqual(A.normalizeAnnotations(JSON.parse(JSON.stringify(out))), out);
});

test('a non-list container and a duplicate ID are preserved as recovery records', () => {
  const wrapped = A.normalizeAnnotations({ not: 'a list' });
  assert.equal(wrapped.length, 1);
  assert.deepEqual(wrapped[0].original, { not: 'a list' });
  const twin = callout('twin');
  const out = A.normalizeAnnotations([twin, { ...twin, title: 'Second' }]);
  assert.equal(out[0].type, A.ANNOTATION_TYPE_CALLOUT);
  assert.equal(out[1].type, A.ANNOTATION_TYPE_UNREADABLE);
  assert.equal(out[1].reason, 'Duplicate annotation ID in this Load Plan.');
  assert.equal(out[1].original.title, 'Second');
});

test('strict validation rejects the whole collection and never truncates or repairs', () => {
  const good = callout('g');
  assert.deepEqual(A.validateAnnotationCollection(undefined), { ok: true, annotations: [] });
  assert.deepEqual(A.validateAnnotationCollection([good]).annotations, [good]);
  assert.match(A.validateAnnotationCollection('nope').error, /expected an array/);
  assert.match(A.validateAnnotationCollection([good, { ...good, anchor: { kind: 'cargo' } }]).error, /annotations\[1\]/);
  assert.match(A.validateAnnotationCollection([good, good]).error, /duplicate annotation id "g"/);
  const many = n => Array.from({ length: n }, (_, i) => callout(`c${i}`, ground(i, 1)));
  assert.equal(A.validateAnnotationCollection(many(200)).annotations.length, 200, 'exactly 200 is allowed');
  assert.match(A.validateAnnotationCollection(many(201)).error, /too many annotations \(201; maximum 200\)/);
  // A reference to cargo that no longer exists is structurally valid: retained, resolved as Unresolved later.
  assert.equal(A.validateAnnotationCollection([callout('dangling', onCargo('gone'))]).ok, true);
  // An explicit recovery record is accepted and returned canonical.
  const recovery = A.normalizeAnnotations([{ id: 'x' }])[0];
  assert.deepEqual(A.validateAnnotationCollection([recovery]).annotations, [recovery]);
  const withoutOriginal = Object.fromEntries(Object.entries(recovery).filter(([key]) => key !== 'original'));
  assert.match(A.validateAnnotationCollection([withoutOriginal]).error, /annotations\[0\]/, 'a recovery record must carry what it recovers');
});

// ============================================================================
// SECTION: PURE EDITS
// ============================================================================

test('editing text and presentation preserves the anchor, identity and creation time; an empty title is refused', () => {
  const base = callout('e', onCargo('inst-1'), { description: 'old' });
  const edited = A.editCalloutRecord(base, { title: '  New   title ', description: '', color: 'green', keepExpanded: true, hidden: true, id: 'hijack', anchor: ground(9, 9) }, 5000);
  assert.deepEqual([edited.title, edited.description, edited.color, edited.keepExpanded, edited.hidden], ['New title', null, 'green', true, true]);
  assert.deepEqual([edited.id, edited.createdAt, edited.updatedAt], ['e', 1000, 5000]);
  assert.deepEqual(edited.anchor, base.anchor, 'unknown patch keys (id, anchor) are ignored');
  assert.equal(A.editCalloutRecord(base, { title: '   ' }, 5000), null);
  assert.equal(A.editCalloutRecord({ ...base, type: 'arrow' }, { title: 'x' }, 5000), null);
  assert.equal(A.editCalloutRecord(base, { title: 'x' }, NaN), null);
});

test('moving the marker re-attaches to a validated anchor and keeps the card offset; moving the card keeps the anchor', () => {
  const base = callout('m', ground(5, 5), { offset: { dx: 40, dy: -30 } });
  const target = onCargo('inst-1');
  const moved = A.reattachCalloutRecord(base, target, 7000);
  assert.deepEqual(moved.anchor, target);
  assert.deepEqual(moved.offset, { dx: 40, dy: -30 }, 'the card travels with the marker');
  assert.deepEqual([moved.title, moved.createdAt, moved.updatedAt], ['Fragile', 1000, 7000]);
  assert.equal(A.reattachCalloutRecord(base, { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } }, 7000), null);
  assert.equal(A.reattachCalloutRecord(base, { ...target, local: { x: 0, y: 0, z: 0 } }, 7000), null, 'a point off the cargo surface is refused');

  const dragged = A.offsetCalloutRecord(base, { dx: 12.34, dy: 5 }, 8000);
  assert.deepEqual(dragged.offset, { dx: 12.3, dy: 5 });
  assert.deepEqual(dragged.anchor, base.anchor, 'dragging a card never changes the anchor');
  assert.equal(A.offsetCalloutRecord(base, null, 8000).offset, null, 'null returns the card to automatic placement');
  assert.equal(A.offsetCalloutRecord(base, { dx: 9999, dy: 0 }, 8000), null);
});

// ============================================================================
// SECTION: DERIVED VALIDITY (no fabricated positions)
// ============================================================================

test('Valid carries a position; Needs Review and Unresolved never do and explain themselves', () => {
  const onGround = A.resolveAnnotation(callout('g', ground(10, 20)), context());
  assert.deepEqual([onGround.status, onGround.reason, onGround.point], ['valid', null, { x: 10, y: 0, z: 20 }]);

  const cargo = A.resolveAnnotation(callout('c', onCargo('inst-1')), context());
  assert.equal(cargo.status, 'valid');
  assert.deepEqual(cargo.point, { x: 84, y: 102, z: 3 }, 'cargo-local point + committed pose');

  const resized = A.resolveAnnotation(callout('c', onCargo('inst-1')), context({ getCase: () => ({ ...CASE, dimensions: { ...CASE.dimensions, length: 60 } }) }));
  assert.deepEqual([resized.status, resized.reason, resized.point], ['needs-review', 'case-changed', null]);
  assert.match(A.describeAnnotationReason(resized.reason), /Re-attach/);

  const missing = A.resolveAnnotation(callout('c', onCargo('inst-1')), context({ getInstance: () => null }));
  assert.deepEqual([missing.status, missing.reason, missing.point], ['unresolved', 'cargo-missing', null]);

  const ambiguous = A.resolveAnnotation(callout('c', onCargo('inst-1')), context({ isInstanceAmbiguous: () => true }));
  assert.deepEqual([ambiguous.status, ambiguous.reason], ['unresolved', 'cargo-ambiguous']);

  const noCase = A.resolveAnnotation(callout('c', onCargo('inst-1')), context({ getCase: () => null }));
  assert.deepEqual([noCase.status, noCase.reason], ['unresolved', 'case-missing'], 'a missing Case definition cannot verify the point');

  const floor = M.buildFloorAnchor({ surface: 'main', point: { x: 100, y: 0, z: 0 } });
  assert.equal(A.resolveAnnotation(callout('f', floor), context()).status, 'valid');
  assert.deepEqual(
    [A.resolveAnnotation(callout('f', floor), context({ floors: [] })).status, A.resolveAnnotation(callout('f', floor), context({ floors: [] })).reason],
    ['unresolved', 'floor-missing']);

  const unreadable = A.resolveAnnotation(A.normalizeAnnotations([{ id: 'u' }])[0], context());
  assert.deepEqual([unreadable.status, unreadable.reason, unreadable.point], ['unresolved', 'unreadable', null]);

  for (const reason of ['cargo-missing', 'cargo-ambiguous', 'case-missing', 'case-changed', 'pose-invalid', 'floor-missing', 'floor-changed', 'truck-changed', 'truck-unverified', 'point-invalid', 'unreadable']) {
    assert.ok(A.describeAnnotationReason(reason).length > 20, `${reason} is explained`);
  }
  assert.equal(A.describeAnnotationReason('nonsense'), '');
  assert.deepEqual([A.annotationStatusLabel('valid'), A.annotationStatusLabel('needs-review'), A.annotationStatusLabel('unresolved')], ['Valid', 'Needs review', 'Unresolved']);
});

test('a non-finite resolved position is Unresolved, never a number', () => {
  const overflow = { ...instance(), transform: { position: { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } };
  // 24 + MAX_VALUE is still finite, so force the guard through a rotation that overflows the sum.
  const huge = { ...overflow, transform: { ...overflow.transform, rotation: { x: 0, y: 0, z: Math.PI / 2 } } };
  const resolved = A.resolveAnnotation(callout('h', onCargo('inst-1', { x: 24, y: 2, z: 3 })), context({ getInstance: () => huge }));
  assert.ok(resolved.status === 'valid' ? Number.isFinite(resolved.point.x) && Number.isFinite(resolved.point.y) : resolved.point === null);
  assert.deepEqual(A.resolveAnnotationList([callout('a'), { id: 'junk' }], context()).map(r => r.status), ['valid', 'unresolved']);
});

// ============================================================================
// SECTION: CARGO IDENTITY (duplicate, import, normalization)
// ============================================================================

test('remapping follows the one identity policy and leaves everything else untouched', () => {
  const list = [callout('a', onCargo(' old-1 ')), callout('b', onCargo('stranger')), callout('c', ground(1, 1))];
  const remapped = A.remapAnnotationInstanceIds(list, new Map([['old-1', 'new-1']]));
  assert.equal(remapped[0].anchor.instanceId, 'new-1', 'a trimmed-equal ID follows the map');
  assert.equal(remapped[1].anchor.instanceId, 'stranger', 'an anchor the map does not know stays as it is (Unresolved), never guessed');
  assert.equal(remapped[2], A.normalizeAnnotations(list)[2]);
  const untouched = A.remapAnnotationInstanceIds(list, new Map());
  assert.equal(untouched, A.normalizeAnnotations(list), 'nothing changed: the normalized list itself is returned');
  assert.equal(A.remapAnnotationInstanceIds(undefined, new Map([['a', 'b']])).length, 0);
  assert.equal(A.remapAnnotationInstanceIds(list, { 'old-1': 'plain-object' })[0].anchor.instanceId, 'plain-object');
});

test('an annotation on a contested ID is withheld whole and verbatim, so the survivor never inherits it', () => {
  const identity = M.canonicalizeInstanceIds(['cargo', ' cargo '], () => 'minted', [true, false]);
  assert.deepEqual([...identity.contestedKeys], ['cargo']);
  const raw = [callout('contested', onCargo(' cargo ')), callout('fine', ground(2, 2)), callout('other', onCargo('elsewhere'))];
  const carried = A.carryAnnotationsThroughIdentity(raw, identity);
  assert.equal(carried[0].type, A.ANNOTATION_TYPE_UNREADABLE);
  assert.deepEqual(carried[0].original, raw[0], 'the original record is preserved verbatim');
  assert.equal(carried[1].type, A.ANNOTATION_TYPE_CALLOUT);
  assert.equal(carried[2].anchor.instanceId, 'elsewhere', 'a dangling reference is left as it is');
  assert.equal(A.carryAnnotationsThroughIdentity(carried, identity)[0].type, A.ANNOTATION_TYPE_UNREADABLE, 'idempotent');
  const clean = M.canonicalizeInstanceIds(['a', 'b'], () => 'minted');
  assert.equal(A.carryAnnotationsThroughIdentity(raw, clean), A.remapAnnotationInstanceIds(raw, clean.idMap));
});

// ============================================================================
// SECTION: DISPLAY HELPERS
// ============================================================================

test('callouts are numbered in stored order and the attached-to line names the surface', () => {
  const list = A.normalizeAnnotations([callout('a'), { id: 'junk' }, callout('b'), callout('c')]);
  assert.deepEqual([...A.calloutNumbers(list)], [['a', 1], ['b', 2], ['c', 3]], 'unreadable records take no number');
  assert.equal(A.describeAnchorTarget(onCargo('i'), 'Amp Rack 02'), 'Amp Rack 02');
  assert.equal(A.describeAnchorTarget(onCargo('i')), 'Cargo');
  const surfaces = { main: 'Truck floor', 'well-top': 'Wheel Well top', deck: 'Over-cab deck' };
  for (const [surface, label] of Object.entries(surfaces)) assert.equal(A.describeAnchorTarget({ kind: 'floor', surface }), label);
  for (const surface of M.SPACE_SURFACES) assert.ok(A.describeAnchorTarget({ kind: 'space', surface }).length > 2, surface);
  assert.equal(A.describeAnchorTarget(null), '');
});

// ============================================================================
// SECTION: LAYOUT
// ============================================================================

const VIEW = { width: 848, height: 778 };

test('the card budget follows the viewport area: about nine on a desktop, two on a phone', () => {
  assert.equal(L.cardBudget(848, 778), 9);
  assert.equal(L.cardBudget(1200, 900), 9, 'capped');
  assert.equal(L.cardBudget(366, 718), 2);
  assert.equal(L.cardBudget(300, 200), 2, 'never below two');
  assert.equal(L.cardBudget(0, 0), 2);
  assert.equal(L.cardBudget(640, 300), 2);
  assert.equal(L.cardBudget(900, 400), 5);
  assert.deepEqual([L.isCompactViewport(499), L.isCompactViewport(500), L.cardWidth(390), L.cardWidth(800)], [true, false, 176, 208]);
});

test('a stored offset puts the card at marker + offset, clamped for display only', () => {
  const marker = { x: 400, y: 300 };
  const size = { w: 208, h: 90 };
  assert.deepEqual(L.rectFromOffset(marker, { dx: 30, dy: -120 }, size, VIEW), { x: 430, y: 180, w: 208, h: 90 });
  // Near the right edge the card is pushed back inside; the stored offset is not rewritten.
  const edge = L.rectFromOffset({ x: 800, y: 300 }, { dx: 30, dy: 0 }, size, VIEW);
  assert.equal(edge.x + edge.w, VIEW.width - L.VIEWPORT_MARGIN);
  const top = L.rectFromOffset({ x: 400, y: 20 }, { dx: 0, dy: -200 }, size, VIEW);
  assert.equal(top.y, L.VIEWPORT_MARGIN);
  // Round trip: the offset that reproduces a rect is the one stored.
  const rect = { x: 430, y: 180, w: 208, h: 90 };
  assert.deepEqual(L.rectFromOffset(marker, L.offsetFromRect(marker, rect), size, VIEW), rect);
  assert.deepEqual(L.offsetFromRect({ x: 10.04, y: 20 }, { x: 20, y: 10, w: 1, h: 1 }), { dx: 10, dy: -10 });
  // A viewport smaller than the card pins it to the top-left margin instead of producing negatives.
  assert.deepEqual(L.clampRect({ x: 300, y: 300, w: 400, h: 400 }, { width: 200, height: 200 }), { x: 8, y: 8, w: 400, h: 400 });
  // A camera move shifts the marker and the card follows with the same offset.
  const moved = L.rectFromOffset({ x: 410, y: 310 }, { dx: 30, dy: -120 }, size, VIEW);
  assert.deepEqual([moved.x - 430, moved.y - 180], [10, 10]);
});

test('automatic placement avoids other cards and markers, stays inside the viewport and is stable until it must move', () => {
  const marker = { x: 400, y: 300 };
  const size = { w: 208, h: 70 };
  const first = L.autoPlace({ marker, size, viewport: VIEW });
  assert.equal(first.slot, 0, 'up and to the right of the marker when nothing is in the way');
  assert.ok(first.x >= marker.x && first.y + first.h <= marker.y, 'above-right');
  assert.ok(first.x >= L.VIEWPORT_MARGIN && first.x + first.w <= VIEW.width - L.VIEWPORT_MARGIN);
  // Another card there pushes this one to a different slot with no overlap.
  const second = L.autoPlace({ marker, size, viewport: VIEW, occupied: [first] });
  assert.notEqual(second.slot, first.slot);
  assert.equal(L.overlapArea(second, first), 0);
  // Stability: a previous slot that is still clean is kept even if an earlier slot is now free.
  const kept = L.autoPlace({ marker, size, viewport: VIEW, previousSlot: second.slot });
  assert.equal(kept.slot, second.slot);
  // ... and abandoned when it collides.
  const moved = L.autoPlace({ marker, size, viewport: VIEW, previousSlot: second.slot, occupied: [second] });
  assert.notEqual(moved.slot, second.slot);
  assert.equal(L.overlapArea(moved, second), 0);
  // Never sits on its own marker, even in a corner.
  const corner = L.autoPlace({ marker: { x: 20, y: 20 }, size, viewport: VIEW });
  assert.ok(!(corner.x - 4 < 20 && 20 < corner.x + corner.w + 4 && corner.y - 4 < 20 && 20 < corner.y + corner.h + 4));
  // Out-of-range or non-integer previous slots are ignored.
  for (const previousSlot of [-1, 99, 1.5, null, 'x']) assert.equal(L.autoPlace({ marker, size, viewport: VIEW, previousSlot }).slot, 0);
  // With every slot crowded the least bad one is returned, still inside the viewport.
  const crowd = Array.from({ length: 30 }, (_, i) => ({ x: (i % 6) * 140, y: Math.floor(i / 6) * 150, w: 140, h: 150 }));
  const worst = L.autoPlace({ marker, size, viewport: VIEW, occupied: crowd });
  assert.ok(worst.x >= L.VIEWPORT_MARGIN && worst.y >= L.VIEWPORT_MARGIN);
  assert.equal(typeof worst.slot, 'number');
});

test('in a crowded view a label is dropped rather than covering another label or marker; the marker itself is never dropped', () => {
  const pinAt = (id, x, y) => ({ id, x: x - 12, y: y - 12, w: 24, h: 24 });
  const label = (id, x, y, text = 'FRAGILE') => ({ id, marker: { x, y }, text });
  // Alone, a label sits beside its marker (the right side, or the left near the right-hand edge) and is kept.
  const right = L.labelRect({ x: 100, y: 100 }, 'FRAGILE', 800);
  assert.ok(right.x > 100 && right.y < 100 && right.y + right.h > 100);
  const left = L.labelRect({ x: 700, y: 100 }, 'FRAGILE', 800);
  assert.ok(left.x + left.w < 700, 'flips to the left near the right-hand edge');
  assert.ok(L.labelRect({ x: 100, y: 100 }, 'x'.repeat(200), 800).w <= 150, 'a long title is capped like the chip');
  assert.deepEqual([...L.fitLabels([label('a', 100, 100)], [pinAt('a', 100, 100)], 800)], ['a']);
  // Two labels that would overlap each other (neither covers the other's marker): the first in priority order wins.
  const crowded = L.fitLabels([label('a', 100, 100), label('b', 90, 112)], [pinAt('a', 100, 100), pinAt('b', 90, 112)], 800);
  assert.deepEqual([...crowded], ['a'], 'priority order wins and the other label is dropped');
  // Markers 20px apart: a's label would sit on b's marker, so it is dropped; b's label is clear and kept.
  assert.deepEqual([...L.fitLabels([label('a', 100, 100), label('b', 120, 100)], [pinAt('a', 100, 100), pinAt('b', 120, 100)], 800)], ['b']);
  // A label that would sit on another marker is dropped even when no other label is there.
  assert.equal(L.fitLabels([label('a', 100, 100)], [pinAt('a', 100, 100), pinAt('b', 130, 100)], 800).size, 0);
  // Well-separated markers all keep their labels, and a dense field keeps only non-overlapping ones.
  const apart = [0, 1, 2, 3].map(i => label(`p${i}`, 100 + i * 300, 100));
  assert.equal(L.fitLabels(apart, apart.map(l => pinAt(l.id, l.marker.x, l.marker.y)), 1400).size, 4);
  const dense = Array.from({ length: 200 }, (_, i) => label(`d${i}`, 20 + (i % 40) * 14, 50 + Math.floor(i / 40) * 16));
  const kept = L.fitLabels(dense, dense.map(l => pinAt(l.id, l.marker.x, l.marker.y)), 1400);
  assert.ok(kept.size < 200);
  const rects = dense.filter(l => kept.has(l.id)).map(l => L.labelRect(l.marker, l.text, 1400));
  rects.forEach((a, i) => rects.slice(i + 1).forEach(b => assert.equal(L.overlapArea(a, b), 0, 'kept labels never overlap')));
});

test('the leader line joins marker and card, starts clear of the marker and vanishes when they touch', () => {
  const marker = { x: 100, y: 100 };
  const line = L.leaderLine(marker, { x: 200, y: 60, w: 208, h: 70 });
  assert.deepEqual([line.x2, line.y2], [200, 100], 'ends on the nearest point of the card');
  assert.ok(Math.abs(Math.hypot(line.x1 - 100, line.y1 - 100) - L.LEADER_START_GAP) < 1e-9);
  assert.equal(L.leaderLine(marker, { x: 104, y: 80, w: 208, h: 70 }), null, 'a card right beside the marker needs no line');
  assert.equal(L.leaderLine(marker, { x: 60, y: 60, w: 208, h: 70 }), null, 'a card over the marker needs none either');
  assert.equal(L.estimateCardHeight(null), 58);
  assert.ok(L.estimateCardHeight('x'.repeat(140)) > L.estimateCardHeight('x'.repeat(10)));
});
