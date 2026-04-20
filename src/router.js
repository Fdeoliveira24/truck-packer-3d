/**
 * @file router.js
 * @description Hash-based router for navigating between application screens.
 * @module router
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

const KNOWN_SCREENS = new Set(['packs', 'cases', 'editor', 'updates', 'roadmap', 'settings']);

export const Router = {
  /**
   * Parse the current window hash and return a structured result.
   * - Empty/bare hash ("", "#", "#/") → { screen: null, isNotFound: false } (no override)
   * - Known screen (e.g. "#/cases")   → { screen: 'cases', isNotFound: false }
   * - Unknown segment                 → { screen: null, isNotFound: true }
   * @returns {{ screen: string | null, isNotFound: boolean }}
   */
  parseHash() {
    const hash = String(window.location.hash || '');
    if (!hash || hash === '#' || hash === '#/') return { screen: null, isNotFound: false };
    const m = hash.match(/^#\/?([a-z0-9-]+)$/i);
    const screen = m ? String(m[1]).toLowerCase() : '';
    if (KNOWN_SCREENS.has(screen)) return { screen, isNotFound: false };
    return { screen: null, isNotFound: true };
  },

  getScreenFromHash(defaultScreen = 'packs') {
    const hash = String(window.location.hash || '');
    const m = hash.match(/^#\/?([a-z0-9-]+)$/i);
    const screen = m ? String(m[1]).toLowerCase() : '';
    return KNOWN_SCREENS.has(screen) ? screen : defaultScreen;
  },

  setScreen(screen) {
    const s = String(screen || '').toLowerCase();
    if (!KNOWN_SCREENS.has(s)) return false;
    const next = `#/${s}`;
    if (window.location.hash === next) return false;
    window.location.hash = next;
    return true;
  },

  replaceScreen(screen) {
    const s = String(screen || '').toLowerCase();
    if (!KNOWN_SCREENS.has(s)) return false;
    const next = `#/${s}`;
    if (window.location.hash === next) return false;
    const url = new URL(window.location.href);
    url.hash = next;
    window.history.replaceState(window.history.state ?? null, '', url.toString());
    return true;
  },

  /**
   * @param {{ onScreen?: (screen: string) => void, onNotFound?: () => void, onNeutral?: () => void }} [opts]
   */
  init({ onScreen, onNotFound, onNeutral } = {}) {
    const handler = () => {
      const { screen, isNotFound } = Router.parseHash();
      if (isNotFound) {
        try {
          onNotFound && onNotFound();
        } catch (err) {
          console.error('[Router] onNotFound error', err);
        }
        return;
      }
      if (screen) {
        // Explicit valid hash (e.g. #/cases) — navigate there
        try {
          onScreen && onScreen(screen);
        } catch (err) {
          console.error('[Router] onScreen error', err);
        }
        return;
      }
      try {
        onNeutral && onNeutral();
      } catch (err) {
        console.error('[Router] onNeutral error', err);
      }
    };

    window.addEventListener('hashchange', handler);
    handler();
    return () => window.removeEventListener('hashchange', handler);
  },
};
