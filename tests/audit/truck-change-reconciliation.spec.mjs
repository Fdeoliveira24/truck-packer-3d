// truck change reconciliation: contract tests from the former security suite.

import {
  RECON_CASE_LIB,
  RECON_RECT,
  RECON_WW,
  assert,
  assertCanonicalReconLayoutSafe,
  assertLargeReconStagingSafe,
  assertReconLayoutSafe,
  autoPackSolverPath,
  buildLargeReconStagingRows,
  editorScreenPath,
  fs,
  makeTruckChangeHarness,
  packImportAabbsOverlap,
  packLibraryPath,
  phbSolverModules,
  phc2Instance,
  phcFrontOverhangTruck,
  reconAabb,
  reconFB,
  reconInst,
  stateStorePath,
  test,
  truckChangeControllerPath,
  vendorThreePath,
} from '../fixtures/security-invariants-support.mjs';

test('AUTO-PACK-A1-R6.3 validation rejects get a strict repack attempt before staging', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(src, /function repackRejectedPlacements\(\s*output,\s*accepted,\s*rejected,\s*zones,\s*loadFrontFirst,\s*frontSurfaceFirst = false,\s*retentionContext = null\s*\)/,
    'solver must include a bounded repack pass for validation rejects');
  assert.match(src, /validatePackedPlacements\(output, packed, floorZones, \{\s*stageRejected: false,\s*retentionContext,\s*wheelWell,\s*\}\)/,
    'initial validation must identify rejected placements before staging them');
  assert.match(src, /repackRejectedPlacements\(\s*output,\s*initialValidation\.accepted,\s*initialValidation\.rejected,/,
    'validation rejects must flow through the repack helper');
  assert.match(src, /repackRejectedPlacements\([\s\S]*?loadFrontFirst,\s*frontSurfaceFirst,\s*retentionContext\s*\);/,
    'validation repack must retain the active floor-surface priority');
  assert.match(src, /const floorPlacement = findFloorPlacement\(item, floorState, repacked, loadFrontFirst\);/,
    'repack must retry floor placement before staging rejected items');
  assert.match(src, /const stackPlacement = findStackPlacement\(\s*item,\s*zones,\s*repacked,\s*loadFrontFirst,\s*frontSurfaceFirst,\s*retentionContext\s*\);/,
    'repack must retry safe stack placement before staging rejected items');
  assert.match(src, /stageRejectedPlacements\(output, \[\.\.\.staged\.values\(\)\]\);/,
    'only items that still fail validation or repack should be staged');
});

test('RECON reduced length/width/height marks out-of-bounds items invalid; valid items byte-equivalent', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const cases = [reconInst('i0', 30, 8, 0), reconInst('i1', 90, 8, 0), reconInst('i2', 150, 8, 0), reconInst('i3', 210, 8, 30)];
  const rL = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, { ...RECON_RECT, length: 120 }, RECON_CASE_LIB);
  assert.deepEqual(rL.invalid.sort(), ['i2', 'i3'], 'items beyond the reduced length are invalid');
  assert.deepEqual(rL.nextPack.cases.find(c => c.id === 'i0').transform.position, { x: 30, y: 8, z: 0 }, 'in-bounds item byte-equivalent');
  const rW = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, { ...RECON_RECT, width: 50 }, RECON_CASE_LIB);
  assert.ok(rW.invalid.includes('i3'), 'item beyond the reduced width (z=30, half-w=25) is invalid');
  // Reduced height below a single floor carton (16) → that carton no longer fits.
  const rH = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, { ...RECON_RECT, height: 10 }, RECON_CASE_LIB);
  assert.equal(rH.summary.invalid, cases.length, 'a height below the case height invalidates every item');
});

test('RECON safe vertical correction snaps floor cargo but rejects an unretained deck after height change', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Floating item (y=40, nothing below) snaps down to the floor (center y=8).
  const r = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases: [reconInst('f', 30, 40, 0)] }, RECON_RECT, RECON_CASE_LIB);
  assert.equal(r.summary.adjusted, 1, 'the floating item is safely adjusted');
  const f = r.nextPack.cases[0];
  assert.equal(f.transform.position.y, 8, 'snapped down to the floor (center = height/2)');
  assert.equal(f.transform.position.x, 30, 'X unchanged'); assert.equal(f.transform.position.z, 0, 'Z unchanged');
  // Deck lowered 43.2 → 20: without an accepted wall at the step, the deck item
  // cannot be treated as a safe vertical adjustment.
  const deck = [reconInst('d', 262, 43.2 + 8, 0)];
  const r2 = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: reconFB(43.2), cases: deck }, reconFB(20), RECON_CASE_LIB);
  assert.deepEqual(r2.invalid, ['d'], 'the unretained deck item is invalid instead of being snapped onto an unsafe deck');
  assert.equal(r2.summary.adjusted, 0);
});

test('RECON wheel-well size/offset and overhang deck length changes revalidate placements', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // A WW item valid for one offset can become invalid when the well moves under it.
  const wwA = { ...RECON_WW, shapeConfig: { wellOffsetFromRear: 60, wellLength: 84, wellWidth: 14.4, wellHeight: 33.6 } };
  const item = [reconInst('w', 200, 8, 40)]; // rear zone, near a side
  const r = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases: item }, wwA, RECON_CASE_LIB);
  assertReconLayoutSafe(PackLib, PackLib.stagePlacementIds((r).nextPack, (r).invalid, wwA, RECON_CASE_LIB).pack.cases, wwA, 'WW offset');
  // Overhang deck shortened so a deck item past the new extent becomes invalid.
  const deck = [reconInst('d', 280, 43.2 + 8, 0)]; // within bonusLength 48 (x up to 288)
  const rShort = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: reconFB(43.2, 48), cases: deck }, reconFB(43.2, 20), RECON_CASE_LIB);
  assert.deepEqual(rShort.invalid, ['d'], 'a deck item past the shortened overhang is invalid');
});

test('RECON dependency groups: invalid base never leaves a child floating; collision/height after change', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Invalid base (out of reduced length) with a stacked child → both invalid (child not floated).
  const stack = [reconInst('base', 230, 8, 0), reconInst('child', 230, 24, 0)];
  const r = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases: stack }, { ...RECON_RECT, length: 120 }, RECON_CASE_LIB);
  assert.deepEqual(r.invalid.sort(), ['base', 'child'], 'an invalid base takes its child with it (no floating child)');
  // Reduced height clips the top child only; base stays, child invalid (no valid lower slot since base occupies the floor).
  const stack2 = [reconInst('b2', 30, 8, 0), reconInst('c2', 30, 24, 0)];
  const r2 = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases: stack2 }, { ...RECON_RECT, height: 28 }, RECON_CASE_LIB);
  assert.deepEqual(r2.kept, ['b2'], 'the base remains valid');
  assert.deepEqual(r2.invalid, ['c2'], 'the over-height child is invalid (not collided into the base)');
  assertReconLayoutSafe(PackLib, PackLib.stagePlacementIds((r2).nextPack, (r2).invalid, { ...RECON_RECT, height: 28 }, RECON_CASE_LIB).pack.cases, { ...RECON_RECT, height: 28 }, 'height-clip stack');
});

test('RECON grouped staging expands 521 genuine corrections beyond the preferred work area safely', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = { id: 'bulk', name: 'Bulk carton', orientationLock: 'any', dimensions: { length: 20, width: 14, height: 12 }, weight: 20 };
  const caseLibrary = [caseData];
  const standard = { length: 636, width: 102, height: 110, shapeMode: 'rect' };
  const wheelWells = {
    ...standard,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 34, wellWidth: 15, wellLength: 220, wellOffsetFromRear: 160 },
  };
  const frontOverhang = {
    ...standard,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 76, bonusHeight: 44, bonusWidth: standard.width },
  };
  const floating = buildLargeReconStagingRows(521, standard, caseData, {
    prefix: 'large-correction',
    verticalOffset: 30,
    packedProfile: 'max-capacity',
  });
  const recon = PackLib.reconcilePlacementsForTruck(
    { id: 'large-corrections', truck: standard, cases: floating },
    wheelWells,
    caseLibrary
  );
  assert.equal(recon.summary.stagedUnchanged, 0);
  assert.equal(recon.summary.stagedAdjusted, 521,
    'all 521 floating staged cases are genuine corrections');
  assert.deepEqual(recon.stagedAdjusted, floating.map(inst => inst.id));

  const targetModes = [standard, wheelWells, frontOverhang];
  let wheelPlan = null;
  for (const nextTruck of targetModes) {
    const grouped = PackLib.stagePlacementIds(
      recon.nextPack,
      recon.stagedAdjusted,
      nextTruck,
      caseLibrary,
      { grouped: true }
    );
    assert.deepEqual(grouped.failedIds, [], `${nextTruck.shapeMode}: no fixed-depth staging failures`);
    assert.equal(grouped.stagedIds.length, 521, `${nextTruck.shapeMode}: every correction is staged`);
    const staged = grouped.pack.cases;
    const entries = assertLargeReconStagingSafe(
      PackLib,
      staged,
      nextTruck,
      caseLibrary,
      `521 grouped ${nextTruck.shapeMode}`
    );
    const maxZ = Math.max(...entries.map(entry => entry.aabb.max.z));
    assert.ok(maxZ > PackLib.getStagingWorkAreaBounds(nextTruck).max.z,
      `${nextTruck.shapeMode}: deterministic rows extend beyond the compact preferred work area`);
    for (const inst of staged) {
      assert.deepEqual(inst.transform.rotation, { x: 0, y: 0, z: 0 });
      assert.deepEqual(inst.orientedDims, caseData.dimensions);
      assert.equal(Object.prototype.hasOwnProperty.call(inst, 'packedProfile'), false);
    }
    if (nextTruck.shapeMode === 'wheelWells') wheelPlan = grouped;
  }

  const repeated = PackLib.stagePlacementIds(
    recon.nextPack,
    [...recon.stagedAdjusted].reverse(),
    wheelWells,
    caseLibrary,
    { grouped: true }
  );
  assert.deepEqual(repeated.pack.cases, wheelPlan.pack.cases,
    'reversed target input produces the same large grouped plan');
  const rows = new Map();
  for (const inst of wheelPlan.pack.cases) {
    const z = inst.transform.position.z;
    if (!rows.has(z)) rows.set(z, []);
    rows.get(z).push(inst.transform.position.x);
  }
  const orderedRows = [...rows.values()].map(xs => xs.sort((a, b) => a - b));
  assert.ok(orderedRows.length > 1, 'large group wraps into multiple rows');
  assert.equal(orderedRows.at(-1)[0], orderedRows[0][0],
    'the partial final row restarts at the first deterministic column');
});

test('RECON truck-width expansion repairs only the intersecting row without cascading into safe staging', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = { id: 'bulk', name: 'Bulk carton', orientationLock: 'any', dimensions: { length: 20, width: 14, height: 12 }, weight: 20 };
  const caseLibrary = [caseData];
  const narrow = { length: 636, width: 70, height: 110, shapeMode: 'rect' };
  const expanded = { ...narrow, width: 102 };
  const stagedCases = buildLargeReconStagingRows(521, narrow, caseData, { prefix: 'width-expand' });
  const expandedZones = PackLib.getTrailerUsableZones(expanded);
  const originalIntersections = stagedCases.filter(inst => {
    const aabb = reconAabb(inst.transform.position, caseData.dimensions);
    return expandedZones.some(zone => packImportAabbsOverlap(aabb, zone));
  });
  assert.equal(originalIntersections.length, 20,
    'only the first organized row intersects the wider proposed truck');

  const recon = PackLib.reconcilePlacementsForTruck(
    { id: 'width-expansion', truck: narrow, cases: stagedCases },
    expanded,
    caseLibrary
  );
  assert.equal(recon.summary.stagedAdjusted, 20,
    'only the genuinely intersecting row enters stagedAdjusted');
  assert.equal(recon.summary.stagedUnchanged, 501,
    'later safe rows do not collide with provisional repairs');
  assert.deepEqual(new Set(recon.stagedAdjusted), new Set(originalIntersections.map(inst => inst.id)));
  for (const original of stagedCases.filter(inst => !recon.stagedAdjusted.includes(inst.id))) {
    assert.deepEqual(recon.nextPack.cases.find(inst => inst.id === original.id), original,
      `${original.id} remains byte-equivalent`);
  }

  const grouped = PackLib.stagePlacementIds(
    recon.nextPack,
    recon.stagedAdjusted,
    expanded,
    caseLibrary,
    { grouped: true }
  );
  assert.deepEqual(grouped.failedIds, [], 'the genuine correction row receives a grouped staging band');
  assert.equal(grouped.stagedIds.length, 20);
  assertLargeReconStagingSafe(
    PackLib,
    grouped.pack.cases,
    expanded,
    caseLibrary,
    'width-expansion grouped preview'
  );
});

test('RECON preserve mode reserves safe staged poses before grounding a floating repair', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = { id: 'bulk', name: 'Bulk carton', orientationLock: 'any', dimensions: { length: 20, width: 14, height: 12 }, weight: 20 };
  const caseLibrary = [caseData];
  const truck = { length: 240, width: 70, height: 96, shapeMode: 'rect' };
  const safeCases = buildLargeReconStagingRows(30, truck, caseData, { prefix: 'preserve-safe' });
  const floating = {
    ...structuredClone(safeCases[0]),
    id: 'preserve-floating-repair',
    transform: {
      ...structuredClone(safeCases[0].transform),
      position: { ...safeCases[0].transform.position, y: 40 },
    },
  };
  const recon = PackLib.reconcilePlacementsForTruck(
    { id: 'preserve-order', truck, cases: [floating, ...safeCases] },
    truck,
    caseLibrary,
    { preserveStagedPositions: true }
  );

  assert.deepEqual(recon.stagedAdjusted, [floating.id],
    'the floating case is the only repair even when it appears first');
  assert.equal(recon.summary.stagedUnchanged, safeCases.length);
  for (const original of safeCases) {
    assert.deepEqual(recon.nextPack.cases.find(inst => inst.id === original.id), original,
      `${original.id} remains byte-equivalent in preserve mode`);
  }
  assertLargeReconStagingSafe(
    PackLib,
    recon.nextPack.cases,
    truck,
    caseLibrary,
    'preserve-mode repair ordering'
  );
});

test('RECON large staging adjusts physical hazards and unsupported drift using actual pose dimensions', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = { id: 'bulk', name: 'Bulk carton', orientationLock: 'any', dimensions: { length: 20, width: 14, height: 12 }, weight: 20 };
  const caseLibrary = [caseData];
  const standard = { length: 636, width: 102, height: 110, shapeMode: 'rect' };
  const wheelWells = {
    ...standard,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 34, wellWidth: 15, wellLength: 220, wellOffsetFromRear: 160 },
  };
  const safeCases = buildLargeReconStagingRows(80, standard, caseData, { prefix: 'safe-large' });
  const lastSafeZ = Math.max(...safeCases.map(inst => inst.transform.position.z));
  const makeHazard = (id, position, orientedDims = caseData.dimensions) => ({
    id,
    caseId: caseData.id,
    placement: 'staged',
    hidden: false,
    packedProfile: 'max-capacity',
    orientedDims: { ...orientedDims },
    transform: {
      position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  const hazards = [
    makeHazard('floating-hazard', { x: 10, y: 40, z: lastSafeZ + 50 }),
    makeHazard('inside-truck-hazard', { x: 30, y: 6, z: 0 }),
    makeHazard('partial-truck-hazard', { x: 60, y: 6, z: standard.width / 2 + 4 }),
    makeHazard('overlap-hazard', { ...safeCases[0].transform.position }),
    makeHazard('unsupported-drift-hazard', { x: 10000, y: 6, z: 10000 }),
    makeHazard('stale-dims-hazard', { x: 10, y: 6, z: lastSafeZ + 100 },
      { length: 21, width: 14, height: 12 }),
  ];
  const unresolved = {
    id: 'unresolved-preserved',
    caseId: 'missing-case',
    placement: 'staged',
    hidden: false,
    orientedDims: { length: 10, width: 10, height: 10 },
    transform: {
      position: { x: 20, y: 5, z: lastSafeZ + 200 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    metadata: { preserve: true },
  };
  const sourceCases = [...safeCases, ...hazards, unresolved];
  const recon = PackLib.reconcilePlacementsForTruck(
    { id: 'mixed-large-staging', truck: standard, cases: sourceCases },
    wheelWells,
    caseLibrary
  );

  assert.equal(recon.summary.stagedUnchanged, safeCases.length + 1,
    'safe organized rows and actual-safe stale-cache pose remain unchanged');
  assert.equal(recon.summary.stagedAdjusted, hazards.length - 1,
    'only actual physical hazards enter stagedAdjusted');
  assert.equal(recon.summary.unresolved, 1);
  assert.deepEqual(new Set(recon.stagedAdjusted), new Set(hazards.filter(inst => inst.id !== 'stale-dims-hazard').map(inst => inst.id)));
  for (const safe of safeCases) {
    assert.deepEqual(recon.nextPack.cases.find(inst => inst.id === safe.id), safe,
      `${safe.id} remains byte-equivalent`);
  }
  assert.deepEqual(recon.nextPack.cases.find(inst => inst.id === unresolved.id), unresolved,
    'unresolved staging is preserved without fabricated geometry');

  const corrected = PackLib.stagePlacementIds(
    recon.nextPack,
    recon.stagedAdjusted,
    wheelWells,
    caseLibrary,
    { grouped: true }
  );
  assert.deepEqual(corrected.failedIds, []);
  for (const safe of safeCases) {
    assert.deepEqual(corrected.pack.cases.find(inst => inst.id === safe.id), safe,
      `${safe.id} remains outside the grouped correction plan`);
  }
  assert.deepEqual(corrected.pack.cases.find(inst => inst.id === unresolved.id), unresolved,
    'grouped correction keeps the unresolved obstacle byte-equivalent');
  assertLargeReconStagingSafe(
    PackLib,
    corrected.pack.cases.filter(inst => inst.caseId === caseData.id),
    wheelWells,
    caseLibrary,
    'mixed large correction'
  );
});

test('RECON CaseScene sync removes an existing mesh when its case definition becomes unresolved', async () => {
  const previousThree = globalThis.THREE;
  const previousDocument = globalThis.document;
  const THREE = await import(`${vendorThreePath.href}?t=${Date.now()}-${Math.random()}`);
  globalThis.THREE = THREE;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
        }),
      };
    },
  };
  try {
    const Editor = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
    const scene = new THREE.Scene();
    let caseData = {
      id: 'case-a', name: 'Case A', dimensions: { length: 20, width: 20, height: 20 },
      weight: 10, color: '#8844aa',
    };
    const CaseScene = Editor.createCaseScene({
      SceneManager: {
        getScene: () => scene,
        toWorld: value => Number(value) || 0,
        vecInchesToWorld: position => new THREE.Vector3(position.x, position.y, position.z),
      },
      CaseLibrary: { getById: id => (caseData && caseData.id === id ? caseData : null) },
      CategoryService: { meta: () => ({ color: '#8844aa' }) },
      PackLibrary: {}, StateStore: {}, TrailerGeometry: {},
      Utils: {
        clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
        getCssVar: () => '#ff9f1c',
      },
      PreferencesManager: { get: () => ({ hiddenCaseOpacity: 0.3 }) },
    });
    const pack = {
      id: 'p',
      truck: RECON_RECT,
      cases: [reconInst('instance-a', 20, 10, 0)],
    };
    pack.cases[0].caseId = 'case-a';
    CaseScene.sync(pack);
    assert.ok(CaseScene.getObject('instance-a'), 'resolved instance creates a THREE group');
    caseData = null;
    CaseScene.sync(pack);
    assert.equal(CaseScene.getObject('instance-a'), null, 'unresolved instance removes its stale THREE group');
    assert.equal(scene.children.length, 0, 'stale mesh is removed from the scene');
    CaseScene.clear();
  } finally {
    if (previousThree === undefined) delete globalThis.THREE;
    else globalThis.THREE = previousThree;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('RECON canonical dimensions use the shared rotation helper and THREE-backed bounds', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const THREE = await import(`${vendorThreePath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = { id: 'beam', name: 'Beam', orientationLock: 'any', dimensions: { length: 40, width: 10, height: 6 }, weight: 20 };
  const rotation = { x: 0, y: Math.PI / 2, z: 0 };
  const inst = {
    id: 'beam-1', caseId: 'beam', placement: 'packed',
    orientationLocked: true, lockedRotation: rotation,
    orientedDims: { length: 999, width: 999, height: 999 },
    transform: { position: { x: 30, y: 3, z: 0 }, rotation, scale: { x: 1, y: 1, z: 1 } },
  };
  const canonical = PackLib.getCanonicalInstanceEffectiveDims(inst, caseData);
  assert.deepEqual(canonical.dims, { length: 10, width: 40, height: 6 }, 'stale stored dimensions are rejected');
  assert.equal(canonical.storedConsistent, false);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(caseData.dimensions.length, caseData.dimensions.height, caseData.dimensions.width),
    new THREE.MeshBasicMaterial()
  );
  mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  mesh.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - canonical.dims.length) < 1e-6);
  assert.ok(Math.abs(size.y - canonical.dims.height) < 1e-6);
  assert.ok(Math.abs(size.z - canonical.dims.width) < 1e-6);

  const recon = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases: [inst] }, { ...RECON_RECT, width: 95 }, [caseData]);
  assert.deepEqual(recon.nextPack.cases[0].orientedDims, canonical.dims, 'confirmed result repairs stale orientedDims');
  assert.equal(recon.summary.kept, 1);
  const lockMismatch = { ...inst, lockedRotation: { x: 0, y: 0, z: 0 } };
  assert.deepEqual(PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases: [lockMismatch] }, { ...RECON_RECT, width: 95 }, [caseData]).invalid, [], 'planning target mismatch is not physical invalidity');
  const uprightOnly = { ...caseData, orientationLock: 'upright' };
  const tippedRotation = { x: Math.PI / 2, y: 0, z: 0 };
  const tipped = {
    ...inst,
    lockedRotation: tippedRotation,
    transform: { ...inst.transform, rotation: tippedRotation },
  };
  const preserved = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases: [tipped] }, { ...RECON_RECT, width: 95 }, [uprightOnly]);
  assert.deepEqual(preserved.invalid, []);
  assert.equal(preserved.unresolved.length, 1);
  assert.deepEqual(preserved.nextPack.cases[0], tipped, 'saved forbidden pose remains unchanged until assessment');
});

test('RECON enforces physical hidden cargo, support rules, unresolved references, and exact staging floor', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const supportLib = [
    { id: 'base', name: 'Base', orientationLock: 'any', dimensions: { length: 40, width: 40, height: 10 }, weight: 100, maxStackCount: 1 },
    { id: 'child', name: 'Child', orientationLock: 'any', dimensions: { length: 10, width: 10, height: 10 }, weight: 10 },
    { id: 'thin', name: 'Thin', orientationLock: 'any', dimensions: { length: 12, width: 12, height: 1 }, weight: 1 },
  ];
  const make = (id, caseId, x, y, z, extra = {}) => ({ ...reconInst(id, x, y, z), caseId, ...extra });
  const cases = [
    make('base-1', 'base', 40, 5, 0, { hidden: true }),
    make('child-1', 'child', 35, 15, -5),
    make('child-2', 'child', 45, 15, 5),
    make('thin-1', 'thin', 400, 0.5, 0),
    make('missing-1', 'missing', 80, 5, 0),
  ];
  const recon = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, { ...RECON_RECT, width: 95 }, supportLib);
  assert.ok(recon.kept.includes('base-1'), 'hidden packed support remains physical');
  assert.equal(recon.kept.filter(id => id.startsWith('child')).length, 1, 'one direct child is legal');
  assert.equal(recon.invalid.filter(id => id.startsWith('child')).length, 1, 'maxStackCount blocks the second direct child');
  assert.equal(recon.summary.unresolved, 1, 'unresolved reference is explicit and blocks confirmation');
  assert.ok(recon.invalid.includes('thin-1'));
  const staged = PackLib.stagePlacementIds(recon.nextPack, ['thin-1'], recon.nextPack.truck, supportLib);
  assert.equal(staged.failedIds.length, 0);
  assert.equal(staged.pack.cases.find(c => c.id === 'thin-1').transform.position.y, 0.5,
    'thin staged cargo rests at exactly h/2');

  const noTopLib = supportLib.map(c => c.id === 'base' ? { ...c, noStackOnTop: true, maxStackCount: 0 } : c);
  const noTop = PackLib.reconcilePlacementsForTruck(
    { id: 'p', truck: RECON_RECT, cases: cases.filter(c => ['base-1', 'child-1'].includes(c.id)) },
    { ...RECON_RECT, width: 95 }, noTopLib
  );
  assert.deepEqual(noTop.invalid, ['child-1'], 'noStackOnTop is enforced during reconciliation');
});

test('RECON existing staged cargo stays fixed only when safe; malformed and long cargo are explicit', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const safe = { ...reconInst('safe-stage', 30, 8, 80), placement: 'staged' };
  const floating = { ...reconInst('floating-stage', 70, 40, 80), placement: 'staged' };
  const unreachable = { ...reconInst('far-stage', 10000, 8, 10000), placement: 'staged' };
  const recon = PackLib.reconcilePlacementsForTruck(
    { id: 'p', truck: RECON_RECT, cases: [safe, floating, unreachable] },
    { ...RECON_RECT, width: 95 }, RECON_CASE_LIB
  );
  assert.deepEqual(recon.stagedUnchanged, ['safe-stage']);
  assert.deepEqual(recon.stagedAdjusted, ['floating-stage', 'far-stage']);
  assert.deepEqual(recon.nextPack.cases[0].transform.position, safe.transform.position,
    'safe existing staging pose is untouched');
  assertCanonicalReconLayoutSafe(PackLib, recon.nextPack.cases, recon.nextPack.truck, RECON_CASE_LIB, 'existing staging');

  const badLib = [{ id: 'bad', name: 'Bad', orientationLock: 'any', dimensions: { length: 0, width: 10, height: 10 }, weight: 20 }];
  const malformed = PackLib.reconcilePlacementsForTruck(
    { id: 'p', truck: RECON_RECT, cases: [{ ...reconInst('bad-1', 20, 5, 0), caseId: 'bad' }] },
    { ...RECON_RECT, width: 95 }, badLib
  );
  assert.equal(malformed.summary.malformed, 1, 'bad dimensions are reported rather than replaced with fake geometry');

  const beamLib = [{ id: 'long', name: 'Long beam', orientationLock: 'any', dimensions: { length: 300, width: 8, height: 8 }, weight: 40 }];
  const beam = { ...reconInst('long-1', 150, 4, 0), caseId: 'long' };
  const beamRecon = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: { ...RECON_RECT, length: 320 }, cases: [beam] }, RECON_RECT, beamLib);
  assert.deepEqual(beamRecon.invalid, ['long-1']);
  const staged = PackLib.stagePlacementIds(beamRecon.nextPack, beamRecon.invalid, RECON_RECT, beamLib);
  assert.equal(staged.failedIds.length, 0);
  assertCanonicalReconLayoutSafe(PackLib, staged.pack.cases, RECON_RECT, beamLib, 'long beam staging');
});

test('RECON runtime matrix covers 24 geometry/visibility fixtures with safe final AABBs', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const wwMoved = { ...RECON_WW, shapeConfig: { wellOffsetFromRear: 20, wellLength: 100, wellWidth: 20, wellHeight: 40 } };
  const transitions = [
    ['length shrink', RECON_RECT, { ...RECON_RECT, length: 120 }],
    ['width shrink', RECON_RECT, { ...RECON_RECT, width: 50 }],
    ['height shrink', RECON_RECT, { ...RECON_RECT, height: 10 }],
    ['standard to wheel wells', RECON_RECT, RECON_WW],
    ['wheel wells to standard', RECON_WW, RECON_RECT],
    ['standard to front overhang', RECON_RECT, reconFB()],
    ['front overhang to standard', reconFB(), RECON_RECT],
    ['wheel-well config', RECON_WW, wwMoved],
    ['front-overhang deck config', reconFB(43.2, 48), reconFB(20, 24)],
    ['length expand', { ...RECON_RECT, length: 220 }, RECON_RECT],
    ['width expand', { ...RECON_RECT, width: 80 }, RECON_RECT],
    ['height expand', { ...RECON_RECT, height: 80 }, RECON_RECT],
  ];
  let fixtureCount = 0;
  for (const [name, sourceTruck, nextTruck] of transitions) {
    for (const hidden of [false, true]) {
      const cases = [
        reconInst(`${fixtureCount}-near`, 30, 8, 0),
        { ...reconInst(`${fixtureCount}-far`, 200, 8, 0), hidden },
      ];
      const snapshot = JSON.stringify(cases);
      const recon = PackLib.reconcilePlacementsForTruck({ id: `p-${fixtureCount}`, truck: sourceTruck, cases }, nextTruck, RECON_CASE_LIB);
      assert.equal(JSON.stringify(cases), snapshot, `${name}/${hidden ? 'hidden' : 'visible'} preview is pure`);
      assert.equal(recon.summary.kept + recon.summary.adjusted + recon.summary.invalid, 2,
        `${name}/${hidden ? 'hidden' : 'visible'} accounts for all packed physical items`);
      const staged = PackLib.stagePlacementIds(recon.nextPack, recon.invalid, nextTruck, RECON_CASE_LIB);
      assert.equal(staged.failedIds.length, 0);
      assertCanonicalReconLayoutSafe(PackLib, staged.pack.cases, nextTruck, RECON_CASE_LIB,
        `${name}/${hidden ? 'hidden' : 'visible'}`);
      fixtureCount++;
    }
  }
  assert.equal(fixtureCount, 24, 'minimum runtime matrix contains 24 distinct fixtures');
});

test('PHASE-C2 production solver gates floor, filler, lane, repeated, B2A/B2C, stack, compaction, and repack routes', async () => {
  const { Solver, PackLib } = await phbSolverModules();
  const truck = phcFrontOverhangTruck();
  const zones = PackLib.getTrailerUsableZones(truck);
  const deckZone = zones.find(zone => zone.min.y > 0.05);
  const isOnDeck = (result, id) => {
    const position = result.placements.get(id);
    const dims = result.orientedDims.get(id);
    if (!position || !dims) return false;
    return Solver.isAabbContainedInAnyZone(
      Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height }),
      [deckZone]
    );
  };

  const routeItems = [
    { label: 'floor', item: { instanceId: 'floor', caseId: 'floor', dims: { l: 24, w: 18, h: 16 }, weight: 30 } },
    { label: 'filler', item: { instanceId: 'filler', caseId: 'filler', dims: { l: 20, w: 10, h: 10 }, weight: 20 } },
    { label: 'lane', item: { instanceId: 'lane', caseId: 'lane', dims: { l: 120, w: 10, h: 10 }, weight: 30, laneItem: true } },
  ];
  for (const { label, item } of routeItems) {
    const spec = { orientationLock: 'any', canFlip: false, ...item };
    const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: [spec] });
    assert.equal(isOnDeck(result, spec.instanceId), false, `${label} cannot use an empty deck`);
  }

  const repeatedItems = Array.from({ length: 8 }, (_, index) => ({
    instanceId: `r${index}`, caseId: 'repeated', dims: { l: 42, w: 10, h: 16 },
    orientationLock: 'any', canFlip: false, weight: 30,
  }));
  const repeated = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: repeatedItems });
  assert.equal([...repeated.placements.keys()].some(id => isOnDeck(repeated, id)), false,
    'repeated-grid and its B2A/B2C retries cannot bypass retention');

  const crowdedItems = Array.from({ length: 100 }, (_, index) => ({
    instanceId: `c${index}`, caseId: 'crowded', dims: { l: 24, w: 18, h: 16 },
    orientationLock: 'any', canFlip: false, weight: 30, maxStackCount: 2,
  }));
  const crowded = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: crowdedItems });
  assert.ok(crowded.phaseStats.stackCount > 0, 'fixture exercises production stacking after both compaction passes');
  assert.equal([...crowded.placements.keys()].some(id => isOnDeck(crowded, id)), false,
    'stack and compaction cannot create an unretained deck placement');

  const deckCase = {
    id: 'deck-case', dimensions: { length: 24, width: 18, height: 16 },
    weight: 30, orientationLock: 'any', canFlip: false,
  };
  const deckInst = phc2Instance('deck-invalid', deckCase.id, { x: 256.8, y: 51.2, z: -39 }, deckCase.dimensions);
  const recon = PackLib.reconcilePlacementsForTruck({ id: 'p', truck, cases: [deckInst] }, truck, [deckCase]);
  assert.deepEqual(recon.invalid, ['deck-invalid'], 'final/reconciliation gate rejects an unretained deck item');

});

// Final C5 product contract: every physical truck change stages the committed Pack.
async function stabilizationHarness(cases = [reconInst('packed', 30, 8, 0)], caseLibrary = RECON_CASE_LIB) {
  const PackLib = await import(packLibraryPath.href);
  const StateStore = await import(stateStorePath.href);
  const { createTruckChangeController } = await import(truckChangeControllerPath.href);
  const pack = { id: 'stabilization', title: 'Disposable', truck: RECON_RECT, cases };
  const results = { packId: pack.id, previewEnded: false, options: [{ cases: [] }], viewIndex: 0 };
  StateStore.init({ currentPackId: pack.id, currentScreen: 'editor', packLibrary: [pack], caseLibrary,
    selectedInstanceIds: [cases[0]?.id], autoPackResults: results, folderLibrary: [], preferences: {} });
  const harness = makeTruckChangeHarness();
  const controller = createTruckChangeController({ PackLibrary: PackLib,
    CaseLibrary: { getCases: () => caseLibrary }, UIComponents: harness.UIComponents, documentRef: harness.documentRef });
  return { PackLib, StateStore, controller, harness, pack: PackLib.getById(pack.id), results, caseLibrary };
}

test('C5 stabilization truck change stages every committed instance, preserves data, and is one Undo/Redo action', async () => {
  const cases = [reconInst('packed', 30, 8, 0), reconInst('rotated', 70, 12, 0),
    { ...reconInst('staged', 30, 8, 100), placement: 'staged', hidden: true }];
  cases[1].transform.rotation = { x: Math.PI / 2, y: 0, z: 0 };
  cases[1].orientationLocked = true;
  cases[1].lockedRotation = { x: 0, y: 0, z: 0 }; // An intentionally different planning target.
  cases[1].packedProfile = 'max-capacity';
  cases[1].customMetadata = { owner: 'keep me' };
  const h = await stabilizationHarness(cases);
  const before = JSON.stringify(h.pack);
  let restores = 0;
  const request = () => h.controller.request({ pack: h.pack, nextTruck: RECON_WW,
    restoreControls: () => { restores++; } });
  assert.equal(request().status, 'preview');
  const modal = h.harness.modals[0].config;
  assert.equal(modal.title, 'Change truck layout?');
  assert.equal(modal.content.textContent, 'Changing the truck layout will place all Cases in staging. You can arrange them again manually or use AutoPack.');
  assert.deepEqual(modal.actions.map(action => action.label), ['Cancel', 'Apply Changes']);
  h.harness.click(0, 'Cancel');
  assert.equal(JSON.stringify(h.PackLib.getById(h.pack.id)), before);
  assert.deepEqual(h.StateStore.get('autoPackResults'), h.results);
  assert.equal(h.StateStore.undo(), false, 'Cancel adds no history');
  assert.equal(restores, 1);
  request();
  assert.equal(h.controller.request({ pack: h.pack, nextTruck: RECON_WW }).status, 'busy');
  const apply = h.harness.modals[1].config.actions[1].onClick;
  assert.equal(h.harness.click(1, 'Apply Changes'), true);
  assert.equal(apply(), false, 'a repeated or stale Apply cannot commit');
  const applied = h.PackLib.getById(h.pack.id);
  assert.deepEqual(applied.truck, RECON_WW);
  assert.deepEqual(applied.cases.map(inst => inst.id), cases.map(inst => inst.id));
  assert.equal(applied.stats.packedCases, 0);
  assert.equal(applied.stats.stagedCases, 3);
  assert.equal(h.StateStore.get('autoPackResults'), null);
  assert.deepEqual(h.StateStore.get('selectedInstanceIds'), []);
  const withoutPlacement = inst => {
    const clone = structuredClone(inst);
    delete clone.placement; delete clone.packedProfile; delete clone.transform.position;
    return clone;
  };
  applied.cases.forEach((inst, i) => assert.deepEqual(withoutPlacement(inst), withoutPlacement(cases[i])));
  const bounds = applied.cases.map(inst => {
    const dims = h.PackLib.getCanonicalInstanceEffectiveDims(inst, h.caseLibrary[0]).dims;
    assert.equal(inst.transform.position.y, dims.height / 2);
    return h.PackLib.makeAabb(inst.transform.position, dims);
  });
  bounds.forEach((box, i) => {
    assert.ok(box.min.z > RECON_WW.width / 2, 'staging lies outside the truck');
    bounds.slice(i + 1).forEach(other => assert.equal(packImportAabbsOverlap(box, other), false));
  });
  assert.equal(h.StateStore.undo(), true);
  assert.equal(JSON.stringify(h.PackLib.getById(h.pack.id)), before);
  assert.equal(h.StateStore.undo(), false, 'exactly one history action');
  assert.equal(h.StateStore.redo(), true);
  assert.deepEqual(h.PackLib.getById(h.pack.id), applied);
});

test('C5 stabilization truck change stages missing definitions without fabricating geometry', async () => {
  const missing = { ...reconInst('missing', 30, 8, 0), caseId: 'missing',
    orientedDims: { length: 31, width: 19, height: 17 }, packedProfile: 'max-capacity',
    orientationLocked: true, lockedRotation: { x: 0, y: 0, z: 0 },
    customMetadata: { owner: 'preserve me' } };
  const cases = [reconInst('good', 70, 8, 0), missing];
  const h = await stabilizationHarness(cases);
  const before = structuredClone(h.pack);
  h.controller.request({ pack: h.pack, nextTruck: RECON_WW });
  assert.equal(h.harness.click(0, 'Apply Changes'), true);
  const applied = h.PackLib.getById(h.pack.id);
  assert.deepEqual(applied.truck, RECON_WW);
  assert.deepEqual(applied.cases.map(inst => inst.id), cases.map(inst => inst.id));
  assert.ok(applied.cases.every(inst => inst.placement === 'staged'));
  const expectedMissing = structuredClone(missing);
  expectedMissing.placement = 'staged';
  delete expectedMissing.packedProfile;
  assert.deepEqual(applied.cases[1], expectedMissing,
    'unresolved source pose, stored dimensions, and unrelated data remain untrusted and unchanged');
  const known = applied.cases[0];
  const dims = h.PackLib.getCanonicalInstanceEffectiveDims(known, h.caseLibrary[0]).dims;
  assert.equal(known.transform.position.y, dims.height / 2);
  assert.ok(h.PackLib.makeAabb(known.transform.position, dims).min.z > RECON_WW.width / 2,
    'the known Case receives a real staging position');
  assert.equal(h.StateStore.get('autoPackResults'), null);
  assert.equal(h.StateStore.undo(), true);
  assert.deepEqual(h.PackLib.getById(h.pack.id), before);
  assert.equal(h.StateStore.undo(), false, 'the change is one history action');
  assert.equal(h.StateStore.redo(), true);
  assert.deepEqual(h.PackLib.getById(h.pack.id), applied);
});

test('C5 stabilization truck change refuses malformed geometry, duplicate IDs, and stale workspaces atomically', async () => {
  for (const bad of [
    { ...reconInst('bad-pose', 30, 8, 0), transform: { rotation: { x: NaN, y: 0, z: 0 } } },
    reconInst('good', 30, 8, 0), // duplicate ID
  ]) {
    const h = await stabilizationHarness([reconInst('good', 30, 8, 0), bad]);
    const before = JSON.stringify(h.pack);
    h.controller.request({ pack: h.pack, nextTruck: RECON_WW });
    assert.equal(h.harness.click(0, 'Apply Changes'), false);
    assert.equal(JSON.stringify(h.PackLib.getById(h.pack.id)), before);
    assert.deepEqual(h.StateStore.get('autoPackResults'), h.results);
    assert.equal(h.StateStore.undo(), false);
    assert.match(h.harness.toasts.at(-1).message, /No changes were applied/);
    h.harness.click(0, 'Cancel');
  }
  const h = await stabilizationHarness();
  const storage = await import('../../src/core/storage.js');
  const originalScope = storage.getWorkspaceScope();
  h.controller.request({ pack: h.pack, nextTruck: RECON_WW });
  try {
    storage.setWorkspaceScope('different-stabilization-workspace');
    assert.equal(h.harness.click(0, 'Apply Changes'), false);
    assert.deepEqual(h.PackLib.getById(h.pack.id), h.pack);
    assert.equal(h.StateStore.undo(), false);
  } finally { storage.setWorkspaceScope(originalScope); h.harness.click(0, 'Cancel'); }
});

test('C5 stabilization truck change recognizes physical changes and bypasses staging for unchanged metadata', async () => {
  const { truckGeometryEqual } = await import(truckChangeControllerPath.href);
  const source = { ...RECON_WW, shapeConfig: {} };
  assert.equal(truckGeometryEqual(source, { ...source, shapeConfig: {
    wellHeight: source.height * 0.35, wellWidth: source.width * 0.15,
    wellLength: source.length * 0.35, wellOffsetFromRear: source.length * 0.25,
  } }), true, 'omitted dimensions and their geometry defaults are identical');
  for (const truck of [{ ...RECON_RECT, length: 120 }, { ...RECON_RECT, width: 80 },
    { ...RECON_RECT, height: 80 }, RECON_WW, reconFB()]) {
    assert.equal(truckGeometryEqual(RECON_RECT, truck), false);
  }
  for (const key of ['wellHeight', 'wellWidth', 'wellLength', 'wellOffsetFromRear']) {
    assert.equal(truckGeometryEqual(RECON_WW, { ...RECON_WW,
      shapeConfig: { ...RECON_WW.shapeConfig, [key]: (RECON_WW.shapeConfig?.[key] ?? 10) + 1 } }), false);
  }
  for (const key of ['bonusLength', 'bonusHeight']) {
    const truck = reconFB();
    assert.equal(truckGeometryEqual(truck, { ...truck, shapeConfig: { ...truck.shapeConfig, [key]: truck.shapeConfig[key] + 1 } }), false);
  }
  const h = await stabilizationHarness();
  assert.equal(h.controller.request({ pack: h.pack, nextTruck: RECON_RECT }).status, 'unchanged');
  assert.equal(h.harness.modals.length, 0);
  assert.equal(h.controller.request({ pack: h.pack, nextTruck: { ...RECON_RECT, label: 'metadata' },
    commitWhenUnchanged: true, commit: final => h.PackLib.update(final.id, { title: 'New title', truck: final.truck }) }).status, 'committed');
  assert.deepEqual(h.PackLib.getById(h.pack.id).cases, h.pack.cases);
  assert.deepEqual(h.StateStore.get('autoPackResults'), h.results);
  assert.equal(h.controller.request({ pack: h.pack, nextTruck: { ...RECON_RECT, width: Infinity } }).status, 'failed');
});

test('C5 stabilization truck change restores Results and selection when saving fails', async () => {
  const h = await stabilizationHarness();
  const before = h.StateStore.snapshot();
  h.controller.request({ pack: h.pack, nextTruck: RECON_WW, commit: () => null });
  assert.equal(h.harness.click(0, 'Apply Changes'), false);
  assert.deepEqual(h.StateStore.snapshot(), before);
  assert.equal(h.StateStore.undo(), false);
  h.harness.click(0, 'Cancel');
});
