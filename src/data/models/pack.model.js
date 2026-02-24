/**
 * @file pack.model.js
 * @description Pack data model normalization.
 * @module data/models/pack.model
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { uuid } from '../../utils/uuid.js';
import { DEFAULT_TRUCK } from '../../core/constants.js';
import { deepClone } from '../../core/utils/index.js';

export function normalizePack(data) {
  const now = Date.now();
  const p = data && typeof data === 'object' ? data : {};
  const truck = p.truck && typeof p.truck === 'object' ? p.truck : DEFAULT_TRUCK;
  const shapeMode =
    truck &&
    (truck.shapeMode === 'wheelWells' || truck.shapeMode === 'frontBonus' || truck.shapeMode === 'rect')
      ? truck.shapeMode
      : 'rect';
  const shapeConfig =
    truck && truck.shapeConfig && typeof truck.shapeConfig === 'object' && !Array.isArray(truck.shapeConfig)
      ? deepClone(truck.shapeConfig)
      : {};
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
  const stats = p.stats && typeof p.stats === 'object' ? { ...baseStats, ...p.stats } : baseStats;
  return {
    id: String(p.id || '').trim() || uuid(),
    title: String(p.title || '').trim() || 'Untitled Pack',
    client: String(p.client || '').trim(),
    projectName: String(p.projectName || '').trim(),
    drawnBy: String(p.drawnBy || '').trim(),
    notes: String(p.notes || ''),
    truck: {
      length: Number(truck.length) || DEFAULT_TRUCK.length,
      width: Number(truck.width) || DEFAULT_TRUCK.width,
      height: Number(truck.height) || DEFAULT_TRUCK.height,
      shapeMode,
      shapeConfig,
    },
    cases: Array.isArray(p.cases) ? p.cases : [],
    groups: Array.isArray(p.groups) ? p.groups : [],
    stats,
    createdAt: Number.isFinite(Number(p.createdAt)) ? Number(p.createdAt) : now,
    lastEdited: now,
  };
}
