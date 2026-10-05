import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSpaceUtilization } from '../../src/packing-core/space-utilization-engine.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import { computeCoG } from '../../src/services/cog-service.js';
import { computePalletWarnings } from '../../src/services/oog-service.js';
import {
  buildSpaceUtilizationResult,
  createSpaceUtilizationGauge,
} from '../../src/ui/space-utilization-gauge.js';

const GEOMETRY = Object.freeze({
  getTrailerUsableZones: PackLibrary.getTrailerUsableZones,
  getTrailerCapacityInches3: PackLibrary.getTrailerCapacityInches3,
  getFrontBonusBlockedZones: PackLibrary.getFrontBonusBlockedZones,
  getInstanceEffectiveDims: PackLibrary.getInstanceEffectiveDims,
  makeAabb: PackLibrary.makeAabb,
  isAabbInsideTruckGeometry: PackLibrary.isAabbInsideTruckGeometry,
});

const STANDARD_TRUCK = Object.freeze({
  length: 100,
  width: 50,
  height: 40,
  shapeMode: 'rect',
});

const WHEEL_WELL_TRUCK = Object.freeze({
  length: 100,
  width: 50,
  height: 40,
  shapeMode: 'wheelWells',
  shapeConfig: {
    wellHeight: 10,
    wellWidth: 10,
    wellLength: 40,
    wellOffsetFromRear: 20,
  },
});

const FRONT_OVERHANG_TRUCK = Object.freeze({
  length: 80,
  width: 40,
  height: 40,
  shapeMode: 'frontBonus',
  shapeConfig: {
    bonusLength: 20,
    bonusHeight: 15,
  },
});

function makeCase(id = 'case-1', dimensions = { length: 10, width: 10, height: 10 }, patch = {}) {
  return {
    id,
    name: id,
    dimensions: { ...dimensions },
    volume: dimensions.length * dimensions.width * dimensions.height,
    weight: 10,
    ...patch,
  };
}

function makeInstance(id, caseId, position, patch = {}) {
  return {
    id,
    caseId,
    hidden: false,
    transform: {
      position: { ...position },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...patch,
  };
}

function calculate(truck, instances = [], cases = [makeCase()]) {
  return computeSpaceUtilization({
    pack: { id: 'pack-1', truck: structuredClone(truck), cases: structuredClone(instances) },
    caseLibrary: structuredClone(cases),
    geometry: GEOMETRY,
  });
}

function closeTo(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.style = { setProperty() {} };
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.id = '';
    this.title = '';
    this.type = '';
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this._classes.add(name)),
      contains: name => this._classes.has(name),
    };
  }

  set className(value) {
    this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get className() {
    return [...this._classes].join(' ');
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

const testDocument = { createElement: tagName => new TestElement(tagName) };

function walk(root) {
  return [root, ...root.children.flatMap(walk)];
}

function textTree(root) {
  return walk(root)
    .map(element => element.textContent)
    .filter(Boolean)
    .join(' | ');
}

test('UTIL-ENGINE-1 Empty Standard space is ready with zero utilization', () => {
  const result = calculate(STANDARD_TRUCK);
  assert.equal(result.status, 'ready');
  assert.equal(result.usableVolume, 200000);
  assert.equal(result.cargoCubeVolume, 0);
  assert.equal(result.cargoCubePercent, 0);
  assert.equal(result.occupiedEnvelopeVolume, 0);
  assert.equal(result.spatialUtilizationPercent, 0);
  assert.equal(result.loadedCount, 0);
  assert.equal(result.stagedCount, 0);
  assert.equal(result.zones.length, 1);
});

test('UTIL-ENGINE-2 one contained Case preserves Case cube semantics and measures its envelope', () => {
  const caseData = makeCase('case-1', { length: 10, width: 10, height: 10 }, { volume: 1250 });
  const result = calculate(
    STANDARD_TRUCK,
    [makeInstance('one', caseData.id, { x: 5, y: 5, z: 0 })],
    [caseData]
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.cargoCubeVolume, 1250, 'stored Case volume remains the cargo-cube authority');
  assert.equal(result.occupiedEnvelopeVolume, 1000, 'spatial volume uses the physical envelope');
  assert.equal(result.loadedCount, 1);
  assert.equal(result.instanceAabbs.length, 1);
});

test('UTIL-ENGINE-3 multiple non-overlapping Cases add without overlap', () => {
  const result = calculate(STANDARD_TRUCK, [
    makeInstance('a', 'case-1', { x: 5, y: 5, z: 0 }),
    makeInstance('b', 'case-1', { x: 15, y: 5, z: 0 }),
  ]);
  assert.equal(result.status, 'ready');
  assert.equal(result.cargoCubeVolume, 2000);
  assert.equal(result.occupiedEnvelopeVolume, 2000);
  assert.equal(result.overlapVolume, 0);
  assert.equal(result.loadedCount, 2);
});

test('UTIL-ENGINE-4 overlapping Cases keep cargo cube totals but union the occupied envelope', () => {
  const result = calculate(STANDARD_TRUCK, [
    makeInstance('a', 'case-1', { x: 5, y: 5, z: 0 }),
    makeInstance('b', 'case-1', { x: 10, y: 5, z: 0 }),
  ]);
  assert.equal(result.status, 'invalid');
  assert.equal(result.cargoCubeVolume, 2000);
  assert.equal(result.occupiedEnvelopeVolume, 1500);
  assert.equal(result.overlapVolume, 500);
  assert.equal(result.diagnostics.overlaps.length, 1);
  assert.equal(result.diagnostics.overlaps[0].volume, 500);
});

test('UTIL-ENGINE-5 a partially outside Case is clipped and reports the outside portion', () => {
  const result = calculate(
    STANDARD_TRUCK,
    [makeInstance('partial', 'case-1', { x: 2, y: 5, z: 0 })]
  );
  assert.equal(result.status, 'invalid');
  assert.equal(result.loadedCount, 0);
  assert.equal(result.stagedCount, 1);
  assert.equal(result.cargoCubeVolume, 0);
  assert.equal(result.occupiedEnvelopeVolume, 700);
  assert.equal(result.outsideVolume, 300);
  assert.equal(result.instanceAabbs[0].outsideVolume, 300);
});

test('UTIL-ENGINE-6 a fully outside Case has no occupied in-space envelope', () => {
  const result = calculate(
    STANDARD_TRUCK,
    [makeInstance('outside', 'case-1', { x: -10, y: 5, z: 0 })]
  );
  assert.equal(result.status, 'invalid');
  assert.equal(result.occupiedEnvelopeVolume, 0);
  assert.equal(result.outsideVolume, 1000);
  assert.equal(result.stagedCount, 1);
});

test('UTIL-ENGINE-7 a Wheel Well body intersection is blocked and invalid', () => {
  const result = calculate(
    WHEEL_WELL_TRUCK,
    [makeInstance('blocked', 'case-1', { x: 25, y: 5, z: 20 })]
  );
  assert.equal(result.status, 'invalid');
  assert.equal(result.loadedCount, 0);
  assert.equal(result.stagedCount, 1);
  assert.equal(result.blockedIntersectionVolume, 1000);
  assert.equal(result.diagnostics.blockedIntersections[0].kind, 'wheel-well-body');
});

test('UTIL-ENGINE-8 a Case resting above a Wheel Well remains valid', () => {
  const result = calculate(
    WHEEL_WELL_TRUCK,
    [makeInstance('above', 'case-1', { x: 25, y: 15, z: 20 })]
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.loadedCount, 1);
  assert.equal(result.blockedIntersectionVolume, 0);
  assert.equal(result.outsideVolume, 0);
});

test('UTIL-ENGINE-9 Front Overhang main zone is usable', () => {
  const result = calculate(
    FRONT_OVERHANG_TRUCK,
    [makeInstance('main', 'case-1', { x: 5, y: 5, z: 0 })]
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.loadedCount, 1);
});

test('UTIL-ENGINE-10 Front Overhang deck zone is usable', () => {
  const result = calculate(
    FRONT_OVERHANG_TRUCK,
    [makeInstance('deck', 'case-1', { x: 85, y: 20, z: 0 })]
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.loadedCount, 1);
  assert.equal(result.outsideVolume, 0);
});

test('UTIL-ENGINE-11 Front Overhang cab void is blocked and invalid', () => {
  const result = calculate(
    FRONT_OVERHANG_TRUCK,
    [makeInstance('cab-void', 'case-1', { x: 85, y: 5, z: 0 })]
  );
  assert.equal(result.status, 'invalid');
  assert.equal(result.loadedCount, 0);
  assert.equal(result.stagedCount, 1);
  assert.equal(result.blockedIntersectionVolume, 1000);
  assert.equal(result.diagnostics.blockedIntersections[0].kind, 'cab-void');
});

test('UTIL-ENGINE-12 effective oriented dimensions drive the packing envelope', () => {
  const truck = { length: 12, width: 30, height: 10, shapeMode: 'rect' };
  const caseData = makeCase('rotated', { length: 20, width: 10, height: 5 });
  const instance = makeInstance('rotated-instance', caseData.id, { x: 5, y: 2.5, z: 0 }, {
    orientedDims: { length: 10, width: 20, height: 5 },
    transform: {
      position: { x: 5, y: 2.5, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  const result = calculate(truck, [instance], [caseData]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.instanceAabbs[0].dimensions, { length: 10, width: 20, height: 5 });
  assert.equal(result.occupiedEnvelopeVolume, 1000);
});

test('UTIL-ENGINE-13 hiding packed cargo changes visibility, not physical totals or diagnostics', () => {
  const caseData = makeCase('case-1', { length: 10, width: 10, height: 10 }, { volume: 1250, weight: 52.91 });
  const visible = makeInstance('one', caseData.id, { x: 5, y: 5, z: 0 }, { placement: 'packed' });
  const pack = { truck: STANDARD_TRUCK, cases: [visible] };
  const before = PackLibrary.computeStats(pack, [caseData]);
  const after = PackLibrary.computeStats({ ...pack, cases: [{ ...visible, hidden: true }] }, [caseData]);
  assert.equal(before.hiddenCases, 0);
  assert.equal(after.hiddenCases, 1);
  for (const key of ['packedCases', 'stagedCases', 'totalWeight', 'volumeUsed', 'volumePercent']) {
    assert.equal(after[key], before[key], `${key} is independent of visibility`);
  }
  for (const key of ['loadedCount', 'cargoCubeVolume', 'occupiedEnvelopeVolume', 'spatialUtilizationPercent']) {
    assert.equal(after.spaceUtilization[key], before.spaceUtilization[key], `${key} is independent of visibility`);
  }
  assert.deepEqual(after.spaceUtilization.instanceAabbs, before.spaceUtilization.instanceAabbs);
  assert.deepEqual(after.spaceUtilization.diagnostics.overlaps, before.spaceUtilization.diagnostics.overlaps);
  assert.equal(after.totalWeight, 52.91);
  assert.equal(after.volumeUsed, 1250);
});

test('UTIL-ENGINE-13B hidden staged cargo stays staged and multiple hidden packed cargo stays physical', () => {
  const caseData = makeCase();
  const packed = [
    makeInstance('a', caseData.id, { x: 5, y: 5, z: 0 }, { hidden: true, placement: 'packed' }),
    makeInstance('b', caseData.id, { x: 15, y: 5, z: 0 }, { hidden: true, placement: 'packed' }),
  ];
  const staged = makeInstance('c', caseData.id, { x: -10, y: 5, z: 0 }, { hidden: true, placement: 'staged' });
  const result = calculate(STANDARD_TRUCK, [...packed, staged], [caseData]);
  assert.equal(result.hiddenCount, 3);
  assert.equal(result.loadedCount, 2);
  assert.equal(result.stagedCount, 1);
  assert.equal(result.cargoCubeVolume, 2000);
  assert.equal(result.occupiedEnvelopeVolume, 2000);
  assert.equal(result.instanceAabbs.find(entry => entry.instanceId === 'c').placement, 'staged');
  const stats = PackLibrary.computeStats({ truck: STANDARD_TRUCK, cases: [...packed, staged] }, [caseData]);
  assert.equal(stats.totalWeight, 20);
  assert.equal(stats.packedCases, 2);
  assert.equal(stats.stagedCases, 1);
  const overlapping = calculate(STANDARD_TRUCK, [...packed, { ...packed[0], id: 'overlap', hidden: false }], [caseData]);
  assert.ok(overlapping.diagnostics.overlaps.some(entry => entry.instanceIds.includes('a')),
    'a hidden packed Case still participates in overlap diagnostics');
});

test('UTIL-ENGINE-13C hidden unresolved cargo stays unresolved without fabricated weight or cube', () => {
  const missing = makeInstance('missing', 'deleted', { x: 5, y: 5, z: 0 }, { hidden: true, placement: 'packed' });
  const stats = PackLibrary.computeStats({ truck: STANDARD_TRUCK, cases: [missing] }, []);
  assert.equal(stats.hiddenCases, 1);
  assert.equal(stats.unresolvedInstances, 1);
  assert.equal(stats.packedCases, 0);
  assert.equal(stats.totalWeight, 0);
  assert.equal(stats.volumeUsed, 0);
  assert.equal(stats.totalsComplete, false);
});

test('F02-COG-1 through 6: loaded visibility is orthogonal; staged and unresolved cargo do not move CoG', () => {
  const light = makeCase('light', undefined, { weight: 20 });
  const heavy = makeCase('heavy', undefined, { weight: 80 });
  const visible = makeInstance('visible', light.id, { x: 20, y: 5, z: 0 }, { placement: 'packed' });
  const staged = makeInstance('staged', heavy.id, { x: -30, y: 5, z: 0 }, { placement: 'staged' });
  const loadedHidden = makeInstance('loaded-hidden', heavy.id, { x: 80, y: 5, z: 0 },
    { placement: 'packed', hidden: true });
  const missing = makeInstance('missing', 'deleted-case', { x: 95, y: 5, z: 0 },
    { placement: 'packed', hidden: true });
  const stats = cases => PackLibrary.computeStats({ truck: STANDARD_TRUCK, cases }, [light, heavy]);

  const one = stats([visible]);
  assert.deepEqual(one.cog.position, { x: 20, y: 5, z: 0 });
  assert.equal(one.cog.totalWeight, 20);
  assert.deepEqual(stats([{ ...visible, hidden: true }]).cog, one.cog);
  assert.deepEqual(stats([visible, staged]).cog, one.cog);
  assert.deepEqual(stats([visible, { ...staged, hidden: true }]).cog, one.cog);

  const mixed = stats([visible, loadedHidden, staged]);
  assert.deepEqual(mixed.cog.position, { x: 68, y: 5, z: 0 });
  assert.equal(mixed.cog.totalWeight, 100);
  assert.equal(mixed.cog.totalWeight, mixed.totalWeight,
    'CoG and loaded statistics use the same resolved positive-weight population');
  const unresolved = stats([visible, loadedHidden, staged, missing]);
  assert.deepEqual(unresolved.cog, mixed.cog);
  assert.equal(unresolved.unresolvedInstances, 1);
});

test('F02-PALLET-1 through 6: hidden loaded cargo counts; staged and unresolved cargo do not', () => {
  const pallet = makeCase('pallet', { length: 20, width: 20, height: 4 },
    { isPallet: true, maxPalletWeight: 100, weight: 10 });
  const cargo = makeCase('cargo', { length: 10, width: 10, height: 10 }, { weight: 150 });
  const malformed = makeCase('malformed', { length: 0, width: 10, height: 10 }, { weight: 999 });
  const loadedPallet = makeInstance('pallet-1', pallet.id, { x: 50, y: 2, z: 0 }, { placement: 'packed' });
  const loadedCargo = makeInstance('cargo-1', cargo.id, { x: 50, y: 9, z: 0 }, { placement: 'packed' });
  const stagedCargo = makeInstance('staged-cargo', cargo.id, { x: 50, y: 45, z: 0 },
    { placement: 'staged' });
  const warnings = cases => PackLibrary.computeStats({ truck: STANDARD_TRUCK, cases },
    [pallet, cargo, malformed]).palletWarnings;

  const visible = warnings([loadedPallet, loadedCargo]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].actualWeight, 150);
  assert.deepEqual(visible[0].loadedCaseIds, ['cargo-1']);
  assert.deepEqual(warnings([{ ...loadedPallet, hidden: true }, loadedCargo]), visible);
  assert.deepEqual(warnings([loadedPallet, { ...loadedCargo, hidden: true }]), visible);
  assert.deepEqual(warnings([loadedPallet, { ...loadedCargo, hidden: true }, stagedCargo]), visible);
  assert.deepEqual(warnings([loadedPallet, stagedCargo]), []);
  assert.deepEqual(warnings([loadedPallet, { ...stagedCargo, hidden: true }]), []);
  assert.deepEqual(warnings([
    { ...loadedPallet, transform: { position: { x: 50, y: 45, z: 0 } }, placement: 'staged' },
    makeInstance('above-staged-pallet', cargo.id, { x: 50, y: 52, z: 0 }, { placement: 'staged' }),
  ]), [], 'a staged pallet is not a truck pallet diagnostic target');
  assert.deepEqual(warnings([
    { ...loadedPallet, transform: { position: { x: 50, y: 45, z: 0 } }, placement: 'staged', hidden: true },
    makeInstance('above-staged-pallet', cargo.id, { x: 50, y: 52, z: 0 }, { placement: 'staged' }),
  ]), [], 'hiding a staged pallet does not make it loaded');
  assert.deepEqual(warnings([loadedPallet,
    makeInstance('bad-dims', malformed.id, { x: 50, y: 9, z: 0 }, { placement: 'packed' }),
  ]), [], 'malformed Case dimensions cannot contribute fabricated pallet load');
});

test('F02-OOG-1 through 5: packed cargo keeps shape warnings when hidden; staged cargo does not', () => {
  const caseData = makeCase();
  const fixtures = [
    [STANDARD_TRUCK, { x: 98, y: 5, z: 0 }, 'protrudesFront'],
    [WHEEL_WELL_TRUCK, { x: 25, y: 5, z: 20 }, 'outsideUsableZone'],
    [FRONT_OVERHANG_TRUCK, { x: 85, y: 5, z: 0 }, 'outsideUsableZone'],
  ];
  for (const [truck, position, issue] of fixtures) {
    const packed = makeInstance('packed-oog', caseData.id, position, { placement: 'packed' });
    const staged = makeInstance('staged-oog', caseData.id, position, { placement: 'staged' });
    const warnings = cases => PackLibrary.computeStats({ truck, cases }, [caseData]).oogWarnings;
    const visible = warnings([packed]);
    assert.equal(visible.length, 1, `${truck.shapeMode} packed OOG remains diagnosed`);
    assert.ok(visible[0].issues.includes(issue));
    assert.deepEqual(warnings([{ ...packed, hidden: true }]), visible);
    assert.deepEqual(warnings([packed, staged]), visible);
    assert.deepEqual(warnings([packed, { ...staged, hidden: true }]), visible);
    assert.deepEqual(warnings([staged]), []);
    assert.deepEqual(warnings([{ ...staged, hidden: true }]), []);
  }
  const unresolved = makeInstance('unresolved', caseData.id, { x: 0, y: 5, z: 0 },
    { placement: 'packed', transform: { position: null } });
  assert.deepEqual(PackLibrary.computeStats({ truck: STANDARD_TRUCK, cases: [unresolved] },
    [caseData]).oogWarnings, [], 'missing position cannot be fabricated for OOG');
});

test('F02 direct service APIs retain explicit staged exclusion without a PackLibrary cycle', () => {
  const caseData = makeCase('weighted', undefined, { weight: 20 });
  const loaded = makeInstance('loaded', caseData.id, { x: 20, y: 5, z: 0 },
    { placement: 'packed', hidden: true });
  const staged = makeInstance('staged', caseData.id, { x: -30, y: 5, z: 0 },
    { placement: 'staged' });
  assert.equal(computeCoG({ truck: STANDARD_TRUCK, cases: [loaded, staged] },
    [caseData]).totalWeight, 20);

  const pallet = makeCase('pallet', { length: 20, width: 20, height: 4 },
    { isPallet: true, maxPalletWeight: 10 });
  const loadedPallet = makeInstance('p', pallet.id, { x: 50, y: 2, z: 0 },
    { placement: 'packed', hidden: true });
  const loadedTop = makeInstance('top', caseData.id, { x: 50, y: 9, z: 0 },
    { placement: 'packed', hidden: true });
  const stagedTop = makeInstance('staged-top', caseData.id, { x: 50, y: 45, z: 0 },
    { placement: 'staged' });
  const warning = computePalletWarnings({ cases: [loadedPallet, loadedTop, stagedTop] },
    [pallet, caseData]);
  assert.equal(warning.length, 1);
  assert.equal(warning[0].actualWeight, 20);
  assert.deepEqual(warning[0].loadedCaseIds, ['top']);
});

test('UTIL-ENGINE-14 unresolved Case definitions produce an incomplete partial result', () => {
  const result = calculate(
    STANDARD_TRUCK,
    [makeInstance('missing', 'missing-case', { x: 5, y: 5, z: 0 })],
    []
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.cargoCubeVolume, 0);
  assert.equal(result.diagnostics.unresolvedInstances[0].reason, 'Case definition is missing');

  const malformedCase = makeCase('malformed', { length: 0, width: 10, height: 10 });
  const malformed = calculate(
    STANDARD_TRUCK,
    [makeInstance('malformed-instance', malformedCase.id, { x: 5, y: 5, z: 0 })],
    [malformedCase]
  );
  assert.equal(malformed.status, 'incomplete');
  assert.equal(malformed.unresolvedCount, 1);
  assert.match(malformed.diagnostics.unresolvedInstances[0].reason, /dimensions.*malformed/i);
});

test('UTIL-ENGINE-15 results are deterministic and inputs are never mutated', () => {
  const caseData = makeCase();
  const pack = {
    id: 'deterministic',
    truck: structuredClone(WHEEL_WELL_TRUCK),
    cases: [
      makeInstance('a', caseData.id, { x: 5, y: 5, z: 0 }),
      makeInstance('b', caseData.id, { x: 15, y: 5, z: 0 }),
    ],
  };
  const beforePack = structuredClone(pack);
  const beforeCases = structuredClone([caseData]);
  const first = computeSpaceUtilization({ pack, caseLibrary: [caseData], geometry: GEOMETRY });
  const second = computeSpaceUtilization({ pack, caseLibrary: [caseData], geometry: GEOMETRY });
  assert.deepEqual(first, second);
  assert.deepEqual(pack, beforePack);
  assert.deepEqual([caseData], beforeCases);
});

test('UTIL-ENGINE-16 Inspector gauge consumes the shared engine result', () => {
  const caseData = makeCase();
  const pack = {
    id: 'shared-result',
    truck: structuredClone(STANDARD_TRUCK),
    cases: [makeInstance('one', caseData.id, { x: 5, y: 5, z: 0 })],
  };
  const stats = PackLibrary.computeStats(pack, [caseData]);
  let computeCount = 0;
  const result = buildSpaceUtilizationResult(pack, {
    computeStats: () => {
      computeCount++;
      return stats;
    },
  });
  assert.equal(computeCount, 1);
  assert.equal(result.engineResult, stats.spaceUtilization);
  closeTo(result.percentage, stats.spaceUtilization.cargoCubePercent);

  const gauge = createSpaceUtilizationGauge({ documentRef: testDocument, result });
  assert.match(textTree(gauge), /0\.5%/);
  assert.equal(computeCount, 1, 'rendering the gauge must not trigger another calculation path');
});

test('UTIL-ENGINE-17 calculated spatial utilization is not persisted', () => {
  const caseData = makeCase();
  const pack = {
    id: 'not-persisted',
    truck: structuredClone(STANDARD_TRUCK),
    cases: [makeInstance('one', caseData.id, { x: 5, y: 5, z: 0 })],
  };
  const before = structuredClone(pack);
  const stats = PackLibrary.computeStats(pack, [caseData]);
  assert.ok(stats.spaceUtilization);
  assert.equal(Object.keys(stats).includes('spaceUtilization'), false);
  assert.doesNotMatch(JSON.stringify({ ...pack, stats }), /spaceUtilization|occupiedEnvelopeVolume|overlapVolume/);
  assert.deepEqual(pack, before);
});
