# Truck Packer 3D — Master TODO (V3)
Last updated: 2026-05-07 — Phase 0.6C Archive Workspace fallback switching stabilized; workspace-limit billing copy corrected; next priority is pre-Restore P0 hardening

This is the "single source of truth" checklist for finishing Billing/Access first (P0), then moving into product work (P1+).
Rules:
- Keep changes small and testable.
- If it touches auth/billing/roles, treat it as P0 risk.
- No release until the P0 Gate is fully green.

---

## P0 — Billing & Access (Stripe + Supabase + App)

### P0.0 Non-negotiable invariants (contract) — DONE
- [x] Stripe is the billing truth.
- [x] `billing_customers` is a projection used by the app.
- [x] UI trusts `/billing-status` (not "local guessing").

---

### P0.1 Owner-only billing (view + manage) — DONE ✅
Goal: Only Owner can perform money actions and view sensitive billing details.

Completed:
- [x] Only Owner can: start checkout, open portal, cancel, change plan.
- [x] Admin/Member can still see safe plan state in UI (Trial/Pro/Free) but cannot see payment method details.
- [x] Non-owner billing UI shows:
  - "Ask your owner to upgrade this workspace or contact support: support@pxl360.com"
  - `// TODO: replace support@pxl360.com with the real support email later.`
- [x] Non-owner billing action buttons hidden (no Manage / Subscribe).
- [x] Trial-expired modal:
  - Owner sees Start Subscription button.
  - Non-owner sees support message only (no Start Subscription button).

Notes:
- This matches the intended rule: Owner-only for money actions, while other roles can still see the plan label to understand feature access.

---

### P0.2 Trial display cleanup (relative days + no redundancy) — DONE ✅
Goal: Avoid "Ends on 02/26/2026" style dates for trial. Show "Ends in X days".

Completed:
- [x] Trial UI uses relative days: "Ends in X days".
- [x] Badge strategy updated:
  - [x] Keep the "X days left" badge for trial users only.
  - [x] Avoid redundant "badge + inline" for trials (badge wins).
- [x] Sidebar trial card uses the same computed days value.

---

### P0.3 Paid status badges (renew/cancel clarity) — DONE ✅
Goal: Avoid "I didn't know it would renew".

Completed:
- [x] Mapping enforced in UI:
  - If `cancel_at_period_end = true` → Badge: **Cancels** + "Ends on …"
  - Else → Badge: **Auto-renew** + "Renews on …"
- [x] Keeps the date line: "Renews on …" or "Ends on …" (calendar date is fine for paid plans).

---

### P0.4 Portal "Manage" reliability (never 500) — CODE COMPLETE / VERIFY MANUALLY
Goal: Manage must always open portal. Never block the user with a 500.

Completed:
- [x] Portal config ID is set in Supabase secrets (`STRIPE_PORTAL_CONFIGURATION_ID`).
- [x] Portal sessions preselect subscription for best UX (deep-link to update page).
- [x] If Stripe rejects flow_data due to schedule-managed subscription:
  - [x] No 500.
  - [x] Fall back to portal session without flow_data and return 200.
  - [x] Minimal logs added (org id + subscription id only).
- [x] If Stripe rejects flow_data due to stale / missing stored subscription:
  - [x] No 500.
  - [x] Fall back to portal session without flow_data and return 200.
  - [x] Minimal logs added (org id + customer id + stale subscription id only).
- [ ] Verified:
  - User4: deep-link + Update Subscription works.
  - User1: schedule-managed sub triggers fallback (portal opens, no 500).
  - test1 stale / missing stored subscription id falls back to plain customer portal session.

Important note:
- A schedule-managed subscription will not behave like a normal subscription inside portal. That's OK. This is an edge case and we now handle it safely.

---

### P0.5 Role hardening (Admin cannot manage Admin roles) — DONE ✅
Goal: Only Owner can create/promote Admin roles.

Completed:
- [x] UI: Admin option disabled when actor is not Owner.
- [x] UI: Guard + toast if non-owner attempts to set role to admin (reverts UI).
- [x] UI: Invite role dropdown cannot invite as Admin when actor is not Owner.
- [x] Edge Function `org-member-role-update`:
  - [x] Non-owner cannot promote to admin.
  - [x] Non-owner cannot edit admin rows.
  - [x] Returns 403 with clear message.

---

### P0.6 Baseline DB health checks (run during billing tests) — DONE ✅

SQL queries created: see `docs/P0.6-DB-HEALTH-CHECKLIST.md` (6 queries covering expired trials,
duplicate active subs, missing org_id, billing_customers/subscriptions mismatches).

- [x] Ran Q1–Q6 against production (yduzbvijzwczjapanxbd)
- [x] Results were all 0 rows (clean)
- [x] Logged results in docs/P0.6-DB-HEALTH-CHECKLIST.md

Previous ad-hoc queries preserved for reference:
- Stuck webhook events (> 5 mins): see checklist
- Billing projection row check: see checklist Q4

---

### P0.7 Guardrails (constraints + indexes) — DONE ✅
Goal: add "can’t-happen" constraints so we catch data bugs early.

Completed:
- [x] Found duplicate billing_customers.stripe_subscription_id (sub_1T20KJG4h8YnGsk4A4dHG3Fe)
- [x] Cleaned the bad billing_customers row by clearing stripe_subscription_id on id 49825c06-e991-4ab4-81e4-42b46c520127
- [x] Verified / applied guardrails:
  - [x] Unique index on (organization_id, user_id) in organization_members (already existed)
  - [x] Unique index on billing_customers.organization_id (one billing row per workspace)
  - [x] Unique index on billing_customers.stripe_subscription_id where not null
  - [x] Unique index on subscriptions.stripe_subscription_id where not null
  - [x] Supporting index on billing_customers.stripe_customer_id

Notes:
- If a uniqueness create fails with "already exists", treat it as pass and record the index name.

---

### P0.7 Trial-expired business rule ("soft lock" + limits) — IMPLEMENTED + VERIFIED (pending doc checklist)

**Implemented in this session:**
- [x] `billing-status`: emits `status='trial_expired'`, `plan='free'`, `isActive=false` for:
  - No-card trials: `billing_customers.status='trialing'` + no `stripe_subscription_id` + `trial_ends_at` past
  - [x] No-subscription expired trials: if `billing_customers.status='trial_expired'` and there is no subscription row, `/billing-status` returns `status='trial_expired'` (prevents UI showing `Status: none`).
  - Stripe-managed trials: `subscription.trial_end` in the past + no evidence of paid conversion (current_period_end ≤ trial_end + 3 days)
- [x] Settings-overlay billing tab: shows "Your free trial has ended." (no date), owner CTA, non-owner support message (`support@pxl360.com` — TODO: replace later)
- [x] Trial-expired modal: fires with `dismissible:false`; owner gets "Start Subscription" + Logout; non-owner gets support message + Logout
- [x] Sidebar Subscribe card: fires for `trial_expired` (owner only)
- [x] AutoPack gate: blocks with trial-aware toast (owner vs non-owner messaging)
- [x] PDF export gate: blocks with trial-aware toast (owner vs non-owner messaging)

**Mark DONE only after all three verified:**
- [x] Fresh trial org: "X days left" badge + sidebar card match (verified on test4 trial account)
- [x] Trial-expired org: `status='trial_expired'` returned, correct owner/non-owner messaging, AutoPack + PDF blocked (verified on test3)
- [x] Paid org: no interference with any of the above (verified on test1/test2/test4)
- [ ] Add screenshots + timestamps to Running log for the 3-state verification (test3/test4/test1)

---

### P0.7.1 Trial-expired lock persistence hotfix (idle/focus/billing error) — DONE ✅

Goal: The `trial_expired` blocking modal must never auto-dismiss during idle, focus refresh, token refresh, or temporary billing fetch errors.

Completed:
- [x] Added a sticky latch (`trialExpiredLockedOrgId`) so once an org is confirmed `trial_expired`, the lock persists until:
  - user logs out, OR
  - billing becomes definitively active (`ok=true` + `isActive=true`), OR
  - active org changes.
- [x] Guarded `closeTrialExpiredModal()` so it does **not** run on non-definitive states (billing errors / `ok=false`).

Verification:
- [x] test3 (trial_expired): modal stays after idle + tab switches; background remains blocked.
- [x] test1/test2/test4 (active): no modal; normal app.

Notes:
- Keep this fix small; do not refactor the billing gate applier.
- If future work changes billing refresh behavior, re-test this first.

---

### P0.7.2 Auth snapshot fallback hotfix (idle/tab-visible) — DONE ✅

Goal: Prevent transient `authState.status='unknown'` / `hasToken=false` windows (seen on tab-visible/focus after long idle) from:
- wiping OrgContext,
- showing the “Create or join a workspace” banner for signed-in users,
- stalling billing with `org-context-not-ready`.

Completed:
- [x] Added `lastAuthEventSnapshot` cache + `FALLBACK_AUTH_TTL_MS = 8000`
- [x] Auth event handler stores a “real” snapshot on SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION and a signed-out snapshot on SIGNED_OUT
- [x] `getCurrentAuthSnapshot()` falls back to the cached snapshot for up to 8 seconds when the wrapper returns `unknown` / missing token
- [x] Signed-out path only clears local org hint on **user-initiated** sign-out (prevents accidental hint wipe)
- [x] Banner logic suppresses “no workspace” banner during the transient signed-out window
- [x] `runAuthRefresh()` uses cached session as a fallback `sessionHint` during the same window

Verification:
- [x] test1/test2/test4: long idle → tab-visible/focus does not wipe org; billing recovers; no “Create or join” banner
- [x] test3: trial-expired lock still blocks app; no unintended unlock

Notes:
- This is a guard for the “can’t-happen” state where the wrapper briefly reports unknown/no token even though an auth event with a valid session exists.
- Keep TTL small (8s) and only trust snapshots written by real auth events.

---

### P0.8 Payment failure rules (past_due / unpaid / incomplete) — IMPLEMENTED
Goal: predictable access during payment issues.
- [x] Define grace window behavior in `/billing-status` (ex: `past_due_grace`).
- [x] UI: warning banner + Owner-only "Fix payment" link to portal.
- [x] After grace: block Pro actions (but app still loads).



### P0.9 Cross-user local data isolation (user-scoped storage) — IMPLEMENTED (needs 2-tab verification)
Goal: prevent packs/cases/preferences from leaking between different signed-in users on the same browser.

Completed:
- [x] Local app data is now scoped by user id (storage key `truckPacker3d:v1:<userId>`)
- [x] One-time migration: legacy `truckPacker3d:v1` → first scoped key (then legacy removed)
- [x] App resets + reloads in-memory StateStore on sign-in, sign-out, and user switch so autosave can’t re-persist stale data

Still required (release blocking):
- [ ] **Two-tabs test (same user)**
  - Tab A + Tab B both signed_in must converge to the same OrgContext (orgId not null).
  - [x] Banner must NOT appear while signed_in.
  - [ ] No auto sign-out / auto sign-in loop.
  - [ ] getAccountBundleSingleFlight({force:true}) must return session+user in BOTH tabs when signed_in.
- [x] **Cross-tab auth/token churn hardening + logout/billing stability** (code complete; live 2-tab sign-off pending)
  - Added versioned org-context sync payload (`tp3d:org-context-sync`) with `userId`, `orgId`, `timestamp`, `epoch`.
  - Storage listeners now apply org sync only for matching user + newer epoch; older payloads are ignored.
  - `tp3d:active-org-id` legacy storage changes are handled as fallback and promoted into the same guarded sync path.
  - Auth refresh auto-triggers are gated during auth-unsettled/logout/inflight windows to reduce cross-tab races.
  - Org context is only cleared when auth is definitively signed out.
  - **Extended:** Cross-tab billing dedupe now applies before any handler/log (storage and broadcast); per-org org-role hydration uses a grace window and inflight flags; authGate fallback guard blocks false signed_out during signed-in wobbles.
- [x] **Cross-tab logout stability (no bounce)**
  - User-initiated logout must await `signOut()` completion (no timed reload before sign-out finishes).
  - Tab A logout must not briefly re-enter signed-in state.
  - Tab B must receive sign-out and end signed out.
  - Implemented with a canonical `performUserInitiatedLogout()` helper + logout-in-progress latch in `src/app.js`.
  - Fallback auth snapshot TTL is bypassed while logout latch is active (prevents session resurrection during sign-out).

#### Multi-tab status
- Observed issues from late Feb are no longer reproducing in current debug logs (no repeated `billing:cross-tab-*:received` bursts; authGate fallback now blocks false signed_out during signed-in wobbles).
- Release is still blocked until the 2-tab manual sign-off checklist is executed and documented.
- Two-tabs test (same user) must verify:
  - Tab A + Tab B both signed_in must converge to the same OrgContext (orgId not null).
  - Banner must NOT appear while signed_in.
  - No auto sign-out / auto sign-in loop.
  - getAccountBundleSingleFlight({force:true}) must return session+user in BOTH tabs when signed_in.

Future (do later):
- [ ] Optional org-scoped local storage (`...:<userId>:<orgId>`) for same-user multi-workspace separation.
  Note: this still won’t share across different people; true sharing requires server-side storage.

---

### P0.9 Delete account safety — NOT DONE (IMPORTANT)

---

### P0.10 Signup auto-org creation stability — DONE ✅
Goal: New Supabase auth signups must reliably create the required app records without duplicate workspace triggers or schema mismatch failures.

Completed:
- [x] Fixed the signup failure that showed `Sign up failed: Database error saving new user` for new users.
- [x] Removed the duplicate legacy auth signup trigger `on_auth_user_create_default_org`.
- [x] Hardened `tp3d_handle_new_user()` for live schema differences:
  - [x] Does not depend on direct runtime `gen_random_uuid()` behavior.
  - [x] Works when `public.profiles.email` is absent.
  - [x] Works when `organization_members.updated_at` is absent.
  - [x] Avoids duplicate workspace creation if a legacy membership already exists.
- [x] Kept billing trial seed non-blocking so optional billing seed issues cannot abort auth signup.
- [x] Added migration `2026050601_fix_signup_auto_org_uuid.sql`.
- [x] Added audit test coverage in `tests/audit/security-and-invariants.spec.mjs`.

Live verification:
- [x] `test5@test.com` signup now succeeds in Chrome.
- [x] App loads `test5's Workspace` after signup.
- [x] Free-trial banner appears for the new workspace.
- [x] Logout is available.
- [x] DB confirms auth user exists.
- [x] DB confirms profile exists.
- [x] DB confirms one workspace exists.
- [x] DB confirms owner membership exists.
- [x] DB confirms `billing_customers` row exists with `trialing`.
- [x] DB confirms the duplicate legacy auth trigger no longer exists.

Validation:
- [x] `npm test` passed: 76/76.
- [x] `npm run lint` passed with 0 errors and existing warnings only.
- [x] `npm run -s typecheck` passed.
- [x] `git diff --check` passed.
- [x] `git diff --cached --check` passed.

Notes:
- `test5@test.com` now exists. Future sign-up attempts with that email should return an already-registered/auth-existing response, not create another user.
- Keep this fix separate from Archive Workspace work.

Goal: avoid "wrong hands" deleting accounts or breaking org billing.
- [ ] Only Owner can delete the org (if you support org deletion).
- [x] Block "Delete Account" if user is last Owner of any org.
- [ ] If org has active paid subscription:
  - define policy: must cancel first OR auto-cancel during delete flow (choose one).
  - Add "contact support" path (`support@pxl360.com` for now + TODO to replace later).
Notes:
- Exact block message now implemented in code:
  - `You cannot delete your account while you are the last owner of a workspace. Transfer ownership or contact support first.`

---

### P0 — Workspace ("+ Workspace") track — PARTIAL

You asked to add this: it should be part of P0 because it touches org context + billing scope.
- [x] Define +Workspace creation flow:
  - Create org row
  - Add creator as Owner
  - Set profile `current_organization_id`
  - Create default data needed by the app (if any)
- [ ] Workspace switching must be safe:
  - No plan/cache leakage between orgs
  - Billing tab always matches current org
  - Members list matches current org
  - Packs/Cases scoped to current org
- [ ] Billing for new workspace:
  - Trial starts correctly (if you do per-org trials)
  - Or Free by default (if trials are per-user instead)

### Follow-up audit notes — Packs/Cases and org logos

- [x] Packs/Cases RLS audit completed.
- [x] Confirmed there are no Supabase packs/cases tables yet.
- [x] Current Packs/Cases data is scoped in browser localStorage by user and workspace.
- [ ] Future phase: move Packs/Cases to Supabase if shared workspace data and cross-device sync are required.
- [ ] Cleanup: audit legacy packs/cases service/repository files and either delete them or mark as legacy.
- [x] Org logos bucket reviewed.
- [x] Product decision: keep org logos public because they are workspace branding assets.
- [x] Add doc note that org-logos is intentionally public while upload/update/delete remains Owner/Admin gated.

Org logos are intentionally public. Workspace logos are treated as display/brand assets, not private data; this keeps invite emails, shared links, public views, and branded surfaces simple. Upload, update, and delete remain restricted to workspace Owner/Admin through RLS. User avatars should remain private because they are closer to personal data.

Notes:
- Shared modal-based workspace creation is now the only creation path in code for the account switcher and Settings.
- Workspace switching now clears stale editor-bound state and always falls back to Packs.
- Org-scoped local storage is still deferred.

---

## P1 — Invitations + membership lifecycle — NOT DONE
- [ ] Invite email delivery + link correctness
- [x] Accept invite flow — code complete for signed-in users; live signed-out handoff still needs sign-off
- [x] Expiration rules — `organization_invites.expires_at` added, shown, and enforced
- [x] Invite revocation moved behind `org-invite-revoke` Edge Function — implemented, committed, deployed, audit-passed, and live-tested
- [x] Removing member never changes billing
- [ ] Ownership transfer (if supported)

---

## P1 — App hardening (lint + small safety fixes) — IN PROGRESS

You ran lint and still have warnings.
- [ ] Fix eslint warnings (no new behavior changes)
  - unused vars
  - no-use-before-define
  - no-alert prompts used in app flow (replace with UIComponents modal/toast)
- [ ] Fix html-validate warnings (prefer native button)
  - pick the highest-impact ones first (settings UI and primary actions)

---

## P0 Gate (release block)

P0 is green only when ALL items here are checked:
- [x] P0.6 DB health checks run and clean during tests (Q1–Q6 all 0 rows)
- [x] P0.7 Trial-expired behavior implemented + tested (test3 locked; test1/test2/test4 ok)
- [x] P0.8 Payment failure rules implemented + tested (past_due / unpaid / incomplete)
- [ ] Phase 0 Workspace creation + switching tested with no org/billing leakage.
- [x] Phase 0.5 Membership + invite lifecycle audited and stabilized through invite revoke UI follow-up; remaining signed-out invite handoff checks stay tracked separately.
- [ ] Phase 0.6 Workspace archive / restore / transfer / leave rules defined before implementation.
- [ ] Phase 0.7 Workspace export rules defined before destructive lifecycle actions.
- [ ] P0.9 Cross-user data isolation + 2-tab stability verified.
- [x] Logout flow uses canonical helper only.
- [ ] Cross-tab logout verified live.
- [ ] No console errors in normal flows (ignore debug mode + expected favicon noise).
- [ ] "Manage billing" never 500.
  - [x] New-user signup creates auth user, profile, default workspace, owner membership, and billing trial row without DB trigger failure.

---

## Running log (keep updated)


- Date: 2026-05-07 — Phase 0.6D-pre remote deploy verified
- What changed:
  - Applied migration `2026050702_org_member_admin_delete_guard.sql` to Supabase.
  - Confirmed migration history is aligned through `2026050702`.
  - Deployed Edge Functions: `delete-account`, `ban-user`, `unban-user`, `org-member-remove`, and `billing-status`.
  - Verified SQL policy `org_members_delete_owner_admin` now limits Admin delete power to `role = 'member'`.
  - Confirmed old broad Admin delete rule `role <> 'owner'` is no longer the Admin branch.
- Validation:
  - `npm test` passed: 117/117.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` and `git diff --cached --check` passed.
- Still required:
  - Live browser test: Admin cannot remove another Admin.
  - Live browser test: Admin can still remove Member.
  - Live browser test: archived workspace billing returns the safe unavailable state.
  - Rotate Supabase DB password because it was pasted during setup.



- Date: 2026-05-07 — Phase 0.6D-pre security hardening committed
- What changed:
  - Retired legacy `delete-account`, `ban-user`, and `unban-user` Edge Functions with 410 responses.
  - Hardened `org-member-remove` so Admin cannot remove Admin.
  - Added RLS migration `2026050702_org_member_admin_delete_guard.sql` so Admin can delete Member rows only.
  - Hardened `billing-status` so archived resolved workspaces return `billing_unavailable`.
  - Added direct client guards for `owner_id` and account deletion-state fields.
  - Added audit tests for all changes.
- Validation:
  - `npm test` passed: 117/117.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` and `git diff --cached --check` passed.
- Deployment still required:
  - Apply `2026050702` migration to Supabase.
  - Deploy changed Edge Functions.
  - Run live Admin/Admin removal and archived billing checks.


- Date: 2026-05-06 — Signup auto-org creation hotfix
- What changed:
  - Fixed the live signup failure for new users where Supabase Auth returned `Database error saving new user`.
  - Added migration `2026050601_fix_signup_auto_org_uuid.sql`.
  - Removed the duplicate legacy auth trigger `on_auth_user_create_default_org`.
  - Hardened `tp3d_handle_new_user()` so it works with the live schema when optional columns differ from local assumptions.
  - Made billing trial seed non-blocking so optional billing seed errors do not abort Auth signup.
  - Added audit test coverage for the signup trigger migration.
  - Live signup for `test5@test.com` succeeded in Chrome.
  - DB verification confirmed auth user, profile, one workspace, owner membership, and trialing billing row.
- Validation:
  - `npm test` passed: 76/76.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` passed.
  - `git diff --cached --check` passed.
- Notes:
  - `test5@test.com` now exists and should not be reused for fresh signup tests.
  - This fix is separate from Phase 0.6C Archive Workspace.
- Next action:
  - Proceed with Phase 0.6C Archive Workspace audit only. No archive implementation until the audit confirms schema, UI, billing, and org-switching behavior.

- Date: 2026-04-22
- What changed:
  - Workspace creation now uses one shared modal flow from both the account switcher and Settings; `window.prompt` is no longer used.
  - Successful workspace creation now follows one path: create org, invalidate account cache, switch active org, refresh org context, and refresh billing.
  - Real org changes now clear stale workspace-bound UI state and fall back to Packs by resetting `currentPackId`, `selectedInstanceIds`, and stale editor screen state.
  - No-workspace copy now explicitly guides users to create a workspace or join with an invite link.
  - Invite UI copy now matches current truth: invites are link-based and surfaced via `Copy Link`.
  - Account deletion is now blocked in code when the user is the last owner of any workspace, with a plain-language error message.
- Verification still required:
  - Create workspace from both entry points and confirm the new workspace becomes active in the account switcher, Settings org UI, and Billing without reopening the modal.
  - Switch workspaces while on Packs, Cases, and Editor; confirm stale editor state always resets to Packs.
  - Re-test signed-in invite acceptance.
  - Signed-out invite handoff is still not fully verified.
  - Re-test last-owner account deletion block in the browser and confirm the exact message is shown.

- Date: 2026-04-19
- What changed:
  - Fixed a release-blocking editor export regression where dropdown actions assumed export handlers always returned promises and crashed on `.catch` when they returned `undefined`.
  - Fixed a release-blocking Settings modal regression where `Edit Profile` and `Edit Workspace` could no-op until the modal was reopened because edit-mode flags were missing from the render stable key.
- Verification still required:
  - Re-test `Edit Profile`, `Edit Workspace`, Screenshot, and Export PDF in the browser after this fix.

- Date: 2026-04-19
- What changed:
  - Billing hardening work was applied.
  - A stale Stripe subscription reference was found for test1.
  - The billing row was reset to free/canceled.
  - Portal fallback hardening for stale subscription references is now implemented in code.
  - Checkout/portal client cleanup now routes monthly/yearly selection by interval only; server env remains the Stripe price source of truth.
  - Stripe Node SDK pin was upgraded while keeping the Stripe API version pinned for behavior stability.
- Tests required:
  - Re-test "Manage billing" on test1 with a stale or missing stored subscription id; portal must return 200 via plain customer-session fallback.
  - Re-test monthly and yearly checkout selection after the client-side price-id cleanup.

- Date: 2026-03-08
- What changed:
  - Cross-tab billing dedupe now happens before any handler/log in both storage and broadcast paths, with an expanded signature to UI-relevant fields.
  - Org-role hydration: per-org grace window and inflight flags are set early so hydration does not briefly report `hydrated-no-role` while bundle is inflight.
  - authGate fallback: strengthened guard using three signals (snapshot age, authGate lastSignedInAt age, live wrapper signed-in state) to block false `signed_out` confirmation.
- Validation:
  - Lint: 0 errors
  - Typecheck: clean
  - Tests: 0 failures
- Branch/PR note:
  - `stabilize/auth-billing-hardening` pushed; PR #4 to main is open.
- Next required test:
  - Two-tab sign-off (same user): org context converges; no “Create or join workspace” banner; no auth flip to SIGNED_OUT during signed-in flows.
  - Two-tab logout sign-off: Tab A logout signs out cleanly; Tab B follows; no signed-in bounce.
  - Two-tab org switch: switch in Tab A updates Tab B billing/members/general to the same org.

- Date: 2026-03-07
- What changed:
  - Cross-tab org/workspace drift hardening in `src/app.js` + `src/ui/overlays/settings-overlay.js`:
    - Added guarded org-context sync payload with userId+epoch+timestamp.
    - Added stale/mismatched-user ignore logic for `tp3d:org-changed` and storage sync.
    - Added auth-truth guards so signed-in UI/actions only proceed with a usable session.
    - Added stale response dropping for settings account/members/billing context loaders.
  - Supabase auth truth hardening in `src/core/supabase-client.js`:
    - `getUserSingleFlight()` now forces local signed-out on 401/403-style revoked auth errors.
- Tests required (2 tabs):
  - Tab A workspace switch updates Tab B members/billing/general to same workspace.
  - Refresh stability in both tabs (no random signed-out flip while session is valid).
  - 401/403 auth invalidation converges both tabs to signed-out quickly (no retry loops).

- Date: 2026-03-07
- What changed:
  - Cross-tab logout regression identified: some logout paths call `SupabaseClient.signOut(...)` and then force `window.location.reload()` on a short timer, which can reload before sign-out finishes. That can cause a brief re-sign-in and then a later sign-out.
  - Plan: centralize logout into a single helper that awaits `SupabaseClient.signOut()` and relies on the existing signed-out handler to show the signed-out UI. Remove any immediate timed reloads. Keep only a delayed, gated fallback reload if the signed-out UI fails to appear.
- Tests required (2 tabs):
  - Tab A logout must not bounce back to signed-in UI.
  - Tab B must also sign out.
  - Manual refresh after logout must remain signed out.
  - No `SIGNED_IN` event should fire after user-initiated sign-out.
- Next action:
  - Audit and remove/replace every timed `location.reload()` that runs after calling `signOut()`.
  - Add a regression checklist item to the release gate for cross-tab logout stability.

- Date: 2026-03-07
- What changed:
  - Implemented canonical logout helper in `src/app.js` for explicit Logout UI actions (account switcher + trial-expired modal + trial welcome modal).
  - Removed immediate timed reload logout paths; fallback reload is now delayed and gated (`signOut` completed, still not signed-out UI, and no session exists).
  - Added logout-in-progress latch and disabled auth snapshot fallback TTL while latch is active (`getCurrentAuthSnapshot`, `runAuthRefresh`, `renderAuthState` transient guard).
  - Added audit test to guard against reintroducing timed reload after `signOut`.
- Tests run:
  - `npm test` (pass)
  - `npm run -s typecheck` (pass)
  - `npm run -s lint` (pass with existing warnings only; no new errors)
  - `TP3D_STRESS_URL=http://127.0.0.1:5500/index.html?tp3dDebug=1 npm run stress:ui` (pass)
- Next action:
  - Execute live two-tab manual sign-off checklist for logout bounce regression in production-like environment.

- Date: 2026-03-05
- Release process clarification (no-build static app):
  - This repo is released as static assets; there is no `npm run build` step.
  - Local run command: `python3 -m http.server 5500` then open `http://localhost:5500/index.html`.
  - Release validation commands: `npm test`, `npm run -s typecheck`, `npm run lint`, optional `npm run stress:ui`.
  - Expected console in normal flows: no blocking errors, no unhandled rejections, no token/JWT fragments logged.
  - Required release files: `index.html`, `src/`, `styles/`, `vendor/`, audit docs under `docs/audits/`.
- Legacy module notes (contradiction cleanup):
  - Use `src/core/events.js` as the runtime event bus. Do **not** import `src/core/event-bus.js` in new code.
  - Use `src/core/storage.js` scoped storage key strategy (`truckPacker3d:v1[:scope]`) as runtime source.
  - `src/core/constants.js` `STORAGE_KEYS.appData/session` (`v2`) are legacy compatibility values, not the runtime storage authority.

- Date: 2026-02-27
- What changed:
  - Edge Function: `/billing-status` maps no-subscription `billing_customers.status='trial_expired'` to `status='trial_expired'`.
  - App: trial-expired lock persistence hotfix using `trialExpiredLockedOrgId` to prevent modal dismissal on billing fetch errors.
  - App: auth snapshot fallback (8s TTL) to prevent transient unknown auth state from clearing org context or showing the “Create or join a workspace” banner.
  - App: getAccountBundleSingleFlight now guarantees session/user fallback when auth is signed_in (prevents null bundles).
  - App: user-scoped local storage for packs/cases/preferences + StateStore reset/reload on auth changes (P0.9).
- Tests run:
  - test3: `trial_expired` modal shown, non-dismissable, survives idle/tab switch; AutoPack + PDF blocked.
  - test1/test2/test4: active paid Pro loads normally; PDF export works; no lock modal.
- Failures found:
  - None after hotfix verification (previous regressions were rolled back before final hotfix).
- Next action:
  - Apply P0.9.1 multi-tab fix (guard renderAuthState signed-out branch + relax cooldown when already signed_in).
  - Start P0.8 payment failure rules (past_due / unpaid / incomplete).
  - Start P0 Workspace track: define +Workspace creation + switching rules and prevent any org/billing leakage.

---

## Fix log — 2026-02-28 — P0 checkpoint commit (lint cleanup)

**Commit:** `8bb5822` · branch `p0-checkpoint-20260228-0149` · pushed to origin

**What changed (no behavior changes):**
- 11 lint warnings fixed (no-unused-vars, no-shadow, curly)
- 19 warnings deferred (use-before-define, no-alert, dead-code with string dependency)
- Includes all prior P0.7/P0.8/P0.9 work in a single clean checkpoint

**Checks:** SYNTAX OK · LINT 0 errors 19 warnings (down from 30)

---

## Fix log — 2026-02-27 — Account switcher org label (P0 UI)

**Root cause:** `renderButton()` computed `display.accountName` (`orgContext.activeOrg.name || 'Workspace'`) but never wrote it to the DOM. The sidebar span also lacked `data-org-name` so JS had no target element.

**Fix — 2 files, 3-line diff:**
- `index.html` L305: added `data-org-name` to the org label span
- `src/app.js` L1077-1078: `const orgNameEl = buttonEl.querySelector('[data-org-name]'); if (orgNameEl) orgNameEl.textContent = display.accountName;`

**Commit:** `958dab7` · branch `docs/master-todo-v3` · pushed to origin

**Checks:** SYNTAX OK · LINT OK (0 errors)

**Verification (paste in browser console after sign-in):**
`document.querySelector('[data-org-name]')?.textContent` → should show org name, not "Personal Account".

# Truck Packer 3D — Master TODO (V3)
Last updated: 2026-04-19

This is the live execution checklist for stabilizing the platform before the next product growth phase.

Rules:
- Keep changes small and testable.
- If it touches auth, billing, orgs, roles, storage scope, or cross-tab behavior, treat it as P0 risk.
- Do not mix structural cleanup with behavior changes unless a bug fix requires it.
- No release until the P0 Gate is fully green.

---

## Current priority order

1. **Phase 0 — Workspace Foundation Finalization**
2. **Phase 0.5 — Membership + Invite Lifecycle**
3. **Phase 0.6 — Workspace Lifecycle Actions**
4. **Phase 0.7 — Workspace Data Export**
5. **Phase 0.8 — Runtime Safety / Error States**
6. **Phase 1 — AutoPack correctness fixes**
7. **Phase 1.1 — Quick product wins**
8. **Phase 1.2 — Crew View / share flow**
9. **Phase 2 — Runtime cleanup / modularization**

---

## P0 — Billing & Access (Stripe + Supabase + App)

### P0.0 Non-negotiable invariants (contract) — DONE
- [x] Stripe is the billing truth.
- [x] `billing_customers` is a projection used by the app.
- [x] UI trusts `/billing-status` (not local guessing).
- [x] Money actions are owner-scoped.
- [x] Local app storage is user-scoped.

---

### P0.1 Owner-only billing (view + manage) — DONE ✅
Goal: Only Owner can perform money actions and view sensitive billing details.

Completed:
- [x] Only Owner can: start checkout, open portal, cancel, change plan.
- [x] Admin/Member can still see safe plan state in UI (Trial/Pro/Free) but cannot see payment method details.
- [x] Non-owner billing UI shows a support path.
- [x] Non-owner billing action buttons hidden (no Manage / Subscribe).
- [x] Trial-expired modal respects owner vs non-owner behavior.

---

### P0.2 Trial display cleanup (relative days + no redundancy) — DONE ✅
Goal: Avoid date-heavy trial copy and redundant trial signals.

Completed:
- [x] Trial UI uses relative days.
- [x] Trial badge strategy cleaned up.
- [x] Sidebar trial card uses the same computed days value.

---

### P0.3 Paid status badges (renew/cancel clarity) — DONE ✅
Goal: Make paid renewal/cancel state obvious.

Completed:
- [x] `cancel_at_period_end = true` → **Cancels** badge + end date.
- [x] otherwise → **Auto-renew** badge + renew date.
- [x] Paid date line stays visible.

---

### P0.4 Portal "Manage" reliability (never 500) — CODE COMPLETE / VERIFY MANUALLY
Goal: Manage must always open portal. Never block the user with a 500.

Completed in code:
- [x] Portal config ID is set in Supabase secrets.
- [x] Portal sessions preselect subscription for best UX when valid.
- [x] Schedule-managed subscription fallback returns a plain customer portal session instead of 500.
- [x] Stale / missing stored subscription fallback returns a plain customer portal session instead of 500.
- [x] Minimal logs added for fallback paths.

Manual verification still required:
- [ ] User4: deep-link + Update Subscription works.
- [ ] User1: schedule-managed sub triggers fallback and opens portal.
- [ ] test1: stale / missing stored subscription id falls back to plain customer portal session.

---

### P0.5 Role hardening (Admin cannot manage Admin roles) — DONE ✅
Goal: Only Owner can create/promote Admin roles.

Completed:
- [x] UI disables Admin option when actor is not Owner.
- [x] Invite role dropdown cannot invite as Admin when actor is not Owner.
- [x] Edge Function blocks non-owner admin promotion and editing of admin rows.

---

### P0.6 Baseline DB health checks — DONE ✅
- [x] Q1–Q6 created and documented in `docs/P0.6-DB-HEALTH-CHECKLIST.md`.
- [x] Ran against production.
- [x] Results were all clean.

---

### P0.7 Guardrails (constraints + indexes) — DONE ✅
- [x] Duplicate billing row issue identified and cleaned.
- [x] Required uniqueness/index guardrails verified or applied.

---

### P0.7 Trial-expired business rule (soft lock + limits) — IMPLEMENTED + VERIFIED (doc follow-up still open)
Completed:
- [x] `billing-status` emits `trial_expired` correctly.
- [x] Trial-expired modal blocks correctly.
- [x] Sidebar subscribe card respects owner-only behavior.
- [x] AutoPack gate blocks correctly.
- [x] PDF export gate blocks correctly.

Verified:
- [x] Fresh trial org.
- [x] Trial-expired org.
- [x] Paid org.

Still open:
- [ ] Add screenshots + timestamps to running log for the 3-state verification.

---

### P0.7.1 Trial-expired lock persistence hotfix — DONE ✅
- [x] Sticky latch added.
- [x] Modal no longer dismisses on non-definitive billing states.

### P0.7.2 Auth snapshot fallback hotfix — DONE ✅
- [x] Added short-lived auth snapshot fallback.
- [x] Prevents transient signed-out wobble from wiping org state or showing no-workspace banner.

---

### P0.8 Payment failure rules (past_due / unpaid / incomplete) — IMPLEMENTED
- [x] Grace window behavior defined.
- [x] Warning banner + owner portal path added.
- [x] Pro actions block after grace.

---

### P0.9 Cross-user local data isolation (user-scoped storage) — IMPLEMENTED (live sign-off still required)
Goal: prevent packs, cases, and preferences from leaking between different signed-in users on the same browser.

Completed:
- [x] Local app data is user-scoped.
- [x] Legacy migration path exists.
- [x] In-memory state resets on auth changes.
- [x] Cross-tab auth/token churn hardening added.
- [x] Cross-tab logout stability code path added.

Release-blocking verification still required:
- [ ] Two-tabs test (same user) passes.
- [ ] No banner while signed in.
- [ ] No auto sign-out / auto sign-in loop.
- [ ] `getAccountBundleSingleFlight({ force: true })` returns session + user in both tabs.
- [ ] Cross-tab logout verified live with no signed-in bounce.

Future:
- [ ] Optional org-scoped local storage for same-user multi-workspace separation.

---

### P0.9 Delete account safety — NOT DONE

#### Phase 0.6D-pre Batch 4B-1 — IMPLEMENTED

- [x] `deletion_status = 'requested'` is now the authoritative login block, independent of Supabase `banned_until`.
- [x] `getMyProfileStatus()` includes `deleted_at` with `deletion_status` and `purge_after`.
- [x] `request-account-deletion` preserves `organization_members` during the 30-day deletion window.
- [x] Repeated deletion requests do not extend a still-future `purge_after`.
- [x] Last-owner account deletion protection remains in place.
- [ ] Batch 4B-1B: decide and implement owner/billing-owner deletion block if needed.
- [x] Batch 4B-2a: support-assisted `cancel-account-deletion` endpoint implemented.
- [ ] Batch 4B-2b: self-service cancel UX/token model remains deferred.
- [ ] Batch 4B-3: add `purge-deleted-accounts`, `purged` migration, and scheduling.

Validation:
- [x] `npm test` passed: 123/123.
- [x] `npm run lint` passed with 0 errors and existing warnings only.

#### Phase 0.6D-pre Batch 4B-2a — IMPLEMENTED

- [x] Added support/admin-only `cancel-account-deletion` Edge Function protected by `ACCOUNT_DELETION_SUPPORT_SECRET`.
- [x] Cancellation accepts `user_id`, clears deletion fields to `canceled`, and lifts Supabase ban with `ban_duration = "none"`; idempotent retries also repair the ban lift.
- [x] No self-service cancel button or frontend wrapper was added because banned/signed-out users cannot reliably call a JWT-protected cancel function.
- [x] No membership restore/delete, Stripe, billing, workspace lifecycle, pack/case, storage, router, CSS, or package changes.
- [ ] Self-service cancel remains a later product decision requiring a different token/session model.

Validation:
- [x] `npm test` passed: 129/129.
- [x] `npm run lint` passed with 0 errors and existing warnings only.
- [x] `npm run -s typecheck` passed.
- [x] `npm run -s typecheck` passed.

### P0.10 Pre-Restore Workspace security hardening — IMPLEMENTED / DEPLOY VERIFY

Goal: close the highest-risk security and role gaps before Restore Workspace.

Completed:
- [x] Retired legacy `delete-account` Edge Function with a 410 response.
- [x] Retired legacy `ban-user` Edge Function with a 410 response.
- [x] Retired legacy `unban-user` Edge Function with a 410 response.
- [x] Removed wildcard CORS from the retired legacy account endpoints.
- [x] Added tests proving legacy account endpoints cannot delete users or mutate auth.
- [x] Added Admin-on-Admin removal protection in `org-member-remove`.
- [x] Added migration `2026050702_org_member_admin_delete_guard.sql`.
- [x] RLS delete policy now allows Admin to delete Member rows only, not Admin rows.
- [x] `billing-status` now returns `billing_unavailable` for archived resolved workspaces.
- [x] Archived workspaces still count toward workspace limits by policy.
- [x] `updateOrganization()` blocks direct `owner_id` writes.
- [x] `updateProfile()` blocks direct deletion-state writes.
- [x] Added audit tests for all 0.6D-pre changes.

Validation:
- [x] `npm test` passed: 117/117.
- [x] `npm run lint` passed with 0 errors and existing warnings only.
- [x] `npm run -s typecheck` passed.
- [x] `git diff --check` passed.
- [x] `git diff --cached --check` passed.
- [x] Committed and pushed: `fix(security): pre-restore workspace hardening`.

Still required:
- [x] Apply remote migration `2026050702_org_member_admin_delete_guard.sql`.
- [x] Deploy Edge Functions: `delete-account`, `ban-user`, `unban-user`, `org-member-remove`, `billing-status`.
- [ ] Verify Admin cannot remove Admin in live browser. *(Needs direct member-removal test; invite revoke was tested separately.)*
- [ ] Verify Admin can still remove Member in live browser.
- [ ] Verify archived workspace billing returns safe unavailable state.
- [ ] Rotate the Supabase DB password after setup because it was pasted into terminal/chat history.

- [ ] Only Owner can delete org, if org deletion is supported.
- [x] Block delete account if user is last Owner of any org.
- [ ] Define paid-subscription deletion policy.
- [ ] Add support path for blocked destructive flows.
Notes:
- Exact block message now implemented in code:
  - `You cannot delete your account while you are the last owner of a workspace. Transfer ownership or contact support first.`

---

## Phase 0 — Workspace Foundation Finalization — IN PROGRESS

Do this first.

### Goals
- [x] Finalize create workspace flow.
- [ ] Finalize switch workspace flow.
- [x] Finalize empty / no-workspace flow.
- [ ] Finalize active workspace persistence.
- [ ] Finalize org / billing relationship.
- [x] Finalize invite / join expectations if in scope now.
- [ ] Confirm workspace lifecycle rules before adding destructive actions.
- [ ] Confirm owner/member role rules for every workspace action.
- [ ] Confirm billing behavior when a workspace is archived, restored, transferred, or left.

### Required outcomes
- [x] Creating a workspace always:
  - [x] creates org row
  - [x] adds creator as Owner
  - [x] sets `profiles.current_organization_id`
  - [x] refreshes org context cleanly
  - [x] hydrates billing state for the new org correctly
- [ ] Switching workspace never leaks:
  - [ ] billing plan/state
  - [ ] members list
  - [ ] invites list
  - [ ] cases/packs view state
  - [x] stale current pack/editor context
- [x] No-workspace users see a clean guided state, not a broken/blank/ambiguous one.
- [ ] Billing behavior for new workspace is explicitly confirmed:
  - [ ] per-org trial, or
  - [ ] free by default
- [x] Invite/join behavior is clearly defined for current phase.
- [ ] Workspace lifecycle actions are defined before implementation:
  - [ ] Archive workspace.
  - [ ] Restore workspace.
  - [ ] Transfer ownership.
  - [x] Leave workspace — implemented, deployed, tested with member leave path; chip sync hotfix completed
  - [ ] Export workspace data.
  - [ ] Permanent delete later with delayed deletion and recovery window.
- [ ] Workspace archive behavior is safe:
  - [ ] Existing workspace data is preserved.
  - [ ] Archived workspace is hidden from normal active-workspace switching unless the user opens an archived view.
  - [ ] Archived workspace does not unexpectedly cancel Stripe billing.
  - [ ] Archived workspace still respects owner/account billing rules.
- [ ] Workspace restore behavior is safe:
  - [ ] Only allowed users can restore.
  - [ ] Restored workspace reappears in the workspace switcher.
  - [ ] Billing status refreshes cleanly after restore.
- [ ] Transfer ownership behavior is safe:
  - [ ] Only current Owner can transfer ownership.
  - [ ] New Owner must already be a member of the workspace.
  - [ ] Transfer updates `organizations.owner_id` and `organization_members` roles consistently.
  - [ ] Billing ownership behavior is explicit and tested.
- [x] Leave workspace behavior is safe:
  - [x] Non-owner users can leave.
  - [x] Primary `organizations.owner_id` is blocked until Transfer Ownership exists.
  - [x] Last Owner cannot leave until ownership is transferred or the workspace is archived/deleted by policy.
  - [x] Leaving a workspace never changes Stripe billing.
  - [x] Bottom-left workspace chip syncs after leave and uses workspace initials with circular shape.
- [ ] Export workspace data behavior is safe:
  - [ ] Owner/Admin can export workspace data.
  - [ ] Export includes packs, items, preferences, and member/invite summary where allowed.
  - [ ] Export does not expose payment secrets or private tokens.

### Notes
- Freeze Stripe/Supabase internals unless workspace finalization truly requires touching them.
- Do not start broad runtime refactors until this is stable.
- Current invite truth for this phase is link-based invites plus signed-in acceptance on the existing flow.
- Signed-out invite acceptance still needs live verification.
- Cross-tab and no-leak verification remain release-blocking until they are tested in the browser.

---

## Phase 0.5 — Membership + Invite Lifecycle — MOSTLY COMPLETE / LIVE SIGN-OFF REQUIRED

Goal: make workspace access predictable, safe, and clean before adding archive, restore, transfer, leave, export, or delete actions.

### Required audit first
- [x] Audit all membership and invite code paths before editing.
- [x] Identify every UI entry point for Members, Invites, Copy Link, role changes, remove member, accept invite, and signed-out invite handoff.
- [x] Identify every Edge Function or Supabase query used by membership and invite flows.
- [x] Confirm current role model: Owner, Admin, Member.
- [x] Confirm owner-only actions vs admin actions vs member actions.
- [x] Confirm billing is never changed by invite, accept invite, remove member, or access-loss recovery.

### Membership rules
- [x] Owner can invite, remove, and change roles within policy.
- [x] Admin can invite members only under current product policy: Admin can invite Member, but cannot invite Admin or Owner.
- [x] Admin cannot promote users to Admin or Owner.
- [x] Member cannot invite, remove, or change roles.
- [x] Last Owner cannot be removed.
- [ ] Last Owner cannot leave. *(Phase 0.6A Leave Workspace will enforce this.)*
- [x] Removing a member clears only that member's access, not workspace data or billing.
- [x] Removed member access-loss recovery is implemented for the next billing/account refresh path and Settings lockout.
- [ ] Live two-tab removed-member validation still required.

### Invite rules
- [x] Invite links have clear status: active, accepted, expired, revoked.
- [x] Pending invite revocation is server-side via `org-invite-revoke`; legacy direct browser-side revoke path is disabled.
- [x] Invite acceptance works for signed-in users.
- [ ] Invite handoff works for signed-out users after login/signup. *(Needs live browser sign-off.)*
- [x] Expired or revoked invite shows a clear message.
- [x] Invite cannot grant access to the wrong workspace.
- [x] Invite cannot change billing owner or Stripe customer.
- [x] Invite acceptance creates one membership row only; no duplicate member rows.

### UI/UX rules
- [x] Members tab no longer hangs indefinitely on “Loading permissions...” because it has a timeout and refresh action.
- [x] Role labels and permission copy are consistent across Settings and account/workspace UI for current membership flows.
- [x] Dangerous membership and invite actions use confirmation modals, not browser alerts.
- [x] Error messages are plain, clear, and role-aware.
- [x] Empty invite/member states are helpful and not scary.

### Validation
- [ ] Owner invite → user accepts → member appears. *(Live sign-off required.)*
- [ ] Signed-out invite → login/signup → invite resumes correctly. *(Live sign-off required.)*
- [x] Expired/revoked invite blocked by Edge Function rules.
- [x] Admin cannot promote Admin/Owner.
- [x] Member cannot manage roles.
- [x] Owner cannot remove the last Owner.
- [ ] Removed user loses access to workspace, billing, members, and packs. *(Code implemented; live two-tab sign-off required.)*
- [x] Billing status is unchanged after invite/remove/access-loss recovery.
- [x] Billing status remains unchanged after Leave Workspace. *(Validated with `WS-test4-w-6`; `billing_customers` unchanged.)*
- [x] Billing status remains unchanged after Invite Revocation. *(Live SQL check confirmed invite revoke changes only invite status/revoked_at; billing row unchanged.)*

### Completed implementation checkpoints
- [x] Phase 0.5C-1: Invite authorization hardening.
  - Admin can invite Member only.
  - Owner can invite Admin or Member.
  - Owner-role invite rows are rejected during accept.
  - Accepted-token success validates the signed-in user email before exposing `organization_id`.
- [x] Phase 0.5C-2: Membership UI safety.
  - Sensitive role changes require confirmation.
  - Invite revoke uses confirmation.
  - Role/member mutations refresh member list plus org/billing context.
  - Permissions loading has a bounded timeout and refresh action.
- [x] Phase 0.5C-3: Invite expiration.
  - `organization_invites.expires_at` added and backfilled.
  - New/resend invites refresh expiry.
  - Expired invites are rejected before membership insert.
  - Settings Pending Invites displays expiry state.
- [x] Phase 0.5D: Access-loss and member-removal hardening.
  - Active-org billing 403 triggers guarded access-loss recovery.
  - Settings General, Members, and Billing lock the lost workspace and hide scoped controls.
  - No sign-out, reload, Stripe mutation, or workspace data deletion occurs during access-loss recovery.
- [x] Phase 0.6B: Invite revocation Edge Function.
  - Added `org-invite-revoke` as the server-side boundary for invite revocation.
  - Owner/Admin role checks happen server-side.
  - Admin can revoke Member invites only; Admin cannot revoke Admin invites.
  - Accepted invites are blocked from revoke; already-revoked invites are idempotent.
  - Settings revoke flow now uses `revokeOrgInvite()` service wrapper.
  - Legacy direct browser-side `SupabaseClient.revokeOrganizationInvite()` mutation path is disabled.
  - No billing, Stripe, organization delete, or membership mutation occurs during invite revoke.

### Still open before Phase 0.5 can be closed
- [ ] Live owner invite → accept → member appears.
- [ ] Live signed-out invite handoff after login/signup.
- [ ] Live expired invite rejection after manually setting `expires_at` in the past.
- [x] Live revoke pending invite via `org-invite-revoke` Edge Function.
- [ ] Live already-revoked invite idempotency check.
- [ ] Live accepted invite revoke rejection.
- [x] Phase 0.6B-2: fix Settings invite render stable-key so revoked pending invites disappear immediately without tab switching.
- [x] Phase 0.6B-2: show pending Admin invites to Admin users for transparency, but disable/guard Revoke/Resend for Admin-on-Admin rows with clear owner-only copy.
- [ ] Live two-tab removed-member access-loss validation.
- [ ] Confirm no billing or Stripe records change after invite, accept, remove, or access-loss recovery.

---

## Phase 0.6 — Workspace Lifecycle Actions — PLANNED AFTER MEMBERSHIP

Goal: add safe workspace lifecycle tools without data loss, billing mistakes, or role leaks.

- [x] Phase 0.6C Archive Workspace audit completed.
- [x] Phase 0.6C Archive Workspace implemented, migration applied, Edge Function deployed, and partially live-tested.

### Archive workspace
- [x] `archived_at` column, index, guard trigger, and active-org RPC filtering added via `2026050701_organization_archive.sql`.
- [x] Owner can archive workspace (owner-only `org-archive-workspace` Edge Function).
- [x] Admin and Member do not see the Archive Workspace button in Settings.
- [x] Archive preserves all members, invites, billing rows, Stripe state, packs, cases, and storage.
- [x] Archive does not cancel Stripe subscription.
- [x] Archived workspace is filtered from `getUserOrganizations` in both RPC and fallback paths.
- [x] `org-archive-workspace` Edge Function deployed.
- [x] `2026050601_fix_signup_auto_org_uuid.sql` and `2026050701_organization_archive.sql` pushed to production.
- [x] Archived workspace is preserved and recoverable (data intact in DB).
- [x] Active workspace fallback after archiving the only active workspace.
- [x] No-active-workspace state shown cleanly after archiving the only workspace.
- [x] Settings does not show archived workspace as active after archive.
- [x] Billing copy explains that archived workspaces still count toward plan/workspace limits.

### Phase 0.6C-2 / 0.6C-3 Archive no-active-workspace follow-up — IMPLEMENTED
- [x] Fix frontend org-context fallback after archiving the only active workspace.
- [x] Do not reuse cached orgs when fresh active org list is empty.
- [x] Do not let profile/local/membership org IDs become active unless they exist in active orgs.
- [x] Clear stale local org hint when no active workspace is confirmed.
- [x] Bottom-left chip must not show archived workspace or stay on `Loading...` after confirmed no-active state.
- [x] Settings must not show archived workspace as active.
- [x] Settings Billing must render a clean no-active message instead of requiring manual Refresh.
- [x] No-active-workspace state must appear only after settled auth/org state.
- [x] No sign-out, reload, Stripe call, billing mutation, member deletion, invite deletion, pack/case deletion, storage deletion, CSS, router, or package changes.
- [x] Add audit tests.
- [x] Browser-tested archive fallback switching after fix: active workspace archives now switch immediately to a safe fallback workspace, and no-active state stays stable when all workspaces are archived.

### Restore workspace
- [ ] Owner can restore archived workspace.
- [ ] Restored workspace appears in switcher again.
- [ ] Org context and billing refresh after restore.
- [ ] Restore respects workspace limit rules.

### Transfer ownership
- [ ] Only Owner can transfer ownership.
- [ ] New Owner must already be a workspace member.
- [ ] Transfer updates `organizations.owner_id` and membership roles in one safe server-side operation.
- [ ] Old Owner becomes Admin or Member based on selected policy.
- [ ] Transfer cannot leave workspace without an Owner.
- [ ] Billing owner behavior must be clearly defined before enabling this.

- [x] Implementation plan reviewed against current membership and billing rules.
- [x] Decision confirmed: Leave Workspace is a separate Edge Function, not a modification of `org-member-remove`.
- [x] Decision confirmed: current `organizations.owner_id` cannot leave in this phase; Transfer Ownership must happen first.
- [x] Decision confirmed: Leave Workspace must not mutate Stripe, billing tables, workspace data, or `organizations.owner_id`.
- [x] Add `supabase/functions/org-leave-workspace/index.ts`.
- [x] Require authenticated `POST` with `{ organization_id }`.
- [x] Verify the caller has a membership row for that workspace.
- [x] Block the last Owner from leaving.
- [x] Block the current `organizations.owner_id` from leaving in this phase, even if another Owner exists, because Transfer Ownership is not implemented yet.
- [x] Delete only the caller's own `organization_members` row.
- [x] Return `{ ok: true, organization_id }`.
- [x] Add `leaveWorkspace(orgId)` service wrapper in `src/data/services/billing.service.js`.
- [x] Add Settings > General “Leave Workspace” action using `UIComponents.confirm()`.
- [x] Admin/member can leave.
- [x] Owner UI shows clear blocked copy when the current user is `organizations.owner_id`.
- [x] Last-owner protection remains server-authoritative, with clear 409 error copy returned from the Edge Function.
- [x] On successful leave, show a toast, close Settings safely, force org/account context refresh, clear stale billing for the left org, and switch to a safe fallback workspace or no-workspace state.
- [x] Leave action does not delete workspace data.
- [x] Leave action does not change Stripe billing.
- [x] Leave action does not transfer ownership.
- [x] Leave action does not sign out or reload the app.
- [x] Phase 0.6A-2 hotfix: bottom-left workspace chip invalidates account cache, syncs after leave, uses workspace initials instead of user initials, and is circular.

- [x] Add `supabase/functions/org-invite-revoke/index.ts`.
- [x] Require authenticated `POST` with `{ invite_id }` and optional `{ organization_id }` validation.
- [x] Load invite server-side and use invite row `organization_id` as the source of truth.
- [x] Verify actor role from `organization_members` for the invite workspace.
- [x] Owner/Admin can revoke Member invites.
- [x] Owner can revoke Admin invites.
- [x] Admin cannot revoke Admin invites.
- [x] Owner-role invite rows are rejected.
- [x] Accepted invites cannot be revoked.
- [x] Already-revoked invites return idempotent success.
- [x] Revoke sets `status='revoked'` and `revoked_at` without deleting the invite row.
- [x] Add `revokeOrgInvite()` service wrapper in `src/data/services/billing.service.js`.
- [x] Settings revoke flow uses the Edge Function wrapper and keeps the existing confirmation modal.
- [x] Legacy direct browser-side `SupabaseClient.revokeOrganizationInvite()` mutation path is disabled.
- [x] Invite revoke does not change Stripe, billing tables, membership rows, workspace data, or organization rows.
- [x] Run final local validation commands after implementation.
- [x] Commit and push Phase 0.6B.
- [x] Deploy `org-invite-revoke` to Supabase.
- [x] Live owner/member/admin revoke checks started and confirmed server-side revoke behavior.
- [x] Confirm billing/Stripe records unchanged after revocation.
- [x] Phase 0.6B-2: fix delayed row removal after successful revoke.
- [x] Phase 0.6B-2: add Admin-on-Admin invite row guard in Settings UI.

- [x] Edit only `src/ui/overlays/settings-overlay.js` and `tests/audit/security-and-invariants.spec.mjs` unless validation proves another file is required.
- [x] Fix render stable-key so invite status changes from `pending` to `revoked` trigger an immediate Members tab repaint.
- [x] Stable key must track pending invite state, not total all-status `orgInvitesData.length` only.
- [x] Revoke success should remove the pending invite row immediately without requiring tab switch, close/reopen, or waiting for unrelated refresh.
- [x] Keep `getOrganizationInvites()` returning all statuses unless a separate audit says otherwise; this phase should fix UI rendering, not server data shape.
- [x] Keep revoked invite rows in the database for audit/history.
- [x] Admin users should see pending Admin invite rows for transparency.
- [x] Admin users should not be able to revoke pending Admin invite rows from the UI; disable or clearly guard the Revoke action with owner-only copy.
- [x] Owner users can still revoke pending Admin invites.
- [x] Admin users can still revoke pending Member invites.
- [x] Keep `UIComponents.confirm()` for allowed revoke paths.
- [x] No native dialogs.
- [x] No Edge Function, billing, Stripe, migration, CSS, AutoPack, PDF/export, package, router, or docs scope creep.
- [x] Run final local validation commands after implementation.
- [x] Commit and push Phase 0.6B-2.
- [ ] Live Owner revokes pending Member invite and row disappears immediately without tab switching.
- [ ] Live Owner revokes pending Admin invite and row disappears immediately without tab switching.
- [ ] Live Admin can see pending Admin invite row but Revoke/Resend are disabled or clearly guarded with owner-only copy.
- [ ] Live Admin can still revoke pending Member invites.
- [ ] Confirm no billing, Stripe, sign-out, reload, backend, or DB-shape changes were introduced.

### Permanent delete later
- [ ] Permanent delete is not part of the first lifecycle release.
- [ ] Later delete must use delayed deletion with recovery window.
- [ ] Paid workspace delete policy must be defined first: cancel first, support-assisted, or scheduled cleanup.
- [ ] Delete must never run as a simple client-side destructive action.

---

## Phase 0.7 — Workspace Data Export — PLANNED AFTER ARCHIVE/RESTORE BASELINE

Goal: let users safely export workspace data before high-risk lifecycle actions.

### Export scope
- [ ] Export packs/projects.
- [ ] Export item library.
- [ ] Export categories/preferences where safe.
- [ ] Export member/invite summary where allowed.
- [ ] Export billing summary only as safe labels, never payment secrets.

### Export rules
- [ ] Owner/Admin can export workspace data.
- [ ] Member export permission must be explicit; default should be no full workspace export.
- [ ] Export is scoped to the active workspace only.
- [ ] Export never includes Supabase JWTs, Stripe customer IDs, subscription IDs, service keys, or private tokens.
- [ ] Export can be used before archive/transfer/delete as a safety step.

---

---

## Phase 0.8 — Runtime Safety / Error States — PLANNED AFTER WORKSPACE LIFECYCLE BASELINE

Goal: add safe recovery surfaces before the next feature wave.

### Scope
- [ ] 404 for unknown hash routes.
- [ ] 404 for missing/deleted current pack while editor is active.
- [ ] 500 fatal error overlay for runtime failures.
- [ ] Maintenance mode via inline config.
- [ ] Pre-boot fatal fallback surface.

### Agreed shape
- [ ] Add one shared `#error-overlay` root in `index.html`.
- [ ] Build controller in `src/ui/error-overlay.js`.
- [ ] Keep `system-overlay` intact.
- [ ] Router handles unknown hash only.
- [ ] Missing-pack detection stays in app/editor render path.
- [ ] Maintenance must block app boot before `src/app.js` loads.
- [ ] Pre-boot fatal handler must include one-shot guard and CDN-failure guard.

### Expected files
- [ ] `index.html`
- [ ] `styles/main.css`
- [ ] `src/ui/error-overlay.js`
- [ ] `src/router.js`
- [ ] `src/app.js`
- [ ] `src/types/global.d.ts` if needed

---

## P1 — Invitations + membership lifecycle — MOVED TO PHASE 0.5
Membership and invite lifecycle is now part of Phase 0.5 because it blocks archive, restore, transfer ownership, leave workspace, export workspace data, and future delayed permanent delete.

---

## P1 — AutoPack correctness — PLANNED

### Highest-priority fixes
- [ ] Fix stacking scoring balance.
- [ ] Enforce `noStackOnTop` / stack-blocking rules in AutoPack.
- [ ] Enforce `maxStackCount` in AutoPack.

### Notes
- Comparison work indicates these are correctness bugs, not just missing features.
- Do these before bigger AutoPack feature expansion.

---

## P1.1 — Quick product wins from comparison research — PLANNED
- [ ] Weight View.
- [ ] Scale panel.
- [ ] Case Browser Manufacturer tab.
- [ ] PDF improvements:
  - [ ] front view
  - [ ] category color chips
  - [ ] page numbers
  - [ ] payload line in header

---

## P1.2 — Crew View / share flow — LATER
- [ ] Public/read-only pack view.
- [ ] Share token / public access rules.
- [ ] Read-only checklist behavior.
- [ ] View persistence rules.
- [ ] RLS review for public share surface.

---

## P1.3 — Product backlog from comparison research — LATER
- [ ] Packing Groups.
- [ ] URL-based sharing beyond JSON import/export.
- [ ] Folder system.
- [ ] Weight heatmap refinements.
- [ ] Additional manual measurement / snapping / view parity as needed.

---

## P1 — App hardening (lint + small safety fixes) — IN PROGRESS
- [ ] Fix eslint warnings with no behavior change.
- [ ] Fix html-validate warnings in the highest-impact UI first.
- [ ] Keep replacing browser-native prompts/alerts in app flows with app UI patterns.

---

## Phase 2 — Runtime cleanup / modularization — DO AFTER WORKSPACE + RUNTIME SAFETY

### Priority order
- [ ] Thin down `src/app.js` by responsibility.
- [ ] Isolate canonical vs legacy runtime files clearly.
- [ ] Split `settings-overlay.js` by concern.
- [ ] Add canonical runtime map doc.
- [ ] Archive stale planning docs.
- [ ] CSS cleanup only after runtime core is easier to reason about.

### Do not do yet
- [ ] Broad refactor before workspace finalization.
- [ ] Broad Stripe/Supabase rewiring without a live bug.
- [ ] Large CSS cleanup first.

---

## P0 Gate (release block)

P0 is green only when ALL items here are checked:
- [x] P0.6 DB health checks clean.
- [x] P0.7 Trial-expired behavior implemented + tested.
- [x] P0.8 Payment failure rules implemented + tested.
- [ ] Phase 0 Workspace creation + switching tested with no org/billing leakage.
- [ ] Phase 0.5 Membership + invite lifecycle audited and stabilized.
- [ ] Phase 0.6 Workspace archive / restore / transfer / leave rules defined before implementation.
- [ ] Phase 0.7 Workspace export rules defined before destructive lifecycle actions.
- [ ] P0.9 Cross-user data isolation + 2-tab stability verified.
- [x] Logout flow uses canonical helper only.
- [ ] Cross-tab logout verified live.
- [ ] No console errors in normal flows (ignore debug mode + expected favicon noise).
- [ ] "Manage billing" never 500.

---

## Running log (keep updated)


- Date: 2026-05-07 — Phase 0.6D-pre remote deploy verified
- What changed:
  - Applied migration `2026050702_org_member_admin_delete_guard.sql` to Supabase.
  - Confirmed migration history is aligned through `2026050702`.
  - Deployed Edge Functions: `delete-account`, `ban-user`, `unban-user`, `org-member-remove`, and `billing-status`.
  - Verified SQL policy `org_members_delete_owner_admin` now limits Admin delete power to `role = 'member'`.
  - Confirmed old broad Admin delete rule `role <> 'owner'` is no longer the Admin branch.
- Validation:
  - `npm test` passed: 117/117.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` and `git diff --cached --check` passed.
- Still required:
  - Live browser test: Admin cannot remove another Admin.
  - Live browser test: Admin can still remove Member.
  - Live browser test: archived workspace billing returns the safe unavailable state.
  - Rotate Supabase DB password because it was pasted during setup.



- Date: 2026-05-07 — Phase 0.6D-pre security hardening committed
- What changed:
  - Retired legacy `delete-account`, `ban-user`, and `unban-user` Edge Functions with 410 responses.
  - Hardened `org-member-remove` so Admin cannot remove Admin.
  - Added RLS migration `2026050702_org_member_admin_delete_guard.sql` so Admin can delete Member rows only.
  - Hardened `billing-status` so archived resolved workspaces return `billing_unavailable`.
  - Added direct client guards for `owner_id` and account deletion-state fields.
  - Added audit tests for all changes.
- Validation:
  - `npm test` passed: 117/117.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` and `git diff --cached --check` passed.
- Deployment still required:
  - Apply `2026050702` migration to Supabase.
  - Deploy changed Edge Functions.
  - Run live Admin/Admin removal and archived billing checks.


- Date: 2026-05-07 — Phase 0.6C-4 archive fallback switching and workspace-limit copy follow-up
- What changed:
  - Stabilized archive fallback switching so archiving the active workspace immediately moves the app to another active workspace when one exists.
  - Exposed `handleWorkspaceArchived` through the public app API so Settings archive success can force the full app org-context refresh path.
  - Settings now resolves only active workspaces from the latest authoritative bundle and clears stale org/member/invite caches after archive fallback or no-active transitions.
  - Corrected workspace-limit billing copy so it no longer says archived workspaces are “currently active.” The copy now states that archived workspaces count toward the workspace limit.
  - Added audit tests for archive fallback switching, stale Settings cache prevention, and workspace-limit archived-count copy.
- Validation:
  - `npm test` passed 104/104.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` and `git diff --cached --check` passed.
- Manual validation:
  - `test4@test.com`: archiving an active workspace immediately switched the app to a fallback active workspace without tab switching, sign-out, or reload.
  - `test5@test.com`: no-active state remains stable when all workspaces are archived; chip shows no active workspace state and Members/Billing remain disabled as expected.
- Next action:
  - Commit and push the copy-only workspace-limit follow-up.
  - Start the pre-Restore Workspace P0 hardening punch list: legacy delete-account removal/stub, ban/unban CORS hardening or removal, Admin→Admin remove guard, RLS admin-delete guard, and billing-status archived-org guard.

- Date: 2026-05-07 — Phase 0.6C-3 frontend stability after archive implemented
- What changed:
  - Confirmed no-active workspace state now dispatches a local empty-org `tp3d:org-changed` event without broadcast, sign-out, or reload.
  - Bottom-left workspace chip uses `orgContextResolved` so it stops showing `Loading...` after active-org or confirmed no-active resolution.
  - Settings clears stale `modalOrgId`, org data, membership, members, invites, loading, edit, and action state on confirmed no-active events.
  - Settings Billing renders a clean no-active workspace message instead of stale archived workspace details or the manual Refresh helper.
  - Added Phase 0.6C-3 audit tests for cleared events, chip loading, Settings no-active clearing, Billing no-active rendering, banner gating, and scope boundaries.
- Validation:
  - `npm test` passed 98/98.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` and `git diff --cached --check` passed.
- Manual validation still required:
  - Browser-test one-workspace owner archive and multi-workspace active archive after this frontend patch.

- Date: 2026-05-07 — Phase 0.6C Archive Workspace implemented and partially live-tested
- What changed:
  - Phase 0.6C Archive Workspace fully implemented in `src/app.js`, `src/core/supabase-client.js`, `src/data/services/billing.service.js`, `src/ui/overlays/settings-overlay.js`, and `tests/audit/security-and-invariants.spec.mjs`.
  - Migration `2026050701_organization_archive.sql` added `archived_at` column, partial index, guard trigger (`tp3d_guard_organizations_archived_at_update`), and updated `get_user_organizations` RPC to exclude archived rows.
  - `org-archive-workspace` Edge Function deployed; owner-only, idempotent, updates only `archived_at`, no billing or Stripe mutation.
  - Supabase migration history repaired: `20260216_account_deletion.sql` renamed to `2026021600_account_deletion.sql` (identical SQL body) to resolve CLI version-string mismatch causing two-row history display.
  - `db push` applied `2026050601_fix_signup_auto_org_uuid.sql` and `2026050701_organization_archive.sql` successfully.
  - Local validation: `npm test` 84/84 passing; lint 0 errors; typecheck clean; `git diff --check` clean.
- Live test:
  - `test5@test.com` archived their only workspace. SQL confirmed `organizations.archived_at` set, `organization_members` preserved, `billing_customers` row unchanged.
  - Bug found: archiving the only workspace does not fully move the UI into the no-active-workspace state. The stale local org hint and `profiles.current_organization_id` are treated as active org candidates by `resolveOrgContextFromBundle` even when the fresh `orgs` list is empty.
  - Root cause: lines `else if (profileOrgId) orgId = profileOrgId` / `else if (membershipOrgId) orgId = membershipOrgId` in `resolveOrgContextFromBundle` fire without a `hasOrg()` guard, returning the archived org ID as `nextOrgId`, preventing `applyOrgContextFromBundle` from reaching `clearOrgContext({ confirmedNoOrg: true })`.
- Next action:
  - Phase 0.6C-2 frontend-only hotfix: add guard in `applyOrgContextFromBundle` to clear org state when `nextOrgId` is not in active orgs and bundle is non-partial. Then browser-test before Restore Workspace.

- Date: 2026-05-05 — Phase 0.6B-2 invite revoke UI follow-up
- What changed:
  - Phase 0.6B-2 was implemented in `settings-overlay.js` and `security-and-invariants.spec.mjs` only.
  - Members tab render stable-key now tracks pending-only invite state using pending invite count/signature and `orgInviteActions.size`.
  - Revoked pending invite rows should repaint immediately after successful revoke instead of waiting for a tab switch.
  - Pending Admin invites remain visible to Admin users for transparency.
  - Admin-on-Admin invite Revoke/Resend actions are disabled or guarded with owner-only copy.
  - No backend, Edge Function, Stripe, billing-status, migration, CSS, app-wide refresh, AutoPack, PDF/export, package, router, or docs scope creep was included in the implementation.
  - Codex and Copilot validation both passed for the current repo state.
  - Local validation passed: `npm test` reported 75/75 passing; lint/typecheck/diff checks passed with existing warnings only.
  - `git status --short` was clean after validation.
- Validation still required:
  - Browser-test Owner revoke of pending Member and Admin invites.
  - Browser-test Admin visibility of pending Admin invite with disabled/guarded Revoke/Resend.
  - Browser-test Admin revoke of pending Member invite.
  - Browser-test Owner/Admin resend behavior for Member/Admin invite rows.
  - Confirm billing/Stripe data remains unchanged.


- Date: 2026-05-05 — Phase 0.6B live-test follow-up
- What changed:
  - `org-invite-revoke` was deployed to Supabase and pushed to `main`.
  - Local validation passed: `npm test` reported 70/70 passing; lint/typecheck/diff checks passed with existing warnings only.
  - Live revoke tests confirmed the Edge Function updates `organization_invites.status='revoked'` and `revoked_at` while leaving billing/Stripe rows unchanged.
  - Owner revoke of pending Member invite worked server-side.
  - Owner revoke of pending Admin invite worked server-side.
  - Admin revoke of pending Member invite worked server-side.
- Issues found:
  - After a successful revoke, the pending invite row does not disappear immediately in Settings; it disappears only after a tab switch or full render.
  - Root cause: Members tab render stable-key tracks total invite count instead of pending invite state, while the invite fetch returns all statuses.
  - Admin users can see pending Admin invites, which is good for transparency, but the Revoke button should be disabled/guarded before the Edge Function rejects it.
- Next action:
  - Implement Phase 0.6B-2 as a small frontend-only patch in Settings overlay plus audit tests.
  - Do not touch Edge Functions, billing, Stripe, migrations, CSS, AutoPack, PDF/export, package files, or router for 0.6B-2.

- Date: 2026-05-05
- What changed:
  - Phase 0.6A Leave Workspace was implemented, deployed, and browser-tested:
    - `org-leave-workspace` removes only the caller's `organization_members` row.
    - Primary owner is blocked until Transfer Ownership exists.
    - Last-owner protection remains server-side.
    - Leave Workspace does not touch Stripe, billing records, workspace data, or `organizations.owner_id`.
    - Browser validation with `test2@test.com` leaving `WS-test4-w-6` succeeded.
    - `billing_customers` for `WS-test4-w-6` remained unchanged after leave.
  - Phase 0.6A-2 chip sync + workspace avatar hotfix was implemented:
    - `handleWorkspaceLeft` invalidates account cache and forces org-context refresh.
    - Bottom-left chip now uses workspace initials, not user initials.
    - Bottom-left chip avatar is circular.
  - Phase 0.6B Invite Revocation Edge Function was implemented and audit-passed:
    - New `org-invite-revoke` Edge Function handles revoke server-side.
    - Settings revoke flow now calls `revokeOrgInvite()`.
    - Direct browser-side invite revocation was disabled.
- Validation still required:
  - Run local validation commands for Phase 0.6B and commit/push if clean.
  - Deploy `org-invite-revoke`.
  - Live owner/admin/member revoke checks.
  - Live accepted-invite revoke rejection and already-revoked idempotency checks.
  - Confirm billing/Stripe records remain unchanged after revoke.
  - Continue live signed-out invite handoff and two-tab access-loss sign-off.

- Date: 2026-05-05
- What changed:
  - Phase 0.5C invite hardening was completed and deployed:
    - Admin cannot invite Admin through the Edge Function.
    - Accepted invite token reuse validates signed-in email before returning `organization_id`.
    - Legacy/corrupt Owner-role invite rows are rejected on accept.
    - Invite expiration is now stored in `organization_invites.expires_at`, backfilled, shown in Settings, and enforced by `org-invite-accept`.
  - Phase 0.5C membership UI safety was completed:
    - Sensitive role changes require confirmation.
    - Invite revoke uses confirmation.
    - Members permission loading has a timeout and refresh action.
  - Phase 0.5D access-loss hardening was completed:
    - Active-org billing 403 now triggers guarded access-loss recovery.
    - Settings General, Members, and Billing lock inaccessible workspaces and hide scoped controls.
    - The flow does not sign out, reload, or touch Stripe/billing data.
  - Phase 0.6A Leave Workspace is the next planned implementation.
  - Phase 0.6A Leave Workspace plan reviewed:
    - New `org-leave-workspace` Edge Function is the correct boundary.
    - `org-member-remove` should stay blocked for self-removal.
    - Primary owner leave is blocked until Transfer Ownership exists.
    - Leave Workspace must remove only the caller's `organization_members` row.
    - Leave Workspace must not sign out, reload, delete workspace data, or touch Stripe/billing records.
- Validation still required:
  - Live invite create/accept/revoke/expired checks.
  - Live signed-out invite handoff check.
  - Live two-tab removed-member access-loss check.
  - Live Leave Workspace validation after Phase 0.6A is implemented.
  - Validate Member/Admin leave success path.
  - Validate primary owner blocked path.
  - Validate last-owner server-side block path.
  - Validate fallback workspace/no-workspace state after leave.
  - Validate billing/Stripe records remain unchanged after leave.


- Date: 2026-04-19
- What changed:
  - Workspace foundation finalization is now the first active priority.
  - Runtime Safety / Error States is now the next planned platform-safety phase after workspace.
  - Comparison research with TruckPacker is now detailed enough to drive AutoPack fixes and selected feature additions without more reverse-engineering.
  - Near-term feature expansion should wait until workspace foundation and runtime safety are stable.

- Date: 2026-04-19
- What changed:
  - Fixed a release-blocking editor export regression where dropdown actions assumed export handlers always returned promises and crashed on `.catch` when they returned `undefined`.
  - Fixed a release-blocking Settings modal regression where `Edit Profile` and `Edit Workspace` could no-op until the modal was reopened because edit-mode flags were missing from the render stable key.
- Verification still required:
  - Re-test `Edit Profile`, `Edit Workspace`, Screenshot, and Export PDF in the browser after this fix.

- Date: 2026-04-19
- What changed:
  - Billing hardening work was applied.
  - A stale Stripe subscription reference was found for test1.
  - The billing row was reset to free/canceled.
  - Portal fallback hardening for stale subscription references is now implemented in code.
  - Checkout/portal client cleanup now routes monthly/yearly selection by interval only; server env remains the Stripe price source of truth.
  - Stripe Node SDK pin was upgraded while keeping the Stripe API version pinned for behavior stability.
- Tests required:
  - Re-test "Manage billing" on test1 with a stale or missing stored subscription id; portal must return 200 via plain customer-session fallback.
  - Re-test monthly and yearly checkout selection after the client-side price-id cleanup.

- Date: 2026-03-08
- What changed:
  - Cross-tab billing dedupe now happens before any handler/log in both storage and broadcast paths, with an expanded signature to UI-relevant fields.
  - Org-role hydration: per-org grace window and inflight flags are set early so hydration does not briefly report `hydrated-no-role` while bundle is inflight.
  - authGate fallback: strengthened guard using three signals (snapshot age, authGate lastSignedInAt age, live wrapper signed-in state) to block false `signed_out` confirmation.
- Validation:
  - Lint: 0 errors
  - Typecheck: clean
  - Tests: 0 failures
- Branch/PR note:
  - `stabilize/auth-billing-hardening` pushed; PR #4 to main is open.
- Next required test:
  - Two-tab sign-off (same user): org context converges; no “Create or join a workspace” banner; no auth flip to SIGNED_OUT during signed-in flows.
  - Two-tab logout sign-off: Tab A logout signs out cleanly; Tab B follows; no signed-in bounce.
  - Two-tab org switch: switch in Tab A updates Tab B billing/members/general to the same org.

- Date: 2026-03-07
- What changed:
  - Cross-tab org/workspace drift hardening in `src/app.js` + `src/ui/overlays/settings-overlay.js`.
  - Supabase auth truth hardening in `src/core/supabase-client.js`.
- Tests required:
  - Tab A workspace switch updates Tab B members/billing/general to same workspace.
  - Refresh stability in both tabs.
  - 401/403 auth invalidation converges both tabs to signed-out quickly.

- Date: 2026-03-07
- What changed:
  - Cross-tab logout regression identified.
  - Plan created to centralize logout into a single awaited helper.

- Date: 2026-03-07
- What changed:
  - Implemented canonical logout helper in `src/app.js` for explicit Logout UI actions.
  - Removed immediate timed reload logout paths.
  - Added logout-in-progress latch.
- Tests run:
  - `npm test` (pass)
  - `npm run -s typecheck` (pass)
  - `npm run -s lint` (pass with existing warnings only)
  - `TP3D_STRESS_URL=http://127.0.0.1:5500/index.html?tp3dDebug=1 npm run stress:ui` (pass)
- Next action:
  - Execute live two-tab manual sign-off checklist for logout bounce regression.

- Date: 2026-03-05
- Release process clarification (no-build static app):
  - This repo is released as static assets; there is no `npm run build` step.
  - Local run command: `python3 -m http.server 5500` then open `http://localhost:5500/index.html`.
  - Release validation commands: `npm test`, `npm run -s typecheck`, `npm run lint`, optional `npm run stress:ui`.
  - Expected console in normal flows: no blocking errors, no unhandled rejections, no token/JWT fragments logged.
- Legacy module notes:
  - Use `src/core/events.js` as the runtime event bus.
  - Use `src/core/storage.js` as runtime storage authority.
  - `src/core/constants.js` storage keys are legacy compatibility values, not runtime authority.

- Date: 2026-02-27
- What changed:
  - Edge Function `/billing-status` maps no-subscription `billing_customers.status='trial_expired'` to `status='trial_expired'`.
  - Trial-expired lock persistence hotfix applied.
  - Auth snapshot fallback applied.
  - `getAccountBundleSingleFlight` strengthened.
  - User-scoped local storage applied.
- Tests run:
  - test3: `trial_expired` modal shown and persistent.
  - test1/test2/test4: active paid Pro loads normally.
- Next action:
  - Start P0 Workspace track.

---

## Fix log — 2026-02-28 — P0 checkpoint commit (lint cleanup)

**Commit:** `8bb5822` · branch `p0-checkpoint-20260228-0149` · pushed to origin

**What changed (no behavior changes):**
- 11 lint warnings fixed.
- 19 warnings deferred.
- Includes prior P0.7/P0.8/P0.9 work in a single checkpoint.

**Checks:** SYNTAX OK · LINT 0 errors 19 warnings

---

## Fix log — 2026-02-27 — Account switcher org label (P0 UI)

**Root cause:** `renderButton()` computed org display text but never wrote it to the DOM.

**Fix — 2 files, 3-line diff:**
- `index.html`: added `data-org-name` to the org label span.
- `src/app.js`: writes display account/org name into that node.

**Commit:** `958dab7` · branch `docs/master-todo-v3` · pushed to origin

**Checks:** SYNTAX OK · LINT OK (0 errors)
