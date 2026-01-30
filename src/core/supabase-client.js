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

      _client.auth.onAuthStateChange((_event, nextSession) => {
        _session = nextSession || null;
      });

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
    const possibleUrl = client.supabaseUrl || client.url || client.supabaseUrl || (client && client._getUrl && typeof client._getUrl === 'function' ? client._getUrl() : null);
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

  const localFallback = () => {
    try {
      const key =
        (client && client.auth && (client.auth.storageKey || client.auth._storageKey)) || null;

      if (key) {
        try { localStorage.removeItem(key); } catch (_) { void 0; }
        try { sessionStorage.removeItem(key); } catch (_) { void 0; }
      }
    } catch (e) { void 0; }

    _session = null;
    clearLocalAuthStorage();

    try {
      window.dispatchEvent(
        new CustomEvent("tp3d:auth-signed-out", {
          detail: { offline: true, globalRequested: global },
        })
      );
    } catch (_) { void 0; }

    return { ok: true, offline: true };
  };

  // Offline path
  if (allowOffline && typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
    return localFallback();
  }

  try {
    const { error } = await client.auth.signOut({ scope: global ? "global" : "local" });
    if (error) throw error;

    _session = null;
    clearLocalAuthStorage();

    try {
      window.dispatchEvent(
        new CustomEvent("tp3d:auth-signed-out", {
          detail: { offline: false, globalRequested: global },
        })
      );
    } catch (_) { void 0; }

    return { ok: true, offline: false };
  } catch (err) {
    // Ensure local session is cleared even if remote signOut fails
    try {
      _session = null;
      clearLocalAuthStorage();
      try {
        window.dispatchEvent(
          new CustomEvent("tp3d:auth-signed-out", {
            detail: { offline: true, globalRequested: global },
          })
        );
      } catch (_) { void 0; }
    } catch (_) { void 0; }

    return { ok: true, forced: true };
  }
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

  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .single();

  if (error) return null;
  return data || null;
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
      updated_at: new Date().toISOString()
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
    const { data: files } = await client.storage
      .from('avatars')
      .list(user.id);
    
    if (files && files.length > 0) {
      const filePaths = files.map(f => `${user.id}/${f.name}`);
      await client.storage
        .from('avatars')
        .remove(filePaths);
    }
  } catch (e) { void 0; }

  // Get file extension
  const ext = file.name.split('.').pop() || 'png';
  const filePath = `${user.id}/avatar.${ext}`;

  // Upload to storage
  const { data, error } = await client.storage
    .from('avatars')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (error) throw error;

  // Get public URL
  const { data: urlData } = client.storage
    .from('avatars')
    .getPublicUrl(filePath);

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
  const { data: files, error: listError } = await client.storage
    .from('avatars')
    .list(user.id);

  if (listError) throw listError;

  // Delete all avatar files
  if (files && files.length > 0) {
    const filePaths = files.map(f => `${user.id}/${f.name}`);
    const { error: deleteError } = await client.storage
      .from('avatars')
      .remove(filePaths);

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
  const client = requireClient();
  const user = getUser();
  if (!user) throw new Error('Not authenticated');

  // Always pull fresh session
  const { data: sessData } = await client.auth.getSession();
  const accessToken =
    sessData?.session?.access_token || _session?.access_token;

  if (!accessToken) {
    throw new Error('No active session token');
  }

  const { data, error } = await client.functions.invoke(
    'request-account-deletion',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (error) throw error;

  return data && data.success === true;
}