import * as StateStore from '../core/state-store.js';
import * as Defaults from '../core/defaults.js';

const normalize = key => String(key || '').trim().toLowerCase();

function hashHue(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function colorFor(key, fallback) {
  if (fallback) return fallback;
  const hue = hashHue(key);
  return `hsl(${hue}, 72%, 56%)`;
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
    const k = normalize(c.key || c.name);
    if (!k) return;
    dedup.set(k, {
      key: k,
      name: c.name || (k.charAt(0).toUpperCase() + k.slice(1)),
      color: c.color || colorFor(k),
    });
  });
  return Array.from(dedup.values());
}

export function meta(key) {
  const k = normalize(key);
  const found = all().find(c => c.key === k);
  if (found) return found;
  return { key: k, name: k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Uncategorized', color: colorFor(k) };
}

export function listWithCounts(cases) {
  const counts = {};
  (cases || []).forEach(c => {
    const k = normalize(c.category || 'default');
    counts[k] = (counts[k] || 0) + 1;
  });
  const known = all();
  const ordered = known.map(c => c.key).filter(k => k).concat(Object.keys(counts).filter(k => !known.find(c => c.key === k)));
  return ordered
    .filter((k, idx, arr) => arr.indexOf(k) === idx)
    .map(k => ({ ...meta(k), count: counts[k] || 0 }));
}

export function upsert({ key, name, color }) {
  const k = normalize(key || name);
  if (!k) return meta('default');
  const list = all();
  const next = { key: k, name: name || meta(k).name, color: color || meta(k).color };
  const idx = list.findIndex(c => c.key === k);
  if (idx > -1) list[idx] = next;
  else list.push(next);
  const prefs = getPreferences() || {};
  savePreferences({ ...prefs, categories: list });
  return next;
}

function reassignCategoryInCases(from, to) {
  const cases = StateStore.get('caseLibrary') || [];
  const next = cases.map(c => (c.category === from ? { ...c, category: to } : c));
  StateStore.set({ caseLibrary: next });
}

export function remove(key) {
  const k = normalize(key);
  if (!k || k === 'default') return; // never remove default
  const list = all().filter(c => c.key !== k);
  const prefs = getPreferences() || {};
  savePreferences({ ...prefs, categories: list });
  reassignCategoryInCases(k, 'default');
}

export function rename(oldKey, name, color) {
  const from = normalize(oldKey);
  const to = normalize(name || oldKey);
  if (!from) return meta('default');
  const list = all().filter(c => c.key !== from);
  const next = { key: to, name: name || meta(to).name, color: color || meta(to).color };
  list.push(next);
  const prefs = getPreferences() || {};
  savePreferences({ ...prefs, categories: list });
  if (from !== to) reassignCategoryInCases(from, to);
  return next;
}

export default { all, meta, listWithCounts, upsert, remove, rename };
