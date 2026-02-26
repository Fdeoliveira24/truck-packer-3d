# Truck Packer 3D — Master TODO (V3)
Last updated: 2026-02-26

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

### P0.6 Baseline DB health checks (run during billing tests) — CHECKLIST READY (run + record to close)

SQL queries created: see `docs/P0.6-DB-HEALTH-CHECKLIST.md` (6 queries covering expired trials,
duplicate active subs, missing org_id, billing_customers/subscriptions mismatches).

- [ ] Run all six queries against production (`yduzbvijzwczjapanxbd`)
- [ ] Record results in the Results Log table in the checklist doc
- [ ] Resolve any non-zero rows or document known exceptions
- [ ] Mark P0.6 **DONE** once results are recorded

Previous ad-hoc queries preserved for reference:
- Stuck webhook events (> 5 mins): see checklist
- Billing projection row check: see checklist Q4

---

### P0.7 Trial-expired business rule ("soft lock" + limits) — IMPLEMENTED (needs test to close)

**Implemented in this session:**
- [x] `billing-status`: emits `status='trial_expired'`, `plan='free'`, `isActive=false` for:
  - No-card trials: `billing_customers.status='trialing'` + no `stripe_subscription_id` + `trial_ends_at` past
  - Stripe-managed trials: `subscription.trial_end` in the past + no evidence of paid conversion (current_period_end ≤ trial_end + 3 days)
- [x] Settings-overlay billing tab: shows "Your free trial has ended." (no date), owner CTA, non-owner support message (`support@pxl360.com` — TODO: replace later)
- [x] Trial-expired modal: fires with `dismissible:false`; owner gets "Start Subscription" + Logout; non-owner gets support message + Logout
- [x] Sidebar Subscribe card: fires for `trial_expired` (owner only)
- [x] AutoPack gate: blocks with trial-aware toast + opens billing settings tab
- [x] PDF export gate: updated to show trial-specific message + opens billing settings tab

**Mark DONE only after all three verified:**
- [ ] Fresh trial org: "X days left" badge + sidebar card match
- [ ] Trial-expired org: `status='trial_expired'` returned, correct owner/non-owner messaging, AutoPack + PDF blocked
- [ ] Paid org: no interference with any of the above

**Remains for later phases (P1+):**
- [ ] Excel/CSV import gate (requires changes in `createImportCasesDialog` sub-module)
- [ ] Hard limits: packs max, cases max, invitations max after trial expiry

---

### P0.8 Payment failure rules (past_due / unpaid / incomplete) — NOT DONE (AFTER P0.7)

Goal: predictable access during payment issues.
- [ ] Define grace window behavior in `/billing-status` (ex: `past_due_grace`).
- [ ] UI: warning banner + Owner-only "Fix payment" link to portal.
- [ ] After grace: block Pro actions (but app still loads).

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
- [ ] P0.6 DB health checks run and clean during tests
- [ ] P0.7 Trial-expired behavior implemented + tested
- [ ] P0.8 Payment failure rules implemented + tested
- [ ] Org switch + workspace flow tested (no leakage)
- [ ] No console errors in normal flows
- [x] "Manage billing" never 500 (done)

---

## Running log (keep updated)

- Date:
- What changed:
- Tests run:
- Failures found:
- Next action:
