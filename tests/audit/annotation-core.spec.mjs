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
  const future = { id: 'drw', type: 'draw', schemaVersion: 1, points: [] };
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
// SECTION: ARROWS (V1B.1) — record, gates, identity, resolution
// ============================================================================

const FLOOR_ANCHOR = M.buildFloorAnchor({ surface: 'main', point: { x: 100, y: 0, z: 0 } });
const arrow = (id, start = ground(5, 5), end = ground(40, 5), extra = {}) => A.createArrowRecord({ id, start, end, now: 1000, ...extra });
const ARROW_KEYS = ['color', 'createdAt', 'end', 'hidden', 'id', 'schemaVersion', 'start', 'type', 'updatedAt', 'width'];

test('an arrow is exactly the contracted record: two independent anchors, presentation only, nothing derived', () => {
  const made = arrow('a1', onCargo('inst-1'), FLOOR_ANCHOR, { color: '#A1B2C3', width: 'bold' });
  assert.deepEqual(Object.keys(made).sort(), ARROW_KEYS);
  assert.deepEqual([made.type, made.schemaVersion, made.color, made.width, made.hidden, made.createdAt, made.updatedAt], ['arrow', 1, '#a1b2c3', 'bold', false, 1000, 1000]);
  assert.equal(A.ANNOTATION_SCHEMA_VERSION, 1, 'the schema version is unchanged');
  const defaults = arrow('a2');
  assert.deepEqual([defaults.color, defaults.width, defaults.hidden], ['ink', 'regular', false]);
  assert.deepEqual([...A.ARROW_WIDTHS], ['thin', 'regular', 'bold']);
  assert.equal(A.validateArrowRecord(made), null);
  for (const key of ['label', 'title', 'offset', 'status', 'length', 'anchor']) assert.equal(Object.hasOwn(made, key), false, `no ${key}`);
  assert.deepEqual(A.normalizeAnnotations([made]), [made], 'canonical form is the record itself');
  assert.deepEqual(A.validateAnnotationCollection([made]).annotations, [made]);
  assert.deepEqual(A.normalizeAnnotations(JSON.parse(JSON.stringify([made]))), [made], 'survives a JSON round trip exactly');
  // An invalid value is kept as given so the gate refuses the write; it is never replaced by a default.
  assert.notEqual(A.validateArrowRecord(arrow('w', ground(1, 1), ground(9, 9), { width: 'huge' })), null);
  assert.notEqual(A.validateArrowRecord(arrow('c', ground(1, 1), ground(9, 9), { color: 'pink' })), null);
});

test('arrow validation names the first problem, rejects unknown top-level keys and leaves callout validation alone', () => {
  const ok = arrow('v', onCargo('inst-1'), ground(40, 5));
  const bad = (patch, pattern) => assert.match(A.validateArrowRecord({ ...ok, ...patch }) || '', pattern, JSON.stringify(patch).slice(0, 60));
  bad({ id: '' }, /id/);
  bad({ id: 'x'.repeat(65) }, /id/);
  bad({ type: 'callout' }, /type/);
  bad({ schemaVersion: 2 }, /schemaVersion/);
  bad({ color: 'pink' }, /color/);
  bad({ color: '#12' }, /color/);
  bad({ width: 'huge' }, /width/);
  bad({ width: undefined }, /width/);
  bad({ width: 3 }, /width/);
  bad({ hidden: 1 }, /flags/);
  bad({ createdAt: 'now' }, /timestamps/);
  bad({ updatedAt: NaN }, /timestamps/);
  bad({ start: null }, /start/);
  bad({ end: { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } } }, /end\.surface/);
  bad({ start: { ...onCargo('inst-1'), local: { x: 0, y: 0, z: 0 } } }, /start is not on the surface/);
  bad({ label: 'Door' }, /unsupported field/);
  bad({ title: 'x' }, /unsupported field/);
  bad({ anchor: ground(1, 1) }, /unsupported field/);
  bad({ end: ok.start }, /same point/);
  bad({ end: { ...ok.start, junk: 1 } }, /same point/);
  assert.match(A.validateArrowRecord(JSON.parse('{"__proto__": {"x": 1}, "id": "p", "type": "arrow", "schemaVersion": 1}')) || '', /unsupported field/, 'a __proto__ key is just an unknown key');
  assert.match(A.validateArrowRecord(null), /object/);
  // Callouts: the V1A validator is unchanged and still refuses an arrow as "not a callout".
  assert.match(A.validateCalloutRecord(ok), /type/);
  assert.match(A.validateArrowRecord(callout('c')), /type/);
});

test('lenient normalization keeps a valid arrow, wraps every unreadable one verbatim and never converts a wrapper', () => {
  const good = arrow('good', onCargo('inst-1'), FLOOR_ANCHOR);
  const malformed = { ...arrow('bad'), width: 'huge' };
  const extra = { ...arrow('extra'), label: 'Door', note: { nested: true } };
  const newer = { ...arrow('newer'), schemaVersion: 9 };
  const sameEnds = { ...arrow('same'), end: ground(5, 5) };
  const legacy = { id: 'arrow-1', type: 'arrow', schemaVersion: 1 };
  const draw = { id: 'drw', type: 'draw', schemaVersion: 1, points: [1, 2] };
  const list = [good, malformed, extra, newer, sameEnds, legacy, draw, callout('c')];
  const frozen = JSON.stringify(list);
  const out = A.normalizeAnnotations(list);
  assert.equal(JSON.stringify(list), frozen, 'the stored input is not mutated');
  assert.equal(out.length, list.length, 'nothing is dropped');
  assert.deepEqual(out[0], good);
  assert.deepEqual(out.slice(1, 7).map(r => r.type), Array(6).fill(A.ANNOTATION_TYPE_UNREADABLE));
  assert.deepEqual([malformed, extra, newer, sameEnds, legacy, draw].map((original, i) => out[i + 1].original), [malformed, extra, newer, sameEnds, legacy, draw],
    'every original is preserved verbatim, including an unknown key');
  assert.equal(out[2].original.note.nested, true);
  assert.equal(out[1].reason, 'The saved annotation could not be read.', 'a malformed arrow is damaged, not "from a newer version"');
  assert.equal(out[2].reason, 'The saved annotation could not be read.');
  assert.equal(out[3].reason, 'Saved by a newer version of the app.', 'a later schemaVersion is');
  assert.equal(out[6].reason, 'Saved by a newer version of the app.', 'draw stays a future type until V1B.2');
  assert.equal(out[7].type, A.ANNOTATION_TYPE_CALLOUT);
  assert.equal(new Set(out.map(r => r.id)).size, out.length);
  assert.equal(A.normalizeAnnotations(out), out, 'idempotent');
  assert.deepEqual(A.normalizeAnnotations(JSON.parse(JSON.stringify(out))), out);
  // Arrow and callout share one ID space.
  const twin = A.normalizeAnnotations([callout('same-id'), arrow('same-id')]);
  assert.deepEqual([twin[0].type, twin[1].type, twin[1].reason], ['callout', 'unreadable', 'Duplicate annotation ID in this Load Plan.']);
  assert.deepEqual(twin[1].original, arrow('same-id'));
});

test('an unreadable wrapper stays inert even when its original is a valid arrow with a unique current holder', () => {
  const inner = arrow('inner', onCargo('inst-1'), FLOOR_ANCHOR);
  const wrapper = { id: 'w', type: 'unreadable', schemaVersion: 1, reason: 'Saved by a newer version of the app.', original: inner };
  const ctx = context();
  assert.equal(A.resolveAnnotation(A.normalizeAnnotations([wrapper])[0], ctx).status, 'unresolved', 'the wrapped arrow is not drawable');
  assert.equal(A.resolveAnnotation(inner, ctx).status, 'valid', 'control: the same arrow outside a wrapper resolves');
  const normalized = A.normalizeAnnotations([wrapper]);
  assert.deepEqual(normalized, [wrapper], 'not converted');
  assert.deepEqual(A.validateAnnotationCollection([wrapper]).annotations, [wrapper], 'import and restore accept it verbatim');
  const identity = M.canonicalizeInstanceIds(['inst-1'], () => 'minted');
  assert.deepEqual(A.carryAnnotationsThroughIdentity([wrapper], identity), [wrapper], 'identity decisions never reach inside a wrapper');
  assert.deepEqual(A.remapAnnotationInstanceIds([wrapper], new Map([['inst-1', 'other']])), [wrapper], 'nor does a duplicate or import remap');
  const contested = M.canonicalizeInstanceIds(['inst-1', ' inst-1 '], () => 'minted', [true, false]);
  assert.deepEqual(A.carryAnnotationsThroughIdentity([wrapper], contested), [wrapper], 'a contested key does not re-wrap or unwrap it either');
  // A wrapper whose original is a callout is just as inert.
  const calloutWrapper = { id: 'cw', type: 'unreadable', schemaVersion: 1, reason: 'x', original: callout('inner-c', onCargo('inst-1')) };
  assert.deepEqual(A.normalizeAnnotations([calloutWrapper]), [calloutWrapper]);
});

test('strict validation accepts arrows and wrappers, rejects anything unreadable, draw or unknown, and shares the 200 cap', () => {
  const good = arrow('g', onCargo('inst-1'), ground(40, 5));
  const dangling = arrow('d', onCargo('gone'), FLOOR_ANCHOR);
  const wrapper = A.normalizeAnnotations([{ id: 'x' }])[0];
  const mixed = A.validateAnnotationCollection([callout('c'), good, dangling, wrapper]);
  assert.equal(mixed.ok, true, 'a reference to missing cargo is valid, resolved as Unresolved later');
  assert.deepEqual(mixed.annotations, [callout('c'), good, dangling, wrapper]);
  const err = entry => A.validateAnnotationCollection([callout('c'), entry]).error || '';
  assert.match(err({ ...good, width: 'huge' }), /annotations\[1\] width is invalid/);
  assert.match(err({ ...good, label: 'x' }), /annotations\[1\] record has an unsupported field/);
  assert.match(err({ ...good, schemaVersion: 2 }), /annotations\[1\] schemaVersion/);
  assert.match(err({ ...good, end: good.start }), /annotations\[1\] start and end are the same point/);
  assert.match(err({ id: 'drw', type: 'draw', schemaVersion: 1, points: [] }), /annotations\[1\] type is not supported/, 'draw is not accepted until V1B.2');
  assert.match(A.validateAnnotationCollection([callout('c'), { ...good, id: 'c' }]).error, /duplicate annotation id "c"/);
  const callouts = n => Array.from({ length: n }, (_, i) => callout(`c${i}`, ground(i, 1)));
  assert.equal(A.validateAnnotationCollection([...callouts(199), good]).annotations.length, 200, 'callouts and arrows share one cap');
  assert.match(A.validateAnnotationCollection([...callouts(200), good]).error, /too many annotations \(201; maximum 200\)/);
  assert.match(A.validateAnnotationCollection([good, ...callouts(199), wrapper]).error, /too many annotations/, 'recovery records count too');
});

test('editing an arrow changes only presentation; moving an endpoint changes only that endpoint', () => {
  const base = arrow('e', onCargo('inst-1'), ground(40, 5));
  const edited = A.editArrowRecord(base, { color: '#00FF7F', width: 'thin', hidden: true, id: 'hijack', start: FLOOR_ANCHOR, type: 'callout' }, 5000);
  assert.deepEqual([edited.color, edited.width, edited.hidden], ['#00ff7f', 'thin', true]);
  assert.deepEqual([edited.id, edited.type, edited.createdAt, edited.updatedAt], ['e', 'arrow', 1000, 5000]);
  assert.deepEqual([edited.start, edited.end], [base.start, base.end], 'unknown patch keys (id, start, type) are ignored');
  assert.equal(A.editArrowRecord(base, { width: 'huge' }, 5000), null);
  assert.equal(A.editArrowRecord(base, { color: 'url(x)' }, 5000), null);
  assert.equal(A.editArrowRecord(base, { color: 'violet' }, 5000).color, 'violet');
  assert.equal(A.editArrowRecord(base, { width: 'bold' }, NaN), null);
  assert.equal(A.editArrowRecord(callout('c'), { width: 'bold' }, 5000), null, 'only an arrow can be edited as one');
  assert.equal(A.editArrowRecord(base, null, 5000), null);

  const moved = A.replaceArrowEndpoint(base, 'end', FLOOR_ANCHOR, 7000);
  assert.deepEqual([moved.start, moved.end], [base.start, FLOOR_ANCHOR]);
  assert.deepEqual([moved.color, moved.width, moved.id, moved.createdAt, moved.updatedAt], [base.color, base.width, 'e', 1000, 7000]);
  assert.deepEqual(A.replaceArrowEndpoint(base, 'start', ground(9, 9), 7000).end, base.end, 'the other end is untouched');
  assert.equal(A.replaceArrowEndpoint(base, 'middle', FLOOR_ANCHOR, 7000), null);
  assert.equal(A.replaceArrowEndpoint(base, 'end', { kind: 'space', surface: 'sky', position: { x: 0, y: 0, z: 0 } }, 7000), null);
  assert.equal(A.replaceArrowEndpoint(base, 'end', { ...onCargo('inst-1'), local: { x: 0, y: 0, z: 0 } }, 7000), null, 'a point off the cargo surface is refused');
  assert.equal(A.replaceArrowEndpoint(base, 'end', base.start, 7000), null, 'both ends cannot name the same point');
  assert.equal(A.replaceArrowEndpoint(callout('c'), 'end', FLOOR_ANCHOR, 7000), null);
  assert.equal(A.replaceArrowEndpoint(base, 'end', FLOOR_ANCHOR, NaN), null);
});

test('arrow resolution is the worst of its two ends and carries positions only when both are Valid', () => {
  const resolve = (record, overrides) => A.resolveAnnotation(record, context(overrides));
  const ok = resolve(arrow('a', onCargo('inst-1'), ground(10, 20)));
  assert.deepEqual([ok.status, ok.reason, ok.point, ok.start, ok.end], ['valid', null, null, { x: 84, y: 102, z: 3 }, { x: 10, y: 0, z: 20 }]);
  assert.deepEqual([ok.startStatus, ok.endStatus, ok.startReason, ok.endReason], ['valid', 'valid', null, null]);
  assert.equal(resolve(arrow('a', onCargo('inst-1'), FLOOR_ANCHOR)).status, 'valid', 'cargo to floor');
  const surface = M.buildSpaceAnchor({ surface: 'ground', point: { x: 3, y: 0, z: 3 } });
  assert.equal(resolve(arrow('a', surface, onCargo('inst-1'))).status, 'valid', 'space to cargo');

  const missing = resolve(arrow('a', onCargo('inst-1'), ground(10, 20)), { getInstance: () => null });
  assert.deepEqual([missing.status, missing.reason, missing.start, missing.end], ['unresolved', 'cargo-missing', null, null], 'no half arrow');
  assert.deepEqual([missing.startStatus, missing.startReason, missing.endStatus, missing.endReason], ['unresolved', 'cargo-missing', 'valid', null], 'the broken end is named');
  const resized = resolve(arrow('a', ground(10, 20), onCargo('inst-1')), { getCase: () => ({ ...CASE, dimensions: { ...CASE.dimensions, length: 60 } }) });
  assert.deepEqual([resized.status, resized.reason, resized.start, resized.endStatus, resized.endReason], ['needs-review', 'case-changed', null, 'needs-review', 'case-changed']);
  const bothWays = resolve(arrow('a', onCargo('inst-1'), onCargo('inst-2')), {
    getInstance: id => (id === 'inst-1' ? instance() : null), getCase: () => ({ ...CASE, dimensions: { ...CASE.dimensions, length: 60 } }),
  });
  assert.deepEqual([bothWays.status, bothWays.startStatus, bothWays.endStatus, bothWays.reason], ['unresolved', 'needs-review', 'unresolved', 'cargo-missing'], 'Unresolved dominates Needs Review');
  const ambiguous = resolve(arrow('a', onCargo('inst-1'), ground(10, 20)), { isInstanceAmbiguous: () => true });
  assert.deepEqual([ambiguous.status, ambiguous.reason], ['unresolved', 'cargo-ambiguous']);
  const noFloor = resolve(arrow('a', ground(10, 20), FLOOR_ANCHOR), { floors: [] });
  assert.deepEqual([noFloor.status, noFloor.reason, noFloor.endReason], ['unresolved', 'floor-missing', 'floor-missing']);
  assert.deepEqual(A.resolveAnnotationList([arrow('a'), callout('c'), { id: 'junk' }], context()).map(r => r.status), ['valid', 'valid', 'unresolved']);
  assert.deepEqual(A.resolveAnnotation(callout('c'), context()).point, { x: 5, y: 0, z: 5 }, 'a callout resolves exactly as before');
});

test('each arrow end follows its own cargo through remapping; an unmapped end is never guessed', () => {
  const both = arrow('both', onCargo(' old-1 '), onCargo('old-2'));
  const mixed = arrow('mixed', onCargo('old-1'), FLOOR_ANCHOR);
  const space = arrow('space', ground(1, 1), onCargo(' old-2 '));
  const partial = arrow('partial', onCargo('old-1'), onCargo('stranger'));
  const map = new Map([['old-1', 'new-1'], ['old-2', 'new-2']]);
  const out = A.remapAnnotationInstanceIds([both, mixed, space, partial, callout('c', onCargo('old-1'))], map);
  assert.deepEqual([out[0].start.instanceId, out[0].end.instanceId], ['new-1', 'new-2'], 'both ends, independently');
  assert.deepEqual([out[1].start.instanceId, out[1].end], ['new-1', FLOOR_ANCHOR], 'cargo to floor: the floor end is untouched');
  assert.deepEqual([out[2].start, out[2].end.instanceId], [ground(1, 1), 'new-2'], 'space to cargo');
  assert.deepEqual([out[3].start.instanceId, out[3].end.instanceId], ['new-1', 'stranger'], 'an end the map does not know stays exactly as it is');
  assert.equal(out[4].anchor.instanceId, 'new-1', 'callouts remap as before');
  assert.deepEqual(out[0].start.local, both.start.local, 'only the instance ID changes');
  const unchanged = [mixed, space];
  assert.equal(A.remapAnnotationInstanceIds(unchanged, new Map()), A.normalizeAnnotations(unchanged), 'nothing changed: the normalized list itself is returned');
  const swapped = A.remapAnnotationInstanceIds([both], new Map([['old-1', 'old-2'], ['old-2', 'old-1']]))[0];
  assert.deepEqual([swapped.start.instanceId, swapped.end.instanceId], ['old-2', 'old-1'], 'a swap is applied once, never chained');
});

test('an arrow with either end on a contested ID is withheld whole and verbatim; ambiguous and missing cargo stay arrows', () => {
  const identity = M.canonicalizeInstanceIds(['cargo', ' cargo ', 'other'], () => 'minted', [true, false, true]);
  assert.deepEqual([...identity.contestedKeys], ['cargo']);
  const carryIdentity = { idMap: new Map([['other', 'other-2']]), contestedKeys: identity.contestedKeys };
  const raw = [
    arrow('start-contested', onCargo(' cargo '), ground(40, 5)),
    arrow('end-contested', ground(40, 5), onCargo('cargo')),
    arrow('half-remap', onCargo('other'), onCargo(' cargo ')),
    arrow('fine', onCargo('other'), ground(40, 5)),
    arrow('dangling', onCargo('elsewhere'), FLOOR_ANCHOR),
  ];
  const carried = A.carryAnnotationsThroughIdentity(raw, carryIdentity);
  assert.deepEqual(carried.slice(0, 3).map(r => r.type), Array(3).fill(A.ANNOTATION_TYPE_UNREADABLE));
  assert.deepEqual(carried.slice(0, 3).map(r => r.original), raw.slice(0, 3), 'the pre-remap record is preserved, including the end that did map');
  assert.equal(carried[2].original.start.instanceId, 'other', 'the end that would have been remapped was not');
  assert.match(carried[0].reason, /shared its ID with another cargo item/);
  assert.equal(carried[3].type, A.ANNOTATION_TYPE_ARROW);
  assert.equal(carried[3].start.instanceId, 'other-2', 'an unaffected arrow still follows the map');
  assert.equal(carried[4].start.instanceId, 'elsewhere', 'a dangling reference is left as it is');
  assert.equal(new Set(carried.map(r => r.id)).size, carried.length);
  assert.deepEqual(A.carryAnnotationsThroughIdentity(carried, carryIdentity), carried, 'idempotent');
  const clean = M.canonicalizeInstanceIds(['a', 'b'], () => 'minted');
  assert.equal(A.carryAnnotationsThroughIdentity(raw, clean), A.remapAnnotationInstanceIds(raw, clean.idMap), 'no contested key: the plain remap');
  // Survivors that share an ID are neither mapped nor contested: the arrow is kept and resolves as ambiguous.
  const shared = M.canonicalizeInstanceIds(['dup', 'dup'], () => 'minted');
  assert.equal(shared.idMap.size, 0);
  assert.equal(shared.contestedKeys.size, 0);
  const kept = A.carryAnnotationsThroughIdentity([arrow('amb', onCargo('dup'), ground(40, 5))], shared)[0];
  assert.equal(kept.type, A.ANNOTATION_TYPE_ARROW);
  assert.deepEqual(A.resolveAnnotation(kept, context({ isInstanceAmbiguous: () => true })).reason, 'cargo-ambiguous');
  // Missing cargo is derived, never a reason to wrap or reassign.
  assert.equal(A.resolveAnnotation(carried[4], context({ getInstance: () => null })).startReason, 'cargo-missing');
});

test('an arrow may be written only against ends that resolve and, when both do, at least half an inch apart', () => {
  const problem = (record, overrides, moved) => A.arrowPlacementProblem(record, context(overrides), moved);
  assert.equal(A.MIN_ARROW_LENGTH_INCHES, 0.5);
  assert.equal(problem(arrow('a', ground(5, 5), ground(40, 5))), null);
  assert.equal(problem(arrow('a', ground(5, 5), ground(5.5, 5))), null, 'exactly half an inch is long enough');
  assert.equal(problem(arrow('a', ground(5, 5), ground(5.4, 5))), 'too-short');
  assert.equal(problem(arrow('a', ground(5, 5), ground(5, 5.49))), 'too-short');
  const nearCargo = M.buildSpaceAnchor({ surface: 'free', point: { x: 84, y: 102.3, z: 3 } });
  assert.equal(problem(arrow('a', onCargo('inst-1'), nearCargo)), 'too-short', 'measured between the resolved points, whatever the anchor kinds');
  assert.equal(problem(arrow('a', onCargo('inst-1'), ground(10, 20)), { getInstance: () => null }), 'unresolved');
  assert.equal(problem(arrow('a', onCargo('inst-1'), ground(10, 20)), { isInstanceAmbiguous: () => true }), 'unresolved');
  assert.equal(problem(arrow('a', ground(10, 20), onCargo('inst-1')), { getCase: () => ({ ...CASE, shape: 'cylinder' }) }), 'unresolved', 'Needs Review is refused too');
  assert.equal(problem(arrow('a', ground(10, 20), FLOOR_ANCHOR), { floors: [] }), 'unresolved');
  // Moving one end: that end must resolve; a broken other end only means the length cannot be checked.
  const broken = arrow('m', onCargo('inst-1'), ground(40, 5));
  const gone = { getInstance: () => null };
  assert.equal(problem(arrow('m', ground(9, 9), ground(40, 5)), gone, 'start'), null);
  assert.equal(problem(broken, gone, 'start'), 'unresolved');
  assert.equal(problem(broken, gone, 'end'), null, 'repairing the healthy end of a broken arrow is allowed');
  assert.equal(problem(arrow('m', ground(9, 9), ground(9.2, 9)), {}, 'end'), 'too-short');
  assert.equal(problem(arrow('m', ground(9, 9), onCargo('inst-1')), gone, 'start'), null, 'the broken end is not the one being placed');
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

test('the editor card keeps clear of the AutoPack Results card wherever it is, never rewrites its position and gives up height before it hides a button', () => {
  const view = { width: 1200, height: 800 };
  const card = { x: 400, y: 380, w: 336, h: 404 };
  const results = { x: 390, y: 520, w: 420, h: 270 }; // the expanded card, bottom centre
  const gap = L.OBSTACLE_GAP;
  const sits = (rect, other) => L.overlapArea(rect, { x: other.x - gap, y: other.y - gap, w: other.w + 2 * gap, h: other.h + 2 * gap });
  // Nothing in the way: the same rect comes back untouched and nothing is limited.
  const alone = L.clearOfBlockers(card, [], view);
  assert.deepEqual([alone.x, alone.y, alone.w, alone.h, alone.shrunk, alone.clear], [400, 380, 336, 404, false, true]);
  assert.deepEqual(L.clearOfBlockers(card, [{ x: 1000, y: 10, w: 100, h: 40 }], view).y, 380, 'a distant obstacle changes nothing');
  // Covered by Results: the card moves the shortest way to a spot that overlaps nothing, full size.
  const pushed = L.clearOfBlockers(card, [results], view);
  assert.equal(pushed.clear, true);
  assert.equal(pushed.shrunk, false);
  assert.equal(sits(pushed, results), 0, 'no overlap with Results, with breathing room');
  assert.deepEqual([pushed.w, pushed.h], [336, 404], 'full size');
  assert.ok(pushed.x >= L.VIEWPORT_MARGIN && pushed.y >= L.VIEWPORT_MARGIN && pushed.x + pushed.w <= view.width - L.VIEWPORT_MARGIN && pushed.y + pushed.h <= view.height - L.VIEWPORT_MARGIN, 'and inside the viewport');
  // The input is never mutated, so a stored position survives the obstacle moving away.
  assert.deepEqual(card, { x: 400, y: 380, w: 336, h: 404 });
  assert.deepEqual(L.clearOfBlockers(card, [{ ...results, y: 790 }], view).y, 380, 'moving Results away leaves the stored place as it was');
  // A minimized chip and the restore button are obstacles too, wherever they are dragged.
  for (const spot of [{ x: 420, y: 400, w: 190, h: 44 }, { x: 8, y: 700, w: 36, h: 36 }, { x: 600, y: 8, w: 420, h: 270 }]) {
    const placed = L.clearOfBlockers({ x: spot.x - 20, y: spot.y - 20, w: 336, h: 404 }, [spot], view);
    assert.equal(placed.clear && sits(placed, spot), 0);
  }
  // Results dragged onto the card from either side keeps pushing it clear.
  for (const x of [0, 200, 500, 780]) {
    const placed = L.clearOfBlockers(card, [{ ...results, x }], view);
    assert.equal(sits(placed, { ...results, x }), 0, `Results at x=${x}`);
  }
  // No full-size spot: a viewport 560px wide cannot fit the card beside or below Results, so it keeps its width
  // and gives up height above it. The buttons live outside the scrolling body, so a shorter card loses no button.
  const short = { width: 560, height: 700 };
  const wide = { x: 70, y: 380, w: 420, h: 300 };
  const squeezed = L.clearOfBlockers({ x: 100, y: 250, w: 336, h: 404 }, [wide], short);
  assert.equal(squeezed.clear, true);
  assert.equal(squeezed.shrunk, true);
  assert.ok(squeezed.h >= L.MIN_EDITOR_HEIGHT && squeezed.h < 404, 'shorter, not unusably short');
  assert.equal(sits(squeezed, wide), 0);
  assert.equal(squeezed.w, 336, 'the width is kept');
  // Truly nowhere to go: reported as not clear so the caller can use the sheet instead of covering controls.
  const nowhere = L.clearOfBlockers({ x: 100, y: 100, w: 336, h: 404 }, [{ x: 0, y: 0, w: 560, h: 700 }], short);
  assert.equal(nowhere.clear, false);
  // Garbage obstacles (zero size, NaN) are ignored rather than trusted.
  assert.equal(L.clearOfBlockers(card, [{ x: 1, y: 1, w: 0, h: 0 }, { x: NaN, y: 0, w: 5, h: 5 }, null], view).y, 380);
});

test('the desktop editor never lands under the Annotations panel: it keeps clear while there is room, relaxes its marker first, and otherwise the panel yields', () => {
  const touches = (a, b) => L.overlapArea(a, b) > 0;
  // N01: 1100x620 with both sidebars open (a 556x538 canvas), expanded Results at its default spot and a 213px panel above it.
  const view = { width: 556, height: 538 };
  const panel = { x: 197, y: 65, w: 300, h: 213 };
  const results = { x: 68, y: 284, w: 420, h: 237 };
  const preferred = { x: 211, y: 9, w: 336, h: 269 };
  const marker = { x: 260, y: 150, w: 22, h: 22 };
  const stack = { x: 508, y: 180, w: 36, h: 180 }; // the viewport control stack down the right-hand edge
  const tight = L.fitEditorClear({ rect: preferred, viewport: view, panel: [panel], results: [results], marker: [marker], controls: [stack] });
  assert.equal(tight.fit.clear, true, 'there is a spot clear of Results');
  assert.equal(touches(tight.fit, results), false, 'Results never covers the card');
  assert.equal(tight.coversPanel, true, 'with no room beside the panel the panel is the one that yields, and the caller is told');
  assert.equal(touches(tight.fit, panel), true, '(and that is a real overlap: the previous placement hid the card under the panel)');
  assert.equal(touches(tight.fit, stack), false, 'once the panel yields the end of Save is not left under the viewport controls either');
  assert.equal(tight.fit.y, preferred.y, 'it only slides sideways, staying at its preferred height');
  assert.equal(L.fitEditorClear({ rect: preferred, viewport: view, panel: [panel], results: [results], marker: [marker] }).fit.x, preferred.x, 'with no controls to avoid it keeps its preferred place');

  // Room beside the panel: the card goes there and the panel is untouched.
  const roomy = L.fitEditorClear({ rect: { x: 400, y: 70, w: 336, h: 269 }, viewport: { width: 1200, height: 800 }, panel: [{ x: 850, y: 64, w: 300, h: 213 }], results: [{ x: 300, y: 560, w: 420, h: 237 }], marker: [marker], controls: [{ x: 1152, y: 300, w: 36, h: 180 }] });
  assert.equal(roomy.fit.clear, true);
  assert.equal(roomy.coversPanel, false, 'where it fits beside the panel it never hides it');
  assert.equal(touches(roomy.fit, { x: 850, y: 64, w: 300, h: 213 }), false);

  // The marker is relaxed before the panel: no spot is clear of both, so the card sits on its marker rather than hide the panel.
  const wideMarker = { x: 20, y: 100, w: 40, h: 22 };
  const sidePanel = { x: 392, y: 64, w: 300, h: 213 };
  const squeezed = L.fitEditorClear({ rect: { x: 8, y: 8, w: 336, h: 269 }, viewport: { width: 700, height: 330 }, panel: [sidePanel], marker: [wideMarker] });
  assert.equal(squeezed.fit.clear, true);
  assert.equal(squeezed.coversPanel, false, 'the panel stays');
  assert.equal(touches(squeezed.fit, sidePanel), false);
  assert.equal(touches(squeezed.fit, wideMarker), true, 'the marker is what was given up');

  // A card the owner placed keeps its spot over the panel (the panel yields); it moves only for Results.
  const dragged = { x: 600, y: 70, w: 336, h: 269 };
  const ownerOnPanel = L.fitEditorClear({ rect: dragged, viewport: { width: 1000, height: 700 }, panel: [{ x: 640, y: 64, w: 300, h: 213 }], ownerPlaced: true });
  assert.deepEqual([ownerOnPanel.fit.x, ownerOnPanel.fit.y], [dragged.x, dragged.y], 'the owner placement is respected');
  assert.equal(ownerOnPanel.coversPanel, true);
  const ownerOnResults = L.fitEditorClear({ rect: dragged, viewport: { width: 1000, height: 700 }, panel: [{ x: 640, y: 64, w: 300, h: 213 }], results: [{ x: 560, y: 120, w: 420, h: 237 }], ownerPlaced: true });
  assert.equal(ownerOnResults.fit.clear, true);
  assert.equal(touches(ownerOnResults.fit, { x: 560, y: 120, w: 420, h: 237 }), false, 'Results still wins over the owner placement');

  // Nowhere clear of Results: no spot, and nothing is claimed about the panel (the caller shows the sheet).
  const none = L.fitEditorClear({ rect: { x: 8, y: 8, w: 336, h: 269 }, viewport: { width: 400, height: 330 }, panel: [{ x: 90, y: 64, w: 300, h: 213 }], results: [{ x: 8, y: 40, w: 384, h: 270 }] });
  assert.equal(none.fit.clear, false);
  assert.equal(none.coversPanel, false);

  // Unusable rectangles are ignored, a missing panel is never "covered", and the inputs are never rewritten.
  assert.equal(L.fitEditorClear({ rect: preferred, viewport: view, panel: [null, { x: NaN, y: 0, w: 5, h: 5 }, { x: 0, y: 0, w: 0, h: 9 }], results: 'nope' }).coversPanel, false);
  assert.equal(L.fitEditorClear({ rect: preferred, viewport: view }).coversPanel, false);
  const inputs = { rect: { ...preferred }, viewport: { ...view }, panel: [{ ...panel }], results: [{ ...results }], marker: [{ ...marker }] };
  const frozen = JSON.parse(JSON.stringify(inputs));
  L.fitEditorClear(inputs);
  assert.deepEqual(inputs, frozen, 'pure: nothing it was given changes');
});

test('the narrow-viewport sheet sits above the AutoPack Results card, however it is moved, and limits its height instead of hiding a button', () => {
  const view = { width: 420, height: 800 };
  const natural = 440;
  const baseline = L.fitSheet({ viewport: view, blockers: [], height: natural });
  assert.deepEqual(baseline, { moved: false, bottom: L.SHEET_INSETS.bottom, maxHeight: Math.floor(800 * 0.84) }, 'no obstacle: the stylesheet placement stands');
  // Results across the bottom (its default): the sheet rides up above it.
  const bottomResults = { x: 16, y: 520, w: 388, h: 264 };
  const above = L.fitSheet({ viewport: view, blockers: [bottomResults], height: natural });
  assert.equal(above.moved, true);
  const aboveTop = view.height - above.bottom - Math.min(natural, above.maxHeight);
  assert.ok(view.height - above.bottom <= bottomResults.y - L.OBSTACLE_GAP + 1, 'the sheet ends above Results');
  assert.ok(aboveTop >= L.VIEWPORT_MARGIN, 'and starts inside the viewport');
  assert.ok(above.maxHeight >= L.MIN_EDITOR_HEIGHT, 'with room for the fields and the buttons');
  // Results dragged to the top: the default bottom placement is clear, so nothing moves.
  assert.equal(L.fitSheet({ viewport: view, blockers: [{ x: 16, y: 20, w: 388, h: 240 }], height: natural }).moved, false);
  // Results in the middle: the larger free stretch (below) wins when it is taller.
  const middle = L.fitSheet({ viewport: view, blockers: [{ x: 16, y: 120, w: 388, h: 300 }], height: natural });
  assert.equal(middle.moved, true);
  assert.ok(view.height - middle.bottom - middle.maxHeight >= 120 + 300 + L.OBSTACLE_GAP - 1 || view.height - middle.bottom <= 120 - L.OBSTACLE_GAP + 1, 'never overlaps Results');
  // Something that does not reach the sheet's band (the viewport controls column on the right) is ignored.
  assert.equal(L.fitSheet({ viewport: view, blockers: [{ x: 380, y: 700, w: 30, h: 60 }], height: natural }).moved, false);
  // Always the tallest stretch there is, even when it is shorter than a comfortable card.
  const cramped = L.fitSheet({ viewport: { width: 420, height: 500 }, blockers: [{ x: 16, y: 150, w: 388, h: 330 }], height: natural });
  assert.equal(cramped.moved, true);
  assert.ok(500 - cramped.bottom <= 150 - L.OBSTACLE_GAP + 1 && cramped.maxHeight >= 1);
});

test('the desktop panel stays clear of the AutoPack Results card wherever either was dragged: it shifts, or gives up height, inside its region', () => {
  const view = { width: 800, height: 650 };
  const I = L.PANEL_REGION_INSETS;
  const panel = { x: view.width - I.right - 300, y: I.top, w: 300, h: 436 }; // the stylesheet's own spot
  const clearOf = (fit, blocker) => {
    const placed = { x: panel.x + fit.dx, y: panel.y + fit.dy, w: panel.w, h: fit.maxHeight ?? panel.h };
    return placed.x + placed.w + L.OBSTACLE_GAP <= blocker.x || blocker.x + blocker.w + L.OBSTACLE_GAP <= placed.x
      || placed.y + placed.h + L.OBSTACLE_GAP <= blocker.y || blocker.y + blocker.h + L.OBSTACLE_GAP <= placed.y;
  };
  const inRegion = fit => {
    const x = panel.x + fit.dx;
    const y = panel.y + fit.dy;
    return x >= I.left && y >= I.top && x + panel.w <= view.width - I.right && y + (fit.maxHeight ?? panel.h) <= view.height - I.bottom;
  };
  assert.deepEqual(L.fitPanelClear({ panel, blockers: [], viewport: view }), { dx: 0, dy: 0, maxHeight: null, clear: true }, 'nothing in the way: it stays');
  assert.deepEqual(L.fitPanelClear({ panel, blockers: [{ x: 20, y: 500, w: 420, h: 100 }], viewport: view }).dx, 0, 'Results elsewhere: it stays');

  // Results across the bottom (its default) over the panel's lower rows: the panel keeps its place and gives up height.
  const bottom = { x: 190, y: 380, w: 420, h: 237 };
  const below = L.fitPanelClear({ panel, blockers: [bottom], viewport: view });
  assert.equal(below.clear, true);
  assert.deepEqual([below.dx, below.dy], [0, 0], 'it does not move');
  assert.equal(below.maxHeight, bottom.y - L.OBSTACLE_GAP - panel.y, 'it ends one gap above Results');
  assert.ok(below.maxHeight >= L.MIN_PANEL_HEIGHT, 'with its header and part of a row still showing');
  // Room beside the card does not change that: a docked panel is not thrown across the view for a card over its lower rows.
  const wideView = { width: 1500, height: 650 };
  const widePanel = { ...panel, x: wideView.width - I.right - 300 };
  const stillDocked = L.fitPanelClear({ panel: widePanel, blockers: [{ x: widePanel.x - 130, y: 380, w: 420, h: 237 }], viewport: wideView });
  assert.deepEqual([stillDocked.dx, stillDocked.dy], [0, 0], 'it stays docked');
  assert.ok(stillDocked.maxHeight >= L.MIN_PANEL_HEIGHT);

  // Results dragged over the panel's header: the panel moves to the nearest clear spot, whole, inside its region.
  const overHeader = { x: 300, y: 20, w: 420, h: 237 };
  const moved = L.fitPanelClear({ panel, blockers: [overHeader], viewport: view });
  assert.equal(moved.clear, true);
  assert.ok(moved.dx !== 0 || moved.dy !== 0, 'it moves');
  assert.ok(clearOf(moved, overHeader), 'and no longer touches Results');
  assert.ok(inRegion(moved), 'inside the space between the toolbar and the viewport controls');

  // The minimized card, an even smaller obstacle, over the header: still clear.
  const chip = { x: 330, y: 60, w: 420, h: 52 };
  const aside = L.fitPanelClear({ panel, blockers: [chip], viewport: view });
  assert.ok(aside.clear && clearOf(aside, chip) && inRegion(aside));

  // The owner's own spot is only a starting point: a dragged panel is moved from where it is.
  const dragged = { x: 40, y: 150, w: 300, h: 300 };
  const lowCard = { x: 100, y: 330, w: 420, h: 237 };
  const fromDragged = L.fitPanelClear({ panel: dragged, blockers: [lowCard], viewport: view });
  assert.ok(fromDragged.clear && clearOf({ ...fromDragged, dx: fromDragged.dx + dragged.x - panel.x, dy: fromDragged.dy + dragged.y - panel.y }, lowCard), 'a dragged panel is moved from where it was dragged, clear of Results');
  assert.equal(L.fitPanelClear({ panel: dragged, blockers: [{ x: 600, y: 500, w: 100, h: 60 }], viewport: view }).dx, 0, 'a dragged panel nothing touches stays where it was dragged');

  // Unusable rectangles are ignored; a region too small for the panel gives up (the caller leaves it alone).
  assert.deepEqual(L.fitPanelClear({ panel, blockers: [null, { x: NaN, y: 0, w: 1, h: 1 }], viewport: view }), { dx: 0, dy: 0, maxHeight: null, clear: true });
  assert.equal(L.fitPanelClear({ panel, blockers: [overHeader], viewport: { width: 300, height: 300 } }).clear, false);
  // No spot of at least the minimum height anywhere: clear is false and nothing is shifted.
  const crammed = L.fitPanelClear({ panel: { ...panel, h: 260 }, blockers: [{ x: 0, y: 70, w: 800, h: 560 }], viewport: view });
  assert.deepEqual(crammed, { dx: 0, dy: 0, maxHeight: null, clear: false });
});

test('the desktop panel has no cliff above AutoPack Results: short of its preferred minimum it keeps giving up height down to a floor, and only below the floor is it left where it is', () => {
  const view = { width: 800, height: 650 };
  const I = L.PANEL_REGION_INSETS;
  const panel = { x: view.width - I.right - 300, y: I.top, w: 300, h: 436 };
  assert.ok(L.PANEL_FLOOR_HEIGHT < L.MIN_PANEL_HEIGHT, 'a floor under the preferred minimum');
  // A card across the whole region, `room` px below the panel's top plus the gap it must keep (so there is no spot beside or
  // below it): the panel can be exactly `room` tall, docked where it is.
  const withRoom = room => L.fitPanelClear({ panel, blockers: [{ x: 0, y: panel.y + room + L.OBSTACLE_GAP, w: view.width, h: 600 }], viewport: view });
  let previous = Infinity;
  for (const room of [300, 260, 213, 201, 200, 199, 198, 180, 160, 151, 150]) {
    const fit = withRoom(room);
    assert.deepEqual([fit.clear, fit.dx, fit.dy, fit.maxHeight], [true, 0, 0, room], `${room} px of room: it stays docked and is exactly as tall as the room`);
    assert.ok(fit.maxHeight <= previous, 'never taller as the room shrinks');
    previous = fit.maxHeight;
  }
  assert.deepEqual(withRoom(L.PANEL_FLOOR_HEIGHT - 1), { dx: 0, dy: 0, maxHeight: null, clear: false }, 'below the floor nothing useful fits: the caller leaves it alone');
  // The preferred minimum still wins where it can: a card over the header moves the panel whole rather than squeezing it.
  const overHeader = { x: 300, y: 20, w: 420, h: 237 };
  const moved = L.fitPanelClear({ panel, blockers: [overHeader], viewport: view });
  assert.ok(moved.clear && (moved.maxHeight === null || moved.maxHeight >= L.MIN_PANEL_HEIGHT), 'moved to a spot with at least the preferred minimum');
  // The floor is only a fallback: with the floor raised to the minimum the old cliff is back.
  assert.equal(L.fitPanelClear({ panel, blockers: [{ x: 0, y: panel.y + 198 + L.OBSTACLE_GAP, w: view.width, h: 600 }], viewport: view, floorHeight: L.MIN_PANEL_HEIGHT }).clear, false);
});

test('a height-limited panel scrolls as a whole instead of pinning controls over its rows', () => {
  const head = 43;
  const arrowFooter = 104;
  const flows = input => L.panelBodyFlows({ headHeight: head, ...input });
  // Everything fits: nothing scrolls, so the choice is moot.
  assert.equal(flows({ panelHeight: 300, contentHeight: 300, footerHeight: arrowFooter }), false);
  assert.equal(flows({ panelHeight: 150, contentHeight: 151 }), false, 'a 1 px overflow is a rounding difference, not a scroll');
  // With the look controls showing, they stay pinned only while at least PANEL_PIN_MIN_SCROLL px of scrolling room remains beside them.
  const pinnedAt = height => !flows({ panelHeight: height, contentHeight: 520, footerHeight: arrowFooter });
  const smallestPinned = [...Array(400).keys()].map(n => 150 + n).find(pinnedAt);
  assert.equal(smallestPinned, head + arrowFooter + L.PANEL_PIN_MIN_SCROLL, 'pinned from exactly the height that leaves the minimum scrolling room');
  assert.ok([smallestPinned, smallestPinned + 100, 520].every(pinnedAt) && ![smallestPinned - 1, 213, 198, 150].some(pinnedAt), 'monotonic: no height pins, un-pins and pins again');
  // Without them, the fixed tool/Show/Callouts rows need the preferred minimum to leave a list: below it everything scrolls.
  assert.equal(flows({ panelHeight: L.MIN_PANEL_HEIGHT, contentHeight: 520 }), false);
  assert.equal(flows({ panelHeight: L.MIN_PANEL_HEIGHT - 1, contentHeight: 520 }), true);
  assert.equal(flows({ panelHeight: L.PANEL_FLOOR_HEIGHT, contentHeight: 520 }), true);
  // Unusable measurements never switch layouts.
  assert.equal(flows({ panelHeight: NaN, contentHeight: 520, footerHeight: arrowFooter }), false);
  assert.equal(flows({ panelHeight: 100, contentHeight: undefined }), false);
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
