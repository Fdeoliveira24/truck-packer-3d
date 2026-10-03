/**
 * @file space-utilization-gauge.js
 * @description Pure result/presentation helpers and DOM factory for the Editor Space Utilization gauge.
 * @module ui/space-utilization-gauge
 */

// Density tiers describe capacity only. Red means near capacity, not invalid.
export const UTILIZATION_DENSITY_TIERS = Object.freeze([
  'very-low',
  'low',
  'medium',
  'high',
  'very-high',
]);

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
    // No measured analysis to show (e.g. AutoPack is still loading cargo):
    // say so plainly instead of showing a placeholder or interim percentage.
    return {
      state,
      headline: 'Updating…',
      subline: '',
      statusLine: '',
      chartPercentage: null,
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
    // With no measured analysis "Updating…" is a status line, not a readout.
    if (presentation.state === 'updating' && presentation.chartPercentage === null) {
      headline.classList.add('tp3d-util-gauge__headline--status');
    }
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
  // Volume rows need a measured analysis; an update with no previous result has none.
  if (presentation.state !== 'unavailable' && (presentation.state !== 'updating' || presentation.chartPercentage !== null)) {
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
