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

function billingResponse(plan, overrides = {}) {
  return {
    plan,
    status: 'active',
    entitlementStatus: 'active',
    workspaceIncluded: true,
    workspaceCount: 1,
    workspaceLimit: 3,
    billingOwnerUserId: 'user-a',
    canManageBilling: true,
    ...overrides,
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

async function sendWorkspaceSwitchSyncAndObserve(sender, receiver, payload) {
  const storageKey = 'tp3d:workspace-switch-state-sync';
  await receiver.evaluate(({ expectedKey, expectedReason }) => {
    let timeoutId;
    let storageHandler;
    window.__TP3D_TEST_WORKSPACE_SYNC_OBSERVED__ = new Promise((resolve, reject) => {
      storageHandler = event => {
        if (!event || event.key !== expectedKey || !event.newValue) return;
        let parsed = null;
        try {
          parsed = JSON.parse(event.newValue);
        } catch {
          return;
        }
        if (!parsed || String(parsed.reason || '') !== expectedReason) return;
        queueMicrotask(() => {
          window.removeEventListener('storage', storageHandler);
          window.clearTimeout(timeoutId);
          const billing = window.__TP3D_BILLING && window.__TP3D_BILLING.getBillingState
            ? window.__TP3D_BILLING.getBillingState()
            : null;
          resolve({
            activeOrgId: window.OrgContext.getActiveOrgId(),
            billingOrgId: billing && billing.orgId ? String(billing.orgId) : null,
            localOrgId: window.localStorage.getItem('tp3d:active-org-id'),
            route: window.location.hash,
            state: window.TruckPackerApp.getWorkspaceSwitchState(),
          });
        });
      };
      window.addEventListener('storage', storageHandler);
      timeoutId = window.setTimeout(() => {
        window.removeEventListener('storage', storageHandler);
        reject(new Error(`Timed out waiting for workspace sync ${expectedReason}.`));
      }, 10000);
    });
  }, { expectedKey: storageKey, expectedReason: String(payload.reason || '') });

  await sender.evaluate(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: payload });

  return receiver.evaluate(async () => {
    const observed = await window.__TP3D_TEST_WORKSPACE_SYNC_OBSERVED__;
    delete window.__TP3D_TEST_WORKSPACE_SYNC_OBSERVED__;
    return observed;
  });
}

async function openWorkspaceSyncSender(scenario) {
  const page = await scenario.context.newPage();
  await page.goto(`${harness.baseUrl}/__workspace-sync-sender__`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function armWindowEvent(page, eventType) {
  await page.evaluate(type => {
    if (!window.__TP3D_TEST_WINDOW_EVENTS__) window.__TP3D_TEST_WINDOW_EVENTS__ = {};
    window.__TP3D_TEST_WINDOW_EVENTS__[type] = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener(type, handler);
        reject(new Error(`Timed out waiting for window ${type} event.`));
      }, 15000);
      const handler = event => {
        window.clearTimeout(timeoutId);
        resolve({ type: event.type, online: window.navigator.onLine });
      };
      window.addEventListener(type, handler, { once: true });
    });
  }, eventType);
}

async function readArmedWindowEvent(page, eventType) {
  return page.evaluate(async type => {
    const result = await window.__TP3D_TEST_WINDOW_EVENTS__[type];
    delete window.__TP3D_TEST_WINDOW_EVENTS__[type];
    return result;
  }, eventType);
}

async function armBillingPlan(page, plan) {
  await page.evaluate(expectedPlan => {
    window.__TP3D_TEST_BILLING_STATE__ = new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timeoutId = window.setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for billing plan ${expectedPlan}.`));
      }, 15000);
      unsubscribe = window.__TP3D_BILLING.subscribeBilling(state => {
        if (!state || state.plan !== expectedPlan) return;
        window.clearTimeout(timeoutId);
        unsubscribe();
        resolve(state);
      });
    });
  }, plan);
}

async function readArmedBillingPlan(page) {
  return page.evaluate(async () => {
    const state = await window.__TP3D_TEST_BILLING_STATE__;
    delete window.__TP3D_TEST_BILLING_STATE__;
    return state;
  });
}

async function reproduceStaleAuthUserResult(page, operation) {
  const nextSession = sessionFor('user-b');
  nextSession.user.banned_until = null;
  return page.evaluate(async ({ operationName, session }) => {
    const api = window.SupabaseClient;
    const control = window.__TP3D_FAKE_SUPABASE_CONTROL__;
    if (!api || !control) throw new Error('Auth reproduction controls are unavailable.');

    const readAuth = () => {
      const state = api.getAuthState();
      return {
        epoch: api.getAuthEpoch(),
        status: state && state.status ? state.status : null,
        userId: state && state.user && state.user.id ? String(state.user.id) : null,
        sessionUserId: state && state.session && state.session.user && state.session.user.id
          ? String(state.session.user.id)
          : null,
        token: state && state.session && state.session.access_token
          ? String(state.session.access_token)
          : null,
      };
    };

    let stopAuthWait = () => {};
    let switchPromise = Promise.resolve();
    const originalDateNow = Date.now;
    try {
      control.setGetUserMode('deferred');
      Date.now = () => originalDateNow() + 60000;

      const requestCount = control.snapshot().getUserRequests.length;
      const nextUserReady = new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          stopAuthWait();
          reject(new Error(`Timed out waiting for authoritative auth user ${session.user.id}.`));
        }, 10000);
        stopAuthWait = api.onAuthStateChange((event, authSession) => {
          const eventUserId = authSession && authSession.user && authSession.user.id
            ? String(authSession.user.id)
            : null;
          if (eventUserId !== String(session.user.id)) return;
          queueMicrotask(() => {
            const current = readAuth();
            if (current.userId !== String(session.user.id)
              || current.sessionUserId !== String(session.user.id)) return;
            window.clearTimeout(timeoutId);
            stopAuthWait();
            resolve({ event, current });
          });
        });
      });

      const stalePromise = operationName === 'getUserSingleFlight'
        ? api.getUserSingleFlight()
        : null;
      if (operationName === 'validateSessionRevocation') {
        window.dispatchEvent(new Event('focus'));
      }
      const request = await control.waitForGetUserRequest(requestCount);
      switchPromise = control.emitAuth('SIGNED_IN', session);
      await nextUserReady;
      const afterSwitch = readAuth();

      if (!control.resolveGetUser(request.index)) {
        throw new Error(`Unable to resolve deferred getUser request ${request.index}.`);
      }
      const staleResult = stalePromise
        ? await stalePromise
        : await new Promise(resolve => window.requestAnimationFrame(() => resolve(null)));
      const afterStaleResult = readAuth();
      await switchPromise;

      return {
        afterSwitch,
        afterStaleResult,
        final: readAuth(),
        request,
        staleResultUserId: staleResult && staleResult.id
          ? String(staleResult.id)
          : staleResult && staleResult.userId
            ? String(staleResult.userId)
            : null,
      };
    } finally {
      Date.now = originalDateNow;
      stopAuthWait();
      await switchPromise.catch(() => {});
    }
  }, { operationName: operation, session: nextSession });
}

async function settleDeferredAuthRequest(page, { operation, events = [], resolution = {} }) {
  return page.evaluate(async ({ operationName, authEvents, requestResolution }) => {
    const api = window.SupabaseClient;
    const control = window.__TP3D_FAKE_SUPABASE_CONTROL__;
    if (!api || !control) throw new Error('Auth regression controls are unavailable.');

    const readAuth = () => {
      const state = api.getAuthState();
      return {
        epoch: api.getAuthEpoch(),
        status: state && state.status ? state.status : null,
        userId: state && state.user && state.user.id ? String(state.user.id) : null,
        userMarker: state && state.user && state.user.user_metadata
          ? state.user.user_metadata.auth_marker || null
          : null,
        sessionUserId: state && state.session && state.session.user && state.session.user.id
          ? String(state.session.user.id)
          : null,
        token: state && state.session && state.session.access_token
          ? String(state.session.access_token)
          : null,
      };
    };
    const summarizeResult = value => {
      const user = value && value.id
        ? value
        : value && value.data && value.data.user
          ? value.data.user
          : null;
      return {
        userId: user && user.id ? String(user.id) : null,
        userMarker: user && user.user_metadata ? user.user_metadata.auth_marker || null : null,
        reason: value && value.reason ? String(value.reason) : null,
        signedOut: Boolean(value && value.signedOut),
      };
    };

    const originalDateNow = Date.now;
    try {
      control.setGetUserMode('deferred');
      Date.now = () => originalDateNow() + 60000;
      const requestCount = control.snapshot().getUserRequests.length;
      let signedOutEvent = null;
      if (operationName === 'validateSessionRevocation' && requestResolution.expectSignedOut) {
        signedOutEvent = new Promise(resolve => {
          window.addEventListener('tp3d:auth-signed-out', resolve, { once: true });
        });
      }
      const pending = operationName === 'validateSessionRevocation'
        ? null
        : api.getUserSingleFlight();
      if (operationName === 'validateSessionRevocation') window.dispatchEvent(new Event('focus'));
      const request = await control.waitForGetUserRequest(requestCount);

      for (const entry of authEvents) {
        await control.emitAuth(entry.event, entry.session);
      }
      const beforeSettlement = readAuth();

      const settled = requestResolution.error
        ? control.resolveGetUserError(
          request.index,
          requestResolution.error.message,
          requestResolution.error.status
        )
        : control.resolveGetUser(request.index, requestResolution.user);
      if (!settled) throw new Error(`Unable to settle deferred getUser request ${request.index}.`);

      let result = null;
      if (pending) {
        result = await pending;
      } else if (signedOutEvent) {
        await signedOutEvent;
      } else {
        await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
      }
      return {
        beforeSettlement,
        afterSettlement: readAuth(),
        result: summarizeResult(result),
        request,
      };
    } finally {
      Date.now = originalDateNow;
    }
  }, { operationName: operation, authEvents: events, requestResolution: resolution });
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
  t.diagnostic(`Observed window.TruckPackerApp._debug facade: ${snapshot.facadeDebugKeys.join(', ')}`);
  t.diagnostic(`Observed billing globals: ${snapshot.billingGlobalKeys.join(', ') || '(none)'}`);
  t.diagnostic(`Observed __TP3D_BILLING surface: ${snapshot.billingDebugKeys.join(', ') || '(none)'}`);
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

test('stale getUserSingleFlight result cannot replace newer authoritative auth user', async t => {
  const scenario = await harness.createScenario(signedInScenario(['user-a', 'user-b']));
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const observed = await reproduceStaleAuthUserResult(page, 'getUserSingleFlight');
  assert.equal(observed.afterSwitch.userId, 'user-b');
  assert.equal(observed.afterSwitch.sessionUserId, 'user-b');
  assert.equal(observed.afterStaleResult.sessionUserId, 'user-b');
  assert.equal(observed.afterStaleResult.userId, 'user-b', JSON.stringify(observed));
});

test('stale revocation validation result cannot replace newer authoritative auth user', async t => {
  const scenario = await harness.createScenario(signedInScenario(['user-a', 'user-b']));
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const observed = await reproduceStaleAuthUserResult(page, 'validateSessionRevocation');
  assert.equal(observed.afterSwitch.userId, 'user-b');
  assert.equal(observed.afterSwitch.sessionUserId, 'user-b');
  assert.equal(observed.afterStaleResult.sessionUserId, 'user-b');
  assert.equal(observed.afterStaleResult.userId, 'user-b', JSON.stringify(observed));
});

test('stale getUser result cannot restore user A after authoritative sign-out', async t => {
  const scenario = await harness.createScenario(signedInScenario());
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const observed = await settleDeferredAuthRequest(page, {
    operation: 'getUserSingleFlight',
    events: [{ event: 'SIGNED_OUT', session: null }],
    resolution: { user: sessionFor('user-a').user },
  });
  assert.equal(observed.beforeSettlement.status, 'signed_out');
  assert.equal(observed.afterSettlement.status, 'signed_out');
  assert.equal(observed.afterSettlement.userId, null, JSON.stringify(observed));
  assert.equal(observed.afterSettlement.sessionUserId, null);
  assert.equal(observed.result.userId, null);
});

test('stale revoked response cannot sign out newer authoritative user B', async t => {
  const scenario = await harness.createScenario(signedInScenario(['user-a', 'user-b']));
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const observed = await settleDeferredAuthRequest(page, {
    operation: 'validateSessionRevocation',
    events: [{ event: 'SIGNED_IN', session: sessionFor('user-b') }],
    resolution: { error: { message: 'Invalid token', status: 401 } },
  });
  assert.equal(observed.beforeSettlement.userId, 'user-b');
  assert.equal(observed.afterSettlement.status, 'signed_in');
  assert.equal(observed.afterSettlement.userId, 'user-b', JSON.stringify(observed));
  assert.equal(observed.afterSettlement.sessionUserId, 'user-b');
});

test('A to B to A with a changed token rejects the original A result', async t => {
  const scenario = await harness.createScenario(signedInScenario(['user-a', 'user-b']));
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const currentA = sessionFor('user-a');
  currentA.access_token = 'access-user-a-new';
  currentA.user.user_metadata.auth_marker = 'current-a-new-token';
  const staleA = sessionFor('user-a').user;
  staleA.user_metadata.auth_marker = 'stale-a-old-token';
  const observed = await settleDeferredAuthRequest(page, {
    operation: 'getUserSingleFlight',
    events: [
      { event: 'SIGNED_IN', session: sessionFor('user-b') },
      { event: 'SIGNED_IN', session: currentA },
    ],
    resolution: { user: staleA },
  });
  assert.equal(observed.beforeSettlement.token, 'access-user-a-new');
  assert.equal(observed.afterSettlement.userId, 'user-a');
  assert.equal(observed.afterSettlement.userMarker, 'current-a-new-token', JSON.stringify(observed));
  assert.ok(observed.result.userId, JSON.stringify(observed));
  assert.notEqual(observed.result.userMarker, 'stale-a-old-token');
});

test('TOKEN_REFRESHED invalidates an older getUser result for the same user', async t => {
  const scenario = await harness.createScenario(signedInScenario());
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const refreshedA = sessionFor('user-a');
  refreshedA.access_token = 'access-user-a-refreshed';
  refreshedA.user.user_metadata.auth_marker = 'current-refreshed';
  const staleA = sessionFor('user-a').user;
  staleA.user_metadata.auth_marker = 'stale-pre-refresh';
  const observed = await settleDeferredAuthRequest(page, {
    operation: 'getUserSingleFlight',
    events: [{ event: 'TOKEN_REFRESHED', session: refreshedA }],
    resolution: { user: staleA },
  });
  assert.equal(observed.beforeSettlement.token, 'access-user-a-refreshed');
  assert.equal(observed.afterSettlement.token, 'access-user-a-refreshed');
  assert.equal(observed.afterSettlement.userMarker, 'current-refreshed', JSON.stringify(observed));
  assert.equal(observed.result.userMarker, 'current-refreshed');
});

test('raw getUser cooldown data is not served across an auth epoch transition', async t => {
  const scenario = await harness.createScenario(signedInScenario());
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const observed = await page.evaluate(async () => {
    const api = window.SupabaseClient;
    const control = window.__TP3D_FAKE_SUPABASE_CONTROL__;
    const client = api.getClient();
    const originalDateNow = Date.now;
    const cacheTime = originalDateNow() + 60000;
    try {
      control.setGetUserMode('deferred');
      Date.now = () => cacheTime;
      const firstCount = control.snapshot().getUserRequests.length;
      const firstRaw = client.auth.getUser();
      const firstRequest = await control.waitForGetUserRequest(firstCount);
      control.resolveGetUser(firstRequest.index, sessionForUser('user-a', 'stale-cache'));
      const firstResult = await firstRaw;

      api.resetAccountBundleCache('def-009-cache-regression');
      const secondCount = control.snapshot().getUserRequests.length;
      Date.now = () => cacheTime + 100;
      const secondRaw = client.auth.getUser();
      const outcome = await Promise.race([
        control.waitForGetUserRequest(secondCount).then(request => ({ type: 'request', request })),
        secondRaw.then(result => ({ type: 'cached', result })),
      ]);
      Date.now = originalDateNow;
      if (outcome.type === 'request') {
        control.resolveGetUser(outcome.request.index, sessionForUser('user-a', 'current-epoch'));
      }
      const secondResult = await secondRaw;
      return {
        firstUserId: firstResult.data && firstResult.data.user ? firstResult.data.user.id : null,
        firstMarker: firstResult.data && firstResult.data.user
          ? firstResult.data.user.user_metadata.auth_marker
          : null,
        outcome: outcome.type,
        secondUserId: secondResult.data && secondResult.data.user ? secondResult.data.user.id : null,
        secondMarker: secondResult.data && secondResult.data.user
          ? secondResult.data.user.user_metadata.auth_marker
          : null,
      };
    } finally {
      Date.now = originalDateNow;
    }

    function sessionForUser(userId, marker) {
      return {
        id: userId,
        email: `${userId}@example.test`,
        user_metadata: { auth_marker: marker },
      };
    }
  });
  assert.equal(observed.firstUserId, 'user-a');
  assert.equal(observed.firstMarker, 'stale-cache');
  assert.equal(observed.outcome, 'request', JSON.stringify(observed));
  assert.equal(observed.secondUserId, 'user-a');
  assert.equal(observed.secondMarker, 'current-epoch');
});

test('current-context revoked response still enforces local sign-out', async t => {
  const scenario = await harness.createScenario(signedInScenario());
  t.after(() => scenario.close());
  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const observed = await settleDeferredAuthRequest(page, {
    operation: 'validateSessionRevocation',
    resolution: { error: { message: 'Invalid token', status: 401 }, expectSignedOut: true },
  });
  assert.equal(observed.beforeSettlement.userId, 'user-a');
  assert.equal(observed.afterSettlement.status, 'signed_out', JSON.stringify(observed));
  assert.equal(observed.afterSettlement.userId, null);
  assert.equal(observed.afterSettlement.sessionUserId, null);
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

test('TRIAGE-3B older conflicting active readiness can replace a newer completed target', async t => {
  const scenario = await harness.createScenario(multiWorkspaceScenario());
  t.after(() => scenario.close());

  const receiver = await scenario.openPage();
  const sender = await openWorkspaceSyncSender(scenario);
  await scenario.waitForAppReady(receiver);
  await waitForSignedInOwner(receiver, 'user-a', ORG_A);

  await switchWorkspaceAndWait(receiver, ORG_B, 'Workspace B');
  await switchWorkspaceAndWait(receiver, ORG_A, 'Workspace A');
  await switchWorkspaceAndWait(receiver, ORG_B, 'Workspace B');
  const before = await receiver.evaluate(() => ({
    activeOrgId: window.OrgContext.getActiveOrgId(),
    localOrgId: window.localStorage.getItem('tp3d:active-org-id'),
    route: window.location.hash,
    state: window.TruckPackerApp.getWorkspaceSwitchState(),
  }));
  assert.equal(before.activeOrgId, ORG_B);
  assert.equal(before.state.active, false);
  assert.equal(before.state.toOrgId, ORG_B);
  assert.ok(before.state.version > 1, JSON.stringify(before));

  const staleTimestamp = Math.max(1, Number(before.state.finishedAt) - 5000);
  const after = await sendWorkspaceSwitchSyncAndObserve(sender, receiver, {
    active: true,
    fromOrgId: ORG_B,
    toOrgId: ORG_A,
    source: 'triage-3b-older-tab',
    startedAt: staleTimestamp,
    finishedAt: 0,
    version: 1,
    localStateReady: false,
    orgReady: false,
    billingReady: false,
    remote: false,
    reason: 'triage-3b-older-conflicting-active',
    userId: 'user-a',
    tabId: 'triage-3b-stale-tab',
    ts: staleTimestamp,
  });
  t.diagnostic(`TRIAGE-3B scenario A: ${JSON.stringify({ before, after })}`);

  assert.equal(after.activeOrgId, ORG_B, JSON.stringify({ before, after }));
  assert.equal(after.localOrgId, ORG_B);
  assert.equal(after.state.active, true);
  assert.equal(after.state.toOrgId, ORG_A);
  assert.equal(after.state.version, 1);
  assert.equal(after.state.remote, true);
  assert.equal(after.route, before.route);
});

test('TRIAGE-3B older completion for another target cannot finish a newer local switch', async t => {
  const scenario = await harness.createScenario(multiWorkspaceScenario());
  t.after(() => scenario.close());

  const receiver = await scenario.openPage();
  const sender = await openWorkspaceSyncSender(scenario);
  await scenario.waitForAppReady(receiver);
  await waitForSignedInOwner(receiver, 'user-a', ORG_A);
  scenario.billing.setDeferred();

  await receiver.evaluate(orgId => window.OrgContext.setActiveOrgId(orgId, {
    source: 'triage-3b-newer-local-switch',
  }), ORG_B);
  const before = await receiver.evaluate(() => ({
    activeOrgId: window.OrgContext.getActiveOrgId(),
    localOrgId: window.localStorage.getItem('tp3d:active-org-id'),
    route: window.location.hash,
    state: window.TruckPackerApp.getWorkspaceSwitchState(),
  }));
  assert.equal(before.activeOrgId, ORG_B);
  assert.equal(before.state.active, true, JSON.stringify(before));
  assert.equal(before.state.toOrgId, ORG_B);
  assert.equal(before.state.remote, false);

  const staleTimestamp = Math.max(1, Number(before.state.startedAt) - 5000);
  const after = await sendWorkspaceSwitchSyncAndObserve(sender, receiver, {
    active: false,
    fromOrgId: ORG_B,
    toOrgId: ORG_A,
    source: 'triage-3b-older-tab',
    startedAt: staleTimestamp - 1000,
    finishedAt: staleTimestamp,
    version: 1,
    localStateReady: true,
    orgReady: true,
    billingReady: true,
    remote: true,
    reason: 'triage-3b-stale-completion',
    userId: 'user-a',
    tabId: 'triage-3b-stale-tab',
    ts: staleTimestamp,
  });
  t.diagnostic(`TRIAGE-3B scenario B: ${JSON.stringify({ before, after })}`);

  assert.equal(after.activeOrgId, ORG_B, JSON.stringify({ before, after }));
  assert.equal(after.localOrgId, ORG_B);
  assert.equal(after.state.active, true);
  assert.equal(after.state.toOrgId, ORG_B);
  assert.equal(after.state.version, before.state.version);
  assert.equal(after.state.remote, false);
  assert.equal(after.route, before.route);
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

test('deferred billing rejects a stale auth epoch and lets the latest authoritative generation own state', async t => {
  const scenario = await harness.createScenario(signedInScenario(['user-a', 'user-b']));
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);
  scenario.billing.setDeferred();

  const switchToB = page.evaluate(session =>
    window.__TP3D_FAKE_SUPABASE_CONTROL__.emitAuth('SIGNED_IN', session), sessionFor('user-b'));
  await scenario.billing.waitForPendingCount(1);
  const firstPending = scenario.billing.pendingSnapshot();
  assert.equal(new URL(firstPending[0].url).searchParams.get('organization_id'), ORG_B);

  const switchBackToA = page.evaluate(session =>
    window.__TP3D_FAKE_SUPABASE_CONTROL__.emitAuth('SIGNED_IN', session), sessionFor('user-a'));
  await scenario.billing.release(0, billingResponse('free', {
    status: 'past_due',
    entitlementStatus: 'workspace_limit_reached',
    workspaceIncluded: false,
    workspaceLimit: 0,
    billingOwnerUserId: 'user-b',
    canManageBilling: false,
  }));

  await scenario.billing.waitForPendingCount(1);
  const latestPending = scenario.billing.pendingSnapshot();
  assert.equal(new URL(latestPending[0].url).searchParams.get('organization_id'), ORG_A);
  await scenario.billing.release(0, billingResponse('pro'));

  const authResults = await Promise.allSettled([switchToB, switchBackToA]);
  assert.deepEqual(authResults.map(result => result.status), ['fulfilled', 'fulfilled']);
  await waitForSignedInOwner(page, 'user-a', ORG_A);

  const blockedGeneration = await page.evaluate(() => window.__TP3D_BILLING.getBillingState());
  assert.equal(blockedGeneration.entitlementStatus, 'billing_unavailable');
  assert.match(blockedGeneration.error && blockedGeneration.error.message || '', /identity mismatch/i);

  await page.evaluate(() => window.__TP3D_BILLING.clearBillingState());
  await armBillingPlan(page, 'Pro');
  const authoritativeRecovery = page.evaluate(() => window.__TP3D_BILLING.refreshBilling(true));
  await scenario.billing.waitForPendingCount(1);
  await scenario.billing.release(0, billingResponse('pro'));
  await authoritativeRecovery;
  const finalBilling = await readArmedBillingPlan(page);
  assert.equal(finalBilling.plan, 'Pro', JSON.stringify(finalBilling));
  assert.equal(finalBilling.orgId, ORG_A);
  assert.equal(finalBilling.entitlementStatus, 'active');
  assert.equal(await page.locator('#modal-root .modal-overlay:visible').count(), 0,
    'the stale blocking entitlement must not win the access gate');
  assert.equal(scenario.diagnostics.pageErrors.length, 0, JSON.stringify(scenario.diagnostics.pageErrors));
});

test('offline workspace activity recovers billing after the native online event', async t => {
  const scenario = await harness.createScenario(multiWorkspaceScenario());
  t.after(() => scenario.close());

  const page = await scenario.openPage();
  await scenario.waitForAppReady(page);
  await waitForSignedInOwner(page, 'user-a', ORG_A);
  scenario.billing.setAutomatic({ message: 'offline billing transport unavailable' }, 503);
  const failedSwitch = await switchWorkspaceAndWait(page, ORG_B, 'Workspace B');
  assert.equal(failedSwitch.activeOrgId, ORG_B);
  const unavailableBilling = await page.evaluate(() => window.__TP3D_BILLING.getBillingState());
  assert.ok(!unavailableBilling.ok || unavailableBilling.entitlementStatus === 'billing_unavailable',
    JSON.stringify(unavailableBilling));

  await armWindowEvent(page, 'offline');
  await scenario.context.setOffline(true);
  const offlineEvent = await readArmedWindowEvent(page, 'offline');
  assert.equal(offlineEvent.online, false);

  scenario.billing.setDeferred();
  await armBillingPlan(page, 'Pro');

  await armWindowEvent(page, 'online');
  await scenario.context.setOffline(false);
  const onlineEvent = await readArmedWindowEvent(page, 'online');
  assert.equal(onlineEvent.online, true);
  const recoveryRefresh = page.evaluate(() => {
    window.__TP3D_BILLING.clearBillingState();
    return window.__TP3D_BILLING.refreshBilling(true);
  });
  await scenario.billing.waitForPendingCount(1);
  const recoveryPending = scenario.billing.pendingSnapshot();
  assert.equal(new URL(recoveryPending[0].url).searchParams.get('organization_id'), ORG_B);
  await scenario.billing.release(0, billingResponse('pro'));
  await recoveryRefresh;

  const recoveredBilling = await readArmedBillingPlan(page);
  assert.equal(recoveredBilling.plan, 'Pro');
  assert.equal(recoveredBilling.entitlementStatus, 'active');
  assert.equal(await page.evaluate(() => window.navigator.onLine), true);
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
