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
import * as CategoryService from './category-service.js';
import {
  applyCanonicalCargoFields,
  pickSafeExtensions,
  CANONICAL_CASE_KEYS,
  parseCargoDimension,
  parseCargoNonNegNumber,
  WEIGHT_MAX_LBS,
  caseSafeReuseEqual,
} from '../core/cargo-canonical.js';
import {
  assertBusinessIdentityValue,
  assertItemCodeAvailable,
  normalizeBusinessIdentityComparison,
} from '../core/business-identity.js';

// Canonicalize the known cargo-rule fields in place before storage, leaving any
// other (including unknown extension) fields untouched. Routes through the single
// typed canonical representation so storage matches comparison/import exactly
// ("false" never becomes true, malformed numbers never become a silent 0, decimal
// stack counts are floored consistently), without applying a fixed-object
// normalizer that would drop unknown fields.
function canonicalizeCaseCargoFields(c) {
  return applyCanonicalCargoFields(c);
}

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

function normalizeCategoryFilterKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function getCases() {
  return StateStore.get('caseLibrary') || [];
}

export function getById(caseId) {
  return getCases().find(c => c.id === caseId) || null;
}

// Pure: produce the canonical, storage-ready case object WITHOUT touching state.
// Used by upsert and by atomic import preflight so a case can be fully prepared
// (and validated) before any commit. Guards a missing dimensions object so a
// malformed case never throws mid-loop and leaves a partial mutation behind.
export function buildStorableCase(caseData) {
  const now = Date.now();
  const next = canonicalizeCaseCargoFields(applyCaseDefaultColor({ ...caseData }));
  next.itemCode = assertBusinessIdentityValue(next.itemCode, {
    field: 'itemCode',
    required: false,
  });
  next.updatedAt = now;
  if (!next.createdAt) next.createdAt = now;
  // Route dimensions/weight through the same typed canonical parsers used for
  // every other cargo field (cargo-canonical.js) rather than a bare Number()
  // coercion: negative/non-finite input becomes a safe 0 instead of silently
  // storing a negative dimension, and absurd input is clamped to the same
  // data-sanity limit used everywhere else (single source of truth for what
  // "storable" means, so a spreadsheet/JSON import can never bypass it).
  const dims = next.dimensions && typeof next.dimensions === 'object' ? next.dimensions : {};
  next.dimensions = {
    length: parseCargoDimension(dims.length).value,
    width: parseCargoDimension(dims.width).value,
    height: parseCargoDimension(dims.height).value,
  };
  next.weight = parseCargoNonNegNumber(next.weight, { max: WEIGHT_MAX_LBS }).value;
  next.volume = Utils.volumeInCubicInches(next.dimensions);
  // Sanitize unknown extension fields at the storage boundary: keep approved safe
  // metadata, but drop functions, prototype keys, symbols and non-finite values so
  // stored cases stay JSON/structuredClone-safe (autosave) and never carry
  // executable values. Done in place so known canonical fields keep their types.
  const safeExtensions = pickSafeExtensions(next, CANONICAL_CASE_KEYS);
  const rec = /** @type {Record<string, unknown>} */ (next);
  for (const k of Object.keys(rec)) {
    if (!CANONICAL_CASE_KEYS.has(k)) delete rec[k];
  }
  Object.assign(next, safeExtensions);
  return next;
}

// Pure: canonicalize + identity-validate one Case (insert or update) against a
// given cases array, without touching state. Shared by upsert() and by the
// atomic Case/category commit paths below so every write path enforces the
// same canonical storage and itemCode-uniqueness rules.
function prepareCaseUpsert(caseData, cases) {
  const idx = cases.findIndex(c => c.id === caseData.id);
  const next = buildStorableCase(caseData);
  next.itemCode = assertItemCodeAvailable(next.itemCode, cases, { excludeId: next.id });
  const nextCases = idx > -1 ? cases.map((c, i) => (i === idx ? next : c)) : [...cases, next];
  return { case: next, cases: nextCases };
}

export function upsert(caseData) {
  const { cases: nextCases } = prepareCaseUpsert(caseData, getCases());
  StateStore.set({ caseLibrary: nextCases });
}

// Atomically commit one Case (insert or update, through the same canonical
// build/identity checks as upsert()) together with an optional category
// change, as a single significant StateStore write — one history entry, one
// Undo/Redo step for the whole logical Save.
export function commitCaseWithCategory(caseData, categoryUpdate) {
  const { case: next, cases: nextCases } = prepareCaseUpsert(caseData, getCases());
  const setPatch = { caseLibrary: nextCases };
  let category = null;
  if (categoryUpdate) {
    const calculated = CategoryService.calculateUpsert(categoryUpdate);
    category = calculated.category;
    if (calculated.preferences) setPatch.preferences = calculated.preferences;
  }
  StateStore.set(setPatch);
  return { case: next, category };
}

// Atomically commit a batch of EXISTING Case template patches (matched by id;
// a patch whose id has no existing match is skipped, mirroring the existing
// per-case "case not found" skip) together with an optional category change,
// as a single significant StateStore write — used by Editor Set Category so
// every affected Case template and the category commit as one logical
// mutation with one Undo/Redo step, never a partially-reverted selection.
export function commitCasesWithCategory(casePatches, categoryUpdate) {
  const patches = Array.isArray(casePatches) ? casePatches : [];
  let cases = getCases();
  const updated = [];
  patches.forEach(patch => {
    const existing = cases.find(c => c.id === patch.id);
    if (!existing) return;
    const { case: next, cases: nextCases } = prepareCaseUpsert({ ...existing, ...patch }, cases);
    cases = nextCases;
    updated.push(next);
  });

  const setPatch = {};
  let category = null;
  if (categoryUpdate) {
    const calculated = CategoryService.calculateUpsert(categoryUpdate);
    category = calculated.category;
    if (calculated.preferences) setPatch.preferences = calculated.preferences;
  }
  if (updated.length) setPatch.caseLibrary = cases;
  if (Object.keys(setPatch).length) StateStore.set(setPatch);
  return { cases: updated, category };
}

export function reassignCategory(oldKey, newKey) {
  const from = normalizeCategoryFilterKey(oldKey);
  const to = normalizeCategoryFilterKey(newKey) || 'default';
  if (!from || from === to) return;
  const next = getCases().map(c => (normalizeCategoryFilterKey(c.category || 'default') === from ? { ...c, category: to } : c));
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
    itemCode: null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(copy);
  return copy;
}

export function search(query, categoryKeys) {
  const q = normalizeBusinessIdentityComparison(query);
  const cats = (categoryKeys || [])
    .map(normalizeCategoryFilterKey)
    .filter(k => k && k !== 'all');
  const matchesValue = value => {
    const normalized = normalizeBusinessIdentityComparison(value);
    return q != null && normalized != null && normalized.includes(q);
  };
  return getCases().filter(c => {
    const matchesQ = q == null || matchesValue(c.name) || matchesValue(c.manufacturer) || matchesValue(c.itemCode);
    const caseCategory = normalizeCategoryFilterKey(c.category || 'default') || 'default';
    const matchesCat = !cats.length || cats.includes(caseCategory);
    return matchesQ && matchesCat;
  });
}

export function countsByCategory() {
  const counts = {};
  getCases().forEach(c => {
    const key = normalizeCategoryFilterKey(c.category || 'default') || 'default';
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

// ============================================================================
// SECTION: CASE CATALOG IMPORT (Milestone C — portable Case Catalog exchange)
// ============================================================================

// An incoming case definition is only considered for import when it has a
// non-blank id and finite positive dimensions. Unlike the manual-entry
// case-modal path (which invents a plausible default box for a blank form),
// an imported record with missing/invalid geometry must never be silently
// given fabricated dimensions — it is rejected as its own record instead.
function hasValidCaseGeometry(c) {
  if (!c || typeof c !== 'object') return false;
  const d = c.dimensions;
  if (!d || typeof d !== 'object') return false;
  const ok = v => Number.isFinite(Number(v)) && Number(v) > 0;
  return ok(d.length) && ok(d.width) && ok(d.height);
}

// Mirrors planPackImport's accepted category policy: only explicitly stored
// destination customizations count as local ownership; missing keys may be
// added, while same-key name/color differences are disclosed and kept local.
function planPortableCategoryImport(incomingCategories) {
  const rawPreferences = StateStore.get('preferences') || {};
  const localCategories = new Map(
    (Array.isArray(rawPreferences.categories) ? rawPreferences.categories : [])
      .filter(c => c && c.key)
      .map(c => [String(c.key).trim().toLowerCase(), c])
  );
  const categoriesToAdd = [];
  const categoryConflicts = [];
  const seenCategoryKeys = new Set();
  (Array.isArray(incomingCategories) ? incomingCategories : []).forEach(cat => {
    const key = String((cat && cat.key) || '').trim().toLowerCase();
    if (!key || seenCategoryKeys.has(key)) return;
    seenCategoryKeys.add(key);
    const local = localCategories.get(key);
    if (!local) {
      categoriesToAdd.push({ key, name: cat.name || null, color: cat.color || null });
      return;
    }
    const nameDiffers = cat.name && String(cat.name).trim() !== String(local.name || '').trim();
    const colorDiffers =
      cat.color && String(cat.color).trim().toLowerCase() !== String(local.color || '').trim().toLowerCase();
    if (nameDiffers || colorDiffers) {
      categoryConflicts.push({
        key,
        localName: local.name,
        localColor: local.color,
        importedName: cat.name || null,
        importedColor: cat.color || null,
      });
    }
  });
  return { categoriesToAdd, categoryConflicts };
}

/**
 * PURE preflight: plan a Case Catalog import against the current Case Library
 * without mutating state. Cases are independent records — unlike a Load Plan
 * import there is no single-transaction atomicity requirement, so each
 * incoming case is evaluated on its own: an unresolvable conflict rejects
 * only that record while every other record still imports (matches
 * business-identity-contract-v1.md §8 rules 9/11 — unaffected records
 * continue within the same import).
 *
 * Reuse/conflict semantics mirror planPackImport's bundled-case handling
 * (pack-library.js) so the two import paths never silently diverge: same id
 * with safe-reuse-equal cargo -> reuse; same name (different id) with
 * safe-reuse-equal cargo -> reuse; otherwise a brand-new case is created, or
 * — on an id/name collision with materially different cargo — a renamed copy
 * is created and reported as a conflict. A local Case is never silently
 * overwritten, and Item Code uniqueness is enforced exactly like any other
 * case creation (see core/business-identity.js); a case whose Item Code
 * cannot be safely resolved is rejected rather than silently renumbered.
 * @param {Record<string, any>[]} incomingCases
 * @param {{ key?: string, name?: string|null, color?: string|null }[]} [incomingCategories]
 */
export function planCaseCatalogImport(incomingCases, incomingCategories = []) {
  const list = Array.isArray(incomingCases) ? incomingCases : [];
  const currentCases = getCases();
  const caseById = new Map(currentCases.map(c => [c.id, c]));
  const caseByName = new Map(currentCases.map(c => [String(c.name || '').trim().toLowerCase(), c]));
  const newCases = [];
  const reused = [];
  const conflicts = [];
  const rejected = [];
  const { categoriesToAdd, categoryConflicts } = planPortableCategoryImport(incomingCategories);

  const makeUniqueImportedName = name => {
    const base = String(name || 'Imported Case').trim() || 'Imported Case';
    let candidate = `${base} (Imported)`;
    let n = 2;
    while (caseByName.has(candidate.trim().toLowerCase())) {
      candidate = `${base} (Imported ${n})`;
      n += 1;
    }
    return candidate;
  };

  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || !String(raw.id || '').trim()) {
      rejected.push({ index, id: raw && raw.id, name: raw && raw.name, reason: 'missing or invalid id', raw });
      return;
    }
    if (!hasValidCaseGeometry(raw)) {
      rejected.push({ index, id: raw.id, name: raw.name, reason: 'missing or invalid dimensions', raw });
      return;
    }

    const nameKey = String(raw.name || '').trim().toLowerCase();
    const localById = caseById.get(raw.id);
    const localByName = nameKey ? caseByName.get(nameKey) : null;

    if (localById && caseSafeReuseEqual(localById, raw)) {
      reused.push({ id: raw.id, name: raw.name, matchedId: localById.id, reason: 'already present (identical)', raw });
      return;
    }
    if (!localById && localByName && caseSafeReuseEqual(localByName, raw)) {
      reused.push({ id: raw.id, name: raw.name, matchedId: localByName.id, reason: 'matches existing case by name', raw });
      return;
    }

    const conflictKind = localById ? 'id-conflict' : (localByName ? 'name-conflict' : null);
    const copy = Utils.deepClone(raw);
    if (conflictKind) {
      copy.id = Utils.uuid();
      copy.name = makeUniqueImportedName(raw.name);
    }

    let storable;
    try {
      storable = buildStorableCase(copy);
      storable.itemCode = assertItemCodeAvailable(storable.itemCode, [...currentCases, ...newCases]);
    } catch (err) {
      rejected.push({ index, id: raw.id, name: raw.name, reason: (err && err.message) || 'could not be imported', raw });
      return;
    }

    newCases.push(storable);
    caseById.set(storable.id, storable);
    const newNameKey = String(storable.name || '').trim().toLowerCase();
    if (newNameKey) caseByName.set(newNameKey, storable);
    if (conflictKind) {
      conflicts.push({
        kind: conflictKind,
        importedId: raw.id,
        importedName: String(raw.name || ''),
        newId: storable.id,
        newName: storable.name,
      });
    }
  });

  return {
    currentCases,
    newCases,
    finalCases: [...currentCases, ...newCases],
    reused,
    conflicts,
    rejected,
    categoriesToAdd,
    categoryConflicts,
    incomingCategories: Array.isArray(incomingCategories) ? incomingCategories : [],
  };
}

/** Commit an already-previewed Case Catalog plan without recomputing Case decisions. */
export function commitCaseCatalogImportPlan(plan) {
  if (plan.newCases.length) {
    StateStore.set({ caseLibrary: plan.finalCases });
  }
  // Additive-only metadata merge. CategoryService preserves every unrelated
  // preference field. Re-check the current preferences at commit time so a
  // same-workspace customization made after preview is never overwritten.
  const categoryPlan = planPortableCategoryImport(plan.incomingCategories);
  plan.categoriesToAdd = categoryPlan.categoriesToAdd;
  plan.categoryConflicts = categoryPlan.categoryConflicts;
  plan.categoriesToAdd.forEach(cat => CategoryService.upsert(cat));
  return plan;
}

/** Plan + commit a Case Catalog import using the same category policy as Load Plans. */
export function importCaseCatalogPayload(incomingCases, incomingCategories = []) {
  return commitCaseCatalogImportPlan(planCaseCatalogImport(incomingCases, incomingCategories));
}
