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
    preferences: s.preferences,
  });
}

function init(initialState) {
  state = deepClone(initialState);
  history = [historySlice(state)];
  historyPointer = 0;
}

function get(key) {
  if (!state) return key ? undefined : null;
  if (!key) return state;
  return state[key];
}

function set(patch, options = {}) {
  const next = { ...state, ...patch };
  const significant = options.skipHistory ? false : isSignificantChange(patch);
  state = next;
  if (significant) pushHistory(historySlice(next));
  if (!options.skipNotify) notify(patch, state);
}

function replace(nextState, options = {}) {
  state = deepClone(nextState);
  if (!options.skipHistory) pushHistory(historySlice(state));
  notify({ _replace: true }, state);
}

function snapshot() {
  return deepClone(state);
}

function pushHistory(entry) {
  history = history.slice(0, historyPointer + 1);
  history.push(deepClone(entry));
  if (history.length > MAX_HISTORY) history.shift();
  historyPointer = history.length - 1;
}

function undo() {
  if (historyPointer <= 0) return false;
  historyPointer--;
  state = { ...state, ...deepClone(history[historyPointer]) };
  notify({ _undo: true }, state);
  return true;
}

function redo() {
  if (historyPointer >= history.length - 1) return false;
  historyPointer++;
  state = { ...state, ...deepClone(history[historyPointer]) };
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

function notify(changes, nextState) {
  subscribers.forEach(fn => {
    try {
      fn(changes, nextState);
    } catch (err) {
      console.error('Subscriber error', err);
    }
  });
}

function isSignificantChange(patch) {
  const keys = Object.keys(patch || {});
  const significant = ['caseLibrary', 'packLibrary', 'preferences'];
  return keys.some(k => significant.includes(k));
}

export { init, get, set, replace, snapshot, undo, redo, subscribe };
