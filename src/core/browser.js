/**
 * @file browser.js
 * @description Core primitives used across the application.
 * @module core/browser
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Browser-dependent utilities extracted from app.js

export function uuid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  const buf = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

export function debounce(fn, waitMs) {
  let t = null;
  let pendingArgs = null;
  let pendingThis = null;

  function invokePending() {
    if (!pendingArgs) return undefined;
    const args = pendingArgs;
    const receiver = pendingThis;
    pendingArgs = null;
    pendingThis = null;
    return fn.apply(receiver, args);
  }

  function debounced(...args) {
    window.clearTimeout(t);
    pendingArgs = args;
    pendingThis = this;
    t = window.setTimeout(() => {
      t = null;
      invokePending();
    }, waitMs);
  }

  debounced.flush = () => {
    if (t === null) return undefined;
    window.clearTimeout(t);
    t = null;
    return invokePending();
  };

  debounced.cancel = () => {
    if (t !== null) window.clearTimeout(t);
    t = null;
    pendingArgs = null;
    pendingThis = null;
  };

  return debounced;
}

export function formatRelativeTime(ts) {
  if (!ts) return '—';
  const delta = Date.now() - ts;
  const s = Math.floor(delta / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Browser code can only start a download; it cannot observe the file reaching
// disk. Callers report "download started", never "saved".
//
// A Blob URL revoked in the same task as the click can cancel the download in
// some browsers, so it is revoked later. 40 s matches the FileSaver behavior
// jsPDF uses for PDF downloads.
export const OBJECT_URL_REVOKE_DELAY_MS = 40000;
// A started download holds its action key briefly so a double click cannot
// start an identical second download; a deliberate re-export is unaffected.
export const DOWNLOAD_ACTION_HOLD_MS = 1000;

function clickDownloadAnchor(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  try {
    document.body.appendChild(a);
    a.click();
  } finally {
    if (a.parentNode) a.parentNode.removeChild(a);
  }
}

export function downloadBlob(filename, blob) {
  if (!blob || !(blob.size > 0)) throw new Error('The export file is empty. Nothing was downloaded.');
  const url = URL.createObjectURL(blob);
  try {
    clickDownloadAnchor(url, filename);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}

export function downloadText(filename, text, mime = 'application/json') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadDataUrl(dataUrl, filename) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('The export image is empty. Nothing was downloaded.');
  }
  clickDownloadAnchor(dataUrl, filename);
}

/**
 * Single-activation guard for user download actions. While a key's action runs,
 * and for `holdMs` after it reports a started download, repeat activations are
 * ignored. An action that returns false or throws releases its key at once so
 * the user can retry. Nothing is persisted.
 * @param {{ holdMs?: number, schedule?: (fn: () => void, ms: number) => any }} [options]
 */
export function createDownloadActionGuard({
  holdMs = DOWNLOAD_ACTION_HOLD_MS,
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  const active = new Set();
  return {
    isActive: key => active.has(key),
    /**
     * @param {string} key
     * @param {() => boolean|void} action
     * @returns {boolean} whether a download was started by this activation
     */
    run(key, action) {
      if (active.has(key)) return false;
      active.add(key);
      let started = false;
      try {
        started = action() !== false;
        return started;
      } finally {
        if (started) schedule(() => active.delete(key), holdMs);
        else active.delete(key);
      }
    },
  };
}

export const downloadActionGuard = createDownloadActionGuard();

export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch (_) {
    return false;
  }
}

export function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
