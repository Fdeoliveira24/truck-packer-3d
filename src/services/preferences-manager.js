/**
 * @file preferences-manager.js
 * @description UI-free service module for preferences manager operations and state updates.
 * @module services/preferences-manager
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as StateStore from '../core/state-store.js';
import { emit } from '../core/events.js';
import { normalizePreferences } from '../core/normalizer.js';

// NOTE: This service must remain UI-free (no DOM access).
// Theme application is delegated to the UI layer via events.

function applyTheme(theme) {
  // Emit an event the UI layer can react to.
  emit('theme:apply', { theme: theme === 'dark' ? 'dark' : 'light' });
}

function get() {
  // Always return a fully-formed preferences object.
  return normalizePreferences(StateStore.get('preferences'));
}

function set(nextPrefs) {
  const normalized = normalizePreferences(nextPrefs);
  StateStore.set({ preferences: normalized });

  // Notify listeners (UI can update).
  emit('preferences:changed', { preferences: normalized });

  // Convenience: also request theme application if present.
  if (normalized && typeof normalized.theme === 'string') {
    applyTheme(normalized.theme);
  }
}

export { applyTheme, get, set };
export default { applyTheme, get, set };
