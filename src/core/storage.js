/**
 * @file storage.js
 * @description Persistence adapter for saving and loading app state.
 * @module core/storage
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { APP_VERSION } from './version.js';
import * as Utils from './utils/index.js';
import { debounce } from './browser.js';
import * as StateStore from './state-store.js';
import { emit } from './events.js';

export const STORAGE_KEY = 'truckPacker3d:v1';

// Storage is scoped first by user, then by active workspace. Preferences stay
// user-scoped while packs/cases/currentPackId live under the active workspace.
let STORAGE_SCOPE = 'anon';
let WORKSPACE_SCOPE = 'no-org';

/** Set the current storage scope (typically the signed-in user id). */
export function setStorageScope(scope) {
  STORAGE_SCOPE = String(scope || 'anon').trim() || 'anon';
}

/** Return the current scope value (for diagnostics). */
export function getStorageScope() {
  return STORAGE_SCOPE;
}

/** Set the current workspace scope (typically the active org id). */
export function setWorkspaceScope(scope) {
  WORKSPACE_SCOPE = String(scope || 'no-org').trim() || 'no-org';
}

/** Return the current workspace scope value. */
export function getWorkspaceScope() {
  return WORKSPACE_SCOPE;
}

/** Build the localStorage key for the active user scope. */
function getScopedKey() {
  return STORAGE_SCOPE === 'anon' ? STORAGE_KEY : `${STORAGE_KEY}:${STORAGE_SCOPE}`;
}

/** Build the localStorage key for the active workspace scope. */
function getWorkspaceScopedKey() {
  return `${getScopedKey()}:workspace:${WORKSPACE_SCOPE}`;
}

function readUserScopedRaw(scopedKey) {
  let raw = window.localStorage.getItem(scopedKey);

  // P0.9 – One-time migration: if the scoped key is empty but the legacy
  // unscoped key has data, copy it over and remove the legacy key so a
  // second user won't collide with it.
  if (!raw && scopedKey !== STORAGE_KEY) {
    try {
      const legacyRaw = window.localStorage.getItem(STORAGE_KEY);
      if (legacyRaw) {
        window.localStorage.setItem(scopedKey, legacyRaw);
        window.localStorage.removeItem(STORAGE_KEY);
        raw = legacyRaw;
      }
    } catch (_migrationErr) {
      // migration is best-effort; fall through to normal null return
    }
  }

  return raw;
}

function parseStoredPayload(raw, key) {
  if (!raw) return null;
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(raw, null));
  if (!parsed || typeof parsed !== 'object') {
    emit('storage:load_error', { key, message: 'Invalid stored data' });
    return null;
  }
  return parsed;
}

const saveDebounced = debounce(saveNow, 250);

export function readJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(raw, fallback));
    return parsed == null ? fallback : parsed;
  } catch (err) {
    emit('storage:read_error', {
      key,
      message: err && err.message ? err.message : 'Read failed',
      error: err,
    });
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    emit('storage:write_error', {
      key,
      message: err && err.message ? err.message : 'Write failed',
      error: err,
    });
  }
}

export function removeKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    emit('storage:remove_error', {
      key,
      message: err && err.message ? err.message : 'Remove failed',
      error: err,
    });
  }
}

export function load() {
  const scopedKey = getScopedKey();
  const workspaceKey = getWorkspaceScopedKey();
  try {
    const userRaw = readUserScopedRaw(scopedKey);
    const userPayload = parseStoredPayload(userRaw, scopedKey);

    const workspaceRaw = window.localStorage.getItem(workspaceKey);
    const workspacePayload = parseStoredPayload(workspaceRaw, workspaceKey);
    const hasWorkspaceData = Boolean(
      workspacePayload &&
        typeof workspacePayload === 'object' &&
        Array.isArray(workspacePayload.caseLibrary) &&
        Array.isArray(workspacePayload.packLibrary)
    );
    const preferences =
      userPayload && userPayload.preferences && typeof userPayload.preferences === 'object'
        ? userPayload.preferences
        : null;

    if (!preferences && !hasWorkspaceData) return null;

    return {
      version:
        (workspacePayload && workspacePayload.version) ||
        (userPayload && userPayload.version) ||
        APP_VERSION,
      savedAt:
        (workspacePayload && workspacePayload.savedAt) ||
        (userPayload && userPayload.savedAt) ||
        0,
      preferences,
      caseLibrary: hasWorkspaceData ? workspacePayload.caseLibrary : null,
      packLibrary: hasWorkspaceData ? workspacePayload.packLibrary : null,
      currentPackId: hasWorkspaceData ? workspacePayload.currentPackId || null : null,
    };
  } catch (err) {
    emit('storage:load_error', {
      key: scopedKey,
      message: err && err.message ? err.message : 'Load failed',
      error: err,
    });
    return null;
  }
}

export function saveSoon() {
  saveDebounced();
}

export function saveNow() {
  const scopedKey = getScopedKey();
  const workspaceKey = getWorkspaceScopedKey();
  try {
    const state = StateStore.get();
    const userPayload = {
      version: APP_VERSION,
      savedAt: Date.now(),
      preferences: state.preferences,
    };
    const workspacePayload = {
      version: APP_VERSION,
      savedAt: userPayload.savedAt,
      caseLibrary: state.caseLibrary,
      packLibrary: state.packLibrary,
      currentPackId: state.currentPackId,
    };
    window.localStorage.setItem(scopedKey, JSON.stringify(userPayload));
    window.localStorage.setItem(workspaceKey, JSON.stringify(workspacePayload));
    emit('storage:saved', { key: workspaceKey, savedAt: workspacePayload.savedAt });
  } catch (err) {
    emit('storage:save_error', {
      key: workspaceKey,
      message: err && err.message ? err.message : 'Save failed',
      error: err,
    });
  }
}

export function clearAll() {
  const scopedKey = getScopedKey();
  const workspacePrefix = `${scopedKey}:workspace:`;
  try {
    const keysToRemove = [scopedKey];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || key === scopedKey) continue;
      if (key.startsWith(workspacePrefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => window.localStorage.removeItem(key));
  } catch (err) {
    emit('storage:save_error', {
      key: scopedKey,
      message: err && err.message ? err.message : 'Clear failed',
      error: err,
    });
  }
}

export function exportAppJSON() {
  const state = StateStore.get();
  const payload = {
    app: 'Truck Packer 3D',
    version: APP_VERSION,
    exportedAt: Date.now(),
    data: {
      caseLibrary: state.caseLibrary,
      packLibrary: state.packLibrary,
      preferences: state.preferences,
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function importAppJSON(jsonText) {
  try {
    const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
    const data = parsed.data || parsed;
    if (!data.caseLibrary || !data.packLibrary || !data.preferences) throw new Error('Missing required keys');
    return {
      caseLibrary: data.caseLibrary,
      packLibrary: data.packLibrary,
      preferences: data.preferences,
    };
  } catch (err) {
    emit('storage:import_error', {
      message: err && err.message ? err.message : 'Import failed',
      error: err,
    });
    throw err;
  }
}
