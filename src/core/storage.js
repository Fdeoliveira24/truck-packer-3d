import { safeJsonParse, sanitizeJSON } from '../utils/json.js';

export function readJson(key, fallback = null) {
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const parsed = sanitizeJSON(safeJsonParse(raw, fallback));
  return parsed == null ? fallback : parsed;
}

export function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function removeKey(key) {
  window.localStorage.removeItem(key);
}
