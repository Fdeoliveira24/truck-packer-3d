/**
 * @file space-model.js
 * @description One geometry authority for AutoPack: builds a SpaceModel from the
 * existing pack/truck/shapeConfig without changing any geometry output.
 *
 * Phase 5 contract (docs/engineering/autopack-core-engine-plan.md §4/§5): this
 * module COMPOSES the existing production geometry sources — pack-library usable
 * zones / blocked zones / retention geometry and the solver's wheel-well physical
 * geometry — so Standard, Wheel Wells, and Front Overhang all normalize into one
 * shared model. It is byte-parity by construction: every field either IS the
 * existing function's output or is derived 1:1 from it.
 * @module packing-core/space-model
 */

import {
  CONTAINMENT_EPS_INCHES,
  getTrailerUsableZones,
  getWheelWellsBlockedZones,
  getFrontBonusBlockedZones,
  getFrontOverhangRetentionGeometry,
} from '../services/pack-library.js';
import { getWheelWellGeometry } from './wheel-well-model.js';
import { SURFACE_KINDS, BLOCKED_KINDS, makeSurface, makeBlockedVolume } from './domain.js';

const EPS = CONTAINMENT_EPS_INCHES;

function truckDims(truck) {
  const t = truck && typeof truck === 'object' ? truck : {};
  return {
    length: Math.max(0, Number(t.length) || 0),
    width: Math.max(0, Number(t.width) || 0),
    height: Math.max(0, Number(t.height) || 0),
  };
}

function shapeModeOf(truck) {
  const mode = truck && truck.shapeMode;
  return mode === 'wheelWells' || mode === 'frontBonus' || mode === 'rect' ? mode : 'rect';
}

function unionBounds(zones, dims) {
  if (!zones.length) {
    return {
      min: { x: 0, y: 0, z: -dims.width / 2 },
      max: { x: dims.length, y: dims.height, z: dims.width / 2 },
    };
  }
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (const zone of zones) {
    bounds.min.x = Math.min(bounds.min.x, zone.min.x);
    bounds.min.y = Math.min(bounds.min.y, zone.min.y);
    bounds.min.z = Math.min(bounds.min.z, zone.min.z);
    bounds.max.x = Math.max(bounds.max.x, zone.max.x);
    bounds.max.y = Math.max(bounds.max.y, zone.max.y);
    bounds.max.z = Math.max(bounds.max.z, zone.max.z);
  }
  return bounds;
}

function buildSurfaces(zones, wheelWell) {
  const surfaces = zones.map((zone, zoneIndex) => makeSurface({
    kind: zone.min.y <= EPS ? SURFACE_KINDS.FLOOR : SURFACE_KINDS.RAISED_FLOOR,
    y: zone.min.y,
    minX: zone.min.x,
    maxX: zone.max.x,
    minZ: zone.min.z,
    maxZ: zone.max.z,
    zoneIndex,
  }));
  for (const top of wheelWell ? wheelWell.tops : []) {
    surfaces.push(makeSurface({
      kind: SURFACE_KINDS.RIGID_TOP,
      y: top.min.y,
      minX: top.min.x,
      maxX: top.max.x,
      minZ: top.min.z,
      maxZ: top.max.z,
      zoneIndex: null,
    }));
  }
  return surfaces;
}

/**
 * Constrained zones: usable zones strictly narrower (in Z) than the widest zone
 * of the space. Geometry-driven, so Standard (one zone) never has any. This is
 * the same definition the solver's private narrowChannelZones() uses; it lives
 * here so leftover/reservation passes and future strategies share one source.
 */
export function getConstrainedZones(zones) {
  const list = Array.isArray(zones) ? zones : [];
  if (list.length < 2) return [];
  const widest = Math.max(...list.map(zone => zone.max.z - zone.min.z));
  return list.filter(zone => (zone.max.z - zone.min.z) < widest - EPS);
}

/**
 * Build the shared SpaceModel for a truck/container. Pure; safe to call with
 * malformed input (returns an empty-zone model the solver already treats as
 * "nothing usable").
 *
 * @param {object} truck - pack truck ({length,width,height,shapeMode,shapeConfig})
 * @param {{ loadFrontFirst?: boolean }} [options]
 */
export function buildSpaceModel(truck, options = {}) {
  const dims = truckDims(truck);
  const shapeMode = shapeModeOf(truck);
  const zones = getTrailerUsableZones(truck);
  const wheelWell = getWheelWellGeometry(truck);
  const blocked = [
    ...getWheelWellsBlockedZones(truck).map(z => makeBlockedVolume(BLOCKED_KINDS.WHEEL_WELL_BODY, z)),
    ...getFrontBonusBlockedZones(truck).map(z => makeBlockedVolume(BLOCKED_KINDS.CAB_VOID, z)),
  ];

  return {
    kind: 'truck',
    bounds: unionBounds(zones, dims),
    zones,
    blocked,
    surfaces: buildSurfaces(zones, wheelWell),
    constrainedZones: getConstrainedZones(zones),
    retention: getFrontOverhangRetentionGeometry(truck, zones),
    wheelWell,
    loadFrontFirst: options.loadFrontFirst !== false,
    meta: { shapeMode, truck: dims },
  };
}
