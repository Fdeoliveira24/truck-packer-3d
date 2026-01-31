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
          if (debugEnabled()) console.log('[SupabaseClient] Cross-tab logout detected via BroadcastChannel');
          handleCrossTabLogout();
        }
      };

      if (debugEnabled()) console.info('[SupabaseClient] BroadcastChannel initialized for cross-tab sync');
      return;
    } catch (err) {
      if (debugEnabled()) console.warn('[SupabaseClient] BroadcastChannel failed, falling back to localStorage:', err);
    }
  }

  // Fallback: Use localStorage events
  _storageLogoutListener = event => {
    if (event.key === 'tp3d-logout-trigger' && event.newValue) {
      if (debugEnabled()) console.log('[SupabaseClient] Cross-tab logout detected via localStorage');
      handleCrossTabLogout();
    }
  };

  window.addEventListener('storage', _storageLogoutListener);
  if (debugEnabled()) console.info('[SupabaseClient] localStorage fallback initialized for cross-tab sync');
}

function broadcastLogout() {
  // BroadcastChannel
  if (_logoutChannel) {
    try {
      _logoutChannel.postMessage({ type: 'LOGOUT', timestamp: Date.now() });
      if (debugEnabled()) console.log('[SupabaseClient] Logout broadcast via BroadcastChannel');
    } catch (err) {
      if (debugEnabled()) console.warn('[SupabaseClient] BroadcastChannel postMessage failed:', err);
    }
  }

  // localStorage fallback (triggers storage event in other tabs)
  try {
    const timestamp = Date.now();
    localStorage.setItem('tp3d-logout-trigger', String(timestamp));
    // Clean up immediately to avoid clutter
    setTimeout(() => {
      try {
        localStorage.removeItem('tp3d-logout-trigger');
      } catch (_) {
        /* ignore cleanup errors */
      }
    }, 100);
    if (debugEnabled()) console.log('[SupabaseClient] Logout broadcast via localStorage');
  } catch (err) {
    if (debugEnabled()) console.warn('[SupabaseClient] localStorage broadcast failed:', err);
  }
}

function handleCrossTabLogout() {
  // Prevent recursive signOut calls
  if (_handlingCrossTabLogout) return;
  _handlingCrossTabLogout = true;

  try {
    // Clear local session immediately
    _session = null;

    // Clear storage
    try {
      clearLocalAuthStorage();
    } catch (_) {
      /* ignore */
    }

    // Update invalidation timestamp
    _authInvalidatedAt = Date.now();

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

function forceLocalSignedOut({ reason = 'auth-invalid', status = null } = {}) {
  const now = Date.now();
  if (_authInvalidatedAt && now - _authInvalidatedAt < 1500) return;
  _authInvalidatedAt = now;

  try {
    _session = null;
  } catch {
    // ignore
  }

  // Best-effort local sign out (does not require network)
  try {
    const client = _client;
    if (client && client.auth && typeof client.auth.signOut === 'function') {
      // supabase-js v2 supports local scope
      void client.auth.signOut({ scope: 'local' });
    }
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
      console.warn('[SupabaseClient] forceLocalSignedOut', { reason, status });
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

  // Do not rely only on the wrapper’s `_session`.
  // supabase-js may have a stored session even if `_session` is null.
  try {
    const { data: sData, error: sErr } = await client.auth.getSession();
    if (!sErr && sData && sData.session) {
      _session = sData.session;
    }
  } catch {
    // ignore
  }

  // If there is still no session, nothing to validate.
  if (!_session) return true;

  try {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (isAuthRevokedError(error)) {
        forceLocalSignedOut({ reason: `auth-revoked:${source}`, status: getErrorStatus(error) });
        return false;
      }
      if (!silent) throw error;
      return true;
    }

    const u = data && data.user ? data.user : null;
    if (!u || !u.id) {
      forceLocalSignedOut({ reason: `no-user:${source}`, status: 401 });
      return false;
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
    void validateSessionOrSignOut({ source: 'focus', silent: true });
  };

  const onVisibility = () => {
    try {
      if (document && document.visibilityState === 'visible') {
        void validateSessionOrSignOut({ source: 'visibility', silent: true });
      }
    } catch {
      // ignore
    }
  };

  try {
    window.addEventListener('focus', onFocus, { passive: true });
  } catch {
    // ignore
  }

  try {
    document.addEventListener('visibilitychange', onVisibility, { passive: true });
  } catch {
    // ignore
  }

  // Poll to catch cases like: user deleted in dashboard while a cached session exists
  try {
    _authGuardTimer = window.setInterval(() => {
      void validateSessionOrSignOut({ source: 'interval', silent: true });
    }, 60 * 1000);
  } catch {
    _authGuardTimer = null;
  }

  void validateSessionOrSignOut({ source: 'install', silent: true });
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

      if (debugEnabled()) console.info('[SupabaseClient] init start');

      const globalSupabase = typeof window !== 'undefined' ? window.supabase : null;
      if (!globalSupabase || typeof globalSupabase.createClient !== 'function') {
        throw new Error('Supabase CDN not loaded (window.supabase.createClient missing).');
      }

      _client = globalSupabase.createClient(u, k);

      try {
        const { data, error } = await _client.auth.getSession();
        if (error) throw error;
        _session = data && data.session ? data.session : null;
      } catch {
        _session = null;
      }
      // If a cached session exists but the user was deleted/banned server-side,
      // Supabase may still read it from storage. Validate it now.
      if (_session) {
        await validateSessionOrSignOut({ source: 'init', silent: true });
      }

      _client.auth.onAuthStateChange((_event, nextSession) => {
        _session = nextSession || null;
      });
      installAuthGuard();

      // Initialize cross-tab logout synchronization
      initCrossTabLogout();

      if (debugEnabled()) console.info('[SupabaseClient] init success');
      return _client;
    } catch (err) {
      if (debugEnabled()) {
        console.info('[SupabaseClient] init failed:', err && err.message ? String(err.message) : String(err));
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
  return _session;
}

export function getUser() {
  const s = getSession();
  return s && s.user ? s.user : null;
}

export function onAuthStateChange(handler) {
  const client = requireClient();
  const cb = typeof handler === 'function' ? handler : () => {};
  const { data } = client.auth.onAuthStateChange((event, session) => cb(event, session));
  const sub = data && data.subscription ? data.subscription : null;
  return () => {
    try {
      sub && sub.unsubscribe && sub.unsubscribe();
    } catch (e) {
      void 0;
    }
  };
}

export async function signIn(email, password) {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  if (error) throw error;
  _session = data && data.session ? data.session : _session;
  return data;
}

export async function signUp(email, password) {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  if (error) throw error;
  _session = data && data.session ? data.session : _session;
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
      if (debugEnabled()) console.warn('[SupabaseClient] clearLocalAuthStorage: could not extract project ref');
      return;
    }

    // Clear from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      const lsKeys = Object.keys(window.localStorage);
      for (const key of lsKeys) {
        if (key.startsWith('sb-') && key.includes(projectRef)) {
          window.localStorage.removeItem(key);
          if (debugEnabled()) console.info(`[SupabaseClient] removed localStorage key: ${key}`);
        }
      }
    }

    // Clear from sessionStorage
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const ssKeys = Object.keys(window.sessionStorage);
      for (const key of ssKeys) {
        if (key.startsWith('sb-') && key.includes(projectRef)) {
          window.sessionStorage.removeItem(key);
          if (debugEnabled()) console.info(`[SupabaseClient] removed sessionStorage key: ${key}`);
        }
      }
    }
  } catch (err) {
    if (debugEnabled()) console.warn('[SupabaseClient] clearLocalAuthStorage error:', err);
  }
}

export async function signOut(options = {}) {
  const client = requireClient();

  // Support both { global: true } and { scope: 'global' } formats
  let global = Boolean(options.global);
  if (options.scope === 'global') global = true;
  if (options.scope === 'local') global = false;

  const allowOffline = options.allowOffline !== false; // default true

  const isOffline = (() => {
    try {
      return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
    } catch {
      return false;
    }
  })();

  const clearStorageKeyIfKnown = () => {
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
  };

  const finalizeLocal = offlineFlag => {
    try {
      _session = null;
    } catch (_) {
      void 0;
    }

    // Clear any known supabase storage key (defensive)
    clearStorageKeyIfKnown();

    // Clear project sb-* keys
    try {
      clearLocalAuthStorage();
    } catch (_) {
      void 0;
    }

    _authInvalidatedAt = Date.now();

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

  // OFFLINE: do not attempt global calls; best-effort local signOut, then finalize.
  if (allowOffline && isOffline) {
    try {
      await runWithTimeout(client.auth.signOut({ scope: 'local' }), 500);
    } catch {
      // ignore
    }

    finalizeLocal(true);
    return { ok: true, offline: true };
  }

  // ONLINE MULTI-TAB SAFE PATH:
  // Let supabase-js run its own signOut behavior first (includes storage/broadcast work),
  // but never allow it to hang: we only wait up to timeoutMs.

  try {
    const attempts = [];

    // Local sign out attempt (bounded)
    attempts.push(runWithTimeout(client.auth.signOut({ scope: 'local' }), timeoutMs));

    // Global sign out attempt (bounded)
    if (global) {
      attempts.push(runWithTimeout(client.auth.signOut({ scope: 'global' }), timeoutMs));
    }

    // Wait briefly for attempts to run/broadcast, but never hang.
    await Promise.all(attempts);
  } catch {
    // ignore
  }

  // Now clear local state/storage and dispatch our own event.
  finalizeLocal(false);

  // Broadcast logout to other tabs
  broadcastLogout();

  return { ok: true, offline: false };
}

export async function refreshSession() {
  const client = requireClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  _session = data && data.session ? data.session : null;
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
  const uid = userId || (getUser() && getUser().id ? getUser().id : null);
  if (!uid) return null;

  const { data, error } = await client.from('profiles').select('*').eq('id', uid).single();

  if (error) return null;
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
  const user = getUser();
  if (!user) return null;

  try {
    const { data, error } = await client
      .from('profiles')
      .select('deletion_status, purge_after')
      .eq('id', user.id)
      .single();

    if (error) {
      // If profile doesn't exist (deleted user), return null
      if (error.code === 'PGRST116' || error.status === 406) {
        return null;
      }
      throw error;
    }

    return data || null;
  } catch (err) {
    // On error, return null (fail open)
    return null;
  }
}

export async function updateProfile(updates) {
  const client = requireClient();
  const user = getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserOrganizations() {
  const client = requireClient();
  const { data, error } = await client.rpc('get_user_organizations');
  if (error) throw error;
  return data || [];
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
  const user = getUser();
  if (!user) return null;

  const { data, error } = await client
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // No rows returned
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
  const user = getUser();
  if (!user) throw new Error('Not authenticated');

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
  const user = getUser();
  if (!user) throw new Error('Not authenticated');

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
    const { data: files } = await client.storage.from('avatars').list(user.id);

    if (files && files.length > 0) {
      const filePaths = files.map(f => `${user.id}/${f.name}`);
      await client.storage.from('avatars').remove(filePaths);
    }
  } catch (e) {
    void 0;
  }

  // Get file extension
  const ext = file.name.split('.').pop() || 'png';
  const filePath = `${user.id}/avatar.${ext}`;

  // Upload to storage
  const { data, error } = await client.storage.from('avatars').upload(filePath, file, {
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
  const user = getUser();
  if (!user) throw new Error('Not authenticated');

  // List all files in user's folder
  const { data: files, error: listError } = await client.storage.from('avatars').list(user.id);

  if (listError) throw listError;

  // Delete all avatar files
  if (files && files.length > 0) {
    const filePaths = files.map(f => `${user.id}/${f.name}`);
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
 * @returns {Promise<boolean>} - True on success
 */
export async function requestAccountDeletion() {
  // Guard: do not attempt Edge Function calls while offline
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    const e = new Error('You are offline. Reconnect to delete your account.');
    e.code = 'OFFLINE';
    throw e;
  }

  const client = requireClient();
  if (debugEnabled()) console.info('[SupabaseClient] requestAccountDeletion start');

  // Helper: after a deletion request, auth may be revoked mid-flight.
  // If we can no longer reach authed endpoints, we treat that as success.
  async function authLooksRevoked() {
    try {
      // getUser() validates the access token with the server.
      // After the Edge Function bans/signs-out the user, this will commonly return 401.
      const { data, error } = await client.auth.getUser();
      if (error) return true;
      const u = data && data.user ? data.user : null;
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
      console.info('[SupabaseClient] requestAccountDeletion result', { status: st, msg, data });
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
