# App.js Modularization Master Execution Plan

**Status:** Proposed — awaiting explicit approval. No extraction phase may begin until this plan is
authorized and Phase M0 completes.

**Date:** 2026-07-23

**Branch:** `chore/app-js-modularization-plan`

**Authoritative inputs (source of truth):**

- `docs/engineering/app-js-preparation-change-policy.md` — change policy
- `docs/engineering/app-js-prep-0-baseline-record.md` — PREP-0 baseline record
- `docs/engineering/app-js-public-facade-and-compatibility-contract.md` — PREP-2 facade contract
- `docs/engineering/app-js-runtime-invariants.md` — PREP-3 runtime invariants
- `docs/engineering/app-js-ownership-ledger.md` — PREP-4 ownership ledger
- `docs/engineering/app-js-dependency-graph.md` — PREP-5 dependency graph

**Convention:** Claims in this plan are traceable to the documents above, cited by document and
section. Statements not directly supported by them are explicitly marked **Inference.** Line-number
references repeated here are copied from the preparation documents; those references drift between
preparation passes (for example, the temporary-facade assignment is cited at `src/app.js:6664` in
PREP-2 and `src/app.js:6851` in PREP-5). The behavioral contract, not the line number, is
authoritative.

**Relationship to the change policy:** The change policy forbids selecting an extraction order
"unless and until a separate Master Execution Plan is authorized." This document is that plan.
Approval of this plan does not waive any other rule in the change policy: every phase below still
requires its own branch, its own reviewed brief with an exact allowed-file list, and the change
policy's review, validation, and stop-condition discipline.

---

## 1. Purpose

This document answers one question: **what is the safest sequence for modularizing `src/app.js`
with the lowest regression risk?**

### 1.1 Scope

- Sequencing, risk management, rollback, and acceptance gating for moving code currently defined
  inside `src/app.js` into separate modules.
- Only responsibilities catalogued in the PREP-4 ownership ledger are in scope; this plan invents
  no new responsibilities and no new behavior.
- Documentation only. This plan changes no production code, no tests, and no configuration.

### 1.2 Goals

1. Reduce `src/app.js` to a composition root: imports, construction order, facade assembly,
   `init()`/`boot()` lifecycle, and cross-domain orchestration — with domain and UI logic moved to
   modules that follow the repository's existing factory pattern (PREP-5 §1).
2. Preserve all observable behavior. Every phase is a code *move*, never a behavior change.
3. Preserve every browser-visible contract: the three facades, events, storage families,
   BroadcastChannels, and initialization ordering, per the PREP-2 preservation gates (§16).
4. Keep DEF-001 through DEF-011 behavior protected as the regression baseline (PREP-0; PREP-3).
5. Keep every phase independently reversible with a clean rollback boundary.

### 1.3 Non-goals

- No behavior changes of any kind, including "obvious" fixes discovered mid-extraction (change
  policy: stop conditions apply instead).
- No facade member additions or removals. `handleWorkspaceLeft`, `handleOwnershipTransferred`, and
  `notifyOrgAccessLoss` remain exactly as PREP-2 §5.4 leaves them: unresolved/private.
- No merging or renaming of `window.TruckPackerApp`, `window.OrgContext`, `window.__TP3D_BILLING`
  (PREP-2 §4, §17).
- No initialization reordering, no in-process retry support, no teardown redesign, no change to
  reload-only fatal recovery (PREP-3 §2, §12).
- No change to the StateStore singleton model or persistence scope model (change policy, forbidden
  list).
- No shared async-coordination utility replacing the three independent capture/re-validate
  implementations — PREP-4 §24 explicitly identifies that as an architecture change, not a move.
- No dead-code removal, warning cleanup, formatting, or "adjacent tidying" mixed into any phase.
- No test weakening. Location-based test assertions may be converted to equivalent behavior
  assertions only under the change policy's existing allowance, in their own reviewed commits.

### 1.4 Success criteria

- All phases M0–M8 complete with every acceptance gate in Section 9 green.
- `src/app.js` contains only the composition-root responsibilities described in Section 10.
- The PREP-2 §16 preservation-gate checklist passes for every surface at the end state.
- Automated results at or above the PREP-0 verification baseline (full suite 1,140 passed /
  5 skipped / 0 failed, typecheck passed, lint 0 errors — plus all tests added since PREP-0).
- The PREP-1 behavioral characterization suite and the DEF-001–011 regression evidence remain
  green throughout, unmodified except under the change policy's behavior-equivalent-assertion
  allowance.
- No numeric line-count target is part of the success definition. **Inference:** the file is at
  least ~10,250 lines (the largest line reference cited in the preparation documents is
  `src/app.js:10243`); success is measured by the extraction-unit list being completed with green
  gates, not by hitting a size number.

---

## 2. Current State Summary

Reference summary only — the cited documents are authoritative and are not duplicated here.

- **Stabilization is complete.** DEF-001 through DEF-008 landed before PREP-0, with a verified
  green baseline (full suite 1,140/5/0, typecheck, lint, signed-out browser validation) recorded
  in the PREP-0 baseline record. DEF-009 (stale auth-user results), DEF-010 (cross-tab workspace
  readiness ordering), and DEF-011 (billing action redirect context) landed afterward and are
  characterized (PREP-3 §3, §4, §6, §14).
- **Behavior is characterized.** The PREP-1 real-browser harness covers signed-out boot,
  repeated-init ownership, signed-in boot, token refresh, A-B-A user switching, same-tab and
  cross-tab workspace switching, workspace readiness, failed org-bundle recovery, stale billing
  results, authoritative generation ownership, offline/online recovery, and
  unexpected-failure/reload-only recovery (PREP-2 §15; PREP-3 §14).
- **Contracts are catalogued.** PREP-2 defines the three preserved facades, every compatibility/
  internal/diagnostic/vendor/test-only surface, all event names, both BroadcastChannels, all
  storage families (including legacy billing mirrors), the 14-step initialization sequence, and
  ten modularization preservation gates (§16).
- **Ownership is mapped.** PREP-4 documents 25 responsibility areas with exclusive-vs-orchestrated
  ownership, per-area extraction difficulty, six highest-coupling groupings, and three unknown
  ownership areas (initializer idempotency, listener duplicate-guards, timer safety patterns).
- **Dependencies are mapped.** PREP-5 documents 36 static imports (39 bindings), all under `src/`,
  with no static import cycles; one runtime circular *coupling* (settings-overlay ↔ app.js via
  browser globals); a confirmed single-owner rule for every examined piece of state; and a
  13-step runtime boot order in which the entire facade-building IIFE runs in one synchronous
  turn.
- **The largest open unknown** is per-module idempotency of the ten calls in the unguarded
  initializer block (`src/app.js:9049-9058`) — established as a constraint on retry support, not
  on code movement, because no phase in this plan changes when or how often those calls run
  (PREP-3 §8, §13; PREP-4 §12).

---

## 3. Modularization Principles

1. **Preserve behavior.** Every phase moves code; observable behavior before and after each phase
   is identical.
2. **Preserve public contracts.** The PREP-2 §16 gates are hard gates for every phase that touches
   a documented surface.
3. **One responsibility at a time.** Each phase maps to one PREP-4 ownership area or one
   explicitly coordinated group from PREP-4's "highest-coupling areas" list — never an ad-hoc
   slice.
4. **Small reversible commits.** One branch per phase; atomic single-purpose commits; recorded
   verified baseline after each phase (change policy, branch and commit discipline).
5. **No mixed refactors.** A move commit contains a move. Behavior fixes, cleanup, formatting, and
   dead-code removal are separate, separately approved work.
6. **Characterization remains authoritative.** The PREP-1 suite plus DEF-001–011 regression
   evidence gate every phase. A characterization failure is a stop condition, not something to
   patch around.
7. **Runtime invariants cannot change.** The PREP-3 §12 compatibility list — init single-flight
   and settlement semantics, reload-only recovery, the auth/billing/workspace guard mechanics and
   their exact check orders — is preserved verbatim.
8. **Existing production fixes remain protected.** DEF-001 through DEF-011 outcomes are the
   regression baseline; no phase reopens them.
9. **Move code, not timing.** Extracted modules must be side-effect-free at import/evaluation
   time. All construction, listener installation, channel creation, and global assignment continue
   to happen from `src/app.js` at their current documented sequence positions (PREP-2 §13; PREP-5
   runtime dependency graph). This matches the repository's dominant factory pattern (PREP-5 §1)
   and is what keeps the 14-step initialization contract byte-compatible.
10. **Modules receive dependencies; they do not reach back.** Extracted code takes its
    collaborators as factory/constructor arguments or late-bound callbacks — the patterns already
    in use (`TrailerGeometry` threaded into imported factories, PREP-5 §1.9; `_billingGateApplier`,
    PREP-3 §5; `AuthOverlay` `onRetry` callbacks, PREP-5 §1.3). No extracted module imports
    `app.js`, keeping the import graph cycle-free as PREP-5 found it.
11. **Facades stay assembled at the root.** `window.TruckPackerApp`, `window.OrgContext`, and
    `window.__TP3D_BILLING` remain assembled and assigned by `src/app.js` at their current points
    in the sequence; extraction moves implementations behind them only.
12. **When in doubt, stop.** The change policy's stop conditions apply unchanged to every phase: a
    newly discovered defect, an ambiguous intended behavior, or a scope that wants to grow ends
    the branch with a documented blocker, not a bigger diff.

---

## 4. Candidate Extraction Units

The 25 PREP-4 ownership areas consolidate into **16 candidate units**: twelve scheduled for
extraction (EU-01–EU-12), one deferred-decision unit (EU-13), one absorbed unit that travels with
others (EU-14), and two retained at the composition root by design (EU-15, EU-16). No
implementation detail is proposed here; per-unit destination files are fixed in each phase's
branch brief.

| Unit | Name | PREP-4 area(s) | Risk |
|---|---|---|---|
| EU-01 | SettingsUI preferences form | §15 | Low |
| EU-02 | UpdatesUI screen | §12 | Low |
| EU-03 | RoadmapUI screen | §12 | Low |
| EU-04 | TrailerGeometry | PREP-5 §1.9 | Low |
| EU-05 | KeyboardManager | §10 | Medium |
| EU-06 | AccountSwitcher | §16 | Medium |
| EU-07 | AppShell / navigation transitions | §11 | Medium |
| EU-08 | Recoverable-error decision logic | §17 | Medium |
| EU-09 | Organization/Workspace context | §4 | High |
| EU-10 | Billing state refresh + cross-tab + channel | §5, §8 | High |
| EU-11 | Checkout/Portal action guards | §6 | Low-Medium code, P0 domain |
| EU-12 | Auth-state reaction and profile enforcement | §3 | High |
| EU-13 | Storage-scope orchestration | §7 | Medium-High (deferred decision) |
| EU-14 | Diagnostics-local globals | §21 | Low (absorbed) |
| EU-15 | Composition root (boot/init, initializer block, fatal overlay, facade assembly) | §1, §12, §18, §19, §20, §22 | Retained |
| EU-16 | Cross-cutting patterns (window events, timers, async coordination, single-flight) | §9, §23, §24, §25 | Retained-with-owners |

### EU-01 — SettingsUI preferences form

- **Current responsibility:** Preferences mini-form (units, theme, label size, hidden-case
  opacity, snapping, screenshot resolution, PDF stats) (PREP-4 §15).
- **Approximate scope:** `src/app.js:4470-4537` (~70 lines) plus its `.init()`/`loadForm()` call
  sites.
- **Primary owner:** Exclusive to `src/app.js`.
- **Dependencies:** `PreferencesManager`, `Storage`, `UIComponents`.
- **Coupling:** Low — PREP-4 rates it "small, self-contained."
- **Risk:** Low. Its `.init()` sits in the unguarded initializer block, so the call position and
  cardinality must not change.
- **Why it exists:** Small screen-level UI written directly in the app file before screen modules
  became the pattern. **Inference** as to historical cause; the ledger documents only the current
  location.

### EU-02 — UpdatesUI screen

- **Current responsibility:** The Updates screen module, defined directly inside `src/app.js`
  (PREP-4 §12, §1.9 of PREP-5).
- **Approximate scope:** Not quantified in the preparation documents. **Inference:** small,
  comparable to a simple screen module.
- **Primary owner:** Exclusive to `src/app.js`.
- **Dependencies:** `StateStore`, `UIComponents` (PREP-4 §12 dependency list).
- **Coupling:** Low.
- **Risk:** Low; same initializer-block constraint as EU-01.
- **Why it exists:** Same pattern as EU-01 — app.js-local screens predating the
  `src/screens/*` factory convention used by Packs/Cases (**Inference**).

### EU-03 — RoadmapUI screen

- Identical profile to EU-02 (PREP-4 §12; PREP-5 §1.9). All fields as EU-02.

### EU-04 — TrailerGeometry

- **Current responsibility:** Truck/trailer geometry definition constructed locally and threaded
  into `createSceneRuntime`, `createCaseScene`, and `createEditorScreen` (PREP-5 §1.9).
- **Approximate scope:** Defined near `src/app.js:3257`. Size not quantified in the preparation
  documents. **Inference:** self-contained definition with a clean constructor-argument boundary.
- **Primary owner:** Exclusive to `src/app.js` (app.js-local).
- **Dependencies:** Consumed by imported factories — the one inverted dependency edge in PREP-5's
  graph (imported modules depending on app.js-local code).
- **Coupling:** Low at the boundary; the consumers already treat it as an injected dependency.
- **Risk:** Low. Moving it *removes* the documented inversion without changing any call.
- **Why it exists:** Geometry lived beside the scene wiring when the scene factories were split
  out, and was left behind as a constructor argument (**Inference**).

### EU-05 — KeyboardManager

- **Current responsibility:** Global keyboard shortcuts — save, undo/redo, select/deselect,
  delete, duplicate, copy/paste, AutoPack, open-pack dialog, grid/shadow toggles, camera focus,
  dev overlay — plus the in-memory clipboard (PREP-4 §10).
- **Approximate scope:** `src/app.js:4542-4802` (~260 lines) plus wiring. **Inference** for the
  wiring beyond the documented range.
- **Primary owner:** Exclusive to `src/app.js`.
- **Dependencies:** `StateStore`, `CaseScene`, `SceneManager`, `InteractionManager`,
  `PackLibrary`, `CaseLibrary`, `AutoPackEngine`, `OperationLifecycle`, `UIComponents`,
  `AppShell`, `Storage`.
- **Coupling:** Medium — reaches directly into editor internals (`CaseScene`, `SceneManager`,
  `InteractionManager`) bypassing `EditorUI`'s own surface (PREP-4 §10; PREP-5 tight-coupling
  item 3).
- **Risk:** Medium. The `mutationBlockedWhileBusy()` gating of mutating shortcuts against
  `OperationLifecycle` is a P0 safety contract (`CLAUDE.md` §6) and must move verbatim. The
  `keydown` listener's install position (initializer block) must not change. Implementation work
  touching selection/AutoPack-adjacent paths must load the repository's AutoPack guard skill
  first, per repo rules.
- **Why it exists:** Shortcuts were wired where every singleton was already in scope — the app
  file (**Inference**; the reach-through coupling itself is documented fact).

### EU-06 — AccountSwitcher

- **Current responsibility:** Account/workspace switcher UI — listing organizations, initiating a
  switch, refreshing on auth/org changes (PREP-4 §16).
- **Approximate scope:** `src/app.js:3050-3230` (~180 lines) plus `refresh()` call sites at
  `src/app.js:2790-2791`, `7233-7234`, and the signed-out cleanup path.
- **Primary owner:** Exclusive to `src/app.js`.
- **Dependencies:** Organization state (EU-09's area), `SupabaseClient` (account bundle),
  `UIComponents`.
- **Coupling:** Medium — its `refresh()` is fanned out from multiple unrelated call sites (auth
  rendering, org-change handling, signed-out cleanup) rather than one subscription.
- **Risk:** Medium. The fan-out call sites stay in `src/app.js` and keep their exact positions;
  only the definition moves.
- **Why it exists:** UI written beside the auth/org code that drives it (**Inference**).

### EU-07 — AppShell / navigation transitions

- **Current responsibility:** Screen show/hide, sidebar collapse, editor-mode class toggling,
  screen transition side effects including the `EditorUI.onActivated()` trigger (PREP-4 §11).
- **Approximate scope:** `src/app.js:3544-3651` (~110 lines) plus the `resize` listener
  (`src/app.js:3583-3587`) and `Router.init()` callback wiring (`src/app.js:10151-10167`).
- **Primary owner:** Shared — `Router` mechanics are already external (`src/router.js`);
  `AppShell` is app.js-local.
- **Dependencies:** `StateStore`, `ErrorOverlay`, `PackLibrary`, DOM element references captured
  at construction, `EditorUI` (facade-contract live compatibility dependency, PREP-2 §5.2).
- **Coupling:** Medium-High — `AppShell.renderShell()` calls `TruckPackerApp.EditorUI.onActivated()`
  after a double-`requestAnimationFrame` deferral (PREP-5 §3), coupling navigation to editor
  readiness and to the facade.
- **Risk:** Medium. DOM capture timing, the double-rAF deferral, and the facade-mediated editor
  activation must be preserved exactly.
- **Why it exists:** The shell is the glue between routing, screens, and the editor lifecycle, so
  it accreted at the composition point (**Inference**).

### EU-08 — Recoverable-error decision logic

- **Current responsibility:** Deciding when the non-fatal error overlay states (route-not-found,
  missing-pack) show or hide — `syncRecoverableErrorOverlay()` and `routeNotFoundActive`
  (PREP-4 §17).
- **Approximate scope:** `src/app.js:5226-5237` plus the `StateStore` subscription wiring near
  `src/app.js:10120-10149`. Small.
- **Primary owner:** Shared — overlay rendering is external (`src/ui/error-overlay.js`); the
  decision logic is app.js-local.
- **Dependencies:** `ErrorOverlay`, `StateStore`, `PackLibrary`, `Router` callbacks, `BootState`.
- **Coupling:** Medium — depends on `Router`, `PackLibrary`, and `StateStore` state
  simultaneously; suppressed by `BootState.fatalOverlayShown`/`maintenanceMode`.
- **Risk:** Medium. The suppression guards against the fatal-overlay system must remain in
  lockstep (PREP-4 §17-18).
- **Why it exists:** The decision needs simultaneous visibility into routing, data, and boot
  state, all of which converge in the app file.

### EU-09 — Organization/Workspace context

- **Current responsibility:** Active-organization resolution and persistence behind
  `window.OrgContext`; org-change fan-out (`tp3d:org-changed`, `tp3d:org-access-lost`,
  `tp3d:workspace-ready`, `tp3d:workspace-switch-state`); workspace-switch lifecycle/readiness
  state; the DEF-010 cross-tab ordering guard (`normalizeWorkspaceSwitchOrder`,
  `compareWorkspaceSwitchOrder`, `recordWorkspaceSwitchOrder`); org storage sync keys and the
  org-context tab identifier (PREP-4 §4).
- **Approximate scope:** Not quantified as a single range. Documented anchors spread across
  roughly `src/app.js:5100-7100` (facade methods near `:5931` per PREP-2 §6.1, switch state
  `:5259-5286`, metrics `:5652`, org-changed `:6000`, access-loss `:6398-6421`, clearOrgContext
  `:6753`, workspace-ready `:7015`). **Inference:** one of the two largest units.
- **Primary owner:** Exclusive to `src/app.js`.
- **Dependencies:** `SupabaseClient` (user identity, account bundle), `StateStore`, `Storage`
  (workspace scope), billing refresh scheduling (`maybeScheduleBillingRefresh`).
- **Coupling:** High — interleaved with billing reconciliation, storage scoping, and auth-user
  checks (PREP-4 §4; coupling group 2 and 3).
- **Risk:** High. P0 workspace-switch safety and cross-tab correctness (DEF-010) live here.
- **Why it exists:** `src/app.js` is the coordination hub where auth, storage, billing, and UI
  meet, and organization context is the pivot among them.

### EU-10 — Billing state refresh, cross-tab coordination, and channel

- **Current responsibility:** `window.__TP3D_BILLING` population; `refreshBilling()` with its
  epoch and organization staleness guards; `clearBillingState()`; authoritative-generation
  refresh; cross-tab lock/freshness (`billing:*` keys plus `tp3d:billing:*` legacy mirrors); the
  `tp3d-billing` BroadcastChannel; the access-gate applier callback (PREP-4 §5, §8).
- **Approximate scope:** Not quantified as a single range. Documented anchors span roughly
  `src/app.js:150-2050` (`_billingEpoch` `:157`, key families near `:408`, channel `:801`,
  `clearBillingState` `:1113-1145`, refresh guards `:1484-1505`) plus the init-time
  `pickCheckoutInterval` augmentation near `:9230`. PREP-4 notes `refreshBilling()` alone spans
  well over 150 lines of guard conditions. **Inference:** comparable in size to EU-09.
- **Primary owner:** Exclusive to `src/app.js`.
- **Dependencies:** `window.OrgContext`/active-org binding, `SupabaseClient` (authority context),
  `billing.service.js` (network), browser `BroadcastChannel` + `localStorage`.
- **Coupling:** High — organization binding (coupling group 2), auth-derived authority, and the
  channel that must travel with the state it carries (PREP-4 §8).
- **Risk:** High. P0 billing correctness, cross-tab freshness, and old-tab compatibility via the
  legacy mirrors.
- **Why it exists:** Billing coordination must exist before the app facade and before `init()`
  (PREP-2 §13), so it was built at the top of the app file's module evaluation.

### EU-11 — Checkout/Portal action guards

- **Current responsibility:** `startCheckout()`, `openPortal()`, `captureBillingActionContext()`
  and the shared `_billingActionGeneration` supersession counter — the DEF-011 pre-navigation
  context re-validation (PREP-4 §6; PREP-3 §6).
- **Approximate scope:** `captureBillingActionContext` at `src/app.js:1914-2012` plus the two
  action functions.
- **Primary owner:** Exclusive to `src/app.js` (exposed on `window.__TP3D_BILLING`).
- **Dependencies:** Reads auth state/epoch (`SupabaseClient`), active org, and billing-private
  state (`_billingState`, `_billingEpoch`).
- **Coupling:** Read-only and narrow (PREP-4 §6) — but it reads *module-private* billing state, so
  it cannot be extracted apart from EU-10 without inventing new access plumbing.
- **Risk:** Code risk Low-Medium; domain is P0 (owner-only money actions, `CLAUDE.md` rule 9).
  The shared generation counter must keep `startCheckout`/`openPortal` together (PREP-4 coupling
  group 6), and the exact `isCurrent()` check order is a preserved invariant (PREP-3 §12).
- **Why it exists:** The guards were added by DEF-011 directly around the existing action
  functions inside the billing closure.

### EU-12 — Auth-state reaction and profile enforcement

- **Current responsibility:** `renderAuthState()` (`src/app.js:7686`), profile-status/ban/deletion
  checks (`checkProfileStatus()`, `src/app.js:8161-8271`), auth-refresh scheduling
  (`requestAuthRefresh`/`runAuthRefresh`/`rehydrateAuthState`), the auth listener call site with
  its `authListenerInstalled` guard (`src/app.js:8719-8721`), and the signed-out cleanup sequence
  `_executeSignedOutCleanup()` (`src/app.js:7879`) (PREP-4 §3).
- **Approximate scope:** Documented anchors span roughly `src/app.js:7600-8750`. **Inference:**
  large.
- **Primary owner:** Shared — session/token mechanics and DEF-009 guards are owned by
  `src/core/supabase-client.js`; the app-facing reaction is app.js-local.
- **Dependencies:** `SupabaseClient`, `AuthOverlay`, `StateStore`, `Storage` (scope), org context
  (EU-09), billing (EU-10), Settings/Account overlays (`handleAuthChange`).
- **Coupling:** High — sign-out cleanup reaches into StateStore reset, storage scope, org
  context, billing state, the user-switch guard, and overlay handlers in one sequence (PREP-4
  coupling group 3).
- **Risk:** High. P0 auth; the cleanup order is load-bearing.
- **Why it exists:** Auth-state reaction is inherently a fan-out across every user-scoped
  subsystem, and the app file is where they all converge.

### EU-13 — Storage-scope orchestration (deferred decision)

- **Current responsibility:** When/how storage scope switches (anonymous/user/workspace), autosave
  suspension, and `flushPendingStorageSave()` around identity and workspace transitions
  (PREP-4 §7).
- **Approximate scope:** Thin orchestration state (`suspendAutoSave`, `hasLoadedScopedState`,
  `lastLoadedWorkspaceStorageKey`) plus call sites embedded in the EU-09/EU-12 sequences.
- **Primary owner:** Shared — mechanics owned by `src/core/storage.js` (P0-risk file); the
  orchestration is app.js-local.
- **Coupling:** Entangled with the sign-out/sign-in and workspace-switch cleanup sequences.
- **Risk:** Medium-High — cross-scope data leakage is the documented hazard class.
- **Disposition:** **Default: remains at the composition root.** The scope-switch calls are steps
  inside cross-domain sequences that this plan deliberately keeps at the root (Section 10). A
  later brief may propose extraction only with a proven safe boundary. **Inference** that
  retention is the lower-risk disposition; the ledger documents the entanglement but prescribes
  nothing.

### EU-14 — Diagnostics-local globals (absorbed)

- **Current responsibility:** `window.__TP3D_ORG_METRICS__` (org lifecycle counters,
  `src/app.js:5652` area), `window.__TP3D_BILLING_TRACE_CURRENT_ID__`, and the debug-only
  `window.getBillingState` alias (`src/app.js:2023` area) (PREP-4 §21).
- **Disposition:** Not a standalone phase. The org metrics travel with EU-09; the billing trace
  ID and debug alias travel with EU-10. Diagnostic classification (visible, never authoritative)
  and wrapper transparency rules (PREP-2 §9.2, §5.3, §7.3) are preserved.
- **Risk:** Low.

### EU-15 — Composition root (retained by design)

- **Current responsibility:** Boot sequence and `init()` single-flight/settlement (PREP-4 §1),
  the unguarded module-initializer block (§12), fatal-overlay decision logic and
  `BootState.fatalOverlayShown` coordination with `index.html`'s preboot script (§18), reload-only
  recovery wiring (§19), assembly of the three facades (§20), and the maintenance-mode flag read
  (§22).
- **Disposition:** **Not extracted.** These stay in `src/app.js` as the composition root. Reasons,
  all documented: the initializer block's per-module idempotency is unestablished (PREP-3 §13),
  `BootState` is the one genuinely bidirectional global shared with `index.html` (PREP-5 global
  graph), facade assembly timing is gated (PREP-2 §16), and boot is the most cross-cutting
  responsibility in the file (PREP-4 §1, "High" difficulty).
- **Risk of retaining:** None new; this is current behavior.

### EU-16 — Cross-cutting patterns (retained with owners)

- **Current responsibility:** Window/document listener installation (PREP-4 §9), timers (§23),
  the epoch/generation async-coordination pattern (§24), and single-flight guards (§25).
- **Disposition:** Each listener, timer, and guard moves with the unit that owns it; none becomes
  a standalone module or shared utility. PREP-4 §24 states a shared implementation would be an
  architecture change; the three capture/re-validate implementations remain independent per
  PREP-3 §10.
- **Risk:** Low as a disposition; the per-owner moves carry their owners' risk.

---

## 5. Dependency Constraints

### 5.1 Hard prerequisites

- **EU-11 requires EU-10** (same phase, same module): the action guards read module-private
  billing state (`_billingState`, `_billingEpoch`). Extracting them separately would require new
  access plumbing that exists today only as closure scope.
- **EU-10 after EU-09.** Every billing refresh binds to the active organization
  (`getActiveOrgIdForBilling()`), and PREP-4 coupling group 2 warns against separating billing
  from its organization-binding guard. Extracting the org module first gives billing a settled
  import target instead of a temporary back-injection into app.js-local code. **Inference:** the
  reverse order is technically feasible via injected accessors; this order is recommended because
  it minimizes throwaway plumbing.
- **EU-12 after EU-09 and EU-10.** `_executeSignedOutCleanup()` orchestrates org, billing,
  storage, and state resets in one sequence (PREP-4 coupling group 3); the auth-reaction move
  should happen when the modules it coordinates already have stable boundaries.
- **EU-08 with or after EU-07.** The recoverable-error decision consumes `Router` callbacks and
  navigation state that EU-07's wiring owns.
- **EU-14 has no phase of its own** — bound to EU-09/EU-10 as described.

### 5.2 Blockers

- **No open blocker exists for pure code moves.** The initializer-idempotency unknown (PREP-3
  §13) blocks retry/teardown redesign — explicitly out of scope — not moves that preserve call
  order and cardinality.
- **Unknown-consumer imports must not be "resolved" during extraction.** `./core/browser.js`,
  `./core/session.js`, `./services/category-service.js`, the `session:changed`/`session:error`/
  `auth:changed` bus events, and the unconfirmed `setInterval` call site are documented unknowns
  (PREP-5 Unknowns). They are left exactly as-is; investigating them is deferred work
  (Section 11).
- **Stop conditions are standing blockers:** any phase that surfaces a new defect, an ambiguous
  behavior, or an unavoidable touch on an unbriefed frozen file halts per the change policy.

### 5.3 Independent work

- EU-01, EU-02, EU-03, EU-04 are mutually independent and independent of everything else.
- EU-05 (Keyboard) and EU-06 (AccountSwitcher) are independent of each other and of EU-07/EU-08.
- EU-07+EU-08 are independent of the domain trio (EU-09/10/12).

### 5.4 Parallelizable work

- Within Phase M1, the four leaf units are order-independent; within the M2–M4 band, the phases
  are order-independent among themselves.
- **Inference (practical constraint):** every phase edits `src/app.js` heavily, so logically
  parallel phases should still *land* serially — each new phase branch starts from the last
  reviewed, verified commit per the change policy's branch discipline. "Parallelizable" here
  means the order among them is free and any of them can be pulled forward or pushed back without
  breaking prerequisites, not that concurrent branches on the same 10,000-line file are advisable.

### 5.5 Constraint graph

```text
M1 (EU-01..04)  ──┐        [independent leaves]
M2 (EU-05)      ──┤
M3 (EU-06)      ──┼──►  M5 (EU-09) ──► M6 (EU-10+11) ──► M7 (EU-12) ──► M8 (verify EU-15)
M4 (EU-07+08)   ──┘        [P0 domain chain — strictly ordered]

EU-13 default: stays at root (decision recorded in M7)
EU-14: absorbed into M5/M6
EU-16: travels with owning phases
```

The arrow into M5 means only "must land before"; M1–M4 have no ordering constraints among
themselves beyond Section 5.4's practical serialization.

---

## 6. Recommended Extraction Order

Nine phases: M0 (gate), M1–M7 (extraction), M8 (consolidation and final audit). Each extraction
phase is one branch, one reviewed brief, atomic commits, and ends with the full Section 9 gate.

### Phase M0 — Authorization and re-baseline (no code)

- **Objective:** Ratify this plan; re-verify the green baseline (full suite, typecheck, lint,
  characterization suite) on the current mainline; record the verified commit hash as the
  modularization baseline; complete the readiness re-audit contemplated by PREP-0's remaining-work
  item 7 against the controlling preparation plan's gates.
- **Why now:** The change policy requires a recorded, clean starting point before any branch, and
  the plan itself must be an approved artifact before extraction order becomes actionable.
- **Expected app.js reduction:** None.
- **Compatibility concerns:** None.
- **Rollback boundary:** Nothing to roll back.
- **Completion criteria:** Plan approved; baseline validation green and recorded; per-phase brief
  template agreed (allowed files, risk statement, verification list, rollback note).

### Phase M1 — Leaf UI extractions (EU-01, EU-02, EU-03, EU-04)

- **Objective:** Move the four lowest-risk app.js-local definitions (SettingsUI preferences form,
  UpdatesUI, RoadmapUI, TrailerGeometry) into their own modules, one atomic commit per unit, with
  every call site, call order, and `.init()` position unchanged.
- **Why now:** Lowest coupling, no P0 surface, and it establishes the mechanical pattern for every
  later phase — factory export, side-effect-free import, construction from the root at the
  current sequence position — where a mistake is cheapest.
- **Expected app.js reduction:** ~70 documented lines for EU-01; the rest unquantified.
  **Inference:** several hundred lines total.
- **Compatibility concerns:** Initializer-block call order and cardinality (PREP-3 §8);
  TrailerGeometry must keep its exact constructor-argument shape for `createSceneRuntime`/
  `createCaseScene`/`createEditorScreen`.
- **Rollback boundary:** Each unit's single commit reverts independently; the phase branch as a
  whole reverts cleanly before or after merge.
- **Completion criteria:** Section 9 universal gate; diff review confirms move-only.

### Phase M2 — KeyboardManager (EU-05)

- **Objective:** Move `KeyboardManager` to a module receiving its eleven documented dependencies
  as injected arguments, preserving the shortcut map, clipboard, `OperationLifecycle` gating, and
  the single `keydown` installation from the same initializer-block position.
- **Why now:** Self-contained IIFE object with real interaction surface — it proves the
  injected-dependency pattern against editor internals before any P0 domain moves.
- **Expected app.js reduction:** ~260 documented lines plus wiring (**Inference** for wiring).
- **Compatibility concerns:** `mutationBlockedWhileBusy()` semantics per `CLAUDE.md` §6 (which
  shortcuts are gated vs intentionally not, per the code comment at `src/app.js:4584-4587`);
  direct reach-through into `CaseScene`/`SceneManager`/`InteractionManager` is preserved as-is —
  rerouting it through `EditorUI` is deferred work, not part of the move.
- **Rollback boundary:** Single-phase revert; no other phase depends on it.
- **Completion criteria:** Universal gate plus a manual shortcut matrix including
  mutation-blocked-while-busy behavior.

### Phase M3 — AccountSwitcher (EU-06)

- **Objective:** Move `AccountSwitcher` to a module; the three documented `refresh()` call sites
  remain in `src/app.js` and keep their exact positions.
- **Why now:** Next-lowest self-contained unit; exercises the pattern of an extracted module still
  being driven by root-owned fan-out call sites (which later phases M5/M7 will relocate with
  their own areas).
- **Expected app.js reduction:** ~180 documented lines plus wiring (**Inference** for wiring).
- **Compatibility concerns:** `refresh()` fan-out timing from auth rendering, org-change handling,
  and signed-out cleanup must be unchanged; diagnostic exposure via `getAccountSwitcher()` stays.
- **Rollback boundary:** Single-phase revert.
- **Completion criteria:** Universal gate plus manual check of switcher rendering across sign-in,
  workspace switch, and sign-out.

### Phase M4 — AppShell and recoverable-error decision (EU-07 + EU-08)

- **Objective:** Move `AppShell` and `syncRecoverableErrorOverlay()`/`routeNotFoundActive` to
  modules, preserving DOM-capture timing, the double-`requestAnimationFrame` deferral before
  `EditorUI.onActivated()`, `Router.init()` callback wiring position, and the
  `BootState`-suppression guards.
- **Why now:** Last of the non-P0 UI band; it touches the facade-mediated editor activation
  (PREP-2 §5.2 live compatibility dependency), so it deserves its own phase after the pattern is
  proven and before domain moves begin.
- **Expected app.js reduction:** ~110 documented lines for AppShell plus the small §17 logic
  (**Inference:** modest).
- **Compatibility concerns:** `TruckPackerApp.EditorUI.onActivated` call path (PREP-2 §5.2);
  sidebar/resize behavior; fatal-vs-recoverable overlay suppression lockstep (PREP-4 §17-18).
- **Rollback boundary:** Single-phase revert.
- **Completion criteria:** Universal gate plus manual navigation matrix (screen transitions,
  editor activation, route-not-found, missing-pack, sidebar collapse).

### Phase M5 — Organization/Workspace context (EU-09, absorbing EU-14's org metrics)

- **Objective:** Move the organization/workspace implementation — org context state, DEF-010
  ordering guard, event dispatch, storage sync, metrics — into a module. `src/app.js` continues
  to construct it and assign `window.OrgContext` at the current sequence position (before the
  final `TruckPackerApp` assignment, PREP-2 §6.3/§13). Billing scheduling is supplied as an
  injected callback, mirroring the existing late-bound-callback pattern.
- **Why now:** First P0 domain move. Doing organization before billing gives M6 a settled import
  target (Section 5.1) and confines the hardest cross-tab surface (DEF-010) to one phase with the
  full characterization suite already covering it.
- **Expected app.js reduction:** Unquantified; **Inference:** one of the two largest.
- **Compatibility concerns:** `window.OrgContext` surface and assignment timing; `tp3d:org-changed`,
  `tp3d:org-access-lost`, `tp3d:workspace-ready`, `tp3d:workspace-switch-state` names, payloads,
  and dispatch timing; `tp3d:active-org-id`, `tp3d:org-context-sync`,
  `tp3d:workspace-switch-state-sync`, `tp3d:org-context-tab-id` keys; the `(transitionAt,
  stateAt, tabId)` acceptance gate and `version` merge semantics (PREP-3 §4); user/org/tab/epoch
  freshness guards; org metrics remain read-only diagnostics.
- **Rollback boundary:** Single-phase revert, provided M6 has not yet landed (Section 8).
- **Completion criteria:** Universal gate plus the workspace manual matrix (Section 9).

### Phase M6 — Billing domain (EU-10 + EU-11, absorbing EU-14's billing trace/alias)

- **Objective:** Move billing state refresh, cross-tab lock/freshness, the `tp3d-billing`
  channel, legacy mirrors, and the checkout/portal action guards into one billing module.
  `src/app.js` invokes its factory at the exact current module-evaluation position, so
  `window.__TP3D_BILLING` is still created at step 8 of the PREP-2 §13 sequence — before
  `TruckPackerApp` and before `init()` — and `pickCheckoutInterval` is still added during
  `init()` at its current point. Two atomic sub-commits: (1) refresh + channel + facade
  population; (2) checkout/portal actions.
- **Why now:** Billing depends on the org boundary settled in M5; keeping refresh, channel, and
  actions in one module preserves the closure-private state the DEF-011 guards read and the
  shared `_billingActionGeneration` counter (PREP-4 coupling group 6).
- **Expected app.js reduction:** Unquantified; **Inference:** comparable to M5.
- **Compatibility concerns:** Facade name, member set, and early availability; channel name and
  `{ type: "billing-result", orgId, state, tabId }` shape; primary `billing:*` keys and
  `tp3d:billing:*` legacy mirrors for already-open older tabs; epoch/org discard behavior with
  re-queue (`refresh:discard-epoch` / `refresh:discard-stale-org`); the exact `isCurrent()`
  pre-navigation check order (PREP-3 §6); debugger wrap-in-place of `refreshBilling` must remain
  possible (PREP-2 §7.3); `maybeScheduleBillingRefresh()` stays a thin facade member on
  `TruckPackerApp`.
- **Rollback boundary:** Sub-commit granularity (actions revert independently of refresh);
  full-phase revert requires M7 not yet landed.
- **Completion criteria:** Universal gate plus the billing manual matrix (Section 9).

### Phase M7 — Auth-state reaction (EU-12; EU-13 disposition recorded)

- **Objective:** Move `renderAuthState()`, profile-status enforcement, and auth-refresh
  scheduling into a module. The auth listener installation call (with its `authListenerInstalled`
  guard) and the `_executeSignedOutCleanup()` orchestration sequence remain at the composition
  root, invoking the extracted org/billing/auth modules' existing entry points in the exact
  current order. Record the EU-13 decision: storage-scope orchestration stays at the root.
- **Why now:** Last of the domain trio by necessity — its cleanup path coordinates every
  previously extracted domain, and moving it first would have meant re-touching it in every
  subsequent phase.
- **Expected app.js reduction:** Unquantified; **Inference:** large.
- **Compatibility concerns:** Listener idempotency guard semantics (the one confirmed guard,
  PREP-3 §8); `AuthOverlay` phase transitions and `onRetry` callbacks; sign-out cleanup order
  across StateStore reset, storage scope, org context, billing state, user-switch guard, and
  overlay `handleAuthChange` calls; `tp3d:auth-signed-out` consumption unchanged; no timed
  reload after signOut (`CLAUDE.md` §10).
- **Rollback boundary:** Single-phase revert (nothing later depends on it except M8's audit).
- **Completion criteria:** Universal gate plus the auth manual matrix (Section 9).

### Phase M8 — Composition-root consolidation and final re-audit (EU-15)

- **Objective:** Verify residual `src/app.js` matches the Section 10 end state; run the complete
  PREP-2 §16 gate checklist across all surfaces; run the full combined manual matrix; update the
  engineering documentation set (a post-modularization baseline record; refresh ownership/
  dependency references where they now point at moved code); update the knowledge graph.
- **Why now:** A single final audit catches cross-phase interactions that per-phase gates cannot.
- **Expected app.js reduction:** Minimal further; consolidation and verification only.
- **Compatibility concerns:** None new; this phase asserts them all.
- **Rollback boundary:** Documentation-only commits; trivially revertible.
- **Completion criteria:** All Section 9 gates green across the board; end-state declaration
  reviewed and recorded.

---

## 7. Risk Register

Risk levels below are relative within this plan. Mitigations marked (all) apply to every phase:
move-only diffs, Section 9 gates, characterization suite, stop conditions.

### Global risks (all phases)

- **Hidden evaluation-time consumers.** PREP-5 could not rule out other modules reading
  app.js-created globals the way `settings-overlay.js` does (PREP-5 Unknowns, final bullet).
  *Mitigation:* each phase brief includes a search for reads of every global the moved code
  creates or consumes, and the characterization suite runs in a real browser where such reads
  would surface.
- **Line-reference drift.** Preparation documents cite line numbers from different passes.
  *Mitigation:* briefs anchor on symbols and behavior, never on line numbers.
- **Static-asset deployment atomicity.** **Inference:** the app ships as static files and
  `index.html` dynamically imports `./src/app.js`; a deploy that serves a new `app.js` while a
  new module file is missing (or stale-cached) would fail boot. *Mitigation:* deploy module files
  and `app.js` together; rely on the existing cache-busting import query; verify a hard-reload
  boot check post-deploy.
- **Mixed-version tabs.** An already-open old tab and a newly loaded tab will coexist after any
  deploy. *Mitigation:* no phase changes storage keys, channel names, message shapes, or event
  payloads, so cross-tab compatibility is version-independent by construction; the legacy billing
  mirrors are explicitly retained (PREP-2 §12.3).

### Per-phase risks

| Phase | Regression | Runtime | Compatibility | Cross-tab | Auth | Billing | Key mitigations beyond (all) |
|---|---|---|---|---|---|---|---|
| M1 | Low | Low | Low | None | None | None | One commit per unit; init-block order asserted by repeated-init characterization test |
| M2 | Medium | Low | Low | None | None | Indirect (AutoPack shortcut) | Manual shortcut matrix; OperationLifecycle gating verified; AutoPack guard skill during implementation |
| M3 | Low-Med | Low | Low | None | Indirect (refresh on auth render) | None | Call-site positions unchanged; sign-in/out manual check |
| M4 | Medium | Medium (rAF/DOM timing) | Medium (`EditorUI` facade path) | None | None | None | Double-rAF preserved; navigation matrix; fatal/recoverable suppression check |
| M5 | High | Medium | High (facade, events, keys) | High (DEF-010, org sync) | Medium (user-scoped checks) | Medium (scheduling callback) | Full workspace matrix incl. cross-tab; DEF-010 tests; injected billing callback identical semantics |
| M6 | High | Medium (module-eval position) | High (facade, channel, mirrors) | High (lock/freshness, old tabs) | Medium (epoch/authority reads) | High | Two sub-commits; billing matrix incl. stale-context error path; legacy-mirror check with a pre-deploy old tab |
| M7 | High | Medium | Medium (overlay callbacks) | Medium (logout propagation) | High | Medium (clear-on-signout) | Cleanup order pinned at root; A-B-A user-switch and cross-tab logout characterization; no timed reload |
| M8 | Low | Low | Low (audit only) | Low | Low | Low | Full combined matrix; PREP-2 §16 checklist sign-off |

### Named regression risks worth calling out

- **M5:** a moved-but-subtly-reordered dispatch could break workspace-switch readiness consumers
  (Settings, browser harness). The `tp3d:workspace-switch-state` timing is contract (PREP-2
  §10.1) and the harness asserts it.
- **M6:** losing closure privacy between refresh state and action guards would force new access
  surface; the single-module rule (EU-11 with EU-10) exists to prevent exactly that.
- **M6:** breaking legacy mirror writes would strand already-open older tabs (PREP-2 §12.3) —
  covered by an explicit old-tab manual check.
- **M7:** reordering any step of `_executeSignedOutCleanup()` risks stale scope leakage across
  users — the sequence stays at the root and is diff-reviewed as unchanged orchestration.

---

## 8. Rollback Strategy

1. **One branch per phase, merged only after gates.** Before merge, rollback is branch
   abandonment — the mainline never saw the change.
2. **Post-merge rollback is `git revert` of the phase's commit range.** Every phase is a
   behavior-neutral code move with no storage-key, schema, message-shape, or event change, so a
   revert restores the previous file layout with no data migration, no cross-tab compatibility
   cleanup, and no user-visible transition.
3. **Atomic commits give sub-phase rollback.** M1 reverts per unit; M6 can revert the
   action-guards sub-commit while keeping refresh, or both.
4. **Dependent phases roll back LIFO.** M6 imports M5's module and M7 relies on both. Reverting
   M5 after M6/M7 landed requires reverting M7, then M6, then M5. Independent phases (M1 units,
   M2, M3, M4) revert in any order at any time. M8 is documentation-only.
5. **The last known good is always explicit.** Per the change policy's commit discipline, the
   verified commit hash and validation results are recorded after every phase; that hash is the
   rollback target and the required base for the next branch.
6. **A stop condition mid-phase is a rollback, not a detour.** If a phase trips a stop condition,
   the branch ends (abandoned or reverted) and the finding becomes its own documented blocker or
   separately approved branch — never an expanded diff.

---

## 9. Acceptance Criteria

### 9.1 Universal gate (every phase M1–M7; M8 runs it plus the final audit)

1. `git status --short` lists only files named in the phase's approved brief;
   `git diff --check` and `git diff --cached --check` are clean.
2. Diff review confirms move-only content: definitions relocated, import/export and injection
   plumbing exactly as briefed, no logic edits, no reordering, no cleanup.
3. `npm test` full suite passes at or above the recorded baseline (PREP-0: 1,140 passed /
   5 skipped / 0 failed, plus all tests added since); `npm run -s typecheck` passes; `npm run
   lint` reports 0 errors.
4. The PREP-1 behavioral characterization suite passes, including the repeated-init ownership
   test (`repeated init preserves first-init listener, timer, channel, network, and auth
   ownership`).
5. DEF-001 through DEF-011 regression evidence is green.
6. The PREP-2 §16 preservation gates are re-checked for every surface the phase touched, with the
   result recorded in the phase's completion note.
7. The knowledge graph is updated after the code change, per repository rules.
8. The verified commit hash and validation results are recorded before the next phase branch is
   cut.

### 9.2 Phase-specific additions

- **M2:** manual shortcut matrix — save, undo/redo, select/deselect-all, delete, duplicate,
  copy/paste, AutoPack shortcut, open-pack dialog, view toggles; mutating shortcuts blocked while
  an operation is busy; non-mutating shortcuts unaffected.
- **M3:** switcher renders correct org list and role after sign-in, after same-tab workspace
  switch, and clears on sign-out.
- **M4:** screen transitions across all screens; editor activation on entering the editor
  (double-rAF path); route-not-found and missing-pack overlays; sidebar collapse on resize;
  fatal overlay still suppresses recoverable overlays.
- **M5 (workspace matrix, per `CLAUDE.md` §14):** owner with 1 workspace; owner with multiple
  workspaces; non-owner member; same-tab workspace switch; cross-tab workspace switch; Settings
  Members/Invites show no stale previous-org data; editor/preview state does not leak across the
  switch; workspace-readiness events observed in order.
- **M6 (billing matrix):** AutoPack gate; PDF export gate; Settings Billing tab; cross-tab billing
  freshness reuse and lock behavior; checkout and portal as owner (navigation) and as non-owner
  (denied); forced stale-context path returns the context-changed error with no navigation; an
  older already-open tab still interoperates via the legacy mirrors.
- **M7 (auth matrix):** sign-in, sign-out, A-to-B-to-A user switch; cross-tab logout; disabled/
  deleted-profile enforcement; storage scope isolation across users (no cross-scope leakage);
  transient signed-out wobble does not wipe org state; no timed reload after signOut.
- **M8:** the full combined matrix (M2–M7 sets) plus the complete PREP-2 §16 checklist across all
  surfaces, signed off in the end-state record.

A phase is complete only when every applicable criterion above is true. The next phase may not
begin from an unrecorded or non-green state.

---

## 10. End State

The end state is the modular organization implied by the preparation documents — no new features,
no new architecture, no changed contracts.

### 10.1 `src/app.js` as composition root

Residual `src/app.js` contains exactly:

- the static imports (now including the extracted modules) and the module-evaluation-time
  construction calls at their current sequence positions, including billing coordination at its
  pre-`TruckPackerApp` position;
- the outer boot IIFE: vendor-readiness wait, synchronous construction of every singleton in the
  current order, `window.__TP3D_UI`, `window.OrgContext` assignment, temporary and final
  `window.TruckPackerApp` assignment;
- `init()` with its single-flight/settlement semantics, `validateRuntime()`, Supabase
  initialization, the unguarded module-initializer block with its exact current call list and
  order, `Router.init()` wiring, `bootstrapAuthGate`, and `markAppReady()`;
- `boot()`, maintenance-mode read, `installRuntimeFatalHandlers()`, fatal-overlay decision logic,
  and reload-only recovery;
- cross-domain orchestration that must see multiple domains at once: `_executeSignedOutCleanup()`
  sequencing and storage-scope switching (EU-13 retained);
- facade assembly for all three preserved facades, with member sets unchanged.

### 10.2 Extracted modules

Twelve units live in modules following the repository's existing directory and factory
conventions (`src/screens/`, `src/ui/`, `src/core/`, `src/services/`, `src/editor/`, `src/data/`).
**Inference:** concrete file names below are proposals only; each phase brief fixes the real
name.

- Updates screen and Roadmap screen modules beside `packs-screen.js`/`cases-screen.js`.
- A settings-preferences form module beside the existing overlay modules.
- A trailer-geometry module beside the scene/editor or data modules.
- A keyboard-manager module.
- An account-switcher module.
- An app-shell module and a small recoverable-error decision module (or one combined
  navigation-shell module, per the M4 brief).
- An organization/workspace context module implementing everything behind `window.OrgContext`.
- A billing module implementing everything behind `window.__TP3D_BILLING`, including the
  channel, mirrors, and checkout/portal actions.
- An auth-reaction module implementing auth-state rendering, profile enforcement, and refresh
  scheduling.

### 10.3 Unchanged by construction

- The three facades' names, member sets, classifications, and assignment timing (PREP-2 §16.2-3).
- All `tp3d:*` events, the internal event-bus names, both BroadcastChannels and message shapes,
  and every storage family including legacy mirrors and the three separate tab identifiers.
- The 14-step initialization sequence and the 13-step runtime boot order.
- Reload-only fatal recovery, init single-flight/settlement, and every DEF-009/010/011 guard with
  its exact check order.
- The StateStore singleton model, persistence scope model, and operation-lifecycle guard system.
- The unresolved facade members remain unresolved: Settings continues to feature-detect
  `handleWorkspaceLeft`/`handleOwnershipTransferred` and fall back to the generic refresh.

---

## 11. Deferred Work

None of the items below blocks M0–M8. Each requires its own problem statement, scope, and
approval per the change policy.

### 11.1 Out of scope (behavior decisions this plan must not make)

- Exposing `handleWorkspaceLeft` or `handleOwnershipTransferred` on the final facade, or deciding
  their permanent absence (PREP-2 §5.4).
- Any public exposure of `notifyOrgAccessLoss` (PREP-2 §5.4).
- In-process `init()` retry, partial-initialization teardown, and the per-module idempotency
  audit of the unguarded block that both would require (PREP-3 §2.4, §8, §13).
- Renaming `initCompleted` or otherwise changing settlement semantics (PREP-3 §13).
- Retiring the legacy billing storage mirrors (PREP-2 §12.3 compatibility window).
- Unifying the three tab identifiers (explicitly prohibited without separate decision, PREP-2
  §12.2).
- Deprecating Supabase aliases (`window.__TP3D_SUPABASE_API`, `window.SupabaseClient`) or the
  raw-client global (PREP-2 §8.1).
- Internalizing `window.__TP3D_LAST_ACCOUNT_BUNDLE` or `window.__TP3D_USER_SWITCH_PENDING`
  (PREP-2 §9.1 compatibility period).
- Replacing wall-clock workspace-switch ordering with a logical clock (PREP-3 §4 residual risk).
- Browser-side reconciliation of stale, unused Stripe sessions (PREP-3 §13).
- Changing billing entitlement semantics, owner-only money actions, or any `/billing-status`
  contract (`CLAUDE.md`).

### 11.2 Future improvements (post-modularization candidates)

- Rerouting `KeyboardManager`'s editor access through `EditorUI`'s own surface instead of direct
  `CaseScene`/`SceneManager`/`InteractionManager` reach-through (PREP-5 tight-coupling item 3).
- Replacing `AccountSwitcher`'s multi-call-site `refresh()` fan-out with a single subscription
  (PREP-4 §16).
- Extracting storage-scope orchestration (EU-13) behind a proven safe boundary.
- A shared async-coordination implementation for the three capture/re-validate sites — explicitly
  an architecture change (PREP-4 §24).
- Consolidating the two fatal-overlay producers (`index.html` preboot vs `app.js`) behind one
  owner (PREP-5 §1.1 notes the shared surface).

### 11.3 Optional cleanup (requires runtime evidence first)

- Resolving the unknown-consumer imports: `./core/browser.js`, `./core/session.js`,
  `./services/category-service.js` (PREP-5 Unknowns).
- Tracing producers/consumers of `session:changed`, `session:error`, `auth:changed`, and
  confirming or ruling out a production `setInterval` call site (PREP-5 Unknowns).
- Deprecating the `window.SettingsOverlay`/`window.AccountOverlay` probes and the
  `tp3d:auth-user-switch-reload` legacy cleanup key after external consumers are ruled out
  (PREP-2 §9.3, §12.4).
- Resolving `tp3d:profile-updated`'s missing consumer (PREP-2 §10.1) and the dormant `v2` storage
  constants (PREP-2 §12.4).
- Auditing duplicate-installation guards for the remaining window listeners and the safety
  pattern for every timer (PREP-4 unknown ownership areas) — valuable evidence for any future
  retry work, but not required for the moves in this plan.
