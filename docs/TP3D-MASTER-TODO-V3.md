# Truck Packer 3D — Master TODO (V3)
Last updated: 2026-04-19

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
  - Banner must NOT appear while signed_in.
  - No auto sign-out / auto sign-in loop.
  - getAccountBundleSingleFlight({force:true}) must return session+user in BOTH tabs when signed_in.
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
- [x] P0.8 Payment failure rules implemented + tested (past_due / unpaid / incomplete)
- [ ] P0 Workspace creation + switching tested (no org/billing leakage)
- [ ] P0.9 Cross-user data isolation + 2-tab stability verified (no banner + orgId resolves in both tabs)
- [x] Logout flow uses canonical helper only; no timed `reload()` immediately after `signOut()`
- [ ] Cross-tab logout verified (no sign-out → sign-in bounce) — code complete; live 2-tab sign-off required
- [ ] No console errors in normal flows (ignore debug mode + expected 404 favicon)
- [ ] "Manage billing" never 500

---

## Running log (keep updated)

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
