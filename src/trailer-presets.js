/**
 * @file trailer-presets.js
 * @description Curated trailer preset definitions and helpers for applying them to a pack truck.
 * @module trailer-presets
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export const TrailerPresets = (() => {
  const presets = [
    {
      id: 'default',
      label: 'Default',
      truck: { length: 636, width: 102, height: 98, shapeMode: 'rect' },
      tags: ['Default'],
    },
    {
      id: '53ft_dry_van_us',
      label: '53 ft Dry Van (US)',
      truck: { length: 636, width: 102, height: 110, shapeMode: 'rect' },
      tags: ['US', 'Dry Van'],
    },
    {
      id: '53ft_dry_van_us_wheel_wells',
      label: '53 ft Dry Van (US, Wheel Wells)',
      truck: { length: 636, width: 102, height: 110, shapeMode: 'wheelWells' },
      tags: ['US', 'Dry Van', 'Wheel Wells'],
    },
    {
      id: '53ft_dry_van_us_front_overhang',
      label: '53 ft Dry Van (US, Front Overhang)',
      truck: { length: 636, width: 102, height: 110, shapeMode: 'frontBonus' },
      tags: ['US', 'Dry Van', 'Front Overhang'],
    },
    {
      id: '53ft_dry_van_low_us',
      label: '53 ft Dry Van (US, Low)',
      truck: { length: 636, width: 102, height: 102, shapeMode: 'rect' },
      tags: ['US', 'Dry Van'],
    },
    {
      id: '48ft_dry_van_us',
      label: '48 ft Dry Van (US)',
      truck: { length: 576, width: 102, height: 110, shapeMode: 'rect' },
      tags: ['US', 'Dry Van'],
    },
    {
      id: '40ft_dry_van_us',
      label: '40 ft Dry Van (US)',
      truck: { length: 480, width: 102, height: 110, shapeMode: 'rect' },
      tags: ['US', 'Dry Van'],
    },
    {
      id: '26ft_box_truck_us',
      label: '26 ft Box Truck (US)',
      truck: { length: 312, width: 96, height: 96, shapeMode: 'rect' },
      tags: ['US', 'Box Truck'],
    },
    {
      id: '24ft_box_truck_us',
      label: '24 ft Box Truck (US)',
      truck: { length: 288, width: 96, height: 96, shapeMode: 'rect' },
      tags: ['US', 'Box Truck'],
    },
    {
      id: '20ft_box_truck_us',
      label: '20 ft Box Truck (US)',
      truck: { length: 240, width: 96, height: 96, shapeMode: 'rect' },
      tags: ['US', 'Box Truck'],
    },
    {
      id: '16ft_box_truck_us',
      label: '16 ft Box Truck (US)',
      truck: { length: 192, width: 90, height: 84, shapeMode: 'rect' },
      tags: ['US', 'Box Truck'],
    },
    {
      id: 'sprinter_extended',
      label: 'Sprinter Van (Extended)',
      truck: { length: 168, width: 70, height: 72, shapeMode: 'rect' },
      tags: ['Van'],
    },
  ];

  function getAll() {
    return presets.slice();
  }

  function getById(id) {
    const key = String(id || '');
    return presets.find(p => p.id === key) || null;
  }

  function normalizeShapeMode(mode) {
    if (mode === 'wheelWells' || mode === 'frontBonus' || mode === 'rect') return mode;
    return 'rect';
  }

  function applyToTruck(truck, preset) {
    const base = truck && typeof truck === 'object' ? truck : {};
    const p = preset && typeof preset === 'object' ? preset : null;
    const pt = p && p.truck && typeof p.truck === 'object' ? p.truck : {};
    const shapeConfig =
      base.shapeConfig && typeof base.shapeConfig === 'object' && !Array.isArray(base.shapeConfig)
        ? JSON.parse(JSON.stringify(base.shapeConfig))
        : {};

    return {
      ...base,
      length: Number(pt.length) || Number(base.length) || 636,
      width: Number(pt.width) || Number(base.width) || 102,
      height: Number(pt.height) || Number(base.height) || 98,
      shapeMode: normalizeShapeMode(pt.shapeMode || base.shapeMode),
      shapeConfig,
    };
  }

  return { getAll, getById, applyToTruck };
})();
