# Truck Packer 3D — Billing & Entitlement QA Report

**Date:** 2026-05-04
**Scope:** Read-only QA — no code edits, no DB changes, no Stripe mutations
**Tester:** Claude (AI QA agent)
**Test URL:** `http://localhost:8080/index.html`
**Supabase project:** `yduzbvijzwczjapanxbd`
**Sections covered:** A–K (baseline console health, per-user billing, race conditions, settings, portal, UX/copy, security)

---

## 1. Executive Summary

Testing covered six test accounts across all major billing states (active Pro monthly, active Pro annual, trialing, trial expired, workspace-limit-reached). The core entitlement logic in `/billing-status` is largely correct — the right normalized `entitlementStatus` is returned for every tested workspace. However, several high-priority bugs were found that will affect paying users in production.

**Two issues are P0/P1 release blockers:**
1. A cross-user billing state contamination window (~5 s) after an in-tab `signInWithPassword` call without a page reload.
2. `interval: "unknown"` returned for all Pro accounts — Stripe subscription interval is not being read, so the billing UI cannot display Monthly/Annual to any user.

**Two more P1 issues affect a subset of accounts:**
3. `portalAvailable: false` for test2 and test4 — those subscribers cannot access the Stripe billing portal at all from within the app.
4. Inflated `workspaceCount: 7` for test4 due to orphaned `org_member` rows — workspace limit enforcement is incorrect for that account.

Non-blocking DOM hygiene, UX copy gaps, and one missing test account (test5) are documented below.

---

## 2. Test Accounts & Credentials

All accounts use the email-as-password pattern (e.g. `test4@test.com` / `test4@test.com`).

| Account | Expected state | Accessible org(s) found |
|---------|---------------|------------------------|
| test1 | Pro monthly, single workspace | `010bda14-fd69-4be1-98ee-21d3051a7144` |
| test2 | Pro annual, single workspace | `6545674b-7e18-4012-b89d-fbbda6951cc7` |
| test3 | Trial expired | (settings-overlay tested; exact org not captured) |
| test4 | Pro monthly, multi-workspace | `5d86eed4-012c-446d-895f-ac245253c75b` (only 1 of 7 accessible) |
| test5 | Free / no subscription | **Account does not exist** — `Invalid login credentials` |
| test6 | Active trial, 2 workspaces | `47b92b47-a2dc-48b7-bbb5-ac141c86e99c` (trialing), `80a1e0e7-68c3-432f-9776-e2ce68c42ab7` (workspace_limit_reached) |

---

## 3. Billing Matrix (per-workspace `/billing-status` API results)

| Account | Org (short) | `entitlementStatus` | `plan` | `interval` | `portalAvailable` | `canManageBilling` | `workspaceCount` | `workspaceLimit` | `status` | `isActive` |
|---------|-------------|---------------------|--------|------------|-------------------|--------------------|-----------------|-----------------|----------|------------|
| test1 | `010bda14` | `active` | `pro` | `"unknown"` ⚠️ | `true` ✅ | `true` | `1` | `3` | `none` ⚠️ | `true` |
| test2 | `6545674b` | `active` | `pro` | `"unknown"` ⚠️ | `false` ❌ | `true` | `2` | `3` | `none` ⚠️ | `true` |
| test3 | — | `trial_expired` | `pro` | — | — | `true` | — | — | — | — |
| test4 | `5d86eed4` | `active` | `pro` | `"unknown"` ⚠️ | `false` ❌ | `true` | `7` ❌ | `3` | — | `true` |
| test6 WS1 | `47b92b47` | `trialing` ✅ | `pro` | — | — | `true` | `1` | `3` | — | `true` |
| test6 WS2 | `80a1e0e7` | `workspace_limit_reached` ✅ | — | — | — | `false` ✅ | — | — | — | — |

---

## 4. Entitlement Matrix (frontend billing state vs backend)

| Account | Backend `entitlementStatus` | Frontend `getProRuleSet()` | `canUseProFeature` | Billing tab display | Verdict |
|---------|-----------------------------|----------------------------|--------------------|---------------------|---------|
| test1 | `active` | `active` | `true` | "Pro — Current Plan" + Manage button | ✅ PASS |
| test2 | `active` | `active` | `true` | "Pro — Current Plan" + Refresh only (no Manage) | ⚠️ PARTIAL — portal missing |
| test3 | `trial_expired` | `trial_expired` | `false` | "Your free trial has ended." + Subscribe CTA + red top border | ✅ PASS |
| test4 | `active` | `active` | `true` | "Pro — Current Plan" + Refresh only (billing org inaccessible) | ⚠️ PARTIAL |
| test6 WS1 | `trialing` | `trialing` | `true` (trial active) | "Pro (Trial) / 4 days left / Subscribe CTA" | ✅ PASS |
| test6 WS2 | `workspace_limit_reached` | `workspace_limit_reached` | (follows owner's entitlement) | (workspace not shown in UI — not testable) | ⚠️ NOT TESTED |

---

## 5. Bug Report

### P0 — Release Blockers

---

#### BUG-01 · Cross-user billing state contamination on in-tab sign-in

**Severity:** P0
**Section:** G — Two-tab race / cross-tab sync
**Reproduction:**

1. Open Tab A — sign in as test6 (trialing workspace `47b92b47` becomes active org)
2. Open Tab B to the same localhost URL (test6 signed in there too)
3. On Tab A, call `supabase.auth.signInWithPassword({ email:'test1@test.com', password:'test1@test.com' })` without reloading
4. Immediately check `localStorage.getItem('tp3d:active-org-id')` and `window.__TP3D_BILLING.getBillingState()` on Tab A

**Observed:** `tp3d:active-org-id` remains `47b92b47` (test6's org). Billing state still shows `entitlementStatus: "trialing"` and test6's plan info for ~5 seconds.

**Auto-correction mechanism:** When Tab B is reloaded by the tester, a `storage` event fires on Tab A and corrects the active org and billing state. A manual reload of Tab A also corrects it.

**Risk:** During the contamination window the wrong user's entitlement controls AutoPack/PDF gate access and billing UI. A trial user signing into a Pro account would see `trialing` entitlement until the storage event fires or page reloads.

**Console evidence:** No error logged — the bug is silent.

---

### P1 — High Priority (affects paying users in production)

---

#### BUG-02 · `interval: "unknown"` for all Pro accounts

**Severity:** P1
**Section:** B/C — Per-user billing tests
**Accounts affected:** test1 (monthly), test2 (annual), test4 (monthly)

**Observed:** Every Pro account's `/billing-status` response returns `"interval": "unknown"`. The `currentPeriodEnd` field is also `null` for all accounts.

**Impact:** The billing tab cannot display "Monthly" or "Annual" billing cycle. No renewal date shown anywhere in the UI. Users have no way to know when they will be charged next.

**API response excerpt (test1):**
```json
{ "interval": "unknown", "currentPeriodEnd": null, "status": "none" }
```

Note: `status: "none"` is also wrong for active subscribers — raw Stripe status is not being populated.

---

#### BUG-03 · `portalAvailable: false` for test2 and test4

**Severity:** P1
**Section:** I — Billing portal
**Accounts affected:** test2, test4

**Observed:** Both test2 and test4 are active Pro subscribers (`entitlementStatus: "active"`, `isActive: true`) but their `/billing-status` returns `"portalAvailable": false`. As a result, no "Manage" button appears in Settings → Billing for these accounts.

**Test1 comparison:** test1 returns `portalAvailable: true` and "Manage" button renders correctly, navigating to `billing.stripe.com`.

**Suspected cause:** test2 and test4's Stripe customer record or subscription metadata is stored differently (possibly different Stripe product or price ID). The backend logic that determines `portalAvailable` does not recognize their subscription as portal-eligible.

**Impact:** Affected paying subscribers cannot change plan, update payment method, or cancel through the in-app portal.

---

#### BUG-04 · `workspaceCount: 7` inflated for test4

**Severity:** P1
**Section:** D — Multi-workspace owner
**Account:** test4

**Observed:** `/billing-status` for test4's accessible org (`5d86eed4`) returns `workspaceCount: 7` and `ownerEntitlementCandidateCount: 13`. However, only 1 workspace is actually accessible to test4 — all other org IDs in localStorage return `403 Not authorized for this organization billing status`.

**Root cause:** Orphaned `org_member` rows in the database. test4 has rows for 7+ orgs but membership/access has been removed from all but one.

**Impact:** Workspace limit enforcement is wrong for test4. If `workspaceLimit` is 3 and `workspaceCount` reads as 7, the owner would incorrectly appear over-limit.

---

#### BUG-05 · test6's second workspace absent from UI workspace switcher

**Severity:** P1
**Section:** E — Workspace-limit-reached
**Account:** test6

**Observed:** Via the billing-status API, test6 has two valid workspaces:
- `47b92b47` → `entitlementStatus: "trialing"` (the active primary workspace)
- `80a1e0e7` → `entitlementStatus: "workspace_limit_reached"`

Only `47b92b47` appears in the workspace dropdown in the UI. `80a1e0e7` is not shown.

**Root cause (suspected):** The `80a1e0e7` org membership row is present in the DB (billing-status returns data for it) but something in the workspace list query or UI filters it out — possibly an orphaned membership row that passes billing-status auth but fails another query.

**Impact:** Users with a `workspace_limit_reached` workspace cannot switch to it from the UI to investigate or take action.

---

### P2 — Non-blocking (should fix before GA)

---

#### BUG-06 · Billing portal tab takeover instead of new tab

**Severity:** P2
**Section:** I — Billing portal
**Account:** test1

**Observed:** Clicking "Manage" in Settings → Billing navigates the **current tab** to `billing.stripe.com` rather than opening a new tab or popup window. This abandons the app entirely.

**Expected:** The portal should open in a new tab (`window.open(url, '_blank')`) or at minimum warn the user they are leaving the app.

**Reproduction:** test1 → Settings → Billing → click "Manage"

---

#### BUG-07 · Sidebar billing element retains stale cross-user content after sign-in

**Severity:** P2
**Section:** K — Security / DOM hygiene

**Observed:** After signing in as test1 or test2, the `#tp3d-sidebar-upgrade` DOM element still contains test6's trial text ("📦 Subscribe — Your free trial ends in 4 days — Upgrade Plan"). The element's own `display` is `flex` but its parent wrapper (`#upgradeCardWrap`, `.tp3d-sidebar-upgrade-wrap`) has `display:none`.

**Visually safe:** Bounding rect is `{0, 0, 0, 0}` — the element is not rendered on screen.

**Risk:** If the parent wrapper's visibility logic has any regression bug, stale cross-user billing messaging could appear on screen for the wrong user. The innerHTML should be cleared on user switch.

**Console verification:**
```js
document.getElementById('tp3d-sidebar-upgrade').textContent
// → "📦SubscribeYour free trial ends in 4 daysUpgrade Plan"  (while test1 Pro is active)
```

---

#### BUG-08 · `status: "none"` in API response for active Pro subscribers

**Severity:** P2
**Section:** B/C
**Accounts:** test1, test2

**Observed:** `/billing-status` returns `"status": "none"` for confirmed active Pro subscribers. The `entitlementStatus: "active"` normalized field is correct, but the raw `status` field is wrong.

**Risk:** Any frontend code that reads `status` instead of `entitlementStatus` will misidentify these users as having no subscription.

---

### P3 — Low priority / informational

---

#### BUG-09 · Sidebar trial/upgrade banner absent for trial_expired users on Packs screen

**Severity:** P3
**Section:** C / J — UX copy
**Account:** test3

**Observed:** test3 has `entitlementStatus: trial_expired`. The red top-of-viewport border and the Settings Billing tab correctly reflect this state. However, the `#tp3d-sidebar-upgrade` inner element is empty — no upgrade prompt or trial-expired banner appears on the Packs screen sidebar.

**Impact:** Missed re-engagement CTA opportunity for trial-expired users. They see the correct error state in Settings but no in-app nudge while browsing Packs.

---

#### BUG-10 · test5 account does not exist

**Severity:** P3 / Informational

Credentials `test5@test.com` / `test5@test.com` return "Invalid login credentials". The free/no-subscription account flow could not be tested. A test account for this state should be created.

---

## 6. Console & Network Findings

### test1 (normal active Pro flow)
- No JS errors in console during normal navigation
- `/billing-status` returns HTTP 200 with correct entitlement
- Stripe portal redirect HTTP 200

### test4 (multi-workspace, orphan data)
- Multiple `403` errors appear in the network tab as the frontend attempts to fetch billing-status for orphaned org IDs stored in localStorage
- These 403s are silent in the UI (no user-facing error shown) — acceptable behavior, but the orphan org IDs should not be in localStorage at all
- Pattern: `billing-status?organization_id=<orphanOrgId>` → `{"error":"Not authorized for this organization billing status"}`

### Cross-tab (G)
- Storage events fire correctly across tabs for logout propagation — confirmed working
- Storage events also auto-correct stale active-org after Tab B reload — this is the auto-recovery mechanism for BUG-01

### General
- No requests to external analytics, telemetry, or ad services observed
- Anon key present in DOM as expected for a Supabase SPA (not a security issue)
- No service role key or user JWT exposed in DOM or localStorage

---

## 7. Race Condition Findings

### G1 — In-tab sign-in contamination (P0, documented as BUG-01 above)

| Step | Timing | Observed state |
|------|--------|----------------|
| test6 signed in on Tab A | t=0 | active-org = `47b92b47`, billing = trialing |
| `signInWithPassword(test1)` called | t=1 | Supabase auth updates immediately |
| Billing/org state on Tab A | t=1 to t+5 s | Still shows test6's org and trialing entitlement |
| Tab B reloaded by tester | t+5 s | Storage event corrects Tab A automatically |
| Tab A after correction | t+5 s | Correct test1 org and `active` entitlement |

**Window of incorrect state:** approximately 5 seconds in observed test. May be longer on slow connections.

### G2 — Logout propagation (PASS)

Sign-out on Tab A correctly propagates to Tab B via storage events. Tab B shows the logged-out state within ~1 second. No stale session observed post-logout.

### H — Rapid settings tab switching (PASS)

Rapidly switching between General / Members / Billing tabs in Settings produced skeleton loader flashes but all tabs settled to correct content within ~500 ms. No stuck spinners, duplicate event handlers, or stale data observed.

---

## 8. Security Findings (K)

| Check | Result | Notes |
|-------|--------|-------|
| Service role key in DOM | ✅ PASS — not found | No `service_role` key visible anywhere |
| Service role key in localStorage | ✅ PASS — not found | Only `sb-*-auth-token` and `tp3d:*` keys present |
| Anon key in DOM | ✅ Acceptable | Expected for Supabase SPA; not a secret |
| User JWT in DOM | ✅ PASS — not found | JWT only in `sb-*-auth-token` localStorage key |
| Cross-user org access via API | ✅ PASS — correctly blocked | test2 requesting test1's org `010bda14` → `403 Not authorized` |
| Stale sidebar cross-user content | ⚠️ DOM hygiene bug | Visually hidden (parent `display:none`), but innerHTML contains wrong user's data (BUG-07) |
| Non-owner member billing CTA visibility | ⚠️ UNTESTED | `canManageBilling: false` correctly returned for test6's WS2 (non-owner workspace). No cross-workspace member account available to test the actual UI rendering of `canManageBilling: false` state |
| AutoPack gating for expired trial | ✅ PASS | test3 `canUseProFeature: false`, AutoPack blocked |
| AutoPack gating for active Pro | ✅ PASS | test1 `canUseProFeature: true`, AutoPack accessible |

---

## 9. UX / Copy Findings (J)

### test1 — Active Pro (monthly)
- Settings → Billing shows: **"Pro — Current Plan"** badge + **"Manage"** button + **"Refresh"** button
- Missing: billing interval ("Monthly"), next renewal date
- "Manage" navigates current tab to Stripe portal (BUG-06 — should open new tab)
- No billing banner in sidebar (correct — Pro active users should not see an upgrade prompt)

### test2 — Active Pro (annual)
- Settings → Billing shows: **"Pro — Current Plan"** badge + **"Refresh"** button only
- Missing: billing interval ("Annual"), next renewal date, **"Manage" button entirely absent** (BUG-03)
- No billing banner in sidebar (correct — but stale test6 HTML is in DOM, BUG-07)

### test3 — Trial expired
- Settings → Billing shows: **"Your free trial has ended."** heading + **"Subscribe"** CTA button
- Red bar appears at top of viewport (trial-expired visual indicator) ✅
- Billing tab copy is appropriate and clear
- Sidebar: no upgrade/trial-expired banner on Packs screen (BUG-09 — missed CTA opportunity)

### test6 WS1 — Active trial
- Settings → Billing shows: **"Pro (Trial)"** with badge + **days remaining** + **"Subscribe"** CTA ✅
- Trial days countdown is accurate
- Sidebar: (stale test1 content hidden; correct trial content not rendered — same DOM hygiene pattern)

### test4 — Active Pro, broken portal
- Settings → Billing shows: **"Pro — Current Plan"** + **"Refresh"** only
- No "Manage" button (BUG-03)
- No interval, no renewal date (BUG-02)

### General copy observations
- "Manage billing and subscription details." — subtitle on Billing tab (accurate)
- "Refresh" button present on all billing states — useful but unlabeled as to what it refreshes
- No "You manage billing for this workspace" / "Billing is managed by the workspace owner" distinction surfaced yet — this copy distinction is needed for when non-owner member billing tab is implemented

---

## 10. Coverage Gaps & Untested Areas

| Area | Status | Reason |
|------|--------|--------|
| Free/no-subscription account (test5) | ❌ Not tested | Account does not exist |
| Non-owner member billing tab UI | ⚠️ Partially untested | No cross-workspace member account among test accounts; `canManageBilling: false` confirmed in API for test6 WS2 |
| test6 WS2 billing tab | ❌ Not tested | Workspace not accessible from UI switcher (BUG-05) |
| test4 workspace switching | ❌ Not tested | Only 1 workspace accessible; others return 403 |
| AutoPack actual feature execution | ⚠️ Partial | Gate logic confirmed; full AutoPack run not exercised |
| PDF export gate | ⚠️ Partial | Gate logic confirmed via `canUseProFeature`; actual export not triggered |
| Invitation flow | ❌ Not in scope | Deferred |
| Stripe webhook handling | ❌ Not in scope | Deferred |
| Mobile / responsive billing UI | ❌ Not in scope | Deferred |

---

## 11. Recommended Fix Priority

| Priority | Bug | Estimated blast radius |
|----------|-----|----------------------|
| P0 | BUG-01 — Cross-user billing contamination on in-tab sign-in | All users who sign in without reload |
| P1 | BUG-02 — `interval` + `currentPeriodEnd` null for all accounts | All Pro users; billing UI incomplete |
| P1 | BUG-03 — `portalAvailable: false` for test2/test4 | Subset of Pro users; portal inaccessible |
| P1 | BUG-04 — `workspaceCount` inflated by orphan rows (test4) | Accounts with orphan membership data |
| P1 | BUG-05 — Workspace-limit-reached workspace missing from UI | test6 pattern; any owner with a 2nd workspace at limit |
| P2 | BUG-06 — Portal opens in same tab | All users who click Manage |
| P2 | BUG-07 — Stale cross-user sidebar HTML | DOM hygiene; all cross-user sign-in flows |
| P2 | BUG-08 — `status: "none"` for active subscribers | Any code reading raw `status` field |
| P3 | BUG-09 — No sidebar trial-expired CTA | Expired trial users on Packs screen |
| P3 | BUG-10 — test5 missing | Test coverage gap |

---

*Report generated by Claude QA agent — read-only testing, no mutations made to code, database, or Stripe.*
