# Truck Packer 3D Documentation Inventory — 2026-07

This is a classification snapshot, not a cleanup branch. It records the authority, lifecycle, and recommended treatment of documentation that exists at the V5 transition.

| Path | Category | Lifecycle | Current authority | Status | Recommended action | Duplicate/superseded by | Notes |
|---|---|---|---|---|---|---|---|
| `docs/README.md` | Documentation navigation | Permanent | Defines documentation authority rules | authoritative | Keep concise; update only when the authority model or taxonomy changes | — | Entry point for active documentation. |
| `docs/product/TP3D-MASTER-TODO-V5.md` | Operational status | Active | Only active task, blocker, and approved-queue authority | authoritative | Keep under the V5 document contract | — | Milestone updates only. |
| `docs/product/PRODUCT-STRATEGY-DEBRIEF-2026-07.md` | Product strategy | Active | Supporting | Active reference | Maintain at major product-strategy checkpoints | — | Not an active task list or permanent behavior contract. |
| `docs/product/BILLING_ENTITLEMENT_RULES.md` | Product contract | Permanent | Billing/workspace semantics | authoritative | Preserve the July 2026 banner; perform the focused future review below | — | Domain authority, not a mutable status report. |
| `docs/engineering/autopack-engine-contract.md` | Engineering contract | Permanent | AutoPack/editor hard rules | authoritative | Preserve; reconcile future approved strategy contracts in cleanup batch 5 | — | Domain authority, not an active queue. |
| `docs/product/SETTINGS-VISUAL-SYSTEM-CONTRACT.md` | Product/UI contract | Permanent | Settings visual behavior within its scope | authoritative | Preserve; audit overlaps in cleanup batch 3 | — | Does not override V5 operational status. |
| `docs/product/SETTINGS-WORKSPACE-GENERAL-UI-PLAN.md` | Product/UI plan | Temporary | Supporting design plan | supporting | Reassess completion and archive or narrow in cleanup batch 3 | — | May contain implementation-era status. |
| `docs/product/autopack-logic-v2.md` | AutoPack analysis | Historical | Supporting historical/current analysis | supporting | Compare with engine contract and archive obsolete portions only when proved in cleanup batch 5 | `docs/engineering/autopack-engine-contract.md` for hard rules | Do not treat the full document as current operational priority. |
| `docs/engineering/autopack-core-engine-plan.md` | AutoPack implementation plan | Historical | Historical implementation context | historical | Review completion evidence before any later archive change in cleanup batch 5 | `docs/engineering/autopack-engine-contract.md` | Plan evidence should not compete with the contract. |
| `docs/product/truckpacker-comparison-v1-2026-04-19.md` | Product research | Historical | Supporting competitive evidence | supporting | Retain; date and scope remain explicit | — | Product input, not approval. |
| `docs/product/truckpacker-blackbox-audit-2026-05-24.md` | Product research/audit | Historical | Supporting evidence | supporting | Retain with its dated evidence set | — | Cleanup batch 5. |
| `docs/product/truckpacker-reference-autopack-audit-2026-05-24.md` | AutoPack research/audit | Historical | Supporting evidence | supporting | Retain with screenshots; review links in cleanup batch 5 | — | Does not approve implementation. |
| `docs/product/audit-screenshots/**` | Visual evidence | Historical | Supporting dated evidence | supporting | Retain; verify ownership and index later | Related dated AutoPack audits | Cleanup batch 4 or 5. |
| `docs/product/PROJECT_TREE.md` | Repository snapshot | Generated | No active authority | incomplete | Regenerate from FileTree Pro after approved snapshot milestones; do not hand-edit paths | Current repository tree | Generated 2026-07-16; point-in-time reference only. |
| `docs/product/TP3D_Clean_Feature_Tracker.xlsx` | Product tracker | Temporary | Unconfirmed parallel tracker | unclear | Audit ownership and overlap in cleanup batch 3 | `docs/product/TP3D-MASTER-TODO-V5.md` for operations | Must not become a second mutable status authority. |
| `docs/dev/billing-fixtures.md` | Developer operations/contract | Active | Fixture safety and staged implementation boundaries | authoritative | Maintain with each fixture milestone | — | The no-write foundation is complete; Stage B is unblocked but incomplete. |
| `docs/dev/billing-status-curl.md` | Developer runbook | Active | Supporting command reference | supporting | Verify against deployed API and consolidate only if duplication is proved | — | Cleanup batch 2. |
| `docs/dev/billing-status-setup.md` | Developer setup | Active | Supporting setup reference | supporting | Audit current environment assumptions | — | Cleanup batch 2. |
| `docs/dev/local-supabase-setup.md` | Developer setup | Active | Supporting local setup reference | supporting | Verify all 25 migrations and current reset flow | — | Cleanup batch 2. |
| `docs/dev/stripe-functions-secrets-checklist.md` | Developer operations | Active | Supporting secrets checklist | supporting | Audit against current functions and secret names | — | Cleanup batch 2; never add secret values. |
| `docs/audits/P0_OWNER_ONLY_BILLING_AUDIT.md` | Billing audit | Historical | Dated supporting evidence | supporting | Retain; link newer focused evidence rather than rewriting history | Billing Entitlement Rules for semantics | Cleanup batch 4. |
| `docs/audits/qa-billing-entitlement-2026-05-04.md` | Billing QA evidence | Historical | Dated supporting evidence | historical | Preserve and mark superseded assertions only when proved during cleanup batch 4 | Newer billing evidence and V5 status | Do not update old pass totals. |
| `docs/audits/*.md` | Audits and implementation evidence | Historical | Dated evidence within stated scope | supporting | Inventory individually in cleanup batch 4 | Current contracts/V5 where conflicts exist | Preserve exact historical results. |
| `docs/review/README.md` | Review-area navigation | Permanent | Defines non-authoritative review status | authoritative | Keep the review warning explicit | — | Authority applies only to folder handling. |
| `docs/review/*.md` | Pending review material | Temporary | No authority until accepted | unclear | Triage one topic at a time in cleanup batches 2–5 | Accepted product/dev/audit documents | Do not bulk-promote. |
| `docs/archive/master-todos/TP3D-MASTER-TODO-V4.md` | Archived operational plan/evidence | Historical | Historical only | superseded | Preserve body unchanged under archival banner | `docs/product/TP3D-MASTER-TODO-V5.md` | Detailed evidence remains linkable. |
| `docs/archive/2026-03-old-todos/TP3D-MASTER-TODO-V2.md` | Archived operational plan | Historical | Historical only | superseded | Preserve | V3, V4, then V5 | No current implementation authority. |
| `docs/archive/2026-03-old-todos/TP3D-MASTER-TODO-V3.md` | Archived operational plan | Historical | Historical only | superseded | Preserve | V4, then V5 | No current implementation authority. |
| `docs/archive/2026-01-cleanup-docs/**` | Archived cleanup material | Historical | Historical only | historical | Preserve; reorganize only in cleanup batch 6 | Current repository/docs state | Includes dated reports and scripts. |
| `docs/archive/2026-02-autopack/**` | Archived AutoPack plan | Historical | Historical only | superseded | Preserve | Current AutoPack contract and V5 | Cleanup batch 6 may add an index. |
| `docs/archive/2026-02-phase1/**` | Archived migration plan | Historical | Historical only | historical | Preserve | Current runtime and migrations | Root README already treats it as historical. |
| `docs/archive/2026-02-supabase-stripe/**` | Archived SQL/setup notes | Historical | Historical only | superseded | Preserve; never execute as current migration guidance | Current migrations and billing docs | Cleanup batch 6. |
| `docs/tp3d-pack-and-cases-upload-tests/**` | Manual test fixtures/data | Active | Supporting test evidence | supporting | Retain; document canonical owner and validation flow later | — | Cleanup batch 4. |

## Naming Glossary

| Name | Meaning |
|---|---|
| Contract | Permanent approved behavior. |
| Plan | Proposed future work. |
| Audit | Examined evidence and findings. |
| Report | Observed results. |
| Checklist | Verification steps. |
| Runbook | Operational procedure. |
| Status | Current state at a stated date. |
| Summary | Condensed reference. |

## Recommended Narrow Cleanup Batches

1. Agent instructions and skills: remove duplicated startup guidance while keeping one compatible rule set per tool.
2. Billing documentation: reconcile setup, fixture, current-state, and secrets references without changing billing behavior.
3. Product contracts: confirm authority boundaries and remove parallel mutable status.
4. Audits and implementation evidence: add dates/indexes and archive only genuinely superseded reports.
5. AutoPack documentation: separate permanent hard rules, approved strategy work, research, and historical implementation plans.
6. Archive organization: add indexes and regenerate derived tree/navigation artifacts without rewriting historical bodies.

Each batch should be a separate, reviewable documentation change. None is active work in V5.

## Focused Future Reviews

### Billing Contract Review

Perform a focused future review of `docs/product/BILLING_ENTITLEMENT_RULES.md` to distinguish permanent approved behavior from historical first-migration guidance. Compare the July 2026 clarification against current billing implementation and evidence before changing the contract body. This is a documentation cleanup item, not active implementation work and not a blocker for local billing fixture Stage B.

### Possible Project Contract

Do not create `docs/product/PROJECT-CONTRACT.md` without a separate read-only documentation-architecture review. That review should evaluate whether a concise project constitution should cover product purpose, users, permanent product principles, AutoPack philosophy, UI principles, release philosophy, business direction, and documentation hierarchy.

Before proposing another authoritative file, compare possible content against:

- `docs/product/TP3D-MASTER-TODO-V5.md`
- `docs/product/BILLING_ENTITLEMENT_RULES.md`
- `docs/engineering/autopack-engine-contract.md`
- `AGENTS.md` and `CLAUDE.md`
- root `README.md`

The goal is to prevent duplication. The recommended future authority chain, pending that review, is:

```text
PROJECT-CONTRACT
    ↓
MASTER TODO V5
    ↓
Domain contracts
    ↓
Plans and runbooks
    ↓
Audits and reports
```

This is a future documentation-architecture review, not active work and not a blocker for billing fixtures.
