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
import { canonicalOrientationLock } from './orientation.js';

const DEFAULT_TRUCK = { length: 636, width: 102, height: 98 };
const RIGHT_ANGLE_RAD = Math.PI / 2;

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

function safeId(value) {
  return safeString(value, '') || uuid();
}

function normalizeRightAngle(value) {
  const raw = Number(value) || 0;
  let turns = Math.round(raw / RIGHT_ANGLE_RAD) % 4;
  if (turns < 0) turns += 4;
  return turns * RIGHT_ANGLE_RAD;
}

function normalizeRightAngleRotation(rotation = {}) {
  return {
    x: normalizeRightAngle(rotation.x),
    y: normalizeRightAngle(rotation.y),
    z: normalizeRightAngle(rotation.z),
  };
}

function rotateVectorXYZ(vec, rotation) {
  let x = vec.x;
  let y = vec.y;
  let z = vec.z;
  const rx = normalizeRightAngle(rotation.x);
  const ry = normalizeRightAngle(rotation.y);
  const rz = normalizeRightAngle(rotation.z);

  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  y = y1;
  z = z1;

  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const x2 = x * cosY + z * sinY;
  const z2 = -x * sinY + z * cosY;
  x = x2;
  z = z2;

  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const x3 = x * cosZ - y * sinZ;
  const y3 = x * sinZ + y * cosZ;
  return { x: x3, y: y3, z };
}

function getOrientedDimsForRotation(dimensions = {}, rotation = {}) {
  const length = Math.max(0, Number(dimensions.length) || 0);
  const width = Math.max(0, Number(dimensions.width) || 0);
  const height = Math.max(0, Number(dimensions.height) || 0);
  const locked = normalizeRightAngleRotation(rotation);
  const axes = [
    rotateVectorXYZ({ x: length, y: 0, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: height, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: 0, z: width }, locked),
  ];
  const out = axes.reduce(
    (acc, axis) => ({
      length: acc.length + Math.abs(axis.x),
      height: acc.height + Math.abs(axis.y),
      width: acc.width + Math.abs(axis.z),
    }),
    { length: 0, width: 0, height: 0 }
  );
  return {
    length: Math.round(out.length * 1e6) / 1e6,
    width: Math.round(out.width * 1e6) / 1e6,
    height: Math.round(out.height * 1e6) / 1e6,
  };
}

function normalizeOrientedDims(value) {
  const dims = value && typeof value === 'object' ? value : {};
  const length = positiveNumber(dims.length, 0);
  const width = positiveNumber(dims.width, 0);
  const height = positiveNumber(dims.height, 0);
  if (!length || !width || !height) return null;
  return { length, width, height };
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
  const quality = safeString(next.renderQuality, base.renderQuality).toLowerCase();
  next.renderQuality = ['low', 'medium', 'high', 'auto'].includes(quality) ? quality : base.renderQuality;
  next.showLabels = next.showLabels !== false;
  next.showShadows = next.showShadows !== false;
  next.showBevels = next.showBevels !== false;
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
  const shapeRaw = safeString(c && c.shape, 'box').toLowerCase();
  const shape = shapeRaw === 'cylinder' || shapeRaw === 'drum' || shapeRaw === 'box' ? shapeRaw : 'box';
  const orientationLock = canonicalOrientationLock(c && c.orientationLock);
  const maxStackCount = Math.max(0, Math.floor(finiteNumber(c && c.maxStackCount, 0)));
  const maxPalletWeight = Math.max(0, finiteNumber(c && c.maxPalletWeight, 0));
  const hazmatRaw = safeString(c && c.hazmatClass, '');
  const hazmatClass = hazmatRaw ? hazmatRaw : null;
  const category = safeString(c && c.category, 'default').toLowerCase();
  const color = safeString(c && c.color, '');
  const laneItem = c && c.laneItem === true ? true : c && c.laneItem === false ? false : null;
  const normalizedCase = {
    id: safeId(c && c.id),
    name: safeString(c && c.name, 'Unnamed Case'),
    manufacturer: safeString(c && c.manufacturer, ''),
    category,
    dimensions: { length, width, height },
    weight: Math.max(0, finiteNumber(c && c.weight, 0)),
    volume: CoreUtils.volumeInCubicInches({ length, width, height }),
    shape,
    stackable: !(c && c.stackable === false),
    maxStackCount,
    orientationLock,
    noStackOnTop: Boolean(c && c.noStackOnTop),
    isPallet: Boolean(c && c.isPallet),
    maxPalletWeight,
    hazmatClass,
    laneItem,
    loadPriority: finiteNumber(c && c.loadPriority, 0),
    mustLoadLast: Boolean(c && c.mustLoadLast),
    mustUnloadFirst: Boolean(c && c.mustUnloadFirst),
    stopGroup: safeString(c && c.stopGroup, ''),
    keepTogetherGroup: safeString(c && c.keepTogetherGroup, ''),
    canFlip: Boolean(c && c.canFlip),
    notes: safeString(c && c.notes, ''),
    color,
    createdAt,
    updatedAt,
  };
  // Preserve the pack-import idempotence fingerprint when present so repeated
  // conflicting imports stay idempotent across reloads.
  if (c && c.importSourceKey) normalizedCase.importSourceKey = String(c.importSourceKey);
  return normalizedCase;
}

export function normalizeTruck(truck) {
  const t = truck && typeof truck === 'object' ? truck : {};
  const mode =
    t.shapeMode === 'wheelWells' || t.shapeMode === 'frontBonus' || t.shapeMode === 'rect' ? t.shapeMode : 'rect';
  const shapeConfig =
    t.shapeConfig && typeof t.shapeConfig === 'object' && !Array.isArray(t.shapeConfig) ? t.shapeConfig : {};
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
  const rot = transform.rotation && typeof transform.rotation === 'object' ? transform.rotation : { x: 0, y: 0, z: 0 };
  const scale = transform.scale && typeof transform.scale === 'object' ? transform.scale : { x: 1, y: 1, z: 1 };
  const caseId = safeString(inst && inst.caseId, '');
  const caseData = caseMap.get(caseId) || null;
  const halfY = caseData ? Math.max(1, (caseData.dimensions.height || 1) / 2) : 10;
  const orientationLocked = inst && inst.orientationLocked === true;
  const sourceLockedRotation =
    inst && inst.lockedRotation && typeof inst.lockedRotation === 'object' ? inst.lockedRotation : rot;
  const lockedRotation = orientationLocked ? normalizeRightAngleRotation(sourceLockedRotation) : null;
  // Effective right-angle rotation for dimension purposes: the locked rotation
  // when locked, otherwise the instance's own rotation (e.g. an AutoPack-applied
  // tip on an unlocked item).
  const effectiveRotation = lockedRotation || normalizeRightAngleRotation(rot);
  const isIdentityRotation =
    effectiveRotation.x === 0 && effectiveRotation.y === 0 && effectiveRotation.z === 0;
  // orientedDims is the case's effective size under its ACTUAL rotation and must
  // not be tied to orientationLocked — an AutoPacked rotated item is unlocked but
  // still physically rotated. Recompute authoritatively from the case dimensions
  // + rotation (never stale); fall back to the stored value only when the case
  // definition is unavailable (recomputation lacks context).
  let orientedDims = null;
  if (!isIdentityRotation) {
    orientedDims =
      caseData && caseData.dimensions
        ? normalizeOrientedDims(getOrientedDimsForRotation(caseData.dimensions, effectiveRotation))
        : null;
    if (!orientedDims) orientedDims = normalizeOrientedDims(inst && inst.orientedDims);
  }
  const deliverySequenceRaw = Number(inst && inst.deliverySequence);
  const deliverySequence = Number.isFinite(deliverySequenceRaw) ? deliverySequenceRaw : null;
  const placement =
    inst && (inst.placement === 'packed' || inst.placement === 'staged') ? inst.placement : null;

  return {
    id: safeId(inst && inst.id),
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
    orientationLocked,
    lockedRotation,
    orientedDims,
    deliverySequence,
    placement,
  };
}

export function normalizeFolder(folder, now) {
  const source = folder && typeof folder === 'object' ? folder : {};
  const createdAt = finiteNumber(source.createdAt, now);
  const updatedAt = finiteNumber(source.updatedAt, createdAt);
  return {
    id: safeId(source.id),
    name: safeString(source.name, 'Untitled Folder'),
    scope: 'pack',
    parentFolderId: null,
    sortOrder: Math.max(0, Math.trunc(finiteNumber(source.sortOrder, 0))),
    createdAt,
    updatedAt,
  };
}

export function normalizePack(p, caseMap, now) {
  const truck = normalizeTruck(p && p.truck);
  const rawCases = Array.isArray(p && p.cases) ? p.cases : [];
  const instances = rawCases.map(i => normalizeInstance(i, caseMap)).filter(i => Boolean(i.caseId));
  const folderId = safeString(p && p.folderId, '') || null;
  const thumbnail = typeof (p && p.thumbnail) === 'string' ? p.thumbnail : null;
  const thumbnailUpdatedAt = Number.isFinite(p && p.thumbnailUpdatedAt) ? p.thumbnailUpdatedAt : null;
  const thumbnailSource =
    p && (p.thumbnailSource === 'auto' || p.thumbnailSource === 'manual') ? p.thumbnailSource : null;
  const baseStats = {
    totalCases: 0,
    hiddenCases: 0,
    packedCases: 0,
    volumeUsed: 0,
    volumePercent: 0,
    totalWeight: 0,
    cog: null,
    oogWarnings: [],
    palletWarnings: [],
  };
  const stats = p && p.stats && typeof p.stats === 'object' ? { ...baseStats, ...p.stats } : baseStats;
  return {
    id: safeId(p && p.id),
    title: safeString(p && p.title, 'Untitled Pack'),
    client: safeString(p && p.client, ''),
    projectName: safeString(p && p.projectName, ''),
    drawnBy: safeString(p && p.drawnBy, ''),
    notes: safeString(p && p.notes, ''),
    truck,
    cases: instances,
    folderId,
    groups: Array.isArray(p && p.groups) ? p.groups : [],
    stats,
    createdAt: finiteNumber(p && p.createdAt, now),
    lastEdited: finiteNumber(p && p.lastEdited, now),
    thumbnail,
    thumbnailUpdatedAt,
    thumbnailSource,
  };
}

export function normalizeAppData(data) {
  const now = Date.now();
  const rawFolders = Array.isArray(data && data.folderLibrary) ? data.folderLibrary : [];
  const folders = rawFolders.map(folder => normalizeFolder(folder, now));
  const seenFolderIds = new Set();
  folders.forEach(folder => {
    if (!seenFolderIds.has(folder.id)) {
      seenFolderIds.add(folder.id);
      return;
    }
    folder.id = uuid();
    seenFolderIds.add(folder.id);
  });
  const folderIds = new Set(folders.map(folder => folder.id));

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
  const packs = rawPacks.map(p => {
    const pack = normalizePack(p, caseMap, now);
    if (pack.folderId && !folderIds.has(pack.folderId)) pack.folderId = null;
    return pack;
  });

  const prefs = normalizePreferences(data && data.preferences);
  const currentPackId = safeString(data && data.currentPackId, '');
  const current = packs.some(p => p.id === currentPackId) ? currentPackId : packs[0] ? packs[0].id : null;

  return { caseLibrary: cases, packLibrary: packs, folderLibrary: folders, preferences: prefs, currentPackId: current };
}
