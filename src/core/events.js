const listeners = new Map();

function getSet(eventName) {
  if (!listeners.has(eventName)) {
    listeners.set(eventName, new Set());
  }
  return listeners.get(eventName);
}

export function on(eventName, handler) {
  const set = getSet(eventName);
  set.add(handler);
  return () => off(eventName, handler);
}

export function off(eventName, handler) {
  const set = listeners.get(eventName);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) listeners.delete(eventName);
}

export function emit(eventName, payload) {
  const set = listeners.get(eventName);
  if (!set || set.size === 0) return;
  Array.from(set).forEach(fn => {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[Events] handler error for ${eventName}`, err);
    }
  });
}

export function once(eventName, handler) {
  const wrapped = payload => {
    off(eventName, wrapped);
    handler(payload);
  };
  return on(eventName, wrapped);
}

export function clear(eventName) {
  if (typeof eventName === 'string') {
    listeners.delete(eventName);
    return;
  }
  listeners.clear();
}
