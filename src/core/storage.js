import { APP_VERSION } from './version.js';
import * as Utils from './utils.js';
import { debounce } from './browser.js';
import * as StateStore from './state-store.js';
import { emit } from './events.js';

export const STORAGE_KEY = 'truckPacker3d:v1';

const saveDebounced = debounce(saveNow, 250);

export function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(raw, null));
    if (!parsed || typeof parsed !== 'object') {
      emit('storage:load_error', { key: STORAGE_KEY, message: 'Invalid stored data' });
      return null;
    }
    if (parsed.version !== APP_VERSION) {
      return parsed;
    }
    return parsed;
  } catch (err) {
    emit('storage:load_error', {
      key: STORAGE_KEY,
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
  try {
    const state = StateStore.get();
    const payload = {
      version: APP_VERSION,
      savedAt: Date.now(),
      caseLibrary: state.caseLibrary,
      packLibrary: state.packLibrary,
      preferences: state.preferences,
      currentPackId: state.currentPackId,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    emit('storage:saved', { key: STORAGE_KEY, savedAt: payload.savedAt });
  } catch (err) {
    emit('storage:save_error', {
      key: STORAGE_KEY,
      message: err && err.message ? err.message : 'Save failed',
      error: err,
    });
  }
}

export function clearAll() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    emit('storage:save_error', {
      key: STORAGE_KEY,
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
