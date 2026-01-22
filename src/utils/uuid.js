/**
 * @file uuid.js
 * @description UUID generation utility used for creating stable identifiers.
 * @module utils/uuid
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function uuid() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const cryptoObj = globalThis.crypto || globalThis.msCrypto;
  if (!cryptoObj || !cryptoObj.getRandomValues) {
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  const buf = new Uint8Array(16);
  cryptoObj.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
