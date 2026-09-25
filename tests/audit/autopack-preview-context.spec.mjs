import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createOperationLifecycle } from '../../src/core/operation-lifecycle.js';

const appPath = fileURLToPath(new URL('../../src/app.js', import.meta.url));

async function createCaptureHarness({ screen = 'editor', packId = 'pack-a', onRender = null } = {}) {
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
  const StateStore = {
    get: key => state[key],
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    set(patch) {
      Object.assign(state, patch);
      for (const fn of subscribers) fn(patch, state);
    },
    replaceSame() {
      for (const fn of subscribers) fn({ _replace: true }, state);
    },
  };
  const PackLibrary = {
    getById: id => packs.get(id) || null,
    update(id, patch, options) {
      updates.push({ id, patch, options });
      Object.assign(packs.get(id), patch);
    },
  };
  const context = {
    OperationLifecycle,
    StateStore,
    PackLibrary,
    UIComponents: { showToast() {} },
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
    subscriberCount: () => subscribers.size,
    setWorkspaceKey(nextKey) { workspaceKey = nextKey; },
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

test('manual preview keeps its existing cross-screen Pack capture behavior', async () => {
  const runtime = await createCaptureHarness({ screen: 'packs', packId: 'pack-b' });
  const capture = runtime.capture('pack-a', { source: 'manual', quiet: true });
  await finishFrameWait(runtime);
  assert.equal(await capture, true);
  assert.equal(runtime.updates.length, 1);
  assert.equal(runtime.updates[0].id, 'pack-a');
  assert.equal(runtime.updates[0].patch.thumbnailSource, 'manual');
  assert.equal(runtime.subscriberCount(), 0);
});
