import test from 'node:test';
import assert from 'node:assert/strict';

const normalizerPath = new URL('../../src/core/normalizer.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const autoPackEnginePath = new URL('../../src/services/autopack-engine.js', import.meta.url);
const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);

const RECT_TRUCK = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
const MAX_PROFILE = 'max-capacity';

function makeCase(id, overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id,
    name: id,
    category: 'Default',
    color: '#999999',
    dimensions,
    volume: dimensions.length * dimensions.width * dimensions.height,
    weight: overrides.weight ?? 10,
    canFlip: overrides.canFlip ?? true,
    stackable: overrides.stackable ?? true,
    noStackOnTop: overrides.noStackOnTop ?? false,
    maxStackCount: overrides.maxStackCount ?? 0,
    orientationLock: overrides.orientationLock || 'any',
    ...overrides,
  };
}

function makeInstance(id, caseId, position, overrides = {}) {
  return {
    id,
    caseId,
    transform: {
      position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
    placement: 'packed',
    ...overrides,
  };
}

function marked(inst) {
  return { ...inst, packedProfile: MAX_PROFILE };
}

async function loadPackLibrary(cases, instances, truck = RECT_TRUCK, packId = 'pack-max-durability') {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({
    caseLibrary: cases,
    packLibrary: [{ id: packId, title: 'Max Capacity Durability', truck, cases: instances }],
    folderLibrary: [],
    preferences: {},
  });
  return { StateStore, PackLibrary, packId };
}

async function importRotatedMarkedPack(suffix, overrides = {}) {
  const caseData = makeCase(`import-rotated-${suffix}`, {
    dimensions: { length: 20, width: 10, height: 10 },
    orientationLock: 'onSide',
  });
  const instance = marked(makeInstance(
    `import-rotated-inst-${suffix}`,
    caseData.id,
    overrides.position || { x: 115, y: 5, z: 0 },
    {
      orientationLocked: true,
      lockedRotation: { x: 0, y: 0, z: 0 },
      transform: {
        position: overrides.position || { x: 115, y: 5, z: 0 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      ...(overrides.orientedDims ? { orientedDims: overrides.orientedDims } : {}),
    }
  ));
  const caseBefore = JSON.stringify(caseData);
  const instanceBefore = JSON.stringify(instance);
  const { PackLibrary } = await loadPackLibrary([], []);
  const imported = PackLibrary.importPackPayload({
    pack: {
      id: `import-rotated-pack-${suffix}`,
      title: 'Rotated Max Capacity Import',
      truck: RECT_TRUCK,
      cases: [instance],
    },
    bundledCases: [caseData],
  });
  return { imported: imported.cases[0], caseData, instance, caseBefore, instanceBefore };
}

test('MAX-CAPACITY-B1 Apply marks packed Max cases only and normal Apply removes markers', async () => {
  const { buildAppliedAutoPackCases } = await import(editorScreenPath.href);
  const source = [
    makeInstance('packed', 'case-a', { x: 10, y: 5, z: 0 }),
    marked(makeInstance('staged', 'case-a', { x: 10, y: 5, z: 80 }, { placement: 'staged' })),
  ];
  const sourceBefore = JSON.stringify(source);

  const maxCases = buildAppliedAutoPackCases({ id: 'max-capacity', nextCases: source });
  assert.equal(maxCases[0].packedProfile, MAX_PROFILE);
  assert.equal('packedProfile' in maxCases[1], false, 'staged Max result must remain unmarked');
  assert.equal(JSON.stringify(source), sourceBefore, 'transient Results cases must not be mutated');

  for (const id of ['default', 'compact-fill', 'floor-first', 'stack-priority', 'constrained-space-first']) {
    const normalCases = buildAppliedAutoPackCases({ id, nextCases: maxCases });
    assert.equal(normalCases.every(inst => !('packedProfile' in inst)), true, `${id} must clear profiles`);
  }
});

test('MAX-CAPACITY-B2 generating Max Capacity nextCases writes no durability marker', async () => {
  const { buildAutoPackNextCases } = await import(autoPackEnginePath.href);
  const source = [marked(makeInstance('a', 'case-a', { x: 10, y: 5, z: 0 }))];
  const nextCases = buildAutoPackNextCases(
    source,
    new Map([['a', { x: 20, y: 5, z: 0 }]]),
    new Map(),
    new Map(),
    new Map()
  );
  assert.equal('packedProfile' in nextCases[0], false, 'generation/viewing must stay metadata-free');
  assert.equal(source[0].packedProfile, MAX_PROFILE, 'generation must not mutate stored source cases');
});

test('MAX-CAPACITY-B3 normalizer canonicalizes the marker and actual Max rotation geometry', async () => {
  const { normalizeInstance } = await import(normalizerPath.href);
  const caseData = makeCase('rotating', {
    dimensions: { length: 20, width: 10, height: 5 },
    orientationLock: 'upright',
  });
  const base = marked(makeInstance('rotated', caseData.id, { x: 20, y: 10, z: 0 }, {
    orientationLocked: true,
    lockedRotation: { x: 0, y: 0, z: 0 },
    transform: {
      position: { x: 20, y: 10, z: 0 },
      rotation: { x: Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }));
  const normalized = normalizeInstance(base, new Map([[caseData.id, caseData]]));

  assert.equal(normalized.packedProfile, MAX_PROFILE);
  assert.deepEqual(normalized.orientedDims, { length: 20, width: 5, height: 10 });
  assert.equal(normalized.orientationLocked, true, 'normal exact-lock metadata must remain intact');
  assert.deepEqual(normalized.lockedRotation, { x: 0, y: 0, z: 0 });

  const staged = normalizeInstance({ ...base, placement: 'staged' }, new Map([[caseData.id, caseData]]));
  const malformed = normalizeInstance({ ...base, packedProfile: 'unknown' }, new Map([[caseData.id, caseData]]));
  assert.equal('packedProfile' in staged, false);
  assert.equal('packedProfile' in malformed, false);
  assert.equal('packedProfile' in normalizeInstance({ ...base, packedProfile: undefined }, new Map([[caseData.id, caseData]])), false);
});

test('MAX-CAPACITY-B4 marked child and marked cargo support bypass handling rules only', async () => {
  const supportCase = makeCase('support', {
    stackable: false,
    noStackOnTop: true,
    maxStackCount: 1,
    weight: 5,
  });
  const childCase = makeCase('child', { weight: 50 });
  const support = marked(makeInstance('support-inst', supportCase.id, { x: 20, y: 5, z: 0 }));
  const child = marked(makeInstance('child-inst', childCase.id, { x: 20, y: 15, z: 0 }));
  const caseRulesBefore = JSON.stringify([supportCase, childCase]);
  const { PackLibrary } = await loadPackLibrary([supportCase, childCase], [support, child]);

  const result = PackLibrary.reconcilePlacementsForTruck(
    { id: 'candidate', truck: RECT_TRUCK, cases: [support, child] },
    RECT_TRUCK,
    [supportCase, childCase]
  );
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.kept, ['support-inst', 'child-inst']);
  assert.equal(result.nextPack.cases.every(inst => inst.packedProfile === MAX_PROFILE), true);
  assert.equal(JSON.stringify([supportCase, childCase]), caseRulesBefore, 'validation must not mutate source case rules');
});

test('MAX-CAPACITY-B5 mixed marked and unmarked cargo relationships remain strict', async () => {
  const supportCase = makeCase('mixed-support', { stackable: false, noStackOnTop: true, weight: 5 });
  const childCase = makeCase('mixed-child', { weight: 50 });
  const variants = [
    [marked(makeInstance('support', supportCase.id, { x: 20, y: 5, z: 0 })), makeInstance('child', childCase.id, { x: 20, y: 15, z: 0 })],
    [makeInstance('support', supportCase.id, { x: 20, y: 5, z: 0 }), marked(makeInstance('child', childCase.id, { x: 20, y: 15, z: 0 }))],
  ];

  for (const instances of variants) {
    const { PackLibrary } = await loadPackLibrary([supportCase, childCase], instances);
    const result = PackLibrary.reconcilePlacementsForTruck(
      { id: 'mixed', truck: RECT_TRUCK, cases: instances },
      RECT_TRUCK,
      [supportCase, childCase]
    );
    assert.deepEqual(result.invalid, ['child'], 'a one-sided marker must not relax the relationship');
  }
});

test('MAX-CAPACITY-B5A marked-to-marked support may exceed the normal direct-child cap', async () => {
  const supportCase = makeCase('capped-support', {
    dimensions: { length: 40, width: 10, height: 10 },
    maxStackCount: 1,
  });
  const childCase = makeCase('capped-child');
  const instances = [
    marked(makeInstance('support', supportCase.id, { x: 30, y: 5, z: 0 })),
    marked(makeInstance('child-a', childCase.id, { x: 20, y: 15, z: 0 })),
    marked(makeInstance('child-b', childCase.id, { x: 40, y: 15, z: 0 })),
  ];
  const { PackLibrary } = await loadPackLibrary([supportCase, childCase], instances);
  const result = PackLibrary.reconcilePlacementsForTruck(
    { id: 'stack-cap', truck: RECT_TRUCK, cases: instances }, RECT_TRUCK, [supportCase, childCase]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.kept, ['support', 'child-a', 'child-b']);
});

test('MAX-CAPACITY-B6 marked orientation bypass preserves real rotation dimensions but not containment', async () => {
  const caseData = makeCase('locked', {
    dimensions: { length: 20, width: 10, height: 5 },
    orientationLock: 'upright',
  });
  const rotated = marked(makeInstance('rotated', caseData.id, { x: 20, y: 5, z: 0 }, {
    orientationLocked: true,
    lockedRotation: { x: 0, y: 0, z: 0 },
    transform: {
      position: { x: 20, y: 5, z: 0 },
      rotation: { x: Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }));
  const { PackLibrary } = await loadPackLibrary([caseData], [rotated]);
  const valid = PackLibrary.reconcilePlacementsForTruck(
    { id: 'orientation', truck: RECT_TRUCK, cases: [rotated] }, RECT_TRUCK, [caseData]);
  assert.deepEqual(valid.invalid, []);
  assert.deepEqual(valid.nextPack.cases[0].orientedDims, { length: 20, width: 5, height: 10 });

  const outside = { ...rotated, transform: { ...rotated.transform, position: { x: 118, y: 5, z: 0 } } };
  const invalid = PackLibrary.reconcilePlacementsForTruck(
    { id: 'outside', truck: RECT_TRUCK, cases: [outside] }, RECT_TRUCK, [caseData]);
  assert.deepEqual(invalid.invalid, ['rotated'], 'profile must not bypass real containment');
});

test('MAX-CAPACITY-B7 overlap, floating, and missing references remain invalid', async () => {
  const caseData = makeCase('physical');
  const cases = [
    marked(makeInstance('base', caseData.id, { x: 20, y: 5, z: 0 })),
    marked(makeInstance('overlap', caseData.id, { x: 20, y: 5, z: 0 })),
    marked(makeInstance('floating', caseData.id, { x: 50, y: 25, z: 0 })),
    marked(makeInstance('missing', 'missing-case', { x: 80, y: 5, z: 0 })),
  ];
  const { PackLibrary } = await loadPackLibrary([caseData], cases);
  const result = PackLibrary.reconcilePlacementsForTruck(
    { id: 'hard-rules', truck: RECT_TRUCK, cases }, RECT_TRUCK, [caseData]);
  const finalById = new Map(result.nextPack.cases.map(inst => [inst.id, inst]));
  assert.notDeepEqual(
    finalById.get('overlap').transform.position,
    finalById.get('base').transform.position,
    'an overlapping marked pose must be corrected rather than preserved'
  );
  assert.equal(
    Number(finalById.get('floating').transform.position.y),
    5,
    'a floating marked pose must settle onto a real supporting surface'
  );
  assert.deepEqual(result.unresolved.map(item => item.id), ['missing']);
});

test('MAX-CAPACITY-B7A marked cargo cannot enter Wheel Wells body or Front Overhang cab void/deck without retention', async () => {
  const caseData = makeCase('blocked-shapes');
  const wheelTruck = {
    length: 120,
    width: 60,
    height: 60,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 12, wellLength: 40, wellOffsetFromRear: 40 },
  };
  const inWheelBody = marked(makeInstance('wheel-body', caseData.id, { x: 50, y: 5, z: 24 }));
  const { PackLibrary } = await loadPackLibrary([caseData], [inWheelBody], wheelTruck);
  const wheelResult = PackLibrary.reconcilePlacementsForTruck(
    { id: 'wheel', truck: wheelTruck, cases: [inWheelBody] }, wheelTruck, [caseData]);
  const repairedWheel = wheelResult.nextPack.cases[0];
  const repairedWheelAabb = {
    min: {
      x: repairedWheel.transform.position.x - 5,
      y: repairedWheel.transform.position.y - 5,
      z: repairedWheel.transform.position.z - 5,
    },
    max: {
      x: repairedWheel.transform.position.x + 5,
      y: repairedWheel.transform.position.y + 5,
      z: repairedWheel.transform.position.z + 5,
    },
  };
  assert.equal(
    PackLibrary.aabbIntersectsWheelWellBlockedBody(repairedWheelAabb, wheelTruck),
    false,
    'a marked pose may be snapped onto the rigid top but cannot remain inside the body'
  );
  assert.notDeepEqual(repairedWheel.transform.position, inWheelBody.transform.position);

  const frontTruck = {
    length: 100,
    width: 60,
    height: 60,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 30, bonusHeight: 24 },
  };
  const inCabVoid = marked(makeInstance('cab-void', caseData.id, { x: 115, y: 5, z: 0 }));
  const unretainedDeck = marked(makeInstance('deck', caseData.id, { x: 115, y: 29, z: 0 }));
  const cabResult = PackLibrary.reconcilePlacementsForTruck(
    { id: 'front-cab', truck: frontTruck, cases: [inCabVoid] }, frontTruck, [caseData]);
  const deckResult = PackLibrary.reconcilePlacementsForTruck(
    { id: 'front-deck', truck: frontTruck, cases: [unretainedDeck] }, frontTruck, [caseData]);
  assert.deepEqual(cabResult.invalid, ['cab-void']);
  assert.deepEqual(deckResult.invalid, ['deck'], 'marked raised-deck cargo still requires rear retention');
});

test('MAX-CAPACITY-B8 delete keeps unrelated relaxed stacks fixed and marked', async () => {
  const supportCase = makeCase('delete-support', { noStackOnTop: true, stackable: false, weight: 5 });
  const childCase = makeCase('delete-child', { weight: 50 });
  const floorCase = makeCase('delete-floor');
  const instances = [
    marked(makeInstance('support', supportCase.id, { x: 20, y: 5, z: 0 })),
    marked(makeInstance('child', childCase.id, { x: 20, y: 15, z: 0 })),
    marked(makeInstance('delete-me', floorCase.id, { x: 60, y: 5, z: 0 })),
  ];
  const { PackLibrary, packId } = await loadPackLibrary([supportCase, childCase, floorCase], instances);
  const result = PackLibrary.removeInstances(packId, ['delete-me']);
  const byId = new Map(result.pack.cases.map(inst => [inst.id, inst]));

  assert.deepEqual(byId.get('support').transform.position, { x: 20, y: 5, z: 0 });
  assert.deepEqual(byId.get('child').transform.position, { x: 20, y: 15, z: 0 });
  assert.equal(byId.get('support').packedProfile, MAX_PROFILE);
  assert.equal(byId.get('child').packedProfile, MAX_PROFILE);
  assert.deepEqual(result.dependentStagedIds, []);
  assert.deepEqual(result.dependentRepairedIds, []);
});

test('MAX-CAPACITY-B9 delete stages unsupported dependents without disturbing unrelated marked cargo', async () => {
  const caseData = makeCase('delete-stack');
  const instances = [
    marked(makeInstance('support', caseData.id, { x: 20, y: 5, z: 0 })),
    marked(makeInstance('child', caseData.id, { x: 20, y: 15, z: 0 })),
    marked(makeInstance('unrelated', caseData.id, { x: 80, y: 5, z: 0 })),
  ];
  const { PackLibrary, packId } = await loadPackLibrary([caseData], instances);
  const result = PackLibrary.removeInstances(packId, ['support']);
  const byId = new Map(result.pack.cases.map(inst => [inst.id, inst]));

  assert.deepEqual(byId.get('unrelated').transform.position, { x: 80, y: 5, z: 0 });
  assert.equal(byId.get('unrelated').packedProfile, MAX_PROFILE);
  assert.equal(['packed', 'staged'].includes(byId.get('child').placement), true);
  if (byId.get('child').placement === 'packed') {
    assert.equal(byId.get('child').packedProfile, MAX_PROFILE, 'packed automatic repair retains profile');
  } else {
    assert.equal('packedProfile' in byId.get('child'), false, 'staged dependent loses profile');
  }
});

test('MAX-CAPACITY-B10 Truck Change preserves valid marked survivors and clears staged profiles', async () => {
  const caseData = makeCase('truck-change');
  const instances = [
    marked(makeInstance('valid', caseData.id, { x: 20, y: 5, z: 0 })),
    marked(makeInstance('invalid', caseData.id, { x: 100, y: 5, z: 0 })),
  ];
  const { PackLibrary } = await loadPackLibrary([caseData], instances);
  const smallerTruck = { ...RECT_TRUCK, length: 60 };
  const preview = PackLibrary.reconcilePlacementsForTruck(
    { id: 'truck-change', truck: RECT_TRUCK, cases: instances }, smallerTruck, [caseData]);
  assert.equal(preview.nextPack.cases.find(inst => inst.id === 'valid').packedProfile, MAX_PROFILE);
  assert.deepEqual(preview.invalid, ['invalid']);
  assert.equal(instances.every(inst => inst.packedProfile === MAX_PROFILE), true, 'preview must remain pure');

  const staged = PackLibrary.stagePlacementIds(preview.nextPack, preview.invalid, smallerTruck, [caseData]);
  const stagedInvalid = staged.pack.cases.find(inst => inst.id === 'invalid');
  assert.equal(stagedInvalid.placement, 'staged');
  assert.equal('packedProfile' in stagedInvalid, false);
});

test('MAX-CAPACITY-B11 pack duplication and StateStore Undo/Redo preserve markers generically', async () => {
  const caseData = makeCase('duplicate');
  const instance = marked(makeInstance('original', caseData.id, { x: 20, y: 5, z: 0 }));
  const { StateStore, PackLibrary, packId } = await loadPackLibrary([caseData], [instance]);
  const copy = PackLibrary.duplicate(packId);
  assert.equal(copy.cases[0].packedProfile, MAX_PROFILE);

  PackLibrary.update(packId, { title: 'Changed title' });
  assert.equal(StateStore.undo(), true);
  assert.equal(StateStore.get('packLibrary')[0].cases[0].packedProfile, MAX_PROFILE);
  assert.equal(StateStore.redo(), true);
  assert.equal(StateStore.get('packLibrary')[0].cases[0].packedProfile, MAX_PROFILE);
});

test('MAX-CAPACITY-B12 canonical PackLibrary import preserves only packed supported profile values', async () => {
  const caseData = makeCase('imported-profile');
  const packed = marked(makeInstance('packed-source', caseData.id, { x: 20, y: 5, z: 0 }));
  const staged = marked(makeInstance(
    'staged-source',
    caseData.id,
    { x: 40, y: 5, z: 80 },
    { placement: 'staged' }
  ));
  const unknown = makeInstance('unknown-source', caseData.id, { x: 60, y: 5, z: 0 }, {
    packedProfile: 'unsupported',
  });
  const { PackLibrary } = await loadPackLibrary([], []);
  const imported = PackLibrary.importPackPayload({
    pack: {
      id: 'incoming-max-profile',
      title: 'Imported Max Profile',
      truck: RECT_TRUCK,
      cases: [packed, staged, unknown],
    },
    bundledCases: [caseData],
  });
  const bySourcePosition = new Map(imported.cases.map(inst => [inst.transform.position.x, inst]));

  assert.equal(bySourcePosition.get(20).packedProfile, MAX_PROFILE);
  assert.equal(imported.cases.some(inst => inst.packedProfile === 'unsupported'), false);
  assert.equal(
    imported.cases.filter(inst => inst.placement === 'staged').every(inst => !('packedProfile' in inst)),
    true
  );
});

test('MAX-CAPACITY-B13 Pack import derives missing marked dimensions from actual rotation', async () => {
  const result = await importRotatedMarkedPack('missing-dims');
  assert.equal(result.imported.placement, 'packed');
  assert.deepEqual(result.imported.transform.position, { x: 115, y: 5, z: 0 });
  assert.equal(result.imported.packedProfile, MAX_PROFILE);
  assert.deepEqual(result.imported.orientedDims, { length: 10, width: 20, height: 10 });
  assert.equal(result.imported.orientationLocked, true);
  assert.deepEqual(result.imported.lockedRotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(result.imported.transform.rotation, { x: 0, y: Math.PI / 2, z: 0 });
  assert.equal(JSON.stringify(result.caseData), result.caseBefore, 'source case definition must remain unchanged');
  assert.equal(JSON.stringify(result.instance), result.instanceBefore, 'source instance metadata must remain unchanged');
});

test('MAX-CAPACITY-B14 Pack import replaces stale marked dimensions with canonical rotation geometry', async () => {
  const result = await importRotatedMarkedPack('stale-dims', {
    orientedDims: { length: 20, width: 10, height: 10 },
  });
  assert.equal(result.imported.placement, 'packed');
  assert.deepEqual(result.imported.transform.position, { x: 115, y: 5, z: 0 });
  assert.equal(result.imported.packedProfile, MAX_PROFILE);
  assert.deepEqual(result.imported.orientedDims, { length: 10, width: 20, height: 10 });
});

test('MAX-CAPACITY-B15 Pack import still stages genuinely out-of-bounds marked rotations', async () => {
  const result = await importRotatedMarkedPack('out-of-bounds', {
    position: { x: 116, y: 5, z: 0 },
  });
  assert.equal(result.imported.placement, 'staged');
  assert.equal('packedProfile' in result.imported, false);
  assert.notDeepEqual(result.imported.transform.position, { x: 116, y: 5, z: 0 });
  assert.deepEqual(result.imported.orientedDims, { length: 10, width: 20, height: 10 });
});
