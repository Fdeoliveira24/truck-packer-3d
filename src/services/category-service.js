import * as StateStore from '../core/state-store.js';
import * as Defaults from '../core/defaults.js';

const normalizeKey = value => String(value || '').trim().toLowerCase();

function normalizeHex(value) {
  const s = String(value || '').trim().toLowerCase();
  const hexMatch = s.match(/^#?([0-9a-f]{6})$/);
  return hexMatch ? `#${hexMatch[1]}` : null;
}

function colorForKey(key) {
  const k = normalizeKey(key);
  if (k === 'default') {
    const def = (Defaults.categories || []).find(c => normalizeKey(c.key) === 'default');
    const c = def && normalizeHex(def.color);
    return c || '#9ca3af';
  }
  // Tiny hash to deterministic rgb hex
  let h = 0;
  const s = k || 'x';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const r = (h & 0xff).toString(16).padStart(2, '0');
  const g = ((h >> 8) & 0xff).toString(16).padStart(2, '0');
  const b = ((h >> 16) & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

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
    : (Defaults.categories || [])
        .filter(c => c.key !== 'all')
        .map(c => ({ key: c.key, name: c.name, color: c.color }));
  const dedup = new Map();
  seeded.forEach(c => {
    const k = normalizeKey(c.key || c.name);
    if (!k) return;
    const color = normalizeHex(c.color) || colorForKey(k);
    dedup.set(k, {
      key: k,
      name: c.name || (k.charAt(0).toUpperCase() + k.slice(1)),
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
  return { key: k, name: k.charAt(0).toUpperCase() + k.slice(1), color: colorForKey(k) };
}

export function listWithCounts(cases) {
  const counts = {};
  (cases || []).forEach(c => {
    const k = normalizeKey(c.category || 'default') || 'default';
    counts[k] = (counts[k] || 0) + 1;
  });
  const known = all();
  const ordered = known.map(c => c.key).filter(k => k).concat(Object.keys(counts).filter(k => !known.find(c => c.key === k)));
  return ordered
    .filter((k, idx, arr) => arr.indexOf(k) === idx)
    .map(k => ({ ...meta(k), count: counts[k] || 0 }));
}

export function upsert({ key, name, color }) {
  const k = normalizeKey(key || name) || 'default';
  if (!k) return meta('default');
  const list = all();
  const colorHex = normalizeHex(color) || meta(k).color || colorForKey(k);
  const next = { key: k, name: name || meta(k).name, color: colorHex };
  const idx = list.findIndex(c => c.key === k);
  if (idx > -1) list[idx] = next;
  else list.push(next);
  const prefs = getPreferences() || {};
  savePreferences({ ...prefs, categories: ensureDefault(list) });
  return next;
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
  const colorHex = normalizeHex(color) || (existingTo && normalizeHex(existingTo.color)) || fromEntry.color || colorForKey(to);
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

export default { all, meta, listWithCounts, upsert, remove, rename };
