/**
 * @file normalizer.js
 * @description Normalization helpers to keep stored data and preferences safe and compatible.
 * @module core/normalizer
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as CoreUtils from './utils/index.js';
import * as CoreDefaults from './defaults.js';
import { uuid } from './browser.js';

const DEFAULT_TRUCK = { length: 636, width: 102, height: 98 };

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function safeString(value, fallback = '') {
  const s = value == null ? '' : String(value);
  const t = s.trim();
  return t || fallback;
}

export function normalizePreferences(prefs) {
  const base = CoreUtils.deepClone(CoreDefaults.defaultPreferences);
  const next = { ...base, ...(prefs && typeof prefs === 'object' ? prefs : {}) };
  next.packsViewMode = next.packsViewMode === 'list' ? 'list' : 'grid';
  next.casesViewMode = next.casesViewMode === 'grid' ? 'grid' : 'list';
  next.packsFiltersVisible = next.packsFiltersVisible !== false;
  next.casesFiltersVisible = next.casesFiltersVisible !== false;
  const baseBadges = base.gridCardBadges || {};
  const inBadges = next.gridCardBadges && typeof next.gridCardBadges === 'object' ? next.gridCardBadges : {};
  const inPacks = inBadges.packs && typeof inBadges.packs === 'object' ? inBadges.packs : {};
  const inCases = inBadges.cases && typeof inBadges.cases === 'object' ? inBadges.cases : {};
  const basePacks = baseBadges.packs && typeof baseBadges.packs === 'object' ? baseBadges.packs : {};
  const baseCases = baseBadges.cases && typeof baseBadges.cases === 'object' ? baseBadges.cases : {};
  next.gridCardBadges = {
    packs: {
      ...basePacks,
      ...inPacks,
    },
    cases: {
      ...baseCases,
      ...inCases,
    },
  };
  const hasLegacyStatLine = Object.prototype.hasOwnProperty.call(inPacks, 'showPackedStatLine');
  const hasNewPacked = Object.prototype.hasOwnProperty.call(inPacks, 'showPacked');
  const hasNewVolume = Object.prototype.hasOwnProperty.call(inPacks, 'showVolume');
  const hasNewWeight = Object.prototype.hasOwnProperty.call(inPacks, 'showWeight');
  const hasLegacyTrailerMode = Object.prototype.hasOwnProperty.call(inPacks, 'showTrailerMode');
  const hasShapeMode = Object.prototype.hasOwnProperty.call(inPacks, 'showShapeMode');
  if (hasLegacyStatLine && !hasNewPacked && !hasNewVolume && !hasNewWeight) {
    const legacy = inPacks.showPackedStatLine !== false;
    next.gridCardBadges.packs.showPacked = legacy;
    next.gridCardBadges.packs.showVolume = legacy;
    next.gridCardBadges.packs.showWeight = legacy;
  }
  if (hasLegacyTrailerMode && !hasShapeMode) {
    next.gridCardBadges.packs.showShapeMode = inPacks.showTrailerMode !== false;
  }
  next.gridCardBadges.packs.showCasesCount = next.gridCardBadges.packs.showCasesCount !== false;
  next.gridCardBadges.packs.showTruckDims = next.gridCardBadges.packs.showTruckDims !== false;
  next.gridCardBadges.packs.showThumbnail = next.gridCardBadges.packs.showThumbnail !== false;
  next.gridCardBadges.packs.showShapeMode = next.gridCardBadges.packs.showShapeMode !== false;
  next.gridCardBadges.packs.showPacked = next.gridCardBadges.packs.showPacked !== false;
  next.gridCardBadges.packs.showVolume = next.gridCardBadges.packs.showVolume !== false;
  next.gridCardBadges.packs.showWeight = next.gridCardBadges.packs.showWeight !== false;
  next.gridCardBadges.packs.showEditedTime = next.gridCardBadges.packs.showEditedTime !== false;
  next.gridCardBadges.cases.showCategory = next.gridCardBadges.cases.showCategory !== false;
  next.gridCardBadges.cases.showDims = next.gridCardBadges.cases.showDims !== false;
  next.gridCardBadges.cases.showVolume = next.gridCardBadges.cases.showVolume !== false;
  next.gridCardBadges.cases.showWeight = next.gridCardBadges.cases.showWeight !== false;
  next.gridCardBadges.cases.showFlip = next.gridCardBadges.cases.showFlip !== false;
  next.gridCardBadges.cases.showEditedTime = next.gridCardBadges.cases.showEditedTime !== false;
  next.units = next.units && typeof next.units === 'object' ? next.units : base.units;
  next.units.length = CoreUtils.lengthUnits.includes(next.units.length) ? next.units.length : base.units.length;
  next.units.weight = CoreUtils.weightUnits.includes(next.units.weight) ? next.units.weight : base.units.weight;
  next.theme = next.theme === 'dark' ? 'dark' : 'light';
  next.labelFontSize = CoreUtils.clamp(finiteNumber(next.labelFontSize, base.labelFontSize), 8, 24);
  next.hiddenCaseOpacity = CoreUtils.clamp(finiteNumber(next.hiddenCaseOpacity, base.hiddenCaseOpacity), 0, 1);
  next.snapping = next.snapping && typeof next.snapping === 'object' ? next.snapping : base.snapping;
  next.snapping.enabled = Boolean(next.snapping.enabled);
  next.snapping.gridSize = Math.max(0.25, finiteNumber(next.snapping.gridSize, base.snapping.gridSize));
  next.camera = next.camera && typeof next.camera === 'object' ? next.camera : base.camera;
  next.camera.defaultView = next.camera.defaultView === 'orthographic' ? 'orthographic' : 'perspective';
  next.export = next.export && typeof next.export === 'object' ? next.export : base.export;
  next.export.screenshotResolution = safeString(next.export.screenshotResolution, base.export.screenshotResolution);
  next.export.pdfIncludeStats = Boolean(next.export.pdfIncludeStats);
  const normalizeCatKey = key =>
    String(key || '')
      .trim()
      .toLowerCase();
  const prefCats = Array.isArray(next.categories) ? next.categories : base.categories;
  next.categories = (prefCats || [])
    .map(c => ({
      key: normalizeCatKey(c.key || c.name),
      name: safeString(c.name, c.key || ''),
      color: safeString(c.color, ''),
    }))
    .filter(c => c.key);
  if (!next.categories.length) {
    next.categories = (CoreDefaults.categories || [])
      .filter(c => c.key !== 'all')
      .map(c => ({ key: c.key, name: c.name, color: c.color }));
  }
  return next;
}

export function normalizeCase(c, now) {
  const createdAt = finiteNumber(c && c.createdAt, now);
  const updatedAt = finiteNumber(c && c.updatedAt, now);
  const dims = c && c.dimensions && typeof c.dimensions === 'object' ? c.dimensions : {};
  const length = positiveNumber(dims.length, 48);
  const width = positiveNumber(dims.width, 24);
  const height = positiveNumber(dims.height, 24);
  const category = safeString(c && c.category, 'default').toLowerCase();
  const color = safeString(c && c.color, '');
  return {
    id: safeString(c && c.id, uuid()),
    name: safeString(c && c.name, 'Unnamed Case'),
    manufacturer: safeString(c && c.manufacturer, ''),
    category,
    dimensions: { length, width, height },
    weight: Math.max(0, finiteNumber(c && c.weight, 0)),
    volume: CoreUtils.volumeInCubicInches({ length, width, height }),
    canFlip: Boolean(c && c.canFlip),
    notes: safeString(c && c.notes, ''),
    color,
    createdAt,
    updatedAt,
  };
}

export function normalizeTruck(truck) {
  const t = truck && typeof truck === 'object' ? truck : {};
  const mode = t.shapeMode === 'wheelWells' || t.shapeMode === 'frontBonus' || t.shapeMode === 'rect' ? t.shapeMode : 'rect';
  const shapeConfig = t.shapeConfig && typeof t.shapeConfig === 'object' && !Array.isArray(t.shapeConfig) ? t.shapeConfig : {};
  return {
    length: positiveNumber(t.length, DEFAULT_TRUCK.length),
    width: positiveNumber(t.width, DEFAULT_TRUCK.width),
    height: positiveNumber(t.height, DEFAULT_TRUCK.height),
    shapeMode: mode,
    shapeConfig,
  };
}

export function normalizeInstance(inst, caseMap) {
  const transform = inst && inst.transform && typeof inst.transform === 'object' ? inst.transform : {};
  const pos = transform.position && typeof transform.position === 'object' ? transform.position : {};
  const rot =
    transform.rotation && typeof transform.rotation === 'object' ? transform.rotation : { x: 0, y: 0, z: 0 };
  const scale = transform.scale && typeof transform.scale === 'object' ? transform.scale : { x: 1, y: 1, z: 1 };
  const caseId = safeString(inst && inst.caseId, '');
  const caseData = caseMap.get(caseId) || null;
  const halfY = caseData ? Math.max(1, (caseData.dimensions.height || 1) / 2) : 10;

  return {
    id: safeString(inst && inst.id, uuid()),
    caseId,
    transform: {
      position: {
        x: finiteNumber(pos.x, -80),
        y: finiteNumber(pos.y, halfY),
        z: finiteNumber(pos.z, 0),
      },
      rotation: {
        x: finiteNumber(rot.x, 0),
        y: finiteNumber(rot.y, 0),
        z: finiteNumber(rot.z, 0),
      },
      scale: {
        x: finiteNumber(scale.x, 1),
        y: finiteNumber(scale.y, 1),
        z: finiteNumber(scale.z, 1),
      },
    },
    hidden: Boolean(inst && inst.hidden),
    groupId: inst && inst.groupId != null ? inst.groupId : null,
  };
}

export function normalizePack(p, caseMap, now) {
  const truck = normalizeTruck(p && p.truck);
  const rawCases = Array.isArray(p && p.cases) ? p.cases : [];
  const instances = rawCases.map(i => normalizeInstance(i, caseMap)).filter(i => Boolean(i.caseId));
  const thumbnail = typeof (p && p.thumbnail) === 'string' ? p.thumbnail : null;
  const thumbnailUpdatedAt = Number.isFinite(p && p.thumbnailUpdatedAt) ? p.thumbnailUpdatedAt : null;
  const thumbnailSource = p && (p.thumbnailSource === 'auto' || p.thumbnailSource === 'manual') ? p.thumbnailSource : null;
  return {
    id: safeString(p && p.id, uuid()),
    title: safeString(p && p.title, 'Untitled Pack'),
    client: safeString(p && p.client, ''),
    projectName: safeString(p && p.projectName, ''),
    drawnBy: safeString(p && p.drawnBy, ''),
    notes: safeString(p && p.notes, ''),
    truck,
    cases: instances,
    groups: Array.isArray(p && p.groups) ? p.groups : [],
    stats: { totalCases: 0, packedCases: 0, volumeUsed: 0, totalWeight: 0 },
    createdAt: finiteNumber(p && p.createdAt, now),
    lastEdited: finiteNumber(p && p.lastEdited, now),
    thumbnail,
    thumbnailUpdatedAt,
    thumbnailSource,
  };
}

export function normalizeAppData(data) {
  const now = Date.now();
  const rawCases = Array.isArray(data && data.caseLibrary) ? data.caseLibrary : [];
  const cases = rawCases.map(c => normalizeCase(c, now));

  const seenCaseIds = new Set();
  cases.forEach(c => {
    if (!seenCaseIds.has(c.id)) {
      seenCaseIds.add(c.id);
      return;
    }
    c.id = uuid();
  });
  const caseMap = new Map(cases.map(c => [c.id, c]));

  const rawPacks = Array.isArray(data && data.packLibrary) ? data.packLibrary : [];
  const packs = rawPacks.map(p => normalizePack(p, caseMap, now));

  const prefs = normalizePreferences(data && data.preferences);
  const currentPackId = safeString(data && data.currentPackId, '');
  const current = packs.some(p => p.id === currentPackId) ? currentPackId : packs[0] ? packs[0].id : null;

  return { caseLibrary: cases, packLibrary: packs, preferences: prefs, currentPackId: current };
}
