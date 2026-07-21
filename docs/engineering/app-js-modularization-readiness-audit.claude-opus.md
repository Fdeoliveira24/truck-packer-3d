# `src/app.js` Modularization **Readiness** Audit

**Author:** Independent audit produced by Claude Opus 4.8
**Phase:** 0 — risk analysis only (no code changed, no migration performed)
**Audit date:** 2026-07-21
**Primary file:** `src/app.js` (9,964 lines / ~400 KB at audit time)
**Branch observed:** `feat/inspector-case-notes`
**Scope:** Readiness for modularization — responsibilities, startup, state ownership, dependencies, cycles, side effects, persistence, auth/workspace init, UI/event lifecycle, dead code, real bugs, test gaps, no-touch zones, and safe boundaries.

> **This is a readiness audit, not a modularization plan.** Per the brief, migration steps are only produced if the application is *proven ready*. It is **not**. Section G therefore defines the phases as *gated preparation*, not an extraction runbook. Every recommendation includes its reasoning.
>
> Two prior Phase-0 inventories exist for the same file — `app-js-modularization-inventory.md` (Codex 5.6) and `app-js-modularization-inventory.claude-sonnet-5.md` (Sonnet 5). This document was produced independently from source and the knowledge graph; it deliberately does not reuse their conclusions. Where it overlaps, treat that as corroboration; where it adds the **readiness verdict and the confirmed public-surface bug (BUG-1)**, treat this as the additional signal.

---

## A. Executive summary

`src/app.js` is the application's **root orchestrator**: it is imported by nothing and imports ~40 modules (verified: 0 `export` statements, 0 importers). All of its ~9,900 lines execute as top-level module code plus **one giant IIFE** assigned to `window.TruckPackerApp` (`app.js:2181` … `app.js:9921`). Roughly 7,700 lines live *inside that single closure* and communicate through a large shared lexical scope, not through parameters or exports.

**Readiness verdict: NOT READY for structural extraction.** Three findings drive this, in priority order:

1. **No behavioral test net.** `app.js` is exercised **only by source-text assertions** (`fs.readFile` + regex in `tests/audit/*.spec.mjs`). There is no jsdom/happy-dom harness anywhere in the repo, so the init sequence, workspace-switch state machine, billing pump, auth gate, org-context reconciliation, and cross-tab sync — the exact P0 surfaces this file is made of — have **zero runtime coverage**. Extracting code cannot be validated for regressions today.
2. **Tests are source-coupled to the file.** Several invariant tests assert the *literal presence of named functions/strings inside `app.js`* (e.g. `renderInviteHandoffNotice`, `_isConfirmedUserSwitch`). Moving those symbols out will cause **false test failures** even when behavior is preserved — inviting someone to weaken the guards, which is the opposite of what a migration needs.
3. **A confirmed public-surface bug already lives in the seam that a migration would touch** (BUG-1, below). The current runtime behavior depends on an *accidental* quirk of IIFE construction order. Any "obvious cleanup" during modularization would silently change behavior.

The file is large but **not chaotic**: it already contains 11 named internal sub-modules (`Utils`, `AccountSwitcher`, `TrailerGeometry`, `Data`, `AppShell`, `ExportService`, `UpdatesUI`, `RoadmapUI`, `SettingsUI`, `KeyboardManager`, `OrgContext`) plus `BootState`. These are honest future seams. But they **capture the shared closure**, so extraction is a *semantic* change (converting implicit captures into explicit dependency injection), never a mechanical cut-and-paste. Reducing file size is the least important goal here; **preventing regressions in auth/billing/workspace/cross-tab is the whole game.**

**Bottom line:** Do the preparation work in Section F first. Do not extract anything until a behavioral harness exists for the P0 flows and BUG-1 is resolved as a deliberate decision.

---

## B. Current architecture map

### B.1 Physical layout of the file

| Region | Lines (approx) | Contents | Scope |
|---|---|---|---|
| Imports | 48–94 | ~40 `import`s (see B.4) | module |
| Billing state + entitlement machinery | 103–383 | `_billingState` object, subscribers, entitlement normalizers, throttle/timeout constants, auth-revocation timers | **module scope** |
| Cross-tab billing coordination (Rule C) | 384–~908 | storage-lock helpers, `BroadcastChannel`, snapshot apply/broadcast, cross-tab signature dedupe | **module scope** |
| Billing pump API + org-for-billing helpers | ~909–2015 | `refreshBilling`, `getProRuleSet`, `startCheckout`, `openPortal`, `ensureWorkspaceReadyForUI`, accessors | **module scope** |
| Runtime fatal handlers / `markAppReady` | 2016–2180 | `TP3D_BUILD_STAMP`, `showFatalOverlay`, `installRuntimeFatalHandlers`, `BootState` IIFE (2034) | module scope |
| **Main IIFE → `window.TruckPackerApp`** | **2181–9921** | Everything below; a single closure returning the public API | **IIFE closure** |
| Bootstrap tail | 9922–9964 | `checkBrowserSupport`, `boot`, `DOMContentLoaded` wiring | module |

Only **4 `// SECTION:` banners exist, all before line 384.** The remaining ~9,500 lines have no structural markers — navigation relies on function names alone.

### B.2 Inside the main IIFE (2181–9921)

Two organizational styles coexist:

**(a) Named internal sub-modules** (self-contained `X = (() => {…})()` blocks — the natural seams):

| Sub-module | Line | Notes |
|---|---|---|
| `Utils` | 2196 | local util facade |
| `AccountSwitcher` | 2961 | **forward-declared `let` at 2185**, assigned at 2961 |
| `TrailerGeometry` | 3168 | geometry/presets |
| `Data` | 3419 | data facade |
| `AppShell` | 3455 | shell/layout |
| `ExportService` | 3632 | **forward-declared `let` at 2189**, assigned at 3632 |
| `UpdatesUI` | 4279 | "what's new" screen |
| `RoadmapUI` | 4326 | roadmap screen |
| `SettingsUI` | 4373 | settings glue |
| `KeyboardManager` | 4445 | global shortcuts |
| `OrgContext` | ~5928 | exposed as `window.OrgContext` (5928) |
| `EditorUI` | (returned in public API) | editor glue |

**(b) A flat sea of ~102 IIFE-scope functions** (lines ~4700–9905) with no module wrapper. The dominant clusters:

- **Workspace storage scoping / seeding:** `getWorkspaceStorageScope` (4843), `applyWorkspaceScopedLocalState` (4864), `seedIfEmpty` (4919), `resetAppStateToEmpty` (4969), `loadScopedStateOrSeed` (4987).
- **Runtime + render:** `validateRuntime` (5041), `renderAll` (5097), `syncRecoverableErrorOverlay` (5117).
- **Workspace-switch state machine:** `beginWorkspaceSwitch` (5261), `finishWorkspaceSwitch` (5285), `markWorkspaceSwitchReady` (5301), `scheduleWorkspaceSwitchTimeout` (5248), `handleIncomingWorkspaceSwitchState` (5361, cross-tab).
- **Auth gate:** `authGateIsSettled` (5491), `authGateSignedIn` (5496), `authGateSignedOutCandidate` (5523), `authGateInitialSession` (5628), `getCurrentAuthSnapshot` (5758).
- **Org context:** `setActiveOrgId` (5822), `dispatchOrgContextChanged` (5987), `handleIncomingOrgContextSync` (6061, cross-tab), `applyOrgContextFromBundle` (7043), `refreshOrgContext` (7204).
- **Billing pump / workspace lifecycle:** `maybeScheduleBillingRefresh` (6196), `handleOrgAccessLoss` (6367), `handleWorkspaceLeft` (6432), `handleWorkspaceArchived` (6468), `handleWorkspaceRestored` (6504), `handleOwnershipTransferred` (6550), `handleWorkspaceUpdated` (6587).
- **Auth rendering / user-switch isolation:** `applyOrgRequiredUi` (6853), `rehydrateAuthState` (7446), `applyUserSwitchIsolation` (7608), `renderAuthState` (7645), `_executeSignedOutCleanup` (7820), `checkProfileStatus` (7916).
- **Entrypoint:** `init` (8031) — idempotent via `initInFlightPromise`/`initCompleted`; body 8031–9905 also inlines the billing-notice/paywall DOM builders (the cluster of `addEventListener`s at 8300–9700).

### B.3 Runtime startup sequence (verified)

```
<script type=module> loads app.js
  │  module-scope side effects execute immediately, in order:
  │    • initTP3DDebugger()                    (app.js:100)
  │    • _billingState / subscribers created   (106+)
  │    • window.addEventListener('storage', _handleCrossTabBillingStorageEvent)  (805)
  │    • installVisibleAuthRevocationCheck wiring, BootState IIFE (2034)
  │    • main IIFE runs → builds window.TruckPackerApp (2181–9921)
  │         └─ during construction: temp global mutation at 6635 (see BUG-1)
  ▼
DOMContentLoaded (or immediate if already loaded)  (9958)
  └─ boot()                                    (9944)
       ├─ maintenanceMode short-circuit (window.__TP3D_FLAGS__)
       ├─ checkBrowserSupport()                (9924)
       └─ window.TruckPackerApp.init()         (8031)
            ├─ guard: initInFlightPromise / initCompleted (idempotent)
            ├─ validateRuntime()               (5041)  → markAppReady + return on failure
            ├─ installDevHelpers(...)
            ├─ seedIfEmpty()
            ├─ clear stale reload latch (sessionStorage)
            ├─ bootstrapAuthGate()             (async auth/session/org/billing hydration)
            └─ markAppReady()
       └─ .catch → showFatalOverlay(normalizeFatalMessage(err))
```

**Observation:** startup truth is split across *three* lifecycles — synchronous module side effects, synchronous IIFE construction (which itself mutates a global, BUG-1), and the async `init()`. Any extraction must preserve this ordering exactly.

### B.4 Dependency map (imports)

`app.js` imports ~40 modules. The highest-risk dependencies (P0 areas per `CLAUDE.md`):

- **Auth/session/billing truth:** `core/supabase-client.js`, `core/session.js`, `auth/session.js` (indirect), `data/services/billing.service.js`.
- **State/persistence:** `core/state-store.js`, `core/storage.js`, `core/normalizer.js`, `core/defaults.js`, `core/events.js` (`on`/`emit`).
- **UI orchestration:** `ui/overlays/settings-overlay.js`, `ui/overlays/auth-overlay.js`, `ui/overlays/account-overlay.js`, `ui/ui-components.js`, `ui/truck-change-controller.js`, `ui/table-footer.js`, `screens/editor-screen.js`, `screens/packs-screen.js`, `screens/cases-screen.js`.
- **Domain services:** `services/autopack-engine.js`, `services/import-export.js`, `services/pack-library.js`, `services/case-library.js`, `services/category-service.js`, `services/preferences-manager.js`.
- **Editor runtime:** `editor/scene-runtime.js`.

`app.js` is a **god node** in the graph (`js()` / `copy()` community 7). It is the convergence point of the "Core App Runtime" community.

---

## C. Risk matrix

Risk = *likelihood a modularization change here causes a production regression* × *blast radius*. "Do not touch" means do not extract in an early phase.

| # | Area (evidence) | Coupling | Test net | Blast radius | Readiness risk | Verdict |
|---|---|---|---|---|---|---|
| R1 | **Main IIFE shared closure** (2181–9921) | Extreme — ~7,700 lines share one lexical scope | None (runtime) | Whole app | **Critical** | Do not extract until DI seams + tests exist |
| R2 | **Auth gate + user-switch isolation** (5491–7916) | High — session truth, storage scope, render | None (runtime) | Auth/session P0 | **Critical** | Do not touch early |
| R3 | **Billing pump + entitlement + cross-tab** (103–908, 6196) | High — Stripe/edge truth, storage locks, `BroadcastChannel`, epochs | None (runtime) | Billing P0 | **Critical** | Do not touch early |
| R4 | **Workspace-switch state machine** (5190–5490) | High — versioned, timeout-guarded, cross-tab | None (runtime) | Workspace P0 | **Critical** | Do not touch early |
| R5 | **Org-context reconciliation** (5793–7246) | High — active vs billing org reconcile, cross-tab sync | None (runtime) | Workspace P0 | **High** | Do not touch early |
| R6 | **`window.TruckPackerApp` public surface** (return @9905 + 6635) | High — settings-overlay calls back via globals | None; **BUG-1 present** | Workspace lifecycle | **High** | Fix BUG-1 as prep, then freeze surface |
| R7 | **Persistence: 46 `localStorage` + 13 `sessionStorage` direct hits** | Medium — scope keys per workspace | None (runtime) | Data isolation P0 | **High** | Centralize behind `core/storage` before moving |
| R8 | **Event/timer ownership** (43 listeners, 34 timers) | Medium — duplicated event types across scopes | None | Leaks/dupes | **Medium** | Inventory + own before moving |
| R9 | **Named sub-modules** (`Utils`, `TrailerGeometry`, `Data`, `AppShell`, `UpdatesUI`, `RoadmapUI`, `SettingsUI`, `KeyboardManager`) | Lower — self-contained IIFEs, but still capture closure | None (runtime) | Localized | **Medium** | Candidate *first* seams **after** prep |
| R10 | **Source-coupled invariant tests** | — | Tests assert symbol presence *in app.js* | CI false-fails | **High (process)** | Refactor tests before extraction |
| R11 | **Dead code** (`debugger-old.js`, unreferenced) | None | — | None | **Low** | Safe cleanup, separate PR |

---

## D. Bug list (by severity)

> Confidence is stated explicitly. Only BUG-1 is a *confirmed* code defect; the rest are architectural risks or lower-severity smells.

### 🔴 High — confirmed defect

**BUG-1 — `window.TruckPackerApp` drops `handleWorkspaceLeft`, `handleOwnershipTransferred`, `notifyOrgAccessLoss` at runtime.**

*Evidence (verified):*
- The main IIFE is assigned via `window.TruckPackerApp = (function(){ … })()` (`app.js:2181`). During RHS evaluation, `window.TruckPackerApp` is still `undefined`.
- At **IIFE-construction scope** (4-space indent; a sibling statement between two function declarations), `app.js:6635` runs `window.TruckPackerApp = window.TruckPackerApp || {}` → creates a **fresh temporary `{}`** and attaches 8 handlers (6636–6643): `maybeScheduleBillingRefresh`, `getWorkspaceSwitchState`, `notifyOrgAccessLoss`, `handleWorkspaceLeft`, `handleWorkspaceArchived`, `handleWorkspaceRestored`, `handleOwnershipTransferred`, `handleWorkspaceUpdated`.
- When the IIFE returns (`app.js:~9905`), the return **object literal overwrites** `window.TruckPackerApp` entirely. That literal contains `handleWorkspaceArchived`, `handleWorkspaceRestored`, `handleWorkspaceUpdated`, `maybeScheduleBillingRefresh`, `getWorkspaceSwitchState`, `openCreateWorkspaceFlow`, `init`, `EditorUI`, `ui`, `_debug` — but **not** `handleWorkspaceLeft`, `handleOwnershipTransferred`, or `notifyOrgAccessLoss`.
- Confirmed there is no later re-attachment: the only `window.TruckPackerApp.*` assignments are the 6636–6643 block, and there is no `Object.assign(window.TruckPackerApp, …)` anywhere.

*Runtime effect (verified against callers):*
- `settings-overlay.js:2000` calls `window.TruckPackerApp.handleWorkspaceLeft(...)` behind a `typeof … === 'function'` guard. Because the method is `undefined`, the guard fails and the code takes its **`else` fallback**: `queueAccountBundleRefresh({ force: true, source: 'settings-leave-workspace' })` (`settings-overlay.js:2002`).
- `settings-overlay.js:2300` calls `window.TruckPackerApp.handleOwnershipTransferred(...)` behind the same guard → same silent fallback to a generic bundle refresh.
- `notifyOrgAccessLoss` has **no external callers**, and the internal path uses the closure var `_orgAccessLossHandler` (set at 6644), so its drop is currently **harmless**.

*Impact:* **No crash** (guards + fallbacks), but leaving a workspace or transferring ownership **via Settings never runs the tailored app-level reconciliation** (`handleWorkspaceLeft` @6432 / `handleOwnershipTransferred` @6550). Instead it degrades to a generic account-bundle refresh. Whatever those handlers do *beyond* a bundle refresh — immediate active-org switch away from the departed org, editor/preview reset, billing epoch/pump reset, targeted cross-tab broadcast — **does not happen from the Settings path**. This is precisely the "stale org / stale billing / stale editor leakage" class that `CLAUDE.md` flags as P0.

*Why it also blocks migration:* current behavior depends on an **accidental** construction-order drop. A modularizer "tidying" the two `window.TruckPackerApp` assignments would likely make the return object authoritative and **re-enable** the real handlers — a **silent behavior change** in a P0 area, invisible to the current (source-only) tests. This single bug is the clearest proof the file is not ready to be cut apart safely.

*Recommendation:* Resolve as a **deliberate product decision before any extraction** — decide whether Leave/Transfer should run the real handlers or the bundle-refresh fallback, then make the public surface say so in exactly one place. Do not fold this into a mechanical move.

### 🟠 Medium — architectural defects / smells (not proven runtime failures)

- **BUG-2 — Split, duplicated event ownership.** `visibilitychange` is registered 3× (`app.js:899`, `8594`, `9756`), `focus` 2× (`891`, `9753`), `storage` 2× (`806`, `8599`), across *both* module scope and the IIFE. Likelihood of a real double-handling/leak bug is plausible but **unconfirmed** (handlers may be idempotent). Risk is that during extraction these are easy to double-register or orphan. *Recommendation:* build a listener ownership inventory (Section F) before touching.
- **BUG-3 — Persistence ownership is diffuse.** 46 direct `localStorage` + 13 `sessionStorage` accesses in `app.js` coexist with `core/storage.js`. Workspace-scoped keys (`getWorkspaceStorageKey` @4848) are computed inline. Splitting scope logic from storage access across a future module boundary risks cross-workspace data leakage (a P0 isolation concern). *Recommendation:* route all raw storage access through `core/storage` *before* moving any owner of it.
- **BUG-4 — Ordering coupling via forward-declared `let`s.** `AccountSwitcher` (declared 2185, assigned 2961) and `ExportService` (declared 2189, assigned 3632) rely on execution order within the closure. Extraction that reorders initialization can produce temporal-dead-zone / null-deref regressions. *Recommendation:* make init order explicit before moving these.

### 🟡 Low — hygiene

- **BUG-5 — Dead file `src/debugger-old.js`** (1,063 lines) is unreferenced by `src/`, `index.html`, and `tests/`. Superseded by `debugger.js`. Safe to delete in an isolated PR (not part of any modularization).
- **BUG-6 — Structural markers stop at line 384.** Only 4 `// SECTION:` banners; the other ~9,500 lines are unlabeled. Not a bug, but it materially raises the cost/risk of navigation during migration.

---

## E. Migration blockers

These must be cleared **before** any extraction is authorized. Each is a hard gate.

1. **BLOCKER-1: No runtime test harness.** `npm test` = `node --test tests/audit/*.spec.mjs`. Every `app.js` reference is `fs.readFile(appPath,'utf8')` + string/regex assertions; there is **no jsdom/happy-dom dependency** and comments explicitly note "no jsdom harness for this module." → **There is no way to detect a behavioral regression in the P0 flows.** Extraction without this is uncontrolled risk. *(Reason: modularization's only job here is to not break behavior; without behavioral tests you cannot know if you did.)*

2. **BLOCKER-2: Source-coupled invariant tests.** Tests assert the literal presence of symbols *inside* `app.js` (e.g. `renderInviteHandoffNotice` @`security-and-invariants.spec.mjs:13984`, `_isConfirmedUserSwitch` @`:20804`, plus "app.js must import the AutoPack runtime factory" / "must not import the solver"). Moving those symbols will **fail CI on green code**, pressuring engineers to weaken guards mid-migration. *(Reason: a test suite that punishes correct refactors will either block the work or get gutted — both bad.)*

3. **BLOCKER-3: BUG-1 unresolved.** The public surface of `window.TruckPackerApp` is internally contradictory (imperative attach vs. returned literal). Extraction *will* touch this seam; doing so before deciding intended behavior risks a silent P0 behavior flip. *(Reason: you cannot safely move a boundary whose current behavior is an accident.)*

4. **BLOCKER-4: Shared-closure capture.** ~7,700 lines inside one IIFE read/write shared closure variables (`StateStore`, `Storage`, `EditorUI`, `UIComponents`, dozens of `let`s, billing epochs, org-context version counters). No function can be moved without converting implicit captures to explicit inputs — a design task, not a mechanical one. *(Reason: mechanical extraction here produces `ReferenceError`s or, worse, silently divergent duplicate state.)*

5. **BLOCKER-5: Persistence + listener + timer ownership undocumented.** Until every `localStorage`/`sessionStorage` key, every `addEventListener`, and every timer has a documented owner and teardown, extraction risks cross-workspace leakage, duplicate handlers, and orphaned timers. *(Reason: these are the exact stale-state failure modes `CLAUDE.md` names as P0.)*

---

## F. Recommended preparation work (do this first; still no extraction)

Ordered. Each item states *why*. None of these change runtime behavior except PREP-5, which is a scoped bug fix.

1. **PREP-1 — Stand up a behavioral test harness.** Add jsdom/happy-dom (dev-only) and write characterization tests that *boot the app* and lock current behavior of: init idempotency; workspace switch (same-tab + cross-tab via `storage` event); billing pump throttle/epoch/entitlement gating; auth gate signed-in / signed-out-candidate / initial-session; org-context reconcile (active vs billing org); user-switch isolation. *Why:* this is the safety net BLOCKER-1 requires. Characterization (lock current behavior, even quirks) is correct here — you want to detect *change*, not judge correctness yet.

2. **PREP-2 — Decouple invariant tests from file identity.** Rework the source-string assertions so they check *architecture* (module boundaries, "solver not imported by the orchestrator") rather than "symbol X exists in app.js". *Why:* clears BLOCKER-2 so correct refactors go green.

3. **PREP-3 — Produce three ownership ledgers** (docs, no code): (a) every `localStorage`/`sessionStorage` key + who writes/reads/clears it + workspace-scope rule; (b) every `addEventListener` + target + scope + teardown; (c) every `setTimeout`/`setInterval` + owner + clear path. *Why:* clears BLOCKER-5 and turns BUG-2/BUG-3 from "unknown" into "managed."

4. **PREP-4 — Map the closure-capture surface for the *candidate first seams only*** (`Utils`, `TrailerGeometry`, `UpdatesUI`, `RoadmapUI` — the most self-contained). Document exactly which closure vars each reads/writes. *Why:* converts BLOCKER-4 from "whole file" to a small, provable dependency-injection contract for the lowest-risk pieces.

5. **PREP-5 — Resolve BUG-1 as a standalone, reviewed change** (with a product decision on Leave/Transfer behavior) and add a test that asserts the intended `window.TruckPackerApp` surface at runtime. *Why:* clears BLOCKER-3 and removes the landmine before anyone stands near it.

6. **PREP-6 — Delete `debugger-old.js` in its own PR.** *Why:* removes 1,063 lines of confusing dead code with zero migration risk; keeps later diffs clean.

**Exit criterion for Phase 0 → Phase 1:** PREP-1..5 complete and green; then and only then is extraction of the *lowest-risk* seams authorized.

---

## G. Recommended migration phases (gated; not yet a runbook)

> These are **conditional** and intentionally not step-by-step. Do not begin Phase 1 until the Section F exit criterion is met. Each phase ends with a full P0 manual checklist (owner ×1 workspace, owner ×N, non-owner member, same-tab switch, cross-tab switch, AutoPack gate, PDF-export gate, Settings Billing, Settings Members) plus the PREP-1 behavioral suite.

- **Phase 1 — Leaf, self-contained sub-modules only.** Candidates: `Utils`, `TrailerGeometry`, `UpdatesUI`, `RoadmapUI`. *Rationale:* smallest closure-capture surface (PREP-4), lowest blast radius (R9), touch no P0 state. Extract behind explicit DI; no behavior change.
- **Phase 2 — Presentation-heavy seams.** `SettingsUI` glue, `AppShell`, `KeyboardManager` (listener ownership must come from PREP-3). *Rationale:* mostly UI wiring; still avoids billing/auth/workspace truth.
- **Phase 3 — Persistence facade.** Route the 46+13 raw storage accesses (BUG-3) through `core/storage`, then move workspace-scope helpers. *Rationale:* isolation-critical; must have PREP-3 ledger + tests first.
- **Phase 4 — DO NOT PLAN YET: auth gate, billing pump, workspace-switch machine, org-context reconcile, cross-tab sync** (R2–R6). *Rationale:* highest-risk P0 cores. Only after Phases 1–3 prove the harness catches regressions, and only with a dedicated design for each state machine's ownership. Re-audit before scoping.

---

## Appendix — Confirmed facts vs. inferred

**Confirmed by direct inspection:** file size (9,964 L); 0 exports / 0 importers; IIFE bounds (2181–9921); BUG-1 construction-order drop and the two guarded callers in `settings-overlay.js`; `debugger-old.js` unreferenced; test mechanism is `fs.readFile` string assertions with no jsdom dependency; counts — 40+ imports, 102 IIFE-scope + 76 module-scope function decls, 43 `addEventListener`, 34 timers, 46 `localStorage` + 13 `sessionStorage`, 4 `// SECTION:` banners; sub-module seam line numbers.

**Inferred (needs confirmation before acting):** the *specific* extra work `handleWorkspaceLeft`/`handleOwnershipTransferred` do beyond a bundle refresh (implied by their existence and P0 context, not line-by-line traced here); whether the duplicated `visibilitychange`/`focus`/`storage` handlers actually double-fire in practice (BUG-2 is a risk, not a proven failure). These are flagged, not asserted.

**No production code was changed while producing this audit.**
