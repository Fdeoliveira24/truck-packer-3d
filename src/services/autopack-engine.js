import { buildLegacyAutoPackItems } from './autopack-legacy-solver.js';
// AutoPack routes through the packing-core strategy runner: the core owns
// strategy orchestration and the solution envelope; the selected default
// solution is byte-equivalent to a direct solveAutoPack call, so the engine
// stays a thin orchestrator. (Supersedes the direct-solver-call wiring the
// A1-R6 source contract pinned — update that spec on the validation branch.)
import { runPackingStrategies } from '../packing-core/solution.js';
import { DEFAULT_SOLVE_BUDGET_MS } from '../packing-core/budget.js';

// The staged pose MUST be atomic: position, rotation and orientedDims all describe
// the SAME deterministic valid orientation. The chosen orientation is the first
// AutoPack orientation candidate (which already honors the instance lock, case
// orientationLock and canFlip, and whose dims are derived from its rotation via the
// shared THREE helper). Do NOT read stale orientedDims from a previous AutoPack run
// (RC-4). Module-scope + exported so the contract is directly testable.
export function buildStagedPose(item) {
  const ori = item && Array.isArray(item.orientations) ? item.orientations[0] : null;
  if (ori && Number(ori.l) > 0 && Number(ori.w) > 0 && Number(ori.h) > 0) {
    return {
      dims: { length: Number(ori.l), width: Number(ori.w), height: Number(ori.h) },
      rotation: { x: Number(ori.rotX) || 0, y: Number(ori.rotY) || 0, z: Number(ori.rotZ) || 0 },
    };
  }
  const base = (item && item.caseData && item.caseData.dimensions) || { length: 24, width: 24, height: 24 };
  return {
    dims: { length: base.length, width: base.width, height: base.height },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

const ANIMATION_BOUNDARY_EPS = 0.05;
export const LARGE_LOAD_ANIMATION_THRESHOLD = 300;

function animationNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function shouldSnapLargeAutoPackLoad(placementCount, threshold = LARGE_LOAD_ANIMATION_THRESHOLD) {
  const count = Math.max(0, Math.floor(animationNumber(placementCount, 0)));
  const limit = Math.max(0, Math.floor(animationNumber(threshold, LARGE_LOAD_ANIMATION_THRESHOLD)));
  return count > limit;
}

function animationBoundaryKey(value) {
  return Math.round(animationNumber(value) / ANIMATION_BOUNDARY_EPS);
}

function animationXzOverlapArea(a, b) {
  const overlapX = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const overlapZ = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
  return overlapX * overlapZ;
}

function animationAabb(position, dims) {
  const length = Math.max(0, animationNumber(dims && dims.length));
  const width = Math.max(0, animationNumber(dims && dims.width));
  const height = Math.max(0, animationNumber(dims && dims.height));
  const x = animationNumber(position && position.x);
  const y = animationNumber(position && position.y);
  const z = animationNumber(position && position.z);
  return {
    min: { x: x - length / 2, y: y - height / 2, z: z - width / 2 },
    max: { x: x + length / 2, y: y + height / 2, z: z + width / 2 },
  };
}

/**
 * Build deterministic animation batches without mutating solver output.
 * A batch never crosses a support layer, front-edge row/load wall, or caseId
 * group. Direct supporters are completed before a child becomes eligible.
 */
export function buildPlacementAnimationBatches(
  placements,
  orientedDimsMap,
  caseIdMap,
  maxBatchSize = 4,
  options = {}
) {
  const limit = Math.max(1, Math.floor(animationNumber(maxBatchSize, 4)));
  const frontSurfaceFirst = options.frontSurfaceFirst === true;
  const floorZones = Array.isArray(options.zones) ? options.zones : [];
  const entries = Array.from(placements instanceof Map ? placements.entries() : [])
    .map(([id, position], sourceIndex) => {
      const dims = orientedDimsMap instanceof Map ? orientedDimsMap.get(id) : null;
      const aabb = animationAabb(position, dims);
      const caseId = caseIdMap instanceof Map ? String(caseIdMap.get(id) || '') : '';
      return {
        id,
        position,
        sourceIndex,
        caseId,
        aabb,
        layerKey: animationBoundaryKey(aabb.min.y),
        rowKey: animationBoundaryKey(aabb.max.x),
        isZoneFloor: floorZones.some(zone =>
          aabb.min.x >= animationNumber(zone?.min?.x) - ANIMATION_BOUNDARY_EPS &&
          aabb.max.x <= animationNumber(zone?.max?.x) + ANIMATION_BOUNDARY_EPS &&
          aabb.min.y >= animationNumber(zone?.min?.y) - ANIMATION_BOUNDARY_EPS &&
          aabb.max.y <= animationNumber(zone?.max?.y) + ANIMATION_BOUNDARY_EPS &&
          aabb.min.z >= animationNumber(zone?.min?.z) - ANIMATION_BOUNDARY_EPS &&
          aabb.max.z <= animationNumber(zone?.max?.z) + ANIMATION_BOUNDARY_EPS &&
          Math.abs(aabb.min.y - animationNumber(zone?.min?.y)) <= ANIMATION_BOUNDARY_EPS
        ),
      };
    });

  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const dependencies = new Map(entries.map(entry => [entry.id, new Set()]));
  for (const child of entries) {
    for (const support of entries) {
      if (support === child) continue;
      if (Math.abs(child.aabb.min.y - support.aabb.max.y) > ANIMATION_BOUNDARY_EPS) continue;
      if (animationXzOverlapArea(child.aabb, support.aabb) <= ANIMATION_BOUNDARY_EPS) continue;
      dependencies.get(child.id).add(support.id);
    }
  }
  const retentionDependencies = options.retentionDependencies instanceof Map
    ? options.retentionDependencies
    : new Map();
  for (const [childId, retainerIds] of retentionDependencies) {
    if (!byId.has(childId)) continue;
    for (const retainerId of retainerIds || []) {
      if (byId.has(retainerId)) dependencies.get(childId).add(retainerId);
    }
  }

  const semanticGroupOrder = new Map();
  for (const entry of entries) {
    const key = `${entry.layerKey}|${entry.rowKey}|${entry.caseId}`;
    const current = semanticGroupOrder.get(key);
    if (current === undefined || entry.sourceIndex < current) {
      semanticGroupOrder.set(key, entry.sourceIndex);
    }
  }

  const compareReady = (a, b) => {
    if (frontSurfaceFirst && a.isZoneFloor !== b.isZoneFloor) {
      return a.isZoneFloor ? -1 : 1;
    }
    if (frontSurfaceFirst && a.isZoneFloor && b.isZoneFloor) {
      if (a.rowKey !== b.rowKey) return b.rowKey - a.rowKey;
      if (a.layerKey !== b.layerKey) return a.layerKey - b.layerKey;
    }
    if (a.layerKey !== b.layerKey) return a.layerKey - b.layerKey;
    if (a.rowKey !== b.rowKey) return b.rowKey - a.rowKey;
    const aGroup = semanticGroupOrder.get(`${a.layerKey}|${a.rowKey}|${a.caseId}`);
    const bGroup = semanticGroupOrder.get(`${b.layerKey}|${b.rowKey}|${b.caseId}`);
    if (aGroup !== bGroup) return aGroup - bGroup;
    const zDelta = a.aabb.min.z - b.aabb.min.z;
    if (zDelta) return zDelta;
    return a.sourceIndex - b.sourceIndex;
  };

  const pending = new Set(entries.map(entry => entry.id));
  const completed = new Set();
  const batches = [];
  while (pending.size) {
    const ready = [...pending]
      .map(id => byId.get(id))
      .filter(entry => [...dependencies.get(entry.id)].every(id => completed.has(id)))
      .sort(compareReady);
    // Solver validation guarantees an acyclic physical support graph. Keep a
    // deterministic fallback so malformed diagnostic input cannot hang animation.
    const first = ready[0] || [...pending].map(id => byId.get(id)).sort(compareReady)[0];
    const sameBoundary = (ready.length ? ready : [first])
      .filter(entry =>
        entry.layerKey === first.layerKey &&
        entry.rowKey === first.rowKey &&
        entry.caseId === first.caseId
      )
      .sort(compareReady);
    const selected = sameBoundary.slice(0, limit);
    const batch = selected.map(entry => [entry.id, entry.position]);
    batches.push(batch);
    for (const entry of selected) {
      pending.delete(entry.id);
      completed.add(entry.id);
    }
  }
  return batches;
}

export function buildAutoPackNextCases(
  cases,
  placements,
  rotations,
  orientedDimsMap,
  stagingMap
) {
  return (cases || []).map(inst => {
    if (inst.hidden) { return inst; }
    const isPacked = placements instanceof Map && placements.has(inst.id);
    const currentRotation =
      inst.transform && inst.transform.rotation
        ? inst.transform.rotation
        : { x: 0, y: 0, z: 0 };

    let pos;
    let rot;
    let od;
    if (isPacked) {
      pos = placements.get(inst.id);
      rot = rotations instanceof Map ? (rotations.get(inst.id) || currentRotation) : currentRotation;
      od = orientedDimsMap instanceof Map ? (orientedDimsMap.get(inst.id) || null) : null;
    } else {
      // Unpacked -> staged. Apply the ATOMIC staged pose: the rotation and
      // orientedDims describe the exact orientation whose dimensions produced
      // the staging position, so the rendered item rests on the staging floor
      // instead of floating (Repair 1B).
      const staged = stagingMap instanceof Map ? stagingMap.get(inst.id) : null;
      if (!staged || !staged.position) { return inst; }
      pos = staged.position;
      rot = staged.rotation || currentRotation;
      od = staged.orientedDims || null;
    }
    if (!pos) { return inst; }

    const next = {
      ...inst,
      transform: {
        ...inst.transform,
        position: pos,
        rotation: rot,
      },
      hidden: false,
      placement: isPacked ? 'packed' : 'staged',
    };

    const isIdentityRotation =
      Number(rot && rot.x) === 0 && Number(rot && rot.y) === 0 && Number(rot && rot.z) === 0;
    if (isPacked) {
      if (od) {
        next.orientedDims = od;
      } else {
        delete next.orientedDims;
      }
    } else if (od && !isIdentityRotation) {
      // Non-identity staged orientation: keep orientedDims so the rendered
      // height matches the staging Y.
      next.orientedDims = od;
    } else {
      // Identity staged orientation: base case dims already match, so drop
      // orientedDims and let applyTransform/normalizer use the base dimensions.
      delete next.orientedDims;
    }
    return next;
  });
}

export function createAutoPackEngine({
  CaseLibrary,
  CaseScene,
  OperationLifecycle = null,
  capturePackPreview,
  getActiveOrgIdForBilling,
  getOrgRoleHydrationState,
  getProRuleSet,
  getWorkspaceSwitchState,
  maybeScheduleBillingRefresh,
  normalizeOrgIdForBilling,
  openSettingsOverlay,
  PackLibrary,
  runtimeWindow = window,
  SceneManager,
  StateStore,
  toast,
  TrailerGeometry,
  UIComponents,
  Utils,
}) {
  // Animate a small group at a time so front-to-rear loading remains easy to follow.
  // Keep this above 1; a single-item batch makes large loads take far too long.
  const ANIMATION_BATCH_SIZE = 4;
  const ANIMATION_BATCH_GAP_MS = 16;
  const ANIMATION_DURATION_MS = 260;
  const TWEEN_FALLBACK_GRACE_MS = 90;
  let isRunning = false;
  let workspaceGeneration = 0;

  function bumpWorkspaceGeneration() {
    workspaceGeneration += 1;
    return workspaceGeneration;
  }

  function cancelAllTweens() {
    const T = runtimeWindow.TWEEN || null;
    if (T && typeof T.removeAll === 'function') { T.removeAll(); }
  }

  function stageInstant(stagingMap) {
    for (const [id, staged] of stagingMap.entries()) {
      const obj = CaseScene.getObject(id);
      if (!obj || !staged || !staged.position) { continue; }
      // Apply the FULL staged pose ATOMICALLY (position + rotation + oriented
      // bounds) in a single synchronous pass — no frame may render with the new
      // staged position but the old rotation/halfWorld. Mirrors the values
      // prepareObjectForPlacement applies for packed items, so the rendered THREE
      // bounds match the staged pose during every frame (Repair 1D).
      const t = SceneManager.vecInchesToWorld(staged.position);
      obj.position.set(t.x, t.y, t.z);
      if (staged.rotation && obj.rotation && typeof obj.rotation.set === 'function') {
        obj.rotation.set(
          Number(staged.rotation.x) || 0,
          Number(staged.rotation.y) || 0,
          Number(staged.rotation.z) || 0
        );
      }
      if (staged.orientedDims && obj.userData) {
        obj.userData.halfWorld = {
          x: SceneManager.toWorld(staged.orientedDims.length) / 2,
          y: SceneManager.toWorld(staged.orientedDims.height) / 2,
          z: SceneManager.toWorld(staged.orientedDims.width) / 2,
        };
      }
    }
  }

  function applyScenePoseFromCases(cases) {
    for (const inst of cases || []) {
      if (!inst || inst.hidden) continue;
      const obj = CaseScene.getObject(inst.id);
      const pos = inst.transform && inst.transform.position;
      if (!obj || !pos) continue;
      const rot = inst.transform.rotation || { x: 0, y: 0, z: 0 };
      if (obj.userData) {
        if (inst.orientedDims) {
          obj.userData.halfWorld = {
            x: SceneManager.toWorld(inst.orientedDims.length) / 2,
            y: SceneManager.toWorld(inst.orientedDims.height) / 2,
            z: SceneManager.toWorld(inst.orientedDims.width) / 2,
          };
        } else if (obj.userData.baseHalfWorld) {
          obj.userData.halfWorld = { ...obj.userData.baseHalfWorld };
        }
      }
      const target = SceneManager.vecInchesToWorld(pos);
      obj.position.set(target.x, target.y, target.z);
      if (obj.rotation && typeof obj.rotation.set === 'function') {
        obj.rotation.set(Number(rot.x) || 0, Number(rot.y) || 0, Number(rot.z) || 0);
      }
    }
  }

  async function pack() {
    if (isRunning) { return; }
    // Cross-operation guard: do not start AutoPack while Unpack, a truck change,
    // or a preview capture owns the editor. (The billing gate below is synchronous,
    // so the slot is actually claimed at `isRunning = true` with no await in between.)
    if (OperationLifecycle && OperationLifecycle.isBusy()) {
      UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'AutoPack' });
      return;
    }
    let opToken = null;
    const runWorkspaceGeneration = workspaceGeneration;
    // Stale if the workspace/project changed mid-run, OR another operation has taken
    // over the editor slot. The isBusy() clause is essential: after this run's own
    // finishOperation() the slot is idle, which is normal completion (not stale) —
    // so the post-run preview-capture scheduling below still fires.
    const isWorkspaceRunStale = () =>
      runWorkspaceGeneration !== workspaceGeneration ||
      (opToken !== null && OperationLifecycle && OperationLifecycle.isBusy() && !OperationLifecycle.isCurrent(opToken));

    // Billing gate: AutoPack requires active Pro subscription.
    try {
      const billingApi = runtimeWindow.__TP3D_BILLING || null;
      const _bs = billingApi && typeof billingApi.getBillingState === 'function'
        ? billingApi.getBillingState() : null;
      const _activeBillingOrgId = getActiveOrgIdForBilling();
      const _workspaceSwitch = getWorkspaceSwitchState();
      const _switchTargetOrgId = normalizeOrgIdForBilling(_workspaceSwitch && _workspaceSwitch.toOrgId ? _workspaceSwitch.toOrgId : '');
      if (
        _workspaceSwitch &&
        _workspaceSwitch.active &&
        _activeBillingOrgId &&
        _switchTargetOrgId === _activeBillingOrgId &&
        !_workspaceSwitch.billingReady
      ) {
        maybeScheduleBillingRefresh('autopack-org-mismatch');
        UIComponents.showToast('Switching workspace... please try again in a moment.', 'info', { title: 'AutoPack' });
        return;
      }
      if (!_bs || !_bs.ok) {
        UIComponents.showToast('Billing unavailable. Please try again.', 'warning', { title: 'AutoPack' });
        return;
      }
      const _billingSnapshotOrgId = normalizeOrgIdForBilling(_bs && _bs.orgId ? _bs.orgId : '');
      if (_activeBillingOrgId && _billingSnapshotOrgId && _billingSnapshotOrgId !== _activeBillingOrgId) {
        maybeScheduleBillingRefresh('autopack-org-mismatch');
        UIComponents.showToast('Refreshing billing for this workspace. AutoPack will be available shortly.', 'info', { title: 'AutoPack' });
        return;
      }
      const _autopackOrgId = _activeBillingOrgId || _billingSnapshotOrgId;
      const _autopackHydration = _autopackOrgId ? getOrgRoleHydrationState(_autopackOrgId) : 'unknown';
      if (_autopackHydration === 'inflight') {
        UIComponents.showToast('Loading billing... please try again in a moment.', 'info', { title: 'AutoPack' });
        return;
      }
      const orgContext = runtimeWindow.OrgContext || null;
      const activeRole = orgContext && typeof orgContext.getActiveRole === 'function' ? orgContext.getActiveRole() : null;
      const _rules = getProRuleSet(_bs, activeRole);
      if (!_rules.canUseProFeature) {
        UIComponents.showToast(_rules.uxMessage, 'info', { title: 'AutoPack' });
        if (_rules.isOwner && (_rules.blockReason === 'trial_expired' || _rules.blockReason === 'payment_failed')) {
          try { openSettingsOverlay('billing'); } catch (_) { /* ignore */ }
        }
        return;
      }
    } catch (_) {
      UIComponents.showToast('Billing unavailable. Please try again.', 'warning', { title: 'AutoPack' });
      return;
    }

    const packId = StateStore.get('currentPackId');
    const packData = PackLibrary.getById(packId);
    if (!packData) {
      UIComponents.showToast('Open a pack first', 'warning');
      return;
    }
    if (!(packData.cases || []).length) {
      UIComponents.showToast('No cases to pack', 'warning');
      return;
    }

    isRunning = true;
    // Claim the single mutating-operation slot for the whole run. No await ran
    // between the isBusy() check above and here, so this cannot lose a race.
    opToken = OperationLifecycle ? OperationLifecycle.beginOperation('autopacking', { packId }) : null;
    cancelAllTweens();
    const runStartedAt = nowMs();
    let solverMs = 0;
    let animationMs = 0;
    const animationMetrics = { animated: 0, batches: 0, fallbackCount: 0 };
    animationMetrics.skipped = false;
    animationMetrics.strategy = 'batched';
    animationMetrics.threshold = LARGE_LOAD_ANIMATION_THRESHOLD;
    animationMetrics.placementCount = 0;

    const diag =
      (typeof runtimeWindow !== 'undefined' &&
        runtimeWindow.__TP3D_DIAG__ &&
        typeof runtimeWindow.__TP3D_DIAG__.isActive === 'function' &&
        runtimeWindow.__TP3D_DIAG__.isActive())
        ? runtimeWindow.__TP3D_DIAG__
        : null;

    try {
      toast('Building load plan…', 'info', { title: 'AutoPack', duration: 1800 });

      const truck = packData.truck;
      const mode = (truck && truck.shapeMode) ? truck.shapeMode : 'rect';
      const truckL = truck.length || 636;
      const truckW = truck.width || 102;
      const truckH = truck.height || 98;
      const zones = TrailerGeometry.getTrailerUsableZones(truck);

      // All truck modes default to front-first loading (high X first), keeping
      // Standard, Wheel Wells, and Front Overhang consistent. This flag only
      // affects placement ordering/anchoring; usable and blocked zones (wheel
      // wells, cab void) are resolved separately via getTrailerUsableZones and
      // are unaffected by load direction.
      const loadFrontFirst = true;
      const xStep = Math.max(2, Math.min(12, truckL / 60));
      const zStep = Math.max(2, Math.min(12, truckW / 20));

      const packItems = buildLegacyAutoPackItems({
        instances: packData.cases || [],
        getCaseById: caseId => CaseLibrary.getById(caseId),
        volumeInCubicInches: Utils.volumeInCubicInches,
        orientationTools: {
          normalizeRightAngleRotation: PackLibrary.normalizeRightAngleRotation,
          getOrientedDimsForRotation: PackLibrary.getOrientedDimsForRotation,
        },
      });

      // Surface dangling instances that AutoPack cannot pack: they are never given
      // fabricated dimensions, so they are excluded rather than mis-placed.
      const unresolvedExcluded = (packData.cases || []).filter(
        inst => inst && !inst.hidden && !CaseLibrary.getById(inst.caseId)
      ).length;
      if (unresolvedExcluded > 0) {
        toast(
          `${unresolvedExcluded} unresolved item${unresolvedExcluded === 1 ? '' : 's'} excluded from AutoPack ` +
          '(missing case definition).',
          'warning',
          { title: 'AutoPack' }
        );
      }

      const stagingMap = buildStagingMap(packItems, truck);
      stageInstant(stagingMap);
      // Paint a concrete working state, then yield a frame, BEFORE the synchronous
      // solver locks the main thread — otherwise large packs look frozen at their
      // old positions with a stale "starting" toast.
      toast('Checking fit, stacking, and safety rules…', 'info', { title: 'AutoPack', duration: 4000 });
      await waitForAnimationFrames(2);
      if (isWorkspaceRunStale()) return;

      try {
        if (diag && typeof diag.autopackStart === 'function') {
          diag.autopackStart({
            packId,
            mode,
            loadFrontFirst,
            truck: { length: truckL, width: truckW, height: truckH },
            zones: zones && zones.length ? zones.length : 0,
            xStep,
            zStep,
            items: packItems.length,
          });
        }
      } catch {
        // ignore
      }

      const solverStartedAt = nowMs();
      const hiddenPacked = (packData.cases || []).filter(inst =>
        inst && inst.hidden === true && inst.placement !== 'staged'
      );
      const hiddenRetention = hiddenPacked.length
        ? PackLibrary.reconcilePlacementsForTruck(
          { ...packData, cases: hiddenPacked },
          truck,
          CaseLibrary.getCases()
        ).acceptedPlacements
        : [];
      const packingSolution = runPackingStrategies({
        truck,
        zones,
        loadFrontFirst,
        enableWheelWellBridge: mode === 'wheelWells',
        // Interactive main-thread solve: cap the synchronous work so a huge
        // load returns the best partial plan instead of freezing the tab.
        solveBudgetMs: DEFAULT_SOLVE_BUDGET_MS,
        retentionPlacements: hiddenRetention,
        items: packItems.map(({ inst, caseData }) => {
          const d = caseData.dimensions || { length: 0, width: 0, height: 0 };
          return {
            instanceId: inst.id,
            caseId: inst.caseId,
            dims: { l: d.length, w: d.width, h: d.height },
            shape: caseData.shape,
            weight: caseData.weight,
            canFlip: caseData.canFlip,
            orientationLock: caseData.orientationLock,
            orientationLocked: inst.orientationLocked,
            lockedRotation: inst.lockedRotation,
            orientedDims: inst.orientedDims,
            transform: inst.transform,
            noStackOnTop: caseData.noStackOnTop,
            stackable: caseData.stackable,
            maxStackCount: caseData.maxStackCount,
            isPallet: caseData.isPallet,
            laneItem: caseData.laneItem,
            loadPriority: inst.loadPriority ?? caseData.loadPriority,
            mustLoadLast: inst.mustLoadLast ?? caseData.mustLoadLast,
            mustUnloadFirst: inst.mustUnloadFirst ?? caseData.mustUnloadFirst,
            stopGroup: inst.stopGroup ?? caseData.stopGroup,
            keepTogetherGroup: inst.keepTogetherGroup ?? caseData.keepTogetherGroup,
            deliverySequence: inst.deliverySequence,
          };
        }),
      });
      // Current UI consumes the selected default solution; additional
      // strategies stay available on packingSolution.solutions for future UI.
      const solverResult = packingSolution ? packingSolution.selectedSolution : null;
      solverMs = nowMs() - solverStartedAt;
      if (!solverResult || isWorkspaceRunStale()) return;

      const placements = solverResult.placements;
      const rotations = solverResult.rotations;
      const orientedDimsMap = solverResult.orientedDims;
      const animationCaseIds = new Map(packItems.map(item => [item.inst.id, item.inst.caseId || item.caseData.id || '']));
      const frontSurfaceFirst = mode === 'frontBonus' && zones.some(zone =>
        Number(zone?.min?.y) > 0.05 && Number(zone?.max?.x) > truckL + 0.05
      );
      const unpacked = solverResult.unpacked || [];
      const packedCount = placements instanceof Map ? placements.size : 0;
      animationMetrics.placementCount = packedCount;
      const largeLoadSnap = shouldSnapLargeAutoPackLoad(packedCount);

      toast('Preparing final layout…', 'info', { title: 'AutoPack', duration: 1600 });

      const nextCases = buildAutoPackNextCases(
        packData.cases || [],
        placements,
        rotations,
        orientedDimsMap,
        stagingMap
      );
      PackLibrary.update(packId, { cases: nextCases });

      cancelAllTweens();
      const animationStartedAt = nowMs();
      let animationCompleted = true;
      if (largeLoadSnap) {
        animationMetrics.skipped = true;
        animationMetrics.strategy = 'instant';
        applyScenePoseFromCases(nextCases);
        if (packedCount > 0) {
          toast('Large load detected. Showing the final layout instantly to keep the editor responsive.', 'info', {
            title: 'AutoPack',
            duration: 2600,
          });
        }
      } else {
        // The final pack state was already committed. Reset only the live meshes
        // to their staging pose so the legacy small-load animation can still run.
        stageInstant(stagingMap);
        animationCompleted = await animatePlacements(
          placements,
          rotations,
          orientedDimsMap,
          animationCaseIds,
          isWorkspaceRunStale,
          animationMetrics,
          {
            frontSurfaceFirst,
            zones,
            retentionDependencies: solverResult.retentionDependencies,
          }
        );
      }
      animationMs = nowMs() - animationStartedAt;
      if (!animationCompleted || isWorkspaceRunStale()) {
        applyScenePoseFromCases(nextCases);
        return;
      }

      const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
      const totalPackable = (packData.cases || []).filter(i => !i.hidden).length;
      const stagedCount = Math.max(0, totalPackable - stats.packedCases);
      const stagedSuffix = stagedCount > 0 ? ` ${stagedCount} moved to staging.` : '';
      UIComponents.showToast(
        `Packed ${stats.packedCases} of ${totalPackable} cases (${stats.volumePercent.toFixed(1)}% volume).${stagedSuffix}`,
        stats.packedCases === totalPackable ? 'success' : 'warning',
        { title: 'AutoPack' }
      );
      const budgetWarning = Array.isArray(solverResult.warnings) &&
        solverResult.warnings.some(w => String(w).includes('time budget'));
      if (budgetWarning) {
        UIComponents.showToast(
          'AutoPack reached its time budget; remaining items were staged. The placed layout is fully validated.',
          'warning',
          { title: 'AutoPack' }
        );
      }
      if (stats.unresolvedInstances > 0) {
        UIComponents.showToast(
          `${stats.unresolvedInstances} item(s) were excluded — their case definition is missing`,
          'warning',
          { title: 'AutoPack' }
        );
      }

      try {
        if (diag && typeof diag.autopackEnd === 'function') {
          diag.autopackEnd({
            status: 'ok',
            packed: packedCount,
            unpacked: unpacked.length,
            rejectedPlacements: 0,
            phaseStats: solverResult.phaseStats || null,
            solveStatus: solverResult.solveStatus || null,
            timings: {
              solverMs: Math.round(solverMs),
              animationMs: Math.round(animationMs),
              totalMs: Math.round(nowMs() - runStartedAt),
            },
            animation: { ...animationMetrics },
            warnings: Array.isArray(solverResult.warnings) ? solverResult.warnings : [],
            packedCases: stats && typeof stats.packedCases === 'number' ? stats.packedCases : null,
            volumePercent: stats && typeof stats.volumePercent === 'number' ? stats.volumePercent : null,
          });
        }
      } catch {
        // ignore
      }

      runtimeWindow.setTimeout(() => {
        if (isWorkspaceRunStale()) return;
        capturePackPreview(packId, { source: 'auto' });
      }, 60);

    } catch (err) {
      if (isWorkspaceRunStale()) return;
      console.error('[AutoPack] Error:', err);
      try {
        if (diag && typeof diag.autopackEnd === 'function') {
          diag.autopackEnd({ status: 'error', message: err && err.message ? String(err.message) : String(err) });
        }
      } catch {
        // ignore
      }
      toast('AutoPack failed', 'error', { title: 'AutoPack' });
    } finally {
      isRunning = false;
      if (opToken && OperationLifecycle) OperationLifecycle.finishOperation(opToken);
    }
  }

  function nowMs() {
    const perf = runtimeWindow.performance;
    return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
  }

  function waitForAnimationFrames(count = 1) {
    const raf = runtimeWindow.requestAnimationFrame;
    if (typeof raf !== 'function') {
      return sleep(0);
    }
    return new Promise(resolve => {
      let remaining = Math.max(1, Number(count) || 1);
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) {
          resolve();
          return;
        }
        raf(tick);
      };
      raf(tick);
    });
  }

  function buildStagingMap(packItems, truck) {
    const acceptedAabbs = [];
    const map = new Map();
    packItems.forEach((item) => {
      const pose = buildStagedPose(item);
      const staged = PackLibrary.findSafeStagingPosition({ truck }, pose.dims, acceptedAabbs);
      // Persist the full pose so the staging position (computed from pose.dims) is
      // applied together with the rotation/orientedDims that produced it.
      map.set(item.inst.id, {
        position: staged.position,
        rotation: pose.rotation,
        orientedDims: { length: pose.dims.length, width: pose.dims.width, height: pose.dims.height },
      });
      acceptedAabbs.push(staged.aabb);
    });
    return map;
  }

  async function animatePlacements(
    placements,
    rotations,
    orientedDimsMap,
    caseIdMap,
    shouldAbort = null,
    metrics = null,
    animationOptions = {}
  ) {
    cancelAllTweens();
    const batches = buildPlacementAnimationBatches(
      placements,
      orientedDimsMap,
      caseIdMap,
      ANIMATION_BATCH_SIZE,
      animationOptions
    );

    for (const entries of batches) {
      if (typeof shouldAbort === 'function' && shouldAbort()) return false;
      const batch = entries
        .filter(([id]) => prepareObjectForPlacement(id, rotations, orientedDimsMap));
      if (!batch.length) { continue; }
      if (metrics) {
        metrics.batches += 1;
        metrics.animated += batch.length;
      }
      batch.forEach(([id, pos]) => {
        tweenInstanceToPosition(id, pos, ANIMATION_DURATION_MS, metrics);
      });
      // eslint-disable-next-line no-await-in-loop
      await sleep(ANIMATION_DURATION_MS + ANIMATION_BATCH_GAP_MS);
      batch.forEach(([id, pos]) => {
        snapInstanceToPosition(id, pos);
      });
      if (typeof shouldAbort === 'function' && shouldAbort()) return false;
    }
    return true;
  }

  function prepareObjectForPlacement(id, rotations, orientedDimsMap) {
    const obj = CaseScene.getObject(id);
    if (!obj) { return false; }

    const rot = rotations ? rotations.get(id) : null;
    if (rot) {
      obj.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    }

    if (orientedDimsMap) {
      const od = orientedDimsMap.get(id);
      if (od) {
        obj.userData.halfWorld = {
          x: SceneManager.toWorld(od.length) / 2,
          y: SceneManager.toWorld(od.height) / 2,
          z: SceneManager.toWorld(od.width) / 2,
        };
      }
    }
    return true;
  }

  function snapInstanceToPosition(instanceId, positionInches) {
    const obj = CaseScene.getObject(instanceId);
    if (!obj) { return; }
    const target = SceneManager.vecInchesToWorld(positionInches);
    obj.position.set(target.x, target.y, target.z);
  }

  function tweenInstanceToPosition(instanceId, positionInches, duration, metrics = null) {
    const obj = CaseScene.getObject(instanceId);
    if (!obj) { return; }
    const target = SceneManager.vecInchesToWorld(positionInches);
    let settled = false;
    let fallback = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallback) runtimeWindow.clearTimeout(fallback);
      obj.position.set(target.x, target.y, target.z);
    };
    const Tween = runtimeWindow.TWEEN || null;
    if (!Tween) {
      finish();
      return;
    }
    const fallbackDelay = Math.max(250, (Number(duration) || 0) + TWEEN_FALLBACK_GRACE_MS);
    fallback = runtimeWindow.setTimeout(() => {
      if (metrics) { metrics.fallbackCount += 1; }
      finish();
    }, fallbackDelay);
    try {
      new Tween.Tween(obj.position)
        .to({ x: target.x, y: target.y, z: target.z }, duration)
        .easing(Tween.Easing.Cubic.InOut)
        .onComplete(finish)
        .start();
    } catch (_) {
      finish();
    }
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  return {
    pack,
    bumpWorkspaceGeneration,
    get running() {
      return isRunning;
    },
  };
}
