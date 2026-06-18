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
import {
  canonicalCargoForStorage,
  pickSafeExtensions,
  CANONICAL_CASE_KEYS,
  DIMENSION_MAX_INCHES,
  WEIGHT_MAX_LBS,
} from '../../core/cargo-canonical.js';

export function normalizeCase(data) {
  const now = Date.now();
  const d = data && typeof data === 'object' ? data : {};
  const dims = d.dimensions && typeof d.dimensions === 'object' ? d.dimensions : {};
  const length = Number(dims.length);
  const width = Number(dims.width);
  const height = Number(dims.height);
  // Default missing/invalid dimensions, then apply the data-sanity cap so absurd
  // values can never produce an infinite volume.
  const safeLength = Math.min(DIMENSION_MAX_INCHES, Number.isFinite(length) && length > 0 ? length : 48);
  const safeWidth = Math.min(DIMENSION_MAX_INCHES, Number.isFinite(width) && width > 0 ? width : 24);
  const safeHeight = Math.min(DIMENSION_MAX_INCHES, Number.isFinite(height) && height > 0 ? height : 24);
  const hazmatRaw = String(d.hazmatClass || '').trim();
  const hazmatClass = hazmatRaw ? hazmatRaw : null;
  const weightRaw = Number.isFinite(Number(d.weight)) && Number(d.weight) >= 0 ? Number(d.weight) : 0;
  // Typed canonical handling-rule fields from the single shared representation.
  const cargo = canonicalCargoForStorage(d);
  const normalized = {
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
    weight: Math.min(WEIGHT_MAX_LBS, weightRaw),
    volume: volumeInCubicInches({
      length: safeLength,
      width: safeWidth,
      height: safeHeight,
    }),
    shape: cargo.shape,
    stackable: cargo.stackable,
    maxStackCount: cargo.maxStackCount,
    orientationLock: cargo.orientationLock,
    noStackOnTop: cargo.noStackOnTop,
    isPallet: cargo.isPallet,
    maxPalletWeight: cargo.maxPalletWeight,
    hazmatClass,
    laneItem: cargo.laneItem,
    loadPriority: cargo.loadPriority,
    mustLoadLast: Boolean(d.mustLoadLast),
    mustUnloadFirst: Boolean(d.mustUnloadFirst),
    stopGroup: String(d.stopGroup || '').trim(),
    keepTogetherGroup: String(d.keepTogetherGroup || '').trim(),
    canFlip: cargo.canFlip,
    notes: String(d.notes || ''),
    color: String(d.color || '#ff9f1c'),
    createdAt: Number.isFinite(Number(d.createdAt)) ? Number(d.createdAt) : now,
    updatedAt: now,
  };
  // Preserve approved safe unknown metadata across normalization.
  return { ...pickSafeExtensions(d, CANONICAL_CASE_KEYS), ...normalized };
}
