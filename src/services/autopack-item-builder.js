import { buildOrientationCandidates } from './autopack-solver.js';
import { canonicalCargoForStorage } from '../core/cargo-canonical.js';

const CARGO_RULE_FIELDS = [
  'noStackOnTop',
  'isPallet',
  'stackable',
  'maxStackCount',
  'maxPalletWeight',
  'laneItem',
  'loadPriority',
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

function buildOrientations(dims, caseData, inst) {
  return buildOrientationCandidates(dims, {
    orientationLock: caseData.orientationLock,
    orientationLocked: inst.orientationLocked,
    lockedRotation: inst.lockedRotation,
  }).map(candidate => ({
    l: candidate.l, w: candidate.w, h: candidate.h,
    rotX: candidate.rotation.x, rotY: candidate.rotation.y, rotZ: candidate.rotation.z,
    ...(candidate.locked && { locked: true }),
  }));
}

export function buildLegacyAutoPackItems({
  instances = [],
  getCaseById,
  volumeInCubicInches,
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
      const orientations = buildOrientations(d, caseData, inst);
      return { inst, caseData, volume: vol, orientations };
    })
    .filter(Boolean)
    .sort((a, b) => b.volume - a.volume);
}
