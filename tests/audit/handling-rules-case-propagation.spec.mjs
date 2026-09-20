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
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildOrganizedUnpackStagingCases } from '../../src/screens/editor-screen.js';
import { createTruckChangeController } from '../../src/ui/truck-change-controller.js';

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
  return { id: 'pack-active', title: 'Active', truck: RECT_TRUCK, cases: [baseInst, childInst], lastEdited: 123, stats: {} };
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
  assert.equal(after.lastEdited, pack.lastEdited, 'unseen lastEdited must not change');
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

  const before = StateStore.snapshot();
  const result = PackLibrary.validateLoadPlan('pack-active');
  assert.ok(result, 'validateLoadPlan must succeed');
  const after = PackLibrary.getById('pack-active');
  assert.notEqual(after.handlingRulesValidatedSignature, 'v1:STALE', 'a fresh signature must replace the stale one');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
  const validated = StateStore.snapshot();
  assert.equal(result.validationComplete, true);
  assert.equal(StateStore.undo(), true);
  assert.deepEqual(StateStore.snapshot(), before);
  assert.equal(StateStore.undo(), false, 'exactly one history action');
  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.snapshot(), validated);
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

test('HANDLING-RULES-P0A Q: PackLibrary.update() persists cases and a caller-supplied handlingRulesValidatedSignature together in one write (service persistence only; Apply wiring is source-tested in the carousel suite)', async () => {
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
  const caseA = mkCase({ id: 'case-a', noStackOnTop: true, stackable: true });

  // Same effective "stacking forbidden" meaning with different raw aliases.
  const aliasEquivalent = { ...caseA, noStackOnTop: false, stackable: false };
  assert.notDeepEqual(caseA, aliasEquivalent);
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(caseA, aliasEquivalent), false,
    'identical effective allow-stack-on-top semantics must not register as a placement-affecting change');

  // A genuine alias-driven semantic change (legacy stackable:false blocks stacking).
  const trueAliasChange = { ...caseA, noStackOnTop: false, stackable: true };
  assert.equal(PackLibrary.hasPlacementAffectingHandlingRuleChange(caseA, trueAliasChange), true,
    'a legacy alias that actually changes the effective allow-stack-on-top meaning must register as a change');
});

function initFixture(StateStore, caseA, pack, currentScreen = 'editor') {
  StateStore.init({ currentScreen, currentPackId: pack.id, selectedInstanceIds: [],
    caseLibrary: [caseA], packLibrary: [pack], folderLibrary: [], preferences: {} });
}

function incompleteInstance(kind, placement = 'packed') {
  const inst = mkInst('incomplete', kind === 'missing' ? 'missing-case' : 'case-a', { x: 90, y: 5, z: 0 }, placement);
  if (kind === 'malformed') inst.transform.position = null;
  return inst;
}

for (const kind of ['missing', 'malformed']) {
  test(`HANDLING-RULES-P0A O: packed ${kind} data cannot be certified by Validate`, async () => {
    const { StateStore, PackLibrary } = await freshModules();
    const caseA = mkCase();
    for (const signature of ['v1:OLD', undefined]) {
      const pack = { ...activePackFixture(), cases: [mkInst('valid', 'case-a', { x: 20, y: 5, z: 0 }), incompleteInstance(kind)],
        handlingRulesValidatedSignature: signature };
      initFixture(StateStore, caseA, pack);
      const result = PackLibrary.validateLoadPlan(pack.id);
      assert.equal(result.validationComplete, false);
      assert.equal(result[kind === 'missing' ? 'packedUnresolved' : 'packedMalformed'].length, 1);
      assert.deepEqual(result.pack.cases.find(i => i.id === 'incomplete'), pack.cases[1], 'no fallback geometry or repair');
      assert.equal(PackLibrary.isHandlingRulesValidationRequired(result.pack, [caseA]), true);
      if (signature) assert.equal(result.pack.handlingRulesValidatedSignature, signature);
    }
  });

  test(`HANDLING-RULES-P0A O: active Case Save preserves stale state for packed ${kind} data`, async () => {
    const { StateStore, PackLibrary } = await freshModules();
    const caseA = mkCase();
    for (const existingSignature of [false, true]) {
      const pack = { ...activePackFixture(), cases: [mkInst('valid', 'case-a', { x: 20, y: 5, z: 0 }), incompleteInstance(kind)] };
      const baseline = PackLibrary.buildHandlingRulesValiditySignature(pack, [caseA]);
      if (existingSignature) pack.handlingRulesValidatedSignature = baseline;
      initFixture(StateStore, caseA, pack);
      const result = PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true });
      assert.equal(StateStore.get('caseLibrary')[0].noStackOnTop, true);
      assert.equal(result.packImpact.validationComplete, false);
      const after = PackLibrary.getById(pack.id);
      assert.equal(after.handlingRulesValidatedSignature, baseline);
      assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), true);
      assert.deepEqual(after.cases.find(i => i.id === 'incomplete'), pack.cases[1]);
    }
  });

  test(`HANDLING-RULES-P0A O: staged-only ${kind} data does not block packed certification`, async () => {
    const { StateStore, PackLibrary } = await freshModules();
    const caseA = mkCase();
    const pack = { ...activePackFixture(), cases: [mkInst('valid', 'case-a', { x: 20, y: 5, z: 0 }), incompleteInstance(kind, 'staged')],
      handlingRulesValidatedSignature: 'v1:OLD' };
    initFixture(StateStore, caseA, pack);
    const result = PackLibrary.validateLoadPlan(pack.id);
    assert.equal(result.validationComplete, true);
    assert.equal(result[kind === 'missing' ? 'unresolved' : 'malformed'].length, 1, 'integrity diagnostics remain available');
    assert.equal(PackLibrary.isHandlingRulesValidationRequired(result.pack, [caseA]), false);
    assert.deepEqual(result.pack.cases.find(i => i.id === 'incomplete'), pack.cases[1]);
    const saved = PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true });
    assert.equal(saved.packImpact.validationComplete, true);
    assert.equal(PackLibrary.isHandlingRulesValidationRequired(PackLibrary.getById(pack.id), StateStore.get('caseLibrary')), false);
  });
}

const editorSource = readFileSync(new URL('../../src/screens/editor-screen.js', import.meta.url), 'utf8');
function sourceFunction(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to).trim();
}

test('HANDLING-RULES-P0A incomplete validation drives both warning toasts', async () => {
  const modal = readFileSync(new URL('../../src/ui/overlays/case-modal.js', import.meta.url), 'utf8');
  const toast = runInNewContext(`(${sourceFunction(modal, 'function caseSaveToastArgs(', 'export function openCaseModal(')})`);
  const args = toast({ validationComplete: false, failedIds: [], summary: {} });
  assert.equal(args[1], 'warning');
  assert.match(args[0], /still requires validation/);
  const handler = sourceFunction(editorSource, "handlingRulesValidateBtn.addEventListener('click', () => {", '\n    // Swap a button');
  assert.match(handler, /if \(result.validationComplete !== true\)/);
  assert.match(handler, /tone = 'warning'/);
});

// Execute the exact production map callbacks from both private load functions.
// The surrounding auth/storage shell is outside this focused persistence test.
function ordinaryLoadMapper(name, PackLibrary, storedCases) {
  const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const end = app.indexOf('const storedPrefs', start);
  assert.ok(end > start);
  const block = app.slice(start, end);
  assert.match(block, /\.map\(applyCanonicalCargoFields\)/);
  const match = block.match(/stored\.packLibrary\.map\((pack =>[\s\S]*?)\n        \);/);
  assert.ok(match, 'production load mapper must be found');
  assert.match(match[1], /isHandlingRulesValidationRequired\(pack, storedCases\)/);
  assert.match(match[1], /\? pack\s*: PackLibrary\.repairRestoredPackPlacements\(pack, storedCases\)/);
  return runInNewContext(`(${match[1]})`, { PackLibrary, storedCases });
}

for (const name of ['seedIfEmpty', 'loadScopedStateOrSeed']) {
  test(`HANDLING-RULES-P0A ${name}: persisted stale cargo survives reload; current and legacy cargo still repair`, async () => {
    const { StateStore, PackLibrary } = await freshModules();
    const caseA = mkCase();
    const pack = activePackFixture();
    initFixture(StateStore, caseA, pack, 'packs');
    PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true });
    const saved = JSON.parse(JSON.stringify(StateStore.snapshot()));
    assert.deepEqual(saved.packLibrary[0].cases, pack.cases);
    assert.equal(saved.packLibrary[0].lastEdited, pack.lastEdited);
    const load = ordinaryLoadMapper(name, PackLibrary, saved.caseLibrary);
    const reloaded = load(saved.packLibrary[0]);
    assert.deepEqual(reloaded, saved.packLibrary[0]);
    assert.equal(PackLibrary.isHandlingRulesValidationRequired(reloaded, saved.caseLibrary), true);
    for (const legacy of [false, true]) {
      const candidate = { ...pack };
      if (!legacy) candidate.handlingRulesValidatedSignature = PackLibrary.buildHandlingRulesValiditySignature(candidate, saved.caseLibrary);
      const repaired = load(candidate);
      assert.deepEqual(repaired, PackLibrary.repairRestoredPackPlacements(candidate, saved.caseLibrary));
      assert.notDeepEqual(repaired.cases, candidate.cases, 'ordinary repair remains active');
    }
  });
}

async function runProductionUnpack(StateStore, PackLibrary, CaseLibrary) {
  const fn = sourceFunction(editorSource, 'async function unpackAll()', 'function renderInspectorNoPack()');
  const unpack = runInNewContext(`(${fn})`, { StateStore, PackLibrary, CaseLibrary, buildOrganizedUnpackStagingCases,
    clearPendingTruck() {}, OperationLifecycle: null, UIComponents: { showToast() {} },
    requestAnimationFrame: fn => fn(), render() {} });
  await unpack();
}

test('HANDLING-RULES-P0A production Unpack commits staged cargo + empty signature in one Undo/Redo action', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  const caseA = mkCase();
  const pack = activePackFixture();
  pack.handlingRulesValidatedSignature = PackLibrary.buildHandlingRulesValiditySignature(pack, [caseA]);
  initFixture(StateStore, caseA, pack);
  const before = StateStore.snapshot();
  await runProductionUnpack(StateStore, PackLibrary, CaseLibrary);
  const after = StateStore.snapshot();
  assert.ok(after.packLibrary[0].cases.every(i => i.placement === 'staged'));
  assert.equal(after.packLibrary[0].handlingRulesValidatedSignature, 'v1:');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after.packLibrary[0], [caseA]), false);
  assert.equal(StateStore.undo(), true);
  assert.deepEqual(StateStore.snapshot(), before);
  assert.equal(StateStore.undo(), false);
  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.snapshot(), after);
});

test('HANDLING-RULES-P0A partial production Unpack preserves signature and unresolved packed cargo', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  for (const signature of ['v1:OLD', undefined]) {
    const pack = { ...activePackFixture(), handlingRulesValidatedSignature: signature };
    pack.cases.push(incompleteInstance('missing'));
    initFixture(StateStore, mkCase(), pack);
    await runProductionUnpack(StateStore, PackLibrary, CaseLibrary);
    const after = PackLibrary.getById(pack.id);
    assert.deepEqual(after.cases.find(i => i.id === 'incomplete'), pack.cases[2]);
    assert.equal(after.handlingRulesValidatedSignature, signature);
    assert.ok(after.cases.filter(i => i.id !== 'incomplete').every(i => i.placement === 'staged'));
  }
});

test('HANDLING-RULES-P0A R: remapped import discards foreign signature after local repair without publishing', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ noStackOnTop: true });
  const pack = activePackFixture();
  initFixture(StateStore, caseA, pack, 'packs');
  const before = StateStore.snapshot();
  const incoming = { ...pack, id: 'imported', handlingRulesValidatedSignature: 'v1:FOREIGN',
    cases: pack.cases.map(i => ({ ...i, caseId: 'foreign-case' })) };
  const plan = PackLibrary.planPackImport({ pack: incoming, bundledCases: [{ ...caseA, id: 'foreign-case' }] });
  assert.deepEqual(StateStore.snapshot(), before);
  assert.ok(plan.pack.cases.every(i => i.caseId === caseA.id));
  assert.ok(plan.pack.cases.some(i => i.placement === 'staged'), 'illegal imported stack is repaired before certification');
  assert.equal(plan.pack.handlingRulesValidatedSignature,
    PackLibrary.buildHandlingRulesValiditySignature(plan.pack, [...before.caseLibrary, ...plan.newCases]));
  assert.notEqual(plan.pack.handlingRulesValidatedSignature, 'v1:FOREIGN');
});

// Minimal controller UI fixture: production reconciliation/commit functions run;
// modal rendering and button selection are represented without a browser.
function truckHarness(PackLibrary, CaseLibrary) {
  const modals = [];
  const element = () => ({ appendChild() {}, querySelectorAll: () => [] });
  const controller = createTruckChangeController({ PackLibrary, CaseLibrary,
    documentRef: { createElement: element, addEventListener() {}, removeEventListener() {} },
    UIComponents: { showToast() {}, showModal(config) {
      modals.push(config);
      return { modal: element(), close() { config.onClose?.(); } };
    } },
  });
  return { controller, modals };
}

for (const customCommit of [false, true]) {
  test(`HANDLING-RULES-P0A Truck Change certifies final staged set atomically (${customCommit ? 'Packs callback' : 'default commit'})`, async () => {
    const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
    const caseA = mkCase();
    const pack = { ...activePackFixture(), cases: [mkInst('cargo', 'case-a', { x: 60, y: 5, z: 0 })] };
    pack.handlingRulesValidatedSignature = PackLibrary.buildHandlingRulesValiditySignature(pack, [caseA]);
    initFixture(StateStore, caseA, pack);
    const before = StateStore.snapshot();
    const { controller, modals } = truckHarness(PackLibrary, CaseLibrary);
    const options = { pack: PackLibrary.getById(pack.id), nextTruck: { ...RECT_TRUCK, length: 30 } };
    if (customCommit) {
      const src = readFileSync(new URL('../../src/screens/packs-screen.js', import.meta.url), 'utf8');
      const callback = src.match(/commit: (finalPack => PackLibrary\.update\(packId, \{[\s\S]*?\}\)),/)[1];
      options.commit = runInNewContext(`(${callback})`, { PackLibrary, packId: pack.id, metadata: { title: 'Updated' } });
    }
    assert.equal(controller.request(options).status, 'preview');
    assert.equal(modals[0].actions.find(a => a.label === 'Move to staging').onClick(), true);
    const after = StateStore.snapshot();
    assert.equal(after.packLibrary[0].cases[0].placement, 'staged');
    assert.equal(after.packLibrary[0].handlingRulesValidatedSignature, 'v1:');
    assert.equal(PackLibrary.isHandlingRulesValidationRequired(after.packLibrary[0], [caseA]), false);
    assert.equal(StateStore.undo(), true);
    assert.deepEqual(StateStore.snapshot(), before);
    assert.equal(StateStore.undo(), false);
    assert.equal(StateStore.redo(), true);
    assert.deepEqual(StateStore.snapshot(), after);
  });
}

for (const kind of ['missing', 'malformed']) {
  test(`HANDLING-RULES-P0A Truck Change with ${kind} packed cargo cannot commit or certify`, async () => {
    const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
    const pack = { ...activePackFixture(), cases: [incompleteInstance(kind)], handlingRulesValidatedSignature: 'v1:OLD' };
    initFixture(StateStore, mkCase(), pack);
    const before = StateStore.snapshot();
    const { controller, modals } = truckHarness(PackLibrary, CaseLibrary);
    controller.request({ pack, nextTruck: { ...RECT_TRUCK, length: 30 } });
    assert.deepEqual(modals[0].actions.map(a => a.label), ['Cancel']);
    assert.deepEqual(StateStore.snapshot(), before);
  });
}

test('HANDLING-RULES-P0A unchanged truck metadata save does not certify stale cargo', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  const pack = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:OLD' };
  initFixture(StateStore, mkCase(), pack);
  const { controller } = truckHarness(PackLibrary, CaseLibrary);
  const result = controller.request({ pack, nextTruck: { ...pack.truck }, commitWhenUnchanged: true,
    commit: finalPack => PackLibrary.update(pack.id, { title: 'Metadata only', cases: finalPack.cases,
      handlingRulesValidatedSignature: finalPack.handlingRulesValidatedSignature }) });
  assert.equal(result.status, 'committed');
  assert.equal(PackLibrary.getById(pack.id).handlingRulesValidatedSignature, 'v1:OLD');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(PackLibrary.getById(pack.id), CaseLibrary.getCases()), true);
});

test('HANDLING-RULES-P0A Truck Change staging failure cannot publish a signature or partial cargo', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  const pack = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:OLD' };
  initFixture(StateStore, mkCase(), pack);
  const before = StateStore.snapshot();
  const failingLibrary = { ...PackLibrary, stagePlacementIds(source, ids) {
    return { pack: source, stagedIds: [], failedIds: ids };
  } };
  const { controller, modals } = truckHarness(failingLibrary, CaseLibrary);
  controller.request({ pack, nextTruck: { ...RECT_TRUCK, length: 30 } });
  assert.equal(modals[0].actions.find(a => a.label === 'Move to staging').onClick(), false);
  assert.deepEqual(StateStore.snapshot(), before);
});

test('HANDLING-RULES-P0A Truck Change final certification uses current Case definitions', async () => {
  const { StateStore, PackLibrary, CaseLibrary } = await freshModules();
  const caseA = mkCase();
  const pack = { ...activePackFixture(), handlingRulesValidatedSignature: 'v1:OLD' };
  initFixture(StateStore, caseA, pack);
  const { controller, modals } = truckHarness(PackLibrary, CaseLibrary);
  controller.request({ pack, nextTruck: { ...RECT_TRUCK, length: 130 } });
  StateStore.set({ caseLibrary: [{ ...caseA, noStackOnTop: true }] });
  const beforeCommit = StateStore.snapshot();
  assert.equal(modals[0].actions.find(a => a.label === 'Apply change').onClick(), false,
    'a changed Case invalidating the preview must block, never certify old poses with new rules');
  assert.deepEqual(StateStore.snapshot(), beforeCommit);
});

// ---------------------------------------------------------------------------
// Validation STATUS UI — presentation only.
//
// The Handling Rules validation SAFETY feature is unchanged (the authority is
// PackLibrary.isHandlingRulesValidationRequired / validateLoadPlan and the stored
// signature). What changed is how a stale Load Plan is shown: a compact warning
// icon on Load Plans (Grid + List) and a compact icon + small anchored panel in the
// Editor, replacing the Load Plans chip, the full-width Editor banner, and the
// generic viewport info icon.
// ---------------------------------------------------------------------------

const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mainCss = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
const packsSource = readFileSync(new URL('../../src/screens/packs-screen.js', import.meta.url), 'utf8');
const casesSource = readFileSync(new URL('../../src/screens/cases-screen.js', import.meta.url), 'utf8');

test('VALIDATION-STATUS-UI Editor markup: banner and generic viewport info icon are gone; a compact hidden status + hidden panel replace them', () => {
  // Removed presentations.
  assert.doesNotMatch(indexHtml, /viewport-hint-icon|Editor tips|Click to select\. Drag to move/, 'the generic viewport info icon is removed');
  assert.doesNotMatch(indexHtml, /handling-rules-banner/, 'the full-width Handling Rules banner is removed');
  assert.doesNotMatch(mainCss, /viewport-hint|handling-rules-banner|\.badge--warning/, 'their dedicated CSS is removed');
  // The legitimate Editor/Inspector help icons are untouched.
  assert.match(mainCss, /\.tp3d-editor-info-icon\[data-tooltip\]::after/, 'other help icons keep their tooltip rules');

  // New compact status: hidden by default (bottom-left corner is empty for a current Pack).
  assert.match(indexHtml, /<div\b[^>]*\bclass="tp3d-editor-validation-status"[^>]*\bid="editor-validation-status"[^>]*\bhidden(?:\s|>)/);
  const statusBtn = indexHtml.match(/<button\b[^>]*\bid="editor-validation-status-btn"[^>]*>/)?.[0] || '';
  assert.match(statusBtn, /type="button"/);
  assert.match(statusBtn, /aria-label="Validation required"/);
  assert.match(statusBtn, /aria-expanded="false"/);
  assert.match(statusBtn, /aria-controls="editor-validation-popover"/);
  assert.match(statusBtn, /data-tooltip="Validation required"\s/, 'the hover/focus label is just "Validation required"');
  // Small panel: hidden by default, exact information hierarchy, real Validate button that keeps its id.
  const popover = indexHtml.match(/<div\b[^>]*\bid="editor-validation-popover"[\s\S]*?<\/button>\s*<\/div>/)?.[0] || '';
  assert.match(popover, /\bhidden\b/);
  assert.match(popover, /role="dialog"[\s\S]*aria-modal="false"/, 'a small non-modal panel, not an alert modal');
  assert.match(popover, /class="tp3d-editor-validation-popover__title"[^>]*>\s*Validation required\s*</);
  assert.match(popover, /class="tp3d-editor-validation-popover__body"[^>]*>\s*Handling Rules changed since this Load Plan was last validated\.\s*</);
  assert.match(popover, /<button\b[^>]*\bid="editor-handling-rules-validate-btn"[^>]*\btype="button"[^>]*>\s*Validate Load Plan\s*<\/button>/);
  // Hidden state is honoured by CSS.
  assert.match(mainCss, /\.tp3d-editor-validation-status\[hidden\]\s*\{\s*display:\s*none\s*;\s*\}/);
  assert.match(mainCss, /\.tp3d-editor-validation-popover\[hidden\]\s*\{\s*display:\s*none\s*;\s*\}/);
  // Restrained: an anchored panel with no backdrop, opening upward from the corner icon.
  const popCss = mainCss.match(/\.tp3d-editor-validation-popover\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(popCss, /position:\s*absolute;/);
  assert.match(popCss, /bottom:\s*calc\(14px \+ 32px \+ 8px\);/, 'opens upward from the corner icon');
  assert.doesNotMatch(mainCss, /tp3d-editor-validation[^{]*\{[^}]*(?:backdrop|background:\s*rgb\(0)/, 'no modal backdrop or dimming scrim');

  // The wrapper is a transparent, click-through layer over the canvas (so the 3D scene stays interactive) that is
  // a size container, letting the panel and hover label be capped to the canvas's OWN width. Without the cap the
  // panel is clipped by .canvas-wrap { overflow: hidden } when the side panels squeeze the canvas (~900px) and the
  // Validate button becomes unreachable.
  const layerCss = mainCss.match(/\.tp3d-editor-validation-status\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(layerCss, /position:\s*absolute;[\s\S]*inset:\s*0;/);
  assert.match(layerCss, /pointer-events:\s*none;/, 'the layer never blocks the 3D scene');
  assert.match(layerCss, /container-type:\s*inline-size;/);
  assert.match(popCss, /pointer-events:\s*auto;/, 'the panel itself stays interactive');
  assert.match(popCss, /max-width:\s*min\(260px, calc\(100cqw - 28px\)\);/, 'never wider than the canvas');
  assert.match(popCss, /min-width:\s*min\(220px, calc\(100cqw - 28px\)\);/, 'and its minimum also yields to a narrow canvas');
  const btnAnchor = mainCss.match(/\.tp3d-editor-validation-status__btn\[data-tooltip\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(btnAnchor, /position:\s*absolute;/, 'the icon stays anchored (generic [data-tooltip] would otherwise make it relative)');
  const tipCss = mainCss.match(/\.tp3d-editor-validation-status__btn\[data-tooltip\]::after\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(tipCss, /max-width:\s*calc\(100cqw - 20px\);/, 'the short hover label is also capped to the canvas');
});

test('VALIDATION-STATUS-UI Editor source: dead hint/banner code is gone, helper renamed, and no second validation authority is introduced', () => {
  assert.doesNotMatch(editorSource, /viewportHintBtn|viewportHintOpen|setViewportHintOpen|handlingRulesBanner|renderHandlingRulesBanner|viewport-hint-icon/);
  assert.match(editorSource, /function renderHandlingRulesStatus\(pack\) \{/);
  assert.equal((editorSource.match(/renderHandlingRulesStatus\(/g) || []).length, 3, 'defined once, called for no-Pack and for a Pack');
  const region = statusRegion();
  assert.doesNotMatch(region.status, /validateLoadPlan|buildHandlingRulesValiditySignature|handlingRulesValidatedSignature|commitCaseHandlingRuleChange/,
    'the status/panel code decides nothing and validates nothing itself');
  assert.match(region.status, /PackLibrary\.isHandlingRulesValidationRequired\(pack, CaseLibrary\.getCases\(\)\)/, 'staleness still comes from the existing authority');
  assert.equal((region.all.match(/PackLibrary\.validateLoadPlan\(/g) || []).length, 1, 'exactly one validateLoadPlan call: the existing Validate handler');
  assert.match(region.handler, /PackLibrary\.validateLoadPlan\(packId, CaseLibrary\.getCases\(\)\)/);
  assert.doesNotMatch(packsSource, /validateLoadPlan\(/, 'Load Plans management screens never validate');
});

// Extracts the exact production status/panel code (and the untouched Validate handler) for behavioral tests.
function statusRegion() {
  const from = editorSource.indexOf('let validationPopoverOpen = false;');
  const to = editorSource.indexOf('\n    // Swap a button', from);
  assert.ok(from >= 0 && to > from);
  const all = editorSource.slice(from, to);
  const handlerFrom = all.indexOf("handlingRulesValidateBtn.addEventListener('click', () => {");
  assert.ok(handlerFrom >= 0);
  const statusEnd = all.indexOf('if (validationStatusBtn) {');
  return { all, status: all.slice(0, statusEnd), handler: all.slice(handlerFrom) };
}

class StatusFakeNode {}
function makeStatusEl(doc, name, children = []) {
  const el = new StatusFakeNode();
  Object.assign(el, { name, hidden: true, attrs: {}, listeners: {}, children });
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.addEventListener = (type, fn) => { (el.listeners[type] ||= []).push(fn); };
  el.focus = () => { doc.activeElement = el; };
  el.contains = node => node === el || children.some(c => c === node || c.contains(node));
  return el;
}
function fireOn(el, type, extra = {}) {
  const ev = { type, target: el, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {}, ...extra };
  (el.listeners[type] || []).slice().forEach(fn => fn(ev));
  return ev;
}
function fireOnDocument(doc, type, extra = {}) {
  const ev = { type, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {}, ...extra };
  doc.listeners.filter(l => l.type === type).slice().forEach(l => l.fn(ev));
  return ev;
}

// Mounts the REAL status/panel/Validate-handler source against the REAL PackLibrary.
function mountEditorStatus({ StateStore, PackLibrary, CaseLibrary }) {
  const doc = {
    activeElement: null,
    listeners: [],
    addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn, capture) {
      this.listeners = this.listeners.filter(l => !(l.type === type && l.fn === fn && l.capture === capture));
    },
  };
  const validateBtn = makeStatusEl(doc, 'validate');
  const popover = makeStatusEl(doc, 'popover', [validateBtn]);
  const statusBtn = makeStatusEl(doc, 'status-btn');
  const status = makeStatusEl(doc, 'status', [statusBtn, popover]);
  const toasts = [];
  const calls = { validate: [], render: 0 };
  const busy = { value: false };
  const spyLibrary = { ...PackLibrary, validateLoadPlan: (...args) => { calls.validate.push(args); return PackLibrary.validateLoadPlan(...args); } };
  const ctx = {
    document: doc, Node: StatusFakeNode, StateStore, CaseLibrary, PackLibrary: spyLibrary,
    UIComponents: { showToast: (message, tone) => toasts.push({ message, tone }) },
    editorMutationBlocked: () => busy.value,
    render: () => { calls.render += 1; },
    validationStatusEl: status, validationStatusBtn: statusBtn, validationPopoverEl: popover, handlingRulesValidateBtn: validateBtn,
  };
  const api = runInNewContext(
    `(function () {\n${statusRegion().all}\nreturn { renderHandlingRulesStatus, setValidationPopoverOpen, isOpen: () => validationPopoverOpen };\n})()`,
    ctx
  );
  return { doc, api, status, statusBtn, popover, validateBtn, toasts, calls, busy, spyLibrary, ctx };
}

const stalePackFixture = () => ({ ...activePackFixture(), handlingRulesValidatedSignature: 'v1:OLD' });

test('VALIDATION-STATUS-UI Editor: a stale Pack shows ONE compact status; a current Pack shows nothing', async () => {
  const mods = await freshModules();
  const caseA = mkCase();
  initFixture(mods.StateStore, caseA, stalePackFixture());
  const m = mountEditorStatus(mods);
  const stale = mods.PackLibrary.getById('pack-active');
  assert.equal(mods.PackLibrary.isHandlingRulesValidationRequired(stale, [caseA]), true, 'fixture really is stale under the real authority');

  m.api.renderHandlingRulesStatus(stale);
  assert.equal(m.status.hidden, false, 'stale: the compact status is shown');
  assert.equal(m.popover.hidden, true, 'the panel stays closed until the icon is clicked');
  assert.equal(m.statusBtn.attrs['aria-expanded'], undefined, 'no state is written until the user interacts');

  const current = { ...stale, handlingRulesValidatedSignature: mods.PackLibrary.buildHandlingRulesValiditySignature(stale, [caseA]) };
  m.api.renderHandlingRulesStatus(current);
  assert.equal(m.status.hidden, true, 'current: the bottom-left corner is empty');
  m.api.renderHandlingRulesStatus(null);
  assert.equal(m.status.hidden, true, 'no Pack: nothing is shown');
});

test('VALIDATION-STATUS-UI Editor: clicking the icon only toggles the panel — it never validates or mutates cargo', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  const before = mods.StateStore.snapshot();
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));

  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), true);
  assert.equal(m.popover.hidden, false);
  assert.equal(m.statusBtn.attrs['aria-expanded'], 'true');
  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), false);
  assert.equal(m.popover.hidden, true);
  assert.equal(m.statusBtn.attrs['aria-expanded'], 'false');

  assert.equal(m.calls.validate.length, 0, 'opening/closing the panel never calls the validation authority');
  assert.equal(m.calls.render, 0);
  assert.deepEqual(mods.StateStore.snapshot(), before, 'and never touches cargo, signature, or history');
  assert.equal(mods.StateStore.undo(), false);
});

test('VALIDATION-STATUS-UI Editor: Validate Load Plan reuses the existing authority and toasts, closes the panel, and the status disappears once current', async () => {
  const mods = await freshModules();
  const caseA = mkCase();
  initFixture(mods.StateStore, caseA, stalePackFixture());
  const m = mountEditorStatus(mods);
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  fireOn(m.statusBtn, 'click');

  fireOn(m.validateBtn, 'click');
  assert.equal(m.calls.validate.length, 1, 'exactly one validation, through the existing PackLibrary.validateLoadPlan');
  assert.deepEqual(m.calls.validate[0], ['pack-active', mods.CaseLibrary.getCases()]);
  assert.equal(m.calls.render, 1, 'the existing handler re-renders');
  assert.equal(m.api.isOpen(), false, 'the panel closes as soon as the explicit action is taken');
  assert.deepEqual(m.toasts, [{ message: 'Load Plan validated. No cargo changes were needed.', tone: 'success' }]);

  const after = mods.PackLibrary.getById('pack-active');
  assert.equal(mods.PackLibrary.isHandlingRulesValidationRequired(after, [caseA]), false, 'the real authority now reports current');
  m.api.renderHandlingRulesStatus(after);
  assert.equal(m.status.hidden, true, 'status disappears once the Pack is current');
});

test('VALIDATION-STATUS-UI Editor: every validation outcome keeps its original toast copy and tone; a busy Editor never validates', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const outcomes = [
    [{ validationComplete: true, summary: {} }, 'Load Plan validated. No cargo changes were needed.', 'success'],
    [{ validationComplete: false, summary: {} }, 'Some cargo could not be validated and remains flagged.', 'warning'],
    [{ validationComplete: true, summary: { staged: 2 } }, 'Load Plan validated. Affected cargo could not rest safely and was moved to staging.', 'warning'],
    [{ validationComplete: true, summary: { repaired: 1 } }, 'Load Plan validated. Cargo was adjusted to match current Handling Rules.', 'info'],
    [{ validationComplete: true, summary: { adjusted: 1 } }, 'Load Plan validated. Cargo was adjusted to match current Handling Rules.', 'info'],
    [null, 'Validation failed. Please try again.', 'error'],
  ];
  for (const [result, message, tone] of outcomes) {
    const m = mountEditorStatus(mods);
    m.ctx.PackLibrary.validateLoadPlan = () => result;
    fireOn(m.validateBtn, 'click');
    assert.deepEqual(m.toasts, [{ message, tone }], `outcome ${JSON.stringify(result)}`);
  }
  const busy = mountEditorStatus(mods);
  busy.busy.value = true;
  fireOn(busy.validateBtn, 'click');
  assert.equal(busy.calls.validate.length, 0, 'editorMutationBlocked() still gates the action');
  assert.deepEqual(busy.toasts, []);
});

test('VALIDATION-STATUS-UI Editor: Escape and an outside press close the panel, a press inside does not, and document listeners never leak', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  assert.equal(m.doc.listeners.length, 0, 'nothing is registered while the panel is closed');

  fireOn(m.statusBtn, 'click');
  assert.deepEqual(m.doc.listeners.map(l => `${l.type}:${l.capture}`).sort(), ['keydown:true', 'pointerdown:true'],
    'exactly two capture-phase listeners exist only while open');

  // A press INSIDE the status area (icon or panel) leaves it open.
  fireOnDocument(m.doc, 'pointerdown', { target: m.validateBtn });
  fireOnDocument(m.doc, 'pointerdown', { target: m.statusBtn });
  assert.equal(m.api.isOpen(), true);
  // A press OUTSIDE closes it (capture phase, so the 3D canvas cannot swallow it).
  fireOnDocument(m.doc, 'pointerdown', { target: new StatusFakeNode() });
  assert.equal(m.api.isOpen(), false);
  assert.equal(m.doc.listeners.length, 0);

  // Escape closes, stops the event, and returns focus to the icon when focus was inside the panel.
  fireOn(m.statusBtn, 'click');
  m.doc.activeElement = m.validateBtn;
  const esc = fireOnDocument(m.doc, 'keydown', { key: 'Escape' });
  assert.equal(esc.stopped, true);
  assert.equal(m.api.isOpen(), false);
  assert.equal(m.doc.activeElement, m.statusBtn, 'keyboard focus returns to the icon');
  // Other keys do nothing.
  fireOn(m.statusBtn, 'click');
  fireOnDocument(m.doc, 'keydown', { key: 'Tab' });
  assert.equal(m.api.isOpen(), true);
  fireOn(m.statusBtn, 'click');

  // Many re-renders and open/close cycles: the listener count returns to zero every time.
  for (let i = 0; i < 5; i += 1) {
    m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
    fireOn(m.statusBtn, 'click');
    m.api.setValidationPopoverOpen(true); // already open: must not register a second pair
    assert.equal(m.doc.listeners.length, 2);
    fireOn(m.statusBtn, 'click');
    assert.equal(m.doc.listeners.length, 0);
  }
});

test('VALIDATION-STATUS-UI Editor: the panel closes when the Pack becomes current, switches, or the Editor is re-entered', async () => {
  const mods = await freshModules();
  const caseA = mkCase();
  initFixture(mods.StateStore, caseA, stalePackFixture());
  const m = mountEditorStatus(mods);
  const stale = mods.PackLibrary.getById('pack-active');

  m.api.renderHandlingRulesStatus(stale);
  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), true);
  m.api.renderHandlingRulesStatus(stale); // an unrelated re-render keeps it open
  assert.equal(m.api.isOpen(), true);

  m.api.renderHandlingRulesStatus({ ...stale, handlingRulesValidatedSignature: mods.PackLibrary.buildHandlingRulesValiditySignature(stale, [caseA]) });
  assert.equal(m.api.isOpen(), false, 'no longer stale: closed');
  assert.equal(m.status.hidden, true);
  assert.equal(m.doc.listeners.length, 0);

  fireOn(m.statusBtn, 'click');
  assert.equal(m.api.isOpen(), true);
  m.api.renderHandlingRulesStatus({ ...stale, id: 'another-pack' });
  assert.equal(m.api.isOpen(), false, 'a different Load Plan renders: closed');
  assert.equal(m.doc.listeners.length, 0);

  // Entering the Editor always starts closed.
  assert.match(editorSource, /function onActivated\(\) \{\s*\/\/[^\n]*\n\s*setValidationPopoverOpen\(false\);/);
});

test('VALIDATION-STATUS-UI Load Plans: the status icon is compact, short-labelled, and contained (click and keyboard)', () => {
  const fnFrom = packsSource.indexOf('function createPackValidationStatus(');
  const fnTo = packsSource.indexOf('function createPackNotesButton(', fnFrom);
  assert.ok(fnFrom >= 0 && fnTo > fnFrom);
  const makeEl = () => {
    const el = { attrs: {}, listeners: {}, className: '', tabIndex: -1, innerHTML: '' };
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
    el.addEventListener = (type, fn) => { (el.listeners[type] ||= []).push(fn); };
    return el;
  };
  const build = runInNewContext(`(${packsSource.slice(fnFrom, fnTo).trim()})`, { document: { createElement: makeEl } });

  for (const [opts, expectedClass] of [[undefined, 'tp3d-validation-status'], [{ inline: true }, 'tp3d-validation-status tp3d-validation-status--inline']]) {
    const el = build(opts);
    assert.equal(el.className, expectedClass);
    assert.equal(el.attrs['data-tooltip'], 'Validation required', 'hover/focus text is ONLY the short label');
    assert.equal(el.attrs['aria-label'], 'Validation required');
    assert.equal(el.attrs.role, 'img', 'a status, not a button');
    assert.equal(el.attrs['data-pack-status'], 'validation');
    assert.equal(el.tabIndex, 0, 'focusable so the label is reachable by keyboard');
    assert.match(el.innerHTML, /fa-triangle-exclamation/);
    assert.match(el.innerHTML, /aria-hidden="true"/);
    assert.doesNotMatch(el.attrs['data-tooltip'], /[.,;:]|Handling Rules|Case/, 'no long sentence in the generic tooltip');
    // Neither a click nor Enter/Space can reach the card/row handlers (open, select, Notes, overflow).
    for (const type of ['click', 'keydown']) {
      assert.equal(el.listeners[type].length, 1);
      const ev = { stopPropagation() { this.stopped = true; } };
      el.listeners[type][0](ev);
      assert.equal(ev.stopped, true, `${type} must stop propagation`);
    }
    assert.equal(el.listeners.click.length + el.listeners.keydown.length, 2, 'and it performs no action of its own');
  }
});

test('VALIDATION-STATUS-UI Load Plans Grid: stale Pack gets the icon between selection and Notes; no chip, no long tooltip; the card ignores it', () => {
  const grid = packsSource.slice(packsSource.indexOf('function renderGridView(packs) {'), packsSource.indexOf('function buildPreview('));
  assert.ok(grid.length > 500);
  assert.doesNotMatch(grid, /badge--warning|validationBadge|Validation required/, 'the old chip is gone from the Grid');
  const cluster = grid.slice(grid.indexOf("actions.className = 'card-head-actions'"), grid.indexOf('head.appendChild(titleWrap)'));
  const iSel = cluster.indexOf('actions.appendChild(selectCb)');
  const iStatus = cluster.indexOf('actions.appendChild(createPackValidationStatus())');
  const iNotes = cluster.indexOf('actions.appendChild(createPackNotesButton(pack))');
  const iKebab = cluster.indexOf('actions.appendChild(kebabBtn)');
  assert.ok(iSel >= 0 && iSel < iStatus && iStatus < iNotes && iNotes < iKebab, 'order: [ checkbox ] [ warning ] [ Notes ] [ ⋮ ]');
  assert.match(cluster, /if \(PackLibrary\.isHandlingRulesValidationRequired\(pack, CaseLibrary\.getCases\(\)\)\) \{\s*actions\.appendChild\(createPackValidationStatus\(\)\);\s*\}/,
    'shown only when the existing authority says the Load Plan is stale');
  // The whole-card click handler skips the status (in addition to the status stopping propagation itself).
  const cardClick = grid.slice(grid.indexOf("card.addEventListener('click'"), grid.indexOf('openPack(pack.id);'));
  assert.match(cardClick, /targetEl\.closest\('\[data-pack-status\]'\)/);
});

test('VALIDATION-STATUS-UI Load Plans List: stale Pack gets the same icon beside the title; no chip and no new column', () => {
  const list = packsSource.slice(packsSource.indexOf('function renderListView(packs) {'), packsSource.indexOf('function renderGridView(packs) {'));
  assert.ok(list.length > 500);
  assert.doesNotMatch(list, /badge--warning|validationBadge|Validation required/, 'the old chip is gone from the List');
  assert.match(list, /if \(PackLibrary\.isHandlingRulesValidationRequired\(pack, CaseLibrary\.getCases\(\)\)\) \{\s*title\.appendChild\(createPackValidationStatus\(\{ inline: true \}\)\);\s*\}/);
  assert.equal((list.match(/\btr\.appendChild\(/g) || []).length, 12, 'the row keeps its existing 12 cells — no new column, no structure change');
  assert.equal((list.match(/createElement\('td'\)/g) || []).length, 12);
});

test('VALIDATION-STATUS-UI Scope: no long generic tooltip, no Case-level warning, and the compact styles exist', () => {
  assert.equal((packsSource.match(/Validation required/g) || []).length, 2, 'only the icon builder carries the label (aria-label + tooltip)');
  assert.doesNotMatch(packsSource, /Handling Rules changed since|referenced Case’s Handling Rules|last validated/, 'the long explanation lives only in the Editor panel');
  assert.doesNotMatch(casesSource, /isHandlingRulesValidationRequired|Validation required|createPackValidationStatus|data-pack-status/,
    'no Case-level validation status exists or is implied');
  const status = mainCss.match(/\.tp3d-validation-status\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(status, /color:\s*var\(--warning, #f59e0b\);/, 'amber warning semantic');
  assert.doesNotMatch(status, /\bborder\s*:|background/, 'a compact icon: no chip fill and no border');
  assert.match(mainCss, /\.tp3d-validation-status--inline\s*\{/);
  const editorBtn = mainCss.match(/\.tp3d-editor-validation-status__btn\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(editorBtn, /width:\s*32px;[\s\S]*height:\s*32px;/, 'same general scale as the removed info icon');
  assert.match(editorBtn, /color:\s*var\(--warning, #f59e0b\);/);
});
