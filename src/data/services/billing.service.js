/**
 * @file billing.service.js
 * @description Billing and plan helpers — calls Supabase Edge Functions for
 *              billing status, Stripe checkout, and Stripe billing portal.
 * @module data/services/billing.service
 * @created Unknown
 * @updated 02/11/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { getSession } from '../../auth/session.js';
import {
  getSession as getSupabaseSession,
  getSessionSingleFlight as getSupabaseSessionSingleFlight,
} from '../../core/supabase-client.js';

// ============================================================================
// SECTION: AUTH HEADERS + FUNCTION URL
// ============================================================================

/**
 * Build the Edge Function base URL from the project URL.
 * Format: https://<project>.supabase.co/functions/v1
 * @returns {string}
 */
function getFunctionsBase() {
  const cfg = typeof window !== 'undefined' ? window.__TP3D_SUPABASE : null;
  const projectUrl = cfg && cfg.url ? String(cfg.url).replace(/\/+$/, '') : '';
  if (!projectUrl) throw new Error('Missing Supabase project URL (__TP3D_SUPABASE.url).');
  return projectUrl + '/functions/v1';
}

/**
 * Get the Supabase anon key from the runtime config.
 * @returns {string}
 */
function getAnonKey() {
  const cfg = typeof window !== 'undefined' ? window.__TP3D_SUPABASE : null;
  const key = cfg && cfg.anonKey ? String(cfg.anonKey) : '';
  if (!key) throw new Error('Missing Supabase anon key (__TP3D_SUPABASE.anonKey).');
  return key;
}

/**
 * Build the auth headers required by every Supabase Edge Function call.
 * Reads the current Supabase session (sync) and the anon key from config.
 *
 * @returns {Record<string, string>}
 * @throws {Error} If no session/token or missing anon key.
 */
async function getFunctionAuthHeaders() {
  let session = null;
  try {
    const s = await getSupabaseSessionSingleFlight();
    session = s && s.session ? s.session : null;
  } catch {
    session = null;
  }
  if (!session) session = getSupabaseSession();
  const token = session && session.access_token ? session.access_token : null;
  if (!token) {
    throw new Error('Missing Authorization token. Sign in again and retry.');
  }

  const anonKey = getAnonKey();
  if (!String(anonKey || '').startsWith('eyJ')) {
    throw new Error(
      'Invalid Supabase anon key. Use the public anon key (starts with "eyJ"), not the Stripe publishable key (sb_publishable_...).'
    );
  }

  return {
    // Use anon key for the gateway JWT check, and pass user JWT separately.
    Authorization: 'Bearer ' + anonKey,
    'x-user-jwt': token,
    apikey: anonKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Generic POST helper for Edge Functions.
 * @param {string} path – e.g. '/stripe-create-checkout-session'
 * @param {Record<string, unknown>} [body={}]
 * @returns {Promise<Response>}
 */
async function postFn(path, body) {
  const base = getFunctionsBase();
  const headers = await getFunctionAuthHeaders();
  return fetch(base + path, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body || {}),
  });
}

/**
 * Generic GET helper for Edge Functions.
 * @param {string} path – e.g. '/billing-status'
 * @returns {Promise<Response>}
 */
async function getFn(path) {
  const base = getFunctionsBase();
  const headers = await getFunctionAuthHeaders();
  return fetch(base + path, {
    method: 'GET',
    headers: headers,
  });
}

// ============================================================================
// SECTION: LEGACY HELPERS (kept for backward compat)
// ============================================================================

export const BillingService = {
  getCurrentPlan() {
    const session = getSession();
    return (session.currentOrg && session.currentOrg.plan) || 'Guest';
  },
  getDaysLeftInTrial() {
    const session = getSession();
    const end = session.currentOrg && session.currentOrg.trialEndsAt ? Number(session.currentOrg.trialEndsAt) : 0;
    if (!Number.isFinite(end) || end <= 0) return 0;
    return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
  },
  async upgradeToPro() {
    return { ok: false, message: 'Upgrade flow not implemented (Phase 2). Contact sales.' };
  },
};

// ============================================================================
// SECTION: EDGE FUNCTION – billing-status
// ============================================================================

/**
 * Fetch billing status from the Supabase Edge Function.
 * No arguments required – reads session from SupabaseClient directly.
 *
 * @returns {Promise<{ok:boolean, status:number|null, data:any|null, error:{message:string,status:number|null}|null}>}
 */
export async function fetchBillingStatus() {
  try {
    const res = await getFn('/billing-status');

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // non-JSON response
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data: data, error: { message: (data && data.error) || res.statusText, status: res.status } };
    }

    return { ok: true, status: res.status, data: data, error: null };
  } catch (err) {
    return { ok: false, status: null, data: null, error: { message: err && err.message ? err.message : 'Network error', status: null } };
  }
}

// ============================================================================
// SECTION: EDGE FUNCTION – stripe-create-checkout-session
// ============================================================================

/**
 * Create a Stripe Checkout Session and return the redirect URL.
 * No session callback needed – reads session from SupabaseClient directly.
 *
 * @param {string} priceId – The Stripe price ID for the plan
 * @returns {Promise<{ok:boolean, url:string|null, error:string|null}>}
 */
export async function createCheckoutSession(priceId) {
  try {
    const res = await postFn('/stripe-create-checkout-session', { price_id: priceId });

    let data = null;
    try { data = await res.json(); } catch (_) { /* ignore */ }

    if (!res.ok || !data || !data.url) {
      return { ok: false, url: null, error: (data && data.error) || 'Checkout failed (HTTP ' + res.status + ')' };
    }

    return { ok: true, url: data.url, error: null };
  } catch (err) {
    return { ok: false, url: null, error: err && err.message ? err.message : 'Network error' };
  }
}

// ============================================================================
// SECTION: EDGE FUNCTION – stripe-create-portal-session
// ============================================================================

/**
 * Create a Stripe Billing Portal session and return the redirect URL.
 * No session callback needed – reads session from SupabaseClient directly.
 *
 * @returns {Promise<{ok:boolean, url:string|null, error:string|null}>}
 */
export async function createPortalSession() {
  try {
    const res = await postFn('/stripe-create-portal-session', {});

    let data = null;
    try { data = await res.json(); } catch (_) { /* ignore */ }

    if (!res.ok || !data || !data.url) {
      return { ok: false, url: null, error: (data && data.error) || 'Portal session failed (HTTP ' + res.status + ')' };
    }

    return { ok: true, url: data.url, error: null };
  } catch (err) {
    return { ok: false, url: null, error: err && err.message ? err.message : 'Network error' };
  }
}
