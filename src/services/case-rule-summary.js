/**
 * @file case-rule-summary.js
 * @description Single source of truth for the short, human-readable summary of a
 * case's ACTIVE non-default AutoPack handling rules (Cargo-Rule V1). Every case
 * surface — Cases grid cards, Cases list, Editor Case Browser, the selected-case
 * Inspector, and import previews — must use this so the rules a user sees match
 * the Case modal and what the active solver actually honors.
 *
 * Default/inactive rules are intentionally omitted (Any orientation, canFlip
 * false, unlimited stack, automatic lane, normal priority). maxPalletWeight is
 * shown only as a warning, never as an enforced cap.
 * @module services/case-rule-summary
 */

import { canonicalOrientationLock } from '../core/orientation.js';

/**
 * Case-level active non-default handling rules, as short chip labels.
 * @param {object} caseData
 * @returns {string[]}
 */
export function getCaseHandlingSummary(caseData = {}) {
  const c = caseData && typeof caseData === 'object' ? caseData : {};
  const out = [];

  const lock = canonicalOrientationLock(c.orientationLock);
  if (lock === 'upright') out.push('Upright');
  else if (lock === 'onSide') out.push('On side');

  if (c.canFlip === true && lock === 'any') out.push('Flipping allowed');

  if (c.noStackOnTop === true || c.stackable === false) out.push('No top load');

  const maxStack = Number(c.maxStackCount) || 0;
  if (maxStack > 0) out.push(`Max ${maxStack} on top`);

  if (c.isPallet === true) out.push('Pallet base');

  const palletWarn = Number(c.maxPalletWeight) || 0;
  if (c.isPallet === true && palletWarn > 0) {
    out.push(`Max load warning: ${palletWarn.toLocaleString('en-US')} lb`);
  }

  if (c.laneItem === true) out.push('Lane: Always');
  else if (c.laneItem === false) out.push('Lane: Never');

  const prio = Number(c.loadPriority) || 0;
  if (prio > 0) out.push('Priority: High');
  else if (prio < 0) out.push('Priority: Low');

  return out;
}

/**
 * Per-instance handling note. Currently only the manual exact-orientation lock
 * is an instance-level override; it is shown separately from case-level rules so
 * users can tell "this case's policy" from "this placed item is locked".
 * @param {object} instance
 * @returns {string[]}
 */
export function getInstanceHandlingSummary(instance = {}) {
  const inst = instance && typeof instance === 'object' ? instance : {};
  const out = [];
  if (inst.orientationLocked === true) out.push('Orientation locked (this item)');
  return out;
}
