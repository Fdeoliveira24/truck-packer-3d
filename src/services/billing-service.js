/**
 * @file billing-service.js
 * @description Billing domain (Stage 1 extraction from src/app.js): authoritative
 *   billing state, refresh lifecycle + stale-result/epoch/generation guards,
 *   cross-tab BroadcastChannel + storage mirrors, entitlement/access helpers,
 *   checkout/portal (DEF-011 action-generation), and access-gate application.
 *   Behavior preserved verbatim; root/IIFE orchestration (billing pump, focus/
 *   visibility refresh, workspace + auth lifecycle) stays in src/app.js and calls
 *   this module's public facade / private instance API. Side-effect-free on import
 *   (the factory sets up channel + listeners when called, at the current 2103 point).
 * @module services/billing-service
 * @created 07/24/2026
 * @author Truck Packer 3D Team
 */

export function createBillingService(deps) {
  const {
    SupabaseClient,
    fetchBillingStatus,
    createCheckoutSession,
    createPortalSession,
    isTp3dDebugEnabled,
    normalizeOrgIdForBilling,
    normalizeBillingEntitlementStatus,
    billingDebugLog,
    ORG_UUID_RE,
    bootStartedAtMs,
    BILLING_SHARED_FRESH_MS,
  } = deps || {};
  // Required construction dependencies fail loudly (contract: Stage 1 Amendment 2).
  const _required = {
    SupabaseClient, fetchBillingStatus, createCheckoutSession, createPortalSession,
    isTp3dDebugEnabled, normalizeOrgIdForBilling, normalizeBillingEntitlementStatus,
    billingDebugLog, ORG_UUID_RE, bootStartedAtMs, BILLING_SHARED_FRESH_MS,
  };
  for (const _k of Object.keys(_required)) {
    if (_required[_k] === undefined || _required[_k] === null) {
      throw new Error('createBillingService: missing required dependency: ' + _k);
    }
  }
  // Aliases so the moved code keeps its verbatim identifiers.
  const _bootStartedAtMs = bootStartedAtMs;
  const _BILLING_SHARED_FRESH_MS = BILLING_SHARED_FRESH_MS;
  // Late-bound private collaborators (root wires these via the setters below, at the
  // existing IIFE assignment points; init preserves the current pre-binding behavior).
  let _authTruthSnapshotAccessor = () => null;
  let _orgAccessLossHandler = null;

  // ==========================================================================
  // Moved Billing implementation (verbatim from src/app.js @ c7bdc7c, 113-2099
  // minus interleaved root/shared keepers). Free references resolve to the
  // injected deps above, co-located billing symbols, or platform globals.
  // ==========================================================================
const _billingState = {
  pending: true,
  loading: false,
  ok: false,
  plan: null,
  status: null,
  entitlementStatus: null,
  billingOwnerUserId: null,
  workspaceIncluded: false,
  workspaceCount: null,
  workspaceLimit: null,
  canManageBilling: null,
  orgId: null,
  isPro: false,
  isActive: false,
  interval: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  portalAvailable: false,
  paymentProblem: false,
  paymentGraceUntil: null,
  paymentGraceRemainingDays: null,
  action: null,
  data: null,
  error: null,
  lastFetchedAt: 0,
};
const _billingSubscribers = new Set();
const BILLING_THROTTLE_MS = 30000;
const BILLING_REQUEST_TIMEOUT_MS = 15000;
let _billingRefreshQueued = false;
let _billingRefreshQueuedWaiters = [];
let _billingPendingRetry = { orgId: null, count: 0, timer: null };
let _billingLastFocusRefreshAt = 0;
let _lastBillingKey = '';
let _lastBillingKeyAt = 0;
let _billingTraceSeq = 0;
let _billingEpoch = 0; // incremented on sign-out; late refresh results are ignored when epoch changes
let _billingAuthoritativeRefreshGeneration = 0;
/** @type {null|{generation:number,userId:string|null,epoch:number,attemptedAt:number}} */
let _billingAuthoritativeRefreshRequired = null;
/** @type {null|{generation:number,userId:string,orgId:string,epoch:number}} */
let _billingAuthoritativeRefreshInFlight = null;
let _billingRequireAuthoritativeOnNextSignIn = false;
/** @type {null|((snapshot:any, meta?:{reason?:string, activeOrgId?:string|null})=>void)} */
let _billingGateApplier = null;
/** @type {null|((orgId:string, meta?:{reason?:string,status?:number|null,message?:string|null})=>boolean)} */

/**
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function abbreviateBillingLifecycleId(value) {
  const normalized = value ? String(value) : '';
  return normalized ? normalized.slice(-6) : null;
}

function getBillingAuthoritativeLifecycleDebugState() {
  const requirement = _billingAuthoritativeRefreshRequired;
  return {
    nextSignInMarker: _billingRequireAuthoritativeOnNextSignIn,
    generation: requirement ? requirement.generation : null,
    requirementUserIdTail: requirement ? abbreviateBillingLifecycleId(requirement.userId) : null,
    requirementEpoch: requirement ? requirement.epoch : null,
    billingEpoch: _billingEpoch,
    inFlightGeneration: _billingAuthoritativeRefreshInFlight
      ? _billingAuthoritativeRefreshInFlight.generation
      : null,
  };
}

function billingAuthLifecycleDebugLog(step, details = {}) {
  const payload = {
    ...details,
    ...getBillingAuthoritativeLifecycleDebugState(),
  };
  billingDebugLog(`billing:auth-lifecycle:${step}`, JSON.stringify(payload));
}

function getCurrentBillingAuthUserId() {
  const truth = typeof _authTruthSnapshotAccessor === 'function' ? _authTruthSnapshotAccessor() : null;
  return truth && truth.userId ? String(truth.userId) : '';
}

function requireBillingAuthoritativeRefreshForUserSwitch(userId = null) {
  _billingAuthoritativeRefreshGeneration += 1;
  _billingAuthoritativeRefreshRequired = {
    generation: _billingAuthoritativeRefreshGeneration,
    userId: userId ? String(userId) : null,
    epoch: _billingEpoch,
    attemptedAt: 0,
  };
  _billingAuthoritativeRefreshInFlight = null;
  billingAuthLifecycleDebugLog('requirement-created', {
    userIdTail: abbreviateBillingLifecycleId(userId),
  });
}

function markBillingAuthoritativeRefreshForNextSignIn() {
  _billingRequireAuthoritativeOnNextSignIn = true;
  billingAuthLifecycleDebugLog('next-sign-in-marker-set');
}

function transferPendingPostSignoutBillingRequirementForAuthenticatedUser({
  userId = null,
  source = 'unknown',
  authEvent = null,
} = {}) {
  const normalizedUserId = userId ? String(userId) : '';
  billingAuthLifecycleDebugLog('transfer-enter', {
    source,
    authEvent,
    userIdTail: abbreviateBillingLifecycleId(normalizedUserId),
  });
  if (!_billingRequireAuthoritativeOnNextSignIn || !normalizedUserId) {
    billingAuthLifecycleDebugLog('transfer-skip', {
      source,
      authEvent,
      userIdTail: abbreviateBillingLifecycleId(normalizedUserId),
      reason: !_billingRequireAuthoritativeOnNextSignIn ? 'marker-false' : 'missing-user',
    });
    return false;
  }
  try { window.__TP3D_USER_SWITCH_PENDING = true; } catch (_) { /* ignore */ }
  requireBillingAuthoritativeRefreshForUserSwitch(normalizedUserId);
  _billingRequireAuthoritativeOnNextSignIn = false;
  billingAuthLifecycleDebugLog('transfer-complete', {
    source,
    authEvent,
    userIdTail: abbreviateBillingLifecycleId(normalizedUserId),
  });
  return true;
}

function clearBillingAuthoritativeRefreshRequirement(token = null, reason = 'unspecified') {
  if (
    token &&
    (!_billingAuthoritativeRefreshRequired ||
      token.generation !== _billingAuthoritativeRefreshRequired.generation ||
      token.epoch !== _billingAuthoritativeRefreshRequired.epoch)
  ) {
    billingAuthLifecycleDebugLog('requirement-clear-rejected', {
      reason,
      tokenGeneration: token && token.generation ? token.generation : null,
      tokenEpoch: token && Number.isFinite(token.epoch) ? token.epoch : null,
    });
    return false;
  }
  billingAuthLifecycleDebugLog('requirement-clear', {
    reason,
    tokenGeneration: token && token.generation ? token.generation : null,
    tokenEpoch: token && Number.isFinite(token.epoch) ? token.epoch : null,
  });
  _billingAuthoritativeRefreshRequired = null;
  _billingAuthoritativeRefreshInFlight = null;
  return true;
}

function getBillingAuthoritativeRefreshToken(orgId) {
  const requirement = _billingAuthoritativeRefreshRequired;
  const currentUserId = getCurrentBillingAuthUserId();
  const normalizedOrgId = normalizeOrgIdForBilling(orgId || '');
  if (!requirement || requirement.epoch !== _billingEpoch || !currentUserId || !normalizedOrgId) return null;
  if (requirement.userId && requirement.userId !== currentUserId) return null;
  if (!requirement.userId) requirement.userId = currentUserId;
  return {
    generation: requirement.generation,
    userId: currentUserId,
    orgId: normalizedOrgId,
    epoch: requirement.epoch,
    attemptedAt: requirement.attemptedAt,
  };
}

function isCurrentBillingAuthoritativeRefreshToken(token, orgId = null) {
  if (!token || !_billingAuthoritativeRefreshRequired) return false;
  const currentUserId = getCurrentBillingAuthUserId();
  const expectedOrgId = normalizeOrgIdForBilling(orgId || token.orgId || '');
  return Boolean(
    currentUserId &&
    token.generation === _billingAuthoritativeRefreshRequired.generation &&
    token.epoch === _billingAuthoritativeRefreshRequired.epoch &&
    token.epoch === _billingEpoch &&
    token.userId === currentUserId &&
    (!expectedOrgId || token.orgId === expectedOrgId)
  );
}

function isBillingAuthoritativeRefreshInFlight(token) {
  return Boolean(
    token &&
    _billingAuthoritativeRefreshInFlight &&
    token.generation === _billingAuthoritativeRefreshInFlight.generation &&
    token.epoch === _billingAuthoritativeRefreshInFlight.epoch
  );
}

function beginBillingAuthoritativeRefreshAttempt(token) {
  if (!isCurrentBillingAuthoritativeRefreshToken(token, token && token.orgId)) return false;
  _billingAuthoritativeRefreshRequired.attemptedAt = Date.now();
  _billingAuthoritativeRefreshInFlight = token;
  return true;
}

function finishBillingAuthoritativeRefreshAttempt(token) {
  if (
    token &&
    _billingAuthoritativeRefreshInFlight &&
    token.generation === _billingAuthoritativeRefreshInFlight.generation &&
    token.epoch === _billingAuthoritativeRefreshInFlight.epoch
  ) {
    _billingAuthoritativeRefreshInFlight = null;
  }
}

function preserveUserSwitchPendingForBillingFailure(token) {
  if (!isCurrentBillingAuthoritativeRefreshToken(token, token && token.orgId)) return;
  try { window.__TP3D_USER_SWITCH_PENDING = true; } catch (_) { /* ignore */ }
}

function isBillingAuthoritativeRefreshRequired() {
  return Boolean(_billingAuthoritativeRefreshRequired);
}


function nullableFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resetBillingEntitlementFields(status = null) {
  _billingState.entitlementStatus = normalizeBillingEntitlementStatus(status);
  _billingState.billingOwnerUserId = null;
  _billingState.workspaceIncluded = false;
  _billingState.workspaceCount = null;
  _billingState.workspaceLimit = null;
  _billingState.canManageBilling = null;
}

function applyBillingEntitlementFields(source, fallbackStatus = null) {
  const s = source && typeof source === 'object' ? source : {};
  _billingState.entitlementStatus = normalizeBillingEntitlementStatus(s.entitlementStatus) || normalizeBillingEntitlementStatus(fallbackStatus);
  _billingState.billingOwnerUserId = s.billingOwnerUserId ? String(s.billingOwnerUserId) : null;
  _billingState.workspaceIncluded = Boolean(s.workspaceIncluded);
  _billingState.workspaceCount = nullableFiniteNumber(s.workspaceCount);
  _billingState.workspaceLimit = nullableFiniteNumber(s.workspaceLimit);
  _billingState.canManageBilling = typeof s.canManageBilling === 'boolean' ? s.canManageBilling : null;
}

function isEntitlementAllowed(status) {
  const normalized = normalizeBillingEntitlementStatus(status);
  return normalized === 'active' || normalized === 'trialing' || normalized === 'included_in_plan';
}

// ============================================================================
// SECTION: CROSS-TAB BILLING COORDINATION (Rule C)
// ============================================================================
const _BILLING_LOCK_TTL_MS = 20000;      // lock expires after 20s (dead-tab safety)
const _BILLING_LOCK_RETRY_MIN_MS = 1200;
const _BILLING_LOCK_RETRY_GRACE_MS = 100;
let _billingTabId = '';
/** @type {BroadcastChannel|null} */
let _billingBroadcast = null;
let _lastAppliedBillingLfa = 0; // dedupe: last cross-tab lastFetchedAt we applied
/** @type {Map<string, string>} per-org dedupe: orgId -> JSON signature of last processed cross-tab snapshot */
const _lastProcessedBillingSigByOrg = new Map();

// Generate a unique per-tab ID
try {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    _billingTabId = window.sessionStorage.getItem('__tp3d_billing_tab') || '';
    if (!_billingTabId) {
      _billingTabId = 'tab_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
      window.sessionStorage.setItem('__tp3d_billing_tab', _billingTabId);
    }
  }
} catch (_) { _billingTabId = 'tab_' + Math.random().toString(36).slice(2, 10); }

function _billingLockKey(orgId) { return 'billing:inflight:' + orgId; }
function _billingFreshKey(orgId) { return 'billing:lastFetchedAt:' + orgId; }
function _billingResultKey(orgId) { return 'billing:lastState:' + orgId; }
function _billingLegacyLockKey(orgId) { return 'tp3d:billing:lock:' + orgId; }
function _billingLegacyFreshKey(orgId) { return 'tp3d:billing:fresh:' + orgId; }
function _billingLegacyResultKey(orgId) { return 'tp3d:billing:result:' + orgId; }

/**
 * Try to acquire a cross-tab billing lock for the given org.
 * Returns true if this tab may proceed with fetching, false if blocked.
 */
function _readStorageJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

function _getBillingLockRetryDelay(orgId, now = Date.now()) {
  const lock = _readStorageJson(_billingLockKey(orgId)) || _readStorageJson(_billingLegacyLockKey(orgId));
  const lockAt = Number(lock && lock.at);
  if (!Number.isFinite(lockAt) || lockAt <= 0) return _BILLING_LOCK_RETRY_MIN_MS;
  const lockAge = Math.max(0, Number(now) - lockAt);
  const remainingTtl = Math.max(0, Math.min(_BILLING_LOCK_TTL_MS, _BILLING_LOCK_TTL_MS - lockAge));
  return Math.max(_BILLING_LOCK_RETRY_MIN_MS, remainingTtl + _BILLING_LOCK_RETRY_GRACE_MS);
}

function _tryAcquireBillingLock(orgId, reason = 'manual') {
  try {
    const now = Date.now();
    const lock = _readStorageJson(_billingLockKey(orgId)) || _readStorageJson(_billingLegacyLockKey(orgId));
    if (
      lock &&
      lock.tabId &&
      lock.tabId !== _billingTabId &&
      lock.at &&
      (now - Number(lock.at)) < _BILLING_LOCK_TTL_MS
    ) {
      billingDebugLog('billing:cross-tab-lock:skip-inflight', {
        reason,
        orgId,
        holder: lock.tabId,
        ageMs: now - Number(lock.at),
      });
      return false;
    }

    const lockPayload = JSON.stringify({ tabId: _billingTabId, at: now, reason: String(reason || '') });
    window.localStorage.setItem(_billingLockKey(orgId), lockPayload);
    // Keep legacy key writable for older tabs that still read tp3d:* keys.
    window.localStorage.setItem(_billingLegacyLockKey(orgId), lockPayload);

    // Read-after-write verify to reduce races where two tabs set nearly simultaneously.
    const verify = _readStorageJson(_billingLockKey(orgId));
    if (!verify || verify.tabId !== _billingTabId || Number(verify.at) !== now) {
      billingDebugLog('billing:cross-tab-lock:skip-inflight', {
        reason,
        orgId,
        holder: verify && verify.tabId ? verify.tabId : 'unknown',
      });
      return false;
    }
    billingDebugLog('billing:cross-tab-lock:acquired', { reason, orgId, tabId: _billingTabId });
    return true;
  } catch (_) { return true; } // fail-open
}

function _releaseBillingLock(orgId, reason = 'manual') {
  try {
    const key = _billingLockKey(orgId);
    const legacyKey = _billingLegacyLockKey(orgId);
    const lock = _readStorageJson(key) || _readStorageJson(legacyKey);
    if (lock && lock.tabId === _billingTabId) {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(legacyKey);
      billingDebugLog('billing:cross-tab-lock:released', { reason, orgId, tabId: _billingTabId });
    }
  } catch (_) { /* ignore */ }
}

function _getSharedBillingFreshness(orgId) {
  try {
    const primary = Number(window.localStorage.getItem(_billingFreshKey(orgId)) || 0);
    if (primary > 0) return primary;
    return Number(window.localStorage.getItem(_billingLegacyFreshKey(orgId)) || 0);
  } catch (_) { return 0; }
}

function _writeSharedBillingResult(orgId, state) {
  try {
    if (!_isBillingSnapshotScopedToOrg(orgId, state)) return;
    if (!_isShareableBillingSnapshot(orgId, state)) {
      _clearSharedBillingResult(orgId);
      return;
    }
    const fetchedAt = Number(state && state.lastFetchedAt) || Date.now();
    window.localStorage.setItem(_billingFreshKey(orgId), String(fetchedAt));
    // Keep legacy key writable for older tabs that still read tp3d:* keys.
    window.localStorage.setItem(_billingLegacyFreshKey(orgId), String(fetchedAt));
    // Write a minimal snapshot (avoid storing large data blobs)
    const mini = {
      ok: state.ok, plan: state.plan, status: state.status, orgId: state.orgId,
      entitlementStatus: state.entitlementStatus, billingOwnerUserId: state.billingOwnerUserId,
      workspaceIncluded: state.workspaceIncluded, workspaceCount: state.workspaceCount,
      workspaceLimit: state.workspaceLimit, canManageBilling: state.canManageBilling,
      isPro: state.isPro, isActive: state.isActive, interval: state.interval,
      trialEndsAt: state.trialEndsAt, currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd, cancelAt: state.cancelAt,
      portalAvailable: state.portalAvailable, error: state.error,
      paymentProblem: state.paymentProblem, paymentGraceUntil: state.paymentGraceUntil,
      paymentGraceRemainingDays: state.paymentGraceRemainingDays, action: state.action,
      lastFetchedAt: fetchedAt,
    };
    const payload = JSON.stringify(mini);
    window.localStorage.setItem(_billingResultKey(orgId), payload);
    // Keep legacy key writable for older tabs that still read tp3d:* keys.
    window.localStorage.setItem(_billingLegacyResultKey(orgId), payload);
  } catch (_) { /* ignore */ }
}

function _readSharedBillingResult(orgId) {
  return _readStorageJson(_billingResultKey(orgId)) || _readStorageJson(_billingLegacyResultKey(orgId));
}

function _isBillingSnapshotScopedToOrg(orgId, state) {
  const targetOrgId = normalizeOrgIdForBilling(orgId);
  const rawSnapshotOrgId = state && state.orgId ? String(state.orgId).trim() : '';
  const snapshotOrgId = normalizeOrgIdForBilling(rawSnapshotOrgId);
  return Boolean(targetOrgId && (!rawSnapshotOrgId || (snapshotOrgId && snapshotOrgId === targetOrgId)));
}

function _clearSharedBillingResult(orgId) {
  try {
    if (!normalizeOrgIdForBilling(orgId)) return;
    window.localStorage.removeItem(_billingFreshKey(orgId));
    window.localStorage.removeItem(_billingLegacyFreshKey(orgId));
    window.localStorage.removeItem(_billingResultKey(orgId));
    window.localStorage.removeItem(_billingLegacyResultKey(orgId));
  } catch (_) { /* ignore */ }
}

function _billingSharedSnapshotDebugFields(orgId, state) {
  return {
    orgId: normalizeOrgIdForBilling(orgId) || null,
    status: state && Object.prototype.hasOwnProperty.call(state, 'status') ? state.status : null,
    entitlementStatus: state && state.entitlementStatus ? state.entitlementStatus : null,
    ok: Boolean(state && state.ok === true),
  };
}

function _isShareableBillingSnapshot(orgId, state) {
  if (!state || typeof state !== 'object') return false;
  if (!_isBillingSnapshotScopedToOrg(orgId, state)) return false;
  if (state.ok !== true) return false;
  const entitlementStatus = normalizeBillingEntitlementStatus(state.entitlementStatus);
  if (entitlementStatus === 'billing_unavailable') return false;
  if (state.error) return false;
  const rawStatus = Object.prototype.hasOwnProperty.call(state, 'status') ? state.status : null;
  if (rawStatus === null || typeof rawStatus === 'undefined') return false;
  const numericStatus = Number(rawStatus);
  if (Number.isFinite(numericStatus) && numericStatus === 408) return false;
  const statusText = String(rawStatus || '').toLowerCase();
  if (statusText === 'timeout' || statusText === 'network_error' || statusText === 'network') return false;
  return true;
}

function _readShareableBillingResult(orgId, _reason = 'shared-read') {
  const shared = _readSharedBillingResult(orgId);
  if (!shared) return null;
  if (_isShareableBillingSnapshot(orgId, shared)) return shared;
  billingDebugLog('billing:cross-tab:discard-failed-shared', {
    ..._billingSharedSnapshotDebugFields(orgId, shared),
  });
  if (_isBillingSnapshotScopedToOrg(orgId, shared)) _clearSharedBillingResult(orgId);
  return null;
}

function _applySharedBillingSnapshot(orgId, state, reason = 'cross-tab-shared') {
  if (!state || typeof state !== 'object') return false;
  if (!_isBillingSnapshotScopedToOrg(orgId, state)) {
    billingDebugLog('billing:cross-tab:discard-org-mismatch', {
      reason,
      keyOrgId: orgId || null,
      stateOrgId: state && state.orgId ? state.orgId : null,
    });
    return false;
  }
  if (!_isShareableBillingSnapshot(orgId, state)) {
    billingDebugLog('billing:cross-tab:discard-failed-shared', {
      ..._billingSharedSnapshotDebugFields(orgId, state),
    });
    return false;
  }
  clearBillingPendingRetry(orgId);
  _billingState.pending = false;
  _billingState.loading = false;
  _billingState.ok = Boolean(state.ok);
  _billingState.plan = state.plan || null;
  _billingState.status = state.status || null;
  applyBillingEntitlementFields(state, state.ok ? null : 'billing_unavailable');
  // F1 (BUG-01 follow-up): canManageBilling is user-specific authority — the
  // requesting user's role — not an organization-scoped fact. A snapshot
  // written by another user (same-org A → B switch) or another tab must never
  // grant it. Leave it unresolved so current-role resolution
  // (resolveCanManageBillingForOrg / role fallbacks in Settings and
  // getProRuleSet) derives it for the signed-in user; only a direct
  // /billing-status fetch applies the server's per-user answer.
  _billingState.canManageBilling = null;
  _billingState.orgId = state.orgId || orgId;
  _billingState.isPro = Boolean(state.isPro);
  _billingState.isActive = Boolean(state.isActive);
  _billingState.interval = state.interval || null;
  _billingState.trialEndsAt = state.trialEndsAt || null;
  _billingState.currentPeriodEnd = state.currentPeriodEnd || null;
  _billingState.cancelAtPeriodEnd = Boolean(state.cancelAtPeriodEnd);
  _billingState.cancelAt = state.cancelAt || null;
  _billingState.portalAvailable = Boolean(state.portalAvailable);
  _billingState.paymentProblem = Boolean(state.paymentProblem);
  _billingState.paymentGraceUntil = state.paymentGraceUntil || null;
  _billingState.paymentGraceRemainingDays = state.paymentGraceRemainingDays != null ? Number(state.paymentGraceRemainingDays) : null;
  _billingState.action = state.action || null;
  _billingState.error = state.error || null;
  _billingState.data = null;
  _billingState.lastFetchedAt = Number(state.lastFetchedAt) || _getSharedBillingFreshness(orgId) || Date.now();
  _notifyBilling();
  applyAccessGateFromBilling(getBillingState(), { reason, activeOrgId: orgId });
  return true;
}

function _shouldApplySharedBillingSnapshotForOrg(orgId, sharedFreshAt = 0) {
  const targetOrgId = normalizeOrgIdForBilling(orgId);
  if (!targetOrgId) return false;
  const currentBillingOrgId = normalizeOrgIdForBilling(_billingState.orgId || '');
  if (currentBillingOrgId !== targetOrgId) return true;
  if (!_billingState.lastFetchedAt) return true;
  return Boolean(sharedFreshAt && _billingState.lastFetchedAt < sharedFreshAt);
}

function _clearBillingSnapshotForOrgTransition(orgId, reason = 'org-transition') {
  const targetOrgId = normalizeOrgIdForBilling(orgId);
  if (!targetOrgId) return false;
  const currentBillingOrgId = normalizeOrgIdForBilling(_billingState.orgId || '');
  if (currentBillingOrgId === targetOrgId) return false;
  clearBillingPendingRetry();
  _billingState.loading = false;
  _billingState.pending = true;
  _billingState.ok = false;
  _billingState.plan = null;
  _billingState.status = null;
  resetBillingEntitlementFields(null);
  _billingState.orgId = targetOrgId;
  _billingState.isPro = false;
  _billingState.isActive = false;
  _billingState.interval = null;
  _billingState.trialEndsAt = null;
  _billingState.currentPeriodEnd = null;
  _billingState.cancelAtPeriodEnd = false;
  _billingState.cancelAt = null;
  _billingState.portalAvailable = false;
  _billingState.paymentProblem = false;
  _billingState.paymentGraceUntil = null;
  _billingState.paymentGraceRemainingDays = null;
  _billingState.action = null;
  _billingState.data = null;
  _billingState.error = null;
  _billingState.lastFetchedAt = 0;
  _notifyBilling();
  applyAccessGateFromBilling(getBillingState(), { reason, activeOrgId: targetOrgId });
  return true;
}

function reconcileBillingStateForActiveOrg(reason = 'active-org-reconcile') {
  const activeOrgId = getActiveOrgIdForBilling();
  if (!activeOrgId) return false;
  const currentBillingOrgId = normalizeOrgIdForBilling(_billingState.orgId || '');
  if (!currentBillingOrgId || currentBillingOrgId === activeOrgId) return false;
  const shared = _readShareableBillingResult(activeOrgId, 'reconcile:' + reason);
  if (shared) {
    return _applySharedBillingSnapshot(activeOrgId, shared, 'reconcile-shared:' + reason);
  }
  return _clearBillingSnapshotForOrgTransition(activeOrgId, 'reconcile-pending:' + reason);
}

function _broadcastBillingResult(orgId, state) {
  if (!_billingBroadcast) return;
  if (!_isShareableBillingSnapshot(orgId, state)) return;
  try {
    _billingBroadcast.postMessage({ type: 'billing-result', orgId, state: {
      ok: state.ok, plan: state.plan, status: state.status, orgId: state.orgId,
      entitlementStatus: state.entitlementStatus, billingOwnerUserId: state.billingOwnerUserId,
      workspaceIncluded: state.workspaceIncluded, workspaceCount: state.workspaceCount,
      workspaceLimit: state.workspaceLimit, canManageBilling: state.canManageBilling,
      isPro: state.isPro, isActive: state.isActive, interval: state.interval,
      trialEndsAt: state.trialEndsAt, currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd, cancelAt: state.cancelAt,
      portalAvailable: state.portalAvailable, error: state.error,
      paymentProblem: state.paymentProblem, paymentGraceUntil: state.paymentGraceUntil,
      paymentGraceRemainingDays: state.paymentGraceRemainingDays, action: state.action,
      lastFetchedAt: state.lastFetchedAt,
    }, tabId: _billingTabId });
  } catch (_) { /* ignore */ }
}

function _buildCrossTabBillingSig(orgId, state) {
  return JSON.stringify({
    orgId: orgId || '',
    lastFetchedAt: (state && Number(state.lastFetchedAt)) || 0,
    ok: state && state.ok === true,
    pending: state && state.pending === true,
    plan: (state && state.plan) || null,
    status: (state && state.status) || null,
    entitlementStatus: (state && state.entitlementStatus) || null,
    billingOwnerUserId: (state && state.billingOwnerUserId) || null,
    workspaceIncluded: state && state.workspaceIncluded === true,
    workspaceCount: (state && state.workspaceCount != null) ? Number(state.workspaceCount) : null,
    workspaceLimit: (state && state.workspaceLimit != null) ? Number(state.workspaceLimit) : null,
    canManageBilling: (state && typeof state.canManageBilling === 'boolean') ? state.canManageBilling : null,
    isActive: state && state.isActive === true,
    interval: (state && state.interval) || null,
    trialEndsAt: (state && state.trialEndsAt) || null,
    currentPeriodEnd: (state && state.currentPeriodEnd) || null,
    cancelAtPeriodEnd: state && state.cancelAtPeriodEnd === true,
    cancelAt: (state && state.cancelAt) || null,
    portalAvailable: state && state.portalAvailable === true,
    paymentProblem: state && state.paymentProblem === true,
    paymentGraceRemainingDays: (state && state.paymentGraceRemainingDays != null) ? Number(state.paymentGraceRemainingDays) : null,
  });
}

/** Returns true if this sig was already seen for this org (skip). Otherwise marks + returns false (process). */
function _ctSigSeenOrMark(orgId, sig) {
  if (_lastProcessedBillingSigByOrg.get(orgId) === sig) return true;
  _lastProcessedBillingSigByOrg.set(orgId, sig);
  return false;
}

function _handleCrossTabBillingResult(orgId, state, fromTabId) {
  const currentOrgId = getActiveOrgIdForBilling();
  if (!currentOrgId || currentOrgId !== orgId) return;
  if (_billingState.loading) return; // don't overwrite an in-flight local fetch
  if (!_isShareableBillingSnapshot(orgId, state)) {
    billingDebugLog('billing:cross-tab:discard-failed-shared', {
      ..._billingSharedSnapshotDebugFields(orgId, state),
    });
    return;
  }

  const _ctSig = _buildCrossTabBillingSig(orgId, state);
  if (_ctSigSeenOrMark(orgId, _ctSig)) return; // silent exit (already applied/processed)

  // Log only after dedupe proves it's truly new data
  if (fromTabId === 'storage') {
    billingDebugLog('billing:cross-tab-storage:received', { orgId, localTabId: _billingTabId });
  } else {
    billingDebugLog('billing:cross-tab-broadcast:received', { orgId, fromTabId, localTabId: _billingTabId });
  }

  // Dedupe: skip if we already applied a snapshot with the same lastFetchedAt
  const incomingLfa = Number(state && state.lastFetchedAt) || 0;
  if (incomingLfa && incomingLfa === _lastAppliedBillingLfa && incomingLfa === _billingState.lastFetchedAt) {
    billingDebugLog('billing:cross-tab:skip-already-applied', { orgId, lastFetchedAt: incomingLfa, from: fromTabId });
    return;
  }

  _applySharedBillingSnapshot(orgId, state, fromTabId === 'storage' ? 'cross-tab-storage' : 'cross-tab-broadcast');
  _lastAppliedBillingLfa = _billingState.lastFetchedAt || incomingLfa;
}

function _extractOrgIdFromStorageKey(key, prefix) {
  if (!key || !prefix || !key.startsWith(prefix)) return '';
  const raw = key.slice(prefix.length).trim();
  return normalizeOrgIdForBilling(raw);
}

function _handleCrossTabBillingStorageEvent(ev) {
  try {
    if (!ev || !ev.key) return;
    const orgId = _extractOrgIdFromStorageKey(ev.key, 'billing:lastState:')
      || _extractOrgIdFromStorageKey(ev.key, 'tp3d:billing:result:')
      || _extractOrgIdFromStorageKey(ev.key, 'billing:lastFetchedAt:')
      || _extractOrgIdFromStorageKey(ev.key, 'tp3d:billing:fresh:');
    if (!orgId) return;
    const currentOrgId = getActiveOrgIdForBilling();
    if (!currentOrgId || currentOrgId !== orgId) return;
    if (_billingState.loading) return;
    const state = _readShareableBillingResult(orgId, 'storage');
    if (!state) return;
    _handleCrossTabBillingResult(orgId, state, 'storage');
  } catch (_) { /* ignore */ }
}

// Initialize BroadcastChannel listener
try {
  if (typeof BroadcastChannel !== 'undefined') {
    _billingBroadcast = new BroadcastChannel('tp3d-billing');
    _billingBroadcast.onmessage = (ev) => {
      if (!ev || !ev.data || ev.data.type !== 'billing-result') return;
      const msg = ev.data;
      if (msg.orgId && msg.state && msg.tabId !== _billingTabId) {
        _handleCrossTabBillingResult(msg.orgId, msg.state, msg.tabId);
      }
    };
  }
} catch (_) { _billingBroadcast = null; }

try {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', _handleCrossTabBillingStorageEvent);
  }
} catch (_) { /* ignore */ }




function getActiveOrgIdForBilling() {
  try {
    if (typeof window !== 'undefined' && window.OrgContext && typeof window.OrgContext.getActiveOrgId === 'function') {
      const id = normalizeOrgIdForBilling(window.OrgContext.getActiveOrgId());
      if (id) return id;
    }
  } catch (_) {
    // ignore
  }
  // Fallback: localStorage hint (same UUID validation as OrgContext path)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = String(window.localStorage.getItem('tp3d:active-org-id') || '').trim();
      if (raw && ORG_UUID_RE.test(raw)) return raw;
    }
  } catch (_) {
    // ignore
  }
  return '';
}

function applyAccessGateFromBilling(billingSnapshot, meta = {}) {
  if (typeof _billingGateApplier !== 'function') return;
  try {
    _billingGateApplier(billingSnapshot || getBillingState(), meta);
  } catch (_) {
    // gate application must never break app flow
  }
}

function _notifyBilling() {
  const snapshot = getBillingState();
  _billingSubscribers.forEach(fn => { try { fn(snapshot); } catch (_) { /* ignore */ } });
}

function getBillingState() {
  return {
    loading: _billingState.loading,
    ok: _billingState.ok,
    plan: _billingState.plan,
    status: _billingState.status,
    entitlementStatus: _billingState.entitlementStatus,
    billingOwnerUserId: _billingState.billingOwnerUserId,
    workspaceIncluded: _billingState.workspaceIncluded,
    workspaceCount: _billingState.workspaceCount,
    workspaceLimit: _billingState.workspaceLimit,
    canManageBilling: _billingState.canManageBilling,
    orgId: _billingState.orgId,
    pending: _billingState.pending,
    isPro: _billingState.isPro,
    isActive: _billingState.isActive,
    interval: _billingState.interval,
    trialEndsAt: _billingState.trialEndsAt,
    currentPeriodEnd: _billingState.currentPeriodEnd,
    cancelAtPeriodEnd: _billingState.cancelAtPeriodEnd,
    cancelAt: _billingState.cancelAt,
    portalAvailable: _billingState.portalAvailable,
    paymentProblem: _billingState.paymentProblem,
    paymentGraceUntil: _billingState.paymentGraceUntil,
    paymentGraceRemainingDays: _billingState.paymentGraceRemainingDays,
    action: _billingState.action,
    data: _billingState.data,
    error: _billingState.error,
    lastFetchedAt: _billingState.lastFetchedAt,
  };
}

function subscribeBilling(fn) {
  if (typeof fn === 'function') _billingSubscribers.add(fn);
  return () => _billingSubscribers.delete(fn);
}

function _waitForQueuedBillingRefresh() {
  return new Promise(resolve => {
    _billingRefreshQueuedWaiters.push(resolve);
  });
}

function _resolveBillingRefreshQueuedWaiters(snapshot = getBillingState()) {
  const waiters = _billingRefreshQueuedWaiters;
  _billingRefreshQueuedWaiters = [];
  waiters.forEach(resolve => {
    try {
      resolve(snapshot);
    } catch {
      // ignore
    }
  });
}

function clearBillingPendingRetry(orgId = null) {
  const targetOrgId = orgId ? String(orgId) : null;
  if (targetOrgId && _billingPendingRetry.orgId && _billingPendingRetry.orgId !== targetOrgId) return;
  if (_billingPendingRetry.timer) {
    try {
      clearTimeout(_billingPendingRetry.timer);
    } catch {
      // ignore
    }
  }
  _billingPendingRetry = { orgId: null, count: 0, timer: null };
}

function settleBillingPendingRetryExhausted(requestedOrgId, reason) {
  const targetOrgId = requestedOrgId ? String(requestedOrgId) : '';
  if (!targetOrgId) return;
  const activeOrgId = getActiveOrgIdForBilling();
  if ((activeOrgId || '') !== targetOrgId) {
    clearBillingPendingRetry(targetOrgId);
    return;
  }
  if ((_billingState.orgId || '') !== targetOrgId || (!_billingState.pending && !_billingState.loading)) {
    clearBillingPendingRetry(targetOrgId);
    return;
  }
  billingDebugLog('refresh:pending-retry-exhausted', {
    reason,
    requestedOrgId: targetOrgId,
    attempts: _billingPendingRetry.count,
  });
  clearBillingPendingRetry(targetOrgId);
  _billingRefreshQueued = false;
  _billingState.loading = false;
  _billingState.pending = false;
  _billingState.ok = false;
  _billingState.orgId = targetOrgId;
  _billingState.lastFetchedAt = 0;
  _billingState.data = null;
  _billingState.plan = null;
  _billingState.status = null;
  resetBillingEntitlementFields('billing_unavailable');
  _billingState.isPro = false;
  _billingState.isActive = false;
  _billingState.interval = null;
  _billingState.trialEndsAt = null;
  _billingState.currentPeriodEnd = null;
  _billingState.cancelAtPeriodEnd = false;
  _billingState.cancelAt = null;
  _billingState.portalAvailable = false;
  _billingState.paymentProblem = false;
  _billingState.paymentGraceUntil = null;
  _billingState.paymentGraceRemainingDays = null;
  _billingState.action = null;
  _billingState.error = {
    message: 'Billing is still syncing. Retry when you are back online.',
    status: null,
  };
  _notifyBilling();
  applyAccessGateFromBilling(getBillingState(), {
    reason: 'pending-retry-exhausted:' + reason,
    activeOrgId: targetOrgId,
  });
  _resolveBillingRefreshQueuedWaiters(getBillingState());
}

function scheduleBillingPendingRetry(requestedOrgId, reason) {
  const targetOrgId = requestedOrgId ? String(requestedOrgId) : '';
  if (!targetOrgId) return;
  if (_billingPendingRetry.orgId && _billingPendingRetry.orgId !== targetOrgId) clearBillingPendingRetry();
  const nextCount = _billingPendingRetry.orgId === targetOrgId ? _billingPendingRetry.count + 1 : 1;
  if (_billingPendingRetry.timer) return;
  if (nextCount > 2) {
    settleBillingPendingRetryExhausted(targetOrgId, reason);
    return;
  }
  _billingPendingRetry = {
    orgId: targetOrgId,
    count: nextCount,
    timer: setTimeout(() => {
      if (_billingPendingRetry.orgId !== targetOrgId) return;
      _billingPendingRetry = {
        ..._billingPendingRetry,
        timer: null,
      };
      const activeOrgId = getActiveOrgIdForBilling();
      if ((activeOrgId || '') !== targetOrgId) {
        clearBillingPendingRetry(targetOrgId);
        return;
      }
      refreshBilling({ force: true, reason: `pending-retry:${nextCount}:${reason}` }).catch(() => { });
    }, 2500),
  };
}

function clearBillingState() {
  clearBillingPendingRetry();
  _billingState.loading = false;
  _billingState.pending = false;
  _billingState.ok = false;
  _billingState.plan = null;
  _billingState.status = null;
  resetBillingEntitlementFields(null);
  _billingState.orgId = null;
  _billingState.isPro = false;
  _billingState.isActive = false;
  _billingState.interval = null;
  _billingState.trialEndsAt = null;
  _billingState.currentPeriodEnd = null;
  _billingState.cancelAtPeriodEnd = false;
  _billingState.cancelAt = null;
  _billingState.portalAvailable = false;
  _billingState.paymentProblem = false;
  _billingState.paymentGraceUntil = null;
  _billingState.paymentGraceRemainingDays = null;
  _billingState.action = null;
  _billingState.data = null;
  _billingState.error = null;
  _billingState.lastFetchedAt = 0;
  _billingLastFocusRefreshAt = 0;
  _lastAppliedBillingLfa = 0;
  _billingRefreshQueued = false;
  _resolveBillingRefreshQueuedWaiters(getBillingState());
  _lastProcessedBillingSigByOrg.clear();
  _billingEpoch++;
  _notifyBilling();
  applyAccessGateFromBilling(getBillingState(), { reason: 'clear' });
}

function isConfirmedActiveOrgAccessDeniedResult(result, requestedOrgId) {
  const requestOrgId = normalizeOrgIdForBilling(requestedOrgId || '');
  if (!requestOrgId || !result || result.pending) return false;
  if (Number(result.status) !== 403) return false;

  const resultOrgId = normalizeOrgIdForBilling(result && result.orgId ? result.orgId : '');
  const resultDataOrgId = normalizeOrgIdForBilling(result && result.data && result.data.orgId ? result.data.orgId : '');
  if (resultOrgId && resultOrgId !== requestOrgId) return false;
  if (resultDataOrgId && resultDataOrgId !== requestOrgId) return false;
  return true;
}

// ── Workspace readiness helper: prevents "create workspace" banner from sticking during auth wobble ──

async function refreshBilling({ force = false, reason = 'manual', authoritativeRefresh = null } = {}) {
  const requestedOrgId = getActiveOrgIdForBilling();
  const currentAuthoritativeRefresh = isCurrentBillingAuthoritativeRefreshToken(authoritativeRefresh, requestedOrgId)
    ? authoritativeRefresh
    : getBillingAuthoritativeRefreshToken(requestedOrgId);
  if (currentAuthoritativeRefresh) force = true;
  const now = Date.now();
  const billingKey = `${requestedOrgId || ''}|${String(reason || 'manual')}|${force ? '1' : '0'}`;
  if (!currentAuthoritativeRefresh && _lastBillingKey === billingKey && (now - _lastBillingKeyAt) < 300) {
    billingDebugLog('refresh:skip-burst', {
      reason,
      force,
      requestedOrgId: requestedOrgId || null,
      ageMs: now - _lastBillingKeyAt,
    });
    return getBillingState();
  }
  _lastBillingKey = billingKey;
  _lastBillingKeyAt = now;

  if (!requestedOrgId) {
    clearBillingPendingRetry();
    _billingState.loading = false;
    _billingState.pending = true;
    billingDebugLog('refresh:skip-no-org', { reason, force });
    return getBillingState();
  }

  if (_billingState.loading) {
    if (force) {
      _billingRefreshQueued = true;
    }
    billingDebugLog('refresh:skip-loading', { reason, force, requestedOrgId: requestedOrgId || null });
    return force ? _waitForQueuedBillingRefresh() : getBillingState();
  }
  if (
    !currentAuthoritativeRefresh &&
    force &&
    requestedOrgId &&
    _billingState.orgId &&
    requestedOrgId === _billingState.orgId &&
    _billingState.lastFetchedAt &&
    (now - _billingState.lastFetchedAt) < 5000 &&
    reason !== 'manual' &&
    (reason === 'org-changed' || reason === 'auth-change' || reason === 'render-auth-state' || reason === 'token-refresh' || reason === 'settings-open' || reason === 'queued')
  ) {
    billingDebugLog('refresh:skip-recent-forced', {
      reason,
      requestedOrgId,
      ageMs: now - _billingState.lastFetchedAt,
    });
    return getBillingState();
  }
  if (
    reason === 'manual' &&
    _billingState.ok &&
    requestedOrgId &&
    requestedOrgId === _billingState.orgId &&
    _billingState.lastFetchedAt &&
    (now - _billingState.lastFetchedAt) < 15000
  ) {
    billingDebugLog('refresh:skip-manual-recent', {
      requestedOrgId,
      ageMs: now - _billingState.lastFetchedAt,
    });
    return getBillingState();
  }
  if (
    !force &&
    !_billingState.pending &&
    requestedOrgId &&
    _billingState.orgId &&
    requestedOrgId === _billingState.orgId &&
    _billingState.lastFetchedAt &&
    (now - _billingState.lastFetchedAt) < BILLING_THROTTLE_MS
  ) {
    billingDebugLog('refresh:skip-throttle', {
      reason,
      requestedOrgId: requestedOrgId || null,
      ageMs: now - _billingState.lastFetchedAt,
    });
    applyAccessGateFromBilling(getBillingState(), { reason: 'throttled:' + reason, activeOrgId: requestedOrgId || null });
    return getBillingState();
  }

  // ── Cross-tab shared freshness: skip if another tab recently fetched for this org ──
  // force:true bypasses this guard so manual Retry/Refresh always triggers a real fetch.
  // Failed snapshots (ok:false, billing_unavailable, timeout) are never reused — only
  // successful ok:true snapshots are eligible for cross-tab freshness reuse.
  if (requestedOrgId) {
    const sharedFreshAt = _getSharedBillingFreshness(requestedOrgId);
    if (sharedFreshAt && (now - sharedFreshAt) < _BILLING_SHARED_FRESH_MS) {
      const shared = _readShareableBillingResult(requestedOrgId, 'refresh:' + reason);
      if (!force && shared) {
        billingDebugLog('billing:cross-tab-lock:skip-fresh', {
          reason,
          orgId: requestedOrgId,
          sharedAgeMs: now - sharedFreshAt,
        });
        if (_shouldApplySharedBillingSnapshotForOrg(requestedOrgId, sharedFreshAt)) {
          _applySharedBillingSnapshot(requestedOrgId, shared, 'shared-fresh:' + reason);
        }
        return getBillingState();
      } else if (!force) {
        const unshareableShared = _readSharedBillingResult(requestedOrgId);
        if (unshareableShared) {
          billingDebugLog('billing:cross-tab-lock:ignore-fresh-org-mismatch', {
            reason,
            orgId: requestedOrgId,
            stateOrgId: unshareableShared && unshareableShared.orgId ? unshareableShared.orgId : null,
          });
        }
      }
    }
  }

  // ── Cross-tab lock: only one tab may fetch at a time per org ──
  let _acquiredCrossTabLock = false;
  if (requestedOrgId && !currentAuthoritativeRefresh) {
    _acquiredCrossTabLock = _tryAcquireBillingLock(requestedOrgId, reason);
  }
  if (requestedOrgId && !currentAuthoritativeRefresh && !_acquiredCrossTabLock) {
    // Another tab is fetching — check if shared result is available
    const shared = _readShareableBillingResult(requestedOrgId, 'cross-tab-locked:' + reason);
    if (shared) {
      _applySharedBillingSnapshot(requestedOrgId, shared, 'cross-tab-locked:' + reason);
    }
    // Broadcast/storage listeners should update soon; keep one bounded retry for stale browsers.
    if (!String(reason || '').startsWith('cross-tab-retry:')) {
      const retryBillingEpoch = _billingEpoch;
      const retryOrgId = requestedOrgId;
      const retryDelayMs = _getBillingLockRetryDelay(retryOrgId);
      setTimeout(() => {
        if (_billingEpoch !== retryBillingEpoch) return;
        if (normalizeOrgIdForBilling(getActiveOrgIdForBilling()) !== retryOrgId) return;
        refreshBilling({ force: false, reason: 'cross-tab-retry:' + reason }).catch(() => { });
      }, retryDelayMs);
    }
    return getBillingState();
  }

  if (currentAuthoritativeRefresh) {
    if (isBillingAuthoritativeRefreshInFlight(currentAuthoritativeRefresh)) {
      billingDebugLog('refresh:skip-authoritative-inflight', {
        reason,
        requestedOrgId: requestedOrgId || null,
        generation: currentAuthoritativeRefresh.generation,
      });
      return getBillingState();
    }
    if (!beginBillingAuthoritativeRefreshAttempt(currentAuthoritativeRefresh)) return getBillingState();
  }

  try {
    const _epochAtStart = _billingEpoch;
    billingDebugLog('refresh:start', { reason, force, requestedOrgId: requestedOrgId || null });
    // ── BillingTrace (debug-only) ──
    if (isTp3dDebugEnabled()) {
      _billingTraceSeq += 1;
      const _tid = _billingTraceSeq;
      const callerHint = 'APP:' + (reason || 'manual');
      try { window.__TP3D_BILLING_TRACE_CURRENT_ID__ = _tid; } catch { /* ignore */ }
      const tracePayload = {
        id: _tid,
        reason,
        force,
        requestedOrgId: requestedOrgId || null,
        ageFromInitMs: now - _bootStartedAtMs,
        callerHint,
      };
      if (_tid <= 10) {
        try {
          const st = (new Error()).stack || '';
          const frames = st.split('\n').filter(l => l.trim()).slice(1, 5);
          tracePayload.stack = frames.map(f => f.trim());
        } catch { /* ignore */ }
      }
      console.info('[BillingTrace] start', tracePayload);
    }
    if (
      requestedOrgId &&
      (!_billingState.orgId || _billingState.orgId !== requestedOrgId)
    ) {
      const staleShared = _readShareableBillingResult(requestedOrgId, 'stale-cache-warmup:' + reason);
      if (staleShared) {
        _applySharedBillingSnapshot(requestedOrgId, staleShared, 'stale-cache-warmup:' + reason);
      }
    }
    _billingState.loading = true;
    _billingState.error = null;
    if (!_billingState.orgId || _billingState.orgId !== (requestedOrgId || null)) {
      _billingState.pending = true;
      _billingState.ok = false;
      _billingState.lastFetchedAt = 0;
      _billingState.data = null;
      _billingState.plan = null;
      _billingState.status = null;
      resetBillingEntitlementFields(null);
      _billingState.isPro = false;
      _billingState.isActive = false;
      _billingState.interval = null;
      _billingState.trialEndsAt = null;
      _billingState.currentPeriodEnd = null;
      _billingState.cancelAtPeriodEnd = false;
      _billingState.cancelAt = null;
      _billingState.portalAvailable = false;
    }
    _billingState.orgId = requestedOrgId || null;
    _notifyBilling();
    applyAccessGateFromBilling(getBillingState(), { reason: 'loading:' + reason, activeOrgId: requestedOrgId || null });

    // ── BillingTrace pre-fetch (debug-only) ──
    if (isTp3dDebugEnabled()) {
      const _pfTid = _billingTraceSeq; // already incremented above
      const _pfPayload = {
        id: _pfTid,
        reason,
        force,
        requestedOrgId: requestedOrgId || null,
        stateOrgId: _billingState.orgId || null,
      };
      if (_pfTid <= 8) {
        try {
          const st = (new Error()).stack || '';
          const frames = st.split('\n').filter(l => l.trim()).slice(1, 5);
          _pfPayload.stack = frames.map(f => f.trim());
        } catch { /* ignore */ }
      }
      console.info('[BillingTrace] pre-fetch', _pfPayload);
    }

    let result;
    try {
      result = await Promise.race([
        fetchBillingStatus(),
        new Promise(resolve => {
          setTimeout(() => {
            resolve({
              ok: false,
              status: 408,
              data: null,
              error: { message: 'Billing request timed out', status: 408 },
            });
          }, BILLING_REQUEST_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      result = { ok: false, status: null, data: null, error: { message: err && err.message ? err.message : 'Unknown error', status: null } };
    }

    _billingState.loading = false;

    // Epoch guard: if a sign-out (clearBillingState) happened while this fetch was in-flight,
    // discard the result so we don't re-hydrate billing state for a signed-out user.
    if (_billingEpoch !== _epochAtStart) {
      billingDebugLog('refresh:discard-epoch', { reason, epochAtStart: _epochAtStart, currentEpoch: _billingEpoch });
      return getBillingState();
    }

    const _activeOrgIdAfterFetch = getActiveOrgIdForBilling();
    if ((_activeOrgIdAfterFetch || '') !== (requestedOrgId || '')) {
      billingDebugLog('refresh:discard-stale-org', {
        reason,
        requestedOrgId: requestedOrgId || null,
        activeOrgId: _activeOrgIdAfterFetch || null,
      });
      clearBillingPendingRetry(requestedOrgId);
      _billingRefreshQueued = false;
      _resolveBillingRefreshQueuedWaiters(getBillingState());
      setTimeout(() => {
        refreshBilling({ force: true, reason: 'queued' }).catch(() => { });
      }, 0);
      return getBillingState();
    }

    if (
      currentAuthoritativeRefresh &&
      !isCurrentBillingAuthoritativeRefreshToken(currentAuthoritativeRefresh, requestedOrgId)
    ) {
      billingDebugLog('refresh:discard-authoritative-owner', {
        reason,
        requestedOrgId: requestedOrgId || null,
        generation: currentAuthoritativeRefresh.generation,
      });
      return getBillingState();
    }

    const resultOrgId = normalizeOrgIdForBilling(result && result.orgId ? result.orgId : '');
    const resultDataOrgId = normalizeOrgIdForBilling(result && result.data && result.data.orgId ? result.data.orgId : '');
    if (
      result &&
      result.ok &&
      requestedOrgId &&
      (
        (resultOrgId && resultOrgId !== requestedOrgId) ||
        (resultDataOrgId && resultDataOrgId !== requestedOrgId)
      )
    ) {
      billingDebugLog('refresh:discard-result-org-mismatch', {
        reason,
        requestedOrgId,
        resultOrgId: resultOrgId || null,
        resultDataOrgId: resultDataOrgId || null,
      });
      _billingState.loading = false;
      _billingState.pending = true;
      _billingState.ok = false;
      _billingState.orgId = requestedOrgId || null;
      _billingState.lastFetchedAt = 0;
      _billingState.data = null;
      _billingState.plan = null;
      _billingState.status = null;
      resetBillingEntitlementFields(null);
      _billingState.isPro = false;
      _billingState.isActive = false;
      _billingState.interval = null;
      _billingState.trialEndsAt = null;
      _billingState.currentPeriodEnd = null;
      _billingState.cancelAtPeriodEnd = false;
      _billingState.cancelAt = null;
      _billingState.portalAvailable = false;
      _billingState.error = null;
      _notifyBilling();
      applyAccessGateFromBilling(getBillingState(), { reason: 'stale-result:' + reason, activeOrgId: requestedOrgId || null });
      preserveUserSwitchPendingForBillingFailure(currentAuthoritativeRefresh);
      scheduleBillingPendingRetry(requestedOrgId, 'result-org-mismatch:' + reason);
      return getBillingState();
    }

    const resultUserId = result && result.data && result.data.userId ? String(result.data.userId) : '';
    if (
      currentAuthoritativeRefresh &&
      result &&
      result.ok &&
      resultUserId !== currentAuthoritativeRefresh.userId
    ) {
      billingDebugLog('refresh:discard-authoritative-user-mismatch', {
        reason,
        requestedOrgId: requestedOrgId || null,
        generation: currentAuthoritativeRefresh.generation,
      });
      result = {
        ok: false,
        pending: false,
        status: null,
        data: null,
        error: { message: 'Billing response identity mismatch', status: null },
        orgId: requestedOrgId || null,
      };
    }

    if (!(result && result.pending)) {
      _billingState.lastFetchedAt = Date.now();
    }

    if (result && result.pending) {
      _billingState.pending = true;
      _billingState.ok = false;
      _billingState.plan = null;
      _billingState.status = null;
      resetBillingEntitlementFields(null);
      _billingState.orgId = requestedOrgId || null;
      _billingState.isPro = false;
      _billingState.isActive = false;
      _billingState.interval = null;
      _billingState.trialEndsAt = null;
      _billingState.currentPeriodEnd = null;
      _billingState.cancelAtPeriodEnd = false;
      _billingState.cancelAt = null;
      _billingState.portalAvailable = false;
      _billingState.data = null;
      _billingState.error = null;
      _notifyBilling();
      applyAccessGateFromBilling(getBillingState(), { reason: 'pending:' + reason, activeOrgId: requestedOrgId || null });
      preserveUserSwitchPendingForBillingFailure(currentAuthoritativeRefresh);
      scheduleBillingPendingRetry(requestedOrgId, reason);
      return getBillingState();
    }

    // Cross-profile session revocation: billing-status 401 means the server rejected our session.
    // BroadcastChannel/localStorage cannot cross isolated Chrome profiles, so this is the
    // detection point for a profile whose server session was revoked elsewhere.
    if (result && !result.pending && !result.skipped && Number(result.status) === 401) {
      billingDebugLog('refresh:session-revoked-401', { reason, requestedOrgId: requestedOrgId || null });
      if (SupabaseClient && typeof SupabaseClient.signOut === 'function') {
        void SupabaseClient.signOut({ global: false, allowOffline: true }).catch(() => { /* ignore */ });
      }
      return getBillingState();
    }

    if (isConfirmedActiveOrgAccessDeniedResult(result, requestedOrgId)) {
      const handled = _orgAccessLossHandler
        ? _orgAccessLossHandler(requestedOrgId, {
          reason,
          status: result.status,
          message: result && result.error && result.error.message ? String(result.error.message) : null,
        })
        : false;
      if (handled) return getBillingState();
      if (!handled) {
        try {
          const _uic = typeof window !== 'undefined' && window.__TP3D_UI ? window.__TP3D_UI : null;
          if (_uic && typeof _uic.showToast === 'function') {
            _uic.showToast(
              'You no longer have access to this workspace. Switch workspace or contact the owner.',
              'warning',
              { title: 'Access Denied' },
            );
          }
        } catch (_) { /* toast must not throw from billing handler */ }
      }
    }

    _billingState.pending = false;
    clearBillingPendingRetry(requestedOrgId);
    _billingState.ok = Boolean(result && result.ok);

    if (result && result.ok && result.data) {
      // Edge function now returns a flat payload: { ok, userId, plan, status, isActive, trialEndsAt, currentPeriodEnd, ... }
      const p = result.data;
      _billingState.data = p;
      const planRaw = p.plan ? String(p.plan) : 'free';
      let isActive = Boolean(p.isActive);
      let isPro = planRaw === 'pro' && isActive;
      let plan = planRaw === 'pro' ? 'Pro' : 'Free';

      // Dev-only per-user plan override (localhost/127.0.0.1 + debug only)
      try {
        const _ls = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
        const _loc = typeof window !== 'undefined' ? window.location : null;
        const _isLocal = _loc && (_loc.hostname === 'localhost' || _loc.hostname === '127.0.0.1');
        const _isDebug = _ls && _ls.getItem('tp3dDebug') === '1';
        if (_isLocal && _isDebug && _ls) {
          // Legacy tp3dForceTrial support
          if (_ls.getItem('tp3dForceTrial') === '1' && !isActive) {
            plan = 'Pro'; isActive = true; isPro = true;
          }
          // Per-user override: tp3dDevUserPlanOverride = JSON { "<userId>": { plan, status } }
          const overrideRaw = _ls.getItem('tp3dDevUserPlanOverride');
          if (overrideRaw && p.userId) {
            const overrides = JSON.parse(overrideRaw);
            const userOv = overrides[String(p.userId)];
            if (userOv && userOv.plan) {
              const ovPlan = String(userOv.plan);
              plan = ovPlan === 'pro' || ovPlan === 'trial' ? 'Pro' : 'Free';
              isActive = userOv.status === 'active' || userOv.status === 'trialing';
              isPro = isActive && (plan === 'Pro');
              console.info('[Billing][DEV] Per-user override applied:', { userId: p.userId, plan, isActive, isPro });
            }
          }
        }
      } catch { /* ignore */ }

      _billingState.plan = plan;
      _billingState.status = p.status ? String(p.status) : null;
      applyBillingEntitlementFields(p, null);
      _billingState.orgId = p.orgId ? String(p.orgId) : (requestedOrgId || null);
      _billingState.isPro = isPro;
      _billingState.isActive = isActive;
      _billingState.interval = p.interval ? String(p.interval) : null;
      _billingState.trialEndsAt = p.trialEndsAt ? String(p.trialEndsAt) : null;
      _billingState.currentPeriodEnd = p.currentPeriodEnd ? String(p.currentPeriodEnd) : null;
      _billingState.cancelAtPeriodEnd = Boolean(p.cancelAtPeriodEnd);
      _billingState.cancelAt = p.cancelAt ? String(p.cancelAt) : null;
      _billingState.portalAvailable = Boolean(p.portalAvailable);
      _billingState.paymentProblem = Boolean(p.paymentProblem);
      _billingState.paymentGraceUntil = p.paymentGraceUntil ? String(p.paymentGraceUntil) : null;
      _billingState.paymentGraceRemainingDays = p.paymentGraceRemainingDays != null ? Number(p.paymentGraceRemainingDays) : null;
      _billingState.action = p.action ? String(p.action) : null;
      _billingState.error = null;
    } else {
      _billingState.data = result ? result.data : null;
      _billingState.plan = null;
      _billingState.status = null;
      resetBillingEntitlementFields('billing_unavailable');
      _billingState.orgId = requestedOrgId || null;
      _billingState.isPro = false;
      _billingState.isActive = false;
      _billingState.interval = null;
      _billingState.trialEndsAt = null;
      _billingState.currentPeriodEnd = null;
      _billingState.cancelAtPeriodEnd = false;
      _billingState.cancelAt = null;
      _billingState.portalAvailable = false;
      _billingState.paymentProblem = false;
      _billingState.paymentGraceUntil = null;
      _billingState.paymentGraceRemainingDays = null;
      _billingState.action = null;
      _billingState.error = result && result.error ? result.error : { message: 'Unknown error', status: null };
    }

    if (_billingState.ok && currentAuthoritativeRefresh) {
      clearBillingAuthoritativeRefreshRequirement(currentAuthoritativeRefresh, 'matching-direct-success');
    } else {
      preserveUserSwitchPendingForBillingFailure(currentAuthoritativeRefresh);
    }

    _notifyBilling();
    applyAccessGateFromBilling(getBillingState(), { reason: 'refreshed:' + reason, activeOrgId: requestedOrgId || null });

    // Trial enforcement: if trial expired and not active, show upgrade notice
    try {
      const _bs = getBillingState();
      const _entitlementStatus = normalizeBillingEntitlementStatus(_bs.entitlementStatus);
      const _isTrueTrialExpired = _entitlementStatus
        ? _entitlementStatus === 'trial_expired'
        : Boolean(!_bs.isActive && _bs.trialEndsAt);
      if (_bs.ok && _isTrueTrialExpired && _bs.trialEndsAt) {
        const endMs = new Date(_bs.trialEndsAt).getTime();
        if (Number.isFinite(endMs) && endMs < Date.now()) {
          // Trial has expired — show persistent upgrade notice (use global ref since refreshBilling is outside IIFE)
          const _uic = typeof window !== 'undefined' && window.__TP3D_UI ? window.__TP3D_UI : null;
          if (_uic && typeof _uic.showToast === 'function') {
            _uic.showToast(
              'Your free trial has ended. Upgrade to Pro to continue using premium features.',
              'warning',
              { title: 'Trial Expired', duration: 10000 },
            );
          }
        }
      }
    } catch (_) { /* ignore */ }

    try {
      if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('tp3dDebug') === '1') {
        const _dbgState = getBillingState();
        const _dbgData = _dbgState.data || {};
        console.info('[Billing] refreshed', _dbgState);
        console.info('[Billing][DEV] userId:', _dbgData.userId || 'unknown', '| orgId:', _dbgData.orgId || 'none');
        console.info('[Billing][DEV] To override, set: localStorage.tp3dDevUserPlanOverride = \'{"' + (_dbgData.userId || '<userId>') + '": {"plan":"pro","status":"active"}}\'');
      }
    } catch (_) { /* ignore */ }

    // ── Cross-tab: write shared result and broadcast ──
    if (requestedOrgId) {
      _writeSharedBillingResult(requestedOrgId, getBillingState());
      _broadcastBillingResult(requestedOrgId, getBillingState());
    }

    if (_billingRefreshQueued) {
      _billingRefreshQueued = false;
      setTimeout(() => {
        refreshBilling({ force: true, reason: 'queued' })
          .then(snapshot => {
            _resolveBillingRefreshQueuedWaiters(snapshot);
          })
          .catch(() => {
            _resolveBillingRefreshQueuedWaiters(getBillingState());
          });
      }, 0);
    }
    return getBillingState();
  } finally {
    finishBillingAuthoritativeRefreshAttempt(currentAuthoritativeRefresh);
    if (requestedOrgId && _acquiredCrossTabLock) {
      _releaseBillingLock(requestedOrgId, reason);
    }
  }
}

/** @param {Record<string, any>} billingSnapshot – from getBillingState() */
function canUseProFeatures(billingSnapshot) {
  const s = billingSnapshot || getBillingState();
  return Boolean(getProRuleSet(s).canUseProFeature);
}

/**
 * Single source of truth for Pro-only feature gates.
 * Returns billing + role state needed by all Pro-gated actions.
 * @param {Record<string, any>} [billingSnapshot] - from getBillingState(); defaults to current state.
 * @param {string} [userRole] - override; defaults to orgContext.role in module scope.
 * @returns {{
 *   isProActive: boolean,
 *   isTrial: boolean,
 *   isTrialExpired: boolean,
 *   isPaymentProblem: boolean,
 *   canUseProFeature: boolean,
 *   blockReason: string,
 *   uxMessage: string,
 *   isOwner: boolean,
 *   isWorkspaceLimitReached: boolean,
 *   isOwnerSubRequired: boolean,
 *   isBillingUnavailable: boolean
 * }}
 */
function getProRuleSet(billingSnapshot, userRole) {
  const s = billingSnapshot || getBillingState();
  const authoritativeRefreshRequired = isBillingAuthoritativeRefreshRequired();
  const rawRole = String(userRole != null ? userRole : '').toLowerCase();
  const entitlementStatus = normalizeBillingEntitlementStatus(s.entitlementStatus);
  const isOwner = typeof s.canManageBilling === 'boolean' ? s.canManageBilling : rawRole === 'owner';

  const isTrial = entitlementStatus
    ? entitlementStatus === 'trialing'
    : Boolean(s.ok && s.isPro && s.isActive && s.status === 'trialing');
  const isTrialExpired = entitlementStatus
    ? entitlementStatus === 'trial_expired'
    : Boolean(s.ok && !s.isActive && s.status === 'trial_expired');
  const isPaymentProblem = Boolean(s.ok && s.paymentProblem);
  const canUseProFeature = entitlementStatus
    ? Boolean(!authoritativeRefreshRequired && s.ok && isEntitlementAllowed(entitlementStatus))
    : Boolean(!authoritativeRefreshRequired && s.ok && s.isPro && s.isActive); // trial OR paid Pro
  const isProActive = entitlementStatus
    ? Boolean(!authoritativeRefreshRequired && s.ok && (entitlementStatus === 'active' || entitlementStatus === 'included_in_plan'))
    : Boolean(!authoritativeRefreshRequired && s.ok && s.isPro && s.isActive && !isTrial);
  const isWorkspaceLimitReached = entitlementStatus === 'workspace_limit_reached';
  const isOwnerSubRequired = entitlementStatus === 'owner_subscription_required';
  const isBillingUnavailable = authoritativeRefreshRequired || entitlementStatus === 'billing_unavailable' || !s.ok;

  let blockReason = '';
  let uxMessage = '';
  if (isBillingUnavailable) {
    blockReason = 'billing_unavailable';
    uxMessage = 'Billing unavailable. Please try again.';
  } else if (isTrialExpired) {
    blockReason = 'trial_expired';
    // TODO: replace support@pxl360.com with the real support email later.
    uxMessage = isOwner
      ? 'Your free trial has ended. Upgrade to Pro to continue.'
      : 'Ask your owner to upgrade this workspace or contact support: support@pxl360.com';
  } else if (isPaymentProblem && !s.isActive) {
    blockReason = 'payment_failed';
    uxMessage = isOwner
      ? 'Payment issue \u2014 fix your payment method to restore Pro features.'
      : 'Payment issue \u2014 ask the workspace owner to update billing.';
  } else if (isWorkspaceLimitReached) {
    blockReason = 'workspace_limit_reached';
    uxMessage = isOwner
      ? 'Workspace limit reached. Upgrade your plan or free a workspace slot to use this Pro feature.'
      : 'This workspace is not included in the owner plan. Ask the workspace owner to include it.';
  } else if (isOwnerSubRequired) {
    blockReason = 'owner_subscription_required';
    uxMessage = isOwner
      ? 'Start a subscription to use this Pro feature.'
      : 'The workspace owner needs to start or restore a subscription before this Pro feature is available.';
  } else if (!canUseProFeature) {
    blockReason = 'not_pro';
    // TODO: replace support@pxl360.com with the real support email later.
    uxMessage = isOwner
      ? 'This is a Pro feature. Upgrade to continue.'
      : 'Ask your owner to upgrade this workspace or contact support: support@pxl360.com';
  }

  return {
    isProActive,
    isTrial,
    isTrialExpired,
    isPaymentProblem,
    canUseProFeature,
    blockReason,
    uxMessage,
    isOwner,
    isWorkspaceLimitReached,
    isOwnerSubRequired,
    isBillingUnavailable,
  };
}

/**
 * @param {unknown} value
 * @returns {'month'|'year'}
 */
function normalizeCheckoutInterval(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'year' ? 'year' : 'month';
}

function getCheckoutPlanOptions() {
  // Stripe price IDs are resolved server-side from env-configured values.
  return {
    month: {
      interval: 'month',
      label: 'Pro (Monthly)',
      description: '$19.99/mo',
      available: true,
    },
    year: {
      interval: 'year',
      label: 'Pro (Yearly)',
      description: '$199/yr',
      available: true,
    },
  };
}

const BILLING_ACTION_CONTEXT_CHANGED_ERROR = 'Billing context changed. Please try again.';
let _billingActionGeneration = 0;

function captureBillingActionContext(action) {
  const readCurrent = () => {
    let authState;
    let authEpoch;
    try {
      authState = SupabaseClient && typeof SupabaseClient.getAuthState === 'function'
        ? SupabaseClient.getAuthState()
        : null;
      authEpoch = SupabaseClient && typeof SupabaseClient.getAuthEpoch === 'function'
        ? SupabaseClient.getAuthEpoch()
        : null;
    } catch {
      authState = null;
      authEpoch = null;
    }
    const status = authState && authState.status ? String(authState.status) : 'unknown';
    const session = authState && authState.session ? authState.session : null;
    const user = authState && authState.user
      ? authState.user
      : session && session.user
        ? session.user
        : null;
    const userId = user && user.id ? String(user.id) : '';
    const sessionUserId = session && session.user && session.user.id ? String(session.user.id) : '';
    const signedIn = Boolean(
      status === 'signed_in' &&
      userId &&
      sessionUserId === userId &&
      session &&
      session.access_token
    );
    const activeOrgId = getActiveOrgIdForBilling();
    const billingOrgId = normalizeOrgIdForBilling(_billingState.orgId || '');
    const authorityConfirmed = Boolean(
      _billingState.ok === true &&
      !_billingState.loading &&
      !_billingState.pending &&
      !_billingState.error &&
      _billingState.canManageBilling === true
    );
    return {
      authEpoch,
      status,
      userId,
      signedIn,
      activeOrgId,
      billingEpoch: _billingEpoch,
      billingOrgId,
      authorityConfirmed,
    };
  };

  _billingActionGeneration += 1;
  const generation = _billingActionGeneration;
  const started = readCurrent();
  const validAtStart = Boolean(
    started.signedIn &&
    Number.isFinite(started.authEpoch) &&
    started.userId &&
    started.activeOrgId &&
    started.billingOrgId === started.activeOrgId &&
    started.authorityConfirmed
  );

  return {
    generation,
    validAtStart,
    isCurrent() {
      const current = readCurrent();
      let reason = '';
      if (generation !== _billingActionGeneration) reason = 'superseded';
      else if (!current.signedIn) reason = 'signed-out';
      else if (current.authEpoch !== started.authEpoch) reason = 'auth-epoch';
      else if (current.userId !== started.userId) reason = 'user';
      else if (current.activeOrgId !== started.activeOrgId) reason = 'active-org';
      else if (current.billingOrgId !== started.activeOrgId) reason = 'billing-org';
      else if (current.billingEpoch !== started.billingEpoch) reason = 'billing-epoch';
      else if (!current.authorityConfirmed) reason = 'billing-authority';
      if (reason) {
        billingDebugLog(`${action}:discard-stale-context`, {
          generation,
          currentGeneration: _billingActionGeneration,
          reason,
        });
      }
      return !reason;
    },
  };
}

/**
 * Start Stripe Checkout for a given billing interval.
 * @param {string|{interval?:'month'|'year',priceId?:string,price_id?:string}} input
 * @returns {Promise<{ok:boolean, error:string|null}>}
 */
async function startCheckout(input) {
  const actionContext = captureBillingActionContext('checkout');
  if (!actionContext.validAtStart) {
    return { ok: false, error: BILLING_ACTION_CONTEXT_CHANGED_ERROR };
  }
  let interval = 'month';
  let priceId = '';
  let hasExplicitInterval = false;
  if (typeof input === 'string') {
    if (input === 'month' || input === 'year') {
      interval = normalizeCheckoutInterval(input);
      hasExplicitInterval = true;
    } else {
      priceId = String(input || '').trim();
    }
  } else if (input && typeof input === 'object') {
    if (typeof input.interval !== 'undefined') {
      interval = normalizeCheckoutInterval(input.interval);
      hasExplicitInterval = true;
    }
    const rawPriceId = input.priceId || input.price_id;
    if (rawPriceId) priceId = String(rawPriceId).trim();
  }
  /** @type {{interval?:'month'|'year', priceId?:string}} */
  const checkoutPayload = {};
  if (hasExplicitInterval) checkoutPayload.interval = /** @type {'month'|'year'} */ (interval);
  if (priceId) checkoutPayload.priceId = priceId;
  if (!hasExplicitInterval && !priceId) checkoutPayload.interval = /** @type {'month'|'year'} */ (interval);

  billingDebugLog('checkout:start', {
    interval,
    hasExplicitInterval,
    hasPriceId: Boolean(priceId),
    activeOrgId: getActiveOrgIdForBilling() || null,
  });
  const result = await Promise.race([
    createCheckoutSession(checkoutPayload),
    new Promise(resolve => {
      setTimeout(() => resolve({ ok: false, url: null, error: 'Checkout request timed out' }), BILLING_REQUEST_TIMEOUT_MS);
    }),
  ]);
  billingDebugLog('checkout:result', { ok: Boolean(result && result.ok), error: result && result.error ? String(result.error) : null });
  if (result.ok && result.url) {
    if (!actionContext.isCurrent()) {
      return { ok: false, error: BILLING_ACTION_CONTEXT_CHANGED_ERROR };
    }
    window.location.href = result.url;
    return { ok: true, error: null };
  }
  return { ok: false, error: result.error || 'Checkout failed' };
}

/**
 * Open Stripe Billing Portal for managing subscription.
 * @returns {Promise<{ok:boolean, error:string|null}>}
 */
async function openPortal() {
  const actionContext = captureBillingActionContext('portal');
  if (!actionContext.validAtStart) {
    return { ok: false, error: BILLING_ACTION_CONTEXT_CHANGED_ERROR };
  }
  billingDebugLog('portal:start', { activeOrgId: getActiveOrgIdForBilling() || null });
  const result = await Promise.race([
    createPortalSession(),
    new Promise(resolve => {
      setTimeout(() => resolve({ ok: false, url: null, error: 'Portal request timed out' }), BILLING_REQUEST_TIMEOUT_MS);
    }),
  ]);
  billingDebugLog('portal:result', { ok: Boolean(result && result.ok), error: result && result.error ? String(result.error) : null });
  if (result.ok && result.url) {
    if (!actionContext.isCurrent()) {
      return { ok: false, error: BILLING_ACTION_CONTEXT_CHANGED_ERROR };
    }
    window.location.href = result.url;
    return { ok: true, error: null };
  }
  return { ok: false, error: result.error || 'Portal session failed' };
}
  // ==========================================================================
  // Late-bound setters + narrow private methods for RETAINED root orchestration.
  // Private module-instance API only — never on window.__TP3D_BILLING.
  // ==========================================================================
  function setBillingGateApplier(fn) { _billingGateApplier = fn; }
  function setAuthTruthSnapshotAccessor(fn) { _authTruthSnapshotAccessor = fn; }
  function setOrgAccessLossHandler(fn) { _orgAccessLossHandler = fn; }
  // Burst-dedup reset for resetBillingPumpForUserSwitch (root pump) — exact prior effect.
  function resetRefreshDedupForUserSwitch() { _lastBillingKey = ''; _lastBillingKeyAt = 0; }
  // Focus-throttle accessors for the retained root focus/visibility handler.
  function getLastFocusRefreshAt() { return _billingLastFocusRefreshAt; }
  function markFocusRefreshAt(nowTs) { _billingLastFocusRefreshAt = nowTs; }
  // Authoritative-refresh marker read for the retained signed-out-cleanup debug log.
  function isAuthoritativeRefreshMarkerSet() { return _billingRequireAuthoritativeOnNextSignIn; }

  return {
    // Public facade members (also called internally by root via BillingService.*).
    getBillingState,
    subscribeBilling,
    refreshBilling,
    clearBillingState,
    canUseProFeatures,
    getProRuleSet,
    getCheckoutPlanOptions,
    startCheckout,
    openPortal,
    // Private module-instance API (off the browser facade) for root/IIFE orchestration.
    applyAccessGateFromBilling,
    setBillingGateApplier,
    setAuthTruthSnapshotAccessor,
    setOrgAccessLossHandler,
    getActiveOrgIdForBilling,
    clearBillingAuthoritativeRefreshRequirement,
    markBillingAuthoritativeRefreshForNextSignIn,
    billingAuthLifecycleDebugLog,
    abbreviateBillingLifecycleId,
    clearBillingPendingRetry,
    reconcileBillingStateForActiveOrg,
    transferPendingPostSignoutBillingRequirementForAuthenticatedUser,
    getCurrentBillingAuthUserId,
    requireBillingAuthoritativeRefreshForUserSwitch,
    getBillingAuthoritativeRefreshToken,
    isBillingAuthoritativeRefreshInFlight,
    isEntitlementAllowed,
    _getSharedBillingFreshness,
    _readShareableBillingResult,
    _readSharedBillingResult,
    _applySharedBillingSnapshot,
    _shouldApplySharedBillingSnapshotForOrg,
    resetRefreshDedupForUserSwitch,
    getLastFocusRefreshAt,
    markFocusRefreshAt,
    isAuthoritativeRefreshMarkerSet,
  };
}
