/**
 * @file supabase-client.js
 * @description UI-free Supabase client wrapper (init + auth helpers) for browser runtime.
 * @module core/supabase-client
 * @updated 01/30/2026
 * @author Truck Packer 3D Team
 *
 * CHANGES (01/28/2026):
 * - Added uploadAvatar() function for avatar image uploads to 'avatars' storage bucket
 * - Added deleteAvatar() function to remove user avatars from storage
 * - Implemented file type validation (PNG, JPG, WEBP only)
 * - Implemented file size validation (2MB max)
 * - Avatar storage follows pattern: ${userId}/avatar.${ext}
 * - Both functions respect RLS policies based on storage.foldername(name)[1] == auth.uid()
 *
 * CHANGES (01/30/2026):
 * - Updated signOut() to call clearLocalAuthStorage() in both offline and online paths
 * - Added support for { scope: 'local'|'global' } in addition to { global: boolean }
 * - Added offline logout support with { allowOffline: boolean }
 */

// ============================================================================
// SECTION: MODULE STATE
// ============================================================================

let _client = null;
let _session = null;
let _initPromise = null;
let _authGuardInstalled = false;
let _authGuardTimer = null;
let _authInvalidatedAt = 0;
let _signedOutCooldownUntil = 0;
let _signOutPromise = null; // single-flight guard for signOut
let _getUserPromise = null;
let _getSessionPromise = null;
let _sessionPromise = null;
let _cachedSession = null;
let _cachedAt = 0;
let _authCooldownUntil = 0;
let _authGetSession = null;
let _authGetUser = null;
let _authSignOut = null;
let _authSignInWithPassword = null;
let _getSessionRawPromise = null;
let _getSessionRawStartedAt = 0;
let _getSessionRawEpoch = 0;
let _getUserRawPromise = null;
let _getSessionRawLastAt = 0;
let _getSessionRawLastResult = null;
let _getUserRawLastAt = 0;
let _getUserRawLastResult = null;
let _visibilityValidateTimer = null;
let _authIntent = { type: null, ts: 0 };
let _tabId = null;
let _lastLogoutSignalAt = 0;
const _authState = { status: 'loading', session: null, user: null, updatedAt: 0 };

// ============================================================================
// AUTH EPOCH & ACCOUNT BUNDLE (prevents stale data from showing wrong user)
// ============================================================================

/**
 * Monotonic counter incremented on every auth state change.
 * Used to detect and discard stale async responses that started before auth changed.
 */
let _authEpoch = 0;

/**
 * Single-flight promise for account bundle fetch.
 * Prevents multiple parallel fetches of profile/org data.
 */
let _inflightAccount = { key: null, epoch: null, promise: null, startedAt: 0 };

/**
 * Cache for account bundle data.
 * Keyed by authKey (userId:tokenSuffix) to ensure cache is invalidated on user change.
 */
let _accountCache = { key: null, ts: 0, data: null };

/**
 * TTL for account cache in milliseconds.
 * After this time, a fresh fetch will be triggered.
 */
const ACCOUNT_TTL_MS = 60000;
const ACCOUNT_FETCH_TIMEOUT_MS = 8000;
const ACCOUNT_SESSION_TIMEOUT_MS = 2000;
const SESSION_CACHE_MS = 1500;
const GETSESSION_TIMEOUT_MS = 6000;
const RAW_SESSION_COOLDOWN_MS = 750;
const AUTH_GUARD_FOCUS_ENABLED = false;
const AUTH_GUARD_VISIBILITY_ENABLED = false;

/**
 * Generate a unique key for caching based on current session.
 * Changes when user or access token changes.
 */
function getAuthKey(session) {
  if (!session || !session.user || !session.user.id) return 'anon';
  const tokenSuffix = session.access_token ? session.access_token.slice(-12) : '';
  return `${session.user.id}:${tokenSuffix}`;
}

function normalizeUserId(id) {
  const raw = typeof id === 'string' ? id.trim() : '';
  if (!raw || raw === 'undefined' || raw === 'null') return null;
  return raw;
}

function initTabId() {
  if (_tabId) return _tabId;
  const key = '__tp3d_tab';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) {
      _tabId = existing;
      return _tabId;
    }
  } catch {
    // ignore
  }

  let next = '';
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      next = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    }
  } catch {
    // ignore
  }

  if (!next) {
    next = Math.random().toString(36).slice(2, 10);
  }

  next = String(next).padEnd(8, '0').slice(0, 8);
  _tabId = next;

  try {
    sessionStorage.setItem(key, _tabId);
  } catch {
    // ignore
  }

  return _tabId;
}

// Initialize per-tab id as early as possible (before auth init / logs).
initTabId();
try {
  if (typeof console !== 'undefined' && console && typeof console.info === 'function') {
    console.info('[SupabaseClient] Tab id', { tab: getTabId() });
  }
} catch {
  // ignore
}

/**
 * Get current auth epoch (for external use in UI guards).
 */
export function getAuthEpoch() {
  return _authEpoch;
}

export function getCurrentUserId() {
  const u = _authState && _authState.user ? _authState.user : null;
  return u && u.id ? String(u.id) : null;
}

export function getCurrentAuthKey() {
  const s = (_authState && _authState.session) || _session || null;
  return getAuthKey(s);
}

export function getTabId() {
  return initTabId();
}

/**
 * Increment auth epoch and invalidate account cache.
 * Called on any auth state change.
 */
function bumpAuthEpoch(reason = '') {
  _authEpoch++;
  _inflightAccount = { key: null, epoch: null, promise: null, startedAt: 0 }; // Cancel any in-flight fetch
  _accountCache = { key: null, ts: 0, data: null }; // Invalidate cache
  if (debugEnabled()) {
    const reasonNote = reason ? ` (${reason})` : '';
    debugLog('log', '[SupabaseClient] Auth epoch bumped to', _authEpoch + reasonNote);
  }
}

/**
 * Reset account bundle cache + bump auth epoch.
 * Use this on auth changes to prevent stale user/org data.
 */
export function resetAccountBundleCache(reason = 'auth-change') {
  bumpAuthEpoch(reason);
}

export function debugAuthSnapshot() {
  const now = Date.now();
  const inflightAge = _inflightAccount && _inflightAccount.startedAt ? now - _inflightAccount.startedAt : null;
  const cacheAge = _accountCache && _accountCache.ts ? now - _accountCache.ts : null;
  return {
    tabId: getTabId(),
    epoch: _authEpoch,
    status: _authState && _authState.status ? _authState.status : 'unknown',
    userId: getCurrentUserId(),
    authKey: getCurrentAuthKey(),
    inflight: {
      key: _inflightAccount && _inflightAccount.key ? _inflightAccount.key : null,
      epoch: _inflightAccount && Number.isFinite(_inflightAccount.epoch) ? _inflightAccount.epoch : null,
      startedAt: _inflightAccount && _inflightAccount.startedAt ? _inflightAccount.startedAt : null,
      ageMs: inflightAge,
    },
    cache: {
      key: _accountCache && _accountCache.key ? _accountCache.key : null,
      ts: _accountCache && _accountCache.ts ? _accountCache.ts : null,
      ageMs: cacheAge,
    },
  };
}

// ============================================================================
// CROSS-TAB LOGOUT SYNCHRONIZATION
// ============================================================================

let _logoutChannel = null;
let _storageLogoutListener = null;
let _handlingCrossTabLogout = false;

function initCrossTabLogout() {
  // Try BroadcastChannel first (modern browsers)
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      _logoutChannel = new BroadcastChannel('tp3d-auth');

      _logoutChannel.onmessage = event => {
        if (event.data && event.data.type === 'LOGOUT') {
          if (debugEnabled()) debugLog('log', '[SupabaseClient] Cross-tab logout detected via BroadcastChannel');
          handleCrossTabLogout(event.data);
        }
      };

      if (debugEnabled()) debugLog('info', '[SupabaseClient] BroadcastChannel initialized for cross-tab sync');
      return;
    } catch (err) {
      if (debugEnabled()) {
        debugLog('warn', '[SupabaseClient] BroadcastChannel failed, falling back to localStorage:', err);
      }
    }
  }

  // Fallback: Use localStorage events
  _storageLogoutListener = event => {
    if (event.key === 'tp3d-logout-trigger' && event.newValue) {
      if (debugEnabled()) debugLog('log', '[SupabaseClient] Cross-tab logout detected via localStorage');
      try {
        const payload = JSON.parse(event.newValue);
        handleCrossTabLogout(payload);
      } catch {
        handleCrossTabLogout({ timestamp: Date.now() });
      }
    }
  };

  window.addEventListener('storage', _storageLogoutListener);
  if (debugEnabled()) debugLog('info', '[SupabaseClient] localStorage fallback initialized for cross-tab sync');
}

function broadcastLogout() {
  const payload = { type: 'LOGOUT', timestamp: Date.now(), tabId: getTabId() };
  // BroadcastChannel
  if (_logoutChannel) {
    try {
      _logoutChannel.postMessage(payload);
      if (debugEnabled()) debugLog('log', '[SupabaseClient] Logout broadcast via BroadcastChannel');
    } catch (err) {
      if (debugEnabled()) debugLog('warn', '[SupabaseClient] BroadcastChannel postMessage failed:', err);
    }
  }

  // localStorage fallback (triggers storage event in other tabs)
  try {
    localStorage.setItem('tp3d-logout-trigger', JSON.stringify(payload));
    // Clean up immediately to avoid clutter
    setTimeout(() => {
      try {
        localStorage.removeItem('tp3d-logout-trigger');
      } catch (_) {
        /* ignore cleanup errors */
      }
    }, 100);
    if (debugEnabled()) debugLog('log', '[SupabaseClient] Logout broadcast via localStorage');
  } catch (err) {
    if (debugEnabled()) debugLog('warn', '[SupabaseClient] localStorage broadcast failed:', err);
  }
}

function handleCrossTabLogout(payload = {}) {
  // Prevent recursive signOut calls
  if (_handlingCrossTabLogout) return;
  const now = Date.now();
  if (_lastLogoutSignalAt && now - _lastLogoutSignalAt < 2000) return;
  _lastLogoutSignalAt = now;
  if (payload && payload.tabId && payload.tabId === getTabId()) return;
  _handlingCrossTabLogout = true;

  try {
    // Best-effort local signOut; do not await and do NOT broadcast
    try {
      if (_authSignOut) {
        void _authSignOut({ scope: 'local' });
      }
    } catch (_) {
      /* ignore */
    }

    // Clear local session immediately
    _session = null;
    _cachedSession = null;
    _cachedAt = 0;
    _getSessionRawPromise = null;
    _getSessionRawStartedAt = 0;
    _getSessionPromise = null;
    _getUserPromise = null;
    _getUserRawPromise = null;
    _sessionPromise = null;
    updateAuthState({ status: 'signed_out', session: null, user: null });

    // Clear storage
    try {
      clearStorageKeyIfKnown(_client);
      clearLocalAuthStorage();
    } catch (_) {
      /* ignore */
    }

    // Update invalidation timestamp
    _authInvalidatedAt = Date.now();
    bumpAuthEpoch('cross-tab-logout');

    // Dispatch event to app
    try {
      window.dispatchEvent(
        new CustomEvent('tp3d:auth-signed-out', {
          detail: { crossTab: true, source: 'other-tab' },
        })
      );
    } catch (_) {
      /* ignore dispatch errors */
    }
  } finally {
    // Reset flag after a delay to allow re-triggering if needed
    setTimeout(() => {
      _handlingCrossTabLogout = false;
    }, 1000);
  }
}

function debugEnabled() {
  try {
    return window && window.localStorage && window.localStorage.getItem('tp3dDebug') === '1';
  } catch {
    return false;
  }
}

function debugLog(level, message, ...args) {
  if (!debugEnabled()) return;
  const logger =
    typeof console !== 'undefined' && console && typeof console[level] === 'function' ? console[level] : console.log;
  const meta = { tab: getTabId() };
  if (typeof message === 'undefined') {
    logger(meta);
    return;
  }
  if (args.length) {
    logger(message, meta, ...args);
    return;
  }
  logger(message, meta);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeoutReject(promise, ms, label = 'timeout') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      value => {
        clearTimeout(t);
        resolve(value);
      },
      err => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

function requireClient() {
  if (!_client) throw new Error('SupabaseClient not initialized. Call SupabaseClient.init({ url, anonKey }) first.');
  return _client;
}

function getErrorStatus(err) {
  try {
    const s = err && (err.status || err.statusCode);
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function isAuthRevokedError(err) {
  const status = getErrorStatus(err);
  if (status === 401 || status === 403) return true;

  try {
    const code = String(
      err && (err.code || err.error_code || err.errorCode) ? err.code || err.error_code || err.errorCode : ''
    ).toLowerCase();
    if (code === 'user_not_found') return true;

    const msg = String(err && err.message ? err.message : '').toLowerCase();
    if (msg.includes('user_not_found') || msg.includes('user not found')) return true;
    if (msg.includes('jwt')) return true;
    if (msg.includes('token')) return true;
    if (msg.includes('forbidden')) return true;
    if (msg.includes('unauthorized')) return true;
  } catch {
    // ignore
  }

  return false;
}

function dispatchSignedOut(detail) {
  try {
    window.dispatchEvent(new CustomEvent('tp3d:auth-signed-out', { detail: detail || {} }));
  } catch {
    // ignore
  }
}

export function setAuthIntent(type) {
  _authIntent = { type: String(type || ''), ts: Date.now() };
}

export function consumeAuthIntent(type, windowMs = 10000) {
  const now = Date.now();
  if (!_authIntent || !_authIntent.type) return false;
  const matches = _authIntent.type === String(type || '');
  const fresh = now - _authIntent.ts <= windowMs;
  if (matches && fresh) {
    _authIntent = { type: null, ts: 0 };
    return true;
  }
  if (!fresh) _authIntent = { type: null, ts: 0 };
  return false;
}

function isAuthIntentFresh(type, windowMs = 10000) {
  const now = Date.now();
  if (!_authIntent || !_authIntent.type) return false;
  const matches = _authIntent.type === String(type || '');
  const fresh = now - _authIntent.ts <= windowMs;
  return matches && fresh;
}

function updateAuthState(update = {}) {
  const hasSession = Object.prototype.hasOwnProperty.call(update, 'session');
  const hasUser = Object.prototype.hasOwnProperty.call(update, 'user');

  // Track if user/session actually changed to decide if epoch bump is needed
  const prevUserId = _authState.user && _authState.user.id ? _authState.user.id : null;
  const prevSessionToken =
    _authState.session && _authState.session.access_token ? _authState.session.access_token : null;

  if (update.status) {
    _authState.status = update.status;
    if (update.status === 'signed_out') {
      _authInvalidatedAt = Date.now();
      _signedOutCooldownUntil = _authInvalidatedAt + 1500;
    } else if (update.status === 'signed_in') {
      _signedOutCooldownUntil = 0;
    }
  }

  if (hasSession) {
    _authState.session = update.session || null;
    _session = update.session || null;
    if (!hasUser) {
      _authState.user = update.session && update.session.user ? update.session.user : null;
    }
  }

  if (hasUser) {
    _authState.user = update.user || null;
  }

  _authState.updatedAt = Date.now();

  // Bump epoch if user or session token changed (invalidates all cached/inflight data)
  const newUserId = _authState.user && _authState.user.id ? _authState.user.id : null;
  const newSessionToken =
    _authState.session && _authState.session.access_token ? _authState.session.access_token : null;
  const userChanged = prevUserId !== newUserId;
  const tokenChanged = prevSessionToken !== newSessionToken;

  if (userChanged || tokenChanged) {
    bumpAuthEpoch();
  }
}

function clearStorageKeyIfKnown(client) {
  try {
    const key = (client && client.auth && (client.auth.storageKey || client.auth._storageKey)) || null;
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch (_) {
      void 0;
    }
    try {
      sessionStorage.removeItem(key);
    } catch (_) {
      void 0;
    }
  } catch (_) {
    void 0;
  }
}

function getSessionRawSingleFlight() {
  const now = Date.now();
  if (_authState && _authState.status === 'signed_out') {
    const out = { data: { session: null }, error: null };
    _getSessionRawLastResult = out;
    _getSessionRawLastAt = now;
    return Promise.resolve(out);
  }
  if (_signedOutCooldownUntil && now < _signedOutCooldownUntil) {
    const out = { data: { session: null }, error: null };
    _getSessionRawLastResult = out;
    _getSessionRawLastAt = now;
    return Promise.resolve(out);
  }
  if (_authInvalidatedAt && now - _authInvalidatedAt < 1500) {
    const out = { data: { session: null }, error: null };
    _getSessionRawLastResult = out;
    _getSessionRawLastAt = now;
    return Promise.resolve(out);
  }
  if (_getSessionRawPromise) {
    const age = now - (_getSessionRawStartedAt || 0);
    if (age > 4000) {
      if (debugEnabled()) debugLog('warn', '[SupabaseClient] Breaking stale getSession(raw) promise', { age });
      _getSessionRawPromise = null;
      _getSessionRawStartedAt = 0;
    } else {
      return _getSessionRawPromise;
    }
  }
  if (_signOutPromise) return Promise.resolve({ data: { session: null }, error: null });
  if (_getSessionRawLastResult && Date.now() - _getSessionRawLastAt < RAW_SESSION_COOLDOWN_MS) {
    return Promise.resolve(_getSessionRawLastResult);
  }
  try {
    if (typeof document !== 'undefined' && document.hidden) {
      if (debugEnabled()) debugLog('warn', '[SupabaseClient] getSession skipped (tab hidden)');
      // Preserve cached auth state while hidden to avoid false sign-outs.
      const cachedSession = (_authState && _authState.session) || _session || null;
      return Promise.resolve({ data: { session: cachedSession }, error: null });
    }
  } catch {
    // ignore
  }
  const client = requireClient();
  const authGetSession =
    _authGetSession || (client.auth && client.auth.getSession ? client.auth.getSession.bind(client.auth) : null);
  if (!authGetSession) return Promise.resolve({ data: { session: null }, error: new Error('getSession unavailable') });

  const TIMEOUT_MS = 10000;
  const startEpoch = _authEpoch;
  _getSessionRawStartedAt = now;
  _getSessionRawEpoch = startEpoch;
  const p = (async () => {
    let timeoutId = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('getSession timeout')), TIMEOUT_MS);
      });
      const res = await Promise.race([authGetSession(), timeoutPromise]);
      const out = res && res.error ? { data: res.data || null, error: res.error } : res || { data: { session: null }, error: null };
      if (startEpoch !== _authEpoch || (_authState && _authState.status === 'signed_out')) {
        if (debugEnabled()) {
          debugLog('warn', '[SupabaseClient] Ignoring getSession(raw) result due to epoch/status change', {
            startedEpoch: startEpoch,
            currentEpoch: _authEpoch,
            status: _authState && _authState.status ? _authState.status : 'unknown',
          });
        }
        const empty = { data: { session: null }, error: null };
        _getSessionRawLastResult = empty;
        _getSessionRawLastAt = Date.now();
        return empty;
      }
      _getSessionRawLastResult = out;
      _getSessionRawLastAt = Date.now();
      return out;
    } catch (err) {
      if (_authState && _authState.status === 'signed_out') {
        const empty = { data: { session: null }, error: null };
        _getSessionRawLastResult = empty;
        _getSessionRawLastAt = Date.now();
        return empty;
      }
      return { data: null, error: err };
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      _getSessionRawPromise = null;
      _getSessionRawStartedAt = 0;
    }
  })();
  _getSessionRawPromise = p;
  return p;
}

function getUserRawSingleFlight() {
  const now = Date.now();
  if (_authState && _authState.status === 'signed_out') {
    const out = { data: { user: null }, error: null };
    _getUserRawLastResult = out;
    _getUserRawLastAt = now;
    return Promise.resolve(out);
  }
  if (_signedOutCooldownUntil && now < _signedOutCooldownUntil) {
    const out = { data: { user: null }, error: null };
    _getUserRawLastResult = out;
    _getUserRawLastAt = now;
    return Promise.resolve(out);
  }
  if (_authInvalidatedAt && now - _authInvalidatedAt < 1500) {
    const out = { data: { user: null }, error: null };
    _getUserRawLastResult = out;
    _getUserRawLastAt = now;
    return Promise.resolve(out);
  }
  if (_getUserRawPromise) return _getUserRawPromise;
  if (_signOutPromise) return Promise.resolve({ data: { user: null }, error: null });
  if (_getUserRawLastResult && Date.now() - _getUserRawLastAt < RAW_SESSION_COOLDOWN_MS) {
    return Promise.resolve(_getUserRawLastResult);
  }
  try {
    if (typeof document !== 'undefined' && document.hidden) {
      if (debugEnabled()) debugLog('warn', '[SupabaseClient] getUser skipped (tab hidden)');
      // Preserve cached auth state while hidden to avoid false sign-outs.
      const cachedUser = (_authState && _authState.user) || (_session && _session.user) || null;
      return Promise.resolve({ data: { user: cachedUser }, error: null });
    }
  } catch {
    // ignore
  }
  const client = requireClient();
  const authGetUser =
    _authGetUser || (client.auth && client.auth.getUser ? client.auth.getUser.bind(client.auth) : null);
  if (!authGetUser) return Promise.resolve({ data: { user: null }, error: new Error('getUser unavailable') });

  const TIMEOUT_MS = 10000;
  const p = (async () => {
    let timeoutId = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('getUser timeout')), TIMEOUT_MS);
      });
      const res = await Promise.race([authGetUser(), timeoutPromise]);
      if (res && res.error) return { data: res.data || null, error: res.error };
      const out = res || { data: { user: null }, error: null };
      _getUserRawLastResult = out;
      _getUserRawLastAt = Date.now();
      return out;
    } catch (err) {
      return { data: null, error: err };
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      _getUserRawPromise = null;
    }
  })();
  _getUserRawPromise = p;
  return p;
}

export async function getSessionSingleFlightSafe(client, { force = false } = {}) {
  const now = Date.now();
  if (!force && _authState && _authState.status === 'signed_out') return null;
  if (!force && _signedOutCooldownUntil && now < _signedOutCooldownUntil) return null;
  if (!force && _authInvalidatedAt && now - _authInvalidatedAt < 1500) return null;

  const c = client || requireClient();

  // 1) quick cache for UI
  if (!force && _cachedSession && now - _cachedAt < SESSION_CACHE_MS) {
    return _cachedSession;
  }

  // 2) if tab is hidden, avoid thundering herd
  let hidden = false;
  try {
    hidden = typeof document !== 'undefined' && document.hidden === true;
  } catch {
    hidden = false;
  }
  if (hidden && _cachedSession && !force) {
    return _cachedSession;
  }

  // 3) true single-flight
  if (_sessionPromise) return _sessionPromise;

  _sessionPromise = (async () => {
    try {
      const raw = _authGetSession || (c.auth && c.auth.__tp3dOriginalGetSession) || null;
      if (!raw) return null;
      const result = await withTimeoutReject(raw(), GETSESSION_TIMEOUT_MS, 'getSession timeout');
      const session = (result && result.data && result.data.session) || null;
      _cachedSession = session;
      _cachedAt = Date.now();
      return session;
    } finally {
      _sessionPromise = null;
    }
  })();

  return _sessionPromise;
}

export function getSessionSingleFlight() {
  if (_getSessionPromise) return _getSessionPromise;
  if (_signOutPromise) return Promise.resolve({ session: null, user: null });
  if (_authState && _authState.status === 'signed_out' && !_session) {
    return Promise.resolve({ session: null, user: null });
  }

  const client = requireClient();

  const p = (async () => {
    try {
      const session = await getSessionSingleFlightSafe(client);
      const user = session && session.user ? session.user : null;
      updateAuthState({ status: session ? 'signed_in' : 'signed_out', session, user });
      return { session, user };
    } catch (err) {
      if (debugEnabled()) {
        debugLog('error', '[SupabaseClient] getSession failed:', err && err.message ? err.message : err);
      }
      if (String(err && err.message ? err.message : '').includes('timeout')) {
        _authCooldownUntil = Date.now() + 2000;
      }
      throw err;
    } finally {
      _getSessionPromise = null;
    }
  })();

  _getSessionPromise = p;
  return p;
}

export async function validateSessionSoft(client) {
  const c = client || requireClient();
  // attempt 1
  let session = await getSessionSingleFlightSafe(c);
  if (session) return { ok: true, session };

  // hidden tab? do not escalate
  try {
    if (typeof document !== 'undefined' && document.hidden) {
      return { ok: false, session: null, reason: 'hidden-tab' };
    }
  } catch {
    // ignore
  }

  // retry once (covers brief stalls / token refresh timing)
  await sleep(350);
  session = await getSessionSingleFlightSafe(c, { force: true });
  if (session) return { ok: true, session };

  // still null. do NOT sign out here.
  return { ok: false, session: null, reason: 'no-session-after-retry' };
}

export function getUserSingleFlight() {
  if (_getUserPromise) return _getUserPromise;
  if (_signOutPromise) return Promise.resolve(null);

  try {
    if (typeof document !== 'undefined' && document.hidden) {
      if (debugEnabled()) debugLog('warn', '[SupabaseClient] getUser skipped (tab hidden)');
      const cachedUser = getUser();
      return Promise.resolve(cachedUser);
    }
  } catch {
    // ignore
  }

  requireClient();

  const p = (async () => {
    try {
      const res = await getUserRawSingleFlight();
      if (res && res.error) throw res.error;
      const user = res && res.data && res.data.user ? res.data.user : null;
      updateAuthState({ user });
      return user;
    } catch (err) {
      if (debugEnabled()) {
        debugLog('error', '[SupabaseClient] getUser failed:', err && err.message ? err.message : err);
      }
      if (String(err && err.message ? err.message : '').includes('timeout')) {
        _authCooldownUntil = Date.now() + 2000;
      }
      throw err;
    } finally {
      _getUserPromise = null;
    }
  })();

  _getUserPromise = p;
  return p;
}

function forceLocalSignedOut({ reason = 'auth-invalid', status = null } = {}) {
  const now = Date.now();
  if (_authInvalidatedAt && now - _authInvalidatedAt < 1500) return;
  _authInvalidatedAt = now;

  try {
    _session = null;
  } catch {
    // ignore
  }
  _cachedSession = null;
  _cachedAt = 0;
  updateAuthState({ status: 'signed_out', session: null, user: null });

  // Best-effort local sign out (does not require network)
  try {
    if (_authSignOut) void _authSignOut({ scope: 'local' });
  } catch {
    // ignore
  }

  // Clear local auth keys even if signOut cannot run
  try {
    clearLocalAuthStorage();
  } catch {
    // ignore
  }

  if (debugEnabled()) {
    try {
      debugLog('warn', '[SupabaseClient] forceLocalSignedOut', { reason, status });
    } catch {
      // ignore
    }
  }

  dispatchSignedOut({ offline: false, forced: true, reason, status });
}

async function validateSessionOrSignOut({ source = 'unknown', silent = true } = {}) {
  const client = _client;
  if (!client) return true;

  // Offline should not force a sign-out
  try {
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
  } catch {
    // ignore
  }

  // Avoid overlapping validation while signOut or auth reads are in-flight
  if (_signOutPromise) return true;
  if (_getSessionPromise || _getUserPromise || _getSessionRawPromise || _getUserRawPromise) return true;
  if (_authState && _authState.status === 'signed_out') return true;

  // Respect temporary cooldown after a stuck request
  if (_authCooldownUntil && Date.now() < _authCooldownUntil) return true;

  // Avoid stacking hidden-tab validations; focus/visibility will retry.
  try {
    if (typeof document !== 'undefined' && document.hidden) return true;
  } catch {
    // ignore
  }

  // Soft session validation: retry once and do not sign out on first null.
  let soft = null;
  try {
    soft = await validateSessionSoft(client);
  } catch {
    soft = { ok: false, session: null, reason: 'error' };
  }

  if (!soft || !soft.ok) {
    return true;
  }

  if (soft && soft.session) {
    _session = soft.session;
    updateAuthState({
      status: 'signed_in',
      session: soft.session,
      user: soft.session && soft.session.user ? soft.session.user : null,
    });
  } else {
    return true;
  }

  try {
    const u = await getUserSingleFlight();
    if (!u || !u.id) {
      return true;
    }

    return true;
  } catch (err) {
    if (isAuthRevokedError(err)) {
      forceLocalSignedOut({ reason: `auth-revoked:${source}`, status: getErrorStatus(err) });
      return false;
    }
    if (!silent) throw err;
    return true;
  }
}

function installAuthGuard() {
  if (_authGuardInstalled) return;
  _authGuardInstalled = true;

  const onFocus = () => {
    try {
      if (document && document.hidden) return;
    } catch {
      // ignore
    }
    void validateSessionOrSignOut({ source: 'focus', silent: true });
  };

  const onVisibility = () => {
    try {
      if (document && document.visibilityState === 'visible') {
        if (_visibilityValidateTimer) window.clearTimeout(_visibilityValidateTimer);
        _visibilityValidateTimer = window.setTimeout(() => {
          _visibilityValidateTimer = null;
          void validateSessionOrSignOut({ source: 'visibility', silent: true });
        }, 150);
      }
    } catch {
      // ignore
    }
  };

  if (AUTH_GUARD_FOCUS_ENABLED) {
    try {
      window.addEventListener('focus', onFocus, { passive: true });
    } catch {
      // ignore
    }
  }

  if (AUTH_GUARD_VISIBILITY_ENABLED) {
    try {
      document.addEventListener('visibilitychange', onVisibility, { passive: true });
    } catch {
      // ignore
    }
  }

  // Poll to catch cases like: user deleted in dashboard while a cached session exists
  try {
    _authGuardTimer = window.setInterval(() => {
      try {
        if (document && document.hidden) return;
      } catch {
        // ignore
      }
      if (_signOutPromise) return;
      void validateSessionOrSignOut({ source: 'interval', silent: true });
    }, 60 * 1000);
  } catch {
    _authGuardTimer = null;
  }

  void validateSessionOrSignOut({ source: 'install', silent: true });
}

function patchAuthGetSessionSingleFlight(client) {
  try {
    if (!client || !client.auth) return;
    if (client.auth.__tp3dGetSessionPatched) return;

    _authGetSession = _authGetSession || (client.auth.getSession ? client.auth.getSession.bind(client.auth) : null);
    _authGetUser = _authGetUser || (client.auth.getUser ? client.auth.getUser.bind(client.auth) : null);
    _authSignOut = _authSignOut || (client.auth.signOut ? client.auth.signOut.bind(client.auth) : null);
    _authSignInWithPassword = _authSignInWithPassword || (client.auth.signInWithPassword
      ? client.auth.signInWithPassword.bind(client.auth)
      : null);

    if (_authGetSession) {
      // Expose originals for debugging / diagnostics
      client.auth.__tp3dOriginalGetSession = _authGetSession;
      client.auth.__tp3dRawGetSession = _authGetSession;

      // Patch getSession so ALL callers share the same single-flight gate
      client.auth.getSession = async () => {
        try {
          const session = await getSessionSingleFlightSafe(client, { force: false });
          return { data: { session }, error: null };
        } catch (err) {
          return { data: { session: null }, error: err };
        }
      };
    }

    client.auth.__tp3dGetSessionPatched = true;
  } catch {
    // ignore
  }
}

// ============================================================================
// SECTION: PUBLIC API
// ============================================================================

export function init({ url, anonKey }) {
  if (_client) return Promise.resolve(_client);
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const u = String(url || '').trim();
      const k = String(anonKey || '').trim();
      if (!u || !k) throw new Error('Supabase config missing (url/anonKey).');

      if (debugEnabled()) debugLog('info', '[SupabaseClient] init start');

      const globalSupabase = typeof window !== 'undefined' ? window.supabase : null;
      if (!globalSupabase || typeof globalSupabase.createClient !== 'function') {
        throw new Error('Supabase CDN not loaded (window.supabase.createClient missing).');
      }

      if (_client) return _client;
      _client = globalSupabase.createClient(u, k);
      try {
        if (typeof window !== 'undefined') window.__TP3D_SUPABASE_CLIENT = _client;
      } catch {
        // ignore
      }
      try {
        if (_client && _client.auth && !_client.__tp3dAuthWrapped) {
          _authGetSession = _client.auth.getSession ? _client.auth.getSession.bind(_client.auth) : null;
          _authGetUser = _client.auth.getUser ? _client.auth.getUser.bind(_client.auth) : null;
          _authSignOut = _client.auth.signOut ? _client.auth.signOut.bind(_client.auth) : null;
          _authSignInWithPassword = _client.auth.signInWithPassword
            ? _client.auth.signInWithPassword.bind(_client.auth)
            : null;
          patchAuthGetSessionSingleFlight(_client);
          if (_authGetUser) _client.auth.getUser = () => getUserRawSingleFlight();
          if (_authSignOut) {
            _client.auth.signOut = options => signOut(options || {});
          }
          if (_authSignInWithPassword) {
            _client.auth.signInWithPassword = async (params = {}) => {
              setAuthIntent('signIn');
              return signIn(params.email, params.password);
            };
          }
          _client.__tp3dAuthWrapped = true;
        }
      } catch {
        // ignore
      }

      try {
        const sData = await getSessionSingleFlight();
        _session = sData && sData.session ? sData.session : null;
        updateAuthState({
          status: _session ? 'signed_in' : 'signed_out',
          session: _session,
          user: _session && _session.user ? _session.user : null,
        });
      } catch {
        _session = null;
        updateAuthState({ status: 'signed_out', session: null, user: null });
      }
      // If a cached session exists but the user was deleted/banned server-side,
      // Supabase may still read it from storage. Validate it now.
      if (_session) {
        await validateSessionOrSignOut({ source: 'init', silent: true });
      }

      _client.auth.onAuthStateChange((event, nextSession) => {
        _session = nextSession || null;
        updateAuthState({
          status: nextSession ? 'signed_in' : 'signed_out',
          session: nextSession || null,
          user: nextSession && nextSession.user ? nextSession.user : null,
        });
        if (debugEnabled()) {
          const nextUserId =
            nextSession && nextSession.user && nextSession.user.id ? String(nextSession.user.id) : null;
          const hasToken = Boolean(nextSession && nextSession.access_token);
          debugLog('info', '[SupabaseClient] Auth event', {
            tab: getTabId(),
            event,
            epoch: _authEpoch,
            userId: nextUserId,
            hasToken,
          });
        }
        if (
          event === 'SIGNED_IN' ||
          event === 'SIGNED_OUT' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED'
        ) {
          resetAccountBundleCache(event);
        }
      });
      installAuthGuard();

      // Initialize cross-tab logout synchronization
      initCrossTabLogout();

      if (debugEnabled()) debugLog('info', '[SupabaseClient] init success');
      return _client;
    } catch (err) {
      if (debugEnabled()) {
        debugLog('info', '[SupabaseClient] init failed:', err && err.message ? String(err.message) : String(err));
      }
      _initPromise = null;
      _client = null;
      _session = null;
      throw err;
    }
  })();

  return _initPromise;
}

export function getClient() {
  return requireClient();
}

export function getSession() {
  requireClient();
  return (_authState && _authState.session) || null;
}

export function getUser() {
  const u = _authState && _authState.user ? _authState.user : null;
  return u && u.id ? u : null;
}

export function getAuthState() {
  return { ..._authState };
}

export async function awaitAuthReady({ timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + (Number.isFinite(timeoutMs) ? Number(timeoutMs) : 5000);

  const snapshot = () => {
    const status = _authState && _authState.status ? _authState.status : 'unknown';
    const userId = _authState && _authState.user && _authState.user.id ? String(_authState.user.id) : null;
    const token =
      _authState && _authState.session && _authState.session.access_token ? _authState.session.access_token : null;
    return { status, userId, token };
  };

  const isReady = snap => Boolean(snap.status === 'signed_in' && snap.userId && snap.token);

  const initial = snapshot();
  if (isReady(initial)) return { ok: true, reason: 'ready' };
  if (initial.status === 'signed_out') return { ok: false, reason: 'signed_out' };

  return new Promise(resolve => {
    let timer = null;
    let interval = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
      timer = null;
      interval = null;
    };

    const tick = () => {
      const snap = snapshot();
      if (isReady(snap)) {
        cleanup();
        resolve({ ok: true, reason: 'ready' });
        return;
      }
      if (snap.status === 'signed_out') {
        cleanup();
        resolve({ ok: false, reason: 'signed_out' });
        return;
      }
      if (Date.now() >= deadline) {
        cleanup();
        resolve({ ok: false, reason: 'timeout' });
      }
    };

    interval = setInterval(tick, 50);
    timer = setTimeout(tick, Math.max(0, deadline - Date.now() + 5));
    tick();
  });
}

// --------------------------------------------------------------------------
// USER RESOLUTION HELPERS
// --------------------------------------------------------------------------

async function getAuthedUserId() {
  requireClient();

  const ready = await awaitAuthReady({ timeoutMs: 2000 });
  if (!ready.ok) return null;

  // 1) Fast path: wrapper session
  try {
    const s = _session;
    const id = s && s.user && s.user.id ? normalizeUserId(s.user.id) : null;
    if (id) return id;
  } catch {
    // ignore
  }

  // 2) Pull from supabase-js session store
  try {
    const sData = await getSessionSingleFlight();
    if (sData && sData.session) {
      _session = sData.session;
      const id = sData.session.user && sData.session.user.id ? normalizeUserId(sData.session.user.id) : null;
      if (id) return id;
    }
  } catch {
    // ignore
  }

  // 3) Last resort: validate token with server
  try {
    const u = await getUserSingleFlight();
    if (u && u.id) return u.id;
  } catch {
    // ignore
  }

  return null;
}

async function requireUserId() {
  const uid = await getAuthedUserId();
  if (!uid) throw new Error('Not authenticated');
  return uid;
}

export function onAuthStateChange(handler) {
  const client = requireClient();
  const cb = typeof handler === 'function' ? handler : () => {};
  const { data } = client.auth.onAuthStateChange((event, session) => cb(event, session));
  const sub = data && data.subscription ? data.subscription : null;
  return () => {
    try {
      sub && sub.unsubscribe && sub.unsubscribe();
    } catch (_e) {
      /* ignore unsubscribe errors */
    }
  };
}

export async function signIn(email, password) {
  const client = requireClient();
  setAuthIntent('signIn');
  const authSignIn =
    _authSignInWithPassword ||
    (client.auth && client.auth.signInWithPassword ? client.auth.signInWithPassword.bind(client.auth) : null);
  if (!authSignIn) throw new Error('signInWithPassword unavailable');
  const { data, error } = await authSignIn({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  if (error) throw error;
  _session = data && data.session ? data.session : _session;
  updateAuthState({
    status: _session ? 'signed_in' : 'signed_out',
    session: _session,
    user: _session && _session.user ? _session.user : null,
  });
  return data;
}

export async function signUp(email, password) {
  const client = requireClient();
  setAuthIntent('signIn');
  const { data, error } = await client.auth.signUp({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  if (error) throw error;
  _session = data && data.session ? data.session : _session;
  updateAuthState({
    status: _session ? 'signed_in' : 'signed_out',
    session: _session,
    user: _session && _session.user ? _session.user : null,
  });
  return data;
}

/**
 * Helper function to extract project ref from Supabase URL
 * @param {string} url - Supabase URL
 * @returns {string|null} - Project ref or null
 */
function getProjectRef(url) {
  try {
    const match = String(url || '').match(/https:\/\/([^.]+)\.supabase\.co/);
    return match && match[1] ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Clear local auth storage (localStorage and sessionStorage)
 * Removes all Supabase auth keys for this project
 */
function clearLocalAuthStorage() {
  try {
    const client = _client;
    if (!client) return;

    // Try several possible url properties on the client object
    const possibleUrl =
      client.supabaseUrl ||
      client.url ||
      client.supabaseUrl ||
      (client && client._getUrl && typeof client._getUrl === 'function' ? client._getUrl() : null);
    if (!possibleUrl) return;

    const projectRef = getProjectRef(possibleUrl);
    if (!projectRef) {
      if (debugEnabled()) debugLog('warn', '[SupabaseClient] clearLocalAuthStorage: could not extract project ref');
      return;
    }

    // Clear from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      const lsKeys = Object.keys(window.localStorage);
      for (const key of lsKeys) {
        if (key.startsWith('sb-') && key.includes(projectRef)) {
          window.localStorage.removeItem(key);
          if (debugEnabled()) debugLog('info', `[SupabaseClient] removed localStorage key: ${key}`);
        }
      }
    }

    // Clear from sessionStorage
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const ssKeys = Object.keys(window.sessionStorage);
      for (const key of ssKeys) {
        if (key.startsWith('sb-') && key.includes(projectRef)) {
          window.sessionStorage.removeItem(key);
          if (debugEnabled()) debugLog('info', `[SupabaseClient] removed sessionStorage key: ${key}`);
        }
      }
    }
  } catch (err) {
    if (debugEnabled()) debugLog('warn', '[SupabaseClient] clearLocalAuthStorage error:', err);
  }
}

export async function signOut(options = {}) {
  // Single-flight: reuse the in-flight promise to avoid parallel sign-outs
  if (_signOutPromise) return _signOutPromise;

  const client = requireClient();
  if (!_session && !(_authState && _authState.session)) {
    updateAuthState({ status: 'signed_out', session: null, user: null });
    return Promise.resolve({ ok: true, skipped: true, offline: false });
  }
  const authSignOut = _authSignOut;

  // Support both { global: true } and { scope: 'global' } formats
  let global = Boolean(options.global);
  if (options.scope === 'global') global = true;
  if (options.scope === 'local') global = false;

  // Default to global scope unless explicitly forced local
  const scope = global ? 'global' : 'local';
  const skipBroadcast = Boolean(options.skipBroadcast);
  const userInitiated = Boolean(options.userInitiated) || isAuthIntentFresh('signOut', 10000);

  const allowOffline = options.allowOffline !== false; // default true

  const isOffline = (() => {
    try {
      return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
    } catch {
      return false;
    }
  })();

  const finalizeLocal = offlineFlag => {
    try {
      _session = null;
    } catch (_) {
      void 0;
    }
    _cachedSession = null;
    _cachedAt = 0;
    _getSessionRawPromise = null;
    _getSessionRawStartedAt = 0;
    _getSessionPromise = null;
    _getUserPromise = null;
    _getUserRawPromise = null;
    _sessionPromise = null;
    updateAuthState({ status: 'signed_out', session: null, user: null });

    // Clear any known supabase storage key (defensive)
    clearStorageKeyIfKnown(client);

    // Clear project sb-* keys
    try {
      clearLocalAuthStorage();
    } catch (_) {
      void 0;
    }

    _authInvalidatedAt = Date.now();
    bumpAuthEpoch('local-logout');

    // Notify the app shell
    try {
      window.dispatchEvent(
        new CustomEvent('tp3d:auth-signed-out', {
          detail: { offline: Boolean(offlineFlag), globalRequested: global },
        })
      );
    } catch (_) {
      void 0;
    }
  };

  const runWithTimeout = (p, timeoutMs) => {
    if (!p || typeof p.then !== 'function') return Promise.resolve(false);
    const ms = Number.isFinite(timeoutMs) ? Number(timeoutMs) : 800;
    return Promise.race([
      p.then(() => true).catch(() => false),
      new Promise(resolve => {
        window.setTimeout(() => resolve(false), ms);
      }),
    ]).catch(() => false);
  };

  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 800;

  _signOutPromise = (async () => {
    // OFFLINE: do not attempt global calls; best-effort local signOut, then finalize.
    if (allowOffline && isOffline) {
      try {
        if (authSignOut) await runWithTimeout(authSignOut({ scope: 'local' }), 500);
      } catch {
        // ignore
      }

      finalizeLocal(true);
      // Broadcast logout to other tabs after local cleanup (even if offline)
      if (!skipBroadcast && userInitiated) {
        broadcastLogout();
      }
      return { ok: true, offline: true };
    }

    // ONLINE: single Supabase signOut call (no parallel local+global)
    let signOutOk = false;
    try {
      if (authSignOut) signOutOk = Boolean(await runWithTimeout(authSignOut({ scope }), timeoutMs));
    } catch {
      signOutOk = false;
    }

    // Now clear local state/storage and dispatch our own event.
    finalizeLocal(false);

    // Broadcast logout to other tabs after local cleanup
    if (!skipBroadcast && userInitiated) {
      broadcastLogout();
    }

    return { ok: signOutOk, offline: false };
  })();

  // Always clear the guard after this attempt settles
  _signOutPromise = _signOutPromise.finally(() => {
    _signOutPromise = null;
  });

  return _signOutPromise;
}

export async function refreshSession() {
  requireClient();
  const sData = await getSessionSingleFlight();
  _session = sData && sData.session ? sData.session : null;
  return _session;
}

export async function resendConfirmation(email) {
  const client = requireClient();
  const e = String(email || '').trim();
  if (!e) throw new Error('Email is required.');
  if (!client.auth || typeof client.auth.resend !== 'function') {
    throw new Error('Resend confirmation not supported by this Supabase client.');
  }
  const { error } = await client.auth.resend({ type: 'signup', email: e });
  if (error) throw error;
  return true;
}

export async function getProfile(userId = null) {
  const client = requireClient();
  const uid = normalizeUserId(userId) || normalizeUserId(getCurrentUserId());
  if (!uid) return null;

  const { data, error } = await client.from('profiles').select('*').eq('id', uid).maybeSingle();

  if (error) {
    if (error.code === 'PGRST116' || error.status === 406) return null;
    return null;
  }
  return data || null;
}

/**
 * Get profile status (deletion_status, purge_after) for the current user.
 * Used to check if user is scheduled for deletion or has been banned.
 * Does NOT check actual Supabase auth ban status - only profile table flags.
 * @returns {Promise<Object|null>} Profile status object or null
 */
export async function getMyProfileStatus() {
  const client = requireClient();
  const userId = await getAuthedUserId();
  if (!userId) return null;

  try {
    const { data, error } = await client
      .from('profiles')
      .select('deletion_status, purge_after')
      .eq('id', userId)
      .single();

    if (error) {
      // If profile doesn't exist (deleted user), return null
      if (error.code === 'PGRST116' || error.status === 406) {
        return null;
      }
      throw error;
    }

    return data || null;
  } catch (_) {
    // On error, return null (fail open)
    return null;
  }
}

export async function updateProfile(updates) {
  const client = requireClient();
  const userId = await requireUserId();

  const { data, error } = await client
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserOrganizations() {
  const client = requireClient();
  const userId = await getAuthedUserId();
  if (!userId) return [];

  // 1) Primary path: RPC (preferred when installed)
  try {
    const { data, error } = await client.rpc('get_user_organizations');
    if (!error && Array.isArray(data)) return data;

    // If the RPC exists but RLS blocks it, we still try fallback.
    // If the function truly does not exist, Postgres will raise 42883.
    const code = error && (error.code || error.error_code) ? String(error.code || error.error_code) : '';
    const msg = error && error.message ? String(error.message).toLowerCase() : '';

    const missingFn = code === '42883' || msg.includes('does not exist') || msg.includes('function');
    if (!missingFn) {
      // Still fall through to the fallback query below.
      // Do not throw here; the UI needs orgs even if RPC fails.
    }
  } catch (_e) {
    // Ignore and try fallback
  }

  // 2) Fallback path: query membership + related org row
  // Requires a FK relationship from organization_members.organization_id -> organizations.id
  const { data: rows, error: qErr } = await client
    .from('organization_members')
    .select(
      [
        'id',
        'organization_id',
        'role',
        'joined_at',
        'invited_by',
        `organizations (
          id,
          name,
          slug,
          avatar_url,
          owner_id,
          created_at,
          updated_at,
          phone,
          address_line1,
          address_line2,
          city,
          state,
          postal_code,
          country
        )`,
      ].join(',')
    )
    .eq('user_id', userId);

  if (qErr) {
    // If RLS blocks or table not visible, treat as empty list.
    return [];
  }

  const safe = Array.isArray(rows) ? rows : [];

  // Shape the result to match the RPC output the UI expects:
  // org fields + role + joined_at
  return safe
    .map(r => {
      const orgRel = r.organizations;
      const org = Array.isArray(orgRel) ? orgRel[0] : orgRel;
      return {
        ...(org || { id: r.organization_id }),
        role: r.role || null,
        joined_at: r.joined_at || null,
      };
    })
    .filter(Boolean);
}

/**
 * Get the current user's membership row.
 * Returns null if not logged in or if user has no org membership.
 */
export async function getMyMembership() {
  const client = requireClient();
  const userId = await getAuthedUserId();
  if (!userId) return null;

  const { data, error } = await client
    .from('organization_members')
    .select('id, organization_id, role, joined_at, invited_by')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

/**
 * Get all account data (session, user, profile, orgs) in a single call.
 * Implements single-flight, caching, and epoch validation to prevent:
 * - Multiple parallel fetches
 * - Stale data from showing wrong user after auth change
 * - Crashes when new users have no profile/org
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<Object>} Account bundle with safe defaults
 */
export async function getAccountBundleSingleFlight({ force = false } = {}) {
  const startEpoch = _authEpoch;
  if (_authState && _authState.status === 'signed_out') return null;
  if (_signedOutCooldownUntil && Date.now() < _signedOutCooldownUntil) return null;

  const authReady = await awaitAuthReady({ timeoutMs: 5000 });
  if (!authReady.ok) {
    if (authReady.reason === 'signed_out') {
      return _buildEmptyAccountBundle('No active session');
    }
    return _buildEmptyAccountBundle(`Auth not ready: ${authReady.reason || 'unknown'}`, true);
  }

  // Get current session from memory first (already validated by Supabase)
  let session = _authState.session || _session || null;
  let user = session && session.user ? session.user : _authState.user || null;

  // If no session in memory, try to get one (but don't block forever)
  if (!session) {
    try {
      const sessionWrap = await withTimeout(getSessionSingleFlight(), ACCOUNT_SESSION_TIMEOUT_MS, null);
      if (_authEpoch !== startEpoch) {
        // Auth changed during fetch, return empty bundle
        return _buildEmptyAccountBundle('Auth changed during session fetch', true, null, startEpoch);
      }
      if (sessionWrap.timedOut) {
        return _buildEmptyAccountBundle('Session fetch timeout', true);
      }
      session = sessionWrap && sessionWrap.value && sessionWrap.value.session ? sessionWrap.value.session : null;
      user = session && session.user ? session.user : null;
    } catch {
      session = null;
      user = null;
    }
  }

  // No session = not logged in
  if (!session || !user || !normalizeUserId(user.id)) {
    return _buildEmptyAccountBundle('No active session');
  }

  const authKey = getAuthKey(session);
  const cachedBundle = _accountCache.key === authKey ? _accountCache.data : null;

  // Check cache (unless force refresh requested)
  if (!force && _accountCache.key === authKey && _accountCache.ts > 0) {
    const age = Date.now() - _accountCache.ts;
    if (age < ACCOUNT_TTL_MS && _accountCache.data) {
      if (debugEnabled()) debugLog('log', '[SupabaseClient] Account bundle from cache, age:', age, 'ms');
      return _accountCache.data;
    }
  }

  // Single-flight: return existing promise if one is in-flight
  if (_inflightAccount && _inflightAccount.promise) {
    if (_inflightAccount.key === authKey && _inflightAccount.epoch === startEpoch) {
      if (debugEnabled()) debugLog('log', '[SupabaseClient] Account bundle: reusing in-flight promise');
      return _inflightAccount.promise;
    }
  }

  // Create new fetch promise
  const inflightPromise = (async () => {
    try {
      const userId = normalizeUserId(user.id);
      if (!userId) return _buildEmptyAccountBundle('No active session');

      const cachedProfile = cachedBundle && cachedBundle.profile ? cachedBundle.profile : null;
      const cachedOrgs = cachedBundle && Array.isArray(cachedBundle.orgs) ? cachedBundle.orgs : [];
      const cachedMembership = cachedBundle && cachedBundle.membership ? cachedBundle.membership : null;
      const cachedActiveOrg = cachedBundle && cachedBundle.activeOrg ? cachedBundle.activeOrg : null;

      const profileWrap = await withTimeout(
        getProfile(userId).catch(() => null),
        ACCOUNT_FETCH_TIMEOUT_MS,
        null
      );
      if (_authEpoch !== startEpoch) {
        return _buildEmptyAccountBundle('Auth changed during account fetch', true, authKey, startEpoch);
      }

      const orgsWrap = await withTimeout(
        getUserOrganizations().catch(() => []),
        ACCOUNT_FETCH_TIMEOUT_MS,
        []
      );
      if (_authEpoch !== startEpoch) {
        return _buildEmptyAccountBundle('Auth changed during account fetch', true, authKey, startEpoch);
      }

      const membershipWrap = await withTimeout(
        getMyMembership().catch(() => null),
        ACCOUNT_FETCH_TIMEOUT_MS,
        null
      );
      if (_authEpoch !== startEpoch) {
        return _buildEmptyAccountBundle('Auth changed during account fetch', true, authKey, startEpoch);
      }

      let profileResult = profileWrap.value;
      let orgsResult = orgsWrap.value;
      let membershipResult = membershipWrap.value;
      const hadTimeout = Boolean(profileWrap.timedOut || orgsWrap.timedOut || membershipWrap.timedOut);
      const reasonParts = [];
      let usedCachedOrgs = false;

      if ((profileWrap.timedOut || !profileResult) && cachedProfile) {
        profileResult = cachedProfile;
        reasonParts.push('profile timeout, using cached');
      }

      if ((!Array.isArray(orgsResult) || orgsResult.length === 0 || orgsWrap.timedOut) && cachedOrgs.length > 0) {
        orgsResult = cachedOrgs;
        reasonParts.push('orgs timeout, using cached');
        usedCachedOrgs = true;
      }

      if ((membershipWrap.timedOut || !membershipResult) && cachedMembership) {
        membershipResult = cachedMembership;
        reasonParts.push('membership timeout, using cached');
      }

      // Check epoch again - if auth changed, discard results
      if (_authEpoch !== startEpoch) {
        if (debugEnabled()) debugLog('log', '[SupabaseClient] Account bundle: epoch changed, discarding');
        return _buildEmptyAccountBundle('Auth changed during fetch', true, authKey, startEpoch);
      }

      const currentUserId = getCurrentUserId();
      if (currentUserId && String(currentUserId) !== String(userId)) {
        return _buildEmptyAccountBundle('User changed during fetch', true, authKey, startEpoch);
      }

      // Build safe bundle with defaults for missing data
      const orgsSafe = Array.isArray(orgsResult) ? orgsResult : [];
      const activeOrgSafe = usedCachedOrgs
        ? cachedActiveOrg || (orgsSafe.length > 0 ? orgsSafe[0] : null)
        : orgsSafe.length > 0
          ? orgsSafe[0]
          : null;
      const partial = Boolean(hadTimeout || reasonParts.length > 0);
      const bundle = {
        key: authKey,
        canceled: false,
        epoch: startEpoch,
        session,
        user,
        profile: profileResult || _buildDefaultProfile(user),
        orgs: orgsSafe,
        membership: membershipResult || null,
        activeOrg: activeOrgSafe,
        orgCount: orgsSafe.length,
        activeOrgId: activeOrgSafe && activeOrgSafe.id ? activeOrgSafe.id : null,
        partial,
        reason: reasonParts.join('; '),
        fetchedAt: Date.now(),
      };

      // Cache the result only if it completed without timeouts.
      if (!partial) {
        const liveKey = getCurrentAuthKey();
        if (liveKey === authKey && _authEpoch === startEpoch) {
          _accountCache = { key: authKey, ts: Date.now(), data: bundle };
        }
        if (debugEnabled()) debugLog('log', '[SupabaseClient] Account bundle cached for', authKey);
      } else if (debugEnabled()) {
        debugLog('warn', '[SupabaseClient] Account bundle partial (timeout), not caching');
      }

      return bundle;
    } catch (err) {
      if (debugEnabled()) debugLog('error', '[SupabaseClient] Account bundle fetch error:', err);
      // Return safe empty bundle on error (don't crash)
      return _buildEmptyAccountBundle('Fetch error: ' + (err && err.message ? err.message : 'Unknown'));
    }
  })();

  // Clean up in-flight promise when done
  _inflightAccount = { key: authKey, epoch: startEpoch, promise: inflightPromise, startedAt: Date.now() };

  inflightPromise.finally(() => {
    if (_inflightAccount && _inflightAccount.promise === inflightPromise) {
      _inflightAccount = { key: null, epoch: null, promise: null, startedAt: 0 };
    }
  });

  return inflightPromise;
}

/**
 * Build an empty account bundle with safe defaults.
 * @private
 */
function _buildEmptyAccountBundle(reason = '', canceled = false, keyOverride = null, epochOverride = null) {
  return {
    key: keyOverride || getCurrentAuthKey(),
    canceled,
    epoch: Number.isFinite(epochOverride) ? epochOverride : _authEpoch,
    session: null,
    user: null,
    profile: null,
    orgs: [],
    membership: null,
    activeOrg: null,
    orgCount: 0,
    activeOrgId: null,
    partial: false,
    fetchedAt: Date.now(),
    reason,
  };
}

/**
 * Build a default profile object for users without a profile row.
 * @private
 */
function _buildDefaultProfile(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || '',
    display_name: user.user_metadata && user.user_metadata.display_name ? user.user_metadata.display_name : '',
    first_name: user.user_metadata && user.user_metadata.first_name ? user.user_metadata.first_name : '',
    last_name: user.user_metadata && user.user_metadata.last_name ? user.user_metadata.last_name : '',
    bio: '',
    avatar_url: user.user_metadata && user.user_metadata.avatar_url ? user.user_metadata.avatar_url : '',
    created_at: user.created_at || new Date().toISOString(),
    _isDefault: true, // Flag to indicate this is a default profile
  };
}

function withTimeout(promise, ms, fallback) {
  let timeoutId = null;
  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(() => resolve({ __tp3d_timeout: true }), ms);
  });

  return Promise.race([Promise.resolve(promise), timeoutPromise])
    .then(result => {
      if (timeoutId) clearTimeout(timeoutId);
      if (result && result.__tp3d_timeout) return { value: fallback, timedOut: true };
      return { value: result, timedOut: false };
    })
    .catch(() => {
      if (timeoutId) clearTimeout(timeoutId);
      return { value: fallback, timedOut: false };
    });
}

/**
 * Invalidate the account cache (call when profile/org is updated).
 */
export function invalidateAccountCache() {
  _accountCache = { key: null, ts: 0, data: null };
  _inflightAccount = { key: null, epoch: null, promise: null, startedAt: 0 };
  if (debugEnabled()) debugLog('log', '[SupabaseClient] Account cache invalidated');
}

/**
 * Get a single organization by id.
 * Returns null if not logged in, not found, or blocked by RLS.
 * @param {string} orgId
 * @returns {Promise<Object|null>}
 */
export async function getOrganization(orgId) {
  const client = requireClient();
  const userId = await getAuthedUserId();
  if (!userId) return null;

  const id = String(orgId || '').trim();
  if (!id) return null;

  const { data, error } = await client
    .from('organizations')
    .select(
      'id, name, slug, avatar_url, owner_id, created_at, updated_at, phone, address_line1, address_line2, city, state, postal_code, country'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

/**
 * Get the current user's primary organization.
 * Returns the first organization from getUserOrganizations().
 * @returns {Promise<Object|null>} The organization object or null
 */
export async function getCurrentOrganization() {
  const orgs = await getUserOrganizations();
  if (!orgs || orgs.length === 0) return null;
  return orgs[0];
}

/**
 * Get the current user's role in a specific organization.
 * @param {string} orgId - The organization ID
 * @returns {Promise<string|null>} The role ('owner', 'admin', 'member') or null
 */
export async function getMyOrgRole(orgId) {
  const client = requireClient();
  const userId = await getAuthedUserId();
  if (!userId) return null;

  const { data, error } = await client
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116' || error.status === 406) return null; // No rows returned or Not Acceptable
    throw error;
  }

  return data ? data.role : null;
}

/**
 * Update organization details.
 * Only owners/admins can update organizations (enforced by RLS).
 * @param {string} orgId - The organization ID
 * @param {Object} updates - Fields to update (name, phone, address fields, etc.)
 * @returns {Promise<Object>} The updated organization
 */
export async function updateOrganization(orgId, updates) {
  const client = requireClient();
  await requireUserId();

  const { data, error } = await client
    .from('organizations')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orgId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Upload a user avatar to storage bucket 'avatars'.
 * @param {File} file - The image file to upload
 * @returns {Promise<string>} The public URL of the uploaded avatar
 */
export async function uploadAvatar(file) {
  const client = requireClient();
  const userId = await requireUserId();

  // Validate file type
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    throw new Error('Invalid file type. Please use PNG, JPG, or WEBP.');
  }

  // Validate file size (2MB)
  const maxSize = 2 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error('File size must be less than 2MB.');
  }

  // Delete old avatar files first (to ensure clean replacement)
  try {
    const { data: files } = await client.storage.from('avatars').list(userId);

    if (files && files.length > 0) {
      const filePaths = files.map(f => `${userId}/${f.name}`);
      await client.storage.from('avatars').remove(filePaths);
    }
  } catch (_) {
    /* ignore storage list/remove errors */
  }

  // Get file extension
  const ext = file.name.split('.').pop() || 'png';
  const filePath = `${userId}/avatar.${ext}`;

  // Upload to storage
  const { error } = await client.storage.from('avatars').upload(filePath, file, {
    cacheControl: '3600',
    upsert: true,
  });

  if (error) throw error;

  // Get public URL
  const { data: urlData } = client.storage.from('avatars').getPublicUrl(filePath);

  return urlData.publicUrl;
}

/**
 * Delete the user's avatar from storage.
 * @returns {Promise<boolean>}
 */
export async function deleteAvatar() {
  const client = requireClient();
  const userId = await requireUserId();

  // List all files in user's folder
  const { data: files, error: listError } = await client.storage.from('avatars').list(userId);

  if (listError) throw listError;

  // Delete all avatar files
  if (files && files.length > 0) {
    const filePaths = files.map(f => `${userId}/${f.name}`);
    const { error: deleteError } = await client.storage.from('avatars').remove(filePaths);

    if (deleteError) throw deleteError;
  }

  return true;
}

/**
 * Request account deletion
 * This calls an Edge Function that:
 * 1. Performs global signout server-side
 * 2. Sets deletion_status='requested'
 * 3. Removes organization memberships
 * 4. Disables login
 *
 * After this succeeds, the client should call signOut({ global: true, allowOffline: true })
 * and reload the page.
 *
 * @returns {Promise<{ ok: boolean, inferred?: boolean, reason?: string, data?: any }>} - Result payload
 */
export async function requestAccountDeletion() {
  // Guard: do not attempt Edge Function calls while offline
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    const e = new Error('You are offline. Reconnect to delete your account.');
    /** @type {any} */ (e).code = 'OFFLINE';
    throw e;
  }

  const client = requireClient();
  if (debugEnabled()) debugLog('info', '[SupabaseClient] requestAccountDeletion start');

  // Helper: after a deletion request, auth may be revoked mid-flight.
  // If we can no longer reach authed endpoints, we treat that as success.
  async function authLooksRevoked() {
    try {
      // getUser() validates the access token with the server.
      // After the Edge Function bans/signs-out the user, this will commonly return 401.
      const u = await getUserSingleFlight();
      if (!u || !u.id) return true;
      return false;
    } catch {
      return true;
    }
  }

  let data = null;
  let error = null;

  try {
    const res = await client.functions.invoke('request-account-deletion', {
      method: 'POST',
      body: {},
    });
    data = res ? res.data : null;
    error = res ? res.error : null;
  } catch (err) {
    // Supabase may throw in some environments; normalize to { error }
    data = null;
    error = err;
  }

  // Debug (only when tp3dDebug=1)
  if (debugEnabled()) {
    try {
      const st = error && Number.isFinite(error.status) ? error.status : null;
      const msg = error && error.message ? String(error.message) : '';
      debugLog('info', '[SupabaseClient] requestAccountDeletion result', { status: st, msg, data });
    } catch {
      // ignore
    }
  }

  // No error: treat as success.
  // Some Edge Functions return an empty body even on success.
  if (!error) {
    if (data && typeof data === 'object') {
      // Explicit success
      if (data.ok === true || data.success === true) return data;

      // Explicit failure (but may still have revoked auth already)
      if (data.ok === false || data.success === false || data.error) {
        const revoked = await authLooksRevoked();
        if (revoked) return { ok: true, inferred: true, reason: 'auth-revoked', data };
        throw new Error(data.error || data.message || 'Deletion request failed');
      }

      // Unknown payload shape -> assume success
      return { ok: true };
    }

    // Empty payload -> assume success
    return { ok: true };
  }

  // Error path: banning / global signout can revoke auth during the request.
  const status = Number.isFinite(error.status) ? error.status : null;
  const msg = String(error && error.message ? error.message : '');

  // If we got 401/403, it often means the function ran and then auth got revoked.
  if (status === 401 || status === 403) {
    return { ok: true, inferred: true, reason: 'http-' + status };
  }

  // Some environments surface this as a generic "non-2xx" or network error.
  if (msg.toLowerCase().includes('non-2xx')) {
    const revoked = await authLooksRevoked();
    if (revoked) return { ok: true, inferred: true, reason: 'non-2xx-auth-revoked' };
  }

  throw error;
}

// ============================================================================
// SECTION: DEV CONSOLE HOOKS (optional)
// ============================================================================

try {
  // Expose a stable API for overlays and dev console.
  // Some parts of the app reference a global `SupabaseClient` object.
  const api = {
    init,
    getClient,
    getSession,
    getUser,
    getAuthState,
    getAuthEpoch,
    getCurrentUserId,
    getCurrentAuthKey,
    getTabId,
    awaitAuthReady,
    getSessionSingleFlight,
    getSessionSingleFlightSafe,
    getUserSingleFlight,
    getAccountBundleSingleFlight,
    validateSessionSoft,
    resetAccountBundleCache,
    invalidateAccountCache,
    debugAuthSnapshot,
    setAuthIntent,
    consumeAuthIntent,
    onAuthStateChange,
    signIn,
    signUp,
    signOut,
    refreshSession,
    resendConfirmation,
    getProfile,
    getMyProfileStatus,
    updateProfile,
    getUserOrganizations,
    getMyMembership,
    getOrganization,
    getCurrentOrganization,
    getMyOrgRole,
    updateOrganization,
    uploadAvatar,
    deleteAvatar,
    requestAccountDeletion,
  };

  if (typeof window !== 'undefined') {
    // 1) Canonical dev API
    window.__TP3D_SUPABASE_API = window.__TP3D_SUPABASE_API || {};
    Object.assign(window.__TP3D_SUPABASE_API, api);

    // 2) Common alias used during debugging
    window.__TP3D_SUPABASE = window.__TP3D_SUPABASE || {};
    Object.assign(window.__TP3D_SUPABASE, api);

    // 3) Backward-compatible global used by overlays
    window.SupabaseClient = window.SupabaseClient || {};
    Object.assign(window.SupabaseClient, api);
  }
} catch {
  // ignore
}
