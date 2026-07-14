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
  revokeOrgInvite as revokeOrgInviteFn,
  updateOrgMemberRole as updateOrgMemberRoleFn,
  removeOrgMember as removeOrgMemberFn,
  transferOwnership as transferOwnershipFn,
  leaveWorkspace as leaveWorkspaceFn,
  restoreWorkspace as restoreWorkspaceFn,
  archiveWorkspace as archiveWorkspaceFn,
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
  onExportWorkspace: _onExportWorkspace,
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
  const _tabState = { activeTabId: 'preferences', didBind: false, lastActionId: 0, lastTabActionToken: 0 };
  let settingsInstanceId = 0;
  let settingsInstanceCounter = 0;
  let resourcesSubView = 'root'; // 'root' | 'updates' | 'roadmap' | 'export' | 'import' | 'help'
  let unmountAccountButton = null;
  let lastFocusedEl = null;
  let trapKeydownHandler = null;
  let warnedMissingModalRoot = false;
  let tabClickHandler = null;

  // ── Render entry points inventory ──
  // render()           – full DOM rebuild of left+right panes
  //   called from: setActiveTab, open (via setActiveTab), renderIfFresh,
  //     orgChangedHandler, setResourcesSubView, profile edit/cancel clicks,
  //     org-members refresh, promise chains (.then(()=>render())), refreshAccountUI
  // setActiveTab()     – sets tab state then calls render()
  //   called from: open, tabClickHandler (click), setActive (api)
  // open()             – creates/reuses overlay, calls setActiveTab
  // bindTabsOnce()     – binds click handler that calls setActiveTab
  // billing subscriber – calls renderBillingInto() only (NOT full render)
  // orgChangedHandler  – calls render() + loadOrgMembers->renderIfFresh

  const SETTINGS_TABS = new Set(['account', 'preferences', 'resources', 'org-general', 'org-members', 'org-billing']);
  const TAB_STORAGE_KEY = 'tp3d:settings:activeTab';
  const SETTINGS_MODAL_ATTR = 'data-tp3d-settings-modal';
  const SETTINGS_INSTANCE_ATTR = 'data-tp3d-settings-instance';
  const ORG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // ── Render-trace state (debug-only dedup) ──
  let _renderTraceSeq = 0;
  let _lastRenderSigHash = 0;
  let _lastRenderTabId = '';
  let _lastRenderActionId = -1;
  let _lastRenderAtMs = 0;
  let _lastRenderStableKey = '';
  let _lastOrgBillingRenderLfa = 0; // tracks lastFetchedAt of last org-billing render
  let _renderScheduled = false; // rAF coalescer flag
  let _deferredRender = null; // { source, tabToken } deferred while a render was in-flight; re-fired next frame
  let _tabActionToken = 0; // monotonic counter — incremented on every tab switch
  // ── Render epoch: split into overlay-level and tab-level ──
  // _overlayEpoch: bumped on open/close only — used by shared async (bundle, billing context)
  // _tabEpoch: bumped on open/close/setActiveTab — used by tab-specific async (members, invites)
  let _overlayEpoch = 0;
  let _tabEpoch = 0;
  let _renderEpoch = 0; // mirrors _tabEpoch for existing log compat
  function bumpEpoch(source) {
    const isTabSwitch = source && source.startsWith('setActiveTab:');
    _tabEpoch += 1;
    if (!isTabSwitch) {
      _overlayEpoch += 1;
    } else {
      // Tab switch: bump tab action token — all prior tab-scoped async becomes stale.
      _tabActionToken += 1;
      _tabState.lastTabActionToken = _tabActionToken;
    }
    _renderEpoch = _tabEpoch;
    debug('epoch:bump', { overlayEpoch: _overlayEpoch, tabEpoch: _tabEpoch, renderEpoch: _renderEpoch, tabActionToken: _tabActionToken, source });
    return _renderEpoch;
  }
  function getCurrentActionId() { return _tabState.lastActionId; }
  /** Capture overlay-level epoch for shared async work (survives tab switches). */
  function getOverlayEpoch() { return _overlayEpoch; }
  /** Capture tab-level epoch for tab-specific async (invalidated on tab switch). */
  function _getTabEpoch() { return _tabEpoch; }
  /** Get current tab action token. */
  function getTabActionToken() { return _tabState.lastTabActionToken; }
  /** Check if a captured tab action token is still current. */
  function isTokenCurrent(token) { return token === _tabState.lastTabActionToken && isOpen() && Boolean(settingsOverlay); }
  /**
   * Source-to-target-tab routing: maps async render sources to the tab they belong to.
   * Returns 'org-billing', 'org-members', or null (current-tab-safe / overlay-scoped).
   */
  function _getTargetTabForSource(source) {
    if (typeof source !== 'string') return null;
    if (source.startsWith('org-billing') || source.startsWith('billing-delayed-refresh') || source.startsWith('authGate:retry:billing')) return 'org-billing';
    if (source.startsWith('org-members') || source.startsWith('org-invites') || source.startsWith('members:') || source.startsWith('memberRole:') || source.startsWith('memberRemove:') || source.startsWith('invite:') || source.startsWith('authGate:retry:members')) return 'org-members';
    return null;
  }
  /** Tabs with pending repaint data that arrived after a tab switch (tabId → { source, token }). */
  const _pendingRepaintByTab = new Map();
  // Members auto-retry state: schedule retry when org becomes ready
  let _membersRetryCount = 0;
  let _membersRetryTimer = null;
  const _MEMBERS_MAX_RETRIES = 3;
  const _MEMBERS_BACKOFF = [200, 600, 1500];
  let _membersPermissionPendingSince = 0;
  let _membersPermissionPendingOrgId = '';
  const _MEMBERS_PERMISSION_TIMEOUT_MS = 10000;
  // ── Callsite tracing + dup-signal state ──
  let _callsiteLogCount = 0;
  const _dupSignalMap = new Map(); // key → lastTs
  // ── refreshAccountUI microtask coalescer ──
  let _refreshAccountUIQueued = false;
  let _refreshAccountUIPendingReason = null;
  let _lastRefreshAccountUIAtMs = 0;
  // ── Org-readiness grace window (suppress "no workspace" flash) ──
  let _overlayOpenedAtMs = 0;
  const _ORG_READY_GRACE_MS = 800;
  const _ORG_TAB_SET = new Set(['org-members', 'org-billing', 'org-general']);
  // ── Auth-ready gate for org-protected fetches ──
  let _lastRefreshSessionAtMs = 0;
  const _REFRESH_SESSION_COOLDOWN_MS = 10000;
  let _authGatePendingRetry = false; // true when a fetch was skipped and needs retry on auth-ready
  // ── Auth-change dedupe: ignore same-user SIGNED_IN repeats within 3s ──
  let _lastAuthChangeKey = '';
  let _lastAuthChangeAtMs = 0;
  const _AUTH_CHANGE_DEDUPE_MS = 5000;
  let _lastAuthSnapshot = null;
  let _lastOrgChangeEpochSeen = 0;
  let _lastOrgChangeTsSeen = 0;

  /** Return the Supabase per-tab id for cross-tab debug correlation. */
  function getDebugTabId() {
    try {
      if (SupabaseClient && typeof SupabaseClient.getTabId === 'function') {
        const id = SupabaseClient.getTabId();
        if (id) return String(id);
      }
    } catch { /* ignore */ }
    try {
      const id = window.sessionStorage && window.sessionStorage.getItem('__tp3d_tab');
      if (id) return String(id);
    } catch { /* ignore */ }
    return 'unknown';
  }

  function debugEnabled() {
    try {
      if (window.localStorage && window.localStorage.getItem('tp3dDebug') === '1') return true;
    } catch { /* ignore */ }
    try {
      if (typeof URLSearchParams !== 'undefined' && new URLSearchParams(location.search).get('tp3dDebug') === '1') return true;
    } catch { /* ignore */ }
    try {
      if (window.sessionStorage && window.sessionStorage.getItem('tp3dDebug') === '1') return true;
    } catch { /* ignore */ }
    return false;
  }

  function debug(message, data) {
    if (!debugEnabled()) return;
    try {
      const enriched = {
        tabId: getDebugTabId(),
        overlayOpen: Boolean(settingsOverlay),
        modalConnected: Boolean(settingsOverlay && settingsOverlay.isConnected),
        ...data,
      };
      console.log('[SettingsOverlay]', message, enriched);
    } catch {
      // ignore
    }
  }

  /** Debug helper: log render call site with compact stack (first 10 per open) */
  let _debugRenderCallCount = 0;
  function debugRenderCall(source, extra) {
    if (!debugEnabled()) return;
    _debugRenderCallCount += 1;
    const payload = {
      source,
      instanceId: settingsInstanceId,
      activeTabId: _tabState.activeTabId,
      lastActionId: _tabState.lastActionId,
      tabId: getDebugTabId(),
      overlayOpen: Boolean(settingsOverlay),
      modalConnected: Boolean(settingsOverlay && settingsOverlay.isConnected),
      ts: Date.now(),
      ...extra,
    };
    if (_debugRenderCallCount <= 10) {
      try {
        const st = (new Error()).stack || '';
        payload.stack = st.split('\n').filter(l => l.trim()).slice(1, 4).map(f => f.trim());
      } catch { /* ignore */ }
    }
    debug('renderCall', payload);
  }

  /** Log callsite with stack (first 10 per open) + dup-signal within 25ms */
  function _debugCallsite(fnName, extra) {
    if (!debugEnabled()) return;
    _callsiteLogCount += 1;
    const now = Date.now();
    const payload = {
      fn: fnName,
      instanceId: settingsInstanceId,
      activeTabId: _tabState.activeTabId,
      lastActionId: _tabState.lastActionId,
      tabId: getDebugTabId(),
      overlayOpen: Boolean(settingsOverlay),
      modalConnected: Boolean(settingsOverlay && settingsOverlay.isConnected),
      ts: now,
      ...extra,
    };
    if (_callsiteLogCount <= 10) {
      try {
        const st = (new Error()).stack || '';
        payload.stack = st.split('\n').filter(l => l.trim()).slice(1, 6).map(f => f.trim());
      } catch { /* ignore */ }
    }
    debug(fnName + ':callsite', payload);
    // dup-signal detection
    const key = `${fnName}|${_tabState.activeTabId}|${_tabState.lastActionId}`;
    const prev = _dupSignalMap.get(key);
    if (prev && (now - prev) < 25) {
      debug('dup-signal', { key, dtMs: now - prev, source: fnName, tabId: _tabState.activeTabId, actionId: _tabState.lastActionId, instanceId: settingsInstanceId });
    }
    _dupSignalMap.set(key, now);
    // Prevent map from growing unbounded
    if (_dupSignalMap.size > 50) {
      const oldest = _dupSignalMap.keys().next().value;
      _dupSignalMap.delete(oldest);
    }
  }

  /**
   * Auth-ready gate: ensures a valid JWT is available before making org-protected
   * API calls. Waits for Supabase cross-tab sync, then optionally refreshes session
   * once per _REFRESH_SESSION_COOLDOWN_MS.
   * @param {string} reason - Caller label for debug logs
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<{ ok: boolean, hasUserJwt: boolean, code?: string }>}
   */
  async function ensureAuthReadyForOrgOps(reason, { timeoutMs = 2500 } = {}) {
    debug('authReady:start', { reason, activeTabId: _tabState.activeTabId });
    // Fast path: check synchronous session first
    try {
      const sess = SupabaseClient.getSession && SupabaseClient.getSession();
      if (sess && sess.access_token) {
        debug('authReady:ok', { reason, path: 'sync' });
        return { ok: true, hasUserJwt: true };
      }
    } catch { /* ignore */ }

    // Wait for cross-tab token sync via Supabase's awaitAuthReady
    debug('authReady:wait', { reason, timeoutMs });
    try {
      if (SupabaseClient && typeof SupabaseClient.awaitAuthReady === 'function') {
        const result = await SupabaseClient.awaitAuthReady({ timeoutMs });
        if (result && result.ok) {
          debug('authReady:ok', { reason, path: 'awaitAuthReady' });
          return { ok: true, hasUserJwt: true };
        }
        if (result && result.reason === 'signed_out') {
          debug('authReady:fail', { reason, code: 'SIGNED_OUT' });
          return { ok: false, hasUserJwt: false, code: 'SIGNED_OUT' };
        }
      }
    } catch { /* ignore */ }

    // One refreshSession attempt per cooldown window
    const now = Date.now();
    if (now - _lastRefreshSessionAtMs >= _REFRESH_SESSION_COOLDOWN_MS) {
      _lastRefreshSessionAtMs = now;
      debug('authReady:refreshSession', { reason });
      try {
        if (SupabaseClient && typeof SupabaseClient.refreshSession === 'function') {
          const refreshed = await SupabaseClient.refreshSession();
          if (refreshed && refreshed.access_token) {
            debug('authReady:ok', { reason, path: 'refreshSession' });
            return { ok: true, hasUserJwt: true };
          }
        }
      } catch { /* ignore */ }
    }

    debug('authReady:fail', { reason, code: 'NO_TOKEN' });
    return { ok: false, hasUserJwt: false, code: 'NO_TOKEN' };
  }

  /** djb2 non-crypto hash for render signature dedup */
  function _djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return h;
  }

  function normalizeOrgId(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === 'personal') return '';
    return ORG_UUID_RE.test(raw) ? raw : '';
  }

  function parseEpochValue(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  function getCurrentAuthUserId() {
    try {
      const user = SupabaseClient && typeof SupabaseClient.getUser === 'function'
        ? SupabaseClient.getUser()
        : null;
      return user && user.id ? String(user.id) : '';
    } catch {
      return '';
    }
  }

  /**
   * @param {unknown} value
   * @returns {'month'|'year'}
   */
  function normalizeInterval(value) {
    return String(value || '').trim().toLowerCase() === 'year' ? 'year' : 'month';
  }

  function normalizeEntitlementStatus(value) {
    const raw = String(value || '').trim().toLowerCase();
    return [
      'active',
      'trialing',
      'trial_expired',
      'included_in_plan',
      'workspace_limit_reached',
      'owner_subscription_required',
      'billing_unavailable',
    ].includes(raw) ? raw : '';
  }

  function _escapeHtml(value) {
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

  function renderIfFresh(actionId, source, tabEpoch, overlayEpoch, tabToken) {
    _debugCallsite('renderIfFresh', { source, actionId, tabEpoch, overlayEpoch, tabToken });

    // ── Overlay closed guard (Rule B) ──
    if (!isOpen() || !settingsOverlay) {
      debug('overlay-closed:drop', { source, gate: 'renderIfFresh' });
      return null;
    }

    // ── Tab action token guard: if a tab-scoped token was provided, enforce it first ──
    if (typeof tabToken === 'number' && !isTokenCurrent(tabToken)) {
      debug('stale-token:drop', { source, tabToken, currentToken: _tabState.lastTabActionToken });
      return null;
    }
    if (typeof actionId === 'number' && actionId < _tabState.lastActionId) {
      debug('render skipped (stale)', { source, actionId, lastActionId: _tabState.lastActionId });
      return null;
    }
    // If overlayEpoch provided, check overlay-level (shared async survives tab switches)
    if (typeof overlayEpoch === 'number') {
      if (overlayEpoch !== _overlayEpoch) {
        debug('render skipped (overlayEpoch)', { source, overlayEpoch, currentOverlayEpoch: _overlayEpoch });
        return null;
      }
    } else if (typeof tabEpoch === 'number' && tabEpoch !== _renderEpoch) {
      // Also enforce token for pending repaint writes — stale tokens must not pollute the Map.
      if (typeof tabToken === 'number' && !isTokenCurrent(tabToken)) {
        debug('stale-token:drop', { source, tabToken, currentToken: _tabState.lastTabActionToken, gate: 'pending-repaint' });
        return null;
      }
      // Route tab-scoped sources to pending repaint via _getTargetTabForSource.
      const _targetTab = _getTargetTabForSource(source);
      const _token = typeof tabToken === 'number' ? tabToken : getTabActionToken();
      if (_targetTab) {
        _pendingRepaintByTab.set(_targetTab, { source, token: _token });
        debug('wrong-tab:queue-repaint', { source, targetTab: _targetTab, activeTab: _tabState.activeTabId, token: _token, gate: 'epoch-mismatch' });
        // If we're already ON the target tab, apply in-place on the next frame
        if (_tabState.activeTabId === _targetTab) {
          _pendingRepaintByTab.delete(_targetTab);
          const _applyToken = _token;
          requestAnimationFrame(() => {
            if (isTokenCurrent(_applyToken) && _tabState.activeTabId === _targetTab && isOpen()) {
              debug('pendingRepaint:apply-in-place', { source, token: _applyToken });
              render({ source: 'pendingRepaint:' + _targetTab + ':in-place', tabToken: _applyToken });
            }
          });
        }
      } else {
        debug('render skipped (epoch)', { source, tabEpoch, currentEpoch: _renderEpoch });
      }
      return null;
    }

    // ── Source-to-target-tab routing (Rule A): prevent wrong-tab render ──
    const _routeTarget = _getTargetTabForSource(source);
    if (_routeTarget && _routeTarget !== _tabState.activeTabId) {
      const _token = typeof tabToken === 'number' ? tabToken : getTabActionToken();
      _pendingRepaintByTab.set(_routeTarget, { source, token: _token });
      debug('wrong-tab:queue-repaint', { source, targetTab: _routeTarget, activeTab: _tabState.activeTabId, token: _token });
      return null;
    }

    return render({ source: 'renderIfFresh:' + source, tabToken: typeof tabToken === 'number' ? tabToken : undefined });
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
  let _leaveWorkspaceInFlight = false;
  let _archiveWorkspaceInFlight = false;
  let _transferOwnershipInFlight = false;
  const restoreWorkspaceActions = new Set();
  let archivedWorkspacesData = null;
  let isLoadingArchivedWorkspaces = false;
  let archivedWorkspacesError = null;
  let archivedWorkspacesRequestId = 0;
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
  let orgInvitesInflightOrgId = null;
  let orgInvitesInflightPromise = null;
  let lastOrgInvitesOrgId = null;
  const orgInviteActions = new Set(); // invite IDs currently being acted on
  let lastKnownUserId = null;
  let lastBundleRefreshAt = 0;
  let _bundlePartialRetryCount = 0;
  let billingUnsubscribe = null;
  let billingSubscriptionToken = 0;
  let modalOrgId = '';
  let selectedInterval = 'month';
  let orgChangedHandler = null;
  let orgAccessLostHandler = null;
  let _orgAccessLostId = '';
  let workspaceSwitchHandler = null;
  let lastOrgLogoKey = null;
  let lastOrgLogoUrl = null;
  let lastOrgLogoExpiresAt = 0;
  const ORG_LOGO_CACHE_TTL_MS = 5 * 60 * 1000;

  /**
   * Call the billing pump with a retry loop.
   * If window.TruckPackerApp.maybeScheduleBillingRefresh is not yet available,
   * retries up to `retries` times at `delayMs` intervals.
   */
  function _callBillingPumpWithRetry(reason, { retries = 10, delayMs = 250 } = {}) {
    let attempt = 0;
    const tick = () => {
      attempt += 1;
      const pump = typeof window !== 'undefined' && window.TruckPackerApp
        && typeof window.TruckPackerApp.maybeScheduleBillingRefresh === 'function'
        ? window.TruckPackerApp.maybeScheduleBillingRefresh : null;
      if (pump) {
        pump(reason);
        return;
      }
      if (attempt < retries) {
        setTimeout(tick, delayMs);
      } else {
        debug('billing-pump-retry:gave-up', { reason, retries });
      }
    };
    tick();
  }

  const BILLING_CONTEXT_RETRY_MS = 2500;
  let billingContextInflightPromise = null;
  let billingContextInflightOrgId = '';
  let billingContextStartingOrgId = '';
  let billingContextLastAttemptAt = 0;
  let billingContextResolvedOrgId = '';

  // Account bundle loading state (single request for all account data)
  let isLoadingAccountBundle = false;
  let accountBundleRequestId = 0; // "Last request wins" guard
  let accountBundleRefreshQueued = false;
  let accountBundleQueuedForce = false;
  let accountBundleConfirmedNoActiveWorkspace = false;
  let _sameOrgRehydrateInflight = false; // single-flight guard for same-org forced rehydrate

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

  function isConfirmedNoActiveWorkspaceBundle(bundle) {
    return Boolean(
      bundle &&
      bundle.user &&
      bundle.partial !== true &&
      Array.isArray(bundle.orgs) &&
      bundle.orgs.length === 0 &&
      !bundle.activeOrgId
    );
  }

  function getOrgIdFromLastActiveBundle() {
    try {
      const bundle = typeof window !== 'undefined' ? window.__TP3D_LAST_ACCOUNT_BUNDLE || null : null;
      if (!bundle || bundle.partial === true || !Array.isArray(bundle.orgs) || bundle.orgs.length === 0) {
        return '';
      }
      const orgs = bundle.orgs;
      const hasOrg = orgId => {
        const normalizedOrgId = normalizeOrgId(orgId);
        return Boolean(normalizedOrgId && orgs.some(org => org && String(org.id) === normalizedOrgId));
      };
      const activeOrgId = normalizeOrgId(bundle.activeOrgId || '');
      if (hasOrg(activeOrgId)) return activeOrgId;
      const localOrgId = getOrgIdFromLocalStorage();
      if (hasOrg(localOrgId)) return localOrgId;
      return normalizeOrgId(orgs[0] && orgs[0].id ? orgs[0].id : '');
    } catch {
      // ignore
    }
    return '';
  }

  function resolveInitialModalOrgId() {
    if (accountBundleConfirmedNoActiveWorkspace) return '';
    try {
      if (typeof window !== 'undefined' && isConfirmedNoActiveWorkspaceBundle(window.__TP3D_LAST_ACCOUNT_BUNDLE || null)) {
        return '';
      }
    } catch {
      // ignore
    }
    const orgContextId = getOrgIdFromOrgContext();
    if (orgContextId) return orgContextId;
    const localOrgId = getOrgIdFromLocalStorage();
    const billingOrgId = getOrgIdFromBillingState();
    if (billingOrgId && localOrgId && billingOrgId === localOrgId) return billingOrgId;
    const bundleOrgId = getOrgIdFromLastActiveBundle();
    if (bundleOrgId) return bundleOrgId;
    return localOrgId || '';
  }

  function ensureModalOrgId() {
    if (!modalOrgId) {
      modalOrgId = resolveInitialModalOrgId();
    }
    return modalOrgId;
  }

  function isLockedOrgAccessLost(orgId = ensureModalOrgId()) {
    const lockedOrgId = normalizeOrgId(orgId);
    return Boolean(lockedOrgId && _orgAccessLostId && _orgAccessLostId === lockedOrgId);
  }

  function appendOrgAccessLostNotice(targetEl, source = 'org-access-lost') {
    if (!targetEl) return;
    const lostMsg = doc.createElement('div');
    lostMsg.className = 'tp3d-org-feedback tp3d-org-feedback--error';
    lostMsg.textContent = 'You no longer have access to this workspace.';
    targetEl.appendChild(lostMsg);

    const lostRefreshRow = doc.createElement('div');
    lostRefreshRow.className = 'row';
    const lostRefreshBtn = doc.createElement('button');
    lostRefreshBtn.type = 'button';
    lostRefreshBtn.className = 'btn';
    lostRefreshBtn.textContent = 'Refresh';
    lostRefreshBtn.addEventListener('click', () => {
      _orgAccessLostId = '';
      lastBundleRefreshAt = 0;
      queueAccountBundleRefresh({ force: true, source });
      render({ source });
    });
    lostRefreshRow.appendChild(lostRefreshBtn);
    targetEl.appendChild(lostRefreshRow);
  }

  function shouldSuppressPreLockBillingTransition(stateOverride = null) {
    const state = stateOverride || (
      (() => {
        try {
          const api = getBillingApiSafely();
          return api && typeof api.getBillingState === 'function' ? api.getBillingState() : null;
        } catch {
          return null;
        }
      })()
    );
    const lockedOrgId = ensureModalOrgId();
    const currentOrgId = getOrgIdFromOrgContext();
    const billingOrgId = normalizeOrgId(state && state.orgId ? state.orgId : '');
    const loading = Boolean(state && state.loading);
    const pending = Boolean(state && state.pending);
    return Boolean(
      lockedOrgId &&
      currentOrgId &&
      currentOrgId !== lockedOrgId &&
      billingOrgId &&
      billingOrgId === currentOrgId &&
      (loading || pending)
    );
  }

  function getTransientBillingOrgName(targetOrgId) {
    const normalizedOrgId = normalizeOrgId(targetOrgId);
    if (!normalizedOrgId || typeof window === 'undefined') return '';
    try {
      const bundle = window.__TP3D_LAST_ACCOUNT_BUNDLE || null;
      const activeOrg = bundle && bundle.activeOrg ? bundle.activeOrg : null;
      const activeOrgId = normalizeOrgId(activeOrg && activeOrg.id ? activeOrg.id : '');
      const activeOrgName = activeOrg && activeOrg.name ? String(activeOrg.name).trim() : '';
      if (activeOrgId && activeOrgId === normalizedOrgId && activeOrgName) return activeOrgName;
    } catch {
      // ignore
    }
    return '';
  }

  function getWorkspaceSwitchStateSafely() {
    try {
      const getter = typeof window !== 'undefined' && window.TruckPackerApp
        && typeof window.TruckPackerApp.getWorkspaceSwitchState === 'function'
        ? window.TruckPackerApp.getWorkspaceSwitchState
        : null;
      const state = getter ? getter() : null;
      return state && typeof state === 'object' ? state : null;
    } catch {
      return null;
    }
  }

  function isWorkspaceSwitchingForOrg(orgId, stateOverride = null) {
    const normalizedOrgId = normalizeOrgId(orgId);
    const state = stateOverride || getWorkspaceSwitchStateSafely();
    const targetOrgId = normalizeOrgId(state && state.toOrgId ? state.toOrgId : '');
    return Boolean(state && state.active && normalizedOrgId && targetOrgId && normalizedOrgId === targetOrgId);
  }

  function _safeAuthSnapshot(userId) {
    let hasUserJwt = false;
    try {
      const sess = SupabaseClient && typeof SupabaseClient.getSession === 'function'
        ? SupabaseClient.getSession()
        : null;
      hasUserJwt = Boolean(sess && sess.access_token);
    } catch {
      hasUserJwt = false;
    }
    const activeOrgId = getOrgIdFromOrgContext() || getOrgIdFromBillingState() || getOrgIdFromLocalStorage() || '';
    return {
      signedIn: Boolean(userId),
      userId: userId ? String(userId) : '',
      activeOrgId,
      hasUserJwt,
    };
  }

  function _hasMeaningfulAuthDelta(nextSnapshot) {
    const prev = _lastAuthSnapshot;
    if (!prev) return true;
    if (!nextSnapshot) return false;
    return (
      prev.signedIn !== nextSnapshot.signedIn
      || prev.userId !== nextSnapshot.userId
      || prev.activeOrgId !== nextSnapshot.activeOrgId
      || prev.hasUserJwt !== nextSnapshot.hasUserJwt
    );
  }

  function _activeTabDependsOnAuthState(tabId) {
    const tab = normalizeTab(tabId);
    return tab === 'account' || tab === 'org-general' || tab === 'org-members' || tab === 'org-billing';
  }

  function _buildRenderStableKey() {
    const tab = normalizeTab(_tabState.activeTabId);
    const key = {
      tab,
      actionId: _tabState.lastActionId,
      orgId: ensureModalOrgId() || getOrgIdFromOrgContext() || '',
    };

    if (tab === 'account') {
      key.account = {
        editingProfile: Boolean(isEditingProfile),
        loadingBundle: Boolean(isLoadingAccountBundle),
        loadingProfile: Boolean(isLoadingProfile),
        savingProfile: Boolean(isSavingProfile),
        uploadingAvatar: Boolean(isUploadingAvatar),
        hasProfile: Boolean(profileData),
        profileId: profileData && profileData.id ? String(profileData.id) : '',
        profileUpdatedAt: profileData && profileData.updated_at ? String(profileData.updated_at) : '',
      };
    } else if (tab === 'org-members') {
      const pendingInviteRenderRows = Array.isArray(orgInvitesData)
        ? orgInvitesData.filter(invite => invite && String(invite.status || '').toLowerCase() === 'pending')
        : [];
      key.members = {
        loadingMembers: Boolean(isLoadingOrgMembers),
        loadingInvites: Boolean(isLoadingOrgInvites),
        membersCount: Array.isArray(orgMembersData) ? orgMembersData.length : 0,
        invitesCount: pendingInviteRenderRows.length,
        invitesSignature: pendingInviteRenderRows
          .map(invite => [
            String(invite.id || ''),
            String(invite.role || 'member').toLowerCase(),
            String(invite.status || '').toLowerCase(),
          ].join(':'))
          .join('|'),
        inviteActions: orgInviteActions.size,
        membersError: orgMembersError ? String(orgMembersError.message || orgMembersError.code || '1') : '',
        invitesError: orgInvitesError ? String(orgInvitesError.message || orgInvitesError.code || '1') : '',
        search: String(orgMembersSearchQuery || ''),
        roleFilter: String(orgMembersRoleFilter || 'all'),
      };
    } else if (tab === 'org-billing') {
      const api = getBillingApiSafely();
      const bs = api && typeof api.getBillingState === 'function' ? api.getBillingState() : null;
      const workspaceSwitch = getWorkspaceSwitchStateSafely();
      key.billing = {
        loading: Boolean(bs && bs.loading),
        pending: Boolean(bs && bs.pending),
        ok: Boolean(bs && bs.ok),
        plan: bs && bs.plan ? String(bs.plan) : '',
        status: bs && bs.status ? String(bs.status) : '',
        entitlementStatus: bs && bs.entitlementStatus ? String(bs.entitlementStatus) : '',
        billingOwnerUserId: bs && bs.billingOwnerUserId ? String(bs.billingOwnerUserId) : '',
        workspaceIncluded: Boolean(bs && bs.workspaceIncluded),
        workspaceCount: bs && bs.workspaceCount != null ? Number(bs.workspaceCount) : null,
        workspaceLimit: bs && bs.workspaceLimit != null ? Number(bs.workspaceLimit) : null,
        canManageBilling: bs && typeof bs.canManageBilling === 'boolean' ? bs.canManageBilling : null,
        orgId: normalizeOrgId(bs && bs.orgId ? bs.orgId : ''),
        isPro: Boolean(bs && bs.isPro),
        isActive: Boolean(bs && bs.isActive),
        portalAvailable: Boolean(bs && bs.portalAvailable),
        trialEndsAt: bs && bs.trialEndsAt ? String(bs.trialEndsAt) : '',
        currentPeriodEnd: bs && bs.currentPeriodEnd ? String(bs.currentPeriodEnd) : '',
        error: bs && bs.error ? String(bs.error.message || bs.error.status || '1') : '',
      };
      key.workspaceSwitch = workspaceSwitch ? {
        active: Boolean(workspaceSwitch.active),
        toOrgId: normalizeOrgId(workspaceSwitch.toOrgId || ''),
        version: Number(workspaceSwitch.version || 0) || 0,
        localStateReady: Boolean(workspaceSwitch.localStateReady),
        orgReady: Boolean(workspaceSwitch.orgReady),
        billingReady: Boolean(workspaceSwitch.billingReady),
      } : null;
    } else if (tab === 'org-general') {
      key.orgGeneral = {
        editingOrg: Boolean(isEditingOrg),
        loadingBundle: Boolean(isLoadingAccountBundle),
        loadingOrg: Boolean(isLoadingOrg),
        loadingMembership: Boolean(isLoadingMembership),
        savingOrg: Boolean(isSavingOrg),
        orgName: orgData && orgData.name ? String(orgData.name) : '',
        role: String(getRoleForOrg(key.orgId) || ''),
        archivedLoading: Boolean(isLoadingArchivedWorkspaces),
        archivedCount: Array.isArray(archivedWorkspacesData) ? archivedWorkspacesData.length : null,
        archivedError: archivedWorkspacesError ? String(archivedWorkspacesError.message || archivedWorkspacesError.code || '1') : '',
        restoreActions: restoreWorkspaceActions.size,
      };
    } else if (tab === 'resources') {
      key.resources = { view: String(resourcesSubView || 'root') };
    } else if (tab === 'preferences') {
      key.preferences = {
        hiddenOpacity: Number((PreferencesManager && PreferencesManager.get && PreferencesManager.get().hiddenOpacity) || 0),
      };
    }
    return JSON.stringify(key);
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
    let activeOrgContextRole = '';
    try {
      if (
        typeof window !== 'undefined' &&
        window.OrgContext &&
        typeof window.OrgContext.getActiveOrgId === 'function' &&
        typeof window.OrgContext.getActiveRole === 'function' &&
        normalizeOrgId(window.OrgContext.getActiveOrgId()) === normalizedOrgId
      ) {
        const candidateRole = String(window.OrgContext.getActiveRole() || '').toLowerCase();
        activeOrgContextRole = isKnownOrgRole(candidateRole) ? candidateRole : '';
      }
    } catch {
      activeOrgContextRole = '';
    }
    return String(
      (orgDataId && orgDataId === normalizedOrgId && orgData && orgData.role) ||
      (membershipOrgId && membershipOrgId === normalizedOrgId && membershipData && membershipData.role) ||
      activeOrgContextRole ||
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
    }
    if (
      (lastOrgInvitesOrgId && String(lastOrgInvitesOrgId) !== String(next)) ||
      (orgInvitesInflightOrgId && String(orgInvitesInflightOrgId) !== String(next))
    ) {
      orgInvitesRequestId += 1;
      orgInvitesData = null;
      orgInvitesError = null;
      isLoadingOrgInvites = false;
      orgInvitesInflightPromise = null;
      orgInvitesInflightOrgId = null;
      lastOrgInvitesOrgId = null;
    }
    if (!next || billingContextInflightOrgId !== next) {
      billingContextInflightPromise = null;
      billingContextInflightOrgId = '';
    }
    if (!next || billingContextStartingOrgId !== next) {
      billingContextStartingOrgId = '';
    }
    if (!next || billingContextResolvedOrgId !== next) {
      billingContextResolvedOrgId = '';
    }
    if (_orgAccessLostId && _orgAccessLostId !== next) {
      _orgAccessLostId = '';
    }
  }

  async function ensureBillingContextHydrated(orgId, { force = false, source = 'org-billing:hydrate-context' } = {}) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return null;

    const role = getRoleForOrg(normalizedOrgId);
    const roleKnown = isKnownOrgRole(role);
    const orgProfileLoaded = hasOrgProfileForOrg(normalizedOrgId);
    if (!force && orgProfileLoaded && roleKnown) {
      billingContextResolvedOrgId = normalizedOrgId;
      return { ok: true };
    }

    // ── Inflight guard: avoid redundant auth-ready checks ──
    if (
      !force &&
      (
        (billingContextInflightPromise && billingContextInflightOrgId === normalizedOrgId) ||
        billingContextStartingOrgId === normalizedOrgId
      )
    ) {
      return billingContextInflightPromise || null;
    }

    const now = Date.now();
    if (
      !force &&
      billingContextLastAttemptAt &&
      (now - billingContextLastAttemptAt) < BILLING_CONTEXT_RETRY_MS &&
      !billingContextInflightPromise
    ) {
      return null;
    }

    // ── Auth-ready gate: skip when JWT is missing (cross-tab boot gap) ──
    billingContextStartingOrgId = normalizedOrgId;
    const authCheck = await ensureAuthReadyForOrgOps('ensureBillingContextHydrated');
    if (billingContextStartingOrgId === normalizedOrgId) {
      billingContextStartingOrgId = '';
    }
    if (!authCheck.ok) {
      debug('billingFetch:skip-no-token', { caller: source, orgId: normalizedOrgId, code: authCheck.code });
      _authGatePendingRetry = true;
      return null;
    }

    billingContextLastAttemptAt = now;
    billingContextInflightOrgId = normalizedOrgId;
    const oEpoch = getOverlayEpoch();
    const _hydrateToken = getTabActionToken();
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

      if (!isKnownOrgRole(getRoleForOrg(normalizedOrgId)) && SupabaseClient && typeof SupabaseClient.getMyOrgRole === 'function') {
        try {
          isLoadingMembership = true;
          const orgRole = await SupabaseClient.getMyOrgRole(normalizedOrgId);
          if (orgRole) {
            const normalizedRole = String(orgRole).toLowerCase();
            const existingMembershipOrgId = normalizeOrgId(
              membershipData && membershipData.organization_id ? membershipData.organization_id : ''
            );
            membershipData = {
              ...(existingMembershipOrgId === normalizedOrgId && membershipData ? membershipData : {}),
              organization_id: normalizedOrgId,
              role: normalizedRole,
            };
          }
        } catch {
          // ignore
        } finally {
          isLoadingMembership = false;
        }
      }

      const currentModalOrgId = ensureModalOrgId();
      if (currentModalOrgId && currentModalOrgId !== normalizedOrgId) {
        debug('ensureBillingContextHydrated:drop-stale-org', {
          source,
          requestOrgId: normalizedOrgId,
          currentModalOrgId,
        });
        return null;
      }

      const hydrated = hasOrgProfileForOrg(normalizedOrgId) && isKnownOrgRole(getRoleForOrg(normalizedOrgId));
      billingContextResolvedOrgId = hydrated ? normalizedOrgId : '';
      return { ok: hydrated };
    })()
      .finally(() => {
        if (billingContextStartingOrgId === normalizedOrgId) {
          billingContextStartingOrgId = '';
        }
        if (billingContextInflightOrgId === normalizedOrgId) {
          billingContextInflightPromise = null;
          billingContextInflightOrgId = '';
        }
        // If tab action changed while async hydration was in flight, skip render
        if (typeof _hydrateToken === 'number' && !isTokenCurrent(_hydrateToken)) {
          debug('ensureBillingContextHydrated:skip-stale-token', { source, token: _hydrateToken, current: getTabActionToken() });
          return;
        }
        renderIfFresh(getCurrentActionId(), source, undefined, oEpoch, _hydrateToken);
      });

    billingContextInflightPromise = request;
    return request;
  }

  function ensureOrgChangedListener() {
    if (orgChangedHandler || typeof window === 'undefined') return;
    orgChangedHandler = ev => {
      const detail = ev && ev.detail ? ev.detail : {};
      const eventUserId = detail && detail.userId ? String(detail.userId) : '';
      const currentUserId = getCurrentAuthUserId();
      if (eventUserId && currentUserId && eventUserId !== currentUserId) {
        return;
      }
      const eventEpoch = parseEpochValue(detail && (detail.epoch || detail.version));
      const eventTs = Number(detail && (detail.ts || detail.timestamp) ? detail.ts || detail.timestamp : 0) || 0;
      if (eventEpoch && eventEpoch < _lastOrgChangeEpochSeen) {
        return;
      }
      if (!eventEpoch && eventTs && _lastOrgChangeTsSeen && eventTs < _lastOrgChangeTsSeen) {
        return;
      }
      if (eventEpoch) _lastOrgChangeEpochSeen = Math.max(_lastOrgChangeEpochSeen, eventEpoch);
      if (eventTs) _lastOrgChangeTsSeen = Math.max(_lastOrgChangeTsSeen, eventTs);

      const nextOrgId = normalizeOrgId(detail ? detail.orgId : '');
      if (!nextOrgId) {
        const isCleared = Boolean(detail && detail.confirmedNoOrg) ||
          isConfirmedNoActiveWorkspaceBundle(
            (typeof window !== 'undefined' && window.__TP3D_LAST_ACCOUNT_BUNDLE) || null
          );
        if (!isCleared) return;
        modalOrgId = '';
        clearOrgScopedCaches('');
        membershipData = null;
        orgData = null;
        orgMembersRequestId += 1;
        orgInvitesRequestId += 1;
        orgMembersData = null;
        orgMembersError = null;
        isLoadingOrgMembers = false;
        orgMembersInflightPromise = null;
        orgMembersInflightOrgId = null;
        lastOrgMembersOrgId = null;
        orgInvitesData = null;
        orgInvitesError = null;
        isLoadingOrgInvites = false;
        orgInvitesInflightPromise = null;
        orgInvitesInflightOrgId = null;
        lastOrgInvitesOrgId = null;
        isEditingOrg = false;
        orgMemberActions.clear();
        orgInviteActions.clear();
        if (settingsOverlay && settingsOverlay.isConnected) {
          render({ source: 'org-changed:no-active' });
        }
        return;
      }
      if (nextOrgId === modalOrgId) {
        // Same org but potentially updated role/membership — force bundle + render
        const tab = _tabState.activeTabId;
        const missingMembers = tab === 'org-members' && !orgMembersData;
        const missingBilling = tab === 'org-billing' && !billingContextResolvedOrgId;
        const missingOrgName = tab === 'org-general' && !hasOrgProfileForOrg(nextOrgId);
        const hasMissingCritical = missingMembers || missingBilling || missingOrgName;

        if (hasMissingCritical && !_sameOrgRehydrateInflight) {
          debug('same-org:missing-critical', { tab, orgId: nextOrgId, missingMembers, missingBilling, missingOrgName });
          _sameOrgRehydrateInflight = true;
          // Bypass the 2s cooldown once: reset lastBundleRefreshAt so queueAccountBundleRefresh won't skip
          lastBundleRefreshAt = 0;
          debug('bundle-refresh:forced', { tab, orgId: nextOrgId, reason: 'same-org:missing-critical' });
          queueAccountBundleRefresh({ force: true, source: 'settings:org-changed:same-org:forced' });
          // After bundle loads, run tab-specific loader
          const epoch = _renderEpoch;
          const token = getTabActionToken();
          const afterBundle = () => {
            _sameOrgRehydrateInflight = false;
            if (missingMembers) {
              loadOrgMembers(nextOrgId)
                .then(() => renderIfFresh(getCurrentActionId(), 'org-members:forced-rehydrate', epoch, undefined, token))
                .catch(() => { });
            } else if (missingBilling) {
              ensureBillingContextHydrated(nextOrgId, { force: true, source: 'org-billing:forced-rehydrate' })
                .then(() => renderIfFresh(getCurrentActionId(), 'org-billing:forced-rehydrate', epoch, undefined, token))
                .catch(() => { });
            } else {
              renderIfFresh(getCurrentActionId(), 'org-general:forced-rehydrate', epoch, undefined, token);
            }
          };
          // Wait for bundle to finish loading then trigger tab loader
          const waitForBundle = () => {
            if (!isLoadingAccountBundle) { afterBundle(); return; }
            setTimeout(waitForBundle, 120);
          };
          setTimeout(waitForBundle, 80);
        } else {
          queueAccountBundleRefresh({ force: true, source: 'settings:org-changed:same-org' });
        }

        if (settingsOverlay && settingsOverlay.isConnected) {
          render({ source: 'org-changed:same-org' });
        }
        if (tab === 'org-members' && !hasMissingCritical) {
          const epoch = _renderEpoch;
          const token = getTabActionToken();
          loadOrgMembers(nextOrgId)
            .then(() => renderIfFresh(getCurrentActionId(), 'org-members:org-changed:same-org', epoch, undefined, token))
            .catch(() => { });
        }
        return;
      }
      modalOrgId = nextOrgId;
      clearOrgScopedCaches(nextOrgId);
      orgMembersRequestId += 1;
      orgInvitesRequestId += 1;
      // Do NOT set isLoadingOrgMembers = true here: no fetch is started yet.
      // The render path will start the fetch when the Members tab is visible.
      orgMembersError = null;
      orgMembersData = null;
      lastOrgMembersOrgId = null;
      orgInvitesData = null;
      orgInvitesError = null;
      isLoadingOrgInvites = false;
      orgInvitesInflightPromise = null;
      orgInvitesInflightOrgId = null;
      lastOrgInvitesOrgId = null;
      const isBillingTab = _tabState.activeTabId === 'org-billing';
      if (isBillingTab) {
        ensureBillingContextHydrated(nextOrgId, { force: true, source: 'org-billing:org-changed' }).catch(() => { });
      } else {
        queueAccountBundleRefresh({ force: true, source: 'settings:org-changed' });
        // Billing refresh is owned by app.js tp3d:org-changed; no overlay-side pump needed.
      }
      if (settingsOverlay && settingsOverlay.isConnected) {
        render({ source: 'org-changed' });
      }
      if (_tabState.activeTabId === 'org-members') {
        const epoch = _renderEpoch;
        const token = getTabActionToken();
        loadOrgMembers(nextOrgId)
          .then(() => renderIfFresh(getCurrentActionId(), 'org-members:org-changed', epoch, undefined, token))
          .catch(() => { });
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

  function ensureOrgAccessLostListener() {
    if (orgAccessLostHandler || typeof window === 'undefined') return;
    orgAccessLostHandler = ev => {
      const detail = ev && ev.detail ? ev.detail : {};
      const eventUserId = detail && detail.userId ? String(detail.userId) : '';
      const currentUserId = getCurrentAuthUserId();
      if (!eventUserId || !currentUserId || eventUserId !== currentUserId) return;

      const lostOrgId = normalizeOrgId(detail && detail.orgId ? detail.orgId : '');
      const lockedOrgId = ensureModalOrgId();
      if (!lostOrgId || !lockedOrgId || lostOrgId !== lockedOrgId) return;

      _orgAccessLostId = lostOrgId;
      isEditingOrg = false;
      orgMemberActions.clear();
      orgInviteActions.clear();
      if (settingsOverlay && settingsOverlay.isConnected) {
        renderIfFresh(getCurrentActionId(), 'org-access-lost');
      }
    };
    window.addEventListener('tp3d:org-access-lost', orgAccessLostHandler);
  }

  function removeOrgAccessLostListener() {
    if (!orgAccessLostHandler || typeof window === 'undefined') return;
    try {
      window.removeEventListener('tp3d:org-access-lost', orgAccessLostHandler);
    } catch {
      // ignore
    }
    orgAccessLostHandler = null;
    _orgAccessLostId = '';
  }

  function ensureWorkspaceSwitchListener() {
    if (workspaceSwitchHandler || typeof window === 'undefined') return;
    workspaceSwitchHandler = () => {
      if (!settingsOverlay || !isOpen() || _tabState.activeTabId !== 'org-billing') return;
      const billingWrap = doc.getElementById('tp3d-billing-wrap');
      if (billingWrap) {
        renderBillingInto(billingWrap);
        return;
      }
      render({ source: 'workspace-switch-state' });
    };
    window.addEventListener('tp3d:workspace-switch-state', workspaceSwitchHandler);
  }

  function removeWorkspaceSwitchListener() {
    if (!workspaceSwitchHandler || typeof window === 'undefined') return;
    try {
      window.removeEventListener('tp3d:workspace-switch-state', workspaceSwitchHandler);
    } catch {
      // ignore
    }
    workspaceSwitchHandler = null;
  }

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
    if (isLoadingAccountBundle) {
      accountBundleRefreshQueued = true;
      accountBundleQueuedForce = accountBundleQueuedForce || Boolean(force);
      return null;
    }

    // Capture request ID for "last request wins" guard
    const thisRequestId = ++accountBundleRequestId;
    const requestOverlayEpoch = getOverlayEpoch();
    const requestOrgId = ensureModalOrgId() || getOrgIdFromOrgContext() || '';
    isLoadingAccountBundle = true;
    let keepOrgLoading = false;

    try {
      const bundle = await SupabaseClient.getAccountBundleSingleFlight({ force });

      const currentOverlayEpoch = getOverlayEpoch();
      const currentOrgId = ensureModalOrgId() || getOrgIdFromOrgContext() || '';
      const staleByRequest = thisRequestId !== accountBundleRequestId;
      const staleByEpoch = requestOverlayEpoch !== currentOverlayEpoch;
      const staleByOrg = Boolean(requestOrgId && currentOrgId && requestOrgId !== currentOrgId);
      if (staleByRequest || staleByEpoch || staleByOrg) {
        debug('loadAccountBundle:drop-stale', {
          staleByRequest,
          staleByEpoch,
          staleByOrg,
          requestOrgId: requestOrgId || null,
          currentOrgId: currentOrgId || null,
          requestOverlayEpoch,
          currentOverlayEpoch,
        });
        return null;
      }

      // Check if bundle was canceled due to auth change
      if (bundle && bundle.canceled) {
        return null;
      }

      // Populate all module-level caches from the bundle.
      // Guard: if bundle is partial with no activeOrgId, do NOT overwrite existing good org data.
      if (bundle) {
        const isPartialNoOrg = bundle.partial === true && !bundle.activeOrgId;
        if (isPartialNoOrg) {
          accountBundleConfirmedNoActiveWorkspace = false;
          // Always block on partial-no-org — even on first load when all caches are null.
          // Safe-write profile (not org-scoped); preserve existing org/membership data.
          if (bundle.profile) profileData = bundle.profile;
          debug('loadAccountBundle:skip-partial', { partial: true, activeOrgId: bundle.activeOrgId, hasExistingProfile: Boolean(profileData), hasExistingOrg: Boolean(orgData) });
          keepOrgLoading = true; // keep org panels in skeleton until the full bundle arrives
          // Schedule a retry to get the full bundle (max 3 retries, 800ms apart)
          if (!_bundlePartialRetryCount) _bundlePartialRetryCount = 0;
          if (_bundlePartialRetryCount < 3) {
            _bundlePartialRetryCount += 1;
            setTimeout(() => {
              queueAccountBundleRefresh({ force: true, source: 'bundle-partial-retry' });
            }, 800);
          }
          return null;
        }
        _bundlePartialRetryCount = 0;

        if (isConfirmedNoActiveWorkspaceBundle(bundle)) {
          accountBundleConfirmedNoActiveWorkspace = true;
          profileData = bundle.profile || null;
          membershipData = null;
          orgData = null;
          isEditingOrg = false;
          modalOrgId = '';
          clearOrgScopedCaches('');
          orgMemberActions.clear();
          orgInviteActions.clear();
          return bundle;
        }

        accountBundleConfirmedNoActiveWorkspace = false;
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

      return bundle;
    } catch (err) {
      console.error('[SettingsOverlay] Failed to load account bundle:', err);
      return null;
    } finally {
      isLoadingAccountBundle = false;
      isLoadingProfile = false;
      isLoadingMembership = false;
      isLoadingOrg = Boolean(keepOrgLoading);
      if (accountBundleRefreshQueued) {
        const queuedForce = accountBundleQueuedForce;
        accountBundleRefreshQueued = false;
        accountBundleQueuedForce = false;
        setTimeout(() => {
          const queuedEpoch = getOverlayEpoch();
          loadAccountBundle({ force: queuedForce })
            .then(() => renderIfFresh(getCurrentActionId(), 'account-bundle-queued', undefined, queuedEpoch))
            .catch(() => { });
        }, 0);
      }
    }
  }

  function queueAccountBundleRefresh({ force = true, source = 'account-bundle-refresh' } = {}) {
    _debugCallsite('queueAccountBundleRefresh', { force, source });
    if (isLoadingAccountBundle) {
      accountBundleRefreshQueued = true;
      accountBundleQueuedForce = accountBundleQueuedForce || Boolean(force);
      return;
    }
    const now = Date.now();
    if (now - lastBundleRefreshAt < 2000) {
      const missingCritical = !profileData || !orgData || !orgMembersData;
      debug('queueAccountBundleRefresh:skip-fresh', {
        source, ageMs: now - lastBundleRefreshAt,
        profileNull: !profileData, orgNull: !orgData,
        orgMembersNull: !orgMembersData, missingCritical,
      });
      return;
    }
    lastBundleRefreshAt = now;
    const oEpoch = getOverlayEpoch();
    loadAccountBundle({ force })
      .then(() => renderIfFresh(getCurrentActionId(), source, undefined, oEpoch))
      .catch(() => { });
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
    const epoch = _renderEpoch;
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
      renderIfFresh(getCurrentActionId(), 'saveProfile', epoch);
      return updated;
    } catch (err) {
      isSavingProfile = false;
      UIComponents.showToast(`Failed to save: ${err && err.message ? err.message : err}`, 'error');
      throw err;
    }
  }

  async function loadOrganization(orgId = null) {
    if (isLoadingOrg || !orgId) return null;
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return null;
    const requestTabEpoch = _getTabEpoch();
    const requestToken = getTabActionToken();
    isLoadingOrg = true;
    try {
      const org = await SupabaseClient.getOrganization(normalizedOrgId);
      if (requestTabEpoch !== _getTabEpoch() || requestToken !== getTabActionToken()) {
        return null;
      }
      const currentModalOrgId = ensureModalOrgId();
      if (currentModalOrgId && currentModalOrgId !== normalizedOrgId) {
        return null;
      }
      orgData = org;
      return org;
    } catch (err) {
      console.error('Failed to load organization:', err);
      return null;
    } finally {
      isLoadingOrg = false;
    }
  }

  async function saveOrganization(updates, orgId = null) {
    if (isSavingOrg || !orgId) return null;
    isSavingOrg = true;
    const epoch = _renderEpoch;
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
      UIComponents.showToast('Workspace updated', 'success');
      renderIfFresh(getCurrentActionId(), 'saveOrganization', epoch);
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
    if (!normalizedOrgId) {
      debug('loadOrgMembers:skip-no-org', { orgId: orgId || null });
      return null;
    }
    // ── Auth-ready gate: skip fetch when JWT is missing (cross-tab boot gap) ──
    const authCheck = await ensureAuthReadyForOrgOps('loadOrgMembers');
    if (!authCheck.ok) {
      debug('orgFetch:skip-no-token', { caller: 'loadOrgMembers', orgId: normalizedOrgId, code: authCheck.code });
      orgMembersError = { message: 'Reconnecting\u2026', _authPending: true };
      _authGatePendingRetry = true;
      return null;
    }
    if (isLoadingOrgMembers && orgMembersInflightPromise && orgMembersInflightOrgId === normalizedOrgId) {
      debug('loadOrgMembers:reuse-inflight', { orgId: normalizedOrgId });
      return orgMembersInflightPromise;
    }
    if (isLoadingOrgMembers && orgMembersInflightOrgId && orgMembersInflightOrgId !== normalizedOrgId) {
      orgMembersRequestId += 1;
    }
    const thisRequestId = ++orgMembersRequestId;
    const requestTabEpoch = _getTabEpoch();
    const requestToken = getTabActionToken();
    isLoadingOrgMembers = true;
    orgMembersInflightOrgId = normalizedOrgId;
    orgMembersError = null;
    debug('loadOrgMembers:start', { orgId: normalizedOrgId, requestId: thisRequestId });
    const requestPromise = (async () => {
      try {
        const members = await SupabaseClient.getOrganizationMembers(normalizedOrgId);
        if (thisRequestId !== orgMembersRequestId) return null;
        if (requestTabEpoch !== _getTabEpoch() || requestToken !== getTabActionToken()) {
          debug('loadOrgMembers:drop-stale-token', {
            orgId: normalizedOrgId,
            requestId: thisRequestId,
            requestTabEpoch,
            currentTabEpoch: _getTabEpoch(),
            requestToken,
            currentToken: getTabActionToken(),
          });
          return null;
        }
        const currentModalOrgId = ensureModalOrgId();
        if (currentModalOrgId && currentModalOrgId !== normalizedOrgId) {
          debug('loadOrgMembers:drop-stale-org', {
            orgId: normalizedOrgId,
            currentModalOrgId,
            requestId: thisRequestId,
          });
          return null;
        }
        orgMembersData = Array.isArray(members) ? members : [];
        lastOrgMembersOrgId = String(normalizedOrgId);
        debug('loadOrgMembers:ok', { orgId: normalizedOrgId, count: orgMembersData.length });
        _membersRetryCount = 0; // reset on success
        return orgMembersData;
      } catch (err) {
        if (thisRequestId !== orgMembersRequestId) return null;
        orgMembersError = err;
        orgMembersData = Array.isArray(orgMembersData) ? orgMembersData : [];
        debug('loadOrgMembers:error', { orgId: normalizedOrgId, error: err && err.message || String(err) });
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

  function getArchivedWorkspaceName(org) {
    const name = org && org.name ? String(org.name).trim() : '';
    return name || 'Archived workspace';
  }

  function getArchivedWorkspaceDate(org) {
    const value = org && org.archived_at ? String(org.archived_at) : '';
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    try {
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  }

  async function loadArchivedWorkspaces({ force = false } = {}) {
    if (!force && Array.isArray(archivedWorkspacesData)) return archivedWorkspacesData;
    if (isLoadingArchivedWorkspaces && !force) return archivedWorkspacesData || [];
    if (!SupabaseClient || typeof SupabaseClient.getUserArchivedOrganizations !== 'function') {
      archivedWorkspacesData = [];
      archivedWorkspacesError = null;
      return [];
    }

    const thisRequestId = ++archivedWorkspacesRequestId;
    isLoadingArchivedWorkspaces = true;
    archivedWorkspacesError = null;
    try {
      const rows = await SupabaseClient.getUserArchivedOrganizations();
      if (thisRequestId !== archivedWorkspacesRequestId) return archivedWorkspacesData || [];
      archivedWorkspacesData = (Array.isArray(rows) ? rows : [])
        .filter(row => row && normalizeOrgId(row.id || '') && row.archived_at);
      return archivedWorkspacesData;
    } catch (err) {
      if (thisRequestId === archivedWorkspacesRequestId) {
        archivedWorkspacesError = err;
        archivedWorkspacesData = Array.isArray(archivedWorkspacesData) ? archivedWorkspacesData : [];
      }
      return archivedWorkspacesData || [];
    } finally {
      if (thisRequestId === archivedWorkspacesRequestId) {
        isLoadingArchivedWorkspaces = false;
      }
    }
  }

  function canManageMembers(roleValue) {
    const role = String(roleValue || '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  function isSensitiveRoleChange(previousRole, nextRole) {
    const previous = String(previousRole || '').trim().toLowerCase();
    const next = String(nextRole || '').trim().toLowerCase();
    if (!previous || !next || previous === next) return false;
    return previous === 'owner' || previous === 'admin' || next === 'owner' || next === 'admin';
  }

  function buildRoleChangeConfirmMessage(member, previousRole, nextRole) {
    const memberName = getMemberDisplayName(member);
    return `Change ${memberName}'s role from ${getRoleLabel(previousRole)} to ${getRoleLabel(nextRole)}?`;
  }

  function refreshMembershipContextAfterMutation(orgId, source) {
    const normalizedOrgId = normalizeOrgId(orgId);
    queueAccountBundleRefresh({ force: true, source });
    try {
      if (typeof window !== 'undefined' && window.TruckPackerApp && typeof window.TruckPackerApp.maybeScheduleBillingRefresh === 'function') {
        window.TruckPackerApp.maybeScheduleBillingRefresh(source);
      } else {
        _callBillingPumpWithRetry(source);
      }
    } catch {
      // non-fatal; the members list has already been refreshed by the caller
    }
    if (normalizedOrgId && _tabState.activeTabId === 'org-members') {
      const token = getTabActionToken();
      loadAccountBundle({ force: true })
        .then(() => renderIfFresh(getCurrentActionId(), source, undefined, getOverlayEpoch(), token))
        .catch(() => { });
    }
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

  function getInviteExpirationView(expiresAtValue) {
    const raw = expiresAtValue ? String(expiresAtValue) : '';
    if (!raw) {
      return {
        text: 'Expiry unavailable',
        expired: false,
        className: 'tp3d-org-feedback tp3d-org-feedback--warning',
      };
    }

    const expiresAt = new Date(raw);
    if (Number.isNaN(expiresAt.getTime())) {
      return {
        text: 'Expiry unavailable',
        expired: false,
        className: 'tp3d-org-feedback tp3d-org-feedback--warning',
      };
    }

    const diffMs = expiresAt.getTime() - Date.now();
    if (diffMs <= 0) {
      return {
        text: 'Expired',
        expired: true,
        className: 'tp3d-org-feedback tp3d-org-feedback--error',
      };
    }

    if (diffMs < 24 * 60 * 60 * 1000) {
      return {
        text: 'Expires today',
        expired: false,
        className: 'tp3d-org-feedback tp3d-org-feedback--warning',
      };
    }

    const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    return {
      text: `Expires in ${days} days`,
      expired: false,
      className: 'muted tp3d-members-inline-helper',
    };
  }

  async function updateMemberRole(orgId, member, nextRole, currentUserId) {
    if (!member || !member.user_id || !orgId) return null;
    const userId = String(member.user_id);
    if (orgMemberActions.has(userId)) return null;

    orgMemberActions.add(userId);
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'memberRole:update:begin', epoch);
    try {
      const result = await updateOrgMemberRoleFn(orgId, userId, nextRole);
      if (!result || !result.ok) {
        UIComponents.showToast(result && result.error ? result.error : 'Failed to update role.', 'error');
        renderIfFresh(getCurrentActionId(), 'memberRole:update:error', epoch);
        return null;
      }
      await loadOrgMembers(orgId);
      refreshMembershipContextAfterMutation(orgId, 'memberRole:update:refresh-context');
      const updated = result.member || null;
      if (updated && currentUserId && currentUserId === userId && membershipData) {
        membershipData = { ...membershipData, role: updated.role || membershipData.role };
      }
      UIComponents.showToast('Role updated', 'success');
      renderIfFresh(getCurrentActionId(), 'memberRole:update', epoch);
      return updated;
    } catch (err) {
      UIComponents.showToast(`Failed to update role: ${err && err.message ? err.message : err}`, 'error');
      renderIfFresh(getCurrentActionId(), 'memberRole:update:error', epoch);
      return null;
    } finally {
      orgMemberActions.delete(userId);
      renderIfFresh(getCurrentActionId(), 'memberRole:update:done', epoch);
    }
  }

  async function removeMember(orgId, member) {
    if (!member || !member.user_id || !orgId) return false;
    const userId = String(member.user_id);
    if (orgMemberActions.has(userId)) return false;

    orgMemberActions.add(userId);
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'memberRemove:begin', epoch);
    try {
      const result = await removeOrgMemberFn(orgId, userId);
      if (!result || !result.ok) {
        UIComponents.showToast(result && result.error ? result.error : 'Failed to remove member.', 'error');
        renderIfFresh(getCurrentActionId(), 'memberRemove:error', epoch);
        return false;
      }
      await loadOrgMembers(orgId);
      refreshMembershipContextAfterMutation(orgId, 'memberRemove:refresh-context');
      UIComponents.showToast('Member removed', 'success');
      renderIfFresh(getCurrentActionId(), 'memberRemove', epoch);
      return true;
    } catch (err) {
      UIComponents.showToast(`Failed to remove member: ${err && err.message ? err.message : err}`, 'error');
      renderIfFresh(getCurrentActionId(), 'memberRemove:error', epoch);
      return false;
    } finally {
      orgMemberActions.delete(userId);
      renderIfFresh(getCurrentActionId(), 'memberRemove:done', epoch);
    }
  }

  async function leaveWorkspace(orgId, orgName) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (_leaveWorkspaceInFlight || !normalizedOrgId) return false;

    _leaveWorkspaceInFlight = true;
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'workspaceLeave:begin', epoch);
    try {
      const result = await leaveWorkspaceFn(normalizedOrgId);
      if (!result || !result.ok) {
        UIComponents.showToast(
          result && result.error ? result.error : 'Failed to leave workspace.',
          'error',
          { title: 'Leave Workspace' },
        );
        renderIfFresh(getCurrentActionId(), 'workspaceLeave:error', epoch);
        return false;
      }

      const displayName = orgName ? String(orgName) : 'workspace';
      UIComponents.showToast(`You left ${displayName}.`, 'success', {
        title: 'Leave Workspace',
        duration: 6000,
      });

      try {
        if (
          typeof window !== 'undefined' &&
          window.TruckPackerApp &&
          typeof window.TruckPackerApp.handleWorkspaceLeft === 'function'
        ) {
          window.TruckPackerApp.handleWorkspaceLeft(normalizedOrgId, { source: 'settings-leave-workspace' });
        } else {
          queueAccountBundleRefresh({ force: true, source: 'settings-leave-workspace' });
        }
      } catch {
        queueAccountBundleRefresh({ force: true, source: 'settings-leave-workspace' });
      }

      close('workspace-left');
      return true;
    } catch (err) {
      UIComponents.showToast(
        `Failed to leave workspace: ${err && err.message ? err.message : err}`,
        'error',
        { title: 'Leave Workspace' },
      );
      renderIfFresh(getCurrentActionId(), 'workspaceLeave:error', epoch);
      return false;
    } finally {
      _leaveWorkspaceInFlight = false;
      if (isOpen()) renderIfFresh(getCurrentActionId(), 'workspaceLeave:done', epoch);
    }
  }

  async function restoreArchivedWorkspace(orgId, orgName) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId || restoreWorkspaceActions.has(normalizedOrgId)) return false;

    restoreWorkspaceActions.add(normalizedOrgId);
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'workspaceRestore:begin', epoch);
    try {
      const result = await restoreWorkspaceFn(normalizedOrgId);
      if (!result || !result.ok) {
        UIComponents.showToast(
          result && result.error ? result.error : 'Failed to restore workspace.',
          'error',
          { title: 'Restore Workspace' },
        );
        renderIfFresh(getCurrentActionId(), 'workspaceRestore:error', epoch);
        return false;
      }

      archivedWorkspacesData = (Array.isArray(archivedWorkspacesData) ? archivedWorkspacesData : [])
        .filter(row => normalizeOrgId(row && row.id ? row.id : '') !== normalizedOrgId);

      const displayName = orgName ? String(orgName) : 'workspace';
      UIComponents.showToast(`Restored ${displayName}.`, 'success', {
        title: 'Restore Workspace',
        duration: 6000,
      });

      try {
        if (
          typeof window !== 'undefined' &&
          window.TruckPackerApp &&
          typeof window.TruckPackerApp.handleWorkspaceRestored === 'function'
        ) {
          await window.TruckPackerApp.handleWorkspaceRestored(normalizedOrgId, { source: 'settings-restore-workspace' });
        } else {
          queueAccountBundleRefresh({ force: true, source: 'settings-restore-workspace' });
        }
      } catch {
        queueAccountBundleRefresh({ force: true, source: 'settings-restore-workspace' });
      }

      await loadArchivedWorkspaces({ force: true });
      queueAccountBundleRefresh({ force: true, source: 'settings-restore-workspace:done' });
      renderIfFresh(getCurrentActionId(), 'workspaceRestore:success', epoch);
      return true;
    } catch (err) {
      UIComponents.showToast(
        `Failed to restore workspace: ${err && err.message ? err.message : err}`,
        'error',
        { title: 'Restore Workspace' },
      );
      renderIfFresh(getCurrentActionId(), 'workspaceRestore:error', epoch);
      return false;
    } finally {
      restoreWorkspaceActions.delete(normalizedOrgId);
      if (isOpen()) renderIfFresh(getCurrentActionId(), 'workspaceRestore:done', epoch);
    }
  }

  function appendArchivedWorkspacesSection(targetEl, currentUserId) {
    if (!targetEl || !currentUserId) return;

    if (archivedWorkspacesData === null && !isLoadingArchivedWorkspaces) {
      const epoch = getOverlayEpoch();
      loadArchivedWorkspaces()
        .then(() => renderIfFresh(getCurrentActionId(), 'archived-workspaces:loaded', undefined, epoch))
        .catch(() => renderIfFresh(getCurrentActionId(), 'archived-workspaces:error', undefined, epoch));
    }

    const divider = doc.createElement('div');
    divider.className = 'tp3d-settings-org-divider';
    targetEl.appendChild(divider);

    const heading = doc.createElement('div');
    heading.className = 'tp3d-settings-section-heading';
    heading.textContent = 'Archived Workspaces';
    targetEl.appendChild(heading);

    const intro = doc.createElement('div');
    intro.className = 'muted tp3d-settings-meta tp3d-settings-mt-md';
    intro.textContent = 'Restore archived workspaces you own. Restoring only makes the workspace active again.';
    targetEl.appendChild(intro);

    if (isLoadingArchivedWorkspaces && archivedWorkspacesData === null) {
      const loading = doc.createElement('div');
      loading.className = 'muted tp3d-settings-meta';
      loading.textContent = 'Loading archived workspaces…';
      targetEl.appendChild(loading);
      return;
    }

    if (archivedWorkspacesError) {
      const error = doc.createElement('div');
      error.className = 'tp3d-org-feedback tp3d-org-feedback--error';
      error.textContent = 'Archived workspaces could not be loaded.';
      targetEl.appendChild(error);

      const retryActions = doc.createElement('div');
      retryActions.className = 'tp3d-account-actions';
      const retryBtn = doc.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-ghost';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        if (isLoadingArchivedWorkspaces) return;
        archivedWorkspacesData = null;
        loadArchivedWorkspaces({ force: true })
          .finally(() => render({ source: 'archived-workspaces:retry' }));
        render({ source: 'archived-workspaces:retry:start' });
      });
      retryActions.appendChild(retryBtn);
      targetEl.appendChild(retryActions);
      return;
    }

    const rows = Array.isArray(archivedWorkspacesData) ? archivedWorkspacesData : [];
    if (!rows.length) {
      const empty = doc.createElement('div');
      empty.className = 'muted tp3d-settings-meta';
      empty.textContent = 'No archived workspaces.';
      targetEl.appendChild(empty);
      return;
    }

    rows.forEach(org => {
      const orgId = normalizeOrgId(org && org.id ? org.id : '');
      if (!orgId) return;

      const row = doc.createElement('div');
      row.className = 'tp3d-settings-row';

      const left = doc.createElement('div');
      const name = doc.createElement('div');
      name.className = 'tp3d-settings-row-label';
      name.textContent = getArchivedWorkspaceName(org);
      left.appendChild(name);
      const dateText = getArchivedWorkspaceDate(org);
      if (dateText) {
        const meta = doc.createElement('div');
        meta.className = 'muted tp3d-settings-meta';
        meta.textContent = `Archived ${dateText}`;
        left.appendChild(meta);
      }
      row.appendChild(left);

      const right = doc.createElement('div');
      right.className = 'tp3d-account-actions';
      const isOwner = Boolean(org && org.owner_id && String(org.owner_id) === String(currentUserId));
      if (isOwner) {
        const restoring = restoreWorkspaceActions.has(orgId);
        const restoreBtn = doc.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn btn-primary';
        restoreBtn.textContent = restoring ? 'Restoring…' : 'Restore';
        restoreBtn.disabled = restoring;
        restoreBtn.addEventListener('click', async () => {
          if (restoreWorkspaceActions.has(orgId)) return;
          const targetName = getArchivedWorkspaceName(org);
          const confirmed = await UIComponents.confirm({
            title: 'Restore Workspace',
            message: `Restore "${targetName}"? It will appear in normal workspace switching again.`,
            okLabel: 'Restore Workspace',
            cancelLabel: 'Cancel',
          }).catch(() => false);
          if (confirmed) await restoreArchivedWorkspace(orgId, targetName);
        });
        right.appendChild(restoreBtn);
      } else {
        const ownerOnly = doc.createElement('div');
        ownerOnly.className = 'muted tp3d-settings-meta';
        ownerOnly.textContent = 'Only the primary owner can restore this workspace.';
        right.appendChild(ownerOnly);
      }

      row.appendChild(right);
      targetEl.appendChild(row);
    });
  }

  async function archiveWorkspace(orgId, orgName) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (_archiveWorkspaceInFlight || !normalizedOrgId) return false;

    _archiveWorkspaceInFlight = true;
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'workspaceArchive:begin', epoch);
    try {
      const result = await archiveWorkspaceFn(normalizedOrgId);
      if (!result || !result.ok) {
        UIComponents.showToast(
          result && result.error ? result.error : 'Failed to archive workspace.',
          'error',
          { title: 'Archive Workspace' },
        );
        renderIfFresh(getCurrentActionId(), 'workspaceArchive:error', epoch);
        return false;
      }

      const displayName = orgName ? String(orgName) : 'workspace';
      UIComponents.showToast(`Archived ${displayName}.`, 'success', {
        title: 'Archive Workspace',
        duration: 6000,
      });

      archivedWorkspacesData = null;
      loadArchivedWorkspaces({ force: true }).catch(() => null);

      try {
        if (
          typeof window !== 'undefined' &&
          window.TruckPackerApp &&
          typeof window.TruckPackerApp.handleWorkspaceArchived === 'function'
        ) {
          window.TruckPackerApp.handleWorkspaceArchived(normalizedOrgId, { source: 'settings-archive-workspace' });
        } else {
          queueAccountBundleRefresh({ force: true, source: 'settings-archive-workspace' });
        }
      } catch {
        queueAccountBundleRefresh({ force: true, source: 'settings-archive-workspace' });
      }

      close('workspace-archived');
      return true;
    } catch (err) {
      UIComponents.showToast(
        `Failed to archive workspace: ${err && err.message ? err.message : err}`,
        'error',
        { title: 'Archive Workspace' },
      );
      renderIfFresh(getCurrentActionId(), 'workspaceArchive:error', epoch);
      return false;
    } finally {
      _archiveWorkspaceInFlight = false;
      if (isOpen()) renderIfFresh(getCurrentActionId(), 'workspaceArchive:done', epoch);
    }
  }

  // ---- Organization invites ----

  async function transferOwnership(orgId, newOwnerId, orgName) {
    const normalizedOrgId = normalizeOrgId(orgId);
    const normalizedNewOwnerId = newOwnerId ? String(newOwnerId).trim() : '';
    if (_transferOwnershipInFlight || !normalizedOrgId || !normalizedNewOwnerId) {
      return { ok: false, error: 'Choose a workspace member to receive ownership.' };
    }

    _transferOwnershipInFlight = true;
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'ownershipTransfer:begin', epoch);
    try {
      const result = await transferOwnershipFn(normalizedOrgId, normalizedNewOwnerId);
      if (!result || !result.ok) {
        renderIfFresh(getCurrentActionId(), 'ownershipTransfer:error', epoch);
        return { ok: false, error: result && result.error ? result.error : 'Failed to transfer ownership.' };
      }

      if (orgData && normalizeOrgId(orgData.id || '') === normalizedOrgId) {
        orgData = {
          ...orgData,
          owner_id: result.new_owner_id || normalizedNewOwnerId,
          role: orgData.role === 'owner' ? 'admin' : orgData.role,
        };
      }
      if (membershipData && normalizeOrgId(membershipData.organization_id || '') === normalizedOrgId) {
        membershipData = { ...membershipData, role: 'admin' };
      }

      await loadOrgMembers(normalizedOrgId);
      queueAccountBundleRefresh({ force: true, source: 'settings-transfer-ownership' });
      try {
        if (
          typeof window !== 'undefined' &&
          window.TruckPackerApp &&
          typeof window.TruckPackerApp.handleOwnershipTransferred === 'function'
        ) {
          window.TruckPackerApp.handleOwnershipTransferred(normalizedOrgId, {
            source: 'settings-transfer-ownership',
            newOwnerId: result.new_owner_id || normalizedNewOwnerId,
          });
        } else {
          queueAccountBundleRefresh({ force: true, source: 'settings-transfer-ownership' });
        }
      } catch {
        queueAccountBundleRefresh({ force: true, source: 'settings-transfer-ownership' });
      }

      const displayName = orgName ? String(orgName) : 'workspace';
      UIComponents.showToast(`Ownership transferred for ${displayName}.`, 'success', {
        title: 'Transfer Ownership',
        duration: 6000,
      });
      renderIfFresh(getCurrentActionId(), 'ownershipTransfer:success', epoch);
      return {
        ok: true,
        organization_id: result.organization_id || normalizedOrgId,
        new_owner_id: result.new_owner_id || normalizedNewOwnerId,
      };
    } catch (err) {
      renderIfFresh(getCurrentActionId(), 'ownershipTransfer:error', epoch);
      return { ok: false, error: err && err.message ? err.message : 'Failed to transfer ownership.' };
    } finally {
      _transferOwnershipInFlight = false;
      if (isOpen()) renderIfFresh(getCurrentActionId(), 'ownershipTransfer:done', epoch);
    }
  }

  async function showTransferOwnershipModal(orgId, orgName, currentUserId) {
    const normalizedOrgId = normalizeOrgId(orgId);
    const actorId = currentUserId ? String(currentUserId).trim() : '';
    if (!normalizedOrgId || !actorId) return false;

    if (!Array.isArray(orgMembersData) || lastOrgMembersOrgId !== normalizedOrgId) {
      await loadOrgMembers(normalizedOrgId);
    }

    const transferCandidates = (Array.isArray(orgMembersData) ? orgMembersData : [])
      .filter(member => member && member.user_id && String(member.user_id) !== actorId);

    if (!transferCandidates.length) {
      UIComponents.showToast('Add another workspace member before transferring ownership.', 'warning', {
        title: 'Transfer Ownership',
      });
      return false;
    }

    const content = doc.createElement('div');
    const intro = doc.createElement('p');
    intro.className = 'muted tp3d-settings-meta';
    intro.textContent = 'Choose an existing workspace member to become the primary owner. You will become an Admin.';
    content.appendChild(intro);

    const label = doc.createElement('label');
    label.className = 'form-label';
    label.textContent = 'New owner';
    content.appendChild(label);

    const select = doc.createElement('select');
    select.className = 'select';
    select.setAttribute('aria-label', 'New workspace owner');
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a member';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    transferCandidates.forEach(member => {
      const opt = doc.createElement('option');
      opt.value = String(member.user_id);
      const memberName = getMemberDisplayName(member);
      const memberEmail = getMemberEmail(member);
      const role = getRoleLabel(member.role);
      opt.textContent = `${memberName}${memberEmail ? ` (${memberEmail})` : ''} - ${role}`;
      select.appendChild(opt);
    });
    content.appendChild(select);

    const errorMsg = doc.createElement('div');
    errorMsg.className = 'muted tp3d-settings-meta tp3d-settings-mt-sm';
    errorMsg.style.color = 'var(--error)';
    errorMsg.textContent = '';
    content.appendChild(errorMsg);

    let modalRef = null;
    modalRef = UIComponents.showModal({
      title: 'Transfer Ownership',
      content,
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Transfer Ownership',
          variant: 'danger',
          onClick: () => {
            if (modalRef && modalRef._tp3dTransferOwnershipInFlight) return false;
            const selectedUserId = String(select.value || '').trim();
            if (!selectedUserId) {
              errorMsg.textContent = 'Select a workspace member.';
              return false;
            }
            if (selectedUserId === actorId) {
              errorMsg.textContent = 'Choose another workspace member as the new owner.';
              return false;
            }

            modalRef._tp3dTransferOwnershipInFlight = true;
            const transferBtn =
              modalRef && modalRef.overlay
                ? modalRef.overlay.querySelector('.modal-footer button.btn-danger')
                : null;
            if (transferBtn) transferBtn.disabled = true;
            select.disabled = true;
            errorMsg.textContent = '';

            (async () => {
              const result = await transferOwnership(normalizedOrgId, selectedUserId, orgName);
              if (result && result.ok) {
                try {
                  modalRef && typeof modalRef.close === 'function' && modalRef.close();
                } catch {
                  // ignore
                }
                return;
              }

              errorMsg.textContent = result && result.error ? result.error : 'Failed to transfer ownership.';
              select.disabled = false;
              if (transferBtn) transferBtn.disabled = false;
              modalRef._tp3dTransferOwnershipInFlight = false;
            })();

            return false;
          },
        },
      ],
    });

    return true;
  }

  async function loadOrgInvites(orgId) {
    if (!orgId) return null;
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return null;
    // Modal-org guard: don't load invites for a different org than the one currently open.
    const currentModalOrgId = ensureModalOrgId();
    if (currentModalOrgId && currentModalOrgId !== normalizedOrgId) return null;
    const authCheck = await ensureAuthReadyForOrgOps('loadOrgInvites');
    if (!authCheck.ok) {
      debug('orgFetch:skip-no-token', { caller: 'loadOrgInvites', orgId: normalizedOrgId, code: authCheck.code });
      orgInvitesError = { message: 'Reconnecting\u2026', _authPending: true };
      _authGatePendingRetry = true;
      return null;
    }
    // Inflight reuse: if already fetching the same org, piggyback on that promise.
    if (isLoadingOrgInvites && orgInvitesInflightPromise && orgInvitesInflightOrgId === normalizedOrgId) {
      return orgInvitesInflightPromise;
    }
    // Different-org inflight: bump request id to cancel the stale result.
    if (isLoadingOrgInvites && orgInvitesInflightOrgId && orgInvitesInflightOrgId !== normalizedOrgId) {
      orgInvitesRequestId += 1;
    }
    const thisRequestId = ++orgInvitesRequestId;
    isLoadingOrgInvites = true;
    orgInvitesInflightOrgId = normalizedOrgId;
    orgInvitesError = null;
    const requestPromise = (async () => {
      try {
        const invites = await SupabaseClient.getOrganizationInvites(normalizedOrgId);
        if (thisRequestId !== orgInvitesRequestId) return null;
        // Second modal-org guard after await: org may have changed while fetch was in-flight.
        const currentModal = ensureModalOrgId();
        if (currentModal && currentModal !== normalizedOrgId) return null;
        orgInvitesData = Array.isArray(invites) ? invites : [];
        lastOrgInvitesOrgId = String(normalizedOrgId);
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
        if (orgInvitesInflightOrgId === normalizedOrgId) {
          orgInvitesInflightPromise = null;
          orgInvitesInflightOrgId = null;
        }
      }
    })();
    orgInvitesInflightPromise = requestPromise;
    return requestPromise;
  }

  function getInviteDeliveryToast(result, action = 'create') {
    const sent = Boolean(result && result.email_sent);
    if (sent) {
      return {
        message: 'Invite email sent. You can also copy the invite link.',
        type: 'success',
      };
    }
    return {
      message: action === 'resend'
        ? 'Invite link refreshed, but email was not sent. Use Copy Link to share it.'
        : 'Invite link created, but email was not sent. Use Copy Link to share it.',
      type: 'warning',
    };
  }

  async function sendInvite(orgId, email, role) {
    if (!orgId || !email) return null;
    const epoch = _renderEpoch;
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
      const toast = getInviteDeliveryToast(result, 'create');
      UIComponents.showToast(toast.message, toast.type, { title: 'Invites', actions: copyInviteAction });
      // Refresh invites list
      await loadOrgInvites(orgId);
      renderIfFresh(getCurrentActionId(), 'invite:send', epoch);
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
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'invite:revoke:begin', epoch);
    try {
      const result = await revokeOrgInviteFn(inviteId, orgId);
      if (!result || !result.ok) {
        UIComponents.showToast(result && result.error ? result.error : 'Revoke failed', 'error', { title: 'Invites' });
        renderIfFresh(getCurrentActionId(), 'invite:revoke:error', epoch);
        return false;
      }
      await loadOrgInvites(orgId);
      refreshMembershipContextAfterMutation(orgId, 'inviteRevoke:refresh-context');
      UIComponents.showToast('Invite revoked', 'success', { title: 'Invites' });
      renderIfFresh(getCurrentActionId(), 'invite:revoke', epoch);
      return true;
    } catch (err) {
      UIComponents.showToast('Revoke failed: ' + (err && err.message ? err.message : err), 'error', { title: 'Invites' });
      renderIfFresh(getCurrentActionId(), 'invite:revoke:error', epoch);
      return false;
    } finally {
      orgInviteActions.delete(inviteId);
      renderIfFresh(getCurrentActionId(), 'invite:revoke:done', epoch);
    }
  }

  async function resendInvite(orgId, invite) {
    if (!invite || !invite.id) return null;
    const inviteId = String(invite.id);
    if (orgInviteActions.has(inviteId)) return null;

    orgInviteActions.add(inviteId);
    const epoch = _renderEpoch;
    renderIfFresh(getCurrentActionId(), 'invite:resend:begin', epoch);
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
      const toast = getInviteDeliveryToast(result, 'resend');
      UIComponents.showToast(toast.message, toast.type, { title: 'Invites', actions: copyInviteAction });
      await loadOrgInvites(orgId);
      renderIfFresh(getCurrentActionId(), 'invite:resend', epoch);
      return result;
    } catch (err) {
      UIComponents.showToast('Resend failed: ' + (err && err.message ? err.message : err), 'error', { title: 'Invites' });
      renderIfFresh(getCurrentActionId(), 'invite:resend:error', epoch);
      return null;
    } finally {
      orgInviteActions.delete(inviteId);
      renderIfFresh(getCurrentActionId(), 'invite:resend:done', epoch);
    }
  }

  async function handleAvatarUpload(file) {
    const epoch = _renderEpoch;
    isUploadingAvatar = true;
    renderIfFresh(getCurrentActionId(), 'avatarUpload:begin', epoch);
    try {
      const publicUrl = await SupabaseClient.uploadAvatar(file);
      // Add cache-busting timestamp to force browser to reload image
      const cacheBustedUrl = publicUrl + '?t=' + Date.now();
      await SupabaseClient.updateProfile({ avatar_url: publicUrl });
      UIComponents.showToast('Avatar uploaded', 'success');
      await loadProfile();
      renderIfFresh(getCurrentActionId(), 'avatarUpload', epoch);
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
      renderIfFresh(getCurrentActionId(), 'avatarUpload:done', epoch);
    }
  }

  async function handleAvatarRemove() {
    const epoch = _renderEpoch;
    isUploadingAvatar = true;
    renderIfFresh(getCurrentActionId(), 'avatarRemove:begin', epoch);
    try {
      await SupabaseClient.deleteAvatar();
      await SupabaseClient.updateProfile({ avatar_url: null });
      UIComponents.showToast('Avatar removed', 'success');
      await loadProfile();
      renderIfFresh(getCurrentActionId(), 'avatarRemove', epoch);
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
      renderIfFresh(getCurrentActionId(), 'avatarRemove:done', epoch);
    }
  }

  function isOpen() {
    return Boolean(settingsOverlay);
  }

  function close(reason) {
    const _closeReason = typeof reason === 'string' && reason ? reason : 'unknown';
    if (!settingsOverlay) return;
    debug('[SettingsOverlay] close:called', {
      reason: _closeReason,
      tabId: _tabState.activeTabId,
      overlayOpen: Boolean(settingsOverlay && settingsOverlay.isConnected),
      overlayEpoch: _overlayEpoch,
      tabEpoch: _tabEpoch,
    });
    bumpEpoch('close');
    isUploadingAvatar = false;
    removeOrgChangedListener();
    removeOrgAccessLostListener();
    removeWorkspaceSwitchListener();
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
    // Clear members auto-retry timer
    if (_membersRetryTimer) { clearTimeout(_membersRetryTimer); _membersRetryTimer = null; }
    _membersRetryCount = 0;
    // Reset render trace counters
    _renderTraceSeq = 0;
    _lastRenderSigHash = 0;
    _lastRenderTabId = '';
    _lastRenderActionId = -1;
    _lastRenderAtMs = 0;
    _lastRenderStableKey = '';
    _debugRenderCallCount = 0;
    _callsiteLogCount = 0;
    _dupSignalMap.clear();
    _refreshAccountUIQueued = false;
    _refreshAccountUIPendingReason = null;
    _overlayOpenedAtMs = 0;
    _authGatePendingRetry = false;
    _lastAuthSnapshot = null;
    _renderScheduled = false;
    _deferredRender = null;
    _pendingRepaintByTab.clear();
    _tabActionToken = 0;
    _tabState.lastTabActionToken = 0;
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
    const candidate = normalizeTab(requested || saved || _tabState.activeTabId);
    if ((candidate === 'org-members' || candidate === 'org-billing') && !resolveInitialModalOrgId()) {
      return 'org-general';
    }
    return candidate;
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
    const currentTab = normalizeTab(_tabState.activeTabId);
    const source = String(meta.source || '');
    if (nextTab === currentTab && source !== 'open') {
      debug('setActiveTab:noop-same-tab', {
        tabId: nextTab,
        source: source || 'unknown',
        actionId: typeof meta.actionId === 'number' ? meta.actionId : _tabState.lastActionId,
        lastActionId: _tabState.lastActionId,
      });
      return;
    }
    bumpEpoch('setActiveTab:' + nextTab);
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
    const _setActiveToken = getTabActionToken();
    const counts = render({ source: 'setActiveTab:' + (meta.source || 'unknown'), tabToken: _setActiveToken });
    debug('setActiveTab', {
      tabId: nextTab,
      source: meta.source,
      actionId,
      lastActionId: _tabState.lastActionId,
      instanceId: settingsInstanceId,
      buttonCount: counts ? counts.buttonCount : 0,
      panelCount: counts ? counts.panelCount : 0,
      tabActionToken: _setActiveToken,
    });
    debugTabSnapshot('setActiveTab');

    // ── Pending repaint: apply data that arrived while another tab was active ──
    if (_pendingRepaintByTab.has(nextTab)) {
      const _pendingEntry = _pendingRepaintByTab.get(nextTab);
      _pendingRepaintByTab.delete(nextTab);
      // Apply only if the pending entry's token is current (i.e. for THIS tab activation)
      if (_pendingEntry && (typeof _pendingEntry.token !== 'number' || isTokenCurrent(_pendingEntry.token))) {
        debug('pendingRepaint:apply', { tab: nextTab, source: _pendingEntry.source, token: _pendingEntry.token });
        requestAnimationFrame(() => {
          if (isTokenCurrent(_setActiveToken) && _tabState.activeTabId === nextTab) {
            render({ source: 'pendingRepaint:' + nextTab, tabToken: _setActiveToken });
          }
        });
      } else {
        debug('pendingRepaint:drop-stale-token', { tab: nextTab, source: _pendingEntry && _pendingEntry.source, token: _pendingEntry && _pendingEntry.token, currentToken: _tabState.lastTabActionToken });
      }
    }

    // Billing tab: refresh only if stale (>30s), pending, loading, error, or org mismatch
    if (nextTab === 'org-billing') {
      const lockedOrgId = ensureModalOrgId();
      if (lockedOrgId) {
        ensureBillingContextHydrated(lockedOrgId, { source: 'org-billing:tab-activate' }).catch(() => { });
      }
      // Wrap in async to await auth-ready gate before triggering edge-function calls
      (async () => {
        const authCheck = await ensureAuthReadyForOrgOps('setActiveTab:org-billing');
        if (!authCheck.ok) {
          debug('billingFetch:skip-no-token', { caller: 'setActiveTab:org-billing', code: authCheck.code });
          _authGatePendingRetry = true;
          return;
        }
        const api = getBillingApiSafely();
        if (api && typeof api.refreshBilling === 'function' && lockedOrgId) {
          const bs = typeof api.getBillingState === 'function' ? api.getBillingState() : null;
          const ageMs = bs && bs.lastFetchedAt ? Date.now() - bs.lastFetchedAt : Infinity;
          const orgMatch = bs && bs.orgId ? normalizeOrgId(bs.orgId) === lockedOrgId : true;
          const needsRefresh = !bs || bs.pending || bs.loading || !bs.lastFetchedAt
            || ageMs > 30000 || bs.error || !bs.ok || !orgMatch;
          if (needsRefresh) {
            // Route through pump — never call refreshBilling directly from settings-overlay
            if (typeof window !== 'undefined' && window.TruckPackerApp && typeof window.TruckPackerApp.maybeScheduleBillingRefresh === 'function') {
              window.TruckPackerApp.maybeScheduleBillingRefresh('settings-billing-tab');
            } else {
              _callBillingPumpWithRetry('settings-billing-tab');
            }
            // Schedule a delayed re-render after billing data should have arrived
            const bsBefore = bs ? JSON.stringify({ ok: bs.ok, plan: bs.plan, orgId: bs.orgId }) : '';
            const _billingDelayToken = _setActiveToken;
            setTimeout(() => {
              if (!isOpen()) return;
              if (!isTokenCurrent(_billingDelayToken)) {
                debug('stale-token:drop', { source: 'billing-delayed-refresh', tabToken: _billingDelayToken, currentToken: _tabState.lastTabActionToken });
                return;
              }
              const apiLater = getBillingApiSafely();
              const bsLater = apiLater && typeof apiLater.getBillingState === 'function' ? apiLater.getBillingState() : null;
              const bsAfter = bsLater ? JSON.stringify({ ok: bsLater.ok, plan: bsLater.plan, orgId: bsLater.orgId }) : '';
              if (bsAfter !== bsBefore) {
                if (_tabState.activeTabId === 'org-billing') {
                  render({ source: 'billing-delayed-refresh', tabToken: _billingDelayToken });
                } else {
                  _pendingRepaintByTab.set('org-billing', { source: 'billing-delayed-refresh', token: _billingDelayToken });
                }
              }
            }, 1200);
          } else {
            debug('setActiveTab:skip-billing-fresh', {
              plan: bs.plan,
              ageMs,
              orgId: bs.orgId,
              lockedOrgId,
            });
          }
        }
      })().catch(() => { });
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
      const nextTab = normalizeTab(key);
      const currentTab = normalizeTab(_tabState.activeTabId);
      if (nextTab === currentTab) {
        debug('setActiveTab:noop-same-tab', {
          tabId: nextTab,
          source: 'click',
          actionId: _tabState.lastActionId,
          lastActionId: _tabState.lastActionId,
        });
        return;
      }
      _tabState.lastActionId += 1;
      debug('tab:click', { key, from: _tabState.activeTabId, nextActionId: _tabState.lastActionId });
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
    render({ source: 'setResourcesSubView' });
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
    const empty = doc.createElement('div');
    empty.className = 'tp3d-resources-empty';
    const icon = doc.createElement('div');
    icon.className = 'tp3d-resources-empty-icon';
    icon.innerHTML = '<i class="fa-solid fa-bell" aria-hidden="true"></i>';
    const titleEl = doc.createElement('div');
    titleEl.className = 'tp3d-resources-empty-title';
    titleEl.textContent = 'Release Notes';
    const bodyEl = doc.createElement('div');
    bodyEl.className = 'tp3d-resources-empty-body';
    bodyEl.textContent = 'Verified release notes will appear here as the product changes.';
    empty.appendChild(icon);
    empty.appendChild(titleEl);
    empty.appendChild(bodyEl);
    container.appendChild(empty);
  }

  // Render Roadmap content inside the modal
  function renderRoadmapContent(container) {
    const empty = doc.createElement('div');
    empty.className = 'tp3d-resources-empty';
    const icon = doc.createElement('div');
    icon.className = 'tp3d-resources-empty-icon';
    icon.innerHTML = '<i class="fa-solid fa-map" aria-hidden="true"></i>';
    const titleEl = doc.createElement('div');
    titleEl.className = 'tp3d-resources-empty-title';
    titleEl.textContent = 'Roadmap';
    const bodyEl = doc.createElement('div');
    bodyEl.className = 'tp3d-resources-empty-body';
    bodyEl.textContent = 'Published roadmap items will appear here when they are ready to share.';
    empty.appendChild(icon);
    empty.appendChild(titleEl);
    empty.appendChild(bodyEl);
    container.appendChild(empty);
  }

  function renderExportContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'tp3d-resources-view';

    const blurb = doc.createElement('div');
    blurb.className = 'muted tp3d-resources-text';
    blurb.textContent =
      'Download local packs, cases, folders, and preferences. Account login, workspace membership, billing, and payment data are not included.';

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
    exportBtn.textContent = 'Download App Backup';
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
      title: 'Import App Backup?',
      message:
        'This replaces local packs, cases, folders, and preferences in this browser. Your account login, workspace membership, billing, and payment data are kept. This cannot be undone.',
      danger: true,
      okLabel: 'Replace Local App Data',
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

      const summaryTitle = doc.createElement('div');
      summaryTitle.className = 'tp3d-import-summary-title';
      summaryTitle.textContent = 'Import Result';

      const summaryMeta = doc.createElement('div');
      summaryMeta.className = 'muted tp3d-import-summary-meta';
      summaryMeta.textContent = 'File: ' + String((file && file.name) || '');

      const summarySpacer = doc.createElement('div');
      summarySpacer.className = 'tp3d-import-summary-spacer';

      const badges = doc.createElement('div');
      badges.className = 'tp3d-import-badges';

      const packsBadge = doc.createElement('div');
      packsBadge.className = 'badge tp3d-import-badge-success';
      packsBadge.textContent = 'Packs: ' + String((imported.packLibrary || []).length);

      const casesBadge = doc.createElement('div');
      casesBadge.className = 'badge tp3d-import-badge-info';
      casesBadge.textContent = 'Cases: ' + String((imported.caseLibrary || []).length);

      badges.appendChild(packsBadge);
      badges.appendChild(casesBadge);

      summary.appendChild(summaryTitle);
      summary.appendChild(summaryMeta);
      summary.appendChild(summarySpacer);
      summary.appendChild(badges);
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
      <div class="tp3d-import-drop-icon" aria-hidden="true"><i class="fa-solid fa-file-import"></i></div>
      <div class="tp3d-import-drop-title">Drag &amp; Drop Backup File Here</div>
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
          <span class="tp3d-import-warning-text"> Importing an app backup replaces local packs, cases, folders, and preferences in this browser. Your account login, workspace membership, billing, and payment data are kept. Export an app backup first.</span>
        </div>
      </div>
    `;

    const results = doc.createElement('div');
    results.classList.add('tp3d-import-results');

    content.appendChild(hint);
    content.appendChild(drop);
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

    const helpItems = [
      {
        heading: 'App Backup',
        body: 'Exporting app backup downloads a JSON file with all packs, cases, folders, and preferences. Importing an app backup replaces all local app data. Export an app backup before importing.',
      },
      {
        heading: 'Workspace Backup',
        body: 'Exporting workspace backup downloads packs, cases, and folders for this workspace only. Workspace backup does not support import at this time.',
      },
      {
        heading: 'Pack JSON',
        body: 'Export Pack JSON (from the pack menu) downloads a single pack and its cases. Import Pack JSON adds that pack to your library without replacing other packs.',
      },
      {
        heading: 'Cases CSV/XLSX',
        body: 'Import Cases on the Cases screen uploads CSV or XLSX. Valid rows are added; duplicate names and invalid rows are skipped.',
      },
      {
        heading: 'Safety Tip',
        body: 'Export an app backup before large imports so you can restore if needed.',
        muted: true,
      },
    ];

    helpItems.forEach(({ heading, body, muted }) => {
      const card = doc.createElement('div');
      card.className = 'tp3d-resources-help-card';
      const headingEl = doc.createElement('div');
      headingEl.className = 'tp3d-resources-help-heading';
      headingEl.textContent = heading;
      const bodyEl = doc.createElement('div');
      bodyEl.className = muted ? 'tp3d-resources-help-body muted' : 'tp3d-resources-help-body';
      bodyEl.textContent = body;
      card.appendChild(headingEl);
      card.appendChild(bodyEl);
      wrap.appendChild(card);
    });

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
    const _perfBillingT0 = debugEnabled() && typeof performance !== 'undefined' ? performance.now() : 0;
    const api = getBillingApiSafely();
    const fallbackState = {
      ok: false,
      pending: true,
      loading: false,
      plan: null,
      status: null,
      entitlementStatus: null,
      billingOwnerUserId: null,
      workspaceIncluded: false,
      workspaceCount: null,
      workspaceLimit: null,
      canManageBilling: null,
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
    if (isLockedOrgAccessLost(lockedOrgId)) {
      while (targetEl.firstChild) targetEl.removeChild(targetEl.firstChild);
      appendOrgAccessLostNotice(targetEl, 'org-billing:lost-access:refresh');
      return;
    }
    if (!lockedOrgId) {
      let confirmedNoActiveWorkspace = false;
      try {
        confirmedNoActiveWorkspace = Boolean(
          accountBundleConfirmedNoActiveWorkspace ||
          (
            typeof window !== 'undefined' &&
            isConfirmedNoActiveWorkspaceBundle(window.__TP3D_LAST_ACCOUNT_BUNDLE || null)
          )
        );
      } catch {
        confirmedNoActiveWorkspace = Boolean(accountBundleConfirmedNoActiveWorkspace);
      }
      if (confirmedNoActiveWorkspace) {
        if (_tabState.activeTabId === 'org-billing') {
          setTimeout(() => {
            if (isOpen() && _tabState.activeTabId === 'org-billing') {
              setActiveTab('org-general', { source: 'org-billing:no-active' });
            }
          }, 0);
        }
        const noActiveMsg = doc.createElement('div');
        noActiveMsg.className = 'tp3d-org-feedback tp3d-org-feedback--warning';
        noActiveMsg.textContent = 'No active workspace is selected. Create a new workspace or restore an archived workspace when restore is available.';
        while (targetEl.firstChild) targetEl.removeChild(targetEl.firstChild);
        targetEl.appendChild(noActiveMsg);
        return;
      }
    }
    const currentOrgId = getOrgIdFromOrgContext();
    const billingOrgId = normalizeOrgId(state.orgId || '');
    const loading = Boolean(state.loading);
    const pending = Boolean(state.pending);
    const workspaceSwitch = getWorkspaceSwitchStateSafely();
    const workspaceSwitchTargetOrgId = normalizeOrgId(workspaceSwitch && workspaceSwitch.toOrgId ? workspaceSwitch.toOrgId : '');
    const workspaceSwitchFromOrgId = normalizeOrgId(workspaceSwitch && workspaceSwitch.fromOrgId ? workspaceSwitch.fromOrgId : '');
    const workspaceSwitchingForLockedOrg = isWorkspaceSwitchingForOrg(lockedOrgId, workspaceSwitch);
    const workspaceSwitchingBeforeLock = Boolean(
      workspaceSwitch &&
      workspaceSwitch.active &&
      workspaceSwitchTargetOrgId &&
      lockedOrgId &&
      lockedOrgId !== workspaceSwitchTargetOrgId &&
      (
        currentOrgId === workspaceSwitchTargetOrgId ||
        currentOrgId === workspaceSwitchFromOrgId ||
        lockedOrgId === workspaceSwitchFromOrgId
      )
    );
    const workspaceSwitchPending = Boolean(
      (workspaceSwitchingForLockedOrg || workspaceSwitchingBeforeLock) &&
      !(workspaceSwitch && workspaceSwitch.localStateReady && workspaceSwitch.orgReady && workspaceSwitch.billingReady)
    );
    if (shouldSuppressPreLockBillingTransition(state) && !workspaceSwitchPending) {
      return;
    }
    const billingMatchesSwitchTargetOrg = Boolean(
      workspaceSwitchPending &&
      workspaceSwitchTargetOrgId &&
      billingOrgId &&
      billingOrgId === workspaceSwitchTargetOrgId
    );
    const billingMatchesLockedOrg = Boolean(lockedOrgId && billingOrgId && billingOrgId === lockedOrgId);
    const billingMatchesRenderableOrg = Boolean(billingMatchesLockedOrg || billingMatchesSwitchTargetOrg);
    const staleOrgState = Boolean(lockedOrgId && billingOrgId && !billingMatchesRenderableOrg);
    const hasRenderableBillingState = Boolean(billingMatchesRenderableOrg && state.lastFetchedAt);
    const blankPendingState = Boolean(
      billingMatchesRenderableOrg &&
      (loading || pending) &&
      !state.plan &&
      !state.status &&
      !state.isActive &&
      !state.isPro
    );
    const workspaceSwitchHasUsableBilling = Boolean(
      workspaceSwitchPending &&
      billingMatchesRenderableOrg &&
      state.lastFetchedAt &&
      (state.ok || state.error) &&
      !blankPendingState
    );
    const workspaceSwitchNeedsSkeleton = Boolean(workspaceSwitchPending && !workspaceSwitchHasUsableBilling);
    const showSkeleton = Boolean(
      !lockedOrgId ||
      staleOrgState ||
      workspaceSwitchNeedsSkeleton ||
      blankPendingState ||
      ((loading || pending) && !hasRenderableBillingState)
    );
    const status = state.status ? String(state.status) : '';
    const entitlementStatus = normalizeEntitlementStatus(state.entitlementStatus);
    const isEntitlementAllowed = entitlementStatus === 'active' || entitlementStatus === 'trialing' || entitlementStatus === 'included_in_plan';
    const isIncludedInPlan = entitlementStatus === 'included_in_plan';
    const isWorkspaceLimitReached = entitlementStatus === 'workspace_limit_reached';
    const isOwnerSubscriptionRequired = entitlementStatus === 'owner_subscription_required';
    const isBillingUnavailable = entitlementStatus === 'billing_unavailable';
    const isTrial = entitlementStatus ? entitlementStatus === 'trialing' : status === 'trialing';
    const isProOrTrial = entitlementStatus ? isEntitlementAllowed : Boolean(state.isPro && state.isActive);
    const isFreeWorkspaceState = Boolean(
      !isProOrTrial &&
      !isWorkspaceLimitReached &&
      !isOwnerSubscriptionRequired &&
      !isBillingUnavailable &&
      (status === '' || status === 'none' || status === 'canceled')
    );
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
    const _trialWelcomeShown = (() => {
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
    const canManageBilling = typeof state.canManageBilling === 'boolean' ? state.canManageBilling : billingRole === 'owner';
    const orgProfileLoaded = hasOrgProfileForOrg(lockedOrgId);
    const billingContextInflightForOrg = Boolean(
      lockedOrgId &&
      (
        (billingContextInflightPromise && billingContextInflightOrgId === lockedOrgId) ||
        billingContextStartingOrgId === lockedOrgId
      )
    );
    const billingContextLoading = billingContextInflightForOrg;
    if (lockedOrgId && (!orgProfileLoaded || !roleKnown) && !billingContextInflightForOrg) {
      ensureBillingContextHydrated(lockedOrgId, { source: 'org-billing:render' }).catch(() => { });
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
    const transientOrgName = !orgMatchesLocked ? getTransientBillingOrgName(lockedOrgId) : '';
    const hasSafeFallbackOrgName = Boolean(lockedOrgId && transientOrgName);
    const orgName = orgMatchesLocked && orgData && orgData.name
      ? String(orgData.name)
      : (lockedOrgId ? (workspaceSwitchNeedsSkeleton ? 'Switching workspace...' : (transientOrgName || 'Loading workspace…')) : 'Personal Workspace');

    const orgSection = doc.createElement('div');
    orgSection.className = 'tp3d-settings-billing';

    const orgHeading = doc.createElement('div');
    orgHeading.className = 'tp3d-settings-billing-title';
    orgHeading.textContent = 'Workspace';
    orgSection.appendChild(orgHeading);

    const orgRow = doc.createElement('div');
    orgRow.className = 'tp3d-settings-row';

    const orgLabel = doc.createElement('div');
    orgLabel.className = 'tp3d-settings-row-label';
    orgLabel.textContent = 'Workspace';
    orgRow.appendChild(orgLabel);

    const orgValue = doc.createElement('div');
    orgValue.className = 'row';

    if (workspaceSwitchNeedsSkeleton || (lockedOrgId && !orgMatchesLocked && billingContextLoading)) {
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
      orgAvatarEl.classList.add('tp3d-billing-avatar-initials');
      orgAvatarEl.textContent = orgName.charAt(0).toUpperCase();
      const orgId = orgMatchesLocked ? String(orgDataId) : '';
      const logoKey = orgId + '|' + (orgLogoPath || orgAvatarSafe || '');
      const cachedLogoSrc = logoKey && lastOrgLogoKey === logoKey && lastOrgLogoExpiresAt > Date.now()
        ? lastOrgLogoUrl
        : null;
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
            lastOrgLogoExpiresAt = Date.now() + ORG_LOGO_CACHE_TTL_MS;
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
            if (orgImg.parentNode) orgImg.parentNode.replaceChild(orgAvatarEl, orgImg);
            avatarNode = orgAvatarEl;
          };
        };
        loadLogo().catch(() => { });
      }
      const orgNameSpan = doc.createElement('span');
      orgNameSpan.textContent = orgName;
      orgValue.appendChild(orgNameSpan);
    }
    orgRow.appendChild(orgValue);

    orgSection.appendChild(orgRow);

    if (orgContextStalled && !hasSafeFallbackOrgName) {
      const orgHelper = doc.createElement('div');
      orgHelper.className = 'muted tp3d-members-inline-helper';
      orgHelper.textContent = 'Workspace details are not available yet. Try Refresh.';
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
      const loadingText = doc.createElement('div');
      loadingText.className = 'muted tp3d-members-inline-helper';
      const billingLoadingTarget = orgName && orgName !== 'Switching workspace...' && orgName !== 'Loading workspace…'
        ? ` for ${orgName}`
        : '';
      loadingText.textContent = `Loading billing${billingLoadingTarget}…`;
      planCard.appendChild(loadingText);

      const skeletonGroup = doc.createElement('div');
      skeletonGroup.className = 'tp3d-skeleton-group tp3d-skel';
      skeletonGroup.innerHTML = `
        <div class="tp3d-skel-line tp3d-skeleton-title"></div>
        <div class="tp3d-skel-line tp3d-skeleton-short"></div>
        <div class="tp3d-skel-line tp3d-skeleton-short"></div>
      `;
      planCard.appendChild(skeletonGroup);
    } else if (!state.ok || state.error || isBillingUnavailable) {
      // Billing unavailable: covers error responses AND any non-success state (ok=false).
      // Do NOT fall through to plan info / Subscribe CTA when billing status is unknown.
      const errMsg = doc.createElement('div');
      errMsg.className = 'tp3d-org-feedback tp3d-org-feedback--error';
      errMsg.textContent = 'Billing unavailable. Pro-only actions are temporarily disabled until billing refreshes.';
      planCard.appendChild(errMsg);

      const retryBtn = doc.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn tp3d-settings-mt-sm';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Retrying\u2026';
        retryBtn.setAttribute('aria-busy', 'true');
        const refreshPromise = api && typeof api.refreshBilling === 'function'
          ? api.refreshBilling({ force: true, reason: 'settings-billing-retry' })
          : Promise.resolve();
        Promise.resolve(refreshPromise)
          .catch(() => { })
          .finally(() => {
            retryBtn.removeAttribute('aria-busy');
            retryBtn.disabled = false;
            retryBtn.textContent = 'Retry';
            renderCurrentBillingTabAfterRefresh('settings-billing-retry');
          });
      });
      planCard.appendChild(retryBtn);

      const retryHint = doc.createElement('div');
      retryHint.className = 'muted tp3d-settings-meta tp3d-settings-mt-xs';
      retryHint.textContent = 'Retry may take longer on a slow connection.';
      planCard.appendChild(retryHint);
    } else {
      // Plan header row
      const planHeader = doc.createElement('div');
      planHeader.className = 'row';

      const planName = doc.createElement('div');
      planName.className = 'tp3d-settings-billing-title';
      if (isTrial) {
        planName.textContent = 'Pro (Trial)';
      } else if (isIncludedInPlan) {
        planName.textContent = 'Pro';
      } else if (isWorkspaceLimitReached) {
        planName.textContent = 'Pro';
      } else if (isProOrTrial) {
        planName.textContent = intervalLabel ? `Pro (${intervalLabel})` : 'Pro';
      } else {
        planName.textContent = 'Free';
      }
      planHeader.appendChild(planName);

      const planBadge = doc.createElement('span');
      planBadge.className = 'badge' + (isProOrTrial ? ' badge--active' : ' badge--free');
      planBadge.textContent = isIncludedInPlan
        ? 'Included'
        : isWorkspaceLimitReached
          ? 'Not Included'
          : 'Current Plan';
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
      } else if (isProOrTrial && !isTrial && state.currentPeriodEnd) {
        const renewDate = new Date(state.currentPeriodEnd);
        const renewText = isNaN(renewDate.getTime()) ? String(state.currentPeriodEnd) : renewDate.toLocaleDateString();
        const renewBadge = doc.createElement('span');
        renewBadge.className = 'badge badge--pending';
        renewBadge.textContent = 'Auto-renew';
        planHeader.appendChild(renewBadge);
        const renewInline = doc.createElement('span');
        renewInline.className = 'tp3d-billing-cancel-inline tp3d-org-feedback tp3d-org-feedback--warning';
        renewInline.textContent = 'Renews on ' + renewText;
        planHeader.appendChild(renewInline);
      }

      if (isTrial && !isCancelScheduled && trialDaysLeft !== null) {
        const trialBadge = doc.createElement('span');
        trialBadge.className = 'badge badge--pending';
        trialBadge.textContent = trialDaysLeft + ' day' + (trialDaysLeft !== 1 ? 's' : '') + ' left';
        planHeader.appendChild(trialBadge);
      } else if (isTrial && !isCancelScheduled) {
        const trialBadge = doc.createElement('span');
        trialBadge.className = 'badge badge--pending';
        trialBadge.textContent = 'Trial';
        planHeader.appendChild(trialBadge);
      } else if (trialDaysLeft !== null) {
        const daysEl = doc.createElement('span');
        daysEl.className = 'muted';
        daysEl.textContent = trialDaysLeft + ' day' + (trialDaysLeft !== 1 ? 's' : '') + ' left';
        planHeader.appendChild(daysEl);
      }

      planCard.appendChild(planHeader);

      // Status / cancellation info
      const statusLine = doc.createElement('div');
      statusLine.className = 'muted tp3d-settings-mt-xs';
      const setStatusLineTone = tone => {
        if (tone === 'warning') {
          statusLine.className = 'tp3d-org-feedback tp3d-org-feedback--warning tp3d-settings-mt-xs';
        } else if (tone === 'error') {
          statusLine.className = 'tp3d-org-feedback tp3d-org-feedback--error tp3d-settings-mt-xs';
        } else {
          statusLine.className = 'muted tp3d-members-inline-helper tp3d-settings-mt-xs';
        }
      };

      if (isIncludedInPlan) {
        setStatusLineTone('neutral');
        statusLine.textContent = canManageBilling
          ? 'This workspace is covered by your current plan.'
          : 'This workspace is covered by the workspace owner\u2019s plan.';
      } else if (isWorkspaceLimitReached) {
        setStatusLineTone('warning');
        statusLine.textContent = canManageBilling
          ? `Your plan includes ${Number(state.workspaceLimit || 0)} workspace(s). ${Number(state.workspaceCount || 0)} workspace(s) count toward that limit, including archived workspaces. Upgrade your plan to include this workspace.`
          : 'This workspace is not in the owner’s plan. Ask the workspace owner to upgrade the plan or free a workspace slot.';
      } else if (isOwnerSubscriptionRequired) {
        setStatusLineTone('error');
        statusLine.textContent = canManageBilling
          ? 'Start a subscription to enable Pro features.'
          : 'The workspace owner needs to start or restore a subscription before Pro features are available.';
      } else if (isTrial) {
        // days-left badge in header row is the single source of truth; no status line needed
      } else if (!isProOrTrial && status === 'trial_expired') {
        setStatusLineTone('error');
        statusLine.textContent = 'Your free trial has ended.';
      } else if (isFreeWorkspaceState) {
        statusLine.textContent = 'No active subscription. This workspace is on the Free plan.';
      } else if (!isProOrTrial && status) {
        statusLine.textContent = 'Status: ' + status.replace(/_/g, ' ');
      }

      if (statusLine.textContent && statusLine.textContent !== cancelEndText) {
        planCard.appendChild(statusLine);
      }
    }

    subSection.appendChild(planCard);

    // --- Payment problem warning card ---
    if (!showSkeleton && !loading && !pending && state.ok && !isBillingUnavailable && state.paymentProblem && status !== 'trial_expired') {
      const payCard = doc.createElement('div');
      payCard.className = 'tp3d-billing-payment-warning';

      const payIcon = doc.createElement('span');
      payIcon.textContent = '\u26A0\uFE0F'; // ⚠️
      payCard.appendChild(payIcon);

      const payBody = doc.createElement('div');
      payBody.className = 'tp3d-billing-payment-body';

      const payTitle = doc.createElement('div');
      payTitle.className = 'tp3d-billing-payment-title';
      payTitle.textContent = 'Payment issue';
      payBody.appendChild(payTitle);

      const graceDays = Number(state.paymentGraceRemainingDays) || 0;
      const graceText = graceDays > 0
        ? graceDays + ' day' + (graceDays === 1 ? '' : 's') + ' remaining before Pro features are disabled.'
        : 'Pro features have been disabled until payment is resolved.';
      const payDesc = doc.createElement('div');
      payDesc.className = 'muted tp3d-billing-payment-desc';
      payDesc.textContent = graceText;
      payBody.appendChild(payDesc);

      payCard.appendChild(payBody);

      if (canManageBilling && portalAvailable && api && typeof api.openPortal === 'function') {
        const fixBtn = doc.createElement('button');
        fixBtn.type = 'button';
        fixBtn.className = 'btn btn-primary';
        fixBtn.textContent = 'Fix payment';
        fixBtn.addEventListener('click', () => { api.openPortal(); });
        payCard.appendChild(fixBtn);
      }

      subSection.appendChild(payCard);
    }

    // Upgrade CTA card — shown for Free users and Trial users; hidden only for paid active Pro.
    const isActivePaidPro = isProOrTrial && !isTrial;
    if (!showSkeleton && !loading && !pending && state.ok && !state.error && !isBillingUnavailable && !isActivePaidPro && roleKnown && canManageBilling) {
      const ctaCard = doc.createElement('div');
      ctaCard.className = 'tp3d-billing-pro-cta';

      // Left column: icon + title + supporting text
      const ctaLeft = doc.createElement('div');
      ctaLeft.className = 'tp3d-billing-pro-cta__left';

      const ctaIcon = doc.createElement('span');
      ctaIcon.className = 'tp3d-billing-pro-cta__icon';
      ctaIcon.textContent = '\uD83D\uDCE6'; // 📦
      ctaLeft.appendChild(ctaIcon);

      // Text block: title + sub stacked vertically, sits next to the icon
      const ctaBody = doc.createElement('div');
      ctaBody.className = 'tp3d-billing-pro-cta__body';

      const ctaTitle = doc.createElement('div');
      ctaTitle.className = 'tp3d-billing-pro-cta__title';
      ctaTitle.textContent = 'Truck Packer Pro 3D';
      ctaBody.appendChild(ctaTitle);

      const ctaDesc = doc.createElement('div');
      ctaDesc.className = 'tp3d-billing-pro-cta__sub';
      if (isWorkspaceLimitReached) {
        ctaDesc.textContent = 'Upgrade your plan or remove another workspace to include this workspace.';
      } else if (isOwnerSubscriptionRequired) {
        ctaDesc.textContent = 'Start a subscription to enable Pro features.';
      } else if (status === 'trial_expired') {
        ctaDesc.textContent = 'Your trial has ended. Subscribe to continue using Pro features.';
      } else if (isTrial) {
        ctaDesc.textContent = 'Subscribe to keep using Truck Packer after your free trial ends, cancel anytime.';
      } else {
        ctaDesc.textContent = 'Start a subscription to enable Pro features. Cancel anytime.';
      }
      ctaBody.appendChild(ctaDesc);

      ctaLeft.appendChild(ctaBody);
      ctaCard.appendChild(ctaLeft);

      // Right column: Subscribe button, vertically centered
      const ctaRight = doc.createElement('div');
      ctaRight.className = 'tp3d-billing-pro-cta__right';

      const subBtn = doc.createElement('button');
      subBtn.type = 'button';
      subBtn.className = 'btn btn-primary';
      const overLimitManageBilling = Boolean(isWorkspaceLimitReached && canManageBilling && portalAvailable && api && typeof api.openPortal === 'function');
      subBtn.textContent = overLimitManageBilling
        ? 'Manage Billing'
        : isWorkspaceLimitReached
          ? 'Upgrade Plan'
          : 'Subscribe';
      subBtn.addEventListener('click', () => {
        if (overLimitManageBilling) {
          subBtn.disabled = true;
          subBtn.textContent = 'Redirecting\u2026';
          api.openPortal().then((r) => {
            if (!r.ok) {
              if (UIComponents) UIComponents.showToast(r.error || 'Portal session failed', 'error', { title: 'Billing' });
              subBtn.disabled = false;
              subBtn.textContent = 'Manage Billing';
            }
          }).catch(() => {
            subBtn.disabled = false;
            subBtn.textContent = 'Manage Billing';
          });
          return;
        }
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
              subBtn.textContent = isWorkspaceLimitReached ? 'Upgrade Plan' : 'Subscribe';
            }
          }).catch(() => {
            subBtn.disabled = false;
            subBtn.textContent = isWorkspaceLimitReached ? 'Upgrade Plan' : 'Subscribe';
          });
        }).catch(() => {
          if (UIComponents) UIComponents.showToast('Checkout failed', 'error', { title: 'Billing' });
        });
      });
      ctaRight.appendChild(subBtn);
      ctaCard.appendChild(ctaRight);

      subSection.appendChild(ctaCard);
    } else if (!showSkeleton && !loading && !pending && state.ok && !state.error && !isBillingUnavailable && !isActivePaidPro && roleKnown && !canManageBilling) {
      const note = doc.createElement('div');
      note.className = 'muted tp3d-settings-mt-sm';
      if (isWorkspaceLimitReached) {
        note.textContent = 'Ask the workspace owner to upgrade the plan or free a workspace slot.';
      } else if (isOwnerSubscriptionRequired) {
        note.textContent = 'Ask the workspace owner to start or restore the subscription.';
      } else {
        // TODO: replace support@pxl360.com with the real support email later.
        const noteText = doc.createTextNode('Ask the workspace owner to start or restore the subscription or contact support: ');
        note.appendChild(noteText);
        const supportLink = doc.createElement('a');
        supportLink.href = 'mailto:support@pxl360.com';
        supportLink.textContent = 'support@pxl360.com';
        note.appendChild(supportLink);
      }
      subSection.appendChild(note);
    } else if (!showSkeleton && !loading && !pending && state.ok && !state.error && !isBillingUnavailable && !isActivePaidPro && !roleKnown) {
      const note = doc.createElement('div');
      note.className = 'muted tp3d-settings-mt-sm';
      note.textContent = 'Checking billing access…';
      subSection.appendChild(note);
    }

    const roleLoading = Boolean(lockedOrgId && !roleKnown && billingContextInflightForOrg);
    let manageDisabledReason = '';
    if (!lockedOrgId) {
      manageDisabledReason = 'Select a workspace to manage billing.';
    } else if (loading || pending || staleOrgState) {
      manageDisabledReason = 'Refreshing billing details…';
    } else if (roleLoading) {
      manageDisabledReason = 'Checking billing access…';
    } else if (roleKnown && !canManageBilling) {
      manageDisabledReason = 'Only the org owner can manage billing.';
    } else if (isBillingUnavailable) {
      manageDisabledReason = "Billing portal isn't available while billing is unavailable. Try Refresh.";
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
    } else if (roleKnown && !canManageBilling) {
      // Non-owners: no action buttons at all
    } else {
      // Action buttons row
      const actionsRow = doc.createElement('div');
      actionsRow.className = 'row tp3d-billing-actions';

      const manageWrap = doc.createElement('span');
      manageWrap.className = 'tp3d-billing-manage-wrap';
      const manageBtn = doc.createElement('button');
      manageBtn.type = 'button';
      manageBtn.className = 'btn';
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
      // Manage is only relevant for active paid Pro users.
      const showManage = isActivePaidPro && portalAvailable;
      if (showManage) actionsRow.appendChild(manageWrap);

      const refreshBtn = doc.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'btn btn-ghost';
      refreshBtn.textContent = 'Refresh';
      refreshBtn.disabled = Boolean(loading || !lockedOrgId);
      refreshBtn.addEventListener('click', () => {
        if (!lockedOrgId) return;
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing\u2026';
        refreshBtn.setAttribute('aria-busy', 'true');
        const hydratePromise = ensureBillingContextHydrated(lockedOrgId, { force: true, source: 'org-billing:refresh' });
        const refreshPromise = api && typeof api.refreshBilling === 'function'
          ? api.refreshBilling({ force: true, reason: 'settings-billing-refresh' })
          : Promise.resolve();
        Promise.allSettled([hydratePromise, refreshPromise])
          .then(() => renderCurrentBillingTabAfterRefresh('settings-billing-refresh'))
          .finally(() => {
            refreshBtn.removeAttribute('aria-busy');
            refreshBtn.disabled = Boolean(loading || !lockedOrgId);
            refreshBtn.textContent = 'Refresh';
          });
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
    if (_perfBillingT0) {
      debug('renderBillingInto:perf', { ms: Number((performance.now() - _perfBillingT0).toFixed(1)) });
    }
  }

  function renderCurrentBillingTabAfterRefresh(source = 'billing-refresh') {
    if (!settingsOverlay || !isOpen() || _tabState.activeTabId !== 'org-billing') return;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : fn => setTimeout(fn, 0);
    schedule(() => {
      if (!settingsOverlay || !isOpen() || _tabState.activeTabId !== 'org-billing') return;
      const wrap = doc.getElementById('tp3d-billing-wrap');
      if (!wrap) return;
      try {
        renderBillingInto(wrap);
      } catch (err) {
        debug('billing refresh repaint failed', { source, err });
      }
    });
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

  function render(renderMeta) {
    if (!settingsOverlay) {
      return null;
    }
    // ── Render coalescer: at most one full DOM rebuild per animation frame ──
    // pendingRepaint sources always bypass so data-arrival repaints are never dropped.
    // All other sources that arrive while a render is in-flight are DEFERRED (not dropped):
    // stored in _deferredRender and re-fired on the next animation frame.
    const _renderSourcePeek = (renderMeta && renderMeta.source) || 'unknown';
    const _renderTokenPeek = renderMeta && typeof renderMeta.tabToken === 'number' ? renderMeta.tabToken : null;
    if (_renderScheduled && !_renderSourcePeek.startsWith('pendingRepaint:')) {
      // Only defer if token is current (or absent — overlay-level source)
      if (_renderTokenPeek !== null && !isTokenCurrent(_renderTokenPeek)) {
        debug('coalesced:drop-stale-token', { source: _renderSourcePeek, tabToken: _renderTokenPeek, currentToken: _tabState.lastTabActionToken });
        return null;
      }
      _deferredRender = { source: _renderSourcePeek, tabToken: _renderTokenPeek };
      debug('render:coalesced:deferred', { source: _renderSourcePeek, tab: _tabState.activeTabId, tabToken: _renderTokenPeek });
      return null;
    }
    if (!_renderScheduled) {
      _renderScheduled = true;
      requestAnimationFrame(() => {
        _renderScheduled = false;
        // Re-fire any render that was deferred while this frame was running.
        if (_deferredRender && settingsOverlay && isOpen()) {
          const _dr = _deferredRender;
          _deferredRender = null;
          // Token check: only fire if still current (or no token = overlay-level)
          if (_dr.tabToken === null || isTokenCurrent(_dr.tabToken)) {
            requestAnimationFrame(() => {
              if (settingsOverlay && isOpen()) {
                render({ source: 'coalesced:deferred:' + _dr.source, tabToken: _dr.tabToken });
              }
            });
          } else {
            debug('coalesced:drop-stale-token:deferred', { source: _dr.source, tabToken: _dr.tabToken, currentToken: _tabState.lastTabActionToken });
          }
        } else {
          _deferredRender = null;
        }
      });
    }
    const _renderSource = (renderMeta && renderMeta.source) || 'unknown';
    debugRenderCall(_renderSource);

    // ── No-op render guard: skip exact duplicate renders within 50ms ──
    {
      const stableKey = _buildRenderStableKey();
      const isPendingRepaint = typeof _renderSource === 'string' && _renderSource.startsWith('pendingRepaint:');
      if (!isPendingRepaint && stableKey && stableKey === _lastRenderStableKey) {
        const _dedupTarget = _getTargetTabForSource(_renderSource);
        if (_dedupTarget && _dedupTarget !== _tabState.activeTabId) {
          _pendingRepaintByTab.set(_dedupTarget, { source: _renderSource, token: getTabActionToken() });
        }
        debug('render:skip-same-key', {
          source: _renderSource,
          tabId: _tabState.activeTabId,
          actionId: _tabState.lastActionId,
          renderKey: stableKey,
        });
        return null;
      }

      const api = getBillingApiSafely();
      const bs = api && typeof api.getBillingState === 'function' ? api.getBillingState() : null;
      const workspaceSwitch = _tabState.activeTabId === 'org-billing' ? getWorkspaceSwitchStateSafely() : null;
      const sigObj = {
        iid: settingsInstanceId,
        tab: _tabState.activeTabId,
        aid: _tabState.lastActionId,
        rsv: resourcesSubView,
        bl: bs ? { ok: bs.ok, ld: bs.loading, pd: bs.pending, pl: bs.plan, st: bs.status,
          ...(_tabState.activeTabId === 'org-billing' ? { oid: bs.orgId || null, lfa: bs.lastFetchedAt || 0 } : {}) } : null,
        ep: isEditingProfile,
        lp: isLoadingProfile,
        sp: isSavingProfile,
        eo: isEditingOrg,
        lo: isLoadingOrg,
        lm: isLoadingMembership,
        lab: isLoadingAccountBundle,
        ho: Boolean(modalOrgId),
        ws: workspaceSwitch ? {
          active: Boolean(workspaceSwitch.active),
          toOrgId: normalizeOrgId(workspaceSwitch.toOrgId || ''),
          version: Number(workspaceSwitch.version || 0) || 0,
          localStateReady: Boolean(workspaceSwitch.localStateReady),
          orgReady: Boolean(workspaceSwitch.orgReady),
          billingReady: Boolean(workspaceSwitch.billingReady),
        } : null,
        // Members-related state
        lom: isLoadingOrgMembers,
        hm: Boolean(orgMembersData && Array.isArray(orgMembersData) && orgMembersData.length > 0),
        me: Boolean(orgMembersError),
        moid: lastOrgMembersOrgId || '',
        // Org data presence
        hod: Boolean(orgData && orgData.id),
        hmd: Boolean(membershipData && membershipData.organization_id),
        // Invites
        li: isLoadingOrgInvites,
        hi: Boolean(orgInvitesData),
      };
      const sigStr = JSON.stringify(sigObj);
      const sigHash = _djb2(sigStr);
      const now = Date.now();
      const sameHash = sigHash === _lastRenderSigHash;
      const sameTab = _tabState.activeTabId === _lastRenderTabId;
      const sameAction = _tabState.lastActionId === _lastRenderActionId;
      if (sameHash && sameTab && sameAction && (now - _lastRenderAtMs) < 50) {
        // Allow pendingRepaint sources to bypass dedupe — the data IS new
        if (!isPendingRepaint) {
          // If a tab-scoped source fires while on a different tab, queue a pending repaint
          // so the data isn't silently dropped (covers the 50ms time-window dedup case)
          const _dedupTarget = _getTargetTabForSource(_renderSource);
          if (_dedupTarget && _dedupTarget !== _tabState.activeTabId) {
            _pendingRepaintByTab.set(_dedupTarget, { source: _renderSource, token: getTabActionToken() });
          }
          debug('render:skip-duplicate', {
            source: _renderSource,
            tabId: _tabState.activeTabId,
            actionId: _tabState.lastActionId,
            dtMs: now - _lastRenderAtMs,
            sig: sigStr,
          });
          return null;
        }
      }
      _lastRenderSigHash = sigHash;
      _lastRenderTabId = _tabState.activeTabId;
      _lastRenderActionId = _tabState.lastActionId;
      _lastRenderAtMs = now;
      _lastRenderStableKey = stableKey;
      if (debugEnabled() && _tabState.activeTabId === 'org-billing' && bs && (bs.lastFetchedAt || 0) > _lastOrgBillingRenderLfa) {
        _lastOrgBillingRenderLfa = bs.lastFetchedAt || 0;
        debug('org-billing:repaint-billing-change', { ok: bs.ok, plan: bs.plan, lfa: bs.lastFetchedAt });
      }

      // Debug trace (with stack for first 10 renders)
      if (debugEnabled()) {
        _renderTraceSeq += 1;
        const tracePayload = {
          seq: _renderTraceSeq,
          source: _renderSource,
          instanceId: settingsInstanceId,
          actionId: _tabState.lastActionId,
          stateTabId: _tabState.activeTabId,
          sigHash,
          ts: now,
        };
        if (_renderTraceSeq <= 10) {
          try {
            const st = (new Error()).stack || '';
            tracePayload.stackFrames = st.split('\n').filter(l => l.trim()).slice(1, 5).map(f => f.trim());
          } catch { /* ignore */ }
        }
        debug('render:trace', tracePayload);
      }
    }

    const _perfRenderT0 = debugEnabled() && typeof performance !== 'undefined' ? performance.now() : 0;
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
      (isLoadingAccountBundle || isLoadingMembership || isLoadingOrg ||
        (_overlayOpenedAtMs > 0 && (Date.now() - _overlayOpenedAtMs) < _ORG_READY_GRACE_MS))
    );
    if (!hasOrg && !isOrgHydrating && (_tabState.activeTabId === 'org-members' || _tabState.activeTabId === 'org-billing')) {
      _tabState.activeTabId = 'org-general';
      persistTab('org-general');
    }
    const accountBtn = doc.createElement('button');
    accountBtn.type = 'button';
    accountBtn.className = 'btn';
    accountBtn.classList.add('tp3d-settings-account-btn');
    accountBtn.classList.add('tp3d-settings-profile-card');
    const accountInner = doc.createElement('span');
    accountInner.className = 'tp3d-settings-account-inner';
    const accountAvatar = doc.createElement('span');
    accountAvatar.className = 'brand-mark tp3d-settings-account-avatar';
    accountAvatar.setAttribute('aria-hidden', 'true');
    accountAvatar.textContent = userView.initials || '';
    const accountText = doc.createElement('span');
    accountText.className = 'tp3d-settings-account-text';
    const accountName = doc.createElement('span');
    accountName.className = 'tp3d-settings-account-name';
    accountName.textContent = 'Workspace';
    const accountSub = doc.createElement('span');
    accountSub.className = 'muted tp3d-settings-account-sub';
    accountSub.dataset.accountName = '';
    accountSub.textContent = userView.displayName || '—';
    accountText.appendChild(accountName);
    accountText.appendChild(accountSub);
    accountInner.appendChild(accountAvatar);
    accountInner.appendChild(accountText);
    const accountChevron = doc.createElement('i');
    accountChevron.className = 'fa-solid fa-chevron-down';
    accountChevron.setAttribute('aria-hidden', 'true');
    accountBtn.appendChild(accountInner);
    accountBtn.appendChild(accountChevron);
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
     * @param {{ key: string, label: string, icon?: string, indent?: boolean, disabled?: boolean, disabledReason?: string }} opts
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
    navWrap.appendChild(makeHeader('Workspace'));
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
        disabledReason: isOrgHydrating ? 'Loading workspace…' : 'No active workspace selected.',
      })
    );
    navWrap.appendChild(
      makeItem({
        key: 'org-billing',
        label: 'Billing',
        icon: 'fa-regular fa-credit-card',
        indent: true,
        disabled: !hasOrg,
        disabledReason: isOrgHydrating ? 'Loading workspace…' : 'No active workspace selected.',
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
              title: 'Release Notes',
              helper: 'Verified product changes will appear here.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'roadmap') {
            return {
              title: 'Roadmap',
              helper: 'Published product plans will appear here.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'export') {
            return {
              title: 'Export App Backup',
              helper: 'Download local packs, cases, folders, and preferences as a JSON backup.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'import') {
            return {
              title: 'Import App Backup',
              helper: 'Replace local packs, cases, folders, and preferences from a backup JSON.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'help') {
            return {
              title: 'Import / Export Help',
              helper: 'Learn which files replace data and which files add data.',
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
            title: 'Workspace',
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
    closeBtn.addEventListener('click', () => close('close-button'));

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
      hiddenOpacity.className = 'tp3d-prefs-range-input';
      hiddenOpacity.type = 'range';
      hiddenOpacity.min = '0';
      hiddenOpacity.max = '1';
      hiddenOpacity.step = '0.05';
      hiddenOpacity.value = String(prefs.hiddenCaseOpacity);
      const hiddenOpacityValue = doc.createElement('span');
      hiddenOpacityValue.className = 'tp3d-prefs-range-value';
      hiddenOpacityValue.textContent = Number(hiddenOpacity.value).toFixed(2);
      hiddenOpacity.addEventListener('input', () => {
        hiddenOpacityValue.textContent = Number(hiddenOpacity.value).toFixed(2);
      });
      const hiddenOpacityWrap = doc.createElement('div');
      hiddenOpacityWrap.className = 'tp3d-prefs-range-control';
      hiddenOpacityWrap.appendChild(hiddenOpacity);
      hiddenOpacityWrap.appendChild(hiddenOpacityValue);

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

      const prefsCard = doc.createElement('div');
      prefsCard.className = 'card tp3d-settings-card-max tp3d-prefs-card';

      const unitsHeading = doc.createElement('div');
      unitsHeading.className = 'tp3d-prefs-heading';
      unitsHeading.textContent = 'Units';
      prefsCard.appendChild(unitsHeading);
      prefsCard.appendChild(row('Length', length));
      prefsCard.appendChild(row('Weight', weight));

      const displayHeading = doc.createElement('div');
      displayHeading.className = 'tp3d-prefs-heading';
      displayHeading.textContent = 'Editor Display';
      prefsCard.appendChild(displayHeading);

      prefsCard.appendChild(row('Hidden Case Opacity', hiddenOpacityWrap));

      labelSize.classList.add('tp3d-prefs-number-input');
      prefsCard.appendChild(row('Label Font Size', labelSize));

      const appearanceHeading = doc.createElement('div');
      appearanceHeading.className = 'tp3d-prefs-heading';
      appearanceHeading.textContent = 'Appearance';
      prefsCard.appendChild(appearanceHeading);
      prefsCard.appendChild(row('Theme', theme));

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
        prefsCard.appendChild(row('Shadows', shadowRow));
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
      prefsCard.appendChild(actions);
      body.appendChild(prefsCard);
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
        // Root view: card-row list
        const container = doc.createElement('div');
        container.className = 'tp3d-resources-view';

        const makeResourceCard = (icon, title, description, onClick) => {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'tp3d-resources-card-btn tp3d-settings-card--clickable';
          btn.addEventListener('click', onClick);

          const row = doc.createElement('div');
          row.className = 'tp3d-resources-card-row';

          const iconWrap = doc.createElement('span');
          iconWrap.className = 'tp3d-resources-card-icon';
          const iconEl = doc.createElement('i');
          iconEl.className = icon;
          iconWrap.appendChild(iconEl);
          row.appendChild(iconWrap);

          const copy = doc.createElement('span');
          copy.className = 'tp3d-resources-card-copy';

          const titleEl = doc.createElement('span');
          titleEl.className = 'tp3d-resources-card-title';
          titleEl.textContent = title;
          copy.appendChild(titleEl);

          const subEl = doc.createElement('span');
          subEl.className = 'tp3d-resources-card-sub';
          subEl.textContent = description;
          copy.appendChild(subEl);

          row.appendChild(copy);
          btn.appendChild(row);
          return btn;
        };

        container.appendChild(makeResourceCard(
          'fa-solid fa-bell', 'Release Notes',
          'Verified product changes will appear here.',
          () => setResourcesSubView('updates')
        ));
        container.appendChild(makeResourceCard(
          'fa-solid fa-map', 'Roadmap',
          'Published product plans will appear here.',
          () => setResourcesSubView('roadmap')
        ));
        container.appendChild(makeResourceCard(
          'fa-solid fa-file-export', 'Export App Backup',
          'Download local packs, cases, folders, and preferences as a JSON backup.',
          () => setResourcesSubView('export')
        ));
        container.appendChild(makeResourceCard(
          'fa-solid fa-file-import', 'Import App Backup',
          'Replace local packs, cases, folders, and preferences from a backup JSON.',
          () => setResourcesSubView('import')
        ));
        container.appendChild(makeResourceCard(
          'fa-solid fa-circle-question', 'Import / Export Help',
          'Learn which files replace data and which files add data.',
          () => setResourcesSubView('help')
        ));

        body.appendChild(container);
      }
    } else if (_tabState.activeTabId === 'account') {
      const accountUserView = getCurrentUserView(profileData);

      // Load all account data via bundle if profile not already loaded
      // This uses the epoch-validated single-flight approach to prevent stale data
      if (!profileData && !isLoadingProfile && !isLoadingAccountBundle && accountUserView.isAuthed) {
        const oEpoch = getOverlayEpoch();
        loadAccountBundle()
          .then(() => renderIfFresh(getCurrentActionId(), 'account-bundle', undefined, oEpoch))
          .catch(() => { });
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
        uploadBtn.className = 'btn';
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
          render({ source: 'profile-cancel' });
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
              render({ source: 'profile-edit' });
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
        errorMsg.style.color = 'var(--error)';
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
                      errorMsg.textContent = msg || 'Delete request failed.';
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
        const oEpoch = getOverlayEpoch();
        loadAccountBundle()
          .then(() => {
            renderIfFresh(getCurrentActionId(), 'org-bundle', undefined, oEpoch);
          })
          .catch(() => {
            renderIfFresh(getCurrentActionId(), 'org-bundle-error', undefined, oEpoch);
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
      const _siblingCards = [];

      if (isLockedOrgAccessLost(ensureModalOrgId())) {
        isEditingOrg = false;
        orgCard.appendChild(orgTitle);
        orgCard.appendChild(orgDivider);
        appendOrgAccessLostNotice(orgCard, 'org-general:lost-access:refresh');
      } else if (isEditingOrg && orgData && isOwnerOrAdmin) {
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
              lastOrgLogoExpiresAt = Date.now() + ORG_LOGO_CACHE_TTL_MS;
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
              if (img.parentNode) img.parentNode.replaceChild(logoPreview, img);
              logoNode = logoPreview;
            };
          };
          loadLogo2().catch(() => { });
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
          UIComponents.showToast('Uploading logo…', 'info', { title: 'Workspace' });
          SupabaseClient.uploadOrgLogo(orgIdLocal, f)
            .then(() => {
              UIComponents.showToast('Logo updated', 'success');
              // Clear overlay logo cache so re-render fetches the new logo
              lastOrgLogoKey = null;
              lastOrgLogoUrl = null;
              lastOrgLogoExpiresAt = 0;
              return loadOrganization(orgIdLocal);
            })
            .then(() => render({ source: 'logo-upload' }))
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
        form.appendChild(makeField('Name', 'name', orgData.name || '', 'Workspace name'));
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
          render({ source: 'org-cancel' });
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
          // Grace window: show skeleton instead of "Create workspace" for
          // _ORG_READY_GRACE_MS after overlay open so org context can load.
          const _withinGrace = _overlayOpenedAtMs > 0 &&
            (Date.now() - _overlayOpenedAtMs) < _ORG_READY_GRACE_MS;
          if (_withinGrace) {
            if (debugEnabled()) console.log('[SettingsOverlay] org-general: within grace window — showing skeleton');
            const makeSkeleton2 = () => {
              const el = doc.createElement('div');
              el.className = 'tp3d-skeleton tp3d-skeleton-short';
              return el;
            };
            viewContainer.appendChild(orgRow('Name', makeSkeleton2()));
            viewContainer.appendChild(orgRow('Slug', makeSkeleton2()));
            viewContainer.appendChild(orgRow('Phone', makeSkeleton2()));
            viewContainer.appendChild(orgRow('Address', makeSkeleton2()));
            viewContainer.appendChild(orgRow('Role', makeSkeleton2()));
            // Schedule a re-render after grace expires so we transition to
            // the real state (either loaded data or "create workspace").
            setTimeout(() => {
              if (isOpen()) {
                if (debugEnabled()) console.log('[SettingsOverlay] org-general: grace expired — re-rendering');
                render({ source: 'grace-expired' });
              }
            }, _ORG_READY_GRACE_MS);
          } else {
            const wrap = doc.createElement('div');
            wrap.className = 'tp3d-settings-stack--tight';

            const noOrgEl = doc.createElement('div');
            noOrgEl.className = 'muted';
            noOrgEl.textContent = 'Create a workspace or join one with an invite link to manage workspace details.';
            wrap.appendChild(noOrgEl);

            const createBtn = doc.createElement('button');
            createBtn.type = 'button';
            createBtn.className = 'btn btn-primary';
            createBtn.textContent = '+ New Workspace';
            createBtn.addEventListener('click', () => {
              const openCreateWorkspace = typeof window !== 'undefined'
                && window.TruckPackerApp
                && typeof window.TruckPackerApp.openCreateWorkspaceFlow === 'function'
                ? window.TruckPackerApp.openCreateWorkspaceFlow
                : null;
              if (!openCreateWorkspace) {
                UIComponents.showToast('Workspace creation is unavailable right now.', 'error');
                return;
              }
              openCreateWorkspace({ source: 'settings-org-general' });
            });
            wrap.appendChild(createBtn);

            const retryRow = doc.createElement('div');
            retryRow.className = 'tp3d-account-actions';

            const retryBtn = doc.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'btn btn-ghost';
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', () => {
              if (isLoadingAccountBundle) return;
              lastBundleRefreshAt = 0;
              queueAccountBundleRefresh({ force: true, source: 'org-general:retry-no-workspace' });
              render({ source: 'org-general:retry-no-workspace' });
            });

            retryRow.appendChild(retryBtn);
            wrap.appendChild(retryRow);
            viewContainer.appendChild(wrap);
          }
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
                lastOrgLogoExpiresAt = Date.now() + ORG_LOGO_CACHE_TTL_MS;
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
                if (img.parentNode) img.parentNode.replaceChild(logoPreview, img);
                logoNode = logoPreview;
              };
            };
            loadLogo2().catch(() => { });
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
            noteEl.textContent = 'Only admins can edit workspace details.';
            viewContainer.appendChild(noteEl);
          } else {
            const editActions = doc.createElement('div');
            editActions.className = 'tp3d-account-actions';
            const editBtn = doc.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn btn-primary';
            editBtn.textContent = 'Edit Workspace';
            editBtn.addEventListener('click', () => {
              isEditingOrg = true;
              render({ source: 'org-edit' });
            });
            editActions.appendChild(editBtn);
            viewContainer.appendChild(editActions);
          }

          const leaveOrgId = normalizeOrgId(
            (orgData && orgData.id) ||
            (membershipData && membershipData.organization_id) ||
            ''
          );
          const currentUserIdForLeave = orgUserView && orgUserView.userId ? String(orgUserView.userId) : '';
          const isPrimaryOwner = Boolean(
            orgData &&
            orgData.owner_id &&
            currentUserIdForLeave &&
            String(orgData.owner_id) === currentUserIdForLeave
          );
          const leaveName = orgData && orgData.name ? String(orgData.name) : '';

          // Advanced collapsible card (Ownership & Access + Danger Zone)
          // followed by Workspace Backup — both guarded by leaveOrgId && membershipData
          if (leaveOrgId && membershipData) {
            const advancedBodyId = 'tp3d-settings-advanced-body';

            const advancedCard = doc.createElement('div');
            advancedCard.className = 'card tp3d-settings-card-max tp3d-settings-advanced';

            const advancedToggle = doc.createElement('button');
            advancedToggle.type = 'button';
            advancedToggle.className = 'tp3d-settings-advanced-toggle';
            advancedToggle.setAttribute('aria-expanded', 'false');
            advancedToggle.setAttribute('aria-controls', advancedBodyId);

            const advancedLabel = doc.createElement('span');
            advancedLabel.className = 'tp3d-settings-advanced-label';
            advancedLabel.textContent = 'Advanced';

            advancedToggle.appendChild(advancedLabel);

            const advancedBody = doc.createElement('div');
            advancedBody.id = advancedBodyId;
            advancedBody.className = 'tp3d-settings-advanced-body';
            advancedBody.hidden = true;

            advancedToggle.addEventListener('click', () => {
              const isExpanded = advancedToggle.getAttribute('aria-expanded') === 'true';
              advancedToggle.setAttribute('aria-expanded', String(!isExpanded));
              advancedBody.hidden = isExpanded;
            });

            advancedCard.appendChild(advancedToggle);
            advancedCard.appendChild(advancedBody);

            // A. Workspace Backup (owner/admin only)
            if (isOwnerOrAdmin && typeof _onExportWorkspace === 'function') {
              const exportSection = doc.createElement('div');
              exportSection.className = 'tp3d-settings-advanced-section';

              const exportSectionHeading = doc.createElement('div');
              exportSectionHeading.className = 'tp3d-settings-section-heading';
              exportSectionHeading.textContent = 'Workspace Backup';
              exportSection.appendChild(exportSectionHeading);

              const exportSectionDivider = doc.createElement('div');
              exportSectionDivider.className = 'tp3d-settings-org-divider';
              exportSection.appendChild(exportSectionDivider);

              const exportRow = doc.createElement('div');
              exportRow.className = 'tp3d-workspace-action-row';

              const exportCopy = doc.createElement('div');
              exportCopy.className = 'tp3d-workspace-action-copy';

              const exportWsIntro = doc.createElement('div');
              exportWsIntro.className = 'tp3d-workspace-action-text';
              exportWsIntro.textContent = 'Download this workspace\'s packs, cases, and folder structure. App preferences, members, billing, payment data, and thumbnails are not included.';
              exportCopy.appendChild(exportWsIntro);

              const exportWsBtn = doc.createElement('button');
              exportWsBtn.type = 'button';
              exportWsBtn.className = 'btn';
              exportWsBtn.textContent = 'Export Workspace Backup';
              exportWsBtn.addEventListener('click', () => {
                const wsName = orgData && orgData.name ? String(orgData.name) : '';
                _onExportWorkspace(wsName);
              });

              exportRow.appendChild(exportCopy);
              exportRow.appendChild(exportWsBtn);
              exportSection.appendChild(exportRow);
              advancedBody.appendChild(exportSection);
            }

            // B. Transfer Ownership (primary owner only)
            if (isPrimaryOwner) {
              const transferSection = doc.createElement('div');
              transferSection.className = 'tp3d-settings-advanced-section';

              const transferSectionHeading = doc.createElement('div');
              transferSectionHeading.className = 'tp3d-settings-section-heading';
              transferSectionHeading.textContent = 'Transfer Ownership';
              transferSection.appendChild(transferSectionHeading);

              const transferSectionDivider = doc.createElement('div');
              transferSectionDivider.className = 'tp3d-settings-org-divider';
              transferSection.appendChild(transferSectionDivider);

              const transferRow = doc.createElement('div');
              transferRow.className = 'tp3d-workspace-action-row';

              const transferCopy = doc.createElement('div');
              transferCopy.className = 'tp3d-workspace-action-copy';

              const ownerWarning = doc.createElement('div');
              ownerWarning.className = 'tp3d-workspace-action-text tp3d-org-feedback tp3d-org-feedback--warning';
              ownerWarning.textContent = 'Transfer Workspace ownership before leaving. You are the primary owner.';
              transferCopy.appendChild(ownerWarning);

              const transferBtn = doc.createElement('button');
              transferBtn.type = 'button';
              transferBtn.className = 'btn';
              transferBtn.textContent = _transferOwnershipInFlight ? 'Transferring…' : 'Transfer Ownership';
              transferBtn.disabled = _transferOwnershipInFlight;
              transferBtn.addEventListener('click', async () => {
                if (_transferOwnershipInFlight) return;
                await showTransferOwnershipModal(leaveOrgId, leaveName, currentUserIdForLeave);
              });

              transferRow.appendChild(transferCopy);
              transferRow.appendChild(transferBtn);
              transferSection.appendChild(transferRow);
              advancedBody.appendChild(transferSection);
            }

            // C. Leave Workspace
            const leaveSection = doc.createElement('div');
            leaveSection.className = 'tp3d-settings-advanced-section';

            const leaveSectionHeading = doc.createElement('div');
            leaveSectionHeading.className = 'tp3d-settings-section-heading';
            leaveSectionHeading.textContent = 'Leave Workspace';
            leaveSection.appendChild(leaveSectionHeading);

            const leaveSectionDivider = doc.createElement('div');
            leaveSectionDivider.className = 'tp3d-settings-org-divider';
            leaveSection.appendChild(leaveSectionDivider);

            const leaveRow = doc.createElement('div');
            leaveRow.className = 'tp3d-workspace-action-row';

            const leaveCopy = doc.createElement('div');
            leaveCopy.className = 'tp3d-workspace-action-copy';

            const leaveIntro = doc.createElement('div');
            leaveIntro.className = 'tp3d-workspace-action-text';
            leaveIntro.textContent = 'Remove yourself from this workspace. You will need a new invite to rejoin.';
            leaveCopy.appendChild(leaveIntro);

            const leaveBtn = doc.createElement('button');
            leaveBtn.type = 'button';
            leaveBtn.className = 'btn btn-danger';
            leaveBtn.textContent = _leaveWorkspaceInFlight ? 'Leaving…' : 'Leave Workspace';
            leaveBtn.disabled = _leaveWorkspaceInFlight || isPrimaryOwner;
            leaveBtn.addEventListener('click', async () => {
              if (_leaveWorkspaceInFlight || isPrimaryOwner) return;
              const roleForLeave = String(
                (orgData && orgData.role) ||
                (membershipData && membershipData.role) ||
                ''
              ).toLowerCase();
              const targetName = leaveName || 'this workspace';
              const message = roleForLeave === 'owner'
                ? `Leave ${targetName}? You will lose owner access and cannot rejoin without a new invite.`
                : `Leave ${targetName}? You will lose access and cannot rejoin without a new invite.`;
              const confirmed = await UIComponents.confirm({
                title: 'Leave Workspace',
                message,
                okLabel: 'Leave Workspace',
                cancelLabel: 'Cancel',
                danger: true,
              }).catch(() => false);
              if (confirmed) await leaveWorkspace(leaveOrgId, leaveName);
            });

            leaveRow.appendChild(leaveCopy);
            leaveRow.appendChild(leaveBtn);
            leaveSection.appendChild(leaveRow);
            advancedBody.appendChild(leaveSection);

            // D. Danger Zone (primary owner only)
            if (isPrimaryOwner) {
              const dangerZone = doc.createElement('div');
              dangerZone.className = 'tp3d-settings-danger';

              const dangerTitle = doc.createElement('div');
              dangerTitle.className = 'tp3d-settings-danger-title';
              dangerTitle.textContent = 'Danger Zone';
              dangerZone.appendChild(dangerTitle);

              const dangerDivider = doc.createElement('div');
              dangerDivider.className = 'tp3d-settings-danger-divider';
              dangerZone.appendChild(dangerDivider);

              const archiveRow = doc.createElement('div');
              archiveRow.className = 'tp3d-settings-danger-row tp3d-settings-danger-row--archive';

              const archiveLeft = doc.createElement('div');
              archiveLeft.className = 'tp3d-settings-danger-left';

              const archiveTitleEl = doc.createElement('div');
              archiveTitleEl.textContent = 'Archive Workspace';
              archiveLeft.appendChild(archiveTitleEl);

              const archiveDesc = doc.createElement('div');
              archiveDesc.className = 'muted tp3d-settings-meta';
              archiveDesc.textContent = 'Archive this workspace. It will be hidden from normal workspace switching.';
              archiveLeft.appendChild(archiveDesc);

              const archiveExportHint = doc.createElement('div');
              archiveExportHint.className = 'muted tp3d-settings-meta';
              archiveExportHint.textContent =
                'Before archiving or making major workspace changes, you may export a workspace JSON backup.';
              archiveLeft.appendChild(archiveExportHint);

              archiveRow.appendChild(archiveLeft);

              const archiveRight = doc.createElement('div');
              archiveRight.className = 'tp3d-settings-danger-right';

              const archiveBtn = doc.createElement('button');
              archiveBtn.type = 'button';
              archiveBtn.className = 'btn btn-danger';
              archiveBtn.textContent = _archiveWorkspaceInFlight ? 'Archiving…' : 'Archive Workspace';
              archiveBtn.disabled = _archiveWorkspaceInFlight;
              archiveBtn.addEventListener('click', async () => {
                if (_archiveWorkspaceInFlight) return;
                const targetName = leaveName || 'this workspace';
                const confirmed = await UIComponents.confirm({
                  title: 'Archive Workspace',
                  message: `Archive "${targetName}"? This hides it from normal workspace switching. Workspace data, members, invites, and billing records are preserved. Stripe billing is not canceled.`,
                  okLabel: 'Archive Workspace',
                  cancelLabel: 'Cancel',
                  danger: true,
                }).catch(() => false);
                if (confirmed) await archiveWorkspace(leaveOrgId, leaveName);
              });
              archiveRight.appendChild(archiveBtn);
              archiveRow.appendChild(archiveRight);
              dangerZone.appendChild(archiveRow);
              advancedBody.appendChild(dangerZone);
            }

            // E. Archived Workspaces
            if (!isLoadingMembership && !isLoadingOrg && !isLoadingAccountBundle) {
              const archivedSection = doc.createElement('div');
              archivedSection.className = 'tp3d-settings-advanced-section';
              appendArchivedWorkspacesSection(
                archivedSection,
                orgUserView && orgUserView.userId ? String(orgUserView.userId) : ''
              );
              advancedBody.appendChild(archivedSection);
            }

            _siblingCards.push(advancedCard);
          }

        }

        orgCard.appendChild(orgTitle);
        orgCard.appendChild(orgDivider);
        orgCard.appendChild(viewContainer);
      }

      body.appendChild(orgCard);
      _siblingCards.forEach(c => body.appendChild(c));
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
        (isLoadingAccountBundle || isLoadingMembership || isLoadingOrg ||
          (_overlayOpenedAtMs > 0 && (Date.now() - _overlayOpenedAtMs) < _ORG_READY_GRACE_MS))
      );
      const currentUserId = orgUserView && orgUserView.userId ? String(orgUserView.userId) : null;
      const hasMembersForOrg = Boolean(
        orgId &&
        lastOrgMembersOrgId &&
        String(lastOrgMembersOrgId) === String(orgId) &&
        Array.isArray(orgMembersData)
      );
      const memberRoleForCurrentUser = (() => {
        if (!hasMembersForOrg || !currentUserId) return '';
        const selfMember = orgMembersData.find(member => {
          const memberOrgId = normalizeOrgId(member && member.organization_id ? member.organization_id : '');
          const memberUserId = member && member.user_id ? String(member.user_id) : '';
          return memberOrgId === orgId && memberUserId === currentUserId;
        });
        const role = String(selfMember && selfMember.role ? selfMember.role : '').toLowerCase();
        return isKnownOrgRole(role) ? role : '';
      })();
      const currentRole = String(
        (orgDataId && orgDataId === orgId && orgData && orgData.role) ||
        (membershipOrgId && membershipOrgId === orgId && membershipData && membershipData.role) ||
        memberRoleForCurrentUser ||
        ''
      ).toLowerCase() || null;
      const membersWorkspaceName = orgDataId && orgDataId === orgId && orgData && orgData.name
        ? String(orgData.name)
        : '';
      const roleKnown = isKnownOrgRole(currentRole);
      const isOwner = currentRole === 'owner';
      const canManage = roleKnown ? canManageMembers(currentRole) : false;
      const canManageAdmins = isOwner;
      const hasInvitesForOrg = Boolean(
        orgId &&
        lastOrgInvitesOrgId &&
        String(lastOrgInvitesOrgId) === String(orgId) &&
        Array.isArray(orgInvitesData)
      );
      const membersStale = Boolean(
        orgId &&
        lastOrgMembersOrgId &&
        String(lastOrgMembersOrgId) !== String(orgId)
      );
      const invitesStale = Boolean(
        orgId &&
        lastOrgInvitesOrgId &&
        String(lastOrgInvitesOrgId) !== String(orgId)
      );
      const membersLoading = Boolean(isLoadingOrgMembers && (!hasMembersForOrg || membersStale));
      const rolePending = Boolean(
        orgId &&
        !roleKnown &&
        (isLoadingAccountBundle || isLoadingMembership || isLoadingOrg || membersStale)
      );
      let rolePendingTimedOut = false;
      if (rolePending) {
        const now = Date.now();
        if (_membersPermissionPendingOrgId !== orgId || !_membersPermissionPendingSince) {
          _membersPermissionPendingOrgId = orgId;
          _membersPermissionPendingSince = now;
        }
        rolePendingTimedOut = (now - _membersPermissionPendingSince) >= _MEMBERS_PERMISSION_TIMEOUT_MS;
      } else {
        _membersPermissionPendingSince = 0;
        _membersPermissionPendingOrgId = '';
      }
      let membersDisabledReason = '';
      if (orgHydrating) {
        membersDisabledReason = 'Loading workspace…';
      } else if (!orgId) {
        membersDisabledReason = 'Select a workspace to manage members';
      } else if (rolePendingTimedOut) {
        membersDisabledReason = 'Could not confirm your permissions. Refresh and try again.';
      } else if (rolePending) {
        membersDisabledReason = 'Loading permissions…';
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

      if (isLockedOrgAccessLost(orgId)) {
        appendOrgAccessLostNotice(membersCard, 'org-members:lost-access:refresh');
      } else if (!orgUserView.isAuthed) {
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
          msg.textContent = 'Select a workspace to manage members.';
          membersCard.appendChild(msg);
        }
        // Auto-retry: schedule a deferred re-check when org context becomes ready
        if (orgUserView.isAuthed && _membersRetryCount < _MEMBERS_MAX_RETRIES && !_membersRetryTimer) {
          const delay = _MEMBERS_BACKOFF[_membersRetryCount] || 1500;
          _membersRetryCount += 1;
          debug('members:auto-retry:schedule', { attempt: _membersRetryCount, delayMs: delay });
          const retryEpoch = _renderEpoch;
          const retryToken = getTabActionToken();
          _membersRetryTimer = setTimeout(() => {
            _membersRetryTimer = null;
            // Re-resolve org context
            modalOrgId = resolveInitialModalOrgId();
            const retryOrgId = ensureModalOrgId();
            if (retryOrgId && _tabState.activeTabId === 'org-members') {
              debug('members:auto-retry:fire', { orgId: retryOrgId, attempt: _membersRetryCount });
              loadOrgMembers(retryOrgId)
                .then(() => renderIfFresh(getCurrentActionId(), 'members:auto-retry', retryEpoch, undefined, retryToken))
                .catch(() => { });
            } else if (!retryOrgId) {
              // Org still not ready — render() will schedule another retry if needed
              renderIfFresh(getCurrentActionId(), 'members:auto-retry:no-org', retryEpoch, undefined, retryToken);
            }
          }, delay);
        }
        const membersHelperMessage = doc.createElement('div');
        membersHelperMessage.className = 'muted tp3d-members-inline-helper';
        membersHelperMessage.textContent = membersDisabledReason || 'Members are not available yet, please refresh';
        membersCard.appendChild(membersHelperMessage);
        const refreshRow = doc.createElement('div');
        refreshRow.className = 'row';
        const refreshBtn = doc.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'btn';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.addEventListener('click', () => {
          queueAccountBundleRefresh({ force: true, source: 'org-members:refresh-org' });
          modalOrgId = resolveInitialModalOrgId();
          const nextOrgId = ensureModalOrgId();
          if (nextOrgId) {
            const epoch = _renderEpoch;
            const token = getTabActionToken();
            loadOrgMembers(nextOrgId)
              .then(() => renderIfFresh(getCurrentActionId(), 'org-members:refresh', epoch, undefined, token))
              .catch(() => { });
          }
          render({ source: 'members-refresh' });
        });
        refreshRow.appendChild(refreshBtn);
        membersCard.appendChild(refreshRow);
      } else {
        if (membersStale) {
          orgMembersData = null;
          orgMembersError = null;
          orgMembersSearchQuery = '';
          orgMembersRoleFilter = 'all';
        }
        if (invitesStale) {
          orgInvitesData = null;
          orgInvitesError = null;
          lastOrgInvitesOrgId = null;
        }

        const rolesHelp = doc.createElement('div');
        rolesHelp.className = 'muted tp3d-role-help';
        rolesHelp.textContent =
          'Workspace members are scoped to your active workspace. Owners and admins can update roles.';
        membersCard.appendChild(rolesHelp);

        if (membersDisabledReason) {
          const membersStateHelp = doc.createElement('div');
          membersStateHelp.className = rolePendingTimedOut
            ? 'tp3d-org-feedback tp3d-org-feedback--error'
            : 'muted tp3d-members-inline-helper';
          membersStateHelp.textContent = membersDisabledReason;
          membersCard.appendChild(membersStateHelp);
          if (rolePendingTimedOut) {
            const permissionsRetryRow = doc.createElement('div');
            permissionsRetryRow.className = 'row';
            const permissionsRetryBtn = doc.createElement('button');
            permissionsRetryBtn.type = 'button';
            permissionsRetryBtn.className = 'btn';
            permissionsRetryBtn.textContent = 'Refresh permissions';
            permissionsRetryBtn.addEventListener('click', () => {
              _membersPermissionPendingSince = 0;
              _membersPermissionPendingOrgId = '';
              queueAccountBundleRefresh({ force: true, source: 'org-members:permissions-timeout' });
              const epoch = _renderEpoch;
              const token = getTabActionToken();
              loadOrgMembers(orgId)
                .then(() => renderIfFresh(getCurrentActionId(), 'org-members:permissions-timeout', epoch, undefined, token))
                .catch(() => { });
              render({ source: 'members-permissions-timeout-refresh' });
            });
            permissionsRetryRow.appendChild(permissionsRetryBtn);
            membersCard.appendChild(permissionsRetryRow);
          }
        }

        if (!hasMembersForOrg && !isLoadingOrgMembers) {
          const epoch = _renderEpoch;
          const token = getTabActionToken();
          loadOrgMembers(orgId)
            .then(() => renderIfFresh(getCurrentActionId(), 'org-members', epoch, undefined, token))
            .catch(() => { });
        }

        // Load invites in parallel (owner/admin only)
        if (canManage && !membersDisabledReason && !hasInvitesForOrg && !isLoadingOrgInvites) {
          const epoch = _renderEpoch;
          const token = getTabActionToken();
          loadOrgInvites(orgId)
            .then(() => renderIfFresh(getCurrentActionId(), 'org-invites', epoch, undefined, token))
            .catch(() => { });
        }

        if (membersLoading && !hasMembersForOrg) {
          const membersLoadingText = doc.createElement('div');
          membersLoadingText.className = 'muted tp3d-members-inline-helper';
          membersLoadingText.textContent = membersWorkspaceName
            ? `Loading members for ${membersWorkspaceName}…`
            : 'Loading members…';
          membersCard.appendChild(membersLoadingText);

          const skeletonGroup = doc.createElement('div');
          skeletonGroup.className = 'tp3d-skeleton-group tp3d-skel tp3d-members-skeleton';
          skeletonGroup.innerHTML = `
            <div class="tp3d-skel-line tp3d-skeleton-title"></div>
            <div class="tp3d-skel-line tp3d-skeleton-short"></div>
            <div class="tp3d-skel-line tp3d-skeleton-short"></div>
          `;
          membersCard.appendChild(skeletonGroup);
        } else if (orgMembersError) {
          // Auth-pending: show skeleton with "Reconnecting" instead of error
          if (orgMembersError._authPending) {
            const skeletonGroup = doc.createElement('div');
            skeletonGroup.className = 'tp3d-skeleton-group tp3d-skel tp3d-members-skeleton';
            skeletonGroup.innerHTML = `
              <div class="tp3d-skel-line tp3d-skeleton-title"></div>
              <div class="tp3d-skel-line tp3d-skeleton-short"></div>
              <div class="tp3d-skel-line tp3d-skeleton-short"></div>
            `;
            membersCard.appendChild(skeletonGroup);
            const reconnectMsg = doc.createElement('div');
            reconnectMsg.className = 'muted';
            reconnectMsg.textContent = 'Reconnecting\u2026';
            membersCard.appendChild(reconnectMsg);
          } else {
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
            const epoch = _renderEpoch;
            loadOrgMembers(orgId)
              .then(() => renderIfFresh(getCurrentActionId(), 'org-members', epoch))
              .catch(() => { });
          });

          retryRow.appendChild(retryBtn);
          membersCard.appendChild(msg);
          membersCard.appendChild(retryRow);
          }
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

            const inviteSectionHelper = doc.createElement('div');
            inviteSectionHelper.className = 'muted tp3d-members-inline-helper';
            inviteSectionHelper.textContent = 'Invites are shared as secure links. Use Copy Link after creating or resending one.';
            inviteSection.appendChild(inviteSectionHelper);

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
            const inviteMemberOpt = doc.createElement('option');
            inviteMemberOpt.value = 'member';
            inviteMemberOpt.textContent = 'Member';
            inviteRoleSelect.appendChild(inviteMemberOpt);

            const inviteAdminOpt = doc.createElement('option');
            inviteAdminOpt.value = 'admin';
            inviteAdminOpt.textContent = 'Admin';
            inviteAdminOpt.disabled = !isOwner;
            inviteRoleSelect.appendChild(inviteAdminOpt);
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
            const pendingInvites = hasInvitesForOrg && Array.isArray(orgInvitesData)
              ? orgInvitesData.filter(i => i && i.status === 'pending')
              : [];

            if (isLoadingOrgInvites && orgInvitesInflightOrgId === String(orgId || '') && !hasInvitesForOrg) {
              const inviteLoadingText = doc.createElement('div');
              inviteLoadingText.className = 'muted tp3d-members-inline-helper';
              inviteLoadingText.textContent = 'Loading pending invites…';
              inviteSection.appendChild(inviteLoadingText);

              const skeletonInvites = doc.createElement('div');
              skeletonInvites.className = 'tp3d-skeleton-group';
              skeletonInvites.innerHTML = '<div class="tp3d-skeleton tp3d-skeleton-short"></div>';
              inviteSection.appendChild(skeletonInvites);
            } else if (orgInvitesError && !hasInvitesForOrg) {
              if (orgInvitesError._authPending) {
                const reconnectMsg = doc.createElement('div');
                reconnectMsg.className = 'muted tp3d-members-inline-helper';
                reconnectMsg.textContent = 'Reconnecting before loading pending invites…';
                inviteSection.appendChild(reconnectMsg);
              } else {
                const inviteError = doc.createElement('div');
                inviteError.className = 'tp3d-org-feedback tp3d-org-feedback--error';
                inviteError.textContent = `Failed to load invites. ${orgInvitesError && orgInvitesError.message ? orgInvitesError.message : 'Try again.'
                  }`;
                inviteSection.appendChild(inviteError);
              }
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
                const inviteRole = String(invite.role || 'member').toLowerCase();
                const adminInviteActionBlocked = !canManageAdmins && inviteRole === 'admin';
                const adminInviteActionTitle = 'Only workspace owners can manage admin invites.';
                const tr = doc.createElement('tr');
                tr.dataset.memberSearch = String(invite.email || '').toLowerCase();
                tr.dataset.memberRole = inviteRole;

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
                const expirationView = getInviteExpirationView(invite.expires_at);
                const statusBadge = doc.createElement('span');
                statusBadge.className = expirationView.expired ? 'badge' : 'badge badge--pending';
                statusBadge.textContent = expirationView.expired ? 'Expired' : 'Pending';
                statusTd.appendChild(statusBadge);
                const expiresLine = doc.createElement('div');
                expiresLine.className = expirationView.className;
                expiresLine.textContent = expirationView.text;
                statusTd.appendChild(expiresLine);
                tr.appendChild(statusTd);

                const actionsTd = doc.createElement('td');
                actionsTd.className = 'tp3d-org-members-actions-cell';
                const actionsWrap = doc.createElement('div');
                actionsWrap.className = 'tp3d-org-member-actions';

                const resendBtn = doc.createElement('button');
                resendBtn.type = 'button';
                resendBtn.className = 'btn btn-ghost';
                resendBtn.textContent = 'Resend';
                resendBtn.disabled = isBusyInvite || inviteControlsDisabled || adminInviteActionBlocked;
                if (adminInviteActionBlocked) resendBtn.title = adminInviteActionTitle;
                resendBtn.addEventListener('click', () => {
                  if (adminInviteActionBlocked) return;
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
                revokeBtn.disabled = isBusyInvite || inviteControlsDisabled || adminInviteActionBlocked;
                if (adminInviteActionBlocked) revokeBtn.title = adminInviteActionTitle;
                revokeBtn.addEventListener('click', () => {
                  if (adminInviteActionBlocked) return;
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
            const _perfMembersT0 = debugEnabled() && typeof performance !== 'undefined' ? performance.now() : 0;
            members.forEach(member => {
              if (!member || !member.user_id) return;
              const userId = String(member.user_id);
              const role = String(member.role || 'member').toLowerCase();
              const memberName = getMemberDisplayName(member);
              const memberEmail = getMemberEmail(member);
              const isSelf = Boolean(currentUserId && currentUserId === userId);
              const isOwnerMember = role === 'owner';
              const isAdminMember = role === 'admin';
              const isBusy = orgMemberActions.has(userId);

              let canEditRole = canManage && !isBusy && !isOwnerMember;
              if (!canManageAdmins && (isOwnerMember || isAdminMember)) canEditRole = false;

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

              if (isOwnerMember) {
                const ownershipHint = doc.createElement('span');
                ownershipHint.className = 'muted tp3d-members-inline-helper';
                ownershipHint.textContent = 'Use Transfer Ownership';
                actions.appendChild(ownershipHint);
              } else {
                const roleSelect = doc.createElement('select');
                roleSelect.className = 'select tp3d-org-member-role-select';
                roleSelect.setAttribute('aria-label', `Role for ${memberName}`);
                const roles = ['admin', 'member'];
                roles.forEach(r => {
                  const opt = doc.createElement('option');
                  opt.value = r;
                  opt.textContent = getRoleLabel(r);
                  // Admins cannot promote to or manage admin role — only owners can.
                  if (r === 'admin' && !isOwner) opt.disabled = true;
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
                roleSelect.addEventListener('change', async ev => {
                  const target = ev.target instanceof HTMLSelectElement ? ev.target : null;
                  const nextRole = target ? String(target.value) : role;
                  if (nextRole === role) return;
                  roleSelect.value = role;
                  if (nextRole === 'admin' && !isOwner) {
                    UIComponents.showToast('Only owners can promote members to admin.', 'warning');
                    return;
                  }
                  if (membersDisabledReason || !canEditRole) {
                    return;
                  }
                  if (isSensitiveRoleChange(role, nextRole)) {
                    let confirmed = false;
                    try {
                      confirmed = await UIComponents.confirm({
                        title: 'Change member role',
                        message: buildRoleChangeConfirmMessage(member, role, nextRole),
                        okLabel: 'Change Role',
                        cancelLabel: 'Cancel',
                        danger: role === 'owner' || nextRole === 'owner',
                      });
                    } catch {
                      confirmed = false;
                    }
                    if (!confirmed) {
                      roleSelect.value = role;
                      return;
                    }
                  }
                  roleSelect.value = nextRole;
                  updateMemberRole(orgId, member, nextRole, currentUserId).catch(() => {
                    roleSelect.value = role;
                  });
                });
                actions.appendChild(roleSelect);
              }

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
            if (_perfMembersT0) {
              debug('render:members-loop:perf', { count: rows.length, ms: Number((performance.now() - _perfMembersT0).toFixed(1)) });
            }

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
    if (_perfRenderT0) {
      debug('render:perf', { tab: _tabState.activeTabId, source: _renderSource, ms: Number((performance.now() - _perfRenderT0).toFixed(1)) });
    }
    // ── Post-render: drain any pending repaint queued for the active tab ──
    // Handles the race where async data arrives during the DOM-build of this render.
    // Dedupe sig guards prevent render loops when the state is unchanged.
    const _activeTabAfterRender = _tabState.activeTabId;
    if (_pendingRepaintByTab.has(_activeTabAfterRender)) {
      const _drainEntry = _pendingRepaintByTab.get(_activeTabAfterRender);
      _pendingRepaintByTab.delete(_activeTabAfterRender);
      // Only fire if the queued entry's token is still current
      if (_drainEntry && (typeof _drainEntry.token !== 'number' || isTokenCurrent(_drainEntry.token))) {
        debug('pendingRepaint:end-of-render:schedule', { tab: _activeTabAfterRender, source: _drainEntry.source, token: _drainEntry.token });
        const _drainToken = _drainEntry.token;
        requestAnimationFrame(() => {
          if (settingsOverlay && isOpen() && _tabState.activeTabId === _activeTabAfterRender &&
              (typeof _drainToken !== 'number' || isTokenCurrent(_drainToken))) {
            render({ source: 'pendingRepaint:' + _activeTabAfterRender, tabToken: _drainToken });
          }
        });
      } else {
        debug('pendingRepaint:drop-stale-token:end-of-render', { tab: _activeTabAfterRender, source: _drainEntry && _drainEntry.source, token: _drainEntry && _drainEntry.token, currentToken: _tabState.lastTabActionToken });
      }
    }
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
    _overlayOpenedAtMs = Date.now();
    bumpEpoch('open');
    const cachedOrgIdBeforeOpen = normalizeOrgId(
      (orgData && orgData.id) ||
      (membershipData && membershipData.organization_id) ||
      ''
    );
    const resolvedModalOrgId = resolveInitialModalOrgId();
    if (modalOrgId !== resolvedModalOrgId) {
      modalOrgId = resolvedModalOrgId;
    }
    const openingOrgId = normalizeOrgId(modalOrgId);
    if (cachedOrgIdBeforeOpen && cachedOrgIdBeforeOpen !== openingOrgId) {
      membershipData = null;
      orgData = null;
      orgMembersData = null;
      orgInvitesData = null;
      orgMembersError = null;
      orgInvitesError = null;
      isLoadingOrgMembers = false;
      isLoadingOrgInvites = false;
      isEditingOrg = false;
      orgMemberActions.clear();
      orgInviteActions.clear();
    }
    clearOrgScopedCaches(modalOrgId);
    const nextTab = resolveInitialTab(tab);
    if (settingsOverlay && settingsOverlay.isConnected) {
      ensureOrgChangedListener();
      ensureOrgAccessLostListener();
      ensureWorkspaceSwitchListener();
      setActiveTab(nextTab, { source: 'open', actionId: _tabState.lastActionId });
      debugSettingsModalSnapshot('open:reuse');
      debugTabSnapshot('open:reuse');
      const openingUserView = getCurrentUserView(profileData);
      if (openingUserView.isAuthed) {
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
      if (ev.target === settingsOverlay) close('backdrop-click');
    });

    trapKeydownHandler = ev => {
      if (ev.key === 'Escape') {
        close('escape-key');
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
    ensureOrgAccessLostListener();
    ensureWorkspaceSwitchListener();
    bindTabsOnce();
    setActiveTab(nextTab, { source: 'open', actionId: _tabState.lastActionId });
    debugSettingsModalSnapshot('open:created');
    debugTabSnapshot('open:created');
    const openingUserView = getCurrentUserView(profileData);
    if (openingUserView.isAuthed) {
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

  function refreshAccountUI(meta) {
    const reason = (meta && meta.reason) || 'direct';
    _debugCallsite('refreshAccountUI', { reason, coalesced: Boolean(meta && meta.coalesced) });
    if (!isOpen()) {
      debug('refreshAccountUI:skip-closed', { reason });
      return;
    }
    // Tab-aware: skip full render on org tabs UNLESS the org is known.
    // When org IS available an auth-change should allow the tab to re-render.
    if (_ORG_TAB_SET.has(_tabState.activeTabId)) {
      const hasOrg = Boolean(
        typeof window !== 'undefined' &&
        window.OrgContext &&
        typeof window.OrgContext.getActiveOrgId === 'function' &&
        window.OrgContext.getActiveOrgId()
      );
      if (!hasOrg) {
        debug('refreshAccountUI:skip-org-tab', { tab: _tabState.activeTabId, reason });
        return;
      }
      debug('refreshAccountUI:org-tab-override', { tab: _tabState.activeTabId, reason });
    }
    if (_tabState.activeTabId === 'org-billing' && shouldSuppressPreLockBillingTransition()) {
      return;
    }
    render({ source: 'refreshAccountUI' });
  }

  /**
   * Microtask-coalesced wrapper: multiple calls within the same tick collapse to one.
   * Internal callers should use this instead of refreshAccountUI() directly.
   */
  function requestRefreshAccountUI(reason) {
    _refreshAccountUIPendingReason = reason;
    if (_refreshAccountUIQueued) {
      debug('requestRefreshAccountUI:coalesced', { reason, pendingReason: _refreshAccountUIPendingReason });
      return;
    }
    _refreshAccountUIQueued = true;
    const enqueue = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn);
    enqueue(() => {
      _refreshAccountUIQueued = false;
      const pendingReason = _refreshAccountUIPendingReason;
      _refreshAccountUIPendingReason = null;
      refreshAccountUI({ reason: pendingReason || reason, coalesced: true });
    });
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
    archivedWorkspacesData = null;
    isLoadingArchivedWorkspaces = false;
    archivedWorkspacesError = null;
    archivedWorkspacesRequestId = 0;
    restoreWorkspaceActions.clear();
    orgInvitesData = null;
    isLoadingOrgInvites = false;
    orgInvitesError = null;
    orgInvitesRequestId = 0;
    lastOrgMembersOrgId = null;
    billingContextStartingOrgId = '';
    billingContextInflightOrgId = '';
    billingContextInflightPromise = null;
    billingContextResolvedOrgId = '';
    orgMemberActions.clear();
    orgInviteActions.clear();

    // FIX: Clear org logo overlay cache to prevent stale logo across user switches
    lastOrgLogoKey = null;
    lastOrgLogoUrl = null;
    lastOrgLogoExpiresAt = 0;
    _lastOrgChangeEpochSeen = 0;
    _lastOrgChangeTsSeen = 0;
    accountBundleConfirmedNoActiveWorkspace = false;
    modalOrgId = '';
  }

  function handleAuthChange(_event) {
    try {
      if (_event === 'SIGNED_OUT') {
        debug('auth:change', { reason: 'SIGNED_OUT', userIdTail: null });
        clearCachedUserData();
        lastKnownUserId = null;
        _lastAuthChangeKey = '';
        _lastAuthChangeAtMs = 0;
        _lastAuthSnapshot = null;
        return;
      }
      let currentUserId = null;
      try {
        const u = SupabaseClient && typeof SupabaseClient.getUser === 'function' ? SupabaseClient.getUser() : null;
        currentUserId = u && u.id ? String(u.id) : null;
      } catch {
        currentUserId = null;
      }
      const userIdTail = currentUserId ? currentUserId.slice(-6) : null;

      // ── Dedupe: normalize key to status|userId, ignore repeats within 3s ──
      const rawEvent = String(_event || '');
      const authStatus = rawEvent.replace(/\|.*$/, '').replace(/^settings-open\|/, '');
      const authChangeKey = `${authStatus}|${currentUserId || ''}`;
      const authChangeNow = Date.now();
      if (authChangeKey === _lastAuthChangeKey && (authChangeNow - _lastAuthChangeAtMs) < _AUTH_CHANGE_DEDUPE_MS) {
        if (isOpen()) {
          debug('auth:change:dedupe', { reason: String(_event || 'unknown'), userIdTail, ageMs: authChangeNow - _lastAuthChangeAtMs });
        }
        return;
      }
      _lastAuthChangeKey = authChangeKey;
      _lastAuthChangeAtMs = authChangeNow;

      const nextSnapshot = _safeAuthSnapshot(currentUserId);
      if (!_hasMeaningfulAuthDelta(nextSnapshot)) {
        debug('auth:change:skip-no-meaningful-delta', {
          reason: String(_event || 'unknown'),
          userIdTail,
          activeTab: _tabState.activeTabId,
        });
        return;
      }
      _lastAuthSnapshot = nextSnapshot;

      debug('auth:change', { reason: String(_event || 'unknown'), userIdTail });
      if (currentUserId && lastKnownUserId && currentUserId !== lastKnownUserId) {
        clearCachedUserData();
      }
      if (currentUserId) lastKnownUserId = currentUserId;

      // ── Only trigger UI refresh if overlay is actually open ──
      if (!isOpen()) {
        debug('auth:change:skip-closed', { reason: String(_event || 'unknown'), userIdTail });
        return;
      }
      if (!_activeTabDependsOnAuthState(_tabState.activeTabId)) {
        debug('auth:change:skip-tab-independent', {
          reason: String(_event || 'unknown'),
          userIdTail,
          activeTab: _tabState.activeTabId,
        });
        return;
      }
      const shouldRefreshVisibleUi = (
        _tabState.activeTabId === 'account'
        || _tabState.activeTabId === 'org-general'
        || _authGatePendingRetry
      );
      if (shouldRefreshVisibleUi) {
        // 2s cooldown on refreshAccountUI to avoid auth-change storm
        if ((authChangeNow - _lastRefreshAccountUIAtMs) >= 2000) {
          _lastRefreshAccountUIAtMs = authChangeNow;
          requestRefreshAccountUI('auth-change');
        } else {
          debug('auth:change:skip-refresh-cooldown', { reason: String(_event || 'unknown'), userIdTail, ageMs: authChangeNow - _lastRefreshAccountUIAtMs });
        }
      } else {
        debug('auth:change:skip-ui-refresh-not-needed', {
          reason: String(_event || 'unknown'),
          userIdTail,
          activeTab: _tabState.activeTabId,
        });
      }
      if (
        (_tabState.activeTabId === 'account' || _tabState.activeTabId === 'org-general')
        && (profileData || membershipData || orgData)
      ) {
        queueAccountBundleRefresh({ force: true, source: 'auth-change-refresh' });
      }
      // ── Auth-gate retry: re-trigger skipped org fetches now that auth may be ready ──
      if (_authGatePendingRetry && isOpen() && currentUserId) {
        _authGatePendingRetry = false;
        const retryOrgId = ensureModalOrgId();
        const activeTab = _tabState.activeTabId;
        const epoch = _renderEpoch;
        const token = getTabActionToken();
        debug('authGate:retry', { tab: activeTab, orgId: retryOrgId });
        if (retryOrgId && (activeTab === 'org-members' || activeTab === 'org-billing')) {
          if (activeTab === 'org-members') {
            loadOrgMembers(retryOrgId)
              .then(() => renderIfFresh(getCurrentActionId(), 'authGate:retry:members', epoch, undefined, token))
              .catch(() => { });
          }
          if (activeTab === 'org-billing') {
            ensureBillingContextHydrated(retryOrgId, { force: true, source: 'authGate:retry:billing' }).catch(() => { });
            // Route through pump — never call refreshBilling directly from settings-overlay
            if (typeof window !== 'undefined' && window.TruckPackerApp && typeof window.TruckPackerApp.maybeScheduleBillingRefresh === 'function') {
              window.TruckPackerApp.maybeScheduleBillingRefresh('auth-gate-retry');
            } else {
              _callBillingPumpWithRetry('auth-gate-retry');
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return { init, open, close, isOpen, setActive, render, refreshAccountUI, requestRefreshAccountUI, handleAuthChange };
}
