/**
 * @file import-pack-dialog.js
 * @description UI dialog for importing a single pack from JSON.
 * @module ui/overlays/import-pack-dialog
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function createImportPackDialog({
  documentRef = document,
  UIComponents,
  ImportExport,
  PackLibrary,
} = {}) {
  const doc = documentRef;

  function open() {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = ImportExport.parsePackImportJSON(text);
        PackLibrary.importPackPayload(payload);
        UIComponents.showToast('Pack imported', 'success');
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
