// account session invariants: contract tests from the former security suite.

import {
  RECON_RECT,
  RECON_WW,
  accountOverlayPath,
  accountPurgeStatusMigrationPath,
  assert,
  assertCanonicalReconLayoutSafe,
  authOverlayPath,
  autoPackEnginePath,
  banUserPath,
  billingServiceUrl,
  cancelAccountDeletionPath,
  createBillingPumpRuntimeHarness,
  createLateWorkspaceHydrationRuntime,
  createOrgContextApplyRuntimeHarness,
  createPhase4LogoutHarness,
  deleteAccountPath,
  enforceWorkspaceLimitMigrationPath,
  executeOrgMemberRoleUpdate,
  fs,
  guardProfileDeletionFieldsMigrationPath,
  makeTruckChangeHarness,
  orgCreateWorkspacePath,
  orgInviteAcceptPath,
  orgInvitePath,
  orgInviteRevokePath,
  orgLeaveWorkspacePath,
  orgMemberRoleUpdatePath,
  orgRestoreWorkspacePath,
  orgTransferOwnershipPath,
  p5Modules,
  packLibraryPath,
  purgeDeletedAccountsPath,
  purgeDeletedUsersPath,
  readAppSource,
  reconFB,
  requestAccountDeletionPath,
  restrictMembershipMutationMigrationPath,
  settingsOverlayPath,
  signupAutoOrgUuidMigrationPath,
  supabaseConfigPath,
  supabasePath,
  test,
  truckChangeControllerPath,
  unbanUserPath,
  vm,
} from '../fixtures/security-invariants-support.mjs';

test('account overlay avoids direct userView template interpolation into innerHTML', async () => {
  const source = await fs.readFile(accountOverlayPath, 'utf8');
  const dangerousPattern = /innerHTML\s*=\s*`[^`]*\$\{\s*userView\./s;
  assert.equal(dangerousPattern.test(source), false);
});

test('phase 0.6D-pre legacy delete-account endpoint is retired safely', async () => {
  const source = await fs.readFile(deleteAccountPath, 'utf8');

  assert.match(source, /This endpoint has been retired\. Use request-account-deletion\./,
    'delete-account must direct callers to request-account-deletion');
  assert.match(source, /status:\s*410/,
    'delete-account must return HTTP 410');
  assert.doesNotMatch(source, /auth\.admin\.deleteUser/,
    'delete-account must not delete auth users directly');
  assert.doesNotMatch(source, /\.from\(['"](?:profiles|organizations|organization_members|billing_customers|subscriptions|packs|cases)['"]\)|storage\.from|stripe/i,
    'retired delete-account must not mutate app data, storage, billing, or Stripe');
  assert.doesNotMatch(source, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
    'delete-account must not contain wildcard CORS');
});

test('phase 0.6D-pre ban-user and unban-user endpoints are retired without wildcard CORS', async () => {
  for (const endpointPath of [banUserPath, unbanUserPath]) {
    const source = await fs.readFile(endpointPath, 'utf8');
    assert.match(source, /This endpoint has been retired\. Use request-account-deletion\./,
      'legacy ban/unban endpoint must direct callers to request-account-deletion');
    assert.match(source, /status:\s*410/,
      'legacy ban/unban endpoint must return HTTP 410');
    assert.doesNotMatch(source, /auth\.admin|updateUserById|ban_duration/,
      'retired ban/unban endpoint must not call admin auth mutation APIs');
    assert.doesNotMatch(source, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
      'retired ban/unban endpoint must not contain wildcard CORS');
  }
});

test('phase 0.6D-pre request-account-deletion remains present as the supported path', async () => {
  const source = await fs.readFile(requestAccountDeletionPath, 'utf8');
  assert.match(source, /request-account-deletion/,
    'request-account-deletion function source must remain present');
  assert.match(source, /deletion_status:\s*"requested"/,
    'request-account-deletion must remain the supported account deletion request path');
  assert.doesNotMatch(source, /This endpoint has been retired/,
    'request-account-deletion must not be retired in this phase');
});

test('phase 0.6D-pre 4B login gate blocks deletion_status requested regardless of banned_until', async () => {
  const src = await readAppSource();
  const start = src.indexOf("if (profileStatus && profileStatus.deletion_status === 'requested')");
  const end = src.indexOf('// Clear any previously set forced-disabled latch', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block, 'requested deletion status block must be extractable');
  assert.match(block, /SupabaseClient\.signOut\(\{ global: false, allowOffline: true \}\)/,
    'requested deletion status must sign out locally');
  assert.match(block, /setAuthBlocked\(delMsg\)/,
    'requested deletion status must set auth blocked state');
  assert.match(block, /AuthOverlay\.showAccountDisabled\(delMsg\)/,
    'requested deletion status must show disabled auth overlay');
  assert.match(block, /Your account is scheduled for deletion\. Contact support to cancel this request\./,
    'requested deletion status must use the approved support copy');
  assert.doesNotMatch(block, /banned_until/,
    'requested deletion status block must not depend on banned_until');
});

test('phase 0.6D-pre 4B getMyProfileStatus selects deleted_at alongside deletion_status and purge_after', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getMyProfileStatus()');
  const end = src.indexOf('export async function updateProfile(updates)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'getMyProfileStatus must be extractable');
  assert.match(fn, /\.select\('deletion_status, deleted_at, purge_after'\)/,
    'getMyProfileStatus must return deleted_at for account deletion UX and auditing');
});

test('phase 0.6D-pre 4B request-account-deletion does not immediately delete organization_members', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');

  assert.doesNotMatch(src, /\.from\(["']organization_members["']\)[\s\S]{0,120}\.delete\(\)[\s\S]{0,120}\.eq\(["']user_id["'],\s*userId\)/,
    'request-account-deletion must not delete organization_members during the 30-day deletion window');
  assert.match(src, /Preserve memberships during the 30-day deletion window[\s\S]*auth-user cascade during the purge phase/,
    'request-account-deletion must document deferred membership cleanup');
});

test('phase 0.6D-pre 4B request-account-deletion is idempotent on already-requested non-expired profile', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');
  const branchStart = src.indexOf('existingStatus === "requested"');
  const branchEnd = src.indexOf('const nowIso = new Date().toISOString();', branchStart);
  const branch = branchStart >= 0 && branchEnd > branchStart ? src.slice(branchStart, branchEnd) : '';

  assert.ok(branch, 'already-requested idempotency branch must be before fresh timestamp creation');
  assert.match(src, /\.select\("deletion_status, deleted_at, purge_after"\)/,
    'request-account-deletion must read existing deletion state');
  assert.match(branch, /existingPurgeAfterMs > Date\.now\(\)/,
    'idempotency branch must only apply when existing purge_after is still in the future');
  assert.match(branch, /already_requested:\s*true/,
    'idempotency branch must mark already requested response');
  assert.match(branch, /purge_after:\s*existingPurgeAfter/,
    'idempotency branch must return existing purge_after without extending it');
  assert.doesNotMatch(branch, /THIRTY_DAYS_MS|Date\.now\(\) \+ THIRTY_DAYS_MS/,
    'idempotency branch must not compute a new purge window');
});

test('phase 0.6D-pre 4B request-account-deletion still blocks last owner', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');

  assert.match(src, /LAST_OWNER_DELETE_ERROR/,
    'request-account-deletion must preserve the last-owner error');
  assert.match(src, /const isLastOwner = ownedOrgIds\.some/,
    'request-account-deletion must preserve last-owner detection');
  assert.match(src, /if \(isLastOwner\)[\s\S]*status:\s*409/,
    'request-account-deletion must keep returning 409 for last-owner requests');
});

test('phase 0.6D-pre 4B request deletion changes avoid Stripe billing workspace lifecycle and reload scope creep', async () => {
  const requestSrc = await fs.readFile(requestAccountDeletionPath, 'utf8');
  const appSrc = await readAppSource();
  const supabaseSrc = await fs.readFile(supabasePath, 'utf8');

  const requestStart = requestSrc.indexOf('const { data: existingProfile');
  const requestEnd = requestSrc.indexOf('// Best effort login block while deletion is pending.', requestStart);
  const requestedBlockStart = appSrc.indexOf("if (profileStatus && profileStatus.deletion_status === 'requested')");
  const requestedBlockEnd = appSrc.indexOf('// Clear any previously set forced-disabled latch', requestedBlockStart);
  const profileStart = supabaseSrc.indexOf('export async function getMyProfileStatus()');
  const profileEnd = supabaseSrc.indexOf('export async function updateProfile(updates)', profileStart);
  const snippets = [
    requestStart >= 0 && requestEnd > requestStart ? requestSrc.slice(requestStart, requestEnd) : '',
    requestedBlockStart >= 0 && requestedBlockEnd > requestedBlockStart ? appSrc.slice(requestedBlockStart, requestedBlockEnd) : '',
    profileStart >= 0 && profileEnd > profileStart ? supabaseSrc.slice(profileStart, profileEnd) : '',
  ].join('\n');

  assert.ok(snippets.trim(), '4B request deletion snippets must be extractable');
  assert.doesNotMatch(snippets, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    '4B request deletion changes must not touch billing or Stripe scope');
  assert.doesNotMatch(snippets, /archiveWorkspace|restoreWorkspace|org-archive|org-restore|org-invite|org-member-remove|org-member-role-update/i,
    '4B request deletion changes must not touch workspace lifecycle or invite/member Edge Function scope');
  assert.doesNotMatch(snippets, /deletePack|deleteCase|storage\.from|router\.|window\.location\.reload|location\.reload/i,
    '4B request deletion changes must not touch packs, cases, storage, router, or reload behavior');
});

test('phase 0.6D-pre 4B-1B request-account-deletion blocks if user is organizations.owner_id', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');

  assert.match(src, /\.from\("organizations"\)[\s\S]{0,200}\.eq\("owner_id", userId\)/,
    'request-account-deletion must query organizations.owner_id to block workspace owners');
  assert.match(src, /OWNER_WORKSPACE_DELETE_ERROR/,
    'request-account-deletion must define an owner-workspace block error constant');
  assert.match(src, /You cannot delete your account while you own a workspace\. Transfer ownership or contact support first\./,
    'request-account-deletion must include the approved owner workspace block message');
});

test('phase 0.6D-pre 4B-1B request-account-deletion owner block returns 409', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');
  const blockStart = src.indexOf('OWNER_WORKSPACE_DELETE_ERROR');
  const blockEnd = src.indexOf('const { data: ownedMemberships', blockStart);
  const block = blockStart >= 0 && blockEnd > blockStart ? src.slice(blockStart, blockEnd) : '';

  assert.ok(block, 'OWNER_WORKSPACE_DELETE_ERROR block must be extractable before organization_members last-owner check');
  assert.match(block, /status:\s*409/,
    'owner block must return HTTP 409');
});

test('phase 0.6D-pre 4B-1B request-account-deletion owner block does not exempt archived workspaces', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');
  const blockStart = src.indexOf('.from("organizations")');
  const blockEnd = src.indexOf('.from("organization_members")', blockStart);
  const block = blockStart >= 0 && blockEnd > blockStart ? src.slice(blockStart, blockEnd) : '';

  assert.ok(block, 'organizations owner check block must be extractable');
  assert.doesNotMatch(block, /\.isNull\(['"]archived_at['"]\)|\.is\(['"]archived_at['"],\s*null\)|archived_at[\s\S]{0,40}is null/i,
    'owner block must not filter out archived workspaces');
});

test('phase 0.6D-pre 4B-1B request-account-deletion still preserves last-owner protection', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');

  assert.match(src, /LAST_OWNER_DELETE_ERROR/,
    'last-owner error constant must still be present');
  assert.match(src, /const isLastOwner = ownedOrgIds\.some/,
    'last-owner detection via organization_members must still be present');
  assert.match(src, /if \(isLastOwner\)[\s\S]*status:\s*409/,
    'last-owner check must still return 409');
});

test('phase 0.6D-pre 4B-1B request deletion owner block avoids billing workspace lifecycle and destructive scope creep', async () => {
  const src = await fs.readFile(requestAccountDeletionPath, 'utf8');
  const blockStart = src.indexOf('OWNER_WORKSPACE_DELETE_ERROR');
  const blockEnd = src.indexOf('const { data: ownedMemberships', blockStart);
  const ownerBlock = blockStart >= 0 && blockEnd > blockStart ? src.slice(blockStart, blockEnd) : '';

  assert.ok(ownerBlock, 'OWNER_WORKSPACE_DELETE_ERROR block must be extractable');
  assert.doesNotMatch(ownerBlock, /stripe|checkout|portal|webhook|billing_customers|subscriptions|stripe_customers|billing-status/i,
    '4B-1B owner block must not touch billing or Stripe');
  assert.doesNotMatch(ownerBlock, /archiveWorkspace|restoreWorkspace|org-archive|org-restore|org-invite|org-member/i,
    '4B-1B owner block must not touch workspace lifecycle or member/invite functions');
  assert.doesNotMatch(ownerBlock, /storage\.from|deletePack|deleteCase|router\.|location\.reload|signOut/i,
    '4B-1B owner block must not touch storage, packs, cases, router, reload, or signOut');
});

test('phase 0.6D-pre 4B-1B requestAccountDeletion extracts Edge Function JSON message for 409 responses', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const fnStart = src.indexOf('export async function requestAccountDeletion()');
  const fnEnd = src.indexOf('// ============================================================================\n// SECTION: ORG LOGO HELPER', fnStart);
  const fn = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';

  assert.ok(fn, 'requestAccountDeletion must be extractable');
  assert.doesNotMatch(fn, /client\.functions\.invoke\(['"]request-account-deletion['"]/,
    'requestAccountDeletion must avoid Supabase functions.invoke generic FunctionError for this flow');
  assert.match(fn, /fetch\(getFunctionUrl\(\),[\s\S]*method:\s*'POST'[\s\S]*headers:\s*await getFunctionHeaders\(\)/,
    'requestAccountDeletion must call the Edge Function directly with current auth headers');
  assert.match(fn, /async function readResponsePayload\(res\)[\s\S]*res\.clone\(\)\.text\(\)[\s\S]*JSON\.parse\(text\)[\s\S]*parsed\.error/,
    'requestAccountDeletion must parse JSON response bodies from non-2xx Edge Function responses');
  assert.match(fn, /const status = response \? Number\(response\.status\) : null;/,
    'requestAccountDeletion must branch on the actual HTTP response status');
  assert.match(fn, /if \(status === 409\)[\s\S]*new Error\(msg \|\| 'Deletion request failed'\)[\s\S]*throw conflictError/,
    'requestAccountDeletion must throw the parsed server message for 409 conflicts');
  assert.doesNotMatch(fn, /throw error|Edge Function returned a non-2xx status code/,
    'requestAccountDeletion must not throw the raw generic FunctionError for 409 conflicts');
});

test('phase 0.6D-pre 4B-1B account deletion UI preserves server 409 message', async () => {
  const accountSrc = await fs.readFile(accountOverlayPath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');

  const accountCall = accountSrc.indexOf('await SupabaseClient.requestAccountDeletion();');
  const accountCatch = accountSrc.indexOf('} catch (err) {', accountCall);
  const accountFailure = accountCatch >= 0
    ? accountSrc.slice(accountCatch, accountSrc.indexOf('}', accountCatch + 20))
    : '';
  assert.ok(accountFailure, 'account overlay deletion failure handler must be extractable');
  assert.match(accountFailure, /err && err\.message \? err\.message : String\(err\)/,
    'account overlay must preserve the server error message');
  assert.match(accountFailure, /UIComponents\.showToast\(msg \|\| 'Delete request failed\.', 'error'\)/,
    'account overlay must show server error message in existing toast feedback');
  assert.doesNotMatch(accountFailure, /signOut|location\.reload|window\.location|close\(\)/,
    'account overlay failure handler must not sign out, reload, or close before feedback');

  const settingsCall = settingsSrc.indexOf('await SupabaseClient.requestAccountDeletion();');
  const settingsCatch = settingsSrc.indexOf('} catch (err) {', settingsCall);
  const settingsFailure = settingsCatch >= 0
    ? settingsSrc.slice(settingsCatch, settingsSrc.indexOf('confirmInput.disabled = false;', settingsCatch) + 30)
    : '';
  assert.ok(settingsFailure, 'settings overlay deletion failure handler must be extractable');
  assert.match(settingsFailure, /err && err\.message \? String\(err\.message\) : ''/,
    'settings overlay must preserve the server error message');
  assert.match(settingsFailure, /errorMsg\.textContent = msg \|\| 'Delete request failed\.'/,
    'settings overlay must display server error message inline');
  assert.doesNotMatch(settingsFailure, /signOut|location\.reload|window\.location|modalRef\.close/,
    'settings overlay failure handler must not sign out, reload, or close before feedback');
});

test('phase 0.6D-pre 4B-1B cancel and legacy purge endpoints remain untouched', async () => {
  const cancelSrc = await fs.readFile(cancelAccountDeletionPath, 'utf8');
  const purgeSrc = await fs.readFile(purgeDeletedUsersPath, 'utf8');
  const supabaseSrc = await fs.readFile(supabasePath, 'utf8');

  assert.match(cancelSrc, /ACCOUNT_DELETION_SUPPORT_SECRET/,
    'cancel-account-deletion must remain support-secret based');
  assert.doesNotMatch(supabaseSrc, /cancelAccountDeletion/,
    'no frontend cancelAccountDeletion wrapper should be added');
  assert.match(purgeSrc, /status:\s*410/,
    'purge-deleted-users must remain a retired 410 stub');
  assert.doesNotMatch(purgeSrc, /auth\.admin\.deleteUser/,
    'purge-deleted-users stub must not delete auth users');
});

test('phase 0.6D-pre 4B-2a cancel-account-deletion exists and requires support secret', async () => {
  const src = await fs.readFile(cancelAccountDeletionPath, 'utf8');

  assert.match(src, /ACCOUNT_DELETION_SUPPORT_SECRET/,
    'cancel-account-deletion must read the support secret from env');
  assert.match(src, /x-cancel-secret/,
    'cancel-account-deletion must accept the support secret header');
  assert.match(src, /authorization[\s\S]*bearer/i,
    'cancel-account-deletion may accept Authorization bearer support-secret for non-browser tooling');
  assert.match(src, /getRequestSecret\(req\) !== expectedSecret/,
    'cancel-account-deletion must reject requests with the wrong secret');
  assert.match(src, /status:\s*401/,
    'cancel-account-deletion must return unauthorized for invalid support secret');
  assert.match(src, /user_id[\s\S]*UUID_RE/,
    'cancel-account-deletion must validate user_id shape');
});

test('phase 0.6D-pre 4B-2a cancel-account-deletion uses service role and lifts ban', async () => {
  const src = await fs.readFile(cancelAccountDeletionPath, 'utf8');

  assert.match(src, /serviceClient\(\)/,
    'cancel-account-deletion must use the service client');
  assert.match(src, /auth\.admin\.updateUserById\([\s\S]*ban_duration:\s*"none"/,
    'cancel-account-deletion must lift the Supabase ban');
  assert.doesNotMatch(src, /requireUser|auth\.getUser/,
    'support-assisted cancel must not require the deletion-requested user JWT');
});

test('phase 0.6D-pre 4B-2a cancel-account-deletion clears deletion fields and is idempotent', async () => {
  const src = await fs.readFile(cancelAccountDeletionPath, 'utf8');

  assert.match(src, /\.select\("id, deletion_status, deleted_at, purge_after"\)/,
    'cancel-account-deletion must read the profile deletion fields');
  assert.match(src, /profile\.deletion_status !== "requested"[\s\S]*already_canceled:\s*true/,
    'cancel-account-deletion must be idempotent when the profile is already not requested');
  assert.match(src, /deletion_status:\s*"canceled"/,
    'cancel-account-deletion must set deletion_status to canceled');
  assert.match(src, /deleted_at:\s*null/,
    'cancel-account-deletion must clear deleted_at');
  assert.match(src, /purge_after:\s*null/,
    'cancel-account-deletion must clear purge_after');
});

test('phase 0.6D-pre 4B-2a cancel-account-deletion idempotent branch repairs ban lift', async () => {
  const src = await fs.readFile(cancelAccountDeletionPath, 'utf8');
  const helperStart = src.indexOf('async function liftAccountBan(');
  const helperEnd = src.indexOf('Deno.serve', helperStart);
  const helper = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';
  const branchStart = src.indexOf('if (profile.deletion_status !== "requested")');
  const branchEnd = src.indexOf('const { error: updateErr }', branchStart);
  const branch = branchStart >= 0 && branchEnd > branchStart ? src.slice(branchStart, branchEnd) : '';

  assert.ok(helper, 'liftAccountBan helper must be extractable');
  assert.ok(branch, 'already-canceled branch must be extractable');
  assert.match(helper, /auth\.admin\.updateUserById\([\s\S]*ban_duration:\s*"none"/,
    'liftAccountBan must call auth.admin.updateUserById with ban_duration none');
  assert.match(branch, /await liftAccountBan\(sb, userId\)/,
    'already-canceled branch must retry ban lift before returning idempotent success');
  assert.match(branch, /banLiftErr[\s\S]*status:\s*500/,
    'already-canceled branch must fail safely if ban lift repair fails');
  assert.match(branch, /already_canceled:\s*true/,
    'already-canceled branch must still return idempotent success after ban lift succeeds');
});

test('phase 0.6D-pre 4B-2a cancel-account-deletion avoids forbidden scope', async () => {
  const src = await fs.readFile(cancelAccountDeletionPath, 'utf8');

  assert.doesNotMatch(src, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'cancel-account-deletion must not touch Stripe or billing');
  assert.doesNotMatch(src, /organization_members|organizations|organization_invites|org-member|org-invite|archive|restore|transfer|leave/i,
    'cancel-account-deletion must not touch workspace lifecycle, member, or invite data');
  assert.doesNotMatch(src, /packs|cases|storage\.from|signOut|location\.reload|window\.location|router\./i,
    'cancel-account-deletion must not touch packs, cases, storage, frontend signout/reload, or router flows');
});

test('phase 0.6D-pre 4B-2a cancel-account-deletion has verify_jwt disabled in config', async () => {
  const src = await fs.readFile(supabaseConfigPath, 'utf8');
  const start = src.indexOf('[functions.cancel-account-deletion]');
  const end = src.indexOf('[functions.', start + 1);
  const block = start >= 0
    ? src.slice(start, end > start ? end : undefined)
    : '';

  assert.ok(block, 'supabase config must include cancel-account-deletion function block');
  assert.match(block, /verify_jwt\s*=\s*false/,
    'cancel-account-deletion must disable platform JWT verification and rely on support secret');
});

test('phase 0.6D-pre 4B-2a account deletion functions use no wildcard CORS', async () => {
  for (const endpointPath of [
    requestAccountDeletionPath,
    cancelAccountDeletionPath,
    deleteAccountPath,
    banUserPath,
    unbanUserPath,
  ]) {
    const src = await fs.readFile(endpointPath, 'utf8');
    assert.doesNotMatch(src, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
      `${endpointPath.pathname} must not contain literal wildcard CORS`);
  }

  const cancelSrc = await fs.readFile(cancelAccountDeletionPath, 'utf8');
  assert.match(cancelSrc, /allowedOrigin === "\*" \? null : allowedOrigin/,
    'cancel-account-deletion must normalize non-browser wildcard helper origin to null responses');
});

test('logout actions use canonical helper and avoid timed reload after signOut', async () => {
  const source = await readAppSource();
  assert.match(source, /async function performUserInitiatedLogout\(/);
  assert.match(source, /performUserInitiatedLogout\(\{ source: 'trial-expired-modal' \}\)/);
  assert.match(source, /performUserInitiatedLogout\(\{ source: 'trial-welcome' \}\)/);
  const start = source.indexOf('let logoutActionPromise = null;');
  const end = source.indexOf('// Show small toasts on connectivity changes', start);
  const logoutBlock = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(logoutBlock, 'logout implementation block must be extractable');
  assert.doesNotMatch(logoutBlock, /logoutFallbackTimer|LOGOUT_FALLBACK_RELOAD_DELAY_MS|scheduleLogoutFallbackReload/,
    'logout must not retain its timer fallback state or helper');
  assert.doesNotMatch(logoutBlock, /setTimeout\(|location\.reload\(/,
    'logout must not schedule or trigger a page reload');
});

test('auth proof fast-path gates prevent repeated cross-tab timeout calls', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');
  const app = await readAppSource();

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

test('phase 1 P0 cross-profile logout: visible signed-in tabs actively validate server auth', async () => {
  const app = await readAppSource();

  assert.match(app, /const AUTH_REVOCATION_VISIBLE_CHECK_INTERVAL_MS = 5000/,
    'visible auth revocation check must use the approved short release-gate interval');
  assert.match(app, /function requestVisibleAuthRevocationCheck\(reason = 'interval'\)/,
    'app must define an active auth revocation check independent of billing-status');
  assert.match(app, /function isVisibleAuthRevocationCheckSignedIn\(\)[\s\S]*status === 'signed_in'[\s\S]*session[\s\S]*user[\s\S]*user\.id/,
    'visible auth check must run only while the app believes a user is signed in');
  assert.match(app, /SupabaseClient\.validateSessionRevocation\(\{ source: `app-visible:\$\{reason\}` \}\)/,
    'visible auth check must use the server-backed Supabase auth validation helper');
  assert.match(app, /window\.setInterval\(\(\) => \{[\s\S]*requestVisibleAuthRevocationCheck\('interval'\)[\s\S]*AUTH_REVOCATION_VISIBLE_CHECK_INTERVAL_MS/,
    'visible signed-in validation must not depend on billing refresh firing');
  assert.match(app, /window\.addEventListener\('focus'[\s\S]*requestVisibleAuthRevocationCheck\('window-focus'\)/,
    'visible auth validation must also run on focus');
  assert.match(app, /document\.addEventListener\('visibilitychange'[\s\S]*requestVisibleAuthRevocationCheck\('tab-visible'\)/,
    'visible auth validation must also run when a tab becomes visible');
  assert.match(app, /startVisibleAuthRevocationCheck\(\)/,
    'signed-in auth flow must start the visible auth validation loop');
  assert.match(app, /stopVisibleAuthRevocationCheck\(\)/,
    'signed-out cleanup must stop the visible auth validation loop');
  assert.match(app, /const shouldClearSignedOutOrgHint = Boolean\(userInitiatedSignOut \|\| treatAsSignedOut \|\| AuthService\.getAuthBlockState\(\)\)[\s\S]{0,180}clearLocalOrgHint: shouldClearSignedOutOrgHint/,
    'confirmed signed-out cleanup must clear stale active org hints');
});

test('RECON Truck Change stages identity poses with preview/commit, mode, profile, and repeat parity', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Controller = await import(`${truckChangeControllerPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = {
    id: 'beam', name: 'Beam', dimensions: { length: 30, width: 20, height: 10 },
    orientationLock: 'any', weight: 10,
  };
  const identity = { x: 0, y: 0, z: 0 };
  const rotatedY = { x: 0, y: Math.PI / 2, z: 0 };
  const rolledX = { x: Math.PI / 2, y: 0, z: 0 };
  const make = (id, x, rotation, orientedDims, extra = {}) => ({
    id, caseId: 'beam', placement: 'packed', hidden: false,
    transform: { position: { x, y: orientedDims.height / 2, z: 0 }, rotation, scale: { x: 1, y: 1, z: 1 } },
    orientedDims,
    ...extra,
  });
  const survivor = make('survivor', 30, rotatedY, { length: 20, width: 30, height: 10 },
    { packedProfile: 'max-capacity' });
  const invalidYaw = make('invalid-yaw', 190, rotatedY, { length: 20, width: 30, height: 10 },
    { packedProfile: 'max-capacity', orientationLocked: true, lockedRotation: rotatedY });
  const invalidRoll = make('invalid-roll', 220, rolledX, { length: 30, width: 10, height: 20 });
  const existingStaged = {
    ...make('existing-stage', 20, identity, caseData.dimensions),
    placement: 'staged',
    transform: { position: { x: 20, y: 5, z: 130 }, rotation: identity, scale: { x: 1, y: 1, z: 1 } },
  };
  const pack = { id: 'truck-stage', truck: RECON_RECT, cases: [survivor, invalidYaw, invalidRoll, existingStaged] };
  const nextTruck = { ...RECON_RECT, length: 120 };
  const sourceSnapshot = JSON.stringify(pack);

  const runPreview = () => {
    const harness = makeTruckChangeHarness();
    const previews = [];
    const commits = [];
    const controller = Controller.createTruckChangeController({
      PackLibrary: { ...PackLib, update: (id, patch) => { commits.push({ id, patch }); return { id, ...patch }; } },
      CaseLibrary: { getCases: () => [caseData] },
      UIComponents: harness.UIComponents,
      documentRef: harness.documentRef,
    });
    assert.equal(controller.request({ pack, nextTruck, renderPreview: preview => previews.push(preview) }).status, 'preview');
    return { harness, previews, commits };
  };

  const cancelled = runPreview();
  const cancelledPose = JSON.stringify(cancelled.previews[0].pack.cases);
  cancelled.harness.click(0, 'Cancel');
  assert.equal(JSON.stringify(pack), sourceSnapshot, 'Cancel leaves every original packed transform unchanged');

  const applied = runPreview();
  assert.equal(JSON.stringify(applied.previews[0].pack.cases), cancelledPose,
    'repeated identical Truck Change previews produce byte-equivalent poses');
  const previewCases = applied.previews[0].pack.cases;
  const stagedPreview = previewCases.filter(inst => ['invalid-yaw', 'invalid-roll'].includes(inst.id));
  for (const inst of stagedPreview) {
    assert.equal(inst.placement, 'staged', `${inst.id} is shown in staging`);
    assert.deepEqual(inst.transform.rotation, identity, `${inst.id} drops its previous packed rotation`);
    assert.deepEqual(inst.orientedDims, caseData.dimensions, `${inst.id} dimensions match identity rotation`);
    assert.equal(inst.transform.position.y, caseData.dimensions.height / 2, `${inst.id} rests on staging ground`);
    assert.equal(Object.prototype.hasOwnProperty.call(inst, 'packedProfile'), false, `${inst.id} loses packedProfile`);
  }
  assert.deepEqual(previewCases.find(inst => inst.id === 'survivor'), survivor,
    'valid packed survivor remains byte-equivalent, including Max Capacity profile');
  assert.deepEqual(previewCases.find(inst => inst.id === 'existing-stage'), existingStaged,
    'safe existing deterministic staging remains unchanged');
  assert.deepEqual(previewCases.find(inst => inst.id === 'invalid-yaw').lockedRotation, rotatedY,
    'staging changes actual pose without rewriting the exact planning target');
  assertCanonicalReconLayoutSafe(PackLib, previewCases, nextTruck, [caseData], 'Truck Change identity preview');

  applied.harness.click(0, 'Move to staging');
  assert.equal(applied.commits.length, 1);
  assert.deepEqual(applied.commits[0].patch.cases, previewCases,
    'Move-to-staging commit is byte-equivalent to its preview pose');
  assert.equal(JSON.stringify(pack), sourceSnapshot, 'controller keeps its caller snapshot pure');

  const transitions = [
    [RECON_RECT, RECON_WW],
    [RECON_WW, RECON_RECT],
    [RECON_RECT, reconFB()],
    [reconFB(), RECON_WW],
    [RECON_WW, reconFB()],
  ];
  for (const [sourceTruck, targetTruck] of transitions) {
    const direct = PackLib.stagePlacementIds(
      { id: 'mode-parity', truck: sourceTruck, cases: [invalidYaw, invalidRoll] },
      ['invalid-yaw', 'invalid-roll'], targetTruck, [caseData], { grouped: true }
    );
    assert.deepEqual(direct.failedIds, []);
    for (const inst of direct.pack.cases) {
      assert.deepEqual(inst.transform.rotation, identity, `${sourceTruck.shapeMode}→${targetTruck.shapeMode}: identity rotation`);
      assert.deepEqual(inst.orientedDims, caseData.dimensions, `${sourceTruck.shapeMode}→${targetTruck.shapeMode}: identity dimensions`);
      assert.equal(inst.transform.position.y, 5, `${sourceTruck.shapeMode}→${targetTruck.shapeMode}: grounded`);
    }
    assertCanonicalReconLayoutSafe(PackLib, direct.pack.cases, targetTruck, [caseData],
      `${sourceTruck.shapeMode}→${targetTruck.shapeMode} staging`);
  }

  const unresolved = {
    id: 'missing', caseId: 'missing-case', placement: 'packed', packedProfile: 'max-capacity',
    transform: { position: { x: 200, y: 7, z: 0 }, rotation: rolledX, scale: { x: 1, y: 1, z: 1 } },
    customMetadata: { keep: true },
  };
  const unresolvedResult = PackLib.stagePlacementIds(
    { id: 'unresolved', truck: RECON_RECT, cases: [unresolved] }, ['missing'], nextTruck, [caseData]
  );
  assert.deepEqual(unresolvedResult.failedIds, ['missing']);
  assert.deepEqual(unresolvedResult.pack.cases[0], unresolved,
    'unresolved packed references keep safe metadata and receive no fabricated staging geometry');
});

test('phase 1 P0 cross-profile logout: server auth validation only clears on confirmed revocation', async () => {
  const sc = await fs.readFile(supabasePath, 'utf8');
  const fnStart = sc.indexOf('export async function validateSessionRevocation');
  const fnEnd = sc.indexOf('\nfunction forceLocalSignedOut', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart, 'validateSessionRevocation helper must exist before forceLocalSignedOut');
  const fn = sc.slice(fnStart, fnEnd);

  assert.match(fn, /const authGetUser = _authGetUser \|\| \(client\.auth && client\.auth\.__tp3dOriginalGetUser\) \|\| null/,
    'validation helper must call the original server-backed auth getUser path');
  assert.doesNotMatch(fn, /isAuthProven\(\)|getUserRawSingleFlight|getSessionSingleFlightSafe/,
    'validation helper must not use local auth proof, local getSession, or cached getUser fast paths');
  assert.match(fn, /msg\.includes\('timeout'\) \|\| isNetworkFetchError\(err\)[\s\S]*return \{ ok: true, skipped: true, reason: msg\.includes\('timeout'\) \? 'timeout' : 'network' \}/,
    'timeout and network failures must not force local sign-out');
  assert.match(fn, /if \(isAuthRevokedError\(err\)\) \{[\s\S]*forceLocalSignedOut\(\{ reason: `auth-revoked:\$\{source\}`, status \}\)/,
    'local sign-out must be guarded by the existing auth-revoked classifier');
  assert.match(fn, /return \{ ok: true, skipped: true, reason: 'error' \}/,
    'unknown validation errors must not force local sign-out');
  assert.doesNotMatch(fn, /status\s*[<>]=?\s*4|status\s*!==\s*null|status\s*[<>]=?\s*5|403|408|409/,
    'validation helper must not use broad status, org-access, timeout, or conflict status patterns');
  assert.doesNotMatch(fn, /location\.reload|setTimeout[\s\S]*location\.reload/,
    'validation helper must not introduce reload or timed reload behavior');
  assert.doesNotMatch(fn, /access_token|refresh_token|Bearer|JWT|\.token/i,
    'validation helper must not log or reference token-sensitive values');
});

test('auth overlay render() preserves input values before innerHTML clear', async () => {
  const src = await fs.readFile(authOverlayPath, 'utf8');

  // Same-view values are captured by stable field identity, including revealed
  // passwords and confirmation fields. Native DOM behavior is covered in the
  // isolated auth-overlay-lifecycle browser suite.
  const renderFn = src.substring(
    src.indexOf('function render('),
    src.indexOf('// ---- Brand header ----')
  );
  const captureFn = src.substring(src.indexOf('function captureFields('), src.indexOf('function focusTarget('));
  for (const key of ['email', 'password', 'password-confirm']) {
    assert.ok(captureFn.includes(`data-auth-focus="${key}"`),
      `captureFields must preserve ${key} by stable identity`);
  }
  // The save must occur BEFORE innerHTML = ''
  const saveIdx = renderFn.indexOf('if (sameView) captureFields()');
  const clearIdx = renderFn.indexOf('innerHTML');
  assert.ok(saveIdx >= 0 && clearIdx > saveIdx,
    'input value save must come before innerHTML clear');
});

test('auth overlay show() does not re-render when already open', async () => {
  const src = await fs.readFile(authOverlayPath, 'utf8');

  const showFn = src.substring(
    src.indexOf('function show()'),
    src.indexOf('function hide()')
  );
  // If isOpen, should return early without calling render
  assert.ok(showFn.includes('if (!overlayEl || isOpen) return'),
    'show() must return early when already open');
  // Should NOT have the old pattern: if (isOpen) { render(); return; }
  assert.ok(!showFn.includes('if (isOpen) { render'),
    'show() must NOT call render() when already open');
});

test('auth overlay setPhase skips re-render when form is already showing same phase', async () => {
  const src = await fs.readFile(authOverlayPath, 'utf8');

  const setPhaseFn = src.substring(
    src.indexOf('function setPhase('),
    src.indexOf('function navigateTo(')
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

test('authGate settled is set true on signedIn, signedOutConfirmed, and bootstrap-no-session', async () => {
  const app = await readAppSource();

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
  // Guard: only set when no pending timer — the guard now lives in the semantic
  // AuthService.markSignedOutSettledIfIdle method that the bootstrap paths delegate to.
  assert.ok(bootstrapBlock.includes('markSignedOutSettledIfIdle'),
    'bootstrap settled must delegate to AuthService.markSignedOutSettledIfIdle');
  assert.match(app, /function markSignedOutSettledIfIdle\(source\) \{\s*if \(!_authGate\.settled && !_authGate\.signedOutTimer\)/,
    'markSignedOutSettledIfIdle must set settled only when idle (no pending signedOutTimer)');
});

test('auth settled is never set false after initialization', async () => {
  const app = await readAppSource();

  // Only one place should have settled: false (the initial declaration)
  const settledFalseCount = (app.match(/_authGate\.settled\s*=\s*false|settled:\s*false/g) || []).length;
  assert.equal(settledFalseCount, 1,
    `settled should only be false in the initial declaration, found ${settledFalseCount} sites`);
});

test('phase 3C2 bootstrapAuthGate resets overlay phase to form before hiding on successful sign-in', async () => {
  const src = await readAppSource();
  const start = src.indexOf('bootstrapAuthGate = async');
  const end = src.indexOf('\n      };', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'bootstrapAuthGate block must be extractable');

  // The successful signed-in path must call setPhase('form') before hide()
  const hideIdx = block.indexOf('AuthOverlay.hide()');
  const setPhaseFIdx = block.lastIndexOf("AuthOverlay.setPhase('form'", hideIdx);
  assert.ok(hideIdx > 0, 'bootstrapAuthGate must call AuthOverlay.hide()');
  assert.ok(setPhaseFIdx >= 0 && setPhaseFIdx < hideIdx,
    "bootstrapAuthGate must call AuthOverlay.setPhase('form') before AuthOverlay.hide() on signed-in path");

  // The setPhase('form') call must include the retry handler
  const phaseCallText = block.slice(setPhaseFIdx, setPhaseFIdx + 80);
  assert.match(phaseCallText, /bootstrapAuthGate/,
    "bootstrapAuthGate setPhase('form') before hide must include onRetry: bootstrapAuthGate");
});

test('phase 3C2 authGateSignedOutCandidate fallback guard requires _wrapperSignedIn to block cleanup', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function authGateSignedOutCandidate(');
  const end = src.indexOf('\n  function ', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'authGateSignedOutCandidate must be extractable');

  // The fallback guard must include _wrapperSignedIn so it does not block
  // cleanup when the session is already gone (cross-tab sign-out)
  assert.match(block, /_hasRecentSignedIn && !_logoutLatchActive && _wrapperSignedIn/,
    'authGateSignedOutCandidate fallback guard must include _wrapperSignedIn to avoid blocking cross-tab sign-out cleanup');

  // Guard must NOT drop the _wrapperSignedIn requirement (no regression to old form)
  assert.doesNotMatch(block, /_hasRecentSignedIn && !_logoutLatchActive(?!\s*&&\s*_wrapperSignedIn)/,
    'authGateSignedOutCandidate must not use the old guard form without _wrapperSignedIn');
});

test('phase 3C2 signed-out cleanup calls setPhase form and show on non-user-initiated sign-out', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function _executeSignedOutCleanup(');
  const end = src.indexOf('function sanitizeInviteHandoffMessage(', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, '_executeSignedOutCleanup must be extractable');

  // treatAsSignedOut branch must call setPhase('form') — not 'checking'
  assert.match(block, /AuthOverlay\.setPhase\('form'/,
    '_executeSignedOutCleanup must call setPhase("form") for signed-out events');

  // Must call show() after setting phase
  const setPhaseFIdx = block.indexOf("AuthOverlay.setPhase('form'");
  const showIdx = block.indexOf('AuthOverlay.show()', setPhaseFIdx);
  assert.ok(showIdx > setPhaseFIdx,
    '_executeSignedOutCleanup must call AuthOverlay.show() after setPhase("form")');

  // The 'checking' phase path must NOT be the only one — form path must exist
  assert.doesNotMatch(block, /AuthOverlay\.setPhase\('form'[\s\S]*?AuthOverlay\.setPhase\('checking'\)/,
    '_executeSignedOutCleanup must not replace the form path with checking');
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

test('owner authority function runtime rejects member/admin promotion to owner before any database work', async () => {
  for (const targetRole of ['member', 'admin']) {
    const { response, calls } = await executeOrgMemberRoleUpdate({
      actorRole: 'owner',
      targetRole,
      nextRole: 'owner',
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'ownership_change_requires_transfer');
    assert.equal(calls.serviceClient, 0, `${targetRole} -> owner must reject before database access`);
    assert.equal(calls.updates.length, 0, `${targetRole} -> owner must not update a membership`);
  }
});

test('owner authority function runtime rejects owner demotion and canonical owner mutation', async () => {
  for (const nextRole of ['admin', 'member']) {
    const existingOwner = await executeOrgMemberRoleUpdate({
      actorRole: 'owner',
      targetRole: 'owner',
      nextRole,
    });
    assert.equal(existingOwner.response.status, 409);
    assert.equal(existingOwner.response.body.error, 'ownership_change_requires_transfer');
    assert.equal(existingOwner.calls.updates.length, 0, `owner -> ${nextRole} must not update`);
  }

  const canonicalOwner = await executeOrgMemberRoleUpdate({
    actorRole: 'owner',
    targetRole: 'member',
    nextRole: 'admin',
    canonicalOwnerId: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(canonicalOwner.response.status, 409);
  assert.equal(canonicalOwner.response.body.error, 'ownership_change_requires_transfer');
  assert.equal(canonicalOwner.calls.updates.length, 0,
    'canonical organizations.owner_id must not be changed even if its membership role is already inconsistent');
});

test('owner authority function runtime preserves owner-managed member/admin transitions and no-op', async () => {
  const promotion = await executeOrgMemberRoleUpdate({
    actorRole: 'owner',
    targetRole: 'member',
    nextRole: 'admin',
  });
  assert.equal(promotion.response.status, 200);
  assert.equal(promotion.response.body.member.role, 'admin');
  assert.equal(promotion.calls.updates.length, 1);
  assert.deepEqual(
    promotion.calls.updates[0].filters.map(([field, value]) => [field, String(value)]),
    [
      ['organization_id', promotion.organizationId],
      ['user_id', promotion.targetUserId],
      ['role', 'member'],
    ],
    'role update must be organization/user/current-role scoped against concurrent ownership changes',
  );

  const demotion = await executeOrgMemberRoleUpdate({
    actorRole: 'owner',
    targetRole: 'admin',
    nextRole: 'member',
  });
  assert.equal(demotion.response.status, 200);
  assert.equal(demotion.response.body.member.role, 'member');
  assert.equal(demotion.calls.updates.length, 1);

  const noOp = await executeOrgMemberRoleUpdate({
    actorRole: 'owner',
    targetRole: 'member',
    nextRole: 'member',
  });
  assert.equal(noOp.response.status, 200);
  assert.equal(noOp.response.body.ok, true);
  assert.equal(noOp.response.body.role, 'member');
  assert.equal(noOp.calls.updates.length, 0, 'same-role requests must not issue an update');
});

test('owner authority function runtime preserves admin/member authorization policy', async () => {
  const adminPromotes = await executeOrgMemberRoleUpdate({
    actorRole: 'admin',
    targetRole: 'member',
    nextRole: 'admin',
  });
  assert.equal(adminPromotes.response.status, 403);
  assert.equal(adminPromotes.calls.updates.length, 0);

  const adminEditsAdmin = await executeOrgMemberRoleUpdate({
    actorRole: 'admin',
    targetRole: 'admin',
    nextRole: 'member',
  });
  assert.equal(adminEditsAdmin.response.status, 403);
  assert.equal(adminEditsAdmin.calls.updates.length, 0);

  const memberActor = await executeOrgMemberRoleUpdate({
    actorRole: 'member',
    targetRole: 'member',
    nextRole: 'member',
  });
  assert.equal(memberActor.response.status, 403);
  assert.equal(memberActor.calls.updates.length, 0);
});

test('owner authority function runtime validates UUIDs and never reports null-update success', async () => {
  for (const invalidIds of [
    { payloadOrgId: 'not-a-uuid' },
    { payloadUserId: 'not-a-uuid' },
  ]) {
    const invalid = await executeOrgMemberRoleUpdate({ ...invalidIds, nextRole: 'member' });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.calls.serviceClient, 0, 'malformed IDs must reject before database access');
  }

  const missingTarget = await executeOrgMemberRoleUpdate({ targetMissing: true, nextRole: 'member' });
  assert.equal(missingTarget.response.status, 404);
  assert.equal(missingTarget.calls.updates.length, 0);

  const disappeared = await executeOrgMemberRoleUpdate({
    targetRole: 'member',
    nextRole: 'admin',
    updateReturnsNull: true,
  });
  assert.equal(disappeared.response.status, 409);
  assert.equal(disappeared.response.body.error, 'member_role_update_failed');
  assert.equal(disappeared.calls.updates.length, 1);
});

test('owner authority function runtime sanitizes membership organization and update failures', async () => {
  for (const failure of ['actor', 'target', 'organization', 'update']) {
    const result = await executeOrgMemberRoleUpdate({
      actorRole: 'owner',
      targetRole: 'member',
      nextRole: 'admin',
      failure,
    });
    assert.equal(result.response.status, 500, `${failure} failure must return 500`);
    assert.equal(result.response.body.error, 'member_role_update_failed');
    assert.doesNotMatch(JSON.stringify(result.response.body), /organization_members|organizations|relation|leaked detail/i,
      `${failure} failure must not expose database details`);
  }
});

test('owner authority source contract leaves transfer as the only ownership mutation path', async () => {
  const roleUpdate = await fs.readFile(orgMemberRoleUpdatePath, 'utf8');
  const transfer = await fs.readFile(orgTransferOwnershipPath, 'utf8');

  assert.match(roleUpdate, /const UUID_RE = \/\^\[0-9a-f\]/,
    'generic role endpoint must use established UUID validation');
  assert.match(roleUpdate, /nextRole === "owner"[\s\S]*OWNERSHIP_TRANSFER_REQUIRED[\s\S]*status: 409/,
    'owner promotion must use the structured transfer-required error');
  assert.match(roleUpdate, /targetRole === "owner"[\s\S]*OWNERSHIP_TRANSFER_REQUIRED[\s\S]*status: 409/,
    'existing owner memberships must be immutable through the generic endpoint');
  assert.match(roleUpdate, /\.from\("organizations"\)[\s\S]*\.select\("owner_id"\)[\s\S]*organization\.owner_id[\s\S]*targetUserId/,
    'canonical organizations.owner_id must be protected even when membership data is inconsistent');
  assert.match(roleUpdate, /\.eq\("role", targetRole\)[\s\S]*\.select\("id, organization_id, user_id, role, joined_at"\)/,
    'updates must fail closed if the current membership role changes concurrently');
  assert.doesNotMatch(roleUpdate, /ownerCount|Cannot demote the last owner/,
    'generic endpoint must not retain last-owner counting or its race');
  assert.doesNotMatch(roleUpdate, /tp3d_transfer_workspace_ownership|billing_customers|subscriptions|stripe/i,
    'generic endpoint must neither duplicate nor bypass transfer/billing responsibilities');
  assert.match(transfer, /resolveWorkspaceTransferBillingGuard\(sb, orgId\)[\s\S]*\.rpc\("tp3d_transfer_workspace_ownership"/,
    'dedicated transfer endpoint must retain its billing guard and canonical RPC');
});

test('owner authority UI source contract exposes only member/admin generic role changes', async () => {
  const settings = await fs.readFile(settingsOverlayPath, 'utf8');
  const roleControlsStart = settings.indexOf("if (isOwnerMember) {");
  const roleControlsEnd = settings.indexOf("const removeBtn = doc.createElement('button');", roleControlsStart);
  const roleControls = roleControlsStart >= 0 && roleControlsEnd > roleControlsStart
    ? settings.slice(roleControlsStart, roleControlsEnd)
    : '';

  assert.ok(roleControls, 'member role controls must be extractable');
  assert.match(roleControls, /ownershipHint\.textContent = 'Use Transfer Ownership'/,
    'owner rows must direct users to the dedicated transfer workflow');
  assert.match(roleControls, /const roles = \['admin', 'member'\]/,
    'generic role dropdown must expose only admin and member');
  assert.doesNotMatch(roleControls, /const roles = \[[^\]]*'owner'/,
    'owner must not remain a generic role option');
  assert.match(settings, /if \(isPrimaryOwner\)[\s\S]*Transfer Ownership[\s\S]*showTransferOwnershipModal/,
    'the existing primary-owner transfer workflow must remain available');
});

test('owner authority client production-helper runtime maps transfer-required code to clear copy', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');
  const start = src.indexOf('const OWNERSHIP_CHANGE_REQUIRES_TRANSFER_MESSAGE');
  const end = src.indexOf('const WORKSPACE_ACTIVE_BILLING_TRANSFER_MESSAGE', start);
  assert.ok(start >= 0 && end > start, 'production role-update error mapper must be extractable');

  const sandbox = {
    resolveFnError: (_res, data, fallback) => data?.error || fallback,
  };
  vm.runInNewContext(
    `${src.slice(start, end)}\nglobalThis.__resolveOrgMemberRoleUpdateError = resolveOrgMemberRoleUpdateError;`,
    sandbox,
  );
  const resolveRoleError = sandbox.__resolveOrgMemberRoleUpdateError;

  assert.equal(
    resolveRoleError({}, { error: 'ownership_change_requires_transfer' }),
    'Ownership changes must use Transfer Ownership.',
  );
  assert.equal(
    resolveRoleError({}, { error: 'Only owners/admins can update roles.' }),
    'Only owners/admins can update roles.',
    'non-ownership role errors must retain their existing behavior',
  );
});

test('phase 3C org-invite email copy explains invite auth handoff without hiding workspace details', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');
  const emailStart = src.indexOf('function buildInviteEmail');
  const emailEnd = src.indexOf('async function sendInviteEmail', emailStart);
  const emailFn = emailStart >= 0 && emailEnd > emailStart ? src.slice(emailStart, emailEnd) : '';

  assert.ok(emailFn.length > 0, 'buildInviteEmail must be found');
  assert.match(emailFn, /You’ve been invited to join a workspace in Truck Packer 3D\./,
    'invite email must explain the workspace invite context');
  assert.match(emailFn, /Sign in or create an account using the invited email address to accept this invite\./,
    'invite email must explain that auth must use the invited email address');
  assert.match(emailFn, /Workspace:[\s\S]*workspaceName|<strong>Workspace:<\/strong>[\s\S]*workspaceName/,
    'invite email must keep workspace name visible');
  assert.match(emailFn, /Role:[\s\S]*role|<strong>Role:<\/strong>[\s\S]*role/,
    'invite email must keep role visible');
  assert.match(emailFn, /Accept invite:[\s\S]*input\.inviteLink|<a href="\$\{escapeHtml\(input\.inviteLink\)\}"/,
    'invite email must keep both accept button/link path and text fallback');
  assert.doesNotMatch(emailFn, /console\.|apiKey|RESEND_API_KEY|Authorization|Bearer|access_token|refresh_token|JWT|service.?role|STRIPE_SECRET/i,
    'invite email copy builder must not log or reference secret-bearing values');
});

test('phase 3C1 renderInviteHandoffNotice guards auth overlay visibility before inserting notice', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function renderInviteHandoffNotice(');
  const end = src.indexOf('function setInviteHandoffNotice(', start);
  const fnBody = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fnBody.length > 0, 'renderInviteHandoffNotice function must be present in app.js');

  // Must derive the parent auth overlay from the authPage element
  assert.match(fnBody, /authPage\s*\?\s*authPage\.closest\(\s*'\[data-auth-overlay="1"\]'\s*\)/,
    'renderInviteHandoffNotice must resolve the parent auth overlay via .closest()');

  // Must check display:none (CSS visibility check)
  assert.match(fnBody, /getComputedStyle\(authOverlay\)\.display\s*!==\s*['"]none['"]/,
    'renderInviteHandoffNotice must check computed display before treating auth overlay as visible');

  // Must use getClientRects() for layout visibility (offsetWidth/offsetHeight are HTMLElement-only)
  assert.match(fnBody, /authOverlay\.getClientRects\(\)\.length/,
    'renderInviteHandoffNotice must use getClientRects() for layout-based visibility check');

  // Must produce a visibleAuthPage guard variable
  assert.match(fnBody, /visibleAuthPage\s*=/,
    'renderInviteHandoffNotice must derive a visibleAuthPage guard before rendering into the overlay');

  // Must return early when visibleAuthPage is falsy — do NOT insert into body
  assert.match(fnBody, /if\s*\(\s*!visibleAuthPage\s*\)\s*return/,
    'renderInviteHandoffNotice must return early when auth overlay is not visible');
  assert.doesNotMatch(fnBody, /document\.body\.appendChild/,
    'renderInviteHandoffNotice must not append to document.body (avoids z-index conflict with auth overlay)');
});

test('phase 3C1 renderInviteHandoffNotice does not create blocking banner or set z-index above auth overlay', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function renderInviteHandoffNotice(');
  const end = src.indexOf('function setInviteHandoffNotice(', start);
  const fnBody = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fnBody.length > 0, 'renderInviteHandoffNotice must be extractable');

  // Must not create a fixed-position floating banner (would sit above the auth overlay at z-index 99999)
  assert.doesNotMatch(fnBody, /position.*fixed|position:\s*['"]fixed['"]/,
    'renderInviteHandoffNotice must not apply fixed positioning');
  assert.doesNotMatch(fnBody, /zIndex\s*:|['"]zIndex['"]\s*:|\.style\.zIndex/,
    'renderInviteHandoffNotice must not assign z-index (avoids conflict with auth overlay stacking context)');
  assert.doesNotMatch(fnBody, /document\.body\.appendChild/,
    'renderInviteHandoffNotice must not append to document.body');

  // Must not alter auth gate, session, or billing state
  assert.doesNotMatch(fnBody, /authGate|bootstrapAuthGate|requestAuthRefresh|refreshBilling|clearBillingState/,
    'renderInviteHandoffNotice must not touch auth gate or billing state');
});

test('app access-loss handler verifies auth and active org, rate-limits, dispatches event, and refreshes org context', async () => {
  const src = await readAppSource();

  assert.match(src, /let _orgAccessLossHandler = null/,
    'module-level handler slot must exist for refreshBilling');
  assert.match(src, /const _orgAccessLossLastAt = new Map\(\)/,
    'access-loss handling must rate-limit per org');
  assert.match(src, /const ORG_ACCESS_LOSS_COOLDOWN_MS = 30000/,
    'access-loss rate limit must be bounded');
  assert.match(src, /function handleOrgAccessLoss\(orgId, meta = \{\}\)[\s\S]*if \(!truth \|\| !truth\.isSignedIn \|\| !truth\.userId\) return false/,
    'handler must require signed-in auth truth');
  assert.match(src, /const activeOrgId = OrganizationService\.getActiveOrgIdNow\(\)[\s\S]*if \(!activeOrgId \|\| activeOrgId !== lostOrgId\) return false/,
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

test('phase 0.6A app exposes handleWorkspaceLeft and refreshes org context without logout or reload', async () => {
  const src = await readAppSource();
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

test('phase 0.6B org-invite-revoke edge function exists and requires authenticated POST with invite_id', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');

  assert.ok(src.length > 0, 'org-invite-revoke/index.ts must exist');
  assert.match(src, /if \(req\.method !== "POST"\)/,
    'invite revoke must require POST');
  assert.match(src, /requireUser\(req\)/,
    'invite revoke must require an authenticated user');
  assert.match(src, /if \(!auth\.ok \|\| !auth\.user\)/,
    'invite revoke must reject unauthenticated requests');
  assert.match(src, /const inviteId = String\(body\.invite_id \|\| body\.id \|\| ""\)\.trim\(\)/,
    'invite revoke must validate invite_id input');
  assert.match(src, /Missing invite_id/,
    'invite revoke must return a clear missing invite_id error');
});

test('phase 0.6D-pre Supabase client rejects direct account deletion state updates', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function updateProfile(updates)');
  const end = src.indexOf('export async function getUserOrganizations()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'updateProfile must be extractable');
  assert.match(fn, /const blockedDeletionFields = \['deletion_status', 'deleted_at', 'purge_after'\]/,
    'updateProfile must list account deletion state fields as blocked');
  assert.match(fn, /blockedDeletionFields\.some\(field => Object\.prototype\.hasOwnProperty\.call\(updates \|\| \{\}, field\)\)[\s\S]*Direct account deletion state updates are disabled\. Use the account deletion flow\./,
    'updateProfile must reject direct account deletion state updates');
});

test('release-gate profiles deletion fields are protected server-side by a BEFORE UPDATE trigger', async () => {
  const sql = await fs.readFile(guardProfileDeletionFieldsMigrationPath, 'utf8');

  assert.match(sql, /create or replace function public\.tp3d_guard_profile_deletion_fields\(\)/,
    'migration must define the deletion-field guard trigger function');
  assert.match(sql, /before update on public\.profiles\s+for each row execute function public\.tp3d_guard_profile_deletion_fields\(\)/,
    'migration must attach the guard as a BEFORE UPDATE row trigger on public.profiles');
  // The guard must inspect all three protected lifecycle fields with a
  // NULL-safe comparison (these columns are nullable).
  for (const field of ['deletion_status', 'deleted_at', 'purge_after']) {
    assert.match(sql, new RegExp(`new\\.${field} is not distinct from old\\.${field}`),
      `guard must NULL-safely detect changes to ${field}`);
  }
  assert.doesNotMatch(sql, /new\.(deletion_status|deleted_at|purge_after)\s*=\s*old\./,
    'guard must not use plain = for nullable columns (= is not NULL-safe)');
  assert.match(sql, /raise exception[\s\S]*using errcode = '42501'/,
    'guard must reject blocked writes with insufficient_privilege (42501)');
  // Idempotent / replayable.
  assert.match(sql, /create or replace function public\.tp3d_guard_profile_deletion_fields/,
    'function must be create-or-replace for safe replay');
  assert.match(sql, /drop trigger if exists tp3d_profiles_guard_deletion_fields on public\.profiles/,
    'trigger must be dropped-if-exists for safe replay');
});

test('release-gate profiles deletion guard fast-path allows an update only when ALL three fields are unchanged', async () => {
  const sql = await fs.readFile(guardProfileDeletionFieldsMigrationPath, 'utf8');

  // The unchanged fast-path must AND all three comparisons together so that a
  // change to ANY one (or several at once) falls through to the role gate.
  assert.match(
    sql,
    /if new\.deletion_status is not distinct from old\.deletion_status\s*\n\s*and new\.deleted_at is not distinct from old\.deleted_at\s*\n\s*and new\.purge_after is not distinct from old\.purge_after then\s*\n\s*return new;/,
    'guard fast-path must require every protected field to be unchanged (AND), so a single- or multi-field change is gated');
});

test('release-gate profiles deletion guard only trusts service-role JWT and privileged DB roles', async () => {
  const sql = await fs.readFile(guardProfileDeletionFieldsMigrationPath, 'utf8');
  const fnStart = sql.indexOf('create or replace function public.tp3d_guard_profile_deletion_fields()');
  const fnEnd = sql.indexOf('drop trigger if exists', fnStart);
  const fn = fnStart >= 0 && fnEnd > fnStart ? sql.slice(fnStart, fnEnd) : '';

  assert.ok(fn, 'guard function body must be extractable');
  // Trust comes ONLY from the verified PostgREST JWT role claim (service_role)
  // or a privileged database role — both unreachable from a browser user JWT.
  assert.match(fn, /claim_role = 'service_role'/,
    'guard must allow PostgREST service_role JWT writes (Edge Functions)');
  assert.match(fn, /current_user in \('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin'\)/,
    'guard must allow privileged database roles for migrations/admin');
  // Role is read from the verified request claims, not client-controlled data.
  assert.match(fn, /nullif\(current_setting\('request\.jwt\.claims', true\), ''\)::jsonb ->> 'role'/,
    'guard must read the role from the verified PostgREST JWT claims');
  // current_user (real role after SET ROLE), never session_user (always the
  // authenticator login role and therefore identical for user and service calls).
  assert.match(fn, /current_user in \(/,
    'guard must inspect current_user (the effective role)');
  assert.doesNotMatch(fn, /session_user/,
    'guard must not key off session_user (it stays authenticator for both user and service calls)');
});

test('release-gate profiles deletion guard has no owner/admin/member or client-claim bypass', async () => {
  const sql = await fs.readFile(guardProfileDeletionFieldsMigrationPath, 'utf8');
  // Strip SQL line comments so explanatory prose (which mentions admin tasks and
  // current_organization_id) cannot mask a real bypass in the executable code.
  const code = sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');

  // Authorization must never depend on a workspace role literal. The privileged
  // DB roles supabase_admin / supabase_auth_admin are not workspace roles and do
  // not match these quoted literals.
  assert.doesNotMatch(code, /'owner'|'admin'|'member'/i,
    'guard must not grant a workspace owner/admin/member browser bypass');
  assert.doesNotMatch(code, /organization|org_member|workspace|is_owner/i,
    'guard must not consult organization/workspace state for authorization');
  assert.doesNotMatch(code, /user_metadata|raw_user_meta_data|app_metadata/i,
    'guard must not trust user/app metadata for authorization');
  assert.doesNotMatch(code, /auth\.uid\(\)|\bemail\b/i,
    'guard must not authorize based on the caller account id or email');
});

test('release-gate profiles deletion guard runs as SECURITY INVOKER with a locked search_path', async () => {
  const sql = await fs.readFile(guardProfileDeletionFieldsMigrationPath, 'utf8');
  const fnStart = sql.indexOf('create or replace function public.tp3d_guard_profile_deletion_fields()');
  const fnEnd = sql.indexOf('as $$', fnStart);
  const header = fnStart >= 0 && fnEnd > fnStart ? sql.slice(fnStart, fnEnd) : '';

  assert.ok(header, 'guard function header must be extractable');
  // SECURITY INVOKER (default): current_user must reflect the real caller, so
  // the function must NOT be SECURITY DEFINER (that would make current_user the
  // function owner and defeat the role check).
  assert.doesNotMatch(header, /security\s+definer/i,
    'guard must run as SECURITY INVOKER so current_user reflects the real caller');
  // Locked search_path closes any name-resolution redirection.
  assert.match(header, /set search_path = ''/,
    'guard function must lock search_path to prevent name-resolution attacks');
});

test('release-gate profiles deletion guard function is not exposed for direct/RPC execution', async () => {
  const sql = await fs.readFile(guardProfileDeletionFieldsMigrationPath, 'utf8');

  assert.match(sql, /revoke execute on function public\.tp3d_guard_profile_deletion_fields\(\) from public;/,
    'EXECUTE on the guard function must be revoked from PUBLIC');
  assert.match(sql, /revoke execute on function public\.tp3d_guard_profile_deletion_fields\(\) from anon/,
    'EXECUTE must be revoked from anon when the role exists');
  assert.match(sql, /revoke execute on function public\.tp3d_guard_profile_deletion_fields\(\) from authenticated/,
    'EXECUTE must be revoked from authenticated when the role exists');
  // The conditional revokes must be guarded by role existence so replay stays
  // safe in environments without the Supabase anon/authenticated roles.
  assert.match(sql, /if exists \(select 1 from pg_roles where rolname = 'anon'\)/,
    'anon revoke must be guarded by role existence for safe replay');
  assert.match(sql, /if exists \(select 1 from pg_roles where rolname = 'authenticated'\)/,
    'authenticated revoke must be guarded by role existence for safe replay');
});

test('release-gate account-deletion Edge Functions write the protected fields only via the service client', async () => {
  const [requestSrc, cancelSrc, purgeSrc] = await Promise.all([
    fs.readFile(requestAccountDeletionPath, 'utf8'),
    fs.readFile(cancelAccountDeletionPath, 'utf8'),
    fs.readFile(purgeDeletedAccountsPath, 'utf8'),
  ]);

  for (const [name, src] of [
    ['request-account-deletion', requestSrc],
    ['cancel-account-deletion', cancelSrc],
    ['purge-deleted-accounts', purgeSrc],
  ]) {
    assert.match(src, /serviceClient\(\)/,
      `${name} must obtain a service-role client so the DB guard permits its deletion-field writes`);
  }
  // The legitimate writers must actually touch the protected fields (otherwise
  // this test would silently pass against a refactor that moved the writes).
  assert.match(requestSrc, /deletion_status:\s*"requested"/,
    'request-account-deletion must set deletion_status via the service client');
  assert.match(cancelSrc, /deletion_status:\s*"canceled"/,
    'cancel-account-deletion must set deletion_status via the service client');
  assert.match(purgeSrc, /deletion_status:\s*"purged"/,
    'purge-deleted-accounts must set deletion_status via the service client');
});

test('phase 0.6C app exposes handleWorkspaceArchived and refreshes org context without logout or reload', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function handleWorkspaceArchived(archivedOrgId, options = {})');
  const end = src.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(helper, 'app must define handleWorkspaceArchived');
  assert.match(src, /window\.TruckPackerApp\.handleWorkspaceArchived = handleWorkspaceArchived/,
    'app must expose handleWorkspaceArchived');
  const publicApiStart = src.indexOf('return {\n      init,');
  const publicApiEnd = src.indexOf('};\n  })();', publicApiStart);
  const publicApi = publicApiStart >= 0 && publicApiEnd > publicApiStart
    ? src.slice(publicApiStart, publicApiEnd)
    : '';
  assert.match(publicApi, /handleWorkspaceArchived,/,
    'handleWorkspaceArchived must be exposed on the actual returned TruckPackerApp public API');
  assert.match(helper, /normalizeOrgIdForBilling\(archivedOrgId \|\| ''\)/,
    'handleWorkspaceArchived must normalize archived org id');
  assert.match(helper, /clearBillingPendingRetry\(normalizedArchivedOrgId\)/,
    'handleWorkspaceArchived must clear pending retry for archived org');
  assert.match(helper, /if \(billingOrgId === normalizedArchivedOrgId\) \{[\s\S]*clearBillingState\(\)/,
    'handleWorkspaceArchived must clear stale billing only when scoped to archived org');
  assert.match(helper, /SupabaseClient\.invalidateAccountCache\(\)/,
    'handleWorkspaceArchived must invalidate stale account bundle cache');
  assert.match(helper, /refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'handleWorkspaceArchived must force existing org context refresh');
  assert.doesNotMatch(helper, /signOut|forceLocalSignedOut|location\.reload|window\.location|billing-status|stripe|checkout|portal/i,
    'handleWorkspaceArchived must not sign out, reload, call billing-status, or touch Stripe');
});

test('phase 0.6C-2 account bundle treats fresh empty active org list as authoritative', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /getUserOrganizationsAuthoritative\(\)\.catch\(\(\) => null\)/,
    'org fetch must use the authoritative variant so a failed fetch is distinguishable from an empty list');
  assert.match(bundleFn, /ACCOUNT_FETCH_TIMEOUT_MS,\s*null\s*\)/,
    'org fetch timeout fallback must be null, not an empty array that looks successful');
  assert.doesNotMatch(bundleFn, /orgsResult\.length === 0/,
    'account bundle must not treat an authoritative empty org list as a cache miss');
  assert.match(bundleFn, /const orgsFetchUncertain = Boolean\(orgsWrap\.timedOut \|\| !orgsFetchAuthoritative\)/,
    'timeout or non-authoritative org results must be treated as uncertain');
  assert.match(bundleFn, /if \(orgsFetchUncertain && cachedOrgs\.length > 0\)/,
    'cached orgs may be reused only for uncertain org results or timeouts');
});

test('false-no-workspace: authoritative org fetch distinguishes failure from a genuine empty list', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('async function _fetchUserOrganizations()');
  const end = src.indexOf('export async function getUserOrganizationsAuthoritative()', start);
  const core = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(core, '_fetchUserOrganizations core must be extractable');
  // Transient failure branches must be non-authoritative (never a confirmed empty result).
  assert.match(core, /if \(!clientSessionOk\) return \{ orgs: \[\], authoritative: false \}/,
    'client session not ready must be non-authoritative, not an empty result');
  assert.match(core, /if \(!userId\) return \{ orgs: \[\], authoritative: false \}/,
    'missing resolved user id must be non-authoritative');
  assert.match(core, /if \(qErr\) \{[\s\S]*return \{ orgs: \[\], authoritative: false \}/,
    'a failed membership query must be non-authoritative, never a confirmed empty list');
  // A successful fetch — including a genuinely empty list — IS authoritative.
  assert.match(core, /return \{ orgs, authoritative: true \}/,
    'a successful fetch (including a genuinely empty list) must be authoritative');
});

test('false-no-workspace: account bundle confirms zero workspaces only from a non-partial authoritative result', async () => {
  const src = await readAppSource();
  const start = src.indexOf('async function applyOrgContextFromBundle(');
  const end = src.indexOf('async function refreshOrgContext(', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'applyOrgContextFromBundle must be extractable');
  // A partial bundle with a known workspace hint must retain the workspace, not clear it.
  assert.match(fn, /if \(bundle && bundle\.partial && OrganizationService\.readLocalOrgId\(\)\) \{[\s\S]*?return null;/,
    'a partial bundle with a known workspace hint must retain the workspace');
  // confirmedNoOrg may only be derived from a non-partial empty result.
  assert.match(fn, /confirmedNoOrg: Boolean\(!bundle\?\.partial && Array\.isArray\(resolved\.orgs\) && resolved\.orgs\.length === 0\)/,
    'confirmed no-org may only be derived from a non-partial empty result');
  // A mismatched active org may only be cleared from a non-partial bundle.
  assert.match(fn, /if \(nextOrgId && !nextOrgInActiveList && !\(bundle && bundle\.partial\)\)/,
    'a mismatched active org may only be cleared from a non-partial bundle');
});

test('phase 0.6C-2 account bundle does not expose stale profile or membership org ids as active', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /const hasOrg = id => id && orgsSafe\.some/,
    'profile and membership org hints must be validated against active org rows');
  assert.match(bundleFn, /const activeOrgId =[\s\S]*activeOrgSafe && activeOrgSafe\.id[\s\S]*\? String\(activeOrgSafe\.id\)[\s\S]*: null/,
    'activeOrgId must come from an active org row or be null');
  assert.doesNotMatch(bundleFn, /:\s*profileOrgId \|\| membershipOrgId \|\| null/,
    'activeOrgId must not fall back to preserved profile or membership org ids');
  assert.match(bundleFn, /let membershipSafe = activeOrgId \? membershipResult \|\| null : null/,
    'membership data must not keep a stale org-scoped membership when no active org exists');
});

test('phase 0.6C-2 archive fallback avoids logout reload destructive data and billing scope', async () => {
  const appSrc = await readAppSource();
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const applyStart = appSrc.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = appSrc.indexOf('async function refreshOrgContext', applyStart);
  const clearStart = appSrc.indexOf('function clearOrgContext');
  const clearEnd = appSrc.indexOf('let orgScopedRenderTimer', clearStart);
  const settingsHelperStart = settingsSrc.indexOf('function isConfirmedNoActiveWorkspaceBundle');
  const settingsHelperEnd = settingsSrc.indexOf('function ensureModalOrgId', settingsHelperStart);
  const settingsBranchStart = settingsSrc.indexOf('if (isConfirmedNoActiveWorkspaceBundle(bundle))');
  const settingsBranchEnd = settingsSrc.indexOf('profileData = bundle.profile || null;', settingsBranchStart);
  const snippets = [
    ['applyOrgContextFromBundle', applyStart >= 0 && applyEnd > applyStart ? appSrc.slice(applyStart, applyEnd) : ''],
    ['clearOrgContext', clearStart >= 0 && clearEnd > clearStart ? appSrc.slice(clearStart, clearEnd) : ''],
    ['settings no-active-workspace helper', settingsHelperStart >= 0 && settingsHelperEnd > settingsHelperStart ? settingsSrc.slice(settingsHelperStart, settingsHelperEnd) : ''],
    ['settings no-active-workspace branch', settingsBranchStart >= 0 && settingsBranchEnd > settingsBranchStart ? settingsSrc.slice(settingsBranchStart, settingsBranchEnd) : ''],
  ];

  for (const [label, src] of snippets) {
    assert.ok(src, `${label} snippet must be extractable`);
    assert.doesNotMatch(src, /signOut|forceLocalSignedOut|location\.reload|window\.location/i,
      `${label} must not sign out or reload`);
    assert.doesNotMatch(src, /stripe|checkout|portal|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
      `${label} must not touch Stripe, billing-status, or billing tables`);
    assert.doesNotMatch(src, /\.from\(['"]organization_members['"]\)|\.from\(['"]organization_invites['"]\)|\.delete\(\)|deletePack|deleteCase|storage\.from|router\./i,
      `${label} must not mutate memberships, invites, packs, cases, storage, or router state`);
  }
});

test('phase 0.6C-3 orgContextResolved is set on active apply and reset on uncertain auth clears', async () => {
  const src = await readAppSource();
  const applyStart = src.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = src.indexOf('async function refreshOrgContext', applyStart);
  const applyFn = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';
  const clearStart = src.indexOf('function clearOrgContext(');
  const clearEnd = src.indexOf('let orgScopedRenderTimer', clearStart);
  const clearFn = clearStart >= 0 && clearEnd > clearStart ? src.slice(clearStart, clearEnd) : '';

  assert.match(src, /let orgContextResolved = false;/,
    'orgContextResolved flag must be declared at module scope');
  assert.match(applyFn, /orgContext = \{[\s\S]*activeOrgId: nextOrgIdStr[\s\S]*\};[\s\S]*orgContextResolved = true;/,
    'active org bundle apply must mark org context resolved');
  assert.match(clearFn, /orgContextResolved = Boolean\(confirmedNoOrg\)/,
    'confirmed no-active clears must resolve, while uncertain clears must reset');
  assert.match(src, /lastAuthUserId = null;[\s\S]{0,120}orgContextResolved = false;/,
    'auth user change or signed-out cleanup must reset orgContextResolved');
  const switchHelperStart = src.indexOf('function applyUserSwitchIsolation(');
  assert.ok(switchHelperStart >= 0, 'centralized user-switch isolation helper must exist');
  const switchHelperFn = src.slice(switchHelperStart, switchHelperStart + 2200);
  assert.match(switchHelperFn, /lastAuthUserId = null;[\s\S]{0,120}orgContextResolved = false;/,
    'cross-tab user switch cleanup (via applyUserSwitchIsolation) must reset orgContextResolved');
  assert.match(src, /if \(isUserSwitch\) \{\s*[\r\n]+\s*applyUserSwitchIsolation\('SIGNED_IN_USER_SWITCH'\)/,
    'auth listener cross-tab user switch must invoke the isolation helper');
});

test('phase 0.6C-3 org-changed listener handles confirmed no-active without auth refresh', async () => {
  const src = await readAppSource();
  const start = src.indexOf("window.addEventListener('tp3d:org-changed', ev => {");
  const end = src.indexOf('AppShell.init();', start);
  const listener = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(listener, 'tp3d:org-changed listener must be extractable');
  assert.match(listener, /isClearedEvent = !detailOrgId && Boolean\(detail && detail\.confirmedNoOrg\)/,
    'listener must detect confirmed empty-org events');
  assert.match(listener, /if \(isClearedEvent\) \{[\s\S]*AccountSwitcher[\s\S]*refresh\(\)/,
    'confirmed no-active event must refresh the workspace chip');
  assert.match(listener, /if \(isClearedEvent\) \{[\s\S]*BillingService\.applyAccessGateFromBilling\(BillingService\.getBillingState\(\), \{[\s\S]*reason: 'org-cleared'[\s\S]*activeOrgId: null/,
    'confirmed no-active event must reapply access gate with no active org');

  const branchStart = listener.indexOf('if (isClearedEvent) {');
  const branchEnd = listener.indexOf('const snapshotOrgId', branchStart);
  const branch = branchStart >= 0 && branchEnd > branchStart ? listener.slice(branchStart, branchEnd) : '';
  assert.ok(branch, 'confirmed no-active branch must be extractable');
  assert.doesNotMatch(branch, /requestAuthRefresh/,
    'confirmed no-active event must not trigger auth refresh and re-enter Loading');
});

test('phase 0.6C-3 no-workspace banner remains gated by settled auth state', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function applyOrgRequiredUi(');
  const end = src.indexOf('// \u2500\u2500 Install workspace-ready listener early', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'applyOrgRequiredUi must be extractable');
  assert.match(fn, /const authNotSettled = !AuthService\.authGateIsSettled\(\)/,
    'no-workspace banner logic must remain gated by settled auth state');
  assert.match(fn, /const orgContextBusy = Boolean\(orgContextInFlight \|\| authRehydratePromise\)/,
    'no-workspace banner must know whether auth or org context work is still in flight');
  assert.match(fn, /const hasResolvedNoActiveOrg = Boolean\([\s\S]*confirmedNoOrg[\s\S]*orgContextResolved[\s\S]*!orgContext\.activeOrgId[\s\S]*Array\.isArray\(orgContext\.orgs\)[\s\S]*orgContext\.orgs\.length === 0/,
    'no-workspace banner must require a resolved confirmed zero-active-org context');
  assert.match(fn, /const isSignedInForNoOrgBanner = Boolean\([\s\S]*authSnapshot\.userId[\s\S]*authSnapshot\.hasToken[\s\S]*authSnapshot\.status !== 'signed_out'/,
    'no-workspace banner must still require signed-in user identity/token, without depending on a transient exact signed_in status');
  assert.match(fn, /showNoOrgBanner = Boolean\([\s\S]*isSignedInForNoOrgBanner[\s\S]*hasResolvedNoActiveOrg[\s\S]*!authNotSettled[\s\S]*!orgContextBusy/,
    'confirmed no-org banner must not render before auth gate settles or while auth/org work is in flight');
});

test('workspace creation Edge Function authenticates, validates, and calls only the transaction RPC', async () => {
  const src = await fs.readFile(orgCreateWorkspacePath, 'utf8');

  assert.match(src, /if \(req\.method !== "POST"\)/,
    'workspace creation must require POST');
  assert.match(src, /requireUser\(req\)/,
    'workspace creation must authenticate the caller');
  assert.match(src, /normalizeWorkspaceName\(\(body as Record<string, unknown>\)\.name\)/,
    'workspace creation must accept and normalize only the name input');
  assert.match(src, /\.rpc\("tp3d_create_workspace", \{[\s\S]*p_actor_id: auth\.user\.id,[\s\S]*p_name: name/,
    'Edge Function must derive ownership from the verified user and call the transaction RPC');
  assert.doesNotMatch(src, /\.from\(\s*["']|\.(?:insert|update|upsert|delete)\(/,
    'Edge Function must not split the transaction into direct table writes');
  assert.doesNotMatch(src, /body[^\n]*(?:owner|role|billing|stripe|members)/i,
    'Edge Function must not consume caller-supplied authority or billing fields');
  assert.match(src, /Each accepted request creates one distinct workspace/,
    'duplicate/retry behavior must be explicit rather than name-deduplicating unrelated workspaces');
  assert.doesNotMatch(src, /json\(\{ error: (?:error|e)(?:\s*[,}]|\.message)/,
    'database and PostgREST error details must not be returned to the browser');
});

test('Packet 2 preserves signup bootstrap and changes no slug contract', async () => {
  const migration = await fs.readFile(enforceWorkspaceLimitMigrationPath, 'utf8');
  const signup = await fs.readFile(signupAutoOrgUuidMigrationPath, 'utf8');

  assert.doesNotMatch(migration, /tp3d_handle_new_user|on_auth_user_created|auth\.users/i,
    'ordinary creation enforcement must not alter the server-owned signup bootstrap');
  assert.match(signup, /insert into public\.organizations[\s\S]*insert into public\.organization_members[\s\S]*current_organization_id = v_org_id/,
    'signup must retain its atomic initial organization, owner membership, trial trigger, and active workspace behavior');
  assert.match(migration, /v_org_slug := v_org_id::text;[\s\S]*set slug = v_org_slug/,
    'Packet 2 must preserve the existing UUID slug shape');
  assert.doesNotMatch(migration, /unique\s*\([^)]*slug|slug[^\n]*(?:not null|lower|regexp)/i,
    'workspace slug integrity Phase 1 must not start in Packet 2');
});

test('membership privilege migration keeps authenticated SELECT and revokes all direct DML', async () => {
  const src = await fs.readFile(restrictMembershipMutationMigrationPath, 'utf8');

  assert.match(src, /revoke insert, update, delete[\s\S]*on table public\.organization_members[\s\S]*from authenticated/i,
    'authenticated membership INSERT, UPDATE, and DELETE must be revoked at the table boundary');
  assert.match(src, /grant select[\s\S]*on table public\.organization_members[\s\S]*to authenticated/i,
    'authorized users must retain RLS-filtered membership reads');
  assert.match(src, /grant select, insert, update, delete[\s\S]*on table public\.organization_members[\s\S]*to service_role/i,
    'approved server paths must retain membership mutation privileges');
  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe|policy|create policy|drop policy/i,
    'membership privilege migration must not alter billing or rewrite RLS policies');
});

test('phase 0.6D-pre 4B-orphan purge-deleted-users exists as a retired 410 stub', async () => {
  const source = await fs.readFile(purgeDeletedUsersPath, 'utf8');
  assert.match(source, /status:\s*410/,
    'purge-deleted-users must return HTTP 410 Gone');
  assert.match(source, /This endpoint has been retired\./,
    'purge-deleted-users stub must contain a retired message');
});

test('phase 0.6D-pre 4B-orphan purge-deleted-users does not call auth.admin.deleteUser', async () => {
  const source = await fs.readFile(purgeDeletedUsersPath, 'utf8');
  assert.doesNotMatch(source, /auth\.admin\.deleteUser/,
    'purge-deleted-users stub must not delete auth users');
  assert.doesNotMatch(source, /auth\.admin\.updateUserById/,
    'purge-deleted-users stub must not call any admin auth mutation');
});

test('phase 0.6D-pre 4B-orphan purge-deleted-users does not import or use Supabase clients', async () => {
  const source = await fs.readFile(purgeDeletedUsersPath, 'utf8');
  assert.doesNotMatch(source, /createClient|serviceClient|supabase-js|@supabase\/supabase-js/,
    'purge-deleted-users stub must not import any Supabase client');
  assert.doesNotMatch(source, /requireUser/,
    'purge-deleted-users stub must not require user auth');
});

test('phase 0.6D-pre 4B-orphan purge-deleted-users does not touch app data tables', async () => {
  const source = await fs.readFile(purgeDeletedUsersPath, 'utf8');
  assert.doesNotMatch(
    source,
    /\.from\(['"](?:profiles|organization_members|organizations|billing_customers|subscriptions|packs|cases)['"]\)|storage\.from|stripe/i,
    'purge-deleted-users stub must not touch profiles, org tables, billing, storage, Stripe, packs, or cases'
  );
});

test('phase 0.6D-pre 4B-orphan purge-deleted-users contains no wildcard CORS header', async () => {
  const source = await fs.readFile(purgeDeletedUsersPath, 'utf8');
  assert.doesNotMatch(source, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
    'purge-deleted-users stub must not contain literal wildcard CORS');
});

test('phase 0.6D Batch C Edge Function requires authenticated POST and validates UUIDs', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');

  assert.match(src, /if \(req\.method !== "POST"\)/,
    'transfer Edge Function must require POST');
  assert.match(src, /requireUser\(req\)/,
    'transfer Edge Function must require authenticated user');
  assert.match(src, /if \(!auth\.ok \|\| !auth\.user\)/,
    'transfer Edge Function must reject unauthenticated requests');
  assert.match(src, /const UUID_RE = \/\^\[0-9a-f\]/,
    'transfer Edge Function must define UUID validation');
  assert.match(src, /!UUID_RE\.test\(orgId\)/,
    'transfer Edge Function must validate organization_id');
  assert.match(src, /!UUID_RE\.test\(newOwnerId\)/,
    'transfer Edge Function must validate new_owner_id');
  assert.match(src, /newOwnerId === auth\.user\.id[\s\S]*Choose another workspace member as the new owner\./,
    'transfer Edge Function must reject target equal to actor');
});

test('phase 0.6D Batch C Edge Function authorizes transfer and avoids direct table mutation', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');

  assert.match(src, /serviceClient\(\)/,
    'transfer Edge Function must use service client');
  assert.match(src, /\.rpc\("tp3d_transfer_workspace_ownership"/,
    'transfer Edge Function must call the transfer RPC');
  assert.match(src, /\.from\("organizations"\)[\s\S]*\.select\("id, owner_id"\)[\s\S]*\.eq\("id", orgId\)[\s\S]*\.maybeSingle\(\)/,
    'transfer Edge Function must authoritatively verify requested workspace ownership');
  assert.match(src, /\.from\("organization_members"\)[\s\S]*\.eq\("organization_id", orgId\)[\s\S]*\.eq\("user_id", newOwnerId\)[\s\S]*\.maybeSingle\(\)/,
    'transfer Edge Function must verify the target belongs to the requested workspace');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/,
    'transfer Edge Function must not directly mutate tables outside RPC');
});

test('phase 0.6D Batch C app exposes handleOwnershipTransferred without signout or reload', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function handleOwnershipTransferred(orgId, options = {})');
  const end = src.indexOf('// Expose billing pump globally', start);
  const helper = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(helper, 'app must define handleOwnershipTransferred');
  assert.match(src, /window\.TruckPackerApp\.handleOwnershipTransferred = handleOwnershipTransferred/,
    'app must expose handleOwnershipTransferred');
  assert.match(helper, /clearBillingPendingRetry\(normalizedOrgId\)/,
    'ownership transfer handler must clear stale billing retry state');
  assert.match(helper, /SupabaseClient\.invalidateAccountCache\(\)/,
    'ownership transfer handler must invalidate account cache');
  assert.match(helper, /refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'ownership transfer handler must force org context refresh');
  assert.match(helper, /maybeScheduleBillingRefresh\(source\)/,
    'ownership transfer handler must refresh billing context');
  assert.doesNotMatch(helper, /signOut|forceLocalSignedOut|location\.reload|window\.location/,
    'ownership transfer handler must not sign out or reload');
});

test('phase 0.6D Batch B restore Edge Function requires authenticated POST and UUID input', async () => {
  const src = await fs.readFile(orgRestoreWorkspacePath, 'utf8');

  assert.match(src, /if \(req\.method !== "POST"\)/,
    'restore Edge Function must be POST-only');
  assert.match(src, /requireUser\(req\)/,
    'restore Edge Function must require authenticated user identity');
  assert.match(src, /UUID_RE/,
    'restore Edge Function must define UUID validation');
  assert.match(src, /if \(!isUuid\(organizationId\)\)/,
    'restore Edge Function must validate organization_id before DB work');
});

test('phase 0.6D Batch B app exposes handleWorkspaceRestored without signout or reload', async () => {
  const src = await readAppSource();
  const start = src.indexOf('function handleWorkspaceRestored(restoredOrgId, options = {})');
  const end = src.indexOf('function handleOwnershipTransferred', start);
  const helper = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(helper, 'app must define handleWorkspaceRestored');
  assert.match(src, /window\.TruckPackerApp\.handleWorkspaceRestored = handleWorkspaceRestored/,
    'app must expose handleWorkspaceRestored');
  assert.match(helper, /clearBillingPendingRetry\(normalizedRestoredOrgId\)/,
    'restore handler must clear stale billing retry state');
  assert.match(helper, /SupabaseClient\.invalidateAccountCache\(\)/,
    'restore handler must invalidate account cache');
  assert.match(helper, /refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'restore handler must force org context refresh');
  assert.match(helper, /setActiveOrgId\(normalizedRestoredOrgId/,
    'restore handler must activate restored workspace when no active workspace existed');
  assert.doesNotMatch(helper, /signOut|forceLocalSignedOut|location\.reload|window\.location/,
    'restore handler must not sign out or reload');
});

test('phase 0.6D-pre 4B-3A account purge migration allows none and purged deletion statuses', async () => {
  const src = await fs.readFile(accountPurgeStatusMigrationPath, 'utf8');

  assert.match(src, /drop constraint if exists profiles_deletion_status_check/i,
    'account purge migration must replace the existing deletion_status check');
  assert.match(src, /add constraint profiles_deletion_status_check/i,
    'account purge migration must recreate profiles_deletion_status_check');
  assert.match(src, /deletion_status is null/i,
    'account purge migration must continue allowing null deletion_status');
  assert.match(src, /'none'[\s\S]*'requested'[\s\S]*'canceled'[\s\S]*'purged'/,
    'account purge migration must allow existing none plus requested, canceled, and purged statuses');
  assert.doesNotMatch(src, /update\s+public\.profiles|set\s+deletion_status\s*=\s*null/i,
    'account purge migration must not mutate existing non-deleted none rows');
});

test('phase 0.6D-pre 4B-3A purge-deleted-accounts exists and requires invocation secret', async () => {
  const src = await fs.readFile(purgeDeletedAccountsPath, 'utf8');

  assert.match(src, /PURGE_ACCOUNTS_INVOCATION_SECRET/,
    'purge-deleted-accounts must require an invocation secret');
  assert.match(src, /getRequestSecret\(req\) !== expectedSecret/,
    'purge-deleted-accounts must reject requests without the invocation secret');
  assert.match(src, /x-purge-secret/,
    'purge-deleted-accounts must accept x-purge-secret');
  assert.match(src, /authorization[\s\S]*bearer/i,
    'purge-deleted-accounts must accept Authorization: Bearer secret');
  assert.match(src, /if \(req\.method !== "POST"\)/,
    'purge-deleted-accounts must be POST-only');
  assert.match(src, /serviceClient\(\)/,
    'purge-deleted-accounts must use the service role client');
  assert.doesNotMatch(src, /requireUser\(req\)|userClientFromRequest/,
    'purge-deleted-accounts must not use a user JWT flow');
});

test('phase 0.6D-pre 4B-3A purge-deleted-accounts has verify_jwt disabled in config', async () => {
  const src = await fs.readFile(supabaseConfigPath, 'utf8');
  const start = src.indexOf('[functions.purge-deleted-accounts]');
  const end = src.indexOf('[functions.', start + 1);
  const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : '';

  assert.ok(block, 'config must include purge-deleted-accounts function block');
  assert.match(block, /verify_jwt\s*=\s*false/,
    'purge-deleted-accounts must use support-secret auth with verify_jwt=false');
});

test('phase 0.6D-pre 4B-3A purge-deleted-accounts queries due requested profiles', async () => {
  const src = await fs.readFile(purgeDeletedAccountsPath, 'utf8');
  const queryStart = src.indexOf('.from("profiles")');
  const queryEnd = src.indexOf('if (candidatesErr)', queryStart);
  const query = queryStart >= 0 && queryEnd > queryStart ? src.slice(queryStart, queryEnd) : '';

  assert.ok(query, 'purge candidate query must be extractable');
  assert.match(query, /\.eq\("deletion_status", "requested"\)/,
    'purge must only select requested deletion profiles');
  assert.match(query, /\.lte\("purge_after", nowIso\)/,
    'purge must only select profiles whose purge_after is due');
  assert.match(query, /\.order\("purge_after", \{ ascending: true \}\)/,
    'purge should process oldest due requests first');
  assert.match(query, /\.limit\(batchLimit\)/,
    'purge must use a bounded batch limit');
});

test('phase 0.6D-pre 4B-3A purge-deleted-accounts skips users still owning workspaces', async () => {
  const src = await fs.readFile(purgeDeletedAccountsPath, 'utf8');
  const helperStart = src.indexOf('async function hasWorkspaceOwnerReference');
  const helperEnd = src.indexOf('async function markProfilePurged', helperStart);
  const helper = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';

  assert.ok(helper, 'workspace owner guard helper must be extractable');
  assert.match(helper, /\.from\("organizations"\)[\s\S]*\.select\("id"\)[\s\S]*\.eq\("owner_id", userId\)/,
    'purge must check organizations.owner_id before deletion');
  assert.match(src, /if \(await hasWorkspaceOwnerReference\(sb, userId\)\)[\s\S]*skipped \+= 1[\s\S]*continue;/,
    'purge must skip candidates that still own organizations');
  assert.doesNotMatch(helper, /\.(update|insert|upsert|delete)\(/,
    'workspace owner guard must not mutate organizations');
});

test('phase 0.6D-pre 4B-3A purge-deleted-accounts marks purged before deleteUser and reverts on failure', async () => {
  const src = await fs.readFile(purgeDeletedAccountsPath, 'utf8');
  const purgedIdx = src.indexOf('deletion_status: "purged"');
  const deleteIdx = src.indexOf('auth.admin.deleteUser');
  const revertStart = src.indexOf('async function revertProfileToRequested');
  const revertEnd = src.indexOf('Deno.serve', revertStart);
  const revert = revertStart >= 0 && revertEnd > revertStart ? src.slice(revertStart, revertEnd) : '';

  assert.ok(purgedIdx >= 0, 'purge must write deletion_status=purged');
  assert.ok(deleteIdx > purgedIdx, 'purge must mark profile purged before auth.admin.deleteUser');
  assert.match(src, /const marked = await markProfilePurged\(sb, userId\);[\s\S]*auth\.admin\.deleteUser\(userId\)/,
    'purge loop must call deleteUser only after markProfilePurged succeeds');
  assert.match(revert, /deletion_status: "requested"/,
    'purge must define a safe revert to requested');
  assert.match(src, /if \(deleteErr\)[\s\S]*await revertProfileToRequested\(sb, userId\);[\s\S]*errors \+= 1/,
    'purge must attempt safe revert when auth deletion fails');
});

test('phase 0.6D-pre 4B-3A purge-deleted-accounts returns safe summary only', async () => {
  const src = await fs.readFile(purgeDeletedAccountsPath, 'utf8');

  assert.match(src, /return json\(\{ ok: true, purged, skipped, errors \}/,
    'purge must return only aggregate counts');
  assert.doesNotMatch(src, /email|full_name|avatar_url|access_token|refresh_token|user_id|users:/i,
    'purge response/source must not expose user PII, tokens, or full user ids');
});

test('phase 0.6D-pre 4B-3A purge-deleted-accounts avoids forbidden scope', async () => {
  const src = await fs.readFile(purgeDeletedAccountsPath, 'utf8');

  assert.doesNotMatch(src, /stripe|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events|checkout|portal|webhook/i,
    'purge must not touch Stripe, billing-status, or billing tables');
  assert.doesNotMatch(src, /organization_invites|org-invite|org-member|archiveWorkspace|restoreWorkspace|transferOwnership|org-archive|org-restore|org-transfer|org-leave/i,
    'purge must not touch invites, member functions, or workspace lifecycle functions');
  assert.doesNotMatch(src, /packs|cases|deletePack|deleteCase|storage\.from|router\.|location\.reload|signOut|document\.|window\./i,
    'purge must not touch packs, cases, storage, router, frontend, reload, or signOut');
  assert.doesNotMatch(src, /\.from\("organizations"\)[\s\S]{0,260}\.(update|insert|upsert|delete)\(/,
    'purge must not mutate organizations rows');
  assert.doesNotMatch(src, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
    'purge must not introduce wildcard CORS headers');
});

test('phase 0.6D-pre 4B-3A legacy purge-deleted-users remains retired 410', async () => {
  const src = await fs.readFile(purgeDeletedUsersPath, 'utf8');

  assert.match(src, /status:\s*410/,
    'legacy purge-deleted-users must remain retired');
  assert.match(src, /Account purge is not available through this legacy endpoint/,
    'legacy purge-deleted-users must keep neutral retired copy');
  assert.doesNotMatch(src, /auth\.admin\.deleteUser|serviceClient|createClient|\.from\(/,
    'legacy purge-deleted-users must not perform purge work');
});

test('AUTOPACK-MAX-A clones its effective rule profile and Phase A adds no packedProfile metadata', async () => {
  const { Solver, PackLib } = await p5Modules();
  const Engine = await import(`${autoPackEnginePath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 24, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = ['a', 'b'].map((id, index) => ({
    instanceId: id,
    caseId: 'rules-case',
    dims: { l: 48, w: 48, h: 12 },
    orientationLock: 'upright',
    canFlip: false,
    orientationLocked: index === 0,
    lockedRotation: { x: 0, y: 0, z: 0 },
    noStackOnTop: true,
    stackable: false,
    maxStackCount: 1,
    weight: 80,
    laneItem: true,
    loadPriority: 1,
    transform: { rotation: { x: 0, y: 0, z: 0 } },
  }));
  const itemSnapshot = structuredClone(items);
  const result = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, maxCapacityMode: true });
  assert.equal(result.placements.size, 2, 'fixture exercises relaxed stacking before checking immutability');
  assert.deepEqual(items, itemSnapshot, 'solver does not mutate caller-owned items or nested instance locks');

  const cases = items.map(item => ({
    id: item.instanceId,
    caseId: item.caseId,
    placement: 'staged',
    transform: {
      position: { x: 60, y: 6, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    orientationLock: item.orientationLock,
    canFlip: item.canFlip,
    orientationLocked: item.orientationLocked,
    lockedRotation: structuredClone(item.lockedRotation),
    noStackOnTop: item.noStackOnTop,
    stackable: item.stackable,
    maxStackCount: item.maxStackCount,
    weight: item.weight,
    laneItem: item.laneItem,
    loadPriority: item.loadPriority,
  }));
  const casesSnapshot = structuredClone(cases);
  const nextCases = Engine.buildAutoPackNextCases(
    cases,
    result.placements,
    result.rotations,
    result.orientedDims,
    new Map()
  );
  assert.deepEqual(cases, casesSnapshot, 'building nextCases does not mutate stored instances');
  const handlingFields = [
    'orientationLock', 'canFlip', 'orientationLocked', 'lockedRotation',
    'noStackOnTop', 'stackable', 'maxStackCount', 'weight', 'laneItem', 'loadPriority',
  ];
  for (const next of nextCases) {
    const before = casesSnapshot.find(inst => inst.id === next.id);
    for (const field of handlingFields) {
      assert.deepEqual(next[field], before[field], `${next.id}: saved ${field} remains unchanged`);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(next, 'packedProfile'), false,
      `${next.id}: Phase A writes no packedProfile durability metadata`);
  }
});

test('BUG-01-A renderAuthState delegates confirmed user switches to the centralized isolation helper', async () => {
  const src = await readAppSource();

  assert.match(src, /_isConfirmedUserSwitch/, '_isConfirmedUserSwitch variable present');

  const guardIdx = src.indexOf('const _isConfirmedUserSwitch =');
  assert.ok(guardIdx >= 0, '_isConfirmedUserSwitch assignment found in app.js');

  const ifIdx = src.indexOf('if (_isConfirmedUserSwitch)', guardIdx);
  assert.ok(ifIdx >= 0 && ifIdx < guardIdx + 600, 'if (_isConfirmedUserSwitch) block found near assignment');

  let depth = 0, blockEnd = -1;
  for (let i = ifIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { blockEnd = i + 1; break; } }
  }
  assert.ok(blockEnd > ifIdx, 'user-switch block body extracted');
  const block = src.slice(ifIdx, blockEnd);

  assert.match(block, /applyUserSwitchIsolation\(/, 'guard block delegates to applyUserSwitchIsolation (single contract; see BUG-01-I)');
  assert.ok(!/writeLocalOrgId\(null\)/.test(block), 'no duplicated inline clear — the helper owns the contract');
});

test('BUG-01-A3 isolation runs BEFORE readLocalOrgId() and BEFORE network-dependent work in renderAuthState', async () => {
  const src = await readAppSource();

  // The clear must precede the org-hint read so the new user never inherits the
  // stale key, and must precede await checkProfileStatus() so no network wait
  // can interleave stale User A state with User B identity.
  const renderAuthStart = src.indexOf('async function renderAuthState(');
  assert.ok(renderAuthStart >= 0, 'renderAuthState function found');

  const isolationIdx = src.indexOf('applyUserSwitchIsolation(', renderAuthStart);
  const profileIdx = src.indexOf('await checkProfileStatus()', renderAuthStart);
  const readIdx = src.indexOf('const hintedOrgId = OrganizationService.readLocalOrgId()', renderAuthStart);
  assert.ok(isolationIdx > 0 && profileIdx > 0 && readIdx > 0, 'isolation call, profile await, and org-hint read found in renderAuthState');
  assert.ok(isolationIdx < profileIdx, 'isolation precedes await checkProfileStatus() (no pre-clear network window)');
  assert.ok(isolationIdx < readIdx, 'isolation precedes readLocalOrgId() — stale key cannot be inherited');

  // The helper itself clears the hint via clearOrgContext({ clearLocalOrgHint: true }).
  const helperStart = src.indexOf('function applyUserSwitchIsolation(');
  assert.ok(helperStart >= 0, 'isolation helper found');
  const helper = src.slice(helperStart, helperStart + 2200);
  assert.match(helper, /clearLocalOrgHint:\s*true/, 'helper clears the tp3d:active-org-id hint');
});

test('BUG-01-U source contract owns one post-switch authoritative billing resolution', async () => {
  const src = await readAppSource();
  const stateStart = src.indexOf('let _billingAuthoritativeRefreshGeneration = 0;');
  const stateEnd = src.indexOf('function normalizeBillingEntitlementStatus(', stateStart);
  const stateBlock = src.slice(stateStart, stateEnd);
  assert.ok(stateBlock, 'authoritative refresh state block exists');
  assert.match(stateBlock, /_billingAuthoritativeRefreshRequired = null/, 'requirement has explicit state');
  assert.match(stateBlock, /generation:[\s\S]*userId:[\s\S]*epoch:[\s\S]*attemptedAt:/,
    'requirement owns transition generation, user, billing epoch, and bounded-attempt timestamp');
  assert.match(stateBlock, /token\.generation === _billingAuthoritativeRefreshRequired\.generation/,
    'completion requires the current transition generation');
  assert.match(stateBlock, /token\.epoch === _billingEpoch/, 'completion requires the current billing epoch');
  assert.match(stateBlock, /token\.userId === currentUserId/, 'completion requires the current authenticated user');

  const refreshStart = src.indexOf('async function refreshBilling(');
  const refreshEnd = src.indexOf('/** @param {object} billingSnapshot', refreshStart);
  const refreshFn = src.slice(refreshStart, refreshEnd);
  assert.match(refreshFn, /authoritativeRefresh = null/, 'refresh accepts a transition-owned authoritative token');
  assert.match(refreshFn, /if \(currentAuthoritativeRefresh\) force = true/,
    'authoritative requirement forces the direct path');
  assert.match(refreshFn, /!currentAuthoritativeRefresh && _lastBillingKey === billingKey/,
    'prior burst state cannot suppress the required direct request');
  assert.match(refreshFn, /requestedOrgId && !currentAuthoritativeRefresh[\s\S]*_tryAcquireBillingLock/,
    'shared cross-tab ownership cannot replace the required current-user request');
  assert.match(refreshFn, /resultUserId !== currentAuthoritativeRefresh\.userId/,
    'response identity must match the transition owner');
  assert.match(refreshFn, /_billingState\.ok && currentAuthoritativeRefresh[\s\S]*clearBillingAuthoritativeRefreshRequirement/,
    'only an applied successful direct response completes the requirement');
  assert.match(refreshFn, /preserveUserSwitchPendingForBillingFailure\(currentAuthoritativeRefresh\)/,
    'failure preserves conservative pending ownership');

  const clearOrgStart = src.indexOf('function clearOrgContext(');
  const clearOrgEnd = src.indexOf('let orgScopedRenderTimer', clearOrgStart);
  assert.match(src.slice(clearOrgStart, clearOrgEnd),
    /if \(confirmedNoOrg\) \{[\s\S]*clearBillingAuthoritativeRefreshRequirement\(null, 'confirmed-no-workspace'\)/,
    'confirmed no-workspace is an authoritative terminal clear');
  const signedOutStart = src.indexOf('function _executeSignedOutCleanup(');
  const signedOutEnd = src.indexOf('function installAuthListener(', signedOutStart);
  assert.match(src.slice(signedOutStart, signedOutEnd),
    /clearBillingState\(\)[\s\S]*clearBillingAuthoritativeRefreshRequirement\(null, 'signed-out-cleanup'\)/,
    'sign-out is an authoritative terminal clear');

  const proStart = src.indexOf('function getProRuleSet(');
  const proEnd = src.indexOf('function normalizeCheckoutInterval(', proStart);
  const proFn = src.slice(proStart, proEnd);
  assert.match(proFn, /authoritativeRefreshRequired = isBillingAuthoritativeRefreshRequired\(\)/,
    'Pro gate reads the explicit requirement rather than the UI pending flag');
  assert.match(proFn, /!authoritativeRefreshRequired && s\.ok && isEntitlementAllowed/,
    'provisional shared entitlement remains fail-closed');
});

test('BUG-01-Z production pump runtime keeps authoritative failure fail-closed with bounded recovery', async () => {
  const { pump, calls, billingState } = await createBillingPumpRuntimeHarness();
  pump.switchIdentity('user-b', 'org-b');
  pump.failNext();
  pump.run('render-auth-state');
  assert.strictEqual(calls.length, 1, 'one initial direct attempt runs');
  assert.strictEqual(billingState.ok, false, 'failed result remains fail-closed');
  assert.ok(billingState.error, 'failure remains visible');
  assert.ok(pump.snapshot().authoritativeRequired, 'failure does not satisfy the requirement');
  assert.strictEqual(pump.snapshot().pending, true, 'failure restores conservative user-switch pending');

  pump.advance(100);
  pump.run('org-context');
  assert.strictEqual(calls.length, 1, 'ordinary immediate triggers are hard-cooled after the failed attempt');

  pump.run('manual');
  assert.strictEqual(calls.length, 2, 'explicit recovery performs one later authoritative retry');
  assert.strictEqual(billingState.ok, true, 'recovery restores authoritative billing');
  assert.strictEqual(pump.snapshot().authoritativeRequired, null, 'successful retry clears the requirement');
  assert.strictEqual(pump.snapshot().pending, false, 'successful retry releases pending');

  pump.advance(100);
  pump.run('org-context');
  assert.strictEqual(calls.length, 2, 'successful recovery does not start a direct-fetch loop');
});

test('BUG-01-AA source contract transfers explicit sign-out at every confirmed authenticated boundary', async () => {
  const src = await readAppSource();
  const stateStart = src.indexOf('let _billingAuthoritativeRefreshGeneration = 0;');
  const stateEnd = src.indexOf('function normalizeBillingEntitlementStatus(', stateStart);
  const stateBlock = src.slice(stateStart, stateEnd);
  const markerDeclaration = stateBlock.split('\n')
    .find(line => line.includes('_billingRequireAuthoritativeOnNextSignIn'));
  assert.strictEqual(markerDeclaration.trim(), 'let _billingRequireAuthoritativeOnNextSignIn = false;',
    'next-session marker is a plain in-memory boolean');

  const transferStart = stateBlock.indexOf(
    'function transferPendingPostSignoutBillingRequirementForAuthenticatedUser('
  );
  const transferEnd = stateBlock.indexOf('function clearBillingAuthoritativeRefreshRequirement(', transferStart);
  const transferFn = stateBlock.slice(transferStart, transferEnd);
  assert.doesNotMatch(transferFn, /localStorage|sessionStorage|entitlement|Stripe/,
    'marker transfer persists no identity, organization, entitlement, Stripe, or token data');
  const pendingIdx = transferFn.indexOf('__TP3D_USER_SWITCH_PENDING = true');
  const requireIdx = transferFn.indexOf('requireBillingAuthoritativeRefreshForUserSwitch(normalizedUserId)');
  const consumeIdx = transferFn.indexOf('_billingRequireAuthoritativeOnNextSignIn = false');
  assert.ok(pendingIdx >= 0 && requireIdx > pendingIdx && consumeIdx > requireIdx,
    'confirmed auth binds the current user/epoch requirement before consuming the marker');

  const cleanupStart = src.indexOf('function _executeSignedOutCleanup(');
  const cleanupEnd = src.indexOf('const PROFILE_CHECK_TTL_MS', cleanupStart);
  const cleanupFn = src.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupFn, /const hadAuthenticatedSession = Boolean\(/,
    'cleanup records whether real authenticated authority is being cleared');
  assert.match(cleanupFn,
    /clearBillingState\(\)[\s\S]*clearBillingAuthoritativeRefreshRequirement\(null, 'signed-out-cleanup'\)[\s\S]*if \(userInitiatedSignOut && hadAuthenticatedSession\) \{[\s\S]*markBillingAuthoritativeRefreshForNextSignIn\(\)/,
    'explicit authenticated sign-out clears current billing authority before setting the non-sensitive marker');
  assert.match(cleanupFn, /clearOrgContext\([\s\S]*clearBillingState\(\)/,
    'organization authority is cleared before the marker can be transferred');

  const listenerStart = src.indexOf('SupabaseClient.onAuthStateChange(async (event, session) =>');
  const listenerEnd = src.indexOf('if (!authUiBound)', listenerStart);
  const listenerFn = src.slice(listenerStart, listenerEnd);
  assert.match(listenerFn,
    /if \(newUserId && session && session\.access_token\) \{[\s\S]*transferPendingPostSignoutBillingRequirementForAuthenticatedUser\(\{[\s\S]*source: 'auth-listener'/,
    'any listener event with a valid authenticated session may transfer the marker');

  const renderStart = src.indexOf('async function renderAuthState(');
  const renderEnd = src.indexOf('function _executeSignedOutCleanup(', renderStart);
  assert.match(src.slice(renderStart, renderEnd),
    /transferPendingPostSignoutBillingRequirementForAuthenticatedUser\(\{[\s\S]*source: 'render-auth-state'/,
    'renderAuthState shares the confirmed-auth transfer helper');
  const rehydrateStart = src.indexOf('async function rehydrateAuthState(');
  const rehydrateEnd = src.indexOf('function clearSidebarBillingDomForUserSwitch(', rehydrateStart);
  assert.match(src.slice(rehydrateStart, rehydrateEnd),
    /transferPendingPostSignoutBillingRequirementForAuthenticatedUser\(\{[\s\S]*source: 'rehydrate-auth-state'/,
    'rehydrateAuthState shares the confirmed-auth transfer helper');

  const helperOccurrences = src.split(
    'transferPendingPostSignoutBillingRequirementForAuthenticatedUser('
  ).length - 1;
  assert.strictEqual(helperOccurrences, 4,
    'one helper definition plus exactly three confirmed-auth call sites own transfer');
});

test('BUG-01-AB production runtime transfers on any first confirmed authenticated listener event', async () => {
  const { pump, calls } = await createBillingPumpRuntimeHarness();
  pump.signOut({ authenticated: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pump.snapshot().authoritativeRequired)), null,
    'sign-out clears the prior session-bound requirement');
  assert.strictEqual(pump.snapshot().requireOnNextSignIn, true, 'authenticated sign-out sets the marker');
  assert.strictEqual(pump.snapshot().pending, false, 'signed-out terminal releases pending');

  assert.strictEqual(pump.authEvent('SIGNED_IN', '', ''), false, 'failed sign-in cannot consume the marker');
  assert.strictEqual(pump.snapshot().requireOnNextSignIn, true, 'failed sign-in leaves the marker available');

  assert.strictEqual(pump.authEvent('TOKEN_REFRESHED', 'user-b', 'org-b'), true,
    'first valid authenticated observation transfers regardless of literal event name');
  assert.strictEqual(pump.snapshot().requireOnNextSignIn, false, 'successful transfer consumes the marker');
  assert.strictEqual(pump.snapshot().authoritativeRequired.userId, 'user-b',
    'requirement belongs to the new authenticated user');
  assert.strictEqual(pump.snapshot().pending, true, 'new session remains fail-closed before direct truth');
  pump.run('render-auth-state');
  assert.strictEqual(calls.length, 1, 'one direct request completes the new session');
  assert.strictEqual(calls[0].force, true, 'post-sign-out request is authoritative');
  assert.strictEqual(pump.snapshot().authoritativeRequired, null, 'successful direct truth clears the requirement');
  assert.strictEqual(pump.snapshot().pending, false, 'normal success releases pending');
  pump.advance(100);
  pump.run('org-context');
  assert.strictEqual(calls.length, 1, 'successful completion does not create a request loop');

  for (const event of ['INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED']) {
    const runtime = await createBillingPumpRuntimeHarness();
    runtime.pump.signOut({ authenticated: true });
    assert.strictEqual(runtime.pump.authEvent(event, 'user-b', 'org-b'), true,
      `${event} transfers when it is the first confirmed authenticated observation`);
    const generation = runtime.pump.snapshot().authoritativeRequired.generation;
    assert.strictEqual(runtime.pump.authEvent('SIGNED_IN', 'user-b', 'org-b'), false,
      `${event} consumes the marker exactly once`);
    assert.strictEqual(runtime.pump.snapshot().authoritativeRequired.generation, generation,
      `${event} does not create a duplicate authoritative generation`);
  }
});

test('BUG-01-AC production runtime forces all sign-out/sign-in directions despite fresh state', async () => {
  const exercise = async ({ userId, orgId, shared = false, local = false }) => {
    const runtime = await createBillingPumpRuntimeHarness();
    if (local) {
      Object.assign(runtime.billingState, {
        ok: true,
        loading: false,
        pending: false,
        error: null,
        orgId,
        lastFetchedAt: 99990,
      });
    }
    if (shared) {
      Object.assign(runtime.billingState, {
        ok: true,
        loading: false,
        pending: false,
        error: null,
        orgId: 'prior-org',
        lastFetchedAt: 99990,
      });
    }
    runtime.pump.signOut({ authenticated: true });
    runtime.pump.authEvent('SIGNED_IN', userId, orgId);
    if (shared) {
      runtime.pump.setShared({
        ok: true,
        loading: false,
        pending: false,
        error: null,
        orgId,
        plan: 'Pro',
        entitlementStatus: 'active',
        canManageBilling: null,
        lastFetchedAt: 99990,
      }, 99990);
    }
    runtime.pump.run('render-auth-state');
    runtime.pump.advance(100);
    runtime.pump.run('org-context');
    return runtime;
  };

  const proToExpired = await exercise({ userId: 'expired-b', orgId: 'expired-org', local: true });
  assert.strictEqual(proToExpired.calls.length, 1, 'Pro A → sign-out → expired B performs one direct request');
  const expiredToPro = await exercise({ userId: 'pro-b', orgId: 'pro-org', shared: true });
  assert.strictEqual(expiredToPro.calls.length, 1,
    'expired A → sign-out → Pro B bypasses the provisional shared snapshot once');
  assert.strictEqual(expiredToPro.pump.snapshot().sharedApplyCount, 1,
    'shared Pro data remains available provisionally');
  const sameUser = await exercise({ userId: 'user-a', orgId: 'org-a', local: true });
  assert.strictEqual(sameUser.calls.length, 1, 'A → sign-out → A still performs one direct request');
  assert.deepStrictEqual(
    [proToExpired.calls[0].force, expiredToPro.calls[0].force, sameUser.calls[0].force],
    [true, true, true],
    'all post-sign-out directions are authoritative'
  );
});

test('BUG-01-AE production runtime rejects intermediate post-sign-out owners and recovers boundedly', async () => {
  const rapid = await createBillingPumpRuntimeHarness();
  rapid.pump.signOut({ authenticated: true });
  rapid.pump.authEvent('SIGNED_IN', 'user-b', 'org-b');
  const tokenB = rapid.pump.getAuthoritativeToken();
  assert.strictEqual(rapid.pump.beginAuthoritative(tokenB), true, 'intermediate B begins its owned request');
  rapid.pump.signOut({ authenticated: true });
  rapid.pump.authEvent('SIGNED_IN', 'user-a', 'org-a');
  assert.strictEqual(rapid.pump.completeAuthoritative(tokenB), false, 'late B cannot complete final A session');
  assert.strictEqual(rapid.pump.snapshot().authoritativeRequired.userId, 'user-a',
    'final A retains its own requirement');
  rapid.pump.run('render-auth-state');
  assert.strictEqual(rapid.calls.length, 1, 'only final A performs the completing direct request');
  assert.strictEqual(rapid.pump.snapshot().pending, false, 'final A success releases pending');

  const recovery = await createBillingPumpRuntimeHarness();
  recovery.pump.signOut({ authenticated: true });
  recovery.pump.authEvent('SIGNED_IN', 'user-b', 'org-b');
  recovery.pump.failNext();
  recovery.pump.run('render-auth-state');
  assert.strictEqual(recovery.calls.length, 1, 'post-sign-out failure makes one initial attempt');
  assert.ok(recovery.pump.snapshot().authoritativeRequired, 'failure keeps the authoritative requirement');
  assert.strictEqual(recovery.pump.snapshot().pending, true, 'failure remains fail-closed');
  recovery.pump.advance(100);
  recovery.pump.run('org-context');
  assert.strictEqual(recovery.calls.length, 1, 'ordinary recovery trigger is bounded by cooldown');
  recovery.pump.run('manual');
  assert.strictEqual(recovery.calls.length, 2, 'explicit recovery performs one later retry');
  assert.strictEqual(recovery.pump.snapshot().authoritativeRequired, null, 'successful retry clears the requirement');
  assert.strictEqual(recovery.pump.snapshot().pending, false, 'successful retry releases pending');
});

test('BUG-01-AH source contract bypasses only the per-reason cooldown for a new authoritative attempt', async () => {
  const src = await readAppSource();
  const pumpStart = src.indexOf('function maybeScheduleBillingRefresh(');
  const pumpEnd = src.indexOf('function handleOrgAccessLoss(', pumpStart);
  const pumpFn = src.slice(pumpStart, pumpEnd);

  assert.match(pumpFn,
    /const authoritativeRefresh = BillingService\.getBillingAuthoritativeRefreshToken\(activeOrgId\)/,
    'the scheduler resolves a current-user/current-org/current-epoch token before cooldown checks');
  assert.match(pumpFn,
    /authoritativeRefreshRequired && BillingService\.isBillingAuthoritativeRefreshInFlight\(authoritativeRefresh\)[\s\S]*return;/,
    'a matching in-flight generation exits before any second request can start');
  assert.match(pumpFn,
    /const authoritativeRefreshMustStart = Boolean\([\s\S]*authoritativeRefreshRequired && !authoritativeRefresh\.attemptedAt/,
    'only a new unattempted authoritative generation owns the immediate scheduler bypass');
  assert.match(pumpFn,
    /if \(!authoritativeRefreshMustStart && \(now - lastAt\) < BILLING_PUMP_COOLDOWN_MS\)/,
    'ordinary and already-attempted work retains the per-reason cooldown');
  assert.match(pumpFn,
    /refreshBilling\(\{[\s\S]*force: shouldForce,[\s\S]*authoritativeRefresh/,
    'the bypass reaches refreshBilling with force and the owned authoritative token');
});

test('BUG-01-AI production pump runtime lets a new authoritative generation bypass prior cooldown once', async () => {
  const runtime = await createBillingPumpRuntimeHarness();
  runtime.pump.seedOwnedState();
  runtime.pump.signOut({ authenticated: true });
  runtime.pump.authEvent('SIGNED_IN', 'final-user-a', 'org-a');

  runtime.pump.run('org-context');
  assert.strictEqual(runtime.calls.length, 1,
    'final A starts one direct request despite prior org-context cooldown history');
  assert.strictEqual(runtime.calls[0].force, true, 'the cooldown bypass is forced');
  assert.strictEqual(runtime.calls[0].authoritativeRefresh.userId, 'final-user-a',
    'the request belongs to the final authenticated user');
  assert.strictEqual(runtime.calls[0].authoritativeRefresh.orgId, 'org-a',
    'the request belongs to the final active organization');
  assert.strictEqual(runtime.pump.snapshot().authoritativeRequired, null,
    'matching direct success clears the final requirement');
  assert.strictEqual(runtime.pump.snapshot().pending, false,
    'matching direct success releases fail-closed pending state');
  assert.ok(runtime.logs.some(args => args[0] === '[BillingPump] bypass:authoritative-cooldown'),
    'the production scheduler records the narrow authoritative bypass');

  runtime.pump.advance(100);
  runtime.pump.run('org-context');
  assert.strictEqual(runtime.calls.length, 1,
    'after success, ordinary cooldown behavior prevents a duplicate loop');

  const ordinary = await createBillingPumpRuntimeHarness();
  ordinary.pump.seedOwnedState();
  ordinary.pump.run('org-context');
  assert.strictEqual(ordinary.calls.length, 0,
    'without an authoritative requirement the same five-second cooldown is unchanged');
});

test('BUG-01-I applyUserSwitchIsolation is the single authoritative isolation contract', async () => {
  const src = await readAppSource();

  const defCount = src.split('function applyUserSwitchIsolation(').length - 1;
  assert.strictEqual(defCount, 1, 'exactly one definition of applyUserSwitchIsolation');

  const fnStart = src.indexOf('function applyUserSwitchIsolation(');
  const fn = src.slice(fnStart, fnStart + 2200);

  // Flag first: nothing triggered synchronously by the clears below may promote
  // the stale localStorage org hint.
  const flagIdx = fn.indexOf('__TP3D_USER_SWITCH_PENDING = true');
  const billingIdx = fn.indexOf('clearBillingState()');
  assert.ok(flagIdx > 0, 'promotion-guard flag set inside the helper');
  assert.ok(billingIdx > flagIdx, 'flag is set BEFORE clearBillingState()');

  assert.match(fn, /clearBillingState\(\)/, 'billing state cleared (bumps billing epoch, fails gates closed)');
  assert.match(fn, /clearOrgContext\(\{ clearLocalOrgHint: true, confirmedNoOrg: false \}\)/, 'org context + local org hint cleared');
  assert.match(fn, /suspendAutoSave = true/, 'autosave suspended during app-state reset');
  assert.match(fn, /resetAppStateToEmpty\(\)/, 'in-memory app state reset (durable per-user storage untouched)');
  assert.match(fn, /resetAccountBundleCache\(/, 'account-bundle cache invalidated');
  assert.match(fn, /clearSidebarBillingDomForUserSwitch\(\)/, 'sidebar billing DOM cleared');
  assert.match(fn, /SettingsOverlay\.close\(\)/, 'settings overlay closed on identity transition');
  assert.match(fn, /AccountOverlay\.close\(\)/, 'account overlay closed on identity transition');
  assert.match(fn, /lastAuthUserId = null/, 'prior-user evidence cleared by the contract itself');
  assert.match(fn, /orgContextResolved = false/, 'org context marked unresolved');
});

test('BUG-01-J auth listener, renderAuthState, and rehydrateAuthState all use the same helper (no second cleanup contract)', async () => {
  const src = await readAppSource();

  const defIdx = src.indexOf('function applyUserSwitchIsolation(');
  assert.ok(defIdx >= 0, 'helper definition found');

  let callCount = 0;
  let from = 0;
  for (;;) {
    const idx = src.indexOf('applyUserSwitchIsolation(', from);
    if (idx === -1) break;
    from = idx + 1;
    if (idx === defIdx + 'function '.length) continue; // skip the definition itself
    callCount++;
  }
  assert.strictEqual(callCount, 3, 'exactly three call sites: listener, renderAuthState, rehydrateAuthState');

  assert.ok(src.includes("applyUserSwitchIsolation('SIGNED_IN_USER_SWITCH')"), 'auth listener user-switch path uses the helper');
  assert.ok(
    src.includes("applyUserSwitchIsolation(isUserSwitch ? 'SIGNED_IN_USER_SWITCH' : 'render-auth-state-user-switch')"),
    'renderAuthState guard uses the helper'
  );
  assert.ok(src.includes("applyUserSwitchIsolation('rehydrate-user-switch')"), 'rehydrateAuthState mismatch path uses the helper');

  // The old inline listener cleanup must not exist as a second contract.
  const listenerCallIdx = src.indexOf("applyUserSwitchIsolation('SIGNED_IN_USER_SWITCH')");
  const listenerCtx = src.slice(Math.max(0, listenerCallIdx - 260), listenerCallIdx);
  assert.match(listenerCtx, /if \(isUserSwitch\) \{/, 'listener call guarded by isUserSwitch');
  assert.ok(!listenerCtx.includes('clearBillingState()'), 'listener no longer duplicates an inline billing clear');
});

test('BUG-01-K rehydrateAuthState never erases prior-user evidence without full isolation', async () => {
  const src = await readAppSource();

  const fnStart = src.indexOf('async function rehydrateAuthState(');
  assert.ok(fnStart >= 0, 'rehydrateAuthState found');
  const helperDefIdx = src.indexOf('function applyUserSwitchIsolation(');
  const fnEnd = helperDefIdx > fnStart ? helperDefIdx : src.indexOf('async function renderAuthState(', fnStart);
  const fn = src.slice(fnStart, fnEnd);

  const mismatchIdx = fn.indexOf('String(lastAuthUserId) !== String(user.id)');
  assert.ok(mismatchIdx >= 0, 'identity-mismatch check present in rehydrateAuthState');
  const mismatchRegion = fn.slice(mismatchIdx, mismatchIdx + 700);
  assert.match(mismatchRegion, /applyUserSwitchIsolation\('rehydrate-user-switch'\)/, 'mismatch invokes the full isolation contract');
  assert.ok(!/lastAuthUserId = null/.test(mismatchRegion), 'no bare evidence erasure in the mismatch branch');
});

test('BUG-01-N delayed prior-user account bundles remain rejected by auth epoch/user protections', async () => {
  const supabaseClientUrl = new URL('../../src/core/supabase-client.js', import.meta.url);
  const src = await fs.readFile(supabaseClientUrl, 'utf8');

  // updateAuthState bumps the epoch whenever the user or token changes.
  assert.match(src, /const userChanged = prevUserId !== newUserId/, 'user change detected in updateAuthState');
  assert.match(src, /if \(userChanged \|\| tokenChanged\) \{\s*[\r\n]+\s*bumpAuthEpoch\(\)/, 'epoch bumped on user/token change');

  // The bundle single-flight re-checks the epoch after every await and rejects
  // cross-user results before building the bundle.
  const epochChecks = src.split('_authEpoch !== startEpoch').length - 1;
  assert.ok(epochChecks >= 3, `bundle re-checks epoch after awaits (found ${epochChecks})`);
  assert.match(src, /User changed during fetch/, 'cross-user bundle result canceled');
  assert.match(src, /_inflightAccount\.key === authKey && _inflightAccount\.epoch === startEpoch/, 'in-flight reuse requires same key AND same epoch');
});

test('WORKSPACE-HYDRATION-RACE authoritative same-workspace confirmation requests narrow live UI preservation', async () => {
  const runtime = await createOrgContextApplyRuntimeHarness({
    localOrgId: 'org-a',
    hasLoadedWorkspace: true,
    storageScope: 'user-a',
    workspaceScope: 'org-a',
    currentScreen: 'editor',
  });
  const org = { id: 'org-a', name: 'Workspace A', role: 'owner' };

  await runtime.apply({
    session: { access_token: 'redacted' },
    user: { id: 'user-a' },
    profile: { _isDefault: true, current_organization_id: org.id },
    membership: { organization_id: org.id, role: 'owner' },
    orgs: [org],
    activeOrgId: org.id,
    partial: false,
  });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(runtime.calls.__workspaceApplies)), [{
    orgId: 'org-a',
    options: { seedIfMissing: false, preserveLiveUi: true },
  }]);
  assert.deepStrictEqual(Array.from(runtime.calls.__workspaceResets), [],
    'same-workspace hydration does not run the real-boundary UI reset');
});

test('WORKSPACE-HYDRATION-RACE auth reset clears prior Pack, libraries, selection, and history', async () => {
  const runtime = await createLateWorkspaceHydrationRuntime({ withPriorHistory: true });
  runtime.reset();

  const state = runtime.snapshot();
  assert.equal(state.currentScreen, 'packs');
  assert.equal(state.currentPackId, null);
  assert.deepEqual(state.selectedInstanceIds, []);
  assert.deepEqual(state.caseLibrary, []);
  assert.deepEqual(state.packLibrary, []);
  assert.equal(runtime.undo(), false);
});

test('APP-STABILIZATION-PHASE4 logout finalizes once for event, missing-event, throw, and cross-tab paths', async () => {
  for (const mode of ['resolve', 'event', 'throw']) {
    const runtime = await createPhase4LogoutHarness(mode);
    await runtime.__run({ source: `phase4-${mode}` });
    assert.equal(runtime.__calls.signOuts, 1, `${mode} path calls canonical signOut once`);
    assert.equal(runtime.__calls.resets, 1, `${mode} path applies the local reset once`);
    assert.equal(runtime.__calls.cleanups.length, 1, `${mode} path runs canonical cleanup once`);
    assert.equal(runtime.__calls.cleanups[0].event, 'SIGNED_OUT');
    assert.equal(runtime.__calls.cleanups[0].treatAsSignedOut, true);
    assert.equal(runtime.__calls.cleanups[0].userInitiatedSignOut, true);
    assert.equal(runtime.__calls.signOutOptions.global, true);
    assert.equal(runtime.__calls.signOutOptions.allowOffline, true);
    assert.equal(runtime.__calls.signOutOptions.userInitiated, true);
  }

  const crossTab = await createPhase4LogoutHarness('resolve');
  assert.equal(crossTab.__finalize({ source: 'cross-tab', userInitiatedSignOut: false }), true);
  assert.equal(crossTab.__finalize({ source: 'cross-tab-duplicate', userInitiatedSignOut: false }), false);
  assert.equal(crossTab.__calls.resets, 1, 'duplicate cross-tab delivery does not repeat local reset');
  assert.equal(crossTab.__calls.cleanups.length, 1, 'duplicate cross-tab delivery does not repeat cleanup');
  assert.equal(crossTab.__calls.cleanups[0].userInitiatedSignOut, false,
    'standalone cross-tab sign-out remains non-user-initiated');

  const recovery = await createPhase4LogoutHarness('resolve');
  recovery.__cleanupFailuresRemaining = 1;
  assert.throws(
    () => recovery.__finalize({ source: 'first-delivery', userInitiatedSignOut: false }),
    /cleanup failed/,
    'a failed essential cleanup remains observable',
  );
  assert.equal(recovery.__finalize({ source: 'retry-delivery', userInitiatedSignOut: false }), true,
    'a later delivery can retry finalization after cleanup failure');
  assert.equal(recovery.__calls.cleanupAttempts, 2, 'cleanup is retried after the failed attempt');
  assert.equal(recovery.__calls.cleanups.length, 1, 'only the successful cleanup is finalized');
});

test('APP-STABILIZATION-PHASE4 logout source has no reload fallback and shares deterministic cleanup', async () => {
  const src = await readAppSource();
  const start = src.indexOf('let logoutActionPromise = null;');
  const end = src.indexOf('// Show small toasts on connectivity changes', start);
  const logoutBlock = src.slice(start, end);
  assert.ok(start >= 0 && end > start, 'logout source block is extractable');
  assert.doesNotMatch(logoutBlock, /logoutFallbackTimer|LOGOUT_FALLBACK_RELOAD_DELAY_MS|scheduleLogoutFallbackReload/,
    'timer fallback state and helper are removed');
  assert.doesNotMatch(logoutBlock, /setTimeout\(|location\.reload\(/,
    'logout source cannot schedule or force a reload');

  const finalizerStart = logoutBlock.indexOf('function finalizeSignedOutLocally(');
  const performStart = logoutBlock.indexOf('async function performUserInitiatedLogout(', finalizerStart);
  const listenerStart = logoutBlock.indexOf("window.addEventListener('tp3d:auth-signed-out'", performStart);
  const finalizer = logoutBlock.slice(finalizerStart, performStart);
  const perform = logoutBlock.slice(performStart, listenerStart);
  const listener = logoutBlock.slice(listenerStart);
  assert.match(finalizer, /applyPostLogoutLocalStateReset\(\)[\s\S]*_executeSignedOutCleanup\(\{\s*event,\s*treatAsSignedOut/,
    'one finalizer owns both local reset and canonical signed-out cleanup');
  assert.ok(finalizer.indexOf('_executeSignedOutCleanup({') < finalizer.indexOf('signedOutFinalized = true'),
    'finalization is marked complete only after essential cleanup succeeds');
  assert.match(perform, /SupabaseClient\.signOut\(\{ global: true, allowOffline: true, userInitiated: true \}\)[\s\S]*catch \(err\)[\s\S]*finalizeSignedOutLocally\(\{ source, userInitiatedSignOut: true \}\)/,
    'settled and thrown signOut paths converge on the shared finalizer');
  assert.match(listener, /const userInitiatedSignOut = isLogoutInProgress\(\);[\s\S]*finalizeSignedOutLocally\(\{[\s\S]*userInitiatedSignOut/,
    'custom event captures user intent before finalization releases the latch');
  assert.match(src, /if \(session && session\.access_token\) \{\s*if \(!isLogoutInProgress\(\) && !logoutActionPromise\) signedOutFinalized = false;/,
    'only an authenticated lifecycle outside the active logout action re-arms finalization');

  const renderStart = src.indexOf('async function renderAuthState(');
  const cleanupStart = src.indexOf('function _executeSignedOutCleanup(', renderStart);
  const renderAuth = src.slice(renderStart, cleanupStart);
  assert.equal((renderAuth.match(/finalizeSignedOutLocally\(\{/g) || []).length, 2,
    'immediate and stability-gated signed-out rendering share the same idempotence boundary');
  assert.doesNotMatch(renderAuth, /^\s*_executeSignedOutCleanup\(\{/m,
    'renderAuthState cannot bypass the shared signed-out finalizer');
});
