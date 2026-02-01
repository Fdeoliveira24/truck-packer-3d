/**
 * @file app.js
 * @description Main browser entrypoint that bootstraps Truck Packer 3D, wires services/screens, and installs minimal global helpers.
 * @module app
 * @created Unknown
          function closeDropdowns() {
            try {
              UIComponents.closeAllDropdowns && UIComponents.closeAllDropdowns();
            } catch {
              // ignore
            }
          }

          function openSettingsOverlay(tab = 'preferences') {
            closeDropdowns();
            try {
              if (AccountOverlay && typeof AccountOverlay.close === 'function') AccountOverlay.close();
            } catch {
              // ignore
            }
            SettingsOverlay.open(tab);
          }

          function openAccountOverlay() {
            closeDropdowns();
            try {
              if (SettingsOverlay && typeof SettingsOverlay.close === 'function') SettingsOverlay.close();
            } catch {
              // ignore
            }
            AccountOverlay.open();
          }

 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

/*
  RUNTIME CORE (v1) - DO NOT MIX WITH LEGACY/V2 MODULES WITHOUT RECONCILING APIS
  - State:    ./core/state-store.js
  - Events:   ./core/events.js
  - Version:  ./core/version.js (APP_VERSION)
  - Storage:  ./core/storage.js (STORAGE_KEY = 'truckPacker3d:v1')
  - Session:  ./core/session.js (SESSION_KEY = 'truckPacker3d:session:v1')
*/

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { createSystemOverlay } from './ui/system-overlay.js';
import { createUIComponents } from './ui/ui-components.js';
import { createTableFooter } from './ui/table-footer.js';
import { TrailerPresets } from './data/trailer-presets.js';
import { createSceneRuntime } from './editor/scene-runtime.js';
import { createCaseScene, createInteractionManager, createEditorScreen } from './screens/editor-screen.js';
import { createPacksScreen } from './screens/packs-screen.js';
import { createCasesScreen } from './screens/cases-screen.js';
import * as CoreUtils from './core/utils/index.js';
import * as BrowserUtils from './core/browser.js';
import * as CoreDefaults from './core/defaults.js';
import * as CoreStateStore from './core/state-store.js';
import * as CoreNormalizer from './core/normalizer.js';
import * as CoreStorage from './core/storage.js';
import * as CoreSession from './core/session.js';
import * as CategoryService from './services/category-service.js';
import * as CoreCaseLibrary from './services/case-library.js';
import * as CorePackLibrary from './services/pack-library.js';
import * as ImportExport from './services/import-export.js';
import * as CorePreferencesManager from './services/preferences-manager.js';
import { createSettingsOverlay } from './ui/overlays/settings-overlay.js';
import { createAccountOverlay } from './ui/overlays/account-overlay.js';
import { createCardDisplayOverlay } from './ui/overlays/card-display-overlay.js';
import { createHelpModal } from './ui/overlays/help-modal.js';
import { createImportAppDialog } from './ui/overlays/import-app-dialog.js';
import { createImportPackDialog } from './ui/overlays/import-pack-dialog.js';
import { createImportCasesDialog } from './ui/overlays/import-cases-dialog.js';
import { createAppHelpers } from './core/app-helpers.js';
import { installDevHelpers } from './core/dev/dev-helpers.js';
import * as SupabaseClient from './core/supabase-client.js';
import { createAuthOverlay } from './ui/overlays/auth-overlay.js';
import { on, emit } from './core/events.js';
import { APP_VERSION } from './core/version.js';

// ============================================================================
// SECTION: INITIALIZATION
// ============================================================================

(async function () {
  try {
    if (window.__TP3D_BOOT && window.__TP3D_BOOT.threeReady) {
      await window.__TP3D_BOOT.threeReady;
    }
  } catch (_) {
    // Ignore boot errors
  }

  const UIComponents = createUIComponents();
  const SystemOverlay = createSystemOverlay();

  // ============================================================================
  // SECTION: APP BOOTSTRAP ENTRY
  // ============================================================================
  console.info('[TruckPackerApp] threeReady resolved, bootstrapping app');

  window.TruckPackerApp = (function () {
    'use strict';

    const featureFlags = { trailerPresetsEnabled: true };

    // ============================================================================
    // SECTION: FOUNDATION / UTILS
    // ============================================================================
    const Utils = (() => {
      function cssHexToInt(hex) {
        const s = String(hex || '').trim();
        const m = s.match(/^#([0-9a-f]{6})$/i);
        if (!m) return 0x000000;
        return parseInt(m[1], 16);
      }

      return {
        APP_VERSION,
        ...CoreUtils,
        ...BrowserUtils,
        cssHexToInt,
      };
    })();

    // ============================================================================
    // SECTION: STATE STORE (UNDO/REDO)
    // ============================================================================
    const StateStore = {
      init: CoreStateStore.init,
      get: CoreStateStore.get,
      set: CoreStateStore.set,
      replace: CoreStateStore.replace,
      snapshot: CoreStateStore.snapshot,
      undo: CoreStateStore.undo,
      redo: CoreStateStore.redo,
      subscribe: CoreStateStore.subscribe,
    };

    function toAscii(msg) {
      return String(msg || '')
        .replace(/[^\x20-\x7E]+/g, '')
        .trim();
    }

    const rawShowToast = UIComponents.showToast.bind(UIComponents);

    function toast(message, variant, options) {
      const safeMessage = toAscii(message);
      let safeOptions = options;
      if (options && typeof options === 'object') {
        safeOptions = { ...options };
        if (safeOptions.title) safeOptions.title = toAscii(safeOptions.title);
        if (Array.isArray(safeOptions.actions)) {
          safeOptions.actions = safeOptions.actions.map(a => ({
            ...a,
            label: toAscii(a && a.label),
          }));
        }
      }
      rawShowToast(safeMessage, variant, safeOptions);
    }

    UIComponents.showToast = toast;

    on('app:error', p => {
      const msg = p && typeof p === 'object' ? p.message : '';
      toast('Error: ' + toAscii(msg), 'error', { title: 'App' });
    });

    on('theme:apply', p => {
      const theme = p && p.theme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
    });

    const Storage = CoreStorage;
    on('storage:save_error', p => {
      toast('Save failed: ' + toAscii(p && p.message), 'error', { title: 'Storage' });
    });
    on('storage:load_error', p => {
      toast('Load failed: ' + toAscii(p && p.message), 'error', { title: 'Storage' });
    });
    // ============================================================================
    // SECTION: SESSION (LOCALSTORAGE)
    // ============================================================================
    const SessionManager = {
      get: CoreSession.get,
      clear: CoreSession.clear,
      subscribe: CoreSession.subscribe,
    };

    // ============================================================================
    // SECTION: DEFAULTS / PREFERENCES
    // ============================================================================
    const Defaults = CoreDefaults;
    const PreferencesManager = CorePreferencesManager;

    const Helpers = createAppHelpers({
      APP_VERSION,
      emit,
      getState: StateStore.get,
      getSession: SessionManager.get,
      isDev: Boolean(
        window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ),
    });
    Helpers.installGlobals();

    // ============================================================================
    // SECTION: OVERLAYS (SETTINGS + CARD DISPLAY)
    // ============================================================================
    const SettingsOverlay = createSettingsOverlay({
      documentRef: document,
      UIComponents,
      SessionManager,
      PreferencesManager,
      Defaults,
      Utils,
      getAccountSwitcher: () => AccountSwitcher,
      SupabaseClient,
      onExportApp: openExportAppModal,
      onImportApp: openImportAppDialog,
      onHelp: openHelpModal,
      onUpdates: openUpdatesScreen,
      onRoadmap: openRoadmapScreen,
    });
    const AccountOverlay = createAccountOverlay({
      documentRef: document,
      SupabaseClient,
    });
    const CardDisplayOverlay = createCardDisplayOverlay({
      documentRef: document,
      UIComponents,
      PreferencesManager,
      Defaults,
      Utils,
      getCasesUI: () => CasesUI,
      getPacksUI: () => PacksUI,
    });
    const AuthOverlay = createAuthOverlay({ UIComponents, SupabaseClient, tp3dDebugKey: 'tp3dDebug' });

    // Listen for auth signed-out events (including offline logout and cross-tab)
    window.addEventListener('tp3d:auth-signed-out', event => {
      const detail = event.detail || {};
      const isCrossTab = detail.crossTab === true;

      if (window.localStorage && window.localStorage.getItem('tp3dDebug') === '1') {
        console.log('[TruckPackerApp] Auth signed out', {
          crossTab: isCrossTab,
          source: detail.source,
          offline: detail.offline,
        });
      }

      // Force signed-out UI state
      try {
        if (AuthOverlay && typeof AuthOverlay.show === 'function') {
          AuthOverlay.show();
        } else {
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    });

    // Show small toasts on connectivity changes to improve UX
    try {
      window.addEventListener(
        'online',
        () => {
          try {
            UIComponents.showToast('Back online', 'info');
          } catch {
            // ignore
          }
        },
        { passive: true }
      );

      window.addEventListener(
        'offline',
        () => {
          try {
            UIComponents.showToast('You are offline', 'warning');
          } catch {
            // ignore
          }
        },
        { passive: true }
      );
    } catch {
      // ignore
    }

    const HelpModal = createHelpModal({ UIComponents });
    const ImportAppDialog = createImportAppDialog({
      documentRef: document,
      UIComponents,
      ImportExport,
      StateStore,
      Storage,
      PreferencesManager,
      applyCaseDefaultColor,
      Utils,
    });

    function closeDropdowns() {
      try {
        UIComponents.closeAllDropdowns && UIComponents.closeAllDropdowns();
      } catch {
        // ignore
      }
    }

    function openSettingsOverlay(tab = 'preferences') {
      closeDropdowns();
      try {
        if (AccountOverlay && typeof AccountOverlay.close === 'function') AccountOverlay.close();
      } catch {
        // ignore
      }
      try {
        SettingsOverlay.open(tab);
      } catch {
        // ignore
      }
    }

    function openAccountOverlay() {
      closeDropdowns();
      try {
        if (SettingsOverlay && typeof SettingsOverlay.close === 'function') SettingsOverlay.close();
      } catch {
        // ignore
      }
      try {
        AccountOverlay.open();
      } catch {
        // ignore
      }
    }

    function getSidebarAvatarView() {
      let user = null;
      try {
        user = SupabaseClient && typeof SupabaseClient.getUser === 'function' ? SupabaseClient.getUser() : null;
      } catch {
        user = null;
      }

      let sessionUser = null;
      try {
        const s = SessionManager.get();
        sessionUser = s && s.user ? s.user : null;
      } catch {
        sessionUser = null;
      }

      return Utils.getUserAvatarView({ user, sessionUser });
    }

    function renderSidebarBrandMarks() {
      const view = getSidebarAvatarView();
      const initials = (view && view.initials) || '';

      const switcherMark = document.querySelector('#btn-account-switcher .brand-mark');
      if (switcherMark) switcherMark.textContent = initials;
    }

    // ============================================================================
    // SECTION: UI WIDGET (ACCOUNT SWITCHER)
    // ============================================================================
    const AccountSwitcher = (() => {
      let anchorKeyCounter = 0;
      const mounts = new Map();

      function getDisplay() {
        const view = getSidebarAvatarView();
        const isAuthed = Boolean(view && view.isAuthed);
        const displayName = (view && view.displayName) || (isAuthed ? 'User' : 'Guest');

        return {
          accountName: 'Workspace',
          role: isAuthed ? 'Owner' : 'Guest',
          userName: displayName || '—',
          initials: (view && view.initials) || '',
        };
      }

      function renderButton(buttonEl) {
        if (!buttonEl) return;
        const display = getDisplay();
        const avatarEl = buttonEl.querySelector('.brand-mark');
        if (avatarEl) avatarEl.textContent = display.initials || '';
        const nameEl = buttonEl.querySelector('[data-account-name]');
        if (nameEl) nameEl.textContent = display.userName;
        renderSidebarBrandMarks();
      }

      function showComingSoon() {
        UIComponents.showToast('Coming soon', 'info');
      }

      async function logout() {
        try {
          UIComponents.closeAllDropdowns();
          SettingsOverlay.close();
          AccountOverlay.close();
        } catch {
          // ignore
        }

        // If Supabase auth is active, signing out there is the real "logout".
        // SessionManager.clear() only resets the local demo session.
        try {
          if (SupabaseClient && typeof SupabaseClient.signOut === 'function') {
            const result = await SupabaseClient.signOut({ global: true, allowOffline: true });

            SessionManager.clear();
            try {
              Storage.clearAll();
            } catch {
              // ignore
            }
            StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });

            if (result && result.offline) {
              UIComponents.showToast('Signed out. Full sign out will run when back online.', 'info');
            } else {
              UIComponents.showToast('Logged out', 'info');
            }
            return;
          }
        } catch (err) {
          // Only ignore if it's not a critical error
          console.warn('Logout error:', err);
        }

        SessionManager.clear();
        try {
          Storage.clearAll();
        } catch {
          // ignore
        }
        StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
        UIComponents.showToast('Logged out', 'info');
      }

      function getAnchorKey(anchorEl) {
        if (!anchorEl) return '';
        if (!anchorEl.dataset.accountSwitcherKey) {
          anchorEl.dataset.accountSwitcherKey = `account-switcher-${++anchorKeyCounter}`;
        }
        return anchorEl.dataset.accountSwitcherKey;
      }

      function openMenu(anchorEl, { align } = {}) {
        const display = getDisplay();
        const anchorKey = getAnchorKey(anchorEl);
        const existingDropdown = document.querySelector('[data-dropdown="1"][data-role="account-switcher"]');
        if (existingDropdown && existingDropdown.dataset.anchorId === anchorKey) {
          closeDropdowns();
          return;
        }
        closeDropdowns();
        const items = [
          {
            label: `${display.accountName} (${display.role})`,
            icon: 'fa-regular fa-user',
            rightIcon: 'fa-solid fa-check',
            disabled: true,
          },
          {
            label: 'Create Organization',
            icon: 'fa-solid fa-plus',
            onClick: () => showComingSoon(),
          },
          { type: 'divider' },
          {
            label: 'Account',
            icon: 'fa-regular fa-user',
            onClick: () => openSettingsOverlay('account'),
          },
          {
            label: 'Settings',
            icon: 'fa-solid fa-gear',
            onClick: () => openSettingsOverlay('preferences'),
          },
          {
            label: 'Log out',
            icon: 'fa-solid fa-right-from-bracket',
            onClick: () => void logout(),
          },
        ];

        const rect = anchorEl.getBoundingClientRect();
        UIComponents.openDropdown(anchorEl, items, {
          align: align || 'left',
          width: rect.width,
          role: 'account-switcher',
          anchorKey,
        });
      }

      function bind(buttonEl, { align } = {}) {
        if (!buttonEl) return () => {};
        if (mounts.has(buttonEl)) return mounts.get(buttonEl);

        renderButton(buttonEl);
        const onClick = ev => {
          ev.stopPropagation();
          openMenu(buttonEl, { align });
        };
        buttonEl.addEventListener('click', onClick);
        const unsub = SessionManager.subscribe(() => renderButton(buttonEl));

        const unmount = () => {
          try {
            unsub && unsub();
          } catch {
            // ignore
          }
          buttonEl.removeEventListener('click', onClick);
          mounts.delete(buttonEl);
        };
        mounts.set(buttonEl, unmount);
        return unmount;
      }

      function initAccountSwitcher() {
        const sidebarBtn = document.getElementById('btn-account-switcher');
        bind(sidebarBtn, { align: 'left' });
      }

      return { init: initAccountSwitcher, bind };
    })();

    // CategoryService extracted to src/services/category-service.js

    function applyCaseDefaultColor(caseObj) {
      const next = { ...(caseObj || {}) };
      const existing = String(next.color || '').trim();
      if (existing) return next;
      const key =
        String(next.category || 'default')
          .trim()
          .toLowerCase() || 'default';
      const cats = Defaults.categories || [];
      const found = cats.find(c => c.key === key) || cats.find(c => c.key === 'default');
      next.color = (found && found.color) || '#9ca3af';
      return next;
    }

    // ============================================================================
    // SECTION: DOMAIN DATA (CASES)
    // ============================================================================
    const CaseLibrary = CoreCaseLibrary;

    // ============================================================================
    // SECTION: GEOMETRY / DIMENSIONS
    // ============================================================================
    const TrailerGeometry = (() => {
      function getDims(truck) {
        const t = truck && typeof truck === 'object' ? truck : {};
        const length = Math.max(0, Number(t.length) || 0);
        const width = Math.max(0, Number(t.width) || 0);
        const height = Math.max(0, Number(t.height) || 0);
        return { length, width, height };
      }

      function getMode(truck) {
        const mode = truck && truck.shapeMode;
        if (mode === 'wheelWells' || mode === 'frontBonus' || mode === 'rect') return mode;
        return 'rect';
      }

      function getConfig(truck) {
        const cfg = truck && truck.shapeConfig;
        return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
      }

      function zone(min, max) {
        return { min: { ...min }, max: { ...max } };
      }

      function sanitizeZones(zones) {
        const EPS = 1e-9;
        return (zones || []).filter(z => {
          const dx = z.max.x - z.min.x;
          const dy = z.max.y - z.min.y;
          const dz = z.max.z - z.min.z;
          return dx > EPS && dy > EPS && dz > EPS;
        });
      }

      function getTrailerUsableZones(truck) {
        const { length: L, width: W, height: H } = getDims(truck);
        const mode = getMode(truck);
        const cfg = getConfig(truck);

        if (!L || !W || !H) return [];

        if (mode === 'frontBonus') {
          const bonusLengthRaw = Number(cfg.bonusLength);
          const bonusWidthRaw = Number(cfg.bonusWidth);
          const bonusHeightRaw = Number(cfg.bonusHeight);

          const bonusLength = Utils.clamp(Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0.12 * L, 0, L);
          const bonusWidth = Utils.clamp(Number.isFinite(bonusWidthRaw) ? bonusWidthRaw : W, 0, W);
          const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : H, 0, H);

          const splitX = L - bonusLength;
          const zones = [
            zone({ x: 0, y: 0, z: -W / 2 }, { x: splitX, y: H, z: W / 2 }),
            zone({ x: splitX, y: 0, z: -bonusWidth / 2 }, { x: L, y: bonusHeight, z: bonusWidth / 2 }),
          ];
          return sanitizeZones(zones);
        }

        if (mode === 'wheelWells') {
          const wellHeightRaw = Number(cfg.wellHeight);
          const wellWidthRaw = Number(cfg.wellWidth);
          const wellLengthRaw = Number(cfg.wellLength);
          const wellOffsetRaw = Number(cfg.wellOffsetFromRear);

          const wellHeight = Utils.clamp(Number.isFinite(wellHeightRaw) ? wellHeightRaw : 0.35 * H, 0, H);
          const wellWidth = Utils.clamp(Number.isFinite(wellWidthRaw) ? wellWidthRaw : 0.15 * W, 0, W / 2);
          const wellLength = Utils.clamp(Number.isFinite(wellLengthRaw) ? wellLengthRaw : 0.35 * L, 0, L);
          const wellOffsetFromRear = Utils.clamp(Number.isFinite(wellOffsetRaw) ? wellOffsetRaw : 0.25 * L, 0, L);

          const wx0 = wellOffsetFromRear;
          const wx1 = Utils.clamp(wx0 + wellLength, wx0, L);
          const betweenHalfW = Math.max(0, W / 2 - wellWidth);

          const zones = [
            // 1) rear full-width
            zone({ x: 0, y: 0, z: -W / 2 }, { x: wx0, y: H, z: W / 2 }),

            // 2) center corridor between wells (full height)
            zone({ x: wx0, y: 0, z: -betweenHalfW }, { x: wx1, y: H, z: betweenHalfW }),

            // 3) left above-well
            zone({ x: wx0, y: wellHeight, z: -W / 2 }, { x: wx1, y: H, z: -betweenHalfW }),

            // 4) right above-well
            zone({ x: wx0, y: wellHeight, z: betweenHalfW }, { x: wx1, y: H, z: W / 2 }),

            // 5) front full-width
            zone({ x: wx1, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 }),
          ];
          return sanitizeZones(zones);
        }

        // rect (default)
        return [zone({ x: 0, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 })];
      }

      function getTrailerCapacityInches3(truck) {
        const zones = getTrailerUsableZones(truck);
        return zones.reduce((sum, z) => {
          const dx = z.max.x - z.min.x;
          const dy = z.max.y - z.min.y;
          const dz = z.max.z - z.min.z;
          return sum + Math.max(0, dx) * Math.max(0, dy) * Math.max(0, dz);
        }, 0);
      }

      function isAabbContainedInAnyZone(aabb, zones) {
        for (const z of zones || []) {
          if (
            aabb.min.x >= z.min.x &&
            aabb.max.x <= z.max.x &&
            aabb.min.y >= z.min.y &&
            aabb.max.y <= z.max.y &&
            aabb.min.z >= z.min.z &&
            aabb.max.z <= z.max.z
          ) {
            return true;
          }
        }
        return false;
      }

      function zonesInchesToWorld(zonesInches) {
        return (zonesInches || []).map(z => ({
          min: {
            x: SceneManager.toWorld(z.min.x),
            y: SceneManager.toWorld(z.min.y),
            z: SceneManager.toWorld(z.min.z),
          },
          max: {
            x: SceneManager.toWorld(z.max.x),
            y: SceneManager.toWorld(z.max.y),
            z: SceneManager.toWorld(z.max.z),
          },
        }));
      }

      function zonesToSpacesInches(zonesInches) {
        return (zonesInches || []).map(z => ({
          x: z.min.x,
          y: z.min.y,
          z: z.min.z,
          length: z.max.x - z.min.x,
          width: z.max.z - z.min.z,
          height: z.max.y - z.min.y,
        }));
      }

      function getWheelWellsBlockedZones(truck) {
        const { length: L, width: W, height: H } = getDims(truck);
        const mode = getMode(truck);
        const cfg = getConfig(truck);
        if (mode !== 'wheelWells') return [];
        if (!L || !W || !H) return [];

        const wellHeightRaw = Number(cfg.wellHeight);
        const wellWidthRaw = Number(cfg.wellWidth);
        const wellLengthRaw = Number(cfg.wellLength);
        const wellOffsetRaw = Number(cfg.wellOffsetFromRear);

        const wellHeight = Utils.clamp(Number.isFinite(wellHeightRaw) ? wellHeightRaw : 0.35 * H, 0, H);
        const wellWidth = Utils.clamp(Number.isFinite(wellWidthRaw) ? wellWidthRaw : 0.15 * W, 0, W / 2);
        const wellLength = Utils.clamp(Number.isFinite(wellLengthRaw) ? wellLengthRaw : 0.35 * L, 0, L);
        const wellOffsetFromRear = Utils.clamp(Number.isFinite(wellOffsetRaw) ? wellOffsetRaw : 0.25 * L, 0, L);

        const wx0 = wellOffsetFromRear;
        const wx1 = Utils.clamp(wx0 + wellLength, wx0, L);
        const betweenHalfW = Math.max(0, W / 2 - wellWidth);

        const zones = [
          // Left wheel well (blocked)
          zone({ x: wx0, y: 0, z: -W / 2 }, { x: wx1, y: wellHeight, z: -betweenHalfW }),

          // Right wheel well (blocked)
          zone({ x: wx0, y: 0, z: betweenHalfW }, { x: wx1, y: wellHeight, z: W / 2 }),
        ];
        return sanitizeZones(zones);
      }

      function getFrontBonusZone(truck) {
        const { length: L, width: W, height: H } = getDims(truck);
        const mode = getMode(truck);
        const cfg = getConfig(truck);
        if (mode !== 'frontBonus') return null;
        if (!L || !W || !H) return null;

        const bonusLengthRaw = Number(cfg.bonusLength);
        const bonusWidthRaw = Number(cfg.bonusWidth);
        const bonusHeightRaw = Number(cfg.bonusHeight);

        const bonusLength = Utils.clamp(Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0.12 * L, 0, L);
        const bonusWidth = Utils.clamp(Number.isFinite(bonusWidthRaw) ? bonusWidthRaw : W, 0, W);
        const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : H, 0, H);

        const splitX = L - bonusLength;
        const zones = [zone({ x: splitX, y: 0, z: -bonusWidth / 2 }, { x: L, y: bonusHeight, z: bonusWidth / 2 })];
        return sanitizeZones(zones)[0] || null;
      }

      return {
        getTrailerUsableZones,
        getTrailerCapacityInches3,
        isAabbContainedInAnyZone,
        zonesInchesToWorld,
        zonesToSpacesInches,
        getWheelWellsBlockedZones,
        getFrontBonusZone,
      };
    })();

    // ============================================================================
    // SECTION: DOMAIN DATA (PACKS)
    // ============================================================================
    const PackLibrary = CorePackLibrary;

    // ============================================================================
    // SECTION: STATIC CONTENT (UPDATES/ROADMAP)
    // ============================================================================
    const Data = (() => {
      const updates = [
        {
          version: '1.0.0',
          date: '2026-01-15',
          features: [
            'Multi-screen workspace (Packs, Cases, Editor, Updates, Roadmap, Settings)',
            'Three.js 3D editor with drag placement',
            'CSV/XLSX import, PNG + PDF export',
          ],
          bugFixes: [],
          breakingChanges: [],
        },
        {
          version: '1.1.0',
          date: '2026-03-01',
          features: ['(Example) Weight balance view', '(Example) Case rotation'],
          bugFixes: ['(Example) Improved collision edge cases'],
          breakingChanges: [],
        },
      ];

      const roadmap = [
        {
          quarter: 'Q1 2026',
          items: [
            {
              title: 'Weight balance',
              status: 'Completed',
              badge: '✓',
              color: 'var(--success)',
              details: 'Add center-of-gravity and axle load estimates.',
            },
            {
              title: 'Rotation (MVP)',
              status: 'In Progress',
              badge: '⏱',
              color: 'var(--warning)',
              details: 'Allow 90° rotations and pack-time heuristics.',
            },
          ],
        },
        {
          quarter: 'Q2 2026',
          items: [
            {
              title: 'Multi-user',
              status: 'Planned',
              badge: '📋',
              color: 'var(--info)',
              details: 'Presence + change tracking (no real-time yet).',
            },
            {
              title: '3D export',
              status: 'Planned',
              badge: '📋',
              color: 'var(--info)',
              details: 'GLB/GLTF export for downstream tools.',
            },
          ],
        },
        {
          quarter: 'Future',
          items: [
            {
              title: 'AR view',
              status: 'Idea',
              badge: '💡',
              color: 'var(--text-muted)',
              details: 'Preview a load-out in real space on mobile.',
            },
          ],
        },
      ];

      return { updates, roadmap };
    })();

    // ============================================================================
    // SECTION: APP SHELL / NAVIGATION
    // ============================================================================
    const AppShell = (() => {
      const appRoot = document.getElementById('app');
      const sidebar = document.getElementById('sidebar');
      const btnSidebar = document.getElementById('btn-sidebar');
      const topbarTitle = document.getElementById('topbar-title');
      const topbarSubtitle = document.getElementById('topbar-subtitle');
      const contentRoot = document.querySelector('.content');
      const navButtons = Array.from(document.querySelectorAll('[data-nav]'));

      const screenTitles = {
        packs: { title: 'Packs', subtitle: 'Project library' },
        cases: { title: 'Cases', subtitle: 'Inventory management' },
        editor: { title: 'Editor', subtitle: '3D workspace' },
        updates: { title: 'Updates', subtitle: 'Release notes' },
        roadmap: { title: 'Roadmap', subtitle: 'Product direction' },
        settings: { title: 'Settings', subtitle: 'Preferences' },
      };

      function toggleSidebar() {
        const isMobile = window.matchMedia('(max-width: 899px)').matches;
        if (isMobile) {
          sidebar.classList.toggle('open');
        } else {
          appRoot.classList.toggle('sidebar-collapsed');
        }
      }

      function initShell() {
        btnSidebar.addEventListener('click', toggleSidebar);
        navButtons.forEach(btn => {
          btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-nav');
            navigate(target);
            if (window.matchMedia('(max-width: 899px)').matches) {
              sidebar.classList.remove('open');
            }
          });
        });

        window.addEventListener('resize', () => {
          if (!window.matchMedia('(max-width: 899px)').matches) {
            sidebar.classList.remove('open');
          }
        });
      }

      function navigate(screenKey) {
        StateStore.set({ currentScreen: screenKey }, { skipHistory: true });
      }

      function renderShell() {
        const screen = StateStore.get('currentScreen');
        navButtons.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-nav') === screen));
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const el = document.getElementById(`screen-${screen}`);
        if (el) {
          el.classList.add('active');
          if (
            screen === 'editor' &&
            window.TruckPackerApp &&
            window.TruckPackerApp.EditorUI &&
            typeof window.TruckPackerApp.EditorUI.onActivated === 'function'
          ) {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                try {
                  window.TruckPackerApp.EditorUI.onActivated();
                } catch (err) {
                  console.warn('[AppShell] Editor activation hook failed', err);
                }
              });
            });
          }
        }
        if (contentRoot) contentRoot.classList.toggle('editor-mode', screen === 'editor');

        const isMobile = window.matchMedia('(max-width: 899px)').matches;

        if (screen === 'editor') {
          // Collapse sidebar to maximize editor viewport (desktop only)
          if (isMobile) {
            appRoot.classList.remove('sidebar-collapsed');
            sidebar.classList.remove('open');
          } else {
            appRoot.classList.add('sidebar-collapsed');
            sidebar.classList.remove('open');
          }
          // Ensure editor panels visible to avoid empty canvas gap
          const editorLeft = document.getElementById('editor-left');
          const editorRight = document.getElementById('editor-right');
          editorLeft && editorLeft.classList.remove('hidden');
          editorRight && editorRight.classList.remove('hidden');
          const pack = PackLibrary.getById(StateStore.get('currentPackId'));
          topbarTitle.textContent = pack ? pack.title || 'Editor' : 'Editor';
          topbarSubtitle.textContent = pack ? `Edited ${Utils.formatRelativeTime(pack.lastEdited)}` : '3D workspace';
          return;
        }

        // Restore sidebar when leaving editor (desktop)
        if (!isMobile) appRoot.classList.remove('sidebar-collapsed');

        const meta = screenTitles[screen] || { title: 'Truck Packer 3D', subtitle: '' };
        topbarTitle.textContent = meta.title;
        topbarSubtitle.textContent = meta.subtitle;
      }

      return { init: initShell, navigate, renderShell };
    })();

    // ============================================================================
    // SECTION: 3D ENGINE (SCENE)
    // ============================================================================
    const SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore });

    // ============================================================================
    // SECTION: 3D SCENE (INSTANCES)
    // ============================================================================
    const CaseScene = createCaseScene({
      SceneManager,
      CaseLibrary,
      CategoryService,
      PackLibrary,
      StateStore,
      TrailerGeometry,
      Utils,
      PreferencesManager,
    });

    // ============================================================================
    // SECTION: 3D INTERACTION (SELECT/DRAG)
    // ============================================================================
    const InteractionManager = createInteractionManager({
      SceneManager,
      CaseScene,
      StateStore,
      PackLibrary,
      PreferencesManager,
      UIComponents,
    });

    // ============================================================================
    // SECTION: ENGINE (AUTOPACK)
    // ============================================================================
    const AutoPackEngine = (() => {
      let isRunning = false;

      /**
       * MVP AutoPack: First-Fit Decreasing in 3D (no rotation).
       * - Sort by volume (largest first)
       * - Place into the first available space
       * - Subdivide remaining space into candidate regions
       */
      async function pack() {
        if (isRunning) return;
        const packId = StateStore.get('currentPackId');
        const packData = PackLibrary.getById(packId);
        if (!packData) {
          UIComponents.showToast('Open a pack first', 'warning');
          return;
        }
        if (!(packData.cases || []).length) {
          UIComponents.showToast('No cases to pack', 'warning');
          return;
        }

        isRunning = true;
        toast('AutoPack starting...', 'info', { title: 'AutoPack', duration: 1800 });

        const truck = packData.truck;
        const packItems = (packData.cases || [])
          .filter(inst => !inst.hidden)
          .map(inst => {
            const c = CaseLibrary.getById(inst.caseId);
            if (!c) return null;
            const vol = c.volume || Utils.volumeInCubicInches(c.dimensions);
            return { inst, caseData: c, volume: vol };
          })
          .filter(Boolean)
          .sort((a, b) => b.volume - a.volume);

        // Step 1: move to staging (visual clarity)
        const stagingMap = buildStagingMap(packItems, truck);
        await stage(stagingMap);

        // Step 2: compute packing
        const zonesInches = TrailerGeometry.getTrailerUsableZones(truck);
        const spaces = TrailerGeometry.zonesToSpacesInches(zonesInches);
        spaces.sort((a, b) => b.length * b.width * b.height - a.length * a.width * a.height);

        const placements = new Map(); // instanceId -> position inches
        const packed = [];
        const unpacked = [];

        for (const item of packItems) {
          const dims = item.caseData.dimensions;
          let placed = false;
          for (let i = 0; i < spaces.length; i++) {
            const s = spaces[i];
            if (dims.length <= s.length && dims.width <= s.width && dims.height <= s.height) {
              const pos = {
                x: s.x + dims.length / 2,
                y: s.y + dims.height / 2,
                z: s.z + dims.width / 2,
              };
              if (!hasPackingCollision(pos, dims, packed)) {
                placements.set(item.inst.id, pos);
                packed.push({ position: pos, dimensions: dims });
                const nextSpaces = subdivideSpace(s, dims);
                spaces.splice(i, 1, ...nextSpaces);
                spaces.sort((a, b) => b.length * b.width * b.height - a.length * a.width * a.height);
                placed = true;
                break;
              }
            }
          }
          if (!placed) unpacked.push(item.inst.id);
        }

        // Step 3: animate to placements
        await animatePlacements(placements);

        // Step 4: persist to state (single update)
        const nextCases = (packData.cases || []).map(inst => {
          if (inst.hidden) return inst;
          const p = placements.get(inst.id) || stagingMap.get(inst.id);
          if (!p) return inst;
          return { ...inst, transform: { ...inst.transform, position: p }, hidden: false };
        });
        PackLibrary.update(packId, { cases: nextCases });

        const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
        const totalPackable = (packData.cases || []).filter(i => !i.hidden).length;
        UIComponents.showToast(
          `Packed ${stats.packedCases} of ${totalPackable} (${stats.volumePercent.toFixed(1)}%)`,
          stats.packedCases === totalPackable ? 'success' : 'warning',
          { title: 'AutoPack' }
        );
        if (unpacked.length) {
          UIComponents.showToast(`${unpacked.length} case(s) could not fit`, 'warning', { title: 'AutoPack' });
        }

        isRunning = false;

        // Auto-capture a pack preview thumbnail after AutoPack completes.
        window.setTimeout(() => {
          ExportService.capturePackPreview(packId, { source: 'auto' });
        }, 60);
      }

      function buildStagingMap(packItems, truck) {
        const baseX = -Math.max(60, truck.length * 0.12);
        const spacing = 28;
        const map = new Map();
        packItems.forEach((item, idx) => {
          const row = Math.floor(idx / 5);
          const col = idx % 5;
          const y = Math.max(
            1,
            item.caseData.dimensions && item.caseData.dimensions.height ? item.caseData.dimensions.height / 2 : 1
          );
          map.set(item.inst.id, { x: baseX - col * spacing, y, z: (row - 2) * spacing });
        });
        return map;
      }

      async function stage(stagingMap) {
        const targets = Array.from(stagingMap.entries()).map(([id, pos]) => ({ id, pos }));
        await Promise.all(targets.map(t => tweenInstanceToPosition(t.id, t.pos, 260)));
      }

      function hasPackingCollision(position, dims, packed) {
        const EPS = 1e-6;
        const box = {
          min: {
            x: position.x - dims.length / 2,
            y: position.y - dims.height / 2,
            z: position.z - dims.width / 2,
          },
          max: {
            x: position.x + dims.length / 2,
            y: position.y + dims.height / 2,
            z: position.z + dims.width / 2,
          },
        };
        for (const p of packed) {
          const other = {
            min: {
              x: p.position.x - p.dimensions.length / 2,
              y: p.position.y - p.dimensions.height / 2,
              z: p.position.z - p.dimensions.width / 2,
            },
            max: {
              x: p.position.x + p.dimensions.length / 2,
              y: p.position.y + p.dimensions.height / 2,
              z: p.position.z + p.dimensions.width / 2,
            },
          };
          if (
            box.min.x < other.max.x - EPS &&
            box.max.x > other.min.x + EPS &&
            box.min.y < other.max.y - EPS &&
            box.max.y > other.min.y + EPS &&
            box.min.z < other.max.z - EPS &&
            box.max.z > other.min.z + EPS
          ) {
            return true;
          }
        }
        return false;
      }

      function subdivideSpace(space, dims) {
        const out = [];
        const minVol = 10;

        // Right (X+)
        const rightLen = space.length - dims.length;
        if (rightLen > 0) {
          out.push({
            x: space.x + dims.length,
            y: space.y,
            z: space.z,
            length: rightLen,
            width: space.width,
            height: space.height,
          });
        }

        // Top (Y+)
        const topH = space.height - dims.height;
        if (topH > 0) {
          out.push({
            x: space.x,
            y: space.y + dims.height,
            z: space.z,
            length: dims.length,
            width: dims.width,
            height: topH,
          });
        }

        // Back (Z+)
        const backW = space.width - dims.width;
        if (backW > 0) {
          out.push({
            x: space.x,
            y: space.y,
            z: space.z + dims.width,
            length: dims.length,
            width: backW,
            height: dims.height,
          });
        }

        return out.filter(s => s.length * s.width * s.height > minVol);
      }

      async function animatePlacements(placements) {
        for (const [id, pos] of placements.entries()) {
          await tweenInstanceToPosition(id, pos, 240);
          await sleep(35);
        }
      }

      function tweenInstanceToPosition(instanceId, positionInches, duration) {
        const obj = CaseScene.getObject(instanceId);
        if (!obj) return Promise.resolve();
        const target = SceneManager.vecInchesToWorld(positionInches);
        return new Promise(resolve => {
          new TWEEN.Tween(obj.position)
            .to({ x: target.x, y: target.y, z: target.z }, duration)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onComplete(resolve)
            .start();
        });
      }

      function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
      }

      return {
        pack,
        get running() {
          return isRunning;
        },
      };
    })();

    // ============================================================================
    // SECTION: EXPORT (PNG/PDF)
    // ============================================================================
    const ExportService = (() => {
      function estimateDataUrlBytes(dataUrl) {
        const str = String(dataUrl || '');
        const comma = str.indexOf(',');
        if (comma === -1) return 0;
        const b64 = str.slice(comma + 1);
        const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
      }

      async function capturePackPreview(packId, { source = 'auto', quiet = false } = {}) {
        try {
          const pack = PackLibrary.getById(packId);
          if (!pack) throw new Error('Pack not found');

          // Ensure the latest transforms are rendered before capture.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

          const width = 320;
          const height = 180;
          const dataUrl = renderCameraToDataUrl(SceneManager.getCamera(), width, height, {
            mimeType: 'image/jpeg',
            quality: 0.72,
            hideGrid: true,
          });

          const bytes = estimateDataUrlBytes(dataUrl);
          const maxBytes = 150 * 1024;
          if (bytes > maxBytes) {
            throw new Error(`Preview too large (${Math.round(bytes / 1024)}KB)`);
          }

          PackLibrary.update(packId, {
            thumbnail: dataUrl,
            thumbnailUpdatedAt: Date.now(),
            thumbnailSource: source === 'manual' ? 'manual' : 'auto',
          });

          if (!quiet) UIComponents.showToast('Preview captured', 'success', { title: 'Preview' });
          return true;
        } catch (err) {
          if (!quiet) {
            UIComponents.showToast(`Preview failed: ${err.message || err}`, 'warning', { title: 'Preview' });
          }
          return false;
        }
      }

      function clearPackPreview(packId) {
        const pack = PackLibrary.getById(packId);
        if (!pack) return false;
        if (!pack.thumbnail) return false;
        PackLibrary.update(packId, { thumbnail: null, thumbnailUpdatedAt: null, thumbnailSource: null });
        UIComponents.showToast('Preview cleared', 'info', { title: 'Preview' });
        return true;
      }

      function captureScreenshot() {
        try {
          const pack = getCurrentPack();
          if (!pack) {
            UIComponents.showToast('Open a pack first', 'warning', { title: 'Export' });
            return;
          }
          const prefs = PreferencesManager.get();
          const res = Utils.parseResolution(prefs.export && prefs.export.screenshotResolution);
          const dataUrl = renderCameraToDataUrl(SceneManager.getCamera(), res.width, res.height, {
            mimeType: 'image/png',
            hideGrid: true,
          });
          downloadDataUrl(dataUrl, `truck-pack-${safeName(pack.title)}-${Date.now()}.png`);
          UIComponents.showToast('Screenshot saved', 'success', { title: 'Export' });
        } catch (err) {
          console.error(err);
          UIComponents.showToast('Screenshot failed: ' + err.message, 'error', { title: 'Export' });
        }
      }

      function generatePDF() {
        try {
          if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not available');
          const pack = getCurrentPack();
          if (!pack) {
            UIComponents.showToast('Open a pack first', 'warning', { title: 'Export' });
            return;
          }

          const prefs = PreferencesManager.get();
          const { jsPDF } = window.jspdf;
          const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });

          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();
          const margin = 40;
          let y = margin;

          // Header
          doc.setFontSize(22);
          doc.setFont('helvetica', 'bold');
          doc.text(pack.title || 'Pack', margin, y);
          y += 22;

          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
          y += 16;

          const details = [
            pack.client ? `Client: ${pack.client}` : null,
            pack.projectName ? `Project: ${pack.projectName}` : null,
            pack.drawnBy ? `Drawn by: ${pack.drawnBy}` : null,
          ].filter(Boolean);
          details.forEach(line => {
            doc.text(line, margin, y);
            y += 14;
          });
          if (details.length) y += 8;

          // Notes
          if (pack.notes) {
            doc.setFont('helvetica', 'bold');
            doc.text('NOTES', margin, y);
            y += 14;
            doc.setFont('helvetica', 'normal');
            const lines = doc.splitTextToSize(pack.notes, pageWidth - margin * 2);
            doc.text(lines, margin, y);
            y += lines.length * 12 + 10;
          }

          // Views
          const viewWPt = pageWidth - margin * 2;
          const viewWpx = 960;
          const viewHpx = 540;
          const perspective = renderCameraToDataUrl(SceneManager.getCamera(), viewWpx, viewHpx, {
            mimeType: 'image/jpeg',
            quality: 0.92,
            hideGrid: true,
          });

          const { topCam, sideCam } = buildOrthoCameras(pack);
          const topView = renderCameraToDataUrl(topCam, 960, 520, {
            mimeType: 'image/jpeg',
            quality: 0.9,
            hideGrid: true,
          });
          const sideView = renderCameraToDataUrl(sideCam, 960, 420, {
            mimeType: 'image/jpeg',
            quality: 0.9,
            hideGrid: true,
          });

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('PERSPECTIVE VIEW', margin, y);
          y += 10;
          y += 6;
          const pvH = viewWPt * (viewHpx / viewWpx);
          doc.addImage(perspective, 'JPEG', margin, y, viewWPt, pvH);
          y += pvH + 16;

          if (y + 220 > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }

          doc.text('TOP VIEW', margin, y);
          y += 10;
          y += 6;
          const tvH = viewWPt * (520 / 960);
          doc.addImage(topView, 'JPEG', margin, y, viewWPt, tvH);
          y += tvH + 16;

          if (y + 200 > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }

          doc.text('SIDE VIEW', margin, y);
          y += 10;
          y += 6;
          const svH = viewWPt * (420 / 960);
          doc.addImage(sideView, 'JPEG', margin, y, viewWPt, svH);

          // Checklist page
          doc.addPage();
          y = margin;

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(16);
          doc.text('CASE CHECKLIST', margin, y);
          y += 22;

          const entries = buildChecklist(pack);

          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          const x0 = margin;
          const x1 = margin + 24;
          const x2 = margin + 260;
          const x3 = margin + 360;
          const x4 = margin + 470;
          doc.text('#', x0, y);
          doc.text('Name', x1, y);
          doc.text('Category', x2, y);
          doc.text('Dims', x3, y);
          doc.text('Weight', x4, y);
          y += 8;
          doc.line(margin, y, pageWidth - margin, y);
          y += 14;

          doc.setFont('helvetica', 'normal');
          entries.forEach((e, idx) => {
            if (y > pageHeight - margin) {
              doc.addPage();
              y = margin;
              doc.setFont('helvetica', 'bold');
              doc.text('#', x0, y);
              doc.text('Name', x1, y);
              doc.text('Category', x2, y);
              doc.text('Dims', x3, y);
              doc.text('Weight', x4, y);
              y += 8;
              doc.line(margin, y, pageWidth - margin, y);
              y += 14;
              doc.setFont('helvetica', 'normal');
            }

            const lineHeight = 14;
            doc.text(String(idx + 1), x0, y);
            doc.text(e.name, x1, y);
            doc.text(e.category, x2, y);
            doc.text(e.dims, x3, y);
            doc.text(e.weight, x4, y);
            y += lineHeight;
          });

          // Summary
          const includeStats = Boolean(prefs.export && prefs.export.pdfIncludeStats);
          if (includeStats) {
            const stats = PackLibrary.computeStats(pack);
            if (y + 90 > pageHeight - margin) {
              doc.addPage();
              y = margin;
            } else {
              y += 16;
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.text('SUMMARY', margin, y);
            y += 16;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.text(`Cases loaded: ${stats.totalCases}`, margin, y);
            y += 14;
            doc.text(`Packed (in truck): ${stats.packedCases}`, margin, y);
            y += 14;
            doc.text(`Volume used: ${stats.volumePercent.toFixed(1)}%`, margin, y);
            y += 14;
            doc.text(`Total weight: ${Utils.formatWeight(stats.totalWeight, prefs.units.weight)}`, margin, y);
            y += 14;
            doc.text(`Truck (in): ${pack.truck.length}×${pack.truck.width}×${pack.truck.height}`, margin, y);
          }

          doc.save(`${safeName(pack.title)}-plan.pdf`);
          UIComponents.showToast('PDF exported', 'success', { title: 'Export' });
        } catch (err) {
          console.error(err);
          UIComponents.showToast('PDF export failed: ' + err.message, 'error', { title: 'Export' });
        }
      }

      function getCurrentPack() {
        const packId = StateStore.get('currentPackId');
        return packId ? PackLibrary.getById(packId) : null;
      }

      function safeName(name) {
        return (
          String(name || 'pack')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'pack'
        );
      }

      function downloadDataUrl(dataUrl, filename) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      function buildOrthoCameras(pack) {
        const lengthW = SceneManager.toWorld(pack.truck.length);
        const widthW = SceneManager.toWorld(pack.truck.width);
        const heightW = SceneManager.toWorld(pack.truck.height);
        const centerX = lengthW / 2;
        const centerY = heightW / 2;
        const margin = 3;

        const topCam = new THREE.OrthographicCamera(
          -(lengthW / 2 + margin),
          lengthW / 2 + margin,
          widthW / 2 + margin,
          -(widthW / 2 + margin),
          0.1,
          2000
        );
        topCam.position.set(centerX, heightW + 40, 0);
        topCam.up.set(0, 0, -1);
        topCam.lookAt(centerX, 0, 0);
        topCam.updateProjectionMatrix();

        const sideCam = new THREE.OrthographicCamera(
          -(lengthW / 2 + margin),
          lengthW / 2 + margin,
          heightW / 2 + margin,
          -(heightW / 2 + margin),
          0.1,
          2000
        );
        sideCam.position.set(centerX, centerY, widthW / 2 + 60);
        sideCam.lookAt(centerX, centerY, 0);
        sideCam.updateProjectionMatrix();

        return { topCam, sideCam };
      }

      function buildChecklist(pack) {
        const prefs = PreferencesManager.get();
        const truck = pack.truck;
        const unitLen = prefs.units.length;
        const unitWt = prefs.units.weight;
        return (pack.cases || []).map(inst => {
          const c = CaseLibrary.getById(inst.caseId);
          if (!c) return { name: 'Missing case', category: '—', dims: '—', weight: '—' };
          const meta = CategoryService.meta(c.category);
          return {
            name: c.name,
            category: meta.name,
            dims: Utils.formatDims(c.dimensions, unitLen),
            weight: Utils.formatWeight(Number(c.weight) || 0, unitWt),
            packed: isInsideTruckInstance(inst, c, truck) && !inst.hidden,
          };
        });
      }

      function isInsideTruckInstance(inst, c, truck) {
        if (!inst || !c || !truck) return false;
        const zonesInches = TrailerGeometry.getTrailerUsableZones(truck);
        const dims = c.dimensions || { length: 0, width: 0, height: 0 };
        const pos = inst.transform && inst.transform.position ? inst.transform.position : { x: 0, y: 0, z: 0 };
        const half = { x: dims.length / 2, y: dims.height / 2, z: dims.width / 2 };
        const aabb = {
          min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
          max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
        };
        return TrailerGeometry.isAabbContainedInAnyZone(aabb, zonesInches);
      }

      function renderCameraToDataUrl(camera, width, height, options = {}) {
        const renderer = SceneManager.getRenderer();
        const scene = SceneManager.getScene();
        if (!renderer || !scene || !camera) throw new Error('3D viewport not ready');

        const mimeType = options.mimeType || 'image/png';
        const quality = Number.isFinite(options.quality) ? options.quality : 0.92;

        const prevTarget = renderer.getRenderTarget();
        const prevViewport = new THREE.Vector4();
        const prevScissor = new THREE.Vector4();
        renderer.getViewport(prevViewport);
        renderer.getScissor(prevScissor);
        const prevScissorTest = renderer.getScissorTest ? renderer.getScissorTest() : false;
        const prevPixelRatio = renderer.getPixelRatio();
        const prevBg = scene.background;

        const gridObj = scene.getObjectByName('grid');
        const prevGridVisible = gridObj ? gridObj.visible : null;

        const prevAspect = camera.isPerspectiveCamera ? camera.aspect : null;

        const rt = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat });
        const pixels = new Uint8Array(width * height * 4);

        try {
          if (options.hideGrid && gridObj) gridObj.visible = false;
          renderer.setPixelRatio(1);
          renderer.setRenderTarget(rt);
          renderer.setViewport(0, 0, width, height);
          renderer.setScissorTest(false);
          if (camera.isPerspectiveCamera) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          }
          renderer.render(scene, camera);
          renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels);
        } finally {
          renderer.setRenderTarget(prevTarget);
          renderer.setPixelRatio(prevPixelRatio);
          renderer.setViewport(prevViewport.x, prevViewport.y, prevViewport.z, prevViewport.w);
          renderer.setScissor(prevScissor.x, prevScissor.y, prevScissor.z, prevScissor.w);
          renderer.setScissorTest(prevScissorTest);
          scene.background = prevBg;
          if (gridObj && prevGridVisible != null) gridObj.visible = prevGridVisible;
          if (camera.isPerspectiveCamera && prevAspect != null) {
            camera.aspect = prevAspect;
            camera.updateProjectionMatrix();
          }
          rt.dispose();
        }

        // Flip Y and encode
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++) {
          const src = (height - y - 1) * width * 4;
          const dst = y * width * 4;
          img.data.set(pixels.subarray(src, src + width * 4), dst);
        }
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL(mimeType, quality);
      }

      return { captureScreenshot, generatePDF, capturePackPreview, clearPackPreview };
    })();

    // ==== UI: Packs Screen ====
    // ============================================================================
    // SECTION: SCREEN UI (PACKS)
    // ============================================================================
    const ImportPackDialog = createImportPackDialog({
      documentRef: document,
      UIComponents,
      ImportExport,
      PackLibrary,
      Utils,
    });
    const ImportCasesDialog = createImportCasesDialog({
      documentRef: document,
      UIComponents,
      ImportExport,
      StateStore,
      Utils,
    });
    const PacksUI = createPacksScreen({
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
      toast,
      toAscii,
    });

    // ============================================================================
    // SECTION: SCREEN UI (CASES)
    // ============================================================================
    const CasesUI = createCasesScreen({
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
    });

    // ============================================================================
    // SECTION: SCREEN UI (EDITOR)
    // ============================================================================
    const EditorUI = createEditorScreen({
      StateStore,
      PackLibrary,
      CaseLibrary,
      PreferencesManager,
      UIComponents,
      Utils,
      TrailerGeometry,
      CategoryService,
      AutoPackEngine,
      ExportService,
      SystemOverlay,
      TrailerPresets,
      AppShell,
      SceneManager,
      CaseScene,
      InteractionManager,
    });

    // ============================================================================
    // SECTION: SCREEN UI (UPDATES)
    // ============================================================================
    const UpdatesUI = (() => {
      const listEl = document.getElementById('updates-list');
      function initUpdatesUI() {}
      function render() {
        listEl.innerHTML = '';
        Data.updates.forEach(u => {
          const card = document.createElement('div');
          card.className = 'card';
          const header = document.createElement('div');
          header.className = 'row space-between';
          header.style.alignItems = 'flex-start';
          const left = document.createElement('div');
          left.innerHTML = `<div style="font-weight:var(--font-semibold);font-size:var(--text-lg)">Version ${u.version}</div><div class="muted" style="font-size:var(--text-xs)">${new Date(u.date).toLocaleDateString()}</div>`;
          header.appendChild(left);
          card.appendChild(header);

          const sections = [
            { title: 'New Features', items: u.features || [] },
            { title: 'Bug Fixes', items: u.bugFixes || [] },
            { title: 'Breaking Changes', items: u.breakingChanges || [] },
          ].filter(s => s.items.length);
          sections.forEach(s => {
            const t = document.createElement('div');
            t.style.marginTop = '12px';
            t.style.fontWeight = 'var(--font-semibold)';
            t.textContent = s.title;
            card.appendChild(t);
            const ul = document.createElement('ul');
            ul.style.margin = '8px 0 0 16px';
            ul.style.color = 'var(--text-secondary)';
            ul.style.fontSize = 'var(--text-sm)';
            s.items.forEach(it => {
              const li = document.createElement('li');
              li.textContent = it;
              ul.appendChild(li);
            });
            card.appendChild(ul);
          });
          listEl.appendChild(card);
        });
      }
      return { init: initUpdatesUI, render };
    })();

    // ============================================================================
    // SECTION: SCREEN UI (ROADMAP)
    // ============================================================================
    const RoadmapUI = (() => {
      const listEl = document.getElementById('roadmap-list');
      function initRoadmapUI() {}
      function render() {
        listEl.innerHTML = '';
        Data.roadmap.forEach(group => {
          const wrap = document.createElement('div');
          wrap.className = 'grid';
          wrap.style.gap = '10px';
          const h = document.createElement('div');
          h.style.fontSize = 'var(--text-lg)';
          h.style.fontWeight = 'var(--font-semibold)';
          h.textContent = group.quarter;
          wrap.appendChild(h);
          const grid = document.createElement('div');
          grid.className = 'pack-grid';
          grid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
          group.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.cursor = 'pointer';
            card.innerHTML = `
                  <div class="row space-between" style="gap:10px">
                    <div style="font-weight:var(--font-semibold)">${item.title}</div>
                    <div class="badge" style="border-color:transparent;background:${item.color};color:white">${item.badge} ${item.status}</div>
                  </div>
                  <div class="muted" style="font-size:var(--text-sm);margin-top:8px">${item.details}</div>
                `;
            card.addEventListener('click', () => {
              UIComponents.showModal({
                title: item.title,
                content: `<div class="muted" style="font-size:var(--text-sm)">${item.details}</div>`,
                actions: [{ label: 'Close', variant: 'primary' }],
              });
            });
            grid.appendChild(card);
          });
          wrap.appendChild(grid);
          listEl.appendChild(wrap);
        });
      }
      return { init: initRoadmapUI, render };
    })();

    // ============================================================================
    // SECTION: SCREEN UI (SETTINGS)
    // ============================================================================
    const SettingsUI = (() => {
      const elLength = document.getElementById('pref-length');
      const elWeight = document.getElementById('pref-weight');
      const elTheme = document.getElementById('pref-theme');
      const elLabel = document.getElementById('pref-label-size');
      const elHidden = document.getElementById('pref-hidden-opacity');
      const elSnap = document.getElementById('pref-snapping-enabled');
      const elGrid = document.getElementById('pref-grid-size');
      const elShot = document.getElementById('pref-shot-res');
      const elPdfStats = document.getElementById('pref-pdf-stats');
      const btnSave = document.getElementById('btn-save-prefs');
      const btnReset = document.getElementById('btn-reset-demo');

      function initSettingsUI() {
        btnSave.addEventListener('click', () => save());
        btnReset.addEventListener('click', async () => {
          const ok = await UIComponents.confirm({
            title: 'Reset demo data?',
            message: 'This replaces your local data with the demo set.',
            danger: true,
            okLabel: 'Reset',
          });
          if (!ok) return;
          Storage.clearAll();
          window.location.reload();
        });
      }

      function loadForm() {
        const p = PreferencesManager.get();
        elLength.value = p.units.length;
        elWeight.value = p.units.weight;
        elTheme.value = p.theme;
        elLabel.value = String(p.labelFontSize);
        elHidden.value = String(p.hiddenCaseOpacity);
        elSnap.value = String(Boolean(p.snapping.enabled));
        elGrid.value = String(p.snapping.gridSize);
        elShot.value = p.export.screenshotResolution;
        elPdfStats.value = String(Boolean(p.export.pdfIncludeStats));
      }

      function save() {
        const prev = PreferencesManager.get();
        const next = Utils.deepClone(prev);
        next.units.length = elLength.value;
        next.units.weight = elWeight.value;
        next.theme = elTheme.value;
        next.labelFontSize = Utils.clamp(Number(elLabel.value) || 12, 8, 24);
        next.hiddenCaseOpacity = Utils.clamp(Number(elHidden.value) || 0.3, 0, 1);
        next.snapping.enabled = elSnap.value === 'true';
        next.snapping.gridSize = Math.max(0.25, Number(elGrid.value) || 1);
        next.export.screenshotResolution = elShot.value;
        next.export.pdfIncludeStats = elPdfStats.value === 'true';
        PreferencesManager.set(next);
        PreferencesManager.applyTheme(next.theme);
        UIComponents.showToast('Preferences saved', 'success');
      }

      return { init: initSettingsUI, loadForm };
    })();

    // ============================================================================
    // SECTION: GLOBAL INPUT (KEYBOARD)
    // ============================================================================
    const KeyboardManager = (() => {
      let clipboard = null;

      function initKeyboardManager() {
        document.addEventListener('keydown', handleKeyDown);
      }

      function handleKeyDown(event) {
        if (isTypingContext(event)) return;
        const key = buildKeyString(event);
        const handler = shortcuts[key];
        if (!handler) return;
        const handled = handler(event);
        if (handled === false) return;
        event.preventDefault();
      }

      function isTypingContext(event) {
        const el = event.target;
        if (!el) return false;
        if (el.isContentEditable) return true;
        return el.matches && el.matches('input, textarea, select');
      }

      function buildKeyString(event) {
        const parts = [];
        if (event.metaKey) parts.push('meta');
        if (event.ctrlKey && !event.metaKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');
        parts.push(String(event.key || '').toLowerCase());
        return parts.join('+');
      }

      function inEditor() {
        return StateStore.get('currentScreen') === 'editor';
      }

      function save() {
        Storage.saveNow();
        UIComponents.showToast('Saved locally', 'success', { title: 'Storage' });
      }

      function undo() {
        const ok = StateStore.undo();
        UIComponents.showToast(ok ? 'Undone' : 'Nothing to undo', ok ? 'info' : 'warning', { title: 'Edit' });
      }

      function redo() {
        const ok = StateStore.redo();
        UIComponents.showToast(ok ? 'Redone' : 'Nothing to redo', ok ? 'info' : 'warning', { title: 'Edit' });
      }

      function deselectAll() {
        StateStore.set({ selectedInstanceIds: [] }, { skipHistory: true });
        CaseScene.setSelected([]);
      }

      function selectAll() {
        if (!inEditor()) return;
        InteractionManager.selectAllInPack();
      }

      function deleteSelected() {
        if (!inEditor()) return;
        InteractionManager.deleteSelection();
      }

      function duplicateSelected() {
        if (!inEditor()) return;
        const packId = StateStore.get('currentPackId');
        const pack = PackLibrary.getById(packId);
        const selected = StateStore.get('selectedInstanceIds') || [];
        if (!pack || !selected.length) return;

        const nextCases = [...(pack.cases || [])];
        const newIds = [];
        selected.forEach(id => {
          const inst = (pack.cases || []).find(i => i.id === id);
          if (!inst) return;
          const pos = inst.transform && inst.transform.position ? inst.transform.position : { x: -80, y: 10, z: 0 };
          nextCases.push({
            ...Utils.deepClone(inst),
            id: Utils.uuid(),
            transform: {
              ...Utils.deepClone(inst.transform || {}),
              position: { x: pos.x + 12, y: pos.y, z: pos.z + 12 },
            },
            hidden: false,
          });
          newIds.push(nextCases[nextCases.length - 1].id);
        });

        PackLibrary.update(packId, { cases: nextCases });
        StateStore.set({ selectedInstanceIds: newIds }, { skipHistory: true });
        UIComponents.showToast(`Duplicated ${newIds.length} case(s)`, 'success', { title: 'Edit' });
      }

      function copySelected() {
        if (!inEditor()) return;
        const packId = StateStore.get('currentPackId');
        const pack = PackLibrary.getById(packId);
        const selected = StateStore.get('selectedInstanceIds') || [];
        if (!pack || !selected.length) return;
        clipboard = selected
          .map(id => (pack.cases || []).find(i => i.id === id))
          .filter(Boolean)
          .map(i => ({ caseId: i.caseId, transform: Utils.deepClone(i.transform || {}) }));
        UIComponents.showToast(`Copied ${clipboard.length} case(s)`, 'info', { title: 'Clipboard' });
      }

      function pasteClipboard() {
        if (!inEditor()) return;
        const packId = StateStore.get('currentPackId');
        const pack = PackLibrary.getById(packId);
        if (!pack || !clipboard || !clipboard.length) return;

        const nextCases = [...(pack.cases || [])];
        const newIds = [];
        clipboard.forEach(item => {
          const pos = item.transform && item.transform.position ? item.transform.position : { x: -80, y: 10, z: 0 };
          nextCases.push({
            id: Utils.uuid(),
            caseId: item.caseId,
            transform: {
              position: { x: pos.x + 12, y: pos.y, z: pos.z + 12 },
              rotation: Utils.deepClone((item.transform && item.transform.rotation) || { x: 0, y: 0, z: 0 }),
              scale: Utils.deepClone((item.transform && item.transform.scale) || { x: 1, y: 1, z: 1 }),
            },
            hidden: false,
            groupId: null,
          });
          newIds.push(nextCases[nextCases.length - 1].id);
        });

        PackLibrary.update(packId, { cases: nextCases });
        StateStore.set({ selectedInstanceIds: newIds }, { skipHistory: true });
        UIComponents.showToast(`Pasted ${newIds.length} case(s)`, 'success', { title: 'Clipboard' });
      }

      function focusSelected() {
        if (!inEditor()) return;
        const selected = StateStore.get('selectedInstanceIds') || [];
        if (!selected.length) return;
        const obj = CaseScene.getObject(selected[0]);
        if (!obj) return;
        SceneManager.focusOnWorldPoint(obj.position.clone(), { duration: 600 });
      }

      function toggleGrid() {
        if (!inEditor()) return;
        const visible = SceneManager.toggleGrid();
        UIComponents.showToast(visible ? 'Grid shown' : 'Grid hidden', 'info', { title: 'View', duration: 1200 });
      }

      function toggleShadows() {
        if (!inEditor()) return;
        const enabled = SceneManager.toggleShadows();
        UIComponents.showToast(enabled ? 'Shadows enabled' : 'Shadows disabled', 'info', {
          title: 'View',
          duration: 1200,
        });
      }

      function openPackDialog() {
        const packs = PackLibrary.getPacks()
          .slice()
          .sort((a, b) => (b.lastEdited || 0) - (a.lastEdited || 0));
        const content = document.createElement('div');
        content.className = 'grid';
        content.style.gap = '10px';
        if (!packs.length) {
          const empty = document.createElement('div');
          empty.className = 'muted';
          empty.style.fontSize = 'var(--text-sm)';
          empty.textContent = 'No packs available.';
          content.appendChild(empty);
        } else {
          packs.forEach(p => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'btn';
            row.style.justifyContent = 'space-between';
            row.style.width = '100%';
            const name = document.createElement('span');
            name.style.fontWeight = 'var(--font-semibold)';
            name.textContent = p.title || 'Untitled';
            const meta = document.createElement('span');
            meta.className = 'muted';
            meta.style.fontSize = 'var(--text-xs)';
            meta.textContent = `edited ${Utils.formatRelativeTime(p.lastEdited)}`;
            row.appendChild(name);
            row.appendChild(meta);
            row.addEventListener('click', () => {
              PackLibrary.open(p.id);
              AppShell.navigate('editor');
              modal.close();
            });
            content.appendChild(row);
          });
        }

        const modal = UIComponents.showModal({
          title: 'Open Pack',
          content,
          actions: [{ label: 'Close', variant: 'primary' }],
        });
      }

      const shortcuts = {
        'meta+s': save,
        'ctrl+s': save,
        'meta+z': undo,
        'ctrl+z': undo,
        'meta+shift+z': redo,
        'ctrl+shift+z': redo,
        'meta+a': selectAll,
        'ctrl+a': selectAll,
        'meta+shift+a': deselectAll,
        'ctrl+shift+a': deselectAll,
        escape: deselectAll,
        delete: deleteSelected,
        backspace: deleteSelected,
        'meta+d': duplicateSelected,
        'ctrl+d': duplicateSelected,
        'meta+c': copySelected,
        'ctrl+c': copySelected,
        'meta+v': pasteClipboard,
        'ctrl+v': pasteClipboard,
        'meta+p': () => {
          if (!inEditor()) return;
          AutoPackEngine.pack();
        },
        'ctrl+p': () => {
          if (!inEditor()) return;
          AutoPackEngine.pack();
        },
        'meta+o': openPackDialog,
        'ctrl+o': openPackDialog,
        g: toggleGrid,
        s: toggleShadows,
        f: focusSelected,
        p: () => {
          if (!inEditor()) return;
          SceneManager.toggleDevOverlay();
        },
      };

      return { init: initKeyboardManager };
    })();

    function openExportAppModal() {
      const content = document.createElement('div');
      content.style.display = 'grid';
      content.style.gap = '12px';

      const blurb = document.createElement('div');
      blurb.className = 'muted';
      blurb.style.fontSize = 'var(--text-sm)';
      blurb.innerHTML =
        '<div><strong>App Export</strong> downloads a full JSON backup of packs, cases, and settings.</div>' +
        '<div style="height:8px"></div>' +
        '<div>This file can be imported back to restore everything.</div>';

      const filename = `truck-packer-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const meta = document.createElement('div');
      meta.className = 'card';
      meta.innerHTML = `
              <div style="font-weight:var(--font-semibold);margin-bottom:6px">Export details</div>
              <div class="muted" style="font-size:var(--text-sm)">File: ${Utils.escapeHtml(filename)}</div>
            `;

      content.appendChild(blurb);
      content.appendChild(meta);

      UIComponents.showModal({
        title: 'Export App JSON',
        content,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Export',
            variant: 'primary',
            onClick: () => {
              try {
                const json = ImportExport.buildAppExportJSON();
                Utils.downloadText(filename, json);
                UIComponents.showToast('App JSON exported', 'success');
              } catch (err) {
                UIComponents.showToast('Export failed: ' + (err && err.message), 'error');
              }
            },
          },
        ],
      });
    }

    function openImportAppDialog() {
      ImportAppDialog.open();
    }

    function openHelpModal() {
      HelpModal.open();
    }

    function openUpdatesScreen() {
      SettingsOverlay.close();
      AppShell.navigate('updates');
    }

    function openRoadmapScreen() {
      SettingsOverlay.close();
      AppShell.navigate('roadmap');
    }

    function wireGlobalButtons() {
      const btnExport = document.getElementById('btn-export-app');
      const btnImport = document.getElementById('btn-import-app');
      const btnHelp = document.getElementById('btn-help');

      if (btnExport) btnExport.addEventListener('click', openExportAppModal);
      if (btnImport) btnImport.addEventListener('click', openImportAppDialog);
      if (btnHelp) btnHelp.addEventListener('click', openHelpModal);
    }

    // ============================================================================
    // SECTION: BOOT HELPERS (SEED)
    // ============================================================================
    function seedIfEmpty() {
      const stored = Storage.load();
      if (stored && stored.caseLibrary && stored.packLibrary && stored.preferences) {
        const storedCases = (stored.caseLibrary || []).map(applyCaseDefaultColor);
        const initialState = {
          currentScreen: 'packs',
          currentPackId: stored.currentPackId || null,
          selectedInstanceIds: [],
          caseLibrary: storedCases,
          packLibrary: stored.packLibrary,
          preferences: stored.preferences,
        };
        StateStore.init(initialState);
        return;
      }

      const cases = Defaults.seedCases();
      cases.forEach(c => {
        c.volume = Utils.volumeInCubicInches(c.dimensions);
      });
      const demoPack = Defaults.seedPack(cases);
      demoPack.stats = PackLibrary.computeStats(demoPack, cases);
      const initialState = {
        currentScreen: 'packs',
        currentPackId: demoPack.id,
        selectedInstanceIds: [],
        caseLibrary: cases,
        packLibrary: [demoPack],
        preferences: Defaults.defaultPreferences,
      };
      StateStore.init(initialState);
      Storage.saveNow();
    }

    // ============================================================================
    // SECTION: BOOT HELPERS (RUNTIME VALIDATION)
    // ============================================================================
    function validateRuntime() {
      const failures = window.__TP3D_BOOT && window.__TP3D_BOOT.cdnFailures ? window.__TP3D_BOOT.cdnFailures : [];
      failures.forEach(f => {
        UIComponents.showToast(`${f.name} failed to load`, 'error', {
          title: 'CDN',
          actions: [{ label: 'Retry', onClick: () => window.location.reload() }],
        });
      });

      if (!Utils.hasWebGL()) {
        SystemOverlay.show({
          title: 'WebGL required',
          message: 'This app requires WebGL. Please update your browser or enable hardware acceleration.',
          items: ['Chrome/Edge: Settings → System → Use hardware acceleration', 'Safari: Update to Safari 14+'],
        });
        return false;
      }

      const missing = [];
      if (!window.THREE) missing.push('three@0.160.0');
      if (!window.THREE || !window.THREE.OrbitControls) missing.push('OrbitControls');
      if (!window.TWEEN) missing.push('@tweenjs/tween.js');
      if (!window.XLSX) missing.push('xlsx');
      if (!window.jspdf) missing.push('jsPDF');
      if (missing.length) {
        SystemOverlay.show({
          title: 'Missing dependencies',
          message: 'Some required CDN libraries did not load. Check your connection or allowlisted CDNs.',
          items: missing.map(m => `Missing: ${m}`),
        });
        return false;
      }

      return true;
    }

    function renderAll() {
      AppShell.renderShell();
      PacksUI.render();
      CasesUI.render();
      EditorUI.render();
      UpdatesUI.render();
      RoadmapUI.render();
      SettingsUI.loadForm();
    }

    // ============================================================================
    // SECTION: APP INIT (ORDER CRITICAL)
    // ============================================================================
    let authListenerInstalled = false;
    // Latch used to temporarily hold a forced account-disabled message so
    // normal signed-out flows don't overwrite it while we show the disabled UI.
    let authBlockState = null;

    function setAuthBlocked(message) {
      try {
        authBlockState = { message: message || 'Your account has been disabled.', ts: Date.now() };
      } catch {
        authBlockState = { message: 'Your account has been disabled.', ts: Date.now() };
      }
    }

    function clearAuthBlocked() {
      authBlockState = null;
    }
    let readyToastShown = false;

    function showReadyOnce() {
      if (readyToastShown) return;
      readyToastShown = true;
      UIComponents.showToast('Ready', 'success', { title: 'Truck Packer 3D' });
    }

    /**
     * Check if current user's profile is in deletion requested state.
     * If so, sign out and show disabled overlay.
     * @returns {Promise<boolean>} true if OK to proceed, false if blocked
     */
    async function checkProfileStatus() {
      try {
        // First check if user is actually banned in Supabase auth
        const user = SupabaseClient.getUser();
        if (!user) return true; // Not logged in, let auth flow handle it

        // Get the raw user data which includes ban info
        const client = SupabaseClient.getClient();
        const { data: { user: fullUser } = {}, error: userError } = await client.auth.getUser();

        if (userError) {
          // If we can't get user data, might be banned or invalid session
          if (
            userError.message &&
            (userError.message.includes('banned') ||
              userError.message.includes('disabled') ||
              userError.message.includes('Invalid') ||
              userError.status === 401)
          ) {
            try {
              await SupabaseClient.signOut({ global: false, allowOffline: true });
            } catch {
              // ignore
            }
            const blockedMsg =
              userError && userError.message ? String(userError.message) : 'Your account has been disabled.';
            setAuthBlocked(blockedMsg);
            AuthOverlay.showAccountDisabled(blockedMsg);
            return false;
          }
          return true; // Other errors, fail open
        }

        // Check if user is banned (Supabase sets user.banned_until)
        if (fullUser && fullUser.banned_until) {
          const bannedUntil = new Date(fullUser.banned_until);
          const now = new Date();

          if (bannedUntil > now) {
            // Still banned
            try {
              await SupabaseClient.signOut({ global: false, allowOffline: true });
            } catch {
              // ignore
            }
            const bannedMsg = bannedUntil
              ? `Your account has been disabled until ${bannedUntil.toLocaleString()}.`
              : 'Your account has been disabled.';
            setAuthBlocked(bannedMsg);
            AuthOverlay.showAccountDisabled(bannedMsg);
            return false;
          }
        }

        // User is not banned, check profile deletion status
        const profileStatus = await SupabaseClient.getMyProfileStatus();
        if (profileStatus && profileStatus.deletion_status === 'requested') {
          // Profile marked for deletion but user might not be banned yet
          // Only block if they're actually banned
          if (fullUser && fullUser.banned_until) {
            try {
              await SupabaseClient.signOut({ global: false, allowOffline: true });
            } catch {
              // ignore
            }
            const delMsg =
              fullUser && fullUser.banned_until
                ? `Your account has been disabled until ${new Date(fullUser.banned_until).toLocaleString()}.`
                : 'Your account has been disabled.';
            setAuthBlocked(delMsg);
            AuthOverlay.showAccountDisabled(delMsg);
            return false;
          }
        }

        // Clear any previously set forced-disabled latch when user is allowed
        try {
          clearAuthBlocked();
        } catch {
          // ignore
        }
        return true; // OK to proceed
      } catch (err) {
        console.warn('[checkProfileStatus] error:', err);
        return true; // On error, let them through (fail open)
      }
    }

    async function init() {
      console.info('[TruckPackerApp] init start');
      if (!validateRuntime()) return;
      installDevHelpers({ app: window.TruckPackerApp, stateStore: StateStore, Utils, documentRef: document });
      seedIfEmpty();

      PreferencesManager.applyTheme(StateStore.get('preferences').theme);

      const debugEnabled = () => {
        try {
          return window && window.localStorage && window.localStorage.getItem('tp3dDebug') === '1';
        } catch {
          return false;
        }
      };

      let supabaseInitOk = false;
      const cfg = window.__TP3D_SUPABASE && typeof window.__TP3D_SUPABASE === 'object' ? window.__TP3D_SUPABASE : null;
      const url = cfg ? cfg.url : '';
      const anonKey = cfg ? cfg.anonKey : '';

      if (!url || !anonKey) {
        AuthOverlay.setPhase('cantconnect', {
          error: new Error('Supabase config missing'),
          onRetry: async () => {
            const retryBootstrap = async () => {
              const retryCfg =
                window.__TP3D_SUPABASE && typeof window.__TP3D_SUPABASE === 'object' ? window.__TP3D_SUPABASE : null;
              const retryUrl = retryCfg ? retryCfg.url : '';
              const retryKey = retryCfg ? retryCfg.anonKey : '';
              if (!retryUrl || !retryKey) throw new Error('Supabase config still missing');
              await SupabaseClient.init({ url: retryUrl, anonKey: retryKey });
            };
            await retryBootstrap();
            window.location.reload();
          },
        });
        AuthOverlay.show();
        return;
      }

      try {
        await SupabaseClient.init({ url, anonKey });
        supabaseInitOk = true;
      } catch (err) {
        if (debugEnabled()) console.info('[TruckPackerApp] Supabase init failed, attempting vendor-ready retry');

        let vendorReadyOk = false;
        if (typeof window.__tp3dVendorAllReady === 'function') {
          try {
            const vendorTimeoutMs = 6000;
            await Promise.race([
              window.__tp3dVendorAllReady(),
              new Promise((_, rej) => window.setTimeout(() => rej(new Error('Vendor ready timeout')), vendorTimeoutMs)),
            ]);
            vendorReadyOk = true;
            if (debugEnabled()) console.info('[TruckPackerApp] Vendor ready resolved');
          } catch (vendorErr) {
            if (debugEnabled()) {
              console.info(
                '[TruckPackerApp] Vendor ready timed out or failed:',
                vendorErr && vendorErr.message ? vendorErr.message : ''
              );
            }
          }
        }

        if (vendorReadyOk) {
          try {
            await SupabaseClient.init({ url, anonKey });
            supabaseInitOk = true;
            if (debugEnabled()) console.info('[TruckPackerApp] Supabase init retry success');
          } catch (retryErr) {
            if (debugEnabled()) {
              console.info(
                '[TruckPackerApp] Supabase init retry failed:',
                retryErr && retryErr.message ? retryErr.message : ''
              );
            }
            AuthOverlay.setPhase('cantconnect', { error: retryErr, onRetry: () => window.location.reload() });
            AuthOverlay.show();
            return;
          }
        } else {
          AuthOverlay.setPhase('cantconnect', { error: err, onRetry: () => window.location.reload() });
          AuthOverlay.show();
          return;
        }
      }

      const bootstrapAuthGate = async () => {
        AuthOverlay.setPhase('checking', { onRetry: bootstrapAuthGate });
        AuthOverlay.show();
        try {
          const timeoutMs = 12000;
          const session = await Promise.race([
            SupabaseClient.refreshSession(),
            new Promise((_, rej) => window.setTimeout(() => rej(new Error('Session check timed out')), timeoutMs)),
          ]);
          const user = session && session.user ? session.user : null;
          if (user) {
            // Check profile status before allowing access
            const canProceed = await checkProfileStatus();
            if (!canProceed) {
              return false; // Block app, auth overlay is already showing disabled state
            }
            AuthOverlay.hide();
            showReadyOnce();
            return true;
          }
          AuthOverlay.setPhase('form', { onRetry: bootstrapAuthGate });
          AuthOverlay.show();
          return false;
        } catch (err) {
          AuthOverlay.setPhase('cantconnect', { error: err, onRetry: bootstrapAuthGate });
          AuthOverlay.show();
          return false;
        }
      };

      if (!authListenerInstalled) {
        authListenerInstalled = true;
        SupabaseClient.onAuthStateChange(async (event, _session) => {
          const user = (() => {
            try {
              return SupabaseClient.getUser();
            } catch {
              return null;
            }
          })();
          try {
            emit('auth:changed', { event, userId: user && user.id ? String(user.id) : '' });
          } catch {
            // ignore
          }

          // 1) Close settings overlay on ANY auth change
          try {
            if (SettingsOverlay && typeof SettingsOverlay.close === 'function') SettingsOverlay.close();
          } catch (_) {
            // ignore
          }

          // 2) Optional: clear app caches / notify org change
          try {
            window.dispatchEvent(new CustomEvent('tp3d:org-changed', { detail: { orgId: null } }));
          } catch (_) {
            // ignore
          }

          if (user) {
            // Check profile status when user signs in
            const canProceed = await checkProfileStatus();
            if (!canProceed) {
              return; // Block, show disabled overlay
            }
            AuthOverlay.hide();
            if (event === 'SIGNED_IN') {
              UIComponents.showToast('Signed in', 'success', { title: 'Auth' });
            }
            if (SettingsOverlay && typeof SettingsOverlay.handleAuthChange === 'function') {
              SettingsOverlay.handleAuthChange(event);
            }
            if (AccountOverlay && typeof AccountOverlay.handleAuthChange === 'function') {
              AccountOverlay.handleAuthChange(event);
            }
            renderSidebarBrandMarks();
            showReadyOnce();
            return;
          }

          if (authBlockState) {
            AuthOverlay.showAccountDisabled(authBlockState.message);
          } else {
            AuthOverlay.setPhase('form', { onRetry: bootstrapAuthGate });
            AuthOverlay.show();
          }
          if (event === 'SIGNED_OUT') {
            UIComponents.showToast('Signed out', 'info', { title: 'Auth' });
          }
          if (SettingsOverlay && typeof SettingsOverlay.handleAuthChange === 'function') {
            SettingsOverlay.handleAuthChange(event);
          }
          if (AccountOverlay && typeof AccountOverlay.handleAuthChange === 'function') {
            AccountOverlay.handleAuthChange(event);
          }
          renderSidebarBrandMarks();
        });
      }

      AppShell.init();
      PacksUI.init();
      CasesUI.init();
      EditorUI.init();
      UpdatesUI.init();
      RoadmapUI.init();
      SettingsUI.init();
      AccountSwitcher.init();
      wireGlobalButtons();
      KeyboardManager.init();

      let prevScreen = StateStore.get('currentScreen');

      StateStore.subscribe(changes => {
        if (
          changes.preferences ||
          changes.caseLibrary ||
          changes.packLibrary ||
          changes.currentPackId ||
          changes._undo ||
          changes._redo ||
          changes._replace
        ) {
          Storage.saveSoon();
        }
        if (changes.preferences || changes._undo || changes._redo || changes._replace) {
          const prefs = StateStore.get('preferences');
          if (prefs && prefs.theme) PreferencesManager.applyTheme(prefs.theme);
          SceneManager.refreshTheme();
          SettingsUI.loadForm();
        }

        if (changes.currentScreen) {
          const nextScreen = StateStore.get('currentScreen');
          if (prevScreen === 'editor' && nextScreen !== 'editor') {
            const packId = StateStore.get('currentPackId');
            const pack = packId ? PackLibrary.getById(packId) : null;
            const lastEdited = pack && Number.isFinite(pack.lastEdited) ? pack.lastEdited : 0;
            const thumbAt = pack && Number.isFinite(pack.thumbnailUpdatedAt) ? pack.thumbnailUpdatedAt : 0;
            const totalCases = pack && Array.isArray(pack.cases) ? pack.cases.length : 0;
            if (pack && totalCases > 0 && lastEdited > thumbAt) {
              ExportService.capturePackPreview(packId, { source: 'auto', quiet: true });
            }
          }
          prevScreen = nextScreen;

          AppShell.renderShell();
          if (StateStore.get('currentScreen') === 'editor') EditorUI.render();
        }

        if (changes.caseLibrary || changes.packLibrary || changes._undo || changes._redo || changes._replace) {
          PacksUI.render();
          CasesUI.render();
          EditorUI.render();
          if (StateStore.get('currentScreen') === 'editor') AppShell.renderShell();
        }
        if (changes.currentPackId) {
          AppShell.renderShell();
          EditorUI.render();
        }
        if (changes.selectedInstanceIds) {
          EditorUI.render();
        }
      });

      renderAll();
      if (!supabaseInitOk) return;
      await bootstrapAuthGate();
    }

    return {
      init,
      EditorUI,
      ui: {
        showToast: UIComponents.showToast,
        showModal: UIComponents.showModal,
        confirm: UIComponents.confirm,
      },
      _debug: { Utils, StateStore, Storage, CaseLibrary, PackLibrary, Defaults },
    };
  })();

  function checkBrowserSupport() {
    const ua = navigator.userAgent || '';
    const safariMatch = ua.match(/Version\/(\d+\.\d+).*Safari/);
    if (safariMatch) {
      const version = parseFloat(safariMatch[1]);
      if (version < 13.1) {
        console.warn('[TruckPackerApp] Safari ' + version + ' detected. Safari 13.1+ required for ES2020 support.');
        return false;
      }
    }
    const firefoxMatch = ua.match(/Firefox\/(\d+)/);
    if (firefoxMatch) {
      const version = parseInt(firefoxMatch[1], 10);
      if (version < 88) {
        console.warn('[TruckPackerApp] Firefox ' + version + ' detected. Firefox 88+ recommended.');
        return false;
      }
    }
    return true;
  }

  const boot = () => {
    if (!checkBrowserSupport()) {
      const msg =
        'Your browser version may not be fully supported. Please upgrade to Chrome 90+, Firefox 88+, Safari 13.1+, or Edge 90+ for the best experience.';
      console.warn('[TruckPackerApp]', msg);
    }
    console.info('[TruckPackerApp] boot -> init');
    window.TruckPackerApp.init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
