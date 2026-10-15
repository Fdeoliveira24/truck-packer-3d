/** Shared, atomic confirmation for truck-layout changes. */
import * as StateStore from '../core/state-store.js';
import { captureScopeContext, isScopeContextCurrent } from '../core/storage.js';

function normalizedTruckGeometry(truck = {}) {
  const mode = truck.shapeMode === 'wheelWells' || truck.shapeMode === 'frontBonus'
    ? truck.shapeMode
    : 'rect';
  const cfg = truck.shapeConfig && typeof truck.shapeConfig === 'object' && !Array.isArray(truck.shapeConfig)
    ? truck.shapeConfig
    : {};
  const shapeConfig = mode === 'wheelWells'
    ? {
        wellHeight: Number(cfg.wellHeight ?? Number(truck.height) * 0.35),
        wellWidth: Number(cfg.wellWidth ?? Number(truck.width) * 0.15),
        wellLength: Number(cfg.wellLength ?? Number(truck.length) * 0.35),
        wellOffsetFromRear: Number(cfg.wellOffsetFromRear ?? Number(truck.length) * 0.25),
      }
    : mode === 'frontBonus'
      ? {
          bonusLength: Number(cfg.bonusLength) || 0,
          bonusHeight: Number(cfg.bonusHeight ?? Number(truck.height) * 0.45),
          bonusWidth: Number(truck.width) || 0,
        }
      : {};
  return {
    length: Number(truck.length) || 0,
    width: Number(truck.width) || 0,
    height: Number(truck.height) || 0,
    shapeMode: mode,
    shapeConfig,
  };
}

export function truckGeometryEqual(a, b) {
  return JSON.stringify(normalizedTruckGeometry(a)) === JSON.stringify(normalizedTruckGeometry(b));
}

export function createTruckChangeController({
  PackLibrary,
  CaseLibrary,
  UIComponents,
  documentRef = document,
}) {
  let active = null;

  function reportFailure(error) {
    UIComponents.showToast(error?.message || 'Truck change could not be saved. No changes were applied.',
      'error', { title: 'Truck change' });
  }

  function validateTruck(truck) {
    const { length, width, height } = truck;
    if (![length, width, height].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0) ||
        ![undefined, 'rect', 'wheelWells', 'frontBonus'].includes(truck.shapeMode)) {
      throw new Error('Enter valid truck dimensions. No changes were applied.');
    }
    const cfg = truck.shapeConfig || {};
    const limits = truck.shapeMode === 'wheelWells'
      ? { wellHeight: height, wellWidth: width / 2, wellLength: length, wellOffsetFromRear: length }
      : truck.shapeMode === 'frontBonus' ? { bonusLength: length, bonusHeight: height } : {};
    if (Object.entries(limits).some(([key, max]) => cfg[key] !== undefined &&
        (typeof cfg[key] !== 'number' || !Number.isFinite(cfg[key]) || cfg[key] < 0 || cfg[key] > max))) {
      throw new Error('Enter valid truck layout dimensions. No changes were applied.');
    }
  }

  function apply(ctx) {
    if (active !== ctx || ctx.committed || ctx.inFlight) return false;
    ctx.inFlight = true;
    try {
      if (!isScopeContextCurrent(ctx.scope)) throw new Error('Workspace changed. No truck changes were saved.');
      validateTruck(ctx.nextTruck);
      // Results can show a different layout. Only the durable Pack owns cargo.
      const pack = PackLibrary.getById(ctx.pack.id);
      if (!pack || !Array.isArray(pack.cases)) throw new Error('Load Plan is unavailable. No changes were applied.');
      const ids = pack.cases.map(inst => inst?.id);
      if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
        throw new Error('Case instance IDs need review. No changes were applied.');
      }
      const staged = PackLibrary.stagePlacementIds(pack, ids, ctx.nextTruck, CaseLibrary.getCases(), {
        grouped: true, preserveRotation: true,
      });
      if (staged.failedIds.length || staged.stagedIds.length !== ids.length ||
          staged.pack.cases.length !== ids.length) {
        throw new Error('Could not safely stage every Case. Check missing Case definitions or invalid geometry. No changes were applied.');
      }
      const results = StateStore.get('autoPackResults');
      const selection = StateStore.get('selectedInstanceIds');
      const clearResults = results?.packId === pack.id;
      const clearSelection = StateStore.get('currentPackId') === pack.id;
      const transient = {};
      if (clearResults) transient.autoPackResults = null;
      if (clearSelection) transient.selectedInstanceIds = [];
      StateStore.set(transient, { skipHistory: true, skipNotify: true });
      let committed;
      try {
        committed = ctx.commit
          ? ctx.commit(staged.pack)
          : PackLibrary.update(pack.id, { truck: ctx.nextTruck, cases: staged.pack.cases });
        if (!committed) throw new Error('Truck change could not be saved. No changes were applied.');
      } finally {
        if (!committed) {
          if (clearResults) transient.autoPackResults = results;
          if (clearSelection) transient.selectedInstanceIds = selection;
          StateStore.set(transient, { skipHistory: true, skipNotify: true });
        }
      }
      ctx.committed = true;
      ctx.onCommitted?.(committed);
      UIComponents.showToast(ctx.successMessage || 'Truck updated. All Cases are in staging.', 'success', { title: 'Truck' });
      return true;
    } catch (error) {
      reportFailure(error);
      return false;
    } finally {
      ctx.inFlight = false;
    }
  }

  function request(options = {}) {
    const pack = options.pack;
    const nextTruck = options.nextTruck;
    if (!pack || !nextTruck) return { status: 'invalid-request' };
    if (active) {
      UIComponents.showToast('Finish the current truck change first.', 'warning', { title: 'Truck change' });
      return { status: 'busy' };
    }
    try {
      validateTruck(nextTruck);
      if (truckGeometryEqual(pack.truck, nextTruck)) {
        if (!options.commitWhenUnchanged || !options.commit) return { status: 'unchanged' };
        const committed = options.commit({ ...pack, truck: nextTruck });
        if (!committed) throw new Error('Load plan update could not be saved.');
        options.onCommitted?.(committed);
        if (options.successMessage) UIComponents.showToast(options.successMessage, 'success', { title: 'Truck' });
        return { status: 'committed' };
      }
      const ctx = { ...options, scope: captureScopeContext(), committed: false, inFlight: false };
      const content = documentRef.createElement('p');
      content.textContent = 'Changing the truck layout will place all Cases in staging. You can arrange them again manually or use AutoPack.';
      active = ctx;
      const modal = UIComponents.showModal({
        title: 'Change truck layout?',
        content,
        actions: [
          { label: 'Cancel' },
          { label: 'Apply Changes', variant: 'primary', onClick: () => apply(ctx) },
        ],
        onClose: () => {
          if (active === ctx) active = null;
          if (!ctx.committed) ctx.restoreControls?.();
        },
      });
      modal.modal?.classList?.add('tp3d-truck-change-modal');
      return { status: 'preview' };
    } catch (error) {
      active = null;
      reportFailure(error);
      return { status: 'failed' };
    }
  }

  return { request, isActive: () => Boolean(active), truckGeometryEqual };
}
