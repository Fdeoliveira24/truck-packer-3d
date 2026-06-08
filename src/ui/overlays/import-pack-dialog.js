/**
 * @file import-pack-dialog.js
 * @description UI dialog for importing a pack (single or batch) from JSON.
 * @module ui/overlays/import-pack-dialog
 * @created Unknown
 * @updated 2026-06-07
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Note: file handlers (drag/drop, browse) are wired inline here since we manage
// four distinct visual states (dropzone → parsing → parsed → error) that the
// shared helper does not support.

/**
 * @param {{
 *  documentRef?: Document,
 *  UIComponents?: any,
 *  ImportExport?: any,
 *  PackLibrary?: any,
 *  Utils?: any
 * }} [opts]
 */
export function createImportPackDialog({
  documentRef = document,
  UIComponents,
  ImportExport,
  PackLibrary,
  Utils,
} = {}) {
  const doc = documentRef;

  // ---------------------------------------------------------------------------
  // SECTION: open()
  // ---------------------------------------------------------------------------

  function open() {
    // Per-open mutable state — fresh on every open() call so no stale leakage.
    let parsedPayload = null; // { type: 'single'|'batch', payload, file }

    // Hidden file input.
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    // ── Body container ─────────────────────────────────────────────────────
    const content = doc.createElement('div');
    content.className = 'tp3d-ic-body';

    const subtitleEl = doc.createElement('p');
    subtitleEl.className = 'tp3d-ic-subtitle muted';
    subtitleEl.textContent =
      'Recreate a saved pack from a .json export — validated before anything is created';
    content.appendChild(subtitleEl);

    // ── DROPZONE AREA ───────────────────────────────────────────────────────
    const dropzoneArea = doc.createElement('div');
    dropzoneArea.className = 'tp3d-ic-area';

    const drop = doc.createElement('div');
    drop.className = 'card tp3d-ic-drop';

    const dropIcon = doc.createElement('div');
    dropIcon.className = 'tp3d-import-drop-icon';
    dropIcon.innerHTML = '<i class="fa-solid fa-file-import"></i>';

    const dropTitle = doc.createElement('div');
    dropTitle.className = 'tp3d-import-drop-title';
    dropTitle.textContent = 'Drag & drop your pack file';

    const dropSub = doc.createElement('div');
    dropSub.className = 'tp3d-import-drop-sub';
    dropSub.innerHTML = 'A single <strong>.json</strong> pack export — validated before anything is created';

    const browseBtn = doc.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.type = 'button';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse files';

    drop.appendChild(dropIcon);
    drop.appendChild(dropTitle);
    drop.appendChild(dropSub);
    drop.appendChild(browseBtn);

    // Structure chips
    const chipsEl = doc.createElement('div');
    chipsEl.className = 'tp3d-ic-cols';

    const chipsLabel = doc.createElement('div');
    chipsLabel.className = 'tp3d-ic-cols-label';
    chipsLabel.textContent = 'PACK STRUCTURE';
    chipsEl.appendChild(chipsLabel);

    const chipsWrap = doc.createElement('div');
    chipsWrap.className = 'tp3d-ic-chips';

    [
      { label: 'Title', required: true },
      { label: 'Truck size (L/W/H)', required: true },
      { label: 'Cases', required: true },
      { label: 'Client', required: false },
      { label: 'Project name', required: false },
      { label: 'Notes', required: false },
      { label: 'Thumbnail', required: false },
    ].forEach(col => {
      const chip = doc.createElement('span');
      chip.className = col.required ? 'tp3d-ic-chip tp3d-ic-chip--required' : 'tp3d-ic-chip';
      if (col.required) {
        const dot = doc.createElement('span');
        dot.className = 'tp3d-ic-chip-dot';
        chip.appendChild(dot);
      }
      chip.appendChild(doc.createTextNode(col.label));
      chipsWrap.appendChild(chip);
    });
    chipsEl.appendChild(chipsWrap);

    dropzoneArea.appendChild(drop);
    dropzoneArea.appendChild(chipsEl);

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

    // File chip (shared across single + batch)
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
      ev.stopPropagation();
      parsedPayload = null;
      fileInput.value = '';
      showState('dropzone');
      updateFooter();
    });

    fileChip.appendChild(fileChipIcon);
    fileChip.appendChild(fileChipInfo);
    fileChip.appendChild(fileChipReplace);
    fileChip.appendChild(fileChipClear);
    parsedArea.appendChild(fileChip);

    // Single-pack detail container
    const singleDetail = doc.createElement('div');
    singleDetail.className = 'tp3d-ip-single';

    // Pack summary card
    const packSummary = doc.createElement('div');
    packSummary.className = 'card tp3d-ip-summary';
    singleDetail.appendChild(packSummary);

    // Cases section header + table
    const casesSection = doc.createElement('div');
    casesSection.className = 'tp3d-ic-preview';

    const casesHeader = doc.createElement('div');
    casesHeader.className = 'tp3d-ic-preview-header';

    const casesLabel = doc.createElement('span');
    casesLabel.className = 'tp3d-ic-preview-label';
    casesLabel.textContent = 'CASES IN THIS PACK';
    casesHeader.appendChild(casesLabel);

    const casesCount = doc.createElement('span');
    casesCount.className = 'muted';
    casesCount.style.fontSize = 'var(--text-sm)';
    casesHeader.appendChild(casesCount);

    casesSection.appendChild(casesHeader);

    const tableWrap = doc.createElement('div');
    tableWrap.className = 'tp3d-ic-table-wrap';

    const table = doc.createElement('table');
    table.className = 'tp3d-ic-table';

    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['', 'NAME', 'L × W × H', 'WEIGHT', 'CATEGORY'].forEach(col => {
      const th = doc.createElement('th');
      th.textContent = col;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    casesSection.appendChild(tableWrap);
    singleDetail.appendChild(casesSection);
    parsedArea.appendChild(singleDetail);

    // Batch detail container
    const batchDetail = doc.createElement('div');
    batchDetail.className = 'tp3d-ip-batch tp3d-ic-hidden';

    const batchStats = doc.createElement('div');
    batchStats.className = 'tp3d-ic-stats';
    batchDetail.appendChild(batchStats);

    const batchListWrap = doc.createElement('div');
    batchListWrap.className = 'tp3d-ic-preview';

    const batchListHeader = doc.createElement('div');
    batchListHeader.className = 'tp3d-ic-preview-header';
    const batchListLabel = doc.createElement('span');
    batchListLabel.className = 'tp3d-ic-preview-label';
    batchListLabel.textContent = 'PACKS IN THIS FILE';
    batchListHeader.appendChild(batchListLabel);

    const batchListCount = doc.createElement('span');
    batchListCount.className = 'muted';
    batchListCount.style.fontSize = 'var(--text-sm)';
    batchListHeader.appendChild(batchListCount);
    batchListWrap.appendChild(batchListHeader);

    const batchTableWrap = doc.createElement('div');
    batchTableWrap.className = 'tp3d-ic-table-wrap';

    const batchTable = doc.createElement('table');
    batchTable.className = 'tp3d-ic-table';

    const batchThead = doc.createElement('thead');
    const batchHeadRow = doc.createElement('tr');
    ['', 'PACK TITLE', 'TRUCK (L×W×H)', 'CASES'].forEach(col => {
      const th = doc.createElement('th');
      th.textContent = col;
      batchHeadRow.appendChild(th);
    });
    batchThead.appendChild(batchHeadRow);
    batchTable.appendChild(batchThead);

    const batchTbody = doc.createElement('tbody');
    batchTable.appendChild(batchTbody);
    batchTableWrap.appendChild(batchTable);
    batchListWrap.appendChild(batchTableWrap);
    batchDetail.appendChild(batchListWrap);
    parsedArea.appendChild(batchDetail);

    // Inline error area
    const errorArea = doc.createElement('div');
    errorArea.className = 'tp3d-ip-error tp3d-ic-hidden';
    parsedArea.appendChild(errorArea);

    content.appendChild(dropzoneArea);
    content.appendChild(parsingArea);
    content.appendChild(parsedArea);

    // ── Modal ────────────────────────────────────────────────────────────────
    const modalObj = UIComponents.showModal({
      title: 'Import Pack JSON',
      content,
      dismissible: false,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Import pack',
          variant: 'primary',
          onClick: () => {
            if (!parsedPayload) return false;
            doImport();
            return false;
          },
        },
      ],
    });

    modalObj.modal.classList.add('tp3d-ic-modal');

    const importBtn = modalObj.modal.querySelector('.modal-footer .btn-primary');
    importBtn.disabled = true;

    // Footer left note
    const footer = modalObj.modal.querySelector('.modal-footer');
    const footerLeft = doc.createElement('div');
    footerLeft.className = 'tp3d-ic-footer-left';
    const footerNote = doc.createElement('span');
    footerNote.className = 'muted';
    footerNote.style.fontSize = 'var(--text-sm)';
    footerNote.textContent = 'Nothing created until you confirm.';
    footerLeft.appendChild(footerNote);
    footer.insertBefore(footerLeft, footer.firstChild);

    // ── File input event ──────────────────────────────────────────────────
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) handleFile(file);
    });

    browseBtn.addEventListener('click', () => fileInput.click());
    fileChipReplace.addEventListener('click', () => fileInput.click());

    // ── Drag / drop ───────────────────────────────────────────────────────
    drop.addEventListener('dragover', ev => {
      ev.preventDefault();
      drop.classList.add('is-dragover');
      dropTitle.textContent = 'Drop to upload';
    });
    drop.addEventListener('dragleave', () => {
      drop.classList.remove('is-dragover');
      dropTitle.textContent = 'Drag & drop your pack file';
    });
    drop.addEventListener('drop', ev => {
      ev.preventDefault();
      drop.classList.remove('is-dragover');
      dropTitle.textContent = 'Drag & drop your pack file';
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    // ── State transitions ─────────────────────────────────────────────────
    function showState(name) {
      dropzoneArea.classList.toggle('tp3d-ic-hidden', name !== 'dropzone');
      parsingArea.classList.toggle('tp3d-ic-hidden', name !== 'parsing');
      parsedArea.classList.toggle('tp3d-ic-hidden',
        name !== 'single' && name !== 'batch' && name !== 'error');
      if (name === 'single' || name === 'batch' || name === 'error') {
        singleDetail.classList.toggle('tp3d-ic-hidden', name !== 'single');
        batchDetail.classList.toggle('tp3d-ic-hidden', name !== 'batch');
        errorArea.classList.toggle('tp3d-ic-hidden', name !== 'error');
      }
    }

    // ── Footer and button updates ─────────────────────────────────────────
    function updateFooter() {
      if (!parsedPayload) {
        importBtn.disabled = true;
        importBtn.textContent = 'Import pack';
        footerNote.textContent = 'Nothing created until you confirm.';
        return;
      }
      if (parsedPayload.type === 'single') {
        importBtn.disabled = false;
        const n = parsedPayload.payload.pack.cases
          ? parsedPayload.payload.pack.cases.length
          : 0;
        importBtn.innerHTML = '';
        importBtn.appendChild(doc.createTextNode('Import pack'));
        if (n > 0) {
          const badge = doc.createElement('span');
          badge.className = 'tp3d-ip-btn-badge';
          badge.textContent = String(n);
          importBtn.appendChild(badge);
        }

        // Check for name conflict
        const title = parsedPayload.payload.pack.title;
        const existing = PackLibrary && PackLibrary.getPacks
          ? PackLibrary.getPacks().find(p => p.title === title)
          : null;
        if (existing) {
          footerNote.textContent =
            'A pack named “' + (Utils && Utils.escapeHtml ? title : title) +
            '” already exists — importing will create a copy.';
        } else {
          footerNote.textContent = 'Pack looks good.';
        }
      } else {
        // batch
        const validCount = parsedPayload.valid;
        importBtn.disabled = validCount === 0;
        importBtn.innerHTML = '';
        importBtn.appendChild(doc.createTextNode('Import ' + validCount + ' pack' + (validCount !== 1 ? 's' : '')));
        footerNote.textContent = 'Nothing created until you confirm.';
      }
    }

    // ── Render pack summary card ──────────────────────────────────────────
    function renderPackSummary(pack, bundledCases) {
      packSummary.textContent = '';

      const truck = pack.truck || {};
      const lengthUnit = Utils && Utils.lengthUnits ? 'm' : 'm';
      const weightUnit = 'lb';

      // Compute volume and weight from bundled cases + instances
      let totalWeightLb = 0;
      let totalVolIn3 = 0;
      const bundledById = new Map((bundledCases || []).map(c => [c.id, c]));

      (pack.cases || []).forEach(inst => {
        const def = bundledById.get(inst.caseId);
        if (!def) return;
        const w = Number(def.weight);
        if (Number.isFinite(w) && w > 0) totalWeightLb += w;
        const dims = def.dimensions || {};
        const vol = Number(dims.length) * Number(dims.width) * Number(dims.height);
        if (Number.isFinite(vol) && vol > 0) totalVolIn3 += vol;
      });

      // Truck volume
      const truckVolIn3 = Number(truck.length) * Number(truck.width) * Number(truck.height);
      const fillPct = (Number.isFinite(truckVolIn3) && truckVolIn3 > 0)
        ? Math.min(100, Math.round((totalVolIn3 / truckVolIn3) * 100))
        : 0;

      // Fit badge
      const badgeClass = fillPct >= 90 ? 'tp3d-ip-badge-warn' : 'tp3d-ip-badge-ok';
      const badgeText = fillPct >= 90 ? '⚠️ TIGHT FIT' : '✓ FITS';

      // Header row: pack title + badge
      const headerRow = doc.createElement('div');
      headerRow.className = 'tp3d-ip-summary-header';

      const packTitle = doc.createElement('div');
      packTitle.className = 'tp3d-ip-summary-title';
      packTitle.textContent = pack.title || 'Untitled Pack';
      headerRow.appendChild(packTitle);

      const fitBadge = doc.createElement('span');
      fitBadge.className = 'tp3d-ip-badge ' + badgeClass;
      fitBadge.textContent = fillPct >= 90 ? 'TIGHT FIT' : 'FITS';
      headerRow.appendChild(fitBadge);
      packSummary.appendChild(headerRow);

      // Meta row: client · project · truck
      const metaEl = doc.createElement('div');
      metaEl.className = 'tp3d-ip-summary-meta muted';

      const metaParts = [];
      if (pack.client) metaParts.push('Client ' + pack.client);
      if (pack.projectName) metaParts.push('Project ' + pack.projectName);

      metaParts.forEach((part, i) => {
        const span = doc.createElement('span');
        span.textContent = part;
        metaEl.appendChild(span);
        if (i < metaParts.length - 1) {
          metaEl.appendChild(doc.createTextNode('  '));
        }
      });
      if (metaParts.length) packSummary.appendChild(metaEl);

      // Truck row
      const truckRow = doc.createElement('div');
      truckRow.className = 'tp3d-ip-summary-truck muted';
      const truckText = (Utils && Utils.formatDims)
        ? 'Truck ' + Utils.formatDims(truck, 'm')
        : 'Truck ' + (truck.length || '?') + ' × ' + (truck.width || '?') + ' × ' + (truck.height || '?');
      truckRow.textContent = truckText;
      packSummary.appendChild(truckRow);

      // Stat row: cases · weight · volume
      const statRow = doc.createElement('div');
      statRow.className = 'tp3d-ip-stat-row';

      const statCaseCount = pack.cases ? pack.cases.length : 0;
      [
        { value: String(statCaseCount), label: 'CASES READY' },
        {
          value: (Utils && Utils.formatWeight)
            ? Utils.formatWeight(totalWeightLb, weightUnit, 0)
            : totalWeightLb + ' lb',
          label: 'TOTAL WEIGHT',
        },
        {
          value: (() => {
            const m3 = totalVolIn3 * Math.pow(0.0254, 3);
            return (Number.isFinite(m3) && m3 > 0) ? m3.toFixed(1) + ' m³' : '—';
          })(),
          label: 'CASE VOLUME',
        },
      ].forEach(({ value, label }) => {
        const cell = doc.createElement('div');
        cell.className = 'tp3d-ip-stat-cell';
        const vEl = doc.createElement('div');
        vEl.className = 'tp3d-ip-stat-value';
        vEl.textContent = value;
        const lEl = doc.createElement('div');
        lEl.className = 'tp3d-ip-stat-label muted';
        lEl.textContent = label;
        cell.appendChild(vEl);
        cell.appendChild(lEl);
        statRow.appendChild(cell);
      });
      packSummary.appendChild(statRow);

      // Fill bar
      const fillSection = doc.createElement('div');
      fillSection.className = 'tp3d-ip-fill';

      const fillHeader = doc.createElement('div');
      fillHeader.className = 'tp3d-ip-fill-header';
      const fillLabel = doc.createElement('span');
      fillLabel.textContent = 'Truck fill';
      const fillPctLabel = doc.createElement('span');
      fillPctLabel.className = fillPct >= 90 ? 'tp3d-ip-fill-pct--warn' : 'tp3d-ip-fill-pct--ok';
      fillPctLabel.textContent = fillPct + '%';
      fillHeader.appendChild(fillLabel);
      fillHeader.appendChild(fillPctLabel);

      const fillBar = doc.createElement('div');
      fillBar.className = 'tp3d-ip-fill-track';
      const fillBarInner = doc.createElement('div');
      fillBarInner.className = 'tp3d-ip-fill-bar' + (fillPct >= 90 ? ' tp3d-ip-fill-bar--warn' : '');
      fillBarInner.style.width = fillPct + '%';
      fillBar.appendChild(fillBarInner);

      const fillNote = doc.createElement('div');
      fillNote.className = 'muted tp3d-ip-fill-note';
      if (Number.isFinite(truckVolIn3) && truckVolIn3 > 0) {
        const truckM3 = (truckVolIn3 * Math.pow(0.0254, 3)).toFixed(0);
        fillNote.textContent = fillPct >= 90
          ? 'Estimated load fills ~' + fillPct + '% of the ' + truckM3 + ' m³ trailer — little room to spare.'
          : 'Cases occupy roughly ' + fillPct + '% of the ' + truckM3 + ' m³ trailer.';
      }

      fillSection.appendChild(fillHeader);
      fillSection.appendChild(fillBar);
      if (fillNote.textContent) fillSection.appendChild(fillNote);
      packSummary.appendChild(fillSection);
    }

    // ── Render cases table ────────────────────────────────────────────────
    function renderCasesTable(pack, bundledCases) {
      tbody.textContent = '';
      const bundledById = new Map((bundledCases || []).map(c => [c.id, c]));
      const instances = pack.cases || [];
      casesCount.textContent = instances.length + ' case' + (instances.length !== 1 ? 's' : '');

      if (instances.length === 0) {
        const tr = doc.createElement('tr');
        const td = doc.createElement('td');
        td.colSpan = 5;
        td.className = 'tp3d-ic-empty-row';
        td.textContent = 'No cases in this pack';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      let unresolvedCount = 0;
      instances.forEach(inst => {
        const def = bundledById.get(inst.caseId);
        const hasDef = Boolean(def);
        if (!hasDef) unresolvedCount++;
        const dims = (def && def.dimensions) || {};

        const tr = doc.createElement('tr');
        tr.className = 'tp3d-ic-row tp3d-ic-row--valid';

        // Status cell
        const statusTd = doc.createElement('td');
        statusTd.className = 'tp3d-ic-td-status';
        const statusCircle = doc.createElement('span');
        statusCircle.className = 'tp3d-ic-status-circle tp3d-ic-status-circle--' + (hasDef ? 'success' : 'muted');
        const statusIcon = doc.createElement('i');
        statusIcon.className = hasDef ? 'fa-solid fa-check' : 'fa-solid fa-minus';
        statusCircle.appendChild(statusIcon);
        statusTd.appendChild(statusCircle);

        // Name cell
        const nameTd = doc.createElement('td');
        nameTd.className = 'tp3d-ic-td-name';
        const nameSpan = doc.createElement('span');
        if (hasDef) {
          nameSpan.textContent = def.name || '—';
        } else {
          nameSpan.className = 'muted';
          nameSpan.textContent = inst.caseId || '—';
        }
        nameTd.appendChild(nameSpan);

        // Dimensions cell
        const dimTd = doc.createElement('td');
        dimTd.className = 'tp3d-ic-td-dim';
        dimTd.textContent = (hasDef && dims.length && Utils && Utils.formatDims)
          ? Utils.formatDims(dims, 'm')
          : (hasDef && dims.length
              ? (dims.length + ' × ' + dims.width + ' × ' + dims.height)
              : '—');

        // Weight cell
        const wtTd = doc.createElement('td');
        wtTd.className = 'tp3d-ic-td-weight';
        if (hasDef) {
          const wt = Number(def.weight);
          wtTd.textContent = Number.isFinite(wt) && wt > 0
            ? ((Utils && Utils.formatWeight) ? Utils.formatWeight(wt, 'lb', 0) : wt + ' lb')
            : '—';
        } else {
          wtTd.textContent = '—';
        }

        // Category cell
        const catTd = doc.createElement('td');
        catTd.className = 'tp3d-ic-td-cat';
        if (hasDef) {
          const catName = def.category || 'default';
          const catDot = doc.createElement('span');
          catDot.className = 'tp3d-ic-cat-dot';
          // Derive color from category key — minimal inline style for dot only
          catDot.style.background = getCategoryColor(catName);
          catTd.appendChild(catDot);
          catTd.appendChild(doc.createTextNode(catName.charAt(0).toUpperCase() + catName.slice(1)));
        } else {
          catTd.textContent = '—';
        }

        tr.appendChild(statusTd);
        tr.appendChild(nameTd);
        tr.appendChild(dimTd);
        tr.appendChild(wtTd);
        tr.appendChild(catTd);
        tbody.appendChild(tr);
      });

      // Footer note when case definitions are not bundled in the file
      if (unresolvedCount > 0) {
        const noteRow = doc.createElement('tr');
        const noteTd = doc.createElement('td');
        noteTd.colSpan = 5;
        noteTd.className = 'tp3d-ic-empty-row';
        noteTd.textContent = unresolvedCount === instances.length
          ? 'Case definitions not bundled — pack will reference your local case library on import'
          : unresolvedCount + ' case' + (unresolvedCount !== 1 ? 's' : '') +
            ' not bundled — will reference local library';
        noteRow.appendChild(noteTd);
        tbody.appendChild(noteRow);
      }
    }

    // ── Render batch list ─────────────────────────────────────────────────
    function renderBatchList(payloads) {
      batchTbody.textContent = '';
      batchStats.textContent = '';

      let validCount = 0;
      let skippedCount = 0;
      const rows = payloads.map(payload => {
        if (!payload) return { valid: false, payload, reason: 'Invalid entry' };
        try {
          const p = payload.pack;
          if (!p || !p.truck || !Array.isArray(p.cases)) {
            return { valid: false, payload, reason: 'Missing truck or cases' };
          }
          const tL = Number(p.truck.length);
          const tW = Number(p.truck.width);
          const tH = Number(p.truck.height);
          if (!Number.isFinite(tL) || tL <= 0 || !Number.isFinite(tW) || tW <= 0 || !Number.isFinite(tH) || tH <= 0) {
            return { valid: false, payload, reason: 'Invalid truck dimensions' };
          }
          validCount++;
          return { valid: true, payload };
        } catch (err) {
          skippedCount++;
          return { valid: false, payload, reason: (err && err.message) || 'Invalid' };
        }
      });
      skippedCount = rows.filter(r => !r.valid).length;
      validCount = rows.filter(r => r.valid).length;

      // Stat cards
      [
        { dotClass: 'tp3d-ic-dot--success', count: validCount, label: 'Valid packs' },
        { dotClass: 'tp3d-ic-dot--error', count: skippedCount, label: 'Skipped' },
      ].forEach(({ dotClass, count, label }) => {
        const card = doc.createElement('div');
        card.className = 'card tp3d-ic-stat';

        const countRow = doc.createElement('div');
        countRow.className = 'tp3d-ic-stat-count';
        const dot = doc.createElement('span');
        dot.className = 'tp3d-ic-stat-dot ' + dotClass;
        const num = doc.createElement('span');
        num.className = 'tp3d-ic-stat-num';
        num.textContent = String(count);
        countRow.appendChild(dot);
        countRow.appendChild(num);

        const lbl = doc.createElement('div');
        lbl.className = 'tp3d-ic-stat-label muted';
        lbl.textContent = label;

        card.appendChild(countRow);
        card.appendChild(lbl);
        batchStats.appendChild(card);
      });

      batchListCount.textContent = rows.length + ' pack' + (rows.length !== 1 ? 's' : '');

      rows.forEach(({ valid, payload: p, reason }) => {
        const pack = (p && p.pack) || {};
        const truck = pack.truck || {};
        const caseCount = Array.isArray(pack.cases) ? pack.cases.length : '?';

        const tr = doc.createElement('tr');
        tr.className = 'tp3d-ic-row ' + (valid ? 'tp3d-ic-row--valid' : 'tp3d-ic-row--invalid');

        // Status
        const statusTd = doc.createElement('td');
        statusTd.className = 'tp3d-ic-td-status';
        const circle = doc.createElement('span');
        circle.className = valid
          ? 'tp3d-ic-status-circle tp3d-ic-status-circle--success'
          : 'tp3d-ic-status-circle tp3d-ic-status-circle--error';
        const icon = doc.createElement('i');
        icon.className = valid ? 'fa-solid fa-check' : 'fa-solid fa-xmark';
        circle.appendChild(icon);
        statusTd.appendChild(circle);

        // Title
        const titleTd = doc.createElement('td');
        titleTd.className = 'tp3d-ic-td-name';
        const titleSpan = doc.createElement('span');
        titleSpan.textContent = pack.title || '(untitled)';
        titleTd.appendChild(titleSpan);
        if (!valid && reason) {
          const reasonDiv = doc.createElement('div');
          reasonDiv.className = 'tp3d-ic-row-reason';
          const warnIcon = doc.createElement('i');
          warnIcon.className = 'fa-solid fa-triangle-exclamation';
          reasonDiv.appendChild(warnIcon);
          reasonDiv.appendChild(doc.createTextNode(' ' + reason));
          titleTd.appendChild(reasonDiv);
        }

        // Truck
        const truckTd = doc.createElement('td');
        truckTd.className = 'tp3d-ic-td-dim';
        truckTd.textContent = (Utils && Utils.formatDims && truck.length)
          ? Utils.formatDims(truck, 'm')
          : ((truck.length || '?') + ' × ' + (truck.width || '?') + ' × ' + (truck.height || '?'));

        // Cases
        const casesTd = doc.createElement('td');
        casesTd.className = 'tp3d-ic-td-weight';
        casesTd.textContent = valid ? String(caseCount) : '—';

        tr.appendChild(statusTd);
        tr.appendChild(titleTd);
        tr.appendChild(truckTd);
        tr.appendChild(casesTd);
        batchTbody.appendChild(tr);
      });

      return { validCount, skippedCount };
    }

    // ── Inline error card ─────────────────────────────────────────────────
    function renderError(message) {
      errorArea.textContent = '';
      const card = doc.createElement('div');
      card.className = 'tp3d-ip-error-card';

      const iconEl = doc.createElement('span');
      iconEl.className = 'tp3d-ip-error-icon';
      iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';

      const body = doc.createElement('div');
      body.className = 'tp3d-ip-error-body';

      const heading = doc.createElement('div');
      heading.className = 'tp3d-ip-error-heading';
      heading.textContent = 'Import error';

      const text = doc.createElement('div');
      text.className = 'tp3d-ip-error-text';
      text.textContent = message || 'Unknown error';

      body.appendChild(heading);
      body.appendChild(text);
      card.appendChild(iconEl);
      card.appendChild(body);
      errorArea.appendChild(card);
    }

    // ── File handler ──────────────────────────────────────────────────────
    async function handleFile(file) {
      if (!file) return;

      // Show file chip immediately with filename
      fileChipName.textContent = file.name;
      const kb = Math.round((file.size / 1024) * 10) / 10;
      fileChipMeta.textContent = kb + ' KB · reading…';

      parsingName.textContent = 'Reading ' + file.name + '…';
      showState('parsing');

      let text = '';
      try {
        text = await file.text();
      } catch (err) {
        showState('dropzone');
        UIComponents.showToast('Could not read file: ' + (err && err.message), 'error');
        return;
      }

      // App JSON guard
      try {
        const peek = Utils && Utils.safeJsonParse
          ? Utils.safeJsonParse(text, null)
          : JSON.parse(text);
        if (peek && typeof peek === 'object' &&
            (Array.isArray(peek.packLibrary) || Array.isArray(peek.caseLibrary) || peek.preferences ||
             peek.exportType === 'app-backup')) {
          showState('dropzone');
          UIComponents.showToast('This looks like App JSON. Use Import App JSON instead.', 'warning');
          return;
        }

        // Batch detection
        if (peek && typeof peek === 'object' && peek.exportType === 'pack-batch') {
          let payloads;
          try {
            payloads = ImportExport.parsePackBatchImportJSON(text);
          } catch (err) {
            fileChipMeta.textContent = kb + ' KB · parsed just now';
            renderError(err && err.message);
            parsedPayload = null;
            showState('error');
            updateFooter();
            return;
          }
          const { validCount, skippedCount } = renderBatchList(payloads);
          fileChipMeta.textContent =
            payloads.length + ' pack' + (payloads.length !== 1 ? 's' : '') +
            ' · ' + kb + ' KB · parsed just now';
          parsedPayload = { type: 'batch', payloads, valid: validCount, skipped: skippedCount, file };
          showState('batch');
          updateFooter();
          return;
        }
      } catch {
        // Fall through to single-pack parsing
      }

      // Single-pack path
      try {
        const payload = ImportExport.parsePackImportJSON(text);
        const pack = payload.pack;
        const bundledCases = Array.isArray(payload.bundledCases) ? payload.bundledCases : [];

        if (!pack || !pack.truck || !Array.isArray(pack.cases)) {
          throw new Error('Invalid pack format — missing truck or cases list.');
        }
        const truckL = Number(pack.truck.length);
        const truckW = Number(pack.truck.width);
        const truckH = Number(pack.truck.height);
        if (!Number.isFinite(truckL) || truckL <= 0 ||
            !Number.isFinite(truckW) || truckW <= 0 ||
            !Number.isFinite(truckH) || truckH <= 0) {
          throw new Error('Invalid pack — truck dimensions must be positive numbers.');
        }

        const caseCount = pack.cases.length;
        fileChipMeta.textContent =
          caseCount + ' case' + (caseCount !== 1 ? 's' : '') +
          ' · ' + kb + ' KB · parsed just now';

        parsedPayload = { type: 'single', payload, file };

        renderPackSummary(pack, bundledCases);
        renderCasesTable(pack, bundledCases);
        showState('single');
        updateFooter();
      } catch (err) {
        fileChipMeta.textContent = kb + ' KB · parsed just now';
        renderError(err && err.message);
        parsedPayload = null;
        showState('error');
        updateFooter();
      }
    }

    // ── Import ────────────────────────────────────────────────────────────
    function doImport() {
      if (!parsedPayload) return;

      if (parsedPayload.type === 'single') {
        try {
          PackLibrary.importPackPayload(parsedPayload.payload);
          UIComponents.showToast('Pack imported successfully', 'success');
          modalObj.close();
        } catch (err) {
          UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
        }
        return;
      }

      // Batch
      let imported = 0;
      let skipped = 0;
      (parsedPayload.payloads || []).forEach(payload => {
        try {
          PackLibrary.importPackPayload(payload);
          imported++;
        } catch {
          skipped++;
        }
      });
      const msg = skipped > 0
        ? 'Imported ' + imported + ' pack' + (imported !== 1 ? 's' : '') + ' · ' + skipped + ' skipped'
        : 'Imported ' + imported + ' pack' + (imported !== 1 ? 's' : '');
      UIComponents.showToast(msg, imported > 0 ? 'success' : 'warning');
      // Do not auto-close after batch — user reviews summary
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION: helpers
  // ---------------------------------------------------------------------------

  function getCategoryColor(key) {
    const colors = {
      audio: '#3b82f6',
      rigging: '#8b5cf6',
      lighting: '#f97316',
      backline: '#ec4899',
      video: '#06b6d4',
      staging: '#84cc16',
      default: '#9ca3af',
    };
    return colors[String(key || '').toLowerCase()] || colors.default;
  }

  // ---------------------------------------------------------------------------
  // SECTION: init()
  // ---------------------------------------------------------------------------

  function init() {
    // No-op.
  }

  return { init, open };
}
