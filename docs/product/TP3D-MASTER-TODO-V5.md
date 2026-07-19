# Truck Packer 3D — Master TODO V5

**Last updated:** 2026-07-19

**Last verified repository state:** Platform-foundation reliability and the final Platform UX–UI Compatibility Closeout are complete; Max Capacity Phase C reporting is closed and merged to `main` at `99be0776d0070f18b18379bbe1e978a3dec03c43`; the evidence-only AutoPack strategy differentiation audit is closed and merged to `main` at `ec1cf4a`, with no production behavior change; the legacy AutoPack solver retirement audit is closed with a **SAFE TO REMOVE AFTER SMALL DEPENDENCY CLEANUP** disposition, and the legacy solver removal is merged to `main` at `716c4d1`, with no production behavior change. Inspector per-case Notes implementation and automated validation are complete on `feat/inspector-case-notes` at `089a69b` (committed, not yet pushed or merged); live browser QA has not yet been performed (see Section 7) and remains outstanding before this branch merges. The next active task is an `app.js` modularization inventory (M0 inventory only; not yet started; may proceed in parallel — it does not depend on Notes browser QA).

## 1. Document Contract

1. V5 is the active operational source of truth.
2. Keep only current status, blockers, and the next 5–10 approved tasks in the active queue.
3. Do not paste full implementation reports into V5.
4. Detailed test, browser, deployment, and audit evidence belongs in dedicated documents linked from V5.
5. Completed work receives a concise summary and evidence link.
6. Deferred ideas are not approved tasks and must not block active work.
7. Historical branch and commit reports belong in archive or topic documents.
8. Update V5 at milestone closeout, not after every small commit.
9. Do not duplicate mutable status in multiple sections.
10. Each active task must have one branch, one outcome, and one blocker state.
11. Replace outdated status rather than appending contradictory status.
12. Billing reliability, the Platform UX/UI Compatibility Closeout, Max Capacity Phase C reporting, the evidence-only AutoPack strategy differentiation audit, the evidence-only legacy AutoPack solver retirement audit, and the legacy AutoPack solver removal are closed; Phase C was merged to `main` at `99be0776d0070f18b18379bbe1e978a3dec03c43`, the strategy audit was merged to `main` at `ec1cf4a`, and the legacy solver removal was merged to `main` at `716c4d1`. Inspector per-case Notes implementation and automated validation are committed on `feat/inspector-case-notes` at `089a69b` (not yet pushed or merged; live browser QA outstanding — Section 7). An `app.js` modularization inventory (Section 4) is the single active task.

## 2. Current Status Snapshot

This table is the single mutable status snapshot in V5.

| Area | Status at the last verified repository state |
|---|---|
| Repository | `main` is at `716c4d1` (legacy-solver removal merged; `src/services/autopack-legacy-solver.js` deleted, dependent tests/docs corrected; no production behavior changed). `feat/inspector-case-notes` holds the committed, unpushed Inspector per-case Notes feature at `089a69b`, code/placement-corrected per review and automated-test-validated; live browser QA is outstanding. An `app.js` modularization inventory (M0 only) is the next active task, not yet started. |
| Supabase Data API grants | Complete, merged, pushed, and applied to development. |
| Workspace/membership write boundary | Complete. Authenticated clients retain RLS-filtered organization/membership reads and legitimate organization updates, but cannot directly insert organizations or mutate memberships; approved signup and server-controlled creation remain functional. |
| Server-side workspace creation limit | Complete. `org-create-workspace` supplies the trusted catalog limits to a service-role-only transaction that locks the actor profile, resolves the canonical owner entitlement, counts every owned workspace including archived rows, fails closed on unsafe/unavailable billing identity, and rejects at the effective limit. |
| Workspace slug | Phase 1 integrity complete. Migration `20260717150000_enforce_workspace_slug_integrity.sql` backfills/normalizes every historical row to the canonical UUID-derived slug, enforces `NOT NULL`, case-insensitive uniqueness, and a bounded format, and blocks direct authenticated/anon mutation via an invoker-rights guard trigger. Phase 2 friendly slugs remain separate required product work (see Section 12). |
| Clean local database | All 30 migrations reset successfully. |
| Edge smoke | Local and development workspace creation limits, same-owner concurrency, archived-inclusive counting, fail-closed billing identity, direct organization/membership denial, organization read/update, invite, role, remove, leave, transfer, and ownership restoration passed. |
| Local billing fixture Stage B | Complete. Clean 29-migration reset, local environment/grant verification, 39/39 local integration checks, exact cleanup, and full repository gates passed. |
| Billing fixture safety foundation | Complete. The existing layer remains no-write, environment-bound, masked, and production-refusing. |
| Deployed development fixtures | Complete. The expanded D2 deployed Edge/PostgREST/RLS matrix passed 38/38, including Packet 2 trial/paid limits, same-owner concurrency, archived counting, and fail-closed identity checks; exact cleanup covered 54 tracked objects with zero failures or collateral fingerprint differences. |
| Stripe test-mode fixtures | Complete. S1 signed-delivery safety, S2 direct-monthly lifecycle, and S3 rejection/replay safety passed against development; exact cleanup was idempotent and Supabase/Stripe collateral fingerprints were unchanged. |
| Direct-paid F12 identity | Complete and deployed. Requested-workspace direct identity precedes sibling owner-plan coverage. |
| Pricing | Not commercially finalized. |
| Normalized billing catalog | Complete, behavior-preserving, validated locally and in development, merged, and pushed. |
| Pricing operations runbook | Complete and updated for active checkout Prices, recognition-only legacy Prices, unknown fallback diagnostics, safe replacement, deployment scope, rollback limits, and unresolved commercial decisions. |
| Unknown or replaced Price handling | Complete. Usable explicitly mapped unknown Prices preserve conservative paid fallback with a masked diagnostic; recognized legacy Prices preserve tier/limit but remain checkout-disabled. Local and development validation passed. |
| Billing QA BUG-02 / BUG-03 | Proven resolved. Active/included paid workspaces return usable interval and period data; paying owners have an organization-scoped Portal path. Current runtime/local tests, authenticated evidence, and the Stripe S2 lifecycle agree. |
| Platform-foundation reliability | Closed. The readiness audit re-verified, on a fresh clean 30-migration reset, that Packets 1–3 hold together as one system with no regressions: a single direct SQL check confirmed all nine cross-packet invariants (INSERT revoke, obsolete policy absence, descriptive UPDATE grant, slug NOT NULL/format/uniqueness/guard trigger, `tp3d_create_workspace` service-role-only access) simultaneously; the full audit suite, typecheck, lint, workspace-security integration, and local billing/ownership/security fixtures all passed with zero failures; the development migration ledger showed zero drift (30/30). |
| Platform UX–UI Compatibility Closeout | Closed. Focused inspection confirmed workspace creation, workspace-limit error messaging, workspace switching, rename live-refresh, archive/restore, and the absence of any direct-INSERT/membership-mutation UI path all already behave correctly post-Packets-1–3. One real finding: the UUID-derived Slug row in Settings had no user-facing meaning and was hidden (`src/ui/overlays/settings-overlay.js`); stored value, import/export, and the read-only server contract are unchanged. Operator-confirmed: full `npm test`, typecheck, lint, clean local Supabase reset, workspace-security integration (9/9), and local billing/ownership/security (40/40) all passed with zero failures and zero residual fixture rows. |
| Max Capacity Phase C | Closed and merged to `main` at `99be0776d0070f18b18379bbe1e978a3dec03c43`; the approved packed-profile semantics contract and reporting surfaces are complete. |
| AutoPack strategy differentiation audit | Closed and merged to `main` at `ec1cf4a`; no production behavior changed. |
| Legacy AutoPack solver retirement audit | Closed and merged to `main` at `94dbfe4`. Disposition: SAFE TO REMOVE AFTER SMALL DEPENDENCY CLEANUP. No production behavior changed. |
| Legacy AutoPack solver removal | Closed and merged to `main` at `716c4d1`. `src/services/autopack-legacy-solver.js` deleted; dependent tests redirected/trimmed and 2 stale docs corrected. No production behavior changed. |
| Inspector per-case Notes | Implementation and automated validation complete on `feat/inspector-case-notes` at `089a69b` (not yet pushed or merged). Notes reuse the existing Case-template `notes` field (now normalized to string-or-null at the single cargo-canonical.js source of truth, matching the existing `hazmatClass` sibling convention) and the existing CaseLibrary.upsert update path; Cases-screen (case-modal.js) and Inspector edit the identical field. Not yet marked fully closed: live browser QA has not been performed (no dev-serve/login capability in the working environment). No AutoPack, solver, billing, auth, or workspace behavior changed. |
| Development schema drift | Legacy cases/packs, policies/functions, and billing ID differences remain a separate, non-blocking future audit. |

## 3. Current Source of Truth

- This document is the only active operational plan and status source.
- [Billing Entitlement Rules](./BILLING_ENTITLEMENT_RULES.md) remains authoritative for billing and workspace product semantics.
- [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md) is the current operational procedure for price, interval, limit, and display-copy changes; it does not approve commercial terms or alter the entitlement contract.
- [AutoPack Engine Contract](../engineering/autopack-engine-contract.md) remains authoritative for packing geometry, physical safety, and editor mutation behavior.
- [July 2026 Product Strategy Debrief](./PRODUCT-STRATEGY-DEBRIEF-2026-07.md) preserves broad direction, open decisions, and deferred candidates as a supporting reference; it does not approve implementation or create active work.
- `AGENTS.md`, `CLAUDE.md`, and `src/CLAUDE.md` define agent working constraints and must point here for operational status.
- Dedicated development, audit, and archive documents provide evidence; they do not create or approve active work.
- If an older plan or status report conflicts with V5, V5 wins. Domain contracts still win within their stated scope.

## 4. Active Work

| Field | Current value |
|---|---|
| Task | `app.js` modularization inventory (M0 inventory only — catalog extraction candidates and risk; do not begin extraction). |
| Branch | Not yet created. |
| Outcome | Not yet started. |
| Blocker state | Unblocked. Inspector per-case Notes implementation and automated validation, the task that previously preceded this in the queue, are committed on `feat/inspector-case-notes` at `089a69b`; that branch's own remaining step (live browser QA, then push/merge) does not block starting this inventory. |
| Scope boundary | Inventory only. Do not begin extraction. |
| Closeout | Not yet started. |

Only this row is active. The following section is an approved sequence, not simultaneous work.

## 5. Next Approved Execution Queue

1. Perform live browser QA on `feat/inspector-case-notes` (Empty/Read/Edit states, top-card placement, selection safety, Transform/Rotate/Actions/Category unaffected), then push and merge to `main`.
2. Perform an `app.js` modularization inventory (M0 inventory only, not extraction) and plan low-risk extraction.

Queue order is approval order. Start one branch at a time and record its active branch, outcome, and blocker state in Section 4.

## 6. Current Blockers

- None for the `app.js` modularization inventory. Inspector per-case Notes implementation/automated validation are complete and committed on `feat/inspector-case-notes` at `089a69b`; its own live-browser-QA step is outstanding but does not block this inventory from starting.
- Commercial pricing is not final, but that remains unrelated and non-blocking.
- Workspace Slug Phase 2 (friendly slugs) remains deferred, separate required product work — not part of the active queue (see Section 12).

## 7. Recently Completed Milestones

| Milestone | Concise result | Evidence |
|---|---|---|
| Inspector per-case Notes | **Implementation and automated validation complete; not yet closed — live browser QA has not been performed.** Committed on `feat/inspector-case-notes` at `089a69b` (not yet pushed/merged). Audit found the Case-template `notes` field already had normalization, import/export, and case-modal.js (Cases screen) editing support, but no Inspector affordance and an always-`''` (never `null`) empty representation. Added a Notes button to the **top case-summary card** (upper-right of the case-name header row, appended directly to `.card` so it reuses the existing `row space-between` header pattern from `cardHeaderWithInfo`/Transform/Rotate and the pre-tuned `#inspector-body .card>.row.space-between` spacing rule — no new layout system) — an initial draft had placed it in the Actions card instead; that was caught and corrected in review, and the Actions card is now byte-identical to before this feature. Empty/Read/Edit states render via the existing `UIComponents.showModal`, routed through the same canonical update path as the existing Set Category action (`CaseLibrary.upsert`, with the selected `caseId` captured once so a draft can never migrate or write to the wrong case; Save failure on a deleted case returns `false` so the modal stays open with the draft intact rather than closing). Escape-to-close is scoped locally to this feature's own modal wrapper — an initial draft added it globally to the shared `showModal` primitive, but `truck-change-controller.js` already implements its own capture-phase Escape handling on top of `showModal` specifically because `showModal` doesn't provide it globally, so a generic bubble-phase addition there would have run alongside that existing P0-sensitive Truck Change handler; the global change was reverted and `showModal` is now byte-identical to before this feature. Fixed the notes normalization gap at its single source of truth (`parseCargoNotes` in `cargo-canonical.js`, wired into `canonicalCargoForStorage`) so `case.model.js`, `normalizer.js`, `CaseLibrary.upsert`, and spreadsheet import all now normalize empty/whitespace/non-string notes to `null` consistently — matching the existing sibling `hazmatClass` field's null-for-empty convention, not a newly invented rule; no dirty-state/equality comparison on case objects exists anywhere in the app, and `notes` is already excluded from the physical-equivalence/import-fingerprint comparison key, so this carries no regression risk (confirmed by the full suite). Cases-screen (`case-modal.js`) and Inspector edit the identical `CaseLibrary` field — verified directly. Undo/Redo, duplication, and every existing JSON/spreadsheet persistence path cover notes for free because `caseLibrary` was already a significant/undoable state key and duplication only clones pack instances (never the case template). 19 automated tests (data-layer normalization/persistence, Cases-screen/Inspector field parity, and editor-screen.js source-contract checks — including a structural check that the Notes button is inside the summary card and explicitly absent from the Actions card — matching the existing no-jsdom testing convention for that module); full suite 1106/1106 passed (0 fail, 5 pre-existing skips), typecheck and lint clean (0 errors, same pre-existing warning set). **Live browser validation was not performed**: this environment has no dev-serve script and no Supabase login credentials, so the interactive checklist (open Notes, Empty/Add/Save/Read/Edit/Cancel/reload/clear/multi-selection/Transform-Rotate-Category-AutoPack unaffected) remains outstanding before this branch is considered closed and merged. No AutoPack, solver, billing, auth, or workspace behavior changed. | `src/core/cargo-canonical.js`, `src/core/normalizer.js`, `src/data/models/case.model.js`, `src/screens/editor-screen.js`, `src/ui/ui-components.js` (unchanged from before this feature), `styles/main.css`, `tests/audit/inspector-case-notes.spec.mjs` |
| Legacy AutoPack solver removal | Closed and merged to `main` at `716c4d1`. `src/services/autopack-legacy-solver.js` deleted (549 lines); no production behavior changed. No compatibility shim added, no fallback introduced; `buildLegacyAutoPackItems` remains unmoved in `autopack-item-builder.js` and every production import already pointed there. Test cleanup in `tests/audit/security-and-invariants.spec.mjs`: 4 genuine behavior tests (`CARGO-RULE-V5`, `CARGO-RULE-V4`, `REPAIR-1 D`, plus the `r1bModules`/`r1bLegacyItem` helper shared by 6 REPAIR-1B tests) redirected to import `autopack-item-builder.js` directly; 3 dead-code source-pattern tests deleted (`AUTO-PACK-A1-2`, `AUTO-PACK-A1-3 X anchor cap`, `G2-SHAPE-CONTRACT`); 3 tests trimmed to drop only their legacy-file-dependent assertions while keeping their still-meaningful engine/app assertions (`AUTO-PACK-A1-3` renamed to its surviving staging-delegation assertion, `AUTO-PACK-A1-R6`, `AUTO-PACK-A1-CLEAN-1`, `AUTO-PACK-A0`). No noStackOnTop/maxStackCount/support physical-safety coverage was lost — that behavior is independently covered by the pre-existing `AUTO-PACK-A1-R4`, `5A`, `REPAIR-1E`, `CARGO-RULE-V7`, and `AUTOPACK-MAX-A` test groups against the active solver, confirmed unaffected. `docs/engineering/autopack-engine-contract.md` and `docs/engineering/autopack-core-engine-plan.md` corrected to remove stale "still referenced" / "kept intentionally" language and state the legacy solver was retired and removed. Full suite 1082/1087 passed (5 pre-existing skips, down from 1090 by exactly the 3 deleted tests), typecheck and lint clean (0 errors, same pre-existing warning set). | [audit report](../audits/legacy-autopack-solver-retirement-audit-2026-07-19.md), `tests/audit/security-and-invariants.spec.mjs`, [AutoPack Engine Contract](../engineering/autopack-engine-contract.md), `docs/engineering/autopack-core-engine-plan.md` |
| Legacy AutoPack solver retirement audit | Closed and merged to `main` at `94dbfe4`; no production behavior changed. Proved `src/services/autopack-legacy-solver.js` has zero production reachability: `autopack-engine.js` imports `buildLegacyAutoPackItems` directly from `autopack-item-builder.js` (never from the legacy file), no strategy in the six-strategy portfolio or its error/recovery paths ever calls `solveLegacyAutoPack`, and no browser import chain from `index.html` fetches the file. Reachable only from 12 tests in `security-and-invariants.spec.mjs`. Disposition: **SAFE TO REMOVE AFTER SMALL DEPENDENCY CLEANUP** (redirect 4 genuine behavior tests to `autopack-item-builder.js`, delete/trim 4 dead-code and 2 deletion-blocking guard tests, correct 2 stale doc lines). Focused legacy-solver tests 43/43 passed, full suite 1085/1090 passed (5 pre-existing skips), typecheck and lint clean (0 errors). | [audit report](../audits/legacy-autopack-solver-retirement-audit-2026-07-19.md), `src/services/autopack-legacy-solver.js`, `src/services/autopack-item-builder.js`, `src/services/autopack-engine.js`, `tests/audit/security-and-invariants.spec.mjs` |
| AutoPack strategy differentiation audit | Closed and merged to `main` at `ec1cf4a`. 15 deterministic fixtures across six strategies produced stable signatures, zero invalid placements, zero canonical-count mismatches, and matching representative browser evidence. All six strategies remain retained, Balanced remains the default, production physical-layout dedupe remains required, Max Capacity remains manual-only, and Constrained Space First remains Wheel-Wells-only. No production behavior changed. Max Capacity copy clarification remains a recommendation only, not approved implementation work. | [audit report](../audits/autopack-strategy-differentiation-audit-2026-07-19.md), [machine results](../audits/autopack-strategy-differentiation-results-2026-07-19.json), `scripts/autopack-strategy-audit.mjs`, `tests/audit/autopack-strategy-differentiation.spec.mjs` |
| Max Capacity Phase C — profile-membership reporting | Closed and merged to `main` at `99be0776d0070f18b18379bbe1e978a3dec03c43`. Implements the approved Contract C `maxCapacityProfileCount` reporting in the applied Stats card, pre-Apply Results panel, and PDF summary without changing solver, geometry, duplicate, reconciliation, billing, auth, or schema behavior. | [Packed-Profile Semantics Audit](../audits/max-capacity-phase-c-packed-profile-semantics-audit-2026-07-18.md), `src/services/pack-library.js`, `src/screens/editor-screen.js`, `src/app.js`, `tests/audit/max-capacity-phase-c-reporting.spec.mjs` |
| Platform UX–UI Compatibility Closeout | Branch `fix/platform-ux-ui-compatibility-closeout`. Focused inspection confirmed workspace creation, workspace-limit error messaging, workspace switching, rename live-refresh, archive/restore, and the absence of any direct-INSERT/membership-mutation UI path all already behave correctly post-Packets-1–3 — no code change needed for those. One real finding: the UUID-derived Slug row in the Settings General card had no user-facing meaning (Phase 1 is integrity-only) and was hidden (2 loading-skeleton placeholders + the real value row, the only 3 call sites reading `orgData.slug` in `src/`). Stored value, import/export, and the read-only server contract are unchanged; no editing, routing, or sharing UI was added. `docs/product/SETTINGS-WORKSPACE-GENERAL-UI-PLAN.md` (an approved-but-deferred Phase UI-2/UI-3 plan assuming Slug stayed in Card 1) was reconciled at its four Slug references. Operator-confirmed: full `npm test`, typecheck, lint, clean local Supabase reset, workspace-security integration (9/9), and local billing/ownership/security (40/40) all passed, zero failures, zero residual fixture rows. No sharing, routing, billing, schema, or AutoPack behavior was introduced. | [migration/plan doc](../product/SETTINGS-WORKSPACE-GENERAL-UI-PLAN.md), `src/ui/overlays/settings-overlay.js`, `tests/local-db/workspace-membership-security.spec.mjs`, `tests/local-db/security-local.spec.mjs`, `tests/audit/security-and-invariants.spec.mjs` |
| Platform-foundation reliability closeout — readiness audit | Read-only audit (no branch, no code changes) on `main` HEAD `3253580`. Re-verified from a clean 30-migration reset that Packets 1–3 hold together with no regressions: one direct SQL query confirmed all nine cross-packet invariants simultaneously (organization INSERT revoked/UPDATE retained, obsolete insert policy absent, slug NOT NULL/format/uniqueness/guard trigger all present, `tp3d_create_workspace` service-role-only). Full audit suite 1,051/1,056 passed, typecheck/lint clean, `workspace-membership-security.spec.mjs` (Packets 1+2+3 together) 9/9, local billing/ownership/security 40/40, development migration ledger 30/30 with zero drift. Formally declares platform-foundation reliability closed; the final Platform UX–UI Compatibility Closeout remains the next, unstarted task. | `tests/local-db/workspace-membership-security.spec.mjs`, `tests/local-db/security-local.spec.mjs`, `tests/audit/security-and-invariants.spec.mjs` |
| Workspace-slug Phase 1 integrity — Packet 3 | Migration `20260717150000_enforce_workspace_slug_integrity.sql` backfills/converges every null, blank, malformed, duplicate, or case-variant-duplicate slug to the canonical `lower(id::text)` UUID-derived shape (deterministic, collision-free by construction), then enforces `NOT NULL`, a case-insensitive unique index on `lower(slug)`, and a bounded `^[a-z0-9-]{1,100}$` format check. Direct authenticated/anon slug mutation is blocked by an invoker-rights guard trigger (`before update of slug`) reusing the proven `tp3d_guard_profile_deletion_fields` trusted-role pattern — no change to the signup trigger. `tp3d_create_workspace` was redefined only to replace its null-slug-then-update insert (incompatible with `NOT NULL`) with a single INSERT writing a pre-generated id/slug directly; every entitlement, locking, counting, and limit-check line is unchanged from Packet 2. Local: clean 30-migration reset, workspace-security integration 9/9, local billing/ownership/security 40/40, full audit suite 1,051/1,056 passed (0 fail, 5 pre-existing skips), typecheck and lint clean. Development: migration applied to `yduzbvijzwczjapanxbd`; all 82 pre-existing organizations converged to valid/unique/non-null slugs with zero manual intervention; deployed D2 matrix passed 38/38 including signup, server workspace creation, workspace limits, same-owner concurrency, and archive/restore; exact-ID cleanup of 6 disposable fixture users completed with zero residue. Self-audit confirmed slug is not used as authorization anywhere, Packet 2 entitlement/concurrency logic is byte-identical, and no Phase 2 friendly-slug work began. | [migration](../../supabase/migrations/20260717150000_enforce_workspace_slug_integrity.sql), `tests/local-db/workspace-membership-security.spec.mjs`, `tests/local-db/security-local.spec.mjs`, `tests/audit/security-and-invariants.spec.mjs`, `tests/integration/dev-billing/deployed-functions.spec.mjs` |
| Server-side workspace-limit enforcement — Packet 2 | Migration `20260717142844_enforce_server_workspace_limits.sql` replaces the user-creation RPC with a service-role-only catalog-aware transaction. It locks the actor profile before entitlement resolution/count/insert, counts all canonical owner workspaces including archived rows, preserves trial/Business/Pro-fallback and payment-grace limits, rejects unsafe or unavailable billing identity, and returns stable sanitized Edge codes. Clean 29-migration reset passed; workspace security was 9/9, local billing 39/39, fixture safety 34/34, security 887 passed/5 skipped, and the full suite 1,047 passed/5 skipped. Development applied only the migration and `org-create-workspace`; 38/38 deployed checks proved below/at-limit behavior, one-winner same-owner concurrency, archived counting, and fail-closed identity, followed by exact cleanup of 54 tracked objects with zero collateral differences. | [migration](../../supabase/migrations/20260717142844_enforce_server_workspace_limits.sql), [Edge Function](../../supabase/functions/org-create-workspace/index.ts), `tests/local-db/workspace-membership-security.spec.mjs`, `tests/integration/dev-billing/deployed-functions.spec.mjs` |
| Direct organization INSERT boundary — Packet 1 | Migration `20260717135117_restrict_direct_organization_inserts.sql` revoked authenticated organization INSERT and removed `organizations_insert_owner_self` without changing SELECT, UPDATE, slug, limit, billing, archive, deletion, or ownership semantics. Clean 28-migration reset passed; targeted security was 1/1, local billing 39/39, fixture safety 34/34, security 885 passed/5 skipped, and the full suite 1,045 passed/5 skipped. Development returned `403/42501` for direct INSERT with zero residue, while signup, server creation, canonical owner/membership/billing state, SELECT, and descriptive UPDATE passed; exact cleanup and collateral fingerprints were clean. | [migration](../../supabase/migrations/20260717135117_restrict_direct_organization_inserts.sql), `tests/local-db/workspace-membership-security.spec.mjs` |
| Platform-foundation reliability reconciliation | Reassessment confirmed the authenticated `organizations` INSERT boundary and slug integrity gaps, and classified server-side workspace-limit enforcement as missing. The creation Edge/RPC path contains no billing/count/lock check, and the local security flow currently proves a trial owner can create multiple additional workspaces directly. BUG-02 and BUG-03 are proven resolved by current runtime/local tests, authenticated paid-workspace evidence, and Stripe S2 Portal proof. Obsolete clean worktrees/branches with no needed unique evidence were removed. | `supabase/functions/org-create-workspace/index.ts`, `supabase/migrations/20260716061516_server_controlled_workspace_creation.sql`, `tests/local-db/workspace-membership-security.spec.mjs`, [archived authenticated billing evidence](../archive/2026-03-old-todos/TP3D-MASTER-TODO-V3.md) |
| Stripe test-mode fixtures | S1 proved the deployed webhook accepts Stripe-signed events with the seven required destination events and no probe residue. S2 proved one disposable direct-monthly Customer/Subscription lifecycle, active billing status, Portal access, signed cancellation, and entitlement revocation. S3 proved sanitized missing/invalid-signature rejection and idempotent signed replay. Exact cleanup was repeatable, with no Supabase or Stripe collateral fingerprint change; fixture safety was 50/50, local billing remained 39/39, and the repository audit was 1,050 total, 1,045 passed, 5 skipped, 0 failed. | [Stripe fixture operator guide](../dev/stripe-test-billing-fixtures.md), [shared fixture boundary](../dev/billing-fixtures.md) |
| Deployed development-function fixtures | A production-refusing hosted-development harness now proves disposable auth/workspace/billing projections, deployed Edge paths, PostgREST/RLS, authorization, invitations, ownership, archive/restore, malformed/omitted organization handling, safe pre-Stripe rejection, exact-ID cleanup, and zero collateral fingerprint changes. D1 safety was 34/34; final D2 was 32/32 executable tests covering the required 40-scenario matrix plus omission and sibling regressions; the repository audit was 1,050 total, 1,045 passed, 5 skipped, 0 failed. | [Deployed fixture operator guide](../dev/deployed-development-billing-fixtures.md), [shared fixture boundary](../dev/billing-fixtures.md) |
| Malformed billing-status organization ID | Supplied non-empty malformed `organization_id`/`org_id` values now return sanitized 400 after authentication but before profile fallback, service-role database reads, billing lookup, or Stripe use. Omission and explicit empty values retain the existing profile fallback; valid organization authorization and F12 behavior are unchanged. | `supabase/functions/billing-status/index.ts`, `tests/audit/security-and-invariants.spec.mjs` |
| Unknown/replaced Price handling | Active checkout and recognition-only legacy Price sets are separate. Known legacy Prices preserve tier/limit without new checkout; usable explicitly mapped unknown Prices retain conservative fallback and emit a masked `unknownPriceId` diagnostic. Local Stage B stayed 39/39 with zero residuals; repository gates and limited development deployment/smoke passed. | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md), `supabase/functions/_shared/billing-catalog.ts`, `supabase/functions/billing-status/index.ts` |
| Behavior-preserving billing catalog | One lazy, pure shared server catalog now owns configured Pro/Business Price IDs, interval resolution, checkout eligibility, and Trial/Pro/Business workspace limits. Billing-status exact Business matching, restore's broader Business matching, Pro-only checkout, and unknown-active paid fallback remain unchanged; local Stage B, repository gates, and limited development deployment/smoke passed. | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md), `supabase/functions/_shared/billing-catalog.ts` |
| Workspace-name live-refresh (`fix/workspace-name-live-refresh`, unrelated to the platform-foundation track above) | A confirmed workspace rename updated the General panel but left the bottom sidebar workspace chip stale until reload, because `saveOrganization()` never reconciled the server-confirmed row into app.js's canonical `orgContext`. Added `handleWorkspaceUpdated(updatedOrg, options)`, exposed on `window.TruckPackerApp` alongside the existing `handleWorkspaceArchived`/`handleWorkspaceRestored` bridge (fixing, as a narrowly required side effect, the same pre-existing final-IIFE-return overwrite that already silently dropped `handleWorkspaceLeft`, `handleOwnershipTransferred`, and `notifyOrgAccessLoss` from `window.TruckPackerApp` — those three remain unfixed and out of this scope). The new function reconciles the returned org into `orgContext.orgs[]` and, when active, `orgContext.activeOrg`, then dispatches the existing `tp3d:org-changed` event (broadcast for cross-tab) and the existing `queueOrgScopedRender` render pass — no direct DOM label patch, no network refetch (a field-level rename never changes visibility/ownership, unlike archive/restore/transfer). The active organization ID is never reassigned. The Settings modal's top-left card was investigated and confirmed to be user-account identity (`getCurrentUserView()`), not a workspace-name display (no `data-org-name` element exists there); it was left unchanged. Confirmed live in a real browser session against the development Supabase project: two consecutive renames updated the bottom sidebar chip immediately with no reload. Full audit suite 889/894 passed in this file (0 fail, 5 pre-existing skips), typecheck and lint clean (0 errors, only pre-existing warnings). | `src/app.js` (`handleWorkspaceUpdated`), `src/ui/overlays/settings-overlay.js` (`saveOrganization`), `tests/audit/security-and-invariants.spec.mjs` |
| Pricing operations runbook | Current catalog authority, caller-specific recognition rules, safe change procedures, environment risks, validation/deployment matrices, rollback limits, grandfathering default, emergency checkout stop, and unresolved commercial decisions are documented without changing runtime or Stripe state. | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md), [Pricing Change Log](../billing/PRICING-CHANGE-LOG.md) |
| Local billing fixture Stage B | A localhost-only harness now runs the real local billing/ownership Edge paths, ownership RPC, authenticated RLS, and raw constraint probes. Clean 27-migration reset, 39/39 local checks, exact-ID cleanup, and repository gates passed without remote Supabase or Stripe access. | [Local fixture operator guide](../dev/local-billing-fixtures.md), [shared fixture boundary](../dev/billing-fixtures.md) |
| Server-controlled application workspace creation and membership writes | The application create action uses one authenticated Edge call and one service-role-only transaction; authenticated direct membership DML is revoked while approved Edge/RPC paths remain functional. The organization table INSERT boundary and server-side creation limit remain in the active queue above. | [Edge Function](../../supabase/functions/org-create-workspace/index.ts), [creation transaction](../../supabase/migrations/20260716061516_server_controlled_workspace_creation.sql), [membership privileges](../../supabase/migrations/20260716061518_restrict_direct_membership_mutations.sql) |
| Explicit Supabase Data API grants | Minimum API-role table grants and schema-portable conditional sequence grants are merged, pushed, reset locally, and applied to development. | [Migration](../../supabase/migrations/2026071401_explicit_api_role_privileges.sql), [archived integration evidence](../archive/master-todos/TP3D-MASTER-TODO-V4.md#current-authbilling-integration-gate--2026-07-15) |
| Local/dev Edge smoke | Four billing, role, transfer, and restoration paths passed without altering the known schema differences. | [Archived V4 billing evidence](../archive/master-todos/TP3D-MASTER-TODO-V4.md#1a--billing-foundation) |
| Billing fixture safety foundation | No-write planning, immutable manifest binding, masked output, and production refusal are complete. | [Fixture safety contract](../dev/billing-fixtures.md) |
| F12 direct-paid identity | Unambiguous requested-workspace direct subscription identity now resolves before sibling coverage; ambiguity fails closed. | [Archived F12 evidence](../archive/master-todos/TP3D-MASTER-TODO-V4.md#f12-direct-paid-workspace-identity---merged-pushed-deployed-sandbox-pass-with-fixture-gaps-2026-07-14) |
| Max Capacity Phases A and B | Multiple-result integration and durable per-instance `max-capacity` profile are complete while physical hard rules remain enforced. | [Archived AutoPack evidence](../archive/master-todos/TP3D-MASTER-TODO-V4.md#active-debug-queue--autopack--results--editor-regressions) |

## 8. Permanent Product Contracts

### Billing and Workspace Safety

- Resolve money-bearing objects for the requested organization; do not fall back across workspaces.
- An unambiguous directly paid requested workspace is evaluated before sibling owner-plan coverage.
- Ambiguous organization, customer, or subscription identity fails closed.
- Ownership changes use the dedicated ownership-transfer path.
- Generic member-role updates cannot create, promote, demote, or replace owners.
- User-initiated workspace creation must use the dedicated authenticated server path and one atomic database transaction; authenticated clients must not insert organization rows directly.
- Server-controlled user creation must resolve the effective owner entitlement, count every canonical owner workspace including archived workspaces, reject at the limit, fail closed on uncertain billing identity, and serialize concurrent requests before insert.
- Authenticated clients may read memberships through RLS but cannot directly insert, update, or delete membership rows.
- Workspace slugs are identifiers, never authorization. Phase 1 keeps them valid, non-null, case-insensitively unique, UUID-derived by approved creation paths, and immutable outside a controlled server path.
- Price amount never determines workspace ownership or billing identity.
- Stripe is payment truth; `/billing-status` is application entitlement truth.
- Owners alone manage checkout, portal, plan, and payment actions. Members never pay separately.
- Production or customer data is never used as a disposable fixture.

### AutoPack Physical Safety

- Every placement must remain contained, non-overlapping, non-floating, and validly supported.
- Use real dimensions and canonical right-angle rotations.
- Wheel-well blocked bodies, shelf support, center-of-mass, and cantilever rules remain hard constraints.
- Front Overhang cab-void and rear-retention rules remain hard constraints.
- Max Capacity may relax approved handling preferences only; it cannot relax physical safety.
- Multiple genuinely distinct solutions remain a product requirement.
- Quality scoring chooses only among physically valid candidates.

### Data and Persistence

- User- and organization-scoped state must not leak across identity or workspace changes.
- Persistent cargo geometry is derived from canonical dimensions and rotation, not stale display state.
- Migrations must reproduce required local and development behavior without normalizing unrelated drift.
- Billing fixture cleanup may target only immutable manifest-owned identifiers in the bound environment.
- Imports, exports, reload, duplication, Undo/Redo, and canonical repair must preserve documented invariants.

### UI and Regression Safety

- Workspace, billing, members, invites, editor, and preview state must reconcile to the active organization.
- Cross-tab snapshots remain user-, organization-, and freshness-guarded.
- UI polish must not hide a data, lifecycle, entitlement, or identity bug.
- Long-running editor operations expose truthful working states and block conflicting mutations while preserving safe camera inspection.
- Owner-only money actions and fail-closed entitlement behavior must remain visible and testable.

### Development Discipline

- Keep changes minimal, reuse existing patterns, and avoid broad refactors without approval.
- Separate behavior changes from cleanup and from unrelated schema work.
- Preserve current behavior unless the approved task explicitly changes it.
- Keep detailed test, browser, deployment, and audit evidence outside V5 and link to it.

## 9. Billing Reliability Foundation

The current reliability phase establishes repeatable proof for organization-scoped billing behavior before product expansion resumes.

The evidence-based reassessment is complete. Local, deployed-development, and Stripe test-mode fixtures, the catalog/runbook, unknown/replaced-Price behavior, Billing QA BUG-02/BUG-03, and Packets 1–3 are closed. The platform-foundation reliability readiness audit has confirmed Packets 1–3 hold together as a system; the phase is now closed.

### ✅ Packet 2 — Server-side workspace-limit enforcement — complete 2026-07-17

- The service-role-only RPC locks the actor's profile row before resolving the canonical owner billing projection, counting, comparing, or inserting; unrelated owners retain independent lock rows.
- All actor-owned workspaces count, including archived workspaces. Trial uses the catalog Trial limit; recognized Business uses the catalog Business limit; usable known/unknown Pro-family and grace projections preserve the current Pro fallback; unavailable or ambiguous identity fails closed.
- Signup remains on its separate server-owned bootstrap trigger, while user-initiated creation returns stable sanitized limit, unsafe-identity, unavailable-entitlement, invalid-request, unauthorized, and internal-failure codes.
- Local and deployed-development concurrency both proved exactly one success and one limit rejection with one slot remaining and no partial organization, membership, billing, or trial residue.

### ✅ Packet 3 — Workspace slug Phase 1 integrity foundation — complete 2026-07-18

- Landed after Packet 2; the migration converges and the approved dependency order held.
- Backfilled null/blank and safely normalized malformed or colliding legacy values to the existing UUID-derived convention (`lower(id::text)`); zero manual intervention needed on the 82 pre-existing development organizations.
- Enforces non-null, case-insensitive uniqueness (`lower(slug)` unique index), a bounded valid internal format (`^[a-z0-9-]{1,100}$`), approved creation-time generation (both signup and server-controlled `tp3d_create_workspace`), and server-controlled mutation via an invoker-rights guard trigger; Settings remains read-only.
- Proved slug lookup never grants access and membership/authorization remains authoritative, by code inspection and by the deployed D2 matrix's authorization tests.
- Actual scope: one integrity migration (backfill, constraints, guard trigger, and the narrowly required `tp3d_create_workspace` insert-tail fix), no signup-trigger change, and focused local/development tests. See Section 7 for full validation evidence.

### ✅ Platform-foundation reliability closeout — readiness audit — complete 2026-07-18

- Read-only audit, no branch, no code changes, re-verified on `main` HEAD `3253580`.
- A clean 30-migration reset from zero passed, then one direct SQL query confirmed all nine cross-packet invariants simultaneously on that single database: `authenticated` retains 0 `organizations` INSERT / 1 UPDATE grant, the obsolete `organizations_insert_owner_self` policy is absent, `slug` is `NOT NULL` with its format CHECK/`lower(slug)` unique index/guard trigger all present, and `tp3d_create_workspace` is `service_role`-only (0 `authenticated` grants).
- Full audit suite 1,051/1,056 passed (0 fail, 5 pre-existing skips), typecheck and lint clean, `workspace-membership-security.spec.mjs` (Packets 1+2+3 together) 9/9, local billing/ownership/security 40/40, development migration ledger 30/30 with zero drift.
- Declares platform-foundation reliability formally closed.

### ✅ Platform UX–UI Compatibility Closeout — complete 2026-07-18, branch `fix/platform-ux-ui-compatibility-closeout`

Focused inspection confirmed the completed platform-foundation work (Packets 1–3) behaves correctly in the UI:

- workspace creation uses the approved server path only (no direct `.from()` insert);
- workspace-limit failure messages are already safe and understandable (`getEdgeFunctionErrorMessage()` surfaces the Edge Function's own sanitized text, e.g. "Workspace limit reached...", with a generic fallback; no raw codes/SQL leak);
- workspace switching and workspace rename already update all organization-scoped UI live, without reload (rename fixed in the prior `fix/workspace-name-live-refresh` merge, `8d47db7`);
- archive/restore already reconcile correctly (`handleWorkspaceArchived`/`handleWorkspaceRestored`, proven via deployed D2-20);
- no UI path attempts direct organization INSERT or direct membership mutation (existing static contract tests).

One real compatibility finding: the UUID-derived Slug row in the Settings General card had no user-facing meaning (Workspace Slug Phase 1 is integrity-only) and could read as a confusing or misleading internal identifier. Disposition: **hidden** from `src/ui/overlays/settings-overlay.js` (2 loading-skeleton placeholders + the real value row; 3 call sites, the only file in `src/` that read `orgData.slug`). The stored value, import/export, and read-only server-side contract are unchanged; no slug editing, routing, or sharing UI was introduced. `docs/product/SETTINGS-WORKSPACE-GENERAL-UI-PLAN.md` (an approved-but-deferred Phase UI-2/UI-3 plan that assumed Slug stayed in Card 1) was updated at its four Slug references so a future Phase UI-3 execution does not silently reintroduce the row.

No sharing, routing, billing, schema, or AutoPack behavior was introduced. Operator-confirmed full validation: `npm test`, typecheck, lint, and clean local Supabase reset all passed; `TP3D_LOCAL_DB_INTEGRATION=1 node --test tests/local-db/workspace-membership-security.spec.mjs` passed 9/9; `npm run test:billing:local` passed 40/40 with zero residual fixture rows on cleanup. Merged to `main`.

### Historical billing bug dispositions

- **BUG-02 — proven resolved:** current production-handler/local billing tests retain `month`/`year` and `currentPeriodEnd` for directly paid workspaces, configured and recognized legacy Prices recover interval metadata, and the authenticated paid-workspace matrix returned usable interval and renewal values.
- **BUG-03 — proven resolved:** `billing-status` derives `portalAvailable` from the requested organization's known Stripe Customer and propagates owner coverage safely; the authenticated test2/test4 evidence returned `portalAvailable: true`, and Stripe S2 opened an exact organization-scoped test-mode Portal session.
- Old warning labels remain historical evidence in archived TODO files only. They do not create active implementation work.

The foundation must preserve [Billing Entitlement Rules](./BILLING_ENTITLEMENT_RULES.md), [Billing Fixture Safety](../dev/billing-fixtures.md), direct-first F12 identity, fail-closed ambiguity, owner-only money actions, and production-data refusal. It does not authorize a broad billing schema migration or any next-generation billing design in Section 12.

## 10. AutoPack and Editor Status

The stable AutoPack/editor baseline includes the solution portfolio, Max Capacity Phase A, durable per-instance Phase B metadata, editor operation lifecycle guards, manual placement safety, organized Unpack polish, and the existing Wheel Wells and Front Overhang hard-rule contracts. Detailed milestone reports remain in [archived V4](../archive/master-todos/TP3D-MASTER-TODO-V4.md).

Phase C — a small reporting follow-up, without UI redesign or legal, axle, or DOT claims — is closed and merged to `main` at `99be0776d0070f18b18379bbe1e978a3dec03c43`, per the permanent contract recorded in [Max Capacity Phase C — Packed-Profile Semantics Audit](../audits/max-capacity-phase-c-packed-profile-semantics-audit-2026-07-18.md): `packedProfile` denotes active Max Capacity profile membership (Contract C), reported as the `maxCapacityProfileCount` canonical statistic in the applied Stats card, the pre-Apply Results panel, and the PDF summary. Duplicate handling, Truck Change/reconciliation, the solver, and geometry were intentionally not touched.

The evidence-only AutoPack strategy differentiation audit is closed and merged to `main` at `ec1cf4a`; it changed no production behavior. Its Max Capacity product-copy clarification is a recommendation only, not approved implementation work.

The evidence-only legacy AutoPack solver retirement audit is closed and merged to `main` at `94dbfe4` with disposition SAFE TO REMOVE AFTER SMALL DEPENDENCY CLEANUP. Following that disposition, `src/services/autopack-legacy-solver.js` was deleted and merged to `main` at `716c4d1`; `buildLegacyAutoPackItems` is unaffected and remains owned by `autopack-item-builder.js`; no solver, engine, or editor behavior changed. Inspector per-case Notes implementation and automated validation are committed on `feat/inspector-case-notes` at `089a69b` (live browser QA outstanding); an `app.js` modularization inventory (Section 4) is now the single active task. See Section 7 for evidence links.

Future AutoPack quality, strategy, manual placement, and performance architecture belong in the reference-only inventory below. They are not active work.

## 11. Product Decisions Required

Before next-generation billing hardening, decide:

1. One Stripe Customer per workspace versus a shared billing account.
2. Whether consolidated billing exists.
3. Whether multiple commercially current subscriptions may exist for one workspace.
4. Whether legacy user-level Stripe Customer mappings remain supported.
5. How ownership transfer affects billing accounts and Stripe mappings.
6. Whether existing subscribers are migrated or grandfathered.
7. Final commercial plans, intervals, workspace limits, replacement-price policy, and customer transition rules.

These decisions must not be inferred from current database accidents, Stripe object amounts, or test fixtures.

## 12. Deferred Architecture Inventories

This section is reference-only. Its entries are not approved branches, are not active work, do not block the current reliability foundation, require focused audits and product decisions before implementation, and must not be implemented as one broad schema migration.

### Next-Generation Billing Hardening

Strong future candidates:

- Workspace-to-Stripe identity integrity.
- Cross-table customer/subscription consistency.
- Explicit current-subscription policy.
- Billing projection integrity.
- Billing anomaly and reconciliation logging.
- Raw-subscription access review.
- Query-driven billing indexes.

The decisions in Section 11 are prerequisites. Each accepted candidate needs a separate audit, migration/implementation packet, rollback plan, and evidence set.

### AutoPack Quality and Strategy

- Wheel Wells bridge/spanning support under an explicit support contract.
- Front Overhang retaining-wall-first planning.
- Manual vertical placement and snap-on-top.
- Organized Unpack strategy beyond the current polish baseline.
- Additional genuinely distinct solution strategies and quality audits.
- Web Worker/chunking and InstancedMesh/LOD only as later performance architecture.
- CoG, axle, delivery-order, and crush-model work only with explicit product and safety contracts.

### Data Model and Persistence

- Server-backed packs/cases and conflict-safe synchronization.
- Data migration, import/export, recovery, and retention policy hardening.
- Pack/Case business identifiers should wait for a dedicated product/data audit.
- Existing development schema drift requires a separate evidence-first audit, not opportunistic normalization.

### Workspace Slug Phase 2 (Friendly Slugs) — deferred

Workspace Slug Phase 1 (integrity-only: backfill/normalize, non-null, case-insensitive uniqueness, bounded format, server-controlled mutation) is complete and closed — see Section 9. The technical Slug row is currently hidden from Settings (Platform UX/UI Compatibility Closeout, Section 9) because the UUID-derived slug has no user-facing meaning yet.

The full friendly workspace-slug feature remains required product work, not optional metadata cleanup, and remains separate from the now-closed Max Capacity Phase C. It must be planned and implemented separately with:

- owner-authorized human-readable slug editing, validation, availability/collision checks, and reserved words;
- Settings editing UX, rename behavior, and audit logging;
- authenticated slug-based workspace URL resolution and routing;
- redirect or alias behavior after rename;
- import/export implications and migration from UUID-derived slugs;
- enumeration resistance and explicit tests proving authentication, membership, and authorization remain independent of slug knowledge;
- re-exposing the Slug row in Settings once it carries real user-facing meaning.

Slug possession must never grant workspace access.

### Pack Publishing / Crew View / Share Links — deferred

A separate deferred product initiative, **not part of Workspace Slug Phase 2**. Not started and separate from the now-closed Max Capacity Phase C. Future scope includes:

- published load plans;
- public or authenticated viewers;
- revocable share tokens;
- checklist/crew behavior;
- permissions;
- a version strategy for published plans.

Any future share-link design must use its own dedicated token/credential — the workspace slug must never act as the access credential for shared or published content.

### Visual Quality and Rendering Performance

- Premium space/cargo representation, lighting, camera, cutaway, label, and export-quality work belongs in an isolated visual contract that cannot alter packing geometry.
- Instancing, shared resources, label atlases, quality profiles, and fixed-load performance targets require a separate evidence-based implementation packet.

### Server Persistence and Public API

- Server persistence, schema versioning, offline/sync behavior, and conflict recovery must be defined before a supported public API.
- External schemas, keys, permissions, rate limits, jobs, webhooks, usage, audit records, and viewer tokens remain future candidates.

### Business Identifiers

- Case, Pack, and instance business identifiers remain separate from internal UUIDs and physical packing signatures.
- Exact fields, uniqueness, number formats, import/search behavior, and migration policy require a dedicated product/data decision.

### Deployment and Hosting

- Cloudflare Pages, branch previews, staging, production-from-main, and rollback policy remain future candidates; automatic deployment is not asserted as current behavior.
- AWS remains deferred until a specific heavy server workload requires it.

### Platform and Operations

The following ideas should wait:

- Platform-admin schema and audit records.
- Telemetry summary tables.
- Rate-limit and abuse-control tables.
- Account purge job tracking.
- Expanded observability, reconciliation jobs, and operational dashboards without an approved incident/operations contract.

### Release Readiness and Product Decisions

- Accessibility, official browser/device support, asset rights and upload safety, backup/recovery, customer support, and production security require focused release-readiness work before broad public release.
- Final product naming, brand structure, legal seller identity, and customer-facing billing identity remain open product decisions.

The supporting [July 2026 Product Strategy Debrief](./PRODUCT-STRATEGY-DEBRIEF-2026-07.md) contains the deduplicated context for these deferred areas. It is not a parallel roadmap and does not promote them into the approved queue.

## 13. Known Gaps That Are Not Current Blockers

- Development retains legacy cases/packs, policy/function, and billing ID differences. The current grants work deliberately preserved them; audit later in a separate packet.
- Local Stage B records existing fallback behavior for stale billing-customer subscription identity and cross-organization customer/subscription conflicts. The later billing-integrity reassessment must decide whether stronger cross-table enforcement is required; Stage B deliberately changed no billing semantics.
- `docs/product/PROJECT_TREE.md` is a generated point-in-time snapshot dated 2026-07-16 and carries no active authority.
- Older audit, review, and archive documents contain duplicated or obsolete implementation context. They remain evidence, not active authority, pending the narrow cleanup batches in the documentation inventory.
- Deferred AutoPack and platform architecture may improve quality or scale later, but it does not block the current billing reliability queue.

## 14. Evidence and Reference Index

| Subject | Reference |
|---|---|
| Operational status and approved queue | This V5 document |
| Broad product direction, open decisions, and deferred candidates | [July 2026 Product Strategy Debrief](./PRODUCT-STRATEGY-DEBRIEF-2026-07.md) |
| Billing/workspace product semantics | [Billing Entitlement Rules](./BILLING_ENTITLEMENT_RULES.md) |
| Current pricing change, deployment, validation, and rollback procedures | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md) |
| Append-only pricing change evidence | [Pricing Change Log](../billing/PRICING-CHANGE-LOG.md) |
| Hosted billing fixture boundaries and commands | [Billing Fixture Safety Foundation](../dev/billing-fixtures.md) |
| Local billing fixture commands and evidence | [Local Billing Fixtures](../dev/local-billing-fixtures.md) |
| Stripe test-mode fixture commands and evidence | [Stripe Test-Mode Billing Fixtures](../dev/stripe-test-billing-fixtures.md) |
| Owner-account billing audit baseline | [P0 Owner-Only Billing Audit](../audits/P0_OWNER_ONLY_BILLING_AUDIT.md) |
| AutoPack and editor hard rules | [AutoPack Engine Contract](../engineering/autopack-engine-contract.md) |
| Detailed pre-V5 implementation and browser evidence | [Archived Master TODO V4](../archive/master-todos/TP3D-MASTER-TODO-V4.md) |
| Documentation authority classification | [Documentation Inventory — 2026-07](../archive/DOCUMENTATION-INVENTORY-2026-07.md) |

## 15. Archive Index

- [Master TODO V4](../archive/master-todos/TP3D-MASTER-TODO-V4.md) — historical implementation, validation, and status evidence through the V5 transition.
- [Master TODO V3](../archive/2026-03-old-todos/TP3D-MASTER-TODO-V3.md) — earlier operational plan.
- [Master TODO V2](../archive/2026-03-old-todos/TP3D-MASTER-TODO-V2.md) — earlier pre-production plan.
- [Documentation Inventory — 2026-07](../archive/DOCUMENTATION-INVENTORY-2026-07.md) — classification and future cleanup batches.

Archived TODOs never override V5 or current domain contracts.

## 16. Update Rules

1. Update the status snapshot and active-work row only at milestone closeout or a real blocker-state change.
2. Keep the approved queue at 5–10 items and remove completed items after recording a concise milestone link.
3. Replace stale status; do not append another status block.
4. Move detailed implementation, test, browser, deployment, and audit evidence into a dedicated topic or archive document.
5. Keep exactly one active branch, outcome, and blocker state in Section 4.
6. Do not promote deferred inventory into the queue without explicit approval and prerequisite decisions.
7. Update agent/read-first references when V5 is replaced; preserve historical references in archives.
8. Refresh Graphify after significant code changes; update generated graph artifacts only in a deliberate graph-maintenance change.
