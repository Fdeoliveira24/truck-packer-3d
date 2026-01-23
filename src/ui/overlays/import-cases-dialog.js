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
      resultsEl.style.display = 'block';
      resultsEl.innerHTML = '';

      const summary = doc.createElement('div');
      summary.className = 'card';
      summary.innerHTML = `
                <div style="font-weight:var(--font-semibold);margin-bottom:6px">Import Preview</div>
                <div class="muted" style="font-size:var(--text-sm)">File: ${Utils.escapeHtml(file.name)}</div>
                <div style="height:8px"></div>
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                  <div class="badge" style="border-color:rgba(16,185,129,.25);background:rgba(16,185,129,.12);color:var(--text-primary)">✓ Valid: ${parsed.valid.length}</div>
                  <div class="badge" style="border-color:rgba(245,158,11,.25);background:rgba(245,158,11,.12);color:var(--text-primary)">↷ Duplicates skipped: ${parsed.duplicates.length}</div>
                  <div class="badge" style="border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.12);color:var(--text-primary)">⚠ Invalid: ${parsed.errors.length}</div>
                </div>
              `;

      const actionsRow = doc.createElement('div');
      actionsRow.className = 'row';
      actionsRow.style.justifyContent = 'flex-end';
      actionsRow.style.marginTop = '12px';
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
        err.innerHTML = '<div style="font-weight:var(--font-semibold);margin-bottom:6px">Errors</div>';
        const ul = doc.createElement('ul');
        ul.style.margin = '8px 0 0 16px';
        ul.style.color = 'var(--text-secondary)';
        ul.style.fontSize = 'var(--text-sm)';
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
	              <div class="muted" style="font-size:var(--text-sm)">Supported: .csv, .xlsx</div>
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
      'Required: <b>name</b>, <b>length</b>, <b>width</b>, <b>height</b><br>Optional: manufacturer, category, weight, canFlip, notes';

    const results = doc.createElement('div');
    results.style.display = 'none';

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
