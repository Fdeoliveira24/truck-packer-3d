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

import { initTP3DDebugger } from './debugger.js';
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
import {
  fetchBillingStatus,
  createCheckoutSession,
  createPortalSession,
  acceptOrgInvite,
} from './data/services/billing.service.js';

// ============================================================================
// SECTION: INITIALIZATION
// ============================================================================

initTP3DDebugger();

// ============================================================================
// SECTION: BILLING STATE (edge function)
// ============================================================================

const _billingState = {
  pending: true,
  loading: false,
  ok: false,
  plan: null,
  status: null,
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
const BILLING_FOCUS_REFRESH_COOLDOWN_MS = 300000; // 5 minutes — do not spam refresh on every focus
let _billingRefreshQueued = false;
let _billingLastFocusRefreshAt = 0;
let _lastBillingKey = '';
let _lastBillingKeyAt = 0;
let _billingTraceSeq = 0;
let _billingEpoch = 0; // incremented on sign-out; late refresh results are ignored when epoch changes
const _bootStartedAtMs = Date.now();
/** @type {null|((snapshot:any, meta?:{reason?:string, activeOrgId?:string|null})=>void)} */
let _billingGateApplier = null;

// ============================================================================
// SECTION: CROSS-TAB BILLING COORDINATION (Rule C)
// ============================================================================
const _BILLING_LOCK_TTL_MS = 20000;      // lock expires after 20s (dead-tab safety)
const _BILLING_SHARED_FRESH_MS = 90000;   // shared result considered fresh for 90s (cross-tab window)
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
    const fetchedAt = Number(state && state.lastFetchedAt) || Date.now();
    window.localStorage.setItem(_billingFreshKey(orgId), String(fetchedAt));
    // Keep legacy key writable for older tabs that still read tp3d:* keys.
    window.localStorage.setItem(_billingLegacyFreshKey(orgId), String(fetchedAt));
    // Write a minimal snapshot (avoid storing large data blobs)
    const mini = {
      ok: state.ok, plan: state.plan, status: state.status, orgId: state.orgId,
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

function _applySharedBillingSnapshot(orgId, state, reason = 'cross-tab-shared') {
  if (!state || typeof state !== 'object') return false;
  _billingState.pending = false;
  _billingState.loading = false;
  _billingState.ok = Boolean(state.ok);
  _billingState.plan = state.plan || null;
  _billingState.status = state.status || null;
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

function _broadcastBillingResult(orgId, state) {
  if (!_billingBroadcast) return;
  try {
    _billingBroadcast.postMessage({ type: 'billing-result', orgId, state: {
      ok: state.ok, plan: state.plan, status: state.status, orgId: state.orgId,
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

  // Callers MUST have called _ctSigSeenOrMark before reaching here.
  // This is a safety net — if somehow called directly without pre-check, dedupe here too.
  const _ctSig = _buildCrossTabBillingSig(orgId, state);
  if (_lastProcessedBillingSigByOrg.get(orgId) === _ctSig) return; // silent exit (already marked by caller)

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
    const state = _readSharedBillingResult(orgId);
    if (!state) return;
    // Per-org signature dedupe: BEFORE any log or handler work
    const _storageSig = _buildCrossTabBillingSig(orgId, state);
    if (_ctSigSeenOrMark(orgId, _storageSig)) return; // seen → silent exit
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
        // Per-org signature dedupe: BEFORE any log or handler work
        const _bcSig = _buildCrossTabBillingSig(msg.orgId, msg.state);
        if (_ctSigSeenOrMark(msg.orgId, _bcSig)) return; // seen → silent exit
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

function isTp3dDebugEnabled() {
  try {
    if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('tp3dDebug') === '1') return true;
  } catch (_) { /* ignore */ }
  try {
    if (typeof URLSearchParams !== 'undefined' && new URLSearchParams(window.location.search).get('tp3dDebug') === '1') return true;
  } catch (_) { /* ignore */ }
  try {
    if (typeof window !== 'undefined' && window.sessionStorage && window.sessionStorage.getItem('tp3dDebug') === '1') return true;
  } catch (_) { /* ignore */ }
  return false;
}

function billingDebugLog(step, details) {
  if (!isTp3dDebugEnabled()) return;
  if (typeof details === 'undefined') {
    console.info('[Billing][App]', step);
    return;
  }
  console.info('[Billing][App]', step, details);
}

const ORG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOrgIdForBilling(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'personal') return '';
  return ORG_UUID_RE.test(raw) ? raw : '';
}

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

function clearBillingState() {
  _billingState.loading = false;
  _billingState.pending = false;
  _billingState.ok = false;
  _billingState.plan = null;
  _billingState.status = null;
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
  _lastProcessedBillingSigByOrg.clear();
  _billingEpoch++;
  _notifyBilling();
  applyAccessGateFromBilling(getBillingState(), { reason: 'clear' });
}

// ── Workspace readiness helper: prevents "create workspace" banner from sticking during auth wobble ──
let _workspaceReadyInflight = false;
/** @type {() => boolean} Module-level accessor, set by IIFE once auth gate is initialized. */
let _authGateIsSettledAccessor = () => false;
/** @type {() => {status:string,userId:string|null,hasToken:boolean,isSignedIn:boolean}|null} */
let _authTruthSnapshotAccessor = () => null;
/** @type {(orgId:string) => 'hydrated'|'inflight'|'unknown'} Module-level accessor for org role hydration state */
let _getOrgRoleHydrationStateAccessor = () => 'unknown';
async function ensureWorkspaceReadyForUI({ timeoutMs = 2500, pollMs = 80, forceFirst = true } = {}) {
  try {
    const mod = await import('./core/supabase-client.js');
    const start = Date.now();
    const authTruth = typeof _authTruthSnapshotAccessor === 'function' ? _authTruthSnapshotAccessor() : null;
    if (authTruth && authTruth.status === 'signed_out' && _authGateIsSettledAccessor()) {
      return { ok: false, reason: 'signed-out' };
    }

    // Optional: first try with force=true to prime caches quickly
    if (forceFirst) {
      try {
        const b0 = await mod.getAccountBundleSingleFlight({ force: true });
        const active0 = b0 && b0.activeOrgId ? String(b0.activeOrgId) : null;
        const orgCount0 = b0 && Number.isFinite(b0.orgCount) ? b0.orgCount : (b0 && b0.orgs ? b0.orgs.length : 0);
        if (active0) return { ok: true, activeOrgId: active0, orgCount: orgCount0, bundle: b0, source: 'force-first' };
        // Only return no-org when bundle is definitive (non-null) AND auth is settled.
        // A null bundle means "couldn't fetch" — NOT "user has no org."
        if (b0 && !b0.partial && orgCount0 === 0 && _authGateIsSettledAccessor()) {
          return { ok: false, reason: 'no-org', orgCount: 0, bundle: b0, source: 'force-first' };
        }
        // Auth not settled OR bundle null → do NOT return no-org yet, fall through to polling
        if (orgCount0 === 0) {
          if (typeof isTp3dDebugEnabled === 'function' && isTp3dDebugEnabled()) {
            console.info('[workspaceReady] defer-no-org:auth-not-settled (force-first)', {
              bundle: b0 ? 'present' : 'null', settled: _authGateIsSettledAccessor(),
            });
          }
        }
      } catch {
        // ignore and fall through to polling
      }
    }

    while (Date.now() - start < timeoutMs) {
      const b = await mod.getAccountBundleSingleFlight({ force: false });
      const loopAuthTruth = typeof _authTruthSnapshotAccessor === 'function' ? _authTruthSnapshotAccessor() : null;
      if (loopAuthTruth && loopAuthTruth.status === 'signed_out' && _authGateIsSettledAccessor()) {
        return { ok: false, reason: 'signed-out' };
      }
      const activeOrgId = b && b.activeOrgId ? String(b.activeOrgId) : null;
      const orgCount = b && Number.isFinite(b.orgCount) ? b.orgCount : (b && b.orgs ? b.orgs.length : 0);

      if (activeOrgId) return { ok: true, activeOrgId, orgCount, bundle: b, source: 'poll' };
      // Only return no-org when bundle is definitive (non-null) AND auth is settled.
      if (b && !b.partial && orgCount === 0 && _authGateIsSettledAccessor()) {
        return { ok: false, reason: 'no-org', orgCount: 0, bundle: b, source: 'poll' };
      }
      if (orgCount === 0) {
        if (typeof isTp3dDebugEnabled === 'function' && isTp3dDebugEnabled()) {
          console.info('[workspaceReady] defer-no-org:auth-not-settled (poll)', {
            bundle: b ? 'present' : 'null', settled: _authGateIsSettledAccessor(),
          });
        }
      }

      await new Promise(r => setTimeout(r, pollMs));
    }

    return { ok: false, reason: 'timeout' };
  } catch (e) {
    return { ok: false, reason: 'error', error: e };
  }
}

async function refreshBilling({ force = false, reason = 'manual' } = {}) {
  const requestedOrgId = getActiveOrgIdForBilling();
  const now = Date.now();
  const billingKey = `${requestedOrgId || ''}|${String(reason || 'manual')}|${force ? '1' : '0'}`;
  if (_lastBillingKey === billingKey && (now - _lastBillingKeyAt) < 300) {
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
    _billingState.loading = false;
    _billingState.pending = true;
    billingDebugLog('refresh:skip-no-org', { reason, force });
    return getBillingState();
  }

  if (_billingState.loading) {
    if (force) _billingRefreshQueued = true;
    billingDebugLog('refresh:skip-loading', { reason, force, requestedOrgId: requestedOrgId || null });
    return getBillingState();
  }
  if (
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
  // Applies even on "force" calls: force bypasses local throttle, not cross-tab single-flight.
  if (requestedOrgId) {
    const sharedFreshAt = _getSharedBillingFreshness(requestedOrgId);
    if (sharedFreshAt && (now - sharedFreshAt) < _BILLING_SHARED_FRESH_MS) {
      const shared = _readSharedBillingResult(requestedOrgId);
      if (shared) {
        billingDebugLog('billing:cross-tab-lock:skip-fresh', {
          reason,
          orgId: requestedOrgId,
          sharedAgeMs: now - sharedFreshAt,
        });
        if (!_billingState.lastFetchedAt || _billingState.lastFetchedAt < sharedFreshAt) {
          _applySharedBillingSnapshot(requestedOrgId, shared, 'shared-fresh:' + reason);
        }
        return getBillingState();
      }
    }
  }

  // ── Cross-tab lock: only one tab may fetch at a time per org ──
  let _acquiredCrossTabLock = false;
  if (requestedOrgId) {
    _acquiredCrossTabLock = _tryAcquireBillingLock(requestedOrgId, reason);
  }
  if (requestedOrgId && !_acquiredCrossTabLock) {
    // Another tab is fetching — check if shared result is available
    const shared = _readSharedBillingResult(requestedOrgId);
    if (shared) {
      _applySharedBillingSnapshot(requestedOrgId, shared, 'cross-tab-locked:' + reason);
    }
    // Broadcast/storage listeners should update soon; keep one bounded retry for stale browsers.
    if (!String(reason || '').startsWith('cross-tab-retry:')) {
      setTimeout(() => {
        refreshBilling({ force: false, reason: 'cross-tab-retry:' + reason }).catch(() => { });
      }, 1200);
    }
    return getBillingState();
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
    _billingState.loading = true;
    _billingState.error = null;
    if (!_billingState.orgId || _billingState.orgId !== (requestedOrgId || null)) {
      _billingState.pending = true;
      _billingState.plan = null;
      _billingState.status = null;
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

    if (!(result && result.pending)) {
      _billingState.lastFetchedAt = Date.now();
    }

    if (result && result.pending) {
      _billingState.pending = true;
      _billingState.ok = false;
      _billingState.plan = null;
      _billingState.status = null;
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
      return getBillingState();
    }

    _billingState.pending = false;
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

    _notifyBilling();
    applyAccessGateFromBilling(getBillingState(), { reason: 'refreshed:' + reason, activeOrgId: requestedOrgId || null });

    // Trial enforcement: if trial expired and not active, show upgrade notice
    try {
      const _bs = getBillingState();
      if (_bs.ok && !_bs.isActive && _bs.trialEndsAt) {
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
        refreshBilling({ force: true, reason: 'queued' }).catch(() => { });
      }, 0);
    }
    return getBillingState();
  } finally {
    if (requestedOrgId && _acquiredCrossTabLock) {
      _releaseBillingLock(requestedOrgId, reason);
    }
  }
}

/** @param {object} billingSnapshot – from getBillingState() */
function canUseProFeatures(billingSnapshot) {
  const s = billingSnapshot || getBillingState();
  return Boolean(s.ok && s.isPro && s.isActive);
}

/**
 * Single source of truth for Pro-only feature gates.
 * Returns billing + role state needed by all Pro-gated actions.
 * @param {object} [billingSnapshot] - from getBillingState(); defaults to current state.
 * @param {string} [userRole] - override; defaults to orgContext.role in module scope.
 * @returns {{
 *   isProActive: boolean,
 *   isTrial: boolean,
 *   isTrialExpired: boolean,
 *   isPaymentProblem: boolean,
 *   canUseProFeature: boolean,
 *   blockReason: string,
 *   uxMessage: string,
 *   isOwner: boolean
 * }}
 */
function getProRuleSet(billingSnapshot, userRole) {
  const s = billingSnapshot || getBillingState();
  const rawRole = String(userRole != null ? userRole : '').toLowerCase();
  const isOwner = rawRole === 'owner';

  const isTrial = Boolean(s.ok && s.isPro && s.isActive && s.status === 'trialing');
  const isTrialExpired = Boolean(s.ok && !s.isActive && s.status === 'trial_expired');
  const isPaymentProblem = Boolean(s.ok && s.paymentProblem);
  const isProActive = Boolean(s.ok && s.isPro && s.isActive && !isTrial);
  const canUseProFeature = Boolean(s.ok && s.isPro && s.isActive); // trial OR paid Pro

  let blockReason = '';
  let uxMessage = '';
  if (!s.ok) {
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
  } else if (!canUseProFeature) {
    blockReason = 'not_pro';
    // TODO: replace support@pxl360.com with the real support email later.
    uxMessage = isOwner
      ? 'This is a Pro feature. Upgrade to continue.'
      : 'Ask your owner to upgrade this workspace or contact support: support@pxl360.com';
  }

  return { isProActive, isTrial, isTrialExpired, isPaymentProblem, canUseProFeature, blockReason, uxMessage, isOwner };
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
  const monthlyPriceId = typeof window !== 'undefined' && window.__TP3D_STRIPE_PRICE_MONTHLY
    ? String(window.__TP3D_STRIPE_PRICE_MONTHLY).trim()
    : '';
  const yearlyPriceId = typeof window !== 'undefined' && window.__TP3D_STRIPE_PRICE_YEARLY
    ? String(window.__TP3D_STRIPE_PRICE_YEARLY).trim()
    : '';
  return {
    month: {
      interval: 'month',
      label: 'Pro (Monthly)',
      description: '$19.99/mo',
      priceId: monthlyPriceId,
      available: Boolean(monthlyPriceId),
    },
    year: {
      interval: 'year',
      label: 'Pro (Yearly)',
      description: '$199/yr',
      priceId: yearlyPriceId,
      available: Boolean(yearlyPriceId),
    },
  };
}

/**
 * Start Stripe Checkout for a given billing interval.
 * @param {string|{interval?:'month'|'year',priceId?:string,price_id?:string}} input
 * @returns {Promise<{ok:boolean, error:string|null}>}
 */
async function startCheckout(input) {
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
  if (!priceId) {
    const plans = getCheckoutPlanOptions();
    priceId = interval === 'year' ? plans.year.priceId : plans.month.priceId;
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
  billingDebugLog('portal:start', { activeOrgId: getActiveOrgIdForBilling() || null });
  const result = await Promise.race([
    createPortalSession(),
    new Promise(resolve => {
      setTimeout(() => resolve({ ok: false, url: null, error: 'Portal request timed out' }), BILLING_REQUEST_TIMEOUT_MS);
    }),
  ]);
  billingDebugLog('portal:result', { ok: Boolean(result && result.ok), error: result && result.error ? String(result.error) : null });
  if (result.ok && result.url) {
    window.location.href = result.url;
    return { ok: true, error: null };
  }
  return { ok: false, error: result.error || 'Portal session failed' };
}

// Expose for settings overlay and dev console
try {
  window.__TP3D_BILLING = {
    getBillingState,
    subscribeBilling,
    refreshBilling,
    clearBillingState,
    canUseProFeatures,
    getProRuleSet,
    getCheckoutPlanOptions,
    startCheckout,
    openPortal,
    selfTest: () => {
      if (!isTp3dDebugEnabled()) {
        return { ok: false, error: 'Enable tp3dDebug=1 to use billing self-test.' };
      }
      const snapshot = getBillingState();
      const activeOrganizationId = getActiveOrgIdForBilling() || null;
      const proAllowed = canUseProFeatures(snapshot);
      const payload = { ok: true, activeOrganizationId, billingSnapshot: snapshot, proAllowed };
      console.info('[Billing][SelfTest]', payload);
      return payload;
    },
  };
} catch (_) { /* ignore */ }

// tp3dDebug-only: expose getBillingState on window for console diagnostics
try {
  if (isTp3dDebugEnabled()) {
    window['getBillingState'] = () => (window.__TP3D_BILLING && typeof window.__TP3D_BILLING.getBillingState === 'function')
      ? window.__TP3D_BILLING.getBillingState()
      : null;
  }
} catch (_) { /* ignore */ }

const TP3D_BUILD_STAMP = Object.freeze({
  gitCommitShort: '52aa4de',
  buildTimeISO: '2026-02-18T03:32:00Z',
});

(async function () {
  try {
    if (window.__TP3D_BOOT && window.__TP3D_BOOT.threeReady) {
      await window.__TP3D_BOOT.threeReady;
    }
  } catch (_) {
    // Ignore boot errors
  }

  const UIComponents = createUIComponents();
  try { window.__TP3D_UI = UIComponents; } catch (_) { /* ignore */ }
  const SystemOverlay = createSystemOverlay();

  // ============================================================================
  // SECTION: APP BOOTSTRAP ENTRY
  // ============================================================================
  console.info('[TruckPackerApp] threeReady resolved, bootstrapping app');
  try {
    const debugBuild =
      typeof window !== 'undefined' &&
      window.localStorage &&
      window.localStorage.getItem('tp3dDebug') === '1';
    if (debugBuild && !window.__TP3D_BUILD_STAMP_LOGGED__) {
      window.__TP3D_BUILD_STAMP_LOGGED__ = true;
      console.info('[TP3D BUILD]', TP3D_BUILD_STAMP);
    }
  } catch (_) {
    // ignore
  }

  window.TruckPackerApp = (function () {
    'use strict';

    const featureFlags = { trailerPresetsEnabled: true };
    let AccountSwitcher = null;
    let CasesUI = null;
    let PacksUI = null;
    let SceneManager = null;
    let ExportService = null;
    let shortcuts = {};
    let bootstrapAuthGate = null;

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
    // SECTION: DEBUG GLOBALS (opt-in via localStorage.tp3dDebug = "1")
    // ============================================================================

    (function installWrapperDetective() {
      let enabled = false;
      try {
        enabled = Boolean(window && window.localStorage && window.localStorage.getItem('tp3dDebug') === '1');
      } catch {
        enabled = false;
      }
      if (!enabled) return;

      // Avoid re-installing
      if (
        globalThis.__TP3D_WRAPPER_DETECTIVE__ &&
        typeof globalThis.__TP3D_WRAPPER_DETECTIVE__.getWrapperUsage === 'function'
      ) {
        return;
      }

      function safeFnInfo(fn) {
        if (typeof fn !== 'function') return null;
        const name = fn.name || '(anonymous)';
        const src = Function.prototype.toString.call(fn);
        return {
          name,
          length: fn.length,
          // Keep this short to avoid dumping large source into the console
          snippet: String(src).slice(0, 180),
          looksWrapped:
            String(src).includes('getSessionRawSingleFlight') ||
            String(src).includes('getUserRawSingleFlight') ||
            String(src).includes('signOut(options') ||
            String(src).includes('getSession timeout') ||
            String(src).includes('[SupabaseClient]'),
        };
      }

      function getSupabaseClient() {
        try {
          if (globalThis.__TP3D_SUPABASE_CLIENT) return globalThis.__TP3D_SUPABASE_CLIENT;
        } catch {
          // ignore
        }
        try {
          if (SupabaseClient && typeof SupabaseClient.getClient === 'function') return SupabaseClient.getClient();
        } catch {
          // ignore
        }
        return null;
      }

      globalThis.__TP3D_WRAPPER_DETECTIVE__ = {
        getWrapperUsage() {
          const client = getSupabaseClient();
          const auth = client && client.auth ? client.auth : null;

          const out = {
            hasClient: Boolean(client),
            hasAuth: Boolean(auth),
            authWrappedFlag: Boolean(client && client.__tp3dAuthWrapped),
            clientKeys: client ? Object.keys(client).slice(0, 30) : [],
            authKeys: auth ? Object.keys(auth).slice(0, 30) : [],
            getSession: auth ? safeFnInfo(auth.getSession) : null,
            getUser: auth ? safeFnInfo(auth.getUser) : null,
            signOut: auth ? safeFnInfo(auth.signOut) : null,
            signInWithPassword: auth ? safeFnInfo(auth.signInWithPassword) : null,
          };

          try {
            console.groupCollapsed('[TP3D] Wrapper detective');
            console.log(out);
            console.groupEnd();
          } catch {
            // ignore
          }

          return out;
        },

        // Quick health check for auth wrapper wiring
        async smokeTest({ timeoutMs = 2500 } = {}) {
          const client = getSupabaseClient();
          if (!client || !client.auth) return { ok: false, reason: 'no-client' };

          const startedAt = Date.now();
          const withTimeout = (p, ms) =>
            Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

          try {
            const r1 = await withTimeout(client.auth.getSession(), timeoutMs);
            const r2 = await withTimeout(client.auth.getUser(), timeoutMs);
            return {
              ok: true,
              ms: Date.now() - startedAt,
              hasSession: Boolean(r1 && r1.data && r1.data.session),
              hasUser: Boolean(r2 && r2.data && r2.data.user),
            };
          } catch (err) {
            return { ok: false, ms: Date.now() - startedAt, error: String(err && err.message ? err.message : err) };
          }
        },
      };

      try {
        console.info('[TP3D] __TP3D_WRAPPER_DETECTIVE__ installed (tp3dDebug=1)');
      } catch {
        // ignore
      }
    })();

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
      getSceneManager: () => SceneManager,
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
      UIComponents,
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

    let logoutActionPromise = null;
    let logoutInProgress = false;
    let logoutStartedAt = 0;
    let logoutFallbackTimer = null;
    const LOGOUT_FALLBACK_RELOAD_DELAY_MS = 2200;
    let applyPostLogoutLocalStateReset = () => {
      SessionManager.clear();
      StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
    };

    function isLogoutInProgress() {
      return logoutInProgress;
    }

    function setLogoutInProgress(next, { source = 'unknown', reason = '' } = {}) {
      const active = Boolean(next);
      if (logoutInProgress === active) return;
      logoutInProgress = active;
      logoutStartedAt = active ? Date.now() : 0;
      if (!active && logoutFallbackTimer) {
        clearTimeout(logoutFallbackTimer);
        logoutFallbackTimer = null;
      }
      if (isTp3dDebugEnabled()) {
        console.info('[authLogout] latch', { active, source, reason, startedAt: logoutStartedAt || null });
      }
    }

    function scheduleLogoutFallbackReload(source = 'logout') {
      if (logoutFallbackTimer) {
        clearTimeout(logoutFallbackTimer);
        logoutFallbackTimer = null;
      }
      logoutFallbackTimer = setTimeout(() => {
        logoutFallbackTimer = null;
        let hasSession = false;
        try {
          const authState =
            SupabaseClient && typeof SupabaseClient.getAuthState === 'function' ? SupabaseClient.getAuthState() : null;
          const session = authState && authState.session ? authState.session : null;
          hasSession = Boolean(session && session.access_token);
        } catch {
          hasSession = false;
        }
        let signedOutUi = false;
        try {
          const bodySignedOut = document.body && document.body.getAttribute('data-auth') === 'signed_out';
          const overlayOpen =
            Boolean(AuthOverlay && typeof AuthOverlay.isOpen === 'function' && AuthOverlay.isOpen());
          signedOutUi = Boolean(bodySignedOut && overlayOpen);
        } catch {
          signedOutUi = false;
        }
        if (isTp3dDebugEnabled()) {
          console.info('[authLogout] fallback-check', {
            source,
            hasSession,
            signedOutUi,
            logoutInProgress,
          });
        }
        if (!hasSession && !signedOutUi) {
          if (isTp3dDebugEnabled()) console.info('[authLogout] fallback-reload', { source });
          try { window.location.reload(); } catch (_) { /* ignore */ }
          return;
        }
        if (!hasSession && signedOutUi) {
          setLogoutInProgress(false, { source, reason: 'stable-signed-out-ui' });
        }
      }, LOGOUT_FALLBACK_RELOAD_DELAY_MS);
    }

    async function performUserInitiatedLogout({ source = 'logout' } = {}) {
      if (logoutActionPromise) return logoutActionPromise;
      logoutActionPromise = (async () => {
        setLogoutInProgress(true, { source, reason: 'start' });
        try {
          UIComponents.closeAllDropdowns();
          SettingsOverlay.close();
          AccountOverlay.close();
        } catch {
          // ignore
        }

        let usedSupabaseSignOut = false;
        try {
          if (SupabaseClient && typeof SupabaseClient.signOut === 'function') {
            usedSupabaseSignOut = true;
            if (SupabaseClient.setAuthIntent) SupabaseClient.setAuthIntent('signOut');
            const result = await SupabaseClient.signOut({ global: true, allowOffline: true, userInitiated: true });
            if (isTp3dDebugEnabled()) {
              console.info('[authLogout] signOut:completed', {
                source,
                ok: Boolean(result && result.ok),
                offline: Boolean(result && result.offline),
              });
            }
          }
        } catch (err) {
          if (isTp3dDebugEnabled()) {
            console.info('[authLogout] signOut:error', {
              source,
              message: err && err.message ? String(err.message) : String(err),
            });
          }
        }

        applyPostLogoutLocalStateReset();

        if (usedSupabaseSignOut) {
          scheduleLogoutFallbackReload(source);
          return;
        }

        setLogoutInProgress(false, { source, reason: 'local-fallback' });
        UIComponents.showToast('Logged out', 'info');
      })().finally(() => {
        logoutActionPromise = null;
      });
      return logoutActionPromise;
    }

    // Listen for auth signed-out events (including offline logout and cross-tab)
    window.addEventListener('tp3d:auth-signed-out', event => {
      const detail = /** @type {CustomEvent} */ (event).detail || {};
      const isCrossTab = detail.crossTab === true;

      if (window.localStorage && window.localStorage.getItem('tp3dDebug') === '1') {
        console.log('[TruckPackerApp] Auth signed out', {
          tab: SupabaseClient && typeof SupabaseClient.getTabId === 'function' ? SupabaseClient.getTabId() : null,
          crossTab: isCrossTab,
          source: detail.source,
          offline: detail.offline,
        });
      }

      if (isLogoutInProgress()) {
        setLogoutInProgress(false, { source: 'tp3d:auth-signed-out', reason: 'event' });
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

    function openSettingsOverlay(tab) {
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
      requestAuthRefresh('settings-open');
    }

    function _openAccountOverlay() {
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
      requestAuthRefresh('account-open');
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
    AccountSwitcher = (() => {
      let anchorKeyCounter = 0;
      const mounts = new Map();

      function getDisplay() {
        const view = getSidebarAvatarView();
        const isAuthed = Boolean(view && view.isAuthed);
        const displayName = (view && view.displayName) || (isAuthed ? 'User' : 'Guest');
        const activeOrg = orgContext && orgContext.activeOrg ? orgContext.activeOrg : null;
        // Show 'Loading…' instead of generic 'Workspace' when user is authed
        // but org context hasn't arrived yet (cross-tab boot gap).
        // eslint-disable-next-line no-use-before-define -- vars declared later in module scope
        const orgHydrating = Boolean(isAuthed && !activeOrg && (orgContextInFlight || authRehydratePromise));
        const accountName = activeOrg && activeOrg.name ? activeOrg.name : (orgHydrating ? 'Loading\u2026' : 'Workspace');
        const role =
          (orgContext && orgContext.role ? String(orgContext.role) : null) ||
          (activeOrg && activeOrg.role ? String(activeOrg.role) : null) ||
          (isAuthed ? 'Owner' : 'Guest');

        return {
          accountName,
          role,
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
        const orgNameEl = buttonEl.querySelector('[data-org-name]');
        if (orgNameEl) orgNameEl.textContent = display.accountName;
        renderSidebarBrandMarks();
      }

      function _showComingSoon() {
        UIComponents.showToast('Coming soon', 'info');
      }

      async function createWorkspacePrompt() {
        const name = window.prompt('Workspace name:');
        if (!name || !name.trim()) return;
        try {
          UIComponents.showToast('Creating workspace\u2026', 'info');
          const { org, membership } = await SupabaseClient.createOrganization({ name: name.trim() });
          if (SupabaseClient.invalidateAccountCache) SupabaseClient.invalidateAccountCache();
          UIComponents.showToast('Workspace "' + (org.name || name.trim()) + '" created!', 'success');
          // Refresh org context to reflect new workspace
          orgContext = {
            activeOrgId: org.id,
            activeOrg: { ...org, role: membership.role },
            orgs: orgContext && orgContext.orgs ? [...orgContext.orgs, { ...org, role: membership.role }] : [{ ...org, role: membership.role }],
            role: membership.role,
            updatedAt: Date.now(),
          };
          renderButton(document.getElementById('btn-account-switcher'));
        } catch (err) {
          UIComponents.showToast('Failed: ' + (err && err.message ? err.message : err), 'error');
        }
      }

      async function logout() {
        await performUserInitiatedLogout({ source: 'account-switcher' });
      }

      function getAnchorKey(anchorEl) {
        if (!anchorEl) return '';
        if (!anchorEl.dataset.accountSwitcherKey) {
          anchorEl.dataset.accountSwitcherKey = `account-switcher-${++anchorKeyCounter}`;
        }
        return anchorEl.dataset.accountSwitcherKey;
      }

      /**
       * @param {HTMLElement} anchorEl
       * @param {{ align?: string }} [opts]
       */
      function openMenu(anchorEl, { align } = {}) {
        const display = getDisplay();
        const anchorKey = getAnchorKey(anchorEl);
        const existingDropdown = /** @type {HTMLElement|null} */ (
          document.querySelector('[data-dropdown="1"][data-role="account-switcher"]')
        );
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
            label: 'New Workspace',
            icon: 'fa-solid fa-plus',
            onClick: () => createWorkspacePrompt(),
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
            onClick: () => openSettingsOverlay(),
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

      /**
       * @param {HTMLElement} buttonEl
       * @param {{ align?: string }} [opts]
       */
      function bind(buttonEl, { align } = {}) {
        if (!buttonEl) return () => { };
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

      function refreshAll() {
        mounts.forEach((_, buttonEl) => {
          renderButton(buttonEl);
        });
      }

      return { init: initAccountSwitcher, bind, refresh: refreshAll };
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
        const EPS = 0.01; // small tolerance for floating point
        for (const z of zones || []) {
          if (
            aabb.min.x >= z.min.x - EPS &&
            aabb.max.x <= z.max.x + EPS &&
            aabb.min.y >= z.min.y - EPS &&
            aabb.max.y <= z.max.y + EPS &&
            aabb.min.z >= z.min.z - EPS &&
            aabb.max.z <= z.max.z + EPS
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
    SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore });

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

      // ── Helpers ──────────────────────────────────────────────────────────

      function cancelAllTweens() {
        const T = window.TWEEN || null;
        if (T && typeof T.removeAll === 'function') { T.removeAll(); }
      }

      function stageInstant(stagingMap) {
        for (const [id, pos] of stagingMap.entries()) {
          const obj = CaseScene.getObject(id);
          if (!obj) { continue; }
          const t = SceneManager.vecInchesToWorld(pos);
          obj.position.set(t.x, t.y, t.z);
        }
      }

      /**
       * Build valid orientations for an item.
       * Each orientation = { l (X-depth), w (Z-width), h (Y-height), rotY }.
       *
       * PHYSICS: only Y-axis rotation is used.  BoxGeometry is (L,H,W), a
       * Y-rotation of 90° visually swaps L↔W while H stays vertical.
       * canFlip allows the original height to become depth or width.
       */
      function buildOrientations(dims, caseData) {
        const lock = (caseData.orientationLock || 'any').toLowerCase();
        const canFlip = Boolean(caseData.canFlip);
        const L = dims.length, W = dims.width, H = dims.height;
        const PI2 = Math.PI / 2;
        const seen = new Set();
        const oris = [];

        function tryOri(l, w, h, ry) {
          const key = `${l}|${w}|${h}`;
          if (!seen.has(key)) {
            seen.add(key);
            oris.push({ l, w, h, rotY: ry });
          }
        }

        if (lock === 'upright' || lock === 'any') {
          tryOri(L, W, H, 0);
          tryOri(W, L, H, PI2);
        }

        if (lock === 'onside') {
          tryOri(H, W, L, 0);
          tryOri(W, H, L, PI2);
        }

        if (canFlip && lock !== 'onside') {
          tryOri(H, W, L, 0);
          tryOri(W, H, L, PI2);
          tryOri(L, H, W, 0);
          tryOri(H, L, W, PI2);
        }

        return oris;
      }

      // ── Core: gravity-based free-space packing ──────────────────────────

      /**
       * Gravity: find the Y where a box rests, supported by floor (y=0) or
       * the top of a packed box BELOW the candidate.  Only considers boxes
       * whose top is at or below the candidate bottom (prevents "resting"
       * on boxes that are beside or above).
       */
      function findRestingY(cx, cz, halfL, halfW, packed) {
        const EPS = 0.01;
        const bMinX = cx - halfL;
        const bMaxX = cx + halfL;
        const bMinZ = cz - halfW;
        const bMaxZ = cz + halfW;

        let floor = 0;
        for (const p of packed) {
          const pHL = p.dims.l / 2;
          const pHW = p.dims.w / 2;
          if (bMinX < p.pos.x + pHL - EPS && bMaxX > p.pos.x - pHL + EPS &&
            bMinZ < p.pos.z + pHW - EPS && bMaxZ > p.pos.z - pHW + EPS) {
            const top = p.pos.y + p.dims.h / 2;
            if (top > floor) { floor = top; }
          }
        }
        return floor;
      }

      /**
       * Check AABB collision against all packed items.
       */
      function collides(pos, dims, packed) {
        const EPS = 0.001;
        const aMin = { x: pos.x - dims.l / 2, y: pos.y - dims.h / 2, z: pos.z - dims.w / 2 };
        const aMax = { x: pos.x + dims.l / 2, y: pos.y + dims.h / 2, z: pos.z + dims.w / 2 };
        for (const p of packed) {
          const bMin = { x: p.pos.x - p.dims.l / 2, y: p.pos.y - p.dims.h / 2, z: p.pos.z - p.dims.w / 2 };
          const bMax = { x: p.pos.x + p.dims.l / 2, y: p.pos.y + p.dims.h / 2, z: p.pos.z + p.dims.w / 2 };
          if (aMin.x < bMax.x - EPS && aMax.x > bMin.x + EPS &&
            aMin.y < bMax.y - EPS && aMax.y > bMin.y + EPS &&
            aMin.z < bMax.z - EPS && aMax.z > bMin.z + EPS) {
            return true;
          }
        }
        return false;
      }

      /**
       * Try placing one item at a specific (x, z) with gravity, checking
       * zone containment and collision.  Returns placement info or null.
       */
      function tryPlace(cx, cz, ori, truckH, zones, packed) {
        const halfL = ori.l / 2;
        const halfW = ori.w / 2;
        const restY = findRestingY(cx, cz, halfL, halfW, packed);
        const cy = restY + ori.h / 2;

        // Fits under ceiling?
        if (cy + ori.h / 2 > truckH + 0.01) { return null; }

        // Zone containment
        const aabb = {
          min: { x: cx - halfL, y: cy - ori.h / 2, z: cz - halfW },
          max: { x: cx + halfL, y: cy + ori.h / 2, z: cz + halfW },
        };
        if (!TrailerGeometry.isAabbContainedInAnyZone(aabb, zones)) { return null; }

        // Collision
        const dims = { l: ori.l, w: ori.w, h: ori.h };
        const pos = { x: cx, y: cy, z: cz };
        if (collides(pos, dims, packed)) { return null; }

        return { pos, dims, restY };
      }

      // ── Main packing algorithm ──────────────────────────────────────────
      //
      // Strategy: Greedy placement with position scanning.
      //
      // For each remaining item (largest-volume first), scan a grid of
      // candidate (x, z) positions across the usable zones.  At each
      // position, gravity drops the box to its resting Y.  Pick the
      // placement that scores best (lowest Y, tightest fit, best zone
      // utilisation).
      //
      // This is fundamentally different from the old wall-building approach:
      // - No wall slabs — items can be placed at ANY valid x position
      // - No single-x pinning — smaller items fill gaps behind larger ones
      // - Full floor-to-ceiling stacking via gravity on every placement
      // - Respects all trailer shape modes (rect, wheelWells, frontBonus)
      //

      async function pack() {
        if (isRunning) { return; }

        // Billing gate: AutoPack requires active Pro subscription
        try {
          const _bs = window.__TP3D_BILLING && typeof window.__TP3D_BILLING.getBillingState === 'function'
            ? window.__TP3D_BILLING.getBillingState() : null;
          if (_bs && _bs.ok) {
            // If org role is still inflight, defer with a neutral message instead of wrong owner/non-owner CTA
            const _autopackOrgId = String((_bs && _bs.orgId) || '').trim();
            const _autopackHydration = _autopackOrgId ? _getOrgRoleHydrationStateAccessor(_autopackOrgId) : 'unknown';
            if (_autopackHydration === 'inflight') {
              UIComponents.showToast('Loading billing\u2026 please try again in a moment.', 'info', { title: 'AutoPack' });
              return;
            }
            const _rules = getProRuleSet(_bs, window.OrgContext && typeof window.OrgContext.getActiveRole === 'function' ? window.OrgContext.getActiveRole() : null);
            if (!_rules.canUseProFeature) {
              UIComponents.showToast(_rules.uxMessage, 'info', { title: 'AutoPack' });
              if (_rules.isOwner && (_rules.blockReason === 'trial_expired' || _rules.blockReason === 'payment_failed')) {
                try { openSettingsOverlay('billing'); } catch (_) { /* ignore */ }
              }
              return;
            }
          }
        } catch (_) { /* billing gate must never break AutoPack flow */ }

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
        cancelAllTweens();

        const diag =
          (typeof window !== 'undefined' &&
            window.__TP3D_DIAG__ &&
            typeof window.__TP3D_DIAG__.isActive === 'function' &&
            window.__TP3D_DIAG__.isActive())
            ? window.__TP3D_DIAG__
            : null;

        try {
          toast('AutoPack starting...', 'info', { title: 'AutoPack', duration: 1800 });

          const truck = packData.truck;
          const mode = (truck && truck.shapeMode) ? truck.shapeMode : 'rect';
          const truckL = truck.length || 636;
          const truckW = truck.width || 102;
          const truckH = truck.height || 110;
          const zones = TrailerGeometry.getTrailerUsableZones(truck);

          // For frontBonus, pack front-to-rear (high X first)
          // For everything else, pack rear-to-front (low X first)
          const loadFrontFirst = mode === 'frontBonus';

          // Build item list sorted by volume descending (FFD)
          const packItems = (packData.cases || [])
            .filter(inst => !inst.hidden)
            .map(inst => {
              const c = CaseLibrary.getById(inst.caseId);
              if (!c) { return null; }
              const d = c.dimensions || { length: 0, width: 0, height: 0 };
              const shape = (c.shape || 'box').toLowerCase();
              let vol;
              if (shape === 'cylinder' || shape === 'drum') {
                const r = Math.min(d.width, d.height) / 2;
                vol = Math.PI * r * r * d.length;
              } else {
                vol = c.volume || Utils.volumeInCubicInches(d);
              }
              // Pre-compute orientations once per item
              const orientations = buildOrientations(d, c);
              return { inst, caseData: c, volume: vol, orientations };
            })
            .filter(Boolean)
            .sort((a, b) => b.volume - a.volume);

          // Stage all items outside the truck instantly
          const stagingMap = buildStagingMap(packItems, truck);
          stageInstant(stagingMap);

          // ── Build candidate X positions from zone boundaries ──
          // Scan a set of X positions derived from zone edges + a regular
          // grid.  This ensures items can be placed anywhere inside the
          // truck, not just at wall-slab boundaries.
          const xSet = new Set();
          for (const z of zones) {
            xSet.add(z.min.x);
            xSet.add(z.max.x);
          }
          // Add a regular grid along X for fine placement
          const xStep = Math.max(2, Math.min(12, truckL / 60));
          for (let x = 0; x <= truckL; x += xStep) { xSet.add(x); }
          const xPositions = Array.from(xSet).filter(x => x >= 0 && x <= truckL);
          // Sort: front-first → descending, else ascending
          xPositions.sort((a, b) => loadFrontFirst ? b - a : a - b);

          // ── Build candidate Z positions from zone boundaries + grid ──
          const zSet = new Set();
          for (const z of zones) {
            zSet.add(z.min.z);
            zSet.add(z.max.z);
          }
          const zStep = Math.max(2, Math.min(12, truckW / 20));
          for (let z = -truckW / 2; z <= truckW / 2; z += zStep) { zSet.add(z); }
          const zPositions = Array.from(zSet).sort((a, b) => a - b);

          try {
            if (diag && typeof diag.autopackStart === 'function') {
              diag.autopackStart({
                packId,
                mode,
                loadFrontFirst,
                truck: { length: truckL, width: truckW, height: truckH },
                zones: zones && zones.length ? zones.length : 0,
                xStep,
                zStep,
                items: (packData.cases || []).filter(i => !i.hidden).length,
              });
            }
          } catch {
            // ignore
          }

          // ── Greedy placement loop ──
          const remaining = [...packItems];
          const packed = []; // { pos:{x,y,z}, dims:{l,w,h}, instanceId }
          const placements = new Map(); // instanceId → {x,y,z}
          const rotations = new Map();  // instanceId → {x,y,z}

          // Also collect X anchors from packed items (edges of placed boxes)
          // so subsequent items can nestle tightly against already-placed ones.
          const packedXEdges = new Set();

          // Prevent runaway loops without prematurely stopping as `remaining.length` shrinks.
          const maxIterations = Math.max(1, packItems.length * 2);

          // Scoring weights (inches-based). Lower gravity weight encourages stacking.
          const GRAVITY_WEIGHT = 15;
          const X_TIGHTNESS_WEIGHT = 10;
          const STACKING_BONUS = 1200;

          function capXAnchorsSorted(arr, maxCount) {
            // X anchors are already sorted toward the loading end. Sampling evenly can
            // drop the exact packed edges we need for flush placement, causing gaps.
            if (!Array.isArray(arr) || arr.length <= maxCount) return arr;
            return arr.slice(0, maxCount);
          }

          function capZAnchorsSorted(arr, maxCount) {
            // Z anchors must include both walls AND the center area.
            // Keeping only extremes causes "two-wall" packing with a big center gap.
            if (!Array.isArray(arr) || arr.length <= maxCount) return arr;

            const headCount = Math.max(1, Math.floor(maxCount * 0.35));
            const midCount = Math.max(1, Math.floor(maxCount * 0.30));
            const tailCount = Math.max(1, maxCount - headCount - midCount);

            const head = arr.slice(0, headCount);
            const tail = arr.slice(Math.max(headCount, arr.length - tailCount));

            // Find index closest to Z=0 and take a window around it.
            let bestIdx = 0;
            let bestAbs = Infinity;
            for (let i = 0; i < arr.length; i++) {
              const a = Math.abs(arr[i]);
              if (a < bestAbs) {
                bestAbs = a;
                bestIdx = i;
              }
            }
            const midStart = Math.max(0, Math.min(arr.length - midCount, bestIdx - Math.floor(midCount / 2)));
            const mid = arr.slice(midStart, midStart + midCount);

            const seen = new Set();
            const out = [];
            for (const v of [...head, ...mid, ...tail]) {
              const k = String(v);
              if (seen.has(k)) continue;
              seen.add(k);
              out.push(v);
            }
            return out;
          }

          let placementsSinceYield = 0;
          for (let sweep = 0; remaining.length > 0 && sweep < maxIterations; sweep++) {
            let placedAny = false;

            function computeLiveXFaces() {
              // IMPORTANT: include exact edges from placements made so far,
              // otherwise we quantize to xStep and create visible gaps.
              const set = new Set(xPositions);
              for (const p of packed) {
                set.add(p.pos.x - p.dims.l / 2);
                set.add(p.pos.x + p.dims.l / 2);
              }
              for (const e of packedXEdges) { set.add(e); }
              const arr = Array.from(set)
                .filter(x => x >= -0.01 && x <= truckL + 0.01)
                .sort((a, b) => loadFrontFirst ? b - a : a - b);
              return capXAnchorsSorted(arr, 120);
            }

            function computeLiveZFaces() {
              // IMPORTANT: include exact edges from placements made so far in this sweep,
              // otherwise we quantize to zStep and create visible gaps.
              const set = new Set(zPositions);
              for (const p of packed) {
                set.add(p.pos.z - p.dims.w / 2);
                set.add(p.pos.z + p.dims.w / 2);
              }
              const arr = Array.from(set)
                .filter(z => z >= -truckW / 2 - 0.01 && z <= truckW / 2 + 0.01)
                .sort((a, b) => a - b);
              return capZAnchorsSorted(arr, 220);
            }

            let liveX = computeLiveXFaces();
            let xi = 0;
            while (xi < liveX.length) {
              const xFace = liveX[xi];
              let liveZ = computeLiveZFaces();
              let zi = 0;
              let placedOnThisX = false;

              while (zi < liveZ.length) {
                const zFace = liveZ[zi];
                if (remaining.length === 0) break;

                const slotStats = {
                  sweep,
                  remaining: remaining.length,
                  packed: packed.length,
                  testedItems: 0,
                  testedOris: 0,
                  oobX: 0,
                  oobZ: 0,
                  triedPlace: 0,
                  okPlace: 0,
                };

                let chosenIndex = -1;
                let chosenOri = null;
                let chosenPos = null;
                let chosenDims = null;
                let chosenScore = -Infinity;
                let chosenRestY = null;

                // At this slot, pick the best-fitting remaining item.
                // Remaining is already sorted by volume (FFD).
                for (let i = 0; i < remaining.length; i++) {
                  const item = remaining[i];
                  slotStats.testedItems++;
                  let bestOri = null;
                  let bestPos = null;
                  let bestDims = null;
                  let bestScore = -Infinity;
                  let bestRestY = null;

                  for (const ori of item.orientations) {
                    slotStats.testedOris++;
                    const halfL = ori.l / 2;
                    const halfW = ori.w / 2;

                    const cx = loadFrontFirst ? xFace - halfL : xFace + halfL;
                    const cz = zFace + halfW; // fill left-to-right by aligning minZ

                    if (cx - halfL < -0.01 || cx + halfL > truckL + 0.01) {
                      slotStats.oobX++;
                      continue;
                    }
                    if (cz - halfW < -truckW / 2 - 0.01 || cz + halfW > truckW / 2 + 0.01) {
                      slotStats.oobZ++;
                      continue;
                    }

                    slotStats.triedPlace++;
                    const result = tryPlace(cx, cz, ori, truckH, zones, packed);
                    if (!result) continue;

                    slotStats.okPlace++;

                    // Prefer width-filling placements first, then stacking, then volume.
                    const zFill = ori.w;
                    const xDist = loadFrontFirst ? (truckL - cx) : cx;
                    const score =
                      zFill * 1000 +
                      (result.restY > 0.1 ? STACKING_BONUS : 0) +
                      -result.restY * GRAVITY_WEIGHT +
                      -xDist * X_TIGHTNESS_WEIGHT +
                      ori.l * ori.w * ori.h * 0.001 +
                      item.volume * 0.0001;

                    if (score > bestScore) {
                      bestScore = score;
                      bestOri = ori;
                      bestPos = result.pos;
                      bestDims = result.dims;
                      bestRestY = result.restY;
                    }
                  }

                  if (!bestPos) continue;

                  // Choose the best item for this slot.
                  if (bestScore > chosenScore) {
                    chosenScore = bestScore;
                    chosenIndex = i;
                    chosenOri = bestOri;
                    chosenPos = bestPos;
                    chosenDims = bestDims;
                    chosenRestY = bestRestY;

                    // If this is a very good fit, stop searching to keep perf stable.
                    if (chosenDims && chosenDims.w >= truckW * 0.95) break;
                  }
                }

                if (chosenIndex === -1) {
                  try {
                    if (diag && typeof diag.autopackSlot === 'function') {
                      diag.autopackSlot({
                        placed: false,
                        xFace,
                        zFace,
                        ...slotStats,
                      });
                    }
                  } catch {
                    // ignore
                  }
                  zi++;
                  continue;
                }

                const item = remaining[chosenIndex];
                placements.set(item.inst.id, chosenPos);
                rotations.set(item.inst.id, { x: 0, y: chosenOri.rotY, z: 0 });
                packed.push({ instanceId: item.inst.id, pos: chosenPos, dims: chosenDims });

                try {
                  if (diag && typeof diag.autopackSlot === 'function') {
                    diag.autopackSlot({
                      placed: true,
                      xFace,
                      zFace,
                      chosenScore,
                      chosenRestY,
                      chosen: {
                        instanceId: item.inst.id,
                        caseId: item.inst.caseId,
                        dims: chosenDims,
                        rotY: chosenOri && typeof chosenOri.rotY === 'number' ? chosenOri.rotY : null,
                        pos: chosenPos,
                      },
                      ...slotStats,
                    });
                  }
                  if (diag && typeof diag.autopackPlace === 'function') {
                    diag.autopackPlace({
                      sweep,
                      xFace,
                      zFace,
                      score: chosenScore,
                      restY: chosenRestY,
                      instanceId: item.inst.id,
                      caseId: item.inst.caseId,
                      dims: chosenDims,
                      pos: chosenPos,
                      rotY: chosenOri && typeof chosenOri.rotY === 'number' ? chosenOri.rotY : null,
                      remainingAfter: remaining.length - 1,
                      packedAfter: packed.length,
                    });
                  }
                } catch {
                  // ignore
                }

                packedXEdges.add(chosenPos.x - chosenDims.l / 2);
                packedXEdges.add(chosenPos.x + chosenDims.l / 2);

                remaining.splice(chosenIndex, 1);
                placedAny = true;
                placedOnThisX = true;

                placementsSinceYield++;
                if (placementsSinceYield % 4 === 0) {
                  // eslint-disable-next-line no-await-in-loop
                  await sleep(0);
                }

                // Recompute Z faces to include the new exact edge anchors, then restart
                // from the left wall for this same xFace.
                liveZ = computeLiveZFaces();
                zi = 0;
                continue;
              }

              if (remaining.length === 0) break;
              if (placedOnThisX) {
                liveX = computeLiveXFaces();
                xi = 0;
              } else {
                xi++;
              }
            }

            if (!placedAny) break;
          }

          const unpacked = remaining.map(item => item.inst.id);

          // Build oriented dims map for renderer halfWorld fix
          const orientedDimsMap = new Map();
          for (const p of packed) {
            orientedDimsMap.set(p.instanceId, {
              length: p.dims.l,
              width: p.dims.w,
              height: p.dims.h,
            });
          }

          // ── Animate to final positions ──
          cancelAllTweens();
          await animatePlacements(placements, rotations, orientedDimsMap);

          // Persist with position + rotation + orientedDims
          const nextCases = (packData.cases || []).map(inst => {
            if (inst.hidden) { return inst; }
            const pos = placements.get(inst.id) || stagingMap.get(inst.id);
            if (!pos) { return inst; }
            const rot = rotations.get(inst.id) || { x: 0, y: 0, z: 0 };
            const od = orientedDimsMap.get(inst.id) || null;
            const next = {
              ...inst,
              transform: {
                ...inst.transform,
                position: pos,
                rotation: rot,
              },
              hidden: false,
            };
            if (od) { next.orientedDims = od; }
            return next;
          });
          PackLibrary.update(packId, { cases: nextCases });

          // Stats + toast
          const stats = PackLibrary.computeStats(PackLibrary.getById(packId));
          const totalPackable = (packData.cases || []).filter(i => !i.hidden).length;
          UIComponents.showToast(
            `Packed ${stats.packedCases} of ${totalPackable} (${stats.volumePercent.toFixed(1)}%)`,
            stats.packedCases === totalPackable ? 'success' : 'warning',
            { title: 'AutoPack' }
          );
          if (unpacked.length) {
            UIComponents.showToast(
              `${unpacked.length} case(s) could not fit`, 'warning', { title: 'AutoPack' }
            );
          }

          try {
            if (diag && typeof diag.autopackEnd === 'function') {
              diag.autopackEnd({
                status: 'ok',
                packed: packed.length,
                unpacked: unpacked.length,
                packedCases: stats && typeof stats.packedCases === 'number' ? stats.packedCases : null,
                volumePercent: stats && typeof stats.volumePercent === 'number' ? stats.volumePercent : null,
              });
            }
          } catch {
            // ignore
          }

          window.setTimeout(() => {
            ExportService.capturePackPreview(packId, { source: 'auto' });
          }, 60);

        } catch (err) {
          console.error('[AutoPack] Error:', err);
          try {
            if (diag && typeof diag.autopackEnd === 'function') {
              diag.autopackEnd({ status: 'error', message: err && err.message ? String(err.message) : String(err) });
            }
          } catch {
            // ignore
          }
          toast('AutoPack failed', 'error', { title: 'AutoPack' });
        } finally {
          isRunning = false;
        }
      }

      // ── Staging ─────────────────────────────────────────────────────────

      function buildStagingMap(packItems, truck) {
        const gap = 4;
        const truckW = truck.width || 102;
        const truckL = truck.length || 636;
        const stageZStart = (truckW / 2) + 10;
        const map = new Map();
        let curX = 0;
        let curZ = stageZStart;
        let rowMaxWidth = 0;
        packItems.forEach((item) => {
          const dims = item.caseData.dimensions || { length: 24, width: 24, height: 24 };
          if (curX + dims.length > truckL && curX > 0) {
            curZ += rowMaxWidth + gap;
            curX = 0;
            rowMaxWidth = 0;
          }
          const y = Math.max(1, dims.height / 2);
          map.set(item.inst.id, { x: curX + dims.length / 2, y, z: curZ + dims.width / 2 });
          curX += dims.length + gap;
          rowMaxWidth = Math.max(rowMaxWidth, dims.width);
        });
        return map;
      }

      // ── Animation ───────────────────────────────────────────────────────

      async function animatePlacements(placements, rotations, orientedDimsMap) {
        cancelAllTweens();
        for (const [id, pos] of placements.entries()) {
          const obj = CaseScene.getObject(id);
          if (!obj) { continue; }

          const rot = rotations ? rotations.get(id) : null;
          if (rot) {
            obj.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
          }

          // Update halfWorld so renderer floor-clamp + drag + snap all use
          // correct oriented dimensions
          if (orientedDimsMap) {
            const od = orientedDimsMap.get(id);
            if (od) {
              obj.userData.halfWorld = {
                x: SceneManager.toWorld(od.length) / 2,
                y: SceneManager.toWorld(od.height) / 2,
                z: SceneManager.toWorld(od.width) / 2,
              };
            }
          }

          // eslint-disable-next-line no-await-in-loop
          await tweenInstanceToPosition(id, pos, 200);
          // eslint-disable-next-line no-await-in-loop
          await sleep(25);
        }
      }

      function tweenInstanceToPosition(instanceId, positionInches, duration) {
        const obj = CaseScene.getObject(instanceId);
        if (!obj) { return Promise.resolve(); }
        const target = SceneManager.vecInchesToWorld(positionInches);
        return new Promise(resolve => {
          const Tween = window.TWEEN || null;
          if (!Tween) {
            obj.position.set(target.x, target.y, target.z);
            resolve();
            return;
          }
          new Tween.Tween(obj.position)
            .to({ x: target.x, y: target.y, z: target.z }, duration)
            .easing(Tween.Easing.Cubic.InOut)
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
    ExportService = (() => {
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
        // Billing gate: PDF export requires active Pro subscription
        try {
          const _bs = window.__TP3D_BILLING && typeof window.__TP3D_BILLING.getBillingState === 'function'
            ? window.__TP3D_BILLING.getBillingState() : null;
          if (!_bs || !_bs.ok) {
            UIComponents.showToast('Billing unavailable. Please try again.', 'warning', { title: 'Export' });
            return;
          }
          const _rules = getProRuleSet(_bs, window.OrgContext && typeof window.OrgContext.getActiveRole === 'function' ? window.OrgContext.getActiveRole() : null);
          if (!_rules.canUseProFeature) {
            UIComponents.showToast(_rules.uxMessage, 'info', { title: 'Export' });
            if (_rules.isOwner && (_rules.blockReason === 'trial_expired' || _rules.blockReason === 'payment_failed')) {
              try { openSettingsOverlay('billing'); } catch (_) { /* ignore */ }
            }
            return;
          }
        } catch (_) { /* billing gate must never break PDF flow */ }

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
    PacksUI = createPacksScreen({
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
    CasesUI = createCasesScreen({
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
      function initUpdatesUI() { }
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
      function initRoadmapUI() { }
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
      const elLength = /** @type {HTMLSelectElement} */ (document.getElementById('pref-length'));
      const elWeight = /** @type {HTMLSelectElement} */ (document.getElementById('pref-weight'));
      const elTheme = /** @type {HTMLSelectElement} */ (document.getElementById('pref-theme'));
      const elLabel = /** @type {HTMLInputElement} */ (document.getElementById('pref-label-size'));
      const elHidden = /** @type {HTMLInputElement} */ (document.getElementById('pref-hidden-opacity'));
      const elSnap = /** @type {HTMLSelectElement} */ (document.getElementById('pref-snapping-enabled'));
      const elGrid = /** @type {HTMLInputElement} */ (document.getElementById('pref-grid-size'));
      const elShot = /** @type {HTMLSelectElement} */ (document.getElementById('pref-shot-res'));
      const elPdfStats = /** @type {HTMLSelectElement} */ (document.getElementById('pref-pdf-stats'));
      const btnSave = /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-prefs'));
      const btnReset = /** @type {HTMLButtonElement} */ (document.getElementById('btn-reset-demo'));

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
        let modal = null;
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
              if (modal) modal.close();
            });
            content.appendChild(row);
          });
        }

        modal = UIComponents.showModal({
          title: 'Open Pack',
          content,
          actions: [{ label: 'Close', variant: 'primary' }],
        });
      }

      shortcuts = {
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
          AutoPackEngine.pack().catch(err => console.error('[KeyboardShortcut] AutoPack error:', err));
        },
        'ctrl+p': () => {
          if (!inEditor()) return;
          AutoPackEngine.pack().catch(err => console.error('[KeyboardShortcut] AutoPack error:', err));
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

    // P0.9 – Autosave pause guard.  Set to true while swapping storage scope
    // so the StateStore subscriber doesn't re-persist stale data.
    let suspendAutoSave = false;

    // P0.9 – Tracks whether we have loaded the scoped storage at least once
    // after auth identity was known.  Needed because seedIfEmpty() runs at
    // boot before auth resolves, using the 'anon' scope.
    let hasLoadedScopedState = false;

    applyPostLogoutLocalStateReset = () => {
      SessionManager.clear();
      // P0.9 – Don't wipe user-scoped storage (data should survive for next login).
      // Instead, pause autosave → reset in-memory state → set scope to anon.
      suspendAutoSave = true;
      try {
        resetAppStateToEmpty();
        Storage.setStorageScope('anon');
        hasLoadedScopedState = false;
      } finally {
        suspendAutoSave = false;
      }
      StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
    };

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

    /**
     * P0.9 – Reset in-memory state to a safe empty shape so autosave can't
     * re-persist stale (other-user) data.  Uses StateStore.replace so
     * subscribers fire a full re-render.
     */
    function resetAppStateToEmpty() {
      const emptyState = {
        currentScreen: 'packs',
        currentPackId: null,
        selectedInstanceIds: [],
        caseLibrary: [],
        packLibrary: [],
        preferences: Defaults.defaultPreferences,
      };
      StateStore.replace(emptyState, { skipHistory: true });
    }

    /**
     * P0.9 – Load the scoped localStorage into StateStore (or seed demo data
     * if no saved state exists for this scope).  Mirrors the logic in
     * seedIfEmpty but can be called at any time after scope changes.
     */
    function loadScopedStateOrSeed() {
      const stored = Storage.load();
      if (stored && stored.caseLibrary && stored.packLibrary && stored.preferences) {
        const storedCases = (stored.caseLibrary || []).map(applyCaseDefaultColor);
        StateStore.replace({
          currentScreen: 'packs',
          currentPackId: stored.currentPackId || null,
          selectedInstanceIds: [],
          caseLibrary: storedCases,
          packLibrary: stored.packLibrary,
          preferences: stored.preferences,
        }, { skipHistory: true });
      } else {
        // No saved data for this user – seed with demo data (same as initial boot).
        const cases = Defaults.seedCases();
        cases.forEach(c => { c.volume = Utils.volumeInCubicInches(c.dimensions); });
        const demoPack = Defaults.seedPack(cases);
        demoPack.stats = PackLibrary.computeStats(demoPack, cases);
        StateStore.replace({
          currentScreen: 'packs',
          currentPackId: demoPack.id,
          selectedInstanceIds: [],
          caseLibrary: cases,
          packLibrary: [demoPack],
          preferences: Defaults.defaultPreferences,
        }, { skipHistory: true });
        Storage.saveNow();
      }
    }

    // ============================================================================
    // SECTION: BOOT HELPERS (RUNTIME VALIDATION)
    // ============================================================================
    async function validateRuntime() {
      if (!Utils.hasWebGL()) {
        SystemOverlay.show({
          title: 'WebGL required',
          message: 'This app requires WebGL. Please update your browser or enable hardware acceleration.',
          items: ['Chrome/Edge: Settings → System → Use hardware acceleration', 'Safari: Update to Safari 14+'],
        });
        return false;
      }

      // Wait for vendor scripts (CDN → fallback CDN → local) to finish loading.
      // This handles slow/offline connections where fallback scripts need time.
      if (typeof window.__tp3dVendorAllReady === 'function') {
        try {
          await Promise.race([
            window.__tp3dVendorAllReady(),
            new Promise(r => setTimeout(r, 12000)), // 12s max wait
          ]);
        } catch {
          // continue — we'll check globals below
        }
      }

      // Log any CDN failures to console for developers
      const failures = window.__TP3D_BOOT && window.__TP3D_BOOT.cdnFailures ? window.__TP3D_BOOT.cdnFailures : [];
      if (failures.length) {
        console.warn('[TruckPackerApp] CDN failures:', failures.map(f => `${f.name} (${f.url})`).join(', '));
      }

      // Check if critical libraries are available
      const missing = [];
      if (!window.THREE) missing.push('3D rendering engine');
      if (!window.THREE || !window.THREE.OrbitControls) missing.push('Camera controls');
      if (!window.TWEEN) missing.push('Animation library');
      if (!window.XLSX) missing.push('Spreadsheet support');
      if (!window.jspdf) missing.push('PDF generation');

      if (missing.length) {
        // Log technical details to console
        console.error('[TruckPackerApp] Missing libraries:', missing);

        // Show user-friendly message — no technical jargon
        SystemOverlay.show({
          title: 'Unable to load',
          message: 'Some features could not be loaded. Please check your internet connection and try again.',
          items: [
            'Make sure you are connected to the internet',
            'Try refreshing the page',
            'If the problem persists, try a different browser',
          ],
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
    let authUiBound = false;
    let lastAuthUserId = null;
    let lastOrgChangeAt = 0;
    let lastOrgIdNotified = null;
    const ORG_CONTEXT_LS_KEY = 'tp3d:active-org-id';
    const ORG_CONTEXT_SYNC_KEY = 'tp3d:org-context-sync';
    const ORG_CONTEXT_DEDUP_MS = 500;
    const ORG_PERSIST_COOLDOWN_MS = 2000;
    const orgContextMetrics = {
      orgChangedEmitted: 0,
      orgChangedHandled: 0,
      orgChangedIgnoredSameId: 0,
      orgChangedIgnoredSignedOut: 0,
      orgChangedQueuedWhileHidden: 0,
    };
    let orgContext = {
      activeOrgId: null,
      activeOrg: null,
      orgs: [],
      role: null,
      updatedAt: 0,
    };
    let orgContextVersion = 0;
    let lastAppliedOrgContextVersion = 0;
    const orgContextTabId = (() => {
      try {
        const existing = window.sessionStorage.getItem('tp3d:org-context-tab-id');
        if (existing) return String(existing);
      } catch {
        // ignore
      }
      const generated = `orgtab_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
      try {
        window.sessionStorage.setItem('tp3d:org-context-tab-id', generated);
      } catch {
        // ignore
      }
      return generated;
    })();
    let lastOrgPersistAt = 0;
    let orgContextInFlight = null;
    let orgContextQueued = false;
    let _orgBundleFetchInflightForOrg = null;
    /** @type {Map<string, number>} orgId -> grace-until timestamp */
    const _orgRoleHydrationGraceUntilByOrg = new Map();
    const _ORG_ROLE_GRACE_MS = 1500;
    let lastAuthRehydrateAt = 0;
    const AUTH_REHYDRATE_COOLDOWN_MS = 750;
    const AUTH_REFRESH_DEBOUNCE_MS = 350;
    const AUTH_REFRESH_MAX_ATTEMPTS = 3;
    const AUTH_REFRESH_WINDOW_MS = 10000;
    const AUTH_REFRESH_AUTO_REASONS = new Set(['tab-visible', 'storage', 'org-changed']);
    const toastDeduper = new Map();
    let authRehydratePromise = null;
    let authRefreshTimer = null;
    let authRefreshInFlight = null;
    let authRefreshQueued = false;
    let authRefreshWindowStart = 0;
    let authRefreshAttempts = 0;
    let authMissingSessionShown = false;
    const authRefreshReasons = new Set();
    let authRefreshPending = {
      force: false,
      forceBundle: false,
      sessionHint: null,
    };
    // Used to prevent mixed-user UI when another tab signs in as a different user.
    const authReloadKey = 'tp3d:auth-user-switch-reload';
    // Latch used to temporarily hold a forced account-disabled message so
    // normal signed-out flows don't overwrite it while we show the disabled UI.
    let authBlockState = null;

    // P0.7 – Cache the last *real* auth event so we can fall back to it when
    // SupabaseClient.getAuthState() briefly returns status:'unknown' / hasToken:false
    // immediately after a genuine SIGNED_IN or TOKEN_REFRESHED event.
    let lastAuthEventSnapshot = null;
    const FALLBACK_AUTH_TTL_MS = 8000;

    // ── Auth Stability Gate ──────────────────────────────────────────────
    // Prevents transient INITIAL_SESSION(null) → SIGNED_OUT → SIGNED_IN boot
    // sequences from triggering org-clearing and "no-org" banner flashes.
    const AUTH_SIGNED_OUT_STABLE_MS = 2000;
    const _authGate = {
      lastSignedInAt: 0,
      signedOutCandidateAt: 0,
      signedOutTimer: /** @type {ReturnType<typeof setTimeout>|null} */ (null),
      settled: false,
    };
    // Settled dedupe: avoid repeated settled:set for the same status+user
    let _settledStatus = /** @type {string|null} */ (null);
    let _settledUserId = /** @type {string|null} */ (null);

    function authGateIsSettled() {
      return _authGate.settled;
    }

    /** Mark auth as settled + signed-in. Cancels any pending signed-out candidate. */
    function authGateSignedIn() {
      _authGate.lastSignedInAt = Date.now();
      if (_authGate.signedOutTimer) {
        clearTimeout(_authGate.signedOutTimer);
        _authGate.signedOutTimer = null;
        if (isTp3dDebugEnabled()) console.info('[authGate] signedOutCancelledBySignedIn');
      }
      if (_authGate.signedOutCandidateAt) {
        _authGate.signedOutCandidateAt = 0;
      }
      // Dedupe: skip if already settled with same status + user
      const nextUserId = getSignedInUserIdStrict();
      if (_authGate.settled && _settledStatus === 'signed_in' && _settledUserId === nextUserId) {
        if (isTp3dDebugEnabled()) console.info('[authGate] settled:dedupe', { source: 'signedIn', status: 'signed_in', userIdTail: nextUserId ? nextUserId.slice(-6) : null });
        return;
      }
      _authGate.settled = true;
      _settledStatus = 'signed_in';
      _settledUserId = nextUserId;
      if (isTp3dDebugEnabled()) console.info('[authGate] settled:set', { source: 'signedIn', status: 'signed_in', userIdTail: nextUserId ? nextUserId.slice(-6) : null });
    }

    /**
     * Start signed-out candidate timer. Only confirms signed-out after
     * AUTH_SIGNED_OUT_STABLE_MS with no intervening SIGNED_IN.
     * @param {() => void} onConfirmed — called when signed-out is stable
     */
    function authGateSignedOutCandidate(onConfirmed) {
      _authGate.signedOutCandidateAt = Date.now();
      if (_authGate.signedOutTimer) clearTimeout(_authGate.signedOutTimer);

      // During boot phase (never seen SIGNED_IN yet), ALWAYS wait the full FALLBACK_AUTH_TTL_MS.
      // Reason: when Supabase fires SIGNED_OUT it has already cleared its own localStorage tokens,
      // so checking for sb-*-auth-token or a cached org ID is unreliable — both can be absent even
      // when a valid SIGNED_IN is imminent via cross-tab broadcast (which can take 2–5 s on slow
      // connections). Using the short 2-second window during boot causes premature org-clearing and
      // the "Create or join a workspace" banner flash on the secondary tab.
      const isBootPhase = _authGate.lastSignedInAt === 0;
      // Keep hasSessionIndicators for logging / future use, but do not use it to shorten the timeout.
      let hasSessionIndicators = false;
      if (isBootPhase) {
        try {
          hasSessionIndicators = Boolean(readLocalOrgId());
          if (!hasSessionIndicators) {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
                hasSessionIndicators = true;
                break;
              }
            }
          }
        } catch { /* ignore */ }
      }
      // Boot phase: always 8s so cross-tab SIGNED_IN has time to arrive regardless of cache state.
      // Post-boot: 2s is enough — a real sign-out from a live session should be stable quickly.
      const timeoutMs = isBootPhase
        ? FALLBACK_AUTH_TTL_MS   // 8s during any boot phase (SIGNED_IN may come from cross-tab)
        : AUTH_SIGNED_OUT_STABLE_MS; // 2s for stable post-boot sign-out

      if (isTp3dDebugEnabled()) console.info('[authGate] signedOutCandidate', { isBootPhase, hasSessionIndicators, timeoutMs });
      _authGate.signedOutTimer = setTimeout(() => {
        _authGate.signedOutTimer = null;
        // Only confirm if no SIGNED_IN arrived in the interim
        if (_authGate.signedOutCandidateAt && !_authGate.lastSignedInAt) {
          if (_authGate.settled && _settledStatus === 'signed_out' && _settledUserId === null) {
            if (isTp3dDebugEnabled()) console.info('[authGate] settled:dedupe', { source: 'signedOutConfirmed', status: 'signed_out' });
            return;
          }
          _authGate.settled = true;
          _settledStatus = 'signed_out';
          _settledUserId = null;
          if (isTp3dDebugEnabled()) console.info('[authGate] settled:set', { source: 'signedOutConfirmed', status: 'signed_out', timeoutMs });
          onConfirmed();
        } else if (_authGate.lastSignedInAt > _authGate.signedOutCandidateAt) {
          if (isTp3dDebugEnabled()) console.info('[authGate] signedOutCancelledBySignedIn (timer)');
        } else {
          // Fallback: lastSignedInAt exists but is older than signedOutCandidateAt.
          // Guard: block if we have a recent signed-in signal (snapshot, gate, or wrapper).
          const _snapshotAgeMs = lastAuthEventSnapshot ? Date.now() - (lastAuthEventSnapshot.ts || 0) : Infinity;
          const _hasRecentSignedInSnapshot = Boolean(
            lastAuthEventSnapshot && lastAuthEventSnapshot.status === 'signed_in' && _snapshotAgeMs < FALLBACK_AUTH_TTL_MS
          );
          const _gateSignedInAgeMs = _authGate.lastSignedInAt ? Date.now() - _authGate.lastSignedInAt : Infinity;
          const _hasRecentGateSignedIn = _gateSignedInAgeMs < FALLBACK_AUTH_TTL_MS;
          const _logoutLatchActive = isLogoutInProgress();
          const _authTruth = (() => { try { return getAuthTruthSnapshot(); } catch { return null; } })();
          const _authWrapperStatus = _authTruth ? _authTruth.status : null;
          const _wrapperSignedIn = Boolean(_authTruth && _authTruth.isSignedIn);
          const _hasRecentSignedIn = _hasRecentSignedInSnapshot || _hasRecentGateSignedIn || _wrapperSignedIn;
          if (_hasRecentSignedIn && !_logoutLatchActive) {
            if (isTp3dDebugEnabled()) {
              console.info('[authGate] signedOutFallback:block', {
                hasRecentSignedInSnapshot: _hasRecentSignedInSnapshot,
                snapshotAgeMs: _snapshotAgeMs,
                gateSignedInAgeMs: _gateSignedInAgeMs,
                wrapperSignedIn: _wrapperSignedIn,
                hasSessionIndicators,
                authWrapperStatus: _authWrapperStatus,
                logoutLatchActive: _logoutLatchActive,
              });
            }
            return;
          }
          if (_authGate.settled && _settledStatus === 'signed_out' && _settledUserId === null) {
            if (isTp3dDebugEnabled()) console.info('[authGate] settled:dedupe', { source: 'signedOutConfirmedFallback', status: 'signed_out' });
            return;
          }
          _authGate.settled = true;
          _settledStatus = 'signed_out';
          _settledUserId = null;
          if (isTp3dDebugEnabled()) {
            console.info('[authGate] signedOutFallback:confirm', {
              hasRecentSignedInSnapshot: _hasRecentSignedInSnapshot,
              snapshotAgeMs: _snapshotAgeMs,
              gateSignedInAgeMs: _gateSignedInAgeMs,
              wrapperSignedIn: _wrapperSignedIn,
              hasSessionIndicators,
              authWrapperStatus: _authWrapperStatus,
              logoutLatchActive: _logoutLatchActive,
            });
            console.info('[authGate] settled:set', { source: 'signedOutConfirmedFallback', status: 'signed_out', timeoutMs });
          }
          onConfirmed();
        }
      }, timeoutMs);
    }

    /** INITIAL_SESSION with user===null: auth not settled yet. */
    function authGateInitialSession() {
      if (isTp3dDebugEnabled()) console.info('[authGate] initial-session');
      // Do NOT set settled — wait for SIGNED_IN or stable SIGNED_OUT.
    }
    // ── end Auth Stability Gate ──────────────────────────────────────────
    // Expose to module-level ensureWorkspaceReadyForUI
    _authGateIsSettledAccessor = authGateIsSettled;

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

    try {
      window.__TP3D_ORG_METRICS__ = orgContextMetrics;
    } catch {
      // ignore
    }

    function showReadyOnce() {
      if (readyToastShown) return;
      readyToastShown = true;
      UIComponents.showToast('Ready', 'success', { title: 'Truck Packer 3D' });
    }

    function canShowToast(key) {
      const now = Date.now();
      const last = toastDeduper.get(key) || 0;
      if (now - last < 2500) return false;
      toastDeduper.set(key, now);
      return true;
    }

    function canStartAuthRehydrate({ force = false } = {}) {
      if (force) {
        lastAuthRehydrateAt = Date.now();
        return true;
      }
      const now = Date.now();
      if (now - lastAuthRehydrateAt < AUTH_REHYDRATE_COOLDOWN_MS) return false;
      lastAuthRehydrateAt = now;
      return true;
    }

    function getOverlayOpen() {
      try {
        if (window.SettingsOverlay?.isOpen?.() === true) return true;
      } catch {
        // ignore
      }
      try {
        if (window.AccountOverlay?.isOpen?.() === true) return true;
      } catch {
        // ignore
      }
      try {
        if (window.SettingsOverlay?.state?.isOpen === true) return true;
      } catch {
        // ignore
      }
      try {
        if (window.AccountOverlay?.state?.isOpen === true) return true;
      } catch {
        // ignore
      }
      try {
        if (SettingsOverlay && typeof SettingsOverlay.isOpen === 'function') {
          return Boolean(SettingsOverlay.isOpen());
        }
      } catch {
        // ignore
      }
      try {
        if (AccountOverlay && typeof AccountOverlay.isOpen === 'function') {
          return Boolean(AccountOverlay.isOpen());
        }
      } catch {
        // ignore
      }
      try {
        return Boolean(document.querySelector('[data-tp3d-settings-modal="1"]'));
      } catch {
        return false;
      }
    }

    function getAuthTruthSnapshot() {
      const authState =
        SupabaseClient && typeof SupabaseClient.getAuthState === 'function' ? SupabaseClient.getAuthState() : null;
      const status = authState && authState.status ? authState.status : 'unknown';
      const session = authState && authState.session ? authState.session : null;
      const user = authState && authState.user ? authState.user : session && session.user ? session.user : null;
      const userId = user && user.id ? String(user.id) : null;
      const hasToken = Boolean(session && session.access_token);
      const isSignedIn = Boolean(status === 'signed_in' && hasToken && userId);
      return { status, userId, hasToken, session, user, isSignedIn };
    }

    function shouldUseSignedInHint() {
      if (isLogoutInProgress()) return false;
      if (!lastAuthEventSnapshot) return false;
      if (lastAuthEventSnapshot.status !== 'signed_in') return false;
      if (!lastAuthEventSnapshot.hasToken || !lastAuthEventSnapshot.session) return false;
      const age = Date.now() - (lastAuthEventSnapshot.ts || 0);
      return age < FALLBACK_AUTH_TTL_MS;
    }

    function getSignedInUserIdStrict() {
      const truth = getAuthTruthSnapshot();
      return truth && truth.isSignedIn && truth.userId ? String(truth.userId) : null;
    }

    _authTruthSnapshotAccessor = () => {
      const truth = getAuthTruthSnapshot();
      return {
        status: truth.status,
        userId: truth.userId,
        hasToken: truth.hasToken,
        isSignedIn: truth.isSignedIn,
      };
    };

    function getCurrentAuthSnapshot() {
      const truth = getAuthTruthSnapshot();
      let status = truth.status;
      let session = truth.session;
      let user = truth.user;
      let userId = truth.userId;
      let hasToken = truth.hasToken;
      let hintOnly = false;

      // P0.7 – If the wrapper reports unknown/no-token but we have a recent real
      // auth event, trust the event snapshot instead (transient race window).
      if ((status !== 'signed_in' || !hasToken) && shouldUseSignedInHint()) {
        if (lastAuthEventSnapshot && lastAuthEventSnapshot.session) {
          status = lastAuthEventSnapshot.status;
          session = lastAuthEventSnapshot.session;
          user = session && session.user ? session.user : null;
          userId = user && user.id ? String(user.id) : null;
          hasToken = true;
          hintOnly = true;
        }
      }

      return {
        status,
        userId,
        hasToken,
        session,
        authProof: Boolean(truth.isSignedIn),
        hintOnly,
        activeOrgId: orgContext.activeOrgId,
        activeOrg: orgContext.activeOrg,
        role: orgContext.role,
      };
    }

    function getActiveOrgId() {
      return orgContext.activeOrgId;
    }

    async function hydrateActiveOrgId() {
      return refreshOrgContext('org-hydrate', { force: true, forceEmit: true });
    }

    async function setActiveOrgId(nextOrgId, { source = 'org-switch' } = {}) {
      const nextId = nextOrgId ? String(nextOrgId).trim() : '';
      if (!nextId) return null;

      const truth = getAuthTruthSnapshot();
      if (!truth.isSignedIn) return null;

      const prevId = orgContext.activeOrgId ? String(orgContext.activeOrgId) : null;
      if (prevId && prevId === nextId) return prevId;

      const orgs = Array.isArray(orgContext.orgs) ? orgContext.orgs : [];
      const activeOrg = orgs.find(o => o && String(o.id) === nextId) || null;

      if (!activeOrg) {
        writeLocalOrgId(nextId);
        dispatchOrgContextChanged({
          orgId: nextId,
          reason: source,
          broadcast: true,
          source: 'set-active-org',
          userId: truth.userId,
        });
        await refreshOrgContext(source, { force: true, forceEmit: true });
        return nextId;
      }

      orgContext = {
        ...orgContext,
        activeOrgId: nextId,
        activeOrg,
        role: activeOrg.role || orgContext.role || null,
        updatedAt: Date.now(),
      };
      writeLocalOrgId(nextId);

      try {
        if (SupabaseClient && typeof SupabaseClient.updateProfile === 'function') {
          SupabaseClient.updateProfile({ current_organization_id: nextId }).catch(() => { });
        }
      } catch {
        // ignore
      }

      try {
        dispatchOrgContextChanged({
          orgId: nextId,
          reason: source,
          broadcast: true,
          source: 'set-active-org',
          userId: truth.userId,
        });
        orgContextMetrics.orgChangedEmitted += 1;
      } catch {
        // ignore
      }

      queueOrgScopedRender('org-set');
      return nextId;
    }

    const OrgContext = {
      getActiveOrgId,
      setActiveOrgId,
      hydrateActiveOrgId,
      getActiveRole: () => (orgContext && typeof orgContext.role === 'string' ? orgContext.role : ''),
    };

    try {
      window.OrgContext = OrgContext;
    } catch {
      // ignore
    }

    function readLocalOrgId() {
      try {
        const raw = window.localStorage.getItem(ORG_CONTEXT_LS_KEY);
        return raw ? String(raw) : null;
      } catch {
        return null;
      }
    }

    function writeLocalOrgId(orgId) {
      try {
        if (!orgId) {
          window.localStorage.removeItem(ORG_CONTEXT_LS_KEY);
          return;
        }
        window.localStorage.setItem(ORG_CONTEXT_LS_KEY, String(orgId));
      } catch {
        // ignore
      }
    }

    function parseOrgContextVersion(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.floor(n);
    }

    function nextOrgContextVersion() {
      orgContextVersion = parseOrgContextVersion(orgContextVersion) + 1;
      return orgContextVersion;
    }

    function markOrgContextVersion(version) {
      const parsed = parseOrgContextVersion(version);
      if (!parsed) return 0;
      orgContextVersion = Math.max(orgContextVersion, parsed);
      lastAppliedOrgContextVersion = Math.max(lastAppliedOrgContextVersion, parsed);
      return parsed;
    }

    /**
     * @param {{
     *   orgId?: string|null,
     *   reason?: string|null,
     *   version?: number,
     *   broadcast?: boolean,
     *   source?: string|null,
     *   ts?: number,
     *   userId?: string|null,
     * }} [options]
     * @returns {number}
     */
    function dispatchOrgContextChanged(options = {}) {
      const {
        orgId,
        reason = 'org-context',
        version = 0,
        broadcast = false,
        source = 'local',
        ts = Date.now(),
        userId = null,
      } = options || {};
      const nextOrgId = orgId ? String(orgId).trim() : '';
      if (!nextOrgId) return 0;
      const signedInUserId = userId || getSignedInUserIdStrict();
      if (!signedInUserId) return 0;
      const nextVersion = markOrgContextVersion(version || nextOrgContextVersion());
      const detail = {
        orgId: nextOrgId,
        reason: reason || null,
        userId: signedInUserId,
        ts: Number.isFinite(Number(ts)) ? Number(ts) : Date.now(),
        timestamp: Number.isFinite(Number(ts)) ? Number(ts) : Date.now(),
        epoch: nextVersion,
        tabId: orgContextTabId,
        source,
      };

      try {
        window.dispatchEvent(new CustomEvent('tp3d:org-changed', { detail }));
      } catch {
        // ignore
      }

      if (broadcast) {
        try {
          window.localStorage.setItem(ORG_CONTEXT_SYNC_KEY, JSON.stringify(detail));
          // Keep the key ephemeral so stale payloads are less likely to be replayed.
          window.setTimeout(() => {
            try {
              const raw = window.localStorage.getItem(ORG_CONTEXT_SYNC_KEY);
              if (!raw) return;
              const parsed = JSON.parse(raw);
              if (
                parsed &&
                parsed.tabId === orgContextTabId &&
                parseOrgContextVersion(parsed.epoch) === nextVersion
              ) {
                window.localStorage.removeItem(ORG_CONTEXT_SYNC_KEY);
              }
            } catch {
              // ignore
            }
          }, 1500);
        } catch {
          // ignore
        }
      }

      return nextVersion;
    }

    function parseOrgContextSyncPayload(raw) {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
      } catch {
        return null;
      }
    }

    function handleIncomingOrgContextSync(payload, { source = 'org-sync-storage' } = {}) {
      if (!payload || typeof payload !== 'object') return;
      const incomingOrgId = payload.orgId ? String(payload.orgId).trim() : '';
      if (!incomingOrgId || !ORG_UUID_RE.test(incomingOrgId)) return;

      const payloadUserId = payload.userId ? String(payload.userId) : '';
      const currentUserId = getSignedInUserIdStrict();
      if (!currentUserId || !payloadUserId || payloadUserId !== currentUserId) return;

      const incomingTabId = payload.tabId ? String(payload.tabId) : '';
      if (incomingTabId && incomingTabId === orgContextTabId) return;

      const incomingVersion = parseOrgContextVersion(payload.epoch || payload.version);
      if (!incomingVersion) return;
      if (incomingVersion <= lastAppliedOrgContextVersion) {
        if (isTp3dDebugEnabled()) {
          console.info('[orgContext] ignore-stale-sync', {
            source,
            incomingVersion,
            lastAppliedOrgContextVersion,
          });
        }
        return;
      }

      if (isTp3dDebugEnabled()) {
        console.info('[orgContext] sync-version', {
          source,
          incomingVersion,
          lastAppliedVersion: lastAppliedOrgContextVersion,
          applied: true,
          incomingOrgId,
          incomingUserId: payloadUserId,
        });
      }

      markOrgContextVersion(incomingVersion);
      writeLocalOrgId(incomingOrgId);

      const currentOrgId = orgContext.activeOrgId ? String(orgContext.activeOrgId) : null;
      if (!currentOrgId || currentOrgId !== incomingOrgId) {
        const knownOrgs = Array.isArray(orgContext.orgs) ? orgContext.orgs : [];
        const incomingOrg = knownOrgs.find(o => o && String(o.id) === incomingOrgId) || null;
        orgContext = {
          ...orgContext,
          activeOrgId: incomingOrgId,
          activeOrg: incomingOrg || null,
          role: incomingOrg && incomingOrg.role ? incomingOrg.role : orgContext.role,
          updatedAt: Date.now(),
        };
      }

      dispatchOrgContextChanged({
        orgId: incomingOrgId,
        reason: payload.reason || source,
        version: incomingVersion,
        broadcast: false,
        source,
        ts: payload.ts || payload.timestamp,
        userId: currentUserId,
      });

      applyOrgRequiredUi(true);
      queueOrgScopedRender(source);
      _orgRoleHydrationGraceUntilByOrg.set(incomingOrgId, Date.now() + _ORG_ROLE_GRACE_MS);
      // Set inflight flag ASAP so hydration checker sees it immediately
      _orgBundleFetchInflightForOrg = incomingOrgId;
      maybeScheduleBillingRefresh('org-changed');

      if (isLogoutInProgress() || !authGateIsSettled()) {
        orgContextQueued = true;
        return;
      }
      void refreshOrgContext(source, { force: true, forceEmit: false });
    }

    // ── getActiveOrgIdNow: best-effort sync orgId with fallbacks ──
    function getActiveOrgIdNow() {
      // 1) window.OrgContext (canonical)
      try {
        const wcId = getActiveOrgIdForBilling();
        if (wcId) return wcId;
      } catch { /* ignore */ }
      // 2) IIFE-scoped orgContext (available before window.OrgContext)
      try {
        const id = normalizeOrgIdForBilling(orgContext && orgContext.activeOrgId);
        if (id) return id;
      } catch { /* ignore */ }
      // 3) localStorage hint (UUID-validated)
      try {
        const lsId = readLocalOrgId();
        if (lsId && ORG_UUID_RE.test(lsId)) return lsId;
      } catch { /* ignore */ }
      return '';
    }

    // ── Billing org-ready pump: retries refreshBilling until orgId resolves ──
    const BILLING_PUMP_RETRY_MS = 200;
    const BILLING_PUMP_MAX_TRIES = 12;
    const BILLING_PUMP_FRESH_MS = 30000;
    const BILLING_PUMP_COOLDOWN_MS = 5000;
    const BILLING_PUMP_HARD_COOLDOWN_MS = 10000;
    const _BILLING_PUMP_FORCE_REASONS = new Set(['org-changed', 'manual', 'org-context:partial']);
    const _BILLING_PUMP_COOLDOWN_REASONS = new Set(['render-auth-state', 'org-context', 'tab-visible', 'settings-open', 'storage']);
    let _billingPumpTimer = null;
    let _billingPumpTries = 0;
    let _billingPumpEverRan = false;
    const _billingPumpLastByReason = new Map();
    let _billingPumpLastRunAtMs = 0;

    function maybeScheduleBillingRefresh(reason) {
      // ── Auth gate: never pump billing without a proven or usable session ──
      const _proven = typeof SupabaseClient.isAuthProven === 'function' && SupabaseClient.isAuthProven();
      if (!_proven) {
        const _truth = getAuthTruthSnapshot();
        const _sessionUsable = Boolean(
          _truth && _truth.session && _truth.session.access_token &&
          _truth.session.expires_at && (_truth.session.expires_at * 1000) > Date.now()
        );
        if (!_sessionUsable) {
          billingDebugLog('[BillingPump] skip:auth-not-proven', {
            reason,
            orgId: getActiveOrgIdNow() || null,
            status: _truth ? _truth.status : null,
          });
          return;
        }
      }

      const activeOrgId = getActiveOrgIdNow();
      const now = Date.now();

      if (!activeOrgId) {
        // No org yet — schedule a retry if under the limit
        if (_billingPumpTries >= BILLING_PUMP_MAX_TRIES) {
          billingDebugLog('[BillingPump] give-up', { reason, tries: _billingPumpTries });
          _billingPumpTries = 0;
          return;
        }
        _billingPumpTries += 1;
        clearTimeout(_billingPumpTimer);
        _billingPumpTimer = setTimeout(() => {
          maybeScheduleBillingRefresh(reason);
        }, BILLING_PUMP_RETRY_MS);
        billingDebugLog('[BillingPump] retry-scheduled', { reason, try: _billingPumpTries });
        return;
      }

      // Org available — reset retry counter
      _billingPumpTries = 0;
      clearTimeout(_billingPumpTimer);

      // ── Hard cooldown: absolute minimum time between any pump runs ──
      if (!_BILLING_PUMP_FORCE_REASONS.has(reason) && _billingPumpLastRunAtMs && (now - _billingPumpLastRunAtMs) < BILLING_PUMP_HARD_COOLDOWN_MS) {
        billingDebugLog('[BillingPump] skip:hard-cooldown', { reason, ageMs: now - _billingPumpLastRunAtMs });
        return;
      }

      // ── Strong "already fresh" guard: skip if billing is current for this org ──
      const snap = (typeof window !== 'undefined' && window.__TP3D_BILLING
        && typeof window.__TP3D_BILLING.getBillingState === 'function')
        ? window.__TP3D_BILLING.getBillingState() : null;
      if (
        snap &&
        snap.ok === true &&
        !snap.loading &&
        !snap.pending &&
        !snap.error &&
        snap.orgId &&
        String(snap.orgId) === String(activeOrgId) &&
        snap.lastFetchedAt &&
        (now - snap.lastFetchedAt) < BILLING_PUMP_FRESH_MS &&
        !_BILLING_PUMP_FORCE_REASONS.has(reason)
      ) {
        billingDebugLog('[BillingPump] skip:fresh', {
          reason,
          orgId: activeOrgId,
          ageMs: now - snap.lastFetchedAt,
        });
        return;
      }

      // ── Cross-tab shared freshness: skip if another tab recently fetched ──
      if (!_BILLING_PUMP_FORCE_REASONS.has(reason) && activeOrgId) {
        const sharedFreshAt = _getSharedBillingFreshness(activeOrgId);
        if (sharedFreshAt && (now - sharedFreshAt) < _BILLING_SHARED_FRESH_MS) {
          billingDebugLog('billing:cross-tab-lock:skip-fresh', {
            reason: 'pump:' + reason,
            orgId: activeOrgId,
            sharedAgeMs: now - sharedFreshAt,
          });
          // Reuse shared result if our local state is older
          if (!_billingState.lastFetchedAt || _billingState.lastFetchedAt < sharedFreshAt) {
            const shared = _readSharedBillingResult(activeOrgId);
            if (shared) _applySharedBillingSnapshot(activeOrgId, shared, 'shared-fresh-pump:' + reason);
          }
          return;
        }
      }

      // ── Per-reason cooldown (selected reasons only) ──
      if (_BILLING_PUMP_COOLDOWN_REASONS.has(reason)) {
        const lastAt = _billingPumpLastByReason.get(reason) || 0;
        if ((now - lastAt) < BILLING_PUMP_COOLDOWN_MS) {
          billingDebugLog('[BillingPump] skip:cooldown', { reason, ageMs: now - lastAt });
          return;
        }
      }
      _billingPumpLastByReason.set(reason, now);

      // ── Decide force: only org-changed, manual, or first-ever pump ──
      const shouldForce = _BILLING_PUMP_FORCE_REASONS.has(reason) || !_billingPumpEverRan;
      _billingPumpEverRan = true;

      _billingPumpLastRunAtMs = now;
      billingDebugLog('[BillingPump] run', { reason, orgId: activeOrgId, force: shouldForce });
      refreshBilling({ force: shouldForce, reason: 'pump:' + reason }).catch(() => { });
    }

    // Expose billing pump globally for SettingsOverlay (avoids import coupling)
    try {
      window.TruckPackerApp = window.TruckPackerApp || {};
      window.TruckPackerApp.maybeScheduleBillingRefresh = maybeScheduleBillingRefresh;
    } catch { /* ignore */ }

    function resolveOrgContextFromBundle(bundle) {
      const orgs = Array.isArray(bundle && bundle.orgs) ? bundle.orgs : [];
      const profile = bundle && bundle.profile ? bundle.profile : null;
      const membership = bundle && bundle.membership ? bundle.membership : null;
      const normalizeOrgId = value => {
        if (value === null || typeof value === 'undefined') return null;
        const str = String(value).trim();
        return str ? str : null;
      };

      const profileOrgId = normalizeOrgId(
        profile &&
        (profile.current_organization_id ||
          profile.current_org_id ||
          profile.currentOrgId ||
          profile.currentOrgID)
      );
      const localOrgId = normalizeOrgId(readLocalOrgId());
      const membershipOrgId = normalizeOrgId(
        membership && membership.organization_id ? membership.organization_id : null
      );
      const activeOrgHint = normalizeOrgId(bundle && bundle.activeOrgId ? bundle.activeOrgId : null);
      const hasOrg = id => id && orgs.some(o => o && String(o.id) === String(id));

      let orgId = null;
      // Prefer explicit local selection first so post-invite org switches don't get
      // immediately reverted by a stale profile.current_organization_id snapshot.
      if (localOrgId && hasOrg(localOrgId)) orgId = localOrgId;
      else if (profileOrgId && hasOrg(profileOrgId)) orgId = profileOrgId;
      else if (activeOrgHint && hasOrg(activeOrgHint)) orgId = activeOrgHint;
      else if (membershipOrgId && hasOrg(membershipOrgId)) orgId = membershipOrgId;
      else if (orgs.length > 0) orgId = String(orgs[0].id);
      else if (profileOrgId) orgId = profileOrgId;
      else if (membershipOrgId) orgId = membershipOrgId;

      const activeOrg = orgId ? orgs.find(o => o && String(o.id) === String(orgId)) || null : null;
      let role = null;
      if (membership && orgId && membership.organization_id && String(membership.organization_id) === String(orgId)) {
        role = membership.role || null;
      } else if (activeOrg && activeOrg.role) {
        role = activeOrg.role;
      }

      return { orgId, activeOrg, orgs, role, profileOrgId, profile };
    }

    // ── Workspace-ready event replay buffer ──
    let _lastWorkspaceReadyDetail = null;
    let _lastWorkspaceReadyAt = 0;
    const WORKSPACE_READY_REPLAY_MS = 5000;

    function clearOrgContext({ clearLocalOrgHint = false, confirmedNoOrg = false } = {}) {
      orgContext = {
        activeOrgId: null,
        activeOrg: null,
        orgs: [],
        role: null,
        updatedAt: Date.now(),
      };
      orgContextVersion = 0;
      lastAppliedOrgContextVersion = 0;
      _orgBundleFetchInflightForOrg = null;
      _orgRoleHydrationGraceUntilByOrg.clear();
      lastOrgIdNotified = null;
      lastOrgChangeAt = 0;
      if (clearLocalOrgHint || confirmedNoOrg) writeLocalOrgId(null);
      applyOrgRequiredUi(false, { confirmedNoOrg });
      queueOrgScopedRender('org-cleared');
    }

    let orgScopedRenderTimer = null;
    function queueOrgScopedRender(_reason) {
      if (orgScopedRenderTimer) return;
      orgScopedRenderTimer = setTimeout(() => {
        orgScopedRenderTimer = null;
        try {
          PacksUI.render();
        } catch {
          // ignore
        }
        try {
          CasesUI.render();
        } catch {
          // ignore
        }
        try {
          EditorUI.render();
        } catch {
          // ignore
        }
      }, 0);
    }

    const ORG_REQUIRED_BANNER_ID = 'tp3d-org-required-banner';
    let orgBannerRetryTimer = null;
    function ensureOrgRequiredBanner() {
      const container = document && document.querySelector ? document.querySelector('.content') : null;
      if (!container) return null;
      let banner = document.getElementById(ORG_REQUIRED_BANNER_ID);
      if (banner) return banner;

      banner = document.createElement('div');
      banner.id = ORG_REQUIRED_BANNER_ID;
      banner.className = 'card tp3d-org-required-banner';
      banner.innerHTML = `
        <div class="tp3d-org-required-content">
          <div class="tp3d-org-required-title">Create or join a workspace</div>
          <div class="tp3d-org-required-sub muted">
            You need a workspace to manage packs, cases, and editor data.
          </div>
        </div>
        <div class="tp3d-org-required-actions">
          <button class="btn btn-primary" type="button" data-action="org-settings">Open Settings</button>
        </div>
      `;

      const actionBtn = banner.querySelector('[data-action="org-settings"]');
      if (actionBtn) {
        actionBtn.addEventListener('click', () => {
          try {
            openSettingsOverlay('org-general');
          } catch {
            // ignore
          }
        });
      }

      container.prepend(banner);
      return banner;
    }

    function setDisabled(el, disabled) {
      if (!el) return;
      el.disabled = Boolean(disabled);
      el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }

    function applyOrgRequiredUi(hasOrg, { confirmedNoOrg = false } = {}) {
      const banner = ensureOrgRequiredBanner();
      if (!banner) {
        if (!orgBannerRetryTimer) {
          orgBannerRetryTimer = window.setTimeout(() => {
            orgBannerRetryTimer = null;
            applyOrgRequiredUi(hasOrg, { confirmedNoOrg });
          }, 0);
        }
        return;
      }

      if (orgBannerRetryTimer) {
        window.clearTimeout(orgBannerRetryTimer);
        orgBannerRetryTimer = null;
      }

      const authSnapshot = getCurrentAuthSnapshot();
      // Use definitively signed-out (not 'unknown'/'checking') so we don't flash the banner
      // while auth is still resolving on slow connections.
      const isDefinitelySignedOut = Boolean(authSnapshot && authSnapshot.status === 'signed_out');
      // P0.7 – If the wrapper says signed_out but the last real auth event was
      // signed_in within the fallback TTL, treat it as a transient glitch.
      const isTransientSignedOut = isDefinitelySignedOut && lastAuthEventSnapshot
        && lastAuthEventSnapshot.status === 'signed_in' && lastAuthEventSnapshot.hasToken
        && (Date.now() - (lastAuthEventSnapshot.ts || 0)) < FALLBACK_AUTH_TTL_MS;
      // A stored org hint means the user has (or recently had) an org — keep banner hidden
      // while auth/bundle is still resolving (prevents flash for returning users).
      const hasLocalOrgHint = Boolean(readLocalOrgId());
      const suppressUncertain = !isDefinitelySignedOut && !confirmedNoOrg && hasLocalOrgHint;
      // Auth Stability Gate: never show banner while auth is still settling
      const authNotSettled = !authGateIsSettled();
      const showNoOrgBanner = !hasOrg && !suppressUncertain && !isTransientSignedOut && !authNotSettled && (isDefinitelySignedOut || confirmedNoOrg);
      if (!hasOrg && authNotSettled && !confirmedNoOrg) {
        if (isTp3dDebugEnabled()) console.info('[workspaceReady] defer-no-org:auth-not-settled (banner)');
      }
      banner.hidden = !showNoOrgBanner;

      // Only disable buttons when we are certain there is no org.
      // During auth wobble (suppressed/uncertain), keep buttons enabled so the UI isn't frozen.
      const disable = showNoOrgBanner;
      setDisabled(document.getElementById('btn-new-pack'), disable);
      setDisabled(document.getElementById('btn-import-pack'), disable);
      setDisabled(document.getElementById('btn-packs-bulk-delete'), disable);
      setDisabled(document.getElementById('btn-new-case'), disable);
      setDisabled(document.getElementById('btn-cases-import'), disable);
      setDisabled(document.getElementById('btn-cases-bulk-delete'), disable);
      setDisabled(document.getElementById('btn-autopack'), disable);
      setDisabled(document.getElementById('btn-screenshot'), disable);
      setDisabled(document.getElementById('btn-pdf'), disable);

      // ── Async workspace-ready recovery ──
      // If we just set buttons to disabled (no org) but it's NOT confirmed, launch
      // a background poll to check if a workspace becomes ready and re-apply.
      const authTruthForPoll = getAuthTruthSnapshot();
      const canPollWorkspaceReady = Boolean(
        !hasOrg &&
        !confirmedNoOrg &&
        !_workspaceReadyInflight &&
        authGateIsSettled() &&
        authTruthForPoll &&
        authTruthForPoll.isSignedIn
      );
      if (canPollWorkspaceReady) {
        _workspaceReadyInflight = true;
        ensureWorkspaceReadyForUI({ timeoutMs: 2500 }).then(async (result) => {
          if (isTp3dDebugEnabled()) {
            console.info('[WorkspaceReadyUI] poll result', result);
          }
          if (result && result.ok && result.activeOrgId) {
            // Store for replay in case listener isn't installed yet
            _lastWorkspaceReadyDetail = { activeOrgId: result.activeOrgId };
            _lastWorkspaceReadyAt = Date.now();

            if (isTp3dDebugEnabled()) {
              console.info('[WorkspaceReadyUI] dispatch', { activeOrgId: result.activeOrgId });
            }

            // Dispatch event for any listeners
            try {
              window.dispatchEvent(new CustomEvent('tp3d:workspace-ready', {
                detail: { activeOrgId: result.activeOrgId },
              }));
            } catch { /* ignore */ }

            // Immediately self-heal: re-hydrate org context + re-render
            // (ensures recovery even if listener hasn't been installed yet)
            try {
              await refreshOrgContext('workspace-ready:self-heal', { force: true, forceEmit: true });
            } catch { /* ignore */ }
            applyOrgRequiredUi(true);
            queueOrgScopedRender('workspace-ready:self-heal');
          }
        }).finally(() => { _workspaceReadyInflight = false; });
      }
    }

    // ── Install workspace-ready listener early (before any call site can fire) ──
    window.addEventListener('tp3d:workspace-ready', async (ev) => {
      try {
        const activeOrgId = ev && ev.detail && ev.detail.activeOrgId ? String(ev.detail.activeOrgId) : null;
        if (!activeOrgId) return;
        if (isTp3dDebugEnabled()) {
          console.info('[WorkspaceReadyUI] receive', { activeOrgId });
        }
        // Re-apply org context from fresh bundle then re-render
        try {
          await refreshOrgContext('workspace-ready', { force: true, forceEmit: true });
        } catch { /* ignore */ }
        applyOrgRequiredUi(true);
        queueOrgScopedRender('workspace-ready');
      } catch {
        // ignore
      }
    });

    async function applyOrgContextFromBundle(bundle, { reason = 'org-context', forceEmit = false } = {}) {
      if (!bundle || !bundle.session || !bundle.user) {
        // Do NOT wipe org state when bundle is unavailable — it may just be loading or a transient
        // network error. Only clear if auth is definitively signed_out.
        const _truth = getAuthTruthSnapshot();
        if (_truth && _truth.status === 'signed_out' && authGateIsSettled()) {
          clearOrgContext({ clearLocalOrgHint: true, confirmedNoOrg: true });
        }
        return null;
      }

      const resolved = resolveOrgContextFromBundle(bundle);
      const nextOrgId = resolved.orgId;
      const now = Date.now();

      if (!nextOrgId) {
        if (bundle && bundle.partial && readLocalOrgId()) {
          maybeScheduleBillingRefresh('org-context:partial');
          return null;
        }
        clearOrgContext({
          clearLocalOrgHint: false,
          confirmedNoOrg: Boolean(!bundle?.partial && Array.isArray(resolved.orgs) && resolved.orgs.length === 0),
        });
        return null;
      } 

      const prevOrgId = orgContext.activeOrgId ? String(orgContext.activeOrgId) : null;
      const nextOrgIdStr = String(nextOrgId);
      const changed = !prevOrgId || prevOrgId !== nextOrgIdStr;

      // Never let a partial bundle override a newer full bundle or a user-selected org.
      if (bundle && bundle.partial === true && changed && prevOrgId) {
        if (isTp3dDebugEnabled()) {
          console.info('[orgContext] skip-partial-overwrite', {
            prevOrgId,
            nextOrgId: nextOrgIdStr,
            reason,
          });
        }
        maybeScheduleBillingRefresh('org-context:partial');
        return prevOrgId;
      }

      orgContext = {
        activeOrgId: nextOrgIdStr,
        activeOrg: resolved.activeOrg || null,
        orgs: resolved.orgs || [],
        role: resolved.role || null,
        updatedAt: now,
      };
      // Expose last bundle for sync role resolution (resolveCanManageBillingForOrg).
      try { window.__TP3D_LAST_ACCOUNT_BUNDLE = bundle; } catch (_) { /* ignore */ }
      writeLocalOrgId(nextOrgIdStr);

      // Best-effort: persist current org to profile when we have a real profile row.
      if (resolved.profile && !resolved.profile._isDefault) {
        const hasProfileOrgField =
          Object.prototype.hasOwnProperty.call(resolved.profile, 'current_organization_id') ||
          Object.prototype.hasOwnProperty.call(resolved.profile, 'current_org_id') ||
          Object.prototype.hasOwnProperty.call(resolved.profile, 'currentOrgId') ||
          Object.prototype.hasOwnProperty.call(resolved.profile, 'currentOrgID');
        const profileOrgId = resolved.profileOrgId ? String(resolved.profileOrgId) : null;
        if (hasProfileOrgField && profileOrgId !== nextOrgIdStr && now - lastOrgPersistAt > ORG_PERSIST_COOLDOWN_MS) {
          lastOrgPersistAt = now;
          try {
            if (SupabaseClient && typeof SupabaseClient.updateProfile === 'function') {
              SupabaseClient.updateProfile({ current_organization_id: nextOrgIdStr }).catch(() => { });
            }
          } catch {
            // ignore
          }
        }
      }

      let hidden = false;
      try {
        hidden = typeof document !== 'undefined' && document.hidden === true;
      } catch {
        hidden = false;
      }
      if (hidden) {
        orgContextQueued = true;
        orgContextMetrics.orgChangedQueuedWhileHidden += 1;
        return nextOrgIdStr;
      }

      if (changed || forceEmit) {
        const sameOrgRecently =
          nextOrgIdStr === lastOrgIdNotified && now - lastOrgChangeAt < ORG_CONTEXT_DEDUP_MS;
        if (!forceEmit && sameOrgRecently) {
          // Skip duplicate org-changed bursts for the same org within 500ms
          orgContextMetrics.orgChangedIgnoredSameId += 1;
        } else {
          const shouldBroadcast =
            changed &&
            reason !== 'org-sync-storage' &&
            reason !== 'org-sync-legacy' &&
            reason !== 'org-sync-event';
          dispatchOrgContextChanged({
            orgId: nextOrgIdStr,
            reason: reason || null,
            broadcast: shouldBroadcast,
            source: 'bundle-apply',
            userId: bundle && bundle.user && bundle.user.id ? String(bundle.user.id) : null,
          });
          lastOrgIdNotified = nextOrgIdStr;
          lastOrgChangeAt = now;
          orgContextMetrics.orgChangedEmitted += 1;
        }
      } else {
        orgContextMetrics.orgChangedIgnoredSameId += 1;
      }

      applyOrgRequiredUi(true);
      if (changed || forceEmit) {
        queueOrgScopedRender(reason);
      }
      if (_orgBundleFetchInflightForOrg === nextOrgIdStr) _orgBundleFetchInflightForOrg = null;
      maybeScheduleBillingRefresh('org-context');
      // Re-apply access gate with current billing snapshot + fresh role.
      // Handles: role resolved after billing already cached → modal upgrades in-place.
      applyAccessGateFromBilling(getBillingState(), { reason: 'bundle-role-resolved' });
      return nextOrgIdStr;
    }

    async function refreshOrgContext(reason, { force = false, forceEmit = false } = {}) {
      let hidden = false;
      try {
        hidden = typeof document !== 'undefined' && document.hidden === true;
      } catch {
        hidden = false;
      }
      if (hidden) {
        orgContextQueued = true;
        return null;
      }

      const truth = getAuthTruthSnapshot();
      if (!truth.isSignedIn) {
        if (truth.status === 'signed_out' && authGateIsSettled()) {
          clearOrgContext({ clearLocalOrgHint: true, confirmedNoOrg: true });
        }
        return null;
      }

      if (orgContextInFlight) {
        orgContextQueued = true;
        return orgContextInFlight;
      }

      orgContextInFlight = (async () => {
        const bundle = await SupabaseClient.getAccountBundleSingleFlight({ force });
        await applyOrgContextFromBundle(bundle, { reason, forceEmit });
        return null;
      })().finally(() => {
        orgContextInFlight = null;
        if (orgContextQueued) {
          orgContextQueued = false;
          window.setTimeout(() => {
            void refreshOrgContext('org-queued');
          }, AUTH_REFRESH_DEBOUNCE_MS);
        }
      });

      return orgContextInFlight;
    }

    function requestAuthRefresh(reason, opts = {}) {
      const normalizedReason = String(reason || '').trim();
      if (normalizedReason) authRefreshReasons.add(normalizedReason);
      if (opts && opts.force) authRefreshPending.force = true;
      if (opts && opts.forceBundle) authRefreshPending.forceBundle = true;
      if (opts && opts.sessionHint) {
        authRefreshPending.sessionHint = opts.sessionHint;
      }
      const autoReason = AUTH_REFRESH_AUTO_REASONS.has(normalizedReason);
      const truth = getAuthTruthSnapshot();
      if (isLogoutInProgress()) {
        if (isTp3dDebugEnabled()) {
          console.info('[authRefresh] skip-logout-in-progress', { reason: normalizedReason || null });
        }
        return;
      }
      if (
        autoReason &&
        (!authGateIsSettled() || authRehydratePromise || authRefreshInFlight || orgContextInFlight)
      ) {
        if (isTp3dDebugEnabled()) {
          console.info('[authRefresh] skip-auto-race', {
            reason: normalizedReason || null,
            settled: authGateIsSettled(),
            authRehydrateInFlight: Boolean(authRehydratePromise),
            authRefreshInFlight: Boolean(authRefreshInFlight),
            orgContextInFlight: Boolean(orgContextInFlight),
          });
        }
        authRefreshQueued = true;
        return;
      }
      if (autoReason && truth.status === 'signed_out') {
        return;
      }

      // Auth proof fast-path: skip refresh when session is proven and bundle is cached
      if (autoReason && !opts.force && !opts.forceBundle) {
        const proven = typeof SupabaseClient.isAuthProven === 'function' && SupabaseClient.isAuthProven();
        const cached = typeof SupabaseClient.hasValidBundleCache === 'function' && SupabaseClient.hasValidBundleCache();
        if (proven && cached) {
          if (isTp3dDebugEnabled()) {
            console.info('[authRefresh] skip-proven-fresh', { reason: normalizedReason || null });
          }
          return;
        }
      }

      let hidden = false;
      try {
        hidden = typeof document !== 'undefined' && document.hidden === true;
      } catch {
        hidden = false;
      }
      if (hidden) {
        authRefreshQueued = true;
        return;
      }
      let online = true;
      try {
        online = typeof navigator === 'undefined' || navigator.onLine !== false;
      } catch {
        online = true;
      }
      if (!online) {
        authRefreshQueued = true;
        return;
      }

      if (authRefreshTimer) return;
      authRefreshTimer = setTimeout(() => {
        authRefreshTimer = null;
        void runAuthRefresh();
      }, AUTH_REFRESH_DEBOUNCE_MS);
    }

    async function runAuthRefresh() {
      if (authRefreshInFlight) {
        authRefreshQueued = true;
        return authRefreshInFlight;
      }
      if (isLogoutInProgress()) {
        return null;
      }

      let hidden = false;
      try {
        hidden = typeof document !== 'undefined' && document.hidden === true;
      } catch {
        hidden = false;
      }
      if (hidden) {
        authRefreshQueued = true;
        return null;
      }
      let online = true;
      try {
        online = typeof navigator === 'undefined' || navigator.onLine !== false;
      } catch {
        online = true;
      }
      if (!online) {
        authRefreshQueued = true;
        return null;
      }
      const truthBeforeRefresh = getAuthTruthSnapshot();
      if (truthBeforeRefresh.status === 'signed_out' && authGateIsSettled()) {
        return null;
      }

      authRefreshQueued = false;
      const reasons = Array.from(authRefreshReasons);
      authRefreshReasons.clear();
      const pending = authRefreshPending;
      authRefreshPending = {
        force: false,
        forceBundle: false,
        sessionHint: null,
      };

      const now = Date.now();
      if (!authRefreshWindowStart || now - authRefreshWindowStart > AUTH_REFRESH_WINDOW_MS) {
        authRefreshWindowStart = now;
        authRefreshAttempts = 0;
      }
      authRefreshAttempts += 1;
      const autoOnly =
        reasons.length > 0 && reasons.every(r => AUTH_REFRESH_AUTO_REASONS.has(String(r || '').trim()));
      if (authRefreshAttempts > AUTH_REFRESH_MAX_ATTEMPTS && autoOnly && !pending.force) {
        return null;
      }

      authRefreshInFlight = (async () => {
        const authState =
          SupabaseClient && typeof SupabaseClient.getAuthState === 'function' ? SupabaseClient.getAuthState() : null;
        let sessionHint = pending.sessionHint || (authState && authState.session ? authState.session : null);

        const hasTokens = Boolean(sessionHint && sessionHint.access_token && sessionHint.refresh_token);
        if (!hasTokens) {
          if (shouldUseSignedInHint() && !pending.force) {
            if (isTp3dDebugEnabled()) {
              console.info('[authRefresh] signed-in-hint-retry', { reasons });
            }
            authRefreshQueued = true;
            if (!authRefreshTimer) {
              authRefreshTimer = setTimeout(() => {
                authRefreshTimer = null;
                void runAuthRefresh();
              }, 250);
            }
            return null;
          }
          if (!authMissingSessionShown) {
            authMissingSessionShown = true;
            await renderAuthState({
              event: 'SIGNED_OUT',
              user: null,
              userInitiatedSignIn: false,
              userInitiatedSignOut: false,
              isSameUser: false,
              isUserSwitch: false,
              onRetry: bootstrapAuthGate,
            });
          }
          return null;
        }
        authMissingSessionShown = false;

        const overlayOpen = getOverlayOpen();
        const reasonLabel = reasons.length ? reasons.join('|') : 'refresh';
        const forceBundle = pending.forceBundle || (overlayOpen && reasons.includes('tab-visible'));

        await rehydrateAuthState({
          reason: reasonLabel,
          force: pending.force,
          forceBundle,
          sessionHint,
          skipCooldown: true,
        });

        await refreshOrgContext(reasonLabel, { force: forceBundle });

        return null;
      })().finally(() => {
        authRefreshInFlight = null;
        if (authRefreshQueued) {
          authRefreshQueued = false;
          if (!authRefreshTimer) {
            authRefreshTimer = setTimeout(() => {
              authRefreshTimer = null;
              void runAuthRefresh();
            }, AUTH_REFRESH_DEBOUNCE_MS);
          }
        }
      });

      return authRefreshInFlight;
    }

    async function rehydrateAuthState({
      reason = 'auth-change',
      force = false,
      forceBundle = false,
      sessionHint = null,
      skipCooldown = false,
    } = {}) {
      // Single-flight rehydrate to avoid overlapping session/user reads.
      if (authRehydratePromise) return authRehydratePromise;
      try {
        if (!force && typeof document !== 'undefined' && document.hidden) return null;
      } catch {
        // ignore
      }
      if (!skipCooldown && !canStartAuthRehydrate({ force })) return null;

      authRehydratePromise = (async () => {
        const epochAtStart = SupabaseClient.getAuthEpoch ? SupabaseClient.getAuthEpoch() : null;
        // Guard: only apply bundle-driven UI updates when the bundle matches current auth state.
        let bundleOk = true;
        let sessionData = sessionHint
          ? { session: sessionHint, user: sessionHint && sessionHint.user ? sessionHint.user : null }
          : null;
        if (!sessionData) {
          try {
            sessionData = await SupabaseClient.getSessionSingleFlight();
          } catch {
            sessionData = null;
          }
        }

        let user = sessionData && sessionData.user ? sessionData.user : null;
        if (!user) {
          try {
            user = await SupabaseClient.getUserSingleFlight();
          } catch {
            user = null;
          }
        }

        // Clear stale auth-block state when a valid user resolves.
        if (user && user.id) {
          try {
            clearAuthBlocked();
          } catch {
            // ignore
          }
          if (lastAuthUserId && String(lastAuthUserId) !== String(user.id)) {
            lastAuthUserId = null;
          }
        }

        if (forceBundle && SupabaseClient.getAccountBundleSingleFlight) {
          try {
            const ready = SupabaseClient.awaitAuthReady
              ? await SupabaseClient.awaitAuthReady({ timeoutMs: 5000 })
              : { ok: true };
            if (!ready.ok) {
              bundleOk = false;
            } else {
              const bundle = await SupabaseClient.getAccountBundleSingleFlight({ force: true });
              const currentEpoch = SupabaseClient.getAuthEpoch ? SupabaseClient.getAuthEpoch() : null;
              const currentUserId = SupabaseClient.getCurrentUserId ? SupabaseClient.getCurrentUserId() : null;
              // Guard: ignore canceled or mismatched bundles to avoid stale UI.
              if (!bundle || bundle.canceled) {
                bundleOk = false;
              } else if (currentEpoch !== null && Number.isFinite(bundle.epoch) && bundle.epoch !== currentEpoch) {
                bundleOk = false;
              } else if (bundle.user && currentUserId && String(bundle.user.id) !== String(currentUserId)) {
                bundleOk = false;
              }
            }
          } catch {
            bundleOk = false;
          }
        }

        const epochNow = SupabaseClient.getAuthEpoch ? SupabaseClient.getAuthEpoch() : null;
        if (epochAtStart !== null && epochNow !== null && epochNow !== epochAtStart) {
          return user;
        }
        if (!bundleOk) return user;

        // handleAuthChange internally coalesces refreshAccountUI via microtask.
        // Do NOT call refreshAccountUI separately — it causes duplicate renders.
        try {
          if (SettingsOverlay && typeof SettingsOverlay.handleAuthChange === 'function') {
            SettingsOverlay.handleAuthChange(reason);
          }
        } catch {
          // ignore
        }
        try {
          if (AccountOverlay && typeof AccountOverlay.handleAuthChange === 'function') {
            AccountOverlay.handleAuthChange(reason);
          }
        } catch {
          // ignore
        }
        try {
          renderSidebarBrandMarks();
        } catch {
          // ignore
        }
        try {
          if (AccountSwitcher && typeof AccountSwitcher.refresh === 'function') {
            AccountSwitcher.refresh();
          }
        } catch {
          // ignore
        }

        return user;
      })().finally(() => {
        authRehydratePromise = null;
      });

      return authRehydratePromise;
    }

    /**
     * @param {{ event?: string, user?: any, userInitiatedSignIn?: boolean, userInitiatedSignOut?: boolean, isSameUser?: boolean, isUserSwitch?: boolean, onRetry?: any }} [opts]
     */
    async function renderAuthState({
      event,
      user,
      userInitiatedSignIn = false,
      userInitiatedSignOut = false,
      isSameUser = false,
      isUserSwitch = false,
      onRetry = null,
    } = {}) {
      const isSignedInEvent = event === 'SIGNED_IN';
      const isSignedOutEvent = event === 'SIGNED_OUT';
      const isInitialSessionEvent = event === 'INITIAL_SESSION';
      const treatAsSignedOut = isSignedOutEvent || (isInitialSessionEvent && !user);
      const authTruth = getAuthTruthSnapshot();

      if (!user && authTruth.isSignedIn && authTruth.user) {
        user = authTruth.user;
      }
      if (user) {
        const incomingUserId = user && user.id ? String(user.id) : null;
        const authMatchesIncomingUser = Boolean(
          authTruth.isSignedIn &&
          authTruth.userId &&
          (!incomingUserId || String(authTruth.userId) === incomingUserId)
        );
        if (!authMatchesIncomingUser) {
          if (isTp3dDebugEnabled()) {
            console.info('[authRender] drop-stale-signed-in-user', {
              event: event || null,
              incomingUserId,
              authTruthUserId: authTruth.userId,
              authTruthStatus: authTruth.status,
              authTruthHasToken: authTruth.hasToken,
            });
          }
          user = null;
        }
      }

      if (user) {
        const canProceed = await checkProfileStatus();
        if (!canProceed) return;
        AuthOverlay.hide();
        try { document.body.setAttribute('data-auth', 'signed_in'); } catch { /* ignore */ }

        // ── P0.9: Scope storage to this user and reload state ──────────
        const uid = user && user.id ? String(user.id) : 'anon';
        Storage.setStorageScope(uid);

        if (isUserSwitch || !hasLoadedScopedState) {
          // Pause autosave → wipe in-memory state → load user's storage (or seed)
          suspendAutoSave = true;
          try {
            resetAppStateToEmpty();
            loadScopedStateOrSeed();
          } finally {
            suspendAutoSave = false;
          }
          hasLoadedScopedState = true;
          // Re-render all screens with the new user's data
          try { renderAll(); } catch { /* ignore */ }
        }
        // ── end P0.9 ───────────────────────────────────────────────────

        const shouldShowSignInToast = isSignedInEvent && !isSameUser && (userInitiatedSignIn || isUserSwitch);
        if (shouldShowSignInToast && canShowToast('auth-signed-in')) {
          const toastMsg = isUserSwitch ? 'Switched user' : 'Signed in';
          UIComponents.showToast(toastMsg, 'success', { title: 'Auth' });
        }

        if (isSignedInEvent || isUserSwitch) {
          try { await refreshOrgContext('signed-in', { force: true, forceEmit: true }); } catch { /* ignore */ }
        }

        if (SettingsOverlay && typeof SettingsOverlay.handleAuthChange === 'function') {
          SettingsOverlay.handleAuthChange(event);
        }
        if (AccountOverlay && typeof AccountOverlay.handleAuthChange === 'function') {
          AccountOverlay.handleAuthChange(event);
        }
        lastAuthUserId = user && user.id ? String(user.id) : null;
        renderSidebarBrandMarks();
        if (AccountSwitcher && typeof AccountSwitcher.refresh === 'function') {
          AccountSwitcher.refresh();
        }
        // Guard: skip pump if same user + same org + billing already fresh
        if (!isSameUser || isUserSwitch) {
          maybeScheduleBillingRefresh('render-auth-state');
        } else {
          const _pumpSnap = (typeof window !== 'undefined' && window.__TP3D_BILLING
            && typeof window.__TP3D_BILLING.getBillingState === 'function')
            ? window.__TP3D_BILLING.getBillingState() : null;
          const _pumpFresh = _pumpSnap && _pumpSnap.ok && _pumpSnap.lastFetchedAt
            && (Date.now() - _pumpSnap.lastFetchedAt) < BILLING_PUMP_FRESH_MS;
          // Also check cross-tab shared freshness (90s window) to avoid
          // scheduling a pump that will immediately be blocked as skip-fresh
          let _pumpFreshCrossTab = false;
          if (!_pumpFresh) {
            const _pumpOrgId = getActiveOrgIdForBilling();
            if (_pumpOrgId) {
              const _sharedAt = _getSharedBillingFreshness(_pumpOrgId);
              _pumpFreshCrossTab = Boolean(_sharedAt && (Date.now() - _sharedAt) < _BILLING_SHARED_FRESH_MS);
            }
          }
          if (!_pumpFresh && !_pumpFreshCrossTab) {
            maybeScheduleBillingRefresh('render-auth-state');
          } else if (_pumpFreshCrossTab) {
            billingDebugLog('billing:render-auth-state:skip-cross-tab-fresh');
          }
        }
        showReadyOnce();
        return;
      }

      // ── P0.9.1: If this is a transient cross-tab SIGNED_OUT (not user-initiated)
      //    and we have a recent signed-in snapshot, skip the destructive wipe.
      //    The follow-up SIGNED_IN / TOKEN_REFRESHED will rehydrate normally. ──
      const _isTransientSignedOut = !userInitiatedSignOut
        && !isLogoutInProgress()
        && !authGateIsSettled()
        && shouldUseSignedInHint();

      if (_isTransientSignedOut) {
        // Do NOT wipe state/storage/org — just request a forced refresh so the
        // imminent SIGNED_IN event can pick up cleanly.
        requestAuthRefresh('transient-signed-out', { force: true, forceBundle: true });
        return;
      }
      // ── end P0.9.1 ────────────────────────────────────────────────────────────────

      // ── Auth Stability Gate: defer destructive actions for non-user-initiated sign-outs ──
      // If the user didn't explicitly sign out, treat this SIGNED_OUT as a *candidate*
      // and defer org-clearing / UI wipe until it's confirmed stable.
      if (!userInitiatedSignOut && !authBlockState) {
        authGateSignedOutCandidate(() => {
          // This fires after AUTH_SIGNED_OUT_STABLE_MS with no intervening SIGNED_IN.
          try { document.body.setAttribute('data-auth', 'signed_out'); } catch { /* ignore */ }
          _executeSignedOutCleanup({ event, treatAsSignedOut, userInitiatedSignOut: false, onRetry });
        });
        // Don't set data-auth yet — keep signed_in appearance while gate is pending
        return;
      }
      // ── end Auth Stability Gate ────────────────────────────────────────────────────

      _executeSignedOutCleanup({ event, treatAsSignedOut, userInitiatedSignOut, onRetry });
    }

    /** Extracted destructive signed-out actions so the auth gate timer can call them. */
    function _executeSignedOutCleanup({ event, treatAsSignedOut, userInitiatedSignOut, onRetry }) {
      const isSignedOutEvent = event === 'SIGNED_OUT';
      try { document.body.setAttribute('data-auth', 'signed_out'); } catch { /* ignore */ }
      lastAuthEventSnapshot = { status: 'signed_out', userId: null, hasToken: false, session: null, ts: Date.now() };

      // ── P0.9: Reset scope to anon so autosave can't write to the old user's key ──
      suspendAutoSave = true;
      try {
        resetAppStateToEmpty();
        Storage.setStorageScope('anon');
        hasLoadedScopedState = false;
      } finally {
        suspendAutoSave = false;
      }
      // ── end P0.9 ─────────────────────────────────────────────────────────────────

      if (authBlockState) {
        AuthOverlay.showAccountDisabled(authBlockState.message);
      } else if (treatAsSignedOut || userInitiatedSignOut) {
        AuthOverlay.setPhase('form', { onRetry: onRetry || bootstrapAuthGate });
        AuthOverlay.show();
      } else {
        AuthOverlay.setPhase('checking', { onRetry: onRetry || bootstrapAuthGate });
        AuthOverlay.show();
      }

      try {
        SupabaseClient.resetAccountBundleCache && SupabaseClient.resetAccountBundleCache('SIGNED_OUT');
      } catch {
        // ignore
      }
      try {
        clearOrgContext({ clearLocalOrgHint: Boolean(userInitiatedSignOut), confirmedNoOrg: Boolean(userInitiatedSignOut) });
      } catch {
        // ignore
      }
      try { clearBillingState(); } catch (_) { /* ignore */ }

      if (isSignedOutEvent && userInitiatedSignOut && canShowToast('auth-signed-out')) {
        UIComponents.showToast('Signed out', 'info', { title: 'Auth' });
      }

      if (SettingsOverlay && typeof SettingsOverlay.handleAuthChange === 'function') {
        SettingsOverlay.handleAuthChange(event);
      }
      if (AccountOverlay && typeof AccountOverlay.handleAuthChange === 'function') {
        AccountOverlay.handleAuthChange(event);
      }
      lastAuthUserId = null;
      renderSidebarBrandMarks();
      if (AccountSwitcher && typeof AccountSwitcher.refresh === 'function') {
        AccountSwitcher.refresh();
      }
      if (isLogoutInProgress()) {
        setLogoutInProgress(false, { source: 'render-auth-state', reason: 'signed-out-cleanup' });
      }
    }

    const PROFILE_CHECK_TTL_MS = 15000;
    let lastProfileCheckUserId = null;
    let lastProfileCheckAt = 0;

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

        // Avoid profile checks when tab is hidden or auth/session is not valid.
        try {
          if (typeof document !== 'undefined' && document.hidden === true) return true;
        } catch {
          // ignore
        }

        const authState =
          SupabaseClient && typeof SupabaseClient.getAuthState === 'function' ? SupabaseClient.getAuthState() : null;
        const status = authState && authState.status ? authState.status : 'unknown';
        const session = authState && authState.session ? authState.session : null;
        const tokenOk = Boolean(session && session.access_token);
        if (status !== 'signed_in' || !tokenOk) return true;

        const userId = user && user.id ? String(user.id) : null;
        const now = Date.now();
        if (userId && userId === lastProfileCheckUserId && now - lastProfileCheckAt < PROFILE_CHECK_TTL_MS) {
          return true;
        }
        lastProfileCheckUserId = userId;
        lastProfileCheckAt = now;

        // Get the raw user data which includes ban info (only if session user lacks it)
        let fullUser = session && session.user ? session.user : user || null;
        let userError = null;
        const hasBannedInfo = Boolean(fullUser) && Object.prototype.hasOwnProperty.call(fullUser, 'banned_until');

        if (!hasBannedInfo) {
          try {
            fullUser = await window.SupabaseClient.getUserSingleFlight();
          } catch (err) {
            userError = err;
          }
        }

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
          const bannedNow = new Date();

          if (bannedUntil > bannedNow) {
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

    let initInFlightPromise = null;
    let initCompleted = false;

    async function init() {
      if (initInFlightPromise) return initInFlightPromise;
      if (initCompleted) return;
      console.info('[TruckPackerApp] init start');
      initInFlightPromise = (async () => {
      if (!(await validateRuntime())) return;
      installDevHelpers({ app: window.TruckPackerApp, stateStore: StateStore, Utils, documentRef: document });
      seedIfEmpty();
      try {
        // Clear any stale reload latches so the app can continue normally.
        if (window && window.sessionStorage) window.sessionStorage.removeItem(authReloadKey);
      } catch {
        // ignore
      }

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
      const anonKey = cfg ? String(cfg.anonKey || '') : '';
      const anonLooksLikeJwt = anonKey.startsWith('eyJ');
      const anonLooksPublishable = anonKey.startsWith('sb_publishable_');

      if (anonLooksPublishable) {
        if (cfg && !cfg.publishableKey) cfg.publishableKey = anonKey;
        const msg =
          'Supabase anon key is misconfigured. Use the public anon key (starts with "eyJ"), not the Stripe publishable key.';
        console.error('[TruckPackerApp] ' + msg);
        if (debugEnabled()) {
          try {
            if (UIComponents && typeof UIComponents.showToast === 'function') {
              UIComponents.showToast(msg, 'error', { title: 'Supabase Config' });
            }
          } catch {
            // ignore
          }
        }
        AuthOverlay.setPhase('cantconnect', {
          error: new Error(msg),
          onRetry: () => window.location.reload(),
        });
        AuthOverlay.show();
        return;
      }

      if (!url || !anonKey || !anonLooksLikeJwt) {
        AuthOverlay.setPhase('cantconnect', {
          error: new Error('Supabase config missing or invalid'),
          onRetry: async () => {
            const retryBootstrap = async () => {
              const retryCfg =
                window.__TP3D_SUPABASE && typeof window.__TP3D_SUPABASE === 'object' ? window.__TP3D_SUPABASE : null;
              const retryUrl = retryCfg ? retryCfg.url : '';
              const retryKey = retryCfg ? String(retryCfg.anonKey || '') : '';
              if (!retryUrl || !retryKey || !String(retryKey).startsWith('eyJ')) {
                throw new Error('Supabase config still missing or invalid');
              }
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

      bootstrapAuthGate = async () => {
        AuthOverlay.setPhase('checking', { onRetry: bootstrapAuthGate });
        AuthOverlay.show();
        try {
          const timeoutMs = 12000;
          const session = await Promise.race([
            SupabaseClient.refreshSession(),
            new Promise((_, rej) => window.setTimeout(() => rej(new Error('Session check timed out')), timeoutMs)),
          ]);
          const user = session && session.user ? session.user : null;
          const ready = SupabaseClient.awaitAuthReady
            ? await SupabaseClient.awaitAuthReady({ timeoutMs: 5000 })
            : { ok: Boolean(user) };
          if (user) {
            // Check profile status before allowing access
            if (!ready.ok) {
              AuthOverlay.setPhase('form', { onRetry: bootstrapAuthGate });
              AuthOverlay.show();
              return false;
            }
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
          // Ensure settled is true so auto-race guard doesn't block refreshes forever
          if (!_authGate.settled && !_authGate.signedOutTimer) {
            _authGate.settled = true;
            _settledStatus = 'signed_out';
            _settledUserId = null;
            if (isTp3dDebugEnabled()) console.info('[authGate] settled:set', { source: 'bootstrap-no-session', status: 'signed_out' });
          }
          return false;
        } catch (err) {
          AuthOverlay.setPhase('cantconnect', { error: err, onRetry: bootstrapAuthGate });
          AuthOverlay.show();
          if (!_authGate.settled && !_authGate.signedOutTimer) {
            _authGate.settled = true;
            _settledStatus = 'signed_out';
            _settledUserId = null;
            if (isTp3dDebugEnabled()) console.info('[authGate] settled:set', { source: 'bootstrap-cantconnect', status: 'signed_out' });
          }
          return false;
        }
      };

      // Invite acceptance token (from org invite links)
      let pendingInviteToken = null;
      let inviteAcceptInFlight = false;
      const inviteTokenStorageKey = 'tp3d:pending_invite_token';
      try {
        const params = new URLSearchParams(window.location.search);
        const tokenFromUrl = String(params.get('invite_token') || '').trim();
        if (tokenFromUrl) {
          pendingInviteToken = tokenFromUrl;
          try {
            window.sessionStorage.setItem(inviteTokenStorageKey, tokenFromUrl);
          } catch (_) {
            // ignore
          }
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('invite_token');
          window.history.replaceState({}, '', cleanUrl.toString());
        } else {
          try {
            const storedToken = String(window.sessionStorage.getItem(inviteTokenStorageKey) || '').trim();
            if (storedToken) pendingInviteToken = storedToken;
          } catch (_) {
            // ignore
          }
        }
      } catch {
        // ignore
      }

      async function tryAcceptPendingInvite(sessionHint = null) {
        if (!pendingInviteToken || inviteAcceptInFlight) return;
        const token = pendingInviteToken;

        let session = sessionHint;
        if (!session) {
          try {
            session = SupabaseClient.getSession && SupabaseClient.getSession();
          } catch {
            session = null;
          }
        }
        if (!session || !session.access_token) return;

        inviteAcceptInFlight = true;
        try {
          UIComponents.showToast('Accepting invite…', 'info', { title: 'Workspace', duration: 6000 });
          const result = await acceptOrgInvite(token);
          pendingInviteToken = null;
          try {
            window.sessionStorage.removeItem(inviteTokenStorageKey);
          } catch (_) {
            // ignore
          }

          if (result && result.ok) {
            const acceptedOrgId = String(
              (result && result.organization_id) ||
              (result && result.data && result.data.organization_id) ||
              ''
            ).trim();
            UIComponents.showToast('Invite accepted. You are now a member of this workspace.', 'success', {
              title: 'Workspace',
              duration: 8000,
            });
            // Refresh org list first, then switch active org to the accepted invite org.
            // This prevents landing in the newly-created personal org after signup.
            await refreshOrgContext('invite-accepted-refresh', { force: true, forceEmit: true });
            if (acceptedOrgId) {
              await setActiveOrgId(acceptedOrgId, { source: 'invite-accepted' });
            }
            requestAuthRefresh('invite-accepted', { force: true, forceBundle: true, sessionHint: session });
            try { SettingsOverlay.open('org-members'); } catch (_) { /* ignore */ }
          } else {
            UIComponents.showToast(result && result.error ? result.error : 'Failed to accept invite.', 'error', {
              title: 'Workspace',
            });
          }
        } catch (err) {
          pendingInviteToken = null;
          try {
            window.sessionStorage.removeItem(inviteTokenStorageKey);
          } catch (_) {
            // ignore
          }
          UIComponents.showToast(
            'Failed to accept invite: ' + (err && err.message ? err.message : 'Unknown error'),
            'error',
            { title: 'Workspace' },
          );
        } finally {
          inviteAcceptInFlight = false;
        }
      }

      if (!authListenerInstalled) {
        authListenerInstalled = true;
        SupabaseClient.onAuthStateChange(async (event, session) => {
          const isSignedInEvent = event === 'SIGNED_IN';
          const isSignedOutEvent = event === 'SIGNED_OUT';
          const isTokenRefreshEvent = event === 'TOKEN_REFRESHED';
          const isInitialSessionEvent = event === 'INITIAL_SESSION';
          const isUserUpdatedEvent = event === 'USER_UPDATED';
          const isPasswordRecoveryEvent = event === 'PASSWORD_RECOVERY';

          // PASSWORD_RECOVERY: Supabase fires this when user clicks the reset link in email.
          // Show the reset-password page in the auth overlay so they can set a new password.
          if (isPasswordRecoveryEvent) {
            try { AuthOverlay.showResetPassword(); } catch { /* ignore */ }
            return;
          }

          const userFromSession = session && session.user ? session.user : null;
          const newUserId = userFromSession && userFromSession.id ? String(userFromSession.id) : null;
          const previousUserId = lastAuthUserId ? String(lastAuthUserId) : null;

          // P0.7 – Snapshot the *real* auth event so getCurrentAuthSnapshot() can
          // fall back to it during the brief window where getAuthState() returns
          // status:'unknown' / hasToken:false right after a valid event.
          if (session && session.access_token) {
            lastAuthEventSnapshot = { status: 'signed_in', userId: newUserId, hasToken: true, session, ts: Date.now() };
          } else if (isSignedOutEvent) {
            lastAuthEventSnapshot = { status: 'signed_out', userId: null, hasToken: false, session: null, ts: Date.now() };
          }

          // ── Auth Stability Gate transitions ──
          if (isSignedInEvent || (isTokenRefreshEvent && session && session.access_token)) {
            authGateSignedIn();
          } else if (isInitialSessionEvent && !userFromSession) {
            authGateInitialSession();
          }
          // SIGNED_OUT is handled below after the transient-signed-out check in renderAuthState.
          // We do NOT call authGateSignedOutCandidate here — it is called from renderAuthState
          // only after the P0.9.1 transient-signed-out guard has been evaluated.

          // FIX: Detect cross-tab login with DIFFERENT user - this is the key bug fix.
          // When a different user logs in on another tab, we receive SIGNED_IN but lastAuthUserId
          // still holds the OLD user's ID. We must clear stale state BEFORE any re-hydration.
          const isUserSwitch = isSignedInEvent && newUserId && previousUserId && newUserId !== previousUserId;

          // Check if user initiated sign-in (consume intent ONCE and reuse the result)
          // Note: consumeAuthIntent clears the intent, so we must call it only once per event
          const userIntentConsumed =
            isSignedInEvent && SupabaseClient.consumeAuthIntent && SupabaseClient.consumeAuthIntent('signIn', 5000);
          const isCrossTabLogin = isSignedInEvent && newUserId && !userIntentConsumed;

          // Cross-tab user switches are handled via auth events (no page reload).

          // If this is a user switch (different user signed in), clear stale state immediately
          if (isUserSwitch) {
            lastAuthUserId = null; // Clear old user ID to prevent stale state leakage
          }

          // Rehydrate auth state for sign-in/session refresh events.
          // FIX: Force rehydration for user switches to ensure fresh data
          const shouldForceBundle =
            isSignedInEvent || isTokenRefreshEvent || isInitialSessionEvent || isUserUpdatedEvent;
          requestAuthRefresh(event || 'auth', {
            force: isUserSwitch,
            forceBundle: shouldForceBundle || isUserSwitch,
            sessionHint: session || null,
          });

          // Sync billing state on auth changes
          // NOTE: refreshBilling is NOT called here — renderAuthState (below) is the single billing trigger
          if (isSignedOutEvent) {
            clearBillingState();
          } else if (isSignedInEvent || isTokenRefreshEvent || isInitialSessionEvent || isUserUpdatedEvent) {
            if (userFromSession && userFromSession.id) {
              tryAcceptPendingInvite(session || null).catch(() => { });
            }
          }

          const authTruthForEvent = getAuthTruthSnapshot();
          // Never treat stale wrapper user as signed-in unless auth truth has a usable session.
          const user = userFromSession || (authTruthForEvent.isSignedIn ? authTruthForEvent.user : null);

          // FIX: Reuse the already-consumed result instead of consuming again
          const userInitiatedSignIn = userIntentConsumed;
          const userInitiatedSignOut =
            isSignedOutEvent && SupabaseClient.consumeAuthIntent && SupabaseClient.consumeAuthIntent('signOut', 2500);

          // FIX: Recalculate isSameUser after potential lastAuthUserId clear
          const currentLastAuthUserId = lastAuthUserId ? String(lastAuthUserId) : null;
          const isSameUser = user && currentLastAuthUserId && user.id && String(user.id) === currentLastAuthUserId;

          try {
            emit('auth:changed', {
              event,
              userId: user && user.id ? String(user.id) : '',
              isUserSwitch,
              isCrossTabLogin,
            });
          } catch {
            // ignore
          }

          // 1) Close settings overlay only when auth really changes user context.
          // Avoid closing on TOKEN_REFRESHED / INITIAL_SESSION to prevent tab desync.
          const shouldCloseSettings = isUserSwitch || isSignedOutEvent;
          if (shouldCloseSettings) {
            try {
              if (SettingsOverlay && typeof SettingsOverlay.close === 'function') SettingsOverlay.close();
            } catch (_) {
              // ignore
            }
            try {
              if (AccountOverlay && typeof AccountOverlay.close === 'function') AccountOverlay.close();
            } catch (_) {
              // ignore
            }
          }

          // 2) Org context changes are handled via refreshOrgContext to keep a single source of truth.

          await renderAuthState({
            event,
            user,
            userInitiatedSignIn,
            userInitiatedSignOut,
            isSameUser,
            isUserSwitch,
            onRetry: bootstrapAuthGate,
          });
        });
      }

      if (!authUiBound) {
        authUiBound = true;
        try {
          document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            requestAuthRefresh('tab-visible');
          });
          let _legacyOrgSyncTimer = null;
          window.addEventListener('storage', ev => {
            const key = ev && ev.key ? String(ev.key) : '';
            if (!key) return;
            if (key === ORG_CONTEXT_SYNC_KEY && ev.newValue) {
              // Canonical sync arrived — cancel any pending legacy hint
              if (_legacyOrgSyncTimer) {
                clearTimeout(_legacyOrgSyncTimer);
                _legacyOrgSyncTimer = null;
                if (isTp3dDebugEnabled()) {
                  console.info('[orgSync] legacy-hint:cancelled', { reason: 'canonical-arrived' });
                }
              }
              const payload = parseOrgContextSyncPayload(ev.newValue);
              if (payload) {
                handleIncomingOrgContextSync(payload, { source: 'org-sync-storage' });
              }
              return;
            }
            if (key === ORG_CONTEXT_LS_KEY) {
              // Legacy key — treat as hint only, debounce to let canonical win
              const nextOrgId = normalizeOrgIdForBilling(ev.newValue || '');
              if (!nextOrgId) return;
              if (_legacyOrgSyncTimer) clearTimeout(_legacyOrgSyncTimer);
              if (isTp3dDebugEnabled()) {
                console.info('[orgSync] legacy-hint', { orgId: nextOrgId, startedMs: 100 });
              }
              _legacyOrgSyncTimer = setTimeout(() => {
                _legacyOrgSyncTimer = null;
                // Canonical did not arrive within window — refresh org context as fallback
                if (isLogoutInProgress()) return;
                const uid = getSignedInUserIdStrict();
                if (!uid) return;
                if (isTp3dDebugEnabled()) {
                  console.info('[orgSync] legacy-hint:fired', { orgId: nextOrgId });
                }
                void refreshOrgContext('org-sync-legacy', { force: true, forceEmit: false });
              }, 100);
              return;
            }
            const isAuthKey =
              key === 'tp3d-logout-trigger' ||
              (key.startsWith('sb-') && (key.endsWith('-auth-token') || key.endsWith('-auth-token-code-verifier')));
            if (!isAuthKey) return;
            requestAuthRefresh('storage');
          });
          // ── Replay any workspace-ready event that fired before this block ran ──
          if (_lastWorkspaceReadyDetail && (Date.now() - _lastWorkspaceReadyAt) < WORKSPACE_READY_REPLAY_MS) {
            const _replayOrgId = _lastWorkspaceReadyDetail.activeOrgId;
            if (_replayOrgId) {
              if (isTp3dDebugEnabled()) {
                console.info('[WorkspaceReadyUI] replay', { activeOrgId: _replayOrgId });
              }
              (async () => {
                try {
                  await refreshOrgContext('workspace-ready:replay', { force: true, forceEmit: true });
                } catch { /* ignore */ }
                applyOrgRequiredUi(true);
                queueOrgScopedRender('workspace-ready:replay');
              })();
            }
          }
          window.addEventListener('tp3d:org-changed', ev => {
            const truth = getAuthTruthSnapshot();
            if (!truth.isSignedIn) {
              orgContextMetrics.orgChangedIgnoredSignedOut += 1;
              return;
            }

            const detail = ev && ev.detail ? ev.detail : {};
            const detailUserId = detail && detail.userId ? String(detail.userId) : null;
            if (detailUserId && truth.userId && detailUserId !== truth.userId) {
              if (isTp3dDebugEnabled()) {
                console.info('[orgContext] ignore-user-mismatch', {
                  detailUserId,
                  currentUserId: truth.userId,
                });
              }
              return;
            }
            const detailEpoch = parseOrgContextVersion(detail && detail.epoch ? detail.epoch : 0);
            if (detailEpoch && detailEpoch < lastAppliedOrgContextVersion) {
              if (isTp3dDebugEnabled()) {
                console.info('[orgContext] ignore-older-epoch', {
                  detailEpoch,
                  lastAppliedOrgContextVersion,
                });
              }
              return;
            }
            if (detailEpoch) {
              markOrgContextVersion(detailEpoch);
            }

            const detailOrgId = detail && detail.orgId ? String(detail.orgId) : null;
            const snapshotOrgId = orgContext.activeOrgId ? String(orgContext.activeOrgId) : null;
            const sameOrg = Boolean(detailOrgId && snapshotOrgId && snapshotOrgId === detailOrgId);
            if (detailOrgId && snapshotOrgId && snapshotOrgId === detailOrgId) {
              orgContextMetrics.orgChangedIgnoredSameId += 1;
            }
            if (sameOrg) {
              return;
            }

            let hidden = false;
            try {
              hidden = typeof document !== 'undefined' && document.hidden === true;
            } catch {
              hidden = false;
            }
            if (hidden) {
              orgContextMetrics.orgChangedQueuedWhileHidden += 1;
              orgContextQueued = true;
              return;
            }

            const overlayOpen = getOverlayOpen();
            requestAuthRefresh('org-changed', { forceBundle: Boolean(overlayOpen) });

            orgContextMetrics.orgChangedHandled += 1;
            queueOrgScopedRender('org-changed');
            try {
              if (AccountSwitcher && typeof AccountSwitcher.refresh === 'function') {
                AccountSwitcher.refresh();
              }
            } catch {
              // ignore
            }
            // Re-apply gating immediately for role/org context changes, then pump billing.
            const nextOrgId = detailOrgId || snapshotOrgId || null;
            applyAccessGateFromBilling(getBillingState(), {
              reason: 'org-changed',
              activeOrgId: nextOrgId,
            });
            maybeScheduleBillingRefresh('org-changed');
          });
        } catch {
          // ignore
        }
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

      // Sidebar upgrade notice subscriber
      try {
        const upgradeEl = document.getElementById('tp3d-sidebar-upgrade');
        const upgradeWrap = document.getElementById('upgradeCardWrap');
        const TRIAL_WELCOME_LS_PREFIX = 'tp3d_trial_modal_shown_';
        let trialExpiredModalRef = null;
        let trialExpiredModalOrgId = null;
        let trialExpiredLockedOrgId = null;
        let trialWelcomeShownOrgId = null;
        let _trialModalCanManageBilling = null; // tracks the last canManageBilling value used for the open modal
        let _trialModalLine1Ref = null;
        let _trialModalRoleHintRef = null;
        let _trialModalDeferTimer = null;
        let _trialModalDeferOrgId = null;
        let _trialModalDeferAttemptedForOrg = null;
        const TRIAL_MODAL_ROLE_DEFER_MS = 900;
        /** @type {Map<string, string>} */
        const lastBillingStatusByOrg = new Map();

        /**
         * Resolve canManageBilling from a single source of truth: the membership
         * role for the active org (from the account bundle), scoped by userId+orgId.
         * Falls back to orgContext.role, then to OrgContext.getActiveRole().
         * Returns resolved=false when role is not yet known (default: non-owner/support UI).
         */
        function resolveCanManageBillingForOrg(orgId) {
          const normalizedOrgId = orgId ? String(orgId).trim() : '';
          const userId = getSignedInUserIdStrict();

          // Early-out: cannot resolve role without both orgId and userId
          if (!normalizedOrgId || !userId) {
            if (isTp3dDebugEnabled()) {
              console.info('[resolveCanManageBillingForOrg]', {
                orgId: normalizedOrgId, userId, resolved: false, membershipRole: null,
                roleSource: 'none', reason: 'missing-identity',
              });
            }
            return { canManageBilling: false, membershipRole: null, roleSource: 'none', resolved: false, userId, orgId: normalizedOrgId };
          }

          let membershipRole = '';
          let roleSource = 'none';
          let resolved = false;

          // 1. Authoritative: orgContext.role (set by resolveOrgContextFromBundle, scoped to activeOrgId)
          if (normalizedOrgId && orgContext && orgContext.activeOrgId && String(orgContext.activeOrgId) === normalizedOrgId) {
            const ctxRole = typeof orgContext.role === 'string' ? orgContext.role.toLowerCase() : '';
            if (ctxRole === 'owner' || ctxRole === 'admin' || ctxRole === 'member') {
              membershipRole = ctxRole;
              roleSource = 'orgContext.role';
              resolved = true;
            }
          }

          // 2. Fallback: OrgContext.getActiveRole() (same data, different accessor)
          if (!resolved) {
            const activeRole = typeof OrgContext.getActiveRole === 'function' ? OrgContext.getActiveRole() : '';
            const normalized = typeof activeRole === 'string' ? activeRole.toLowerCase() : '';
            if (normalized === 'owner' || normalized === 'admin' || normalized === 'member') {
              membershipRole = normalized;
              roleSource = 'OrgContext.getActiveRole';
              resolved = true;
            }
          }

          // 3. Fallback: cached bundle membership from SupabaseClient
          if (!resolved && normalizedOrgId) {
            try {
              // Try the module-level bundle cache via window accessor
              const bundleCache = window.__TP3D_LAST_ACCOUNT_BUNDLE || null;
              if (bundleCache && bundleCache.membership) {
                const memOrgId = bundleCache.membership.organization_id ? String(bundleCache.membership.organization_id).trim() : '';
                const memUserId = bundleCache.user && bundleCache.user.id ? String(bundleCache.user.id) : '';
                if (memOrgId === normalizedOrgId && (!userId || memUserId === userId)) {
                  const memRole = typeof bundleCache.membership.role === 'string' ? bundleCache.membership.role.toLowerCase() : '';
                  if (memRole === 'owner' || memRole === 'admin' || memRole === 'member') {
                    membershipRole = memRole;
                    roleSource = 'bundleCache.membership';
                    resolved = true;
                  }
                }
              }
            } catch (_) { /* ignore */ }
          }

          const canManageBilling = resolved && membershipRole === 'owner';
          const result = { canManageBilling, membershipRole, roleSource, resolved, userId, orgId: normalizedOrgId };
          if (isTp3dDebugEnabled()) {
            console.info('[resolveCanManageBillingForOrg]', {
              orgId: normalizedOrgId, userId, resolved, membershipRole: membershipRole || null,
              roleSource, ctxRole: orgContext && typeof orgContext.role === 'string' ? orgContext.role : null,
              ctxActiveOrgId: orgContext && orgContext.activeOrgId ? String(orgContext.activeOrgId) : null,
              bundleMembership: (function() { try { const _b = window.__TP3D_LAST_ACCOUNT_BUNDLE; return _b && _b.membership ? { role: _b.membership.role, orgId: _b.membership.organization_id } : null; } catch(_) { return null; } })(),
            });
          }
          return result;
        }

        // ── Org Role Hydration State ──────────────────────────────────────
        // Returns 3 states: 'hydrated' (role known or definitively absent),
        // 'inflight' (bundle fetch still in-flight), 'unknown' (no fetch, no role).
        // Used to defer owner-only UI decisions until role has arrived.
        const _ROLE_HYDRATION_CAP_MS = 8000; // hard cap: treat as 'unknown' after 8s in-flight
        let _roleHydrationInflightSince = 0;

        /**
         * @param {string} orgId
         * @returns {'hydrated'|'inflight'|'unknown'}
         */
        function getOrgRoleHydrationState(orgId) {
          const normalizedOrgId = orgId ? String(orgId).trim() : '';
          if (!normalizedOrgId) return 'unknown';

          // Check if role is already known for this org
          if (orgContext && orgContext.activeOrgId && String(orgContext.activeOrgId) === normalizedOrgId) {
            const ctxRole = typeof orgContext.role === 'string' ? orgContext.role.toLowerCase() : '';
            if (ctxRole === 'owner' || ctxRole === 'admin' || ctxRole === 'member') {
              return 'hydrated';
            }
          }
          // Also check the accessor
          if (typeof OrgContext.getActiveRole === 'function') {
            const role = String(OrgContext.getActiveRole() || '').toLowerCase();
            if (role === 'owner' || role === 'admin' || role === 'member') {
              return 'hydrated';
            }
          }

          // Check if bundle fetch is in-flight for this org
          const bundleInflight = _orgBundleFetchInflightForOrg === normalizedOrgId;
          const contextInflight = Boolean(orgContextInFlight);
          const authInflight = Boolean(authRehydratePromise);
          // Grace window: treat as inflight for the first 1.5s after org change
          const graceUntil = _orgRoleHydrationGraceUntilByOrg.get(normalizedOrgId) || 0;
          const inGraceWindow = graceUntil > 0 && Date.now() < graceUntil;

          if (bundleInflight || contextInflight || authInflight || inGraceWindow) {
            // Track when inflight started for hard cap
            if (!_roleHydrationInflightSince) _roleHydrationInflightSince = Date.now();
            // Hard cap: if inflight > 8s, give up waiting and treat as unknown
            if ((Date.now() - _roleHydrationInflightSince) > _ROLE_HYDRATION_CAP_MS) {
              if (isTp3dDebugEnabled()) {
                console.info('[OrgRole] inflight-cap-exceeded', { orgId: normalizedOrgId, elapsedMs: Date.now() - _roleHydrationInflightSince });
              }
              _roleHydrationInflightSince = 0;
              return 'unknown';
            }
            return 'inflight';
          }

          // Not inflight anymore — reset timer
          _roleHydrationInflightSince = 0;
          // Bundle finished but no role found: definitively unknown (treat as non-owner)
          return 'unknown';
        }
        _getOrgRoleHydrationStateAccessor = getOrgRoleHydrationState;

        const pickCheckoutInterval = ({ initialInterval = 'month', _title = 'Choose Plan', _continueLabel = 'Continue' } = {}) =>
          new Promise(resolve => {
            const plans = getCheckoutPlanOptions();
            const fallbackInterval = plans.month.available ? 'month' : (plans.year.available ? 'year' : 'month');
            let selectedInterval = plans[initialInterval] && plans[initialInterval].available
              ? initialInterval
              : fallbackInterval;
            let settled = false;
            const settle = value => {
              if (settled) return;
              settled = true;
              resolve(value);
            };

            // ── Build new plan-picker UI ──────────────────────────────────────
            const content = document.createElement('div');
            content.className = 'tp3d-plan-picker';

            // Title
            const pickerTitle = document.createElement('div');
            pickerTitle.className = 'tp3d-plan-picker__title';
            pickerTitle.textContent = 'Truck Packer Pro';
            content.appendChild(pickerTitle);

            // Feature list
            const featureItems = [
              'Unlimited packs & cases',
              'Advanced 3D editor',
              'PDF & Excel export',
              'Team collaboration',
              'Priority support',
            ];
            const featureList = document.createElement('ul');
            featureList.className = 'tp3d-plan-picker__features';
            featureItems.forEach(text => {
              const li = document.createElement('li');
              li.className = 'tp3d-plan-picker__feature';
              li.textContent = text;
              featureList.appendChild(li);
            });
            content.appendChild(featureList);

            // "Learn More" link
            const learnMore = document.createElement('a');
            learnMore.className = 'tp3d-plan-picker__learn-more';
            learnMore.href = '#';
            learnMore.textContent = 'Learn More';
            learnMore.addEventListener('click', e => e.preventDefault());
            content.appendChild(learnMore);

            // Plan cards
            const cardsWrap = document.createElement('div');
            cardsWrap.className = 'tp3d-plan-picker__cards';

            const buildCard = (interval, badgeText, cardTitle, subText, priceMain, priceSub, disabled) => {
              const card = document.createElement('button');
              card.type = 'button';
              card.className = 'tp3d-plan-card';
              card.disabled = disabled;
              card.dataset.interval = interval;

              const cardLeft = document.createElement('div');
              cardLeft.className = 'tp3d-plan-card__left';

              if (badgeText) {
                const badge = document.createElement('span');
                badge.className = 'tp3d-plan-card__badge';
                badge.textContent = badgeText;
                cardLeft.appendChild(badge);
              }

              const cardTitleEl = document.createElement('div');
              cardTitleEl.className = 'tp3d-plan-card__title';
              cardTitleEl.textContent = cardTitle;
              cardLeft.appendChild(cardTitleEl);

              const cardSub = document.createElement('div');
              cardSub.className = 'tp3d-plan-card__sub';
              cardSub.textContent = subText;
              cardLeft.appendChild(cardSub);

              const cardPrice = document.createElement('div');
              cardPrice.className = 'tp3d-plan-card__price';

              const priceMainEl = document.createElement('span');
              priceMainEl.className = 'tp3d-plan-card__price-main';
              priceMainEl.textContent = priceMain;

              const priceSubEl = document.createElement('span');
              priceSubEl.className = 'tp3d-plan-card__price-sub';
              priceSubEl.textContent = priceSub;

              cardPrice.appendChild(priceMainEl);
              cardPrice.appendChild(priceSubEl);

              card.appendChild(cardLeft);
              card.appendChild(cardPrice);
              return card;
            };

            const yearCard = buildCard(
              'year',
              'Save 17%',
              'Yearly Plan',
              'Billed at $199.99/yr',
              '$16.67',
              'per month',
              !plans.year.available
            );

            const monthCard = buildCard(
              'month',
              null,
              'Monthly Plan',
              'Billed monthly',
              '$19.99',
              'per month',
              !plans.month.available
            );

            cardsWrap.appendChild(yearCard);
            cardsWrap.appendChild(monthCard);
            content.appendChild(cardsWrap);

            // Status line for unavailable plans
            const statusLine = document.createElement('div');
            statusLine.className = 'muted tp3d-checkout-plan-note';
            statusLine.textContent = '';
            content.appendChild(statusLine);

            // CTA button
            const ctaBtn = document.createElement('button');
            ctaBtn.type = 'button';
            ctaBtn.className = 'btn btn-primary tp3d-plan-picker__cta';
            ctaBtn.textContent = 'Start my subscription';
            if (!plans.month.available && !plans.year.available) {
              ctaBtn.disabled = true;
            }
            content.appendChild(ctaBtn);

            // Cancel anytime note — below the CTA
            const cancelNote = document.createElement('div');
            cancelNote.className = 'tp3d-plan-picker__cancel-note';
            cancelNote.textContent = 'Cancel anytime!';
            content.appendChild(cancelNote);

            // Selection state
            const updateSelectionUI = () => {
              yearCard.classList.toggle('tp3d-plan-card--selected', selectedInterval === 'year');
              monthCard.classList.toggle('tp3d-plan-card--selected', selectedInterval === 'month');
              const missing = [];
              if (!plans.month.available) missing.push('Monthly plan is not configured.');
              if (!plans.year.available) missing.push('Yearly plan is not configured.');
              statusLine.textContent = missing.join(' ');
            };

            yearCard.addEventListener('click', () => {
              if (!plans.year.available) return;
              selectedInterval = 'year';
              updateSelectionUI();
            });
            monthCard.addEventListener('click', () => {
              if (!plans.month.available) return;
              selectedInterval = 'month';
              updateSelectionUI();
            });

            updateSelectionUI();

            const modalRef = UIComponents.showModal({
              title: '',
              hideClose: false,
              content,
              actions: [],
              onClose: () => settle(null),
            });

            if (modalRef && modalRef.modal) {
              modalRef.modal.classList.add('tp3d-plan-picker-modal');
            }

            ctaBtn.addEventListener('click', () => {
              const selectedPlan = plans[selectedInterval];
              if (!selectedPlan || !selectedPlan.available) {
                UIComponents.showToast(`Price not configured for interval: ${selectedInterval}`, 'warning', { title: 'Billing' });
                return;
              }
              settle({ interval: selectedInterval });
              try { modalRef && typeof modalRef.close === 'function' && modalRef.close(); } catch (_) { /* ignore */ }
            });
          });

        try {
          if (window.__TP3D_BILLING && typeof window.__TP3D_BILLING === 'object') {
            window.__TP3D_BILLING.pickCheckoutInterval = pickCheckoutInterval;
          }
        } catch (_) {
          // ignore
        }

        const _clearTrialModalDeferTimer = (reason) => {
          if (_trialModalDeferTimer !== null) {
            clearTimeout(_trialModalDeferTimer);
            _trialModalDeferTimer = null;
            if (isTp3dDebugEnabled()) {
              console.info('[TrialExpiredModal] defer:cancel', { orgId: _trialModalDeferOrgId, reason });
            }
          }
          _trialModalDeferOrgId = null;
        };

        const closeTrialExpiredModal = () => {
          _clearTrialModalDeferTimer('modal-close');
          _trialModalDeferAttemptedForOrg = null;
          if (!trialExpiredModalRef || typeof trialExpiredModalRef.close !== 'function') return;
          const ref = trialExpiredModalRef;
          trialExpiredModalRef = null;
          trialExpiredModalOrgId = null;
          _trialModalLine1Ref = null;
          _trialModalRoleHintRef = null;
          try {
            ref.close();
          } catch (_) {
            // ignore
          }
        };

        const upgradeTrialModalToOwner = (snapshot, orgId) => {
          // In-place upgrade: non-owner UI → owner UI (role resolved after modal opened)
          if (_trialModalLine1Ref) {
            _trialModalLine1Ref.textContent = 'Your free trial has ended. Start a subscription to continue using Truck Packer 3D.';
          }
          if (_trialModalRoleHintRef && _trialModalRoleHintRef.parentNode) {
            _trialModalRoleHintRef.parentNode.removeChild(_trialModalRoleHintRef);
            _trialModalRoleHintRef = null;
          }
          // Prepend "Start Subscription" button to footer (idempotent — skip if already present)
          if (trialExpiredModalRef && trialExpiredModalRef.modal) {
            const footer = trialExpiredModalRef.modal.querySelector('.modal-footer');
            if (footer && !footer.querySelector('[data-trial-upgrade-btn]')) {
              const btn = document.createElement('button');
              btn.setAttribute('data-trial-upgrade-btn', '1');
              btn.className = 'btn btn-primary';
              btn.type = 'button';
              btn.textContent = 'Start Subscription';
              btn.addEventListener('click', () => {
                pickCheckoutInterval({ _title: 'Choose Plan', _continueLabel: 'Continue' })
                  .then(selection => {
                    if (!selection || !selection.interval) return Promise.resolve();
                    return startCheckout({ interval: selection.interval }).then((result) => {
                      if (!result.ok) {
                        UIComponents.showToast(result.error || 'Checkout failed', 'error', { title: 'Billing' });
                      }
                    });
                  })
                  .catch(() => {
                    UIComponents.showToast('Checkout failed', 'error', { title: 'Billing' });
                  });
              });
              footer.insertBefore(btn, footer.firstChild);
            }
          }
          _trialModalCanManageBilling = true;
          if (isTp3dDebugEnabled()) {
            const _roleInfo = resolveCanManageBillingForOrg(orgId);
            console.info('[TrialExpiredModal] upgrade', {
              tabId: SupabaseClient && typeof SupabaseClient.getTabId === 'function' ? SupabaseClient.getTabId() : null,
              orgId,
              membershipRole: _roleInfo.membershipRole || null,
              roleSource: _roleInfo.roleSource || null,
            });
          }
        };

        const showTrialExpiredModal = (snapshot, canManageBilling) => {
          const orgId = String(snapshot && snapshot.orgId ? snapshot.orgId : (orgContext && orgContext.activeOrgId) || '').trim();
          if (!orgId) return;
          // If modal already open for this org: skip if same state, upgrade in-place if role resolved
          if (trialExpiredModalRef && trialExpiredModalOrgId === orgId) {
            if (_trialModalCanManageBilling === canManageBilling) return;
            if (canManageBilling && !_trialModalCanManageBilling) {
              upgradeTrialModalToOwner(snapshot, orgId);
              return;
            }
          }
          closeTrialExpiredModal();

          const body = document.createElement('div');
          const line1 = document.createElement('div');
          if (canManageBilling) {
            line1.textContent = 'Your free trial has ended. Start a subscription to continue using Truck Packer 3D.';
          } else {
            line1.textContent = 'Your free trial has ended.';
          }
          body.appendChild(line1);
          _trialModalLine1Ref = line1;
          _trialModalRoleHintRef = null;
          if (!canManageBilling) {
            // TODO: replace support@pxl360.com with the real support email later.
            const roleHint = document.createElement('div');
            roleHint.className = 'muted tp3d-settings-mt-sm';
            const hintText = document.createTextNode('Ask your owner to upgrade this workspace or contact support: ');
            roleHint.appendChild(hintText);
            const supportLink = document.createElement('a');
            supportLink.href = 'mailto:support@pxl360.com';
            supportLink.textContent = 'support@pxl360.com';
            roleHint.appendChild(supportLink);
            body.appendChild(roleHint);
            _trialModalRoleHintRef = roleHint;
          }

          const logoutAction = {
            label: 'Logout',
            variant: 'ghost',
            onClick: () => {
              void performUserInitiatedLogout({ source: 'trial-expired-modal' });
              return false;
            },
          };

          const modalActions = canManageBilling
            ? [
                {
                  label: 'Start Subscription',
                  variant: 'primary',
                  onClick: () => {
                    pickCheckoutInterval({ _title: 'Choose Plan', _continueLabel: 'Continue' })
                      .then(selection => {
                        if (!selection || !selection.interval) return Promise.resolve();
                        return startCheckout({ interval: selection.interval }).then((result) => {
                          if (!result.ok) {
                            UIComponents.showToast(result.error || 'Checkout failed', 'error', { title: 'Billing' });
                          }
                        });
                      })
                      .catch(() => {
                        UIComponents.showToast('Checkout failed', 'error', { title: 'Billing' });
                      });
                    return false;
                  },
                },
                logoutAction,
              ]
            : [logoutAction];

          trialExpiredModalOrgId = orgId;
          trialExpiredLockedOrgId = orgId;
          _trialModalCanManageBilling = canManageBilling;

          // tp3dDebug: log modal render context for cross-tab diagnostics
          if (isTp3dDebugEnabled()) {
            const _roleInfo = resolveCanManageBillingForOrg(orgId);
            console.info('[TrialExpiredModal] render', {
              tabId: SupabaseClient && typeof SupabaseClient.getTabId === 'function' ? SupabaseClient.getTabId() : null,
              userId: _roleInfo.userId || null,
              orgId,
              billingStatus: snapshot && snapshot.status ? snapshot.status : null,
              membershipRole: _roleInfo.membershipRole || null,
              canManageBilling,
              roleSource: _roleInfo.roleSource || null,
            });
          }

          trialExpiredModalRef = UIComponents.showModal({
            title: 'Trial Ended',
            content: body,
            dismissible: false,
            hideClose: true,
            actions: modalActions,
            onClose: () => {
              trialExpiredModalRef = null;
              trialExpiredModalOrgId = null;
              _trialModalCanManageBilling = null;
              _trialModalLine1Ref = null;
              _trialModalRoleHintRef = null;
            },
          });
        };

        const maybeShowTrialWelcome = (snapshot, prevStatus) => {
          if (!snapshot || !snapshot.ok || snapshot.pending || String(snapshot.status || '') !== 'trialing') return;
          const orgId = String(snapshot.orgId || '').trim();
          if (prevStatus === 'trialing') return;
          if (!orgId || trialWelcomeShownOrgId === orgId) return;
          const storageKey = TRIAL_WELCOME_LS_PREFIX + orgId;
          try {
            if (window.localStorage && window.localStorage.getItem(storageKey) === 'true') return;
          } catch (_) {
            // ignore
          }
          trialWelcomeShownOrgId = orgId;
          try {
            if (window.localStorage) window.localStorage.setItem(storageKey, 'true');
          } catch (_) {
            // ignore
          }

          // ---- Build welcome modal content ----
          const wrap = document.createElement('div');
          wrap.className = 'tp3d-trial-welcome';
          const panel = document.createElement('div');
          panel.className = 'tp3d-trial-welcome__panel';
          wrap.appendChild(panel);

          // Title
          const titleEl = document.createElement('div');
          titleEl.className = 'tp3d-trial-welcome__title';
          titleEl.textContent = 'Welcome to Truck Packer';
          wrap.appendChild(titleEl);

          // Subtitle with styled inline phrase
          const subtitleEl = document.createElement('p');
          subtitleEl.className = 'tp3d-trial-welcome__subtitle';
          subtitleEl.appendChild(document.createTextNode('Your one stop shop for the '));
          const artEl = document.createElement('em');
          artEl.className = 'tp3d-trial-welcome__art';
          artEl.textContent = 'not so subtle art';
          subtitleEl.appendChild(artEl);
          subtitleEl.appendChild(document.createTextNode(' of truck packing'));
          wrap.appendChild(subtitleEl);

          // Section heading
          const sectionHeadingEl = document.createElement('p');
          sectionHeadingEl.className = 'tp3d-trial-welcome__section-heading';
          sectionHeadingEl.textContent = 'Start your 7-day free trial';
          wrap.appendChild(sectionHeadingEl);

          // Features intro
          const featuresIntroEl = document.createElement('p');
          featuresIntroEl.className = 'tp3d-trial-welcome__features-intro';
          featuresIntroEl.textContent = 'Get full access to all pro features:';
          wrap.appendChild(featuresIntroEl);

          // Feature checklist
          const featuresList = document.createElement('ul');
          featuresList.className = 'tp3d-trial-welcome__features';
          const featureItems = [
            'Unlimited packs',
            'Unlimited case presets',
            'AutoPack',
            'Export to PDF',
            'Import cases from .xlsx or .csv',
          ];
          featureItems.forEach(text => {
  const li = document.createElement('li');
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-circle-check';
  icon.setAttribute('aria-hidden', 'true');
  li.appendChild(icon);

  // Make file extensions bold for readability.
  if (text === 'Import cases from .xlsx or .csv') {
    // Wrap all inline content in a span so it stays one grid item
    // (li uses display:grid; bare child nodes each become a grid item).
    const textWrap = document.createElement('span');
    textWrap.appendChild(document.createTextNode('Import cases from '));
    const xlsx = document.createElement('strong');
    xlsx.textContent = '.xlsx';
    textWrap.appendChild(xlsx);
    textWrap.appendChild(document.createTextNode(' or '));
    const csv = document.createElement('strong');
    csv.textContent = '.csv';
    textWrap.appendChild(csv);
    li.appendChild(textWrap);
  } else {
    li.appendChild(document.createTextNode(text));
  }

  featuresList.appendChild(li);
});
          wrap.appendChild(featuresList);

          // No credit card note
          const noteEl = document.createElement('p');
          noteEl.className = 'tp3d-trial-welcome__note';
          noteEl.textContent = 'No credit card required, click the button below to get started.';
          wrap.appendChild(noteEl);

          // Get Started CTA (closes modal)
          const ctaBtn = document.createElement('button');
          ctaBtn.type = 'button';
          ctaBtn.className = 'btn btn-primary tp3d-trial-welcome__cta';
          ctaBtn.textContent = 'Get Started';
          wrap.appendChild(ctaBtn);

          // Logout link
          const footerEl = document.createElement('div');
          footerEl.className = 'tp3d-trial-welcome__footer';
          const logoutBtn = document.createElement('button');
          logoutBtn.type = 'button';
          logoutBtn.className = 'tp3d-trial-welcome__logout';
          logoutBtn.textContent = 'Logout';
          logoutBtn.addEventListener('click', () => {
            void performUserInitiatedLogout({ source: 'trial-welcome' });
          });
          footerEl.appendChild(logoutBtn);
          wrap.appendChild(footerEl);

          // Show modal — empty title + hideClose so our custom header takes full body
          const _welcomeRef = UIComponents.showModal({
            title: '',
            hideClose: true,
            content: wrap,
            actions: [],
          });
          // Add scoped class to hide the empty modal-header skeleton
          if (_welcomeRef && _welcomeRef.modal) {
            _welcomeRef.modal.classList.add('tp3d-trial-welcome-modal');
          }
          // Wire Get Started → close
          ctaBtn.addEventListener('click', () => {
            try { _welcomeRef && typeof _welcomeRef.close === 'function' && _welcomeRef.close(); } catch (_) { /* ignore */ }
          });
        };

        const updateSidebarNotice = (s) => {
          const orgId = String((s && s.orgId) || '').trim();
          const _roleResult = resolveCanManageBillingForOrg(orgId);
          const _hydrationState = orgId ? getOrgRoleHydrationState(orgId) : 'unknown';
          // When inflight, force canManageBilling false so owner-only UI stays hidden until role arrives
          const canManageBilling = _hydrationState === 'inflight' ? false : _roleResult.canManageBilling;
          if (isTp3dDebugEnabled() && orgId && _hydrationState !== 'hydrated') {
            const _hydLabel = _hydrationState === 'inflight' ? 'not-hydrated' : 'hydrated-no-role';
            const _hydDetail = _hydrationState === 'unknown' ? 'complete' : _hydrationState;
            const _graceUntilTs = _orgRoleHydrationGraceUntilByOrg.get(orgId) || 0;
            console.info('[OrgRole]', _hydLabel, {
              orgId, hydration: _hydDetail, roleSource: _roleResult.roleSource,
              reason: _hydrationState === 'inflight'
                ? (_orgBundleFetchInflightForOrg === orgId ? 'bundle-inflight'
                  : orgContextInFlight ? 'context-inflight'
                  : authRehydratePromise ? 'auth-inflight'
                  : (_graceUntilTs > Date.now() ? 'grace' : 'other'))
                : undefined,
            });
          }
          const status = String((s && s.status) || '');
          const _storedStatus = orgId ? (() => { try { return sessionStorage.getItem('tp3d:billing:status:' + orgId) || ''; } catch (_) { return ''; } })() : '';
          const prevStatus = orgId ? String(lastBillingStatusByOrg.get(orgId) || _storedStatus) : '';
          if (orgId && status) {
            lastBillingStatusByOrg.set(orgId, status);
            try { sessionStorage.setItem('tp3d:billing:status:' + orgId, status); } catch (_) { /* ignore */ }
          }
          const trialEndMs = s && s.trialEndsAt ? new Date(s.trialEndsAt).getTime() : NaN;
          const trialExpired = Boolean(
            s &&
            s.ok &&
            !s.pending &&
            !s.isActive &&
            (status === 'trial_expired' || (Number.isFinite(trialEndMs) && trialEndMs <= Date.now()))
          );

          if (trialExpired) {
            // Cancel defer + latch if active org changed
            if (_trialModalDeferOrgId && _trialModalDeferOrgId !== orgId) {
              _clearTrialModalDeferTimer('org-changed');
              _trialModalDeferAttemptedForOrg = null;
            }

            if (_roleResult.resolved || trialExpiredModalRef) {
              // Role truly resolved OR modal already open — show/upgrade immediately
              _clearTrialModalDeferTimer('role-resolved');
              _trialModalDeferAttemptedForOrg = null;
              showTrialExpiredModal(s, canManageBilling);
            } else if (_trialModalDeferAttemptedForOrg === orgId) {
              // Defer already fired once for this org, role still unresolved
              if (_orgBundleFetchInflightForOrg === orgId) {
                // Bundle fetch still in-flight — wait for bundle-role-resolved to re-trigger
                if (isTp3dDebugEnabled()) {
                  console.info('[TrialExpiredModal] defer:latch-wait-bundle', { orgId, roleSource: _roleResult.roleSource });
                }
              } else {
                // Bundle arrived but role still unresolved (no membership) — show with safe CTA
                if (isTp3dDebugEnabled()) {
                  console.info('[TrialExpiredModal] defer:latch-show', { orgId, roleSource: _roleResult.roleSource });
                }
                showTrialExpiredModal(s, canManageBilling);
              }
            } else if (!_trialModalDeferTimer) {
              // Role unresolved, no modal, no timer, no prior attempt — start bounded defer
              _trialModalDeferOrgId = orgId;
              _trialModalDeferAttemptedForOrg = orgId;
              if (isTp3dDebugEnabled()) {
                console.info('[TrialExpiredModal] defer', {
                  orgId, ms: TRIAL_MODAL_ROLE_DEFER_MS, resolved: false, roleSource: _roleResult.roleSource,
                });
              }
              _trialModalDeferTimer = setTimeout(() => {
                _trialModalDeferTimer = null;
                _trialModalDeferOrgId = null;
                if (isTp3dDebugEnabled()) {
                  console.info('[TrialExpiredModal] defer:fire', { orgId });
                }
                applyAccessGateFromBilling(getBillingState(), { reason: 'trial-modal-deferred' });
              }, TRIAL_MODAL_ROLE_DEFER_MS);
            }
            // else: timer already running, role still unresolved — let it fire
          }
          else if (!s || (!s.pending && !s.loading)) {
            const _authSnap = getCurrentAuthSnapshot();
            const _signedIn = _authSnap.status === 'signed_in';
            const _activeOid = String(_authSnap.activeOrgId || '').trim();
            const _lockedForOrg = trialExpiredLockedOrgId && _signedIn && _activeOid === trialExpiredLockedOrgId;
            const _defActive = s && s.ok && s.isActive;
            if (_lockedForOrg && !_defActive) {
              if (!trialExpiredModalRef) { try { showTrialExpiredModal(s, canManageBilling); } catch (_) { /* ignore */ } }
            } else {
              if (_defActive || !_signedIn || (trialExpiredLockedOrgId && _activeOid && _activeOid !== trialExpiredLockedOrgId)) {
                trialExpiredLockedOrgId = null;
                closeTrialExpiredModal();
              }
            }
          }

          maybeShowTrialWelcome(s, prevStatus);

          // --- Payment problem banner ---
          const paymentProblem = Boolean(
            s && s.ok && !s.pending && s.paymentProblem && !trialExpired
          );
          let payBanner = document.getElementById('tp3d-payment-banner');
          if (paymentProblem) {
            if (!payBanner) {
              payBanner = document.createElement('div');
              payBanner.id = 'tp3d-payment-banner';
              payBanner.className = 'tp3d-payment-banner';
              document.body.prepend(payBanner);
            }
            const graceDays = Number(s.paymentGraceRemainingDays) || 0;
            const graceText = graceDays > 0
              ? ' (' + graceDays + ' day' + (graceDays === 1 ? '' : 's') + ' remaining)'
              : '';
            // Build banner content via DOM to avoid innerHTML
            payBanner.textContent = '';
            const msgSpan = document.createElement('span');
            if (canManageBilling) {
              msgSpan.textContent = 'Payment issue \u2014 your subscription needs attention.' + graceText;
              payBanner.appendChild(msgSpan);
              let fixBtn = payBanner.querySelector('.tp3d-payment-banner-btn');
              if (!fixBtn) {
                fixBtn = document.createElement('button');
                fixBtn.className = 'tp3d-payment-banner-btn';
                fixBtn.textContent = 'Fix payment';
                fixBtn.addEventListener('click', () => { openPortal(); });
                payBanner.appendChild(fixBtn);
              }
            } else {
              msgSpan.textContent = 'Payment issue \u2014 ask the workspace owner to update billing.' + graceText;
              payBanner.appendChild(msgSpan);
            }
            payBanner.hidden = false;
          } else if (payBanner) {
            payBanner.hidden = true;
          }

          if (!upgradeEl) return;
          const upgradeCurrentlyVisible = Boolean(upgradeWrap ? !upgradeWrap.hidden : !upgradeEl.hidden);
          if (s.loading || s.pending) {
            // Keep the card title / content intact while syncing — only update button state.
            // This prevents the card from flipping to a blank/syncing state on tab focus.
            if (canManageBilling && upgradeCurrentlyVisible) {
              const syncingBtn = upgradeEl.querySelector('button');
              if (syncingBtn) {
                syncingBtn.disabled = true;
                syncingBtn.textContent = 'Syncing\u2026';
              }
              return;
            }
            // Card wasn't visible — keep it hidden until we have resolved data.
            if (upgradeWrap) upgradeWrap.hidden = true;
            else upgradeEl.hidden = true;
            return;
          }
          if (!s.ok) {
            // Billing fetch failed — hide the upgrade card (do not show stale Upgrade CTA).
            if (upgradeWrap) upgradeWrap.hidden = true;
            else upgradeEl.hidden = true;
            return;
          }
          if (!canManageBilling) {
            if (upgradeWrap) upgradeWrap.hidden = true;
            else upgradeEl.hidden = true;
            return;
          }
          const isTrial = status === 'trialing';
          const needsUpgrade = !s.isActive || !s.isPro;
          if (!isTrial && !needsUpgrade) {
            if (upgradeWrap) upgradeWrap.hidden = true;
            else upgradeEl.hidden = true;
            return;
          }
          if (upgradeWrap) upgradeWrap.hidden = false;
          else upgradeEl.hidden = false;

          let trialDays = null;
          if (isTrial && s.trialEndsAt) {
            try {
              const endMs = new Date(s.trialEndsAt).getTime();
              if (Number.isFinite(endMs)) trialDays = Math.max(0, Math.ceil((endMs - Date.now()) / 86400000));
            } catch (_) { /* ignore */ }
          }

          upgradeEl.innerHTML = '';

          // Header: icon + title
          const headerEl = document.createElement('div');
          headerEl.className = 'tp3d-sidebar-upgrade-header';
          const iconEl = document.createElement('span');
          iconEl.className = 'tp3d-sidebar-upgrade-icon';
          iconEl.textContent = '\uD83D\uDCE6';
          const titleEl = document.createElement('div');
          titleEl.className = 'tp3d-sidebar-upgrade-title';
          titleEl.textContent = 'Subscribe';
          headerEl.appendChild(iconEl);
          headerEl.appendChild(titleEl);
          upgradeEl.appendChild(headerEl);

          // Subtitle
          const subEl = document.createElement('div');
          subEl.className = 'tp3d-sidebar-upgrade-text';
          subEl.textContent = isTrial && trialDays !== null
            ? 'Your free trial ends in ' + trialDays + ' day' + (trialDays !== 1 ? 's' : '')
            : 'Upgrade to Pro to unlock all features.';
          upgradeEl.appendChild(subEl);

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-primary tp3d-sidebar-upgrade-btn';
          btn.textContent = 'Upgrade Plan';
          btn.addEventListener('click', () => {
            btn.disabled = true;
            pickCheckoutInterval({ _title: 'Choose Plan', _continueLabel: 'Continue' }).then(selection => {
              if (!selection || !selection.interval) {
                btn.disabled = false;
                return;
              }
              btn.textContent = 'Redirecting\u2026';
              startCheckout({ interval: selection.interval }).then((r) => {
                if (!r.ok) {
                  UIComponents.showToast(r.error || 'Checkout failed', 'error', { title: 'Billing' });
                  btn.disabled = false;
                  btn.textContent = 'Upgrade Plan';
                }
              }).catch(() => {
                btn.disabled = false;
                btn.textContent = 'Upgrade Plan';
              });
            }).catch(() => {
              btn.disabled = false;
            });
          });
          upgradeEl.appendChild(btn);
        };
        _billingGateApplier = updateSidebarNotice;
        subscribeBilling(snapshot => applyAccessGateFromBilling(snapshot, { reason: 'billing-subscriber' }));
        applyAccessGateFromBilling(getBillingState(), { reason: 'gate-init' });
      } catch (_) { /* ignore */ }

      // Refresh billing on focus (throttled inside refreshBilling + cross-tab freshness)
      try {
        window.addEventListener('focus', () => {
          if (Date.now() - _bootStartedAtMs < 8000) return;
          const s = SupabaseClient.getSession && SupabaseClient.getSession();
          if (!s || !s.access_token) return;
          const now = Date.now();
          if (_billingLastFocusRefreshAt && (now - _billingLastFocusRefreshAt) < BILLING_FOCUS_REFRESH_COOLDOWN_MS) return;
          if (
            _billingState.ok &&
            _billingState.lastFetchedAt &&
            (now - _billingState.lastFetchedAt) < BILLING_FOCUS_REFRESH_COOLDOWN_MS
          ) return;
          // ── Cross-tab shared freshness: skip focus refresh if another tab fetched recently ──
          const focusOrgId = getActiveOrgIdForBilling();
          if (focusOrgId) {
            const sharedFreshAt = _getSharedBillingFreshness(focusOrgId);
            if (sharedFreshAt && (now - sharedFreshAt) < BILLING_FOCUS_REFRESH_COOLDOWN_MS) {
              billingDebugLog('billing:cross-tab-lock:skip-fresh', {
                reason: 'window-focus',
                orgId: focusOrgId,
                sharedAgeMs: now - sharedFreshAt,
              });
              // Reuse shared result if our local state is older
              if (!_billingState.lastFetchedAt || _billingState.lastFetchedAt < sharedFreshAt) {
                const shared = _readSharedBillingResult(focusOrgId);
                if (shared) _applySharedBillingSnapshot(focusOrgId, shared, 'shared-fresh:window-focus');
              }
              return;
            }
          }
          _billingLastFocusRefreshAt = now;
          refreshBilling({ force: false, reason: 'window-focus' }).catch(() => { });
        });
      } catch (_) { /* ignore */ }

      // Handle Stripe return URL (?billing=success|cancel|portal_return)
      try {
        const billingParam = new URLSearchParams(window.location.search).get('billing');
        if (billingParam) {
          billingDebugLog('stripe-return:param', { billing: billingParam });
          // Clean URL (remove billing param without reload)
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('billing');
          window.history.replaceState({}, '', cleanUrl.toString());

          if (billingParam === 'success') {
            UIComponents.showToast('Payment successful! Your plan is being activated.', 'success', { title: 'Billing', duration: 8000 });
            refreshBilling({ force: true, reason: 'stripe-return-success-now' }).catch(() => { });
            // Force refresh billing after a short delay (webhook may take a moment)
            setTimeout(() => { refreshBilling({ force: true, reason: 'stripe-return-success-2s' }).catch(() => { }); }, 2000);
            setTimeout(() => { refreshBilling({ force: true, reason: 'stripe-return-success-6s' }).catch(() => { }); }, 6000);
          } else if (billingParam === 'cancel') {
            UIComponents.showToast('Checkout was cancelled.', 'info', { title: 'Billing' });
            refreshBilling({ force: true, reason: 'stripe-return-cancel' }).catch(() => { });
          } else if (billingParam === 'portal_return') {
            UIComponents.showToast('Billing updated. Syncing status\u2026', 'info', { title: 'Billing', duration: 6000 });
            refreshBilling({ force: true, reason: 'stripe-return-portal' }).catch(() => { });
            setTimeout(() => { refreshBilling({ force: true, reason: 'stripe-return-portal-4s' }).catch(() => { }); }, 4000);
          }
        }
      } catch (_) { /* ignore */ }

      // If a pending invite token exists and the user is already signed in, accept now.
      try {
        const currentSession = SupabaseClient.getSession && SupabaseClient.getSession();
        if (currentSession && currentSession.access_token) {
          tryAcceptPendingInvite(currentSession).catch(() => { });
        }
      } catch (_) { /* ignore */ }

      let prevScreen = StateStore.get('currentScreen');

      StateStore.subscribe(changes => {
        // P0.9 – While swapping storage scope, skip autosave so we don't
        // persist stale (old-user) data into the new-user's key.
        if (suspendAutoSave) return;

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
      })().finally(() => {
        initInFlightPromise = null;
        initCompleted = true;
      });
      return initInFlightPromise;
    }

    return {
      init,
      maybeScheduleBillingRefresh,
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
