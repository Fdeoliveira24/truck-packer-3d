# Truck Packer 3D Documentation Inventory — 2026-07

This is a classification snapshot, not a cleanup branch. It records the authority and recommended treatment of documentation that exists at the V5 transition.

| Path | Category | Current authority | Status | Recommended action | Duplicate/superseded by | Notes |
|---|---|---|---|---|---|---|
| `docs/README.md` | Documentation navigation | Defines folder precedence | authoritative | Keep concise; update only when taxonomy changes | — | Entry point for active docs; cleanup batch 6 may refine archive links. |
| `docs/product/TP3D-MASTER-TODO-V5.md` | Operational plan | Only active status, blocker, and approved-queue authority | authoritative | Keep under the V5 document contract | — | Milestone updates only. |
| `docs/product/BILLING_ENTITLEMENT_RULES.md` | Product contract | Billing/workspace semantics | authoritative | Preserve; audit wording in cleanup batch 3 | — | Domain authority, not a mutable status report. |
| `docs/engineering/autopack-engine-contract.md` | Engineering contract | AutoPack/editor hard rules | authoritative | Preserve; reconcile future approved strategy contracts in cleanup batch 5 | — | Domain authority, not an active queue. |
| `docs/product/SETTINGS-VISUAL-SYSTEM-CONTRACT.md` | Product/UI contract | Settings visual behavior within its scope | authoritative | Preserve; audit overlaps in cleanup batch 3 | — | Does not override V5 operational status. |
| `docs/product/SETTINGS-WORKSPACE-GENERAL-UI-PLAN.md` | Product/UI plan | Supporting design plan | supporting | Reassess completion and archive or narrow in cleanup batch 3 | — | May contain implementation-era status. |
| `docs/product/autopack-logic-v2.md` | AutoPack analysis | Supporting historical/current analysis | supporting | Compare with engine contract and archive obsolete portions in cleanup batch 5 | `docs/engineering/autopack-engine-contract.md` for hard rules | Do not treat the full document as current operational priority. |
| `docs/engineering/autopack-core-engine-plan.md` | AutoPack implementation plan | Historical implementation context | historical | Archive or mark complete in cleanup batch 5 | `docs/engineering/autopack-engine-contract.md` | Plan evidence should not compete with the contract. |
| `docs/product/truckpacker-comparison-v1-2026-04-19.md` | Product research | Supporting competitive evidence | supporting | Retain; date and scope remain explicit | — | Product input, not approval. |
| `docs/product/truckpacker-blackbox-audit-2026-05-24.md` | Product research/audit | Supporting evidence | supporting | Retain with its dated evidence set | — | Cleanup batch 5. |
| `docs/product/truckpacker-reference-autopack-audit-2026-05-24.md` | AutoPack research/audit | Supporting evidence | supporting | Retain with screenshots; review links in cleanup batch 5 | — | Does not approve implementation. |
| `docs/product/audit-screenshots/**` | Visual evidence | Supporting dated evidence | supporting | Retain; verify ownership and index later | Related dated AutoPack audits | Cleanup batch 4 or 5. |
| `docs/product/PROJECT_TREE.md` | Generated repository snapshot | No active authority | incomplete | Regenerate deliberately after V5; do not hand-edit | Current repository tree | Generated 2026-07-11 and contains pre-V5 paths. |
| `docs/product/TP3D_Clean_Feature_Tracker.xlsx` | Product tracker | Unconfirmed parallel tracker | unclear | Audit ownership and overlap in cleanup batch 3 | `docs/product/TP3D-MASTER-TODO-V5.md` for operations | Must not become a second mutable status authority. |
| `docs/dev/billing-fixtures.md` | Developer operations/contract | Fixture safety and staged implementation boundaries | authoritative | Maintain with each fixture milestone | — | Cleanup batch 2 should keep commands aligned. |
| `docs/dev/billing-status-curl.md` | Developer runbook | Supporting command reference | supporting | Verify against deployed API and consolidate if duplicated | — | Cleanup batch 2. |
| `docs/dev/billing-status-setup.md` | Developer setup | Supporting setup reference | supporting | Audit current environment assumptions | — | Cleanup batch 2. |
| `docs/dev/local-supabase-setup.md` | Developer setup | Supporting local setup reference | supporting | Verify all 25 migrations and current reset flow | — | Cleanup batch 2. |
| `docs/dev/stripe-functions-secrets-checklist.md` | Developer operations | Supporting secrets checklist | supporting | Audit against current functions and secret names | — | Cleanup batch 2; never add secret values. |
| `docs/audits/P0_OWNER_ONLY_BILLING_AUDIT.md` | Billing audit | Dated supporting evidence | supporting | Retain; link newer focused evidence rather than rewriting history | Billing Entitlement Rules for semantics | Cleanup batch 4. |
| `docs/audits/qa-billing-entitlement-2026-05-04.md` | Billing QA evidence | Dated supporting evidence | historical | Preserve and mark superseded assertions during cleanup batch 4 | Newer billing evidence and V5 status | Do not update old pass totals. |
| `docs/audits/*.md` | Audits and implementation evidence | Dated evidence within stated scope | supporting | Inventory individually in cleanup batch 4 | Current contracts/V5 where conflicts exist | Preserve exact historical results. |
| `docs/review/README.md` | Review-area navigation | Defines non-authoritative review status | authoritative | Keep the review warning explicit | — | Authority applies only to folder handling. |
| `docs/review/*.md` | Pending review material | No authority until accepted | unclear | Triage one topic at a time in cleanup batches 2–5 | Accepted product/dev/audit documents | Do not bulk-promote. |
| `docs/archive/master-todos/TP3D-MASTER-TODO-V4.md` | Archived operational plan/evidence | Historical only | superseded | Preserve body unchanged under archival banner | `docs/product/TP3D-MASTER-TODO-V5.md` | Detailed evidence remains linkable. |
| `docs/archive/2026-03-old-todos/TP3D-MASTER-TODO-V2.md` | Archived operational plan | Historical only | superseded | Preserve | V3, V4, then V5 | No current implementation authority. |
| `docs/archive/2026-03-old-todos/TP3D-MASTER-TODO-V3.md` | Archived operational plan | Historical only | superseded | Preserve | V4, then V5 | No current implementation authority. |
| `docs/archive/2026-01-cleanup-docs/**` | Archived cleanup material | Historical only | historical | Preserve; reorganize only in cleanup batch 6 | Current repository/docs state | Includes obsolete reports and scripts. |
| `docs/archive/2026-02-autopack/**` | Archived AutoPack plan | Historical only | superseded | Preserve | Current AutoPack contract and V5 | Cleanup batch 6 may add an index. |
| `docs/archive/2026-02-phase1/**` | Archived migration plan | Historical only | historical | Preserve | Current runtime and migrations | Root README already treats it as historical. |
| `docs/archive/2026-02-supabase-stripe/**` | Archived SQL/setup notes | Historical only | superseded | Preserve; never execute as current migration guidance | Current migrations and billing docs | Cleanup batch 6. |
| `docs/tp3d-pack-and-cases-upload-tests/**` | Manual test fixtures/data | Supporting test evidence | supporting | Retain; document canonical owner and validation flow later | — | Cleanup batch 4. |

## Recommended Narrow Cleanup Batches

1. Agent instructions and skills: remove duplicated startup guidance while keeping one compatible rule set per tool.
2. Billing documentation: reconcile setup, fixture, current-state, and secrets references without changing billing behavior.
3. Product contracts: confirm authority boundaries and remove parallel mutable status.
4. Audits and implementation evidence: add dates/indexes and archive only genuinely superseded reports.
5. AutoPack documentation: separate permanent hard rules, approved strategy work, research, and historical implementation plans.
6. Archive organization: add indexes and regenerate derived tree/navigation artifacts without rewriting historical bodies.

Each batch should be a separate, reviewable documentation change. None is active work in V5.
