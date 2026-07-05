import { canonicalOrientationLock } from '../core/orientation.js';
import { canonicalCargoForStorage } from '../core/cargo-canonical.js';

const CARGO_RULE_FIELDS = [
  'canFlip',
  'noStackOnTop',
  'isPallet',
  'stackable',
  'maxStackCount',
  'maxPalletWeight',
  'laneItem',
  'loadPriority',
  'orientationLock',
  'shape',
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function mergeCanonicalCargoRules(caseData, inst) {
  const source = { ...(caseData || {}) };
  for (const field of CARGO_RULE_FIELDS) {
    if (hasOwn(inst, field) && inst[field] !== undefined) source[field] = inst[field];
  }
  return { ...source, ...canonicalCargoForStorage(source) };
}

function buildLockedOrientation(dims, inst, orientationTools) {
  if (!inst || inst.orientationLocked !== true) return null;
  const sourceRotation =
    inst.lockedRotation ||
    (inst.transform && inst.transform.rotation) ||
    null;
  if (!sourceRotation) return null;
  const lockedRotation = orientationTools.normalizeRightAngleRotation(sourceRotation);
  const orientedDims = orientationTools.getOrientedDimsForRotation(dims, lockedRotation);
  if (!orientedDims.length || !orientedDims.width || !orientedDims.height) return null;
  return {
    l: orientedDims.length,
    w: orientedDims.width,
    h: orientedDims.height,
    rotX: lockedRotation.x,
    rotY: lockedRotation.y,
    rotZ: lockedRotation.z,
    locked: true,
  };
}

function buildOrientations(dims, caseData, inst, orientationTools) {
  const lockedOrientation = buildLockedOrientation(dims, inst, orientationTools);
  if (lockedOrientation) return [lockedOrientation];

  // Canonical orientation ('any' | 'upright' | 'onSide') so every accepted alias
  // produces the same candidate set as the rest of the app (single source).
  const lock = canonicalOrientationLock(caseData.orientationLock);
  const canFlip = caseData.canFlip === true;
  const PI2 = Math.PI / 2;
  const seen = new Set();
  const oris = [];

  // Rotation is the single source of truth here too: derive each candidate's
  // dimensions from its right-angle rotation via the shared THREE-compatible
  // helper, instead of hardcoding a permutation that can drift on compound angles.
  function tryOri(rx, ry, rz) {
    const rotation = orientationTools.normalizeRightAngleRotation({ x: rx || 0, y: ry || 0, z: rz || 0 });
    const od = orientationTools.getOrientedDimsForRotation(dims, rotation);
    const l = od.length, w = od.width, h = od.height;
    if (!(l > 0 && w > 0 && h > 0)) return;
    const key = `${l}|${w}|${h}`;
    if (seen.has(key)) return;
    seen.add(key);
    oris.push({ l, w, h, rotX: rotation.x, rotY: rotation.y, rotZ: rotation.z });
  }

  if (lock === 'upright' || lock === 'any') {
    tryOri(0, 0, 0);
    tryOri(0, PI2, 0);
  }

  if (lock === 'onSide') {
    tryOri(0, 0, PI2);
    tryOri(PI2, 0, PI2);
  }

  // canFlip may only introduce tipped faces when the policy is 'any' - 'upright'
  // must stay upright even with canFlip:true (matches the active solver and
  // isOrientationAllowedByCasePolicy). Previously this used lock !== 'onSide',
  // which wrongly tipped upright items.
  if (canFlip && lock === 'any') {
    tryOri(0, 0, PI2);
    tryOri(PI2, 0, PI2);
    tryOri(PI2, 0, 0);
    tryOri(PI2, PI2, 0);
  }

  return oris;
}

export function buildLegacyAutoPackItems({
  instances = [],
  getCaseById,
  volumeInCubicInches,
  orientationTools,
}) {
  return (instances || [])
    .filter(inst => !inst.hidden)
    .map(inst => {
      const c = typeof getCaseById === 'function' ? getCaseById(inst.caseId) : null;
      if (!c) { return null; }
      const caseData = mergeCanonicalCargoRules(c, inst);
      const d = caseData.dimensions || { length: 0, width: 0, height: 0 };
      const shape = (caseData.shape || 'box').toLowerCase();
      let vol;
      if (shape === 'cylinder' || shape === 'drum') {
        const r = Math.min(d.width, d.height) / 2;
        vol = Math.PI * r * r * d.length;
      } else {
        vol = caseData.volume || volumeInCubicInches(d);
      }
      const orientations = buildOrientations(d, caseData, inst, orientationTools);
      return { inst, caseData, volume: vol, orientations };
    })
    .filter(Boolean)
    .sort((a, b) => b.volume - a.volume);
}
