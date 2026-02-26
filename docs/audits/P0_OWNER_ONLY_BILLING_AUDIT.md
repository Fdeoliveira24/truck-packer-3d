# P0 Audit — Owner-Only Billing Management

**Date:** 2026-02-25  
**Scope:** Confirm no path exists for admin / member / viewer to trigger: checkout session creation, portal session creation, or any billing state mutation through client code or Edge Functions.

---

## A) Executive Summary

| Verdict | Detail |
|---------|--------|
| **PASS** | All four mutation surfaces (2 Edge Functions, 2 UI gates) enforce `role === 'owner'`. No bypass path was found at any layer. |

The P0 change removed `admin` from the billing-management allow-list across all layers:

1. **Edge Function gates** — `stripe-create-checkout-session` and `stripe-create-portal-session` both return HTTP 403 for any role that is not `"owner"`.
2. **Client UI gates** — `settings-overlay.js` and `app.js` both compute `canManageBilling = role === 'owner'`, hiding Subscribe / Manage buttons and showing "Only the org owner can manage billing" text for non-owners.
3. **Read-only endpoints** — `billing-status` is a read-only GET endpoint with no role gate (intentional; all members may view billing status). The webhook endpoint validates Stripe signature, not user role.
4. **RLS** — `billing_customers` SELECT policy allows `owner` + `admin` (read-only view, no INSERT/UPDATE/DELETE client policies). This is intentional: admins can *see* billing status but cannot *mutate* it.

**No FAIL items. No patches required.**

---

## B) Evidence Map

| # | Layer | File | Line(s) | Gate/Check | Verdict |
|---|-------|------|---------|------------|---------|
| 1 | Edge Function | `supabase/functions/stripe-create-checkout-session/index.ts` | 169-172 | `if (memberRole !== "owner")` → 403 | ✅ PASS |
| 2 | Edge Function | `supabase/functions/stripe-create-portal-session/index.ts` | 77-80 | `if (role !== "owner")` → 403 | ✅ PASS |
| 3 | Edge Function | `supabase/functions/billing-status/index.ts` | 270-300 | Membership check only (any member); read-only endpoint | ✅ N/A (no mutation) |
| 4 | Edge Function | `supabase/functions/stripe-webhook/index.ts` | 850-870 | Stripe signature verification; no user auth | ✅ N/A (server-to-server) |
| 5 | UI Gate | `src/ui/overlays/settings-overlay.js` | 1749 | `canManageBilling = billingRole === 'owner'` | ✅ PASS |
| 6 | UI Gate | `src/ui/overlays/settings-overlay.js` | 2036 | Subscribe CTA requires `canManageBilling` | ✅ PASS |
| 7 | UI Gate | `src/ui/overlays/settings-overlay.js` | 2125-2128 | Non-owner sees "Only the org owner can manage billing" | ✅ PASS |
| 8 | UI Gate | `src/ui/overlays/settings-overlay.js` | 2145-2146 | Manage button disabled reason: "Only the org owner can manage billing." | ✅ PASS |
| 9 | UI Gate | `src/app.js` | 5436-5437 | `canManageBilling = activeRole === 'owner'` | ✅ PASS |
| 10 | UI Gate | `src/app.js` | 5484 | Sidebar upgrade card hidden when `!canManageBilling` | ✅ PASS |
| 11 | UI Gate | `src/app.js` | 5227-5249 | Trial-expired modal: non-owner sees hint text + toast on click | ✅ PASS |
| 12 | Client Service | `src/data/services/billing.service.js` | 451 | `createCheckoutSession` → POST `/stripe-create-checkout-session` | ✅ Pass-through (server gate is #1) |
| 13 | Client Service | `src/data/services/billing.service.js` | 488 | `createPortalSession` → POST `/stripe-create-portal-session` | ✅ Pass-through (server gate is #2) |
| 14 | Shared Auth | `supabase/functions/_shared/auth.ts` | 127-154 | `requireUser()` → JWT validation via `auth.getUser(jwt)` | ✅ PASS |
| 15 | Shared Stripe | `supabase/functions/_shared/stripe.ts` | 21-30 | `assertAllowedPrice()` → only configured price IDs accepted | ✅ PASS |
| 16 | Shared CORS | `supabase/functions/_shared/cors.ts` | 1-100 | `getAllowedOrigin()` → hardcoded allow-list | ✅ PASS |
| 17 | RLS | `billing_customers` SELECT policy | DB | owner + admin can read (no INSERT/UPDATE/DELETE) | ✅ Intentional |
| 18 | RLS | `subscriptions` SELECT policy | DB | user-scoped via `auth.uid()` | ✅ N/A |
| 19 | RLS | `webhook_events` | DB | No client-facing policies (service-role only) | ✅ PASS |

---

## C) Threat Model

| # | Abuse Case | Attack Vector | Mitigation | Status |
|---|-----------|--------------|------------|--------|
| C1 | Admin calls checkout edge function directly | `curl -H "Authorization: Bearer <admin_jwt>" POST /stripe-create-checkout-session` | Edge function queries `organization_members.role`, returns 403 for non-`owner` (Evidence #1) | **BLOCKED** |
| C2 | Admin calls portal edge function directly | `curl -H "Authorization: Bearer <admin_jwt>" POST /stripe-create-portal-session` | Edge function queries `organization_members.role`, returns 403 for non-`owner` (Evidence #2) | **BLOCKED** |
| C3 | Admin modifies client-side `billingRole` via DevTools | `window.__someObj.role = 'owner'` in console | UI gate bypassed, but `startCheckout()` → `createCheckoutSession()` → server POST → server checks `organization_members.role` → 403 (Evidence #1, #12) | **BLOCKED** (server-side enforcement) |
| C4 | Admin crafts request with forged `organization_id` to a different org | POST with `organization_id` of an org where user is not a member | Edge function checks `organization_members` for the requesting `user.id` + provided `organization_id`; returns no row → role is empty string → `!== "owner"` → 403 | **BLOCKED** |
| C5 | Admin accesses billing-status to exfiltrate subscription data | GET `/billing-status?organization_id=<org_id>` | `billing-status` verifies membership (any role), returns read-only status fields. No Stripe secret keys, customer IDs, or payment methods exposed in response. Response fields: `plan, status, isActive, interval, trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd, cancelAt, portalAvailable` | **Acceptable** (read-only, member-scoped) |
| C6 | Webhook forgery to mutate billing state | POST to `/stripe-webhook` with crafted payload | Webhook verifies `stripe-signature` using `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEventAsync()` (Evidence #4, line ~861). Invalid signature → 400 | **BLOCKED** |
| C7 | Member/viewer accesses billing tab and clicks disabled buttons | Navigate to Settings → Billing tab | Subscribe CTA is not rendered for non-owners (Evidence #6-#8). Manage button is disabled with reason text. Even if somehow enabled client-side, server gates block (C1/C2) | **BLOCKED** |
| C8 | Race condition: user promoted to admin between UI render and checkout | User's role changes after `canManageBilling` computed | Server-side gate re-queries `organization_members.role` at request time. Stale UI state is harmless — server is the authority | **BLOCKED** |

---

## D) Consistency Checks

### D1. Role source consistency

| Location | Role Source | Normalized |
|----------|-----------|------------|
| `stripe-create-checkout-session` L169 | `organization_members.role` via service client | `String(memberRow?.role \|\| "").toLowerCase()` |
| `stripe-create-portal-session` L77 | `organization_members.role` via service client | `String(memberRow?.role \|\| "").toLowerCase()` |
| `settings-overlay.js` L1747 | `getRoleForOrg(lockedOrgId \|\| billingOrgId)` | Returns lowercase string |
| `app.js` L5436 | `orgContext.role` | `String(...).toLowerCase()` |

**Verdict:** ✅ All locations normalize to lowercase before comparison. Consistent.

### D2. String case comparison

| Location | Comparison | Safe? |
|----------|-----------|-------|
| Checkout L170 | `memberRole !== "owner"` (after `.toLowerCase()`) | ✅ |
| Portal L78 | `role !== "owner"` (after `.toLowerCase()`) | ✅ |
| Settings L1749 | `billingRole === 'owner'` (getRoleForOrg returns lowercase) | ✅ |
| App L5437 | `activeRole === 'owner'` (after `.toLowerCase()`) | ✅ |

**Verdict:** ✅ All comparisons are against lowercase literal `"owner"`. No case mismatch risk.

### D3. Error message consistency

| Location | Message |
|----------|---------|
| Checkout edge function | "Only the org owner can manage billing for this organization" |
| Portal edge function | "Only the org owner can manage billing for this organization" |
| Settings overlay L2128 | "Only the org owner can manage billing for this organization." |
| Settings overlay L2146 | "Only the org owner can manage billing." |
| App.js trial-expired hint L5230 | "Only the org owner can complete subscription checkout." |
| App.js trial-expired toast L5246 | "Only the org owner can manage billing for this workspace." |

**Verdict:** ✅ All messages consistently say "org owner" (not "owners/admins"). Minor wording variations are acceptable for context (Settings tab vs. modal vs. toast).

### D4. Null/missing role handling

| Location | When role is null/empty | Result |
|----------|----------------------|--------|
| Checkout L169-170 | `String(null \|\| "").toLowerCase()` → `""` → `"" !== "owner"` → 403 | ✅ Denied |
| Portal L77-78 | Same pattern → `""` → 403 | ✅ Denied |
| Settings L1749 | `billingRole === 'owner'` → `false` | ✅ Denied |
| App L5437 | `activeRole === 'owner'` → `false` | ✅ Denied |

**Verdict:** ✅ Null/missing role always results in denial. Fail-closed.

---

## E) UX/UI Checklist

| # | Scenario | Expected Behavior | Location | Verified |
|---|---------|-------------------|----------|----------|
| E1 | Owner opens Billing tab | Subscribe CTA visible, Manage button enabled | Settings overlay L2036, L2145+ | ✅ |
| E2 | Admin opens Billing tab | Subscribe CTA hidden, "Only the org owner" note shown, Manage disabled | Settings overlay L2125-2128, L2145-2146 | ✅ |
| E3 | Member opens Billing tab | Same as admin (L2125 condition: `!canManageBilling`) | Settings overlay L2125 | ✅ |
| E4 | Owner sees sidebar upgrade card | Card visible with "Upgrade Plan" button | App.js L5484-5500 | ✅ |
| E5 | Admin/member sidebar | Upgrade card hidden (`canManageBilling` false → card hidden) | App.js L5484-5486 | ✅ |
| E6 | Owner trial-expired | Modal: "Start Subscription" button functional → pickCheckoutInterval → startCheckout | App.js L5249-5258 | ✅ |
| E7 | Admin trial-expired | Modal: hint "Only the org owner can complete subscription checkout." + toast on click | App.js L5227-5230, L5245-5247 | ✅ |
| E8 | Unknown role (loading) | "Loading permissions…" text; buttons disabled | Settings overlay L2127-2130, L2143 | ✅ |

---

## F) Supabase / RLS Checklist

| # | Check | Finding | Status |
|---|-------|---------|--------|
| F1 | RLS enabled on `billing_customers` | Yes | ✅ |
| F2 | RLS enabled on `subscriptions` | Yes | ✅ |
| F3 | RLS enabled on `stripe_customers` | Yes | ✅ |
| F4 | RLS enabled on `webhook_events` | Yes | ✅ |
| F5 | `billing_customers` INSERT/UPDATE/DELETE client policies | None — all writes are via service role in edge functions | ✅ |
| F6 | `billing_customers` SELECT policy | Owner + Admin of the org can read | ✅ Intentional |
| F7 | `subscriptions` SELECT policy | `auth.uid() = user_id` (user-scoped) | ✅ |
| F8 | `subscriptions` INSERT/UPDATE/DELETE | No client-facing write policies | ✅ |
| F9 | `webhook_events` policies | None (service-role only) | ✅ |
| F10 | Edge functions use `serviceClient()` | Yes — all billing edge functions use service role for DB operations, bypassing RLS intentionally | ✅ |
| F11 | `billing-status` membership check | Verifies user is a member of the requested org before returning status | ✅ |
| F12 | `billing_customers.status` values | `trialing`, `active`, `past_due`, `canceled`, `unpaid` — written only by webhook/billing-status sync | ✅ |

---

## G) Stripe / Webhook Checklist

| # | Check | Finding | Status |
|---|-------|---------|--------|
| G1 | Webhook signature verification | `stripe.webhooks.constructEventAsync(body, signature, webhookSecret)` — fails → 400 | ✅ |
| G2 | Out-of-order event protection | `last_stripe_event_created` comparison: older events skipped | ✅ |
| G3 | Idempotency | `webhook_events` table: `processed` events return early | ✅ |
| G4 | Webhook event types handled | `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.{payment_succeeded,payment_failed,paid}` | ✅ |
| G5 | Organization resolution | Multi-step: metadata → subscriptions table → billing_customers → user membership → `NonRetriableWebhookError` if unresolved | ✅ |
| G6 | `billing_customers` upsert on webhook | Updates `status`, `stripe_customer_id`, `stripe_subscription_id`, `plan_name`, `billing_interval`, `current_period_end`, `cancel_at_period_end`, `trial_ends_at` | ✅ |
| G7 | Competing subscription cleanup | On `active`/`trialing` webhook, other competing subscriptions for same user+org are marked `canceled` | ✅ |
| G8 | `assertAllowedPrice()` on checkout | Only `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_PRO_YEARLY` accepted | ✅ |
| G9 | `buildReturnUrls()` uses caller origin | `new URL(origin)` — scoped to allowed origin from CORS check | ✅ |
| G10 | Non-retriable errors return 200 | `NonRetriableWebhookError` → `{ received: true }` with 200 (prevents Stripe retry storm) | ✅ |

---

## H) Test Matrix

| # | Test | Precondition | Steps | Expected Result |
|---|------|-------------|-------|----------------|
| H1 | Owner checkout | User is `owner` of org | 1. Open Settings → Billing<br>2. Click Subscribe<br>3. Select interval<br>4. Click Continue | Redirected to Stripe Checkout |
| H2 | Admin checkout — UI | User is `admin` of org | 1. Open Settings → Billing | Subscribe CTA not rendered; "Only the org owner" note shown |
| H3 | Admin checkout — API bypass | User is `admin` of org | 1. `curl -X POST /stripe-create-checkout-session -H "Authorization: Bearer <admin_jwt>" -d '{"organization_id":"<org_id>","interval":"month"}'` | HTTP 403: `"Only the org owner can manage billing for this organization"` |
| H4 | Member checkout — API bypass | User is `member` of org | Same as H3 with member JWT | HTTP 403: same error |
| H5 | Non-member checkout — API bypass | User is NOT a member of org | Same as H3 with valid JWT but different org | HTTP 403: role resolves to `""` → `!== "owner"` |
| H6 | Owner portal | User is `owner`, has `stripe_customer_id` | 1. Open Settings → Billing<br>2. Click Manage | Redirected to Stripe Billing Portal |
| H7 | Admin portal — UI | User is `admin` | 1. Open Settings → Billing | Manage button disabled with "Only the org owner" reason |
| H8 | Admin portal — API bypass | User is `admin` of org | 1. `curl -X POST /stripe-create-portal-session -H "Authorization: Bearer <admin_jwt>" -d '{"organization_id":"<org_id>"}'` | HTTP 403: same error |
| H9 | Viewer billing-status read | User is `viewer` of org | 1. `curl /billing-status?organization_id=<org_id> -H "Authorization: Bearer <viewer_jwt>"` | HTTP 200: read-only billing data (plan, status, isActive, etc.) |
| H10 | Non-member billing-status | User is NOT in org | Same as H9 | 403 or no data (membership check fails) |
| H11 | Admin trial-expired modal | Admin, trial expired | 1. App loads<br>2. `billing-status` returns `trial_expired` | Modal shows. "Start Subscription" click → toast: "Only the org owner can manage billing" |
| H12 | Webhook without signature | Any attacker | 1. `curl -X POST /stripe-webhook -d '{}'` | HTTP 400: `"Missing stripe-signature"` |
| H13 | Webhook with invalid signature | Any attacker | 1. `curl -X POST /stripe-webhook -H "stripe-signature: invalid" -d '{}'` | HTTP 400: `"Invalid signature"` |
| H14 | Console role override | Admin, DevTools open | 1. Modify local state to set role to `owner`<br>2. Click Subscribe<br>3. Observe network tab | Network request returns 403 from server |

---

## I) Minimal Patch Plan

**No patches required.** All four mutation surfaces are correctly gated to `owner`-only.

### Items to track (non-P0, informational)

| # | Item | Severity | Notes |
|---|------|---------|-------|
| I1 | `webhook_events` missing `created_at` column | Low | Uses `updated_at` for timestamps; no functional impact |
| I2 | `billing-status` can write to `subscriptions` during Stripe re-sync | Info | This is a self-healing projection; uses service role; not user-triggerable mutations. The billing-status endpoint writes only when DB is stale vs Stripe truth. |
| I3 | CORS dev origins hardcoded | Info | `127.0.0.1:5500`, `localhost:5500`, `127.0.0.1:3000`, `localhost:3000` — acceptable for dev; consider env-gating in production |

---

*Audit completed by reviewing all 4 Edge Functions, 2 shared modules, 2 UI files, 1 service file, and SQL/RLS data provided by the user.*
