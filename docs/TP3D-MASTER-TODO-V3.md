# Truck Packer 3D — Master TODO (V3)
Last updated: 2026-02-28

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

### P0.4 Portal "Manage" reliability (never 500) — DONE ✅
Goal: Manage must always open portal. Never block the user with a 500.

Completed:
- [x] Portal config ID is set in Supabase secrets (`STRIPE_PORTAL_CONFIGURATION_ID`).
- [x] Portal sessions preselect subscription for best UX (deep-link to update page).
- [x] If Stripe rejects flow_data due to schedule-managed subscription:
  - [x] No 500.
  - [x] Fall back to portal session without flow_data and return 200.
  - [x] Minimal logs added (org id + subscription id only).
- [x] Verified:
  - User4: deep-link + Update Subscription works.
  - User1: schedule-managed sub triggers fallback (portal opens, no 500).

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

### P0.8 Payment failure rules (past_due / unpaid / incomplete) — NOT DONE (AFTER P0.7)
Goal: predictable access during payment issues.
- [ ] Define grace window behavior in `/billing-status` (ex: `past_due_grace`).
- [ ] UI: warning banner + Owner-only "Fix payment" link to portal.
- [ ] After grace: block Pro actions (but app still loads).



### P0.9 Cross-user local data isolation (user-scoped storage) — IMPLEMENTED (needs 2-tab verification)
Goal: prevent packs/cases/preferences from leaking between different signed-in users on the same browser.

Completed:
- [x] Local app data is now scoped by user id (storage key `truckPacker3d:v1:<userId>`)
- [x] One-time migration: legacy `truckPacker3d:v1` → first scoped key (then legacy removed)
- [x] App resets + reloads in-memory StateStore on sign-in, sign-out, and user switch so autosave can’t re-persist stale data

Still required (release blocking):
- [ ] **Two-tabs test (same user)**
  - Tab A + Tab B both signed_in must converge to the same OrgContext (orgId not null).
  - Banner must NOT appear while signed_in.
  - No auto sign-out / auto sign-in loop.
  - getAccountBundleSingleFlight({force:true}) must return session+user in BOTH tabs when signed_in.
- [ ] **Cross-tab auth/token churn hardening**
  - React to tp3d:active-org-id storage changes (apply org context + refresh billing).
  - Avoid clearing org context unless definitively signed out.

#### Known issue (multi-tab)
- Observed: in 2 tabs, auth is signed_in + hasToken=true, localOrgHint is set, but OrgContext activeOrgId becomes null and bundle returns session/user null; banner appears; billing stuck pending.
- Impact: P0 release block until resolved.
- **Status (2026-02-28):** Multi-tab root-cause audit in progress (P0.9.1). Top culprit identified: transient SDK SIGNED_OUT during cross-tab token refresh triggers P0.9 state wipe + 1500ms cooldown blocks recovery. Fix plan drafted, not yet applied.

Future (do later):
- [ ] Optional org-scoped local storage (`...:<userId>:<orgId>`) for same-user multi-workspace separation.
  Note: this still won’t share across different people; true sharing requires server-side storage.

---

### P0.9 Delete account safety — NOT DONE (IMPORTANT)

Goal: avoid "wrong hands" deleting accounts or breaking org billing.
- [ ] Only Owner can delete the org (if you support org deletion).
- [ ] Block "Delete Account" if user is last Owner of any org.
- [ ] If org has active paid subscription:
  - define policy: must cancel first OR auto-cancel during delete flow (choose one).
  - Add "contact support" path (`support@pxl360.com` for now + TODO to replace later).

---

### P0 — Workspace ("+ Workspace") track — NOT DONE (ADD NOW)

You asked to add this: it should be part of P0 because it touches org context + billing scope.
- [ ] Define +Workspace creation flow:
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

---

## P1 — Invitations + membership lifecycle — NOT DONE
- [ ] Invite email delivery + link correctness
- [ ] Accept invite flow
- [ ] Expiration rules
- [ ] Removing member never changes billing
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
- [ ] P0.8 Payment failure rules implemented + tested (past_due / unpaid / incomplete)
- [ ] P0 Workspace creation + switching tested (no org/billing leakage)
- [ ] P0.9 Cross-user data isolation + 2-tab stability verified (no banner + orgId resolves in both tabs)
- [ ] No console errors in normal flows (ignore debug mode + expected 404 favicon)
- [x] "Manage billing" never 500

---

## Running log (keep updated)

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