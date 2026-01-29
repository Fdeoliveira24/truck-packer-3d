/**
 * • LEGACY / NOT USED BY CURRENT RUNTIME IMPORT CHAIN
 * • Do NOT import this file unless you also reconcile storage/session APIs and key strategy.
 * • If applicable: This module expects readJson/writeJson/removeKey from storage, but current core storage does not export them.
 */

/**
 * @file session.js
 * @description Authentication/session helpers and permission checks.
 * @module auth/session
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { STORAGE_KEYS } from '../core/constants.js';
import { readJson, removeKey, writeJson } from '../core/storage.js';
import { deepClone } from '../utils/json.js';
import { uuid } from '../utils/uuid.js';

let _session = null;
const subscribers = new Set();

function notify() {
  subscribers.forEach(cb => {
    try {
      cb(_session);
    } catch (err) {
      console.error('[Session] subscriber error', err);
    }
  });
}

function defaultSession() {
  const now = Date.now();
  const trialEndsAt = now + 7 * 24 * 60 * 60 * 1000;
  const userId = `user-${uuid()}`;
  return {
    user: {
      id: userId,
      name: 'Demo User',
      email: 'info@pxl360.com',
      currentOrgId: 'personal',
    },
    orgs: [
      {
        id: 'personal',
        type: 'personal',
        name: 'Personal Account',
        role: 'Owner',
        plan: 'Trial',
        trialEndsAt,
      },
    ],
    preferences: null,
  };
}

function computeCurrentOrg(session) {
  const orgId = session && session.user ? session.user.currentOrgId : null;
  const orgs = session && Array.isArray(session.orgs) ? session.orgs : [];
  const current = orgs.find(o => o.id === orgId) || orgs[0] || null;
  return current ? { ...current } : null;
}

function persist(session) {
  writeJson(STORAGE_KEYS.session, session);
}

export function initSession() {
  if (_session) return _session;
  const stored = readJson(STORAGE_KEYS.session, null);
  _session = stored && typeof stored === 'object' ? stored : defaultSession();
  if (!_session.user || typeof _session.user !== 'object') _session.user = defaultSession().user;
  if (!Array.isArray(_session.orgs) || !_session.orgs.length) _session.orgs = defaultSession().orgs;
  if (!_session.user.currentOrgId) _session.user.currentOrgId = _session.orgs[0].id;
  // Migrate legacy demo identity.
  if (_session.user && (_session.user.name === 'Agro Felix' || _session.user.email === 'agrofelixbraganca@gmail.com')) {
    _session.user.name = 'Demo User';
    _session.user.email = 'info@pxl360.com';
  }
  _session.currentOrg = computeCurrentOrg(_session);
  persist(_session);
  return _session;
}

export function getSession() {
  return initSession();
}

export function setCurrentOrgId(nextOrgId) {
  const s = getSession();
  const orgs = Array.isArray(s.orgs) ? s.orgs : [];
  const exists = orgs.some(o => o.id === nextOrgId);
  if (!exists) throw new Error('Organization not found');
  s.user.currentOrgId = nextOrgId;
  s.currentOrg = computeCurrentOrg(s);
  persist(s);
  notify();
  return s;
}

export function upsertOrg(org) {
  const s = getSession();
  const next = deepClone(s);
  next.orgs = Array.isArray(next.orgs) ? next.orgs : [];
  const idx = next.orgs.findIndex(o => o.id === org.id);
  if (idx >= 0) next.orgs[idx] = { ...next.orgs[idx], ...org };
  else next.orgs.push(org);
  next.currentOrg = computeCurrentOrg(next);
  _session = next;
  persist(_session);
  notify();
  return _session;
}

export function createOrganization({ name }) {
  const id = `org-${uuid()}`;
  const org = {
    id,
    type: 'organization',
    name: String(name || 'New Organization').trim() || 'New Organization',
    role: 'Owner',
    plan: 'Trial',
    trialEndsAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  upsertOrg(org);
  setCurrentOrgId(id);
  return org;
}

export function subscribeSession(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function clearSession() {
  removeKey(STORAGE_KEYS.session);
  _session = null;
  notify();
}
