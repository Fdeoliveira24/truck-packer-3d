/**
 * @file state-store.js
 * @description Global state store with snapshot and history support.
 * @module core/state-store
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { deepClone } from './utils/index.js';

const MAX_HISTORY = 50;

let state = null;
let history = [];
let historyPointer = -1;
const subscribers = [];

function historySlice(s) {
  return deepClone({
    caseLibrary: s.caseLibrary,
    packLibrary: s.packLibrary,
    folderLibrary: s.folderLibrary,
    preferences: s.preferences,
  });
}

function withWorkspaceDefaults(nextState) {
  const next = nextState && typeof nextState === 'object' ? nextState : {};
  return {
    ...next,
    folderLibrary: Array.isArray(next.folderLibrary) ? next.folderLibrary : [],
  };
}

function init(initialState) {
  state = deepClone(withWorkspaceDefaults(initialState));
  history = [historySlice(state)];
  historyPointer = 0;
}

function get(key) {
  if (!state) return key ? undefined : null;
  if (!key) return state;
  return state[key];
}

function set(patch, options = {}) {
  const next = withWorkspaceDefaults({ ...state, ...patch });
  const significant = options.skipHistory ? false : isSignificantChange(patch);
  // Clear Preview is one user step. Its undo base must include the latest
  // derived image (capture deliberately skipped history), without adding a step
  // or changing Redo for automatic preview writes.
  if (significant && options.notification?.type === 'pack-preview') {
    history[historyPointer] = historySlice(state);
  }
  state = next;
  if (significant) pushHistory(historySlice(next));
  if (!options.skipNotify) notify(patch, state, options.notification);
}

function replace(nextState, options = {}) {
  state = deepClone(withWorkspaceDefaults(nextState));
  if (options.resetHistory) {
    history = [historySlice(state)];
    historyPointer = 0;
  } else if (!options.skipHistory) {
    pushHistory(historySlice(state));
  }
  notify({ _replace: true }, state);
}

function snapshot() {
  return deepClone(state);
}

function resetHistory() {
  history = [historySlice(state)];
  historyPointer = 0;
}

function pushHistory(entry) {
  history = history.slice(0, historyPointer + 1);
  history.push(deepClone(entry));
  if (history.length > MAX_HISTORY) history.shift();
  historyPointer = history.length - 1;
}

function restoreCargoHistory(entry) {
  const restored = deepClone(entry);
  const currentViews = new Map((state.packLibrary || [])
    .filter(pack => pack && pack.id && Object.hasOwn(pack, 'editorView'))
    .map(pack => [pack.id, pack.editorView]));
  restored.packLibrary = (restored.packLibrary || []).map(pack =>
    currentViews.has(pack.id) ? { ...pack, editorView: deepClone(currentViews.get(pack.id)) } : pack);
  return restored;
}

function undo() {
  if (historyPointer <= 0) return false;
  historyPointer--;
  state = { ...state, ...restoreCargoHistory(history[historyPointer]) };
  notify({ _undo: true }, state);
  return true;
}

function redo() {
  if (historyPointer >= history.length - 1) return false;
  historyPointer++;
  state = { ...state, ...restoreCargoHistory(history[historyPointer]) };
  notify({ _redo: true }, state);
  return true;
}

function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const idx = subscribers.indexOf(fn);
    if (idx > -1) subscribers.splice(idx, 1);
  };
}

function notify(changes, nextState, notification = undefined) {
  subscribers.forEach(fn => {
    try {
      fn(changes, nextState, notification);
    } catch (err) {
      console.error('Subscriber error', err);
    }
  });
}

function isSignificantChange(patch) {
  const keys = Object.keys(patch || {});
  const significant = ['caseLibrary', 'packLibrary', 'folderLibrary', 'preferences'];
  return keys.some(k => significant.includes(k));
}

export { init, get, set, replace, snapshot, resetHistory, undo, redo, subscribe };
