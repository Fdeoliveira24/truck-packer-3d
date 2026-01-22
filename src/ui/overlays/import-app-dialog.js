/**
 * @file import-app-dialog.js
 * @description UI dialog for importing a full application JSON backup.
 * @module ui/overlays/import-app-dialog
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function createImportAppDialog({
  documentRef = document,
  UIComponents,
  ImportExport,
  StateStore,
  Storage,
  PreferencesManager,
  applyCaseDefaultColor,
} = {}) {
  const doc = documentRef;

  function open() {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const imported = ImportExport.parseAppImportJSON(text);
        const prev = StateStore.get();
        const importedCases = (imported.caseLibrary || []).map(applyCaseDefaultColor);
        const nextState = {
          ...prev,
          caseLibrary: importedCases,
          packLibrary: imported.packLibrary,
          preferences: imported.preferences,
          currentPackId: null,
          currentScreen: 'packs',
          selectedInstanceIds: [],
        };
        StateStore.replace(nextState, { skipHistory: false });
        Storage.saveNow();
        PreferencesManager.applyTheme(nextState.preferences.theme);
        UIComponents.showToast('Imported app JSON', 'success');
      } catch (err) {
        UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
      }
    });
    input.click();
  }

  function init() {
    // No-op.
  }

  return { init, open };
}
