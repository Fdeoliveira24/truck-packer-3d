// packing geometry: contract tests from the former security suite.

import { TrailerPresets } from '../../src/data/trailer-presets.js';
import {
  assessPhysicalSubject, assessSupportPaths, assessResultantBounds,
  aggregatePhysicalAssessment, assessOperationalEligibility, ROAD_PLANNING_REFERENCE_G,
} from '../../src/packing-core/assessment.js';
import {
  measureContactUnion, measureSupportContacts, supportHullMargin, supportConvexHull, solveContactReactions,
} from '../../src/packing-core/validation.js';
import { measureRearBlocking } from '../../src/packing-core/retention-model.js';
import {
  WW_SUPPORT_TRUCK,
  assert,
  assertPackImportNoOverlaps,
  autoPackEnginePath,
  autoPackSolverPath,
  editorScreenPath,
  fs,
  getPackImportAabb,
  makePackImportInstance,
  makePackImportSafeCase,
  normalizerPath,
  packLibraryPath,
  packingCoreValidationPath,
  packsScreenPath,
  phb2AssertAnimationBatches,
  phb2AssertDirectStackLimit,
  phb2AssertSafe,
  phb2SequentialForwardViolation,
  phbSolverModules,
  phc2Aabb,
  phcFloorTable,
  phcFrontOverhangTruck,
  phcResultBytes,
  readAppSource,
  sceneRuntimePath,
  stateStorePath,
  test,
  testAabbInsidePhysicalTrailer,
  testAabbOnPhysicalFloor,
  threeOrientedTruth,
  trailerGeometryPath,
  wwAabb,
  wwAssertHardSafe,
  wwAvoidableForwardFloorMove,
  wwFloorForwardSlack,
  wwFloorSideSlack,
  wwNonFloorFrontSlack,
  wwResultPlacements,
  wwStagedRaisedOverhangOpportunity,
} from '../fixtures/security-invariants-support.mjs';

test('KEYBOARD-DUPLICATE-SAFE multi-select paste preserves group spacing without collisions', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-keyboard-multi-paste', dimensions: { length: 12, width: 12, height: 12 } });
  const pack = {
    id: 'pack-keyboard-multi-paste',
    title: 'Keyboard Multi Paste',
    truck: { length: 96, width: 60, height: 48 },
    cases: [
      makePackImportInstance(caseData.id, { id: 'source-a', transform: { position: { x: 6, y: 6, z: -18 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'source-b', transform: { position: { x: 18, y: 6, z: -18 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'occupied-a', transform: { position: { x: 30, y: 6, z: -18 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'occupied-b', transform: { position: { x: 42, y: 6, z: -18 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
    ],
  };
  const clipboard = pack.cases.slice(0, 2).map(inst => JSON.parse(JSON.stringify(inst)));

  StateStore.init({ caseLibrary: [caseData], packLibrary: [pack], folderLibrary: [], preferences: {} });
  const result = PackLibrary.duplicateInstancesSafely(pack.id, clipboard, [caseData]);
  const updated = PackLibrary.getById(pack.id);
  const pasted = updated.cases.filter(inst => result.newIds.includes(inst.id));

  assert.equal(result.placement, 'packed', 'multi paste should use an alternate packed offset when the first offset is occupied');
  assert.equal(pasted.length, 2);
  assert.equal(
    Math.abs(pasted[0].transform.position.x - pasted[1].transform.position.x),
    12,
    'multi-select paste must preserve the copied group spacing'
  );
  assertPackImportNoOverlaps(updated.cases, caseData);
});

test('KEYBOARD-DUPLICATE-SAFE duplicate and paste respect Wheel Wells blocked bodies', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-keyboard-wheelwell', dimensions: { length: 10, width: 10, height: 10 } });
  const truck = {
    length: 100,
    width: 100,
    height: 80,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 35, wellWidth: 15, wellLength: 35, wellOffsetFromRear: 25 },
  };
  const pack = {
    id: 'pack-keyboard-wheelwell',
    title: 'Keyboard Wheel Well',
    truck,
    cases: [
      makePackImportInstance(caseData.id, { id: 'source', transform: { position: { x: 30, y: 5, z: 30 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'block-x-plus', transform: { position: { x: 40, y: 5, z: 30 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'block-x-minus', transform: { position: { x: 20, y: 5, z: 30 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'block-z-minus', transform: { position: { x: 30, y: 5, z: 20 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'block-diag-plus', transform: { position: { x: 40, y: 5, z: 20 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
      makePackImportInstance(caseData.id, { id: 'block-diag-minus', transform: { position: { x: 20, y: 5, z: 20 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed' }),
    ],
  };

  StateStore.init({ caseLibrary: [caseData], packLibrary: [pack], folderLibrary: [], preferences: {} });
  const result = PackLibrary.duplicateInstancesSafely(pack.id, [pack.cases[0]], [caseData]);
  const updated = PackLibrary.getById(pack.id);
  const created = updated.cases.find(inst => result.newIds.includes(inst.id));

  assert.ok(['packed', 'staged'].includes(result.placement),
    'wheel-well duplicate must resolve to a valid packed placement or safe staged fallback');
  assert.equal(
    PackLibrary.aabbIntersectsWheelWellBlockedBody(getPackImportAabb(created, caseData), truck),
    false,
    'keyboard duplicate/paste must never persist a copy intersecting the wheel-well body'
  );
  assertPackImportNoOverlaps(updated.cases, caseData);
});

test('KEYBOARD-DUPLICATE-SAFE duplicate helper preserves orientation metadata and button path reuses it', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-keyboard-lock', dimensions: { length: 24, width: 48, height: 30 } });
  const locked = makePackImportInstance(caseData.id, {
    id: 'locked-source',
    transform: { position: { x: 12, y: 15, z: -12 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
    placement: 'packed',
    orientationLocked: true,
    lockedRotation: { x: 0, y: Math.PI / 2, z: 0 },
    orientedDims: { length: 48, width: 24, height: 30 },
  });
  const pack = {
    id: 'pack-keyboard-lock',
    title: 'Keyboard Lock',
    truck: { length: 120, width: 80, height: 80 },
    cases: [locked],
  };

  StateStore.init({ caseLibrary: [caseData], packLibrary: [pack], folderLibrary: [], preferences: {} });
  const result = PackLibrary.duplicateInstancesSafely(pack.id, [locked], [caseData]);
  const updated = PackLibrary.getById(pack.id);
  const created = updated.cases.find(inst => result.newIds.includes(inst.id));
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');

  assert.equal(created.orientationLocked, true);
  assert.deepEqual(created.lockedRotation, locked.lockedRotation);
  assert.deepEqual(created.orientedDims, locked.orientedDims);
  assert.match(editorSrc, /PackLibrary\.duplicateInstancesSafely\(pack\.id,\s*source,\s*CaseLibrary\.getCases\(\)\)/,
    'Inspector Duplicate button path must route through the same safe duplicate helper');
});

test('PLACEMENT-STATE-S2 addInstance writes "staged" placement by default', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-placement-default', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-placement-default', title: 'Placement Default', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  const instance = PackLibrary.addInstance('pack-placement-default', caseData.id);
  assert.equal(instance.placement, 'staged',
    'addInstance without an explicit position must default to staged placement');

  const pack = PackLibrary.getById('pack-placement-default');
  assert.equal(pack.cases[0].placement, 'staged',
    'persisted instance must record staged placement');
});

test('PLACEMENT-STATE-S2 explicit in-truck addInstance writes "packed" placement', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-placement-packed', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-placement-packed', title: 'Placement Packed', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  const instance = PackLibrary.addInstance('pack-placement-packed', caseData.id, { x: 50, y: 5, z: 0 });
  assert.equal(instance.placement, 'packed',
    'an explicit position inside the trailer usable zone must be recorded as packed');
});

test('PLACEMENT-STATE-S2 explicit outside-truck addInstance writes "staged" placement', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-placement-outside', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-placement-outside', title: 'Placement Outside', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  const instance = PackLibrary.addInstance('pack-placement-outside', caseData.id, { x: 50, y: 5, z: 60 });
  assert.equal(instance.placement, 'staged',
    'an explicit position outside the trailer usable zone must be recorded as staged');
});

test('M01 Case Browser explicit truck drop rejects occupied and hidden cargo without a Pack write', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'm01-case', dimensions: { length: 10, width: 10, height: 10 } });
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
  for (const hidden of [false, true]) {
    const packId = `m01-truck-${hidden}`;
    StateStore.init({
      caseLibrary: [caseData],
      packLibrary: [{ id: packId, title: 'Drop', truck, lastEdited: 1, cases: [
        makePackImportInstance(caseData.id, {
          id: 'obstacle', hidden, placement: 'packed',
          transform: { position: { x: 20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        }),
      ] }],
      folderLibrary: [], preferences: {},
    });
    const before = PackLibrary.getById(packId);
    assert.equal(PackLibrary.addInstance(packId, caseData.id, { x: 20, y: 5, z: 0 }), null);
    assert.strictEqual(PackLibrary.getById(packId), before, 'rejection must not update the Pack');
    const accepted = PackLibrary.addInstance(packId, caseData.id, { x: 40, y: 5, z: 0 });
    assert.equal(accepted?.placement, 'packed', 'empty floor position must succeed');
    assert.equal(PackLibrary.getById(packId).cases.length, 2);
    assert.ok(PackLibrary.getById(packId).lastEdited > 1, 'the accepted add updates lastEdited');
    assert.equal(StateStore.undo(), true, 'one Undo restores the prior Pack');
    assert.equal(PackLibrary.getById(packId).cases.length, 1);
    assert.equal(StateStore.undo(), false, 'the rejected drop created no history entry');
    assert.equal(StateStore.redo(), true, 'one Redo restores the accepted placement');
    assert.equal(PackLibrary.getById(packId).cases[1].id, accepted.id);
  }
});

test('M01 Case Browser explicit staging drop reuses safe non-overlapping staging layout', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'm01-stage-case', dimensions: { length: 10, width: 10, height: 10 } });
  const packId = 'm01-stage';
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
  const existing = makePackImportInstance(caseData.id, {
    id: 'staged-obstacle', placement: 'staged',
    transform: { position: { x: 20, y: 5, z: 60 }, rotation: { x: 0, y: 0, z: 0 } },
  });
  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: packId, title: 'Stage drop', truck, cases: [existing] }],
    folderLibrary: [], preferences: {},
  });
  const added = PackLibrary.addInstance(packId, caseData.id, { x: 20, y: 5, z: 60 });
  assert.equal(added?.placement, 'staged');
  assertPackImportNoOverlaps(PackLibrary.getById(packId).cases, caseData);
});

test('M01 staging drop reserves trusted unresolved staged geometry without inventing dimensions', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'm01-known-stage', dimensions: { length: 10, width: 10, height: 10 } });
  const packId = 'm01-unresolved-stage';
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: packId, truck, cases: [
      { id: 'missing-staged', caseId: 'missing', placement: 'staged',
        orientedDims: { length: 10, width: 10, height: 10 },
        transform: { position: { x: 20, y: 5, z: 60 }, rotation: { x: 0, y: 0, z: 0 } } },
    ] }],
    folderLibrary: [], preferences: {},
  });
  const added = PackLibrary.addInstance(packId, caseData.id, { x: 20, y: 5, z: 60 });
  assert.equal(added?.placement, 'staged');
  assert.notDeepEqual(added.transform.position, { x: 20, y: 5, z: 60 });
});

test('M03 Case Browser truck drop respects trusted unresolved packed geometry', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'm03-browser-known', dimensions: { length: 10, width: 10, height: 10 } });
  const packId = 'm03-browser';
  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: packId, truck: { length: 120, width: 60, height: 60, shapeMode: 'rect' }, cases: [
      { id: 'unresolved-packed', caseId: 'missing', placement: 'packed', hidden: true,
        orientedDims: { length: 10, width: 10, height: 10 },
        transform: { position: { x: 20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } },
    ] }],
    folderLibrary: [], preferences: {},
  });
  const before = PackLibrary.getById(packId);
  assert.equal(PackLibrary.addInstance(packId, caseData.id, { x: 20, y: 5, z: 0 }), null);
  assert.strictEqual(PackLibrary.getById(packId), before);
});

test('PLACEMENT-STATE-S2 manual delete of a support recursively settles dependents', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-manual-stack-delete', dimensions: { length: 10, width: 10, height: 10 } });
  const mk = (id, y) => makePackImportInstance(caseData.id, {
    id,
    transform: { position: { x: 20, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    placement: 'packed',
  });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{
      id: 'pack-manual-stack-delete',
      title: 'Manual Stack Delete',
      truck: { length: 120, width: 60, height: 60, shapeMode: 'rect' },
      cases: [mk('base', 5), mk('child', 15), mk('grandchild', 25)],
    }],
    folderLibrary: [],
    preferences: {},
  });

  const result = PackLibrary.removeInstances('pack-manual-stack-delete', ['base']);
  const pack = PackLibrary.getById('pack-manual-stack-delete');
  const byId = new Map(pack.cases.map(inst => [inst.id, inst]));
  assert.deepEqual(result.deletedInstanceIds, ['base'],
    'removeInstances must report the exact selected instance ID that was deleted');
  assert.deepEqual(result.dependentStagedIds, [],
    'settled dependents must not be reported as staged');
  assert.equal(result.dependentStagedCount, 0,
    'staged dependent count must remain zero when dependents settle safely');
  assert.deepEqual(result.finalSelectionIds, [],
    'delete mutation result must tell callers to clear stale selection');
  assert.equal(byId.has('base'), false, 'deleted support must be removed');
  assert.equal(byId.get('child').transform.position.y, 5,
    'first dependent must settle to the floor instead of floating at the old stack height');
  assert.equal(byId.get('grandchild').transform.position.y, 15,
    'second dependent must settle recursively onto the adjusted first dependent');
  assert.equal(pack.cases.every(inst => inst.placement === 'packed'), true,
    'settled dependents inside usable geometry remain packed');
});

test('DELETE-REVALIDATION removeInstances adjusts true dependents and preserves unrelated invalid cargo', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({
    id: 'case-delete-revalidation-wheelwell',
    dimensions: { length: 18, width: 18, height: 12 },
  });
  const mk = (id, position, placement = 'packed') => makePackImportInstance(caseData.id, {
    id,
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    placement,
  });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{
      id: 'pack-delete-revalidation-wheelwell',
      title: 'Delete Revalidation Wheel Wells',
      truck: {
        length: 120,
        width: 60,
        height: 60,
        shapeMode: 'wheelWells',
        shapeConfig: {
          wellHeight: 20,
          wellWidth: 12,
          wellLength: 40,
          wellOffsetFromRear: 40,
        },
      },
      cases: [
        mk('selected-support', { x: 12, y: 6, z: 0 }),
        mk('true-dependent', { x: 12, y: 18, z: 0 }),
        // This invalid seam pose is physically unrelated to the deleted support.
        mk('unrelated-invalid', { x: 60, y: 36, z: 18 }),
        mk('unrelated-front', { x: 100, y: 6, z: 0 }),
      ],
    }],
    folderLibrary: [],
    preferences: {},
  });

  const untouched = structuredClone(PackLibrary.getById('pack-delete-revalidation-wheelwell').cases
    .filter(inst => inst.id.startsWith('unrelated')));
  const result = PackLibrary.removeInstances('pack-delete-revalidation-wheelwell', ['selected-support']);
  const pack = PackLibrary.getById('pack-delete-revalidation-wheelwell');
  const byId = new Map(pack.cases.map(inst => [inst.id, inst]));

  assert.deepEqual(result.deletedInstanceIds, ['selected-support'],
    'only the selected support instance may be reported as deleted');
  assert.equal(byId.has('selected-support'), false,
    'selected support instance must be removed');
  assert.equal(byId.get('true-dependent').transform.position.y, 6, 'the actual dependent settles to the floor');
  assert.deepEqual(result.revalidation.adjustedIds, ['true-dependent']);
  assert.deepEqual(result.dependentRepairedIds, [], 'unrelated invalid cargo is not reported as locally repaired');
  assert.deepEqual(result.dependentStagedIds, [], 'unrelated invalid cargo is not reported as staged');
  assert.equal(result.dependentStagedCount, 0);
  assert.deepEqual(pack.cases.filter(inst => inst.id.startsWith('unrelated')), untouched);
});

test('DELETE-REVALIDATION multi-delete removes exactly selected instance IDs', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-delete-revalidation-multi' });
  const mk = (id, x) => makePackImportInstance(caseData.id, {
    id,
    transform: { position: { x, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    placement: 'packed',
  });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{
      id: 'pack-delete-revalidation-multi',
      title: 'Delete Revalidation Multi',
      truck: { length: 120, width: 60, height: 60, shapeMode: 'rect' },
      cases: [mk('keep-a', 10), mk('delete-a', 25), mk('delete-b', 40), mk('keep-b', 55)],
    }],
    folderLibrary: [],
    preferences: {},
  });

  const result = PackLibrary.removeInstances('pack-delete-revalidation-multi', ['delete-a', 'delete-b']);
  const pack = PackLibrary.getById('pack-delete-revalidation-multi');
  const ids = pack.cases.map(inst => inst.id).sort();

  assert.deepEqual(result.deletedInstanceIds, ['delete-a', 'delete-b'],
    'multi-delete must report only selected instance IDs as deleted');
  assert.deepEqual(ids, ['keep-a', 'keep-b'],
    'multi-delete must remove exactly selected instances and keep all others');
  assert.deepEqual(result.dependentStagedIds, [],
    'multi-delete with no invalid dependents must not report staged dependents');
  assert.deepEqual(result.finalSelectionIds, [],
    'multi-delete result must clear stale selection IDs');
});

test('PLACEMENT-STATE-S2 manual movement of a support revalidates the unsupported child', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-manual-stack-move', dimensions: { length: 10, width: 10, height: 10 } });
  const base = makePackImportInstance(caseData.id, {
    id: 'base',
    transform: { position: { x: 20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    placement: 'packed',
  });
  const child = makePackImportInstance(caseData.id, {
    id: 'child',
    transform: { position: { x: 20, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    placement: 'packed',
  });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{
      id: 'pack-manual-stack-move',
      title: 'Manual Stack Move',
      truck: { length: 120, width: 60, height: 60, shapeMode: 'rect' },
      cases: [base, child],
    }],
    folderLibrary: [],
    preferences: {},
  });

  const nextCases = [base, child].map(inst =>
    inst.id === 'base'
      ? { ...inst, transform: { ...inst.transform, position: { x: 50, y: 5, z: 0 } } }
      : inst
  );
  const result = PackLibrary.updateCasesWithManualRevalidation('pack-manual-stack-move', nextCases, [caseData]);
  const pack = PackLibrary.getById('pack-manual-stack-move');
  const byId = new Map(pack.cases.map(inst => [inst.id, inst]));

  assert.deepEqual(byId.get('base').transform.position, { x: 50, y: 5, z: 0 },
    'manual support movement should be preserved when it is safe');
  assert.equal(byId.get('child').transform.position.y, 5,
    'child left behind by support movement must settle to the floor instead of floating');
  assert.deepEqual(result.adjustedIds, ['child'],
    'manual revalidation must report the dependent it adjusted');
});

test('PLACEMENT-STATE-S2 duplicateSelection records placement from staging fallback', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function duplicateSelection(pack, selectedIds)');
  const end = src.indexOf('\n    }', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define duplicateSelection(pack, selectedIds)');
  assert.match(block, /PackLibrary\.duplicateInstancesSafely\(pack\.id,\s*source,\s*CaseLibrary\.getCases\(\)\)/,
    'duplicateSelection must route through the shared safe duplicate helper');
  assert.match(block, /result\.placement === 'staged'/,
    'duplicateSelection must surface staged fallback results from the shared helper');
});

test('PLACEMENT-STATE-S2 finishDrag records placement from final zone containment', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishDrag()');
  const end = src.indexOf('\n    }', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define finishDrag()');
  assert.match(block, /PackLibrary\.isAabbContainedInAnyZone\(aabb, zonesInches\)/,
    'finishDrag must derive placement from the final AABB against trailer usable zones');
  assert.match(block, /placementById\.set\(id, PackLibrary\.isAabbContainedInAnyZone\(aabb, zonesInches\) \? 'packed' : 'staged'\)/,
    'finishDrag must mark instances inside the trailer usable zones as packed and instances outside as staged');
  assert.match(block, /placement:\s*placementValue/,
    'finishDrag must write the computed placement onto each moved instance');
});

test('PLACEMENT-STATE-S2 normalizer keeps old packs without a placement field loadable', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);

  const normalized = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-legacy-placement',
        name: 'Legacy Case',
        dimensions: { length: 24, width: 24, height: 24 },
      },
    ],
    packLibrary: [
      {
        id: 'pack-legacy-placement',
        title: 'Legacy Pack',
        truck: { length: 120, width: 48, height: 48 },
        cases: [
          {
            id: 'inst-legacy-no-placement',
            caseId: 'case-legacy-placement',
            transform: { position: { x: 10, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
          },
        ],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });

  const instance = normalized.packLibrary[0].cases[0];
  assert.equal(instance.id, 'inst-legacy-no-placement',
    'old packs without a placement field must still load their instances');
  assert.equal(instance.placement, null,
    'instances without a placement field must normalize to null, not throw or default to a guessed state');
});

test('STAGING-S3 pack-library exposes staging bounds derived from the canonical staging layout', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const layout = PackLibrary.getStagingLayout(truck);
  const bounds = PackLibrary.getStagingBounds(truck);

  assert.equal(bounds.min.z, layout.originZ - layout.gap,
    'staging bounds must start at the canonical staging origin (minus margin) in Z');
  assert.ok(bounds.min.z >= truck.width / 2 - 0.001,
    'staging bounds must not overlap the trailer usable width');
  assert.ok(bounds.max.x > layout.truckL,
    'staging bounds must extend at least to the trailer length in X');
  assert.ok(bounds.max.z > bounds.min.z,
    'staging bounds must define a non-empty depth');
});

test('STAGING-S3 isAabbInStagingZone accepts canonical staged positions and rejects far drift', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const pack = { truck };
  const dims = { length: 30, width: 20, height: 24 };
  const staged = PackLibrary.findSafeStagingPosition(pack, dims, []);

  assert.equal(PackLibrary.isAabbInStagingZone(pack, staged.aabb), true,
    'an item placed by findSafeStagingPosition must be inside the canonical staging zone');

  const farAabb = {
    min: { x: 5000, y: 0, z: 5000 },
    max: { x: 5030, y: 24, z: 5020 },
  };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, farAabb), false,
    'an AABB drifted far away from the trailer must not be considered inside the staging zone');
});

test('STAGING-S3.1 canonical staging placement still starts near the trailer', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const dims = { length: 24, width: 24, height: 24 };
  const staged = PackLibrary.findSafeStagingPosition(pack, dims, []);
  const stagingBounds = PackLibrary.getStagingBounds(truck);

  assert.ok(
    staged.aabb.min.z >= stagingBounds.min.z - 0.001 && staged.aabb.max.z <= stagingBounds.max.z + 0.001,
    'canonical auto-placed staging items must remain inside the tight canonical staging-row envelope near the trailer'
  );
});

test('STAGING-S3.1 staging work-area bounds are larger than the canonical staging layout bounds', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const stagingBounds = PackLibrary.getStagingBounds(truck);
  const workArea = PackLibrary.getStagingWorkAreaBounds(truck);

  assert.ok(workArea.min.x < stagingBounds.min.x,
    'work area must extend further before the trailer in X than canonical staging');
  assert.ok(workArea.max.x > stagingBounds.max.x,
    'work area must extend further past the trailer in X than canonical staging');
  assert.ok(workArea.min.z < stagingBounds.min.z,
    'work area must extend to the opposite side of the trailer in Z, unlike canonical staging');
  assert.ok(workArea.max.z > stagingBounds.max.z,
    'work area must extend further beyond the canonical staging rows in Z');
});

test('STAGING-S3.1 a staged item several feet away from the trailer is accepted', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // 24" item sitting ~30" past the back of the trailer (x beyond truck.length)
  const aabb = { min: { x: 230, y: 0, z: -12 }, max: { x: 254, y: 24, z: 12 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), false,
    'sanity check: this position must be outside the trailer usable zones');
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), true,
    'an item dragged a few feet past the back of the trailer must remain inside the staging work area');
});

test('STAGING-S3.1 a staged item on the opposite side of the trailer is accepted', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // 24" item on the -Z side of the trailer (opposite the canonical staging rows)
  const aabb = { min: { x: 50, y: 0, z: -100 }, max: { x: 74, y: 24, z: -76 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), false,
    'sanity check: this position must be outside the trailer usable zones');
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), true,
    'the staging work area must support both sides of the trailer, not only the canonical staging side');
});

test('STAGING-S3.1 a staged item extremely far away is rejected', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };

  const aabb = { min: { x: 5000, y: 0, z: 5000 }, max: { x: 5024, y: 24, z: 5024 } };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), false,
    'an item dragged extremely far away must still be rejected by the staging work area');
});

test('STAGING-S3.1 rotation near the edge of the larger work area has tolerance', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const workArea = PackLibrary.getStagingWorkAreaBounds(truck);

  const atEdge = {
    min: { x: 100, y: 0, z: workArea.min.z - 0.04 },
    max: { x: 124, y: 24, z: workArea.min.z - 0.04 + 24 },
  };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, atEdge), true,
    'an AABB within the floating-point epsilon of the work-area edge must not be falsely rejected');

  const beyondEdge = {
    min: { x: 100, y: 0, z: workArea.min.z - 1 },
    max: { x: 124, y: 24, z: workArea.min.z - 1 + 24 },
  };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, beyondEdge), false,
    'an AABB clearly past the work-area edge must still be rejected');
});

test('STAGING-S3.1 packed item containment inside the trailer remains strict despite the larger work area', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // Just past the trailer's back wall (x.max = 221 > truck.length = 220 by more than EPS)
  const aabb = { min: { x: 197, y: 0, z: -12 }, max: { x: 221, y: 24, z: 12 } };

  assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), false,
    'an AABB extending past the trailer usable zone must not be considered packed, even though it is well within the larger staging work area');
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), true,
    'sanity check: this position is comfortably inside the larger staging work area');
});

test('STAGING-S3.2 rotateSelection allows free staged rotation and writes placement from trailer containment', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function rotateSelection(axis, delta)');
  const end = src.indexOf('\n    /**\n     * Nudge selected instances', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define rotateSelection(axis, delta)');
  assert.doesNotMatch(block, /isAabbInStagingZone/,
    'rotateSelection must not gate staged rotation on the staging work-area bounds');
  assert.match(block, /if \(check\.collides \|\| \(originalInsideTruck && !check\.insideTruck\)\)/,
    'rotateSelection must still revert on collision, or when a packed item would leave the trailer usable zones');
  assert.match(block, /placement:\s*check\.insideTruck \? 'packed' : 'staged',/,
    'rotateSelection must record placement based on the rotated item\'s final trailer containment');
});

test('STAGING-S3.2 finishDrag does not reject staged placement based on staging work-area bounds', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishDrag()');
  const end = src.indexOf('\n    }', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define finishDrag()');
  assert.doesNotMatch(block, /isAabbInStagingZone/,
    'finishDrag must not gate staged placement on the staging work-area bounds');
  assert.doesNotMatch(block, /anyOutsideAllowedZones/,
    'finishDrag must not revert a non-colliding drop solely for landing outside the staging work area');
  assert.doesNotMatch(block, /Cannot place here: outside the staging area/,
    'finishDrag must no longer show a staging-area rejection toast');
  assert.match(block, /placementById\.set\(id, PackLibrary\.isAabbContainedInAnyZone\(aabb, zonesInches\) \? 'packed' : 'staged'\)/,
    'finishDrag must derive placement purely from trailer usable-zone containment');
  assert.match(block, /if \(anyCollides && groupIds\.length === 1\) \{[\s\S]*revertGroupToStart\(groupIds, startMap\)/,
    'finishDrag must still revert a single-case raw collision');
  assert.match(block, /groupIds\.length > 1 && tryCommitAtomicManualGroup\(packId, pack, groupIds, startMap\)/,
    'multi-select collisions must still route through tolerant atomic revalidation');
});

test('STAGING-S3.2 staging work-area helpers remain exported but are no longer enforced by the editor', async () => {
  const packSrc = await fs.readFile(packLibraryPath, 'utf8');
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');

  assert.match(packSrc, /export function getStagingBounds\(truck, options = \{\}\)/,
    'getStagingBounds must remain exported from S1');
  assert.match(packSrc, /export function getStagingWorkAreaBounds\(truck, options = \{\}\)/,
    'getStagingWorkAreaBounds must remain exported for future use');
  assert.match(packSrc, /export function isAabbInStagingZone\(pack, aabb, options = \{\}\)/,
    'isAabbInStagingZone must remain exported for future use');
  assert.doesNotMatch(editorSrc, /isAabbInStagingZone/,
    'editor-screen must not call isAabbInStagingZone for manual drag/rotate validation anymore');
});

test('STAGING-S3.2 a staged item far from the trailer is classified as staged, not rejected', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // Far outside both the trailer and the old S3.1 staging work-area bounds
  const farAabb = { min: { x: 5000, y: 0, z: 5000 }, max: { x: 5024, y: 24, z: 5024 } };
  const placement = PackLibrary.isAabbContainedInAnyZone(farAabb, zones) ? 'packed' : 'staged';

  assert.equal(placement, 'staged',
    'an item dragged far from the trailer must be classified as staged, not rejected outright');
});

test('G1-DIRECTION pack-library exports a truck direction model contract', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  assert.ok(PackLibrary.TRUCK_DIRECTION_MODEL, 'TRUCK_DIRECTION_MODEL must be exported');
  assert.equal(PackLibrary.TRUCK_DIRECTION_MODEL.lengthAxis, 'x', 'length must be modeled along X');
  assert.equal(PackLibrary.TRUCK_DIRECTION_MODEL.widthAxis, 'z', 'width must be modeled along Z');
  assert.equal(PackLibrary.TRUCK_DIRECTION_MODEL.heightAxis, 'y', 'height must be modeled along Y');

  assert.equal(typeof PackLibrary.getTruckDirectionModel, 'function',
    'getTruckDirectionModel(truck) must be exported');
});

test('G1-DIRECTION rear/loading-door maps to x=0 and front/cab maps to x=truck.length', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72 };
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.deepEqual(model.rear, { axis: 'x', value: 0 },
    'rear / loading-door side must be x=0');
  assert.deepEqual(model.front, { axis: 'x', value: truck.length },
    'front / cab side must be x=truck.length');
});

test('G1-DIRECTION width is centered on Z and floor maps to y=0', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72 };
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.deepEqual(model.left, { axis: 'z', value: -truck.width / 2 },
    'left side must be z=-truck.width/2');
  assert.deepEqual(model.right, { axis: 'z', value: truck.width / 2 },
    'right side must be z=+truck.width/2');
  assert.deepEqual(model.floor, { axis: 'y', value: 0 },
    'floor must be y=0');
});

test('G1-DIRECTION getStagingLayout still starts at originX=0, matching the rear/loading-door origin', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72 };
  const layout = PackLibrary.getStagingLayout(truck);
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.equal(layout.originX, model.rear.value,
    'canonical staging origin must align with the rear/loading-door end of the direction model');
});

test('G1-DIRECTION frontBonus overhang zone extends beyond the front/high-X side', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const model = PackLibrary.getTruckDirectionModel(truck);
  const mainZone = zones.find(z => z.min.x === 0);
  const overhangZone = zones.find(z => z.min.x === truck.length);

  assert.ok(mainZone, 'frontBonus geometry must include a main zone starting at the rear (x=0)');
  assert.equal(mainZone.max.x, model.front.value,
    'frontBonus main zone must span the full main box up to the front/cab side');
  assert.ok(overhangZone, 'frontBonus geometry must include an overhang zone starting at the front (x=truck.length)');
  assert.equal(overhangZone.min.x, model.front.value,
    'frontBonus overhang zone must start at the front/cab side of the direction model');
  assert.equal(overhangZone.max.x, truck.length + truck.shapeConfig.bonusLength,
    'frontBonus overhang zone must extend beyond truck.length by bonusLength');
});

test('G1-DIRECTION wheel well offset remains measured from the rear/low-X side', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const model = PackLibrary.getTruckDirectionModel(truck);
  const rearZone = zones.find(z => z.min.x === 0);

  assert.ok(rearZone, 'wheelWells geometry must include a zone starting at the rear (x=0)');
  assert.equal(rearZone.min.x, model.rear.value,
    'wheel-well rear zone must start at the rear/loading-door origin');
  assert.equal(rearZone.max.x, truck.shapeConfig.wellOffsetFromRear,
    'wellOffsetFromRear must be measured starting from the rear (x=0), not the front');
});

test('G2-SHAPE-CONTRACT rect shape produces a single full-box usable zone', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72, shapeMode: 'rect' };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  assert.equal(zones.length, 1, 'rect must produce exactly one usable zone');
  assert.deepEqual(zones[0], {
    min: { x: 0, y: 0, z: -truck.width / 2 },
    max: { x: truck.length, y: truck.height, z: truck.width / 2 },
  }, 'rect zone must span the full 0..length x 0..height x -width/2..width/2 box');
});

test('G2-SHAPE-CONTRACT wheelWells produces multiple usable zones and excludes the wheel-well floor region', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 35, wellWidth: 15, wellLength: 35, wellOffsetFromRear: 25 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  assert.ok(zones.length > 1, 'wheelWells must produce multiple usable zones');

  const blockedAabb = {
    min: { x: 30, y: 0, z: -48 },
    max: { x: 40, y: 10, z: -40 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(blockedAabb, zones), false,
    'a box inside a wheel-well blocked floor region must not be contained in any usable zone');
});

test('G2-SHAPE-CONTRACT a box visually inside the outer trailer box but inside a wheel-well region is classified outside usable zones', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 35, wellWidth: 15, wellLength: 35, wellOffsetFromRear: 25 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  const outerBox = {
    min: { x: 0, y: 0, z: -truck.width / 2 },
    max: { x: truck.length, y: truck.height, z: truck.width / 2 },
  };
  const wheelWellAabb = {
    min: { x: 30, y: 0, z: -48 },
    max: { x: 40, y: 10, z: -40 },
  };

  const insideOuterBox =
    wheelWellAabb.min.x >= outerBox.min.x && wheelWellAabb.max.x <= outerBox.max.x &&
    wheelWellAabb.min.y >= outerBox.min.y && wheelWellAabb.max.y <= outerBox.max.y &&
    wheelWellAabb.min.z >= outerBox.min.z && wheelWellAabb.max.z <= outerBox.max.z;

  assert.equal(insideOuterBox, true,
    'sanity check: the wheel-well box must be inside the outer trailer box bounds');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(wheelWellAabb, zones), false,
    'the same box must be classified outside the shape-aware usable zones');
});

test('G2-SHAPE-CONTRACT wheel-well blocked bodies reject overlap but allow flush top contact', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 35, wellWidth: 15, wellLength: 35, wellOffsetFromRear: 25 },
  };

  const blockedZones = PackLibrary.getWheelWellsBlockedZones(truck);
  assert.equal(blockedZones.length, 2, 'wheelWells exposes the two fixed side blocked bodies');
  assert.deepEqual(blockedZones[0], {
    min: { x: 25, y: 0, z: -50 },
    max: { x: 60, y: 35, z: -35 },
  }, 'left blocked body must come from shapeConfig dimensions');
  assert.equal(PackLibrary.getWheelWellsBlockedZones({ ...truck, shapeMode: 'rect' }).length, 0,
    'Standard trucks must not gain wheel-well blocked bodies');

  const penetratesBody = {
    min: { x: 30, y: 0, z: -48 },
    max: { x: 40, y: 10, z: -40 },
  };
  const flushOnTop = {
    min: { x: 30, y: 35, z: -48 },
    max: { x: 40, y: 45, z: -40 },
  };
  const slightSink = {
    min: { x: 30, y: 34.5, z: -48 },
    max: { x: 40, y: 44.5, z: -40 },
  };

  assert.equal(PackLibrary.aabbIntersectsWheelWellBlockedBody(penetratesBody, truck), true,
    'any body penetration must be rejected');
  assert.equal(PackLibrary.aabbIntersectsWheelWellBlockedBody(flushOnTop, truck), false,
    'flush top contact is allowed because it does not overlap the body volume');
  assert.equal(PackLibrary.aabbIntersectsWheelWellBlockedBody(slightSink, truck), true,
    'sinking even slightly below the fixed top plane must be rejected');
});

test('WHEELWELL-SUPPORT geometry models blocked body, tops, and inner sides from active shapeConfig (not hardcoded)', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const geo = Solver.getWheelWellGeometry(WW_SUPPORT_TRUCK);
  assert.ok(geo, 'a wheelWells truck yields physical wheel-well geometry');
  assert.equal(geo.wx0, 60, 'well start computed from wellOffsetFromRear');
  assert.equal(geo.wx1, 120, 'well end computed from offset + wellLength');
  assert.equal(geo.wellHeight, 18, 'well height comes from active shapeConfig');
  assert.equal(geo.betweenHalfW, 36, 'channel half-width = width/2 - wellWidth');
  assert.equal(geo.blocked.length, 2, 'two blocked well bodies');
  assert.equal(geo.tops.length, 2, 'two well-top support rectangles');
  assert.equal(geo.tops[0].min.y, 18, 'top slab sits at the well height');
  // Different geometry => different surfaces (proves dynamic, not hardcoded).
  const taller = Solver.getWheelWellGeometry({
    ...WW_SUPPORT_TRUCK, shapeConfig: { wellHeight: 24, wellWidth: 12, wellLength: 60, wellOffsetFromRear: 60 },
  });
  assert.equal(taller.wellHeight, 24, 'geometry tracks the active truck config');
  // Non-wheelWells trucks never produce geometry — every other mode is untouched.
  assert.equal(Solver.getWheelWellGeometry({ length: 240, width: 96, height: 96, shapeMode: 'rect' }), null);
  assert.equal(Solver.getWheelWellGeometry({ length: 240, width: 96, height: 96, shapeMode: 'frontBonus' }), null);
});

test('WHEELWELL-SUPPORT rejects placements intersecting the blocked body using the full AABB, not a centre-only test', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const geo = Solver.getWheelWellGeometry(WW_SUPPORT_TRUCK);
  // Box bottom sitting inside the blocked well volume.
  const insideBody = wwAabb(80, 0, -46, 100, 10, -38);
  assert.equal(Solver.aabbIntersectsWheelWellBody(insideBody, geo), true, 'box bottom inside the blocked volume is detected');
  assert.equal(Solver.isAabbWithinTruckMinusBlocked(insideBody, geo), false, 'and is therefore not within truck-minus-blocked');
  // Centre-only false positive: centre at z=-28 is OUTSIDE the blocked z-range,
  // but the footprint still overlaps the body — must be rejected on the AABB.
  const centreClears = wwAabb(80, 0, -40, 100, 10, -16);
  assert.ok(-28 > -36, 'sanity: the box centre is outside the blocked z-range');
  assert.equal(Solver.aabbIntersectsWheelWellBody(centreClears, geo), true,
    'a box whose centre clears the well but whose footprint overlaps the body is rejected');
  // A clean channel box that stops short of the inner face never intersects.
  const clean = wwAabb(60, 0, -34, 120, 18, -12);
  assert.equal(Solver.aabbIntersectsWheelWellBody(clean, geo), false, 'a box that stops at the channel does not intersect');
  assert.equal(Solver.isAabbWithinTruckMinusBlocked(clean, geo), true, 'and is contained in the usable space');
});

test('WHEELWELL-SUPPORT direct top support: a small box fully fits the well top; a wider box is not treated as fully supported', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const geo = Solver.getWheelWellGeometry(WW_SUPPORT_TRUCK);
  // Small box whose whole footprint lands on the left well top (z[-48,-36]).
  const small = wwAabb(80, 18, -47, 100, 28, -37);
  const sSupport = Solver.computeWheelWellSupport(small, [], geo, { weight: 10 });
  assert.ok(Math.abs(sSupport.fraction - 1) < 1e-6, 'small box is fully supported by the well top');
  assert.equal(Solver.isWheelWellSupportedAndStable(small, [], geo, { weight: 10 }), true, 'small box may rest directly on the top');
  assert.equal(Solver.isAabbWithinTruckMinusBlocked(small, geo), true, 'resting flush on the top does not enter the body');
  // Wider box: 24 wide over a 12-wide top, half hanging over the open channel.
  const wide = wwAabb(80, 18, -48, 100, 28, -24);
  const wSupport = Solver.computeWheelWellSupport(wide, [], geo, { weight: 10 });
  assert.ok(wSupport.fraction < 1, 'wider box is NOT treated as fully supported by the top');
  assert.ok(Math.abs(wSupport.fraction - 0.5) < 1e-6, 'only the well-top half of the footprint bears');
  assert.equal(Solver.isWheelWellSupportedAndStable(wide, [], geo, { weight: 10 }), false,
    'support fraction meets MIN_SUPPORT_FRACTION yet the half-channel cantilever fails the overhang/tip rule');
});

test('WHEELWELL-SUPPORT combined support: a wider box is accepted when well top + adjacent cargo is stable, rejected without it', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const geo = Solver.getWheelWellGeometry(WW_SUPPORT_TRUCK);
  // Adjacent cargo in the channel whose top is flush with the well top (y=18).
  const support = { aabb: wwAabb(60, 0, -36, 120, 18, -12), item: { weight: 200 } };
  const candidate = wwAabb(80, 18, -48, 100, 28, -24); // spans top z[-48,-36] + cargo top z[-36,-12]
  const combined = Solver.computeWheelWellSupport(candidate, [support], geo, { weight: 30 });
  assert.ok(Math.abs(combined.fraction - 1) < 1e-6, 'well top + adjacent cargo fully supports the footprint');
  assert.equal(Solver.isWheelWellSupportedAndStable(candidate, [support], geo, { weight: 30 }), true,
    'a wider box may bridge the well top onto adjacent supported cargo');
  assert.equal(Solver.isWheelWellSupportedAndStable(candidate, [], geo, { weight: 30 }), false,
    'the same box is rejected when the adjacent support is missing (it would float over the channel)');
});

test('WHEELWELL-SUPPORT lateral side contact is detected without collision and never substitutes for vertical support', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const geo = Solver.getWheelWellGeometry(WW_SUPPORT_TRUCK);
  // Box flush against the left inner side face (z=-36) without entering the body.
  const flush = wwAabb(60, 0, -36, 120, 18, -12);
  assert.ok(Solver.countWheelWellSideContacts(flush, geo) >= 1, 'flush lateral contact is detected');
  assert.equal(Solver.aabbIntersectsWheelWellBody(flush, geo), false, 'lateral contact does not penetrate the body');
  // A box that crosses the inner face into the body is a collision.
  const penetrate = wwAabb(60, 0, -40, 120, 18, -16);
  assert.equal(Solver.aabbIntersectsWheelWellBody(penetrate, geo), true, 'crossing the inner face into the body is rejected');
  // Lateral contact ALONE (no support beneath) is never enough vertical support.
  const floatingBeside = wwAabb(60, 6, -36, 120, 18, -12); // hovering in the channel, nothing under it
  assert.ok(Solver.countWheelWellSideContacts(floatingBeside, geo) >= 1, 'still touches the side face laterally');
  assert.equal(Solver.isWheelWellSupportedAndStable(floatingBeside, [], geo, { weight: 10 }), false,
    'a box with side contact but no vertical support would fall and is rejected');
});

test('WHEELWELL-SUPPORT bridge pass is opt-in: default OFF stays deterministic, ON only adds body-safe, non-overlapping, in-bounds placements', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const zones = PackLib.getTrailerUsableZones(WW_SUPPORT_TRUCK);
  const itemSpec = { caseId: 'A', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'any', canFlip: false, weight: 30 };
  const items = Array.from({ length: 300 }, (_, i) => ({ ...itemSpec, instanceId: `i${i}` }));

  const off = Solver.solveAutoPack({ truck: WW_SUPPORT_TRUCK, zones, loadFrontFirst: true, items });
  const offAgain = Solver.solveAutoPack({ truck: WW_SUPPORT_TRUCK, zones, loadFrontFirst: true, items });
  assert.equal(JSON.stringify([...off.placements]), JSON.stringify([...offAgain.placements]),
    'default output (bridge OFF) is deterministic');

  const on = Solver.solveAutoPack({ truck: WW_SUPPORT_TRUCK, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
  assert.ok(on.placements.size >= off.placements.size, 'the bridge pass is additive — it never drops placements');

  const geo = Solver.getWheelWellGeometry(WW_SUPPORT_TRUCK);
  const aabbs = [];
  for (const [id, pos] of on.placements) {
    const od = on.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
    assert.equal(Solver.aabbIntersectsWheelWellBody(aabb, geo), false, `${id} never sinks into the wheel-well body`);
    assert.equal(Solver.isAabbWithinTruckMinusBlocked(aabb, geo), true, `${id} stays inside truck-minus-blocked`);
    aabbs.push(aabb);
  }
  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      assert.equal(Solver.aabbsOverlap(aabbs[i], aabbs[j]), false, 'bridge-enabled placements never overlap');
    }
  }
});

test('WHEELWELL-SUPPORT planWheelWellRiser selects a plane-tiling orientation and returns null when none tiles (never fakes support)', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const geo = Solver.getWheelWellGeometry(WW_SUPPORT_TRUCK); // wellHeight 18
  const mk = (l, w, h) => ({ l, w, h, rotation: { yaw: 0 } });
  // One candidate orientation stands 18 tall -> exactly tiles the 18 well height (k=1).
  const tiling = new Map([['a', { id: 'a', candidates: [mk(24, 16, 18), mk(24, 18, 16)] }]]);
  const riser = Solver.planWheelWellRiser(['a'], tiling, geo);
  assert.ok(riser, 'an orientation whose height tiles the fixed well height is selected');
  assert.ok(Math.abs(riser.k * riser.h - geo.wellHeight) < 0.05, 'the chosen riser reaches the well plane exactly');
  // Heights 16 and 20 cannot tile 18 -> build-up is impossible, so we must NOT pick one.
  const noTile = new Map([['b', { id: 'b', candidates: [mk(24, 18, 16), mk(24, 16, 20)] }]]);
  assert.equal(Solver.planWheelWellRiser(['b'], noTile, geo), null,
    'returns null when no orientation can build to the plane — bridging is not forced and support is not faked');
});

test('WHEELWELL-SUPPORT buildChannelRisersToPlane builds coplanar multi-layer channel support up to the fixed well plane', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240, width: 96, height: 96, shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 32, wellWidth: 18, wellLength: 60, wellOffsetFromRear: 60 },
  };
  const geo = Solver.getWheelWellGeometry(truck);
  const mk = (l, w, h) => ({ l, w, h, rotation: { yaw: 0 } });
  const ids = [];
  const itemsById = new Map();
  for (let i = 0; i < 40; i++) { const id = `r${i}`; ids.push(id); itemsById.set(id, { id, candidates: [mk(20, 20, 16)] }); }
  const output = { placements: new Map(), rotations: new Map(), orientedDims: new Map(), unpacked: [...ids] };
  const packed = [];
  const riser = Solver.planWheelWellRiser(ids, itemsById, geo);
  assert.deepEqual({ l: riser.l, w: riser.w, h: riser.h, k: riser.k }, { l: 20, w: 20, h: 16, k: 2 },
    'two layers of the 16-tall riser reach the fixed 32 well plane');
  const built = Solver.buildChannelRisersToPlane(output, packed, itemsById, geo, riser);
  assert.ok(built > 0 && built % riser.k === 0, 'only whole columns (no partial stack short of the plane) are committed');
  assert.equal(output.unpacked.length, ids.length - built, 'consumed items leave the unpacked pool');
  let topsAtPlane = 0;
  for (const p of packed) {
    assert.equal(Solver.aabbIntersectsWheelWellBody(p.aabb, geo), false, 'a riser never enters a well body');
    assert.equal(Solver.isAabbWithinTruckMinusBlocked(p.aabb, geo), true, 'a riser stays inside the usable space');
    if (Math.abs(p.aabb.max.y - geo.wellHeight) < 0.01) topsAtPlane++;
  }
  assert.equal(topsAtPlane, built / riser.k, 'exactly one coplanar top surface per built column, flush with the well plane');
  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i].aabb, packed[j].aabb), false, 'risers never overlap');
    }
  }
});

test('WHEELWELL-SUPPORT generic shelf candidates enforce real support and overhang limits', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 636,
    width: 102,
    height: 98,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 34.3, wellWidth: 15.3, wellLength: 222.6, wellOffsetFromRear: 159 },
  };
  const geo = Solver.getWheelWellGeometry(truck);
  const leftShelf = (l, w, h) => Solver.getAabb({
    x: geo.wx1 - l / 2,
    y: geo.wellHeight + h / 2,
    z: -truck.width / 2 + w / 2,
  }, { l, w, h });
  const centerBridge = (l, w, h) => Solver.getAabb({
    x: geo.wx1 - l / 2,
    y: geo.wellHeight + h / 2,
    z: 0,
  }, { l, w, h });

  const cases = [
    { label: '24x18x16', dims: { l: 24, w: 18, h: 16 }, stable: true },
    { label: '30x20x10', dims: { l: 30, w: 20, h: 10 }, stable: true },
    { label: 'narrow-channel-carton', dims: { l: 20, w: 10, h: 10 }, stable: true },
    { label: '48x24x24-too-wide-for-shelf-alone', dims: { l: 48, w: 24, h: 24 }, stable: false },
  ];

  for (const fixture of cases) {
    const aabb = leftShelf(fixture.dims.l, fixture.dims.w, fixture.dims.h);
    assert.equal(Solver.isAabbWithinTruckMinusBlocked(aabb, geo), true, `${fixture.label}: shelf candidate is body-safe`);
    assert.equal(
      Solver.isWheelWellSupportedAndStable(aabb, [], geo, { weight: 30 }),
      fixture.stable,
      `${fixture.label}: direct shelf support follows real support/overhang rules`
    );
  }

  const unsupportedCenter = centerBridge(24, 18, 16);
  const centerSupport = Solver.computeWheelWellSupport(unsupportedCenter, [], geo, { weight: 30 });
  assert.equal(Solver.isAabbWithinTruckMinusBlocked(unsupportedCenter, geo), true,
    'a center-channel bridge pose can be body-safe but still unsupported');
  assert.equal(centerSupport.fraction, 0, 'the center bridge has no vertical support without coplanar cargo');
  assert.equal(Solver.isWheelWellSupportedAndStable(unsupportedCenter, [], geo, { weight: 30 }), false,
    'the solver must not fake a full-width raised floor over the wheel-well channel');
});

test('WHEELWELL-SUPPORT build-up+bridge adds safe deterministic placements within Case-permitted Max search', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240, width: 96, height: 96, shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 16, wellWidth: 12, wellLength: 60, wellOffsetFromRear: 60 },
  };
  const zones = PackLib.getTrailerUsableZones(truck);
  const spec = { caseId: 'A', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'any', weight: 30 };
  const items = Array.from({ length: 300 }, (_, i) => ({ ...spec, instanceId: `i${i}` }));

  // This positive-control fixture needs side-face search, now supplied by Max
  // inside Case permission instead of the retired canFlip preference.
  const off = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, maxCapacityMode: true, enableWheelWellFloorChannelCompaction: false });
  const on = Solver.solveAutoPack({
    truck, zones, loadFrontFirst: true, items, maxCapacityMode: true, enableWheelWellBridge: true, enableWheelWellFloorChannelCompaction: false,
  });
  const onAgain = Solver.solveAutoPack({
    truck, zones, loadFrontFirst: true, items, maxCapacityMode: true, enableWheelWellBridge: true, enableWheelWellFloorChannelCompaction: false,
  });
  assert.ok(on.placements.size > off.placements.size, 'the two-step strategy packs strictly more when the geometry permits safe well-top use');
  assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...onAgain.placements]), 'ON output is deterministic');

  const geo = Solver.getWheelWellGeometry(truck);
  const aabbs = [];
  for (const [id, pos] of on.placements) {
    const od = on.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
    assert.equal(Solver.aabbIntersectsWheelWellBody(aabb, geo), false, `${id} never sinks into a well body`);
    assert.equal(Solver.isAabbWithinTruckMinusBlocked(aabb, geo), true, `${id} stays inside the usable space`);
    aabbs.push(aabb);
  }
  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      assert.equal(Solver.aabbsOverlap(aabbs[i], aabbs[j]), false, 'no two placements overlap');
    }
  }
});

test('WHEELWELL-BRIDGE exact 24x18 fixture keeps lower front stacks before well-top shelf use', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 636,
    width: 102,
    height: 98,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 34.3, wellWidth: 15.3, wellLength: 222.6, wellOffsetFromRear: 159 },
  };
  const zones = PackLib.getTrailerUsableZones(truck);
  const makeItems = count => Array.from({ length: count }, (_, i) => ({
    instanceId: `i${i}`,
    caseId: 'c',
    dims: { l: 24, w: 18, h: 16 },
    shape: 'box',
    weight: 30,
    orientationLock: 'any',
    canFlip: false,
    maxStackCount: 2,
  }));

  const items = makeItems(240);
  const on = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
  const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
  const standardTruck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };
  const frontTruck = phcFrontOverhangTruck();
  const geo = Solver.getWheelWellGeometry(truck);
  const placed = result => [...result.placements].map(([id, pos]) => {
    const od = result.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
    return { id, pos, od, aabb, minY: aabb.min.y };
  });
  const metrics = result => {
    const p = placed(result);
    return {
      placements: p,
      floor: p.filter(item => item.minY <= 0.2),
      wellTop: p.filter(item => Math.abs(item.minY - geo.wellHeight) < 0.2),
      lowerStack: p.filter(item => item.minY > 0.2 && item.minY < geo.wellHeight - 0.2),
      bodyHits: p.filter(item => Solver.aabbIntersectsWheelWellBody(item.aabb, geo)),
    };
  };

  const onMetrics = metrics(on);
  assert.equal(on.placements.size, items.length, 'exact screenshot fixture still packs every case');
  assert.ok(onMetrics.floor.length > 0, 'floor placements remain the first layer');
  assert.ok(onMetrics.lowerStack.length > 0, 'valid lower raised/front stack opportunities are used');
  assert.equal(onMetrics.wellTop.length, 0,
    'well-top shelf placements must not outrank lower valid stack levels in the exact 24x18 fixture');
  assert.ok(Math.max(...onMetrics.lowerStack.map(item => item.aabb.max.x)) >= truck.length - 0.1,
    'lower raised stack placements are front-compressed to the high-X wall before wheel-well top use');
  assert.equal(onMetrics.bodyHits.length, 0, 'no active bridge/build-up placement enters a wheel-well body');

  const legalShelf = Solver.getAabb(
    { x: geo.wx1 - 12, y: geo.wellHeight + 8, z: -truck.width / 2 + 9 },
    { l: 24, w: 18, h: 16 }
  );
  const centerBridge = Solver.getAabb(
    { x: geo.wx1 - 12, y: geo.wellHeight + 8, z: 0 },
    { l: 24, w: 18, h: 16 }
  );
  assert.equal(Solver.isWheelWellSupportedAndStable(legalShelf, [], geo, { weight: 30 }), true,
    'a side shelf 24x18 top placement is physically legal');
  assert.equal(Solver.isWheelWellSupportedAndStable(centerBridge, onMetrics.placements, geo, { weight: 30 }), false,
    'the apparent center bridge gap is not fillable without coplanar support at the fixed well-top plane');

  for (const { label, modeTruck } of [
    { label: 'Standard', modeTruck: standardTruck },
    { label: 'Front Overhang', modeTruck: frontTruck },
  ]) {
    const modeZones = PackLib.getTrailerUsableZones(modeTruck);
    const modeItems = makeItems(80);
    const bridgeOn = Solver.solveAutoPack({ truck: modeTruck, zones: modeZones, loadFrontFirst: true, items: modeItems, enableWheelWellBridge: true });
    const bridgeOff = Solver.solveAutoPack({ truck: modeTruck, zones: modeZones, loadFrontFirst: true, items: modeItems, enableWheelWellBridge: false });
    assert.equal(phcResultBytes(bridgeOn), phcResultBytes(bridgeOff), `${label}: wheel-well bridge order is a no-op outside Wheel Wells`);
  }

  for (let i = 0; i < onMetrics.placements.length; i++) {
    for (let j = i + 1; j < onMetrics.placements.length; j++) {
      assert.equal(Solver.aabbsOverlap(onMetrics.placements[i].aabb, onMetrics.placements[j].aabb), false,
        `no overlap ${onMetrics.placements[i].id}/${onMetrics.placements[j].id}`);
    }
  }
  assert.equal(JSON.stringify([...on.placements]), JSON.stringify([...repeat.placements]),
    'active Wheel Wells bridge/build-up output is deterministic');
  wwAssertHardSafe(Solver, on, truck, zones, items, 'exact 24x18 wheel-well lower-first load');
});

test('WHEELWELL-FRONT-COMPRESSION preserves lower-first raised placements without weakening safety', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = Array.from({ length: 120 }, (_, i) => ({
    instanceId: `i${i}`,
    caseId: 'A',
    dims: { l: 24, w: 18, h: 16 },
    shape: 'box',
    orientationLock: 'any',
    canFlip: false,
    weight: 30,
    maxStackCount: 2,
  }));

  const uncompressed = Solver.solveAutoPack({
    truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true, enableWheelWellFrontCompression: false,
  });
  const compressed = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
  const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });

  assert.equal(compressed.placements.size, uncompressed.placements.size, 'front compression preserves packed count');
  assert.deepEqual([...compressed.orientedDims], [...uncompressed.orientedDims], 'front compression preserves oriented dimensions');
  assert.deepEqual([...compressed.rotations], [...uncompressed.rotations], 'front compression preserves rotations');
  assert.ok(wwNonFloorFrontSlack(Solver, compressed, truck, zones, items) <= wwNonFloorFrontSlack(Solver, uncompressed, truck, zones, items),
    'front compression must not add raised/non-floor front slack');
  assert.equal(JSON.stringify([...compressed.placements]), JSON.stringify([...repeat.placements]), 'compressed output is deterministic');
  wwAssertHardSafe(Solver, compressed, truck, zones, items, 'front-compressed wheel wells');
});

test('WHEELWELL-FRONT-COMPRESSION is Wheel-Wells-only: Standard and Front Overhang outputs are unchanged', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const fixtures = [
    { label: 'Standard', truck: { length: 240, width: 96, height: 96, shapeMode: 'rect' } },
    { label: 'Front Overhang', truck: phcFrontOverhangTruck() },
  ];
  for (const { label, truck } of fixtures) {
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = Array.from({ length: 100 }, (_, i) => ({
      instanceId: `i${i}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
      shape: 'box', orientationLock: 'any', canFlip: false, weight: 30, maxStackCount: 2,
    }));
    const enabled = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const disabled = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellFrontCompression: false });
    assert.equal(phcResultBytes(enabled), phcResultBytes(disabled), `${label}: front compression is a no-op outside Wheel Wells`);
  }
});

test('WHEELWELL-FRONT-COMPRESSION identical 24x18 loads keep front-row order with no avoidable forward row gaps', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const itemSpec = {
    caseId: 'A', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'any', canFlip: false, weight: 30, maxStackCount: 2,
  };
  for (const count of [6, 20, 40, 100]) {
    const items = Array.from({ length: count }, (_, i) => ({ ...itemSpec, instanceId: `i${i}` }));
    const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
    assert.equal(result.placements.size, count, `WW/${count}: every case packs`);
    assert.equal(phb2SequentialForwardViolation(Solver, result, zones, new Map(items.map(item => [item.instanceId, item]))), null,
      `WW/${count}: no same-layer case is left behind while a more-forward legal cell is open`);
    wwAssertHardSafe(Solver, result, truck, zones, items, `WW/${count}`);
  }
});

test('WHEELWELL-FRONT-COMPRESSION mixed load keeps constrained channel access for smaller cartons despite low-priority large bases', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const geo = Solver.getWheelWellGeometry(truck);
  const largeBases = Array.from({ length: 8 }, (_, i) => ({
    instanceId: `L${i}`, caseId: 'large-base', dims: { l: 48, w: 80, h: 16 },
    shape: 'box', orientationLocked: true, lockedRotation: { x: 0, y: 0, z: 0 },
    canFlip: false, weight: 180, loadPriority: -1, maxStackCount: 1,
  }));
  const smallCartons = Array.from({ length: 40 }, (_, i) => ({
    instanceId: `S${i}`, caseId: 'small-carton', dims: { l: 24, w: 18, h: 16 },
    shape: 'box', orientationLock: 'any', canFlip: false, weight: 30, loadPriority: 1, maxStackCount: 2,
  }));
  const items = [...largeBases, ...smallCartons];
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
  const placed = wwResultPlacements(Solver, result, items);
  const isChannel = p =>
    p.aabb.min.x >= geo.wx0 - 0.05 && p.aabb.max.x <= geo.wx1 + 0.05 &&
    p.aabb.min.z >= -geo.betweenHalfW - 0.05 && p.aabb.max.z <= geo.betweenHalfW + 0.05;
  const smallInChannel = placed.filter(p => p.id.startsWith('S') && isChannel(p));
  const largeInChannel = placed.filter(p => p.id.startsWith('L') && isChannel(p));

  assert.equal(smallCartons.every(item => result.placements.has(item.instanceId)), true,
    'every smaller carton remains packable in the mixed Wheel Wells load');
  assert.ok(smallInChannel.length > 0, 'smaller cartons consume the constrained wheel-well channel openings');
  assert.equal(largeInChannel.length, 0, 'oversized low-priority base cases do not occupy the constrained channel');
  wwAssertHardSafe(Solver, result, truck, zones, items, 'mixed wheel-well load');
});

test('WHEELWELL-FLOOR-CHANNEL-COMPACTION tightens 48x24 floor rows without reducing count or weakening safety', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const itemSpec = {
    caseId: 'A', dims: { l: 48, w: 24, h: 24 }, orientationLock: 'any', canFlip: false, weight: 10, maxStackCount: 3,
  };
  const items = Array.from({ length: 100 }, (_, i) => ({ ...itemSpec, instanceId: `i${i}` }));
  const disabled = Solver.solveAutoPack({
    truck,
    zones,
    loadFrontFirst: true,
    items,
    enableWheelWellBridge: true,
    enableWheelWellFloorChannelCompaction: false,
  });
  const enabled = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });

  assert.equal(enabled.placements.size, disabled.placements.size, 'floor/channel compaction preserves packed count');
  assert.ok(wwFloorSideSlack(Solver, enabled, zones, items) < wwFloorSideSlack(Solver, disabled, zones, items),
    'floor/channel compaction moves rows toward side/wall contact instead of leaving avoidable side gaps');
  assert.ok(wwFloorForwardSlack(Solver, enabled, zones, items) <= wwFloorForwardSlack(Solver, disabled, zones, items),
    'floor/channel compaction must not create additional forward floor slack');
  assert.equal(wwAvoidableForwardFloorMove(Solver, enabled, zones, items), null,
    'no same-size floor case behind can legally occupy a more-forward empty floor/channel position');
  wwAssertHardSafe(Solver, enabled, truck, zones, items, 'floor/channel-compacted wheel wells');
});

test('WHEELWELL-FLOOR-CHANNEL-COMPACTION is Wheel-Wells-only: Standard and Front Overhang outputs are unchanged', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const fixtures = [
    { label: 'Standard', truck: { length: 636, width: 102, height: 98, shapeMode: 'rect' } },
    { label: 'Front Overhang', truck: phcFrontOverhangTruck() },
  ];
  for (const { label, truck } of fixtures) {
    const zones = PackLib.getTrailerUsableZones(truck);
    const items = Array.from({ length: 80 }, (_, i) => ({
      instanceId: `i${i}`,
      caseId: 'A',
      dims: { l: 48, w: 24, h: 24 },
      shape: 'box',
      orientationLock: 'any',
      canFlip: false,
      weight: 10,
      maxStackCount: 3,
    }));
    const enabled = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const disabled = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellFloorChannelCompaction: false });
    assert.equal(phcResultBytes(enabled), phcResultBytes(disabled), `${label}: wheel-well floor/channel compaction is a no-op`);
  }
});

test('WHEELWELL-FLOOR-CHANNEL-COMPACTION repeated floor loads leave no avoidable forward floor/channel holes', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const specs = [
    { caseId: 'A', dims: { l: 48, w: 24, h: 24 }, orientationLock: 'any', canFlip: false, weight: 10, maxStackCount: 3 },
    { caseId: 'B', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'any', canFlip: false, weight: 30, maxStackCount: 2 },
  ];

  for (const itemSpec of specs) {
    for (const count of [6, 20, 40, 100]) {
      const items = Array.from({ length: count }, (_, i) => ({ ...itemSpec, instanceId: `${itemSpec.caseId}${i}` }));
      const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
      assert.equal(result.placements.size, count, `${itemSpec.caseId}/${count}: every case packs`);
      assert.equal(wwAvoidableForwardFloorMove(Solver, result, zones, items), null,
        `${itemSpec.caseId}/${count}: no same-size case behind can legally move into a more-forward floor/channel hole`);
      wwAssertHardSafe(Solver, result, truck, zones, items, `${itemSpec.caseId}/${count}`);
    }
  }
});

test('WHEELWELL-FLOOR-CHANNEL-COMPACTION mixed loads keep smaller cartons in legal channel openings', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98, shapeMode: 'wheelWells' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const geo = Solver.getWheelWellGeometry(truck);
  const largeBases = Array.from({ length: 20 }, (_, i) => ({
    instanceId: `L${i}`, caseId: 'large-base', dims: { l: 48, w: 24, h: 24 },
    shape: 'box', orientationLock: 'any', canFlip: false, weight: 180, loadPriority: -1, maxStackCount: 1,
  }));
  const smallCartons = Array.from({ length: 80 }, (_, i) => ({
    instanceId: `S${i}`, caseId: 'small-carton', dims: { l: 24, w: 18, h: 16 },
    shape: 'box', orientationLock: 'any', canFlip: false, weight: 30, loadPriority: 1, maxStackCount: 2,
  }));
  const items = [...largeBases, ...smallCartons];
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
  const placed = wwResultPlacements(Solver, result, items);
  const isChannel = p =>
    p.aabb.min.x >= geo.wx0 - 0.05 && p.aabb.max.x <= geo.wx1 + 0.05 &&
    p.aabb.min.z >= -geo.betweenHalfW - 0.05 && p.aabb.max.z <= geo.betweenHalfW + 0.05;

  assert.equal(result.placements.size, items.length, 'mixed Wheel Wells load keeps every test carton packable');
  assert.ok(placed.some(p => p.id.startsWith('S') && isChannel(p)),
    'smaller cartons still consume legal channel openings');
  assert.equal(wwAvoidableForwardFloorMove(Solver, result, zones, items), null,
    'mixed load leaves no legal same-orientation forward floor/channel move');
  wwAssertHardSafe(Solver, result, truck, zones, items, 'mixed floor/channel-compacted wheel wells');
});

test('WHEELWELL-RAISED-OVERHANG staged cartons are recovered onto safe overhang poses above the wells instead of staging beside empty space', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 636, width: 102, height: 98, shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 34.29, wellWidth: 15.31, wellLength: 222.6, wellOffsetFromRear: 159.02 },
  };
  const zones = PackLib.getTrailerUsableZones(truck);
  const geo = Solver.getWheelWellGeometry(truck);
  // Mixed real-world load: big floor cases too light to carry the cartons
  // (child-vs-support weight rule), narrow heavy stack-bases that pair up on the
  // well tops, cartons wider than a merged base row (overhang poses required),
  // and tall no-stack appliances that legitimately cannot fit anywhere raised.
  const items = [
    ...Array.from({ length: 30 }, (_, i) => ({
      instanceId: `big${i}`, caseId: 'big', dims: { l: 48, w: 34, h: 24 },
      shape: 'box', orientationLock: 'any', canFlip: false, weight: 20, maxStackCount: 3,
    })),
    ...Array.from({ length: 90 }, (_, i) => ({
      instanceId: `carton${i}`, caseId: 'carton', dims: { l: 24, w: 18, h: 16 },
      shape: 'box', orientationLock: 'any', canFlip: false, weight: 35, maxStackCount: 3,
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      instanceId: `base${i}`, caseId: 'base', dims: { l: 48, w: 6.5, h: 14 },
      shape: 'box', orientationLock: 'any', canFlip: false, weight: 180, maxStackCount: 0,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      instanceId: `tall${i}`, caseId: 'tall', dims: { l: 30, w: 28, h: 70 },
      shape: 'box', orientationLock: 'upright', canFlip: false, weight: 185, maxStackCount: 1, noStackOnTop: true,
    })),
  ];
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
  const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });

  assert.equal(items.filter(item => item.caseId === 'carton' && !result.placements.has(item.instanceId)).length, 0,
    'every carton is recovered instead of staging while raised space above the wells stays empty');
  assert.ok(wwResultPlacements(Solver, result, items).some(p =>
    p.aabb.min.y > geo.wellHeight + 0.05 &&
    p.aabb.min.x >= geo.wx0 - 0.05 && p.aabb.max.x <= geo.wx1 + 0.05),
    'recovered cargo actually occupies raised space over the wheel-well region');
  assert.equal(wwStagedRaisedOverhangOpportunity(Solver, result, truck, zones, items), null,
    'no staged item still fits a legal overhang pose on a raised support layer');
  assert.equal(JSON.stringify([...result.placements]), JSON.stringify([...repeat.placements]),
    'raised-overhang recovery output is deterministic');
  wwAssertHardSafe(Solver, result, truck, zones, items, 'raised-overhang recovered wheel wells');
});

test('WHEELWELL-CHANNEL-LANE-ALIGNMENT floor/channel compaction keeps channel rows column-aligned (no lateral zigzag)', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 636, width: 102, height: 98, shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 34.3, wellWidth: 15.3, wellLength: 222.6, wellOffsetFromRear: 159 },
  };
  const zones = PackLib.getTrailerUsableZones(truck);
  const geo = Solver.getWheelWellGeometry(truck);

  // Distinct lateral (z) lanes used by channel floor cargo. A clean load keeps a
  // small canonical set of lanes; the zigzag defect (compaction pulling rows to
  // opposite channel walls) shows up as extra offset lanes.
  const channelFloorLanes = (result, items) => {
    const lanes = new Set();
    for (const p of wwResultPlacements(Solver, result, items)) {
      if (p.aabb.min.y > 0.06) continue;
      if (p.aabb.min.x < geo.wx0 - 0.06 || p.aabb.max.x > geo.wx1 + 0.06) continue;
      if (p.aabb.min.z < -geo.betweenHalfW - 0.06 || p.aabb.max.z > geo.betweenHalfW + 0.06) continue;
      lanes.add(((p.aabb.min.z + p.aabb.max.z) / 2).toFixed(1));
    }
    return lanes;
  };

  // Generic carton fixtures (not hardcoded screenshot coordinates) that overflow
  // the front full-width zone into the wheel-well centre channel.
  const fixtures = [
    { caseId: 'A', dims: { l: 24, w: 18, h: 16 }, count: 160 },
    { caseId: 'B', dims: { l: 30, w: 20, h: 10 }, count: 160 },
  ];
  for (const { caseId, dims, count } of fixtures) {
    const items = Array.from({ length: count }, (_, i) => ({
      instanceId: `${caseId}${i}`, caseId, dims, shape: 'box',
      orientationLock: 'any', canFlip: false, weight: 25, maxStackCount: 2,
    }));
    // Default browser path: channel compaction ON.
    const enabled = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
    // Baseline: channel compaction OFF (the clean floor-pass lane layout).
    const disabled = Solver.solveAutoPack({
      truck, zones, loadFrontFirst: true, items,
      enableWheelWellBridge: true, enableWheelWellFloorChannelCompaction: false,
    });

    assert.equal(enabled.placements.size, count, `${caseId}: every carton packs`);
    assert.equal(enabled.placements.size, disabled.placements.size, `${caseId}: compaction preserves packed count`);

    const enabledLanes = channelFloorLanes(enabled, items);
    const disabledLanes = channelFloorLanes(disabled, items);
    assert.ok(enabledLanes.size > 1, `${caseId}: load reaches the channel`);
    // Anti-zigzag: channel compaction must NOT introduce extra lateral lanes
    // beyond the clean floor-pass baseline. The previous defect roughly doubled
    // the lane count by pulling alternating rows to opposite channel walls.
    assert.ok(enabledLanes.size <= disabledLanes.size,
      `${caseId}: channel compaction adds no lateral zigzag lanes (enabled ${enabledLanes.size} <= baseline ${disabledLanes.size})`);

    wwAssertHardSafe(Solver, enabled, truck, zones, items, `${caseId} channel alignment`);

    // Deterministic: identical placements on repeat.
    const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, enableWheelWellBridge: true });
    assert.deepEqual([...repeat.placements.entries()], [...enabled.placements.entries()],
      `${caseId}: channel-aligned pack is deterministic`);
  }
});

test('G2-SHAPE-CONTRACT frontBonus main zone spans the full main box from x=0 to x=truck.length', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const mainZone = zones.find(z => z.min.x === 0);

  assert.ok(mainZone, 'frontBonus must include a main zone starting at x=0');
  assert.equal(mainZone.max.x, truck.length, 'frontBonus main zone must span the full main box up to x=truck.length');
  assert.equal(mainZone.min.y, 0, 'frontBonus main zone must keep the full height (min.y=0)');
  assert.equal(mainZone.max.y, truck.height, 'frontBonus main zone must keep the full height (max.y=height)');
  assert.equal(mainZone.min.z, -truck.width / 2, 'frontBonus main zone must keep the full width (min.z=-width/2)');
  assert.equal(mainZone.max.z, truck.width / 2, 'frontBonus main zone must keep the full width (max.z=width/2)');
});

test('G2-SHAPE-CONTRACT frontBonus overhang zone is a raised platform flush with the ceiling, spanning the full trailer width', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally different from truck.width here to prove
    // it is ignored - the overhang must always span the full trailer width.
    shapeConfig: { bonusLength: 60, bonusWidth: 30, bonusHeight: 24 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const overhangZone = zones.find(z => z.min.x === truck.length);

  assert.ok(overhangZone, 'frontBonus must include an overhang zone starting at x=truck.length');
  assert.equal(overhangZone.max.x, truck.length + truck.shapeConfig.bonusLength,
    'frontBonus overhang zone must end at x=truck.length+bonusLength');
  assert.equal(overhangZone.min.y, truck.shapeConfig.bonusHeight,
    'frontBonus overhang zone must be a raised platform starting at y=bonusHeight (deck height / cab clearance from the main floor)');
  assert.equal(overhangZone.max.y, truck.height,
    'frontBonus overhang zone must be flush with the main box ceiling (max.y=truck.height)');
  assert.equal(overhangZone.min.z, -truck.width / 2,
    'frontBonus overhang zone must span the full trailer width (min.z=-truck.width/2), ignoring bonusWidth');
  assert.equal(overhangZone.max.z, truck.width / 2,
    'frontBonus overhang zone must span the full trailer width (max.z=truck.width/2), ignoring bonusWidth');
});

test('G2-SHAPE-CONTRACT missing/invalid/non-finite bonusLength defaults to 0 and frontBonus becomes equivalent to rect', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const baseTruck = { length: 240, width: 96, height: 72 };
  const rectTruck = { ...baseTruck, shapeMode: 'rect' };
  const rectZones = PackLibrary.getTrailerUsableZones(rectTruck);
  const rectCapacity = PackLibrary.getTrailerCapacityInches3(rectTruck);

  const variants = [
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: {} },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: -10 } },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: 'not-a-number' } },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: NaN } },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: Infinity } },
  ];

  for (const frontBonusTruck of variants) {
    const frontBonusCapacity = PackLibrary.getTrailerCapacityInches3(frontBonusTruck);
    assert.ok(Math.abs(rectCapacity - frontBonusCapacity) < 1e-6,
      `frontBonus with bonusLength=${JSON.stringify(frontBonusTruck.shapeConfig.bonusLength)} must match rect usable volume`);

    const frontBonusZones = PackLibrary.getTrailerUsableZones(frontBonusTruck);
    assert.equal(frontBonusZones.length, 1,
      `frontBonus with bonusLength=${JSON.stringify(frontBonusTruck.shapeConfig.bonusLength)} must collapse to a single zone (no overhang)`);
    assert.equal(frontBonusZones[0].max.x, rectZones[0].max.x, 'frontBonus zone must match rect zone bounds (max.x)');
    assert.equal(frontBonusZones[0].min.y, 0, 'default frontBonus zone must keep the full height (min.y=0)');
    assert.equal(frontBonusZones[0].max.y, baseTruck.height, 'default frontBonus zone must keep the full height (max.y=height)');
    assert.equal(frontBonusZones[0].min.z, -baseTruck.width / 2, 'default frontBonus zone must keep the full width (min.z=-width/2)');
    assert.equal(frontBonusZones[0].max.z, baseTruck.width / 2, 'default frontBonus zone must keep the full width (max.z=width/2)');
  }
});

test('G2-SHAPE-CONTRACT getTrailerCapacityInches3 for frontBonus adds the overhang volume to the rect capacity', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const baseTruck = { length: 240, width: 96, height: 72 };
  const rectTruck = { ...baseTruck, shapeMode: 'rect' };
  const frontBonusTruck = {
    ...baseTruck,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 48, bonusHeight: 36 },
  };

  const rectCapacity = PackLibrary.getTrailerCapacityInches3(rectTruck);
  const frontBonusCapacity = PackLibrary.getTrailerCapacityInches3(frontBonusTruck);
  const { bonusLength, bonusHeight } = frontBonusTruck.shapeConfig;
  // Overhang spans the full trailer width (truck.width), not bonusWidth, and its
  // usable height is (truck.height - bonusHeight) since the deck starts at y=bonusHeight.
  const overhangVolume = bonusLength * baseTruck.width * (baseTruck.height - bonusHeight);

  assert.ok(Math.abs(frontBonusCapacity - (rectCapacity + overhangVolume)) < 1e-6,
    'frontBonus capacity with bonusLength>0 must equal rect capacity plus the overhang volume (full trailer width x (height - bonusHeight))');
});

test('G2-SHAPE-CONTRACT a box in the raised front overhang is contained only when within its raised platform bounds', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 60, bonusWidth: 30, bonusHeight: 36 },
    shapeMode: 'frontBonus',
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  // Overhang zone: x:240..300, y:36..72 (bonusHeight..height), z:-48..48 (full width).
  // Cab void: x:240..300, y:0..36 (0..bonusHeight), z:-48..48 (full width).

  const insideOverhang = {
    min: { x: 250, y: 40, z: -10 },
    max: { x: 290, y: 60, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(insideOverhang, zones), true,
    'a box fully inside the raised overhang platform must be contained in a usable zone');

  const beyondOverhangLength = {
    min: { x: 295, y: 40, z: -10 },
    max: { x: 310, y: 60, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(beyondOverhangLength, zones), false,
    'a box extending beyond truck.length+bonusLength must not be contained in any usable zone');

  const penetratesCabVoidBelowDeck = {
    min: { x: 250, y: 20, z: -10 },
    max: { x: 290, y: 50, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(penetratesCabVoidBelowDeck, zones), false,
    'a box extending below the overhang deck (y < bonusHeight, into the cab void) must not be contained in any usable zone');

  const straddlesMainAndOverhangGap = {
    min: { x: 230, y: 50, z: -10 },
    max: { x: 250, y: 65, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(straddlesMainAndOverhangGap, zones), false,
    'a box straddling the main box and the raised overhang (passing through the overhang structure) must not be contained in any usable zone');

  const overhangZone = zones.find(z => z.min.x === truck.length);
  assert.equal(overhangZone.min.z, -truck.width / 2, 'overhang width must be the full trailer width, not bonusWidth');
  assert.equal(overhangZone.max.z, truck.width / 2, 'overhang width must be the full trailer width, not bonusWidth');
});

test('G2-SHAPE-CONTRACT computeStats does not flag a properly placed item in the raised front overhang as protrudesFront', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 48, bonusHeight: 36 },
  };
  // Overhang zone: x:240..300, y:36..72 (bonusHeight..height), z:-48..48.
  const caseData = {
    id: 'overhang-test-case',
    name: 'Overhang Test Case',
    dimensions: { length: 40, width: 20, height: 20 },
    volume: 40 * 20 * 20,
    weight: 100,
  };
  const pack = {
    truck,
    cases: [
      {
        id: 'inst-overhang-1',
        caseId: caseData.id,
        hidden: false,
        // Resting on the raised overhang deck: y = bonusHeight + height/2 = 36 + 10 = 46.
        transform: { position: { x: 270, y: 46, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      },
    ],
  };

  const stats = PackLibrary.computeStats(pack, [caseData]);

  assert.equal(stats.packedCases, 1, 'an item correctly placed on the raised front overhang deck must count as packed');
  assert.deepEqual(stats.oogWarnings, [],
    'an item correctly placed on the raised front overhang deck must not produce any OOG warnings (e.g. protrudesFront)');
});

test('3B-GEOMETRY-TOLERANCE uses one shared inch-space containment tolerance', async () => {
  const packSrc = await fs.readFile(packLibraryPath, 'utf8');
  const solverSrc = await fs.readFile(autoPackSolverPath, 'utf8');
  const validationSrc = await fs.readFile(packingCoreValidationPath, 'utf8');
  const appSrc = await readAppSource();
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const trailerGeometrySrc = await fs.readFile(trailerGeometryPath, 'utf8');
  const productionSrc = [packSrc, solverSrc, validationSrc, appSrc, editorSrc, trailerGeometrySrc].join('\n');

  const definitions = productionSrc.match(/\b(?:export\s+)?const\s+CONTAINMENT_EPS_INCHES\s*=/g) || [];
  assert.equal(definitions.length, 1,
    'CONTAINMENT_EPS_INCHES must have exactly one production definition');
  assert.match(validationSrc, /export const CONTAINMENT_EPS_INCHES = 0\.05;/,
    'packing-core/validation.js must define the canonical 0.05 inch containment tolerance');
  assert.match(packSrc, /CONTAINMENT_EPS_INCHES,[\s\S]*?from '\.\.\/packing-core\/validation\.js';/,
    'pack-library.js must import the canonical containment tolerance from packing-core');
  assert.match(packSrc, /export \{ CONTAINMENT_EPS_INCHES, PLACEMENT_EPS, MIN_SUPPORT_FRACTION \};/,
    'pack-library.js must re-export the canonical tolerance for existing consumers');
  assert.match(solverSrc, /CONTAINMENT_EPS_INCHES,[\s\S]*?from '\.\.\/packing-core\/validation\.js';/,
    'autopack-solver.js must import the shared containment tolerance from packing-core');
  assert.match(validationSrc, /export function isAabbContainedInAnyZone\(aabb, zones, epsilon = CONTAINMENT_EPS_INCHES\)/,
    'canonical containment defaults must reference the shared tolerance');
  assert.match(solverSrc, /\bisAabbContainedInAnyZone\(/,
    'autopack-solver.js must call the canonical containment helper instead of a local tolerance');

  const appHelperStart = trailerGeometrySrc.indexOf('function isAabbContainedInAnyZone(aabb, zones)');
  const appHelperEnd = trailerGeometrySrc.indexOf('\n    function zonesInchesToWorld', appHelperStart);
  const appHelperBlock = appHelperStart >= 0 && appHelperEnd > appHelperStart
    ? trailerGeometrySrc.slice(appHelperStart, appHelperEnd)
    : '';
  assert.ok(appHelperBlock, 'trailer-geometry.js TrailerGeometry containment helper must be present');
  assert.match(appHelperBlock, /CorePackLibrary\.CONTAINMENT_EPS_INCHES/,
    'trailer-geometry.js TrailerGeometry containment helper must reference the shared inch tolerance');
  assert.doesNotMatch(appHelperBlock, /0\.01/,
    'trailer-geometry.js TrailerGeometry containment helper must not retain the old 0.01 world-unit tolerance');

  const editorHelperStart = editorSrc.indexOf('function isInsideTruck(aabb)');
  const editorHelperEnd = editorSrc.indexOf('\n    function checkCollision', editorHelperStart);
  const editorHelperBlock = editorHelperStart >= 0 && editorHelperEnd > editorHelperStart
    ? editorSrc.slice(editorHelperStart, editorHelperEnd)
    : '';
  assert.ok(editorHelperBlock, 'editor-screen.js isInsideTruck helper must be present');
  assert.match(editorHelperBlock, /const aabbInches = aabbWorldToInches\(aabb\);/,
    'editor live containment path must convert the world-space AABB to inches');
  assert.match(editorHelperBlock, /TrailerGeometry\.isAabbContainedInAnyZone\(aabbInches, zonesInches\)/,
    'editor live containment path must call containment with inch-space AABB and inch-space zones');
  assert.doesNotMatch(editorHelperBlock, /zonesInchesToWorld\(zonesInches\)/,
    'editor live containment path must not pass world-space zones into the inch-space containment helper');
  assert.doesNotMatch(productionSrc, /containmentEpsWorld|worldContainmentEps|epsilonWorld|worldEpsilon/i,
    'production code must not add a parallel world-space containment epsilon');
});

test('3B-GEOMETRY-TOLERANCE canonical containment boundary behavior covers all active trailer shapes', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const rectTruck = { length: 100, width: 50, height: 40, shapeMode: 'rect' };
  const rectZones = PackLibrary.getTrailerUsableZones(rectTruck);

  assert.equal(PackLibrary.CONTAINMENT_EPS_INCHES, 0.05,
    'canonical containment tolerance must be 0.05 inches');

  const exactAllBoundaries = {
    min: { x: 0, y: 0, z: -25 },
    max: { x: 100, y: 40, z: 25 },
  };
  const outsideBy004 = {
    min: { x: -0.04, y: -0.04, z: -25.04 },
    max: { x: 100.04, y: 40.04, z: 25.04 },
  };
  const outsideBy006 = {
    min: { x: -0.06, y: -0.06, z: -25.06 },
    max: { x: 100.06, y: 40.06, z: 25.06 },
  };

  assert.equal(PackLibrary.isAabbContainedInAnyZone(exactAllBoundaries, rectZones), true,
    'a box exactly on all standard trailer boundaries must be contained');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(outsideBy004, rectZones), true,
    'a box outside the standard trailer by 0.04 inches must remain contained by tolerance');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(outsideBy006, rectZones), false,
    'a box outside the standard trailer by 0.06 inches must be rejected');
  assert.equal(Solver.isAabbContainedInAnyZone(outsideBy004, rectZones), true,
    'AutoPack solver containment must share the 0.05 inch tolerance');
  assert.equal(Solver.isAabbContainedInAnyZone(outsideBy006, rectZones), false,
    'AutoPack solver containment must reject protrusions beyond the shared tolerance');

  const wheelTruck = {
    length: 100,
    width: 100,
    height: 80,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 30, wellWidth: 15, wellLength: 30, wellOffsetFromRear: 20 },
  };
  const wheelZones = PackLibrary.getTrailerUsableZones(wheelTruck);
  const wheelBlockedVolume = {
    min: { x: 25, y: 0, z: -48 },
    max: { x: 35, y: 10, z: -40 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(wheelBlockedVolume, wheelZones), false,
    'wheel-well blocked lower volume must remain rejected');

  const frontBonusTruck = {
    length: 100,
    width: 50,
    height: 60,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 30, bonusWidth: 20, bonusHeight: 24 },
  };
  const frontBonusZones = PackLibrary.getTrailerUsableZones(frontBonusTruck);
  const overhangDeckVolume = {
    min: { x: 104, y: 28, z: -8 },
    max: { x: 124, y: 48, z: 8 },
  };
  const cabVoidVolume = {
    min: { x: 104, y: 4, z: -8 },
    max: { x: 124, y: 20, z: 8 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(overhangDeckVolume, frontBonusZones), true,
    'front overhang deck volume above the cab must remain accepted');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(cabVoidVolume, frontBonusZones), false,
    'front overhang cab void below the deck must remain rejected');
});

test('3B-GEOMETRY-TOLERANCE stats, packed state, and AutoPack final validation share canonical containment', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 100, width: 50, height: 40, shapeMode: 'rect' };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const caseData = {
    id: 'tol-case',
    name: 'Tolerance Case',
    dimensions: { length: 10, width: 10, height: 10 },
    volume: 1000,
    weight: 25,
  };
  const makeInstance = (id, x) => ({
    id,
    caseId: caseData.id,
    hidden: false,
    transform: { position: { x, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
  });
  const pack = {
    truck,
    cases: [
      makeInstance('exact-front-boundary', 95),
      makeInstance('within-tolerance-front', 95.04),
      makeInstance('beyond-tolerance-front', 95.06),
    ],
  };
  const stats = PackLibrary.computeStats(pack, [caseData]);

  assert.equal(stats.packedCases, 2,
    'Stats must count exact-boundary and 0.04 inch protrusions as packed, and reject a 0.06 inch protrusion');
  assert.equal(stats.oogWarnings.length, 1,
    'Stats/OOG must flag the case protruding beyond the 0.05 inch containment tolerance');
  assert.equal(stats.oogWarnings[0].instanceId, 'beyond-tolerance-front',
    'OOG warning must identify the beyond-tolerance instance');
  assert.ok(stats.oogWarnings[0].issues.includes('protrudesFront'),
    '0.06 inch front protrusion must be classified as protrudesFront');

  const placementForAabb = aabb => PackLibrary.isAabbContainedInAnyZone(aabb, zones) ? 'packed' : 'staged';
  assert.equal(placementForAabb({
    min: { x: 90, y: 0, z: -5 },
    max: { x: 100.04, y: 10, z: 5 },
  }), 'packed', 'packed/staged classification must allow a 0.04 inch protrusion');
  assert.equal(placementForAabb({
    min: { x: 90, y: 0, z: -5 },
    max: { x: 100.06, y: 10, z: 5 },
  }), 'staged', 'packed/staged classification must stage a 0.06 inch protrusion');

  const autoPackResult = Solver.solveAutoPack({
    truck,
    zones,
    items: [
      { instanceId: 'auto-1', dims: { l: 10, w: 10, h: 10 }, canFlip: true, orientationLock: 'any', stackable: true },
      { instanceId: 'auto-2', dims: { l: 20, w: 10, h: 10 }, canFlip: true, orientationLock: 'any', stackable: true },
    ],
    loadFrontFirst: true,
  });
  assert.equal(autoPackResult.unpacked.length, 0, 'simple AutoPack fixture must fully pack');
  for (const [id, pos] of autoPackResult.placements.entries()) {
    const dims = autoPackResult.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height });
    assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), true,
      `${id} final AutoPack placement must pass canonical PackLibrary containment`);
  }
});

test('3B-GEOMETRY-TOLERANCE world drag feedback converts AABBs to inches before classification', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const INCH_TO_WORLD = 0.05;
  const truck = { length: 100, width: 50, height: 40, shapeMode: 'rect' };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const toWorld = value => value * INCH_TO_WORLD;
  const toInches = value => value / INCH_TO_WORLD;
  const aabbInchesToWorld = aabb => ({
    min: { x: toWorld(aabb.min.x), y: toWorld(aabb.min.y), z: toWorld(aabb.min.z) },
    max: { x: toWorld(aabb.max.x), y: toWorld(aabb.max.y), z: toWorld(aabb.max.z) },
  });
  const aabbWorldToInches = aabb => ({
    min: { x: toInches(aabb.min.x), y: toInches(aabb.min.y), z: toInches(aabb.min.z) },
    max: { x: toInches(aabb.max.x), y: toInches(aabb.max.y), z: toInches(aabb.max.z) },
  });
  const dragClassification = worldAabb =>
    PackLibrary.isAabbContainedInAnyZone(aabbWorldToInches(worldAabb), zones) ? 'packed' : 'staged';
  const persistedDropClassification = inchAabb =>
    PackLibrary.isAabbContainedInAnyZone(inchAabb, zones) ? 'packed' : 'staged';
  const cases = [
    {
      label: 'exact boundary',
      aabb: { min: { x: 90, y: 0, z: -5 }, max: { x: 100, y: 10, z: 5 } },
      expected: 'packed',
    },
    {
      label: '0.04 inch protrusion',
      aabb: { min: { x: 90, y: 0, z: -5 }, max: { x: 100.04, y: 10, z: 5 } },
      expected: 'packed',
    },
    {
      label: '0.06 inch protrusion',
      aabb: { min: { x: 90, y: 0, z: -5 }, max: { x: 100.06, y: 10, z: 5 } },
      expected: 'staged',
    },
  ];

  for (const c of cases) {
    const worldAabb = aabbInchesToWorld(c.aabb);
    assert.equal(dragClassification(worldAabb), c.expected,
      `drag feedback must classify ${c.label} using the same physical tolerance as persisted state`);
    assert.equal(persistedDropClassification(c.aabb), c.expected,
      `persisted drop state must classify ${c.label} using the canonical helper`);
    assert.equal(dragClassification(worldAabb), persistedDropClassification(c.aabb),
      `drag feedback and persisted drop classification must agree for ${c.label}`);
  }
});

test('G2.2-CAB-OVERHANG getFrontBonusZone() returns the raised deck starting at y=bonusHeight (deck height / cab clearance)', async () => {
  const trailerGeometrySrc = await fs.readFile(trailerGeometryPath, 'utf8');
  const start = trailerGeometrySrc.indexOf('function getFrontBonusZone(truck)');
  const end = trailerGeometrySrc.indexOf('\n    function getFrontBonusBlockedZones', start);
  const block = start >= 0 && end > start ? trailerGeometrySrc.slice(start, end) : '';

  assert.ok(block, 'getFrontBonusZone must be defined in trailer-geometry.js TrailerGeometry');
  assert.match(
    block,
    /zone\(\{ x: L, y: bonusHeight, z: -W \/ 2 \}, \{ x: L \+ bonusLength, y: H, z: W \/ 2 \}\)/,
    'getFrontBonusZone must return a raised deck starting at y=bonusHeight (deck height / cab clearance), flush with the ceiling (max.y=H), spanning the full trailer width (z: -W/2..W/2)'
  );
  assert.doesNotMatch(
    block,
    /y: H - bonusHeight/,
    'getFrontBonusZone must not derive the deck floor as height-bonusHeight (G2.2: bonusHeight IS the deck height, not the usable cargo height)'
  );
  assert.doesNotMatch(
    block,
    /bonusWidth/,
    'getFrontBonusZone must not use bonusWidth - the overhang always spans the full trailer width'
  );
  assert.doesNotMatch(
    block,
    /\{ x: 0, y: 0, z: -W \/ 2 \}/,
    'getFrontBonusZone must not return a zone starting at x=0 (old internal cab-side carve-out)'
  );
});

test('G2.2-CAB-OVERHANG getFrontBonusBlockedZones() returns the cab void below the deck (pack-library.js and app.js)', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const trailerGeometrySrc = await fs.readFile(trailerGeometryPath, 'utf8');

  const truck = {
    length: 200,
    width: 90,
    height: 80,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 40, bonusWidth: 60, bonusHeight: 30 },
  };

  assert.equal(typeof PackLibrary.getFrontBonusBlockedZones, 'function',
    'pack-library.js must export getFrontBonusBlockedZones');

  const blocked = PackLibrary.getFrontBonusBlockedZones(truck);
  assert.equal(blocked.length, 1, 'frontBonus with bonusLength>0 must produce exactly one cab-void zone');
  assert.deepEqual(blocked[0], {
    min: { x: truck.length, y: 0, z: -truck.width / 2 },
    max: { x: truck.length + truck.shapeConfig.bonusLength, y: truck.shapeConfig.bonusHeight, z: truck.width / 2 },
  }, 'cab void must span x:truck.length..truck.length+bonusLength, y:0..bonusHeight, full trailer width');

  assert.deepEqual(PackLibrary.getFrontBonusBlockedZones({ ...truck, shapeMode: 'rect' }), [],
    'non-frontBonus shapes must not have a cab void');
  assert.deepEqual(
    PackLibrary.getFrontBonusBlockedZones({ ...truck, shapeConfig: { ...truck.shapeConfig, bonusLength: 0 } }),
    [],
    'frontBonus with bonusLength=0 must not have a cab void'
  );

  assert.match(trailerGeometrySrc, /function getFrontBonusBlockedZones\(truck\)/,
    'trailer-geometry.js TrailerGeometry must define getFrontBonusBlockedZones for visual/settle use');
  assert.match(trailerGeometrySrc, /getFrontBonusBlockedZones,\n\s*\};/,
    'trailer-geometry.js TrailerGeometry must export getFrontBonusBlockedZones from its returned object');
});

test('G2.2-CAB-OVERHANG front overhang renders as a raised platform flush with the main box ceiling, open toward it', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /const bonus = mode === 'frontBonus' \? TrailerGeometry\.getFrontBonusZone\(truckInches\) : null;/,
    'setTruck must derive the overhang volume from getFrontBonusZone');
  assert.match(src, /const bonusCenterX = toWorld\(bonus\.min\.x\) \+ bonusLengthW \/ 2;/,
    'overhang volume must be positioned starting at x=truck.length (bonus.min.x)');
  assert.match(src, /const bonusBaseY = toWorld\(bonus\.min\.y\);/,
    'overhang volume must derive its raised floor/deck height from bonus.min.y (bonusHeight, the deck height / cab clearance)');
  assert.match(
    src,
    /addTrailerVolume\(truck, bonusLengthW, bonusHeightW, bonusWidthW, bonusCenterX, mat, lineMat, floorMat, \{[\s\S]{0,120}openMinX: true,[\s\S]{0,120}baseY: bonusBaseY,/,
    'overhang volume must be rendered as a real attached mesh sized by the bonus zone, raised to baseY, open toward the main box'
  );
  assert.match(
    src,
    /addTrailerVolume\(truck, lengthW, heightW, widthW, lengthW \/ 2, mat, lineMat, floorMat, \{[\s\S]{0,120}openMaxX: Boolean\(bonus\),/,
    'main cargo box must remain x=0..truck.length, floor at y=0, and open toward the overhang when present'
  );

  // addTrailerVolume itself must support a baseY offset for raised volumes.
  assert.match(src, /function addTrailerVolume\(group, lengthW, heightW, widthW, centerX, mat, lineMat, floorMat, opts = \{\}\)/,
    'addTrailerVolume must accept an opts object');
  assert.match(src, /const baseY = Number\.isFinite\(opts\.baseY\) \? opts\.baseY : 0;/,
    'addTrailerVolume must support opts.baseY to raise a volume off the floor');
});

test('G2.2-CAB-OVERHANG scene-runtime renders the cab void below the deck as a blocked/no-load guide volume', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  const start = src.indexOf('function updateTrailerShapeGuides(truckInches)');
  const end = src.indexOf('\n    function addTrailerVolume', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block, 'updateTrailerShapeGuides must be defined in scene-runtime.js');
  assert.match(block, /mode === 'frontBonus'/,
    'updateTrailerShapeGuides must branch on the frontBonus shape mode to render the cab void');
  assert.match(block, /TrailerGeometry\.getFrontBonusBlockedZones\(truckInches\)/,
    'updateTrailerShapeGuides must render the frontBonus cab void using getFrontBonusBlockedZones');
  assert.match(block, /addGuideBox\(group, z, \{ fillColor: 0xff3b30/,
    'the cab void must be rendered with the same blocked/no-load guide-box style used for wheel wells');
});

test('G2.2-CAB-OVERHANG rear/loading-door and front/cab-side end caps get distinct direction-cue wireframe colors (no sprites)', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /const doorLineMat = new THREE\.LineBasicMaterial\(/,
    'setTruck must define a distinct line material for the rear/loading-door end cap');
  assert.match(src, /const cabLineMat = new THREE\.LineBasicMaterial\(/,
    'setTruck must define a distinct line material for the front/cab-side end cap');

  const cuesStart = src.indexOf('const doorLineMat = new THREE.LineBasicMaterial(');
  const cuesEnd = src.indexOf('maxXLineMat: cabLineMat', cuesStart);
  const cuesBlock = cuesStart >= 0 && cuesEnd > cuesStart ? src.slice(cuesStart, cuesEnd) : '';
  assert.ok(cuesBlock, 'direction-cue setup block must be present in setTruck');
  assert.doesNotMatch(cuesBlock, /THREE\.Sprite/,
    'direction cues must not use THREE.Sprite (avoids the shared-geometry singleton dispose risk)');
  assert.match(src, /minXLineMat: doorLineMat/,
    'main cargo box rear end cap (x=0) must use the door/rear line material');
  assert.match(src, /maxXLineMat: cabLineMat/,
    'the front-most end cap (main box when no overhang, or the overhang) must use the cab/front line material');
});

test('G2.2-CAB-OVERHANG rendered overhang volume bounds match the usable-zone overhang used for collision', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  const truck = {
    length: 200,
    width: 90,
    height: 80,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 40, bonusWidth: 60, bonusHeight: 30 },
  };

  const zones = PackLibrary.getTrailerUsableZones(truck);
  const overhangZone = zones.find(z => z.min.x >= truck.length);
  assert.ok(overhangZone, 'getTrailerUsableZones must produce an overhang zone for collision/containment');

  // Mirrors getFrontBonusZone()'s formula (app.js TrailerGeometry) for the same truck/config.
  // bonusHeight is the deck height / cab clearance, so the deck (and the rendered
  // overhang volume) starts at y=bonusHeight, not y=height-bonusHeight.
  const { length: L, width: W, height: H } = truck;
  const cfg = truck.shapeConfig;
  const bonusLength = Math.max(0, cfg.bonusLength);
  const bonusHeight = Math.min(Math.max(cfg.bonusHeight, 0), H);
  const expectedRenderZone = {
    min: { x: L, y: bonusHeight, z: -W / 2 },
    max: { x: L + bonusLength, y: H, z: W / 2 },
  };

  assert.deepEqual(overhangZone, expectedRenderZone,
    'the visual overhang volume (getFrontBonusZone) and the collision overhang zone (getTrailerUsableZones) must describe the same x/y/z bounds');
});

test('G2.2-CAB-OVERHANG Inspector labels the height control "Deck Height" (not ambiguous "Overhang height") and has no Width input', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf("if (currentMode === 'frontBonus') {");
  const end = src.indexOf("if (currentMode === 'wheelWells') {", start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block, 'Front Overhang config card block must be present in editor-screen.js');

  // Req #14: the height field must be labeled "Deck Height", not the ambiguous
  // "Overhang height" (which could mean usable cargo height or deck height).
  assert.match(block, /Deck Height \(\$\{lengthUnit\}\)/,
    'Front Overhang card must label the deck-height field "Deck Height (<unit>)"');
  assert.doesNotMatch(block, /Overhang [Hh]eight \(\$\{lengthUnit\}\)/,
    'Front Overhang card must not label the height field "Overhang height"');
  assert.match(block, /Usable overhang height: \$\{Utils\.inchesToUnit\(usableOverhangHeight, lengthUnit\)\.toFixed\(1\)\} \$\{lengthUnit\}/,
    'Front Overhang card should display the computed usable overhang height');
  assert.match(block, /\(trailer height [−-] deck height\)/,
    'Front Overhang card should explain how usable overhang height relates to deck height');

  // Req #13: Front Overhang Width input is absent; bonusWidth is normalized to truck.width.
  assert.doesNotMatch(block, /Width \(\$\{lengthUnit\}\)/,
    'Front Overhang card must not render a Width input field');
  assert.doesNotMatch(block, /\bfBW\b/,
    'Front Overhang card must not reference a width field control');
  assert.match(block, /bonusWidth: tW/,
    'Front Overhang save/reset must silently normalize bonusWidth to the trailer width for backward compatibility');
});

test('G2.2-CAB-OVERHANG a case in the cab void is not packed; a case on the deck within bounds is packed', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 200,
    width: 90,
    height: 80,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 40, bonusWidth: 60, bonusHeight: 30 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const blockedZones = PackLibrary.getFrontBonusBlockedZones(truck);
  // Usable overhang zone: x:200..240, y:30..80, z:-45..45.
  // Cab void: x:200..240, y:0..30, z:-45..45.

  // Req #5: a case entirely in the cab void (below the deck) must not be packed.
  const inCabVoid = { min: { x: 210, y: 5, z: -10 }, max: { x: 230, y: 25, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(inCabVoid, zones), false,
    'a case in the cab void below the deck must not be contained in any usable zone');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(inCabVoid, blockedZones), true,
    'sanity check: the case sits inside the cab-void blocked zone');

  // Req #6: a case resting on the deck and fitting under the roof must be packed.
  const onDeck = { min: { x: 210, y: 30, z: -10 }, max: { x: 230, y: 70, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(onDeck, zones), true,
    'a case resting on the raised deck and fitting under the roof must be contained in a usable zone');

  // Req #7: a case above the overhang ceiling must not be packed.
  const aboveCeiling = { min: { x: 210, y: 30, z: -10 }, max: { x: 230, y: 85, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(aboveCeiling, zones), false,
    'a case extending above the overhang ceiling (truck.height) must not be contained in any usable zone');

  // Req #8: a case past the overhang's front end must not be packed.
  const pastFrontEnd = { min: { x: 230, y: 30, z: -10 }, max: { x: 250, y: 70, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(pastFrontEnd, zones), false,
    'a case extending past truck.length+bonusLength must not be contained in any usable zone');
});

test('G2.2-CAB-OVERHANG computeSettleY supports a floorY offset for settling onto the raised overhang deck', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };

  // Req #9: with no supporters, an item over the overhang deck settles at
  // floorY + halfY (the deck surface), not y=halfY (the main floor).
  const onDeck = EditorScreen.computeSettleY(half, 0, 0, [], 0.5, 30);
  assert.equal(onDeck, 42, 'an item with floorY=30 (deck height) must settle at floorY + halfY = 42, not the main floor');

  // Req #10: main-floor items (floorY=0, the default) still settle to y=halfY.
  const onFloor = EditorScreen.computeSettleY(half, 0, 0, [], 0.5);
  assert.equal(onFloor, 12, 'an item with the default floorY=0 must still settle to the main floor (halfY)');

  // A supporter above the deck still wins over the deck floor.
  const supporter = { min: { x: -24, y: 30, z: -24 }, max: { x: 24, y: 54, z: 24 } };
  const onSupporter = EditorScreen.computeSettleY(half, 0, 0, [supporter], 0.5, 30);
  assert.equal(onSupporter, 66, 'a supporter above the deck must still win over the deck floor (supporter.max.y + halfY)');

  // The result must never settle below floorY + halfY even with below-deck supporters
  // (the cab void must never act as a floor).
  const belowDeck = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 10, z: 24 } };
  const stillOnDeck = EditorScreen.computeSettleY(half, 0, 0, [belowDeck], 0.5, 30);
  assert.equal(stillOnDeck, 42, 'a supporter entirely below the deck must not pull the result below floorY + halfY');
});

test('G2.2-CAB-OVERHANG editor-screen settleY derives the overhang deck floor from getFrontBonusZone and never settles into the cab void', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.match(src, /function getFrontOverhangDeckFloorYWorld\(cx, cz, halfX, halfZ\)/,
    'editor-screen must define a helper to resolve the overhang deck floor in world units, taking the full X/Z footprint');
  assert.match(src, /TrailerGeometry\.getFrontBonusZone\(truck\)/,
    'getFrontOverhangDeckFloorYWorld must derive the deck zone from TrailerGeometry.getFrontBonusZone');
  assert.match(src, /return zoneWorld\.min\.y/,
    'getFrontOverhangDeckFloorYWorld must return the deck zone min.y (the deck surface, never the cab void below it)');

  const settleStart = src.indexOf('function settleY(instanceId)');
  const settleEnd = src.indexOf('\n    function getSnapWallCandidatesWorld', settleStart);
  const settleBlock = settleStart >= 0 && settleEnd > settleStart ? src.slice(settleStart, settleEnd) : '';
  assert.ok(settleBlock, 'settleY must be defined in editor-screen.js');
  assert.match(settleBlock, /const deckFloorY = getFrontOverhangDeckFloorYWorld\(group\.position\.x, group\.position\.z, halfWorld\.x, halfWorld\.z\);/,
    'settleY must compute the overhang deck floor from the case current X\\/Z position and full footprint');
  assert.match(settleBlock, /deckFloorY !== null \? deckFloorY : 0/,
    'settleY must pass the deck floor (or 0 for the main floor) as computeSettleY floorY argument');
});

test('G2.2-CAB-OVERHANG AutoPack uses the raised overhang deck only when an item fits above the deck and below the roof, and never the cab void', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const { solveAutoPack, isAabbContainedInAnyZone } = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);

  // Main floor footprint (24x18) exactly matches the truck's main-zone footprint, and the
  // overhang footprint (24x18) exactly matches the overhang zone's footprint, so each zone
  // holds exactly one footprint "column". bonusHeight=20 makes the deck height (20) and the
  // usable overhang cargo height (72-20=52) clearly distinct from each other.
  const truck = {
    length: 24,
    width: 18,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 24, bonusWidth: 48, bonusHeight: 20 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const blockedZones = PackLibrary.getFrontBonusBlockedZones(truck);
  const overhangZone = zones.find(z => z.min.x >= truck.length);
  const EPS = 0.06;

  const items = [
    { instanceId: 'short-1', weight: 30, dims: { l: 24, w: 18, h: 16 }, canFlip: true, orientationLock: 'any', stackable: true, maxStackCount: 2 },
    { instanceId: 'short-2', weight: 30, dims: { l: 24, w: 18, h: 16 }, canFlip: true, orientationLock: 'any', stackable: true, maxStackCount: 2 },
    { instanceId: 'tall-1', weight: 100, dims: { l: 24, w: 18, h: 60 }, canFlip: false, orientationLock: 'upright', stackable: true, maxStackCount: 1 },
  ];

  const result = solveAutoPack({
    truck: { length: truck.length, width: truck.width, height: truck.height },
    zones,
    loadFrontFirst: true,
    items,
  });

  assert.equal(result.unpacked.length, 0, 'all items must be packed across the main zone and the raised overhang deck');

  const placedAabbs = [];
  for (const [id, pos] of result.placements.entries()) {
    const od = result.orientedDims.get(id);
    const half = { x: od.length / 2, y: od.height / 2, z: od.width / 2 };
    const aabb = {
      min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
      max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
    };
    assert.ok(isAabbContainedInAnyZone(aabb, zones),
      `${id} must be fully contained within a usable zone (main or overhang deck)`);
    placedAabbs.push({ id, aabb });
  }

  // Req #11: AutoPack must never place an item inside the cab void.
  for (const p of placedAabbs) {
    assert.equal(isAabbContainedInAnyZone(p.aabb, blockedZones), false,
      `${p.id} must not be placed inside the cab void below the overhang deck`);
  }

  // Req #12: the short items (h=16) fit above the deck and below the roof (16 <= 72-20),
  // so AutoPack must be able to use the overhang deck for them.
  const inOverhang = placedAabbs.filter(p => p.aabb.min.x >= overhangZone.min.x - EPS);
  assert.ok(inOverhang.length > 0, 'AutoPack must be able to place items on the raised overhang deck');
  for (const p of inOverhang) {
    assert.ok(p.aabb.min.y >= overhangZone.min.y - EPS,
      `${p.id} placed on the overhang must rest at/above the deck (zone.min.y = bonusHeight), not in the cab void`);
    assert.ok(p.aabb.max.y <= overhangZone.max.y + EPS,
      `${p.id} placed on the overhang must not extend above the ceiling`);
  }

  // Req #12 (continued): the tall item (h=60) does not fit above the deck and below the
  // roof (60 > 72-20=52), so it must be placed in the main zone, not the overhang deck.
  const tall = placedAabbs.find(p => p.id === 'tall-1');
  assert.ok(tall.aabb.min.x < overhangZone.min.x - EPS,
    'an item taller than the usable overhang height (height - bonusHeight) must not be placed on the overhang deck');

  function overlaps(a, b) {
    const OEPS = 0.05;
    return a.min.x < b.max.x - OEPS && a.max.x > b.min.x + OEPS &&
      a.min.y < b.max.y - OEPS && a.max.y > b.min.y + OEPS &&
      a.min.z < b.max.z - OEPS && a.max.z > b.min.z + OEPS;
  }
  for (let i = 0; i < placedAabbs.length; i++) {
    for (let j = i + 1; j < placedAabbs.length; j++) {
      assert.equal(overlaps(placedAabbs[i].aabb, placedAabbs[j].aabb), false,
        `${placedAabbs[i].id} and ${placedAabbs[j].id} must not overlap`);
    }
  }
});

test('G2.2-CLEANUP frontBonus item past raw truck.length but within the overhang extent does not get protrudesFront', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusHeight: 36 },
  };
  // Overhang zone: x:240..300, y:36..72, z:-48..48. Cab void: x:240..300, y:0..36, z:-48..48.
  const caseData = {
    id: 'cab-void-straddle',
    name: 'Cab Void Straddle',
    dimensions: { length: 40, width: 20, height: 50 },
    volume: 40 * 20 * 50,
    weight: 10,
  };
  const pack = {
    truck,
    cases: [{
      id: 'inst-straddle',
      caseId: caseData.id,
      hidden: false,
      // x:250..290 (past truck.length=240, within the overhang extent 240..300),
      // y:0..50 (straddles the cab void 0..36 and the deck zone 36..72).
      transform: { position: { x: 270, y: 25, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    }],
  };

  const warnings = PackLibrary.computeStats(pack, [caseData]).oogWarnings;
  assert.equal(warnings.length, 1, 'a case straddling the cab void must still be flagged as outside a usable zone');
  assert.ok(!warnings[0].issues.includes('protrudesFront'),
    'a case past raw truck.length but within truck.length+bonusLength must not be flagged protrudesFront');
  assert.deepEqual(warnings[0].issues, ['outsideUsableZone'],
    'a case straddling the cab void is outside usable zones for height reasons, not because it protrudes past the front');
});

test('G2.2-CLEANUP frontBonus item past truck.length+bonusLength receives protrudesFront', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusHeight: 36 },
  };
  const caseData = {
    id: 'past-overhang-front',
    name: 'Past Overhang Front',
    dimensions: { length: 40, width: 20, height: 36 },
    volume: 40 * 20 * 36,
    weight: 10,
  };
  const pack = {
    truck,
    cases: [{
      id: 'inst-past-front',
      caseId: caseData.id,
      hidden: false,
      // x:290..330 (max.x=330 > truck.length+bonusLength=300), y:36..72 (on the deck), z:0.
      transform: { position: { x: 310, y: 54, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    }],
  };

  const warnings = PackLibrary.computeStats(pack, [caseData]).oogWarnings;
  assert.equal(warnings.length, 1, 'a case extending past truck.length+bonusLength must be flagged');
  assert.ok(warnings[0].issues.includes('protrudesFront'),
    'a case extending past truck.length+bonusLength (the true usable front boundary) must be flagged protrudesFront');
});

test('G2.2-CLEANUP rect and wheelWells front-protrusion warnings remain based on raw truck.length', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = {
    id: 'past-rect-front',
    name: 'Past Rect Front',
    dimensions: { length: 40, width: 20, height: 20 },
    volume: 40 * 20 * 20,
    weight: 10,
  };

  const rectTruck = { length: 100, width: 50, height: 50, shapeMode: 'rect', shapeConfig: {} };
  const rectPack = {
    truck: rectTruck,
    cases: [{
      id: 'inst-rect-front',
      caseId: caseData.id,
      hidden: false,
      // x:90..130, max.x=130 > truck.length=100.
      transform: { position: { x: 110, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    }],
  };
  const rectWarnings = PackLibrary.computeStats(rectPack, [caseData]).oogWarnings;
  assert.equal(rectWarnings.length, 1, 'a rect case extending past truck.length must be flagged');
  assert.ok(rectWarnings[0].issues.includes('protrudesFront'),
    'rect protrudesFront must still trigger at raw truck.length (maxUsableX === truck.length for rect)');

  const wheelTruck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
  };
  const wheelPack = {
    truck: wheelTruck,
    cases: [{
      id: 'inst-wheel-front',
      caseId: caseData.id,
      hidden: false,
      // x:90..130, max.x=130 > truck.length=100.
      transform: { position: { x: 110, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    }],
  };
  const wheelWarnings = PackLibrary.computeStats(wheelPack, [caseData]).oogWarnings;
  assert.equal(wheelWarnings.length, 1, 'a wheelWells case extending past truck.length must be flagged');
  assert.ok(wheelWarnings[0].issues.includes('protrudesFront'),
    'wheelWells protrudesFront must still trigger at raw truck.length (maxUsableX === truck.length for wheelWells)');
});

test('G2.2-CLEANUP getFrontOverhangDeckFloorYWorld checks the full X/Z footprint against the overhang deck zone', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const start = src.indexOf('function getFrontOverhangDeckFloorYWorld(cx, cz, halfX, halfZ)');
  const end = src.indexOf('\n    /** Settle a case down via gravity', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  assert.ok(block, 'getFrontOverhangDeckFloorYWorld must be defined with a (cx, cz, halfX, halfZ) signature');

  // Req #4/#5: the X footprint must be fully inside the deck zone on both edges,
  // not just the low-X edge.
  assert.match(block, /cx - halfX >= zoneWorld\.min\.x - EPS/,
    'the deck-settle guard must check the footprint low-X edge against the overhang zone min.x');
  assert.match(block, /cx \+ halfX <= zoneWorld\.max\.x \+ EPS/,
    'the deck-settle guard must check the footprint high-X edge against the overhang zone max.x (Fix 2 - previously unchecked)');

  // Req #6: the Z footprint must be fully inside the deck zone on both edges (overhang width).
  assert.match(block, /cz - halfZ >= zoneWorld\.min\.z - EPS/,
    'the deck-settle guard must check the footprint low-Z edge against the overhang zone min.z (Fix 2 - previously unchecked)');
  assert.match(block, /cz \+ halfZ <= zoneWorld\.max\.z \+ EPS/,
    'the deck-settle guard must check the footprint high-Z edge against the overhang zone max.z (Fix 2 - previously unchecked)');

  // The deck floor is only returned when the whole footprint is inside; otherwise fall back
  // to null (main floor / existing support logic in settleY).
  assert.match(block, /if \(fitsX && fitsZ\) return zoneWorld\.min\.y;\n\s+return null;/,
    'a footprint that is not fully inside the overhang deck zone must fall back to null, not settle on the deck');
});

test('G2.2-CLEANUP new/edit pack flows share Front Overhang normalization', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const truck = { length: 240, width: 96, height: 96, shapeMode: 'frontBonus' };
  assert.deepEqual(TrailerPresets.normalizeFrontBonusShapeConfig({}, truck), {
    bonusLength: 0.12 * truck.length,
    bonusHeight: 0.45 * truck.height,
    bonusWidth: truck.width,
  });
  assert.deepEqual(TrailerPresets.normalizeFrontBonusShapeConfig({ bonusLength: 0, bonusHeight: 0 }, truck), {
    bonusLength: 0,
    bonusHeight: 0,
    bonusWidth: truck.width,
  }, 'explicit zero remains a valid manually configured no-overhang shape');

  const newPackStart = src.indexOf('function openNewPackModal()');
  const newPackEnd = src.indexOf('\n    function openEditPackModal', newPackStart);
  const newPackBlock = newPackStart >= 0 && newPackEnd > newPackStart ? src.slice(newPackStart, newPackEnd) : '';
  assert.ok(newPackBlock, 'openNewPackModal must be defined in packs-screen.js');
  assert.match(newPackBlock, /if \(newTruck\.shapeMode === 'frontBonus'\) \{\s*\n\s*newTruck\.shapeConfig = TrailerPresets\.normalizeFrontBonusShapeConfig\(newTruck\.shapeConfig, newTruck\);/,
    'creating a new pack with the frontBonus shape mode must initialize valid positive bonusLength/bonusHeight defaults');

  const editPackStart = src.indexOf('function openEditPackModal(packId)');
  const editPackEnd = src.indexOf('\n    function openRename', editPackStart);
  const editPackBlock = editPackStart >= 0 && editPackEnd > editPackStart ? src.slice(editPackStart, editPackEnd) : '';
  assert.ok(editPackBlock, 'openEditPackModal must be defined in packs-screen.js');
  assert.match(editPackBlock, /if \(nextTruck\.shapeMode === 'frontBonus'\) \{\s*\n\s*nextTruck\.shapeConfig = TrailerPresets\.normalizeFrontBonusShapeConfig\(nextTruck\.shapeConfig, nextTruck\);/,
    'switching a pack to the frontBonus shape mode in Edit Pack must normalize missing shapeConfig with valid positive defaults');
});

test('A1 curated Front Overhang preset commits a real raised deck; Standard and Wheel Wells keep their config', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(packLibraryPath.href);
  const base = {
    length: 240, width: 96, height: 96, shapeMode: 'rect',
    shapeConfig: { bonusLength: 0, bonusHeight: 0, wellHeight: 24 },
  };
  const frontPreset = TrailerPresets.getById('53ft_dry_van_us_front_overhang');
  const front = TrailerPresets.applyToTruck(base, frontPreset);
  const expected = TrailerPresets.normalizeFrontBonusShapeConfig({}, front);
  assert.deepEqual(front.shapeConfig, expected, 'curated preset initializes its own default config');
  assert.ok(front.shapeConfig.bonusLength > 0);
  assert.ok(front.shapeConfig.bonusHeight > 0 && front.shapeConfig.bonusHeight < front.height);

  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const committed = PackLibrary.create({ title: 'Front preset', truck: front });
  assert.deepEqual(committed.truck.shapeConfig, expected, 'committed geometry equals the values supplied to the Editor fields');
  const zones = PackLibrary.getTrailerUsableZones(committed.truck);
  assert.equal(zones.length, 2);
  assert.equal(zones[1].min.x, committed.truck.length);
  assert.equal(zones[1].max.x, committed.truck.length + expected.bonusLength);
  assert.equal(zones[1].min.y, expected.bonusHeight);

  for (const id of ['53ft_dry_van_us', '53ft_dry_van_us_wheel_wells']) {
    const unchanged = TrailerPresets.applyToTruck(base, TrailerPresets.getById(id));
    assert.deepEqual(unchanged.shapeConfig, base.shapeConfig, `${id} preserves prior shapeConfig behavior`);
    assert.equal(unchanged.shapeMode, TrailerPresets.getById(id).truck.shapeMode);
  }
});

test('STAGING-S1 pack-library exposes one canonical staging layout helper', async () => {
  const src = await fs.readFile(packLibraryPath, 'utf8');

  assert.match(src, /export function getStagingLayout\(truck, options = \{\}\)/,
    'pack-library must export a single canonical getStagingLayout(truck, options) helper');
  assert.match(src, /export function findSafeStagingPosition\(pack, dims, acceptedAabbs, options = \{\}\)/,
    'findSafeStagingPosition must be exported for reuse by AutoPack and the editor');

  const findStart = src.indexOf('export function findSafeStagingPosition(pack, dims, acceptedAabbs, options = {})');
  const findEnd = src.indexOf('\nfunction buildAcceptedAabbs', findStart);
  const findBlock = findStart >= 0 && findEnd > findStart ? src.slice(findStart, findEnd) : '';
  assert.match(findBlock, /const layout = getStagingLayout\(truck, options\);/,
    'findSafeStagingPosition must derive its geometry from the canonical getStagingLayout helper and pass through staging options');
});

test('STAGING-S1 duplicate staging fallback uses the canonical staging helper instead of a hardcoded grid', async () => {
  const src = await fs.readFile(packLibraryPath, 'utf8');
  const start = src.indexOf('function findDuplicateOffset(pack, payload, existingAabbs, caseLibrary)');
  const end = src.indexOf('\nexport function buildSafeDuplicateInstances', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'pack-library must define findDuplicateOffset(pack, payload, existingAabbs, caseLibrary)');
  assert.match(block, /findSafeStagingPosition\(pack, groupDims, existingAabbs\)/,
    'duplicate staging fallback must reuse the canonical staging helper for the group bounding box');
  assert.doesNotMatch(block, /stagingGap|stageStartZ|stageStartX/,
    'duplicate staging fallback must not keep its own hardcoded staging grid constants');
});

test('STAGING-S1 canonical staging position grounds items and stays outside the trailer width', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const dims = { length: 30, width: 20, height: 40 };
  const staged = PackLibrary.findSafeStagingPosition({ truck }, dims, []);

  assert.equal(staged.position.y, dims.height / 2,
    'staged item center Y must equal half its height (grounded on the floor)');
  assert.ok(staged.position.z > truck.width / 2,
    'staged item must sit outside the trailer width');
});

test('STAGING-S1 staging rows wrap instead of drifting indefinitely in X', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 100, width: 96, height: 96 };
  const dims = { length: 30, width: 20, height: 24 };
  const acceptedAabbs = [];
  const positions = [];
  for (let i = 0; i < 10; i++) {
    const staged = PackLibrary.findSafeStagingPosition({ truck }, dims, acceptedAabbs);
    positions.push(staged.position);
    acceptedAabbs.push(staged.aabb);
  }

  const maxX = Math.max(...positions.map(p => p.x));
  assert.ok(maxX <= truck.length + 0.001,
    'staging columns must stay within the trailer length instead of drifting endlessly in X');

  const rows = new Set(positions.map(p => Math.round(p.z * 1000)));
  assert.ok(rows.size > 1,
    'staging must wrap into additional rows once a row fills up');
});

test('EDITOR drag/drop rechecks wheel-well collision after settle before writing positions', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const finishStart = src.indexOf('function finishDrag()');
  const finishEnd = src.indexOf('\n\n    function resetDrag()', finishStart);
  const finishBlock = finishStart >= 0 && finishEnd > finishStart ? src.slice(finishStart, finishEnd) : '';
  const settleIndex = finishBlock.indexOf('CaseScene.settleY(id)');
  const recheckIndex = finishBlock.indexOf('const check = CaseScene.checkCollision(id, o.position, ignoreSet);', settleIndex);
  const writePrepIndex = finishBlock.indexOf('const nextPositions = new Map();', settleIndex);
  const postSettleBlock = recheckIndex >= 0 && writePrepIndex > recheckIndex
    ? finishBlock.slice(recheckIndex, writePrepIndex)
    : '';

  assert.ok(settleIndex >= 0 && recheckIndex > settleIndex && writePrepIndex > recheckIndex,
    'drag/drop must re-run shared collision validation after gravity settling and before persistence');
  assert.match(postSettleBlock, /settledCollides = settledCollides \|\| check\.collides/,
    'post-settle drag/drop validation must fail on shared collision, including wheel-well blocked bodies');
  assert.match(postSettleBlock, /if \(settledCollides\)[\s\S]*revertGroupToStart\(groupIds, startMap\)[\s\S]*resetDrag\(\);[\s\S]*return;/,
    'post-settle collision must revert the visible drag group and skip persistence');
});

test('PHASE-C2 rear-retention geometry enforces height, full width, adjacency, and step-gap boundaries', async () => {
  const { PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const deck = phc2Aabb(244.8, 268.8, 43.2, 59.2, -48, -30);
  const wall = (id, minX, maxX, minY, maxY, minZ, maxZ, extra = {}) => ({
    instanceId: id,
    aabb: phc2Aabb(minX, maxX, minY, maxY, minZ, maxZ),
    ...extra,
  });
  const evaluate = accepted => PackLib.evaluateFrontOverhangRearRetention(deck, accepted, truck, zones);

  assert.equal(evaluate([]).retained, false, 'no wall rejects the raised-deck candidate');
  assert.equal(evaluate([wall('short', 216, 240, 0, 43.1, -48, -30)]).retained, false,
    'a wall below deckY rejects the candidate');
  assert.equal(evaluate([wall('narrow', 216, 240, 0, 48, -48, -39)]).retained, false,
    'partial candidate-width coverage rejects the candidate');

  const adjacent = evaluate([
    wall('left', 216, 240, 0, 48, -48, -39),
    wall('right', 216, 240, 0, 48, -39, -30),
  ]);
  assert.equal(adjacent.retained, true, 'adjacent walls merge to full width');
  assert.deepEqual(adjacent.retainerIds, ['left', 'right'], 'dependency ids are deterministic');

  const cumulativeGaps = evaluate([
    wall('gap-a', 216, 240, 0, 48, -48, -42.04),
    wall('gap-b', 216, 240, 0, 48, -42, -36.04),
    wall('gap-c', 216, 240, 0, 48, -36, -30),
  ]);
  assert.ok(Math.abs(cumulativeGaps.coveredWidth - 17.92) < 1e-9,
    'separated intervals sum only real coverage');
  assert.equal(cumulativeGaps.retained, false,
    'two 0.04 inch lateral gaps exceed the one final tolerance and reject');

  const touchingAndOverlapping = evaluate([
    wall('touch-a', 216, 240, 0, 48, -48, -42),
    wall('touch-b', 216, 240, 0, 48, -42, -35.5),
    wall('overlap-c', 216, 240, 0, 48, -36, -30),
  ]);
  assert.equal(touchingAndOverlapping.coveredWidth, 18,
    'touching and overlapping intervals merge to the exact union width');
  assert.equal(touchingAndOverlapping.retained, true);

  const finalShortage = evaluate([
    wall('shortage-004', 216, 240, 0, 48, -48, -30.04),
  ]);
  assert.ok(Math.abs(finalShortage.coveredWidth - 17.96) < 1e-9);
  assert.equal(finalShortage.retained, true,
    'one 0.04 inch final shortage passes through the single final tolerance');

  const excessiveShortage = evaluate([
    wall('shortage-010', 216, 240, 0, 48, -48, -30.1),
  ]);
  assert.ok(Math.abs(excessiveShortage.coveredWidth - 17.9) < 1e-9);
  assert.equal(excessiveShortage.retained, false,
    '0.10 inch real shortage exceeds the final tolerance');

  const overlapping = evaluate([
    wall('overlap-a', 216, 240, 0, 48, -48, -38),
    wall('overlap-b', 216, 240, 0, 48, -40, -30),
  ]);
  assert.equal(overlapping.coveredWidth, 18, 'overlapping intervals do not double-count coverage');
  assert.equal(overlapping.retained, true);

  assert.equal(evaluate([wall('gap-004', 215.96, 239.96, 0, 48, -48, -30)]).retained, true,
    '0.04 inch step gap is accepted');
  assert.equal(evaluate([wall('gap-006', 215.94, 239.94, 0, 48, -48, -30)]).retained, false,
    '0.06 inch step gap is rejected');

  const leftCandidate = phc2Aabb(244.8, 268.8, 43.2, 59.2, -48, -39);
  const rightCandidate = phc2Aabb(244.8, 268.8, 43.2, 59.2, -39, -30);
  const leftWall = [wall('left-only', 216, 240, 0, 48, -48, -39)];
  assert.equal(PackLib.evaluateFrontOverhangRearRetention(leftCandidate, leftWall, truck, zones).retained, true);
  assert.equal(PackLib.evaluateFrontOverhangRearRetention(rightCandidate, leftWall, truck, zones).retained, false,
    'an exposed right side cannot borrow left-side coverage');
  assert.equal(evaluate([
    wall('tall-half', 216, 240, 0, 48, -48, -39),
    wall('short-half', 216, 240, 0, 40, -39, -30),
  ]).retained, false, 'mixed tall/short coverage must cross deckY across the complete width');

  const stackedWall = [
    wall('base', 216, 240, 0, 24, -48, -30),
    wall('upper', 216, 240, 24, 48, -48, -30),
  ];
  assert.equal(evaluate(stackedWall).retained, true,
    'an already accepted supported upper wall may cross the deck-height plane');
  assert.equal(evaluate([wall('staged', 216, 240, 0, 48, -48, -30, { placement: 'staged' })]).retained, false);
  assert.equal(evaluate([wall('invalid', 216, 240, 0, 48, -48, -30, { valid: false })]).retained, false,
    'staged and invalid cargo never count');
  assert.equal(PackLib.REAR_RETENTION_MAX_STEP_GAP_INCHES, 0.05);
  assert.equal(PackLib.MIN_REAR_RETENTION_WIDTH_FRACTION, 1);
});

test('PHASE-C2 buildDeckRetentionWall only stacks a wall segment when the stack phase is enabled', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  const start = src.indexOf('function buildDeckRetentionWall(');
  const end = src.indexOf('\nfunction frontOverhangRetentionPlacements', start);
  assert.ok(start >= 0 && end > start, 'buildDeckRetentionWall must exist');
  const block = src.slice(start, end);

  assert.match(block,
    /function buildDeckRetentionWall\(output, packed, itemsById, retentionContext, budget, stackPhaseEnabled = true\)/,
    'buildDeckRetentionWall must accept the stack-phase flag (defaulting to enabled for existing callers)');
  assert.match(block,
    /if \(!onFloor\) \{\s*\n(?:\s*\/\/.*\n)*\s*if \(!stackPhaseEnabled\) continue;\s*\n\s*if \(!supportsCandidate\(aabb, packed, item\)\) continue;\s*\n\s*\}/,
    'a non-floor (stacked) wall segment must be rejected outright when stackPhaseEnabled is false, ' +
    'before the ordinary support check ever runs');

  const callSiteSrc = src.slice(end);
  assert.match(callSiteSrc, /buildDeckRetentionWall\(output, packed, itemsById, retentionContext, budget, stackPhaseEnabled\)/,
    'solveAutoPack must pass its own stackPhaseEnabled through to buildDeckRetentionWall');
});

test('PHASE-C2 Front Overhang deck-fill retry is not skipped when stacking is disabled', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  const stackBatchStart = src.indexOf('if (stackPhaseEnabled && stackQueue.length && !budget.expired())');
  assert.ok(stackBatchStart >= 0, 'the stack-phase batch gate must exist');
  const stackBatchEnd = src.indexOf('\n  }', stackBatchStart);
  const stackBatchBlock = src.slice(stackBatchStart, stackBatchEnd);
  assert.equal(stackBatchBlock.includes('placeFrontOverhangDeckFill'), false,
    'placeFrontOverhangDeckFill must not be nested inside the stackPhaseEnabled batch gate — deck-fill is ' +
    'raised FLOOR space, not stacking, and must still run when floor-first disables stacking');

  const afterBatch = src.slice(stackBatchEnd, stackBatchEnd + 1200);
  assert.match(afterBatch, /if \(stackQueue\.length && !budget\.cleanupExpired\(\)\) \{\s*\n\s*const deckFill = placeFrontOverhangDeckFill\(/,
    'the deck-fill retry against the remaining stack queue must run unconditionally (gated only by its own ' +
    'pre-existing conditions, not by stackPhaseEnabled)');
});

test('PHASE-C2 accepted walls emit dependencies and animate before retained deck cargo', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truth = await threeOrientedTruth();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = [
    { instanceId: 'wall', caseId: 'wall', dims: { l: 24, w: 18, h: 48 }, orientationLock: 'upright', canFlip: false, weight: 100, noStackOnTop: true },
    { instanceId: 'deck', caseId: 'deck', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'upright', canFlip: false, weight: 30 },
  ];
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.deepEqual(result.retentionDependencies.get('deck'), ['wall'], 'solver emits exact retainer dependency ids');
  assert.equal(result.retentionDependencies.has('wall'), false, 'a tall noStackOnTop item may itself act as a wall');
  const wallDims = result.orientedDims.get('wall');
  const deckDims = result.orientedDims.get('deck');
  const wallAabb = Solver.getAabb(result.placements.get('wall'), { l: wallDims.length, w: wallDims.width, h: wallDims.height });
  const deckAabb = Solver.getAabb(result.placements.get('deck'), { l: deckDims.length, w: deckDims.width, h: deckDims.height });
  assert.deepEqual(wallAabb, phc2Aabb(222, 240, 0, 48, -48, -24), 'retaining wall exact AABB');
  assert.deepEqual(deckAabb, phc2Aabb(244.8, 268.8, 43.2, 59.2, -48, -30), 'retained deck exact AABB');
  assert.deepEqual(wallDims, truth({ length: 24, width: 18, height: 48 }, result.rotations.get('wall')));
  assert.deepEqual(deckDims, truth({ length: 24, width: 18, height: 16 }, result.rotations.get('deck')));
  phb2AssertSafe(Solver, PackLib, result, zones, 'C2 wall/deck', truck);

  const caseIds = new Map(items.map(item => [item.instanceId, item.caseId]));
  const batches = Engine.buildPlacementAnimationBatches(
    result.placements,
    result.orientedDims,
    caseIds,
    4,
    { frontSurfaceFirst: true, zones, retentionDependencies: result.retentionDependencies }
  );
  const animationOrder = batches.flat().map(([id]) => id);
  assert.ok(animationOrder.indexOf('wall') < animationOrder.indexOf('deck'), 'wall animates before dependent deck cargo');
  const repeat = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  assert.equal(phcResultBytes(repeat), phcResultBytes(result), 'repeat AutoPack is byte-identical');
  assert.equal(JSON.stringify([...repeat.retentionDependencies]), JSON.stringify([...result.retentionDependencies]));
});

test('PHASE-C2 empty Front Overhang deck stays unused for 24x18 × 6/20/40/100 and 42x10', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truth = await threeOrientedTruth();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const blockedZones = PackLib.getFrontBonusBlockedZones(truck);
  const mainZone = zones.find(zone => zone.min.x === 0 && zone.min.y === 0);
  const deckZone = zones.find(zone => zone.min.x === 240 && zone.min.y === 43.2);
  assert.deepEqual(mainZone, {
    min: { x: 0, y: 0, z: -48 }, max: { x: 240, y: 96, z: 48 },
  }, 'real main-floor zone coordinates');
  assert.deepEqual(deckZone, {
    min: { x: 240, y: 43.2, z: -48 }, max: { x: 268.8, y: 96, z: 48 },
  }, 'real raised-deck zone coordinates');

  const fixtures = [
    { label: '24x18/6', count: 6, dims: { l: 24, w: 18, h: 16 } },
    { label: '24x18/20', count: 20, dims: { l: 24, w: 18, h: 16 } },
    { label: '24x18/40', count: 40, dims: { l: 24, w: 18, h: 16 } },
    { label: '24x18/100', count: 100, dims: { l: 24, w: 18, h: 16 } },
    { label: '42x10/100', count: 100, dims: { l: 42, w: 10, h: 16 } },
  ];

  for (const fixture of fixtures) {
    const itemSpec = {
      caseId: 'A', dims: fixture.dims, orientationLock: 'any', canFlip: false,
      weight: 30, maxStackCount: 2,
    };
    const items = Array.from({ length: fixture.count }, (_, index) => ({ ...itemSpec, instanceId: `i${index}` }));
    const specsById = new Map(items.map(item => [item.instanceId, item]));
    const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const placementSnapshot = JSON.stringify([...result.placements]);
    const rotationSnapshot = JSON.stringify([...result.rotations]);

    assert.ok(phcFloorTable(Solver, result, zones).every(row => row.surface.startsWith('0|')),
      `${fixture.label}: every floor placement stays on the main floor without a retaining wall`);
    assert.equal(phb2SequentialForwardViolation(Solver, result, zones, specsById), null,
      `${fixture.label}: each same-layer wall completes before moving rearward`);
    assert.equal(result.retentionDependencies.size, 0,
      `${fixture.label}: no invalid deck dependency is emitted`);
    assert.deepEqual(result.unpacked, [], `${fixture.label}: every case resolves`);
    phb2AssertSafe(Solver, PackLib, result, zones, fixture.label, truck);
    phb2AssertDirectStackLimit(Solver, result, 2, fixture.label);

    const legal = Solver.buildOrientationCandidates(itemSpec.dims, itemSpec);
    for (const [id, dims] of result.orientedDims) {
      const rotation = result.rotations.get(id);
      const position = result.placements.get(id);
      const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
      assert.equal(zones.filter(zone => Solver.isAabbContainedInAnyZone(aabb, [zone])).length, 1,
        `${fixture.label}: ${id} is wholly contained in one compatible zone (no seam crossing)`);
      assert.equal(blockedZones.some(zone => Solver.aabbsOverlap(aabb, zone)), false,
        `${fixture.label}: ${id} never intersects the cab void`);
      assert.deepEqual(dims, truth({
        length: fixture.dims.l, width: fixture.dims.w, height: fixture.dims.h,
      }, rotation), `${fixture.label}: ${id} THREE dimensions`);
      assert.ok(legal.some(candidate =>
        candidate.l === dims.length && candidate.w === dims.width && candidate.h === dims.height &&
        candidate.rotation.x === rotation.x && candidate.rotation.y === rotation.y && candidate.rotation.z === rotation.z
      ), `${fixture.label}: ${id} orientation policy`);
    }

    const caseIds = new Map(items.map(item => [item.instanceId, item.caseId]));
    const animationOptions = {
      frontSurfaceFirst: true,
      zones,
      retentionDependencies: result.retentionDependencies,
    };
    const batches = Engine.buildPlacementAnimationBatches(
      result.placements, result.orientedDims, caseIds, 4, animationOptions
    );
    const animationRecords = phb2AssertAnimationBatches(
      Solver, result, caseIds, batches, `${fixture.label}/animation`
    );
    const zoneFloorRecords = animationRecords.filter(record => zones.some(zone =>
      Solver.isAabbContainedInAnyZone(record.aabb, [zone]) &&
      Math.abs(record.aabb.min.y - zone.min.y) <= 0.05
    ));
    for (let index = 1; index < zoneFloorRecords.length; index++) {
      assert.ok(zoneFloorRecords[index].aabb.max.x <= zoneFloorRecords[index - 1].aabb.max.x + 0.05,
        `${fixture.label}: animation loads deck/main zone floors high-X first`);
    }
    assert.equal(JSON.stringify([...result.placements]), placementSnapshot,
      `${fixture.label}: animation does not mutate solver placements`);
    assert.equal(JSON.stringify([...result.rotations]), rotationSnapshot,
      `${fixture.label}: animation does not mutate solver rotations`);

    const secondResult = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
    const secondBatches = Engine.buildPlacementAnimationBatches(
      secondResult.placements, secondResult.orientedDims, caseIds, 4, animationOptions
    );
    assert.equal(JSON.stringify([...secondResult.placements]), placementSnapshot,
      `${fixture.label}: second AutoPack has identical final placements`);
    assert.equal(JSON.stringify(secondBatches), JSON.stringify(batches),
      `${fixture.label}: second AutoPack has identical animation order`);
  }
});

test('PHASE-C2 ordinary, filler, forced-lane, repeated, and mixed cargo use only eligible surfaces', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const fixtures = [
    { label: 'ordinary', item: { instanceId: 'ordinary', caseId: 'ordinary', dims: { l: 24, w: 18, h: 16 }, weight: 30 } },
    { label: 'filler', item: { instanceId: 'filler', caseId: 'filler', dims: { l: 20, w: 10, h: 10 }, weight: 20 } },
    { label: 'forced-lane', item: { instanceId: 'lane', caseId: 'lane', dims: { l: 24, w: 18, h: 16 }, weight: 30, laneItem: true } },
  ];
  for (const fixture of fixtures) {
    const item = { orientationLock: 'any', canFlip: false, ...fixture.item };
    const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: [item] });
    const position = result.placements.get(item.instanceId);
    const dims = result.orientedDims.get(item.instanceId);
    const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
    assert.ok(aabb.max.x <= 240 + 0.05 && Math.abs(aabb.min.y) <= 0.05,
      `${fixture.label}: an empty raised deck is ineligible`);
    assert.equal(PackLib.isAabbContainedInAnyZone(aabb, zones), true, `${fixture.label}: contained in one usable zone`);
  }

  const repeatedItems = Array.from({ length: 8 }, (_, index) => ({
    instanceId: `repeated${index}`, caseId: 'repeated', dims: { l: 42, w: 10, h: 16 },
    orientationLock: 'any', canFlip: false, weight: 30,
  }));
  const repeated = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: repeatedItems });
  assert.ok(phcFloorTable(Solver, repeated, zones).every(row => row.surface.startsWith('0|')),
    'repeated-grid cross-surface gate skips the unretained deck');

  const deckFit = {
    caseId: 'fit', dims: { l: 24, w: 18, h: 16 }, orientationLock: 'any', canFlip: false,
    weight: 100, maxStackCount: 2,
  };
  const deckTooTall = {
    caseId: 'tall', dims: { l: 24, w: 18, h: 60 }, orientationLock: 'upright', canFlip: false,
    weight: 30, maxStackCount: 2,
  };
  const items = [
    ...Array.from({ length: 3 }, (_, index) => ({ ...deckFit, instanceId: `fit${index}` })),
    ...Array.from({ length: 3 }, (_, index) => ({ ...deckTooTall, instanceId: `tall${index}` })),
  ];
  const mixed = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  for (const id of ['fit0', 'fit1', 'fit2']) {
    const pos = mixed.placements.get(id); const dims = mixed.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height });
    const onDeck = aabb.min.x >= 240 - 0.05 && Math.abs(aabb.min.y - 43.2) <= 0.05;
    if (onDeck) {
      assert.ok((mixed.retentionDependencies.get(id) || []).some(retainerId => retainerId.startsWith('tall')),
        `${id}: deck cargo is retained by an accepted tall wall`);
    }
  }
  for (const id of ['tall0', 'tall1', 'tall2']) {
    const pos = mixed.placements.get(id); const dims = mixed.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height });
    assert.ok(aabb.max.x <= 240 + 0.05 && Math.abs(aabb.min.y) <= 0.05,
      `${id}: case too tall for deck continues on main floor`);
  }
  phb2AssertSafe(Solver, PackLib, mixed, zones, 'mixed deck fit/too tall', truck);
});

test('placement-settle-0 pack-library exports PLACEMENT_EPS, MIN_SUPPORT_FRACTION, computeSupportFraction', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(typeof PackLibrary.PLACEMENT_EPS, 'number',
    'PLACEMENT_EPS must be a named number export');
  assert.equal(PackLibrary.PLACEMENT_EPS, 0.001,
    'PLACEMENT_EPS must be 0.001 to match existing solver and pack-library overlap checks');
  assert.equal(typeof PackLibrary.MIN_SUPPORT_FRACTION, 'number',
    'MIN_SUPPORT_FRACTION must be a named number export');
  assert.equal(PackLibrary.MIN_SUPPORT_FRACTION, 0.5,
    'MIN_SUPPORT_FRACTION must be 0.5 to match autopack-solver requirement');
  assert.equal(typeof PackLibrary.computeSupportFraction, 'function',
    'computeSupportFraction must be a named function export');
});

test('placement-settle-0 computeSupportFraction full footprint support returns 1', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // 20×20 candidate (inches) resting exactly on a 20×20 supporter
  const candidate = { min: { x: -10, y: 10, z: -10 }, max: { x: 10, y: 20, z: 10 } };
  const supporter = { min: { x: -10, y: 0,  z: -10 }, max: { x: 10, y: 10, z: 10 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [supporter]);
  assert.equal(frac, 1,
    'full footprint overlap must return fraction 1');
});

test('placement-settle-0 computeSupportFraction half support equals 0.5', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // 20×20 candidate; supporter covers only the left 10×20 half
  const candidate = { min: { x: 0, y: 10, z: -10 }, max: { x: 20, y: 20, z: 10 } };
  const supporter = { min: { x: 0, y: 0,  z: -10 }, max: { x: 10, y: 10, z: 10 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [supporter]);
  assert.ok(Math.abs(frac - 0.5) < 1e-9,
    'half-footprint overlap must return fraction 0.5');
});

test('placement-settle-0 computeSupportFraction tiny corner is below MIN_SUPPORT_FRACTION', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // 20×20 candidate; supporter overlaps only a 1×1 corner (1/400 = 0.25% of footprint)
  const candidate = { min: { x: 0,  y: 10, z: 0  }, max: { x: 20, y: 20, z: 20 } };
  const supporter = { min: { x: 19, y: 0,  z: 19 }, max: { x: 21, y: 10, z: 21 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [supporter]);
  assert.ok(frac < PackLibrary.MIN_SUPPORT_FRACTION,
    'tiny 1×1 corner overlap on 20×20 footprint must be below MIN_SUPPORT_FRACTION');
});

test('placement-settle-0 computeSupportFraction no supporters returns 0', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const candidate = { min: { x: -10, y: 10, z: -10 }, max: { x: 10, y: 20, z: 10 } };
  assert.equal(PackLibrary.computeSupportFraction(candidate, []), 0,
    'empty supporter list must return fraction 0');
  assert.equal(PackLibrary.computeSupportFraction(candidate, null), 0,
    'null supporter list must return fraction 0 (floor fallback handled by caller)');
});

test('placement-settle-0 computeSupportFraction ignores Y-misaligned supporters', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Candidate bottom at y=10; supporter top at y=5 (5 inches gap — not flush)
  const candidate = { min: { x: -10, y: 10, z: -10 }, max: { x: 10, y: 20, z: 10 } };
  const floatingBelow = { min: { x: -10, y: 0,  z: -10 }, max: { x: 10, y: 5,  z: 10 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [floatingBelow]);
  assert.equal(frac, 0,
    'supporter whose top is not flush with candidate bottom must be ignored');
});

test('placement-settle-1 computeSettleY is exported from editor-screen', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(typeof EditorScreen.computeSettleY, 'function',
    'computeSettleY must be a named export of editor-screen');
});

test('placement-settle-1 computeSettleY with no other boxes settles to floor', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };
  const y = EditorScreen.computeSettleY(half, 0, 0, [], 0.5);
  assert.equal(y, 12,
    'floor fallback must equal halfWorld.y when there are no supporters');
});

test('placement-settle-1 computeSettleY full support settles on top of box', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };
  // Supporter: wide box with top at y=24
  const supporter = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 24, z: 24 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [supporter], 0.5);
  assert.equal(y, 36,
    'candidate center must be supporter.max.y + halfY when fully supported');
});

test('placement-settle-1 computeSettleY half support is accepted', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  // Candidate: 24×24 footprint centered at x=0
  const half = { x: 12, y: 12, z: 12 };
  // Supporter covers exactly the left half (50% of candidate footprint)
  const halfSupporter = { min: { x: -12, y: 0, z: -12 }, max: { x: 0, y: 24, z: 12 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [halfSupporter], 0.5);
  assert.equal(y, 36,
    '50% footprint support must be accepted and settle on top of box');
});

test('placement-settle-1 computeSettleY tiny corner support is rejected and falls to floor', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  // Candidate: 24×24 footprint centered at x=0, z=0
  const half = { x: 12, y: 12, z: 12 };
  // Tiny 1×1 corner overlap at the edge — well below 50%
  const tinyCorner = { min: { x: 11.5, y: 0, z: 11.5 }, max: { x: 13, y: 24, z: 13 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [tinyCorner], 0.5);
  assert.equal(y, 12,
    'tiny corner overlap must be rejected; candidate must fall to floor (halfY)');
});

test('placement-settle-1 computeSettleY picks highest valid support among multiple boxes', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };
  const low  = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 12, z: 24 } }; // top at 12
  const high = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 24, z: 24 } }; // top at 24
  const y = EditorScreen.computeSettleY(half, 0, 0, [low, high], 0.5);
  assert.equal(y, 36,
    'must pick the highest valid surface (top=24 + halfY=12 = 36)');
});

test('placement-settle-1 computeSettleY result is never below floor', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  // Supporter below floor level (top at y=-5) — should be ignored; candidate falls to floor
  const half = { x: 12, y: 12, z: 12 };
  const belowFloor = { min: { x: -24, y: -20, z: -24 }, max: { x: 24, y: -5, z: 24 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [belowFloor], 0.5);
  assert.ok(y >= half.y,
    'settled Y must never be below floor (halfY) even with below-floor supporters');
});

test('placement-settle-1 editor-screen settleY uses MIN_SUPPORT_FRACTION from pack-library', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /import\s*\{[^}]*MIN_SUPPORT_FRACTION[^}]*\}\s*from\s*['"]\.\.\/services\/pack-library\.js['"]/,
    'editor-screen must import MIN_SUPPORT_FRACTION from pack-library');
  assert.match(src, /MIN_SUPPORT_FRACTION/,
    'settleY must reference MIN_SUPPORT_FRACTION (not a magic 0.5 literal)');
  assert.match(src, /export function computeSettleY\(/,
    'computeSettleY must be an exported named function');
  assert.match(src, /return computeSettleY\(/,
    'inner settleY must delegate to computeSettleY');
});

test('placement-settle-1 rotate/flip paths still call settleY before saving position', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  // rotateSelection block: settleY must be called before support-revalidating persistence.
  const rotateStart = src.indexOf('function rotateSelection(');
  assert.ok(rotateStart >= 0, 'rotateSelection must exist');
  const rotateEnd = src.indexOf('\n    function ', rotateStart + 1);
  const rotateBlock = rotateEnd > rotateStart ? src.slice(rotateStart, rotateEnd) : src.slice(rotateStart);
  const settlePos = rotateBlock.indexOf('settleY(');
  const savePos = rotateBlock.indexOf('commitCasesWithManualRevalidation(');
  assert.ok(settlePos >= 0, 'rotateSelection must call settleY');
  assert.ok(savePos >= 0, 'rotateSelection must commit through manual support revalidation');
  assert.ok(settlePos < savePos,
    'rotateSelection must call settleY before support-revalidating persistence');
});

// C2 final-state assessment: pure inputs, independent of legacy workflow policy.
const c2Truck = { length: 100, width: 100, height: 100, shapeMode: 'rect' };
const c2Case = (id, dims = [20, 20, 10], weight = 10, extra = {}) => ({
  id, dimensions: { length: dims[0], width: dims[1], height: dims[2] },
  weight, shape: 'box', orientationLock: 'any', ...extra,
});
const c2Instance = (id, caseId, x = 50, y = 5, z = 0, extra = {}) => ({
  id, caseId, placement: 'packed',
  transform: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 } }, ...extra,
});
const c2Subject = (cases, instances, extra = {}) => ({ cases, instances, targetSpace: c2Truck, ...extra });
const c2Floor = (extra = {}) => c2Subject([c2Case('box')], [c2Instance('box-1', 'box')], extra);
const c2Body = (result, id) => result.measurements.bodies.find(b => b.id === id);
const c2Hard = (result, property, id) => result.hard.find(f => f.property === property && (id === undefined || f.subject === id));
const c2Gate = (result, property, id) => result.gates.find(f => f.property === property && (id === undefined || f.subject === id));
const c2Near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
const c2Stack = (baseExtra = {}, childWeight = 10) => c2Subject([
  c2Case('base', [20, 20, 10], 100, baseExtra), c2Case('child', [10, 10, 10], childWeight),
], [c2Instance('base-1', 'base'), c2Instance('child-1', 'child', 50, 15)]);
const c2Shifted = (upperX, upperWeight) => c2Subject([
  c2Case('pedestal', [12, 20, 10], 1000), c2Case('beam', [20, 20, 10], 10), c2Case('upper', [4, 10, 10], upperWeight),
], [c2Instance('pedestal-1', 'pedestal', 45), c2Instance('beam-1', 'beam', 50, 15), c2Instance('upper-1', 'upper', upperX, 25)]);
const c2Wells = { length: 110, width: 40, height: 40, shapeMode: 'wheelWells',
  shapeConfig: { wellOffsetFromRear: 30, wellLength: 30, wellWidth: 10, wellHeight: 5 } };
const c2Front = { length: 100, width: 40, height: 60, shapeMode: 'frontBonus',
  shapeConfig: { bonusLength: 40, bonusHeight: 20 } };
const c2Retained = (height = 30, gap = 0) => c2Subject([
  c2Case('retainer', [20, 10, height], 100), c2Case('deck', [20, 20, 10], 10),
], [c2Instance('left', 'retainer', 90, height / 2, -5 - gap),
  c2Instance('right', 'retainer', 90, height / 2, 5 + gap), c2Instance('deck-1', 'deck', 120, 25)], { targetSpace: c2Front });
const c2Freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(c2Freeze); Object.freeze(value); }
  return value;
};

test('C2 floor contact is fully measured, centered and VALID', () => {
  const result = assessPhysicalSubject(c2Floor());
  assert.equal(result.primary, 'VALID');
  const body = c2Body(result, 'box-1');
  assert.equal(body.support.area, 400);
  assert.equal(body.support.coverage, 1);
  assert.equal(body.support.bearingPlane, 0);
  assert.equal(body.own.margin, 10);
  assert.equal(body.pathOutcome, 'PASS');
  assert.equal(result.eligibility.state, 'eligible');
});

test('C2 own-centered support outside the actual hull is HARD failure', () => {
  const subject = c2Stack();
  subject.instances[1].transform.position.x = 64;
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Hard(result, 'support.own-centered-hull', 'child-1').outcome, 'FAIL');
  assert.equal(result.primary, 'INVALID');
});

test('C2 hull boundary requires a strictly positive numerical margin', () => {
  const hull = supportConvexHull([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]);
  assert.deepEqual(supportHullMargin(hull, { x: 0, z: 5 }), { margin: 0, inside: false });
  assert.equal(supportHullMargin(hull, { x: 0.5e-9, z: 5 }).inside, false);
  assert.equal(supportHullMargin(hull, { x: 2e-9, z: 5 }).inside, true);
  const subject = c2Stack();
  subject.instances[1].transform.position.x = 60;
  assert.equal(c2Hard(assessPhysicalSubject(subject), 'support.own-centered-hull', 'child-1').outcome, 'FAIL');
});

test('C2 overlapping and duplicate patches use exact union rather than summed area', () => {
  const patches = [{ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, { minX: 5, maxX: 15, minZ: 0, maxZ: 10 }];
  assert.equal(measureContactUnion([...patches, patches[0]]), 150);
  assert.equal(measureContactUnion([{ minX: 0, maxX: 0, minZ: 0, maxZ: 10 }]), 0);
  assert.equal(supportHullMargin(supportConvexHull([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]), { x: 1, z: 0 }).inside, false);
});

test('C2 a bridge spans separate contacts while its union remains sparse', () => {
  const subject = c2Subject([c2Case('support', [4, 20, 10], 1000), c2Case('beam', [30, 20, 10], 10)], [
    c2Instance('left', 'support', 42), c2Instance('right', 'support', 58), c2Instance('beam-1', 'beam', 50, 15),
  ]);
  const result = assessPhysicalSubject(subject), beam = c2Body(result, 'beam-1');
  assert.equal(c2Hard(result, 'support.own-centered-hull', 'beam-1').outcome, 'PASS');
  c2Near(beam.support.coverage, 8 / 30);
  assert.equal(beam.support.patches.length, 2);
  assert.equal(beam.own.inside, true);
  assert.ok(result.unverified.some(f => f.property === 'bridge-cantilever-strength' && f.subject === 'beam-1'));
});

test('C2 below 50 percent can be physically VALID but operationally blocked', () => {
  const result = assessPhysicalSubject(c2Subject([c2Case('base', [12, 20, 10], 100), c2Case('beam', [30, 20, 10])], [
    c2Instance('base-1', 'base'), c2Instance('beam-1', 'beam', 50, 15),
  ]));
  assert.equal(c2Body(result, 'beam-1').support.coverage, 0.4);
  assert.equal(result.primary, 'VALID');
  assert.equal(c2Gate(result, 'support50', 'beam-1').outcome, 'FAIL');
  assert.equal(result.eligibility.state, 'blocked');
});

test('C2 above 50 percent does not rescue a failing combined loaded hull', () => {
  // A centered rectangle cannot have >50% contact entirely on one side of its
  // center. Descendant eccentric load gives the independent failing-hull case.
  const result = assessPhysicalSubject(c2Shifted(58, 100));
  assert.equal(c2Body(result, 'beam-1').support.coverage, 0.55);
  assert.equal(c2Gate(result, 'support50', 'beam-1').outcome, 'PASS');
  assert.equal(c2Hard(result, 'support.own-centered-hull', 'beam-1').outcome, 'PASS');
  assert.equal(c2Hard(result, 'support.loaded-resultant', 'beam-1').outcome, 'FAIL');
  assert.equal(result.primary, 'INVALID');
});

test('C2 different bearing planes and a real vertical gap never combine contacts', () => {
  const box = { min: { x: 0, y: 10, z: 0 }, max: { x: 10, y: 20, z: 10 } };
  const support = measureSupportContacts(box, [
    { supportId: 'same', y: 10, minX: 0, maxX: 2, minZ: 0, maxZ: 10 },
    { supportId: 'low', y: 9.99, minX: 2, maxX: 8, minZ: 0, maxZ: 10 },
    { supportId: 'high', y: 10.01, minX: 8, maxX: 10, minZ: 0, maxZ: 10 },
  ]);
  assert.equal(support.area, 20);
  assert.deepEqual(support.patches.map(p => p.supportId), ['same']);
  const subject = c2Stack();
  subject.instances[1].transform.position.y += 0.001;
  assert.equal(c2Hard(assessPhysicalSubject(subject), 'support.path', 'child-1').outcome, 'FAIL');
});

test('C2 a multi-level support path reaches a real rigid surface', () => {
  const subject = c2Stack();
  subject.cases.push(c2Case('top', [5, 5, 10], 1));
  subject.instances.push(c2Instance('top-1', 'top', 50, 25));
  const result = assessPhysicalSubject(subject);
  assert.equal(result.primary, 'VALID');
  assert.ok(result.measurements.supportGraph.paths.every(p => p.outcome === 'PASS'));
  assert.equal(c2Body(result, 'base-1').load.demand, 111);
});

test('C2 a floating support cannot establish a path for its child', () => {
  const subject = c2Stack();
  subject.instances.forEach(i => { i.transform.position.y += 10; });
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Hard(result, 'support.path', 'base-1').outcome, 'FAIL');
  assert.equal(c2Hard(result, 'support.path', 'child-1').outcome, 'FAIL');
});

test('C2 unresolved support geometry stays incomplete instead of proving empty space', () => {
  const subject = c2Stack();
  subject.cases[0].dimensions.height = null;
  const result = assessPhysicalSubject(subject);
  assert.equal(result.primary, 'INCOMPLETE');
  assert.equal(c2Hard(result, 'support.path', 'child-1').outcome, 'UNRESOLVED');
  assert.equal(result.measurements.mass.total, 110, 'known mass is independent of missing geometry');
  assert.equal(result.measurements.cog.complete, false);
  assert.equal(result.identity, null);
});

test('C2 cycles cannot qualify as support and only actual cycle members are labeled', () => {
  const graph = assessSupportPaths(['ancestor', 'a', 'b'].map(id => ({ id, supportOutcome: 'PASS' })), [
    { from: 'ancestor', to: 'a', area: 1 }, { from: 'a', to: 'b', area: 1 }, { from: 'b', to: 'a', area: 1 },
  ]);
  assert.deepEqual(graph.cycles, ['a', 'b']);
  assert.ok(graph.paths.every(p => p.outcome === 'FAIL'));
});

test('C2 cargo identity cannot collide with generated rigid-support identity', () => {
  const subject = c2Floor(); subject.instances[0].id = 'rigid:0';
  const result = assessPhysicalSubject(subject), graph = result.measurements.supportGraph;
  assert.equal(result.primary, 'VALID');
  assert.equal(new Set(graph.nodes.map(n => n.id)).size, graph.nodes.length);
  assert.notEqual(c2Body(result, 'rigid:0').load.reactions[0].supportId, 'rigid:0');
});

for (const restriction of [{ noStackOnTop: true }, { stackable: false }]) {
  test(`C2 actual positive child contact honors ${Object.keys(restriction)[0]}`, () => {
    const result = assessPhysicalSubject(c2Stack(restriction));
    assert.equal(c2Hard(result, 'handling.no-top', 'base-1').outcome, 'FAIL');
    assert.equal(result.primary, 'INVALID');
  });
}

test('C2 vertical proximity without contact does not create a no-top violation', () => {
  const subject = c2Stack({ noStackOnTop: true }); subject.instances[1].transform.position.y += 0.01;
  assert.equal(c2Hard(assessPhysicalSubject(subject), 'handling.no-top', 'base-1'), undefined);
});

test('C2 maxStackCount counts direct children, not total tower levels', () => {
  const subject = c2Stack({ maxStackCount: 1 });
  subject.cases.push(c2Case('top', [5, 5, 10], 1)); subject.instances.push(c2Instance('top-1', 'top', 50, 25));
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Hard(result, 'handling.direct-child-count', 'base-1').outcome, 'PASS');
  assert.equal(c2Hard(result, 'handling.direct-child-count', 'base-1').evidence.directCount, 1);
});

test('C2 two actual direct children exceed one while zero remains unrestricted', () => {
  const subject = c2Stack({ maxStackCount: 1 });
  subject.instances[1].transform.position.x = 45;
  subject.instances.push(c2Instance('child-2', 'child', 55, 15));
  assert.equal(c2Hard(assessPhysicalSubject(subject), 'handling.direct-child-count', 'base-1').outcome, 'FAIL');
  subject.cases[0].maxStackCount = 0;
  assert.equal(c2Hard(assessPhysicalSubject(subject), 'handling.direct-child-count', 'base-1').outcome, 'PASS');
});

test('C2 all known mass yields complete total, CoG and transmitted load', () => {
  const result = assessPhysicalSubject(c2Stack());
  assert.deepEqual(result.measurements.mass, { complete: true, knownSubtotal: 110, total: 110, units: 'lb' });
  assert.equal(result.measurements.cog.complete, true);
  c2Near(result.measurements.cog.value.y, 650 / 110);
  assert.equal(c2Body(result, 'base-1').load.massComplete, true);
  assert.equal(c2Body(result, 'base-1').load.demand, 110);
});

test('C2 one null contributor leaves subtotal separate and never substitutes zero', () => {
  const result = assessPhysicalSubject(c2Stack({}, null));
  assert.equal(result.primary, 'INCOMPLETE');
  assert.deepEqual(result.measurements.mass, { complete: false, knownSubtotal: 100, total: null, units: 'lb' });
  assert.equal(result.measurements.cog.value, null);
  assert.equal(c2Body(result, 'base-1').load.demand, null);
  assert.equal(c2Body(result, 'base-1').load.payload, null);
  assert.equal(c2Hard(result, 'support.own-centered-hull', 'base-1').outcome, 'PASS');
  assert.equal(c2Hard(result, 'support.loaded-resultant', 'base-1').outcome, 'UNRESOLVED');
});

test('C2 a single support receives the full known load and both moments', () => {
  const result = assessPhysicalSubject(c2Stack()), load = c2Body(result, 'base-1').load;
  assert.equal(load.reactions.length, 1);
  assert.equal(load.reactions[0].force, 110);
  c2Near(load.reactions[0].momentX, 5500);
  c2Near(load.reactions[0].momentZ, 0);
});

test('C2 two determinate supports conserve force and moments without an equal split assumption', () => {
  const result = solveContactReactions(100, { x: 2, z: 0 }, [{ supportId: 'left', x: 0, z: 0 }, { supportId: 'right', x: 10, z: 0 }]);
  assert.equal(result.outcome, 'PASS'); assert.equal(result.determined, true);
  c2Near(result.reactions[0].force, 80); c2Near(result.reactions[1].force, 20);
  c2Near(result.reactions.reduce((s, r) => s + r.force, 0), 100);
  c2Near(result.reactions.reduce((s, r) => s + r.momentX, 0), 200);
});

test('C2 three noncollinear point supports have a determined balanced solution', () => {
  const result = solveContactReactions(100, { x: 2, z: 3 }, [
    { supportId: 'a', x: 0, z: 0 }, { supportId: 'b', x: 10, z: 0 }, { supportId: 'c', x: 0, z: 10 },
  ]);
  assert.equal(result.determined, true);
  result.reactions.forEach((r, i) => c2Near(r.force, [50, 20, 30][i]));
  c2Near(result.reactions.reduce((s, r) => s + r.momentZ, 0), 300);
});

test('C2 three collinear supports preserve indeterminate ranges and never invent equal loads', () => {
  const result = solveContactReactions(90, { x: 5, z: 0 }, [
    { supportId: 'a', x: 0, z: 0 }, { supportId: 'b', x: 5, z: 0 }, { supportId: 'c', x: 10, z: 0 },
  ]);
  assert.equal(result.outcome, 'PASS'); assert.equal(result.determined, false);
  assert.ok(result.reactions.every(r => r.force === null));
  assert.deepEqual(result.reactions[1].bounds.force, { min: 0, max: 90 });
  assert.deepEqual(result.reactions[0].bounds.force, { min: 0, max: 45 });
});

test('C2 finite patches return admissible per-support ranges, not area-proportional loads', () => {
  const result = solveContactReactions(100, { x: 5, z: 0 }, [
    { supportId: 'a', x: 0, z: -1 }, { supportId: 'a', x: 2, z: 1 },
    { supportId: 'a', x: 0, z: 1 }, { supportId: 'a', x: 2, z: -1 },
    { supportId: 'b', x: 8, z: -1 }, { supportId: 'b', x: 10, z: 1 },
    { supportId: 'b', x: 8, z: 1 }, { supportId: 'b', x: 10, z: -1 },
  ]);
  assert.equal(result.outcome, 'PASS'); assert.equal(result.determined, false);
  assert.ok(result.reactions.every(r => r.force === null && r.bounds.force.min < r.bounds.force.max));
});

test('C2 indeterminate descendant reactions propagate uncertainty despite complete source mass', () => {
  const result = assessPhysicalSubject(c2Subject([c2Case('support', [4, 20, 10], 1), c2Case('beam', [30, 20, 10], 10)], [
    c2Instance('left', 'support', 42), c2Instance('right', 'support', 58), c2Instance('beam-1', 'beam', 50, 15),
  ]));
  assert.equal(result.measurements.mass.total, 12);
  assert.equal(result.primary, 'INCOMPLETE');
  const reactions = c2Body(result, 'beam-1').load.reactions;
  assert.ok(reactions.every(r => r.force === null && r.bounds.force.max < 10), 'do not duplicate full load onto both supports');
  assert.equal(c2Body(result, 'left').load.resultant, null);
  assert.equal(c2Hard(result, 'support.loaded-resultant', 'left').outcome, 'UNRESOLVED');
  assert.equal(c2Hard(result, 'support.own-centered-hull', 'left').outcome, 'PASS');
});

test('C2 impossible nonnegative equilibrium fails instead of assigning negative reactions', () => {
  assert.equal(solveContactReactions(100, { x: -1, z: 0 }, [
    { supportId: 'a', x: 0, z: 0 }, { supportId: 'b', x: 10, z: 0 },
  ]).outcome, 'FAIL');
});

test('C2 unresolved demand and bounded computational limits do not fabricate reactions', () => {
  assert.equal(solveContactReactions(null, { x: 0, z: 0 }, []).outcome, 'UNRESOLVED');
  assert.equal(solveContactReactions(1, { x: 0, z: 0 }, [{ supportId: 'a', x: NaN, z: 0 }]).outcome, 'UNRESOLVED');
  const result = solveContactReactions(1, { x: 0, z: 0 }, Array.from({ length: 65 }, (_, x) => ({ supportId: `s${x}`, x, z: 0 })));
  assert.equal(result.outcome, 'UNRESOLVED'); assert.deepEqual(result.reactions, []);
});

test('C2 a descendant shifts the combined resultant while remaining inside the lower hull', () => {
  const result = assessPhysicalSubject(c2Shifted(51, 10)), load = c2Body(result, 'beam-1').load;
  assert.equal(c2Hard(result, 'support.loaded-resultant', 'beam-1').outcome, 'PASS');
  c2Near(load.resultant.x, 50.5); assert.equal(load.demand, 20);
  assert.equal(c2Body(result, 'pedestal-1').load.demand, 1020);
});

test('C2 admissible bounds distinguish all-pass, all-fail and mixed dependent outcomes', () => {
  const hull = supportConvexHull([{ x: 0, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: 0, z: 5 }]);
  const bounds = { force: { min: 10, max: 10 }, momentX: { min: 40, max: 60 }, momentZ: { min: -1, max: 1 } };
  assert.equal(assessResultantBounds(hull, bounds).outcome, 'PASS');
  bounds.momentX = { min: 110, max: 120 };
  assert.equal(assessResultantBounds(hull, bounds).outcome, 'FAIL');
  bounds.momentX = { min: 90, max: 110 };
  assert.equal(assessResultantBounds(hull, bounds).outcome, 'UNRESOLVED');
  assert.equal(assessResultantBounds(hull, null).outcome, 'UNRESOLVED');
});

test('C2 pallet payload plus tare flows down, with advisory-only maxPalletWeight', () => {
  const subject = c2Stack({ isPallet: true, maxPalletWeight: 5 }); subject.cases[0].weight = 2;
  const result = assessPhysicalSubject(subject), load = c2Body(result, 'base-1').load;
  assert.equal(load.payload, 10); assert.equal(load.demand, 12); assert.equal(load.reactions[0].force, 12);
  assert.equal(result.primary, 'VALID');
  assert.ok(result.advisory.some(f => f.property === 'pallet.payload-threshold'));
  assert.equal(c2Gate(result, 'supportWeight').outcome, 'NOT_APPLICABLE');
  assert.ok(result.unverified.some(f => f.property === 'structural-top-load-capacity'));
});

test('C2 unknown pallet payload leaves its dependent downward load incomplete', () => {
  const result = assessPhysicalSubject(c2Stack({ isPallet: true, maxPalletWeight: 5 }, null));
  assert.equal(c2Body(result, 'base-1').load.payload, null);
  assert.equal(c2Body(result, 'base-1').load.demand, null);
  assert.equal(result.primary, 'INCOMPLETE');
  assert.equal(result.advisory.some(f => f.property === 'pallet.payload-threshold'), false);
});

test('C2 immediate 1:1 own-weight gate blocks a physically valid heavier child', () => {
  const subject = c2Stack(); subject.cases[0].weight = 1;
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Gate(result, 'supportWeight').outcome, 'FAIL');
  assert.equal(result.primary, 'VALID'); assert.equal(result.eligibility.state, 'blocked');
});

test('C2 1:1 uses immediate own weight, not the descendants total', () => {
  const subject = c2Stack(); subject.cases[0].weight = 10;
  subject.cases.push(c2Case('top', [5, 5, 10], 10)); subject.instances.push(c2Instance('top-1', 'top', 50, 25));
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Body(result, 'base-1').load.payload, 20);
  assert.ok(result.gates.filter(g => g.property === 'supportWeight').every(g => g.outcome === 'PASS'));
});

test('C2 unknown child or supporter mass makes the active weight gate unresolved', () => {
  for (const index of [0, 1]) {
    const subject = c2Stack(); subject.cases[index].weight = null;
    const result = assessPhysicalSubject(subject);
    assert.equal(c2Gate(result, 'supportWeight').outcome, 'UNRESOLVED');
    assert.equal(result.eligibility.state, 'blocked');
  }
});

test('C2 Wheel Well one-third extension is a compatibility gate only', () => {
  const subject = c2Subject([c2Case('cantilever', [30, 8, 10])], [c2Instance('cantilever-1', 'cantilever', 56, 10, 15)], { targetSpace: c2Wells });
  const result = assessPhysicalSubject(subject);
  c2Near(c2Body(result, 'cantilever-1').support.extensionFraction, 11 / 30);
  assert.equal(c2Gate(result, 'wheelWellThird').outcome, 'FAIL');
  assert.equal(result.primary, 'VALID'); assert.equal(result.eligibility.state, 'blocked');
  assert.equal(c2Gate(assessPhysicalSubject(c2Floor()), 'wheelWellThird').outcome, 'NOT_APPLICABLE');
});

test('C2 compatibility flags can disable every known temporary gate without changing physical findings', () => {
  const subject = c2Stack(); subject.cases[0].weight = 1;
  const on = assessPhysicalSubject(subject);
  const off = assessPhysicalSubject({ ...subject, compatibility: { support50: false, supportWeight: false, wheelWellThird: false } });
  assert.deepEqual(off.hard, on.hard);
  assert.ok(off.gates.every(g => !g.active && g.outcome === 'NOT_APPLICABLE'));
  assert.equal(off.eligibility.state, 'eligible'); assert.notEqual(off.identity, on.identity);
  assert.throws(() => assessPhysicalSubject({ ...subject, compatibility: { support50: 'false' } }), TypeError);
});

test('C2 actual forbidden signed orientation is HARD invalid', () => {
  const subject = c2Floor(); subject.cases[0].orientationLock = 'upright';
  subject.instances[0].transform.rotation.x = Math.PI;
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Hard(result, 'orientation.permission', 'box-1').outcome, 'FAIL');
  assert.equal(result.primary, 'INVALID');
});

test('C2 planning locks, profiles, cached dimensions and strategy are not physical authority', () => {
  const subject = c2Floor(), baseline = assessPhysicalSubject(subject);
  Object.assign(subject.instances[0], { lockedRotation: { x: 90, y: 90, z: 0 }, rotationLocked: true,
    orientedDims: { length: 999, width: 999, height: 999 }, packedProfile: 'obsolete', strategy: 'max' });
  subject.cases[0].canFlip = false;
  assert.deepEqual(assessPhysicalSubject(subject), baseline);
});

test('C2 collisions are HARD invalid and collect useful independent unresolved evidence', () => {
  const subject = c2Floor(); subject.cases.push(c2Case('unknown', [20, 20, 10], null));
  subject.instances.push(c2Instance('overlap', 'unknown', 55));
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Hard(result, 'collision').outcome, 'FAIL');
  assert.equal(c2Hard(result, 'support.loaded-resultant', 'overlap').outcome, 'UNRESOLVED');
  assert.equal(result.primary, 'INVALID');
});

test('C2 out-of-bounds geometry and Wheel Well body penetration fail containment', () => {
  const subject = c2Floor(); subject.instances[0].transform.position.x = -20;
  assert.equal(c2Hard(assessPhysicalSubject(subject), 'containment', 'box-1').outcome, 'FAIL');
  const well = c2Subject([c2Case('box', [10, 10, 10])], [c2Instance('box-1', 'box', 45, 5, 15)], { targetSpace: c2Wells });
  assert.equal(c2Hard(assessPhysicalSubject(well), 'containment', 'box-1').outcome, 'FAIL');
});

test('C2 continuous center floor accepts a supplied pose spanning the computational Wheel Well seam', () => {
  const subject = c2Subject([c2Case('box', [20, 20, 20])], [c2Instance('box-1', 'box', 60, 10)], { targetSpace: c2Wells });
  const result = assessPhysicalSubject(subject);
  assert.equal(result.primary, 'VALID');
  assert.equal(c2Hard(result, 'containment', 'box-1').outcome, 'PASS');
  assert.equal(c2Body(result, 'box-1').support.coverage, 1);
  assert.ok(c2Body(result, 'box-1').support.patches.length > 1);
});

test('C2 raised Wheel Well contacts are real support with duplicate surfaces unioned once', () => {
  const result = assessPhysicalSubject(c2Subject([c2Case('box', [20, 40, 10])], [c2Instance('box-1', 'box', 45, 10)], { targetSpace: c2Wells }));
  assert.equal(c2Body(result, 'box-1').support.coverage, 0.5);
  assert.equal(c2Hard(result, 'support.own-centered-hull', 'box-1').outcome, 'PASS');
  assert.equal(result.primary, 'VALID');
});

test('C2 Front Overhang actual blocker union spans the assessed movement width', () => {
  const result = assessPhysicalSubject(c2Retained()), blocking = c2Hard(result, 'front-overhang.rear-blocking', 'deck-1');
  assert.equal(blocking.outcome, 'PASS');
  assert.equal(blocking.evidence.coveredWidth, 20);
  assert.equal(blocking.evidence.contacts.length, 2);
  assert.equal(result.primary, 'VALID');
});

test('C2 Front Overhang horizontal gaps remain gaps', () => {
  const result = assessPhysicalSubject(c2Retained(30, 0.1)), blocking = c2Hard(result, 'front-overhang.rear-blocking', 'deck-1');
  assert.equal(blocking.outcome, 'FAIL'); c2Near(blocking.evidence.coveredWidth, 19.8);
});

test('C2 Front Overhang no positive vertical overlap fails', () => {
  assert.equal(c2Hard(assessPhysicalSubject(c2Retained(20)), 'front-overhang.rear-blocking', 'deck-1').outcome, 'FAIL');
});

test('C2 tiny positive rear-blocker overlap establishes geometry while strength stays unverified', () => {
  const result = assessPhysicalSubject(c2Retained(20.00001));
  assert.equal(c2Hard(result, 'front-overhang.rear-blocking', 'deck-1').outcome, 'PASS');
  const limitation = result.unverified.find(f => f.property === 'front-overhang-structural-restraint' && f.subject === 'deck-1');
  assert.equal(limitation.evidence.geometryEstablished, true);
  assert.deepEqual(limitation.evidence.properties, ['strength', 'anchorage', 'impact-capacity']);
});

test('C2 upper Front Overhang cargo cannot borrow a wall that ends at its bearing plane', () => {
  const subject = c2Retained(30);
  subject.cases.push(c2Case('upper', [10, 20, 10])); subject.instances.push(c2Instance('upper-1', 'upper', 120, 35));
  const result = assessPhysicalSubject(subject);
  assert.equal(c2Hard(result, 'front-overhang.rear-blocking', 'deck-1').outcome, 'PASS');
  assert.equal(c2Hard(result, 'front-overhang.rear-blocking', 'upper-1').outcome, 'FAIL');
});

test('C2 staged or floating Front Overhang blockers do not qualify', () => {
  const staged = c2Retained(); staged.instances[0].placement = 'staged';
  assert.equal(c2Hard(assessPhysicalSubject(staged), 'front-overhang.rear-blocking', 'deck-1').outcome, 'FAIL');
  const floating = c2Retained(); floating.instances[0].transform.position.y += 1;
  assert.equal(c2Hard(assessPhysicalSubject(floating), 'front-overhang.rear-blocking', 'deck-1').outcome, 'FAIL');
});

test('C2 unresolved rear-blocker qualification remains unresolved rather than proven retention', () => {
  const body = { min: { x: 110, y: 20, z: -10 }, max: { x: 130, y: 30, z: 10 } };
  const blocker = { id: 'wall', aabb: { min: { x: 80, y: 0, z: -10 }, max: { x: 100, y: 30, z: 10 } }, qualification: 'UNRESOLVED' };
  const result = measureRearBlocking(body, [blocker], { stepX: 100 });
  assert.equal(result.outcome, 'UNRESOLVED'); assert.equal(result.coveredWidth, 0);
});

for (const shape of ['cylinder', 'drum']) {
  test(`C2 ${shape} keeps rectangular-envelope results and scoped round limitations`, () => {
    const subject = c2Floor(); subject.cases[0].shape = shape;
    const result = assessPhysicalSubject(subject);
    assert.equal(result.primary, 'VALID'); assert.equal(c2Body(result, 'box-1').support.area, 400);
    assert.deepEqual(result.unverified.find(f => f.property === 'round-cargo-contact-and-restraint').evidence.properties,
      ['rolling', 'chocking-cradle', 'real-contact', 'axis-restraint']);
  });
}

test('C2 aggregation has exact HARD precedence and keeps all evidence', () => {
  const pass = { property: 'a', outcome: 'PASS' }, unknown = { property: 'b', outcome: 'UNRESOLVED' }, fail = { property: 'c', outcome: 'FAIL' };
  assert.equal(aggregatePhysicalAssessment([pass]), 'VALID');
  assert.equal(aggregatePhysicalAssessment([pass, unknown]), 'INCOMPLETE');
  const evidence = c2Freeze([pass, unknown, fail]);
  assert.equal(aggregatePhysicalAssessment(evidence), 'INVALID'); assert.equal(evidence.length, 3);
  const result = assessPhysicalSubject(c2Floor());
  assert.ok(result.unverified.length > 0 && result.advisory.length > 0);
  assert.equal(result.primary, 'VALID');
});

test('C2 primary INCOMPLETE can remain operationally eligible', () => {
  const subject = c2Floor(); subject.cases[0].weight = null;
  const result = assessPhysicalSubject(subject);
  assert.equal(result.primary, 'INCOMPLETE'); assert.equal(result.eligibility.state, 'eligible');
  assert.equal(assessOperationalEligibility([{ active: true, outcome: 'UNRESOLVED' }]).state, 'blocked');
  assert.equal(assessOperationalEligibility([{ active: false, outcome: 'FAIL' }]).state, 'eligible');
});

test('C2 every independent road reference is a planning constant, never a HARD score', () => {
  assert.deepEqual(ROAD_PLANNING_REFERENCE_G, { forward: 0.8, rear: 0.5, left: 0.5, right: 0.5 });
  assert.equal(Object.isFrozen(ROAD_PLANNING_REFERENCE_G), true);
  assert.ok(assessPhysicalSubject(c2Floor()).unverified.some(f => f.property === 'transport-securement'));
});

test('C2 assessment preserves frozen Cases, instances and target-space inputs', () => {
  const subject = structuredClone(c2Retained()), before = structuredClone(subject);
  c2Freeze(subject);
  const result = assessPhysicalSubject(subject);
  assert.equal(result.primary, 'VALID'); assert.deepEqual(subject, before);
});

test('C2 hidden packed cargo participates while staged source transforms are excluded and untouched', () => {
  const subject = c2Stack(), baseline = assessPhysicalSubject(subject);
  subject.instances[0].hidden = true;
  subject.instances.push(c2Instance('staged', 'missing', 50, 5, 0, { placement: 'staged', transform: { arbitrary: 'planning source' } }));
  c2Freeze(subject);
  assert.deepEqual(assessPhysicalSubject(subject), baseline);
});

test('C2 equivalent order and display-only edits give deterministic results and reuse identity', () => {
  const subject = c2Stack(), baseline = assessPhysicalSubject(subject);
  subject.instances.reverse(); subject.cases.reverse();
  Object.assign(subject.cases[0], { name: 'Renamed', color: '#ff0000', notes: 'Display only' });
  subject.instances[0].hidden = true;
  subject.targetSpace = { ...subject.targetSpace, name: 'Renamed truck', notes: 'Display only' };
  assert.deepEqual(assessPhysicalSubject(subject), baseline);
});

test('C2 identity tracks consumed mass, actual pose, handling, target and policy', () => {
  const baseline = assessPhysicalSubject(c2Floor()).identity;
  for (const edit of [
    s => { s.cases[0].weight = null; }, s => { s.instances[0].transform.position.x += 1; },
    s => { s.cases[0].noStackOnTop = true; }, s => { s.targetSpace = { ...s.targetSpace, length: 110 }; },
    s => { s.compatibility = { support50: false }; },
  ]) { const subject = c2Floor(); edit(subject); assert.notEqual(assessPhysicalSubject(subject).identity, baseline); }
});

test('C2 equivalent signed axes yield identical identity without rounding Case dimensions', () => {
  const subject = c2Floor(); subject.cases[0].dimensions.length = 20.123456789;
  const baseline = assessPhysicalSubject(subject);
  subject.instances[0].transform.rotation.y = 2 * Math.PI;
  assert.deepEqual(assessPhysicalSubject(subject), baseline);
  c2Near(c2Body(baseline, 'box-1').support.area, 20.123456789 * 20);
});

test('C2 strict malformed mass and orientation stay unresolved while known geometry remains useful', () => {
  for (const field of ['weight', 'orientationLock']) {
    const subject = c2Floor(); subject.cases[0][field] = field === 'weight' ? '10' : 'invalid';
    const result = assessPhysicalSubject(subject);
    assert.equal(result.primary, 'INCOMPLETE'); assert.equal(result.identity, null);
    assert.equal(c2Hard(result, 'containment', 'box-1').outcome, 'PASS');
    assert.equal(c2Body(result, 'box-1').support.coverage, 1);
  }
});

test('C2 malformed pose, membership, identity and target never produce reusable complete assessment', () => {
  for (const edit of [
    s => { s.instances[0].transform.rotation.x = 17; },
    s => { s.instances[0].id = null; },
    s => { s.instances.push(structuredClone(s.instances[0])); },
    s => { s.instances[0].placement = 'unknown'; },
    s => { s.instances[0].caseId = 'missing'; },
    s => { s.instances[0].transform.position.x = 1e308; },
    s => { s.targetSpace = { ...s.targetSpace, length: null }; },
  ]) {
    const subject = c2Floor(); edit(subject); const result = assessPhysicalSubject(subject);
    assert.equal(result.primary, 'INCOMPLETE'); assert.equal(result.identity, null);
    assert.ok(result.hard.some(f => f.outcome === 'UNRESOLVED'));
  }
});

test('C2 empty loaded subject preserves an empty known subtotal without inventing a CoG', () => {
  const result = assessPhysicalSubject(c2Subject([], []));
  assert.equal(result.primary, 'VALID'); assert.equal(result.measurements.mass.total, 0);
  assert.equal(result.measurements.cog.value, null); assert.equal(result.measurements.cog.complete, false);
  assert.throws(() => assessPhysicalSubject({ ...c2Floor(), context: { scope: 'selection' } }), TypeError);
});
