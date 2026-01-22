/**
 * @file session.js
 * @description Session storage and organization/account context helpers.
 * @module core/session
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as Utils from './utils/index.js';
import { emit } from './events.js';

export const SESSION_KEY = 'truckPacker3d:session:v1';

const LEGACY = { name: 'Agro Felix', email: 'agrofelixbraganca@gmail.com' };
const DEMO = { name: 'Demo User', email: 'info@pxl360.com' };

let session = null;
const subscribers = [];

function defaultDemoSession() {
  return {
    user: { name: 'Demo User', email: 'info@pxl360.com' },
    currentAccount: { type: 'personal', name: 'Personal Account', role: 'Owner' },
  };
}

function defaultSignedOutSession() {
  return {
    user: { name: 'Guest', email: '' },
    currentAccount: { type: 'personal', name: 'Personal Account', role: '' },
  };
}

function notify() {
  subscribers.forEach(fn => {
    try {
      fn(session);
    } catch (err) {
      console.error('[Session] subscriber error', err);
    }
  });
}

function emitChanged() {
  emit('session:changed', { session });
}

function emitError(message, error) {
  emit('session:error', { message, error });
}

function load() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(raw, null));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    emitError(err && err.message ? err.message : 'Load failed', err);
    return null;
  }
}

function save(next) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch (err) {
    emitError(err && err.message ? err.message : 'Save failed', err);
  }
}

function migrate(next) {
  if (!next || typeof next !== 'object') return next;
  next.user = next.user && typeof next.user === 'object' ? next.user : {};
  const name = String(next.user.name || '');
  const email = String(next.user.email || '');
  if (name === LEGACY.name || email === LEGACY.email) {
    next.user.name = DEMO.name;
    next.user.email = DEMO.email;
  }
  return next;
}

export function get() {
  if (session) return session;
  const stored = load();
  session = migrate(stored || defaultDemoSession());
  save(session);
  emitChanged();
  return session;
}

export function clear() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    emitError(err && err.message ? err.message : 'Clear failed', err);
  }
  session = defaultSignedOutSession();
  notify();
  emitChanged();
}

export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const idx = subscribers.indexOf(fn);
    if (idx > -1) subscribers.splice(idx, 1);
  };
}
