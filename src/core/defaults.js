/**
 * @file defaults.js
 * @description Seed data and default preference definitions.
 * @module core/defaults
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { uuid } from './browser.js';

export const defaultPreferences = {
  packsViewMode: 'grid',
  casesViewMode: 'list',
  packsFiltersVisible: true,
  casesFiltersVisible: true,
  gridCardBadges: {
    packs: {
      showCasesCount: true,
      showTruckDims: true,
      showThumbnail: true,
      showShapeMode: true,
      showPacked: true,
      showVolume: true,
      showWeight: true,
      showEditedTime: true,
    },
    cases: {
      showCategory: true,
      showDims: true,
      showVolume: true,
      showWeight: true,
      showFlip: true,
      showEditedTime: true,
    },
  },
  units: { length: 'in', weight: 'lb' },
  theme: 'light',
  labelFontSize: 12,
  hiddenCaseOpacity: 0.3,
  snapping: { enabled: true, gridSize: 1 },
  camera: { defaultView: 'perspective' },
  export: { screenshotResolution: '1920x1080', pdfIncludeStats: true },
  categories: [],
};

export const categories = [
  { key: 'all', name: 'All', color: '#9b9ba8' },
  { key: 'audio', name: 'Audio', color: '#f59e0b' },
  { key: 'lighting', name: 'Lighting', color: '#3b82f6' },
  { key: 'stage', name: 'Stage', color: '#10b981' },
  { key: 'backline', name: 'Backline', color: '#ec4899' },
  { key: 'default', name: 'Default', color: '#9ca3af' },
];

export function seedCases() {
  const now = Date.now();
  return [
    {
      id: uuid(),
      name: 'Line Array Case',
      manufacturer: 'L-Acoustics',
      category: 'audio',
      dimensions: { length: 48, width: 24, height: 32 },
      weight: 125,
      canFlip: false,
      notes: '',
      color: '#ff9f1c',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuid(),
      name: 'Subwoofer Crate',
      manufacturer: 'JBL',
      category: 'audio',
      dimensions: { length: 36, width: 36, height: 24 },
      weight: 95,
      canFlip: true,
      notes: '',
      color: '#ff9f1c',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuid(),
      name: 'Truss Section',
      manufacturer: 'Global Truss',
      category: 'lighting',
      dimensions: { length: 120, width: 12, height: 12 },
      weight: 45,
      canFlip: true,
      notes: '',
      color: '#3b82f6',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuid(),
      name: 'Stage Deck',
      manufacturer: 'StagingCo',
      category: 'stage',
      dimensions: { length: 96, width: 48, height: 8 },
      weight: 80,
      canFlip: false,
      notes: '',
      color: '#10b981',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuid(),
      name: 'Guitar Rack',
      manufacturer: 'Backline Inc',
      category: 'backline',
      dimensions: { length: 40, width: 22, height: 46 },
      weight: 110,
      canFlip: false,
      notes: '',
      color: '#ec4899',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function seedPack(caseLibrary) {
  const now = Date.now();
  const pick = name => caseLibrary.find(c => c.name === name)?.id;
  const packId = uuid();
  const instances = [];
  const add = (caseId, x, y, z) => {
    instances.push({
      id: uuid(),
      caseId,
      transform: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      hidden: false,
      groupId: null,
    });
  };
  add(pick('Line Array Case'), -80, 16, 0);
  add(pick('Subwoofer Crate'), -90, 12, 28);
  add(pick('Truss Section'), -70, 6, -24);

  return {
    id: packId,
    title: 'Demo Pack',
    client: 'Example Client',
    projectName: 'Envato Preview',
    drawnBy: 'Truck Packer 3D',
    notes: 'Tip: Use AutoPack (Ctrl/Cmd+P) to fill the truck.',
    truck: { length: 636, width: 102, height: 98 },
    cases: instances.filter(i => Boolean(i.caseId)),
    groups: [],
    stats: { totalCases: instances.length, packedCases: 0, volumeUsed: 0, totalWeight: 0 },
    createdAt: now,
    lastEdited: now,
  };
}
