# Truck Packer 3D — Billing Entitlement Rules
Last updated: 2026-05-03
Status: Approved internal checkpoint

This document defines the billing model Truck Packer 3D must follow going forward.
It is the product and engineering rule sheet for billing, workspace access, feature gates, and UI behavior.

---

## 1. Purpose

Truck Packer 3D is moving from a mixed per-workspace billing behavior to a clear owner-account billing model with workspace limits.

This document exists so that:
- backend billing logic stays consistent
- frontend gates stay consistent
- UI copy stays consistent
- future AI/code agents do not reintroduce per-workspace billing behavior by mistake

If this document conflicts with older notes, this document wins.

---

## 2. Core billing model

### 2.1 Billing owner
- Billing belongs to the **workspace owner account**, not to individual members.
- Members never pay separately.
- Admins do not pay separately.
- Only the owner can start checkout, open portal, change plan, or fix payment.

### 2.2 Workspace coverage
- A paid owner account can cover multiple workspaces.
- Coverage depends on the owner’s current plan and its workspace limit.
- A workspace is either:
  - directly billed / active
  - included in the owner plan
  - over the owner’s workspace limit
  - trialing
  - expired
  - owner-subscription-required
  - billing-unavailable

### 2.3 Source of truth
- Stripe remains the payment truth.
- `/billing-status` is the app entitlement truth.
- Frontend UI and feature gates must trust `/billing-status`.
- The frontend must not guess entitlement from local assumptions.

---

## 3. Billing states

There are two different concepts and they must stay separate.

### 3.1 Raw billing status
This is the payment/subscription state coming from Stripe or billing projection logic.
Examples:
- `active`
- `trialing`
- `past_due`
- `unpaid`
- `canceled`
- `incomplete`
- `incomplete_expired`
- `paused`
- `none`

These are payment facts.

### 3.2 Entitlement status
This is the app access decision.
Allowed values:
- `active`
- `trialing`
- `trial_expired`
- `included_in_plan`
- `workspace_limit_reached`
- `owner_subscription_required`
- `billing_unavailable`

These are product/runtime states.

### 3.3 Rule
- Do **not** overload raw `status` with entitlement states.
- Keep raw billing/payment `status` intact.
- Use a separate field such as `entitlementStatus` for app access decisions.

---

## 4. Approved runtime meanings

| Entitlement status | Meaning | Pro access |
|---|---|---|
| `active` | This workspace is directly covered by an active paid owner plan | Yes |
| `trialing` | Trial is active | Yes |
| `trial_expired` | Trial ended and no paid coverage exists | No |
| `included_in_plan` | Workspace is covered by the owner’s paid plan within workspace limit | Yes |
| `workspace_limit_reached` | Owner is paid, but this workspace exceeds the plan limit | No |
| `owner_subscription_required` | Owner does not have active paid or trial coverage for this workspace | No |
| `billing_unavailable` | Backend cannot safely determine state right now | No gated decisions should be made blindly |

---

## 5. Owner and member rules

### 5.1 Owner rules
Owner can:
- start subscription
- open billing portal
- change subscription
- fix payment
- upgrade to more workspace capacity

Owner sees:
- full billing status
- upgrade/fix-payment actions
- workspace-limit messages
- included-in-plan messages

### 5.2 Admin rules
Admin:
- can use workspace features according to the workspace entitlement
- cannot manage billing
- cannot start checkout
- cannot open billing portal

### 5.3 Member rules
Member:
- can use workspace features according to the workspace entitlement
- cannot manage billing
- cannot pay separately
- must see owner-action-required messaging when blocked

---

## 6. Plan structure for launch

Approved direction for launch planning:

| Plan | Billing | Included workspaces | Suggested direction |
|---|---:|---:|---|
| Free | $0 | 1 | limited features |
| Trial | $0 for a short period | 1 | full Pro during trial, capped |
| Pro | paid | small included workspace count | full Pro features |
| Business / Team | paid | higher included workspace count | full Pro features + higher limits |
| Enterprise | custom | custom | custom onboarding / support |

### 6.1 Current business decision
Use **owner-account billing with workspace limits**.

### 6.2 Workspace limit rule
- When the owner is within the plan limit, extra included workspaces must resolve as `included_in_plan`.
- When the owner exceeds the plan limit, the extra workspace must resolve as `workspace_limit_reached`.

### 6.3 Members/seats
Members inherit workspace entitlement.
Seat limits can be layered later, but they are not the first billing migration priority.

---

## 7. Feature gating rules

### 7.1 Pro features
The following are currently treated as Pro-sensitive and must follow entitlement rules:
- AutoPack
- PDF export

Additional gated features can be added later, but the entitlement decision must stay centralized.

### 7.2 Access rules
- `active` → allow Pro features
- `trialing` → allow Pro features
- `included_in_plan` → allow Pro features
- `trial_expired` → block Pro features
- `workspace_limit_reached` → block Pro features
- `owner_subscription_required` → block Pro features
- `billing_unavailable` → show safe recovery UI and retry path; do not silently guess access

### 7.3 Block messaging
#### Owner blocked messages
- `trial_expired`: prompt owner to subscribe
- `workspace_limit_reached`: prompt owner to upgrade plan or free a workspace slot
- `owner_subscription_required`: prompt owner to start subscription
- `billing_unavailable`: show retry / temporary unavailable state

#### Member blocked messages
- `trial_expired`: “Ask the workspace owner to upgrade to continue.”
- `workspace_limit_reached`: “This workspace is not included in the owner’s current plan. Ask the owner to upgrade.”
- `owner_subscription_required`: “This workspace owner needs to start or restore a subscription.”
- `billing_unavailable`: show neutral temporary unavailable state

---

## 8. Workspace behavior rules

### 8.1 Creating workspaces
Creating a workspace must:
- create an organization row
- add creator as owner
- switch active org cleanly
- hydrate billing for the new active workspace

### 8.2 Extra workspaces beyond plan limit
Do not delete them.
Do not reset or fake a new trial.
Do not show stale billing from another workspace.

Allowed behavior:
- owner can still switch into the workspace
- billing/settings can still be viewed
- workspace can still exist in the account
- Pro-only actions are blocked until coverage is restored

### 8.3 Switching workspaces
When a workspace switch happens:
- active org and billing org must reconcile quickly
- stale previous-workspace billing must not remain “healthy” for the wrong workspace
- settings billing/members UI must not leak previous-workspace state
- packs/cases/editor transient UI must reset correctly

---

## 9. Trial rules

### 9.1 Trial ownership
Trial behavior must follow the approved product rule for launch.
Current direction:
- first workspace may receive the trial
- repeat workspace trial abuse must not happen

### 9.2 Trial expiration
When trial ends:
- entitlement becomes `trial_expired`
- Pro-only actions must block
- owner sees billing CTA
- member sees owner-action-required messaging

### 9.3 Important rule
A later paid owner plan must not be broken by old workspace-level trial leftovers.
Entitlement resolution must prefer the current owner-account rule set.

---

## 10. Backend contract requirements

`/billing-status` must stay backward-safe while becoming owner-entitlement aware.

### 10.1 Existing fields to preserve
Keep current fields such as:
- `ok`
- `orgId`
- `plan`
- `status`
- `isActive`
- `isPro`
- `trialEndsAt`
- `currentPeriodEnd`
- `cancelAtPeriodEnd`
- `cancelAt`
- `portalAvailable`
- `paymentProblem`
- `paymentGraceUntil`
- `paymentGraceRemainingDays`
- `action`
- `error`

### 10.2 New additive fields
Additive fields should include:
- `billingOwnerUserId`
- `entitlementStatus`
- `workspaceIncluded`
- `workspaceCount`
- `workspaceLimit`
- `canManageBilling`

### 10.3 Resolution order
Backend entitlement logic must resolve in this order:
1. active workspace
2. active workspace owner
3. owner billing subject / active paid plan
4. workspace count against plan limit
5. normalized entitlement status

---

## 11. Frontend contract requirements

### 11.1 Gates
Frontend gates must read normalized entitlement from billing truth.
They must not assume:
- one subscription per workspace forever
- owner payment only applies to the currently billed workspace
- a free-looking workspace row means the owner has no paid plan

### 11.2 UI copy
Settings Billing and other UI must present:
- included in plan
- workspace limit reached
- owner subscription required
- trial active
- trial expired
- billing unavailable

### 11.3 Safety rule
Do not change wording only.
Do not patch UI around the wrong entitlement model.
Backend truth must change first, then gates, then UI copy.

---

## 12. Stripe / webhook / checkout guardrails

For the first entitlement migration pass:
- do not redesign checkout flow broadly
- do not redesign portal flow broadly
- do not redesign webhook architecture broadly
- do not delete org-scoped projection rows yet
- do not break existing stale-subscription fallbacks

The first pass should be additive and controlled.

---

## 13. What AI/code agents must not do

Do not:
- reintroduce pure per-workspace billing semantics as the final truth
- replace `status` with synthetic entitlement values
- gate owner inheritance only when `ownerUserId !== currentUserId`
- implement UI-only fixes before backend truth
- add broad refactors in the same pass as entitlement changes
- break existing workspace switching fixes while touching billing

---

## 14. Minimum manual verification after implementation

1. Paid owner, primary workspace → `active`
2. Paid owner, included extra workspace → `included_in_plan`
3. Paid owner, over-limit workspace → `workspace_limit_reached`
4. Free owner → blocked correctly
5. Trial owner → trial works correctly
6. Trial expired owner → blocked correctly
7. Member in paid workspace → inherits correct access
8. Member in over-limit workspace → blocked with owner-action messaging
9. Workspace switching between included and non-included workspaces → no stale entitlement leakage
10. AutoPack and PDF gates follow entitlement state correctly

---

## 15. Launch checkpoint summary

At launch, Truck Packer 3D should behave like this:
- one owner account pays
- multiple workspaces can be covered by that owner
- workspace count is limited by plan
- members inherit access from the owner/workspace entitlement
- Pro-only features are gated by normalized entitlement
- switching workspaces does not leave stale billing or UI state behind

If implementation disagrees with this document, implementation must be corrected.
