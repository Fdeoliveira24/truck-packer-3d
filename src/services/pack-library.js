/**
 * @file pack-library.js
 * @description UI-free service module for pack library operations and state updates.
 * @module services/pack-library
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import * as StateStore from '../core/state-store.js';
import * as Utils from '../core/utils/index.js';
import * as CoreNormalizer from '../core/normalizer.js';
import * as CaseLibrary from './case-library.js';

function getDims(truck) {
  const t = truck && typeof truck === 'object' ? truck : {};
  const length = Math.max(0, Number(t.length) || 0);
  const width = Math.max(0, Number(t.width) || 0);
  const height = Math.max(0, Number(t.height) || 0);
  return { length, width, height };
}

function getMode(truck) {
  const mode = truck && truck.shapeMode;
  if (mode === 'wheelWells' || mode === 'frontBonus' || mode === 'rect') return mode;
  return 'rect';
}

function getConfig(truck) {
  const cfg = truck && truck.shapeConfig;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function zone(min, max) {
  return { min: { ...min }, max: { ...max } };
}

function sanitizeZones(zones) {
  const EPS = 1e-9;
  return (zones || []).filter(z => {
    const dx = z.max.x - z.min.x;
    const dy = z.max.y - z.min.y;
    const dz = z.max.z - z.min.z;
    return dx > EPS && dy > EPS && dz > EPS;
  });
}

function getTrailerUsableZones(truck) {
  const { length: L, width: W, height: H } = getDims(truck);
  const mode = getMode(truck);
  const cfg = getConfig(truck);

  if (!L || !W || !H) return [];

  if (mode === 'frontBonus') {
    const bonusLengthRaw = Number(cfg.bonusLength);
    const bonusWidthRaw = Number(cfg.bonusWidth);
    const bonusHeightRaw = Number(cfg.bonusHeight);

    const bonusLength = Utils.clamp(Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0.12 * L, 0, L);
    const bonusWidth = Utils.clamp(Number.isFinite(bonusWidthRaw) ? bonusWidthRaw : W, 0, W);
    const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : H, 0, H);

    const splitX = L - bonusLength;
    const zones = [
      zone({ x: 0, y: 0, z: -W / 2 }, { x: splitX, y: H, z: W / 2 }),
      zone({ x: splitX, y: 0, z: -bonusWidth / 2 }, { x: L, y: bonusHeight, z: bonusWidth / 2 }),
    ];
    return sanitizeZones(zones);
  }

  if (mode === 'wheelWells') {
    const wellHeightRaw = Number(cfg.wellHeight);
    const wellWidthRaw = Number(cfg.wellWidth);
    const wellLengthRaw = Number(cfg.wellLength);
    const wellOffsetRaw = Number(cfg.wellOffsetFromRear);

    const wellHeight = Utils.clamp(Number.isFinite(wellHeightRaw) ? wellHeightRaw : 0.35 * H, 0, H);
    const wellWidth = Utils.clamp(Number.isFinite(wellWidthRaw) ? wellWidthRaw : 0.15 * W, 0, W / 2);
    const wellLength = Utils.clamp(Number.isFinite(wellLengthRaw) ? wellLengthRaw : 0.35 * L, 0, L);
    const wellOffsetFromRear = Utils.clamp(Number.isFinite(wellOffsetRaw) ? wellOffsetRaw : 0.25 * L, 0, L);

    const wx0 = wellOffsetFromRear;
    const wx1 = Utils.clamp(wx0 + wellLength, wx0, L);
    const betweenHalfW = Math.max(0, W / 2 - wellWidth);

    const zones = [
      zone({ x: 0, y: 0, z: -W / 2 }, { x: wx0, y: H, z: W / 2 }),
      zone({ x: wx0, y: 0, z: -betweenHalfW }, { x: wx1, y: H, z: betweenHalfW }),
      zone({ x: wx0, y: wellHeight, z: -W / 2 }, { x: wx1, y: H, z: -betweenHalfW }),
      zone({ x: wx0, y: wellHeight, z: betweenHalfW }, { x: wx1, y: H, z: W / 2 }),
      zone({ x: wx1, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 }),
    ];
    return sanitizeZones(zones);
  }

  return [zone({ x: 0, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 })];
}

function getTrailerCapacityInches3(truck) {
  const zones = getTrailerUsableZones(truck);
  return zones.reduce((sum, z) => {
    const dx = z.max.x - z.min.x;
    const dy = z.max.y - z.min.y;
    const dz = z.max.z - z.min.z;
    return sum + Math.max(0, dx) * Math.max(0, dy) * Math.max(0, dz);
  }, 0);
}

function isAabbContainedInAnyZone(aabb, zones) {
  for (const z of zones || []) {
    if (
      aabb.min.x >= z.min.x &&
      aabb.max.x <= z.max.x &&
      aabb.min.y >= z.min.y &&
      aabb.max.y <= z.max.y &&
      aabb.min.z >= z.min.z &&
      aabb.max.z <= z.max.z
    ) {
      return true;
    }
  }
  return false;
}

export function getPacks() {
  return StateStore.get('packLibrary') || [];
}

export function getById(packId) {
  return getPacks().find(p => p.id === packId) || null;
}

export function create(packData) {
  const now = Date.now();
  const rawTruck = packData.truck || { length: 636, width: 102, height: 98 };
  const shapeMode =
    rawTruck &&
    (rawTruck.shapeMode === 'wheelWells' || rawTruck.shapeMode === 'frontBonus' || rawTruck.shapeMode === 'rect')
      ? rawTruck.shapeMode
      : 'rect';
  const shapeConfig =
    rawTruck && rawTruck.shapeConfig && typeof rawTruck.shapeConfig === 'object' && !Array.isArray(rawTruck.shapeConfig)
      ? Utils.deepClone(rawTruck.shapeConfig)
      : {};
  const truck = {
    length: Number(rawTruck.length) || 636,
    width: Number(rawTruck.width) || 102,
    height: Number(rawTruck.height) || 98,
    shapeMode,
    shapeConfig,
  };
  const pack = {
    id: Utils.uuid(),
    title: packData.title || 'Untitled Pack',
    client: packData.client || '',
    projectName: packData.projectName || '',
    drawnBy: packData.drawnBy || '',
    notes: packData.notes || '',
    truck,
    cases: [],
    groups: [],
    stats: { totalCases: 0, packedCases: 0, volumeUsed: 0, totalWeight: 0 },
    createdAt: now,
    lastEdited: now,
    thumbnail: null,
    thumbnailUpdatedAt: null,
    thumbnailSource: null,
  };
  StateStore.set({ packLibrary: [...getPacks(), pack] });
  return pack;
}

export function update(packId, patch) {
  const packs = getPacks();
  const idx = packs.findIndex(p => p.id === packId);
  if (idx === -1) return null;
  const now = Date.now();
  const cloned = Utils.deepClone(patch);
  const prev = packs[idx];
  const next = { ...prev, ...cloned };

  const lastEditedKeys = ['title', 'client', 'projectName', 'drawnBy', 'notes', 'truck', 'cases', 'groups'];
  const hasLastEditedKey = Object.keys(cloned || {}).some(k => lastEditedKeys.includes(k));
  next.lastEdited = hasLastEditedKey ? now : prev.lastEdited || now;
  next.stats = computeStats(next);
  const nextPacks = packs.map((p, i) => (i === idx ? next : p));
  StateStore.set({ packLibrary: nextPacks });
  return next;
}

export function remove(packId) {
  const packs = getPacks().filter(p => p.id !== packId);
  const current = StateStore.get('currentPackId');
  StateStore.set({ packLibrary: packs, currentPackId: current === packId ? null : current, selectedInstanceIds: [] }, { skipHistory: true });
}

export function duplicate(packId) {
  const pack = getById(packId);
  if (!pack) return null;
  const now = Date.now();
  const copy = Utils.deepClone(pack);
  copy.id = Utils.uuid();
  copy.title = pack.title + ' (Copy)';
  copy.createdAt = now;
  copy.lastEdited = now;
  copy.thumbnail = null;
  copy.thumbnailUpdatedAt = null;
  copy.thumbnailSource = null;
  copy.cases = (copy.cases || []).map(i => ({ ...i, id: Utils.uuid() }));
  StateStore.set({ packLibrary: [...getPacks(), copy] });
  return copy;
}

export function open(packId) {
  const pack = getById(packId);
  if (!pack) return null;
  StateStore.set({ currentPackId: packId, selectedInstanceIds: [] }, { skipHistory: true });
  return pack;
}

export function addInstance(packId, caseId, position) {
  const pack = getById(packId);
  if (!pack) return null;
  const caseData = CaseLibrary.getById(caseId);
  if (!caseData) return null;
  const instance = {
    id: Utils.uuid(),
    caseId,
    transform: {
      position: position || { x: -80, y: Math.max(1, caseData.dimensions.height / 2), z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    hidden: false,
    groupId: null,
  };
  const nextCases = [...(pack.cases || []), instance];
  update(packId, { cases: nextCases });
  return instance;
}

export function updateInstance(packId, instanceId, patch) {
  const pack = getById(packId);
  if (!pack) return null;
  const nextInstances = (pack.cases || []).map(i => (i.id === instanceId ? { ...i, ...Utils.deepClone(patch) } : i));
  return update(packId, { cases: nextInstances });
}

export function removeInstances(packId, instanceIds) {
  const pack = getById(packId);
  if (!pack) return null;
  const idSet = new Set(instanceIds || []);
  const nextInstances = (pack.cases || []).filter(i => !idSet.has(i.id));
  return update(packId, { cases: nextInstances });
}

export function computeStats(pack, caseLibraryOverride) {
  const zonesInches = getTrailerUsableZones(pack && pack.truck);
  const truckVol = getTrailerCapacityInches3(pack && pack.truck);
  let usedIn3 = 0;
  let totalWeight = 0;
  let packedCases = 0;
  const getCase = caseId => {
    if (Array.isArray(caseLibraryOverride)) return caseLibraryOverride.find(c => c.id === caseId) || null;
    return CaseLibrary.getById(caseId);
  };
  (pack.cases || []).forEach(inst => {
    const c = getCase(inst.caseId);
    if (!c) return;
    if (inst.hidden) return;
    const dims = c.dimensions || { length: 0, width: 0, height: 0 };
    const pos = inst.transform && inst.transform.position ? inst.transform.position : { x: 0, y: 0, z: 0 };
    const half = { x: dims.length / 2, y: dims.height / 2, z: dims.width / 2 };
    const aabb = {
      min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
      max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
    };
    const insideTruck = isAabbContainedInAnyZone(aabb, zonesInches);
    if (!insideTruck) return;
    packedCases++;
    usedIn3 += c.volume || Utils.volumeInCubicInches(dims);
    totalWeight += Number(c.weight) || 0;
  });
  const volumePercent = truckVol > 0 ? (usedIn3 / truckVol) * 100 : 0;
  return {
    totalCases: (pack.cases || []).length,
    packedCases,
    volumeUsed: usedIn3,
    volumePercent,
    totalWeight,
  };
}

export function importPackPayload(payload) {
  const now = Date.now();
  const incomingPack = payload && payload.pack;
  if (!incomingPack || !incomingPack.truck || !Array.isArray(incomingPack.cases)) {
    throw new Error('Invalid pack format');
  }

  const bundled = Array.isArray(payload.bundledCases) ? payload.bundledCases : [];
  const currentCases = CaseLibrary.getCases();
  const currentPacks = getPacks();

  const caseById = new Map(currentCases.map(c => [c.id, c]));
  const caseByName = new Map(
    currentCases.map(c => [String(c.name || '').trim().toLowerCase(), c])
  );
  const caseIdMap = new Map();

  bundled.forEach(c => {
    if (!c || !c.id) return;
    const nameKey = String(c.name || '').trim().toLowerCase();
    if (caseById.has(c.id)) {
      caseIdMap.set(c.id, c.id);
      return;
    }
    if (nameKey && caseByName.has(nameKey)) {
      caseIdMap.set(c.id, caseByName.get(nameKey).id);
      return;
    }
    const copy = Utils.deepClone(c);
    copy.createdAt = copy.createdAt || now;
    copy.updatedAt = now;
    copy.volume = copy.volume || Utils.volumeInCubicInches(copy.dimensions || { length: 0, width: 0, height: 0 });
    CaseLibrary.upsert(copy);
    caseIdMap.set(c.id, copy.id);
    caseById.set(copy.id, copy);
    if (nameKey) caseByName.set(nameKey, copy);
  });

  const pack = Utils.deepClone(incomingPack);
  pack.id = currentPacks.some(p => p.id === pack.id) ? Utils.uuid() : pack.id || Utils.uuid();
  pack.title = pack.title ? `${pack.title} (Imported)` : 'Imported Pack';
  pack.createdAt = pack.createdAt || now;
  pack.lastEdited = now;

  pack.cases = (pack.cases || []).map(inst => {
    const next = Utils.deepClone(inst);
    next.id = Utils.uuid();
    next.caseId = caseIdMap.get(next.caseId) || next.caseId;
    if (!next.transform) {
      next.transform = {
        position: { x: -80, y: 10, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    }
    if (!next.transform.position) next.transform.position = { x: -80, y: 10, z: 0 };
    return next;
  });

  const rawTruck = pack.truck && typeof pack.truck === 'object' ? pack.truck : {};
  pack.truck = CoreNormalizer.normalizeTruck(rawTruck);

  pack.stats = computeStats(pack, CaseLibrary.getCases());

  StateStore.set(
    {
      caseLibrary: CaseLibrary.getCases(),
      packLibrary: [...currentPacks, pack],
      currentPackId: pack.id,
      currentScreen: 'editor',
      selectedInstanceIds: [],
    },
    { skipHistory: false }
  );

  return pack;
}
