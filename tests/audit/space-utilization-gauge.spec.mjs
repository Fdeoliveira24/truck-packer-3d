import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { defaultPreferences } from '../../src/core/defaults.js';
import { normalizePreferences } from '../../src/core/normalizer.js';
import {
  BOTTOM_LEFT_GAUGE_POSITION,
  UTILIZATION_DENSITY_TIERS,
  buildSpaceUtilizationArcSegments,
  buildSpaceUtilizationPresentation,
  buildSpaceUtilizationResult,
  clampSpaceUtilizationPixels,
  createSpaceUtilizationGauge,
  findSpaceUtilizationSafePosition,
  formatSpaceUtilizationVolume,
  getSpaceUtilizationDockedPosition,
  getSpaceUtilizationGaugeDetail,
  getSpaceUtilizationGaugeStyle,
  getSpaceUtilizationSafeBounds,
  resetSpaceUtilizationPosition,
  shouldShowSpaceUtilizationGauge,
  spaceUtilizationPixelsFromPreference,
  spaceUtilizationPreferenceFromPixels,
  toggleSpaceUtilizationGaugeVisibility,
} from '../../src/ui/space-utilization-gauge.js';

const cssPath = new globalThis.URL('../../styles/main.css', import.meta.url);
const gaugePath = new globalThis.URL('../../src/ui/space-utilization-gauge.js', import.meta.url);
const editorPath = new globalThis.URL('../../src/screens/editor-screen.js', import.meta.url);
const sceneRuntimePath = new globalThis.URL('../../src/editor/scene-runtime.js', import.meta.url);
const settingsPath = new globalThis.URL('../../src/ui/overlays/settings-overlay.js', import.meta.url);
const importExportPath = new globalThis.URL('../../src/services/import-export.js', import.meta.url);
const packModelPath = new globalThis.URL('../../src/data/models/pack.model.js', import.meta.url);
const caseModelPath = new globalThis.URL('../../src/data/models/case.model.js', import.meta.url);

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.styleValues = new Map();
    this.style = { setProperty: (name, value) => this.styleValues.set(name, value) };
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.id = '';
    this.title = '';
    this.type = '';
    this.listeners = new Map();
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this._classes.add(name)),
      contains: name => this._classes.has(name),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !this._classes.has(name) : Boolean(force);
        if (shouldAdd) this._classes.add(name);
        else this._classes.delete(name);
        return shouldAdd;
      },
    };
  }

  set className(value) {
    this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get className() {
    return Array.from(this._classes).join(' ');
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }
}

const testDocument = {
  createElement: tagName => new TestElement(tagName),
};

function walk(root) {
  return [root, ...root.children.flatMap(walk)];
}

function byRole(root, role) {
  return walk(root).find(element => element.dataset.role === role) || null;
}

function byClass(root, className) {
  return walk(root).find(element => element.classList.contains(className)) || null;
}

function textTree(root) {
  return walk(root)
    .filter(element => {
      let current = element;
      while (current) {
        if (current.hidden) return false;
        current = current.parentElement;
      }
      return true;
    })
    .map(element => element.textContent)
    .filter(Boolean)
    .join(' | ');
}

function packFixture() {
  return {
    id: 'pack-util-1',
    truck: { length: 100, width: 50, height: 40 },
    cases: [{ id: 'instance-1', caseId: 'case-1' }],
  };
}

function libraryFixture(overrides = {}) {
  const getTrailerCapacityInches3 = overrides.getTrailerCapacityInches3 || (() => 200000);
  const computeStats = overrides.computeStats || (() => ({
    volumePercent: 37.4,
    volumeUsed: 74800,
    packedCases: 4,
    stagedCases: 2,
    unresolvedInstances: 0,
    totalsComplete: true,
    utilizationComplete: true,
  }));
  return {
    ...overrides,
    computeStats: () => {
      const stats = computeStats();
      if (stats.spaceUtilization) return stats;
      const usableVolume = Number(getTrailerCapacityInches3());
      Object.defineProperty(stats, 'spaceUtilization', {
        enumerable: false,
        value: {
          status: stats.unresolvedInstances > 0 || stats.totalsComplete === false || stats.utilizationComplete === false
            ? 'incomplete'
            : 'ready',
          usableVolume,
          cargoCubePercent: stats.volumePercent,
          cargoCubeVolume: stats.volumeUsed,
          occupiedEnvelopeVolume: stats.volumeUsed,
          spatialUtilizationPercent: stats.volumePercent,
          overlapVolume: 0,
          outsideVolume: 0,
          blockedIntersectionVolume: 0,
          loadedCount: stats.packedCases,
          stagedCount: stats.stagedCases,
          hiddenCount: 0,
          unresolvedCount: stats.unresolvedInstances,
          diagnostics: { outside: [], blockedIntersections: [], overlaps: [] },
        },
      });
      return stats;
    },
    getTrailerCapacityInches3,
  };
}

test('Space Utilization gauge defaults are hidden, Spatial, Minimal, and bottom-left', () => {
  assert.deepEqual(defaultPreferences.spaceUtilization, {
    showGauge: false,
    style: 'spatial',
    detail: 'minimal',
    position: { mode: 'bottom-left', x: 0, y: 1 },
  });
  assert.equal(shouldShowSpaceUtilizationGauge(defaultPreferences), false);
  assert.equal(getSpaceUtilizationGaugeStyle(defaultPreferences), 'spatial');
  assert.equal(getSpaceUtilizationGaugeDetail(defaultPreferences), 'minimal');
});

test('legacy preference records normalize without requiring Space Utilization keys', () => {
  const normalized = normalizePreferences({ theme: 'dark', units: { length: 'ft', weight: 'lb' } });
  assert.equal(normalized.theme, 'dark');
  assert.deepEqual(normalized.spaceUtilization, defaultPreferences.spaceUtilization);
});

test('visibility and style remain independent preferences', () => {
  const hiddenArc = normalizePreferences({
    spaceUtilization: {
      showGauge: false,
      style: 'arc',
      detail: 'standard',
      position: { mode: 'bottom-left', x: 0, y: 1 },
    },
  });
  assert.equal(shouldShowSpaceUtilizationGauge(hiddenArc), false);
  assert.equal(getSpaceUtilizationGaugeStyle(hiddenArc), 'arc');
  assert.equal(getSpaceUtilizationGaugeDetail(hiddenArc), 'standard');

  const visibleSpatial = normalizePreferences({
    spaceUtilization: { showGauge: true, style: 'spatial', detail: 'minimal' },
  });
  assert.equal(shouldShowSpaceUtilizationGauge(visibleSpatial), true);
  assert.equal(getSpaceUtilizationGaugeStyle(visibleSpatial), 'spatial');
});

test('quick visibility toggling preserves style, detail, position, and unrelated preferences', () => {
  const preferences = normalizePreferences({
    theme: 'dark',
    spaceUtilization: {
      showGauge: false,
      style: 'arc',
      detail: 'standard',
      position: { mode: 'custom', x: 0.35, y: 0.72 },
    },
  });
  const shown = toggleSpaceUtilizationGaugeVisibility(preferences);
  assert.equal(shown.spaceUtilization.showGauge, true);
  assert.equal(shown.spaceUtilization.style, 'arc');
  assert.equal(shown.spaceUtilization.detail, 'standard');
  assert.deepEqual(shown.spaceUtilization.position, { mode: 'custom', x: 0.35, y: 0.72 });
  assert.equal(shown.theme, 'dark');
  assert.equal(toggleSpaceUtilizationGaugeVisibility(shown).spaceUtilization.showGauge, false);
});

test('custom normalized positions clamp and invalid saved positions fall back safely', () => {
  const normalized = normalizePreferences({
    spaceUtilization: {
      showGauge: true,
      style: 'arc',
      detail: 'standard',
      position: { mode: 'custom', x: 4, y: -2 },
    },
  });
  assert.deepEqual(normalized.spaceUtilization.position, { mode: 'custom', x: 1, y: 0 });
  const invalid = normalizePreferences({
    spaceUtilization: { position: { mode: 'custom', x: 'not-a-number', y: null } },
  });
  assert.deepEqual(invalid.spaceUtilization.position, BOTTOM_LEFT_GAUGE_POSITION);
});

test('reset position and pixel conversion preserve safe normalized positioning', () => {
  assert.deepEqual(resetSpaceUtilizationPosition(), BOTTOM_LEFT_GAUGE_POSITION);
  const bounds = getSpaceUtilizationSafeBounds({ width: 900, height: 600 }, { width: 280, height: 130 });
  assert.deepEqual(bounds, { minX: 12, maxX: 608, minY: 12, maxY: 458 });
  const docked = getSpaceUtilizationDockedPosition(bounds, 64);
  assert.deepEqual(docked, { x: 88, y: bounds.maxY });
  assert.deepEqual(getSpaceUtilizationDockedPosition(bounds, 80), { x: 104, y: bounds.maxY });
  assert.deepEqual(spaceUtilizationPixelsFromPreference(BOTTOM_LEFT_GAUGE_POSITION, bounds), docked);
  assert.deepEqual(
    spaceUtilizationPixelsFromPreference(BOTTOM_LEFT_GAUGE_POSITION, bounds, { x: 104, y: bounds.maxY }),
    { x: 104, y: bounds.maxY }
  );
  assert.deepEqual(clampSpaceUtilizationPixels({ x: -100, y: 9999 }, bounds), {
    x: bounds.minX,
    y: bounds.maxY,
  });
  const saved = spaceUtilizationPreferenceFromPixels({ x: bounds.maxX, y: bounds.minY }, bounds);
  assert.deepEqual(saved, { mode: 'custom', x: 1, y: 0 });
});

test('safe positioning preserves unobstructed custom placement and avoids visible controls', () => {
  const bounds = { minX: 12, maxX: 600, minY: 12, maxY: 420 };
  const gaugeSize = { width: 270, height: 120 };
  const safeRequest = { x: 40, y: 200 };
  assert.deepEqual(findSpaceUtilizationSafePosition(safeRequest, bounds, gaugeSize, []), safeRequest);

  const blockedRequest = { x: 250, y: 64 };
  const obstructions = [
    { left: 180, top: 12, right: 470, bottom: 72 },
    { left: 220, top: 300, right: 560, bottom: 420 },
  ];
  const resolved = findSpaceUtilizationSafePosition(blockedRequest, bounds, gaugeSize, obstructions);
  assert.notDeepEqual(resolved, blockedRequest);
  assert.ok(resolved.x >= bounds.minX && resolved.x <= bounds.maxX);
  assert.ok(resolved.y >= bounds.minY && resolved.y <= bounds.maxY);
});

test('default dock stays 12px from the bottom and ignores non-overlapping center panels', () => {
  const bounds = getSpaceUtilizationSafeBounds({ width: 1200, height: 700 }, { width: 272, height: 128 });
  const docked = getSpaceUtilizationDockedPosition(bounds, 64);
  assert.deepEqual(docked, { x: 88, y: 560 });
  const centeredAutoPack = { left: 470, top: 180, right: 830, bottom: 470 };
  assert.deepEqual(
    findSpaceUtilizationSafePosition(docked, bounds, { width: 272, height: 128 }, [centeredAutoPack]),
    docked
  );

  const overlappingAutoPack = { left: 220, top: 520, right: 570, bottom: 688 };
  assert.notDeepEqual(
    findSpaceUtilizationSafePosition(docked, bounds, { width: 272, height: 128 }, [overlappingAutoPack]),
    docked
  );
});

test('gauge result reuses the live calculation and never hardcodes a sample percentage', () => {
  const pack = packFixture();
  const result = buildSpaceUtilizationResult(pack, libraryFixture());
  assert.equal(result.state, 'valid');
  assert.equal(result.percentage, 37.4);
  assert.equal(result.source, 'PackLibrary.computeStats(pack)');

  const changed = buildSpaceUtilizationResult(pack, libraryFixture({
    computeStats: () => ({
      volumePercent: 62.9,
      volumeUsed: 125800,
      packedCases: 8,
      stagedCases: 1,
      unresolvedInstances: 0,
      totalsComplete: true,
    }),
  }));
  assert.equal(changed.percentage, 62.9);
});

test('live result calculation does not store derived utilization on Pack or Case data', () => {
  const pack = packFixture();
  const before = globalThis.structuredClone(pack);
  buildSpaceUtilizationResult(pack, libraryFixture());
  assert.deepEqual(pack, before);
  assert.equal(Object.hasOwn(pack, 'spaceUtilization'), false);
  assert.equal(Object.hasOwn(pack.cases[0], 'spaceUtilization'), false);
});

test('incomplete measurements remain capacity-only while unavailable results are explicit', () => {
  const incomplete = buildSpaceUtilizationResult(packFixture(), libraryFixture({
    computeStats: () => ({
      volumePercent: 63.2,
      volumeUsed: 126400,
      packedCases: 6,
      stagedCases: 3,
      unresolvedInstances: 3,
      totalsComplete: false,
      utilizationComplete: false,
    }),
  }));
  const incompleteCopy = buildSpaceUtilizationPresentation(incomplete);
  assert.equal(incomplete.state, 'incomplete');
  assert.equal(incompleteCopy.headline, '63.2% Occupied');
  assert.equal(incompleteCopy.subline, '');
  assert.equal(incompleteCopy.statusLine, '36.8% Remaining');

  const unavailable = buildSpaceUtilizationResult(packFixture(), libraryFixture({
    getTrailerCapacityInches3: () => 0,
  }));
  assert.deepEqual(unavailable, { state: 'unavailable', source: null });
  assert.deepEqual(buildSpaceUtilizationPresentation(unavailable), {
    state: 'unavailable',
    headline: '— Occupied',
    subline: 'Space Utilization unavailable',
    statusLine: '',
    chartPercentage: null,
  });
});

test('all measured states use capacity language', () => {
  assert.equal(buildSpaceUtilizationPresentation({ state: 'valid', percentage: 0 }).headline, '0.0% Occupied');
  assert.equal(buildSpaceUtilizationPresentation({ state: 'valid', percentage: 100 }).statusLine, '0.0% Remaining');
  const invalid = buildSpaceUtilizationPresentation({ state: 'invalid', percentage: 84.6, attentionCount: 2 });
  assert.equal(invalid.headline, '84.6% Occupied');
  assert.equal(invalid.subline, '');
  assert.equal(invalid.statusLine, '15.4% Remaining');
  const updating = buildSpaceUtilizationPresentation({
    state: 'updating',
    previousResult: { state: 'valid', percentage: 42 },
  });
  assert.equal(updating.headline, '42.0% Occupied');
  assert.equal(updating.subline, '');
  assert.equal(updating.statusLine, '58.0% Remaining');
  assert.equal(updating.chartPercentage, 42);
});

test('volume formatting uses readable cubic feet or cubic metres without losing base precision', () => {
  assert.equal(formatSpaceUtilizationVolume(7135920, 'in'), '4,129.6 ft³');
  assert.equal(formatSpaceUtilizationVolume(1728, 'ft'), '1 ft³');
  assert.equal(formatSpaceUtilizationVolume(61023.7441, 'cm'), '1 m³');
  assert.doesNotMatch(formatSpaceUtilizationVolume(7135920, 'in'), /in³/);
});

test('Inspector Spatial gauge has one authoritative bar, a remaining subline, and volume rows', () => {
  const gauge = createSpaceUtilizationGauge({
    documentRef: testDocument,
    result: buildSpaceUtilizationResult(packFixture(), libraryFixture()),
    style: 'spatial',
    detail: 'minimal',
    lengthUnit: 'in',
  });
  assert.ok(byClass(gauge, 'tp3d-util-gauge__spatial'));
  assert.ok(byClass(gauge, 'tp3d-util-gauge__occupied'));
  assert.ok(byClass(gauge, 'tp3d-util-gauge__empty'));
  assert.ok(byClass(gauge, 'tp3d-util-gauge__remaining'));
  assert.ok(byClass(gauge, 'tp3d-util-gauge__stats'));
  assert.match(textTree(gauge), /37\.4%.*Occupied.*Remaining.*Used volume.*Available volume/);
  assert.equal(byRole(gauge, 'space-utilization-drag-handle'), null);
  assert.equal(byRole(gauge, 'space-utilization-analysis-action'), null);
  assert.equal(byRole(gauge, 'space-utilization-hide-action'), null);
  assert.equal(byRole(gauge, 'space-utilization-collapse-action'), null);
});

test('header exposes only the accessible Arc and Spatial preference control', () => {
  let selected = null;
  const gauge = createSpaceUtilizationGauge({
    documentRef: testDocument,
    result: buildSpaceUtilizationResult(packFixture(), libraryFixture()),
    style: 'spatial',
    onStyleChange: value => { selected = value; },
  });
  const control = byClass(gauge, 'tp3d-util-gauge__style-control');
  assert.equal(control.getAttribute('aria-label'), 'Space Utilization display');
  const buttons = walk(control).filter(element => element.tagName === 'BUTTON');
  assert.deepEqual(buttons.map(button => button.textContent), ['Arc', 'Spatial']);
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-pressed')), ['false', 'true']);
  buttons[0].listeners.get('click')();
  assert.equal(selected, 'arc');
});

test('Spatial and Arc gauges remain bounded at 0, 1, 50, 99, and 100 percent', async () => {
  const css = await fs.readFile(cssPath, 'utf8');
  [0, 1, 50, 99, 100].forEach(percentage => {
    const result = { ...buildSpaceUtilizationResult(packFixture(), libraryFixture()), percentage };
    const arcGauge = createSpaceUtilizationGauge({
      documentRef: testDocument,
      result,
      style: 'arc',
      detail: 'minimal',
    });
    const spatialGauge = createSpaceUtilizationGauge({
      documentRef: testDocument,
      result,
      style: 'spatial',
      detail: 'minimal',
    });
    const arc = byClass(arcGauge, 'tp3d-util-gauge__arc');
    const headline = byClass(arcGauge, 'tp3d-util-gauge__headline');
    assert.ok(arc);
    assert.ok(headline);
    assert.equal(walk(arc).includes(headline), false);
    assert.equal(walk(arc).filter(element => element.classList.contains('tp3d-util-gauge__arc-segment')).length, 20);
    assert.equal(spatialGauge.styleValues.get('--util-occupied-percent'), String(percentage));
    const segments = buildSpaceUtilizationArcSegments(percentage);
    assert.equal(segments.length, 20);
    assert.ok(segments.every(segment => segment.fill >= 0 && segment.fill <= 1));
  });
  assert.equal(buildSpaceUtilizationArcSegments(0).every(segment => segment.fill === 0), true);
  assert.equal(buildSpaceUtilizationArcSegments(100).every(segment => segment.fill === 1), true);
  assert.equal(buildSpaceUtilizationArcSegments(50).reduce((sum, segment) => sum + segment.fill, 0), 10);
  assert.match(css, /\.tp3d-util-gauge--arc \.tp3d-util-gauge__primary\s*{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.tp3d-util-gauge__arc,[\s\S]*width:\s*96px;/);
  assert.doesNotMatch(css, /\.tp3d-util-gauge__headline\s*{[^}]*position:\s*absolute/);
});

test('Inspector gauge shows occupied/remaining once (in the headline) and volume rows in stats', () => {
  const gauge = createSpaceUtilizationGauge({
    documentRef: testDocument,
    result: buildSpaceUtilizationResult(packFixture(), libraryFixture()),
    style: 'spatial',
    detail: 'standard',
    lengthUnit: 'in',
  });
  const stats = byClass(gauge, 'tp3d-util-gauge__stats');
  const labels = walk(stats).filter(element => element.tagName === 'DT').map(element => element.textContent);
  assert.deepEqual(labels, ['Used volume', 'Available volume']);
  assert.doesNotMatch(textTree(stats), /Usable volume|Occupied volume|Empty volume|in³/);
  const usedValue = walk(stats).find(element => element.title.includes('in³ base volume'));
  assert.ok(usedValue);

  // Occupied/Remaining appear exactly once each, outside the stats rows.
  const occupiedLabel = byClass(gauge, 'tp3d-util-gauge__occupied-label');
  assert.equal(occupiedLabel.textContent, 'Occupied');
  const remaining = byClass(gauge, 'tp3d-util-gauge__remaining');
  assert.match(remaining.textContent, /Remaining/);
  assert.doesNotMatch(textTree(stats), /Occupied|Remaining/);
});


test('semantic palette progresses from clear through green and orange to near-capacity red', async () => {
  const css = await fs.readFile(cssPath, 'utf8');
  assert.deepEqual(UTILIZATION_DENSITY_TIERS, ['very-low', 'low', 'medium', 'high', 'very-high']);
  assert.equal(UTILIZATION_DENSITY_TIERS.includes('invalid'), false);
  assert.match(css, /--util-density-very-low:\s*#dceaf4;/);
  assert.match(css, /--util-density-low:\s*#8bc8c6;/);
  assert.match(css, /--util-density-medium:\s*#4fa36c;/);
  assert.match(css, /--util-density-high:\s*#e3b341;/);
  assert.match(css, /--util-density-very-high:\s*#dc2626;/);
  assert.match(css, /--util-empty-background:\s*#f8fafc;/);
  assert.doesNotMatch(css, /\.tp3d-util-gauge__empty[\s\S]{0,250}repeating-linear-gradient/);
});

test('Inspector presentation removes viewport and obsolete Preferences controls', async () => {
  const css = await fs.readFile(cssPath, 'utf8');
  assert.match(css, /\.tp3d-util-gauge\s*{[^}]*width:\s*100%;/);
  assert.match(css, /\.tp3d-util-gauge__style-control/);
  assert.doesNotMatch(css, /\.tp3d-utilization-toggle/);
  assert.doesNotMatch(css, /\.tp3d-util-analysis/);
  assert.doesNotMatch(css, /\.tp3d-util-gauge--invalid/);
});

test('Editor panel and navigation layout changes resize the measured scene host without fixed panel-width polling', async () => {
  const [editorSource, sceneRuntimeSource, css] = await Promise.all([
    fs.readFile(editorPath, 'utf8'),
    fs.readFile(sceneRuntimePath, 'utf8'),
    fs.readFile(cssPath, 'utf8'),
  ]);
  assert.match(editorSource, /sceneHostResizeObserver = new ResizeObserver\(\(\) => \{[\s\S]*syncEditorSceneLayout\(\)/);
  assert.match(editorSource, /sceneHostResizeObserver\.observe\(viewportEl\)/);
  assert.match(editorSource, /function syncEditorSceneLayout\(\)[\s\S]*viewportEl\.getBoundingClientRect\(\)[\s\S]*SceneManager\.resize\(\)/);
  assert.match(editorSource, /function onActivated\(\)[\s\S]*scheduleEditorSceneLayoutSync\(\)/);
  assert.match(editorSource, /function setPanelVisible\(side, visible\)[\s\S]*is-left-panel-hidden[\s\S]*is-right-panel-hidden[\s\S]*scheduleEditorSceneLayoutSync\(\)/);
  assert.doesNotMatch(editorSource, /function setPanelVisible\(side, visible\)[\s\S]{0,1800}defaultCol/);
  assert.doesNotMatch(editorSource, /maxAttempts|attemptResize/);
  assert.match(sceneRuntimeSource, /const \{ width, height \} = getContainerSize\(\)/);
  assert.match(sceneRuntimeSource, /camera\.aspect = width \/ height;[\s\S]*camera\.updateProjectionMatrix\(\);[\s\S]*renderer\.setPixelRatio\(pixelRatio\);[\s\S]*renderer\.setSize\(width, height\);[\s\S]*render\(\);/);
  assert.match(css, /grid-template-columns:\s*var\(--left-col\) minmax\(0, 1fr\) var\(--right-col\);/);
  assert.match(css, /\.canvas-wrap\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/);
  assert.match(css, /\.editor-shell\.is-left-panel-hidden\s*{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--right-col\);/);
  assert.match(css, /\.editor-shell\.is-right-panel-hidden\s*{[\s\S]*grid-template-columns:\s*var\(--left-col\) minmax\(0, 1fr\);/);
});

test('integration stays Inspector-only and does not introduce persistence, database, or sample-data wiring', async () => {
  const [gaugeSource, editorSource, settingsSource, importExportSource, packModelSource, caseModelSource] = await Promise.all([
    fs.readFile(gaugePath, 'utf8'),
    fs.readFile(editorPath, 'utf8'),
    fs.readFile(settingsPath, 'utf8'),
    fs.readFile(importExportPath, 'utf8'),
    fs.readFile(packModelPath, 'utf8'),
    fs.readFile(caseModelPath, 'utf8'),
  ]);
  assert.doesNotMatch(gaugeSource, /supabase|migration|database/i);
  assert.match(editorSource, /function renderSpaceUtilizationSection\(pack\)/);
  assert.match(editorSource, /inspectorEl\.appendChild\(gauge\)/);
  assert.match(editorSource, /spaceUtilization: \{ \.\.\.\(prefs\.spaceUtilization \|\| \{\}\), style \}/);
  assert.match(editorSource, /Load Summary/);
  assert.match(editorSource, />In truck</);
  assert.match(editorSource, />Staged</);
  assert.doesNotMatch(editorSource, /space-utilization-visibility-toggle|Space Utilization Analysis|setSpaceUtilizationCollapsed/);
  assert.doesNotMatch(settingsSource, /Show gauge|Gauge detail|Current gauge position|tp3d-prefs-reset-position/);
  assert.doesNotMatch(gaugeSource, /Geometric Preview|Not Validated|require attention|space-utilization-analysis-action/);
  assert.doesNotMatch(`${importExportSource}\n${packModelSource}\n${caseModelSource}`, /spaceUtilization/i);
});
