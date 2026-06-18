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
const importCasesDialogPath = new URL('../../src/ui/overlays/import-cases-dialog.js', import.meta.url);
const folderLibraryPath = new URL('../../src/services/folder-library.js', import.meta.url);
const caseLibraryPath = new URL('../../src/services/case-library.js', import.meta.url);
const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);
const autoPackEnginePath = new URL('../../src/services/autopack-engine.js', import.meta.url);
const autoPackLegacySolverPath = new URL('../../src/services/autopack-legacy-solver.js', import.meta.url);
const autoPackSolverPath = new URL('../../src/services/autopack-solver.js', import.meta.url);
const packsScreenPath = new URL('../../src/screens/packs-screen.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);
const sceneRuntimePath = new URL('../../src/editor/scene-runtime.js', import.meta.url);
const casesScreenPath = new URL('../../src/screens/cases-screen.js', import.meta.url);
const categoryServicePath = new URL('../../src/services/category-service.js', import.meta.url);
const stylesMainPath = new URL('../../styles/main.css', import.meta.url);
const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);
const normalizerPath = new URL('../../src/core/normalizer.js', import.meta.url);
const orientedDimsPath = new URL('../../src/core/oriented-dims.js', import.meta.url);
const vendorThreePath = new URL('../../vendor/three.module.js', import.meta.url);
const caseModelPath = new URL('../../src/data/models/case.model.js', import.meta.url);
const coreUtilsPath = new URL('../../src/core/utils.js', import.meta.url);
const coreUtilsIndexPath = new URL('../../src/core/utils/index.js', import.meta.url);
const corsSharedPath = new URL('../../supabase/functions/_shared/cors.ts', import.meta.url);
const supabasePath = new URL('../../src/core/supabase-client.js', import.meta.url);
const authOverlayPath = new URL('../../src/ui/overlays/auth-overlay.js', import.meta.url);
const settingsOverlayPath = new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url);
const caseModalPath = new URL('../../src/ui/overlays/case-modal.js', import.meta.url);
const cardDisplayOverlayPath = new URL('../../src/ui/overlays/card-display-overlay.js', import.meta.url);
const helpModalPath = new URL('../../src/ui/overlays/help-modal.js', import.meta.url);
const importAppDialogPath = new URL('../../src/ui/overlays/import-app-dialog.js', import.meta.url);
const importPackDialogPath = new URL('../../src/ui/overlays/import-pack-dialog.js', import.meta.url);
const billingStatusPath = new URL('../../supabase/functions/billing-status/index.ts', import.meta.url);
const stripeCheckoutPath = new URL('../../supabase/functions/stripe-create-checkout-session/index.ts', import.meta.url);
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
const guardProfileDeletionFieldsMigrationPath = new URL(
  '../../supabase/migrations/2026061301_guard_profile_deletion_fields.sql',
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

test('phase 1 P0 cross-profile logout: billing-status 401 triggers local sign-out cleanup', async () => {
  const app = await fs.readFile(appPath, 'utf8');
  const refreshMatch = app.match(/async function refreshBilling\b[\s\S]*?\/\*\* @param \{object\} billingSnapshot/);
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
  const app = await fs.readFile(appPath, 'utf8');
  const refreshMatch = app.match(/async function refreshBilling\b[\s\S]*?\/\*\* @param \{object\} billingSnapshot/);
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

test('phase 1 P0 cross-profile logout: visible signed-in tabs actively validate server auth', async () => {
  const app = await fs.readFile(appPath, 'utf8');

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
  assert.match(app, /const shouldClearSignedOutOrgHint = Boolean\(userInitiatedSignOut \|\| treatAsSignedOut \|\| authBlockState\)[\s\S]{0,180}clearLocalOrgHint: shouldClearSignedOutOrgHint/,
    'confirmed signed-out cleanup must clear stale active org hints');
});

test('P0 billing retry reliability C: refreshBilling only reuses successful shared snapshots and force bypasses them', async () => {
  const app = await fs.readFile(appPath, 'utf8');
  const refreshMatch = app.match(/async function refreshBilling\b[\s\S]*?\/\*\* @param \{object\} billingSnapshot/);
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
  const app = await fs.readFile(appPath, 'utf8');
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
  const app = await fs.readFile(appPath, 'utf8');
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
  const app = await fs.readFile(appPath, 'utf8');
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

test('UI-COPY-EXPORT-IMPORT-1 copy uses scoped backup import export wording', async () => {
  const [settings, app, index, importApp, importPack, help, packs] = await Promise.all([
    fs.readFile(settingsOverlayPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(importAppDialogPath, 'utf8'),
    fs.readFile(importPackDialogPath, 'utf8'),
    fs.readFile(helpModalPath, 'utf8'),
    fs.readFile(packsScreenPath, 'utf8'),
  ]);

  assert.match(settings, /Release Notes[\s\S]*Verified product changes will appear here/,
    'Settings Resources must label Updates as Release Notes with neutral copy');
  assert.match(settings, /Export App Backup[\s\S]*Download local packs, cases, folders, and preferences as a JSON backup/,
    'Settings Resources must scope App Backup export copy');
  assert.match(settings, /Import App Backup[\s\S]*Replace local packs, cases, folders, and preferences from a backup JSON/,
    'Settings Resources must scope App Backup import copy');
  assert.match(settings, /Workspace Backup[\s\S]*Export Workspace Backup/,
    'Workspace General must use Workspace Backup wording');
  assert.match(app, /title:\s*['"]Export App Backup['"][\s\S]*label:\s*['"]Download App Backup['"]/,
    'App export modal must use backup title and CTA');
  assert.match(app, /title:\s*['"]Export Workspace Backup['"][\s\S]*label:\s*['"]Export Workspace Backup['"]/,
    'Workspace export modal must use backup title and CTA');
  assert.match(index, /Import Pack\(s\)/,
    'Packs screen header button must use Import Pack(s)');
  assert.doesNotMatch(index, />\s*Import Pack JSON\s*</,
    'Packs screen toolbar button must not say Import Pack JSON');
  assert.match(index, /Download Cases Template[\s\S]*Import Cases/,
    'Cases buttons must use explicit template and import labels');
  assert.match(importApp, /title:\s*['"]Import App Backup['"]/,
    'Import App dialog must use Import App Backup title');
  assert.match(importApp, /Replace Local App Data/,
    'Import App dialog must use scoped replacement CTA');
  assert.match(importPack, /title:\s*['"]Import Pack JSON['"]/,
    'Import Pack dialog must use Import Pack JSON title');
  assert.equal((packs.match(/label:\s*['"]Export Pack JSON['"]/g) || []).length, 2,
    'Both pack context menus must use Export Pack JSON');
  assert.match(help, /Import \/ Export Help[\s\S]*Workspace Backup[\s\S]*Pack JSON[\s\S]*Cases CSV\/XLSX/,
    'Top-bar Help modal must match the import/export help scope');
});

test('UI-COPY-EXPORT-IMPORT-1 removes fake release notes and stale roadmap commitments', async () => {
  const [settings, app, index] = await Promise.all([
    fs.readFile(settingsOverlayPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(indexHtmlPath, 'utf8'),
  ]);
  const combined = `${settings}\n${app}\n${index}`;

  assert.doesNotMatch(combined, /\(Example\)|version:\s*['"]1\.1\.0['"]|date:\s*['"]2026-03-01['"]/,
    'Fake example release notes must not remain user-facing');
  assert.doesNotMatch(settings, /updatesData|roadmapData/,
    'Settings empty states must not leave unused static Updates/Roadmap arrays behind');
  assert.doesNotMatch(app, /quarter:\s*['"]Q1 2026['"]|quarter:\s*['"]Q2 2026['"]/,
    'Full-screen Roadmap data must not include Q1/Q2 stale commitments');
  assert.match(settings, /Verified release notes will appear here as the product changes/,
    'Settings Release Notes sub-view must render the neutral empty state');
  assert.match(settings, /Published roadmap items will appear here when they are ready to share/,
    'Settings Roadmap sub-view must render the neutral empty state');
});

// ── Import-cases dialog polish checks ──────────────────────────────────────

test('import-cases dialog file chip clear does not close modal', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /ev\.stopPropagation\(\)/,
    'file chip clear x must call ev.stopPropagation() to avoid closing the modal');
});

test('import-cases dialog preview renders category color dots', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /tp3d-ic-cat-dot/,
    'category cells must render a tp3d-ic-cat-dot element for the color indicator');
});

test('import-cases dialog preview uses status circle elements', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /tp3d-ic-status-circle/,
    'status icons must be wrapped in tp3d-ic-status-circle for the soft circular background');
  assert.match(src, /tp3d-ic-status-circle--success/,
    'valid rows must use tp3d-ic-status-circle--success');
  assert.match(src, /tp3d-ic-status-circle--error/,
    'invalid rows must use tp3d-ic-status-circle--error');
});

test('import-cases dialog error report button uses bordered style', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /errReportBtn\.className\s*=\s*['"]btn['"]/,
    'error report button must use the base btn class (bordered secondary style)');
  assert.doesNotMatch(src, /errReportBtn\.className\s*=\s*['"]btn btn-ghost['"]/,
    'error report button must not be ghost (borderless)');
  assert.doesNotMatch(src, /errReportBtn\.className\s*=\s*['"]tp3d-ic-err-report-btn['"]/,
    'error report button must not use one-off custom class');
});

test('import-cases dialog parsed state uses compact file chip not the large dropzone', async () => {
  const src = await fs.readFile(importCasesDialogPath, 'utf8');
  assert.match(src, /tp3d-ic-file-chip/,
    'parsed state must use a compact file chip element');
  assert.match(src, /showState\('dropzone'\)/,
    'file chip clear must call showState dropzone to return to empty state');
});

// ── End import-cases dialog polish checks ──────────────────────────────────

// ── PACK-IMPORT-BATCH-1 ────────────────────────────────────────────────────

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON is exported from import-export.js', async () => {
  const src = await fs.readFile(importExportPath, 'utf8');
  assert.match(src, /export function parsePackBatchImportJSON/,
    'parsePackBatchImportJSON must be exported from import-export.js');
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON accepts valid batch envelope at runtime', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const batch = JSON.stringify({
    exportType: 'pack-batch',
    schemaVersion: 1,
    packs: [
      { pack: { truck: { dimensions: { length: 20, width: 8, height: 8 } }, cases: [] }, bundledCases: [] },
      { pack: { truck: { dimensions: { length: 20, width: 8, height: 8 } }, cases: [] }, bundledCases: [] },
    ],
  });
  const payloads = ImportExport.parsePackBatchImportJSON(batch);
  assert.equal(payloads.length, 2, 'batch parser must return one payload per packs entry');
  assert.ok(payloads[0] && payloads[0].pack, 'each payload must have a pack key');
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects wrong exportType', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({ packs: [{ pack: { truck: {}, cases: [] } }] })),
    /pack batch/i,
    'must throw on missing or wrong exportType',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects App JSON', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({
      exportType: 'pack-batch',
      packLibrary: [],
      caseLibrary: [],
      packs: [{ pack: { truck: {}, cases: [] } }],
    })),
    /App JSON|App Backup/i,
    'batch parser must reject App JSON shape',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects workspace exportType', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({
      exportType: 'workspace',
      data: { packLibrary: [], caseLibrary: [] },
    })),
    /Workspace/i,
    'batch parser must reject workspace export',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects empty packs array', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify({ exportType: 'pack-batch', packs: [] })),
    /non-empty/i,
    'batch parser must reject an empty packs array',
  );
});

test('PACK-IMPORT-BATCH-1 parsePackBatchImportJSON rejects top-level array', async () => {
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.throws(
    () => ImportExport.parsePackBatchImportJSON(JSON.stringify([{ pack: { truck: {}, cases: [] } }])),
    /Invalid JSON|Not a pack batch|pack batch/i,
    'batch parser must reject a top-level array',
  );
});

test('PACK-IMPORT-BATCH-1 import-pack-dialog routes pack-batch exportType to batch handler', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /['"]pack-batch['"]/,
    'import-pack-dialog must detect pack-batch exportType');
  assert.match(src, /parsePackBatchImportJSON/,
    'import-pack-dialog must call parsePackBatchImportJSON for batch files');
  assert.match(src, /parsePackImportJSON/,
    'import-pack-dialog must still call parsePackImportJSON for single-pack files');
});

// ── End PACK-IMPORT-BATCH-1 ────────────────────────────────────────────────

// ── PACK-IMPORT-SCHEMA-1 ───────────────────────────────────────────────────

function makePackImportSafeCase(overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id: overrides.id || 'case-import-safe',
    name: overrides.name || 'Import Safe Box',
    manufacturer: overrides.manufacturer || 'QA',
    category: overrides.category || 'Default',
    color: overrides.color || '#9ca3af',
    dimensions,
    weight: overrides.weight || 10,
    volume: dimensions.length * dimensions.width * dimensions.height,
    canFlip: overrides.canFlip ?? true,
    stackable: overrides.stackable ?? true,
    ...overrides,
  };
}

function makePackImportInstance(caseId, overrides = {}) {
  return {
    id: overrides.id || `inst-${Math.random().toString(36).slice(2)}`,
    caseId,
    transform: overrides.transform,
    hidden: false,
    groupId: null,
    ...overrides,
  };
}

function getPackImportDims(inst, caseData) {
  return inst.orientedDims || caseData.dimensions;
}

function getPackImportAabb(inst, caseData) {
  const dims = getPackImportDims(inst, caseData);
  const pos = inst.transform.position;
  return {
    min: {
      x: pos.x - dims.length / 2,
      y: pos.y - dims.height / 2,
      z: pos.z - dims.width / 2,
    },
    max: {
      x: pos.x + dims.length / 2,
      y: pos.y + dims.height / 2,
      z: pos.z + dims.width / 2,
    },
  };
}

function packImportAabbsOverlap(a, b) {
  const EPS = 0.001;
  return (
    a.min.x < b.max.x - EPS &&
    a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS &&
    a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS &&
    a.max.z > b.min.z + EPS
  );
}

function assertPackImportNoOverlaps(instances, caseData) {
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      assert.equal(
        packImportAabbsOverlap(
          getPackImportAabb(instances[i], caseData),
          getPackImportAabb(instances[j], caseData)
        ),
        false,
        `instances ${i} and ${j} must not overlap`
      );
    }
  }
}

function makePackImportPayload(caseData, instances, overrides = {}) {
  return {
    pack: {
      id: overrides.packId || `pack-import-${Math.random().toString(36).slice(2)}`,
      title: overrides.title || 'Import Safety Pack',
      truck: overrides.truck || { length: 120, width: 60, height: 60 },
      cases: instances,
      folderId: overrides.folderId || null,
    },
    bundledCases: overrides.bundledCases === undefined ? [caseData] : overrides.bundledCases,
  };
}

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog reads flat truck schema (not .dimensions)', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.ok(
    !src.includes('pack.truck.dimensions'),
    'import-pack-dialog must not read pack.truck.dimensions (flat schema: pack.truck.length/width/height)'
  );
  assert.match(src, /pack\.truck\s*\|\|/,
    'import-pack-dialog must use pack.truck || {} for truck accessor');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog validates truck dimensions are positive finite numbers', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /Number\.isFinite.*truckL|Number\.isFinite.*tL/,
    'import-pack-dialog must check Number.isFinite for truck length');
  assert.match(src, /truckL\s*<=\s*0|tL\s*<=\s*0/,
    'import-pack-dialog must reject truck.length <= 0');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog App JSON guard catches exportType app-backup', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /exportType.*app-backup|app-backup.*exportType/,
    'import-pack-dialog must detect exportType === "app-backup" as App JSON');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog renderCasesTable does not use .dimensions fallback for missing bundled cases', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.ok(
    !src.includes("bundledById.get(inst.caseId) || {}"),
    'import-pack-dialog must not fallback to {} for missing bundled case (hides unresolved data)'
  );
  assert.match(src, /hasDef|isResolved/,
    'import-pack-dialog must track whether case definition was resolved from bundledCases');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog shows unbundled case note in cases table', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /not bundled/,
    'import-pack-dialog must show a note when case definitions are not bundled');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog labels preview summary and hides unsupported Thumbnail chip', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /fa-solid fa-truck/,
    'Pack import preview summary must show a professional truck icon in the header block');
  assert.doesNotMatch(src, /createDetailItem\(['"]Title['"]/,
    'Pack import preview metadata must not duplicate title row under the summary header');
  assert.match(src, /createDetailItem\(['"]Project['"]/,
    'Pack import preview must label the project metadata item');
  assert.match(src, /createDetailItem\(['"]Client['"]/,
    'Pack import preview must label the client metadata item');
  assert.match(src, /createDetailItem\(['"]Truck['"]/,
    'Pack import preview must label the truck metadata item');
  assert.match(src, /createDetailItem\(['"]Categories['"]/,
    'Pack import preview must label the categories metadata item');
  assert.match(src, /tp3d-ip-summary-meta-item/,
    'Pack import preview must render compact inline metadata groups');
  assert.match(src, /tp3d-ip-summary-detail-value/,
    'Pack import preview metadata values must be rendered in dedicated value spans');
  assert.match(src, /tp3d-ip-cases-status-card/,
    'Pack import preview must render cases status cards');
  assert.match(src, /let activeCaseFilter = ['"]all['"]/,
    'Pack import preview must keep a local activeCaseFilter state for card toggles');
  assert.match(src, /activeCaseFilter === key \? ['"]all['"] : key/,
    'Cases status cards must toggle on/off by clicking the active filter again');
  assert.match(src, /renderCasesTable\(pack, bundledCases\)/,
    'Cases status card clicks must re-render the table with the selected filter');
  assert.match(src, /label:\s*['"]Ready['"]/, 
    'Pack import preview must include Ready status label');
  assert.match(src, /label:\s*['"]Duplicates['"]/, 
    'Pack import preview must include Duplicates status label');
  assert.match(src, /label:\s*['"]Invalid['"]/, 
    'Pack import preview must include Invalid status label');
  assert.match(src, /labelEl\.textContent\s*=\s*label \+ ['"]: ['"]/,
    'Pack import preview labels must include a visible colon-space separator');
  assert.match(src, /const clientText = pack\.client \|\| pack\.clientName \|\| ['"]/,
    'Pack import preview must support client fallback from pack.clientName');
  assert.doesNotMatch(src, /label:\s*['"]Thumbnail['"]/,
    'Pack import empty-state structure chips must not show Thumbnail');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog normalizes invalid/edge-case errors with specific headings', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /function normalizeImportError\(/,
    'Import dialog must normalize edge-case errors before rendering');
  assert.match(src, /heading:\s*['"]Invalid JSON file['"]/, 
    'Import dialog must label JSON parse failures clearly');
  assert.match(src, /heading:\s*['"]Missing required fields['"]/, 
    'Import dialog must label missing required fields clearly');
  assert.match(src, /heading:\s*['"]Invalid truck size['"]/, 
    'Import dialog must label invalid truck dimension failures clearly');
  assert.match(src, /renderError\(normalized\.message, normalized\.heading\)/,
    'Import dialog must pass normalized heading and message into inline error cards');
});

test('PACK-IMPORT-SCHEMA-1 single import success path closes modal after import', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /PackLibrary\.importPackPayload\(parsedPayload\.payload\)[\s\S]*modalObj\.close\(\)/,
    'Single-pack import success must close the modal after importing');
});

test('PACK-IMPORT-SCHEMA-1 pack import modal uses pack-only class and batch close is gated by imported count', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /classList\.add\(['"]tp3d-ic-modal['"],\s*['"]tp3d-ip-modal['"]\)/,
    'Pack import modal must include pack-only tp3d-ip-modal class alongside shared tp3d-ic-modal');
  assert.match(
    src,
    /UIComponents\.showToast\(msg, imported > 0 \? ['"]success['"] : ['"]warning['"]\);\s*if\s*\(imported\s*>\s*0\)\s*\{\s*modalObj\.close\(\);\s*\}/,
    'Batch import should close modal only when imported > 0'
  );
  assert.doesNotMatch(src, /imported\s*===\s*0[\s\S]*modalObj\.close\(\)/,
    'Batch import with zero successful imports must keep modal open');
});

test('PACK-IMPORT-SAFE-1 editor addCaseToPack uses PackLibrary safe staging and preserves explicit drop positions', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function addCaseToPack(caseId, positionInches)');
  const end = src.indexOf('\n\n    function unpackAll()', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0,
    'editor-screen must define addCaseToPack(caseId, positionInches) before unpackAll');
  assert.doesNotMatch(block, /const cols\s*=\s*6/,
    'addCaseToPack must not keep hardcoded 6-column staging');
  assert.doesNotMatch(block, /stagedCount/,
    'addCaseToPack must not compute a custom stagedCount layout path');
  assert.match(block, /\?\s*PackLibrary\.addInstance\(packId,\s*caseId,\s*positionInches\)/,
    'addCaseToPack must preserve explicit positionInches for drag/drop placement');
  assert.match(block, /:\s*PackLibrary\.addInstance\(packId,\s*caseId\)/,
    'addCaseToPack must call PackLibrary.addInstance(packId, caseId) for normal Add button staging');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog distinguishes bundled and unresolved case definitions', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /Utils\.formatDims\(dims,\s*['"]m['"]\)/,
    'Bundled cases must show real formatted dimensions');
  assert.match(src, /Utils\.formatWeight\(wt,\s*['"]lb['"]/,
    'Bundled cases must show real formatted weight');
  assert.match(src, /getCategoryColor\(catName\)/,
    'Bundled case categories must render their category color');
  assert.match(src, /nameSpan\.textContent\s*=\s*inst\.caseId/,
    'Missing bundled cases must show the unresolved caseId');
  assert.match(src, /Case definitions not bundled/,
    'Missing bundled cases must show a clear unresolved note');
  assert.doesNotMatch(src, /\?\s*×\s*\?\s*×\s*\?/,
    'Missing bundled cases must not show fake unknown dimensions');
});

test('PACK-IMPORT-SCHEMA-1 import-pack-dialog batch row validation checks truck dimensions', async () => {
  const src = await fs.readFile(importPackDialogPath, 'utf8');
  assert.match(src, /Invalid truck dimensions/,
    'import-pack-dialog batch validation must report "Invalid truck dimensions"');
});

test('PACK-IMPORT-SAFE-1 import stays on Packs and does not auto-open imported pack', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-route' });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [
      { id: 'existing-pack', title: 'Existing Pack', truck: { length: 100, width: 60, height: 60 }, cases: [] },
    ],
    folderLibrary: [],
    preferences: {},
    currentScreen: 'packs',
    currentPackId: 'existing-pack',
    selectedInstanceIds: ['selected-before-import'],
  });

  const importedPack = PackLibrary.importPackPayload(makePackImportPayload(
    caseData,
    [makePackImportInstance(caseData.id, { id: 'inst-route' })],
    { packId: 'pack-import-route', title: 'Route Import' }
  ));

  assert.equal(StateStore.get('currentScreen'), 'packs',
    'Pack import must not switch currentScreen to editor');
  assert.equal(StateStore.get('currentPackId'), 'existing-pack',
    'Pack import must not auto-open the imported pack');
  assert.deepEqual(StateStore.get('selectedInstanceIds'), [],
    'Pack import should clear stale editor selections');
  assert.ok(
    PackLibrary.getPacks().some(pack => pack.id === importedPack.id),
    'Imported pack must be added to the pack library for the Packs screen'
  );
});

test('PACK-IMPORT-SAFE-1 duplicate pack id is regenerated, title is suffixed, and duplicate bundled cases are reused', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  // Local case uses the helper's default cargo so the bundled cases below are
  // cargo-equivalent and may be safely reused (CARGO-RULE-V1 import-integrity).
  const existingCase = makePackImportSafeCase({
    id: 'case-existing',
    name: 'Shared Case Name',
  });

  StateStore.init({
    caseLibrary: [existingCase],
    packLibrary: [
      {
        id: 'pack-existing-id',
        title: 'Existing Pack',
        truck: { length: 120, width: 60, height: 60 },
        cases: [],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });

  const importedPack = PackLibrary.importPackPayload({
    pack: {
      id: 'pack-existing-id',
      title: 'Duplicate Id Pack',
      truck: { length: 120, width: 60, height: 60 },
      cases: [
        makePackImportInstance('case-existing', { id: 'inst-1', transform: { position: { x: 8, y: 4, z: -8 } } }),
        makePackImportInstance('incoming-dup-name', { id: 'inst-2', transform: { position: { x: 24, y: 4, z: -8 } } }),
      ],
    },
    bundledCases: [
      makePackImportSafeCase({ id: 'case-existing', name: 'Shared Case Name' }),
      makePackImportSafeCase({ id: 'incoming-dup-name', name: 'Shared Case Name' }),
    ],
  });

  const casesAfter = StateStore.get('caseLibrary') || [];
  assert.equal(casesAfter.length, 1,
    'Duplicate bundled cases by id/name must be reused and not added again');
  assert.ok(importedPack.id !== 'pack-existing-id',
    'Duplicate incoming pack id must be regenerated');
  assert.equal(importedPack.title, 'Duplicate Id Pack (Imported)',
    'Imported pack title must be suffixed with (Imported)');
  assert.ok(importedPack.cases.every(inst => inst.caseId === 'case-existing'),
    'Imported instances should reuse existing case ids for duplicate bundled definitions');
});

test('CARGO-RULE-V1 pack import with an unresolved case reference is blocked with no side effect', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const bad = {
    pack: { id: 'p', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ghost', { id: 'i', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [],
  };
  assert.throws(() => PackLibrary.importPackPayload(bad), /missing/i, 'unresolved reference must block the import');
  assert.equal((StateStore.get('caseLibrary') || []).length, 0, 'blocked import must not create any case (no fake fallback)');
  assert.equal((StateStore.get('packLibrary') || []).length, 0, 'blocked import must not save the pack');

  // A pack whose cases all resolve still imports (regression guard).
  const ok = {
    pack: { id: 'p2', title: 'P2', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('good', { id: 'j', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'good', name: 'Good' })],
  };
  PackLibrary.importPackPayload(ok);
  assert.equal((StateStore.get('packLibrary') || []).length, 1, 'a fully resolvable pack still imports');
});

test('CARGO-RULE-V1 batch import skips only the invalid pack; valid packs import', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const entries = [
    { pack: { id: 'good1', title: 'G1', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('c1', { id: 'a', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'c1', name: 'C1' })] },
    { pack: { id: 'bad', title: 'B', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('missing', { id: 'b', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [] },
    { pack: { id: 'good2', title: 'G2', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('c2', { id: 'd', transform: { position: { x: 5, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'c2', name: 'C2' })] },
  ];
  // Mirror the dialog's per-pack try/catch batch loop.
  let imported = 0, skipped = 0;
  for (const e of entries) {
    try { PackLibrary.importPackPayload(e); imported++; } catch { skipped++; }
  }
  assert.equal(imported, 2, 'two valid packs import');
  assert.equal(skipped, 1, 'the invalid pack is skipped');
  assert.equal((StateStore.get('packLibrary') || []).length, 2, 'only valid packs are saved');
});

// ---------------------------------------------------------------------------
// PHASE 2: Atomic pack import (pure preflight + single state commit)
// ---------------------------------------------------------------------------

// Snapshot the libraries as JSON so we can prove byte-equivalence after a failure.
function packImportStateSnapshot(StateStore) {
  return {
    caseLibrary: JSON.stringify(StateStore.get('caseLibrary') || []),
    packLibrary: JSON.stringify(StateStore.get('packLibrary') || []),
  };
}

// A pack that bundles one good case and references one good + one extra case id
// whose bundled definition is supplied separately (so we can corrupt position).
function makeMultiCasePayload(bundledCases) {
  return {
    pack: {
      id: 'p-multi', title: 'Multi', truck: { length: 240, width: 96, height: 96 },
      cases: bundledCases.map((c, i) => makePackImportInstance(c.id, { id: `i-${i}`, transform: { position: { x: 8 + i * 16, y: 5, z: 0 } } })),
    },
    bundledCases,
  };
}

test('CARGO-RULE-V2 atomic import: a valid import adds all cases + the pack (full before/after)', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  const payload = makeMultiCasePayload([
    makePackImportSafeCase({ id: 'b1', name: 'B1' }),
    makePackImportSafeCase({ id: 'b2', name: 'B2' }),
  ]);
  PackLibrary.importPackPayload(payload);
  assert.notDeepEqual(packImportStateSnapshot(StateStore), before, 'state changed on a valid import');
  assert.equal((StateStore.get('caseLibrary') || []).length, 2, 'both bundled cases added');
  assert.equal((StateStore.get('packLibrary') || []).length, 1, 'the pack was added');
});

for (const where of ['first', 'middle', 'last']) {
  test(`CARGO-RULE-V2 atomic import: malformed ${where} bundled case → no mutation at all`, async () => {
    const StateStore = await import(stateStorePath.href);
    const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
    // Seed an existing case so we can prove the existing library is untouched too.
    const seed = makePackImportSafeCase({ id: 'seed', name: 'Seed' });
    StateStore.init({ caseLibrary: [seed], packLibrary: [], folderLibrary: [], preferences: {} });
    const before = packImportStateSnapshot(StateStore);

    const good1 = makePackImportSafeCase({ id: 'g1', name: 'G1' });
    const good2 = makePackImportSafeCase({ id: 'g2', name: 'G2' });
    const bad = { id: 'bad', name: 'Bad', dimensions: { length: 0, width: 'x', height: -3 }, weight: 5 };
    const order = where === 'first' ? [bad, good1, good2] : where === 'middle' ? [good1, bad, good2] : [good1, good2, bad];

    assert.throws(() => PackLibrary.importPackPayload(makeMultiCasePayload(order)), /blocked/i,
      `malformed ${where} bundled case must block the import`);

    const after = packImportStateSnapshot(StateStore);
    assert.deepEqual(after, before, 'case + pack libraries are byte-equivalent after the failure (no partial mutation)');
    assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'only the pre-existing seed case remains');
    assert.equal((StateStore.get('packLibrary') || []).length, 0, 'no pack was saved');
  });
}

test('CARGO-RULE-V2 atomic import: blank/missing instance caseId is rejected with no side effect', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  for (const blank of ['', '   ', null, undefined]) {
    const payload = {
      pack: { id: 'pb', title: 'PB', truck: { length: 120, width: 60, height: 60 },
        cases: [makePackImportInstance(blank, { id: 'ib', transform: { position: { x: 5, y: 5, z: 0 } } })] },
      bundledCases: [makePackImportSafeCase({ id: 'unused', name: 'Unused' })],
    };
    assert.throws(() => PackLibrary.importPackPayload(payload), /blank or missing/i, `blank caseId (${JSON.stringify(blank)}) must block`);
  }
  assert.deepEqual(packImportStateSnapshot(StateStore), before, 'no state change after blank-caseId rejections');
});

test('CARGO-RULE-V2 atomic import: failure after a planned conflict leaves no local case changed', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Existing case forces an id-conflict plan for the first bundled case.
  const existing = makePackImportSafeCase({ id: 'dup', name: 'Existing Dup', weight: 999 });
  StateStore.init({ caseLibrary: [existing], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  // First bundled case conflicts (same id, different cargo → planned rename), the
  // last is malformed → the whole plan must abort with nothing committed.
  const conflicting = makePackImportSafeCase({ id: 'dup', name: 'Incoming Dup', weight: 1 });
  const bad = { id: 'bad2', name: 'Bad2', dimensions: null };
  assert.throws(() => PackLibrary.importPackPayload(makeMultiCasePayload([conflicting, bad])), /blocked/i);
  assert.deepEqual(packImportStateSnapshot(StateStore), before, 'planned conflict + later failure leaves the library byte-equivalent');
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'no conflict-renamed case was created');
});

test('CARGO-RULE-V2 atomic import: repeating a conflicting import three times is idempotent', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const existing = makePackImportSafeCase({ id: 'shared', name: 'Shared', weight: 10 });
  StateStore.init({ caseLibrary: [existing], packLibrary: [], folderLibrary: [], preferences: {} });
  // Different cargo than the local 'shared' (heavier) → forces a conflict copy.
  const mkConflict = () => ({
    pack: { id: 'pc', title: 'PC', truck: { length: 120, width: 60, height: 60 },
      cases: [makePackImportInstance('shared', { id: 'ic', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'shared', name: 'Shared', weight: 250 })],
  });
  PackLibrary.importPackPayload(mkConflict());
  const afterFirst = (StateStore.get('caseLibrary') || []).length;
  PackLibrary.importPackPayload(mkConflict());
  PackLibrary.importPackPayload(mkConflict());
  const afterThird = (StateStore.get('caseLibrary') || []).length;
  assert.equal(afterFirst, 2, 'first conflicting import creates exactly one (Imported) copy');
  assert.equal(afterThird, 2, 'two further identical conflicting imports reuse the copy (no Imported 2/3)');
  assert.equal((StateStore.get('packLibrary') || []).length, 3, 'each import still adds its pack');
});

test('CARGO-RULE-V2 planPackImport is pure: planning alone never mutates state', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const before = packImportStateSnapshot(StateStore);
  const plan = PackLibrary.planPackImport(makeMultiCasePayload([
    makePackImportSafeCase({ id: 'p1', name: 'P1' }),
    makePackImportSafeCase({ id: 'p2', name: 'P2' }),
  ]));
  assert.deepEqual(packImportStateSnapshot(StateStore), before, 'planPackImport must not write to StateStore');
  assert.equal(plan.newCases.length, 2, 'plan carries the two prepared new cases');
  assert.ok(plan.pack && plan.pack.stats, 'plan carries a fully built pack with stats');
});

test('CARGO-RULE-V1 existing dangling instance: stats expose it, export preserves it, no crash', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const dpack = { id: 'dp', title: 'Dangling', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ghost', { id: 'i', transform: { position: { x: 5, y: 5, z: 0 } } })] };
  StateStore.init({ caseLibrary: [], packLibrary: [dpack], folderLibrary: [], preferences: {} });
  const stats = PackLibrary.computeStats(dpack, []);
  assert.equal(stats.totalCases, 1, 'the stored instance is still counted');
  assert.equal(stats.packedCases, 0, 'unresolved item is not counted as packed');
  assert.equal(stats.unresolvedInstances, 1, 'stats expose the unresolved instance count');
  assert.equal(stats.totalWeight, 0, 'no invented weight for the unresolved item');
  // Export preserves the dangling reference for recovery.
  const json = IE.buildPackExportJSON(dpack);
  assert.match(json, /"caseId":\s*"ghost"/, 'export keeps the unresolved caseId for recovery');

  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(editorSrc, /renderUnresolvedCaseInspector\(inst\)/, 'Inspector shows an unresolved-case warning instead of an empty panel');
});

test('CARGO-RULE-V1 repeated conflicting pack import is idempotent (no Imported 2/3...)', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Local "Box" with DIFFERENT cargo so the bundled "Box" always conflicts.
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'box', name: 'Box', weight: 99 })], packLibrary: [], folderLibrary: [], preferences: {} });
  const payload = (n) => ({
    pack: { id: 'p', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('box', { id: `inst-${n}`, transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'box', name: 'Box', weight: 10 })],
  });

  const r1 = PackLibrary.importPackPayload(payload(1));
  assert.equal((StateStore.get('caseLibrary') || []).length, 2, 'first conflict creates one imported case');
  assert.equal(r1.caseConflicts.length, 1, 'first import reports one conflict');
  const importedId = r1.caseConflicts[0].newId;
  assert.equal(r1.cases[0].caseId, importedId, 'first instance remaps to the imported case');

  for (let n = 2; n <= 3; n++) {
    const r = PackLibrary.importPackPayload(payload(n));
    const lib = StateStore.get('caseLibrary') || [];
    assert.equal(lib.length, 2, `import ${n} must reuse the imported case (no growth)`);
    assert.equal(r.caseConflicts.length, 0, `import ${n} reports no new conflict`);
    assert.equal(r.cases[0].caseId, importedId, `import ${n} remaps to the same imported case id`);
    assert.equal(lib.filter(c => /\(Imported/.test(c.name)).length, 1, 'exactly one (Imported) case exists');
    assert.ok(!lib.some(c => /\(Imported [23]\)/.test(c.name)), 'no (Imported 2)/(Imported 3) names');
  }
  // Original local case stays unchanged.
  const original = (StateStore.get('caseLibrary') || []).find(c => c.id === 'box');
  assert.equal(Number(original.weight), 99, 'original local case unchanged');
});

test('CARGO-RULE-V1 idempotence holds across alias/number formats and through reload normalization', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'sc', name: 'Side Case', weight: 99 })], packLibrary: [], folderLibrary: [], preferences: {} });

  // First import: bundled uses 'on side' alias + string dims.
  PackLibrary.importPackPayload({
    pack: { id: 'p1', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('sc', { id: 'a', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'sc', name: 'Side Case', weight: 10, orientationLock: 'on side', dimensions: { length: '10', width: '10', height: '10' } })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 2);

  // Simulate a reload: normalize the whole library, then re-import with canonical 'onSide' + numeric dims.
  const reloaded = Normalizer.normalizeAppData({ caseLibrary: StateStore.get('caseLibrary'), packLibrary: [], folderLibrary: [] });
  StateStore.init({ caseLibrary: reloaded.caseLibrary, packLibrary: [], folderLibrary: [], preferences: {} });
  const importedCase = reloaded.caseLibrary.find(c => /\(Imported/.test(c.name));
  assert.ok(importedCase.importSourceKey, 'importSourceKey survives reload normalization');

  const r = PackLibrary.importPackPayload({
    pack: { id: 'p2', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('sc', { id: 'b', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'sc', name: 'Side Case', weight: 10, orientationLock: 'onSide', dimensions: { length: 10, width: 10, height: 10 } })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 2, 'alias/format-equivalent re-import after reload reuses the imported case');
  assert.equal(r.caseConflicts.length, 0, 'no new conflict after reload');
});

test('CARGO-RULE-V1 laneItem:false does not compare equal to Automatic; distinct cargo stays separate', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'ln', name: 'Lane Case', weight: 99 })], packLibrary: [], folderLibrary: [], preferences: {} });
  // Two conflicting bundled cases differing only by laneItem false vs automatic(null) → two distinct imported cases.
  PackLibrary.importPackPayload({
    pack: { id: 'pa', title: 'A', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ln', { id: 'x', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'ln', name: 'Lane Case', weight: 10, laneItem: false })],
  });
  PackLibrary.importPackPayload({
    pack: { id: 'pb', title: 'B', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ln', { id: 'y', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'ln', name: 'Lane Case', weight: 10, laneItem: null })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 3, 'laneItem:false and Automatic are distinct cargo → two imported cases');
});

test('CARGO-RULE-V1 pack import creates a renamed case on cargo conflict, remaps instances, leaves local unchanged', async () => {
  const StateStore = await import(stateStorePath.href);

  // Each scenario: a local case, and a bundled case that matches by name or id
  // but differs in one cargo-defining field. Each must NOT reuse the local case.
  const scenarios = [
    { label: 'different dimensions (same name)', local: { id: 'L1', name: 'Box A' }, bundled: { id: 'B1', name: 'Box A', dimensions: { length: 99, width: 10, height: 10 } } },
    { label: 'different canFlip (same name)', local: { id: 'L2', name: 'Box B', canFlip: true }, bundled: { id: 'B2', name: 'Box B', canFlip: false } },
    { label: 'different orientationLock (same name)', local: { id: 'L3', name: 'Box C' }, bundled: { id: 'B3', name: 'Box C', orientationLock: 'upright' } },
    { label: 'different stacking rule (same name)', local: { id: 'L4', name: 'Box D' }, bundled: { id: 'B4', name: 'Box D', noStackOnTop: true } },
    { label: 'same id, different cargo', local: { id: 'SAME', name: 'Box E' }, bundled: { id: 'SAME', name: 'Box E', weight: 777 } },
  ];

  for (const sc of scenarios) {
    const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
    const localCase = makePackImportSafeCase(sc.local);
    StateStore.init({ caseLibrary: [localCase], packLibrary: [], folderLibrary: [], preferences: {} });

    const bundledCase = makePackImportSafeCase(sc.bundled);
    const result = PackLibrary.importPackPayload({
      pack: {
        id: 'p1', title: 'Conflict Pack', truck: { length: 120, width: 60, height: 60 },
        cases: [makePackImportInstance(sc.bundled.id, { id: 'inst-x', transform: { position: { x: 10, y: 5, z: 0 } } })],
      },
      bundledCases: [bundledCase],
    });

    const lib = StateStore.get('caseLibrary') || [];
    assert.equal(lib.length, 2, `${sc.label}: a new local case must be created, not reused`);
    const original = lib.find(c => c.id === sc.local.id);
    assert.ok(original, `${sc.label}: original local case must still exist`);
    assert.equal(Number(original.dimensions.length), Number(localCase.dimensions.length), `${sc.label}: original local case must be unchanged`);
    assert.equal(Number(original.weight), Number(localCase.weight), `${sc.label}: original local weight unchanged`);
    const newCase = lib.find(c => c.id !== sc.local.id);
    assert.ok(newCase, `${sc.label}: a distinct new case id must be created`);
    assert.match(String(newCase.name), /\(Imported/, `${sc.label}: conflicting case must get an (Imported) name suffix`);
    assert.equal(result.cases[0].caseId, newCase.id, `${sc.label}: imported instance must remap to the new case id`);
    assert.equal(result.caseConflicts.length, 1, `${sc.label}: one conflict must be reported`);
  }
});

test('CARGO-RULE-V1 re-importing the same exported pack reuses cases (idempotent, no duplicate growth)', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });

  const bundled = [makePackImportSafeCase({ id: 'cc-1', name: 'Roundtrip Case', noStackOnTop: true, maxStackCount: 2, orientationLock: 'upright' })];
  const payload = () => ({
    pack: { id: 'rp', title: 'RT', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('cc-1', { id: 'i1', transform: { position: { x: 10, y: 5, z: 0 } } })] },
    bundledCases: bundled.map(c => ({ ...c })),
  });

  PackLibrary.importPackPayload(payload());
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'first import creates the case');
  const second = PackLibrary.importPackPayload(payload());
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'second import of the same pack reuses the case (no duplicate)');
  assert.equal(second.caseConflicts.length, 0, 'equivalent re-import reports no conflict');
  assert.equal(second.cases[0].caseId, 'cc-1', 'instance still references the original case id');
});

test('CARGO-RULE-V1 batch pack import applies the same cargo-conflict rule', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const localCase = makePackImportSafeCase({ id: 'bb-1', name: 'Batch Case' });
  StateStore.init({ caseLibrary: [localCase], packLibrary: [], folderLibrary: [], preferences: {} });

  // Two packs: one equivalent (reuse), one conflicting (new renamed case).
  const equivalent = { pack: { id: 'bp1', title: 'Eq', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('bb-1', { id: 'be1', transform: { position: { x: 10, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'bb-1', name: 'Batch Case' })] };
  const conflicting = { pack: { id: 'bp2', title: 'Cf', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('bb-2', { id: 'be2', transform: { position: { x: 10, y: 5, z: 0 } } })] }, bundledCases: [makePackImportSafeCase({ id: 'bb-2', name: 'Batch Case', weight: 555 })] };

  const r1 = PackLibrary.importPackPayload(equivalent);
  assert.equal(r1.caseConflicts.length, 0, 'equivalent batch entry reuses local case');
  const r2 = PackLibrary.importPackPayload(conflicting);
  assert.equal(r2.caseConflicts.length, 1, 'conflicting batch entry creates a renamed case');
  const lib = StateStore.get('caseLibrary') || [];
  assert.equal(lib.length, 2, 'batch import adds exactly one new case for the conflict');
  assert.equal(r2.cases[0].caseId, r2.caseConflicts[0].newId, 'conflicting instance remaps to the new case');
});

test('PACK-IMPORT-SAFE-1 invalid imported transforms are staged without overlap outside the truck', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-invalid', dimensions: { length: 12, width: 12, height: 12 } });

  StateStore.init({ caseLibrary: [caseData], packLibrary: [], folderLibrary: [], preferences: {} });
  const importedPack = PackLibrary.importPackPayload(makePackImportPayload(
    caseData,
    [
      makePackImportInstance(caseData.id, { transform: null }),
      makePackImportInstance(caseData.id, { transform: { position: { x: 'bad', y: 6, z: 0 } } }),
      makePackImportInstance(caseData.id, { transform: { position: { x: 12, z: 0 } } }),
      makePackImportInstance(caseData.id, { transform: { position: { x: 999, y: 6, z: 999 } } }),
    ],
    { truck: { length: 120, width: 60, height: 60 } }
  ));

  assertPackImportNoOverlaps(importedPack.cases, caseData);
  assert.ok(
    importedPack.cases.every(inst => inst.transform.position.z > importedPack.truck.width / 2),
    'Invalid or missing imported transforms must stage outside the truck footprint'
  );
  assert.equal(PackLibrary.computeStats(importedPack, [caseData]).packedCases, 0,
    'Staged repaired instances must not count as packed in the truck');
});

test('PACK-IMPORT-SAFE-1 duplicate imported transforms preserve one safe placement and stage the collision', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-dupe', dimensions: { length: 10, width: 10, height: 10 } });
  const duplicateTransform = { position: { x: 5, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };

  StateStore.init({ caseLibrary: [caseData], packLibrary: [], folderLibrary: [], preferences: {} });
  const importedPack = PackLibrary.importPackPayload(makePackImportPayload(
    caseData,
    [
      makePackImportInstance(caseData.id, { transform: duplicateTransform }),
      makePackImportInstance(caseData.id, { transform: duplicateTransform }),
    ],
    { truck: { length: 120, width: 60, height: 60 } }
  ));

  assertPackImportNoOverlaps(importedPack.cases, caseData);
  assert.equal(
    importedPack.cases.filter(inst => inst.transform.position.z <= importedPack.truck.width / 2).length,
    1,
    'Exactly one duplicate safe in-truck placement should be preserved'
  );
  assert.equal(
    importedPack.cases.filter(inst => inst.transform.position.z > importedPack.truck.width / 2).length,
    1,
    'Colliding duplicate imported placement should be staged'
  );
});

test('PACK-IMPORT-SAFE-1 valid explicit non-overlapping in-truck placements are preserved', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-import-valid', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({ caseLibrary: [caseData], packLibrary: [], folderLibrary: [], preferences: {} });
  const importedPack = PackLibrary.importPackPayload(makePackImportPayload(
    caseData,
    [
      makePackImportInstance(caseData.id, { transform: { position: { x: 5, y: 5, z: -10 } } }),
      makePackImportInstance(caseData.id, { transform: { position: { x: 20, y: 5, z: -10 } } }),
    ],
    { truck: { length: 120, width: 60, height: 60 } }
  ));

  assertPackImportNoOverlaps(importedPack.cases, caseData);
  assert.deepEqual(
    importedPack.cases.map(inst => inst.transform.position.x).sort((a, b) => a - b),
    [5, 20],
    'Safe explicit imported X positions must be preserved'
  );
  assert.equal(PackLibrary.computeStats(importedPack, [caseData]).packedCases, 2,
    'Safe explicit imported placements should remain packed');
});

test('PACK-IMPORT-SAFE-1 addInstance default placement uses dynamic non-overlapping staging rows', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-add-staging', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-add-staging', title: 'Add Staging', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  for (let i = 0; i < 12; i++) {
    PackLibrary.addInstance('pack-add-staging', caseData.id);
  }
  const pack = PackLibrary.getById('pack-add-staging');
  assertPackImportNoOverlaps(pack.cases, caseData);

  const firstRowZ = Math.min(...pack.cases.map(inst => inst.transform.position.z));
  const firstRowCount = pack.cases.filter(inst => Math.abs(inst.transform.position.z - firstRowZ) < 0.001).length;
  assert.ok(firstRowCount > 6,
    'Dynamic staging grid should place more than six items in a row when the truck length allows it');
  assert.ok(pack.cases.every(inst => inst.transform.position.z > pack.truck.width / 2),
    'Default added instances should stage outside the truck until manually packed');
});

// ── End PACK-IMPORT-SCHEMA-1 ──────────────────────────────────────────────

// ── PLACEMENT-STATE-S2 ─────────────────────────────────────────────────────

test('PLACEMENT-STATE-S2 addInstance writes "staged" placement by default', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-placement-default', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-placement-default', title: 'Placement Default', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  const instance = PackLibrary.addInstance('pack-placement-default', caseData.id);
  assert.equal(instance.placement, 'staged',
    'addInstance without an explicit position must default to staged placement');

  const pack = PackLibrary.getById('pack-placement-default');
  assert.equal(pack.cases[0].placement, 'staged',
    'persisted instance must record staged placement');
});

test('PLACEMENT-STATE-S2 explicit in-truck addInstance writes "packed" placement', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-placement-packed', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-placement-packed', title: 'Placement Packed', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  const instance = PackLibrary.addInstance('pack-placement-packed', caseData.id, { x: 50, y: 5, z: 0 });
  assert.equal(instance.placement, 'packed',
    'an explicit position inside the trailer usable zone must be recorded as packed');
});

test('PLACEMENT-STATE-S2 explicit outside-truck addInstance writes "staged" placement', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = makePackImportSafeCase({ id: 'case-placement-outside', dimensions: { length: 10, width: 10, height: 10 } });

  StateStore.init({
    caseLibrary: [caseData],
    packLibrary: [{ id: 'pack-placement-outside', title: 'Placement Outside', truck: { length: 220, width: 80, height: 80 }, cases: [] }],
    folderLibrary: [],
    preferences: {},
  });

  const instance = PackLibrary.addInstance('pack-placement-outside', caseData.id, { x: 50, y: 5, z: 60 });
  assert.equal(instance.placement, 'staged',
    'an explicit position outside the trailer usable zone must be recorded as staged');
});

test('PLACEMENT-STATE-S2 AutoPack records placement from solver results', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  assert.match(src, /placement: placements\.has\(inst\.id\) \? 'packed' : 'staged',/,
    'AutoPack must mark solver-placed cases as packed and overflow/staged cases as staged');
});

test('PLACEMENT-STATE-S2 unpackAll records "staged" placement for every case', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function unpackAll()');
  const end = src.indexOf('\n    }', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define unpackAll()');
  assert.match(block, /placement:\s*'staged',/,
    'unpackAll must mark every case as staged placement');
});

test('PLACEMENT-STATE-S2 duplicateSelection records placement from staging fallback', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function duplicateSelection(pack, selectedIds)');
  const end = src.indexOf('\n    }', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define duplicateSelection(pack, selectedIds)');
  assert.match(block, /placement:\s*placement\.staged \? 'staged' : 'packed',/,
    'duplicateSelection must mark in-truck duplicates as packed and staging fallback duplicates as staged');
});

test('PLACEMENT-STATE-S2 finishDrag records placement from final zone containment', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishDrag()');
  const end = src.indexOf('\n    }', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define finishDrag()');
  assert.match(block, /PackLibrary\.isAabbContainedInAnyZone\(aabb, zonesInches\)/,
    'finishDrag must derive placement from the final AABB against trailer usable zones');
  assert.match(block, /placementById\.set\(id, PackLibrary\.isAabbContainedInAnyZone\(aabb, zonesInches\) \? 'packed' : 'staged'\)/,
    'finishDrag must mark instances inside the trailer usable zones as packed and instances outside as staged');
  assert.match(block, /placement:\s*placementValue/,
    'finishDrag must write the computed placement onto each moved instance');
});

test('PLACEMENT-STATE-S2 normalizer keeps old packs without a placement field loadable', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);

  const normalized = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-legacy-placement',
        name: 'Legacy Case',
        dimensions: { length: 24, width: 24, height: 24 },
      },
    ],
    packLibrary: [
      {
        id: 'pack-legacy-placement',
        title: 'Legacy Pack',
        truck: { length: 120, width: 48, height: 48 },
        cases: [
          {
            id: 'inst-legacy-no-placement',
            caseId: 'case-legacy-placement',
            transform: { position: { x: 10, y: 12, z: 0 } },
          },
        ],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });

  const instance = normalized.packLibrary[0].cases[0];
  assert.equal(instance.id, 'inst-legacy-no-placement',
    'old packs without a placement field must still load their instances');
  assert.equal(instance.placement, null,
    'instances without a placement field must normalize to null, not throw or default to a guessed state');
});

// ── End PLACEMENT-STATE-S2 ─────────────────────────────────────────────────

// ── STAGING-S3 ──────────────────────────────────────────────────────────────

test('STAGING-S3 pack-library exposes staging bounds derived from the canonical staging layout', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const layout = PackLibrary.getStagingLayout(truck);
  const bounds = PackLibrary.getStagingBounds(truck);

  assert.equal(bounds.min.z, layout.originZ - layout.gap,
    'staging bounds must start at the canonical staging origin (minus margin) in Z');
  assert.ok(bounds.min.z >= truck.width / 2 - 0.001,
    'staging bounds must not overlap the trailer usable width');
  assert.ok(bounds.max.x > layout.truckL,
    'staging bounds must extend at least to the trailer length in X');
  assert.ok(bounds.max.z > bounds.min.z,
    'staging bounds must define a non-empty depth');
});

test('STAGING-S3 isAabbInStagingZone accepts canonical staged positions and rejects far drift', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const pack = { truck };
  const dims = { length: 30, width: 20, height: 24 };
  const staged = PackLibrary.findSafeStagingPosition(pack, dims, []);

  assert.equal(PackLibrary.isAabbInStagingZone(pack, staged.aabb), true,
    'an item placed by findSafeStagingPosition must be inside the canonical staging zone');

  const farAabb = {
    min: { x: 5000, y: 0, z: 5000 },
    max: { x: 5030, y: 24, z: 5020 },
  };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, farAabb), false,
    'an AABB drifted far away from the trailer must not be considered inside the staging zone');
});

// ── End STAGING-S3 ──────────────────────────────────────────────────────────

// ── STAGING-S3.1 ────────────────────────────────────────────────────────────

test('STAGING-S3.1 canonical staging placement still starts near the trailer', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const dims = { length: 24, width: 24, height: 24 };
  const staged = PackLibrary.findSafeStagingPosition(pack, dims, []);
  const stagingBounds = PackLibrary.getStagingBounds(truck);

  assert.ok(
    staged.aabb.min.z >= stagingBounds.min.z - 0.001 && staged.aabb.max.z <= stagingBounds.max.z + 0.001,
    'canonical auto-placed staging items must remain inside the tight canonical staging-row envelope near the trailer'
  );
});

test('STAGING-S3.1 staging work-area bounds are larger than the canonical staging layout bounds', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const stagingBounds = PackLibrary.getStagingBounds(truck);
  const workArea = PackLibrary.getStagingWorkAreaBounds(truck);

  assert.ok(workArea.min.x < stagingBounds.min.x,
    'work area must extend further before the trailer in X than canonical staging');
  assert.ok(workArea.max.x > stagingBounds.max.x,
    'work area must extend further past the trailer in X than canonical staging');
  assert.ok(workArea.min.z < stagingBounds.min.z,
    'work area must extend to the opposite side of the trailer in Z, unlike canonical staging');
  assert.ok(workArea.max.z > stagingBounds.max.z,
    'work area must extend further beyond the canonical staging rows in Z');
});

test('STAGING-S3.1 a staged item several feet away from the trailer is accepted', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // 24" item sitting ~30" past the back of the trailer (x beyond truck.length)
  const aabb = { min: { x: 230, y: 0, z: -12 }, max: { x: 254, y: 24, z: 12 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), false,
    'sanity check: this position must be outside the trailer usable zones');
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), true,
    'an item dragged a few feet past the back of the trailer must remain inside the staging work area');
});

test('STAGING-S3.1 a staged item on the opposite side of the trailer is accepted', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // 24" item on the -Z side of the trailer (opposite the canonical staging rows)
  const aabb = { min: { x: 50, y: 0, z: -100 }, max: { x: 74, y: 24, z: -76 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), false,
    'sanity check: this position must be outside the trailer usable zones');
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), true,
    'the staging work area must support both sides of the trailer, not only the canonical staging side');
});

test('STAGING-S3.1 a staged item extremely far away is rejected', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };

  const aabb = { min: { x: 5000, y: 0, z: 5000 }, max: { x: 5024, y: 24, z: 5024 } };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), false,
    'an item dragged extremely far away must still be rejected by the staging work area');
});

test('STAGING-S3.1 rotation near the edge of the larger work area has tolerance', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const workArea = PackLibrary.getStagingWorkAreaBounds(truck);

  const atEdge = {
    min: { x: 100, y: 0, z: workArea.min.z - 0.04 },
    max: { x: 124, y: 24, z: workArea.min.z - 0.04 + 24 },
  };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, atEdge), true,
    'an AABB within the floating-point epsilon of the work-area edge must not be falsely rejected');

  const beyondEdge = {
    min: { x: 100, y: 0, z: workArea.min.z - 1 },
    max: { x: 124, y: 24, z: workArea.min.z - 1 + 24 },
  };
  assert.equal(PackLibrary.isAabbInStagingZone(pack, beyondEdge), false,
    'an AABB clearly past the work-area edge must still be rejected');
});

test('STAGING-S3.1 packed item containment inside the trailer remains strict despite the larger work area', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const pack = { truck };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // Just past the trailer's back wall (x.max = 221 > truck.length = 220 by more than EPS)
  const aabb = { min: { x: 197, y: 0, z: -12 }, max: { x: 221, y: 24, z: 12 } };

  assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), false,
    'an AABB extending past the trailer usable zone must not be considered packed, even though it is well within the larger staging work area');
  assert.equal(PackLibrary.isAabbInStagingZone(pack, aabb), true,
    'sanity check: this position is comfortably inside the larger staging work area');
});

// ── End STAGING-S3.1 ────────────────────────────────────────────────────────

// ── STAGING-S3.2 ────────────────────────────────────────────────────────────

test('STAGING-S3.2 rotateSelection allows free staged rotation and writes placement from trailer containment', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function rotateSelection(axis, delta)');
  const end = src.indexOf('\n    /**\n     * Nudge selected instances', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define rotateSelection(axis, delta)');
  assert.doesNotMatch(block, /isAabbInStagingZone/,
    'rotateSelection must not gate staged rotation on the staging work-area bounds');
  assert.match(block, /if \(check\.collides \|\| \(originalInsideTruck && !check\.insideTruck\)\)/,
    'rotateSelection must still revert on collision, or when a packed item would leave the trailer usable zones');
  assert.match(block, /placement:\s*check\.insideTruck \? 'packed' : 'staged',/,
    'rotateSelection must record placement based on the rotated item\'s final trailer containment');
});

test('STAGING-S3.2 finishDrag does not reject staged placement based on staging work-area bounds', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function finishDrag()');
  const end = src.indexOf('\n    }', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define finishDrag()');
  assert.doesNotMatch(block, /isAabbInStagingZone/,
    'finishDrag must not gate staged placement on the staging work-area bounds');
  assert.doesNotMatch(block, /anyOutsideAllowedZones/,
    'finishDrag must not revert a non-colliding drop solely for landing outside the staging work area');
  assert.doesNotMatch(block, /Cannot place here: outside the staging area/,
    'finishDrag must no longer show a staging-area rejection toast');
  assert.match(block, /placementById\.set\(id, PackLibrary\.isAabbContainedInAnyZone\(aabb, zonesInches\) \? 'packed' : 'staged'\)/,
    'finishDrag must derive placement purely from trailer usable-zone containment');
  assert.match(block, /if \(anyCollides\) \{[\s\S]*revertGroupToStart\(groupIds, startMap\)/,
    'finishDrag must still revert the drag group on collision');
});

test('STAGING-S3.2 staging work-area helpers remain exported but are no longer enforced by the editor', async () => {
  const packSrc = await fs.readFile(packLibraryPath, 'utf8');
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');

  assert.match(packSrc, /export function getStagingBounds\(truck, options = \{\}\)/,
    'getStagingBounds must remain exported from S1');
  assert.match(packSrc, /export function getStagingWorkAreaBounds\(truck, options = \{\}\)/,
    'getStagingWorkAreaBounds must remain exported for future use');
  assert.match(packSrc, /export function isAabbInStagingZone\(pack, aabb, options = \{\}\)/,
    'isAabbInStagingZone must remain exported for future use');
  assert.doesNotMatch(editorSrc, /isAabbInStagingZone/,
    'editor-screen must not call isAabbInStagingZone for manual drag/rotate validation anymore');
});

test('STAGING-S3.2 a staged item far from the trailer is classified as staged, not rejected', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 220, width: 80, height: 80 };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  // Far outside both the trailer and the old S3.1 staging work-area bounds
  const farAabb = { min: { x: 5000, y: 0, z: 5000 }, max: { x: 5024, y: 24, z: 5024 } };
  const placement = PackLibrary.isAabbContainedInAnyZone(farAabb, zones) ? 'packed' : 'staged';

  assert.equal(placement, 'staged',
    'an item dragged far from the trailer must be classified as staged, not rejected outright');
});

// ── End STAGING-S3.2 ────────────────────────────────────────────────────────

// ── G1-DIRECTION ────────────────────────────────────────────────────────────

test('G1-DIRECTION pack-library exports a truck direction model contract', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  assert.ok(PackLibrary.TRUCK_DIRECTION_MODEL, 'TRUCK_DIRECTION_MODEL must be exported');
  assert.equal(PackLibrary.TRUCK_DIRECTION_MODEL.lengthAxis, 'x', 'length must be modeled along X');
  assert.equal(PackLibrary.TRUCK_DIRECTION_MODEL.widthAxis, 'z', 'width must be modeled along Z');
  assert.equal(PackLibrary.TRUCK_DIRECTION_MODEL.heightAxis, 'y', 'height must be modeled along Y');

  assert.equal(typeof PackLibrary.getTruckDirectionModel, 'function',
    'getTruckDirectionModel(truck) must be exported');
});

test('G1-DIRECTION rear/loading-door maps to x=0 and front/cab maps to x=truck.length', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72 };
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.deepEqual(model.rear, { axis: 'x', value: 0 },
    'rear / loading-door side must be x=0');
  assert.deepEqual(model.front, { axis: 'x', value: truck.length },
    'front / cab side must be x=truck.length');
});

test('G1-DIRECTION width is centered on Z and floor maps to y=0', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72 };
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.deepEqual(model.left, { axis: 'z', value: -truck.width / 2 },
    'left side must be z=-truck.width/2');
  assert.deepEqual(model.right, { axis: 'z', value: truck.width / 2 },
    'right side must be z=+truck.width/2');
  assert.deepEqual(model.floor, { axis: 'y', value: 0 },
    'floor must be y=0');
});

test('G1-DIRECTION getStagingLayout still starts at originX=0, matching the rear/loading-door origin', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72 };
  const layout = PackLibrary.getStagingLayout(truck);
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.equal(layout.originX, model.rear.value,
    'canonical staging origin must align with the rear/loading-door end of the direction model');
});

test('G1-DIRECTION frontBonus overhang zone extends beyond the front/high-X side', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const model = PackLibrary.getTruckDirectionModel(truck);
  const mainZone = zones.find(z => z.min.x === 0);
  const overhangZone = zones.find(z => z.min.x === truck.length);

  assert.ok(mainZone, 'frontBonus geometry must include a main zone starting at the rear (x=0)');
  assert.equal(mainZone.max.x, model.front.value,
    'frontBonus main zone must span the full main box up to the front/cab side');
  assert.ok(overhangZone, 'frontBonus geometry must include an overhang zone starting at the front (x=truck.length)');
  assert.equal(overhangZone.min.x, model.front.value,
    'frontBonus overhang zone must start at the front/cab side of the direction model');
  assert.equal(overhangZone.max.x, truck.length + truck.shapeConfig.bonusLength,
    'frontBonus overhang zone must extend beyond truck.length by bonusLength');
});

test('G1-DIRECTION wheel well offset remains measured from the rear/low-X side', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const model = PackLibrary.getTruckDirectionModel(truck);
  const rearZone = zones.find(z => z.min.x === 0);

  assert.ok(rearZone, 'wheelWells geometry must include a zone starting at the rear (x=0)');
  assert.equal(rearZone.min.x, model.rear.value,
    'wheel-well rear zone must start at the rear/loading-door origin');
  assert.equal(rearZone.max.x, truck.shapeConfig.wellOffsetFromRear,
    'wellOffsetFromRear must be measured starting from the rear (x=0), not the front');
});

// ── End G1-DIRECTION ────────────────────────────────────────────────────────

// ── G2-SHAPE-CONTRACT ────────────────────────────────────────────────────────

test('G2-SHAPE-CONTRACT rect shape produces a single full-box usable zone', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 72, shapeMode: 'rect' };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  assert.equal(zones.length, 1, 'rect must produce exactly one usable zone');
  assert.deepEqual(zones[0], {
    min: { x: 0, y: 0, z: -truck.width / 2 },
    max: { x: truck.length, y: truck.height, z: truck.width / 2 },
  }, 'rect zone must span the full 0..length x 0..height x -width/2..width/2 box');
});

test('G2-SHAPE-CONTRACT wheelWells produces multiple usable zones and excludes the wheel-well floor region', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 35, wellWidth: 15, wellLength: 35, wellOffsetFromRear: 25 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  assert.ok(zones.length > 1, 'wheelWells must produce multiple usable zones');

  const blockedAabb = {
    min: { x: 30, y: 0, z: -48 },
    max: { x: 40, y: 10, z: -40 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(blockedAabb, zones), false,
    'a box inside a wheel-well blocked floor region must not be contained in any usable zone');
});

test('G2-SHAPE-CONTRACT a box visually inside the outer trailer box but inside a wheel-well region is classified outside usable zones', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 35, wellWidth: 15, wellLength: 35, wellOffsetFromRear: 25 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);

  const outerBox = {
    min: { x: 0, y: 0, z: -truck.width / 2 },
    max: { x: truck.length, y: truck.height, z: truck.width / 2 },
  };
  const wheelWellAabb = {
    min: { x: 30, y: 0, z: -48 },
    max: { x: 40, y: 10, z: -40 },
  };

  const insideOuterBox =
    wheelWellAabb.min.x >= outerBox.min.x && wheelWellAabb.max.x <= outerBox.max.x &&
    wheelWellAabb.min.y >= outerBox.min.y && wheelWellAabb.max.y <= outerBox.max.y &&
    wheelWellAabb.min.z >= outerBox.min.z && wheelWellAabb.max.z <= outerBox.max.z;

  assert.equal(insideOuterBox, true,
    'sanity check: the wheel-well box must be inside the outer trailer box bounds');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(wheelWellAabb, zones), false,
    'the same box must be classified outside the shape-aware usable zones');
});

test('G2-SHAPE-CONTRACT frontBonus main zone spans the full main box from x=0 to x=truck.length', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const mainZone = zones.find(z => z.min.x === 0);

  assert.ok(mainZone, 'frontBonus must include a main zone starting at x=0');
  assert.equal(mainZone.max.x, truck.length, 'frontBonus main zone must span the full main box up to x=truck.length');
  assert.equal(mainZone.min.y, 0, 'frontBonus main zone must keep the full height (min.y=0)');
  assert.equal(mainZone.max.y, truck.height, 'frontBonus main zone must keep the full height (max.y=height)');
  assert.equal(mainZone.min.z, -truck.width / 2, 'frontBonus main zone must keep the full width (min.z=-width/2)');
  assert.equal(mainZone.max.z, truck.width / 2, 'frontBonus main zone must keep the full width (max.z=width/2)');
});

test('G2-SHAPE-CONTRACT frontBonus overhang zone is a raised platform flush with the ceiling, spanning the full trailer width', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally different from truck.width here to prove
    // it is ignored - the overhang must always span the full trailer width.
    shapeConfig: { bonusLength: 60, bonusWidth: 30, bonusHeight: 24 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const overhangZone = zones.find(z => z.min.x === truck.length);

  assert.ok(overhangZone, 'frontBonus must include an overhang zone starting at x=truck.length');
  assert.equal(overhangZone.max.x, truck.length + truck.shapeConfig.bonusLength,
    'frontBonus overhang zone must end at x=truck.length+bonusLength');
  assert.equal(overhangZone.min.y, truck.shapeConfig.bonusHeight,
    'frontBonus overhang zone must be a raised platform starting at y=bonusHeight (deck height / cab clearance from the main floor)');
  assert.equal(overhangZone.max.y, truck.height,
    'frontBonus overhang zone must be flush with the main box ceiling (max.y=truck.height)');
  assert.equal(overhangZone.min.z, -truck.width / 2,
    'frontBonus overhang zone must span the full trailer width (min.z=-truck.width/2), ignoring bonusWidth');
  assert.equal(overhangZone.max.z, truck.width / 2,
    'frontBonus overhang zone must span the full trailer width (max.z=truck.width/2), ignoring bonusWidth');
});

test('G2-SHAPE-CONTRACT missing/invalid/non-finite bonusLength defaults to 0 and frontBonus becomes equivalent to rect', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const baseTruck = { length: 240, width: 96, height: 72 };
  const rectTruck = { ...baseTruck, shapeMode: 'rect' };
  const rectZones = PackLibrary.getTrailerUsableZones(rectTruck);
  const rectCapacity = PackLibrary.getTrailerCapacityInches3(rectTruck);

  const variants = [
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: {} },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: -10 } },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: 'not-a-number' } },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: NaN } },
    { ...baseTruck, shapeMode: 'frontBonus', shapeConfig: { bonusLength: Infinity } },
  ];

  for (const frontBonusTruck of variants) {
    const frontBonusCapacity = PackLibrary.getTrailerCapacityInches3(frontBonusTruck);
    assert.ok(Math.abs(rectCapacity - frontBonusCapacity) < 1e-6,
      `frontBonus with bonusLength=${JSON.stringify(frontBonusTruck.shapeConfig.bonusLength)} must match rect usable volume`);

    const frontBonusZones = PackLibrary.getTrailerUsableZones(frontBonusTruck);
    assert.equal(frontBonusZones.length, 1,
      `frontBonus with bonusLength=${JSON.stringify(frontBonusTruck.shapeConfig.bonusLength)} must collapse to a single zone (no overhang)`);
    assert.equal(frontBonusZones[0].max.x, rectZones[0].max.x, 'frontBonus zone must match rect zone bounds (max.x)');
    assert.equal(frontBonusZones[0].min.y, 0, 'default frontBonus zone must keep the full height (min.y=0)');
    assert.equal(frontBonusZones[0].max.y, baseTruck.height, 'default frontBonus zone must keep the full height (max.y=height)');
    assert.equal(frontBonusZones[0].min.z, -baseTruck.width / 2, 'default frontBonus zone must keep the full width (min.z=-width/2)');
    assert.equal(frontBonusZones[0].max.z, baseTruck.width / 2, 'default frontBonus zone must keep the full width (max.z=width/2)');
  }
});

test('G2-SHAPE-CONTRACT getTrailerCapacityInches3 for frontBonus adds the overhang volume to the rect capacity', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const baseTruck = { length: 240, width: 96, height: 72 };
  const rectTruck = { ...baseTruck, shapeMode: 'rect' };
  const frontBonusTruck = {
    ...baseTruck,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 48, bonusHeight: 36 },
  };

  const rectCapacity = PackLibrary.getTrailerCapacityInches3(rectTruck);
  const frontBonusCapacity = PackLibrary.getTrailerCapacityInches3(frontBonusTruck);
  const { bonusLength, bonusHeight } = frontBonusTruck.shapeConfig;
  // Overhang spans the full trailer width (truck.width), not bonusWidth, and its
  // usable height is (truck.height - bonusHeight) since the deck starts at y=bonusHeight.
  const overhangVolume = bonusLength * baseTruck.width * (baseTruck.height - bonusHeight);

  assert.ok(Math.abs(frontBonusCapacity - (rectCapacity + overhangVolume)) < 1e-6,
    'frontBonus capacity with bonusLength>0 must equal rect capacity plus the overhang volume (full trailer width x (height - bonusHeight))');
});

test('G2-SHAPE-CONTRACT a box in the raised front overhang is contained only when within its raised platform bounds', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 60, bonusWidth: 30, bonusHeight: 36 },
    shapeMode: 'frontBonus',
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  // Overhang zone: x:240..300, y:36..72 (bonusHeight..height), z:-48..48 (full width).
  // Cab void: x:240..300, y:0..36 (0..bonusHeight), z:-48..48 (full width).

  const insideOverhang = {
    min: { x: 250, y: 40, z: -10 },
    max: { x: 290, y: 60, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(insideOverhang, zones), true,
    'a box fully inside the raised overhang platform must be contained in a usable zone');

  const beyondOverhangLength = {
    min: { x: 295, y: 40, z: -10 },
    max: { x: 310, y: 60, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(beyondOverhangLength, zones), false,
    'a box extending beyond truck.length+bonusLength must not be contained in any usable zone');

  const penetratesCabVoidBelowDeck = {
    min: { x: 250, y: 20, z: -10 },
    max: { x: 290, y: 50, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(penetratesCabVoidBelowDeck, zones), false,
    'a box extending below the overhang deck (y < bonusHeight, into the cab void) must not be contained in any usable zone');

  const straddlesMainAndOverhangGap = {
    min: { x: 230, y: 50, z: -10 },
    max: { x: 250, y: 65, z: 10 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(straddlesMainAndOverhangGap, zones), false,
    'a box straddling the main box and the raised overhang (passing through the overhang structure) must not be contained in any usable zone');

  const overhangZone = zones.find(z => z.min.x === truck.length);
  assert.equal(overhangZone.min.z, -truck.width / 2, 'overhang width must be the full trailer width, not bonusWidth');
  assert.equal(overhangZone.max.z, truck.width / 2, 'overhang width must be the full trailer width, not bonusWidth');
});

test('G2-SHAPE-CONTRACT computeStats does not flag a properly placed item in the raised front overhang as protrudesFront', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 48, bonusHeight: 36 },
  };
  // Overhang zone: x:240..300, y:36..72 (bonusHeight..height), z:-48..48.
  const caseData = {
    id: 'overhang-test-case',
    name: 'Overhang Test Case',
    dimensions: { length: 40, width: 20, height: 20 },
    volume: 40 * 20 * 20,
    weight: 100,
  };
  const pack = {
    truck,
    cases: [
      {
        id: 'inst-overhang-1',
        caseId: caseData.id,
        hidden: false,
        // Resting on the raised overhang deck: y = bonusHeight + height/2 = 36 + 10 = 46.
        transform: { position: { x: 270, y: 46, z: 0 } },
      },
    ],
  };

  const stats = PackLibrary.computeStats(pack, [caseData]);

  assert.equal(stats.packedCases, 1, 'an item correctly placed on the raised front overhang deck must count as packed');
  assert.deepEqual(stats.oogWarnings, [],
    'an item correctly placed on the raised front overhang deck must not produce any OOG warnings (e.g. protrudesFront)');
});

test('3B-GEOMETRY-TOLERANCE uses one shared inch-space containment tolerance', async () => {
  const packSrc = await fs.readFile(packLibraryPath, 'utf8');
  const solverSrc = await fs.readFile(autoPackSolverPath, 'utf8');
  const appSrc = await fs.readFile(appPath, 'utf8');
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const productionSrc = [packSrc, solverSrc, appSrc, editorSrc].join('\n');

  const definitions = productionSrc.match(/\bconst\s+CONTAINMENT_EPS_INCHES\s*=/g) || [];
  assert.equal(definitions.length, 1,
    'CONTAINMENT_EPS_INCHES must have exactly one production definition');
  assert.match(packSrc, /export const CONTAINMENT_EPS_INCHES = 0\.05;/,
    'pack-library.js must export the canonical 0.05 inch containment tolerance');
  assert.match(packSrc, /const EPS = CONTAINMENT_EPS_INCHES;/,
    'pack-library.js containment helper must use the shared tolerance constant');
  assert.match(solverSrc, /import \{ CONTAINMENT_EPS_INCHES \} from '\.\/pack-library\.js';/,
    'autopack-solver.js must import the shared containment tolerance');
  assert.match(solverSrc, /epsilon = CONTAINMENT_EPS_INCHES/,
    'autopack-solver.js containment defaults must reference the shared tolerance');

  const appHelperStart = appSrc.indexOf('function isAabbContainedInAnyZone(aabb, zones)');
  const appHelperEnd = appSrc.indexOf('\n      function zonesInchesToWorld', appHelperStart);
  const appHelperBlock = appHelperStart >= 0 && appHelperEnd > appHelperStart
    ? appSrc.slice(appHelperStart, appHelperEnd)
    : '';
  assert.ok(appHelperBlock, 'app.js TrailerGeometry containment helper must be present');
  assert.match(appHelperBlock, /CorePackLibrary\.CONTAINMENT_EPS_INCHES/,
    'app.js TrailerGeometry containment helper must reference the shared inch tolerance');
  assert.doesNotMatch(appHelperBlock, /0\.01/,
    'app.js TrailerGeometry containment helper must not retain the old 0.01 world-unit tolerance');

  const editorHelperStart = editorSrc.indexOf('function isInsideTruck(aabb)');
  const editorHelperEnd = editorSrc.indexOf('\n    function checkCollision', editorHelperStart);
  const editorHelperBlock = editorHelperStart >= 0 && editorHelperEnd > editorHelperStart
    ? editorSrc.slice(editorHelperStart, editorHelperEnd)
    : '';
  assert.ok(editorHelperBlock, 'editor-screen.js isInsideTruck helper must be present');
  assert.match(editorHelperBlock, /const aabbInches = aabbWorldToInches\(aabb\);/,
    'editor live containment path must convert the world-space AABB to inches');
  assert.match(editorHelperBlock, /TrailerGeometry\.isAabbContainedInAnyZone\(aabbInches, zonesInches\)/,
    'editor live containment path must call containment with inch-space AABB and inch-space zones');
  assert.doesNotMatch(editorHelperBlock, /zonesInchesToWorld\(zonesInches\)/,
    'editor live containment path must not pass world-space zones into the inch-space containment helper');
  assert.doesNotMatch(productionSrc, /containmentEpsWorld|worldContainmentEps|epsilonWorld|worldEpsilon/i,
    'production code must not add a parallel world-space containment epsilon');
});

test('3B-GEOMETRY-TOLERANCE canonical containment boundary behavior covers all active trailer shapes', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const rectTruck = { length: 100, width: 50, height: 40, shapeMode: 'rect' };
  const rectZones = PackLibrary.getTrailerUsableZones(rectTruck);

  assert.equal(PackLibrary.CONTAINMENT_EPS_INCHES, 0.05,
    'canonical containment tolerance must be 0.05 inches');

  const exactAllBoundaries = {
    min: { x: 0, y: 0, z: -25 },
    max: { x: 100, y: 40, z: 25 },
  };
  const outsideBy004 = {
    min: { x: -0.04, y: -0.04, z: -25.04 },
    max: { x: 100.04, y: 40.04, z: 25.04 },
  };
  const outsideBy006 = {
    min: { x: -0.06, y: -0.06, z: -25.06 },
    max: { x: 100.06, y: 40.06, z: 25.06 },
  };

  assert.equal(PackLibrary.isAabbContainedInAnyZone(exactAllBoundaries, rectZones), true,
    'a box exactly on all standard trailer boundaries must be contained');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(outsideBy004, rectZones), true,
    'a box outside the standard trailer by 0.04 inches must remain contained by tolerance');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(outsideBy006, rectZones), false,
    'a box outside the standard trailer by 0.06 inches must be rejected');
  assert.equal(Solver.isAabbContainedInAnyZone(outsideBy004, rectZones), true,
    'AutoPack solver containment must share the 0.05 inch tolerance');
  assert.equal(Solver.isAabbContainedInAnyZone(outsideBy006, rectZones), false,
    'AutoPack solver containment must reject protrusions beyond the shared tolerance');

  const wheelTruck = {
    length: 100,
    width: 100,
    height: 80,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 30, wellWidth: 15, wellLength: 30, wellOffsetFromRear: 20 },
  };
  const wheelZones = PackLibrary.getTrailerUsableZones(wheelTruck);
  const wheelBlockedVolume = {
    min: { x: 25, y: 0, z: -48 },
    max: { x: 35, y: 10, z: -40 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(wheelBlockedVolume, wheelZones), false,
    'wheel-well blocked lower volume must remain rejected');

  const frontBonusTruck = {
    length: 100,
    width: 50,
    height: 60,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 30, bonusWidth: 20, bonusHeight: 24 },
  };
  const frontBonusZones = PackLibrary.getTrailerUsableZones(frontBonusTruck);
  const overhangDeckVolume = {
    min: { x: 104, y: 28, z: -8 },
    max: { x: 124, y: 48, z: 8 },
  };
  const cabVoidVolume = {
    min: { x: 104, y: 4, z: -8 },
    max: { x: 124, y: 20, z: 8 },
  };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(overhangDeckVolume, frontBonusZones), true,
    'front overhang deck volume above the cab must remain accepted');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(cabVoidVolume, frontBonusZones), false,
    'front overhang cab void below the deck must remain rejected');
});

test('3B-GEOMETRY-TOLERANCE stats, packed state, and AutoPack final validation share canonical containment', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 100, width: 50, height: 40, shapeMode: 'rect' };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const caseData = {
    id: 'tol-case',
    name: 'Tolerance Case',
    dimensions: { length: 10, width: 10, height: 10 },
    volume: 1000,
    weight: 25,
  };
  const makeInstance = (id, x) => ({
    id,
    caseId: caseData.id,
    hidden: false,
    transform: { position: { x, y: 5, z: 0 } },
  });
  const pack = {
    truck,
    cases: [
      makeInstance('exact-front-boundary', 95),
      makeInstance('within-tolerance-front', 95.04),
      makeInstance('beyond-tolerance-front', 95.06),
    ],
  };
  const stats = PackLibrary.computeStats(pack, [caseData]);

  assert.equal(stats.packedCases, 2,
    'Stats must count exact-boundary and 0.04 inch protrusions as packed, and reject a 0.06 inch protrusion');
  assert.equal(stats.oogWarnings.length, 1,
    'Stats/OOG must flag the case protruding beyond the 0.05 inch containment tolerance');
  assert.equal(stats.oogWarnings[0].instanceId, 'beyond-tolerance-front',
    'OOG warning must identify the beyond-tolerance instance');
  assert.ok(stats.oogWarnings[0].issues.includes('protrudesFront'),
    '0.06 inch front protrusion must be classified as protrudesFront');

  const placementForAabb = aabb => PackLibrary.isAabbContainedInAnyZone(aabb, zones) ? 'packed' : 'staged';
  assert.equal(placementForAabb({
    min: { x: 90, y: 0, z: -5 },
    max: { x: 100.04, y: 10, z: 5 },
  }), 'packed', 'packed/staged classification must allow a 0.04 inch protrusion');
  assert.equal(placementForAabb({
    min: { x: 90, y: 0, z: -5 },
    max: { x: 100.06, y: 10, z: 5 },
  }), 'staged', 'packed/staged classification must stage a 0.06 inch protrusion');

  const autoPackResult = Solver.solveAutoPack({
    truck,
    zones,
    items: [
      { instanceId: 'auto-1', dims: { l: 10, w: 10, h: 10 }, canFlip: true, orientationLock: 'any', stackable: true },
      { instanceId: 'auto-2', dims: { l: 20, w: 10, h: 10 }, canFlip: true, orientationLock: 'any', stackable: true },
    ],
    loadFrontFirst: true,
  });
  assert.equal(autoPackResult.unpacked.length, 0, 'simple AutoPack fixture must fully pack');
  for (const [id, pos] of autoPackResult.placements.entries()) {
    const dims = autoPackResult.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: dims.length, w: dims.width, h: dims.height });
    assert.equal(PackLibrary.isAabbContainedInAnyZone(aabb, zones), true,
      `${id} final AutoPack placement must pass canonical PackLibrary containment`);
  }
});

test('3B-GEOMETRY-TOLERANCE world drag feedback converts AABBs to inches before classification', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const INCH_TO_WORLD = 0.05;
  const truck = { length: 100, width: 50, height: 40, shapeMode: 'rect' };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const toWorld = value => value * INCH_TO_WORLD;
  const toInches = value => value / INCH_TO_WORLD;
  const aabbInchesToWorld = aabb => ({
    min: { x: toWorld(aabb.min.x), y: toWorld(aabb.min.y), z: toWorld(aabb.min.z) },
    max: { x: toWorld(aabb.max.x), y: toWorld(aabb.max.y), z: toWorld(aabb.max.z) },
  });
  const aabbWorldToInches = aabb => ({
    min: { x: toInches(aabb.min.x), y: toInches(aabb.min.y), z: toInches(aabb.min.z) },
    max: { x: toInches(aabb.max.x), y: toInches(aabb.max.y), z: toInches(aabb.max.z) },
  });
  const dragClassification = worldAabb =>
    PackLibrary.isAabbContainedInAnyZone(aabbWorldToInches(worldAabb), zones) ? 'packed' : 'staged';
  const persistedDropClassification = inchAabb =>
    PackLibrary.isAabbContainedInAnyZone(inchAabb, zones) ? 'packed' : 'staged';
  const cases = [
    {
      label: 'exact boundary',
      aabb: { min: { x: 90, y: 0, z: -5 }, max: { x: 100, y: 10, z: 5 } },
      expected: 'packed',
    },
    {
      label: '0.04 inch protrusion',
      aabb: { min: { x: 90, y: 0, z: -5 }, max: { x: 100.04, y: 10, z: 5 } },
      expected: 'packed',
    },
    {
      label: '0.06 inch protrusion',
      aabb: { min: { x: 90, y: 0, z: -5 }, max: { x: 100.06, y: 10, z: 5 } },
      expected: 'staged',
    },
  ];

  for (const c of cases) {
    const worldAabb = aabbInchesToWorld(c.aabb);
    assert.equal(dragClassification(worldAabb), c.expected,
      `drag feedback must classify ${c.label} using the same physical tolerance as persisted state`);
    assert.equal(persistedDropClassification(c.aabb), c.expected,
      `persisted drop state must classify ${c.label} using the canonical helper`);
    assert.equal(dragClassification(worldAabb), persistedDropClassification(c.aabb),
      `drag feedback and persisted drop classification must agree for ${c.label}`);
  }
});

test('G2-SHAPE-CONTRACT solveLegacyAutoPack remains unused by the active AutoPack engine', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  assert.doesNotMatch(engineSrc, /solveLegacyAutoPack/,
    'autopack-engine.js must not import or call solveLegacyAutoPack');
});

test('A1.1B AutoPack engine defaults every truck mode to front-first loading', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  // The single source of truth for load direction is the loadFrontFirst flag.
  // It must be unconditionally true so Standard, Wheel Wells, and Front Overhang
  // all pack front-first.
  assert.match(engineSrc, /const loadFrontFirst = true;/,
    'autopack-engine.js must set loadFrontFirst = true for all truck modes');
  // It must no longer gate the direction on a single mode (the old rear-first
  // default for Standard/Wheel Wells).
  assert.doesNotMatch(engineSrc, /loadFrontFirst\s*=\s*mode\s*===\s*['"]frontBonus['"]/,
    'autopack-engine.js must not restrict front-first loading to frontBonus');
});

// ── G2.2-CAB-OVERHANG ─────────────────────────────────────────────────────────
//
// G2.2 corrects the frontBonus ("Box + Front Overhang") shape: bonusHeight is the
// deck height / cab clearance measured from the main floor, NOT the overhang's
// usable cargo height. The usable overhang zone is x: truck.length..
// truck.length+bonusLength, y: bonusHeight..truck.height, z: -truck.width/2..
// truck.width/2 (flush with the main box ceiling; usable overhang cargo height =
// truck.height - bonusHeight). The space below it, x: truck.length..
// truck.length+bonusLength, y: 0..bonusHeight, is the "cab void" (see
// getFrontBonusBlockedZones) and is never usable.

test('G2.2-CAB-OVERHANG getFrontBonusZone() returns the raised deck starting at y=bonusHeight (deck height / cab clearance)', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const start = appSrc.indexOf('function getFrontBonusZone(truck)');
  const end = appSrc.indexOf('\n      function getFrontBonusBlockedZones', start);
  const block = start >= 0 && end > start ? appSrc.slice(start, end) : '';

  assert.ok(block, 'getFrontBonusZone must be defined in app.js TrailerGeometry');
  assert.match(
    block,
    /zone\(\{ x: L, y: bonusHeight, z: -W \/ 2 \}, \{ x: L \+ bonusLength, y: H, z: W \/ 2 \}\)/,
    'getFrontBonusZone must return a raised deck starting at y=bonusHeight (deck height / cab clearance), flush with the ceiling (max.y=H), spanning the full trailer width (z: -W/2..W/2)'
  );
  assert.doesNotMatch(
    block,
    /y: H - bonusHeight/,
    'getFrontBonusZone must not derive the deck floor as height-bonusHeight (G2.2: bonusHeight IS the deck height, not the usable cargo height)'
  );
  assert.doesNotMatch(
    block,
    /bonusWidth/,
    'getFrontBonusZone must not use bonusWidth - the overhang always spans the full trailer width'
  );
  assert.doesNotMatch(
    block,
    /\{ x: 0, y: 0, z: -W \/ 2 \}/,
    'getFrontBonusZone must not return a zone starting at x=0 (old internal cab-side carve-out)'
  );
});

test('G2.2-CAB-OVERHANG getFrontBonusBlockedZones() returns the cab void below the deck (pack-library.js and app.js)', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const appSrc = await fs.readFile(appPath, 'utf8');

  const truck = {
    length: 200,
    width: 90,
    height: 80,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 40, bonusWidth: 60, bonusHeight: 30 },
  };

  assert.equal(typeof PackLibrary.getFrontBonusBlockedZones, 'function',
    'pack-library.js must export getFrontBonusBlockedZones');

  const blocked = PackLibrary.getFrontBonusBlockedZones(truck);
  assert.equal(blocked.length, 1, 'frontBonus with bonusLength>0 must produce exactly one cab-void zone');
  assert.deepEqual(blocked[0], {
    min: { x: truck.length, y: 0, z: -truck.width / 2 },
    max: { x: truck.length + truck.shapeConfig.bonusLength, y: truck.shapeConfig.bonusHeight, z: truck.width / 2 },
  }, 'cab void must span x:truck.length..truck.length+bonusLength, y:0..bonusHeight, full trailer width');

  assert.deepEqual(PackLibrary.getFrontBonusBlockedZones({ ...truck, shapeMode: 'rect' }), [],
    'non-frontBonus shapes must not have a cab void');
  assert.deepEqual(
    PackLibrary.getFrontBonusBlockedZones({ ...truck, shapeConfig: { ...truck.shapeConfig, bonusLength: 0 } }),
    [],
    'frontBonus with bonusLength=0 must not have a cab void'
  );

  assert.match(appSrc, /function getFrontBonusBlockedZones\(truck\)/,
    'app.js TrailerGeometry must define getFrontBonusBlockedZones for visual/settle use');
  assert.match(appSrc, /getFrontBonusBlockedZones,\n\s*\};/,
    'app.js TrailerGeometry must export getFrontBonusBlockedZones from its returned object');
});

test('G2.2-CAB-OVERHANG scene-runtime accounts for total visual length including the front overhang', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /function getTotalTruckLengthInches\(truckInches\)/,
    'scene-runtime must define getTotalTruckLengthInches');
  assert.match(src, /TrailerGeometry\.getFrontBonusZone\(truckInches\)/,
    'getTotalTruckLengthInches must derive the overhang extent from TrailerGeometry.getFrontBonusZone');
  assert.match(src, /baseLength \+ \(bonus\.max\.x - bonus\.min\.x\)/,
    'total visual length must be truck.length + bonusLength when an overhang zone is present');
  assert.match(src, /const totalLengthW = toWorld\(getTotalTruckLengthInches\(truckInches\)\)/,
    'setTruck must size truckBoundsWorld/camera/shadow/grid bounds from the total visual length');
});

test('G2.2-CAB-OVERHANG front overhang renders as a raised platform flush with the main box ceiling, open toward it', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /const bonus = mode === 'frontBonus' \? TrailerGeometry\.getFrontBonusZone\(truckInches\) : null;/,
    'setTruck must derive the overhang volume from getFrontBonusZone');
  assert.match(src, /const bonusCenterX = toWorld\(bonus\.min\.x\) \+ bonusLengthW \/ 2;/,
    'overhang volume must be positioned starting at x=truck.length (bonus.min.x)');
  assert.match(src, /const bonusBaseY = toWorld\(bonus\.min\.y\);/,
    'overhang volume must derive its raised floor/deck height from bonus.min.y (bonusHeight, the deck height / cab clearance)');
  assert.match(
    src,
    /addTrailerVolume\(truck, bonusLengthW, bonusHeightW, bonusWidthW, bonusCenterX, mat, lineMat, floorMat, \{[\s\S]{0,120}openMinX: true,[\s\S]{0,120}baseY: bonusBaseY,/,
    'overhang volume must be rendered as a real attached mesh sized by the bonus zone, raised to baseY, open toward the main box'
  );
  assert.match(
    src,
    /addTrailerVolume\(truck, lengthW, heightW, widthW, lengthW \/ 2, mat, lineMat, floorMat, \{[\s\S]{0,120}openMaxX: Boolean\(bonus\),/,
    'main cargo box must remain x=0..truck.length, floor at y=0, and open toward the overhang when present'
  );

  // addTrailerVolume itself must support a baseY offset for raised volumes.
  assert.match(src, /function addTrailerVolume\(group, lengthW, heightW, widthW, centerX, mat, lineMat, floorMat, opts = \{\}\)/,
    'addTrailerVolume must accept an opts object');
  assert.match(src, /const baseY = Number\.isFinite\(opts\.baseY\) \? opts\.baseY : 0;/,
    'addTrailerVolume must support opts.baseY to raise a volume off the floor');
});

test('G2.2-CAB-OVERHANG scene-runtime renders the cab void below the deck as a blocked/no-load guide volume', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  const start = src.indexOf('function updateTrailerShapeGuides(truckInches)');
  const end = src.indexOf('\n    function addTrailerVolume', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block, 'updateTrailerShapeGuides must be defined in scene-runtime.js');
  assert.match(block, /mode === 'frontBonus'/,
    'updateTrailerShapeGuides must branch on the frontBonus shape mode to render the cab void');
  assert.match(block, /TrailerGeometry\.getFrontBonusBlockedZones\(truckInches\)/,
    'updateTrailerShapeGuides must render the frontBonus cab void using getFrontBonusBlockedZones');
  assert.match(block, /addGuideBox\(group, z, \{ fillColor: 0xff3b30/,
    'the cab void must be rendered with the same blocked/no-load guide-box style used for wheel wells');
});

test('G2.2-CAB-OVERHANG rear/loading-door and front/cab-side end caps get distinct direction-cue wireframe colors (no sprites)', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /const doorLineMat = new THREE\.LineBasicMaterial\(/,
    'setTruck must define a distinct line material for the rear/loading-door end cap');
  assert.match(src, /const cabLineMat = new THREE\.LineBasicMaterial\(/,
    'setTruck must define a distinct line material for the front/cab-side end cap');

  const cuesStart = src.indexOf('const doorLineMat = new THREE.LineBasicMaterial(');
  const cuesEnd = src.indexOf('maxXLineMat: cabLineMat', cuesStart);
  const cuesBlock = cuesStart >= 0 && cuesEnd > cuesStart ? src.slice(cuesStart, cuesEnd) : '';
  assert.ok(cuesBlock, 'direction-cue setup block must be present in setTruck');
  assert.doesNotMatch(cuesBlock, /THREE\.Sprite/,
    'direction cues must not use THREE.Sprite (avoids the shared-geometry singleton dispose risk)');
  assert.match(src, /minXLineMat: doorLineMat/,
    'main cargo box rear end cap (x=0) must use the door/rear line material');
  assert.match(src, /maxXLineMat: cabLineMat/,
    'the front-most end cap (main box when no overhang, or the overhang) must use the cab/front line material');
});

test('G2.2-CAB-OVERHANG rendered overhang volume bounds match the usable-zone overhang used for collision', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  const truck = {
    length: 200,
    width: 90,
    height: 80,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 40, bonusWidth: 60, bonusHeight: 30 },
  };

  const zones = PackLibrary.getTrailerUsableZones(truck);
  const overhangZone = zones.find(z => z.min.x >= truck.length);
  assert.ok(overhangZone, 'getTrailerUsableZones must produce an overhang zone for collision/containment');

  // Mirrors getFrontBonusZone()'s formula (app.js TrailerGeometry) for the same truck/config.
  // bonusHeight is the deck height / cab clearance, so the deck (and the rendered
  // overhang volume) starts at y=bonusHeight, not y=height-bonusHeight.
  const { length: L, width: W, height: H } = truck;
  const cfg = truck.shapeConfig;
  const bonusLength = Math.max(0, cfg.bonusLength);
  const bonusHeight = Math.min(Math.max(cfg.bonusHeight, 0), H);
  const expectedRenderZone = {
    min: { x: L, y: bonusHeight, z: -W / 2 },
    max: { x: L + bonusLength, y: H, z: W / 2 },
  };

  assert.deepEqual(overhangZone, expectedRenderZone,
    'the visual overhang volume (getFrontBonusZone) and the collision overhang zone (getTrailerUsableZones) must describe the same x/y/z bounds');
});

test('G2.2-CAB-OVERHANG Inspector labels the height control "Deck Height" (not ambiguous "Overhang height") and has no Width input', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf("if (currentMode === 'frontBonus') {");
  const end = src.indexOf("if (currentMode === 'wheelWells') {", start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block, 'Front Overhang config card block must be present in editor-screen.js');

  // Req #14: the height field must be labeled "Deck Height", not the ambiguous
  // "Overhang height" (which could mean usable cargo height or deck height).
  assert.match(block, /Deck Height \(\$\{lengthUnit\}\)/,
    'Front Overhang card must label the deck-height field "Deck Height (<unit>)"');
  assert.doesNotMatch(block, /Overhang [Hh]eight \(\$\{lengthUnit\}\)/,
    'Front Overhang card must not label the height field "Overhang height"');
  assert.match(block, /Usable overhang height: \$\{Utils\.inchesToUnit\(usableOverhangHeight, lengthUnit\)\.toFixed\(1\)\} \$\{lengthUnit\}/,
    'Front Overhang card should display the computed usable overhang height');
  assert.match(block, /\(trailer height [−-] deck height\)/,
    'Front Overhang card should explain how usable overhang height relates to deck height');

  // Req #13: Front Overhang Width input is absent; bonusWidth is normalized to truck.width.
  assert.doesNotMatch(block, /Width \(\$\{lengthUnit\}\)/,
    'Front Overhang card must not render a Width input field');
  assert.doesNotMatch(block, /\bfBW\b/,
    'Front Overhang card must not reference a width field control');
  assert.match(block, /bonusWidth: tW/,
    'Front Overhang save/reset must silently normalize bonusWidth to the trailer width for backward compatibility');
});

test('G2.2-CAB-OVERHANG a case in the cab void is not packed; a case on the deck within bounds is packed', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 200,
    width: 90,
    height: 80,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 40, bonusWidth: 60, bonusHeight: 30 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const blockedZones = PackLibrary.getFrontBonusBlockedZones(truck);
  // Usable overhang zone: x:200..240, y:30..80, z:-45..45.
  // Cab void: x:200..240, y:0..30, z:-45..45.

  // Req #5: a case entirely in the cab void (below the deck) must not be packed.
  const inCabVoid = { min: { x: 210, y: 5, z: -10 }, max: { x: 230, y: 25, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(inCabVoid, zones), false,
    'a case in the cab void below the deck must not be contained in any usable zone');
  assert.equal(PackLibrary.isAabbContainedInAnyZone(inCabVoid, blockedZones), true,
    'sanity check: the case sits inside the cab-void blocked zone');

  // Req #6: a case resting on the deck and fitting under the roof must be packed.
  const onDeck = { min: { x: 210, y: 30, z: -10 }, max: { x: 230, y: 70, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(onDeck, zones), true,
    'a case resting on the raised deck and fitting under the roof must be contained in a usable zone');

  // Req #7: a case above the overhang ceiling must not be packed.
  const aboveCeiling = { min: { x: 210, y: 30, z: -10 }, max: { x: 230, y: 85, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(aboveCeiling, zones), false,
    'a case extending above the overhang ceiling (truck.height) must not be contained in any usable zone');

  // Req #8: a case past the overhang's front end must not be packed.
  const pastFrontEnd = { min: { x: 230, y: 30, z: -10 }, max: { x: 250, y: 70, z: 10 } };
  assert.equal(PackLibrary.isAabbContainedInAnyZone(pastFrontEnd, zones), false,
    'a case extending past truck.length+bonusLength must not be contained in any usable zone');
});

test('G2.2-CAB-OVERHANG computeSettleY supports a floorY offset for settling onto the raised overhang deck', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };

  // Req #9: with no supporters, an item over the overhang deck settles at
  // floorY + halfY (the deck surface), not y=halfY (the main floor).
  const onDeck = EditorScreen.computeSettleY(half, 0, 0, [], 0.5, 30);
  assert.equal(onDeck, 42, 'an item with floorY=30 (deck height) must settle at floorY + halfY = 42, not the main floor');

  // Req #10: main-floor items (floorY=0, the default) still settle to y=halfY.
  const onFloor = EditorScreen.computeSettleY(half, 0, 0, [], 0.5);
  assert.equal(onFloor, 12, 'an item with the default floorY=0 must still settle to the main floor (halfY)');

  // A supporter above the deck still wins over the deck floor.
  const supporter = { min: { x: -24, y: 30, z: -24 }, max: { x: 24, y: 54, z: 24 } };
  const onSupporter = EditorScreen.computeSettleY(half, 0, 0, [supporter], 0.5, 30);
  assert.equal(onSupporter, 66, 'a supporter above the deck must still win over the deck floor (supporter.max.y + halfY)');

  // The result must never settle below floorY + halfY even with below-deck supporters
  // (the cab void must never act as a floor).
  const belowDeck = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 10, z: 24 } };
  const stillOnDeck = EditorScreen.computeSettleY(half, 0, 0, [belowDeck], 0.5, 30);
  assert.equal(stillOnDeck, 42, 'a supporter entirely below the deck must not pull the result below floorY + halfY');
});

test('G2.2-CAB-OVERHANG editor-screen settleY derives the overhang deck floor from getFrontBonusZone and never settles into the cab void', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.match(src, /function getFrontOverhangDeckFloorYWorld\(cx, cz, halfX, halfZ\)/,
    'editor-screen must define a helper to resolve the overhang deck floor in world units, taking the full X/Z footprint');
  assert.match(src, /TrailerGeometry\.getFrontBonusZone\(truck\)/,
    'getFrontOverhangDeckFloorYWorld must derive the deck zone from TrailerGeometry.getFrontBonusZone');
  assert.match(src, /return zoneWorld\.min\.y/,
    'getFrontOverhangDeckFloorYWorld must return the deck zone min.y (the deck surface, never the cab void below it)');

  const settleStart = src.indexOf('function settleY(instanceId)');
  const settleEnd = src.indexOf('\n    function getSnapWallCandidatesWorld', settleStart);
  const settleBlock = settleStart >= 0 && settleEnd > settleStart ? src.slice(settleStart, settleEnd) : '';
  assert.ok(settleBlock, 'settleY must be defined in editor-screen.js');
  assert.match(settleBlock, /const deckFloorY = getFrontOverhangDeckFloorYWorld\(group\.position\.x, group\.position\.z, halfWorld\.x, halfWorld\.z\);/,
    'settleY must compute the overhang deck floor from the case current X\\/Z position and full footprint');
  assert.match(settleBlock, /deckFloorY !== null \? deckFloorY : 0/,
    'settleY must pass the deck floor (or 0 for the main floor) as computeSettleY floorY argument');
});

test('G2.2-CAB-OVERHANG AutoPack uses the raised overhang deck only when an item fits above the deck and below the roof, and never the cab void', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const { solveAutoPack, isAabbContainedInAnyZone } = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);

  // Main floor footprint (24x18) exactly matches the truck's main-zone footprint, and the
  // overhang footprint (24x18) exactly matches the overhang zone's footprint, so each zone
  // holds exactly one footprint "column". bonusHeight=20 makes the deck height (20) and the
  // usable overhang cargo height (72-20=52) clearly distinct from each other.
  const truck = {
    length: 24,
    width: 18,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 24, bonusWidth: 48, bonusHeight: 20 },
  };
  const zones = PackLibrary.getTrailerUsableZones(truck);
  const blockedZones = PackLibrary.getFrontBonusBlockedZones(truck);
  const overhangZone = zones.find(z => z.min.x >= truck.length);
  const EPS = 0.06;

  const items = [
    { instanceId: 'short-1', dims: { l: 24, w: 18, h: 16 }, canFlip: true, orientationLock: 'any', stackable: true, maxStackCount: 2 },
    { instanceId: 'short-2', dims: { l: 24, w: 18, h: 16 }, canFlip: true, orientationLock: 'any', stackable: true, maxStackCount: 2 },
    { instanceId: 'tall-1', dims: { l: 24, w: 18, h: 60 }, canFlip: false, orientationLock: 'upright', stackable: true, maxStackCount: 1 },
  ];

  const result = solveAutoPack({
    truck: { length: truck.length, width: truck.width, height: truck.height },
    zones,
    loadFrontFirst: true,
    items,
  });

  assert.equal(result.unpacked.length, 0, 'all items must be packed across the main zone and the raised overhang deck');

  const placedAabbs = [];
  for (const [id, pos] of result.placements.entries()) {
    const od = result.orientedDims.get(id);
    const half = { x: od.length / 2, y: od.height / 2, z: od.width / 2 };
    const aabb = {
      min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
      max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
    };
    assert.ok(isAabbContainedInAnyZone(aabb, zones),
      `${id} must be fully contained within a usable zone (main or overhang deck)`);
    placedAabbs.push({ id, aabb });
  }

  // Req #11: AutoPack must never place an item inside the cab void.
  for (const p of placedAabbs) {
    assert.equal(isAabbContainedInAnyZone(p.aabb, blockedZones), false,
      `${p.id} must not be placed inside the cab void below the overhang deck`);
  }

  // Req #12: the short items (h=16) fit above the deck and below the roof (16 <= 72-20),
  // so AutoPack must be able to use the overhang deck for them.
  const inOverhang = placedAabbs.filter(p => p.aabb.min.x >= overhangZone.min.x - EPS);
  assert.ok(inOverhang.length > 0, 'AutoPack must be able to place items on the raised overhang deck');
  for (const p of inOverhang) {
    assert.ok(p.aabb.min.y >= overhangZone.min.y - EPS,
      `${p.id} placed on the overhang must rest at/above the deck (zone.min.y = bonusHeight), not in the cab void`);
    assert.ok(p.aabb.max.y <= overhangZone.max.y + EPS,
      `${p.id} placed on the overhang must not extend above the ceiling`);
  }

  // Req #12 (continued): the tall item (h=60) does not fit above the deck and below the
  // roof (60 > 72-20=52), so it must be placed in the main zone, not the overhang deck.
  const tall = placedAabbs.find(p => p.id === 'tall-1');
  assert.ok(tall.aabb.min.x < overhangZone.min.x - EPS,
    'an item taller than the usable overhang height (height - bonusHeight) must not be placed on the overhang deck');

  function overlaps(a, b) {
    const OEPS = 0.05;
    return a.min.x < b.max.x - OEPS && a.max.x > b.min.x + OEPS &&
      a.min.y < b.max.y - OEPS && a.max.y > b.min.y + OEPS &&
      a.min.z < b.max.z - OEPS && a.max.z > b.min.z + OEPS;
  }
  for (let i = 0; i < placedAabbs.length; i++) {
    for (let j = i + 1; j < placedAabbs.length; j++) {
      assert.equal(overlaps(placedAabbs[i].aabb, placedAabbs[j].aabb), false,
        `${placedAabbs[i].id} and ${placedAabbs[j].id} must not overlap`);
    }
  }
});

// ── End G2.2-CAB-OVERHANG ──────────────────────────────────────────────────────

// ── G2.2-CLEANUP ──────────────────────────────────────────────────────────────
//
// Small pre-commit cleanup pass on top of G2.2: (1) computeShapeAwareOOGWarnings'
// front-boundary diagnostics use the shape-aware max usable X (truck.length for
// rect/wheelWells, truck.length+bonusLength for frontBonus) instead of raw
// truck.length, so a case past truck.length but still within the cab-over
// overhang extent is not incorrectly flagged protrudesFront; and (2)
// getFrontOverhangDeckFloorYWorld checks the full X/Z footprint against the
// overhang deck zone (not just the low-X edge) before settling an item onto the
// raised deck.

test('G2.2-CLEANUP frontBonus item past raw truck.length but within the overhang extent does not get protrudesFront', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusHeight: 36 },
  };
  // Overhang zone: x:240..300, y:36..72, z:-48..48. Cab void: x:240..300, y:0..36, z:-48..48.
  const caseData = {
    id: 'cab-void-straddle',
    name: 'Cab Void Straddle',
    dimensions: { length: 40, width: 20, height: 50 },
    volume: 40 * 20 * 50,
    weight: 10,
  };
  const pack = {
    truck,
    cases: [{
      id: 'inst-straddle',
      caseId: caseData.id,
      hidden: false,
      // x:250..290 (past truck.length=240, within the overhang extent 240..300),
      // y:0..50 (straddles the cab void 0..36 and the deck zone 36..72).
      transform: { position: { x: 270, y: 25, z: 0 } },
    }],
  };

  const warnings = PackLibrary.computeStats(pack, [caseData]).oogWarnings;
  assert.equal(warnings.length, 1, 'a case straddling the cab void must still be flagged as outside a usable zone');
  assert.ok(!warnings[0].issues.includes('protrudesFront'),
    'a case past raw truck.length but within truck.length+bonusLength must not be flagged protrudesFront');
  assert.deepEqual(warnings[0].issues, ['outsideUsableZone'],
    'a case straddling the cab void is outside usable zones for height reasons, not because it protrudes past the front');
});

test('G2.2-CLEANUP frontBonus item past truck.length+bonusLength receives protrudesFront', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusHeight: 36 },
  };
  const caseData = {
    id: 'past-overhang-front',
    name: 'Past Overhang Front',
    dimensions: { length: 40, width: 20, height: 36 },
    volume: 40 * 20 * 36,
    weight: 10,
  };
  const pack = {
    truck,
    cases: [{
      id: 'inst-past-front',
      caseId: caseData.id,
      hidden: false,
      // x:290..330 (max.x=330 > truck.length+bonusLength=300), y:36..72 (on the deck), z:0.
      transform: { position: { x: 310, y: 54, z: 0 } },
    }],
  };

  const warnings = PackLibrary.computeStats(pack, [caseData]).oogWarnings;
  assert.equal(warnings.length, 1, 'a case extending past truck.length+bonusLength must be flagged');
  assert.ok(warnings[0].issues.includes('protrudesFront'),
    'a case extending past truck.length+bonusLength (the true usable front boundary) must be flagged protrudesFront');
});

test('G2.2-CLEANUP rect and wheelWells front-protrusion warnings remain based on raw truck.length', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const caseData = {
    id: 'past-rect-front',
    name: 'Past Rect Front',
    dimensions: { length: 40, width: 20, height: 20 },
    volume: 40 * 20 * 20,
    weight: 10,
  };

  const rectTruck = { length: 100, width: 50, height: 50, shapeMode: 'rect', shapeConfig: {} };
  const rectPack = {
    truck: rectTruck,
    cases: [{
      id: 'inst-rect-front',
      caseId: caseData.id,
      hidden: false,
      // x:90..130, max.x=130 > truck.length=100.
      transform: { position: { x: 110, y: 10, z: 0 } },
    }],
  };
  const rectWarnings = PackLibrary.computeStats(rectPack, [caseData]).oogWarnings;
  assert.equal(rectWarnings.length, 1, 'a rect case extending past truck.length must be flagged');
  assert.ok(rectWarnings[0].issues.includes('protrudesFront'),
    'rect protrudesFront must still trigger at raw truck.length (maxUsableX === truck.length for rect)');

  const wheelTruck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
  };
  const wheelPack = {
    truck: wheelTruck,
    cases: [{
      id: 'inst-wheel-front',
      caseId: caseData.id,
      hidden: false,
      // x:90..130, max.x=130 > truck.length=100.
      transform: { position: { x: 110, y: 10, z: 0 } },
    }],
  };
  const wheelWarnings = PackLibrary.computeStats(wheelPack, [caseData]).oogWarnings;
  assert.equal(wheelWarnings.length, 1, 'a wheelWells case extending past truck.length must be flagged');
  assert.ok(wheelWarnings[0].issues.includes('protrudesFront'),
    'wheelWells protrudesFront must still trigger at raw truck.length (maxUsableX === truck.length for wheelWells)');
});

test('G2.2-CLEANUP getFrontOverhangDeckFloorYWorld checks the full X/Z footprint against the overhang deck zone', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const start = src.indexOf('function getFrontOverhangDeckFloorYWorld(cx, cz, halfX, halfZ)');
  const end = src.indexOf('\n    /** Settle a case down via gravity', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  assert.ok(block, 'getFrontOverhangDeckFloorYWorld must be defined with a (cx, cz, halfX, halfZ) signature');

  // Req #4/#5: the X footprint must be fully inside the deck zone on both edges,
  // not just the low-X edge.
  assert.match(block, /cx - halfX >= zoneWorld\.min\.x - EPS/,
    'the deck-settle guard must check the footprint low-X edge against the overhang zone min.x');
  assert.match(block, /cx \+ halfX <= zoneWorld\.max\.x \+ EPS/,
    'the deck-settle guard must check the footprint high-X edge against the overhang zone max.x (Fix 2 - previously unchecked)');

  // Req #6: the Z footprint must be fully inside the deck zone on both edges (overhang width).
  assert.match(block, /cz - halfZ >= zoneWorld\.min\.z - EPS/,
    'the deck-settle guard must check the footprint low-Z edge against the overhang zone min.z (Fix 2 - previously unchecked)');
  assert.match(block, /cz \+ halfZ <= zoneWorld\.max\.z \+ EPS/,
    'the deck-settle guard must check the footprint high-Z edge against the overhang zone max.z (Fix 2 - previously unchecked)');

  // The deck floor is only returned when the whole footprint is inside; otherwise fall back
  // to null (main floor / existing support logic in settleY).
  assert.match(block, /if \(fitsX && fitsZ\) return zoneWorld\.min\.y;\n\s+return null;/,
    'a footprint that is not fully inside the overhang deck zone must fall back to null, not settle on the deck');
});

test('G2.2-CLEANUP new/edit pack flows initialize positive frontBonus defaults and normalize missing shapeConfig', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.match(src, /function normalizeFrontBonusShapeConfig\(shapeConfig, truck\)/,
    'packs-screen.js must define a helper to normalize frontBonus shapeConfig defaults');
  assert.match(src, /if \(!Number\.isFinite\(cfg\.bonusLength\)\) cfg\.bonusLength = 0\.12 \* length;/,
    'missing bonusLength must default to a positive value (12% of truck length)');
  assert.match(src, /if \(!Number\.isFinite\(cfg\.bonusHeight\)\) cfg\.bonusHeight = 0\.45 \* height;/,
    'missing bonusHeight must default to a positive value (45% of truck height)');

  const newPackStart = src.indexOf('function openNewPackModal()');
  const newPackEnd = src.indexOf('\n    function openEditPackModal', newPackStart);
  const newPackBlock = newPackStart >= 0 && newPackEnd > newPackStart ? src.slice(newPackStart, newPackEnd) : '';
  assert.ok(newPackBlock, 'openNewPackModal must be defined in packs-screen.js');
  assert.match(newPackBlock, /if \(newTruck\.shapeMode === 'frontBonus'\) \{\s*\n\s*newTruck\.shapeConfig = normalizeFrontBonusShapeConfig\(newTruck\.shapeConfig, newTruck\);/,
    'creating a new pack with the frontBonus shape mode must initialize valid positive bonusLength/bonusHeight defaults');

  const editPackStart = src.indexOf('function openEditPackModal(packId)');
  const editPackEnd = src.indexOf('\n    function openRename', editPackStart);
  const editPackBlock = editPackStart >= 0 && editPackEnd > editPackStart ? src.slice(editPackStart, editPackEnd) : '';
  assert.ok(editPackBlock, 'openEditPackModal must be defined in packs-screen.js');
  assert.match(editPackBlock, /if \(nextTruck\.shapeMode === 'frontBonus'\) \{\s*\n\s*nextTruck\.shapeConfig = normalizeFrontBonusShapeConfig\(nextTruck\.shapeConfig, nextTruck\);/,
    'switching a pack to the frontBonus shape mode in Edit Pack must normalize missing shapeConfig with valid positive defaults');
});

// ── End G2.2-CLEANUP ──────────────────────────────────────────────────────────

// ── End G2-SHAPE-CONTRACT ────────────────────────────────────────────────────

// ============================================================================
// AUTO-PACK-A0 — Manual Orientation Lock + Geometry Constraint Safety
// ============================================================================

test('AUTO-PACK-A1-2 AutoPack runs a floor pass before allowing stack placements', async () => {
  const src = await fs.readFile(autoPackLegacySolverPath, 'utf8');
  const passStart = src.indexOf('const FLOOR_REST_EPS = 0.05;');
  const passEnd = src.indexOf('\n  const finalValidation = validatePackedPlacements', passStart);
  const block = passStart >= 0 && passEnd > passStart ? src.slice(passStart, passEnd) : '';

  assert.match(block, /const placementPasses = \[[\s\S]*name: 'floor', allowStacking: false[\s\S]*name: 'stack', allowStacking: true[\s\S]*\];/,
    'AutoPack must run floor placement before the stack-allowed pass');
  assert.match(block, /for \(const placementPass of placementPasses\)/,
    'the main placement sweep must be wrapped by the placement pass sequence');
  assert.match(block, /if \(!placementPass\.allowStacking && result\.restY > FLOOR_REST_EPS\)[\s\S]*continue;/,
    'floor pass must reject stacked candidates using restY tolerance, not packed count');
  assert.match(block, /skippedStackInFloorPass/,
    'diagnostics should expose when the floor pass skips stacked candidates');
  assert.match(block, /placementPass\.allowStacking/,
    'the stack pass must still exist so stacking is not disabled');
  assert.match(block, /tryPlace\(cx, cz, ori, truckH, zones, packed, geometry\)/,
    'floor and stack passes must still use the existing containment, ceiling, and collision path');
});

test('AUTO-PACK-A1-3 AutoPack validates support, containment, and staging separation', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const src = await fs.readFile(autoPackLegacySolverPath, 'utf8');
  const supportStart = src.indexOf('const MIN_STACK_SUPPORT_RATIO = 0.5;');
  const supportEnd = src.indexOf('\nexport function buildLegacyAutoPackItems', supportStart);
  const supportBlock = supportStart >= 0 && supportEnd > supportStart ? src.slice(supportStart, supportEnd) : '';
  const stagingStart = engineSrc.indexOf('function buildStagingMap(packItems, truck)');
  const stagingEnd = engineSrc.indexOf('\n  async function animatePlacements', stagingStart);
  const stagingBlock = stagingStart >= 0 && stagingEnd > stagingStart ? engineSrc.slice(stagingStart, stagingEnd) : '';

  assert.match(supportBlock, /const MIN_STACK_SUPPORT_RATIO = 0\.5;/,
    'stacked AutoPack placements must require meaningful footprint support');
  assert.match(supportBlock, /function validatePackedPlacements\(packedList, zones, geometry\)/,
    'AutoPack must run a final safety validation before persisting placements');
  assert.match(supportBlock, /geometry\.isAabbContainedInAnyZone\(aabb, zones\)/,
    'final validation must preserve shape-aware usable-zone containment');
  assert.match(supportBlock, /collides\(p\.pos, p\.dims, accepted\)/,
    'final validation must reject packed-item collisions');
  assert.match(supportBlock, /hasPlacementSupport\(p, accepted, zones\)/,
    'final validation must reject unsupported/floating placements');
  assert.match(src, /const finalValidation = validatePackedPlacements\(packed, zones, geometry\);[\s\S]*placements\.delete\(id\);[\s\S]*rotations\.delete\(id\);/,
    'placements rejected by final validation must be staged instead of persisted as packed');
  assert.match(stagingBlock, /PackLibrary\.findSafeStagingPosition\(\{ truck \}, dims, acceptedAabbs\)/,
    'staged/unpacked items must use the canonical staging helper, clearly separated from the trailer side');
});

// ── S1: Canonical Staging Zone ────────────────────────────────────────────

test('STAGING-S1 pack-library exposes one canonical staging layout helper', async () => {
  const src = await fs.readFile(packLibraryPath, 'utf8');

  assert.match(src, /export function getStagingLayout\(truck, options = \{\}\)/,
    'pack-library must export a single canonical getStagingLayout(truck, options) helper');
  assert.match(src, /export function findSafeStagingPosition\(pack, dims, acceptedAabbs\)/,
    'findSafeStagingPosition must be exported for reuse by AutoPack and the editor');

  const findStart = src.indexOf('export function findSafeStagingPosition(pack, dims, acceptedAabbs)');
  const findEnd = src.indexOf('\nfunction buildAcceptedAabbs', findStart);
  const findBlock = findStart >= 0 && findEnd > findStart ? src.slice(findStart, findEnd) : '';
  assert.match(findBlock, /const layout = getStagingLayout\(truck\);/,
    'findSafeStagingPosition must derive its geometry from the canonical getStagingLayout helper');
});

test('STAGING-S1 unpackAll uses the canonical staging helper instead of a hardcoded offset', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function unpackAll()');
  const end = src.indexOf('\n    function renderInspectorNoPack', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define unpackAll()');
  assert.match(block, /PackLibrary\.findSafeStagingPosition\(pack, dims, acceptedAabbs\)/,
    'unpackAll must place staged cases through the canonical staging helper');
  assert.doesNotMatch(block, /stageZStart|truckW|truckL/,
    'unpackAll must not keep its own hardcoded staging offset');
});

test('STAGING-S1 duplicate staging fallback uses the canonical staging helper instead of a hardcoded grid', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const start = src.indexOf('function findDuplicateOffset(pack, payload, existingAabbs)');
  const end = src.indexOf('\n    function duplicateSelection(pack, selectedIds)', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0, 'editor-screen must define findDuplicateOffset(pack, payload, existingAabbs)');
  assert.match(block, /PackLibrary\.findSafeStagingPosition\(pack, groupDims, existingAabbs\)/,
    'duplicate staging fallback must reuse the canonical staging helper for the group bounding box');
  assert.doesNotMatch(block, /stagingGap|stageStartZ|stageStartX/,
    'duplicate staging fallback must not keep its own hardcoded staging grid constants');
});

test('STAGING-S1 canonical staging position grounds items and stays outside the trailer width', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const dims = { length: 30, width: 20, height: 40 };
  const staged = PackLibrary.findSafeStagingPosition({ truck }, dims, []);

  assert.equal(staged.position.y, dims.height / 2,
    'staged item center Y must equal half its height (grounded on the floor)');
  assert.ok(staged.position.z > truck.width / 2,
    'staged item must sit outside the trailer width');
});

test('STAGING-S1 staging rows wrap instead of drifting indefinitely in X', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 100, width: 96, height: 96 };
  const dims = { length: 30, width: 20, height: 24 };
  const acceptedAabbs = [];
  const positions = [];
  for (let i = 0; i < 10; i++) {
    const staged = PackLibrary.findSafeStagingPosition({ truck }, dims, acceptedAabbs);
    positions.push(staged.position);
    acceptedAabbs.push(staged.aabb);
  }

  const maxX = Math.max(...positions.map(p => p.x));
  assert.ok(maxX <= truck.length + 0.001,
    'staging columns must stay within the trailer length instead of drifting endlessly in X');

  const rows = new Set(positions.map(p => Math.round(p.z * 1000)));
  assert.ok(rows.size > 1,
    'staging must wrap into additional rows once a row fills up');
});

// ── End S1: Canonical Staging Zone ────────────────────────────────────────

test('AUTO-PACK-A1-3 X anchor cap keeps front and middle anchors available', async () => {
  const src = await fs.readFile(autoPackLegacySolverPath, 'utf8');
  const capStart = src.indexOf('function capXAnchorsSorted(arr, maxCount)');
  const capEnd = src.indexOf('\n  function capZAnchorsSorted', capStart);
  const capBlock = capStart >= 0 && capEnd > capStart ? src.slice(capStart, capEnd) : '';

  assert.doesNotMatch(capBlock, /return arr\.slice\(0, maxCount\);/,
    'X anchor capping must not silently drop all far-end floor anchors');
  assert.match(capBlock, /headCount[\s\S]*midCount[\s\S]*tailCount/,
    'X anchor capping must retain loading-end, middle, and far-end anchors');
  assert.match(src, /return capXAnchorsSorted\(arr, 240\);/,
    'AutoPack should keep enough X anchors for larger floor layouts');
});

const HANDLING_FIELDS = ['canFlip', 'orientationLock', 'noStackOnTop', 'maxStackCount', 'isPallet', 'maxPalletWeight', 'laneItem', 'loadPriority'];
const RULED_CASE = {
  id: 'rt-case', name: 'Ruled Case', category: 'default',
  dimensions: { length: 36, width: 24, height: 18 }, weight: 120,
  canFlip: false, orientationLock: 'onSide', noStackOnTop: true, stackable: false,
  maxStackCount: 3, isPallet: true, maxPalletWeight: 1800, laneItem: false, loadPriority: 1,
};

test('CARGO-RULE-V1 pack JSON export -> import round-trips all handling rules', async () => {
  const StateStore = await import(stateStorePath.href);
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  StateStore.init({
    caseLibrary: [{ ...RULED_CASE }],
    packLibrary: [{ id: 'rt-pack', title: 'RT', truck: { length: 240, width: 96, height: 96 }, cases: [{ id: 'i1', caseId: 'rt-case', transform: { position: { x: 20, y: 9, z: 0 } } }] }],
    folderLibrary: [], preferences: {},
  });
  const pack = (StateStore.get('packLibrary') || [])[0];
  const json = IE.buildPackExportJSON(pack);

  // Wipe local data, then import the exported pack into an empty workspace.
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  PackLibrary.importPackPayload(IE.parsePackImportJSON(json));

  const lib = StateStore.get('caseLibrary') || [];
  const restored = lib.find(c => c.name === 'Ruled Case');
  assert.ok(restored, 'case restored from pack export');
  for (const f of HANDLING_FIELDS) {
    assert.deepEqual(restored[f], RULED_CASE[f], `pack round-trip preserves ${f}`);
  }
  assert.equal(restored.stackable, false, 'pack round-trip preserves stackable');
});

test('CARGO-RULE-V1 normalizeAppData (reload/import) preserves all handling rules', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const out = Normalizer.normalizeAppData({
    caseLibrary: [{ ...RULED_CASE }],
    packLibrary: [],
    folderLibrary: [],
  });
  const c = (out.caseLibrary || []).find(x => x.id === 'rt-case');
  assert.ok(c, 'case survives normalizeAppData');
  for (const f of HANDLING_FIELDS) {
    assert.deepEqual(c[f], RULED_CASE[f], `normalizeAppData preserves ${f}`);
  }
});

test('CARGO-RULE-V1 export/download action chains reach the right builder and sanitize filenames', async () => {
  const casesSrc = await fs.readFile(casesScreenPath, 'utf8');
  const packsSrc = await fs.readFile(packsScreenPath, 'utf8');
  // Cases template
  assert.match(casesSrc, /ImportExport\.downloadCasesTemplate\(\)/, 'cases template button calls downloadCasesTemplate');
  // Pack export -> builder -> downloadText with sanitized filename
  assert.match(packsSrc, /ImportExport\.buildPackExportJSON\(pack\)/, 'pack export uses buildPackExportJSON');
  assert.match(packsSrc, /Utils\.downloadText\(`\$\{\(pack\.title \|\| 'pack'\)\.replace\(\/\[\^a-z0-9\]\+\/gi, '-'\)\}\.json`/, 'pack export filename is sanitized');
});

test('CARGO-RULE-V1 workspace import is not exposed; pack-batch guard wording is truthful', async () => {
  const ieSrc = await fs.readFile(importExportPath, 'utf8');
  // parseWorkspaceImportJSON exists as groundwork but must have no production caller.
  const callers = [];
  for (const p of ['../../src/app.js', '../../src/ui/overlays/import-pack-dialog.js', '../../src/ui/overlays/import-app-dialog.js', '../../src/ui/overlays/settings-overlay.js']) {
    const s = await fs.readFile(new URL(p, import.meta.url), 'utf8');
    if (/parseWorkspaceImportJSON/.test(s)) callers.push(p);
  }
  assert.equal(callers.length, 0, 'workspace import parser must not be wired to any UI yet');
  assert.ok(!/Use Import Workspace Backup instead/.test(ieSrc), 'must not point users at a missing Import Workspace Backup action');
  assert.match(ieSrc, /Workspace import is not available yet/, 'guard wording must be truthful about missing workspace import');
});

test('CARGO-RULE-V1 spreadsheet handling-cell parsers normalize and warn correctly', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  // Orientation
  assert.deepEqual(IE.parseOrientationLockCell(''), { value: 'any', warning: null });
  assert.deepEqual(IE.parseOrientationLockCell('UPRIGHT'), { value: 'upright', warning: null });
  assert.deepEqual(IE.parseOrientationLockCell('on-side'), { value: 'onSide', warning: null });
  assert.deepEqual(IE.parseOrientationLockCell('on side'), { value: 'onSide', warning: null });
  assert.equal(IE.parseOrientationLockCell('sideways').value, 'any');
  assert.ok(IE.parseOrientationLockCell('sideways').warning, 'invalid orientation warns');
  // Non-neg int (maxStackCount)
  assert.deepEqual(IE.parseNonNegIntCell('', 'max'), { value: 0, warning: null });
  assert.deepEqual(IE.parseNonNegIntCell('3', 'max'), { value: 3, warning: null });
  assert.equal(IE.parseNonNegIntCell('-1', 'max').value, 0);
  assert.ok(IE.parseNonNegIntCell('-1', 'max').warning, 'negative warns');
  assert.ok(IE.parseNonNegIntCell('2.5', 'max').warning, 'non-integer warns');
  assert.ok(IE.parseNonNegIntCell('x', 'max').warning, 'non-numeric warns');
  // Non-neg num (maxPalletWeight)
  assert.deepEqual(IE.parseNonNegNumCell('2000', 'load'), { value: 2000, warning: null });
  assert.ok(IE.parseNonNegNumCell('-5', 'load').warning);
  // Lane tri-state
  assert.equal(IE.parseLaneCell(''), null);
  assert.equal(IE.parseLaneCell('auto'), null);
  assert.equal(IE.parseLaneCell('always'), true);
  assert.equal(IE.parseLaneCell('yes'), true);
  assert.equal(IE.parseLaneCell('never'), false);
  assert.equal(IE.parseLaneCell('0'), false);
  // Priority
  assert.equal(IE.parseLoadPriorityCell('low').value, -1);
  assert.equal(IE.parseLoadPriorityCell('high').value, 1);
  assert.equal(IE.parseLoadPriorityCell('').value, 0);
  assert.equal(IE.parseLoadPriorityCell('5').value, 1);
  assert.ok(IE.parseLoadPriorityCell('bogus').warning);
});

test('CARGO-RULE-V1 CSV template columns all map through the parser (template/parser parity)', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const template = IE.buildCasesTemplateCSV();
  const headerLine = template.split('\n')[0];
  const normalized = headerLine.split(',').map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const idx = IE.indexMap(normalized);
  for (const f of ['name', 'length', 'width', 'height', 'weight', 'canFlip', 'orientationLock', 'noStackOnTop', 'maxStackCount', 'isPallet', 'maxPalletWeight', 'laneItem', 'loadPriority', 'notes']) {
    assert.ok(idx[f] != null, `template column for ${f} must be recognized by the parser`);
  }
});

test('CARGO-RULE-V1 importCaseRows carries handling fields and defaults missing ones', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const baseRow = { name: 'Full Rules', length: 48, width: 24, height: 24, weight: 100 };
  const withRules = IE.importCaseRows([{ ...baseRow, canFlip: false, orientationLock: 'onSide', noStackOnTop: true, maxStackCount: 2, isPallet: true, maxPalletWeight: 1500, laneItem: false, loadPriority: 1 }], []);
  const full = withRules.nextCaseLibrary.find(c => c.name === 'Full Rules');
  assert.equal(full.orientationLock, 'onSide');
  assert.equal(full.noStackOnTop, true);
  assert.equal(full.maxStackCount, 2);
  assert.equal(full.isPallet, true);
  assert.equal(full.maxPalletWeight, 1500);
  assert.equal(full.laneItem, false);
  assert.equal(full.loadPriority, 1);

  const noRules = IE.importCaseRows([{ name: 'Bare', length: 48, width: 24, height: 24, weight: 10 }], []);
  const bare = noRules.nextCaseLibrary.find(c => c.name === 'Bare');
  assert.equal(bare.canFlip, false);
  assert.equal(bare.orientationLock, 'any');
  assert.equal(bare.noStackOnTop, false);
  assert.equal(bare.maxStackCount, 0);
  assert.equal(bare.isPallet, false);
  assert.equal(bare.maxPalletWeight, 0);
  assert.equal(bare.laneItem, null);
  assert.equal(bare.loadPriority, 0);
});

test('CARGO-RULE-V1 cases import preview uses the shared handling summary', async () => {
  const dialogPath = new URL('../../src/ui/overlays/import-cases-dialog.js', import.meta.url);
  const src = await fs.readFile(dialogPath, 'utf8');
  assert.match(src, /import \{ getCaseHandlingSummary \} from '\.\.\/\.\.\/services\/case-rule-summary\.js'/, 'import preview imports the shared summary');
  assert.match(src, /getCaseHandlingSummary\(record\)/, 'import preview renders the shared summary per row');
  assert.match(src, /'HANDLING'/, 'preview table has a Handling column');
});

test('CARGO-RULE-V1 case-rule-summary returns only active non-default rules', async () => {
  const summaryPath = new URL('../../src/services/case-rule-summary.js', import.meta.url);
  const { getCaseHandlingSummary, getInstanceHandlingSummary } = await import(`${summaryPath.href}?t=${Date.now()}-${Math.random()}`);

  // Defaults → nothing shown
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'any', canFlip: false, noStackOnTop: false, maxStackCount: 0, isPallet: false, laneItem: null, loadPriority: 0 }), []);
  // Each active rule
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'upright' }), ['Upright']);
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'onSide' }), ['On side']);
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'any', canFlip: true }), ['Flipping allowed']);
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'upright', canFlip: true }), ['Upright'], 'canFlip not shown when policy is not any');
  assert.deepEqual(getCaseHandlingSummary({ noStackOnTop: true }), ['No top load']);
  assert.deepEqual(getCaseHandlingSummary({ stackable: false }), ['No top load']);
  assert.deepEqual(getCaseHandlingSummary({ maxStackCount: 2 }), ['Max 2 on top']);
  assert.deepEqual(getCaseHandlingSummary({ isPallet: true }), ['Pallet base']);
  assert.deepEqual(getCaseHandlingSummary({ isPallet: true, maxPalletWeight: 2000 }), ['Pallet base', 'Max load warning: 2,000 lb']);
  assert.deepEqual(getCaseHandlingSummary({ maxPalletWeight: 2000 }), [], 'pallet warning only shown for pallets');
  assert.deepEqual(getCaseHandlingSummary({ laneItem: true }), ['Lane: Always']);
  assert.deepEqual(getCaseHandlingSummary({ laneItem: false }), ['Lane: Never']);
  assert.deepEqual(getCaseHandlingSummary({ loadPriority: 1 }), ['Priority: High']);
  assert.deepEqual(getCaseHandlingSummary({ loadPriority: -1 }), ['Priority: Low']);
  // Instance lock shown separately
  assert.deepEqual(getInstanceHandlingSummary({ orientationLocked: true }), ['Orientation locked (this item)']);
  assert.deepEqual(getInstanceHandlingSummary({ orientationLocked: false }), []);
});

test('CARGO-RULE-V1 all case surfaces use the shared rule-summary source', async () => {
  const casesSrc = await fs.readFile(casesScreenPath, 'utf8');
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(casesSrc, /import \{ getCaseHandlingSummary \} from '\.\.\/services\/case-rule-summary\.js'/, 'cases screen imports the shared summary');
  assert.match(casesSrc, /getCaseHandlingSummary\(c\)/, 'cases screen renders the shared summary (cards + list)');
  assert.match(editorSrc, /import \{ getCaseHandlingSummary, getInstanceHandlingSummary \} from '\.\.\/services\/case-rule-summary\.js'/, 'editor imports the shared summary');
  assert.match(editorSrc, /getCaseHandlingSummary\(c\)/, 'editor case browser uses the shared summary');
  assert.match(editorSrc, /getCaseHandlingSummary\(caseData\)/, 'inspector uses the shared summary');
  // 3D pallet label is warning-worded, not an enforced cap
  assert.match(editorSrc, /Warning limit: \$\{caseData\.maxPalletWeight\} lb/, '3D pallet label must read as a warning limit');
  assert.ok(!/`Max: \$\{caseData\.maxPalletWeight\} lb`/.test(editorSrc), 'must not show the old enforced-looking "Max: X lb" label');
});

test('CARGO-RULE-V1 normalizeInstance keeps oriented dims for unlocked rotated items (App Backup integrity)', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const HALF = Math.PI / 2;
  const caseMap = new Map([['c', { id: 'c', dimensions: { length: 30, width: 20, height: 10 } }]]);
  const mk = (rot, locked, stored) => ({ id: 'i', caseId: 'c', orientationLocked: locked, transform: { position: { x: 1, y: 1, z: 1 }, rotation: rot }, orientedDims: stored });
  const od = (rot, locked, stored) => Normalizer.normalizeInstance(mk(rot, locked, stored), caseMap).orientedDims;

  assert.equal(od({ x: 0, y: 0, z: 0 }, false), null, 'identity rotation needs no oriented dims');
  // Unlocked AutoPacked rotations must recompute (previously dropped to null).
  assert.deepEqual(od({ x: 0, y: HALF, z: 0 }, false), { length: 20, width: 30, height: 10 }, 'Y-only unlocked');
  assert.deepEqual(od({ x: HALF, y: 0, z: 0 }, false), { length: 30, width: 10, height: 20 }, 'X-tip unlocked');
  assert.deepEqual(od({ x: 0, y: 0, z: HALF }, false), { length: 10, width: 20, height: 30 }, 'Z-tip unlocked');
  // Compound rotation must match THREE.js Euler 'XYZ' (Rx*Ry*Rz). Verified against
  // a real THREE Box3 in the dedicated proof test below.
  assert.deepEqual(od({ x: HALF, y: 0, z: HALF }, false), { length: 10, width: 30, height: 20 }, 'compound unlocked');
  // Locked behaves as before.
  assert.deepEqual(od({ x: HALF, y: 0, z: 0 }, true), { length: 30, width: 10, height: 20 }, 'locked X-tip');
  // Recomputation is authoritative — stale/invalid stored dims are overridden when the case is known.
  assert.deepEqual(od({ x: HALF, y: 0, z: 0 }, false, { length: 99, width: 99, height: 99 }), { length: 30, width: 10, height: 20 }, 'stale stored dims recomputed');
  // Missing case → preserve the stored oriented dims (recomputation lacks context).
  assert.deepEqual(Normalizer.normalizeInstance(mk({ x: HALF, y: 0, z: 0 }, false, { length: 7, width: 8, height: 9 }), new Map()).orientedDims, { length: 7, width: 8, height: 9 }, 'missing case preserves stored');
});

test('CARGO-RULE-V1 App Backup round-trip preserves an unlocked rotated instance physical size', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const HALF = Math.PI / 2;
  const appData = {
    caseLibrary: [{ id: 'cc', name: 'Rotated Case', dimensions: { length: 30, width: 20, height: 10 } }],
    packLibrary: [{
      id: 'pp', title: 'P', truck: { length: 240, width: 96, height: 96 },
      cases: [{ id: 'inst', caseId: 'cc', orientationLocked: false, placement: 'packed', transform: { position: { x: 20, y: 5, z: 0 }, rotation: { x: HALF, y: 0, z: 0 } }, orientedDims: { length: 30, width: 10, height: 20 } }],
    }],
    folderLibrary: [],
  };
  const out = Normalizer.normalizeAppData(appData);
  const inst = out.packLibrary[0].cases[0];
  assert.deepEqual(inst.orientedDims, { length: 30, width: 10, height: 20 }, 'unlocked rotated instance keeps its effective dims through backup restore');
  assert.deepEqual(inst.transform.rotation, { x: HALF, y: 0, z: 0 }, 'rotation preserved');
  // Effective height (20) differs from the case height (10), proving the rotated size survived.
  assert.notEqual(inst.orientedDims.height, 10, 'restored physical height reflects the rotation, not the unrotated case');
});

// ---------------------------------------------------------------------------
// PHASE 1: Canonical THREE-compatible oriented dimensions
// ---------------------------------------------------------------------------

// Ground-truth oriented dims from a REAL THREE mesh + Box3. Expected values are
// read from THREE here, never copied from the implementation under test.
async function threeOrientedTruth() {
  const THREE = await import(`${vendorThreePath.href}`);
  // Case length->world X, height->world Y, width->world Z.
  return function truth(dims, rot) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(dims.length, dims.height, dims.width));
    mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0, 'XYZ');
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const r = (n) => Math.round(n * 1e6) / 1e6;
    return { length: r(size.x), width: r(size.z), height: r(size.y) };
  };
}

test('CARGO-RULE-V1 P1 shared oriented-dims helper matches THREE Euler XYZ for every right-angle combo', async () => {
  const { getOrientedDimsForRotation } = await import(`${orientedDimsPath.href}?t=${Date.now()}-${Math.random()}`);
  const truth = await threeOrientedTruth();
  const H = Math.PI / 2;
  // Asymmetric case so every axis permutation is distinguishable.
  const dims = { length: 30, width: 20, height: 10 };
  // identity, single, compound, full, plus negative and >360 right angles.
  const rotations = [
    { x: 0, y: 0, z: 0 },
    { x: H, y: 0, z: 0 },
    { x: 0, y: H, z: 0 },
    { x: 0, y: 0, z: H },
    { x: H, y: H, z: 0 },
    { x: H, y: 0, z: H },
    { x: 0, y: H, z: H },
    { x: H, y: H, z: H },
    { x: -H, y: 0, z: 0 },
    { x: 0, y: -H, z: -H },
    { x: Math.PI, y: 0, z: 0 },
    { x: 3 * H, y: H, z: 2 * Math.PI + H },
    { x: 5 * Math.PI, y: -3 * H, z: 4 * Math.PI },
  ];
  for (const rot of rotations) {
    const got = getOrientedDimsForRotation(dims, rot);
    const want = truth(dims, rot);
    assert.deepEqual(got, want, `oriented dims mismatch vs THREE for rot ${JSON.stringify(rot)}`);
  }
});

test('CARGO-RULE-V1 P1 all consumer paths derive identical oriented dims from the shared helper', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const { getOrientedDimsForRotation } = await import(`${orientedDimsPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const H = Math.PI / 2;
  const dims = { length: 30, width: 20, height: 10 };
  const rot = { x: H, y: 0, z: H }; // compound — the case that exposed the bug.
  const want = truth(dims, rot);

  // Core shared helper.
  assert.deepEqual(getOrientedDimsForRotation(dims, rot), want, 'core helper');
  // pack-library re-export produces identical results to the shared helper.
  assert.deepEqual(PackLib.getOrientedDimsForRotation(dims, rot), want, 'pack-library path matches the shared helper');
  // Solver candidate for a locked compound rotation uses the same math.
  const cands = Solver.buildOrientationCandidates(
    { l: dims.length, w: dims.width, h: dims.height },
    { orientationLocked: true, lockedRotation: rot }
  );
  assert.equal(cands.length, 1, 'locked rotation yields exactly one candidate');
  assert.deepEqual(
    { length: cands[0].l, width: cands[0].w, height: cands[0].h },
    want,
    'solver locked-candidate dims match THREE'
  );
});

test('CARGO-RULE-V1 P1 restore matrix: App/Workspace/Pack/batch/autosave keep THREE-correct compound dims', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const H = Math.PI / 2;
  const caseDims = { length: 30, width: 20, height: 10 };
  const rot = { x: H, y: 0, z: H };
  const want = truth(caseDims, rot); // { length:10, width:30, height:20 }

  const mkPack = () => ({
    id: 'pp', title: 'P', truck: { length: 240, width: 96, height: 96 },
    cases: [{ id: 'inst', caseId: 'cc', orientationLocked: false, placement: 'packed', transform: { position: { x: 20, y: 5, z: 0 }, rotation: rot }, orientedDims: { length: 99, width: 99, height: 99 } }],
  });
  const mkApp = () => ({ caseLibrary: [{ id: 'cc', name: 'C', dimensions: caseDims }], packLibrary: [mkPack()], folderLibrary: [] });

  // App Backup restore.
  const app = Normalizer.normalizeAppData(mkApp());
  assert.deepEqual(app.packLibrary[0].cases[0].orientedDims, want, 'App Backup restore matches THREE (stale 99s overridden)');

  // Workspace normalization (same normalizeAppData entrypoint used by workspace import).
  const ws = Normalizer.normalizeAppData(mkApp());
  assert.deepEqual(ws.packLibrary[0].cases[0].orientedDims, want, 'Workspace restore matches THREE');

  // Pack JSON normalization (single pack with its bundled case map).
  const caseMap = new Map([['cc', { id: 'cc', dimensions: caseDims }]]);
  const packInst = Normalizer.normalizeInstance(mkPack().cases[0], caseMap);
  assert.deepEqual(packInst.orientedDims, want, 'Pack JSON restore matches THREE');

  // Local autosave reload (round-trip through JSON then normalize again).
  const reloaded = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(app)));
  assert.deepEqual(reloaded.packLibrary[0].cases[0].orientedDims, want, 'autosave reload is stable and THREE-correct');
});

test('CARGO-RULE-V1 P1 a valid physical placement stays valid after export and restore', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const H = Math.PI / 2;
  // Case 60L x 40W x 30H, tipped on X then turned on Z, placed inside a 240x96x96 truck.
  const caseDims = { length: 60, width: 40, height: 30 };
  const rot = { x: H, y: 0, z: H };
  const od = PackLib.getOrientedDimsForRotation(caseDims, rot);
  // Place so the oriented box sits fully inside the truck (floor at y=0, centered in z).
  const truck = { length: 240, width: 96, height: 96 };
  const appData = {
    caseLibrary: [{ id: 'cc', name: 'C', dimensions: caseDims }],
    packLibrary: [{
      id: 'pp', title: 'P', truck,
      cases: [{ id: 'inst', caseId: 'cc', orientationLocked: true, lockedRotation: rot, placement: 'packed',
        transform: { position: { x: od.length / 2 + 1, y: od.height / 2, z: 0 }, rotation: rot }, orientedDims: od }],
    }],
    folderLibrary: [],
  };
  const inBounds = (inst, t) => {
    const d = inst.orientedDims;
    const p = inst.transform.position;
    return (
      p.x - d.length / 2 >= -0.05 && p.x + d.length / 2 <= t.length + 0.05 &&
      p.y - d.height / 2 >= -0.05 && p.y + d.height / 2 <= t.height + 0.05 &&
      p.z - d.width / 2 >= -t.width / 2 - 0.05 && p.z + d.width / 2 <= t.width / 2 + 0.05
    );
  };
  const before = appData.packLibrary[0].cases[0];
  assert.ok(inBounds(Normalizer.normalizeInstance(before, new Map([['cc', { id: 'cc', dimensions: caseDims }]])), truck), 'placement valid before round-trip');
  const restored = Normalizer.normalizeAppData(JSON.parse(JSON.stringify(appData)));
  const after = restored.packLibrary[0].cases[0];
  assert.deepEqual(after.orientedDims, od, 'oriented dims identical after export+restore');
  assert.ok(inBounds(after, truck), 'placement remains physically valid after export+restore');
});

test('CARGO-RULE-V1 orientation aliases canonicalize consistently across every path', async () => {
  const orientationPath = new URL('../../src/core/orientation.js', import.meta.url);
  const { canonicalOrientationLock } = await import(`${orientationPath.href}?t=${Date.now()}-${Math.random()}`);
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { l: 30, w: 20, h: 10 };

  const sideAliases = ['onSide', 'onside', 'on-side', 'on side', 'ON SIDE', 'On-Side', 'on_side'];
  for (const a of sideAliases) {
    assert.equal(canonicalOrientationLock(a), 'onSide', `core canon: ${a}`);
    // Solver: every alias must produce the 2 side candidates (never 0).
    assert.equal(Solver.buildOrientationCandidates(dims, { orientationLock: a, canFlip: false }).length, 2, `solver candidates for ${a}`);
    // Normalizer / model store canonical onSide.
    assert.equal(Normalizer.normalizeCase({ id: 'o', name: 'O', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: a }, Date.now()).orientationLock, 'onSide', `normalizer canon: ${a}`);
    // Spreadsheet cell parser canonicalizes with no spurious warning.
    assert.deepEqual(IE.parseOrientationLockCell(a), { value: 'onSide', warning: null }, `import cell: ${a}`);
    // Manual rotation policy agrees with AutoPack: onSide permits a tipped rotation.
    assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: a }, { x: Math.PI / 2, y: 0, z: 0 }), true, `manual policy onSide: ${a}`);
  }
  for (const a of ['upright', 'UPRIGHT']) assert.equal(canonicalOrientationLock(a), 'upright');
  for (const a of ['any', 'ANY', '', null, undefined, 'sideways', 'garbage']) assert.equal(canonicalOrientationLock(a), 'any', `invalid->any: ${a}`);
  // Invalid spreadsheet orientation warns and falls back to any.
  assert.equal(IE.parseOrientationLockCell('sideways').value, 'any');
  assert.ok(IE.parseOrientationLockCell('sideways').warning, 'invalid orientation warns');

  // Pack-import conflict comparator treats aliases as equivalent (no false conflict).
  const StateStore = await import(stateStorePath.href);
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'oc', name: 'Orient Case', orientationLock: 'onSide' })], packLibrary: [], folderLibrary: [], preferences: {} });
  const res = PackLib.importPackPayload({
    pack: { id: 'op', title: 'OP', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('oc', { id: 'oi', transform: { position: { x: 10, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'oc', name: 'Orient Case', orientationLock: 'on side' })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'alias-equivalent bundled case must be reused, not duplicated');
  assert.equal(res.caseConflicts.length, 0, 'orientation alias difference is not a real conflict');
});

test('CARGO-RULE-V1 CaseLibrary.upsert canonicalizes cargo fields and preserves unknown fields', async () => {
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  CaseLibrary.upsert({
    id: 'u1', name: 'Upsert Case', category: 'default', dimensions: { length: 10, width: 10, height: 10 }, weight: 5,
    orientationLock: 'on side', maxStackCount: 2.7, maxPalletWeight: -3, loadPriority: '1', laneItem: 'false',
    stackable: false, canFlip: 'yes', isPallet: 1,
    importSourceKey: 'keep-me', someExtensionField: 'preserve',
  });
  const c = (StateStore.get('caseLibrary') || []).find(x => x.id === 'u1');
  assert.equal(c.orientationLock, 'onSide', 'orientation alias canonicalized on upsert');
  assert.equal(c.maxStackCount, 2, 'decimal maxStackCount floored to integer');
  assert.equal(c.maxPalletWeight, 0, 'negative maxPalletWeight clamped');
  assert.equal(c.stackable, false, 'explicit stackable:false preserved');
  assert.equal(c.canFlip, true, 'canFlip coerced to boolean');
  assert.equal(c.isPallet, true, 'isPallet coerced to boolean');
  assert.equal(c.importSourceKey, 'keep-me', 'unknown idempotence field preserved');
  assert.equal(c.someExtensionField, 'preserve', 'unknown extension field preserved');
});

test('CARGO-RULE-V1 normalizers floor decimal maxStackCount', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const CaseModel = await import(`${caseModelPath.href}?t=${Date.now()}-${Math.random()}`);
  const base = { id: 'm', name: 'M', dimensions: { length: 10, width: 10, height: 10 } };
  assert.equal(Normalizer.normalizeCase({ ...base, maxStackCount: 3.9 }, Date.now()).maxStackCount, 3, 'core normalizer floors maxStackCount');
  assert.equal(CaseModel.normalizeCase({ ...base, maxStackCount: 3.9 }).maxStackCount, 3, 'case model floors maxStackCount');
});

test('CARGO-RULE-V1 spreadsheet invalid boolean and lane cells produce warnings (CSV/XLSX identical path)', async () => {
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.deepEqual(IE.parseBoolCell('yes', 'allow flipping'), { value: true, warning: null });
  assert.deepEqual(IE.parseBoolCell('no', 'allow flipping'), { value: false, warning: null });
  assert.deepEqual(IE.parseBoolCell('', 'allow flipping'), { value: false, warning: null });
  assert.equal(IE.parseBoolCell('maybe', 'allow flipping').value, false);
  assert.ok(IE.parseBoolCell('maybe', 'allow flipping').warning, 'invalid boolean warns');
  assert.deepEqual(IE.parseLaneCellWarned('always'), { value: true, warning: null });
  assert.deepEqual(IE.parseLaneCellWarned(''), { value: null, warning: null });
  assert.equal(IE.parseLaneCellWarned('sometimes').value, null);
  assert.ok(IE.parseLaneCellWarned('sometimes').warning, 'invalid lane warns');
});

test('CARGO-RULE-V1 unchecking no-top-load clears legacy stackable:false (modal save)', async () => {
  // Verified at the source level since the modal builds DOM imperatively.
  const src = await fs.readFile(caseModalPath, 'utf8');
  assert.match(src, /noStackOnTop: noTopChecked/);
  assert.match(src, /stackable: noTopChecked \? initial\.stackable !== false : true/);
  assert.match(src, /maxStackCount: noTopChecked \? 0 :/);
  assert.match(src, /AutoPack may still place them normally/i, 'lane copy reflects that Always is a preference, not a guarantee');
});

test('CARGO-RULE-V1 canonicalOrientationLock maps all accepted spellings', async () => {
  const Modal = await import(`${caseModalPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(Modal.canonicalOrientationLock('upright'), 'upright');
  assert.equal(Modal.canonicalOrientationLock('UPRIGHT'), 'upright');
  assert.equal(Modal.canonicalOrientationLock('onside'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('on-side'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('on side'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('onSide'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('any'), 'any');
  assert.equal(Modal.canonicalOrientationLock(undefined), 'any');
  assert.equal(Modal.canonicalOrientationLock('garbage'), 'any');
});

test('CARGO-RULE-V1 case duplicate preserves all handling rules', async () => {
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const src = {
    id: 'dup-src', name: 'Dup Source', category: 'default',
    dimensions: { length: 30, width: 20, height: 10 }, weight: 50,
    canFlip: true, orientationLock: 'onSide', noStackOnTop: true, stackable: false,
    maxStackCount: 3, isPallet: true, maxPalletWeight: 1500, laneItem: false, loadPriority: 1,
    hazmatClass: 'flammable', stopGroup: 'A',
  };
  StateStore.init({ caseLibrary: [src], packLibrary: [], folderLibrary: [], preferences: {} });
  const copy = CaseLibrary.duplicate('dup-src');
  for (const f of ['canFlip', 'orientationLock', 'noStackOnTop', 'stackable', 'maxStackCount', 'isPallet', 'maxPalletWeight', 'laneItem', 'loadPriority', 'hazmatClass', 'stopGroup']) {
    assert.deepEqual(copy[f], src[f], `duplicate must preserve ${f}`);
  }
  assert.notEqual(copy.id, src.id, 'duplicate gets a new id');
});

test('CARGO-RULE-V1 case modal exposes only honest handling controls with canonical save mapping', async () => {
  const src = await fs.readFile(caseModalPath, 'utf8');
  // Section + controls
  assert.match(src, /Handling Rules/, 'modal must add a Handling Rules section');
  assert.match(src, /\['onSide', 'Place on side'\]/, 'orientation select must offer onSide canonical');
  assert.match(src, /'Do not place cargo on top'/, 'no-top-load control label');
  assert.match(src, /Max items directly on top \(0 = no limit\)/, 'maxStackCount control with 0=no limit copy');
  assert.match(src, /Treat as pallet \/ load base/, 'pallet control label');
  assert.match(src, /Max load — warning only/, 'pallet weight labeled warning-only');
  assert.match(src, /does not block AutoPack/i, 'pallet weight help must say it does not block packing');
  assert.match(src, /Packing priority \(tie-breaker\)/, 'priority labeled as tie-breaker');
  // Canonical save mapping
  assert.match(src, /canFlip:\s*orientationLock === 'any' && Boolean\(flip\.checked\)/, 'canFlip only when policy is any');
  assert.match(src, /orientationLock,\n[\s\S]*noStackOnTop: noTopChecked/, 'save sets orientationLock + noStackOnTop');
  assert.match(src, /maxStackCount: noTopChecked \? 0 : Math\.max\(0, parseInt\(fMaxStack\.input\.value, 10\) \|\| 0\)/, 'maxStackCount cleaned to >= 0 integer and zeroed under no-top-load');
  assert.match(src, /stackable: noTopChecked \? initial\.stackable !== false : true/, 'unchecking no-top-load clears the legacy stackable:false rule');
  assert.match(src, /laneItem: laneValue/, 'save sets laneItem tri-state');
  assert.match(src, /loadPriority: priorityValue/, 'save sets loadPriority');
  assert.match(src, /\.\.\.initial,/, 'save must spread ...initial to preserve hidden/deferred fields');
  // Dependencies
  assert.match(src, /flip\.disabled = !isAny/, 'flip disabled when orientation not any');
  assert.match(src, /fMaxStack\.input\.disabled = noTop\.checked/, 'maxStackCount disabled under no-top-load');
  assert.match(src, /fPalletWarn\.wrap\.style\.display = pallet\.checked/, 'pallet warn shown only when pallet enabled');
  // No deferred/inert controls exposed
  assert.ok(!/createCheckRow\(doc, '[^']*[Ff]ragile/.test(src), 'must not expose a Fragile control');
  assert.ok(!/[Hh]azmat|stopGroup|mustLoadLast|deliverySequence/.test(src), 'must not expose deferred/inert fields');
});

test('CARGO-RULE-V1 orientation truth table: upright/onSide beat canFlip; instance lock overrides all', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { l: 30, w: 20, h: 10 }; // all distinct so a tipped face has h !== 10
  const cand = (item) => Solver.buildOrientationCandidates(dims, item);
  const hasTipped = (cs) => cs.some(c => c.h !== dims.h);
  const allUpright = (cs) => cs.every(c => c.h === dims.h);

  // 1) any + false → upright yaw only
  let cs = cand({ orientationLock: 'any', canFlip: false });
  assert.equal(cs.length, 2); assert.equal(allUpright(cs), true, 'any+false must be upright only');
  // 2) any + true → tipped faces allowed
  cs = cand({ orientationLock: 'any', canFlip: true });
  assert.equal(hasTipped(cs), true, 'any+true must allow tipped faces');
  // 3) upright + false → upright only
  cs = cand({ orientationLock: 'upright', canFlip: false });
  assert.equal(allUpright(cs), true, 'upright+false must be upright only');
  // 4) upright + true → STILL upright only (the fix)
  cs = cand({ orientationLock: 'upright', canFlip: true });
  assert.equal(allUpright(cs), true, 'upright+true must remain upright (orientation policy beats flip)');
  // 5) onSide + false → side orientations regardless of canFlip
  cs = cand({ orientationLock: 'onSide', canFlip: false });
  assert.equal(cs.length > 0, true); assert.equal(hasTipped(cs), true, 'onSide+false must produce side faces');
  // 6) onSide + true → still side orientations only
  cs = cand({ orientationLock: 'onSide', canFlip: true });
  assert.equal(hasTipped(cs), true, 'onSide+true side faces');
  // 7) valid instance exact lock overrides both policy and canFlip
  cs = cand({ orientationLock: 'any', canFlip: true, orientationLocked: true, lockedRotation: { x: 0, y: 0, z: 0 } });
  assert.equal(cs.length, 1, 'instance lock yields exactly one candidate');
  assert.equal(cs[0].locked, true, 'instance lock candidate is marked locked');

  // Manual rotate policy and AutoPack now agree: upright disallows a tipped rotation.
  const tippedRot = { x: Math.PI / 2, y: 0, z: 0 };
  assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, tippedRot), false,
    'manual policy: upright rejects a tipped rotation — matches AutoPack producing no tipped candidate');
  assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'any' }, tippedRot), true,
    'manual policy: any allows tipped — matches AutoPack canFlip behavior');
});

test('CARGO-RULE-V1 canFlip defaults to false across model/normalizer/import; explicit values preserved', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const CaseModel = await import(`${caseModelPath.href}?t=${Date.now()}-${Math.random()}`);
  const ImportExport = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const baseCase = { id: 'cf-1', name: 'Flip Default', dimensions: { length: 48, width: 24, height: 24 } };

  // Missing canFlip → false in both normalizers
  assert.equal(Normalizer.normalizeCase({ ...baseCase }, Date.now()).canFlip, false, 'core normalizer: missing canFlip must default to false');
  assert.equal(CaseModel.normalizeCase({ ...baseCase }).canFlip, false, 'case model: missing canFlip must default to false');
  // Explicit values preserved
  assert.equal(Normalizer.normalizeCase({ ...baseCase, canFlip: true }, Date.now()).canFlip, true, 'explicit canFlip:true preserved');
  assert.equal(Normalizer.normalizeCase({ ...baseCase, canFlip: false }, Date.now()).canFlip, false, 'explicit canFlip:false preserved');

  // CSV/spreadsheet import: missing column, blank, and explicit values
  const row = (extra = {}) => ({ name: extra.name || 'Row', length: 48, width: 24, height: 24, weight: 10, ...extra });
  const noCol = ImportExport.importCaseRows([row({ name: 'NoFlipCol' })], []);
  const added = noCol.nextCaseLibrary.find(c => c.name === 'NoFlipCol');
  assert.equal(added.canFlip, false, 'import with no canFlip column must default to false');
  const explicitFalse = ImportExport.importCaseRows([row({ name: 'FlipFalse', canFlip: false })], []);
  assert.equal(explicitFalse.nextCaseLibrary.find(c => c.name === 'FlipFalse').canFlip, false, 'import canFlip:false stays false');
  const explicitTrue = ImportExport.importCaseRows([row({ name: 'FlipTrue', canFlip: true })], []);
  assert.equal(explicitTrue.nextCaseLibrary.find(c => c.name === 'FlipTrue').canFlip, true, 'import canFlip:true stays true');
});

test('CARGO-RULE-V1 new-case modal initial defaults canFlip to false', async () => {
  const src = await fs.readFile(caseModalPath, 'utf8');
  // The new-case branch builds an inline initial object; assert canFlip:false and no canFlip:true new-case default.
  assert.match(src, /canFlip:\s*false/, 'case modal new-case initial must default canFlip to false');
  assert.ok(!/\n\s*canFlip:\s*true\s*,/.test(src), 'case modal must not default a new case to canFlip:true');
});

test('AUTO-PACK-A1-R1 normalizers add logistics defaults and preserve explicit values', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const CaseModel = await import(`${caseModelPath.href}?t=${Date.now()}-${Math.random()}`);
  const now = Date.now();

  const coreDefault = Normalizer.normalizeCase({
    id: 'case-defaults',
    name: 'Defaults',
    dimensions: { length: 48, width: 24, height: 24 },
  }, now);
  assert.equal(coreDefault.laneItem, null);
  assert.equal(coreDefault.loadPriority, 0);
  assert.equal(coreDefault.mustLoadLast, false);
  assert.equal(coreDefault.mustUnloadFirst, false);
  assert.equal(coreDefault.stopGroup, '');
  assert.equal(coreDefault.keepTogetherGroup, '');

  const modelDefault = CaseModel.normalizeCase({
    id: 'case-model-defaults',
    name: 'Model Defaults',
    dimensions: { length: 48, width: 24, height: 24 },
  });
  assert.equal(modelDefault.laneItem, null);
  assert.equal(modelDefault.loadPriority, 0);
  assert.equal(modelDefault.mustLoadLast, false);
  assert.equal(modelDefault.mustUnloadFirst, false);
  assert.equal(modelDefault.stopGroup, '');
  assert.equal(modelDefault.keepTogetherGroup, '');

  const normalized = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-logistics',
        name: 'Logistics Case',
        dimensions: { length: 96, width: 12, height: 12 },
        laneItem: false,
        loadPriority: 7,
        mustLoadLast: true,
        mustUnloadFirst: true,
        stopGroup: 'Stop A',
        keepTogetherGroup: 'Rack Group',
      },
    ],
    packLibrary: [
      {
        id: 'pack-logistics',
        title: 'Logistics Pack',
        truck: { length: 120, width: 48, height: 48 },
        cases: [
          {
            id: 'inst-logistics',
            caseId: 'case-logistics',
            deliverySequence: 3,
          },
        ],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });
  const normalizedCase = normalized.caseLibrary[0];
  const normalizedInstance = normalized.packLibrary[0].cases[0];

  assert.equal(normalizedCase.laneItem, false,
    'case-level laneItem override must survive normalizeAppData');
  assert.equal(normalizedCase.loadPriority, 7,
    'case-level loadPriority must survive normalizeAppData');
  assert.equal(normalizedCase.mustLoadLast, true,
    'case-level mustLoadLast must survive normalizeAppData');
  assert.equal(normalizedCase.mustUnloadFirst, true,
    'case-level mustUnloadFirst must survive normalizeAppData');
  assert.equal(normalizedCase.stopGroup, 'Stop A',
    'case-level stopGroup must survive normalizeAppData');
  assert.equal(normalizedCase.keepTogetherGroup, 'Rack Group',
    'case-level keepTogetherGroup must survive normalizeAppData');
  assert.equal(normalizedInstance.deliverySequence, 3,
    'instance-level deliverySequence must survive normalizeAppData');

  const normalizedDefaultInstance = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-instance-default',
        name: 'Instance Default',
        dimensions: { length: 24, width: 24, height: 24 },
      },
    ],
    packLibrary: [
      {
        id: 'pack-instance-default',
        title: 'Instance Default Pack',
        cases: [{ id: 'inst-default', caseId: 'case-instance-default' }],
      },
    ],
    folderLibrary: [],
    preferences: {},
  }).packLibrary[0].cases[0];

  assert.equal(normalizedDefaultInstance.deliverySequence, null,
    'instance-level deliverySequence default must be null');
});

test('AUTO-PACK-A1-R1 solver scaffold is pure and returns the expected output shape', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.doesNotMatch(src, /import\s+.*from\s+['"][^'"]*(?:three|supabase|stripe|billing|state-store|ui-components)/i,
    'solver scaffold must not import app infrastructure or payment/auth dependencies');
  assert.doesNotMatch(src, /\b(?:window|document|localStorage|StateStore|UIComponents)\b/,
    'solver scaffold must remain independent of browser globals and app state');

  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const output = Solver.solveAutoPack({
    truck: { length: 120, width: 48, height: 48 },
    zones: [],
    items: [],
  });

  assert.ok(output.placements instanceof Map,
    'solveAutoPack must expose placements as a Map');
  assert.ok(output.rotations instanceof Map,
    'solveAutoPack must expose rotations as a Map');
  assert.ok(output.orientedDims instanceof Map,
    'solveAutoPack must expose orientedDims as a Map');
  assert.deepEqual(output.unpacked, []);
  assert.deepEqual(output.warnings, []);
  assert.deepEqual(output.phaseStats, {
    laneCount: 0,
    floorCount: 0,
    stackCount: 0,
    fillerCount: 0,
    unpackedCount: 0,
  });

  assert.equal(
    Solver.classifyAutoPackItem({ dimensions: { length: 96, width: 12, height: 12 } }),
    'LANE_ITEM',
    'long aspect-ratio items must be classified as lane candidates'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ dimensions: { length: 60, width: 20, height: 20 } }),
    'STANDARD',
    'ratio-3 medium boxes must not be auto-classified as lane items'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ dimensions: { length: 72, width: 48, height: 40 } }),
    'STANDARD',
    'blocky cases with one large dimension must not be auto-classified as lane items'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ shape: 'drum', dimensions: { length: 24, width: 24, height: 24 } }),
    'STANDARD',
    'short round shapes must not be forced into long-item lane handling'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ laneItem: true, shape: 'drum', dimensions: { length: 24, width: 24, height: 24 } }),
    'LANE_ITEM',
    'laneItem=true must still allow manual lane classification for round items'
  );
  assert.equal(
    Solver.classifyAutoPackItem({ laneItem: false, shape: 'drum', dimensions: { length: 24, width: 24, height: 24 } }),
    'STANDARD',
    'laneItem=false must prevent automatic lane classification'
  );
  assert.equal(
    Solver.classifyAutoPackItem({
      orientationLocked: true,
      lockedRotation: { z: Math.PI / 2 },
      dimensions: { length: 120, width: 12, height: 12 },
    }),
    'STANDARD',
    'manual orientation locks must classify by effective floor footprint instead of raw long dimension'
  );
  assert.equal(
    Solver.computeSupportFraction(
      Solver.getAabb({ x: 0, y: 15, z: 0 }, { l: 20, w: 20, h: 10 }),
      [Solver.getAabb({ x: 0, y: 5, z: 0 }, { l: 20, w: 20, h: 10 })]
    ),
    1,
    'support math must report full footprint support when AABBs align'
  );
});

test('AUTO-PACK-A1-R3 floor solver packs rectangular floor positions without gaps or overlaps', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = Array.from({ length: 4 }, (_, index) => ({
    instanceId: `box-${index + 1}`,
    dims: { l: 48, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 4);

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    const dims = { l: od.length, w: od.width, h: od.height };
    return Solver.getAabb(pos, dims);
  });

  for (let i = 0; i < packed.length; i++) {
    assert.equal(packed[i].min.y, 0, 'floor solver must keep floor-fit boxes on the floor');
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true,
      'floor solver must keep every packed AABB inside a usable zone');
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'floor solver must not overlap packed floor items');
    }
  }

  const bounds = packed.reduce(
    (acc, aabb) => ({
      minX: Math.min(acc.minX, aabb.min.x),
      maxX: Math.max(acc.maxX, aabb.max.x),
      minZ: Math.min(acc.minZ, aabb.min.z),
      maxZ: Math.max(acc.maxZ, aabb.max.z),
      area: acc.area + (aabb.max.x - aabb.min.x) * (aabb.max.z - aabb.min.z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, area: 0 }
  );
  assert.equal(bounds.area, (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ),
    'exact floor-fit boxes should form one gap-free floor block even when yaw rotation is selected');
  assert.equal(bounds.minX, 0,
    'gap-free floor block should start against the load-side wall');
  assert.equal(bounds.minZ, -24);
  assert.equal(bounds.maxZ, 24,
    'gap-free floor block should use the full truck width');
});

test('AUTO-PACK-A1-R3 floor solver consumes supplied wheel-well usable zones', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 30, width: 48, height: 48 };
  const zones = [
    { min: { x: 0, y: 0, z: -8 }, max: { x: 30, y: 48, z: 8 } },
    { min: { x: 0, y: 15, z: -24 }, max: { x: 30, y: 48, z: -8 } },
    { min: { x: 0, y: 15, z: 8 }, max: { x: 30, y: 48, z: 24 } },
  ];
  const items = Array.from({ length: 3 }, (_, index) => ({
    instanceId: `well-${index + 1}`,
    dims: { l: 30, w: 16, h: 10 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);

  const bottoms = [];
  for (const item of items) {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
    bottoms.push(aabb.min.y);
    assert.equal(Solver.isAabbContainedInAnyZone(aabb, zones), true,
      'wheel-well floor solver must use supplied usable zones instead of a plain rectangle');
  }
  assert.equal(bottoms.includes(15), true,
    'wheel-well side zones must place items at the elevated well floor, not inside the blocked well volume');
});

test('AUTO-PACK-A1-R3 floor solver respects front-bonus height and width zones', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [
    { min: { x: 0, y: 0, z: -24 }, max: { x: 80, y: 48, z: 24 } },
    { min: { x: 80, y: 0, z: -12 }, max: { x: 120, y: 20, z: 12 } },
  ];
  const items = [
    { instanceId: 'short-bonus', loadPriority: 2, dims: { l: 30, w: 20, h: 15 } },
    { instanceId: 'tall-main', loadPriority: 1, dims: { l: 30, w: 20, h: 30 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, []);

  const short = Solver.getAabb(output.placements.get('short-bonus'), { l: 30, w: 20, h: 15 });
  const tallOd = output.orientedDims.get('tall-main');
  const tall = Solver.getAabb(output.placements.get('tall-main'), {
    l: tallOd.length,
    w: tallOd.width,
    h: tallOd.height,
  });

  assert.equal(short.min.x >= 80, true,
    'front-to-rear floor pass should use the valid short front-bonus zone first');
  assert.equal(tall.max.x <= 80, true,
    'items taller than the front bonus must stay in the main trailer zone');
  assert.equal(Solver.isAabbContainedInAnyZone(short, zones), true);
  assert.equal(Solver.isAabbContainedInAnyZone(tall, zones), true);
});

test('AUTO-PACK-A1-R4 stack phase runs only after floor positions are exhausted', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 48, z: 24 } }];
  const items = Array.from({ length: 6 }, (_, index) => ({
    instanceId: `cube-${index + 1}`,
    dims: { l: 24, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 6);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 4,
    'floor pass must fill the four valid floor cells before stack phase runs');
  assert.equal(output.phaseStats.stackCount, 2,
    'stack pass must place the remaining cubes only after the floor is full');

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  assert.equal(packed.filter(aabb => aabb.min.y === 0).length, 4);
  assert.equal(packed.filter(aabb => aabb.min.y === 24).length, 2);

  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'stacked output must not collide with floor or stack placements');
    }
  }
});

test('AUTO-PACK-A1-R4 stack phase requires meaningful support area', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'small-support', laneItem: true, dims: { l: 16, w: 16, h: 24 } },
    { instanceId: 'large-top', loadPriority: 1, dims: { l: 24, w: 24, h: 12 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 1);
  assert.deepEqual(output.unpacked, ['large-top']);
  assert.equal(output.phaseStats.stackCount, 0,
    'a large item must not be stacked on a small support with less than 50% support');
});

test('AUTO-PACK-A1-R4 stack phase honors noStackOnTop and stackable false supports', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];

  const noStackOutput = Solver.solveAutoPack({
    truck,
    zones,
    items: [
      { instanceId: 'fragile-base', loadPriority: 2, noStackOnTop: true, dims: { l: 24, w: 24, h: 24 } },
      { instanceId: 'top-case', loadPriority: 1, dims: { l: 24, w: 24, h: 24 } },
    ],
  });
  assert.equal(noStackOutput.placements.size, 1);
  assert.deepEqual(noStackOutput.unpacked, ['top-case']);
  assert.equal(noStackOutput.phaseStats.stackCount, 0,
    'noStackOnTop support must not receive stacked items');

  const stackableFalseOutput = Solver.solveAutoPack({
    truck,
    zones,
    items: [
      { instanceId: 'unstackable-base', loadPriority: 2, stackable: false, dims: { l: 24, w: 24, h: 24 } },
      { instanceId: 'top-case', loadPriority: 1, dims: { l: 24, w: 24, h: 24 } },
    ],
  });
  assert.equal(stackableFalseOutput.placements.size, 1);
  assert.deepEqual(stackableFalseOutput.unpacked, ['top-case']);
  assert.equal(stackableFalseOutput.phaseStats.stackCount, 0,
    'stackable=false support must not receive stacked items');
});

test('AUTO-PACK-A1-R4 stack phase enforces maxStackCount for direct support children', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 48, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'wide-base', loadPriority: 3, maxStackCount: 1, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'top-a', loadPriority: 2, stackable: false, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'top-b', loadPriority: 1, stackable: false, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, ['top-b']);
  assert.equal(output.phaseStats.floorCount, 1);
  assert.equal(output.phaseStats.stackCount, 1,
    'maxStackCount=1 must allow only one direct child on the wide base');
});

test('AUTO-PACK-A1-R5.5 stack phase blocks heavy items on lighter non-pallet supports', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'priority-light-base', laneItem: true, loadPriority: 100, weight: 20, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'heavy-deferred', loadPriority: 1, weight: 220, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 1);
  assert.deepEqual(output.unpacked, ['heavy-deferred']);
  assert.equal(output.phaseStats.stackCount, 0,
    'loadPriority must not allow a heavier item to stack on a lighter non-pallet support');
});

test('AUTO-PACK-A1-R5.5 stack phase allows light items on heavier supports', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'heavy-base', loadPriority: 10, weight: 220, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'light-top', loadPriority: 1, weight: 20, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 1,
    'lighter items may still stack on heavier safe supports');
});

test('AUTO-PACK-A1-R5.5 pallet supports are exempt from support-weight comparison', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'pallet-base', loadPriority: 10, isPallet: true, weight: 20, dims: { l: 24, w: 24, h: 12 } },
    { instanceId: 'heavy-pallet-load', loadPriority: 1, weight: 220, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 1,
    'pallet support behavior should not be derived from pallet tare weight');
});

// ---------------------------------------------------------------------------
// 5A — AutoPack stacking safety & scoring. These exercise the ACTIVE solver
// (autopack-solver.js / solveAutoPack) at runtime, not the retired legacy
// solver. They lock in the proven behaviour: every stacking entry point
// (floor/filler/stack/repack) and the final validator share the same support
// rule checks (canSupportStack / hasStackCapacity / weight / support-fraction),
// scoring is lexicographic and prefers lower placements (there is no flat
// stacking bonus in the active solver), and the metadata survives the data
// pipeline.
// ---------------------------------------------------------------------------

// Reusable, solver-independent safety contract. Re-derives the rules from the
// raw item metadata and the geometric output so it cannot be fooled by any
// single solver helper.
function assertStackSafeOutput(Solver, output, itemsById, zones, label) {
  const placed = [...output.placements.keys()].map(id => {
    const od = output.orientedDims.get(id);
    return { id, item: itemsById.get(id), aabb: Solver.getAabb(output.placements.get(id), { l: od.length, w: od.width, h: od.height }) };
  });
  const canSupport = it => !(it && (it.noStackOnTop === true || it.stackable === false));
  const xzOverlap = (a, b) =>
    (Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) > 0.05 &&
    (Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)) > 0.05;

  for (const p of placed) {
    assert.equal(Solver.isAabbContainedInAnyZone(p.aabb, zones), true, `${label}: ${p.id} must stay inside a usable zone`);
    for (const q of placed) {
      if (q === p) continue;
      assert.equal(Solver.aabbsOverlap(p.aabb, q.aabb), false, `${label}: ${p.id} must not overlap ${q.id}`);
    }
    if (p.aabb.min.y <= 0.05) continue; // floor item
    const supports = placed.filter(q => q !== p && Math.abs(q.aabb.max.y - p.aabb.min.y) < 0.06 && xzOverlap(p.aabb, q.aabb));
    assert.ok(supports.length > 0, `${label}: stacked ${p.id} must rest on a support, not float`);
    for (const s of supports) {
      assert.equal(canSupport(s.item), true, `${label}: ${p.id} must not rest on no-stack support ${s.id}`);
      const isPallet = s.item && s.item.isPallet === true;
      assert.ok(isPallet || (Number(p.item.weight) || 0) <= (Number(s.item.weight) || 0),
        `${label}: heavier ${p.id} must not rest on lighter non-pallet ${s.id}`);
    }
    const frac = Solver.computeSupportFraction(p.aabb, supports.map(s => s.aabb));
    assert.ok(frac >= 0.5, `${label}: ${p.id} support fraction ${frac.toFixed(2)} must be >= 0.5`);
  }
  // maxStackCount is a per-support direct-children cap.
  for (const s of placed) {
    const max = Number(s.item && s.item.maxStackCount) || 0;
    if (max <= 0) continue;
    const direct = placed.filter(q => q !== s && Math.abs(q.aabb.min.y - s.aabb.max.y) < 0.06 && xzOverlap(q.aabb, s.aabb)).length;
    assert.ok(direct <= max, `${label}: support ${s.id} has ${direct} direct children, exceeds maxStackCount ${max}`);
  }
}

test('5A noStackOnTop is honored through the filler and repack passes', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 96, width: 48, height: 120 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 96, y: 120, z: 24 } }];
  const items = [
    { instanceId: 'frag', dims: { l: 96, w: 48, h: 24 }, weight: 2000, noStackOnTop: true },
    ...Array.from({ length: 6 }, (_, i) => ({ instanceId: `x${i}`, dims: { l: 48, w: 24, h: 24 }, weight: 10 })),
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  const od = out.orientedDims.get('frag');
  const fragAabb = Solver.getAabb(out.placements.get('frag'), { l: od.length, w: od.width, h: od.height });
  let onFrag = 0;
  for (let i = 0; i < 6; i++) {
    const pos = out.placements.get(`x${i}`);
    if (!pos) continue;
    const cod = out.orientedDims.get(`x${i}`);
    const a = Solver.getAabb(pos, { l: cod.length, w: cod.width, h: cod.height });
    if (Math.abs(a.min.y - fragAabb.max.y) < 0.06 && a.min.x < fragAabb.max.x && a.max.x > fragAabb.min.x) onFrag++;
  }
  assert.equal(onFrag, 0, 'no item may rest on a noStackOnTop base after the floor base covers the deck (filler + repack must not bypass it)');
  assert.equal(out.placements.has('frag'), true, 'the noStackOnTop base itself is still floor-placed');
});

test('5A maxStackCount 0 means unlimited direct children', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 24, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 48, y: 72, z: 12 } }];
  const items = [
    { instanceId: 'base', dims: { l: 48, w: 24, h: 24 }, weight: 1000, maxStackCount: 0, loadPriority: 5 },
    { instanceId: 'c1', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
    { instanceId: 'c2', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  assert.equal(out.placements.size, 3);
  assert.deepEqual(out.unpacked, []);
  assert.equal(out.phaseStats.stackCount, 2, 'maxStackCount: 0 must be treated as no limit, so both children may stack on the base');
});

test('5A maxStackCount caps direct children but allows a taller multi-layer tower', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 72, width: 24, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 72, y: 72, z: 12 } }];
  const items = [
    { instanceId: 'base', dims: { l: 72, w: 24, h: 24 }, weight: 1000, maxStackCount: 2, loadPriority: 5 },
    { instanceId: 'c1', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
    { instanceId: 'c2', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
    { instanceId: 'c3', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  const aabb = id => {
    const od = out.orientedDims.get(id);
    return Solver.getAabb(out.placements.get(id), { l: od.length, w: od.width, h: od.height });
  };
  const baseTop = aabb('base').max.y;
  const direct = ['c1', 'c2', 'c3'].filter(id => Math.abs(aabb(id).min.y - baseTop) < 0.06).length;
  assert.equal(direct, 2, 'maxStackCount: 2 limits the base to exactly two direct children');
  assert.equal(out.placements.size, 4, 'the third child still packs by stacking onto a child layer (per-support cap, not a global tower-height cap)');
});

test('5A stacking prefers the lower layer before opening a higher layer', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 120 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 120, z: 24 } }];
  const items = [
    { instanceId: 'A', dims: { l: 48, w: 48, h: 24 }, weight: 1000 },
    { instanceId: 'C1', dims: { l: 24, w: 48, h: 24 }, weight: 10 },
    { instanceId: 'C2', dims: { l: 24, w: 48, h: 24 }, weight: 10 },
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  const aabb = id => {
    const od = out.orientedDims.get(id);
    return Solver.getAabb(out.placements.get(id), { l: od.length, w: od.width, h: od.height });
  };
  assert.equal(aabb('C1').min.y, 24);
  assert.equal(aabb('C2').min.y, 24,
    'both children fill the single lower stack layer; the lexicographic score must not push one to a needless higher layer');
});

test('5A repeated identical cases pack with no overlaps and a safe stacking contract', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 96 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 96, z: 24 } }];
  const items = Array.from({ length: 12 }, (_, i) => ({ instanceId: `r${i}`, dims: { l: 24, w: 24, h: 24 }, weight: 50 }));
  const itemsById = new Map(items.map(it => [it.instanceId, it]));
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  assert.equal(out.placements.size, 12);
  assert.deepEqual(out.unpacked, []);
  assertStackSafeOutput(Solver, out, itemsById, zones, 'repeated-cases');
});

test('5A final solver output independently satisfies the stacking-safety contract', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);

  // Real multi-layer stacking onto a maxStackCount-limited base.
  const capTruck = { length: 72, width: 24, height: 72 };
  const capZones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 72, y: 72, z: 12 } }];
  const capItems = [
    { instanceId: 'base', dims: { l: 72, w: 24, h: 24 }, weight: 1000, maxStackCount: 2 },
    { instanceId: 'c1', dims: { l: 24, w: 24, h: 24 }, weight: 10 },
    { instanceId: 'c2', dims: { l: 24, w: 24, h: 24 }, weight: 10 },
    { instanceId: 'c3', dims: { l: 24, w: 24, h: 24 }, weight: 10 },
  ];
  const capOut = Solver.solveAutoPack({ truck: capTruck, zones: capZones, items: capItems, loadFrontFirst: true });
  assertStackSafeOutput(Solver, capOut, new Map(capItems.map(it => [it.instanceId, it])), capZones, 'maxStack-tower');

  // Mixed weights and a noStackOnTop base in the same run.
  const mixTruck = { length: 48, width: 48, height: 120 };
  const mixZones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 120, z: 24 } }];
  const mixItems = [
    { instanceId: 'frag', dims: { l: 48, w: 48, h: 24 }, weight: 1500, noStackOnTop: true },
    { instanceId: 'heavy', dims: { l: 24, w: 24, h: 24 }, weight: 900 },
    ...Array.from({ length: 8 }, (_, i) => ({ instanceId: `m${i}`, dims: { l: 24, w: 24, h: 24 }, weight: 100 })),
  ];
  const mixOut = Solver.solveAutoPack({ truck: mixTruck, zones: mixZones, items: mixItems, loadFrontFirst: true });
  assertStackSafeOutput(Solver, mixOut, new Map(mixItems.map(it => [it.instanceId, it])), mixZones, 'mixed-weights');
});

test('5A case normalizer preserves explicit stackable:false and maxStackCount:0', async () => {
  const { normalizeCase } = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const now = Date.now();
  // Pass an explicit id so normalization does not fall through to uuid()/window.
  const norm = extra => normalizeCase({ id: 'case-5a', name: 'Case 5A', dimensions: { length: 48, width: 24, height: 24 }, ...extra }, now);
  assert.equal(norm({ stackable: false }).stackable, false, 'explicit stackable:false must survive normalization');
  assert.equal(norm({}).stackable, true, 'missing stackable must default to true');
  assert.equal(norm({ maxStackCount: 0 }).maxStackCount, 0, 'explicit maxStackCount:0 must survive normalization');
  assert.equal(norm({ maxStackCount: 3 }).maxStackCount, 3, 'explicit maxStackCount must survive normalization');
  assert.equal(norm({ maxStackCount: -2 }).maxStackCount, 0, 'negative maxStackCount clamps to 0');
  assert.equal(norm({ noStackOnTop: true }).noStackOnTop, true, 'explicit noStackOnTop:true must survive normalization');
  assert.equal(norm({}).noStackOnTop, false, 'missing noStackOnTop must default to false');
});

test('5A engine adapter forwards stacking metadata from caseData to the solver', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const start = src.indexOf('solveAutoPack({');
  assert.ok(start !== -1, 'engine must call solveAutoPack');
  const block = src.slice(start, start + 1400);
  assert.match(block, /noStackOnTop:\s*caseData\.noStackOnTop/, 'engine must forward noStackOnTop from caseData');
  assert.match(block, /stackable:\s*caseData\.stackable/, 'engine must forward stackable from caseData');
  assert.match(block, /maxStackCount:\s*caseData\.maxStackCount/, 'engine must forward maxStackCount from caseData');
  assert.match(block, /isPallet:\s*caseData\.isPallet/, 'engine must forward isPallet from caseData');
  assert.match(block, /weight:\s*caseData\.weight/, 'engine must forward weight from caseData');
});

test('AUTO-PACK-A1-R5 lane phase places long items lengthwise before normal boxes', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'tube-a', dims: { l: 96, w: 8, h: 8 } },
    { instanceId: 'tube-b', dims: { l: 96, w: 8, h: 8 } },
    { instanceId: 'normal-box-a', loadPriority: 100, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'normal-box-b', loadPriority: 100, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.laneCount, 2,
    'long aspect-ratio items must be placed by the lane phase before normal floor items');
  assert.equal(output.phaseStats.floorCount, 2);

  const aabbs = new Map();
  for (const item of items) {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    const dims = { l: od.length, w: od.width, h: od.height };
    const aabb = Solver.getAabb(pos, dims);
    aabbs.set(item.instanceId, aabb);
    assert.equal(Solver.isAabbContainedInAnyZone(aabb, zones), true);
  }

  for (const tubeId of ['tube-a', 'tube-b']) {
    const od = output.orientedDims.get(tubeId);
    assert.equal(od.length, 96,
      'lane phase must keep tube/truss items aligned lengthwise along X');
    assert.equal(od.width, 8);
    assert.equal(od.height, 8);
    assert.equal(aabbs.get(tubeId).min.y, 0,
      'lane items should sit on the floor lane, not float or stack');
  }

  const packed = [...aabbs.values()];
  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'lane reservations must prevent normal boxes from colliding with long items');
    }
  }
});

test('AUTO-PACK-A1-R5 lane phase unpacks long items that cannot fit a safe lengthwise lane', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'oversize-rail', dims: { l: 144, w: 8, h: 8 } },
    { instanceId: 'normal-box', dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.has('oversize-rail'), false);
  assert.deepEqual(output.unpacked, ['oversize-rail']);
  assert.equal(output.phaseStats.laneCount, 0);
  assert.equal(output.phaseStats.floorCount, 1,
    'normal boxes should still use the floor phase when an oversized lane item is unpacked');
  assert.match(output.warnings.join('\n'), /oversize-rail.*lengthwise lane/,
    'oversized lane failures should be reported as lane placement failures');
});

test('AUTO-PACK-A1-R6.3 failed lane items retry through safe stack path before staging', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 48, y: 48, z: 12 } }];
  const items = [
    { instanceId: 'lane-base', laneItem: true, weight: 100, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'lane-top-retry', laneItem: true, weight: 20, dims: { l: 48, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 2,
    'failed lane item must be retried through the normal safe placement pipeline before staging');
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.laneCount, 1);
  assert.equal(output.phaseStats.stackCount, 1,
    'lane retry should be allowed to use a safe supported stack after floor lane space is full');

  const topDims = output.orientedDims.get('lane-top-retry');
  const topAabb = Solver.getAabb(output.placements.get('lane-top-retry'), {
    l: topDims.length,
    w: topDims.width,
    h: topDims.height,
  });
  assert.equal(topAabb.min.y, 24,
    'retried lane item should sit on the safe support instead of being staged');
});

test('AUTO-PACK-A1-R6.1 filler pass uses floor voids before stacking', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 60, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 60, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'large-a', dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'large-b', dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'small-filler', dims: { l: 12, w: 24, h: 12 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 2,
    'large floor items should be placed before the filler pass');
  assert.equal(output.phaseStats.fillerCount, 1,
    'small floor-gap item must be counted as filler placement');
  assert.equal(output.phaseStats.stackCount, 0,
    'filler pass must use remaining floor voids before stack phase');

  const fillerPos = output.placements.get('small-filler');
  const fillerDims = output.orientedDims.get('small-filler');
  const fillerAabb = Solver.getAabb(fillerPos, {
    l: fillerDims.length,
    w: fillerDims.width,
    h: fillerDims.height,
  });
  assert.equal(fillerAabb.min.y, 0,
    'filler placement must remain on the floor when a valid floor void exists');
  assert.equal(Solver.isAabbContainedInAnyZone(fillerAabb, zones), true);
});

test('AUTO-PACK-A1-R6.1 floor candidates and compaction keep mixed-width rows tight', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 60, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 60, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'row-a', dims: { l: 60, w: 20, h: 12 } },
    { instanceId: 'row-b', dims: { l: 60, w: 20, h: 12 } },
    { instanceId: 'row-fill', dims: { l: 60, w: 8, h: 8 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.equal(output.phaseStats.stackCount, 0);

  const floorAabbs = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  }).sort((a, b) => a.min.z - b.min.z);

  assert.equal(floorAabbs[0].min.z, -24,
    'mixed-width floor row should start against the left wall');
  assert.equal(floorAabbs.at(-1).max.z, 24,
    'mixed-width floor row should end against the right wall');
  for (let i = 1; i < floorAabbs.length; i++) {
    assert.equal(floorAabbs[i - 1].max.z, floorAabbs[i].min.z,
      'mixed-width floor row should have no gap between adjacent cases');
  }
  for (let i = 0; i < floorAabbs.length; i++) {
    assert.equal(floorAabbs[i].min.y, 0);
    for (let j = i + 1; j < floorAabbs.length; j++) {
      assert.equal(Solver.aabbsOverlap(floorAabbs[i], floorAabbs[j]), false);
    }
  }
});

test('AUTO-PACK-A1-R6.1 stack scoring fills lower layers before higher layers', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 72, z: 12 } }];
  const items = Array.from({ length: 3 }, (_, index) => ({
    instanceId: `layer-${index + 1}`,
    dims: { l: 24, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 1);
  assert.equal(output.phaseStats.stackCount, 2);

  const bottoms = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.y;
  }).sort((a, b) => a - b);
  assert.deepEqual(bottoms, [0, 24, 48],
    'stack phase must build supported lower layers before placing higher layers');
});

test('AUTO-PACK-A1-R6.3 stack order supports descending-weight multi-layer stacks', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 96 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 96, z: 12 } }];
  const items = [100, 90, 80, 70].map((weight, index) => ({
    instanceId: `weighted-layer-${index + 1}`,
    weight,
    dims: { l: 24, w: 24, h: 24 },
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4,
    'lighter upper cases should keep stacking when each support is heavier than the case above');
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 3);

  const bottoms = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.y;
  }).sort((a, b) => a - b);
  assert.deepEqual(bottoms, [0, 24, 48, 72],
    'descending-weight stack order should build every lower layer before staging valid upper layers');
});

test('AUTO-PACK-A1-R6.1 solver keeps final validation gate for unsafe packed placements', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(src, /function validatePackedPlacements\(output, packed, zones\)/,
    'solver must keep a final validation sweep before returning live placements');
  assert.match(src, /outside usable zones/,
    'validation gate must reject out-of-zone placements');
  assert.match(src, /overlaps another packed item/,
    'validation gate must reject packed overlaps');
  assert.match(src, /does not have safe stack support/,
    'validation gate must reject floating or unsupported stacks');
  assert.match(src, /output\.unpacked = \[\.\.\.unpacked\];/,
    'validation failures must be staged through the existing unpacked output path');
});

test('AUTO-PACK-A1-R6.3 validation rejects get a strict repack attempt before staging', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(src, /function repackRejectedPlacements\(output, accepted, rejected, zones, loadFrontFirst\)/,
    'solver must include a bounded repack pass for validation rejects');
  assert.match(src, /validatePackedPlacements\(output, packed, floorZones, \{ stageRejected: false \}\)/,
    'initial validation must identify rejected placements before staging them');
  assert.match(src, /repackRejectedPlacements\(\s*output,\s*initialValidation\.accepted,\s*initialValidation\.rejected,/,
    'validation rejects must flow through the repack helper');
  assert.match(src, /const floorPlacement = findFloorPlacement\(item, floorState, repacked, loadFrontFirst\);/,
    'repack must retry floor placement before staging rejected items');
  assert.match(src, /const stackPlacement = findStackPlacement\(item, zones, repacked, loadFrontFirst\);/,
    'repack must retry safe stack placement before staging rejected items');
  assert.match(src, /stageRejectedPlacements\(output, \[\.\.\.staged\.values\(\)\]\);/,
    'only items that still fail validation or repack should be staged');
});

test('AUTO-PACK-A1-R6.3 floor compaction rebuilds free space before filler and stack phases', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(src, /function compactFloorPlacements\(output, packed, zones, loadFrontFirst\)/,
    'solver must keep a dedicated floor compaction pass');
  assert.doesNotMatch(src, /function compactFloorPlacements[\s\S]*?\{\s*void output;\s*void packed;\s*void zones;\s*void loadFrontFirst;/,
    'floor compaction must not regress to the old no-op implementation');
  assert.match(src, /floorState\.freeRects = compactFloorPlacements\(output, packed, floorZones, loadFrontFirst\)\.freeRects;/,
    'compaction must rebuild the free-space map before later placement phases use it');
  assert.match(src, /writeOutputPlacements\(output, packed\);/,
    'accepted compaction moves must be reflected in the solver output maps');
});

test('AUTO-PACK-A1-R6.3 large mixed packs use bounded scaled anchor caps', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(src, /const BASE_ANCHOR_CAP = 18;/,
    'small packs must keep the previous 18-anchor baseline');
  assert.match(src, /const MAX_ANCHOR_CAP = 24;/,
    'large-pack anchor expansion must stay bounded for solver runtime');
  assert.match(src, /function anchorCapForPackedCount\(packed = \[\]\)/,
    'anchor cap must scale from packed count instead of using a fixed magic value');
  assert.match(src, /Math\.min\(MAX_ANCHOR_CAP, BASE_ANCHOR_CAP \+ Math\.floor\(count \/ 30\) \* 2\)/,
    'anchor scaling must ramp gradually for large mixed packs');
  const scaledCapUses = src.match(/capAnchorValues\(anchors, anchorCapForPackedCount\(packed\), scoreAnchor, comparator\)/g) || [];
  assert.equal(scaledCapUses.length, 2,
    'floor and stack anchor builders must both use the scaled bounded cap');
});

test('AUTO-PACK-A1-R6.2 free-space floor pass does not stage an item that fits a remaining floor rectangle', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 72, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 72, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'wide-left', orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 30, h: 24 } },
    { instanceId: 'side-void-fit', orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 18, h: 24 } },
    { instanceId: 'front-a', orientationLocked: true, lockedRotation: {}, dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'front-b', orientationLocked: true, lockedRotation: {}, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 0,
    'free-space floor pass must consume real floor rectangles before stacking');

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(packed[i].min.y, 0);
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false);
    }
  }

  const sideVoid = Solver.getAabb(
    output.placements.get('side-void-fit'),
    {
      l: output.orientedDims.get('side-void-fit').length,
      w: output.orientedDims.get('side-void-fit').width,
      h: output.orientedDims.get('side-void-fit').height,
    }
  );
  assert.equal(sideVoid.min.x, 0,
    'item that exactly fits the side floor void should stay in that void instead of moving forward or staging');
});

test('AUTO-PACK-A1-R6.2 Basic Fit keeps footprint compactness ahead of loadPriority', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 96, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 96, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'large-a', loadPriority: 0, orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'large-b', loadPriority: 0, orientationLocked: true, lockedRotation: {}, dims: { l: 48, w: 24, h: 24 } },
    { instanceId: 'priority-small', loadPriority: 999, orientationLocked: true, lockedRotation: {}, dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 3);
  assert.deepEqual(output.unpacked, []);

  const largeADims = output.orientedDims.get('large-a');
  const largeBDims = output.orientedDims.get('large-b');
  const smallDims = output.orientedDims.get('priority-small');
  const largeA = Solver.getAabb(output.placements.get('large-a'), {
    l: largeADims.length,
    w: largeADims.width,
    h: largeADims.height,
  });
  const largeB = Solver.getAabb(output.placements.get('large-b'), {
    l: largeBDims.length,
    w: largeBDims.width,
    h: largeBDims.height,
  });
  const small = Solver.getAabb(output.placements.get('priority-small'), {
    l: smallDims.length,
    w: smallDims.width,
    h: smallDims.height,
  });
  assert.deepEqual([largeA.min.x, largeB.min.x].sort((a, b) => a - b), [0, 0],
    'larger footprint items should form the rear floor row before a high-priority small case in Basic Fit');
  assert.equal(small.min.x >= 48, true,
    'loadPriority must not be allowed to create a sparse rear floor row in Basic Fit');
});

test('AUTO-PACK-A1-R6.2 long lanes reserve strips without wasting adjacent floor width', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 48, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 120, y: 48, z: 24 } }];
  const items = [
    { instanceId: 'long-truss', dims: { l: 120, w: 12, h: 12 } },
    { instanceId: 'box-a', dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'box-b', dims: { l: 24, w: 24, h: 24 } },
    { instanceId: 'box-c', dims: { l: 24, w: 24, h: 24 } },
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 4);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.laneCount, 1);
  assert.equal(output.phaseStats.floorCount, 3,
    'normal boxes should use the floor width left beside the long lane');

  const packed = items.map(item => {
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(output.placements.get(item.instanceId), {
      l: od.length,
      w: od.width,
      h: od.height,
    });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false);
    }
  }
});

test('AUTO-PACK-A1-R6.2 stack free-space fills the lower support layer before higher layers', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 48, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 48, y: 72, z: 24 } }];
  const items = [
    { instanceId: 'base', weight: 300, dims: { l: 48, w: 48, h: 24 } },
    ...Array.from({ length: 5 }, (_, index) => ({
      instanceId: `top-${index + 1}`,
      weight: 20,
      dims: { l: 24, w: 24, h: 24 },
    })),
  ];

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 6);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.floorCount, 1);
  assert.equal(output.phaseStats.stackCount, 5);

  const topBottoms = items.slice(1).map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.y;
  });
  assert.equal(topBottoms.filter(y => y === 24).length, 4,
    'stack pass should fill all four lower layer cells on the base before using a higher layer');
  assert.equal(topBottoms.filter(y => y === 48).length, 1,
    'only the remaining item should advance to the next stack layer');
});

test('AUTO-PACK-A1-R6.3 floor allocator keeps placeable mixed cases out of staging', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 60, height: 60 };
  const zones = [{ min: { x: 0, y: 0, z: -30 }, max: { x: 120, y: 60, z: 30 } }];
  const dims = [
    [60, 20, 20],
    [60, 20, 20],
    [60, 20, 20],
    [48, 30, 20],
    [12, 20, 12],
    [60, 30, 20],
    [20, 20, 20],
    [60, 20, 20],
    [48, 30, 20],
    [48, 30, 20],
  ];
  const items = dims.map(([l, w, h], index) => ({
    instanceId: `gap-regression-${index + 1}`,
    orientationLocked: true,
    lockedRotation: {},
    dims: { l, w, h },
    weight: 20,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, items.length,
    'free-space allocator must not stage a compatible item when packed-edge floor/stack space remains');
  assert.deepEqual(output.unpacked, []);

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones), true);
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'packed-edge gap refill must not create collisions');
    }
  }
});

test('AUTO-PACK-A1-R6.3 stack surface builder merges adjacent supports into one usable layer', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const supportDims = { l: 24, w: 24, h: 24 };
  const supports = [
    { instanceId: 'support-a', pos: { x: 12, y: 12, z: -12 } },
    { instanceId: 'support-b', pos: { x: 36, y: 12, z: -12 } },
    { instanceId: 'support-c', pos: { x: 12, y: 12, z: 12 } },
    { instanceId: 'support-d', pos: { x: 36, y: 12, z: 12 } },
  ].map(support => ({
    instanceId: support.instanceId,
    item: { item: { weight: 100 } },
    aabb: Solver.getAabb(support.pos, supportDims),
  }));

  const rects = Solver.buildStackLayerFreeRects(supports, 24);
  assert.equal(rects.some(rect =>
    rect.minX === 0 &&
    rect.maxX === 48 &&
    rect.minZ === -24 &&
    rect.maxZ === 24
  ), true,
  'stack phase must see adjacent same-height support cases as one usable supported surface');
});

test('AUTO-PACK-A1-R6.4 repeated non-flippable cases use one shelf-grid orientation', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98 };
  const zones = [{ min: { x: 0, y: 0, z: -51 }, max: { x: 636, y: 98, z: 51 } }];
  const items = Array.from({ length: 78 }, (_, index) => ({
    instanceId: `repeated-panel-${index + 1}`,
    caseId: 'wide-flat-scenic-panel',
    dims: { l: 60, w: 20, h: 20 },
    weight: 180,
    canFlip: false,
    stackable: true,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 78);
  assert.deepEqual(output.unpacked, []);

  const distinctDims = new Set([...output.orientedDims.values()].map(dims => JSON.stringify(dims)));
  assert.equal(distinctDims.size, 1,
    'large repeated non-flippable batches should not mix yaw orientations in a patchwork load');
  assert.deepEqual(JSON.parse([...distinctDims][0]), { length: 60, width: 20, height: 20 },
    'batch shelf-grid should choose the orientation that maximizes clean floor capacity');

  const packed = items.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
  });
  for (let i = 0; i < packed.length; i++) {
    assert.equal(Solver.isAabbContainedInAnyZone(packed[i], zones, 0.001), true,
      'repeated shelf-grid placements must stay fully inside the trailer AABB');
    for (let j = i + 1; j < packed.length; j++) {
      assert.equal(Solver.aabbsOverlap(packed[i], packed[j]), false,
        'repeated shelf-grid placements must not overlap');
    }
  }

  const floorLayer = packed.filter(aabb => aabb.min.y === 0);
  assert.equal(floorLayer.length, 50,
    'repeated 60x20x20 cases should fill a 10 by 5 floor grid before stacking');
  const firstColumnCenters = items.slice(0, 5).map(item => output.placements.get(item.instanceId));
  assert.deepEqual(firstColumnCenters.map(pos => pos.x), [30, 30, 30, 30, 30],
    'batch grid should fill width at the current load-side X slice before advancing length');
  assert.deepEqual(firstColumnCenters.map(pos => pos.z), [-41, -21, -1, 19, 39],
    'batch grid should create contiguous width rows without midpoint gaps');
});

test('AUTO-PACK-A1-R6.4 repeated batch compaction does not break shelf rows', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98 };
  const zones = [{ min: { x: 0, y: 0, z: -51 }, max: { x: 636, y: 98, z: 51 } }];
  const items = Array.from({ length: 78 }, (_, index) => ({
    instanceId: `flat-panel-${index + 1}`,
    caseId: 'flat-panel',
    dims: { l: 48, w: 24, h: 24 },
    weight: 80,
    canFlip: false,
    stackable: true,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 78);
  assert.deepEqual(output.unpacked, []);

  const firstRow = items.slice(0, 4).map(item => output.placements.get(item.instanceId));
  assert.deepEqual(firstRow.map(pos => pos.x), [24, 24, 24, 24]);
  assert.deepEqual(firstRow.map(pos => pos.z), [-39, -15, 9, 33],
    'floor compaction must not split a deterministic repeated-case row');
  assert.equal(output.phaseStats.floorCount, 52);
  assert.equal(output.phaseStats.stackCount, 26);
});

test('AUTO-PACK-A1-R6.5 repeated flippable flat panels prefer low shelf orientation when the batch fits', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 636, width: 102, height: 98 };
  const zones = [{ min: { x: 0, y: 0, z: -51 }, max: { x: 636, y: 98, z: 51 } }];
  const items = Array.from({ length: 36 }, (_, index) => ({
    instanceId: `wide-flat-panel-${index + 1}`,
    caseId: 'wide-flat-panel',
    dims: { l: 70, w: 24, h: 10 },
    weight: 180,
    canFlip: true,
    stackable: true,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items });
  assert.equal(output.placements.size, 36);
  assert.deepEqual(output.unpacked, []);
  assert.equal(output.phaseStats.stackCount, 0,
    'a repeated flat-panel batch that fits on the floor should not stand panels upright or stack them');

  for (const item of items) {
    const orientedDims = output.orientedDims.get(item.instanceId);
    assert.deepEqual(orientedDims, { length: 70, width: 24, height: 10 },
      'repeated flippable flat panels should stay in the low shelf orientation when the full batch fits');
    const aabb = Solver.getAabb(output.placements.get(item.instanceId), {
      l: orientedDims.length,
      w: orientedDims.width,
      h: orientedDims.height,
    });
    assert.equal(Solver.isAabbContainedInAnyZone(aabb, zones, 0.001), true,
      'flat-panel shelf placements must remain fully inside the trailer');
  }
});

test('AUTO-PACK-A1-R6.5 repeated same-footprint heavy groups reserve floor before light groups', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 130, width: 100, height: 100 };
  const zones = [{ min: { x: 0, y: 0, z: -50 }, max: { x: 130, y: 100, z: 50 } }];
  const heavyItems = Array.from({ length: 8 }, (_, index) => ({
    instanceId: `heavy-cube-${index + 1}`,
    caseId: 'heavy-cube',
    dims: { l: 24, w: 24, h: 24 },
    weight: 300,
    canFlip: false,
  }));
  const lightItems = Array.from({ length: 8 }, (_, index) => ({
    instanceId: `light-cube-${index + 1}`,
    caseId: 'light-cube',
    dims: { l: 24, w: 24, h: 24 },
    weight: 10,
    canFlip: false,
  }));

  const output = Solver.solveAutoPack({ truck, zones, items: [...lightItems, ...heavyItems] });
  assert.equal(output.placements.size, 16);
  assert.deepEqual(output.unpacked, []);

  const heavyMaxX = Math.max(...heavyItems.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).max.x;
  }));
  const lightMinX = Math.min(...lightItems.map(item => {
    const pos = output.placements.get(item.instanceId);
    const od = output.orientedDims.get(item.instanceId);
    return Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }).min.x;
  }));

  assert.ok(heavyMaxX <= lightMinX + 0.001,
    'same-footprint repeated heavy groups should occupy the load-side floor before lighter groups');
});

test('AUTO-PACK-A1-R6 live AutoPack routes through the logistics solver from the runtime engine only', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const legacySrc = await fs.readFile(autoPackLegacySolverPath, 'utf8');

  assert.doesNotMatch(appSrc, /autopack-solver\.js|solveAutoPack/,
    'app.js must stay an orchestrator consumer and must not import the solver directly');
  assert.match(engineSrc, /import \{ solveAutoPack \} from '\.\/autopack-solver\.js';/,
    'A1-R6 must wire the pure logistics solver through the runtime engine');
  assert.match(engineSrc, /const solverResult = solveAutoPack\(\{/,
    'runtime AutoPack must call the logistics solver for live placement');
  assert.doesNotMatch(engineSrc, /solveLegacyAutoPack\(/,
    'A1-R6 must not keep calling the legacy placement solver');
  assert.match(legacySrc, /function buildOrientations\(dims, caseData, inst, orientationTools\)/,
    'A1-R6 must leave the legacy solver file in place until browser proof is complete');
  assert.match(legacySrc, /const X_TIGHTNESS_WEIGHT = 0\.8;/,
    'A1-R6 must not delete the legacy scoring path before A1-R7 cleanup approval');
  assert.match(legacySrc, /function capXAnchorsSorted\(arr, maxCount\)/,
    'A1-R6 must leave the legacy anchor scanner available for rollback until browser proof is complete');
  assert.match(legacySrc, /for \(const placementPass of placementPasses\)/,
    'A1-R6 must leave the legacy AutoPack pass loop untouched until A1-R7 cleanup approval');
});

test('AUTO-PACK-A1-R6 live adapter preserves runtime gates, zones, and orientation metadata', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  assert.match(engineSrc, /getProRuleSet\(_bs, activeRole\)/,
    'A1-R6 must preserve the billing/pro gate in the runtime engine');
  assert.match(engineSrc, /const isWorkspaceRunStale = \(\) => runWorkspaceGeneration !== workspaceGeneration;/,
    'A1-R6 must preserve the stale-run guard');
  assert.match(engineSrc, /const zones = TrailerGeometry\.getTrailerUsableZones\(truck\);/,
    'A1-R6 must continue using TrailerGeometry as the single usable-zone source');
  assert.match(engineSrc, /stageInstant\(stagingMap\);/,
    'A1-R6 must preserve pre-run staging before solver placement');
  assert.match(engineSrc, /animatePlacements\(\s*placements,\s*rotations,\s*orientedDimsMap,/,
    'A1-R6 must keep the existing animation path');
  assert.match(engineSrc, /PackLibrary\.update\(packId, \{ cases: nextCases \}\);/,
    'A1-R6 must keep the existing persistence path');
  assert.match(engineSrc, /orientationLocked: inst\.orientationLocked,/,
    'A1-R6 must pass manual orientation lock state to the logistics solver');
  assert.match(engineSrc, /lockedRotation: inst\.lockedRotation,/,
    'A1-R6 must pass locked rotations to the logistics solver');
  assert.match(engineSrc, /orientedDims: inst\.orientedDims,/,
    'A1-R6 must pass oriented dimensions to the logistics solver');
});

test('AUTO-PACK-A1-CLEAN-1 app keeps legacy scanner isolated outside app.js', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const legacySrc = await fs.readFile(autoPackLegacySolverPath, 'utf8');

  assert.match(engineSrc, /import \{ buildLegacyAutoPackItems \} from '\.\/autopack-legacy-solver\.js';/,
    'the AutoPack runtime may use the temporary legacy item adapter before A1-R7 cleanup');
  assert.doesNotMatch(engineSrc, /solveLegacyAutoPack\(/,
    'the AutoPack runtime must not use the legacy placement solver after A1-R6');
  assert.doesNotMatch(appSrc, /function buildOrientations\(dims, caseData, inst/,
    'app.js must not keep legacy orientation generation inline');
  assert.doesNotMatch(appSrc, /function findRestingY\(cx, cz, halfL, halfW, packed\)/,
    'app.js must not keep legacy gravity placement inline');
  assert.doesNotMatch(appSrc, /function capXAnchorsSorted\(arr, maxCount\)/,
    'app.js must not keep the legacy X-anchor scanner inline');
  assert.doesNotMatch(appSrc, /const X_TIGHTNESS_WEIGHT = 0\.8;/,
    'app.js must not carry the legacy scoring constant inline');
  assert.match(legacySrc, /function buildOrientations\(dims, caseData, inst, orientationTools\)/,
    'the legacy solver module must preserve the old orientation behavior during the extraction');
  assert.match(legacySrc, /const X_TIGHTNESS_WEIGHT = 0\.8;/,
    'the legacy solver module must preserve the old scoring behavior during the extraction');
  assert.doesNotMatch(legacySrc, /\b(?:getBillingState|getProRuleSet|UIComponents|StateStore|Supabase|Stripe)\b/,
    'the legacy solver must stay isolated from billing, auth, UI, and app state orchestration');
});

test('AUTO-PACK-A1-CLEAN-2 app delegates AutoPack runtime without carrying orchestration inline', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');

  assert.match(appSrc, /import \{ createAutoPackEngine \} from '\.\/services\/autopack-engine\.js';/,
    'app.js must import the AutoPack runtime factory');
  assert.match(appSrc, /const AutoPackEngine = createAutoPackEngine\(\{/,
    'app.js must construct AutoPack through the runtime factory');
  assert.doesNotMatch(appSrc, /function buildStagingMap\(packItems, truck\)/,
    'app.js must not keep AutoPack staging inline');
  assert.doesNotMatch(appSrc, /function animatePlacements\(placements, rotations, orientedDimsMap/,
    'app.js must not keep AutoPack animation inline');
  assert.doesNotMatch(appSrc, /const legacyResult = await solveLegacyAutoPack\(\{/,
    'app.js must not call the legacy solver directly after A1-CLEAN-2');
  assert.match(engineSrc, /export function createAutoPackEngine\(\{/,
    'the runtime module must expose the AutoPack engine factory');
  assert.match(engineSrc, /capturePackPreview\(packId, \{ source: 'auto' \}\);/,
    'the runtime module must preserve preview capture after AutoPack');
  assert.match(engineSrc, /PackLibrary\.update\(packId, \{ cases: nextCases \}\);/,
    'the runtime module must preserve pack persistence');
});

test('AUTO-PACK-A0 orientation lock helpers normalize rotation and compute oriented dimensions', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { length: 48, width: 24, height: 30 };

  assert.deepEqual(
    PackLibrary.getOrientedDimsForRotation(dims, { x: 0, y: Math.PI / 2, z: 0 }),
    { length: 24, width: 48, height: 30 },
    'Y-locked orientation must swap truck length/width extents'
  );
  assert.deepEqual(
    PackLibrary.getOrientedDimsForRotation(dims, { x: Math.PI / 2, y: 0, z: 0 }),
    { length: 48, width: 30, height: 24 },
    'X-locked orientation must move original width into height'
  );

  const patch = PackLibrary.createOrientationLockPatch({ x: 0, y: Math.PI / 2, z: 0 }, dims);
  assert.equal(patch.orientationLocked, true);
  assert.deepEqual(patch.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 });
  assert.deepEqual(patch.orientedDims, { length: 24, width: 48, height: 30 });
  assert.deepEqual(
    PackLibrary.clearOrientationLockPatch(),
    { orientationLocked: false, lockedRotation: null, orientedDims: null },
    'reset data support must clear the orientation lock contract'
  );
});

test('AUTO-PACK-A0 manual editor rotate and flip paths set per-instance orientation locks', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const rotateStart = src.indexOf('function rotateSelection(axis, delta)');
  const rotateEnd = src.indexOf('/**\n     * Nudge selected instances', rotateStart);
  const rotateBlock = rotateStart >= 0 && rotateEnd > rotateStart ? src.slice(rotateStart, rotateEnd) : '';
  const multiStart = src.indexOf('function renderMultiInspector(pack, selected)');
  const multiEnd = src.indexOf('// === Actions Card ===', multiStart);
  const multiBlock = multiStart >= 0 && multiEnd > multiStart ? src.slice(multiStart, multiEnd) : '';
  const singleStart = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)');
  const singleEnd = src.indexOf('\n    /**\n     * Creates a card header row', singleStart);
  const singleBlock = singleStart >= 0 && singleEnd > singleStart ? src.slice(singleStart, singleEnd) : '';

  assert.match(src, /function createManualOrientationLockPatch\(PackLibrary, CaseLibrary, inst, rotation\)/,
    'editor must have a narrow helper for manual orientation locks');
  assert.match(rotateBlock, /createManualOrientationLockPatch\(PackLibrary, CaseLibrary, inst, rot\)/,
    'keyboard rotate/flip path must lock manual orientation');
  assert.match(multiBlock, /rotateSelection\(axis,\s*delta\)/,
    'multi-select Rotate All must route through rotateSelection (not direct PackLibrary.updateInstance per item)');
  assert.match(singleBlock, /rotateSelection\(axis,\s*delta\)/,
    'single inspector Rotate/Flip must route through rotateSelection (not a deferred rAF+direct-persist path)');
  assert.match(singleBlock, /TODO\(AUTO-PACK-A0\): when reset-orientation UI is added, apply PackLibrary\.clearOrientationLockPatch\(\)/,
    'no reset UI exists yet, so reset support must remain documented without broad UI changes');
});

test('EDITOR selection Actions cards stay minimal, ordered, and bound to existing workflows', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const selectAllStart = src.indexOf('function selectAllCases(pack)');
  const selectAllEnd = src.indexOf('function makeSelectAllButton(pack', selectAllStart);
  const selectAllBlock = selectAllStart >= 0 && selectAllEnd > selectAllStart
    ? src.slice(selectAllStart, selectAllEnd)
    : '';
  const makeSelectStart = src.indexOf('function makeSelectAllButton(pack');
  const makeSelectEnd = src.indexOf('function renderTruckInspector(pack, prefs)', makeSelectStart);
  const makeSelectBlock = makeSelectStart >= 0 && makeSelectEnd > makeSelectStart
    ? src.slice(makeSelectStart, makeSelectEnd)
    : '';
  const truckStart = src.indexOf('function renderTruckInspector(pack, prefs)');
  const truckEnd = src.indexOf('function renderMultiInspector(pack, selected)', truckStart);
  const truckBlock = truckStart >= 0 && truckEnd > truckStart ? src.slice(truckStart, truckEnd) : '';
  const multiStart = src.indexOf('function renderMultiInspector(pack, selected)');
  const multiEnd = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)', multiStart);
  const multiBlock = multiStart >= 0 && multiEnd > multiStart ? src.slice(multiStart, multiEnd) : '';
  const singleStart = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)');
  const singleEnd = src.indexOf('\n    /**\n     * Creates a card header row', singleStart);
  const singleBlock = singleStart >= 0 && singleEnd > singleStart ? src.slice(singleStart, singleEnd) : '';

  assert.match(selectAllBlock, /InteractionManager\.selectAllInPack\(\)/,
    'Actions Select All must reuse the existing InteractionManager selection path');
  assert.match(makeSelectBlock, /label: 'Select All'[\s\S]*iconHtml: selectAllIconSvg\(\)/,
    'multi-select Actions card must render the custom stacked-select icon with Select All');
  assert.match(makeSelectBlock, /selectedCount\s*>=\s*totalCount/,
    'Select All should disable itself once the full pack is already selected');
  assert.match(makeSelectBlock, /function makeActionButton\(\{ label,/,
    'Actions buttons must share one equal-width button helper');
  const css = await fs.readFile(stylesMainPath, 'utf8');
  assert.match(css, /\.tp3d-editor-action-grid \.btn\s*\{[\s\S]*width: 100%[\s\S]*justify-content: center[\s\S]*min-width: 0[\s\S]*\}/,
    'Actions buttons must be equal-width and centered via the shared tp3d-editor-action-grid .btn rule');
  assert.match(css, /\.tp3d-editor-action-grid\s*\{[\s\S]*display: grid[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]*\}/,
    'Actions cards must use an equal two-column layout via the shared tp3d-editor-action-grid rule');
  assert.match(multiBlock, /actRow\.className = 'tp3d-editor-action-grid'/,
    'multi-select Actions card must apply the tp3d-editor-action-grid layout class');
  assert.match(singleBlock, /actRow\.className = 'tp3d-editor-action-grid'/,
    'single-item Actions card must apply the tp3d-editor-action-grid layout class');
  assert.match(makeSelectBlock, /function makeVisibilityButton\(pack, selectedIds\)[\s\S]*instances\.every\(inst => inst\.hidden === true\)[\s\S]*label: showSelection \? 'Show' : 'Hide'[\s\S]*hidden: !showSelection/,
    'Actions cards must use one consistent Show/Hide toggle based on selected hidden state');
  assert.match(makeSelectBlock, /function duplicateAabbIntersects\(a,\s*b\)[\s\S]*a\.min\.x < b\.max\.x - EPS[\s\S]*a\.max\.z > b\.min\.z \+ EPS/,
    'Actions Duplicate must use an AABB collision guard before saving clones');
  assert.match(makeSelectBlock, /function isDuplicateInsideTruck\(pack,\s*aabb\)[\s\S]*TrailerGeometry\.getTrailerUsableZones\(pack\.truck\)[\s\S]*TrailerGeometry\.isAabbContainedInAnyZone\(aabb,\s*zones\)/,
    'Actions Duplicate must use existing TrailerGeometry usable zones for inside-truck checks');
  assert.match(makeSelectBlock, /function findDuplicateOffset\(pack,\s*payload,\s*existingAabbs\)[\s\S]*duplicateOffsetIsSafe\(pack,\s*payload,\s*existingAabbs,\s*offset,\s*true\)[\s\S]*duplicateOffsetIsSafe\(pack,\s*payload,\s*existingAabbs,\s*offset,\s*false\)/,
    'Actions Duplicate must try safe in-truck placement first, then collision-free staging');
  assert.doesNotMatch(makeSelectBlock, /position:\s*\{\s*x:\s*pos\.x \+ 12,\s*y:\s*pos\.y,\s*z:\s*pos\.z \+ 12/,
    'Actions Duplicate must not use the old fixed +12 inch offset that can overlap selected boxes');
  assert.doesNotMatch(src, /function deleteAllCases|Delete All|renderPackActionsCard/,
    'editor must not add a separate Delete All path or no-selection Actions card');
  assert.doesNotMatch(truckBlock, /makeSelectAllButton|Actions/,
    'truck inspector must stay focused on truck editing and stats');
  assert.match(multiBlock, /const btnSelectAll = makeSelectAllButton\(pack,\s*selected\.length\)/,
    'multi-select Actions card must include Select All');
  assert.match(multiBlock, /InteractionManager\.deleteSelection\(\)/,
    'multi-select Delete must keep using the existing selected-delete binding');
  assert.match(multiBlock, /const btnDuplicate = makeActionButton\(\{[\s\S]*onClick: \(\) => duplicateSelection\(pack,\s*selected\)/,
    'multi-select Duplicate must use the shared duplicate helper');
  assert.match(multiBlock, /const btnClear = makeActionButton\(\{[\s\S]*onClick: \(\) => InteractionManager\.setSelection\(\[\]\)/,
    'multi-select Deselect must clear both state and scene selection through InteractionManager');
  assert.doesNotMatch(multiBlock, /const btnShow|const btnHide/,
    'multi-select Actions must use one visibility toggle instead of separate Show and Hide buttons');
  assert.match(multiBlock,
    /actRow\.appendChild\(btnSetCategory\);[\s\S]*actRow\.appendChild\(btnVisibility\);[\s\S]*actRow\.appendChild\(btnSelectAll\);[\s\S]*actRow\.appendChild\(btnClear\);[\s\S]*actRow\.appendChild\(btnDuplicate\);[\s\S]*actRow\.appendChild\(btnDelete\);/,
    'multi-select Actions order must be Set Category, Show/Hide, Select All, Deselect, Duplicate, Delete');
  assert.match(singleBlock, /const selectAll = makeSelectAllButton\(pack,\s*1\)/,
    'single-item Actions card must include Select All through the shared helper');
  assert.match(singleBlock, /const setCategory = makeActionButton\(\{[\s\S]*onClick: \(\) => openSetCategoryModal\(pack,\s*\[inst\.id\]\)/,
    'single-item Set Category must reuse the shared category modal');
  assert.match(singleBlock, /const visibility = makeVisibilityButton\(pack,\s*\[inst\.id\]\)/,
    'single-item Actions must use the same Show/Hide toggle helper as multi-select');
  assert.match(singleBlock, /const duplicate = makeActionButton\(\{[\s\S]*onClick: \(\) => duplicateSelection\(pack,\s*\[inst\.id\]\)/,
    'single-item Duplicate must use the shared duplicate helper');
  assert.doesNotMatch(singleBlock, /const show|const hide/,
    'single-item Actions must use one visibility toggle instead of separate Show and Hide buttons');
  assert.match(singleBlock,
    /actRow\.appendChild\(setCategory\);[\s\S]*actRow\.appendChild\(visibility\);[\s\S]*actRow\.appendChild\(selectAll\);[\s\S]*actRow\.appendChild\(clear\);[\s\S]*actRow\.appendChild\(duplicate\);[\s\S]*actRow\.appendChild\(deleteButton\);/,
    'single-item Actions order must be Set Category, Show/Hide, Select All, Deselect, Duplicate, Delete');
  assert.doesNotMatch(singleBlock, /Unhide|Remove/,
    'single-item Actions must avoid ambiguous Unhide/Remove labels');
});

test('EDITOR inspector unit labels follow preferences and repaint on preference changes', async () => {
  const [editorSrc, appSrc] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
  ]);
  const truckStart = editorSrc.indexOf('function renderTruckInspector(pack, prefs)');
  const truckEnd = editorSrc.indexOf('function renderMultiInspector(pack, selected)', truckStart);
  const truckBlock = truckStart >= 0 && truckEnd > truckStart ? editorSrc.slice(truckStart, truckEnd) : '';
  const singleStart = editorSrc.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)');
  const singleEnd = editorSrc.indexOf('\n    /**\n     * Creates a card header row', singleStart);
  const singleBlock = singleStart >= 0 && singleEnd > singleStart ? editorSrc.slice(singleStart, singleEnd) : '';
  const prefStart = appSrc.indexOf('if (changes.preferences || changes._undo || changes._redo || changes._replace)');
  const prefEnd = appSrc.indexOf('if (changes.currentScreen || changes._replace)', prefStart);
  const prefBlock = prefStart >= 0 && prefEnd > prefStart ? appSrc.slice(prefStart, prefEnd) : '';

  assert.match(editorSrc, /function getLengthUnit\(prefs\)[\s\S]*return prefs && prefs\.units && prefs\.units\.length \? prefs\.units\.length : 'in'/,
    'editor inspector must use a safe length-unit helper');
  assert.match(editorSrc, /function displayLengthToInches\(value,\s*fallbackInches,\s*unit\)[\s\S]*Utils\.unitToInches\(n,\s*unit \|\| 'in'\)/,
    'editor inspector must convert displayed values back to internal inches before save');
  assert.match(truckBlock, /const lengthUnit = getLengthUnit\(prefs\)/,
    'truck inspector must derive its display unit from preferences');
  assert.match(truckBlock, /smallField\(`Length \(\$\{lengthUnit\}\)`,\s*Utils\.inchesToUnit\(pack\.truck\.length,\s*lengthUnit\)\)/,
    'truck length field must display the active length unit');
  assert.match(truckBlock, /length:\s*Math\.max\(24,\s*displayLengthToInches\(fL\.input\.value,\s*pack\.truck\.length,\s*lengthUnit\)\)/,
    'truck length save must convert the displayed unit back to inches');
  assert.match(truckBlock, /smallField\(`Length \(\$\{lengthUnit\}\)`,\s*Utils\.inchesToUnit\(bonusLength,\s*lengthUnit\)\)/,
    'front overhang config fields must display the active length unit');
  assert.match(truckBlock, /wellOffsetFromRear:\s*Utils\.clamp\(displayLengthToInches\(fWO\.input\.value,\s*wellOffset,\s*lengthUnit\)/,
    'wheel well config fields must save active-unit values back to inches');
  assert.doesNotMatch(truckBlock, /smallField\('Length \(in\)'|smallField\('Width \(in\)'|smallField\('Height \(in\)'/,
    'truck inspector must not hardcode inch labels');
  assert.match(singleBlock, /sub\.textContent = `\$\{mfg\} • \$\{Utils\.formatDims\(d,\s*lengthUnit\)\}`/,
    'selected case subtitle must use the active length unit');
  assert.match(singleBlock, /inlinePositionField\('X',\s*lengthUnit,\s*Utils\.inchesToUnit\(pos\.x,\s*lengthUnit\)\)/,
    'position inputs must use compact inline fields with active-unit values');
  assert.match(prefBlock, /if \(StateStore\.get\('currentScreen'\) === 'editor'\) EditorUI\.render\(\);/,
    'preference changes must immediately re-render the editor inspector');
});

test('PREFERENCES remove millimeter selection and use hidden-opacity slider', async () => {
  const [settingsSrc, indexSrc, appSrc, utilsSrc, utilsIndexSrc] = await Promise.all([
    fs.readFile(settingsOverlayPath, 'utf8'),
    fs.readFile(indexHtmlPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(coreUtilsPath, 'utf8'),
    fs.readFile(coreUtilsIndexPath, 'utf8'),
  ]);
  const { normalizePreferences } = await import(
    `${normalizerPath.href}?t=${Date.now()}-${Math.random()}`
  );
  const normalized = normalizePreferences({ units: { length: 'mm', weight: 'lb' } });

  assert.doesNotMatch(settingsSrc, /Millimeters|value="mm"|value='mm'/,
    'active settings overlay must not offer millimeters as a length preference');
  assert.doesNotMatch(indexSrc, /Millimeters|value="mm"|value='mm'/,
    'legacy settings markup must not expose a stale millimeter option');
  assert.match(utilsSrc, /export const lengthUnits = \['in', 'ft', 'cm', 'm'\]/,
    'primary utility length units must exclude mm from selectable preferences');
  assert.match(utilsIndexSrc, /export const lengthUnits = \['in', 'ft', 'cm', 'm'\]/,
    'stable utility index length units must exclude mm from selectable preferences');
  assert.match(utilsSrc, /case 'mm':[\s\S]*inches \* 25\.4[\s\S]*case 'mm':[\s\S]*value \/ 25\.4/,
    'mm conversion support must remain for old imported or persisted values');
  assert.notEqual(normalized.units.length, 'mm',
    'normalization must not preserve mm as an active preference');
  assert.match(settingsSrc, /hiddenOpacity\.type = 'range'[\s\S]*hiddenOpacity\.min = '0'[\s\S]*hiddenOpacity\.max = '1'[\s\S]*hiddenOpacity\.step = '0\.05'/,
    'active settings overlay must render hidden opacity as a 0-1 range slider');
  assert.match(settingsSrc, /hiddenOpacityValue\.textContent = Number\(hiddenOpacity\.value\)\.toFixed\(2\)/,
    'hidden opacity slider must show its current numeric value');
  assert.match(indexSrc, /id="pref-hidden-opacity" type="range" min="0" max="1" step="0\.05"/,
    'legacy settings markup must also use a range slider for hidden opacity');
  assert.match(indexSrc, /id="pref-hidden-opacity-value"[\s\S]*0\.30/,
    'legacy settings markup must show the hidden opacity value beside the slider');
  assert.match(appSrc, /const elHiddenValue[\s\S]*document\.getElementById\('pref-hidden-opacity-value'\)/,
    'legacy settings controller must bind the hidden opacity value readout');
  assert.match(appSrc, /elHidden\.addEventListener\('input', syncHiddenOpacityValue\)/,
    'hidden opacity readout must update while the slider moves');
  assert.match(appSrc, /elHiddenValue\.textContent = Number\(elHidden\.value\)\.toFixed\(2\)/,
    'legacy settings controller must format the hidden opacity readout consistently');
});

test('EDITOR Case Browser New Case shortcut uses shared modal without adding to pack', async () => {
  const [editorSrc, casesSrc, modalSrc, stylesSrc] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(casesScreenPath, 'utf8'),
    fs.readFile(caseModalPath, 'utf8'),
    fs.readFile(stylesMainPath, 'utf8'),
  ]);
  const editorModalStart = editorSrc.indexOf('function openEditorNewCaseModal()');
  const editorModalEnd = editorSrc.indexOf('function setCaseFiltersVisible', editorModalStart);
  const editorModalBlock = editorModalStart >= 0 && editorModalEnd > editorModalStart
    ? editorSrc.slice(editorModalStart, editorModalEnd)
    : '';

  assert.match(casesSrc, /import \{ openCaseModal as openSharedCaseModal \} from '\.\.\/ui\/overlays\/case-modal\.js'/,
    'Cases page must use the shared Case modal implementation');
  assert.match(editorSrc, /import \{ openCaseModal as openSharedCaseModal \} from '\.\.\/ui\/overlays\/case-modal\.js'/,
    'Editor Case Browser shortcut must use the shared Case modal implementation');
  assert.match(editorSrc, /btnNewCase\.setAttribute\('data-role', 'editor-new-case'\)[\s\S]*openEditorNewCaseModal\(\)/,
    'Editor Case Browser must expose a New Case shortcut button');
  assert.match(editorSrc, /const browserControlsHost = caseSearchEl \? caseSearchEl\.closest\('\.tp3d-editor-case-search'\) : null/,
    'Editor Case Browser tabs must be anchored in the sticky search block');
  assert.doesNotMatch(editorSrc, /caseListEl\.parentElement\.insertBefore\(tabsEl, caseListEl\)/,
    'Editor Case Browser tabs must not be injected into the scrollable case list');
  assert.match(editorSrc, /btnNewCase\.setAttribute\('aria-label', 'New case'\)[\s\S]*btnNewCase\.innerHTML = '<i class="fa-solid fa-plus"><\/i>'/,
    'Editor New Case shortcut must remain icon-only with an accessible label');
  assert.doesNotMatch(editorSrc, /tp3d-editor-browser-tabs-spacer/,
    'Editor Case Browser toolbar must not include a spacer that pushes the New Case button away');
  assert.doesNotMatch(stylesSrc, /\.tp3d-editor-browser-tabs-spacer/,
    'stale Case Browser toolbar spacer CSS must be removed');
  assert.match(stylesSrc, /\.tp3d-editor-new-case-btn \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*justify-content: center;/,
    'Editor New Case icon-only button must be visually centered');
  assert.match(editorModalBlock, /openSharedCaseModal\(\{[\s\S]*onSaved: \(\) => \{[\s\S]*caseSearchEl\.value = ''[\s\S]*browserCats\.clear\(\)[\s\S]*caseBrowserGroupBy = 'category'[\s\S]*renderCaseBrowser\(\)/,
    'saving a case from the editor must refresh and reveal it in the Case Browser');
  assert.doesNotMatch(editorModalBlock, /addCaseToPack|PackLibrary\.add|PackLibrary\.update\(/,
    'Editor New Case shortcut must not add the new case to the current pack');
  assert.match(modalSrc, /export function formatCaseModalNumber\(value, unit\)[\s\S]*m: 4/,
    'shared Case modal must use unit-aware numeric formatting');
  assert.match(modalSrc, /fL\.input\.value = formatCaseModalNumber\(Utils\.inchesToUnit\(initial\.dimensions\.length, lengthUnit\), lengthUnit\)/,
    'Case modal length input must avoid raw floating-point conversion strings');
  assert.doesNotMatch(modalSrc, /String\(Utils\.inchesToUnit/,
    'Case modal must not write raw conversion values directly into number inputs');
  assert.match(modalSrc, /CategoryService\.listWithCounts\(CaseLibrary\.getCases\(\)\)/,
    'shared Case modal must load project-aware categories from the case library, including imported categories');
  assert.doesNotMatch(modalSrc, /const catOptions = CategoryService\.all\(\)/,
    'shared Case modal must not be limited to default or preference-only categories');
  assert.match(modalSrc, /catSelect\.value = catOptions\.some\(c => c\.key === desiredKey\) \? desiredKey : 'default'/,
    'shared Case modal must preserve a current category when it exists in project categories');
  assert.match(modalSrc, /catColorInput\.type = 'color'[\s\S]*catColorInput\.setAttribute\('aria-label', 'Category color'\)/,
    'shared Case modal category swatch must expose a real color input');
  assert.match(modalSrc, /CategoryService\.upsert\(\{ key: categoryKey, name: catMeta\.name, color: categoryColor \}\)/,
    'shared Case modal must persist edited category colors through CategoryService');
  assert.match(modalSrc, /color: categoryColor/,
    'saved case data must use the edited category color');
  assert.doesNotMatch(modalSrc, /tp3d-cases-new-category-toggle|New category'/,
    'shared Case modal must not render a redundant New category toggle above the add row');
  assert.match(modalSrc, /newCatName\.placeholder = 'Add New Category Name'/,
    'shared Case modal new category row must use clear placeholder copy');
  assert.match(modalSrc, /newCatSave\.innerHTML = '<i class="fa-solid fa-plus"><\/i> Add'/,
    'shared Case modal new category row must keep a single explicit + Add action');
  assert.match(modalSrc, /newCatColorSwatch\.classList\.add\('tp3d-cases-cat-swatch'\)[\s\S]*newCatColor\.className = 'tp3d-cases-cat-color-input'/,
    'shared Case modal new category color must reuse the standard category swatch style');
  assert.doesNotMatch(stylesSrc, /tp3d-cases-new-category-toggle|tp3d-cases-color-btn/,
    'stale category toggle and raw color button CSS must be removed');
  assert.match(modalSrc, /findDuplicateCategory\(nextName\)[\s\S]*Category "\$\{duplicate\.name\}" already exists/,
    'shared Case modal must warn instead of creating duplicate categories');
  assert.match(casesSrc, /function findDuplicateCategoryName\(name, excludeKey = ''\)/,
    'Cases screen category editing must share an explicit duplicate-category guard');
  assert.match(casesSrc, /colorWrap\.classList\.add\('tp3d-cases-cat-swatch'\)[\s\S]*color\.className = 'tp3d-cases-cat-color-input'/,
    'category edit modal must reuse the standard category swatch style');
  assert.match(casesSrc, /colorWrap\.classList\.add\('tp3d-cases-cat-swatch', 'tp3d-cases-catmgr-color-wrap'\)[\s\S]*color\.className = 'tp3d-cases-cat-color-input'/,
    'category manager color pickers must reuse the standard category swatch style');
  assert.match(editorSrc, /colorWrap\.classList\.add\('tp3d-cases-cat-swatch'\)[\s\S]*colorInput\.className = 'tp3d-cases-cat-color-input'/,
    'editor Set Category color picker must reuse the standard category swatch style');
  assert.match(casesSrc, /findDuplicateCategoryName\(nextName, initial\.key\)[\s\S]*Category "\$\{duplicate\.name\}" already exists/,
    'category edit modal must block duplicate renames with a warning');
  assert.match(casesSrc, /findDuplicateCategoryName\(name\.value, cat\.key\)[\s\S]*Category "\$\{duplicate\.name\}" already exists/,
    'category manager rows must block duplicate renames with a warning');
  assert.match(casesSrc, /CategoryService\.listWithCounts\(CaseLibrary\.getCases\(\)\)\.forEach\(cat => \{/,
    'category manager must include imported/project categories, not only preference defaults');
});

test('CASE filters normalize imported category keys before matching cases', async () => {
  const src = await fs.readFile(caseLibraryPath, 'utf8');

  assert.match(src, /function normalizeCategoryFilterKey\(value\)/,
    'case library must centralize category key normalization');
  assert.match(src, /const cats = \(categoryKeys \|\| \[\]\)[\s\S]*\.map\(normalizeCategoryFilterKey\)[\s\S]*\.filter\(k => k && k !== 'all'\)/,
    'case search must normalize selected category filter keys');
  assert.match(src, /const caseCategory = normalizeCategoryFilterKey\(c\.category \|\| 'default'\) \|\| 'default'/,
    'case search must normalize raw case category values before filtering');
  assert.doesNotMatch(src, /cats\.includes\(c\.category\)/,
    'case search must not compare normalized chip keys against raw category names');
  assert.match(src, /function countsByCategory\(\)[\s\S]*normalizeCategoryFilterKey\(c\.category \|\| 'default'\)/,
    'category counts should use the same normalized category keys as filters');
});

test('CASE and editor filter panels render as bounded vertical lists', async () => {
  const src = await fs.readFile(stylesMainPath, 'utf8');
  const casesSrc = await fs.readFile(casesScreenPath, 'utf8');
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const packsSrc = await fs.readFile(packsScreenPath, 'utf8');
  const uiSrc = await fs.readFile(new URL('../../src/ui/ui-components.js', import.meta.url), 'utf8');
  const cardDisplaySrc = await fs.readFile(cardDisplayOverlayPath, 'utf8');
  const indexSrc = await fs.readFile(indexHtmlPath, 'utf8');
  const categorySrc = await fs.readFile(categoryServicePath, 'utf8');

  assert.match(src, /\.tp3d-cases-filter-anchor,[\s\S]*\.tp3d-packs-filter-anchor \{[\s\S]*position: relative;/,
    'Cases screen filters must be anchored to the search toolbar');
  assert.match(src, /#cases-filters,[\s\S]*#packs-filters \{[\s\S]*position: absolute;[\s\S]*top: 35px;[\s\S]*right: 0;/,
    'Cases and Packs filters must overlay below the toolbar instead of pushing page content down');
  assert.match(src, /\.tp3d-filter-popover-title \{[\s\S]*position: sticky;[\s\S]*border-bottom: 1px solid var\(--border-subtle\);/,
    'Cases and Packs filter popups must use a consistent sticky title with a divider');
  assert.match(src, /\.tp3d-filter-popover-title \{[\s\S]*margin: calc\(var\(--space-3\) \* -1\) calc\(var\(--space-3\) \* -1\) 10px;/,
    'Cases and Packs filter popups must leave breathing room below the title divider');
  assert.match(src, /#cases-filters \.tp3d-filter-popover-title \+ \.chip,[\s\S]*#packs-filters \.tp3d-filter-popover-title \+ \.chip \{[\s\S]*margin-top: 8px;/,
    'Cases and Packs filter popups must keep the first chip below the title divider');
  assert.match(casesSrc, /filterHeader\.className = 'tp3d-filter-popover-title'/,
    'Cases filter popup must render the shared title class');
  assert.match(indexSrc, /id="packs-filters"[\s\S]*class="tp3d-filter-popover-title">Filters<\/div>/,
    'Packs filter popup must render the shared title class');
  assert.match(casesSrc, /let filtersOutsideClickHandler = null;/,
    'Cases filter popup must track the outside-click listener like Packs');
  assert.match(casesSrc, /prefs\.casesFiltersVisible = prefs\.casesFiltersVisible !== true;/,
    'Cases filter popup must toggle with an explicit open state');
  assert.match(casesSrc, /document\.addEventListener\('click', filtersOutsideClickHandler\)/,
    'Cases filter popup must close from a document outside-click handler');
  assert.match(casesSrc, /prefs\.casesFiltersVisible = false;[\s\S]*PreferencesManager\.set\(prefs\);[\s\S]*applyFiltersVisibility\(\);/,
    'Cases filter outside click must persist the closed state');
  assert.match(src, /#cases-filters,[\s\S]*#packs-filters \{[\s\S]*flex-direction: column;/,
    'Cases and Packs filters must render as vertical lists');
  assert.match(src, /#cases-filters,[\s\S]*#packs-filters \{[\s\S]*width: min\(220px, 100%\);/,
    'Cases and Packs filters must stay compact while overlaying page content');
  assert.match(src, /#cases-filters \.chip,[\s\S]*#packs-filters \.chip,[\s\S]*#editor-case-chips \.chip \{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*justify-content: flex-start;/,
    'Cases, Packs, and editor filter chips must use full-width list rows');
  assert.match(src, /#cases-filters \.chip span:last-child,[\s\S]*#packs-filters \.chip span:last-child,[\s\S]*#editor-case-chips \.chip span:last-child \{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/,
    'filter chip labels must truncate instead of overflowing or clipping the side panel');
  assert.match(src, /\.dropdown\[data-role='categories'\] \{[\s\S]*top: 195px !important;[\s\S]*width: min\(240px, calc\(100vw - 16px\)\) !important;/,
    'Cases category management dropdown must sit lower and stay compact');
  assert.match(casesSrc, /items\.push\(\{ type: 'header', label: 'Categories' \}\);[\s\S]*label: 'New Category'[\s\S]*variant: 'primary'[\s\S]*items\.push\(\{ type: 'divider' \}\);/,
    'Cases category management dropdown must keep the New Category action above the category list');
  assert.match(src, /\.dropdown\[data-role='categories'\] \.dropdown-menu > div:first-child \{[\s\S]*z-index: 4;/,
    'Cases category management dropdown must keep the title fixed above the category list');
  assert.match(src, /\.dropdown\[data-role='categories'\] \.dropdown-item\[data-variant='primary'\] \{[\s\S]*position: sticky;[\s\S]*top: 45px;[\s\S]*justify-content: center;/,
    'Cases category dropdown New Category action must stay sticky and use the primary yellow action styling');
  assert.match(src, /#editor-case-chips \{[\s\S]*left: var\(--space-3\);/,
    'Editor Case Browser filters must be bounded by the fixed search block');
  assert.match(src, /#editor-case-chips \{[\s\S]*right: var\(--space-3\);/,
    'Editor Case Browser filters must be bounded by the fixed search block');
  assert.match(src, /#editor-case-chips \{[\s\S]*width: auto;/,
    'Editor Case Browser filters must be bounded by the fixed search block');
  assert.match(src, /#editor-case-chips \{[\s\S]*flex-direction: column;[\s\S]*flex-wrap: nowrap;/,
    'Editor Case Browser filters must not wrap into clipped side-by-side columns');
  assert.match(src, /#editor-case-chips \{[\s\S]*z-index: 80;/,
    'Editor Case Browser filters must layer above the case list');
  assert.doesNotMatch(indexSrc, /id="(?:cases|editor-case)-filters-toggle"[\s\S]{0,180}data-tooltip="Toggle filters"/,
    'filter toggle buttons must not render a tooltip over the open filter panel');
  assert.match(uiSrc, /const activeAnchorClass = String\(options\.activeAnchorClass \|\| ''\)\.trim\(\)/,
    'shared dropdowns must support opt-in active styling for popup trigger buttons');
  assert.match(uiSrc, /dropdownActiveAnchorClasses\.forEach\(className => anchorEl\.classList\.add\(className\)\)/,
    'shared dropdowns must apply the active styling class while open');
  assert.match(uiSrc, /dropdownActiveAnchorClasses\.forEach\(className => dropdownActiveAnchorEl\.classList\.remove\(className\)\)/,
    'shared dropdowns must remove active styling when closed');
  assert.match(cardDisplaySrc, /role:\s*'card-display'[\s\S]*activeAnchorClass:\s*'btn-primary'/,
    'Packs and Cases card display popup buttons must be yellow while their popup is open');
  assert.match(casesSrc, /role:\s*'categories'[\s\S]*activeAnchorClass:\s*'btn-primary'/,
    'Cases category management popup button must be yellow while its popup is open');
  assert.match(packsSrc, /role:\s*'trailer-presets'[\s\S]*activeAnchorClass:\s*'btn-primary'/,
    'Packs trailer preset popup button must be yellow while its popup is open');
  assert.match(categorySrc, /export function resetToDefaultIfNoCases\(cases\)/,
    'Category service must expose an explicit empty-library reset path');
  assert.match(casesSrc, /CategoryService\.resetToDefaultIfNoCases\(cases\)[\s\S]*activeCategories\.clear\(\)/,
    'Cases filters must clear stale category selections when the case library is empty');
  assert.match(editorSrc, /CategoryService\.resetToDefaultIfNoCases\(allCases\)[\s\S]*browserCats\.clear\(\);[\s\S]*browserManufacturers\.clear\(\);/,
    'Editor Case Browser filters must clear stale category and manufacturer selections when the case library is empty');
});

test('EDITOR and Packs filter popups include total All counts', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  const packsSrc = await fs.readFile(packsScreenPath, 'utf8');
  const indexSrc = await fs.readFile(indexHtmlPath, 'utf8');

  assert.match(editorSrc, /const allFilterCount = allCases\.length/,
    'Editor Case Browser filter popup must compute the total case count');
  assert.match(editorSrc, /`All: \$\{allFilterCount\}`/,
    'Editor Case Browser All filter must display its count');
  assert.match(indexSrc, /id=["']packs-filter-chip-all["']/,
    'Packs status filter popup must include an All chip');
  assert.match(packsSrc, /function updateStatusFilterChips\(packs\)/,
    'Packs status filter popup must refresh status counts');
  assert.match(packsSrc, /setChip\(chipAll, ['"]All['"], counts\.all, !anyActive\)/,
    'Packs All status chip must display the total pack count');
});

test('EDITOR Case Browser filter popup supports manufacturer grouping', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.match(src, /const browserManufacturers = new Set\(\)/,
    'editor Case Browser must track manufacturer filters separately from category filters');
  assert.match(src, /function getManufacturerFilterOptions\(cases\)/,
    'editor Case Browser must build manufacturer filter options');
  assert.match(src, /function getManufacturerFilterColor\(value\)/,
    'editor Case Browser manufacturer chips must use deterministic colors instead of neutral gray only');
  assert.match(src, /color: getManufacturerFilterColor\(label\)/,
    'manufacturer filter options must carry a display color');
  assert.match(src, /caseBrowserGroupBy === 'manufacturer' && browserManufacturers\.size[\s\S]*cases = cases\.filter\(c => browserManufacturers\.has\(getManufacturerFilterKey\(c && c\.manufacturer\)\)\)/,
    'manufacturer tab must filter visible cases by selected manufacturer chips');
  assert.match(src, /const activeBrowserFilters = caseBrowserGroupBy === 'manufacturer' \? browserManufacturers : browserCats/,
    'filter chip state must switch between manufacturer and category mode');
  assert.match(src, /caseBrowserGroupBy === 'manufacturer'[\s\S]*getManufacturerFilterOptions\(allCases\)[\s\S]*CategoryService\.listWithCounts\(allCases\)/,
    'filter popup must render manufacturer options in manufacturer mode and category options otherwise');
  assert.doesNotMatch(src, /caseChipsEl\.hidden = true; caseChipsEl\.style\.display = 'none'/,
    'manufacturer mode must not disable the filter popup');
  assert.match(src, /browserManufacturers\.clear\(\)[\s\S]*caseBrowserGroupBy = 'category'/,
    'saving a new case from the editor must clear stale manufacturer filters');
});

test('EDITOR multi-select summary removes shortcut helper copy', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const multiStart = src.indexOf('function renderMultiInspector(pack, selected)');
  const multiEnd = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)', multiStart);
  const multiBlock = multiStart >= 0 && multiEnd > multiStart ? src.slice(multiStart, multiEnd) : '';

  assert.doesNotMatch(multiBlock, /Shift\+Click to add\/remove\. Ctrl\/Cmd\+A select all\. Delete to remove\./,
    'multi-select inspector summary must not duplicate the future shortcuts area');
});

test('EDITOR movement paths reject collisions before persisting moved positions', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const nudgeStart = src.indexOf('function nudgeSelection(axis, deltaInches)');
  const nudgeEnd = src.indexOf('/**\n     * Keyboard shortcuts', nudgeStart);
  const nudgeBlock = nudgeStart >= 0 && nudgeEnd > nudgeStart ? src.slice(nudgeStart, nudgeEnd) : '';
  const applyStart = src.indexOf("savePos.addEventListener('click'");
  const applyEnd = src.indexOf('transformCard.appendChild(savePos)', applyStart);
  const applyBlock = applyStart >= 0 && applyEnd > applyStart ? src.slice(applyStart, applyEnd) : '';

  assert.match(src, /function rejectMoveCollision\(instanceId, candidateWorld, ignoreSet\)/,
    'keyboard movement must share a collision rejection helper before persistence');
  assert.match(nudgeBlock, /rejectMoveCollision\(id, candidateWorld, ignoreSet\)[\s\S]*PackLibrary\.updateInstance/,
    'keyboard nudge must reject immediate collision candidates before PackLibrary persistence');
  assert.match(nudgeBlock, /rejectMoveCollision\(id, obj\.position, ignoreSet\)[\s\S]*PackLibrary\.updateInstance/,
    'keyboard nudge must re-check collision after gravity settling before PackLibrary persistence');
  assert.match(applyBlock, /CaseScene\.checkCollision\(inst\.id, candidateWorld, ignoreSet\)[\s\S]*PackLibrary\.updateInstance/,
    'inspector position apply must reject immediate collision candidates before PackLibrary persistence');
  assert.match(applyBlock, /CaseScene\.checkCollision\(inst\.id, obj\.position, ignoreSet\)[\s\S]*PackLibrary\.updateInstance/,
    'inspector position apply must re-check collision after gravity settling before PackLibrary persistence');
});

test('EDITOR rotate and flip paths reject unsafe candidates before persistence', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const rotateStart = src.indexOf('function rotateSelection(axis, delta)');
  const rotateEnd = src.indexOf('/**\n     * Nudge selected instances', rotateStart);
  const rotateBlock = rotateStart >= 0 && rotateEnd > rotateStart ? src.slice(rotateStart, rotateEnd) : '';
  const checkIndex = rotateBlock.indexOf('const check = CaseScene.checkCollision(id, obj.position, ignoreSet);');
  const rejectIndex = rotateBlock.indexOf('if (check.collides || (originalInsideTruck && !check.insideTruck))');
  const persistIndex = rotateBlock.indexOf('PackLibrary.updateInstance(packId, id, {', rejectIndex);

  assert.match(rotateBlock, /lockPatch\.orientedDims[\s\S]*obj\.userData\.halfWorld/,
    'manual rotate/flip validation must update the temporary oriented footprint before collision checks');
  assert.ok(checkIndex >= 0 && rejectIndex > checkIndex && persistIndex > rejectIndex,
    'manual rotate/flip must check collision and truck containment before PackLibrary persistence');
  assert.match(rotateBlock, /obj\.position\.copy\(originalWorld\);[\s\S]*obj\.rotation\.copy\(originalRotation\);/,
    'unsafe manual rotate/flip candidates must restore the visible object before returning');
  assert.match(rotateBlock, /Cannot rotate here: collision or truck boundary detected/,
    'unsafe manual rotate/flip candidates must notify the user instead of silently saving');
});

test('AUTO-PACK-A0 AutoPack respects locked orientation and keeps unlocked orientation generation', async () => {
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const src = await fs.readFile(autoPackLegacySolverPath, 'utf8');
  const lockedStart = src.indexOf('function buildLockedOrientation(dims, inst, orientationTools)');
  const buildEnd = src.indexOf('\n      // ── Core: gravity-based free-space packing', lockedStart);
  const block = lockedStart >= 0
    ? src.slice(lockedStart, buildEnd > lockedStart ? buildEnd : src.indexOf('\nfunction findRestingY', lockedStart))
    : '';

  assert.match(block, /inst\.orientationLocked !== true/,
    'locked orientation path must be gated by the per-instance orientationLocked flag');
  assert.match(block, /inst\.lockedRotation[\s\S]*inst\.transform && inst\.transform\.rotation/,
    'AutoPack must prefer the stored lockedRotation and fall back to the current instance rotation');
  assert.match(block, /orientationTools\.normalizeRightAngleRotation\(sourceRotation\)/,
    'locked rotations must be normalized to right-angle editor rotations');
  assert.match(block, /orientationTools\.getOrientedDimsForRotation\(dims, lockedRotation\)/,
    'locked orientation dimensions must come from the shared geometry helper');
  assert.match(block, /if \(lockedOrientation\) return \[lockedOrientation\];[\s\S]*tryOri\(L, W, H/,
    'locked items must test only one orientation while unlocked items keep normal orientation candidates');
  assert.match(src, /const orientations = buildOrientations\(d, c, inst, orientationTools\)/,
    'legacy AutoPack item setup must pass the instance into orientation generation');
  assert.match(engineSrc, /buildLegacyAutoPackItems\(\{[\s\S]*orientationTools:/,
    'AutoPack runtime orchestration must supply orientation helpers to the legacy solver');
});

test('AUTO-PACK-A0B AutoPack animation cannot leave the run promise stuck when tweens stop ticking', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const tweenStart = src.indexOf('function tweenInstanceToPosition(instanceId, positionInches, duration');
  const tweenEnd = src.indexOf('\n  function sleep(ms)', tweenStart);
  const block = tweenStart >= 0 && tweenEnd > tweenStart ? src.slice(tweenStart, tweenEnd) : '';

  assert.match(block, /const finish = \(\) =>/,
    'AutoPack tween bridge must use an idempotent finish helper');
  assert.match(block, /const fallbackDelay = Math\.max\(250, \(Number\(duration\) \|\| 0\) \+ TWEEN_FALLBACK_GRACE_MS\)/,
    'AutoPack tween bridge must define a bounded but not visually aggressive fallback delay');
  assert.match(block, /fallback = runtimeWindow\.setTimeout\(\(\) => \{[\s\S]*fallbackCount \+= 1;[\s\S]*finish\(\);[\s\S]*\}, fallbackDelay\)/,
    'AutoPack tween bridge must resolve even if the tween loop does not tick');
  assert.match(block, /if \(fallback\) runtimeWindow\.clearTimeout\(fallback\);/,
    'AutoPack tween completion must clear the fallback through the shared finish path');
  assert.match(block, /\.onComplete\(finish\)/,
    'AutoPack tween completion must resolve through the same finish path as the fallback');
});

test('AUTO-PACK-A1-ANIM-1 AutoPack yields after staging before synchronous solving', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const packStart = src.indexOf('async function pack()');
  const solverStart = src.indexOf('const solverStartedAt = nowMs();', packStart);
  const block = packStart >= 0 && solverStart > packStart ? src.slice(packStart, solverStart) : '';

  assert.match(block, /stageInstant\(stagingMap\);\s*\/\/ Let the staged layout paint[\s\S]*await waitForAnimationFrames\(2\);\s*if \(isWorkspaceRunStale\(\)\) return;/,
    'AutoPack must allow staged items to paint before the synchronous solver can block the UI thread');
  assert.match(src, /function waitForAnimationFrames\(count = 1\)/,
    'AutoPack runtime must include an animation-frame yield helper');
});

test('AUTO-PACK-A1-ANIM-1 AutoPack animates placements in batches with fallback metrics', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const animateStart = src.indexOf('async function animatePlacements');
  const animateEnd = src.indexOf('\n  function prepareObjectForPlacement', animateStart);
  const block = animateStart >= 0 && animateEnd > animateStart ? src.slice(animateStart, animateEnd) : '';
  const tweenStart = src.indexOf('function tweenInstanceToPosition(instanceId, positionInches, duration');
  const tweenEnd = src.indexOf('\n  function sleep(ms)', tweenStart);
  const tweenBlock = tweenStart >= 0 && tweenEnd > tweenStart ? src.slice(tweenStart, tweenEnd) : '';

  assert.match(src, /const ANIMATION_BATCH_SIZE = 24;/,
    'AutoPack animation must use bounded batches instead of one long serial chain');
  assert.match(src, /const TWEEN_FALLBACK_GRACE_MS = 90;/,
    'AutoPack animation fallback must be short enough that large packs cannot look frozen for many seconds');
  assert.match(block, /Array\.from\(placements\.entries\(\)\)[\s\S]*\.sort\(/,
    'AutoPack animation must order lower placements before upper layers');
  assert.match(block, /entries\.slice\(i, i \+ ANIMATION_BATCH_SIZE\)/,
    'AutoPack animation must process placements in batches');
  assert.match(block, /batch\.forEach\(\(\[id, pos\]\) => \{[\s\S]*tweenInstanceToPosition\(id, pos, ANIMATION_DURATION_MS, metrics\);[\s\S]*\}\);/,
    'AutoPack animation must start each batch without awaiting per-object tween callbacks');
  assert.match(block, /await sleep\(ANIMATION_DURATION_MS \+ ANIMATION_BATCH_GAP_MS\);[\s\S]*snapInstanceToPosition\(id, pos\);/,
    'AutoPack animation must use a deterministic batch window and then snap the batch to final positions');
  assert.match(block, /metrics\.batches \+= 1;[\s\S]*metrics\.animated \+= batch\.length;/,
    'AutoPack animation must record batch and animated item counts');
  assert.match(tweenBlock, /metrics\) \{ metrics\.fallbackCount \+= 1; \}/,
    'AutoPack tween fallback must report fallback hits for diagnostics');
});

test('AUTO-PACK-A1-ANIM-1 AutoPack diagnostics report solver and animation timing', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const packStart = src.indexOf('async function pack()');
  const endStart = src.indexOf("if (diag && typeof diag.autopackEnd === 'function')", packStart);
  const endBlock = endStart >= 0 ? src.slice(endStart, src.indexOf('\n      runtimeWindow.setTimeout', endStart)) : '';

  assert.match(src, /const runStartedAt = nowMs\(\);[\s\S]*let solverMs = 0;[\s\S]*let animationMs = 0;[\s\S]*const animationMetrics = \{ animated: 0, batches: 0, fallbackCount: 0 \};/,
    'AutoPack must initialize timing and animation metrics for each run');
  assert.match(src, /const solverStartedAt = nowMs\(\);[\s\S]*const solverResult = solveAutoPack\(\{[\s\S]*solverMs = nowMs\(\) - solverStartedAt;/,
    'AutoPack must measure synchronous solver time');
  assert.match(src, /const animationStartedAt = nowMs\(\);[\s\S]*animatePlacements\([\s\S]*animationMetrics[\s\S]*animationMs = nowMs\(\) - animationStartedAt;/,
    'AutoPack must measure animation time');
  assert.match(endBlock, /timings: \{[\s\S]*solverMs: Math\.round\(solverMs\),[\s\S]*animationMs: Math\.round\(animationMs\),[\s\S]*totalMs: Math\.round\(nowMs\(\) - runStartedAt\),[\s\S]*\}/,
    'AutoPack diagnostics must include solver, animation, and total timing');
  assert.match(endBlock, /animation: \{ \.\.\.animationMetrics \}/,
    'AutoPack diagnostics must include animation batch and fallback metrics');
});

test('AUTO-PACK-A0C staged unpacked items keep oriented spacing and current rotation', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const stagingStart = src.indexOf('function getStagingDims(item)');
  const stagingEnd = src.indexOf('\n  async function animatePlacements', stagingStart);
  const stagingBlock = stagingStart >= 0 && stagingEnd > stagingStart ? src.slice(stagingStart, stagingEnd) : '';
  const persistStart = src.indexOf('const nextCases = (packData.cases || []).map(inst => {');
  const persistEnd = src.indexOf('\n      PackLibrary.update(packId, { cases: nextCases });', persistStart);
  const persistBlock = persistStart >= 0 && persistEnd > persistStart ? src.slice(persistStart, persistEnd) : '';

  assert.doesNotMatch(stagingBlock, /item\.inst && item\.inst\.orientedDims/,
    'getStagingDims must not read stale inst.orientedDims from a previous AutoPack run as primary height source (RC-4 fix)');
  assert.match(stagingBlock, /item\.orientations\[0\][\s\S]*length: Number\(ori\.l\)[\s\S]*width: Number\(ori\.w\)[\s\S]*height: Number\(ori\.h\)/,
    'staging must fall back to the generated AutoPack orientation dimensions, not raw case dimensions');
  assert.match(persistBlock, /const currentRotation =[\s\S]*inst\.transform && inst\.transform\.rotation/,
    'unpacked staged items must keep their current transform rotation');
  assert.match(persistBlock, /const rot = rotations\.get\(inst\.id\) \|\| currentRotation/,
    'AutoPack must not reset unpacked item rotations to default when no placement rotation exists');
});

test('AUTO-PACK-A0C computeStats OOG warnings use oriented dimensions and shape-aware zones', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const lockedCase = {
    id: 'locked-wide',
    name: 'Locked Wide',
    dimensions: { length: 20, width: 70, height: 10 },
    weight: 10,
  };
  const rectPack = {
    id: 'rect-oriented',
    truck: { length: 80, width: 40, height: 20, shapeMode: 'rect', shapeConfig: {} },
    cases: [{
      id: 'inst-oriented',
      caseId: lockedCase.id,
      hidden: false,
      orientedDims: { length: 70, width: 20, height: 10 },
      transform: {
        position: { x: 35, y: 5, z: 10 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  };
  assert.equal(PackLibrary.computeStats(rectPack, [lockedCase]).oogWarnings.length, 0,
    'valid rotated cases must not be flagged out-of-gauge by raw unrotated dimensions');

  const shortCase = {
    id: 'short-bonus',
    name: 'Short Bonus',
    dimensions: { length: 30, width: 24, height: 18 },
    weight: 10,
  };
  const frontPack = {
    id: 'front-oriented',
    truck: {
      length: 240,
      width: 96,
      height: 72,
      shapeMode: 'frontBonus',
      shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
    },
    cases: [{
      id: 'inst-front',
      caseId: shortCase.id,
      hidden: false,
      orientedDims: { length: 24, width: 30, height: 18 },
      transform: {
        position: { x: 228, y: 9, z: -12 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  };
  assert.equal(PackLibrary.computeStats(frontPack, [shortCase]).oogWarnings.length, 0,
    'valid front-bonus placements must use shape-aware usable zones before warning');

  const blockedWheelPack = {
    id: 'wheel-blocked',
    truck: {
      length: 100,
      width: 100,
      height: 100,
      shapeMode: 'wheelWells',
      shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
    },
    cases: [{
      id: 'inst-wheel-blocked',
      caseId: shortCase.id,
      hidden: false,
      orientedDims: { length: 10, width: 10, height: 10 },
      transform: {
        position: { x: 40, y: 5, z: 40 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  };
  const blockedWarnings = PackLibrary.computeStats(blockedWheelPack, [shortCase]).oogWarnings;
  assert.equal(blockedWarnings.length, 1,
    'items inside blocked wheel-well volume must still be reported as outside usable geometry');
  assert.deepEqual(blockedWarnings[0].issues, ['outsideUsableZone']);
});

test('AUTO-PACK-A0 trailer geometry helpers block wheel wells and preserve front bonus shape awareness', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  const wheelTruck = {
    length: 100,
    width: 100,
    height: 100,
    shapeMode: 'wheelWells',
    shapeConfig: { wellHeight: 20, wellWidth: 20, wellLength: 40, wellOffsetFromRear: 30 },
  };
  const wheelZones = PackLibrary.getTrailerUsableZones(wheelTruck);
  assert.equal(wheelZones.length, 5,
    'wheelWells geometry must remain decomposed into shape-aware usable zones');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 35, y: 5, z: 35 },
    max: { x: 45, y: 15, z: 45 },
  }, wheelZones), false,
  'low boxes inside wheel well blocked volume must not be considered placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 35, y: 25, z: 35 },
    max: { x: 45, y: 35, z: 45 },
  }, wheelZones), true,
  'boxes above wheel well height may use the above-well zone');

  const frontBonusTruck = {
    length: 100,
    width: 100,
    height: 50,
    shapeMode: 'frontBonus',
    // bonusWidth is intentionally != truck.width to prove it is ignored.
    shapeConfig: { bonusLength: 20, bonusWidth: 40, bonusHeight: 30 },
  };
  const frontZones = PackLibrary.getTrailerUsableZones(frontBonusTruck);
  // Overhang zone (raised deck): x:100..120, y:30..50 (bonusHeight..height), z:-50..50 (full width).
  // Cab void (blocked): x:100..120, y:0..30 (0..bonusHeight), z:-50..50 (full width).
  assert.equal(frontZones.length, 2,
    'frontBonus geometry must remain split between main body and front overhang zone');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 85, y: 5, z: -10 },
    max: { x: 95, y: 25, z: 10 },
  }, frontZones), true,
  'box inside the main body near the front must be placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 85, y: 35, z: -10 },
    max: { x: 95, y: 45, z: 10 },
  }, frontZones), true,
  'box inside the main body up to its full height must be placeable, even near the front');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 105, y: 35, z: -10 },
    max: { x: 115, y: 45, z: 10 },
  }, frontZones), true,
  'box resting on the raised overhang deck (y >= bonusHeight) must be placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 105, y: 5, z: -10 },
    max: { x: 115, y: 25, z: 10 },
  }, frontZones), false,
  'box entirely below the deck (in the cab void) must not be placeable');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 105, y: 35, z: -40 },
    max: { x: 115, y: 45, z: 40 },
  }, frontZones), true,
  'overhang spans the full trailer width (ignoring bonusWidth=40); a box wider than bonusWidth but within truck.width must be placeable on the deck');
  assert.equal(PackLibrary.isAabbContainedInAnyZone({
    min: { x: 95, y: 30, z: -10 },
    max: { x: 105, y: 45, z: 10 },
  }, frontZones), false,
  'a box straddling the main box and the raised overhang must not be placeable (cannot pass through the overhang structure)');
});

test('AUTO-PACK-A0 AutoPack keeps zone containment and stacking guards wired', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const engineSrc = await fs.readFile(autoPackEnginePath, 'utf8');
  const src = await fs.readFile(autoPackLegacySolverPath, 'utf8');
  const tryStart = src.indexOf('function tryPlace(cx, cz, ori, truckH, zones, packed, geometry)');
  const tryEnd = src.indexOf('\nfunction getPlacementAabb', tryStart);
  const tryBlock = tryStart >= 0 && tryEnd > tryStart ? src.slice(tryStart, tryEnd) : '';
  const restStart = src.indexOf('function findRestingY(cx, cz, halfL, halfW, packed)');
  const restEnd = src.indexOf('\nfunction collides', restStart);
  const restBlock = restStart >= 0 && restEnd > restStart ? src.slice(restStart, restEnd) : '';

  assert.match(engineSrc, /const zones = TrailerGeometry\.getTrailerUsableZones\(truck\)/,
    'AutoPack must continue deriving usable zones from trailer geometry');
  assert.match(tryBlock, /geometry\.isAabbContainedInAnyZone\(aabb, zones\)/,
    'AutoPack placement must continue using zone containment checks');
  assert.match(appSrc, /if \(mode === 'frontBonus'\)[\s\S]*if \(mode === 'wheelWells'\)/,
    'app-local trailer geometry must keep frontBonus and wheelWells branches');
  assert.match(restBlock, /if \(p\.noStackOnTop \|\| p\.stackable === false\) continue;/,
    'noStackOnTop and stackable=false must remain guarded in resting-height checks');
  assert.match(restBlock, /if \(p\.maxStackCount > 0\)[\s\S]*if \(countOnP >= p\.maxStackCount\) continue;/,
    'maxStackCount guard must remain wired in resting-height checks');
});

test('AUTO-PACK-A0B normalizeInstance preserves manual orientation lock metadata', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const normalized = Normalizer.normalizeAppData({
    caseLibrary: [
      {
        id: 'case-locked',
        name: 'Locked Case',
        dimensions: { length: 48, width: 24, height: 30 },
      },
    ],
    packLibrary: [
      {
        id: 'pack-locked',
        title: 'Locked Pack',
        cases: [
          {
            id: 'inst-locked',
            caseId: 'case-locked',
            transform: {
              position: { x: 1, y: 15, z: 2 },
              rotation: { x: 0, y: Math.PI / 2, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            hidden: true,
            groupId: 'group-1',
            orientationLocked: true,
            lockedRotation: { x: 0, y: Math.PI / 2, z: 0 },
            orientedDims: { length: 999, width: 999, height: 999 },
          },
        ],
      },
    ],
    folderLibrary: [],
    preferences: {},
  });
  const inst = normalized.packLibrary[0].cases[0];

  assert.equal(inst.orientationLocked, true,
    'normalizeInstance must preserve orientationLocked=true');
  assert.deepEqual(inst.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 },
    'normalizeInstance must preserve normalized lockedRotation');
  assert.deepEqual(inst.orientedDims, { length: 24, width: 48, height: 30 },
    'normalizeInstance must recompute safe orientedDims from case dimensions and lockedRotation');
  assert.deepEqual(inst.transform.rotation, { x: 0, y: Math.PI / 2, z: 0 },
    'normalizeInstance must not drop transform rotation');
  assert.equal(inst.hidden, true,
    'normalizeInstance must keep hidden state');
  assert.equal(inst.groupId, 'group-1',
    'normalizeInstance must keep groupId');
});

test('AUTO-PACK-A0B app and pack import paths do not strip orientation locks', async () => {
  const StateStore = await import(stateStorePath.href);
  const Storage = await import(`${storagePath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const lockedCase = {
    id: 'case-import-lock',
    name: 'Import Lock Case',
    dimensions: { length: 48, width: 24, height: 30 },
    weight: 10,
  };
  const lockedInstance = {
    id: 'inst-import-lock',
    caseId: lockedCase.id,
    transform: {
      position: { x: 4, y: 15, z: 6 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    orientationLocked: true,
    lockedRotation: { x: 0, y: Math.PI / 2, z: 0 },
    orientedDims: { length: 24, width: 48, height: 30 },
  };

  const importedApp = Storage.importAppJSON(JSON.stringify({
    app: 'Truck Packer 3D',
    data: {
      caseLibrary: [lockedCase],
      packLibrary: [
        {
          id: 'pack-app-import-lock',
          title: 'App Import Lock Pack',
          folderId: 'missing-folder',
          truck: { length: 100, width: 100, height: 100 },
          cases: [lockedInstance],
        },
      ],
      folderLibrary: [],
      preferences: {},
    },
  }));
  const appInst = importedApp.packLibrary[0].cases[0];
  assert.equal(appInst.orientationLocked, true,
    'App Import must preserve orientationLocked through normalizeAppData');
  assert.deepEqual(appInst.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 },
    'App Import must preserve lockedRotation through normalizeAppData');
  assert.deepEqual(appInst.orientedDims, { length: 24, width: 48, height: 30 },
    'App Import must keep safe orientedDims through normalizeAppData');
  assert.equal(importedApp.packLibrary[0].folderId, null,
    'App Import must keep existing stale-folder normalization behavior');

  StateStore.init({
    caseLibrary: [lockedCase],
    packLibrary: [],
    folderLibrary: [],
    preferences: {},
  });
  const importedPack = PackLibrary.importPackPayload({
    pack: {
      id: 'pack-single-import-lock',
      title: 'Single Pack Import Lock',
      folderId: 'folder-should-clear',
      truck: { length: 100, width: 100, height: 100 },
      cases: [lockedInstance],
    },
    bundledCases: [],
  });
  const packInst = importedPack.cases[0];
  assert.equal(packInst.orientationLocked, true,
    'Single pack import must preserve orientationLocked from the imported instance');
  assert.deepEqual(packInst.lockedRotation, { x: 0, y: Math.PI / 2, z: 0 },
    'Single pack import must preserve lockedRotation from the imported instance');
  assert.deepEqual(packInst.orientedDims, { length: 24, width: 48, height: 30 },
    'Single pack import must preserve orientedDims from the imported instance');
  assert.equal(importedPack.folderId, null,
    'Single pack import must still clear folderId');
});

test('AUTO-PACK-A0B clipboard and duplicate flows preserve orientation lock metadata', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const helperStart = src.indexOf('function cloneOrientationLockMetadata(inst)');
  const helperEnd = src.indexOf('\n      function duplicateSelected()', helperStart);
  const helperBlock = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';
  const duplicateStart = src.indexOf('function duplicateSelected()');
  const duplicateEnd = src.indexOf('\n      function copySelected()', duplicateStart);
  const duplicateBlock = duplicateStart >= 0 && duplicateEnd > duplicateStart ? src.slice(duplicateStart, duplicateEnd) : '';
  const copyStart = src.indexOf('function copySelected()');
  const copyEnd = src.indexOf('\n      function pasteClipboard()', copyStart);
  const copyBlock = copyStart >= 0 && copyEnd > copyStart ? src.slice(copyStart, copyEnd) : '';
  const pasteStart = src.indexOf('function pasteClipboard()');
  const pasteEnd = src.indexOf('\n      function focusSelected()', pasteStart);
  const pasteBlock = pasteStart >= 0 && pasteEnd > pasteStart ? src.slice(pasteStart, pasteEnd) : '';

  assert.match(helperBlock, /orientationLocked:\s*true/,
    'clipboard helper must preserve orientationLocked=true');
  assert.match(helperBlock, /lockedRotation:\s*Utils\.deepClone\(inst\.lockedRotation \|\| transformRotation\)/,
    'clipboard helper must preserve lockedRotation with transform rotation fallback');
  assert.match(helperBlock, /orientedDims:\s*inst\.orientedDims \? Utils\.deepClone\(inst\.orientedDims\) : null/,
    'clipboard helper must preserve orientedDims when present');
  assert.match(duplicateBlock, /\.\.\.Utils\.deepClone\(inst\)/,
    'duplicateSelected must keep cloning the full instance metadata');
  assert.match(copyBlock, /\.\.\.cloneOrientationLockMetadata\(i\)/,
    'copySelected must copy orientation lock metadata');
  assert.match(pasteBlock, /\.\.\.cloneOrientationLockMetadata\(item\)/,
    'pasteClipboard must apply orientation lock metadata to pasted instances');
});

test('AUTO-PACK-A0B editor snapping uses usable-zone walls, not missing TrailerGeometry dimensions', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const helperStart = src.indexOf('function getSnapWallCandidatesWorld()');
  const helperEnd = src.indexOf('\n    /**\n     * Snap a world position', helperStart);
  const helperBlock = helperStart >= 0 && helperEnd > helperStart ? src.slice(helperStart, helperEnd) : '';
  const snapStart = src.indexOf('function snapToNearest(instanceId, worldPos)');
  const snapEnd = src.indexOf('\n    /** Highlight instances', snapStart);
  const snapBlock = snapStart >= 0 && snapEnd > snapStart ? src.slice(snapStart, snapEnd) : '';

  assert.match(helperBlock, /TrailerGeometry\.getTrailerUsableZones\(truck\)/,
    'snap walls must come from shape-aware trailer usable zones');
  assert.match(helperBlock, /TrailerGeometry\.zonesInchesToWorld\(zonesInches\)/,
    'snap walls must convert usable zones into world coordinates');
  assert.match(helperBlock, /SceneManager\.getTruckBoundsWorld\(\)/,
    'snap walls may only use rectangular scene bounds as a no-pack fallback');
  assert.doesNotMatch(snapBlock, /TrailerGeometry\.(?:length|width)/,
    'snapToNearest must not depend on missing TrailerGeometry.length or TrailerGeometry.width properties');
  assert.match(snapBlock, /const wallCandidates = getSnapWallCandidatesWorld\(\)/,
    'snapToNearest must use the shape-aware wall candidate helper');
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

// ── Phase 3C2: cross-tab sign-out "Checking session…" hang ───────────────────

test('phase 3C2 bootstrapAuthGate resets overlay phase to form before hiding on successful sign-in', async () => {
  const src = await fs.readFile(appPath, 'utf8');
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
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function authGateSignedOutCandidate(');
  const end = src.indexOf('\n    function ', start + 1);
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
  const src = await fs.readFile(appPath, 'utf8');
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

test('phase 3A org-invite sends Resend email using env-only configuration', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');

  assert.match(src, /getEnvTrimmed\("RESEND_API_KEY"\)/,
    'org-invite must read RESEND_API_KEY from Deno.env only');
  assert.match(src, /getEnvTrimmed\("INVITE_EMAIL_FROM"\)/,
    'org-invite must read INVITE_EMAIL_FROM from Deno.env');
  assert.match(src, /getEnvTrimmed\("SUPPORT_EMAIL"\)/,
    'org-invite must read SUPPORT_EMAIL from Deno.env where support copy is used');
  assert.match(src, /fetch\("https:\/\/api\.resend\.com\/emails"/,
    'org-invite must send through the Resend email API');
  assert.match(src, /Authorization:\s*`Bearer \$\{apiKey\}`/,
    'Resend authorization must be built from the env-read API key');
  assert.doesNotMatch(src, /RESEND_API_KEY\s*=\s*["']|re_[A-Za-z0-9_=-]{8,}/,
    'org-invite must not hardcode a Resend API key');
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

test('phase 3A org-invite email failure preserves invite creation and returns safe status', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');
  const sendStart = src.indexOf('async function sendInviteEmail');
  const sendEnd = src.indexOf('async function getActorRole', sendStart);
  const sendFn = sendStart >= 0 && sendEnd > sendStart ? src.slice(sendStart, sendEnd) : '';
  const successReturnStart = src.indexOf('invite_link: inviteLink');
  const successReturn = successReturnStart >= 0 ? src.slice(Math.max(0, successReturnStart - 250), successReturnStart + 350) : '';
  const invitePersistIdx = src.lastIndexOf('inviteRecord = data as Record<string, unknown>;', successReturnStart);
  const emailSendIdx = src.indexOf('const emailResult = await sendInviteEmail', invitePersistIdx);

  assert.match(sendFn, /return \{ email_sent: false, email_status: "not_configured" \}/,
    'missing Resend configuration must not throw or fail invite creation');
  assert.match(sendFn, /catch \{[\s\S]*return \{ email_sent: false, email_status: "send_failed" \}/,
    'Resend network failures must be downgraded to send_failed');
  assert.match(sendFn, /if \(res\.ok\)[\s\S]*return \{ email_sent: true, email_status: "sent" \}/,
    'successful Resend delivery must return sent status');
  assert.ok(invitePersistIdx > 0 && emailSendIdx > invitePersistIdx,
    'org-invite must persist the invite before attempting email delivery');
  assert.match(successReturn, /ok:\s*true[\s\S]*invite_link:\s*inviteLink[\s\S]*email_sent:\s*emailResult\.email_sent[\s\S]*email_status:\s*emailResult\.email_status/,
    'org-invite response must preserve invite creation while returning safe email status fields');
  assert.doesNotMatch(successReturn, /\btoken,\b/,
    'org-invite must not return the raw invite token field');
  assert.doesNotMatch(sendFn, /\.json\(\)/,
    'org-invite must not expose or forward Resend response details');
});

test('phase 3A org-invite logs no invite token or secret-bearing values', async () => {
  const src = await fs.readFile(orgInvitePath, 'utf8');
  const consoleCalls = (src.match(/console\.(?:log|warn|error)\([\s\S]*?\);/g) || []).join('\n');

  assert.doesNotMatch(consoleCalls, /inviteLink|invite_link|\btoken\b|apiKey|RESEND_API_KEY|Authorization|Bearer|access_token|refresh_token|JWT|service.?role|STRIPE_SECRET/i,
    'org-invite console logs must not include invite tokens or secret-bearing values');
  assert.match(consoleCalls, /organization_id[\s\S]*invited_email[\s\S]*email_status[\s\S]*status/,
    'Resend failure logs may include only safe delivery metadata and HTTP status');
});

test('phase 3A Settings preserves Copy Link fallback and reports invite email status', async () => {
  const settingsSrc = await fs.readFile(settingsOverlayPath, 'utf8');
  const billingSrc = await fs.readFile(billingServiceUrl, 'utf8');

  assert.match(billingSrc, /email_sent: Boolean\(data && data\.email_sent\)/,
    'billing service must preserve safe email_sent response');
  assert.match(billingSrc, /email_status: data && data\.email_status \? String\(data\.email_status\) : 'not_configured'/,
    'billing service must preserve safe email_status response');
  assert.match(settingsSrc, /function getInviteDeliveryToast\(result, action = 'create'\)/,
    'Settings must map email status to user-facing invite feedback');
  assert.match(settingsSrc, /Invite email sent\. You can also copy the invite link\./,
    'Settings must show successful email delivery copy');
  assert.match(settingsSrc, /Invite link created, but email was not sent\. Use Copy Link to share it\./,
    'Settings must keep manual Copy Link fallback when email is not sent');
  assert.match(settingsSrc, /label: 'Copy Link'/,
    'Settings must preserve Copy Link actions');
});

test('phase 3C1 app maps invite accept failures to persistent handoff copy', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('const inviteHandoffNoticeId');
  const end = src.indexOf('function clearSidebarBillingDomForUserSwitch', start);
  const inviteBlock = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(inviteBlock.length > 0, 'app invite handoff block must be present');
  assert.match(inviteBlock, /const inviteExpiredMessage = 'This invite link has expired\. Please ask the workspace owner to send a new invite\.'/,
    'expired invite failures must map to persistent expired copy');
  assert.match(inviteBlock, /const inviteRevokedMessage = 'This invite link is no longer valid\. Please ask the workspace owner to send a new invite\.'/,
    'revoked/no-longer-valid invite failures must map to persistent revoked copy');
  assert.match(inviteBlock, /const inviteWrongEmailMessage = 'Invite email does not match the signed-in account\.'/,
    'wrong-email guard copy must remain explicit');
  assert.match(inviteBlock, /const inviteGenericFailureMessage = 'This invite link could not be accepted\. Please ask the workspace owner to send a new invite\.'/,
    'generic invite failures must map to safe fallback copy');
  assert.match(inviteBlock, /function mapInviteAcceptFailureMessage\(error\)[\s\S]*includes\('expired'\)[\s\S]*inviteExpiredMessage/,
    'invite accept failure mapper must classify expired responses');
  assert.match(inviteBlock, /includes\('no longer valid'\) \|\| lower\.includes\('revoked'\)[\s\S]*inviteRevokedMessage/,
    'invite accept failure mapper must classify revoked/no-longer-valid responses');
  assert.match(inviteBlock, /includes\('email does not match'\)[\s\S]*inviteWrongEmailMessage/,
    'invite accept failure mapper must preserve email mismatch responses');
  // Rejection failures no longer call setInviteHandoffNotice (toast-only for signed-in users).
  // They must call clearInviteHandoffNotice() to clean up stale state, and show a toast.
  assert.match(inviteBlock, /clearInviteHandoffNotice\(\)/,
    'failed invite acceptance (signed-in) must clear stale handoff notice and rely on toast');
  assert.match(inviteBlock, /UIComponents\.showToast\(inviteMessage/,
    'failed invite acceptance must show a toast with the rejection message');
  assert.match(inviteBlock, /data-invite-handoff-message/,
    'persistent invite handoff notice element must have a stable DOM marker for browser validation');
});

test('phase 3C1 invite handoff notice does not expose raw tokens or scope into billing', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('const inviteHandoffNoticeId');
  const end = src.indexOf('function clearSidebarBillingDomForUserSwitch', start);
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

test('phase 3C1 renderInviteHandoffNotice guards auth overlay visibility before inserting notice', async () => {
  const src = await fs.readFile(appPath, 'utf8');
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
  const src = await fs.readFile(appPath, 'utf8');
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

test('phase 3C1 invite handoff visibility fix adds no token logging or reload side-effects', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  // Scope checks to the renderInviteHandoffNotice function only — this is the function modified by the fix.
  const fnStart = src.indexOf('function renderInviteHandoffNotice(');
  const fnEnd = src.indexOf('function setInviteHandoffNotice(', fnStart);
  const fnBody = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';

  assert.ok(fnBody.length > 0, 'renderInviteHandoffNotice must be extractable for side-effect check');

  // Visibility fix must not introduce any console output inside renderInviteHandoffNotice
  assert.doesNotMatch(fnBody, /console\./,
    'renderInviteHandoffNotice must not log token-bearing or session-bearing state');

  // No reload must be introduced
  assert.doesNotMatch(fnBody, /location\.reload|window\.location\.reload/,
    'renderInviteHandoffNotice must not add a location.reload');
  assert.doesNotMatch(fnBody, /setTimeout[\s\S]{0,80}location\.reload/,
    'renderInviteHandoffNotice must not introduce a timed reload');

  // No raw token values must be inserted into the DOM via the notice function
  assert.doesNotMatch(fnBody, /textContent\s*=[\s\S]{0,80}(pendingInviteToken|tokenFromUrl|storedToken)/,
    'renderInviteHandoffNotice must not expose raw invite token values in UI');

  // No JWT-bearing headers or service credentials introduced by the visibility fix
  assert.doesNotMatch(fnBody, /refresh_token|Bearer|service.?role|SUPABASE_SERVICE/i,
    'renderInviteHandoffNotice must not reference JWT bearer headers or service credentials');
});

test('phase 3C1 SIGNED_OUT event clears invite handoff notice to prevent stale notice persisting over auth overlay', async () => {
  const src = await fs.readFile(appPath, 'utf8');

  // Find the onAuthStateChange handler — locate the isSignedOutEvent clearBillingState block
  const handlerStart = src.indexOf('SupabaseClient.onAuthStateChange(');
  const handlerEnd = src.indexOf('const authTruthForEvent = getAuthTruthSnapshot()', handlerStart);
  const handlerBlock = handlerStart >= 0 && handlerEnd > handlerStart
    ? src.slice(handlerStart, handlerEnd)
    : '';

  assert.ok(handlerBlock.length > 0, 'onAuthStateChange handler block must be extractable');

  // clearInviteHandoffNotice must appear in the isSignedOutEvent branch
  const signedOutBranch = handlerBlock.match(/if\s*\(isSignedOutEvent\)[\s\S]*?(?=\}\s*else\s*if\s*\(isSignedInEvent)/);
  assert.ok(signedOutBranch, 'isSignedOutEvent branch must be present in handler');
  assert.match(signedOutBranch[0], /clearInviteHandoffNotice\(\)/,
    'SIGNED_OUT must call clearInviteHandoffNotice() to prevent stale notice persisting over the auth overlay');

  // clearBillingState and clearInviteHandoffNotice must both be in the same signed-out branch
  assert.match(signedOutBranch[0], /clearBillingState\(\)/,
    'SIGNED_OUT branch must still call clearBillingState()');
});

test('phase 3C1 signed-in invite rejection clears notice state instead of setting persistent error notice', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('async function tryAcceptPendingInvite(');
  const end = src.indexOf('function clearSidebarBillingDomForUserSwitch(', start);
  const fnBody = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fnBody.length > 0, 'tryAcceptPendingInvite must be extractable');

  // Rejection branches (result.ok=false and catch) must call clearInviteHandoffNotice, not set error notice
  const elseIdx = fnBody.indexOf('const inviteMessage = mapInviteAcceptFailureMessage(result');
  const catchIdx = fnBody.indexOf('const inviteMessage = mapInviteAcceptFailureMessage(err');
  assert.ok(elseIdx > 0, 'result.ok=false branch must be locatable');
  assert.ok(catchIdx > elseIdx, 'catch branch must be locatable after else branch');

  // Neither branch must call setInviteHandoffNotice with an error message
  const afterElse = fnBody.slice(elseIdx, catchIdx);
  const afterCatch = fnBody.slice(catchIdx);
  assert.doesNotMatch(afterElse, /setInviteHandoffNotice\([^)]*'error'\)/,
    'result.ok=false branch must not call setInviteHandoffNotice with error type');
  assert.doesNotMatch(afterCatch, /setInviteHandoffNotice\([^)]*'error'\)/,
    'catch branch must not call setInviteHandoffNotice with error type');

  // Both branches must call clearInviteHandoffNotice() to clean up stale state
  assert.match(afterElse, /clearInviteHandoffNotice\(\)/,
    'result.ok=false branch must call clearInviteHandoffNotice() to prevent persistent app-shell banner');
  assert.match(afterCatch, /clearInviteHandoffNotice\(\)/,
    'catch branch must call clearInviteHandoffNotice() to prevent persistent app-shell banner');

  // Both branches must still show the toast
  assert.match(afterElse, /UIComponents\.showToast\(inviteMessage/,
    'result.ok=false branch must show toast with invite failure message');
  assert.match(afterCatch, /UIComponents\.showToast\(inviteMessage/,
    'catch branch must show toast with invite failure message');
});

test('phase 3C1 invite rejection failure path does not log token or JWT values', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('async function tryAcceptPendingInvite(');
  const end = src.indexOf('function clearSidebarBillingDomForUserSwitch(', start);
  const fnBody = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fnBody.length > 0, 'tryAcceptPendingInvite must be extractable');

  assert.doesNotMatch(fnBody, /console\./,
    'tryAcceptPendingInvite must not log any state (prevents token/session leakage)');
  assert.doesNotMatch(fnBody, /pendingInviteToken[\s\S]{0,60}textContent|console[\s\S]{0,60}pendingInviteToken/,
    'tryAcceptPendingInvite must not expose raw invite token in UI or logs');
  // session.access_token is a legitimate session presence check — exclude it.
  // Only flag logging/display of bearer headers, service credentials, or refresh tokens.
  assert.doesNotMatch(fnBody, /refresh_token|Bearer|service.?role|SUPABASE_SERVICE/i,
    'tryAcceptPendingInvite must not reference bearer headers or service credentials');
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
  assert.match(src, /Transfer Workspace ownership before leaving\. You are the primary owner\./,
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
    'organization fetch must define an active-org safety filter');
  assert.match(src, /client\.rpc\('get_user_organizations'\)[\s\S]*?orgs: data\.filter\(isActiveOrgRow\), authoritative: true/,
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

test('release-gate browser client still refuses direct deletion-field writes (defense in depth)', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function updateProfile(updates)');
  const end = src.indexOf('export async function getUserOrganizations()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'updateProfile must be extractable');
  assert.match(fn, /const blockedDeletionFields = \['deletion_status', 'deleted_at', 'purge_after'\]/,
    'updateProfile must still list the deletion fields as blocked on the client');
  assert.match(fn, /blockedDeletionFields\.some\(field => Object\.prototype\.hasOwnProperty\.call\(updates \|\| \{\}, field\)\)[\s\S]*Direct account deletion state updates are disabled/,
    'updateProfile must still reject direct deletion-field writes from the browser');
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

test('phase 0.6C-3 account bundle marks failed org fetch as partial, not confirmed no-org', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getAccountBundleSingleFlight');
  const end = src.indexOf('// Clean up in-flight promise when done', start);
  const bundleFn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(bundleFn, 'getAccountBundleSingleFlight must be extractable');
  assert.match(bundleFn, /const orgsFetchAuthoritative = Boolean\(orgsAuthResult && orgsAuthResult\.authoritative\) && !orgsWrap\.timedOut/,
    'a fetch is authoritative only when it confirmed the list and did not time out');
  assert.match(bundleFn, /const orgsFetchReturnedArray = orgsFetchAuthoritative && Array\.isArray\(orgsResult\)/,
    'only an authoritative, non-timeout array result may be a returned array');
  assert.match(bundleFn, /const orgsFetchUncertain = Boolean\(orgsWrap\.timedOut \|\| !orgsFetchAuthoritative\)/,
    'null, failed, timeout, or non-authoritative org fetch results must be uncertain');
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

// ── False no-workspace state during slow/failed organization refresh ─────────

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

test('false-no-workspace: getUserOrganizations preserves its array contract for existing callers', async () => {
  const src = await fs.readFile(supabasePath, 'utf8');
  const start = src.indexOf('export async function getUserOrganizations()');
  const end = src.indexOf('export async function getUserOrganizationsAuthoritative()', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'getUserOrganizations wrapper must be extractable');
  assert.match(fn, /const \{ orgs \} = await _fetchUserOrganizations\(\);\s*\n\s*return orgs;/,
    'getUserOrganizations must still resolve to a plain array for all existing callers');
});

test('false-no-workspace: account bundle confirms zero workspaces only from a non-partial authoritative result', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('async function applyOrgContextFromBundle(');
  const end = src.indexOf('async function refreshOrgContext(', start);
  const fn = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(fn, 'applyOrgContextFromBundle must be extractable');
  // A partial bundle with a known workspace hint must retain the workspace, not clear it.
  assert.match(fn, /if \(bundle && bundle\.partial && readLocalOrgId\(\)\) \{[\s\S]*?return null;/,
    'a partial bundle with a known workspace hint must retain the workspace');
  // confirmedNoOrg may only be derived from a non-partial empty result.
  assert.match(fn, /confirmedNoOrg: Boolean\(!bundle\?\.partial && Array\.isArray\(resolved\.orgs\) && resolved\.orgs\.length === 0\)/,
    'confirmed no-org may only be derived from a non-partial empty result');
  // A mismatched active org may only be cleared from a non-partial bundle.
  assert.match(fn, /if \(nextOrgId && !nextOrgInActiveList && !\(bundle && bundle\.partial\)\)/,
    'a mismatched active org may only be cleared from a non-partial bundle');
});

test('false-no-workspace: no-org banner requires a resolved confirmed-empty result and is suppressed while busy', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function applyOrgRequiredUi(');
  const anchor = src.indexOf('const showNoOrgBanner', start);
  const fn = start >= 0 && anchor > start ? src.slice(start, anchor + 600) : '';

  assert.ok(fn, 'applyOrgRequiredUi must be extractable');
  assert.match(fn, /const hasResolvedNoActiveOrg = Boolean\([\s\S]*?confirmedNoOrg &&[\s\S]*?orgContextResolved &&[\s\S]*?orgs\.length === 0/,
    'the no-org banner must require a confirmed, resolved, empty org context');
  assert.match(fn, /const orgContextBusy = Boolean\(orgContextInFlight \|\| authRehydratePromise\)/,
    'banner gating must know when an org refresh or auth rehydrate is in flight');
  assert.match(fn, /showNoOrgBanner = Boolean\([\s\S]*?hasResolvedNoActiveOrg &&[\s\S]*?!authNotSettled &&[\s\S]*?!orgContextBusy/,
    'the no-org banner must never show while auth is unsettled or an org refresh is in flight');
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

test('phase 0.7A-2 Settings General has Owner Admin gated Workspace Backup action', async () => {
  const src = await fs.readFile(settingsOverlayPath, 'utf8');

  assert.match(src, /onExportWorkspace:\s*_onExportWorkspace/,
    'settings overlay must accept onExportWorkspace callback');
  assert.match(src, /if \(isOwnerOrAdmin && typeof _onExportWorkspace === 'function'\)/,
    'workspace export action must fail closed unless owner/admin role and callback are available');
  assert.match(src, /Export Workspace Backup/,
    'settings general must include Export Workspace Backup action label');
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
  // Runtime behavior: a single pack import must drop any incoming folderId because
  // folder import is workspace-level only (replaces a brittle source-slice check).
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  const imported = PackLibrary.importPackPayload(makePackImportPayload(
    makePackImportSafeCase({ id: 'c-folder', name: 'Folder Case' }),
    [makePackImportInstance('c-folder', { id: 'i-folder', transform: { position: { x: 5, y: 5, z: 0 } } })],
    { folderId: 'some-folder-id' }
  ));
  assert.equal(imported.folderId, null,
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
  const start = src.indexOf('function openFoldersDropdown()');
  const end = src.indexOf('\n    function initListHeaderSort()', start + 1);
  const dropdownBlock = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(src, /defaultActionsEl\.insertBefore\(foldersButtonEl, btnImport\)/,
    'Folders button must be mounted before Import Pack in the top action area');
  assert.match(dropdownBlock, /label: `All Packs \(\$\{model\.totalCount\}\)`/,
    'Folders dropdown must include All Packs with count');
  assert.match(dropdownBlock, /label: `Unfiled \(\$\{model\.unfiledCount\}\)`/,
    'Folders dropdown must include Unfiled with count');
  assert.match(dropdownBlock, /label: ['"]No folders yet['"][\s\S]{0,100}disabled: true/,
    'Folders dropdown must show disabled No folders yet row');
  assert.doesNotMatch(dropdownBlock, /\b(renameFolder|deleteFolder|movePackToFolder|getPacksInFolder)\s*\(/,
    'Folders filter dropdown must not add rename, delete, move, or bulk folder UI');
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

test('phase 0.7C-1B preserves Empty Partial Full filter chips', async () => {
  const indexSrc = await fs.readFile(indexHtmlPath, 'utf8');
  const packsSrc = await fs.readFile(packsScreenPath, 'utf8');

  assert.match(indexSrc, /id=["']packs-filter-chip-all["']/,
    'All filter chip must remain in index.html');
  assert.match(indexSrc, /id=["']packs-filter-chip-empty["']/,
    'Empty filter chip must remain in index.html');
  assert.match(indexSrc, /id=["']packs-filter-chip-partial["']/,
    'Partial filter chip must remain in index.html');
  assert.match(indexSrc, /id=["']packs-filter-chip-full["']/,
    'Full filter chip must remain in index.html');
  assert.match(packsSrc, /wireChip\(chipAll, ['"]all['"]\)/,
    'All filter chip wiring must remain');
  assert.match(packsSrc, /wireChip\(chipEmpty, ['"]empty['"]\)/,
    'Empty filter chip wiring must remain');
  assert.match(packsSrc, /wireChip\(chipPartial, ['"]partial['"]\)/,
    'Partial filter chip wiring must remain');
  assert.match(packsSrc, /wireChip\(chipFull, ['"]full['"]\)/,
    'Full filter chip wiring must remain');
  assert.match(packsSrc, /filters\.empty = false;[\s\S]*filters\.partial = false;[\s\S]*filters\.full = false;/,
    'All filter chip must clear the status filters');
});

test('phase 0.7C-1B folders button uses scoped structure without tooltip or ghost style', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function ensureFoldersButton()');
  const end = src.indexOf('\n    function getOpenFoldersDropdown()', start + 1);
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

test('phase 0.7C-1B avoids rejected folder UI and bulk folder actions', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

  assert.doesNotMatch(src, /function renderFolderBar|folderBarEl/,
    'the rejected always-visible folder bar must not be present');
  assert.doesNotMatch(src, /filtersRowEl\.nextSibling|insertBefore\([^)]*filtersRowEl/,
    'folder UI must not be mounted under the Empty Partial Full filter chip row');
  assert.doesNotMatch(src, /folder side(panel|bar)|folderPanel|foldersSidebar/i,
    'Phase 0.7C-1B must not add a sidebar folder panel');
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
  assert.doesNotMatch(block, /\.tp3d-packs-folder-btn__caret/,
    'caret CSS must stay removed because the Folders button no longer renders a caret');
  assert.match(block, /\.tp3d-packs-folder-option-btn \{/,
    'Move to Folder modal rows must use scoped folder option button styles');
  assert.match(block, /\.tp3d-packs-folder-option-btn__label[\s\S]{0,220}text-overflow:\s*ellipsis/,
    'Move to Folder modal row labels must truncate long folder names');
  assert.doesNotMatch(block, /\.btn\b|\.dropdown-menu|\.dropdown-item/,
    'Phase 0.7C-1B CSS must not style global buttons or dropdowns');
});

// ============================================================================
// PHASE 0.7C-2 — Create Folder from Packs Dropdown
// ============================================================================

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
  assert.ok(block.indexOf("label: 'No folders yet'") < block.indexOf("label: 'New Folder'"),
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

test('phase 0.7C-2 does not add bulk sidebar or chip-row folder UI', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');

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

// ============================================================================
// PHASE 0.7C-3 — Move Pack to Folder from Pack Menus
// ============================================================================

test('phase 0.7C-3 move modal uses folder library move API', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function movePackToFolder(');
  const end = src.indexOf('\n    function openFoldersDropdown()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0,
    'movePackToFolder and openMoveToFolderModal helpers must be extractable');
  assert.match(block, /function openMoveToFolderModal\(pack\)/,
    'openMoveToFolderModal(pack) helper must exist');
  assert.match(block, /UIComponents\.showModal\(/,
    'Move to Folder must use the existing modal path');
  assert.match(block, /FolderLibrary\.movePackToFolder\(pack\.id, folderIdOrNull\)/,
    'move helper must call FolderLibrary.movePackToFolder with pack id and target folder id');
  assert.match(block, /const folders = getSafeFolders\(\)/,
    'move helper must use folder options from the existing safe folder list');
  assert.match(src, /FolderLibrary\.listFolders\(\)/,
    'folder options must ultimately come from FolderLibrary.listFolders()');
  assert.doesNotMatch(src, /function buildMoveFolderItems\(pack\)/,
    'inline expanded buildMoveFolderItems helper must be removed');
});

test('phase 0.7C-3 move modal includes Unfiled folders and current state marker', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openMoveToFolderModal(pack)');
  const end = src.indexOf('\n    function openFoldersDropdown()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /addMoveRow\(['"]Unfiled['"], ['"]fa-solid fa-folder-open['"], null, currentFolderId === null\)/,
    'Move modal must include an Unfiled option that passes null');
  assert.match(block, /folders\.forEach\(folder =>[\s\S]{0,220}addMoveRow\(folder\.name \|\| ['"]Untitled Folder['"], ['"]fa-solid fa-folder['"], folderId, currentFolderId === folderId\)/,
    'Move modal must include real folder options from getSafeFolders');
  assert.match(block, /empty\.textContent = ['"]No folders yet['"]/,
    'Move modal must show No folders yet when no real folders exist');
  assert.match(block, /currentEl\.className = ['"]tp3d-packs-folder-option-btn__meta['"][\s\S]{0,120}currentEl\.textContent = ['"]Current['"]/,
    'Move modal must visibly mark the current location');
  assert.match(block, /if \(moved && modalRef && typeof modalRef\.close === ['"]function['"]\) modalRef\.close\(\)/,
    'successful move must close the modal');
});

test('phase 0.7C-3 move helper handles success and failed moves safely', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function movePackToFolder(');
  const end = src.indexOf('\n    function openMoveToFolderModal(pack)', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /if \(!moved\)[\s\S]{0,120}UIComponents\.showToast\(['"]Could not move pack to folder['"], ['"]warning['"]\)/,
    'failed move must show a warning toast and not throw');
  assert.match(block, /packsListState\.pageIndex = 0/,
    'successful move must reset pack pagination');
  assert.match(block, /\brender\(\)/,
    'successful move must re-render Packs screen');
  assert.match(block, /UIComponents\.showToast\([\s\S]{0,120}['"]success['"]\)/,
    'successful move must show success toast');
  assert.match(block, /return true/,
    'successful move must report success to modal row handlers');
});

test('phase 0.7C-3 list and grid pack menus include compact move action between export and delete', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const listStart = src.indexOf('function renderListView(packs)');
  const listEnd = src.indexOf('\n    function renderGridView(packs)', listStart + 1);
  const listBlock = listStart >= 0 && listEnd > listStart ? src.slice(listStart, listEnd) : '';
  const gridStart = src.indexOf('function renderGridView(packs)');
  const gridEnd = src.indexOf('\n    function buildPreview(', gridStart + 1);
  const gridBlock = gridStart >= 0 && gridEnd > gridStart ? src.slice(gridStart, gridEnd) : '';

  assert.match(listBlock, /label:\s*['"]Export Pack JSON['"][\s\S]{0,220}label:\s*['"]Move to Folder['"][\s\S]{0,220}openMoveToFolderModal\(pack\)[\s\S]{0,220}label:\s*['"]Delete['"]/,
    'list view pack menu must insert one Move to Folder action after Export Pack JSON and before Delete');
  assert.match(gridBlock, /label:\s*['"]Export Pack JSON['"][\s\S]{0,220}label:\s*['"]Move to Folder['"][\s\S]{0,220}openMoveToFolderModal\(pack\)[\s\S]{0,220}label:\s*['"]Delete['"]/,
    'grid view pack menu must insert one Move to Folder action after Export Pack JSON and before Delete');
  assert.doesNotMatch(listBlock, /\.\.\.buildMoveFolderItems\(pack\)|type:\s*['"]header['"], label:\s*['"]Move to folder['"]/,
    'list view pack menu must not inline every folder choice');
  assert.doesNotMatch(gridBlock, /\.\.\.buildMoveFolderItems\(pack\)|type:\s*['"]header['"], label:\s*['"]Move to folder['"]/,
    'grid view pack menu must not inline every folder choice');
});

test('phase 0.7C-3 move helper does not touch pack delete or case library code', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function movePackToFolder(');
  const end = src.indexOf('\n    function openFoldersDropdown()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.doesNotMatch(block, /PackLibrary\.remove|CaseLibrary\./,
    'move helper must not delete packs or touch case library');
  assert.doesNotMatch(block, /FolderLibrary\.renameFolder\(|FolderLibrary\.deleteFolder\(/,
    'move helper must not add rename or delete folder behavior');
  assert.doesNotMatch(block, /bulk.*folder|folder.*bulk/i,
    'move helper must not add bulk folder behavior');
});

test('phase 0.7C-3 avoids native dialogs and preserves no-caret folder button', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function ensureFoldersButton()');
  const end = src.indexOf('\n    function renderFoldersButton(', start + 1);
  const buttonBlock = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.doesNotMatch(src, /window\.prompt|window\.alert|window\.confirm/,
    'Packs screen must not use window prompt alert or confirm APIs');
  assert.doesNotMatch(src, /(^|[^\w.])prompt\s*\(|(^|[^\w.])alert\s*\(|(^|[^\w.])confirm\s*\(/,
    'Packs screen must not use native prompt(), alert(), or confirm() calls');
  assert.doesNotMatch(buttonBlock, /tp3d-packs-folder-btn__caret|fa-chevron-down/,
    'Folders button must remain no-caret');
});

// ============================================================================
// PHASE 0.7C-4 — Rename and Delete Folder from Packs Dropdown
// ============================================================================

test('phase 0.7C-4 rename folder uses existing modal and folder library rename API', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openRenameFolderModal(folder)');
  const end = src.indexOf('\n    async function deleteFolderWithConfirm', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0,
    'openRenameFolderModal(folder) must exist');
  assert.match(block, /UIComponents\.showModal\(/,
    'Rename Folder must use the existing modal path');
  assert.match(block, /title:\s*['"]Rename Folder['"]/,
    'Rename Folder modal title must be Rename Folder');
  assert.match(block, /field\(['"]Folder name['"], ['"]text['"], ['"]e\.g\. Client A['"], false\)/,
    'Rename Folder modal must use field() for optional folder name input');
  assert.match(block, /name\.input\.value = folder\.name \|\| ['"]/,
    'Rename Folder modal must pre-fill the current folder name');
  assert.match(block, /FolderLibrary\.renameFolder\(folderId, name\.input\.value\)/,
    'Rename Folder must call FolderLibrary.renameFolder with folder id and input value');
  assert.match(block, /\brender\(\)/,
    'Rename Folder must refresh the Packs screen through render()');
  assert.match(block, /UIComponents\.showToast\(['"]Folder renamed['"], ['"]success['"]\)/,
    'Rename Folder must show a success toast');
});

test('phase 0.7C-4 delete folder uses confirm and preserves packs', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('async function deleteFolderWithConfirm(folder)');
  const end = src.indexOf('\n    function movePackToFolder(', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.ok(block.length > 0,
    'deleteFolderWithConfirm(folder) must exist');
  assert.match(block, /UIComponents\.confirm\(/,
    'Delete Folder must use the existing confirm path');
  assert.match(block, /title:\s*['"]Delete folder\?['"]/,
    'Delete Folder confirm title must be explicit');
  assert.match(block, /will move to Unfiled/,
    'Delete Folder confirm must state assigned packs move to Unfiled');
  assert.match(block, /Packs will not be deleted/,
    'Delete Folder confirm must state packs are not deleted');
  assert.match(block, /PackLibrary\.getPacks\(\)\.filter/,
    'Delete Folder must count affected packs without deleting them');
  assert.match(block, /FolderLibrary\.deleteFolder\(folderId\)/,
    'Delete Folder must call FolderLibrary.deleteFolder');
  assert.doesNotMatch(block, /PackLibrary\.remove|CaseLibrary\.remove|CaseLibrary\./,
    'Delete Folder path must not delete packs or touch cases');
});

test('phase 0.7C-4 delete active folder clears active filter and resets pagination', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('async function deleteFolderWithConfirm(folder)');
  const end = src.indexOf('\n    function movePackToFolder(', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.match(block, /if \(activeFolderId === folderId\)[\s\S]{0,120}activeFolderId = null/,
    'Deleting the active folder must clear activeFolderId to All Packs');
  assert.match(block, /if \(activeFolderId === folderId\)[\s\S]{0,160}packsListState\.pageIndex = 0/,
    'Deleting the active folder must reset pack pagination');
  assert.match(block, /\brender\(\)/,
    'Deleting a folder must refresh the Packs screen');
  assert.match(block, /UIComponents\.showToast\(['"]Folder deleted['"], ['"]success['"]\)/,
    'Deleting a folder must show a success toast');
});

test('phase 0.7C-4 Folders dropdown exposes rename delete only for active real folder', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openFoldersDropdown()');
  const end = src.indexOf('\n    function initListHeaderSort()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  const allStart = block.indexOf('label: `All Packs');
  const allEnd = block.indexOf('label: `Unfiled', allStart + 1);
  const allBlock = allStart >= 0 && allEnd > allStart ? block.slice(allStart, allEnd) : '';
  const unfiledStart = block.indexOf('label: `Unfiled');
  const unfiledEnd = block.indexOf('if (model.folders.length)', unfiledStart + 1);
  const unfiledBlock = unfiledStart >= 0 && unfiledEnd > unfiledStart ? block.slice(unfiledStart, unfiledEnd) : '';
  const actionsStart = block.indexOf('if (model.activeFolder && activeFolderId)');
  const actionsEnd = block.indexOf("label: 'New Folder'", actionsStart + 1);
  const actionsBlock = actionsStart >= 0 && actionsEnd > actionsStart ? block.slice(actionsStart, actionsEnd) : '';

  assert.doesNotMatch(allBlock, /Rename Folder|Delete Folder|openRenameFolderModal|deleteFolderWithConfirm/,
    'All Packs row must not expose folder rename or delete');
  assert.doesNotMatch(unfiledBlock, /Rename Folder|Delete Folder|openRenameFolderModal|deleteFolderWithConfirm/,
    'Unfiled row must not expose folder rename or delete');
  assert.match(actionsBlock, /if \(model\.activeFolder && activeFolderId\)/,
    'Rename and delete folder actions must be gated to an active real folder');
  assert.match(actionsBlock, /label:\s*['"]Rename Folder['"][\s\S]{0,180}openRenameFolderModal\(model\.activeFolder\)/,
    'Active real folder actions must include Rename Folder');
  assert.match(actionsBlock, /label:\s*['"]Delete Folder['"][\s\S]{0,220}deleteFolderWithConfirm\(model\.activeFolder\)/,
    'Active real folder actions must include Delete Folder');
});

test('phase 0.7C-4 avoids native dialogs and preserves no-caret folder button', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function ensureFoldersButton()');
  const end = src.indexOf('\n    function renderFoldersButton(', start + 1);
  const buttonBlock = start >= 0 && end > start ? src.slice(start, end) : '';

  assert.doesNotMatch(src, /window\.prompt|window\.alert|window\.confirm/,
    'Packs screen must not use window prompt alert or confirm APIs');
  assert.doesNotMatch(src, /(^|[^\w.])prompt\s*\(|(^|[^\w.])alert\s*\(|(^|[^\w.])confirm\s*\(/,
    'Packs screen must not use native prompt(), alert(), or confirm() calls');
  assert.doesNotMatch(buttonBlock, /tp3d-packs-folder-btn__caret|fa-chevron-down/,
    'Folders button must remain no-caret');
});

// ============================================================================
// PHASE 0.7C-4B — Folder Persistence + Compact Move Modal
// ============================================================================

test('phase 0.7C-4B app local state reload and reset paths preserve folderLibrary', async () => {
  const src = await fs.readFile(appPath, 'utf8');
  const seedStart = src.indexOf('function seedIfEmpty()');
  const resetStart = src.indexOf('function resetAppStateToEmpty()');
  const loadStart = src.indexOf('function loadScopedStateOrSeed');
  const end = src.indexOf('\n    // ============================================================================', loadStart + 1);
  const seedBlock = seedStart >= 0 && resetStart > seedStart ? src.slice(seedStart, resetStart) : '';
  const resetBlock = resetStart >= 0 && loadStart > resetStart ? src.slice(resetStart, loadStart) : '';
  const loadBlock = loadStart >= 0 && end > loadStart ? src.slice(loadStart, end) : '';

  assert.match(seedBlock, /folderLibrary:\s*Array\.isArray\(stored\.folderLibrary\) \? stored\.folderLibrary : \[\]/,
    'seedIfEmpty stored load path must initialize StateStore with stored folderLibrary');
  assert.match(loadBlock, /folderLibrary:\s*Array\.isArray\(stored\.folderLibrary\) \? stored\.folderLibrary : \[\]/,
    'loadScopedStateOrSeed stored load path must initialize StateStore with stored folderLibrary');
  assert.match(resetBlock, /folderLibrary:\s*\[\]/,
    'resetAppStateToEmpty must clear folderLibrary explicitly');
  const fallbackCount = (src.match(/folderLibrary:\s*\[\]/g) || []).length;
  assert.ok(fallbackCount >= 4,
    'empty seed reset and no-workspace fallback state shapes must include folderLibrary: []');
});

test('phase 0.7C-4B folder mutations flush workspace persistence immediately', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const packsSrc = await fs.readFile(packsScreenPath, 'utf8');
  const createStart = packsSrc.indexOf('function openCreateFolderModal()');
  const createEnd = packsSrc.indexOf('\n    function openRenameFolderModal', createStart + 1);
  const createBlock = createStart >= 0 && createEnd > createStart ? packsSrc.slice(createStart, createEnd) : '';
  const renameStart = packsSrc.indexOf('function openRenameFolderModal(folder)');
  const renameEnd = packsSrc.indexOf('\n    async function deleteFolderWithConfirm', renameStart + 1);
  const renameBlock = renameStart >= 0 && renameEnd > renameStart ? packsSrc.slice(renameStart, renameEnd) : '';
  const deleteStart = packsSrc.indexOf('async function deleteFolderWithConfirm(folder)');
  const deleteEnd = packsSrc.indexOf('\n    function movePackToFolder(', deleteStart + 1);
  const deleteBlock = deleteStart >= 0 && deleteEnd > deleteStart ? packsSrc.slice(deleteStart, deleteEnd) : '';
  const moveStart = packsSrc.indexOf('function movePackToFolder(');
  const moveEnd = packsSrc.indexOf('\n    function openMoveToFolderModal(pack)', moveStart + 1);
  const moveBlock = moveStart >= 0 && moveEnd > moveStart ? packsSrc.slice(moveStart, moveEnd) : '';

  assert.match(appSrc, /persistNow:\s*\(\) => Storage\.saveNow\(\)/,
    'app.js must pass an immediate workspace save callback into the Packs screen');
  assert.match(packsSrc, /function persistFolderStateNow\(\)[\s\S]{0,180}persistNow\(\)/,
    'Packs screen must expose a narrow immediate persistence helper');
  assert.match(createBlock, /FolderLibrary\.createFolder\(folderName\)[\s\S]{0,80}persistFolderStateNow\(\)/,
    'Create Folder must flush persistence immediately after StateStore mutation');
  assert.match(renameBlock, /FolderLibrary\.renameFolder\(folderId, name\.input\.value\)[\s\S]{0,180}persistFolderStateNow\(\)/,
    'Rename Folder must flush persistence immediately after StateStore mutation');
  assert.match(deleteBlock, /FolderLibrary\.deleteFolder\(folderId\)[\s\S]{0,180}persistFolderStateNow\(\)/,
    'Delete Folder must flush persistence immediately after StateStore mutation');
  assert.match(moveBlock, /FolderLibrary\.movePackToFolder\(pack\.id, folderIdOrNull\)[\s\S]{0,180}persistFolderStateNow\(\)/,
    'Move Pack to Folder must flush persistence immediately after StateStore mutation');
});

test('phase 0.7C-4B compact move modal replaces inline folder menu section', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const modalStart = src.indexOf('function openMoveToFolderModal(pack)');
  const modalEnd = src.indexOf('\n    function openFoldersDropdown()', modalStart + 1);
  const modalBlock = modalStart >= 0 && modalEnd > modalStart ? src.slice(modalStart, modalEnd) : '';

  assert.ok(modalBlock.length > 0,
    'openMoveToFolderModal(pack) must exist');
  assert.match(modalBlock, /UIComponents\.showModal\(/,
    'Move to Folder choices must be shown in a modal');
  assert.match(modalBlock, /addMoveRow\(['"]Unfiled['"], ['"]fa-solid fa-folder-open['"], null/,
    'Move modal must include Unfiled target');
  assert.match(modalBlock, /folders\.forEach\(folder =>/,
    'Move modal must list real folders inside the modal');
  assert.match(modalBlock, /empty\.textContent = ['"]No folders yet['"]/,
    'Move modal must show disabled empty state when no folders exist');
  assert.doesNotMatch(src, /function buildMoveFolderItems\(pack\)|\.\.\.buildMoveFolderItems\(pack\)/,
    'main pack menus must no longer inline every folder through buildMoveFolderItems');
});

test('phase 0.7C-4B both pack menus contain one compact Move to Folder action', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const listStart = src.indexOf('function renderListView(packs)');
  const listEnd = src.indexOf('\n    function renderGridView(packs)', listStart + 1);
  const listBlock = listStart >= 0 && listEnd > listStart ? src.slice(listStart, listEnd) : '';
  const gridStart = src.indexOf('function renderGridView(packs)');
  const gridEnd = src.indexOf('\n    function buildPreview(', gridStart + 1);
  const gridBlock = gridStart >= 0 && gridEnd > gridStart ? src.slice(gridStart, gridEnd) : '';

  assert.equal((listBlock.match(/label:\s*['"]Move to Folder['"]/g) || []).length, 1,
    'list menu must contain exactly one Move to Folder action');
  assert.equal((gridBlock.match(/label:\s*['"]Move to Folder['"]/g) || []).length, 1,
    'grid menu must contain exactly one Move to Folder action');
  assert.match(listBlock, /label:\s*['"]Move to Folder['"][\s\S]{0,160}icon:\s*['"]fa-solid fa-folder-open['"][\s\S]{0,160}openMoveToFolderModal\(pack\)/,
    'list Move to Folder action must open the modal helper');
  assert.match(gridBlock, /label:\s*['"]Move to Folder['"][\s\S]{0,160}icon:\s*['"]fa-solid fa-folder-open['"][\s\S]{0,160}openMoveToFolderModal\(pack\)/,
    'grid Move to Folder action must open the modal helper');
  assert.doesNotMatch(listBlock + gridBlock, /type:\s*['"]header['"], label:\s*['"]Move to folder['"]|rightIcon:\s*active \? ['"]fa-solid fa-check['"]/,
    'main pack menus must not contain inline folder choices');
});

test('phase 0.7C-4B folder CRUD and move APIs remain wired from Packs screen only', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const { stdout } = await execFileAsync('git', ['grep', '-n', 'FolderLibrary.movePackToFolder(', '--', 'src']);
  const callers = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  assert.ok(callers.length >= 1,
    'FolderLibrary.movePackToFolder must be called from source');
  assert.ok(callers.every(line => line.startsWith('src/screens/packs-screen.js:')),
    'FolderLibrary.movePackToFolder must only be called by the Packs screen UI');
  assert.match(src, /FolderLibrary\.createFolder\(folderName\)/,
    'Create Folder must remain wired');
  assert.match(src, /FolderLibrary\.renameFolder\(folderId, name\.input\.value\)/,
    'Rename Folder must remain wired');
  assert.match(src, /FolderLibrary\.deleteFolder\(folderId\)/,
    'Delete Folder must remain wired');
});

test('phase 0.7C-4B rename delete stay guarded to active real folders only', async () => {
  const src = await fs.readFile(packsScreenPath, 'utf8');
  const start = src.indexOf('function openFoldersDropdown()');
  const end = src.indexOf('\n    function initListHeaderSort()', start + 1);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  const actionsStart = block.indexOf('if (model.activeFolder && activeFolderId)');
  const actionsEnd = block.indexOf("label: 'New Folder'", actionsStart + 1);
  const actionsBlock = actionsStart >= 0 && actionsEnd > actionsStart ? block.slice(actionsStart, actionsEnd) : '';

  assert.match(actionsBlock, /if \(model\.activeFolder && activeFolderId\)/,
    'folder management actions must require a resolved active real folder');
  assert.match(actionsBlock, /openRenameFolderModal\(model\.activeFolder\)/,
    'Rename Folder action must target the active real folder');
  assert.match(actionsBlock, /deleteFolderWithConfirm\(model\.activeFolder\)/,
    'Delete Folder action must target the active real folder');
});

// ============================================================================
// Phase 0: Shared placement validation helpers (pack-library.js exports)
// ============================================================================

test('placement-settle-0 pack-library exports PLACEMENT_EPS, MIN_SUPPORT_FRACTION, computeSupportFraction', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(typeof PackLibrary.PLACEMENT_EPS, 'number',
    'PLACEMENT_EPS must be a named number export');
  assert.equal(PackLibrary.PLACEMENT_EPS, 0.001,
    'PLACEMENT_EPS must be 0.001 to match existing solver and pack-library overlap checks');
  assert.equal(typeof PackLibrary.MIN_SUPPORT_FRACTION, 'number',
    'MIN_SUPPORT_FRACTION must be a named number export');
  assert.equal(PackLibrary.MIN_SUPPORT_FRACTION, 0.5,
    'MIN_SUPPORT_FRACTION must be 0.5 to match autopack-solver requirement');
  assert.equal(typeof PackLibrary.computeSupportFraction, 'function',
    'computeSupportFraction must be a named function export');
});

test('placement-settle-0 computeSupportFraction full footprint support returns 1', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // 20×20 candidate (inches) resting exactly on a 20×20 supporter
  const candidate = { min: { x: -10, y: 10, z: -10 }, max: { x: 10, y: 20, z: 10 } };
  const supporter = { min: { x: -10, y: 0,  z: -10 }, max: { x: 10, y: 10, z: 10 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [supporter]);
  assert.equal(frac, 1,
    'full footprint overlap must return fraction 1');
});

test('placement-settle-0 computeSupportFraction half support equals 0.5', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // 20×20 candidate; supporter covers only the left 10×20 half
  const candidate = { min: { x: 0, y: 10, z: -10 }, max: { x: 20, y: 20, z: 10 } };
  const supporter = { min: { x: 0, y: 0,  z: -10 }, max: { x: 10, y: 10, z: 10 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [supporter]);
  assert.ok(Math.abs(frac - 0.5) < 1e-9,
    'half-footprint overlap must return fraction 0.5');
});

test('placement-settle-0 computeSupportFraction tiny corner is below MIN_SUPPORT_FRACTION', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // 20×20 candidate; supporter overlaps only a 1×1 corner (1/400 = 0.25% of footprint)
  const candidate = { min: { x: 0,  y: 10, z: 0  }, max: { x: 20, y: 20, z: 20 } };
  const supporter = { min: { x: 19, y: 0,  z: 19 }, max: { x: 21, y: 10, z: 21 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [supporter]);
  assert.ok(frac < PackLibrary.MIN_SUPPORT_FRACTION,
    'tiny 1×1 corner overlap on 20×20 footprint must be below MIN_SUPPORT_FRACTION');
});

test('placement-settle-0 computeSupportFraction no supporters returns 0', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const candidate = { min: { x: -10, y: 10, z: -10 }, max: { x: 10, y: 20, z: 10 } };
  assert.equal(PackLibrary.computeSupportFraction(candidate, []), 0,
    'empty supporter list must return fraction 0');
  assert.equal(PackLibrary.computeSupportFraction(candidate, null), 0,
    'null supporter list must return fraction 0 (floor fallback handled by caller)');
});

test('placement-settle-0 computeSupportFraction ignores Y-misaligned supporters', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  // Candidate bottom at y=10; supporter top at y=5 (5 inches gap — not flush)
  const candidate = { min: { x: -10, y: 10, z: -10 }, max: { x: 10, y: 20, z: 10 } };
  const floatingBelow = { min: { x: -10, y: 0,  z: -10 }, max: { x: 10, y: 5,  z: 10 } };
  const frac = PackLibrary.computeSupportFraction(candidate, [floatingBelow]);
  assert.equal(frac, 0,
    'supporter whose top is not flush with candidate bottom must be ignored');
});

// ============================================================================
// Phase 1: computeSettleY (pure gravity function exported from editor-screen.js)
// ============================================================================

test('placement-settle-1 computeSettleY is exported from editor-screen', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(typeof EditorScreen.computeSettleY, 'function',
    'computeSettleY must be a named export of editor-screen');
});

test('placement-settle-1 computeSettleY with no other boxes settles to floor', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };
  const y = EditorScreen.computeSettleY(half, 0, 0, [], 0.5);
  assert.equal(y, 12,
    'floor fallback must equal halfWorld.y when there are no supporters');
});

test('placement-settle-1 computeSettleY full support settles on top of box', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };
  // Supporter: wide box with top at y=24
  const supporter = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 24, z: 24 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [supporter], 0.5);
  assert.equal(y, 36,
    'candidate center must be supporter.max.y + halfY when fully supported');
});

test('placement-settle-1 computeSettleY half support is accepted', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  // Candidate: 24×24 footprint centered at x=0
  const half = { x: 12, y: 12, z: 12 };
  // Supporter covers exactly the left half (50% of candidate footprint)
  const halfSupporter = { min: { x: -12, y: 0, z: -12 }, max: { x: 0, y: 24, z: 12 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [halfSupporter], 0.5);
  assert.equal(y, 36,
    '50% footprint support must be accepted and settle on top of box');
});

test('placement-settle-1 computeSettleY tiny corner support is rejected and falls to floor', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  // Candidate: 24×24 footprint centered at x=0, z=0
  const half = { x: 12, y: 12, z: 12 };
  // Tiny 1×1 corner overlap at the edge — well below 50%
  const tinyCorner = { min: { x: 11.5, y: 0, z: 11.5 }, max: { x: 13, y: 24, z: 13 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [tinyCorner], 0.5);
  assert.equal(y, 12,
    'tiny corner overlap must be rejected; candidate must fall to floor (halfY)');
});

test('placement-settle-1 computeSettleY picks highest valid support among multiple boxes', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const half = { x: 12, y: 12, z: 12 };
  const low  = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 12, z: 24 } }; // top at 12
  const high = { min: { x: -24, y: 0, z: -24 }, max: { x: 24, y: 24, z: 24 } }; // top at 24
  const y = EditorScreen.computeSettleY(half, 0, 0, [low, high], 0.5);
  assert.equal(y, 36,
    'must pick the highest valid surface (top=24 + halfY=12 = 36)');
});

test('placement-settle-1 computeSettleY result is never below floor', async () => {
  const EditorScreen = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  // Supporter below floor level (top at y=-5) — should be ignored; candidate falls to floor
  const half = { x: 12, y: 12, z: 12 };
  const belowFloor = { min: { x: -24, y: -20, z: -24 }, max: { x: 24, y: -5, z: 24 } };
  const y = EditorScreen.computeSettleY(half, 0, 0, [belowFloor], 0.5);
  assert.ok(y >= half.y,
    'settled Y must never be below floor (halfY) even with below-floor supporters');
});

test('placement-settle-1 editor-screen settleY uses MIN_SUPPORT_FRACTION from pack-library', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /import\s*\{[^}]*MIN_SUPPORT_FRACTION[^}]*\}\s*from\s*['"]\.\.\/services\/pack-library\.js['"]/,
    'editor-screen must import MIN_SUPPORT_FRACTION from pack-library');
  assert.match(src, /MIN_SUPPORT_FRACTION/,
    'settleY must reference MIN_SUPPORT_FRACTION (not a magic 0.5 literal)');
  assert.match(src, /export function computeSettleY\(/,
    'computeSettleY must be an exported named function');
  assert.match(src, /return computeSettleY\(/,
    'inner settleY must delegate to computeSettleY');
});

test('placement-settle-1 rotate/flip paths still call settleY before saving position', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  // rotateSelection block: settleY must be called before PackLibrary.updateInstance
  const rotateStart = src.indexOf('function rotateSelection(');
  assert.ok(rotateStart >= 0, 'rotateSelection must exist');
  const rotateEnd = src.indexOf('\n    function ', rotateStart + 1);
  const rotateBlock = rotateEnd > rotateStart ? src.slice(rotateStart, rotateEnd) : src.slice(rotateStart);
  const settlePos = rotateBlock.indexOf('settleY(');
  const savePos = rotateBlock.indexOf('PackLibrary.updateInstance(');
  assert.ok(settlePos >= 0, 'rotateSelection must call settleY');
  assert.ok(savePos >= 0, 'rotateSelection must call PackLibrary.updateInstance');
  assert.ok(settlePos < savePos,
    'rotateSelection must call settleY before PackLibrary.updateInstance');
});

// ─── P0-A: Inspector rotate/flip routing ────────────────────────────────────

test('placement-safety-P0A single inspector Rotate/Flip routes through rotateSelection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleStart = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)');
  const singleEnd = src.indexOf('\n    /**\n     * Creates a card header row', singleStart);
  const singleBlock = singleStart >= 0 && singleEnd > singleStart ? src.slice(singleStart, singleEnd) : '';

  assert.match(singleBlock, /InteractionManager\.rotateSelection\(axis,\s*delta\)/,
    'single inspector rotate/flip buttons must route through InteractionManager.rotateSelection');
  // The deferred rAF+double-updateInstance pattern without collision guard must be gone.
  // (rotateSelection handles settle + collision check internally before any persist.)
  assert.doesNotMatch(singleBlock, /requestAnimationFrame[\s\S]{0,300}PackLibrary\.updateInstance[\s\S]{0,300}rotation:/,
    'single inspector rotate/flip must not persist rotation via deferred rAF without collision guard');
});

test('placement-safety-P0A multi-select Rotate All routes through rotateSelection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const multiStart = src.indexOf('function renderMultiInspector(pack, selected)');
  const multiEnd = src.indexOf('// === Actions Card ===', multiStart);
  const multiBlock = multiStart >= 0 && multiEnd > multiStart ? src.slice(multiStart, multiEnd) : '';

  assert.match(multiBlock, /InteractionManager\.rotateSelection\(axis,\s*delta\)/,
    'multi-select Rotate All must route through InteractionManager.rotateSelection');
  assert.doesNotMatch(multiBlock, /selected\.forEach[\s\S]*PackLibrary\.updateInstance/,
    'multi-select Rotate All must not iterate selected items and directly call PackLibrary.updateInstance');
});

// ─── P0-B: applyTransform always resets halfWorld ────────────────────────────

test('placement-safety-P0B createInstanceGroup stores baseHalfWorld for reset fallback', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const createStart = src.indexOf('function createInstanceGroup(inst, caseData)');
  const createEnd = src.indexOf('\n    function ', createStart + 1);
  const createBlock = createEnd > createStart ? src.slice(createStart, createEnd) : src.slice(createStart);

  assert.match(createBlock, /group\.userData\.baseHalfWorld\s*=\s*\{/,
    'createInstanceGroup must store baseHalfWorld so applyTransform can reset to base dims');
});

test('placement-safety-P0B applyTransform resets halfWorld to base dims when orientedDims absent', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const applyStart = src.indexOf('function applyTransform(group, inst)');
  const applyEnd = src.indexOf('\n    function ', applyStart + 1);
  const applyBlock = applyEnd > applyStart ? src.slice(applyStart, applyEnd) : src.slice(applyStart);

  assert.match(applyBlock, /else if \(group\.userData\.baseHalfWorld\)/,
    'applyTransform must have an else-if branch to reset halfWorld from baseHalfWorld when orientedDims absent');
  assert.match(applyBlock, /group\.userData\.halfWorld\s*=\s*\{\s*\.\.\.\s*group\.userData\.baseHalfWorld\s*\}/,
    'applyTransform must spread baseHalfWorld into halfWorld on the reset path');
});

// ─── P0-C: staged/unpacked items do not inherit stale orientedDims ───────────

test('placement-safety-P0C getStagingDims uses solver orientations and case dims, not stale inst.orientedDims', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const stagingStart = src.indexOf('function getStagingDims(item)');
  const stagingEnd = src.indexOf('\n  function buildStagingMap', stagingStart);
  const stagingBlock = stagingStart >= 0 && stagingEnd > stagingStart ? src.slice(stagingStart, stagingEnd) : '';

  assert.doesNotMatch(stagingBlock, /item\.inst\.orientedDims/,
    'getStagingDims must not read stale inst.orientedDims from a previous AutoPack run');
  assert.match(stagingBlock, /item\.orientations\[0\]/,
    'getStagingDims must use fresh solver orientation candidates as first source');
  assert.match(stagingBlock, /item\.caseData\.dimensions/,
    'getStagingDims must fall back to base case dimensions');
});

test('placement-safety-P0C nextCases loop deletes stale orientedDims from staged items', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const persistStart = src.indexOf('const nextCases = (packData.cases || []).map(inst => {');
  const persistEnd = src.indexOf('\n      PackLibrary.update(packId, { cases: nextCases });', persistStart);
  const persistBlock = persistStart >= 0 && persistEnd > persistStart ? src.slice(persistStart, persistEnd) : '';

  assert.match(persistBlock, /delete next\.orientedDims/,
    'nextCases must delete stale orientedDims on staged items when no fresh solver dims exist');
  assert.match(persistBlock, /if \(od\)[\s\S]*next\.orientedDims = od/,
    'nextCases must still write fresh orientedDims for packed items from orientedDimsMap');
  assert.match(persistBlock, /else[\s\S]*delete next\.orientedDims/,
    'nextCases else branch must delete orientedDims so applyTransform resets to base dims');
});

// ─── P1-A: orientation policy parity — manual rotate must respect caseData.orientationLock ──

test('placement-safety-P1A isOrientationAllowedByCasePolicy exported from pack-library', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.strictEqual(typeof PackLibrary.isOrientationAllowedByCasePolicy, 'function',
    'isOrientationAllowedByCasePolicy must be exported from pack-library.js');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy blocks X-rotation for upright-lock case', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  const result = PackLibrary.isOrientationAllowedByCasePolicy(
    { orientationLock: 'upright' },
    { x: halfPI, y: 0, z: 0 }
  );
  assert.strictEqual(result, false,
    'upright-locked case must reject X-axis rotation (would tip on its side)');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy blocks Z-rotation for upright-lock case', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  const result = PackLibrary.isOrientationAllowedByCasePolicy(
    { orientationLock: 'upright' },
    { x: 0, y: 0, z: halfPI }
  );
  assert.strictEqual(result, false,
    'upright-locked case must reject Z-axis rotation (would tip on its side)');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy allows Y-rotation for upright-lock case', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  const result = PackLibrary.isOrientationAllowedByCasePolicy(
    { orientationLock: 'upright' },
    { x: 0, y: halfPI, z: 0 }
  );
  assert.strictEqual(result, true,
    'upright-locked case must allow Y-axis rotation (stays flat, just turns)');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy allows all rotations when lock is missing or "any"', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // No lock set — default 'any' — must not block TVs, mattresses, doors, flat panels
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({}, { x: halfPI, y: 0, z: 0 }), true,
    'no-lock case must allow X rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({}, { x: 0, y: halfPI, z: 0 }), true,
    'no-lock case must allow Y rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({}, { x: 0, y: 0, z: halfPI }), true,
    'no-lock case must allow Z rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'any' }, { x: halfPI, y: 0, z: 0 }), true,
    'explicit "any" lock must allow X rotation');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy handles onside and on-side consistently', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // 'onside' and 'on-side' must be treated identically
  // onside allows X/Z rotations but blocks Y-only (upright) orientation
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'onside' }, { x: halfPI, y: 0, z: 0 }), true,
    '"onside" must allow X rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'on-side' }, { x: halfPI, y: 0, z: 0 }), true,
    '"on-side" must allow X rotation (normalized same as "onside")');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'onside' }, { x: 0, y: halfPI, z: 0 }), false,
    '"onside" must block pure Y rotation (upright orientation not allowed)');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'on-side' }, { x: 0, y: 0, z: 0 }), false,
    '"on-side" must block the neutral upright orientation');
});

test('placement-safety-P1A rotateSelection checks orientation policy before CaseScene.getObject mutation', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const fnStart = src.indexOf('function rotateSelection(axis, delta)');
  const fnEnd = src.indexOf('\n    /**', fnStart + 1);
  const fnBlock = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart, fnStart + 2000);

  assert.match(fnBlock, /isOrientationAllowedByCasePolicy/,
    'rotateSelection must call isOrientationAllowedByCasePolicy');
  assert.match(fnBlock, /policyBlockedCount\s*\+=\s*1/,
    'rotateSelection must track policy-blocked items separately from collision-blocked items');
  // Policy check must come before getObject so no scene mutation occurs for rejected items
  const policyPos = fnBlock.indexOf('isOrientationAllowedByCasePolicy');
  const getObjPos = fnBlock.indexOf('CaseScene.getObject(id)');
  assert.ok(policyPos >= 0 && getObjPos >= 0 && policyPos < getObjPos,
    'isOrientationAllowedByCasePolicy check must appear before CaseScene.getObject in rotateSelection');
  // Confirm policy-blocked path cannot reach PackLibrary.updateInstance
  // The early return exits the forEach callback before any scene writes
  assert.doesNotMatch(
    fnBlock.slice(policyPos, fnBlock.indexOf('return;', policyPos) + 7),
    /PackLibrary\.updateInstance/,
    'the policy-blocked early-return path must not call PackLibrary.updateInstance'
  );
});

// ─── rotateVectorXYZ Euler order (Z→Y→X matches THREE.js Euler 'XYZ') ───────
// Single-axis smoke tests confirm existing behavior is unchanged.
// Compound-rotation tests confirm the fix: wrong X→Y→Z order caused the
// dominant axis to be misidentified, producing halfWorld.y ≈ 6" for a 120"
// truss → settle height 6" → visual bottom at −54" below floor.

test('placement-safety-euler-order getOrientedDimsForRotation single-axis Y unchanged', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // Y-only rotate swaps length↔width; height stays 30 — identical for any application order
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 48, width: 24, height: 30 },
    { x: 0, y: halfPI, z: 0 }
  );
  assert.deepEqual(result, { length: 24, width: 48, height: 30 },
    'Y-only rotation must swap length and width; height must be unchanged');
});

test('placement-safety-euler-order getOrientedDimsForRotation single-axis X unchanged', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // X-only rotate swaps width↔height; length stays 48 — identical for any application order
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 48, width: 24, height: 30 },
    { x: halfPI, y: 0, z: 0 }
  );
  assert.deepEqual(result, { length: 48, width: 30, height: 24 },
    'X-only rotation must swap width and height; length must be unchanged');
});

test('placement-safety-euler-order getOrientedDimsForRotation compound Y+Z truss must give correct height', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // A 120"×12"×12" truss standing upright (height=120) after Z-rotation then Y-rotation:
  // The long axis must end up in the Y-world direction (height 120) so settleY=60 (floor at y=0).
  // Old X→Y→Z order produced {length:12, height:12, width:120} → settleY=6 → visual bottom −54" below floor.
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 120, width: 12, height: 12 },
    { x: 0, y: halfPI, z: halfPI }
  );
  assert.deepEqual(result, { length: 12, height: 120, width: 12 },
    'compound Y+Z rotation must raise the 120" axis into the vertical (height) slot so settleY=60 keeps the case on the floor');
});

test('placement-safety-euler-order getOrientedDimsForRotation compound X+Z gives THREE.js-correct AABB', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // Verified against THREE.js matrix Rx*Ry*Rz applied to each local axis vector:
  //   length {48,0,0} → Rz→Ry→Rx → {0,0,48}  (contributes z=48 → width)
  //   height {0,30,0} → Rz→Ry→Rx → {-30,0,0} (contributes x=30 → length)
  //   width  {0,0,24} → Rz→Ry→Rx → {0,-24,0} (contributes y=24 → height)
  // Old X→Y→Z order: {length:24, height:48, width:30} — wrong; height≠visual height
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 48, width: 24, height: 30 },
    { x: halfPI, y: 0, z: halfPI }
  );
  assert.deepEqual(result, { length: 30, height: 24, width: 48 },
    'compound X+Z rotation AABB must match THREE.js matrix Rx*Ry*Rz applied in Rz-first order');
});

// ── G1.1B-SCENE-CUE-CLEANUP ──────────────────────────────────────────────────

test('G1.1B-SCENE-CUE-CLEANUP scene cue cleanup lives in scene-runtime.js and is not duplicated into AutoPack', async () => {
  const [sceneSrc, autopackEngineSrc, autopackSolverSrc] = await Promise.all([
    fs.readFile(sceneRuntimePath, 'utf8'),
    fs.readFile(autoPackEnginePath, 'utf8'),
    fs.readFile(autoPackSolverPath, 'utf8'),
  ]);

  // Source-of-truth markers for the G1.1B scene-cue cleanup: the seam-trim
  // helper and the tuned door/cab end-cap cue materials must live in
  // scene-runtime.js (the owner module for scene visuals).
  assert.match(sceneSrc, /function trimSeamEdges\(edgesGeo, seamLocalXs\)/,
    'scene-runtime.js must own the G1.1B seam-trim helper (trimSeamEdges)');
  assert.match(sceneSrc, /const doorLineMat = new THREE\.LineBasicMaterial\(/,
    'scene-runtime.js must own the G1.1B rear/loading-door end-cap cue material (doorLineMat)');
  assert.match(sceneSrc, /const cabLineMat = new THREE\.LineBasicMaterial\(/,
    'scene-runtime.js must own the G1.1B front/cab end-cap cue material (cabLineMat)');

  assert.doesNotMatch(autopackEngineSrc, /trimSeamEdges|doorLineMat|cabLineMat/,
    'G1.1B scene-cue cleanup must not be duplicated into src/services/autopack-engine.js');
  assert.doesNotMatch(autopackSolverSrc, /trimSeamEdges|doorLineMat|cabLineMat/,
    'G1.1B scene-cue cleanup must not be duplicated into src/services/autopack-solver.js');
});

test('G1.1B-SCENE-CUE-CLEANUP scene-runtime defines no ArrowHelper or other large default direction-arrow indicators', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.doesNotMatch(src, /ArrowHelper/,
    'scene-runtime must not add THREE.ArrowHelper-based direction indicators to the default scene');
  assert.doesNotMatch(src, /Arrow/,
    'scene-runtime must not define arrow-shaped direction indicators');
});

test('G1.1B-SCENE-CUE-CLEANUP direction-cue and shape-guide code paths use no THREE.Sprite or CSS2D labels', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Direction-cue block (door/cab end-cap line materials).
  const cuesStart = src.indexOf('const doorLineMat = new THREE.LineBasicMaterial(');
  const cuesEnd = src.indexOf('maxXLineMat: cabLineMat', cuesStart);
  const cuesBlock = cuesStart >= 0 && cuesEnd > cuesStart ? src.slice(cuesStart, cuesEnd) : '';
  assert.ok(cuesBlock, 'direction-cue setup block must be present in setTruck');
  assert.doesNotMatch(cuesBlock, /THREE\.Sprite|CSS2DObject/,
    'rear/front end-cap direction cues must not use THREE.Sprite or CSS2DObject');

  // Cab-void / wheel-well guide-box block.
  const guidesStart = src.indexOf('function updateTrailerShapeGuides(truckInches)');
  const guidesEnd = src.indexOf('\n    function addTrailerVolume', guidesStart);
  const guidesBlock = guidesStart >= 0 && guidesEnd > guidesStart ? src.slice(guidesStart, guidesEnd) : '';
  assert.ok(guidesBlock, 'updateTrailerShapeGuides must be defined in scene-runtime.js');
  assert.doesNotMatch(guidesBlock, /THREE\.Sprite|CSS2DObject/,
    'cab-void/wheel-well blocked-zone guides must not use THREE.Sprite or CSS2DObject');

  assert.doesNotMatch(src, /CSS2DRenderer|CSS2DObject/,
    'scene-runtime must not introduce CSS2D label rendering');
});

test('G1.1B-SCENE-CUE-CLEANUP end-cap direction cues remain subtle (reduced opacity) but still distinct and correctly mapped', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const src = await fs.readFile(sceneRuntimePath, 'utf8');
  const truck = { length: 240, width: 96, height: 72 };
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.equal(model.rear.value, 0, 'G1 direction model: rear/loading-door is x=0');
  assert.equal(model.front.value, truck.length, 'G1 direction model: front/cab is x=truck.length');

  // doorLineMat (green) maps to the rear/loading-door end (x=0, minX cap).
  assert.match(src, /const doorLineMat = new THREE\.LineBasicMaterial\(\{\s*color: new THREE\.Color\(0x26c97a\),\s*transparent: true,\s*opacity: 0\.9,/,
    'rear/loading-door end-cap cue must remain green and be tuned to opacity 0.9 (clearly visible, was 0.78)');
  assert.match(src, /minXLineMat: doorLineMat/,
    'main cargo box minX cap (x=0, rear/loading-door per G1 direction model) must use doorLineMat');

  // cabLineMat (red) maps to the front/cab end (the main box's maxX cap, or
  // the overhang's maxX cap when a frontBonus overhang is present).
  assert.match(src, /const cabLineMat = new THREE\.LineBasicMaterial\(\{\s*color: new THREE\.Color\(0xf7385c\),\s*transparent: true,\s*opacity: 0\.9,/,
    'front/cab end-cap cue must remain red and be tuned to opacity 0.9 (clearly visible, was 0.78)');
  assert.match(src, /maxXLineMat: bonus \? undefined : cabLineMat/,
    'main cargo box maxX cap (x=truck.length, front/cab per G1 direction model) must use cabLineMat when no overhang is present');
  assert.match(src, /maxXLineMat: cabLineMat/,
    'overhang volume maxX cap (front/cab side) must use cabLineMat when a frontBonus overhang is present');
});

test('G1.1B-SCENE-CUE-CLEANUP cab-void/wheel-well guide box intensity is reduced but still rendered (not removed)', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /addGuideBox\(group, z, \{ fillColor: 0xff3b30, lineColor: 0xff3b30, opacity: 0\.16, lineOpacity: 0\.55 \}\)/,
    'blocked/no-load guide box (cab void + wheel wells) must remain present with tuned opacity/lineOpacity (readable but translucent, was 0.13/0.48)');

  // Still wired up for both shape modes that rely on it.
  assert.match(src, /TrailerGeometry\.getWheelWellsBlockedZones\(truckInches\)/,
    'wheel-well blocked zones must still be rendered via the guide-box helper');
  assert.match(src, /TrailerGeometry\.getFrontBonusBlockedZones\(truckInches\)/,
    'frontBonus cab-void zone must still be rendered via the guide-box helper');
});

test('G1.1B-SCENE-CUE-CLEANUP front-overhang seam edges are trimmed without touching end-cap or geometry contracts', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // A dedicated, geometry-only helper trims the "ghost" outline edges left
  // at an omitted end cap (openMinX/openMaxX) - this is what removes the
  // extra internal divider/seam lines in Box + Front Overhang.
  assert.match(src, /function trimSeamEdges\(edgesGeo, seamLocalXs\)/,
    'a trimSeamEdges helper must exist to remove ghost seam-line edges at omitted end caps');

  const addTrailerVolumeStart = src.indexOf('function addTrailerVolume(');
  const addTrailerVolumeEnd = src.indexOf('\n    function setTruck(', addTrailerVolumeStart);
  const volumeBlock = addTrailerVolumeStart >= 0 && addTrailerVolumeEnd > addTrailerVolumeStart
    ? src.slice(addTrailerVolumeStart, addTrailerVolumeEnd)
    : '';
  assert.ok(volumeBlock, 'addTrailerVolume must be defined in scene-runtime.js');

  // Side walls and ceiling pass seamLocalXs derived from openMinX/openMaxX so
  // their edges are trimmed at a seam where an end cap was omitted.
  assert.match(volumeBlock, /const seamLocalXs = \[\];/,
    'addTrailerVolume must compute which local-X seam(s), if any, to trim');
  assert.match(volumeBlock, /if \(opts\.openMinX\) seamLocalXs\.push\(-lengthW \/ 2\);/,
    'an omitted minX end cap must trim the matching -lengthW/2 seam edge');
  assert.match(volumeBlock, /if \(opts\.openMaxX\) seamLocalXs\.push\(lengthW \/ 2\);/,
    'an omitted maxX end cap must trim the matching lengthW/2 seam edge');

  // End-cap faces (minX/maxX, which carry the door/cab direction cues when
  // present) must keep their full, untrimmed EdgesGeometry - only the
  // side-wall/ceiling seam edges are trimmed.
  const minXFaceEnd = volumeBlock.indexOf('opts.minXLineMat');
  const minXFaceBlock = volumeBlock.slice(0, minXFaceEnd);
  assert.match(minXFaceBlock, /new THREE\.EdgesGeometry\(geo\)/,
    'minX end-cap face must still call addFace without seam trimming');

  const maxXFaceStart = volumeBlock.indexOf('opts.openMaxX');
  const maxXFaceBlock = volumeBlock.slice(maxXFaceStart, volumeBlock.indexOf('seamLocalXs', maxXFaceStart));
  assert.doesNotMatch(maxXFaceBlock, /seamLocalXs/,
    'maxX end-cap face must not be passed seamLocalXs (direction cue outline stays intact)');
});

test('G1.1B-SCENE-CUE-CLEANUP cab-over/frontBonus geometry contracts remain untouched', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
  };

  const zones = PackLibrary.getTrailerUsableZones(truck);
  const overhangZone = zones.find(z => z.min.x === truck.length);
  assert.ok(overhangZone, 'frontBonus overhang usable zone must still start at x=truck.length');
  assert.equal(overhangZone.max.x, truck.length + truck.shapeConfig.bonusLength,
    'frontBonus overhang usable zone must still extend by bonusLength (geometry untouched by visual cue cleanup)');

  const blocked = PackLibrary.getFrontBonusBlockedZones(truck);
  assert.deepEqual(blocked[0], {
    min: { x: truck.length, y: 0, z: -truck.width / 2 },
    max: { x: truck.length + truck.shapeConfig.bonusLength, y: truck.shapeConfig.bonusHeight, z: truck.width / 2 },
  }, 'cab-void blocked zone must remain x:truck.length..truck.length+bonusLength, y:0..bonusHeight, full width');
});

// ── End G1.1B-SCENE-CUE-CLEANUP ───────────────────────────────────────────────

// ── G1.1C-EXTERIOR-RAILS ───────────────────────────────────────────────────────

test('G1.1C-EXTERIOR-RAILS exterior-rail helpers live in scene-runtime.js and are not duplicated elsewhere', async () => {
  const [sceneSrc, autopackEngineSrc, autopackSolverSrc, appSrc, packLibSrc, editorSrc] = await Promise.all([
    fs.readFile(sceneRuntimePath, 'utf8'),
    fs.readFile(autoPackEnginePath, 'utf8'),
    fs.readFile(autoPackSolverPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(packLibraryPath, 'utf8'),
    fs.readFile(editorScreenPath, 'utf8'),
  ]);

  // Source-of-truth markers for the G1.1C exterior rails: the rail-mesh
  // helpers and the truckOuterRails group must live in scene-runtime.js
  // (the owner module for scene visuals).
  assert.match(sceneSrc, /function addRailEdge\(group, a, b, material\)/,
    'scene-runtime.js must own the G1.1C addRailEdge helper');
  assert.match(sceneSrc, /function addBoxRails\(group, x0, x1, y0, y1, z0, z1, opts = \{\}\)/,
    'scene-runtime.js must own the G1.1C addBoxRails helper');
  assert.match(sceneSrc, /railsGroup\.name = 'truckOuterRails';/,
    'scene-runtime.js must own the G1.1C truckOuterRails group');

  const otherSources = {
    'src/services/autopack-engine.js': autopackEngineSrc,
    'src/services/autopack-solver.js': autopackSolverSrc,
    'src/app.js': appSrc,
    'src/services/pack-library.js': packLibSrc,
    'src/screens/editor-screen.js': editorSrc,
  };
  for (const [file, src] of Object.entries(otherSources)) {
    assert.doesNotMatch(src, /addRailEdge|addBoxRails|truckOuterRails/,
      `G1.1C exterior-rail helpers must not be duplicated into ${file}`);
  }
});

test('G1.1C-EXTERIOR-RAILS truck outer rails are built from mesh geometry, not line-only wireframe', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /function addRailEdge\(group, a, b, material\)/,
    'a rail-edge helper must exist for the mesh-based exterior rails');
  assert.match(src, /new THREE\.Mesh\(new THREE\.BoxGeometry\(sx, sy, sz\), material\)/,
    'each exterior rail must be a THREE.BoxGeometry mesh, not a LineSegments/EdgesGeometry overlay');

  assert.match(src, /function addBoxRails\(group, x0, x1, y0, y1, z0, z1, opts = \{\}\)/,
    'an addBoxRails helper must build the 12 outer-edge rails of an axis-aligned box');

  // truckOuterRails group exists and is added under the truck group.
  assert.match(src, /const railsGroup = new THREE\.Group\(\);\s*railsGroup\.name = 'truckOuterRails';/,
    'a truckOuterRails group must be created');
  assert.match(src, /truck\.add\(railsGroup\);/,
    'truckOuterRails group must be added under the truck group so existing disposal cleans it up');
});

test('G1.1C-EXTERIOR-RAILS introduces no sprites, CSS2D labels, or arrow indicators', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Scope to the new rail helpers + truckOuterRails construction block, not
  // the whole module (the axis gizmo elsewhere in scene-runtime.js already
  // legitimately uses THREE.Sprite and predates G1.1C).
  const railHelpersStart = src.indexOf('function addRailEdge(group, a, b, material)');
  const railHelpersEnd = src.indexOf('\n    function addTrailerVolume', railHelpersStart);
  const railHelpersBlock = railHelpersStart >= 0 && railHelpersEnd > railHelpersStart
    ? src.slice(railHelpersStart, railHelpersEnd)
    : '';
  assert.ok(railHelpersBlock, 'addRailEdge/addBoxRails helpers must be defined in scene-runtime.js');

  const railsGroupStart = src.indexOf("railsGroup.name = 'truckOuterRails'");
  const railsGroupEnd = src.indexOf('truck.add(railsGroup);', railsGroupStart);
  const railsGroupBlock = railsGroupStart >= 0 && railsGroupEnd > railsGroupStart
    ? src.slice(railsGroupStart, railsGroupEnd)
    : '';
  assert.ok(railsGroupBlock, 'truckOuterRails construction block must exist in setTruck');

  const railBlocks = `${railHelpersBlock}\n${railsGroupBlock}`;
  assert.doesNotMatch(railBlocks, /THREE\.Sprite|CSS2DObject|CSS2DRenderer/,
    'exterior rails must not use THREE.Sprite or CSS2D labels');
  assert.doesNotMatch(railBlocks, /ArrowHelper/,
    'exterior rails must not add THREE.ArrowHelper-based direction indicators');
  assert.doesNotMatch(railBlocks, /Arrow/,
    'exterior rails must not define arrow-shaped indicators');
});

test('G1.1C-EXTERIOR-RAILS standard/rect mode rails the main box with door (green) and cab (red) end-cap rails', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Rail materials reuse the same door/cab colors as the G2.2E/G1.1B
  // end-cap line cues, as solid mesh materials.
  assert.match(src, /const railDoorMat = new THREE\.MeshBasicMaterial\(\{\s*color: new THREE\.Color\(0x26c97a\),/,
    'rear/loading-door rail material must be green (0x26c97a)');
  assert.match(src, /const railCabMat = new THREE\.MeshBasicMaterial\(\{\s*color: new THREE\.Color\(0xf7385c\),/,
    'front/cab rail material must be red (0xf7385c)');
  assert.match(src, /const railAccentMat = new THREE\.MeshBasicMaterial\(\{\s*color: new THREE\.Color\(accent\),/,
    'long side/top/floor rails must use the neutral accent color');

  // Main box rail call wires minX -> door (green), maxX -> cab (red) when no
  // overhang is present, matching the G1 direction model (rear=x:0,
  // front=x:truck.length).
  assert.match(src, /addBoxRails\(railsGroup, 0, lengthW, 0, heightW, -widthW \/ 2, widthW \/ 2, \{\s*openMaxX: Boolean\(bonus\),\s*minXMat: railDoorMat,\s*maxXMat: bonus \? undefined : railCabMat,\s*sideMat: railAccentMat,\s*\}\)/,
    'main box outer rails must use railDoorMat at x=0 (rear) and railCabMat at x=truck.length (front) when no overhang is present');
});

test('G1.1C-EXTERIOR-RAILS frontBonus rails the stepped silhouette without railing the open internal seam', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Main box: maxX rails are skipped (openMaxX) when an overhang is
  // present, so the shared seam at x=lengthW is never railed - mirrors
  // addTrailerVolume's openMaxX/trimSeamEdges handling from G1.1B.
  const mainRailsMatch = src.match(/addBoxRails\(railsGroup, 0, lengthW, 0, heightW, -widthW \/ 2, widthW \/ 2, \{([\s\S]*?)\}\);/);
  assert.ok(mainRailsMatch, 'main box rail call must exist');
  assert.match(mainRailsMatch[1], /openMaxX: Boolean\(bonus\)/,
    'main box rails must skip the +X end-cap rails when a frontBonus overhang is present (open seam)');

  // Overhang volume: minX rails are skipped (openMinX), so the overhang
  // side of the same seam is also never railed.
  const bonusBlockStart = src.indexOf('if (bonus) {', src.indexOf('railsGroup.name'));
  const bonusBlockEnd = src.indexOf('truck.add(railsGroup);', bonusBlockStart);
  const bonusRailsBlock = bonusBlockStart >= 0 && bonusBlockEnd > bonusBlockStart
    ? src.slice(bonusBlockStart, bonusBlockEnd)
    : '';
  assert.ok(bonusRailsBlock, 'frontBonus rail block must exist');
  assert.match(bonusRailsBlock, /openMinX: true/,
    'overhang rails must skip the -X end-cap rails (open seam shared with the main box)');
  assert.match(bonusRailsBlock, /maxXMat: railCabMat/,
    'overhang far end cap (front-most, x=truck.length+bonusLength) must use railCabMat (red)');
});

test('G1.1C-EXTERIOR-RAILS wheel-well blocked guide zones are not railed as truck frame edges', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // The wheel-well blocked-zone guide boxes (addGuideBox + getWheelWellsBlockedZones)
  // must remain a separate translucent guide path, not part of addBoxRails.
  const guidesStart = src.indexOf('function updateTrailerShapeGuides(truckInches)');
  const guidesEnd = src.indexOf('\n    function trimSeamEdges', guidesStart);
  const guidesBlock = guidesStart >= 0 && guidesEnd > guidesStart ? src.slice(guidesStart, guidesEnd) : '';
  assert.ok(guidesBlock, 'updateTrailerShapeGuides must be defined in scene-runtime.js');
  assert.doesNotMatch(guidesBlock, /addBoxRails|addRailEdge|railsGroup/,
    'wheel-well/cab-void blocked-zone guides must not call the rail helpers');

  // The rail-building call sites (in setTruck) must not reference the
  // wheel-well/cab-void guide zone helpers.
  const railsGroupStart = src.indexOf("railsGroup.name = 'truckOuterRails'");
  const railsGroupEnd = src.indexOf('truck.add(railsGroup);', railsGroupStart);
  const railsBlock = railsGroupStart >= 0 && railsGroupEnd > railsGroupStart
    ? src.slice(railsGroupStart, railsGroupEnd)
    : '';
  assert.ok(railsBlock, 'truckOuterRails construction block must exist in setTruck');
  assert.doesNotMatch(railsBlock, /getWheelWellsBlockedZones|getFrontBonusBlockedZones|addGuideBox/,
    'truck outer rails must not be derived from wheel-well/cab-void blocked-zone guide geometry');
});

// ── End G1.1C-EXTERIOR-RAILS ───────────────────────────────────────────────────

// ── G1.2B-CASE-BROWSER-POLISH ────────────────────────────────────────────────

test('G1.2B-CASE-BROWSER-POLISH Case Browser cards are built by one shared helper, not duplicated per grouping', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.match(src, /function buildCaseBrowserCard\(c, lengthUnit, prefs, isSelected\)/,
    'a shared buildCaseBrowserCard(c, lengthUnit, prefs, isSelected) helper must exist');

  const addCaseCalls = src.match(/addCaseToPack\(c\.id\)/g) || [];
  assert.equal(addCaseCalls.length, 1,
    'addCaseToPack(c.id) must appear exactly once now that Category and Manufacturer card bodies share one helper');
});

test('G1.2B-CASE-BROWSER-POLISH selected-case cue is derived from selectedInstanceIds and the current pack', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const renderStart = src.indexOf('function renderCaseBrowser');
  const helperStart = src.indexOf('function buildCaseBrowserCard');
  assert.ok(renderStart >= 0 && helperStart > renderStart,
    'renderCaseBrowser and buildCaseBrowserCard must both be present in order');
  const renderBlock = src.slice(renderStart, helperStart);

  assert.match(renderBlock, /StateStore\.get\('selectedInstanceIds'\)/,
    'renderCaseBrowser must read selectedInstanceIds from StateStore');
  assert.match(renderBlock, /PackLibrary\.getById\(StateStore\.get\('currentPackId'\)\)/,
    'renderCaseBrowser must resolve the current pack via PackLibrary.getById(StateStore.get(\'currentPackId\'))');
  assert.match(renderBlock, /selectedCaseIds\.add\(inst\.caseId\)/,
    'renderCaseBrowser must map selected instance ids to their case ids via inst.caseId');
});

test('G1.2B-CASE-BROWSER-POLISH selected cue is applied per-card via selectedCaseIds.has(c.id)', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.match(src, /card\.classList\.toggle\('tp3d-editor-case-browser-card--selected', Boolean\(isSelected\)\)/,
    'buildCaseBrowserCard must toggle the selected modifier class based on isSelected');

  const callSites = src.match(/buildCaseBrowserCard\(c, lengthUnit, prefs, selectedCaseIds\.has\(c\.id\)\)/g) || [];
  assert.equal(callSites.length, 2,
    'both the Category and Manufacturer grouped branches must call buildCaseBrowserCard with selectedCaseIds.has(c.id)');
});

test('G1.2B-CASE-BROWSER-POLISH Case Browser cards add no staged/packed badges or thumbnails', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const helperStart = src.indexOf('function buildCaseBrowserCard');
  const helperEnd = src.indexOf('\n    function openEditorNewCaseModal', helperStart);
  const helperBlock = helperStart >= 0 && helperEnd > helperStart
    ? src.slice(helperStart, helperEnd)
    : '';
  assert.ok(helperBlock, 'buildCaseBrowserCard helper body must be locatable');

  assert.doesNotMatch(helperBlock, /staged|packed|Staged|Packed/,
    'buildCaseBrowserCard must not introduce staged/packed badges');
  assert.doesNotMatch(helperBlock, /<img|thumbnail|placeholder/i,
    'buildCaseBrowserCard must not introduce thumbnails or placeholder images');
});

test('G1.2B-CASE-BROWSER-POLISH manufacturer group header no longer uses inline style.cssText', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.doesNotMatch(src, /hdr\.style\.cssText/,
    'the manufacturer group header must not use hdr.style.cssText for layout/typography');
  assert.match(src, /hdr\.className = 'tp3d-editor-mfg-group-header'/,
    'the manufacturer group header must use the new tp3d-editor-mfg-group-header class');
});

test('G1.2B-CASE-BROWSER-POLISH Case Browser block introduces no new inline CSS beyond the existing category-dot color', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const renderStart = src.indexOf('function renderCaseBrowser');
  const helperStart = src.indexOf('function buildCaseBrowserCard');
  const helperEnd = src.indexOf('\n    function openEditorNewCaseModal', helperStart);
  const block = src.slice(renderStart, helperEnd);

  const styleAssignments = block.match(/\.style\.\w+\s*=/g) || [];
  assert.deepEqual(styleAssignments, ['.style.background ='],
    'the only inline style assignment in the Case Browser block must be the pre-existing catDot.style.background = catMeta.color pattern');
});

test('G1.2B-CASE-BROWSER-POLISH Add and drag-to-pack behavior is preserved in the shared card helper', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const helperStart = src.indexOf('function buildCaseBrowserCard');
  const helperEnd = src.indexOf('\n    function openEditorNewCaseModal', helperStart);
  const helperBlock = src.slice(helperStart, helperEnd);

  assert.match(helperBlock, /card\.draggable = true/,
    'cards must remain draggable');
  assert.match(helperBlock, /ev\.dataTransfer\.setData\('text\/plain', c\.id\)/,
    'dragstart must still set text/plain to the case id');
  assert.match(helperBlock, /addBtn\.addEventListener\('click', \(\) => addCaseToPack\(c\.id\)\)/,
    'the Add button must still call addCaseToPack(c.id)');
});

test('G1.2B-CASE-BROWSER-POLISH new CSS classes use existing design tokens only', async () => {
  const css = await fs.readFile(stylesMainPath, 'utf8');

  const selectedMatch = css.match(/\.tp3d-editor-case-browser-card--selected\s*\{([^}]*)\}/);
  assert.ok(selectedMatch, '.tp3d-editor-case-browser-card--selected must be defined in main.css');
  assert.match(selectedMatch[1], /var\(--accent-primary-25\)/,
    'the selected card border must use var(--accent-primary-25)');
  assert.match(selectedMatch[1], /var\(--accent-primary-12\)/,
    'the selected card background must use var(--accent-primary-12)');

  const headerMatch = css.match(/\.tp3d-editor-mfg-group-header\s*\{([^}]*)\}/);
  assert.ok(headerMatch, '.tp3d-editor-mfg-group-header must be defined in main.css');
  assert.match(headerMatch[1], /var\(--text-secondary\)/,
    'the manufacturer group header color must use var(--text-secondary)');
  assert.match(headerMatch[1], /var\(--text-xs\)/,
    'the manufacturer group header font-size must use var(--text-xs)');
  assert.match(headerMatch[1], /var\(--font-semibold\)/,
    'the manufacturer group header font-weight must use var(--font-semibold)');
});

// ── End G1.2B-CASE-BROWSER-POLISH ────────────────────────────────────────────

// ── G1.2C-INSPECTOR-CARD-POLISH ──────────────────────────────────────────────

test('G1.2C-INSPECTOR-CARD-POLISH Stats card uses label/value rows and keeps the same stat labels', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const statsStart = src.indexOf('const statsEl = document.createElement');
  const statsEnd = src.indexOf('card.appendChild(shapeRow)', statsStart);
  assert.ok(statsStart >= 0 && statsEnd > statsStart, 'the Stats card block must be locatable');
  const statsBlock = src.slice(statsStart, statsEnd);

  const labelValueRows = statsBlock.match(/<div class="row space-between">/g) || [];
  assert.equal(labelValueRows.length, 4,
    'Stats card must render exactly 4 label/value rows using the existing row space-between pattern');

  ['Cases loaded', 'Packed (in truck)', 'Volume used', 'Total weight'].forEach(label => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(statsBlock, new RegExp(`<span class="muted tp3d-editor-fs-sm">${escapedLabel}</span>`),
      `Stats card must keep the "${label}" label`);
  });

  assert.match(statsBlock, /\$\{stats\.totalCases\}/, 'Stats card must keep using stats.totalCases');
  assert.match(statsBlock, /\$\{stats\.packedCases\}/, 'Stats card must keep using stats.packedCases');
  assert.match(statsBlock, /\$\{stats\.volumePercent\.toFixed\(1\)\}%/, 'Stats card must keep using stats.volumePercent');
  assert.match(statsBlock, /\$\{Utils\.formatWeight\(stats\.totalWeight, prefs\.units\.weight\)\}/,
    'Stats card must keep using Utils.formatWeight(stats.totalWeight, ...)');

  assert.doesNotMatch(statsBlock, /ft³|ft3|capacity|cubicFt|packedVolume/i,
    'Stats card must not invent packed/capacity ft³ values');
});

test('G1.2C-INSPECTOR-CARD-POLISH PackLibrary.computeStats(pack) usage is unchanged', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const calls = src.match(/PackLibrary\.computeStats\(pack\)/g) || [];
  assert.equal(calls.length, 1, 'PackLibrary.computeStats(pack) must still be called exactly once in renderTruckInspector');
});

test('G1.2C-INSPECTOR-CARD-POLISH Rotate/Flip buttons keep the same axes/deltas and InteractionManager.rotateSelection routing', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const rotateCalls = src.match(/InteractionManager\.rotateSelection\(axis, delta\)/g) || [];
  assert.equal(rotateCalls.length, 2,
    'both the multi-selection and single-selection Rotate/Flip buttons must call InteractionManager.rotateSelection(axis, delta)');

  assert.match(src, /\{ label: 'Turn', icon: 'fa-rotate', tone: 'turn', axis: 'y', delta: halfPI \}/,
    'multi-selection Rotate All must keep the Turn/Y 90° axis/delta');
  assert.match(src, /\{ label: 'Tip', icon: 'fa-rotate-left', tone: 'tip', axis: 'x', delta: halfPI \}/,
    'multi-selection Rotate All must keep the Tip/X 90° axis/delta');
  assert.match(src, /\{ label: 'Roll', icon: 'fa-rotate-right', tone: 'roll', axis: 'z', delta: halfPI \}/,
    'multi-selection Rotate All must keep the Roll/Z 90° axis/delta');
  assert.match(src, /\{ label: 'Flip', icon: 'fa-arrows-up-down', tone: 'flip', axis: 'x', delta: Math\.PI \}/,
    'multi-selection Rotate All must keep the Flip axis/delta');

  assert.match(src, /\{ label: 'Turn', icon: 'fa-rotate', tone: 'turn', axis: 'y', delta: halfPI \}/,
    'single-selection Rotate / Flip must keep the Turn/Y 90° icon/axis/delta');
  assert.match(src, /\{ label: 'Tip', icon: 'fa-rotate-left', tone: 'tip', axis: 'x', delta: halfPI \}/,
    'single-selection Rotate / Flip must keep the Tip/X 90° icon/axis/delta');
  assert.match(src, /\{ label: 'Roll', icon: 'fa-rotate-right', tone: 'roll', axis: 'z', delta: halfPI \}/,
    'single-selection Rotate / Flip must keep the Roll/Z 90° icon/axis/delta');
  assert.match(src, /\{ label: 'Flip', icon: 'fa-arrows-up-down', tone: 'flip', axis: 'x', delta: Math\.PI \}/,
    'single-selection Rotate / Flip must keep the Flip icon/axis/delta');
});

test('G1.2C-INSPECTOR-CARD-POLISH Rotate/Flip icons remain FontAwesome (no SVG/emoji/custom icons) and have no stray leading-space text nodes', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const rotButtonMarkup = src.match(/<i class="fa-solid [^"]+"><\/i><span>\$\{label\}<\/span>/g) || [];
  assert.equal(rotButtonMarkup.length, 2,
    'both Rotate/Flip button blocks must render a FontAwesome <i> icon followed by a <span> label with no stray leading space');

  assert.doesNotMatch(src, /<\/i> \$\{label\}/,
    'Rotate/Flip button markup must not contain a stray leading-space text node before the label');

  const rotCardStart = src.indexOf('// === Batch Rotation Card ===');
  const rotCardEnd = src.indexOf('inspectorEl.appendChild(rotCard)');
  const singleRotCardStart = src.indexOf('// === Rotate / Flip Card ===');
  const singleRotCardEnd = src.indexOf('// === Actions Card ===', singleRotCardStart);
  const rotBlocks = src.slice(rotCardStart, rotCardEnd) + src.slice(singleRotCardStart, singleRotCardEnd);

  assert.doesNotMatch(rotBlocks, /<svg/i, 'Rotate/Flip controls must not introduce custom SVG icons');
  assert.doesNotMatch(rotBlocks, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    'Rotate/Flip controls must not introduce emoji icons');
});

test('G1.2C-INSPECTOR-CARD-POLISH Actions card preserves all six actions and Delete danger styling', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const multiStart = src.indexOf('function renderMultiInspector');
  const multiEnd = src.indexOf('function renderSingleInspector');
  const singleStart = multiEnd;
  const singleEnd = src.indexOf('function cardHeaderWithInfo');
  const multiBlock = src.slice(multiStart, multiEnd);
  const singleBlock = src.slice(singleStart, singleEnd);

  [multiBlock, singleBlock].forEach((block, idx) => {
    const label = idx === 0 ? 'multi-selection' : 'single-selection';
    assert.match(block, /label: 'Set Category'/, `${label} Actions card must keep Set Category`);
    assert.match(block, /makeVisibilityButton\(pack, /, `${label} Actions card must keep the Hide/Show visibility button`);
    assert.match(block, /makeSelectAllButton\(pack, /, `${label} Actions card must keep Select All`);
    assert.match(block, /label: 'Deselect'/, `${label} Actions card must keep Deselect`);
    assert.match(block, /label: 'Duplicate'/, `${label} Actions card must keep Duplicate`);
    assert.match(block, /danger: true/, `${label} Actions card must keep danger styling on Delete`);
  });

  assert.match(multiBlock, /onClick: \(\) => InteractionManager\.deleteSelection\(\)/,
    'multi-selection Delete must keep calling InteractionManager.deleteSelection()');
  assert.match(singleBlock, /PackLibrary\.removeInstances\(pack\.id, \[inst\.id\]\)/,
    'single-selection Delete must keep calling PackLibrary.removeInstances(pack.id, [inst.id])');
});

test('G1.2C-INSPECTOR-CARD-POLISH Actions card layout has no inline layout CSS', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.doesNotMatch(src, /configureActionGrid/,
    'configureActionGrid must be removed in favor of a CSS class');
  assert.doesNotMatch(src, /btn\.style\.(width|justifyContent|minWidth|whiteSpace)/,
    'makeActionButton must not set layout via inline styles');

  const actionGridAssignments = src.match(/actRow\.className = 'tp3d-editor-action-grid';/g) || [];
  assert.equal(actionGridAssignments.length, 2,
    'both the multi-selection and single-selection Actions cards must use the tp3d-editor-action-grid class');
});

test('G1.2C-INSPECTOR-CARD-POLISH new CSS additions reuse existing tokens and layout primitives', async () => {
  const css = await fs.readFile(stylesMainPath, 'utf8');

  const rotIconMatch = css.match(/\.tp3d-editor-rot-btn i\s*\{([^}]*)\}/);
  assert.ok(rotIconMatch, '.tp3d-editor-rot-btn i must be defined to give rotate/flip icons a fixed-width box');
  assert.doesNotMatch(rotIconMatch[1], /#[0-9a-fA-F]{3,6}/, '.tp3d-editor-rot-btn i must not introduce hard-coded colors');

  const actionGridMatch = css.match(/\.tp3d-editor-action-grid\s*\{([^}]*)\}/);
  assert.ok(actionGridMatch, '.tp3d-editor-action-grid must be defined');
  assert.match(actionGridMatch[1], /display:\s*grid/, '.tp3d-editor-action-grid must be a grid container');
  assert.match(actionGridMatch[1], /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    '.tp3d-editor-action-grid must keep the existing 2-column action layout');

  const actionGridBtnMatch = css.match(/\.tp3d-editor-action-grid \.btn\s*\{([^}]*)\}/);
  assert.ok(actionGridBtnMatch, '.tp3d-editor-action-grid .btn must be defined to replace the removed inline button styles');
  assert.doesNotMatch(actionGridBtnMatch[1], /#[0-9a-fA-F]{3,6}/,
    '.tp3d-editor-action-grid .btn must not introduce hard-coded colors');
});

test('G1.2C-INSPECTOR-CARD-POLISH Front Overhang usable-height hint is display-only and reuses existing values', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const overhangStart = src.indexOf("currentMode === 'frontBonus'");
  const overhangEnd = src.indexOf('cfgCard.appendChild(cfgHint)');
  assert.ok(overhangStart >= 0 && overhangEnd > overhangStart, 'the Front Overhang config block must be locatable');
  const overhangBlock = src.slice(overhangStart, overhangEnd);

  assert.match(overhangBlock, /const usableOverhangHeight = Math\.max\(0, tH - bonusHeight\)/,
    'usable overhang height must be derived from the existing tH and bonusHeight values only');
  assert.match(overhangBlock, /Utils\.inchesToUnit\(usableOverhangHeight, lengthUnit\)/,
    'usable overhang height must be formatted with the existing Utils.inchesToUnit helper');
  assert.doesNotMatch(overhangBlock, /TrailerGeometry\./,
    'usable overhang height must not call into TrailerGeometry geometry helpers');
});

test('G1.2C-INSPECTOR-CARD-POLISH G1.2B Case Browser polish remains intact', async () => {
  const [src, css] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(stylesMainPath, 'utf8'),
  ]);

  assert.match(src, /function buildCaseBrowserCard\(c, lengthUnit, prefs, isSelected\)/,
    'the G1.2B shared buildCaseBrowserCard helper must remain unchanged');
  assert.match(src, /card\.classList\.toggle\('tp3d-editor-case-browser-card--selected', Boolean\(isSelected\)\)/,
    'the G1.2B selected-case cue toggle must remain unchanged');
  assert.match(css, /\.tp3d-editor-case-browser-card--selected/,
    'the G1.2B selected-case CSS class must remain defined');
  assert.match(css, /\.tp3d-editor-mfg-group-header/,
    'the G1.2B manufacturer group header CSS class must remain defined');
});

test('G1.2C-INSPECTOR-CARD-POLISH Inspector help tooltip is anchored to its triggering icon, not a card-height offset', async () => {
  const css = await fs.readFile(stylesMainPath, 'utf8');

  assert.doesNotMatch(css, /top:\s*calc\(100% - \d+px\)/,
    'no Inspector tooltip rule may use a fragile card-height-based "top: calc(100% - Npx)" offset');
  assert.doesNotMatch(css, /tp3d-editor-transform-card>\.row\.space-between \.tp3d-editor-info-icon\s*\{[^}]*position:\s*absolute/s,
    'the old absolutely-positioned Transform-card info-icon override must be removed');

  const afterMatch = css.match(/#screen-editor \.tp3d-editor-info-icon\[data-tooltip\]::after\s*\{([^}]*)\}/);
  assert.ok(afterMatch, '#screen-editor .tp3d-editor-info-icon[data-tooltip]::after must define the anchored tooltip box');
  assert.match(afterMatch[1], /right:\s*calc\(100% \+ \d+px\)/,
    'the tooltip box must be anchored beside the triggering icon using right: calc(100% + Npx)');
  assert.match(afterMatch[1], /top:\s*50%/,
    'the tooltip box must be vertically anchored to the triggering icon');
  assert.match(afterMatch[1], /transform:\s*translateY\(-50%\)/,
    'the tooltip box must stay centered beside the triggering icon');

  const beforeMatch = css.match(/#screen-editor \.tp3d-editor-info-icon\[data-tooltip\]::before\s*\{([^}]*)\}/);
  assert.ok(beforeMatch, '#screen-editor .tp3d-editor-info-icon[data-tooltip]::before must define the tooltip arrow');
  assert.match(beforeMatch[1], /right:\s*calc\(100% \+ \d+px\)/,
    'the tooltip arrow must be anchored beside the triggering icon using right: calc(100% + Npx)');
  assert.match(beforeMatch[1], /border-left-color:\s*var\(--text-primary\)/,
    'the tooltip arrow must point from the tooltip box back toward the triggering icon');
});

test('G1.2C-INSPECTOR-CARD-POLISH Inspector help tooltip is compact and CSS-only', async () => {
  const css = await fs.readFile(stylesMainPath, 'utf8');

  const afterMatch = css.match(/#screen-editor \.tp3d-editor-info-icon\[data-tooltip\]::after\s*\{([^}]*)\}/);
  assert.ok(afterMatch, '#screen-editor .tp3d-editor-info-icon[data-tooltip]::after must define the tooltip box');
  assert.match(afterMatch[1], /max-width:\s*min\(220px, calc\(100vw - 48px\)\)/,
    'the tooltip box must keep a responsive max-width that shrinks on narrow viewports');
  assert.match(afterMatch[1], /white-space:\s*normal/,
    'the tooltip text must wrap naturally instead of forcing a single line');
  assert.doesNotMatch(css, /tp3d-editor-info-icon--tooltip-below/,
    'the rejected tooltip-below placement class must not remain in CSS');
});

test('G1.2C-INSPECTOR-CARD-POLISH Inspector help tooltip placement has no JavaScript measurement or inline styles', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  assert.doesNotMatch(src, /function positionInfoTooltip/,
    'the rejected positionInfoTooltip JavaScript placement helper must be removed');
  assert.doesNotMatch(src, /tp3d-editor-info-icon--tooltip-below/,
    'the rejected tooltip-below placement class must not remain in editor-screen.js');

  const cardHeaderStart = src.indexOf('function cardHeaderWithInfo(titleText, tooltipText)');
  const cardHeaderEnd = src.indexOf('\n    }\n', cardHeaderStart);
  const cardHeaderBody = src.slice(cardHeaderStart, cardHeaderEnd);
  assert.doesNotMatch(cardHeaderBody, /getBoundingClientRect\(\)/,
    'Inspector help tooltip placement must not depend on runtime DOM measurement inside cardHeaderWithInfo');
  assert.doesNotMatch(cardHeaderBody, /addEventListener\('mouseenter'/,
    'cardHeaderWithInfo must not attach tooltip placement listeners on hover');
  assert.doesNotMatch(cardHeaderBody, /addEventListener\('focus'/,
    'cardHeaderWithInfo must not attach tooltip placement listeners on focus');
  assert.doesNotMatch(cardHeaderBody, /\.style\./,
    'cardHeaderWithInfo must not introduce inline layout/positioning styles for the tooltip');
});

test('G1.2C-INSPECTOR-CARD-POLISH Inspector help tooltip copy is concise and Reset buttons have no tooltip', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  [
    'Display units follow Settings. Dimensions are stored internally in inches.',
    'Adds a raised deck above the cab. Length controls how far it extends. Deck Height controls cab clearance; the space below is blocked.',
    'Defines matching blocked zones on both sides of the truck. Offset is measured from the rear/loading door.',
    'Position uses the selected display units. Changes are checked against collisions and usable truck zones.',
    'Turn: Y axis. Tip: X axis. Roll: Z axis. Flip: 180°.',
  ].forEach(copy => {
    const escapedCopy = copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(src, new RegExp(escapedCopy), `Inspector help tooltip copy must include: ${copy}`);
  });

  assert.doesNotMatch(src, /Reset to defaults for this truck size/,
    'Reset buttons must not keep the rejected tooltip copy');
  assert.doesNotMatch(src, /cfgReset\.setAttribute\('data-tooltip'/,
    'Front Overhang and Wheel Wells Reset buttons must not have data-tooltip attributes');
});

test('G1.2C-INSPECTOR-CARD-POLISH Inspector help tooltips keep keyboard accessibility and use a single shared helper', async () => {
  const [src, css] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(stylesMainPath, 'utf8'),
  ]);

  const cardHeaderCalls = src.match(/cardHeaderWithInfo\(/g) || [];
  assert.ok(cardHeaderCalls.length >= 6,
    'Truck, Front Overhang, Wheel Wells, Rotate All, Transform, and Rotate / Flip must all keep using the shared cardHeaderWithInfo helper');

  assert.match(css, /\.tp3d-editor-info-icon\[data-tooltip\]:focus::before,/,
    'keyboard :focus tooltip visibility must be preserved');
  assert.match(css, /\.tp3d-editor-info-icon\[data-tooltip\]:focus-visible::before,/,
    'keyboard :focus-visible tooltip visibility must be preserved');
  assert.match(css, /\.tp3d-editor-info-icon\[data-tooltip\]:focus-within::before,/,
    'keyboard :focus-within tooltip visibility must be preserved');

  assert.doesNotMatch(src, /new\s+(Tooltip|Popper|Popover)\(/,
    'the tooltip fix must not introduce a tooltip/positioning library');
  assert.doesNotMatch(src, /createElement\('div'\)\.className = 'tp3d-tooltip-overlay'/,
    'the tooltip fix must not introduce a new global overlay element');
});

// ── End G1.2C-INSPECTOR-CARD-POLISH ──────────────────────────────────────────

// ── G1.2D-INSPECTOR-FINAL-POLISH ─────────────────────────────────────────────

test('G1.2D-INSPECTOR-FINAL-POLISH single selection separates Rotate / Flip without changing handlers', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');

  const singleStart = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)');
  const singleEnd = src.indexOf('function cardHeaderWithInfo', singleStart);
  assert.ok(singleStart >= 0 && singleEnd > singleStart, 'renderSingleInspector must be locatable');
  const singleBlock = src.slice(singleStart, singleEnd);

  assert.match(singleBlock, /inspectorEl\.appendChild\(transformCard\);[\s\S]*\/\/ === Rotate \/ Flip Card ===/,
    'single-selection Rotate / Flip must render as its own card after the Transform card');
  assert.match(singleBlock, /rotCard\.appendChild\(cardHeaderWithInfo\('Rotate \/ Flip', rotateFlipHelp\)\)/,
    'single-selection Rotate / Flip card must keep the shared help header');
  assert.doesNotMatch(singleBlock, /tp3d-editor-transform-divider/,
    'the old in-card Transform divider must not remain after the visual split');

  const rotateCalls = singleBlock.match(/InteractionManager\.rotateSelection\(axis, delta\)/g) || [];
  assert.equal(rotateCalls.length, 1,
    'single-selection Rotate / Flip card must keep routing through InteractionManager.rotateSelection(axis, delta)');
});

test('G1.2D-INSPECTOR-FINAL-POLISH Front Overhang uses a true two-column field row', async () => {
  const [src, css] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(stylesMainPath, 'utf8'),
  ]);

  assert.match(src, /cfgRow\.className = 'tp3d-editor-dims-row tp3d-editor-dims-row--two'/,
    'Front Overhang Length and Deck Height fields must share a two-column row class');
  assert.match(css, /\.tp3d-editor-dims-row--two\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
    'the Front Overhang two-column row must use equal-width grid columns');
});

test('G1.2D-INSPECTOR-FINAL-POLISH visual CSS is scoped, tokenized, and keeps tooltip/reset constraints', async () => {
  const [src, css] = await Promise.all([
    fs.readFile(editorScreenPath, 'utf8'),
    fs.readFile(stylesMainPath, 'utf8'),
  ]);

  assert.match(css, /#inspector-body \.card \.label\s*\{[^}]*font-size:\s*var\(--text-xs\)[^}]*font-weight:\s*var\(--font-medium\)/s,
    'general Inspector labels must remain 12px and medium weight');
  assert.match(css, /#inspector-body \.card \.tp3d-editor-dims-row \.field \.label,\n#inspector-body \.card > \.field\.tp3d-editor-field-wrap-full \.label,\n#inspector-body \.card \.tp3d-editor-inline-position-field \.label\s*\{[^}]*font-size:\s*var\(--text-sm\)[^}]*font-weight:\s*var\(--font-medium\)/s,
    'dimension, full-width offset, and X/Y/Z position labels must use 14px and medium weight through specific structural selectors');
  assert.match(css, /#inspector-body \.card \.input,\n#inspector-body \.card \.select\s*\{[^}]*min-height:\s*36px[^}]*border-radius:\s*var\(--radius-sm\)[^}]*font-size:\s*var\(--text-sm\)/s,
    'Inspector inputs/selects must use the compact 14px scale and shared 6px radius under #inspector-body');
  assert.match(css, /#inspector-body \.card \.btn\s*\{[^}]*min-height:\s*36px[^}]*border-radius:\s*var\(--radius-sm\)[^}]*font-weight:\s*var\(--font-medium\)/s,
    'Inspector buttons must use the shared 6px radius and medium weight under #inspector-body');
  assert.match(css, /\.tp3d-editor-chip-mini\s*\{[^}]*width:\s*100%[^}]*border-radius:\s*var\(--radius-sm\)/s,
    'the selected-case category chip must be full-width and use the same 6px radius');
  assert.match(css, /\.tp3d-editor-inline-position-field\s*\{[^}]*display:\s*grid/s,
    'X/Y/Z position fields must stack label over input so narrow Inspector widths do not clip values');
  assert.match(css, /\.tp3d-editor-dims-row \.tp3d-editor-minw-90\s*\{[^}]*min-width:\s*0/s,
    'dimension fields inside grid rows must be allowed to shrink without overflowing');
  assert.match(css, /\.tp3d-editor-info-icon\s*\{[^}]*color:\s*inherit/s,
    'Inspector help icons must keep the inherited dark header color instead of a muted override');
  assert.match(src, /cfgHint\.className = 'muted tp3d-editor-fs-xs'/,
    'Front Overhang usable-height helper must use the existing 12px tp3d-editor-fs-xs utility');
  assert.doesNotMatch(src, /cfgHint\.className = 'muted tp3d-editor-fs-sm'/,
    'Front Overhang usable-height helper must not keep the 14px tp3d-editor-fs-sm utility');

  const statsCardMatch = css.match(/\.tp3d-editor-stats-card\s*\{([^}]*)\}/);
  assert.ok(statsCardMatch, 'Stats card CSS block must remain defined');
  assert.match(statsCardMatch[1], /background:\s*var\(--bg-primary\)/,
    'Stats card must use the theme-driven bg-primary token');
  assert.doesNotMatch(statsCardMatch[1], /#f6f7fb|#F6F7FB/,
    'Stats card must not hard-code the light theme #F6F7FB value');
  assert.match(css, /:root\s*\{[\s\S]*--bg-primary:\s*#f6f7fb/i,
    'light theme bg-primary must continue to provide the requested #F6F7FB value');
  assert.match(css, /\[data-theme='dark'\]\s*\{[\s\S]*--bg-primary:/,
    'dark mode must continue to override bg-primary through existing theme tokens');
  assert.doesNotMatch(css, /\[data-theme='dark'\]\s+\.tp3d-editor-stats-card/,
    'Stats card must not need a special dark-mode override');

  [
    ['turn', 'success'],
    ['tip', 'error'],
    ['roll', 'info'],
    ['flip', 'text-secondary'],
  ].forEach(([tone, token]) => {
    const toneMatch = css.match(new RegExp(`\\.tp3d-editor-rot-btn--${tone} i\\s*\\{([^}]*)\\}`));
    assert.ok(toneMatch, `Rotate / Flip ${tone} tone class must be defined`);
    assert.match(toneMatch[1], new RegExp(`var\\(--${token}\\)`),
      `Rotate / Flip ${tone} icon color must use var(--${token})`);
    assert.doesNotMatch(toneMatch[1], /#[0-9a-fA-F]{3,6}/,
      `Rotate / Flip ${tone} icon color must not hard-code a hex value`);
  });

  assert.doesNotMatch(src, /cfgReset\.setAttribute\('data-tooltip'/,
    'Reset buttons must remain tooltip-free');
  assert.doesNotMatch(src, /function positionInfoTooltip|tp3d-editor-info-icon--tooltip-below/,
    'the approved CSS-only tooltip system must not regain JS placement or below-class logic');
});

// ── End G1.2D-INSPECTOR-FINAL-POLISH ─────────────────────────────────────────
