import { buildLegacyAutoPackItems } from './autopack-legacy-solver.js';
import { solveAutoPack } from './autopack-solver.js';

export function createAutoPackEngine({
  CaseLibrary,
  CaseScene,
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
  const ANIMATION_BATCH_SIZE = 24;
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
    for (const [id, pos] of stagingMap.entries()) {
      const obj = CaseScene.getObject(id);
      if (!obj) { continue; }
      const t = SceneManager.vecInchesToWorld(pos);
      obj.position.set(t.x, t.y, t.z);
    }
  }

  async function pack() {
    if (isRunning) { return; }
    const runWorkspaceGeneration = workspaceGeneration;
    const isWorkspaceRunStale = () => runWorkspaceGeneration !== workspaceGeneration;

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
    cancelAllTweens();
    const runStartedAt = nowMs();
    let solverMs = 0;
    let animationMs = 0;
    const animationMetrics = { animated: 0, batches: 0, fallbackCount: 0 };

    const diag =
      (typeof runtimeWindow !== 'undefined' &&
        runtimeWindow.__TP3D_DIAG__ &&
        typeof runtimeWindow.__TP3D_DIAG__.isActive === 'function' &&
        runtimeWindow.__TP3D_DIAG__.isActive())
        ? runtimeWindow.__TP3D_DIAG__
        : null;

    try {
      toast('AutoPack starting...', 'info', { title: 'AutoPack', duration: 1800 });

      const truck = packData.truck;
      const mode = (truck && truck.shapeMode) ? truck.shapeMode : 'rect';
      const truckL = truck.length || 636;
      const truckW = truck.width || 102;
      const truckH = truck.height || 98;
      const zones = TrailerGeometry.getTrailerUsableZones(truck);

      // For frontBonus, keep the current front-to-rear behavior.
      // For everything else, pack rear-to-front (low X first).
      const loadFrontFirst = mode === 'frontBonus';
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

      const stagingMap = buildStagingMap(packItems, truck);
      stageInstant(stagingMap);
      // Let the staged layout paint before the synchronous solver starts. This
      // prevents large packs from looking frozen at their old positions.
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
      const solverResult = solveAutoPack({
        truck: { length: truckL, width: truckW, height: truckH },
        zones,
        loadFrontFirst,
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
      solverMs = nowMs() - solverStartedAt;
      if (!solverResult || isWorkspaceRunStale()) return;

      const placements = solverResult.placements;
      const rotations = solverResult.rotations;
      const orientedDimsMap = solverResult.orientedDims;
      const unpacked = solverResult.unpacked || [];
      const packedCount = placements instanceof Map ? placements.size : 0;

      cancelAllTweens();
      const animationStartedAt = nowMs();
      const animationCompleted = await animatePlacements(
        placements,
        rotations,
        orientedDimsMap,
        isWorkspaceRunStale,
        animationMetrics
      );
      animationMs = nowMs() - animationStartedAt;
      if (!animationCompleted || isWorkspaceRunStale()) return;

      const nextCases = (packData.cases || []).map(inst => {
        if (inst.hidden) { return inst; }
        const pos = placements.get(inst.id) || stagingMap.get(inst.id);
        if (!pos) { return inst; }
        const currentRotation =
          inst.transform && inst.transform.rotation
            ? inst.transform.rotation
            : { x: 0, y: 0, z: 0 };
        const rot = rotations.get(inst.id) || currentRotation;
        const od = orientedDimsMap.get(inst.id) || null;
        const next = {
          ...inst,
          transform: {
            ...inst.transform,
            position: pos,
            rotation: rot,
          },
          hidden: false,
          placement: placements.has(inst.id) ? 'packed' : 'staged',
        };
        if (od) {
          next.orientedDims = od;
        } else {
          // Staged/unpacked items have no fresh solver orientedDims. Explicitly
          // remove the stale value spread from ...inst so applyTransform resets
          // halfWorld to base case dimensions instead of a previous run's dims.
          delete next.orientedDims;
        }
        return next;
      });
      PackLibrary.update(packId, { cases: nextCases });

      const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
      const totalPackable = (packData.cases || []).filter(i => !i.hidden).length;
      UIComponents.showToast(
        `Packed ${stats.packedCases} of ${totalPackable} (${stats.volumePercent.toFixed(1)}%)`,
        stats.packedCases === totalPackable ? 'success' : 'warning',
        { title: 'AutoPack' }
      );
      if (unpacked.length) {
        UIComponents.showToast(
          `${unpacked.length} case(s) could not fit`, 'warning', { title: 'AutoPack' }
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

  function getStagingDims(item) {
    // Use freshly computed solver orientation candidates first, then base case dims.
    // Do NOT read stale orientedDims from a previous AutoPack run — that produces
    // wrong staging heights when the item was in a different orientation (RC-4 fix).
    const ori = item && Array.isArray(item.orientations) ? item.orientations[0] : null;
    if (ori && Number(ori.l) > 0 && Number(ori.w) > 0 && Number(ori.h) > 0) {
      return { length: Number(ori.l), width: Number(ori.w), height: Number(ori.h) };
    }
    return (item && item.caseData && item.caseData.dimensions) || { length: 24, width: 24, height: 24 };
  }

  function buildStagingMap(packItems, truck) {
    const acceptedAabbs = [];
    const map = new Map();
    packItems.forEach((item) => {
      const dims = getStagingDims(item);
      const staged = PackLibrary.findSafeStagingPosition({ truck }, dims, acceptedAabbs);
      map.set(item.inst.id, staged.position);
      acceptedAabbs.push(staged.aabb);
    });
    return map;
  }

  async function animatePlacements(placements, rotations, orientedDimsMap, shouldAbort = null, metrics = null) {
    cancelAllTweens();
    const entries = Array.from(placements.entries())
      .sort((a, b) => {
        const aPos = a[1] || {};
        const bPos = b[1] || {};
        return (Number(aPos.y) || 0) - (Number(bPos.y) || 0) ||
          (Number(aPos.x) || 0) - (Number(bPos.x) || 0) ||
          (Number(aPos.z) || 0) - (Number(bPos.z) || 0);
      });

    for (let i = 0; i < entries.length; i += ANIMATION_BATCH_SIZE) {
      if (typeof shouldAbort === 'function' && shouldAbort()) return false;
      const batch = entries.slice(i, i + ANIMATION_BATCH_SIZE)
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
