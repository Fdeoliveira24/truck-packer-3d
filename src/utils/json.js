/**
 * @file json.js
 * @description JSON utilities for safe parsing, cloning, and sanitization.
 * @module utils/json
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

export function sanitizeJSON(value) {
  if (Array.isArray(value)) return value.map(sanitizeJSON);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach(key => {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
    out[key] = sanitizeJSON(value[key]);
  });
  return out;
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
