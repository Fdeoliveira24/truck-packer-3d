// Core pure utilities extracted from app.js
export { uuid } from '../utils/uuid.js';
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function sanitizeJSON(value) {
  // Prevent prototype pollution via imported JSON (__proto__/constructor/prototype keys).
  if (Array.isArray(value)) return value.map(sanitizeJSON);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach(key => {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
    out[key] = sanitizeJSON(value[key]);
  });
  return out;
}

export function parseResolution(res) {
  const m = String(res || '').match(/^(\d+)x(\d+)$/);
  if (!m) return { width: 1920, height: 1080 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

export const lengthUnits = ['in', 'ft', 'mm', 'cm', 'm'];
export const weightUnits = ['lb', 'kg'];

export function inchesToUnit(inches, unit) {
  switch (unit) {
    case 'in':
      return inches;
    case 'ft':
      return inches / 12;
    case 'mm':
      return inches * 25.4;
    case 'cm':
      return inches * 2.54;
    case 'm':
      return inches * 0.0254;
    default:
      return inches;
  }
}

export function unitToInches(value, unit) {
  switch (unit) {
    case 'in':
      return value;
    case 'ft':
      return value * 12;
    case 'mm':
      return value / 25.4;
    case 'cm':
      return value / 2.54;
    case 'm':
      return value / 0.0254;
    default:
      return value;
  }
}

export function poundsToUnit(lb, unit) {
  switch (unit) {
    case 'lb':
      return lb;
    case 'kg':
      return lb * 0.45359237;
    default:
      return lb;
  }
}

export function unitToPounds(value, unit) {
  switch (unit) {
    case 'lb':
      return value;
    case 'kg':
      return value / 0.45359237;
    default:
      return value;
  }
}

export function formatLength(inches, unit, digits = 1) {
  const v = inchesToUnit(inches, unit);
  const fixed = unit === 'in' ? 0 : digits;
  return `${Number.isFinite(v) ? v.toFixed(fixed) : '—'} ${unit}`;
}

export function formatWeight(lb, unit, digits = 1) {
  const v = poundsToUnit(lb, unit);
  const fixed = unit === 'lb' ? 0 : digits;
  return `${Number.isFinite(v) ? v.toFixed(fixed) : '—'} ${unit}`;
}

export function formatDims(dimInches, lengthUnit) {
  const l = inchesToUnit(dimInches.length, lengthUnit);
  const w = inchesToUnit(dimInches.width, lengthUnit);
  const h = inchesToUnit(dimInches.height, lengthUnit);
  const fixed = lengthUnit === 'in' ? 0 : 1;
  return `${l.toFixed(fixed)}×${w.toFixed(fixed)}×${h.toFixed(fixed)} ${lengthUnit}`;
}

export function volumeInCubicInches(dimInches) {
  const { length, width, height } = dimInches;
  return Math.max(0, Number(length) * Number(width) * Number(height));
}

export function formatVolume(dimInches, lengthUnit) {
  const in3 = volumeInCubicInches(dimInches);
  if (!Number.isFinite(in3)) return '—';
  const isImperial = lengthUnit === 'in' || lengthUnit === 'ft';
  if (isImperial) {
    const ft3 = in3 / 1728;
    return `${ft3.toFixed(1)} ft³`;
  }
  const m3 = in3 * Math.pow(0.0254, 3);
  return `${m3.toFixed(3)} m³`;
}
