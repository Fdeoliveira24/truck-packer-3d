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

---

## 15. graphify — Knowledge Graph Navigation

This project has a pre-built knowledge graph in `graphify-out/`.

### Context Navigation
When you need to understand the codebase, docs, or any files in this project:
1. ALWAYS query the knowledge graph first: `/graphify query "your question"`
2. Only read raw files if I explicitly say "read the file" or "look at the raw file"
3. Use `graphify-out/wiki/index.md` as your navigation entrypoint for browsing structured community summaries

### Quick reference
- `graphify-out/wiki/index.md` — community index (start here for browsing)
- `graphify-out/GRAPH_REPORT.md` — full audit report (god nodes, surprising connections)
- `graphify-out/graph.json` — raw graph data for queries
- `graphify-out/graph.html` — interactive visualization (open in browser)

### Key graph facts (as of 2026-05-12)
- **5,773 nodes · 12,250 edges · 230 communities**
- God nodes: `js()` (444 edges), `copy()` (189), `Vector3` (77)
- Key communities: `Core App Runtime`, `Supabase Client & Auth`, `Security & Invariant Specs`
- Run `/graphify --update` after significant code changes to keep the graph current

# CLAUDE.md — Truck Packer 3D (TP3D) Agent Operating Guide

**Last updated:** 2026-06-25

This file is the working instruction sheet for AI coding assistants used on this repo. It is meant to reduce regressions, keep changes small, and keep the app aligned with the current product direction.

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

## 2. Current source of truth

Read and follow:

- `docs/product/TP3D-MASTER-TODO-V4.md`
- `docs/product/BILLING_ENTITLEMENT_RULES.md`

If older notes conflict with those documents, the newer docs win.

Current stable source:

- `main` / `origin/main`: `e9c86c0`

Latest local AutoPack candidate stack, unless already merged separately:

- E1 stack/layer quality: `b1be932`
- E2A floor/lane/filler quality: `ee566add`
- E2B Wheel Wells channel block + contiguous filler stack-follow: `fa4f9c7`
- Large-load snap performance safety: `05f56f4`
- Operation lifecycle UX base: `1519140`
- Pending amendment target: direct editor mutation guards and pending-truck config rendering before merge

Current active work is AutoPack quality, performance, and operation lifecycle. Billing/auth/workspace/Supabase remain high-risk P0 areas, but they are not the active phase unless the user explicitly changes scope.

Do not start Wheel Wells bridge support, Front Overhang wall-building, manual vertical placement, organized Unpack, Web Worker/chunking, or InstancedMesh/LOD until the current AutoPack quality/performance/operation lifecycle stack is validated and merged.

---

## 3. Non-negotiable rules

1. **Keep changes surgical.** Do not broaden scope without a clear reason.
2. **No refactor mixed with behavior changes** unless a bug fix truly requires it.
3. **No new files unless explicitly requested** or clearly necessary for a contained feature.
4. **Do not rewrite working architecture just because it is large.** Stabilize first. Clean up later.
5. **Do not change billing semantics in UI first.** Backend truth must lead.
6. **Do not guess from local state when `/billing-status` is available.** Billing truth comes from the backend response.
7. **Preserve workspace switch safety.** No stale org, stale billing, stale member, stale invite, stale editor, or stale preview leakage.
8. **Treat auth, billing, org switching, cross-tab state, and storage scope as P0 risk.**
9. **Do not break owner-only money actions.** Owners only for checkout, portal, plan changes, payment fixes.
10. **Do not remove existing safety guards** unless a proven bug requires replacement.
11. **Do not make broad AutoPack solver changes while the operation lifecycle stack is still unmerged.**
12. **Do not hide data/state bugs with UI polish.** Fix the lifecycle or source-of-truth issue first.

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
- show clear working states when long operations run
- keep copy professional and tied to the actual operation result

---

## 5. Current AutoPack phase cautions

E1/E2A/E2B and the large-load snap fix are useful progress, but do not merge an operation lifecycle branch unless direct editor mutations are also guarded.

Important current facts:

- Large-load snap threshold is `> 300` packed placements.
- Large-load snap is a performance safety foundation, not a final solver performance solution.
- The solver can still block the main thread on 800–1200+ cases.
- Web Worker/chunking and InstancedMesh/LOD are later architecture phases.
- Current Wheel Wells behavior: wheel-well shelves support cases that fit the shelf; wider cases need a future explicit bridge/support contract.
- Current Front Overhang behavior: C2 safely requires rear retention before loading the raised deck; a future strategy must build the retaining wall first.

Do not implement Wheel Wells bridge/spanning support or Front Overhang wall-building until the lifecycle stack is merged.

---

## 6. Operation lifecycle guard rails

AutoPack, Unpack, Truck Change, preview capture, and animation are mutually disruptive editor operations. A visual spinner is not enough; the code must prevent stale or overlapping mutations.

Rules:

- Use one authoritative operation lifecycle/lock for mutating editor operations.
- Guard all mutating paths, not only toolbar buttons.
- Mutating paths include AutoPack, Unpack, Update Truck, truck preset/mode/shape/config changes, drag, rotate, nudge, delete, add, duplicate, paste, keyboard shortcuts, export/share if state can be unstable, and preview capture.
- InteractionManager and global shortcuts must respect the operation lifecycle lock.
- Drag, rotate, nudge, delete, duplicate, paste, and add-case actions cannot mutate while AutoPack, Unpack, Truck Change, or preview capture is active.
- Do not block camera orbit/pan/zoom or read-only inspection unless a specific bug requires it.
- A stale operation token must not be able to finish or overwrite a newer operation.
- Large-load AutoPack may snap to final layout for performance, but final saved state must never depend on animation completion.
- During synchronous solver work, true cancel is not available without later architecture work. Do not fake live progress or cancel behavior that the code cannot safely honor.

---

## 7. Pending truck vs committed truck

Truck edit form state and committed scene state are separate.

Rules:

- Changing truck preset/mode/shape/config should update pending form state only.
- Do not open the Truck Change preview modal until the user explicitly clicks **Update truck**.
- Pending config controls should render for the pending truck type. Example: selecting Wheel Wells should show Wheel Wells settings in the form before commit.
- The 3D scene should keep showing the committed truck until Update Truck is confirmed.
- Cancel/X/Escape from the Truck Change preview must restore the committed truck, scene, and form state.

---

## 8. Billing rules AI must follow

### 8.1 Stripe and billing truth

- Stripe is the billing/payment truth.
- `/billing-status` is the app entitlement truth.
- `billing_customers` is a projection, not the only truth.

### 8.2 Separate raw payment status from entitlement

Do not overload raw `status` with synthetic values.
Use additive normalized fields such as:

- `entitlementStatus`
- `workspaceIncluded`
- `workspaceCount`
- `workspaceLimit`
- `billingOwnerUserId`
- `canManageBilling`

### 8.3 Required entitlement states

Allowed normalized entitlement states:

- `active`
- `trialing`
- `trial_expired`
- `included_in_plan`
- `workspace_limit_reached`
- `owner_subscription_required`
- `billing_unavailable`

### 8.4 Owner inheritance rule

Do **not** gate owner inheritance on `ownerUserId !== currentUserId`.
The owner’s own second or third workspace is exactly the case that must inherit plan coverage when within limit.

### 8.5 Frontend gating rule

Frontend feature gates must use normalized entitlement status, not only raw workspace payment rows.

---

## 9. Workspace switching rules AI must follow

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

## 10. Auth and cross-tab rules AI must follow

- user-scoped storage must stay isolated per signed-in user
- logout must use canonical helper behavior
- no timed reload right after signOut
- transient signed-out wobble must not wipe org state incorrectly
- cross-tab org sync must remain guarded by user and freshness
- cross-tab billing sync must not apply wrong-org snapshots

Do not remove auth/billing guards casually.

---

## 11. Current release priorities

Current priority order:

1. Validate and amend operation lifecycle UX/concurrency control.
2. Merge the AutoPack quality/performance/operation lifecycle stack only after direct editor mutations are guarded.
3. Wheel-well bridge/spanning support.
4. Front Overhang wall-building strategy.
5. Manual vertical placement / snap-on-top.
6. Organized Unpack layout.
7. Larger architecture work such as Web Worker/chunking and InstancedMesh/LOD.
8. Return to billing/workspace/Supabase work only when explicitly scoped by the user.

Do not jump ahead into cleanup/refactor while active behavior is unfinished.

---

## 12. Expected implementation order for billing entitlement work

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

## 13. File structure and ownership

Common areas:

- `src/app.js`  
  Main app wiring, workspace/session lifecycle, top-level runtime glue, keyboard shortcuts.

- `src/screens/editor-screen.js`  
  Editor UI, case interactions, AutoPack/Unpack/Truck controls, scene rendering integration.

- `src/services/autopack-engine.js`  
  AutoPack orchestration, staging, persistence, animation/snap path.

- `src/services/autopack-solver.js`  
  Solver geometry, scoring, placement generation, hard-rule placement logic.

- `src/ui/truck-change-controller.js`  
  Truck-change preview, reconciliation, confirm/cancel flow.

- `src/core/operation-lifecycle.js`  
  Single-operation lifecycle guard for mutating editor workflows. Use it to prevent overlapping AutoPack, Unpack, Truck Change, preview capture, and direct editor mutations.

- `src/core/*`  
  State store, session, storage, events, defaults.

- `src/ui/overlays/settings-overlay.js`  
  Settings UI, billing UI, org/members/invites rendering.

When changing behavior, prefer editing the owner layer:

- UI bug → overlay module, editor-screen, or app wiring
- Auth/session bug → `supabase-client.js`
- State bug → state-store or normalizer
- AutoPack/Unpack/Truck Change lifecycle bug → operation-lifecycle, editor-screen, autopack-engine, truck-change-controller, and app wiring only
- Solver geometry/packing-quality bug → autopack-solver/autopack-engine only after operation lifecycle work is validated and merged

---

## 14. Testing expectations

For any meaningful fix, always include:

- exact files changed
- why each change is needed
- risk level
- lint/test results if available
- manual verification checklist

Typical validation commands:

- `npm test`
- `npm run lint`
- `npm run -s typecheck` when relevant
- `git diff --check`
- `git diff --cached --check`
- optional stress/UI checks when already part of repo workflow

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

For current AutoPack operation lifecycle work, manual checks should usually include:

- AutoPack 1200 shows controlled working state and does not allow conflicting operations
- Unpack 1200 shows controlled working state and does not allow conflicting operations
- truck preset/shape change does not open preview immediately
- Update Truck opens preview only on explicit click
- Cancel from Truck Change preview restores committed scene/form
- drag/rotate/nudge/delete/duplicate/paste/add are blocked while busy
- camera orbit/pan/zoom remains usable where safe

---

## 15. Safe communication pattern for AI work

When proposing changes:

- state what is confirmed
- separate confirmed causes from guesses
- do not patch UI to hide an unfixed data bug
- do not claim launch readiness if entitlement/workspace/operation lifecycle rules are still unresolved

When asked to implement:

- stay inside the approved scope
- do not sneak in unrelated cleanup
- mention any out-of-scope change clearly if one was truly necessary

---

## 16. Repo-specific cautions

- `src/app.js` is large and sensitive. Avoid broad edits without need.
- `src/screens/editor-screen.js` is large and sensitive. Guard direct editor mutations carefully.
- `src/ui/overlays/settings-overlay.js` is sensitive and full of org-scoped rendering/state.
- `src/core/storage.js` and auth/billing helpers are P0-risk areas.
- `src/core/operation-lifecycle.js` should stay small and pure.
- This app is shipped as static assets. There is no required build step for normal release validation.

---

## 17. Core principles

1. Fix root causes.
2. Keep changes small.
3. Guard async code against races.
4. Respect offline and hidden tab conditions.
5. Avoid duplicate listeners and duplicate network calls.
6. Never leak secrets into logs.
7. Prefer simple code that the next person can follow.
8. Protect confirmed product behavior before adding new features.
9. Treat clean UI and correct state as the same workflow, not separate patches.

---

## 18. graphify — Knowledge Graph Navigation

This project has a pre-built knowledge graph in `graphify-out/`.

### Context Navigation

When you need to understand the codebase, docs, or any files in this project:

1. ALWAYS query the knowledge graph first: `/graphify query "your question"`
2. Only read raw files if the user explicitly says "read the file" or "look at the raw file"
3. Use `graphify-out/wiki/index.md` as your navigation entrypoint for browsing structured community summaries

### Quick reference

- `graphify-out/wiki/index.md` — community index (start here for browsing)
- `graphify-out/GRAPH_REPORT.md` — full audit report (god nodes, surprising connections)
- `graphify-out/graph.json` — raw graph data for queries
- `graphify-out/graph.html` — interactive visualization (open in browser)

### Key graph facts (as of 2026-05-12)

- **5,773 nodes · 12,250 edges · 230 communities**
- God nodes: `js()` (444 edges), `copy()` (189), `Vector3` (77)
- Key communities: `Core App Runtime`, `Supabase Client & Auth`, `Security & Invariant Specs`
- Run `/graphify --update` after significant code changes to keep the graph current

---

## 19. Final instruction

When in doubt:

- choose the smaller safe change
- preserve current working behavior
- favor backend truth over UI guesswork
- favor launch stability over elegance
- document follow-up work instead of widening the patch
- wait for validation when Codex or Claude finds a merge-blocking nuance