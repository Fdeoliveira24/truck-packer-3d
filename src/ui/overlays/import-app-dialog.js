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

import { openImportDialogWithFilePicker } from '../helpers/import-dialog-utils.js';

/**
 * @param {{
 *  documentRef?: Document,
 *  UIComponents?: any,
 *  ImportExport?: any,
 *  StateStore?: any,
 *  Storage?: any,
 *  PreferencesManager?: any,
 *  applyCaseDefaultColor?: Function,
 *  Utils?: any
 * }} [opts]
 */
export function createImportAppDialog({
  documentRef = document,
  UIComponents,
  ImportExport,
  StateStore,
  Storage,
  PreferencesManager,
  applyCaseDefaultColor,
  Utils,
} = {}) {
  const doc = documentRef;

  async function handleFile(file, resultsEl, modal) {
    resultsEl.classList.add('is-visible');
    resultsEl.innerHTML = '';

    if (!file) {
      UIComponents.showToast('No file selected', 'warning');
      return;
    }

    const name = String(file.name || '');
    const lower = name.toLowerCase();
    const isJson = lower.endsWith('.json') || String(file.type || '').includes('json');
    if (!isJson) {
      UIComponents.showToast('Invalid file type. Supported: .json', 'warning');
      return;
    }

    let text = '';
    try {
      text = await file.text();
    } catch (err) {
      UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
      return;
    }

    let imported = null;
    try {
      imported = ImportExport.parseAppImportJSON(text);
    } catch (err) {
      UIComponents.showToast('Invalid App JSON: ' + (err && err.message), 'error');
      UIComponents.showToast('If you are importing only packs, use Import Pack.', 'info');
      return;
    }

    if (
      !imported ||
      !Array.isArray(imported.packLibrary) ||
      !Array.isArray(imported.caseLibrary) ||
      !imported.preferences
    ) {
      UIComponents.showToast('Invalid App JSON: missing required keys', 'error');
      return;
    }

    const ok = await UIComponents.confirm({
      title: 'Import App JSON?',
      message: 'This will replace your current data with the imported backup. This cannot be undone.',
      danger: true,
      okLabel: 'Replace & Import',
    });
    if (!ok) return;

    try {
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
      if (PreferencesManager && typeof PreferencesManager.applyTheme === 'function') {
        PreferencesManager.applyTheme(nextState.preferences.theme);
      }

      const summary = doc.createElement('div');
      summary.className = 'card';
      summary.innerHTML = `
        <div class="tp3d-import-summary-title">Import Result</div>
        <div class="muted tp3d-import-summary-meta">File: ${
          Utils && Utils.escapeHtml ? Utils.escapeHtml(file.name) : file.name
        }</div>
        <div class="tp3d-import-summary-spacer"></div>
        <div class="tp3d-import-badges">
          <div class="badge tp3d-import-badge-success">Packs: ${(imported.packLibrary || []).length}</div>
          <div class="badge tp3d-import-badge-info">Cases: ${(imported.caseLibrary || []).length}</div>
        </div>
      `;
      resultsEl.appendChild(summary);

      UIComponents.showToast('App data imported', 'success');
      modal.close();
    } catch (err) {
      UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
    }
  }

  function open() {
    const content = doc.createElement('div');
    content.classList.add('tp3d-import-content');

    const drop = doc.createElement('div');
    drop.className = 'card';
    drop.classList.add('tp3d-import-drop');
    drop.innerHTML = `
      <div class="tp3d-import-drop-title">Drag & Drop Backup File Here</div>
      <div class="muted tp3d-import-drop-sub">Supported: .json</div>
      <div class="tp3d-import-drop-spacer"></div>
    `;
    const browseBtn = doc.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.type = 'button';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse Backup files';
    drop.appendChild(browseBtn);

    const hint = doc.createElement('div');
    hint.className = 'muted';
    hint.classList.add('tp3d-import-hint');
    hint.innerHTML = `
      <div class="tp3d-import-warning">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div>
          <span class="tp3d-import-warning-label">Warning:</span>
          <span class="tp3d-import-warning-text"> This will replace your current data.</span>
        </div>
      </div>
    `;

    const results = doc.createElement('div');
    results.classList.add('tp3d-import-results');

    content.appendChild(drop);
    content.appendChild(hint);
    content.appendChild(results);

    openImportDialogWithFilePicker({
      documentRef: doc,
      UIComponents,
      title: 'Import App JSON',
      content,
      accept: '.json,application/json',
      drop,
      browseBtn,
      onFile: (file, modal) => {
        handleFile(file, results, modal);
      },
    });
  }

  function init() {
    // No-op.
  }

  return { init, open };
}
