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

// Density tiers describe capacity only. Red means near capacity, not invalid.
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
  // Product decision: only the Scale (spatial) visualization is rendered.
  // Keep this helper for backward compatibility with stored preferences.
  void preferences;
  return 'spatial';
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
  if (!pack || !PackLibrary || typeof PackLibrary.computeStats !== 'function') {
    return unavailable;
  }

  try {
    const stats = PackLibrary.computeStats(pack);
    const engineResult = stats && stats.spaceUtilization;
    if (!engineResult || typeof engineResult !== 'object') return unavailable;
    const usableVolume = Number(engineResult.usableVolume);
    const percentage = Number(engineResult.cargoCubePercent);
    const occupiedVolume = Number(engineResult.cargoCubeVolume);
    if (!Number.isFinite(usableVolume) || usableVolume <= 0 ||
        !Number.isFinite(percentage) || percentage < 0 || percentage > 100.05 ||
        !Number.isFinite(occupiedVolume) || occupiedVolume < 0) {
      return unavailable;
    }

    const normalizedPercentage = clamp(percentage, 0, 100);
    const unresolvedCount = Math.max(0, Math.trunc(finiteNumber(engineResult.unresolvedCount)));
    const state = engineResult.status === 'ready'
      ? 'valid'
      : engineResult.status === 'invalid' || engineResult.status === 'incomplete'
        ? engineResult.status
        : 'unavailable';
    if (state === 'unavailable') return unavailable;
    const attentionInstanceIds = new Set([
      ...(engineResult.diagnostics?.outside || []).map(item => item.instanceId),
      ...(engineResult.diagnostics?.blockedIntersections || []).map(item => item.instanceId),
      ...(engineResult.diagnostics?.overlaps || []).flatMap(item => item.instanceIds || []),
    ].filter(Boolean));
    return {
      state,
      source: 'PackLibrary.computeStats(pack)',
      engineResult,
      percentage: normalizedPercentage,
      occupiedVolume,
      usableVolume,
      availableVolume: Math.max(0, usableVolume - occupiedVolume),
      loadedCount: Math.max(0, Math.trunc(finiteNumber(engineResult.loadedCount))),
      stagedCount: Math.max(0, Math.trunc(finiteNumber(engineResult.stagedCount))),
      hiddenCount: Math.max(0, Math.trunc(finiteNumber(engineResult.hiddenCount))),
      unresolvedCount,
      spatialUtilizationPercent: finiteNumber(engineResult.spatialUtilizationPercent),
      occupiedEnvelopeVolume: finiteNumber(engineResult.occupiedEnvelopeVolume),
      overlapVolume: finiteNumber(engineResult.overlapVolume),
      outsideVolume: finiteNumber(engineResult.outsideVolume),
      blockedIntersectionVolume: finiteNumber(engineResult.blockedIntersectionVolume),
      attentionCount: attentionInstanceIds.size,
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

  if (percentage !== null) {
    return {
      state,
      headline: `${percentText(percentage)} Occupied`,
      subline: '',
      statusLine: `${percentText(emptyPercentage)} Remaining`,
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

function makeGaugeVisualWrap(documentRef) {
  const wrap = documentRef.createElement('div');
  wrap.className = 'tp3d-util-gauge__visual';
  return wrap;
}

function makeSpatialGauge(documentRef, presentation) {
  const wrap = documentRef.createElement('div');
  wrap.className = 'tp3d-util-gauge__spatial-wrap';
  const ticks = documentRef.createElement('div');
  ticks.className = 'tp3d-util-gauge__spatial-ticks';
  appendTextElement(documentRef, ticks, 'span', '', '0%');
  appendTextElement(documentRef, ticks, 'span', '', '100%');
  wrap.appendChild(ticks);

  const chart = documentRef.createElement('div');
  chart.className = 'tp3d-util-gauge__spatial';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', `${presentation.headline}. ${presentation.statusLine || presentation.subline}`.trim());
  // .occupied is the filled portion, colored by the overall current
  // utilization tier; .empty is the neutral remainder, so only the occupied
  // portion of the scale ever shows an active color. Both live inside a
  // clipped track layer so the pill shape stays clean; the marker sits
  // outside that clip so it isn't cut off where it overhangs the track.
  const track = documentRef.createElement('span');
  track.className = 'tp3d-util-gauge__spatial-track';
  const occupied = documentRef.createElement('span');
  occupied.className = 'tp3d-util-gauge__occupied';
  const empty = documentRef.createElement('span');
  empty.className = 'tp3d-util-gauge__empty';
  track.appendChild(occupied);
  track.appendChild(empty);
  chart.appendChild(track);
  // Non-interactive triangle tick (not a round endpoint dot) marking the
  // current position on the scale.
  const marker = documentRef.createElement('span');
  marker.className = 'tp3d-util-gauge__spatial-marker';
  chart.appendChild(marker);
  wrap.appendChild(chart);
  return wrap;
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

function appendRemaining(documentRef, parent, presentation) {
  if (presentation.state === 'valid' && presentation.statusLine) {
    appendTextElement(documentRef, parent, 'div', 'tp3d-util-gauge__remaining', presentation.statusLine);
  }
}

function measuredResult(result) {
  return result && result.state === 'updating' && result.previousResult
    ? result.previousResult
    : (result || {});
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
  // Occupied/Remaining already live in the headline and the remaining
  // subline above — the stats rows cover what isn't shown yet: volumes.
  [
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
 * @param {{
 *   documentRef?: Document,
 *   result?: Record<string, any>,
 *   detail?: string,
 *   lengthUnit?: string,
 * }} [options]
 */
export function createSpaceUtilizationGauge({
  documentRef = document,
  result,
  detail = 'standard',
  lengthUnit = 'in',
} = {}) {
  const presentation = buildSpaceUtilizationPresentation(result);
  const resolvedStyle = 'spatial';
  const resolvedDetail = detail === 'standard' ? 'standard' : 'minimal';
  const gauge = documentRef.createElement('section');
  const sequence = ++gaugeSequence;
  const titleId = `tp3d-util-gauge-title-${sequence}`;
  const summaryId = `tp3d-util-gauge-summary-${sequence}`;
  gauge.className = `card tp3d-util-gauge tp3d-util-gauge--${resolvedStyle} tp3d-util-gauge--${resolvedDetail} ` +
    `tp3d-util-gauge--${presentation.state}`;
  gauge.dataset.role = 'space-utilization-gauge';
  gauge.dataset.state = presentation.state;
  gauge.dataset.style = resolvedStyle;
  gauge.dataset.detail = resolvedDetail;
  gauge.setAttribute('aria-labelledby', titleId);
  gauge.setAttribute('aria-describedby', summaryId);
  if (presentation.chartPercentage !== null) {
    gauge.style.setProperty('--util-occupied-percent', String(presentation.chartPercentage));
    gauge.classList.add(`tp3d-util-density--${getUtilizationDensityTier(presentation.chartPercentage)}`);
  }

  const header = documentRef.createElement('div');
  header.className = 'tp3d-util-gauge__header';
  const title = appendTextElement(documentRef, header, 'span', 'tp3d-util-gauge__title', 'Space Utilization');
  title.id = titleId;
  gauge.appendChild(header);

  const body = documentRef.createElement('div');
  body.className = 'tp3d-util-gauge__body';
  const primary = documentRef.createElement('div');
  primary.className = 'tp3d-util-gauge__primary';
  if (presentation.chartPercentage !== null) {
    const visual = makeGaugeVisualWrap(documentRef);
    visual.appendChild(makeSpatialGauge(documentRef, presentation));
    primary.appendChild(visual);
  }
  appendHeadline(documentRef, primary, presentation);
  appendRemaining(documentRef, primary, presentation);
  body.appendChild(primary);
  if (presentation.subline) {
    appendTextElement(documentRef, body, 'div', 'tp3d-util-gauge__subline', presentation.subline);
  }
  if (presentation.state !== 'unavailable') {
    appendStandardStats(documentRef, body, measuredResult(result), lengthUnit);
  }
  gauge.appendChild(body);

  const summaryParts = [presentation.headline, presentation.subline, presentation.statusLine]
    .filter(Boolean);
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
