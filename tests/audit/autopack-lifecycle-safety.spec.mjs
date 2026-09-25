import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createOperationLifecycle } from '../../src/core/operation-lifecycle.js';
import { getOrientedDimsForRotation, normalizeRightAngleRotation } from '../../src/core/oriented-dims.js';

// Exercise the production engine while replacing only its synchronous solver
// dependency. This keeps large-load and error paths deterministic without
// changing packing algorithms or relying on wall-clock solve budgets.
const engineUrl = new URL('../../src/services/autopack-engine.js', import.meta.url);
let engineModule;
async function loadEngine() {
  if (engineModule) return engineModule;
  const solverShim = `
    export const getPackingStrategy = () => null;
    export const runAdaptiveAutoPack = args => globalThis.__tp3dLifecycleTestSolve(args);
  `;
  const shimUrl = `data:text/javascript;base64,${Buffer.from(solverShim).toString('base64')}`;
  let source = await fs.readFile(engineUrl, 'utf8');
  const original = "from '../packing-core/solution.js'";
  assert.ok(source.includes(original), 'test solver seam still matches the production import');
  source = source.replace(original, `from '${shimUrl}'`);
  source = source.replace(/from '(\.\.?\/[^']+)'/g, (_, relative) => `from '${new URL(relative, engineUrl).href}'`);
  engineModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return engineModule;
}

function makeClock() {
  let now = 0;
  let nextId = 1;
  const jobs = new Map();
  const setTimeout = (callback, delay = 0) => {
    const id = nextId++;
    jobs.set(id, { at: now + Math.max(0, Number(delay) || 0), callback });
    return id;
  };
  const clearTimeout = id => jobs.delete(id);
  const nextJob = () => [...jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  const microtasks = async () => {
    for (let i = 0; i < 24; i += 1) await Promise.resolve();
  };
  async function advanceBy(ms) {
    const target = now + ms;
    for (let steps = 0; steps < 1000; steps += 1) {
      const entry = nextJob();
      if (!entry || entry[1].at > target) break;
      now = entry[1].at;
      jobs.delete(entry[0]);
      entry[1].callback();
      await microtasks();
    }
    now = target;
    await microtasks();
  }
  async function runNext() {
    const entry = nextJob();
    assert.ok(entry, 'expected a scheduled timer');
    await advanceBy(entry[1].at - now);
  }
  return { setTimeout, clearTimeout, advanceBy, runNext, microtasks, jobs, get now() { return now; } };
}

function makeObject(id, x = 0) {
  const writes = [];
  const position = {
    x, y: 5, z: 0,
    set(nx, ny, nz) {
      this.x = nx; this.y = ny; this.z = nz;
      writes.push({ x: nx, y: ny, z: nz });
    },
  };
  const rotation = {
    x: 0, y: 0, z: 0,
    set(xr, yr, zr) { this.x = xr; this.y = yr; this.z = zr; },
  };
  return { id, position, rotation, userData: {}, writes };
}

function casesFor(count, caseId = 'c') {
  return Array.from({ length: count }, (_, index) => ({
    id: `i${index}`, caseId, hidden: false, placement: 'staged',
    transform: { position: { x: -20, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
  }));
}

function solutionFor(items, { count = items.length, warnings = [], selected = true } = {}) {
  const placements = new Map();
  const rotations = new Map();
  const orientedDims = new Map();
  items.slice(0, count).forEach((item, index) => {
    placements.set(item.instanceId, { x: 5000 - index * 12, y: 5, z: 0 });
    rotations.set(item.instanceId, { x: 0, y: 0, z: 0 });
    orientedDims.set(item.instanceId, { length: 10, width: 10, height: 10 });
  });
  const result = {
    id: 'default', strategy: 'default', placements, rotations, orientedDims,
    unpacked: items.slice(count).map(item => item.instanceId), warnings,
    phaseStats: { floorCount: count, stackCount: 0 },
    solveStatus: { complete: count === items.length, partialCauses: count === items.length ? [] : ['space'] },
  };
  return { selectedSolution: selected ? result : null, solutions: selected ? [result] : [], selected: 'default' };
}

async function withFixture(options, run) {
  const Engine = await loadEngine();
  const clock = makeClock();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = clock.setTimeout;
  const originalSolver = globalThis.__tp3dLifecycleTestSolve;
  const caseCount = options.caseCount ?? 1;
  const packA = {
    id: 'a', title: 'A', truck: { length: 6000, width: 100, height: 100, shapeMode: 'rect' },
    cases: casesFor(caseCount),
  };
  const packB = {
    id: 'b', title: 'B', truck: packA.truck, cases: casesFor(1),
  };
  const packs = new Map([['a', packA], ['b', packB]]);
  const caseData = { id: 'c', name: 'Box', dimensions: { length: 10, width: 10, height: 10 }, weight: 10, volume: 1000, shape: 'box', orientationLock: 'upright', canFlip: false };
  const state = { currentPackId: 'a', currentScreen: 'editor', autoPackResults: { previous: true } };
  const listeners = new Set();
  const stateWrites = [];
  const StateStore = {
    get: key => state[key],
    set(patch) {
      Object.assign(state, patch);
      stateWrites.push(patch);
      for (const listener of listeners) listener(patch, state);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const packWrites = [];
  const PackLibrary = {
    getById: id => packs.get(id) || null,
    update(id, patch) {
      packWrites.push({ id, patch });
      const next = { ...packs.get(id), ...patch };
      packs.set(id, next);
      return next;
    },
    computeStats(pack) {
      const entries = pack?.cases || [];
      return {
        packedCases: entries.filter(item => item.placement === 'packed').length,
        stagedCases: entries.filter(item => item.placement === 'staged').length,
        unresolvedInstances: entries.filter(item => item.caseId !== 'c').length,
        volumePercent: 25,
      };
    },
    findSafeStagingPosition(_pack, dims, accepted) {
      const x = -20 - accepted.length * 12;
      return {
        position: { x, y: dims.height / 2, z: 0 },
        aabb: { min: { x: x - dims.length / 2, y: 0, z: -dims.width / 2 }, max: { x: x + dims.length / 2, y: dims.height, z: dims.width / 2 } },
      };
    },
    normalizeRightAngleRotation,
    getOrientedDimsForRotation,
    reconcilePlacementsForTruck: () => ({ acceptedPlacements: [] }),
  };
  const objects = new Map(packA.cases.map(item => [item.id, makeObject(item.id)]));
  const frames = [];
  const tweenCompletes = [];
  const tweenState = { removeAllCalls: 0, throwOnRemoveAll: options.throwOnRemoveAll || 0 };
  class FrozenTween {
    constructor() { if (options.tween === 'throw') throw new Error('injected tween start failure'); }
    to() { return this; }
    easing() { return this; }
    onComplete(callback) { tweenCompletes.push(callback); return this; }
    start() { return this; }
  }
  const TWEEN = options.tween === 'none' ? null : {
    Tween: FrozenTween,
    Easing: { Cubic: { InOut: value => value } },
    removeAll() {
      tweenState.removeAllCalls += 1;
      if (tweenState.removeAllCalls === tweenState.throwOnRemoveAll) throw new Error('injected removeAll setup failure');
    },
  };
  const previews = [];
  const toasts = [];
  const overlays = [];
  const diagnostics = [];
  const runtimeWindow = {
    performance: { now: () => clock.now },
    requestAnimationFrame(callback) { frames.push(callback); },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    TWEEN,
    __TP3D_BILLING: { getBillingState: () => ({ ok: true, orgId: '' }) },
    __TP3D_DIAG__: { isActive: () => true, autopackStart() {}, autopackEnd: record => diagnostics.push(record) },
  };
  const lifecycle = createOperationLifecycle({ now: () => clock.now });
  let solveCalls = 0;
  globalThis.__tp3dLifecycleTestSolve = args => {
    solveCalls += 1;
    return options.solve ? options.solve(args) : solutionFor(args.items);
  };
  const engine = Engine.createAutoPackEngine({
    CaseLibrary: { getById: id => id === 'c' ? caseData : null, getCases: () => [caseData] },
    CaseScene: { getObject: id => objects.get(id) || null },
    OperationLifecycle: options.operationLifecycle || lifecycle,
    capturePackPreview: (id, captureOptions) => previews.push({ id, captureOptions }),
    getActiveOrgIdForBilling: () => '', getOrgRoleHydrationState: () => 'ready',
    getProRuleSet: () => ({ canUseProFeature: true }), getWorkspaceSwitchState: () => null,
    maybeScheduleBillingRefresh() {}, normalizeOrgIdForBilling: value => value, openSettingsOverlay() {},
    PackLibrary, runtimeWindow,
    SceneManager: { vecInchesToWorld: value => value, toWorld: value => value },
    StateStore, toast: (...args) => toasts.push(args),
    TrailerGeometry: { getTrailerUsableZones: truck => [{ min: { x: 0, y: 0, z: -truck.width / 2 }, max: { x: truck.length, y: truck.height, z: truck.width / 2 } }] },
    UIComponents: {
      showToast: (...args) => toasts.push(args),
      showAutoPackLoadingOverlay(overlayOptions = {}) {
        const overlay = {
          closed: false,
          messages: [overlayOptions.initialMessage],
          setMessage(message) { this.messages.push(message); },
          close() { this.closed = true; },
        };
        overlays.push(overlay);
        return overlay;
      },
    },
    Utils: { deepClone: value => structuredClone(value), volumeInCubicInches: dims => dims.length * dims.width * dims.height },
  });
  const fixture = {
    engine, clock, state, StateStore, packs, packWrites, stateWrites, objects,
    frames, tweenCompletes, tweenState, lifecycle, previews, overlays, diagnostics,
    listenerCount: () => listeners.size,
    get solveCalls() { return solveCalls; },
    async frame() {
      const callback = frames.shift();
      assert.ok(callback, 'expected an AutoPack animation frame');
      callback(clock.now);
      await clock.microtasks();
    },
    async initialFrames() { await this.frame(); await this.frame(); },
    async finish(packPromise) {
      while (frames.length) await this.frame();
      for (let i = 0; engine.running && i < 300; i += 1) {
        assert.ok(clock.jobs.size, 'running AutoPack must have an animation timer');
        await clock.runNext();
      }
      assert.equal(engine.running, false, 'AutoPack settled within bounded fake time');
      await packPromise;
    },
  };
  try {
    await run(fixture);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.__tp3dLifecycleTestSolve = originalSolver;
  }
}

test('10A: rejected operation acquisition changes no Results, Pack, scene, loading, or newer token', async () => {
  const newer = createOperationLifecycle();
  const newerToken = newer.beginOperation('changingTruck');
  const rejected = { ...newer, isBusy: () => false, beginOperation: () => null };
  await withFixture({ operationLifecycle: rejected }, async f => {
    const before = f.objects.get('i0').writes.length;
    await f.engine.pack();
    assert.equal(f.engine.running, false);
    assert.equal(f.solveCalls, 0);
    assert.equal(f.objects.get('i0').writes.length, before);
    assert.equal(f.packWrites.length, 0);
    assert.deepEqual(f.state.autoPackResults, { previous: true });
    assert.equal(f.overlays.length, 0);
    assert.equal(f.previews.length, 0);
    assert.equal(newer.isCurrent(newerToken), true);
  });
});

test('10A: setup throw after token acquisition closes loading and releases only its token', async () => {
  await withFixture({ throwOnRemoveAll: 1 }, async f => {
    await f.engine.pack();
    assert.equal(f.engine.running, false);
    assert.equal(f.lifecycle.isBusy(), false);
    assert.equal(f.overlays.length, 1);
    assert.equal(f.overlays[0].closed, true);
    assert.equal(f.clock.jobs.size, 0);
    assert.equal(f.solveCalls, 0);
    assert.equal(f.state.autoPackResults?.options, undefined);
    f.tweenState.throwOnRemoveAll = 0;
    const retry = f.engine.pack();
    await f.initialFrames();
    await f.finish(retry);
    assert.equal(f.solveCalls, 1, 'a later AutoPack may acquire the operation');
    assert.equal(f.lifecycle.isBusy(), false);
  });
});

test('10A: workspace change and unexpected token loss each invalidate before the solver', async () => {
  for (const invalidation of ['workspace', 'token-to-idle']) {
    await withFixture({}, async f => {
      const promise = f.engine.pack();
      if (invalidation === 'workspace') f.engine.bumpWorkspaceGeneration();
      else f.lifecycle.finishOperation(f.lifecycle.currentOperation().token);
      const writes = f.objects.get('i0').writes.length;
      await f.initialFrames();
      await promise;
      assert.equal(f.solveCalls, 0, invalidation);
      assert.equal(f.objects.get('i0').writes.length, writes, invalidation);
      assert.equal(f.state.autoPackResults, null, invalidation);
      assert.equal(f.previews.length, 0, invalidation);
      assert.equal(f.engine.running, false, invalidation);
      assert.equal(f.lifecycle.isBusy(), false, invalidation);
    });
  }
});

test('10A: Pack switch during animation preserves committed A and never writes B scene or Results', async () => {
  await withFixture({}, async f => {
    const promise = f.engine.pack();
    await f.initialFrames();
    assert.equal(f.packWrites.length, 1, 'Pack A commits before animation settles');
    assert.equal(f.lifecycle.currentOperation().kind, 'autopacking');
    f.StateStore.set({ currentPackId: 'b' });
    const replacement = makeObject('i0', 777);
    f.objects.set('i0', replacement);
    await f.clock.advanceBy(276);
    await promise;
    assert.equal(f.packs.get('a').cases[0].placement, 'packed');
    assert.equal(f.packs.get('b').cases[0].placement, 'staged');
    assert.equal(replacement.position.x, 777);
    assert.equal(replacement.writes.length, 0);
    assert.equal(f.state.autoPackResults, null);
    assert.equal(f.previews.length, 0);
    assert.equal(f.lifecycle.isBusy(), false);
  });
});

test('10A: screen departure and depart-return remain stale before post-wait batch snap', async () => {
  for (const returnToEditor of [false, true]) {
    await withFixture({}, async f => {
      const promise = f.engine.pack();
      await f.initialFrames();
      const obj = f.objects.get('i0');
      f.StateStore.set({ currentScreen: 'cases' });
      if (returnToEditor) f.StateStore.set({ currentScreen: 'editor' });
      const writesAtDeparture = obj.writes.length;
      await f.clock.advanceBy(276);
      await promise;
      assert.equal(obj.writes.length, writesAtDeparture, 'no post-wait stale scene write');
      assert.equal(f.state.autoPackResults, null);
      await f.clock.advanceBy(500);
      assert.equal(f.previews.length, 0);
      assert.equal(f.lifecycle.isBusy(), false);
    });
  }
});

test('10A: frozen tween cannot write after completion or disturb a newer operation', async () => {
  await withFixture({}, async f => {
    const promise = f.engine.pack();
    await f.initialFrames();
    const oldCompletion = f.tweenCompletes[0];
    assert.equal(typeof oldCompletion, 'function');
    await f.clock.advanceBy(276);
    await promise;
    const newerToken = f.lifecycle.beginOperation('changingTruck');
    const obj = f.objects.get('i0');
    obj.position.set(777, 5, 0);
    const writes = obj.writes.length;
    await f.clock.advanceBy(500);
    oldCompletion();
    assert.equal(obj.position.x, 777);
    assert.equal(obj.writes.length, writes);
    assert.equal(f.lifecycle.isCurrent(newerToken), true);
    assert.equal([...f.clock.jobs.values()].some(job => job.at <= f.clock.now), false);
  });
});

test('10A: captured tween and batch snap do not mutate a same-ID replacement mesh', async () => {
  await withFixture({}, async f => {
    const promise = f.engine.pack();
    await f.initialFrames();
    const oldCompletion = f.tweenCompletes[0];
    const replacement = makeObject('i0', 777);
    f.objects.set('i0', replacement);
    oldCompletion();
    await f.clock.advanceBy(276);
    await promise;
    assert.equal(replacement.position.x, 777);
    assert.equal(replacement.writes.length, 0);
  });
});

test('10A: valid animated completion preserves Pack, Results, final scene, and automatic preview', async () => {
  await withFixture({ tween: 'none' }, async f => {
    const promise = f.engine.pack();
    await f.initialFrames();
    await f.clock.advanceBy(276);
    await promise;
    assert.equal(f.packs.get('a').cases[0].placement, 'packed');
    assert.equal(f.objects.get('i0').position.x, 5000);
    assert.equal(f.state.autoPackResults?.packId, 'a');
    assert.ok(f.state.autoPackResults?.options.length > 0);
    assert.equal(f.lifecycle.isBusy(), false);
    assert.equal(f.overlays[0].closed, true);
    await f.clock.advanceBy(60);
    assert.deepEqual(f.previews.map(item => item.id), ['a']);
    assert.equal(f.clock.jobs.size, 0);
  });
});

test('10A: delayed preview is suppressed after Pack or screen departure, including return', async () => {
  for (const transition of [
    [{ currentPackId: 'b' }],
    [{ currentScreen: 'cases' }],
    [{ currentScreen: 'cases' }, { currentScreen: 'editor' }],
  ]) {
    await withFixture({ tween: 'none' }, async f => {
      const promise = f.engine.pack();
      await f.initialFrames();
      await f.clock.advanceBy(276);
      await promise;
      transition.forEach(patch => f.StateStore.set(patch));
      await f.clock.advanceBy(60);
      assert.deepEqual(f.previews, []);
    });
  }
});

test('10A: 300 animates and 301 snaps while both commit, publish Results, and release', async () => {
  for (const count of [300, 301]) {
    await withFixture({ caseCount: count, tween: 'none' }, async f => {
      const promise = f.engine.pack();
      await f.initialFrames();
      await f.finish(promise);
      const metrics = f.diagnostics.at(-1)?.animation;
      assert.equal(f.packs.get('a').cases.filter(item => item.placement === 'packed').length, count);
      assert.equal(f.state.autoPackResults?.packId, 'a');
      assert.equal(f.objects.get('i0').position.x, 5000);
      assert.equal(f.lifecycle.isBusy(), false);
      assert.equal(metrics?.skipped, count === 301);
      assert.equal(metrics?.strategy, count === 301 ? 'instant' : 'batched');
      assert.equal(f.clock.jobs.size, 1, 'only the normal delayed preview remains');
    });
  }
});

test('10A: partial, zero-placement, absent selection, and solver errors clean up deterministically', async () => {
  for (const mode of ['partial', 'budget', 'zero', 'missing-case', 'missing-selection', 'throw']) {
    await withFixture({
      solve: args => {
        if (mode === 'throw') throw new Error('injected solver failure');
        if (mode === 'missing-selection') return solutionFor(args.items, { selected: false });
        return solutionFor(args.items, {
          count: mode === 'partial' || mode === 'budget' ? 0 : mode === 'missing-case' ? args.items.length : 0,
          warnings: mode === 'budget' ? ['time budget reached'] : [],
        });
      },
    }, async f => {
      if (mode === 'missing-case') f.packs.get('a').cases[0].caseId = 'deleted';
      const priorError = console.error;
      if (mode === 'throw') console.error = () => {};
      try {
        const promise = f.engine.pack();
        await f.initialFrames();
        await f.finish(promise);
      } finally {
        console.error = priorError;
      }
      assert.equal(f.engine.running, false, mode);
      assert.equal(f.lifecycle.isBusy(), false, mode);
      assert.equal(f.overlays[0].closed, true, mode);
      assert.equal(f.clock.jobs.size <= 1, true, mode);
    });
  }
});

test('10A: same-context frozen tween fallback and tween start failure still finish the committed layout', async () => {
  for (const tween of ['frozen', 'throw']) {
    await withFixture({ caseCount: 6, tween }, async f => {
      const promise = f.engine.pack();
      await f.initialFrames();
      await f.finish(promise);
      const metrics = f.diagnostics.at(-1)?.animation;
      assert.ok(metrics?.batches >= 2, tween);
      if (tween === 'frozen') assert.ok(metrics.fallbackCount > 0, 'a frozen tween falls back while the run is valid');
      for (const [id, obj] of f.objects) {
        const packed = f.packs.get('a').cases.find(item => item.id === id);
        assert.equal(packed.placement, 'packed', tween);
        assert.equal(obj.position.x, packed.transform.position.x, `${tween} ${id} reaches committed pose`);
      }
      assert.equal(f.state.autoPackResults?.packId, 'a', tween);
      assert.equal(f.lifecycle.isBusy(), false, tween);
      assert.equal(f.clock.jobs.size, 1, `${tween}: only the delayed preview remains`);
      await f.clock.advanceBy(60);
      assert.deepEqual(f.previews.map(item => item.id), ['a'], tween);
      assert.equal(f.listenerCount(), 0, `${tween}: run watch released after preview`);
    });
  }
});

test('10A: token taken by another operation mid-animation stops scene writes and leaves the new token alone', async () => {
  await withFixture({ caseCount: 6 }, async f => {
    const promise = f.engine.pack();
    await f.initialFrames();
    const oldCompletions = f.tweenCompletes.slice();
    f.lifecycle.finishOperation(f.lifecycle.currentOperation().token);
    const newerToken = f.lifecycle.beginOperation('changingTruck');
    const writes = [...f.objects.values()].map(obj => obj.writes.length);
    oldCompletions.forEach(complete => complete());
    await f.clock.advanceBy(2000);
    await promise;
    assert.deepEqual([...f.objects.values()].map(obj => obj.writes.length), writes);
    assert.equal(f.state.autoPackResults, null);
    assert.equal(f.previews.length, 0);
    assert.equal(f.engine.running, false);
    assert.equal(f.lifecycle.isCurrent(newerToken), true, 'stale AutoPack never releases a newer token');
    assert.equal(f.clock.jobs.size, 0);
    assert.equal(f.listenerCount(), 0);
  });
});

test('10A: workspace change mid-animation cancels owned fallbacks and writes nothing to a replacement scene', async () => {
  await withFixture({ caseCount: 6 }, async f => {
    const promise = f.engine.pack();
    await f.initialFrames();
    f.engine.bumpWorkspaceGeneration();
    const replacements = [...f.objects.keys()].map(id => {
      const replacement = makeObject(id, 777);
      f.objects.set(id, replacement);
      return replacement;
    });
    assert.equal(f.clock.jobs.size, 1, 'only the batch sleep remains after fallback cancellation');
    await f.clock.advanceBy(2000);
    await promise;
    replacements.forEach(obj => assert.equal(obj.writes.length, 0));
    assert.equal(f.state.autoPackResults, null);
    assert.equal(f.previews.length, 0);
    assert.equal(f.lifecycle.isBusy(), false);
    assert.equal(f.listenerCount(), 0);
  });
});

test('10A: run watch never leaks across rejected, stale, and repeated runs', async () => {
  const rejected = { ...createOperationLifecycle(), isBusy: () => false, beginOperation: () => null };
  await withFixture({ operationLifecycle: rejected }, async f => {
    await f.engine.pack();
    assert.equal(f.listenerCount(), 0);
  });
  await withFixture({ tween: 'none' }, async f => {
    for (let i = 0; i < 3; i += 1) {
      const promise = f.engine.pack();
      await f.initialFrames();
      await f.finish(promise);
      assert.ok(f.listenerCount() <= 1, 'at most the pending-preview watch remains');
    }
    await f.clock.advanceBy(60);
    await f.clock.microtasks();
    assert.equal(f.listenerCount(), 0);
    assert.equal(f.previews.length, 1, 'a new run supersedes the previous pending preview');
  });
});

test('10B: status shows only stages a user can see, each present at an event-loop yield', async () => {
  const solving = 'Checking fit, stacking, and safety rules...';
  const placing = 'Placing cargo in the truck...';
  for (const count of [300, 301]) {
    await withFixture({ caseCount: count, tween: 'none' }, async f => {
      const promise = f.engine.pack();
      // First yield: the frame wait right before the synchronous solve.
      assert.deepEqual(f.overlays[0].messages, [solving], `${count}: the solve stage is what paints first`);
      await f.initialFrames();
      // Next yield: the first animation batch wait, or (large load) completion.
      assert.deepEqual(f.overlays[0].messages, count === 300 ? [solving, placing] : [solving], `${count}: stage at the next yield`);
      assert.equal(f.overlays[0].closed, count === 301, `${count}: an instant large load has no placing stage`);
      await f.finish(promise);
      assert.equal(f.overlays[0].messages.length, count === 300 ? 2 : 1, `${count}: no later, timer-driven, or unpainted stage`);
      assert.equal(f.overlays[0].closed, true, 'engine cleanup ends the status');
    });
  }
});
