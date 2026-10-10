import { assessPhysicalSubject } from '../packing-core/assessment.js';
import { projectCasePhysicalSource, projectInstancePhysicalSource, projectTargetSpaceSource } from '../packing-core/domain.js';

// The committed-load compatibility policy is independent of physical truth.
const COMPATIBILITY = Object.freeze({ support50: true, wheelWellThird: true, supportWeight: true });
const CACHE_LIMIT = 32;
const assessments = new Map();

const inputKey = input => JSON.stringify([
  input.context, input.compatibility, input.targetSpace, input.instances, input.cases,
]);

// Project only consumed source, before the collision/support/statics solve. A
// malformed or ambiguous projection never enters the cache. Admission below
// also checks C2's own input/identity, so contract drift fails closed to a miss.
function projectedKey(pack, cases, compatibility) {
  if (!Array.isArray(cases) || !Array.isArray(pack?.cases) || !compatibility) return null;
  const target = projectTargetSpaceSource(pack.truck);
  if (!target.valid) return null;
  const policy = {};
  for (const key of Object.keys(COMPATIBILITY)) {
    const value = compatibility[key] === undefined ? true : compatibility[key];
    if (typeof value !== 'boolean') return null;
    policy[key] = value;
  }
  const definitions = new Map(), duplicateCases = new Set();
  for (const definition of cases) {
    if (definitions.has(definition?.id)) duplicateCases.add(definition?.id);
    definitions.set(definition?.id, definition);
  }
  const inputCases = new Map(), inputInstances = [], ids = new Set();
  const selected = pack.cases.filter(instance => instance?.placement !== 'staged')
    .slice().sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  for (const instance of selected) {
    const projected = projectInstancePhysicalSource(instance);
    const definition = projectCasePhysicalSource(definitions.get(instance?.caseId));
    if (!projected.valid || !definition.valid || ids.has(instance.id) || duplicateCases.has(instance.caseId)) return null;
    ids.add(instance.id);
    const { visibility: _visibility, ...physical } = projected.value;
    inputInstances.push(physical);
    inputCases.set(instance.caseId, definition.value);
  }
  return inputKey({ context: { scope: 'loaded-pack' }, compatibility: policy, targetSpace: target.value,
    instances: inputInstances, cases: [...inputCases.values()].sort((a, b) => a.id.localeCompare(b.id)) });
}

function freezeAssessment(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeAssessment);
    Object.freeze(value);
  }
  return value;
}

/** Derived assessment of Pack source. Never accepts scene or preview state. */
export function assessCommittedPack(pack, cases, { compatibility = COMPATIBILITY } = {}) {
  const key = projectedKey(pack, cases, compatibility);
  if (key !== null && assessments.has(key)) {
    const cached = assessments.get(key);
    assessments.delete(key);
    assessments.set(key, cached);
    return cached;
  }
  const assessment = assessPhysicalSubject({
    cases,
    instances: pack.cases,
    targetSpace: pack.truck,
    context: { scope: 'loaded-pack' },
    compatibility,
  });
  const result = freezeAssessment({
    ...assessment,
    unresolvedHard: assessment.hard.filter(finding => finding.outcome === 'UNRESOLVED'),
    // Reuse is exact for current source; nothing is persisted into a Pack.
    fresh: true,
  });
  if (key !== null && assessment.identity !== null && key === inputKey(assessment.input)) {
    assessments.set(key, result);
    if (assessments.size > CACHE_LIMIT) assessments.delete(assessments.keys().next().value);
  }
  return result;
}
