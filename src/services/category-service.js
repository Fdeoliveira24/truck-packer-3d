/**
 * @file category-service.js
 * @description UI-free service module for category service operations and state updates.
 * @module services/category-service
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as StateStore from '../core/state-store.js';
import * as Defaults from '../core/defaults.js';

// Shared with the Workspace Backup projection (see core/defaults.js).
const normalizeKey = Defaults.normalizeCategoryKey;
const normalizeHex = Defaults.normalizeCategoryColor;
const colorForKey = Defaults.categoryFallbackColor;

function ensureDefault(list) {
  const hasDefault = list.some(c => normalizeKey(c.key) === 'default');
  if (!hasDefault) {
    list.unshift({ key: 'default', name: 'Default', color: colorForKey('default') });
  }
  return list;
}

function getPreferences() {
  return StateStore.get('preferences') || {};
}

function savePreferences(nextPrefs) {
  StateStore.set({ preferences: nextPrefs });
}

export function all() {
  const prefs = getPreferences();
  const prefCats = Array.isArray(prefs && prefs.categories) ? prefs.categories : [];
  const seeded = prefCats.length
    ? prefCats
    : (Defaults.categories || []).filter(c => c.key !== 'all').map(c => ({ key: c.key, name: c.name, color: c.color }));
  const dedup = new Map();
  seeded.forEach(c => {
    const k = normalizeKey(c.key || c.name);
    if (!k) return;
    const color = normalizeHex(c.color) || colorForKey(k);
    dedup.set(k, {
      key: k,
      name: c.name || Defaults.categoryFallbackName(k),
      color,
    });
  });
  return ensureDefault(Array.from(dedup.values()));
}

export function meta(key) {
  const k = normalizeKey(key) || 'default';
  const found = all().find(c => c.key === k);
  if (found) return found;
  if (k === 'default') return { key: 'default', name: 'Default', color: colorForKey('default') };
  return { key: k, name: Defaults.categoryFallbackName(k), color: colorForKey(k) };
}

export function listWithCounts(cases) {
  const counts = {};
  (cases || []).forEach(c => {
    const k = normalizeKey(c.category || 'default') || 'default';
    counts[k] = (counts[k] || 0) + 1;
  });
  const known = all();
  const ordered = known
    .map(c => c.key)
    .filter(k => k)
    .concat(Object.keys(counts).filter(k => !known.find(c => c.key === k)));
  return ordered.filter((k, idx, arr) => arr.indexOf(k) === idx).map(k => ({ ...meta(k), count: counts[k] || 0 }));
}

// Pure: the next preferences an EMPTY Case Library should publish (category
// list reset to Default only), or null when nothing needs to change. Lets the
// Case deletion transition bundle the reset into its single StateStore.set()
// (one history entry), so rendering an empty library never has to write it.
export function calculateResetToDefaultIfNoCases(cases) {
  if (Array.isArray(cases) && cases.length > 0) return null;
  const defaultCategory = meta('default');
  const nextDefault = {
    key: 'default',
    name: 'Default',
    color: normalizeHex(defaultCategory.color) || colorForKey('default'),
  };
  const prefs = getPreferences() || {};
  const current = Array.isArray(prefs.categories) ? prefs.categories : [];
  const alreadyDefaultOnly =
    current.length === 1 &&
    normalizeKey(current[0].key || current[0].name) === 'default' &&
    normalizeHex(current[0].color) === nextDefault.color;
  if (alreadyDefaultOnly) return null;
  return { ...prefs, categories: [nextDefault] };
}

export function resetToDefaultIfNoCases(cases) {
  const nextPreferences = calculateResetToDefaultIfNoCases(cases);
  if (!nextPreferences) return false;
  savePreferences(nextPreferences);
  return true;
}

// Pure: compute the resulting category and the full next preferences object
// for an upsert, without publishing it. Reused by upsert() and by
// CaseLibrary's atomic Case/category commit paths so a Case Save or Set
// Category action can bundle the category change into the SAME
// StateStore.set() call as the Case write (one history entry, not two).
function calculateUpsertResult({ key, name, color }) {
  const k = normalizeKey(key || name) || 'default';
  if (!k) return { category: meta('default'), preferences: null };
  const list = all();
  const colorHex = normalizeHex(color) || meta(k).color || colorForKey(k);
  const next = { key: k, name: name || meta(k).name, color: colorHex };
  const idx = list.findIndex(c => c.key === k);
  if (idx > -1) list[idx] = next;
  else list.push(next);
  const prefs = getPreferences() || {};
  return { category: next, preferences: { ...prefs, categories: ensureDefault(list) } };
}

export function calculateUpsert(input) {
  return calculateUpsertResult(input);
}

export function upsert({ key, name, color }) {
  const { category, preferences } = calculateUpsertResult({ key, name, color });
  if (preferences) savePreferences(preferences);
  return category;
}

function reassignCategoryInCases(from, to) {
  const cases = StateStore.get('caseLibrary') || [];
  const fromKey = normalizeKey(from);
  const toKey = normalizeKey(to) || 'default';
  const next = cases.map(c => (normalizeKey(c.category) === fromKey ? { ...c, category: toKey } : c));
  StateStore.set({ caseLibrary: next });
}

export function remove(key) {
  const k = normalizeKey(key);
  if (!k || k === 'default') return; // never remove default
  const list = ensureDefault(all().filter(c => c.key !== k));
  const prefs = getPreferences() || {};
  savePreferences({ ...prefs, categories: list });
  reassignCategoryInCases(k, 'default');
}

export function rename(oldKey, name, color) {
  const from = normalizeKey(oldKey);
  if (!from) return meta('default');
  if (from === 'default') {
    upsert({ key: 'default', name, color });
    return meta('default');
  }
  const to = normalizeKey(name) || from;
  const list = all();
  const fromEntry = list.find(c => c.key === from) || meta(from);
  const existingTo = list.find(c => c.key === to);

  const updatedList = list.filter(c => c.key !== from);
  const colorHex =
    normalizeHex(color) || (existingTo && normalizeHex(existingTo.color)) || fromEntry.color || colorForKey(to);
  if (existingTo && to !== from) {
    // Merge into existing, update name/color if provided
    const merged = {
      ...existingTo,
      name: name || existingTo.name,
      color: colorHex,
    };
    const filtered = updatedList.filter(c => c.key !== to);
    filtered.push(merged);
    savePreferences({ ...getPreferences(), categories: ensureDefault(filtered) });
  } else {
    const next = { key: to, name: name || fromEntry.name || meta(to).name, color: colorHex };
    updatedList.push(next);
    savePreferences({ ...getPreferences(), categories: ensureDefault(updatedList) });
  }

  if (from !== to) reassignCategoryInCases(from, to);
  return meta(to);
}

export default {
  all,
  meta,
  listWithCounts,
  calculateResetToDefaultIfNoCases,
  resetToDefaultIfNoCases,
  upsert,
  remove,
  rename,
};
