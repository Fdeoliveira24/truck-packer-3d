// truck change reconciliation: contract tests from the former security suite.

import {
  RECON_CASE_LIB,
  RECON_DIMS,
  RECON_RECT,
  RECON_WW,
  appPath,
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
  packsScreenPath,
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
  assertReconLayoutSafe(PackLib, PackLib.stageInvalidPlacements(r, wwA, RECON_CASE_LIB).cases, wwA, 'WW offset');
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
  assertReconLayoutSafe(PackLib, PackLib.stageInvalidPlacements(r2, { ...RECON_RECT, height: 28 }, RECON_CASE_LIB).cases, { ...RECON_RECT, height: 28 }, 'height-clip stack');
});

test('RECON apply is one undoable transaction; cancel leaves state unchanged; Stats agree', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLib = await import(packLibraryPath.href);
  const cases = [reconInst('i0', 30, 8, 0), reconInst('i1', 150, 8, 0), reconInst('i2', 210, 8, 0)];
  StateStore.init({ caseLibrary: RECON_CASE_LIB, packLibrary: [{ id: 'p', title: 'P', truck: RECON_RECT, cases }], folderLibrary: [], preferences: {}, currentPackId: 'p' });
  const before = JSON.stringify(StateStore.get('packLibrary'));

  // CANCEL: compute reconciliation but do not apply → state unchanged.
  const pack = PackLib.getById('p');
  PackLib.reconcilePlacementsForTruck(pack, { ...RECON_RECT, length: 120 }, RECON_CASE_LIB);
  assert.equal(JSON.stringify(StateStore.get('packLibrary')), before, 'reconcile alone (cancel) does not mutate state');

  // APPLY: truck + reconciled cases in ONE update (one history entry).
  const nextTruck = { ...RECON_RECT, length: 120 };
  const r = PackLib.reconcilePlacementsForTruck(pack, nextTruck, RECON_CASE_LIB);
  const finalPack = PackLib.stageInvalidPlacements(r, nextTruck, RECON_CASE_LIB);
  PackLib.update('p', { truck: nextTruck, cases: finalPack.cases });
  const applied = PackLib.getById('p');
  assert.equal(applied.truck.length, 120, 'truck change applied');
  // Stats agree immediately with the reconciled layout.
  assert.equal(applied.stats.totalCases, 3, 'stats recomputed on apply');
  assert.equal(applied.stats.packedCases + applied.stats.stagedCases, 3, 'stats packed+staged account for every item');
  assertReconLayoutSafe(PackLib, applied.cases, applied.truck, 'applied');

  // ONE-STEP UNDO restores the prior truck AND the full prior layout.
  StateStore.undo();
  assert.equal(JSON.stringify(StateStore.get('packLibrary')), before, 'a single undo restores the prior truck and full layout');
  StateStore.redo();
  assert.equal(PackLib.getById('p').truck.length, 120, 'a single redo restores the staged truck change');

  // Repack is the same one-history-entry transaction and round-trips too.
  StateStore.undo();
  const restoredPack = PackLib.getById('p');
  const repackRecon = PackLib.reconcilePlacementsForTruck(restoredPack, nextTruck, RECON_CASE_LIB);
  const repackOutcome = PackLib.repackInvalidPlacements(repackRecon, nextTruck, RECON_CASE_LIB);
  assert.equal(repackOutcome.failedIds.length, 0, 'fixture invalid items can be repacked');
  PackLib.update('p', { truck: nextTruck, cases: repackOutcome.pack.cases });
  const repackedSnapshot = JSON.stringify(StateStore.get('packLibrary'));
  StateStore.undo();
  assert.equal(JSON.stringify(StateStore.get('packLibrary')), before, 'one undo restores the complete pre-repack state');
  StateStore.redo();
  assert.equal(JSON.stringify(StateStore.get('packLibrary')), repackedSnapshot, 'one redo restores the complete repack result');
});

test('RECON every production truck writer routes through the shared controller', async () => {
  const [editor, packs, controller, app] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(packsScreenPath, 'utf8'),
    fs.readFile(truckChangeControllerPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
  ]);
  assert.match(editor, /function applyTruckGeometryChange\(pack, nextTruck/);
  assert.match(editor, /TruckChangeController\.request\(\{/);
  assert.match(editor, /renderPreview: preview => \{[\s\S]*?SceneManager\.setTruck\(preview\.pack\.truck\);[\s\S]*?CaseScene\.sync\(preview\.pack\);/,
    'Editor owns ephemeral truck and cargo scene rendering');
  assert.doesNotMatch(editor, /PackLibrary\.update\(pack\.id, \{ truck/,
    'Editor has no direct truck writer');
  assert.match(packs, /function requestTruckChange\(options\)/,
    'Packs routes truck changes through its operation-lifecycle wrapper');
  assert.equal((packs.match(/TruckChangeController\.request\(\{/g) || []).length, 1,
    'the operation-lifecycle wrapper has one shared controller delegation');
  assert.equal((packs.match(/\brequestTruckChange\(\{/g) || []).length, 2,
    'Packs toolbar preset and Edit Pack Save both use the guarded wrapper');
  assert.doesNotMatch(packs, /PackLibrary\.update\(pack\.id, \{ truck/,
    'Packs toolbar has no direct truck writer');
  assert.match(controller, /PackLibrary\.reconcilePlacementsForTruck\(pack, nextTruck, caseLibrary\)/);
  assert.match(controller, /PackLibrary\.update\(ctx\.pack\.id, \{ truck: ctx\.nextTruck, cases: finalPack\.cases, handlingRulesValidatedSignature \}\)/,
    'only the controller owns the default atomic truck+cases+validation-signature commit');
  assert.match(app, /const TruckChangeController = createTruckChangeController\(\{/,
    'one controller instance is injected into both screens');
});

test('RECON controller is single-flight, double-submit safe, and commits truck+cases once', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const harness = makeTruckChangeHarness();
  const pack = { id: 'p', truck: RECON_RECT, cases: [reconInst('far', 210, 8, 0)] };
  const before = JSON.stringify(pack);
  const commits = [];
  const controller = Controller.createTruckChangeController({
    PackLibrary: { ...PackLib, update: (id, patch) => { commits.push({ id, patch }); return { id, ...patch }; } },
    CaseLibrary: { getCases: () => RECON_CASE_LIB },
    UIComponents: harness.UIComponents,
    documentRef: harness.documentRef,
  });
  const nextTruck = { ...RECON_RECT, length: 120 };
  assert.equal(controller.request({ pack, nextTruck }).status, 'preview');
  assert.equal(controller.request({ pack, nextTruck }).status, 'busy', 'a second request is rejected while preview is open');
  const action = harness.modals[0].config.actions.find(candidate => candidate.label === 'Move to staging');
  assert.equal(JSON.stringify(pack), before, 'state remains unchanged before confirmation');
  const first = action.onClick();
  const second = action.onClick();
  assert.equal(first, true);
  assert.equal(second, false, 'repeat click is ignored');
  harness.modals[0].ref.close();
  assert.equal(commits.length, 1, 'one atomic commit');
  assert.equal(commits[0].patch.truck.length, 120);
  assert.equal(commits[0].patch.cases[0].placement, 'staged');
  assert.equal(commits[0].patch.cases[0].transform.position.y, RECON_DIMS.height / 2,
    'staged center is exactly half-height');
  assert.equal(JSON.stringify(pack), before, 'controller preserves the caller snapshot');
});

test('RECON Truck Change Contract B preserves semantic counts and commits its exact grouped preview', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseLibrary = [
    { id: 'A', name: 'Large', orientationLock: 'any', dimensions: { length: 30, width: 20, height: 10 }, weight: 20 },
    { id: 'B', name: 'Small', orientationLock: 'any', dimensions: { length: 20, width: 14, height: 12 }, weight: 20 },
  ];
  const identity = { x: 0, y: 0, z: 0 };
  const make = (id, caseId, position, placement = 'packed') => ({
    id, caseId, placement, hidden: false,
    transform: { position, rotation: identity, scale: { x: 1, y: 1, z: 1 } },
    orientedDims: { ...caseLibrary.find(candidate => candidate.id === caseId).dimensions },
  });
  const survivor = make('survivor', 'A', { x: 50, y: 5, z: 0 });
  const safeStage = make('safe-stage', 'A', { x: 15, y: 5, z: 70 }, 'staged');
  const unsafeStageA = { ...make('unsafe-stage-a', 'A', { x: 70, y: 40, z: 70 }, 'staged'), packedProfile: 'max-capacity' };
  const unsafeStageB = { ...make('unsafe-stage-b', 'B', { x: 10000, y: 6, z: 10000 }, 'staged'), packedProfile: 'max-capacity' };
  const invalidA = { ...make('invalid-a', 'A', { x: 190, y: 5, z: 0 }), packedProfile: 'max-capacity' };
  const invalidB = { ...make('invalid-b', 'B', { x: 210, y: 6, z: 20 }), packedProfile: 'max-capacity' };
  const pack = {
    id: 'contract-b-controller', truck: RECON_RECT,
    cases: [survivor, safeStage, unsafeStageA, unsafeStageB, invalidA, invalidB],
  };
  const sourceSnapshot = JSON.stringify(pack);
  const nextTruck = { ...RECON_RECT, length: 120 };

  const run = () => {
    const harness = makeTruckChangeHarness();
    const previews = [];
    const commits = [];
    const controller = Controller.createTruckChangeController({
      PackLibrary: { ...PackLib, update: (id, patch) => { commits.push({ id, patch }); return { id, ...patch }; } },
      CaseLibrary: { getCases: () => caseLibrary },
      UIComponents: harness.UIComponents,
      documentRef: harness.documentRef,
    });
    const result = controller.request({ pack, nextTruck, renderPreview: preview => previews.push(preview) });
    return { harness, previews, commits, result };
  };

  const cancelled = run();
  assert.deepEqual(cancelled.result.reconciliation.summary, {
    kept: 1, adjusted: 0, invalid: 2,
    stagedUnchanged: 1, stagedAdjusted: 2, unresolved: 0, malformed: 0,
  }, 'grouped layout does not merge or inflate reconciliation categories');
  const summaryRows = cancelled.harness.modals[0].config.content.children[1].children.map(child => child.textContent);
  assert.deepEqual(summaryRows, [
    '1 kept in place',
    '0 safely adjusted',
    '2 no longer fit (shown in staging preview)',
    '1 existing staged items unchanged',
    '2 unsafe staged items corrected',
  ], 'modal counts retain their original semantic meaning');
  const cancelledPreview = cancelled.previews[0].pack.cases;
  assert.deepEqual(cancelledPreview.find(inst => inst.id === survivor.id), survivor,
    'valid packed survivor remains byte-equivalent in preview');
  assert.deepEqual(cancelledPreview.find(inst => inst.id === safeStage.id), safeStage,
    'valid existing staged cargo remains byte-equivalent in preview');
  cancelled.harness.click(0, 'Cancel');
  assert.equal(JSON.stringify(pack), sourceSnapshot, 'Cancel leaves the source cases byte-equivalent');

  const applied = run();
  assert.deepEqual(applied.previews[0].pack.cases, cancelledPreview,
    'repeated identical Truck Change operations produce byte-equivalent grouped previews');
  const groupedIds = ['unsafe-stage-a', 'unsafe-stage-b', 'invalid-a', 'invalid-b'];
  for (const id of groupedIds) {
    const inst = applied.previews[0].pack.cases.find(candidate => candidate.id === id);
    const dims = caseLibrary.find(candidate => candidate.id === inst.caseId).dimensions;
    assert.equal(inst.placement, 'staged');
    assert.deepEqual(inst.transform.rotation, identity);
    assert.deepEqual(inst.orientedDims, dims);
    assert.equal(inst.transform.position.y, dims.height / 2);
    assert.equal(Object.prototype.hasOwnProperty.call(inst, 'packedProfile'), false);
  }
  assertCanonicalReconLayoutSafe(PackLib, applied.previews[0].pack.cases, nextTruck, caseLibrary,
    'Truck Change Contract B preview');
  applied.harness.click(0, 'Move to staging');
  assert.equal(applied.commits.length, 1, 'one confirmation creates one commit');
  assert.deepEqual(applied.commits[0].patch.cases, applied.previews[0].pack.cases,
    'Move to staging commits the exact already-rendered grouped plan');
  assert.match(applied.harness.toasts.at(-1).message, /2 item\(s\) moved to staging/,
    'toast uses only the two invalid IDs, not the four combined layout targets');
});

test('RECON Truck Change Apply commits the grouped stagedAdjusted preview without moving safe staging', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const safeStage = {
    ...reconInst('safe-stage', 30, 8, 80),
    placement: 'staged',
    orientedDims: { ...RECON_DIMS },
  };
  const unsafeStage = {
    ...reconInst('unsafe-stage', 70, 40, 80),
    placement: 'staged',
    packedProfile: 'max-capacity',
  };
  const pack = { id: 'staged-adjusted-apply', truck: RECON_RECT, cases: [safeStage, unsafeStage] };
  const nextTruck = { ...RECON_RECT, width: 95 };
  const harness = makeTruckChangeHarness();
  const previews = [];
  const commits = [];
  const controller = Controller.createTruckChangeController({
    PackLibrary: { ...PackLib, update: (id, patch) => { commits.push({ id, patch }); return { id, ...patch }; } },
    CaseLibrary: { getCases: () => RECON_CASE_LIB },
    UIComponents: harness.UIComponents,
    documentRef: harness.documentRef,
  });

  const result = controller.request({ pack, nextTruck, renderPreview: preview => previews.push(preview) });
  assert.equal(result.status, 'preview');
  assert.equal(result.reconciliation.summary.stagedUnchanged, 1);
  assert.equal(result.reconciliation.summary.stagedAdjusted, 1);
  assert.equal(result.reconciliation.summary.invalid, 0);
  assert.deepEqual(previews[0].pack.cases.find(inst => inst.id === safeStage.id), safeStage,
    'safe existing staged cargo is not included in the grouped correction plan');
  const corrected = previews[0].pack.cases.find(inst => inst.id === unsafeStage.id);
  assert.equal(corrected.placement, 'staged');
  assert.deepEqual(corrected.transform.rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(corrected.orientedDims, RECON_DIMS);
  assert.equal(corrected.transform.position.y, RECON_DIMS.height / 2);
  assert.equal(Object.prototype.hasOwnProperty.call(corrected, 'packedProfile'), false);

  harness.click(0, 'Apply change');
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].patch.cases, previews[0].pack.cases,
    'Apply change commits the exact grouped correction preview');
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

test('RECON adjusted-only preview shows exact counts and applies the proposed pose only after confirmation', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const harness = makeTruckChangeHarness();
  const pack = { id: 'p', truck: RECON_RECT, cases: [reconInst('floating', 30, 40, 0)] };
  const before = JSON.stringify(pack);
  const commits = [];
  const previews = [];
  const controller = Controller.createTruckChangeController({
    PackLibrary: { ...PackLib, update: (id, patch) => { commits.push({ id, patch }); return { id, ...patch }; } },
    CaseLibrary: { getCases: () => RECON_CASE_LIB },
    UIComponents: harness.UIComponents,
    documentRef: harness.documentRef,
  });
  const result = controller.request({
    pack,
    nextTruck: { ...RECON_RECT, width: 95 },
    successMessage: 'Truck updated',
    renderPreview: preview => previews.push(preview),
  });
  assert.equal(result.status, 'preview');
  assert.deepEqual(result.reconciliation.summary, {
    kept: 0, adjusted: 1, invalid: 0,
    stagedUnchanged: 0, stagedAdjusted: 0, unresolved: 0, malformed: 0,
  });
  assert.equal(JSON.stringify(pack), before, 'adjusted pose is preview-only');
  assert.equal(previews[0].pack.cases[0].transform.position.y, 8,
    'ephemeral scene receives the safely adjusted pose');
  harness.click(0, 'Apply change');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].patch.cases[0].transform.position.y, 8);
  assert.match(harness.toasts.at(-1).message, /1 item\(s\) safely adjusted/);
});

test('RECON Standard, Wheel Wells, Front Overhang, and C2 use one ephemeral preview callback', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const transitions = [
    { label: 'Standard', source: { ...RECON_RECT, length: 239 }, next: RECON_RECT },
    { label: 'Wheel Wells', source: RECON_RECT, next: RECON_WW },
    { label: 'Front Overhang', source: RECON_RECT, next: reconFB() },
  ];
  for (const transition of transitions) {
    const harness = makeTruckChangeHarness();
    const previews = [];
    const pack = { id: `p-${transition.label}`, truck: transition.source, cases: [reconInst('floor', 30, 8, 0)] };
    const controller = Controller.createTruckChangeController({
      PackLibrary: PackLib,
      CaseLibrary: { getCases: () => RECON_CASE_LIB },
      UIComponents: harness.UIComponents,
      documentRef: harness.documentRef,
    });
    controller.request({ pack, nextTruck: transition.next, renderPreview: preview => previews.push(preview) });
    assert.equal(previews.length, 1, `${transition.label} invokes the shared preview path once`);
    assert.equal(previews[0].pack.truck.shapeMode, transition.next.shapeMode, `${transition.label} previews proposed geometry`);
    harness.click(0, 'Cancel');
  }

  const harness = makeTruckChangeHarness();
  const previews = [];
  const sourceTruck = reconFB(43.2);
  const nextTruck = reconFB(43.3);
  const deck = reconInst('deck-without-wall', 262, 51.2, 0);
  const pack = { id: 'p-c2', truck: sourceTruck, cases: [deck] };
  const controller = Controller.createTruckChangeController({
    PackLibrary: PackLib,
    CaseLibrary: { getCases: () => RECON_CASE_LIB },
    UIComponents: harness.UIComponents,
    documentRef: harness.documentRef,
  });
  controller.request({ pack, nextTruck, renderPreview: preview => previews.push(preview) });
  assert.equal(previews[0].pack.cases[0].placement, 'staged',
    'C2-unretained deck cargo is shown in staging during preview');
  assert.equal(pack.cases[0].placement, 'packed', 'C2 preview does not mutate the source pack');
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

test('RECON repack reports partial failure and requires a second explicit staging decision', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const cubeLib = [{ id: 'cube', name: 'Cube', orientationLock: 'any', dimensions: { length: 20, width: 20, height: 20 }, weight: 10 }];
  const failedId = '5585711a-785a-4605-ba77-782525d00819';
  const packedRotation = { x: 0, y: Math.PI / 2, z: 0 };
  const cube = (id, x) => ({
    ...reconInst(id, x, 10, 0),
    caseId: 'cube',
    packedProfile: 'max-capacity',
    orientedDims: { length: 20, width: 20, height: 20 },
    transform: { ...reconInst(id, x, 10, 0).transform, rotation: packedRotation },
  });
  const pack = { id: 'p', truck: RECON_RECT, cases: [cube('a', 100), cube(failedId, 140)] };
  const nextTruck = { length: 30, width: 20, height: 20, shapeMode: 'rect' };
  const harness = makeTruckChangeHarness();
  const commits = [];
  const previews = [];
  let restores = 0;
  const controller = Controller.createTruckChangeController({
    PackLibrary: { ...PackLib, update: (id, patch) => { commits.push({ id, patch }); return { id, ...patch }; } },
    CaseLibrary: { getCases: () => cubeLib },
    UIComponents: harness.UIComponents,
    documentRef: harness.documentRef,
  });

  const request = () => controller.request({
    pack,
    nextTruck,
    renderPreview: preview => previews.push(preview),
    restoreControls: () => { restores++; },
  });
  request();
  assert.equal(previews[0].pack.cases.every(inst => inst.placement === 'staged'), true,
    'initial preview shows invalid items in canonical staging, not as packed cargo');
  harness.click(0, 'Repack invalid');
  assert.equal(commits.length, 0, 'partial repack has not committed or silently staged');
  assert.equal(previews[1].pack.cases.find(inst => inst.id === 'a').placement, 'packed',
    'partial repack preview shows successfully repacked cargo as packed');
  assert.equal(previews[1].pack.cases.find(inst => inst.id === failedId).placement, 'staged',
    'partial repack preview never presents failed cargo as packed');
  assert.deepEqual(previews[1].pack.cases.find(inst => inst.id === 'a').transform.rotation, packedRotation,
    'successful repack retains its packed solver pose');
  assert.equal(previews[1].pack.cases.find(inst => inst.id === 'a').packedProfile, 'max-capacity',
    'successful physically valid Max Capacity survivor retains its profile');
  assert.deepEqual(previews[1].pack.cases.find(inst => inst.id === failedId).transform.rotation, { x: 0, y: 0, z: 0 },
    'remaining repack failure previews with deterministic staging rotation');
  assert.equal(Object.prototype.hasOwnProperty.call(previews[1].pack.cases.find(inst => inst.id === failedId), 'packedProfile'), false,
    'remaining repack failure loses its packed profile when staged');
  const secondContent = harness.modals[1].config.content;
  assert.match(secondContent.children[0].textContent, /Could not be repacked: 1 item\./);
  assert.equal(secondContent.children[1].children[0].textContent, '1 Cube',
    'failed items are grouped by human-readable case name');
  assert.doesNotMatch(secondContent.children.map(child => child.textContent).join(' '), new RegExp(failedId),
    'raw UUID is omitted from primary user-facing copy');
  assert.doesNotMatch(secondContent.children.map(child => child.textContent).join(' '), /Still unresolved/,
    'repack failures are not mislabeled as unresolved references');
  harness.click(1, 'Keep current truck and cancel');
  assert.equal(commits.length, 0);
  assert.equal(restores, 1, 'second-decision cancel restores controls');

  request();
  harness.click(2, 'Repack invalid');
  harness.click(3, 'Move remaining items to staging');
  assert.equal(commits.length, 1, 'second explicit choice commits once');
  const committedCases = commits[0].patch.cases;
  assert.equal(committedCases.find(c => c.id === 'a').placement, 'packed');
  assert.equal(committedCases.find(c => c.id === failedId).placement, 'staged');
  assert.deepEqual(committedCases.find(c => c.id === 'a').transform.rotation, packedRotation);
  assert.deepEqual(committedCases.find(c => c.id === failedId).transform.rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(committedCases, previews[3].pack.cases,
    'residual-failure confirmation commits the exact repack preview plan');
  assert.match(harness.toasts.at(-1).message, /1 moved to staging/,
    'residual-failure toast uses only the failedIds category');
  assertCanonicalReconLayoutSafe(PackLib, committedCases, nextTruck, cubeLib, 'partial repack');
});

test('RECON repack complete failure returns explicit metadata and never stages implicitly', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const oversizedLib = [{ id: 'oversized', name: 'Oversized', orientationLock: 'any', dimensions: { length: 40, width: 30, height: 30 }, weight: 20 }];
  const cases = [
    { ...reconInst('too-big-a', 100, 15, 0), caseId: 'oversized' },
    { ...reconInst('too-big-b', 150, 15, 0), caseId: 'oversized' },
  ];
  const nextTruck = { length: 30, width: 20, height: 20, shapeMode: 'rect' };
  const recon = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, nextTruck, oversizedLib);
  const outcome = PackLib.repackInvalidPlacements(recon, nextTruck, oversizedLib);
  assert.deepEqual(outcome.repackedIds, []);
  assert.deepEqual(outcome.stagedIds, []);
  assert.deepEqual(outcome.failedIds, ['too-big-a', 'too-big-b']);
  assert.equal(outcome.warnings.length, 2);
  assert.ok(outcome.pack.cases.every(c => c.placement === 'packed'),
    'complete failure preserves the preview poses and does not silently stage');
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
  const repacked = PackLib.repackInvalidPlacements(recon, truck, [deckCase]);
  const repackedInst = repacked.pack.cases.find(inst => inst.id === 'deck-invalid');
  assert.ok(repackedInst.transform.position.x <= 228, 'Repack Invalid places it on the main floor, not the empty deck');
});
