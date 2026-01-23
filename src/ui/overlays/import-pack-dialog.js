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
    resultsEl.style.display = 'block';
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
        <div style="font-weight:var(--font-semibold);margin-bottom:6px">Import Result</div>
        <div class="muted" style="font-size:var(--text-sm)">File: ${Utils && Utils.escapeHtml ? Utils.escapeHtml(file.name) : file.name}</div>
        <div style="height:8px"></div>
        <div class="badge" style="border-color:rgba(16,185,129,.25);background:rgba(16,185,129,.12);color:var(--text-primary)">Imported: 1 pack(s)</div>
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
    content.style.display = 'grid';
    content.style.gap = '14px';

    const drop = doc.createElement('div');
    drop.className = 'card';
    drop.style.borderStyle = 'dashed';
    drop.style.background = 'var(--bg-elevated)';
    drop.style.textAlign = 'center';
    drop.style.padding = '22px';
    drop.innerHTML = `
      <div style="font-size:28px;margin-bottom:6px"><i class="fa-solid fa-star"></i></div>
      <div style="font-weight:var(--font-semibold);margin-bottom:6px">Drag & Drop File Here</div>
      <div class="muted" style="font-size:var(--text-sm)">Supported: .json</div>
      <div style="height:12px"></div>
    `;
    const browseBtn = doc.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.type = 'button';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse files';
    drop.appendChild(browseBtn);

    const hint = doc.createElement('div');
    hint.className = 'muted';
    hint.style.fontSize = 'var(--text-sm)';
    hint.innerHTML =
      'Required: <b>pack</b> object with <b>title</b>, <b>truck</b> { length, width, height, shapeMode }, <b>cases</b> (array)<br>Optional: client, projectName, drawnBy, notes, groups, stats, createdAt, lastEdited, thumbnail fields';

    const results = doc.createElement('div');
    results.style.display = 'none';

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
      drop.style.borderColor = 'rgba(255, 159, 28, 0.6)';
    });
    drop.addEventListener('dragleave', () => {
      drop.style.borderColor = 'var(--border-subtle)';
    });
    drop.addEventListener('drop', ev => {
      ev.preventDefault();
      drop.style.borderColor = 'var(--border-subtle)';
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
