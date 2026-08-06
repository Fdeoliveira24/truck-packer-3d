import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSpaceUtilization } from '../../src/packing-core/space-utilization-engine.js';
import * as PackLibrary from '../../src/services/pack-library.js';
import {
  buildSpaceUtilizationResult,
  createSpaceUtilizationAnalysisDetails,
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

test('UTIL-ENGINE-13 hidden Cases preserve current exclusion semantics', () => {
  const hidden = makeInstance('hidden', 'case-1', { x: -10, y: 5, z: 0 }, { hidden: true });
  const result = calculate(STANDARD_TRUCK, [hidden]);
  assert.equal(result.status, 'ready');
  assert.equal(result.hiddenCount, 1);
  assert.equal(result.loadedCount, 0);
  assert.equal(result.stagedCount, 0);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.instanceAabbs.length, 0);
  assert.equal(result.outsideVolume, 0);
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

test('UTIL-ENGINE-16 gauge and Analysis Details consume the same engine result', () => {
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
  const details = createSpaceUtilizationAnalysisDetails({ documentRef: testDocument, result });
  assert.match(textTree(gauge), /0\.5%/);
  assert.match(textTree(details), /0\.5%/);
  assert.equal(computeCount, 1, 'rendering both consumers must not trigger another calculation path');
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
