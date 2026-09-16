// Handling Rules P0-A: Case-rule propagation / validation state.
//
// A Case is a shared definition; packed Load Plan instances reference it by
// caseId. Editing a placement-affecting Handling Rule can make an
// already-packed Load Plan illegal. This file behaviorally proves:
//   - only the actively-displayed Editor Pack (currentScreen === 'editor' AND
//     pack.id === currentPackId) may be automatically revalidated/repaired/
//     staged as part of a Case Save;
//   - every other affected Pack is left untouched except for a durable,
//     semantic "handlingRulesValidatedSignature" that makes it report
//     Validation required without moving any cargo;
//   - the whole Case Save (Case + optional category + any active-Pack
//     revalidation) publishes through exactly one StateStore.set(), so one
//     Undo/Redo always covers the whole logical action.
//
// Deliberately NOT added to security-and-invariants.spec.mjs (scheduled for a
// separate future decomposition project) — see project instructions.
import test from 'node:test';
import assert from 'node:assert/strict';

const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);
const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const caseLibraryPath = new URL('../../src/services/case-library.js', import.meta.url);
const normalizerPath = new URL('../../src/core/normalizer.js', import.meta.url);

const RECT_TRUCK = { length: 120, width: 60, height: 60, shapeMode: 'rect' };

function freshModules() {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  return Promise.all([
    import(stateStorePath.href),
    import(`${packLibraryPath.href}${stamp}`),
    import(`${caseLibraryPath.href}${stamp}`),
  ]).then(([StateStore, PackLibrary, CaseLibrary]) => ({ StateStore, PackLibrary, CaseLibrary }));
}

function mkCase(overrides = {}) {
  return {
    id: 'case-a', name: 'A', manufacturer: 'QA', category: 'Default', color: '#9ca3af',
    dimensions: { length: 10, width: 10, height: 10 }, weight: 10, volume: 1000,
    canFlip: true, stackable: true, orientationLock: 'any', noStackOnTop: false,
    maxStackCount: 0, isPallet: false,
    ...overrides,
  };
}

function mkInst(id, caseId, position, placement = 'packed') {
  return {
    id, caseId, placement, hidden: false, groupId: null,
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  };
}

// Base + child directly on top: becomes invalid once the base's Case gets
// noStackOnTop:true. The base covers nearly the full floor so, once the
// support is correctly disqualified, there is no other legal floor spot —
// the outcome (repaired-elsewhere or staged) is geometry-deterministic.
function activePackFixture(caseId = 'case-a') {
  const baseInst = mkInst('base', caseId, { x: 60, y: 5, z: 0 });
  const childInst = mkInst('child', caseId, { x: 60, y: 15, z: 0 });
  return { id: 'pack-active', title: 'Active', truck: RECT_TRUCK, cases: [baseInst, childInst], stats: {} };
}

test('HANDLING-RULES-P0A A: active Editor Pack + hard-rule Case edit publishes Case + repaired/staged Pack atomically', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false });
  const pack = activePackFixture();
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'pack-active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });

  const result = PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null);

  assert.ok(result.packImpact, 'the active pack must be reported as impacted');
  assert.equal(result.packImpact.packId, 'pack-active');
  const after = StateStore.get('packLibrary').find(p => p.id === 'pack-active');
  assert.notEqual(after.cases.find(c => c.id === 'child').placement === 'packed' &&
    after.cases.find(c => c.id === 'child').transform.position.y === 15, true,
    'the child must not remain silently packed directly on the now-disqualified support');
  assert.ok(after.handlingRulesValidatedSignature, 'the active pack must receive a fresh signature');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false,
    'the freshly revalidated active pack must not report Validation required');
});

test('HANDLING-RULES-P0A B/C: one Undo restores old Case + old Pack placement + old validation state; one Redo restores the post-Save state', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false });
  const pack = activePackFixture();
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'pack-active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });
  const beforeCaseLib = StateStore.get('caseLibrary');
  const beforePackLib = StateStore.get('packLibrary');

  PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null);
  const afterCaseLib = StateStore.get('caseLibrary');
  const afterPackLib = StateStore.get('packLibrary');
  assert.notDeepEqual(afterCaseLib, beforeCaseLib);
  assert.notDeepEqual(afterPackLib, beforePackLib);

  assert.equal(StateStore.undo(), true, 'Undo must succeed');
  assert.deepEqual(StateStore.get('caseLibrary'), beforeCaseLib, 'Undo must restore the old Case rule');
  assert.deepEqual(StateStore.get('packLibrary'), beforePackLib, 'Undo must restore the old Pack placement AND validation state together');

  assert.equal(StateStore.redo(), true, 'Redo must succeed');
  assert.deepEqual(StateStore.get('caseLibrary'), afterCaseLib, 'Redo must restore the new Case rule');
  assert.deepEqual(StateStore.get('packLibrary'), afterPackLib, 'Redo must restore the new Pack result AND validation state together');
});

test('HANDLING-RULES-P0A D: Category + Case + active-Pack impact remains one history action', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false, category: 'default' });
  const pack = activePackFixture();
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'pack-active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [],
    preferences: { categories: [{ key: 'default', name: 'Default', color: '#9ca3af' }] },
  });
  const beforeState = {
    caseLibrary: StateStore.get('caseLibrary'),
    packLibrary: StateStore.get('packLibrary'),
    preferences: StateStore.get('preferences'),
  };

  PackLibrary.commitCaseHandlingRuleChange(
    { ...caseA, noStackOnTop: true, category: 'freight' },
    { key: 'freight', name: 'Freight', color: '#3b82f6' }
  );
  const afterState = {
    caseLibrary: StateStore.get('caseLibrary'),
    packLibrary: StateStore.get('packLibrary'),
    preferences: StateStore.get('preferences'),
  };
  assert.notDeepEqual(afterState.preferences, beforeState.preferences, 'category must have actually changed preferences');
  assert.notDeepEqual(afterState.packLibrary, beforeState.packLibrary, 'active pack must have actually been revalidated');

  assert.equal(StateStore.undo(), true);
  assert.deepEqual(StateStore.get('caseLibrary'), beforeState.caseLibrary, 'one Undo restores the old Case');
  assert.deepEqual(StateStore.get('preferences'), beforeState.preferences, 'the SAME Undo restores the old category/preferences');
  assert.deepEqual(StateStore.get('packLibrary'), beforeState.packLibrary, 'the SAME Undo restores the old Pack impact');

  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.get('caseLibrary'), afterState.caseLibrary);
  assert.deepEqual(StateStore.get('preferences'), afterState.preferences);
  assert.deepEqual(StateStore.get('packLibrary'), afterState.packLibrary);
});

test('HANDLING-RULES-P0A E/F: Case hard-rule edit while NOT on Editor does not move the last currentPackId cargo, and marks it Validation required', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false });
  const pack = activePackFixture();
  // currentPackId still points at this pack (as it may after navigating away),
  // but currentScreen is 'packs', not 'editor' — this must be treated as unseen.
  StateStore.init({
    currentScreen: 'packs', currentPackId: 'pack-active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });

  const result = PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null);
  assert.equal(result.packImpact, null, 'a Pack that is not the actively-displayed Editor Pack must never be reported as revalidated');

  const after = StateStore.get('packLibrary').find(p => p.id === 'pack-active');
  assert.deepEqual(after.cases, pack.cases, 'cargo must not move even though currentPackId matches');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), true,
    'the unseen affected Pack must report Validation required');
});

test('HANDLING-RULES-P0A G: an affected Pack with only STAGED instances of the edited Case does not become stale', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false });
  const stagedInst = mkInst('staged1', 'case-a', { x: -50, y: 5, z: 0 }, 'staged');
  const pack = { id: 'pack-staged-only', title: 'StagedOnly', truck: RECT_TRUCK, cases: [stagedInst], stats: {} };
  StateStore.init({
    currentScreen: 'packs', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });

  PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null);
  const after = StateStore.get('packLibrary').find(p => p.id === 'pack-staged-only');
  assert.equal(after.handlingRulesValidatedSignature, undefined,
    'a Pack referencing the edited Case only via staged instances must never be marked affected');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
});

test('HANDLING-RULES-P0A H: an unaffected Pack (different Case) is untouched', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false });
  const caseB = mkCase({ id: 'case-b' });
  const unrelatedInst = mkInst('u1', 'case-b', { x: 20, y: 5, z: 0 });
  const pack = { id: 'pack-unrelated', title: 'Unrelated', truck: RECT_TRUCK, cases: [unrelatedInst], stats: {} };
  StateStore.init({
    currentScreen: 'packs', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [caseA, caseB], packLibrary: [pack], folderLibrary: [], preferences: {},
  });
  const before = StateStore.get('packLibrary').find(p => p.id === 'pack-unrelated');

  PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null);
  const after = StateStore.get('packLibrary').find(p => p.id === 'pack-unrelated');
  assert.deepEqual(after, before, 'a Pack referencing an unrelated Case must be byte-for-byte unchanged');
});

test('HANDLING-RULES-P0A I: a non-placement-affecting Case edit (name only) does not stale any Pack', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', name: 'Old Name' });
  const pack = activePackFixture();
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'pack-active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });
  const result = PackLibrary.commitCaseHandlingRuleChange({ ...caseA, name: 'New Name' }, null);
  assert.equal(result.packImpact, null, 'a name-only edit must never trigger revalidation');
  const after = StateStore.get('packLibrary').find(p => p.id === 'pack-active');
  assert.equal(after.handlingRulesValidatedSignature, undefined, 'no signature must be introduced by a non-placement-affecting edit');
});

test('HANDLING-RULES-P0A J: editing a Case unused by any Pack does not touch packLibrary at all', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a' });
  const caseB = mkCase({ id: 'case-b' });
  const instB = mkInst('ib', 'case-b', { x: 20, y: 5, z: 0 });
  const pack = { id: 'p1', title: 'P', truck: RECT_TRUCK, cases: [instB], stats: {} };
  StateStore.init({
    currentScreen: 'packs', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [caseA, caseB], packLibrary: [pack], folderLibrary: [], preferences: {},
  });
  const before = StateStore.get('packLibrary');
  PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null); // case-a is unused
  assert.deepEqual(StateStore.get('packLibrary'), before, 'packLibrary must be byte-for-byte unchanged when the edited Case is unused');
});

test('HANDLING-RULES-P0A K: new Case creation does not stale any Pack', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  StateStore.init({
    currentScreen: 'packs', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {},
  });
  const brandNew = mkCase({ id: 'case-new', orientationLock: 'upright' });
  const result = PackLibrary.commitCaseHandlingRuleChange(brandNew, null);
  assert.equal(result.packImpact, null, 'creating a Case has no existing "before" state to have invalidated anything');
  assert.ok(StateStore.get('caseLibrary').some(c => c.id === 'case-new'), 'the new Case must still be saved');
});

test('HANDLING-RULES-P0A L: multiple affected Packs — only the actively-displayed Editor Pack is revalidated; others remain unmoved and stale', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false });
  const mk = packId => ({ ...activePackFixture('case-a'), id: packId, title: packId });
  const packActive = mk('active');
  const packOther1 = mk('other1');
  const packOther2 = mk('other2');
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [packActive, packOther1, packOther2], folderLibrary: [], preferences: {},
  });

  PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null);
  const libs = StateStore.get('packLibrary');
  const active = libs.find(p => p.id === 'active');
  const other1 = libs.find(p => p.id === 'other1');
  const other2 = libs.find(p => p.id === 'other2');

  assert.ok(active.handlingRulesValidatedSignature, 'active pack must be revalidated with a fresh signature');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(active, StateStore.get('caseLibrary')), false);
  assert.deepEqual(other1.cases, packOther1.cases, 'other1 cargo must not move');
  assert.deepEqual(other2.cases, packOther2.cases, 'other2 cargo must not move');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(other1, StateStore.get('caseLibrary')), true);
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(other2, StateStore.get('caseLibrary')), true);
});

test('HANDLING-RULES-P0A M: a legacy Pack with a missing signature is not stale before any edit; the first relevant Case edit baselines it and the new rule makes it stale', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false });
  const inst = mkInst('i1', 'case-a', { x: 20, y: 5, z: 0 });
  const legacyPack = { id: 'legacy', title: 'Legacy', truck: RECT_TRUCK, cases: [inst], stats: {} }; // no signature field at all
  StateStore.init({
    currentScreen: 'packs', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [legacyPack], folderLibrary: [], preferences: {},
  });

  assert.equal(
    PackLibrary.isHandlingRulesValidationRequired(legacyPack, [caseA]),
    false,
    'a legacy Pack with no stored signature must never be rendered stale merely because the feature landed'
  );

  PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true }, null);
  const after = StateStore.get('packLibrary').find(p => p.id === 'legacy');
  assert.ok(after.handlingRulesValidatedSignature, 'the first relevant edit must baseline a pre-change signature');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), true,
    'once baselined, the new rule must make it report Validation required');
});

test('HANDLING-RULES-P0A N: a successful explicit Validate Load Plan revalidates, updates cargo as needed, and clears stale status', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: true }); // already strict
  const pack = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:STALE' };
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'pack-active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });

  const result = PackLibrary.validateLoadPlan('pack-active');
  assert.ok(result, 'validateLoadPlan must succeed');
  const after = PackLibrary.getById('pack-active');
  assert.notEqual(after.handlingRulesValidatedSignature, 'v1:STALE', 'a fresh signature must replace the stale one');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
});

test('HANDLING-RULES-P0A O: source guard — signature stamping is gated on zero unresolved failedIds in both the central revalidation path and the Case-Save orchestration', async () => {
  // A genuine end-to-end failedIds reproduction is not constructible: any
  // instance degenerate enough to fail stagePlacementIds' own dimension check
  // has already been excluded upstream by reconcilePlacementsForTruck's
  // identical check before ever becoming "invalid" (both read the same Case
  // dimensions from the same caseLibrary). This proves the CONTRACT directly
  // at the source level instead — the same technique this suite already uses
  // when full black-box construction of a rare defensive branch isn't
  // practical — while A/B/C/L/N above already prove the SUCCESS path
  // end-to-end against the real functions.
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../../src/services/pack-library.js', import.meta.url), 'utf8');

  const updateStart = src.indexOf('export function updateCasesWithManualRevalidation(');
  const updateEnd = src.indexOf('\n// Smallest possible', updateStart);
  const updateBlock = src.slice(updateStart, updateEnd);
  assert.match(updateBlock, /const hasFailures = Array\.isArray\(result\.failedIds\) && result\.failedIds\.length > 0;/,
    'updateCasesWithManualRevalidation must check for unresolved failures');
  assert.match(updateBlock, /if \(!hasFailures\) \{\s*patch\.handlingRulesValidatedSignature =/,
    'updateCasesWithManualRevalidation must only stamp a fresh signature when there are no unresolved failures');

  const commitStart = src.indexOf('export function commitCaseHandlingRuleChange(');
  const commitEnd = src.indexOf('\nexport function revalidateManualPlacements(', commitStart);
  const commitBlock = src.slice(commitStart, commitEnd);
  assert.match(commitBlock, /const hasFailures = Array\.isArray\(result\.failedIds\) && result\.failedIds\.length > 0;/,
    'commitCaseHandlingRuleChange must check for unresolved failures on the active Pack too');
  assert.match(commitBlock, /if \(!hasFailures\) \{\s*revalidated\.handlingRulesValidatedSignature =\s*buildHandlingRulesValiditySignature\(revalidated, nextCaseLibrary\);\s*\} else if \(!p\.handlingRulesValidatedSignature\) \{/,
    'a fresh signature must only be computed from the post-repair pack when there are no unresolved failures; otherwise fall back to baselining the pre-change signature');
});

test('HANDLING-RULES-P0A P: updateCasesWithManualRevalidation stamps a fresh signature only after a complete, successful whole-Pack revalidation', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: true });
  const pack = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:OLD' };
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'pack-active', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });

  const result = PackLibrary.updateCasesWithManualRevalidation('pack-active', pack.cases, [caseA], {
    repairDependents: true,
    preserveStagedPositions: true,
  });
  assert.ok(result, 'revalidation must succeed');
  assert.equal(Array.isArray(result.failedIds) && result.failedIds.length, 0, 'this fixture has no unresolved failures');
  const after = PackLibrary.getById('pack-active');
  assert.notEqual(after.handlingRulesValidatedSignature, 'v1:OLD', 'a complete successful revalidation must stamp a fresh signature');
  assert.equal(after.handlingRulesValidatedSignature,
    PackLibrary.buildHandlingRulesValiditySignature(after, [caseA]),
    'the stamped signature must match what buildHandlingRulesValiditySignature computes for the resulting Pack');
});

test('HANDLING-RULES-P0A Q: PackLibrary.update() persists cases and a caller-supplied handlingRulesValidatedSignature together in one write (the AutoPack Apply mechanism)', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a' });
  const inst = mkInst('i1', 'case-a', { x: 20, y: 5, z: 0 });
  const pack = { id: 'p1', title: 'P', truck: RECT_TRUCK, cases: [], stats: {} };
  StateStore.init({
    currentScreen: 'editor', currentPackId: 'p1', selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {},
  });

  const appliedCases = [inst];
  const signature = PackLibrary.buildHandlingRulesValiditySignature({ ...pack, cases: appliedCases }, [caseA]);
  const updated = PackLibrary.update('p1', { cases: appliedCases, handlingRulesValidatedSignature: signature });

  assert.ok(updated, 'update must succeed');
  assert.deepEqual(updated.cases, appliedCases);
  assert.equal(updated.handlingRulesValidatedSignature, signature, 'the signature must be persisted in the SAME write as the applied cases');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(updated, [caseA]), false);
});

test('HANDLING-RULES-P0A R: normalizePack preserves handlingRulesValidatedSignature (typed passthrough, legacy-safe)', async () => {
  const { normalizePack } = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const withSignature = normalizePack({
    id: 'p1', title: 'P', truck: RECT_TRUCK, cases: [],
    handlingRulesValidatedSignature: 'v1:case-a:any:1:0:0',
  });
  assert.equal(withSignature.handlingRulesValidatedSignature, 'v1:case-a:any:1:0:0');

  const legacyNoSignature = normalizePack({ id: 'p2', title: 'P2', truck: RECT_TRUCK, cases: [] });
  assert.equal(legacyNoSignature.handlingRulesValidatedSignature, null, 'a missing signature must normalize to null, not undefined or a stale default');

  const malformedSignature = normalizePack({ id: 'p3', title: 'P3', truck: RECT_TRUCK, cases: [], handlingRulesValidatedSignature: 12345 });
  assert.equal(malformedSignature.handlingRulesValidatedSignature, null, 'a non-string stored value must not be trusted as a valid signature');
});

test('HANDLING-RULES-P0A S: the Pack signature is deterministic regardless of Case Library or instance ordering', async () => {
  const { PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a' });
  const caseB = mkCase({ id: 'case-b', noStackOnTop: true });
  const i1 = mkInst('i1', 'case-a', { x: 10, y: 5, z: 0 });
  const i2 = mkInst('i2', 'case-b', { x: 30, y: 5, z: 0 });
  const packOrderA = { id: 'p1', truck: RECT_TRUCK, cases: [i1, i2] };
  const packOrderB = { id: 'p1', truck: RECT_TRUCK, cases: [i2, i1] };

  const sigA = PackLibrary.buildHandlingRulesValiditySignature(packOrderA, [caseA, caseB]);
  const sigB = PackLibrary.buildHandlingRulesValiditySignature(packOrderB, [caseB, caseA]);
  assert.equal(sigA, sigB, 'signature must not depend on instance or Case Library array ordering');
});

test('HANDLING-RULES-P0A T: raw stackable/noStackOnTop alias changes with identical effective semantics do not create false staleness', async () => {
  const { PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a', noStackOnTop: false, stackable: true });

  // Same effective "stacking allowed" meaning, different raw representation / unrelated field.
  const aliasEquivalent = { ...caseA, noStackOnTop: false, stackable: true, name: 'renamed, same semantics' };
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(caseA, aliasEquivalent), false,
    'identical effective allow-stack-on-top semantics must not register as a placement-affecting change');

  // A genuine alias-driven semantic change (legacy stackable:false blocks stacking).
  const trueAliasChange = { ...caseA, stackable: false };
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(caseA, trueAliasChange), true,
    'a legacy alias that actually changes the effective allow-stack-on-top meaning must register as a change');
});
