# Truck Packer 3D — Master TODO V5

**Last updated:** 2026-07-16

**Last verified repository state:** current-state pricing operations documentation reviewed from source on `docs/billing-pricing-operations-runbook`, based on matching `main`/`origin/main` at `66218ea4af8d50aecb137c365a15c083d27d4c0c`

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
| Repository | Pricing operations documentation was reviewed from current source on `docs/billing-pricing-operations-runbook`, based on matching `main`/`origin/main` at `66218ea4af8d50aecb137c365a15c083d27d4c0c`. Confirm the current git state before editing. |
| Supabase Data API grants | Complete, merged, pushed, and applied to development. |
| Workspace/membership write boundary | Complete, merged, pushed, and applied to development. Workspace creation is transactional and server-controlled; authenticated membership access is SELECT-only. |
| Clean local database | All 27 migrations reset successfully. |
| Edge smoke | Local and development workspace creation, direct membership denial, invite, role, remove, leave, transfer, and ownership restoration passed. |
| Local billing fixture Stage B | Complete. Clean 27-migration reset, local environment/grant verification, 39/39 local integration checks, exact cleanup, and full repository gates passed. |
| Billing fixture safety foundation | Complete. The existing layer remains no-write, environment-bound, masked, and production-refusing. |
| Direct-paid F12 identity | Complete and deployed. Requested-workspace direct identity precedes sibling owner-plan coverage. |
| Pricing | Not commercially finalized. |
| Normalized billing catalog | Complete, behavior-preserving, validated locally and in development, and awaiting this branch's final merge/push. |
| Pricing operations runbook | Complete and updated for the implemented catalog. It records current implementation, safe change procedures, reduced deployment scope, rollback limits, and unresolved commercial decisions without changing behavior. |
| Unknown or replaced price handling | Not yet audited or implemented. |
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
| Task | Audit and implement unknown or replaced Price handling. |
| Branch | `fix/billing-unknown-replaced-price-handling` |
| Outcome | Define explicit, testable handling and diagnostics for active subscriptions whose Price is unknown or has been replaced, while preserving approved paid access and avoiding invented legacy or commercial policy. |
| Blocker state | Unblocked. |
| Scope boundary | Start from the catalog's current behavior and audit real configured/replaced Price states before changing semantics. No commercial Price decision, subscriber migration, frontend pricing redesign, broad billing schema change, or Phase C work. |
| Closeout | Record an explicit unknown/replaced-Price contract, implement only the approved behavior, and prove direct, sibling, restore, checkout, webhook/portal compatibility, local fixtures, and development behavior. |

Only this row is active. The following section is an approved sequence, not simultaneous work.

## 5. Next Approved Execution Queue

1. Audit and implement unknown or replaced Price handling.
2. Add deployed development-function smoke fixtures.
3. Add Stripe test-mode fixtures.
4. Reassess remaining billing reliability gates.
5. Resume Max Capacity Phase C only after billing reliability is closed.

Queue order is approval order. Start one branch at a time and record its active branch, outcome, and blocker state in Section 4.

## 6. Current Blockers

- Billing reliability cannot close until the remaining queue gates are implemented, evidenced, and explicitly reassessed.
- Commercial pricing is not final; unknown/replaced-Price handling and later fixture work must not invent future commercial terms.
- Exact external billing combinations remain unavailable until durable development and Stripe test-mode fixtures exist.
- Max Capacity Phase C is blocked by the billing reliability closeout gate. It has no approved active branch and must not start early.

## 7. Recently Completed Milestones

| Milestone | Concise result | Evidence |
|---|---|---|
| Behavior-preserving billing catalog | One lazy, pure shared server catalog now owns configured Pro/Business Price IDs, interval resolution, checkout eligibility, and Trial/Pro/Business workspace limits. Billing-status exact Business matching, restore's broader Business matching, Pro-only checkout, and unknown-active paid fallback remain unchanged; local Stage B, repository gates, and limited development deployment/smoke passed. | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md), `supabase/functions/_shared/billing-catalog.ts` |
| Pricing operations runbook | Current catalog authority, caller-specific recognition rules, safe change procedures, environment risks, validation/deployment matrices, rollback limits, grandfathering default, emergency checkout stop, and unresolved commercial decisions are documented without changing runtime or Stripe state. | [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md), [Pricing Change Log](../billing/PRICING-CHANGE-LOG.md) |
| Local billing fixture Stage B | A localhost-only harness now runs the real local billing/ownership Edge paths, ownership RPC, authenticated RLS, and raw constraint probes. Clean 27-migration reset, 39/39 local checks, exact-ID cleanup, and repository gates passed without remote Supabase or Stripe access. | [Local fixture operator guide](../dev/local-billing-fixtures.md), [shared fixture boundary](../dev/billing-fixtures.md) |
| Server-controlled workspace creation and membership writes | Workspace creation now uses one authenticated Edge call and one service-role-only transaction; authenticated direct membership DML is revoked while approved Edge/RPC paths remain functional. Local and development proof passed with exact fixture cleanup. | [Edge Function](../../supabase/functions/org-create-workspace/index.ts), [creation transaction](../../supabase/migrations/20260716061516_server_controlled_workspace_creation.sql), [membership privileges](../../supabase/migrations/20260716061518_restrict_direct_membership_mutations.sql) |
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
- Workspace creation uses the dedicated authenticated server path and one atomic database transaction.
- Authenticated clients may read memberships through RLS but cannot directly insert, update, or delete membership rows.
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

The phase closes only when the remaining reliability queue items 1–4 have either passed or received an explicit, evidenced disposition. Local fixtures, the behavior-preserving catalog, and the catalog-aware pricing runbook are complete. Closure still requires defined unknown/replaced-Price behavior, deployed-development smoke fixtures, Stripe test-mode fixtures, and a final gate reassessment.

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
