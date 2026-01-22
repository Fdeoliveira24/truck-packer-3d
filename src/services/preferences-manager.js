import * as StateStore from '../core/state-store.js';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

function get() {
  return StateStore.get('preferences');
}

function set(nextPrefs) {
  StateStore.set({ preferences: nextPrefs });
}

export { applyTheme, get, set };

export default { applyTheme, get, set };
