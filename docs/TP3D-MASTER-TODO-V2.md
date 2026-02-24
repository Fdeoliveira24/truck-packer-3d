# Truck Packer 3D — Master TODO (Pre‑Production → Enterprise Track)

Last updated: 2026-02-20

This list is meant to keep the project stable while we finish Billing/Access, then move into the product work needed to reach “enterprise-grade” and compete with cargo-planner.com.

## How to use this list

- Work top → bottom inside each priority level.
- Keep **Done / Blocked / Notes** updated after each session.
- No production launch until **P0 Gate** is fully green.
- Keep changes **small + testable**. If something touches billing/auth, treat it as “P0 risk”.

---

## P0 — Billing & Access (Stripe + Supabase + App) — MUST be solid

### P0.0 Non‑negotiable invariants (contract)

**Stripe is billing truth** → **billing_customers is projection** → **/billing-status is the only API the UI trusts**.

For any org where a Stripe subscription exists:
- `billing_customers.stripe_customer_id` is NOT NULL
- `billing_customers.stripe_subscription_id` is NOT NULL
- `billing_customers.billing_interval` in (`month`, `year`)
- `billing_customers.current_period_end` is NOT NULL
- If `status='active'` then `trial_ends_at` MUST be NULL

### P0.1 Baseline DB health checks (run before and after each billing test)

- [ ] **No stuck webhook events**
  ```sql
  select count(*) as stuck_received_over_5m
  from public.webhook_events
  where status='received'
    and processed_at is null
    and received_at < now() - interval '5 minutes';
  ```
  Expect: `0`

- [ ] **Webhook terminal distribution looks sane**
  ```sql
  select status, count(*) from public.webhook_events group by status order by status;
  ```
  Expect: mostly `processed`; some `failed` is ok; no long-lived `received`.

- [ ] **Billing projection row is complete for Pro orgs**
  ```sql
  select organization_id, status, plan_name, billing_interval,
         current_period_start, current_period_end,
         cancel_at_period_end, trial_ends_at,
         stripe_customer_id, stripe_subscription_id, updated_at
  from public.billing_customers
  where organization_id = '<ORG_ID>';
  ```
  Expect for paid Pro:
  - `plan_name='pro'`
  - interval is `month|year`
  - Stripe IDs present
  - period end present
  - `trial_ends_at` null when `status='active'`

### P0.2 Billing test matrix (transitions + roles + org isolation)

Run in this order. Record results for **User1 / User2 / User3**.

#### Test 1 — Yearly → Monthly (User2 / test2 org)

- [ ] Stripe Portal: switch yearly plan → monthly
- [ ] Stripe Events: confirm new event(s) exist
- [ ] Re-run **P0.1** checks
- [ ] Verify projection changed (`billing_interval='month'`, `current_period_end` updated)
- [ ] App Billing tab: shows Pro (Monthly) + correct dates
- [ ] Cross-tab: keep 2 tabs open. After portal change confirm both tabs update correctly after:
  - [ ] manual Refresh button
  - [ ] focus/blur (tab switch)
  - [ ] hard reload

#### Test 2 — Monthly → Yearly (switch back)

- [ ] Repeat same checks; expect `billing_interval='year'`

#### Test 3 — Cancel at period end

- [ ] Portal: cancel at period end
- [ ] DB: `cancel_at_period_end=true` while `status` stays `active` until end
- [ ] App: shows cancel message + end date
- [ ] Pro access stays enabled until end

#### Test 4 — Resume after cancel (if Stripe allows)

- [ ] Resume
- [ ] DB: `cancel_at_period_end=false`
- [ ] App: cancel badge removed

#### Test 5 — Payment issue baseline (no new policy yet)

- [ ] Simulate failure (Stripe test methods)
- [ ] Confirm DB becomes `past_due|unpaid|incomplete|incomplete_expired`
- [ ] Confirm app behavior matches current rules (block or warn per current implementation)
- [ ] Confirm messaging is acceptable (no raw errors)

#### Test 6 — Trial org behavior (User3 / trial org)

- [ ] Confirm `status='trialing'` and `trial_ends_at` is future
- [ ] App shows Pro (Trial) + correct end date
- [ ] Members inherit access correctly

#### Test 7 — Org isolation

- [ ] Switch org A → org B → org A
- [ ] Billing tab always matches current org
- [ ] No cache leakage between orgs

#### Test 8 — Role enforcement (owner/admin/member)

- [ ] owner can start checkout + open portal
- [ ] admin can manage billing only if intended by design (confirm)
- [ ] member cannot manage billing (read-only messaging)

#### Test 9 — Idempotency / replay

- [ ] Resend same Stripe event twice
- [ ] Projection stays correct (no rollback)
- [ ] webhook_events entries end in terminal states

#### Test 10 — Incomplete / incomplete_expired routing (important)

- [ ] Simulate incomplete payment (3DS abandon / decline)
- [ ] Confirm app does NOT rely on Portal if subscription is not usable
- [ ] Confirm UX does not trap the user (clear “try again” path)

### P0.3 Billing UX/UI stability (no glitches, no mixed states)

- [ ] Billing tab never shows wrong interval after refresh
- [ ] No “Free” flicker while Pro is active
- [ ] Loading state is clear; tabs do not disappear
- [ ] Errors are user-safe (no stack traces)
- [ ] Billing cache invalidates on org switch
- [ ] Portal return to app triggers billing-status refetch

---

## P0 — Step 1: Trial-expired normalization (small + safe)

**Goal:** If trial is over and user never subscribed, UI must not keep showing “Pro (Trial)”.

### Backend: billing-status normalization

- [ ] If `status='trialing'` AND `trial_ends_at < now()` then return:
  - `plan='free'`
  - `isPro=false`
  - `status='trial_expired'`
  - include `trialEndsAt` for UI message

### UI: add one branch

- [ ] Show: “Free (Trial ended on <date>)”
- [ ] owner/admin: “Subscribe” CTA
- [ ] member: “Ask owner/admin to subscribe”

### Test

- [ ] In a test org only, set `trial_ends_at` to yesterday
- [ ] Confirm billing-status returns `trial_expired`
- [ ] Confirm UI renders correct state
- [ ] Confirm no impact on paid orgs

---

## P0 — Step 2: Past-due grace window (small + safe)

**Goal:** Avoid instant lockout for payment issues while still showing a strong warning.

### Backend: billing-status

- [ ] If `status='past_due'` and within grace window, return:
  - `status='past_due_grace'`
  - `isPro=true`
  - include `graceEndsAt` (or computed deadline) for UI

- [ ] After grace window expires:
  - return `isPro=false` + keep status `past_due` (or `unpaid` depending on Stripe)

### UI

- [ ] Show warning banner (not a full-page block) during grace:
  - “Payment failed. Update by <date> to keep Pro access.”
- [ ] owner/admin: “Fix payment” (Portal)
- [ ] member: read-only banner

### Tests

- [ ] Simulate payment failure → confirm grace banner
- [ ] Confirm Pro features still work during grace
- [ ] Confirm block occurs after grace window

---

## P1 — Cross-tab reliability (billing-first)

- [ ] Two tabs open; confirm both remain correct after:
  - [ ] checkout completion + return
  - [ ] portal plan change (month/year)
  - [ ] cancel + resume
- [ ] Confirm caches are scoped by org id
- [ ] Refresh button only refetches billing-status (no local guessing)

---

## P1 — Invitations + membership lifecycle

- [ ] Invite email sends (deliverability + link correctness)
- [ ] Accept invite flow works
- [ ] Pending state looks correct
- [ ] Invite expiration behavior
- [ ] Role changes update permissions (member/admin/owner rules)
- [ ] Last owner safety rule (cannot remove last owner)
- [ ] Ownership transfer (if supported) updates billing management rights
- [ ] Removing member never changes billing state

---

## P1 — Account lifecycle + auth stability

- [ ] Login on different devices/browsers
- [ ] Session refresh stable (no loops)
- [ ] Sign out fully resets state and returns to login screen
- [ ] Reset password email + link works
- [ ] Account lockout/rate limits (login + reset + invites + billing actions)
- [ ] Deleted account behavior is safe
- [ ] Org deletion behavior is defined and safe:
  - [ ] If org has paid subscription: cancel subscription (policy + implementation)
  - [ ] Webhook handler handles “org missing” safely

---

## P1 — Feature gating enforcement (must be consistent)

- [ ] Every Pro-gated feature checks billing-status at **action time** (not only at render)
- [ ] Free users hitting gated actions get upgrade CTA, not a broken screen
- [ ] Backend enforcement for sensitive operations (Edge Functions / RLS) where needed

---

## P2 — Core product parity features (what makes it compete)

This section is not for production launch until P0 is done, but it should be tracked now so we don’t forget.

### P2.1 Equipment library (containers / trucks / pallets)

- [ ] Add equipment picker:
  - [ ] choose 1 or multiple equipment units (ex: 2 containers + 1 truck)
  - [ ] save favorite equipment presets per org
  - [ ] custom equipment creation (name + dimensions + weight limits)

- [ ] Convert load from one equipment type to another:
  - [ ] “Convert 40ft → 20ft” (re-pack required)
  - [ ] show what no longer fits (clear warnings)

- [ ] Manage equipment set:
  - [ ] add empty units
  - [ ] remove units (with safety warning if items are inside)
  - [ ] reorder units

### P2.2 Multi-container workflow

- [ ] Allocate items across multiple units (manual + auto)
- [ ] Summary view per unit (volume %, weight, CoG if supported)
- [ ] Move items between units (drag/drop)

### P2.3 Interaction improvements (quality-of-life)

- [ ] Move cargo with mouse:
  - [ ] drag in plane with snapping
  - [ ] optional “ghost” preview while dragging
- [ ] Move cargo with keyboard:
  - [ ] arrows / WASD for fine movement
  - [ ] shift for larger steps
  - [ ] rotate keys (R / Q / E etc)
- [ ] Copy/paste cargo placement
- [ ] Undo/redo is reliable and fast

### P2.4 Import/export parity

- [ ] CSV/Excel import with column mapping + preview
- [ ] Bulk quantity creation
- [ ] Export packlist as CSV/Excel
- [ ] PDF export quality improvements (branding + clear layout)

### P2.5 Constraints + realism

- [ ] Stack rules (stackable, max stack, do-not-stack)
- [ ] Orientation rules (this side up / allowed rotations)
- [ ] Fragile rules (prefer top layer)
- [ ] Grouping rules (keep shipment group together)

### P2.6 Weight + balance

- [ ] Weight distribution validator (pass/fail + guidance)
- [ ] Center of gravity indicator (optional)
- [ ] Warnings for overload and axle limits (if supported by equipment model)

### P2.7 Auto-pack improvements

- [ ] Multiple strategies (max volume, unload order, balance)
- [ ] Clear scoring + explain why it chose placements
- [ ] “Try another solution” option

---

## P3 — Enterprise-grade software track (bigger work, later)

### P3.1 Stability + monitoring

- [ ] Error tracking (example: Sentry)
- [ ] Uptime monitoring and alerts
- [ ] Webhook failure alerting
- [ ] Billing anomaly alerting (active but missing Stripe IDs)

### P3.2 Sharing + collaboration

- [ ] Read-only share links for load plans
- [ ] Permissions (view/comment/edit)
- [ ] Activity log
- [ ] Comments

### P3.3 API access (Enterprise tier)

- [ ] API keys per org
- [ ] REST endpoints for packs/cases
- [ ] API for auto-pack
- [ ] Rate limits
- [ ] OpenAPI spec
- [ ] Embeddable viewer SDK

### P3.4 Security

- [ ] Rate limiting across sensitive flows
- [ ] Input sanitization for user text fields
- [ ] CORS rules for Edge Functions
- [ ] RLS audit: ensure least-privilege

### P3.5 Onboarding + empty states

- [ ] First-run sample pack
- [ ] Guided intro
- [ ] Clear empty state CTAs
- [ ] Upgrade prompts that are helpful, not annoying

### P3.6 Browser support + accessibility

- [ ] Chrome/Firefox/Safari/Edge latest 2
- [ ] iOS/Android touch controls
- [ ] Keyboard navigation
- [ ] Contrast and focus indicators
- [ ] Screen reader basics for billing + errors

---

## Pre‑Production Gate (must be all checked)

- [ ] Billing transition tests (P0.2) passed for User1/User2/User3
- [ ] Trial-expired normalization implemented + tested (P0 Step 1)
- [ ] Past-due grace implemented + tested (P0 Step 2)
- [ ] No stuck webhook events over 5 minutes across repeated testing
- [ ] billing_customers complete for all paid orgs
- [ ] Cross-tab billing actions stable (P1)
- [ ] Invite + membership lifecycle stable (P1)
- [ ] Auth flows stable (login, reset password, session refresh)
- [ ] No console errors in normal flows

---

## Notes / running log

- Date:
- What changed:
- Tests run:
- Failures found:
- Next actions:

---

## About a “time frame”

I can’t provide calendar estimates here. What I *can* do is keep the work split into clear gates (P0, P1, P2, P3) so you always know what must be finished first and what can wait.
