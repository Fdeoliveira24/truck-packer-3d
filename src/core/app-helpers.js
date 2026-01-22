/**
 * @file app-helpers.js
 * @description UI-free helpers hub for diagnostics and lightweight error reporting.
 * @module core/app-helpers
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// ============================================================================
// SECTION: APP HELPERS FACTORY (UI-FREE)
// ============================================================================

export function createAppHelpers(deps = {}) {
  const version = String(deps.APP_VERSION || '');
  const emit = typeof deps.emit === 'function' ? deps.emit : null;
  const getState = typeof deps.getState === 'function' ? deps.getState : () => null;
  const getSession = typeof deps.getSession === 'function' ? deps.getSession : () => null;
  const isDev = Boolean(deps.isDev);

  // ============================================================================
  // SECTION: INTERNALS
  // ============================================================================

  function normalizeError(err, ctx) {
    const e = err && typeof err === 'object' ? err : { message: String(err || '') };
    return {
      message: String(e.message || ''),
      name: String(e.name || 'Error'),
      stack: typeof e.stack === 'string' ? e.stack : '',
      ctx: ctx == null ? null : ctx,
      time: Date.now(),
    };
  }

  function reportError(err, ctx) {
    const normalized = normalizeError(err, ctx);
    try {
      if (emit) emit('app:error', normalized);
    } catch {
      // ignore
    }
    return normalized;
  }

  // ============================================================================
  // SECTION: PUBLIC API
  // ============================================================================

  function runDiagnostics() {
    // NOTE: No DOM reads/writes here. Keep this safe to call anywhere.
    let userAgent = '';
    let platform = '';
    try {
      userAgent = String((navigator && navigator.userAgent) || '');
      platform = String((navigator && navigator.platform) || '');
    } catch {
      // ignore
    }
    return {
      version,
      now: Date.now(),
      env: { isDev, userAgent, platform },
      hasState: Boolean(getState()),
      hasSession: Boolean(getSession()),
    };
  }

  const api = {
    version,
    runDiagnostics,
    reportError,
    env: {
      isDev,
      userAgent: (() => {
        try {
          return String((navigator && navigator.userAgent) || '');
        } catch {
          return '';
        }
      })(),
      platform: (() => {
        try {
          return String((navigator && navigator.platform) || '');
        } catch {
          return '';
        }
      })(),
    },
    now: () => Date.now(),
  };

  function getApi() {
    return api;
  }

  function installGlobals() {
    try {
      if (!globalThis.window) return;
      window.TP3D = window.TP3D || {};
      if (window.TP3D.helpers) return;
      window.TP3D.helpers = api;
    } catch {
      // ignore
    }
  }

  return { installGlobals, getApi, reportError };
}
