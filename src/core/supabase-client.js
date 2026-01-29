/**
 * @file supabase-client.js
 * @description UI-free Supabase client wrapper (init + auth helpers) for browser runtime.
 * @module core/supabase-client
 * @created Unknown
 * @updated 01/28/2026
 * @author Truck Packer 3D Team
 *
 * CHANGES (01/28/2026):
 * - Added uploadAvatar() function for avatar image uploads to 'avatars' storage bucket
 * - Added deleteAvatar() function to remove user avatars from storage
 * - Implemented file type validation (PNG, JPG, WEBP only)
 * - Implemented file size validation (2MB max)
 * - Avatar storage follows pattern: ${userId}/avatar.${ext}
 * - Both functions respect RLS policies based on storage.foldername(name)[1] == auth.uid()
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
    } catch {
      // ignore
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

export async function signOut() {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  _session = null;
  return true;
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
  } catch {
    // Ignore errors during cleanup
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
