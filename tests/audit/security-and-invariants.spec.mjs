import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const billingServiceUrl = new URL('../../src/data/services/billing.service.js', import.meta.url);
const accountOverlayPath = new URL('../../src/ui/overlays/account-overlay.js', import.meta.url);
const appPath = new URL('../../src/app.js', import.meta.url);
const indexHtmlPath = new URL('../../index.html', import.meta.url);
const storagePath = new URL('../../src/core/storage.js', import.meta.url);
const importExportPath = new URL('../../src/services/import-export.js', import.meta.url);
const folderLibraryPath = new URL('../../src/services/folder-library.js', import.meta.url);
const packsScreenPath = new URL('../../src/screens/packs-screen.js', import.meta.url);
const stylesMainPath = new URL('../../styles/main.css', import.meta.url);
const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);
const normalizerPath = new URL('../../src/core/normalizer.js', import.meta.url);
const corsSharedPath = new URL('../../supabase/functions/_shared/cors.ts', import.meta.url);
const supabasePath = new URL('../../src/core/supabase-client.js', import.meta.url);
const authOverlayPath = new URL('../../src/ui/overlays/auth-overlay.js', import.meta.url);
const settingsOverlayPath = new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url);
const billingStatusPath = new URL('../../supabase/functions/billing-status/index.ts', import.meta.url);
const orgInvitePath = new URL('../../supabase/functions/org-invite/index.ts', import.meta.url);
const orgInviteRevokePath = new URL('../../supabase/functions/org-invite-revoke/index.ts', import.meta.url);
const orgInviteAcceptPath = new URL('../../supabase/functions/org-invite-accept/index.ts', import.meta.url);
const orgMemberRemovePath = new URL('../../supabase/functions/org-member-remove/index.ts', import.meta.url);
const orgTransferOwnershipPath = new URL('../../supabase/functions/org-transfer-ownership/index.ts', import.meta.url);
const orgLeaveWorkspacePath = new URL('../../supabase/functions/org-leave-workspace/index.ts', import.meta.url);
const orgArchiveWorkspacePath = new URL('../../supabase/functions/org-archive-workspace/index.ts', import.meta.url);
const orgRestoreWorkspacePath = new URL('../../supabase/functions/org-restore-workspace/index.ts', import.meta.url);
const deleteAccountPath = new URL('../../supabase/functions/delete-account/index.ts', import.meta.url);
const banUserPath = new URL('../../supabase/functions/ban-user/index.ts', import.meta.url);
const unbanUserPath = new URL('../../supabase/functions/unban-user/index.ts', import.meta.url);
const requestAccountDeletionPath = new URL('../../supabase/functions/request-account-deletion/index.ts', import.meta.url);
const cancelAccountDeletionPath = new URL('../../supabase/functions/cancel-account-deletion/index.ts', import.meta.url);
const purgeDeletedUsersPath = new URL('../../supabase/functions/purge-deleted-users/index.ts', import.meta.url);
const purgeDeletedAccountsPath = new URL('../../supabase/functions/purge-deleted-accounts/index.ts', import.meta.url);
const supabaseConfigPath = new URL('../../supabase/config.toml', import.meta.url);
const supabaseFunctionsDir = new URL('../../supabase/functions/', import.meta.url);
const orgInviteExpirationMigrationPath = new URL(
  '../../supabase/migrations/2026050501_organization_invites_expiration.sql',
  import.meta.url
);
const orgArchiveMigrationPath = new URL(
  '../../supabase/migrations/2026050701_organization_archive.sql',
  import.meta.url
);
const signupAutoOrgUuidMigrationPath = new URL(
  '../../supabase/migrations/2026050601_fix_signup_auto_org_uuid.sql',
  import.meta.url
);
const orgMemberAdminDeleteGuardMigrationPath = new URL(
  '../../supabase/migrations/2026050702_org_member_admin_delete_guard.sql',
  import.meta.url
);
const transferOwnershipMigrationPath = new URL(
  '../../supabase/migrations/2026050801_transfer_ownership_fn.sql',
  import.meta.url
);
const transferOwnershipLiveFixMigrationPath = new URL(
  '../../supabase/migrations/2026050802_transfer_ownership_live_schema_fix.sql',
  import.meta.url
);
const restoreWorkspaceMigrationPath = new URL(
  '../../supabase/migrations/2026050803_restore_workspace.sql',
  import.meta.url
);
const accountPurgeStatusMigrationPath = new URL(
  '../../supabase/migrations/2026050804_account_purge_status.sql',
  import.meta.url
);

async function readFunctionSources(dirUrl = supabaseFunctionsDir) {
  const entries = await fs.readdir(dirUrl, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
    if (entry.isDirectory()) {
      sources.push(...await readFunctionSources(childUrl));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      sources.push([childUrl.pathname, await fs.readFile(childUrl, 'utf8')]);
    }
  }
  return sources;
}

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

test('phase 0.6D-pre edge functions contain no literal wildcard CORS header', async () => {
  const sources = await readFunctionSources();
  for (const [filePath, source] of sources) {
    assert.doesNotMatch(source, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/,
      `${filePath} must not contain literal wildcard CORS`);
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
  const src = await fs.readFile(appPath, 'utf8');
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
  const appSrc = await fs.readFile(appPath, 'utf8');
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

test('phase 0.6D-pre org-member-remove blocks admin actors removing admin targets', async () => {
  const src = await fs.readFile(orgMemberRemovePath, 'utf8');
  const targetRoleIndex = src.indexOf('const targetRole = target.role;');
  const adminGuardIndex = src.indexOf('Only workspace owners can remove admins.');
  const deleteIndex = src.indexOf('.from("organization_members")', adminGuardIndex);

  assert.ok(targetRoleIndex >= 0, 'org-member-remove must load target role before removal checks');
  assert.ok(adminGuardIndex > targetRoleIndex,
    'org-member-remove must check admin target removal after target membership is loaded');
  assert.ok(deleteIndex > adminGuardIndex,
    'org-member-remove must reject admin-on-admin removal before any delete');
  assert.match(src, /if \(targetRole === "admin" && actor\.role !== "owner"\) \{[\s\S]*Only workspace owners can remove admins\.[\s\S]*status: 403/,
    'non-owner actors must receive 403 when removing an admin target');
  assert.match(src, /if \(targetRole === "owner"\) \{[\s\S]*Only owners can remove owners\./,
    'owner removal guard must remain intact');
});

test('phase 0.6D-pre org member delete policy lets admins delete members only', async () => {
  const src = await fs.readFile(orgMemberAdminDeleteGuardMigrationPath, 'utf8');

  assert.match(src, /drop policy if exists "org_members_delete_owner_admin" on public\.organization_members;/,
    'migration must replace the existing delete policy');
  assert.match(src, /create policy "org_members_delete_owner_admin"[\s\S]*for delete/,
    'migration must recreate the delete policy');
  assert.match(src, /public\.tp3d_is_org_owner\(organization_id\)[\s\S]*public\.tp3d_org_owner_count_excluding\(organization_id, user_id\) >= 1/,
    'owner branch and last-owner protection must remain');
  assert.match(src, /public\.tp3d_is_org_admin\(organization_id\)[\s\S]*role = 'member'::public\.org_member_role/,
    'admin branch must be limited to deleting member rows');
  assert.doesNotMatch(src, /public\.tp3d_is_org_admin\(organization_id\)[\s\S]{0,120}role <> 'owner'::public\.org_member_role/,
    'admin branch must not allow deleting all non-owner rows');
});

test('phase 0.6D-pre admin removal guard avoids billing workspace and data scope creep', async () => {
  const removeSrc = await fs.readFile(orgMemberRemovePath, 'utf8');
  const migrationSrc = await fs.readFile(orgMemberAdminDeleteGuardMigrationPath, 'utf8');
  const combined = `${removeSrc}\n${migrationSrc}`;

  assert.doesNotMatch(combined, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'admin removal guard must not touch billing or Stripe scope');
  assert.doesNotMatch(combined, /\.from\(["']organizations["']\)[\s\S]{0,120}\.delete\(|delete\s+from\s+public\.organizations/i,
    'admin removal guard must not delete organizations');
  assert.doesNotMatch(combined, /\.from\(["']organization_invites["']\)|delete\s+from\s+public\.organization_invites/i,
    'admin removal guard must not mutate invites');
  assert.doesNotMatch(combined, /\.from\(["'](?:packs|cases)["']\)|delete\s+from\s+public\.(?:packs|cases)|storage\.from/i,
    'admin removal guard must not mutate packs, cases, or storage');
});

test('phase 0.6D-pre billing-status treats archived resolved org as unavailable', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const activeLookupStart = src.indexOf('const activeOrgRes = await admin');
  const ownerWorkspaceStart = src.indexOf('const ownerMembershipsRes = await admin', activeLookupStart);
  const activeLookup = activeLookupStart >= 0 && ownerWorkspaceStart > activeLookupStart
    ? src.slice(activeLookupStart, ownerWorkspaceStart)
    : '';

  assert.ok(activeLookup, 'billing-status active organization lookup block must be extractable');
  assert.match(activeLookup, /\.from\("organizations"\)[\s\S]*\.select\("id, owner_id, created_at, archived_at"\)/,
    'billing-status must read archived_at for the resolved organization');
  assert.match(activeLookup, /const archivedAt = activeOrgRes\.data\?\.archived_at \? String\(activeOrgRes\.data\.archived_at\) : ""/,
    'billing-status must detect archived resolved organizations');
  assert.match(activeLookup, /if \(archivedAt\) \{[\s\S]*archived: true[\s\S]*entitlementStatus: "billing_unavailable"[\s\S]*workspaceIncluded: false[\s\S]*isActive: false[\s\S]*isPro: false/,
    'archived resolved organizations must return a safe inactive billing response');
});

test('phase 0.6D-pre billing-status keeps archived workspaces counted toward limits', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const ownerWorkspacesStart = src.indexOf('const ownerWorkspacesRes = await admin');
  const ownerWorkspacesEnd = src.indexOf('workspaceCount = ownerWorkspaces.length;', ownerWorkspacesStart);
  const ownerWorkspaceBlock = ownerWorkspacesStart >= 0 && ownerWorkspacesEnd > ownerWorkspacesStart
    ? src.slice(ownerWorkspacesStart, ownerWorkspacesEnd)
    : '';

  assert.ok(ownerWorkspaceBlock, 'owner workspace count block must be extractable');
  assert.match(ownerWorkspaceBlock, /\.from\("organizations"\)[\s\S]*\.select\("id, created_at"\)[\s\S]*\.eq\("owner_id", billingOwnerUserId\)[\s\S]*\.in\("id", ownerMembershipOrgIds\)/,
    'owner workspace count must still count owner organization rows from memberships');
  assert.doesNotMatch(ownerWorkspaceBlock, /archived_at|\.is\(["']archived_at["']|\.not\(["']archived_at["']/,
    'owner workspace count must not silently exclude archived workspaces');
});

test('phase 0.6D-pre billing-status archived guard avoids Stripe checkout portal webhook scope creep', async () => {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const activeLookupStart = src.indexOf('const activeOrgRes = await admin');
  const ownerWorkspaceStart = src.indexOf('const ownerMembershipsRes = await admin', activeLookupStart);
  const activeLookup = activeLookupStart >= 0 && ownerWorkspaceStart > activeLookupStart
    ? src.slice(activeLookupStart, ownerWorkspaceStart)
    : '';

  assert.ok(activeLookup, 'billing-status archived guard block must be extractable');
  assert.doesNotMatch(activeLookup, /stripeClient|checkout|webhook|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'archived active-org guard must not add Stripe, checkout, portal, webhook, or billing table scope');
  assert.doesNotMatch(activeLookup, /portalAvailable:\s*true|createBillingPortal|portalUrl/i,
    'archived active-org guard must not enable billing portal behavior');
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

test('phase 0.6A does not introduce restore transfer delete or export workspace flows', async () => {
  const edgeSrc = await fs.readFile(orgLeaveWorkspacePath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const appSrc = await fs.readFile(appPath, 'utf8');
  const appStart = appSrc.indexOf('function handleWorkspaceLeft(leftOrgId, options = {})');
  const appEnd = appSrc.indexOf('// Expose billing pump globally', appStart);
  const helper = appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : '';
  const settingsStart = settingsSrc.indexOf('async function leaveWorkspace(orgId, orgName)');
  const settingsEnd = settingsSrc.indexOf('async function restoreArchivedWorkspace(orgId, orgName)', settingsStart);
  const settingsHandler = settingsStart >= 0 && settingsEnd > settingsStart
    ? settingsSrc.slice(settingsStart, settingsEnd)
    : '';

  for (const [label, src] of [
    ['org-leave-workspace', edgeSrc],
    ['handleWorkspaceLeft', helper],
    ['settings leaveWorkspace', settingsHandler],
  ]) {
    assert.doesNotMatch(src, /restoreWorkspace|transferOwnership|deleteWorkspace|exportWorkspace/,
      `${label} must not add restore/transfer/delete/export flows beyond Leave Workspace`);
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
  assert.match(displayFn, /orgInitials: noActiveWorkspace \? '' : getActiveWorkspaceInitials\(\)/,
    'AccountSwitcher display object must expose workspace-derived initials when an active workspace exists');
  assert.match(displayFn, /userName: noActiveWorkspace \? 'Create or join' : displayName \|\| '—'/,
    'AccountSwitcher must keep the secondary user/account display label for active workspace states');
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

test('phase 0.6B org-invite-revoke loads invite before update and verifies actor role for invite org', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');
  const loadIdx = src.indexOf('const invite = await getInvite(sb, inviteId)');
  const updateIdx = src.indexOf('.update({ status: "revoked", revoked_at: nowIso })');

  assert.match(src, /function getInvite\b[\s\S]*\.from\("organization_invites"\)[\s\S]*\.select\("id, organization_id, role, status, accepted_at, revoked_at"\)/,
    'invite revoke must load the invite row before authorizing or updating');
  assert.ok(loadIdx > 0 && updateIdx > loadIdx,
    'invite revoke must load invite details before issuing the revoke update');
  assert.match(src, /function getActorRole\b[\s\S]*\.from\("organization_members"\)[\s\S]*\.eq\("organization_id", orgId\)[\s\S]*\.eq\("user_id", userId\)/,
    'invite revoke must verify owner/admin membership for the invite organization');
  assert.match(src, /Only workspace owners\/admins can revoke invites\./,
    'non-manager actors must be rejected');
});

test('phase 0.6B org-invite-revoke enforces owner/admin invite role rules', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');

  assert.match(src, /const MANAGER_ROLES = new Set\(\["owner", "admin"\]\)/,
    'owners and admins are the only manager roles');
  assert.match(src, /const REVOKABLE_INVITE_ROLES = new Set\(\["admin", "member"\]\)/,
    'only admin/member invite roles are normal revocation targets');
  assert.match(src, /if \(inviteRole === "owner"\)[\s\S]*Owner-role invite rows are invalid and cannot be revoked\./,
    'legacy owner-role invite rows must be rejected');
  assert.match(src, /if \(actorRole === "admin" && inviteRole !== "member"\)[\s\S]*Only workspace owners can revoke admin invites\./,
    'admins must only be able to revoke member invites');
});

test('phase 0.6B org-invite-revoke blocks accepted invites and makes already revoked idempotent', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');

  assert.match(src, /if \(invite\.status === "accepted" \|\| invite\.accepted_at\)[\s\S]*Accepted invites cannot be revoked\./,
    'accepted invites must return a safe conflict instead of being revoked');
  assert.match(src, /if \(invite\.status === "revoked" \|\| invite\.revoked_at\)[\s\S]*already_revoked: true[\s\S]*invite_id: invite\.id/,
    'already revoked invites must return idempotent success');
  assert.match(src, /if \(invite\.status !== "pending"\)[\s\S]*Only pending invites can be revoked\./,
    'non-pending invite states must not be revoked as a normal path');
});

test('phase 0.6B org-invite-revoke updates revoked_at and status without deleting rows or touching billing', async () => {
  const src = await fs.readFile(orgInviteRevokePath, 'utf8');
  const actorStart = src.indexOf('async function getActorRole');
  const actorEnd = src.indexOf('async function getInvite', actorStart);
  const actorHelper = actorStart >= 0 && actorEnd > actorStart ? src.slice(actorStart, actorEnd) : '';

  assert.match(src, /\.from\("organization_invites"\)[\s\S]*\.update\(\{ status: "revoked", revoked_at: nowIso \}\)/,
    'invite revoke must set revoked_at and status=revoked');
  assert.doesNotMatch(src, /\.from\("organization_invites"\)[\s\S]*\.delete\(\)/,
    'invite revoke must not delete invite rows');
  assert.doesNotMatch(src, /\.from\("organizations"\)[\s\S]*\.delete\(\)/,
    'invite revoke must not delete organizations');
  assert.doesNotMatch(actorHelper, /\.(insert|update|upsert|delete)\(/,
    'invite revoke must not mutate organization_members');
  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events|stripe|checkout|portal|billing-status/i,
    'invite revoke must not reference Stripe, billing-status, or billing tables');
});

test('phase 0.6B billing service uses org-invite-revoke edge function and direct browser revoke is disabled', async () => {
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const supabaseSrc = await fs.readFile(supabasePath, 'utf8');

  assert.match(billingSrc, /export async function revokeOrgInvite\(inviteId, orgId = ''\)/,
    'billing service must export revokeOrgInvite');
  assert.match(billingSrc, /postFn\('\/org-invite-revoke', payload\)/,
    'revokeOrgInvite must POST to the revoke Edge Function');
  assert.match(billingSrc, /payload\.organization_id = orgId/,
    'revokeOrgInvite must include optional organization_id');
  assert.match(billingSrc, /already_revoked: Boolean\(data && data\.already_revoked\)/,
    'revokeOrgInvite must preserve idempotent already_revoked state');
  assert.match(supabaseSrc, /Direct invite revocation is disabled\. Use the org-invite-revoke Edge Function\./,
    'legacy Supabase client direct revoke must be disabled');
  assert.doesNotMatch(supabaseSrc, /function revokeOrganizationInvite[\s\S]*\.from\('organization_invites'\)[\s\S]*\.update\(/,
    'legacy browser client revoke must not update organization_invites directly');
});

test('phase 0.6B settings revoke keeps confirm modal and calls edge service wrapper', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('async function revokeInvite(orgId, invite)');
  const end = src.indexOf('async function resendInvite(orgId, invite)', start);
  const handler = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(src, /revokeOrgInvite as revokeOrgInviteFn/,
    'settings overlay must import the Edge Function revoke wrapper');
  assert.match(handler, /revokeOrgInviteFn\(inviteId, orgId\)/,
    'settings revoke handler must call the new service wrapper');
  assert.doesNotMatch(handler, /SupabaseClient\.revokeOrganizationInvite/,
    'settings revoke handler must not use direct browser DB update');
  assert.match(handler, /await loadOrgInvites\(orgId\)/,
    'settings revoke success must refresh pending invites');
  assert.match(src, /UIComponents\.confirm\(\{[\s\S]*title: 'Revoke invite'[\s\S]*danger: true/,
    'pending invite revoke must keep UIComponents.confirm with danger styling');
  assert.doesNotMatch(src, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native browser dialogs');
});

test('phase 0.6B does not introduce unrelated workspace lifecycle or billing code', async () => {
  const edgeSrc = await fs.readFile(orgInviteRevokePath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const revokeStart = settingsSrc.indexOf('async function revokeInvite(orgId, invite)');
  const revokeEnd = settingsSrc.indexOf('async function resendInvite(orgId, invite)', revokeStart);
  const settingsHandler = revokeStart >= 0 && revokeEnd > revokeStart ? settingsSrc.slice(revokeStart, revokeEnd) : '';
  const serviceStart = billingSrc.indexOf('export async function revokeOrgInvite');
  const serviceEnd = billingSrc.indexOf('/**', serviceStart + 1);
  const serviceHandler = serviceStart >= 0 && serviceEnd > serviceStart ? billingSrc.slice(serviceStart, serviceEnd) : '';

  for (const [label, src] of [
    ['org-invite-revoke', edgeSrc],
    ['settings revokeInvite', settingsHandler],
    ['billing service revokeOrgInvite', serviceHandler],
  ]) {
    assert.doesNotMatch(src, /restoreWorkspace|transferOwnership|deleteWorkspace|exportWorkspace/,
      `${label} must not add restore/transfer/delete/export workspace flows`);
    assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events|checkout|portal|billing-status/i,
      `${label} must not add billing or Stripe behavior`);
  }
});

test('phase 0.6B-2 settings stable key uses pending-only invite state for revoke repaint', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const stableStart = src.indexOf('function _buildRenderStableKey()');
  const stableEnd = src.indexOf("} else if (tab === 'org-billing')", stableStart);
  const stableFn = stableStart >= 0 && stableEnd > stableStart ? src.slice(stableStart, stableEnd) : '';

  assert.match(stableFn, /const pendingInviteRenderRows = Array\.isArray\(orgInvitesData\)[\s\S]*String\(invite\.status \|\| ''\)\.toLowerCase\(\) === 'pending'/,
    'org-members stable key must derive invite state from pending invites only');
  assert.match(stableFn, /invitesCount: pendingInviteRenderRows\.length/,
    'stable key invite count must use pending-only rows');
  assert.match(stableFn, /invitesSignature: pendingInviteRenderRows[\s\S]*String\(invite\.id \|\| ''\)[\s\S]*String\(invite\.role \|\| 'member'\)\.toLowerCase\(\)[\s\S]*String\(invite\.status \|\| ''\)\.toLowerCase\(\)/,
    'stable key must include pending invite id, role, and status signature');
  assert.doesNotMatch(stableFn, /invitesCount:\s*Array\.isArray\(orgInvitesData\)\s*\?\s*orgInvitesData\.length\s*:\s*0/,
    'stable key must not use total all-status invite rows because revoked rows remain in orgInvitesData');
});

test('phase 0.6B-2 settings stable key includes invite action state for busy cleanup repaint', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const stableStart = src.indexOf('function _buildRenderStableKey()');
  const stableEnd = src.indexOf("} else if (tab === 'org-billing')", stableStart);
  const stableFn = stableStart >= 0 && stableEnd > stableStart ? src.slice(stableStart, stableEnd) : '';

  assert.match(stableFn, /inviteActions: orgInviteActions\.size/,
    'org-members stable key must include invite action state so revoke begin/done can repaint');
});

test('phase 0.6B-2 admins can see pending admin invites because pending list is not role-filtered', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const pendingStart = src.indexOf('const pendingInvites = hasInvitesForOrg');
  const pendingEnd = src.indexOf('if (isLoadingOrgInvites', pendingStart);
  const pendingSnippet = pendingStart >= 0 && pendingEnd > pendingStart ? src.slice(pendingStart, pendingEnd) : '';

  assert.match(pendingSnippet, /orgInvitesData\.filter\(i => i && i\.status === 'pending'\)/,
    'pending invite list should filter by pending status only');
  assert.doesNotMatch(pendingSnippet, /role|admin|member/,
    'pending invite list must not hide admin invite rows from admin users');
});

test('phase 0.6B-2 admin-on-admin invite actions are disabled with owner-only copy', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const loopStart = src.indexOf('pendingInvites.forEach(invite =>');
  const loopEnd = src.indexOf('inviteRows.push(tr)', loopStart);
  const rowRender = loopStart >= 0 && loopEnd > loopStart ? src.slice(loopStart, loopEnd) : '';

  assert.match(rowRender, /const inviteRole = String\(invite\.role \|\| 'member'\)\.toLowerCase\(\)/,
    'row render must normalize invite role once');
  assert.match(rowRender, /const adminInviteActionBlocked = !canManageAdmins && inviteRole === 'admin'/,
    'admin actors must be blocked from managing admin invite rows');
  assert.match(rowRender, /Only workspace owners can manage admin invites\./,
    'disabled admin invite controls must explain the owner-only rule');
  assert.match(rowRender, /resendBtn\.disabled = isBusyInvite \|\| inviteControlsDisabled \|\| adminInviteActionBlocked/,
    'admin-on-admin Resend must be disabled');
  assert.match(rowRender, /revokeBtn\.disabled = isBusyInvite \|\| inviteControlsDisabled \|\| adminInviteActionBlocked/,
    'admin-on-admin Revoke must be disabled');
  assert.match(rowRender, /if \(adminInviteActionBlocked\) return;[\s\S]*resendInvite\(orgId, invite\)/,
    'Resend click handler must guard admin-on-admin action');
  assert.match(rowRender, /if \(adminInviteActionBlocked\) return;[\s\S]*UIComponents\.confirm\(/,
    'Revoke click handler must guard admin-on-admin action before confirmation');
});

test('phase 0.6B-2 keeps revoke modal edge path and avoids native/direct revoke regressions', async () => {
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const supabaseSrc = await fs.readFile(supabasePath, 'utf8');
  const revokeStart = settingsSrc.indexOf('async function revokeInvite(orgId, invite)');
  const revokeEnd = settingsSrc.indexOf('async function resendInvite(orgId, invite)', revokeStart);
  const revokeHandler = revokeStart >= 0 && revokeEnd > revokeStart ? settingsSrc.slice(revokeStart, revokeEnd) : '';

  assert.match(settingsSrc, /UIComponents\.confirm\(\{[\s\S]*title: 'Revoke invite'[\s\S]*danger: true/,
    'allowed revoke paths must keep the existing danger confirm modal');
  assert.doesNotMatch(settingsSrc, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native dialogs');
  assert.match(revokeHandler, /revokeOrgInviteFn\(inviteId, orgId\)/,
    'revoke handler must keep using the Edge Function service wrapper');
  assert.doesNotMatch(revokeHandler, /SupabaseClient\.revokeOrganizationInvite/,
    'revoke handler must not call the legacy direct browser revoke function');
  assert.doesNotMatch(supabaseSrc, /function revokeOrganizationInvite[\s\S]*\.from\('organization_invites'\)[\s\S]*\.update\(/,
    'direct Supabase browser-side invite revoke mutation must not be reintroduced');
  assert.doesNotMatch(revokeHandler, /billing_customers|subscriptions|stripe_customers|webhook_events|billing-status|stripe|checkout|portal/i,
    'Phase 0.6B-2 revoke changes must not add Stripe or billing behavior');
});

test('phase 0.6C migration adds archived_at, index, direct-client guard, and active-org RPC filter', async () => {
  const src = await fs.readFile(orgArchiveMigrationPath, 'utf8');

  assert.match(src, /add column if not exists archived_at timestamptz/,
    'archive migration must add organizations.archived_at');
  assert.match(src, /create index if not exists organizations_archived_at_idx[\s\S]*on public\.organizations\(archived_at\)[\s\S]*where archived_at is not null/,
    'archive migration must index archived workspace rows');
  assert.match(src, /create or replace function public\.tp3d_guard_organizations_archived_at_update\(\)/,
    'archive migration must install an archived_at guard function');
  assert.match(src, /before update of archived_at on public\.organizations/,
    'archive migration must protect archived_at from generic organization updates');
  assert.match(src, /v_request_role <> 'service_role' and current_user <> 'service_role'/,
    'archive guard must allow the service-role Edge Function while blocking direct client updates');
  assert.match(src, /drop function if exists public\.get_user_organizations\(\);[\s\S]*create function public\.get_user_organizations\(\)[\s\S]*and o\.archived_at is null/,
    'account bundle RPC must hide archived workspaces from normal active lists');
});

test('phase 0.6C org-archive-workspace edge function is owner-only and idempotent', async () => {
  const src = await fs.readFile(orgArchiveWorkspacePath, 'utf8');

  assert.ok(src.length > 0, 'org-archive-workspace/index.ts must exist');
  assert.match(src, /if \(req\.method !== "POST"\)/,
    'archive workspace must require POST');
  assert.match(src, /requireUser\(req\)/,
    'archive workspace must require auth');
  assert.match(src, /body\.organization_id \|\| body\.org_id/,
    'archive workspace must accept organization_id with org_id fallback');
  assert.match(src, /\.from\("organizations"\)[\s\S]*\.select\("id, owner_id, archived_at"\)/,
    'archive workspace must load the organization before update');
  assert.match(src, /org\.owner_id !== auth\.user\.id/,
    'archive workspace must use organizations.owner_id as the primary-owner authority');
  assert.match(src, /already_archived: true/,
    'archive workspace must be idempotent when already archived');
  assert.match(src, /\.from\("organizations"\)[\s\S]*\.update\(\{ archived_at: nowIso \}\)[\s\S]*\.eq\("owner_id", auth\.user\.id\)/,
    'archive workspace must update only archived_at and keep an owner_id race guard');
  assert.match(src, /organization_id:[\s\S]*archived_at:/,
    'archive workspace must return organization_id and archived_at');
});

test('phase 0.6C archive edge function preserves data and avoids billing or Stripe scope', async () => {
  const src = await fs.readFile(orgArchiveWorkspacePath, 'utf8');

  assert.doesNotMatch(src, /\.delete\(\)/,
    'archive workspace must not delete any rows');
  assert.doesNotMatch(src, /organization_members|organization_invites|packs|cases|preferences|storage/i,
    'archive workspace must not mutate memberships, invites, packs, cases, preferences, or storage');
  assert.doesNotMatch(src, /billing_customers|subscriptions|stripe_customers|webhook_events|billing-status|stripe|checkout|portal/i,
    'archive workspace must not reference Stripe, billing-status, or billing tables');
});

test('phase 0.6C billing service exports archiveWorkspace edge wrapper', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(src, /export async function archiveWorkspace\(orgId\)/,
    'billing service must export archiveWorkspace');
  assert.match(src, /postFn\('\/org-archive-workspace'[\s\S]*organization_id: orgId/,
    'archiveWorkspace must POST organization_id to /org-archive-workspace');
  assert.match(src, /already_archived: Boolean\(data && data\.already_archived\)/,
    'archiveWorkspace must preserve idempotent already_archived state');
  assert.doesNotMatch(src, /archiveWorkspace[\s\S]*billing_customers|archiveWorkspace[\s\S]*subscriptions|archiveWorkspace[\s\S]*stripe/i,
    'archiveWorkspace wrapper must not add billing or Stripe behavior');
});

test('phase 0.6C Supabase client hides archived workspaces and disables direct archive mutation', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');

  assert.match(src, /const isActiveOrgRow = org => Boolean\(org && !org\.archived_at\)/,
    'getUserOrganizations must define an active-org safety filter');
  assert.match(src, /client\.rpc\('get_user_organizations'\)[\s\S]*return data\.filter\(isActiveOrgRow\)/,
    'RPC org rows must be client-side filtered as a safety net');
  assert.match(src, /organizations \([\s\S]*archived_at[\s\S]*\)/,
    'fallback organization join must include archived_at');
  assert.match(src, /\.filter\(isActiveOrgRow\)/,
    'fallback organization rows must exclude archived workspaces');
  assert.match(src, /export async function archiveOrganization\(\)[\s\S]*Direct workspace archiving is disabled\. Use the org-archive-workspace Edge Function\./,
    'direct browser-side archive mutation must be disabled');
  assert.match(src, /hasOwnProperty\.call\(updates \|\| \{\}, 'archived_at'\)[\s\S]*Direct workspace archive updates are disabled/,
    'generic organization profile updates must reject archived_at client-side');
});

test('phase 0.6D-pre Supabase client rejects direct ownership transfer updates', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function updateOrganization(orgId, updates)');
  const end = src.indexOf('/**\n * Upload a user avatar', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'updateOrganization must be extractable');
  assert.match(fn, /hasOwnProperty\.call\(updates \|\| \{\}, 'archived_at'\)[\s\S]*Direct workspace archive updates are disabled/,
    'updateOrganization must keep rejecting archived_at');
  assert.match(fn, /hasOwnProperty\.call\(updates \|\| \{\}, 'owner_id'\)[\s\S]*Direct ownership transfer is disabled\. Use the org-transfer-ownership Edge Function\./,
    'updateOrganization must reject owner_id ownership transfer fields');
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

test('phase 0.6D-pre direct client mutation guards avoid lifecycle billing and reload scope creep', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const profileStart = src.indexOf('export async function updateProfile(updates)');
  const profileEnd = src.indexOf('export async function getUserOrganizations()', profileStart);
  const orgStart = src.indexOf('export async function updateOrganization(orgId, updates)');
  const orgEnd = src.indexOf('/**\n * Upload a user avatar', orgStart);
  const snippets = [
    profileStart >= 0 && profileEnd > profileStart ? src.slice(profileStart, profileEnd) : '',
    orgStart >= 0 && orgEnd > orgStart ? src.slice(orgStart, orgEnd) : '',
  ].join('\n');

  assert.ok(snippets.trim(), 'direct mutation guard snippets must be extractable');
  assert.doesNotMatch(snippets, /signOut|forceLocalSignedOut|location\.reload|window\.location/i,
    'direct client mutation guards must not sign out or reload');
  assert.doesNotMatch(snippets, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
    'direct client mutation guards must not touch billing or Stripe scope');
  assert.doesNotMatch(snippets, /org-transfer-ownership[\s\S]*postFn|request-account-deletion[\s\S]*postFn|archiveWorkspace|restoreWorkspace/i,
    'direct client mutation guards must not introduce lifecycle flow calls');
});

test('phase 0.6C app exposes handleWorkspaceArchived and refreshes org context without logout or reload', async () => {
  const src = await fs.readFile(appPath, 'utf8');
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

test('phase 0.6C Settings Archive UI is primary-owner-only and uses safe confirm flow', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const handlerStart = src.indexOf('async function archiveWorkspace(orgId, orgName)');
  const handlerEnd = src.indexOf('// ---- Organization invites ----', handlerStart);
  const handler = handlerStart >= 0 && handlerEnd > handlerStart ? src.slice(handlerStart, handlerEnd) : '';

  assert.match(src, /archiveWorkspace as archiveWorkspaceFn/,
    'settings overlay must import archiveWorkspace service wrapper');
  assert.match(src, /let _archiveWorkspaceInFlight = false/,
    'settings overlay must guard archive double clicks');
  assert.match(handler, /archiveWorkspaceFn\(normalizedOrgId\)/,
    'settings archive handler must call the Edge Function wrapper');
  assert.match(handler, /TruckPackerApp\.handleWorkspaceArchived\(normalizedOrgId, \{ source: 'settings-archive-workspace' \}\)/,
    'settings archive success must hand off active org recovery to the app helper');
  assert.match(src, /if \(isPrimaryOwner\) \{[\s\S]*Archive Workspace[\s\S]*UIComponents\.confirm\(\{[\s\S]*title: 'Archive Workspace'[\s\S]*danger: true/,
    'Archive Workspace UI must be gated to primary owner and use UIComponents.confirm');
  assert.match(src, /Workspace data, members, invites, and billing records are preserved\. Stripe billing is not canceled\./,
    'archive confirmation copy must explicitly preserve data and Stripe billing');
  assert.doesNotMatch(src, /window\.alert|window\.confirm|window\.prompt/,
    'settings overlay must not use native dialogs');
});

test('phase 0.6C does not add restore transfer permanent delete billing-status Stripe CSS router or package scope', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const appStart = appSrc.indexOf('function handleWorkspaceArchived(archivedOrgId, options = {})');
  const appEnd = appSrc.indexOf('// Expose billing pump globally', appStart);
  const settingsStart = settingsSrc.indexOf('async function archiveWorkspace(orgId, orgName)');
  const settingsEnd = settingsSrc.indexOf('// ---- Organization invites ----', settingsStart);
  const billingStart = billingSrc.indexOf('export async function archiveWorkspace(orgId)');
  const sources = [
    ['handleWorkspaceArchived', appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : ''],
    ['settings archiveWorkspace', settingsStart >= 0 && settingsEnd > settingsStart ? settingsSrc.slice(settingsStart, settingsEnd) : ''],
    ['billing service archiveWorkspace', billingStart >= 0 ? billingSrc.slice(billingStart) : ''],
    ['org-archive-workspace', await fs.readFile(orgArchiveWorkspacePath, 'utf8')],
  ];

  for (const [label, src] of sources) {
    assert.doesNotMatch(src, /restoreWorkspace|transferOwnership|permanentDelete|deleteWorkspace|exportWorkspace/,
      `${label} must not introduce restore/transfer/delete/export lifecycle actions`);
    assert.doesNotMatch(src, /billing-status|stripe-create-checkout|stripe-create-portal|stripe-webhook/i,
      `${label} must not touch billing-status or Stripe functions`);
  }
});

test('phase 0.6C-2 account bundle treats fresh empty active org list as authoritative', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /getUserOrganizations\(\)\.catch\(\(\) => null\)/,
    'org fetch errors must be represented as null so an empty array stays authoritative');
  assert.match(bundleFn, /ACCOUNT_FETCH_TIMEOUT_MS,\s*null\s*\)/,
    'org fetch timeout fallback must be null, not an empty array that looks successful');
  assert.doesNotMatch(bundleFn, /orgsResult\.length === 0/,
    'account bundle must not treat an authoritative empty org list as a cache miss');
  assert.match(bundleFn, /const orgsFetchUncertain = Boolean\(orgsWrap\.timedOut \|\| !Array\.isArray\(orgsResult\)\)/,
    'null, non-array, and timeout org results must be treated as uncertain');
  assert.match(bundleFn, /if \(orgsFetchUncertain && cachedOrgs\.length > 0\)/,
    'cached orgs may be reused only for invalid org results or timeouts');
});

test('phase 0.6C-3 account bundle marks failed org fetch as partial, not confirmed no-org', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /const orgsFetchReturnedArray = Array\.isArray\(orgsResult\) && !orgsWrap\.timedOut/,
    'only an actual non-timeout array result may be authoritative');
  assert.match(bundleFn, /const orgsFetchUncertain = Boolean\(orgsWrap\.timedOut \|\| !Array\.isArray\(orgsResult\)\)/,
    'null, failed, timeout, or non-array org fetch results must be uncertain');
  assert.match(bundleFn, /else if \(orgsFetchUncertain\) \{[\s\S]*reasonParts\.push\('orgs unavailable'\)/,
    'failed org fetch with no cached orgs must carry an uncertainty reason');
  assert.match(bundleFn, /const partial = Boolean\(!orgsAuthoritative \|\|/,
    'a non-authoritative org fetch must force a partial bundle instead of confirmed no-org');
});

test('phase 0.6C-3 cached org rescue after failed org fetch remains partial', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /if \(orgsFetchUncertain && cachedOrgs\.length > 0\) \{[\s\S]*orgsResult = cachedOrgs;[\s\S]*usedCachedOrgs = true;/,
    'cached orgs may rescue display state only after an uncertain org fetch');
  assert.match(bundleFn, /const orgsAuthoritative = orgsFetchReturnedArray && !usedCachedOrgs/,
    'cached org rescue must not be treated as an authoritative fresh org list');
  assert.match(bundleFn, /const partial = Boolean\(!orgsAuthoritative \|\|/,
    'cached org rescue must remain partial so it cannot confirm zero active workspaces');
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

test('phase 0.6C-2 app clears org state when resolved org is not in active org rows', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const resolverStart = src.indexOf('function resolveOrgContextFromBundle(bundle)');
  const resolverEnd = src.indexOf('// ── Workspace-ready event replay buffer', resolverStart);
  const resolver = resolverStart >= 0 && resolverEnd > resolverStart ? src.slice(resolverStart, resolverEnd) : '';
  const applyStart = src.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = src.indexOf('async function refreshOrgContext', applyStart);
  const applyFn = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';

  assert.ok(resolver, 'resolveOrgContextFromBundle must be extractable');
  assert.ok(applyFn, 'applyOrgContextFromBundle must be extractable');
  assert.doesNotMatch(resolver, /else if \(profileOrgId\) orgId = profileOrgId/,
    'profile org hints must not become active unless present in active org rows');
  assert.doesNotMatch(resolver, /else if \(membershipOrgId\) orgId = membershipOrgId/,
    'preserved membership org ids must not become active unless present in active org rows');
  assert.match(applyFn, /const nextOrgInActiveList = Boolean\([\s\S]*resolved\.orgs\.some\(org => org && String\(org\.id\) === String\(nextOrgId\)\)[\s\S]*\)/,
    'applyOrgContextFromBundle must validate resolved org id against active org rows');
  assert.match(applyFn, /if \(nextOrgId && !nextOrgInActiveList && !\(bundle && bundle\.partial\)\) \{[\s\S]*clearOrgContext\(\{[\s\S]*clearLocalOrgHint: true,[\s\S]*confirmedNoOrg: true,[\s\S]*workspace-archived/,
    'non-partial bundles with stale resolved org ids must clear org context as confirmed no-org');
});

test('phase 0.6C-2 app exposes confirmed no-active bundle before clearing org context', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const applyStart = src.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = src.indexOf('async function refreshOrgContext', applyStart);
  const applyFn = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';

  assert.ok(applyFn, 'applyOrgContextFromBundle must be extractable');
  assert.match(applyFn, /try \{ window\.__TP3D_LAST_ACCOUNT_BUNDLE = null; \} catch/,
    'signed-out cleanup must clear the exposed account bundle to avoid cross-user stale settings state');
  assert.match(applyFn, /window\.__TP3D_LAST_ACCOUNT_BUNDLE = bundle;[\s\S]*const resolved = resolveOrgContextFromBundle\(bundle\)/,
    'applyOrgContextFromBundle must expose the current bundle before no-active clear branches');
  assert.match(applyFn, /window\.__TP3D_LAST_ACCOUNT_BUNDLE = bundle;[\s\S]*if \(nextOrgId && !nextOrgInActiveList[\s\S]*clearOrgContext\(/,
    'stale resolved-org no-active clears must leave Settings with the authoritative empty bundle');
  assert.match(applyFn, /window\.__TP3D_LAST_ACCOUNT_BUNDLE = bundle;[\s\S]*if \(!nextOrgId\) \{[\s\S]*clearOrgContext\(/,
    'zero-active no-active clears must leave Settings with the authoritative empty bundle');
});

test('phase 0.6C-2 Settings clears stale locked org state when no active workspace is confirmed', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /function isConfirmedNoActiveWorkspaceBundle\(bundle\)/,
    'settings overlay must detect definitive no-active-workspace bundles');
  assert.match(src, /let accountBundleConfirmedNoActiveWorkspace = false;/,
    'settings overlay must keep a local confirmed no-active flag for its own bundle loader');
  assert.match(src, /bundle\.partial !== true[\s\S]*Array\.isArray\(bundle\.orgs\)[\s\S]*bundle\.orgs\.length === 0[\s\S]*!bundle\.activeOrgId/,
    'no-active-workspace detection must require a complete empty active org list');
  assert.match(src, /accountBundleConfirmedNoActiveWorkspace\) return '';[\s\S]*isConfirmedNoActiveWorkspaceBundle\(window\.__TP3D_LAST_ACCOUNT_BUNDLE \|\| null\)[\s\S]*return ''/,
    'settings must not initialize modalOrgId from stale local or billing hints after confirmed no-active-workspace');
  assert.match(src, /isConfirmedNoActiveWorkspaceBundle\(bundle\)[\s\S]*accountBundleConfirmedNoActiveWorkspace = true;[\s\S]*membershipData = null;[\s\S]*orgData = null;[\s\S]*modalOrgId = '';[\s\S]*clearOrgScopedCaches\(''\)/,
    'settings bundle load must clear stale org-scoped state when no active workspace is confirmed');
  assert.match(src, /accountBundleConfirmedNoActiveWorkspace \|\|[\s\S]*isConfirmedNoActiveWorkspaceBundle\(window\.__TP3D_LAST_ACCOUNT_BUNDLE \|\| null\)/,
    'settings Billing must use local no-active bundle state as well as the app-level bundle');
  assert.match(src, /confirmedNoActiveWorkspace\) \{[\s\S]*setActiveTab\('org-general', \{ source: 'org-billing:no-active' \}\)/,
    'settings Billing must redirect to General after confirmed no-active workspace state');
  assert.match(src, /!hasOrg && !isOrgHydrating && \(_tabState\.activeTabId === 'org-members' \|\| _tabState\.activeTabId === 'org-billing'\)[\s\S]*_tabState\.activeTabId = 'org-general'/,
    'settings must not leave Members or Billing selected after no active workspace is confirmed');
});

test('phase 0.6C-2 Settings re-resolves modal org on open to avoid stale cross-user billing display', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function open(tab)');
  const end = src.indexOf('function init()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';
  const tabStart = src.indexOf('function resolveInitialTab(tab)');
  const tabEnd = src.indexOf('/**\n   * Repro steps:', tabStart);
  const tabFn = tabStart >= 0 && tabEnd > tabStart ? src.slice(tabStart, tabEnd) : '';

  assert.ok(fn, 'settings open() must be extractable');
  assert.ok(tabFn, 'resolveInitialTab() must be extractable');
  assert.match(fn, /const resolvedModalOrgId = resolveInitialModalOrgId\(\);/,
    'settings open() must re-resolve the authoritative modal org every time it opens');
  assert.doesNotMatch(fn, /if \(!modalOrgId\) \{[\s\S]*modalOrgId = resolveInitialModalOrgId\(\);[\s\S]*\}/,
    'settings open() must not preserve a stale modalOrgId just because it is non-empty');
  assert.match(fn, /if \(modalOrgId !== resolvedModalOrgId\) \{[\s\S]*modalOrgId = resolvedModalOrgId;/,
    'settings open() must replace stale modalOrgId with the current resolved org id');
  assert.match(fn, /cachedOrgIdBeforeOpen && cachedOrgIdBeforeOpen !== openingOrgId[\s\S]*membershipData = null;[\s\S]*orgData = null;[\s\S]*orgMembersData = null;[\s\S]*orgInvitesData = null;/,
    'settings open() must clear stale org-scoped caches when the resolved org changes');
  assert.match(fn, /const openingUserView = getCurrentUserView\(profileData\);[\s\S]*if \(openingUserView\.isAuthed\) \{[\s\S]*queueAccountBundleRefresh\(\{ force: true, source: 'open:created-refresh' \}\)/,
    'settings open() must refresh the account bundle for signed-in users even when caches are empty');
  assert.match(tabFn, /candidate === 'org-members' \|\| candidate === 'org-billing'[\s\S]*!resolveInitialModalOrgId\(\)[\s\S]*return 'org-general'/,
    'settings must not initially open disabled Members or Billing tabs when no modal org is resolved');
});

test('phase 0.6C-2 archive fallback avoids logout reload destructive data and billing scope', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
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

test('phase 0.6C-3 dispatchOrgContextChanged allows empty orgId only with confirmed opt-in', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function dispatchOrgContextChanged(options = {})');
  const end = src.indexOf('function parseOrgContextSyncPayload', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'dispatchOrgContextChanged must be extractable');
  assert.match(fn, /allowEmpty = false/,
    'empty org dispatch opt-in must default to false');
  assert.match(fn, /confirmedNoOrg: dispatchConfirmedNoOrg = false/,
    'confirmedNoOrg opt-in must default to false');
  assert.match(fn, /if \(!nextOrgId && !\(allowEmpty && dispatchConfirmedNoOrg\)\) return 0/,
    'empty orgId must still be rejected unless allowEmpty and confirmedNoOrg are both true');
  assert.match(fn, /confirmedNoOrg: dispatchConfirmedNoOrg \|\| undefined/,
    'confirmedNoOrg must be included in the org-changed event detail');
});

test('phase 0.6C-3 clearOrgContext dispatches confirmed empty-org event', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function clearOrgContext(');
  const end = src.indexOf('let orgScopedRenderTimer', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'clearOrgContext must be extractable');
  assert.match(fn, /orgContextResolved = Boolean\(confirmedNoOrg\)/,
    'clearOrgContext must mark confirmed no-org as a resolved org-context state');
  assert.match(fn, /getSignedInUserIdStrict\(\)[\s\S]*dispatchOrgContextChanged/,
    'confirmed no-active dispatch must require a signed-in user');
  assert.match(fn, /dispatchOrgContextChanged\(\{[\s\S]*orgId: ''[\s\S]*allowEmpty: true[\s\S]*confirmedNoOrg: true[\s\S]*broadcast: false/,
    'clearOrgContext must dispatch a local empty-org no-active event without broadcasting');
});

test('phase 0.6C-3 orgContextResolved is set on active apply and reset on uncertain auth clears', async () => {
  const src = await fs.readFile(appPath, 'utf8');
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
  assert.match(src, /lastAuthUserId = null; \/\/ Clear old user ID to prevent stale state leakage[\s\S]{0,120}orgContextResolved = false;/,
    'cross-tab user switch cleanup must reset orgContextResolved');
});

test('phase 0.6C-3 AccountSwitcher loading state is gated by unresolved org context', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function getDisplay()');
  const end = src.indexOf('function renderButton(buttonEl)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'AccountSwitcher.getDisplay must be extractable');
  assert.match(fn, /!orgContextResolved/,
    'AccountSwitcher must stop showing Loading once org context has definitively resolved');
  assert.match(fn, /isAuthed && !activeOrg && !orgContextResolved && \(orgContextInFlight \|\| authRehydratePromise\)/,
    'Loading must require signed-in auth, no active org, unresolved org context, and active work in flight');
});

test('phase 0.6C-3 AccountSwitcher has neutral confirmed no-active workspace display', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function getDisplay()');
  const end = src.indexOf('function renderButton(buttonEl)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'AccountSwitcher.getDisplay must be extractable');
  assert.match(fn, /const noActiveWorkspace = Boolean\(isAuthed && !activeOrg && orgContextResolved && activeOrgs\.length === 0\)/,
    'AccountSwitcher must detect signed-in confirmed no-active workspace state explicitly');
  assert.match(fn, /noActiveWorkspace[\s\S]*\? 'No workspace'/,
    'confirmed no-active state must use neutral primary chip copy');
  assert.match(fn, /userName: noActiveWorkspace \? 'Create or join' : displayName/,
    'confirmed no-active state must not use account user identity as the chip secondary label');
  assert.match(fn, /orgInitials: noActiveWorkspace \? '' : getActiveWorkspaceInitials\(\)/,
    'confirmed no-active chip avatar must not reuse user/account initials');
});

test('phase 0.6C-3 org-changed listener handles confirmed no-active without auth refresh', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf("window.addEventListener('tp3d:org-changed', ev => {");
  const end = src.indexOf('AppShell.init();', start);
  const listener = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(listener, 'tp3d:org-changed listener must be extractable');
  assert.match(listener, /isClearedEvent = !detailOrgId && Boolean\(detail && detail\.confirmedNoOrg\)/,
    'listener must detect confirmed empty-org events');
  assert.match(listener, /if \(isClearedEvent\) \{[\s\S]*AccountSwitcher[\s\S]*refresh\(\)/,
    'confirmed no-active event must refresh the workspace chip');
  assert.match(listener, /if \(isClearedEvent\) \{[\s\S]*applyAccessGateFromBilling\(getBillingState\(\), \{[\s\S]*reason: 'org-cleared'[\s\S]*activeOrgId: null/,
    'confirmed no-active event must reapply access gate with no active org');

  const branchStart = listener.indexOf('if (isClearedEvent) {');
  const branchEnd = listener.indexOf('const snapshotOrgId', branchStart);
  const branch = branchStart >= 0 && branchEnd > branchStart ? listener.slice(branchStart, branchEnd) : '';
  assert.ok(branch, 'confirmed no-active branch must be extractable');
  assert.doesNotMatch(branch, /requestAuthRefresh/,
    'confirmed no-active event must not trigger auth refresh and re-enter Loading');
});

test('phase 0.6C-3 settings overlay clears stale org state on confirmed no-active event', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function ensureOrgChangedListener()');
  const end = src.indexOf('function removeOrgChangedListener()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'ensureOrgChangedListener must be extractable');
  assert.doesNotMatch(fn, /if \(!nextOrgId\) return;/,
    'settings orgChangedHandler must not blindly ignore empty org events');
  assert.match(fn, /Boolean\(detail && detail\.confirmedNoOrg\)[\s\S]*isConfirmedNoActiveWorkspaceBundle/,
    'settings orgChangedHandler must require confirmed no-active state before clearing');
  assert.match(fn, /modalOrgId = '';[\s\S]*clearOrgScopedCaches\(''\)/,
    'settings orgChangedHandler must clear the locked modal org id and org-scoped caches');
  assert.match(fn, /membershipData = null;[\s\S]*orgData = null;[\s\S]*orgMembersData = null;[\s\S]*orgInvitesData = null;/,
    'settings orgChangedHandler must clear stale org, membership, members, and invites data');
  assert.match(fn, /isLoadingOrgMembers = false;[\s\S]*isLoadingOrgInvites = false;/,
    'settings orgChangedHandler must clear members and invites loading state');
  assert.match(fn, /orgMemberActions\.clear\(\);[\s\S]*orgInviteActions\.clear\(\);/,
    'settings orgChangedHandler must clear member and invite action state');
  assert.match(fn, /render\(\{ source: 'org-changed:no-active' \}\)/,
    'settings orgChangedHandler must re-render connected overlay into no-active state');
});

test('phase 0.6C-3 Billing renders clean no-active state instead of stale org details', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function renderBillingInto(targetEl)');
  const end = src.indexOf('function render(renderMeta)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'renderBillingInto must be extractable');
  assert.match(fn, /if \(!lockedOrgId\) \{[\s\S]*isConfirmedNoActiveWorkspaceBundle\(window\.__TP3D_LAST_ACCOUNT_BUNDLE \|\| null\)/,
    'Billing must detect confirmed zero active workspaces when no modal org is locked');
  assert.match(fn, /No active workspace is selected\. Create a new workspace or restore an archived workspace when restore is available\./,
    'Billing must show a clean no-active workspace message');
  assert.match(fn, /targetEl\.appendChild\(noActiveMsg\);[\s\S]*return;/,
    'Billing must return before stale workspace detail rendering in confirmed no-active state');
});

test('phase 0.6C billing workspace limit copy includes archived workspaces', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const start = src.indexOf('function renderBillingInto(targetEl)');
  const end = src.indexOf('function render(renderMeta)', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'renderBillingInto must be extractable');
  assert.doesNotMatch(fn, /workspaceCount[\s\S]{0,180}currently active/,
    'workspace limit count copy must not describe counted archived workspaces as currently active');
  assert.match(fn, /including archived workspaces/,
    'workspace limit copy must disclose that archived workspaces count toward the limit');
});

test('phase 0.6C-3 no-workspace banner remains gated by settled auth state', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function applyOrgRequiredUi(');
  const end = src.indexOf('// \u2500\u2500 Install workspace-ready listener early', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'applyOrgRequiredUi must be extractable');
  assert.match(fn, /const authNotSettled = !authGateIsSettled\(\)/,
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

test('phase 0.6C-3 frontend stability fix avoids backend billing and destructive scope creep', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');

  const appSnippets = [
    ['dispatchOrgContextChanged', appSrc.slice(appSrc.indexOf('function dispatchOrgContextChanged'), appSrc.indexOf('function parseOrgContextSyncPayload'))],
    ['clearOrgContext', appSrc.slice(appSrc.indexOf('function clearOrgContext('), appSrc.indexOf('let orgScopedRenderTimer'))],
    ['org-changed listener', appSrc.slice(appSrc.indexOf("window.addEventListener('tp3d:org-changed', ev => {"), appSrc.indexOf('AppShell.init();'))],
  ];
  const billingGuardStart = settingsSrc.indexOf('if (!lockedOrgId) {', settingsSrc.indexOf('function renderBillingInto(targetEl)'));
  const billingGuardEnd = settingsSrc.indexOf('const currentOrgId = getOrgIdFromOrgContext();', billingGuardStart);
  const settingsSnippets = [
    ['settings orgChangedHandler', settingsSrc.slice(settingsSrc.indexOf('function ensureOrgChangedListener()'), settingsSrc.indexOf('function removeOrgChangedListener()'))],
    ['settings billing no-active guard', settingsSrc.slice(billingGuardStart, billingGuardEnd)],
  ];

  for (const [label, snippet] of [...appSnippets, ...settingsSnippets]) {
    assert.ok(snippet, `${label} snippet must be extractable`);
    assert.doesNotMatch(snippet, /signOut|forceLocalSignedOut|location\.reload|window\.location/i,
      `${label} must not sign out or reload`);
    assert.doesNotMatch(snippet, /stripe|checkout|portal|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
      `${label} must not touch Stripe, billing-status, or billing tables`);
    assert.doesNotMatch(snippet, /\.from\(['"]organization_members['"]\)|\.from\(['"]organization_invites['"]\)|\.delete\(\)|deletePack|deleteCase|storage\.from|router\./i,
      `${label} must not mutate members, invites, packs, cases, storage, or router state`);
  }
});

test('phase 0.6C-4 archive refresh fallback commits a remaining active workspace', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const helperStart = src.indexOf('function handleWorkspaceArchived(archivedOrgId, options = {})');
  const helperEnd = src.indexOf('// Expose billing pump globally', helperStart);
  const helper = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';
  const resolverStart = src.indexOf('function resolveOrgContextFromBundle(bundle)');
  const resolverEnd = src.indexOf('// \u2500\u2500 Workspace-ready event replay buffer', resolverStart);
  const resolver = resolverStart >= 0 && resolverEnd > resolverStart ? src.slice(resolverStart, resolverEnd) : '';
  const applyStart = src.indexOf('async function applyOrgContextFromBundle');
  const applyEnd = src.indexOf('async function refreshOrgContext', applyStart);
  const applyFn = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';
  const publicApiStart = src.indexOf('return {\n      init,');
  const publicApiEnd = src.indexOf('};\n  })();', publicApiStart);
  const publicApi = publicApiStart >= 0 && publicApiEnd > publicApiStart
    ? src.slice(publicApiStart, publicApiEnd)
    : '';

  assert.ok(helper, 'handleWorkspaceArchived must be extractable');
  assert.ok(resolver, 'resolveOrgContextFromBundle must be extractable');
  assert.ok(applyFn, 'applyOrgContextFromBundle must be extractable');
  assert.match(publicApi, /handleWorkspaceArchived,/,
    'Settings must be able to call handleWorkspaceArchived from the live TruckPackerApp public API');
  assert.match(helper, /SupabaseClient\.invalidateAccountCache\(\)[\s\S]*refreshOrgContext\(source, \{ force: true, forceEmit: true \}\)/,
    'archive success must invalidate account cache and force a fresh org-context refresh');
  assert.match(resolver, /else if \(orgs\.length > 0\) orgId = String\(orgs\[0\]\.id\);/,
    'when stale hints are invalid, resolver must fall back to an org from the fresh active org list');
  assert.match(applyFn, /writeLocalOrgId\(nextOrgIdStr\)/,
    'fallback active org must replace the stale local active-org hint');
  assert.match(applyFn, /dispatchOrgContextChanged\(\{[\s\S]*orgId: nextOrgIdStr[\s\S]*source: 'bundle-apply'/,
    'fallback active org commit must emit org-changed so chip and Settings can repaint');
  assert.match(helper, /syncWorkspaceUiAfterOrgRefresh\(source \+ ':refreshed'\)/,
    'archive refresh completion must sync account switcher and Settings UI after the forced org refresh settles');
});

test('phase 0.6C-4 settings open clears stale org caches after archive fallback switch', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');
  const resolverStart = src.indexOf('function getOrgIdFromLastActiveBundle()');
  const resolverEnd = src.indexOf('function resolveInitialModalOrgId()', resolverStart);
  const resolver = resolverStart >= 0 && resolverEnd > resolverStart ? src.slice(resolverStart, resolverEnd) : '';
  const initialStart = src.indexOf('function resolveInitialModalOrgId()');
  const initialEnd = src.indexOf('function ensureModalOrgId()', initialStart);
  const initialFn = initialStart >= 0 && initialEnd > initialStart ? src.slice(initialStart, initialEnd) : '';
  const openStart = src.indexOf('function open(tab)');
  const openEnd = src.indexOf('function init()', openStart);
  const openFn = openStart >= 0 && openEnd > openStart ? src.slice(openStart, openEnd) : '';

  assert.ok(resolver, 'last active bundle modal-org resolver must be extractable');
  assert.match(resolver, /bundle\.partial === true/,
    'Settings must not treat partial account bundles as authoritative modal-org sources');
  assert.match(resolver, /const hasOrg = orgId =>[\s\S]*orgs\.some\(org => org && String\(org\.id\) === normalizedOrgId\)/,
    'Settings must validate modal org candidates against active org rows from the last bundle');
  assert.match(resolver, /if \(hasOrg\(activeOrgId\)\) return activeOrgId;[\s\S]*if \(hasOrg\(localOrgId\)\) return localOrgId;[\s\S]*orgs\[0\]/,
    'Settings must prefer bundle activeOrgId, then valid local hint, then first active bundle org');
  assert.match(initialFn, /const orgContextId = getOrgIdFromOrgContext\(\);[\s\S]*if \(orgContextId\) return orgContextId;[\s\S]*const localOrgId = getOrgIdFromLocalStorage\(\);/,
    'Settings initial modal org must prefer the live active OrgContext before last bundle hints');
  assert.match(initialFn, /const localOrgId = getOrgIdFromLocalStorage\(\);[\s\S]*const billingOrgId = getOrgIdFromBillingState\(\);[\s\S]*if \(billingOrgId && localOrgId && billingOrgId === localOrgId\) return billingOrgId;[\s\S]*return localOrgId \|\| '';/,
    'Settings initial modal org must not use stale billing state unless it matches the local active-org hint');
  assert.match(initialFn, /const bundleOrgId = getOrgIdFromLastActiveBundle\(\);[\s\S]*if \(bundleOrgId\) return bundleOrgId;[\s\S]*return localOrgId \|\| '';/,
    'Settings initial modal org may use the last active bundle only after live OrgContext/local hints are checked');
  assert.ok(openFn, 'Settings open function must be extractable');
  assert.match(openFn, /const cachedOrgIdBeforeOpen = normalizeOrgId\([\s\S]*orgData && orgData\.id[\s\S]*membershipData && membershipData\.organization_id/,
    'Settings open must capture the cached org id before resolving the current modal org');
  assert.match(openFn, /const openingOrgId = normalizeOrgId\(modalOrgId\)/,
    'Settings open must normalize the newly resolved locked org');
  assert.match(openFn, /cachedOrgIdBeforeOpen && cachedOrgIdBeforeOpen !== openingOrgId/,
    'Settings open must detect stale cached org data when the active org changed or no active org is locked after archive fallback');
  assert.match(openFn, /membershipData = null;[\s\S]*orgData = null;[\s\S]*orgMembersData = null;[\s\S]*orgInvitesData = null;/,
    'Settings open must clear stale org, membership, members, and invites data before rendering');
  assert.match(openFn, /orgMemberActions\.clear\(\);[\s\S]*orgInviteActions\.clear\(\);/,
    'Settings open must clear stale member and invite action state for the previous org');
  assert.match(openFn, /clearOrgScopedCaches\(modalOrgId\)/,
    'Settings open must still run the existing org-scoped cache cleanup for the locked org');
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

// ── Phase 0.6D-pre 4B-orphan: retire legacy purge-deleted-users ───────────────

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

// ── Phase 0.6D Batch C: Transfer Ownership ───────────────────────────────────

test('phase 0.6D Batch C migration creates transfer ownership RPC with service-role-only execute', async () => {
  const src = await fs.readFile(transferOwnershipMigrationPath, 'utf8');

  assert.match(src, /create or replace function public\.tp3d_transfer_workspace_ownership\(/i,
    'migration must create tp3d_transfer_workspace_ownership');
  assert.match(src, /returns jsonb/i,
    'transfer ownership RPC must return jsonb');
  assert.match(src, /security definer/i,
    'transfer ownership RPC must be security definer');
  assert.match(src, /set search_path = public/i,
    'transfer ownership RPC must set search_path');
  assert.match(src, /for update/i,
    'transfer ownership RPC must lock rows during transfer');
  assert.match(src, /revoke execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) from public/i,
    'transfer ownership RPC must revoke public execute');
  assert.match(src, /revoke execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) from anon/i,
    'transfer ownership RPC must revoke anon execute');
  assert.match(src, /revoke execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) from authenticated/i,
    'transfer ownership RPC must revoke authenticated execute');
  assert.match(src, /grant execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) to service_role/i,
    'transfer ownership RPC must grant execute to service_role only');
});

test('phase 0.6D Batch C RPC verifies primary owner target and actor membership', async () => {
  const src = await fs.readFile(transferOwnershipMigrationPath, 'utf8');

  assert.match(src, /v_org\.owner_id\s+is null or v_org\.owner_id <> p_actor_id/i,
    'RPC must verify actor is organizations.owner_id');
  assert.match(src, /TP3D_TRANSFER_NOT_PRIMARY_OWNER/,
    'RPC must raise not-primary-owner sentinel');
  assert.match(src, /p_new_owner_id = p_actor_id[\s\S]*TP3D_TRANSFER_TARGET_IS_ACTOR/i,
    'RPC must reject transferring ownership to self');
  assert.match(src, /from public\.organization_members m[\s\S]*m\.user_id = p_new_owner_id[\s\S]*for update/i,
    'RPC must verify and lock target membership');
  assert.match(src, /TP3D_TRANSFER_TARGET_NOT_MEMBER/,
    'RPC must raise target-not-member sentinel');
  assert.match(src, /from public\.organization_members m[\s\S]*m\.user_id = p_actor_id[\s\S]*for update/i,
    'RPC must verify and lock actor membership');
  assert.match(src, /TP3D_TRANSFER_ACTOR_MEMBERSHIP_MISSING/,
    'RPC must raise actor-membership-missing sentinel');
});

test('phase 0.6D Batch C RPC updates owner_id and member roles atomically', async () => {
  const src = await fs.readFile(transferOwnershipMigrationPath, 'utf8');

  assert.match(src, /update public\.organizations[\s\S]*set owner_id = p_new_owner_id[\s\S]*where id = p_org_id/i,
    'RPC must update organizations.owner_id');
  assert.match(src, /update public\.organization_members[\s\S]*role = 'owner'::public\.org_member_role[\s\S]*user_id = p_new_owner_id/i,
    'RPC must set new owner membership role to owner');
  assert.match(src, /update public\.organization_members[\s\S]*role = 'admin'::public\.org_member_role[\s\S]*user_id = p_actor_id/i,
    'RPC must set old owner membership role to admin');
  assert.match(src, /jsonb_build_object\([\s\S]*'organization_id', p_org_id[\s\S]*'old_owner_id', p_actor_id[\s\S]*'new_owner_id', p_new_owner_id/i,
    'RPC must return transfer result ids');
});

test('phase 0.6D Batch C live schema fix repairs organization_members updated_at dependency', async () => {
  const src = await fs.readFile(transferOwnershipLiveFixMigrationPath, 'utf8');
  const fnStart = src.indexOf('create or replace function public.tp3d_transfer_workspace_ownership');
  const functionBody = fnStart >= 0 ? src.slice(fnStart) : '';

  assert.match(src, /alter table public\.organization_members[\s\S]*add column if not exists updated_at timestamptz/i,
    'live schema fix must add the updated_at column expected by the existing organization_members trigger');
  assert.match(src, /create or replace function public\.tp3d_transfer_workspace_ownership\(/i,
    'live schema fix migration must replace the transfer RPC');
  assert.match(functionBody, /update public\.organization_members[\s\S]*role = 'owner'::public\.org_member_role[\s\S]*user_id = p_new_owner_id/i,
    'live schema fix must still set new owner role');
  assert.match(functionBody, /update public\.organization_members[\s\S]*role = 'admin'::public\.org_member_role[\s\S]*user_id = p_actor_id/i,
    'live schema fix must still set old owner role');
  assert.doesNotMatch(functionBody, /update public\.organization_members[\s\S]{0,180}updated_at/i,
    'transfer RPC role updates should rely on the existing trigger rather than manually setting organization_members.updated_at');
  assert.doesNotMatch(functionBody, /update public\.organizations[\s\S]{0,120}updated_at/i,
    'transfer RPC live fix must not require optional organizations.updated_at');
  assert.match(src, /grant execute on function public\.tp3d_transfer_workspace_ownership\(uuid, uuid, uuid\) to service_role/i,
    'live schema fix must preserve service_role-only execute');
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

test('phase 0.6D Batch C Edge Function uses RPC and avoids direct table mutation', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');

  assert.match(src, /serviceClient\(\)/,
    'transfer Edge Function must use service client');
  assert.match(src, /\.rpc\("tp3d_transfer_workspace_ownership"/,
    'transfer Edge Function must call the transfer RPC');
  assert.doesNotMatch(src, /\.from\(["']organizations["']\)|\.from\(["']organization_members["']\)/,
    'transfer Edge Function must not query or mutate org tables directly');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/,
    'transfer Edge Function must not directly mutate tables outside RPC');
});

test('phase 0.6D Batch C Edge Function maps transfer sentinel errors', async () => {
  const src = await fs.readFile(orgTransferOwnershipPath, 'utf8');

  assert.match(src, /TP3D_TRANSFER_NOT_PRIMARY_OWNER[\s\S]*status:\s*403/,
    'not-primary-owner sentinel must map to 403');
  assert.match(src, /TP3D_TRANSFER_ORG_NOT_FOUND[\s\S]*status:\s*404/,
    'org-not-found sentinel must map to 404');
  assert.match(src, /TP3D_TRANSFER_TARGET_NOT_MEMBER[\s\S]*status:\s*404/,
    'target-not-member sentinel must map to 404');
  assert.match(src, /TP3D_TRANSFER_TARGET_IS_ACTOR[\s\S]*status:\s*400/,
    'target-is-actor sentinel must map to 400');
  assert.match(src, /TP3D_TRANSFER_ACTOR_MEMBERSHIP_MISSING[\s\S]*status:\s*409/,
    'actor-membership-missing sentinel must map to 409');
});

test('phase 0.6D Batch C config disables platform JWT verification for transfer Edge Function', async () => {
  const src = await fs.readFile(supabaseConfigPath, 'utf8');
  const start = src.indexOf('[functions.org-transfer-ownership]');
  const end = src.indexOf('[functions.', start + 1);
  const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : '';

  assert.ok(block, 'config must include org-transfer-ownership function block');
  assert.match(block, /verify_jwt\s*=\s*false/,
    'org-transfer-ownership must use app-level requireUser auth with verify_jwt=false');
});

test('phase 0.6D Batch C billing service exports transferOwnership wrapper', async () => {
  const src = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(src, /export async function transferOwnership\(orgId, newOwnerId\)/,
    'billing service must export transferOwnership');
  assert.match(src, /postFn\('\/org-transfer-ownership'[\s\S]*organization_id: orgId[\s\S]*new_owner_id: newOwnerId/,
    'transferOwnership must POST organization_id and new_owner_id to Edge Function');
  assert.match(src, /resolveFnError\(res, data, 'Transfer ownership failed'\)/,
    'transferOwnership must preserve server error messages');
});

test('phase 0.6D Batch C app exposes handleOwnershipTransferred without signout or reload', async () => {
  const src = await fs.readFile(appPath, 'utf8');
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

test('phase 0.6D Batch C settings has primary-owner-only transfer ownership flow', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /transferOwnership as transferOwnershipFn/,
    'settings overlay must import transferOwnership wrapper');
  assert.match(src, /let _transferOwnershipInFlight = false/,
    'settings overlay must track transfer in-flight state');
  assert.match(src, /async function showTransferOwnershipModal\(orgId, orgName, currentUserId\)/,
    'settings overlay must define transfer ownership modal');
  assert.match(src, /transferCandidates = \(Array\.isArray\(orgMembersData\)[\s\S]*String\(member\.user_id\) !== actorId/,
    'transfer modal must use existing workspace members excluding current user');
  assert.match(src, /if \(isPrimaryOwner\)[\s\S]*Transfer Ownership[\s\S]*showTransferOwnershipModal\(leaveOrgId, leaveName, currentUserIdForLeave\)/,
    'Transfer Ownership action must be primary-owner-only in General tab');
  assert.match(src, /UIComponents\.showModal\(\{[\s\S]*title: 'Transfer Ownership'/,
    'transfer flow must use existing modal UI');
  assert.match(src, /transferOwnership\(normalizedOrgId, selectedUserId, orgName\)/,
    'transfer modal must call transferOwnership');
  assert.match(src, /TruckPackerApp\.handleOwnershipTransferred\(normalizedOrgId/,
    'transfer success must notify app lifecycle handler');
});

test('phase 0.6D Batch C updateOrganization direct owner_id guard remains', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function updateOrganization(orgId, updates)');
  const end = src.indexOf('export async function uploadOrgLogo', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'updateOrganization must be extractable');
  assert.match(fn, /hasOwnProperty\.call\(updates \|\| \{\}, 'owner_id'\)/,
    'updateOrganization must keep blocking direct owner_id writes');
  assert.match(fn, /Direct ownership transfer is disabled\. Use the org-transfer-ownership Edge Function\./,
    'updateOrganization must point callers to org-transfer-ownership');
});

test('phase 0.6D Batch C transfer implementation avoids forbidden scope', async () => {
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const billingStart = billingSrc.indexOf('export async function transferOwnership(orgId, newOwnerId)');
  const billingEnd = billingSrc.indexOf('/**\n * Leave a workspace', billingStart);
  const billingWrapper = billingStart >= 0 && billingEnd > billingStart ? billingSrc.slice(billingStart, billingEnd) : '';
  const appSrc = await fs.readFile(appPath, 'utf8');
  const appStart = appSrc.indexOf('function handleOwnershipTransferred(orgId, options = {})');
  const appEnd = appSrc.indexOf('// Expose billing pump globally', appStart);
  const appHandler = appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : '';
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const settingsStart = settingsSrc.indexOf('async function transferOwnership(orgId, newOwnerId, orgName)');
  const settingsEnd = settingsSrc.indexOf('// ---- Organization invites ----', settingsStart);
  const settingsTransferFlow = settingsStart >= 0 && settingsEnd > settingsStart ? settingsSrc.slice(settingsStart, settingsEnd) : '';
  const sources = [
    ['transfer migration', await fs.readFile(transferOwnershipMigrationPath, 'utf8')],
    ['transfer edge', await fs.readFile(orgTransferOwnershipPath, 'utf8')],
    ['billing wrapper', billingWrapper],
    ['app ownership handler', appHandler],
    ['settings transfer flow', settingsTransferFlow],
  ];

  for (const [label, src] of sources) {
    assert.doesNotMatch(src, /stripe|checkout|portal|webhook|billing-status|billing_customers|subscriptions|stripe_customers|webhook_events/i,
      `${label} must not touch Stripe, billing-status, or billing tables`);
    assert.doesNotMatch(src, /org-invite|archiveWorkspace|restoreWorkspace|purge-deleted|deletePack|deleteCase|storage\.from|router\.|location\.reload|signOut/i,
      `${label} must not touch invites, archive/restore, purge, packs/cases, storage, router, reload, or signOut`);
  }
});

test('phase 0.6D Batch B archived workspace RPC exists without changing active RPC', async () => {
  const src = await fs.readFile(restoreWorkspaceMigrationPath, 'utf8');

  assert.match(src, /create or replace function public\.get_user_archived_organizations\(\)/,
    'restore migration must create get_user_archived_organizations');
  assert.match(src, /o\.archived_at is not null/,
    'archived workspace RPC must return archived rows only');
  assert.match(src, /join public\.organization_members om[\s\S]*om\.user_id = auth\.uid\(\)/,
    'archived workspace RPC must return rows where the user has membership');
  assert.match(src, /grant execute on function public\.get_user_archived_organizations\(\) to authenticated/,
    'archived workspace RPC must grant authenticated execute');
  assert.doesNotMatch(src, /create or replace function public\.get_user_organizations\(\)/,
    'restore migration must not alter active get_user_organizations behavior');
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

test('phase 0.6D Batch B restore Edge Function is owner-only and idempotent', async () => {
  const src = await fs.readFile(orgRestoreWorkspacePath, 'utf8');

  assert.match(src, /\.from\("organizations"\)[\s\S]*\.select\("id, owner_id, archived_at, created_at"\)/,
    'restore Edge Function must load owner_id and archived_at from organizations');
  assert.match(src, /String\(org\.owner_id \|\| ""\) !== String\(auth\.user\.id \|\| ""\)/,
    'restore Edge Function must require organizations.owner_id to match actor');
  assert.match(src, /status:\s*403/,
    'non-primary-owner restore must return 403');
  assert.match(src, /if \(!org\.archived_at\)[\s\S]*already_restored:\s*true/,
    'restore Edge Function must be idempotent when the workspace is already active');
});

test('phase 0.6D Batch B restore updates only archived_at to null', async () => {
  const src = await fs.readFile(orgRestoreWorkspacePath, 'utf8');
  const updateStart = src.indexOf('.from("organizations")\n    .update({ archived_at: null })');
  const updateEnd = src.indexOf('if (restoreErr)', updateStart);
  const updateBlock = updateStart >= 0 && updateEnd > updateStart ? src.slice(updateStart, updateEnd) : '';

  assert.ok(updateBlock, 'restore update block must be extractable');
  assert.match(updateBlock, /\.update\(\{ archived_at: null \}\)/,
    'restore must update only archived_at to null');
  assert.match(updateBlock, /\.eq\("id", organizationId\)[\s\S]*\.eq\("owner_id", auth\.user\.id\)[\s\S]*\.not\("archived_at", "is", null\)/,
    'restore update must be guarded by id, owner_id, and currently archived state');
  assert.doesNotMatch(updateBlock, /organization_members|organization_invites|billing_customers|subscriptions|storage|packs|cases/i,
    'restore update block must not mutate unrelated tables');
});

test('phase 0.6D Batch B restore has workspace limit protection without external billing calls', async () => {
  const src = await fs.readFile(orgRestoreWorkspacePath, 'utf8');
  const limitStart = src.indexOf('async function verifyRestoreFitsWorkspaceLimit');
  const limitEnd = src.indexOf('Deno.serve', limitStart);
  const limitFn = limitStart >= 0 && limitEnd > limitStart ? src.slice(limitStart, limitEnd) : '';

  assert.ok(limitFn, 'workspace limit helper must be extractable');
  assert.match(limitFn, /\.from\("organizations"\)[\s\S]*\.eq\("owner_id", ownerId\)/,
    'workspace limit check must read owner workspaces');
  assert.match(limitFn, /\.from\("subscriptions"\)[\s\S]*\.select\(/,
    'workspace limit check may read subscription projection rows');
  assert.match(limitFn, /\.from\("billing_customers"\)[\s\S]*\.select\(/,
    'workspace limit check may read customer projection rows');
  assert.match(src, /RESTORE_LIMIT_ERROR[\s\S]*status:\s*409/,
    'workspace limit failures must return 409');
  assert.doesNotMatch(limitFn, /\.from\("billing_customers"\)[\s\S]{0,180}\.(insert|update|upsert|delete)\(/,
    'restore must not mutate customer projection rows');
  assert.doesNotMatch(limitFn, /\.from\("subscriptions"\)[\s\S]{0,180}\.(insert|update|upsert|delete)\(/,
    'restore must not mutate subscription projection rows');
  assert.doesNotMatch(src, /stripe|billing-status/i,
    'restore Edge Function must not call payment provider code or billing-status');
});

test('phase 0.6D Batch B config disables platform JWT verification for restore Edge Function', async () => {
  const src = await fs.readFile(supabaseConfigPath, 'utf8');
  const start = src.indexOf('[functions.org-restore-workspace]');
  const end = src.indexOf('[functions.', start + 1);
  const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : '';

  assert.ok(block, 'config must include org-restore-workspace function block');
  assert.match(block, /verify_jwt\s*=\s*false/,
    'org-restore-workspace must use app-level requireUser auth with verify_jwt=false');
});

test('phase 0.6D Batch B service and client expose restore/list wrappers', async () => {
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const clientSrc = await fs.readFile(supabasePath, 'utf8');

  assert.match(billingSrc, /export async function restoreWorkspace\(orgId\)/,
    'billing service must export restoreWorkspace');
  assert.match(billingSrc, /postFn\('\/org-restore-workspace'[\s\S]*organization_id: orgId/,
    'restoreWorkspace must POST organization_id to restore Edge Function');
  assert.match(billingSrc, /resolveFnError\(res, data, 'Restore workspace failed'\)/,
    'restoreWorkspace must preserve server error messages');
  assert.match(clientSrc, /export async function getUserArchivedOrganizations\(\)/,
    'Supabase client must export getUserArchivedOrganizations');
  assert.match(clientSrc, /client\.rpc\('get_user_archived_organizations'\)/,
    'getUserArchivedOrganizations must call archived workspace RPC');
  assert.match(clientSrc, /getUserArchivedOrganizations,/,
    'getUserArchivedOrganizations must be exposed on window.SupabaseClient API');
});

test('phase 0.6D Batch B app exposes handleWorkspaceRestored without signout or reload', async () => {
  const src = await fs.readFile(appPath, 'utf8');
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

test('phase 0.6D Batch B Settings UI has archived workspace restore flow', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /restoreWorkspace as restoreWorkspaceFn/,
    'settings overlay must import restoreWorkspace wrapper');
  assert.match(src, /async function loadArchivedWorkspaces\(\{ force = false \} = \{\}\)/,
    'settings overlay must load archived workspaces independently');
  assert.match(src, /appendArchivedWorkspacesSection\(targetEl, currentUserId\)/,
    'settings overlay must render an Archived Workspaces section');
  assert.match(src, /Archived Workspaces/,
    'settings overlay must show Archived Workspaces copy');
  assert.match(src, /String\(org\.owner_id\) === String\(currentUserId\)/,
    'restore button must be shown only for archived workspaces owned by the current user');
  assert.match(src, /UIComponents\.confirm\(\{[\s\S]*title: 'Restore Workspace'/,
    'restore flow must use existing confirm UI pattern');
  assert.match(src, /restoreWorkspaceFn\(normalizedOrgId\)/,
    'settings restore handler must call the restore service wrapper');
  assert.match(src, /TruckPackerApp\.handleWorkspaceRestored\(normalizedOrgId/,
    'restore success must notify app lifecycle handler');
});

test('phase 0.6D Batch B restore implementation avoids forbidden scope', async () => {
  const edgeSrc = await fs.readFile(orgRestoreWorkspacePath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');
  const billingStart = billingSrc.indexOf('export async function restoreWorkspace(orgId)');
  const billingEnd = billingSrc.indexOf('/**\n * Archive a workspace', billingStart);
  const billingWrapper = billingStart >= 0 && billingEnd > billingStart ? billingSrc.slice(billingStart, billingEnd) : '';
  const appSrc = await fs.readFile(appPath, 'utf8');
  const appStart = appSrc.indexOf('function handleWorkspaceRestored(restoredOrgId, options = {})');
  const appEnd = appSrc.indexOf('function handleOwnershipTransferred', appStart);
  const appHandler = appStart >= 0 && appEnd > appStart ? appSrc.slice(appStart, appEnd) : '';
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const settingsStart = settingsSrc.indexOf('async function restoreArchivedWorkspace(orgId, orgName)');
  const settingsEnd = settingsSrc.indexOf('async function archiveWorkspace(orgId, orgName)', settingsStart);
  const settingsRestoreFlow = settingsStart >= 0 && settingsEnd > settingsStart ? settingsSrc.slice(settingsStart, settingsEnd) : '';
  const sources = [
    ['restore edge', edgeSrc],
    ['billing wrapper', billingWrapper],
    ['app restore handler', appHandler],
    ['settings restore flow', settingsRestoreFlow],
  ];

  for (const [label, src] of sources) {
    assert.doesNotMatch(src, /stripe|billing-status|stripe_customers|webhook_events|checkout|portal|webhook/i,
      `${label} must not touch payment provider functions or billing-status`);
    assert.doesNotMatch(src, /org-invite|org-member|request-account-deletion|cancel-account-deletion|purge-deleted|deletePack|deleteCase|storage\.from|router\.|location\.reload|signOut/i,
      `${label} must not touch invite/member/account deletion/purge/packs/cases/storage/router/reload/signOut`);
  }
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

// ── Phase 0.7A-1: Workspace export safety baseline ─────────────────────────

test('phase 0.7A-1 exportAppJSON exists and returns JSON.stringify output', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /return JSON\.stringify\(payload,\s*null,\s*2\)/,
    'exportAppJSON must return pretty JSON.stringify output');
});

test('phase 0.7A-1 exportAppJSON reads from StateStore and not raw localStorage scanning', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /StateStore\.get\(\)/,
    'exportAppJSON must read the in-memory StateStore snapshot');
  assert.doesNotMatch(fn, /localStorage|window\.localStorage|STORAGE_KEY|getScopedKey|getWorkspaceScopedKey/,
    'exportAppJSON must not scan raw localStorage keys');
});

test('phase 0.7A-1 exportAppJSON top-level payload keys remain limited', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /app:\s*'Truck Packer 3D'/,
    'exportAppJSON must include app');
  assert.match(fn, /version:\s*APP_VERSION/,
    'exportAppJSON must include version');
  assert.match(fn, /exportedAt:\s*Date\.now\(\)/,
    'exportAppJSON must include exportedAt');
  assert.match(fn, /data:\s*\{/,
    'exportAppJSON must include data object');
  assert.doesNotMatch(fn, /exportType:|schemaVersion:|appVersion:|workspaceName:|organization_id:|owner_id:|user_id:|\bemail:/,
    'exportAppJSON must not include workspace export or server identity top-level keys');
});

test('phase 0.7A-1 exportAppJSON data keys include local backup libraries only', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.match(fn, /caseLibrary:\s*state\.caseLibrary/,
    'exportAppJSON data must include caseLibrary');
  assert.match(fn, /packLibrary:\s*state\.packLibrary/,
    'exportAppJSON data must include packLibrary');
  assert.match(fn, /folderLibrary:\s*Array\.isArray\(state\.folderLibrary\)/,
    'exportAppJSON data must include folderLibrary once folders are live');
  assert.match(fn, /preferences:\s*state\.preferences/,
    'exportAppJSON data must include preferences');
  assert.doesNotMatch(fn, /currentPackId/,
    'exportAppJSON must not export transient currentPackId');
  assert.doesNotMatch(fn, /billing|members|invites/,
    'exportAppJSON must not include billing, members, or invites in app export');
});

test('phase 0.7A-1 exportAppJSON does not export auth session token fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /access_token|refresh_token|id_token|bearer|authorization|service_role|apikey|apiKey/i,
    'exportAppJSON must not export auth/session token or key fields');
});

test('phase 0.7A-1 exportAppJSON does not export Stripe or billing fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /stripe_customer_id|stripe_subscription_id|customer_id|subscription_id|billing_customers|subscriptions/i,
    'exportAppJSON must not export Stripe or billing identifiers');
});

test('phase 0.7A-1 exportAppJSON does not export org server identity fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|\bemail\b|organization_members|auth\.users/i,
    'exportAppJSON must not export org/server identity fields');
});

test('phase 0.7A-1 buildAppExportJSON delegates to CoreStorage.exportAppJSON', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function buildAppExportJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'buildAppExportJSON must be extractable');
  assert.match(fn, /CoreStorage\.exportAppJSON\(\)/,
    'buildAppExportJSON must delegate to CoreStorage.exportAppJSON');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|stripe|billing|token|apikey|apiKey|localStorage/i,
    'buildAppExportJSON wrapper must not inject unsafe fields');
});

test('phase 0.7A-1 baseline app export does not include exportType', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportAppJSON()');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportAppJSON must be extractable');
  assert.doesNotMatch(fn, /exportType/,
    'baseline app export must not include exportType yet');
});

// ── Phase 0.7A-2: Workspace JSON export MVP ────────────────────────────────

test('phase 0.7A-2 exportWorkspaceJSON exists and returns JSON.stringify output', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /return JSON\.stringify\(payload,\s*null,\s*2\)/,
    'exportWorkspaceJSON must return pretty JSON.stringify output');
});

test('phase 0.7A-2 exportWorkspaceJSON marks workspace export schema', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /app:\s*'Truck Packer 3D'/,
    'workspace export must include app name');
  assert.match(fn, /exportType:\s*'workspace'/,
    'workspace export must set exportType to workspace');
  assert.match(fn, /schemaVersion:\s*'workspace-export-v1'/,
    'workspace export must set schemaVersion to workspace-export-v1');
  assert.match(fn, /appVersion:\s*APP_VERSION/,
    'workspace export must include appVersion from APP_VERSION');
  assert.match(fn, /exportedAt:\s*Date\.now\(\)/,
    'workspace export must include exportedAt');
  assert.match(fn, /workspaceName:/,
    'workspace export must include display-only workspaceName');
});

test('phase 0.7A-2 exportWorkspaceJSON reads from StateStore and not raw storage keys', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /StateStore\.get\(\)/,
    'workspace export must read the in-memory StateStore snapshot');
  assert.doesNotMatch(fn, /localStorage|window\.localStorage|STORAGE_KEY|getScopedKey|getWorkspaceScopedKey/,
    'workspace export must not scan raw localStorage keys');
});

test('phase 0.7A-2 exportWorkspaceJSON data is limited to workspace libraries', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /caseLibrary:/,
    'workspace export must include caseLibrary');
  assert.match(fn, /packLibrary:\s*strippedPacks/,
    'workspace export must include stripped packLibrary');
  assert.match(fn, /folderLibrary:\s*Array\.isArray\(state\.folderLibrary\)/,
    'workspace export must include folderLibrary');
  assert.doesNotMatch(fn, /preferences:\s*state\.preferences|currentPackId/,
    'workspace export must not include preferences or currentPackId');
});

test('phase 0.7A-2 exportWorkspaceJSON strips pack thumbnails', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /thumbnail:\s*null/,
    'workspace export must set pack thumbnail to null');
  assert.match(fn, /thumbnailUpdatedAt:\s*null/,
    'workspace export must set thumbnailUpdatedAt to null');
});

test('phase 0.7A-2 exportWorkspaceJSON does not expose auth billing or server identity fields', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.doesNotMatch(fn, /access_token|refresh_token|id_token|bearer|authorization|service_role|apikey|apiKey/i,
    'workspace export must not include auth/session tokens or Supabase keys');
  assert.doesNotMatch(fn, /stripe_customer_id|stripe_subscription_id|customer_id|subscription_id|billing_customers|subscriptions/i,
    'workspace export must not include Stripe or billing identifiers');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|\bemail\b|organization_members|auth\.users|storage\.from/i,
    'workspace export must not include server identity, membership, auth table, or private storage fields');
});

test('phase 0.7A-2 buildWorkspaceExportJSON delegates to CoreStorage.exportWorkspaceJSON', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function buildWorkspaceExportJSON(');
  const end = src.indexOf('\nexport function', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'buildWorkspaceExportJSON must be extractable');
  assert.match(fn, /CoreStorage\.exportWorkspaceJSON\(workspaceName\)/,
    'buildWorkspaceExportJSON must delegate to CoreStorage.exportWorkspaceJSON');
  assert.doesNotMatch(fn, /organization_id|owner_id|user_id|stripe|billing|token|apikey|apiKey|localStorage/i,
    'buildWorkspaceExportJSON wrapper must not inject unsafe fields');
});

test('phase 0.7A-2 parseWorkspaceImportJSON validates workspace export type', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function parseWorkspaceImportJSON(');
  const fn = start >= 0 ? src.slice(start) : '';

  assert.ok(fn, 'parseWorkspaceImportJSON must be extractable');
  assert.match(fn, /parsed\.exportType\s*!==\s*'workspace'/,
    'workspace import parser must require exportType workspace');
  assert.match(fn, /Not a workspace export file/,
    'workspace import parser must throw a clear non-workspace error');
});

test('phase 0.7A-2 parseWorkspaceImportJSON validates case and pack arrays', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function parseWorkspaceImportJSON(');
  const fn = start >= 0 ? src.slice(start) : '';

  assert.ok(fn, 'parseWorkspaceImportJSON must be extractable');
  assert.match(fn, /Array\.isArray\(data\.caseLibrary\)/,
    'workspace import parser must validate caseLibrary array');
  assert.match(fn, /Array\.isArray\(data\.packLibrary\)/,
    'workspace import parser must validate packLibrary array');
  assert.match(fn, /workspaceName:\s*parsed\.workspaceName \? String\(parsed\.workspaceName\) : ''/,
    'workspace import parser must return a safe workspaceName string');
});

test('phase 0.7A-2 app exposes workspace export modal using existing download path', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function openExportWorkspaceModal(');
  const end = src.indexOf('\n    function openImportAppDialog', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'openExportWorkspaceModal must be extractable');
  assert.match(fn, /ImportExport\.buildWorkspaceExportJSON\(safeName\)/,
    'workspace export modal must build workspace JSON through ImportExport');
  assert.match(fn, /Utils\.downloadText\(filename, json\)/,
    'workspace export modal must use existing downloadText path');
  assert.match(fn, /UIComponents\.showModal\(/,
    'workspace export modal must use existing modal pattern');
  assert.match(fn, /UIComponents\.showToast\(/,
    'workspace export modal must use existing toast pattern');
  assert.doesNotMatch(fn, /signOut|location\.reload|stripe|organization_id|owner_id|user_id|auth\.users|organization_members/i,
    'workspace export modal must not touch auth, reload, Stripe, or server identity data');
});

test('phase 0.7A-2 Settings General has Owner Admin gated Export Workspace Data action', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /onExportWorkspace:\s*_onExportWorkspace/,
    'settings overlay must accept onExportWorkspace callback');
  assert.match(src, /if \(isOwnerOrAdmin && typeof _onExportWorkspace === 'function'\)/,
    'workspace export action must fail closed unless owner/admin role and callback are available');
  assert.match(src, /Export Workspace Data/,
    'settings general must include Export Workspace Data action label');
  assert.match(src, /_onExportWorkspace\(wsName\)/,
    'settings general export button must call onExportWorkspace with workspace display name');
});

test('phase 0.7A-2 Settings includes archive export reminder without forcing archive export', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /Before archiving or making major workspace changes, you may export a workspace JSON backup\./,
    'archive section must include optional workspace export reminder');
  assert.doesNotMatch(src, /await _onExportWorkspace|if \(confirmed\) await _onExportWorkspace/,
    'archive flow must not force workspace export before archiving');
});

test('phase 0.7A-2 workspace export integration is wired into settings overlay only', async () => {
  const src = await fs.readFile(appPath, 'utf8');

  assert.match(src, /onExportWorkspace:\s*openExportWorkspaceModal/,
    'app must wire openExportWorkspaceModal into settings overlay');
  assert.doesNotMatch(src, /window\.TruckPackerApp\.openExportWorkspace|window\.openExportWorkspace/,
    'workspace export must not add global browser entry points');
});

test('phase 0.7A-2 workspace export code avoids backend and lifecycle scope', async () => {
  const storageSrc = await fs.readFile(storagePath, 'utf8');
  const storageStart = storageSrc.indexOf('export function exportWorkspaceJSON(');
  const storageEnd = storageSrc.indexOf('\nexport function', storageStart + 1);
  const storageFn = storageStart >= 0 && storageEnd > storageStart ? storageSrc.slice(storageStart, storageEnd) : '';

  const importExportSrc = await fs.readFile(importExportPath, 'utf8');
  const buildStart = importExportSrc.indexOf('export function buildWorkspaceExportJSON(');
  const exportFns = buildStart >= 0 ? importExportSrc.slice(buildStart) : '';
  const combined = `${storageFn}\n${exportFns}`;

  assert.doesNotMatch(combined, /supabase\/functions|functions\.invoke|createClient|serviceClient|EdgeFunction|migration/i,
    'workspace export must not add Edge Function or migration behavior');
  assert.doesNotMatch(combined, /billing-status|stripe|checkout|portal|webhook|billing_customers|subscriptions/i,
    'workspace export must not touch Stripe, billing-status, or billing tables');
  assert.doesNotMatch(combined, /archiveWorkspace|restoreWorkspace|transferOwnership|leaveWorkspace|requestAccountDeletion|purge/i,
    'workspace export must not touch workspace lifecycle or account deletion/purge flows');
});

// ============================================================================
// PHASE 0.7B-1B — Folder System Data Model Foundation
// ============================================================================

test('phase 0.7B-1B folderLibrary is a significant state key and history slice', async () => {
  const src = await fs.readFile(stateStorePath, 'utf8');
  const historyStart = src.indexOf('function historySlice(');
  const historyEnd = src.indexOf('\nfunction withWorkspaceDefaults', historyStart + 1);
  const historyFn = historyStart >= 0 && historyEnd > historyStart ? src.slice(historyStart, historyEnd) : '';
  const start = src.indexOf('function isSignificantChange(');
  const end = src.indexOf('\nexport {', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(historyFn, 'historySlice must be extractable');
  assert.match(historyFn, /folderLibrary:\s*s\.folderLibrary/,
    'folderLibrary must participate in StateStore history snapshots');
  assert.ok(fn, 'isSignificantChange must be extractable');
  assert.match(fn, /'folderLibrary'/,
    'folderLibrary must be a significant state key');
});

test('phase 0.7B-1B normalizer defines pack folders and clears stale folderId', async () => {
  const src = await fs.readFile(normalizerPath, 'utf8');
  const folderStart = src.indexOf('export function normalizeFolder(');
  const folderEnd = src.indexOf('\nexport function normalizePack', folderStart + 1);
  const folderFn = folderStart >= 0 && folderEnd > folderStart ? src.slice(folderStart, folderEnd) : '';
  const start = src.indexOf('export function normalizePack(');
  const end = src.indexOf('\nexport function normalizeAppData', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';
  const appStart = src.indexOf('export function normalizeAppData(');
  const appFn = appStart >= 0 ? src.slice(appStart) : '';

  assert.ok(folderFn, 'normalizeFolder must be extractable');
  assert.match(folderFn, /scope:\s*'pack'/,
    'normalizeFolder must keep folders pack-scoped');
  assert.match(folderFn, /parentFolderId:\s*null/,
    'normalizeFolder must keep parentFolderId null in this phase');
  assert.ok(fn, 'normalizePack must be extractable');
  assert.match(fn, /const folderId = safeString\(p && p\.folderId, ''\) \|\| null/,
    'normalizePack must default folderId to null');
  assert.match(fn, /folderId,/,
    'normalizePack must include folderId in normalized packs');
  assert.match(appFn, /folderLibrary:\s*folders/,
    'normalizeAppData must return normalized folderLibrary');
  assert.match(appFn, /if \(pack\.folderId && !folderIds\.has\(pack\.folderId\)\) pack\.folderId = null;/,
    'normalizeAppData must clear stale pack folderId references');
});

test('phase 0.7B-1B normalizer returns safe pack-only folder shape and nulls stale folderId at runtime', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);

  const folder = Normalizer.normalizeFolder({
    id: 'folder-1',
    name: ' Client Work ',
    scope: 'case',
    parentFolderId: 'nested-folder',
    sortOrder: '12',
    createdAt: 100,
    updatedAt: 200,
    unexpected: 'drop-me',
  }, 1);

  assert.deepEqual(Object.keys(folder), ['id', 'name', 'scope', 'parentFolderId', 'sortOrder', 'createdAt', 'updatedAt'],
    'normalizeFolder must return only the approved folder fields');
  assert.equal(folder.name, 'Client Work',
    'normalizeFolder must trim names');
  assert.equal(folder.scope, 'pack',
    'normalizeFolder must force pack-only scope');
  assert.equal(folder.parentFolderId, null,
    'normalizeFolder must keep nesting disabled in this phase');

  const normalized = Normalizer.normalizeAppData({
    caseLibrary: [],
    folderLibrary: [folder],
    packLibrary: [
      { id: 'pack-1', title: 'Known', folderId: 'folder-1', cases: [] },
      { id: 'pack-2', title: 'Stale', folderId: 'missing-folder', cases: [] },
      { id: 'pack-3', title: 'Empty', cases: [] },
    ],
    preferences: {},
  });

  assert.equal(normalized.packLibrary[0].folderId, 'folder-1',
    'normalizeAppData must preserve valid pack folderId');
  assert.equal(normalized.packLibrary[1].folderId, null,
    'normalizeAppData must null stale pack folderId');
  assert.equal(normalized.packLibrary[2].folderId, null,
    'normalizePack must default missing folderId to null');
});

test('phase 0.7B-1B storage saves and loads folderLibrary only in workspace payload', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const loadStart = src.indexOf('export function load()');
  const loadEnd = src.indexOf('\nexport function saveSoon', loadStart + 1);
  const loadFn = loadStart >= 0 && loadEnd > loadStart ? src.slice(loadStart, loadEnd) : '';
  const start = src.indexOf('export function saveNow()');
  const end = src.indexOf('\nexport function clearAll', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';
  const userPayloadStart = fn.indexOf('const userPayload = {');
  const workspacePayloadStart = fn.indexOf('const workspacePayload = {');
  const userPayload = userPayloadStart >= 0 && workspacePayloadStart > userPayloadStart
    ? fn.slice(userPayloadStart, workspacePayloadStart)
    : '';

  assert.ok(loadFn, 'load must be extractable');
  assert.match(loadFn, /folderLibrary:[\s\S]{0,140}workspacePayload\.folderLibrary/,
    'load must return folderLibrary from workspace payload');
  assert.ok(fn, 'saveNow must be extractable');
  assert.doesNotMatch(userPayload, /folderLibrary/,
    'folderLibrary must not be saved in user-scoped preferences payload');
  assert.match(fn, /folderLibrary:\s*Array\.isArray\(state\.folderLibrary\)/,
    'saveNow workspace payload must include folderLibrary');
});

test('phase 0.7B-1B storage load defaults missing folderLibrary to empty workspace array', async () => {
  const Storage = await import(`${storagePath.href}?t=${Date.now()}-${Math.random()}`);
  const originalWindow = globalThis.window;
  const values = new Map();
  const localStorage = {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
  };

  try {
    globalThis.window = { localStorage };
    Storage.setStorageScope('user-1');
    Storage.setWorkspaceScope('org-1');
    localStorage.setItem('truckPacker3d:v1:user-1', JSON.stringify({
      version: 'test',
      savedAt: 1,
      preferences: {},
    }));
    localStorage.setItem('truckPacker3d:v1:user-1:workspace:org-1', JSON.stringify({
      version: 'test',
      savedAt: 2,
      caseLibrary: [],
      packLibrary: [],
      currentPackId: null,
    }));

    const loaded = Storage.load();
    assert.deepEqual(loaded.folderLibrary, [],
      'load must default old workspace payloads without folderLibrary to []');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('phase 0.7B-1B exportWorkspaceJSON includes folderLibrary and preserves pack folderId', async () => {
  const src = await fs.readFile(storagePath, 'utf8');
  const start = src.indexOf('export function exportWorkspaceJSON(');
  const end = src.indexOf('\nexport function importAppJSON', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'exportWorkspaceJSON must be extractable');
  assert.match(fn, /folderLibrary:\s*Array\.isArray\(state\.folderLibrary\)/,
    'workspace export must include folderLibrary');
  assert.doesNotMatch(fn, /folderId:\s*null/,
    'workspace export must not strip pack folderId');
  assert.match(fn, /thumbnail:\s*null/,
    'workspace export must keep thumbnail stripping');
});

test('phase 0.7B-1B parseWorkspaceImportJSON accepts optional folderLibrary arrays', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function parseWorkspaceImportJSON(');
  const fn = start >= 0 ? src.slice(start) : '';

  assert.ok(fn, 'parseWorkspaceImportJSON must be extractable');
  assert.match(fn, /data\.folderLibrary != null && !Array\.isArray\(data\.folderLibrary\)/,
    'workspace import parser must reject non-array folderLibrary');
  assert.match(fn, /folderLibrary:\s*Array\.isArray\(data\.folderLibrary\) \? data\.folderLibrary : \[\]/,
    'workspace import parser must default missing folderLibrary to []');
});

test('phase 0.7B-1B workspace import parser accepts old exports and rejects malformed folderLibrary at runtime', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const oldExport = JSON.stringify({
    app: 'Truck Packer 3D',
    exportType: 'workspace',
    data: {
      caseLibrary: [],
      packLibrary: [],
    },
  });
  const parsed = ImportExport.parseWorkspaceImportJSON(oldExport);

  assert.deepEqual(parsed.folderLibrary, [],
    'workspace import parser must default missing folderLibrary to []');
  assert.throws(() => ImportExport.parseWorkspaceImportJSON(JSON.stringify({
    exportType: 'workspace',
    data: {
      caseLibrary: [],
      packLibrary: [],
      folderLibrary: {},
    },
  })), /Invalid folderLibrary/,
    'workspace import parser must reject non-array folderLibrary');
});

test('phase 0.7B-1B app export includes and imports normalized folderLibrary as full local backup', async () => {
  const StateStore = await import(stateStorePath.href);
  const Storage = await import(`${storagePath.href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [],
    packLibrary: [
      { id: 'pack-1', title: 'Known', folderId: 'folder-1', cases: [] },
      { id: 'pack-2', title: 'Stale', folderId: 'missing-folder', cases: [] },
    ],
    folderLibrary: [
      {
        id: 'folder-1',
        name: 'Folder 1',
        scope: 'pack',
        parentFolderId: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    preferences: {},
  });

  const exported = JSON.parse(Storage.exportAppJSON());
  assert.equal(exported.data.folderLibrary.length, 1,
    'App Export is the full local backup path and must include folderLibrary');

  const imported = Storage.importAppJSON(JSON.stringify({
    app: 'Truck Packer 3D',
    data: {
      caseLibrary: [],
      packLibrary: exported.data.packLibrary,
      folderLibrary: exported.data.folderLibrary,
      preferences: {},
    },
  }));
  assert.equal(imported.packLibrary[0].folderId, 'folder-1',
    'App Import must preserve valid folderId references');
  assert.equal(imported.packLibrary[1].folderId, null,
    'App Import must normalize stale folderId references to null');
});

test('phase 0.7B-1B single pack export does not carry folder assignments', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  const start = src.indexOf('export function buildPackExportPayload(');
  const end = src.indexOf('\nexport function buildPackExportJSON', start + 1);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'buildPackExportPayload must be extractable');
  assert.match(fn, /folderId:\s*null/,
    'single pack export must clear folderId until single-pack folder import exists');
});

test('phase 0.7B-1B single pack import clears folderId to null', async () => {
  const src = await fs.readFile(new URL('../../src/services/pack-library.js', import.meta.url), 'utf8');
  const start = src.indexOf('export function importPackPayload(');
  const fn = start >= 0 ? src.slice(start) : '';

  assert.ok(fn, 'importPackPayload must be extractable');
  assert.match(fn, /pack\.folderId\s*=\s*null/,
    'single pack import must clear folderId because folder import is workspace-level only');
});

test('phase 0.7B-1B folder-library service is local StateStore only', async () => {
  const src = await fs.readFile(folderLibraryPath, 'utf8');

  assert.match(src, /from '\.\.\/core\/state-store\.js'/,
    'folder service must use StateStore');
  assert.match(src, /from '\.\.\/core\/utils\/index\.js'/,
    'folder service may use local utilities for UUIDs');
  assert.doesNotMatch(src, /supabase|functions\.invoke|serviceClient|createClient|EdgeFunction/i,
    'folder service must not use Supabase or Edge Functions');
  assert.doesNotMatch(src, /stripe|billing|billing-status|checkout|portal|webhook/i,
    'folder service must not touch Stripe or billing');
  assert.doesNotMatch(src, /localStorage|window\.localStorage|signOut|location\.reload/i,
    'folder service must not read raw storage, sign out, or reload');
  assert.doesNotMatch(src, /organization_id|owner_id|user_id|auth\.users|organization_members/i,
    'folder service must not use server identity or membership fields');
});

test('phase 0.7B-1B folder-library create list rename move use StateStore data only', async () => {
  const StateStore = await import(stateStorePath.href);
  const FolderLibrary = await import(`${folderLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [],
    packLibrary: [{ id: 'pack-1', title: 'Pack 1', folderId: null }],
    folderLibrary: [],
    preferences: {},
  });

  const a = FolderLibrary.createFolder('Beta');
  const b = FolderLibrary.createFolder('Alpha');
  assert.equal(a.scope, 'pack',
    'createFolder must create pack-scoped folders');
  assert.equal(a.parentFolderId, null,
    'createFolder must not create nested folders in this phase');
  assert.deepEqual(FolderLibrary.listFolders().map(folder => folder.name), ['Beta', 'Alpha'],
    'listFolders must return StateStore folders in sort order');

  const renamed = FolderLibrary.renameFolder(b.id, 'Alpha Renamed');
  assert.equal(renamed.name, 'Alpha Renamed',
    'renameFolder must update by id, not by name');
  assert.equal(FolderLibrary.movePackToFolder('pack-1', b.id).folderId, b.id,
    'movePackToFolder must assign a valid folder id');
});

test('phase 0.7B-1B deleteFolder nulls pack folder references without deleting packs or cases', async () => {
  const StateStore = await import(stateStorePath.href);
  const FolderLibrary = await import(`${folderLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [{ id: 'case-1', name: 'Case 1' }],
    packLibrary: [
      { id: 'pack-1', title: 'Pack 1', folderId: 'folder-1', cases: [{ id: 'inst-1', caseId: 'case-1' }], thumbnail: 'preview' },
      { id: 'pack-2', title: 'Pack 2', folderId: 'folder-1' },
      { id: 'pack-3', title: 'Pack 3', folderId: null },
    ],
    folderLibrary: [
      {
        id: 'folder-1',
        name: 'Folder 1',
        scope: 'pack',
        parentFolderId: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    preferences: {},
  });

  assert.equal(FolderLibrary.deleteFolder('folder-1'), true);
  const state = StateStore.get();

  assert.equal(state.folderLibrary.length, 0,
    'deleteFolder must remove the folder');
  assert.equal(state.packLibrary.length, 3,
    'deleteFolder must not delete packs');
  assert.deepEqual(state.packLibrary.map(pack => pack.folderId), [null, null, null],
    'deleteFolder must null affected pack folderId values');
  assert.equal(state.caseLibrary.length, 1,
    'deleteFolder must not touch cases');
  assert.deepEqual(state.packLibrary[0].cases, [{ id: 'inst-1', caseId: 'case-1' }],
    'deleteFolder must not delete pack contents');
  assert.equal(state.packLibrary[0].thumbnail, 'preview',
    'deleteFolder must not delete pack previews');
});

test('phase 0.7B-1B pack delete does not mutate folderLibrary', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${new URL('../../src/services/pack-library.js', import.meta.url).href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [],
    packLibrary: [{ id: 'pack-1', title: 'Pack 1', folderId: 'folder-1' }],
    folderLibrary: [
      {
        id: 'folder-1',
        name: 'Folder 1',
        scope: 'pack',
        parentFolderId: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    preferences: {},
    currentPackId: 'pack-1',
  });

  PackLibrary.remove('pack-1');
  const state = StateStore.get();

  assert.equal(state.packLibrary.length, 0,
    'PackLibrary.remove must delete the pack');
  assert.equal(state.folderLibrary.length, 1,
    'PackLibrary.remove must not mutate folderLibrary');
  assert.equal(state.folderLibrary[0].id, 'folder-1',
    'folder identity must survive pack deletion');
});

test('phase 0.7B-1B movePackToFolder requires existing folder identity and allows null', async () => {
  const StateStore = await import(stateStorePath.href);
  const FolderLibrary = await import(`${folderLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [],
    packLibrary: [{ id: 'pack-1', title: 'Pack 1', folderId: null, lastEdited: 1 }],
    folderLibrary: [
      {
        id: 'folder-1',
        name: 'Folder 1',
        scope: 'pack',
        parentFolderId: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    preferences: {},
  });

  const moved = FolderLibrary.movePackToFolder('pack-1', 'folder-1');
  assert.equal(moved.folderId, 'folder-1',
    'movePackToFolder must assign an existing folder id');
  assert.equal(FolderLibrary.movePackToFolder('pack-1', 'missing-folder'), null,
    'movePackToFolder must reject unknown folder ids');
  const removed = FolderLibrary.movePackToFolder('pack-1', null);
  assert.equal(removed.folderId, null,
    'movePackToFolder must allow moving a pack back to uncategorized');
});

test('phase 0.7B-1B partial StateStore updates preserve existing folderLibrary', async () => {
  const StateStore = await import(stateStorePath.href);

  StateStore.init({
    caseLibrary: [],
    packLibrary: [{ id: 'pack-1', title: 'Pack 1', folderId: 'folder-1' }],
    folderLibrary: [{ id: 'folder-1', name: 'Folder 1' }],
    preferences: {},
  });

  StateStore.set({ packLibrary: [{ id: 'pack-2', title: 'Pack 2', folderId: null }] });
  assert.deepEqual(StateStore.get('folderLibrary'), [{ id: 'folder-1', name: 'Folder 1' }],
    'StateStore.set partial updates must not wipe folderLibrary');

  StateStore.set({ folderLibrary: [] });
  assert.deepEqual(StateStore.get('folderLibrary'), [],
    'StateStore.set must update folderLibrary only when explicitly provided');
});

test('phase 0.7B-1B workspace export runtime payload includes folderLibrary', async () => {
  const StateStore = await import(stateStorePath.href);
  const Storage = await import(`${storagePath.href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [],
    packLibrary: [{ id: 'pack-1', title: 'Pack 1', folderId: 'folder-1', thumbnail: 'data:image/jpeg;base64,x' }],
    folderLibrary: [
      {
        id: 'folder-1',
        name: 'Folder 1',
        scope: 'pack',
        parentFolderId: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    preferences: {},
  });

  const payload = JSON.parse(Storage.exportWorkspaceJSON('Workspace A'));
  assert.equal(payload.data.folderLibrary.length, 1,
    'workspace export must include folderLibrary');
  assert.equal(payload.data.packLibrary[0].folderId, 'folder-1',
    'workspace export must preserve pack folderId');
  assert.equal(payload.data.packLibrary[0].thumbnail, null,
    'workspace export must keep thumbnail stripping');
});

test('phase 0.7B-1B folder foundation and production readiness changes stay inside allowed files', async () => {
  const forbiddenPaths = [
    'index.html',
    'styles',
    'package.json',
    'package-lock.json',
    'supabase/functions',
    'supabase/migrations',
    'supabase/config.toml',
  ];
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--', ...forbiddenPaths]);
  const changedForbiddenFiles = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(file => file !== 'styles/main.css');

  assert.deepEqual(changedForbiddenFiles, [],
    'folder foundation and production readiness fixes must not change package, index.html, migrations, Edge Functions, billing-status, Stripe, workspace lifecycle, folder UI, auth files, or CSS outside the 0.7C-1B Packs control polish');
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

test('phase 0.7C-pre folderLibrary changes participate in autosave with packLibrary changes', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const saveCall = 'Storage.saveSoon();';
  const saveCallIndex = src.indexOf(saveCall);
  const conditionStart = src.lastIndexOf('if (', saveCallIndex);
  const autosaveBlock = conditionStart >= 0 && saveCallIndex > conditionStart
    ? src.slice(conditionStart, saveCallIndex + saveCall.length)
    : '';

  assert.ok(autosaveBlock.length > 0,
    'app StateStore autosave block must be extractable');
  assert.match(autosaveBlock, /changes\.packLibrary/,
    'autosave block must still include packLibrary');
  assert.match(autosaveBlock, /changes\.folderLibrary/,
    'folderLibrary changes must trigger the same autosave path as packLibrary');
  assert.match(autosaveBlock, /!suspendAutoSave/,
    'folderLibrary autosave must preserve existing suspendAutoSave guard');
});

test('phase 0.7C-pre folderLibrary changes trigger Packs screen render with packLibrary changes', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const renderCall = 'PacksUI.render();';
  const renderCallIndex = src.indexOf(renderCall, src.indexOf('StateStore.subscribe(changes =>'));
  const conditionStart = src.lastIndexOf('if (', renderCallIndex);
  const renderBlock = conditionStart >= 0 && renderCallIndex > conditionStart
    ? src.slice(conditionStart, renderCallIndex + renderCall.length)
    : '';

  assert.ok(renderBlock.length > 0,
    'app StateStore packs render block must be extractable');
  assert.match(renderBlock, /changes\.packLibrary/,
    'packs render block must still include packLibrary');
  assert.match(renderBlock, /changes\.folderLibrary/,
    'folderLibrary changes must trigger the same PacksUI.render path as packLibrary');
});

test('phase 0.7C-pre persistence render guard does not import folder UI or touch forbidden scope', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');

  assert.doesNotMatch(appSrc, /import\s+\*\s+as\s+FolderLibrary|from ['"]\.\/services\/folder-library\.js['"]/,
    'Phase 0.7C-pre must not import FolderLibrary into app.js');
  assert.doesNotMatch(appSrc, /createFolder|renameFolder|deleteFolder|movePackToFolder|getPacksInFolder/,
    'Phase 0.7C-pre must not wire folder UI or folder CRUD actions in app.js');
});

// ============================================================================
// PHASE 0.7C-1A — Compact Pack Folder Dropdown
// ============================================================================

test('phase 0.7C folder dropdown changes stay out of forbidden infrastructure files', async () => {
  const forbiddenPaths = [
    'src/app.js',
    'src/core/storage.js',
    'src/core/state-store.js',
    'src/core/normalizer.js',
    'src/services/folder-library.js',
    'src/services/pack-library.js',
    'src/services/import-export.js',
    'src/ui/overlays/settings-overlay.js',
    'src/ui/ui-components.js',
    'index.html',
    'package.json',
    'package-lock.json',
    'supabase/functions',
    'supabase/migrations',
    'supabase/config.toml',
  ];
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--', ...forbiddenPaths]);
  const changedForbiddenFiles = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  assert.deepEqual(changedForbiddenFiles, [],
    'Phase 0.7C folder dropdown work must not touch infrastructure, data model, settings, package, or index files');
});

test('phase 0.7C-1A packs screen uses FolderLibrary listFolders for dropdown options', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.match(src, /import\s+\*\s+as\s+FolderLibrary\s+from ['"]\.\.\/services\/folder-library\.js['"]/,
    'packs screen must import the existing folder-library service');
  assert.match(src, /FolderLibrary\.listFolders\(\)/,
    'folder dropdown options must come from FolderLibrary.listFolders()');
  assert.match(src, /UIComponents\.openDropdown\(button, items/,
    'folder control must use the existing openDropdown pattern');
});

test('phase 0.7C-1A rejected folder chip row pattern is not present', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.doesNotMatch(src, /function renderFolderBar|folderBarEl/,
    'the rejected always-visible folder bar must not be present');
  assert.doesNotMatch(src, /filtersRowEl\.nextSibling|insertBefore\([^)]*filtersRowEl/,
    'folder UI must not be mounted under the Empty Partial Full filter chip row');
  assert.doesNotMatch(src, /aria-label['"], ['"]Pack folder filters|label\.textContent = ['"]Folders['"]/,
    'folder UI must not add a visible Folders label under status filters');
});

test('phase 0.7C-1A folder filtering uses pack folderId identity not folder names', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const filterStart = src.indexOf('if (activeFolderId === null) return true;');
  const filterEnd = src.indexOf('if (activeFolderId === UNFILED_FOLDER_ID)', filterStart);
  const filterBlock = filterStart >= 0 && filterEnd > filterStart
    ? src.slice(filterStart, filterEnd + 140)
    : '';

  assert.ok(filterBlock.length > 0,
    'folder filter block must be extractable');
  assert.match(filterBlock, /p && p\.folderId/,
    'folder filtering must read pack.folderId');
  assert.doesNotMatch(filterBlock, /folder\.name|name === activeFolderId|activeFolderId === .*name/,
    'folder filtering must not use folder names as identity');
});

test('phase 0.7C-1A active folder state updates dataset key button label and workspace reset', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const resetStart = src.indexOf('function resetWorkspaceState()');
  const resetEnd = src.indexOf('\n    function ', resetStart + 1);
  const resetBlock = resetStart >= 0 && resetEnd > resetStart ? src.slice(resetStart, resetEnd) : '';

  assert.match(src, /let activeFolderId = null/,
    'folder filter state must default to All Packs');
  assert.match(src, /const UNFILED_FOLDER_ID = ['"]__unfiled__['"]/,
    'folder filter must support the unfiled sentinel');
  assert.match(src, /newDatasetKey = `\$\{q\}::\$\{sortKey\}::\$\{activeFolderId \|\| 'all'\}::/,
    'activeFolderId must be included in dataset key');
  assert.match(resetBlock, /activeFolderId = null/,
    'workspace reset must clear the active folder filter');
  assert.match(src, /foldersButtonLabelEl\.textContent = label/,
    'Folders button label must reflect active folder state');
  assert.match(src, /label = ['"]Unfiled['"]/,
    'Folders button must show Unfiled when unfiled is active');
  assert.match(src, /label = model\.activeFolder\.name/,
    'Folders button must show the folder name when a real folder is active');
});

test('phase 0.7C-1A existing search and status filters remain present', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.match(src, /\.filter\(p => !q \|\| \(p\.title \|\| ''\)\.toLowerCase\(\)\.includes\(q\) \|\| \(p\.client \|\| ''\)\.toLowerCase\(\)\.includes\(q\)\)/,
    'existing title/client search filter must remain');
  assert.match(src, /filters\.empty[\s\S]{0,80}filters\.partial[\s\S]{0,80}filters\.full/,
    'existing Empty/Partial/Full filter state must remain');
  assert.match(src, /if \(filters\.empty && isEmpty\) return true;/,
    'Empty status filter must remain');
  assert.match(src, /if \(filters\.partial && isPartial\) return true;/,
    'Partial status filter must remain');
  assert.match(src, /if \(filters\.full && isFull\) return true;/,
    'Full status filter must remain');
});

test('phase 0.7C-1A folder dropdown is filter only and avoids CRUD move UI', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.match(src, /defaultActionsEl\.insertBefore\(foldersButtonEl, btnImport\)/,
    'Folders button must be mounted before Import Pack in the top action area');
  assert.match(src, /label: `All Packs \(\$\{model\.totalCount\}\)`/,
    'Folders dropdown must include All Packs with count');
  assert.match(src, /label: `Unfiled \(\$\{model\.unfiledCount\}\)`/,
    'Folders dropdown must include Unfiled with count');
  assert.match(src, /label: ['"]No folders yet['"][\s\S]{0,100}disabled: true/,
    'Folders dropdown must show disabled No folders yet row');
  assert.doesNotMatch(src, /\b(renameFolder|deleteFolder|movePackToFolder|getPacksInFolder)\s*\(/,
    'Phase 0.7C folder UI must not add rename, delete, move, or bulk folder UI');
});

test('phase 0.7C-1A packs screen avoids forbidden backend billing auth css router scope', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.doesNotMatch(src, /supabase|stripe|billing-status|billing_customers|subscriptions|entitlement|auth\.|migrations|\.css|router/i,
    'folder dropdown must stay frontend-local and avoid backend, billing, auth, CSS, and router references');
  assert.doesNotMatch(src, /window\./,
    'folder dropdown must not add global window state');
});

// ============================================================================
// PHASE 0.7C-1B — Compact Pack Folder Dropdown Polish
// ============================================================================

test('phase 0.7C-1B changed files stay within allowed polish scope', async () => {
  const allowedFiles = new Set([
    'src/screens/packs-screen.js',
    'styles/main.css',
    'tests/audit/security-and-invariants.spec.mjs',
  ]);
  const { stdout } = await execFileAsync('git', ['diff', '--name-only']);
  const changedFiles = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(file => file !== 'CLAUDE.md');
  const unexpectedFiles = changedFiles.filter(file => !allowedFiles.has(file));

  assert.deepEqual(unexpectedFiles, [],
    'Phase 0.7C-1B must only edit packs-screen.js, styles/main.css, and security-and-invariants.spec.mjs');
});

test('phase 0.7C-1B preserves Empty Partial Full filter chips', async () => {
  const indexSrc = await fs.readFile(indexHtmlPath, 'utf8');
  const packsSrc = await fs.readFile(packsScreenPath, 'utf8');

  assert.match(indexSrc, /id=["']packs-filter-chip-empty["']/,
    'Empty filter chip must remain in index.html');
  assert.match(indexSrc, /id=["']packs-filter-chip-partial["']/,
    'Partial filter chip must remain in index.html');
  assert.match(indexSrc, /id=["']packs-filter-chip-full["']/,
    'Full filter chip must remain in index.html');
  assert.match(packsSrc, /wireChip\(chipEmpty, ['"]empty['"]\)/,
    'Empty filter chip wiring must remain');
  assert.match(packsSrc, /wireChip\(chipPartial, ['"]partial['"]\)/,
    'Partial filter chip wiring must remain');
  assert.match(packsSrc, /wireChip\(chipFull, ['"]full['"]\)/,
    'Full filter chip wiring must remain');
});

test('phase 0.7C-1B folders button uses scoped structure without tooltip or ghost style', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function ensureFoldersButton()');
  const end = src.indexOf('\n    function initListHeaderSort()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0,
    'Folders button/dropdown block must be extractable');
  assert.match(block, /className = ['"]btn tp3d-packs-folder-btn['"]/,
    'Folders button must use btn plus scoped class');
  assert.doesNotMatch(block, /btn-ghost/,
    'Folders button must not use btn-ghost');
  assert.doesNotMatch(block, /data-tooltip/,
    'Folders button must not set data-tooltip');
  assert.match(block, /tp3d-packs-folder-btn__icon/,
    'Folders button must include scoped icon span');
  assert.match(block, /tp3d-packs-folder-btn__label/,
    'Folders button must include scoped label span');
  assert.doesNotMatch(block, /tp3d-packs-folder-btn__caret/,
    'Folders button must not include caret span (caret intentionally removed in 0.7C-1B)');
  assert.doesNotMatch(block, /fa-chevron-down/,
    'Folders button must not include fa-chevron-down (caret intentionally removed in 0.7C-1B)');
  assert.match(block, /tp3d-packs-folder-btn--active/,
    'Folders button must use scoped active class');
  assert.doesNotMatch(block, /btn-primary/,
    'Folders button active state must not use solid primary button styling');
});

test('phase 0.7C-1B folders button has ARIA state and same-button dropdown toggle', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function ensureFoldersButton()');
  const end = src.indexOf('\n    function initListHeaderSort()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(src, /const FOLDERS_DROPDOWN_ROLE = ['"]packs-folders['"]/,
    'Folders dropdown role constant must be packs-folders');
  assert.match(src, /const FOLDERS_DROPDOWN_ANCHOR_KEY = ['"]packs-folders-button['"]/,
    'Folders dropdown anchor key constant must be packs-folders-button');
  assert.match(block, /aria-haspopup['"], ['"]menu['"]/,
    'Folders button must declare menu popup semantics');
  assert.match(block, /aria-expanded['"], ['"]false['"]/,
    'Folders button must default aria-expanded to false');
  assert.match(block, /aria-expanded[\s\S]{0,120}expanded \? ['"]true['"] : ['"]false['"]/,
    'Folders button must update aria-expanded from dropdown state');
  assert.match(block, /\[data-dropdown="1"\]\[data-role="\$\{FOLDERS_DROPDOWN_ROLE\}"\]\[data-anchor-id="\$\{FOLDERS_DROPDOWN_ANCHOR_KEY\}"\]/,
    'same-button toggle must query by data-dropdown, data-role, and data-anchor-id');
  assert.match(block, /if \(existing\)[\s\S]{0,120}UIComponents\.closeAllDropdowns\(\)/,
    'clicking the same Folders button while open must close the existing dropdown');
  assert.match(block, /role:\s*FOLDERS_DROPDOWN_ROLE/,
    'openDropdown must receive the scoped role');
  assert.match(block, /anchorKey:\s*FOLDERS_DROPDOWN_ANCHOR_KEY/,
    'openDropdown must receive the scoped anchor key');
  assert.match(block, /align:\s*['"]left['"]/,
    'Folders dropdown must align left under the button');
  assert.match(block, /width:\s*260/,
    'Folders dropdown must use the polished width');
});

test('phase 0.7C-1B dropdown active rows match active folder filter state', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openFoldersDropdown()');
  const end = src.indexOf('\n    function initListHeaderSort()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /active:\s*activeFolderId === null/,
    'All Packs row must be active when activeFolderId is null');
  assert.match(block, /rightIcon:\s*activeFolderId === null \? ['"]fa-solid fa-check['"]/,
    'All Packs row must show active check icon when selected');
  assert.match(block, /active:\s*activeFolderId === UNFILED_FOLDER_ID/,
    'Unfiled row must be active when the unfiled sentinel is selected');
  assert.match(block, /rightIcon:\s*activeFolderId === UNFILED_FOLDER_ID \? ['"]fa-solid fa-check['"]/,
    'Unfiled row must show active check icon when selected');
  assert.match(block, /active:\s*activeFolderId === folderId/,
    'Folder rows must be active by exact folder id match');
  assert.match(block, /rightIcon:\s*activeFolderId === folderId \? ['"]fa-solid fa-check['"]/,
    'Folder rows must show active check icon by exact folder id match');
});

test('phase 0.7C-1B folder filtering still uses folderId state and reset behavior', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const filterStart = src.indexOf('if (activeFolderId === null) return true;');
  const filterEnd = src.indexOf('if (activeFolderId === UNFILED_FOLDER_ID)', filterStart);
  const filterBlock = filterStart >= 0 && filterEnd > filterStart
    ? src.slice(filterStart, filterEnd + 140)
    : '';
  const resetStart = src.indexOf('function resetWorkspaceState()');
  const resetEnd = src.indexOf('\n    function ', resetStart + 1);
  const resetBlock = resetStart >= 0 && resetEnd > resetStart ? src.slice(resetStart, resetEnd) : '';

  assert.match(src, /FolderLibrary\.listFolders\(\)/,
    'Folders dropdown options must still come from FolderLibrary.listFolders()');
  assert.match(filterBlock, /p && p\.folderId/,
    'folder filtering must still use pack.folderId');
  assert.doesNotMatch(filterBlock, /folder\.name|name === activeFolderId|activeFolderId === .*name/,
    'folder filtering must not use folder names as identity');
  assert.match(src, /newDatasetKey = `\$\{q\}::\$\{sortKey\}::\$\{activeFolderId \|\| 'all'\}::/,
    'activeFolderId must remain in dataset key');
  assert.match(resetBlock, /activeFolderId = null/,
    'workspace reset must clear activeFolderId');
});

test('phase 0.7C-1B avoids rejected folder UI and folder mutation actions', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.doesNotMatch(src, /function renderFolderBar|folderBarEl/,
    'the rejected always-visible folder bar must not be present');
  assert.doesNotMatch(src, /filtersRowEl\.nextSibling|insertBefore\([^)]*filtersRowEl/,
    'folder UI must not be mounted under the Empty Partial Full filter chip row');
  assert.doesNotMatch(src, /folder side(panel|bar)|folderPanel|foldersSidebar/i,
    'Phase 0.7C-1B must not add a sidebar folder panel');
  assert.doesNotMatch(src, /\b(renameFolder|deleteFolder|movePackToFolder|getPacksInFolder)\s*\(/,
    'Phase 0.7C-1B must not add rename, delete, move, or bulk folder UI');
  assert.doesNotMatch(src, /bulk.*folder|folder.*bulk/i,
    'Phase 0.7C-1B must not add bulk folder actions');
});

test('phase 0.7C-1B scoped CSS styles only the packs folder button', async () => {
  const css = await fs.readFile(stylesMainPath, 'utf8');
  const start = css.indexOf('.tp3d-packs-folder-btn {');
  const end = css.indexOf('.tp3d-packs-titlewrap', start + 1);
  const block = start >= 0 && end > start ? css.slice(start, end) : '';

  assert.ok(block.length > 0,
    'scoped packs folder button CSS block must exist');
  assert.match(block, /\.tp3d-packs-folder-btn \{/,
    'base packs folder button style must be scoped');
  assert.match(block, /\.tp3d-packs-folder-btn:hover/,
    'hover style must be scoped');
  assert.match(block, /\.tp3d-packs-folder-btn:focus-visible/,
    'focus-visible style must be scoped');
  assert.match(block, /\.tp3d-packs-folder-btn--active/,
    'active style must be scoped');
  assert.match(block, /\.tp3d-packs-folder-btn__icon/,
    'icon style must be scoped');
  assert.match(block, /\.tp3d-packs-folder-btn__label[\s\S]{0,220}text-overflow:\s*ellipsis/,
    'label style must truncate long folder names');
  assert.match(block, /\.tp3d-packs-folder-btn__caret/,
    'caret style must be scoped');
  assert.doesNotMatch(block, /\.btn\b|\.dropdown-menu|\.dropdown-item/,
    'Phase 0.7C-1B CSS must not style global buttons or dropdowns');
});

test('phase 0.7C-1B avoids forbidden backend billing auth settings package and index scope', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const { stdout } = await execFileAsync('git', [
    'diff',
    '--name-only',
    '--',
    'index.html',
    'package.json',
    'package-lock.json',
    'src/app.js',
    'src/core',
    'src/services/folder-library.js',
    'src/services/pack-library.js',
    'src/services/import-export.js',
    'src/ui/overlays/settings-overlay.js',
    'src/ui/ui-components.js',
    'supabase/functions',
    'supabase/migrations',
    'supabase/config.toml',
  ]);
  const changedForbiddenFiles = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  assert.deepEqual(changedForbiddenFiles, [],
    'Phase 0.7C-1B must not touch backend, data model, settings, package, or index scope');
  assert.doesNotMatch(src, /supabase|stripe|billing-status|billing_customers|subscriptions|entitlement|auth\.|migrations|router/i,
    'packs folder polish must not introduce backend, billing, auth, Stripe, Supabase, migration, or router references');
});

// ============================================================================
// PHASE 0.7C-2 — Create Folder from Packs Dropdown
// ============================================================================

test('phase 0.7C-2 changed files stay within allowed create-folder scope', async () => {
  const allowedFiles = new Set([
    'src/screens/packs-screen.js',
    'tests/audit/security-and-invariants.spec.mjs',
  ]);
  const { stdout } = await execFileAsync('git', ['diff', '--name-only']);
  const changedFiles = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(file => file !== 'CLAUDE.md');
  const unexpectedFiles = changedFiles.filter(file => !allowedFiles.has(file));

  assert.deepEqual(unexpectedFiles, [],
    'Phase 0.7C-2 must only edit packs-screen.js and security-and-invariants.spec.mjs');
});

test('phase 0.7C-2 create folder uses existing modal and folder library create API', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openCreateFolderModal()');
  const end = src.indexOf('\n    function openFoldersDropdown()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0,
    'openCreateFolderModal must exist inside PacksUI');
  assert.match(block, /UIComponents\.showModal\(/,
    'Create Folder must use the existing modal path');
  assert.match(block, /title:\s*['"]New Folder['"]/,
    'Create Folder modal title must be New Folder');
  assert.match(block, /field\(['"]Folder name['"], ['"]text['"], ['"]e\.g\. Client A['"], false\)/,
    'Create Folder modal must use field() for optional folder name input');
  assert.match(block, /FolderLibrary\.createFolder\(folderName\)/,
    'Create Folder modal must call FolderLibrary.createFolder()');
});

test('phase 0.7C-2 create folder selects created folder and refreshes packs', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openCreateFolderModal()');
  const end = src.indexOf('\n    function openFoldersDropdown()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /if \(created && created\.id\)/,
    'Create Folder must guard created folder id before selecting it');
  assert.match(block, /activeFolderId = String\(created\.id\)/,
    'Create Folder must select the newly created folder when an id is returned');
  assert.match(block, /packsListState\.pageIndex = 0/,
    'Create Folder must reset pack pagination when selecting the new folder');
  assert.match(block, /\brender\(\)/,
    'Create Folder must re-render the Packs screen');
  assert.match(block, /UIComponents\.showToast\(['"]Folder created['"], ['"]success['"]\)/,
    'Create Folder must show a success toast');
});

test('phase 0.7C-2 folder dropdown includes New Folder action after filter rows', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openFoldersDropdown()');
  const end = src.indexOf('\n    function initListHeaderSort()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /label:\s*['"]New Folder['"]/,
    'Folders dropdown must include New Folder action');
  assert.match(block, /icon:\s*['"]fa-solid fa-folder-plus['"]/,
    'New Folder action must use folder-plus icon');
  assert.match(block, /UIComponents\.closeAllDropdowns\(\)[\s\S]{0,120}setFoldersButtonExpanded\(false\)[\s\S]{0,120}openCreateFolderModal\(\)/,
    'New Folder action must close the dropdown, clear aria-expanded, and open the modal');
  assert.match(block, /label:\s*['"]No folders yet['"][\s\S]{0,180}items\.push\(\s*\{\s*type:\s*['"]divider['"]\s*\}[\s\S]{0,180}label:\s*['"]New Folder['"]/,
    'New Folder action must come after No folders yet when no folders exist');
});

test('phase 0.7C-2 create folder avoids native dialogs', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.doesNotMatch(src, /window\.prompt|window\.alert|window\.confirm/,
    'Packs screen must not use window prompt alert or confirm APIs');
  assert.doesNotMatch(src, /(^|[^\w.])prompt\s*\(|(^|[^\w.])alert\s*\(|(^|[^\w.])confirm\s*\(/,
    'Packs screen must not use native prompt(), alert(), or confirm() calls');
});

test('phase 0.7C-2 preserves no-caret Folders button contract', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function ensureFoldersButton()');
  const end = src.indexOf('\n    function renderFoldersButton(', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.doesNotMatch(block, /tp3d-packs-folder-btn__caret/,
    'Folders button must not reintroduce caret span');
  assert.doesNotMatch(block, /fa-chevron-down/,
    'Folders button must not reintroduce chevron icon');
  assert.doesNotMatch(block, /data-tooltip/,
    'Folders button must not reintroduce tooltip behavior');
  assert.doesNotMatch(block, /btn-ghost/,
    'Folders button must not reintroduce btn-ghost');
});

test('phase 0.7C-2 does not add rename delete move bulk sidebar or chip-row folder UI', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.doesNotMatch(src, /FolderLibrary\.renameFolder\(/,
    'Phase 0.7C-2 must not add folder rename UI');
  assert.doesNotMatch(src, /FolderLibrary\.deleteFolder\(/,
    'Phase 0.7C-2 must not add folder delete UI');
  assert.doesNotMatch(src, /FolderLibrary\.movePackToFolder\(/,
    'Phase 0.7C-2 must not add move pack to folder UI');
  assert.doesNotMatch(src, /getPacksInFolder\(/,
    'Phase 0.7C-2 must not add folder pack-management UI');
  assert.doesNotMatch(src, /bulk.*folder|folder.*bulk/i,
    'Phase 0.7C-2 must not add bulk folder actions');
  assert.doesNotMatch(src, /function renderFolderBar|folderBarEl|folder side(panel|bar)|folderPanel|foldersSidebar/i,
    'Phase 0.7C-2 must not add folder bar, chip row, or sidebar panel');
});

test('phase 0.7C-2 preserves folder filtering identity and reset behavior', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const filterStart = src.indexOf('if (activeFolderId === null) return true;');
  const filterEnd = src.indexOf('if (activeFolderId === UNFILED_FOLDER_ID)', filterStart);
  const filterBlock = filterStart >= 0 && filterEnd > filterStart
    ? src.slice(filterStart, filterEnd + 140)
    : '';
  const resetStart = src.indexOf('function resetWorkspaceState()');
  const resetEnd = src.indexOf('\n    function ', resetStart + 1);
  const resetBlock = resetStart >= 0 && resetEnd > resetStart ? src.slice(resetStart, resetEnd) : '';

  assert.match(filterBlock, /p && p\.folderId/,
    'folder filtering must still use pack.folderId');
  assert.doesNotMatch(filterBlock, /folder\.name|name === activeFolderId|activeFolderId === .*name/,
    'folder filtering must not use folder names as identity');
  assert.match(src, /newDatasetKey = `\$\{q\}::\$\{sortKey\}::\$\{activeFolderId \|\| 'all'\}::/,
    'activeFolderId must remain in dataset key');
  assert.match(resetBlock, /activeFolderId = null/,
    'workspace reset must clear activeFolderId');
});

test('phase 0.7C-2 avoids forbidden backend billing auth settings package and index scope', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const { stdout } = await execFileAsync('git', [
    'diff',
    '--name-only',
    '--',
    'index.html',
    'package.json',
    'package-lock.json',
    'src/app.js',
    'src/core',
    'src/services/folder-library.js',
    'src/services/pack-library.js',
    'src/services/import-export.js',
    'src/ui/overlays/settings-overlay.js',
    'src/ui/ui-components.js',
    'src/data/services/billing.service.js',
    'src/router.js',
    'styles/main.css',
    'supabase/functions',
    'supabase/migrations',
    'supabase/config.toml',
  ]);
  const changedForbiddenFiles = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  assert.deepEqual(changedForbiddenFiles, [],
    'Phase 0.7C-2 must not touch backend, data model, settings, CSS, package, router, or index scope');
  assert.doesNotMatch(src, /supabase|stripe|billing-status|billing_customers|subscriptions|entitlement|auth\.|migrations|router/i,
    'create folder UI must not introduce backend, billing, auth, Stripe, Supabase, migration, or router references');
});
