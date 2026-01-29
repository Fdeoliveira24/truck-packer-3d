/**
 * @file case-library.js
 * @description UI-free service module for case library operations and state updates.
 * @module services/case-library
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as StateStore from '../core/state-store.js';
import * as Utils from '../core/utils/index.js';
import * as CoreDefaults from '../core/defaults.js';

function applyCaseDefaultColor(caseObj) {
  const next = { ...(caseObj || {}) };
  const existing = String(next.color || '').trim();
  if (existing) return next;
  const key =
    String(next.category || 'default')
      .trim()
      .toLowerCase() || 'default';
  const cats = CoreDefaults.categories || [];
  const found = cats.find(c => c.key === key) || cats.find(c => c.key === 'default');
  next.color = (found && found.color) || '#9ca3af';
  return next;
}

export function getCases() {
  return StateStore.get('caseLibrary') || [];
}

export function getById(caseId) {
  return getCases().find(c => c.id === caseId) || null;
}

export function upsert(caseData) {
  const now = Date.now();
  const cases = getCases();
  const idx = cases.findIndex(c => c.id === caseData.id);
  const next = applyCaseDefaultColor({ ...caseData });
  next.updatedAt = now;
  if (!next.createdAt) next.createdAt = now;
  next.dimensions = {
    length: Number(next.dimensions.length) || 0,
    width: Number(next.dimensions.width) || 0,
    height: Number(next.dimensions.height) || 0,
  };
  next.weight = Number(next.weight) || 0;
  next.volume = Utils.volumeInCubicInches(next.dimensions);

  const nextCases = idx > -1 ? cases.map((c, i) => (i === idx ? next : c)) : [...cases, next];

  StateStore.set({ caseLibrary: nextCases });
}

export function reassignCategory(oldKey, newKey) {
  const from = oldKey ? oldKey.trim().toLowerCase() : '';
  const to = newKey ? newKey.trim().toLowerCase() : 'default';
  if (!from || from === to) return;
  const next = getCases().map(c => (c.category === from ? { ...c, category: to } : c));
  StateStore.set({ caseLibrary: next });
}

export function remove(caseId) {
  const cases = getCases().filter(c => c.id !== caseId);
  StateStore.set({ caseLibrary: cases });
}

export function duplicate(caseId) {
  const original = getById(caseId);
  if (!original) return null;
  const now = Date.now();
  const copy = {
    ...Utils.deepClone(original),
    id: Utils.uuid(),
    name: original.name + ' (Copy)',
    createdAt: now,
    updatedAt: now,
  };
  upsert(copy);
  return copy;
}

export function search(query, categoryKeys) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const cats = (categoryKeys || []).filter(k => k && k !== 'all');
  return getCases().filter(c => {
    const matchesQ = !q || (c.name || '').toLowerCase().includes(q) || (c.manufacturer || '').toLowerCase().includes(q);
    const matchesCat = !cats.length || cats.includes(c.category);
    return matchesQ && matchesCat;
  });
}

export function countsByCategory() {
  const counts = {};
  getCases().forEach(c => {
    counts[c.category] = (counts[c.category] || 0) + 1;
  });
  return counts;
}
