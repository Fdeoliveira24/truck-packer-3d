# Truck Packer 3D — Master TODO (V3)
Last updated: 2026-05-15 — Phase 3B invite handoff validation passed the tested staging flows at `https://truckapp.pxl360.com/index.html`: signed-out handoff preserved invite context, signed-in correct-email accept worked, wrong-email accept was blocked, revoked invite rejection worked, and disposable invite cleanup passed. Phase 1 Release Gate remains PARTIAL because expired-invite live validation, admin/member invite restrictions, DB-level invite billing/Stripe mutation proof, and portal fallback edge cases are still tracked/deferred.

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
- [x] **Two-tabs test (same user, same Chrome profile)**
  - Tab A + Tab B both signed_in must converge to the same OrgContext (orgId not null).
  - [x] Banner must NOT appear while signed_in.
  - [x] No auto sign-out / auto sign-in loop.
  - [ ] getAccountBundleSingleFlight({force:true}) must return session+user in BOTH tabs when signed_in. *(Still needs explicit console/API proof if required; UI convergence passed.)*
- [x] **True separate-profile logout verification**
  - Sign into the same account in two separate Chrome profiles/windows.
  - Logout in Profile A.
  - Profile B must end signed out without bounce-back, stale workspace/sidebar DOM, or auth/session resurrection.
- [x] **Same-tab different-user isolation**
  - Verified `test1@test.com` → logout → `test2@test.com` in the same browser tab.
  - Confirmed workspace, billing, members, packs, folders, and sidebar changed to test2 state with no stale test1 data.
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
- [x] Invite email delivery + link correctness — Phase 3A staging validation passed with Resend.
- [x] Accept invite flow — signed-in correct-email accept and signed-out handoff were staging-validated in Phase 3B.
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

### Current release-gate focus — Phase 1
Phase 0.7C is complete. The next work is not modularization. The next work is release-gate verification and targeted fixes only.


Phase 1 rules:
- Start with browser verification and API/DB proof before writing new code.
- Separate stale audit notes from real reproduced bugs.
- Keep each fix small and tied to one verified failure or one confirmed backend gap.
- Do not do broad `src/app.js` cleanup, UI redesign, CSS cleanup, or runtime modularization during Phase 1.
- If a task touches auth, billing, workspace switching, account deletion, Stripe, or Supabase Edge Functions, treat it as P0-risk and validate with browser/API checks.

### Phase 1 — Immediate closure plan (next two high-value items)

Do these before any new feature work, CSS cleanup, broad UI cleanup, or `app.js` modularization.

#### 1. True separate-profile logout verification — DONE
Goal: prove that logout propagates safely across two separate Chrome profiles/windows, not only two tabs in the same Chrome profile.

Required setup:
- Chrome Profile A signed into `test1@test.com` at `http://localhost:8080/index.html`.
- Chrome Profile B signed into the same `test1@test.com` account at `http://localhost:8080/index.html`.
- Both profiles must be visible to the browser automation before the test begins.

Pass criteria:
- Profile A triggers Logout from the app UI.
- Profile A ends on the signed-out/auth screen and does not bounce back to signed-in UI.
- Profile B also ends signed out without manual refresh, stale workspace/sidebar DOM, auth resurrection, or reload loop.
- Local auth storage/token state is absent in both profiles after logout.
- No blocking console errors, failed auth loops, or token/JWT fragments appear in console/network logs.

If PASS:
- Mark `True separate-profile logout verification` done in this file.
- Add a dated Running log entry with browser/profile setup, account used, timing, and console/network result.

If FAIL:
- Do not proceed to modularization.
- Record exact browser steps, console/network evidence, and affected files before fixing.

#### 2. Real UI-visible over-limit workspace fixture — DONE
Goal: prove the app handles a real `workspace_limit_reached` workspace that is visible/switchable in the UI.

Current known state:
- `test2@test.com` now has reusable fixture workspace `Release-Gate-Overlimit-Test` (`bccf2fea-797f-4318-992e-aff0fdf4efe3`).
- `/billing-status` for that workspace returned `entitlementStatus: "workspace_limit_reached"`, `workspaceCount: 4`, and `workspaceLimit: 3`.
- `wspace-test6` is visible and switchable, but it showed `Subscription Free`, not `workspace_limit_reached`; it is not a valid over-limit fixture.
- Existing active/included billing states passed for `test1` and `test2`.
- `trial_expired` passed for `test3`.

Required setup:
- Create or identify a test account/workspace where `/billing-status` returns `entitlementStatus: "workspace_limit_reached"`.
- The over-limit workspace must appear in the account/workspace switcher.
- The user must be able to switch into that workspace in the browser.

Pass criteria:
- Workspace appears in the switcher and can be selected.
- Billing tab shows over-limit/workspace-limit copy for that exact workspace.
- AutoPack is blocked.
- PDF export is blocked.
- Settings/Billing does not show stale plan data from a different workspace.
- Packs/folders/members remain scoped to the selected workspace.
- No blocking console/network errors.

If PASS:
- Mark `Real UI-visible over-limit workspace fixture` done in this file.
- Add a dated Running log entry with account, workspace id/name, billing-status result, browser behavior, and console/network result.

If FAIL:
- Decide whether the issue is fixture/data, switcher visibility, billing-status classification, or frontend gate copy.
- Fix only the confirmed failing area and validate with browser/API checks.

P0 is green only when ALL items here are checked:
- [x] P0.6 DB health checks run and clean during tests (Q1–Q6 all 0 rows)
- [x] P0.7 Trial-expired behavior implemented + tested (test3 locked; test1/test2/test4 ok)
- [x] P0.8 Payment failure rules implemented + tested (past_due / unpaid / incomplete)
- [ ] Phase 0 Workspace creation + switching tested with no org/billing leakage.
- [x] Phase 0.5 Membership + invite lifecycle audited and stabilized through invite revoke UI follow-up; remaining signed-out invite handoff checks stay tracked separately.
- [ ] Phase 0.6 Workspace archive / restore / transfer / leave rules defined before implementation.
- [ ] Phase 0.7 Workspace export rules defined before destructive lifecycle actions.
- [x] P0.9 Cross-user data isolation + 2-tab stability verified. *(Same-tab different-user isolation, same-profile two-tab checks, and true separate-profile logout passed.)*
- [x] Logout flow uses canonical helper only.
- [x] True separate-profile logout verified live. *(Separate Chrome profiles/windows signed into `test1@test.com`; Profile A logout caused Profile B to show signed-out UI by the 5s sample with no stale workspace DOM, auth keys, or token leaks.)*
- [x] Real UI-visible over-limit workspace fixture verified. *(`test2@test.com` workspace `Release-Gate-Overlimit-Test` is visible/switchable, returns `workspace_limit_reached`, blocks AutoPack/PDF, and shows correct billing copy.)*
- [x] No blocking console/network errors in the tested Phase 1 flows (ignore debug mode + expected favicon noise).
- [ ] "Manage billing" never 500.
  - [x] New-user signup creates auth user, profile, default workspace, owner membership, and billing trial row without DB trigger failure.

---

- Date: 2026-05-14 — Phase 1 release-gate browser pass — UI-visible over-limit workspace
- Verdict:
  - PARTIAL overall, but the real UI-visible over-limit workspace fixture is now closed.
- Fixture setup:
  - Account used: `test2@test.com`.
  - Created test-only active workspace `Release-Gate-Overlimit-Test` (`bccf2fea-797f-4318-992e-aff0fdf4efe3`) under test2 owner profile `4466f0e0-9dc8-4582-8f13-369b5e61957d`.
  - Existing DB trigger seeded a null-status `billing_customers` placeholder for the new repeat-owner workspace; no subscription row or Stripe mutation was created.
  - Fixture remains in place for future release-gate regression checks.
- Billing-status evidence:
  - Direct browser-authenticated call returned HTTP `200`.
  - Result summary: `entitlementStatus: "workspace_limit_reached"`, `isActive: false`, `isPro: false`, `workspaceIncluded: false`, `workspaceCount: 4`, `workspaceLimit: 3`, `canManageBilling: true`, `portalAvailable: true`, `plan: "pro"`, `currentPeriodEnd: 2027-02-23T19:09:34+00:00`.
- Browser evidence:
  - Workspace switcher showed `Release-Gate-Overlimit-Test` after reload and switching into it set active org to `bccf2fea-797f-4318-992e-aff0fdf4efe3`.
  - Settings > Billing showed `Release-Gate-Overlimit-Test`, `Pro`, `Not Included`, and workspace-limit copy: plan includes 3 workspace(s), 4 workspace(s) count toward that limit, including archived workspaces.
  - Created disposable pack `Release Gate Overlimit Pack` inside the fixture to exercise Pro gates.
  - AutoPack attempt was blocked with message: `Workspace limit reached. Upgrade your plan or free a workspace slot to use this Pro feature.` Packed count stayed `0`.
  - Export PDF attempt was blocked with the same workspace-limit Pro-feature message; no PDF export was generated.
  - Packs/Folders stayed scoped to the fixture: `Release Gate Overlimit Pack`, `All Packs (1)`, `Unfiled (1)`, and `No folders yet`.
  - Settings > Members stayed scoped to the fixture: one test2 owner row, no pending invites, no stale member/invite rows from other workspaces.
- Console/network:
  - Direct Supabase health check returned HTTP `200`; direct `/billing-status` returned HTTP `200`.
  - Short CDP monitor saw recurring non-blocking Supabase auth `/auth/v1/user` `ERR_INTERNET_DISCONNECTED` entries from the active session-validation path, but no auth loop, no unexpected billing 401/403/500, and no token/JWT/access-token patterns were observed.
- Code state:
  - No source files changed for this verification.

- Date: 2026-05-14 — Phase 1 release-gate browser pass — true separate-profile logout
- Verdict:
  - PARTIAL. True separate-profile logout was closed by this pass; the real UI-visible over-limit workspace fixture was still open at this point and is closed in the over-limit entry above.
- Browser/profile setup:
  - Chrome Profile A used isolated debug profile on port `9342`.
  - Chrome Profile B used isolated debug profile on port `9343`.
  - Both profiles were signed into `test1@test.com` at `http://localhost:8080/index.html`.
- Evidence:
  - Before logout, both profiles showed `test1-Workspace` with active org `010bda14-fd69-4be1-98ee-21d3051a7144`.
  - Profile A logout was triggered through the app UI and ended on signed-out/auth UI with `tp3d:active-org-id=null`, no workspace DOM, and no auth session/token.
  - Profile B samples at 5s, 10s, 20s, and 35s all showed signed-out/auth UI, no stale `test1-Workspace` DOM, `tp3d:active-org-id=null`, no Supabase auth keys, and no session/token.
  - Console/network observation showed no auth loop, no bounce-back, no reload loop, and `tokenLeakEvents=0`; only non-blocking resource 404/403 entries were observed.
- Code state:
  - Auth/session fix committed as `e0b5e05` (`fix(auth): validate stale session after cross-profile logout`).
  - This entry is documentation-only and did not close the over-limit workspace fixture.

- Date: 2026-05-14 — Phase 1 release-gate next closure plan locked
- Verdict:
  - PARTIAL. Phase 1 is not green yet.
- What is now closed enough to avoid retesting unless regressions appear:
  - Same-tab different-user isolation passed with `test1@test.com` → `test2@test.com`.
  - Same-profile two-tab workspace switch passed.
  - Same-profile two-tab logout passed.
  - Billing tab, Members tab, Packs/folders, and trial-expired owner gate passed in the tested browser flows.
  - Owner-created invite, wrong-email accept rejection, and invite revoke cleanup passed.
- High-value closure status:
  - True separate-profile logout and real UI-visible over-limit workspace behavior are now both verified.
  - Remaining tracked Phase 1 items are deferred/admin-member invite restrictions and portal fallback edge cases.
- Execution rule:
  - Do not start `app.js` modularization, broad CSS cleanup, broad UI cleanup, email invite delivery, or new feature work until remaining Phase 1 checks are closed or converted into targeted follow-up tickets.
- Code state:
  - Documentation-only planning update. No app code change intended.

- Date: 2026-05-14 — Phase 1 release-gate browser partial pass — same-tab user switch, trial-expired, and workspace isolation
- Verdict:
  - PARTIAL. Do not treat Phase 1 as PASS yet.
- What passed:
  - Same-tab different-user isolation passed: signed in as `test1@test.com`, confirmed `test1-Workspace`, Pro Yearly billing, and test1 packs/folders; after logout and login as `test2@test.com`, UI showed `Test2 Workspace`, Pro Yearly billing, test2 pack data, and test2 member row only.
  - Two-tab same-user workspace switch passed in one Chrome profile: `test1-Workspace` to `WS-test1` converged in the second tab; switching back restored the original packs/folders.
  - Billing tab after workspace switch passed: `WS-test1` showed Pro Included and did not show stale `test1-Workspace` billing data.
  - Members tab after workspace switch passed: `WS-test1` showed the correct owner row and no stale pending invite data.
  - Folder data isolation after workspace switch passed: `WS-test1` showed empty packs/folders, and switching back restored `test1-Workspace` data.
  - Trial-expired owner gate passed on `test3@test.com`: UI showed Trial Ended / Free, Subscribe CTA, and AutoPack/PDF attempts routed to upgrade/settings context instead of executing.
  - `wspace-test6` is visible and switchable, but it showed `Subscription Free`, not `workspace_limit_reached`; it is not a valid over-limit fixture.
- What remains blocked:
  - True separate-profile logout.
  - Real UI-visible `workspace_limit_reached` / over-limit workspace fixture.
  - Admin/member invite restriction browser pass.
  - Portal stale-subscription fallback.
  - Portal schedule-managed fallback.
- Next high-value actions:
  - Prepare two separate Chrome profiles/windows signed into the same test account and run the true separate-profile logout test.
  - Create or identify a real UI-visible over-limit workspace fixture and verify it appears in the switcher, returns `workspace_limit_reached`, blocks Pro actions, and shows correct billing copy.
- Code state:
  - No code files changed during this browser pass.
  - No confirmed app bug was reproduced in the completed checks.

- Date: 2026-05-13 — Phase 1 release-gate browser partial pass — same-profile two-tab checks
- Verdict:
  - PARTIAL. Do not treat Phase 1 as PASS yet.
- What passed:
  - Cross-tab logout was verified in one Chrome profile with two app tabs: logout triggered in one tab; after 5s and 10s both tabs showed sign-in UI only; `tp3d:active-org-id` was `null`; Supabase auth token was absent in both tabs.
  - Two-tab same-user workspace switch was verified in one Chrome profile with two app tabs: switching `test1-Workspace` to `WS-test1` in one tab made the other tab converge to `WS-test1`.
  - Billing tab after workspace switch showed `WS-test1`, Pro Included, renewal `5/2/2027`, Manage/Refresh, and no stale `test1-Workspace` billing DOM.
  - Members tab after workspace switch showed `WS-test1` member data, `test1-Owner-D` owner row, and no stale pending invites.
  - Folder data after workspace switch stayed scoped: `WS-test1` showed no packs/folders, and switching back restored `test1-Workspace` packs/folders.
  - Owner-created member invite link flow basic check passed with a disposable invite.
  - Wrong-email invite accept returned HTTP 403 with message: `Invite email does not match the signed-in account.`
  - Invite revoke cleanup passed after disposable invite tests.
- What remains blocked:
  - True separate-profile cross-tab logout.
  - Admin/member invite restrictions.
  - Over-limit workspace behavior.
  - Portal stale-subscription fallback.
  - Portal schedule-managed fallback.
- Why it remains blocked:
  - Automation still saw only one Chrome window/profile, and the required trial-expired, over-limit, admin/member, and portal fallback test data were not available in the active session.
- Code state:
  - No code files changed during this browser pass.
  - No confirmed app bug was reproduced.
  - No blocking console/network bug was found in the tested same-profile flows.

- Date: 2026-05-13 — Phase 1 Release Gate checkout idempotency fix completed
- What changed:
  - Fixed `stripe-create-checkout-session` idempotency key so it is scoped by user, organization, price, and UTC minute bucket.
  - Previous key used user + price + minute only, which could collide when the same user started same-price checkout for two different workspaces within the same minute.
  - Added invariant test proving `organizationId` is part of the checkout idempotency key and that the call site passes the validated organization id.
  - Deployed `stripe-create-checkout-session` after the fix.
- Validation:
  - `npm test` passed: 272/272.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - `git diff --check` and `git diff --cached --check` passed.
  - Supabase function list confirmed `stripe-create-checkout-session` version 33 updated after commit `f5cc8cd`.
- Still required:
  - Run the remaining live browser release-gate tests with separate Chrome profiles/windows:
    - cross-tab logout,
    - same-tab different-user isolation,
    - two-tab same-user workspace switch,
    - admin/member invite restrictions,
    - trial-expired account,
    - over-limit workspace behavior,
    - portal fallback edge cases.


- Date: 2026-05-13 — Phase 0.7C Pack Folder UI merged and closed
- What changed:
  - Completed Pack Folder UI: compact Folders dropdown, Create Folder, Move Pack to Folder modal, Rename Folder, Delete Folder, folder reload persistence, and stale caret CSS cleanup.
  - Fixed the folder persistence reload issue by ensuring `folderLibrary` survives app boot/init state and by flushing folder changes immediately through `Storage.saveNow()` from the Packs screen dependency boundary.
  - Merged `phase-0-7c-pack-folder-ui` into `main` with merge commit `962745a` and pushed `main` to origin.
- Validation:
  - `npm test` passed: 271/271.
  - `npm run lint` passed with 0 errors and existing warnings only.
  - `npm run -s typecheck` passed.
  - Browser validation passed for create folder, empty-name folder, long-name folder, immediate reload after create/rename/move, move to Unfiled, rename/delete protection for All Packs and Unfiled, search + folder filter, status chips + folder filter, grid/list stability, and no console errors.
- Result:
  - Phase 0.7C is closed.
  - Next active phase is Phase 1 Release Gate Verification First.
- Still required:
  - Run Phase 1 browser/API/DB/Stripe release-gate verification before any broad `src/app.js` modularization.


- Date: 2026-05-08 — Live billing-status proof completed; final billing P1 closed
- What changed:
  - Completed read-only live verification against deployed Supabase project `yduzbvijzwczjapanxbd`.
  - No code, database rows, deploys, Stripe records, migrations, Edge Functions, frontend files, workspace lifecycle code, or folder code were changed during the verification.
  - Confirmed active Pro and inherited-plan workspaces now return usable billing fields.
  - Confirmed archived workspaces return sentinel `billing_unavailable` values as expected and should not be treated as Pro billing bugs.
- Validation:
  - `test1 / test1-Workspace`: `status=active`, `entitlementStatus=active`, `isActive=true`, `isPro=true`, `workspaceIncluded=true`, `workspaceCount=2`, `workspaceLimit=3`, `canManageBilling=true`, `portalAvailable=true`, `interval=year`, `currentPeriodEnd=2027-05-02`.
  - `test1 / WS-test1`: `status=active`, `entitlementStatus=included_in_plan`, `isActive=true`, `isPro=true`, `workspaceIncluded=true`, `workspaceCount=2`, `workspaceLimit=3`, `canManageBilling=true`, `portalAvailable=true`, `interval=year`, `currentPeriodEnd=2027-05-02`.
  - `test2 / Test2 Workspace`: `status=active`, `entitlementStatus=active`, `isActive=true`, `isPro=true`, `workspaceIncluded=true`, `workspaceCount=3`, `workspaceLimit=3`, `canManageBilling=true`, `portalAvailable=true`, `interval=year`, `currentPeriodEnd=2027-02-23`.
  - `test2 / WS-test2@test.com`: `status=active`, `entitlementStatus=included_in_plan`, `isActive=true`, `isPro=true`, `workspaceIncluded=true`, `workspaceCount=3`, `workspaceLimit=3`, `canManageBilling=true`, `portalAvailable=true`, `interval=year`, `currentPeriodEnd=2027-02-23`.
  - `test2 / WS-Test2@test.com-ws2`: `status=active`, `entitlementStatus=included_in_plan`, `isActive=true`, `isPro=true`, `workspaceIncluded=true`, `workspaceCount=3`, `workspaceLimit=3`, `canManageBilling=true`, `portalAvailable=true`, `interval=year`, `currentPeriodEnd=2027-02-23`.
  - `test4 / WS-test4-w-1`: `status=active`, `entitlementStatus=included_in_plan`, `isActive=true`, `isPro=true`, `workspaceIncluded=true`, `workspaceCount=7`, `workspaceLimit=3`, `canManageBilling=true`, `portalAvailable=true`, `interval=month`, `currentPeriodEnd=2026-05-26`.
  - `test6 / test6 Workspace`: `status=trial_expired`, `entitlementStatus=trial_expired`, `isActive=false`, `isPro=false`, `workspaceIncluded=false`, `workspaceCount=2`, `workspaceLimit=1`, `canManageBilling=true`, `portalAvailable=false`, `interval=unknown`, `currentPeriodEnd=null`; this is the expected blocked state.
  - `test6 / wspace-test6`: `status=none`, `entitlementStatus=owner_subscription_required`, `isActive=false`, `isPro=false`, `workspaceIncluded=false`, `workspaceCount=2`, `workspaceLimit=3`, `canManageBilling=true`, `portalAvailable=true`, `interval=unknown`, `currentPeriodEnd=null`; this is the expected blocked state.
  - Archived samples returned `status=none` and `entitlementStatus=billing_unavailable`, which is expected sentinel behavior.
- Result:
  - Active Pro workspaces did not return `status=none`, `interval=unknown`, `currentPeriodEnd=null`, or `portalAvailable=false`.
  - `included_in_plan` workspaces returned `isActive=true` and `isPro=true`, so AutoPack/PDF should be allowed by `getProRuleSet`.
  - `trial_expired` returned `isActive=false` and `isPro=false`, so AutoPack/PDF should be blocked.
  - No current active `workspace_limit_reached` workspace was available in this dataset; test6’s second workspace currently returns `owner_subscription_required`, not `workspace_limit_reached`.
  - Test6 has 2 active workspaces from `get_user_organizations`, so the second workspace is visible at the API/switcher data level.
  - Final billing-status P1 was not reproduced and is closed.
- Still required:
  - Keep future billing changes separate from folder UI work.
  - Use Phase 0.7C as a planning-only pass before implementing pack-folder UI.


- Date: 2026-05-08 — Phase 0.7A Workspace JSON Export MVP committed on feature branch
- What changed:
  - Added safe client-only Workspace JSON Export on branch `phase-0-7a-workspace-export-safety`.
  - Export is active-workspace scoped and includes packs/projects plus case/item library data only.
  - Export payload uses `exportType: "workspace"` and `schemaVersion: "workspace-export-v1"`.
  - Pack thumbnails are stripped from the workspace export to keep files smaller and avoid carrying rendered canvas data across workspaces.
  - Settings > General now shows owner/admin-gated “Export Workspace Data” and a reminder near Archive Workspace to export a JSON backup before major workspace changes.
  - Existing App Export remains unchanged.
- Validation:
  - Codex reported Phase 0.7A local validation passed with `npm test` 200/200, lint 0 errors with existing warnings only, typecheck clean, and diff checks clean.
  - Browser owner path was tested: Settings opened, Workspace Export was visible, modal opened, export path ran without sign-out, reload, crash, or console error.
  - Payload shape was validated through `exportWorkspaceJSON()` with sample data: valid JSON, workspace schema fields present, arrays present, thumbnails null, and forbidden auth/billing/org fields absent.
- Still required:
  - Merge or fast-forward branch `phase-0-7a-workspace-export-safety` into `main` and push `main`.
  - Deploy static frontend assets so the new browser JS is live.
  - Run manual admin/member browser sign-off when safe accounts are available.
  - Start Phase 0.7B Folder System data-model audit before adding folder code.


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

### P0.9 Cross-user local data isolation (user-scoped storage) — IMPLEMENTED (Phase 1 auth sign-off complete)
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
- [x] Batch 4B-1B: account deletion now blocks any `organizations.owner_id` owner, active or archived. This prevents orphaned workspace owner references before purge; the existing UI surfaces the server block message without sign-out/reload on denial. Browser/UI validation is required before deploying `request-account-deletion` again.
- [x] Batch 4B-2a: support-assisted `cancel-account-deletion` endpoint implemented.
- [ ] Batch 4B-2b: self-service cancel UX/token model remains deferred.
- [x] Batch 4B-orphan: remote orphan `purge-deleted-users` (deployed 2026-01-29, no local source) discovered, retired as a 410 Gone stub locally. Deploy this stub to replace the stale remote function before implementing 4B-3.
- [x] Batch 4B-3A: source-controlled manual/support `purge-deleted-accounts` MVP added with support-secret invocation, service-role deletion, owner-reference skip, safe `purged` status migration preserving live non-deleted `none` rows, and aggregate-only result summary.
- [ ] Batch 4B-3B: scheduling remains deferred. pg_cron is not available on this project; use manual support runs for MVP until Dashboard Scheduled Functions, external scheduler, or GitHub Actions cron is selected.

Validation:
- [x] `npm test` passed: 144/144.
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
- [x] Invite handoff works for signed-out users after login/signup. *(Phase 3B staging sign-off: clean signed-out browser preserved invite context and resumed after matching account login.)*
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
- [x] Owner invite → user accepts → member appears. *(Phase 3B staging sign-off with `test1@test.com` inviting `test3@test.com`; member row appeared once and was cleaned up after validation.)*
- [x] Signed-out invite → login/signup → invite resumes correctly. *(Phase 3B staging sign-off using clean signed-out handoff and matching account login.)*
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
- [x] Live owner invite → accept → member appears.
- [x] Live signed-out invite handoff after login/signup.
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

## Phase 0.7 — Workspace Data Export and Folder Foundation — IN PROGRESS

Goal: let users safely export workspace data before high-risk lifecycle actions.

### Phase 0.7A — Workspace JSON Export Safety MVP — IMPLEMENTED / MERGE + DEPLOY PENDING

Completed:
- [x] Added client-only Workspace JSON Export for the active workspace.
- [x] Export includes workspace packs/projects and item/case library data.
- [x] Export uses `exportType: "workspace"` and `schemaVersion: "workspace-export-v1"`.
- [x] Export strips pack thumbnails by setting `thumbnail` and `thumbnailUpdatedAt` to `null`.
- [x] Export excludes preferences, current pack selection, auth/session data, Supabase keys, Stripe IDs, billing table IDs, raw organization/user IDs, private storage paths, and unrelated localStorage keys.
- [x] Export reads from `StateStore`, not from raw localStorage scans.
- [x] Added `buildWorkspaceExportJSON()` and `parseWorkspaceImportJSON()` support in import/export service.
- [x] Settings > General now shows owner/admin-gated “Export Workspace Data”.
- [x] Archive section now shows an optional reminder to export workspace data first; export is not forced.
- [x] Existing App Export remains unchanged.
- [x] Local validation passed at `npm test` 200/200 with lint 0 errors and typecheck clean.

Still required:
- [x] Merged/fast-forwarded `phase-0-7a-workspace-export-safety` into `main` and pushed `main`.
- [ ] Static frontend deploy required for the new browser JS export path and folder data-model code.
- [ ] Manual browser sign-off remains for Workspace Export owner/admin/member visibility and actual host-browser file download inspection. Owner path was tested earlier; admin/member path still needs safe accounts.
- [ ] Workspace import UI is not wired yet; parser exists only as groundwork.

### Phase 0.7B — Local Pack-Folder Data Model Foundation — IMPLEMENTED / MERGED

Completed:
- [x] Added local pack-only folder data model foundation.
- [x] Added workspace-scoped `folderLibrary` state/storage data.
- [x] Added nullable `pack.folderId` support.
- [x] Added `normalizeFolder()` and stale `pack.folderId` cleanup when referenced folders do not exist.
- [x] Added UI-free `src/services/folder-library.js` with list/create/rename/delete/move/get-packs behavior.
- [x] Folder deletion removes only folder metadata and nulls affected `pack.folderId` values; it does not delete packs or cases.
- [x] Pack deletion does not mutate folder rows.
- [x] Workspace Export now includes `folderLibrary` and preserves `pack.folderId` while still stripping thumbnails.
- [x] Workspace Import parser accepts missing `folderLibrary` as `[]` and rejects malformed non-array folder data.
- [x] Single-pack import/export defaults folder assignment to `null`.
- [x] App Export is now treated as the full local backup path and includes `folderLibrary` safely through normalization.
- [x] Added static/runtime audit coverage for folder storage, normalization, service behavior, export/import, and scope guards.
- [x] Merged and pushed to `main` in commit `805f820`.
- [x] Validation passed at `npm test` 219/219 before the Settings fallback fix.

Still required:
- [ ] No folder UI exists yet; browser folder workflows are not user-testable until Phase 0.7C+.
- [ ] Plan Phase 0.7C Pack Folder UI before implementation.
- [ ] Keep folder UI work separate from billing, auth, Stripe, Supabase, lifecycle, migrations, router, package files, and CSS unless a direct UI need is proven.


### Production readiness billing re-validation — CLOSED

Completed:
- [x] Fixed Settings Billing fallback so missing `entitlementStatus` requires `Boolean(state.isPro && state.isActive)`, not raw `state.isPro`.
- [x] Added audit test proving the Settings fallback requires both Pro and active when `entitlementStatus` is absent.
- [x] Merged and pushed to `main` in commit `7579ab0`.
- [x] Validation passed at `npm test` 220/220 with lint/typecheck clean and existing warnings only.
- [x] Completed read-only live billing-status verification against deployed Supabase project `yduzbvijzwczjapanxbd`.
- [x] Active Pro and `included_in_plan` workspaces returned good billing fields and portal availability.
- [x] `trial_expired` and `owner_subscription_required` returned expected blocked states.
- [x] Archived workspaces returned `billing_unavailable` sentinel values as expected.
- [x] Final billing-status P1 was not reproduced and is closed.

Current production-readiness status:
- [x] No confirmed code-level P0 remains from the latest audit cycle.
- [x] No confirmed billing-status P1 remains after live proof.
- [ ] Data hygiene follow-up remains optional: review archived/test workspace counts and orphan owner rows only with read-only SQL first.


### Phase 0.7C — Pack Folder UI — DONE ✅

Goal: add a small, safe, pack-only folder UI on top of the completed local pack-folder data model.

Status:
- Completed on branch `phase-0-7c-pack-folder-ui`.
- Merged into `main` with merge commit `962745a`.
- Pushed to `origin/main`.
- Browser validated after merge.
- Final validation passed with `npm test` at 271/271, lint with 0 errors, and clean typecheck.

Planning rules:
- [x] Read-only UI audit completed before implementation.
- [x] Reuse existing Packs screen patterns for filters, actions, buttons, and empty states.
- [x] Keep scope pack-only for the first UI release.
- [x] Do not add case folders in this phase.
- [x] Do not touch Supabase, Edge Functions, Stripe, billing-status, workspace lifecycle, migrations, router, package files, or `index.html`.
- [x] Direct UI gap was proven for the compact folder filter button; scoped CSS was added in `styles/main.css` only for `.tp3d-packs-folder-btn`.
- [x] Do not change folder data model unless a real bug is found.

Completed 0.7C implementation sequence:
- [x] Phase 0.7C-1A: Compact Folders dropdown added to the Packs top action row before Import Pack.
- [x] Phase 0.7C-1A: Dropdown filters packs by `pack.folderId` using All Packs, Unfiled, and named folders.
- [x] Phase 0.7C-1A: Folder filter state is included in the Packs dataset key and clears on workspace reset.
- [x] Phase 0.7C-1B: Folder button styling is scoped in `styles/main.css`.
- [x] Phase 0.7C-1B: Folder button tooltip removed.
- [x] Phase 0.7C-1B: Folder button visible caret removed and tests aligned with the no-caret design.
- [x] Phase 0.7C-2: Create Folder.
  - Added `New Folder` action inside the existing Folders dropdown.
  - Used the existing app modal pattern, not `window.prompt`.
  - Created folders through `FolderLibrary.createFolder(name)` from `src/screens/packs-screen.js`.
  - After create, the new folder becomes the active filter and Packs pagination resets.
- [x] Phase 0.7C-3: Move Pack to Folder.
  - Added one compact `Move to Folder` action in the existing pack menu patterns for both grid and list views.
  - The action opens a modal instead of expanding a long inline folder list inside the pack action menu.
  - Moves use `FolderLibrary.movePackToFolder(packId, folderIdOrNull)` only.
- [x] Phase 0.7C-4: Rename/Delete Folder.
  - Rename/Delete appear only for real named folders, not All Packs or Unfiled.
  - Rename uses `FolderLibrary.renameFolder()`.
  - Delete uses `FolderLibrary.deleteFolder()` and moves affected packs to Unfiled without deleting packs or cases.
- [x] Phase 0.7C-4B: Folder reload persistence + compact move UX fix.
  - Fixed folder persistence on immediate reload by flushing folder changes with `Storage.saveNow()` from the Packs screen dependency boundary.
  - Ensured app boot/init state includes `folderLibrary` in all relevant StateStore init/replace paths.
  - Reworked Move to Folder into one compact menu item with a modal for folder choices.
- [x] Phase 0.7C-5: Folder UI polish + stale CSS cleanup.
  - Removed stale `.tp3d-packs-folder-btn__caret` CSS after the no-caret design was stable.
  - Kept CSS scoped to Packs folder UI.
- [x] Confirmed Workspace Export includes `folderLibrary` and preserves `pack.folderId` after folder UI use.
- [x] Confirmed App Export remains the full local backup path and includes `folderLibrary` safely through normalization.
- [x] Confirmed reload preserves folder names and pack-folder assignment after create, rename, and move.
- [x] Confirmed active folder filter does not persist as a stale UI state after reload.

### Phase 1 — Release Gate Verification First — NEXT

Goal: prove the SaaS foundation in the browser and through API/DB checks before adding more product features or modularizing `src/app.js`.

Why this is next:
- Recent audits had conflicting findings. Some reported issues were already fixed, while other gaps are real.
- The safest next step is to verify real behavior with three browser sessions, Supabase table checks, Edge Function checks, and Stripe test-mode checks where needed.
- Code changes should only follow reproduced bugs or confirmed backend gaps.

#### Phase 1A — Browser-first release-gate verification
- [ ] Same-tab different-user sign-in: sign in as User A, sign out, sign in as User B, and confirm no stale billing, workspace, folders, packs, members, settings, or sidebar state appears.
- [x] Cross-tab logout verified in same Chrome profile / two tabs: sign out in one tab and confirm both app tabs clear session, show sign-in, and do not bounce back to signed-in UI.
- [x] True separate-profile cross-tab logout: repeat logout verification with separate Chrome profiles/windows.
- [x] Two-tab same-user workspace switch verified in same Chrome profile / two tabs: switch workspace in Tab A and confirm Tab B converges to the same active org without stale Billing/Members/General data.
- [x] Billing tab after workspace switch: confirm billing belongs to the active workspace, not the previous workspace.
- [x] Members tab after workspace switch: confirm the members/invites belong to the active workspace.
- [x] Over-limit workspace visibility: verify an over-limit workspace still appears in the switcher and can be opened, while Pro actions remain blocked.
- [x] Folder data after workspace switch: confirm folders and pack-folder assignments do not leak across workspaces.
- [ ] Console/network check: no blocking console errors, unhandled promise rejections, failed Edge Function calls, token leaks, or wrong-org network payloads during the above flows.

#### Phase 1B — Billing and Stripe targeted checks
- [x] Verify checkout idempotency behavior and fix `stripe-create-checkout-session` so the idempotency key includes `organizationId` if still missing.
- [ ] Verify `/billing-status` workspace count against known DB rows and product policy. Do not blindly exclude archived workspaces because archived workspaces currently count toward plan limits by policy.
- [ ] Trial-expired gate live check: confirm `billing-status` returns `trial_expired`, Pro actions are blocked, owners see upgrade CTA, and non-owners see owner/support copy only.
- [ ] Confirm Supabase secrets needed for launch are present, including Stripe secrets, workspace-limit secrets, `SITE_URL`, and later email-provider secrets.
- [ ] Run portal manual checks: deep-link update subscription, schedule-managed fallback, stale/missing stored subscription fallback.
  - [ ] Portal stale-subscription fallback opens plain portal with no 500.
  - [ ] Portal schedule-managed fallback opens portal with no 500.

#### Phase 1C — Workspace and account safety checks
- [ ] Verify server-side workspace creation enforcement. Current UI gating is not enough for paid-scale SaaS if direct insert can bypass limits.
- [ ] Verify account deletion safety end to end: owner block, last-owner block, cancellation path, purge safety, and active paid subscription policy.
- [ ] Define and implement ownership-transfer billing policy before exposing transfer broadly to paid users.
- [ ] Align restore workspace limit behavior with the same workspace-count truth used by `/billing-status`.

#### Phase 1D — Invite/email readiness
- [ ] Confirm current invite copy-link flow works: create, resend, copy link, accept signed in, accept after signed-out handoff, expired, revoked, wrong-email.
  - [x] Owner invite member link flow basic check passed with a disposable invite.
  - [x] Wrong-email invite accept rejection returned expected HTTP 403.
  - [x] Invite revoke cleanup passed after disposable invite tests.
  - [x] Signed-out invite handoff preserved invite context and resumed after matching account login.
  - [x] Signed-in correct-email accept created exactly one member row and workspace access worked.
  - [x] Revoked disposable invite was rejected and did not add membership.
  - [ ] Admin/member invite restrictions live check.
  - [ ] Expired invite live rejection check.
- [ ] Confirm `SITE_URL` is set so invite links use the production domain.
- [x] Treat real email delivery as P1 if public team onboarding is part of launch. Phase 3A Resend delivery is implemented and staging-validated.
- [x] Keep manual invite-link fallback even after email delivery is added.

#### Phase 1 output
- [ ] Add a dated Running log entry with pass/fail results, accounts used, screenshots/timestamps where helpful, and any confirmed bugs.
- [ ] If bugs are found, create a small implementation phase for each bug. Do not combine unrelated fixes.

### Post-0.7C Plan — Big Picture Roadmap

This plan exists to prevent scope drift. Folder UI work, billing/workspace safety work, runtime proof tests, and future modularization must stay in separate phases.

#### Step A — Close 0.7C safely — DONE
- [x] Finished 0.7C-2 through 0.7C-5 on `phase-0-7c-pack-folder-ui`.
- [x] Ran `npm test`, `npm run lint`, `npm run -s typecheck`, `git diff --check`, and `git diff --cached --check` during the phase work.
- [x] Browser-tested Packs folder flows: All Packs, Unfiled, create folder, move pack, rename folder, delete folder, reload, and active-filter behavior.
- [x] Merged to `main` with merge commit `962745a`.
- [x] Pushed `main` to origin.

Why this matters:
- Folder UI is closed and no longer the active planning area.
- The next active work is Phase 1 Release Gate Verification, not app modularization.

#### Step A2 — Phase 1 Release Gate Verification — ACTIVE NEXT
- [ ] Run the browser/API/DB/Stripe verification matrix in Phase 1A through Phase 1D above.
- [ ] Fix only confirmed issues, one small patch at a time.
- [ ] Keep `src/app.js` broad cleanup and modularization out of this phase.

Why this matters:
- `src/app.js` still owns auth timing, org context, workspace switching, billing refresh, feature gates, storage scope, overlays, and cross-tab behavior.
- The release gate must prove those contracts before any runtime extraction.

#### Step B — M0 modularization proof tests, no production code moves
- [ ] Start only after Phase 1 Release Gate Verification is green or all Phase 1 blockers are converted into small tracked fixes.
- [ ] Add focused tests for `getProRuleSet()` before extracting it.
- [ ] Cover owner/member behavior and billing states such as active, trialing, trial_expired, payment issue, included_in_plan, workspace_limit_reached, owner_subscription_required, billing_unavailable, and unknown/missing status.
- [ ] Add or preserve tests proving `folderLibrary` changes trigger autosave and Packs render.
- [ ] Create a written inventory of app globals, storage keys, BroadcastChannels, custom events, and exported surfaces before splitting `src/app.js`.

Why this matters:
- `src/app.js` is not just a boot file. It owns auth timing, org context, workspace switching, billing refresh, feature gates, storage scope, overlays, and cross-tab behavior.
- Tests must be added before moving code so future developers and AI tools do not split load-bearing runtime contracts blindly.

#### Step C — First safe modularization only after 0.7C is merged and M0 is green
- [ ] Extract only `getProRuleSet()` to `src/runtime/feature-gates.js` as the first production code move.
- [ ] Keep `canUseProFeatures()`, `refreshBilling()`, `_billingState`, subscribers, checkout/portal functions, and `window.__TP3D_BILLING` in `src/app.js`.
- [ ] Preserve the exact `getProRuleSet(billingSnapshot, userRole)` signature and return shape.
- [ ] Verify AutoPack gate, PDF gate, trial expired UI, payment issue UI, owner/member behavior, and Settings Billing after extraction.

Why this matters:
- `getProRuleSet()` is one of the few clean functions because it takes explicit inputs.
- `canUseProFeatures()` is not the same risk level because it reads runtime globals and must stay in `src/app.js` for now.

#### Step D — Workspace foundation live sign-off
- [ ] Complete live workspace switching checks with no org/billing/member/pack/case leakage.
- [ ] Verify Billing tab always matches the active workspace.
- [ ] Verify Members and Pending Invites always match the active workspace.
- [ ] Verify Packs/Cases local state is scoped to the active user/workspace path.
- [ ] Verify no-workspace state, archived workspace fallback, and active workspace persistence.
- [ ] Complete live two-tab checks for same user, cross-tab logout, cross-tab org switch, and removed-member access loss.

Why this matters:
- Workspace switching is the center of the app. If this is wrong, billing, members, packs, cases, and export can all show the wrong workspace.
- This remains release-blocking until the manual checks are documented.

#### Step E — Membership and invite live sign-off
- [ ] Owner invite -> user accepts -> member appears.
- [ ] Signed-out invite -> login/signup -> invite resumes correctly.
- [ ] Expired invite rejection live check.
- [ ] Already-revoked invite idempotency live check.
- [ ] Accepted invite revoke rejection live check.
- [ ] Removed member loses access in the current tab and another open tab.
- [ ] Confirm no billing or Stripe records change after invite, accept, remove, revoke, or access-loss recovery.

Why this matters:
- Membership controls who can access shared workspace data.
- Invite and removal paths must be correct before expanding collaboration, server-side Packs/Cases, or public sharing.

#### Step F — Workspace lifecycle completion
- [ ] Restore Workspace browser sign-off.
- [ ] Transfer Ownership browser sign-off.
- [ ] Confirm Leave Workspace remains safe after Transfer Ownership exists.
- [ ] Decide and document billing owner behavior after workspace ownership transfer.
- [ ] Keep permanent workspace delete deferred until export, ownership transfer, and retention policy are clear.

Why this matters:
- Archive, restore, transfer, and leave are high-risk lifecycle actions.
- Transfer Ownership is about workspace authority; it should not silently transfer Stripe billing unless a separate billing-transfer policy is designed.

#### Step G — Workspace export/import next layer
- [ ] Finish Workspace Export browser sign-off for Owner/Admin/Member visibility.
- [ ] Inspect downloaded Workspace Export files after folder UI use.
- [ ] Decide whether Workspace Import UI should be enabled, and under which roles.
- [ ] Keep billing, Stripe IDs, raw org/user IDs, JWTs, service keys, and private storage paths out of exports.
- [ ] Consider selective folder export/import only after folder CRUD and move flows are stable.

Why this matters:
- Export is the safety path before destructive lifecycle actions.
- Import can overwrite or duplicate data if ID remapping and role rules are not planned carefully.

#### Step H — Account deletion and purge completion
- [ ] Finish paid-subscription deletion policy.
- [ ] Decide whether account deletion requires subscription cancellation first or support-assisted handling.
- [ ] Keep account deletion blocked when the user owns any workspace through `organizations.owner_id` until transfer/support policy is clear.
- [ ] Keep purge support/manual for MVP; scheduling remains deferred.
- [ ] Add self-service cancel-deletion UX only after the token/session model is designed.

Why this matters:
- Account deletion can orphan workspaces, memberships, billing rows, and Stripe relationships.
- It must stay separate from folder UI and modularization.

#### Step I — Runtime safety and user-facing error states
- [ ] Add unknown-route fallback.
- [ ] Add missing/deleted current pack fallback while Editor is active.
- [ ] Add fatal runtime error overlay checks.
- [ ] Add maintenance mode handling.
- [ ] Add pre-boot vendor/CDN failure fallback.
- [ ] Keep `system-overlay` intact and do not mix runtime safety with app modularization.

Why this matters:
- The app should fail clearly instead of showing a blank or stale screen.
- Runtime safety helps before launch and before larger refactors.

#### Step J — Server-backed Packs/Cases planning
- [ ] Audit the current local Pack/Case/Folder model and decide when to move workspace data to Supabase.
- [ ] Design server tables with `organization_id`, `created_by`, timestamps, and role-aware RLS.
- [ ] Decide local draft/autosave behavior after server persistence exists.
- [ ] Plan migration from local workspace data to server workspace data.
- [ ] Keep local export/import as backup even after server persistence.

Why this matters:
- Current Packs/Cases are local browser data scoped by user/workspace. Real team collaboration and cross-device use require server-backed workspace data later.
- The folder model should remain compatible with future server rows by using IDs and references, not nested full data inside folder records.

#### Step K — Product correctness and quick wins
- [ ] Fix AutoPack stacking scoring balance.
- [ ] Enforce `noStackOnTop` / stack-blocking rules in AutoPack.
- [ ] Enforce `maxStackCount` in AutoPack.
- [ ] Add Weight View.
- [ ] Add Scale panel.
- [ ] Add Case Browser Manufacturer tab.
- [ ] Improve PDF output with front view, category color chips, page numbers, and payload summary.

Why this matters:
- These are user-value improvements, but they should not be mixed into billing/workspace/runtime safety phases.
- AutoPack correctness comes before larger AutoPack feature expansion.

#### Step L — Later modularization phases
- [ ] After M0 and `getProRuleSet()` extraction, consider extracting pure billing helpers only if they take explicit values and do not move `_billingState`.
- [ ] Do not move `refreshBilling()` until cross-tab billing, stale org, epoch, freshness, retry, focus/visibility, and access-loss tests exist.
- [ ] Do not move auth/org/workspace runtime until the full regression matrix is stable.
- [ ] Consider `AutoPackEngine`, `ExportService`, and `KeyboardManager` later only with explicit dependency injection and no direct new reads of `window.__TP3D_BILLING`, `window.OrgContext`, or IIFE-local state.

Why this matters:
- Broad modularization is needed, but doing it too early can recreate the auth/billing/workspace bugs already fixed.
- The safe path is proof first, then tiny moves, then larger DI-based moves.

#### Step M — Documentation cleanup and Project Source sync
- [ ] Update this TODO after each completed phase.
- [ ] Archive stale planning docs only after the new current-truth docs exist.
- [ ] Add or update a runtime map showing which files are canonical and which are legacy.
- [ ] Keep the Project Source updated with the current TODO, current tree, key runtime files, key tests, and latest audits.

Why this matters:
- Future developers and AI tools need a single current source of truth.
- Wrong or stale docs cause wrong audits and unsafe code changes.


### Current production-readiness blocker status — CURRENT

Current confirmed P0 blockers: none.
Current confirmed billing-status P1 blockers: none after read-only live verification on 2026-05-08.
Remaining follow-ups are product work, UI planning, browser smoke checks, and optional data hygiene audits.


### Export scope
- [x] Export packs/projects.
- [x] Export item/case library.
- [ ] Export categories/preferences where safe. Current Workspace Export intentionally excludes user preferences; App Export is the full local backup path and includes preferences plus local libraries.
- [ ] Export member/invite summary where allowed. Deferred because it would require server reads and role decisions.
- [ ] Export billing summary only as safe labels, never payment secrets. Deferred; current 0.7A export includes no billing data.

### Export rules
- [x] Owner/Admin can export workspace data through Settings UI.
- [x] Member export permission defaults to no full workspace export.
- [x] Export is scoped to the active workspace only.
- [x] Workspace Export includes `folderLibrary` once the local folder data model is live.
- [x] Export never includes Supabase JWTs, Stripe customer IDs, subscription IDs, service keys, private tokens, raw org/user IDs, or private storage paths.
- [x] Export can be used before archive/transfer/delete as a safety step.

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
- [ ] Folder system UI. Phase 0.7B local pack-folder data model is implemented and merged. Next step is Phase 0.7C Pack Folder UI planning before any UI implementation. Preferred UI scope: pack-only folders first, using existing Packs screen patterns and no billing/backend scope.
- [ ] Weight heatmap refinements.
- [ ] Additional manual measurement / snapping / view parity as needed.

---

## P1 — App hardening (lint + small safety fixes) — IN PROGRESS
- [ ] Fix eslint warnings with no behavior change.
- [ ] Fix html-validate warnings in the highest-impact UI first.
- [ ] Keep replacing browser-native prompts/alerts in app flows with app UI patterns.

---

## Phase 2A — Staging validation — PARTIAL PASS
- [x] Staging app loads from `https://truckapp.pxl360.com/index.html`.
- [x] Supabase staging CORS / allowed origin works from `https://truckapp.pxl360.com`.
- [x] Login works from staging.
- [x] Billing works from staging.
- [x] Stripe Checkout opens from staging in test mode. Checkout was not completed in this pass.
- [x] Invite links use the staging domain. Token values must not be written into this TODO.
- [x] Wrong-account invite accept is blocked with the expected mismatch message.
- [x] Invite resend works and generates a new staging-domain link.
- [x] Invite revoke works.

## Phase 3A — Resend invite email delivery — STAGING PASS
- [x] Phase 3A Resend invite email delivery is complete on staging.
- [x] Email arrival confirmed in Gmail.
- [x] Resend sender address confirmed: `Truck Packer 3D <invites@truckapp.pxl360.com>`.
- [x] Invite link uses the staging domain. Token values must not be written into this TODO.
- [x] Revoke cleanup after email invite passed.
- [ ] Production domain swap.
- [ ] Final production sender domain.
- [ ] Email template polish.
- [ ] Delivery tracking / webhooks.
- [ ] Broadcast / marketing email features.

## Phase 3B — Invite handoff validation — STAGING PARTIAL PASS
- [x] Owner-created invite email sent from staging and appeared in Pending Invites.
- [x] Signed-out invite handoff preserved invite context on the clean staging URL.
- [x] Signed-in correct-email accept passed with `test3@test.com`; workspace access appeared and the member row appeared once.
- [x] Wrong-email accept guard returned the expected safe rejection and did not add membership.
- [x] Revoked disposable invite was rejected and did not add membership.
- [x] Disposable invite/member cleanup passed after validation.
- [ ] Expired invite live rejection remains blocked until a safe expired invite fixture or explicit DB-write approval is available.
- [ ] DB-level billing/Stripe mutation proof remains open. Browser validation showed no Stripe checkout/portal resources during invite flows, but direct DB row comparison was not performed in this pass.

---

## Phase 2 — Runtime cleanup / modularization — DO AFTER WORKSPACE + RUNTIME SAFETY

### Priority order
- [ ] Thin down `src/app.js` by responsibility only after M0 proof tests are green and after 0.7C folder UI is merged.
- [ ] Isolate canonical vs legacy runtime files clearly.
- [ ] Split `settings-overlay.js` by concern.
- [ ] Add canonical runtime map doc.
- [ ] Archive stale planning docs.
- [ ] CSS cleanup only after runtime core is easier to reason about.
- [ ] First allowed extraction target: `getProRuleSet()` only, to `src/runtime/feature-gates.js`, with tests first.
- [ ] Keep `refreshBilling()`, auth lifecycle, org/workspace switching, StateStore boot/load/save, settings overlay integration, and cross-tab runtime in `src/app.js` until dedicated tests exist.
- [ ] Track known drift for later cleanup: malformed `src/app.js` header JSDoc, stale build stamp, possible `debugger-old.js`, duplicated geometry/default-color helpers, and stale no-caret CSS.

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
- [x] P0.9 Cross-user data isolation + 2-tab stability verified.
- [x] Logout flow uses canonical helper only.
- [x] Cross-tab logout verified live.
- [ ] No console errors in normal flows (ignore debug mode + expected favicon noise).
- [ ] "Manage billing" never 500.

---

## Running log (keep updated)

- Date: 2026-05-15 — Phase 3B invite handoff validation staging PARTIAL PASS
- What passed:
  - Staging URL: `https://truckapp.pxl360.com/index.html`.
  - Owner account `test1@test.com` created disposable invites from Settings > Members.
  - Invite email send path remained working; UI showed `Invite email sent. You can also copy the invite link.`
  - Signed-out invite handoff preserved invite context on the clean staging URL without displaying the invite token in the app UI.
  - Correct-email accept passed with `test3@test.com`; `test1-Workspace` access appeared, Settings > Members showed the user as `Member` exactly once, and the test member was removed after validation.
  - Wrong-email guard passed through the deployed accept endpoint with the expected mismatch rejection and no membership insert.
  - Revoked disposable invite rejection passed with the matching account: accept returned a business rejection, the user did not join `test1-Workspace`, and no member row was added.
  - Disposable pending invites created during this pass were revoked. The pre-existing `info@pxl360.com` admin invite was left untouched.
  - Browser resource check showed no Stripe checkout/portal resources during the invite flows.
  - Console/network check found no blocking app errors after cleanup and no token/API-key/JWT leakage in the inspected browser output.
- Still open / deferred:
  - Expired invite live rejection remains blocked because no safe expired invite fixture or DB-write approval was available.
  - Admin/member invite restrictions live check remains tracked separately.
  - Full DB-level proof that invite create/accept/revoke did not mutate billing/Stripe rows was not performed in this pass.
  - Stripe portal fallback edge cases remain tracked separately.
- Safety:
  - Full invite tokens are intentionally omitted from this TODO.
  - No secrets, API keys, JWTs, service-role keys, Stripe keys, or full signed URLs are recorded.

- Date: 2026-05-15 — Phase 3A Resend invite email delivery staging PASS
- What passed:
  - Staging URL: `https://truckapp.pxl360.com/index.html`.
  - Invite email was sent from the app UI.
  - UI showed `Invite email sent. You can also copy the invite link.`
  - Email arrived in Gmail.
  - Resend sender confirmed as `Truck Packer 3D <invites@truckapp.pxl360.com>`.
  - Resend showed the email as sent and delivered.
  - Invite link used the staging domain. The invite token value is intentionally omitted from this log.
  - Email support path used `support@pxl360.com`.
  - Wrong-email guard had already passed with the expected HTTP 403 mismatch message.
  - Disposable invite was revoked after testing.
  - Console had no blocking errors.
- Still open / deferred:
  - Production domain swap.
  - Final production sender domain.
  - Email template polish.
  - Delivery tracking / webhooks.
  - Broadcast / marketing email features.
  - Admin/member invite restriction checks not already verified.
  - Stripe portal fallback edge cases.
- Safety:
  - No secrets, API keys, JWTs, service-role keys, Stripe keys, or full invite tokens are recorded in this TODO.

- Date: 2026-05-15 — Phase 2 staging validation pass
- What passed:
  - Staging app loaded from `https://truckapp.pxl360.com/index.html`.
  - Login worked from staging with `test1@test.com` and `test3@test.com`.
  - Supabase staging CORS / allowed-origin configuration worked after staging secrets were set.
  - Billing worked from staging and returned the expected account states.
  - Stripe Checkout opened from staging in test mode. Checkout was not completed; returning to the app still showed the expected upgrade state.
  - Link-based invite flow generated a staging invite link. The invite token value is intentionally omitted from this log.
  - Wrong-account invite accept was blocked with `Invite email does not match the signed-in account.`
  - Opening the invite link in another browser showed the login page, which is expected for signed-out handoff.
  - Resend invite generated a new link.
  - Revoke invite worked.
- Not done:
  - Phase 3 real invite email delivery remains not implemented; no email-provider path was tested in this pass.
  - Checkout completion and webhook/return finalization were not tested because checkout was intentionally not completed.
- Safety:
  - No secrets, JWTs, service keys, Stripe keys, or invite tokens were recorded.
  - No source files or `Production/` files were changed as part of this TODO update.
- Validation:
  - Post-update local validation passed with `npm test`, `npm run lint`, `npm run -s typecheck`, `git diff --check`, and `git diff --cached --check`.


- Date: 2026-05-08 — Phase 0.6D-pre account deletion owner-block checkpoint
- What changed:
  - Retired the orphan remote `purge-deleted-users` endpoint by source-controlling and deploying a 410 Gone stub.
  - Verified the project does not expose `cron.job`; pg_cron scheduling is not currently available from SQL on this Supabase project.
  - Support-assisted `cancel-account-deletion` is deployed and protected by `ACCOUNT_DELETION_SUPPORT_SECRET`; live curl returned `200` with `already_canceled:true` for a test user.
  - Policy decision locked: users who are `organizations.owner_id` of any workspace, active or archived, must be blocked from self-service account deletion until ownership is transferred or support resolves it.
- Validation:
  - Latest local validation before owner-block UI validation passed with `npm test`, `npm run lint`, `npm run -s typecheck`, `git diff --check`, and `git diff --cached --check`.
  - Retired legacy `purge-deleted-users` endpoint live curl returned HTTP 410 with neutral retired copy.
- Still required:
  - Validate Batch 4B-1B owner-block implementation in browser and terminal before deploy.
  - Deploy `request-account-deletion` after 4B-1B validation passes.
  - Decide the scheduling method for future `purge-deleted-accounts` because pg_cron is unavailable.
  - Rotate the Supabase DB password because it was pasted during setup.


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
