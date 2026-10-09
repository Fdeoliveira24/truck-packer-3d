/**
 * C2 derived physical assessment. Explicit inputs only; no mutation, repair,
 * persistence, solver execution or live workflow integration. Existing space
 * construction is called only with successful C1 target-source interpretation.
 */
import { projectCasePhysicalSource, projectInstancePhysicalSource, projectTargetSpaceSource } from './domain.js';
import { isCanonicalCaseMass, parseCaseMass } from '../core/cargo-canonical.js';
import { parseCaseOrientationLock, isCasePhysicalOrientationAllowed } from '../core/orientation.js';
import { getActualPoseDimensions, getPhysicalOrientationAxes } from '../core/oriented-dims.js';
import { buildSpaceModel } from './space-model.js';
import {
  aabbsOverlap, isAabbContainedInZone, MEASUREMENT_EPS, MIN_SUPPORT_FRACTION,
  measureSupportContacts, supportHullMargin, contactPatchCorners, solveContactReactions,
} from './validation.js';
import { MAX_WHEELWELL_OVERHANG_FRACTION } from './wheel-well-model.js';
import { measureRearBlocking } from './retention-model.js';

// Independent road-direction references, never combined or treated as HARD.
export const ROAD_PLANNING_REFERENCE_G = Object.freeze({ forward: 0.8, rear: 0.5, left: 0.5, right: 0.5 });
const PASS = 'PASS', FAIL = 'FAIL', UNRESOLVED = 'UNRESOLVED', NA = 'NOT_APPLICABLE';
const gateNames = ['support50', 'wheelWellThird', 'supportWeight'];

/** INVALID retains every unresolved item; limitations/advisories are separate. */
export function aggregatePhysicalAssessment(hard) {
  return hard.some(f => f.outcome === FAIL) ? 'INVALID'
    : hard.some(f => f.outcome === UNRESOLVED) ? 'INCOMPLETE' : 'VALID';
}

/** Eligibility is only the temporary-gate dimension, not primary assessment. */
export function assessOperationalEligibility(gates) {
  const blockedBy = gates.filter(g => g.active && (g.outcome === FAIL || g.outcome === UNRESOLVED));
  return { state: blockedBy.length ? 'blocked' : 'eligible', blockedBy };
}

/** Directed positive-contact graph. Cycles cannot establish a rigid path. */
export function assessSupportPaths(nodes, edges, unknownGeometry = false) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const paths = new Map();
  const visiting = [];
  const cycleIds = new Set();
  const visit = id => {
    if (paths.has(id)) return paths.get(id);
    if (visiting.includes(id)) {
      visiting.slice(visiting.indexOf(id)).forEach(key => cycleIds.add(key));
      return FAIL;
    }
    const node = byId.get(id);
    if (!node) return UNRESOLVED;
    if (node.rigid) return PASS;
    visiting.push(id);
    const next = edges.filter(e => e.from === id && e.area > 0).map(e => visit(e.to));
    visiting.pop();
    const outcome = cycleIds.has(id) || node.supportOutcome === FAIL ? FAIL
      : node.supportOutcome === UNRESOLVED ? UNRESOLVED
        : next.includes(PASS) ? PASS : unknownGeometry || next.includes(UNRESOLVED) ? UNRESOLVED : FAIL;
    paths.set(id, outcome);
    return outcome;
  };
  nodes.forEach(n => visit(n.id));
  return { paths: nodes.map(n => ({ id: n.id, outcome: n.rigid ? PASS : paths.get(n.id) })),
    cycles: [...cycleIds].sort() };
}

const range = value => ({ min: value, max: value });
const addRange = (a, b) => ({ min: a.min + b.min, max: a.max + b.max });
const fixedWrench = (force, point) => ({ force: range(force), momentX: range(force * point.x), momentZ: range(force * point.z) });
const determinedRange = b => b.max - b.min <= MEASUREMENT_EPS * Math.max(1, Math.abs(b.min), Math.abs(b.max));
const finiteBounds = bounds => bounds && ['force', 'momentX', 'momentZ'].every(key =>
  bounds[key] && Number.isFinite(bounds[key].min) && Number.isFinite(bounds[key].max) && bounds[key].min <= bounds[key].max);

/**
 * Conservative interval proof of loaded-resultant position. Correlation loss
 * can yield UNRESOLVED, never a fabricated pass/failure. A half-plane linear
 * functional must be positive for every admissible wrench to prove PASS.
 */
export function assessResultantBounds(hull, bounds) {
  if (!finiteBounds(bounds) || bounds.force.min <= 0) return { outcome: UNRESOLVED, reason: 'unknown-mass-or-reaction' };
  if (hull.length < 3) return { outcome: FAIL, reason: 'degenerate-support-hull' };
  const margins = hull.map((a, i) => {
    const b = hull[(i + 1) % hull.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    const c = -(nx * a.x + nz * a.z) - MEASUREMENT_EPS;
    let min = 0, max = 0;
    for (const [coefficient, interval] of [[nx, bounds.momentX], [nz, bounds.momentZ], [c, bounds.force]]) {
      min += coefficient * (coefficient >= 0 ? interval.min : interval.max);
      max += coefficient * (coefficient >= 0 ? interval.max : interval.min);
    }
    return { min, max };
  });
  return { outcome: margins.every(m => m.min > 0) ? PASS : margins.some(m => m.max <= 0) ? FAIL : UNRESOLVED,
    reason: 'admissible-wrench-bounds', margins };
}

function aabbAt(position, dims) {
  return { min: { x: position.x - dims.length / 2, y: position.y - dims.height / 2, z: position.z - dims.width / 2 },
    max: { x: position.x + dims.length / 2, y: position.y + dims.height / 2, z: position.z + dims.width / 2 } };
}

const usableAabb = box => box && ['x', 'y', 'z'].every(key =>
  Number.isFinite(box.min[key]) && Number.isFinite(box.max[key]) && box.max[key] > box.min[key]);

function cargoSurface(body) {
  return { supportId: body.id, y: body.aabb.max.y,
    minX: body.aabb.min.x, maxX: body.aabb.max.x, minZ: body.aabb.min.z, maxZ: body.aabb.max.z };
}

const finding = (property, subject, outcome, evidence = {}) => ({ property, subject, outcome, evidence });

/**
 * Assess a supplied final loaded-Pack subject. Staged records are preserved by
 * the caller and never assessed as cargo. A malformed population/reference is
 * unresolved, not empty space. Unsupported scopes/policy types are API errors.
 * All loaded geometry remains a rectangular envelope, including round Cases.
 *
 * The only supported scope is the supplied loaded-pack population. Candidate
 * and proposal callers can later supply their complete hypothetical population;
 * this function neither chooses that population nor adopts it. Compatibility
 * flags support50/wheelWellThird/supportWeight default to today's active policy.
 *
 * HARD uses PASS/FAIL/UNRESOLVED. UNVERIFIED and ADVISORY collections and the
 * active compatibility gates are independent of primary. Identity is a runtime
 * consumed-source projection, null on uninterpretable source; never persist it.
 * Distances/areas are in/in2; weights are lb. Vertical statics uses gravity-
 * equivalent lb loads and horizontal first moments F*x and F*z in lb-in.
 * Reaction intervals deliberately overapproximate correlations, so a dependent
 * check may stay UNRESOLVED even when a more complete statics model could pass.
 */
export function assessPhysicalSubject({ cases, instances, targetSpace,
  context = { scope: 'loaded-pack' }, compatibility = {} }) {
  if (!Array.isArray(cases) || !Array.isArray(instances) || context?.scope !== 'loaded-pack' || !compatibility) {
    throw new TypeError('C2 requires explicit Case/instance arrays and loaded-pack scope.');
  }
  const policy = {};
  for (const key of gateNames) {
    const active = compatibility[key] === undefined ? true : compatibility[key];
    if (typeof active !== 'boolean') throw new TypeError(`Invalid C2 compatibility policy: ${key}`);
    policy[key] = active;
  }
  const hard = [], unverified = [], advisory = [], gates = [];
  const add = (property, subject, outcome, evidence = {}) => hard.push(finding(property, subject, outcome, evidence));
  const limit = (property, subject, evidence = {}) => unverified.push(finding(property, subject, 'UNVERIFIED', evidence));
  const advise = (property, subject, evidence = {}) => advisory.push(finding(property, subject, 'ADVISORY', evidence));
  const gate = (property, subject, outcome, evidence = {}) => gates.push({ ...finding(property, subject,
    policy[property] ? outcome : NA, evidence), active: policy[property] });
  const target = projectTargetSpaceSource(targetSpace);
  const model = target.valid ? buildSpaceModel(target.value) : null;
  const space = model && usableAabb(model.bounds) && model.blocked.every(usableAabb) ? model : null;
  add('source.target-space', 'subject', space ? PASS : UNRESOLVED,
    space ? {} : { field: target.field || 'derived-geometry' });
  const caseMap = new Map(), duplicateCases = new Set();
  cases.forEach(c => {
    if (caseMap.has(c?.id)) duplicateCases.add(c?.id);
    caseMap.set(c?.id, c);
  });
  const selected = instances.filter(i => i?.placement !== 'staged')
    .slice().sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  const duplicateInstances = new Set(selected.filter((i, n) => selected.findIndex(j => j?.id === i?.id) !== n).map(i => i?.id));
  const inputCases = new Map(), inputInstances = [];
  const bodies = [];
  let sourceComplete = Boolean(space), missingGeometry = false;
  for (const instance of selected) {
    const id = instance?.id;
    const projected = projectInstancePhysicalSource(instance);
    if (instance?.placement !== 'packed' || typeof id !== 'string' || !id.trim() || duplicateInstances.has(id)) {
      add('source.instance', id ?? 'unknown', UNRESOLVED, { reason: 'unresolved-membership-or-identity' });
      sourceComplete = false; missingGeometry = true;
      continue;
    }
    const c = duplicateCases.has(instance.caseId) ? null : caseMap.get(instance.caseId);
    const definition = projectCasePhysicalSource(c);
    const mass = c && isCanonicalCaseMass(c.weight) ? parseCaseMass(c.weight) : { value: undefined, valid: false };
    const orientation = parseCaseOrientationLock(c?.orientationLock);
    const axes = getPhysicalOrientationAxes(instance.transform?.rotation);
    const dimensions = getActualPoseDimensions(c, instance);
    const pos = instance.transform?.position;
    const aabb = dimensions.valid && axes.valid && pos &&
      ['x', 'y', 'z'].every(key => typeof pos[key] === 'number' && Number.isFinite(pos[key])) &&
      !definition.field?.startsWith('dimensions.') ? aabbAt(pos, dimensions.value) : null;
    const geometryResolved = Boolean(usableAabb(aabb));
    if (!projected.valid || !definition.valid) sourceComplete = false;
    if (!definition.valid) add('source.case', id, UNRESOLVED, { caseId: instance.caseId, field: definition.field });
    if (!projected.valid) add('source.instance', id, UNRESOLVED, { field: projected.field });
    if (definition.valid) inputCases.set(instance.caseId, definition.value);
    if (projected.valid) {
      // Visibility is not consumed by physical assessment or its reuse identity.
      const { visibility: _visibility, ...physical } = projected.value;
      inputInstances.push(physical);
    }
    add('geometry.source', id, geometryResolved ? PASS : UNRESOLVED);
    if (!geometryResolved) { missingGeometry = true; sourceComplete = false; }
    if (axes.valid && orientation.valid) {
      add('orientation.permission', id, isCasePhysicalOrientationAllowed(c, instance.transform.rotation) ? PASS : FAIL);
    } else {
      add('orientation.permission', id, UNRESOLVED);
    }
    const body = { id, caseId: instance.caseId, rules: definition.valid ? definition.value : null,
      noTop: c?.noStackOnTop === true || c?.stackable === false,
      mass: { complete: mass.valid && mass.value !== null, value: mass.valid ? mass.value : null, valid: mass.valid },
      aabb: geometryResolved ? aabb : null,
      ownResultant: geometryResolved ? { x: pos.x, y: pos.y, z: pos.z, assumption: 'centered-envelope' } : null };
    bodies.push(body);
    limit('actual-center-of-mass', id, { assumption: 'centered-envelope' });
    limit('transport-securement', id);
    if (c?.shape === 'cylinder' || c?.shape === 'drum') {
      limit('round-cargo-contact-and-restraint', id,
        { modeledEnvelope: 'rectangular', properties: ['rolling', 'chocking-cradle', 'real-contact', 'axis-restraint'] });
    }
  }
  const geometry = bodies.filter(b => b.aabb);
  const blockedBodies = new Set();
  for (const body of geometry) {
    const contained = space && isAabbContainedInZone(body.aabb, space.bounds) &&
      !space.blocked.some(block => aabbsOverlap(body.aabb, block));
    add('containment', body.id, !space ? UNRESOLVED : contained ? PASS : FAIL);
    if (!contained) blockedBodies.add(body.id);
  }
  for (let i = 0; i < geometry.length; i++) {
    for (let j = i + 1; j < geometry.length; j++) {
      if (aabbsOverlap(geometry[i].aabb, geometry[j].aabb)) {
        add('collision', [geometry[i].id, geometry[j].id], FAIL);
        blockedBodies.add(geometry[i].id); blockedBodies.add(geometry[j].id);
      }
    }
  }
  add('collision.completeness', 'subject', missingGeometry ? UNRESOLVED : PASS);
  // Keep rigid graph IDs disjoint from arbitrary source instance IDs.
  let rigidPrefix = 'rigid:';
  const prefixUsed = prefix => bodies.some(b => b.id.startsWith(prefix));
  while (prefixUsed(rigidPrefix)) rigidPrefix = `_${rigidPrefix}`;
  const rigid = (space?.surfaces || []).map(s => ({ ...s, supportId: `${rigidPrefix}${s.y}` }));
  const rigidIds = new Set(rigid.map(s => s.supportId));
  const edges = [];
  const measurements = new Map();
  // Strictly downward edges and bottom-up qualification prevent a floating
  // body's top from manufacturing support for another body.
  for (const body of [...geometry].sort((a, b) => a.aabb.min.y - b.aabb.min.y || a.id.localeCompare(b.id))) {
    const below = geometry.filter(other => other.id !== body.id && other.ownResultant.y < body.ownResultant.y);
    const raw = measureSupportContacts(body.aabb, [...rigid, ...below.map(cargoSurface)]);
    const qualifiedIds = new Set(below.filter(b => measurements.get(b.id)?.pathOutcome === PASS && !blockedBodies.has(b.id)).map(b => b.id));
    const support = measureSupportContacts(body.aabb, [...rigid, ...below.filter(b => qualifiedIds.has(b.id)).map(cargoSurface)]);
    const uncertainSupport = missingGeometry || !space || raw.patches.some(p =>
      !rigidIds.has(p.supportId) && measurements.get(p.supportId)?.pathOutcome === UNRESOLVED);
    const own = supportHullMargin(support.hull, body.ownResultant);
    const ownOutcome = own.inside ? PASS : uncertainSupport ? UNRESOLVED : FAIL;
    add('support.own-centered-hull', body.id, ownOutcome, { ...own, assumption: 'centered-envelope', units: 'in' });
    const pathOutcome = blockedBodies.has(body.id) ? (space ? FAIL : UNRESOLVED) : ownOutcome;
    add('support.path', body.id, pathOutcome);
    raw.patches.forEach(p => edges.push({ from: body.id, to: p.supportId,
      area: (p.maxX - p.minX) * (p.maxZ - p.minZ), bearingPlane: p.y, patch: p }));
    measurements.set(body.id, { id: body.id, support, own, pathOutcome, uncertainSupport, rawContacts: raw.patches });
    advise('support.coverage', body.id, { fraction: support.coverage, area: support.area, units: 'in2' });
    if (support.coverage < 1 - MEASUREMENT_EPS) {
      limit('bridge-cantilever-strength', body.id);
      advise('support.extension', body.id, { extension: support.extension, fraction: support.extensionFraction, units: 'in' });
    }
    gate('support50', body.id, support.coverage + MEASUREMENT_EPS >= MIN_SUPPORT_FRACTION ? PASS
      : uncertainSupport ? UNRESOLVED : FAIL, { fraction: support.coverage, threshold: MIN_SUPPORT_FRACTION });
    const extensionOutcome = support.extensionFraction === null ? (uncertainSupport ? UNRESOLVED : FAIL)
      : support.extensionFraction <= MAX_WHEELWELL_OVERHANG_FRACTION + MEASUREMENT_EPS ? PASS
        : uncertainSupport ? UNRESOLVED : FAIL;
    gate('wheelWellThird', body.id, !space ? UNRESOLVED : space.wheelWell ? extensionOutcome : NA,
      { fraction: support.extensionFraction, threshold: MAX_WHEELWELL_OVERHANG_FRACTION });
  }
  const nodes = [...bodies.map(b => ({ id: b.id, rigid: false,
    supportOutcome: measurements.get(b.id)?.pathOutcome || UNRESOLVED })),
  ...[...rigidIds].map(id => ({ id, rigid: true }))];
  const paths = assessSupportPaths(nodes, edges, missingGeometry);
  if (paths.cycles.length) add('support.cycle', paths.cycles, FAIL);
  for (const support of bodies) {
    const children = [...new Set(edges.filter(e => e.to === support.id).map(e => e.from))];
    if (children.length) {
      add('handling.no-top', support.id, support.noTop ? FAIL : support.rules ? PASS : UNRESOLVED, { children });
      const cap = support.rules?.maxStackCount;
      add('handling.direct-child-count', support.id, cap === undefined ? UNRESOLVED : cap > 0 && children.length > cap ? FAIL : PASS,
        { children, directCount: children.length, limit: cap ?? null });
      limit('structural-top-load-capacity', support.id, { reason: 'no-trusted-ordinary-case-rating' });
    }
    for (const id of children) {
      const child = bodies.find(b => b.id === id);
      gate('supportWeight', [id, support.id], support.rules?.isPallet ? NA
        : !child.mass.complete || !support.mass.complete ? UNRESOLVED
          : child.mass.value <= support.mass.value ? PASS : FAIL,
      { childOwnWeight: child.mass.value, supportOwnWeight: support.mass.value, units: 'lb' });
    }
  }
  // Unknown geometry can hide immediate support relationships: no silent gate pass.
  if (missingGeometry) {
    gateNames.forEach(name => gate(name, 'unresolved-population', UNRESOLVED));
  }
  const transfers = new Map();
  for (const body of [...geometry].sort((a, b) => b.ownResultant.y - a.ownResultant.y || a.id.localeCompare(b.id))) {
    const measured = measurements.get(body.id);
    const incoming = [...new Set(edges.filter(e => e.to === body.id).map(e => e.from))].map(id =>
      transfers.get(id)?.reactions.find(r => r.supportId === body.id) || null);
    const complete = body.mass.complete && !missingGeometry && incoming.every(r => r?.bounds);
    let bounds = complete ? fixedWrench(body.mass.value, body.ownResultant) : null;
    if (bounds) {
      incoming.forEach(r => {
        for (const key of ['force', 'momentX', 'momentZ']) bounds[key] = addRange(bounds[key], r.bounds[key]);
      });
    }
    if (!finiteBounds(bounds)) bounds = null;
    const determined = bounds && Object.values(bounds).every(determinedRange);
    const total = determined ? bounds.force.min : null;
    const resultant = determined ? { x: bounds.momentX.min / total, z: bounds.momentZ.min / total } : null;
    const loaded = measured.uncertainSupport ? { outcome: UNRESOLVED, reason: 'unresolved-support-population' }
      : assessResultantBounds(measured.support.hull, bounds);
    add('support.loaded-resultant', body.id, loaded.outcome, { ...loaded, resultant, bounds, units: { force: 'lb', moment: 'lb-in' } });
    const points = measured.support.patches.flatMap(p => contactPatchCorners(p).map(point => ({ ...point, supportId: p.supportId })));
    let reaction = determined && !measured.uncertainSupport ? solveContactReactions(total, resultant, points)
      : { outcome: UNRESOLVED, reason: 'unresolved-demand', reactions: [] };
    // With exactly one receiving body/boundary, its outgoing wrench equals the
    // full incoming wrench even when that wrench is bounded rather than unique.
    const recipients = [...new Set(points.map(p => p.supportId))];
    if (!determined && bounds && recipients.length === 1 && loaded.outcome === PASS) {
      reaction = { outcome: PASS, reason: 'single-recipient-wrench-conservation', reactions: [
        { supportId: recipients[0], bounds, determined: false, force: null, momentX: null, momentZ: null },
      ] };
    }
    // Nonunique statics alone is not a HARD failure. Dependent loaded-resultant
    // checks use bounds; only lack of a provable equilibrium is unresolved.
    add('load.equilibrium', body.id, reaction.outcome, { reason: reaction.reason || 'nonnegative-force-and-moment-balance',
      determined: reaction.determined ?? false });
    transfers.set(body.id, reaction);
    const payload = incoming.every(r => r?.bounds && determinedRange(r.bounds.force)) && !missingGeometry
      ? incoming.reduce((sum, r) => sum + r.bounds.force.min, 0) : null;
    Object.assign(measured, { mass: body.mass, load: { massComplete: complete,
      demand: total, demandBounds: bounds, resultant, payload, reactions: reaction.reactions, equilibrium: reaction.outcome },
    loadedOutcome: loaded.outcome });
    if (body.rules?.isPallet) {
      advise('pallet.payload', body.id, { payload, tare: body.mass.value, transmitted: total, units: 'lb' });
      if (body.rules.maxPalletWeight > 0 && payload !== null && payload > body.rules.maxPalletWeight) {
        advise('pallet.payload-threshold', body.id, { payload, threshold: body.rules.maxPalletWeight, units: 'lb' });
      }
    }
  }
  for (const body of geometry) {
    const blockers = geometry.filter(b => b.id !== body.id).map(b => {
      const m = measurements.get(b.id);
      return { id: b.id, aabb: b.aabb, qualification: blockedBodies.has(b.id) || m.pathOutcome === FAIL || m.loadedOutcome === FAIL ? FAIL
        : m.pathOutcome === PASS && m.loadedOutcome === PASS ? PASS : UNRESOLVED };
    });
    const blocking = space ? measureRearBlocking(body.aabb, blockers, space.retention) : { applicable: true, outcome: UNRESOLVED };
    if (blocking.applicable) {
      if (blocking.outcome === FAIL && missingGeometry) blocking.outcome = UNRESOLVED;
      add('front-overhang.rear-blocking', body.id, blocking.outcome, blocking);
      if (blocking.outcome === PASS) {
        limit('front-overhang-structural-restraint', body.id,
          { geometryEstablished: true, properties: ['strength', 'anchorage', 'impact-capacity'] });
      }
    }
  }
  const knownSubtotal = bodies.reduce((sum, b) => sum + (b.mass.complete ? b.mass.value : 0), 0);
  const massComplete = bodies.length === selected.length && bodies.every(b => b.mass.complete);
  const totalWeight = massComplete ? knownSubtotal : null;
  const cogComplete = massComplete && !missingGeometry && totalWeight > 0;
  const cog = cogComplete ? {
    x: bodies.reduce((s, b) => s + b.mass.value * b.ownResultant.x, 0) / totalWeight,
    y: bodies.reduce((s, b) => s + b.mass.value * b.ownResultant.y, 0) / totalWeight,
    z: bodies.reduce((s, b) => s + b.mass.value * b.ownResultant.z, 0) / totalWeight,
  } : null;
  const input = { version: 'C2-1', context: { scope: context.scope }, compatibility: policy,
    cases: [...inputCases.values()].sort((a, b) => a.id.localeCompare(b.id)),
    instances: inputInstances, targetSpace: target.valid ? target.value : null };
  return { primary: aggregatePhysicalAssessment(hard), hard, unverified, advisory, gates,
    eligibility: assessOperationalEligibility(gates), input, identity: sourceComplete ? JSON.stringify(input) : null,
    measurements: { bodies: [...measurements.values()].sort((a, b) => a.id.localeCompare(b.id)),
      supportGraph: { nodes, edges, ...paths },
      mass: { complete: massComplete, knownSubtotal, total: totalWeight, units: 'lb' },
      cog: { value: cog, complete: cogComplete, assumption: 'centered-envelope', units: 'in' } } };
}
