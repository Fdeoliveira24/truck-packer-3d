# App.js Stabilization & Modularization **Preparation** Plan

**Author:** Synthesis by Claude Opus 4.8 (independent), reconciling three Phase-0 audits
**Date:** 2026-07-21
**Inputs:** Codex audit, Copilot audit, and the Opus readiness audit (`app-js-modularization-readiness-audit.claude-opus.md`), plus the two existing inventories (Codex 5.6, Sonnet 5). Direct source verification of the contested claims was performed for this plan.
**Status:** This is the document that comes **before** the Master Plan. It is a stabilization + preparation plan, **not** an execution/extraction plan.

> **Why preparation, not execution.** A modularization Master Plan needs to know: what can move, what cannot, what owns what, which tests protect behavior, which bugs exist today, and which behavior is *accidental*. Today we know some of these but not enough — and two accidental behaviors have already been confirmed as bugs (C1.2, C1.3). Writing an extraction sequence now would be building on unverified ground. This plan closes that gap. The extraction phases (a real Master Plan) are authorized only after **Phase 5** exit gates pass.

---

## 0. How the three audits reconcile

All three audits independently reached the **same top-line verdict: not ready for extraction; do preparation only.** They differ in what they found, because they looked at different depths:

- **Codex** — structural/graph audit. Strong on ownership map, cycles, teardown, and the "source-contract tests give false confidence" risk. Concluded "no P0/P1 proven" — correct *for a structural pass that did not trace callers*.
- **Copilot** — deeper code read. Found two P0 hazards (undo cross-scope, facade drop), the late-bound reverse callbacks, and the silent-`catch` surface.
- **Opus** — traced the facade bug to its callers and confirmed the degraded runtime path.

For this plan I **verified the contested claims against source** so category placement rests on evidence, not on vote-counting.

### Cross-audit reconciliation table

| # | Finding | Codex | Copilot | Opus | Verified for this plan | Category |
|---|---|:--:|:--:|:--:|---|:--:|
| 1 | No runtime/behavioral test net (only source-text asserts; no jsdom) | ✓ | ✓ | ✓ | ✓ no jsdom/happy-dom dependency | **C1** |
| 2 | `window.TruckPackerApp` drops `handleWorkspaceLeft`/`handleOwnershipTransferred` (D2/BUG-1) | — | ✓ | ✓ | ✓ **confirmed**: construction-time temp obj overwritten by return literal; settings-overlay callers silently fall back | **C1** |
| 3 | Undo history bleeds across workspace/user scope (D1) | — | ✓ P0 | — | ✓ **confirmed mechanism**: `replace()` never clears `history[]`; no `clearHistory` export | **C1** |
| 4 | Source-contract tests are fragile to extraction | ✓ (false-negative) | — | ✓ (false-positive) | ✓ both directions real | **C1** |
| 5 | ~40+ shared closure vars across auth/billing/org/workspace | ✓ | ✓ | ✓ | ✓ single IIFE, shared lexical scope | **C3** |
| 6 | Late-bound reverse callbacks null until deep in boot (D3) | ✓ | ✓ | ~ | ✓ `_billingGateApplier` null@170 → set@9693 | **C3 / P5** |
| 7 | Root StateStore subscriber is an implicit coordinator | ~ | ✓ | — | not independently traced (plausible) | **C3** |
| 8 | ~70 silent `try/catch(/* ignore */)`, several on critical paths | ~ | ✓ | — | trust Copilot's count; scope fix to ~5 critical | **C2** |
| 9 | No teardown/dispose; init-idempotence unknown (D5/D6) | ✓ | ✓ | ✓ | init guarded by `initInFlightPromise`/`initCompleted` | **C1 test / C3** |
| 10 | `src/debugger-old.js` dead | — | — | ✓ | ✓ unreferenced in src/index.html/tests | **C2** |
| 11 | `src/core/state.js` orphan (D8) | — | ✓ | — | ✓ exists, **no importers**, ≠ `state-store.js` | **C2** |
| 12 | Codex static "orphan" functions | ✓ (warns: don't delete) | — | — | ✓ `openUpdatesScreen`/`openRoadmapScreen` are DOM-wired, **not dead** | **C3** |
| 13 | `TrailerGeometry` is a safe pure-math leaf | ✓ | ✓ | ✓ | ✓ pure math IIFE @3168 | **C4 #1** |
| 14 | Updates/Roadmap/Connectivity are low-risk leaves | ~ | ✓ | ✓ | ✓ static data + DOM | **C4** |
| 15 | `init()` `consistent-return` + 26 app.js lint warnings | ✓ | — | — | trust Codex lint run | **C2 (isolated)** |

**One correction for accuracy:** Copilot's D2 describes "two separate `try` blocks … dangling reference between them." Verified reality is a **single** attach block at `app.js:6636–6643` (running during IIFE construction) that is then **overwritten** by the `return {…}` literal at `~9905`. The *conclusion* is identical and correct — three methods are absent from the final facade and their guarded callers silently degrade — but the fix targets the construction-vs-return seam, not a mid-construction race.

---

## Category 1 — Must fix before migration

*Blockers and confirmed bugs. Extraction cannot be validated or trusted until these are resolved. Do these first, each in its own reviewed change.*

### C1.1 — Stand up a behavioral characterization harness *(unanimous; the hard gate)*
**Why:** `npm test` runs `node --test tests/audit/*.spec.mjs`; every `app.js` reference is `fs.readFile()` + regex. No jsdom/happy-dom exists, so the five interleaved state machines (billing, auth stability gate, org context, workspace switch, authoritative refresh) and the boot lifecycle have **zero runtime coverage**. Without this, a move can preserve every current test and still break auth/billing/workspace at runtime.
**Scope (merged from all three audits):** add a dev-only DOM harness and write *characterization* tests (lock current behavior, quirks included) for:
- signed-out boot, signed-in boot, A→B→A user switch, `TOKEN_REFRESHED`;
- same-tab and cross-tab workspace switch (`storage` event path);
- billing epoch guard (a response arriving after `clearBillingState()` is discarded);
- authoritative-refresh generation/epoch blocking stale results after a user switch;
- workspace-switch readiness (all three `markWorkspaceSwitchReady` flags → `finishWorkspaceSwitch`; timeout → `finishWorkspaceSwitch('timeout')`);
- failed org-bundle load and offline recovery;
- **init idempotence + listener/subscription counts** across repeated init (auth, storage, keyboard, visibility, billing subscribers).

### C1.2 — Fix the `window.TruckPackerApp` facade drop (D2 / BUG-1) *(confirmed)*
**Why:** Verified defect. During IIFE construction, `app.js:6635` builds a temporary global and attaches `handleWorkspaceLeft`, `handleOwnershipTransferred`, `notifyOrgAccessLoss` (6639/6642/6638); the `return {…}` at `~9905` overwrites it and omits those three. `settings-overlay.js:2000` and `:2300` call the first two behind `typeof … === 'function'` guards, so they **silently no-op and fall back to `queueAccountBundleRefresh`** — the tailored Leave-Workspace / Transfer-Ownership reconciliation never runs from Settings. This is a P0 stale-state class per `CLAUDE.md`, and current behavior depends on an *accidental* construction-order drop — exactly the "accidental behavior" a migration would silently flip.
**Action:** Make a **product decision** — should Settings Leave/Transfer run the real handlers or the bundle-refresh fallback? — then express the public surface in **one place**, and add a runtime test asserting the intended `window.TruckPackerApp.*` API. Do not fold this into a mechanical move.

### C1.3 — Fix (or deliberately bound) the cross-scope undo bleed (D1) *(confirmed mechanism)*
**Why:** Verified. On workspace/user switch, `app.js` calls `StateStore.replace(...)` at `4979/4999/5015/5026`, all with `skipHistory:true`. But `state-store.js` `replace()` **never clears `history[]`** and there is **no `clearHistory` export** — `history` is only reset inside `init()`. So after a switch, the previous scope's undo stack survives, and a global Ctrl+Z (`undo()`) can merge a **prior workspace/user's snapshot into the current scope**. This is a live data-isolation hazard independent of modularization; it also blocks state-hydration extraction because a refactor there would obscure it.
**Action:** Decide the history boundary (clear/reset undo history on scope and user switch), implement in `state-store.js`, and add a characterization test. Given it is a real user-data bug, consider fixing ahead of the rest of Category 1.

### C1.4 — Decouple the invariant tests from file identity *(confirmed)*
**Why:** Two-sided problem. (a) Some `tests/audit/*` assert the literal presence of symbols **inside `app.js`** (e.g. `renderInviteHandoffNotice`, `_isConfirmedUserSwitch`) — extracting those fails CI on correct code, pressuring engineers to weaken guards. (b) Because the suite only reads source text, it gives **false confidence** — it passes while runtime behavior regresses (Codex). Both must be addressed before symbols move.
**Action:** Rework symbol-presence assertions to test **architecture** (module boundaries, "orchestrator must not import the solver," "must import the AutoPack factory") rather than "symbol X lives in app.js." Keep the genuine architectural invariants; drop the location coupling.

---

## Category 2 — Safe improvements we can do early

*Low-risk, behavior-neutral or additive. These don't require the harness and can land in parallel, each isolated from any code movement.*

- **C2.1 — Delete `src/debugger-old.js`** (1,063 lines). Verified unreferenced by `src/`, `index.html`, `tests/`. Isolated PR. *Reason: removes confusion before later diffs.*
- **C2.2 — Confirm and delete `src/core/state.js`** (orphan, D8). Static check shows **no importers** and it is distinct from `state-store.js`. Do one final dynamic-reference grep (property/string access) first, then delete in an isolated PR. *Reason: eliminates a legacy singleton that could be accidentally resurrected mid-migration.*
- **C2.3 — Add `console.warn` to the ~5 critical-path silent `catch` blocks** — `applyBillingEntitlementFields`, `_applySharedBillingSnapshot`, `applyOrgContextFromBundle`, `applyUserSwitchIsolation`, `markWorkspaceSwitchReady`. Additive logging only; do **not** change control flow. *Reason: these silent swallows are the most likely source of invisible post-extraction regressions; observability must exist before the risky phases.* (Leave the ~65 defensive DOM-guard catches alone.)
- **C2.4 — Resolve behavior-neutral lint warnings in isolated PRs** — the `init()` `consistent-return` contract and safe `await`-in-loop cases. *Reason: clarifies the boot promise contract for the harness.* **Exclude** the use-before-definition warnings near auth/org — those reflect real ordering coupling (see C3).
- **C2.5 — Add structural navigation (docs + banners)** — extend the `// SECTION:` banners past line 384 and/or add a top-of-file module-map index comment. Pure annotation, no logic change. *Reason: ~9,500 lines are currently unlabeled; navigation cost is a migration risk multiplier.*
- **C2.6 — Draft the ownership ledgers (documentation only)** — start the storage-key, listener, and timer inventories now as living docs. *Reason: these feed Phase 5 gates; writing them changes no code and surfaces duplication early (e.g., the duplicated `visibilitychange`/`focus`/`storage` registrations).*

---

## Category 3 — Do not touch yet

*The interdependent P0 cores. Extracting, reordering, or "cleaning up" any of these before Phase 5 gates is unsafe. Freeze them.*

- **Auth state machine** — `renderAuthState`, auth stability gate, INITIAL_SESSION / P0.7 fallback snapshot, transient sign-out guard, `applyUserSwitchIsolation`. *Ordering is a security boundary.*
- **Billing runtime** — `_billingState` + ~30 billing vars, entitlement normalization, epoch guard, authoritative-refresh lifecycle, cross-tab lock/snapshot/broadcast, `maybeScheduleBillingRefresh`, access gate. *Split billing authority = wrong-plan gating.*
- **Org context** — `OrgContext`, `setActiveOrgId`, `applyOrgContextFromBundle`, cross-tab org sync. *Active-org identity is ambient and epoch-guarded.*
- **Workspace-switch state machine** — `beginWorkspaceSwitch`/`finishWorkspaceSwitch`/`markWorkspaceSwitchReady`, timeout guard, cross-tab payload handling.
- **Scoped persistence + the root StateStore subscriber** — storage-scope selection, reset/load/seed, and the single subscriber that fuses persistence + theme + scene refresh + preview capture + full re-render. *Cannot be split without an explicit ordering contract (Phase 5).*
- **The four late-bound reverse callbacks** — `_billingGateApplier`, `_orgAccessLossHandler`, `_authGateIsSettledAccessor`, `_authTruthSnapshotAccessor`. Module-level code calls into IIFE-level logic via these; verified `_billingGateApplier` is `null` until line 9693. **Neither side moves until the interface is formalized (Phase 5).**
- **`init()` startup ordering and listener registration** — including the `OperationLifecycle → InteractionManager → AutoPack → ExportService` construction order (AutoPack's preview callback captures the later `ExportService` binding; reordering breaks preview).
- **Do not delete the Codex "orphan" functions** — several are dynamically dispatched. Verified: `openUpdatesScreen`/`openRoadmapScreen` are wired through `wireGlobalButtons` (DOM), not dead. Static orphanhood ≠ dead here.
- **Do not "fix" use-before-definition warnings by reordering** near auth/org — the forward references encode real init dependencies.

---

## Category 4 — Possible first extraction candidates

*Not approved now. These are the pieces to **evaluate first** once Category 1 gates pass, because they touch no auth/billing/org/workspace/persistence state. Each: explicit dependency injection, one file per PR, behavior-neutral, characterization tests green.*

**First wave (all three audits converge):**
1. **`TrailerGeometry`** (`app.js:3168`) → pure math, no DOM/state/side effects. **Safest single candidate — start here.**
2. **Updates screen + Roadmap screen** (`UpdatesUI` @4279, `RoadmapUI` @4326, static `Data.updates`/`Data.roadmap`) → static data + DOM; no-op `init()`. (Note: their `open*` entrypoints are DOM-wired — keep that wiring intact.)
3. **Connectivity / offline indicator controller** → narrow platform I/O, no auth/billing.

**Second wave (list only — more caveats; NOT first, tempering Copilot's plan):**
- **`ExportService`** (`app.js:3632`) — clean capture/screenshot/PDF interface, but its PDF gate calls `getProRuleSet()` (module-level billing) and it depends on `OperationLifecycle` construction order. Extract only with the billing gate **injected, not inlined or duplicated**.
- **`KeyboardManager`** (`app.js:4445`) — clear responsibility, but its mutation-block guard must stay wired to `OperationLifecycle`. Requires the listener ledger (C2.6) first.

*Rationale for the wall between waves:* first-wave failures are visible and isolated; second-wave pieces have a billing/lifecycle tether that must be made explicit (Phase 5 interface work) before they are safe.

---

## Phase 5 — Modularization Readiness Completion Plan & cleanup

*What "preparation done" means. Only when every gate below is green is an **execution** Master Plan (the actual extraction sequence) authorized. This phase produces the evidence a real migration plan needs.*

**Readiness artifacts to complete:**
1. **State & persistence ownership matrix** — for every state family: authoritative owner, persistence key(s), user/org scope, reset trigger, cross-tab behavior, permitted writers. (Resolves the "multiple writers / key families" blocker.)
2. **Formalized `AppLifecycleCallbacks` interface** — replace the four null-until-late reverse callbacks with an explicit, documented, **tested** contract (when each is populated; behavior if called before population). Unblocks eventually moving billing/auth.
3. **Startup state-machine document** — name the phases (preflight → service construction → listener install → auth settle → org settle → scoped-state load → billing settle → first render → ready). Preserve ordering; do not redesign.
4. **Frozen controller interfaces** — inventory and characterize the callback/method surfaces of `AppShell`, `EditorUI`, overlays, `KeyboardManager`, `OperationLifecycle`, `AutoPackEngine` before any import boundary changes.
5. **Side-effect manifest** — every listener/subscription/timer/`BroadcastChannel`/global assignment: owner, install point, idempotence guard, cleanup policy. (Turns the duplicated-listener risk into a managed list; establishes whether an app-level teardown is needed.)
6. **Dead-code proof** — static reachability **+** runtime coverage **+** DOM-attribute/callback tracing before deleting anything beyond C2.1/C2.2. (Prevents removing dynamically referenced behavior.)
7. **Failure-injection tests** — Supabase unavailable, auth timeout, org-bundle failure, billing failure, invalid persisted state, storage exceptions, render failure. (Characterizes partial-init behavior; startup extraction stays forbidden until this exists.)

**Cleanup & baseline hygiene:**
8. **Isolate the baseline** — separate the unrelated working-tree changes (`styles/main.css`, the untracked inventory docs) from all prep commits so a later regression is never confused with feature work.
9. **Warning + annotation cleanup** — land the C2.4/C2.5 items and any proven dead-code removal as isolated, behavior-neutral PRs.

**Exit gate (Phase 5 → Master Plan authorization):**
- C1.1 harness green for all listed scenarios; C1.2 and C1.3 fixed with tests; C1.4 tests decoupled.
- Artifacts 1–7 complete and reviewed.
- Default + integration + local-db + relevant browser/stress suites green.
- A short **readiness re-audit** confirms no new lifecycle bug and that extraction of the Category-4 first wave can be proven behavior-neutral.

Only then does the **App.js Modularization *Execution* Plan (Master Plan)** get written — starting with `TrailerGeometry`.

---

## Appendix — confirmed vs. needs-repro

**Confirmed by source inspection for this plan:** C1.2 facade drop + guarded callers + fallback; C1.3 `replace()` never clears `history[]` / no `clearHistory` export / scope loads use `skipHistory:true`; D3 `_billingGateApplier` null@170→set@9693; `state.js` exists with no importers; `debugger-old.js` unreferenced; `openUpdatesScreen`/`openRoadmapScreen` DOM-wired (not dead); no jsdom dependency; single IIFE at `2181–9921` with construction-time global mutation at 6635.

**Needs reproduction before being treated as a manifesting defect:** the *user-visible* trigger path for C1.3 (Ctrl+Z reachability after a switch); whether the duplicated `visibilitychange`/`focus`/`storage` handlers actually double-fire; the real-world window in which the C1.2 fallback vs. real handler produces divergent stale state; the root-subscriber double-save/stale-preview risk (Copilot D9/root subscriber). These are flagged, not asserted.

**No production code was changed while producing this plan.**
