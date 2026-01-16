const KNOWN_SCREENS = new Set(['packs', 'cases', 'editor', 'updates', 'roadmap', 'settings']);

export const Router = {
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

  init({ onScreen, defaultScreen = 'packs' } = {}) {
    const handler = () => {
      const screen = Router.getScreenFromHash(defaultScreen);
      try {
        onScreen && onScreen(screen);
      } catch (err) {
        console.error('[Router] onScreen error', err);
      }
    };

    window.addEventListener('hashchange', handler);
    handler();
    return () => window.removeEventListener('hashchange', handler);
  },
};
