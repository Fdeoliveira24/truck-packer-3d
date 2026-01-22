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

export function normalizePack(data) {
  const now = Date.now();
  const p = data && typeof data === 'object' ? data : {};
  const truck = p.truck && typeof p.truck === 'object' ? p.truck : DEFAULT_TRUCK;
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
    },
    cases: Array.isArray(p.cases) ? p.cases : [],
    groups: Array.isArray(p.groups) ? p.groups : [],
    stats:
      p.stats && typeof p.stats === 'object'
        ? p.stats
        : { totalCases: 0, packedCases: 0, volumeUsed: 0, totalWeight: 0 },
    createdAt: Number.isFinite(Number(p.createdAt)) ? Number(p.createdAt) : now,
    lastEdited: now,
  };
}
