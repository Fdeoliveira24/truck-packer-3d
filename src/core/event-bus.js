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
