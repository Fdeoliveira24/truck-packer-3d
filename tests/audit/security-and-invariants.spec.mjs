import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const billingServiceUrl = new URL('../../src/data/services/billing.service.js', import.meta.url);
const accountOverlayPath = new URL('../../src/ui/overlays/account-overlay.js', import.meta.url);
const appPath = new URL('../../src/app.js', import.meta.url);
const corsSharedPath = new URL('../../supabase/functions/_shared/cors.ts', import.meta.url);
const supabasePath = new URL('../../src/core/supabase-client.js', import.meta.url);
const authOverlayPath = new URL('../../src/ui/overlays/auth-overlay.js', import.meta.url);

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

test('account overlay avoids direct userView template interpolation into innerHTML', async () => {
  const source = await fs.readFile(accountOverlayPath, 'utf8');
  const dangerousPattern = /innerHTML\s*=\s*`[^`]*\$\{\s*userView\./s;
  assert.equal(dangerousPattern.test(source), false);
});

test('shared CORS json helper does not default to wildcard origin', async () => {
  const source = await fs.readFile(corsSharedPath, 'utf8');
  assert.equal(source.includes('const allowOrigin = opts.origin ?? "*";'), false);
  assert.match(source, /const allowOrigin = opts\.origin \?\? "null";/);
});

test('app init keeps explicit single-flight/idempotency guards', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.match(source, /let\s+initInFlightPromise\s*=\s*null/);
  assert.match(source, /let\s+initCompleted\s*=\s*false/);
  assert.match(source, /if\s*\(initInFlightPromise\)\s*return\s+initInFlightPromise/);
});

test('logout actions use canonical helper and avoid timed reload after signOut', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.match(source, /async function performUserInitiatedLogout\(/);
  assert.match(source, /performUserInitiatedLogout\(\{ source: 'trial-expired-modal' \}\)/);
  assert.match(source, /performUserInitiatedLogout\(\{ source: 'trial-welcome' \}\)/);

  const timedReloadAfterSignOut =
    /SupabaseClient\.signOut\([\s\S]{0,600}setTimeout\([\s\S]{0,250}location\.reload\(/;
  assert.equal(timedReloadAfterSignOut.test(source), false);
});

test('org context cross-tab sync includes user + epoch metadata and stale guards', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.equal(source.includes("const ORG_CONTEXT_SYNC_KEY = 'tp3d:org-context-sync'"), true);
  assert.match(source, /dispatchOrgContextChanged\([\s\S]*userId/);
  assert.match(source, /dispatchOrgContextChanged\([\s\S]*epoch/);
  assert.match(source, /dispatchOrgContextChanged\([\s\S]*timestamp/);
  assert.match(source, /window\.addEventListener\('storage'[\s\S]*ORG_CONTEXT_SYNC_KEY/);
  assert.match(source, /detailUserId && truth\.userId && detailUserId !== truth\.userId/);
  assert.match(source, /detailEpoch && detailEpoch < lastAppliedOrgContextVersion/);
});

// ── Cross-tab auth proof & bundle noise elimination ────────────────────

test('auth proof fast-path gates prevent repeated cross-tab timeout calls', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');
  const app = await fs.readFile(appPath, 'utf8');

  // isAuthProven helper exists with TTL check
  assert.match(sc, /function isAuthProven\b/);
  assert.match(sc, /Date\.now\(\) > _authProvenUntil/);

  // getSessionSingleFlightSafe uses proof fast-path before lock-based call
  assert.match(sc, /getSessionSingleFlightSafe[\s\S]*?isAuthProven\(\)[\s\S]*?provenSession/);

  // getUserRawSingleFlight uses proof fast-path
  assert.match(sc, /getUserRawSingleFlight[\s\S]*?isAuthProven\(\)[\s\S]*?provenUser/);

  // app.js requestAuthRefresh skips when proven + cached
  assert.match(app, /skip-proven-fresh/);
});

test('bundle not marked partial when org context is complete', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');

  // orgContextComplete check exists
  assert.match(sc, /orgContextComplete\s*=\s*Boolean\(activeOrgId\s*&&\s*orgsSafe\.length\s*>=\s*1\)/);

  // partial flag uses orgContextComplete guard
  assert.match(sc, /partial\s*=\s*Boolean\([\s\S]*?!orgContextComplete/);

  // authProofStale computed and included in bundle
  assert.match(sc, /authProofStale\s*=\s*Boolean/);
});

test('auth guard uses backoff with setTimeout recursion instead of setInterval', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');

  // validateSessionOrSignOut has isAuthProven gate
  assert.match(sc, /validateSessionOrSignOut[\s\S]*?isAuthProven\(\)/);

  // Uses setTimeout recursion (not setInterval)
  assert.match(sc, /function _scheduleGuardTick[\s\S]*?window\.setTimeout/);

  // Backoff state variables exist
  assert.match(sc, /_authGuardBackoff/);
  assert.match(sc, /AUTH_GUARD_MAX_BACKOFF_MS/);
});

test('auth proof cleared on signOut, forceLocalSignedOut, and SIGNED_OUT event', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');

  // updateAuthState resets _authProvenUntil to 0 when status becomes signed_out
  assert.match(sc, /update\.status === 'signed_out'[\s\S]*?_authProvenUntil = 0/);

  // forceLocalSignedOut calls updateAuthState with signed_out (which clears proof)
  assert.match(sc, /function forceLocalSignedOut[\s\S]*?updateAuthState\(\{ status: 'signed_out'/);

  // signOut() calls updateAuthState with signed_out (which clears proof)
  assert.match(sc, /async function signOut[\s\S]*?updateAuthState\(\{ status: 'signed_out'/);

  // onAuthStateChange SIGNED_OUT event passes signed_out to updateAuthState
  assert.match(sc, /onAuthStateChange[\s\S]*?updateAuthState\(\{[\s\S]*?status: nextSession \? 'signed_in' : 'signed_out'/);
});

test('validateSessionOrSignOut never signs out on timeout — only on auth-revoked', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');

  // Extract the function body (up to installAuthGuard)
  const fnMatch = sc.match(/async function validateSessionOrSignOut\b[\s\S]*?^function installAuthGuard\b/m);
  assert.ok(fnMatch, 'validateSessionOrSignOut function must exist');
  const fnBody = fnMatch[0];

  // The ONLY forceLocalSignedOut in the function is guarded by isAuthRevokedError
  assert.match(fnBody, /isAuthRevokedError\(err\)[\s\S]*?forceLocalSignedOut/);

  // No other forceLocalSignedOut call exists in the function
  const forceCallCount = (fnBody.match(/forceLocalSignedOut/g) || []).length;
  assert.equal(forceCallCount, 1, 'only one forceLocalSignedOut call (guarded by isAuthRevokedError)');

  // Timeout/null/error paths return true (keep session alive)
  assert.match(fnBody, /if \(!soft \|\| !soft\.ok\)[\s\S]*?return true/);
});

test('billing pump never runs without proven auth or usable session', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // maybeScheduleBillingRefresh has an auth gate before any orgId/retry logic
  assert.match(app, /function maybeScheduleBillingRefresh[\s\S]*?isAuthProven[\s\S]*?skip:auth-not-proven/);

  // Gate checks session expires_at for fallback when not proven
  assert.match(app, /maybeScheduleBillingRefresh[\s\S]*?expires_at \* 1000[\s\S]*?> Date\.now\(\)/);
});

test('TrialExpiredModal upgrades in-place when role resolves and never reads legacy session storage', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // upgradeTrialModalToOwner helper exists for in-place DOM upgrade
  assert.match(app, /const upgradeTrialModalToOwner\s*=/);

  // Guard logic upgrades in-place instead of close/reopen
  assert.match(app, /if \(canManageBilling && !_trialModalCanManageBilling\)\s*\{\s*upgradeTrialModalToOwner\(/);

  // applyOrgContextFromBundle re-applies billing gate after role resolves
  assert.match(app, /applyAccessGateFromBilling\(getBillingState\(\),\s*\{\s*reason:\s*'bundle-role-resolved'\s*\}\)/);

  // resolveCanManageBillingForOrg never reads truckPacker3d:session:v1
  const fnMatch = app.match(/function resolveCanManageBillingForOrg\b[\s\S]*?return result;/);
  assert.ok(fnMatch, 'resolveCanManageBillingForOrg function must exist');
  assert.equal(fnMatch[0].includes('truckPacker3d:session:v1'), false,
    'resolveCanManageBillingForOrg must not read legacy session storage');
});

test('upgradeTrialModalToOwner is idempotent — uses data-trial-upgrade-btn guard', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // The upgrade function checks for an existing button before inserting
  assert.match(app, /data-trial-upgrade-btn/,
    'upgradeTrialModalToOwner must use data-trial-upgrade-btn attribute');
  assert.match(app, /querySelector\(\s*'\[data-trial-upgrade-btn\]'\s*\)/,
    'upgradeTrialModalToOwner must query for existing upgrade button before inserting');
});

test('TrialExpiredModal defers display when role is unresolved', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // Defer state variables exist
  assert.match(app, /let _trialModalDeferTimer\s*=\s*null/);
  assert.match(app, /let _trialModalDeferOrgId\s*=\s*null/);
  assert.match(app, /const TRIAL_MODAL_ROLE_DEFER_MS\s*=\s*900/);

  // Defer fires trial-modal-deferred reason
  assert.match(app, /reason:\s*'trial-modal-deferred'/);

  // Defer timer is cleared on close
  assert.match(app, /_clearTrialModalDeferTimer/);

  // Four-branch structure: resolved → show, latch-hit → show, no timer → start, timer running → no-op
  assert.match(app, /} else if \(!_trialModalDeferTimer\) \{/,
    'defer must use else-if for timer-not-running guard (no-op when timer already running)');
  // Comment confirming the no-op branch exists
  assert.match(app, /\/\/ else: timer already running, role still unresolved/);
});

test('legacy org-sync handler is hint-only and does not call handleIncomingOrgContextSync', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // The legacy-active-org-id string must still exist (as a log label)
  assert.match(app, /legacy-hint/,
    'legacy handler must use hint-only pattern');

  // Legacy handler must NOT build a synthetic payload with handleIncomingOrgContextSync
  // Extract the ORG_CONTEXT_LS_KEY block — it's between "if (key === ORG_CONTEXT_LS_KEY)" and the next "return;"
  const lsKeyIdx = app.indexOf('key === ORG_CONTEXT_LS_KEY');
  assert.ok(lsKeyIdx > 0, 'ORG_CONTEXT_LS_KEY handler must exist');
  const lsBlock = app.slice(lsKeyIdx, lsKeyIdx + 1200);
  assert.equal(lsBlock.includes('handleIncomingOrgContextSync'), false,
    'legacy LS_KEY handler must not call handleIncomingOrgContextSync directly');
  assert.equal(lsBlock.includes('epoch: Date.now()'), false,
    'legacy handler must not use epoch: Date.now()');
  assert.equal(lsBlock.includes('nextOrgContextVersion()'), false,
    'legacy handler must not call nextOrgContextVersion()');

  // Must use refreshOrgContext as the fallback
  assert.ok(lsBlock.includes('refreshOrgContext'),
    'legacy handler must fall back to refreshOrgContext');
});

test('TrialExpiredModal defer latch prevents second timer cycle for same org', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // Latch variable exists
  assert.match(app, /let _trialModalDeferAttemptedForOrg\s*=\s*null/,
    'defer latch variable must exist');

  // Latch is checked before starting a new timer
  assert.match(app, /_trialModalDeferAttemptedForOrg === orgId/,
    'defer must check latch before starting timer');

  // Latch is set when starting the timer
  assert.match(app, /_trialModalDeferAttemptedForOrg = orgId/,
    'defer must set latch when starting timer');

  // Latch is cleared on modal close
  const closeBlock = app.slice(
    app.indexOf('const closeTrialExpiredModal'),
    app.indexOf('const closeTrialExpiredModal') + 500
  );
  assert.ok(closeBlock.includes('_trialModalDeferAttemptedForOrg = null'),
    'latch must be cleared in closeTrialExpiredModal');
});

test('resolveCanManageBillingForOrg has early-out guard for missing orgId or userId', async () => {
  const app = await fs.readFile(appPath, 'utf8');

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

test('bundle-inflight flag gates trial modal latch-show during cross-tab sync', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // Variable exists
  assert.match(app, /let _orgBundleFetchInflightForOrg\s*=\s*null/,
    '_orgBundleFetchInflightForOrg variable must exist');

  // Set before refreshOrgContext in handleIncomingOrgContextSync
  const syncFnMatch = app.match(/function handleIncomingOrgContextSync\b[\s\S]*?void refreshOrgContext/);
  assert.ok(syncFnMatch, 'handleIncomingOrgContextSync must call refreshOrgContext');
  assert.ok(syncFnMatch[0].includes('_orgBundleFetchInflightForOrg = incomingOrgId'),
    'must set _orgBundleFetchInflightForOrg before refreshOrgContext');

  // Cleared in applyOrgContextFromBundle
  assert.match(app, /_orgBundleFetchInflightForOrg === nextOrgIdStr\) _orgBundleFetchInflightForOrg = null/,
    'must clear inflight flag in applyOrgContextFromBundle');

  // Cleared in clearOrgContext
  const clearBlock = app.slice(
    app.indexOf('function clearOrgContext'),
    app.indexOf('function clearOrgContext') + 600
  );
  assert.ok(clearBlock.includes('_orgBundleFetchInflightForOrg = null'),
    'must clear inflight flag in clearOrgContext');

  // Latch branch checks inflight before rendering
  assert.match(app, /defer:latch-wait-bundle/,
    'must log defer:latch-wait-bundle when bundle is inflight');
  assert.match(app, /_orgBundleFetchInflightForOrg === orgId/,
    'latch branch must check _orgBundleFetchInflightForOrg');
});

test('tp3dDebug-only billing accessor is guarded by isTp3dDebugEnabled', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // window['getBillingState'] assignment must be inside isTp3dDebugEnabled guard
  const debugAccessorMatch = app.match(/if \(isTp3dDebugEnabled\(\)\) \{[\s\S]*?window\['getBillingState'\]/);
  assert.ok(debugAccessorMatch,
    'window[getBillingState] must only be set when tp3dDebug is enabled');
});

// ── Login UI reliability ──────────────────────────────────────────────────────

test('auth overlay render() preserves input values before innerHTML clear', async () => {
  const src = await fs.readFile(authOverlayPath, 'utf8');

  // render() must read current email input value before clearing
  const renderFn = src.substring(
    src.indexOf('function render('),
    src.indexOf('function render(') + 600
  );
  assert.ok(renderFn.includes('input[type="email"]'),
    'render() must query email input before innerHTML clear');
  assert.ok(renderFn.includes('input[type="password"]'),
    'render() must query password input before innerHTML clear');
  // The save must occur BEFORE innerHTML = ''
  const saveIdx = renderFn.indexOf('querySelector');
  const clearIdx = renderFn.indexOf('innerHTML');
  assert.ok(saveIdx < clearIdx,
    'input value save must come before innerHTML clear');
});

test('auth overlay show() does not re-render when already open', async () => {
  const src = await fs.readFile(authOverlayPath, 'utf8');

  const showFn = src.substring(
    src.indexOf('function show()'),
    src.indexOf('function show()') + 400
  );
  // If isOpen, should return early without calling render
  assert.ok(showFn.includes('if (isOpen) return'),
    'show() must return early when already open');
  // Should NOT have the old pattern: if (isOpen) { render(); return; }
  assert.ok(!showFn.includes('if (isOpen) { render'),
    'show() must NOT call render() when already open');
});

test('auth overlay setPhase skips re-render when form is already showing same phase', async () => {
  const src = await fs.readFile(authOverlayPath, 'utf8');

  const setPhaseFn = src.substring(
    src.indexOf('function setPhase('),
    src.indexOf('function setPhase(') + 600
  );
  assert.ok(setPhaseFn.includes('setPhase:skip'),
    'setPhase must log skip when phase is unchanged and form is open');
  assert.ok(setPhaseFn.includes('unchanged') && setPhaseFn.includes('isOpen'),
    'setPhase must check unchanged + isOpen before skipping render');
});

test('auth overlay renderSignIn passes _fieldPassword as value to password field', async () => {
  const src = await fs.readFile(authOverlayPath, 'utf8');

  const signInFn = src.substring(
    src.indexOf('function renderSignIn()'),
    src.indexOf('function renderSignIn()') + 600
  );
  assert.ok(signInFn.includes('value: _fieldPassword'),
    'renderSignIn must pass _fieldPassword to buildPasswordField');
});

// ── Auth settled state ────────────────────────────────────────────────────────

test('authGate settled is set true on signedIn, signedOutConfirmed, and bootstrap-no-session', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // settled:set log must appear at every _authGate.settled = true site
  const settledSetCount = (app.match(/settled:set/g) || []).length;
  assert.ok(settledSetCount >= 4,
    `expected at least 4 settled:set log sites, got ${settledSetCount}`);

  // Bootstrap no-session path must set settled when no timer is pending
  const bootstrapBlock = app.substring(
    app.indexOf('bootstrapAuthGate = async'),
    app.indexOf('bootstrapAuthGate = async') + 2500
  );
  assert.ok(bootstrapBlock.includes('bootstrap-no-session'),
    'bootstrapAuthGate must set settled on no-session path');
  assert.ok(bootstrapBlock.includes('bootstrap-cantconnect'),
    'bootstrapAuthGate must set settled on cantconnect path');
  // Guard: only set when no pending timer
  assert.ok(bootstrapBlock.includes('!_authGate.signedOutTimer'),
    'bootstrap settled must check for pending signedOutTimer');
});

test('auth settled is never set false after initialization', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  // Only one place should have settled: false (the initial declaration)
  const settledFalseCount = (app.match(/_authGate\.settled\s*=\s*false|settled:\s*false/g) || []).length;
  assert.equal(settledFalseCount, 1,
    `settled should only be false in the initial declaration, found ${settledFalseCount} sites`);
});
