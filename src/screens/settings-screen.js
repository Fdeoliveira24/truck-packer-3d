/**
 * @file settings-screen.js
 * @description Screen factory responsible for rendering and binding UI for a specific screen.
 * @module screens/settings-screen
 * @created 07/23/2026
 * @updated 07/23/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Settings screen (extracted from src/app.js; behavior preserved)

export function createSettingsScreen({
  Utils,
  UIComponents,
  PreferencesManager,
  Storage,
}) {
  const SettingsUI = (() => {
    const elLength = /** @type {HTMLSelectElement} */ (document.getElementById('pref-length'));
    const elWeight = /** @type {HTMLSelectElement} */ (document.getElementById('pref-weight'));
    const elTheme = /** @type {HTMLSelectElement} */ (document.getElementById('pref-theme'));
    const elLabel = /** @type {HTMLInputElement} */ (document.getElementById('pref-label-size'));
    const elHidden = /** @type {HTMLInputElement} */ (document.getElementById('pref-hidden-opacity'));
    const elHiddenValue = /** @type {HTMLElement} */ (document.getElementById('pref-hidden-opacity-value'));
    const elSnap = /** @type {HTMLSelectElement} */ (document.getElementById('pref-snapping-enabled'));
    const elGrid = /** @type {HTMLInputElement} */ (document.getElementById('pref-grid-size'));
    const elShot = /** @type {HTMLSelectElement} */ (document.getElementById('pref-shot-res'));
    const elPdfStats = /** @type {HTMLSelectElement} */ (document.getElementById('pref-pdf-stats'));
    const btnSave = /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-prefs'));
    const btnReset = /** @type {HTMLButtonElement} */ (document.getElementById('btn-reset-demo'));

    function initSettingsUI() {
      btnSave.addEventListener('click', () => save());
      elHidden.addEventListener('input', syncHiddenOpacityValue);
      btnReset.addEventListener('click', async () => {
        const ok = await UIComponents.confirm({
          title: 'Reset demo data?',
          message: 'This replaces your local data with the demo set.',
          danger: true,
          okLabel: 'Reset',
        });
        if (!ok) return;
        Storage.clearAll();
        window.location.reload();
      });
    }

    function syncHiddenOpacityValue() {
      if (!elHiddenValue) return;
      elHiddenValue.textContent = Number(elHidden.value).toFixed(2);
    }

    function loadForm() {
      const p = PreferencesManager.get();
      elLength.value = p.units.length;
      elWeight.value = p.units.weight;
      elTheme.value = p.theme;
      elLabel.value = String(p.labelFontSize);
      elHidden.value = String(p.hiddenCaseOpacity);
      syncHiddenOpacityValue();
      elSnap.value = String(Boolean(p.snapping.enabled));
      elGrid.value = String(p.snapping.gridSize);
      elShot.value = p.export.screenshotResolution;
      elPdfStats.value = String(Boolean(p.export.pdfIncludeStats));
    }

    function save() {
      const prev = PreferencesManager.get();
      const next = Utils.deepClone(prev);
      next.units.length = elLength.value;
      next.units.weight = elWeight.value;
      next.theme = elTheme.value;
      next.labelFontSize = Utils.clamp(Number(elLabel.value) || 12, 8, 24);
      next.hiddenCaseOpacity = Utils.clamp(Number(elHidden.value) || 0.3, 0, 1);
      next.snapping.enabled = elSnap.value === 'true';
      next.snapping.gridSize = Math.max(0.25, Number(elGrid.value) || 1);
      next.export.screenshotResolution = elShot.value;
      next.export.pdfIncludeStats = elPdfStats.value === 'true';
      PreferencesManager.set(next);
      PreferencesManager.applyTheme(next.theme);
      UIComponents.showToast('Preferences saved', 'success');
    }

    return { init: initSettingsUI, loadForm };
  })();

  return SettingsUI;
}
