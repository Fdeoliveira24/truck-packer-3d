// auth workspace invariants: contract tests from the former security suite.

import {
  RECON_CASE_LIB,
  RECON_RECT,
  RECON_WW,
  appPath,
  assert,
  assertCanonicalReconLayoutSafe,
  assertLargeReconStagingSafe,
  assertReconLayoutSafe,
  billingServiceUrl,
  billingStatusPath,
  buildLargeReconStagingRows,
  createBillingPumpRuntimeHarness,
  createLateWorkspaceHydrationRuntime,
  createOrgContextApplyRuntimeHarness,
  createPackPreviewSchedulerHarness,
  createPhase2OrgOrderingHarness,
  createPhase4InviteHarness,
  createWorkspaceMigrationPath,
  editorScreenPath,
  enforceWorkspaceLimitMigrationPath,
  fs,
  indexHtmlPath,
  makeTruckChangeHarness,
  orgArchiveMigrationPath,
  orgArchiveWorkspacePath,
  orgCreateWorkspacePath,
  orgInviteAcceptPath,
  orgInviteExpirationMigrationPath,
  orgInvitePath,
  orgInviteRevokePath,
  orgLeaveWorkspacePath,
  orgMemberAdminDeleteGuardMigrationPath,
  orgMemberRemovePath,
  orgRestoreWorkspacePath,
  orgTransferOwnershipPath,
  packLibraryPath,
  readAppSource,
  readFunctionSources,
  reconAabb,
  reconFB,
  reconInst,
  restoreWorkspaceMigrationPath,
  sceneRuntimePath,
  settingsOverlayPath,
  supabaseConfigPath,
  supabasePath,
  test,
  transferOwnershipLiveFixMigrationPath,
  transferOwnershipMigrationPath,
  truckChangeControllerPath,
  vm,
} from '../fixtures/security-invariants-support.mjs';

test('phase 0.6D-pre edge functions contain no literal wildcard CORS header', async () => {
  const sources = await readFunctionSources();
  for (const [filePath, source] of sources) {
    assert.doesNotMatch(source, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
      `${filePath} must not contain literal wildcard CORS`);
  }
});

test('app init keeps explicit single-flight/idempotency guards', async () => {
  const source = await readAppSource();
  assert.match(source, /let\s+initInFlightPromise\s*=\s*null/);
  assert.match(source, /let\s+initCompleted\s*=\s*false/);
  assert.match(source, /if\s*\(initInFlightPromise\)\s*return\s+initInFlightPromise/);
});

test('org context cross-tab sync includes user + epoch metadata and stale guards', async () => {
  const source = await readAppSource();
  assert.equal(source.includes("const ORG_CONTEXT_SYNC_KEY = 'tp3d:org-context-sync'"), true);
  assert.match(source, /dispatchOrgContextChanged\([\s\S]*userId/);
  assert.match(source, /dispatchOrgContextChanged\([\s\S]*epoch/);
  assert.match(source, /dispatchOrgContextChanged\([\s\S]*timestamp/);
  assert.match(source, /window\.addEventListener\('storage'[\s\S]*ORG_CONTEXT_SYNC_KEY/);
  assert.match(source, /detailUserId && truth\.userId && detailUserId !== truth\.userId/);
  assert.match(source, /getOrgContextEffectiveVersion\(detail\)/);
  assert.match(source, /compareOrgContextOrder\(detailEpoch, detailTabId\) < 0/);
});

test('bundle not marked partial when org context is complete', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');

  // orgContextComplete check exists
  assert.match(sc, /orgContextComplete\s*=\s*Boolean\(activeOrgId\s*&&\s*orgsSafe\.length\s*>=\s*1\)/);

  // partial flag uses orgContextComplete guard
  assert.match(sc, /partial\s*=\s*Boolean\([\s\S]*?!orgContextComplete/);

  // authProofStale computed and included in bundle
  assert.match(sc, /authProofStale\s*=\s*Boolean/);
});

test('G2.2-CAB-OVERHANG scene-runtime accounts for total visual length including the front overhang', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /function getTotalTruckLengthInches\(truckInches\)/,
    'scene-runtime must define getTotalTruckLengthInches');
  assert.match(src, /TrailerGeometry\.getFrontBonusZone\(truckInches\)/,
    'getTotalTruckLengthInches must derive the overhang extent from TrailerGeometry.getFrontBonusZone');
  assert.match(src, /baseLength \+ \(bonus\.max\.x - bonus\.min\.x\)/,
    'total visual length must be truck.length + bonusLength when an overhang zone is present');
  assert.match(src, /const totalLengthW = toWorld\(getTotalTruckLengthInches\(truckInches\)\)/,
    'setTruck must size truckBoundsWorld/camera/shadow/grid bounds from the total visual length');
});

test('STAGING-S1 unpackAll uses canonical staging layout bands instead of a hardcoded offset', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function unpackAll()');
  const end = src.indexOf('\n    function renderInspectorNoPack', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define unpackAll()');
  assert.match(block, /const stagingLayout = PackLibrary\.getStagingLayout\(livePack\.truck \|\| \{\}\);/,
    'unpackAll must derive grouped staging bands from the canonical staging layout helper');
  assert.match(block, /buildOrganizedUnpackStagingCases\(\{/,
    'unpackAll must keep category-aware staging through the organized helper');
  assert.doesNotMatch(block, /stageZStart|truckW|\bconst truckL\b|\blet truckL\b/,
    'unpackAll must not keep its own hardcoded staging offset');
});

test('STAGING-S1 canonical staging helper supports a caller-provided row origin for grouped bands', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const dims = { length: 30, width: 20, height: 24 };
  const layout = PackLibrary.getStagingLayout(truck);
  const shiftedOriginZ = layout.originZ + 160;
  const staged = PackLibrary.findSafeStagingPosition({ truck }, dims, [], { originZ: shiftedOriginZ });

  assert.equal(staged.position.z, shiftedOriginZ + dims.width / 2,
    'custom staging origin must move the first staged row without changing floor grounding');
  assert.equal(staged.position.y, dims.height / 2,
    'custom staging origin must not change the grounded Y pose');
});

test('RECON mode switches (Std↔WheelWells, Std↔FrontOverhang) keep valid items and report invalid ones safely', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Cartons across the floor. The centered row remains valid in Wheel Wells
  // because it clears the blocked bodies and sits in the legal channel.
  const cases = [reconInst('i0', 30, 8, 0), reconInst('i1', 90, 8, 0), reconInst('i2', 150, 8, 0), reconInst('i3', 210, 8, 0)];
  // Std → Wheel Wells
  const r = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, RECON_WW, RECON_CASE_LIB);
  assert.equal(r.summary.invalid, 0,
    'center-channel floor cargo remains valid when it clears Wheel Wells blocked bodies');
  for (const id of r.kept) {
    const before = cases.find(c => c.id === id);
    const after = r.nextPack.cases.find(c => c.id === id);
    assert.deepEqual(after.transform.position, before.transform.position, `kept item ${id} is byte-equivalent`);
  }
  // Resolve invalid by staging, then the whole layout is safe.
  const staged = PackLib.stageInvalidPlacements(r, RECON_WW, RECON_CASE_LIB);
  assertReconLayoutSafe(PackLib, staged.cases, RECON_WW, 'Std→WW staged');

  // Wheel Wells → Standard: a previously-valid WW layout stays valid (more space).
  const wwCases = staged.cases;
  const r2 = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_WW, cases: wwCases }, RECON_RECT, RECON_CASE_LIB);
  assertReconLayoutSafe(PackLib, PackLib.stageInvalidPlacements(r2, RECON_RECT, RECON_CASE_LIB).cases, RECON_RECT, 'WW→Std');

  // Std → Front Overhang: floor items unaffected (overhang only adds space).
  const r3 = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, reconFB(), RECON_CASE_LIB);
  assert.equal(r3.summary.invalid, 0, 'Std→FrontOverhang keeps all floor items');
  assert.equal(r3.summary.adjusted, 0, 'Std→FrontOverhang requires no adjustment');
  // Front Overhang → Standard: a deck item (x>length) becomes invalid (can't snap into the box).
  const deckCases = [reconInst('floor', 30, 8, 0), reconInst('deck', 262, 43.2 + 8, 0)];
  const r4 = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: reconFB(), cases: deckCases }, RECON_RECT, RECON_CASE_LIB);
  assert.deepEqual(r4.invalid, ['deck'], 'FrontOverhang→Std: the deck item is invalid');
  assert.ok(r4.kept.includes('floor'), 'the main-floor item is kept');
  assertReconLayoutSafe(PackLib, PackLib.stageInvalidPlacements(r4, RECON_RECT, RECON_CASE_LIB).cases, RECON_RECT, 'FB→Std staged');
});

test('RECON repack and organized staging produce safe, deterministic, type-grouped layouts', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const lib = [
    { id: 'A', name: 'A', dimensions: { length: 24, width: 18, height: 16 } },
    { id: 'B', name: 'B', dimensions: { length: 24, width: 18, height: 16 } },
  ];
  // Many items beyond a reduced length so most are invalid and must be resolved.
  const cases = [];
  for (let i = 0; i < 6; i++) cases.push({ id: `a${i}`, caseId: 'A', transform: { position: { x: 160 + i, y: 8, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed', hidden: false });
  for (let i = 0; i < 6; i++) cases.push({ id: `b${i}`, caseId: 'B', transform: { position: { x: 170 + i, y: 8, z: 20 }, rotation: { x: 0, y: 0, z: 0 } }, placement: 'packed', hidden: false });
  const nextTruck = { ...RECON_RECT, length: 120 };
  const r = PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, nextTruck, lib);
  assert.ok(r.summary.invalid > 0, 'several items are invalid after the length cut');

  const staged = PackLib.stageInvalidPlacements(r, nextTruck, lib);
  assertReconLayoutSafe(PackLib, staged.cases, nextTruck, 'staged');
  // Grouped by case type: staged items of type A occupy a contiguous staging band vs B.
  const stagedA = staged.cases.filter(c => c.caseId === 'A' && c.placement === 'staged').map(c => c.transform.position.z);
  const stagedB = staged.cases.filter(c => c.caseId === 'B' && c.placement === 'staged').map(c => c.transform.position.z);
  if (stagedA.length && stagedB.length) {
    assert.ok(Math.max(...stagedA) <= Math.min(...stagedB) || Math.max(...stagedB) <= Math.min(...stagedA), 'staged items are grouped by type (A and B do not interleave by z-band)');
  }
  // Deterministic repeat.
  const staged2 = PackLib.stageInvalidPlacements(PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, nextTruck, lib), nextTruck, lib);
  assert.equal(JSON.stringify(staged.cases.map(c => c.transform.position)), JSON.stringify(staged2.cases.map(c => c.transform.position)), 'staging is deterministic');

  const repacked = PackLib.repackInvalidPlacements(r, nextTruck, lib);
  assertReconLayoutSafe(PackLib, repacked.pack.cases, nextTruck, 'repacked');
  const repacked2 = PackLib.repackInvalidPlacements(PackLib.reconcilePlacementsForTruck({ id: 'p', truck: RECON_RECT, cases }, nextTruck, lib), nextTruck, lib);
  assert.equal(JSON.stringify(repacked.pack.cases.map(c => c.transform.position)), JSON.stringify(repacked2.pack.cases.map(c => c.transform.position)), 'repack is deterministic');
});

test('RECON grouped staging preserves obstacles and builds deterministic case bands with aligned partial rows', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseLibrary = [
    { id: 'A', name: 'Large', dimensions: { length: 30, width: 20, height: 10 } },
    { id: 'B', name: 'Small', dimensions: { length: 20, width: 14, height: 12 } },
  ];
  const identity = { x: 0, y: 0, z: 0 };
  const rotated = { x: 0, y: Math.PI / 2, z: 0 };
  const make = (id, caseId, position, placement = 'packed') => ({
    id, caseId, placement, hidden: false, packedProfile: 'max-capacity',
    transform: { position, rotation: rotated, scale: { x: 1, y: 1, z: 1 } },
    orientedDims: caseId === 'A'
      ? { length: 20, width: 30, height: 10 }
      : { length: 14, width: 20, height: 12 },
    metadata: { preserved: id },
  });
  const survivor = {
    ...make('survivor', 'A', { x: 60, y: 5, z: 0 }),
    transform: { position: { x: 60, y: 5, z: 0 }, rotation: identity, scale: { x: 1, y: 1, z: 1 } },
    orientedDims: { ...caseLibrary[0].dimensions },
  };
  const preservedStage = {
    ...make('preserved-stage', 'A', { x: 15, y: 5, z: 70 }, 'staged'),
    transform: { position: { x: 15, y: 5, z: 70 }, rotation: identity, scale: { x: 1, y: 1, z: 1 } },
    orientedDims: { ...caseLibrary[0].dimensions },
  };
  delete preservedStage.packedProfile;
  const unresolvedObstacle = {
    id: 'unresolved-obstacle', caseId: 'missing', placement: 'staged', hidden: false,
    transform: { position: { x: 100, y: 5, z: 140 }, rotation: identity, scale: { x: 1, y: 1, z: 1 } },
    orientedDims: { length: 20, width: 20, height: 10 },
    metadata: { preserve: true },
  };
  const targets = [
    ...['a-5', 'a-2', 'a-4', 'a-1', 'a-3'].map((id, index) =>
      make(id, 'A', { x: 180 + index * 2, y: 5, z: 0 })),
    ...['b-3', 'b-1', 'b-2'].map((id, index) =>
      make(id, 'B', { x: 200 + index * 2, y: 6, z: 20 })),
  ];
  const pack = {
    id: 'grouped-stage',
    truck: RECON_RECT,
    cases: [survivor, preservedStage, unresolvedObstacle, ...targets],
  };
  const nextTruck = { ...RECON_RECT, length: 120, width: 80 };
  const targetIds = targets.map(inst => inst.id);

  const grouped = PackLib.stagePlacementIds(pack, targetIds, nextTruck, caseLibrary, { grouped: true });
  const repeated = PackLib.stagePlacementIds(pack, [...targetIds].reverse(), nextTruck, caseLibrary, { grouped: true });
  assert.deepEqual(grouped.failedIds, []);
  assert.deepEqual(repeated.pack.cases, grouped.pack.cases,
    'target input order cannot change the grouped staging plan');
  assert.deepEqual(grouped.pack.cases.find(inst => inst.id === survivor.id), survivor,
    'valid packed survivor is byte-equivalent');
  assert.deepEqual(grouped.pack.cases.find(inst => inst.id === preservedStage.id), preservedStage,
    'valid existing staged obstacle is byte-equivalent');
  assert.deepEqual(grouped.pack.cases.find(inst => inst.id === unresolvedObstacle.id), unresolvedObstacle,
    'unresolved obstacle with explicit geometry is preserved without fabricated data');

  const stagedTargets = grouped.pack.cases.filter(inst => targetIds.includes(inst.id));
  for (const inst of stagedTargets) {
    const caseData = caseLibrary.find(candidate => candidate.id === inst.caseId);
    assert.equal(inst.placement, 'staged');
    assert.deepEqual(inst.transform.rotation, identity, `${inst.id} uses identity staging rotation`);
    assert.deepEqual(inst.orientedDims, caseData.dimensions, `${inst.id} dimensions match its rendered identity pose`);
    assert.equal(inst.transform.position.y, caseData.dimensions.height / 2, `${inst.id} rests on the staging floor`);
    assert.equal(Object.prototype.hasOwnProperty.call(inst, 'packedProfile'), false, `${inst.id} drops packedProfile`);
    assert.deepEqual(inst.metadata, { preserved: inst.id }, `${inst.id} retains unrelated metadata`);
  }

  const groupA = stagedTargets.filter(inst => inst.caseId === 'A')
    .sort((a, b) => a.id.localeCompare(b.id));
  const rowBuckets = new Map();
  for (const inst of groupA) {
    const z = inst.transform.position.z;
    if (!rowBuckets.has(z)) rowBuckets.set(z, []);
    rowBuckets.get(z).push(inst.transform.position.x);
  }
  const rows = [...rowBuckets.entries()].sort((a, b) => a[0] - b[0]);
  assert.equal(rows.length, 2, 'five identical cases wrap into two deterministic rows');
  const firstRow = rows[0][1].sort((a, b) => a - b);
  const partialRow = rows[1][1].sort((a, b) => a - b);
  assert.equal(firstRow.length, 3);
  assert.equal(partialRow.length, 2);
  assert.equal(partialRow[0], firstRow[0], 'partial row restarts at the group X origin');
  assert.deepEqual(firstRow.slice(1).map((x, index) => x - firstRow[index]), [42, 42],
    'identical cases use one uniform X cell step');
  assert.equal(partialRow[1] - partialRow[0], 42, 'partial row uses the same uniform X step');

  const groupB = stagedTargets.filter(inst => inst.caseId === 'B');
  const boundsFor = (instances, dims) => ({
    minX: Math.min(...instances.map(inst => inst.transform.position.x - dims.length / 2)),
    maxX: Math.max(...instances.map(inst => inst.transform.position.x + dims.length / 2)),
    minZ: Math.min(...instances.map(inst => inst.transform.position.z - dims.width / 2)),
    maxZ: Math.max(...instances.map(inst => inst.transform.position.z + dims.width / 2)),
  });
  const aBounds = boundsFor(groupA, caseLibrary[0].dimensions);
  const bBounds = boundsFor(groupB, caseLibrary[1].dimensions);
  const bandsSeparated = aBounds.maxX + 11.999 <= bBounds.minX || bBounds.maxX + 11.999 <= aBounds.minX ||
    aBounds.maxZ + 11.999 <= bBounds.minZ || bBounds.maxZ + 11.999 <= aBounds.minZ;
  assert.equal(bandsSeparated, true, 'different caseId groups reserve separate bands with the staging gap');

  assertCanonicalReconLayoutSafe(
    PackLib,
    grouped.pack.cases.filter(inst => inst.id !== unresolvedObstacle.id),
    nextTruck,
    caseLibrary,
    'Contract B grouped staging'
  );
  const unresolvedAabb = reconAabb(unresolvedObstacle.transform.position, unresolvedObstacle.orientedDims);
  for (const inst of stagedTargets) {
    const dims = caseLibrary.find(candidate => candidate.id === inst.caseId).dimensions;
    const aabb = reconAabb(inst.transform.position, dims);
    const overlaps = aabb.min.x < unresolvedAabb.max.x - 0.001 && aabb.max.x > unresolvedAabb.min.x + 0.001 &&
      aabb.min.y < unresolvedAabb.max.y - 0.001 && aabb.max.y > unresolvedAabb.min.y + 0.001 &&
      aabb.min.z < unresolvedAabb.max.z - 0.001 && aabb.max.z > unresolvedAabb.min.z + 0.001;
    assert.equal(overlaps, false, `${inst.id} avoids the preserved unresolved obstacle`);
  }

  const defaultPlan = PackLib.stagePlacementIds(pack, targetIds, nextTruck, caseLibrary);
  const explicitDefaultPlan = PackLib.stagePlacementIds(pack, targetIds, nextTruck, caseLibrary, { grouped: false });
  assert.deepEqual(explicitDefaultPlan, defaultPlan,
    'omitted options and explicit grouped:false retain the default caller behavior');
});

test('RECON Truck Change preserves 521 organized staged cases across modes and smaller presets', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = { id: 'bulk', name: 'Bulk carton', dimensions: { length: 20, width: 14, height: 12 } };
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
  const boxTruck = { length: 300, width: 90, height: 96, shapeMode: 'rect' };
  const sprinter = { length: 190, width: 70, height: 72, shapeMode: 'rect' };
  const stagedCases = buildLargeReconStagingRows(521, standard, caseData);
  const sourceSnapshot = JSON.stringify(stagedCases);
  const workArea = PackLib.getStagingWorkAreaBounds(standard);
  assert.ok(stagedCases.some(inst => reconAabb(inst.transform.position, caseData.dimensions).max.z > workArea.max.z),
    'fixture contains organized rows beyond the compact preferred staging work area');
  assertLargeReconStagingSafe(PackLib, stagedCases, standard, caseLibrary, '521-case source staging');

  const transitions = [
    ['Standard → Wheel Wells', standard, wheelWells],
    ['Wheel Wells → Standard', wheelWells, standard],
    ['Standard → Front Overhang', standard, frontOverhang],
    ['53 ft → box truck', standard, boxTruck],
    ['53 ft → Sprinter', standard, sprinter],
  ];
  for (const [label, sourceTruck, nextTruck] of transitions) {
    const sourcePack = { id: `large-${label}`, truck: sourceTruck, cases: stagedCases };
    const recon = PackLib.reconcilePlacementsForTruck(sourcePack, nextTruck, caseLibrary);
    assert.deepEqual(recon.summary, {
      kept: 0,
      adjusted: 0,
      invalid: 0,
      stagedUnchanged: 521,
      stagedAdjusted: 0,
      unresolved: 0,
      malformed: 0,
    }, `${label}: every physically safe staged case keeps its semantic category`);
    assert.deepEqual(recon.nextPack.cases, stagedCases,
      `${label}: safe staged poses remain byte-equivalent`);
    const repeated = PackLib.reconcilePlacementsForTruck(sourcePack, nextTruck, caseLibrary);
    assert.deepEqual(repeated.nextPack.cases, recon.nextPack.cases,
      `${label}: repeated reconciliation is deterministic`);
  }

  const boxCommit = PackLib.reconcilePlacementsForTruck(
    { id: 'large-sequential-presets', truck: standard, cases: stagedCases },
    boxTruck,
    caseLibrary
  );
  const sprinterAfterBox = PackLib.reconcilePlacementsForTruck(
    boxCommit.nextPack,
    sprinter,
    caseLibrary
  );
  assert.equal(sprinterAfterBox.summary.stagedUnchanged, 521,
    '53 ft → box truck → Sprinter keeps the original organized staging corridor');
  assert.equal(sprinterAfterBox.summary.stagedAdjusted, 0,
    'a sequential preset shrink does not lose safe-row provenance');
  assert.deepEqual(sprinterAfterBox.nextPack.cases, stagedCases,
    'sequential preset changes keep every safe staged pose byte-equivalent');

  const sequentialHarness = makeTruckChangeHarness();
  const sequentialPreviews = [];
  const sequentialCommits = [];
  const sequentialController = Controller.createTruckChangeController({
    PackLibrary: {
      ...PackLib,
      update: (id, patch) => {
        sequentialCommits.push({ id, patch });
        return { id, ...patch };
      },
    },
    CaseLibrary: { getCases: () => caseLibrary },
    UIComponents: sequentialHarness.UIComponents,
    documentRef: sequentialHarness.documentRef,
  });
  sequentialController.request({
    pack: boxCommit.nextPack,
    nextTruck: sprinter,
    renderPreview: preview => sequentialPreviews.push(preview),
  });
  const sequentialRows = sequentialHarness.modals[0].config.content.children[1].children
    .map(child => child.textContent);
  assert.deepEqual(sequentialRows, [
    '0 kept in place',
    '0 safely adjusted',
    '0 no longer fit (shown in staging preview)',
    '521 existing staged items unchanged',
  ], 'sequential preset modal reports the exact unchanged semantic count');
  sequentialHarness.click(0, 'Apply change');
  assert.equal(sequentialCommits.length, 1);
  assert.deepEqual(sequentialCommits[0].patch.cases, sequentialPreviews[0].pack.cases,
    'sequential preset commit is byte-equivalent to its preview');
  assert.deepEqual(sequentialCommits[0].patch.cases, stagedCases,
    'sequential preset controller keeps every original pose');

  const sourcePack = { id: 'large-controller', truck: standard, cases: stagedCases };
  const runController = () => {
    const harness = makeTruckChangeHarness();
    const previews = [];
    const commits = [];
    const controller = Controller.createTruckChangeController({
      PackLibrary: {
        ...PackLib,
        update: (id, patch) => {
          commits.push({ id, patch });
          return { id, ...patch };
        },
      },
      CaseLibrary: { getCases: () => caseLibrary },
      UIComponents: harness.UIComponents,
      documentRef: harness.documentRef,
    });
    const result = controller.request({
      pack: sourcePack,
      nextTruck: wheelWells,
      renderPreview: preview => previews.push(preview),
    });
    return { harness, previews, commits, result };
  };

  const cancelled = runController();
  assert.equal(cancelled.result.status, 'preview');
  assert.deepEqual(cancelled.previews[0].pack.cases, stagedCases,
    '521-case preview preserves every safe staged pose');
  const summaryRows = cancelled.harness.modals[0].config.content.children[1].children
    .map(child => child.textContent);
  assert.deepEqual(summaryRows, [
    '0 kept in place',
    '0 safely adjusted',
    '0 no longer fit (shown in staging preview)',
    '521 existing staged items unchanged',
  ], 'modal counts remain truthful and do not invent unsafe staged corrections');
  cancelled.harness.click(0, 'Cancel');
  assert.equal(JSON.stringify(stagedCases), sourceSnapshot, 'Cancel is pure for the exact large-load regression');

  const applied = runController();
  assert.deepEqual(applied.previews[0].pack.cases, cancelled.previews[0].pack.cases,
    'repeated 521-case previews are byte-equivalent');
  applied.harness.click(0, 'Apply change');
  assert.equal(applied.commits.length, 1, 'large staged-only Truck Change commits once');
  assert.deepEqual(applied.commits[0].patch.cases, applied.previews[0].pack.cases,
    'large staged-only commit is byte-equivalent to the rendered preview');
  assert.equal(JSON.stringify(stagedCases), sourceSnapshot, 'controller never mutates the caller snapshot');
});

test('legacy org-sync handler is hint-only and does not call handleIncomingOrgContextSync', async () => {
  const app = await readAppSource();

  // The legacy-active-org-id string must still exist (as a log label)
  assert.match(app, /legacy-hint/,
    'legacy handler must use hint-only pattern');

  // Legacy handler must NOT build a synthetic payload with handleIncomingOrgContextSync
  // Extract the ORG_CONTEXT_LS_KEY block — it's between "if (key === ORG_CONTEXT_LS_KEY)" and the next "return;"
  const lsKeyIdx = app.indexOf('key === ORG_CONTEXT_LS_KEY');
  assert.ok(lsKeyIdx > 0, 'ORG_CONTEXT_LS_KEY handler must exist');
  const lsBlock = app.slice(lsKeyIdx, lsKeyIdx + 1200);
  assert.equal(lsBlock.includes('handleIncomingOrgContextSync'), false,
    'legacy LS_KEY handler must not call handleIncomingOrgContextSync directly');
  assert.equal(lsBlock.includes('epoch: Date.now()'), false,
    'legacy handler must not use epoch: Date.now()');
  assert.equal(lsBlock.includes('nextOrgContextVersion()'), false,
    'legacy handler must not call nextOrgContextVersion()');

  // Must use refreshOrgContext as the fallback
  assert.ok(lsBlock.includes('refreshOrgContext'),
    'legacy handler must fall back to refreshOrgContext');
});

test('bundle-inflight flag remains scoped to org context sync', async () => {
  const app = await readAppSource();

  // Variable exists
  assert.match(app, /let _orgBundleFetchInflightForOrg\s*=\s*null/,
    '_orgBundleFetchInflightForOrg variable must exist');

  // Set before refreshOrgContext in handleIncomingOrgContextSync
  const syncFnMatch = app.match(/function handleIncomingOrgContextSync\b[\s\S]*?void refreshOrgContext/);
  assert.ok(syncFnMatch, 'handleIncomingOrgContextSync must call refreshOrgContext');
  assert.ok(syncFnMatch[0].includes('_orgBundleFetchInflightForOrg = incomingOrgId'),
    'must set _orgBundleFetchInflightForOrg before refreshOrgContext');

  // Cleared in applyOrgContextFromBundle
  assert.match(app, /_orgBundleFetchInflightForOrg === nextOrgIdStr\) _orgBundleFetchInflightForOrg = null/,
    'must clear inflight flag in applyOrgContextFromBundle');

  // Cleared in clearOrgContext
  const clearBlock = app.slice(
    app.indexOf('function clearOrgContext'),
    app.indexOf('function clearOrgContext') + 600
  );
  assert.ok(clearBlock.includes('_orgBundleFetchInflightForOrg = null'),
    'must clear inflight flag in clearOrgContext');

  assert.doesNotMatch(app, /defer:latch-wait-bundle/,
    'trial_expired modal should no longer wait for bundle latch branches');
});

test('org-invite rejects admin actors creating admin invites while preserving owner/admin role targets', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');

  assert.match(src, /const VALID_ROLES = new Set\(\["admin", "member"\]\)/,
    'invite creation must still allow owners to invite admins and members');
  assert.match(src, /requestedRole === "owner"[\s\S]*Owner invites are not allowed/,
    'owner-role invites must remain rejected at creation time');
  assert.match(src, /actorRole === "admin" && role === "admin"[\s\S]*status:\s*403/,
    'admin actors must get 403 when directly requesting an admin invite');
  assert.doesNotMatch(src, /actorRole === "owner" && role === "admin"[\s\S]*status:\s*403/,
    'owners must not be blocked from creating admin invites');
  assert.doesNotMatch(src, /actorRole === "admin" && role === "member"[\s\S]*status:\s*403/,
    'admins must not be blocked from creating member invites');
});

test('org-invite-accept only accepts member/admin roles and rejects legacy owner-role rows', async () => {
  const src = await fs.readFile(orgInviteAcceptPath, 'utf8');

  const roleFnMatch = src.match(/function normalizeAcceptedInviteRole\b[\s\S]*?^}/m);
  assert.ok(roleFnMatch, 'org-invite-accept must use an accepted-invite role normalizer');
  const roleFn = roleFnMatch[0];

  assert.match(roleFn, /"admin" \|\| role === "member"/,
    'accepted invites may create only admin or member memberships');
  assert.doesNotMatch(roleFn, /role === "owner"/,
    'accepted invites must never normalize owner as an accepted membership role');
  assert.match(src, /const role = normalizeAcceptedInviteRole\(invite\.role\);[\s\S]*if \(!role\)[\s\S]*Invite role is no longer valid/,
    'invalid or owner-role invite rows must be rejected before membership upsert');
});

test('org-invite-accept remains idempotent for the same invited user after email and role validation', async () => {
  const src = await fs.readFile(orgInviteAcceptPath, 'utf8');

  const emailGuardIdx = src.indexOf('inviteEmail !== userEmail');
  const roleGuardIdx = src.indexOf('if (!role)');
  const acceptedBranchIdx = src.indexOf('inviteStatus === "accepted"');

  assert.ok(acceptedBranchIdx > emailGuardIdx,
    'idempotent accepted-token response must run after authenticated email validation');
  assert.ok(acceptedBranchIdx > roleGuardIdx,
    'idempotent accepted-token response must run after accepted role validation');
  assert.match(src, /inviteStatus === "accepted"[\s\S]*already_accepted:\s*true[\s\S]*organization_id: invite\.organization_id/,
    'same invited user should still get an idempotent already_accepted response');
});

test('settings members confirms invite revoke with the existing danger modal path', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /revokeBtn\.addEventListener\('click'[\s\S]*UIComponents\.confirm\(\{[\s\S]*title: 'Revoke invite'[\s\S]*danger: true/,
    'pending invite revoke must use UIComponents.confirm with danger styling');
  assert.match(src, /if \(ok\) revokeInvite\(orgId, invite\);/,
    'revokeInvite must only run after confirmation succeeds');
});

test('settings members permission loading has a local timeout error instead of indefinite loading', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /const _MEMBERS_PERMISSION_TIMEOUT_MS = 10000/,
    'members permission loading must have a bounded timeout');
  assert.match(src, /rolePendingTimedOut = \(now - _membersPermissionPendingSince\) >= _MEMBERS_PERMISSION_TIMEOUT_MS/,
    'role pending state must flip to a timeout after the configured interval');
  assert.match(src, /Could not confirm your permissions\. Refresh and try again\./,
    'permission timeout must show a clear error message');
  assert.match(src, /tp3d-org-feedback tp3d-org-feedback--error/,
    'permission timeout must use the existing error feedback styling');
});

test('organization invite expiration migration adds expires_at and indexes pending expiry', async () => {
  const sql = await fs.readFile(orgInviteExpirationMigrationPath, 'utf8');

  assert.match(sql, /add column if not exists expires_at timestamptz/i,
    'migration must add organization_invites.expires_at');
  assert.match(sql, /set expires_at = coalesce\(invited_at, created_at, now\(\)\) \+ interval '7 days'/i,
    'pending invite backfill must use invited_at/created_at plus 7 days');
  assert.match(sql, /where status = 'pending'[\s\S]*accepted_at is null[\s\S]*revoked_at is null[\s\S]*expires_at is null/i,
    'backfill must target only unaccepted/unrevoked pending invites without expiry');
  assert.match(sql, /create index if not exists organization_invites_pending_expires_at_idx[\s\S]*on public\.organization_invites\(expires_at\)/i,
    'migration must add a useful pending-expiry index');
});

test('supabase client invite list selects expires_at for Settings pending invite UI', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');

  assert.match(src, /function getOrganizationInvites\b[\s\S]*\.select\('id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at'\)/,
    'getOrganizationInvites must select expires_at so Settings can render real invite expiration');
});

test('org-invite sets and refreshes expires_at on invite create and resend', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');

  assert.match(src, /const INVITE_EXPIRATION_DAYS = 7/,
    'org-invite must use a 7-day invite lifetime');
  assert.match(src, /function inviteExpiresAt\b[\s\S]*INVITE_EXPIRATION_DAYS \* 24 \* 60 \* 60 \* 1000/,
    'org-invite must compute expires_at from now plus the configured lifetime');
  assert.match(src, /const expiresAtIso = inviteExpiresAt\(now\)/,
    'org-invite must compute one expires_at value per request');
  assert.match(src, /expires_at: expiresAtIso/,
    'org-invite payload must include expires_at for both insert and update paths');
  assert.match(src, /\.update\(payload\)[\s\S]*\.select\("id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at"\)/,
    'resend/update path must return refreshed expires_at');
  assert.match(src, /\.insert\(\{[\s\S]*\.\.\.payload[\s\S]*\}\)[\s\S]*\.select\("id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at"\)/,
    'create path must return expires_at');
});

test('phase 3A org-invite sends Resend email using env-only configuration', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');

  assert.match(src, /getEnvTrimmed\("RESEND_API_KEY"\)/,
    'org-invite must read RESEND_API_KEY from Deno.env only');
  assert.match(src, /getEnvTrimmed\("INVITE_EMAIL_FROM"\)/,
    'org-invite must read INVITE_EMAIL_FROM from Deno.env');
  assert.match(src, /getEnvTrimmed\("SUPPORT_EMAIL"\)/,
    'org-invite must read SUPPORT_EMAIL from Deno.env where support copy is used');
  assert.match(src, /fetch\("https:\/\/api\.resend\.com\/emails"/,
    'org-invite must send through the Resend email API');
  assert.match(src, /Authorization:\s*`Bearer \$\{apiKey\}`/,
    'Resend authorization must be built from the env-read API key');
  assert.doesNotMatch(src, /RESEND_API_KEY\s*=\s*["']|re_[A-Za-z0-9_=-]{8,}/,
    'org-invite must not hardcode a Resend API key');
});

test('phase 3A org-invite email failure preserves invite creation and returns safe status', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');
  const sendStart = src.indexOf('async function sendInviteEmail');
  const sendEnd = src.indexOf('async function getActorRole', sendStart);
  const sendFn = sendStart >= 0 && sendEnd > sendStart ? src.slice(sendStart, sendEnd) : '';
  const successReturnStart = src.indexOf('invite_link: inviteLink');
  const successReturn = successReturnStart >= 0 ? src.slice(Math.max(0, successReturnStart - 250), successReturnStart + 350) : '';
  const invitePersistIdx = src.lastIndexOf('inviteRecord = data as Record<string, unknown>;', successReturnStart);
  const emailSendIdx = src.indexOf('const emailResult = await sendInviteEmail', invitePersistIdx);

  assert.match(sendFn, /return \{ email_sent: false, email_status: "not_configured" \}/,
    'missing Resend configuration must not throw or fail invite creation');
  assert.match(sendFn, /catch \{[\s\S]*return \{ email_sent: false, email_status: "send_failed" \}/,
    'Resend network failures must be downgraded to send_failed');
  assert.match(sendFn, /if \(res\.ok\)[\s\S]*return \{ email_sent: true, email_status: "sent" \}/,
    'successful Resend delivery must return sent status');
  assert.ok(invitePersistIdx > 0 && emailSendIdx > invitePersistIdx,
    'org-invite must persist the invite before attempting email delivery');
  assert.match(successReturn, /ok:\s*true[\s\S]*invite_link:\s*inviteLink[\s\S]*email_sent:\s*emailResult\.email_sent[\s\S]*email_status:\s*emailResult\.email_status/,
    'org-invite response must preserve invite creation while returning safe email status fields');
  assert.doesNotMatch(successReturn, /\btoken,\b/,
    'org-invite must not return the raw invite token field');
  assert.doesNotMatch(sendFn, /\.json\(\)/,
    'org-invite must not expose or forward Resend response details');
});

test('phase 3A org-invite logs no invite token or secret-bearing values', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');
  const consoleCalls = (src.match(/console\.(?:log|warn|error)\([\s\S]*?\);/g) || []).join('\n');

  assert.doesNotMatch(consoleCalls, /inviteLink|invite_link|\btoken\b|apiKey|RESEND_API_KEY|Authorization|Bearer|access_token|refresh_token|JWT|service.?role|STRIPE_SECRET/i,
    'org-invite console logs must not include invite tokens or secret-bearing values');
  assert.match(consoleCalls, /organization_id[\s\S]*invited_email[\s\S]*email_status[\s\S]*status/,
    'Resend failure logs may include only safe delivery metadata and HTTP status');
});

test('phase 3A Settings preserves Copy Link fallback and reports invite email status', async () => {
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(billingSrc, /email_sent: Boolean\(data && data\.email_sent\)/,
    'billing service must preserve safe email_sent response');
  assert.match(billingSrc, /email_status: data && data\.email_status \? String\(data\.email_status\) : 'not_configured'/,
    'billing service must preserve safe email_status response');
  assert.match(settingsSrc, /function getInviteDeliveryToast\(result, action = 'create'\)/,
    'Settings must map email status to user-facing invite feedback');
  assert.match(settingsSrc, /Invite email sent\. You can also copy the invite link\./,
    'Settings must show successful email delivery copy');
  assert.match(settingsSrc, /Invite link created, but email was not sent\. Use Copy Link to share it\./,
    'Settings must keep manual Copy Link fallback when email is not sent');
  assert.match(settingsSrc, /label: 'Copy Link'/,
    'Settings must preserve Copy Link actions');
});

test('phase 3C1 invite handoff visibility fix adds no token logging or reload side-effects', async () => {
  const src = await readAppSource();
  // Scope checks to the renderInviteHandoffNotice function only — this is the function modified by the fix.
  const fnStart = src.indexOf('function renderInviteHandoffNotice(');
  const fnEnd = src.indexOf('function setInviteHandoffNotice(', fnStart);
  const fnBody = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';

  assert.ok(fnBody.length > 0, 'renderInviteHandoffNotice must be extractable for side-effect check');

  // Visibility fix must not introduce any console output inside renderInviteHandoffNotice
  assert.doesNotMatch(fnBody, /console\./,
    'renderInviteHandoffNotice must not log token-bearing or session-bearing state');

  // No reload must be introduced
  assert.doesNotMatch(fnBody, /location\.reload|window\.location\.reload/,
    'renderInviteHandoffNotice must not add a location.reload');
  assert.doesNotMatch(fnBody, /setTimeout[\s\S]{0,80}location\.reload/,
    'renderInviteHandoffNotice must not introduce a timed reload');

  // No raw token values must be inserted into the DOM via the notice function
  assert.doesNotMatch(fnBody, /textContent\s*=[\s\S]{0,80}(pendingInviteToken|tokenFromUrl|storedToken)/,
    'renderInviteHandoffNotice must not expose raw invite token values in UI');

  // No JWT-bearing headers or service credentials introduced by the visibility fix
  assert.doesNotMatch(fnBody, /refresh_token|Bearer|service.?role|SUPABASE_SERVICE/i,
    'renderInviteHandoffNotice must not reference JWT bearer headers or service credentials');
});

test('phase 3C1 invite rejection failure path does not log token or JWT values', async () => {
  const src = await readAppSource();
  const start = src.indexOf('async function tryAcceptPendingInvite(');
  const end = src.indexOf('if (!authListenerInstalled)', start);
  const fnBody = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fnBody.length > 0, 'tryAcceptPendingInvite must be extractable');

  assert.doesNotMatch(fnBody, /console\./,
    'tryAcceptPendingInvite must not log any state (prevents token/session leakage)');
  assert.doesNotMatch(fnBody, /pendingInviteToken[\s\S]{0,60}textContent|console[\s\S]{0,60}pendingInviteToken/,
    'tryAcceptPendingInvite must not expose raw invite token in UI or logs');
  // session.access_token is a legitimate session presence check — exclude it.
  // Only flag logging/display of bearer headers, service credentials, or refresh tokens.
  assert.doesNotMatch(fnBody, /refresh_token|Bearer|service.?role|SUPABASE_SERVICE/i,
    'tryAcceptPendingInvite must not reference bearer headers or service credentials');
});

test('org-invite-accept rejects expired pending invites before membership insert without exposing organization_id', async () => {
  const src = await fs.readFile(orgInviteAcceptPath, 'utf8');

  assert.match(src, /\.select\("id, organization_id, email, role, status, expires_at, accepted_at, revoked_at"\)/,
    'org-invite-accept must fetch expires_at');
  assert.match(src, /function isInviteExpired\b[\s\S]*expiresAt\.getTime\(\) <= Date\.now\(\)/,
    'org-invite-accept must classify past expires_at as expired');

  const expiryIdx = src.indexOf('isInviteExpired(invite.expires_at)');
  const memberInsertIdx = src.indexOf('.from("organization_members")');
  assert.ok(expiryIdx > 0, 'expired invite guard must exist');
  assert.ok(memberInsertIdx > expiryIdx,
    'expired invite guard must run before membership insert/upsert');

  const expiredBranch = src.slice(expiryIdx, memberInsertIdx);
  assert.match(expiredBranch, /This invite link has expired\. Please ask the workspace owner to send a new invite\./,
    'expired invite response must be clear and safe');
  assert.doesNotMatch(expiredBranch, /organization_id/,
    'expired invite response must not expose organization_id');
});

test('settings members shows pending invite expiration state without new CSS', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function getInviteExpirationView\b/,
    'settings members must format invite expiry state');
  assert.match(src, /Expires in \$\{days\} days/,
    'future invites must show Expires in X days');
  assert.match(src, /Expires today/,
    'near-expiry invites must show Expires today');
  assert.match(src, /text: 'Expired'[\s\S]*tp3d-org-feedback tp3d-org-feedback--error/,
    'expired pending invites must use existing error styling');
  assert.match(src, /getInviteExpirationView\(invite\.expires_at\)[\s\S]*statusBadge\.textContent = expirationView\.expired \? 'Expired' : 'Pending'/,
    'expired pending invites must not look like valid pending invites');
});

test('settings overlay locks lost workspace and hides workspace-scoped controls', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /let orgAccessLostHandler = null/,
    'settings overlay must track its access-loss event listener');
  assert.match(src, /let _orgAccessLostId = ''/,
    'settings overlay must track the locked lost org id locally');
  assert.match(src, /function ensureOrgAccessLostListener\b[\s\S]*window\.addEventListener\('tp3d:org-access-lost', orgAccessLostHandler\)/,
    'settings overlay must listen for tp3d:org-access-lost while open');
  assert.match(src, /if \(!eventUserId \|\| !currentUserId \|\| eventUserId !== currentUserId\) return/,
    'settings overlay must ignore access-loss events for other users');
  assert.match(src, /if \(!lostOrgId \|\| !lockedOrgId \|\| lostOrgId !== lockedOrgId\) return/,
    'settings overlay must only lock the matching modal org');
  assert.match(src, /function removeOrgAccessLostListener\b[\s\S]*window\.removeEventListener\('tp3d:org-access-lost', orgAccessLostHandler\)/,
    'settings overlay must remove the access-loss listener on close');
  assert.match(src, /if \(_orgAccessLostId && _orgAccessLostId !== next\) \{[\s\S]*_orgAccessLostId = '';/,
    'settings overlay must clear lost-access state on org switch');
});

test('phase 0.5D keeps native dialogs absent from Settings overlay', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.equal(src.includes('window.alert'), false);
  assert.equal(src.includes('window.confirm'), false);
  assert.equal(src.includes('window.prompt'), false);
});

test('phase 0.6D-pre org-member-remove blocks admin actors removing admin targets', async () => {
  const src = await fs.readFile(orgMemberRemovePath, 'utf8');
  const targetRoleIndex = src.indexOf('const targetRole = target.role;');
  const adminGuardIndex = src.indexOf('Only workspace owners can remove admins.');
  const deleteIndex = src.indexOf('.from("organization_members")', adminGuardIndex);

  assert.ok(targetRoleIndex >= 0, 'org-member-remove must load target role before removal checks');
  assert.ok(adminGuardIndex > targetRoleIndex,
    'org-member-remove must check admin target removal after target membership is loaded');
  assert.ok(deleteIndex > adminGuardIndex,
    'org-member-remove must reject admin-on-admin removal before any delete');
  assert.match(src, /if \(targetRole === "admin" && actor\.role !== "owner"\) \{[\s\S]*Only workspace owners can remove admins\.[\s\S]*status: 403/,
    'non-owner actors must receive 403 when removing an admin target');
  assert.match(src, /if \(targetRole === "owner"\) \{[\s\S]*Only owners can remove owners\./,
    'owner removal guard must remain intact');
});

test('phase 0.6D-pre org member delete policy lets admins delete members only', async () => {
  const src = await fs.readFile(orgMemberAdminDeleteGuardMigrationPath, 'utf8');

  assert.match(src, /drop policy if exists "org_members_delete_owner_admin" on public\.organization_members;/,
    'migration must replace the existing delete policy');
  assert.match(src, /create policy "org_members_delete_owner_admin"[\s\S]*for delete/,
    'migration must recreate the delete policy');
  assert.match(src, /public\.tp3d_is_org_owner\(organization_id\)[\s\S]*public\.tp3d_org_owner_count_excluding\(organization_id, user_id\) >= 1/,
    'owner branch and last-owner protection must remain');
  assert.match(src, /public\.tp3d_is_org_admin\(organization_id\)[\s\S]*role = 'member'::public\.org_member_role/,
    'admin branch must be limited to deleting member rows');
  assert.doesNotMatch(src, /public\.tp3d_is_org_admin\(organization_id\)[\s\S]{0,120}role <> 'owner'::public\.org_member_role/,
    'admin branch must not allow deleting all non-owner rows');
});

test('phase 0.6D-pre admin removal guard avoids billing workspace and data scope creep', async () => {
  const removeSrc = await fs.readFile(orgMemberRemovePath, 'utf8');
  const migrationSrc = await fs.readFile(orgMemberAdminDeleteGuardMigrationPath, 'utf8');
  const combined = `${removeSrc}\n${migrationSrc}`;

  assert.doesNotMatch(combined, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'admin removal guard must not touch billing or Stripe scope');
  assert.doesNotMatch(combined, /\.from\(["']organizations["']\)[\s\S]{0,120}\.delete\(|delete\s+from\s+public\.organizations/i,
    'admin removal guard must not delete organizations');
  assert.doesNotMatch(combined, /\.from\(["']organization_invites["']\)|delete\s+from\s+public\.organization_invites/i,
    'admin removal guard must not mutate invites');
  assert.doesNotMatch(combined, /\.from\(["'](?:packs|cases)["']\)|delete\s+from\s+public\.(?:packs|cases)|storage\.from/i,
    'admin removal guard must not mutate packs, cases, or storage');
});

test('phase 0.6D-pre billing-status treats archived resolved org as unavailable', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const activeLookupStart = src.indexOf('const activeOrgRes = await admin');
  const ownerWorkspaceStart = src.indexOf('const ownerMembershipsRes = await admin', activeLookupStart);
  const activeLookup = activeLookupStart >= 0 && ownerWorkspaceStart > activeLookupStart
    ? src.slice(activeLookupStart, ownerWorkspaceStart)
    : '';

  assert.ok(activeLookup, 'billing-status active organization lookup block must be extractable');
  assert.match(activeLookup, /\.from\("organizations"\)[\s\S]*\.select\("id, owner_id, created_at, archived_at"\)/,
    'billing-status must read archived_at for the resolved organization');
  assert.match(activeLookup, /const archivedAt = activeOrgRes\.data\?\.archived_at \? String\(activeOrgRes\.data\.archived_at\) : ""/,
    'billing-status must detect archived resolved organizations');
  assert.match(activeLookup, /if \(archivedAt\) \{[\s\S]*archived: true[\s\S]*entitlementStatus: "billing_unavailable"[\s\S]*workspaceIncluded: false[\s\S]*isActive: false[\s\S]*isPro: false/,
    'archived resolved organizations must return a safe inactive billing response');
});

test('phase 0.6D-pre billing-status keeps archived workspaces counted toward limits', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const ownerWorkspacesStart = src.indexOf('const ownerWorkspacesRes = await admin');
  const ownerWorkspacesEnd = src.indexOf('workspaceCount = ownerWorkspaces.length;', ownerWorkspacesStart);
  const ownerWorkspaceBlock = ownerWorkspacesStart >= 0 && ownerWorkspacesEnd > ownerWorkspacesStart
    ? src.slice(ownerWorkspacesStart, ownerWorkspacesEnd)
    : '';

  assert.ok(ownerWorkspaceBlock, 'owner workspace count block must be extractable');
  assert.match(ownerWorkspaceBlock, /\.from\("organizations"\)[\s\S]*\.select\("id, created_at"\)[\s\S]*\.eq\("owner_id", billingOwnerUserId\)[\s\S]*\.in\("id", ownerMembershipOrgIds\)/,
    'owner workspace count must still count owner organization rows from memberships');
  assert.doesNotMatch(ownerWorkspaceBlock, /archived_at|\.is\(["']archived_at["']|\.not\(["']archived_at["']/,
    'owner workspace count must not silently exclude archived workspaces');
});

test('phase 0.6D-pre billing-status archived guard avoids Stripe checkout portal webhook scope creep', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const activeLookupStart = src.indexOf('const activeOrgRes = await admin');
  const ownerWorkspaceStart = src.indexOf('const ownerMembershipsRes = await admin', activeLookupStart);
  const activeLookup = activeLookupStart >= 0 && ownerWorkspaceStart > activeLookupStart
    ? src.slice(activeLookupStart, ownerWorkspaceStart)
    : '';

  assert.ok(activeLookup, 'billing-status archived guard block must be extractable');
  assert.doesNotMatch(activeLookup, /stripeClient|checkout|webhook|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'archived active-org guard must not add Stripe, checkout, portal, webhook, or billing table scope');
  assert.doesNotMatch(activeLookup, /portalAvailable:\s*true|createBillingPortal|portalUrl/i,
    'archived active-org guard must not enable billing portal behavior');
});

test('phase 0.6A org-leave-workspace verifies membership and blocks unsafe owner leaves', async () => {
  const src = await fs.readFile(orgLeaveWorkspacePath, 'utf8');

  assert.match(src, /const membership = await getMembership\(sb, orgId, userId\)/,
    'leave-workspace must verify the current user membership');
  assert.match(src, /You are not a member of this workspace\./,
    'leave-workspace must block non-members safely');
  assert.match(src, /\.from\("organizations"\)[\s\S]*\.select\("owner_id"\)/,
    'leave-workspace must read organizations.owner_id');
  assert.match(src, /orgOwnerId && orgOwnerId === userId/,
    'leave-workspace must compare organizations.owner_id to the current user');
  assert.match(src, /You cannot leave this workspace because you are the primary owner\. Transfer ownership first\./,
    'leave-workspace must block the primary owner with transfer copy');
  assert.match(src, /You cannot leave this workspace because you are the last owner\. Transfer ownership or add another owner first\./,
    'leave-workspace must block the last owner with clear copy');
});

test('phase 0.6A org-leave-workspace deletes only the current user membership row', async () => {
  const src = await fs.readFile(orgLeaveWorkspacePath, 'utf8');

  assert.match(src, /\.from\("organization_members"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("organization_id", orgId\)[\s\S]*\.eq\("user_id", userId\)/,
    'leave-workspace must delete only the calling user membership row');
  assert.doesNotMatch(src, /\.from\("organizations"\)\s*\n\s*\.delete\(\)/,
    'leave-workspace must not delete the organization');
  assert.match(src, /return json\(\{ ok: true, organization_id: orgId \}/,
    'leave-workspace must return the removed organization_id');
});

test('phase 0.6A org-leave-workspace does not touch billing or Stripe', async () => {
  const src = await fs.readFile(orgLeaveWorkspacePath, 'utf8');

  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'leave-workspace must not reference billing or webhook tables');
  assert.doesNotMatch(src, /stripe|checkout|portal|billing-status/i,
    'leave-workspace must not reference Stripe, checkout, portal, or billing-status');
});

test('phase 0.6A billing service exports leaveWorkspace wrapper', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(src, /export async function leaveWorkspace\(orgId\)/,
    'billing service must export leaveWorkspace');
  assert.match(src, /postFn\('\/org-leave-workspace'[\s\S]*organization_id: orgId/,
    'leaveWorkspace must POST organization_id to /org-leave-workspace');
  assert.match(src, /return \{ ok: true, organization_id: organizationId \}/,
    'leaveWorkspace must return normalized organization_id on success');
});

test('phase 0.6A settings general uses safe leave workspace UI', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('async function leaveWorkspace(orgId, orgName)');
  const end = src.indexOf('// ---- Organization invites ----', start);
  const handler = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(src, /leaveWorkspace as leaveWorkspaceFn/,
    'settings overlay must import leaveWorkspace');
  assert.match(src, /let _leaveWorkspaceInFlight = false/,
    'settings overlay must track leave in-flight state');
  assert.match(handler, /leaveWorkspaceFn\(normalizedOrgId\)/,
    'settings leave handler must call the service wrapper');
  assert.match(handler, /TruckPackerApp\.handleWorkspaceLeft\(normalizedOrgId, \{ source: 'settings-leave-workspace' \}\)/,
    'settings leave handler must call app post-leave helper');
  assert.match(handler, /queueAccountBundleRefresh\(\{ force: true, source: 'settings-leave-workspace' \}\)/,
    'settings leave handler must have an org/account refresh fallback');
  assert.match(src, /UIComponents\.confirm\(\{[\s\S]*title: 'Leave Workspace'[\s\S]*danger: true/,
    'leave action must use UIComponents.confirm with danger styling');
  assert.match(src, /leaveBtn\.disabled = _leaveWorkspaceInFlight \|\| isPrimaryOwner/,
    'leave button must disable while in flight and for primary owner');
  assert.match(src, /Transfer Workspace ownership before leaving\. You are the primary owner\./,
    'primary owner must see transfer-ownership helper copy');
  assert.doesNotMatch(src, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native browser dialogs');
});

test('phase 0.6A does not introduce restore transfer delete or export workspace flows', async () => {
  const edgeSrc = await fs.readFile(orgLeaveWorkspacePath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const appSrc = await readAppSource();
  const appStart = appSrc.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const appEnd = appSrc.indexOf('// Expose billing pump globally', appStart);
  const helper = appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : '';
  const settingsStart = settingsSrc.indexOf('async function leaveWorkspace(orgId, orgName)');
  const settingsEnd = settingsSrc.indexOf('async function restoreArchivedWorkspace(orgId, orgName)', settingsStart);
  const settingsHandler = settingsStart >= 0 && settingsEnd > settingsStart
    ? settingsSrc.slice(settingsStart, settingsEnd)
    : '';

  for (const [label, src] of [
    ['org-leave-workspace', edgeSrc],
    ['handleWorkspaceLeft', helper],
    ['settings leaveWorkspace', settingsHandler],
  ]) {
    assert.doesNotMatch(src, /restoreWorkspace|transferOwnership|deleteWorkspace|exportWorkspace/,
      `${label} must not add restore/transfer/delete/export flows beyond Leave Workspace`);
  }
});

test('phase 0.6A-2 handleWorkspaceLeft syncs UI around forced org refresh', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const end = src.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(helper, 'handleWorkspaceLeft must exist');
  assert.match(helper, /clearBillingPendingRetry\(normalizedLeftOrgId\)/,
    'handleWorkspaceLeft must keep clearing billing pending retry for the left org');
  assert.match(helper, /if \(billingOrgId === normalizedLeftOrgId\) \{[\s\S]*clearBillingState\(\)/,
    'handleWorkspaceLeft must keep scoped stale billing cleanup for the left org');
  assert.match(helper, /SupabaseClient\.invalidateAccountCache\(\)/,
    'handleWorkspaceLeft must invalidate stale account bundle cache after membership self-removal');
  assert.match(helper, /syncWorkspaceUiAfterOrgRefresh\(source\)[\s\S]*refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'handleWorkspaceLeft must sync workspace UI before or alongside forced org refresh');
  assert.match(helper, /const refreshPromise = refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)[\s\S]*return refreshPromise/,
    'handleWorkspaceLeft must return the forced org refresh promise');
  assert.match(helper, /syncWorkspaceUiAfterOrgRefresh\(source \+ ':refreshed'\)/,
    'handleWorkspaceLeft must sync workspace UI again after org refresh settles');
  assert.doesNotMatch(helper, /signOut|forceLocalSignedOut|location\.reload|window\.location/,
    'handleWorkspaceLeft must not sign out or reload');
});

test('phase 0.6A-2 account switcher chip uses workspace initials instead of user initials', async () => {
  const src = await readAppSource();
  const displayStart = src.indexOf('function getDisplay()');
  const displayEnd = src.indexOf('function renderButton(buttonEl)', displayStart);
  const displayFn = displayStart >= 0 && displayEnd > displayStart ? src.slice(displayStart, displayEnd) : '';
  const renderStart = src.indexOf('function renderButton(buttonEl)');
  const renderEnd = src.indexOf('function createWorkspacePrompt()', renderStart);
  const renderFn = renderStart >= 0 && renderEnd > renderStart ? src.slice(renderStart, renderEnd) : '';

  assert.match(src, /function getActiveWorkspaceInitials\(\)[\s\S]*orgContext && orgContext\.activeOrg[\s\S]*name\.charAt\(0\)\.toUpperCase\(\)/,
    'app must derive switcher initials from active workspace name');
  assert.match(displayFn, /orgInitials: noActiveWorkspace \? '' : getActiveWorkspaceInitials\(\)/,
    'AccountSwitcher display object must expose workspace-derived initials when an active workspace exists');
  assert.match(displayFn, /userName: noActiveWorkspace \? 'Create or join' : displayName \|\| '—'/,
    'AccountSwitcher must keep the secondary user/account display label for active workspace states');
  assert.match(renderFn, /avatarEl\.textContent = display\.orgInitials \|\| ''/,
    'AccountSwitcher chip avatar must render workspace initials');
  assert.doesNotMatch(renderFn, /avatarEl\.textContent = display\.initials/,
    'AccountSwitcher chip avatar must not render user/account initials');
});

test('phase 0.6A-2 bottom-left workspace chip avatar is circular', async () => {
  const src = await fs.readFile(indexHtmlPath, 'utf8');
  const btnIdx = src.indexOf('id="btn-account-switcher"');
  const chipSnippet = btnIdx >= 0 ? src.slice(btnIdx, btnIdx + 700) : '';

  assert.match(chipSnippet, /class="brand-mark tp3d-settings-account-avatar"[\s\S]*border-radius: 50%/,
    'bottom-left workspace chip avatar must use circular border radius');
  assert.doesNotMatch(chipSnippet, /border-radius: 12px/,
    'bottom-left workspace chip avatar must not keep the old square-ish 12px radius');
});

test('phase 0.6A-2 chip sync patch does not add Stripe billing-status or reload behavior', async () => {
  const appSrc = await readAppSource();
  const start = appSrc.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const end = appSrc.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? appSrc.slice(start, end) : '';
  const renderStart = appSrc.indexOf('function renderButton(buttonEl)');
  const renderEnd = appSrc.indexOf('function createWorkspacePrompt()', renderStart);
  const renderFn = renderStart >= 0 && renderEnd > renderStart ? appSrc.slice(renderStart, renderEnd) : '';

  assert.doesNotMatch(helper + renderFn, /billing-status|billing_customers|subscriptions|stripe_customers|webhook_events|stripe|checkout|portal/i,
    'chip sync patch must not add billing-status, Stripe, or billing table behavior');
  assert.doesNotMatch(helper + renderFn, /signOut|forceLocalSignedOut|location\.reload|window\.location/,
    'chip sync patch must not sign out or reload');
});

test('phase 0.6B org-invite-revoke loads invite before update and verifies actor role for invite org', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');
  const loadIdx = src.indexOf('const invite = await getInvite(sb, inviteId)');
  const updateIdx = src.indexOf('.update({ status: "revoked", revoked_at: nowIso })');

  assert.match(src, /function getInvite\b[\s\S]*\.from\("organization_invites"\)[\s\S]*\.select\("id, organization_id, role, status, accepted_at, revoked_at"\)/,
    'invite revoke must load the invite row before authorizing or updating');
  assert.ok(loadIdx > 0 && updateIdx > loadIdx,
    'invite revoke must load invite details before issuing the revoke update');
  assert.match(src, /function getActorRole\b[\s\S]*\.from\("organization_members"\)[\s\S]*\.eq\("organization_id", orgId\)[\s\S]*\.eq\("user_id", userId\)/,
    'invite revoke must verify owner/admin membership for the invite organization');
  assert.match(src, /Only workspace owners\/admins can revoke invites\./,
    'non-manager actors must be rejected');
});

test('phase 0.6B org-invite-revoke enforces owner/admin invite role rules', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');

  assert.match(src, /const MANAGER_ROLES = new Set\(\["owner", "admin"\]\)/,
    'owners and admins are the only manager roles');
  assert.match(src, /const REVOKABLE_INVITE_ROLES = new Set\(\["admin", "member"\]\)/,
    'only admin/member invite roles are normal revocation targets');
  assert.match(src, /if \(inviteRole === "owner"\)[\s\S]*Owner-role invite rows are invalid and cannot be revoked\./,
    'legacy owner-role invite rows must be rejected');
  assert.match(src, /if \(actorRole === "admin" && inviteRole !== "member"\)[\s\S]*Only workspace owners can revoke admin invites\./,
    'admins must only be able to revoke member invites');
});

test('phase 0.6B org-invite-revoke blocks accepted invites and makes already revoked idempotent', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');

  assert.match(src, /if \(invite\.status === "accepted" \|\| invite\.accepted_at\)[\s\S]*Accepted invites cannot be revoked\./,
    'accepted invites must return a safe conflict instead of being revoked');
  assert.match(src, /if \(invite\.status === "revoked" \|\| invite\.revoked_at\)[\s\S]*already_revoked: true[\s\S]*invite_id: invite\.id/,
    'already revoked invites must return idempotent success');
  assert.match(src, /if \(invite\.status !== "pending"\)[\s\S]*Only pending invites can be revoked\./,
    'non-pending invite states must not be revoked as a normal path');
});

test('phase 0.6B org-invite-revoke updates revoked_at and status without deleting rows or touching billing', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');
  const actorStart = src.indexOf('async function getActorRole');
  const actorEnd = src.indexOf('async function getInvite', actorStart);
  const actorHelper = actorStart >= 0 && actorEnd > actorStart ? src.slice(actorStart, actorEnd) : '';

  assert.match(src, /\.from\("organization_invites"\)[\s\S]*\.update\(\{ status: "revoked", revoked_at: nowIso \}\)/,
    'invite revoke must set revoked_at and status=revoked');
  assert.doesNotMatch(src, /\.from\("organization_invites"\)[\s\S]*\.delete\(\)/,
    'invite revoke must not delete invite rows');
  assert.doesNotMatch(src, /\.from\("organizations"\)[\s\S]*\.delete\(\)/,
    'invite revoke must not delete organizations');
  assert.doesNotMatch(actorHelper, /\.(insert|update|upsert|delete)\(/,
    'invite revoke must not mutate organization_members');
  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events|stripe|checkout|portal|billing-status/i,
    'invite revoke must not reference Stripe, billing-status, or billing tables');
});

test('phase 0.6B billing service uses org-invite-revoke edge function and direct browser revoke is disabled', async () => {
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const supabaseSrc = await fs.readFile(supabasePath, 'utf8');

  assert.match(billingSrc, /export async function revokeOrgInvite\(inviteId, orgId = ''\)/,
    'billing service must export revokeOrgInvite');
  assert.match(billingSrc, /postFn\('\/org-invite-revoke', payload\)/,
    'revokeOrgInvite must POST to the revoke Edge Function');
  assert.match(billingSrc, /payload\.organization_id = orgId/,
    'revokeOrgInvite must include optional organization_id');
  assert.match(billingSrc, /already_revoked: Boolean\(data && data\.already_revoked\)/,
    'revokeOrgInvite must preserve idempotent already_revoked state');
  assert.match(supabaseSrc, /Direct invite revocation is disabled\. Use the org-invite-revoke Edge Function\./,
    'legacy Supabase client direct revoke must be disabled');
  assert.doesNotMatch(supabaseSrc, /function revokeOrganizationInvite[\s\S]*\.from\('organization_invites'\)[\s\S]*\.update\(/,
    'legacy browser client revoke must not update organization_invites directly');
});

test('phase 0.6B settings revoke keeps confirm modal and calls edge service wrapper', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('async function revokeInvite(orgId, invite)');
  const end = src.indexOf('async function resendInvite(orgId, invite)', start);
  const handler = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(src, /revokeOrgInvite as revokeOrgInviteFn/,
    'settings overlay must import the Edge Function revoke wrapper');
  assert.match(handler, /revokeOrgInviteFn\(inviteId, orgId\)/,
    'settings revoke handler must call the new service wrapper');
  assert.doesNotMatch(handler, /SupabaseClient\.revokeOrganizationInvite/,
    'settings revoke handler must not use direct browser DB update');
  assert.match(handler, /await loadOrgInvites\(orgId\)/,
    'settings revoke success must refresh pending invites');
  assert.match(src, /UIComponents\.confirm\(\{[\s\S]*title: 'Revoke invite'[\s\S]*danger: true/,
    'pending invite revoke must keep UIComponents.confirm with danger styling');
  assert.doesNotMatch(src, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native browser dialogs');
});

test('phase 0.6B does not introduce unrelated workspace lifecycle or billing code', async () => {
  const edgeSrc = await fs.readFile(orgInviteRevokePath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const revokeStart = settingsSrc.indexOf('async function revokeInvite(orgId, invite)');
  const revokeEnd = settingsSrc.indexOf('async function resendInvite(orgId, invite)', revokeStart);
  const settingsHandler = revokeStart >= 0 && revokeEnd > revokeStart ? settingsSrc.slice(revokeStart, revokeEnd) : '';
  const serviceStart = billingSrc.indexOf('export async function revokeOrgInvite');
  const serviceEnd = billingSrc.indexOf('/**', serviceStart + 1);
  const serviceHandler = serviceStart >= 0 && serviceEnd > serviceStart ? billingSrc.slice(serviceStart, serviceEnd) : '';

  for (const [label, src] of [
    ['org-invite-revoke', edgeSrc],
    ['settings revokeInvite', settingsHandler],
    ['billing service revokeOrgInvite', serviceHandler],
  ]) {
    assert.doesNotMatch(src, /restoreWorkspace|transferOwnership|deleteWorkspace|exportWorkspace/,
      `${label} must not add restore/transfer/delete/export workspace flows`);
    assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events|checkout|portal|billing-status/i,
      `${label} must not add billing or Stripe behavior`);
  }
});

test('phase 0.6B-2 settings stable key uses pending-only invite state for revoke repaint', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const stableStart = src.indexOf('function _buildRenderStableKey()');
  const stableEnd = src.indexOf("} else if (tab === 'org-billing')", stableStart);
  const stableFn = stableStart >= 0 && stableEnd > stableStart ? src.slice(stableStart, stableEnd) : '';

  assert.match(stableFn, /const pendingInviteRenderRows = Array\.isArray\(orgInvitesData\)[\s\S]*String\(invite\.status \|\| ''\)\.toLowerCase\(\) === 'pending'/,
    'org-members stable key must derive invite state from pending invites only');
  assert.match(stableFn, /invitesCount: pendingInviteRenderRows\.length/,
    'stable key invite count must use pending-only rows');
  assert.match(stableFn, /invitesSignature: pendingInviteRenderRows[\s\S]*String\(invite\.id \|\| ''\)[\s\S]*String\(invite\.role \|\| 'member'\)\.toLowerCase\(\)[\s\S]*String\(invite\.status \|\| ''\)\.toLowerCase\(\)/,
    'stable key must include pending invite id, role, and status signature');
  assert.doesNotMatch(stableFn, /invitesCount:\s*Array\.isArray\(orgInvitesData\)\s*\?\s*orgInvitesData\.length\s*:\s*0/,
    'stable key must not use total all-status invite rows because revoked rows remain in orgInvitesData');
});

test('phase 0.6B-2 settings stable key includes invite action state for busy cleanup repaint', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const stableStart = src.indexOf('function _buildRenderStableKey()');
  const stableEnd = src.indexOf("} else if (tab === 'org-billing')", stableStart);
  const stableFn = stableStart >= 0 && stableEnd > stableStart ? src.slice(stableStart, stableEnd) : '';

  assert.match(stableFn, /inviteActions: orgInviteActions\.size/,
    'org-members stable key must include invite action state so revoke begin/done can repaint');
});

test('phase 0.6B-2 admins can see pending admin invites because pending list is not role-filtered', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const pendingStart = src.indexOf('const pendingInvites = hasInvitesForOrg');
  const pendingEnd = src.indexOf('if (isLoadingOrgInvites', pendingStart);
  const pendingSnippet = pendingStart >= 0 && pendingEnd > pendingStart ? src.slice(pendingStart, pendingEnd) : '';

  assert.match(pendingSnippet, /orgInvitesData\.filter\(i => i && i\.status === 'pending'\)/,
    'pending invite list should filter by pending status only');
  assert.doesNotMatch(pendingSnippet, /role|admin|member/,
    'pending invite list must not hide admin invite rows from admin users');
});

test('phase 0.6B-2 admin-on-admin invite actions are disabled with owner-only copy', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const loopStart = src.indexOf('pendingInvites.forEach(invite =>');
  const loopEnd = src.indexOf('inviteRows.push(tr)', loopStart);
  const rowRender = loopStart >= 0 && loopEnd > loopStart ? src.slice(loopStart, loopEnd) : '';

  assert.match(rowRender, /const inviteRole = String\(invite\.role \|\| 'member'\)\.toLowerCase\(\)/,
    'row render must normalize invite role once');
  assert.match(rowRender, /const adminInviteActionBlocked = !canManageAdmins && inviteRole === 'admin'/,
    'admin actors must be blocked from managing admin invite rows');
  assert.match(rowRender, /Only workspace owners can manage admin invites\./,
    'disabled admin invite controls must explain the owner-only rule');
  assert.match(rowRender, /resendBtn\.disabled = isBusyInvite \|\| inviteControlsDisabled \|\| adminInviteActionBlocked/,
    'admin-on-admin Resend must be disabled');
  assert.match(rowRender, /revokeBtn\.disabled = isBusyInvite \|\| inviteControlsDisabled \|\| adminInviteActionBlocked/,
    'admin-on-admin Revoke must be disabled');
  assert.match(rowRender, /if \(adminInviteActionBlocked\) return;[\s\S]*resendInvite\(orgId, invite\)/,
    'Resend click handler must guard admin-on-admin action');
  assert.match(rowRender, /if \(adminInviteActionBlocked\) return;[\s\S]*UIComponents\.confirm\(/,
    'Revoke click handler must guard admin-on-admin action before confirmation');
});

test('phase 0.6B-2 keeps revoke modal edge path and avoids native/direct revoke regressions', async () => {
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const supabaseSrc = await fs.readFile(supabasePath, 'utf8');
  const revokeStart = settingsSrc.indexOf('async function revokeInvite(orgId, invite)');
  const revokeEnd = settingsSrc.indexOf('async function resendInvite(orgId, invite)', revokeStart);
  const revokeHandler = revokeStart >= 0 && revokeEnd > revokeStart ? settingsSrc.slice(revokeStart, revokeEnd) : '';

  assert.match(settingsSrc, /UIComponents\.confirm\(\{[\s\S]*title: 'Revoke invite'[\s\S]*danger: true/,
    'allowed revoke paths must keep the existing danger confirm modal');
  assert.doesNotMatch(settingsSrc, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native dialogs');
  assert.match(revokeHandler, /revokeOrgInviteFn\(inviteId, orgId\)/,
    'revoke handler must keep using the Edge Function service wrapper');
  assert.doesNotMatch(revokeHandler, /SupabaseClient\.revokeOrganizationInvite/,
    'revoke handler must not call the legacy direct browser revoke function');
  assert.doesNotMatch(supabaseSrc, /function revokeOrganizationInvite[\s\S]*\.from\('organization_invites'\)[\s\S]*\.update\(/,
    'direct Supabase browser-side invite revoke mutation must not be reintroduced');
  assert.doesNotMatch(revokeHandler, /billing_customers|subscriptions|stripe_customers|webhook_events|billing-status|stripe|checkout|portal/i,
    'Phase 0.6B-2 revoke changes must not add Stripe or billing behavior');
});

test('phase 0.6C migration adds archived_at, index, direct-client guard, and active-org RPC filter', async () => {
  const src = await fs.readFile(orgArchiveMigrationPath, 'utf8');

  assert.match(src, /add column if not exists archived_at timestamptz/,
    'archive migration must add organizations.archived_at');
  assert.match(src, /create index if not exists organizations_archived_at_idx[\s\S]*on public\.organizations\(archived_at\)[\s\S]*where archived_at is not null/,
    'archive migration must index archived workspace rows');
  assert.match(src, /create or replace function public\.tp3d_guard_organizations_archived_at_update\(\)/,
    'archive migration must install an archived_at guard function');
  assert.match(src, /before update of archived_at on public\.organizations/,
    'archive migration must protect archived_at from generic organization updates');
  assert.match(src, /v_request_role <> 'service_role' and current_user <> 'service_role'/,
    'archive guard must allow the service-role Edge Function while blocking direct client updates');
  assert.match(src, /drop function if exists public\.get_user_organizations\(\);[\s\S]*create function public\.get_user_organizations\(\)[\s\S]*and o\.archived_at is null/,
    'account bundle RPC must hide archived workspaces from normal active lists');
});

test('phase 0.6C org-archive-workspace edge function is owner-only and idempotent', async () => {
  const src = await fs.readFile(orgArchiveWorkspacePath, 'utf8');

  assert.ok(src.length > 0, 'org-archive-workspace/index.ts must exist');
  assert.match(src, /if \(req\.method !== "POST"\)/,
    'archive workspace must require POST');
  assert.match(src, /requireUser\(req\)/,
    'archive workspace must require auth');
  assert.match(src, /body\.organization_id \|\| body\.org_id/,
    'archive workspace must accept organization_id with org_id fallback');
  assert.match(src, /\.from\("organizations"\)[\s\S]*\.select\("id, owner_id, archived_at"\)/,
    'archive workspace must load the organization before update');
  assert.match(src, /org\.owner_id !== auth\.user\.id/,
    'archive workspace must use organizations.owner_id as the primary-owner authority');
  assert.match(src, /already_archived: true/,
    'archive workspace must be idempotent when already archived');
  assert.match(src, /\.from\("organizations"\)[\s\S]*\.update\(\{ archived_at: nowIso \}\)[\s\S]*\.eq\("owner_id", auth\.user\.id\)/,
    'archive workspace must update only archived_at and keep an owner_id race guard');
  assert.match(src, /organization_id:[\s\S]*archived_at:/,
    'archive workspace must return organization_id and archived_at');
});

test('phase 0.6C archive edge function preserves data and avoids billing or Stripe scope', async () => {
  const src = await fs.readFile(orgArchiveWorkspacePath, 'utf8');

  assert.doesNotMatch(src, /\.delete\(\)/,
    'archive workspace must not delete any rows');
  assert.doesNotMatch(src, /organization_members|organization_invites|packs|cases|preferences|storage/i,
    'archive workspace must not mutate memberships, invites, packs, cases, preferences, or storage');
  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events|billing-status|stripe|checkout|portal/i,
    'archive workspace must not reference Stripe, billing-status, or billing tables');
});

test('phase 0.6C billing service exports archiveWorkspace edge wrapper', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(src, /export async function archiveWorkspace\(orgId\)/,
    'billing service must export archiveWorkspace');
  assert.match(src, /postFn\('\/org-archive-workspace'[\s\S]*organization_id: orgId/,
    'archiveWorkspace must POST organization_id to /org-archive-workspace');
  assert.match(src, /already_archived: Boolean\(data && data\.already_archived\)/,
    'archiveWorkspace must preserve idempotent already_archived state');
  assert.doesNotMatch(src, /archiveWorkspace[\s\S]*billing_customers|archiveWorkspace[\s\S]*subscriptions|archiveWorkspace[\s\S]*stripe/i,
    'archiveWorkspace wrapper must not add billing or Stripe behavior');
});

test('phase 0.6C Supabase client hides archived workspaces and disables direct archive mutation', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');

  assert.match(src, /const isActiveOrgRow = org => Boolean\(org && !org\.archived_at\)/,
    'organization fetch must define an active-org safety filter');
  assert.match(src, /client\.rpc\('get_user_organizations'\)[\s\S]*?orgs: data\.filter\(isActiveOrgRow\), authoritative: true/,
    'RPC org rows must be client-side filtered as a safety net');
  assert.match(src, /organizations \([\s\S]*archived_at[\s\S]*\)/,
    'fallback organization join must include archived_at');
  assert.match(src, /\.filter\(isActiveOrgRow\)/,
    'fallback organization rows must exclude archived workspaces');
  assert.match(src, /export async function archiveOrganization\(\)[\s\S]*Direct workspace archiving is disabled\. Use the org-archive-workspace Edge Function\./,
    'direct browser-side archive mutation must be disabled');
  assert.match(src, /hasOwnProperty\.call\(updates \|\| \{\}, 'archived_at'\)[\s\S]*Direct workspace archive updates are disabled/,
    'generic organization profile updates must reject archived_at client-side');
});

test('phase 0.6D-pre Supabase client rejects direct ownership transfer updates', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function updateOrganization(orgId, updates)');
  const end = src.indexOf('/**\n * Upload a user avatar', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'updateOrganization must be extractable');
  assert.match(fn, /hasOwnProperty\.call\(updates \|\| \{\}, 'archived_at'\)[\s\S]*Direct workspace archive updates are disabled/,
    'updateOrganization must keep rejecting archived_at');
  assert.match(fn, /hasOwnProperty\.call\(updates \|\| \{\}, 'owner_id'\)[\s\S]*Direct ownership transfer is disabled\. Use the org-transfer-ownership Edge Function\./,
    'updateOrganization must reject owner_id ownership transfer fields');
  assert.match(fn, /hasOwnProperty\.call\(updates \|\| \{\}, 'slug'\)[\s\S]*Workspace slug is server-controlled and cannot be changed directly\./,
    'updateOrganization must reject direct slug mutation');
});

test('release-gate browser client still refuses direct deletion-field writes (defense in depth)', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function updateProfile(updates)');
  const end = src.indexOf('export async function getUserOrganizations()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'updateProfile must be extractable');
  assert.match(fn, /const blockedDeletionFields = \['deletion_status', 'deleted_at', 'purge_after'\]/,
    'updateProfile must still list the deletion fields as blocked on the client');
  assert.match(fn, /blockedDeletionFields\.some\(field => Object\.prototype\.hasOwnProperty\.call\(updates \|\| \{\}, field\)\)[\s\S]*Direct account deletion state updates are disabled/,
    'updateProfile must still reject direct deletion-field writes from the browser');
});

test('phase 0.6D-pre direct client mutation guards avoid lifecycle billing and reload scope creep', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const profileStart = src.indexOf('export async function updateProfile(updates)');
  const profileEnd = src.indexOf('export async function getUserOrganizations()', profileStart);
  const orgStart = src.indexOf('export async function updateOrganization(orgId, updates)');
  const orgEnd = src.indexOf('/**\n * Upload a user avatar', orgStart);
  const snippets = [
    profileStart >= 0 && profileEnd > profileStart ? src.slice(profileStart, profileEnd) : '',
    orgStart >= 0 && orgEnd > orgStart ? src.slice(orgStart, orgEnd) : '',
  ].join('\n');

  assert.ok(snippets.trim(), 'direct mutation guard snippets must be extractable');
  assert.doesNotMatch(snippets, /signOut|forceLocalSignedOut|location\.reload|window\.location/i,
    'direct client mutation guards must not sign out or reload');
  assert.doesNotMatch(snippets, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'direct client mutation guards must not touch billing or Stripe scope');
  assert.doesNotMatch(snippets, /org-transfer-ownership[\s\S]*postFn|request-account-deletion[\s\S]*postFn|archiveWorkspace|restoreWorkspace/i,
    'direct client mutation guards must not introduce lifecycle flow calls');
});

test('workspace rename live-refresh: handleWorkspaceUpdated reconciles org context locally without a network refetch', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function handleWorkspaceUpdated(updatedOrg, options = {})');
  const end = src.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(helper, 'app must define handleWorkspaceUpdated');
  assert.match(src, /window\.TruckPackerApp\.handleWorkspaceUpdated = handleWorkspaceUpdated/,
    'app must expose handleWorkspaceUpdated');

  // window.TruckPackerApp = (function () { ... return {...}; })() (line ~2181):
  // the IIFE's own return object is assigned to window.TruckPackerApp AFTER
  // the whole function body finishes, which silently discards any bridge
  // function attached only via the early `window.TruckPackerApp.foo = foo`
  // merge (confirmed pre-existing for handleWorkspaceLeft,
  // handleOwnershipTransferred, and notifyOrgAccessLoss, none of which are in
  // this return object). handleWorkspaceUpdated must be listed here too, or
  // it is unreachable at runtime despite the assertion above passing.
  const publicApiStart = src.indexOf('return {\n      init,');
  const publicApiEnd = src.indexOf('};\n  })();', publicApiStart);
  const publicApi = publicApiStart >= 0 && publicApiEnd > publicApiStart
    ? src.slice(publicApiStart, publicApiEnd)
    : '';
  assert.match(publicApi, /handleWorkspaceUpdated,/,
    'handleWorkspaceUpdated must also be exposed on the actual returned TruckPackerApp public API, ' +
    'not only the early window.TruckPackerApp.foo = foo merge that the final IIFE return overwrites');

  assert.match(helper, /normalizeOrgIdForBilling\(\(updatedOrg && updatedOrg\.id\) \|\| ''\)/,
    'handleWorkspaceUpdated must normalize the updated org id');

  // Requirement: the returned organization is reconciled into the canonical
  // collection (orgs[]) and, when it is the active org, into activeOrg.
  assert.match(helper, /existingOrgs\.findIndex\(\s*\n\s*org => org && normalizeOrgIdForBilling\(org\.id \|\| ''\) === normalizedOrgId\s*\n\s*\)/,
    'handleWorkspaceUpdated must locate the updated org inside the canonical orgs collection');
  assert.match(helper, /idx === orgIndex \? \{ \.\.\.org, \.\.\.updatedOrg \} : org/,
    'handleWorkspaceUpdated must merge the returned fields into the matching orgs[] entry');
  assert.match(helper, /activeOrg: isActiveOrg \? \{ \.\.\.\(orgContext\.activeOrg \|\| \{\}\), \.\.\.updatedOrg \} : orgContext\.activeOrg/,
    'handleWorkspaceUpdated must merge the returned fields into activeOrg only when it is the active org');

  // Requirement: the active organization ID itself is never reassigned by a
  // field-level update (only archive/restore/transfer/switch may change it).
  assert.doesNotMatch(helper, /activeOrgId:\s*(?!activeOrgId\b)/,
    'handleWorkspaceUpdated must never reassign activeOrgId');

  // Requirement: every existing consumer is notified via the established
  // event + render pattern, not a bespoke DOM patch.
  assert.match(helper, /dispatchOrgContextChanged\(\{[\s\S]*orgId: normalizedOrgId[\s\S]*broadcast: true/,
    'handleWorkspaceUpdated must dispatch the canonical org-context-changed event with cross-tab broadcast');
  assert.match(helper, /queueOrgScopedRender\(source\)/,
    'handleWorkspaceUpdated must queue the canonical org-scoped render (drives AccountSwitcher + Settings, not per-label DOM patches)');

  // A field-level rename never changes which orgs are visible/owned, so
  // unlike archive/restore/transfer it must NOT trigger a full bundle refetch.
  assert.doesNotMatch(helper, /refreshOrgContext\(/,
    'handleWorkspaceUpdated must reconcile the already-returned org locally, not force a network refetch');
  assert.doesNotMatch(helper, /signOut|forceLocalSignedOut|location\.reload|window\.location|billing-status|stripe|checkout|portal|\.innerText\s*=|\.textContent\s*=/i,
    'handleWorkspaceUpdated must not sign out, reload, touch billing/Stripe, or directly patch DOM labels');
});

test('workspace rename live-refresh: saveOrganization hands the confirmed update to the app helper, only after success', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('async function saveOrganization(updates, orgId = null)');
  const end = src.indexOf('async function loadOrgMembers(orgId)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'saveOrganization must be extractable');
  assert.match(fn, /const updated = await SupabaseClient\.updateOrganization\(orgId, trimmed\);\s*\n\s*orgData = updated;/,
    'saveOrganization must keep updating its own local orgData from the server response');

  const updateIdx = fn.indexOf('const updated = await SupabaseClient.updateOrganization');
  const handoffIdx = fn.indexOf('TruckPackerApp.handleWorkspaceUpdated(updated');
  const catchIdx = fn.indexOf('} catch (err) {');
  assert.ok(updateIdx >= 0 && handoffIdx > updateIdx && handoffIdx < catchIdx,
    'the app-helper handoff must run only after a successful update and before the catch block, ' +
    'so a rejected updateOrganization() call never reconciles or renders stale/partial state');

  assert.match(fn, /window\.TruckPackerApp &&\s*\n\s*typeof window\.TruckPackerApp\.handleWorkspaceUpdated === 'function'/,
    'saveOrganization must hand the confirmed update to the app helper when available');
  assert.match(fn, /window\.TruckPackerApp\.handleWorkspaceUpdated\(updated, \{ source: 'settings-org-save' \}\)/,
    'saveOrganization must pass the server-confirmed organization object, not re-derive it');
  assert.match(fn, /queueAccountBundleRefresh\(\{ force: true, source: 'settings-org-save' \}\)/,
    'saveOrganization must retain a bundle-refresh fallback if the app helper is unavailable');
});

test('phase 0.6C Settings Archive UI is primary-owner-only and uses safe confirm flow', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const handlerStart = src.indexOf('async function archiveWorkspace(orgId, orgName)');
  const handlerEnd = src.indexOf('// ---- Organization invites ----', handlerStart);
  const handler = handlerStart >= 0 && handlerEnd > handlerStart ? src.slice(handlerStart, handlerEnd) : '';

  assert.match(src, /archiveWorkspace as archiveWorkspaceFn/,
    'settings overlay must import archiveWorkspace service wrapper');
  assert.match(src, /let _archiveWorkspaceInFlight = false/,
    'settings overlay must guard archive double clicks');
  assert.match(handler, /archiveWorkspaceFn\(normalizedOrgId\)/,
    'settings archive handler must call the Edge Function wrapper');
  assert.match(handler, /TruckPackerApp\.handleWorkspaceArchived\(normalizedOrgId, \{ source: 'settings-archive-workspace' \}\)/,
    'settings archive success must hand off active org recovery to the app helper');
  assert.match(src, /if \(isPrimaryOwner\) \{[\s\S]*Archive Workspace[\s\S]*UIComponents\.confirm\(\{[\s\S]*title: 'Archive Workspace'[\s\S]*danger: true/,
    'Archive Workspace UI must be gated to primary owner and use UIComponents.confirm');
  assert.match(src, /Workspace data, members, invites, and billing records are preserved\. Stripe billing is not canceled\./,
    'archive confirmation copy must explicitly preserve data and Stripe billing');
  assert.doesNotMatch(src, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native dialogs');
});

test('phase 0.6C does not add restore transfer permanent delete billing-status Stripe CSS router or package scope', async () => {
  const appSrc = await readAppSource();
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const appStart = appSrc.indexOf('function handleWorkspaceArchived(archivedOrgId, options = {})');
  const appEnd = appSrc.indexOf('// Expose billing pump globally', appStart);
  const settingsStart = settingsSrc.indexOf('async function archiveWorkspace(orgId, orgName)');
  const settingsEnd = settingsSrc.indexOf('// ---- Organization invites ----', settingsStart);
  const billingStart = billingSrc.indexOf('export async function archiveWorkspace(orgId)');
  const sources = [
    ['handleWorkspaceArchived', appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : ''],
    ['settings archiveWorkspace', settingsStart >= 0 && settingsEnd > settingsStart ? settingsSrc.slice(settingsStart, settingsEnd) : ''],
    ['billing service archiveWorkspace', billingStart >= 0 ? billingSrc.slice(billingStart) : ''],
    ['org-archive-workspace', await fs.readFile(orgArchiveWorkspacePath, 'utf8')],
  ];

  for (const [label, src] of sources) {
    assert.doesNotMatch(src, /restoreWorkspace|transferOwnership|permanentDelete|deleteWorkspace|exportWorkspace/,
      `${label} must not introduce restore/transfer/delete/export lifecycle actions`);
    assert.doesNotMatch(src, /billing-status|stripe-create-checkout|stripe-create-portal|stripe-webhook/i,
      `${label} must not touch billing-status or Stripe functions`);
  }
});

test('phase 0.6C-3 account bundle marks failed org fetch as partial, not confirmed no-org', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /const orgsFetchAuthoritative = Boolean\(orgsAuthResult && orgsAuthResult\.authoritative\) && !orgsWrap\.timedOut/,
    'a fetch is authoritative only when it confirmed the list and did not time out');
  assert.match(bundleFn, /const orgsFetchReturnedArray = orgsFetchAuthoritative && Array\.isArray\(orgsResult\)/,
    'only an authoritative, non-timeout array result may be a returned array');
  assert.match(bundleFn, /const orgsFetchUncertain = Boolean\(orgsWrap\.timedOut \|\| !orgsFetchAuthoritative\)/,
    'null, failed, timeout, or non-authoritative org fetch results must be uncertain');
  assert.match(bundleFn, /else if \(orgsFetchUncertain\) \{[\s\S]*reasonParts\.push\('orgs unavailable'\)/,
    'failed org fetch with no cached orgs must carry an uncertainty reason');
  assert.match(bundleFn, /const partial = Boolean\(!orgsAuthoritative \|\|/,
    'a non-authoritative org fetch must force a partial bundle instead of confirmed no-org');
});

test('phase 0.6C-3 cached org rescue after failed org fetch remains partial', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /if \(orgsFetchUncertain && cachedOrgs\.length > 0\) \{[\s\S]*orgsResult = cachedOrgs;[\s\S]*usedCachedOrgs = true;/,
    'cached orgs may rescue display state only after an uncertain org fetch');
  assert.match(bundleFn, /const orgsAuthoritative = orgsFetchReturnedArray && !usedCachedOrgs/,
    'cached org rescue must not be treated as an authoritative fresh org list');
  assert.match(bundleFn, /const partial = Boolean\(!orgsAuthoritative \|\|/,
    'cached org rescue must remain partial so it cannot confirm zero active workspaces');
});

test('false-no-workspace: getUserOrganizations preserves its array contract for existing callers', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getUserOrganizations()');
  const end = src.indexOf('export async function getUserOrganizationsAuthoritative()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'getUserOrganizations wrapper must be extractable');
  assert.match(fn, /const \{ orgs \} = await _fetchUserOrganizations\(\);\s*\n\s*return orgs;/,
    'getUserOrganizations must still resolve to a plain array for all existing callers');
});

test('false-no-workspace: no-org banner requires a resolved confirmed-empty result and is suppressed while busy', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function applyOrgRequiredUi(');
  const anchor = src.indexOf('const showNoOrgBanner', start);
  const fn = start >= 0 && anchor > start ? src.slice(start, anchor + 600) : '';

  assert.ok(fn, 'applyOrgRequiredUi must be extractable');
  assert.match(fn, /const hasResolvedNoActiveOrg = Boolean\([\s\S]*?confirmedNoOrg &&[\s\S]*?orgContextResolved &&[\s\S]*?orgs\.length === 0/,
    'the no-org banner must require a confirmed, resolved, empty org context');
  assert.match(fn, /const orgContextBusy = Boolean\(orgContextInFlight \|\| authRehydratePromise\)/,
    'banner gating must know when an org refresh or auth rehydrate is in flight');
  assert.match(fn, /showNoOrgBanner = Boolean\([\s\S]*?hasResolvedNoActiveOrg &&[\s\S]*?!authNotSettled &&[\s\S]*?!orgContextBusy/,
    'the no-org banner must never show while auth is unsettled or an org refresh is in flight');
});

test('phase 0.6C-2 app clears org state when resolved org is not in active org rows', async () => {
  const src = await readAppSource();
  const resolverStart = src.indexOf('function resolveOrgContextFromBundle(bundle)');
  const resolverEnd = src.indexOf('// ── Workspace-ready event replay buffer', resolverStart);
  const resolver = resolverStart >= 0 && resolverEnd > resolverStart ? src.slice(resolverStart, resolverEnd) : '';
  const applyStart = src.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = src.indexOf('async function refreshOrgContext', applyStart);
  const applyFn = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';

  assert.ok(resolver, 'resolveOrgContextFromBundle must be extractable');
  assert.ok(applyFn, 'applyOrgContextFromBundle must be extractable');
  assert.doesNotMatch(resolver, /else if \(profileOrgId\) orgId = profileOrgId/,
    'profile org hints must not become active unless present in active org rows');
  assert.doesNotMatch(resolver, /else if \(membershipOrgId\) orgId = membershipOrgId/,
    'preserved membership org ids must not become active unless present in active org rows');
  assert.match(applyFn, /const nextOrgInActiveList = Boolean\([\s\S]*resolved\.orgs\.some\(org => org && String\(org\.id\) === String\(nextOrgId\)\)[\s\S]*\)/,
    'applyOrgContextFromBundle must validate resolved org id against active org rows');
  assert.match(applyFn, /if \(nextOrgId && !nextOrgInActiveList && !\(bundle && bundle\.partial\)\) \{[\s\S]*clearOrgContext\(\{[\s\S]*clearLocalOrgHint: true,[\s\S]*confirmedNoOrg: true,[\s\S]*workspace-archived/,
    'non-partial bundles with stale resolved org ids must clear org context as confirmed no-org');
});

test('phase 0.6C-2 app exposes confirmed no-active bundle before clearing org context', async () => {
  const src = await readAppSource();
  const applyStart = src.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = src.indexOf('async function refreshOrgContext', applyStart);
  const applyFn = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';

  assert.ok(applyFn, 'applyOrgContextFromBundle must be extractable');
  assert.match(applyFn, /try \{ window\.__TP3D_LAST_ACCOUNT_BUNDLE = null; \} catch/,
    'signed-out cleanup must clear the exposed account bundle to avoid cross-user stale settings state');
  assert.match(applyFn, /window\.__TP3D_LAST_ACCOUNT_BUNDLE = bundle;[\s\S]*const resolved = resolveOrgContextFromBundle\(bundle\)/,
    'applyOrgContextFromBundle must expose the current bundle before no-active clear branches');
  assert.match(applyFn, /window\.__TP3D_LAST_ACCOUNT_BUNDLE = bundle;[\s\S]*if \(nextOrgId && !nextOrgInActiveList[\s\S]*clearOrgContext\(/,
    'stale resolved-org no-active clears must leave Settings with the authoritative empty bundle');
  assert.match(applyFn, /window\.__TP3D_LAST_ACCOUNT_BUNDLE = bundle;[\s\S]*if \(!nextOrgId\) \{[\s\S]*clearOrgContext\(/,
    'zero-active no-active clears must leave Settings with the authoritative empty bundle');
});

test('phase 0.6C-2 Settings clears stale locked org state when no active workspace is confirmed', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function isConfirmedNoActiveWorkspaceBundle\(bundle\)/,
    'settings overlay must detect definitive no-active-workspace bundles');
  assert.match(src, /let accountBundleConfirmedNoActiveWorkspace = false;/,
    'settings overlay must keep a local confirmed no-active flag for its own bundle loader');
  assert.match(src, /bundle\.partial !== true[\s\S]*Array\.isArray\(bundle\.orgs\)[\s\S]*bundle\.orgs\.length === 0[\s\S]*!bundle\.activeOrgId/,
    'no-active-workspace detection must require a complete empty active org list');
  assert.match(src, /accountBundleConfirmedNoActiveWorkspace\) return '';[\s\S]*isConfirmedNoActiveWorkspaceBundle\(window\.__TP3D_LAST_ACCOUNT_BUNDLE \|\| null\)[\s\S]*return ''/,
    'settings must not initialize modalOrgId from stale local or billing hints after confirmed no-active-workspace');
  assert.match(src, /isConfirmedNoActiveWorkspaceBundle\(bundle\)[\s\S]*accountBundleConfirmedNoActiveWorkspace = true;[\s\S]*membershipData = null;[\s\S]*orgData = null;[\s\S]*modalOrgId = '';[\s\S]*clearOrgScopedCaches\(''\)/,
    'settings bundle load must clear stale org-scoped state when no active workspace is confirmed');
  assert.match(src, /accountBundleConfirmedNoActiveWorkspace \|\|[\s\S]*isConfirmedNoActiveWorkspaceBundle\(window\.__TP3D_LAST_ACCOUNT_BUNDLE \|\| null\)/,
    'settings Billing must use local no-active bundle state as well as the app-level bundle');
  assert.match(src, /confirmedNoActiveWorkspace\) \{[\s\S]*setActiveTab\('org-general', \{ source: 'org-billing:no-active' \}\)/,
    'settings Billing must redirect to General after confirmed no-active workspace state');
  assert.match(src, /!hasOrg && !isOrgHydrating && \(_tabState\.activeTabId === 'org-members' \|\| _tabState\.activeTabId === 'org-billing'\)[\s\S]*_tabState\.activeTabId = 'org-general'/,
    'settings must not leave Members or Billing selected after no active workspace is confirmed');
});

test('phase 0.6C-2 Settings re-resolves modal org on open to avoid stale cross-user billing display', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function open(tab)');
  const end = src.indexOf('function init()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';
  const tabStart = src.indexOf('function resolveInitialTab(tab)');
  const tabEnd = src.indexOf('/**\n   * Repro steps:', tabStart);
  const tabFn = tabStart >= 0 && tabEnd > tabStart ? src.slice(tabStart, tabEnd) : '';

  assert.ok(fn, 'settings open() must be extractable');
  assert.ok(tabFn, 'resolveInitialTab() must be extractable');
  assert.match(fn, /const resolvedModalOrgId = resolveInitialModalOrgId\(\);/,
    'settings open() must re-resolve the authoritative modal org every time it opens');
  assert.doesNotMatch(fn, /if \(!modalOrgId\) \{[\s\S]*modalOrgId = resolveInitialModalOrgId\(\);[\s\S]*\}/,
    'settings open() must not preserve a stale modalOrgId just because it is non-empty');
  assert.match(fn, /if \(modalOrgId !== resolvedModalOrgId\) \{[\s\S]*modalOrgId = resolvedModalOrgId;/,
    'settings open() must replace stale modalOrgId with the current resolved org id');
  assert.match(fn, /cachedOrgIdBeforeOpen && cachedOrgIdBeforeOpen !== openingOrgId[\s\S]*membershipData = null;[\s\S]*orgData = null;[\s\S]*orgMembersData = null;[\s\S]*orgInvitesData = null;/,
    'settings open() must clear stale org-scoped caches when the resolved org changes');
  assert.match(fn, /const openingUserView = getCurrentUserView\(profileData\);[\s\S]*if \(openingUserView\.isAuthed\) \{[\s\S]*queueAccountBundleRefresh\(\{ force: true, source: 'open:created-refresh' \}\)/,
    'settings open() must refresh the account bundle for signed-in users even when caches are empty');
  assert.match(tabFn, /candidate === 'org-members' \|\| candidate === 'org-billing'[\s\S]*!resolveInitialModalOrgId\(\)[\s\S]*return 'org-general'/,
    'settings must not initially open disabled Members or Billing tabs when no modal org is resolved');
});

test('phase 0.6C-3 dispatchOrgContextChanged allows empty orgId only with confirmed opt-in', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function dispatchOrgContextChanged(options = {})');
  const end = src.indexOf('function parseOrgContextSyncPayload', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'dispatchOrgContextChanged must be extractable');
  assert.match(fn, /allowEmpty = false/,
    'empty org dispatch opt-in must default to false');
  assert.match(fn, /confirmedNoOrg: dispatchConfirmedNoOrg = false/,
    'confirmedNoOrg opt-in must default to false');
  assert.match(fn, /if \(!nextOrgId && !\(allowEmpty && dispatchConfirmedNoOrg\)\) return 0/,
    'empty orgId must still be rejected unless allowEmpty and confirmedNoOrg are both true');
  assert.match(fn, /confirmedNoOrg: dispatchConfirmedNoOrg \|\| undefined/,
    'confirmedNoOrg must be included in the org-changed event detail');
});

test('phase 0.6C-3 clearOrgContext dispatches confirmed empty-org event', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function clearOrgContext(');
  const end = src.indexOf('let orgScopedRenderTimer', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'clearOrgContext must be extractable');
  assert.match(fn, /orgContextResolved = Boolean\(confirmedNoOrg\)/,
    'clearOrgContext must mark confirmed no-org as a resolved org-context state');
  assert.match(fn, /getSignedInUserIdStrict\(\)[\s\S]*dispatchOrgContextChanged/,
    'confirmed no-active dispatch must require a signed-in user');
  assert.match(fn, /dispatchOrgContextChanged\(\{[\s\S]*orgId: ''[\s\S]*allowEmpty: true[\s\S]*confirmedNoOrg: true[\s\S]*broadcast: false/,
    'clearOrgContext must dispatch a local empty-org no-active event without broadcasting');
});

test('phase 0.6C-3 AccountSwitcher loading state is gated by unresolved org context', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function getDisplay()');
  const end = src.indexOf('function renderButton(buttonEl)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'AccountSwitcher.getDisplay must be extractable');
  assert.match(fn, /!orgContextResolved/,
    'AccountSwitcher must stop showing Loading once org context has definitively resolved');
  assert.match(fn, /isAuthed && !activeOrg && !orgContextResolved && \(orgContextInFlight \|\| authRehydratePromise\)/,
    'Loading must require signed-in auth, no active org, unresolved org context, and active work in flight');
});

test('phase 0.6C-3 AccountSwitcher has neutral confirmed no-active workspace display', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function getDisplay()');
  const end = src.indexOf('function renderButton(buttonEl)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'AccountSwitcher.getDisplay must be extractable');
  assert.match(fn, /const noActiveWorkspace = Boolean\(isAuthed && !activeOrg && orgContextResolved && activeOrgs\.length === 0\)/,
    'AccountSwitcher must detect signed-in confirmed no-active workspace state explicitly');
  assert.match(fn, /noActiveWorkspace[\s\S]*\? 'No workspace'/,
    'confirmed no-active state must use neutral primary chip copy');
  assert.match(fn, /userName: noActiveWorkspace \? 'Create or join' : displayName/,
    'confirmed no-active state must not use account user identity as the chip secondary label');
  assert.match(fn, /orgInitials: noActiveWorkspace \? '' : getActiveWorkspaceInitials\(\)/,
    'confirmed no-active chip avatar must not reuse user/account initials');
});

test('phase 0.6C-3 settings overlay clears stale org state on confirmed no-active event', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function ensureOrgChangedListener()');
  const end = src.indexOf('function removeOrgChangedListener()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'ensureOrgChangedListener must be extractable');
  assert.doesNotMatch(fn, /if \(!nextOrgId\) return;/,
    'settings orgChangedHandler must not blindly ignore empty org events');
  assert.match(fn, /Boolean\(detail && detail\.confirmedNoOrg\)[\s\S]*isConfirmedNoActiveWorkspaceBundle/,
    'settings orgChangedHandler must require confirmed no-active state before clearing');
  assert.match(fn, /modalOrgId = '';[\s\S]*clearOrgScopedCaches\(''\)/,
    'settings orgChangedHandler must clear the locked modal org id and org-scoped caches');
  assert.match(fn, /membershipData = null;[\s\S]*orgData = null;[\s\S]*orgMembersData = null;[\s\S]*orgInvitesData = null;/,
    'settings orgChangedHandler must clear stale org, membership, members, and invites data');
  assert.match(fn, /isLoadingOrgMembers = false;[\s\S]*isLoadingOrgInvites = false;/,
    'settings orgChangedHandler must clear members and invites loading state');
  assert.match(fn, /orgMemberActions\.clear\(\);[\s\S]*orgInviteActions\.clear\(\);/,
    'settings orgChangedHandler must clear member and invite action state');
  assert.match(fn, /render\(\{ source: 'org-changed:no-active' \}\)/,
    'settings orgChangedHandler must re-render connected overlay into no-active state');
});

test('phase 0.6C-3 Billing renders clean no-active state instead of stale org details', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function renderBillingInto(targetEl)');
  const end = src.indexOf('function render(renderMeta)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'renderBillingInto must be extractable');
  assert.match(fn, /if \(!lockedOrgId\) \{[\s\S]*isConfirmedNoActiveWorkspaceBundle\(window\.__TP3D_LAST_ACCOUNT_BUNDLE \|\| null\)/,
    'Billing must detect confirmed zero active workspaces when no modal org is locked');
  assert.match(fn, /No active workspace is selected\. Create a new workspace or restore an archived workspace when restore is available\./,
    'Billing must show a clean no-active workspace message');
  assert.match(fn, /targetEl\.appendChild\(noActiveMsg\);[\s\S]*return;/,
    'Billing must return before stale workspace detail rendering in confirmed no-active state');
});

test('phase 0.6C billing workspace limit copy includes archived workspaces', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function renderBillingInto(targetEl)');
  const end = src.indexOf('function render(renderMeta)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'renderBillingInto must be extractable');
  assert.doesNotMatch(fn, /workspaceCount[\s\S]{0,180}currently active/,
    'workspace limit count copy must not describe counted archived workspaces as currently active');
  assert.match(fn, /including archived workspaces/,
    'workspace limit copy must disclose that archived workspaces count toward the limit');
});

test('phase 0.6C-3 frontend stability fix avoids backend billing and destructive scope creep', async () => {
  const appSrc = await readAppSource();
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');

  const appSnippets = [
    ['dispatchOrgContextChanged', appSrc.slice(appSrc.indexOf('function dispatchOrgContextChanged'), appSrc.indexOf('function parseOrgContextSyncPayload'))],
    ['clearOrgContext', appSrc.slice(appSrc.indexOf('function clearOrgContext('), appSrc.indexOf('let orgScopedRenderTimer'))],
    ['org-changed listener', appSrc.slice(appSrc.indexOf("window.addEventListener('tp3d:org-changed', ev => {"), appSrc.indexOf('AppShell.init();'))],
  ];
  const billingGuardStart = settingsSrc.indexOf('if (!lockedOrgId) {', settingsSrc.indexOf('function renderBillingInto(targetEl)'));
  const billingGuardEnd = settingsSrc.indexOf('const currentOrgId = getOrgIdFromOrgContext();', billingGuardStart);
  const settingsSnippets = [
    ['settings orgChangedHandler', settingsSrc.slice(settingsSrc.indexOf('function ensureOrgChangedListener()'), settingsSrc.indexOf('function removeOrgChangedListener()'))],
    ['settings billing no-active guard', settingsSrc.slice(billingGuardStart, billingGuardEnd)],
  ];

  for (const [label, snippet] of [...appSnippets, ...settingsSnippets]) {
    assert.ok(snippet, `${label} snippet must be extractable`);
    assert.doesNotMatch(snippet, /signOut|forceLocalSignedOut|location\.reload|window\.location/i,
      `${label} must not sign out or reload`);
    assert.doesNotMatch(snippet, /stripe|checkout|portal|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
      `${label} must not touch Stripe, billing-status, or billing tables`);
    assert.doesNotMatch(snippet, /\.from\(['"]organization_members['"]\)|\.from\(['"]organization_invites['"]\)|\.delete\(\)|deletePack|deleteCase|storage\.from|router\./i,
      `${label} must not mutate members, invites, packs, cases, storage, or router state`);
  }
});

test('phase 0.6C-4 archive refresh fallback commits a remaining active workspace', async () => {
  const src = await readAppSource();
  const helperStart = src.indexOf('function handleWorkspaceArchived(archivedOrgId, options = {})');
  const helperEnd = src.indexOf('// Expose billing pump globally', helperStart);
  const helper = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';
  const resolverStart = src.indexOf('function resolveOrgContextFromBundle(bundle)');
  const resolverEnd = src.indexOf('// \u2500\u2500 Workspace-ready event replay buffer', resolverStart);
  const resolver = resolverStart >= 0 && resolverEnd > resolverStart ? src.slice(resolverStart, resolverEnd) : '';
  const applyStart = src.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = src.indexOf('async function refreshOrgContext', applyStart);
  const applyFn = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';
  const publicApiStart = src.indexOf('return {\n      init,');
  const publicApiEnd = src.indexOf('};\n  })();', publicApiStart);
  const publicApi = publicApiStart >= 0 && publicApiEnd > publicApiStart
    ? src.slice(publicApiStart, publicApiEnd)
    : '';

  assert.ok(helper, 'handleWorkspaceArchived must be extractable');
  assert.ok(resolver, 'resolveOrgContextFromBundle must be extractable');
  assert.ok(applyFn, 'applyOrgContextFromBundle must be extractable');
  assert.match(publicApi, /handleWorkspaceArchived,/,
    'Settings must be able to call handleWorkspaceArchived from the live TruckPackerApp public API');
  assert.match(helper, /SupabaseClient\.invalidateAccountCache\(\)[\s\S]*refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'archive success must invalidate account cache and force a fresh org-context refresh');
  assert.match(resolver, /else if \(orgs\.length > 0\) orgId = String\(orgs\[0\]\.id\);/,
    'when stale hints are invalid, resolver must fall back to an org from the fresh active org list');
  assert.match(applyFn, /writeLocalOrgId\(nextOrgIdStr\)/,
    'fallback active org must replace the stale local active-org hint');
  assert.match(applyFn, /dispatchOrgContextChanged\(\{[\s\S]*orgId: nextOrgIdStr[\s\S]*source: 'bundle-apply'/,
    'fallback active org commit must emit org-changed so chip and Settings can repaint');
  assert.match(helper, /syncWorkspaceUiAfterOrgRefresh\(source \+ ':refreshed'\)/,
    'archive refresh completion must sync account switcher and Settings UI after the forced org refresh settles');
});

test('phase 0.6C-4 settings open clears stale org caches after archive fallback switch', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const resolverStart = src.indexOf('function getOrgIdFromLastActiveBundle()');
  const resolverEnd = src.indexOf('function resolveInitialModalOrgId()', resolverStart);
  const resolver = resolverStart >= 0 && resolverEnd > resolverStart ? src.slice(resolverStart, resolverEnd) : '';
  const initialStart = src.indexOf('function resolveInitialModalOrgId()');
  const initialEnd = src.indexOf('function ensureModalOrgId()', initialStart);
  const initialFn = initialStart >= 0 && initialEnd > initialStart ? src.slice(initialStart, initialEnd) : '';
  const openStart = src.indexOf('function open(tab)');
  const openEnd = src.indexOf('function init()', openStart);
  const openFn = openStart >= 0 && openEnd > openStart ? src.slice(openStart, openEnd) : '';

  assert.ok(resolver, 'last active bundle modal-org resolver must be extractable');
  assert.match(resolver, /bundle\.partial === true/,
    'Settings must not treat partial account bundles as authoritative modal-org sources');
  assert.match(resolver, /const hasOrg = orgId =>[\s\S]*orgs\.some\(org => org && String\(org\.id\) === normalizedOrgId\)/,
    'Settings must validate modal org candidates against active org rows from the last bundle');
  assert.match(resolver, /if \(hasOrg\(activeOrgId\)\) return activeOrgId;[\s\S]*if \(hasOrg\(localOrgId\)\) return localOrgId;[\s\S]*orgs\[0\]/,
    'Settings must prefer bundle activeOrgId, then valid local hint, then first active bundle org');
  assert.match(initialFn, /const orgContextId = getOrgIdFromOrgContext\(\);[\s\S]*if \(orgContextId\) return orgContextId;[\s\S]*const localOrgId = getOrgIdFromLocalStorage\(\);/,
    'Settings initial modal org must prefer the live active OrgContext before last bundle hints');
  assert.match(initialFn, /const localOrgId = getOrgIdFromLocalStorage\(\);[\s\S]*const billingOrgId = getOrgIdFromBillingState\(\);[\s\S]*if \(billingOrgId && localOrgId && billingOrgId === localOrgId\) return billingOrgId;[\s\S]*return localOrgId \|\| '';/,
    'Settings initial modal org must not use stale billing state unless it matches the local active-org hint');
  assert.match(initialFn, /const bundleOrgId = getOrgIdFromLastActiveBundle\(\);[\s\S]*if \(bundleOrgId\) return bundleOrgId;[\s\S]*return localOrgId \|\| '';/,
    'Settings initial modal org may use the last active bundle only after live OrgContext/local hints are checked');
  assert.ok(openFn, 'Settings open function must be extractable');
  assert.match(openFn, /const cachedOrgIdBeforeOpen = normalizeOrgId\([\s\S]*orgData && orgData\.id[\s\S]*membershipData && membershipData\.organization_id/,
    'Settings open must capture the cached org id before resolving the current modal org');
  assert.match(openFn, /const openingOrgId = normalizeOrgId\(modalOrgId\)/,
    'Settings open must normalize the newly resolved locked org');
  assert.match(openFn, /cachedOrgIdBeforeOpen && cachedOrgIdBeforeOpen !== openingOrgId/,
    'Settings open must detect stale cached org data when the active org changed or no active org is locked after archive fallback');
  assert.match(openFn, /membershipData = null;[\s\S]*orgData = null;[\s\S]*orgMembersData = null;[\s\S]*orgInvitesData = null;/,
    'Settings open must clear stale org, membership, members, and invites data before rendering');
  assert.match(openFn, /orgMemberActions\.clear\(\);[\s\S]*orgInviteActions\.clear\(\);/,
    'Settings open must clear stale member and invite action state for the previous org');
  assert.match(openFn, /clearOrgScopedCaches\(modalOrgId\)/,
    'Settings open must still run the existing org-scoped cache cleanup for the locked org');
});

test('workspace creation RPC is one locked service-role-only transaction', async () => {
  const src = await fs.readFile(createWorkspaceMigrationPath, 'utf8');

  assert.match(src, /create or replace function public\.tp3d_create_workspace\(\s*p_actor_id uuid,\s*p_name text\s*\)/i,
    'migration must create the dedicated workspace RPC');
  assert.match(src, /security definer[\s\S]*set search_path = ''/i,
    'workspace RPC must use a locked empty search_path');
  assert.match(src, /insert into public\.organizations[\s\S]*owner_id[\s\S]*p_actor_id/i,
    'workspace RPC must bind organizations.owner_id to the authenticated actor supplied by the Edge Function');
  const memberInserts = src.match(/insert into public\.organization_members/gi) || [];
  assert.equal(memberInserts.length, 1,
    'workspace RPC must insert exactly one canonical owner membership and fire the existing trial trigger once');
  assert.match(src, /'owner'::public\.org_member_role/,
    'workspace RPC must create only the owner role');
  assert.match(src, /update public\.profiles[\s\S]*current_organization_id = v_org_id[\s\S]*where id = p_actor_id/i,
    'workspace RPC must atomically select the new workspace for the actor');
  assert.match(src, /TP3D_CREATE_PROFILE_MISSING/,
    'missing profile state must abort the transaction instead of leaving a partial workspace');
  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe/i,
    'workspace RPC must preserve trial behavior through the existing membership trigger without changing billing tables');
  assert.match(src, /revoke execute on function public\.tp3d_create_workspace\(uuid, text\) from public/i,
    'workspace RPC must revoke default PUBLIC execute');
  assert.match(src, /revoke execute on function public\.tp3d_create_workspace\(uuid, text\) from anon/i,
    'workspace RPC must reject anon execution');
  assert.match(src, /revoke execute on function public\.tp3d_create_workspace\(uuid, text\) from authenticated/i,
    'workspace RPC must reject browser-authenticated execution');
  assert.match(src, /grant execute on function public\.tp3d_create_workspace\(uuid, text\) to service_role/i,
    'workspace RPC must be executable only through trusted server code');
});

test('workspace creation RPC validates and normalizes names without accepting caller ownership', async () => {
  const src = await fs.readFile(createWorkspaceMigrationPath, 'utf8');

  assert.match(src, /p_name is null or p_name ~ '\[\[:cntrl:\]\]'/,
    'RPC must reject null and control-character names');
  assert.match(src, /regexp_replace\(pg_catalog\.btrim\(p_name\), '\[\[:space:\]\]\+', ' ', 'g'\)/,
    'RPC must normalize surrounding and repeated whitespace');
  assert.match(src, /char_length\(v_name\) < 1 or pg_catalog\.char_length\(v_name\) > 120/,
    'RPC must enforce the workspace name length contract');
  assert.doesNotMatch(src, /p_owner|p_role|p_billing|p_stripe|p_members/i,
    'RPC must not accept caller-controlled owner, role, billing, Stripe, or member inputs');
});

test('Packet 2 workspace creation resolves catalog limits inside an owner-scoped transaction', async () => {
  const migration = await fs.readFile(enforceWorkspaceLimitMigrationPath, 'utf8');
  const edge = await fs.readFile(orgCreateWorkspacePath, 'utf8');

  assert.match(migration,
    /create function public\.tp3d_create_workspace\(\s*p_actor_id uuid,\s*p_name text,\s*p_entitlement_config jsonb\s*\)/i,
    'Packet 2 must replace the creation RPC with a catalog-aware service-only signature');
  assert.match(migration,
    /from public\.profiles p[\s\S]*where p\.id = p_actor_id[\s\S]*for update;/i,
    'the actor profile row must serialize same-owner creation before entitlement and counting');
  const lockIndex = migration.indexOf('for update;');
  const countIndex = migration.indexOf('into v_workspace_count', lockIndex);
  const insertIndex = migration.indexOf('insert into public.organizations', countIndex);
  assert.ok(lockIndex >= 0 && countIndex > lockIndex && insertIndex > countIndex,
    'owner lock, authoritative count, and organization insert must stay in one ordered transaction');
  assert.match(migration,
    /from public\.organizations o\s*where o\.owner_id = p_actor_id;/i,
    'all canonical actor-owned workspaces must be counted');
  const countBlock = migration.slice(
    migration.lastIndexOf('select pg_catalog.count(*)::integer', countIndex),
    countIndex + 100,
  );
  assert.doesNotMatch(countBlock, /archived_at/i,
    'archived workspaces must not be filtered from creation capacity');
  assert.match(migration,
    /s\.status = 'past_due'[\s\S]*make_interval\(days => 7\)[\s\S]*s\.status = 'unpaid'[\s\S]*make_interval\(days => 3\)/,
    'creation entitlement must preserve the current payment-grace windows');
  assert.match(migration,
    /v_best_status = 'trialing'[\s\S]*v_workspace_limit := v_trial_limit[\s\S]*v_best_price_id[\s\S]*v_business_limit[\s\S]*v_workspace_limit := v_pro_limit/,
    'trial, recognized Business, and conservative paid fallback limits must remain catalog-derived');
  assert.match(migration,
    /if v_workspace_count >= v_workspace_limit then[\s\S]*TP3D_CREATE_WORKSPACE_LIMIT_REACHED/,
    'the locked server transaction must reject at the exact effective limit');
  assert.match(migration,
    /TP3D_CREATE_BILLING_IDENTITY_UNSAFE[\s\S]*TP3D_CREATE_ENTITLEMENT_UNAVAILABLE/,
    'unsafe identity and unavailable entitlement must fail closed distinctly');
  assert.match(migration,
    /revoke execute on function public\.tp3d_create_workspace\(uuid, text, jsonb\) from authenticated[\s\S]*grant execute on function public\.tp3d_create_workspace\(uuid, text, jsonb\) to service_role/i,
    'the catalog-aware RPC must remain unreachable to browser-authenticated callers');

  assert.match(edge, /import \{ getBillingCatalog \} from "\.\.\/_shared\/billing-catalog\.ts";/,
    'the Edge Function must reuse the existing catalog authority');
  assert.match(edge,
    /p_entitlement_config: buildWorkspaceEntitlementConfig\(\)/,
    'the trusted Edge path must supply catalog limits to the protected RPC');
  assert.match(edge,
    /workspace_limit_reached[\s\S]*workspace_billing_identity_unsafe[\s\S]*workspace_entitlement_unavailable/,
    'stable sanitized machine error codes must distinguish limit, identity, and availability failures');
  assert.doesNotMatch(edge, /stripeClient|STRIPE_SECRET_KEY|subscriptions\.(?:retrieve|list)/,
    'workspace creation must not add Stripe calls or change payment semantics');
});

test('workspace creation client preserves the public contract without direct organization membership writes', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function createOrganization({ name })');
  const end = src.indexOf('/**\n * Request account deletion', start);
  const createFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(createFn, 'createOrganization must remain exported for the existing app caller');
  assert.match(createFn, /invokeAuthenticatedEdgeFunction\('org-create-workspace', \{[\s\S]*name: normalizedName/,
    'client workspace creation must use the dedicated Edge Function');
  assert.match(createFn, /return \{ org, membership \};/,
    'client must preserve the existing org and membership result contract');
  assert.doesNotMatch(createFn, /\.from\(|owner_id|role:|slug:/,
    'client must not send or directly mutate owner, role, slug, organization, or membership data');
  assert.doesNotMatch(src, /\.from\(['"]organization_members['"]\)\s*\.(?:insert|update|delete)\(/,
    'browser Supabase client must expose no direct membership mutation');
});

test('legacy SupabaseClient membership helpers delegate to approved Edge paths', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const updateStart = src.indexOf('export async function updateOrganizationMemberRole');
  const removeStart = src.indexOf('export async function removeOrganizationMember', updateStart);
  const helperStart = src.indexOf('async function getEdgeFunctionErrorMessage', removeStart);
  const updateFn = updateStart >= 0 && removeStart > updateStart ? src.slice(updateStart, removeStart) : '';
  const removeFn = removeStart >= 0 && helperStart > removeStart ? src.slice(removeStart, helperStart) : '';

  assert.match(updateFn, /invokeAuthenticatedEdgeFunction\('org-member-role-update'/,
    'legacy role helper must use the guarded role Edge Function');
  assert.match(removeFn, /invokeAuthenticatedEdgeFunction\('org-member-remove'/,
    'legacy removal helper must use the guarded removal Edge Function');
  assert.doesNotMatch(updateFn + removeFn, /\.from\(|\.(?:insert|update|delete)\(/,
    'legacy helpers must not retain direct membership writes');
});

test('workspace creation config uses the established app-level JWT validation pattern', async () => {
  const src = await fs.readFile(supabaseConfigPath, 'utf8');
  const start = src.indexOf('[functions.org-create-workspace]');
  const end = src.indexOf('[functions.', start + 1);
  const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : '';

  assert.ok(block, 'config must register org-create-workspace');
  assert.match(block, /verify_jwt\s*=\s*false/,
    'org-create-workspace must use the existing requireUser/x-user-jwt validation pattern');
});

test('phase 0.6D Batch C migration creates transfer ownership RPC with service-role-only execute', async () => {
  const src = await fs.readFile(transferOwnershipMigrationPath, 'utf8');

  assert.match(src, /create or replace function public\.tp3d_transfer_workspace_ownership\(/i,
    'migration must create tp3d_transfer_workspace_ownership');
  assert.match(src, /returns jsonb/i,
    'transfer ownership RPC must return jsonb');
  assert.match(src, /security definer/i,
    'transfer ownership RPC must be security definer');
  assert.match(src, /set search_path = public/i,
    'transfer ownership RPC must set search_path');
  assert.match(src, /for update/i,
    'transfer ownership RPC must lock rows during transfer');
  assert.match(src, /revoke execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) from public/i,
    'transfer ownership RPC must revoke public execute');
  assert.match(src, /revoke execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) from anon/i,
    'transfer ownership RPC must revoke anon execute');
  assert.match(src, /revoke execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) from authenticated/i,
    'transfer ownership RPC must revoke authenticated execute');
  assert.match(src, /grant execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) to service_role/i,
    'transfer ownership RPC must grant execute to service_role only');
});

test('phase 0.6D Batch C RPC verifies primary owner target and actor membership', async () => {
  const src = await fs.readFile(transferOwnershipMigrationPath, 'utf8');

  assert.match(src, /v_org\.owner_id\s+is null or v_org\.owner_id <> p_actor_id/i,
    'RPC must verify actor is organizations.owner_id');
  assert.match(src, /TP3D_TRANSFER_NOT_PRIMARY_OWNER/,
    'RPC must raise not-primary-owner sentinel');
  assert.match(src, /p_new_owner_id = p_actor_id[\s\S]*TP3D_TRANSFER_TARGET_IS_ACTOR/i,
    'RPC must reject transferring ownership to self');
  assert.match(src, /from public\.organization_members m[\s\S]*m\.user_id = p_new_owner_id[\s\S]*for update/i,
    'RPC must verify and lock target membership');
  assert.match(src, /TP3D_TRANSFER_TARGET_NOT_MEMBER/,
    'RPC must raise target-not-member sentinel');
  assert.match(src, /from public\.organization_members m[\s\S]*m\.user_id = p_actor_id[\s\S]*for update/i,
    'RPC must verify and lock actor membership');
  assert.match(src, /TP3D_TRANSFER_ACTOR_MEMBERSHIP_MISSING/,
    'RPC must raise actor-membership-missing sentinel');
});

test('phase 0.6D Batch C RPC updates owner_id and member roles atomically', async () => {
  const src = await fs.readFile(transferOwnershipMigrationPath, 'utf8');

  assert.match(src, /update public\.organizations[\s\S]*set owner_id = p_new_owner_id[\s\S]*where id = p_org_id/i,
    'RPC must update organizations.owner_id');
  assert.match(src, /update public\.organization_members[\s\S]*role = 'owner'::public\.org_member_role[\s\S]*user_id = p_new_owner_id/i,
    'RPC must set new owner membership role to owner');
  assert.match(src, /update public\.organization_members[\s\S]*role = 'admin'::public\.org_member_role[\s\S]*user_id = p_actor_id/i,
    'RPC must set old owner membership role to admin');
  assert.match(src, /jsonb_build_object\([\s\S]*'organization_id', p_org_id[\s\S]*'old_owner_id', p_actor_id[\s\S]*'new_owner_id', p_new_owner_id/i,
    'RPC must return transfer result ids');
});

test('phase 0.6D Batch C live schema fix repairs organization_members updated_at dependency', async () => {
  const src = await fs.readFile(transferOwnershipLiveFixMigrationPath, 'utf8');
  const fnStart = src.indexOf('create or replace function public.tp3d_transfer_workspace_ownership');
  const functionBody = fnStart >= 0 ? src.slice(fnStart) : '';

  assert.match(src, /alter table public\.organization_members[\s\S]*add column if not exists updated_at timestamptz/i,
    'live schema fix must add the updated_at column expected by the existing organization_members trigger');
  assert.match(src, /create or replace function public\.tp3d_transfer_workspace_ownership\(/i,
    'live schema fix migration must replace the transfer RPC');
  assert.match(functionBody, /update public\.organization_members[\s\S]*role = 'owner'::public\.org_member_role[\s\S]*user_id = p_new_owner_id/i,
    'live schema fix must still set new owner role');
  assert.match(functionBody, /update public\.organization_members[\s\S]*role = 'admin'::public\.org_member_role[\s\S]*user_id = p_actor_id/i,
    'live schema fix must still set old owner role');
  assert.doesNotMatch(functionBody, /update public\.organization_members[\s\S]{0,180}updated_at/i,
    'transfer RPC role updates should rely on the existing trigger rather than manually setting organization_members.updated_at');
  assert.doesNotMatch(functionBody, /update public\.organizations[\s\S]{0,120}updated_at/i,
    'transfer RPC live fix must not require optional organizations.updated_at');
  assert.match(src, /grant execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) to service_role/i,
    'live schema fix must preserve service_role-only execute');
});

test('phase 0.6D Batch C Edge Function maps transfer sentinel errors', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');

  assert.match(src, /TP3D_TRANSFER_NOT_PRIMARY_OWNER[\s\S]*status:\s*403/,
    'not-primary-owner sentinel must map to 403');
  assert.match(src, /TP3D_TRANSFER_ORG_NOT_FOUND[\s\S]*status:\s*404/,
    'org-not-found sentinel must map to 404');
  assert.match(src, /TP3D_TRANSFER_TARGET_NOT_MEMBER[\s\S]*status:\s*404/,
    'target-not-member sentinel must map to 404');
  assert.match(src, /TP3D_TRANSFER_TARGET_IS_ACTOR[\s\S]*status:\s*400/,
    'target-is-actor sentinel must map to 400');
  assert.match(src, /TP3D_TRANSFER_ACTOR_MEMBERSHIP_MISSING[\s\S]*status:\s*409/,
    'actor-membership-missing sentinel must map to 409');
});

test('phase 0.6D Batch C config disables platform JWT verification for transfer Edge Function', async () => {
  const src = await fs.readFile(supabaseConfigPath, 'utf8');
  const start = src.indexOf('[functions.org-transfer-ownership]');
  const end = src.indexOf('[functions.', start + 1);
  const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : '';

  assert.ok(block, 'config must include org-transfer-ownership function block');
  assert.match(block, /verify_jwt\s*=\s*false/,
    'org-transfer-ownership must use app-level requireUser auth with verify_jwt=false');
});

test('phase 0.6D Batch C billing service exports transferOwnership wrapper', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(src, /export async function transferOwnership\(orgId, newOwnerId\)/,
    'billing service must export transferOwnership');
  assert.match(src, /postFn\('\/org-transfer-ownership'[\s\S]*organization_id: orgId[\s\S]*new_owner_id: newOwnerId/,
    'transferOwnership must POST organization_id and new_owner_id to Edge Function');
  assert.match(src, /resolveTransferOwnershipError\(res, data\)/,
    'transferOwnership must map structured transfer errors');
  assert.match(src, /code === 'workspace_has_active_billing'/,
    'transferOwnership must recognize the active-billing structured error code');
  assert.match(src, /This workspace has active billing\. Cancel the subscription in Billing before transferring ownership, or contact support to move billing to the new owner\./,
    'active billing rejection must use the approved user-facing copy');
  assert.match(src, /code === 'workspace_billing_state_unavailable'/,
    'transferOwnership must recognize the unavailable-billing structured error code');
  assert.match(src, /Billing status could not be verified\. Try again before transferring ownership\./,
    'billing lookup uncertainty must use sanitized fail-closed copy');
  assert.match(src, /return resolveFnError\(res, data, 'Transfer ownership failed'\)/,
    'existing transfer errors must retain their current fallback behavior');
});

test('phase 0.6D Batch C settings has primary-owner-only transfer ownership flow', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /transferOwnership as transferOwnershipFn/,
    'settings overlay must import transferOwnership wrapper');
  assert.match(src, /let _transferOwnershipInFlight = false/,
    'settings overlay must track transfer in-flight state');
  assert.match(src, /async function showTransferOwnershipModal\(orgId, orgName, currentUserId\)/,
    'settings overlay must define transfer ownership modal');
  assert.match(src, /transferCandidates = \(Array\.isArray\(orgMembersData\)[\s\S]*String\(member\.user_id\) !== actorId/,
    'transfer modal must use existing workspace members excluding current user');
  assert.match(src, /if \(isPrimaryOwner\)[\s\S]*Transfer Ownership[\s\S]*showTransferOwnershipModal\(leaveOrgId, leaveName, currentUserIdForLeave\)/,
    'Transfer Ownership action must be primary-owner-only in General tab');
  assert.match(src, /UIComponents\.showModal\(\{[\s\S]*title: 'Transfer Ownership'/,
    'transfer flow must use existing modal UI');
  assert.match(src, /transferOwnership\(normalizedOrgId, selectedUserId, orgName\)/,
    'transfer modal must call transferOwnership');
  assert.match(src, /TruckPackerApp\.handleOwnershipTransferred\(normalizedOrgId/,
    'transfer success must notify app lifecycle handler');
});

test('phase 0.6D Batch C updateOrganization direct owner_id guard remains', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function updateOrganization(orgId, updates)');
  const end = src.indexOf('export async function uploadOrgLogo', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'updateOrganization must be extractable');
  assert.match(fn, /hasOwnProperty\.call\(updates \|\| \{\}, 'owner_id'\)/,
    'updateOrganization must keep blocking direct owner_id writes');
  assert.match(fn, /Direct ownership transfer is disabled\. Use the org-transfer-ownership Edge Function\./,
    'updateOrganization must point callers to org-transfer-ownership');
});

test('phase 0.6D Batch C transfer implementation avoids forbidden scope', async () => {
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const billingStart = billingSrc.indexOf('export async function transferOwnership(orgId, newOwnerId)');
  const billingEnd = billingSrc.indexOf('/**\n * Leave a workspace', billingStart);
  const billingWrapper = billingStart >= 0 && billingEnd > billingStart ? billingSrc.slice(billingStart, billingEnd) : '';
  const appSrc = await readAppSource();
  const appStart = appSrc.indexOf('function handleOwnershipTransferred(orgId, options = {})');
  const appEnd = appSrc.indexOf('// Expose billing pump globally', appStart);
  const appHandler = appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : '';
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const settingsStart = settingsSrc.indexOf('async function transferOwnership(orgId, newOwnerId, orgName)');
  const settingsEnd = settingsSrc.indexOf('// ---- Organization invites ----', settingsStart);
  const settingsTransferFlow = settingsStart >= 0 && settingsEnd > settingsStart ? settingsSrc.slice(settingsStart, settingsEnd) : '';
  const sources = [
    ['transfer migration', await fs.readFile(transferOwnershipMigrationPath, 'utf8')],
    ['billing wrapper', billingWrapper],
    ['app ownership handler', appHandler],
    ['settings transfer flow', settingsTransferFlow],
  ];

  for (const [label, src] of sources) {
    assert.doesNotMatch(src, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
      `${label} must not touch Stripe, billing-status, or billing tables`);
    assert.doesNotMatch(src, /org-invite|archiveWorkspace|restoreWorkspace|purge-deleted|deletePack|deleteCase|storage\.from|router\.|location\.reload|signOut/i,
      `${label} must not touch invites, archive/restore, purge, packs/cases, storage, router, reload, or signOut`);
  }

  const transferEdge = await fs.readFile(orgTransferOwnershipPath, 'utf8');
  assert.match(transferEdge, /\.from\("billing_customers"\)/,
    'transfer Edge guard may inspect the requested organization billing projection');
  assert.match(transferEdge, /\.from\("subscriptions"\)/,
    'transfer Edge guard may inspect the requested organization subscription projection');
  assert.doesNotMatch(transferEdge, /stripe_customers|checkout|portal|webhook|billing-status|Stripe\./i,
    'transfer Edge guard must not use user-wide Stripe identity or other billing functions');
  assert.doesNotMatch(transferEdge, /org-invite|archiveWorkspace|restoreWorkspace|purge-deleted|deletePack|deleteCase|storage\.from|router\.|location\.reload|signOut/i,
    'transfer Edge guard must not broaden into unrelated product behavior');
});

test('phase 0.6D Batch B archived workspace RPC exists without changing active RPC', async () => {
  const src = await fs.readFile(restoreWorkspaceMigrationPath, 'utf8');

  assert.match(src, /create or replace function public\.get_user_archived_organizations\(\)/,
    'restore migration must create get_user_archived_organizations');
  assert.match(src, /o\.archived_at is not null/,
    'archived workspace RPC must return archived rows only');
  assert.match(src, /join public\.organization_members om[\s\S]*om\.user_id = auth\.uid\(\)/,
    'archived workspace RPC must return rows where the user has membership');
  assert.match(src, /grant execute on function public\.get_user_archived_organizations\(\) to authenticated/,
    'archived workspace RPC must grant authenticated execute');
  assert.doesNotMatch(src, /create or replace function public\.get_user_organizations\(\)/,
    'restore migration must not alter active get_user_organizations behavior');
});

test('phase 0.6D Batch B restore Edge Function is owner-only and idempotent', async () => {
  const src = await fs.readFile(orgRestoreWorkspacePath, 'utf8');

  assert.match(src, /\.from\("organizations"\)[\s\S]*\.select\("id, owner_id, archived_at, created_at"\)/,
    'restore Edge Function must load owner_id and archived_at from organizations');
  assert.match(src, /String\(org\.owner_id \|\| ""\) !== String\(auth\.user\.id \|\| ""\)/,
    'restore Edge Function must require organizations.owner_id to match actor');
  assert.match(src, /status:\s*403/,
    'non-primary-owner restore must return 403');
  assert.match(src, /if \(!org\.archived_at\)[\s\S]*already_restored:\s*true/,
    'restore Edge Function must be idempotent when the workspace is already active');
});

test('phase 0.6D Batch B restore updates only archived_at to null', async () => {
  const src = await fs.readFile(orgRestoreWorkspacePath, 'utf8');
  const updateStart = src.indexOf('.from("organizations")\n    .update({ archived_at: null })');
  const updateEnd = src.indexOf('if (restoreErr)', updateStart);
  const updateBlock = updateStart >= 0 && updateEnd > updateStart ? src.slice(updateStart, updateEnd) : '';

  assert.ok(updateBlock, 'restore update block must be extractable');
  assert.match(updateBlock, /\.update\(\{ archived_at: null \}\)/,
    'restore must update only archived_at to null');
  assert.match(updateBlock, /\.eq\("id", organizationId\)[\s\S]*\.eq\("owner_id", auth\.user\.id\)[\s\S]*\.not\("archived_at", "is", null\)/,
    'restore update must be guarded by id, owner_id, and currently archived state');
  assert.doesNotMatch(updateBlock, /organization_members|organization_invites|billing_customers|subscriptions|storage|packs|cases/i,
    'restore update block must not mutate unrelated tables');
});

test('phase 0.6D Batch B restore has workspace limit protection without external billing calls', async () => {
  const src = await fs.readFile(orgRestoreWorkspacePath, 'utf8');
  const limitStart = src.indexOf('async function verifyRestoreFitsWorkspaceLimit');
  const limitEnd = src.indexOf('Deno.serve', limitStart);
  const limitFn = limitStart >= 0 && limitEnd > limitStart ? src.slice(limitStart, limitEnd) : '';

  assert.ok(limitFn, 'workspace limit helper must be extractable');
  assert.match(limitFn, /\.from\("organizations"\)[\s\S]*\.eq\("owner_id", ownerId\)/,
    'workspace limit check must read owner workspaces');
  assert.match(limitFn, /\.from\("subscriptions"\)[\s\S]*\.select\(/,
    'workspace limit check may read subscription projection rows');
  assert.match(limitFn, /\.from\("billing_customers"\)[\s\S]*\.select\(/,
    'workspace limit check may read customer projection rows');
  assert.match(src, /RESTORE_LIMIT_ERROR[\s\S]*status:\s*409/,
    'workspace limit failures must return 409');
  assert.doesNotMatch(limitFn, /\.from\("billing_customers"\)[\s\S]{0,180}\.(insert|update|upsert|delete)\(/,
    'restore must not mutate customer projection rows');
  assert.doesNotMatch(limitFn, /\.from\("subscriptions"\)[\s\S]{0,180}\.(insert|update|upsert|delete)\(/,
    'restore must not mutate subscription projection rows');
  assert.doesNotMatch(src, /stripe|billing-status/i,
    'restore Edge Function must not call payment provider code or billing-status');
});

test('phase 0.6D Batch B config disables platform JWT verification for restore Edge Function', async () => {
  const src = await fs.readFile(supabaseConfigPath, 'utf8');
  const start = src.indexOf('[functions.org-restore-workspace]');
  const end = src.indexOf('[functions.', start + 1);
  const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : '';

  assert.ok(block, 'config must include org-restore-workspace function block');
  assert.match(block, /verify_jwt\s*=\s*false/,
    'org-restore-workspace must use app-level requireUser auth with verify_jwt=false');
});

test('phase 0.6D Batch B service and client expose restore/list wrappers', async () => {
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const clientSrc = await fs.readFile(supabasePath, 'utf8');

  assert.match(billingSrc, /export async function restoreWorkspace\(orgId\)/,
    'billing service must export restoreWorkspace');
  assert.match(billingSrc, /postFn\('\/org-restore-workspace'[\s\S]*organization_id: orgId/,
    'restoreWorkspace must POST organization_id to restore Edge Function');
  assert.match(billingSrc, /resolveFnError\(res, data, 'Restore workspace failed'\)/,
    'restoreWorkspace must preserve server error messages');
  assert.match(clientSrc, /export async function getUserArchivedOrganizations\(\)/,
    'Supabase client must export getUserArchivedOrganizations');
  assert.match(clientSrc, /client\.rpc\('get_user_archived_organizations'\)/,
    'getUserArchivedOrganizations must call archived workspace RPC');
  assert.match(clientSrc, /getUserArchivedOrganizations,/,
    'getUserArchivedOrganizations must be exposed on window.SupabaseClient API');
});

test('phase 0.6D Batch B Settings UI has archived workspace restore flow', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /restoreWorkspace as restoreWorkspaceFn/,
    'settings overlay must import restoreWorkspace wrapper');
  assert.match(src, /async function loadArchivedWorkspaces\(\{ force = false \} = \{\}\)/,
    'settings overlay must load archived workspaces independently');
  assert.match(src, /appendArchivedWorkspacesSection\(targetEl, currentUserId\)/,
    'settings overlay must render an Archived Workspaces section');
  assert.match(src, /Archived Workspaces/,
    'settings overlay must show Archived Workspaces copy');
  assert.match(src, /String\(org\.owner_id\) === String\(currentUserId\)/,
    'restore button must be shown only for archived workspaces owned by the current user');
  assert.match(src, /UIComponents\.confirm\(\{[\s\S]*title: 'Restore Workspace'/,
    'restore flow must use existing confirm UI pattern');
  assert.match(src, /restoreWorkspaceFn\(normalizedOrgId\)/,
    'settings restore handler must call the restore service wrapper');
  assert.match(src, /TruckPackerApp\.handleWorkspaceRestored\(normalizedOrgId/,
    'restore success must notify app lifecycle handler');
});

test('phase 0.6D Batch B restore implementation avoids forbidden scope', async () => {
  const edgeSrc = await fs.readFile(orgRestoreWorkspacePath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const billingStart = billingSrc.indexOf('export async function restoreWorkspace(orgId)');
  const billingEnd = billingSrc.indexOf('/**\n * Archive a workspace', billingStart);
  const billingWrapper = billingStart >= 0 && billingEnd > billingStart ? billingSrc.slice(billingStart, billingEnd) : '';
  const appSrc = await readAppSource();
  const appStart = appSrc.indexOf('function handleWorkspaceRestored(restoredOrgId, options = {})');
  const appEnd = appSrc.indexOf('function handleOwnershipTransferred', appStart);
  const appHandler = appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : '';
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const settingsStart = settingsSrc.indexOf('async function restoreArchivedWorkspace(orgId, orgName)');
  const settingsEnd = settingsSrc.indexOf('async function archiveWorkspace(orgId, orgName)', settingsStart);
  const settingsRestoreFlow = settingsStart >= 0 && settingsEnd > settingsStart ? settingsSrc.slice(settingsStart, settingsEnd) : '';
  const sources = [
    ['restore edge', edgeSrc],
    ['billing wrapper', billingWrapper],
    ['app restore handler', appHandler],
    ['settings restore flow', settingsRestoreFlow],
  ];

  for (const [label, src] of sources) {
    assert.doesNotMatch(src, /stripe|billing-status|stripe_customers|webhook_events|checkout|portal|webhook/i,
      `${label} must not touch payment provider functions or billing-status`);
    assert.doesNotMatch(src, /org-invite|org-member|request-account-deletion|cancel-account-deletion|purge-deleted|deletePack|deleteCase|storage\.from|router\.|location\.reload|signOut/i,
      `${label} must not touch invite/member/account deletion/purge/packs/cases/storage/router/reload/signOut`);
  }
});

test('PACK-PREVIEW-SCHEDULER captures a stale active Pack while the user remains in Editor', async () => {
  const runtime = await createPackPreviewSchedulerHarness();
  assert.equal(runtime.scheduler.schedule(), true);
  assert.equal(runtime.captures.length, 0, 'capture waits for the coalescing window');
  assert.equal([...runtime.timers.values()][0].delay, 300, 'the debounce remains short and responsive');

  runtime.runTimers();
  assert.equal(runtime.state.currentScreen, 'editor', 'no screen change is required');
  assert.equal(runtime.captures.length, 1);
  assert.equal(runtime.captures[0].packId, 'pack-a');
  assert.equal(runtime.captures[0].options.source, 'auto');
  assert.equal(runtime.captures[0].options.quiet, true);
});

test('PACK-PREVIEW-SCHEDULER rejects stale pending Pack, deletion, and workspace contexts', async t => {
  await t.test('current Pack changed', async () => {
    const runtime = await createPackPreviewSchedulerHarness();
    runtime.scheduler.schedule();
    runtime.state.currentPackId = 'pack-b';
    runtime.packs.set('pack-b', {
      id: 'pack-b', cases: [{ id: 'instance-b' }], lastEdited: 300, thumbnailUpdatedAt: 100,
    });
    runtime.runTimers();
    assert.equal(runtime.captures.length, 0);
  });

  await t.test('Pack deleted', async () => {
    const runtime = await createPackPreviewSchedulerHarness();
    runtime.scheduler.schedule();
    runtime.packs.delete('pack-a');
    runtime.runTimers();
    assert.equal(runtime.captures.length, 0);
  });

  await t.test('workspace changed', async () => {
    const runtime = await createPackPreviewSchedulerHarness();
    runtime.scheduler.schedule();
    runtime.setWorkspaceKey('user-a|workspace-b');
    runtime.runTimers();
    assert.equal(runtime.captures.length, 0);
  });
});

test('P0 EDITOR UNDO ATOMICITY: automatic preview capture writes skipHistory, never a user-facing Undo step', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');

  const captureStart = appSrc.indexOf('async function capturePackPreview(packId,');
  assert.ok(captureStart >= 0, 'capturePackPreview() must exist');
  const captureEnd = appSrc.indexOf('\n      function clearPackPreview(', captureStart);
  assert.ok(captureEnd > captureStart, 'capturePackPreview() must be extractable up to clearPackPreview()');
  const captureBlock = appSrc.slice(captureStart, captureEnd);

  assert.match(captureBlock, /PackLibrary\.updatePreview\(packId, \{\s*thumbnail: dataUrl,\s*thumbnailUpdatedAt: Date\.now\(\),\s*thumbnailSource: source === 'manual' \? 'manual' : 'auto',\s*thumbnailVisualSignature: visualSignature,\s*thumbnailViewSignature: viewSignature,\s*thumbnailRenderVersion: PREVIEW_RENDER_VERSION,\s*\}, \{ skipHistory: true \}\)/,
    'the derived preview write must persist visual and view freshness without consuming a user Undo step');
  assert.doesNotMatch(captureBlock, /skipNotify/,
    'the preview write must keep notifying subscribers normally — only history recording is skipped');

  // Clear Preview is an explicit, undoable user action even though it uses the
  // same narrow preview metadata boundary as automatic capture.
  const clearStart = appSrc.indexOf('function clearPackPreview(');
  const clearEnd = appSrc.indexOf('\n      }', clearStart);
  const clearBlock = appSrc.slice(clearStart, clearEnd);
  assert.match(clearBlock, /PackLibrary\.updatePreview\(packId, \{\s*thumbnail: null, thumbnailUpdatedAt: null, thumbnailSource: null,\s*thumbnailRenderVersion: PREVIEW_RENDER_VERSION,\s*thumbnailVisualSignature: CaseScene\.getVisualSignature\(pack\),\s*thumbnailViewSignature: editorViewSignature\(normalizeEditorView\(pack\.editorView\) \|\|\s*SceneManager\.getDefaultEditorView\(pack\.truck\)\),\s*\}, \{ skipHistory: false \}\)/,
    'Clear Preview intentionally clears the image at the current visual and view signatures and remains undoable');
});

test('BUG-01-A2 user-switch guard requires actual identity change, not same-user token refresh', async () => {
  const src = await readAppSource();

  const guardIdx = src.indexOf('const _isConfirmedUserSwitch =');
  assert.ok(guardIdx >= 0, 'guard assignment found');
  const guardExpr = src.slice(guardIdx, guardIdx + 300);

  assert.match(guardExpr, /isUserSwitch/, 'isUserSwitch feeds into the guard');
  assert.match(guardExpr, /lastAuthUserId/, 'lastAuthUserId feeds into the guard');
  assert.match(guardExpr, /lastAuthUserId !== String\(user\.id\)/, 'guard compares IDs as strings so same user never triggers clear');
});

test('BUG-01-B clearBillingState bumps _billingEpoch so any in-flight request from prior user epoch is discarded', async () => {
  const src = await readAppSource();

  const clearStart = src.indexOf('function clearBillingState()');
  assert.ok(clearStart >= 0, 'clearBillingState function found');
  let depth = 0, clearEnd = -1;
  for (let i = clearStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { clearEnd = i + 1; break; } }
  }
  const clearFn = src.slice(clearStart, clearEnd);
  assert.match(clearFn, /_billingEpoch\+\+/, 'clearBillingState increments billing epoch');
  assert.match(clearFn, /_notifyBilling\(\)/, 'subscribers notified so sidebar resets to neutral state');
  assert.match(clearFn, /applyAccessGateFromBilling/, 'feature gates reset to neutral on clear');

  // The epoch guard in refreshBilling must compare captured vs current
  assert.match(src, /const _epochAtStart = _billingEpoch/, 'epoch captured before fetch starts in refreshBilling');
  assert.match(src, /_billingEpoch !== _epochAtStart/, 'epoch guard present — stale result discarded after user switch');
});

test('BUG-01-B2 refreshBilling re-checks active org after fetch to discard result started under prior user org', async () => {
  const src = await readAppSource();
  assert.match(src, /_activeOrgIdAfterFetch/, 'active org re-read after fetch completes');
  assert.match(src, /refresh:discard-stale-org/, 'stale-org discard path logged in refreshBilling');
  // requestedOrgId compared against post-fetch active org ID
  const discardOrgIdx = src.indexOf('refresh:discard-stale-org');
  assert.ok(discardOrgIdx > 0, 'discard-stale-org check found');
  const discardRegion = src.slice(discardOrgIdx - 200, discardOrgIdx + 50);
  assert.match(discardRegion, /_activeOrgIdAfterFetch.*requestedOrgId|requestedOrgId.*_activeOrgIdAfterFetch/,
    'post-fetch org compared against requestedOrgId');
});

test('BUG-01-C resolveActiveOrganizationId self-clears __TP3D_USER_SWITCH_PENDING when OrgContext resolves', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  const fnStart = src.indexOf('function resolveActiveOrganizationId()');
  assert.ok(fnStart >= 0, 'resolveActiveOrganizationId function found');
  let depth = 0, fnEnd = -1;
  for (let i = fnStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { fnEnd = i + 1; break; } }
  }
  const fn = src.slice(fnStart, fnEnd);

  // Flag must be cleared in the contextOrgId success branch
  assert.match(fn, /__TP3D_USER_SWITCH_PENDING\s*=\s*false/, 'pending flag cleared inside resolveActiveOrganizationId');
  const contextBranchIdx = fn.indexOf('if (contextOrgId)');
  assert.ok(contextBranchIdx >= 0, 'contextOrgId success branch found');
  const beforeReturn = fn.slice(contextBranchIdx, contextBranchIdx + 300);
  assert.match(beforeReturn, /__TP3D_USER_SWITCH_PENDING\s*=\s*false/, 'flag cleared before returning contextOrgId');
});

test('BUG-01-D fetchBillingStatus promotion block is guarded by _userSwitchPending check', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  const promotionIdx = src.indexOf('Promote orgIdCandidate to organizationId');
  assert.ok(promotionIdx >= 0, 'promotion comment found in billing.service.js');

  const promotionRegion = src.slice(promotionIdx, promotionIdx + 950);
  assert.match(promotionRegion, /__TP3D_USER_SWITCH_PENDING/, 'pending flag read in promotion region');
  assert.match(promotionRegion, /!_userSwitchPending/, 'promotion skipped when flag is true');

  // The BUG-01 guard comment must be present
  assert.match(promotionRegion, /BUG-01/, 'BUG-01 guard comment present in promotion block');
});

test('BUG-01-E synthetic: both guards block promotion when OrgContext empty, localStorage empty, flag set', () => {
  // Simulates the state immediately after Fix 1 fires on a user switch:
  // writeLocalOrgId(null) cleared localStorage; orgContext.activeOrgId = null cleared OrgContext;
  // window.__TP3D_USER_SWITCH_PENDING = true set the billing guard.
  const win = {
    OrgContext: { getActiveOrgId: () => '' },
    localStorage: { getItem: () => null },
    __TP3D_USER_SWITCH_PENDING: true,
  };

  // Emulate resolveActiveOrganizationId() logic
  let rawContextOrgId = '', rawLocalOrgId = '', contextOrgId = '';
  try {
    rawContextOrgId = String(win.OrgContext.getActiveOrgId() || '').trim();
    contextOrgId = rawContextOrgId.length === 36 ? rawContextOrgId : '';
    if (contextOrgId) win.__TP3D_USER_SWITCH_PENDING = false;
  } catch (_) { /* ignore */ }
  if (!contextOrgId) rawLocalOrgId = String(win.localStorage.getItem('tp3d:active-org-id') || '').trim();
  const orgIdCandidate = rawLocalOrgId.length === 36 ? rawLocalOrgId : null;

  assert.strictEqual(orgIdCandidate, null, 'no org candidate — localStorage was cleared by Fix 1');
  assert.ok(win.__TP3D_USER_SWITCH_PENDING, 'flag still set — OrgContext has not resolved yet');

  // Primary block: orgIdCandidate null → promotion impossible
  const wouldPromoteViaPrimary = orgIdCandidate !== null;
  assert.strictEqual(wouldPromoteViaPrimary, false, 'primary guard: null candidate blocks promotion');

  // Defense-in-depth: flag also blocks promotion if candidate were somehow non-null
  const wouldPromoteWithFlag = !win.__TP3D_USER_SWITCH_PENDING && orgIdCandidate !== null;
  assert.strictEqual(wouldPromoteWithFlag, false, 'secondary guard: pending flag blocks promotion');
});

test('BUG-01-F legitimate same-user startup: org hint is promotable when no switch pending', () => {
  const ORG = 'c2345678-0000-0000-0000-000000000002';
  const win = {
    OrgContext: { getActiveOrgId: () => '' },
    localStorage: { getItem: (k) => k === 'tp3d:active-org-id' ? ORG : null },
    __TP3D_USER_SWITCH_PENDING: false,
  };

  let rawContextOrgId = '', rawLocalOrgId = '', contextOrgId = '';
  try {
    rawContextOrgId = String(win.OrgContext.getActiveOrgId() || '').trim();
    contextOrgId = rawContextOrgId.length === 36 ? rawContextOrgId : '';
    if (contextOrgId) win.__TP3D_USER_SWITCH_PENDING = false;
  } catch (_) { /* ignore */ }
  if (!contextOrgId) rawLocalOrgId = String(win.localStorage.getItem('tp3d:active-org-id') || '').trim();
  const orgIdCandidate = rawLocalOrgId.length === 36 ? rawLocalOrgId : null;

  assert.strictEqual(orgIdCandidate, ORG, 'localStorage org preserved for same-user startup');
  const _userSwitchPending = Boolean(win.__TP3D_USER_SWITCH_PENDING);
  assert.strictEqual(_userSwitchPending, false, 'no pending flag — no user switch occurred');
  assert.ok(!_userSwitchPending && orgIdCandidate !== null, 'promotion proceeds normally for same-user first load');
});

test('BUG-01-G same-user workspace switch is not affected by the user-switch guard', async () => {
  const src = await readAppSource();

  // _isConfirmedUserSwitch = false when lastAuthUserId === user.id
  // (same-user workspace switch: isUserSwitch might be false, lastAuthUserId matches)
  const guardIdx = src.indexOf('const _isConfirmedUserSwitch =');
  const guardLine = src.slice(guardIdx, guardIdx + 300);
  assert.match(guardLine, /lastAuthUserId !== String\(user\.id\)/, 'identity check uses string comparison (same user = false)');

  // setActiveOrgId (the workspace switch path) writes the new org ID, not null.
  // Brace-depth extraction is unreliable when the signature contains destructuring,
  // so search a generous region around the function start instead.
  const setActiveStart = src.indexOf('function setActiveOrgId(');
  assert.ok(setActiveStart >= 0, 'setActiveOrgId found');
  const setActiveRegion = src.slice(setActiveStart, setActiveStart + 2000);
  assert.match(setActiveRegion, /writeLocalOrgId/, 'setActiveOrgId calls writeLocalOrgId (workspace switch path)');
  // The null-clear must NOT be inside setActiveOrgId; it belongs only in the user-switch guard
  const setActiveNullIdx = setActiveRegion.indexOf('OrganizationService.writeLocalOrgId(null)');
  assert.strictEqual(setActiveNullIdx, -1, 'setActiveOrgId does not call writeLocalOrgId(null)');
});

test('BUG-01-H cross-tab same-user refresh: guard is false when user IDs match', async () => {
  const src = await readAppSource();
  // Verify that the guard expression is a Boolean AND of two conditions,
  // meaning it is false when either isUserSwitch is false AND IDs match.
  const guardIdx = src.indexOf('const _isConfirmedUserSwitch =');
  const guardLine = src.slice(guardIdx, guardIdx + 300);
  // Must not use isSameUser — must use raw ID comparison so cross-tab refresh with same user is safe
  assert.match(guardLine, /lastAuthUserId !== String\(user\.id\)/, 'raw ID comparison — same user cross-tab is not a switch');
});

test('BUG-01-Q cross-user isolation resets every prior-user billing-pump and burst owner', async () => {
  const src = await readAppSource();
  const resetStart = src.indexOf('function resetBillingPumpForUserSwitch()');
  const resetEnd = src.indexOf('function maybeScheduleBillingRefresh(', resetStart);
  const resetFn = resetStart >= 0 && resetEnd > resetStart ? src.slice(resetStart, resetEnd) : '';

  assert.ok(resetFn, 'cross-user billing-pump reset helper exists');
  assert.match(resetFn, /clearTimeout\(_billingPumpTimer\)/, 'prior-user org-ready retry timer is cancelled');
  assert.match(resetFn, /_billingPumpTimer = null/, 'retry timer ownership is released');
  assert.match(resetFn, /_billingPumpTries = 0/, 'retry count is reset');
  assert.match(resetFn, /_billingPumpEverRan = false/, 'new identity receives first-run force behavior');
  assert.match(resetFn, /_billingPumpLastByReason\.clear\(\)/, 'soft cooldown owners are cleared');
  assert.match(resetFn, /_billingPumpLastRunAtMs = 0/, 'global hard cooldown owner is cleared');
  assert.match(resetFn, /BillingService\.resetRefreshDedupForUserSwitch\(\)/,
    '300ms request-burst owner reset delegates to BillingService (Stage 1)');
  const dedupStart = src.indexOf('function resetRefreshDedupForUserSwitch()');
  const dedupFn = dedupStart >= 0 ? src.slice(dedupStart, src.indexOf('}', dedupStart) + 1) : '';
  assert.match(dedupFn, /_lastBillingKey = ''/, '300ms request-burst owner key is cleared in BillingService');
  assert.match(dedupFn, /_lastBillingKeyAt = 0/, '300ms request-burst timestamp is cleared in BillingService');
  assert.doesNotMatch(resetFn, /setTimeout|setInterval|_clearSharedBillingResult|localStorage/, 'reset adds no polling and preserves durable org snapshots');

  const helperStart = src.indexOf('function applyUserSwitchIsolation(');
  const helperEnd = src.indexOf('async function renderAuthState(', helperStart);
  const helperFn = src.slice(helperStart, helperEnd);
  const flagIdx = helperFn.indexOf('__TP3D_USER_SWITCH_PENDING = true');
  const resetIdx = helperFn.indexOf('resetBillingPumpForUserSwitch()');
  const clearIdx = helperFn.indexOf('clearBillingState()');
  const requireIdx = helperFn.indexOf('requireBillingAuthoritativeRefreshForUserSwitch(');
  assert.ok(flagIdx >= 0 && resetIdx > flagIdx && clearIdx > resetIdx && requireIdx > clearIdx,
    'promotion guard, pump reset, epoch-bumping billing clear, and authoritative requirement run synchronously in that order');
});

test('BUG-01-R production pump runtime lets User B run once despite User A hard cooldown', async () => {
  const { pump, calls, clearedTimers } = await createBillingPumpRuntimeHarness();

  pump.run('render-auth-state');
  assert.strictEqual(calls.length, 1, 'User A establishes a recent hard cooldown');
  assert.strictEqual(calls[0].force, true, 'first User A pump is authoritative');

  pump.advance(100);
  pump.run('org-context');
  assert.strictEqual(calls.length, 1, 'same-user request still honors the global hard cooldown');

  pump.seedOwnedState();
  pump.reset();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pump.snapshot())), {
    timer: null,
    tries: 0,
    everRan: false,
    reasons: [],
    lastRunAtMs: 0,
    lastBillingKey: '',
    lastBillingKeyAt: 0,
    authoritativeRequired: null,
    requireOnNextSignIn: false,
    pending: false,
    sharedApplyCount: 0,
  }, 'confirmed identity switch releases every pump/cooldown/burst owner');
  assert.strictEqual(clearedTimers.some(timer => timer && timer.id === 'prior-user-retry'), true,
    'prior-user retry timer is cancelled');

  pump.setOrg('org-b');
  pump.advance(100);
  pump.run('render-auth-state');
  assert.strictEqual(calls.length, 2, 'User B billing runs immediately instead of inheriting User A cooldown');
  assert.deepStrictEqual(calls[1], {
    force: true,
    reason: 'pump:render-auth-state',
    orgId: 'org-b',
    at: 100200,
  }, 'User B gets one authoritative current-org refresh');

  pump.advance(100);
  pump.run('org-context');
  assert.strictEqual(calls.length, 2, 'nearby User B triggers do not create a repeated fetch loop');
});

test('BUG-01-S same-user workspace switching keeps existing pump throttling', async () => {
  const { pump, calls } = await createBillingPumpRuntimeHarness();

  pump.run('render-auth-state');
  pump.advance(100);
  pump.run('tab-visible');
  assert.strictEqual(calls.length, 1, 'same-user visibility refresh remains hard-cooled');

  pump.setOrg('org-b');
  pump.run('org-changed');
  assert.strictEqual(calls.length, 2, 'same-user workspace change keeps its existing forced refresh path');
  assert.strictEqual(calls[1].orgId, 'org-b', 'workspace refresh belongs to the newly selected org');

  pump.advance(100);
  pump.run('org-context');
  assert.strictEqual(calls.length, 2, 'post-switch duplicate remains throttled');

  const src = await readAppSource();
  const setActiveStart = src.indexOf('async function setActiveOrgId(');
  const setActiveEnd = src.indexOf('const OrgContext = {', setActiveStart);
  const setActiveFn = src.slice(setActiveStart, setActiveEnd);
  assert.doesNotMatch(setActiveFn, /resetBillingPumpForUserSwitch/, 'normal workspace switching never resets cross-user ownership');
});

test('BUG-01-T rapid A→B→A and failure recovery remain generation-safe and bounded', async () => {
  const rapid = await createBillingPumpRuntimeHarness();
  rapid.pump.run('render-auth-state');
  rapid.pump.advance(100);
  rapid.pump.reset();
  rapid.pump.setOrg('org-b');
  rapid.pump.run('render-auth-state');
  rapid.pump.advance(100);
  rapid.pump.reset();
  rapid.pump.setOrg('org-a');
  rapid.pump.run('render-auth-state');

  assert.deepStrictEqual(rapid.calls.map(call => call.orgId), ['org-a', 'org-b', 'org-a'],
    'each confirmed identity generation receives its own immediate refresh');
  assert.deepStrictEqual(rapid.calls.map(call => call.force), [true, true, true],
    'each new identity generation is authoritative');
  rapid.pump.advance(100);
  rapid.pump.run('org-context');
  assert.strictEqual(rapid.calls.length, 3, 'rapid switching does not create a fourth duplicate request');

  const recovery = await createBillingPumpRuntimeHarness();
  recovery.pump.failNext();
  recovery.pump.run('render-auth-state');
  assert.strictEqual(recovery.billingState.ok, false, 'billing failure remains fail-closed');
  assert.ok(recovery.billingState.error, 'billing failure remains visible for recovery');
  recovery.pump.advance(100);
  recovery.pump.run('org-context');
  assert.strictEqual(recovery.calls.length, 1, 'ordinary duplicate does not poll after failure');
  recovery.pump.run('manual');
  assert.strictEqual(recovery.calls.length, 2, 'existing explicit recovery path bypasses cooldown once');
  assert.strictEqual(recovery.billingState.ok, true, 'explicit recovery can restore authoritative billing');
});

test('BUG-01-V production pump runtime treats a fresh shared Pro snapshot as provisional after a user switch', async () => {
  const { pump, calls, billingState } = await createBillingPumpRuntimeHarness();
  Object.assign(billingState, {
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-a',
    lastFetchedAt: 99950,
  });
  pump.switchIdentity('user-b', 'org-b');
  pump.setShared({
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-b',
    plan: 'Pro',
    entitlementStatus: 'active',
    canManageBilling: null,
    lastFetchedAt: 99990,
  }, 99990);

  pump.run('org-context');
  assert.strictEqual(pump.snapshot().sharedApplyCount, 1, 'shared org-level fields may apply provisionally');
  assert.strictEqual(calls.length, 1, 'shared freshness cannot suppress the direct current-user request');
  assert.strictEqual(calls[0].force, true, 'the post-switch request is authoritative');
  assert.strictEqual(calls[0].authoritativeRefresh.userId, 'user-b', 'request belongs to the new identity');
  assert.strictEqual(calls[0].authoritativeRefresh.orgId, 'org-b', 'request belongs to the resolved current org');
  assert.strictEqual(pump.snapshot().authoritativeRequired, null, 'successful direct result completes the requirement');
  assert.strictEqual(pump.snapshot().pending, false, 'normal successful resolution releases user-switch pending');

  pump.advance(100);
  pump.run('org-context');
  assert.strictEqual(calls.length, 1, 'nearby pump triggers do not create a repeated direct-fetch loop');
});

test('BUG-01-W production pump runtime keeps same-user local/shared freshness shortcuts', async () => {
  const localFresh = await createBillingPumpRuntimeHarness();
  Object.assign(localFresh.billingState, {
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-a',
    lastFetchedAt: 99990,
  });
  localFresh.pump.run('org-context');
  assert.strictEqual(localFresh.calls.length, 0, 'same-user local freshness still returns without a direct request');

  const sharedFresh = await createBillingPumpRuntimeHarness();
  sharedFresh.pump.setShared({
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-a',
    lastFetchedAt: 99990,
  }, 99990);
  sharedFresh.pump.run('org-context');
  assert.strictEqual(sharedFresh.calls.length, 0, 'same-user shared freshness still returns without a direct request');
  assert.strictEqual(sharedFresh.pump.snapshot().sharedApplyCount, 1, 'same-user shared state remains reusable');
});

test('BUG-01-X production pump runtime forces both Pro→expired and expired→Pro transition directions', async () => {
  const proToExpired = await createBillingPumpRuntimeHarness();
  proToExpired.pump.switchIdentity('expired-user', 'expired-org');
  proToExpired.pump.run('render-auth-state');
  assert.strictEqual(proToExpired.calls.length, 1, 'Pro→expired transition performs one direct request');
  assert.strictEqual(proToExpired.calls[0].force, true, 'Pro→expired request is forced');

  const expiredToPro = await createBillingPumpRuntimeHarness();
  expiredToPro.pump.switchIdentity('pro-user', 'pro-org');
  expiredToPro.pump.setShared({
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'pro-org',
    plan: 'Pro',
    entitlementStatus: 'active',
    canManageBilling: null,
    lastFetchedAt: 99990,
  }, 99990);
  expiredToPro.pump.run('render-auth-state');
  assert.strictEqual(expiredToPro.calls.length, 1, 'expired→Pro transition performs one direct request despite shared Pro state');
  assert.strictEqual(expiredToPro.calls[0].force, true, 'expired→Pro request is forced');
});

test('BUG-01-Y production token runtime rejects late A/B owners in rapid A→B→A', async () => {
  const { pump } = await createBillingPumpRuntimeHarness();
  pump.switchIdentity('user-b', 'org-b');
  const tokenB = pump.getAuthoritativeToken();
  assert.strictEqual(pump.beginAuthoritative(tokenB), true, 'B begins its owned authoritative attempt');

  pump.switchIdentity('user-a', 'org-a');
  const finalTokenA = pump.getAuthoritativeToken();
  assert.strictEqual(pump.isAuthoritativeCurrent(tokenB), false, 'late B token is no longer current');
  assert.strictEqual(pump.completeAuthoritative(tokenB), false, 'late B cannot clear final A requirement');
  assert.strictEqual(pump.snapshot().authoritativeRequired.generation, finalTokenA.generation,
    'final A transition retains its own requirement');
  assert.strictEqual(pump.completeAuthoritative(finalTokenA), true, 'only final A can complete its requirement');
  assert.strictEqual(pump.snapshot().authoritativeRequired, null, 'final A completion clears the requirement');
});

test('BUG-01-AD production runtime keeps cold boot, reload, and token refresh on normal cache behavior', async () => {
  const runtime = await createBillingPumpRuntimeHarness();
  Object.assign(runtime.billingState, {
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-a',
    lastFetchedAt: 99990,
  });
  assert.strictEqual(runtime.pump.snapshot().requireOnNextSignIn, false, 'cold boot begins without a persisted marker');
  assert.strictEqual(runtime.pump.authEvent('INITIAL_SESSION', 'user-a', 'org-a'), false,
    'cold-boot INITIAL_SESSION is not post-sign-out');
  assert.strictEqual(runtime.pump.authEvent('TOKEN_REFRESHED', 'user-a', 'org-a'), false,
    'same-session token refresh does not create a requirement');
  runtime.pump.run('org-context');
  assert.strictEqual(runtime.calls.length, 0, 'same-user reload/fresh state keeps its existing shortcut');
});

test('BUG-01-AF production runtime makes listener, render, and rehydrate transfer idempotent', async () => {
  for (const firstPath of ['listener', 'render', 'rehydrate']) {
    const runtime = await createBillingPumpRuntimeHarness();
    runtime.pump.signOut({ authenticated: true });
    const transferred = firstPath === 'listener'
      ? runtime.pump.authEvent('INITIAL_SESSION', 'user-b', 'org-b')
      : firstPath === 'render'
        ? runtime.pump.renderAuthenticated('INITIAL_SESSION', 'user-b', 'org-b')
        : runtime.pump.rehydrateAuthenticated('INITIAL_SESSION', 'user-b', 'org-b');
    assert.strictEqual(transferred, true, `${firstPath} may own the first confirmed-auth transfer`);
    const generation = runtime.pump.snapshot().authoritativeRequired.generation;

    assert.strictEqual(runtime.pump.authEvent('SIGNED_IN', 'user-b', 'org-b'), false,
      'later listener observation is idempotent');
    assert.strictEqual(runtime.pump.renderAuthenticated('SIGNED_IN', 'user-b', 'org-b'), false,
      'later render observation is idempotent');
    assert.strictEqual(runtime.pump.rehydrateAuthenticated('SIGNED_IN', 'user-b', 'org-b'), false,
      'later rehydrate observation is idempotent');
    assert.strictEqual(runtime.pump.snapshot().authoritativeRequired.generation, generation,
      'multiple confirmed-auth paths retain the single transferred generation');

    runtime.pump.run('render-auth-state');
    assert.strictEqual(runtime.calls.length, 1, 'all paths converge on one direct request');
    runtime.pump.advance(100);
    runtime.pump.run('org-context');
    assert.strictEqual(runtime.calls.length, 1, 'post-success observations do not create a request loop');
  }
});

test('BUG-01-AG transferred requirement survives provisional shared state and clears only at a terminal', async () => {
  const runtime = await createBillingPumpRuntimeHarness();
  Object.assign(runtime.billingState, {
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-a',
    lastFetchedAt: 99990,
  });
  runtime.pump.signOut({ authenticated: true });
  runtime.pump.renderAuthenticated('SIGNED_IN', 'user-b', 'org-b');
  const generation = runtime.pump.snapshot().authoritativeRequired.generation;
  runtime.pump.setShared({
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-b',
    plan: 'Pro',
    entitlementStatus: 'active',
    canManageBilling: null,
    lastFetchedAt: 99990,
  }, 99990);
  runtime.pump.failNext();
  runtime.pump.run('org-context');
  assert.strictEqual(runtime.pump.snapshot().sharedApplyCount, 1,
    'shared organization fields may still apply provisionally');
  assert.strictEqual(runtime.pump.snapshot().authoritativeRequired.generation, generation,
    'shared state plus a failed direct attempt cannot clear the transferred requirement');
  assert.strictEqual(runtime.pump.snapshot().pending, true, 'failed authoritative truth remains fail-closed');

  runtime.pump.run('manual');
  assert.strictEqual(runtime.calls.length, 2, 'explicit recovery performs one later direct attempt');
  assert.strictEqual(runtime.pump.snapshot().authoritativeRequired, null,
    'matching successful direct truth is the terminal that clears the requirement');
  assert.strictEqual(runtime.pump.snapshot().pending, false, 'successful terminal releases pending');
});

test('BUG-01-AJ stale ownership and matching in-flight work cannot use the cooldown bypass', async () => {
  const staleUser = await createBillingPumpRuntimeHarness();
  staleUser.pump.seedOwnedState();
  staleUser.pump.signOut({ authenticated: true });
  staleUser.pump.authEvent('SIGNED_IN', 'user-b', 'org-b');
  staleUser.pump.setIdentityWithoutRequirement('user-a', 'org-a');
  staleUser.pump.run('org-context');
  assert.strictEqual(staleUser.calls.length, 0, 'a stale-user requirement cannot bypass cooldown');

  const staleEpoch = await createBillingPumpRuntimeHarness();
  staleEpoch.pump.seedOwnedState();
  staleEpoch.pump.signOut({ authenticated: true });
  staleEpoch.pump.authEvent('SIGNED_IN', 'user-b', 'org-b');
  staleEpoch.pump.advanceEpochWithoutRequirement();
  staleEpoch.pump.run('org-context');
  assert.strictEqual(staleEpoch.calls.length, 0, 'a stale-epoch requirement cannot bypass cooldown');

  const staleOrg = await createBillingPumpRuntimeHarness();
  staleOrg.pump.signOut({ authenticated: true });
  staleOrg.pump.authEvent('SIGNED_IN', 'user-b', 'org-b');
  const tokenB = staleOrg.pump.getAuthoritativeToken();
  staleOrg.pump.setOrg('org-a');
  assert.strictEqual(staleOrg.pump.isAuthoritativeCurrentForOrg(tokenB, 'org-a'), false,
    'a token captured for the previous organization is no longer current');

  const inFlight = await createBillingPumpRuntimeHarness();
  inFlight.pump.seedOwnedState();
  inFlight.pump.signOut({ authenticated: true });
  inFlight.pump.authEvent('SIGNED_IN', 'user-b', 'org-b');
  const ownedToken = inFlight.pump.getAuthoritativeToken();
  assert.strictEqual(inFlight.pump.beginAuthoritative(ownedToken), true,
    'the matching generation begins one authoritative attempt');
  inFlight.pump.run('org-context');
  assert.strictEqual(inFlight.calls.length, 0,
    'a matching authoritative request already in flight cannot duplicate');
});

test('BUG-01-AK rapid alternating identities bypass inherited cooldown without a request loop', async () => {
  const rapid = await createBillingPumpRuntimeHarness();
  rapid.pump.seedOwnedState();
  for (const [userId, orgId] of [
    ['user-a', 'org-a'],
    ['user-b', 'org-b'],
    ['user-a', 'org-a'],
    ['user-b', 'org-b'],
    ['user-a', 'org-a'],
  ]) {
    rapid.pump.signOut({ authenticated: true });
    rapid.pump.authEvent('SIGNED_IN', userId, orgId);
    rapid.pump.run('org-context');
  }

  assert.deepStrictEqual(rapid.calls.map(call => call.orgId),
    ['org-a', 'org-b', 'org-a', 'org-b', 'org-a'],
    'every confirmed generation gets one owned request and the final identity wins');
  assert.strictEqual(rapid.calls.filter(call => call.orgId === 'org-a').length, 3,
    'the final A generation is not suppressed by prior A/B cooldown history');
  assert.strictEqual(rapid.pump.snapshot().authoritativeRequired, null,
    'the final matching direct result clears its requirement');
  assert.strictEqual(rapid.pump.snapshot().pending, false, 'five switches do not leave pending stuck');
  rapid.pump.advance(100);
  rapid.pump.run('org-context');
  assert.strictEqual(rapid.calls.length, 5, 'post-success callbacks do not create a request loop');

  const shared = await createBillingPumpRuntimeHarness();
  shared.pump.seedOwnedState();
  shared.pump.signOut({ authenticated: true });
  shared.pump.authEvent('SIGNED_IN', 'user-b', 'org-b');
  shared.pump.setShared({
    ok: true,
    loading: false,
    pending: false,
    error: null,
    orgId: 'org-b',
    plan: 'Pro',
    entitlementStatus: 'active',
    canManageBilling: null,
    lastFetchedAt: 99990,
  }, 99990);
  shared.pump.run('org-context');
  assert.strictEqual(shared.calls.length, 1,
    'shared-fresh state cannot suppress the authoritative cooldown bypass');
});

test('BUG-01-M synthetic: billing epoch bump discards delayed prior-user results, including rapid A→B→A', () => {
  // Emulates the epoch contract: refreshBilling captures _epochAtStart before
  // the fetch and discards the result when clearBillingState() (inside
  // applyUserSwitchIsolation) bumped the epoch mid-flight.
  let billingEpoch = 7;
  const applyIsolation = () => { billingEpoch++; };

  const epochAtStartA = billingEpoch;      // delayed User A request in flight
  applyIsolation();                        // A → B
  assert.strictEqual(billingEpoch === epochAtStartA, false, 'delayed A result discarded after A→B');

  const epochAtStartB = billingEpoch;      // delayed User B request in flight
  applyIsolation();                        // B → A (rapid return)
  assert.strictEqual(billingEpoch === epochAtStartA, false, 'first-A-session result still rejected after A→B→A');
  assert.strictEqual(billingEpoch === epochAtStartB, false, 'mid-transition B result rejected after B→A');

  const epochAtStartA2 = billingEpoch;     // fresh request for the returned A session
  assert.strictEqual(billingEpoch === epochAtStartA2, true, 'current-generation request applies normally');
});

test('BUG-01-O pending-flag lifecycle: transition/failure setters and terminal clears remain explicit', async () => {
  const appSrc = await readAppSource();
  const svcSrc = await fs.readFile(billingServiceUrl, 'utf8');

  const setTrue = appSrc.split('__TP3D_USER_SWITCH_PENDING = true').length - 1;
  assert.strictEqual(setTrue, 3,
    'flag becomes true only for cross-user isolation, post-sign-out transfer, and current-token failure preservation');

  const preserveStart = appSrc.indexOf('function preserveUserSwitchPendingForBillingFailure(');
  const preserveEnd = appSrc.indexOf('function isBillingAuthoritativeRefreshRequired(', preserveStart);
  const preserveFn = appSrc.slice(preserveStart, preserveEnd);
  assert.match(preserveFn, /isCurrentBillingAuthoritativeRefreshToken\(token/,
    'failure may re-latch pending only for the current transition token');

  const appClears = appSrc.split('__TP3D_USER_SWITCH_PENDING = false').length - 1;
  assert.strictEqual(appClears, 2, 'app releases the flag in exactly two terminal paths');

  // Terminal 1: sign-out cleanup.
  const cleanupStart = appSrc.indexOf('function _executeSignedOutCleanup(');
  assert.ok(cleanupStart >= 0, '_executeSignedOutCleanup found');
  const cleanupFn = appSrc.slice(cleanupStart, cleanupStart + 3200);
  assert.match(cleanupFn, /__TP3D_USER_SWITCH_PENDING = false/, 'sign-out releases the flag');

  // Terminal 2: confirmed no-workspace state.
  const clearOrgStart = appSrc.indexOf('function clearOrgContext(');
  assert.ok(clearOrgStart >= 0, 'clearOrgContext found');
  const clearOrgFn = appSrc.slice(clearOrgStart, clearOrgStart + 2600);
  const noOrgIdx = clearOrgFn.indexOf('if (confirmedNoOrg) {');
  assert.ok(noOrgIdx >= 0, 'confirmedNoOrg terminal branch found');
  const noOrgRegion = clearOrgFn.slice(noOrgIdx, noOrgIdx + 700);
  assert.match(noOrgRegion, /__TP3D_USER_SWITCH_PENDING = false/, 'confirmed no-workspace releases the flag');

  // Terminal 3: successful OrgContext resolution (billing service; see BUG-01-C).
  assert.match(svcSrc, /__TP3D_USER_SWITCH_PENDING\s*=\s*false/, 'billing service releases the flag when OrgContext resolves');

  // No timer-based clearing inside the isolation contract.
  const helperStart = appSrc.indexOf('function applyUserSwitchIsolation(');
  const helperFn = appSrc.slice(helperStart, helperStart + 2200);
  assert.ok(!/setTimeout|setInterval/.test(helperFn), 'no timers in the isolation contract');
});

test('BUG-01-P same-user refresh and same-user workspace switch never invoke isolation', async () => {
  const src = await readAppSource();

  // Workspace switch path must not isolate.
  const setActiveStart = src.indexOf('async function setActiveOrgId(');
  assert.ok(setActiveStart >= 0, 'setActiveOrgId found');
  const setActiveRegion = src.slice(setActiveStart, setActiveStart + 4200);
  assert.ok(!setActiveRegion.includes('applyUserSwitchIsolation'), 'workspace switch does not run user-switch isolation');

  // Every isolation call site is guarded by an identity-difference condition.
  const defIdx = src.indexOf('function applyUserSwitchIsolation(');
  let from = 0, total = 0, guarded = 0;
  for (;;) {
    const idx = src.indexOf('applyUserSwitchIsolation(', from);
    if (idx === -1) break;
    from = idx + 1;
    if (idx === defIdx + 'function '.length) continue;
    total++;
    const before = src.slice(Math.max(0, idx - 800), idx);
    if (/if \(isUserSwitch\) \{|if \(_isConfirmedUserSwitch\) \{|String\(lastAuthUserId\) !== String\(user\.id\)/.test(before)) guarded++;
  }
  assert.strictEqual(total, 3, 'three isolation call sites');
  assert.strictEqual(guarded, 3, 'every isolation call site requires a detected identity difference');

  // Same-user guard semantics unchanged: raw string ID comparison.
  const guardIdx = src.indexOf('const _isConfirmedUserSwitch =');
  const guardLine = src.slice(guardIdx, guardIdx + 300);
  assert.match(guardLine, /lastAuthUserId !== String\(user\.id\)/, 'same user (matching IDs) never triggers isolation');
});

test('BUG-01-AL runtime: delayed cross-tab active bundle apply clears the stale Loading switcher state', async () => {
  const runtime = await createOrgContextApplyRuntimeHarness();
  const org = { id: 'org-test1', name: 'test1 Workspace', role: 'owner' };

  const appliedOrgId = await runtime.apply({
    session: { access_token: 'redacted' },
    user: { id: 'user-test1' },
    profile: null,
    membership: { organization_id: org.id, role: 'owner' },
    orgs: [org],
    activeOrgId: org.id,
    partial: false,
  }, { reason: 'workspace-ready:self-heal', forceEmit: true });

  const state = runtime.snapshot();
  assert.strictEqual(appliedOrgId, org.id, 'the replacement test1 bundle becomes active');
  assert.strictEqual(state.orgContextResolved, true, 'org context reaches a terminal resolved state');
  assert.strictEqual(state.orgContext.activeOrgId, org.id, 'the final active workspace belongs to test1');
  assert.strictEqual(state.orgContext.activeOrg.name, org.name, 'the switcher has the resolved workspace label');
  assert.strictEqual(state.accountSwitcherRefreshes, 1,
    'the state owner refreshes the mounted switcher after the delayed active apply');
  assert.strictEqual(runtime.calls.__legacyMigrationFinalizations, 1,
    'a full authoritative bundle may finalize a pending legacy migration');
  assert.deepStrictEqual(Array.from(runtime.calls.__orgRequiredCalls), [true],
    'the active-workspace UI is enabled before the final switcher refresh');
});

test('BUG-01-AM runtime: partial bundle stays conservative and a later full bundle performs one final switcher refresh', async () => {
  const runtime = await createOrgContextApplyRuntimeHarness();
  const partialResult = await runtime.apply({
    session: { access_token: 'redacted' },
    user: { id: 'user-test1' },
    orgs: [],
    activeOrgId: null,
    partial: true,
  }, { reason: 'SIGNED_OUT|storage|SIGNED_IN', forceEmit: true });

  assert.strictEqual(partialResult, null, 'an uncertain bundle does not fabricate a workspace');
  assert.strictEqual(runtime.snapshot().orgContextResolved, false, 'partial bundle leaves resolution conservative');
  assert.strictEqual(runtime.snapshot().accountSwitcherRefreshes, 0,
    'partial bundle cannot replace Loading with an unproven workspace');
  assert.strictEqual(runtime.calls.__legacyMigrationFinalizations, 0,
    'partial bundle cannot finalize a legacy migration');

  const org = { id: 'org-test1', name: 'test1 Workspace', role: 'owner' };
  await runtime.apply({
    session: { access_token: 'redacted' },
    user: { id: 'user-test1' },
    profile: null,
    membership: { organization_id: org.id, role: 'owner' },
    orgs: [org],
    activeOrgId: org.id,
    partial: false,
  }, { reason: 'org-queued', forceEmit: false });

  const recovered = runtime.snapshot();
  assert.strictEqual(recovered.orgContextResolved, true, 'the replacement full bundle terminates loading');
  assert.strictEqual(recovered.orgContext.activeOrgId, org.id, 'the replacement belongs to the current identity');
  assert.strictEqual(recovered.accountSwitcherRefreshes, 1,
    'recovery produces exactly one final switcher refresh, not a loop');
  assert.strictEqual(runtime.calls.__legacyMigrationFinalizations, 1,
    'the later full bundle finalizes a pending legacy migration exactly once');
});

test('WORKSPACE-HYDRATION-RACE no interaction and real switches retain boundary reset behavior', async () => {
  const orgA = { id: 'org-a', name: 'Workspace A', role: 'owner' };
  const orgB = { id: 'org-b', name: 'Workspace B', role: 'owner' };
  const makeBundle = activeOrg => ({
    session: { access_token: 'redacted' },
    user: { id: 'user-a' },
    profile: { _isDefault: true, current_organization_id: activeOrg.id },
    membership: { organization_id: activeOrg.id, role: 'owner' },
    orgs: [orgA, orgB],
    activeOrgId: activeOrg.id,
    partial: false,
  });

  const noInteraction = await createOrgContextApplyRuntimeHarness({
    localOrgId: orgA.id,
    hasLoadedWorkspace: true,
    storageScope: 'user-a',
    workspaceScope: orgA.id,
    currentScreen: 'packs',
  });
  await noInteraction.apply(makeBundle(orgA));
  assert.equal(noInteraction.calls.__workspaceApplies[0].options.preserveLiveUi, false);
  assert.deepStrictEqual(Array.from(noInteraction.calls.__workspaceResets), [orgA.id]);

  const realSwitch = await createOrgContextApplyRuntimeHarness({
    initialActiveOrgId: orgB.id,
    localOrgId: orgA.id,
    hasLoadedWorkspace: true,
    storageScope: 'user-a',
    workspaceScope: orgB.id,
    currentScreen: 'editor',
    workspaceSwitchActive: true,
  });
  await realSwitch.apply(makeBundle(orgA));
  assert.equal(realSwitch.calls.__workspaceApplies[0].options.preserveLiveUi, false);
  assert.deepStrictEqual(Array.from(realSwitch.calls.__workspaceResets), [orgA.id]);
});

test('F1-B synthetic: owner-written snapshot cannot grant member owner UI; role resolves per current user', () => {
  // Emulates _applySharedBillingSnapshot plus the sidebar/settings precedence:
  // a backend boolean wins only when present; otherwise the CURRENT user's
  // role decides.
  const sharedSnapshotFromOwnerA = {
    ok: true,
    orgId: 'c2345678-0000-0000-0000-000000000002',
    entitlementStatus: 'active',
    workspaceCount: 2,
    workspaceLimit: 3,
    canManageBilling: true, // written while User A (owner) was signed in
  };

  const applyShared = (snapshot) => {
    const state = {
      entitlementStatus: snapshot.entitlementStatus || null,
      workspaceCount: snapshot.workspaceCount != null ? snapshot.workspaceCount : null,
      workspaceLimit: snapshot.workspaceLimit != null ? snapshot.workspaceLimit : null,
      canManageBilling: typeof snapshot.canManageBilling === 'boolean' ? snapshot.canManageBilling : null,
    };
    state.canManageBilling = null; // F1: user-neutral shared apply
    return state;
  };

  const resolveForUser = (state, currentUserRole) =>
    typeof state.canManageBilling === 'boolean' ? state.canManageBilling : currentUserRole === 'owner';

  const applied = applyShared(sharedSnapshotFromOwnerA);
  assert.strictEqual(applied.entitlementStatus, 'active', 'org-scoped entitlement still shared');
  assert.strictEqual(applied.workspaceCount, 2, 'org-scoped workspace count still shared');
  assert.strictEqual(applied.canManageBilling, null, 'user-specific authority never inherited from the snapshot');

  assert.strictEqual(resolveForUser(applied, 'member'), false, "member User B gets no owner billing UI from A's snapshot");
  assert.strictEqual(resolveForUser(applied, 'owner'), true, 'owner User B still resolves owner controls via current role');
});

test('F1-C role fallbacks that replace the snapshot boolean exist in sidebar and Settings paths', async () => {
  const src = await readAppSource();

  // Sidebar: backend value only when boolean; otherwise current-role
  // resolution; forced false while role hydration is in flight.
  assert.match(src, /_backendCanManageBilling = s && typeof s\.canManageBilling === 'boolean' \? s\.canManageBilling : null/,
    'sidebar reads the backend boolean only when present');
  assert.match(src, /_backendCanManageBilling !== null \? _backendCanManageBilling : _roleResult\.canManageBilling/,
    'sidebar falls back to current-user role resolution when the snapshot is user-neutral');

  const settingsUrl = new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url);
  const settingsSrc = await fs.readFile(settingsUrl, 'utf8');
  assert.match(settingsSrc, /typeof state\.canManageBilling === 'boolean' \? state\.canManageBilling : billingRole === 'owner'/,
    'Settings Billing falls back to the current user role when canManageBilling is unresolved');
});

test('WORKSPACE-HYDRATION-RACE same-workspace loading preserves a newer live Editor and valid Pack', async () => {
  const runtime = await createLateWorkspaceHydrationRuntime();
  runtime.apply('org-a', { seedIfMissing: false, preserveLiveUi: true });

  const state = runtime.snapshot();
  assert.equal(state.currentScreen, 'editor',
    'same-workspace late hydration must not replace the newer live Editor with stored Packs');
  assert.equal(state.currentPackId, 'pack-a',
    'same-workspace late hydration must retain a live Pack that exists in the loaded library');
  assert.deepEqual(state.selectedInstanceIds, [],
    'scoped replacement keeps the existing minimal selection-reset behavior');
});

test('WORKSPACE-HYDRATION-RACE same-workspace loading preserves a newer Cases screen', async () => {
  const runtime = await createLateWorkspaceHydrationRuntime({
    liveScreen: 'cases',
    livePackId: null,
  });
  runtime.apply('org-a', { seedIfMissing: false, preserveLiveUi: true });

  const state = runtime.snapshot();
  assert.equal(state.currentScreen, 'cases');
  assert.equal(state.currentPackId, null);
});

test('WORKSPACE-HYDRATION-RACE no newer UI action keeps ordinary stored-state restoration', async () => {
  const runtime = await createLateWorkspaceHydrationRuntime({
    liveScreen: 'packs',
    livePackId: 'pack-live',
    livePacks: [{ id: 'pack-live' }],
    storedPackId: 'pack-stored',
    storedPacks: [{ id: 'pack-stored' }],
  });
  runtime.apply('org-a', { seedIfMissing: false, preserveLiveUi: false });

  const state = runtime.snapshot();
  assert.equal(state.currentScreen, 'packs');
  assert.equal(state.currentPackId, 'pack-stored',
    'without newer UI, the valid stored Pack identity remains authoritative');
});

test('WORKSPACE-HYDRATION-RACE invalid live Pack falls back without a stale Editor identity', async () => {
  const runtime = await createLateWorkspaceHydrationRuntime({
    liveScreen: 'editor',
    livePackId: 'pack-a',
    livePacks: [{ id: 'pack-a' }],
    storedPackId: null,
    storedPacks: [{ id: 'pack-b' }],
  });
  runtime.apply('org-a', { seedIfMissing: false, preserveLiveUi: true });

  const state = runtime.snapshot();
  assert.equal(state.currentScreen, 'packs');
  assert.equal(state.currentPackId, null);
  assert.deepEqual(state.packLibrary, [{ id: 'pack-b' }]);
});

test('WORKSPACE-HYDRATION-RACE explicit A to B loading never preserves A UI, selection, or history', async () => {
  const runtime = await createLateWorkspaceHydrationRuntime({
    storedPackId: 'pack-b',
    storedPacks: [{ id: 'pack-b' }],
    withPriorHistory: true,
  });
  runtime.apply('org-b', { seedIfMissing: false });
  runtime.resetWorkspaceUi('org-b');

  const state = runtime.snapshot();
  assert.equal(state.currentScreen, 'packs');
  assert.equal(state.currentPackId, null);
  assert.deepEqual(state.selectedInstanceIds, []);
  assert.deepEqual(state.packLibrary, [{ id: 'pack-b' }]);
  assert.equal(runtime.undo(), false, 'A history is unreachable after B replacement');
  assert.equal(runtime.counters.__workspaceScope, 'org-b');
});

test('WORKSPACE-HYDRATION-RACE user-switch and signed-out owners retain the full reset contract', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const userSwitchStart = src.indexOf('function applyUserSwitchIsolation(');
  const userSwitchEnd = src.indexOf('\n    /**\n     * @param {{ event?: string', userSwitchStart);
  const signedOutStart = src.indexOf('function _executeSignedOutCleanup(');
  const signedOutEnd = src.indexOf('\n    const PROFILE_CHECK_TTL_MS', signedOutStart);
  assert.ok(userSwitchStart >= 0 && userSwitchEnd > userSwitchStart && signedOutStart >= 0 && signedOutEnd > signedOutStart,
    'production user-switch and signed-out reset owners are extractable');
  const userSwitchFn = src.slice(userSwitchStart, userSwitchEnd);
  const signedOutFn = src.slice(signedOutStart, signedOutEnd);

  assert.match(userSwitchFn, /flushPendingStorageSave\(\)[\s\S]*resetAppStateToEmpty\(\)/,
    'different-user isolation flushes before resetting all prior-user app state');
  assert.match(signedOutFn, /flushPendingStorageSave\(\)[\s\S]*resetAppStateToEmpty\(\)[\s\S]*Storage\.setStorageScope\('anon'\)/,
    'signed-out cleanup still clears state before changing to the anonymous storage scope');
  assert.doesNotMatch(userSwitchFn, /preserveLiveUi/);
  assert.doesNotMatch(signedOutFn, /preserveLiveUi/);
});

test('APP-STABILIZATION-PHASE2 fresh-tab timestamps outrank old local counters while stale and unsafe payloads stay rejected', async () => {
  const runtime = await createPhase2OrgOrderingHarness();
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  runtime.setOrder(8, 'tab-established');

  assert.equal(runtime.handle({
    orgId: orgA,
    userId: 'user-1',
    tabId: 'tab-fresh',
    epoch: 1,
    ts: 100,
  }), true, 'a fresh tab uses its newer timestamp instead of losing on epoch 1');
  assert.equal(runtime.snapshot().lastAppliedOrgContextVersion, 100);
  assert.equal(runtime.snapshot().activeOrgId, orgA);
  assert.equal(runtime.calls.__dispatches[0].tabId, 'tab-fresh',
    'the accepted origin tab id is preserved through the local relay');

  assert.equal(runtime.handle({
    orgId: orgB,
    userId: 'user-1',
    tabId: 'tab-stale',
    epoch: 9,
    timestamp: 90,
  }), false, 'a genuinely older logical version stays rejected');
  assert.equal(runtime.handle({
    orgId: orgB,
    userId: 'another-user',
    tabId: 'tab-z',
    epoch: 101,
  }), false, 'wrong-user payload stays rejected');
  assert.equal(runtime.handle({
    orgId: orgB,
    userId: 'user-1',
    tabId: 'tab-local',
    epoch: 101,
  }), false, 'self-origin payload stays rejected');
  assert.equal(runtime.handle({
    orgId: 'not-an-org',
    userId: 'user-1',
    tabId: 'tab-z',
    epoch: 101,
  }), false, 'malformed organization payload stays rejected');
  assert.equal(runtime.snapshot().activeOrgId, orgA);
});

test('WORKSPACE-HYDRATION-RACE cross-tab A to B remains a real UI reset boundary', async () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const runtime = await createPhase2OrgOrderingHarness({ initialActiveOrgId: orgA });

  assert.equal(runtime.handle({
    orgId: orgB,
    userId: 'user-1',
    tabId: 'tab-remote',
    epoch: 100,
    ts: 100,
  }), true);
  assert.deepEqual(Array.from(runtime.calls.__appliedOrgs), [orgB]);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.calls.__applyOptions)), [{ seedIfMissing: false }],
    'cross-tab loading never opts into same-workspace UI preservation');
  assert.deepEqual(Array.from(runtime.calls.__workspaceResets), [orgB]);
  assert.equal(runtime.snapshot().activeOrgId, orgB);
});

test('APP-STABILIZATION-PHASE2 equal versions converge by tab id and the next local version advances past remote state', async () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const payloadA = { orgId: orgA, userId: 'user-1', tabId: 'tab-a', epoch: 500, ts: 500 };
  const payloadZ = { orgId: orgB, userId: 'user-1', tabId: 'tab-z', epoch: 500, ts: 500 };

  const first = await createPhase2OrgOrderingHarness();
  assert.equal(first.handle(payloadA), true);
  assert.equal(first.handle(payloadZ), true);
  assert.equal(first.snapshot().lastAppliedOrgContextTabId, 'tab-z');
  assert.equal(first.snapshot().activeOrgId, orgB);

  const second = await createPhase2OrgOrderingHarness();
  assert.equal(second.handle(payloadZ), true);
  assert.equal(second.handle(payloadA), false);
  assert.equal(second.snapshot().lastAppliedOrgContextTabId, 'tab-z');
  assert.equal(second.snapshot().activeOrgId, orgB,
    'both arrival orders choose the same tab-id winner');

  const futureVersion = Date.now() + 60000;
  second.setOrder(futureVersion, 'tab-z');
  assert.equal(second.next(), futureVersion + 1,
    'a later local dispatch advances beyond the last applied remote version');
});

test('APP-STABILIZATION-PHASE2 canonical sync cancels the legacy fallback only after acceptance', async () => {
  const src = await readAppSource();
  const canonicalStart = src.indexOf('if (key === ORG_CONTEXT_SYNC_KEY && ev.newValue) {');
  const canonicalEnd = src.indexOf('if (key === WORKSPACE_SWITCH_SYNC_KEY', canonicalStart);
  const canonicalBlock = src.slice(canonicalStart, canonicalEnd);
  assert.ok(canonicalBlock, 'canonical storage handler is extractable');
  assert.match(canonicalBlock, /const accepted = payload[\s\S]*handleIncomingOrgContextSync/,
    'canonical handling records whether the payload was actually accepted');
  assert.match(canonicalBlock, /if \(accepted && _legacyOrgSyncTimer\) \{[\s\S]*clearTimeout\(_legacyOrgSyncTimer\)/,
    'only an accepted canonical payload cancels the legacy backend-refresh fallback');
  assert.doesNotMatch(canonicalBlock, /canonical-arrived/,
    'mere arrival is no longer treated as successful reconciliation');
});

test('APP-STABILIZATION-PHASE4 invite failures distinguish terminal responses from retryable failures', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function isTerminalInviteAcceptFailure(');
  const end = src.indexOf('\n\n      function clearPendingInviteToken(', start);
  const classifierSource = src.slice(start, end);
  assert.ok(start >= 0 && end > start, 'terminal invite classifier is extractable');

  const context = {};
  vm.createContext(context);
  vm.runInContext(`
    ${classifierSource}
    globalThis.__isTerminal = isTerminalInviteAcceptFailure;
  `, context);

  for (const message of [
    'Invite not found or expired.',
    'This invite link has expired.',
    'Invite email does not match the signed-in account.',
    'Invite is no longer valid.',
    'Invite was revoked.',
    'Invite has an invalid role.',
    'Missing invite token',
  ]) {
    assert.equal(context.__isTerminal(message), true, `${message} is terminal`);
  }
  for (const message of [
    'Network error',
    'Failed to fetch',
    'Request timed out',
    'Internal server error',
    'Invite acceptance failed',
    'Unexpected response',
    'JWT expired',
    'Function not found',
    'Invite acceptance request expired',
    'Invite acceptance failed: JWT expired',
    'Invite function not found',
    '',
  ]) {
    assert.equal(context.__isTerminal(message), false, `${message || 'empty failure'} remains retryable`);
  }
});

test('APP-STABILIZATION-PHASE4 invite token clears only on success or confirmed terminal failure', async () => {
  const success = await createPhase4InviteHarness({
    response: { ok: true, organization_id: '11111111-1111-4111-8111-111111111111' },
  });
  await success.context.__run({ access_token: 'session-access-token' });
  assert.equal(success.context.__getToken(), null, 'success clears the in-memory token');
  assert.equal(success.sessionStorage.getItem('tp3d:pending_invite_token'), null,
    'success clears the session-storage copy');
  assert.equal(success.context.__tokenAtRefresh, null,
    'success clears the token before refreshing or switching organization context');

  const terminal = await createPhase4InviteHarness({
    response: { ok: false, error: 'Invite email does not match the signed-in account.' },
  });
  await terminal.context.__run({ access_token: 'session-access-token' });
  assert.equal(terminal.context.__getToken(), null, 'terminal rejection clears the in-memory token');
  assert.equal(terminal.sessionStorage.getItem('tp3d:pending_invite_token'), null,
    'terminal rejection clears the session-storage copy');

  const retryableResult = await createPhase4InviteHarness({
    response: { ok: false, error: 'Internal server error' },
  });
  await retryableResult.context.__run({ access_token: 'session-access-token' });
  assert.equal(retryableResult.context.__getToken(), 'phase4-secret-token',
    'retryable server result retains the in-memory token');
  assert.equal(retryableResult.sessionStorage.getItem('tp3d:pending_invite_token'), 'phase4-secret-token',
    'retryable server result retains the session-storage copy');

  const retryableThrow = await createPhase4InviteHarness({ throwMessage: 'Failed to fetch' });
  await retryableThrow.context.__run({ access_token: 'session-access-token' });
  assert.equal(retryableThrow.context.__getToken(), 'phase4-secret-token',
    'retryable thrown failure retains the in-memory token');
  assert.equal(retryableThrow.sessionStorage.getItem('tp3d:pending_invite_token'), 'phase4-secret-token',
    'retryable thrown failure retains the session-storage copy');

  for (const runtime of [success, terminal, retryableResult, retryableThrow]) {
    assert.equal(runtime.context.__toasts.some(message => message.includes('phase4-secret-token')), false,
      'invite feedback never renders the raw token');
  }
});

test('P0-CONTRACT window.OrgContext exposes exactly four members and no unresolved facade methods', async () => {
  const app = await readAppSource();
  const start = app.indexOf('const OrgContext = {');
  assert.ok(start >= 0, 'OrgContext object literal must exist');
  const end = app.indexOf('\n    };', start);
  assert.ok(end > start, 'OrgContext literal must close');
  const facade = app.slice(start, end);

  for (const m of ['getActiveOrgId', 'setActiveOrgId', 'hydrateActiveOrgId', 'getActiveRole']) {
    assert.match(facade, new RegExp('\\n {6}' + m + '[,:]'), `OrgContext must expose ${m}`);
  }
  const members = (facade.match(/\n {6}[a-zA-Z]+[,:]/g) || []).length;
  assert.equal(members, 4, 'OrgContext must expose exactly four members');
  for (const absent of ['handleWorkspaceLeft', 'handleOwnershipTransferred', 'notifyOrgAccessLoss']) {
    assert.doesNotMatch(facade, new RegExp(absent),
      `OrgContext must not expose the unresolved member ${absent}`);
  }
  assert.match(app, /window\.OrgContext = OrgContext/, 'OrgContext assignment timing must be preserved');
});
