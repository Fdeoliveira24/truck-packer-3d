# CLAUDE.md
Last updated: 2026-05-03
Project: Truck Packer 3D

This file is the working instruction sheet for AI coding assistants used on this repo.
It is meant to reduce regressions, keep changes small, and keep the app aligned with the current product and billing direction.

---

## 1. Project summary

Truck Packer 3D is a static browser app for 3D load planning.
It uses:
- Three.js editor/runtime
- local scoped state and local storage
- Supabase for auth, orgs, invites, storage, and Edge Functions
- Stripe for subscription billing

Primary product concepts:
- users
- organizations / workspaces
- owner / admin / member roles
- packs / cases
- billing / trials / paid plans
- AutoPack and PDF export as important gated features

---

## 2. Current business model decision

### Locked direction
Truck Packer 3D is moving to:
- **owner-account billing**
- **workspace limits by plan**
- **members never pay separately**

That means:
- one paid owner can cover multiple workspaces
- workspaces can be included in plan or over limit
- frontend gates must use normalized entitlement, not raw per-workspace payment rows only

Read and follow:
- `docs/product/TP3D-MASTER-TODO-V3.md`
- `docs/product/BILLING_ENTITLEMENT_RULES.md`

If older notes conflict with those documents, the newer docs win.

---

## 3. Non-negotiable rules

1. **Keep changes surgical.**
   Do not broaden scope without a clear reason.

2. **No refactor mixed with behavior changes** unless a bug fix truly requires it.

3. **No new files unless explicitly requested** or clearly necessary for a contained feature.

4. **Do not rewrite working architecture just because it is large.**
   Stabilize first. Clean up later.

5. **Do not change billing semantics in UI first.**
   Backend truth must lead.

6. **Do not guess from local state when `/billing-status` is available.**
   Billing truth comes from the backend response.

7. **Preserve workspace switch safety.**
   No stale org, stale billing, stale member, stale invite, stale editor, or stale preview leakage.

8. **Treat auth, billing, org switching, cross-tab state, and storage scope as P0 risk.**

9. **Do not break owner-only money actions.**
   Owners only for checkout, portal, plan changes, payment fixes.

10. **Do not remove existing safety guards** unless a proven bug requires replacement.

---

## 4. Editing style rules

When changing code:
- prefer the smallest safe diff
- reuse existing helpers and patterns
- avoid moving code unless necessary
- avoid renaming public/runtime functions unless required
- keep logging minimal and safe
- avoid introducing more inline styles or new ad-hoc UI patterns

When touching UI:
- preserve current styling patterns
- preserve dark-mode behavior
- preserve modal and overlay patterns already in use
- do not add flashy temporary UI instead of fixing the real bug

---

## 5. Billing rules AI must follow

### 5.1 Stripe and billing truth
- Stripe is the billing/payment truth.
- `/billing-status` is the app entitlement truth.
- `billing_customers` is a projection, not the only truth.

### 5.2 Separate raw payment status from entitlement
Do not overload raw `status` with synthetic values.
Use additive normalized fields such as:
- `entitlementStatus`
- `workspaceIncluded`
- `workspaceCount`
- `workspaceLimit`
- `billingOwnerUserId`
- `canManageBilling`

### 5.3 Required entitlement states
Allowed normalized entitlement states:
- `active`
- `trialing`
- `trial_expired`
- `included_in_plan`
- `workspace_limit_reached`
- `owner_subscription_required`
- `billing_unavailable`

### 5.4 Owner inheritance rule
Do **not** gate owner inheritance on `ownerUserId !== currentUserId`.
The owner’s own second or third workspace is exactly the case that must inherit plan coverage when within limit.

### 5.5 Frontend gating rule
Frontend feature gates must use normalized entitlement status, not only raw workspace payment rows.

---

## 6. Workspace switching rules AI must follow

Workspace switching is sensitive.
Any change in this area must preserve all of the following:
- active org updates correctly
- billing org and active org reconcile correctly
- settings overlay updates to the correct org
- billing tab does not keep stale previous-org state
- members/invites do not show stale previous-org data
- packs/cases transient UI state resets safely
- editor scene / preview capture does not leak into another workspace
- cross-tab sync remains safe

If a change touches workspace switching, mention exact verification steps.

---

## 7. Auth and cross-tab rules AI must follow

- user-scoped storage must stay isolated per signed-in user
- logout must use canonical helper behavior
- no timed reload right after signOut
- transient signed-out wobble must not wipe org state incorrectly
- cross-tab org sync must remain guarded by user and freshness
- cross-tab billing sync must not apply wrong-org snapshots

Do not remove auth/billing guards casually.

---

## 8. Current release priorities

In order:
1. finish workspace switching correctness and live verification
2. implement billing entitlement backend truth for owner-account billing with workspace limits
3. update frontend gates to use normalized entitlement
4. update Settings Billing copy/UI to match entitlement truth
5. finish runtime safety/error states
6. then move to invitations, AutoPack correctness, and product expansion
7. then do larger modularization work

Do not jump ahead into cleanup/refactor while P0 behavior is unfinished.

---

## 9. What not to change in the first entitlement pass

Do not broadly rewrite:
- Stripe checkout architecture
- Stripe portal architecture
- Stripe webhook architecture
- workspace creation flow
- org switching order
- Supabase schema unless a minimal additive change is required
- local storage model unless the bug clearly requires it

For the first pass, backend entitlement logic should be additive and controlled.

---

## 10. Expected implementation order for billing entitlement work

When implementing owner-account billing with workspace limits, follow this order:

1. backend `/billing-status`
   - resolve active org
   - resolve workspace owner
   - resolve owner billing truth
   - count owner workspaces vs plan limit
   - return normalized entitlement fields

2. frontend `src/app.js`
   - store new fields in billing state
   - update `getProRuleSet()`
   - update AutoPack/PDF gating
   - update sidebar billing notice behavior

3. settings billing UI
   - update wording and CTA logic only after backend + app gates are correct

Do not start with UI wording only.

---

## 11. Testing expectations

For any meaningful fix, always include:
- exact files changed
- why each change is needed
- risk level
- lint/test results if available
- manual verification checklist

For billing/workspace changes, manual checks should usually include:
- owner with 1 workspace
- owner with multiple workspaces
- non-owner member
- same-tab workspace switch
- cross-tab workspace switch if relevant
- AutoPack gate
- PDF export gate
- Settings Billing tab
- Settings Members tab if org scoping was touched

---

## 12. Safe communication pattern for AI work

When proposing changes:
- state what is confirmed
- separate confirmed causes from guesses
- do not patch UI to hide an unfixed data bug
- do not claim launch readiness if entitlement/workspace rules are still unresolved

When asked to implement:
- stay inside the approved scope
- do not sneak in unrelated cleanup
- mention any out-of-scope change clearly if one was truly necessary

---

## 13. Repo-specific cautions

- `src/app.js` is large and sensitive. Avoid broad edits without need.
- `src/ui/overlays/settings-overlay.js` is also sensitive and full of org-scoped rendering/state.
- `src/core/storage.js` and auth/billing helpers are P0-risk areas.
- This app is shipped as static assets. There is no required build step for normal release validation.

Typical validation commands:
- `npm test`
- `npm run lint`
- `npm run -s typecheck` when relevant
- optional stress/UI checks when already part of repo workflow

---

## 14. Final instruction

When in doubt:
- choose the smaller safe change
- preserve current working behavior
- favor backend truth over UI guesswork
- favor launch stability over elegance
- document follow-up work instead of widening the patch
