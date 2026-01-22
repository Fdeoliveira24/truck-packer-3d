/**
 * @file case.model.js
 * @description Case data model normalization.
 * @module data/models/case.model
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { uuid } from '../../utils/uuid.js';

export function normalizeCase(data) {
  const now = Date.now();
  const d = data && typeof data === 'object' ? data : {};
  const dims = d.dimensions && typeof d.dimensions === 'object' ? d.dimensions : {};
  const length = Number(dims.length);
  const width = Number(dims.width);
  const height = Number(dims.height);
  return {
    id: String(d.id || '').trim() || uuid(),
    name: String(d.name || '').trim() || 'New Case',
    manufacturer: String(d.manufacturer || '').trim(),
    category: String(d.category || 'default')
      .trim()
      .toLowerCase(),
    dimensions: {
      length: Number.isFinite(length) && length > 0 ? length : 48,
      width: Number.isFinite(width) && width > 0 ? width : 24,
      height: Number.isFinite(height) && height > 0 ? height : 24,
    },
    weight: Number.isFinite(Number(d.weight)) ? Number(d.weight) : 0,
    canFlip: Boolean(d.canFlip),
    notes: String(d.notes || ''),
    color: String(d.color || '#ff9f1c'),
    createdAt: Number.isFinite(Number(d.createdAt)) ? Number(d.createdAt) : now,
    updatedAt: now,
  };
}
