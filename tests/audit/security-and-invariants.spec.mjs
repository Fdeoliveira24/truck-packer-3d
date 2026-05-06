import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const billingServiceUrl = new URL('../../src/data/services/billing.service.js', import.meta.url);
const accountOverlayPath = new URL('../../src/ui/overlays/account-overlay.js', import.meta.url);
const appPath = new URL('../../src/app.js', import.meta.url);
const indexHtmlPath = new URL('../../index.html', import.meta.url);
const corsSharedPath = new URL('../../supabase/functions/_shared/cors.ts', import.meta.url);
const supabasePath = new URL('../../src/core/supabase-client.js', import.meta.url);
const authOverlayPath = new URL('../../src/ui/overlays/auth-overlay.js', import.meta.url);
const settingsOverlayPath = new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url);
const orgInvitePath = new URL('../../supabase/functions/org-invite/index.ts', import.meta.url);
const orgInviteAcceptPath = new URL('../../supabase/functions/org-invite-accept/index.ts', import.meta.url);
const orgLeaveWorkspacePath = new URL('../../supabase/functions/org-leave-workspace/index.ts', import.meta.url);
const orgInviteExpirationMigrationPath = new URL(
  '../../supabase/migrations/2026050501_organization_invites_expiration.sql',
  import.meta.url
);

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

test('TrialExpiredModal shows immediately once billing confirms trial_expired', async () => {
  const app = await fs.readFile(appPath, 'utf8');

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

test('TrialExpiredModal no longer uses deferred latch state', async () => {
  const app = await fs.readFile(appPath, 'utf8');

  assert.doesNotMatch(app, /_trialModalDeferAttemptedForOrg/,
    'trial_expired modal should not retain deferred latch state');
  assert.doesNotMatch(app, /_trialModalDeferTimer/,
    'trial_expired modal should not retain deferred timer state');
  assert.doesNotMatch(app, /defer:latch/,
    'trial_expired modal should not wait for bundle latch branches');
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

test('bundle-inflight flag remains scoped to org context sync', async () => {
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

  assert.doesNotMatch(app, /defer:latch-wait-bundle/,
    'trial_expired modal should no longer wait for bundle latch branches');
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

// ── Organization invite authorization invariants ─────────────────────────────

test('org-invite rejects admin actors creating admin invites while preserving owner/admin role targets', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');

  assert.match(src, /const VALID_ROLES = new Set\(\["admin", "member"\]\)/,
    'invite creation must still allow owners to invite admins and members');
  assert.match(src, /requestedRole === "owner"[\s\S]*Owner invites are not allowed/,
    'owner-role invites must remain rejected at creation time');
  assert.match(src, /actorRole === "admin" && role === "admin"[\s\S]*status:\s*403/,
    'admin actors must get 403 when directly requesting an admin invite');
  assert.doesNotMatch(src, /actorRole === "owner" && role === "admin"[\s\S]*status:\s*403/,
    'owners must not be blocked from creating admin invites');
  assert.doesNotMatch(src, /actorRole === "admin" && role === "member"[\s\S]*status:\s*403/,
    'admins must not be blocked from creating member invites');
});

test('org-invite-accept only accepts member/admin roles and rejects legacy owner-role rows', async () => {
  const src = await fs.readFile(orgInviteAcceptPath, 'utf8');

  const roleFnMatch = src.match(/function normalizeAcceptedInviteRole\b[\s\S]*?^}/m);
  assert.ok(roleFnMatch, 'org-invite-accept must use an accepted-invite role normalizer');
  const roleFn = roleFnMatch[0];

  assert.match(roleFn, /"admin" \|\| role === "member"/,
    'accepted invites may create only admin or member memberships');
  assert.doesNotMatch(roleFn, /role === "owner"/,
    'accepted invites must never normalize owner as an accepted membership role');
  assert.match(src, /const role = normalizeAcceptedInviteRole\(invite\.role\);[\s\S]*if \(!role\)[\s\S]*Invite role is no longer valid/,
    'invalid or owner-role invite rows must be rejected before membership upsert');
});

test('org-invite-accept validates authenticated email before accepted-token success exposes organization_id', async () => {
  const src = await fs.readFile(orgInviteAcceptPath, 'utf8');

  const emailGuardIdx = src.indexOf('inviteEmail !== userEmail');
  const acceptedBranchIdx = src.indexOf('inviteStatus === "accepted"');
  const orgIdReturnIdx = src.indexOf('organization_id: invite.organization_id');

  assert.ok(emailGuardIdx > 0, 'accepted invite flow must compare invite email to authenticated user email');
  assert.ok(acceptedBranchIdx > emailGuardIdx,
    'already-accepted tokens must not succeed until after the email match guard');
  assert.ok(orgIdReturnIdx > emailGuardIdx,
    'organization_id must not be returned before the email match guard');
  assert.match(src, /inviteEmail !== userEmail[\s\S]*status:\s*403/,
    'wrong signed-in account must receive a safe 403 before org context is exposed');
});

test('org-invite-accept remains idempotent for the same invited user after email and role validation', async () => {
  const src = await fs.readFile(orgInviteAcceptPath, 'utf8');

  const emailGuardIdx = src.indexOf('inviteEmail !== userEmail');
  const roleGuardIdx = src.indexOf('if (!role)');
  const acceptedBranchIdx = src.indexOf('inviteStatus === "accepted"');

  assert.ok(acceptedBranchIdx > emailGuardIdx,
    'idempotent accepted-token response must run after authenticated email validation');
  assert.ok(acceptedBranchIdx > roleGuardIdx,
    'idempotent accepted-token response must run after accepted role validation');
  assert.match(src, /inviteStatus === "accepted"[\s\S]*already_accepted:\s*true[\s\S]*organization_id: invite\.organization_id/,
    'same invited user should still get an idempotent already_accepted response');
});

test('settings members confirms sensitive role changes and restores dropdown value on cancel', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function isSensitiveRoleChange\b[\s\S]*previous === 'owner' \|\| previous === 'admin' \|\| next === 'owner' \|\| next === 'admin'/,
    'owner/admin role changes must be classified as sensitive');
  assert.match(src, /roleSelect\.addEventListener\('change', async ev =>[\s\S]*UIComponents\.confirm\(/,
    'member role dropdown must confirm sensitive role changes before update');
  assert.match(src, /if \(!confirmed\) \{[\s\S]*roleSelect\.value = role;[\s\S]*return;/,
    'canceling role confirmation must restore the previous selected role');
  assert.match(src, /roleSelect\.value = nextRole;[\s\S]*updateMemberRole\(orgId, member, nextRole, currentUserId\)/,
    'confirmed role changes must proceed through the existing updateMemberRole path');
});

test('settings members confirms invite revoke with the existing danger modal path', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /revokeBtn\.addEventListener\('click'[\s\S]*UIComponents\.confirm\(\{[\s\S]*title: 'Revoke invite'[\s\S]*danger: true/,
    'pending invite revoke must use UIComponents.confirm with danger styling');
  assert.match(src, /if \(ok\) revokeInvite\(orgId, invite\);/,
    'revokeInvite must only run after confirmation succeeds');
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

test('settings members permission loading has a local timeout error instead of indefinite loading', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /const _MEMBERS_PERMISSION_TIMEOUT_MS = 10000/,
    'members permission loading must have a bounded timeout');
  assert.match(src, /rolePendingTimedOut = \(now - _membersPermissionPendingSince\) >= _MEMBERS_PERMISSION_TIMEOUT_MS/,
    'role pending state must flip to a timeout after the configured interval');
  assert.match(src, /Could not confirm your permissions\. Refresh and try again\./,
    'permission timeout must show a clear error message');
  assert.match(src, /tp3d-org-feedback tp3d-org-feedback--error/,
    'permission timeout must use the existing error feedback styling');
});

test('organization invite expiration migration adds expires_at and indexes pending expiry', async () => {
  const sql = await fs.readFile(orgInviteExpirationMigrationPath, 'utf8');

  assert.match(sql, /add column if not exists expires_at timestamptz/i,
    'migration must add organization_invites.expires_at');
  assert.match(sql, /set expires_at = coalesce\(invited_at, created_at, now\(\)\) \+ interval '7 days'/i,
    'pending invite backfill must use invited_at/created_at plus 7 days');
  assert.match(sql, /where status = 'pending'[\s\S]*accepted_at is null[\s\S]*revoked_at is null[\s\S]*expires_at is null/i,
    'backfill must target only unaccepted/unrevoked pending invites without expiry');
  assert.match(sql, /create index if not exists organization_invites_pending_expires_at_idx[\s\S]*on public\.organization_invites\(expires_at\)/i,
    'migration must add a useful pending-expiry index');
});

test('supabase client invite list selects expires_at for Settings pending invite UI', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');

  assert.match(src, /function getOrganizationInvites\b[\s\S]*\.select\('id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at'\)/,
    'getOrganizationInvites must select expires_at so Settings can render real invite expiration');
});

test('org-invite sets and refreshes expires_at on invite create and resend', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');

  assert.match(src, /const INVITE_EXPIRATION_DAYS = 7/,
    'org-invite must use a 7-day invite lifetime');
  assert.match(src, /function inviteExpiresAt\b[\s\S]*INVITE_EXPIRATION_DAYS \* 24 \* 60 \* 60 \* 1000/,
    'org-invite must compute expires_at from now plus the configured lifetime');
  assert.match(src, /const expiresAtIso = inviteExpiresAt\(now\)/,
    'org-invite must compute one expires_at value per request');
  assert.match(src, /expires_at: expiresAtIso/,
    'org-invite payload must include expires_at for both insert and update paths');
  assert.match(src, /\.update\(payload\)[\s\S]*\.select\("id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at"\)/,
    'resend/update path must return refreshed expires_at');
  assert.match(src, /\.insert\(\{[\s\S]*\.\.\.payload[\s\S]*\}\)[\s\S]*\.select\("id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at"\)/,
    'create path must return expires_at');
});

test('org-invite-accept rejects expired pending invites before membership insert without exposing organization_id', async () => {
  const src = await fs.readFile(orgInviteAcceptPath, 'utf8');

  assert.match(src, /\.select\("id, organization_id, email, role, status, expires_at, accepted_at, revoked_at"\)/,
    'org-invite-accept must fetch expires_at');
  assert.match(src, /function isInviteExpired\b[\s\S]*expiresAt\.getTime\(\) <= Date\.now\(\)/,
    'org-invite-accept must classify past expires_at as expired');

  const expiryIdx = src.indexOf('isInviteExpired(invite.expires_at)');
  const memberInsertIdx = src.indexOf('.from("organization_members")');
  assert.ok(expiryIdx > 0, 'expired invite guard must exist');
  assert.ok(memberInsertIdx > expiryIdx,
    'expired invite guard must run before membership insert/upsert');

  const expiredBranch = src.slice(expiryIdx, memberInsertIdx);
  assert.match(expiredBranch, /This invite link has expired\. Please ask the workspace owner to send a new invite\./,
    'expired invite response must be clear and safe');
  assert.doesNotMatch(expiredBranch, /organization_id/,
    'expired invite response must not expose organization_id');
});

test('settings members shows pending invite expiration state without new CSS', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function getInviteExpirationView\b/,
    'settings members must format invite expiry state');
  assert.match(src, /Expires in \$\{days\} days/,
    'future invites must show Expires in X days');
  assert.match(src, /Expires today/,
    'near-expiry invites must show Expires today');
  assert.match(src, /text: 'Expired'[\s\S]*tp3d-org-feedback tp3d-org-feedback--error/,
    'expired pending invites must use existing error styling');
  assert.match(src, /getInviteExpirationView\(invite\.expires_at\)[\s\S]*statusBadge\.textContent = expirationView\.expired \? 'Expired' : 'Pending'/,
    'expired pending invites must not look like valid pending invites');
});

test('app access-loss handler is active-org 403 only and ignores transient billing states', async () => {
  const src = await fs.readFile(appPath, 'utf8');

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

test('app access-loss handler verifies auth and active org, rate-limits, dispatches event, and refreshes org context', async () => {
  const src = await fs.readFile(appPath, 'utf8');

  assert.match(src, /let _orgAccessLossHandler = null/,
    'module-level handler slot must exist for refreshBilling');
  assert.match(src, /const _orgAccessLossLastAt = new Map\(\)/,
    'access-loss handling must rate-limit per org');
  assert.match(src, /const ORG_ACCESS_LOSS_COOLDOWN_MS = 30000/,
    'access-loss rate limit must be bounded');
  assert.match(src, /function handleOrgAccessLoss\(orgId, meta = \{\}\)[\s\S]*if \(!truth \|\| !truth\.isSignedIn \|\| !truth\.userId\) return false/,
    'handler must require signed-in auth truth');
  assert.match(src, /const activeOrgId = getActiveOrgIdNow\(\)[\s\S]*if \(!activeOrgId \|\| activeOrgId !== lostOrgId\) return false/,
    'handler must confirm the lost org is still the active org');
  assert.match(src, /_orgAccessLossLastAt\.set\(lostOrgId, now\)/,
    'handler must record rate-limit state by org');
  assert.match(src, /clearBillingState\(\)/,
    'handler must clear stale billing state after confirmed active-org access loss');
  assert.match(src, /new CustomEvent\('tp3d:org-access-lost'[\s\S]*detail: \{ orgId: lostOrgId, userId: truth\.userId, ts: now \}/,
    'handler must dispatch tp3d:org-access-lost with org/user/timestamp');
  assert.match(src, /refreshOrgContext\('access-loss-detected', \{ force: true, forceEmit: true \}\)/,
    'handler must force existing org context refresh after access loss');
  assert.doesNotMatch(src.match(/function handleOrgAccessLoss\(orgId, meta = \{\}\)[\s\S]*?return true;\n    \}/)?.[0] || '', /signOut|location\.reload|window\.location/,
    'handler must not sign out or reload the page');
});

test('settings overlay locks lost workspace and hides workspace-scoped controls', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /let orgAccessLostHandler = null/,
    'settings overlay must track its access-loss event listener');
  assert.match(src, /let _orgAccessLostId = ''/,
    'settings overlay must track the locked lost org id locally');
  assert.match(src, /function ensureOrgAccessLostListener\b[\s\S]*window\.addEventListener\('tp3d:org-access-lost', orgAccessLostHandler\)/,
    'settings overlay must listen for tp3d:org-access-lost while open');
  assert.match(src, /if \(!eventUserId \|\| !currentUserId \|\| eventUserId !== currentUserId\) return/,
    'settings overlay must ignore access-loss events for other users');
  assert.match(src, /if \(!lostOrgId \|\| !lockedOrgId \|\| lostOrgId !== lockedOrgId\) return/,
    'settings overlay must only lock the matching modal org');
  assert.match(src, /function removeOrgAccessLostListener\b[\s\S]*window\.removeEventListener\('tp3d:org-access-lost', orgAccessLostHandler\)/,
    'settings overlay must remove the access-loss listener on close');
  assert.match(src, /if \(_orgAccessLostId && _orgAccessLostId !== next\) \{[\s\S]*_orgAccessLostId = '';/,
    'settings overlay must clear lost-access state on org switch');
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

test('phase 0.5D keeps native dialogs absent from Settings overlay', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.equal(src.includes('window.alert'), false);
  assert.equal(src.includes('window.confirm'), false);
  assert.equal(src.includes('window.prompt'), false);
});

test('phase 0.6A org-leave-workspace edge function exists and requires auth', async () => {
  const src = await fs.readFile(orgLeaveWorkspacePath, 'utf8');

  assert.ok(src.length > 0, 'org-leave-workspace/index.ts must exist');
  assert.match(src, /if \(req\.method !== "POST"\)/,
    'leave-workspace must require POST');
  assert.match(src, /requireUser\(req\)/,
    'leave-workspace must require a signed-in user');
  assert.match(src, /if \(!auth\.ok \|\| !auth\.user\)/,
    'leave-workspace must reject unauthenticated requests');
  assert.match(src, /body\.organization_id \|\| body\.org_id/,
    'leave-workspace must accept organization_id with org_id fallback');
  assert.match(src, /Missing organization_id/,
    'leave-workspace must validate organization_id input');
});

test('phase 0.6A org-leave-workspace verifies membership and blocks unsafe owner leaves', async () => {
  const src = await fs.readFile(orgLeaveWorkspacePath, 'utf8');

  assert.match(src, /const membership = await getMembership\(sb, orgId, userId\)/,
    'leave-workspace must verify the current user membership');
  assert.match(src, /You are not a member of this workspace\./,
    'leave-workspace must block non-members safely');
  assert.match(src, /\.from\("organizations"\)[\s\S]*\.select\("owner_id"\)/,
    'leave-workspace must read organizations.owner_id');
  assert.match(src, /orgOwnerId && orgOwnerId === userId/,
    'leave-workspace must compare organizations.owner_id to the current user');
  assert.match(src, /You cannot leave this workspace because you are the primary owner\. Transfer ownership first\./,
    'leave-workspace must block the primary owner with transfer copy');
  assert.match(src, /You cannot leave this workspace because you are the last owner\. Transfer ownership or add another owner first\./,
    'leave-workspace must block the last owner with clear copy');
});

test('phase 0.6A org-leave-workspace deletes only the current user membership row', async () => {
  const src = await fs.readFile(orgLeaveWorkspacePath, 'utf8');

  assert.match(src, /\.from\("organization_members"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("organization_id", orgId\)[\s\S]*\.eq\("user_id", userId\)/,
    'leave-workspace must delete only the calling user membership row');
  assert.doesNotMatch(src, /\.from\("organizations"\)\s*\n\s*\.delete\(\)/,
    'leave-workspace must not delete the organization');
  assert.match(src, /return json\(\{ ok: true, organization_id: orgId \}/,
    'leave-workspace must return the removed organization_id');
});

test('phase 0.6A org-leave-workspace does not touch billing or Stripe', async () => {
  const src = await fs.readFile(orgLeaveWorkspacePath, 'utf8');

  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'leave-workspace must not reference billing or webhook tables');
  assert.doesNotMatch(src, /stripe|checkout|portal|billing-status/i,
    'leave-workspace must not reference Stripe, checkout, portal, or billing-status');
});

test('phase 0.6A billing service exports leaveWorkspace wrapper', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(src, /export async function leaveWorkspace\(orgId\)/,
    'billing service must export leaveWorkspace');
  assert.match(src, /postFn\('\/org-leave-workspace'[\s\S]*organization_id: orgId/,
    'leaveWorkspace must POST organization_id to /org-leave-workspace');
  assert.match(src, /return \{ ok: true, organization_id: organizationId \}/,
    'leaveWorkspace must return normalized organization_id on success');
});

test('phase 0.6A app exposes handleWorkspaceLeft and refreshes org context without logout or reload', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const end = src.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(helper, 'app must define handleWorkspaceLeft');
  assert.match(src, /window\.TruckPackerApp\.handleWorkspaceLeft = handleWorkspaceLeft/,
    'app must expose handleWorkspaceLeft on TruckPackerApp');
  assert.match(helper, /const normalizedLeftOrgId = normalizeOrgIdForBilling\(leftOrgId \|\| ''\)/,
    'handleWorkspaceLeft must normalize and guard leftOrgId');
  assert.match(helper, /clearBillingPendingRetry\(normalizedLeftOrgId\)/,
    'handleWorkspaceLeft must clear billing retry state for the left org');
  assert.match(helper, /if \(billingOrgId === normalizedLeftOrgId\) \{[\s\S]*clearBillingState\(\)/,
    'handleWorkspaceLeft must clear stale billing when scoped to the left org');
  assert.match(helper, /refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'handleWorkspaceLeft must force existing org context refresh');
  assert.doesNotMatch(helper, /signOut|forceLocalSignedOut|location\.reload|window\.location/,
    'handleWorkspaceLeft must not sign out or reload');
});

test('phase 0.6A settings general uses safe leave workspace UI', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('async function leaveWorkspace(orgId, orgName)');
  const end = src.indexOf('// ---- Organization invites ----', start);
  const handler = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(src, /leaveWorkspace as leaveWorkspaceFn/,
    'settings overlay must import leaveWorkspace');
  assert.match(src, /let _leaveWorkspaceInFlight = false/,
    'settings overlay must track leave in-flight state');
  assert.match(handler, /leaveWorkspaceFn\(normalizedOrgId\)/,
    'settings leave handler must call the service wrapper');
  assert.match(handler, /TruckPackerApp\.handleWorkspaceLeft\(normalizedOrgId, \{ source: 'settings-leave-workspace' \}\)/,
    'settings leave handler must call app post-leave helper');
  assert.match(handler, /queueAccountBundleRefresh\(\{ force: true, source: 'settings-leave-workspace' \}\)/,
    'settings leave handler must have an org/account refresh fallback');
  assert.match(src, /UIComponents\.confirm\(\{[\s\S]*title: 'Leave Workspace'[\s\S]*danger: true/,
    'leave action must use UIComponents.confirm with danger styling');
  assert.match(src, /leaveBtn\.disabled = _leaveWorkspaceInFlight \|\| isPrimaryOwner/,
    'leave button must disable while in flight and for primary owner');
  assert.match(src, /Transfer ownership before leaving\. You are the primary owner\./,
    'primary owner must see transfer-ownership helper copy');
  assert.doesNotMatch(src, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native browser dialogs');
});

test('phase 0.6A does not introduce archive restore transfer delete or export workspace flows', async () => {
  const edgeSrc = await fs.readFile(orgLeaveWorkspacePath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const appSrc = await fs.readFile(appPath, 'utf8');
  const appStart = appSrc.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const appEnd = appSrc.indexOf('// Expose billing pump globally', appStart);
  const helper = appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : '';
  const settingsStart = settingsSrc.indexOf('async function leaveWorkspace(orgId, orgName)');
  const settingsEnd = settingsSrc.indexOf('// ---- Organization invites ----', settingsStart);
  const settingsHandler = settingsStart >= 0 && settingsEnd > settingsStart
    ? settingsSrc.slice(settingsStart, settingsEnd)
    : '';

  for (const [label, src] of [
    ['org-leave-workspace', edgeSrc],
    ['handleWorkspaceLeft', helper],
    ['settings leaveWorkspace', settingsHandler],
  ]) {
    assert.doesNotMatch(src, /archiveWorkspace|restoreWorkspace|transferOwnership|deleteWorkspace|exportWorkspace/,
      `${label} must not add workspace lifecycle flows beyond Leave Workspace`);
  }
});

test('phase 0.6A-2 handleWorkspaceLeft syncs UI around forced org refresh', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const end = src.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(helper, 'handleWorkspaceLeft must exist');
  assert.match(helper, /clearBillingPendingRetry\(normalizedLeftOrgId\)/,
    'handleWorkspaceLeft must keep clearing billing pending retry for the left org');
  assert.match(helper, /if \(billingOrgId === normalizedLeftOrgId\) \{[\s\S]*clearBillingState\(\)/,
    'handleWorkspaceLeft must keep scoped stale billing cleanup for the left org');
  assert.match(helper, /SupabaseClient\.invalidateAccountCache\(\)/,
    'handleWorkspaceLeft must invalidate stale account bundle cache after membership self-removal');
  assert.match(helper, /syncWorkspaceUiAfterOrgRefresh\(source\)[\s\S]*refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'handleWorkspaceLeft must sync workspace UI before or alongside forced org refresh');
  assert.match(helper, /const refreshPromise = refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)[\s\S]*return refreshPromise/,
    'handleWorkspaceLeft must return the forced org refresh promise');
  assert.match(helper, /syncWorkspaceUiAfterOrgRefresh\(source \+ ':refreshed'\)/,
    'handleWorkspaceLeft must sync workspace UI again after org refresh settles');
  assert.doesNotMatch(helper, /signOut|forceLocalSignedOut|location\.reload|window\.location/,
    'handleWorkspaceLeft must not sign out or reload');
});

test('phase 0.6A-2 account switcher chip uses workspace initials instead of user initials', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const displayStart = src.indexOf('function getDisplay()');
  const displayEnd = src.indexOf('function renderButton(buttonEl)', displayStart);
  const displayFn = displayStart >= 0 && displayEnd > displayStart ? src.slice(displayStart, displayEnd) : '';
  const renderStart = src.indexOf('function renderButton(buttonEl)');
  const renderEnd = src.indexOf('function _showComingSoon()', renderStart);
  const renderFn = renderStart >= 0 && renderEnd > renderStart ? src.slice(renderStart, renderEnd) : '';

  assert.match(src, /function getActiveWorkspaceInitials\(\)[\s\S]*orgContext && orgContext\.activeOrg[\s\S]*name\.charAt\(0\)\.toUpperCase\(\)/,
    'app must derive switcher initials from active workspace name');
  assert.match(displayFn, /orgInitials: getActiveWorkspaceInitials\(\)/,
    'AccountSwitcher display object must expose workspace-derived initials');
  assert.match(displayFn, /userName: displayName \|\| '—'/,
    'AccountSwitcher must keep the secondary user/account display label');
  assert.match(renderFn, /avatarEl\.textContent = display\.orgInitials \|\| ''/,
    'AccountSwitcher chip avatar must render workspace initials');
  assert.doesNotMatch(renderFn, /avatarEl\.textContent = display\.initials/,
    'AccountSwitcher chip avatar must not render user/account initials');
});

test('phase 0.6A-2 bottom-left workspace chip avatar is circular', async () => {
  const src = await fs.readFile(indexHtmlPath, 'utf8');
  const btnIdx = src.indexOf('id="btn-account-switcher"');
  const chipSnippet = btnIdx >= 0 ? src.slice(btnIdx, btnIdx + 700) : '';

  assert.match(chipSnippet, /class="brand-mark tp3d-settings-account-avatar"[\s\S]*border-radius: 50%/,
    'bottom-left workspace chip avatar must use circular border radius');
  assert.doesNotMatch(chipSnippet, /border-radius: 12px/,
    'bottom-left workspace chip avatar must not keep the old square-ish 12px radius');
});

test('phase 0.6A-2 chip sync patch does not add Stripe billing-status or reload behavior', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const start = appSrc.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const end = appSrc.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? appSrc.slice(start, end) : '';
  const renderStart = appSrc.indexOf('function renderButton(buttonEl)');
  const renderEnd = appSrc.indexOf('function _showComingSoon()', renderStart);
  const renderFn = renderStart >= 0 && renderEnd > renderStart ? appSrc.slice(renderStart, renderEnd) : '';

  assert.doesNotMatch(helper + renderFn, /billing-status|billing_customers|subscriptions|stripe_customers|webhook_events|stripe|checkout|portal/i,
    'chip sync patch must not add billing-status, Stripe, or billing table behavior');
  assert.doesNotMatch(helper + renderFn, /signOut|forceLocalSignedOut|location\.reload|window\.location/,
    'chip sync patch must not sign out or reload');
});
