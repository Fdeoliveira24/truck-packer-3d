/**
 * @file packs-screen.js
 * @description Screen factory responsible for rendering and binding UI for a specific screen.
 * @module screens/packs-screen
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Packs screen (extracted from src/app.js; behavior preserved)

import * as FolderLibrary from '../services/folder-library.js';

export function createPacksScreen({
  Utils,
  UIComponents,
  PreferencesManager,
  PackLibrary,
  CaseLibrary,
  StateStore,
  TrailerPresets,
  ImportExport,
  ImportPackDialog,
  createTableFooter,
  AppShell,
  ExportService,
  CardDisplayOverlay,
  featureFlags,
  persistNow,
  toast,
  toAscii: _toAscii,
}) {
  const PacksUI = (() => {
    const searchEl = /** @type {HTMLInputElement} */ (document.getElementById('packs-search'));
    const gridEl = /** @type {HTMLElement} */ (document.getElementById('packs-grid'));
    const listEl = /** @type {HTMLElement} */ (document.getElementById('packs-list'));
    const tbodyEl = /** @type {HTMLElement} */ (document.getElementById('packs-tbody'));
    const emptyEl = /** @type {HTMLElement} */ (document.getElementById('packs-empty'));
    const filterEmptyEl = /** @type {HTMLElement} */ (document.getElementById('packs-filter-empty'));
    const filterEmptyMsg = /** @type {HTMLElement} */ (document.getElementById('packs-filter-empty-msg'));
    const btnNew = document.getElementById('btn-new-pack');
    const btnImport = document.getElementById('btn-import-pack');
    const chipEmpty = document.getElementById('packs-filter-chip-empty');
    const chipPartial = document.getElementById('packs-filter-chip-partial');
    const chipFull = document.getElementById('packs-filter-chip-full');
    const btnViewGrid = document.getElementById('packs-view-grid');
    const btnViewList = document.getElementById('packs-view-list');
    const btnTrailerPresets = document.getElementById('packs-trailer-presets');
    const btnFiltersToggle = document.getElementById('packs-filters-toggle');
    const btnCardDisplay = document.getElementById('packs-card-display');
    const selectAllEl = /** @type {HTMLInputElement} */ (document.getElementById('packs-select-all'));
    const defaultActionsEl = /** @type {HTMLElement} */ (document.getElementById('packs-actions-default'));
    const bulkActionsEl = /** @type {HTMLElement} */ (document.getElementById('packs-actions-bulk'));
    const bulkCountEl = /** @type {HTMLElement} */ (document.getElementById('packs-selected-count'));
    const btnBulkDelete = document.getElementById('btn-packs-bulk-delete');

    const UNFILED_FOLDER_ID = '__unfiled__';
    const FOLDERS_DROPDOWN_ROLE = 'packs-folders';
    const FOLDERS_DROPDOWN_ANCHOR_KEY = 'packs-folders-button';
    const filters = { empty: false, partial: false, full: false };
    const selectedIds = new Set();
    let activeFolderId = null;
    let datasetKey = '';
    let sortKey = 'edited-desc';
    const packsListState = {
      pageIndex: 0,
      rowsPerPage: 50,
    };
    let footerController = null;
    let footerMountEl = null;
    let filteredPacks = [];
    const filtersRowEl = chipEmpty ? chipEmpty.parentElement : null;
    let foldersButtonEl = null;
    let foldersButtonLabelEl = null;

    function formatTruckDims(truck, lengthUnit) {
      const unit = lengthUnit || 'in';
      const l = Utils.formatLength(truck && truck.length, unit);
      const w = Utils.formatLength(truck && truck.width, unit);
      const h = Utils.formatLength(truck && truck.height, unit);
      return `Truck: L ${l} • W ${w} • H ${h}`;
    }

    function trailerModeLabel(shapeMode) {
      const mode = String(shapeMode || 'rect');
      if (mode === 'wheelWells') return 'Box + Wheel Wells';
      if (mode === 'frontBonus') return 'Box + Front Overhang';
      return 'Standard';
    }

    function formatPackStats(stats, prefs) {
      const loaded = stats && Number.isFinite(stats.totalCases) ? stats.totalCases : 0;
      const packed = stats && Number.isFinite(stats.packedCases) ? stats.packedCases : 0;
      const pct = stats && Number.isFinite(stats.volumePercent) ? stats.volumePercent : 0;
      const weight = Utils.formatWeight(stats && stats.totalWeight, prefs.units.weight);
      return `Packed: ${packed}/${loaded} • Volume: ${pct.toFixed(1)}% • Weight: ${weight}`;
    }

    function initPacksUI() {
      searchEl.addEventListener(
        'input',
        Utils.debounce(() => {
          packsListState.pageIndex = 0;
          render();
        }, 200)
      );
      searchEl.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') {
          searchEl.value = '';
          packsListState.pageIndex = 0;
          render();
          searchEl.blur();
        }
      });
      wireChip(chipEmpty, 'empty');
      wireChip(chipPartial, 'partial');
      wireChip(chipFull, 'full');
      btnNew.addEventListener('click', () => openNewPackModal());
      btnImport.addEventListener('click', () => openImportPackDialog());
      ensureFoldersButton();
      btnViewGrid.addEventListener('click', () => setViewMode('grid'));
      btnViewList.addEventListener('click', () => setViewMode('list'));
      if (!featureFlags.trailerPresetsEnabled && btnTrailerPresets) btnTrailerPresets.style.display = 'none';
      if (featureFlags.trailerPresetsEnabled && btnTrailerPresets) {
        btnTrailerPresets.addEventListener('click', ev => {
          ev.stopPropagation();
          openTrailerPresetsMenu(btnTrailerPresets);
        });
      }
      btnFiltersToggle && btnFiltersToggle.addEventListener('click', () => toggleFiltersVisible());
      btnCardDisplay &&
        btnCardDisplay.addEventListener('click', () => {
          // TODO: Add keyboard shortcut + update Keyboard Shortcuts modal later
          CardDisplayOverlay.open({ screen: 'packs' });
        });
      selectAllEl.addEventListener('change', handleSelectAll);
      btnBulkDelete.addEventListener('click', handleBulkDelete);
      initListHeaderSort();
      updateViewButtons();
      initFooter();
    }

    function openTrailerPresetsMenu(anchorEl) {
      if (!anchorEl) return;
      if (!featureFlags.trailerPresetsEnabled) return;

      const selected = Array.from(selectedIds);
      let packId = null;
      if (selected.length === 1) {
        packId = selected[0];
      } else if (selected.length === 0) {
        if (filteredPacks && filteredPacks.length === 1) {
          packId = filteredPacks[0].id;
        } else {
          UIComponents.showToast('Select a pack first', 'warning');
          return;
        }
      } else {
        UIComponents.showToast('Select a single pack first', 'warning');
        return;
      }
      const pack = PackLibrary.getById(packId);
      if (!pack) {
        UIComponents.showToast('Pack not found', 'error');
        return;
      }

      const items = /** @type {any[]} */ ([{ type: 'header', label: 'Trailer Presets' }]);
      TrailerPresets.getAll().forEach(p => {
        items.push({
          label: p.label,
          icon: 'fa-solid fa-truck',
          onClick: () => {
            const nextTruck = TrailerPresets.applyToTruck(pack.truck, p);
            PackLibrary.update(pack.id, { truck: nextTruck });
            UIComponents.showToast(`Applied preset: ${p.label}`, 'success');
            render();
          },
        });
      });

      const rect = anchorEl.getBoundingClientRect();
      UIComponents.openDropdown(anchorEl, items, {
        align: 'right',
        width: Math.max(260, rect.width),
        role: 'trailer-presets',
      });
    }

    function toggleFiltersVisible() {
      const prefs = PreferencesManager.get();
      prefs.packsFiltersVisible = !prefs.packsFiltersVisible;
      PreferencesManager.set(prefs);
      applyFiltersVisibility();
    }

    function applyFiltersVisibility() {
      if (!filtersRowEl) return;
      const visible = PreferencesManager.get().packsFiltersVisible !== false;
      filtersRowEl.style.display = visible ? '' : 'none';
      btnFiltersToggle && btnFiltersToggle.classList.toggle('btn-primary', visible);
    }

    function getSafeFolders() {
      try {
        const folders = FolderLibrary.listFolders();
        return Array.isArray(folders) ? folders.filter(folder => folder && folder.id) : [];
      } catch (_err) {
        return [];
      }
    }

    function persistFolderStateNow() {
      if (typeof persistNow !== 'function') return;
      try {
        persistNow();
      } catch (_err) {
        // Autosave remains the fallback; this only closes the immediate-reload gap.
      }
    }

    function getFolderFilterModel(allPacks) {
      const packs = Array.isArray(allPacks) ? allPacks : [];
      const folders = getSafeFolders();
      const folderIds = new Set(folders.map(folder => String(folder.id)));
      if (activeFolderId && activeFolderId !== UNFILED_FOLDER_ID && !folderIds.has(activeFolderId)) {
        activeFolderId = null;
      }

      const counts = new Map();
      let unfiledCount = 0;
      packs.forEach(pack => {
        const folderId = pack && pack.folderId ? String(pack.folderId) : null;
        if (!folderId) {
          unfiledCount += 1;
          return;
        }
        counts.set(folderId, (counts.get(folderId) || 0) + 1);
      });

      return {
        folders,
        totalCount: packs.length,
        unfiledCount,
        counts,
        activeFolder: activeFolderId
          ? folders.find(folder => String(folder.id) === activeFolderId) || null
          : null,
      };
    }

    function setActiveFolderFilter(folderIdOrNull) {
      activeFolderId = folderIdOrNull == null ? null : String(folderIdOrNull);
      packsListState.pageIndex = 0;
      render();
    }

    function ensureFoldersButton() {
      if (foldersButtonEl && foldersButtonEl.isConnected) return foldersButtonEl;
      if (!defaultActionsEl) return null;

      foldersButtonEl = document.createElement('button');
      foldersButtonEl.type = 'button';
      foldersButtonEl.className = 'btn tp3d-packs-folder-btn';
      foldersButtonEl.setAttribute('aria-label', 'Filter packs by folder');
      foldersButtonEl.setAttribute('aria-haspopup', 'menu');
      foldersButtonEl.setAttribute('aria-expanded', 'false');

      const iconWrap = document.createElement('span');
      iconWrap.className = 'tp3d-packs-folder-btn__icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-folder';
      iconWrap.appendChild(icon);
      foldersButtonEl.appendChild(iconWrap);

      foldersButtonLabelEl = document.createElement('span');
      foldersButtonLabelEl.className = 'tp3d-packs-folder-btn__label';
      foldersButtonLabelEl.textContent = 'Folders';
      foldersButtonEl.appendChild(foldersButtonLabelEl);

      // caret removed: keep icon + label only (caret UI not needed for now)

      foldersButtonEl.addEventListener('click', ev => {
        ev.stopPropagation();
        openFoldersDropdown();
      });

      if (btnImport && btnImport.parentElement === defaultActionsEl) {
        defaultActionsEl.insertBefore(foldersButtonEl, btnImport);
      } else {
        defaultActionsEl.insertBefore(foldersButtonEl, defaultActionsEl.firstChild);
      }
      return foldersButtonEl;
    }

    function renderFoldersButton(allPacks) {
      const button = ensureFoldersButton();
      if (!button || !foldersButtonLabelEl) return;
      const model = getFolderFilterModel(allPacks);
      let label = 'Folders';
      if (activeFolderId === UNFILED_FOLDER_ID) {
        label = 'Unfiled';
      } else if (activeFolderId && model.activeFolder) {
        label = model.activeFolder.name || 'Untitled Folder';
      }
      foldersButtonLabelEl.textContent = label;
      button.classList.toggle('tp3d-packs-folder-btn--active', Boolean(activeFolderId));
    }

    function getOpenFoldersDropdown() {
      return document.querySelector(
        `[data-dropdown="1"][data-role="${FOLDERS_DROPDOWN_ROLE}"][data-anchor-id="${FOLDERS_DROPDOWN_ANCHOR_KEY}"]`
      );
    }

    function setFoldersButtonExpanded(expanded) {
      const button = ensureFoldersButton();
      if (!button) return;
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function syncFoldersButtonExpandedFromDom() {
      if (!getOpenFoldersDropdown()) setFoldersButtonExpanded(false);
    }

    function handleFoldersDropdownEscape(ev) {
      if (ev.key !== 'Escape') return;
      document.removeEventListener('keydown', handleFoldersDropdownEscape);
      setTimeout(syncFoldersButtonExpandedFromDom, 0);
    }

    function bindFoldersDropdownCloseSync() {
      document.removeEventListener('keydown', handleFoldersDropdownEscape);
      document.addEventListener('keydown', handleFoldersDropdownEscape);
      setTimeout(() => {
        document.addEventListener(
          'click',
          () => {
            document.removeEventListener('keydown', handleFoldersDropdownEscape);
            setTimeout(syncFoldersButtonExpandedFromDom, 0);
          },
          { once: true }
        );
      }, 0);
    }

    function selectFolderFilter(folderIdOrNull) {
      setFoldersButtonExpanded(false);
      setActiveFolderFilter(folderIdOrNull);
    }

    function openCreateFolderModal() {
      const content = document.createElement('div');
      content.classList.add('tp3d-packs-modal-grid');

      const name = field('Folder name', 'text', 'e.g. Client A', false);
      name.wrap.classList.add('tp3d-grid-span-full');
      content.appendChild(name.wrap);

      UIComponents.showModal({
        title: 'New Folder',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Create',
            variant: 'primary',
            onClick: () => {
              const folderName = String(name.input.value || '').trim();
              const created = FolderLibrary.createFolder(folderName);
              persistFolderStateNow();
              if (created && created.id) {
                activeFolderId = String(created.id);
                packsListState.pageIndex = 0;
              }
              render();
              UIComponents.showToast('Folder created', 'success');
            },
          },
        ],
      });
    }

    function openRenameFolderModal(folder) {
      if (!folder || !folder.id) return;
      const folderId = String(folder.id);
      const content = document.createElement('div');
      content.classList.add('tp3d-packs-modal-grid');

      const name = field('Folder name', 'text', 'e.g. Client A', false);
      name.input.value = folder.name || '';
      name.wrap.classList.add('tp3d-grid-span-full');
      content.appendChild(name.wrap);

      UIComponents.showModal({
        title: 'Rename Folder',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Save',
            variant: 'primary',
            onClick: () => {
              const renamed = FolderLibrary.renameFolder(folderId, name.input.value);
              if (!renamed) {
                UIComponents.showToast('Could not rename folder', 'warning');
                return;
              }
              persistFolderStateNow();
              render();
              UIComponents.showToast('Folder renamed', 'success');
            },
          },
        ],
      });
    }

    async function deleteFolderWithConfirm(folder) {
      if (!folder || !folder.id) return;
      const folderId = String(folder.id);
      const folderName = folder.name || 'Untitled Folder';
      const affectedCount = PackLibrary.getPacks().filter(pack => pack && String(pack.folderId || '') === folderId).length;
      const ok = await UIComponents.confirm({
        title: 'Delete folder?',
        message: `Delete "${folderName}"? ${affectedCount} pack(s) in this folder will move to Unfiled. Packs will not be deleted.`,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;

      const deleted = FolderLibrary.deleteFolder(folderId);
      if (!deleted) {
        UIComponents.showToast('Could not delete folder', 'warning');
        return;
      }
      persistFolderStateNow();
      if (activeFolderId === folderId) {
        activeFolderId = null;
        packsListState.pageIndex = 0;
      }
      render();
      UIComponents.showToast('Folder deleted', 'success');
    }

    function movePackToFolder(pack, folderIdOrNull) {
      if (!pack || !pack.id) return false;
      const moved = FolderLibrary.movePackToFolder(pack.id, folderIdOrNull);
      if (!moved) {
        UIComponents.showToast('Could not move pack to folder', 'warning');
        return false;
      }
      persistFolderStateNow();
      packsListState.pageIndex = 0;
      render();
      UIComponents.showToast(folderIdOrNull ? 'Pack moved to folder' : 'Pack moved to Unfiled', 'success');
      return true;
    }

    function openMoveToFolderModal(pack) {
      if (!pack || !pack.id) return;
      const folders = getSafeFolders();
      const currentFolderId = pack.folderId ? String(pack.folderId) : null;
      const content = document.createElement('div');
      content.classList.add('tp3d-packs-modal-grid');
      let modalRef = null;

      const addMoveRow = (label, iconClass, folderIdOrNull, disabled = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn tp3d-packs-folder-option-btn tp3d-grid-span-full';
        button.disabled = disabled;
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');
        icon.classList.add('tp3d-packs-folder-option-btn__icon');
        button.appendChild(icon);
        const labelEl = document.createElement('span');
        labelEl.className = 'tp3d-packs-folder-option-btn__label';
        labelEl.textContent = label;
        button.appendChild(labelEl);
        if (disabled) {
          const currentEl = document.createElement('span');
          currentEl.className = 'tp3d-packs-folder-option-btn__meta';
          currentEl.textContent = 'Current';
          button.appendChild(currentEl);
        }
        button.addEventListener('click', () => {
          if (disabled) return;
          const moved = movePackToFolder(pack, folderIdOrNull);
          if (moved && modalRef && typeof modalRef.close === 'function') modalRef.close();
        });
        content.appendChild(button);
      };

      addMoveRow('Unfiled', 'fa-solid fa-folder-open', null, currentFolderId === null);

      if (folders.length > 0) {
        folders.forEach(folder => {
          const folderId = String(folder.id);
          addMoveRow(folder.name || 'Untitled Folder', 'fa-solid fa-folder', folderId, currentFolderId === folderId);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'muted tp3d-grid-span-full';
        empty.textContent = 'No folders yet';
        content.appendChild(empty);
      }

      modalRef = UIComponents.showModal({
        title: 'Move to Folder',
        content,
        actions: [
          { label: 'Close' },
        ],
      });
    }

    function openFoldersDropdown() {
      const button = ensureFoldersButton();
      if (!button) return;
      const existing = getOpenFoldersDropdown();
      if (existing) {
        UIComponents.closeAllDropdowns();
        setFoldersButtonExpanded(false);
        return;
      }
      const model = getFolderFilterModel(PackLibrary.getPacks().slice());
      const items = /** @type {any[]} */ ([
        { type: 'header', label: 'Folders' },
        {
          label: `All Packs (${model.totalCount})`,
          icon: 'fa-solid fa-layer-group',
          active: activeFolderId === null,
          rightIcon: activeFolderId === null ? 'fa-solid fa-check' : '',
          onClick: () => selectFolderFilter(null),
        },
        {
          label: `Unfiled (${model.unfiledCount})`,
          icon: 'fa-solid fa-folder-open',
          active: activeFolderId === UNFILED_FOLDER_ID,
          rightIcon: activeFolderId === UNFILED_FOLDER_ID ? 'fa-solid fa-check' : '',
          onClick: () => selectFolderFilter(UNFILED_FOLDER_ID),
        },
      ]);

      if (model.folders.length) {
        items.push({ type: 'divider' });
        model.folders.forEach(folder => {
          const folderId = String(folder.id);
          items.push({
            label: `${folder.name || 'Untitled Folder'} (${model.counts.get(folderId) || 0})`,
            icon: 'fa-solid fa-folder',
            active: activeFolderId === folderId,
            rightIcon: activeFolderId === folderId ? 'fa-solid fa-check' : '',
            onClick: () => selectFolderFilter(folderId),
          });
        });
      } else {
        items.push({
          label: 'No folders yet',
          icon: 'fa-solid fa-folder',
          disabled: true,
        });
      }

      if (model.activeFolder && activeFolderId) {
        items.push(
          { type: 'divider' },
          {
            label: 'Rename Folder',
            icon: 'fa-solid fa-pen',
            onClick: () => {
              UIComponents.closeAllDropdowns();
              setFoldersButtonExpanded(false);
              openRenameFolderModal(model.activeFolder);
            },
          },
          {
            label: 'Delete Folder',
            icon: 'fa-solid fa-trash-can',
            danger: true,
            onClick: () => {
              UIComponents.closeAllDropdowns();
              setFoldersButtonExpanded(false);
              deleteFolderWithConfirm(model.activeFolder);
            },
          }
        );
      }

      items.push(
        { type: 'divider' },
        {
          label: 'New Folder',
          icon: 'fa-solid fa-folder-plus',
          onClick: () => {
            UIComponents.closeAllDropdowns();
            setFoldersButtonExpanded(false);
            openCreateFolderModal();
          },
        }
      );

      setFoldersButtonExpanded(true);
      UIComponents.openDropdown(button, items, {
        role: FOLDERS_DROPDOWN_ROLE,
        anchorKey: FOLDERS_DROPDOWN_ANCHOR_KEY,
        align: 'left',
        width: 260,
      });
      bindFoldersDropdownCloseSync();
    }

    function initListHeaderSort() {
      const headers = document.querySelectorAll('#packs-list thead th[data-sort]');
      headers.forEach(th => {
        const thEl = /** @type {HTMLElement} */ (th);
        const sortField = thEl.dataset.sort;
        const button = th.querySelector('.th-sort');
        if (!button) return;
        const toggleSort = () => {
          const ascKey = `${sortField}-asc`;
          const descKey = `${sortField}-desc`;
          if (sortKey === ascKey) {
            sortKey = descKey;
          } else if (sortKey === descKey) {
            sortKey = ascKey;
          } else {
            sortKey = ascKey;
          }
          packsListState.pageIndex = 0;
          render();
          updateListHeaderIcons();
        };
        button.addEventListener('click', toggleSort);
        button.addEventListener(
          'keydown',
          /** @param {KeyboardEvent} ev */ ev => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              toggleSort();
            }
          }
        );
      });
      updateListHeaderIcons();
    }

    function updateListHeaderIcons() {
      const headers = document.querySelectorAll('#packs-list thead th[data-sort]');
      headers.forEach(th => {
        const thEl = /** @type {HTMLElement} */ (th);
        const sortField = thEl.dataset.sort;
        const button = th.querySelector('.th-sort');
        if (!button) return;
        button.classList.toggle('is-asc', sortKey === `${sortField}-asc`);
        button.classList.toggle('is-desc', sortKey === `${sortField}-desc`);
      });
    }

    function setViewMode(mode) {
      const prefs = PreferencesManager.get();
      prefs.packsViewMode = mode;
      PreferencesManager.set(prefs);
      updateViewButtons();
      render();
    }

    function updateViewButtons() {
      const mode = PreferencesManager.get().packsViewMode || 'grid';
      btnViewGrid.classList.toggle('btn-primary', mode === 'grid');
      btnViewList.classList.toggle('btn-primary', mode === 'list');
    }

    function getPacksFooterMountElForMode(_mode) {
      // Footer must be appended directly to #screen-packs to match CSS selector
      return document.getElementById('screen-packs');
    }

    function initFooter(mode) {
      const mountEl = getPacksFooterMountElForMode(mode);
      if (!mountEl) return;
      if (footerController && footerMountEl === mountEl) return;
      if (footerController) footerController.destroy();
      footerMountEl = mountEl;
      footerController = createTableFooter({
        mountEl,
        onPageChange: ({ pageIndex: nextIndex, rowsPerPage }) => {
          if (typeof rowsPerPage === 'number') {
            packsListState.rowsPerPage = rowsPerPage;
          }
          packsListState.pageIndex = nextIndex;
          render();
        },
        onRowsPerPageChange: nextRows => {
          if (nextRows === packsListState.rowsPerPage) return;
          packsListState.rowsPerPage = nextRows;
          packsListState.pageIndex = 0;
          render();
        },
        onSelectAllToggle: applySelectAllFiltered,
      });
    }

    function getPageMeta(list) {
      const items = Array.isArray(list) ? list : [];
      const perPage = Math.max(packsListState.rowsPerPage, 1);
      const total = items.length;
      const pageCount = Math.max(0, Math.ceil(total / perPage || 0));
      const clampedIndex = pageCount === 0 ? 0 : Math.min(Math.max(0, packsListState.pageIndex), pageCount - 1);
      packsListState.pageIndex = clampedIndex;
      const start = clampedIndex * perPage;
      return {
        total,
        pageCount,
        slice: items.slice(start, start + perPage),
      };
    }

    function syncFooterState(meta) {
      if (!footerController) return;
      const perPage = Math.max(packsListState.rowsPerPage, 1);
      const effectiveMeta = meta || {
        total: filteredPacks.length,
        pageCount: Math.max(0, Math.ceil(filteredPacks.length / perPage || 0)),
      };
      const pageCount = effectiveMeta.pageCount;
      const clampedIndex = pageCount === 0 ? 0 : Math.min(Math.max(0, packsListState.pageIndex), pageCount - 1);
      packsListState.pageIndex = clampedIndex;
      const filteredIds = new Set(filteredPacks.map(p => p.id));
      Array.from(selectedIds).forEach(id => {
        if (!filteredIds.has(id)) selectedIds.delete(id);
      });
      const selectedCount = filteredPacks.filter(p => selectedIds.has(p.id)).length;
      const allSelected = filteredPacks.length > 0 && filteredPacks.every(p => selectedIds.has(p.id));
      const someSelected = selectedCount > 0 && !allSelected;
      footerController.setState({
        selectedCount,
        totalCount: effectiveMeta.total,
        pageIndex: packsListState.pageIndex,
        pageCount,
        rowsPerPage: packsListState.rowsPerPage,
        selectAllVisible: effectiveMeta.total > 0,
        selectAllChecked: allSelected,
        selectAllIndeterminate: someSelected,
      });
    }

    function wireChip(el, key) {
      if (!el) return;
      const toggle = () => {
        filters[key] = !filters[key];
        el.classList.toggle('active', filters[key]);
        packsListState.pageIndex = 0;
        render();
      };
      el.addEventListener('click', toggle);
      el.addEventListener(
        'keydown',
        /** @param {KeyboardEvent} ev */ ev => {
          if (ev.key === 'Enter' || ev.key === ' ') toggle();
        }
      );
    }

    function handleSelectAll() {
      const shouldSelect = Boolean(selectAllEl && selectAllEl.checked);
      applySelectAllFiltered(shouldSelect);
    }

    function applySelectAllFiltered(shouldSelect) {
      selectedIds.clear();
      if (shouldSelect) {
        const ids = Array.isArray(filteredPacks) ? filteredPacks.map(p => p.id) : [];
        ids.forEach(id => selectedIds.add(id));
      }
      render();
    }

    function updateBulkActions() {
      const mode = PreferencesManager.get().packsViewMode || 'grid';
      const count = selectedIds.size;
      if (count > 0) {
        defaultActionsEl.style.display = 'none';
        bulkActionsEl.style.display = 'flex';
        bulkCountEl.textContent = `${count} pack${count === 1 ? '' : 's'} selected`;
        btnBulkDelete.innerHTML = `<i class="fa-solid fa-trash"></i> Delete (${count})`;
        const visiblePacks = Array.isArray(filteredPacks) ? filteredPacks : [];
        const allSelected = visiblePacks.length > 0 && visiblePacks.every(p => selectedIds.has(p.id));
        const someSelected = visiblePacks.some(p => selectedIds.has(p.id));
        selectAllEl.checked = mode === 'list' ? allSelected : false;
        selectAllEl.indeterminate = mode === 'list' ? someSelected && !allSelected : false;
      } else {
        defaultActionsEl.style.display = 'flex';
        bulkActionsEl.style.display = 'none';
        selectAllEl.checked = false;
        selectAllEl.indeterminate = false;
      }
    }

    async function handleBulkDelete() {
      const count = selectedIds.size;
      if (count === 0) return;
      const idsToDelete = Array.from(selectedIds);
      const ok = await UIComponents.confirm({
        title: 'Delete packs?',
        message: `This will permanently delete ${count} pack(s). This cannot be undone.`,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;

      const currentPackId = StateStore.get('currentPackId');
      const isCurrentDeleted = currentPackId && idsToDelete.includes(currentPackId);
      idsToDelete.forEach(id => PackLibrary.remove(id));
      if (isCurrentDeleted) AppShell.navigate('packs');
      selectedIds.clear();
      UIComponents.showToast(`${count} pack(s) deleted`, 'success');
      render();
    }

    function render() {
      applyFiltersVisibility();
      const q = String(searchEl.value || '')
        .trim()
        .toLowerCase();
      const allPacks = PackLibrary.getPacks().slice();

      const compareTitle = (a, b) => (a.title || '').localeCompare(b.title || '');
      const compareCases = (a, b) => (a.cases || []).length - (b.cases || []).length;
      const compareLastEdited = (a, b) => (a.lastEdited || 0) - (b.lastEdited || 0);
      const compareCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
      const compareLength = (a, b) => (a.truck?.length || 0) - (b.truck?.length || 0);
      const compareWidth = (a, b) => (a.truck?.width || 0) - (b.truck?.width || 0);
      const compareHeight = (a, b) => (a.truck?.height || 0) - (b.truck?.height || 0);
      const compareMode = (a, b) =>
        trailerModeLabel(a && a.truck && a.truck.shapeMode).localeCompare(
          trailerModeLabel(b && b.truck && b.truck.shapeMode)
        );
      const comparePacked = (a, b) => ((a.stats && a.stats.packedCases) || 0) - ((b.stats && b.stats.packedCases) || 0);
      const compareVolume = (a, b) =>
        ((a.stats && Number.isFinite(a.stats.volumePercent) ? a.stats.volumePercent : 0) || 0) -
        ((b.stats && Number.isFinite(b.stats.volumePercent) ? b.stats.volumePercent : 0) || 0);
      const compareWeight = (a, b) =>
        ((a.stats && Number.isFinite(a.stats.totalWeight) ? a.stats.totalWeight : 0) || 0) -
        ((b.stats && Number.isFinite(b.stats.totalWeight) ? b.stats.totalWeight : 0) || 0);
      const sorters = {
        'edited-desc': (a, b) => compareLastEdited(b, a),
        'edited-asc': (a, b) => compareLastEdited(a, b),
        'title-asc': (a, b) => compareTitle(a, b),
        'title-desc': (a, b) => compareTitle(b, a),
        'cases-asc': (a, b) => compareCases(a, b),
        'cases-desc': (a, b) => compareCases(b, a),
        'created-desc': (a, b) => compareCreated(b, a),
        'created-asc': (a, b) => compareCreated(a, b),
        'length-asc': (a, b) => compareLength(a, b),
        'length-desc': (a, b) => compareLength(b, a),
        'width-asc': (a, b) => compareWidth(a, b),
        'width-desc': (a, b) => compareWidth(b, a),
        'height-asc': (a, b) => compareHeight(a, b),
        'height-desc': (a, b) => compareHeight(b, a),
        'mode-asc': (a, b) => compareMode(a, b),
        'mode-desc': (a, b) => compareMode(b, a),
        'packed-asc': (a, b) => comparePacked(a, b),
        'packed-desc': (a, b) => comparePacked(b, a),
        'volume-asc': (a, b) => compareVolume(a, b),
        'volume-desc': (a, b) => compareVolume(b, a),
        'weight-asc': (a, b) => compareWeight(a, b),
        'weight-desc': (a, b) => compareWeight(b, a),
      };
      allPacks.sort(sorters[sortKey] || sorters['edited-desc']);
      renderFoldersButton(allPacks);

      const packs = allPacks
        .filter(p => !q || (p.title || '').toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q))
        .filter(p => {
          if (activeFolderId === null) return true;
          const folderId = p && p.folderId ? String(p.folderId) : null;
          if (activeFolderId === UNFILED_FOLDER_ID) return folderId === null;
          return folderId === activeFolderId;
        })
        .filter(p => {
          if (!filters.empty && !filters.partial && !filters.full) return true;
          const total = (p.cases || []).length;
          const percent = p.stats && Number.isFinite(p.stats.volumePercent) ? p.stats.volumePercent : 0;
          const isEmpty = total === 0;
          const isFull = percent >= 99.999;
          const isPartial = !isEmpty && percent > 0 && !isFull;

          if (filters.empty && isEmpty) return true;
          if (filters.partial && isPartial) return true;
          if (filters.full && isFull) return true;
          return false;
        });

      filteredPacks = packs;

      const newDatasetKey = `${q}::${sortKey}::${activeFolderId || 'all'}::${filters.empty}${filters.partial}${filters.full}`;
      if (datasetKey !== newDatasetKey) {
        selectedIds.clear();
        datasetKey = newDatasetKey;
        packsListState.pageIndex = 0;
      }

      const pageMeta = getPageMeta(packs);
      const mode = PreferencesManager.get().packsViewMode || 'grid';
      initFooter(mode);
      gridEl.innerHTML = '';
      tbodyEl.innerHTML = '';

      if (!allPacks.length) {
        emptyEl.style.display = 'block';
        filterEmptyEl.style.display = 'none';
        gridEl.style.display = 'none';
        listEl.style.display = 'none';
        updateBulkActions();
        syncFooterState(pageMeta);
        return;
      }

      if (!packs.length) {
        emptyEl.style.display = 'none';
        filterEmptyMsg.textContent = q ? `No matching packs for "${q}"` : 'No matching packs';
        filterEmptyEl.style.display = 'block';
        gridEl.style.display = 'none';
        listEl.style.display = 'none';
        updateBulkActions();
        syncFooterState(pageMeta);
        return;
      }

      filterEmptyEl.style.display = 'none';
      emptyEl.style.display = 'none';

      if (mode === 'list') {
        gridEl.style.display = 'none';
        listEl.style.display = 'block';
        renderListView(pageMeta.slice);
      } else {
        gridEl.style.display = 'grid';
        listEl.style.display = 'none';
        renderGridView(pageMeta.slice);
      }
      updateListHeaderIcons();
      updateBulkActions();
      syncFooterState(pageMeta);
    }

    function resetWorkspaceState() {
      selectedIds.clear();
      filteredPacks = [];
      activeFolderId = null;
      datasetKey = '';
      packsListState.pageIndex = 0;
      if (selectAllEl) {
        selectAllEl.checked = false;
        selectAllEl.indeterminate = false;
      }
    }

    function renderListView(packs) {
      const prefs = PreferencesManager.get();
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.packs) || {};
      applyListColumnVisibility(prefs);
      packs.forEach(pack => {
        const tr = document.createElement('tr');
        const isSelected = selectedIds.has(pack.id);
        if (isSelected) tr.classList.add('selected');

        const tdCheck = document.createElement('td');
        tdCheck.classList.add('tp3d-packs-td-check-center');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isSelected;
        checkbox.setAttribute('aria-label', `Select ${pack.title || 'Untitled Pack'}`);
        checkbox.addEventListener('click', ev => ev.stopPropagation());
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            selectedIds.add(pack.id);
          } else {
            selectedIds.delete(pack.id);
          }
          tr.classList.toggle('selected', selectedIds.has(pack.id));
          updateBulkActions();
          syncFooterState();
        });
        tdCheck.appendChild(checkbox);

        const tdTitle = document.createElement('td');
        const titleWrap = document.createElement('div');
        titleWrap.classList.add('tp3d-packs-titlewrap');

        const title = document.createElement('div');
        title.textContent = pack.title || 'Untitled Pack';
        titleWrap.appendChild(title);

        const stats = PackLibrary.computeStats(pack);
        const truckLabel = formatTruckDims(pack.truck || {}, prefs.units.length);
        const statsLabel = formatPackStats(stats, prefs);

        tdTitle.setAttribute('data-tooltip', `${truckLabel} · ${statsLabel}`);
        tdTitle.appendChild(titleWrap);

        const tdCases = document.createElement('td');
        tdCases.textContent = (pack.cases || []).length;
        if (badgePrefs.showCasesCount === false) tdCases.style.display = 'none';

        const tdLength = document.createElement('td');
        tdLength.textContent = Utils.formatLength(pack.truck.length, prefs.units.length);
        if (badgePrefs.showTruckDims === false) tdLength.style.display = 'none';

        const tdWidth = document.createElement('td');
        tdWidth.textContent = Utils.formatLength(pack.truck.width, prefs.units.length);
        if (badgePrefs.showTruckDims === false) tdWidth.style.display = 'none';

        const tdHeight = document.createElement('td');
        tdHeight.textContent = Utils.formatLength(pack.truck.height, prefs.units.length);
        if (badgePrefs.showTruckDims === false) tdHeight.style.display = 'none';

        const tdMode = document.createElement('td');
        tdMode.textContent = trailerModeLabel(pack && pack.truck && pack.truck.shapeMode);
        if (badgePrefs.showShapeMode === false) tdMode.style.display = 'none';

        const tdPacked = document.createElement('td');
        const packedCases = stats && Number.isFinite(stats.packedCases) ? stats.packedCases : null;
        const totalCases = stats && Number.isFinite(stats.totalCases) ? stats.totalCases : null;
        tdPacked.textContent = packedCases === null || totalCases === null ? '—' : `${packedCases}/${totalCases}`;
        if (badgePrefs.showPacked === false) tdPacked.style.display = 'none';

        const tdVolume = document.createElement('td');
        const volumePercent = stats && Number.isFinite(stats.volumePercent) ? stats.volumePercent : null;
        tdVolume.textContent = volumePercent === null ? '—' : `${volumePercent.toFixed(1)}%`;
        if (badgePrefs.showVolume === false) tdVolume.style.display = 'none';

        const tdWeight = document.createElement('td');
        const totalWeight = stats && Number.isFinite(stats.totalWeight) ? stats.totalWeight : null;
        tdWeight.textContent = totalWeight === null ? '—' : Utils.formatWeight(totalWeight, prefs.units.weight);
        if (badgePrefs.showWeight === false) tdWeight.style.display = 'none';

        const tdEdited = document.createElement('td');
        tdEdited.textContent = Utils.formatRelativeTime(pack.lastEdited);
        if (badgePrefs.showEditedTime === false) tdEdited.style.display = 'none';

        const tdActions = document.createElement('td');
        tdActions.className = 'col-actions';
        const kebabBtn = document.createElement('button');
        kebabBtn.className = 'btn btn-ghost';
        kebabBtn.type = 'button';
        kebabBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        kebabBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          UIComponents.openDropdown(kebabBtn, [
            { label: 'Open', icon: 'fa-solid fa-folder-open', onClick: () => openPack(pack.id) },
            { label: 'Edit', icon: 'fa-solid fa-pen-to-square', onClick: () => openEditPackModal(pack.id) },
            { label: 'Rename', icon: 'fa-solid fa-i-cursor', onClick: () => openRename(pack.id) },
            {
              label: 'Duplicate',
              icon: 'fa-solid fa-clone',
              onClick: () => {
                PackLibrary.duplicate(pack.id);
                UIComponents.showToast('Pack duplicated', 'success');
              },
            },
            {
              label: 'Capture Preview',
              icon: 'fa-solid fa-image',
              onClick: () => ExportService.capturePackPreview(pack.id, { source: 'manual' }),
            },
            {
              label: 'Clear Preview',
              icon: 'fa-solid fa-ban',
              disabled: !pack.thumbnail,
              onClick: () => ExportService.clearPackPreview(pack.id),
            },
            { label: 'Export Pack JSON', icon: 'fa-solid fa-file-export', onClick: () => exportPack(pack.id) },
            {
              label: 'Move to Folder',
              icon: 'fa-solid fa-folder-open',
              onClick: () => openMoveToFolderModal(pack),
            },
            {
              label: 'Delete',
              icon: 'fa-solid fa-trash-can',
              variant: 'danger',
              dividerBefore: true,
              onClick: () => deletePack(pack.id),
            },
          ]);
        });
        tdActions.appendChild(kebabBtn);

        tr.addEventListener('click', () => openPack(pack.id));

        tr.appendChild(tdCheck);
        tr.appendChild(tdTitle);
        tr.appendChild(tdCases);
        tr.appendChild(tdLength);
        tr.appendChild(tdWidth);
        tr.appendChild(tdHeight);
        tr.appendChild(tdMode);
        tr.appendChild(tdPacked);
        tr.appendChild(tdVolume);
        tr.appendChild(tdWeight);
        tr.appendChild(tdEdited);
        tr.appendChild(tdActions);
        tbodyEl.appendChild(tr);
      });
    }

    function applyListColumnVisibility(prefs) {
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.packs) || {};
      const show = {
        cases: badgePrefs.showCasesCount !== false,
        length: badgePrefs.showTruckDims !== false,
        width: badgePrefs.showTruckDims !== false,
        height: badgePrefs.showTruckDims !== false,
        mode: badgePrefs.showShapeMode !== false,
        packed: badgePrefs.showPacked !== false,
        volume: badgePrefs.showVolume !== false,
        weight: badgePrefs.showWeight !== false,
        edited: badgePrefs.showEditedTime !== false,
      };
      Object.keys(show).forEach(key => {
        const th = /** @type {HTMLElement|null} */ (document.querySelector(`#packs-list thead th[data-sort="${key}"]`));
        if (th) th.style.display = show[key] ? '' : 'none';
      });
    }

    function renderGridView(packs) {
      const prefs = PreferencesManager.get();
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.packs) || {};
      packs.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'card pack-card';
        card.classList.toggle('selected', selectedIds.has(pack.id));
        card.tabIndex = 0;
        card.addEventListener('click', ev => {
          const targetEl = ev.target instanceof Element ? ev.target : null;
          if (targetEl && (targetEl.closest('[data-pack-menu]') || targetEl.closest('[data-pack-select]'))) {
            return;
          }
          openPack(pack.id);
        });
        card.addEventListener(
          'keydown',
          /** @param {KeyboardEvent} ev */ ev => {
            if (ev.key === 'Enter') openPack(pack.id);
          }
        );

        const preview = buildPreview(pack);

        const title = document.createElement('h3');
        title.textContent = pack.title || 'Untitled Pack';
        title.setAttribute('data-tooltip', pack.title || 'Untitled Pack');
        title.classList.add('tp3d-packs-card-title-truncate');

        const head = document.createElement('div');
        head.className = 'card-head';
        head.classList.add('tp3d-packs-card-head');

        const meta = document.createElement('div');
        meta.className = 'pack-meta';

        const badgesWrap = document.createElement('div');
        badgesWrap.className = 'pack-meta-badges';

        if (badgePrefs.showCasesCount !== false) {
          const count = document.createElement('div');
          count.className = 'badge';
          count.textContent = `Case count: ${(pack.cases || []).length}`;
          badgesWrap.appendChild(count);
        }

        if (badgePrefs.showTruckDims !== false) {
          const truck = document.createElement('div');
          truck.className = 'badge';
          truck.textContent = formatTruckDims(pack.truck || {}, prefs.units.length).replace(/^Truck:/, 'Dim:');
          badgesWrap.appendChild(truck);
        }

        if (badgePrefs.showShapeMode !== false) {
          const mode = document.createElement('div');
          mode.className = 'badge';
          mode.textContent = `Shape: ${trailerModeLabel(pack && pack.truck && pack.truck.shapeMode)}`;
          badgesWrap.appendChild(mode);
        }

        const showPacked = badgePrefs.showPacked !== false;
        const showVolume = badgePrefs.showVolume !== false;
        const showWeight = badgePrefs.showWeight !== false;
        if (showPacked || showVolume || showWeight) {
          const stats = PackLibrary.computeStats(pack);
          const loaded = stats && Number.isFinite(stats.totalCases) ? stats.totalCases : 0;
          const packed = stats && Number.isFinite(stats.packedCases) ? stats.packedCases : 0;
          const pct = stats && Number.isFinite(stats.volumePercent) ? stats.volumePercent : 0;
          const weight = Utils.formatWeight(stats && stats.totalWeight, prefs.units.weight);

          if (showPacked) {
            const packedBadge = document.createElement('div');
            packedBadge.className = 'badge';
            packedBadge.textContent = `Packed: ${packed}/${loaded}`;
            badgesWrap.appendChild(packedBadge);
          }
          if (showVolume) {
            const volBadge = document.createElement('div');
            volBadge.className = 'badge';
            volBadge.textContent = `Volume: ${pct.toFixed(1)}%`;
            badgesWrap.appendChild(volBadge);
          }
          if (showWeight) {
            const weightBadge = document.createElement('div');
            weightBadge.className = 'badge';
            weightBadge.textContent = `Weight: ${weight}`;
            badgesWrap.appendChild(weightBadge);
          }
        }

        const selectCb = document.createElement('input');
        selectCb.type = 'checkbox';
        selectCb.checked = selectedIds.has(pack.id);
        selectCb.setAttribute('data-pack-select', '1');
        selectCb.setAttribute('aria-label', `Select ${pack.title || 'Untitled Pack'}`);
        selectCb.addEventListener('click', ev => ev.stopPropagation());
        selectCb.addEventListener('change', () => {
          if (selectCb.checked) selectedIds.add(pack.id);
          else selectedIds.delete(pack.id);
          card.classList.toggle('selected', selectedIds.has(pack.id));
          updateBulkActions();
          syncFooterState();
        });
        const kebabBtn = document.createElement('button');
        kebabBtn.className = 'btn btn-ghost';
        kebabBtn.type = 'button';
        kebabBtn.setAttribute('data-pack-menu', '1');
        kebabBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        kebabBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          UIComponents.openDropdown(kebabBtn, [
            { label: 'Open', icon: 'fa-solid fa-folder-open', onClick: () => openPack(pack.id) },
            { label: 'Edit', icon: 'fa-solid fa-pen-to-square', onClick: () => openEditPackModal(pack.id) },
            { label: 'Rename', icon: 'fa-solid fa-i-cursor', onClick: () => openRename(pack.id) },
            {
              label: 'Duplicate',
              icon: 'fa-solid fa-clone',
              onClick: () => {
                PackLibrary.duplicate(pack.id);
                UIComponents.showToast('Pack duplicated', 'success');
              },
            },
            {
              label: 'Capture Preview',
              icon: 'fa-solid fa-image',
              onClick: () => ExportService.capturePackPreview(pack.id, { source: 'manual' }),
            },
            {
              label: 'Clear Preview',
              icon: 'fa-solid fa-ban',
              disabled: !pack.thumbnail,
              onClick: () => ExportService.clearPackPreview(pack.id),
            },
            { label: 'Export Pack JSON', icon: 'fa-solid fa-file-export', onClick: () => exportPack(pack.id) },
            {
              label: 'Move to Folder',
              icon: 'fa-solid fa-folder-open',
              onClick: () => openMoveToFolderModal(pack),
            },
            {
              label: 'Delete',
              icon: 'fa-solid fa-trash-can',
              variant: 'danger',
              dividerBefore: true,
              onClick: () => deletePack(pack.id),
            },
          ]);
        });

        const actions = document.createElement('div');
        actions.className = 'card-head-actions';
        actions.classList.add('tp3d-packs-card-head-actions');
        actions.appendChild(selectCb);
        actions.appendChild(kebabBtn);

        head.appendChild(title);
        head.appendChild(actions);

        if (badgesWrap.children.length) meta.appendChild(badgesWrap);

        if (badgePrefs.showThumbnail !== false) card.appendChild(preview);
        card.appendChild(head);
        if (badgePrefs.showEditedTime !== false) {
          const editedBadge = document.createElement('div');
          editedBadge.className = 'badge';
          editedBadge.textContent = `Edited: ${Utils.formatRelativeTime(pack.lastEdited)}`;
          badgesWrap.appendChild(editedBadge);
        }
        card.appendChild(meta);
        gridEl.appendChild(card);
      });
    }

    function buildPreview(pack) {
      const preview = document.createElement('div');
      if (pack && typeof pack.thumbnail === 'string' && pack.thumbnail) {
        preview.className = 'pack-preview has-thumb';
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = `${pack.title || 'Pack'} preview`;
        img.src = pack.thumbnail;
        preview.appendChild(img);
        return preview;
      }
      const items = (pack.cases || []).slice(0, 12);

      if (!items.length) {
        preview.className = 'pack-preview empty';
        preview.textContent = 'No items yet';
        return preview;
      }

      preview.className = 'pack-preview';
      items.forEach(inst => {
        const cell = document.createElement('div');
        cell.className = 'pack-preview-cell';
        const meta = CaseLibrary.getById(inst.caseId);
        if (meta && meta.color) cell.style.background = meta.color;
        preview.appendChild(cell);
      });
      return preview;
    }

    function openPack(packId) {
      const pack = PackLibrary.open(packId);
      if (!pack) {
        UIComponents.showToast('Pack not found', 'error');
        return;
      }
      AppShell.navigate('editor');
    }

    function openNewPackModal() {
      const content = document.createElement('div');
      content.classList.add('tp3d-packs-modal-grid');

      const title = field('Title (required)', 'text', 'Summer Festival Tour', true);
      const client = field('Client (optional)', 'text', 'Live Nation', false);
      const projectName = field('Project name (optional)', 'text', 'Coachella 2024', false);
      const drawnBy = field('Drawn by (optional)', 'text', 'John Smith', false);
      const notes = textareaField('Notes (optional)', 'Add notes for this pack...');
      title.wrap.classList.add('tp3d-grid-span-full');

      const presets = TrailerPresets.getAll();
      const hasPresets = Array.isArray(presets) && presets.length > 0;
      const fallbackTruck = { length: 636, width: 102, height: 98, shapeMode: 'rect' };

      const presetWrap = document.createElement('div');
      presetWrap.className = 'field';
      const presetLabel = document.createElement('div');
      presetLabel.className = 'label';
      presetLabel.textContent = 'Truck preset';
      const presetSelect = document.createElement('select');
      presetSelect.className = 'select';
      const presetOptions = hasPresets
        ? presets
        : [{ id: 'default', label: '53ft Trailer (default)', truck: fallbackTruck, tags: ['Default'] }];
      presetOptions.forEach(preset => {
        const opt = document.createElement('option');
        opt.value = String(preset.id);
        opt.textContent = preset.label;
        presetSelect.appendChild(opt);
      });
      presetWrap.appendChild(presetLabel);
      presetWrap.appendChild(presetSelect);

      const modeWrap = document.createElement('div');
      modeWrap.className = 'field';
      const modeLabel = document.createElement('div');
      modeLabel.className = 'label';
      modeLabel.textContent = 'Trailer Shape Mode';
      const modeSelect = document.createElement('select');
      modeSelect.className = 'select';
      modeSelect.innerHTML = `
	                <option value="rect">Standard</option>
	                <option value="wheelWells">Box + Wheel Wells</option>
	                <option value="frontBonus">Box + Front Overhang</option>
	              `;
      modeSelect.value = 'rect';
      modeWrap.appendChild(modeLabel);
      modeWrap.appendChild(modeSelect);
      modeWrap.classList.add('tp3d-grid-span-full');

      const truckGrid = document.createElement('div');
      truckGrid.className = 'row';
      truckGrid.classList.add('tp3d-packs-truck-grid');
      truckGrid.classList.add('tp3d-grid-span-full');
      const tL = field('Truck length (in)', 'number', '636', true);
      const tW = field('Truck width (in)', 'number', '102', true);
      const tH = field('Truck height (in)', 'number', '98', true);
      tL.wrap.classList.add('tp3d-flex-1');
      tW.wrap.classList.add('tp3d-flex-1');
      tH.wrap.classList.add('tp3d-flex-1');
      truckGrid.appendChild(tL.wrap);
      truckGrid.appendChild(tW.wrap);
      truckGrid.appendChild(tH.wrap);

      presetSelect.addEventListener('change', () => {
        const selectedId = String(presetSelect.value || '');
        const preset =
          (TrailerPresets.getById && TrailerPresets.getById(selectedId)) ||
          presetOptions.find(p => String(p && p.id) === selectedId) ||
          null;
        const nextTruck = (preset && preset.truck) || fallbackTruck;
        tL.input.value = String(nextTruck.length);
        tW.input.value = String(nextTruck.width);
        tH.input.value = String(nextTruck.height);
        if (
          nextTruck.shapeMode === 'wheelWells' ||
          nextTruck.shapeMode === 'frontBonus' ||
          nextTruck.shapeMode === 'rect'
        ) {
          modeSelect.value = nextTruck.shapeMode;
        }
      });

      content.appendChild(title.wrap);
      content.appendChild(client.wrap);
      content.appendChild(projectName.wrap);
      content.appendChild(drawnBy.wrap);
      content.appendChild(presetWrap);
      content.appendChild(modeWrap);
      content.appendChild(truckGrid);
      content.appendChild(notes.wrap);

      UIComponents.showModal({
        title: 'New Pack',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Create',
            variant: 'primary',
            onClick: () => {
              const t = String(title.input.value || '').trim();
              if (!t) {
                UIComponents.showToast('Title is required', 'warning');
                title.input.focus();
                return;
              }
              const pack = PackLibrary.create({
                title: t,
                client: String(client.input.value || '').trim(),
                projectName: String(projectName.input.value || '').trim(),
                drawnBy: String(drawnBy.input.value || '').trim(),
                notes: String(notes.textarea.value || '').trim(),
                truck: {
                  length: Number(tL.input.value) || 636,
                  width: Number(tW.input.value) || 102,
                  height: Number(tH.input.value) || 98,
                  shapeMode:
                    modeSelect.value === 'wheelWells' || modeSelect.value === 'frontBonus' ? modeSelect.value : 'rect',
                  shapeConfig: {},
                },
              });
              UIComponents.showToast('Pack created', 'success');
              PackLibrary.open(pack.id);
              AppShell.navigate('editor');
            },
          },
        ],
      });
    }

    function openEditPackModal(packId) {
      const pack = PackLibrary.getById(packId);
      if (!pack) return;

      const content = document.createElement('div');
      content.classList.add('tp3d-packs-modal-grid');

      const title = field('Title (required)', 'text', '', true);
      title.input.value = pack.title || '';
      title.wrap.classList.add('tp3d-grid-span-full');

      const client = field('Client (optional)', 'text', '', false);
      client.input.value = pack.client || '';

      const projectName = field('Project name (optional)', 'text', '', false);
      projectName.input.value = pack.projectName || '';

      const drawnBy = field('Drawn by (optional)', 'text', '', false);
      drawnBy.input.value = pack.drawnBy || '';

      const notes = textareaField('Notes (optional)', 'Add notes for this pack...');
      notes.textarea.value = pack.notes || '';

      const presets = TrailerPresets.getAll();
      const presetWrap = document.createElement('div');
      presetWrap.className = 'field';
      const presetLabel = document.createElement('div');
      presetLabel.className = 'label';
      presetLabel.textContent = 'Truck preset';
      const presetSelect = document.createElement('select');
      presetSelect.className = 'select';
      const customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.textContent = 'Custom';
      presetSelect.appendChild(customOpt);
      (Array.isArray(presets) ? presets : []).forEach(preset => {
        const opt = document.createElement('option');
        opt.value = String(preset.id);
        opt.textContent = preset.label;
        presetSelect.appendChild(opt);
      });
      presetWrap.appendChild(presetLabel);
      presetWrap.appendChild(presetSelect);

      const modeWrap = document.createElement('div');
      modeWrap.className = 'field';
      const modeLabel = document.createElement('div');
      modeLabel.className = 'label';
      modeLabel.textContent = 'Trailer Shape Mode';
      const modeSelect = document.createElement('select');
      modeSelect.className = 'select';
      modeSelect.innerHTML = `
                <option value="rect">Standard</option>
                <option value="wheelWells">Box + Wheel Wells</option>
                <option value="frontBonus">Box + Front Overhang</option>
              `;
      modeSelect.value =
        pack && pack.truck && (pack.truck.shapeMode === 'wheelWells' || pack.truck.shapeMode === 'frontBonus')
          ? pack.truck.shapeMode
          : 'rect';
      modeWrap.appendChild(modeLabel);
      modeWrap.appendChild(modeSelect);
      modeWrap.classList.add('tp3d-grid-span-full');

      const truckGrid = document.createElement('div');
      truckGrid.className = 'row';
      truckGrid.classList.add('tp3d-packs-truck-grid');
      truckGrid.classList.add('tp3d-grid-span-full');
      const tL = field('Truck length (in)', 'number', '', true);
      const tW = field('Truck width (in)', 'number', '', true);
      const tH = field('Truck height (in)', 'number', '', true);
      tL.wrap.classList.add('tp3d-flex-1');
      tW.wrap.classList.add('tp3d-flex-1');
      tH.wrap.classList.add('tp3d-flex-1');
      tL.input.value = String((pack.truck && pack.truck.length) || 636);
      tW.input.value = String((pack.truck && pack.truck.width) || 102);
      tH.input.value = String((pack.truck && pack.truck.height) || 98);
      truckGrid.appendChild(tL.wrap);
      truckGrid.appendChild(tW.wrap);
      truckGrid.appendChild(tH.wrap);

      function findPresetIdByDims(length, width, height) {
        const list = Array.isArray(presets) ? presets : [];
        const l = Number(length);
        const w = Number(width);
        const h = Number(height);
        const match = list.find(p => {
          const t = p && p.truck;
          return t && Number(t.length) === l && Number(t.width) === w && Number(t.height) === h;
        });
        return match ? String(match.id) : 'custom';
      }

      let applyingPreset = false;
      function syncPresetFromInputs() {
        if (applyingPreset) return;
        const nextId = findPresetIdByDims(tL.input.value, tW.input.value, tH.input.value);
        presetSelect.value = nextId;
      }

      presetSelect.value = findPresetIdByDims(tL.input.value, tW.input.value, tH.input.value);

      presetSelect.addEventListener('change', () => {
        const selectedId = String(presetSelect.value || 'custom');
        if (selectedId === 'custom') return;
        const preset =
          (TrailerPresets.getById && TrailerPresets.getById(selectedId)) ||
          (Array.isArray(presets) ? presets : []).find(p => String(p && p.id) === selectedId) ||
          null;
        if (!preset || !preset.truck) return;
        applyingPreset = true;
        tL.input.value = String(preset.truck.length);
        tW.input.value = String(preset.truck.width);
        tH.input.value = String(preset.truck.height);
        if (
          preset.truck.shapeMode === 'wheelWells' ||
          preset.truck.shapeMode === 'frontBonus' ||
          preset.truck.shapeMode === 'rect'
        ) {
          modeSelect.value = preset.truck.shapeMode;
        }
        applyingPreset = false;
        syncPresetFromInputs();
      });

      tL.input.addEventListener('input', syncPresetFromInputs);
      tW.input.addEventListener('input', syncPresetFromInputs);
      tH.input.addEventListener('input', syncPresetFromInputs);

      content.appendChild(title.wrap);
      content.appendChild(client.wrap);
      content.appendChild(projectName.wrap);
      content.appendChild(drawnBy.wrap);
      content.appendChild(presetWrap);
      content.appendChild(modeWrap);
      content.appendChild(truckGrid);
      content.appendChild(notes.wrap);

      UIComponents.showModal({
        title: 'Edit Pack',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Save',
            variant: 'primary',
            onClick: () => {
              const t = String(title.input.value || '').trim();
              if (!t) {
                UIComponents.showToast('Title is required', 'warning');
                title.input.focus();
                return false;
              }
              const shapeMode =
                modeSelect.value === 'wheelWells' || modeSelect.value === 'frontBonus' ? modeSelect.value : 'rect';
              const prevTruck = pack.truck && typeof pack.truck === 'object' ? pack.truck : {};
              const shapeConfig =
                prevTruck.shapeConfig &&
                typeof prevTruck.shapeConfig === 'object' &&
                !Array.isArray(prevTruck.shapeConfig)
                  ? Utils.deepClone(prevTruck.shapeConfig)
                  : {};
              const nextTruck = {
                ...prevTruck,
                length: Number(tL.input.value) || prevTruck.length || 636,
                width: Number(tW.input.value) || prevTruck.width || 102,
                height: Number(tH.input.value) || prevTruck.height || 98,
                shapeMode,
                shapeConfig,
              };
              PackLibrary.update(packId, {
                title: t,
                client: String(client.input.value || '').trim(),
                projectName: String(projectName.input.value || '').trim(),
                drawnBy: String(drawnBy.input.value || '').trim(),
                notes: String(notes.textarea.value || '').trim(),
                truck: nextTruck,
              });
              UIComponents.showToast('Pack updated', 'success');
              return true;
            },
          },
        ],
      });
    }

    function openRename(packId) {
      const pack = PackLibrary.getById(packId);
      if (!pack) return;
      const content = document.createElement('div');
      const f = field('Pack title', 'text', pack.title || '', true);
      f.input.value = pack.title || '';
      content.appendChild(f.wrap);
      UIComponents.showModal({
        title: 'Rename Pack',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Save',
            variant: 'primary',
            onClick: () => {
              const nextTitle = String(f.input.value || '').trim();
              if (!nextTitle) return;
              PackLibrary.update(packId, { title: nextTitle });
              UIComponents.showToast('Renamed', 'success');
            },
          },
        ],
      });
    }

    function exportPack(packId) {
      const pack = PackLibrary.getById(packId);
      if (!pack) return;
      const json = ImportExport.buildPackExportJSON(pack);
      Utils.downloadText(`${(pack.title || 'pack').replace(/[^a-z0-9]+/gi, '-')}.json`, json);
      toast('Pack JSON exported', 'success');
    }

    async function deletePack(packId) {
      const ok = await UIComponents.confirm({
        title: 'Delete pack?',
        message: 'This will permanently delete 1 pack(s). This cannot be undone.',
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;
      PackLibrary.remove(packId);
      UIComponents.showToast('Pack deleted', 'info');
    }

    function openImportPackDialog() {
      if (ImportPackDialog && typeof ImportPackDialog.open === 'function') ImportPackDialog.open();
    }

    function field(label, type, placeholder, required) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = required ? `${label}` : label;
      const input = document.createElement('input');
      input.className = 'input';
      input.type = type;
      input.placeholder = placeholder || '';
      wrap.appendChild(l);
      wrap.appendChild(input);
      return { wrap, input };
    }

    function textareaField(label, placeholder) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      wrap.classList.add('tp3d-grid-span-full');
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = label;
      const textarea = document.createElement('textarea');
      textarea.className = 'input';
      textarea.rows = 3;
      textarea.placeholder = placeholder || '';
      textarea.classList.add('tp3d-textarea-minh-48');
      wrap.appendChild(l);
      wrap.appendChild(textarea);
      return { wrap, textarea };
    }

    return { init: initPacksUI, render, resetWorkspaceState };
  })();

  return PacksUI;
}
