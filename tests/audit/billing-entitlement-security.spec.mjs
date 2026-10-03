// billing entitlement security: contract tests from the former security suite.

import {
  assert,
  billingServiceUrl,
  billingStatusPath,
  createBillingStatusDirectIdentityRuntime,
  createPhase2BillingLockHarness,
  debuggerPath,
  enforceWorkspaceSlugIntegrityMigrationPath,
  fs,
  loadRequestedDirectBindingRuntime,
  orgTransferOwnershipPath,
  readAppSource,
  settingsOverlayPath,
  signupAutoOrgUuidMigrationPath,
  stripTypeScriptTypes,
  stripeCheckoutPath,
  stripePortalPath,
  test,
  vm,
} from '../fixtures/security-invariants-support.mjs';

test('isAllowedBillingRedirectUrl only allows https stripe origins', async () => {
  const { isAllowedBillingRedirectUrl } = await import(
    `${billingServiceUrl.href}?t=${Date.now()}-${Math.random()}`
  );

  assert.equal(isAllowedBillingRedirectUrl('https://checkout.stripe.com/c/pay_123'), true);
  assert.equal(isAllowedBillingRedirectUrl('https://billing.stripe.com/p/session_123'), true);
  assert.equal(isAllowedBillingRedirectUrl('https://subdomain.stripe.com/path'), true);
  assert.equal(isAllowedBillingRedirectUrl('http://checkout.stripe.com/c/pay_123'), false);
  assert.equal(isAllowedBillingRedirectUrl('https://evil.example.com/stripe'), false);
  assert.equal(isAllowedBillingRedirectUrl('javascript:alert(1)'), false);
});

test('billing service does not depend on legacy auth/session state', async () => {
  const source = await fs.readFile(new URL('../../src/data/services/billing.service.js', import.meta.url), 'utf8');
  assert.equal(source.includes('../../auth/session.js'), false);
});

test('stripe checkout idempotency key is scoped by organization id', async () => {
  const source = await fs.readFile(stripeCheckoutPath, 'utf8');
  const fnStart = source.indexOf('function checkoutIdempotencyKey(');
  const fnEnd = source.indexOf('function getPortalConfigurationId', fnStart);
  const fn = fnStart >= 0 && fnEnd > fnStart ? source.slice(fnStart, fnEnd) : '';

  assert.match(fn, /function checkoutIdempotencyKey\(userId: string, organizationId: string, priceId: string\)/,
    'checkout idempotency key helper must accept organizationId');
  assert.match(fn, /`checkout:\$\{userId\}:\$\{organizationId\}:\$\{priceId\}:\$\{utcMinuteBucket\(\)\}`/,
    'checkout idempotency key must include user, organization, price, and minute bucket');
  assert.match(source, /checkoutIdempotencyKey\(user\.id, organizationId, price_id\)/,
    'checkout session creation must pass organizationId into the idempotency key');

  const minute = '202605131234';
  const keyFor = (userId, organizationId, priceId) => `checkout:${userId}:${organizationId}:${priceId}:${minute}`;
  assert.equal(
    keyFor('user-a', 'org-a', 'price-pro-monthly'),
    keyFor('user-a', 'org-a', 'price-pro-monthly'),
    'same user, org, price, and minute should reuse the same idempotency key',
  );
  assert.notEqual(
    keyFor('user-a', 'org-a', 'price-pro-monthly'),
    keyFor('user-a', 'org-b', 'price-pro-monthly'),
    'same user and price in different orgs must not collide',
  );
});

test('billing pump never runs without proven auth or usable session', async () => {
  const app = await readAppSource();

  // maybeScheduleBillingRefresh has an auth gate before any orgId/retry logic
  assert.match(app, /function maybeScheduleBillingRefresh[\s\S]*?isAuthProven[\s\S]*?skip:auth-not-proven/);

  // Gate checks session expires_at for fallback when not proven
  assert.match(app, /maybeScheduleBillingRefresh[\s\S]*?expires_at \* 1000[\s\S]*?> Date\.now\(\)/);
});

test('phase 1 P0 cross-profile logout: billing-status 401 triggers local sign-out cleanup', async () => {
  const app = await readAppSource();
  const refreshMatch = app.match(/async function refreshBilling\b[\s\S]*?\/\*\* @param \{Record<string, any>\} billingSnapshot/);
  assert.ok(refreshMatch, 'refreshBilling function must be extractable');
  const refreshBody = refreshMatch[0];

  const guardIdx = refreshBody.indexOf('refresh:session-revoked-401');
  assert.ok(guardIdx > 0, 'refreshBilling must include a safe billing 401 debug event');
  const guard = refreshBody.slice(Math.max(0, guardIdx - 450), guardIdx + 700);

  assert.match(guard, /result && !result\.pending && !result\.skipped && Number\(result\.status\) === 401/,
    'billing-status 401 guard must be exact and exclude pending/skipped states');
  assert.match(guard, /SupabaseClient\.signOut\(\{ global: false, allowOffline: true \}\)/,
    'billing-status 401 must use the existing local/offline sign-out cleanup path');
  assert.match(guard, /return getBillingState\(\)/,
    'billing-status 401 branch must stop refreshBilling after starting local cleanup');
});

test('phase 1 P0 cross-profile logout: billing 401 path does not catch non-auth errors or leak token data', async () => {
  const app = await readAppSource();
  const refreshMatch = app.match(/async function refreshBilling\b[\s\S]*?\/\*\* @param \{Record<string, any>\} billingSnapshot/);
  assert.ok(refreshMatch, 'refreshBilling function must be extractable');
  const refreshBody = refreshMatch[0];

  const signOutIdx = refreshBody.indexOf('SupabaseClient.signOut({ global: false, allowOffline: true })');
  assert.ok(signOutIdx > 0, 'billing 401 sign-out call must exist');
  const guardStart = refreshBody.lastIndexOf('if (result &&', signOutIdx);
  assert.ok(guardStart > 0, 'billing 401 sign-out must be inside an explicit result guard');
  const guard = refreshBody.slice(guardStart, signOutIdx + 450);

  assert.match(guard, /Number\(result\.status\) === 401/,
    'billing sign-out must be tied to exact HTTP 401 only');
  assert.doesNotMatch(guard, /403|408|409|status\s*!==\s*null|status\s*[<>]=?\s*4|status\s*[<>]=?\s*5/i,
    'billing sign-out guard must not use broad 4xx/5xx, timeout, conflict, or org-access status patterns');
  assert.doesNotMatch(guard, /location\.reload|setTimeout[\s\S]*location\.reload/,
    'billing 401 cleanup must not introduce reload or timed reload behavior');
  assert.doesNotMatch(guard, /access_token|refresh_token|Bearer|JWT|\.token/i,
    'billing 401 cleanup must not log or reference token-sensitive values');
});

test('P0 billing retry reliability C: refreshBilling only reuses successful shared snapshots and force bypasses them', async () => {
  const app = await readAppSource();
  const refreshMatch = app.match(/async function refreshBilling\b[\s\S]*?\/\*\* @param \{Record<string, any>\} billingSnapshot/);
  assert.ok(refreshMatch, 'refreshBilling function must be extractable');
  const refreshBody = refreshMatch[0];
  const classifierMatch = app.match(/function _isShareableBillingSnapshot\(orgId, state\) \{[\s\S]*?\n\}/);
  assert.ok(classifierMatch, 'shared billing success classifier must exist');
  const classifier = classifierMatch[0];

  assert.match(classifier, /state\.ok !== true[\s\S]*return false/,
    'shared billing snapshots must require ok:true');
  assert.match(classifier, /normalizeBillingEntitlementStatus\(state\.entitlementStatus\)[\s\S]*billing_unavailable[\s\S]*return false/,
    'billing_unavailable snapshots must not be reusable shared state');
  assert.match(classifier, /state\.error[\s\S]*return false/,
    'errored shared billing snapshots must not be reusable');
  assert.match(classifier, /numericStatus[\s\S]*=== 408[\s\S]*return false/,
    'timeout shared billing snapshots must not be reusable');
  assert.match(classifier, /statusText[\s\S]*timeout[\s\S]*network/,
    'network-style failed shared billing snapshots must not be reusable');
  assert.match(refreshBody, /const shared = _readShareableBillingResult\(requestedOrgId[\s\S]*if \(!force && shared\)/,
    'refreshBilling must only reuse shareable snapshots when force is false');
});

test('P0 billing retry reliability C: cross-tab billing ignores failed snapshots and still accepts successful scoped snapshots', async () => {
  const app = await readAppSource();
  const handlerStart = app.indexOf('function _handleCrossTabBillingResult(orgId, state, fromTabId)');
  const handlerEnd = app.indexOf('\nfunction _extractOrgIdFromStorageKey', handlerStart);
  const handler = handlerStart >= 0 && handlerEnd > handlerStart ? app.slice(handlerStart, handlerEnd) : '';
  assert.ok(handler.length > 0, 'cross-tab billing handler must be extractable');

  assert.match(handler, /!_isShareableBillingSnapshot\(orgId, state\)[\s\S]*billing:cross-tab:discard-failed-shared[\s\S]*return/,
    'cross-tab handler must reject failed shared snapshots before applying state');
  assert.match(handler, /_applySharedBillingSnapshot\(orgId, state, fromTabId === 'storage' \? 'cross-tab-storage' : 'cross-tab-broadcast'\)/,
    'cross-tab handler must still apply accepted successful scoped snapshots');
  assert.match(app, /function _broadcastBillingResult\(orgId, state\)[\s\S]*!_isShareableBillingSnapshot\(orgId, state\)[\s\S]*return/,
    'BroadcastChannel sends must exclude failed billing snapshots');
  assert.match(app, /function _writeSharedBillingResult\(orgId, state\)[\s\S]*!_isShareableBillingSnapshot\(orgId, state\)[\s\S]*_clearSharedBillingResult\(orgId\)/,
    'localStorage shared billing writes must clear instead of storing failed snapshots');
});

test('P0 billing retry reliability C: Settings Billing Retry and Refresh keep progress feedback and force reasons', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /retryBtn\.disabled = true[\s\S]*retryBtn\.textContent = 'Retrying\\u2026'[\s\S]*retryBtn\.setAttribute\('aria-busy', 'true'\)[\s\S]*api\.refreshBilling\(\{ force: true, reason: 'settings-billing-retry' \}\)/,
    'Retry must visibly enter busy state and force a settings-billing-retry refresh');
  assert.match(src, /retryBtn\.removeAttribute\('aria-busy'\)[\s\S]*retryBtn\.disabled = false[\s\S]*retryBtn\.textContent = 'Retry'/,
    'Retry must restore button state after refresh completion');
  assert.match(src, /refreshBtn\.disabled = true[\s\S]*refreshBtn\.textContent = 'Refreshing\\u2026'[\s\S]*refreshBtn\.setAttribute\('aria-busy', 'true'\)[\s\S]*api\.refreshBilling\(\{ force: true, reason: 'settings-billing-refresh' \}\)/,
    'Refresh must visibly enter busy state and force a settings-billing-refresh request');
  assert.match(src, /refreshBtn\.removeAttribute\('aria-busy'\)[\s\S]*refreshBtn\.textContent = 'Refresh'/,
    'Refresh must restore button state after refresh completion');
});

test('P0 billing retry reliability C: queued forced refreshes have a completion repaint path without duplicate subscriptions', async () => {
  const app = await readAppSource();
  const settings = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(app, /let _billingRefreshQueuedWaiters = \[\]/,
    'refreshBilling must track callers waiting for a queued forced refresh');
  assert.match(app, /return force \? _waitForQueuedBillingRefresh\(\) : getBillingState\(\)/,
    'force:true callers blocked by loading must wait for queued refresh completion');
  assert.match(app, /refreshBilling\(\{ force: true, reason: 'queued' \}\)[\s\S]*\.then\(snapshot => \{[\s\S]*_resolveBillingRefreshQueuedWaiters\(snapshot\)/,
    'queued refresh completion must resolve waiting Settings callers');
  assert.match(settings, /function ensureBillingSubscription\(\)[\s\S]*if \(billingUnsubscribe\) return[\s\S]*api\.subscribeBilling\(\(\) => \{[\s\S]*renderBillingInto\(wrap\)/,
    'Settings Billing tab must use one guarded subscribeBilling render path');
  assert.match(settings, /if \(billingUnsubscribe\) \{[\s\S]*billingUnsubscribe\(\)[\s\S]*billingUnsubscribe = null/,
    'Settings overlay must clean the billing subscription on close');
});

test('P0 billing retry reliability C: billing-status Stripe calls have timeout protection', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const directStripeCalls = [...src.matchAll(/stripe\.subscriptions\.(retrieve|list)\(/g)];

  assert.match(src, /const STRIPE_BILLING_STATUS_TIMEOUT_MS = 9000/,
    'billing-status Stripe timeout must be shorter than the frontend 15s timeout');
  assert.match(src, /class BillingStatusStripeTimeoutError extends Error/,
    'billing-status must use a specific timeout error type');
  assert.match(src, /function withStripeBillingStatusTimeout\b[\s\S]*Promise\.race[\s\S]*STRIPE_BILLING_STATUS_TIMEOUT_MS/,
    'Stripe API calls must be wrapped in a bounded Promise.race');
  assert.match(src, /function billingUnavailablePayload[\s\S]*entitlementStatus: "billing_unavailable"[\s\S]*action: "retry"/,
    'Stripe timeout response must be the safe billing_unavailable-style fallback');
  assert.ok(directStripeCalls.length > 0, 'billing-status must contain Stripe subscription calls to protect');
  for (const match of directStripeCalls) {
    const before = src.slice(Math.max(0, match.index - 260), match.index);
    assert.match(before, /withStripeBillingStatusTimeout\(/,
      `Stripe ${match[1]} call must be passed through withStripeBillingStatusTimeout`);
  }
});

test('P0 billing retry reliability C: changed billing logs do not expose tokens or API keys', async () => {
  const app = await readAppSource();
  const billingStatus = await fs.readFile(billingStatusPath, 'utf8');
  const failedSharedLog = app.match(/billing:cross-tab:discard-failed-shared[\s\S]{0,220}/)?.[0] || '';
  const safeFieldsHelper = app.match(/function _billingSharedSnapshotDebugFields\(orgId, state\) \{[\s\S]*?\n\}/)?.[0] || '';
  const timeoutResponse = billingStatus.match(/function billingStatusStripeTimeoutResponse[\s\S]*?\n\}/)?.[0] || '';
  const sensitive = /access_token|refresh_token|Authorization\s*:|service_role|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET|sk_live_|sk_test_|eyJ[A-Za-z0-9._-]{20,}/i;

  assert.match(failedSharedLog, /_billingSharedSnapshotDebugFields/,
    'failed shared-state debug log must use the safe field helper');
  assert.match(safeFieldsHelper, /orgId[\s\S]*status[\s\S]*entitlementStatus[\s\S]*ok/,
    'failed shared-state debug log must be limited to safe billing fields');
  assert.doesNotMatch(failedSharedLog + timeoutResponse, sensitive,
    'changed billing reliability paths must not log or return secret-bearing values');
});

test('upgradeTrialModalToOwner is idempotent — uses data-trial-upgrade-btn guard', async () => {
  const app = await readAppSource();

  // The upgrade function checks for an existing button before inserting
  assert.match(app, /data-trial-upgrade-btn/,
    'upgradeTrialModalToOwner must use data-trial-upgrade-btn attribute');
  assert.match(app, /querySelector\(\s*'\[data-trial-upgrade-btn\]'\s*\)/,
    'upgradeTrialModalToOwner must query for existing upgrade button before inserting');
});

test('TrialExpiredModal shows immediately once billing confirms trial_expired', async () => {
  const app = await readAppSource();

  assert.doesNotMatch(app, /TRIAL_MODAL_ROLE_DEFER_MS/,
    'confirmed trial_expired billing truth must not wait on a role-resolution timer');
  assert.doesNotMatch(app, /trial-modal-deferred/,
    'trial_expired modal should not use a deferred re-entry reason');

  const trialExpiredBranchStart = app.indexOf('if (trialExpired) {');
  assert.ok(trialExpiredBranchStart > 0, 'trialExpired branch must exist');
  const trialExpiredBranch = app.slice(trialExpiredBranchStart, trialExpiredBranchStart + 220);

  assert.match(trialExpiredBranch, /showTrialExpiredModal\(s,\s*canManageBilling\);/,
    'confirmed trial_expired billing truth must render the modal immediately');
  assert.equal(trialExpiredBranch.includes('_roleResult.resolved'), false,
    'trialExpired branch must not wait for role resolution before showing the modal');
});

test('TrialExpiredModal no longer uses deferred latch state', async () => {
  const app = await readAppSource();

  assert.doesNotMatch(app, /_trialModalDeferAttemptedForOrg/,
    'trial_expired modal should not retain deferred latch state');
  assert.doesNotMatch(app, /_trialModalDeferTimer/,
    'trial_expired modal should not retain deferred timer state');
  assert.doesNotMatch(app, /defer:latch/,
    'trial_expired modal should not wait for bundle latch branches');
});

test('resolveCanManageBillingForOrg has early-out guard for missing orgId or userId', async () => {
  const app = await readAppSource();

  // Extract the function body
  const fnMatch = app.match(/function resolveCanManageBillingForOrg\b[\s\S]*?return result;/);
  assert.ok(fnMatch, 'resolveCanManageBillingForOrg function must exist');
  const fnBody = fnMatch[0];

  // Early-out guard for missing identity
  assert.ok(fnBody.includes("'missing-identity'"),
    'must log missing-identity reason when orgId or userId is missing');
  assert.ok(fnBody.includes('!normalizedOrgId || !userId'),
    'must check both normalizedOrgId and userId before proceeding');

  // Early return before Tier 1/2/3
  const guardIdx = fnBody.indexOf('!normalizedOrgId || !userId');
  const tier2Idx = fnBody.indexOf('OrgContext.getActiveRole');
  assert.ok(guardIdx < tier2Idx,
    'early-out guard must come before Tier 2 (OrgContext.getActiveRole) fallback');
});

test('tp3dDebug-only billing accessor is guarded by isTp3dDebugEnabled', async () => {
  const app = await readAppSource();

  // window['getBillingState'] assignment must be inside isTp3dDebugEnabled guard
  const debugAccessorMatch = app.match(/if \(isTp3dDebugEnabled\(\)\) \{[\s\S]*?window\['getBillingState'\]/);
  assert.ok(debugAccessorMatch,
    'window[getBillingState] must only be set when tp3dDebug is enabled');
});

test('settings members refreshes org and billing context after role or removal mutations', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function refreshMembershipContextAfterMutation\b[\s\S]*queueAccountBundleRefresh\(\{ force: true, source \}\)/,
    'membership mutations must force an account/org bundle refresh');
  assert.match(src, /refreshMembershipContextAfterMutation[\s\S]*maybeScheduleBillingRefresh\(source\)/,
    'membership mutations must route billing refresh through the existing billing pump when available');
  assert.match(src, /await loadOrgMembers\(orgId\);[\s\S]*refreshMembershipContextAfterMutation\(orgId, 'memberRole:update:refresh-context'\)/,
    'role update success must refresh members first, then org/billing context');
  assert.match(src, /await loadOrgMembers\(orgId\);[\s\S]*refreshMembershipContextAfterMutation\(orgId, 'memberRemove:refresh-context'\)/,
    'member removal success must refresh members first, then org/billing context');
});

test('phase 3C1 invite handoff notice does not expose raw tokens or scope into billing', async () => {
  const src = await readAppSource();
  const start = src.indexOf('const inviteHandoffNoticeId');
  const end = src.indexOf('if (!authListenerInstalled)', start);
  const inviteBlock = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(inviteBlock.length > 0, 'app invite handoff block must be present');
  assert.match(inviteBlock, /message\.textContent = inviteHandoffNotice\.message/,
    'invite handoff notice must render sanitized textContent rather than HTML');
  assert.doesNotMatch(inviteBlock, /innerHTML\s*=|appendChild\(.*pendingInviteToken|textContent\s*=\s*pendingInviteToken/,
    'invite handoff notice must not insert raw invite tokens into visible UI');
  assert.doesNotMatch(inviteBlock, /console\./,
    'invite handoff path must not log token-bearing invite state');
  assert.doesNotMatch(inviteBlock, /textContent\s*=[\s\S]{0,80}(pendingInviteToken|tokenFromUrl|storedToken)|showToast\([\s\S]{0,80}(pendingInviteToken|tokenFromUrl|storedToken)/,
    'invite handoff path must not display raw invite token values');
  assert.doesNotMatch(inviteBlock, /refresh_token|Bearer|JWT|service.?role|STRIPE_SECRET|RESEND_API_KEY/i,
    'invite handoff path must not reference unrelated secret-bearing values');
  assert.doesNotMatch(inviteBlock, /billing_customers|subscriptions|stripe|checkout|portal|archiveWorkspace|restoreWorkspace|transferOwnership|org-archive|org-restore/i,
    'invite handoff UI fix must not touch billing, Stripe, or workspace lifecycle behavior');
});

test('app access-loss handler is active-org 403 only and ignores transient billing states', async () => {
  const src = await readAppSource();

  assert.match(src, /function isConfirmedActiveOrgAccessDeniedResult\b/,
    'app must have a narrow confirmed access-denied classifier');
  assert.match(src, /if \(!requestOrgId \|\| !result \|\| result\.pending\) return false/,
    'pending or missing billing results must not trigger access loss');
  assert.match(src, /Number\(result\.status\) !== 403/,
    'only HTTP 403 billing results should trigger access loss');
  assert.match(src, /if \(resultOrgId && resultOrgId !== requestOrgId\) return false/,
    'wrong-org result org ids must be ignored');
  assert.match(src, /if \(resultDataOrgId && resultDataOrgId !== requestOrgId\) return false/,
    'wrong-org payload org ids must be ignored');
  assert.doesNotMatch(src, /status\) === 408[\s\S]*_orgAccessLossHandler/,
    'billing timeout must not trigger access-loss handling');
});

test('settings lost-access state uses existing feedback and blocks general members and billing controls', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function appendOrgAccessLostNotice\b[\s\S]*You no longer have access to this workspace\./,
    'settings must render the required lost-access copy');
  assert.match(src, /tp3d-org-feedback tp3d-org-feedback--error/,
    'lost-access message must use existing feedback classes');
  assert.match(src, /if \(isLockedOrgAccessLost\(ensureModalOrgId\(\)\)\)[\s\S]*appendOrgAccessLostNotice\(orgCard, 'org-general:lost-access:refresh'\)[\s\S]*\} else if \(isEditingOrg/,
    'org-general must render lost-access notice before workspace edit/view controls');
  assert.match(src, /if \(isLockedOrgAccessLost\(orgId\)\) \{[\s\S]*appendOrgAccessLostNotice\(membersCard, 'org-members:lost-access:refresh'\)[\s\S]*\} else if \(!orgUserView\.isAuthed\)/,
    'members tab must render lost-access notice before member/invite controls');
  assert.match(src, /if \(isLockedOrgAccessLost\(lockedOrgId\)\) \{[\s\S]*appendOrgAccessLostNotice\(targetEl, 'org-billing:lost-access:refresh'\)[\s\S]*return;/,
    'billing tab must early-exit before stale billing controls render');
});

test('AccountSwitcher bind is idempotent and unmount releases its listener + subscription (mount-leak characterization)', async () => {
  // Stage 5 extracted the AccountSwitcher to src/account-switcher.js; this proves the
  // mount/unmount lifecycle used by the sidebar button and the settings-overlay mount
  // (which binds on open and calls the returned unmount on close). Imports the real
  // module (no logic copied) and drives it with fakes.
  const { createAccountSwitcher } = await import('../../src/account-switcher.js');

  let liveSubscriptions = 0;
  const SessionManager = {
    subscribe() {
      liveSubscriptions += 1;
      let active = true;
      return () => { if (active) { active = false; liveSubscriptions -= 1; } };
    },
  };

  function makeButton() {
    const clickFns = new Set();
    return {
      dataset: {},
      clickListenerCount: () => clickFns.size,
      querySelector: () => ({ textContent: '' }),
      addEventListener: (type, fn) => { if (type === 'click') clickFns.add(fn); },
      removeEventListener: (type, fn) => { if (type === 'click') clickFns.delete(fn); },
      getBoundingClientRect: () => ({ width: 0 }),
    };
  }

  let renderCount = 0;
  const switcher = createAccountSwitcher({
    documentRef: { getElementById: () => null, querySelector: () => null },
    UIComponents: { showToast() {}, openDropdown() {}, closeAllDropdowns() {} },
    SessionManager,
    getOrgContext: () => ({ activeOrg: { name: 'W', role: 'owner' }, orgs: [], activeOrgId: '' }),
    isOrgContextResolved: () => true,
    isOrgContextInFlight: () => false,
    getAuthRehydratePromise: () => null,
    getSidebarAvatarView: () => ({ isAuthed: true, displayName: 'U', initials: 'U' }),
    getActiveWorkspaceInitials: () => { renderCount += 1; return 'W'; },
    renderSidebarBrandMarks: () => {},
    closeDropdowns: () => {},
    openSettingsOverlay: () => {},
    openCreateWorkspaceFlow: () => {},
    setActiveOrgId: () => Promise.resolve(),
    performUserInitiatedLogout: () => Promise.resolve(),
  });

  const btn = makeButton();
  assert.strictEqual(liveSubscriptions, 0, 'baseline: no live subscriptions');

  const unmount1 = switcher.bind(btn);
  assert.strictEqual(btn.clickListenerCount(), 1, 'bind adds exactly one click listener');
  assert.strictEqual(liveSubscriptions, 1, 'bind adds exactly one session subscription');

  const unmount2 = switcher.bind(btn);
  assert.strictEqual(unmount2, unmount1, 'second bind of the same button returns the existing unmount (idempotent)');
  assert.strictEqual(btn.clickListenerCount(), 1, 'second bind does not add a duplicate click listener');
  assert.strictEqual(liveSubscriptions, 1, 'second bind does not add a duplicate subscription');

  unmount1();
  assert.strictEqual(btn.clickListenerCount(), 0, 'unmount removes the exact click listener it added');
  assert.strictEqual(liveSubscriptions, 0, 'unmount releases the session subscription');

  // Repeated bind/unmount cycles (mirrors repeated Settings open/close) must not leak.
  for (let i = 0; i < 5; i += 1) {
    const u = switcher.bind(btn);
    u();
  }
  assert.strictEqual(liveSubscriptions, 0, 'repeated bind/unmount cycles leave zero live subscriptions');
  assert.strictEqual(btn.clickListenerCount(), 0, 'repeated bind/unmount cycles leave zero click listeners');

  // refresh() must not re-render a button that is no longer mounted.
  const renderBefore = renderCount;
  switcher.refresh();
  assert.strictEqual(renderCount, renderBefore, 'refresh does not re-render an unmounted button');
});

test('signup auto-org trigger avoids restricted-search-path uuid calls and keeps billing seed non-blocking', async () => {
  const src = await fs.readFile(signupAutoOrgUuidMigrationPath, 'utf8');

  assert.match(src, /create or replace function public\.tp3d_handle_new_user\(\)/,
    'migration must replace the signup trigger function');
  assert.match(src, /create or replace function public\.seed_billing_customer_trial_for_org\(\)/,
    'migration must replace the billing seed trigger used by signup owner membership inserts');
  assert.match(src, /set search_path = public/,
    'signup trigger should keep a restricted search_path');
  assert.match(src, /drop trigger if exists on_auth_user_create_default_org on auth\.users/,
    'migration must remove the legacy duplicate auth signup trigger');
  assert.doesNotMatch(src, /v_org_id\s*:=\s*gen_random_uuid\(\)/,
    'signup trigger must not call unqualified gen_random_uuid at runtime');
  assert.match(src, /a\.attname = 'email'[\s\S]*v_has_profile_email_column/,
    'signup trigger must tolerate profile schemas without public.profiles.email');
  assert.match(src, /a\.attname = 'updated_at'[\s\S]*v_has_member_updated_at_column/,
    'signup trigger must tolerate organization_members schemas without updated_at');
  assert.match(src, /select exists \([\s\S]*from public\.organization_members m[\s\S]*where m\.user_id = new\.id[\s\S]*into v_has_membership/,
    'signup trigger must avoid duplicate workspaces if a legacy trigger already created membership');
  assert.match(src, /if v_has_membership then[\s\S]*return new;[\s\S]*end if;/,
    'signup trigger must exit after profile upsert when membership already exists');
  assert.match(src, /insert into public\.organizations \(name, slug, owner_id, created_at, updated_at\)[\s\S]*returning id into v_org_id/,
    'signup trigger must let organizations.id default generate the org id');
  assert.match(src, /set slug = v_org_id::text/,
    'signup trigger must preserve the historical org-id slug shape after insert');
  assert.match(src, /insert into public\.organization_members[\s\S]*'owner'::public\.org_member_role/,
    'signup trigger must still add the new user as workspace owner');
  assert.match(src, /exception\s+when others[\s\S]*billing_customer trial seed skipped[\s\S]*return new;/,
    'optional billing trial seed failures must not abort auth signup');
  assert.match(src, /pg_catalog\.pg_attribute[\s\S]*a\.attname = 'user_id'[\s\S]*v_has_user_id_column/,
    'billing seed should tolerate legacy billing_customers tables with user_id columns');
  assert.match(src, /execute[\s\S]*insert into public\.billing_customers[\s\S]*user_id[\s\S]*using new\.organization_id, new\.user_id/,
    'billing seed should populate legacy user_id when that column exists');
});

test('Packet 3 enforces workspace slug integrity without redefining signup and without changing Packet 2 entitlement logic', async () => {
  const migration = await fs.readFile(enforceWorkspaceSlugIntegrityMigrationPath, 'utf8');

  assert.match(migration, /alter column slug set not null/i,
    'Packet 3 must make slug non-null');
  assert.match(migration, /create unique index organizations_slug_lower_idx[\s\S]*on public\.organizations \(lower\(slug\)\)/i,
    'Packet 3 must enforce case-insensitive uniqueness via a lower(slug) unique index');
  assert.match(migration, /add constraint organizations_slug_format_check[\s\S]*check \(slug ~ '\^\[a-z0-9-\]\{1,100\}\$'\)/,
    'Packet 3 must enforce a bounded, safe-character slug format');
  assert.match(migration, /before update of slug on public\.organizations/i,
    'Packet 3 must guard slug with a column-scoped UPDATE trigger');
  assert.match(migration, /current_user in \('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin'\)/,
    'the slug guard must reuse the proven invoker-rights trusted-role pattern');
  assert.match(migration, /partition by lower\(slug\)/i,
    'the backfill must deterministically converge duplicate and case-variant slugs');
  assert.doesNotMatch(migration, /create or replace function public\.tp3d_handle_new_user/i,
    'Packet 3 must not redefine the signup trigger');

  const guardStart = migration.indexOf('create or replace function public.tp3d_guard_organizations_slug_update()');
  const guardEnd = migration.indexOf('drop trigger if exists tp3d_guard_organizations_slug_update', guardStart);
  const guardFn = guardStart >= 0 && guardEnd > guardStart ? migration.slice(guardStart, guardEnd) : '';
  assert.ok(guardFn, 'the slug guard function must be extractable');
  assert.doesNotMatch(guardFn, /\bsecurity definer\b/i,
    'the slug guard trigger must run with invoker rights so current_user reflects the real caller, not the archived_at guard\'s security-definer pattern');

  // tp3d_create_workspace() IS redefined -- its existing INSERT wrote slug =
  // null as a placeholder before a follow-up UPDATE, which the new NOT NULL
  // constraint would reject before that UPDATE ever ran. The redefinition
  // must change only the creation tail (pre-generate the id, write the final
  // slug in one INSERT, no follow-up UPDATE) and leave every entitlement,
  // locking, counting, and limit-check line byte-identical to Packet 2.
  const createStart = migration.indexOf('create or replace function public.tp3d_create_workspace(');
  const createEnd = migration.indexOf('-- 1) Backfill/converge', createStart);
  const createFn = createStart >= 0 && createEnd > createStart ? migration.slice(createStart, createEnd) : '';
  assert.ok(createFn, 'the redefined tp3d_create_workspace must be extractable');
  assert.doesNotMatch(createFn, /values \(v_name, null, p_actor_id/,
    'the null-slug insert placeholder must be removed');
  assert.match(createFn, /v_org_id := pg_catalog\.gen_random_uuid\(\);[\s\S]*v_org_slug := v_org_id::text;[\s\S]*insert into public\.organizations \(id, name, slug, owner_id, created_at, updated_at\)/,
    'the redefined creation tail must pre-generate the id and write the canonical slug in one INSERT');
  assert.match(createFn, /if v_workspace_count >= v_workspace_limit then[\s\S]*TP3D_CREATE_WORKSPACE_LIMIT_REACHED/,
    'Packet 2 workspace-limit enforcement must remain byte-for-byte intact');
  assert.match(createFn, /for update;[\s\S]*TP3D_CREATE_PROFILE_MISSING/,
    'Packet 2 owner-scoped locking must remain intact');
  assert.match(createFn, /'workspace_count', v_workspace_count \+ 1,\s*\n\s*'workspace_limit', v_workspace_limit/,
    'the returned jsonb contract must remain unchanged');
});

test('billing safety transfer predicate production-helper runtime blocks live and unresolved organization billing', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');
  const start = src.indexOf('const BLOCKING_TRANSFER_BILLING_STATUSES');
  const end = src.indexOf('async function resolveWorkspaceTransferBillingGuard', start);
  assert.ok(start >= 0 && end > start, 'production billing predicate must be extractable');

  const sandbox = {};
  const predicateSource = stripTypeScriptTypes(src.slice(start, end), { mode: 'strip' });
  vm.runInNewContext(
    `${predicateSource}\nglobalThis.__evaluateWorkspaceTransferBillingState = evaluateWorkspaceTransferBillingState;`,
    sandbox,
  );
  const evaluate = sandbox.__evaluateWorkspaceTransferBillingState;
  assert.equal(typeof evaluate, 'function', 'production billing predicate must execute in the test sandbox');

  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    const result = evaluate([], [{ status, stripe_subscription_id: `sub_${status}` }]);
    assert.equal(result.ok, false, `${status} subscription must block transfer`);
    assert.equal(result.code, 'workspace_has_active_billing');
  }

  for (const status of ['', 'unexpected_status']) {
    const result = evaluate([], [{ status, stripe_subscription_id: 'sub_unresolved' }]);
    assert.equal(result.ok, false, 'missing or unsupported subscription status must fail closed');
    assert.equal(result.code, 'workspace_has_active_billing');
  }

  const unresolvedCustomer = evaluate(
    [{ status: 'canceled', stripe_subscription_id: 'sub_missing_projection' }],
    [],
  );
  assert.equal(unresolvedCustomer.ok, false, 'an uncorroborated subscription ID must fail closed');
  assert.equal(unresolvedCustomer.code, 'workspace_has_active_billing');

  const conflictingCustomers = evaluate(
    [
      { status: 'canceled', stripe_subscription_id: null },
      { status: 'canceled', stripe_subscription_id: null },
    ],
    [],
  );
  assert.equal(conflictingCustomers.ok, false, 'ambiguous organization billing rows must fail closed');
  assert.equal(
    evaluate([{ status: '', stripe_customer_id: 'cus_unresolved', stripe_subscription_id: null }], []).ok,
    false,
    'a status-less row with Stripe identity must fail closed',
  );
});

test('billing safety transfer predicate production-helper runtime allows only proven non-money states', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');
  const start = src.indexOf('const BLOCKING_TRANSFER_BILLING_STATUSES');
  const end = src.indexOf('async function resolveWorkspaceTransferBillingGuard', start);
  const sandbox = {};
  vm.runInNewContext(
    `${stripTypeScriptTypes(src.slice(start, end), { mode: 'strip' })}\n` +
      'globalThis.__evaluateWorkspaceTransferBillingState = evaluateWorkspaceTransferBillingState;',
    sandbox,
  );
  const evaluate = sandbox.__evaluateWorkspaceTransferBillingState;

  assert.equal(evaluate([], []).ok, true, 'no organization billing rows must remain transferable');
  assert.equal(
    evaluate([{ status: null, stripe_customer_id: null, stripe_subscription_id: null }], []).ok,
    true,
    'the source-defined empty repeat-workspace placeholder must remain transferable',
  );
  assert.equal(
    evaluate([{ status: 'trialing', stripe_subscription_id: null }], []).ok,
    true,
    'an internal no-card trial without a Stripe subscription object must remain transferable',
  );
  assert.equal(
    evaluate([{ status: 'trial_expired', stripe_subscription_id: null }], []).ok,
    true,
    'an ended internal trial without a Stripe subscription object must remain transferable',
  );
  assert.equal(
    evaluate(
      [{ status: 'canceled', stripe_subscription_id: 'sub_ended' }],
      [{ status: 'canceled', stripe_subscription_id: 'sub_ended' }],
    ).ok,
    true,
    'matching organization-scoped canceled projections must remain transferable',
  );
});

test('billing safety transfer Edge flow source-contract is organization-scoped fail-closed and checks twice', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');
  const guardCalls = [...src.matchAll(/resolveWorkspaceTransferBillingGuard\(sb, orgId\)/g)];
  const targetLookup = src.indexOf('.from("organization_members")');
  const rpcCall = src.indexOf('.rpc("tp3d_transfer_workspace_ownership"');

  assert.equal(guardCalls.length, 2, 'billing must be checked after owner authorization and again before RPC');
  assert.ok(guardCalls[0].index < targetLookup, 'initial billing check must precede target validation');
  assert.ok(guardCalls[1].index > targetLookup, 'final billing check must follow target validation');
  assert.ok(guardCalls[1].index < rpcCall, 'final billing check must immediately precede transfer RPC');
  assert.match(src, /\.from\("billing_customers"\)[\s\S]*\.eq\("organization_id", organizationId\)/,
    'billing customer lookup must be requested-organization scoped');
  assert.match(src, /\.select\("status, stripe_customer_id, stripe_subscription_id"\)/,
    'placeholder resolution must verify that no Stripe customer or subscription identity exists');
  assert.match(src, /\.from\("subscriptions"\)[\s\S]*\.eq\("organization_id", organizationId\)/,
    'subscription lookup must be requested-organization scoped');
  assert.doesNotMatch(src, /\.from\("stripe_customers"\)|included_in_plan|workspace_limit_reached/,
    'guard must not use user-wide Stripe customers or sibling entitlement states');
  assert.match(src, /workspace_has_active_billing[\s\S]*status = guard\.code === "workspace_has_active_billing" \? 409 : 503/,
    'active billing must return the structured code with HTTP 409');
  assert.match(src, /billing_customers lookup failed[\s\S]*code: "workspace_billing_state_unavailable"/,
    'billing customer query failure must fail closed with a sanitized code');
  assert.match(src, /subscriptions lookup failed[\s\S]*code: "workspace_billing_state_unavailable"/,
    'subscription query failure must fail closed with a sanitized code');
  assert.doesNotMatch(src, /json\(\{ error: (?:billingCustomersRes|subscriptionsRes|guard\.reason)/,
    'database details and internal guard reasons must never enter the response');
});

test('billing safety transfer client production-helper runtime maps structured guards to sanitized copy', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');
  const start = src.indexOf('const WORKSPACE_ACTIVE_BILLING_TRANSFER_MESSAGE');
  const end = src.indexOf('const ORG_UUID_RE', start);
  assert.ok(start >= 0 && end > start, 'production transfer error mapper must be extractable');

  const sandbox = {
    resolveFnError: (_res, data, fallback) => data?.error || fallback,
  };
  vm.runInNewContext(
    `${src.slice(start, end)}\nglobalThis.__resolveTransferOwnershipError = resolveTransferOwnershipError;`,
    sandbox,
  );
  const resolveTransferError = sandbox.__resolveTransferOwnershipError;

  assert.equal(
    resolveTransferError({}, { error: 'workspace_has_active_billing' }),
    'This workspace has active billing. Cancel the subscription in Billing before transferring ownership, or contact support to move billing to the new owner.',
  );
  assert.equal(
    resolveTransferError({}, { error: 'workspace_billing_state_unavailable' }),
    'Billing status could not be verified. Try again before transferring ownership.',
  );
  assert.equal(
    resolveTransferError({}, { error: 'Only the current workspace owner can transfer ownership.' }),
    'Only the current workspace owner can transfer ownership.',
    'existing structured transfer errors must retain their current behavior',
  );
});

test('production readiness settings billing fallback requires isPro and isActive when entitlementStatus is absent', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const billingRenderStart = src.indexOf('const entitlementStatus = normalizeEntitlementStatus(state.entitlementStatus);');
  const billingRenderEnd = src.indexOf('const interval = state.interval ? String(state.interval) :', billingRenderStart);
  const billingRender = billingRenderStart >= 0 && billingRenderEnd > billingRenderStart
    ? src.slice(billingRenderStart, billingRenderEnd)
    : '';

  assert.ok(billingRender.length > 0,
    'settings billing render block must be extractable');
  assert.match(billingRender, /const isProOrTrial = entitlementStatus \? isEntitlementAllowed : Boolean\(state\.isPro && state\.isActive\);/,
    'settings fallback must require both state.isPro and state.isActive when entitlementStatus is absent');
  assert.match(billingRender, /entitlementStatus \? isEntitlementAllowed/,
    'settings must keep entitlementStatus-present behavior based on isEntitlementAllowed');
  assert.doesNotMatch(billingRender, /const isProOrTrial = entitlementStatus \? isEntitlementAllowed : state\.isPro;/,
    'settings fallback must not treat raw state.isPro alone as usable');
});

test('F1-A _applySharedBillingSnapshot never applies user-specific canManageBilling from a shared snapshot', async () => {
  const src = await readAppSource();

  const fnStart = src.indexOf('function _applySharedBillingSnapshot(');
  assert.ok(fnStart >= 0, '_applySharedBillingSnapshot found');
  let depth = 0, fnEnd = -1;
  for (let i = fnStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { fnEnd = i + 1; break; } }
  }
  const fn = src.slice(fnStart, fnEnd);

  const applyIdx = fn.indexOf('applyBillingEntitlementFields(state');
  const neutralIdx = fn.indexOf('_billingState.canManageBilling = null');
  assert.ok(applyIdx > 0, 'org-scoped entitlement fields still applied from the shared snapshot');
  assert.ok(neutralIdx > applyIdx, 'canManageBilling reset to null AFTER entitlement fields are applied');

  // The direct-fetch path (server truth for the CURRENT user JWT) must keep
  // applying the per-user backend value — exactly two entitlement-apply call
  // sites exist: the shared-snapshot applier (neutralized) and the fetch
  // result path (authoritative).
  const callSites = src.split('applyBillingEntitlementFields(').length - 1 - 1; // minus the definition
  assert.strictEqual(callSites, 2, 'entitlement applier used only by shared applier + direct fetch path');
});

test('F1-D server-backed portal/checkout stay org-resolved and carry no client authority flag', async () => {
  const svcSrc = await fs.readFile(billingServiceUrl, 'utf8');

  assert.ok(!svcSrc.includes('canManageBilling'), 'billing service sends no client-side authority flag — owner checks stay server-side');

  const portalIdx = svcSrc.indexOf('export async function createPortalSession()');
  assert.ok(portalIdx >= 0, 'createPortalSession found');
  const portalFn = svcSrc.slice(portalIdx, portalIdx + 900);
  assert.match(portalFn, /resolveActiveOrganizationId\(\)/, 'portal resolves the current org context');
  assert.match(portalFn, /if \(!organizationId\)/, 'portal fails closed without a resolved org');

  const checkoutIdx = svcSrc.indexOf('export async function createCheckoutSession(');
  assert.ok(checkoutIdx >= 0, 'createCheckoutSession found');
  const checkoutFn = svcSrc.slice(checkoutIdx, checkoutIdx + 900);
  assert.match(checkoutFn, /resolveActiveOrganizationId\(\)/, 'checkout resolves the current org context');
  assert.match(checkoutFn, /if \(!orgId\)/, 'checkout fails closed without a resolved org');
});

test('PORTAL-ORG-1 portal never falls back to the user-level shared Stripe customer', async () => {
  const src = await fs.readFile(stripePortalPath, 'utf8');

  assert.ok(!src.includes('.from("stripe_customers")'),
    'portal must not read the user-scoped stripe_customers mapping — a shared customer exposes sibling workspaces');
  assert.match(src, /no_billing_mapping_for_organization/,
    'portal fails closed with a structured error when the organization has no explicit billing mapping');

  const guardIdx = src.indexOf('no_billing_mapping_for_organization');
  const sessionIdx = src.indexOf('stripe.billingPortal.sessions.create');
  assert.ok(guardIdx >= 0 && sessionIdx > guardIdx,
    'the fail-closed mapping guard must run before any portal session is created');
});

test('PORTAL-ORG-2 portal subscription preselection is organization-scoped only', async () => {
  const src = await fs.readFile(stripePortalPath, 'utf8');

  assert.ok(!src.includes('.eq("stripe_customer_id"'),
    'portal must not look up subscriptions by stripe_customer_id — the newest sub on a shared customer can belong to another organization');

  // Every remaining subscriptions lookup must filter on the requested organization.
  const subQueryRe = /\.from\("subscriptions"\)[\s\S]{0,400}?\.maybeSingle\(\)/g;
  const subQueries = src.match(subQueryRe) || [];
  assert.ok(subQueries.length >= 1, 'portal keeps at least one org-scoped subscription lookup');
  for (const block of subQueries) {
    assert.match(block, /\.eq\("organization_id", organizationId\)/,
      'every portal subscriptions lookup must be scoped to the requested organization');
  }
});

test('PORTAL-ORG-3 portal resolution order: billing_customers then org-scoped projection, preselect retained', async () => {
  const src = await fs.readFile(stripePortalPath, 'utf8');

  const billingCustomersIdx = src.indexOf('.from("billing_customers")');
  const scopedSubsIdx = src.indexOf('.from("subscriptions")');
  const guardIdx = src.indexOf('no_billing_mapping_for_organization');
  assert.ok(billingCustomersIdx >= 0, 'billing_customers org mapping is the primary source');
  assert.ok(scopedSubsIdx > billingCustomersIdx, 'org-scoped subscription projection is the secondary source');
  assert.ok(guardIdx > scopedSubsIdx, 'fail-closed guard runs only after both explicit org sources');

  const billingBlock = src.slice(billingCustomersIdx, billingCustomersIdx + 300);
  assert.match(billingBlock, /\.eq\("organization_id", organizationId\)/,
    'billing_customers lookup is keyed to the requested organization');

  assert.match(src, /flow_data/, 'explicit org subscription preselection (flow_data) is retained');
  assert.match(src, /subscription_update/, 'preselect still targets the update-subscription portal flow');
  assert.match(src, /billing", "portal_return/, 'portal return URL behavior unchanged');
});

test('PORTAL-ORG-4 stale/schedule preselect falls back to a plain portal on the org-mapped customer only', async () => {
  const src = await fs.readFile(stripePortalPath, 'utf8');

  assert.match(src, /isMissingPortalSubscriptionError/, 'stale-subscription fallback retained');
  assert.match(src, /isScheduleManagedPortalSubscriptionError/, 'schedule-managed fallback retained');
  assert.match(src, /const fallbackPayload[\s\S]{0,120}customer: stripeCustomerId/,
    'plain-portal fallback reuses the org-resolved customer');

  // After the fail-closed guard, stripeCustomerId must never be reassigned from
  // a non-organization source (guard is the last assignment gate).
  const guardIdx = src.indexOf('no_billing_mapping_for_organization');
  const afterGuard = src.slice(guardIdx);
  assert.ok(!/stripeCustomerId\s*=\s*String\(/.test(afterGuard),
    'no customer reassignment after the org-mapping guard');
});

test('PORTAL-ORG-5 portal keeps owner-only authorization scoped to the requested organization', async () => {
  const src = await fs.readFile(stripePortalPath, 'utf8');

  const memberIdx = src.indexOf('.from("organization_members")');
  assert.ok(memberIdx >= 0, 'membership lookup present');
  const memberBlock = src.slice(memberIdx, memberIdx + 400);
  assert.match(memberBlock, /\.eq\("organization_id", organizationId\)/, 'membership check uses the requested organization');
  assert.match(memberBlock, /\.eq\("user_id", user\.id\)/, 'membership check uses the authenticated caller');
  assert.match(src, /if \(role !== "owner"\)/, 'non-owners are rejected');
  assert.match(src, /status: 403/, 'owner rejection stays a 403');

  const memberCheckIdx = src.indexOf('if (role !== "owner")');
  const firstBillingReadIdx = src.indexOf('.from("billing_customers")');
  assert.ok(memberCheckIdx >= 0 && firstBillingReadIdx > memberCheckIdx,
    'authorization runs before any billing resolution');
});

test('PORTAL-ORG-6 portal catch handler returns sanitized error text only', async () => {
  const src = await fs.readFile(stripePortalPath, 'utf8');

  const catchIdx = src.lastIndexOf('} catch (e) {');
  assert.ok(catchIdx >= 0, 'top-level catch present');
  const catchBlock = src.slice(catchIdx);
  assert.ok(!/json\(\{ error: message/.test(catchBlock),
    'catch must not echo the raw error message to the browser');
  assert.match(catchBlock, /console\.error\("stripe-create-portal-session error:", e\)/,
    'raw error stays in server logs');
  assert.match(catchBlock, /json\(\{ error: "Portal session failed" \}/,
    'browser receives a fixed sanitized error string');
});

test('CHECKOUT-GUARD-1 Stripe race guard gates metadata-less blocking to the single-org legacy case', async () => {
  const src = await fs.readFile(stripeCheckoutPath, 'utf8');

  assert.match(src,
    /hasBlockingStripeSubscription\(\s*stripe,\s*stripeCustomerId,\s*organizationId,\s*allowLegacyUserScopedFallback,?\s*\)/,
    'race guard must pass the strict single-org legacy gate');
  assert.ok(
    !/hasBlockingStripeSubscription\(\s*stripe,\s*stripeCustomerId,\s*organizationId,\s*true\s*,?\s*\)/.test(src),
    'race guard must not hardcode allowMissingOrgMetadata=true — that lets an unmapped subscription block every workspace of a multi-workspace owner');
});

test('CHECKOUT-GUARD-2 blocking match requires explicit metadata binding to the requested organization', async () => {
  const src = await fs.readFile(stripeCheckoutPath, 'utf8');
  const fnIdx = src.indexOf('async function hasBlockingStripeSubscription(');
  assert.ok(fnIdx >= 0, 'hasBlockingStripeSubscription present');
  const fnEnd = src.indexOf('\n}', fnIdx);
  const fn = src.slice(fnIdx, fnEnd);

  assert.match(fn, /if \(metadataOrgId\) return metadataOrgId === organizationId;/,
    'a subscription explicitly bound to organization B never blocks checkout for organization A');
  assert.match(fn, /return allowMissingOrgMetadata;/,
    'metadata-less subscriptions block only when the caller passed the gated flag');
  assert.match(fn, /STRIPE_BLOCKING_STATUSES\.has\(status\)/,
    'only active-ish statuses can block — duplicate protection for mapped subscriptions retained');
});

test('CHECKOUT-GUARD-3 single-org legacy gate: exact membership count of one, ambiguity fails safe', async () => {
  const src = await fs.readFile(stripeCheckoutPath, 'utf8');
  const gateIdx = src.indexOf('let allowLegacyUserScopedFallback = false;');
  assert.ok(gateIdx >= 0, 'legacy gate defaults to closed');
  const gateBlock = src.slice(gateIdx, gateIdx + 500);
  assert.match(gateBlock, /\.from\("organization_members"\)/, 'gate reads caller memberships');
  assert.match(gateBlock, /count: "exact", head: true/, 'gate uses an exact membership count');
  assert.match(gateBlock, /\.eq\("user_id", user\.id\)/, 'gate counts the authenticated caller only');
  assert.match(gateBlock, /if \(!orgCountRes\.error\)/, 'a failed count keeps the gate closed — ambiguity fails safe');
  assert.match(gateBlock, /=== 1/, 'gate opens only when the caller belongs to exactly one organization');

  const ownerIdx = src.indexOf('if (memberRole !== "owner")');
  assert.ok(ownerIdx >= 0 && ownerIdx < gateIdx,
    'owner-only authorization for the requested organization runs before the legacy gate');
});

test('CHECKOUT-GUARD-4 checkout metadata, price allow-list, idempotency, and owner auth unchanged', async () => {
  const src = await fs.readFile(stripeCheckoutPath, 'utf8');
  assert.match(src, /assertAllowedCheckoutPrice\(price_id\)/, 'catalog-backed price allow-list retained');
  assert.match(src, /idempotencyKey: checkoutIdempotencyKey\(user\.id, organizationId, price_id\)/,
    'idempotency key still scoped user+organization+price');
  assert.match(src,
    /metadata: \{\s*supabase_user_id: user\.id,\s*price_id,\s*\.\.\.\(organizationId \? \{ organization_id: organizationId \} : \{\}\),?\s*\}/,
    'Checkout Session metadata carries the authoritative organization id');
  assert.match(src,
    /subscription_data: \{\s*metadata: \{\s*supabase_user_id: user\.id,\s*\.\.\.\(organizationId \? \{ organization_id: organizationId \} : \{\}\),?\s*\},?\s*\}/,
    'subscription_data metadata carries the authoritative organization id');
  assert.match(src, /Only the org owner can manage billing for this organization/,
    'non-owners stay rejected');
});

test('CHECKOUT-GUARD-5 checkout never write-repairs Stripe metadata or picks an arbitrary organization', async () => {
  const src = await fs.readFile(stripeCheckoutPath, 'utf8');
  assert.ok(!src.includes('stripe.subscriptions.update'),
    'checkout must not silently write organization metadata onto ambiguous Stripe subscriptions');
  assert.ok(!src.includes('stripe.customers.update'),
    'checkout must not rewrite customer metadata to repair mappings');
  assert.ok(!/ownerWorkspaces\[0\]|oldestOwnerWorkspace/i.test(src),
    'checkout has no oldest/first workspace assignment');
});

test('billing-status runtime: omitted and explicit-empty organization IDs preserve profile fallback', async () => {
  const profileOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const createRuntime = () => createBillingStatusDirectIdentityRuntime({
    profiles: [{
      id: '11111111-1111-4111-8111-111111111111',
      current_organization_id: profileOrgId,
    }],
  });

  const omittedRuntime = await createRuntime();
  const omitted = await omittedRuntime.invoke();
  assert.equal(omitted.status, 200);
  assert.equal(omitted.body.orgId, profileOrgId);
  assert.equal(omittedRuntime.calls.queries[0], 'profiles');

  const emptyRuntime = await createRuntime();
  const empty = await emptyRuntime.invoke({ query: 'organization_id=' });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.orgId, profileOrgId);
  assert.equal(emptyRuntime.calls.queries[0], 'profiles');
});

test('billing-status runtime: a valid requested organization wins without profile fallback and keeps authorization', async () => {
  const requestedOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const otherOrgId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const authorizedRuntime = await createBillingStatusDirectIdentityRuntime({
    profiles: [{
      id: '11111111-1111-4111-8111-111111111111',
      current_organization_id: otherOrgId,
    }],
  });
  const authorized = await authorizedRuntime.request(requestedOrgId);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.orgId, requestedOrgId);
  assert.equal(authorizedRuntime.calls.queries.includes('profiles'), false);

  const unrelatedRuntime = await createBillingStatusDirectIdentityRuntime({
    authenticatedUserId: '22222222-2222-4222-8222-222222222222',
  });
  const unrelated = await unrelatedRuntime.request(requestedOrgId);
  assert.equal(unrelated.status, 403);
  assert.equal(unrelated.body.error, 'Not authorized for this organization billing status');
});

test('billing-status runtime: malformed organization parameters return sanitized 400 before profile, billing, or Stripe work', async () => {
  const profileOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const malformedQueries = [
    ['organization_id=not-a-uuid', 'not-a-uuid'],
    ['organization_id=%20not-a-uuid%20', 'not-a-uuid'],
    ['organization_id=%5Bobject%20Object%5D', '[object Object]'],
    ['org_id=malformed-alias', 'malformed-alias'],
    [`organization_id=${profileOrgId}&org_id=malformed-alias`, 'malformed-alias'],
  ];

  for (const [query, rawInput] of malformedQueries) {
    const runtime = await createBillingStatusDirectIdentityRuntime({
      profiles: [{
        id: '11111111-1111-4111-8111-111111111111',
        current_organization_id: profileOrgId,
      }],
    });
    const result = await runtime.invoke({ query });
    const serialized = JSON.stringify(result.body);
    assert.equal(result.status, 400, query);
    assert.deepEqual(result.body, { error: 'organization_id must be a UUID', orgId: null });
    assert.deepEqual(runtime.calls.queries, [], `${query} must not query profile or billing tables`);
    assert.equal(runtime.calls.stripe, 0, `${query} must not initialize Stripe`);
    assert.doesNotMatch(serialized, new RegExp(rawInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.doesNotMatch(serialized, /sql|postgrest|stack|jwt|service[-_ ]?role|stripe|secret/i);
  }
});

test('billing-status runtime: malformed organization validation does not replace missing or invalid JWT errors', async () => {
  const runtime = await createBillingStatusDirectIdentityRuntime();
  const missing = await runtime.invoke({ query: 'organization_id=not-a-uuid', includeJwt: false });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, 'Missing authorization');

  const invalid = await runtime.invoke({
    query: 'organization_id=not-a-uuid',
    jwt: 'invalid-runtime-token',
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error, 'Invalid or expired token');
  assert.deepEqual(runtime.calls.queries, []);
  assert.equal(runtime.calls.stripe, 0);
});

test('F12 production runtime: active direct siblings retain their own interval, period, price-derived limit, and newest-slot access', async () => {
  const organizations = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', owner_id: '11111111-1111-4111-8111-111111111111', created_at: '2025-01-01T00:00:00.000Z', archived_at: null },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', owner_id: '11111111-1111-4111-8111-111111111111', created_at: '2025-02-01T00:00:00.000Z', archived_at: null },
    { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', owner_id: '11111111-1111-4111-8111-111111111111', created_at: '2025-03-01T00:00:00.000Z', archived_at: null },
    { id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', owner_id: '11111111-1111-4111-8111-111111111111', created_at: '2025-04-01T00:00:00.000Z', archived_at: null },
  ];
  const subscriptions = [
    {
      organization_id: organizations[0].id, status: 'active', price_id: 'price_pro_month', interval: 'month',
      stripe_subscription_id: 'sub_a_month', current_period_end: '2026-12-01T00:00:00.000Z',
    },
    {
      organization_id: organizations[1].id, status: 'active', price_id: 'price_pro_year', interval: 'year',
      stripe_subscription_id: 'sub_archived_sibling', current_period_end: '2027-12-01T00:00:00.000Z',
    },
    {
      organization_id: organizations[3].id, status: 'active', price_id: 'price_business_year', interval: 'year',
      stripe_subscription_id: 'sub_d_year', current_period_end: '2026-09-15T00:00:00.000Z',
    },
  ];
  organizations[1].archived_at = '2026-01-01T00:00:00.000Z';
  const runtime = await createBillingStatusDirectIdentityRuntime({ organizations, subscriptions });
  const a = await runtime.request(organizations[0].id);
  const d = await runtime.request(organizations[3].id);

  assert.equal(a.status, 200);
  assert.equal(a.body.entitlementStatus, 'active');
  assert.equal(a.body.interval, 'month');
  assert.equal(a.body.currentPeriodEnd, '2026-12-01T00:00:00.000Z');
  assert.equal(a.body.workspaceLimit, 3, 'A uses its own Pro price limit');
  assert.equal(a.body.unknownPriceId, false);
  assert.equal(d.body.entitlementStatus, 'active', 'newest direct-paid workspace is never demoted by A oldest-first slots');
  assert.notEqual(d.body.entitlementStatus, 'workspace_limit_reached');
  assert.equal(d.body.interval, 'year');
  assert.equal(d.body.currentPeriodEnd, '2026-09-15T00:00:00.000Z');
  assert.equal(d.body.workspaceLimit, 10, 'D uses its own Business price limit');
  assert.equal(d.body.unknownPriceId, false);
  assert.equal(d.body.debug.ownerEntitlementOrgId, organizations[1].id,
    'the archived sibling is the owner-wide diagnostic winner but cannot override D direct identity');
});

test('F12 production runtime: direct trial, unknown active price, and zero-amount coupon data remain direct', async () => {
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const trialEnd = '2026-11-20T00:00:00.000Z';
  const trialRuntime = await createBillingStatusDirectIdentityRuntime({ subscriptions: [
    { organization_id: orgA, status: 'active', price_id: 'price_pro_month', interval: 'month', stripe_subscription_id: 'sub_a', current_period_end: '2026-10-01T00:00:00.000Z' },
    { organization_id: orgB, status: 'trialing', price_id: 'price_unrecognized', interval: 'year', stripe_subscription_id: 'sub_b_trial', current_period_end: trialEnd, trial_end: trialEnd },
  ] });
  const trial = await trialRuntime.request(orgB);
  assert.equal(trial.body.entitlementStatus, 'trialing');
  assert.equal(trial.body.interval, 'year');
  assert.equal(trial.body.trialEndsAt, trialEnd);
  assert.equal(trial.body.workspaceLimit, 1);
  assert.equal(trial.body.unknownPriceId, true);
  assert.doesNotMatch(JSON.stringify(trial.body), /price_unrecognized/,
    'the raw unknown Price is not exposed in the response or debug payload');
  const trialWarning = trialRuntime.calls.logs.find(entry =>
    entry[0] === 'warn' && entry[1] === 'billing:unknown-price-fallback');
  assert.ok(trialWarning, 'unknown direct Price emits the stable server reason code');
  assert.doesNotMatch(JSON.stringify(trialWarning), /price_unrecognized/,
    'unknown Price warning masks the full Stripe object ID');
  assert.doesNotMatch(JSON.stringify(trialWarning), new RegExp(orgB),
    'unknown Price warning masks the full organization ID');

  const couponRuntime = await createBillingStatusDirectIdentityRuntime({ subscriptions: [{
    organization_id: orgA,
    status: 'active',
    price_id: 'price_unknown_paid',
    interval: 'month',
    stripe_subscription_id: 'sub_coupon_free',
    current_period_end: '2026-08-10T00:00:00.000Z',
    amount_paid: 0,
    coupon: { percent_off: 100 },
  }] });
  const coupon = await couponRuntime.request(orgA);
  assert.equal(coupon.body.entitlementStatus, 'active');
  assert.equal(coupon.body.isPro, true);
  assert.equal(coupon.body.workspaceLimit, 3, 'unknown explicitly mapped active price keeps existing paid fallback');
  assert.equal(coupon.body.unknownPriceId, true);
  assert.doesNotMatch(JSON.stringify(coupon.body), /price_unknown_paid/);
});

test('F12 production runtime: recognized legacy Pro and Business Prices keep tier limits but are not unknown', async () => {
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const runtime = await createBillingStatusDirectIdentityRuntime({ subscriptions: [
    {
      organization_id: orgA, status: 'active', price_id: 'price_pro_legacy_month', interval: null,
      stripe_subscription_id: 'sub_legacy_pro', current_period_end: '2026-10-01T00:00:00.000Z',
    },
    {
      organization_id: orgB, status: 'active', price_id: 'price_business_legacy_year', interval: 'year',
      stripe_subscription_id: 'sub_legacy_business', current_period_end: '2026-11-01T00:00:00.000Z',
    },
  ] });
  const pro = await runtime.request(orgA);
  const business = await runtime.request(orgB);

  assert.equal(pro.body.entitlementStatus, 'active');
  assert.equal(pro.body.workspaceLimit, 3);
  assert.equal(pro.body.interval, 'month', 'legacy Pro interval can be recognized from its catalog list');
  assert.equal(pro.body.unknownPriceId, false);
  assert.equal(business.body.entitlementStatus, 'active');
  assert.equal(business.body.workspaceLimit, 10);
  assert.equal(business.body.interval, 'year');
  assert.equal(business.body.unknownPriceId, false);
  assert.equal(runtime.calls.logs.some(entry => entry[1] === 'billing:unknown-price-fallback'), false);
});

test('F12 production runtime: unknown Price in approved payment grace keeps paid fallback and reports the catalog gap', async () => {
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const runtime = await createBillingStatusDirectIdentityRuntime({ subscriptions: [{
    organization_id: orgA,
    status: 'past_due',
    price_id: 'price_unknown_payment_grace',
    interval: 'month',
    stripe_subscription_id: 'sub_unknown_payment_grace',
    current_period_end: '2099-12-01T00:00:00.000Z',
  }] });
  const result = await runtime.request(orgA);

  assert.equal(result.body.entitlementStatus, 'active');
  assert.equal(result.body.paymentProblem, true);
  assert.equal(result.body.isPro, true);
  assert.equal(result.body.workspaceLimit, 3);
  assert.equal(result.body.unknownPriceId, true);
  assert.doesNotMatch(JSON.stringify(result.body), /price_unknown_payment_grace/);
});

test('F12 production runtime: unknown canceled Price grants no access and emits no unknown diagnostic', async () => {
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const runtime = await createBillingStatusDirectIdentityRuntime({ subscriptions: [{
    organization_id: orgA,
    status: 'canceled',
    price_id: 'price_unknown_canceled',
    interval: 'month',
    stripe_subscription_id: 'sub_unknown_canceled',
    current_period_end: '2025-01-01T00:00:00.000Z',
  }] });
  const result = await runtime.request(orgA);
  assert.equal(result.body.entitlementStatus, 'owner_subscription_required');
  assert.equal(result.body.workspaceIncluded, false);
  assert.equal(result.body.isPro, false);
  assert.equal(result.body.unknownPriceId, false);
  assert.equal(runtime.calls.logs.some(entry => entry[1] === 'billing:unknown-price-fallback'), false);
});

test('F12 production runtime: unknown owner candidate preserves sibling coverage and reports the catalog gap', async () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const organizations = ['a', 'b', 'c', 'd'].map((suffix, index) => ({
    id: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(11)}${index + 1}`,
    owner_id: owner,
    created_at: `2025-0${index + 1}-01T00:00:00.000Z`,
    archived_at: null,
  }));
  const unknownPrice = 'price_unknown_owner_candidate';
  const runtime = await createBillingStatusDirectIdentityRuntime({ organizations, subscriptions: [{
    organization_id: organizations[0].id,
    status: 'active',
    price_id: unknownPrice,
    interval: 'month',
    stripe_subscription_id: 'sub_unknown_owner',
    current_period_end: '2026-12-01T00:00:00.000Z',
  }] });

  const included = await runtime.request(organizations[1].id);
  const overLimit = await runtime.request(organizations[3].id);
  assert.equal(included.body.entitlementStatus, 'included_in_plan');
  assert.equal(included.body.workspaceLimit, 3);
  assert.equal(included.body.workspaceIncluded, true);
  assert.equal(included.body.unknownPriceId, true);
  assert.equal(overLimit.body.entitlementStatus, 'workspace_limit_reached');
  assert.equal(overLimit.body.workspaceLimit, 3);
  assert.equal(overLimit.body.workspaceIncluded, false);
  assert.equal(overLimit.body.unknownPriceId, true);
  assert.doesNotMatch(JSON.stringify(included.body), new RegExp(unknownPrice));
  assert.doesNotMatch(JSON.stringify(overLimit.body), new RegExp(unknownPrice));
});

test('F12 production runtime: canceled requested workspaces keep sibling included/over-limit behavior', async () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const organizations = ['a', 'b', 'c', 'd'].map((suffix, index) => ({
    id: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(11)}${index + 1}`,
    owner_id: owner,
    created_at: `2025-0${index + 1}-01T00:00:00.000Z`,
    archived_at: null,
  }));
  const subscriptions = [
    { organization_id: organizations[0].id, status: 'active', price_id: 'price_pro_month', interval: 'month', stripe_subscription_id: 'sub_owner', current_period_end: '2026-12-01T00:00:00.000Z' },
    { organization_id: organizations[1].id, status: 'canceled', price_id: 'price_pro_month', interval: 'month', stripe_subscription_id: 'sub_b_ended', current_period_end: '2025-01-01T00:00:00.000Z' },
    { organization_id: organizations[3].id, status: 'canceled', price_id: 'price_pro_month', interval: 'month', stripe_subscription_id: 'sub_d_ended', current_period_end: '2025-01-01T00:00:00.000Z' },
  ];
  const runtime = await createBillingStatusDirectIdentityRuntime({ organizations, subscriptions });
  const included = await runtime.request(organizations[1].id);
  const overLimit = await runtime.request(organizations[3].id);
  assert.equal(included.body.entitlementStatus, 'included_in_plan');
  assert.equal(included.body.workspaceIncluded, true);
  assert.equal(included.body.unknownPriceId, false);
  assert.equal(overLimit.body.entitlementStatus, 'workspace_limit_reached');
  assert.equal(overLimit.body.workspaceIncluded, false);
  assert.equal(overLimit.body.unknownPriceId, false);
});

test('F12 production runtime: duplicate direct rows fail closed without exposing an arbitrary winner', async () => {
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const runtime = await createBillingStatusDirectIdentityRuntime({
    subscriptions: [
      { organization_id: orgA, status: 'active', price_id: 'price_unknown_duplicate', interval: 'month', stripe_subscription_id: 'sub_duplicate_1', current_period_end: '2026-09-01T00:00:00.000Z' },
      { organization_id: orgA, status: 'trialing', price_id: 'price_business_year', interval: 'year', stripe_subscription_id: 'sub_duplicate_2', current_period_end: '2026-12-01T00:00:00.000Z', trial_end: '2026-12-01T00:00:00.000Z' },
    ],
    billingCustomers: [{
      organization_id: orgA,
      stripe_customer_id: 'cus_owner',
      stripe_subscription_id: 'sub_duplicate_1',
      status: 'active',
      plan_name: 'pro',
      billing_interval: 'month',
      current_period_end: '2026-09-01T00:00:00.000Z',
      cancel_at_period_end: false,
      trial_ends_at: null,
      created_at: '2025-03-01T00:00:00.000Z',
    }],
  });
  const result = await runtime.request(orgA);
  assert.equal(result.body.entitlementStatus, 'owner_subscription_required');
  assert.equal(result.body.isActive, false);
  assert.equal(result.body.duplicateActiveMappings, true);
  assert.equal(result.body.interval, 'unknown');
  assert.equal(result.body.currentPeriodEnd, null);
  assert.equal(result.body.unknownPriceId, false, 'ambiguous identity fails closed before unknown Price diagnostics');
  assert.doesNotMatch(JSON.stringify(result.body), /price_unknown_duplicate/);
});

test('F12 function runtime: conflicting local and Stripe organization bindings fail direct resolution closed', async () => {
  const resolve = await loadRequestedDirectBindingRuntime();
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const base = {
    status: 'active', price_id: 'price_pro_month', current_period_end: '2026-12-01T00:00:00.000Z',
    trial_end: null, created_at: null, stripe_subscription_id: 'sub_conflict', stripe_customer_id: 'cus_owner',
    interval: 'month', source: 'subscription',
  };
  const resolution = resolve([
    { ...base, organization_id: orgA },
    { ...base, organization_id: orgB },
  ], orgA, false, false);
  assert.equal(resolution.ambiguous, true);
  assert.equal(resolution.conflict, true);
  assert.equal(resolution.subscriptionId, null);
});

test('F12 source contract: direct-first ownership guards owner overrides and preserves diagnostic includedOrgIds', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const ambiguousIdx = src.indexOf('if (requestedDirectBinding.ambiguous)');
  const directIdx = src.indexOf('else if (requestedOrgIsDirect && directActive)', ambiguousIdx);
  const ownerIdx = src.indexOf('else if (ownerEntitlementCandidate && resolvedOrgId && billingOwnerUserId)', directIdx);
  assert.ok(ambiguousIdx >= 0 && directIdx > ambiguousIdx && ownerIdx > directIdx,
    'ambiguous/direct requested-org classification precedes owner-wide coverage');
  assert.match(src, /ownerEntitlementCandidate &&\s*!requestedOrgIsDirect &&/,
    'owner interval/period fallback is disabled on the requested direct path');
  assert.match(src, /if \(directOrgId && resolvedWorkspaceLimit > 0\) includedOrgIds\.push\(directOrgId\);/,
    'owner-plan includedOrgIds remains a diagnostics-only owner coverage list');
  assert.match(src, /if \(!ownerEntitlementCandidate\) includedOrgIds = resolvedOrgId \? \[resolvedOrgId\] : \[\];/,
    'direct-only diagnostics fall back to the requested org only when no owner coverage candidate exists');
});

test('F12 production runtime: archived requested workspace guard remains billing-unavailable', async () => {
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const runtime = await createBillingStatusDirectIdentityRuntime({
    organizations: [{ id: orgA, owner_id: '11111111-1111-4111-8111-111111111111', created_at: '2025-01-01T00:00:00.000Z', archived_at: '2026-01-01T00:00:00.000Z' }],
    subscriptions: [{ organization_id: orgA, status: 'active', price_id: 'price_pro_month', interval: 'month', stripe_subscription_id: 'sub_archived', current_period_end: '2026-12-01T00:00:00.000Z' }],
  });
  const result = await runtime.request(orgA);
  assert.equal(result.body.archived, true);
  assert.equal(result.body.entitlementStatus, 'billing_unavailable');
  assert.equal(result.body.isActive, false);
  assert.equal(result.body.unknownPriceId, false);
});

test('BILLING-UNMAPPED-1 metadata-less subscriptions are never assigned to the oldest owner workspace', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  assert.ok(!src.includes('oldestOwnerWorkspaceId'),
    'the oldest-owner-workspace guess must not exist anywhere — an archived oldest workspace could otherwise become the guessed direct workspace');

  const mapIdx = src.indexOf('const mapSubscriptionToOwnerWorkspace');
  assert.ok(mapIdx >= 0, 'mapSubscriptionToOwnerWorkspace present');
  const mapEnd = src.indexOf('};', mapIdx);
  const mapFn = src.slice(mapIdx, mapEnd);

  assert.match(mapFn, /if \(orgIdFromMetadata\) \{\s*return ownerWorkspaceIdSet\.has\(orgIdFromMetadata\) \? orgIdFromMetadata : null;/,
    'subscription metadata resolves only when it names one of the owner\'s workspaces — conflicting bindings fail closed');
  assert.match(mapFn, /ownerBillingCustomerBySubscription\.get\(sid\)/,
    'an explicit billing_customers mapping for the same subscription remains a valid binding source');
  assert.match(mapFn, /return null;\s*$/,
    'a candidate without an explicit organization binding resolves to null, never to a guessed workspace');
});

test('BILLING-UNMAPPED-2 unmapped candidates are excluded from entitlement and counted for diagnostics', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  const pushDbIdx = src.indexOf('const pushMappedSubscriptionCandidate');
  const pushDbEnd = src.indexOf('const subscriptionColumnsWithOrg', pushDbIdx);
  assert.ok(pushDbIdx >= 0 && pushDbEnd > pushDbIdx, 'DB candidate push helper extractable');
  const pushDb = src.slice(pushDbIdx, pushDbEnd);
  assert.match(pushDb, /if \(!resolvedCandidateOrgId\) \{\s*ownerUnmappedCandidateCount \+= 1;\s*return;\s*\}/,
    'unmapped DB candidates are excluded before any entitlement push');
  assert.ok(pushDb.indexOf('ownerUnmappedCandidateCount += 1') < pushDb.indexOf('entitlementCandidates.push'),
    'exclusion happens before the candidate reaches entitlement selection');

  const pushStripeIdx = src.indexOf('const pushStripeSubscriptionCandidate');
  const pushStripeEnd = src.indexOf('for (const stripeSubscriptionId of ownerStripeSubscriptionIds)', pushStripeIdx);
  assert.ok(pushStripeIdx >= 0 && pushStripeEnd > pushStripeIdx, 'Stripe candidate push helper extractable');
  const pushStripe = src.slice(pushStripeIdx, pushStripeEnd);
  assert.match(pushStripe, /if \(!resolvedCandidateOrgId\) \{\s*ownerUnmappedCandidateCount \+= 1;\s*return;\s*\}/,
    'unmapped live-Stripe candidates are excluded before any entitlement push');

  assert.match(src, /ownerUnmappedCandidateCount,/,
    'excluded-candidate count is exposed through the established debug payload');
});

test('BILLING-UNMAPPED-3 explicitly mapped owner coverage and archived counting policy preserved', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  assert.match(src, /if \(directOrgId && resolvedWorkspaceLimit > 0\) includedOrgIds\.push\(directOrgId\);/,
    'direct-organization-first includedOrgIds ordering retained');
  assert.match(src, /for \(const workspace of ownerWorkspaces\) \{/,
    'sibling owned workspaces still fill remaining plan slots');
  assert.match(src, /entitlementStatus = "included_in_plan"/,
    'included_in_plan owner coverage retained');
  assert.match(src, /entitlementStatus = "workspace_limit_reached"/,
    'workspace_limit_reached policy retained');
  assert.match(src, /workspaceCount = ownerWorkspaces\.length;/,
    'workspace counting (including archived, per approved policy) unchanged');
});

test('BILLING-UNMAPPED-4 legacy user-scoped fallback requires a single-org caller who is the billing owner', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  const countIdx = src.indexOf('allowLegacyUserScopedFallback = Number(orgCountRes.count || 0) === 1');
  assert.ok(countIdx >= 0, 'single-organization membership count gate retained');

  const gateRe = /if \(allowLegacyUserScopedFallback && \(!billingOwnerUserId \|\| billingOwnerUserId !== userId\)\) \{\s*allowLegacyUserScopedFallback = false;\s*\}/;
  assert.match(src, gateRe,
    'a plain member\'s personal legacy subscription can never grant another owner\'s organization entitlement — unresolved ownership fails closed');

  const gateIdx = src.search(gateRe);
  const legacyAdoptIdx = src.indexOf('if (!subscription && resolvedOrgId && allowLegacyUserScopedFallback)');
  assert.ok(gateIdx >= 0 && legacyAdoptIdx > gateIdx,
    'owner gate runs before any legacy user-scoped subscription adoption');
  assert.ok(countIdx < gateIdx, 'membership count is computed before the owner gate tightens it');
});

test('BILLING-UNMAPPED-5 duplicate active mappings are surfaced, not silently resolved', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  assert.match(src, /const duplicateActiveMappings = duplicateActiveCount > 1 \|\| requestedDirectBinding\.ambiguous;/,
    'response exposes a repair signal for duplicate rows and requested-org binding ambiguity');
  assert.match(src, /duplicateActiveMappings,/,
    'computed repair signal is returned without selecting an ambiguous direct mapping');
  assert.match(src, /duplicate active subscriptions detected/,
    'server-side duplicate warning retained');
});

test('BILLING-UNMAPPED-6 interval and currentPeriodEnd resolve from the directly mapped subscription first', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  assert.match(src, /if \(storedInterval === "month" \|\| storedInterval === "year"\) \{\s*interval = storedInterval;/,
    'interval comes from the requested organization\'s own subscription first');
  assert.match(src, /ownerEntitlementCandidate &&\s*!requestedOrgIsDirect &&/,
    'owner-level metadata block is skipped completely for a direct requested workspace');
  assert.match(src, /if \(interval === "unknown" && ownerLevelInterval\) \{\s*interval = ownerLevelInterval;/,
    'owner-level interval fallback remains available for sibling coverage only');
  assert.match(src, /if \(!currentPeriodEnd && ownerEntitlementCandidate\.current_period_end\)/,
    'owner-level currentPeriodEnd applies only when the direct subscription leaves it empty');
});

test('BILLING-UNMAPPED-7 explicit projections still resolve: org-scoped lookup and metadata-checked known subscription', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  assert.match(src, /\.from\("subscriptions"\)\s*\.select\(selectColumns\)\s*\.eq\("organization_id", resolvedOrgId\)/,
    'webhook-written org-scoped projections remain the primary requested-org source');
  assert.match(src, /if \(!orgIdFromMetadata \|\| orgIdFromMetadata === resolvedOrgId\)/,
    'the billing_customers-mapped known subscription is adopted only when its metadata does not contradict the requested organization');
});

test('BILLING-UNMAPPED-8 billing-status returns sanitized errors only', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');

  assert.ok(!src.includes('String(billingCustomerRes.error?.message'),
    'billing_customers lookup failures no longer echo raw database error text');
  assert.ok(!/details: code \?\? message/.test(src),
    'subscription lookup failures no longer fall back to raw error messages');
  assert.match(src, /return json\(req, 500, \{ error: "Billing status failed" \}\);/,
    'the fatal handler returns a fixed sanitized error string');
  assert.match(src, /console\.error\("billing-status fatal:", e\);/,
    'raw error stays in server logs');
});

test('APP-STABILIZATION-PHASE2 dead billing lock retry waits through TTL and can acquire after expiry', async () => {
  const runtime = await createPhase2BillingLockHarness();
  const orgId = '11111111-1111-4111-8111-111111111111';
  runtime.localStorage.setItem(runtime.key(orgId), JSON.stringify({ tabId: 'dead-tab', at: 100000 }));

  assert.equal(runtime.delay(orgId), 20100,
    'fresh foreign lock waits for the full remaining TTL plus expiry grace');
  assert.equal(runtime.acquire(orgId), false, 'the foreign lock is still valid before the retry');

  runtime.setNow(120100);
  assert.equal(runtime.acquire(orgId), true, 'the same bounded retry can acquire after expiry');
  assert.equal(JSON.parse(runtime.localStorage.getItem(runtime.key(orgId))).tabId, 'tab-current');

  runtime.localStorage.values.clear();
  runtime.setNow(200000);
  runtime.localStorage.setItem(runtime.legacyKey(orgId), JSON.stringify({ tabId: 'older-tab', at: 180100 }));
  assert.equal(runtime.delay(orgId), 1200,
    'an almost-expired compatible legacy lock retains the bounded minimum delay');
  runtime.localStorage.values.clear();
  assert.equal(runtime.delay(orgId), 1200, 'missing or invalid locks use the same bounded minimum');
});

test('APP-STABILIZATION-PHASE2 billing retry remains single, epoch-scoped, org-scoped, and non-forced', async () => {
  const src = await readAppSource();
  const retryStart = src.indexOf("if (!String(reason || '').startsWith('cross-tab-retry:')) {");
  const retryEnd = src.indexOf('\n    return getBillingState();', retryStart);
  const retryBlock = src.slice(retryStart, retryEnd);
  assert.ok(retryBlock, 'billing lock retry block is extractable');
  assert.match(retryBlock, /retryDelayMs = _getBillingLockRetryDelay\(retryOrgId\)/,
    'retry delay derives from the live compatible lock');
  assert.match(retryBlock, /if \(_billingEpoch !== retryBillingEpoch\) return/,
    'identity/billing epoch changes invalidate the delayed retry');
  assert.match(retryBlock, /getActiveOrgIdForBilling\(\)[\s\S]*!== retryOrgId\) return/,
    'workspace changes invalidate the old-org retry');
  assert.match(retryBlock, /refreshBilling\(\{ force: false, reason: 'cross-tab-retry:' \+ reason \}\)/,
    'the one retry remains non-forced so a shared success can satisfy it');
  assert.equal((retryBlock.match(/setTimeout\(/g) || []).length, 1,
    'the lock path schedules one bounded retry rather than a polling loop');
});

test('P0-CONTRACT window.__TP3D_BILLING exposes exactly the current member set (pickCheckoutInterval added later)', async () => {
  const app = await readAppSource();
  const start = app.indexOf('window.__TP3D_BILLING = {');
  assert.ok(start >= 0, 'window.__TP3D_BILLING object literal must exist');
  const end = app.indexOf('\n  };', start);
  assert.ok(end > start, 'billing facade literal must close at its top-level brace');
  const facade = app.slice(start, end);

  for (const member of [
    'getBillingState', 'subscribeBilling', 'refreshBilling', 'clearBillingState',
    'canUseProFeatures', 'getProRuleSet', 'getCheckoutPlanOptions',
    'startCheckout', 'openPortal', 'selfTest',
  ]) {
    assert.match(facade, new RegExp('\\n    ' + member + '[,:]'),
      `billing facade must expose ${member} as a top-level member`);
  }
  // Exactly ten top-level members (4-space indent); selfTest body is deeper-indented.
  const topLevelMembers = (facade.match(/\n {4}[a-zA-Z]+[,:]/g) || []).length;
  assert.equal(topLevelMembers, 10, 'billing facade must expose exactly ten initial members');

  // pickCheckoutInterval is NOT in the initial literal; it is added at the init point.
  assert.doesNotMatch(facade, /pickCheckoutInterval/,
    'pickCheckoutInterval must not appear in the initial billing facade literal');
  assert.match(app, /window\.__TP3D_BILLING\.pickCheckoutInterval = pickCheckoutInterval/,
    'pickCheckoutInterval must be added to the facade at the later initialization point');
});

test('P0-CONTRACT getBillingState returns a fresh object literal, not the live _billingState reference', async () => {
  const app = await readAppSource();
  const start = app.indexOf('function getBillingState() {');
  const end = app.indexOf('\nfunction subscribeBilling', start);
  assert.ok(start >= 0 && end > start, 'getBillingState body must be locatable');
  const body = app.slice(start, end);
  assert.match(body, /return \{/, 'getBillingState must return a fresh object literal (copy semantics)');
  assert.doesNotMatch(body, /return _billingState\b/,
    'getBillingState must not return the live _billingState reference');
  assert.match(body, /_billingState\.\w+/, 'getBillingState must copy fields off _billingState');
});

test('P0-CONTRACT refreshBilling is a reassignable facade member wrappable in place by diagnostics', async () => {
  const app = await readAppSource();
  const dbg = await fs.readFile(debuggerPath, 'utf8');
  const start = app.indexOf('window.__TP3D_BILLING = {');
  const facade = app.slice(start, app.indexOf('\n  };', start));
  assert.match(facade, /\n    refreshBilling: BillingService\.refreshBilling,/,
    'refreshBilling must be a plain (writable) facade member delegating to BillingService so diagnostics can wrap it in place');
  assert.match(dbg, /billing\.refreshBilling\.bind\(billing\)/,
    'debugger must capture the original refreshBilling before wrapping');
  assert.match(dbg, /billing\.refreshBilling = function/,
    'debugger must wrap by reassigning the facade member in place');
});
