import { assessPhysicalSubject } from '../packing-core/assessment.js';

// The committed-load compatibility policy is independent of physical truth.
const COMPATIBILITY = Object.freeze({ support50: true, wheelWellThird: true, supportWeight: true });

/** Pure, fresh assessment of Pack source. Never accepts scene or preview state. */
export function assessCommittedPack(pack, cases, { compatibility = COMPATIBILITY } = {}) {
  const assessment = assessPhysicalSubject({
    cases,
    instances: pack.cases,
    targetSpace: pack.truck,
    context: { scope: 'loaded-pack' },
    compatibility,
  });
  return {
    ...assessment,
    unresolvedHard: assessment.hard.filter(finding => finding.outcome === 'UNRESOLVED'),
    // No cache or persisted certificate: each call consumes current source.
    fresh: true,
  };
}
