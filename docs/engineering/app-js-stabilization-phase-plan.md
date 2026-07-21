# App.js Stabilization Phase Plan

**Date:** 2026-07-21
**Baseline:** `eaf5295`
**Purpose:** Remove confirmed production defects while preserving the current application architecture.

## Scope lock

This stabilization phase permits only:

- the eight confirmed defects in `app-js-production-defect-audit.md`;
- the smallest supporting regression tests; and
- the three required planning documents.

It explicitly excludes module extraction, large code movement, system redesign, folder
reorganization, naming cleanup, warning cleanup, dead-code removal, UI redesign, entitlement
changes, solver changes, and unrelated refactoring.

## Sources of truth

- `docs/product/TP3D-MASTER-TODO-V5.md` controls repository operational context.
- `docs/product/BILLING_ENTITLEMENT_RULES.md` controls billing and entitlement semantics.
- `docs/engineering/autopack-engine-contract.md` controls AutoPack and editor-operation behavior.
- `AGENTS.md` controls scope, safety, validation, and workspace-switch requirements.
- `app-js-production-defect-audit.md` is the defect manifest for this phase.
- `app-js-production-defect-fix-plan.md` is the implementation and verification sequence.

The explicit 2026-07-21 stabilization request authorizes this defect pass ahead of modularization.
It does not authorize modularization itself.

## Branch and dependency sequence

| Order | Branch | Permitted changes | Parent |
|---:|---|---|---|
| 0 | `chore/app-js-production-defect-plans` | Three planning documents only | `eaf5295` |
| 1 | `fix/app-js-data-integrity-boundaries` | DEF-001, DEF-002, DEF-003 and focused tests | Documentation branch |
| 2 | `fix/app-js-cross-tab-reliability` | DEF-004, DEF-007 and focused tests | Phase 1 |
| 3 | `fix/app-js-operation-lifecycle-guards` | DEF-005 and focused tests | Phase 2 |
| 4 | `fix/app-js-auth-reliability` | DEF-006, DEF-008 and focused tests | Phase 3 |

The branches are stacked so each review can compare against its direct parent while the final branch
contains the complete stabilization milestone. Each branch receives one intentionally scoped commit
and is pushed before the next branch starts.

## Phase controls

Before each implementation phase:

1. confirm the source mechanism is unchanged from the audit;
2. identify the exact existing owner and call sites;
3. identify focused tests that can exercise the failure; and
4. confirm the branch diff contains only prior verified phases.

Before advancing to the next branch:

1. run the phase's focused regression tests;
2. run related existing invariant tests;
3. run typecheck/lint where relevant;
4. inspect `git diff --check` and the staged diff;
5. commit with the approved message; and
6. push the branch.

## Risk controls

### Data boundaries

- Flush old-scope persistence before changing scope or replacing state.
- Reset history only at explicit identity/workspace boundaries.
- Never remove legacy data before a verified replacement exists.

### Workspace and billing boundaries

- Preserve same-user and wrong-user guards.
- Preserve active-org versus billing-org reconciliation.
- Preserve authoritative backend entitlement truth.
- Keep retries bounded and cancellable by normal shared results.

### Operation boundaries

- Reuse the single existing lifecycle.
- Block mutation, not navigation or read-only inspection.
- Do not alter AutoPack geometry, solver behavior, animation, or persistence semantics.

### Auth boundaries

- Preserve canonical Supabase local cleanup and cross-tab logout behavior.
- Never log or display invite tokens.
- Keep terminal invite rejection distinct from retryable infrastructure failure.
- Replace forced reload recovery with deterministic existing cleanup, not with a new auth flow.

## Validation boundary

This execution uses focused automated verification per defect and one full repository pass after all
phases. Authenticated multi-account browser QA is deferred only when credentials are unavailable and
must remain documented as an outstanding release check.

Minimum final manual matrix:

- same-scope undo/redo;
- A→B workspace switch followed by Undo/Redo;
- last-moment edit followed by workspace switch and logout;
- legacy combined-storage startup and authenticated migration;
- fresh-tab switch received by an established tab;
- billing lock owner tab closed before result publication;
- Packs/Cases mutations attempted during AutoPack, with navigation still usable;
- invite success, terminal rejection, and transient failure;
- user-initiated and cross-tab logout without forced reload;
- AutoPack/PDF/Settings Billing remain scoped to the active workspace.

## Completion gate

The stabilization milestone is complete when:

- every confirmed trigger has focused regression coverage;
- all phase and final validation gates pass;
- no confirmed production defect in this manifest remains open;
- residual authenticated/browser risks are explicitly recorded; and
- Graphify reflects the changed source.

Only after that milestone may a separate readiness audit decide whether an App.js modularization
execution plan can begin.
