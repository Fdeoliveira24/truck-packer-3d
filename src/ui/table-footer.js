/**
 * @file table-footer.js
 * @description Table footer UI helper for pagination and row-count controls.
 * @module ui/table-footer
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

const ROW_OPTIONS = [10, 25, 50, 100];
const DEFAULT_ROWS_PER_PAGE = 50;

function normalizeRowsPerPage(value) {
  const num = Number(value) || DEFAULT_ROWS_PER_PAGE;
  return ROW_OPTIONS.includes(num) ? num : DEFAULT_ROWS_PER_PAGE;
}

function removeExistingFooter(mountEl) {
  const children = Array.from(mountEl.children || []);
  const existing = children.find(child => child.classList && child.classList.contains('table-footer'));
  if (existing) existing.remove();
}

function createButton(iconClass, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tf-btn';
  btn.setAttribute('aria-label', label);
  const icon = document.createElement('i');
  icon.className = `fa-solid ${iconClass}`;
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);
  return btn;
}

export function createTableFooter(options = {}) {
  const { mountEl, onPageChange = () => {}, onRowsPerPageChange = () => {}, onSelectAllToggle = () => {} } = options;
  if (!mountEl) {
    return {
      setState: () => {},
      destroy: () => {},
    };
  }

  removeExistingFooter(mountEl);

  const footerEl = document.createElement('div');
  footerEl.className = 'table-footer';
  footerEl.classList.add('is-sticky');

  const leftEl = document.createElement('div');
  leftEl.className = 'tf-left';
  const selectAllWrap = document.createElement('span');
  const selectAllInput = document.createElement('input');
  selectAllInput.type = 'checkbox';
  selectAllInput.setAttribute('aria-label', 'Select all rows');
  selectAllWrap.appendChild(selectAllInput);
  const selectAllLabel = document.createElement('span');
  selectAllLabel.className = 'tf-label';
  selectAllLabel.textContent = 'Select all';
  const leftText = document.createElement('span');
  leftText.textContent = '0 of 0 row(s) selected.';
  leftEl.appendChild(selectAllWrap);
  leftEl.appendChild(selectAllLabel);
  leftEl.appendChild(leftText);

  const midEl = document.createElement('div');
  midEl.className = 'tf-mid';
  const rowsLabel = document.createElement('span');
  rowsLabel.className = 'tf-label';
  rowsLabel.textContent = 'Rows per page';
  const selectEl = document.createElement('select');
  selectEl.className = 'tf-select';
  selectEl.setAttribute('aria-label', 'Rows per page');
  ROW_OPTIONS.forEach(value => {
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = value;
    selectEl.appendChild(opt);
  });
  selectEl.value = String(DEFAULT_ROWS_PER_PAGE);
  const pageLabel = document.createElement('span');
  pageLabel.className = 'tf-page';
  pageLabel.textContent = 'Page 1 of 1';
  midEl.appendChild(rowsLabel);
  midEl.appendChild(selectEl);
  midEl.appendChild(pageLabel);

  const rightEl = document.createElement('div');
  rightEl.className = 'tf-right';
  const btnFirst = createButton('fa-angles-left', 'First page');
  const btnPrev = createButton('fa-angle-left', 'Previous page');
  const btnNext = createButton('fa-angle-right', 'Next page');
  const btnLast = createButton('fa-angles-right', 'Last page');
  rightEl.appendChild(btnFirst);
  rightEl.appendChild(btnPrev);
  rightEl.appendChild(btnNext);
  rightEl.appendChild(btnLast);

  footerEl.appendChild(leftEl);
  footerEl.appendChild(midEl);
  footerEl.appendChild(rightEl);
  mountEl.appendChild(footerEl);

  let state = {
    selectedCount: 0,
    totalCount: 0,
    pageIndex: 0,
    pageCount: 0,
    rowsPerPage: DEFAULT_ROWS_PER_PAGE,
    selectAllVisible: false,
    selectAllChecked: false,
    selectAllIndeterminate: false,
  };

  const render = () => {
    const {
      selectedCount,
      totalCount,
      pageIndex,
      pageCount,
      rowsPerPage,
      selectAllVisible,
      selectAllChecked,
      selectAllIndeterminate,
    } = state;
    const showSummary = (selectedCount === totalCount || selectAllChecked) && totalCount > 0;
    leftText.textContent = `${selectedCount} of ${totalCount} row(s) selected.`;
    leftText.hidden = !showSummary;
    selectAllWrap.hidden = !selectAllVisible;
    selectAllLabel.hidden = !selectAllVisible || selectAllChecked;
    selectAllInput.disabled = !selectAllVisible || totalCount === 0;
    selectAllInput.checked = Boolean(selectAllChecked);
    selectAllInput.indeterminate = Boolean(selectAllIndeterminate) && !selectAllChecked;
    if (selectEl.value !== String(rowsPerPage)) {
      selectEl.value = String(rowsPerPage);
    }
    const safePageCount = Math.max(0, pageCount);
    const displayIndex = safePageCount === 0 ? 0 : pageIndex + 1;
    pageLabel.textContent = `Page ${displayIndex} of ${safePageCount}`;
    const disableBack = safePageCount <= 1 || pageIndex <= 0;
    const disableForward = safePageCount <= 1 || pageIndex >= safePageCount - 1;
    btnFirst.disabled = disableBack;
    btnPrev.disabled = disableBack;
    btnNext.disabled = disableForward;
    btnLast.disabled = disableForward;
  };

  const handleSelectChange = event => {
    const nextRows = normalizeRowsPerPage(event.target.value);
    if (nextRows === state.rowsPerPage) return;
    state = { ...state, rowsPerPage: nextRows, pageIndex: 0 };
    render();
    onRowsPerPageChange(nextRows);
  };

  const goToPage = nextPage => {
    const safePageCount = Math.max(0, state.pageCount);
    const clampedIndex = Math.min(Math.max(0, Number(nextPage) || 0), Math.max(0, safePageCount - 1));
    if (clampedIndex === state.pageIndex) {
      render();
      return;
    }
    state = { ...state, pageIndex: clampedIndex };
    render();
    onPageChange({ pageIndex: clampedIndex, rowsPerPage: state.rowsPerPage });
  };

  const handleFirst = () => goToPage(0);
  const handlePrev = () => goToPage(state.pageIndex - 1);
  const handleNext = () => goToPage(state.pageIndex + 1);
  const handleLast = () => goToPage(state.pageCount - 1);
  const handleToggleSelectAll = () => {
    onSelectAllToggle(selectAllInput.checked);
  };

  selectEl.addEventListener('change', handleSelectChange);
  btnFirst.addEventListener('click', handleFirst);
  btnPrev.addEventListener('click', handlePrev);
  btnNext.addEventListener('click', handleNext);
  btnLast.addEventListener('click', handleLast);
  selectAllInput.addEventListener('change', handleToggleSelectAll);

  const setState = nextState => {
    const merged = { ...state, ...nextState };
    const sanitized = {
      selectedCount: Math.max(0, Number(merged.selectedCount) || 0),
      totalCount: Math.max(0, Number(merged.totalCount) || 0),
      rowsPerPage: normalizeRowsPerPage(merged.rowsPerPage),
      pageCount: Math.max(0, Number(merged.pageCount) || 0),
      pageIndex: Number(merged.pageIndex) || 0,
      selectAllVisible: Boolean(merged.selectAllVisible),
      selectAllChecked: Boolean(merged.selectAllChecked),
      selectAllIndeterminate: Boolean(merged.selectAllIndeterminate),
    };
    if (sanitized.totalCount === 0) {
      sanitized.selectAllChecked = false;
      sanitized.selectAllIndeterminate = false;
    }
    if (sanitized.pageCount === 0) {
      sanitized.pageIndex = 0;
    } else {
      sanitized.pageIndex = Math.min(Math.max(0, sanitized.pageIndex), sanitized.pageCount - 1);
    }
    state = sanitized;
    // Hide footer ONLY when there are 0 or 1 items total
    // Show for 2+ items even if it's a single page
    const shouldHide = state.totalCount <= 1;
    footerEl.classList.toggle('is-hidden', shouldHide);
    render();
  };

  const destroy = () => {
    selectEl.removeEventListener('change', handleSelectChange);
    btnFirst.removeEventListener('click', handleFirst);
    btnPrev.removeEventListener('click', handlePrev);
    btnNext.removeEventListener('click', handleNext);
    btnLast.removeEventListener('click', handleLast);
    selectAllInput.removeEventListener('change', handleToggleSelectAll);
    footerEl.remove();
  };

  // Initialize UI with defaults
  render();

  return { setState, destroy };
}
