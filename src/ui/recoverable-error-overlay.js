/**
 * @file recoverable-error-overlay.js
 * @description Recoverable (non-fatal) error overlay decision: route-not-found and missing-pack sync.
 * @module ui/recoverable-error-overlay
 * @created 07/23/2026
 * @author Truck Packer 3D Team
 */

// Recoverable-error decision logic (extracted from src/app.js; behavior preserved).
// Side-effect-free factory. `routeNotFoundActive` remains owned by src/app.js
// (it is mutated from router callbacks there); it is read here at call time
// through the injected getRouteNotFound accessor.

export function createRecoverableErrorOverlay({
  StateStore,
  PackLibrary,
  ErrorOverlay,
  BootState,
  getRouteNotFound,
}) {
  const RecoverableErrorOverlay = (() => {
    function hasMissingEditorPack() {
      if (StateStore.get('currentScreen') !== 'editor') return false;
      const packId = StateStore.get('currentPackId');
      if (!packId) return false;
      return !PackLibrary.getById(packId);
    }

    function syncRecoverableErrorOverlay() {
      if (BootState.fatalOverlayShown || BootState.maintenanceMode) return;
      if (getRouteNotFound()) {
        ErrorOverlay.showNotFound({ kind: 'route' });
        return;
      }
      if (hasMissingEditorPack()) {
        ErrorOverlay.showNotFound({ kind: 'pack' });
        return;
      }
      ErrorOverlay.hide();
    }

    return { syncRecoverableErrorOverlay };
  })();

  return RecoverableErrorOverlay;
}
