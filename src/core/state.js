/**
 * • LEGACY / NOT USED BY CURRENT RUNTIME IMPORT CHAIN
 * • Do NOT import this file unless you also reconcile storage/session APIs and key strategy.
 * • If applicable: This module expects readJson/writeJson/removeKey from storage, but current core storage does not export them.
 */

/**
 * @file state.js
 * @description Core primitives used across the application.
 * @module core/state
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { deepClone } from '../utils/json.js';

export function createStateStore({ maxHistory = 50 } = {}) {
  let state = null;
  let history = [];
  let pointer = -1;
  const subscribers = new Set();

  function init(initialState) {
    state = deepClone(initialState);
    history = [deepClone(state)];
    pointer = 0;
    notify({ _init: true });
  }

  function get(key) {
    if (!state) return null;
    return key ? state[key] : state;
  }

  function snapshot() {
    return deepClone(state);
  }

  function pushHistory(next) {
    history = history.slice(0, pointer + 1);
    history.push(deepClone(next));
    if (history.length > maxHistory) history.shift();
    pointer = history.length - 1;
  }

  function set(patch, { skipHistory = false } = {}) {
    if (!state) throw new Error('State not initialized');
    const next = { ...state, ...deepClone(patch || {}) };
    state = next;
    if (!skipHistory) pushHistory(next);
    notify(patch || {});
  }

  function replace(nextState, { skipHistory = false } = {}) {
    state = deepClone(nextState);
    if (!skipHistory) pushHistory(state);
    notify({ _replace: true });
  }

  function undo() {
    if (pointer <= 0) return false;
    pointer -= 1;
    state = deepClone(history[pointer]);
    notify({ _undo: true });
    return true;
  }

  function redo() {
    if (pointer >= history.length - 1) return false;
    pointer += 1;
    state = deepClone(history[pointer]);
    notify({ _redo: true });
    return true;
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function notify(changes) {
    subscribers.forEach(fn => {
      try {
        fn(changes, state);
      } catch (err) {
        console.error('[StateStore] subscriber error', err);
      }
    });
  }

  return { init, get, set, replace, snapshot, undo, redo, subscribe };
}

export const StateStore = createStateStore();
