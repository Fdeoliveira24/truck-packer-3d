# App.js Stabilization and Modularization Preparation Plan

**Status:** Active — controlling document for the remaining preparation phases

**Date:** 2026-07-21

**Primary runtime:** `src/app.js`

**Milestone:** Establish the evidence required before an App.js Modularization Master Execution Plan may be written

## Purpose and authority

This document is the official bridge between the completed App.js production-defect stabilization
work and any future modularization planning. It controls the next preparation branches. It does not
authorize extraction, code movement, architectural redesign, or a modularization implementation.

The following documents are the evidence base for this plan:

- `docs/engineering/app-js-production-defect-audit.md`
- `docs/engineering/app-js-production-defect-fix-plan.md`
- `docs/engineering/app-js-stabilization-phase-plan.md`
- `docs/engineering/app-js-stabilization-and-prep-plan.claude-opus.md`
- `docs/engineering/app-js-modularization-inventory.md`
- `docs/engineering/app-js-modularization-readiness-audit.claude-opus.md`

Where those documents describe DEF-001 through DEF-008 as confirmed, assigned, open, or awaiting
implementation, this document supersedes that historical status: **DEF-001 through DEF-008 are
completed.** Their analysis remains useful evidence, but they are not preparation blockers.

Permanent product and engineering rules remain governed by `AGENTS.md`,
`docs/product/TP3D-MASTER-TODO-V5.md`, `docs/product/BILLING_ENTITLEMENT_RULES.md`, and
`docs/engineering/autopack-engine-contract.md` within their respective scopes. If a preparation
finding conflicts with those rules, the product or domain rule wins.

## Scope lock

This plan authorizes preparation evidence only: documentation, behavior characterization,
source-location-independent tests, focused standalone defect work when separately approved, manual
verification, and a final readiness re-audit.

This plan does **not** authorize:

- extracting or moving any App.js responsibility;
- selecting extraction candidates, destinations, or an extraction order;
- introducing a replacement architecture or new runtime ownership model;
- changing auth, billing, workspace, persistence, editor, or startup semantics as cleanup;
- combining a behavior fix with structural movement;
- deleting suspected dead code, consolidating similar logic, or performing warning cleanup merely
  to reduce the future diff;
- treating file size, lint warnings, globals, closure capture, or duplicated-looking listeners as
  defects without behavioral evidence.

Older documents contain conditional extraction candidates and roadmaps. Those sections are not
adopted by this plan and must not be used as implementation authorization.

## Current verified status

### Repository status at creation

- Branch: `chore/app-js-stabilization-preparation`
- Observed HEAD: `2d3be67`
- Worktree: clean before this document was created
- The complete stabilization stack is present in branch ancestry.

### Completed stabilization stack

| Phase | Branch | Commit | Completed defects |
| --- | --- | --- | --- |
| Documentation baseline | `chore/app-js-production-defect-plans` | `6630758` | Audit, surgical fix plan, and phase controls |
| 1 — Data integrity boundaries | `fix/app-js-data-integrity-boundaries` | `8d4a51b` | DEF-001, DEF-002, DEF-003 |
| 2 — Cross-tab reliability | `fix/app-js-cross-tab-reliability` | `8ff5120` | DEF-004, DEF-007 |
| 3 — Operation lifecycle guards | `fix/app-js-operation-lifecycle-guards` | `b2fb7c4` | DEF-005 |
| 4 — Auth reliability | `fix/app-js-auth-reliability` | `acf65ca` | DEF-006, DEF-008 |

### Recorded stabilization verification

The completed stabilization run recorded:

- focused DEF-001 through DEF-008 tests: **20 passed, 0 failed**;
- default suite: **1,145 total; 1,140 passed; 5 skipped; 0 failed**;
- typecheck: passed;
- diff checks: passed;
- lint: **0 errors**, with 35 JavaScript warnings and 18 HTML warnings retained as non-blocking
  baseline findings;
- Phase 3 browser smoke: guarded mutation paths, permitted navigation, and cancel behavior passed;
- signed-out browser stability: the session remained stable beyond the eight-second auth gate with
  the same performance time origin and no reload; the only observed request issue was the known
  local favicon 404.

These results verify the completed stabilization baseline. They do not constitute modularization
readiness because the highest-risk authenticated, cross-tab, failure, startup, and ownership
contracts still require preparation evidence.

### Known residual verification boundary

Authenticated live-browser verification was not completed where credentials or backend fixtures
were unavailable. The residual matrix includes transient invite retry, same-tab and cross-tab
logout, concurrent sign-in/logout, and authenticated owner/member billing and workspace flows.
These are readiness evidence requirements; they do not reopen DEF-001 through DEF-008.

---

## 1. Completed stabilization work

All eight audited production defects are closed for purposes of this preparation program.

| Defect | Completed behavior | Closure evidence |
| --- | --- | --- |
| DEF-001 | Undo/redo history is reset at user and workspace scope boundaries so prior-scope state cannot be restored into the active scope. | Phase 1 focused tests and full-suite pass |
| DEF-002 | Legacy storage migration preserves valid packs and cases and removes legacy data only after a verified replacement exists. | Phase 1 migration tests and full-suite pass |
| DEF-003 | Pending debounced persistence is flushed or deliberately cancelled at scope boundaries so accepted state is not silently lost or written under the next scope. | Phase 1 persistence tests and full-suite pass |
| DEF-004 | Cross-tab workspace ordering uses a globally comparable wall-clock/logical order with a tab tie-break, allowing valid messages from fresh tabs while rejecting stale/self/wrong-user updates. | Phase 2 ordering tests and full-suite pass |
| DEF-005 | Packs, Cases, relevant dialogs, and editor mutation paths respect the authoritative operation lifecycle at mutation commit points while permitted read-only navigation remains available. | Phase 3 focused tests and browser smoke |
| DEF-006 | Pending invite state is retained for retryable failures and cleared only for successful or terminal outcomes under the canonical classifier. | Phase 4 classifier/retention tests and full-suite pass |
| DEF-007 | A follower blocked by a dead billing lock retries after the observed lock expiry instead of before its time-to-live. | Phase 2 lock timing tests and full-suite pass |
| DEF-008 | Canonical logout performs deterministic signed-out cleanup without a competing timer-driven page reload. | Phase 4 logout tests and signed-out browser stability check |

### Stabilization closure rule

Preparation work must preserve these outcomes. A later failing characterization test may identify a
new regression or a newly discovered defect, but it must not relabel a completed DEF as open without
a reproducible contradiction to its closure evidence. Any new defect receives its own scope,
severity, branch, and verification plan.

---

## 2. Remaining preparation work

The remaining work is ordered. Each phase must produce reviewable evidence and may not include
extraction or code movement.

### Preparation Phase P1 — Ownership and lifecycle baseline

**Goal:** make the current runtime ownership and order contracts explicit without changing them.

Required outputs:

1. the ownership documents listed in Section 3;
2. an exact startup and readiness sequence covering module evaluation, IIFE construction, `init()`,
   auth settlement, org settlement, scoped-state loading, billing settlement, first render, and
   ready/fatal handoff;
3. a register of current global/public surfaces, late-bound callbacks, and dynamic consumers;
4. a traceable list of unresolved facts and product decisions, each with an owner and required
   evidence.

**Exit:** every P0-sensitive state family, persistent key, listener, subscription, timer, channel,
global, and startup transition has one documented current owner or is explicitly marked
`OWNERSHIP UNRESOLVED`.

### Preparation Phase P2 — Behavioral characterization

**Goal:** establish behavior-level protection for the contracts in Section 4.

Required outputs:

1. a DOM-capable or browser-capable harness that exercises observable runtime behavior rather than
   only reading App.js source text;
2. characterization coverage for startup, auth, org/workspace, persistence, billing, operation
   lifecycle, invite, logout, globals, listeners, and failure recovery;
3. conversion of location-coupled source assertions where file identity would create a false
   failure after future movement;
4. retained architectural source assertions where source shape is the actual invariant, such as
   forbidden dependency direction;
5. evidence that repeated construction or `init()` does not create duplicate authoritative
   listeners, subscriptions, timers, channels, fetches, or render work.

**Exit:** the behavior suite runs against the current implementation, is green, and can distinguish
a real contract regression from a harmless source-location change.

### Preparation Phase P3 — Public-surface and ambiguous-contract resolution

**Goal:** remove ambiguity at seams that a future plan would necessarily cross.

The readiness audit confirms that the final `window.TruckPackerApp` object does not retain
`handleWorkspaceLeft`, `handleOwnershipTransferred`, or `notifyOrgAccessLoss` assignments made on a
temporary construction-time object. Settings callers therefore feature-detect the first two and
fall back to a generic account-bundle refresh. This finding is separate from DEF-001 through
DEF-008 and remains unresolved.

Required sequence:

1. characterize the final runtime facade and both guarded Settings call paths;
2. obtain an explicit product/engineering decision on the intended Leave Workspace and Transfer
   Ownership reconciliation behavior;
3. if code must change, authorize it as a standalone stabilization change with no movement or
   refactor;
4. add runtime tests for the approved final facade and stale-org/stale-billing/stale-editor reset
   behavior;
5. re-run the full stabilization regression set.

Late-bound billing/auth/org callbacks must also have their current population time, fallback
behavior, caller set, and earliest-call condition documented and characterized. This phase records
the existing contract; it does not design their future replacement.

**Exit:** the public facade is intentional rather than construction-order accidental, all dynamic
consumers are catalogued, and no P0-sensitive callback can silently use an undocumented fallback.

### Preparation Phase P4 — Failure, browser, and readiness evidence

**Goal:** close the remaining evidence gaps and issue a current readiness verdict.

Required outputs:

1. the failure-injection matrix in Section 4;
2. authenticated same-tab and cross-tab verification using controlled users and workspaces;
3. owner, admin, and member billing/entitlement verification;
4. hidden-tab, offline/resume, stale-response, and retry verification;
5. final default, typecheck, lint, format, diff, relevant stress, and focused suite results;
6. an independent readiness re-audit against every gate in Section 5.

**Exit:** the re-audit marks every gate `PASS`, or the preparation program remains active with named
blockers. A partially complete matrix is not a readiness pass.

### Branch discipline for P1–P4

- Each phase uses its own reviewed preparation branch stacked from the last verified phase.
- The branch brief lists exact outputs, permitted file classes, commands, and manual checks before
  work begins.
- Documentation, tests, and any separately approved behavior fix remain separate commits.
- No preparation branch may move runtime responsibilities or combine cleanup with behavior change.
- Each phase records its verified commit before the next phase starts.

---

## 3. Required ownership documentation

Ownership documentation describes the runtime as it exists. It must not prescribe a new module
layout.

### 3.1 State and persistence ownership matrix

For every state family and persistence record, record:

- authoritative current owner;
- all readers and permitted writers;
- storage key or key family;
- user, workspace, tab, session, or global scope;
- load, seed, migration, save, flush, cancel, reset, and clear triggers;
- same-tab and cross-tab behavior;
- freshness, user, org, epoch, and generation guards;
- undo/redo participation and the completed scope-boundary reset behavior;
- transient editor/UI reset requirements;
- error and recovery behavior.

At minimum, the matrix must cover preferences, case/pack/folder libraries, current pack, current
screen, selection, AutoPack results, account bundle state, billing snapshots/locks/results,
workspace hints, invite handoff state, reload/return markers, and developer overrides.

### 3.2 Side-effect ownership ledger

For every listener, StateStore subscription, timer, animation-frame sequence, retry pump,
`BroadcastChannel`, and module-evaluation side effect, record:

- owner and install point;
- event/trigger and observable effect;
- cardinality and idempotence guard;
- identity/scope/freshness guard;
- current clear, unsubscribe, close, or one-shot policy, including when no teardown exists;
- overlap with other handlers for the same browser event;
- behavior during hidden, offline, signed-out, and workspace-switch states.

Overlapping `focus`, `visibilitychange`, and `storage` listeners must be documented as distinct
contracts unless behavior proves they are duplicates. Similar triggers are not sufficient evidence
for consolidation.

### 3.3 Startup and construction-order record

Record the exact current order and earliest safe call for:

- vendor and Three.js readiness;
- body-end DOM availability and DOM capture;
- import-time billing globals, storage listener, and billing channel;
- boot/fatal handlers and the final `window.TruckPackerApp` publication;
- Scene, OperationLifecycle, interaction, AutoPack, and ExportService construction;
- Supabase internal auth listener and application auth listener installation;
- StateStore subscriber, Router initialization, initial route, explicit render, auth gate, and app
  ready handoff;
- every late-bound accessor or callback, including what happens before it is populated.

This record preserves observed order. It must not turn an observation into a proposed architecture.

### 3.4 Public and ambient surface register

For every global or dynamic surface, record its producer, publication time, consumers, property
shape, mutability, authority, and compatibility status. At minimum:

- `window.TruckPackerApp`;
- `window.OrgContext`;
- `window.__TP3D_BILLING`;
- `window.__TP3D_LAST_ACCOUNT_BUNDLE`;
- `window.__TP3D_USER_SWITCH_PENDING`;
- Supabase config/client globals;
- boot, UI, helper, debugger, and developer globals;
- custom window events and internal event-bus topics.

Feature-detected properties and manual/debug consumers count as public compatibility surfaces until
evidence proves otherwise.

### 3.5 Controller and callback contract register

For each current App.js-owned controller or injected callback surface, record:

- construction owner and lifetime;
- captured dependencies and late-bound values;
- methods/callbacks actually consumed;
- mutation permissions and OperationLifecycle requirements;
- state read/write authority;
- failure behavior and UI feedback;
- initialization cardinality and any current cleanup path.

This register is an inventory of existing contracts only. It must not assign future files or
boundaries.

### 3.6 Ownership completion rule

An item is not documented merely because it appears in a search result. The ledger must connect the
producer to every confirmed consumer and to its observable lifecycle. Unresolved dynamic access is
recorded explicitly and blocks readiness when it can affect identity, billing, workspace scope,
persistence, editor mutation, or boot behavior.

---

## 4. Behavioral characterization requirements

Characterization locks observable behavior at the verified baseline. It must test results,
ordering, authority, rejection of stale work, and side-effect cardinality. Source-text assertions
may supplement these tests but cannot be the only evidence for runtime behavior.

| Area | Minimum required characterization |
| --- | --- |
| Boot and init | Cold and warm boot; maintenance short-circuit; vendor success/failure; final facade publication; ready/fatal classification; `init()` single-flight/idempotence; initial route/render order; no duplicate listeners or subscriptions. |
| State and persistence | Anonymous/no-org seed; valid and malformed legacy data; completed history reset at user/workspace boundaries; pending save flush/cancel; correct storage key after rapid scope change; persistent versus transient state behavior. |
| Auth and user isolation | Signed-out, signed-in, initial session, token refresh, transient signed-out recovery, explicit logout, User A→B synchrony, disabled/deleted/incomplete profile, hidden/offline/focus recovery, same-tab and cross-tab logout. |
| Organization/workspace | Bundle selection priority; partial versus confirmed-empty bundle; same-tab switch and rollback; cross-tab wrong-user/self/stale/fresh ordering; leave/archive/restore/transfer/update/access-loss; no stale state across the readiness boundary. |
| Billing and entitlement | Authoritative `/billing-status`; raw payment versus normalized entitlement; every entitlement state; owner workspace inheritance; owner-only money actions; stale user/org/epoch result rejection; lock expiry retry; hidden/offline resume; AutoPack/PDF/sidebar/Settings agreement. |
| Operation lifecycle | AutoPack, Unpack, Truck Change, preview, Packs, Cases, dialogs, keyboard, drag/rotate/nudge/delete/add/duplicate/paste; mutation blocking while busy; permitted camera/read-only/navigation behavior; stale operation tokens. |
| Invite and logout | Signed-out handoff; existing session; retryable versus terminal invite outcomes; wrong-user/expired/revoked/already-accepted cases; URL/session cleanup; deterministic logout with no timer reload. |
| Public surfaces | Final runtime property shapes; feature-detected Settings callbacks; globals, custom events, event-bus topics, and debug/helper surfaces; publication time and behavior before late-bound callbacks are populated. |
| Side effects | One authoritative owner per listener/subscriber/timer/channel; expected overlapping handlers; exact retry/clear behavior; no duplicate work after repeated init or reconstruction attempts. |
| Failure injection | Supabase unavailable/timeout; invalid cached session; org-bundle partial/failure; billing timeout/401/403/unavailable; storage read/write exception; invalid persisted data; render/preview/vendor failure; recovery without stale authority or duplicate work. |

### Required authenticated manual matrix

Automated characterization is necessary but does not replace browser verification for the P0
flows. The controlled matrix must include:

- owner with one workspace;
- owner with multiple workspaces;
- admin and non-owner member;
- same-tab and cross-tab workspace switch;
- same-tab and cross-tab logout and re-login;
- concurrent sign-in/logout and stale response arrival;
- invite retry followed by success or terminal failure;
- AutoPack and PDF gates;
- Settings Billing, Members, and Invites tabs;
- hidden-tab and offline/resume behavior;
- confirmation that packs, cases, selections, preview, members, invites, and billing never leak
  across user or workspace boundaries.

### Characterization quality rule

Each test or manual case must identify the starting identity/scope, trigger, expected ordering,
observable result, rejected stale work, and cleanup state. A test that only proves a function name or
literal remains in `src/app.js` is not behavioral characterization.

---

## 5. Modularization readiness gates

No extraction planning is authorized until all gates pass. Each gate requires linked artifacts,
test output, or reviewed decisions; a prose assertion alone is insufficient.

| Gate | Pass condition | Blocking evidence |
| --- | --- | --- |
| G0 — Stabilization baseline | DEF-001 through DEF-008 remain closed and their focused/full regression baseline is green. | Any reproducible regression contradicting a completed behavior |
| G1 — Scope integrity | Preparation branches contain no extraction, code movement, architecture redesign, or mixed cleanup. | Any structural runtime change outside a separately approved standalone defect fix |
| G2 — Ownership completeness | All Section 3 artifacts are complete and reviewed; every P0-sensitive item has a confirmed current owner and lifecycle. | `OWNERSHIP UNRESOLVED` on an identity, billing, workspace, persistence, operation, or boot path |
| G3 — Behavioral test net | Section 4 runtime characterization is green and location-coupled tests no longer block behavior-preserving source movement. | Runtime contracts protected only by source-text assertions or missing stale/cardinality checks |
| G4 — Public-surface intent | Final facade and dynamic global contracts are intentional, tested, and consistent with Settings/workspace lifecycle behavior. | Construction-order accident, undocumented fallback, or unresolved Leave/Transfer decision |
| G5 — Startup and side-effect control | Startup order, late binding, listeners, subscriptions, timers, channels, and failure recovery are documented and characterized. | Unknown earliest-call condition, duplicate authority, unbounded retry, or unowned side effect |
| G6 — P0 browser matrix | Authenticated owner/admin/member, same/cross-tab, billing, invite, workspace, and isolation checks pass in a controlled environment. | Missing credentials/fixtures, partial matrix, stale-state leak, or unexplained browser failure |
| G7 — Repository quality | Default and focused tests, typecheck, diff checks, and relevant browser/stress checks pass; lint has no new errors or unexplained warning increase. | Failure, weakened test, unexplained skip, or baseline regression |
| G8 — Readiness re-audit | An independent re-audit reviews G0–G7 and records `READY TO WRITE MASTER EXECUTION PLAN`. | Conditional, partial, or `NOT READY` verdict |

### Gate status at publication

| Gate | Status | Reason |
| --- | --- | --- |
| G0 | PASS | The four stabilization phases and DEF-001 through DEF-008 are complete with recorded verification. |
| G1 | PASS for this document | This file changes documentation only and proposes no extraction. |
| G2 | OPEN | Existing inventories identify many owners but the required current-state ledgers are not yet complete/reviewed as controlling artifacts. |
| G3 | OPEN | Focused stabilization coverage exists; a broad behavior-level runtime harness and source-location decoupling remain incomplete. |
| G4 | OPEN | The final `TruckPackerApp` facade and Leave/Transfer fallback remain an unresolved intentional-behavior decision. |
| G5 | OPEN | Startup and side-effect facts are inventoried but not yet frozen in reviewed ownership/behavior artifacts with failure coverage. |
| G6 | OPEN | The authenticated browser matrix remains incomplete. |
| G7 | PASS for the recorded stabilization baseline | The baseline is green with known non-blocking warnings; it must be re-run after every preparation phase. |
| G8 | OPEN | The readiness re-audit occurs only after G0–G7 pass concurrently. |

---

## 6. Conditions required before writing the App.js Modularization Master Execution Plan

The App.js Modularization Master Execution Plan may be written only when all of the following are
true:

1. Preparation Phases P1 through P4 are complete on reviewed, traceable commits.
2. Gates G0 through G8 are simultaneously `PASS`; no waiver is permitted for G2 through G6.
3. DEF-001 through DEF-008 regression coverage remains green.
4. The runtime behavior harness covers the P0 state machines and can detect stale authority,
   wrong-scope persistence, duplicate side effects, and startup-order regressions.
5. Source-coupled invariant tests have been retained, converted, or replaced according to whether
   their real contract is architectural or behavioral; none are simply weakened to permit future
   movement.
6. State, persistence, listener, timer, channel, global, controller, callback, and startup ownership
   documents are complete and reviewed.
7. The `window.TruckPackerApp` facade behavior is deliberate, and Leave Workspace and Transfer
   Ownership use the approved reconciliation contract with runtime coverage.
8. Authenticated owner/admin/member, billing, invite, same-tab, cross-tab, hidden-tab, offline, and
   user/workspace isolation matrices have completed evidence.
9. Failure-injection results prove that partial initialization or backend failure does not grant
   access, retain stale authority, leak scoped state, or install duplicate work.
10. A readiness re-audit records an unconditional `READY TO WRITE MASTER EXECUTION PLAN` verdict
    against a pinned, clean baseline commit.
11. The current product TODO identifies the approved planning branch and confirms that no higher
    priority stabilization blocker supersedes the work.

When those conditions are met, the Master Execution Plan may define proposed structural phases,
review boundaries, validation, rollback, and branch order. Until then, candidate selection,
destination design, and extraction sequencing remain deliberately undecided.

Writing the Master Execution Plan is a separate approval milestone. This preparation document does
not itself authorize the plan's future implementation.

## Control and status updates

- This file is the status authority for the preparation program.
- At the end of each preparation phase, update its branch/commit, evidence links, gate changes, and
  residual blockers here in a documentation-only status change.
- A gate may move to `PASS` only with reproducible evidence; regressions return the affected gate to
  `OPEN`.
- New findings are separated into confirmed defects, risks, product decisions, and evidence gaps.
  Risks or file size alone are not defects.
- Existing source documents remain immutable historical evidence unless separately requested.
- Significant future code changes require the knowledge graph to be updated under the repository's
  Graphify rules; this documentation-only creation does not modify graph artifacts.

**Current conclusion:** production-defect stabilization is complete. Modularization is not yet
ready to plan for execution. The next authorized work is preparation evidence under P1, beginning
with current ownership and lifecycle documentation.
