/**
 * @file import-cases-dialog.js
 * @description UI dialog for importing cases from CSV/XLSX.
 * @module ui/overlays/import-cases-dialog
 * @created Unknown
 * @updated 2026-06-07
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Note: file handlers (drag/drop, browse) are wired inline here since we manage
// three distinct visual states (dropzone → parsing → parsed) that the shared
// helper does not support.

import * as Defaults from '../../core/defaults.js';
import { getCaseHandlingSummary } from '../../services/case-rule-summary.js';

/**
 * @param {{
 *  documentRef?: Document,
 *  UIComponents?: any,
 *  ImportExport?: any,
 *  StateStore?: any,
 *  Utils?: any
 * }} [opts]
 */
export function createImportCasesDialog({
  documentRef = document,
  UIComponents,
  ImportExport,
  StateStore,
  Utils,
} = {}) {
  const doc = documentRef;

  // ---------------------------------------------------------------------------
  // SECTION: open()
  // ---------------------------------------------------------------------------

  function open() {
    // Per-open mutable state — fresh on every open() call so no stale leakage.
    let parsedResult = null;
    let activeFilter = 'all'; // 'all' | 'valid' | 'duplicate' | 'invalid'

    // Hidden file input (detached from DOM; still triggers native picker).
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept =
      '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

    // ── Body container ─────────────────────────────────────────────────────
    const content = doc.createElement('div');
    content.className = 'tp3d-ic-body';

    // Subtitle (always visible at top of body)
    const subtitleEl = doc.createElement('p');
    subtitleEl.className = 'tp3d-ic-subtitle muted';
    subtitleEl.textContent =
      'Add inventory from a .csv or .xlsx — validated before anything is saved';
    content.appendChild(subtitleEl);

    // ── DROPZONE AREA ───────────────────────────────────────────────────────
    const dropzoneArea = doc.createElement('div');
    dropzoneArea.className = 'tp3d-ic-area';

    // Dropzone card
    const drop = doc.createElement('div');
    drop.className = 'card tp3d-ic-drop';

    const dropIcon = doc.createElement('div');
    dropIcon.className = 'tp3d-import-drop-icon';
    dropIcon.innerHTML = '<i class="fa-solid fa-file-import"></i>';

    const dropTitle = doc.createElement('div');
    dropTitle.className = 'tp3d-import-drop-title';
    dropTitle.textContent = 'Drag & drop your file';

    const dropSub = doc.createElement('div');
    dropSub.className = 'tp3d-import-drop-sub';
    dropSub.textContent = 'CSV or XLSX — we\'ll validate it before anything is added';

    const browseBtn = doc.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.type = 'button';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse files';

    drop.appendChild(dropIcon);
    drop.appendChild(dropTitle);
    drop.appendChild(dropSub);
    drop.appendChild(browseBtn);

    // Column chips
    const colsEl = doc.createElement('div');
    colsEl.className = 'tp3d-ic-cols';

    const colsLabel = doc.createElement('div');
    colsLabel.className = 'tp3d-ic-cols-label';
    colsLabel.textContent = 'COLUMNS';
    colsEl.appendChild(colsLabel);

    const colsChips = doc.createElement('div');
    colsChips.className = 'tp3d-ic-chips';

    [
      { label: 'Name', required: true },
      { label: 'Length', required: true },
      { label: 'Width', required: true },
      { label: 'Height', required: true },
      { label: 'Manufacturer', required: false },
      { label: 'Category', required: false },
      { label: 'Weight', required: false },
      { label: 'Flip', required: false },
      { label: 'orientationLock', required: false },
      { label: 'noStackOnTop', required: false },
      { label: 'maxStackCount', required: false },
      { label: 'isPallet', required: false },
      { label: 'maxPalletWeight', required: false },
      { label: 'laneItem', required: false },
      { label: 'loadPriority', required: false },
      { label: 'Notes', required: false },
    ].forEach(col => {
      const chip = doc.createElement('span');
      chip.className = col.required ? 'tp3d-ic-chip tp3d-ic-chip--required' : 'tp3d-ic-chip';
      if (col.required) {
        const dot = doc.createElement('span');
        dot.className = 'tp3d-ic-chip-dot';
        chip.appendChild(dot);
      }
      chip.appendChild(doc.createTextNode(col.label));
      colsChips.appendChild(chip);
    });
    colsEl.appendChild(colsChips);

    dropzoneArea.appendChild(drop);
    dropzoneArea.appendChild(colsEl);

    // ── PARSING AREA ────────────────────────────────────────────────────────
    const parsingArea = doc.createElement('div');
    parsingArea.className = 'tp3d-ic-area tp3d-ic-hidden';

    const parsingCard = doc.createElement('div');
    parsingCard.className = 'card tp3d-ic-parsing-card';

    const parsingLeft = doc.createElement('div');
    parsingLeft.className = 'tp3d-ic-parsing-left';

    const parsingSpinnerEl = doc.createElement('span');
    parsingSpinnerEl.className = 'tp3d-ic-spinner';
    parsingSpinnerEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    const parsingName = doc.createElement('span');
    parsingName.className = 'tp3d-ic-parsing-name';

    parsingLeft.appendChild(parsingSpinnerEl);
    parsingLeft.appendChild(parsingName);

    const parsingBar = doc.createElement('div');
    parsingBar.className = 'tp3d-ic-progress';
    const parsingBarInner = doc.createElement('div');
    parsingBarInner.className = 'tp3d-ic-progress-bar';
    parsingBar.appendChild(parsingBarInner);

    parsingCard.appendChild(parsingLeft);
    parsingCard.appendChild(parsingBar);
    parsingArea.appendChild(parsingCard);

    // ── PARSED AREA ─────────────────────────────────────────────────────────
    const parsedArea = doc.createElement('div');
    parsedArea.className = 'tp3d-ic-area tp3d-ic-hidden';

    // File chip
    const fileChip = doc.createElement('div');
    fileChip.className = 'card tp3d-ic-file-chip';

    const fileChipIcon = doc.createElement('span');
    fileChipIcon.className = 'tp3d-ic-file-icon';
    fileChipIcon.innerHTML = '<i class="fa-solid fa-file"></i>';

    const fileChipInfo = doc.createElement('div');
    fileChipInfo.className = 'tp3d-ic-file-info';

    const fileChipName = doc.createElement('div');
    fileChipName.className = 'tp3d-ic-file-name';

    const fileChipMeta = doc.createElement('div');
    fileChipMeta.className = 'tp3d-ic-file-meta muted';

    fileChipInfo.appendChild(fileChipName);
    fileChipInfo.appendChild(fileChipMeta);

    const fileChipReplace = doc.createElement('button');
    fileChipReplace.className = 'btn btn-ghost tp3d-ic-replace-btn';
    fileChipReplace.type = 'button';
    fileChipReplace.textContent = 'Replace';

    const fileChipClear = doc.createElement('button');
    fileChipClear.className = 'btn btn-ghost';
    fileChipClear.type = 'button';
    fileChipClear.title = 'Remove file';
    fileChipClear.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    fileChipClear.addEventListener('click', ev => {
      ev.stopPropagation(); // must not bubble to modal-overlay close
      parsedResult = null;
      activeFilter = 'all';
      fileInput.value = '';
      showState('dropzone');
      updateImportBtn();
      updateFooterLeft();
    });

    fileChip.appendChild(fileChipIcon);
    fileChip.appendChild(fileChipInfo);
    fileChip.appendChild(fileChipReplace);
    fileChip.appendChild(fileChipClear);
    parsedArea.appendChild(fileChip);

    // Stat cards
    const statsEl = doc.createElement('div');
    statsEl.className = 'tp3d-ic-stats';

    function makeStatCard(filterKey, dotClass, labelText) {
      const card = doc.createElement('div');
      card.className = 'card tp3d-ic-stat';
      card.dataset.filter = filterKey;

      const countRow = doc.createElement('div');
      countRow.className = 'tp3d-ic-stat-count';

      const dot = doc.createElement('span');
      dot.className = 'tp3d-ic-stat-dot ' + dotClass;
      countRow.appendChild(dot);

      const num = doc.createElement('span');
      num.className = 'tp3d-ic-stat-num';
      num.textContent = '0';
      countRow.appendChild(num);

      const lbl = doc.createElement('div');
      lbl.className = 'tp3d-ic-stat-label muted';
      lbl.textContent = labelText;

      card.appendChild(countRow);
      card.appendChild(lbl);

      card.addEventListener('click', () => {
        activeFilter = activeFilter === filterKey ? 'all' : filterKey;
        updateStatCards();
        renderPreviewRows();
      });

      return { card, num };
    }

    const validStat = makeStatCard('valid', 'tp3d-ic-dot--success', 'Ready to import');
    const dupStat = makeStatCard('duplicate', 'tp3d-ic-dot--info', 'Duplicates skipped');
    const errStat = makeStatCard('invalid', 'tp3d-ic-dot--error', 'Invalid rows');
    statsEl.appendChild(validStat.card);
    statsEl.appendChild(dupStat.card);
    statsEl.appendChild(errStat.card);
    parsedArea.appendChild(statsEl);

    // Preview table
    const previewSection = doc.createElement('div');
    previewSection.className = 'tp3d-ic-preview';

    const previewHeader = doc.createElement('div');
    previewHeader.className = 'tp3d-ic-preview-header';

    const previewLabel = doc.createElement('span');
    previewLabel.className = 'tp3d-ic-preview-label';
    previewLabel.textContent = 'Preview';

    const previewCount = doc.createElement('span');
    previewCount.className = 'muted';
    previewCount.style.fontSize = 'var(--text-sm)';

    previewHeader.appendChild(previewLabel);
    previewHeader.appendChild(previewCount);
    previewSection.appendChild(previewHeader);

    const tableWrap = doc.createElement('div');
    tableWrap.className = 'tp3d-ic-table-wrap';

    const table = doc.createElement('table');
    table.className = 'tp3d-ic-table';

    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['', 'NAME', 'L × W × H', 'WEIGHT', 'CATEGORY', 'HANDLING'].forEach(col => {
      const th = doc.createElement('th');
      th.textContent = col;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    previewSection.appendChild(tableWrap);
    parsedArea.appendChild(previewSection);

    content.appendChild(dropzoneArea);
    content.appendChild(parsingArea);
    content.appendChild(parsedArea);

    // ── Modal ────────────────────────────────────────────────────────────────
    const modalObj = UIComponents.showModal({
      title: 'Import Cases',
      content,
      dismissible: false,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Import cases',
          variant: 'primary',
          onClick: () => {
            if (!parsedResult || parsedResult.valid.length === 0) return false;
            doImport();
            return false; // doImport calls modalObj.close()
          },
        },
      ],
    });

    // Widen the modal for the preview table
    modalObj.modal.classList.add('tp3d-ic-modal');

    // Import button ref for dynamic enable/disable + label
    const importBtn = modalObj.modal.querySelector('.modal-footer .btn-primary');
    importBtn.disabled = true;

    // Footer left side: "Nothing imported" note or error-report button
    const footer = modalObj.modal.querySelector('.modal-footer');

    const footerLeft = doc.createElement('div');
    footerLeft.className = 'tp3d-ic-footer-left';

    const footerNote = doc.createElement('span');
    footerNote.className = 'muted';
    footerNote.style.fontSize = 'var(--text-sm)';
    footerNote.textContent = 'Nothing imported until you confirm.';
    footerLeft.appendChild(footerNote);

    const errReportBtn = doc.createElement('button');
    errReportBtn.className = 'btn';
    errReportBtn.type = 'button';
    errReportBtn.style.display = 'none';
    errReportBtn.addEventListener('click', downloadErrorReport);
    footerLeft.appendChild(errReportBtn);

    footer.insertBefore(footerLeft, footer.firstChild);

    // ── File input event (also used by replace) ───────────────────────────
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = ''; // allow same file to be re-selected
      if (file) handleFile(file);
    });

    // Browse and replace both open the same picker
    browseBtn.addEventListener('click', () => fileInput.click());
    fileChipReplace.addEventListener('click', () => fileInput.click());

    // ── Drag / drop on dropzone ───────────────────────────────────────────
    drop.addEventListener('dragover', ev => {
      ev.preventDefault();
      drop.classList.add('is-dragover');
      dropTitle.textContent = 'Drop to upload';
    });
    drop.addEventListener('dragleave', () => {
      drop.classList.remove('is-dragover');
      dropTitle.textContent = 'Drag & drop your file';
    });
    drop.addEventListener('drop', ev => {
      ev.preventDefault();
      drop.classList.remove('is-dragover');
      dropTitle.textContent = 'Drag & drop your file';
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    // ── State transitions ─────────────────────────────────────────────────
    function showState(name) {
      dropzoneArea.classList.toggle('tp3d-ic-hidden', name !== 'dropzone');
      parsingArea.classList.toggle('tp3d-ic-hidden', name !== 'parsing');
      parsedArea.classList.toggle('tp3d-ic-hidden', name !== 'parsed');
    }

    // ── Dynamic updates ───────────────────────────────────────────────────
    function updateImportBtn() {
      const count = parsedResult ? parsedResult.valid.length : 0;
      importBtn.disabled = count === 0;
      importBtn.textContent = count > 0 ? `Import ${count} cases` : 'Import cases';
    }

    function updateFooterLeft() {
      if (!parsedResult) {
        footerNote.style.display = '';
        errReportBtn.style.display = 'none';
        return;
      }
      const invalidCount = parsedResult.errors ? parsedResult.errors.length : 0;
      const warnCount = parsedResult.warnings ? parsedResult.warnings.length : 0;
      if (invalidCount > 0 || warnCount > 0) {
        footerNote.style.display = 'none';
        errReportBtn.style.display = '';
        // Build button content safely
        errReportBtn.textContent = '';
        const icon = doc.createElement('i');
        icon.className = 'fa-solid fa-download';
        errReportBtn.appendChild(icon);
        const total = invalidCount + warnCount;
        const reportLabel = invalidCount > 0 ? ' Error report (' + total + ')' : ' Warnings (' + warnCount + ')';
        errReportBtn.appendChild(doc.createTextNode(reportLabel));
      } else {
        footerNote.style.display = 'none';
        errReportBtn.style.display = 'none';
      }
    }

    function updateStatCards() {
      if (!parsedResult) return;
      const dupCount = parsedResult.duplicateRows
        ? parsedResult.duplicateRows.length
        : (parsedResult.duplicates ? parsedResult.duplicates.length : 0);
      const invCount = parsedResult.invalidRows
        ? parsedResult.invalidRows.length
        : (parsedResult.errors ? parsedResult.errors.length : 0);
      validStat.num.textContent = String(parsedResult.valid.length);
      dupStat.num.textContent = String(dupCount);
      errStat.num.textContent = String(invCount);

      [
        { card: validStat.card, key: 'valid' },
        { card: dupStat.card, key: 'duplicate' },
        { card: errStat.card, key: 'invalid' },
      ].forEach(({ card, key }) => {
        card.classList.toggle('tp3d-ic-stat--active', activeFilter === key);
      });
    }

    function renderPreviewRows() {
      tbody.textContent = ''; // safe clear
      if (!parsedResult) return;

      const invalidRows = parsedResult.invalidRows || [];
      const duplicateRows = parsedResult.duplicateRows || [];

      // Order: valid → duplicates → invalid
      const allRows = [];
      parsedResult.valid.forEach(r => allRows.push({ type: 'valid', record: r, reasons: null }));
      duplicateRows.forEach(({ record }) => allRows.push({ type: 'duplicate', record, reasons: null }));
      invalidRows.forEach(({ record, reasons }) => allRows.push({ type: 'invalid', record, reasons }));

      const filtered =
        activeFilter === 'all' ? allRows : allRows.filter(r => r.type === activeFilter);

      previewCount.textContent =
        activeFilter === 'all'
          ? 'Showing all rows'
          : 'Showing ' + filtered.length + ' row' + (filtered.length !== 1 ? 's' : '');

      if (filtered.length === 0) {
        const tr = doc.createElement('tr');
        const td = doc.createElement('td');
        td.colSpan = 5;
        td.className = 'tp3d-ic-empty-row';
        td.textContent = 'No rows to show';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      filtered.forEach(({ type, record, reasons }) => {
        const tr = doc.createElement('tr');
        tr.className = 'tp3d-ic-row tp3d-ic-row--' + type;

        // Status cell — icons in soft circular backgrounds
        const statusTd = doc.createElement('td');
        statusTd.className = 'tp3d-ic-td-status';
        const statusCircle = doc.createElement('span');
        const statusIcon = doc.createElement('i');
        if (type === 'valid') {
          statusCircle.className = 'tp3d-ic-status-circle tp3d-ic-status-circle--success';
          statusIcon.className = 'fa-solid fa-check';
        } else if (type === 'duplicate') {
          statusCircle.className = 'tp3d-ic-status-circle tp3d-ic-status-circle--muted';
          statusIcon.className = 'fa-regular fa-copy';
        } else {
          statusCircle.className = 'tp3d-ic-status-circle tp3d-ic-status-circle--error';
          statusIcon.className = 'fa-solid fa-xmark';
        }
        statusCircle.appendChild(statusIcon);
        statusTd.appendChild(statusCircle);

        // Name cell — all values set via textContent (no innerHTML for user data)
        const nameTd = doc.createElement('td');
        nameTd.className = 'tp3d-ic-td-name';

        const nameSpan = doc.createElement('span');
        nameSpan.textContent = record.name || '—';
        nameTd.appendChild(nameSpan);

        if (type === 'duplicate') {
          const badge = doc.createElement('span');
          badge.className = 'tp3d-ic-dup-badge';
          badge.textContent = 'Duplicate';
          nameTd.appendChild(badge);
        }

        if (type === 'invalid' && reasons && reasons.length) {
          const reasonRow = doc.createElement('div');
          reasonRow.className = 'tp3d-ic-row-reason';
          const warnIcon = doc.createElement('i');
          warnIcon.className = 'fa-solid fa-triangle-exclamation';
          reasonRow.appendChild(warnIcon);
          reasonRow.appendChild(doc.createTextNode(' ' + reasons[0]));
          nameTd.appendChild(reasonRow);
        }

        // Dimensions cell
        const dimTd = doc.createElement('td');
        dimTd.className = 'tp3d-ic-td-dim';
        const fmtNum = v => {
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) return '—';
          return n % 1 === 0 ? String(n) : n.toFixed(2);
        };
        dimTd.textContent =
          fmtNum(record.length) + ' × ' + fmtNum(record.width) + ' × ' + fmtNum(record.height);

        // Weight cell
        const wtTd = doc.createElement('td');
        wtTd.className = 'tp3d-ic-td-weight';
        const wt = Number(record.weight);
        wtTd.textContent = Number.isFinite(wt) && wt > 0 ? wt + ' lb' : '—';

        // Category cell — color dot + label
        const catTd = doc.createElement('td');
        catTd.className = 'tp3d-ic-td-cat';
        const catName = record.category || 'default';
        const cats = (Defaults && Defaults.categories) ? Defaults.categories : [];
        const catEntry = cats.find(c => c.key === catName) || cats.find(c => c.key === 'default');
        const catColor = (catEntry && catEntry.color) || '#9ca3af';
        const catDot = doc.createElement('span');
        catDot.className = 'tp3d-ic-cat-dot';
        catDot.style.background = catColor;
        catTd.appendChild(catDot);
        catTd.appendChild(doc.createTextNode(catName.charAt(0).toUpperCase() + catName.slice(1)));

        // Handling cell — active non-default rules via the shared summary source.
        const handlingTd = doc.createElement('td');
        handlingTd.className = 'tp3d-ic-td-handling';
        const handlingSummary = getCaseHandlingSummary(record);
        if (handlingSummary.length === 0) {
          handlingTd.textContent = '—';
        } else {
          handlingSummary.forEach(label => {
            const chip = doc.createElement('span');
            chip.className = 'badge tp3d-handling-chip';
            chip.textContent = label;
            handlingTd.appendChild(chip);
          });
        }

        tr.appendChild(statusTd);
        tr.appendChild(nameTd);
        tr.appendChild(dimTd);
        tr.appendChild(wtTd);
        tr.appendChild(catTd);
        tr.appendChild(handlingTd);
        tbody.appendChild(tr);
      });
    }

    // ── File handler ──────────────────────────────────────────────────────
    async function handleFile(file) {
      if (!file) return;

      parsingName.textContent = 'Reading ' + file.name + '…';
      showState('parsing');

      try {
        const parsed = await ImportExport.parseAndValidateSpreadsheet(file);
        parsedResult = parsed;
        activeFilter = 'all';

        // File chip metadata — textContent only, no innerHTML
        fileChipName.textContent = file.name;
        const dupCount = parsed.duplicateRows
          ? parsed.duplicateRows.length
          : (parsed.duplicates ? parsed.duplicates.length : 0);
        const invCount = parsed.invalidRows
          ? parsed.invalidRows.length
          : (parsed.errors ? parsed.errors.length : 0);
        const rowCount = parsed.valid.length + dupCount + invCount;
        const kb = Math.round((file.size / 1024) * 10) / 10;
        fileChipMeta.textContent =
          rowCount + ' row' + (rowCount !== 1 ? 's' : '') +
          ' · ' + kb + ' KB · parsed just now';

        updateStatCards();
        renderPreviewRows();
        updateImportBtn();
        updateFooterLeft();
        showState('parsed');
      } catch (err) {
        showState('dropzone');
        UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
      }
    }

    // ── Error report download ─────────────────────────────────────────────
    function downloadErrorReport() {
      if (!parsedResult) return;
      const lines = [];
      if (parsedResult.errors && parsedResult.errors.length) {
        lines.push('INVALID ROWS');
        parsedResult.errors.forEach(e => lines.push(e));
        lines.push('');
      }
      if (parsedResult.duplicates && parsedResult.duplicates.length) {
        lines.push('DUPLICATES');
        parsedResult.duplicates.forEach(e => lines.push(e));
        lines.push('');
      }
      if (parsedResult.warnings && parsedResult.warnings.length) {
        lines.push('HANDLING-RULE WARNINGS (row still imported with default)');
        parsedResult.warnings.forEach(e => lines.push(e));
        lines.push('');
      }
      Utils.downloadText('import_errors.txt', lines.join('\n'), 'text/plain');
    }

    // ── Import ────────────────────────────────────────────────────────────
    function doImport() {
      if (!parsedResult || parsedResult.valid.length === 0) return;
      const result = ImportExport.importCaseRows(parsedResult.valid);
      StateStore.set({ caseLibrary: result.nextCaseLibrary });
      const dupCount = parsedResult.duplicateRows
        ? parsedResult.duplicateRows.length
        : (parsedResult.duplicates ? parsedResult.duplicates.length : 0);
      const invCount = parsedResult.invalidRows
        ? parsedResult.invalidRows.length
        : (parsedResult.errors ? parsedResult.errors.length : 0);
      const skipCount = dupCount + invCount;
      const msg =
        skipCount > 0
          ? result.added + ' case' + (result.added !== 1 ? 's' : '') + ' imported · ' + skipCount + ' skipped'
          : result.added + ' case' + (result.added !== 1 ? 's' : '') + ' imported';
      UIComponents.showToast(msg, result.added > 0 ? 'success' : 'warning');
      modalObj.close();
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION: init()
  // ---------------------------------------------------------------------------

  function init() {
    // No-op.
  }

  return { init, open };
}
