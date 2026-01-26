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

    // Detect "App JSON" early to provide a clear hint.
    try {
      const parsed = Utils && Utils.safeJsonParse ? Utils.safeJsonParse(text, null) : JSON.parse(text);
      if (
        parsed &&
        typeof parsed === 'object' &&
        (Array.isArray(parsed.packLibrary) || Array.isArray(parsed.caseLibrary) || parsed.preferences)
      ) {
        UIComponents.showToast('This looks like App JSON. Use Import App JSON instead.', 'warning');
        return;
      }
    } catch {
      // Continue to standard parsePackImportJSON error reporting below.
    }

    try {
      const payload = ImportExport.parsePackImportJSON(text);
      PackLibrary.importPackPayload(payload);

      const summary = doc.createElement('div');
      summary.className = 'card';
      summary.innerHTML = `
        <div class="tp3d-import-summary-title">Import Result</div>
        <div class="muted tp3d-import-summary-meta">File: ${Utils && Utils.escapeHtml ? Utils.escapeHtml(file.name) : file.name}</div>
        <div class="tp3d-import-summary-spacer"></div>
        <div class="badge tp3d-import-badge-success">Imported: 1 pack(s)</div>
      `;
      resultsEl.appendChild(summary);

      UIComponents.showToast('Imported 1 pack(s)', 'success');
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
      <div class="tp3d-import-drop-icon"><i class="fa-solid fa-star"></i></div>
      <div class="tp3d-import-drop-title">Drag & Drop File Here</div>
      <div class="muted tp3d-import-drop-sub">Supported: .json</div>
      <div class="tp3d-import-drop-spacer"></div>
    `;
    const browseBtn = doc.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.type = 'button';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse files';
    drop.appendChild(browseBtn);

    const hint = doc.createElement('div');
    hint.className = 'muted';
    hint.classList.add('tp3d-import-hint');
    hint.innerHTML =
      'Required: <b>pack</b> object with <b>title</b>, <b>truck</b> { length, width, height, shapeMode }, <b>cases</b> (array)<br>Optional: client, projectName, drawnBy, notes, groups, stats, createdAt, lastEdited, thumbnail fields';

    const results = doc.createElement('div');
    results.classList.add('tp3d-import-results');

    content.appendChild(drop);
    content.appendChild(hint);
    content.appendChild(results);

    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    const modal = UIComponents.showModal({
      title: 'Import Packs',
      content,
      actions: [{ label: 'Close', variant: 'primary' }],
    });

    browseBtn.addEventListener('click', () => fileInput.click());

    drop.addEventListener('dragover', ev => {
      ev.preventDefault();
      drop.classList.add('is-dragover');
    });
    drop.addEventListener('dragleave', () => {
      drop.classList.remove('is-dragover');
    });
    drop.addEventListener('drop', ev => {
      ev.preventDefault();
      drop.classList.remove('is-dragover');
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) handleFile(file, results, modal);
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) handleFile(file, results, modal);
    });
  }

  function init() {
    // No-op.
  }

  return { init, open };
}
