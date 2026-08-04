/**
 * @file space-utilization-gauge.js
 * @description Pure result/presentation helpers and DOM factory for the Editor Space Utilization gauge.
 * @module ui/space-utilization-gauge
 */

export const BOTTOM_LEFT_GAUGE_POSITION = Object.freeze({
  mode: 'bottom-left',
  x: 0,
  y: 1,
});

// Density tiers intentionally exclude diagnostics. Red belongs to validity,
// never to the ordinary utilization scale.
export const UTILIZATION_DENSITY_TIERS = Object.freeze([
  'very-low',
  'low',
  'medium',
  'high',
  'very-high',
]);

const SAFE_MARGIN = 12;
const DEFAULT_DOCK_LEFT = 88;
const DOCK_CONTROL_GAP = 24;
const ARC_SEGMENT_COUNT = 20;
const ARC_CENTER_X = 48;
const ARC_CENTER_Y = 44;
const ARC_RADIUS = 36;
let gaugeSequence = 0;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

function percentText(value) {
  return `${clamp(value, 0, 100).toFixed(1)}%`;
}

export function getUtilizationDensityTier(percentage) {
  const value = clamp(percentage, 0, 100);
  if (value < 20) return 'very-low';
  if (value < 40) return 'low';
  if (value < 60) return 'medium';
  if (value < 80) return 'high';
  return 'very-high';
}

export function shouldShowSpaceUtilizationGauge(preferences) {
  return Boolean(preferences && preferences.spaceUtilization && preferences.spaceUtilization.showGauge === true);
}

export function toggleSpaceUtilizationGaugeVisibility(preferences) {
  const current = preferences && typeof preferences === 'object' ? preferences : {};
  return {
    ...current,
    spaceUtilization: {
      ...(current.spaceUtilization || {}),
      showGauge: !shouldShowSpaceUtilizationGauge(current),
    },
  };
}

export function getSpaceUtilizationGaugeStyle(preferences) {
  return preferences && preferences.spaceUtilization && preferences.spaceUtilization.style === 'arc'
    ? 'arc'
    : 'spatial';
}

export function getSpaceUtilizationGaugeDetail(preferences) {
  return preferences && preferences.spaceUtilization && preferences.spaceUtilization.detail === 'standard'
    ? 'standard'
    : 'minimal';
}

export function resetSpaceUtilizationPosition() {
  return { ...BOTTOM_LEFT_GAUGE_POSITION };
}

export function getSpaceUtilizationSafeBounds(hostSize, gaugeSize) {
  const hostWidth = Math.max(0, finiteNumber(hostSize && hostSize.width));
  const hostHeight = Math.max(0, finiteNumber(hostSize && hostSize.height));
  const gaugeWidth = Math.max(0, finiteNumber(gaugeSize && gaugeSize.width));
  const gaugeHeight = Math.max(0, finiteNumber(gaugeSize && gaugeSize.height));

  return {
    minX: SAFE_MARGIN,
    maxX: Math.max(SAFE_MARGIN, hostWidth - gaugeWidth - SAFE_MARGIN),
    minY: SAFE_MARGIN,
    maxY: Math.max(SAFE_MARGIN, hostHeight - gaugeHeight - SAFE_MARGIN),
  };
}

/**
 * Resolve the default dock from the real bottom-left controls. The 88px
 * baseline keeps Information, Utilization, and the gauge on one visual line;
 * wider controls move the gauge only as far as their measured edge requires.
 */
export function getSpaceUtilizationDockedPosition(bounds, bottomControlsRight = 0) {
  const safeBounds = bounds || { minX: SAFE_MARGIN, maxX: SAFE_MARGIN, minY: SAFE_MARGIN, maxY: SAFE_MARGIN };
  return clampSpaceUtilizationPixels({
    x: Math.max(DEFAULT_DOCK_LEFT, finiteNumber(bottomControlsRight) + DOCK_CONTROL_GAP),
    y: safeBounds.maxY,
  }, safeBounds);
}

export function clampSpaceUtilizationPixels(position, bounds) {
  const safeBounds = bounds || { minX: SAFE_MARGIN, maxX: SAFE_MARGIN, minY: SAFE_MARGIN, maxY: SAFE_MARGIN };
  return {
    x: clamp(position && position.x, safeBounds.minX, safeBounds.maxX),
    y: clamp(position && position.y, safeBounds.minY, safeBounds.maxY),
  };
}

function rectangleAt(position, size) {
  const width = Math.max(0, finiteNumber(size && size.width));
  const height = Math.max(0, finiteNumber(size && size.height));
  return {
    left: position.x,
    top: position.y,
    right: position.x + width,
    bottom: position.y + height,
  };
}

function rectanglesOverlap(first, second, gap = 0) {
  return first.left < second.right + gap &&
    first.right > second.left - gap &&
    first.top < second.bottom + gap &&
    first.bottom > second.top - gap;
}

/**
 * Keep the complete gauge inside the canvas and away from visible controls.
 * A safe user-selected position is returned unchanged; alternate positions are
 * only considered when an obstruction actually overlaps the gauge.
 */
export function findSpaceUtilizationSafePosition(
  requestedPosition,
  bounds,
  gaugeSize,
  obstructions = [],
  gap = 8
) {
  const requested = clampSpaceUtilizationPixels(requestedPosition, bounds);
  const normalizedObstructions = (Array.isArray(obstructions) ? obstructions : [])
    .map(obstruction => ({
      left: finiteNumber(obstruction && obstruction.left),
      top: finiteNumber(obstruction && obstruction.top),
      right: finiteNumber(obstruction && obstruction.right),
      bottom: finiteNumber(obstruction && obstruction.bottom),
    }))
    .filter(obstruction => obstruction.right > obstruction.left && obstruction.bottom > obstruction.top);
  const isSafe = position => normalizedObstructions.every(obstruction =>
    !rectanglesOverlap(rectangleAt(position, gaugeSize), obstruction, gap)
  );
  if (isSafe(requested)) return requested;

  const width = Math.max(0, finiteNumber(gaugeSize && gaugeSize.width));
  const height = Math.max(0, finiteNumber(gaugeSize && gaugeSize.height));
  const candidates = [];
  normalizedObstructions.forEach(obstruction => {
    candidates.push(
      { x: requested.x, y: obstruction.top - height - gap },
      { x: requested.x, y: obstruction.bottom + gap },
      { x: obstruction.left - width - gap, y: requested.y },
      { x: obstruction.right + gap, y: requested.y }
    );
  });
  candidates.push(
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY }
  );

  const uniqueCandidates = Array.from(new Map(candidates.map(candidate => {
    const clamped = clampSpaceUtilizationPixels(candidate, bounds);
    return [`${clamped.x}:${clamped.y}`, clamped];
  })).values()).sort((first, second) =>
    Math.hypot(first.x - requested.x, first.y - requested.y) -
    Math.hypot(second.x - requested.x, second.y - requested.y)
  );
  return uniqueCandidates.find(isSafe) || requested;
}

export function spaceUtilizationPixelsFromPreference(position, bounds, dockedPosition = null) {
  const safeBounds = bounds || { minX: SAFE_MARGIN, maxX: SAFE_MARGIN, minY: SAFE_MARGIN, maxY: SAFE_MARGIN };
  const saved = position && typeof position === 'object' ? position : BOTTOM_LEFT_GAUGE_POSITION;
  if (saved.mode !== 'custom' || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) {
    return dockedPosition
      ? clampSpaceUtilizationPixels(dockedPosition, safeBounds)
      : getSpaceUtilizationDockedPosition(safeBounds);
  }
  const width = Math.max(0, safeBounds.maxX - safeBounds.minX);
  const height = Math.max(0, safeBounds.maxY - safeBounds.minY);
  return clampSpaceUtilizationPixels({
    x: safeBounds.minX + clamp(saved.x, 0, 1) * width,
    y: safeBounds.minY + clamp(saved.y, 0, 1) * height,
  }, safeBounds);
}

export function spaceUtilizationPreferenceFromPixels(position, bounds) {
  const safeBounds = bounds || { minX: SAFE_MARGIN, maxX: SAFE_MARGIN, minY: SAFE_MARGIN, maxY: SAFE_MARGIN };
  const clamped = clampSpaceUtilizationPixels(position, safeBounds);
  const width = Math.max(0, safeBounds.maxX - safeBounds.minX);
  const height = Math.max(0, safeBounds.maxY - safeBounds.minY);
  return {
    mode: 'custom',
    x: width > 0 ? clamp((clamped.x - safeBounds.minX) / width, 0, 1) : 0,
    y: height > 0 ? clamp((clamped.y - safeBounds.minY) / height, 0, 1) : 1,
  };
}

/**
 * @returns {Record<string, any>}
 */
export function buildSpaceUtilizationResult(pack, PackLibrary) {
  const unavailable = { state: 'unavailable', source: null };
  if (!pack || !PackLibrary || typeof PackLibrary.computeStats !== 'function' ||
      typeof PackLibrary.getTrailerCapacityInches3 !== 'function') {
    return unavailable;
  }

  try {
    const stats = PackLibrary.computeStats(pack);
    const usableVolume = Number(PackLibrary.getTrailerCapacityInches3(pack.truck));
    const percentage = Number(stats && stats.volumePercent);
    const occupiedVolume = Number(stats && stats.volumeUsed);
    if (!Number.isFinite(usableVolume) || usableVolume <= 0 ||
        !Number.isFinite(percentage) || percentage < 0 || percentage > 100.05 ||
        !Number.isFinite(occupiedVolume) || occupiedVolume < 0) {
      return unavailable;
    }

    const normalizedPercentage = clamp(percentage, 0, 100);
    const unresolvedCount = Math.max(0, Math.trunc(finiteNumber(stats.unresolvedInstances)));
    const incomplete = unresolvedCount > 0 || stats.utilizationComplete === false || stats.totalsComplete === false;
    return {
      state: incomplete ? 'incomplete' : 'valid',
      source: 'PackLibrary.computeStats(pack)',
      percentage: normalizedPercentage,
      occupiedVolume,
      usableVolume,
      availableVolume: Math.max(0, usableVolume - occupiedVolume),
      loadedCount: Math.max(0, Math.trunc(finiteNumber(stats.packedCases))),
      stagedCount: Math.max(0, Math.trunc(finiteNumber(stats.stagedCases))),
      unresolvedCount,
    };
  } catch {
    return unavailable;
  }
}

export function buildSpaceUtilizationPresentation(result) {
  const value = result && typeof result === 'object' ? result : { state: 'unavailable' };
  const state = ['valid', 'invalid', 'incomplete', 'updating', 'unavailable'].includes(value.state)
    ? value.state
    : 'unavailable';
  const previous = state === 'updating' && value.previousResult ? value.previousResult : value;
  const percentage = Number.isFinite(Number(previous.percentage))
    ? clamp(previous.percentage, 0, 100)
    : null;
  const emptyPercentage = percentage === null ? null : clamp(100 - percentage, 0, 100);

  if (state === 'valid' && percentage !== null) {
    return {
      state,
      headline: `${percentText(percentage)} Occupied`,
      subline: '',
      statusLine: `Valid · ${percentText(emptyPercentage)} empty`,
      chartPercentage: percentage,
    };
  }
  if (state === 'invalid' && percentage !== null) {
    const attentionCount = Math.max(0, Math.trunc(finiteNumber(value.attentionCount)));
    return {
      state,
      headline: `${percentText(percentage)} Geometric Preview`,
      subline: 'Preview — Not Validated',
      statusLine: attentionCount > 0
        ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} require attention`
        : 'Items require attention',
      chartPercentage: percentage,
    };
  }
  if (state === 'incomplete' && percentage !== null) {
    const unresolvedCount = Math.max(0, Math.trunc(finiteNumber(value.unresolvedCount)));
    return {
      state,
      headline: 'Analysis Incomplete',
      subline: `Partial analysis: ${percentText(percentage)}`,
      statusLine: unresolvedCount > 0
        ? `${unresolvedCount} unresolved Case${unresolvedCount === 1 ? '' : 's'} require attention`
        : 'Unresolved Cases require attention',
      chartPercentage: percentage,
    };
  }
  if (state === 'updating') {
    return {
      state,
      headline: 'Updating utilization…',
      subline: 'Showing previous analysis',
      statusLine: '',
      chartPercentage: percentage,
    };
  }
  return {
    state: 'unavailable',
    headline: '— Occupied',
    subline: 'Space Utilization unavailable',
    statusLine: '',
    chartPercentage: null,
  };
}

export function buildSpaceUtilizationArcSegments(percentage, count = ARC_SEGMENT_COUNT) {
  const segmentCount = Math.max(1, Math.trunc(finiteNumber(count, ARC_SEGMENT_COUNT)));
  const filledSegments = clamp(percentage, 0, 100) / 100 * segmentCount;
  return Array.from({ length: segmentCount }, (_, index) => {
    const progress = segmentCount === 1 ? 0.5 : index / (segmentCount - 1);
    const angle = Math.PI - progress * Math.PI;
    return {
      index,
      fill: clamp(filledSegments - index, 0, 1),
      x: ARC_CENTER_X + ARC_RADIUS * Math.cos(angle),
      y: ARC_CENTER_Y - ARC_RADIUS * Math.sin(angle),
      rotation: -90 + progress * 180,
    };
  });
}

export function formatSpaceUtilizationVolume(volumeInches3, lengthUnit = 'in') {
  const volume = Math.max(0, finiteNumber(volumeInches3));
  const metric = lengthUnit === 'cm' || lengthUnit === 'm';
  const converted = metric ? volume * 0.000016387064 : volume / 1728;
  const maximumFractionDigits = converted < 10 ? 2 : 1;
  return `${converted.toLocaleString(undefined, { maximumFractionDigits })} ${metric ? 'm³' : 'ft³'}`;
}

function baseVolumeTitle(volumeInches3) {
  const volume = Math.max(0, finiteNumber(volumeInches3));
  return `${volume.toLocaleString(undefined, { maximumFractionDigits: 0 })} in³ base volume`;
}

function appendTextElement(documentRef, parent, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function makeSpatialGauge(documentRef, presentation) {
  const chart = documentRef.createElement('div');
  chart.className = 'tp3d-util-gauge__spatial';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', `${presentation.headline}. ${presentation.statusLine || presentation.subline}`.trim());
  const occupied = documentRef.createElement('span');
  occupied.className = 'tp3d-util-gauge__occupied';
  const empty = documentRef.createElement('span');
  empty.className = 'tp3d-util-gauge__empty';
  chart.appendChild(occupied);
  chart.appendChild(empty);
  return chart;
}

function makeArcGauge(documentRef, presentation) {
  const chart = documentRef.createElement('div');
  chart.className = 'tp3d-util-gauge__arc';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', `${presentation.headline}. ${presentation.statusLine || presentation.subline}`.trim());
  const segments = documentRef.createElement('div');
  segments.className = 'tp3d-util-gauge__arc-segments';
  buildSpaceUtilizationArcSegments(presentation.chartPercentage || 0).forEach(segment => {
    const segmentEl = documentRef.createElement('span');
    segmentEl.className = 'tp3d-util-gauge__arc-segment';
    segmentEl.style.setProperty('--util-arc-index', String(segment.index));
    segmentEl.style.setProperty('--util-arc-fill', String(segment.fill));
    segmentEl.style.setProperty('--util-arc-x', String(segment.x));
    segmentEl.style.setProperty('--util-arc-y', String(segment.y));
    segmentEl.style.setProperty('--util-arc-rotation', String(segment.rotation));
    segments.appendChild(segmentEl);
  });
  chart.appendChild(segments);
  return chart;
}

function appendHeadline(documentRef, parent, presentation) {
  const headline = documentRef.createElement('div');
  headline.className = 'tp3d-util-gauge__headline';
  if (presentation.state === 'valid' && presentation.chartPercentage !== null) {
    appendTextElement(
      documentRef,
      headline,
      'strong',
      'tp3d-util-gauge__percent',
      percentText(presentation.chartPercentage)
    );
    appendTextElement(documentRef, headline, 'span', 'tp3d-util-gauge__occupied-label', 'Occupied');
  } else {
    headline.textContent = presentation.headline;
  }
  parent.appendChild(headline);
  return headline;
}

function measuredResult(result) {
  return result && result.state === 'updating' && result.previousResult
    ? result.previousResult
    : (result || {});
}

function shortStatus(presentation) {
  if (presentation.state === 'valid') return 'Valid';
  if (presentation.state === 'invalid') return 'Preview';
  if (presentation.state === 'incomplete') return 'Incomplete';
  if (presentation.state === 'updating') return 'Updating';
  return 'Unavailable';
}

function appendDefinitionRow(documentRef, list, label, value, options = {}) {
  appendTextElement(documentRef, list, 'dt', options.labelClass || '', label);
  const valueEl = appendTextElement(documentRef, list, 'dd', options.valueClass || '', value);
  if (options.title) valueEl.title = options.title;
  return valueEl;
}

function appendStandardStats(documentRef, parent, result, lengthUnit) {
  const stats = documentRef.createElement('dl');
  stats.className = 'tp3d-util-gauge__stats';
  [
    ['Loaded', String(Math.max(0, Math.trunc(finiteNumber(result.loadedCount))))],
    ['Staged', String(Math.max(0, Math.trunc(finiteNumber(result.stagedCount))))],
    [
      'Used volume',
      formatSpaceUtilizationVolume(result.occupiedVolume, lengthUnit),
      baseVolumeTitle(result.occupiedVolume),
    ],
    [
      'Available volume',
      formatSpaceUtilizationVolume(result.availableVolume, lengthUnit),
      baseVolumeTitle(result.availableVolume),
    ],
  ].forEach(([label, value, title]) => {
    appendDefinitionRow(documentRef, stats, label, value, {
      labelClass: 'tp3d-util-gauge__stat-label',
      valueClass: 'tp3d-util-gauge__stat-value',
      title,
    });
  });
  parent.appendChild(stats);
}

/**
 * Build the truthful, global-volume-only content used by Analysis Details.
 * @param {{
 *   documentRef?: Document,
 *   result?: Record<string, any>,
 *   lengthUnit?: string,
 * }} [options]
 */
export function createSpaceUtilizationAnalysisDetails({
  documentRef = document,
  result,
  lengthUnit = 'in',
} = {}) {
  const presentation = buildSpaceUtilizationPresentation(result);
  const measured = measuredResult(result);
  const hasMeasurement = presentation.chartPercentage !== null;
  const emptyPercentage = hasMeasurement
    ? clamp(100 - presentation.chartPercentage, 0, 100)
    : null;
  const root = documentRef.createElement('div');
  root.className = 'tp3d-util-analysis';
  root.dataset.role = 'space-utilization-analysis-details';

  const overview = documentRef.createElement('section');
  overview.className = 'tp3d-util-analysis__section';
  appendTextElement(documentRef, overview, 'h4', 'tp3d-util-analysis__heading', 'Overview');
  const headline = documentRef.createElement('div');
  headline.className = 'tp3d-util-analysis__headline';
  appendTextElement(
    documentRef,
    headline,
    'strong',
    'tp3d-util-analysis__primary-value',
    hasMeasurement ? percentText(presentation.chartPercentage) : '—'
  );
  appendTextElement(documentRef, headline, 'span', '', 'occupied');
  appendTextElement(
    documentRef,
    headline,
    'span',
    'tp3d-util-analysis__empty-value',
    emptyPercentage === null ? '— empty' : `${percentText(emptyPercentage)} empty`
  );
  overview.appendChild(headline);

  const overviewList = documentRef.createElement('dl');
  overviewList.className = 'tp3d-util-analysis__list';
  const rows = [
    ['Status', shortStatus(presentation)],
    ['Loaded', String(Math.max(0, Math.trunc(finiteNumber(measured.loadedCount))))],
    ['Staged', String(Math.max(0, Math.trunc(finiteNumber(measured.stagedCount))))],
    [
      'Usable volume',
      hasMeasurement ? formatSpaceUtilizationVolume(measured.usableVolume, lengthUnit) : '—',
      hasMeasurement ? baseVolumeTitle(measured.usableVolume) : '',
    ],
    [
      'Occupied volume',
      hasMeasurement ? formatSpaceUtilizationVolume(measured.occupiedVolume, lengthUnit) : '—',
      hasMeasurement ? baseVolumeTitle(measured.occupiedVolume) : '',
    ],
    [
      'Available volume',
      hasMeasurement ? formatSpaceUtilizationVolume(measured.availableVolume, lengthUnit) : '—',
      hasMeasurement ? baseVolumeTitle(measured.availableVolume) : '',
    ],
  ];
  rows.forEach(([label, value, title]) => appendDefinitionRow(documentRef, overviewList, label, value, {
    labelClass: 'tp3d-util-analysis__label',
    valueClass: 'tp3d-util-analysis__value',
    title,
  }));
  overview.appendChild(overviewList);
  root.appendChild(overview);

  const coverage = documentRef.createElement('section');
  coverage.className = 'tp3d-util-analysis__section';
  appendTextElement(documentRef, coverage, 'h4', 'tp3d-util-analysis__heading', 'Analysis Coverage');
  appendTextElement(documentRef, coverage, 'strong', 'tp3d-util-analysis__coverage-title', 'Global volume analysis');
  appendTextElement(
    documentRef,
    coverage,
    'p',
    'tp3d-util-analysis__copy',
    'This analysis compares the volume of loaded Cases with the usable space capacity.'
  );
  root.appendChild(coverage);

  const density = documentRef.createElement('section');
  density.className = 'tp3d-util-analysis__section tp3d-util-analysis__section--info';
  appendTextElement(documentRef, density, 'h4', 'tp3d-util-analysis__heading', 'Density Availability');
  appendTextElement(
    documentRef,
    density,
    'p',
    'tp3d-util-analysis__copy',
    'Spatial density analysis is not yet available.'
  );
  root.appendChild(density);
  return root;
}

/**
 * @param {{
 *   documentRef?: Document,
 *   result?: Record<string, any>,
 *   style?: string,
 *   detail?: string,
 *   lengthUnit?: string,
 *   collapsed?: boolean,
 * }} [options]
 */
export function createSpaceUtilizationGauge({
  documentRef = document,
  result,
  style = 'spatial',
  detail = 'minimal',
  lengthUnit = 'in',
  collapsed = false,
} = {}) {
  const presentation = buildSpaceUtilizationPresentation(result);
  const resolvedStyle = style === 'arc' ? 'arc' : 'spatial';
  const resolvedDetail = detail === 'standard' ? 'standard' : 'minimal';
  const gauge = documentRef.createElement('section');
  const sequence = ++gaugeSequence;
  const titleId = `tp3d-util-gauge-title-${sequence}`;
  const summaryId = `tp3d-util-gauge-summary-${sequence}`;
  const bodyId = `tp3d-util-gauge-body-${sequence}`;
  const isCollapsed = collapsed === true;
  gauge.className = `tp3d-util-gauge tp3d-util-gauge--${resolvedStyle} tp3d-util-gauge--${resolvedDetail} ` +
    `tp3d-util-gauge--${presentation.state}${isCollapsed ? ' is-collapsed' : ''}`;
  gauge.dataset.role = 'space-utilization-gauge';
  gauge.dataset.state = presentation.state;
  gauge.dataset.style = resolvedStyle;
  gauge.dataset.detail = resolvedDetail;
  gauge.dataset.collapsed = isCollapsed ? 'true' : 'false';
  gauge.setAttribute('aria-labelledby', titleId);
  gauge.setAttribute('aria-describedby', summaryId);
  if (presentation.chartPercentage !== null) {
    gauge.style.setProperty('--util-occupied-percent', String(presentation.chartPercentage));
    gauge.classList.add(`tp3d-util-density--${getUtilizationDensityTier(presentation.chartPercentage)}`);
  }

  const header = documentRef.createElement('div');
  header.className = 'tp3d-util-gauge__header';
  const handle = documentRef.createElement('button');
  handle.type = 'button';
  handle.className = 'tp3d-util-gauge__icon-btn tp3d-util-gauge__drag';
  handle.dataset.role = 'space-utilization-drag-handle';
  handle.setAttribute('aria-label', 'Move Space Utilization gauge. Drag or use the arrow keys.');
  handle.dataset.tooltip = 'Move gauge';
  const grip = documentRef.createElement('i');
  grip.className = 'fa-solid fa-grip-vertical';
  grip.setAttribute('aria-hidden', 'true');
  handle.appendChild(grip);
  header.appendChild(handle);
  const title = appendTextElement(documentRef, header, 'span', 'tp3d-util-gauge__title', 'Space Utilization');
  title.id = titleId;

  const collapsedSummary = documentRef.createElement('span');
  collapsedSummary.className = 'tp3d-util-gauge__collapsed-summary';
  collapsedSummary.hidden = !isCollapsed;
  appendTextElement(
    documentRef,
    collapsedSummary,
    'strong',
    'tp3d-util-gauge__collapsed-percent',
    presentation.chartPercentage === null ? '—' : percentText(presentation.chartPercentage)
  );
  appendTextElement(documentRef, collapsedSummary, 'span', 'tp3d-util-gauge__collapsed-status', shortStatus(presentation));
  header.appendChild(collapsedSummary);

  const actions = documentRef.createElement('div');
  actions.className = 'tp3d-util-gauge__header-actions';
  const detailsButton = documentRef.createElement('button');
  detailsButton.type = 'button';
  detailsButton.className = 'tp3d-util-gauge__icon-btn';
  detailsButton.dataset.role = 'space-utilization-analysis-action';
  detailsButton.setAttribute('aria-label', 'View analysis details');
  detailsButton.dataset.tooltip = 'View analysis details';
  detailsButton.hidden = isCollapsed;
  detailsButton.innerHTML = '<i class="fa-solid fa-chart-column" aria-hidden="true"></i>';
  actions.appendChild(detailsButton);
  const collapseButton = documentRef.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'tp3d-util-gauge__icon-btn';
  collapseButton.dataset.role = 'space-utilization-collapse-action';
  collapseButton.setAttribute('aria-label', isCollapsed ? 'Expand gauge' : 'Collapse gauge');
  collapseButton.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  collapseButton.setAttribute('aria-controls', bodyId);
  collapseButton.dataset.tooltip = isCollapsed ? 'Expand gauge' : 'Collapse gauge';
  collapseButton.innerHTML = `<i class="fa-solid fa-chevron-${isCollapsed ? 'down' : 'up'}" aria-hidden="true"></i>`;
  actions.appendChild(collapseButton);
  const hideButton = documentRef.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'tp3d-util-gauge__icon-btn';
  hideButton.dataset.role = 'space-utilization-hide-action';
  hideButton.setAttribute('aria-label', 'Hide Space Utilization');
  hideButton.dataset.tooltip = 'Hide Space Utilization';
  hideButton.hidden = isCollapsed;
  hideButton.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  actions.appendChild(hideButton);
  header.appendChild(actions);
  gauge.appendChild(header);

  const body = documentRef.createElement('div');
  body.className = 'tp3d-util-gauge__body';
  body.id = bodyId;
  body.hidden = isCollapsed;
  const primary = documentRef.createElement('div');
  primary.className = 'tp3d-util-gauge__primary';
  if (resolvedStyle === 'arc' && presentation.chartPercentage !== null) primary.appendChild(makeArcGauge(documentRef, presentation));
  appendHeadline(documentRef, primary, presentation);
  if (resolvedStyle === 'spatial' && presentation.chartPercentage !== null) primary.appendChild(makeSpatialGauge(documentRef, presentation));
  body.appendChild(primary);
  if (presentation.subline) {
    appendTextElement(documentRef, body, 'div', 'tp3d-util-gauge__subline', presentation.subline);
  }
  if (presentation.statusLine) {
    const status = documentRef.createElement('div');
    status.className = 'tp3d-util-gauge__status';
    const icon = documentRef.createElement('i');
    icon.className = presentation.state === 'invalid'
      ? 'fa-solid fa-triangle-exclamation'
      : presentation.state === 'incomplete'
        ? 'fa-solid fa-circle-exclamation'
        : 'fa-regular fa-circle-check';
    icon.setAttribute('aria-hidden', 'true');
    status.appendChild(icon);
    appendTextElement(documentRef, status, 'span', '', presentation.statusLine);
    body.appendChild(status);
  }
  if (resolvedDetail === 'standard' && presentation.state !== 'unavailable') {
    appendStandardStats(documentRef, body, measuredResult(result), lengthUnit);
  }
  gauge.appendChild(body);

  const measured = measuredResult(result);
  const summaryParts = [presentation.headline, presentation.subline, presentation.statusLine]
    .filter(Boolean);
  if (presentation.chartPercentage !== null) {
    summaryParts.push(
      `${Math.max(0, Math.trunc(finiteNumber(measured.loadedCount)))} loaded`,
      `${Math.max(0, Math.trunc(finiteNumber(measured.stagedCount)))} staged`
    );
  }
  const screenReaderSummary = appendTextElement(
    documentRef,
    gauge,
    'p',
    'visually-hidden',
    summaryParts.join('. ')
  );
  screenReaderSummary.id = summaryId;
  screenReaderSummary.setAttribute('aria-live', 'polite');
  return gauge;
}
