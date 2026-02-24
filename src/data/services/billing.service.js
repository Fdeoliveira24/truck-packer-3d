/**
 * @file billing.service.js
 * @description Billing and plan helpers — calls Supabase Edge Functions for
 *              billing status, Stripe checkout, and Stripe billing portal.
 * @module data/services/billing.service
 * @created Unknown
 * @updated 02/17/2026
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
// SECTION: DEBUG FLAG
// ============================================================================

/**
 * Debug flag — enable via `tp3dDebug=1` in URL or `localStorage.tp3dDebug='1'`.
 * @type {boolean}
 */
const _isDebug = (() => {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof URLSearchParams !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tp3dDebug') === '1') return true;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('tp3dDebug') === '1') return true;
  } catch { /* ignore */ }
  return false;
})();

function debugLog(context, ...args) {
  if (!_isDebug) return;
  console.log(`[billing-service:${context}]`, ...args);
}

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
 *
 * STANDARD: Authorization: Bearer <anonKey> (gateway JWT check)
 *           x-user-jwt: <user access_token> (user identity)
 *           apikey: <anonKey>
 *
 * This matches extractBearerToken() in _shared/auth.ts which checks
 * x-user-jwt first, then falls back to Authorization header.
 *
 * @returns {Promise<Record<string, string>>}
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

  debugLog('auth-headers', 'strategy=anonBearer+xUserJwt', {
    tokenPrefix: token.slice(0, 12) + '…',
    anonKeyPrefix: anonKey.slice(0, 12) + '…',
  });

  return {
    // Anon key as Bearer for Supabase gateway JWT validation.
    // User JWT passed in x-user-jwt for Edge Function auth.
    Authorization: 'Bearer ' + anonKey,
    'x-user-jwt': token,
    apikey: anonKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Export for use by other modules that call Edge Functions (e.g. invite wiring)
export { getFunctionAuthHeaders, getFunctionsBase, getAnonKey };

/**
 * Generic POST helper for Edge Functions.
 * @param {string} path – e.g. '/stripe-create-checkout-session'
 * @param {Record<string, unknown>} [body={}]
 * @returns {Promise<Response>}
 */
async function postFn(path, body) {
  const base = getFunctionsBase();
  const headers = await getFunctionAuthHeaders();
  const url = base + path;
  const payload = body && typeof body === 'object' ? body : {};
  const bodyKeys = Object.keys(payload);
  debugLog('postFn:request', { url, bodyKeys });
  const res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload),
  });
  if (_isDebug) {
    let responseText = '';
    try {
      responseText = await res.clone().text();
    } catch (_) {
      responseText = '';
    }
    debugLog('postFn:response', {
      url,
      status: res.status,
      ok: res.ok,
      responseText: responseText ? responseText.slice(0, 500) : '',
    });
  }
  return res;
}

/**
 * Generic GET helper for Edge Functions.
 * @param {string} path – e.g. '/billing-status'
 * @returns {Promise<Response>}
 */
async function getFn(path) {
  const base = getFunctionsBase();
  const headers = await getFunctionAuthHeaders();
  debugLog('getFn', path);
  return fetch(base + path, {
    method: 'GET',
    headers: headers,
  });
}

/**
 * Read JSON response safely.
 * @param {Response} res
 * @returns {Promise<any|null>}
 */
async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Resolve a user-friendly function error from response payload.
 * @param {Response} res
 * @param {any} data
 * @param {string} fallback
 * @returns {string}
 */
function resolveFnError(res, data, fallback) {
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (res && res.statusText) return `${fallback} (HTTP ${res.status})`;
  return fallback;
}

const ORG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BILLING_INTERVAL_VALUES = new Set(['month', 'year']);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isUuid(value) {
  const raw = String(value || '').trim();
  return Boolean(raw) && ORG_UUID_RE.test(raw);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeOrganizationId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'personal') return '';
  return isUuid(raw) ? raw : '';
}

/**
 * @param {unknown} value
 * @returns {'month'|'year'|''}
 */
function normalizeBillingInterval(value) {
  const raw = String(value || '').trim().toLowerCase();
  return BILLING_INTERVAL_VALUES.has(raw) ? /** @type {'month'|'year'} */ (raw) : '';
}

/**
 * Resolve the active organization id from runtime session context.
 * Billing calls must wait for OrgContext resolution to avoid stale local/session fallbacks.
 * @returns {{ organizationId: string, reason: string|null, orgIdCandidate: string|null }}
 */
function resolveActiveOrganizationId() {
  let rawContextOrgId = '';
  let rawSessionOrgId = '';
  let rawLocalOrgId = '';
  let contextOrgId = '';

  try {
    if (typeof window !== 'undefined' && window.OrgContext && typeof window.OrgContext.getActiveOrgId === 'function') {
      rawContextOrgId = String(window.OrgContext.getActiveOrgId() || '').trim();
      contextOrgId = normalizeOrganizationId(rawContextOrgId);
      if (contextOrgId) {
        return { organizationId: contextOrgId, reason: null, orgIdCandidate: contextOrgId };
      }
    }
  } catch (_) {
    // ignore
  }
  try {
    const session = getSession();
    rawSessionOrgId = String(
      (session && session.currentOrg && (session.currentOrg.id || session.currentOrg.organization_id)) || '',
    ).trim();
  } catch (_) {
    // ignore
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      rawLocalOrgId = String(window.localStorage.getItem('tp3d:active-org-id') || '').trim();
    }
  } catch (_) {
    // ignore
  }

  const sessionOrgId = normalizeOrganizationId(rawSessionOrgId);
  const localOrgId = normalizeOrganizationId(rawLocalOrgId);
  const orgIdCandidate = sessionOrgId || localOrgId || null;

  let reason = 'org-context-not-ready';
  if (rawContextOrgId && !contextOrgId) reason = 'org-context-invalid';
  else if (sessionOrgId) reason = 'session-only';
  else if (localOrgId) reason = 'localStorage-only';

  return { organizationId: '', reason, orgIdCandidate };
}

// ============================================================================
// SECTION: LEGACY HELPERS (kept for backward compat)
// ============================================================================

export const BillingService = {
  // Legacy compatibility only.
  // Production plan checks must rely on window.__TP3D_BILLING.getBillingState().
  getCurrentPlan() {
    try {
      const api = typeof window !== 'undefined' ? window.__TP3D_BILLING : null;
      const snapshot = api && typeof api.getBillingState === 'function' ? api.getBillingState() : null;
      if (snapshot && snapshot.ok && !snapshot.pending) {
        return snapshot.isPro ? 'Pro' : 'Free';
      }
    } catch (_) {
      // ignore and fall back
    }
    return 'Free';
  },
  // Legacy compatibility only.
  // Production trial checks must rely on billing-status trialEndsAt.
  getDaysLeftInTrial() {
    try {
      const api = typeof window !== 'undefined' ? window.__TP3D_BILLING : null;
      const snapshot = api && typeof api.getBillingState === 'function' ? api.getBillingState() : null;
      const endIso = snapshot && snapshot.trialEndsAt ? String(snapshot.trialEndsAt) : '';
      if (!endIso) return 0;
      const endMs = new Date(endIso).getTime();
      if (!Number.isFinite(endMs) || endMs <= 0) return 0;
      return Math.max(0, Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000)));
    } catch (_) {
      return 0;
    }
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
 * @returns {Promise<{ok:boolean, pending:boolean, skipped?:boolean, status:number|null, data:any|null, error:{message:string,status:number|null}|null, orgId:string|null}>}
 */
export async function fetchBillingStatus() {
  try {
    const resolution = resolveActiveOrganizationId();
    const organizationId = resolution.organizationId;
    if (!organizationId) {
      debugLog('billing pre-org fetch skipped', {
        reason: resolution.reason || 'org-context-not-ready',
        orgIdCandidate: resolution.orgIdCandidate || null,
      });
      return {
        ok: false,
        pending: true,
        skipped: true,
        status: null,
        data: null,
        error: null,
        orgId: null,
      };
    }
    const path = '/billing-status?organization_id=' + encodeURIComponent(organizationId);
    debugLog('fetchBillingStatus', 'requesting', { organization_id: organizationId });
    const res = await getFn(path);

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // non-JSON response
    }

    if (!res.ok) {
      return {
        ok: false,
        pending: false,
        status: res.status,
        data: data,
        error: { message: (data && data.error) || res.statusText, status: res.status },
        orgId: organizationId,
      };
    }

    if (data && typeof data === 'object') {
      const statusRaw = data.status ? String(data.status).toLowerCase() : '';
      if (statusRaw === 'active' && data.trialEndsAt) {
        // UI contract: active subscriptions should not expose trial countdown signals.
        data.trialEndsAt = null;
      }
    }

    debugLog('billing org fetch completed', {
      orgId: organizationId,
      plan: data && data.plan ? String(data.plan) : null,
      status: data && data.status ? String(data.status) : null,
      trialEndsAt: data && data.trialEndsAt ? String(data.trialEndsAt) : null,
      currentPeriodEnd: data && data.currentPeriodEnd ? String(data.currentPeriodEnd) : null,
    });
    return { ok: true, pending: false, status: res.status, data: data, error: null, orgId: organizationId };
  } catch (err) {
    debugLog('fetchBillingStatus', 'error', err && err.message);
    return {
      ok: false,
      pending: false,
      status: null,
      data: null,
      error: { message: err && err.message ? err.message : 'Network error', status: null },
      orgId: null,
    };
  }
}

// ============================================================================
// SECTION: EDGE FUNCTION – stripe-create-checkout-session
// ============================================================================

/**
 * Create a Stripe Checkout Session and return the redirect URL.
 * No session callback needed – reads session from SupabaseClient directly.
 *
 * @param {string|{interval?:'month'|'year',priceId?:string,price_id?:string}} input
 * @returns {Promise<{ok:boolean, url:string|null, error:string|null}>}
 */
export async function createCheckoutSession(input) {
  try {
    const resolution = resolveActiveOrganizationId();
    const orgId = resolution.organizationId;
    if (!orgId) {
      return { ok: false, url: null, error: 'Organization is still loading. Please try again in a moment.' };
    }

    let interval = 'month';
    let priceId = '';
    let hasExplicitInterval = false;
    if (typeof input === 'string') {
      const maybeInterval = normalizeBillingInterval(input);
      if (maybeInterval) {
        interval = maybeInterval;
        hasExplicitInterval = true;
      } else {
        priceId = String(input || '').trim();
      }
    } else if (input && typeof input === 'object') {
      const maybeInterval = normalizeBillingInterval(input.interval);
      if (maybeInterval) {
        interval = maybeInterval;
        hasExplicitInterval = true;
      }
      const maybePrice = input.priceId || input.price_id;
      if (maybePrice) priceId = String(maybePrice).trim();
    }

    const payload = { organization_id: orgId };
    if (hasExplicitInterval) payload.interval = interval;
    if (priceId) payload.price_id = priceId;
    debugLog('createCheckoutSession', 'requesting', {
      interval,
      hasPriceId: Boolean(priceId),
      organization_id: orgId,
    });
    const res = await postFn('/stripe-create-checkout-session', payload);

    let data = null;
    try { data = await res.json(); } catch (_) { /* ignore */ }

    debugLog('createCheckoutSession', 'response', { status: res.status, hasUrl: Boolean(data && data.url) });

    if (!res.ok || !data || !data.url) {
      return { ok: false, url: null, error: (data && data.error) || 'Checkout failed (HTTP ' + res.status + ')' };
    }

    return { ok: true, url: data.url, error: null };
  } catch (err) {
    debugLog('createCheckoutSession', 'error', err && err.message);
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
    const resolution = resolveActiveOrganizationId();
    const organizationId = resolution.organizationId;
    if (!organizationId) {
      return { ok: false, url: null, error: 'Organization is still loading. Please try again in a moment.' };
    }
    debugLog('createPortalSession', 'requesting', { organization_id: organizationId });
    const payload = { organization_id: organizationId };
    const res = await postFn('/stripe-create-portal-session', payload);

    let data = null;
    try { data = await res.json(); } catch (_) { /* ignore */ }

    debugLog('createPortalSession', 'response', { status: res.status, hasUrl: Boolean(data && data.url) });

    if (!res.ok || !data || !data.url) {
      return { ok: false, url: null, error: (data && data.error) || 'Portal session failed (HTTP ' + res.status + ')' };
    }

    return { ok: true, url: data.url, error: null };
  } catch (err) {
    debugLog('createPortalSession', 'error', err && err.message);
    return { ok: false, url: null, error: err && err.message ? err.message : 'Network error' };
  }
}

// ============================================================================
// SECTION: EDGE FUNCTION – organization members/invites
// ============================================================================

/**
 * Send or resend an organization invite.
 * @param {string} orgId
 * @param {string} email
 * @param {string} [role='member']
 * @returns {Promise<{ok:boolean, invite?:any, token?:string, invite_link?:string, error?:string}>}
 */
export async function sendOrgInvite(orgId, email, role = 'member') {
  try {
    debugLog('sendOrgInvite', { orgId, email, role });
    const res = await postFn('/org-invite', {
      organization_id: orgId,
      email,
      role,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      return { ok: false, error: resolveFnError(res, data, 'Invite failed') };
    }
    return {
      ok: true,
      invite: data && data.invite ? data.invite : null,
      token: data && data.token ? data.token : null,
      invite_link: data && data.invite_link ? data.invite_link : null,
    };
  } catch (err) {
    debugLog('sendOrgInvite:error', err && err.message);
    return { ok: false, error: err && err.message ? err.message : 'Network error' };
  }
}

/**
 * Accept an organization invite by token.
 * @param {string} token
 * @returns {Promise<{ok:boolean, data?:any, organization_id?:string|null, already_accepted?:boolean, error?:string}>}
 */
export async function acceptOrgInvite(token) {
  try {
    debugLog('acceptOrgInvite', { hasToken: Boolean(token) });
    const res = await postFn('/org-invite-accept', { token });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      return { ok: false, error: resolveFnError(res, data, 'Invite acceptance failed') };
    }
    const organizationId = data && data.organization_id ? String(data.organization_id) : null;
    return {
      ok: true,
      data,
      organization_id: organizationId,
      already_accepted: Boolean(data && data.already_accepted),
    };
  } catch (err) {
    debugLog('acceptOrgInvite:error', err && err.message);
    return { ok: false, error: err && err.message ? err.message : 'Network error' };
  }
}

/**
 * Update organization member role via Edge Function guardrails.
 * @param {string} orgId
 * @param {string} userId
 * @param {string} role
 * @returns {Promise<{ok:boolean, member?:any, error?:string}>}
 */
export async function updateOrgMemberRole(orgId, userId, role) {
  try {
    debugLog('updateOrgMemberRole', { orgId, userId, role });
    const res = await postFn('/org-member-role-update', {
      org_id: orgId,
      user_id: userId,
      role,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      return { ok: false, error: resolveFnError(res, data, 'Role update failed') };
    }
    return { ok: true, member: data && data.member ? data.member : null };
  } catch (err) {
    debugLog('updateOrgMemberRole:error', err && err.message);
    return { ok: false, error: err && err.message ? err.message : 'Network error' };
  }
}

/**
 * Remove organization member via Edge Function guardrails.
 * @param {string} orgId
 * @param {string} userId
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function removeOrgMember(orgId, userId) {
  try {
    debugLog('removeOrgMember', { orgId, userId });
    const res = await postFn('/org-member-remove', {
      org_id: orgId,
      user_id: userId,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      return { ok: false, error: resolveFnError(res, data, 'Remove failed') };
    }
    return { ok: true };
  } catch (err) {
    debugLog('removeOrgMember:error', err && err.message);
    return { ok: false, error: err && err.message ? err.message : 'Network error' };
  }
}
