import { buildLegacyAutoPackItems, solveLegacyAutoPack } from './autopack-legacy-solver.js';

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

      // For frontBonus, keep the legacy solver's current front-to-rear behavior.
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

      const legacyResult = await solveLegacyAutoPack({
        packId,
        mode,
        truck: { length: truckL, width: truckW, height: truckH },
        zones,
        packItems,
        loadFrontFirst,
        xStep,
        zStep,
        geometry: {
          isAabbContainedInAnyZone: TrailerGeometry.isAabbContainedInAnyZone,
        },
        diag,
        sleep,
        shouldAbort: isWorkspaceRunStale,
      });
      if (!legacyResult || legacyResult.aborted || isWorkspaceRunStale()) return;

      const {
        placements,
        rotations,
        orientedDimsMap,
        unpacked,
        packed,
        finalValidation,
      } = legacyResult;

      cancelAllTweens();
      const animationCompleted = await animatePlacements(
        placements,
        rotations,
        orientedDimsMap,
        isWorkspaceRunStale
      );
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
        };
        if (od) { next.orientedDims = od; }
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
            packed: packed.length,
            unpacked: unpacked.length,
            rejectedPlacements: finalValidation.rejected,
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

  function getStagingDims(item) {
    const od = item && item.inst && item.inst.orientedDims;
    if (od && Number(od.length) > 0 && Number(od.width) > 0 && Number(od.height) > 0) {
      return { length: Number(od.length), width: Number(od.width), height: Number(od.height) };
    }
    const ori = item && Array.isArray(item.orientations) ? item.orientations[0] : null;
    if (ori && Number(ori.l) > 0 && Number(ori.w) > 0 && Number(ori.h) > 0) {
      return { length: Number(ori.l), width: Number(ori.w), height: Number(ori.h) };
    }
    return (item && item.caseData && item.caseData.dimensions) || { length: 24, width: 24, height: 24 };
  }

  function buildStagingMap(packItems, truck) {
    const gap = 8;
    const truckW = truck.width || 102;
    const truckL = truck.length || 636;
    const stageZStart = (truckW / 2) + Math.max(36, truckW * 0.35);
    const map = new Map();
    let curX = 0;
    let curZ = stageZStart;
    let rowMaxWidth = 0;
    packItems.forEach((item) => {
      const dims = getStagingDims(item);
      if (curX + dims.length > truckL && curX > 0) {
        curZ += rowMaxWidth + gap;
        curX = 0;
        rowMaxWidth = 0;
      }
      const y = Math.max(1, dims.height / 2);
      map.set(item.inst.id, { x: curX + dims.length / 2, y, z: curZ + dims.width / 2 });
      curX += dims.length + gap;
      rowMaxWidth = Math.max(rowMaxWidth, dims.width);
    });
    return map;
  }

  async function animatePlacements(placements, rotations, orientedDimsMap, shouldAbort = null) {
    cancelAllTweens();
    for (const [id, pos] of placements.entries()) {
      if (typeof shouldAbort === 'function' && shouldAbort()) return false;
      const obj = CaseScene.getObject(id);
      if (!obj) { continue; }

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

      // eslint-disable-next-line no-await-in-loop
      await tweenInstanceToPosition(id, pos, 200);
      if (typeof shouldAbort === 'function' && shouldAbort()) return false;
      // eslint-disable-next-line no-await-in-loop
      await sleep(25);
      if (typeof shouldAbort === 'function' && shouldAbort()) return false;
    }
    return true;
  }

  function tweenInstanceToPosition(instanceId, positionInches, duration) {
    const obj = CaseScene.getObject(instanceId);
    if (!obj) { return Promise.resolve(); }
    const target = SceneManager.vecInchesToWorld(positionInches);
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        obj.position.set(target.x, target.y, target.z);
        resolve();
      };
      const Tween = runtimeWindow.TWEEN || null;
      if (!Tween) {
        finish();
        return;
      }
      const fallbackDelay = Math.max(50, (Number(duration) || 0) + 150);
      const fallback = runtimeWindow.setTimeout(finish, fallbackDelay);
      try {
        new Tween.Tween(obj.position)
          .to({ x: target.x, y: target.y, z: target.z }, duration)
          .easing(Tween.Easing.Cubic.InOut)
          .onComplete(() => {
            runtimeWindow.clearTimeout(fallback);
            finish();
          })
          .start();
      } catch (_) {
        runtimeWindow.clearTimeout(fallback);
        finish();
      }
    });
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
