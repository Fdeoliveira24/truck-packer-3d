# Truck Packer 3D — Master TODO V5

**Last updated:** 2026-07-17

**Last verified repository state:** Server-side workspace-limit Packet 2 completed locally and in development; workspace-slug Phase 1 remains before Max Capacity Phase C

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
12. Max Capacity Phase C remains blocked until billing reliability work is explicitly closed.

## 2. Current Status Snapshot

This table is the single mutable status snapshot in V5.

| Area | Status at the last verified repository state |
|---|---|
| Repository | Packet 2 completed from the clean `80ce09b` baseline on `fix/server-workspace-limit-enforcement`; local, deployed-development, and Stripe test-mode fixture milestones remain complete. |
| Supabase Data API grants | Complete, merged, pushed, and applied to development. |
| Workspace/membership write boundary | Complete. Authenticated clients retain RLS-filtered organization/membership reads and legitimate organization updates, but cannot directly insert organizations or mutate memberships; approved signup and server-controlled creation remain functional. |
| Server-side workspace creation limit | Complete. `org-create-workspace` supplies the trusted catalog limits to a service-role-only transaction that locks the actor profile, resolves the canonical owner entitlement, counts every owned workspace including archived rows, fails closed on unsafe/unavailable billing identity, and rejects at the effective limit. |
| Workspace slug | Phase 1 integrity is required after the write boundary and server limit: backfill/normalize, non-null, case-insensitive uniqueness, controlled mutation, and valid UUID-derived creation. Phase 2 friendly slugs remain separate required product work. |
| Clean local database | All 29 migrations reset successfully. |
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
| Platform-foundation reliability | Open only for the workspace-slug Phase 1 integrity foundation and its local/development validation. |
| Max Capacity Phase C | Blocked and not started. |
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
| Task | Implement the Phase 1 workspace-slug integrity foundation. |
| Branch | Not created; create one narrowly scoped slug-integrity branch from the Packet 2 main baseline. |
| Outcome | Backfill and normalize existing slugs, enforce non-null case-insensitive uniqueness and the bounded internal format, preserve UUID-derived server creation, and block uncontrolled slug mutation without treating slug knowledge as authorization. |
| Blocker state | Unblocked after Packet 2 and next in dependency order. |
| Scope boundary | Workspace-slug Phase 1 integrity only. Do not combine friendly-slug Phase 2 UX/routing, commercial billing, Stripe, AutoPack, Max Capacity Phase C, or unrelated workspace behavior. |
| Closeout | Prove migration convergence, controlled mutation, creation compatibility, lookup non-authority, and local/development workspace/billing regressions before closing platform-foundation reliability. |

Only this row is active. The following section is an approved sequence, not simultaneous work.

## 5. Next Approved Execution Queue

1. Implement the Phase 1 workspace-slug integrity foundation.
2. Re-run the required clean-local and deployed-development workspace/billing validation after the slug packet lands.
3. Explicitly close platform-foundation reliability.
4. Resume Max Capacity Phase C only after that closeout.
5. Keep the Phase 2 friendly workspace-slug capability in the approved future product roadmap; plan and implement it separately from Phase 1 integrity.

Queue order is approval order. Start one branch at a time and record its active branch, outcome, and blocker state in Section 4.

## 6. Current Blockers

- Workspace slugs remain nullable, unconstrained, and directly writable until the Phase 1 integrity packet lands.
- Commercial pricing is not final; later fixture work must not invent future commercial terms.
- Max Capacity Phase C is blocked by the remaining platform-foundation slug closeout gate. It has no approved active branch and must not start early.

## 7. Recently Completed Milestones

| Milestone | Concise result | Evidence |
|---|---|---|
| Server-side workspace-limit enforcement — Packet 2 | Migration `20260717142844_enforce_server_workspace_limits.sql` replaces the user-creation RPC with a service-role-only catalog-aware transaction. It locks the actor profile before entitlement resolution/count/insert, counts all canonical owner workspaces including archived rows, preserves trial/Business/Pro-fallback and payment-grace limits, rejects unsafe or unavailable billing identity, and returns stable sanitized Edge codes. Clean 29-migration reset passed; workspace security was 9/9, local billing 39/39, fixture safety 34/34, security 887 passed/5 skipped, and the full suite 1,047 passed/5 skipped. Development applied only the migration and `org-create-workspace`; 38/38 deployed checks proved below/at-limit behavior, one-winner same-owner concurrency, archived counting, and fail-closed identity, followed by exact cleanup of 54 tracked objects with zero collateral differences. | [migration](../../supabase/migrations/20260717142844_enforce_server_workspace_limits.sql), [Edge Function](../../supabase/functions/org-create-workspace/index.ts), `tests/local-db/workspace-membership-security.spec.mjs`, `tests/integration/dev-billing/deployed-functions.spec.mjs` |
| Direct organization INSERT boundary — Packet 1 | Migration `20260717135117_restrict_direct_organization_inserts.sql` revoked authenticated organization INSERT and removed `organizations_insert_owner_self` without changing SELECT, UPDATE, slug, limit, billing, archive, deletion, or ownership semantics. Clean 28-migration reset passed; targeted security was 1/1, local billing 39/39, fixture safety 34/34, security 885 passed/5 skipped, and the full suite 1,045 passed/5 skipped. Development returned `403/42501` for direct INSERT with zero residue, while signup, server creation, canonical owner/membership/billing state, SELECT, and descriptive UPDATE passed; exact cleanup and collateral fingerprints were clean. | [migration](../../supabase/migrations/20260717135117_restrict_direct_organization_inserts.sql), `tests/local-db/workspace-membership-security.spec.mjs` |
| Platform-foundation reliability reconciliation | Reassessment confirmed the authenticated `organizations` INSERT boundary and slug integrity gaps, and classified server-side workspace-limit enforcement as missing. The creation Edge/RPC path contains no billing/count/lock check, and the local security flow currently proves a trial owner can create multiple additional workspaces directly. BUG-02 and BUG-03 are proven resolved by current runtime/local tests, authenticated paid-workspace evidence, and Stripe S2 Portal proof. Obsolete clean worktrees/branches with no needed unique evidence were removed. | `supabase/functions/org-create-workspace/index.ts`, `supabase/migrations/20260716061516_server_controlled_workspace_creation.sql`, `tests/local-db/workspace-membership-security.spec.mjs`, [archived authenticated billing evidence](../archive/2026-03-old-todos/TP3D-MASTER-TODO-V3.md) |
| Stripe test-mode fixtures | S1 proved the deployed webhook accepts Stripe-signed events with the seven required destination events and no probe residue. S2 proved one disposable direct-monthly Customer/Subscription lifecycle, active billing status, Portal access, signed cancellation, and entitlement revocation. S3 proved sanitized missing/invalid-signature rejection and idempotent signed replay. Exact cleanup was repeatable, with no Supabase or Stripe collateral fingerprint change; fixture safety was 50/50, local billing remained 39/39, and the repository audit was 1,050 total, 1,045 passed, 5 skipped, 0 failed. | [Stripe fixture operator guide](../dev/stripe-test-billing-fixtures.md), [shared fixture boundary](../dev/billing-fixtures.md) |
| Deployed development-function fixtures | A production-refusing hosted-development harness now proves disposable auth/workspace/billing projections, deployed Edge paths, PostgREST/RLS, authorization, invitations, ownership, archive/restore, malformed/omitted organization handling, safe pre-Stripe rejection, exact-ID cleanup, and zero collateral fingerprint changes. D1 safety was 34/34; final D2 was 32/32 executable tests covering the required 40-scenario matrix plus omission and sibling regressions; the repository audit was 1,050 total, 1,045 passed, 5 skipped, 0 failed. | [Deployed fixture operator guide](../dev/deployed-development-billing-fixtures.md), [shared fixture boundary](../dev/billing-fixtures.md) |
| Malformed billing-status organization ID | Supplied non-empty malformed `organization_id`/`org_id` values now return sanitized 400 after authentication but before profile fallback, service-role database reads, billing lookup, or Stripe use. Omission and explicit empty values retain the existing profile fallback; valid organization authorization and F12 behavior are unchanged. | `supabase/functions/billing-status/index.ts`, `tests/audit/security-and-invariants.spec.mjs` |
| Unknown/replaced Price handling | Active checkout and recognition-only legacy Price sets are separate. Known legacy Prices preserve tier/limit without new checkout; usable explicitly mapped unknown Prices retain conservative fallback and emit a masked `unknownPriceId` diagnostic. Local Stage B stayed 39/39 with zero residuals; repository gates and limited development deployment/smoke passed. | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md), `supabase/functions/_shared/billing-catalog.ts`, `supabase/functions/billing-status/index.ts` |
| Behavior-preserving billing catalog | One lazy, pure shared server catalog now owns configured Pro/Business Price IDs, interval resolution, checkout eligibility, and Trial/Pro/Business workspace limits. Billing-status exact Business matching, restore's broader Business matching, Pro-only checkout, and unknown-active paid fallback remain unchanged; local Stage B, repository gates, and limited development deployment/smoke passed. | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md), `supabase/functions/_shared/billing-catalog.ts` |
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

The evidence-based reassessment is complete. Local, deployed-development, and Stripe test-mode fixtures, the catalog/runbook, unknown/replaced-Price behavior, Billing QA BUG-02/BUG-03, and Packets 1–2 are closed. The phase now closes only after Packet 3 passes local and deployed-development validation.

### ✅ Packet 2 — Server-side workspace-limit enforcement — complete 2026-07-17

- The service-role-only RPC locks the actor's profile row before resolving the canonical owner billing projection, counting, comparing, or inserting; unrelated owners retain independent lock rows.
- All actor-owned workspaces count, including archived workspaces. Trial uses the catalog Trial limit; recognized Business uses the catalog Business limit; usable known/unknown Pro-family and grace projections preserve the current Pro fallback; unavailable or ambiguous identity fails closed.
- Signup remains on its separate server-owned bootstrap trigger, while user-initiated creation returns stable sanitized limit, unsafe-identity, unavailable-entitlement, invalid-request, unauthorized, and internal-failure codes.
- Local and deployed-development concurrency both proved exactly one success and one limit rejection with one slot remaining and no partial organization, membership, billing, or trial residue.

### Packet 3 — Workspace slug Phase 1 integrity foundation

- Land only after Packet 2 so the migration converges and the approved dependency order remains intact.
- Backfill null/blank and safely normalize malformed or colliding legacy values with the existing UUID-derived convention.
- Enforce non-null, case-insensitive uniqueness, a bounded valid internal format, approved creation-time generation, and server-controlled mutation; Settings may remain read-only.
- Prove slug lookup never grants access and membership/authorization remains authoritative.
- Expected scope: one integrity migration, the narrow organization-update guard required to block uncontrolled slug mutation, and focused local/development tests.

### Historical billing bug dispositions

- **BUG-02 — proven resolved:** current production-handler/local billing tests retain `month`/`year` and `currentPeriodEnd` for directly paid workspaces, configured and recognized legacy Prices recover interval metadata, and the authenticated paid-workspace matrix returned usable interval and renewal values.
- **BUG-03 — proven resolved:** `billing-status` derives `portalAvailable` from the requested organization's known Stripe Customer and propagates owner coverage safely; the authenticated test2/test4 evidence returned `portalAvailable: true`, and Stripe S2 opened an exact organization-scoped test-mode Portal session.
- Old warning labels remain historical evidence in archived TODO files only. They do not create active implementation work.

The foundation must preserve [Billing Entitlement Rules](./BILLING_ENTITLEMENT_RULES.md), [Billing Fixture Safety](../dev/billing-fixtures.md), direct-first F12 identity, fail-closed ambiguity, owner-only money actions, and production-data refusal. It does not authorize a broad billing schema migration or any next-generation billing design in Section 12.

## 10. AutoPack and Editor Status

The stable AutoPack/editor baseline includes the solution portfolio, Max Capacity Phase A, durable per-instance Phase B metadata, editor operation lifecycle guards, manual placement safety, organized Unpack polish, and the existing Wheel Wells and Front Overhang hard-rule contracts. Detailed milestone reports remain in [archived V4](../archive/master-todos/TP3D-MASTER-TODO-V4.md).

Phase C is a small reporting follow-up only: report how many applied cases use relaxed handling rules, without UI redesign or legal, axle, or DOT claims. Its implementation remains blocked by Section 6.

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

### Required Workspace Slug Product Phase

After the Phase 1 integrity foundation, the full friendly workspace-slug feature remains required product work, not optional metadata cleanup. It must be planned and implemented separately with:

- owner-authorized human-readable slug editing, validation, availability/collision checks, and reserved words;
- Settings editing UX, rename behavior, and audit logging;
- authenticated slug-based workspace URL resolution and routing;
- approved share-link strategy without treating the slug as a bearer secret;
- redirect or alias behavior after rename;
- import/export implications and migration from UUID-derived slugs;
- enumeration resistance and explicit tests proving authentication, membership, and authorization remain independent of slug knowledge.

Slug possession must never grant workspace access.

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
