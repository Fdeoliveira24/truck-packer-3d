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

test('HANDLING-RULES-P0A ordinary persisted reload preserves stale cargo, while current and legacy Packs still repair', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase();
  const pack = activePackFixture();
  initFixture(StateStore, caseA, pack, 'packs');
  PackLibrary.commitCaseHandlingRuleChange({ ...caseA, noStackOnTop: true });
  const saved = JSON.parse(JSON.stringify(StateStore.snapshot()));
  assert.deepEqual(saved.packLibrary[0].cases, pack.cases);
  assert.equal(saved.packLibrary[0].lastEdited, pack.lastEdited);
  const reloaded = PackLibrary.preparePackForOrdinaryLoad(saved.packLibrary[0], saved.caseLibrary);
  assert.deepEqual(reloaded, saved.packLibrary[0]);
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(reloaded, saved.caseLibrary), true);
  for (const legacy of [false, true]) {
    const candidate = { ...pack };
    if (!legacy) candidate.handlingRulesValidatedSignature = PackLibrary.buildHandlingRulesValiditySignature(candidate, saved.caseLibrary);
    const repaired = PackLibrary.preparePackForOrdinaryLoad(candidate, saved.caseLibrary);
    assert.deepEqual(repaired, PackLibrary.repairRestoredPackPlacements(candidate, saved.caseLibrary));
    assert.notDeepEqual(repaired.cases, candidate.cases, 'ordinary repair remains active');
  }
});

test('HANDLING-RULES-P0A both ordinary app load call sites use the shared stale-preserving helper', () => {
  const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
  for (const name of ['seedIfEmpty', 'loadScopedStateOrSeed']) {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const end = app.indexOf('const storedPrefs', start);
    assert.ok(end > start);
    const block = app.slice(start, end);
    assert.match(block, /\.map\(applyCanonicalCargoFields\)/);
    assert.match(block, /stored\.packLibrary\.map\(pack =>\s*PackLibrary\.preparePackForOrdinaryLoad\(pack, storedCases\)\s*\)/);
    assert.doesNotMatch(block, /repairRestoredPackPlacements/);
  }
});

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
