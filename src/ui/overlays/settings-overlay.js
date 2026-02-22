/**
 * @file settings-overlay.js
 * @description Settings overlay UI for viewing and updating user preferences.
 * @module ui/overlays/settings-overlay
 * @created Unknown
 * @updated 01/28/2026
 * @author Truck Packer 3D Team
 *
 * CHANGES (01/28/2026 - Account Settings Complete):
 * - Added profile state management (profileData, isEditingProfile, isLoadingProfile, isSavingProfile)
 * - Implemented loadProfile() to fetch user profile from Supabase on Account tab open
 * - Implemented saveProfile() with optimistic UI and error handling
 * - Implemented handleAvatarUpload() for avatar image uploads with validation
 * - Implemented handleAvatarRemove() to delete avatars and update profile
 * - Completely rewrote Account tab rendering with three sections:
 *   1. Avatar upload/remove section with preview (shows avatar or initials)
 *   2. Profile info section with edit mode (display_name, first_name, last_name, bio)
 *   3. Danger zone with delete account flow
 * - Profile editing uses form with proper validation and Cancel/Save buttons
 * - Delete account now wrapped in <form> to fix password field console warning
 * - All inline styles removed; uses CSS classes from main.css
 * - Avatar preview shows uploaded image or falls back to initials
 * - Profile data persists across page reloads via Supabase
 * - Edit/view mode toggle maintains state properly
 * - No duplicate event listeners on re-render
 * - Resources tab sub-views unchanged (Updates, Roadmap, Export, Import, Help work as before)
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { getUserAvatarView } from '../../core/utils/index.js';
import * as ImportExport from '../../services/import-export.js';
import * as StateStore from '../../core/state-store.js';
import * as CoreStorage from '../../core/storage.js';
import {
  sendOrgInvite,
  updateOrgMemberRole as updateOrgMemberRoleFn,
  removeOrgMember as removeOrgMemberFn,
} from '../../data/services/billing.service.js';

export function createSettingsOverlay({
  documentRef = document,
  UIComponents,
  SessionManager: _SessionManager,
  PreferencesManager,
  Defaults: _Defaults,
  Utils,
  getSceneManager,
  getAccountSwitcher,
  SupabaseClient,
  onExportApp: _onExportApp,
  onImportApp: _onImportApp,
  onHelp: _onHelp,
  onUpdates: _onUpdates,
  onRoadmap: _onRoadmap,
}) {
  const doc = documentRef;

  let settingsOverlay = null;
  let settingsModal = null;
  let settingsLeftPane = null;
  let settingsRightPane = null;
  const _tabState = { activeTabId: 'preferences', didBind: false, lastActionId: 0 };
  let settingsInstanceId = 0;
  let settingsInstanceCounter = 0;
  let resourcesSubView = 'root'; // 'root' | 'updates' | 'roadmap' | 'export' | 'import' | 'help'
  let unmountAccountButton = null;
  let lastFocusedEl = null;
  let trapKeydownHandler = null;
  let warnedMissingModalRoot = false;
  let tabClickHandler = null;

  const SETTINGS_TABS = new Set(['account', 'preferences', 'resources', 'org-general', 'org-members', 'org-billing']);
  const TAB_STORAGE_KEY = 'tp3d:settings:activeTab';
  const SETTINGS_MODAL_ATTR = 'data-tp3d-settings-modal';
  const SETTINGS_INSTANCE_ATTR = 'data-tp3d-settings-instance';
  const ORG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function debugEnabled() {
    try {
      return window.localStorage && window.localStorage.getItem('tp3dDebug') === '1';
    } catch {
      return false;
    }
  }

  function debug(message, data) {
    if (!debugEnabled()) return;
    try {
      console.log('[SettingsOverlay]', message, data || {});
    } catch {
      // ignore
    }
  }

  function normalizeOrgId(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === 'personal') return '';
    return ORG_UUID_RE.test(raw) ? raw : '';
  }

  /**
   * @param {unknown} value
   * @returns {'month'|'year'}
   */
  function normalizeInterval(value) {
    return String(value || '').trim().toLowerCase() === 'year' ? 'year' : 'month';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nextSettingsInstanceId() {
    settingsInstanceCounter += 1;
    settingsInstanceId = settingsInstanceCounter;
    return settingsInstanceId;
  }

  function getSettingsModalRoots() {
    return Array.from(doc.querySelectorAll(`[${SETTINGS_MODAL_ATTR}="1"]`));
  }

  function debugSettingsModalSnapshot(source, root = settingsOverlay) {
    if (!debugEnabled()) return;
    const dialogs = doc.querySelectorAll('[role="dialog"], .modal');
    const settingsRoots = getSettingsModalRoots();
    const buttons = root ? root.querySelectorAll('[data-tab]') : [];
    const panels = root ? root.querySelectorAll('[data-tab-panel]') : [];
    const payload = {
      source,
      instanceId: settingsInstanceId,
      dialogCount: dialogs.length,
      settingsModalCount: settingsRoots.length,
      buttonCount: buttons.length,
      panelCount: panels.length,
    };
    debug('modalSnapshot', payload);
    if (settingsRoots.length > 1) {
      console.warn('[SettingsOverlay] Multiple settings modals detected', payload);
      console.trace();
    }
  }

  function debugTabSnapshot(source, root = settingsOverlay) {
    if (!debugEnabled() || !root) return;
    const activeBtn = root.querySelector('[data-tab].active');
    const activePanel = root.querySelector('[data-tab-panel]:not([hidden])');
    const domTabId = activeBtn ? activeBtn.getAttribute('data-tab') : null;
    const domPanelId = activePanel ? activePanel.getAttribute('data-tab-panel') : null;
    const payload = {
      source,
      instanceId: settingsInstanceId,
      stateTabId: _tabState.activeTabId,
      domTabId,
      domPanelId,
    };
    if (domTabId !== _tabState.activeTabId || domPanelId !== _tabState.activeTabId) {
      console.warn('[SettingsOverlay] Tab desync detected', payload);
      console.trace();
      return;
    }
    debug('tabSnapshot', payload);
  }

  function cleanupStaleSettingsModals(source) {
    const roots = getSettingsModalRoots();
    if (!roots.length) return;
    let removed = 0;
    roots.forEach(root => {
      if (settingsModal && root === settingsModal) return;
      const overlay = /** @type {HTMLElement & { _tp3dCleanup?: () => void }} */ (
        root.closest('.modal-overlay') || root
      );
      try {
        overlay && overlay._tp3dCleanup && overlay._tp3dCleanup();
      } catch {
        // ignore
      }
      try {
        if (overlay && overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
          removed += 1;
        }
      } catch {
        // ignore
      }
    });
    if (removed) debug('cleanupStaleSettingsModals', { source, removed });
  }

  function renderIfFresh(actionId, source) {
    if (typeof actionId === 'number' && actionId < _tabState.lastActionId) {
      debug('render skipped (stale)', { source, actionId, lastActionId: _tabState.lastActionId });
      return null;
    }
    return render();
  }

  // Profile editing state
  let profileData = null;
  let isEditingProfile = false;
  let isLoadingProfile = false;
  let isSavingProfile = false;
  let isUploadingAvatar = false;

  // Organization editing state
  let orgData = null;
  let membershipData = null; // Store membership separately
  let isEditingOrg = false;
  let isLoadingOrg = false;
  let isLoadingMembership = false; // Track membership loading
  let isSavingOrg = false;
  let orgMembersData = null;
  let isLoadingOrgMembers = false;
  let orgMembersError = null;
  let orgMembersRequestId = 0;
  let orgMembersInflightPromise = null;
  let orgMembersInflightOrgId = null;
  let orgMembersSearchQuery = '';
  let orgMembersRoleFilter = 'all';
  const orgMemberActions = new Set();
  let lastOrgMembersOrgId = null;

  // Organization invites state
  let orgInvitesData = null;
  let isLoadingOrgInvites = false;
  let orgInvitesError = null;
  let orgInvitesRequestId = 0;
  const orgInviteActions = new Set(); // invite IDs currently being acted on
  let lastKnownUserId = null;
  let lastBundleRefreshAt = 0;
  let billingUnsubscribe = null;
  let billingSubscriptionToken = 0;
  let modalOrgId = '';
  let selectedInterval = 'month';
  let orgChangedHandler = null;
  let lastOrgLogoKey = null;
  let lastOrgLogoUrl = null;
  let lastOrgLogoExpiresAt = 0;
  const BILLING_CONTEXT_RETRY_MS = 2500;
  let billingContextInflightPromise = null;
  let billingContextInflightOrgId = '';
  let billingContextLastAttemptAt = 0;
  let billingContextResolvedOrgId = '';

  // Account bundle loading state (single request for all account data)
  let isLoadingAccountBundle = false;
  let accountBundleRequestId = 0; // "Last request wins" guard

  function getOrgIdFromOrgContext() {
    try {
      if (typeof window !== 'undefined' && window.OrgContext && typeof window.OrgContext.getActiveOrgId === 'function') {
        return normalizeOrgId(window.OrgContext.getActiveOrgId());
      }
    } catch {
      // ignore
    }
    return '';
  }

  function getOrgIdFromBillingState() {
    try {
      const api = getBillingApiSafely();
      if (!api || typeof api.getBillingState !== 'function') return '';
      const state = api.getBillingState();
      return normalizeOrgId(state && state.orgId ? state.orgId : '');
    } catch {
      // ignore
    }
    return '';
  }

  function getOrgIdFromLocalStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return '';
      return normalizeOrgId(window.localStorage.getItem('tp3d:active-org-id') || '');
    } catch {
      // ignore
    }
    return '';
  }

  function resolveInitialModalOrgId() {
    return getOrgIdFromOrgContext() || getOrgIdFromBillingState() || getOrgIdFromLocalStorage() || '';
  }

  function ensureModalOrgId() {
    if (!modalOrgId) {
      modalOrgId = resolveInitialModalOrgId();
    }
    return modalOrgId;
  }

  function isKnownOrgRole(roleValue) {
    return roleValue === 'owner' || roleValue === 'admin' || roleValue === 'member';
  }

  function getRoleForOrg(orgId) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return '';
    const orgDataId = normalizeOrgId(orgData && orgData.id ? orgData.id : '');
    const membershipOrgId = normalizeOrgId(
      membershipData && membershipData.organization_id ? membershipData.organization_id : ''
    );
    return String(
      (orgDataId && orgDataId === normalizedOrgId && orgData && orgData.role) ||
      (membershipOrgId && membershipOrgId === normalizedOrgId && membershipData && membershipData.role) ||
      ''
    ).toLowerCase();
  }

  function hasOrgProfileForOrg(orgId) {
    const normalizedOrgId = normalizeOrgId(orgId);
    const orgDataId = normalizeOrgId(orgData && orgData.id ? orgData.id : '');
    return Boolean(
      normalizedOrgId &&
      orgDataId === normalizedOrgId &&
      orgData &&
      String(orgData.name || '').trim()
    );
  }

  function clearOrgScopedCaches(nextOrgId) {
    const next = normalizeOrgId(nextOrgId);
    if (lastOrgMembersOrgId && String(lastOrgMembersOrgId) !== String(next)) {
      orgMembersData = null;
      orgMembersError = null;
      isLoadingOrgMembers = false;
      orgMembersInflightPromise = null;
      orgMembersInflightOrgId = null;
      orgMembersSearchQuery = '';
      orgMembersRoleFilter = 'all';
      orgInvitesData = null;
      orgInvitesError = null;
    }
    if (!next || billingContextInflightOrgId !== next) {
      billingContextInflightPromise = null;
      billingContextInflightOrgId = '';
    }
    if (!next || billingContextResolvedOrgId !== next) {
      billingContextResolvedOrgId = '';
    }
  }

  function ensureBillingContextHydrated(orgId, { force = false, source = 'org-billing:hydrate-context' } = {}) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return Promise.resolve(null);

    const role = getRoleForOrg(normalizedOrgId);
    const roleKnown = isKnownOrgRole(role);
    const orgProfileLoaded = hasOrgProfileForOrg(normalizedOrgId);
    if (!force && orgProfileLoaded && roleKnown) {
      billingContextResolvedOrgId = normalizedOrgId;
      return Promise.resolve({ ok: true });
    }

    if (!force && billingContextInflightPromise && billingContextInflightOrgId === normalizedOrgId) {
      return billingContextInflightPromise;
    }

    const now = Date.now();
    if (
      !force &&
      billingContextLastAttemptAt &&
      (now - billingContextLastAttemptAt) < BILLING_CONTEXT_RETRY_MS &&
      !billingContextInflightPromise
    ) {
      return Promise.resolve(null);
    }

    billingContextLastAttemptAt = now;
    billingContextInflightOrgId = normalizedOrgId;
    const actionId = _tabState.lastActionId;
    const request = (async () => {
      try {
        await loadAccountBundle({ force: true });
      } catch {
        // ignore
      }

      if (!hasOrgProfileForOrg(normalizedOrgId)) {
        try {
          await loadOrganization(normalizedOrgId);
        } catch {
          // ignore
        }
      }

      if (!isKnownOrgRole(getRoleForOrg(normalizedOrgId)) && SupabaseClient && typeof SupabaseClient.getMyMembership === 'function') {
        try {
          isLoadingMembership = true;
          const membership = await SupabaseClient.getMyMembership();
          if (membership) membershipData = membership;
        } catch {
          // ignore
        } finally {
          isLoadingMembership = false;
        }
      }

      const hydrated = hasOrgProfileForOrg(normalizedOrgId) && isKnownOrgRole(getRoleForOrg(normalizedOrgId));
      billingContextResolvedOrgId = hydrated ? normalizedOrgId : '';
      return { ok: hydrated };
    })()
      .finally(() => {
        if (billingContextInflightOrgId === normalizedOrgId) {
          billingContextInflightPromise = null;
          billingContextInflightOrgId = '';
        }
        renderIfFresh(actionId, source);
      });

    billingContextInflightPromise = request;
    return request;
  }

  function refreshBillingForOrgChange(nextOrgId, source) {
    const normalizedOrgId = normalizeOrgId(nextOrgId);
    if (!normalizedOrgId) return;
    const api = getBillingApiSafely();
    if (!api) return;

    if (typeof api.clearBillingState === 'function') {
      try {
        api.clearBillingState();
      } catch {
        // ignore
      }
    }

    const billingWrap = doc.getElementById('tp3d-billing-wrap');
    if (billingWrap) {
      renderBillingInto(billingWrap);
    }

    if (typeof api.refreshBilling === 'function') {
      api.refreshBilling({ force: true, reason: source || 'settings:org-changed' })
        .catch(() => {})
        .finally(() => {
          const wrap = doc.getElementById('tp3d-billing-wrap');
          if (wrap) renderBillingInto(wrap);
        });
    }
  }

  function ensureOrgChangedListener() {
    if (orgChangedHandler || typeof window === 'undefined') return;
    orgChangedHandler = ev => {
      const nextOrgId = normalizeOrgId(ev && ev.detail ? ev.detail.orgId : '');
      if (!nextOrgId || nextOrgId === modalOrgId) return;
      modalOrgId = nextOrgId;
      clearOrgScopedCaches(nextOrgId);
      orgMembersRequestId += 1;
      isLoadingOrgMembers = true;
      orgMembersError = null;
      orgMembersData = null;
      lastOrgMembersOrgId = null;
      queueAccountBundleRefresh({ force: true, source: 'settings:org-changed' });
      refreshBillingForOrgChange(nextOrgId, 'settings:org-changed');
      if (_tabState.activeTabId === 'org-billing') {
        ensureBillingContextHydrated(nextOrgId, { force: true, source: 'org-billing:org-changed' }).catch(() => {});
      }
      if (settingsOverlay && settingsOverlay.isConnected) {
        render();
      }
      if (_tabState.activeTabId === 'org-members') {
        const actionId = _tabState.lastActionId;
        loadOrgMembers(nextOrgId)
          .then(() => renderIfFresh(actionId, 'org-members:org-changed'))
          .catch(() => {});
      }
    };
    window.addEventListener('tp3d:org-changed', orgChangedHandler);
  }

  function removeOrgChangedListener() {
    if (!orgChangedHandler || typeof window === 'undefined') return;
    try {
      window.removeEventListener('tp3d:org-changed', orgChangedHandler);
    } catch {
      // ignore
    }
    orgChangedHandler = null;
  }

  // Static content for Updates and Roadmap (embedded to avoid external dependencies)
  const updatesData = [
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

  const roadmapData = [
    {
      quarter: 'Q1 2026',
      items: [
        {
          title: 'Weight balance',
          status: 'Completed',
          badgeIcon: 'fa-solid fa-check',
          color: 'var(--success)',
          details: 'Add center-of-gravity and axle load estimates.',
        },
        {
          title: 'Rotation (MVP)',
          status: 'In Progress',
          badgeIcon: 'fa-solid fa-rotate',
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
          badgeIcon: 'fa-solid fa-clipboard-list',
          color: 'var(--info)',
          details: 'Presence + change tracking (no real-time yet).',
        },
        {
          title: '3D export',
          status: 'Planned',
          badgeIcon: 'fa-solid fa-clipboard-list',
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
          badgeIcon: 'fa-regular fa-lightbulb',
          color: 'var(--text-muted)',
          details: 'Preview a load-out in real space on mobile.',
        },
      ],
    },
  ];

  // NOTE: Phase 2+ will optionally pass a profile row (profiles table) into this helper.
  // Keep one shared source of truth for avatar displayName/initials.
  function getCurrentUserView(profile = null) {
    let user = null;
    try {
      user = SupabaseClient && SupabaseClient.getUser ? SupabaseClient.getUser() : null;
    } catch {
      user = null;
    }

    let sessionUser = null;
    try {
      const s = _SessionManager && typeof _SessionManager.get === 'function' ? _SessionManager.get() : null;
      sessionUser = s && s.user ? s.user : null;
    } catch {
      sessionUser = null;
    }

    return getUserAvatarView({ user, sessionUser, profile });
  }

  /**
   * Load all account data (profile, membership, org) in a single request.
   * Uses the epoch-validated single-flight bundle to prevent stale data.
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<Object|null>} The account bundle or null
   */
  async function loadAccountBundle({ force = false } = {}) {
    if (isLoadingAccountBundle) return null;

    // Capture request ID for "last request wins" guard
    const thisRequestId = ++accountBundleRequestId;
    isLoadingAccountBundle = true;

    try {
      const bundle = await SupabaseClient.getAccountBundleSingleFlight({ force });

      // Check if this is still the latest request
      if (thisRequestId !== accountBundleRequestId) {
        // A newer request was made, discard this result
        return null;
      }

      // Check if bundle was canceled due to auth change
      if (bundle && bundle.canceled) {
        isLoadingAccountBundle = false;
        return null;
      }

      // Populate all module-level caches from the bundle
      if (bundle) {
        profileData = bundle.profile || null;
        membershipData = bundle.membership || null;
        orgData = bundle.activeOrg || null;

        // If we have membership but no org data yet, and membership has org_id, fetch org
        if (membershipData && membershipData.organization_id && !orgData) {
          // The bundle doesn't include full org details, load it separately
          try {
            orgData = await SupabaseClient.getOrganization(membershipData.organization_id);
          } catch {
            orgData = null;
          }
        }
      }

      isLoadingAccountBundle = false;
      isLoadingProfile = false;
      isLoadingMembership = false;
      isLoadingOrg = false;

      return bundle;
    } catch (err) {
      console.error('[SettingsOverlay] Failed to load account bundle:', err);
      isLoadingAccountBundle = false;
      return null;
    }
  }

  function queueAccountBundleRefresh({ force = true, source = 'account-bundle-refresh' } = {}) {
    if (isLoadingAccountBundle) return;
    const now = Date.now();
    if (now - lastBundleRefreshAt < 500) return;
    lastBundleRefreshAt = now;
    const actionId = _tabState.lastActionId;
    loadAccountBundle({ force })
      .then(() => renderIfFresh(actionId, source))
      .catch(() => {});
  }

  async function loadProfile() {
    // Use the bundle loader instead of individual profile fetch
    // This ensures epoch validation and prevents stale data
    if (isLoadingProfile || isLoadingAccountBundle) return profileData;

    isLoadingProfile = true;
    try {
      await loadAccountBundle();
      isLoadingProfile = false;
      return profileData; // Return from module-level cache
    } catch (err) {
      isLoadingProfile = false;
      console.error('Failed to load profile:', err);
      return null;
    }
  }

  async function saveProfile(updates) {
    if (isSavingProfile) return null;
    isSavingProfile = true;
    const actionId = _tabState.lastActionId;
    try {
      const updated = await SupabaseClient.updateProfile(updates);
      profileData = updated;
      isSavingProfile = false;
      isEditingProfile = false;
      // Invalidate account cache so next fetch gets fresh data
      if (SupabaseClient.invalidateAccountCache) {
        SupabaseClient.invalidateAccountCache();
      }
      UIComponents.showToast('Profile saved', 'success');
      renderIfFresh(actionId, 'saveProfile');
      return updated;
    } catch (err) {
      isSavingProfile = false;
      UIComponents.showToast(`Failed to save: ${err && err.message ? err.message : err}`, 'error');
      throw err;
    }
  }

  async function loadOrganization(orgId = null) {
    if (isLoadingOrg || !orgId) return null;
    isLoadingOrg = true;
    try {
      const org = await SupabaseClient.getOrganization(orgId);
      orgData = org;
      isLoadingOrg = false;
      return org;
    } catch (err) {
      isLoadingOrg = false;
      console.error('Failed to load organization:', err);
      return null;
    }
  }

  async function saveOrganization(updates, orgId = null) {
    if (isSavingOrg || !orgId) return null;
    isSavingOrg = true;
    const actionId = _tabState.lastActionId;
    try {
      // Trim string values
      const trimmed = {};
      Object.entries(updates).forEach(([key, val]) => {
        trimmed[key] = typeof val === 'string' ? String(val).trim() : val;
      });

      const updated = await SupabaseClient.updateOrganization(orgId, trimmed);
      orgData = updated;
      isSavingOrg = false;
      isEditingOrg = false;
      // Invalidate account cache so next fetch gets fresh data
      if (SupabaseClient.invalidateAccountCache) {
        SupabaseClient.invalidateAccountCache();
      }
      UIComponents.showToast('Organization updated', 'success');
      renderIfFresh(actionId, 'saveOrganization');
      return updated;
    } catch (err) {
      isSavingOrg = false;
      UIComponents.showToast(`Failed to save: ${err && err.message ? err.message : err}`, 'error');
      throw err;
    }
  }

  async function loadOrgMembers(orgId) {
    try {
      if (typeof document !== 'undefined' && document.hidden === true) return null;
    } catch {
      // ignore
    }
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return null;
    if (isLoadingOrgMembers && orgMembersInflightPromise && orgMembersInflightOrgId === normalizedOrgId) {
      return orgMembersInflightPromise;
    }
    if (isLoadingOrgMembers && orgMembersInflightOrgId && orgMembersInflightOrgId !== normalizedOrgId) {
      orgMembersRequestId += 1;
    }
    const thisRequestId = ++orgMembersRequestId;
    isLoadingOrgMembers = true;
    orgMembersInflightOrgId = normalizedOrgId;
    orgMembersError = null;
    const requestPromise = (async () => {
      try {
        const members = await SupabaseClient.getOrganizationMembers(normalizedOrgId);
        if (thisRequestId !== orgMembersRequestId) return null;
        orgMembersData = Array.isArray(members) ? members : [];
        lastOrgMembersOrgId = String(normalizedOrgId);
        return orgMembersData;
      } catch (err) {
        if (thisRequestId !== orgMembersRequestId) return null;
        orgMembersError = err;
        orgMembersData = Array.isArray(orgMembersData) ? orgMembersData : [];
        return null;
      } finally {
        if (thisRequestId === orgMembersRequestId) {
          isLoadingOrgMembers = false;
        }
        if (orgMembersInflightOrgId === normalizedOrgId) {
          orgMembersInflightPromise = null;
          orgMembersInflightOrgId = null;
        }
      }
    })();
    orgMembersInflightPromise = requestPromise;
    return requestPromise;
  }

  function getMemberDisplayName(member) {
    const profile = member && member.profile ? member.profile : null;
    const displayName = profile && profile.display_name ? String(profile.display_name) : '';
    const fullNameFromProfile = profile && profile.full_name ? String(profile.full_name) : '';
    const firstName = profile && profile.first_name ? String(profile.first_name) : '';
    const lastName = profile && profile.last_name ? String(profile.last_name) : '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (displayName) return displayName;
    if (fullNameFromProfile) return fullNameFromProfile;
    if (fullName) return fullName;
    if (profile && profile.email) return String(profile.email);
    return member && member.user_id ? String(member.user_id) : 'Member';
  }

  function getMemberEmail(member) {
    const profile = member && member.profile ? member.profile : null;
    const profileEmail = profile && profile.email ? String(profile.email) : '';
    if (profileEmail) return profileEmail;
    if (member && member.email) return String(member.email);
    if (member && member.user_email) return String(member.user_email);
    return '';
  }

  function getRoleLabel(roleValue) {
    const role = String(roleValue || 'member').toLowerCase();
    if (role === 'owner') return 'Owner';
    if (role === 'admin') return 'Admin';
    if (role === 'member') return 'Member';
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Member';
  }

  function canManageMembers(roleValue) {
    const role = String(roleValue || '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  function formatMemberJoined(member) {
    const joined = member && member.joined_at ? String(member.joined_at) : '';
    if (!joined) return '—';
    try {
      const parsed = new Date(joined);
      if (Number.isNaN(parsed.getTime())) return '—';
      return parsed.toLocaleDateString();
    } catch {
      return '—';
    }
  }

  async function updateMemberRole(orgId, member, nextRole, currentUserId) {
    if (!member || !member.user_id || !orgId) return null;
    const userId = String(member.user_id);
    if (orgMemberActions.has(userId)) return null;

    orgMemberActions.add(userId);
    const actionId = _tabState.lastActionId;
    renderIfFresh(actionId, 'memberRole:update:begin');
    try {
      const result = await updateOrgMemberRoleFn(orgId, userId, nextRole);
      if (!result || !result.ok) {
        UIComponents.showToast(result && result.error ? result.error : 'Failed to update role.', 'error');
        renderIfFresh(actionId, 'memberRole:update:error');
        return null;
      }
      await loadOrgMembers(orgId);
      const updated = result.member || null;
      if (updated && currentUserId && currentUserId === userId && membershipData) {
        membershipData = { ...membershipData, role: updated.role || membershipData.role };
      }
      UIComponents.showToast('Role updated', 'success');
      renderIfFresh(actionId, 'memberRole:update');
      return updated;
    } catch (err) {
      UIComponents.showToast(`Failed to update role: ${err && err.message ? err.message : err}`, 'error');
      renderIfFresh(actionId, 'memberRole:update:error');
      return null;
    } finally {
      orgMemberActions.delete(userId);
      renderIfFresh(actionId, 'memberRole:update:done');
    }
  }

  async function removeMember(orgId, member) {
    if (!member || !member.user_id || !orgId) return false;
    const userId = String(member.user_id);
    if (orgMemberActions.has(userId)) return false;

    orgMemberActions.add(userId);
    const actionId = _tabState.lastActionId;
    renderIfFresh(actionId, 'memberRemove:begin');
    try {
      const result = await removeOrgMemberFn(orgId, userId);
      if (!result || !result.ok) {
        UIComponents.showToast(result && result.error ? result.error : 'Failed to remove member.', 'error');
        renderIfFresh(actionId, 'memberRemove:error');
        return false;
      }
      await loadOrgMembers(orgId);
      UIComponents.showToast('Member removed', 'success');
      renderIfFresh(actionId, 'memberRemove');
      return true;
    } catch (err) {
      UIComponents.showToast(`Failed to remove member: ${err && err.message ? err.message : err}`, 'error');
      renderIfFresh(actionId, 'memberRemove:error');
      return false;
    } finally {
      orgMemberActions.delete(userId);
      renderIfFresh(actionId, 'memberRemove:done');
    }
  }

  // ---- Organization invites ----

  async function loadOrgInvites(orgId) {
    if (isLoadingOrgInvites || !orgId) return null;
    const thisRequestId = ++orgInvitesRequestId;
    isLoadingOrgInvites = true;
    orgInvitesError = null;
    try {
      const invites = await SupabaseClient.getOrganizationInvites(orgId);
      if (thisRequestId !== orgInvitesRequestId) return null;
      orgInvitesData = Array.isArray(invites) ? invites : [];
      return orgInvitesData;
    } catch (err) {
      if (thisRequestId !== orgInvitesRequestId) return null;
      orgInvitesError = err;
      orgInvitesData = Array.isArray(orgInvitesData) ? orgInvitesData : [];
      return null;
    } finally {
      if (thisRequestId === orgInvitesRequestId) {
        isLoadingOrgInvites = false;
      }
    }
  }

  async function sendInvite(orgId, email, role) {
    if (!orgId || !email) return null;
    const actionId = _tabState.lastActionId;
    const normalizedRole = String(role || 'member').trim().toLowerCase();
    const roleAllowed = normalizedRole === 'member' || normalizedRole === 'admin';
    debug('orgInvite:send:request', { orgId, email, role: normalizedRole, roleAllowed });
    if (!roleAllowed) {
      UIComponents.showToast('Invites support Member or Admin roles only.', 'warning', { title: 'Invites' });
      return null;
    }
    try {
      const result = await sendOrgInvite(orgId, email, normalizedRole);
      if (!result || !result.ok) {
        UIComponents.showToast(result && result.error ? result.error : 'Invite failed', 'error', { title: 'Invites' });
        return null;
      }
      const inviteLink = result && result.invite_link ? String(result.invite_link) : '';
      const copyInviteAction = inviteLink
        ? [{
            label: 'Copy Link',
            onClick: () => {
              try {
                if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                  navigator.clipboard.writeText(inviteLink).then(() => {
                    UIComponents.showToast('Invite link copied', 'success', { title: 'Invites' });
                  }).catch(() => {
                    UIComponents.showToast('Could not copy invite link', 'warning', { title: 'Invites' });
                  });
                }
              } catch {
                UIComponents.showToast('Could not copy invite link', 'warning', { title: 'Invites' });
              }
            },
          }]
        : undefined;
      UIComponents.showToast('Invite sent to ' + email, 'success', { title: 'Invites', actions: copyInviteAction });
      // Refresh invites list
      await loadOrgInvites(orgId);
      renderIfFresh(actionId, 'invite:send');
      return result;
    } catch (err) {
      UIComponents.showToast('Invite failed: ' + (err && err.message ? err.message : err), 'error', { title: 'Invites' });
      return null;
    }
  }

  async function revokeInvite(orgId, invite) {
    if (!invite || !invite.id) return false;
    const inviteId = String(invite.id);
    if (orgInviteActions.has(inviteId)) return false;

    orgInviteActions.add(inviteId);
    const actionId = _tabState.lastActionId;
    renderIfFresh(actionId, 'invite:revoke:begin');
    try {
      await SupabaseClient.revokeOrganizationInvite(inviteId);
      await loadOrgInvites(orgId);
      UIComponents.showToast('Invite revoked', 'success', { title: 'Invites' });
      renderIfFresh(actionId, 'invite:revoke');
      return true;
    } catch (err) {
      UIComponents.showToast('Revoke failed: ' + (err && err.message ? err.message : err), 'error', { title: 'Invites' });
      renderIfFresh(actionId, 'invite:revoke:error');
      return false;
    } finally {
      orgInviteActions.delete(inviteId);
      renderIfFresh(actionId, 'invite:revoke:done');
    }
  }

  async function resendInvite(orgId, invite) {
    if (!invite || !invite.id) return null;
    const inviteId = String(invite.id);
    if (orgInviteActions.has(inviteId)) return null;

    orgInviteActions.add(inviteId);
    const actionId = _tabState.lastActionId;
    renderIfFresh(actionId, 'invite:resend:begin');
    try {
      const inviteRole = String(invite.role || 'member').trim().toLowerCase();
      if (inviteRole !== 'member' && inviteRole !== 'admin') {
        UIComponents.showToast('Only Member/Admin invites can be resent.', 'warning', { title: 'Invites' });
        return null;
      }
      const result = await sendOrgInvite(orgId, invite.email, inviteRole);
      if (!result || !result.ok) {
        UIComponents.showToast(result && result.error ? result.error : 'Resend failed', 'error', { title: 'Invites' });
        return null;
      }
      const inviteLink = result && result.invite_link ? String(result.invite_link) : '';
      const copyInviteAction = inviteLink
        ? [{
            label: 'Copy Link',
            onClick: () => {
              try {
                if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                  navigator.clipboard.writeText(inviteLink).then(() => {
                    UIComponents.showToast('Invite link copied', 'success', { title: 'Invites' });
                  }).catch(() => {
                    UIComponents.showToast('Could not copy invite link', 'warning', { title: 'Invites' });
                  });
                }
              } catch {
                UIComponents.showToast('Could not copy invite link', 'warning', { title: 'Invites' });
              }
            },
          }]
        : undefined;
      UIComponents.showToast('Invite resent to ' + invite.email, 'success', { title: 'Invites', actions: copyInviteAction });
      await loadOrgInvites(orgId);
      renderIfFresh(actionId, 'invite:resend');
      return result;
    } catch (err) {
      UIComponents.showToast('Resend failed: ' + (err && err.message ? err.message : err), 'error', { title: 'Invites' });
      renderIfFresh(actionId, 'invite:resend:error');
      return null;
    } finally {
      orgInviteActions.delete(inviteId);
      renderIfFresh(actionId, 'invite:resend:done');
    }
  }

  async function handleAvatarUpload(file) {
    const actionId = _tabState.lastActionId;
    isUploadingAvatar = true;
    renderIfFresh(actionId, 'avatarUpload:begin');
    try {
      const publicUrl = await SupabaseClient.uploadAvatar(file);
      // Add cache-busting timestamp to force browser to reload image
      const cacheBustedUrl = publicUrl + '?t=' + Date.now();
      await SupabaseClient.updateProfile({ avatar_url: publicUrl });
      UIComponents.showToast('Avatar uploaded', 'success');
      await loadProfile();
      renderIfFresh(actionId, 'avatarUpload');
      // Notify app to refresh sidebar avatar
      try {
        const event = new CustomEvent('tp3d:profile-updated', { detail: { avatar_url: cacheBustedUrl } });
        window.dispatchEvent(event);
      } catch {
        // ignore
      }
    } catch (err) {
      UIComponents.showToast(`Upload failed: ${err && err.message ? err.message : err}`, 'error');
    } finally {
      isUploadingAvatar = false;
      renderIfFresh(actionId, 'avatarUpload:done');
    }
  }

  async function handleAvatarRemove() {
    const actionId = _tabState.lastActionId;
    isUploadingAvatar = true;
    renderIfFresh(actionId, 'avatarRemove:begin');
    try {
      await SupabaseClient.deleteAvatar();
      await SupabaseClient.updateProfile({ avatar_url: null });
      UIComponents.showToast('Avatar removed', 'success');
      await loadProfile();
      renderIfFresh(actionId, 'avatarRemove');
      // Notify app to refresh sidebar avatar
      try {
        const event = new CustomEvent('tp3d:profile-updated', { detail: { avatar_url: null } });
        window.dispatchEvent(event);
      } catch {
        // ignore
      }
    } catch (err) {
      UIComponents.showToast(`Remove failed: ${err && err.message ? err.message : err}`, 'error');
    } finally {
      isUploadingAvatar = false;
      renderIfFresh(actionId, 'avatarRemove:done');
    }
  }

  function isOpen() {
    return Boolean(settingsOverlay);
  }

  function close() {
    if (!settingsOverlay) return;
    isUploadingAvatar = false;
    removeOrgChangedListener();
    if (billingUnsubscribe) {
      try {
        billingUnsubscribe();
      } catch {
        // ignore
      }
      billingUnsubscribe = null;
    }
    try {
      if (typeof unmountAccountButton === 'function') unmountAccountButton();
    } catch {
      // ignore
    }
    unmountAccountButton = null;

    try {
      settingsOverlay._tp3dCleanup && settingsOverlay._tp3dCleanup();
    } catch {
      // ignore
    }

    try {
      doc.body.classList.remove('modal-open');
    } catch {
      // ignore
    }

    try {
      if (trapKeydownHandler) doc.removeEventListener('keydown', trapKeydownHandler, true);
    } catch {
      // ignore
    }
    trapKeydownHandler = null;

    try {
      if (tabClickHandler && settingsOverlay) {
        if (settingsLeftPane) settingsLeftPane.removeEventListener('click', tabClickHandler);
      }
    } catch {
      // ignore
    }
    tabClickHandler = null;
    _tabState.didBind = false;

    try {
      if (settingsOverlay.parentElement) settingsOverlay.parentElement.removeChild(settingsOverlay);
    } catch {
      // ignore
    }

    debugSettingsModalSnapshot('close');
    settingsOverlay = null;
    settingsModal = null;
    settingsLeftPane = null;
    settingsRightPane = null;
    settingsInstanceId = 0;
    modalOrgId = '';
    selectedInterval = 'month';
    resourcesSubView = 'root'; // Reset sub-view on close

    try {
      if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
        lastFocusedEl.focus();
      }
    } catch {
      // ignore
    }
    lastFocusedEl = null;
  }

  function normalizeTab(tab) {
    const key = typeof tab === 'string' ? tab : '';
    return SETTINGS_TABS.has(key) ? key : 'preferences';
  }

  function readSavedTab() {
    try {
      if (window && window.sessionStorage) {
        const saved = window.sessionStorage.getItem(TAB_STORAGE_KEY);
        return saved && SETTINGS_TABS.has(saved) ? saved : null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  function persistTab(tab) {
    try {
      if (window && window.sessionStorage) {
        window.sessionStorage.setItem(TAB_STORAGE_KEY, tab);
      }
    } catch {
      // ignore
    }
  }

  function resolveInitialTab(tab) {
    const requested = typeof tab === 'string' && tab ? tab : null;
    const saved = readSavedTab();
    return normalizeTab(requested || saved || _tabState.activeTabId);
  }

  /**
   * Repro steps:
   * 1) open settings
   * 2) click tabs fast
   * 3) close + reopen
   * 4) apply + reset
   * 5) confirm button highlight always matches visible panel
   */
  function setActiveTab(tabId, meta = {}) {
    const nextTab = normalizeTab(tabId);
    const actionId = typeof meta.actionId === 'number' ? meta.actionId : null;
    if (actionId != null && actionId < _tabState.lastActionId) {
      debug('setActiveTab skipped (stale)', { tabId: nextTab, actionId, lastActionId: _tabState.lastActionId });
      return;
    }
    _tabState.activeTabId = nextTab;
    if (nextTab !== 'resources') {
      resourcesSubView = 'root';
    }
    persistTab(nextTab);
    const counts = render();
    debug('setActiveTab', {
      tabId: nextTab,
      source: meta.source,
      actionId,
      lastActionId: _tabState.lastActionId,
      instanceId: settingsInstanceId,
      buttonCount: counts ? counts.buttonCount : 0,
      panelCount: counts ? counts.panelCount : 0,
    });
    debugTabSnapshot('setActiveTab');

    // Billing tab should always refresh latest state
    if (nextTab === 'org-billing') {
      const lockedOrgId = ensureModalOrgId();
      if (lockedOrgId) {
        ensureBillingContextHydrated(lockedOrgId, { source: 'org-billing:tab-activate' }).catch(() => {});
      }
      const api = getBillingApiSafely();
      if (api && typeof api.refreshBilling === 'function') {
        api.refreshBilling({ force: true }).catch(() => {});
      }
    }
  }

  function setActive(tab) {
    setActiveTab(tab, { source: 'api' });
  }

  function bindTabsOnce() {
    if (_tabState.didBind || !settingsLeftPane) {
      debug('bindTabsOnce skipped', { didBind: _tabState.didBind, instanceId: settingsInstanceId });
      return;
    }
    tabClickHandler = ev => {
      const target = ev.target instanceof Element ? ev.target.closest('[data-tab]') : null;
      if (!target) return;
      const key = target.getAttribute('data-tab') || (target.dataset ? target.dataset.tab : null);
      if (!key) return;
      ev.preventDefault();
      _tabState.lastActionId += 1;
      setActiveTab(key, { source: 'click', actionId: _tabState.lastActionId });
    };
    settingsLeftPane.addEventListener('click', tabClickHandler);
    _tabState.didBind = true;
    const buttons = settingsOverlay ? settingsOverlay.querySelectorAll('[data-tab]') : [];
    const panels = settingsOverlay ? settingsOverlay.querySelectorAll('[data-tab-panel]') : [];
    debug('bindTabsOnce bound', {
      didBind: _tabState.didBind,
      instanceId: settingsInstanceId,
      buttonCount: buttons.length,
      panelCount: panels.length,
    });
    debugSettingsModalSnapshot('bindTabsOnce');
  }

  function applyTabStateToDOM() {
    const buttons = settingsOverlay ? settingsOverlay.querySelectorAll('[data-tab]') : [];
    const panels = settingsOverlay ? settingsOverlay.querySelectorAll('[data-tab-panel]') : [];
    buttons.forEach(btn => {
      const key = btn.getAttribute('data-tab');
      const isActive = key === _tabState.activeTabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    panels.forEach(panel => {
      const key = panel.getAttribute('data-tab-panel');
      panel.hidden = key !== _tabState.activeTabId;
    });
    return { buttonCount: buttons.length, panelCount: panels.length };
  }

  function setResourcesSubView(subView) {
    resourcesSubView = subView;
    render();
  }

  function savePrefsFromForm({ length, weight, theme, labelSize, hiddenOpacity }) {
    const prev = PreferencesManager.get();
    const next = Utils.deepClone(prev);
    next.units.length = length;
    next.units.weight = weight;
    next.theme = theme;
    next.labelFontSize = Utils.clamp(Number(labelSize) || 12, 8, 24);
    next.hiddenCaseOpacity = Utils.clamp(Number(hiddenOpacity) || 0.3, 0, 1);
    PreferencesManager.set(next);
    PreferencesManager.applyTheme(next.theme);
    UIComponents.showToast('Preferences saved', 'success');
  }

  // Render Updates content inside the modal
  function renderUpdatesContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'tp3d-settings-stack';

    updatesData.forEach(u => {
      const card = doc.createElement('div');
      card.className = 'card';

      const header = doc.createElement('div');
      header.className = 'row space-between';

      const left = doc.createElement('div');
      left.innerHTML = `<div class="tp3d-settings-card-title">Version ${u.version}</div><div class="muted tp3d-settings-meta">${new Date(u.date).toLocaleDateString()}</div>`;
      header.appendChild(left);
      card.appendChild(header);

      const sections = [
        { title: 'New Features', items: u.features || [] },
        { title: 'Bug Fixes', items: u.bugFixes || [] },
        { title: 'Breaking Changes', items: u.breakingChanges || [] },
      ].filter(s => s.items.length);

      sections.forEach(s => {
        const t = doc.createElement('div');
        t.className = 'tp3d-settings-section-heading';
        t.textContent = s.title;
        card.appendChild(t);

        const ul = doc.createElement('ul');
        ul.className = 'tp3d-settings-list';
        s.items.forEach(it => {
          const li = doc.createElement('li');
          li.textContent = it;
          ul.appendChild(li);
        });
        card.appendChild(ul);
      });

      wrap.appendChild(card);
    });

    container.appendChild(wrap);
  }

  // Render Roadmap content inside the modal
  function renderRoadmapContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'tp3d-settings-stack--loose';

    roadmapData.forEach(group => {
      const groupWrap = doc.createElement('div');
      groupWrap.className = 'tp3d-settings-stack--tight';

      const h = doc.createElement('div');
      h.className = 'tp3d-settings-card-title';
      h.textContent = group.quarter;
      groupWrap.appendChild(h);

      const grid = doc.createElement('div');
      grid.className = 'tp3d-settings-stack--tight';

      group.items.forEach(item => {
        const card = doc.createElement('div');
        card.className = 'card tp3d-settings-card--clickable';
        card.innerHTML = `
          <div class="row space-between">
            <div style="font-weight:var(--font-semibold)">${item.title}</div>
            <div class="badge tp3d-settings-roadmap-badge" style="background:${item.color}"><i class="${item.badgeIcon}"></i> ${item.status}</div>
          </div>
          <div class="muted tp3d-settings-meta tp3d-settings-mt-sm">${item.details}</div>
        `;
        card.addEventListener('click', () => {
          UIComponents.showModal({
            title: item.title,
            content: `<div class="muted tp3d-settings-meta">${item.details}</div>`,
            actions: [{ label: 'Close', variant: 'primary' }],
          });
        });
        grid.appendChild(card);
      });

      groupWrap.appendChild(grid);
      wrap.appendChild(groupWrap);
    });

    container.appendChild(wrap);
  }

  function renderExportContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'tp3d-resources-view';

    const blurb = doc.createElement('div');
    blurb.className = 'muted tp3d-resources-text';
    blurb.textContent =
      'App Export downloads a full JSON backup of packs, cases, and settings. This file can be imported back to restore everything.';

    const filename = `truck-packer-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const meta = doc.createElement('div');
    meta.className = 'card tp3d-resources-card';

    const metaTitle = doc.createElement('div');
    metaTitle.className = 'tp3d-resources-card-title';
    metaTitle.textContent = 'Export details';

    const metaValue = doc.createElement('div');
    metaValue.className = 'muted tp3d-resources-card-sub';
    metaValue.textContent = `File: ${filename}`;

    meta.appendChild(metaTitle);
    meta.appendChild(metaValue);

    const actions = doc.createElement('div');
    actions.className = 'tp3d-resources-actions';
    const exportBtn = doc.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn btn-primary';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => {
      try {
        const json = ImportExport.buildAppExportJSON();
        Utils.downloadText(filename, json);
        UIComponents.showToast('App JSON exported', 'success');
      } catch (err) {
        UIComponents.showToast('Export failed: ' + (err && err.message), 'error');
      }
    });
    actions.appendChild(exportBtn);

    wrap.appendChild(blurb);
    wrap.appendChild(meta);
    wrap.appendChild(actions);
    container.appendChild(wrap);
  }

  function applyCaseDefaultColor(caseObj) {
    const next = { ...(caseObj || {}) };
    const existing = String(next.color || '').trim();
    if (existing) return next;
    const key =
      String(next.category || 'default')
        .trim()
        .toLowerCase() || 'default';
    const cats = (_Defaults && _Defaults.categories) || [];
    const found = cats.find(c => c.key === key) || cats.find(c => c.key === 'default');
    next.color = (found && found.color) || '#9ca3af';
    return next;
  }

  async function handleImportAppFile(file, resultsEl) {
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

    let imported = null;
    try {
      imported = ImportExport.parseAppImportJSON(text);
    } catch (err) {
      UIComponents.showToast('Invalid App JSON: ' + (err && err.message), 'error');
      UIComponents.showToast('If you are importing only packs, use Import Pack.', 'info');
      return;
    }

    if (
      !imported ||
      !Array.isArray(imported.packLibrary) ||
      !Array.isArray(imported.caseLibrary) ||
      !imported.preferences
    ) {
      UIComponents.showToast('Invalid App JSON: missing required keys', 'error');
      return;
    }

    const ok = await UIComponents.confirm({
      title: 'Import App JSON?',
      message: 'This will replace your current data with the imported backup. This cannot be undone.',
      danger: true,
      okLabel: 'Replace & Import',
    });
    if (!ok) return;

    try {
      const prev = StateStore.get();
      const importedCases = (imported.caseLibrary || []).map(applyCaseDefaultColor);
      const nextState = {
        ...prev,
        caseLibrary: importedCases,
        packLibrary: imported.packLibrary,
        preferences: imported.preferences,
        currentPackId: null,
        currentScreen: 'packs',
        selectedInstanceIds: [],
      };
      StateStore.replace(nextState, { skipHistory: false });
      CoreStorage.saveNow();
      if (PreferencesManager && typeof PreferencesManager.applyTheme === 'function') {
        PreferencesManager.applyTheme(nextState.preferences.theme);
      }

      const summary = doc.createElement('div');
      summary.className = 'card';
      summary.innerHTML = `
        <div class="tp3d-import-summary-title">Import Result</div>
        <div class="muted tp3d-import-summary-meta">File: ${
          Utils && Utils.escapeHtml ? Utils.escapeHtml(file.name) : file.name
        }</div>
        <div class="tp3d-import-summary-spacer"></div>
        <div class="tp3d-import-badges">
          <div class="badge tp3d-import-badge-success">Packs: ${(imported.packLibrary || []).length}</div>
          <div class="badge tp3d-import-badge-info">Cases: ${(imported.caseLibrary || []).length}</div>
        </div>
      `;
      resultsEl.appendChild(summary);

      UIComponents.showToast('App data imported', 'success');
    } catch (err) {
      UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
    }
  }

  function renderImportContent(container) {
    const content = doc.createElement('div');
    content.className = 'tp3d-import-content';

    const drop = doc.createElement('div');
    drop.className = 'card tp3d-import-drop';
    drop.innerHTML = `
      <div class="tp3d-import-drop-title">Drag & Drop Backup File Here</div>
      <div class="muted tp3d-import-drop-sub">Supported: .json</div>
      <div class="tp3d-import-drop-spacer"></div>
    `;
    const browseBtn = doc.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.type = 'button';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse Backup files';
    drop.appendChild(browseBtn);

    const hint = doc.createElement('div');
    hint.className = 'muted tp3d-import-hint';
    hint.innerHTML = `
      <div class="tp3d-import-warning">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div>
          <span class="tp3d-import-warning-label">Warning:</span>
          <span class="tp3d-import-warning-text"> This will replace your current data.</span>
        </div>
      </div>
    `;

    const results = doc.createElement('div');
    results.classList.add('tp3d-import-results');

    content.appendChild(drop);
    content.appendChild(hint);
    content.appendChild(results);
    container.appendChild(content);

    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    browseBtn.addEventListener('click', () => fileInput.click());

    drop.addEventListener('dragover', ev => {
      ev.preventDefault();
      drop.classList.add('is-dragover');
    });
    drop.addEventListener('dragleave', () => {
      drop.classList.remove('is-dragover');
    });
    drop.addEventListener('drop', ev => {
      ev.preventDefault();
      drop.classList.remove('is-dragover');
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) handleImportAppFile(file, results);
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) handleImportAppFile(file, results);
    });
  }

  function renderHelpContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'tp3d-resources-view';

    const block = doc.createElement('div');
    block.className = 'card tp3d-resources-card';

    const text = doc.createElement('div');
    text.className = 'tp3d-resources-help';

    const p1 = doc.createElement('div');
    p1.className = 'tp3d-resources-help-line';
    p1.innerHTML =
      '<strong>App Export/Import:</strong> Use Export to download a full JSON backup. Use Import to restore from that backup.';
    const p2 = doc.createElement('div');
    p2.className = 'tp3d-resources-help-line';
    p2.innerHTML =
      '<strong>Pack Export/Import:</strong> In Packs, open the pack menu and choose Export Pack to download a single pack JSON. Use Import Pack on the Packs screen to add a shared pack JSON.';
    const p3 = doc.createElement('div');
    p3.className = 'tp3d-resources-help-line';
    p3.innerHTML =
      '<strong>Cases Template:</strong> On the Cases screen, click Template to download the CSV headers for cases.';
    const p4 = doc.createElement('div');
    p4.className = 'tp3d-resources-help-line';
    p4.innerHTML =
      '<strong>Cases Import:</strong> Click Import on the Cases screen to upload CSV or XLSX. Valid rows are added; duplicates and invalid rows are skipped.';
    const p5 = doc.createElement('div');
    p5.className = 'tp3d-resources-help-line muted';
    p5.textContent = 'Tip: Export the app before importing to keep a backup.';

    text.appendChild(p1);
    text.appendChild(p2);
    text.appendChild(p3);
    text.appendChild(p4);
    text.appendChild(p5);
    block.appendChild(text);
    wrap.appendChild(block);
    container.appendChild(wrap);
  }

  function getBillingApiSafely() {
    try {
      return typeof window !== 'undefined' ? window.__TP3D_BILLING || null : null;
    } catch {
      return null;
    }
  }

  function renderBillingInto(targetEl) {
    if (!targetEl) return;
    const api = getBillingApiSafely();
    const fallbackState = {
      ok: false,
      pending: true,
      loading: false,
      plan: null,
      status: null,
      isActive: false,
      isPro: false,
      interval: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      portalAvailable: false,
      error: null,
      data: null,
      lastFetchedAt: 0,
    };

    const state = (api && typeof api.getBillingState === 'function' ? api.getBillingState() : null) || fallbackState;
    const lockedOrgId = ensureModalOrgId();
    const currentOrgId = getOrgIdFromOrgContext();
    const billingOrgId = normalizeOrgId(state.orgId || '');
    const loading = Boolean(state.loading);
    const pending = Boolean(state.pending);
    const staleOrgState = Boolean(lockedOrgId && billingOrgId && billingOrgId !== lockedOrgId);
    const billingMatchesLockedOrg = Boolean(lockedOrgId && billingOrgId && billingOrgId === lockedOrgId);
    const hasRenderableBillingState = Boolean(billingMatchesLockedOrg && state.lastFetchedAt);
    const showSkeleton = Boolean(
      !lockedOrgId ||
      staleOrgState ||
      ((loading || pending) && !hasRenderableBillingState)
    );
    const status = state.status ? String(state.status) : '';
    const isTrial = status === 'trialing';
    const isProOrTrial = state.isPro;
    const interval = state.interval ? String(state.interval) : '';
    const intervalLabel = interval === 'month' ? 'Monthly' : interval === 'year' ? 'Yearly' : null;
    const cancelAtPeriodEnd = Boolean(state.cancelAtPeriodEnd);
    const cancelAt = state.cancelAt ? String(state.cancelAt) : null;
    const hasCancelAt = Boolean(cancelAt && cancelAt.trim());
    const isCancelScheduled = Boolean(
      (status === 'active' || status === 'trialing') &&
      (cancelAtPeriodEnd || hasCancelAt)
    );
    const cancelEndValue = cancelAt || state.currentPeriodEnd || null;
    const portalAvailable = Boolean(state.portalAvailable);
    const trialWelcomeShown = (() => {
      try {
        const orgId = lockedOrgId || billingOrgId || '';
        if (!orgId || typeof window === 'undefined' || !window.localStorage) return false;
        return window.localStorage.getItem('tp3d_trial_modal_shown_' + orgId) === 'true';
      } catch (_) {
        return false;
      }
    })();

    // Compute trial days left
    let trialDaysLeft = null;
    if (isTrial && state.trialEndsAt) {
      try {
        const endMs = new Date(state.trialEndsAt).getTime();
        if (Number.isFinite(endMs)) {
          trialDaysLeft = Math.max(0, Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000)));
        }
      } catch (_) { /* ignore */ }
    }

    const isDebug = (() => {
      try {
        return typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('tp3dDebug') === '1';
      } catch {
        return false;
      }
    })();
    const billingRole = getRoleForOrg(lockedOrgId || billingOrgId);
    const roleKnown = isKnownOrgRole(billingRole);
    const canManageBilling = billingRole === 'owner' || billingRole === 'admin';
    const orgProfileLoaded = hasOrgProfileForOrg(lockedOrgId);
    const billingContextInflightForOrg = Boolean(
      lockedOrgId &&
      billingContextInflightPromise &&
      billingContextInflightOrgId === lockedOrgId
    );
    const billingContextLoading = billingContextInflightForOrg;
    if (lockedOrgId && (!orgProfileLoaded || !roleKnown)) {
      ensureBillingContextHydrated(lockedOrgId, { source: 'org-billing:render' }).catch(() => {});
    }
    const orgContextStalled = Boolean(
      lockedOrgId &&
      !orgProfileLoaded &&
      !billingContextLoading &&
      billingContextLastAttemptAt &&
      (Date.now() - billingContextLastAttemptAt) > BILLING_CONTEXT_RETRY_MS
    );

    // Build DOM
    targetEl.textContent = '';

    // --- Organization section ---
    const orgMatchesLocked = orgProfileLoaded;
    const orgName = orgMatchesLocked && orgData && orgData.name
      ? String(orgData.name)
      : (lockedOrgId ? 'Organization' : 'Personal Workspace');

    const orgSection = doc.createElement('div');
    orgSection.className = 'tp3d-settings-billing';

    const orgHeading = doc.createElement('div');
    orgHeading.className = 'tp3d-settings-billing-title';
    orgHeading.textContent = 'Organization';
    orgSection.appendChild(orgHeading);

    const orgRow = doc.createElement('div');
    orgRow.className = 'tp3d-settings-row';

    const orgLabel = doc.createElement('div');
    orgLabel.className = 'tp3d-settings-row-label';
    orgLabel.textContent = 'Organization';
    orgRow.appendChild(orgLabel);

    const orgValue = doc.createElement('div');
    orgValue.className = 'row';

    if (lockedOrgId && !orgMatchesLocked && billingContextLoading) {
      orgValue.classList.add('tp3d-billing-org-skeleton', 'tp3d-skel');
      const avatarSkel = doc.createElement('span');
      avatarSkel.className = 'tp3d-skel-line tp3d-billing-org-skeleton-avatar';
      const nameSkel = doc.createElement('span');
      nameSkel.className = 'tp3d-skel-line tp3d-billing-org-skeleton-name';
      orgValue.appendChild(avatarSkel);
      orgValue.appendChild(nameSkel);
    } else {
      const orgDataId = normalizeOrgId(orgData && orgData.id ? orgData.id : '');

      // Org logo: prefer logo_path (Supabase Storage signed URL), fallback avatar_url, else initials
      const orgLogoPath = orgMatchesLocked && orgData && orgData.logo_path ? String(orgData.logo_path) : null;
      const orgAvatarUrl = orgMatchesLocked && orgData && orgData.avatar_url ? String(orgData.avatar_url) : null;
      const orgAvatarSafe = orgAvatarUrl && /^https?:\/\//i.test(orgAvatarUrl) ? orgAvatarUrl : null;

      // Create initials avatar as default (may be replaced by img)
      const orgAvatarEl = doc.createElement('span');
      orgAvatarEl.className = 'tp3d-settings-account-avatar tp3d-settings-avatar--sm';
      orgAvatarEl.style.background = 'var(--accent-primary)';
      orgAvatarEl.textContent = orgName.charAt(0).toUpperCase();
      const orgId = orgMatchesLocked ? String(orgDataId) : '';
      const logoKey = orgId + '|' + (orgLogoPath || orgAvatarSafe || '');
      const cachedLogoSrc = logoKey && lastOrgLogoKey === logoKey && lastOrgLogoExpiresAt > Date.now()
        ? lastOrgLogoUrl
        : null;
      // Hide initials while async logo loads to prevent flicker
      if (!cachedLogoSrc && (orgLogoPath || orgAvatarSafe)) {
        orgAvatarEl.style.visibility = 'hidden';
      }
      /** @type {HTMLSpanElement|HTMLImageElement} */
      let avatarNode = orgAvatarEl;
      if (cachedLogoSrc) {
        const cachedImg = doc.createElement('img');
        cachedImg.src = cachedLogoSrc;
        cachedImg.alt = orgName;
        cachedImg.width = 28;
        cachedImg.height = 28;
        cachedImg.className = 'tp3d-settings-avatar-img';
        cachedImg.onerror = () => {
          if (cachedImg.parentNode) cachedImg.parentNode.replaceChild(orgAvatarEl, cachedImg);
          avatarNode = orgAvatarEl;
        };
        avatarNode = cachedImg;
      }
      orgValue.appendChild(avatarNode);

      // Async: try to load logo image (signed URL or avatar_url)
      if (orgLogoPath || orgAvatarSafe) {
        const loadLogo = async () => {
          let logoSrc = null;
          if (orgLogoPath && SupabaseClient && typeof SupabaseClient.getOrgLogoUrl === 'function') {
            logoSrc = await SupabaseClient.getOrgLogoUrl(orgLogoPath, orgData.updated_at || '');
          }
          if (!logoSrc && orgAvatarSafe) {
            logoSrc = orgAvatarSafe;
          }
          if (!logoSrc) return;
          if (logoKey) {
            lastOrgLogoKey = logoKey;
            lastOrgLogoUrl = logoSrc;
            lastOrgLogoExpiresAt = Date.now() + 50000;
          }

          if (
            avatarNode &&
            avatarNode.tagName === 'IMG' &&
            /** @type {HTMLImageElement} */ (avatarNode).src === logoSrc
          ) return;

          const orgImg = doc.createElement('img');
          orgImg.src = logoSrc;
          orgImg.alt = orgName;
          orgImg.width = 28;
          orgImg.height = 28;
          orgImg.className = 'tp3d-settings-avatar-img';
          orgImg.onload = function () {
            if (avatarNode && avatarNode.parentNode) {
              avatarNode.parentNode.replaceChild(orgImg, avatarNode);
              avatarNode = orgImg;
            }
          };
          orgImg.onerror = function () {
            orgAvatarEl.style.visibility = '';
            if (orgImg.parentNode) orgImg.parentNode.replaceChild(orgAvatarEl, orgImg);
            avatarNode = orgAvatarEl;
          };
        };
        loadLogo().catch(() => { orgAvatarEl.style.visibility = ''; });
      }
      const orgNameSpan = doc.createElement('span');
      orgNameSpan.textContent = orgName;
      orgValue.appendChild(orgNameSpan);
    }
    orgRow.appendChild(orgValue);

    orgSection.appendChild(orgRow);

    if (orgContextStalled) {
      const orgHelper = doc.createElement('div');
      orgHelper.className = 'muted tp3d-members-inline-helper';
      orgHelper.textContent = 'Organization details are not available yet. Try Refresh.';
      orgSection.appendChild(orgHelper);
    }

    const orgDivider = doc.createElement('div');
    orgDivider.className = 'tp3d-settings-org-divider';
    orgSection.appendChild(orgDivider);

    targetEl.appendChild(orgSection);

    // --- Subscription section ---
    const subSection = doc.createElement('div');
    subSection.className = 'tp3d-settings-billing';

    const subHeading = doc.createElement('div');
    subHeading.className = 'tp3d-settings-billing-title';
    subHeading.textContent = 'Subscription';
    subSection.appendChild(subHeading);

    // Current plan card
    const planCard = doc.createElement('div');
    planCard.className = 'card';

    if (showSkeleton) {
      const skeletonGroup = doc.createElement('div');
      skeletonGroup.className = 'tp3d-skeleton-group tp3d-skel';
      skeletonGroup.innerHTML = `
        <div class="tp3d-skel-line tp3d-skeleton-title"></div>
        <div class="tp3d-skel-line tp3d-skeleton-short"></div>
        <div class="tp3d-skel-line tp3d-skeleton-short"></div>
      `;
      planCard.appendChild(skeletonGroup);
    } else if (state.error && !state.ok) {
      const errMsg = doc.createElement('div');
      errMsg.className = 'muted';
      errMsg.textContent = 'Billing unavailable. The app continues to work normally.';
      planCard.appendChild(errMsg);

      const retryBtn = doc.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn tp3d-settings-mt-sm';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        if (api && typeof api.refreshBilling === 'function') {
          api.refreshBilling({ force: true }).catch(() => {});
        }
      });
      planCard.appendChild(retryBtn);
    } else {
      // Plan header row
      const planHeader = doc.createElement('div');
      planHeader.className = 'row';

      const planName = doc.createElement('div');
      planName.className = 'tp3d-settings-billing-title';
      if (isTrial) {
        planName.textContent = 'Pro (Trial)';
      } else if (isProOrTrial) {
        planName.textContent = intervalLabel ? `Pro (${intervalLabel})` : 'Pro';
      } else {
        planName.textContent = 'Free';
      }
      planHeader.appendChild(planName);

      const planBadge = doc.createElement('span');
      planBadge.className = 'badge' + (isTrial ? ' badge--trial' : isProOrTrial ? ' badge--active' : ' badge--free');
      planBadge.textContent = 'Current Plan';
      planHeader.appendChild(planBadge);
      let cancelEndText = '';
      if (isCancelScheduled) {
        const cancelBadge = doc.createElement('span');
        cancelBadge.className = 'badge badge--pending';
        cancelBadge.textContent = 'Cancels';
        planHeader.appendChild(cancelBadge);
        if (cancelEndValue) {
          const endDate = new Date(cancelEndValue);
          cancelEndText = 'Ends on ' + (isNaN(endDate.getTime()) ? cancelEndValue : endDate.toLocaleDateString());
          const cancelInline = doc.createElement('span');
          cancelInline.className = 'tp3d-billing-cancel-inline tp3d-org-feedback tp3d-org-feedback--warning';
          cancelInline.textContent = cancelEndText;
          planHeader.appendChild(cancelInline);
        }
      }

      if (trialDaysLeft !== null) {
        const daysEl = doc.createElement('span');
        daysEl.className = 'muted';
        daysEl.textContent = trialDaysLeft + ' day' + (trialDaysLeft !== 1 ? 's' : '') + ' left';
        planHeader.appendChild(daysEl);
      }

      planCard.appendChild(planHeader);

      // Status / cancellation info
      const statusLine = doc.createElement('div');
      statusLine.className = 'muted tp3d-settings-mt-xs';

      if (isTrial && state.trialEndsAt) {
        const endDate = new Date(state.trialEndsAt);
        const endText = isNaN(endDate.getTime()) ? state.trialEndsAt : endDate.toLocaleDateString();
        statusLine.textContent = trialWelcomeShown
          ? 'You are on Pro trial until ' + endText
          : 'Trial ends on ' + endText;
      } else if (!isProOrTrial && status) {
        statusLine.textContent = 'Status: ' + status.replace(/_/g, ' ');
      }

      if (statusLine.textContent && statusLine.textContent !== cancelEndText) {
        planCard.appendChild(statusLine);
      }
    }

    subSection.appendChild(planCard);

    // Upgrade CTA card (only if not pro/active)
    if (!showSkeleton && !loading && !pending && !isProOrTrial && roleKnown && canManageBilling) {
      const ctaCard = doc.createElement('div');
      ctaCard.className = 'card';

      const ctaInfo = doc.createElement('div');
      const ctaTitle = doc.createElement('div');
      ctaTitle.className = 'tp3d-settings-billing-title';
      ctaTitle.textContent = '\u26A1 Truck Packer Pro';
      ctaInfo.appendChild(ctaTitle);
      const ctaDesc = doc.createElement('div');
      ctaDesc.className = 'muted';
      ctaDesc.textContent = status === 'trial_expired'
        ? 'Your trial has ended. Subscribe to continue using Pro features.'
        : 'Subscribe to unlock Pro features for this workspace.';
      ctaInfo.appendChild(ctaDesc);
      ctaCard.appendChild(ctaInfo);

      const subBtn = doc.createElement('button');
      subBtn.type = 'button';
      subBtn.className = 'btn btn-primary tp3d-settings-mt-sm';
      subBtn.textContent = 'Subscribe';
      subBtn.addEventListener('click', () => {
        if (!api || typeof api.startCheckout !== 'function') {
          if (UIComponents) UIComponents.showToast('Checkout coming soon. Contact sales.', 'info', { title: 'Billing' });
          return;
        }
        const pickerPromise =
          typeof api.pickCheckoutInterval === 'function'
            ? api.pickCheckoutInterval({
              initialInterval: selectedInterval,
              title: 'Choose Plan',
              continueLabel: 'Continue',
            })
            : Promise.resolve({ interval: selectedInterval });

        Promise.resolve(pickerPromise).then(selection => {
          if (!selection || !selection.interval) return;
          selectedInterval = normalizeInterval(selection.interval);

          if (typeof api.getCheckoutPlanOptions === 'function') {
            const options = api.getCheckoutPlanOptions();
            const selectedOption = options && options[selectedInterval] ? options[selectedInterval] : null;
            if (selectedOption && !selectedOption.available) {
              if (UIComponents) {
                UIComponents.showToast(`Price not configured for interval: ${selectedInterval}`, 'warning', { title: 'Billing' });
              }
              return;
            }
          }

          subBtn.disabled = true;
          subBtn.textContent = 'Redirecting\u2026';
          api.startCheckout({ interval: selectedInterval }).then((r) => {
            if (!r.ok) {
              if (UIComponents) UIComponents.showToast(r.error || 'Checkout failed', 'error', { title: 'Billing' });
              subBtn.disabled = false;
              subBtn.textContent = 'Subscribe';
            }
          }).catch(() => {
            subBtn.disabled = false;
            subBtn.textContent = 'Subscribe';
          });
        }).catch(() => {
          if (UIComponents) UIComponents.showToast('Checkout failed', 'error', { title: 'Billing' });
        });
      });
      ctaCard.appendChild(subBtn);

      subSection.appendChild(ctaCard);
    } else if (!showSkeleton && !loading && !pending && !isProOrTrial && roleKnown && !canManageBilling) {
      const note = doc.createElement('div');
      note.className = 'muted tp3d-settings-mt-sm';
      note.textContent = 'Only owners and admins can manage billing for this organization.';
      subSection.appendChild(note);
    } else if (!showSkeleton && !loading && !pending && !isProOrTrial && !roleKnown) {
      const note = doc.createElement('div');
      note.className = 'muted tp3d-settings-mt-sm';
      note.textContent = 'Loading permissions…';
      subSection.appendChild(note);
    }

    const roleLoading = Boolean(lockedOrgId && !roleKnown && billingContextInflightForOrg);
    let manageDisabledReason = '';
    if (!lockedOrgId) {
      manageDisabledReason = 'Select an organization to manage billing.';
    } else if (loading || pending || staleOrgState) {
      manageDisabledReason = 'Loading billing info…';
    } else if (roleLoading) {
      manageDisabledReason = 'Loading permissions…';
    } else if (roleKnown && !canManageBilling) {
      manageDisabledReason = 'Only owners/admins can manage billing.';
    } else if (!state.ok || !portalAvailable || !isProOrTrial || !api || typeof api.openPortal !== 'function') {
      manageDisabledReason = "Billing portal isn't available yet. Try Refresh.";
    }
    const manageEnabled = !manageDisabledReason;

    if (debugEnabled()) {
      console.debug(
        `[BillingUI] activeOrgId=${currentOrgId || 'none'}, modalLockedOrgId=${lockedOrgId || 'none'}, billingOrgId=${billingOrgId || 'none'}, orgProfileLoaded=${orgProfileLoaded}, role=${billingRole || 'null'}, manageEnabled=${manageEnabled}, disableReason=${manageDisabledReason || 'none'}, portalAvailable=${portalAvailable}, loading=${loading}, status=${status || 'none'}, interval=${interval || 'none'}, cancelAtPeriodEnd=${cancelAtPeriodEnd}, cancelAt=${cancelAt || 'null'}, currentPeriodEnd=${state.currentPeriodEnd || 'null'}, computedIsCancelScheduled=${isCancelScheduled}`
      );
    }

    if (showSkeleton) {
      const actionsSkeleton = doc.createElement('div');
      actionsSkeleton.className = 'row tp3d-billing-actions tp3d-skel tp3d-billing-skel-actions';
      actionsSkeleton.innerHTML = `
        <span class="tp3d-skel-btn"></span>
        <span class="tp3d-skel-btn"></span>
      `;
      subSection.appendChild(actionsSkeleton);
    } else {
      // Action buttons row
      const actionsRow = doc.createElement('div');
      actionsRow.className = 'row tp3d-billing-actions';

      const manageWrap = doc.createElement('span');
      manageWrap.className = 'tp3d-billing-manage-wrap';
      const manageBtn = doc.createElement('button');
      manageBtn.type = 'button';
      manageBtn.className = 'btn btn-secondary';
      manageBtn.textContent = 'Manage';
      manageBtn.disabled = Boolean(manageDisabledReason);
      if (manageDisabledReason) {
        manageBtn.setAttribute('aria-label', `Manage disabled: ${manageDisabledReason}`);
      }
      manageBtn.addEventListener('click', () => {
        if (manageBtn.disabled || !api || typeof api.openPortal !== 'function') return;
        manageBtn.disabled = true;
        manageBtn.textContent = 'Redirecting\u2026';
        api.openPortal().then((r) => {
          if (!r.ok) {
            if (UIComponents) UIComponents.showToast(r.error || 'Portal session failed', 'error', { title: 'Billing' });
            manageBtn.disabled = false;
            manageBtn.textContent = 'Manage';
          }
        }).catch(() => {
          manageBtn.disabled = false;
          manageBtn.textContent = 'Manage';
        });
      });
      manageWrap.appendChild(manageBtn);
      actionsRow.appendChild(manageWrap);

      const refreshBtn = doc.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'btn btn-secondary';
      refreshBtn.textContent = 'Refresh';
      refreshBtn.disabled = Boolean(loading || !lockedOrgId);
      refreshBtn.addEventListener('click', () => {
        if (!lockedOrgId) return;
        ensureBillingContextHydrated(lockedOrgId, { force: true, source: 'org-billing:refresh' }).catch(() => {});
        if (api && typeof api.refreshBilling === 'function') {
          api.refreshBilling({ force: true }).catch(() => {});
        }
      });
      actionsRow.appendChild(refreshBtn);
      subSection.appendChild(actionsRow);
    }

    targetEl.appendChild(subSection);

    // --- Debug diagnostics (dev only, inside <details>) ---
    if (isDebug) {
      const details = doc.createElement('details');
      details.className = 'tp3d-settings-billing tp3d-settings-debug';

      const summary = doc.createElement('summary');
      summary.className = 'muted';
      summary.textContent = 'Diagnostics';
      details.appendChild(summary);

      const lastEl = doc.createElement('div');
      lastEl.className = 'muted';
      lastEl.textContent = 'Last fetched: ' + (state.lastFetchedAt ? new Date(state.lastFetchedAt).toLocaleString() : 'never');
      details.appendChild(lastEl);

      if (state.error) {
        const errEl = doc.createElement('div');
        errEl.className = 'muted';
        errEl.textContent = 'Error: ' + (typeof state.error === 'string' ? state.error : state.error.message || String(state.error));
        details.appendChild(errEl);
      }

      const pre = doc.createElement('pre');
      pre.textContent = JSON.stringify(state, null, 2);
      details.appendChild(pre);

      targetEl.appendChild(details);
    }
  }

  function ensureBillingSubscription() {
    const api = getBillingApiSafely();
    if (!api || typeof api.subscribeBilling !== 'function') return;
    if (billingUnsubscribe) return;

    billingSubscriptionToken += 1;
    const currentToken = billingSubscriptionToken;
    const maybeUnsub = api.subscribeBilling(() => {
      // Always target the latest wrap if the DOM was re-rendered
      const wrap = doc.getElementById('tp3d-billing-wrap');
      if (!wrap) return;
      try {
        renderBillingInto(wrap);
      } catch (err) {
        debug('billing render failed', { err, token: currentToken });
      }
    });

    billingUnsubscribe = typeof maybeUnsub === 'function'
      ? () => {
          try {
            maybeUnsub();
          } catch {
            // ignore
          }
          billingUnsubscribe = null;
        }
      : () => {
          billingUnsubscribe = null;
        };
  }

  function render() {
    if (!settingsOverlay) {
      return null;
    }
    const prefs = PreferencesManager.get();

    settingsLeftPane.innerHTML = '';
    settingsRightPane.innerHTML = '';

    // Left: account switcher button
    const userView = getCurrentUserView();
    const orgContextId = getOrgIdFromOrgContext();
    const lockedOrgId = ensureModalOrgId();
    const hasOrg = Boolean(
      lockedOrgId ||
      (orgData && orgData.id) ||
      (membershipData && membershipData.organization_id) ||
      orgContextId
    );
    const isOrgHydrating = Boolean(
      userView.isAuthed &&
      !hasOrg &&
      (isLoadingAccountBundle || isLoadingMembership || isLoadingOrg)
    );
    const accountBtn = doc.createElement('button');
    accountBtn.type = 'button';
    accountBtn.className = 'btn';
    accountBtn.classList.add('tp3d-settings-account-btn');
    accountBtn.innerHTML = `
      <span class="tp3d-settings-account-inner">
        <span class="brand-mark tp3d-settings-account-avatar" aria-hidden="true">${userView.initials || ''}</span>
        <span class="tp3d-settings-account-text">
          <span class="tp3d-settings-account-name">Workspace</span>
          <span class="muted tp3d-settings-account-sub" data-account-name>${userView.displayName || 'â€”'}</span>
        </span>
      </span>
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    `;
    settingsLeftPane.appendChild(accountBtn);
    const accountSwitcher = getAccountSwitcher ? getAccountSwitcher() : null;
    unmountAccountButton =
      accountSwitcher && accountSwitcher.bind ? accountSwitcher.bind(accountBtn, { align: 'left' }) : null;

    // Left: settings navigation
    const navWrap = doc.createElement('div');
    navWrap.classList.add('tp3d-settings-nav-wrap');
    navWrap.dataset.settingsTabs = '1';
    navWrap.setAttribute('role', 'tablist');

    const makeHeader = text => {
      const h = doc.createElement('div');
      h.className = 'muted';
      h.classList.add('tp3d-settings-nav-header');
      h.textContent = text;
      return h;
    };

    /**
     * @param {{ key: string, label: string, icon?: string, indent?: boolean, disabled?: boolean }} opts
     */
    const makeItem = ({ key, label, icon, indent = false, disabled = false }) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-btn';
      btn.classList.add('tp3d-settings-nav-item');
      if (disabled) btn.classList.add('is-disabled');
      btn.dataset.settingsTab = key;
      btn.setAttribute('role', 'tab');

      if (icon) {
        const i = doc.createElement('i');
        i.className = icon;
        i.classList.add('tp3d-settings-nav-icon');
        if (indent) i.classList.add('is-indented');
        btn.appendChild(i);
      }

      const text = doc.createElement('span');
      text.textContent = label;
      text.classList.add('tp3d-settings-nav-label');
      btn.appendChild(text);

      const isActive = _tabState.activeTabId === key;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
      btn.disabled = Boolean(disabled);
      btn.dataset.tab = key;
      btn.dataset.settingsTab = key;
      return btn;
    };

    navWrap.appendChild(makeHeader('Account Settings'));
    navWrap.appendChild(makeItem({ key: 'account', label: 'Account', icon: 'fa-regular fa-user' }));
    navWrap.appendChild(makeHeader('Settings'));
    navWrap.appendChild(makeItem({ key: 'preferences', label: 'Preferences', icon: 'fa-solid fa-gear' }));
    navWrap.appendChild(makeItem({ key: 'resources', label: 'Resources', icon: 'fa-solid fa-life-ring' }));
    navWrap.appendChild(makeHeader('Organization'));
    navWrap.appendChild(
      makeItem({ key: 'org-general', label: 'General', icon: 'fa-regular fa-building', indent: true })
    );
    navWrap.appendChild(
      makeItem({
        key: 'org-members',
        label: 'Members',
        icon: 'fa-solid fa-users',
        indent: true,
        disabled: !hasOrg,
        disabledReason: isOrgHydrating ? 'Loading organization…' : 'No active organization selected.',
      })
    );
    navWrap.appendChild(
      makeItem({
        key: 'org-billing',
        label: 'Billing',
        icon: 'fa-regular fa-credit-card',
        indent: true,
        disabled: !hasOrg,
        disabledReason: isOrgHydrating ? 'Loading organization…' : 'No active organization selected.',
      })
    );
    settingsLeftPane.appendChild(navWrap);

    // Right: header
    const header = doc.createElement('div');
    header.className = 'row space-between';
    header.classList.add('tp3d-settings-right-header');

    const meta = (() => {
      switch (_tabState.activeTabId) {
        case 'preferences':
          return {
            title: 'Preferences',
            helper: 'Set your units, labels, and theme.',
          };
        case 'resources':
          // Handle sub-views within Resources
          if (resourcesSubView === 'updates') {
            return {
              title: 'Updates',
              helper: 'Release notes and recent changes.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'roadmap') {
            return {
              title: 'Roadmap',
              helper: 'Product direction and upcoming features.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'export') {
            return {
              title: 'Export App JSON',
              helper: 'Download a full JSON backup of packs, cases, and settings.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'import') {
            return {
              title: 'Import App JSON',
              helper: 'Restore your data from a JSON backup.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'help') {
            return {
              title: 'Help - Export / Import',
              helper: 'Guidance for exports and imports.',
              showBack: true,
            };
          }
          return {
            title: 'Resources',
            helper: 'See updates, roadmap, exports, imports, and help in one place.',
          };
        case 'account':
          return {
            title: 'Account',
            helper: 'Manage your profile and workspace identity.',
          };
        case 'org-general':
          return {
            title: 'Organization',
            helper: 'View workspace details and role.',
          };
        case 'org-members':
          return {
            title: 'Members',
            helper: 'Manage workspace members and roles.',
          };
        case 'org-billing':
          return {
            title: 'Billing',
            helper: 'Manage billing and subscription details.',
          };
        default:
          return {
            title: 'Settings',
            helper: 'Adjust your preferences.',
          };
      }
    })();

    const headerLeft = doc.createElement('div');
    headerLeft.className = 'tp3d-settings-header-row';

    // Back button for sub-views
    if (meta.showBack) {
      const backBtn = doc.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'btn btn-ghost';
      backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
      backBtn.addEventListener('click', () => setResourcesSubView('root'));
      headerLeft.appendChild(backBtn);
    }

    const headerText = doc.createElement('div');
    headerText.classList.add('tp3d-settings-right-text');

    const title = doc.createElement('div');
    title.classList.add('tp3d-settings-right-title');
    title.textContent = meta.title;

    const helper = doc.createElement('div');
    helper.classList.add('tp3d-settings-right-subtitle');
    helper.classList.add('muted');
    helper.textContent = meta.helper;

    headerText.appendChild(title);
    headerText.appendChild(helper);
    headerLeft.appendChild(headerText);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => close());

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);
    settingsRightPane.appendChild(header);

    const body = doc.createElement('div');
    body.classList.add('tp3d-settings-right-body');
    body.setAttribute('data-tab-panel', _tabState.activeTabId);
    body.hidden = false;
    settingsRightPane.appendChild(body);

    function row(label, valueEl) {
      const wrap = doc.createElement('div');
      wrap.classList.add('tp3d-settings-row');
      const l = doc.createElement('div');
      l.classList.add('tp3d-settings-row-label');
      l.textContent = label;
      wrap.appendChild(l);
      wrap.appendChild(valueEl);
      return wrap;
    }

    if (_tabState.activeTabId === 'preferences') {
      const length = doc.createElement('select');
      length.className = 'select';
      length.innerHTML = `
        <option value="in">Inches (in)</option>
        <option value="ft">Feet (ft)</option>
        <option value="mm">Millimeters (mm)</option>
        <option value="cm">Centimeters (cm)</option>
        <option value="m">Meters (m)</option>
      `;
      length.value = prefs.units.length;

      const weight = doc.createElement('select');
      weight.className = 'select';
      weight.innerHTML = `
        <option value="lb">Pounds (lb)</option>
        <option value="kg">Kilograms (kg)</option>
      `;
      weight.value = prefs.units.weight;

      const hiddenOpacity = doc.createElement('input');
      hiddenOpacity.className = 'input';
      hiddenOpacity.type = 'number';
      hiddenOpacity.min = '0';
      hiddenOpacity.max = '1';
      hiddenOpacity.step = '0.05';
      hiddenOpacity.value = String(prefs.hiddenCaseOpacity);

      const labelSize = doc.createElement('input');
      labelSize.className = 'input';
      labelSize.type = 'number';
      labelSize.min = '8';
      labelSize.max = '24';
      labelSize.step = '1';
      labelSize.value = String(prefs.labelFontSize);

      const theme = doc.createElement('select');
      theme.className = 'select';
      theme.innerHTML = `
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      `;
      theme.value = prefs.theme;

      body.appendChild(row('Length', length));
      body.appendChild(row('Weight', weight));
      body.appendChild(row('Hidden Case Opacity', hiddenOpacity));
      body.appendChild(row('Label Font Size', labelSize));
      body.appendChild(row('Theme', theme));

      const showShadowControls = false;
      if (showShadowControls) {
        const sceneManager = typeof getSceneManager === 'function' ? getSceneManager() : null;
        const renderer = sceneManager && typeof sceneManager.getRenderer === 'function' ? sceneManager.getRenderer() : null;
        const perf = sceneManager && typeof sceneManager.getPerf === 'function' ? sceneManager.getPerf() : null;
        const hasRenderer = Boolean(renderer && renderer.shadowMap);
        const shadowsEnabled = hasRenderer && renderer.shadowMap.enabled;
        const perfMode = Boolean(perf && perf.perfMode);

        const shadowRow = doc.createElement('div');
        shadowRow.className = 'tp3d-settings-inline-row';

        const shadowStatus = doc.createElement('div');
        shadowStatus.className = 'muted tp3d-settings-meta';
        shadowStatus.textContent = !hasRenderer
          ? 'Unavailable'
          : shadowsEnabled
            ? 'Enabled'
            : perfMode
              ? 'Disabled (performance mode)'
              : 'Disabled';

        const restoreBtn = doc.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn btn-ghost';
        restoreBtn.textContent = 'Restore shadows';
        restoreBtn.disabled = !sceneManager || !hasRenderer || shadowsEnabled === true;
        restoreBtn.addEventListener('click', () => {
          if (!sceneManager || typeof sceneManager.restoreShadows !== 'function') return;
          const ok = sceneManager.restoreShadows();
          if (ok) {
            shadowStatus.textContent = 'Enabled';
            restoreBtn.disabled = true;
            UIComponents.showToast('Shadows restored', 'success', { title: 'View', duration: 1600 });
          } else {
            UIComponents.showToast('Shadows unavailable', 'warning', { title: 'View', duration: 1600 });
          }
        });

        shadowRow.appendChild(shadowStatus);
        shadowRow.appendChild(restoreBtn);
        body.appendChild(row('Shadows', shadowRow));
      }

      const actions = doc.createElement('div');
      actions.className = 'row';
      actions.classList.add('tp3d-settings-actions-row');
      const saveBtn = doc.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-primary';
      saveBtn.textContent = 'Save changes';
      saveBtn.addEventListener('click', () =>
        savePrefsFromForm({
          length: length.value,
          weight: weight.value,
          theme: theme.value,
          labelSize: labelSize.value,
          hiddenOpacity: hiddenOpacity.value,
        })
      );
      actions.appendChild(saveBtn);
      body.appendChild(actions);
    } else if (_tabState.activeTabId === 'resources') {
      // Handle sub-views within Resources
      if (resourcesSubView === 'updates') {
        // Render embedded Updates content
        renderUpdatesContent(body);
      } else if (resourcesSubView === 'roadmap') {
        // Render embedded Roadmap content
        renderRoadmapContent(body);
      } else if (resourcesSubView === 'export') {
        renderExportContent(body);
      } else if (resourcesSubView === 'import') {
        renderImportContent(body);
      } else if (resourcesSubView === 'help') {
        renderHelpContent(body);
      } else {
        // Root view: show buttons
        const container = doc.createElement('div');
        container.className = 'grid';

        const makeBtn = (label, variant, onClick) => {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'btn';
          if (variant) btn.classList.add(variant);
          btn.textContent = label;
          btn.addEventListener('click', onClick);
          return btn;
        };

        const exportBtn = makeBtn('Export App', null, () => setResourcesSubView('export'));
        const importBtn = makeBtn('Import App', null, () => setResourcesSubView('import'));
        const helpBtn = makeBtn('Help', null, () => setResourcesSubView('help'));

        // Updates and Roadmap buttons switch sub-views
        const updatesBtn = makeBtn('Updates', null, () => setResourcesSubView('updates'));
        const roadmapBtn = makeBtn('Roadmap', null, () => setResourcesSubView('roadmap'));

        container.appendChild(updatesBtn);
        container.appendChild(roadmapBtn);
        container.appendChild(exportBtn);
        container.appendChild(importBtn);
        container.appendChild(helpBtn);
        body.appendChild(container);
      }
    } else if (_tabState.activeTabId === 'account') {
      const accountUserView = getCurrentUserView(profileData);

      // Load all account data via bundle if profile not already loaded
      // This uses the epoch-validated single-flight approach to prevent stale data
      if (!profileData && !isLoadingProfile && !isLoadingAccountBundle && accountUserView.isAuthed) {
        const actionId = _tabState.lastActionId;
        loadAccountBundle()
          .then(() => renderIfFresh(actionId, 'account-bundle'))
          .catch(() => {});
      }

      // Avatar section
      const avatarSection = doc.createElement('div');
      avatarSection.className = 'card tp3d-settings-card-max';
      const avatarContainer = doc.createElement('div');
      avatarContainer.className = 'tp3d-account-avatar-upload-container';

      const avatarPreview = doc.createElement('div');
      avatarPreview.className = 'brand-mark tp3d-account-avatar-preview';
      if (isUploadingAvatar) {
        avatarPreview.classList.add('is-uploading');
      }

      if (profileData && profileData.avatar_url) {
        avatarPreview.classList.add('has-image');
        const img = doc.createElement('img');
        // Add cache-busting to force reload after upload
        const avatarUrl =
          profileData.avatar_url + (profileData.avatar_url.includes('?') ? '&' : '?') + 't=' + Date.now();
        img.src = avatarUrl;
        img.alt = 'Avatar';
        img.className = 'tp3d-account-avatar-img';
        avatarPreview.appendChild(img);
      } else {
        avatarPreview.textContent = accountUserView.initials || '';
      }

      avatarContainer.appendChild(avatarPreview);
      if (isEditingProfile) {
        const avatarButtons = doc.createElement('div');
        avatarButtons.className = 'tp3d-account-avatar-buttons';

        const uploadBtn = doc.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'btn btn-secondary';
        uploadBtn.textContent = profileData && profileData.avatar_url ? 'Change Avatar' : 'Upload Avatar';
        uploadBtn.disabled = !accountUserView.isAuthed || isUploadingAvatar;

        const fileInput = doc.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/jpg,image/webp';
        fileInput.setAttribute('aria-hidden', 'true');
        fileInput.classList.add('visually-hidden');

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async e => {
          const inputEl = /** @type {HTMLInputElement|null} */ (e.target);
          const file = inputEl && inputEl.files ? inputEl.files[0] : null;
          if (file) {
            await handleAvatarUpload(file);
            fileInput.value = '';
          }
        });

        avatarButtons.appendChild(uploadBtn);

        if (profileData && profileData.avatar_url) {
          const removeBtn = doc.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'btn btn-ghost';
          removeBtn.textContent = 'Remove';
          removeBtn.disabled = !accountUserView.isAuthed || isUploadingAvatar;
          removeBtn.addEventListener('click', () => handleAvatarRemove());
          avatarButtons.appendChild(removeBtn);
        }

        avatarContainer.appendChild(avatarButtons);
        avatarContainer.appendChild(fileInput);
      }
      avatarSection.appendChild(avatarContainer);
      body.appendChild(avatarSection);

      // Profile info section
      const profileSection = doc.createElement('div');
      profileSection.className = 'card tp3d-settings-card-max';

      if (isEditingProfile && profileData) {
        // Edit mode
        const form = doc.createElement('form');
        form.className = 'tp3d-account-profile-form';
        form.addEventListener('submit', e => {
          e.preventDefault();
          const formData = new FormData(form);
          const updates = {
            display_name: formData.get('display_name') || null,
            first_name: formData.get('first_name') || null,
            last_name: formData.get('last_name') || null,
            bio: formData.get('bio') || null,
          };
          saveProfile(updates);
        });

        // Display Name field
        const displayNameField = doc.createElement('div');
        displayNameField.className = 'tp3d-account-field';
        const displayNameLabel = doc.createElement('label');
        displayNameLabel.className = 'tp3d-account-field-label';
        displayNameLabel.textContent = 'Display Name';
        const displayNameInput = doc.createElement('input');
        displayNameInput.type = 'text';
        displayNameInput.name = 'display_name';
        displayNameInput.className = 'input';
        displayNameInput.value = profileData.display_name || '';
        displayNameInput.placeholder = 'Your display name';
        displayNameField.appendChild(displayNameLabel);
        displayNameField.appendChild(displayNameInput);
        form.appendChild(displayNameField);

        // First Name field
        const firstNameField = doc.createElement('div');
        firstNameField.className = 'tp3d-account-field';
        const firstNameLabel = doc.createElement('label');
        firstNameLabel.className = 'tp3d-account-field-label';
        firstNameLabel.textContent = 'First Name';
        const firstNameInput = doc.createElement('input');
        firstNameInput.type = 'text';
        firstNameInput.name = 'first_name';
        firstNameInput.className = 'input';
        firstNameInput.value = profileData.first_name || '';
        firstNameInput.placeholder = 'Your first name';
        firstNameField.appendChild(firstNameLabel);
        firstNameField.appendChild(firstNameInput);

        // Last Name field
        const lastNameField = doc.createElement('div');
        lastNameField.className = 'tp3d-account-field';
        const lastNameLabel = doc.createElement('label');
        lastNameLabel.className = 'tp3d-account-field-label';
        lastNameLabel.textContent = 'Last Name';
        const lastNameInput = doc.createElement('input');
        lastNameInput.type = 'text';
        lastNameInput.name = 'last_name';
        lastNameInput.className = 'input';
        lastNameInput.value = profileData.last_name || '';
        lastNameInput.placeholder = 'Your last name';
        lastNameField.appendChild(lastNameLabel);
        lastNameField.appendChild(lastNameInput);

        const nameRow = doc.createElement('div');
        nameRow.className = 'tp3d-account-field-row';
        nameRow.appendChild(firstNameField);
        nameRow.appendChild(lastNameField);
        form.appendChild(nameRow);

        // Bio field
        const bioField = doc.createElement('div');
        bioField.className = 'tp3d-account-field';
        const bioLabel = doc.createElement('label');
        bioLabel.className = 'tp3d-account-field-label';
        bioLabel.textContent = 'Bio';
        const bioTextarea = doc.createElement('textarea');
        bioTextarea.name = 'bio';
        bioTextarea.value = profileData.bio || '';
        bioTextarea.placeholder = 'Tell us about yourself';
        bioTextarea.rows = 4;
        bioField.appendChild(bioLabel);
        bioField.appendChild(bioTextarea);
        form.appendChild(bioField);

        // Actions
        const actions = doc.createElement('div');
        actions.className = 'tp3d-account-actions';

        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-ghost';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = isSavingProfile;
        cancelBtn.addEventListener('click', () => {
          isEditingProfile = false;
          render();
        });

        const saveBtn = doc.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'btn btn-primary';
        if (isSavingProfile) {
          saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
        } else {
          saveBtn.textContent = 'Save Changes';
        }
        saveBtn.disabled = isSavingProfile;

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        profileSection.appendChild(form);
      } else {
        // View mode
        const viewContainer = doc.createElement('div');
        viewContainer.className = 'grid';

        if (!profileData && (isLoadingProfile || isLoadingAccountBundle)) {
          const makeSkeleton = () => {
            const el = doc.createElement('div');
            el.className = 'tp3d-skeleton tp3d-skeleton-short';
            return el;
          };
          viewContainer.appendChild(row('Display Name', makeSkeleton()));
          viewContainer.appendChild(row('First Name', makeSkeleton()));
          viewContainer.appendChild(row('Last Name', makeSkeleton()));
          viewContainer.appendChild(row('Bio', makeSkeleton()));
          viewContainer.appendChild(row('Email', makeSkeleton()));
        } else {
          // Display name
          const displayNameEl = doc.createElement('div');
          displayNameEl.textContent =
            (profileData && profileData.display_name) || accountUserView.displayName || '\u2014';
          viewContainer.appendChild(row('Display Name', displayNameEl));

          // First name
          if (profileData) {
            const firstNameEl = doc.createElement('div');
            firstNameEl.textContent = profileData.first_name || '\u2014';
            viewContainer.appendChild(row('First Name', firstNameEl));

            // Last name
            const lastNameEl = doc.createElement('div');
            lastNameEl.textContent = profileData.last_name || '\u2014';
            viewContainer.appendChild(row('Last Name', lastNameEl));

            // Bio
            if (profileData.bio) {
              const bioEl = doc.createElement('div');
              bioEl.textContent = profileData.bio;
              viewContainer.appendChild(row('Bio', bioEl));
            }
          }

          // Email
          const emailEl = doc.createElement('div');
          emailEl.textContent =
            accountUserView.isAuthed && accountUserView.email ? accountUserView.email : 'Not signed in';
          viewContainer.appendChild(row('Email', emailEl));

          // Edit button
          if (accountUserView.isAuthed && profileData) {
            const editActions = doc.createElement('div');
            editActions.className = 'tp3d-account-actions';
            const editBtn = doc.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn btn-primary';
            editBtn.textContent = 'Edit Profile';
            editBtn.addEventListener('click', () => {
              isEditingProfile = true;
              render();
            });
            editActions.appendChild(editBtn);
            viewContainer.appendChild(editActions);
          }
        }

        profileSection.appendChild(viewContainer);
      }

      body.appendChild(profileSection);

      // Danger zone
      const danger = doc.createElement('div');
      danger.className = 'card tp3d-settings-card-max tp3d-settings-danger';
      danger.innerHTML = `
        <div class="tp3d-settings-danger-title">Danger Zone</div>
        <div class="tp3d-settings-danger-divider"></div>
      `;
      const dangerRow = doc.createElement('div');
      dangerRow.classList.add('tp3d-settings-danger-row');
      const dLeft = doc.createElement('div');
      dLeft.classList.add('tp3d-settings-danger-left');
      dLeft.textContent = 'Delete Account';
      const dRight = doc.createElement('div');
      dRight.classList.add('tp3d-settings-danger-right');

      const deleteBtn = doc.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger';
      deleteBtn.textContent = 'Delete Account';
      deleteBtn.disabled = !accountUserView.isAuthed;
      deleteBtn.addEventListener('click', () => {
        // Create confirmation modal content
        const modalContent = doc.createElement('div');
        modalContent.className = 'grid';

        const dangerMsg = doc.createElement('div');
        dangerMsg.innerHTML =
          '<strong>Account deletion is irreversible.</strong><br/><br/>' +
          'This will remove the user from the project and all associated data. This action cannot be undone.';

        const confirmWrap = doc.createElement('div');
        confirmWrap.className = 'grid';

        const confirmLabel = doc.createElement('div');
        confirmLabel.className = 'muted';
        confirmLabel.textContent = 'Type DELETE to confirm.';

        const confirmInput = doc.createElement('input');
        confirmInput.type = 'text';
        confirmInput.className = 'input';
        confirmInput.placeholder = 'Type DELETE';
        confirmInput.autocomplete = 'off';
        confirmInput.autocapitalize = 'characters';
        confirmInput.spellcheck = false;

        const errorMsg = doc.createElement('div');
        errorMsg.className = 'muted';
        errorMsg.style.minHeight = '18px';
        errorMsg.style.color = 'var(--danger, #dc2626)';
        errorMsg.textContent = '';

        confirmWrap.appendChild(confirmLabel);
        confirmWrap.appendChild(confirmInput);
        confirmWrap.appendChild(errorMsg);

        modalContent.appendChild(dangerMsg);
        modalContent.appendChild(confirmWrap);

        const isValid = () =>
          String(confirmInput.value || '')
            .trim()
            .toUpperCase() === 'DELETE';

        // Show modal
        const modalRef = UIComponents.showModal({
          title: 'Request Account Deletion',
          subtitle: 'User will no longer have access to the project.',
          content: modalContent,
          actions: [
            // Let UIComponents auto-close for Cancel
            { label: 'Cancel', variant: 'ghost' },
            {
              label: 'Delete Account',
              variant: 'danger',
              onClick: () => {
                // Prevent double-submits
                if (modalRef && modalRef._tp3dDeleteInFlight) return false;

                // (A) Hard guard: must type DELETE
                if (!isValid()) {
                  errorMsg.textContent = 'Type DELETE to confirm.';
                  return false; // keep modal open
                }

                // (B) Offline guard: do not call Edge Function
                if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
                  errorMsg.textContent = 'You are offline. Reconnect to delete your account.';
                  return false; // keep modal open
                }

                modalRef._tp3dDeleteInFlight = true;

                // Run async flow without auto-closing the modal
                (async () => {
                  const dangerBtn =
                    modalRef && modalRef.overlay
                      ? modalRef.overlay.querySelector('.modal-footer button.btn-danger')
                      : null;

                  try {
                    if (dangerBtn) dangerBtn.disabled = true;
                    confirmInput.disabled = true;
                    errorMsg.textContent = '';

                    await SupabaseClient.requestAccountDeletion();

                    try {
                      UIComponents.showToast('Deletion requested. You will be signed out.', 'warning');
                    } catch {
                      // ignore
                    }

                    // Clear local app state + local session
                    try {
                      CoreStorage.clearAll();
                    } catch {
                      /* ignore */
                    }
                    try {
                      _SessionManager && _SessionManager.clear && _SessionManager.clear();
                    } catch {
                      /* ignore */
                    }

                    // Sign out and reload (no redirect to "/")
                    await SupabaseClient.signOut({ global: true, allowOffline: true });

                    try {
                      modalRef.close();
                    } catch {
                      /* ignore */
                    }
                    window.location.reload();
                  } catch (err) {
                    const msg = err && err.message ? String(err.message) : '';

                    // Friendly offline message (double-safe)
                    if (
                      msg.toLowerCase().includes('offline') ||
                      (typeof navigator !== 'undefined' && navigator && navigator.onLine === false)
                    ) {
                      errorMsg.textContent = 'You are offline. Reconnect to delete your account.';
                    } else {
                      errorMsg.textContent = msg ? `Delete request failed: ${msg}` : 'Delete request failed.';
                    }

                    confirmInput.disabled = false;
                    if (dangerBtn) dangerBtn.disabled = false;
                    modalRef._tp3dDeleteInFlight = false;
                  }
                })();

                return false; // keep modal open until we close it ourselves
              },
            },
          ],
        });

        const dangerBtn =
          modalRef && modalRef.overlay ? modalRef.overlay.querySelector('.modal-footer button.btn-danger') : null;

        // showModal does not enforce action.disabled, so we force it here
        if (dangerBtn) dangerBtn.disabled = true;

        const sync = () => {
          const ok = isValid();
          if (dangerBtn) dangerBtn.disabled = !ok;
          if (ok) errorMsg.textContent = '';
        };

        // (A) Enter must NOT confirm (prevents bypass)
        const preventEnter = ev => {
          if (!ev || ev.key !== 'Enter') return;
          ev.preventDefault();
          ev.stopPropagation();

          if (!isValid()) {
            errorMsg.textContent = 'Type DELETE to confirm.';
            return;
          }

          // If valid, move focus to the button (but do not click it)
          try {
            dangerBtn && dangerBtn.focus && dangerBtn.focus();
          } catch {
            /* ignore */
          }
        };

        // Block Enter anywhere inside the modal (not just the input)
        try {
          if (modalRef && modalRef.modal) {
            modalRef.modal.addEventListener('keydown', preventEnter, true);
          }
        } catch {
          // ignore
        }

        confirmInput.addEventListener('input', sync);
        confirmInput.addEventListener('keydown', preventEnter, true);

        // Focus the confirmation input after the modal mounts
        try {
          setTimeout(() => {
            try {
              confirmInput.focus();
              confirmInput.select && confirmInput.select();
            } catch {
              /* ignore */
            }
          }, 0);
        } catch {
          // ignore
        }

        sync();
      });

      dRight.appendChild(deleteBtn);
      dangerRow.appendChild(dLeft);
      dangerRow.appendChild(dRight);
      danger.appendChild(dangerRow);
      body.appendChild(danger);
    } else if (_tabState.activeTabId === 'org-general') {
      const orgUserView = getCurrentUserView(profileData);

      // Load all account data via bundle if not already loaded
      // This uses the epoch-validated single-flight approach to prevent stale data
      if (!membershipData && !orgData && !isLoadingAccountBundle && !isLoadingMembership && orgUserView.isAuthed) {
        const actionId = _tabState.lastActionId;
        loadAccountBundle()
          .then(() => {
            renderIfFresh(actionId, 'org-bundle');
          })
          .catch(() => {
            renderIfFresh(actionId, 'org-bundle-error');
          });
      }

      // Render org card
      const orgCard = doc.createElement('div');
      orgCard.className = 'card';
      orgCard.classList.add('tp3d-settings-card-max');

      const orgTitle = doc.createElement('div');
      orgTitle.classList.add('tp3d-settings-org-title');
      orgTitle.textContent = 'General';

      const orgDivider = doc.createElement('div');
      orgDivider.classList.add('tp3d-settings-org-divider');

      const orgRow = (label, valueEl) => {
        const wrap = doc.createElement('div');
        wrap.classList.add('tp3d-settings-row');
        const l = doc.createElement('div');
        l.classList.add('tp3d-settings-row-label');
        l.textContent = label;
        wrap.appendChild(l);
        wrap.appendChild(valueEl);
        return wrap;
      };

      // Determine if user is owner/admin using membership.role
      const orgRole = String(
        (orgData && orgData.role) ||
        (membershipData && membershipData.role) ||
        ''
      ).toLowerCase();
      const isOwnerOrAdmin = orgRole === 'owner' || orgRole === 'admin';

      if (isEditingOrg && orgData && isOwnerOrAdmin) {
        // Edit mode
        const form = doc.createElement('form');
        form.className = 'tp3d-account-profile-form';
        form.addEventListener('submit', e => {
          e.preventDefault();
          const formData = new FormData(form);
          const updates = {
            name: formData.get('name') || null,
            phone: formData.get('phone') || null,
            address_line1: formData.get('address_line1') || null,
            address_line2: formData.get('address_line2') || null,
            city: formData.get('city') || null,
            state: formData.get('state') || null,
            postal_code: formData.get('postal_code') || null,
            country: formData.get('country') || null,
          };
          const orgIdForSave = String(
            (orgData && orgData.id) ||
            (membershipData && membershipData.organization_id) ||
            ''
          ).trim();
          if (orgIdForSave) {
            saveOrganization(updates, orgIdForSave);
          }
        });

        const makeField = (label, name, value = '', placeholder = '') => {
          const field = doc.createElement('div');
          field.className = 'tp3d-account-field';
          const lbl = doc.createElement('label');
          lbl.className = 'tp3d-account-field-label';
          lbl.textContent = label;
          const inp = doc.createElement('input');
          inp.type = 'text';
          inp.name = name;
          inp.className = 'input';
          inp.value = value || '';
          inp.placeholder = placeholder;
          field.appendChild(lbl);
          field.appendChild(inp);
          return field;
        };

        const makeFieldRow = (leftField, rightField) => {
          const fieldRow = doc.createElement('div');
          fieldRow.className = 'tp3d-account-field-row tp3d-org-field-row';
          if (leftField) fieldRow.appendChild(leftField);
          if (rightField) fieldRow.appendChild(rightField);
          return fieldRow;
        };

        const logoCell = doc.createElement('div');
        logoCell.className = 'row';

        const logoPreview = doc.createElement('span');
        logoPreview.className = 'tp3d-settings-account-avatar tp3d-settings-avatar--lg';
        logoPreview.style.background = 'var(--accent-primary)';
        logoPreview.textContent = (orgData.name || 'W').charAt(0).toUpperCase();
        const orgId = orgData && orgData.id ? String(orgData.id) : '';
        const orgLogoPath2 = orgData.logo_path ? String(orgData.logo_path) : null;
        const orgAvatarUrl2 = orgData.avatar_url ? String(orgData.avatar_url) : null;
        const logoKey = orgId + '|' + (orgLogoPath2 || orgAvatarUrl2 || '');
        const cachedLogoSrc = logoKey && lastOrgLogoKey === logoKey && lastOrgLogoExpiresAt > Date.now()
          ? lastOrgLogoUrl
          : null;
        // Hide initials while async logo loads to prevent flicker
        if (!cachedLogoSrc && (orgLogoPath2 || orgAvatarUrl2)) {
          logoPreview.style.visibility = 'hidden';
        }
        /** @type {HTMLSpanElement|HTMLImageElement} */
        let logoNode = logoPreview;
        if (cachedLogoSrc) {
          const cachedImg = doc.createElement('img');
          cachedImg.src = cachedLogoSrc;
          cachedImg.alt = orgData.name || 'Logo';
          cachedImg.width = 40;
          cachedImg.height = 40;
          cachedImg.className = 'tp3d-settings-avatar-img';
          cachedImg.onerror = () => {
            if (cachedImg.parentNode) cachedImg.parentNode.replaceChild(logoPreview, cachedImg);
            logoNode = logoPreview;
          };
          logoNode = cachedImg;
        }
        logoCell.appendChild(logoNode);

        if (orgLogoPath2 || orgAvatarUrl2) {
          const loadLogo2 = async () => {
            let src = null;
            if (orgLogoPath2 && SupabaseClient && typeof SupabaseClient.getOrgLogoUrl === 'function') {
              src = await SupabaseClient.getOrgLogoUrl(orgLogoPath2, orgData.updated_at || '');
            }
            if (!src && orgAvatarUrl2 && /^https?:\/\//i.test(orgAvatarUrl2)) src = orgAvatarUrl2;
            if (!src) return;
            if (logoKey) {
              lastOrgLogoKey = logoKey;
              lastOrgLogoUrl = src;
              lastOrgLogoExpiresAt = Date.now() + 50000;
            }
            if (
              logoNode &&
              logoNode.tagName === 'IMG' &&
              /** @type {HTMLImageElement} */ (logoNode).src === src
            ) return;
            const img = doc.createElement('img');
            img.src = src;
            img.alt = orgData.name || 'Logo';
            img.width = 40;
            img.height = 40;
            img.className = 'tp3d-settings-avatar-img';
            img.onload = () => {
              if (logoNode && logoNode.parentNode) {
                logoNode.parentNode.replaceChild(img, logoNode);
                logoNode = img;
              }
            };
            img.onerror = () => {
              logoPreview.style.visibility = '';
              if (img.parentNode) img.parentNode.replaceChild(logoPreview, img);
              logoNode = logoPreview;
            };
          };
          loadLogo2().catch(() => { logoPreview.style.visibility = ''; });
        }

        const logoInput = doc.createElement('input');
        logoInput.type = 'file';
        logoInput.accept = 'image/png,image/jpeg,image/webp';
        logoInput.style.display = 'none';
        logoInput.addEventListener('change', () => {
          const f = logoInput.files && logoInput.files[0];
          const orgIdLocal = String(
            (orgData && orgData.id) ||
            (membershipData && membershipData.organization_id) ||
            ''
          ).trim();
          if (!f || !orgIdLocal) return;
          UIComponents.showToast('Uploading logo…', 'info', { title: 'Organization' });
          SupabaseClient.uploadOrgLogo(orgIdLocal, f)
            .then(() => {
              UIComponents.showToast('Logo updated', 'success');
              // Clear overlay logo cache so re-render fetches the new logo
              lastOrgLogoKey = null;
              lastOrgLogoUrl = null;
              lastOrgLogoExpiresAt = 0;
              return loadOrganization(orgIdLocal);
            })
            .then(() => render())
            .catch(err => {
              UIComponents.showToast('Upload failed: ' + (err && err.message ? err.message : err), 'error');
            });
        });
        logoCell.appendChild(logoInput);

        const changeBtn = doc.createElement('button');
        changeBtn.type = 'button';
        changeBtn.className = 'btn';
        changeBtn.textContent = 'Change Logo';
        changeBtn.addEventListener('click', () => logoInput.click());
        logoCell.appendChild(changeBtn);

        form.appendChild(orgRow('Logo', logoCell));
        form.appendChild(makeField('Name', 'name', orgData.name || '', 'Organization name'));
        form.appendChild(
          makeFieldRow(
            makeField('Phone', 'phone', orgData.phone || '', '+1 (555) 000-0000'),
            makeField('Address Line 1', 'address_line1', orgData.address_line1 || '', 'Street address')
          )
        );
        form.appendChild(
          makeFieldRow(
            makeField('City', 'city', orgData.city || '', 'City'),
            makeField('State', 'state', orgData.state || '', 'State / Province')
          )
        );
        form.appendChild(
          makeFieldRow(
            makeField('Address Line 2', 'address_line2', orgData.address_line2 || '', 'Apt, suite, etc'),
            makeField('Postal Code', 'postal_code', orgData.postal_code || '', 'Postal code')
          )
        );
        form.appendChild(makeField('Country', 'country', orgData.country || '', 'Country'));

        // Actions
        const actions = doc.createElement('div');
        actions.className = 'tp3d-account-actions';

        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-ghost';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = isSavingOrg;
        cancelBtn.addEventListener('click', () => {
          isEditingOrg = false;
          render();
        });

        const saveBtn = doc.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'btn btn-primary';
        if (isSavingOrg) {
          saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
        } else {
          saveBtn.textContent = 'Save Changes';
        }
        saveBtn.disabled = isSavingOrg;

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        orgCard.appendChild(orgTitle);
        orgCard.appendChild(orgDivider);
        orgCard.appendChild(form);
      } else {
        // View mode
        const viewContainer = doc.createElement('div');
        viewContainer.className = 'grid';

        if (isLoadingMembership || isLoadingOrg || isLoadingAccountBundle) {
          const makeSkeleton = () => {
            const el = doc.createElement('div');
            el.className = 'tp3d-skeleton tp3d-skeleton-short';
            return el;
          };
          viewContainer.appendChild(orgRow('Name', makeSkeleton()));
          viewContainer.appendChild(orgRow('Slug', makeSkeleton()));
          viewContainer.appendChild(orgRow('Phone', makeSkeleton()));
          viewContainer.appendChild(orgRow('Address', makeSkeleton()));
          viewContainer.appendChild(orgRow('Role', makeSkeleton()));
        } else if (!membershipData) {
          const wrap = doc.createElement('div');
          wrap.className = 'tp3d-settings-stack--tight';

          const noOrgEl = doc.createElement('div');
          noOrgEl.className = 'muted';
          noOrgEl.textContent = 'Create a workspace to manage organization details.';
          wrap.appendChild(noOrgEl);

          const createBtn = doc.createElement('button');
          createBtn.type = 'button';
          createBtn.className = 'btn btn-primary';
          createBtn.textContent = '+ New Workspace';
          createBtn.addEventListener('click', () => {
            const name = window.prompt('Workspace name:');
            if (!name || !name.trim()) return;
            createBtn.disabled = true;
            createBtn.textContent = 'Creating\u2026';
            SupabaseClient.createOrganization({ name: name.trim() })
              .then(({ org, membership }) => {
                membershipData = membership;
                orgData = org;
                if (SupabaseClient.invalidateAccountCache) SupabaseClient.invalidateAccountCache();
                UIComponents.showToast('Workspace created!', 'success');
                render();
              })
              .catch(err => {
                UIComponents.showToast('Failed: ' + (err && err.message ? err.message : err), 'error');
                createBtn.disabled = false;
                createBtn.textContent = '+ New Workspace';
              });
          });
          wrap.appendChild(createBtn);

          const retryRow = doc.createElement('div');
          retryRow.style.display = 'flex';
          retryRow.style.justifyContent = 'flex-end';

          const retryBtn = doc.createElement('button');
          retryBtn.type = 'button';
          retryBtn.className = 'btn btn-ghost';
          retryBtn.textContent = 'Retry';
          retryBtn.addEventListener('click', () => {
            if (isLoadingMembership) return;
            isLoadingMembership = true;
            SupabaseClient.getMyMembership()
              .then(mem => {
                membershipData = mem;
                isLoadingMembership = false;
                if (mem && mem.organization_id) {
                  return loadOrganization(mem.organization_id);
                }
                return null;
              })
              .then(() => render())
              .catch(() => {
                isLoadingMembership = false;
                render();
              });
          });

          retryRow.appendChild(retryBtn);
          wrap.appendChild(retryRow);
          viewContainer.appendChild(wrap);
        } else if (orgData) {
          // Org logo row (display only)
          const logoCell = doc.createElement('div');
          logoCell.className = 'row';

          const logoPreview = doc.createElement('span');
          logoPreview.className = 'tp3d-settings-account-avatar tp3d-settings-avatar--lg';
          logoPreview.style.background = 'var(--accent-primary)';
          logoPreview.textContent = (orgData.name || 'W').charAt(0).toUpperCase();
          const orgId = orgData && orgData.id ? String(orgData.id) : '';
          const orgLogoPath2 = orgData.logo_path ? String(orgData.logo_path) : null;
          const orgAvatarUrl2 = orgData.avatar_url ? String(orgData.avatar_url) : null;
          const logoKey = orgId + '|' + (orgLogoPath2 || orgAvatarUrl2 || '');
          const cachedLogoSrc = logoKey && lastOrgLogoKey === logoKey && lastOrgLogoExpiresAt > Date.now()
            ? lastOrgLogoUrl
            : null;
          // Hide initials while async logo loads to prevent flicker
          if (!cachedLogoSrc && (orgLogoPath2 || orgAvatarUrl2)) {
            logoPreview.style.visibility = 'hidden';
          }
          /** @type {HTMLSpanElement|HTMLImageElement} */
          let logoNode = logoPreview;
          if (cachedLogoSrc) {
            const cachedImg = doc.createElement('img');
            cachedImg.src = cachedLogoSrc;
            cachedImg.alt = orgData.name || 'Logo';
            cachedImg.width = 40;
            cachedImg.height = 40;
            cachedImg.className = 'tp3d-settings-avatar-img';
            cachedImg.onerror = () => {
              if (cachedImg.parentNode) cachedImg.parentNode.replaceChild(logoPreview, cachedImg);
              logoNode = logoPreview;
            };
            logoNode = cachedImg;
          }
          logoCell.appendChild(logoNode);

          // Async load logo image if available
          if (orgLogoPath2 || orgAvatarUrl2) {
            const loadLogo2 = async () => {
              let src = null;
              if (orgLogoPath2 && SupabaseClient && typeof SupabaseClient.getOrgLogoUrl === 'function') {
                src = await SupabaseClient.getOrgLogoUrl(orgLogoPath2, orgData.updated_at || '');
              }
              if (!src && orgAvatarUrl2 && /^https?:\/\//i.test(orgAvatarUrl2)) src = orgAvatarUrl2;
              if (!src) return;
              if (logoKey) {
                lastOrgLogoKey = logoKey;
                lastOrgLogoUrl = src;
                lastOrgLogoExpiresAt = Date.now() + 50000;
              }
              if (
                logoNode &&
                logoNode.tagName === 'IMG' &&
                /** @type {HTMLImageElement} */ (logoNode).src === src
              ) return;
              const img = doc.createElement('img');
              img.src = src;
              img.alt = orgData.name || 'Logo';
              img.width = 40;
              img.height = 40;
              img.className = 'tp3d-settings-avatar-img';
              img.onload = () => {
                if (logoNode && logoNode.parentNode) {
                  logoNode.parentNode.replaceChild(img, logoNode);
                  logoNode = img;
                }
              };
              img.onerror = () => {
                logoPreview.style.visibility = '';
                if (img.parentNode) img.parentNode.replaceChild(logoPreview, img);
                logoNode = logoPreview;
              };
            };
            loadLogo2().catch(() => { logoPreview.style.visibility = ''; });
          }

          viewContainer.appendChild(orgRow('Logo', logoCell));

          viewContainer.appendChild(
            orgRow(
              'Name',
              (() => {
                const el = doc.createElement('div');
                el.textContent = orgData.name || '—';
                return el;
              })()
            )
          );

          viewContainer.appendChild(
            orgRow(
              'Slug',
              (() => {
                const el = doc.createElement('div');
                el.textContent = orgData.slug || '—';
                return el;
              })()
            )
          );

          viewContainer.appendChild(
            orgRow(
              'Phone',
              (() => {
                const el = doc.createElement('div');
                el.textContent = orgData.phone || '—';
                return el;
              })()
            )
          );

          if (orgData.address_line1) {
            viewContainer.appendChild(
              orgRow(
                'Address',
                (() => {
                  const el = doc.createElement('div');
                  const parts = [
                    orgData.address_line1,
                    orgData.address_line2,
                    orgData.city,
                    orgData.state,
                    orgData.postal_code,
                    orgData.country,
                  ].filter(Boolean);
                  el.textContent = parts.join(', ') || '—';
                  return el;
                })()
              )
            );
          }

          // Role display
          const roleEl = doc.createElement('div');
          const roleValue = String(
            (orgData && orgData.role) ||
            (membershipData && membershipData.role) ||
            'member'
          ).toLowerCase();
          const roleDisplay = roleValue.charAt(0).toUpperCase() + roleValue.slice(1);
          roleEl.textContent = roleDisplay;
          viewContainer.appendChild(orgRow('Role', roleEl));

          // Edit button only for owner/admin
          if (!isOwnerOrAdmin) {
            const noteEl = doc.createElement('div');
            noteEl.className = 'muted tp3d-settings-meta tp3d-settings-mt-md';
            noteEl.textContent = 'Only admins can edit organization details.';
            viewContainer.appendChild(noteEl);
          } else {
            const editActions = doc.createElement('div');
            editActions.className = 'tp3d-account-actions';
            const editBtn = doc.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn btn-primary';
            editBtn.textContent = 'Edit Organization';
            editBtn.addEventListener('click', () => {
              isEditingOrg = true;
              render();
            });
            editActions.appendChild(editBtn);
            viewContainer.appendChild(editActions);
          }
        }

        orgCard.appendChild(orgTitle);
        orgCard.appendChild(orgDivider);
        orgCard.appendChild(viewContainer);
      }

      body.appendChild(orgCard);
    } else if (_tabState.activeTabId === 'org-members') {
      const orgUserView = getCurrentUserView(profileData);
      const membersLockedOrgId = ensureModalOrgId();
      const currentOrgId = getOrgIdFromOrgContext();
      const orgId = membersLockedOrgId || null;
      const orgDataId = normalizeOrgId(orgData && orgData.id ? orgData.id : '');
      const membershipOrgId = normalizeOrgId(
        membershipData && membershipData.organization_id ? membershipData.organization_id : ''
      );
      const orgHydrating = Boolean(
        orgUserView.isAuthed &&
        !orgId &&
        (isLoadingAccountBundle || isLoadingMembership || isLoadingOrg)
      );
      const currentUserId = orgUserView && orgUserView.userId ? String(orgUserView.userId) : null;
      const currentRole = String(
        (orgDataId && orgDataId === orgId && orgData && orgData.role) ||
        (membershipOrgId && membershipOrgId === orgId && membershipData && membershipData.role) ||
        ''
      ).toLowerCase() || null;
      const isOwner = currentRole === 'owner';
      const canManage = canManageMembers(currentRole);
      const canManageAdmins = isOwner;
      const hasMembersForOrg = Boolean(
        orgId &&
        lastOrgMembersOrgId &&
        String(lastOrgMembersOrgId) === String(orgId) &&
        Array.isArray(orgMembersData)
      );
      const membersStale = Boolean(
        orgId &&
        lastOrgMembersOrgId &&
        String(lastOrgMembersOrgId) !== String(orgId)
      );
      const membersLoading = Boolean(isLoadingOrgMembers && (!hasMembersForOrg || membersStale));
      let membersDisabledReason = '';
      if (orgHydrating) {
        membersDisabledReason = 'Loading organization…';
      } else if (!orgId) {
        membersDisabledReason = 'Select an organization to manage members';
      } else if (membersLoading || membersStale) {
        membersDisabledReason = 'Members are not available yet, please refresh';
      } else if (!canManage) {
        membersDisabledReason = 'Only owners/admins can manage members';
      }

      if (debugEnabled()) {
        const membersCount = hasMembersForOrg && Array.isArray(orgMembersData) ? orgMembersData.length : null;
        console.debug(
          `[MembersUI] modalOrgId=${membersLockedOrgId || 'none'}, currentOrgId=${currentOrgId || 'none'}, orgHydrating=${orgHydrating}, members.loading=${membersLoading}, members.count=${membersCount === null ? 'null' : membersCount}, canManage=${canManage}, reason=${membersDisabledReason || 'none'}`
        );
      }

      const membersCard = doc.createElement('div');
      membersCard.className = 'card tp3d-settings-card-max';

      if (!orgUserView.isAuthed) {
        const msg = doc.createElement('div');
        msg.className = 'muted';
        msg.textContent = 'Sign in to manage workspace members.';
        membersCard.appendChild(msg);
      } else if (!orgId) {
        if (orgHydrating) {
          const skeletonGroup = doc.createElement('div');
          skeletonGroup.className = 'tp3d-skeleton-group tp3d-skel tp3d-members-skeleton';
          skeletonGroup.innerHTML = `
            <div class="tp3d-skel-line tp3d-skeleton-title"></div>
            <div class="tp3d-skel-line tp3d-skeleton-short"></div>
            <div class="tp3d-skel-line tp3d-skeleton-short"></div>
          `;
          membersCard.appendChild(skeletonGroup);
        } else {
          const msg = doc.createElement('div');
          msg.className = 'muted';
          msg.textContent = 'Select an organization to manage members.';
          membersCard.appendChild(msg);
        }
        const membersHelperMessage = doc.createElement('div');
        membersHelperMessage.className = 'muted tp3d-members-inline-helper';
        membersHelperMessage.textContent = membersDisabledReason || 'Members are not available yet, please refresh';
        membersCard.appendChild(membersHelperMessage);
        const refreshRow = doc.createElement('div');
        refreshRow.className = 'row';
        const refreshBtn = doc.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'btn btn-secondary';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.addEventListener('click', () => {
          queueAccountBundleRefresh({ force: true, source: 'org-members:refresh-org' });
          modalOrgId = resolveInitialModalOrgId();
          const nextOrgId = ensureModalOrgId();
          if (nextOrgId) {
            const actionId = _tabState.lastActionId;
            loadOrgMembers(nextOrgId)
              .then(() => renderIfFresh(actionId, 'org-members:refresh'))
              .catch(() => {});
          }
          render();
        });
        refreshRow.appendChild(refreshBtn);
        membersCard.appendChild(refreshRow);
      } else {
        if (membersStale) {
          orgMembersData = null;
          orgMembersError = null;
          orgMembersSearchQuery = '';
          orgMembersRoleFilter = 'all';
          orgInvitesData = null;
          orgInvitesError = null;
        }

        const rolesHelp = doc.createElement('div');
        rolesHelp.className = 'muted tp3d-role-help';
        rolesHelp.textContent =
          'Workspace members are scoped to your active organization. Owners and admins can update roles.';
        membersCard.appendChild(rolesHelp);

        if (membersDisabledReason) {
          const membersStateHelp = doc.createElement('div');
          membersStateHelp.className = 'muted tp3d-members-inline-helper';
          membersStateHelp.textContent = membersDisabledReason;
          membersCard.appendChild(membersStateHelp);
        }

        if (!hasMembersForOrg && !isLoadingOrgMembers) {
          const actionId = _tabState.lastActionId;
          loadOrgMembers(orgId)
            .then(() => renderIfFresh(actionId, 'org-members'))
            .catch(() => {});
        }

        // Load invites in parallel (owner/admin only)
        if (canManage && !membersDisabledReason && !orgInvitesData && !isLoadingOrgInvites) {
          const actionId = _tabState.lastActionId;
          loadOrgInvites(orgId)
            .then(() => renderIfFresh(actionId, 'org-invites'))
            .catch(() => {});
        }

        if (membersLoading && !hasMembersForOrg) {
          const skeletonGroup = doc.createElement('div');
          skeletonGroup.className = 'tp3d-skeleton-group tp3d-skel tp3d-members-skeleton';
          skeletonGroup.innerHTML = `
            <div class="tp3d-skel-line tp3d-skeleton-title"></div>
            <div class="tp3d-skel-line tp3d-skeleton-short"></div>
            <div class="tp3d-skel-line tp3d-skeleton-short"></div>
          `;
          membersCard.appendChild(skeletonGroup);
        } else if (orgMembersError) {
          const msg = doc.createElement('div');
          msg.className = 'muted';
          msg.textContent = 'Failed to load members. Please try again.';

          const retryRow = doc.createElement('div');
          retryRow.className = 'row';

          const retryBtn = doc.createElement('button');
          retryBtn.type = 'button';
          retryBtn.className = 'btn btn-ghost';
          retryBtn.textContent = 'Retry';
          retryBtn.addEventListener('click', () => {
            if (isLoadingOrgMembers) return;
            const actionId = _tabState.lastActionId;
            loadOrgMembers(orgId)
              .then(() => renderIfFresh(actionId, 'org-members'))
              .catch(() => {});
          });

          retryRow.appendChild(retryBtn);
          membersCard.appendChild(msg);
          membersCard.appendChild(retryRow);
        } else {
          const members = Array.isArray(orgMembersData) ? orgMembersData : [];
          const ownersCount = members.filter(m => m && String(m.role || '').toLowerCase() === 'owner').length;

          const searchSection = doc.createElement('div');
          searchSection.className = 'tp3d-org-members-section tp3d-org-members-search-section';

          const searchSectionTitle = doc.createElement('div');
          searchSectionTitle.className = 'tp3d-org-members-section-title';
          searchSectionTitle.textContent = 'Search & Filter';
          searchSection.appendChild(searchSectionTitle);

          const toolbar = doc.createElement('div');
          toolbar.className = 'tp3d-org-members-toolbar';

          const searchWrap = doc.createElement('div');
          searchWrap.className = 'tp3d-org-members-search-wrap';

          const searchIcon = doc.createElement('i');
          searchIcon.className = 'fa-solid fa-magnifying-glass tp3d-org-members-search-icon';
          searchIcon.setAttribute('aria-hidden', 'true');
          searchWrap.appendChild(searchIcon);

          const searchInput = doc.createElement('input');
          searchInput.type = 'search';
          searchInput.className = 'input tp3d-org-members-search';
          searchInput.placeholder = 'Search members by name or email';
          searchInput.value = orgMembersSearchQuery;
          searchInput.setAttribute('aria-label', 'Search members');
          searchWrap.appendChild(searchInput);
          toolbar.appendChild(searchWrap);

          const roleFilter = doc.createElement('select');
          roleFilter.className = 'select tp3d-org-members-filter';
          roleFilter.setAttribute('aria-label', 'Filter members by role');
          roleFilter.innerHTML = `
            <option value="all">All Roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          `;
          roleFilter.value = orgMembersRoleFilter;
          toolbar.appendChild(roleFilter);
          searchSection.appendChild(toolbar);
          membersCard.appendChild(searchSection);

          // ---- Invite form + pending invites (owner/admin only) ----
          {
            const inviteSection = doc.createElement('div');
            inviteSection.className = 'tp3d-org-members-section tp3d-org-invite-section';
            const inviteControlsDisabled = Boolean(membersDisabledReason || !canManage);

            const inviteSectionTitle = doc.createElement('div');
            inviteSectionTitle.className = 'tp3d-org-members-section-title';
            inviteSectionTitle.textContent = 'Invitations';
            inviteSection.appendChild(inviteSectionTitle);

            // Invite form
            const inviteForm = doc.createElement('div');
            inviteForm.className = 'tp3d-org-invite-form';

            const inviteEmailWrap = doc.createElement('div');
            inviteEmailWrap.className = 'tp3d-org-invite-email-wrap';

            const inviteEmailIcon = doc.createElement('i');
            inviteEmailIcon.className = 'fa-solid fa-envelope tp3d-org-invite-email-icon';
            inviteEmailIcon.setAttribute('aria-hidden', 'true');
            inviteEmailWrap.appendChild(inviteEmailIcon);

            const inviteEmailInput = doc.createElement('input');
            inviteEmailInput.type = 'email';
            inviteEmailInput.className = 'input tp3d-org-invite-email';
            inviteEmailInput.placeholder = 'Email address to invite';
            inviteEmailInput.setAttribute('aria-label', 'Invite email');
            inviteEmailInput.disabled = inviteControlsDisabled;
            inviteEmailWrap.appendChild(inviteEmailInput);
            inviteForm.appendChild(inviteEmailWrap);

            const inviteRoleSelect = doc.createElement('select');
            inviteRoleSelect.className = 'select tp3d-org-invite-role';
            inviteRoleSelect.setAttribute('aria-label', 'Invite role');
            inviteRoleSelect.disabled = inviteControlsDisabled;
            inviteRoleSelect.innerHTML = `
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            `;
            inviteForm.appendChild(inviteRoleSelect);

            const inviteBtn = doc.createElement('button');
            inviteBtn.type = 'button';
            inviteBtn.className = 'btn btn-primary tp3d-org-invite-btn';
            inviteBtn.textContent = '+ Invite';
            inviteBtn.disabled = inviteControlsDisabled;
            inviteBtn.addEventListener('click', () => {
              if (inviteControlsDisabled) return;
              const email = inviteEmailInput.value.trim().toLowerCase();
              if (!email || !email.includes('@')) {
                UIComponents.showToast('Enter a valid email address.', 'warning', { title: 'Invites' });
                return;
              }
              const role = inviteRoleSelect.value || 'member';
              inviteBtn.disabled = true;
              inviteBtn.textContent = 'Sending…';
              sendInvite(orgId, email, role).then(() => {
                inviteEmailInput.value = '';
                inviteBtn.disabled = false;
                inviteBtn.textContent = '+ Invite';
              }).catch(() => {
                inviteBtn.disabled = false;
                inviteBtn.textContent = '+ Invite';
              });
            });
            inviteForm.appendChild(inviteBtn);
            inviteSection.appendChild(inviteForm);

            if (inviteControlsDisabled) {
              const inviteHelper = doc.createElement('div');
              inviteHelper.className = 'muted tp3d-members-inline-helper';
              inviteHelper.textContent = membersDisabledReason || 'Only owners/admins can manage members';
              inviteSection.appendChild(inviteHelper);
            }

            // Pending invites table
            const pendingInvites = Array.isArray(orgInvitesData)
              ? orgInvitesData.filter(i => i && i.status === 'pending')
              : [];

            if (isLoadingOrgInvites && !orgInvitesData) {
              const skeletonInvites = doc.createElement('div');
              skeletonInvites.className = 'tp3d-skeleton-group';
              skeletonInvites.innerHTML = '<div class="tp3d-skeleton tp3d-skeleton-short"></div>';
              inviteSection.appendChild(skeletonInvites);
            } else if (orgInvitesError) {
              const inviteError = doc.createElement('div');
              inviteError.className = 'tp3d-org-feedback tp3d-org-feedback--error';
              inviteError.textContent = `Failed to load invites. ${
                orgInvitesError && orgInvitesError.message ? orgInvitesError.message : 'Try again.'
              }`;
              inviteSection.appendChild(inviteError);
            } else if (pendingInvites.length > 0) {
              const inviteLabel = doc.createElement('div');
              inviteLabel.className = 'tp3d-org-invite-label';
              inviteLabel.textContent = 'Pending Invites (' + pendingInvites.length + ')';
              inviteSection.appendChild(inviteLabel);

              const inviteTableWrap = doc.createElement('div');
              inviteTableWrap.className = 'tp3d-org-members-table-wrap tp3d-org-invite-table-wrap';

              const inviteTable = doc.createElement('table');
              inviteTable.className = 'tp3d-org-members-table';

              const inviteThead = doc.createElement('thead');
              const inviteHeadRow = doc.createElement('tr');
              ['Email', 'Role', 'Invited', 'Status', 'Actions'].forEach(label => {
                const th = doc.createElement('th');
                th.textContent = label;
                inviteHeadRow.appendChild(th);
              });
              inviteThead.appendChild(inviteHeadRow);
              inviteTable.appendChild(inviteThead);

              const inviteTbody = doc.createElement('tbody');
              const inviteRows = [];

              pendingInvites.forEach(invite => {
                const inviteId = String(invite.id || '');
                const isBusyInvite = orgInviteActions.has(inviteId);
                const tr = doc.createElement('tr');
                tr.dataset.memberSearch = String(invite.email || '').toLowerCase();
                tr.dataset.memberRole = String(invite.role || 'member').toLowerCase();

                const emailTd = doc.createElement('td');
                emailTd.textContent = invite.email || '—';
                tr.appendChild(emailTd);

                const roleTd = doc.createElement('td');
                const roleBadge = doc.createElement('span');
                roleBadge.className = 'badge tp3d-org-member-role-badge';
                roleBadge.textContent = getRoleLabel(invite.role);
                roleTd.appendChild(roleBadge);
                tr.appendChild(roleTd);

                const invitedTd = doc.createElement('td');
                invitedTd.className = 'tp3d-org-member-joined';
                invitedTd.textContent = invite.invited_at
                  ? new Date(invite.invited_at).toLocaleDateString()
                  : '—';
                tr.appendChild(invitedTd);

                const statusTd = doc.createElement('td');
                const statusBadge = doc.createElement('span');
                statusBadge.className = 'badge badge--pending';
                statusBadge.textContent = 'Pending';
                statusTd.appendChild(statusBadge);
                tr.appendChild(statusTd);

                const actionsTd = doc.createElement('td');
                actionsTd.className = 'tp3d-org-members-actions-cell';
                const actionsWrap = doc.createElement('div');
                actionsWrap.className = 'tp3d-org-member-actions';

                const resendBtn = doc.createElement('button');
                resendBtn.type = 'button';
                resendBtn.className = 'btn btn-ghost';
                resendBtn.textContent = 'Resend';
                resendBtn.disabled = isBusyInvite || inviteControlsDisabled;
                resendBtn.addEventListener('click', () => {
                  if (inviteControlsDisabled) return;
                  resendBtn.disabled = true;
                  resendBtn.textContent = 'Sending…';
                  resendInvite(orgId, invite).finally(() => {
                    resendBtn.disabled = false;
                    resendBtn.textContent = 'Resend';
                  });
                });
                actionsWrap.appendChild(resendBtn);

                const revokeBtn = doc.createElement('button');
                revokeBtn.type = 'button';
                revokeBtn.className = 'btn btn-danger';
                revokeBtn.textContent = 'Revoke';
                revokeBtn.disabled = isBusyInvite || inviteControlsDisabled;
                revokeBtn.addEventListener('click', () => {
                  if (inviteControlsDisabled) return;
                  UIComponents.confirm({
                    title: 'Revoke invite',
                    message: 'Revoke the pending invite to ' + invite.email + '?',
                    okLabel: 'Revoke',
                    cancelLabel: 'Cancel',
                    danger: true,
                  }).then(ok => {
                    if (ok) revokeInvite(orgId, invite);
                  });
                });
                actionsWrap.appendChild(revokeBtn);

                actionsTd.appendChild(actionsWrap);
                tr.appendChild(actionsTd);
                inviteTbody.appendChild(tr);
                inviteRows.push(tr);
              });

              inviteTable.appendChild(inviteTbody);
              inviteTableWrap.appendChild(inviteTable);
              inviteSection.appendChild(inviteTableWrap);
            } else {
              const noInvites = doc.createElement('div');
              noInvites.className = 'tp3d-org-feedback tp3d-org-feedback--warning';
              noInvites.textContent = 'No pending invites.';
              inviteSection.appendChild(noInvites);
            }

            membersCard.appendChild(inviteSection);
          }

          if (members.length === 0) {
            const msg = doc.createElement('div');
            msg.className = 'muted';
            msg.textContent = 'No members found for this workspace.';
            membersCard.appendChild(msg);
          } else {
            const tableWrap = doc.createElement('div');
            tableWrap.className = 'tp3d-org-members-table-wrap';

            const table = doc.createElement('table');
            table.className = 'tp3d-org-members-table';

            const thead = doc.createElement('thead');
            const headRow = doc.createElement('tr');
            ['Name', 'Email', 'Role', 'Joined', 'Actions'].forEach(label => {
              const th = doc.createElement('th');
              th.textContent = label;
              headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = doc.createElement('tbody');
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            membersCard.appendChild(tableWrap);

            const emptyFilteredState = doc.createElement('div');
            emptyFilteredState.className = 'muted tp3d-org-members-empty';
            emptyFilteredState.textContent = 'No members match your current filters.';
            emptyFilteredState.hidden = true;
            membersCard.appendChild(emptyFilteredState);

            const rows = [];
            members.forEach(member => {
              if (!member || !member.user_id) return;
              const userId = String(member.user_id);
              const role = String(member.role || 'member').toLowerCase();
              const memberName = getMemberDisplayName(member);
              const memberEmail = getMemberEmail(member);
              const isSelf = Boolean(currentUserId && currentUserId === userId);
              const isOwnerMember = role === 'owner';
              const isAdminMember = role === 'admin';
              const isLastOwner = isOwnerMember && ownersCount <= 1;
              const isBusy = orgMemberActions.has(userId);

              let canEditRole = canManage && !isBusy;
              if (!canManageAdmins && (isOwnerMember || isAdminMember)) canEditRole = false;
              if (isSelf && isLastOwner) canEditRole = false;

              let canRemove = canManage && !isBusy;
              if (isSelf) canRemove = false;
              if (isOwnerMember && ownersCount <= 1) canRemove = false;
              if (!canManageAdmins && (isOwnerMember || isAdminMember)) canRemove = false;

              const tr = doc.createElement('tr');
              tr.dataset.memberRole = role;
              tr.dataset.memberSearch = `${memberName} ${memberEmail}`.toLowerCase();

              const nameCell = doc.createElement('td');
              const nameWrap = doc.createElement('div');
              nameWrap.className = 'tp3d-org-member-name-row';
              const name = doc.createElement('div');
              name.className = 'tp3d-org-member-name';
              name.textContent = memberName;
              nameWrap.appendChild(name);
              if (isSelf) {
                const badge = doc.createElement('span');
                badge.className = 'badge tp3d-org-member-you-badge';
                badge.textContent = 'You';
                nameWrap.appendChild(badge);
              }
              nameCell.appendChild(nameWrap);
              tr.appendChild(nameCell);

              const emailCell = doc.createElement('td');
              emailCell.className = 'tp3d-org-member-email';
              emailCell.textContent = memberEmail || '—';
              tr.appendChild(emailCell);

              const roleCell = doc.createElement('td');
              const roleBadge = doc.createElement('span');
              roleBadge.className = 'badge tp3d-org-member-role-badge';
              roleBadge.textContent = getRoleLabel(role);
              roleCell.appendChild(roleBadge);
              tr.appendChild(roleCell);

              const joinedCell = doc.createElement('td');
              joinedCell.className = 'tp3d-org-member-joined';
              joinedCell.textContent = formatMemberJoined(member);
              tr.appendChild(joinedCell);

              const actionsCell = doc.createElement('td');
              actionsCell.className = 'tp3d-org-members-actions-cell';
              const actions = doc.createElement('div');
              actions.className = 'tp3d-org-member-actions';

              const roleSelect = doc.createElement('select');
              roleSelect.className = 'select tp3d-org-member-role-select';
              roleSelect.setAttribute('aria-label', `Role for ${memberName}`);
              const roles = ['owner', 'admin', 'member'];
              roles.forEach(r => {
                const opt = doc.createElement('option');
                opt.value = r;
                opt.textContent = getRoleLabel(r);
                if (r === 'owner' && !isOwner) opt.disabled = true;
                roleSelect.appendChild(opt);
              });
              if (!roles.includes(role)) {
                const opt = doc.createElement('option');
                opt.value = role;
                opt.textContent = getRoleLabel(role);
                roleSelect.appendChild(opt);
              }
              roleSelect.value = role;
              roleSelect.disabled = Boolean(membersDisabledReason || !canEditRole);
              roleSelect.addEventListener('change', ev => {
                const target = ev.target instanceof HTMLSelectElement ? ev.target : null;
                const nextRole = target ? String(target.value) : role;
                if (nextRole === role) return;
                if (nextRole === 'owner' && !isOwner) {
                  UIComponents.showToast('Only owners can promote members to owner.', 'warning');
                  roleSelect.value = role;
                  return;
                }
                if (membersDisabledReason || !canEditRole) {
                  roleSelect.value = role;
                  return;
                }
                updateMemberRole(orgId, member, nextRole, currentUserId).catch(() => {
                  roleSelect.value = role;
                });
              });
              actions.appendChild(roleSelect);

              const removeBtn = doc.createElement('button');
              removeBtn.type = 'button';
              removeBtn.className = 'btn btn-danger tp3d-org-member-remove-btn';
              removeBtn.textContent = 'Remove';
              removeBtn.disabled = Boolean(membersDisabledReason || !canRemove);
              removeBtn.addEventListener('click', () => {
                if (membersDisabledReason || !canRemove) return;
                UIComponents.confirm({
                  title: 'Remove member',
                  message: `Remove ${memberName} from this workspace?`,
                  okLabel: 'Remove',
                  cancelLabel: 'Cancel',
                  danger: true,
                }).then(ok => {
                  if (ok) removeMember(orgId, member);
                });
              });
              actions.appendChild(removeBtn);

              actionsCell.appendChild(actions);

              tr.appendChild(actionsCell);
              tbody.appendChild(tr);
              rows.push(tr);
            });

            const applyMemberFilters = () => {
              const searchQuery = String(orgMembersSearchQuery || '')
                .trim()
                .toLowerCase();
              const roleFilterValue = String(orgMembersRoleFilter || 'all').toLowerCase();
              let visibleCount = 0;
              // Filter member rows
              rows.forEach(rowEl => {
                const rowSearch = String(rowEl.dataset.memberSearch || '');
                const rowRole = String(rowEl.dataset.memberRole || '').toLowerCase();
                const matchesSearch = !searchQuery || rowSearch.includes(searchQuery);
                const matchesRole = roleFilterValue === 'all' || rowRole === roleFilterValue;
                const visible = matchesSearch && matchesRole;
                rowEl.hidden = !visible;
                if (visible) visibleCount += 1;
              });
              // Also filter invite rows (in the invite table) by the same criteria
              const inviteTableRows = membersCard.querySelectorAll('.tp3d-org-invite-section tbody tr');
              let inviteVisibleCount = 0;
              inviteTableRows.forEach(rowEl => {
                const rowElement = rowEl instanceof HTMLElement ? rowEl : null;
                if (!rowElement) return;
                const rowSearch = String(rowElement.dataset.memberSearch || '');
                const rowRole = String(rowElement.dataset.memberRole || '').toLowerCase();
                const matchesSearch = !searchQuery || rowSearch.includes(searchQuery);
                const matchesRole = roleFilterValue === 'all' || rowRole === roleFilterValue;
                const visible = matchesSearch && matchesRole;
                rowElement.hidden = !visible;
                if (visible) inviteVisibleCount += 1;
              });
              const inviteTableWrap = membersCard.querySelector('.tp3d-org-invite-table-wrap');
              const inviteWrapEl = inviteTableWrap instanceof HTMLElement ? inviteTableWrap : null;
              if (inviteWrapEl) inviteWrapEl.hidden = inviteVisibleCount === 0;
              emptyFilteredState.hidden = (visibleCount + inviteVisibleCount) > 0;
              tableWrap.hidden = visibleCount === 0;
            };

            searchInput.addEventListener('input', () => {
              orgMembersSearchQuery = searchInput.value || '';
              applyMemberFilters();
            });
            roleFilter.addEventListener('change', () => {
              orgMembersRoleFilter = roleFilter.value || 'all';
              applyMemberFilters();
            });

            applyMemberFilters();
          }
        }
      }
      body.appendChild(membersCard);
    } else {
      const billingCard = doc.createElement('div');
      billingCard.className = 'card';
      billingCard.classList.add('tp3d-settings-card-max');

      const billingWrap = doc.createElement('div');
      billingWrap.classList.add('tp3d-settings-billing');
      billingWrap.id = 'tp3d-billing-wrap';
      billingWrap.textContent = 'Loading billing…';

      billingCard.appendChild(billingWrap);
      body.appendChild(billingCard);

      renderBillingInto(billingWrap);
      ensureBillingSubscription();
    }
    const counts = applyTabStateToDOM();
    debug('render', {
      tabId: _tabState.activeTabId,
      actionId: _tabState.lastActionId,
      instanceId: settingsInstanceId,
      buttonCount: counts.buttonCount,
      panelCount: counts.panelCount,
    });
    debugTabSnapshot('render');
    debugSettingsModalSnapshot('render');
    return counts;
  }

  function open(tab) {
    cleanupStaleSettingsModals('open');
    if (!modalOrgId) {
      modalOrgId = resolveInitialModalOrgId();
    }
    clearOrgScopedCaches(modalOrgId);
    const nextTab = resolveInitialTab(tab);
    if (settingsOverlay && settingsOverlay.isConnected) {
      ensureOrgChangedListener();
      setActiveTab(nextTab, { source: 'open', actionId: _tabState.lastActionId });
      debugSettingsModalSnapshot('open:reuse');
      debugTabSnapshot('open:reuse');
      if (profileData || membershipData || orgData) {
        queueAccountBundleRefresh({ force: true, source: 'open:reuse-refresh' });
      }
      return;
    }
    if (settingsOverlay && !settingsOverlay.isConnected) {
      settingsOverlay = null;
      settingsModal = null;
      settingsLeftPane = null;
      settingsRightPane = null;
      tabClickHandler = null;
      _tabState.didBind = false;
    }

    const activeEl = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    lastFocusedEl = activeEl && typeof activeEl.focus === 'function' ? activeEl : null;

    settingsOverlay = doc.createElement('div');
    settingsOverlay.className = 'modal-overlay';

    settingsModal = doc.createElement('div');
    settingsModal.className = 'modal';
    settingsModal.classList.add('tp3d-settings-modal');
    const instanceId = nextSettingsInstanceId();
    settingsModal.setAttribute(SETTINGS_MODAL_ATTR, '1');
    settingsModal.setAttribute(SETTINGS_INSTANCE_ATTR, String(instanceId));
    settingsModal.setAttribute('role', 'dialog');
    settingsModal.setAttribute('aria-modal', 'true');
    settingsModal.setAttribute('tabindex', '-1');

    settingsLeftPane = doc.createElement('div');
    settingsLeftPane.classList.add('tp3d-settings-left-pane');

    settingsRightPane = doc.createElement('div');
    settingsRightPane.classList.add('tp3d-settings-right-pane');

    settingsModal.appendChild(settingsLeftPane);
    settingsModal.appendChild(settingsRightPane);
    settingsOverlay.appendChild(settingsModal);

    settingsOverlay.addEventListener('click', ev => {
      if (ev.target === settingsOverlay) close();
    });

    trapKeydownHandler = ev => {
      if (ev.key === 'Escape') {
        close();
        return;
      }

      if (ev.key !== 'Tab') return;
      if (!settingsModal) return;
      const focusables = Array.from(
        settingsModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusables.length) {
        ev.preventDefault();
        settingsModal.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = doc.activeElement;
      if (ev.shiftKey) {
        if (active === first || active === settingsModal) {
          ev.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    doc.addEventListener('keydown', trapKeydownHandler, true);

    const root = doc.getElementById('modal-root');
    if (root) {
      root.appendChild(settingsOverlay);
    } else {
      if (!warnedMissingModalRoot) {
        console.warn('Settings overlay: #modal-root not found, falling back to document.body');
        warnedMissingModalRoot = true;
      }
      doc.body.appendChild(settingsOverlay);
    }

    doc.body.classList.add('modal-open');

    settingsOverlay._tp3dCleanup = () => {
      if (trapKeydownHandler) {
        doc.removeEventListener('keydown', trapKeydownHandler, true);
      }
    };

    ensureOrgChangedListener();
    bindTabsOnce();
    setActiveTab(nextTab, { source: 'open', actionId: _tabState.lastActionId });
    debugSettingsModalSnapshot('open:created');
    debugTabSnapshot('open:created');
    if (profileData || membershipData || orgData) {
      queueAccountBundleRefresh({ force: true, source: 'open:created-refresh' });
    }

    const focusTarget = /** @type {HTMLElement|null} */ (
      settingsModal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
    (focusTarget || settingsModal).focus();
  }

  function init() {
    // No-op; settings overlay is constructed lazily on demand.
  }

  function refreshAccountUI() {
    if (isOpen()) render();
  }

  /**
   * Clear all cached user-specific data.
   * MUST be called when auth state changes to prevent stale data from previous user.
   */
  function clearCachedUserData() {
    // FIX: Clear profile cache to prevent showing old user's data after user switch
    profileData = null;
    isEditingProfile = false;
    isLoadingProfile = false;
    isSavingProfile = false;
    isUploadingAvatar = false;

    // FIX: Clear organization cache to prevent showing old user's org data
    orgData = null;
    membershipData = null;
    isEditingOrg = false;
    isLoadingOrg = false;
    isLoadingMembership = false;
    isSavingOrg = false;

    orgMembersData = null;
    isLoadingOrgMembers = false;
    orgMembersError = null;
    orgMembersRequestId = 0;
    orgInvitesData = null;
    isLoadingOrgInvites = false;
    orgInvitesError = null;
    orgInvitesRequestId = 0;
    lastOrgMembersOrgId = null;
    orgMemberActions.clear();
    orgInviteActions.clear();

    // FIX: Clear org logo overlay cache to prevent stale logo across user switches
    lastOrgLogoKey = null;
    lastOrgLogoUrl = null;
    lastOrgLogoExpiresAt = 0;
  }

  function handleAuthChange(_event) {
    try {
      if (_event === 'SIGNED_OUT') {
        clearCachedUserData();
        lastKnownUserId = null;
        return;
      }
      let currentUserId = null;
      try {
        const u = SupabaseClient && typeof SupabaseClient.getUser === 'function' ? SupabaseClient.getUser() : null;
        currentUserId = u && u.id ? String(u.id) : null;
      } catch {
        currentUserId = null;
      }
      if (currentUserId && lastKnownUserId && currentUserId !== lastKnownUserId) {
        clearCachedUserData();
      }
      if (currentUserId) lastKnownUserId = currentUserId;
      refreshAccountUI();
      if (isOpen() && (profileData || membershipData || orgData)) {
        queueAccountBundleRefresh({ force: true, source: 'auth-change-refresh' });
      }
    } catch {
      // ignore
    }
  }

  return { init, open, close, isOpen, setActive, render, refreshAccountUI, handleAuthChange };
}
