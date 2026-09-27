import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createOperationLifecycle } from '../../src/core/operation-lifecycle.js';

const appPath = fileURLToPath(new URL('../../src/app.js', import.meta.url));

async function createCaptureHarness({ screen = 'editor', packId = 'pack-a', onRender = null, scenePackId = packId, rejectWrite = false } = {}) {
  const appSource = await readFile(appPath, 'utf8');
  const start = appSource.indexOf('async function capturePackPreview(packId,');
  const end = appSource.indexOf('\n      function clearPackPreview(', start);
  assert.ok(start >= 0 && end > start, 'capture function is available from the production owner');

  const state = { currentScreen: screen, currentPackId: packId };
  const subscribers = new Set();
  const packs = new Map([
    ['pack-a', { id: 'pack-a', cases: [{ id: 'instance-a' }] }],
    ['pack-b', { id: 'pack-b', cases: [{ id: 'instance-b' }] }],
  ]);
  const updates = [];
  const renders = [];
  const frames = [];
  const OperationLifecycle = createOperationLifecycle();
  let workspaceKey = 'user-a|workspace-a';
  let generation = 0;
  let scene = { pack: packs.get(scenePackId), visualSignature: 'fixture-visual' };
  const toasts = [];
  const StateStore = {
    get: key => state[key],
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    set(patch) {
      Object.assign(state, patch);
      if (patch.currentScreen || patch.currentPackId) scene = { pack: packs.get(state.currentPackId), visualSignature: 'fixture-visual' };
      for (const fn of subscribers) fn(patch, state);
    },
    replaceSame() {
      for (const fn of subscribers) fn({ _replace: true }, state);
    },
  };
  const PackLibrary = {
    getById: id => packs.get(id) || null,
    updatePreview(id, patch, options) {
      if (rejectWrite || !packs.has(id)) return null;
      updates.push({ id, patch, options });
      Object.assign(packs.get(id), patch);
      return packs.get(id);
    },
  };
  const context = {
    OperationLifecycle,
    StateStore,
    PackLibrary,
    UIComponents: { showToast: (...args) => toasts.push(args) },
    CoreStorage: {
      captureScopeContext: () => ({ generation, workspaceKey }),
      isScopeContextCurrent: scope => scope.generation === generation && scope.workspaceKey === workspaceKey,
    },
    EditorUI: {
      getPreviewScene: () => scene,
      getPreviewView: () => scene ? { signature: 'fixture-view', revision: 0 } : null,
    },
    CaseScene: { getVisualSignature: () => 'fixture-visual' },
    getActiveWorkspaceKey: () => workspaceKey,
    requestAnimationFrame: callback => frames.push(callback),
    SceneManager: { getCamera: () => ({}) },
    renderCameraToDataUrl() {
      renders.push({ screen: state.currentScreen, packId: state.currentPackId });
      if (onRender) onRender(StateStore);
      return 'data:image/jpeg;base64,AAAA';
    },
    estimateDataUrlBytes: () => 3,
  };
  vm.createContext(context);
  vm.runInContext(`${appSource.slice(start, end)}\nglobalThis.capture = capturePackPreview;`, context);

  return {
    capture: context.capture,
    OperationLifecycle,
    StateStore,
    packs,
    renders,
    updates,
    toasts,
    invalidateScene() { scene = null; },
    subscriberCount: () => subscribers.size,
    setWorkspaceKey(nextKey) { if (nextKey !== workspaceKey) generation += 1; workspaceKey = nextKey; },
    async nextFrame() {
      const callbacks = frames.splice(0);
      for (const callback of callbacks) callback();
      await Promise.resolve();
    },
  };
}

async function finishFrameWait(runtime) {
  await runtime.nextFrame();
  await runtime.nextFrame();
}

test('automatic preview writes only while the requested Pack remains in Editor', async () => {
  const runtime = await createCaptureHarness();
  const capture = runtime.capture('pack-a', { source: 'auto', quiet: true });
  assert.equal(runtime.OperationLifecycle.currentOperation().kind, 'capturingPreview');
  await finishFrameWait(runtime);

  assert.equal(await capture, true);
  assert.deepEqual(runtime.renders, [{ screen: 'editor', packId: 'pack-a' }]);
  assert.equal(runtime.updates.length, 1);
  assert.equal(runtime.updates[0].id, 'pack-a');
  assert.equal(runtime.updates[0].options.skipHistory, true);
  assert.equal(runtime.OperationLifecycle.isBusy(), false);
  assert.equal(runtime.subscriberCount(), 0);
});

test('automatic preview refuses a different Pack or non-Editor screen before frame capture', async () => {
  for (const options of [
    { screen: 'editor', packId: 'pack-b' },
    { screen: 'packs', packId: 'pack-a' },
  ]) {
    const runtime = await createCaptureHarness(options);
    assert.equal(await runtime.capture('pack-a', { source: 'auto', quiet: true }), false);
    assert.equal(runtime.renders.length, 0);
    assert.equal(runtime.updates.length, 0);
    assert.equal(runtime.OperationLifecycle.isBusy(), false);
    assert.equal(runtime.subscriberCount(), 0);
  }
});

test('automatic preview skips render and write after Pack, screen, or workspace departure during frame wait', async () => {
  for (const departure of [
    runtime => runtime.StateStore.set({ currentPackId: 'pack-b' }),
    runtime => runtime.StateStore.set({ currentScreen: 'packs' }),
    runtime => { runtime.setWorkspaceKey('user-a|workspace-b'); runtime.StateStore.replaceSame(); },
  ]) {
    const runtime = await createCaptureHarness();
    const capture = runtime.capture('pack-a', { source: 'auto', quiet: true });
    await runtime.nextFrame();
    departure(runtime);
    await runtime.nextFrame();
    assert.equal(await capture, false);
    assert.equal(runtime.renders.length, 0);
    assert.equal(runtime.updates.length, 0);
    assert.equal(runtime.OperationLifecycle.isBusy(), false);
    assert.equal(runtime.subscriberCount(), 0);
  }
});

test('automatic preview remains invalid after departure and return to the same Pack or Editor', async () => {
  for (const departAndReturn of [
    runtime => {
      runtime.StateStore.set({ currentPackId: 'pack-b' });
      runtime.StateStore.set({ currentPackId: 'pack-a' });
    },
    runtime => {
      runtime.StateStore.set({ currentScreen: 'packs' });
      runtime.StateStore.set({ currentScreen: 'editor' });
    },
    runtime => {
      runtime.setWorkspaceKey('user-a|workspace-b');
      runtime.StateStore.replaceSame();
      runtime.setWorkspaceKey('user-a|workspace-a');
      runtime.StateStore.replaceSame();
    },
  ]) {
    const runtime = await createCaptureHarness();
    const capture = runtime.capture('pack-a', { source: 'auto', quiet: true });
    await runtime.nextFrame();
    departAndReturn(runtime);
    await runtime.nextFrame();
    assert.equal(await capture, false);
    assert.equal(runtime.renders.length, 0);
    assert.equal(runtime.updates.length, 0);
    assert.equal(runtime.OperationLifecycle.isBusy(), false);
    assert.equal(runtime.subscriberCount(), 0);
  }
});

test('automatic preview rechecks context before thumbnail write', async () => {
  const runtime = await createCaptureHarness({
    onRender: StateStore => StateStore.set({ currentPackId: 'pack-b' }),
  });
  const capture = runtime.capture('pack-a', { source: 'auto', quiet: true });
  await finishFrameWait(runtime);
  assert.equal(await capture, false);
  assert.equal(runtime.renders.length, 1);
  assert.equal(runtime.updates.length, 0);
  assert.equal(runtime.OperationLifecycle.isBusy(), false);
});

test('manual preview rejects cross-screen capture and mismatched scene identity', async () => {
  for (const options of [{ screen: 'packs', packId: 'pack-b' }, { scenePackId: 'pack-b' }]) {
    const runtime = await createCaptureHarness(options);
    assert.equal(await runtime.capture('pack-a', { source: 'manual' }), false);
    assert.equal(runtime.renders.length, 0);
    assert.equal(runtime.updates.length, 0);
    assert.equal(runtime.toasts.some(t => t[1] === 'success'), false);
    assert.equal(runtime.OperationLifecycle.isBusy(), false);
  }
});

for (const source of ['manual', 'auto']) {
  test(`${source} capture rejects Pack, screen and generation ABA and replacement`, async () => {
    for (const change of [
      r => { r.StateStore.set({ currentPackId: 'pack-b' }); r.StateStore.set({ currentPackId: 'pack-a' }); },
      r => { r.StateStore.set({ currentScreen: 'cases' }); r.StateStore.set({ currentScreen: 'editor' }); },
      r => { r.setWorkspaceKey('workspace-b'); r.setWorkspaceKey('user-a|workspace-a'); },
      r => r.StateStore.replaceSame(),
      r => r.packs.delete('pack-a'),
      r => r.invalidateScene(),
    ]) {
      const runtime = await createCaptureHarness();
      const capture = runtime.capture('pack-a', { source, quiet: source === 'auto' });
      await runtime.nextFrame();
      change(runtime);
      await runtime.nextFrame();
      assert.equal(await capture, false);
      assert.equal(runtime.renders.length, 0);
      assert.equal(runtime.updates.length, 0);
      assert.equal(runtime.toasts.some(t => t[1] === 'success'), false);
      assert.equal(runtime.OperationLifecycle.isBusy(), false);
      assert.equal(runtime.subscriberCount(), 0);
    }
  });
}

test('manual success requires an accepted write; token loss is rejected before readback', async () => {
  for (const rejectWrite of [false, true]) {
    const runtime = await createCaptureHarness({ rejectWrite });
    const capture = runtime.capture('pack-a', { source: 'manual' });
    assert.equal(runtime.toasts.length, 0);
    await finishFrameWait(runtime);
    assert.equal(await capture, !rejectWrite);
    assert.equal(runtime.toasts.some(t => t[1] === 'success'), !rejectWrite);
    assert.equal(runtime.OperationLifecycle.isBusy(), false);
  }
  const runtime = await createCaptureHarness();
  const capture = runtime.capture('pack-a', { source: 'manual' });
  runtime.OperationLifecycle.finishOperation(runtime.OperationLifecycle.currentOperation().token);
  const next = runtime.OperationLifecycle.beginOperation('changingTruck');
  await finishFrameWait(runtime);
  assert.equal(await capture, false);
  assert.equal(runtime.renders.length, 0);
  assert.equal(runtime.OperationLifecycle.isCurrent(next), true);
});

test('automatic context rejection stays silent even for the legacy engine producer', async () => {
  const runtime = await createCaptureHarness({ scenePackId: 'pack-b' });
  assert.equal(await runtime.capture('pack-a', { source: 'auto' }), false);
  assert.equal(runtime.toasts.length, 0);
  assert.equal(runtime.renders.length, 0);
});
