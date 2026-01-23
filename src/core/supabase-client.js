/**
 * @file supabase-client.js
 * @description UI-free Supabase client wrapper (init + auth helpers) for browser runtime.
 * @module core/supabase-client
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: MODULE STATE
// ============================================================================

let _client = null;
let _session = null;
let _initPromise = null;

function requireClient() {
  if (!_client) throw new Error('SupabaseClient not initialized. Call SupabaseClient.init({ url, anonKey }) first.');
  return _client;
}

// ============================================================================
// SECTION: PUBLIC API
// ============================================================================

export function init({ url, anonKey }) {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const u = String(url || '').trim();
    const k = String(anonKey || '').trim();
    if (!u || !k) throw new Error('Supabase config missing (url/anonKey).');

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

    return _client;
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
