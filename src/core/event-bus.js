/**
 * • LEGACY / NOT USED BY CURRENT RUNTIME IMPORT CHAIN
 * • Do NOT import this file unless you also reconcile storage/session APIs and key strategy.
 * • If applicable: This module expects readJson/writeJson/removeKey from storage, but current core storage does not export them.
 */

/**
 * @file event-bus.js
 * @description Core primitives used across the application.
 * @module core/event-bus
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function createEventBus() {
  const listeners = new Map();

  function on(eventName, handler) {
    const key = String(eventName || '');
    if (!key) return () => {};
    const set = listeners.get(key) || new Set();
    set.add(handler);
    listeners.set(key, set);
    return () => off(key, handler);
  }

  function off(eventName, handler) {
    const key = String(eventName || '');
    const set = listeners.get(key);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) listeners.delete(key);
  }

  function emit(eventName, payload) {
    const key = String(eventName || '');
    const set = listeners.get(key);
    if (!set) return;
    set.forEach(handler => {
      try {
        handler(payload);
      } catch (err) {
        console.error('[EventBus] handler error', err);
      }
    });
  }

  return { on, off, emit };
}

export const EventBus = createEventBus();
