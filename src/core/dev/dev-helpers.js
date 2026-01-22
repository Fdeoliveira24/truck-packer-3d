/**
 * @file dev-helpers.js
 * @description Optional dev-only helpers for diagnostics and guardrails (disabled by default).
 * @module core/dev/dev-helpers
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function isDebugEnabled() {
  try {
    const q = globalThis.location && typeof globalThis.location.search === 'string' ? globalThis.location.search : '';
    const hasQuery = /\bdebug=1\b/.test(q);
    const hasStorage = globalThis.localStorage && globalThis.localStorage.getItem('tp3dDebug') === '1';
    return Boolean(hasQuery || hasStorage);
  } catch {
    return false;
  }
}

export function installDevHelpers({ app, stateStore, Utils, documentRef } = {}) {
  if (!isDebugEnabled()) return { enabled: false };

  try {
    if (typeof globalThis.__tp3dAssertCore === 'function') return { enabled: true, alreadyInstalled: true };
  } catch {
    // If we can't mark installation, continue without crashing.
  }

  const getDoc = () => {
    if (documentRef) return documentRef;
    return typeof globalThis.document !== 'undefined' ? globalThis.document : null;
  };

  const getState = () => {
    try {
      if (stateStore && typeof stateStore.get === 'function') return stateStore.get();
      return null;
    } catch {
      return null;
    }
  };

  globalThis.__tp3dAssertCore = () => {
    const report = {
      enabled: true,
      time: Date.now(),
      utilsUuidOk: Boolean(Utils && typeof Utils.uuid === 'function'),
      modalRootOk: false,
      toastContainerOk: false,
      hasState: Boolean(getState()),
      hasApp: Boolean(app),
    };

    try {
      const doc = getDoc();
      report.modalRootOk = Boolean(doc && doc.getElementById && doc.getElementById('modal-root'));
      report.toastContainerOk = Boolean(doc && doc.getElementById && doc.getElementById('toast-container'));
    } catch {
      // ignore
    }

    try {
      console.log('[TP3D] __tp3dAssertCore report', report);
    } catch {
      // ignore
    }

    return report;
  };

  return { enabled: true };
}
