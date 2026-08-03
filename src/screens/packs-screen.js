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
import { openNotesOverlay } from '../ui/overlays/notes-overlay.js';
import { getStorageScope, getWorkspaceScope } from '../core/storage.js';
import {
  checkLoadPlanNumberAvailability,
  compareBusinessIdentityValues,
  normalizeBusinessIdentityComparison,
  validateBusinessIdentityValue,
} from '../core/business-identity.js';

export function packMatchesSearch(pack, query) {
  const normalizedQuery = normalizeBusinessIdentityComparison(query);
  if (normalizedQuery == null) return true;
  return [pack && pack.title, pack && pack.client, pack && pack.loadPlanNumber, pack && pack.customerReference].some(
    value => {
      const normalized = normalizeBusinessIdentityComparison(value);
      return normalized != null && normalized.includes(normalizedQuery);
    }
  );
}

export function findMatchingTrailerPreset(truck, presets) {
  if (!truck || typeof truck !== 'object' || !Array.isArray(presets)) return null;
  const shapeMode = ['rect', 'wheelWells', 'frontBonus'].includes(truck.shapeMode)
    ? truck.shapeMode
    : 'rect';
  return presets.find(preset => {
    const candidate = preset && preset.truck;
    if (!candidate || typeof candidate !== 'object') return false;
    const candidateShape = ['rect', 'wheelWells', 'frontBonus'].includes(candidate.shapeMode)
      ? candidate.shapeMode
      : 'rect';
    return Number(candidate.length) === Number(truck.length) &&
      Number(candidate.width) === Number(truck.width) &&
      Number(candidate.height) === Number(truck.height) &&
      candidateShape === shapeMode;
  }) || null;
}

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
  TruckChangeController,
  OperationLifecycle,
  featureFlags,
  persistNow,
  toast,
  toAscii: _toAscii,
}) {
  const PacksUI = (() => {
    const searchEl = /** @type {HTMLInputElement} */ (document.getElementById('packs-search'));
    const searchClearEl = /** @type {HTMLButtonElement} */ (document.getElementById('packs-search-clear'));
    const gridEl = /** @type {HTMLElement} */ (document.getElementById('packs-grid'));
    const listEl = /** @type {HTMLElement} */ (document.getElementById('packs-list'));
    const tbodyEl = /** @type {HTMLElement} */ (document.getElementById('packs-tbody'));
    const emptyEl = /** @type {HTMLElement} */ (document.getElementById('packs-empty'));
    const filterEmptyEl = /** @type {HTMLElement} */ (document.getElementById('packs-filter-empty'));
    const filterEmptyMsg = /** @type {HTMLElement} */ (document.getElementById('packs-filter-empty-msg'));
    const btnNew = document.getElementById('btn-new-pack');
    const btnImport = document.getElementById('btn-import-pack');
    const chipAll = document.getElementById('packs-filter-chip-all');
    const chipEmpty = document.getElementById('packs-filter-chip-empty');
    const chipPartial = document.getElementById('packs-filter-chip-partial');
    const chipFull = document.getElementById('packs-filter-chip-full');
    const btnViewGrid = document.getElementById('packs-view-grid');
    const btnViewList = document.getElementById('packs-view-list');
    const btnSort = document.getElementById('packs-sort');
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
    const sortOptions = [
      { key: 'title', label: 'Title' },
      { key: 'loadPlanNumber', label: 'Load Plan Number' },
      { key: 'casesQty', label: 'Cases Qty' },
      { key: 'length', label: 'Length' },
      { key: 'width', label: 'Width' },
      { key: 'height', label: 'Height' },
      { key: 'mode', label: 'Shape' },
      { key: 'volume', label: 'Volume' },
      { key: 'weight', label: 'Weight' },
      { key: 'edited', label: 'Edited' },
    ];
    let activeFolderId = null;
    let datasetKey = '';
    let sortKey = 'edited-desc';
    // Canonical Load Plans view-mode value. Set once from the persisted
    // preference at first use (resolveViewMode's fallback branch), then only
    // ever changed by an explicit Grid/List click in setViewMode(). Every
    // other read in this module (render, updateViewButtons, updateBulkActions,
    // any delayed/async rerender) must go through resolveViewMode() rather
    // than re-reading the live preference fresh from PreferencesManager each
    // time — a fresh read here is exactly what let a stale/racing full-preferences
    // write (e.g. a workspace-scoped storage reload landing between the
    // debounced 250ms save and its flush) silently revert an explicit Grid
    // selection back to an old persisted 'list' value on the next unrelated
    // rerender. The Cases screen keeps its own separate view-mode preference
    // and local state, entirely independent of this one.
    let currentViewMode = null;
    function resolveViewMode() {
      if (currentViewMode === 'grid' || currentViewMode === 'list') return currentViewMode;
      // First initialization only: no valid canonical value yet, so fall back
      // to the persisted preference (defaulting to grid).
      currentViewMode = PreferencesManager.get().packsViewMode === 'list' ? 'list' : 'grid';
      return currentViewMode;
    }
    const packsListState = {
      pageIndex: 0,
      rowsPerPage: 50,
    };
    let footerController = null;
    let footerMountEl = null;
    let filteredPacks = [];
    const filtersRowEl = document.getElementById('packs-filters');
    let foldersButtonEl = null;
    let foldersButtonLabelEl = null;
    let filtersOutsideClickHandler = null;
    let toolbarDropdownCoordinatorInitialized = false;

    function mutationBlockedWhileBusy(title = 'Load Plans') {
      if (!OperationLifecycle || !OperationLifecycle.isBusy()) return false;
      UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title });
      return true;
    }

    function requestTruckChange(options) {
      if (mutationBlockedWhileBusy('Truck')) return { status: 'busy' };
      const pack = options && options.pack;
      const token = OperationLifecycle
        ? OperationLifecycle.beginOperation('changingTruck', { packId: pack && pack.id })
        : null;
      if (OperationLifecycle && !token) {
        mutationBlockedWhileBusy('Truck');
        return { status: 'busy' };
      }

      const release = () => {
        if (token && OperationLifecycle) OperationLifecycle.finishOperation(token);
      };
      const restoreControls = options && options.restoreControls;
      const onCommitted = options && options.onCommitted;
      let result;
      try {
        result = TruckChangeController.request({
          ...options,
          restoreControls: (...args) => {
            try {
              if (typeof restoreControls === 'function') restoreControls(...args);
            } finally {
              release();
            }
          },
          onCommitted: (...args) => {
            try {
              if (typeof onCommitted === 'function') onCommitted(...args);
            } finally {
              release();
            }
          },
        });
      } catch (error) {
        release();
        throw error;
      }
      if (!result || result.status !== 'preview') release();
      return result;
    }

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

    // Mirrors the frontBonus normalization in editor-screen.js's shape-mode
    // change handler: fills in missing bonusLength/bonusHeight with sensible
    // positive defaults (12% of length, 45% of height) and locks bonusWidth
    // to the trailer width, so packs created/edited here never end up with a
    // zero-length (invisible) overhang.
    function normalizeFrontBonusShapeConfig(shapeConfig, truck) {
      const cfg = shapeConfig && typeof shapeConfig === 'object' && !Array.isArray(shapeConfig) ? { ...shapeConfig } : {};
      const length = Number(truck.length) || 0;
      const height = Number(truck.height) || 0;
      const width = Number(truck.width) || 0;
      if (!Number.isFinite(cfg.bonusLength)) cfg.bonusLength = 0.12 * length;
      if (!Number.isFinite(cfg.bonusHeight)) cfg.bonusHeight = 0.45 * height;
      cfg.bonusLength = Utils.clamp(Number(cfg.bonusLength) || 0, 0, length);
      cfg.bonusHeight = Utils.clamp(Number(cfg.bonusHeight) || 0, 0, height);
      cfg.bonusWidth = width;
      return cfg;
    }

    function setIdentityFieldError(fieldControl, message) {
      fieldControl.error.textContent = message || '';
      fieldControl.error.hidden = !message;
      if (message) fieldControl.input.setAttribute('aria-invalid', 'true');
      else fieldControl.input.removeAttribute('aria-invalid');
    }

    function identityErrorMessage(result, label) {
      const code = result && result.error && result.error.code;
      if (code === 'required') return `${label} is required.`;
      if (code === 'not_unique') return `${label} already in use.`;
      if (code === 'too_long') return `${label} is too long.`;
      if (code === 'control_character') {
        return `${label} cannot contain line breaks or control characters.`;
      }
      return `${label} is invalid.`;
    }

    function validateLoadPlanIdentityFields(loadPlanNumber, customerReference, {
      numberRequired,
      excludeId = null,
    }) {
      setIdentityFieldError(loadPlanNumber, '');
      setIdentityFieldError(customerReference, '');

      let numberResult = validateBusinessIdentityValue(loadPlanNumber.input.value, {
        field: 'loadPlanNumber',
        required: numberRequired,
      });
      if (numberResult.ok && numberResult.value != null) {
        numberResult = checkLoadPlanNumberAvailability(
          numberResult.value,
          PackLibrary.getPacks(),
          { excludeId }
        );
      }

      const customerResult = validateBusinessIdentityValue(customerReference.input.value, {
        field: 'customerReference',
        required: false,
      });

      if (!numberResult.ok) {
        setIdentityFieldError(
          loadPlanNumber,
          identityErrorMessage(numberResult, 'Load Plan Number')
        );
      }
      if (!customerResult.ok) {
        setIdentityFieldError(
          customerReference,
          identityErrorMessage(customerResult, 'Customer Reference')
        );
      }
      if (!numberResult.ok) {
        loadPlanNumber.input.focus();
        return null;
      }
      if (!customerResult.ok) {
        customerReference.input.focus();
        return null;
      }

      return {
        loadPlanNumber: numberResult.value,
        customerReference: customerResult.value,
      };
    }

    function getManagementNotesContext() {
      return `${getStorageScope()}|${getWorkspaceScope()}`;
    }

    function createManagementIdentityChip(text, accessibleLabel) {
      const chip = document.createElement('div');
      chip.className = 'badge tp3d-management-identity-chip';
      chip.setAttribute('aria-label', accessibleLabel);
      const chipText = document.createElement('span');
      chipText.className = 'tp3d-management-identity-chip__text';
      chipText.textContent = text;
      chip.appendChild(chipText);
      return chip;
    }

    function appendPackListIdentityMetadata(container, pack, {
      showLoadPlanNumber = true,
      showCustomerReference = true,
    } = {}) {
      const loadPlanNumber = String(pack.loadPlanNumber || '').trim();
      const customerReferenceValue = String(pack.customerReference || '').trim();
      if (showLoadPlanNumber) {
        const number = document.createElement('div');
        number.className = 'muted tp3d-management-secondary-text';
        number.textContent = `Load Plan Number: ${loadPlanNumber || '—'}`;
        container.appendChild(number);
      }

      if (showCustomerReference && customerReferenceValue) {
        const customerReference = document.createElement('div');
        customerReference.className = 'muted tp3d-management-secondary-text';
        customerReference.textContent = `Customer Reference: ${customerReferenceValue}`;
        container.appendChild(customerReference);
      }
    }

    function createPackIdentityChips(pack, {
      showLoadPlanNumber = true,
      showCustomerReference = true,
    } = {}) {
      const chips = document.createElement('div');
      chips.className = 'tp3d-management-identity-chips';
      const loadPlanNumber = String(pack.loadPlanNumber || '').trim();
      const customerReference = String(pack.customerReference || '').trim();
      if (showLoadPlanNumber && loadPlanNumber) {
        chips.appendChild(
          createManagementIdentityChip(loadPlanNumber, `Load Plan Number: ${loadPlanNumber}`)
        );
      }
      if (showCustomerReference && customerReference) {
        chips.appendChild(
          createManagementIdentityChip(
            `Ref: ${customerReference}`,
            `Customer Reference: ${customerReference}`
          )
        );
      }
      return chips;
    }

    function openPackManagementNotes(pack, trigger) {
      const capturedContext = getManagementNotesContext();
      openNotesOverlay({
        UIComponents,
        entityType: 'load-plan',
        entityId: pack.id,
        capturedContext,
        getCurrentContext: getManagementNotesContext,
        resolveEntity: ({ entityId }) => PackLibrary.getById(entityId),
        readNote: entity => entity.notes,
        saveNote: ({ entityId, value }) => {
          const updated = PackLibrary.update(entityId, { notes: String(value || '').trim() });
          if (!updated) throw new Error('This load plan no longer exists.');
          return updated;
        },
        clearValue: '',
        title: 'Load Plan Notes',
        subtitle: entity => entity.title || 'Untitled Load Plan',
        fieldLabel: 'Load Plan Notes',
        emptyText: 'No load plan notes yet.',
        placeholder: 'Add load plan notes…',
        mutationGuard: () => !mutationBlockedWhileBusy('Load Plan Notes'),
        getLastEdited: entity => entity.lastEdited,
        onSaved: () => render(),
        trigger,
        missingMessage: 'This load plan no longer exists.',
        contextMessage: 'The active workspace changed. Reopen Load Plan Notes to continue.',
      });
    }

    function createPackNotesButton(pack) {
      const title = pack.title || 'Untitled Load Plan';
      const hasNotes = Boolean(String(pack.notes || '').trim());
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost tp3d-management-notes-btn';
      btn.setAttribute('data-pack-notes', '1');
      btn.setAttribute('data-notes-entity-type', 'load-plan');
      btn.setAttribute('data-notes-entity-id', pack.id);
      btn.setAttribute('data-tooltip', 'Load Plan Notes');
      btn.setAttribute('aria-label', hasNotes
        ? `Open load plan notes for ${title}, notes available`
        : `Open load plan notes for ${title}`);
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
        openPackManagementNotes(pack, btn);
      });
      return btn;
    }

    function initPacksUI() {
      searchEl.addEventListener(
        'input',
        (() => {
          const renderSearch = Utils.debounce(() => {
            packsListState.pageIndex = 0;
            render();
          }, 200);
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
      wireChip(chipAll, 'all');
      wireChip(chipEmpty, 'empty');
      wireChip(chipPartial, 'partial');
      wireChip(chipFull, 'full');
      btnNew.addEventListener('click', () => openNewPackModal());
      btnImport.addEventListener('click', () => openImportPackDialog());
      ensureFoldersButton();
      btnViewGrid.addEventListener('click', () => setViewMode('grid'));
      btnViewList.addEventListener('click', () => setViewMode('list'));
      btnSort &&
        btnSort.addEventListener('click', ev => {
          ev.stopPropagation();
          openSortMenu(btnSort);
        });
      if (!featureFlags.trailerPresetsEnabled && btnTrailerPresets) btnTrailerPresets.style.display = 'none';
      if (featureFlags.trailerPresetsEnabled && btnTrailerPresets) {
        btnTrailerPresets.addEventListener('click', ev => {
          ev.stopPropagation();
          openTrailerPresetsMenu(btnTrailerPresets);
        });
      }
      btnFiltersToggle && btnFiltersToggle.addEventListener('click', ev => { ev.stopPropagation(); toggleFiltersVisible(); });
      btnCardDisplay &&
        btnCardDisplay.addEventListener('click', () => {
          // TODO: Add keyboard shortcut + update Keyboard Shortcuts modal later
          CardDisplayOverlay.open({ screen: 'packs' });
        });
      selectAllEl.addEventListener('change', handleSelectAll);
      btnBulkDelete.addEventListener('click', handleBulkDelete);
      initToolbarDropdownCoordinator();
      initListHeaderSort();
      updateViewButtons();
      initFooter();
    }

    function openTrailerPresetsMenu(anchorEl) {
      if (!anchorEl) return;
      if (!featureFlags.trailerPresetsEnabled) return;

      const selected = Array.from(selectedIds);
      let packId;
      if (selected.length === 1) {
        packId = selected[0];
      } else if (selected.length === 0) {
        if (filteredPacks && filteredPacks.length === 1) {
          packId = filteredPacks[0].id;
        } else {
          UIComponents.showToast('Select a load plan first', 'warning');
          return;
        }
      } else {
        UIComponents.showToast('Select a single load plan first', 'warning');
        return;
      }
      const pack = PackLibrary.getById(packId);
      if (!pack) {
        UIComponents.showToast('Load plan not found', 'error');
        return;
      }

      const presets = TrailerPresets.getAll();
      const matchingPreset = findMatchingTrailerPreset(pack.truck, presets);
      const items = /** @type {any[]} */ ([{ type: 'header', label: 'Trailer Presets' }]);
      if (!matchingPreset) {
        items.push(
          {
            label: 'Custom',
            icon: 'fa-solid fa-sliders',
            active: true,
            status: true,
            rightIcon: 'fa-solid fa-check',
          },
          { type: 'divider' }
        );
      }
      presets.forEach(p => {
        const isActive = Boolean(matchingPreset && matchingPreset.id === p.id);
        items.push({
          label: p.label,
          icon: 'fa-solid fa-truck',
          active: isActive,
          rightIcon: isActive ? 'fa-solid fa-check' : '',
          onClick: () => {
            const nextTruck = TrailerPresets.applyToTruck(pack.truck, p);
            requestTruckChange({
              pack,
              nextTruck,
              successMessage: `Applied preset: ${p.label}`,
              restoreControls: () => render(),
              onCommitted: () => render(),
            });
          },
        });
      });

      const rect = anchorEl.getBoundingClientRect();
      UIComponents.openDropdown(anchorEl, items, {
        align: 'right',
        width: Math.max(260, rect.width),
        role: 'trailer-presets',
        activeAnchorClass: 'btn-primary',
        menuSemantics: true,
        toggle: true,
      });
    }

    function toggleFiltersVisible() {
      const shouldOpen = PreferencesManager.get().packsFiltersVisible !== true;
      UIComponents.closeAllDropdowns();
      if (!shouldOpen) return;
      setFiltersVisible(true);
    }

    function setFiltersVisible(visible) {
      const prefs = PreferencesManager.get();
      if ((prefs.packsFiltersVisible === true) !== Boolean(visible)) {
        prefs.packsFiltersVisible = Boolean(visible);
        PreferencesManager.set(prefs);
      }
      applyFiltersVisibility();
    }

    function initToolbarDropdownCoordinator() {
      if (toolbarDropdownCoordinatorInitialized) return;
      toolbarDropdownCoordinatorInitialized = true;
      UIComponents.registerDropdownSurface({
        isOpen: () => PreferencesManager.get().packsFiltersVisible === true,
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
      if (!filtersRowEl) return;
      const visible = PreferencesManager.get().packsFiltersVisible === true;
      filtersRowEl.classList.toggle('is-open', visible);
      filtersRowEl.style.display = '';
      btnFiltersToggle && btnFiltersToggle.classList.toggle('btn-primary', visible);
      btnFiltersToggle && btnFiltersToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
      // Manage outside-click handler
      if (filtersOutsideClickHandler) {
        document.removeEventListener('click', filtersOutsideClickHandler);
        filtersOutsideClickHandler = null;
      }
      if (visible) {
        filtersOutsideClickHandler = function(ev) {
          const anchor = filtersRowEl.closest('.tp3d-packs-filter-anchor');
          if (!anchor || !anchor.contains(/** @type {Node} */ (ev.target))) {
            setFiltersVisible(false);
          }
        };
        setTimeout(() => {
          if (filtersOutsideClickHandler) {
            document.addEventListener('click', filtersOutsideClickHandler);
          }
        }, 0);
      }
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
      foldersButtonEl.setAttribute('aria-label', 'Filter load plans by folder');
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
      if (mutationBlockedWhileBusy()) return;
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
              if (mutationBlockedWhileBusy()) return false;
              const folderName = String(name.input.value || '').trim();
              const created = FolderLibrary.createFolder(folderName);
              persistFolderStateNow();
              if (created && created.id) {
                activeFolderId = String(created.id);
                packsListState.pageIndex = 0;
              }
              render();
              UIComponents.showToast('Folder created', 'success');
              return true;
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
              if (mutationBlockedWhileBusy()) return false;
              const renamed = FolderLibrary.renameFolder(folderId, name.input.value);
              if (!renamed) {
                UIComponents.showToast('Could not rename folder', 'warning');
                return true;
              }
              persistFolderStateNow();
              render();
              UIComponents.showToast('Folder renamed', 'success');
              return true;
            },
          },
        ],
      });
    }

    async function deleteFolderWithConfirm(folder) {
      if (!folder || !folder.id) return;
      if (mutationBlockedWhileBusy()) return;
      const folderId = String(folder.id);
      const folderName = folder.name || 'Untitled Folder';
      const affectedCount = PackLibrary.getPacks().filter(pack => pack && String(pack.folderId || '') === folderId).length;
      const ok = await UIComponents.confirm({
        title: 'Delete folder?',
        message: `Delete "${folderName}"? ${affectedCount} load plan(s) in this folder will move to Unfiled. Load plans will not be deleted.`,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;
      if (mutationBlockedWhileBusy()) return;

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
      if (mutationBlockedWhileBusy()) return false;
      const moved = FolderLibrary.movePackToFolder(pack.id, folderIdOrNull);
      if (!moved) {
        UIComponents.showToast('Could not move load plan to folder', 'warning');
        return false;
      }
      persistFolderStateNow();
      packsListState.pageIndex = 0;
      render();
      UIComponents.showToast(folderIdOrNull ? 'Load plan moved to folder' : 'Load plan moved to Unfiled', 'success');
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
          label: `All Load Plans (${model.totalCount})`,
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
        menuSemantics: true,
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
          const current = getSortState();
          const direction = current.field === sortField && current.direction === 'asc' ? 'desc' : 'asc';
          setSort(sortField, direction);
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

    function getSortState() {
      const match = /^(.*)-(asc|desc)$/.exec(sortKey);
      const sortFieldKey = match && sortOptions.some(option => option.key === match[1]) ? match[1] : 'edited';
      const direction = match && match[2] === 'asc' ? 'asc' : 'desc';
      return { field: sortFieldKey, direction };
    }

    function setSort(sortField, direction, { resetDirection = false } = {}) {
      const sortFieldKey = sortOptions.some(option => option.key === sortField) ? sortField : 'edited';
      const nextDirection = resetDirection ? 'asc' : direction === 'desc' ? 'desc' : 'asc';
      sortKey = `${sortFieldKey}-${nextDirection}`;
      packsListState.pageIndex = 0;
      render();
      updateListHeaderIcons();
    }

    function openSortMenu(anchorEl) {
      if (!anchorEl) return;
      const current = getSortState();
      const items = [
        { type: 'header', label: 'Sort Load Plans' },
        ...sortOptions.map(option => ({
          label: option.label,
          active: option.key === current.field,
          rightIcon: option.key === current.field ? 'fa-solid fa-check' : '',
          onClick: () =>
            setSort(option.key, current.direction, { resetDirection: option.key !== current.field }),
        })),
        { type: 'divider' },
        {
          label: 'Ascending',
          icon: 'fa-solid fa-arrow-up-a-z',
          active: current.direction === 'asc',
          rightIcon: current.direction === 'asc' ? 'fa-solid fa-check' : '',
          onClick: () => setSort(current.field, 'asc'),
        },
        {
          label: 'Descending',
          icon: 'fa-solid fa-arrow-down-z-a',
          active: current.direction === 'desc',
          rightIcon: current.direction === 'desc' ? 'fa-solid fa-check' : '',
          onClick: () => setSort(current.field, 'desc'),
        },
      ];
      UIComponents.openDropdown(anchorEl, items, {
        align: 'right',
        width: 208,
        role: 'packs-sort',
        dropdownClass: 'tp3d-dropdown-sort',
        activeAnchorClass: 'btn-primary',
        menuSemantics: true,
        toggle: true,
      });
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
      if (btnSort) {
        btnSort.setAttribute('aria-label', 'Sort Load Plans');
        btnSort.setAttribute('data-tooltip', 'Sort Load Plans');
      }
    }

    function updateSearchClearVisibility() {
      searchClearEl.hidden = searchEl.value.length === 0;
    }

    function clearSearch() {
      searchEl.value = '';
      packsListState.pageIndex = 0;
      updateSearchClearVisibility();
      render();
      searchEl.focus();
    }

    function setViewMode(mode) {
      const nextMode = mode === 'list' ? 'list' : 'grid';
      UIComponents.closeAllDropdowns();
      // Explicit selection is the only thing allowed to change the canonical
      // value. Order matters: canonical state first, then persistence, then
      // the matching render, then the button/ARIA state — so a render
      // triggered anywhere in between already sees the new mode.
      currentViewMode = nextMode;
      const prefs = PreferencesManager.get();
      prefs.packsViewMode = nextMode;
      PreferencesManager.set(prefs);
      render(nextMode);
      updateViewButtons(nextMode);
    }

    function updateViewButtons(modeOverride) {
      const mode = modeOverride === 'list' || modeOverride === 'grid'
        ? modeOverride
        : resolveViewMode();
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
        if (key === 'all') {
          filters.empty = false;
          filters.partial = false;
          filters.full = false;
        } else {
          filters[key] = !filters[key];
        }
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

    function getPackStatus(pack) {
      const total = (pack && pack.cases ? pack.cases : []).length;
      const percent = pack && pack.stats && Number.isFinite(pack.stats.volumePercent) ? pack.stats.volumePercent : 0;
      if (total === 0) return 'empty';
      if (percent >= 99.999) return 'full';
      if (percent > 0) return 'partial';
      return 'empty';
    }

    function updateStatusFilterChips(packs) {
      const counts = { all: 0, empty: 0, partial: 0, full: 0 };
      (packs || []).forEach(pack => {
        counts.all += 1;
        counts[getPackStatus(pack)] += 1;
      });
      const anyActive = filters.empty || filters.partial || filters.full;
      const setChip = (el, label, count, active) => {
        if (!el) return;
        el.classList.toggle('active', Boolean(active));
        const labelEl = el.querySelector('span:last-child');
        if (labelEl) labelEl.textContent = `${label}: ${count}`;
      };
      setChip(chipAll, 'All', counts.all, !anyActive);
      setChip(chipEmpty, 'Empty', counts.empty, filters.empty);
      setChip(chipPartial, 'Partial', counts.partial, filters.partial);
      setChip(chipFull, 'Full', counts.full, filters.full);
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
      const mode = resolveViewMode();
      const count = selectedIds.size;
      if (count > 0) {
        defaultActionsEl.style.display = 'none';
        bulkActionsEl.style.display = 'flex';
        bulkCountEl.textContent = `${count} load plan${count === 1 ? '' : 's'} selected`;
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
      if (mutationBlockedWhileBusy()) return;
      const idsToDelete = Array.from(selectedIds);
      const ok = await UIComponents.confirm({
        title: 'Delete load plans?',
        message: `This will permanently delete ${count} load plan(s). This cannot be undone.`,
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;
      if (mutationBlockedWhileBusy()) return;

      const currentPackId = StateStore.get('currentPackId');
      const isCurrentDeleted = currentPackId && idsToDelete.includes(currentPackId);
      idsToDelete.forEach(id => PackLibrary.remove(id));
      if (isCurrentDeleted) AppShell.navigate('packs');
      selectedIds.clear();
      UIComponents.showToast(`${count} load plan(s) deleted`, 'success');
      render();
    }

    function render(modeOverride) {
      applyFiltersVisibility();
      const q = normalizeBusinessIdentityComparison(searchEl.value) || '';
      const allPacks = PackLibrary.getPacks().slice();
      const sourceOrder = new Map(allPacks.map((pack, index) => [pack, index]));
      const casesQtyByPack = new Map(
        allPacks.map(pack => [
          pack,
          (pack.cases || []).reduce((total, instance) => total + (instance && !instance.hidden ? 1 : 0), 0),
        ])
      );

      const compareTitle = (a, b) => (a.title || '').localeCompare(b.title || '');
      // Cases Qty sorts by total active non-hidden physical instances
      // (inTruck + staged), matching the List/Grid "Cases Qty" value below —
      // derive it directly from the live instances rather than persisted stats,
      // which can be absent or stale on normalized/imported Load Plans.
      const compareCasesQty = (a, b) => (casesQtyByPack.get(a) || 0) - (casesQtyByPack.get(b) || 0);
      const compareLastEdited = (a, b) => (a.lastEdited || 0) - (b.lastEdited || 0);
      const compareCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
      const compareLength = (a, b) => (a.truck?.length || 0) - (b.truck?.length || 0);
      const compareWidth = (a, b) => (a.truck?.width || 0) - (b.truck?.width || 0);
      const compareHeight = (a, b) => (a.truck?.height || 0) - (b.truck?.height || 0);
      const compareMode = (a, b) =>
        trailerModeLabel(a && a.truck && a.truck.shapeMode).localeCompare(
          trailerModeLabel(b && b.truck && b.truck.shapeMode)
        );
      const compareVolume = (a, b) =>
        ((a.stats && Number.isFinite(a.stats.volumePercent) ? a.stats.volumePercent : 0) || 0) -
        ((b.stats && Number.isFinite(b.stats.volumePercent) ? b.stats.volumePercent : 0) || 0);
      const compareWeight = (a, b) =>
        ((a.stats && Number.isFinite(a.stats.totalWeight) ? a.stats.totalWeight : 0) || 0) -
        ((b.stats && Number.isFinite(b.stats.totalWeight) ? b.stats.totalWeight : 0) || 0);
      const compareLoadPlanNumber = (a, b, direction) =>
        compareBusinessIdentityValues(a.loadPlanNumber, b.loadPlanNumber, { direction }) ||
        (sourceOrder.get(a) ?? 0) - (sourceOrder.get(b) ?? 0);
      const sorters = {
        'edited-desc': (a, b) => compareLastEdited(b, a),
        'edited-asc': (a, b) => compareLastEdited(a, b),
        'title-asc': (a, b) => compareTitle(a, b),
        'title-desc': (a, b) => compareTitle(b, a),
        'loadPlanNumber-asc': (a, b) => compareLoadPlanNumber(a, b, 'asc'),
        'loadPlanNumber-desc': (a, b) => compareLoadPlanNumber(a, b, 'desc'),
        'casesQty-asc': (a, b) => compareCasesQty(a, b),
        'casesQty-desc': (a, b) => compareCasesQty(b, a),
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
        'volume-asc': (a, b) => compareVolume(a, b),
        'volume-desc': (a, b) => compareVolume(b, a),
        'weight-asc': (a, b) => compareWeight(a, b),
        'weight-desc': (a, b) => compareWeight(b, a),
      };
      renderFoldersButton(allPacks);
      updateStatusFilterChips(allPacks);

      const packs = allPacks
        .filter(p => packMatchesSearch(p, q))
        .filter(p => {
          if (activeFolderId === null) return true;
          const folderId = p && p.folderId ? String(p.folderId) : null;
          if (activeFolderId === UNFILED_FOLDER_ID) return folderId === null;
          return folderId === activeFolderId;
        })
        .filter(p => {
          if (!filters.empty && !filters.partial && !filters.full) return true;
          const status = getPackStatus(p);
          const isEmpty = status === 'empty';
          const isPartial = status === 'partial';
          const isFull = status === 'full';

          if (filters.empty && isEmpty) return true;
          if (filters.partial && isPartial) return true;
          if (filters.full && isFull) return true;
          return false;
        });
      packs.sort(sorters[sortKey] || sorters['edited-desc']);

      filteredPacks = packs;

      const newDatasetKey = `${q}::${sortKey}::${activeFolderId || 'all'}::${filters.empty}${filters.partial}${filters.full}`;
      if (datasetKey !== newDatasetKey) {
        selectedIds.clear();
        datasetKey = newDatasetKey;
        packsListState.pageIndex = 0;
      }

      const pageMeta = getPageMeta(packs);
      // modeOverride is only ever passed by setViewMode(), which has already
      // updated the canonical currentViewMode before calling render(); every
      // other caller (rerenders, delayed callbacks, event-driven updates)
      // resolves through the same canonical value here — never a fresh
      // PreferencesManager re-read, which is what let a racing/stale full
      // preferences write silently flip an explicit Grid selection back to
      // an old persisted value on the next unrelated rerender.
      const mode = modeOverride === 'list' || modeOverride === 'grid' ? modeOverride : resolveViewMode();
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
        filterEmptyMsg.textContent = q ? `No matching load plans for "${q}"` : 'No matching load plans';
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
        checkbox.setAttribute('aria-label', `Select ${pack.title || 'Untitled Load Plan'}`);
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
        title.textContent = pack.title || 'Untitled Load Plan';
        titleWrap.appendChild(title);
        appendPackListIdentityMetadata(titleWrap, pack, {
          showLoadPlanNumber: badgePrefs.showLoadPlanNumber !== false,
          showCustomerReference: badgePrefs.showCustomerReference !== false,
        });

        const stats = PackLibrary.computeStats(pack);
        tdTitle.appendChild(titleWrap);

        const tdCasesQty = document.createElement('td');
        const inTruckQty = stats && Number.isFinite(stats.packedCases) ? stats.packedCases : null;
        const totalQty = stats
          ? Math.max(0, (stats.totalCases || 0) - (stats.hiddenCases || 0))
          : null;
        tdCasesQty.textContent = inTruckQty === null || totalQty === null ? '—' : `${inTruckQty}/${totalQty}`;
        if (badgePrefs.showCasesQty === false) tdCasesQty.style.display = 'none';

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

        const tdNotes = document.createElement('td');
        tdNotes.className = 'tp3d-management-notes-col';
        tdNotes.appendChild(createPackNotesButton(pack));
        tdNotes.hidden = badgePrefs.showNotes === false;

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
                if (mutationBlockedWhileBusy()) return;
                PackLibrary.duplicate(pack.id);
                UIComponents.showToast('Load plan duplicated', 'success');
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
            { label: 'Export Load Plan JSON', icon: 'fa-solid fa-file-export', onClick: () => exportPack(pack.id) },
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
        tr.appendChild(tdCasesQty);
        tr.appendChild(tdLength);
        tr.appendChild(tdWidth);
        tr.appendChild(tdHeight);
        tr.appendChild(tdMode);
        tr.appendChild(tdVolume);
        tr.appendChild(tdWeight);
        tr.appendChild(tdEdited);
        tr.appendChild(tdNotes);
        tr.appendChild(tdActions);
        tbodyEl.appendChild(tr);
      });
    }

    function applyListColumnVisibility(prefs) {
      const badgePrefs = (prefs.gridCardBadges && prefs.gridCardBadges.packs) || {};
      const show = {
        casesQty: badgePrefs.showCasesQty !== false,
        length: badgePrefs.showTruckDims !== false,
        width: badgePrefs.showTruckDims !== false,
        height: badgePrefs.showTruckDims !== false,
        mode: badgePrefs.showShapeMode !== false,
        volume: badgePrefs.showVolume !== false,
        weight: badgePrefs.showWeight !== false,
        edited: badgePrefs.showEditedTime !== false,
      };
      Object.keys(show).forEach(key => {
        const th = /** @type {HTMLElement|null} */ (document.querySelector(`#packs-list thead th[data-sort="${key}"]`));
        if (th) th.style.display = show[key] ? '' : 'none';
      });
      const notesTh = /** @type {HTMLElement|null} */ (
        document.querySelector('#packs-list thead th[data-column="notes"]')
      );
      if (notesTh) notesTh.hidden = badgePrefs.showNotes === false;
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
          if (
            targetEl &&
            (
              targetEl.closest('[data-pack-menu]') ||
              targetEl.closest('[data-pack-select]') ||
              targetEl.closest('[data-pack-notes]')
            )
          ) {
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
        title.textContent = pack.title || 'Untitled Load Plan';
        title.setAttribute('data-tooltip', pack.title || 'Untitled Load Plan');
        title.classList.add('tp3d-packs-card-title-truncate');

        const head = document.createElement('div');
        head.className = 'card-head';
        head.classList.add('tp3d-packs-card-head');

        const titleWrap = document.createElement('div');
        titleWrap.className = 'tp3d-packs-titlewrap tp3d-flex-1';
        titleWrap.appendChild(title);
        const identityChips = createPackIdentityChips(pack, {
          showLoadPlanNumber: badgePrefs.showLoadPlanNumber !== false,
          showCustomerReference: badgePrefs.showCustomerReference !== false,
        });

        const meta = document.createElement('div');
        meta.className = 'pack-meta';

        const badgesWrap = document.createElement('div');
        badgesWrap.className = 'pack-meta-badges';

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

        const showCasesQty = badgePrefs.showCasesQty !== false;
        const showVolume = badgePrefs.showVolume !== false;
        const showWeight = badgePrefs.showWeight !== false;
        if (showCasesQty || showVolume || showWeight) {
          const stats = PackLibrary.computeStats(pack);
          const inTruck = stats && Number.isFinite(stats.packedCases) ? stats.packedCases : 0;
          const total = stats ? Math.max(0, (stats.totalCases || 0) - (stats.hiddenCases || 0)) : 0;
          const pct = stats && Number.isFinite(stats.volumePercent) ? stats.volumePercent : 0;
          const weight = Utils.formatWeight(stats && stats.totalWeight, prefs.units.weight);

          if (showCasesQty) {
            const casesQtyBadge = document.createElement('div');
            casesQtyBadge.className = 'badge';
            casesQtyBadge.textContent = `Cases Qty: ${inTruck}/${total}`;
            badgesWrap.appendChild(casesQtyBadge);
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
        selectCb.setAttribute('aria-label', `Select ${pack.title || 'Untitled Load Plan'}`);
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
                if (mutationBlockedWhileBusy()) return;
                PackLibrary.duplicate(pack.id);
                UIComponents.showToast('Load plan duplicated', 'success');
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
            { label: 'Export Load Plan JSON', icon: 'fa-solid fa-file-export', onClick: () => exportPack(pack.id) },
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
        if (badgePrefs.showNotes !== false) actions.appendChild(createPackNotesButton(pack));
        actions.appendChild(kebabBtn);

        head.appendChild(titleWrap);
        head.appendChild(actions);

        if (badgesWrap.children.length) meta.appendChild(badgesWrap);

        if (badgePrefs.showThumbnail !== false) card.appendChild(preview);
        card.appendChild(head);
        if (identityChips.children.length) card.appendChild(identityChips);
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
        img.alt = `${pack.title || 'Load Plan'} preview`;
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
      if (mutationBlockedWhileBusy()) return;
      const pack = PackLibrary.open(packId);
      if (!pack) {
        UIComponents.showToast('Load plan not found', 'error');
        return;
      }
      AppShell.navigate('editor');
    }

    function openNewPackModal() {
      if (mutationBlockedWhileBusy()) return;
      const content = document.createElement('div');
      content.classList.add('tp3d-packs-modal-grid');

      const title = field('Title (required)', 'text', 'Summer Festival Tour', true);
      const loadPlanNumber = identityField(
        'Load Plan Number',
        'Optional custom number',
        'Leave blank to generate automatically.'
      );
      const customerReference = identityField('Customer Reference', 'Optional customer reference');
      const client = field('Client (optional)', 'text', 'Live Nation', false);
      const projectName = field('Project name (optional)', 'text', 'Coachella 2024', false);
      const drawnBy = field('Drawn by (optional)', 'text', 'John Smith', false);
      const notes = textareaField('Notes (optional)', 'Add notes for this load plan...');
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
      content.appendChild(loadPlanNumber.wrap);
      content.appendChild(customerReference.wrap);
      content.appendChild(client.wrap);
      content.appendChild(projectName.wrap);
      content.appendChild(drawnBy.wrap);
      content.appendChild(presetWrap);
      content.appendChild(modeWrap);
      content.appendChild(truckGrid);
      content.appendChild(notes.wrap);

      UIComponents.showModal({
        title: 'New Load Plan',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Create',
            variant: 'primary',
            onClick: () => {
              if (mutationBlockedWhileBusy()) return false;
              const t = String(title.input.value || '').trim();
              if (!t) {
                UIComponents.showToast('Title is required', 'warning');
                title.input.focus();
                return true;
              }
              const identity = validateLoadPlanIdentityFields(loadPlanNumber, customerReference, {
                numberRequired: false,
              });
              if (!identity) return false;
              const newTruck = {
                length: Number(tL.input.value) || 636,
                width: Number(tW.input.value) || 102,
                height: Number(tH.input.value) || 98,
                shapeMode:
                  modeSelect.value === 'wheelWells' || modeSelect.value === 'frontBonus' ? modeSelect.value : 'rect',
                shapeConfig: {},
              };
              if (newTruck.shapeMode === 'frontBonus') {
                newTruck.shapeConfig = normalizeFrontBonusShapeConfig(newTruck.shapeConfig, newTruck);
              }
              const pack = PackLibrary.create({
                title: t,
                loadPlanNumber: identity.loadPlanNumber,
                customerReference: identity.customerReference,
                client: String(client.input.value || '').trim(),
                projectName: String(projectName.input.value || '').trim(),
                drawnBy: String(drawnBy.input.value || '').trim(),
                notes: String(notes.textarea.value || '').trim(),
                truck: newTruck,
              });
              UIComponents.showToast('Load plan created', 'success', { title: pack.loadPlanNumber });
              PackLibrary.open(pack.id);
              AppShell.navigate('editor');
              return true;
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

      const loadPlanNumber = identityField('Load Plan Number (required)', '');
      loadPlanNumber.input.value = pack.loadPlanNumber || '';

      const customerReference = identityField('Customer Reference', '');
      customerReference.input.value = pack.customerReference || '';

      const client = field('Client (optional)', 'text', '', false);
      client.input.value = pack.client || '';

      const projectName = field('Project name (optional)', 'text', '', false);
      projectName.input.value = pack.projectName || '';

      const drawnBy = field('Drawn by (optional)', 'text', '', false);
      drawnBy.input.value = pack.drawnBy || '';

      const notes = textareaField('Notes (optional)', 'Add notes for this load plan...');
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

      function restoreEditControls() {
        title.input.value = pack.title || '';
        loadPlanNumber.input.value = pack.loadPlanNumber || '';
        customerReference.input.value = pack.customerReference || '';
        client.input.value = pack.client || '';
        projectName.input.value = pack.projectName || '';
        drawnBy.input.value = pack.drawnBy || '';
        notes.textarea.value = pack.notes || '';
        tL.input.value = String((pack.truck && pack.truck.length) || 636);
        tW.input.value = String((pack.truck && pack.truck.width) || 102);
        tH.input.value = String((pack.truck && pack.truck.height) || 98);
        modeSelect.value =
          pack.truck && (pack.truck.shapeMode === 'wheelWells' || pack.truck.shapeMode === 'frontBonus')
            ? pack.truck.shapeMode
            : 'rect';
        presetSelect.value = findPresetIdByDims(tL.input.value, tW.input.value, tH.input.value);
      }

      content.appendChild(title.wrap);
      content.appendChild(loadPlanNumber.wrap);
      content.appendChild(customerReference.wrap);
      content.appendChild(client.wrap);
      content.appendChild(projectName.wrap);
      content.appendChild(drawnBy.wrap);
      content.appendChild(presetWrap);
      content.appendChild(modeWrap);
      content.appendChild(truckGrid);
      content.appendChild(notes.wrap);

      let editModalRef = null;
      editModalRef = UIComponents.showModal({
        title: 'Edit Load Plan',
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
              const identity = validateLoadPlanIdentityFields(loadPlanNumber, customerReference, {
                numberRequired: true,
                excludeId: packId,
              });
              if (!identity) return false;
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
              if (nextTruck.shapeMode === 'frontBonus') {
                nextTruck.shapeConfig = normalizeFrontBonusShapeConfig(nextTruck.shapeConfig, nextTruck);
              }
              const metadata = {
                title: t,
                loadPlanNumber: identity.loadPlanNumber,
                customerReference: identity.customerReference,
                client: String(client.input.value || '').trim(),
                projectName: String(projectName.input.value || '').trim(),
                drawnBy: String(drawnBy.input.value || '').trim(),
                notes: String(notes.textarea.value || '').trim(),
              };
              requestTruckChange({
                pack,
                nextTruck,
                commitWhenUnchanged: true,
                successMessage: 'Load plan updated',
                restoreControls: restoreEditControls,
                commit: finalPack => PackLibrary.update(packId, {
                  ...metadata,
                  truck: finalPack.truck,
                  cases: finalPack.cases,
                }),
                onCommitted: () => editModalRef && editModalRef.close(),
              });
              return false;
            },
          },
        ],
      });
    }

    function openRename(packId) {
      const pack = PackLibrary.getById(packId);
      if (!pack) return;
      const content = document.createElement('div');
      const f = field('Load plan title', 'text', pack.title || '', true);
      f.input.value = pack.title || '';
      content.appendChild(f.wrap);
      UIComponents.showModal({
        title: 'Rename Load Plan',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Save',
            variant: 'primary',
            onClick: () => {
              const nextTitle = String(f.input.value || '').trim();
              if (!nextTitle) return true;
              if (mutationBlockedWhileBusy()) return false;
              PackLibrary.update(packId, { title: nextTitle });
              UIComponents.showToast('Renamed', 'success');
              return true;
            },
          },
        ],
      });
    }

    function exportPack(packId) {
      const pack = PackLibrary.getById(packId);
      if (!pack) return;
      const json = ImportExport.buildPackExportJSON(pack);
      Utils.downloadText(`${(pack.title || 'load-plan').replace(/[^a-z0-9]+/gi, '-')}.json`, json);
      toast('Load plan JSON exported', 'success');
    }

    async function deletePack(packId) {
      if (mutationBlockedWhileBusy()) return;
      const ok = await UIComponents.confirm({
        title: 'Delete load plan?',
        message: 'This will permanently delete 1 load plan. This cannot be undone.',
        danger: true,
        okLabel: 'Delete',
      });
      if (!ok) return;
      if (mutationBlockedWhileBusy()) return;
      PackLibrary.remove(packId);
      UIComponents.showToast('Load plan deleted', 'info');
    }

    function openImportPackDialog() {
      if (mutationBlockedWhileBusy()) return;
      if (ImportPackDialog && typeof ImportPackDialog.open === 'function') {
        ImportPackDialog.open({ beforeMutate: () => !mutationBlockedWhileBusy() });
      }
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

    function identityField(label, placeholder, helperText = '') {
      const fieldControl = field(label, 'text', placeholder, false);
      if (helperText) {
        const helper = document.createElement('div');
        helper.className = 'tp3d-cases-handling-help';
        helper.textContent = helperText;
        fieldControl.wrap.appendChild(helper);
      }
      const error = document.createElement('div');
      error.className = 'tp3d-field-error';
      error.setAttribute('role', 'alert');
      error.hidden = true;
      fieldControl.wrap.appendChild(error);
      fieldControl.input.addEventListener('input', () => {
        error.textContent = '';
        error.hidden = true;
        fieldControl.input.removeAttribute('aria-invalid');
      });
      return { ...fieldControl, error };
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
