import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAppBrowserHarness,
  readRuntimeSnapshot,
} from './app-js-browser-harness.mjs';

let harness;
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ORG_IDS = [ORG_A, ORG_B];

function sessionFor(userId) {
  return {
    access_token: `access-${userId}`,
    refresh_token: `refresh-${userId}`,
    expires_at: 4102444800,
    user: {
      id: userId,
      email: `${userId}@example.test`,
      user_metadata: { full_name: `User ${userId.toUpperCase()}` },
    },
  };
}

function organization(id, name, role = 'owner') {
  return {
    id,
    name,
    role,
    created_at: '2025-01-01T00:00:00.000Z',
    archived_at: null,
  };
}

function signedInScenario(userIds = ['user-a']) {
  const profiles = {};
  const organizations = {};
  for (const [index, userId] of userIds.entries()) {
    const orgId = ORG_IDS[index];
    profiles[userId] = {
      id: userId,
      email: `${userId}@example.test`,
      current_organization_id: orgId,
      deletion_status: null,
      deleted_at: null,
      purge_after: null,
    };
    organizations[userId] = [organization(orgId, `Workspace ${String.fromCharCode(65 + index)}`)];
  }
  return { initialSession: sessionFor(userIds[0]), profiles, organizations };
}

async function waitForSignedInOwner(page, userId, orgId) {
  await page.waitForFunction(({ expectedUserId, expectedOrgId }) => {
    const control = window.__TP3D_FAKE_SUPABASE_CONTROL__;
    const activeOrgId = window.OrgContext && typeof window.OrgContext.getActiveOrgId === 'function'
      ? window.OrgContext.getActiveOrgId()
      : null;
    const fake = control ? control.snapshot() : null;
    return document.body
      && document.body.dataset.auth === 'signed_in'
      && fake
      && fake.userId === expectedUserId
      && activeOrgId === expectedOrgId;
  }, { expectedUserId: userId, expectedOrgId: orgId }, { timeout: 30000 });
}

function multiWorkspaceScenario() {
  const scenario = signedInScenario();
  scenario.organizations['user-a'] = [
    organization(ORG_A, 'Workspace A'),
    organization(ORG_B, 'Workspace B'),
  ];
  return scenario;
}

async function armWorkspaceReady(page, orgId) {
  await page.evaluate(expectedOrgId => {
    let timeoutId;
    let readyHandler;
    const states = [];
    window.__TP3D_TEST_WORKSPACE_READY__ = new Promise((resolve, reject) => {
      readyHandler = event => {
        const state = window.TruckPackerApp.getWorkspaceSwitchState();
        states.push(state);
        if (window.OrgContext.getActiveOrgId() !== expectedOrgId
          || state.active
          || state.toOrgId !== expectedOrgId
          || !state.localStateReady
          || !state.orgReady
          || !state.billingReady) return;
        window.removeEventListener('tp3d:workspace-switch-state', readyHandler);
        window.clearTimeout(timeoutId);
        resolve({ eventDetail: event.detail || null, states });
      };
      window.addEventListener('tp3d:workspace-switch-state', readyHandler);
      timeoutId = window.setTimeout(() => {
        window.removeEventListener('tp3d:workspace-switch-state', readyHandler);
        reject(new Error(`Timed out waiting for workspace ${expectedOrgId} readiness: ${JSON.stringify({
          activeOrgId: window.OrgContext && window.OrgContext.getActiveOrgId(),
          dispatches: window.__TP3D_TEST_INSTRUMENTATION__.snapshot().dispatches
            .filter(entry => /workspace|org/i.test(entry.type)),
          state: window.TruckPackerApp && window.TruckPackerApp.getWorkspaceSwitchState(),
        })}`));
      }, 15000);
    });
  }, orgId);
}

async function readArmedWorkspaceReady(page) {
  return page.evaluate(async () => {
    const detail = await window.__TP3D_TEST_WORKSPACE_READY__;
    delete window.__TP3D_TEST_WORKSPACE_READY__;
    return {
      activeOrgId: window.OrgContext.getActiveOrgId(),
      detail,
      state: window.TruckPackerApp.getWorkspaceSwitchState(),
    };
  });
}

async function clickWorkspaceOption(page, workspaceName) {
  const modalOverlay = page.locator('#modal-root .modal-overlay:visible');
  if (await modalOverlay.isVisible()) {
    throw new Error(`Workspace switch blocked by modal: ${JSON.stringify(await modalOverlay.innerText())}`);
  }
  const option = page.locator('button').filter({ hasText: workspaceName }).last();
  if (!await option.isVisible()) {
    await page.locator('#btn-account-switcher').click({ timeout: 5000 });
    await option.waitFor({ state: 'visible', timeout: 5000 });
  }
  await option.click();
}

async function switchWorkspaceAndWait(page, orgId, workspaceName) {
  await armWorkspaceReady(page, orgId);
  await clickWorkspaceOption(page, workspaceName);
  const during = await page.evaluate(() => window.TruckPackerApp.getWorkspaceSwitchState());
  const observed = await readArmedWorkspaceReady(page);
  return { ...observed, after: observed.state, during };
}

test.before(async () => {
  harness = await createAppBrowserHarness();
});

test.after(async () => {
  if (harness) await harness.close();
});

test('App.js signed-out boot reaches the real ready state through index.html', async t => {
  const scenario = await harness.createScenario({ initialSession: null });
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await page.waitForFunction(() => document.body && document.body.dataset.auth === 'signed_out');

  const snapshot = await readRuntimeSnapshot(page);
  assert.equal(snapshot.boot.appReady, true);
  assert.equal(snapshot.boot.fatalOverlayShown, false);
  assert.equal(snapshot.authBodyState, 'signed_out');
  assert.ok(snapshot.facadeKeys.includes('init'), 'the final real TruckPackerApp facade is published');
  assert.ok(snapshot.facadeKeys.includes('getWorkspaceSwitchState'));
  t.diagnostic(`Observed window.TruckPackerApp facade: ${snapshot.facadeKeys.join(', ')}`);
  assert.equal(snapshot.fakeSupabase.userId, null);
  assert.ok(snapshot.fakeSupabase.authSubscriberCount >= 2,
    'the production Supabase wrapper and App.js auth listener both subscribe');
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});

test('repeated init preserves first-init listener, timer, channel, network, and auth ownership', async t => {
  const scenario = await harness.createScenario({ initialSession: null });
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await page.waitForFunction(() => document.body && document.body.dataset.auth === 'signed_out');

  const firstInit = await readRuntimeSnapshot(page);
  const initResults = await page.evaluate(async () => {
    const first = await window.TruckPackerApp.init();
    const second = await window.TruckPackerApp.init();
    return [first, second].map(value => value == null ? null : typeof value);
  });
  const repeatedInit = await readRuntimeSnapshot(page);

  assert.deepEqual(initResults, [null, null]);
  assert.deepEqual(repeatedInit.instrumentation, firstInit.instrumentation,
    'repeated init must not acquire additional browser-owned resources');
  assert.equal(
    repeatedInit.fakeSupabase.authSubscriberCount,
    firstInit.fakeSupabase.authSubscriberCount,
    'repeated init must not add Supabase auth subscriptions'
  );
  assert.deepEqual(
    repeatedInit.fakeSupabase.queries,
    firstInit.fakeSupabase.queries,
    'repeated init must not repeat transport work'
  );
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});

test('signed-in boot and TOKEN_REFRESHED preserve the active user workspace', async t => {
  const scenario = await harness.createScenario(signedInScenario());
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const beforeRefresh = await readRuntimeSnapshot(page);
  await page.evaluate(async session => {
    await window.__TP3D_FAKE_SUPABASE_CONTROL__.emitAuth('TOKEN_REFRESHED', session);
  }, sessionFor('user-a'));
  await page.waitForFunction(() => {
    const events = window.__TP3D_FAKE_SUPABASE_CONTROL__.snapshot().authEvents;
    return events.some(entry => entry.event === 'TOKEN_REFRESHED' && entry.userId === 'user-a');
  });
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const afterRefresh = await readRuntimeSnapshot(page);
  assert.equal(afterRefresh.fakeSupabase.authSubscriberCount,
    beforeRefresh.fakeSupabase.authSubscriberCount);
  assert.equal(afterRefresh.authBodyState, 'signed_in');
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});

test('same-tab workspace switching exposes not-ready then ready lifecycle state', async t => {
  const scenario = await harness.createScenario(multiWorkspaceScenario());
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const observed = await switchWorkspaceAndWait(page, ORG_B, 'Workspace B');
  assert.equal(observed.activeOrgId, ORG_B);
  assert.equal(observed.during.active, true);
  assert.equal(observed.during.fromOrgId, ORG_A);
  assert.equal(observed.during.toOrgId, ORG_B);
  assert.equal(observed.after.active, false);
  assert.equal(observed.after.localStateReady, true);
  assert.equal(observed.after.orgReady, true);
  assert.equal(observed.after.billingReady, true);
  assert.ok(observed.detail.states.some(state => state.active && !state.billingReady),
    'the emitted switch sequence exposes a not-ready state before completion');
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});

test('real two-page context propagates cross-tab workspace readiness', async t => {
  const scenario = await harness.createScenario(multiWorkspaceScenario());
  t.after(() => scenario.close());

  const sender = await scenario.openPage();
  const receiver = await scenario.openPage();
  await Promise.all([
    scenario.waitForAppReady(sender),
    scenario.waitForAppReady(receiver),
  ]);
  await Promise.all([
    waitForSignedInOwner(sender, 'user-a', ORG_A),
    waitForSignedInOwner(receiver, 'user-a', ORG_A),
  ]);

  await armWorkspaceReady(receiver, ORG_B);
  const senderObserved = await switchWorkspaceAndWait(sender, ORG_B, 'Workspace B');
  const receiverObserved = await readArmedWorkspaceReady(receiver);

  assert.equal(senderObserved.activeOrgId, ORG_B);
  assert.equal(receiverObserved.activeOrgId, ORG_B);
  assert.equal(receiverObserved.state.active, false);
  assert.equal(receiverObserved.state.orgReady, true);
  assert.equal(receiverObserved.state.billingReady, true);
  assert.ok(receiverObserved.detail.states.some(state => state.active && state.remote),
    'the receiver observes an active remote switch before readiness');
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});

test('failed organization bundle loading can recover on a later hydration', async t => {
  const scenario = await harness.createScenario(multiWorkspaceScenario());
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const failureBaseline = await page.evaluate(() => {
    const control = window.__TP3D_FAKE_SUPABASE_CONTROL__;
    const count = control.snapshot().orgQueryFailures.length;
    window.__TP3D_FAKE_SUPABASE_CONTROL__.setOrgQueriesUnavailable(true);
    window.__TP3D_TEST_ORG_FAILURE__ = control.waitForOrgQueryFailure(count);
    return count;
  });
  await clickWorkspaceOption(page, 'Workspace B');
  const observedFailure = await page.evaluate(async () => {
    const failure = await window.__TP3D_TEST_ORG_FAILURE__;
    delete window.__TP3D_TEST_ORG_FAILURE__;
    return failure;
  });
  assert.equal(failureBaseline, 0);
  assert.ok(observedFailure.operation);

  await page.evaluate(() => {
    window.__TP3D_FAKE_SUPABASE_CONTROL__.setOrgQueriesUnavailable(false);
  });
  await page.evaluate(async () => {
    await window.__TP3D_FAKE_SUPABASE_CONTROL__.emitAuth('SIGNED_OUT', null);
  });
  await page.waitForFunction(() => document.body && document.body.dataset.auth === 'signed_out');
  await page.evaluate(async session => {
    await window.__TP3D_FAKE_SUPABASE_CONTROL__.emitAuth('SIGNED_IN', session);
  }, sessionFor('user-a'));
  await waitForSignedInOwner(page, 'user-a', ORG_B);

  const reset = await switchWorkspaceAndWait(page, ORG_A, 'Workspace A');
  assert.equal(reset.activeOrgId, ORG_A);
  const recovered = await switchWorkspaceAndWait(page, ORG_B, 'Workspace B');
  assert.equal(recovered.activeOrgId, ORG_B);
  assert.equal(recovered.after.active, false);
  assert.equal(recovered.after.orgReady, true);
  assert.equal(recovered.after.billingReady, true);
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});

test('auth user switching A to B to A replaces user-scoped workspace state', async t => {
  const scenario = await harness.createScenario(signedInScenario(['user-a', 'user-b']));
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  await page.evaluate(async session => {
    await window.__TP3D_FAKE_SUPABASE_CONTROL__.emitAuth('SIGNED_IN', session);
  }, sessionFor('user-b'));
  await waitForSignedInOwner(page, 'user-b', ORG_B);

  await page.evaluate(async session => {
    await window.__TP3D_FAKE_SUPABASE_CONTROL__.emitAuth('SIGNED_IN', session);
  }, sessionFor('user-a'));
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const snapshot = await readRuntimeSnapshot(page);
  assert.deepEqual(
    snapshot.fakeSupabase.authEvents
      .filter(entry => entry.event === 'SIGNED_IN')
      .map(entry => entry.userId),
    ['user-b', 'user-a']
  );
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});
