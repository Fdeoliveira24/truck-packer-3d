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

import { openImportDialogWithFilePicker } from '../helpers/import-dialog-utils.js';
import * as Defaults from '../../core/defaults.js';

/**
 * @param {{
 *  documentRef?: Document,
 *  UIComponents?: any,
 *  ImportExport?: any,
 *  PackLibrary?: any,
 *  CaseLibrary?: any,
 *  Utils?: any
 * }} [opts]
 */
export function createImportPackDialog({
  documentRef = document,
  UIComponents,
  ImportExport,
  PackLibrary,
  CaseLibrary,
  Utils,
} = {}) {
  const doc = documentRef;

  function fmtNum(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  function categoryInfo(catName) {
    const cats = (Defaults && Defaults.categories) ? Defaults.categories : [];
    const key = String(catName || 'default');
    const entry = cats.find(c => c.key === key) || cats.find(c => c.key === 'default');
    return {
      label: (entry && entry.name) || (key.charAt(0).toUpperCase() + key.slice(1)),
      color: (entry && entry.color) || '#9ca3af',
    };
  }

  function isValidTruckDim(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  }

  // Inspects a parsed pack payload and resolves bundled-case data so the
  // preview can show real names/dimensions instead of raw caseIds, and so
  // truck-dimension and missing-case problems surface before import runs.
  function analyzePackPayload(payload) {
    const pack = (payload && payload.pack) || {};
    const bundled = Array.isArray(payload && payload.bundledCases) ? payload.bundledCases : [];
    const bundledById = new Map(bundled.filter(c => c && c.id).map(c => [c.id, c]));

    const truck = (pack && typeof pack.truck === 'object' && pack.truck) || {};
    const truckDims = {
      length: Number(truck.length),
      width: Number(truck.width),
      height: Number(truck.height),
    };
    const truckValid =
      isValidTruckDim(truckDims.length) &&
      isValidTruckDim(truckDims.width) &&
      isValidTruckDim(truckDims.height);

    const instances = Array.isArray(pack.cases) ? pack.cases : [];
    let missingCount = 0;
    const cases = instances.map(inst => {
      const caseId = inst && inst.caseId;
      const caseDef =
        (caseId && bundledById.get(caseId)) ||
        (caseId && CaseLibrary && CaseLibrary.getById ? CaseLibrary.getById(caseId) : null) ||
        null;
      if (!caseDef) missingCount++;
      return { caseId, caseDef };
    });

    return {
      title: pack.title || 'Untitled Pack',
      truck: truckDims,
      truckValid,
      cases,
      missingCount,
      caseCount: instances.length,
    };
  }

  function buildWarningRow(labelText, bodyText) {
    const warn = doc.createElement('div');
    warn.className = 'tp3d-import-warning';
    const icon = doc.createElement('i');
    icon.className = 'fa-solid fa-triangle-exclamation';
    const textWrap = doc.createElement('div');
    const label = doc.createElement('span');
    label.className = 'tp3d-import-warning-label';
    label.textContent = labelText;
    const body = doc.createElement('span');
    body.className = 'tp3d-import-warning-text';
    body.textContent = ' ' + bodyText;
    textWrap.appendChild(label);
    textWrap.appendChild(body);
    warn.appendChild(icon);
    warn.appendChild(textWrap);
    return warn;
  }

  function buildCaseRow(entry) {
    const row = doc.createElement('div');
    row.className = 'tp3d-import-case-row';

    if (entry.caseDef) {
      const dims = entry.caseDef.dimensions || {};
      const cat = categoryInfo(entry.caseDef.category);

      const dot = doc.createElement('span');
      dot.className = 'tp3d-import-cat-dot';
      dot.style.background = cat.color;

      const name = doc.createElement('span');
      name.className = 'tp3d-import-case-name';
      name.textContent = entry.caseDef.name || 'Untitled case';

      const dim = doc.createElement('span');
      dim.className = 'muted tp3d-import-case-dim';
      dim.textContent = `${fmtNum(dims.length)} × ${fmtNum(dims.width)} × ${fmtNum(dims.height)} in`;

      const wt = Number(entry.caseDef.weight);
      const weight = doc.createElement('span');
      weight.className = 'muted tp3d-import-case-weight';
      weight.textContent = Number.isFinite(wt) && wt > 0 ? `${wt} lb` : '—';

      const cat_ = doc.createElement('span');
      cat_.className = 'tp3d-import-case-cat';
      cat_.appendChild(dot);
      cat_.appendChild(doc.createTextNode(cat.label));

      row.appendChild(name);
      row.appendChild(dim);
      row.appendChild(weight);
      row.appendChild(cat_);
    } else {
      row.classList.add('tp3d-import-case-row-missing');
      const icon = doc.createElement('i');
      icon.className = 'fa-solid fa-triangle-exclamation';
      const name = doc.createElement('span');
      name.className = 'tp3d-import-case-name';
      name.textContent = `Case not found (${entry.caseId || 'no id'})`;
      row.appendChild(icon);
      row.appendChild(name);
    }

    return row;
  }

  function buildPackPreviewCard(analysis) {
    const card = doc.createElement('div');
    card.className = 'card';

    const title = doc.createElement('div');
    title.className = 'tp3d-import-summary-title';
    title.textContent = analysis.title;
    card.appendChild(title);

    const meta = doc.createElement('div');
    meta.className = 'muted tp3d-import-summary-meta';
    const truckText = analysis.truckValid
      ? `Truck: ${fmtNum(analysis.truck.length)} × ${fmtNum(analysis.truck.width)} × ${fmtNum(analysis.truck.height)} in`
      : 'Truck: missing or invalid dimensions';
    meta.textContent = `${truckText} · ${analysis.caseCount} case${analysis.caseCount !== 1 ? 's' : ''}`;
    card.appendChild(meta);

    if (!analysis.truckValid) {
      card.appendChild(
        buildWarningRow(
          'Invalid truck dimensions —',
          'this pack’s length/width/height are missing or not valid numbers. A default truck size will be used if you continue.'
        )
      );
    }

    if (analysis.missingCount > 0) {
      const plural = analysis.missingCount !== 1;
      card.appendChild(
        buildWarningRow(
          `${analysis.missingCount} case${plural ? 's' : ''} not found —`,
          `${plural ? 'these cases are' : 'this case is'} not bundled with the file and not in your case library. Review before importing.`
        )
      );
    }

    if (analysis.truckValid && analysis.missingCount === 0) {
      const badge = doc.createElement('div');
      badge.className = 'badge tp3d-import-badge-success';
      badge.textContent = 'Pack looks good';
      card.appendChild(badge);
    }

    if (analysis.cases.length > 0) {
      const list = doc.createElement('div');
      list.className = 'tp3d-import-case-list';
      analysis.cases.forEach(entry => list.appendChild(buildCaseRow(entry)));
      card.appendChild(list);
    }

    return card;
  }

  function buildImportAction(label, onClick) {
    const actions = doc.createElement('div');
    actions.className = 'tp3d-import-preview-actions';
    const btn = doc.createElement('button');
    btn.className = 'btn btn-primary';
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => onClick(btn));
    actions.appendChild(btn);
    return actions;
  }

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
    let _peeked = null;
    try {
      const parsed = Utils && Utils.safeJsonParse ? Utils.safeJsonParse(text, null) : JSON.parse(text);
      _peeked = parsed;
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

    // Detect batch pack JSON and route to batch handler.
    if (_peeked && typeof _peeked === 'object' && _peeked.exportType === 'pack-batch') {
      await handleBatchFile(text, resultsEl, modal);
      return;
    }

    let payload;
    try {
      payload = ImportExport.parsePackImportJSON(text);
    } catch (err) {
      UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
      return;
    }

    const analysis = analyzePackPayload(payload);
    resultsEl.appendChild(buildPackPreviewCard(analysis));
    resultsEl.appendChild(
      buildImportAction('Import pack', btn => {
        btn.disabled = true;
        try {
          PackLibrary.importPackPayload(payload);
          UIComponents.showToast('Imported 1 pack', 'success');
          modal.close();
        } catch (err) {
          btn.disabled = false;
          UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
        }
      })
    );
  }

  async function handleBatchFile(text, resultsEl, modal) {
    let payloads;
    try {
      payloads = ImportExport.parsePackBatchImportJSON(text);
    } catch (err) {
      UIComponents.showToast('Batch import failed: ' + (err && err.message), 'error');
      return;
    }

    const entries = Array.isArray(payloads) ? payloads : [];
    const validPayloads = entries.filter(
      p => p && p.pack && typeof p.pack === 'object' && Array.isArray(p.pack.cases) && p.pack.truck
    );
    const invalidCount = entries.length - validPayloads.length;

    resultsEl.classList.add('is-visible');
    resultsEl.innerHTML = '';

    const header = doc.createElement('div');
    header.className = 'tp3d-import-summary-title';
    header.textContent = `Batch Import Preview — ${validPayloads.length} pack${validPayloads.length !== 1 ? 's' : ''} ready`;
    resultsEl.appendChild(header);

    if (invalidCount > 0) {
      resultsEl.appendChild(
        buildWarningRow(
          `${invalidCount} entr${invalidCount !== 1 ? 'ies' : 'y'} skipped —`,
          `${invalidCount !== 1 ? 'these do' : 'this does'} not look like a valid pack and will not be imported.`
        )
      );
    }

    if (validPayloads.length === 0) {
      UIComponents.showToast('No valid packs found in this file', 'warning');
      return;
    }

    const list = doc.createElement('div');
    list.className = 'tp3d-import-batch-list';
    validPayloads.forEach(payload => list.appendChild(buildPackPreviewCard(analyzePackPayload(payload))));
    resultsEl.appendChild(list);

    resultsEl.appendChild(
      buildImportAction(
        `Import ${validPayloads.length} pack${validPayloads.length !== 1 ? 's' : ''}`,
        btn => {
          btn.disabled = true;
          let imported = 0;
          let skipped = 0;
          validPayloads.forEach(payload => {
            try {
              PackLibrary.importPackPayload(payload);
              imported++;
            } catch {
              skipped++;
            }
          });

          const msg = skipped > 0
            ? `Imported ${imported} pack${imported !== 1 ? 's' : ''} · ${skipped} skipped`
            : `Imported ${imported} pack${imported !== 1 ? 's' : ''}`;

          resultsEl.innerHTML = '';
          const summary = doc.createElement('div');
          summary.className = 'card';
          summary.innerHTML = `
            <div class="tp3d-import-summary-title">Batch Import Result</div>
            <div class="tp3d-import-summary-spacer"></div>
            <div class="badge tp3d-import-badge-success">Imported: ${imported} pack(s)</div>
            ${skipped > 0 ? `<div class="muted tp3d-import-summary-meta">${skipped} skipped (invalid)</div>` : ''}
          `;
          resultsEl.appendChild(summary);

          UIComponents.showToast(msg, imported > 0 ? 'success' : 'warning');
          // Do not auto-close — user reviews summary and dismisses manually.
          void modal;
        }
      )
    );
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
      'Required: Title + truck size (L/W/H) + cases list<br>Optional: Client, project name, notes, thumbnail';

    const results = doc.createElement('div');
    results.classList.add('tp3d-import-results');

    content.appendChild(drop);
    content.appendChild(hint);
    content.appendChild(results);

    openImportDialogWithFilePicker({
      documentRef: doc,
      UIComponents,
      title: 'Import Pack JSON',
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
