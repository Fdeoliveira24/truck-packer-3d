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
}) {
  const CasesUI = (() => {
    const searchEl = document.getElementById('cases-search');
    const filtersEl = document.getElementById('cases-filters');
    const gridEl = document.getElementById('cases-grid');
    const tbodyEl = document.getElementById('cases-tbody');
    const emptyEl = document.getElementById('cases-empty');
    const selectAllEl = document.getElementById('cases-select-all');
    const btnNew = document.getElementById('btn-new-case');
    const btnTemplate = document.getElementById('btn-cases-template');
    const btnImport = document.getElementById('btn-cases-import');
    const btnManageCats = document.getElementById('btn-manage-categories');
    const btnViewGrid = document.getElementById('cases-view-grid');
    const btnViewList = document.getElementById('cases-view-list');
    const btnFiltersToggle = document.getElementById('cases-filters-toggle');
    const btnCardDisplay = document.getElementById('cases-card-display');
    const actionsDefaultEl = document.getElementById('cases-actions-default');
    const actionsBulkEl = document.getElementById('cases-actions-bulk');
    const selectedCountEl = document.getElementById('cases-selected-count');
    const btnBulkDelete = document.getElementById('btn-cases-bulk-delete');

    const activeCategories = new Set(); // empty = all
    let sortBy = 'name'; // name, manufacturer, dimensions, volume, weight, category
    let sortDir = 'asc'; // asc or desc
    const selectedIds = new Set();
    let lastDatasetKey = '';
    let lastVisibleIds = [];
    const casesTableWrap = document.querySelector('#screen-cases .table-wrap');
    const casesListState = {
      pageIndex: 0,
      rowsPerPage: 50,
    };
    let casesFooterController = null;
    let casesFooterMountEl = null;
    let lastCasePageMeta = null;
    let filteredCases = [];

    function initCasesUI() {
      searchEl.addEventListener(
        'input',
        Utils.debounce(() => {
          casesListState.pageIndex = 0;
          render();
        }, 300)
      );
      btnNew.addEventListener('click', () => openCaseModal(null));
      btnTemplate.addEventListener('click', () => ImportExport.downloadCasesTemplate());
      btnImport.addEventListener(
        'click',
        () => ImportCasesDialog && ImportCasesDialog.open && ImportCasesDialog.open()
      );
      btnManageCats &&
        btnManageCats.addEventListener('click', ev => {
          ev.stopPropagation();
          toggleCategoriesPopover(btnManageCats);
        });
      btnViewGrid && btnViewGrid.addEventListener('click', () => setViewMode('grid'));
      btnViewList && btnViewList.addEventListener('click', () => setViewMode('list'));
      btnFiltersToggle && btnFiltersToggle.addEventListener('click', () => toggleFiltersVisible());
      btnCardDisplay &&
        btnCardDisplay.addEventListener('click', () => {
          // TODO: Add keyboard shortcut + update Keyboard Shortcuts modal later
          CardDisplayOverlay.open({ screen: 'cases' });
        });
      btnBulkDelete.addEventListener('click', () => bulkDeleteSelected());
      selectAllEl.addEventListener('change', () => toggleAllVisible(selectAllEl.checked));
      initTableHeaders();
      updateViewButtons();
      applyFiltersVisibility();
    }

    function getCasesFooterMountElForMode(mode) {
      // Footer must be appended directly to #screen-cases to match CSS selector
      return document.getElementById('screen-cases');
    }

    function setViewMode(mode) {
      const prefs = PreferencesManager.get();
      prefs.casesViewMode = mode === 'grid' ? 'grid' : 'list';
      PreferencesManager.set(prefs);
      updateViewButtons();
      render();
    }

    function updateViewButtons() {
      const mode = PreferencesManager.get().casesViewMode || 'list';
      btnViewGrid && btnViewGrid.classList.toggle('btn-primary', mode === 'grid');
      btnViewList && btnViewList.classList.toggle('btn-primary', mode === 'list');
    }

    function toggleFiltersVisible() {
      const prefs = PreferencesManager.get();
      prefs.casesFiltersVisible = !prefs.casesFiltersVisible;
      PreferencesManager.set(prefs);
      applyFiltersVisibility();
    }

    function applyFiltersVisibility() {
      if (!filtersEl) return;
      const visible = PreferencesManager.get().casesFiltersVisible !== false;
      filtersEl.style.display = visible ? '' : 'none';
      btnFiltersToggle && btnFiltersToggle.classList.toggle('btn-primary', visible);
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

      const ok = await UIComponents.confirm({
        title: 'Delete cases?',
        message: `This will permanently delete ${count} case(s). This cannot be undone.`,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;

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
        sortControl.addEventListener('keydown', ev => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            toggleSort();
          }
        });
      });
      updateHeaderIcons();
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

    function render() {
      const mode = PreferencesManager.get().casesViewMode || 'list';
      initCasesFooter(mode);
      renderFilters();
      renderTable();
      renderViewMode(mode);
      applyFiltersVisibility();
    }

    function renderViewMode(mode) {
      const prefs = PreferencesManager.get();
      const viewMode = mode || prefs.casesViewMode || 'list';
      updateViewButtons();
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
          renderGridView((pageMeta && pageMeta.slice) || [], prefs);
        }
        return;
      }

      if (gridEl) gridEl.style.display = 'none';
      if (casesTableWrap) casesTableWrap.style.display = 'block';
    }

    function renderGridView(cases, prefs) {
      if (!gridEl) return;
      gridEl.innerHTML = '';
      const list = Array.isArray(cases) ? cases : [];
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.cases) || {};

      if (!list.length) return;

      list.forEach(c => {
        const card = document.createElement('div');
        card.className = 'card pack-card';
        card.classList.toggle('selected', selectedIds.has(c.id));
        card.tabIndex = 0;
        card.addEventListener('click', ev => {
          if (
            ev.target &&
            ev.target.closest &&
            (ev.target.closest('[data-case-menu]') || ev.target.closest('[data-case-select]'))
          ) {
            return;
          }
          openCaseModal(c);
        });
        card.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') openCaseModal(c);
        });

        const title = document.createElement('h3');
        title.textContent = c.name || '—';

        const sub = document.createElement('div');
        sub.className = 'muted';
        sub.classList.add('tp3d-cases-muted-sm');
        if (c.manufacturer) sub.textContent = c.manufacturer;

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

        if (badgePrefs.showFlip !== false) {
          const flip = document.createElement('div');
          flip.className = 'badge';
          flip.textContent = c.canFlip === true ? 'Flip: Yes' : 'Flip: No';
          badgesWrap.appendChild(flip);
        }

        if (badgePrefs.showEditedTime !== false) {
          const edited = document.createElement('div');
          edited.className = 'badge';
          edited.textContent = `Edited: ${Utils.formatRelativeTime(c.updatedAt)}`;
          badgesWrap.appendChild(edited);
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
            { label: 'Edit', icon: 'fa-solid fa-pen', onClick: () => openCaseModal(c) },
            {
              label: 'Duplicate',
              icon: 'fa-solid fa-clone',
              onClick: () => {
                CaseLibrary.duplicate(c.id);
                UIComponents.showToast('Case duplicated', 'success');
              },
            },
            {
              label: 'Delete',
              icon: 'fa-solid fa-trash',
              variant: 'danger',
              dividerBefore: true,
              onClick: () => deleteCase(c.id),
            },
          ]);
        });

        const actions = document.createElement('div');
        actions.className = 'card-head-actions tp3d-cases-card-head-actions';
        actions.appendChild(selectCb);
        actions.appendChild(kebabBtn);

        const head = document.createElement('div');
        head.className = 'card-head tp3d-cases-card-head';
        head.appendChild(title);
        head.appendChild(actions);

        if (badgesWrap.children.length) meta.appendChild(badgesWrap);

        card.appendChild(head);
        if (c.manufacturer) card.appendChild(sub);
        card.appendChild(meta);
        gridEl.appendChild(card);
      });
    }

    function renderFilters() {
      const cases = CaseLibrary.getCases();
      const list = CategoryService.listWithCounts(cases);
      filtersEl.innerHTML = '';

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

    function renderTable() {
      const prefs = PreferencesManager.get();
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

      // Sort cases
      cases.sort((a, b) => {
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
          if (ev.target.checked) selectedIds.add(c.id);
          else selectedIds.delete(c.id);
          render();
        });
        tdSelect.appendChild(cb);
        tr.appendChild(tdSelect);

        const tdName = document.createElement('td');
        tdName.textContent = c.name || '—';
        tr.appendChild(tdName);

        const tdMfg = document.createElement('td');
        tdMfg.textContent = c.manufacturer || '—';
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

        const tdFlip = document.createElement('td');
        const flipLabel = c.canFlip === true ? 'Yes' : c.canFlip === false ? 'No' : '';
        tdFlip.textContent = flipLabel;
        if (prefs.gridCardBadges && prefs.gridCardBadges.cases && prefs.gridCardBadges.cases.showFlip === false) {
          tdFlip.style.display = 'none';
        }
        tr.appendChild(tdFlip);

        const tdActions = document.createElement('td');
        tdActions.className = 'col-actions';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost';
        btn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          UIComponents.openDropdown(btn, [
            { label: 'Edit', icon: 'fa-solid fa-pen', onClick: () => openCaseModal(c) },
            {
              label: 'Duplicate',
              icon: 'fa-solid fa-clone',
              onClick: () => {
                CaseLibrary.duplicate(c.id);
                UIComponents.showToast('Case duplicated', 'success');
              },
            },
            {
              label: 'Delete',
              icon: 'fa-solid fa-trash',
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
        const th = document.querySelector(`#screen-cases table thead th[data-sort="${sortKey}"]`);
        if (th) th.style.display = visible ? '' : 'none';
      };
      set('length', badgePrefs.showDims !== false);
      set('width', badgePrefs.showDims !== false);
      set('height', badgePrefs.showDims !== false);
      set('volume', badgePrefs.showVolume !== false);
      set('weight', badgePrefs.showWeight !== false);
      set('category', badgePrefs.showCategory !== false);

      const catTh = document.querySelector('#screen-cases table thead th[data-sort="category"]');
      const flipTh = catTh ? catTh.nextElementSibling : null;
      if (flipTh) flipTh.style.display = badgePrefs.showFlip !== false ? '' : 'none';
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
      el.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') activate();
      });
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
      const prefs = PreferencesManager.get();
      const lengthUnit = prefs.units.length;
      const weightUnit = prefs.units.weight;

      const now = Date.now();
      const isEdit = Boolean(existing);
      const initial = existing
        ? Utils.deepClone(existing)
        : {
            id: Utils.uuid(),
            name: '',
            manufacturer: '',
            category: 'default',
            dimensions: { length: 48, width: 24, height: 24 },
            weight: 0,
            canFlip: true,
            notes: '',
            color: CategoryService.meta('default').color,
            createdAt: now,
            updatedAt: now,
          };

      const content = document.createElement('div');
      content.classList.add('tp3d-cases-modal-grid-2col');

      const fName = field('Name', 'text', 'Line Array Case', true);
      fName.input.value = initial.name || '';

      const fMfg = field('Manufacturer', 'text', 'L-Acoustics', false);
      fMfg.input.value = initial.manufacturer || '';

      const catWrap = document.createElement('div');
      catWrap.className = 'field';
      catWrap.classList.add('tp3d-grid-span-full');
      const catLabel = document.createElement('div');
      catLabel.className = 'label';
      catLabel.textContent = 'Category';
      const catRow = document.createElement('div');
      catRow.classList.add('tp3d-cases-cat-row');
      const catColorSwatch = document.createElement('div');
      catColorSwatch.classList.add('tp3d-cases-cat-swatch');
      const catSelect = document.createElement('select');
      catSelect.className = 'select';
      catSelect.classList.add('tp3d-flex-1');
      const catOptions = CategoryService.all();
      const currentKey = catOptions.find(c => c.key === initial.category) ? initial.category : 'default';
      catOptions.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.key;
        opt.textContent = c.name || CategoryService.meta(c.key).name;
        catSelect.appendChild(opt);
      });
      catSelect.value = currentKey;
      const updateSwatch = () => {
        const meta = CategoryService.meta(catSelect.value || 'default');
        catColorSwatch.style.background = meta.color || '#9ca3af';
      };
      catSelect.addEventListener('change', updateSwatch);
      updateSwatch();
      catRow.appendChild(catColorSwatch);
      catRow.appendChild(catSelect);
      catWrap.appendChild(catLabel);
      catWrap.appendChild(catRow);

      const fL = field(`Length (${lengthUnit})`, 'number', '', true);
      const fW = field(`Width (${lengthUnit})`, 'number', '', true);
      const fH = field(`Height (${lengthUnit})`, 'number', '', true);
      fL.input.value = String(Utils.inchesToUnit(initial.dimensions.length, lengthUnit));
      fW.input.value = String(Utils.inchesToUnit(initial.dimensions.width, lengthUnit));
      fH.input.value = String(Utils.inchesToUnit(initial.dimensions.height, lengthUnit));

      const fWeight = field(`Weight (${weightUnit})`, 'number', '', false);
      fWeight.input.step = '0.1';
      const weightValue = Utils.poundsToUnit(Number(initial.weight) || 0, weightUnit);
      fWeight.input.value = String(Math.round(weightValue * 100) / 100);

      const flipRow = document.createElement('label');
      flipRow.classList.add('tp3d-cases-flip-row');
      flipRow.classList.add('tp3d-grid-span-full');
      const flip = document.createElement('input');
      flip.type = 'checkbox';
      flip.checked = Boolean(initial.canFlip);
      const flipText = document.createElement('span');
      flipText.textContent = 'Can be flipped';
      flipRow.appendChild(flip);
      flipRow.appendChild(flipText);

      const notesWrap = document.createElement('div');
      notesWrap.className = 'field';
      notesWrap.classList.add('tp3d-grid-span-full');
      const notesLabel = document.createElement('div');
      notesLabel.className = 'label';
      notesLabel.textContent = 'Notes';
      const notes = document.createElement('textarea');
      notes.className = 'input';
      notes.classList.add('tp3d-textarea-minh-60');
      notes.value = initial.notes || '';
      notesWrap.appendChild(notesLabel);
      notesWrap.appendChild(notes);

      content.appendChild(fName.wrap);
      content.appendChild(fMfg.wrap);
      content.appendChild(catWrap);
      content.appendChild(fL.wrap);
      content.appendChild(fW.wrap);
      content.appendChild(fH.wrap);
      content.appendChild(fWeight.wrap);
      content.appendChild(flipRow);
      content.appendChild(notesWrap);

      UIComponents.showModal({
        title: isEdit ? 'Edit Case' : 'New Case',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Save',
            variant: 'primary',
            onClick: () => {
              const name = String(fName.input.value || '').trim();
              if (!name) {
                UIComponents.showToast('Name is required', 'warning');
                fName.input.focus();
                return;
              }
              const length = Utils.unitToInches(Number(fL.input.value) || 0, lengthUnit);
              const width = Utils.unitToInches(Number(fW.input.value) || 0, lengthUnit);
              const height = Utils.unitToInches(Number(fH.input.value) || 0, lengthUnit);
              if (length <= 0 || width <= 0 || height <= 0) {
                UIComponents.showToast('Dimensions must be > 0', 'warning');
                return;
              }
              const weightLb = Utils.unitToPounds(Number(fWeight.input.value) || 0, weightUnit);
              const categoryKey = String(catSelect.value || 'default');
              const catMeta = CategoryService.meta(categoryKey);
              const caseData = {
                ...initial,
                name,
                manufacturer: String(fMfg.input.value || '').trim(),
                category: categoryKey,
                dimensions: { length, width, height },
                weight: weightLb,
                canFlip: Boolean(flip.checked),
                notes: String(notes.value || '').trim(),
                color: catMeta.color || '#ff9f1c',
              };
              CaseLibrary.upsert(caseData);
              UIComponents.showToast('Case saved', 'success');
              render();
            },
          },
        ],
      });
    }

    function toggleCategoriesPopover(anchorEl) {
      if (!anchorEl) return;
      const open = document.querySelector('[data-dropdown="1"][data-role="categories"]');
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
          rightIconColor: 'var(--text-muted)',
          rightTitle: 'Edit',
          rightOnClick: () => openEditCategoryModal(cat),
        });
      });

      items.push({ type: 'divider' });
      items.push({
        label: 'New category',
        icon: 'fa-solid fa-plus',
        onClick: () => createCategoryAndEdit(),
      });

      const rect = anchorEl.getBoundingClientRect();
      UIComponents.openDropdown(anchorEl, items, {
        align: 'right',
        width: Math.max(220, rect.width),
        role: 'categories',
      });
    }

    function createCategoryAndEdit() {
      const baseName = 'New Category';
      let idx = 1;
      let name = baseName;
      const existing = new Set(CategoryService.all().map(c => String(c.name || '').toLowerCase()));
      while (existing.has(name.toLowerCase())) {
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

      const color = document.createElement('input');
      color.type = 'color';
      color.className = 'input';
      color.value = initial.color || '#9ca3af';
      color.classList.add('tp3d-cases-color-btn');

      const row = document.createElement('div');
      row.classList.add('tp3d-cases-color-row');
      row.appendChild(color);
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
                    UIComponents.confirm({
                      title: `Delete "${initial.name}"?`,
                      message: 'All cases in this category will be moved to Default.',
                      okLabel: 'Delete',
                      danger: true,
                    }).then(ok => {
                      if (!ok) return;
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
              const nextName = String(name.value || '').trim();
              if (!nextName) {
                UIComponents.showToast('Name is required', 'warning');
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
        CategoryService.all().forEach(cat => {
          const row = document.createElement('div');
          row.className = 'card';
          row.classList.add('tp3d-cases-catmgr-row');

          const colorWrap = document.createElement('div');
          colorWrap.classList.add('tp3d-cases-catmgr-color-wrap');
          const color = document.createElement('input');
          color.type = 'color';
          color.value = cat.color || '#9ca3af';
          color.className = 'input';
          color.classList.add('tp3d-cases-catmgr-color-input');
          colorWrap.appendChild(color);

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
          saveBtn.title = 'Save changes';
          saveBtn.addEventListener('click', () => {
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
            delBtn.title = 'Delete category';
            delBtn.addEventListener('click', async () => {
              const ok = await UIComponents.confirm({
                title: `Delete "${cat.name}"?`,
                message: 'All cases in this category will be moved to Default.',
                okLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
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
        const baseName = 'New Category';
        let idx = 1;
        let name = baseName;
        const existing = new Set(CategoryService.all().map(c => c.name.toLowerCase()));
        while (existing.has(name.toLowerCase())) {
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

    function normalizeHex(value) {
      const s = String(value || '').trim();
      const m = s.match(/^#([0-9a-f]{6})$/i);
      return m ? `#${m[1].toLowerCase()}` : null;
    }

    function field(label, type, placeholder, required) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = required ? `${label} (required)` : label;
      const input = document.createElement('input');
      input.className = 'input';
      input.type = type;
      input.placeholder = placeholder || '';
      wrap.appendChild(l);
      wrap.appendChild(input);
      return { wrap, input };
    }

    async function deleteCase(caseId) {
      const caseData = CaseLibrary.getById(caseId);
      if (!caseData) return;
      const packsUsing = PackLibrary.getPacks().filter(p => (p.cases || []).some(i => i.caseId === caseId));
      const msg = packsUsing.length
        ? `This case is used in ${packsUsing.length} pack(s). Deleting it will remove it from those packs.`
        : 'This cannot be undone.';
      const ok = await UIComponents.confirm({
        title: `Delete "${caseData.name}"?`,
        message: msg,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;

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
