/**
 * @file import-cases-dialog.js
 * @description UI dialog for importing cases from CSV/XLSX.
 * @module ui/overlays/import-cases-dialog
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function createImportCasesDialog({
  documentRef = document,
  UIComponents,
  ImportExport,
  StateStore,
  Utils,
} = {}) {
  const doc = documentRef;

  async function handleFile(file, resultsEl, modal) {
    try {
      const parsed = await ImportExport.parseAndValidateSpreadsheet(file);
      resultsEl.classList.add('is-visible');
      resultsEl.innerHTML = '';

      const summary = doc.createElement('div');
      summary.className = 'card';
      summary.innerHTML = `
                <div class="tp3d-import-summary-title">Import Preview</div>
                <div class="muted tp3d-import-summary-meta">File: ${Utils.escapeHtml(file.name)}</div>
                <div class="tp3d-import-summary-spacer"></div>
                <div class="tp3d-import-badges">
                  <div class="badge tp3d-import-badge-success">✓ Valid: ${parsed.valid.length}</div>
                  <div class="badge tp3d-import-badge-warn">↷ Duplicates skipped: ${parsed.duplicates.length}</div>
                  <div class="badge tp3d-import-badge-error">⚠ Invalid: ${parsed.errors.length}</div>
                </div>
              `;

      const actionsRow = doc.createElement('div');
      actionsRow.className = 'row tp3d-import-actions';
      const btn = doc.createElement('button');
      btn.className = 'btn btn-primary';
      btn.type = 'button';
      btn.textContent = 'Import valid rows';
      btn.disabled = parsed.valid.length === 0;
      btn.addEventListener('click', () => {
        const result = ImportExport.importCaseRows(parsed.valid);
        StateStore.set({ caseLibrary: result.nextCaseLibrary });
        UIComponents.showToast(`Imported ${result.added} case(s)`, result.added ? 'success' : 'warning');
        modal.close();
      });
      actionsRow.appendChild(btn);
      summary.appendChild(actionsRow);

      resultsEl.appendChild(summary);

      if (parsed.errors.length) {
        const err = doc.createElement('div');
        err.className = 'card';
        err.innerHTML = '<div class="tp3d-import-summary-title">Errors</div>';
        const ul = doc.createElement('ul');
        ul.className = 'tp3d-import-errors-list';
        parsed.errors.slice(0, 12).forEach(e => {
          const li = doc.createElement('li');
          li.textContent = e;
          ul.appendChild(li);
        });
        if (parsed.errors.length > 12) {
          const li = doc.createElement('li');
          li.textContent = `...and ${parsed.errors.length - 12} more`;
          ul.appendChild(li);
        }
        err.appendChild(ul);
        resultsEl.appendChild(err);
      }
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
                <div class="tp3d-import-drop-icon"><i class="fa-solid fa-file-import"></i></div>
                <div class="tp3d-import-drop-title">Drag & Drop File Here</div>
                <div class="muted tp3d-import-drop-sub">Supported: .csv, .xlsx</div>
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
      'Required: Name + length + width + height<br>Optional: Manufacturer, category, weight, flip, notes';

    const results = doc.createElement('div');
    results.classList.add('tp3d-import-results');

    content.appendChild(drop);
    content.appendChild(hint);
    content.appendChild(results);

    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

    const modal = UIComponents.showModal({
      title: 'Import Cases',
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
