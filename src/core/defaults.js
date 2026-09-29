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
import { generateLoadPlanNumber } from './business-identity.js';

export const defaultPreferences = {
  packsViewMode: 'grid',
  casesViewMode: 'list',
  packsFiltersVisible: true,
  casesFiltersVisible: true,
  gridCardBadges: {
    packs: {
      showLoadPlanNumber: true,
      showCustomerReference: true,
      showNotes: true,
      showCasesCount: true,
      showTruckDims: true,
      showThumbnail: true,
      showShapeMode: true,
      showPacked: true,
      showCasesQty: true,
      showVolume: true,
      showWeight: true,
      showEditedTime: true,
    },
    cases: {
      showItemCode: true,
      showManufacturer: true,
      showCategory: true,
      showDims: true,
      showVolume: true,
      showWeight: true,
      showFlip: true,
      showHandling: true,
      showNotes: true,
      showEditedTime: true,
      showQuantity: true,
    },
  },
  units: { length: 'in', weight: 'lb' },
  theme: 'light',
  renderQuality: 'high',
  showLabels: true,
  showShadows: true,
  showBevels: true,
  labelFontSize: 12,
  hiddenCaseOpacity: 0.3,
  spaceUtilization: {
    showGauge: false,
    style: 'spatial',
    detail: 'minimal',
    position: { mode: 'bottom-left', x: 0, y: 1 },
  },
  snapping: { enabled: true, gridSize: 1 },
  camera: { defaultView: 'perspective' },
  export: { screenshotResolution: '1920x1080', pdfIncludeStats: true },
  categories: [],
};

// Settings > Screenshot resolution choices. Any other stored or imported value
// normalizes to defaultPreferences.export.screenshotResolution.
export const SCREENSHOT_RESOLUTIONS = Object.freeze(['1920x1080', '2560x1440', '3840x2160']);

export const categories = [
  { key: 'all', name: 'All', color: '#9b9ba8' },
  { key: 'audio', name: 'Audio', color: '#f59e0b' },
  { key: 'lighting', name: 'Lighting', color: '#3b82f6' },
  { key: 'stage', name: 'Stage', color: '#10b981' },
  { key: 'backline', name: 'Backline', color: '#ec4899' },
  { key: 'default', name: 'Default', color: '#9ca3af' },
];

// Category display primitives shared by CategoryService (runtime display) and
// the Workspace Backup projection, so a category key resolves to the same
// name and color in the app and in a backup.
export function normalizeCategoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function normalizeCategoryColor(value) {
  const hexMatch = normalizeCategoryKey(value).match(/^#?([0-9a-f]{6})$/);
  return hexMatch ? `#${hexMatch[1]}` : null;
}

export function categoryFallbackColor(key) {
  const k = normalizeCategoryKey(key);
  if (k === 'default') {
    const def = categories.find(c => normalizeCategoryKey(c.key) === 'default');
    const c = def && normalizeCategoryColor(def.color);
    return c || '#9ca3af';
  }
  // Tiny hash to deterministic rgb hex
  let h = 0;
  const s = k || 'x';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const r = (h & 0xff).toString(16).padStart(2, '0');
  const g = ((h >> 8) & 0xff).toString(16).padStart(2, '0');
  const b = ((h >> 16) & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function categoryFallbackName(key) {
  const k = normalizeCategoryKey(key);
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/**
 * Seed Cases are volume-less until the caller computes and assigns `volume`
 * from `dimensions` (see callers in app.js) — declared here as optional so
 * that assignment type-checks without changing the seed data itself.
 * @returns {Array<Record<string, any> & { volume?: number }>}
 */
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
      shape: 'box',
      stackable: true,
      maxStackCount: 0,
      orientationLock: 'any',
      noStackOnTop: false,
      isPallet: false,
      maxPalletWeight: 0,
      hazmatClass: null,
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
      shape: 'box',
      stackable: true,
      maxStackCount: 0,
      orientationLock: 'any',
      noStackOnTop: false,
      isPallet: false,
      maxPalletWeight: 0,
      hazmatClass: null,
      canFlip: false,
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
      shape: 'box',
      stackable: true,
      maxStackCount: 0,
      orientationLock: 'any',
      noStackOnTop: false,
      isPallet: false,
      maxPalletWeight: 0,
      hazmatClass: null,
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
      shape: 'box',
      stackable: true,
      maxStackCount: 0,
      orientationLock: 'any',
      noStackOnTop: false,
      isPallet: false,
      maxPalletWeight: 0,
      hazmatClass: null,
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
      shape: 'box',
      stackable: true,
      maxStackCount: 0,
      orientationLock: 'any',
      noStackOnTop: false,
      isPallet: false,
      maxPalletWeight: 0,
      hazmatClass: null,
      canFlip: false,
      notes: '',
      color: '#ec4899',
      createdAt: now,
      updatedAt: now,
    },
  ].map(caseData => ({ ...caseData, itemCode: null }));
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
    title: 'Demo Load Plan',
    loadPlanNumber: generateLoadPlanNumber([]),
    customerReference: null,
    client: 'Example Client',
    projectName: 'Envato Preview',
    drawnBy: 'Truck Packer 3D',
    notes: 'Tip: Use AutoPack (Ctrl/Cmd+P) to fill the truck.',
    truck: { length: 636, width: 102, height: 98, shapeMode: 'rect', shapeConfig: {} },
    cases: instances.filter(i => Boolean(i.caseId)),
    groups: [],
    stats: {
      totalCases: instances.length,
      hiddenCases: 0,
      packedCases: 0,
      volumeUsed: 0,
      volumePercent: 0,
      totalWeight: 0,
      cog: null,
      oogWarnings: [],
      palletWarnings: [],
    },
    createdAt: now,
    lastEdited: now,
  };
}
