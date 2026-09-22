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
const appSource = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

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

test('VALIDATION-STATUS-UI Editor markup: banner and generic viewport info icon are gone; a compact hidden status + short hint card + hidden action panel replace them', () => {
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
  assert.match(statusBtn, /aria-label="Load plan needs review"/, 'accessible name uses the new user-facing copy');
  assert.match(statusBtn, /aria-expanded="false"/, 'aria-expanded still belongs to the click-open panel');
  assert.match(statusBtn, /aria-controls="editor-validation-popover"/);
  assert.match(statusBtn, /aria-describedby="editor-validation-hint-body"/, 'the short hint is the accessible description');
  assert.doesNotMatch(statusBtn, /data-tooltip|title=/, 'the generic black tooltip is NOT used on the warning');

  // Short informational hint card: title + one short line, no action, DOM-ordered after the icon for the CSS sibling rule.
  const hint = indexHtml.match(/<div\b[^>]*\bid="editor-validation-hint"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(hint, /role="tooltip"/);
  assert.match(hint, /class="tp3d-status-card__title">Load plan needs review</);
  assert.match(hint, /id="editor-validation-hint-body">Loading rules have changed\.</);
  assert.doesNotMatch(hint, /<button|<a\b|<input|Check Load Plan/, 'the hint is informational only — no action, no long paragraph');
  const iBtn = indexHtml.indexOf('id="editor-validation-status-btn"');
  const iHint = indexHtml.indexOf('id="editor-validation-hint"');
  const iPop = indexHtml.indexOf('id="editor-validation-popover"');
  assert.ok(iBtn < iHint && iHint < iPop, 'DOM order: icon, hint card, action panel');

  // Small action panel: hidden by default, locked copy, real button that keeps its id.
  const popover = indexHtml.match(/<div\b[^>]*\bid="editor-validation-popover"[\s\S]*?<\/button>\s*<\/div>/)?.[0] || '';
  assert.match(popover, /\bhidden\b/);
  assert.match(popover, /role="dialog"[\s\S]*aria-modal="false"/, 'a small non-modal panel, not an alert modal');
  assert.match(popover, /class="tp3d-editor-validation-popover__title"[^>]*>\s*Load plan needs review\s*</);
  const panelBody = (popover.match(/class="tp3d-editor-validation-popover__body"[^>]*>([\s\S]*?)<\/p>/)?.[1] || '').replace(/\s+/g, ' ').trim();
  assert.equal(panelBody, 'A case’s loading rules changed after this plan was last checked. Review the plan to make sure the cargo still follows the latest rules.');
  assert.match(popover, /<button\b[^>]*\bid="editor-handling-rules-validate-btn"[^>]*\btype="button"[^>]*>\s*Check Load Plan\s*<\/button>/);
  // Hidden state is honoured by CSS.
  assert.match(mainCss, /\.tp3d-editor-validation-status\[hidden\]\s*\{\s*display:\s*none\s*;\s*\}/);
  assert.match(mainCss, /\.tp3d-editor-validation-popover\[hidden\]\s*\{\s*display:\s*none\s*;\s*\}/);
  // Restrained: an anchored panel with no backdrop, opening upward from the corner icon.
  const popCss = mainCss.match(/\.tp3d-editor-validation-popover\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(popCss, /position:\s*absolute;/);
  assert.match(popCss, /bottom:\s*calc\(14px \+ 32px \+ 8px\);/, 'opens upward from the corner icon');
  assert.doesNotMatch(mainCss, /tp3d-editor-validation[^{]*\{[^}]*(?:backdrop|background:\s*rgb\(0)/, 'no modal backdrop or dimming scrim');

  // The wrapper is a transparent, click-through layer over the canvas (so the 3D scene stays interactive) that is
  // a size container, letting the panel and hint card be capped to the canvas's OWN width. Without the cap the
  // panel is clipped by .canvas-wrap { overflow: hidden } when the side panels squeeze the canvas and the
  // Check Load Plan button becomes unreachable.
  const layerCss = mainCss.match(/\.tp3d-editor-validation-status\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(layerCss, /position:\s*absolute;[\s\S]*inset:\s*0;/);
  assert.match(layerCss, /pointer-events:\s*none;/, 'the layer never blocks the 3D scene');
  assert.match(layerCss, /container-type:\s*inline-size;/);
  assert.match(popCss, /pointer-events:\s*auto;/, 'the panel itself stays interactive');
  assert.match(popCss, /max-width:\s*min\(260px, calc\(100cqw - 28px\)\);/, 'never wider than the canvas');
  assert.match(popCss, /min-width:\s*min\(220px, calc\(100cqw - 28px\)\);/, 'and its minimum also yields to a narrow canvas');
  assert.doesNotMatch(mainCss, /tp3d-editor-validation-status__btn\[data-tooltip\]/, 'no generic-tooltip rules remain on the warning icon');
});

test('VALIDATION-STATUS-UI Editor styling: black at rest, amber on hover / keyboard focus / open, and a CSS-only hint that never overlaps the open panel', () => {
  const rest = mainCss.match(/\.tp3d-editor-validation-status__btn\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rest, /position:\s*absolute;/, 'anchored in the corner without the generic [data-tooltip] override');
  assert.match(rest, /width:\s*32px;[\s\S]*height:\s*32px;/, 'same general scale as the removed info icon');
  assert.match(rest, /color:\s*var\(--text-primary\);/, 'RESTING: normal primary text colour, not amber');
  assert.doesNotMatch(rest, /--warning|#f59e0b|rgb\(245/i, 'no permanent amber at rest');
  assert.match(rest, /background:\s*var\(--bg-elevated\);/, 'no heavy warning fill');

  const active = mainCss.match(/\.tp3d-editor-validation-status__btn:hover,\s*\.tp3d-editor-validation-status__btn:focus-visible,\s*\.tp3d-editor-validation-status__btn\[aria-expanded='true'\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(active, /color:\s*var\(--warning, #f59e0b\);/, 'HOVER / FOCUS-VISIBLE / OPEN: amber via the existing warning token');
  assert.match(active, /border-color:\s*var\(--warning, #f59e0b\);/);
  assert.match(mainCss, /\.tp3d-editor-validation-status__btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-primary\);/, 'a clear keyboard focus treatment is preserved');

  // Hint card: hidden until hover/focus, capped to the canvas, revealed only while the panel is NOT open.
  const hintCss = mainCss.match(/\.tp3d-editor-validation-status \.tp3d-editor-validation-hint\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(hintCss, /position:\s*absolute;/);
  assert.match(hintCss, /visibility:\s*hidden;/);
  assert.match(hintCss, /max-width:\s*min\(220px, calc\(100cqw - 28px\)\);/, 'capped to the canvas width');
  assert.match(mainCss, /\.tp3d-editor-validation-status__btn:is\(:hover, :focus-visible\):not\(\[aria-expanded='true'\]\) ~ \.tp3d-editor-validation-hint\s*\{\s*visibility:\s*visible;/,
    'shown on hover/focus, never while the action panel is open');
  // Pure CSS: the Editor keeps no JS state for the hint (nothing to leak, nothing to conflict with the panel).
  assert.doesNotMatch(editorSource, /editor-validation-hint/);
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
  const ev = {
    type,
    target: el,
    stopped: false,
    defaultPrevented: false,
    stopPropagation() { this.stopped = true; },
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  };
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
  const autoPackBtn = makeStatusEl(doc, 'autopack');
  const leftBtn = makeStatusEl(doc, 'left');
  const rightBtn = makeStatusEl(doc, 'right');
  for (const btn of [autoPackBtn, leftBtn, rightBtn]) {
    btn.hidden = false;
    btn.disabled = false;
  }
  const toasts = [];
  const calls = { validate: [], render: 0 };
  const busy = { value: false };
  const spyLibrary = { ...PackLibrary, validateLoadPlan: (...args) => { calls.validate.push(args); return PackLibrary.validateLoadPlan(...args); } };
  let api;
  const ctx = {
    document: doc, Node: StatusFakeNode, StateStore, CaseLibrary, PackLibrary: spyLibrary,
    UIComponents: { showToast: (message, tone) => toasts.push({ message, tone }) },
    editorMutationBlocked: () => busy.value,
    render: () => {
      calls.render += 1;
      api.renderHandlingRulesStatus(spyLibrary.getById(StateStore.get('currentPackId')));
    },
    btnAutopack: autoPackBtn, btnLeft: leftBtn, btnRight: rightBtn,
    validationStatusEl: status, validationStatusBtn: statusBtn, validationPopoverEl: popover, handlingRulesValidateBtn: validateBtn,
  };
  api = runInNewContext(
    `(function () {\n${statusRegion().all}\nreturn { renderHandlingRulesStatus, setValidationPopoverOpen, isOpen: () => validationPopoverOpen };\n})()`,
    ctx
  );
  return { doc, api, status, statusBtn, popover, validateBtn, autoPackBtn, leftBtn, rightBtn, toasts, calls, busy, spyLibrary, ctx };
}

function runEditorRenderGate(StateStore, setValidationPopoverOpen) {
  const marker = '    function render() {';
  const from = editorSource.indexOf(marker);
  const to = editorSource.indexOf('      ensureScene();', from);
  assert.ok(from >= 0 && to > from);
  const gate = editorSource.slice(from + marker.length, to);
  return runInNewContext(`(function () {${gate}\nreturn true;\n})()`, { StateStore, setValidationPopoverOpen });
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
  m.doc.activeElement = m.validateBtn;

  fireOn(m.validateBtn, 'click');
  assert.equal(m.calls.validate.length, 1, 'exactly one validation, through the existing PackLibrary.validateLoadPlan');
  assert.deepEqual(m.calls.validate[0], ['pack-active', mods.CaseLibrary.getCases()]);
  assert.equal(m.calls.render, 1, 'the existing handler re-renders');
  assert.equal(m.api.isOpen(), false, 'the panel closes as soon as the explicit action is taken');
  assert.deepEqual(m.toasts, [{ message: 'Load Plan validated. No cargo changes were needed.', tone: 'success' }]);

  const after = mods.PackLibrary.getById('pack-active');
  assert.equal(mods.PackLibrary.isHandlingRulesValidationRequired(after, [caseA]), false, 'the real authority now reports current');
  assert.equal(m.status.hidden, true, 'status disappears once the Pack is current');
  assert.equal(m.doc.activeElement, m.autoPackBtn, 'successful validation moves focus to the visible AutoPack toolbar action');
  assert.equal(m.status.contains(m.doc.activeElement), false, 'focus never remains inside the hidden validation status');
});

test('VALIDATION-STATUS-UI Editor: incomplete validation closes the panel and returns focus to the still-visible warning', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  m.ctx.PackLibrary.validateLoadPlan = () => ({ validationComplete: false, summary: {} });
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  fireOn(m.statusBtn, 'click');
  m.doc.activeElement = m.validateBtn;

  fireOn(m.validateBtn, 'click');

  assert.equal(m.api.isOpen(), false);
  assert.equal(m.status.hidden, false, 'incomplete validation leaves the stale warning visible');
  assert.equal(m.doc.activeElement, m.statusBtn, 'focus returns only after the warning is known to remain visible');
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

test('VALIDATION-STATUS-UI Editor: leaving through the normal screen-render flow closes the panel and removes document listeners', async () => {
  const mods = await freshModules();
  initFixture(mods.StateStore, mkCase(), stalePackFixture());
  const m = mountEditorStatus(mods);
  m.api.renderHandlingRulesStatus(mods.PackLibrary.getById('pack-active'));
  fireOn(m.statusBtn, 'click');
  m.doc.activeElement = m.validateBtn;
  assert.equal(m.doc.listeners.length, 2);

  mods.StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
  runEditorRenderGate(mods.StateStore, m.api.setValidationPopoverOpen);

  assert.equal(m.api.isOpen(), false, 'render closes the panel before returning outside Editor');
  assert.equal(m.popover.hidden, true);
  assert.equal(m.doc.listeners.length, 0, 'both document capture listeners are removed immediately');
  const esc = fireOnDocument(m.doc, 'keydown', { key: 'Escape' });
  assert.equal(esc.stopped, false, 'Escape on another screen is not intercepted by stale Editor listeners');

  mods.StateStore.set({ currentScreen: 'editor' }, { skipHistory: true });
  assert.equal(m.api.isOpen(), false, 're-entering Editor begins with the panel closed');
  assert.equal(m.doc.listeners.length, 0, 're-entry does not accumulate document listeners');

  const screenRenderFlow = appSource.slice(
    appSource.indexOf('if (changes.currentScreen || changes._replace) {'),
    appSource.indexOf('if (changes.caseLibrary || changes.packLibrary', appSource.indexOf('if (changes.currentScreen || changes._replace) {'))
  );
  assert.match(screenRenderFlow, /AppShell\.renderShell\(\);\s*EditorUI\.render\(\);/,
    'every currentScreen notification invokes the Editor render gate, including navigation away');
});

// Extracts the exact production Load Plans status-icon + shared floating-card source.
function packStatusRegion() {
  const from = packsSource.indexOf("const PACK_STATUS_CARD_ID = 'tp3d-pack-status-card';");
  const to = packsSource.indexOf('function createPackNotesButton(', from);
  assert.ok(from >= 0 && to > from);
  return packsSource.slice(from, to);
}

function packScreenChangeCleanupRegion() {
  const from = packsSource.indexOf('function initToolbarDropdownCoordinator()');
  const to = packsSource.indexOf('\n    function applyFiltersVisibility()', from);
  assert.ok(from >= 0 && to > from);
  return packsSource.slice(from, to);
}

// Mounts that REAL source against a small fake DOM/window (viewport vw x vh, 186x56 card).
function mountPackStatus({ vw = 1000, vh = 800, stateStore = null } = {}) {
  const body = { children: [], appendChild(el) { this.children.push(el); el.isConnected = true; } };
  const win = {
    listeners: [],
    addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture: Boolean(capture) }); },
    removeEventListener(type, fn, capture) {
      this.listeners = this.listeners.filter(l => !(l.type === type && l.fn === fn && l.capture === Boolean(capture)));
    },
  };
  const makeEl = () => {
    const el = {
      attrs: {}, listeners: {}, className: '', tabIndex: -1, innerHTML: '', id: '', style: {}, isConnected: true,
      classes: new Set(), rect: { left: 0, top: 0, right: 0, bottom: 0 }, offsetWidth: 186, offsetHeight: 56,
    };
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
    el.addEventListener = (type, fn) => { (el.listeners[type] ||= []).push(fn); };
    el.classList = { add: c => el.classes.add(c), remove: c => el.classes.delete(c), contains: c => el.classes.has(c) };
    el.getBoundingClientRect = () => el.rect;
    return el;
  };
  const document = {
    createElement: makeEl,
    body,
    documentElement: { clientWidth: vw, clientHeight: vh },
    getElementById: id => body.children.find(el => el.id === id) || null,
  };
  let dropdownCloseCount = 0;
  const UIComponents = {
    registerDropdownSurface() {},
    closeAllDropdowns() { dropdownCloseCount += 1; },
  };
  const PreferencesManager = { get: () => ({ packsFiltersVisible: false }) };
  const screenCleanup = stateStore
    ? `
let toolbarDropdownCoordinatorInitialized = false;
const btnFiltersToggle = null;
function setFiltersVisible() {}
${packScreenChangeCleanupRegion()}
initToolbarDropdownCoordinator();`
    : '';
  const api = runInNewContext(
    `(function () {\n${packStatusRegion()}\n${screenCleanup}\nreturn { createPackValidationStatus, hidePackStatusCard, current: () => packStatusCardAnchor };\n})()`,
    { document, window: win, StateStore: stateStore, UIComponents, PreferencesManager }
  );
  const place = (el, left, top, w = 28, h = 28) => { el.rect = { left, top, right: left + w, bottom: top + h }; return el; };
  const card = () => body.children.find(el => el.id === 'tp3d-pack-status-card');
  return {
    api, body, win, card, place,
    visible: () => Boolean(card() && card().classes.has('is-visible')),
    windowListeners: () => win.listeners.map(l => `${l.type}:${l.capture}`).sort(),
    dropdownCloseCount: () => dropdownCloseCount,
  };
}

test('VALIDATION-STATUS-UI Load Plans: the status icon uses the new accessible name, has NO generic tooltip, and stays contained (click and keyboard)', () => {
  const m = mountPackStatus();
  for (const [opts, expectedClass] of [[undefined, 'tp3d-validation-status'], [{ inline: true }, 'tp3d-validation-status tp3d-validation-status--inline']]) {
    const el = m.api.createPackValidationStatus(opts);
    assert.equal(el.className, expectedClass);
    assert.equal(el.attrs['aria-label'], 'Load plan needs review');
    assert.equal('data-tooltip' in el.attrs, false, 'the generic black tooltip is not used');
    assert.equal('title' in el.attrs, false, 'no native title tooltip either');
    assert.equal(el.attrs['aria-describedby'], 'tp3d-pack-status-card-body', 'the short card body is the accessible description');
    assert.equal(el.attrs.role, 'img', 'a status, not a button');
    assert.equal(el.attrs['data-pack-status'], 'validation');
    assert.equal(el.tabIndex, 0, 'focusable so the card is reachable by keyboard');
    assert.match(el.innerHTML, /fa-triangle-exclamation/);
    assert.match(el.innerHTML, /aria-hidden="true"/);
    // Neither a click nor Enter/Space can reach the card/row handlers (open, select, Notes, overflow).
    assert.equal(el.listeners.click.length, 1);
    assert.equal(fireOn(el, 'click').stopped, true, 'click must stop propagation');
    assert.equal(el.listeners.keydown.length, 1);
    for (const key of ['Enter', ' ']) {
      const ev = fireOn(el, 'keydown', { key });
      assert.equal(ev.stopped, true, `${JSON.stringify(key)} must stop propagation`);
      assert.equal(ev.defaultPrevented, true, `${JSON.stringify(key)} must prevent default`);
    }
    const tab = fireOn(el, 'keydown', { key: 'Tab' });
    assert.equal(tab.defaultPrevented, false, 'Tab keeps its native focus-navigation behavior');
    assert.equal(tab.stopped, true, 'the status remains contained inside its row/card');
    assert.equal(m.visible(), false, 'keyboard containment never opens or mutates the status card');
    assert.equal(el.listeners.click.length + el.listeners.keydown.length, 2, 'and it performs no action of its own');
  }
});

test('VALIDATION-STATUS-UI Load Plans: ONE shared informational card — created once, body-level, exact short copy, no action', () => {
  const m = mountPackStatus();
  const icons = [m.api.createPackValidationStatus(), m.api.createPackValidationStatus({ inline: true }), m.api.createPackValidationStatus()];
  assert.equal(m.body.children.length, 1, 'many icons share a single card element');
  const card = m.card();
  assert.match(card.className, /tp3d-status-card tp3d-status-card--floating/);
  assert.equal(card.attrs.role, 'tooltip');
  assert.match(card.innerHTML, /class="tp3d-status-card__title">Load plan needs review</);
  assert.match(card.innerHTML, /id="tp3d-pack-status-card-body">Loading rules have changed\.</);
  assert.doesNotMatch(card.innerHTML, /<button|<a\b|<input|Check Load Plan|validat/i, 'informational only — no action and no technical wording');
  assert.equal(card.classes.has('is-visible'), false, 'hidden until hover/focus');
  assert.equal(m.win.listeners.length, 0, 'no document/window listeners exist while the card is hidden');
  assert.ok(icons.every(i => i.attrs['aria-describedby'] === 'tp3d-pack-status-card-body'));
});

test('VALIDATION-STATUS-UI Load Plans: hover or keyboard focus shows the ONE card; leave/blur hides it; a mouse-click focus never pins it; another icon is never hidden by a late event', () => {
  const m = mountPackStatus();
  const a = m.place(m.api.createPackValidationStatus(), 500, 300);

  fireOn(a, 'pointerenter');
  assert.equal(m.visible(), true, 'hover shows the card');
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), false, 'pointer leave hides it');

  fireOn(a, 'focus');
  assert.equal(m.visible(), true, 'keyboard focus shows the card');
  fireOn(a, 'blur');
  assert.equal(m.visible(), false, 'blur hides it');

  // Hover + focus together: still one card and one pair of listeners; it stays while either holds.
  fireOn(a, 'focus');
  fireOn(a, 'pointerenter');
  assert.equal(m.body.children.length, 1, 'never a duplicate card');
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true'], 'listeners registered exactly once');
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), true, 'still keyboard-focused');
  fireOn(a, 'blur');
  assert.equal(m.visible(), false);
  assert.equal(m.win.listeners.length, 0);

  // A mouse press also focuses the icon; that focus must not keep the card up once the pointer leaves.
  fireOn(a, 'pointerdown', { pointerType: 'mouse' });
  fireOn(a, 'pointerenter');
  fireOn(a, 'focus');
  assert.equal(m.visible(), true);
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), false, 'a click-focus does not pin the card');
  fireOn(a, 'blur');

  // A mouse press while already focused must not poison the next keyboard focus.
  fireOn(a, 'focus');
  fireOn(a, 'pointerdown', { pointerType: 'mouse' });
  fireOn(a, 'blur');
  fireOn(a, 'focus');
  assert.equal(m.visible(), true, 'blur clears stale mouse classification before the next keyboard focus');
  fireOn(a, 'blur');

  // Touch has no hover: the press focus keeps the card until blur.
  fireOn(a, 'pointerenter', { pointerType: 'touch' });
  fireOn(a, 'pointerdown', { pointerType: 'touch' });
  fireOn(a, 'pointerleave');
  fireOn(a, 'focus');
  assert.equal(m.visible(), true, 'touch focus keeps the card visible');
  fireOn(a, 'blur');
  assert.equal(m.visible(), false);

  // Ownership: a late leave/blur from icon A must not hide the card that icon B now owns.
  const b = m.place(m.api.createPackValidationStatus(), 500, 400);
  fireOn(a, 'pointerenter');
  fireOn(b, 'pointerenter');
  fireOn(a, 'pointerleave');
  assert.equal(m.visible(), true);
  assert.equal(m.api.current(), b);
  fireOn(b, 'pointerleave');
  assert.equal(m.visible(), false);
  assert.equal(m.api.current(), null);
  assert.equal(m.win.listeners.length, 0);
});

test('VALIDATION-STATUS-UI Load Plans: the card follows scroll/resize, hides when the icon leaves the view or the DOM, render() drops it, and listeners never leak', () => {
  const m = mountPackStatus();
  const a = m.place(m.api.createPackValidationStatus(), 500, 300);
  fireOn(a, 'pointerenter');
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true']);

  // The page scrolls: the card follows its icon.
  m.place(a, 500, 250);
  m.win.listeners.find(l => l.type === 'scroll').fn();
  assert.equal(m.card().style.top, `${250 - 6 - 56}px`);
  assert.equal(m.visible(), true);

  // The icon scrolls out of view: card hidden, listeners removed.
  m.place(a, 500, -100);
  m.win.listeners.find(l => l.type === 'scroll').fn();
  assert.equal(m.visible(), false);
  assert.equal(m.win.listeners.length, 0);
  assert.equal(m.api.current(), null);

  // The icon is removed from the DOM (a re-render) while shown.
  m.place(a, 500, 300);
  fireOn(a, 'pointerenter');
  assert.equal(m.visible(), true);
  a.isConnected = false;
  m.win.listeners.find(l => l.type === 'resize').fn();
  assert.equal(m.visible(), false);
  assert.equal(m.win.listeners.length, 0);

  // render() calls hidePackStatusCard() with no anchor: drops the card whoever owns it; a no-op when hidden.
  a.isConnected = true;
  m.api.hidePackStatusCard();
  for (let i = 0; i < 5; i += 1) {
    fireOn(a, 'pointerenter');
    fireOn(a, 'pointerleave');
    fireOn(a, 'pointerenter');
    assert.equal(m.win.listeners.length, 2, 'exactly one pair while shown');
    m.api.hidePackStatusCard();
    assert.equal(m.visible(), false);
    assert.equal(m.win.listeners.length, 0);
  }
  assert.match(packsSource, /function render\(modeOverride\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*hidePackStatusCard\(\);/,
    'the rebuild replaces every icon, so render() drops the shared card first');
});

test('VALIDATION-STATUS-UI Load Plans: screen changes hide the card, clear its anchor, and remove listeners without accumulation', async () => {
  const StateStore = await import(`${stateStorePath.href}?packs-status-exit=${Date.now()}-${Math.random()}`);
  StateStore.init({
    currentScreen: 'packs', currentPackId: null, selectedInstanceIds: [],
    caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {},
  });
  const m = mountPackStatus({ stateStore: StateStore });
  const status = m.place(m.api.createPackValidationStatus(), 500, 300);

  fireOn(status, 'pointerenter');
  assert.equal(m.visible(), true);
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true']);

  StateStore.set({ currentScreen: 'editor' }, { skipHistory: true });
  assert.equal(m.dropdownCloseCount(), 1, 'the existing screen-change cleanup still closes dropdowns');
  assert.equal(m.visible(), false, 'leaving Load Plans hides the body-level card');
  assert.equal(m.api.current(), null, 'screen exit clears the shared card anchor');
  assert.deepEqual(m.windowListeners(), [], 'screen exit removes both temporary window listeners');

  StateStore.set({ currentScreen: 'packs' }, { skipHistory: true });
  assert.equal(m.visible(), false, 're-entering Load Plans begins with the card closed');
  assert.deepEqual(m.windowListeners(), []);
  fireOn(status, 'pointerleave');
  fireOn(status, 'pointerenter');
  assert.equal(m.visible(), true, 'the status card still opens normally after re-entry');
  assert.deepEqual(m.windowListeners(), ['resize:false', 'scroll:true'], 're-entry registers only one listener pair');

  StateStore.set({ currentScreen: 'cases' }, { skipHistory: true });
  assert.equal(m.visible(), false);
  assert.equal(m.api.current(), null);
  assert.deepEqual(m.windowListeners(), [], 'a later exit removes the pair again without accumulation');
});

test('VALIDATION-STATUS-UI Load Plans: the card sits above the icon (Grid end-aligned, List start-aligned), flips below only without room, and stays inside the viewport', () => {
  const m = mountPackStatus({ vw: 1000, vh: 800 });
  const grid = m.place(m.api.createPackValidationStatus(), 500, 300);
  const list = m.place(m.api.createPackValidationStatus({ inline: true }), 500, 300);

  fireOn(grid, 'pointerenter');
  assert.equal(m.card().style.top, `${300 - 6 - 56}px`, 'above the icon, not over the metadata below it');
  assert.equal(m.card().style.left, `${528 - 186}px`, 'Grid: the card ends at the icon so it stays inside the Load Plan card');
  fireOn(grid, 'pointerleave');
  fireOn(list, 'pointerenter');
  assert.equal(m.card().style.top, `${300 - 6 - 56}px`);
  assert.equal(m.card().style.left, '500px', 'List: the card starts at the icon so the row above keeps its title uncovered');
  fireOn(list, 'pointerleave');

  m.place(grid, 500, 40);
  fireOn(grid, 'pointerenter');
  assert.equal(m.card().style.top, `${40 + 28 + 6}px`, 'no room above: flips below');
  fireOn(grid, 'pointerleave');

  m.place(grid, 20, 300);
  fireOn(grid, 'pointerenter');
  assert.equal(m.card().style.left, '8px', 'never past the left viewport edge');
  fireOn(grid, 'pointerleave');
  m.place(list, 980, 300);
  fireOn(list, 'pointerenter');
  assert.equal(m.card().style.left, `${1000 - 186 - 8}px`, 'never past the right viewport edge');
  fireOn(list, 'pointerleave');

  m.place(grid, 500, 900);
  fireOn(grid, 'pointerenter');
  assert.equal(m.visible(), false, 'an icon below the viewport never shows a floating card');
  assert.equal(m.win.listeners.length, 0);
});

test('VALIDATION-STATUS-UI Load Plans Grid: stale Pack gets the icon between the title and Notes; no chip, no long tooltip; the card ignores it', () => {
  const grid = packsSource.slice(packsSource.indexOf('function renderGridView(packs) {'), packsSource.indexOf('function buildPreview('));
  assert.ok(grid.length > 500);
  assert.doesNotMatch(grid, /badge--warning|validationBadge|Validation required/, 'the old chip is gone from the Grid');
  // P1-C: selection now LEADS the title in the header; only the warning, Notes and overflow trail.
  const cluster = grid.slice(grid.indexOf("actions.className = 'card-head-actions tp3d-management-card-actions'"), grid.indexOf('head.appendChild(selectCb)'));
  const iSel = cluster.indexOf('actions.appendChild(selectCb)');
  const iStatus = cluster.indexOf('actions.appendChild(createPackValidationStatus())');
  const iNotes = cluster.indexOf('actions.appendChild(createPackNotesButton(pack))');
  const iKebab = cluster.indexOf('actions.appendChild(kebabBtn)');
  assert.equal(iSel, -1, 'the checkbox is no longer in the trailing cluster');
  assert.ok(iStatus >= 0 && iStatus < iNotes && iNotes < iKebab, 'trailing order: [ warning ] [ Notes ] [ ⋮ ]');
  const iHeadSel = grid.indexOf('head.appendChild(selectCb)');
  const iHeadTitle = grid.indexOf('head.appendChild(titleWrap)');
  const iHeadActions = grid.indexOf('head.appendChild(actions)');
  assert.ok(iHeadSel >= 0 && iHeadSel < iHeadTitle && iHeadTitle < iHeadActions, 'header order: [ checkbox ] title [ warning / Notes / ⋮ ]');
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

test('VALIDATION-STATUS-UI Scope: old technical copy is gone, the locked copy is present, and there is no Case-level warning', () => {
  const oldCopy = [/Validation required/, /Validate Load Plan/, /Handling Rules changed since this Load Plan was last validated/, /last validated/];
  for (const [name, src] of [['index.html', indexHtml], ['packs-screen.js', packsSource], ['editor-screen.js', editorSource], ['cases-screen.js', casesSource], ['main.css', mainCss]]) {
    for (const re of oldCopy) assert.doesNotMatch(src, re, `${name} must not carry ${re}`);
  }
  assert.doesNotMatch(packsSource, /referenced Case’s Handling Rules/, 'the explanation lives only in the Editor panel');
  assert.doesNotMatch(packStatusRegion(), /['"`]data-tooltip['"`]|data-tooltip=/, 'the Load Plans warning never sets the generic tooltip attribute');

  // Locked new copy.
  assert.equal((indexHtml.match(/Load plan needs review/g) || []).length, 3, 'Editor: icon name, hint title, panel title');
  assert.equal((indexHtml.match(/Loading rules have changed\./g) || []).length, 1);
  assert.equal((indexHtml.match(/Check Load Plan/g) || []).length, 1);
  assert.match(packsSource, /Load plan needs review/);
  assert.match(packsSource, /Loading rules have changed\./);

  // The internal names are NOT renamed by this copy change.
  assert.match(editorSource, /PackLibrary\.validateLoadPlan\(packId, CaseLibrary\.getCases\(\)\)/);
  assert.match(packsSource, /PackLibrary\.isHandlingRulesValidationRequired\(pack, CaseLibrary\.getCases\(\)\)/);
  assert.doesNotMatch(casesSource, /isHandlingRulesValidationRequired|Load plan needs review|createPackValidationStatus|data-pack-status/,
    'no Case-level validation status exists or is implied');
});

test('VALIDATION-STATUS-UI Scope: Load Plans icon is black at rest and amber only on hover/keyboard focus; the shared card is a restrained token-based surface; the global tooltip system is untouched', () => {
  const status = mainCss.match(/\.tp3d-validation-status\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(status, /color:\s*var\(--text-primary\);/, 'RESTING: normal primary text colour, like the Notes / kebab controls');
  assert.doesNotMatch(status, /--warning|#f59e0b/, 'never permanently amber');
  assert.doesNotMatch(status, /\bborder\s*:|background/, 'a compact icon: no chip fill and no border');
  assert.match(mainCss, /\.tp3d-validation-status:hover,\s*\.tp3d-validation-status:focus-visible\s*\{\s*color:\s*var\(--warning, #f59e0b\);\s*\}/,
    'HOVER and FOCUS-VISIBLE: amber via the existing warning token');
  assert.match(mainCss, /\.tp3d-validation-status:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-primary\);/, 'a clear keyboard focus treatment is preserved');
  assert.match(mainCss, /\.tp3d-validation-status--inline\s*\{/);

  const surface = mainCss.match(/\.tp3d-status-card\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(surface, /pointer-events:\s*none;/, 'never captures the pointer');
  for (const token of ['--bg-elevated', '--border-subtle', '--radius-md', '--shadow-md']) {
    assert.match(surface, new RegExp(`var\\(${token}\\)`), `uses the existing ${token} token`);
  }
  const cardCss = mainCss.slice(mainCss.indexOf('.tp3d-status-card {'), mainCss.indexOf('.tp3d-status-card--floating.is-visible'));
  assert.doesNotMatch(cardCss, /#[0-9a-f]{3,8}\b|rgb\(|--danger|--error|red\b/i, 'no hard-coded palette and no red/destructive styling');
  const floating = mainCss.match(/\.tp3d-status-card--floating\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(floating, /position:\s*fixed;/, 'fixed: no scrolling table wrapper or card edge can clip it');
  assert.match(floating, /visibility:\s*hidden;/);
  assert.match(mainCss, /\.tp3d-status-card--floating\.is-visible\s*\{\s*visibility:\s*visible;/);

  // The global tooltip system and the other help icons are untouched.
  assert.match(mainCss, /\[data-tooltip\]::after\s*\{[^}]*content:\s*attr\(data-tooltip\);/);
  assert.match(mainCss, /\.tp3d-editor-info-icon\[data-tooltip\]::after/);
});

// ============================================================================
// CASE-DELETION: PackLibrary.commitCaseDeletion — Load Plan integrity when a
// Case definition (single or bulk) is deleted. Deleted instances must vanish
// from every Pack; remaining cargo that physically depended on removed packed
// cargo must be repaired/staged through the canonical revalidation; and no Pack
// may be left silently "current" after an unvalidated packed change. One
// confirmed deletion is exactly one StateStore.set() / one Undo step.
// ============================================================================

function seedDeletion(StateStore, { cases, packs, currentScreen = 'cases', currentPackId = null, selectedInstanceIds = [] }) {
  StateStore.init({
    currentScreen, currentPackId, selectedInstanceIds,
    caseLibrary: cases, packLibrary: packs, folderLibrary: [], preferences: {},
  });
}

function watchStateWrites(StateStore) {
  const writes = [];
  const off = StateStore.subscribe(changes => writes.push(Object.keys(changes).sort()));
  return { writes, off };
}

function deletionPack(id, cases, extra = {}) {
  return { id, title: id, truck: RECT_TRUCK, cases, lastEdited: 123, stats: {}, ...extra };
}

function assertNoOrphanCaseIds(StateStore, ...deletedIds) {
  const remaining = new Set(StateStore.get('caseLibrary').map(c => c.id));
  for (const pack of StateStore.get('packLibrary')) {
    for (const inst of pack.cases) {
      for (const id of deletedIds) assert.notEqual(inst.caseId, id, `no instance in ${pack.id} may still reference deleted Case ${id}`);
    }
  }
  for (const id of deletedIds) assert.equal(remaining.has(id), false, `Case ${id} must be gone from the Case Library`);
}

// The persisted result must be a fixed point of the canonical validator: nothing
// left to adjust, stage or fail — i.e. no floating / invalid packed cargo.
function assertPersistedPackIsValid(PackLibrary, pack, caseLibrary, message) {
  const again = PackLibrary.revalidateManualPlacements(pack, caseLibrary, { repairDependents: true, preserveStagedPositions: true });
  assert.equal(again.validationComplete, true, `${message}: validation must be complete`);
  assert.deepEqual(again.summary, { adjusted: 0, repaired: 0, staged: 0, failed: 0 }, `${message}: nothing may need further adjustment`);
}

test('CASE-DELETION A: an unused Case is deleted with no Pack change and exactly one atomic write', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a' });
  const caseUnused = mkCase({ id: 'case-unused' });
  const pack = deletionPack('pack-1', [mkInst('a1', 'case-a', { x: 60, y: 5, z: 0 })]);
  seedDeletion(StateStore, { cases: [caseA, caseUnused], packs: [pack] });
  const packsBefore = StateStore.get('packLibrary');
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['case-unused']);
  watch.off();

  assert.deepEqual(result, { deletedCaseIds: ['case-unused'], removedInstanceCount: 0, packImpacts: [] });
  assert.deepEqual(StateStore.get('caseLibrary').map(c => c.id), ['case-a']);
  assert.equal(StateStore.get('packLibrary'), packsBefore, 'the Pack Library must be the very same array — no Pack touched');
  assert.equal(watch.writes.length, 1, 'exactly one StateStore write');
  assert.deepEqual(watch.writes[0], ['caseLibrary']);
});

test('CASE-DELETION A2: an id that is not in the Case Library is a complete no-op (no write, no history)', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseA = mkCase({ id: 'case-a' });
  seedDeletion(StateStore, { cases: [caseA], packs: [deletionPack('pack-1', [mkInst('a1', 'case-a', { x: 60, y: 5, z: 0 })])] });
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['does-not-exist']);
  watch.off();

  assert.deepEqual(result, { deletedCaseIds: [], removedInstanceCount: 0, packImpacts: [] });
  assert.equal(watch.writes.length, 0);
  assert.equal(StateStore.undo(), false, 'no history entry may be created');
});

test('CASE-DELETION B: a staged-only Case is removed without revalidating unrelated packed cargo and the signature is preserved exactly', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const library = [caseS, caseO];
  const other = mkInst('other', 'case-o', { x: 60, y: 5, z: 0 });
  const signature = PackLibrary.buildHandlingRulesValiditySignature({ cases: [other] }, library);
  const pack = deletionPack('pack-b', [
    other,
    mkInst('staged-1', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
    { ...mkInst('staged-hidden', 'case-s', { x: 200, y: 5, z: 20 }, 'staged'), hidden: true },
  ], { handlingRulesValidatedSignature: signature });
  seedDeletion(StateStore, { cases: library, packs: [pack] });
  const before = StateStore.get('packLibrary')[0];

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.deepEqual(after.cases.map(i => i.id), ['other']);
  assert.equal(after.cases[0], before.cases[0], 'unrelated packed cargo must be the identical object (never revalidated/moved)');
  assert.equal(after.handlingRulesValidatedSignature, signature, 'the stored signature is preserved exactly');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false, 'a staged-only deletion must not create a false stale state');
  assert.equal(after.stats.totalCases, 1, 'stats are recomputed against the final Pack');
  assert.ok(after.lastEdited > 123, 'lastEdited is refreshed for a Pack whose cargo changed');
  assert.deepEqual(result.packImpacts, [{ packId: 'pack-b', removedInstanceCount: 2, revalidated: false, validationComplete: null, repositionedCount: 0, stagedCount: 0 }]);
  assertNoOrphanCaseIds(StateStore, 'case-s');
});

test('CASE-DELETION B2: a legacy unsigned Pack affected only by staged instances stays unsigned and is not made stale', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const pack = deletionPack('pack-legacy', [
    mkInst('other', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('staged-1', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [pack] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal('handlingRulesValidatedSignature' in after, false, 'no signature may be invented for a staged-only deletion');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
});

test('CASE-DELETION C: a packed floor item with no dependents is removed, remaining cargo stays valid, and a fresh current signature is persisted', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseF = mkCase({ id: 'case-f' });
  const caseO = mkCase({ id: 'case-o' });
  const library = [caseF, caseO];
  const floorItem = mkInst('floor', 'case-f', { x: 20, y: 5, z: 0 });
  const other = mkInst('other', 'case-o', { x: 60, y: 5, z: 0 });
  const priorSignature = PackLibrary.buildHandlingRulesValiditySignature({ cases: [floorItem, other] }, library);
  seedDeletion(StateStore, { cases: library, packs: [deletionPack('pack-c', [floorItem, other], { handlingRulesValidatedSignature: priorSignature })] });

  const result = PackLibrary.commitCaseDeletion(['case-f']);

  const after = StateStore.get('packLibrary')[0];
  const nextLibrary = StateStore.get('caseLibrary');
  assert.deepEqual(after.cases.map(i => i.id), ['other']);
  assert.equal(after.cases[0].placement, 'packed');
  assert.deepEqual(after.cases[0].transform.position, { x: 60, y: 5, z: 0 }, 'a valid remaining item does not move');
  assert.equal(after.handlingRulesValidatedSignature, PackLibrary.buildHandlingRulesValiditySignature(after, nextLibrary));
  assert.notEqual(after.handlingRulesValidatedSignature, priorSignature, 'the deleted Case no longer contributes to the signature');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, nextLibrary), false);
  assert.equal(after.stats.totalCases, 1);
  assert.ok(after.lastEdited > 123);
  assert.deepEqual(result.packImpacts, [{ packId: 'pack-c', removedInstanceCount: 1, revalidated: true, validationComplete: true, repositionedCount: 0, stagedCount: 0 }]);
});

test('CASE-DELETION D1: deleting a support Case re-settles the dependent above it — never left floating', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const pack = deletionPack('pack-d1', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const top = after.cases.find(i => i.id === 'top');
  assert.equal(after.cases.some(i => i.id === 'base'), false);
  assert.equal(top.placement, 'packed', 'a dependent that can legally settle stays packed');
  assert.equal(top.transform.position.y, 5, 'it drops onto the floor instead of floating at the old stack height (y=15)');
  assertPersistedPackIsValid(PackLibrary, after, StateStore.get('caseLibrary'), 'D1');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
  assert.equal(result.packImpacts[0].repositionedCount, 1);
  assert.equal(result.packImpacts[0].stagedCount, 0);
});

test('CASE-DELETION D2: a dependent that can no longer be legally supported anywhere moves to staging instead of staying packed', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  // 30-long dependent on two 10-long supports (67% >= MIN_SUPPORT_FRACTION 0.5).
  // Deleting one leaves 33%, and the 30-long floor cannot host it beside the survivor.
  const truck = { length: 30, width: 10, height: 30, shapeMode: 'rect' };
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const caseW = mkCase({ id: 'case-w', dimensions: { length: 30, width: 10, height: 10 }, volume: 3000 });
  const pack = { ...deletionPack('pack-d2', [
    mkInst('A', 'case-s', { x: 5, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 15, y: 5, z: 0 }),
    mkInst('D', 'case-w', { x: 15, y: 15, z: 0 }),
  ]), truck };
  seedDeletion(StateStore, { cases: [caseS, caseO, caseW], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const byId = new Map(after.cases.map(i => [i.id, i]));
  assert.equal(byId.has('A'), false);
  assert.equal(byId.get('D').placement, 'staged', 'the unsupportable dependent is staged, never left packed/floating');
  assert.equal(byId.get('B').placement, 'packed', 'unrelated packed cargo stays packed');
  assert.deepEqual(byId.get('B').transform.position, { x: 15, y: 5, z: 0 });
  assertPersistedPackIsValid(PackLibrary, after, StateStore.get('caseLibrary'), 'D2');
  assert.equal(result.packImpacts[0].stagedCount, 1);
  assert.equal(result.packImpacts[0].validationComplete, true);
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false,
    'a completed validation that staged the dependent is a certified, current result');
});

test('CASE-DELETION E1: a legacy UNSIGNED Pack with a deleted packed instance receives a fresh signature once whole-Pack validation completes', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const pack = deletionPack('pack-e1', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  assert.equal('handlingRulesValidatedSignature' in pack, false, 'fixture is legacy/unsigned');
  seedDeletion(StateStore, { cases: [caseS, caseT], packs: [pack] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal(after.handlingRulesValidatedSignature, PackLibrary.buildHandlingRulesValiditySignature(after, StateStore.get('caseLibrary')));
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), false);
});

test('CASE-DELETION E2: a legacy UNSIGNED Pack whose validation is incomplete cannot look current', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  // 'ghost' is a packed instance whose Case definition is already missing: the
  // whole-Pack validation can never complete.
  const pack = deletionPack('pack-e2', [
    mkInst('A', 'case-s', { x: 20, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('ghost', 'case-missing', { x: 90, y: 5, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal(result.packImpacts[0].validationComplete, false);
  assert.equal(after.handlingRulesValidatedSignature, 'v1:incomplete', 'uses the existing non-current marker');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), true,
    'the Pack must report review required');
  assert.deepEqual(after.cases.map(i => i.id), ['B', 'ghost'], 'the safest result is still committed: deleted instance gone, the rest preserved');
  assertNoOrphanCaseIds(StateStore, 'case-s');
});

test('CASE-DELETION F: an already-signed Pack gets its signature re-stamped against the next Case Library', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const library = [caseS, caseT];
  const base = mkInst('base', 'case-s', { x: 60, y: 5, z: 0 });
  const top = mkInst('top', 'case-t', { x: 60, y: 15, z: 0 });
  const priorSignature = PackLibrary.buildHandlingRulesValiditySignature({ cases: [base, top] }, library);
  seedDeletion(StateStore, { cases: library, packs: [deletionPack('pack-f', [base, top], { handlingRulesValidatedSignature: priorSignature })] });
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(StateStore.get('packLibrary')[0], library), false, 'fixture starts current');

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const nextLibrary = StateStore.get('caseLibrary');
  assert.notEqual(after.handlingRulesValidatedSignature, priorSignature);
  assert.equal(after.handlingRulesValidatedSignature, PackLibrary.buildHandlingRulesValiditySignature(after, nextLibrary));
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, nextLibrary), false);
});

test('CASE-DELETION G: one Case in several Load Plans — every affected Pack is processed, the unaffected Pack is the identical object, no orphan ids remain', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const packedPack = deletionPack('pack-packed', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  const stagedPack = deletionPack('pack-staged', [
    mkInst('o', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('s-staged', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
  ]);
  const untouchedPack = deletionPack('pack-untouched', [mkInst('u', 'case-o', { x: 30, y: 5, z: 0 })]);
  seedDeletion(StateStore, { cases: [caseS, caseT, caseO], packs: [packedPack, stagedPack, untouchedPack] });
  const before = StateStore.get('packLibrary');
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['case-s']);
  watch.off();

  const after = StateStore.get('packLibrary');
  assert.equal(after[2], before[2], 'a Pack without the Case is returned as the identical object');
  assert.equal(after[2].lastEdited, 123, 'no timestamp churn for an unaffected Pack');
  assert.ok(after[0].lastEdited > 123 && after[1].lastEdited > 123, 'both affected Packs are updated');
  assert.equal(after[0].cases.find(i => i.id === 'top').transform.position.y, 5);
  assert.deepEqual(after[1].cases.map(i => i.id), ['o']);
  assert.deepEqual(result.packImpacts.map(i => i.packId), ['pack-packed', 'pack-staged']);
  assert.equal(result.removedInstanceCount, 2);
  assertNoOrphanCaseIds(StateStore, 'case-s');
  assert.equal(watch.writes.length, 1, 'all Packs + the Case Library publish in a single write');
});

test('CASE-DELETION G2: bulk deletion of several Cases is one write and revalidates against the FINAL Case Library', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const caseT = mkCase({ id: 'case-t' });
  const pack = deletionPack('pack-bulk', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
    mkInst('o1', 'case-o', { x: 20, y: 5, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseO, caseT], packs: [pack] });
  const watch = watchStateWrites(StateStore);

  const result = PackLibrary.commitCaseDeletion(['case-s', 'case-o']);
  watch.off();

  const after = StateStore.get('packLibrary')[0];
  assert.deepEqual(result.deletedCaseIds, ['case-s', 'case-o']);
  assert.deepEqual(StateStore.get('caseLibrary').map(c => c.id), ['case-t']);
  assert.deepEqual(after.cases.map(i => i.id), ['top']);
  assert.equal(after.cases[0].transform.position.y, 5);
  assert.equal(after.handlingRulesValidatedSignature, PackLibrary.buildHandlingRulesValiditySignature(after, StateStore.get('caseLibrary')));
  assert.equal(result.packImpacts.length, 1, 'a Pack hit by several deleted Cases is revalidated once, not once per Case');
  assertNoOrphanCaseIds(StateStore, 'case-s', 'case-o');
  assert.equal(watch.writes.length, 1);
});

test('CASE-DELETION H: packed + staged + hidden + grouped target instances all go; only the physical packed impact drives repair; other groups are left alone', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const pack = deletionPack('pack-h', [
    mkInst('s-packed', 'case-s', { x: 60, y: 5, z: 0 }),
    { ...mkInst('s-hidden-packed', 'case-s', { x: 20, y: 5, z: 0 }), hidden: true },
    mkInst('s-staged', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
    { ...mkInst('s-staged-hidden', 'case-s', { x: 200, y: 5, z: 20 }, 'staged'), hidden: true },
    { ...mkInst('s-staged-grouped', 'case-s', { x: 200, y: 5, z: -20 }, 'staged'), groupId: 'g1' },
    mkInst('dependent', 'case-t', { x: 60, y: 15, z: 0 }),
    { ...mkInst('keeper', 'case-o', { x: 200, y: 5, z: 40 }, 'staged'), groupId: 'g1' },
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT, caseO], packs: [pack] });

  const result = PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const byId = new Map(after.cases.map(i => [i.id, i]));
  assert.deepEqual([...byId.keys()].sort(), ['dependent', 'keeper']);
  assert.equal(byId.get('dependent').placement, 'packed');
  assert.equal(byId.get('dependent').transform.position.y, 5, 'the dependent above the packed target settles');
  assert.equal(byId.get('keeper').groupId, 'g1', 'groupId is instance-local: a surviving group member is untouched (no group registry to clean)');
  assert.equal(result.packImpacts[0].removedInstanceCount, 5);
  assert.equal(result.packImpacts[0].revalidated, true, 'a physical (packed/hidden-packed) target instance triggers whole-Pack revalidation');
  assertNoOrphanCaseIds(StateStore, 'case-s');
  assertPersistedPackIsValid(PackLibrary, after, StateStore.get('caseLibrary'), 'H');
});

test('CASE-DELETION I: one deletion is one history action — Undo restores Case + Pack effects together, Redo re-applies them', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const packedPack = deletionPack('pack-i1', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ], { handlingRulesValidatedSignature: 'v1:case-s:any:1:0:0|case-t:any:1:0:0' });
  const stagedPack = deletionPack('pack-i2', [
    mkInst('o', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('s-staged', 'case-s', { x: 200, y: 5, z: 0 }, 'staged'),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT, caseO], packs: [packedPack, stagedPack] });
  const beforeCases = StateStore.get('caseLibrary');
  const beforePacks = StateStore.get('packLibrary');

  PackLibrary.commitCaseDeletion(['case-s']);
  const afterCases = StateStore.get('caseLibrary');
  const afterPacks = StateStore.get('packLibrary');
  assert.notDeepEqual(afterCases, beforeCases);
  assert.notDeepEqual(afterPacks, beforePacks);

  assert.equal(StateStore.undo(), true, 'a single Undo reverts the whole deletion');
  assert.deepEqual(StateStore.get('caseLibrary'), beforeCases, 'Undo restores the deleted Case');
  assert.deepEqual(StateStore.get('packLibrary'), beforePacks, 'Undo restores removed instances, repaired/staged cargo, signatures, stats and timestamps together');
  assert.equal(StateStore.undo(), false, 'there is no second history entry to undo');

  assert.equal(StateStore.redo(), true);
  assert.deepEqual(StateStore.get('caseLibrary'), afterCases, 'Redo re-applies the Case deletion');
  assert.deepEqual(StateStore.get('packLibrary'), afterPacks, 'Redo re-applies the identical final Pack state');
  assert.equal(StateStore.redo(), false);
});

test('CASE-DELETION J1: incomplete validation with a previously-current signature keeps a signature that cannot equal the current one', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const library = [caseS, caseO];
  const cases = [
    mkInst('A', 'case-s', { x: 20, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('ghost', 'case-missing', { x: 90, y: 5, z: 0 }),
  ];
  const priorSignature = PackLibrary.buildHandlingRulesValiditySignature({ cases }, library);
  seedDeletion(StateStore, { cases: library, packs: [deletionPack('pack-j1', cases, { handlingRulesValidatedSignature: priorSignature })] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  const nextLibrary = StateStore.get('caseLibrary');
  assert.notEqual(after.handlingRulesValidatedSignature, PackLibrary.buildHandlingRulesValiditySignature(after, nextLibrary));
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, nextLibrary), true, 'never stamped current after an unresolved validation');
});

test('CASE-DELETION J2: incomplete validation whose stored signature coincidentally equals the new one is downgraded to the non-current marker', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const nextLibrary = [caseO];
  const cases = [
    mkInst('A', 'case-s', { x: 20, y: 5, z: 0 }),
    mkInst('B', 'case-o', { x: 60, y: 5, z: 0 }),
    mkInst('ghost', 'case-missing', { x: 90, y: 5, z: 0 }),
  ];
  const coincidental = PackLibrary.buildHandlingRulesValiditySignature({ cases: cases.filter(i => i.id !== 'A') }, nextLibrary);
  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [deletionPack('pack-j2', cases, { handlingRulesValidatedSignature: coincidental })] });

  PackLibrary.commitCaseDeletion(['case-s']);

  const after = StateStore.get('packLibrary')[0];
  assert.equal(after.handlingRulesValidatedSignature, 'v1:incomplete');
  assert.equal(PackLibrary.isHandlingRulesValidationRequired(after, StateStore.get('caseLibrary')), true);
});

test('CASE-DELETION L: preparation failure publishes nothing — no partial Case deletion, no Pack mutated beforehand, no history entry', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const good = deletionPack('pack-good', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
  ]);
  seedDeletion(StateStore, { cases: [caseS, caseT], packs: [good] });
  // Second Pack throws when its instance is inspected — AFTER the first Pack has
  // already been fully prepared (Packs are prepared in order).
  const poisoned = mkInst('poison', 'case-t', { x: 60, y: 5, z: 0 });
  Object.defineProperty(poisoned, 'caseId', { enumerable: true, get() { throw new Error('boom'); } });
  StateStore.set({ packLibrary: [...StateStore.get('packLibrary'), deletionPack('pack-poison', [poisoned])] }, { skipHistory: true, skipNotify: true });
  const casesBefore = StateStore.get('caseLibrary');
  const packsBefore = StateStore.get('packLibrary');
  const watch = watchStateWrites(StateStore);

  assert.throws(() => PackLibrary.commitCaseDeletion(['case-s']), /boom/);
  watch.off();

  assert.equal(StateStore.get('caseLibrary'), casesBefore, 'the Case Library is untouched');
  assert.equal(StateStore.get('packLibrary'), packsBefore, 'the Pack Library is untouched');
  assert.equal(packsBefore[0].cases.length, 2, 'the already-prepared first Pack was never published');
  assert.equal(watch.writes.length, 0, 'nothing was published');
  assert.equal(StateStore.undo(), false, 'no history entry was created');
});

test('CASE-DELETION K1: deleted instances are pruned from the open Pack selection inside the same write; surviving ids (even repaired/staged ones) stay selected', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseT = mkCase({ id: 'case-t' });
  const caseO = mkCase({ id: 'case-o' });
  const pack = deletionPack('pack-k', [
    mkInst('base', 'case-s', { x: 60, y: 5, z: 0 }),
    mkInst('top', 'case-t', { x: 60, y: 15, z: 0 }),
    mkInst('keep', 'case-o', { x: 20, y: 5, z: 0 }),
  ]);
  seedDeletion(StateStore, {
    cases: [caseS, caseT, caseO], packs: [pack],
    currentPackId: 'pack-k', selectedInstanceIds: ['base', 'top', 'keep'],
  });
  const watch = watchStateWrites(StateStore);

  PackLibrary.commitCaseDeletion(['case-s']);
  watch.off();

  assert.deepEqual(StateStore.get('selectedInstanceIds'), ['top', 'keep'], 'only the removed id is pruned; unrelated selection is preserved in order');
  assert.equal(watch.writes.length, 1, 'selection pruning rides the same single write');
  assert.deepEqual(watch.writes[0], ['caseLibrary', 'packLibrary', 'selectedInstanceIds']);
  assert.equal(StateStore.undo(), true);
  assert.equal(StateStore.undo(), false, 'selection is transient and adds no history entry');
});

test('CASE-DELETION K2: selection is left exactly as-is when it does not reference removed instances, or when no Pack is open', async () => {
  const { StateStore, PackLibrary } = await freshModules();
  const caseS = mkCase({ id: 'case-s' });
  const caseO = mkCase({ id: 'case-o' });
  const openPack = deletionPack('pack-open', [mkInst('o1', 'case-o', { x: 20, y: 5, z: 0 })]);
  const otherPack = deletionPack('pack-other', [mkInst('s1', 'case-s', { x: 60, y: 5, z: 0 })]);

  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [openPack, otherPack], currentPackId: 'pack-open', selectedInstanceIds: ['o1'] });
  const selectionBefore = StateStore.get('selectedInstanceIds');
  PackLibrary.commitCaseDeletion(['case-s']);
  assert.equal(StateStore.get('selectedInstanceIds'), selectionBefore, 'open Pack unaffected: selection is the identical array');

  seedDeletion(StateStore, { cases: [caseS, caseO], packs: [openPack, otherPack], currentPackId: null, selectedInstanceIds: ['s1'] });
  PackLibrary.commitCaseDeletion(['case-s']);
  assert.deepEqual(StateStore.get('selectedInstanceIds'), ['s1'], 'with no open Pack there is nothing to prune against');
});

test('CASE-DELETION UI: both Cases-screen delete paths delegate to the single orchestration, keep the toast, and warn about dependent cargo', () => {
  const single = casesSource.slice(casesSource.indexOf('async function deleteCase(caseId) {'), casesSource.indexOf('// Import Cases dialog extracted'));
  const bulk = casesSource.slice(casesSource.indexOf('async function bulkDeleteSelected() {'), casesSource.indexOf('function initTableHeaders() {'));
  assert.ok(single.length > 200 && bulk.length > 200);
  assert.match(single, /try\s*\{\s*result = PackLibrary\.commitCaseDeletion\(\[caseId\]\)/, 'single delete calls commitCaseDeletion inside try/catch');
  assert.match(bulk, /try\s*\{\s*result = PackLibrary\.commitCaseDeletion\(ids\)/, 'bulk delete calls commitCaseDeletion inside try/catch');
  for (const body of [single, bulk]) {
    assert.doesNotMatch(body, /StateStore\.set|computeStats|nextPackLibrary/, 'no ad-hoc per-screen Pack rebuilding remains');
  }
  assert.match(single, /Deleting it will remove those items\. Cargo that depended on them for support may be repositioned or moved to staging\./);
  assert.match(single, /UIComponents\.showToast\('Case deleted', 'info'\)/);
});

// --- Behavioral harness: execute the exact production deleteCase/bulkDeleteSelected
// closures (via vm.runInNewContext, same technique as HANDLING-RULES-P0A above) against
// mocked dependencies, so failure/no-op/success feedback is proven at runtime rather
// than only by source-text regex. ---
function makeToastSpy() {
  const calls = [];
  return { calls, showToast: (message, type) => calls.push({ message, type }) };
}

function buildDeleteCase({ caseData = { id: 'case-1', name: 'Case A' }, packs = [], confirmResult = true, mutationBlocked = false, commitCaseDeletion }) {
  const toast = makeToastSpy();
  const errors = [];
  const src = casesSource.slice(casesSource.indexOf('async function deleteCase(caseId) {'), casesSource.indexOf('// Import Cases dialog extracted')).trim();
  const context = {
    CaseLibrary: { getById: () => caseData },
    PackLibrary: { getPacks: () => packs, commitCaseDeletion },
    UIComponents: { confirm: async () => confirmResult, showToast: toast.showToast },
    mutationBlockedWhileBusy: () => mutationBlocked,
    console: { error: (...args) => errors.push(args) },
  };
  const deleteCase = runInNewContext(`(${src})`, context);
  return { deleteCase, toast, errors };
}

function buildBulkDelete({ selected = ['a', 'b'], confirmResult = true, mutationBlocked = false, commitCaseDeletion }) {
  const toast = makeToastSpy();
  const errors = [];
  const calls = { clearSelection: 0, render: 0 };
  const src = casesSource.slice(casesSource.indexOf('async function bulkDeleteSelected() {'), casesSource.indexOf('function initTableHeaders() {')).trim();
  const context = {
    selectedIds: new Set(selected),
    PackLibrary: { commitCaseDeletion },
    UIComponents: { confirm: async () => confirmResult, showToast: toast.showToast },
    mutationBlockedWhileBusy: () => mutationBlocked,
    clearSelection: () => { calls.clearSelection += 1; },
    render: () => { calls.render += 1; },
    console: { error: (...args) => errors.push(args) },
  };
  const bulkDeleteSelected = runInNewContext(`(${src})`, context);
  return { bulkDeleteSelected, toast, errors, calls };
}

test('CASE-DELETION UI-ERR single: a thrown preparation failure produces error feedback, never success, and is logged not swallowed', async () => {
  const { deleteCase, toast, errors } = buildDeleteCase({ commitCaseDeletion: () => { throw new Error('boom'); } });
  await deleteCase('case-1');
  assert.equal(toast.calls.length, 1, 'exactly one toast is shown');
  assert.equal(toast.calls[0].type, 'error');
  assert.match(toast.calls[0].message, /Couldn't delete this case\. Nothing was changed\./);
  assert.doesNotMatch(toast.calls[0].message, /boom/, 'internal error detail is not exposed to the user');
  assert.equal(errors.length, 1, 'the failure is logged for diagnostics');
});

test('CASE-DELETION UI-NOOP single: zero deletedCaseIds does not produce "Case deleted"', async () => {
  const { deleteCase, toast } = buildDeleteCase({ commitCaseDeletion: () => ({ deletedCaseIds: [] }) });
  await deleteCase('case-1');
  assert.deepEqual(toast.calls, [{ message: 'Case was already removed.', type: 'warning' }]);
});

test('CASE-DELETION UI-OK single: an actual successful result still shows "Case deleted"', async () => {
  const { deleteCase, toast } = buildDeleteCase({ commitCaseDeletion: () => ({ deletedCaseIds: ['case-1'] }) });
  await deleteCase('case-1');
  assert.deepEqual(toast.calls, [{ message: 'Case deleted', type: 'info' }]);
});

test('CASE-DELETION UI-ERR bulk: a thrown preparation failure produces error feedback and does not clear selection as a fake success', async () => {
  const { bulkDeleteSelected, toast, errors, calls } = buildBulkDelete({
    selected: ['a', 'b'],
    commitCaseDeletion: () => { throw new Error('boom'); },
  });
  await bulkDeleteSelected();
  assert.equal(toast.calls.length, 1);
  assert.equal(toast.calls[0].type, 'error');
  assert.match(toast.calls[0].message, /Couldn't delete the selected cases\. Nothing was changed\./);
  assert.doesNotMatch(toast.calls[0].message, /boom/, 'internal error detail is not exposed to the user');
  assert.equal(calls.clearSelection, 0, 'selection is not cleared as a fake success');
  assert.equal(calls.render, 0);
  assert.equal(errors.length, 1);
});

test('CASE-DELETION UI-NOOP bulk: zero deletedCaseIds is not reported as success and selection/UI state is preserved for retry', async () => {
  const { bulkDeleteSelected, toast, calls } = buildBulkDelete({
    selected: ['a', 'b'],
    commitCaseDeletion: () => ({ deletedCaseIds: [] }),
  });
  await bulkDeleteSelected();
  assert.equal(toast.calls.length, 1);
  assert.equal(toast.calls[0].type, 'warning');
  assert.doesNotMatch(toast.calls[0].message, /Deleted 0/);
  assert.equal(calls.clearSelection, 0, 'selection is preserved so the user can understand/retry');
  assert.equal(calls.render, 0);
});

test('CASE-DELETION UI-COUNT bulk: success feedback and cleanup use the actual deletedCaseIds count, not the originally selected count', async () => {
  const { bulkDeleteSelected, toast, calls } = buildBulkDelete({
    selected: ['a', 'b', 'c'],
    commitCaseDeletion: () => ({ deletedCaseIds: ['a', 'b'] }),
  });
  await bulkDeleteSelected();
  assert.deepEqual(toast.calls, [{ message: 'Deleted 2 case(s).', type: 'info' }]);
  assert.equal(calls.clearSelection, 1, 'a real successful deletion still clears the selection');
  assert.equal(calls.render, 1);
});
