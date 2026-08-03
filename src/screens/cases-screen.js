/**
 * @file cases-screen.js
 * @description Screen factory responsible for rendering and binding UI for a specific screen.
 * @module screens/cases-screen
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Cases screen (extracted from src/app.js; behavior preserved)

import { openCaseModal as openSharedCaseModal } from '../ui/overlays/case-modal.js';
import { openNotesOverlay } from '../ui/overlays/notes-overlay.js';
import { getCaseHandlingSummary } from '../services/case-rule-summary.js';
import { compareBusinessIdentityValues } from '../core/business-identity.js';
import { getStorageScope, getWorkspaceScope } from '../core/storage.js';

export function createCasesScreen({
  Utils,
  UIComponents,
  PreferencesManager,
  CaseLibrary,
  PackLibrary,
  CategoryService,
  StateStore,
  ImportExport,
  ImportCasesDialog,
  createTableFooter,
  CardDisplayOverlay,
  OperationLifecycle,
}) {
  const CasesUI = (() => {
    const searchEl = /** @type {HTMLInputElement} */ (document.getElementById('cases-search'));
    const searchClearEl = /** @type {HTMLButtonElement} */ (document.getElementById('cases-search-clear'));
    const filtersEl = /** @type {HTMLElement} */ (document.getElementById('cases-filters'));
    const gridEl = /** @type {HTMLElement} */ (document.getElementById('cases-grid'));
    const tbodyEl = /** @type {HTMLElement} */ (document.getElementById('cases-tbody'));
    const emptyEl = /** @type {HTMLElement} */ (document.getElementById('cases-empty'));
    const selectAllEl = /** @type {HTMLInputElement} */ (document.getElementById('cases-select-all'));
    const btnNew = document.getElementById('btn-new-case');
    const btnTemplate = document.getElementById('btn-cases-template');
    const btnImport = document.getElementById('btn-cases-import');
    const btnManageCats = document.getElementById('btn-manage-categories');
    const btnViewGrid = document.getElementById('cases-view-grid');
    const btnViewList = document.getElementById('cases-view-list');
    const btnSort = document.getElementById('cases-sort');
    const btnFiltersToggle = document.getElementById('cases-filters-toggle');
    const btnCardDisplay = document.getElementById('cases-card-display');
    const actionsDefaultEl = document.getElementById('cases-actions-default');
    const actionsBulkEl = document.getElementById('cases-actions-bulk');
    const selectedCountEl = document.getElementById('cases-selected-count');
    const btnBulkDelete = document.getElementById('btn-cases-bulk-delete');

    const activeCategories = new Set(); // empty = all
    const sortOptions = [
      { key: 'name', label: 'Name' },
      { key: 'itemCode', label: 'Item Code' },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'length', label: 'Length' },
      { key: 'width', label: 'Width' },
      { key: 'height', label: 'Height' },
      { key: 'volume', label: 'Volume' },
      { key: 'weight', label: 'Weight' },
      { key: 'category', label: 'Category' },
      { key: 'quantity', label: 'Quantity' },
    ];
    let sortBy = 'name'; // name, itemCode, manufacturer, dimensions, volume, weight, category
    let sortDir = 'asc'; // asc or desc
    const selectedIds = new Set();
    let lastDatasetKey = '';
    let lastVisibleIds = [];
    const casesTableWrap = /** @type {HTMLElement} */ (document.querySelector('#screen-cases .table-wrap'));
    const casesListState = {
      pageIndex: 0,
      rowsPerPage: 50,
    };
    let casesFooterController = null;
    let casesFooterMountEl = null;
    let lastCasePageMeta = null;
    let filteredCases = [];
    let filtersOutsideClickHandler = null;
    let toolbarDropdownCoordinatorInitialized = false;

    function mutationBlockedWhileBusy({ notify = true } = {}) {
      if (!OperationLifecycle || typeof OperationLifecycle.isBusy !== 'function' || !OperationLifecycle.isBusy()) {
        return false;
      }
      if (notify) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Cases' });
      }
      return true;
    }

    const beforeMutate = () => !mutationBlockedWhileBusy();

    function getManagementNotesContext() {
      return `${getStorageScope()}|${getWorkspaceScope()}`;
    }

    function createManagementIdentityChip(text, accessibleLabel) {
      const identityChip = document.createElement('div');
      identityChip.className = 'badge tp3d-management-identity-chip';
      identityChip.setAttribute('aria-label', accessibleLabel);
      const chipText = document.createElement('span');
      chipText.className = 'tp3d-management-identity-chip__text';
      chipText.textContent = text;
      identityChip.appendChild(chipText);
      return identityChip;
    }

    function openCaseManagementNotes(caseItem, trigger) {
      const capturedContext = getManagementNotesContext();
      openNotesOverlay({
        UIComponents,
        entityType: 'case',
        entityId: caseItem.id,
        capturedContext,
        getCurrentContext: getManagementNotesContext,
        resolveEntity: ({ entityId }) => CaseLibrary.getById(entityId),
        readNote: entity => entity.notes,
        saveNote: ({ entity, value }) => {
          const notes = value === null ? null : String(value || '').trim() || null;
          CaseLibrary.upsert({ ...entity, notes });
          return CaseLibrary.getById(entity.id);
        },
        clearValue: null,
        title: 'Notes',
        subtitle: entity => entity.name || 'Case',
        fieldLabel: 'Case Instructions/Notes',
        emptyText: 'No case instructions/notes yet.',
        placeholder: 'Add case instructions or notes…',
        mutationGuard: () => !mutationBlockedWhileBusy(),
        getLastEdited: entity => entity.updatedAt,
        onSaved: () => render(),
        trigger,
        missingMessage: 'This case no longer exists.',
        contextMessage: 'The active workspace changed. Reopen Notes to continue.',
      });
    }

    function createCaseNotesButton(caseItem) {
      const caseName = caseItem.name || 'Case';
      const hasNotes = Boolean(String(caseItem.notes || '').trim());
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost tp3d-management-notes-btn';
      btn.setAttribute('data-case-notes', '1');
      btn.setAttribute('data-notes-entity-type', 'case');
      btn.setAttribute('data-notes-entity-id', caseItem.id);
      btn.setAttribute('data-tooltip', 'Notes');
      btn.setAttribute('aria-label', hasNotes
        ? `Open notes for ${caseName}, notes available`
        : `Open notes for ${caseName}`);
      btn.innerHTML = '<i class="fa-regular fa-file-lines" aria-hidden="true"></i>';
      if (hasNotes) {
        const indicator = document.createElement('span');
        indicator.className = 'tp3d-notes-indicator-dot';
        indicator.setAttribute('aria-hidden', 'true');
        btn.appendChild(indicator);
      }
      btn.addEventListener('keydown', ev => ev.stopPropagation());
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        openCaseManagementNotes(caseItem, btn);
      });
      return btn;
    }

    function initCasesUI() {
      searchEl.addEventListener(
        'input',
        (() => {
          const renderSearch = Utils.debounce(() => {
            casesListState.pageIndex = 0;
            render();
          }, 300);
          return () => {
            updateSearchClearVisibility();
            renderSearch();
          };
        })()
      );
      searchEl.addEventListener('keydown', ev => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        if (searchEl.value) clearSearch();
      });
      searchClearEl.addEventListener('click', clearSearch);
      updateSearchClearVisibility();
      btnNew.addEventListener('click', () => openCaseModal(null));
      btnTemplate.addEventListener('click', () => ImportExport.downloadCasesTemplate());
      btnImport.addEventListener('click', () => {
        if (mutationBlockedWhileBusy()) return;
        if (ImportCasesDialog && ImportCasesDialog.open) {
          ImportCasesDialog.open({ beforeMutate });
        }
      });
      btnManageCats &&
        btnManageCats.addEventListener('click', ev => {
          ev.stopPropagation();
          toggleCategoriesPopover(btnManageCats);
        });
      btnViewGrid && btnViewGrid.addEventListener('click', () => setViewMode('grid'));
      btnViewList && btnViewList.addEventListener('click', () => setViewMode('list'));
      btnSort &&
        btnSort.addEventListener('click', ev => {
          ev.stopPropagation();
          openSortMenu(btnSort);
        });
      btnFiltersToggle && btnFiltersToggle.addEventListener('click', ev => { ev.stopPropagation(); toggleFiltersVisible(); });

      btnCardDisplay &&
        btnCardDisplay.addEventListener('click', () => {
          // TODO: Add keyboard shortcut + update Keyboard Shortcuts modal later
          CardDisplayOverlay.open({ screen: 'cases' });
        });
      btnBulkDelete.addEventListener('click', () => bulkDeleteSelected());
      selectAllEl.addEventListener('change', () => toggleAllVisible(selectAllEl.checked));
      initToolbarDropdownCoordinator();
      initTableHeaders();
      updateViewButtons();
      applyFiltersVisibility();
    }

    function getCasesFooterMountElForMode(_mode) {
      // Footer must be appended directly to #screen-cases to match CSS selector
      return document.getElementById('screen-cases');
    }

    function setViewMode(mode) {
      const nextMode = mode === 'grid' ? 'grid' : 'list';
      UIComponents.closeAllDropdowns();
      const prefs = PreferencesManager.get();
      prefs.casesViewMode = nextMode;
      PreferencesManager.set(prefs);
      updateViewButtons(nextMode);
      render(nextMode);
    }

    function updateViewButtons(modeOverride) {
      const mode = modeOverride === 'grid' || modeOverride === 'list'
        ? modeOverride
        : PreferencesManager.get().casesViewMode || 'list';
      btnViewGrid && btnViewGrid.classList.toggle('btn-primary', mode === 'grid');
      btnViewList && btnViewList.classList.toggle('btn-primary', mode === 'list');
    }

    function toggleFiltersVisible() {
      const shouldOpen = PreferencesManager.get().casesFiltersVisible !== true;
      UIComponents.closeAllDropdowns();
      if (!shouldOpen) return;
      setFiltersVisible(true);
    }

    function setFiltersVisible(visible) {
      const prefs = PreferencesManager.get();
      if ((prefs.casesFiltersVisible === true) !== Boolean(visible)) {
        prefs.casesFiltersVisible = Boolean(visible);
        PreferencesManager.set(prefs);
      }
      applyFiltersVisibility();
    }

    function initToolbarDropdownCoordinator() {
      if (toolbarDropdownCoordinatorInitialized) return;
      toolbarDropdownCoordinatorInitialized = true;
      UIComponents.registerDropdownSurface({
        isOpen: () => PreferencesManager.get().casesFiltersVisible === true,
        close: () => setFiltersVisible(false),
        getAnchor: () => btnFiltersToggle,
      });
      StateStore.subscribe(changes => {
        if (changes && Object.prototype.hasOwnProperty.call(changes, 'currentScreen')) {
          UIComponents.closeAllDropdowns();
        }
      });
    }

    function applyFiltersVisibility() {
      if (!filtersEl) return;
      const visible = PreferencesManager.get().casesFiltersVisible === true;
      filtersEl.classList.toggle('is-open', visible);
      btnFiltersToggle && btnFiltersToggle.classList.toggle('btn-primary', visible);
      btnFiltersToggle && btnFiltersToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
      if (filtersOutsideClickHandler) {
        document.removeEventListener('click', filtersOutsideClickHandler);
        filtersOutsideClickHandler = null;
      }
      if (visible) {
        filtersOutsideClickHandler = function(ev) {
          const anchor = filtersEl.closest('.tp3d-cases-filter-anchor');
          if (!anchor || !anchor.contains(/** @type {Node} */ (ev.target))) {
            setFiltersVisible(false);
          }
        };
        setTimeout(() => {
          if (filtersOutsideClickHandler) document.addEventListener('click', filtersOutsideClickHandler);
        }, 0);
      }
    }

    function clearSelection() {
      selectedIds.clear();
    }

    function toggleAllVisible(checked) {
      applySelectAllFiltered(checked);
    }

    function applySelectAllFiltered(shouldSelect) {
      selectedIds.clear();
      if (shouldSelect) {
        const ids = Array.isArray(filteredCases) ? filteredCases.map(c => c.id) : [];
        ids.forEach(id => selectedIds.add(id));
      }
      render();
    }

    function updateSelectionUI(visibleIds) {
      lastVisibleIds = visibleIds || [];
      const visibleCount = lastVisibleIds.length;

      // Selected count is based on the current visible dataset after search/sort/category.
      const filteredVisible = new Set(filteredCases.map(c => c.id));
      Array.from(selectedIds).forEach(id => {
        if (!filteredVisible.has(id)) selectedIds.delete(id);
      });
      const selectedCount = selectedIds.size;

      actionsDefaultEl.style.display = selectedCount ? 'none' : 'flex';
      actionsBulkEl.style.display = selectedCount ? 'flex' : 'none';
      if (btnNew) btnNew.style.display = selectedCount ? 'none' : 'inline-flex';
      selectedCountEl.textContent = `${selectedCount} of ${visibleCount} row(s) selected.`;
      btnBulkDelete.innerHTML = `<i class="fa-solid fa-trash"></i> Delete (${selectedCount})`;

      if (!visibleCount) {
        selectAllEl.checked = false;
        selectAllEl.indeterminate = false;
        selectAllEl.disabled = true;
        return;
      }

      selectAllEl.disabled = false;
      const allSelected = lastVisibleIds.every(id => selectedIds.has(id));
      const someSelected = lastVisibleIds.some(id => selectedIds.has(id));
      selectAllEl.checked = allSelected;
      selectAllEl.indeterminate = !allSelected && someSelected;
    }

    async function bulkDeleteSelected() {
      const ids = Array.from(selectedIds);
      const count = ids.length;
      if (!count) return;
      if (mutationBlockedWhileBusy()) return;

      const ok = await UIComponents.confirm({
        title: 'Delete cases?',
        message: `This will permanently delete ${count} case(s). This cannot be undone.`,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;
      if (mutationBlockedWhileBusy()) return;

      const idSet = new Set(ids);
      const nextCaseLibrary = CaseLibrary.getCases().filter(c => !idSet.has(c.id));
      const nextPackLibrary = PackLibrary.getPacks().map(p => {
        const prevCases = Array.isArray(p.cases) ? p.cases : [];
        const nextCases = prevCases.filter(i => !idSet.has(i.caseId));
        if (nextCases.length === prevCases.length) return p;
        const next = { ...p, cases: nextCases, lastEdited: Date.now() };
        next.stats = PackLibrary.computeStats(next);
        return next;
      });

      StateStore.set({ caseLibrary: nextCaseLibrary, packLibrary: nextPackLibrary });
      clearSelection();
      render();
      UIComponents.showToast(`Deleted ${count} case(s).`, 'info');
    }

    function initTableHeaders() {
      const headers = document.querySelectorAll('#screen-cases table thead th[data-sort]');
      headers.forEach(th => {
        const sortControl = th.querySelector('.th-sort');
        if (!sortControl) return;
        const toggleSort = () => {
          const sortField = th.getAttribute('data-sort');
          if (sortBy === sortField) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortBy = sortField;
            sortDir = 'asc';
          }
          casesListState.pageIndex = 0;
          render();
          updateHeaderIcons();
        };
        sortControl.addEventListener('click', toggleSort);
        sortControl.addEventListener(
          'keydown',
          /** @param {KeyboardEvent} ev */ ev => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              toggleSort();
            }
          }
        );
      });
      updateHeaderIcons();
    }

    function setSort(sortField, direction, { resetDirection = false } = {}) {
      const field = sortOptions.some(option => option.key === sortField) ? sortField : 'name';
      sortBy = field;
      sortDir = resetDirection ? 'asc' : direction === 'desc' ? 'desc' : 'asc';
      casesListState.pageIndex = 0;
      render();
      updateHeaderIcons();
    }

    function openSortMenu(anchorEl) {
      if (!anchorEl) return;
      const items = [
        { type: 'header', label: 'Sort Cases' },
        ...sortOptions.map(option => ({
          label: option.label,
          active: option.key === sortBy,
          rightIcon: option.key === sortBy ? 'fa-solid fa-check' : '',
          onClick: () => setSort(option.key, sortDir, { resetDirection: option.key !== sortBy }),
        })),
        { type: 'divider' },
        {
          label: 'Ascending',
          icon: 'fa-solid fa-arrow-up-a-z',
          active: sortDir === 'asc',
          rightIcon: sortDir === 'asc' ? 'fa-solid fa-check' : '',
          onClick: () => setSort(sortBy, 'asc'),
        },
        {
          label: 'Descending',
          icon: 'fa-solid fa-arrow-down-z-a',
          active: sortDir === 'desc',
          rightIcon: sortDir === 'desc' ? 'fa-solid fa-check' : '',
          onClick: () => setSort(sortBy, 'desc'),
        },
      ];
      UIComponents.openDropdown(anchorEl, items, {
        align: 'right',
        width: 208,
        role: 'cases-sort',
        dropdownClass: 'tp3d-dropdown-sort',
        activeAnchorClass: 'btn-primary',
        menuSemantics: true,
        toggle: true,
      });
    }

    function updateHeaderIcons() {
      const headers = document.querySelectorAll('#screen-cases table thead th[data-sort]');
      headers.forEach(th => {
        const sortField = th.getAttribute('data-sort');
        const sortControl = th.querySelector('.th-sort');
        if (!sortControl) return;
        const isActive = sortBy === sortField;
        sortControl.classList.toggle('is-asc', isActive && sortDir === 'asc');
        sortControl.classList.toggle('is-desc', isActive && sortDir === 'desc');
      });
      if (btnSort) {
        btnSort.setAttribute('aria-label', 'Sort Cases');
        btnSort.setAttribute('data-tooltip', 'Sort Cases');
      }
    }

    function updateSearchClearVisibility() {
      searchClearEl.hidden = searchEl.value.length === 0;
    }

    function clearSearch() {
      searchEl.value = '';
      casesListState.pageIndex = 0;
      updateSearchClearVisibility();
      render();
      searchEl.focus();
    }

    function initCasesFooter(mode) {
      const mountEl = getCasesFooterMountElForMode(mode);
      if (!mountEl) return;
      if (casesFooterController && casesFooterMountEl === mountEl) return;
      if (casesFooterController) casesFooterController.destroy();
      casesFooterMountEl = mountEl;
      casesFooterController = createTableFooter({
        mountEl,
        onPageChange: ({ pageIndex: nextIndex, rowsPerPage }) => {
          if (typeof rowsPerPage === 'number') casesListState.rowsPerPage = rowsPerPage;
          casesListState.pageIndex = nextIndex;
          render();
        },
        onRowsPerPageChange: nextRows => {
          if (nextRows === casesListState.rowsPerPage) return;
          casesListState.rowsPerPage = nextRows;
          casesListState.pageIndex = 0;
          render();
        },
        onSelectAllToggle: applySelectAllFiltered,
      });
    }

    function getCasesPageMeta(list) {
      const items = Array.isArray(list) ? list : [];
      const perPage = Math.max(casesListState.rowsPerPage, 1);
      const total = items.length;
      const pageCount = Math.max(0, Math.ceil(total / perPage || 0));
      const clampedIndex = pageCount === 0 ? 0 : Math.min(Math.max(0, casesListState.pageIndex), pageCount - 1);
      casesListState.pageIndex = clampedIndex;
      const start = clampedIndex * perPage;
      return {
        total,
        pageCount,
        slice: items.slice(start, start + perPage),
      };
    }

    function syncCasesFooter(meta) {
      if (!casesFooterController) return;
      const perPage = Math.max(casesListState.rowsPerPage, 1);
      const effectiveMeta = meta || {
        total: filteredCases.length,
        pageCount: Math.max(0, Math.ceil(filteredCases.length / perPage || 0)),
      };
      const pageCount = effectiveMeta.pageCount;
      const clampedIndex = pageCount === 0 ? 0 : Math.min(Math.max(0, casesListState.pageIndex), pageCount - 1);
      casesListState.pageIndex = clampedIndex;
      const filteredIds = new Set(filteredCases.map(c => c.id));
      Array.from(selectedIds).forEach(id => {
        if (!filteredIds.has(id)) selectedIds.delete(id);
      });
      const selectedCount = filteredCases.filter(c => selectedIds.has(c.id)).length;
      const allSelected = filteredCases.length > 0 && filteredCases.every(c => selectedIds.has(c.id));
      const someSelected = selectedCount > 0 && !allSelected;
      casesFooterController.setState({
        selectedCount,
        totalCount: effectiveMeta.total,
        pageIndex: casesListState.pageIndex,
        pageCount,
        rowsPerPage: casesListState.rowsPerPage,
        selectAllVisible: effectiveMeta.total > 0,
        selectAllChecked: allSelected,
        selectAllIndeterminate: someSelected,
      });
    }

    function render(modeOverride) {
      const mode = modeOverride === 'grid' || modeOverride === 'list'
        ? modeOverride
        : PreferencesManager.get().casesViewMode || 'list';
      // Workspace-wide physical Quantity per Case: ONE pass over the active
      // workspace's packLibrary, shared by both the List column/sort and the
      // Grid chip for this render cycle. Never persisted, never scanned once
      // per Case.
      const workspaceQuantities = PackLibrary.getWorkspaceCaseQuantities();
      initCasesFooter(mode);
      renderFilters();
      renderTable(workspaceQuantities);
      renderViewMode(mode, workspaceQuantities);
      applyFiltersVisibility();
    }

    function renderViewMode(mode, workspaceQuantities) {
      const prefs = PreferencesManager.get();
      const viewMode = mode || prefs.casesViewMode || 'list';
      updateViewButtons(viewMode);
      const pageMeta = lastCasePageMeta || getCasesPageMeta(filteredCases);

      if (!filteredCases.length) {
        if (gridEl) gridEl.style.display = 'none';
        if (casesTableWrap) casesTableWrap.style.display = 'none';
        return;
      }

      if (viewMode === 'grid') {
        if (casesTableWrap) casesTableWrap.style.display = 'none';
        if (gridEl) {
          gridEl.style.display = 'grid';
          gridEl.innerHTML = '';
          renderGridView((pageMeta && pageMeta.slice) || [], prefs, workspaceQuantities || new Map());
        }
        return;
      }

      if (gridEl) gridEl.style.display = 'none';
      if (casesTableWrap) casesTableWrap.style.display = 'block';
    }

    function renderGridView(cases, prefs, workspaceQuantities) {
      if (!gridEl) return;
      gridEl.innerHTML = '';
      const list = Array.isArray(cases) ? cases : [];
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.cases) || {};
      const quantities = workspaceQuantities || new Map();

      if (!list.length) return;

      list.forEach(c => {
        const card = document.createElement('div');
        card.className = 'card pack-card';
        card.classList.toggle('selected', selectedIds.has(c.id));
        card.tabIndex = 0;
        card.addEventListener('click', ev => {
          const targetEl = ev.target instanceof Element ? ev.target : null;
          if (
            targetEl &&
            (
              targetEl.closest('[data-case-menu]') ||
              targetEl.closest('[data-case-select]') ||
              targetEl.closest('[data-case-notes]')
            )
          ) {
            return;
          }
          openCaseModal(c);
        });
        card.addEventListener(
          'keydown',
          /** @param {KeyboardEvent} ev */ ev => {
            if (ev.key === 'Enter') openCaseModal(c);
          }
        );

        const title = document.createElement('h3');
        title.textContent = c.name || '—';

        const identityChips = document.createElement('div');
        identityChips.className = 'tp3d-management-identity-chips';
        const itemCode = String(c.itemCode || '').trim();
        const manufacturer = String(c.manufacturer || '').trim();
        if (itemCode && badgePrefs.showItemCode !== false) {
          identityChips.appendChild(
            createManagementIdentityChip(`Code: ${itemCode}`, `Item Code: ${itemCode}`)
          );
        }
        if (manufacturer && badgePrefs.showManufacturer !== false) {
          identityChips.appendChild(
            createManagementIdentityChip(manufacturer, `Manufacturer: ${manufacturer}`)
          );
        }

        const meta = document.createElement('div');
        meta.className = 'pack-meta';

        const badgesWrap = document.createElement('div');
        badgesWrap.className = 'pack-meta-badges';

        if (badgePrefs.showCategory !== false) {
          const cat = document.createElement('div');
          cat.className = 'badge';
          cat.textContent = CategoryService.meta(c.category).name;
          badgesWrap.appendChild(cat);
        }

        if (badgePrefs.showDims !== false) {
          const dims = document.createElement('div');
          dims.className = 'badge';
          const d = c.dimensions || { length: 0, width: 0, height: 0 };
          const l = Utils.formatLength(d.length, prefs.units.length);
          const w = Utils.formatLength(d.width, prefs.units.length);
          const h = Utils.formatLength(d.height, prefs.units.length);
          dims.textContent = `L: ${l} • W: ${w} • H: ${h}`;
          badgesWrap.appendChild(dims);
        }

        if (badgePrefs.showVolume !== false) {
          const vol = document.createElement('div');
          vol.className = 'badge';
          vol.textContent = `Volume: ${Utils.formatVolume(c.dimensions, prefs.units.length)}`;
          badgesWrap.appendChild(vol);
        }

        if (badgePrefs.showWeight !== false) {
          const weight = document.createElement('div');
          weight.className = 'badge';
          const formattedWeight = Utils.formatWeight(c.weight, prefs.units.weight);
          weight.textContent = `Weight: ${formattedWeight}`;
          badgesWrap.appendChild(weight);
        }

        if (badgePrefs.showHandling !== false) {
          // Active non-default AutoPack handling rules (shared single source).
          getCaseHandlingSummary(c).forEach(label => {
            const ruleChip = document.createElement('div');
            ruleChip.className = 'badge tp3d-handling-chip';
            ruleChip.textContent = label;
            badgesWrap.appendChild(ruleChip);
          });
        }

        if (badgePrefs.showQuantity !== false) {
          const qty = quantities.get(c.id) || 0;
          const qtyBadge = document.createElement('div');
          qtyBadge.className = 'badge';
          qtyBadge.textContent = `${qty} unit${qty === 1 ? '' : 's'}`;
          badgesWrap.appendChild(qtyBadge);
        }

        const selectCb = document.createElement('input');
        selectCb.type = 'checkbox';
        selectCb.checked = selectedIds.has(c.id);
        selectCb.setAttribute('data-case-select', '1');
        selectCb.setAttribute('aria-label', `Select ${c.name || 'Case'}`);
        selectCb.addEventListener('click', ev => ev.stopPropagation());
        selectCb.addEventListener('change', () => {
          if (selectCb.checked) selectedIds.add(c.id);
          else selectedIds.delete(c.id);
          card.classList.toggle('selected', selectedIds.has(c.id));
          updateSelectionUI(lastVisibleIds);
          syncCasesFooter();
        });

        const kebabBtn = document.createElement('button');
        kebabBtn.className = 'btn btn-ghost';
        kebabBtn.type = 'button';
        kebabBtn.setAttribute('data-case-menu', '1');
        kebabBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        kebabBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          UIComponents.openDropdown(kebabBtn, [
            { label: 'Edit', icon: 'fa-solid fa-pen-to-square', onClick: () => openCaseModal(c) },
            {
              label: 'Duplicate',
              icon: 'fa-solid fa-clone',
              onClick: () => {
                if (mutationBlockedWhileBusy()) return;
                CaseLibrary.duplicate(c.id);
                UIComponents.showToast('Case duplicated', 'success');
              },
            },
            {
              label: 'Delete',
              icon: 'fa-solid fa-trash-can',
              variant: 'danger',
              dividerBefore: true,
              onClick: () => deleteCase(c.id),
            },
          ]);
        });

        const actions = document.createElement('div');
        actions.className = 'card-head-actions tp3d-cases-card-head-actions';
        actions.appendChild(selectCb);
        if (badgePrefs.showNotes !== false) actions.appendChild(createCaseNotesButton(c));
        actions.appendChild(kebabBtn);

        const head = document.createElement('div');
        head.className = 'card-head tp3d-cases-card-head';
        head.appendChild(title);
        head.appendChild(actions);

        if (badgesWrap.children.length) meta.appendChild(badgesWrap);

        card.appendChild(head);
        if (identityChips.children.length) card.appendChild(identityChips);
        card.appendChild(meta);
        gridEl.appendChild(card);
      });
    }

    function renderFilters() {
      const cases = CaseLibrary.getCases();
      if (
        !mutationBlockedWhileBusy({ notify: false }) &&
        CategoryService.resetToDefaultIfNoCases(cases)
      ) {
        activeCategories.clear();
      }
      const list = CategoryService.listWithCounts(cases);
      const validKeys = new Set(list.map(cat => cat.key));
      Array.from(activeCategories).forEach(key => {
        if (!validKeys.has(key)) activeCategories.delete(key);
      });
      filtersEl.innerHTML = '';

      const filterHeader = document.createElement('div');
      filterHeader.className = 'tp3d-filter-popover-title';
      filterHeader.textContent = 'Filters';
      filtersEl.appendChild(filterHeader);

      const allChip = chip(
        'All',
        'all',
        activeCategories.size === 0,
        () => {
          activeCategories.clear();
          render();
        },
        '#9b9ba8',
        cases.length
      );
      filtersEl.appendChild(allChip);

      list.forEach(cat => {
        const isActive = activeCategories.has(cat.key);
        const el = chip(
          cat.name,
          cat.key,
          isActive,
          () => {
            if (activeCategories.has(cat.key)) activeCategories.delete(cat.key);
            else activeCategories.add(cat.key);
            render();
          },
          cat.color,
          cat.count
        );
        filtersEl.appendChild(el);
      });
    }

    function renderTable(workspaceQuantities) {
      const prefs = PreferencesManager.get();
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.cases) || {};
      const quantities = workspaceQuantities || new Map();
      applyListColumnVisibility(prefs);
      const q = String(searchEl.value || '').trim();
      const cats = Array.from(activeCategories).sort();

      // Simplest stable behavior: clear selection when the visible dataset changes (search/sort/filter).
      const datasetKey = `${q}::${sortBy}::${sortDir}::${cats.join(',')}`;
      if (datasetKey !== lastDatasetKey) {
        clearSelection();
        lastDatasetKey = datasetKey;
        casesListState.pageIndex = 0;
      }

      const cases = CaseLibrary.search(q, Array.from(activeCategories));
      filteredCases = cases;
      const sourceOrder = new Map(cases.map((caseRecord, index) => [caseRecord, index]));

      // Sort cases
      cases.sort((a, b) => {
        if (sortBy === 'itemCode') {
          return (
            compareBusinessIdentityValues(a.itemCode, b.itemCode, { direction: sortDir }) ||
            (sourceOrder.get(a) ?? 0) - (sourceOrder.get(b) ?? 0)
          );
        }
        let valA, valB;
        switch (sortBy) {
          case 'name':
            valA = (a.name || '').toLowerCase();
            valB = (b.name || '').toLowerCase();
            break;
          case 'manufacturer':
            valA = (a.manufacturer || '').toLowerCase();
            valB = (b.manufacturer || '').toLowerCase();
            break;
          case 'volume':
            valA = a.volume || 0;
            valB = b.volume || 0;
            break;
          case 'length':
            valA = (a.dimensions && a.dimensions.length) || 0;
            valB = (b.dimensions && b.dimensions.length) || 0;
            break;
          case 'width':
            valA = (a.dimensions && a.dimensions.width) || 0;
            valB = (b.dimensions && b.dimensions.width) || 0;
            break;
          case 'height':
            valA = (a.dimensions && a.dimensions.height) || 0;
            valB = (b.dimensions && b.dimensions.height) || 0;
            break;
          case 'weight':
            valA = a.weight || 0;
            valB = b.weight || 0;
            break;
          case 'category':
            valA = CategoryService.meta(a.category).name.toLowerCase();
            valB = CategoryService.meta(b.category).name.toLowerCase();
            break;
          case 'quantity':
            valA = quantities.get(a.id) || 0;
            valB = quantities.get(b.id) || 0;
            break;
          default:
            valA = (a.name || '').toLowerCase();
            valB = (b.name || '').toLowerCase();
        }

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDir === 'asc' ? valA - valB : valB - valA;
        }

        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });

      const casePageMeta = getCasesPageMeta(cases);
      lastCasePageMeta = casePageMeta;
      tbodyEl.innerHTML = '';
      const visibleIds = cases.map(c => c.id);

      // Prune any stale selections (e.g. after deletes).
      const visibleIdSet = new Set(visibleIds);
      Array.from(selectedIds).forEach(id => {
        if (!visibleIdSet.has(id)) selectedIds.delete(id);
      });

      updateSelectionUI(visibleIds);

      if (!cases.length) {
        const allCases = CaseLibrary.getCases();
        const heading = emptyEl.firstElementChild;
        const detail = emptyEl.lastElementChild;
        const hasLibraryCases = allCases.length > 0;
        if (heading) {
          heading.textContent = hasLibraryCases
            ? (q ? `No matching cases for "${q}"` : 'No matching cases')
            : 'No cases yet';
        }
        if (detail) {
          detail.textContent = hasLibraryCases
            ? 'Try a different keyword or clear the active filters.'
            : 'Add cases or import a CSV/XLSX template.';
        }
        emptyEl.style.display = 'block';
        syncCasesFooter(casePageMeta);
        return;
      }
      emptyEl.style.display = 'none';

      casePageMeta.slice.forEach(c => {
        const tr = document.createElement('tr');

        const tdSelect = document.createElement('td');
        tdSelect.classList.add('tp3d-cases-td-select');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedIds.has(c.id);
        cb.addEventListener('click', ev => ev.stopPropagation());
        cb.addEventListener('change', ev => {
          const target = /** @type {HTMLInputElement|null} */ (ev.target);
          if (target && target.checked) selectedIds.add(c.id);
          else selectedIds.delete(c.id);
          render();
        });
        tdSelect.appendChild(cb);
        tr.appendChild(tdSelect);

        const tdName = document.createElement('td');
        const nameWrap = document.createElement('div');
        nameWrap.classList.add('tp3d-packs-titlewrap');
        const name = document.createElement('div');
        name.textContent = c.name || '—';
        nameWrap.appendChild(name);
        const itemCodeValue = String(c.itemCode || '').trim();
        if (itemCodeValue && badgePrefs.showItemCode !== false) {
          const itemCodeMeta = document.createElement('div');
          itemCodeMeta.className = 'muted tp3d-management-secondary-text';
          itemCodeMeta.textContent = `Item Code: ${itemCodeValue}`;
          nameWrap.appendChild(itemCodeMeta);
        }
        tdName.appendChild(nameWrap);
        tr.appendChild(tdName);

        const tdMfg = document.createElement('td');
        tdMfg.classList.add('tp3d-management-secondary-text');
        tdMfg.textContent = String(c.manufacturer || '').trim() || '—';
        if (badgePrefs.showManufacturer === false) tdMfg.style.display = 'none';
        tr.appendChild(tdMfg);

        const tdLength = document.createElement('td');
        tdLength.textContent = Utils.formatLength(c.dimensions.length, prefs.units.length);
        if (prefs.gridCardBadges && prefs.gridCardBadges.cases && prefs.gridCardBadges.cases.showDims === false) {
          tdLength.style.display = 'none';
        }
        tr.appendChild(tdLength);

        const tdWidth = document.createElement('td');
        tdWidth.textContent = Utils.formatLength(c.dimensions.width, prefs.units.length);
        if (prefs.gridCardBadges && prefs.gridCardBadges.cases && prefs.gridCardBadges.cases.showDims === false) {
          tdWidth.style.display = 'none';
        }
        tr.appendChild(tdWidth);

        const tdHeight = document.createElement('td');
        tdHeight.textContent = Utils.formatLength(c.dimensions.height, prefs.units.length);
        if (prefs.gridCardBadges && prefs.gridCardBadges.cases && prefs.gridCardBadges.cases.showDims === false) {
          tdHeight.style.display = 'none';
        }
        tr.appendChild(tdHeight);

        const tdVol = document.createElement('td');
        tdVol.textContent = Utils.formatVolume(c.dimensions, prefs.units.length);
        if (prefs.gridCardBadges && prefs.gridCardBadges.cases && prefs.gridCardBadges.cases.showVolume === false) {
          tdVol.style.display = 'none';
        }
        tr.appendChild(tdVol);

        const tdW = document.createElement('td');
        const weight = Number(c.weight) || 0;
        const formattedWeight =
          prefs.units.weight === 'kg' ? `${(weight * 0.453592).toFixed(2)} kg` : `${weight.toFixed(2)} lb`;
        tdW.textContent = formattedWeight;
        if (prefs.gridCardBadges && prefs.gridCardBadges.cases && prefs.gridCardBadges.cases.showWeight === false) {
          tdW.style.display = 'none';
        }
        tr.appendChild(tdW);

        const tdCat = document.createElement('td');
        tdCat.appendChild(categoryChip(c.category));
        if (prefs.gridCardBadges && prefs.gridCardBadges.cases && prefs.gridCardBadges.cases.showCategory === false) {
          tdCat.style.display = 'none';
        }
        tr.appendChild(tdCat);

        const tdHandling = document.createElement('td');
        const handlingSummary = getCaseHandlingSummary(c);
        if (handlingSummary.length === 0) {
          tdHandling.textContent = '—';
        } else {
          handlingSummary.forEach(label => {
            const ruleChip = document.createElement('span');
            ruleChip.className = 'badge tp3d-handling-chip';
            ruleChip.textContent = label;
            tdHandling.appendChild(ruleChip);
          });
        }
        if (badgePrefs.showHandling === false) {
          tdHandling.style.display = 'none';
        }
        tr.appendChild(tdHandling);

        const tdQty = document.createElement('td');
        tdQty.textContent = String(quantities.get(c.id) || 0);
        if (badgePrefs.showQuantity === false) {
          tdQty.style.display = 'none';
        }
        tr.appendChild(tdQty);

        const tdNotes = document.createElement('td');
        tdNotes.className = 'tp3d-management-notes-col';
        tdNotes.appendChild(createCaseNotesButton(c));
        tdNotes.hidden = badgePrefs.showNotes === false;
        tr.appendChild(tdNotes);

        const tdActions = document.createElement('td');
        tdActions.className = 'col-actions';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost';
        btn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          UIComponents.openDropdown(btn, [
            { label: 'Edit', icon: 'fa-solid fa-pen-to-square', onClick: () => openCaseModal(c) },
            {
              label: 'Duplicate',
              icon: 'fa-solid fa-clone',
              onClick: () => {
                if (mutationBlockedWhileBusy()) return;
                CaseLibrary.duplicate(c.id);
                UIComponents.showToast('Case duplicated', 'success');
              },
            },
            {
              label: 'Delete',
              icon: 'fa-solid fa-trash-can',
              variant: 'danger',
              dividerBefore: true,
              onClick: () => deleteCase(c.id),
            },
          ]);
        });
        tdActions.appendChild(btn);
        tr.appendChild(tdActions);

        tbodyEl.appendChild(tr);
      });
      syncCasesFooter(casePageMeta);
    }

    function applyListColumnVisibility(prefs) {
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.cases) || {};
      const set = (sortKey, visible) => {
        const th = /** @type {HTMLElement|null} */ (
          document.querySelector(`#screen-cases table thead th[data-sort="${sortKey}"]`)
        );
        if (th) th.style.display = visible ? '' : 'none';
      };
      set('manufacturer', badgePrefs.showManufacturer !== false);
      set('length', badgePrefs.showDims !== false);
      set('width', badgePrefs.showDims !== false);
      set('height', badgePrefs.showDims !== false);
      set('volume', badgePrefs.showVolume !== false);
      set('weight', badgePrefs.showWeight !== false);
      set('category', badgePrefs.showCategory !== false);
      set('quantity', badgePrefs.showQuantity !== false);

      // Handling has no sort key (it is not sortable), so it is looked up by its
      // own stable data-column attribute rather than a positional sibling
      // traversal from a neighboring header, which silently breaks whenever a
      // column is inserted or reordered next to it.
      const handlingTh = /** @type {HTMLElement|null} */ (
        document.querySelector('#screen-cases table thead th[data-column="handling"]')
      );
      if (handlingTh) {
        handlingTh.style.display = badgePrefs.showHandling !== false ? '' : 'none';
      }

      const notesTh = /** @type {HTMLElement|null} */ (
        document.querySelector('#screen-cases table thead th[data-column="notes"]')
      );
      if (notesTh) notesTh.hidden = badgePrefs.showNotes === false;
    }

    function chip(label, key, active, onClick, color, count) {
      const el = document.createElement('div');
      el.className = `chip ${active ? 'active' : ''}`;
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.style.background = color || 'var(--border-strong)';
      const text = document.createElement('span');
      text.textContent = `${label}${Number.isFinite(count) ? `: ${count}` : ''}`;
      el.appendChild(dot);
      el.appendChild(text);
      const activate = () => {
        casesListState.pageIndex = 0;
        onClick();
      };
      el.addEventListener('click', activate);
      el.addEventListener(
        'keydown',
        /** @param {KeyboardEvent} ev */ ev => {
          if (ev.key === 'Enter') activate();
        }
      );
      return el;
    }

    function categoryChip(categoryKey) {
      const meta = CategoryService.meta(categoryKey || 'default');
      const el = document.createElement('span');
      el.className = 'chip';
      el.classList.add('tp3d-chip-readonly');
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.style.background = meta.color;
      const text = document.createElement('span');
      text.textContent = meta.name;
      el.appendChild(dot);
      el.appendChild(text);
      return el;
    }

    function openCaseModal(existing) {
      if (mutationBlockedWhileBusy()) return;
      openSharedCaseModal({
        existing,
        Utils,
        UIComponents,
        PreferencesManager,
        CaseLibrary,
        CategoryService,
        beforeMutate,
        onSaved: () => render(),
      });
    }

    function toggleCategoriesPopover(anchorEl) {
      if (!anchorEl) return;
      const open = /** @type {HTMLElement|null} */ (
        document.querySelector('[data-dropdown="1"][data-role="categories"]')
      );
      if (open && open.dataset.anchorId === anchorEl.id) {
        UIComponents.closeAllDropdowns();
        return;
      }
      openCategoriesPopover(anchorEl);
    }

    function openCategoriesPopover(anchorEl) {
      const cases = CaseLibrary.getCases();
      const list = CategoryService.listWithCounts(cases);

      const items = [];
      items.push({ type: 'header', label: 'Categories' });

      items.push({
        label: 'New Category',
        icon: 'fa-solid fa-plus',
        variant: 'primary',
        onClick: () => createCategoryAndEdit(),
      });
      items.push({ type: 'divider' });

      items.push({
        label: `All (${cases.length})`,
        icon: 'fa-solid fa-circle',
        iconColor: '#9b9ba8',
        active: activeCategories.size === 0,
        onClick: () => {
          activeCategories.clear();
          render();
        },
      });

      list.forEach(cat => {
        const isActive = activeCategories.has(cat.key);
        items.push({
          label: `${cat.name} (${cat.count})`,
          icon: 'fa-solid fa-circle',
          iconColor: cat.color,
          active: isActive,
          onClick: () => {
            if (activeCategories.has(cat.key)) activeCategories.delete(cat.key);
            else activeCategories.add(cat.key);
            render();
          },
          rightIcon: 'fa-solid fa-pen',
          rightIconColor: 'var(--text-secondary)',
          rightTitle: 'Edit',
          rightOnClick: () => openEditCategoryModal(cat),
        });
      });

      const rect = anchorEl.getBoundingClientRect();
      UIComponents.openDropdown(anchorEl, items, {
        align: 'right',
        width: Math.max(220, Math.min(rect.width, 240)),
        role: 'categories',
        activeAnchorClass: 'btn-primary',
        menuSemantics: true,
      });
    }

    function normalizeCategoryNameKey(value) {
      return String(value || '')
        .trim()
        .toLowerCase();
    }

    function findDuplicateCategoryName(name, excludeKey = '') {
      const key = normalizeCategoryNameKey(name);
      const excluded = normalizeCategoryNameKey(excludeKey);
      if (!key) return null;
      return CategoryService.listWithCounts(CaseLibrary.getCases()).find(cat => {
        if (cat.key === excluded) return false;
        return cat.key === key || normalizeCategoryNameKey(cat.name || cat.key) === key;
      }) || null;
    }

    function getProjectCategoryNameSet() {
      return new Set(
        CategoryService.listWithCounts(CaseLibrary.getCases()).map(c => normalizeCategoryNameKey(c.name || c.key))
      );
    }

    function createCategoryAndEdit() {
      if (mutationBlockedWhileBusy()) return;
      const baseName = 'New Category';
      let idx = 1;
      let name = baseName;
      const existing = getProjectCategoryNameSet();
      while (existing.has(normalizeCategoryNameKey(name))) {
        idx += 1;
        name = `${baseName} ${idx}`;
      }
      const next = CategoryService.upsert({ name });
      render();
      openEditCategoryModal(next);
    }

    function openEditCategoryModal(cat) {
      const initial = cat && typeof cat === 'object' ? cat : CategoryService.meta('default');
      const content = document.createElement('div');
      content.classList.add('tp3d-cases-managecats-grid');

      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'input';
      name.value = initial.name || '';
      name.placeholder = 'Category name';

      const colorWrap = document.createElement('label');
      colorWrap.classList.add('tp3d-cases-cat-swatch');
      colorWrap.setAttribute('aria-label', 'Category color');
      colorWrap.setAttribute('title', 'Category color');

      const color = document.createElement('input');
      color.type = 'color';
      color.className = 'tp3d-cases-cat-color-input';
      color.value = initial.color || '#9ca3af';
      color.setAttribute('aria-label', 'Category color');
      colorWrap.style.background = color.value;
      colorWrap.appendChild(color);
      color.addEventListener('input', () => {
        colorWrap.style.background = color.value || '#9ca3af';
      });

      const row = document.createElement('div');
      row.classList.add('tp3d-cases-color-row');
      row.appendChild(colorWrap);
      row.appendChild(name);

      content.appendChild(row);

      let modal = null;
      modal = UIComponents.showModal({
        title: 'Edit Category',
        content,
        actions: [
          { label: 'Cancel' },
          ...(initial.key !== 'default'
            ? [
                {
                  label: 'Delete',
                  variant: 'danger',
                  onClick: () => {
                    if (mutationBlockedWhileBusy()) return false;
                    UIComponents.confirm({
                      title: `Delete "${initial.name}"?`,
                      message: 'All cases in this category will be moved to Default.',
                      okLabel: 'Delete',
                      danger: true,
                    }).then(ok => {
                      if (!ok) return;
                      if (mutationBlockedWhileBusy()) return;
                      CategoryService.remove(initial.key);
                      render();
                      UIComponents.showToast(`Deleted "${initial.name}"`, 'info');
                      if (modal) modal.close();
                    });
                    return false;
                  },
                },
              ]
            : []),
          {
            label: 'Save',
            variant: 'primary',
            onClick: () => {
              if (mutationBlockedWhileBusy()) return false;
              const nextName = String(name.value || '').trim();
              if (!nextName) {
                UIComponents.showToast('Name is required', 'warning');
                name.focus();
                return false;
              }
              const duplicate = findDuplicateCategoryName(nextName, initial.key);
              if (duplicate) {
                UIComponents.showToast(`Category "${duplicate.name}" already exists. Choose a unique name.`, 'warning');
                name.focus();
                return false;
              }
              const renamed = CategoryService.rename(initial.key, nextName, color.value);
              render();
              UIComponents.showToast(`Saved "${renamed.name}"`, 'success');
              return true;
            },
          },
        ],
      });
    }

    function _openCategoryManager() {
      const content = document.createElement('div');
      content.classList.add('tp3d-cases-catmgr-content');

      const listEl = document.createElement('div');
      listEl.classList.add('tp3d-cases-catmgr-list');

      const renderList = () => {
        listEl.innerHTML = '';
        CategoryService.listWithCounts(CaseLibrary.getCases()).forEach(cat => {
          const row = document.createElement('div');
          row.className = 'card';
          row.classList.add('tp3d-cases-catmgr-row');

          const colorWrap = document.createElement('label');
          colorWrap.classList.add('tp3d-cases-cat-swatch', 'tp3d-cases-catmgr-color-wrap');
          colorWrap.setAttribute('aria-label', 'Category color');
          colorWrap.setAttribute('title', 'Category color');
          const color = document.createElement('input');
          color.type = 'color';
          color.value = cat.color || '#9ca3af';
          color.className = 'tp3d-cases-cat-color-input';
          color.setAttribute('aria-label', 'Category color');
          colorWrap.style.background = color.value;
          colorWrap.appendChild(color);
          color.addEventListener('input', () => {
            colorWrap.style.background = color.value || '#9ca3af';
          });

          const name = document.createElement('input');
          name.type = 'text';
          name.className = 'input';
          name.value = cat.name;
          name.placeholder = 'Category name';

          const actions = document.createElement('div');
          actions.classList.add('tp3d-cases-catmgr-actions');

          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'btn btn-ghost';
          saveBtn.classList.add('tp3d-cases-catmgr-btn-pad');
          saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
          saveBtn.setAttribute('data-tooltip', 'Save changes');
          saveBtn.addEventListener('click', () => {
            if (mutationBlockedWhileBusy()) return;
            const duplicate = findDuplicateCategoryName(name.value, cat.key);
            if (duplicate) {
              UIComponents.showToast(`Category "${duplicate.name}" already exists. Choose a unique name.`, 'warning');
              name.focus();
              return;
            }
            const renamed = CategoryService.rename(cat.key, name.value, color.value);
            renderList();
            render();
            UIComponents.showToast(`Saved "${renamed.name}"`, 'success');
          });

          if (cat.key !== 'default') {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-ghost';
            delBtn.classList.add('tp3d-cases-catmgr-btn-pad', 'tp3d-cases-catmgr-del-color');
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            delBtn.setAttribute('data-tooltip', 'Delete category');
            delBtn.addEventListener('click', async () => {
              if (mutationBlockedWhileBusy()) return;
              const ok = await UIComponents.confirm({
                title: `Delete "${cat.name}"?`,
                message: 'All cases in this category will be moved to Default.',
                okLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
              if (mutationBlockedWhileBusy()) return;
              CategoryService.remove(cat.key);
              renderList();
              render();
              UIComponents.showToast(`Deleted "${cat.name}"`, 'info');
            });
            actions.appendChild(delBtn);
          }

          actions.appendChild(saveBtn);
          row.appendChild(colorWrap);
          row.appendChild(name);
          row.appendChild(actions);
          listEl.appendChild(row);
        });
      };

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-primary';
      addBtn.classList.add('tp3d-cases-catmgr-add-full');
      addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> New Category';
      addBtn.addEventListener('click', () => {
        if (mutationBlockedWhileBusy()) return;
        const baseName = 'New Category';
        let idx = 1;
        let name = baseName;
        const existing = getProjectCategoryNameSet();
        while (existing.has(normalizeCategoryNameKey(name))) {
          idx += 1;
          name = `${baseName} ${idx}`;
        }
        CategoryService.upsert({ name });
        renderList();
        render();
      });

      renderList();

      content.appendChild(listEl);
      content.appendChild(addBtn);

      UIComponents.showModal({
        title: 'Manage Categories',
        content,
        actions: [{ label: 'Close', variant: 'primary' }],
      });
    }

    async function deleteCase(caseId) {
      const caseData = CaseLibrary.getById(caseId);
      if (!caseData) return;
      if (mutationBlockedWhileBusy()) return;
      const packsUsing = PackLibrary.getPacks().filter(p => (p.cases || []).some(i => i.caseId === caseId));
      const msg = packsUsing.length
        ? `This case is used in ${packsUsing.length} load plan(s). Deleting it will remove it from those load plans.`
        : 'This cannot be undone.';
      const ok = await UIComponents.confirm({
        title: `Delete "${caseData.name}"?`,
        message: msg,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;
      if (mutationBlockedWhileBusy()) return;

      const nextCaseLibrary = CaseLibrary.getCases().filter(c => c.id !== caseId);
      const nextPackLibrary = PackLibrary.getPacks().map(p => {
        const nextCases = (p.cases || []).filter(i => i.caseId !== caseId);
        if (nextCases.length === (p.cases || []).length) return p;
        const next = { ...p, cases: nextCases, lastEdited: Date.now() };
        next.stats = PackLibrary.computeStats(next);
        return next;
      });

      StateStore.set({ caseLibrary: nextCaseLibrary, packLibrary: nextPackLibrary });
      UIComponents.showToast('Case deleted', 'info');
    }

    // Import Cases dialog extracted to src/ui/overlays/import-cases-dialog.js

    return { init: initCasesUI, render };
  })();

  return CasesUI;
}
