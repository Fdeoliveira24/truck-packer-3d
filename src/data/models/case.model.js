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
import { volumeInCubicInches } from '../../core/utils.js';

export function normalizeCase(data) {
  const now = Date.now();
  const d = data && typeof data === 'object' ? data : {};
  const dims = d.dimensions && typeof d.dimensions === 'object' ? d.dimensions : {};
  const length = Number(dims.length);
  const width = Number(dims.width);
  const height = Number(dims.height);
  const safeLength = Number.isFinite(length) && length > 0 ? length : 48;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 24;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 24;
  const shapeRaw = String(d.shape || 'box')
    .trim()
    .toLowerCase();
  const shape = shapeRaw === 'cylinder' || shapeRaw === 'drum' || shapeRaw === 'box' ? shapeRaw : 'box';
  const orientationRaw = String(d.orientationLock || 'any')
    .trim()
    .toLowerCase();
  const orientationLock = orientationRaw === 'upright' ? 'upright' : orientationRaw === 'onside' ? 'onSide' : 'any';
  const maxStackCount = Number(d.maxStackCount);
  const maxPalletWeight = Number(d.maxPalletWeight);
  const hazmatRaw = String(d.hazmatClass || '').trim();
  const hazmatClass = hazmatRaw ? hazmatRaw : null;
  return {
    id: String(d.id || '').trim() || uuid(),
    name: String(d.name || '').trim() || 'New Case',
    manufacturer: String(d.manufacturer || '').trim(),
    category: String(d.category || 'default')
      .trim()
      .toLowerCase(),
    dimensions: {
      length: safeLength,
      width: safeWidth,
      height: safeHeight,
    },
    weight: Number.isFinite(Number(d.weight)) ? Number(d.weight) : 0,
    volume: volumeInCubicInches({
      length: safeLength,
      width: safeWidth,
      height: safeHeight,
    }),
    shape,
    stackable: d.stackable !== false,
    maxStackCount: Number.isFinite(maxStackCount) && maxStackCount >= 0 ? maxStackCount : 0,
    orientationLock,
    noStackOnTop: Boolean(d.noStackOnTop),
    isPallet: Boolean(d.isPallet),
    maxPalletWeight: Number.isFinite(maxPalletWeight) && maxPalletWeight >= 0 ? maxPalletWeight : 0,
    hazmatClass,
    canFlip: Boolean(d.canFlip),
    notes: String(d.notes || ''),
    color: String(d.color || '#ff9f1c'),
    createdAt: Number.isFinite(Number(d.createdAt)) ? Number(d.createdAt) : now,
    updatedAt: now,
  };
}
