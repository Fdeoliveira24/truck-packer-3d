# `src/app.js` Modularization Inventory

**Phase:** 0 — audit only  
**Audit date:** 2026-07-21  
**Author:** Audit produced by Codex 5.6 Sl Ultra.  
**Primary file:** `src/app.js` (9,964 lines at audit time)  
**Scope:** architecture, dependencies, state lifecycle, startup order, extraction seams, risks, and
validation requirements

> No production code was changed during this phase.

## 1. Executive summary

`src/app.js` is not only an entry point. It is the application's composition root, a billing
runtime, an authentication and workspace lifecycle coordinator, a state hydration and persistence
coordinator, a router/screen renderer, and the owner of several UI controllers. Its highest-risk
behavior is concentrated around user identity, organization selection, scoped storage, billing
entitlement, cross-tab synchronization, and startup timing.

The file can eventually become a small orchestration root, but extraction must proceed from passive
leaf code toward lifecycle code. The first implementation phases should move static screen data and
isolated UI helpers only after seam-characterization tests exist. Authentication, workspace
switching, scoped state hydration, the root store subscriber, and billing synchronization must
remain late-stage work.

The most important confirmed constraints are:

- There is no static ESM import cycle back into `src/app.js`; no source module imports it. Reverse
  dependencies nevertheless exist through `window.TruckPackerApp`, `window.OrgContext`,
  `window.__TP3D_BILLING`, and other globals.
- Importing `src/app.js` has side effects before `init()` runs: debugger setup, billing globals, a
  `storage` listener, and a `BroadcastChannel` are installed during module evaluation.
- Many factories capture DOM elements before the guarded `DOMContentLoaded` boot callback. This is
  safe today because `index.html` imports the module at the end of `<body>`, and it is an order
  dependency that modularization must preserve or remove deliberately.
- The app uses one module-level `CoreStateStore` singleton through both direct imports and injected
  facades. A piecemeal conversion to instance state would create split-brain state.
- User/workspace changes synchronously isolate identity and replace scoped state under an autosave
  suspension guard. The precise ordering is a security boundary.
- `StateStore.replace(..., { skipHistory: true })` does not clear or rebase undo history. Old-scope
  history can therefore survive a user/workspace replacement and be reached by the global undo
  shortcut. This is a pre-existing P0 hazard to characterize before state-lifecycle extraction, not
  a Phase 0 fix.
- Several methods are assigned to a temporary `window.TruckPackerApp` object while its IIFE is
  evaluating. The final IIFE assignment replaces that object and omits `notifyOrgAccessLoss`,
  `handleWorkspaceLeft`, and `handleOwnershipTransferred`. Their intended public bridges are
  therefore ineffective after composition completes.
- `AutoPackEngine` is constructed before `ExportService`; its preview callback safely closes over
  the later mutable binding. Reordering those constructions can introduce a temporal-dead-zone or
  undefined-service failure.
- `OperationLifecycle` is constructed before editor interaction, AutoPack, truck-change, preview,
  and keyboard consumers. That order protects mutually disruptive editor mutations.
- The exact startup flow, listener cardinality, public global facade, storage scope, and cross-tab
  freshness rules are contracts even where they are not expressed as types.

### Recommended end state

Keep `src/app.js` as the composition and boot root. It should import factories, create shared
runtime objects in an explicit order, inject dependencies, start one authoritative application
lifecycle, expose a deliberately versioned public facade, and hand fatal/ready state back to the
preboot shell. Domain behavior, screen controllers, and lifecycle coordinators should live in owner
modules, but only after their current contracts are protected by tests.

### Evidence used

- A complete line-by-line read of `src/app.js` and its imported lifecycle owners.
- Graphify queries against `graphify-out/graph.json`, followed by targeted source/reference tracing.
- `graphify-out/wiki/index.md` and the Core App Runtime community summary for broad navigation.
- Static searches for imports, function/property consumers, DOM access, StateStore reads/writes,
  event listeners, and global objects.
- Current product constraints in `docs/product/TP3D-MASTER-TODO-V5.md`,
  `docs/product/BILLING_ENTITLEMENT_RULES.md`, and the current repository tests.

Line ranges below describe the audited revision and will drift after future edits.

## 2. Current `app.js` responsibility map

Risk meanings used throughout this document:

- **LOW:** isolated presentation/static behavior with narrow inputs and observable output.
- **MEDIUM:** multiple UI or service dependencies, but limited identity/persistence impact.
- **HIGH:** shared editor, routing, persistence, or timing behavior; regression affects a major
  workflow.
- **VERY HIGH:** authentication, billing, workspace identity, cross-tab state, scoped storage, or
  boot-order behavior; regression can expose or corrupt the wrong user's/workspace's state.

| Responsibility                                                   |  Location | Purpose and current behavior                                                                                                                                                                     | Dependencies                                                                                     | Risk                                         |
| ---------------------------------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Imports and debugger bootstrap                                   |    51–100 | Loads every factory/service used by the composition root and immediately calls `initTP3DDebugger()` during module evaluation.                                                                    | All imported modules; browser global used by debugger.                                           | MEDIUM                                       |
| Billing authority state                                          |   103–382 | Owns `_billingState`, entitlement defaults, authoritative/non-authoritative freshness, user-switch guards, state reset, and billing-state application.                                           | `fetchBillingStatus`, app-local auth/org accessors, `window.__TP3D_BILLING`, timers.             | VERY HIGH                                    |
| Cross-tab billing coordination                                   |   383–808 | Serializes billing snapshots through local storage, `BroadcastChannel`, lock/result records, freshness/version checks, and a top-level `storage` listener.                                       | `localStorage`, `BroadcastChannel`, `storage` event, tab/user/org identity.                      | VERY HIGH                                    |
| Auth-revocation and workspace-ready billing helpers              |  810–1219 | Classifies auth failures, coordinates forced sign-out/access loss, waits for authoritative workspace context, and gates billing reads until auth settles.                                        | Supabase wrapper, late-bound auth truth accessors, org access-loss callback, `CustomEvent`.      | VERY HIGH                                    |
| Billing fetch and entitlement normalization                      | 1221–1872 | Throttles and single-flights `/billing-status`, shares work cross-tab, rejects stale epoch/user/org results, handles 401/access-loss states, applies developer overrides, and derives Pro rules. | Billing service, auth/org accessors, cross-tab layer, UI gate callback, URL/time APIs.           | VERY HIGH                                    |
| Checkout, portal, and billing global facade                      | 1874–2014 | Enforces owner/manage-billing rules, opens checkout/portal, and exposes selected billing methods/state through `window.__TP3D_BILLING`.                                                          | Billing service, browser navigation, toasts, Settings overlay, global consumers.                 | VERY HIGH                                    |
| Pre-composition boot and fatal errors                            | 2016–2181 | Records build metadata, waits for Three.js readiness, creates system/error overlays, tracks boot phases, and installs fatal runtime handlers.                                                    | `window.__TP3D_BOOT`, Three.js loader, DOM, `error`, `unhandledrejection`.                       | HIGH                                         |
| Core facades, toast normalization, event bridge, and session     | 2184–2405 | Adapts imported singletons, normalizes notifications, bridges error/theme events, creates session helpers, installs app/dev helper globals.                                                      | Core utilities/defaults/store/storage/session/events, UI components, debugger globals.           | MEDIUM                                       |
| Overlays and authentication UI                                   | 2407–2513 | Constructs Settings, Account, Card, Help, and Auth overlays and wires overlay callbacks.                                                                                                         | State, preferences, Supabase, billing functions, org getters, DOM.                               | HIGH                                         |
| Canonical logout flow                                            | 2515–2574 | Coordinates user-initiated sign-out, billing reset, UI state, and auth fallback handling.                                                                                                        | Supabase, billing state, Auth overlay, account switcher, timers/location.                        | VERY HIGH                                    |
| Connectivity and offline indicator                               | 2576–2647 | Responds to online/offline state and shows or hides an offline banner.                                                                                                                           | `navigator.onLine`, DOM, `online`/`offline` listeners.                                           | LOW                                          |
| Import-app dialog composition                                    | 2649–2659 | Injects storage, state, preferences, libraries, and refresh callbacks into the app-import dialog.                                                                                                | Import dialog factory, state/storage/libraries, render callbacks.                                | MEDIUM                                       |
| Dropdown/settings/account helpers                                | 2661–2697 | Closes dropdowns, opens Settings, and contains an unused Account-overlay wrapper.                                                                                                                | DOM, Settings/Account overlay objects.                                                           | LOW                                          |
| Workspace creation and account switcher                          | 2699–3142 | Renders identity/workspace UI, creates workspaces, selects organizations, opens settings, logs out, and reflects org/billing state.                                                              | Supabase org APIs, Session, org context, billing refresh, storage, DOM.                          | HIGH                                         |
| Case defaults and application-local trailer geometry             | 3144–3409 | Resolves case colors and provides container-space/capacity/zone conversions used by injected pack/editor logic.                                                                                  | Defaults, trailer presets, unit conversion utilities.                                            | VERY HIGH for geometry; LOW for color helper |
| Pack library facade and static Updates/Roadmap data              | 3411–3450 | Aliases the pack-library singleton and defines static screen content.                                                                                                                            | Pack library; no runtime service for static data.                                                | LOW                                          |
| Application shell and screen routing UI                          | 3452–3562 | Captures shell DOM, binds navigation, shows the active screen, updates topbar/sidebar state, and delegates screen renders.                                                                       | Router, StateStore, all screen controllers, DOM.                                                 | HIGH                                         |
| Scene runtime and case-scene adapter                             | 3564–3581 | Creates the Three.js runtime and the case-scene integration.                                                                                                                                     | `window.THREE`, DOM/editor roots, preferences, state.                                            | HIGH                                         |
| Operation lifecycle and interaction manager                      | 3583–3602 | Creates the authoritative mutation lock before interaction consumers and routes busy-state feedback.                                                                                             | Operation lifecycle, editor screen factory, scene, state, toasts.                                | VERY HIGH                                    |
| AutoPack composition                                             | 3604–3627 | Constructs AutoPack with state, libraries, geometry, operation lifecycle, entitlement gate, persistence, and preview callback.                                                                   | AutoPack service, ExportService late binding, Scene/CaseScene, billing, storage.                 | VERY HIGH                                    |
| Export, preview, screenshot, and PDF service                     | 3629–4188 | Captures workspace-safe previews, screenshots the renderer, gates/render PDFs, and builds cargo instructions/checklists.                                                                         | Scene, state/libraries, operation lifecycle, billing, `THREE`, `jspdf`, canvas/DOM.              | HIGH                                         |
| Import dialogs, truck-change controller, and screens             | 4190–4274 | Constructs pack/case import UI, truck reconciliation, packs/cases/editor screens, and injects shared services.                                                                                   | State, libraries, scene, AutoPack, operation lifecycle, overlays, DOM.                           | HIGH to VERY HIGH                            |
| Updates and Roadmap screen controllers                           | 4276–4368 | Renders static cards into the existing screen containers; their `init` methods are intentional no-ops.                                                                                           | Static data, DOM.                                                                                | LOW                                          |
| Legacy hash Settings screen                                      | 4370–4440 | Reads/writes preferences in the dedicated `#/settings` screen, separate from the Settings overlay.                                                                                               | Preferences manager, storage, scene, DOM.                                                        | MEDIUM                                       |
| Keyboard manager                                                 | 4442–4705 | Handles undo/redo, delete, duplicate/copy/paste, nudge/rotate and editor shortcuts while respecting operation locks and editable targets.                                                        | State, PackLibrary, EditorUI, InteractionManager, OperationLifecycle, browser events.            | HIGH                                         |
| Export/import/help button launchers                              | 4707–4826 | Opens app/workspace/pack/case import/export flows and Help from global buttons.                                                                                                                  | ImportExport, dialogs, overlays, Storage, StateStore, DOM.                                       | MEDIUM                                       |
| Scoped state bootstrap and hydration                             | 4828–5036 | Owns autosave suspension, user/workspace storage scopes, anonymous seeding, scope reset/reload, library repair, and transient state reset.                                                       | StateStore singleton, Storage singleton, defaults, libraries, Preferences, identity/org getters. | VERY HIGH                                    |
| Runtime validation, render fanout, recoverable errors            | 5038–5128 | Validates browser/vendor requirements, renders all screens and shell, and routes recoverable errors without tearing down boot.                                                                   | Browser utilities, vendor globals, every screen, overlays.                                       | HIGH                                         |
| Workspace-switch state and cross-tab metadata                    | 5130–5434 | Tracks readiness/reasons/epochs, records switch metrics, broadcasts state, and resets transient UI around workspace transitions.                                                                 | Org identity, storage, DOM/events, billing pump, screen controllers.                             | VERY HIGH                                    |
| Auth refresh state and stability gate                            | 5436–5781 | Owns auth single-flight/queue state, stabilizes transient signed-out events, snapshots auth truth, and times boot/post-boot gates.                                                               | Supabase session APIs, timers, document visibility, user-switch epoch.                           | VERY HIGH                                    |
| Active organization and `OrgContext`                             | 5793–6170 | Resolves and changes the active org, swaps storage/state, persists profile hints, rolls back failed changes, and applies guarded cross-tab org messages.                                         | Supabase org APIs, Storage/StateStore, local storage events, billing, settings/screens.          | VERY HIGH                                    |
| Billing refresh pump                                             | 6171–6365 | Coalesces and retries refresh triggers based on visibility, online state, auth truth, org readiness, and user/workspace epochs.                                                                  | Billing runtime, auth/org state, timers, `visibilitychange`, online/focus.                       | VERY HIGH                                    |
| Workspace lifecycle and global bridges                           | 6367–6645 | Handles access loss, leave/archive/restore/ownership/update events and attempts to expose handlers on `window.TruckPackerApp`.                                                                   | Supabase, org bundle refresh, billing/state reset, Settings overlay, global facade.              | VERY HIGH                                    |
| Account bundle resolution and no-org UI                          | 6647–7041 | Selects the best active org from hints/memberships, distinguishes partial from confirmed-empty bundles, and disables org-required controls.                                                      | Supabase bundle, profile/local hints, AppShell/screens, DOM.                                     | VERY HIGH                                    |
| Org bundle application and refresh                               | 7043–7245 | Applies bundle truth, changes workspace scope only when needed, schedules rendering/billing, and queues hidden/single-flight refreshes.                                                          | Supabase, org context, storage/state, Settings/Account switcher, billing.                        | VERY HIGH                                    |
| Auth rendering, profile enforcement, and user isolation          | 7247–8026 | Refreshes identity, synchronously isolates different users, handles signed-in/signed-out UI, hydrates scoped state/org data, and enforces profile status.                                        | Supabase, Auth overlay, storage/state, org/billing, all UI controllers.                          | VERY HIGH                                    |
| Main `init()` — Supabase, invite, and auth listeners             | 8028–8767 | Guards one-shot initialization, validates vendors/config, initializes Supabase, installs auth/invite/cross-tab/visibility listeners, and defines bootstrap sequencing.                           | Nearly every app subsystem plus `index.html` globals.                                            | VERY HIGH                                    |
| Component initialization                                         | 8769–8787 | Initializes shell/screens/overlays/switcher/global buttons/keyboard and installs component error boundaries.                                                                                     | All composed UI controllers.                                                                     | HIGH                                         |
| Billing UI, trial, plan, role hydration, and resume hooks        | 8789–9787 | Renders upgrade/payment states, derives role-gated CTAs, coordinates trial dialogs/plan picker, hydrates org roles, and refreshes on focus/Stripe return.                                        | Billing state/service, Settings, account bundle, URL/session storage, DOM.                       | VERY HIGH                                    |
| Root StateStore subscriber                                       | 9797–9869 | Performs autosave, theme/scene/settings updates, preview capture on editor exit, and shell/screen/error render fanout for every state change.                                                    | StateStore, Storage, Scene, ExportService, every screen/overlay.                                 | VERY HIGH                                    |
| Router, initial render, auth gate, public facade, and final boot | 9871–9964 | Initializes hash routing, renders once, awaits auth bootstrap, marks ready, returns the public app API, checks browser support, and invokes `init()` after DOM readiness.                        | Router, BootState, Auth lifecycle, `window.TruckPackerApp`, DOM.                                 | VERY HIGH                                    |

### Responsibilities that should remain in `app.js`

The eventual composition root should continue to own only:

1. Static imports of factories and deliberately shared singletons.
2. Construction/injection order for the top-level dependency graph.
3. One guarded call into the authoritative startup lifecycle.
4. Registration of the intentionally public application facade.
5. Preboot fatal/ready handoff needed by `index.html`.
6. High-level orchestration between lifecycle controllers; no domain implementation.

The current inline implementations of billing, authentication, workspace handling, state hydration,
rendering, and UI controllers should not remain permanently, but they must not be extracted until
their implicit contracts are explicit and tested.

## 3. Dependency map

### 3.1 Static imports

| Category              | Imports                                                                                                                                                                                             | Current use                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Boot/debug            | `./debugger.js`, `./core/dev/dev-helpers.js`, `./core/app-helpers.js`, `./core/version.js`                                                                                                          | Debugger side effects, opt-in dev helpers, public helper facade, build/version reporting.                         |
| Core runtime          | `./core/utils/index.js`, `./core/browser.js`, `./core/defaults.js`, `./core/events.js`                                                                                                              | Units/IDs/cloning, capability checks, default state, and the internal event bus.                                  |
| State and persistence | `./core/state-store.js`, `./core/storage.js`, `./core/session.js`, `./services/preferences-manager.js`                                                                                              | Shared state/history, scoped local persistence, separate session state, and preference mutations/theme events.    |
| Auth/backend          | `./core/supabase-client.js`, `./data/services/billing.service.js`                                                                                                                                   | Client/session/org/invite APIs and billing-status/checkout/portal/invite calls.                                   |
| Domain services       | `./services/category-service.js`, `./services/case-library.js`, `./services/pack-library.js`, `./services/import-export.js`, `./services/autopack-engine.js`                                        | Case/pack/category mutation, file interchange, and packing orchestration.                                         |
| 3D/editor             | `./data/trailer-presets.js`, `./editor/scene-runtime.js`, `./screens/editor-screen.js`, `./core/operation-lifecycle.js`, `./ui/truck-change-controller.js`                                          | Trailer definitions, renderer/scene, interaction/editor controllers, operation locking, and truck reconciliation. |
| Screens               | `./router.js`, `./screens/packs-screen.js`, `./screens/cases-screen.js`                                                                                                                             | Hash routing and primary screen rendering. Updates, Roadmap, and the legacy Settings screen are still inline.     |
| Shared UI             | `./ui/system-overlay.js`, `./ui/error-overlay.js`, `./ui/ui-components.js`, `./ui/table-footer.js`                                                                                                  | Boot/fatal/recoverable feedback and reusable UI primitives.                                                       |
| Overlays/dialogs      | `./ui/overlays/settings-overlay.js`, `account-overlay.js`, `card-display-overlay.js`, `help-modal.js`, `auth-overlay.js`, `import-app-dialog.js`, `import-pack-dialog.js`, `import-cases-dialog.js` | Modal UI and import/auth/settings workflows.                                                                      |

The audited file has 39 static import declarations (45 imported bindings), and every imported
binding has at least one confirmed use. It has no ESM export. No module under `src/` was found to
statically import `src/app.js`; `index.html` is the sole direct runtime loader. Therefore, no ESM
circular dependency involving `app.js` is currently confirmed. This does **not** mean the graph is
acyclic at runtime.

`ensureWorkspaceReadyForUI()` also dynamically imports `./core/supabase-client.js`, even though the
same module is already statically imported. ES module caching means it resolves to the same
namespace, but the promise introduces an async boundary that might be intentional. Do not replace it
mechanically during extraction.

### 3.2 Runtime reverse dependencies and hidden coupling

| Producer/global                                           | Consumers found                                                                             | Coupling concern                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.TruckPackerApp`                                   | `settings-overlay.js`, debugger code, inline AppShell/editor lookups                        | Consumers feature-detect methods rather than import an interface. Temporary-object assignments during IIFE evaluation are later overwritten by the final facade.  |
| `window.OrgContext`                                       | Settings overlay, billing service, AutoPack, debugger, other org-aware UI                   | Active-org identity is ambient. A caller can read it at the wrong point in a workspace transition unless readiness/epoch checks travel with it.                   |
| `window.__TP3D_BILLING`                                   | Settings overlay, billing service, AutoPack, debugger, sidebar/trial UI                     | Combines state access, feature gates, refresh, checkout/portal, and debug behavior. Module extraction can accidentally create two billing authorities.            |
| `window.__TP3D_LAST_ACCOUNT_BUNDLE`                       | Settings and diagnostic paths                                                               | Mutable cache is not an API; partial/confirmed-empty semantics must be preserved.                                                                                 |
| `window.__TP3D_USER_SWITCH_PENDING`                       | Billing service and auth/billing guards                                                     | Security-sensitive synchrony: it prevents old-user billing state from being accepted during an identity transition.                                               |
| `window.SupabaseClient` / `window.__TP3D_SUPABASE_CLIENT` | `app.js` profile-status check and diagnostics                                               | `app.js` imports the namespace but one path calls the global facade, creating an avoidable hidden dependency. Preserve behavior until explicitly migrated/tested. |
| `window.__TP3D_SUPABASE`                                  | `index.html` writes config; `supabase-client.js` merges API properties into the same object | Replacing rather than merging this object would destroy either config or runtime API. It is both configuration and facade.                                        |
| `window.__TP3D_UI`, `window.TP3D.helpers`, debug globals  | Debugger, development tooling, console/manual diagnostics                                   | Public/developer surface may not appear in production reference searches. Treat as compatibility API until catalogued.                                            |

The outer billing runtime also reaches into the inner application IIFE through late-bound
placeholders:

- `_billingGateApplier` is assigned after the billing UI is built.
- `_orgAccessLossHandler` is assigned after workspace lifecycle handlers exist.
- `_authGateIsSettledAccessor` and `_authTruthSnapshotAccessor` are assigned after auth lifecycle
  state exists.
- `_getOrgRoleHydrationStateAccessor` is assigned after role hydration is defined.

These bridges avoid a static cycle but create an initialization-time cycle. Moving either side
independently can cause early calls to use default/no-op accessors or stale authority.

### 3.3 Platform and vendor globals

`app.js` depends on values installed by `index.html` or classic scripts:

- `window.__TP3D_BOOT` and its `threeReady`/vendor/fatal/ready hooks.
- `window.__TP3D_FLAGS__` and `window.__TP3D_SUPABASE`.
- `window.__tp3dVendorAllReady`.
- `window.THREE`, `window.OrbitControls`, `window.TWEEN`, `window.XLSX`, `window.jspdf`, and the
  Supabase UMD global.
- Browser APIs: `window`, `document`, `navigator`, `location`, `history`, `localStorage`,
  `sessionStorage`, `BroadcastChannel`, `CustomEvent`, `DOMException`, `URL`, `URLSearchParams`,
  canvas/WebGL, `requestAnimationFrame`, timers, `matchMedia`, and the Page Visibility API.

Runtime validation checks the required browser/vendor capabilities, but some globals are already
read or captured during composition. Delaying or reordering vendor promises is therefore not
equivalent to extracting a pure module.

### 3.4 DOM ownership

DOM references are captured by inline controllers for:

- the application root, sidebar, topbar, content root, route buttons, and screen nodes;
- account/workspace switcher controls and dropdowns;
- Updates, Roadmap, and legacy Settings controls;
- import/export/help buttons;
- org-required and billing/payment/trial banners/modals;
- editor panels and feature-action buttons;
- invite handoff UI and auth-page branding.

Static analysis found 184 `document` references in the audited file, including 82 element creations
and 43 fixed-ID lookups. Several captures occur when the composition IIFE evaluates, before `init()`
and before the bottom `DOMContentLoaded` guard. The current body-end dynamic import makes those
nodes available. A future extraction must either preserve body-end evaluation or move DOM lookup
into explicit `init()` methods and test missing/late DOM conditions.

### 3.5 Event/listener inventory

| Channel                                          | Current behavior and order concern                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.storage`                                 | Billing coordination installs a listener at module evaluation. Auth/org cross-tab listeners are installed later in `init()`. Records must remain user-, org-, tab-, epoch-, and freshness-guarded.                    |
| `BroadcastChannel`                               | Billing channel is created at module evaluation when supported. Duplicate module/controller creation would create competing responders.                                                                               |
| `window.error` / `unhandledrejection`            | Preboot and runtime layers both participate. Extraction must preserve which errors are fatal versus recoverable.                                                                                                      |
| `online`, `offline`, `focus`, `visibilitychange` | Drive connectivity UI, auth refresh, billing resume, and hidden-tab queues. They are not presentation-only listeners.                                                                                                 |
| `hashchange`                                     | Owned by `Router.init()`; its returned unsubscribe is currently not retained. App init idempotence prevents duplicate installation.                                                                                   |
| `keydown`                                        | Owned by KeyboardManager and guarded by active screen, editable targets, modal/busy state, and operation lifecycle.                                                                                                   |
| `DOMContentLoaded`                               | Bottom boot guard calls `TruckPackerApp.init()`; it does not protect earlier module-evaluation DOM capture.                                                                                                           |
| Custom window events                             | `tp3d:auth-signed-out`, `tp3d:workspace-ready`, `tp3d:org-changed`, `tp3d:org-access-lost`, and `tp3d:workspace-switch-state` connect lifecycle layers. Payload identity and dispatch order are part of the contract. |
| Internal event bus                               | `app:error`, `theme:apply`, storage errors, and `auth:changed` connect state/services/UI. Listener errors are isolated by the event implementation.                                                                   |

Most global listeners do not have a retained teardown path. This is acceptable only while
application initialization and controller construction remain singleton/one-shot. Future modules
should expose teardown for tests and hot/repeated initialization, while preserving one production
installation. Signals intentionally have overlapping owners: two `focus` paths (auth revocation and
billing), three `visibilitychange` paths (auth revocation, auth rehydrate, billing), and two
`storage` paths (billing coordination and auth/org/workspace synchronization). They must not be
casually collapsed.

### 3.6 Initialization-order dependencies

1. Three.js readiness must resolve before the outer composition starts.
2. Body DOM must exist before current factory construction captures elements.
3. Billing module-evaluation state/listeners currently exist before auth and UI initialization.
4. `OperationLifecycle` must exist before InteractionManager, AutoPack, Truck Change, editor
   mutation paths, preview, and shortcuts.
5. `AutoPackEngine` is built before `ExportService`; its callback must remain lazy and must not run
   before `ExportService` assignment.
6. Auth/user-switch accessors are late-bound into the already-created billing runtime.
7. Supabase's internal auth listener is installed during `SupabaseClient.init()`; the app listener
   is installed afterward.
8. The app auth listener is installed before component initialization and before the root StateStore
   subscriber. Explicit `renderAll()` calls currently compensate for state changes that can occur
   before the subscriber exists.
9. The StateStore subscriber is installed before `Router.init()`. The initial hash can mutate
   `currentScreen`; a later explicit `renderAll()` establishes the final initial view.
10. `init()` is single-flight and marks itself completed in `finally`, including early failure paths
    whose retry UX reloads the page.
11. `applyPostLogoutLocalStateReset` begins as an early fallback and is replaced only after
    scoped-state functions exist; logout callers must continue to use the final binding.
12. AppShell reaches `window.TruckPackerApp.EditorUI` and defers editor activation by two animation
    frames; moving either side changes a timing and global-publication dependency.
13. Trailer world-space conversion reads the later-created `SceneManager`; eager invocation during
    extraction would fail.

These dependencies should be captured as tests before moving constructors or listeners.

## 4. State lifecycle analysis

### 4.1 Current architecture

`app.js` does **not** create a store instance. It imports the singleton module
`src/core/state-store.js` as `CoreStateStore` and builds a local facade whose methods are references
to that singleton. Other modules either import the same singleton directly or receive the facade
through a factory. This hybrid access pattern still reaches one state object today.

The StateStore owns module-level state, undo history, a history pointer, and subscribers. Its
relevant semantics are:

- `init(initialState)` replaces live state and resets history.
- `set(patch, meta)` shallow-merges a patch, records a history snapshot for significant keys, and
  notifies synchronously.
- `replace(nextState, meta)` deep-clones a whole state and notifies; `skipHistory` prevents a new
  snapshot but does not reset old history.
- `undo()` and `redo()` restore only the history slice.
- subscriber failures are caught so one listener cannot stop the others.

The only production runtime StateStore subscription found is installed in `app.js` at 9797–9869.
Several modules write directly to the singleton, while other writers receive it through composition.
Extraction must preserve that they are the same authority.

### 4.2 State keys and ownership

| Key                   | Meaning                                                | Persistent?      | Principal writers/readers                                                                  |
| --------------------- | ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------ |
| `caseLibrary`         | Case definitions and categories                        | Workspace-scoped | Case/category services, Cases screen, import dialogs, app hydration.                       |
| `packLibrary`         | Packs, truck/case placement state, notes/metadata      | Workspace-scoped | Pack library, Packs/Editor screens, AutoPack through library APIs, imports, app hydration. |
| `folderLibrary`       | Pack-folder hierarchy                                  | Workspace-scoped | Folder/pack services, imports, hydration.                                                  |
| `preferences`         | Units, theme, labels, grid, screenshot/PDF preferences | User-scoped      | Preferences manager, Settings overlay/screen, imports, app hydration.                      |
| `currentPackId`       | Active pack                                            | Workspace-scoped | PackLibrary/app hydration and reset, screens.                                              |
| `currentScreen`       | Current hash-backed screen                             | No               | AppShell/Router and workspace/auth reset.                                                  |
| `selectedInstanceIds` | Current editor selection                               | No               | Interaction/Editor/Keyboard/PackLibrary and workspace reset.                               |
| `autoPackResults`     | Transient AutoPack result set/carousel state           | No               | AutoPack engine and Editor screen.                                                         |

State history intentionally snapshots only `caseLibrary`, `packLibrary`, `folderLibrary`, and
`preferences`. Screen, current pack, selection, and AutoPack-result state are not restored by
undo/redo.

### 4.3 Persistence and scope lifecycle

`src/core/storage.js` independently imports the same StateStore singleton. It separates:

- **user scope:** preferences;
- **workspace scope:** case library, pack library, folder library, and current pack;
- **transient state:** current screen, selection, and AutoPack results are not persisted.

The actual lifecycle is:

1. Before auth is known, `init()` applies the anonymous/no-org storage scopes, loads or seeds local
   state, and applies theme.
2. When a signed-in user is established, the user storage scope changes first.
3. A hinted workspace scope is applied and loaded so the UI can resume promptly.
4. The authoritative account bundle resolves the final valid organization.
5. If the final workspace differs, workspace storage scope and live state are replaced again.
6. `suspendAutoSave` prevents the root StateStore subscriber from writing freshly replaced state
   into the previous identity/workspace scope.
7. Explicit render calls compensate for hydration that can occur before the root subscriber is
   installed.
8. Later persistent state mutations call `Storage.saveSoon()` through the root subscriber; storage
   reads the singleton at flush time.

Workspace switching also resets transient UI/editor state so selection, previews, clipboard-like
state, pack visibility, members/invites, and billing UI cannot leak from the previous org.

### 4.4 State consumers and mutation style

Direct singleton imports include `category-service.js`, `case-library.js`, `folder-library.js`,
`pack-library.js`, `preferences-manager.js`, `storage.js`, and `settings-overlay.js`. Injected
readers/writers include Scene Runtime, AutoPack, Editor, Packs/Cases screens, truck-change, and
import dialogs. A later refactor must not introduce a new store instance for only one side.

`src/core/session.js` owns a separate session singleton and AccountSwitcher subscribes to it. It is
not a view of the main StateStore. `src/core/state.js` defines another StateStore-like singleton but
has no confirmed production importer; it is catalogued as a legacy candidate rather than treated as
current state authority.

### 4.5 Confirmed state hazards

| Hazard                                | Evidence                                                                                                                                   | Consequence                                                                                                   | Required pre-extraction action                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| History crosses state replacement     | Scope changes use `StateStore.replace(..., { skipHistory: true })`; `replace` does not clear existing history; global undo remains active. | Undo after user/org switching can merge a prior scope's history slice into the new scope.                     | Decide and test the history boundary for identity/workspace replacement before moving hydration code. Do not obscure the issue with modularization. |
| Hybrid direct/injected access         | Production modules use both direct singleton imports and injected facades.                                                                 | Partial instance migration can create split-brain reads/writes and divergent persistence.                     | Retain the singleton during extraction; migrate access style only as a separate, all-consumer change.                                               |
| Synchronous user isolation            | `applyUserSwitchIsolation()` clears old identity/org/billing/state before any awaited work for a new user.                                 | An inserted `await` or reordered lookup can expose old user's local state or billing truth.                   | Preserve synchronous ordering and existing security invariant tests.                                                                                |
| Autosave scope race                   | Storage flush reads current singleton and current scope; scope swaps suppress subscriber saves.                                            | Removing or narrowing `suspendAutoSave` can write old/new state under the wrong key.                          | Add scope-specific save-spy tests and keep loader/scope/suspension as one unit.                                                                     |
| Subscriber is an implicit coordinator | One callback combines persistence, theme, scene, preview, and rendering.                                                                   | Splitting it without an order contract can duplicate saves/renders or capture a preview after scene teardown. | Characterize the exact change→effect matrix before extracting the coordinator.                                                                      |

### 4.6 Future recommended state architecture

For the initial modularization, retain `CoreStateStore` as the single authority. Extract a
domain-aware `AppStateLifecycle` only after tests exist. That controller should be injected with:

- the existing StateStore and Storage facades;
- Defaults and library-repair functions;
- authoritative user and org accessors;
- render/theme/scene callbacks;
- preview and AutoPack transient reset callbacks;
- workspace-switch state and autosave-suspension controls.

It should expose explicit operations such as `loadInitialAnonymousState`, `switchUserScope`,
`switchWorkspaceScope`, `resetTransientEditorState`, `startStateReactions`, and
`stopStateReactions`. Hydration should **not** move into generic `state-store.js`: choosing a
user/org scope, repairing pack data, and resetting editor state are application-domain
responsibilities.

Changing from a singleton to an instance store, changing history semantics, and splitting
persistence are separate architectural projects. They should not be folded into file extraction.

## 5. Exact startup sequence

```text
index.html preboot shell
  -> creates window.__TP3D_BOOT and vendor/fallback promises
  -> starts Three.js ESM loading
  -> loads classic TWEEN, jsPDF, XLSX, and Supabase vendors
  -> installs flags, Supabase config, maintenance gate, preboot fatal handlers
  -> dynamically imports src/app.js at the end of <body>

src/app.js module evaluation
  -> evaluates static imports
  -> calls initTP3DDebugger()
  -> creates module-scope billing state/cross-tab machinery
  -> installs billing storage listener and BroadcastChannel
  -> exposes window.__TP3D_BILLING
  -> enters outer async boot IIFE and awaits __TP3D_BOOT.threeReady

outer boot/composition
  -> creates UI components, system overlay, and error overlay
  -> creates BootState and runtime fatal handlers
  -> evaluates window.TruckPackerApp composition IIFE
  -> builds state/service facades and all overlays/controllers/screens
  -> constructs Scene -> OperationLifecycle -> Interaction -> AutoPack
  -> constructs ExportService and remaining screens/managers
  -> defines auth/org/workspace/billing UI lifecycle functions
  -> returns final TruckPackerApp public facade

bottom boot guard
  -> waits for DOMContentLoaded only if document is still loading
  -> calls TruckPackerApp.init()

TruckPackerApp.init() (single-flight)
  -> validates WebGL/browser/vendor runtime
  -> installs opt-in dev helpers
  -> seeds/loads anonymous + no-org StateStore state
  -> applies theme
  -> validates Supabase config and initializes Supabase (with vendor retry path)
     -> Supabase creates client
     -> reads/validates cached session
     -> installs its internal auth listener/guard/cross-tab logout
  -> defines bootstrap auth gate and invite-handoff flow
  -> installs the app auth-state listener
  -> installs app visibility/storage/org cross-tab listeners
  -> initializes shell, screens, overlays, account switcher, buttons, keyboard
  -> installs billing/access/trial/role/focus/Stripe-return behavior
  -> handles a pending invite for an existing session
  -> installs the sole root StateStore subscription
  -> initializes Router/hashchange and applies the initial route
  -> renderAll()
  -> awaits bootstrap auth gate
     -> signed in: isolate changed identity synchronously, set user/workspace scopes,
        hydrate local state, fetch/apply authoritative org bundle, pump billing
     -> signed out: clear org/billing/scoped UI and show Auth overlay after stability gate
  -> marks application ready through __TP3D_BOOT
  -> sets the one-shot init completion guard in finally
```

### Startup contracts to preserve

- Maintenance mode prevents the app import entirely.
- Three.js must be ready before scene/controller composition.
- Current DOM capture relies on body-end import, not merely the bottom DOM-ready callback.
- Billing cross-tab listeners exist before the app auth listener; any early billing result still
  needs user/org authority checks.
- Supabase internal initialization precedes the app's auth callback registration.
- Different-user isolation stays synchronous and precedes old-org hints or awaited fetches.
- UI components and the StateStore subscriber can currently be installed after an auth callback is
  registered; explicit rendering is required to cover that window.
- OperationLifecycle construction and guard injection precede every mutating editor controller.
- Router initialization occurs after the StateStore subscriber and before the final explicit render.
- Only one production init/listener graph is installed. Repeated `init()` calls return the same
  in-flight result or no-op after completion.
- The final global facade assignment must happen before the bottom boot invokes `init()`.

## 6. Extraction candidates

The destinations below are recommendations only. No destination file was created in Phase 0.

### 6.1 Static Updates and Roadmap screens

- **Current location/functions:** 3417–3450 and 4276–4368; `Data.updates`, `Data.roadmap`,
  `UpdatesUI.init/render`, and `RoadmapUI.init/render`.
- **Depends on:** existing Updates/Roadmap DOM containers, `UIComponents.showModal` for Roadmap
  cards, and static content.
- **Files depending on it:** only the inline AppShell/root render and initialization paths were
  confirmed.
- **Why extraction is comparatively safe:** renderers are read-only, have no identity, persistence,
  billing, or scene ownership, and their `init` methods are no-ops.
- **Why it is still risky:** route IDs, expected markup, and error-boundary behavior must remain
  exact; empty `init` methods may be part of the uniform screen contract.
- **Recommended destination:** `src/screens/updates-screen.js` and `src/screens/roadmap-screen.js`.
- **Complexity / risk:** LOW / LOW.

### 6.2 Connectivity/offline controller

- **Current location/functions:** 2576–2647; online/offline status and banner
  installation/rendering.
- **Depends on:** `navigator.onLine`, UI/toast or banner primitives, DOM, `online` and `offline`
  events.
- **Files depending on it:** app initialization and user-facing connectivity state; billing/auth
  separately use their own resume listeners.
- **Why extraction is comparatively safe:** narrow platform input and visible output, no direct
  state persistence.
- **Why it is still risky:** it must not absorb or duplicate auth/billing retry listeners just
  because they respond to the same browser events.
- **Recommended destination:** `src/ui/connectivity-controller.js`.
- **Complexity / risk:** LOW / LOW.

### 6.3 Toast normalization and app event bridge

- **Current location/functions:** approximately 2242–2334; toast facade plus `app:error`, theme, and
  storage error listeners.
- **Depends on:** `createUIComponents`, internal event bus, error normalization, Preferences/theme
  callbacks.
- **Files depending on it:** most controllers receive `Toast`; error/storage emitters depend on the
  event contract.
- **Why extraction is comparatively safe:** it can be factory-injected and its observable behavior
  is easy to characterize.
- **Why it is still risky:** toast severity/deduplication and recoverable-error routing are shared
  policy; module evaluation must not install duplicate listeners. The current code monkey-patches
  the shared `UIComponents.showToast` object property, so extracting onto a copied object would
  silently stop sanitizing toasts received by injected consumers.
- **Recommended destination:** `src/ui/app-toast-controller.js`.
- **Complexity / risk:** LOW–MEDIUM / MEDIUM.

### 6.4 Debug and public helper installation

- **Current location/functions:** 96–100 and approximately 2335–2405; debugger initialization, app
  helpers, dev assertions, diagnostics.
- **Depends on:** runtime globals, StateStore, SceneManager, UI controllers, feature flags. The
  debugger can wrap `fetch`, history, and storage; the wrapper-detective installer exposes an opt-in
  `globalThis.__TP3D_WRAPPER_DETECTIVE__` facade.
- **Files depending on it:** debugger/manual console tooling; no complete typed consumer list exists
  because access is dynamic.
- **Why extraction is comparatively safe:** most behavior is diagnostic and can receive accessors
  instead of closing over app locals.
- **Why it is still risky:** debugger code can inspect or wrap live APIs, and public helper names
  may be relied on outside static source. Preserve disabled-mode inertness and the wrapper-detective
  re-install guard.
- **Recommended destination:** extend `src/debugger.js` and/or `src/core/dev/app-debug-helpers.js`;
  do not create a second debugger authority.
- **Complexity / risk:** MEDIUM / MEDIUM.

### 6.5 Legacy hash Settings screen

- **Current location/functions:** 4370–4440; `SettingsUI.init`, `SettingsUI.render`, preference
  save/reset handlers.
- **Depends on:** PreferencesManager, Storage, SceneManager, StateStore, dedicated settings DOM.
- **Files depending on it:** AppShell/root rendering and the direct `#/settings` route. Normal
  sidebar settings use `SettingsOverlay` instead.
- **Why extraction is comparatively safe:** self-contained DOM controller with a small preference
  surface.
- **Why it is still risky:** its supported status is unclear; removing it from app composition would
  silently break direct hash navigation. It also duplicates overlay behavior.
- **Recommended destination:** first decide whether `#/settings` remains supported; if retained,
  `src/screens/legacy-preferences-screen.js` to avoid confusing it with the Settings overlay.
- **Complexity / risk:** MEDIUM / MEDIUM.

### 6.6 Import/export/help action launchers

- **Current location/functions:** 4707–4826; global app export, app import, and Help button handlers
  plus pack/case dialog launchers around 4190–4274.
- **Depends on:** ImportExport, Storage, StateStore, import dialogs, Help modal, libraries, current
  org/pack access.
- **Files depending on it:** global buttons, screens, overlays, workspace availability gating.
- **Why extraction is comparatively safe:** the launchers can be modeled as an injected action
  controller without owning file-format logic.
- **Why it is still risky:** export scope and import replacement semantics depend on current
  user/workspace state; listeners must be installed once.
- **Recommended destination:** `src/ui/app-resource-actions.js`.
- **Complexity / risk:** MEDIUM / MEDIUM.

### 6.7 Runtime/browser/fatal guard

- **Current location/functions:** 2034–2162, 5038–5095, and 9924–9957; fatal-handler setup,
  runtime/vendor/WebGL validation, browser support, and boot failure reporting.
- **Depends on:** `window.__TP3D_BOOT`, BrowserUtils, vendor globals, UI/System/Error overlays, DOM
  and global error events.
- **Files depending on it:** outer boot, `init()`, and `index.html`'s preboot/maintenance contract.
- **Why extraction is comparatively safe:** capability checks and fatal classification form a
  coherent boundary with observable inputs/outputs.
- **Why it is still risky:** preboot and runtime handlers deliberately overlap; installing twice or
  changing which errors are fatal can hide startup failures or show duplicate overlays.
- **Recommended destination:** `src/core/runtime-guard.js`, constructed once by the composition
  root.
- **Complexity / risk:** MEDIUM / HIGH.

### 6.8 App shell and render coordinator

- **Current location/functions:** 3452–3562 and 5097–5128; `AppShell`, `renderAll`, and
  recoverable-error fanout.
- **Depends on:** Router, StateStore, all screens, EditorUI, ErrorOverlay, DOM.
- **Files depending on it:** root subscriber, auth/org lifecycle, no-org handling, route changes,
  component error boundaries.
- **Why extraction is comparatively safe:** it has a coherent UI-shell responsibility and can
  receive a screen registry.
- **Why it is still risky:** it currently participates in auth hydration compensation,
  current-screen changes, editor panel layout, and error recovery. Moving it can change first-render
  timing.
- **Recommended destination:** `src/ui/app-shell.js` with an explicit screen registry; keep Router
  separate.
- **Complexity / risk:** MEDIUM–HIGH / HIGH.

### 6.9 Export/preview/PDF service

- **Current location/functions:** 3629–4188; preview capture, `takeScreenshot`, PDF generation,
  cargo instructions, checklists, feature gates.
- **Depends on:** SceneManager, CaseScene, StateStore, PackLibrary, preferences/units,
  OperationLifecycle, billing rules, `THREE`, jsPDF, DOM/canvas.
- **Files depending on it:** Editor buttons/screens, AutoPack's injected preview callback, the root
  StateStore subscriber's editor-exit preview.
- **Why extraction is comparatively safe:** behavior already forms a service object with explicit
  methods.
- **Why it is still risky:** capture must be workspace-safe, operation-locked, and ordered around
  editor/AutoPack state. AutoPack is currently constructed before this service via a lazy closure.
- **Recommended destination:** `src/services/export-service.js`.
- **Complexity / risk:** HIGH / HIGH.

### 6.10 Keyboard manager

- **Current location/functions:** 4442–4705; `KeyboardManager.init`, shortcut dispatch,
  editability/modal/busy checks.
- **Depends on:** StateStore, PackLibrary, EditorUI, InteractionManager, OperationLifecycle, Toast,
  DOM/window events.
- **Files depending on it:** editor workflows and global application initialization.
- **Why extraction is comparatively safe:** it is already encapsulated behind an object and one
  `init` call.
- **Why it is still risky:** missing one operation/busy/target guard can mutate during AutoPack,
  preview, Truck Change, or text entry. Duplicate listeners can double every mutation.
- **Recommended destination:** `src/ui/keyboard-manager.js`.
- **Complexity / risk:** MEDIUM–HIGH / HIGH.

### 6.11 Account switcher and workspace-creation UI

- **Current location/functions:** 2699–3142; workspace creation modal/controller,
  `AccountSwitcher.init/render`, account dropdown/select/logout/settings actions.
- **Depends on:** Session, Supabase org APIs, active-org setter/getters, billing state/refresh,
  Settings/Account overlays, Toast, DOM.
- **Files depending on it:** auth/org render paths, settings, active-org changes, root component
  initialization.
- **Why extraction is comparatively safe:** its visible UI and actions are cohesive and can be
  driven by an injected org lifecycle interface.
- **Why it is still risky:** methods close over later-declared `orgContext`; calls are safe only
  after app setup. Selection is identity/persistence sensitive, and workspace creation affects
  billing limits.
- **Recommended destination:** `src/ui/account-switcher.js`; keep authoritative org mutation in the
  org lifecycle controller.
- **Complexity / risk:** HIGH / HIGH.

### 6.12 Trailer geometry consolidation

- **Current location/functions:** 3144–3409; color helper and `TrailerGeometry` capacity/space
  conversion methods.
- **Depends on:** TrailerPresets, units/defaults; PackLibrary and AutoPack consumers rely on
  equivalent geometry rules.
- **Files depending on it:** injected AutoPack/editor/pack flows; some property-based consumers may
  evade static searches.
- **Why extraction could eventually help:** it would create one explicit domain contract and remove
  duplicate geometry implementations.
- **Why it is not an early safe extraction:** packing geometry is physical-safety behavior. The app
  and PackLibrary implementations must be proven equivalent across Standard, Wheel Wells, Front
  Overhang, Bulkhead/Flatbed and unit conversions before consolidation.
- **Recommended destination:** a shared `src/services/trailer-geometry.js` only in an explicitly
  approved packing-core phase.
- **Complexity / risk:** HIGH / VERY HIGH. Defer from early app modularization.

### 6.13 Invite-handoff controller

- **Current location/functions:** 8217–8438 plus pending-invite resume at 9789–9795; invite parsing,
  signed-out handoff UI, acceptance, cleanup, and org refresh.
- **Depends on:** URL/session storage, Auth overlay, Supabase session, `acceptOrgInvite`, account
  bundle/org selection, Toast.
- **Files depending on it:** auth bootstrap, existing-session initialization, invite recovery UI.
- **Why extraction is comparatively safe:** it has a distinct input (invite URL/pending record) and
  terminal outcomes.
- **Why it is still risky:** signed-out, wrong-user, expired, revoked, already-accepted, and
  org-switch cases cross auth and workspace truth. Cleanup timing must not lose a recoverable
  invite.
- **Recommended destination:** `src/auth/invite-handoff-controller.js`.
- **Complexity / risk:** HIGH / HIGH.

### 6.14 Root StateStore reaction coordinator

- **Current location/functions:** 9797–9869; the single `StateStore.subscribe` callback.
- **Depends on:** Storage, Preferences/theme, SceneManager, Settings/Account overlays, all screens,
  AppShell, ExportService, current screen/pack.
- **Files depending on it:** every state mutation indirectly depends on its save/render side
  effects.
- **Why extraction could help:** it is a coherent change-to-side-effect coordinator and can expose
  start/stop for listener-cardinality tests.
- **Why it is risky:** synchronous effect order, editor-exit preview capture, autosave metadata
  filters, and singleton installation are implicit. A duplicate coordinator creates duplicate
  saves/renders/captures.
- **Recommended destination:** `src/core/app-state-reactions.js` or as part of `AppStateLifecycle`.
- **Complexity / risk:** HIGH / HIGH.

### 6.15 Scoped state bootstrap/hydration

- **Current location/functions:** 4828–5036; scope setters, `seedIfEmpty`, reset,
  `loadScopedStateOrSeed`, workspace-state application/repair.
- **Depends on:** StateStore, Storage, Defaults, Pack/Case/Folder libraries, Preferences, user/org
  identity, UI reset and autosave guards.
- **Files depending on it:** auth rendering, same-tab/cross-tab org switching, sign-out, bundle
  application.
- **Why extraction could help:** it has one domain responsibility and should become testable
  independently of the full UI.
- **Why it is risky:** it is a security/persistence boundary, is intentionally invoked more than
  once during boot, and currently does not rebase undo history. Fragmenting it magnifies scope
  races.
- **Recommended destination:** `src/core/app-state-lifecycle.js`, kept as one cohesive controller.
- **Complexity / risk:** HIGH / VERY HIGH.

### 6.16 Billing presentation/access controller

- **Current location/functions:** 8789–9787 plus Settings/sidebar callbacks; upgrade/payment banner,
  trial/plan picker, role hydration, billing CTA state, focus/Stripe return.
- **Depends on:** normalized billing state, org role/bundle, Settings overlay, DOM, URL/session
  storage, checkout/portal callbacks.
- **Files depending on it:** sidebar, AutoPack/PDF gates through billing policy, Settings Billing,
  account switcher.
- **Why extraction can precede billing transport:** presentation can consume a read-only normalized
  snapshot and explicit money-action callbacks.
- **Why it is risky:** owner-only money actions, entitlement-vs-payment semantics, and stale-org
  display are P0 product rules. UI must never become its own billing truth.
- **Recommended destination:** `src/ui/billing-access-controller.js`.
- **Complexity / risk:** HIGH / VERY HIGH.

### 6.17 Billing runtime and cross-tab coordinator

- **Current location/functions:** 103–2014 and 6171–6365; state normalization, refresh,
  locks/results/channel, auth/access-loss handling, entitlement rules, checkout/portal, refresh
  pump.
- **Depends on:** billing service, auth truth, org readiness/role, workspace/user epochs,
  visibility/network/focus, Settings/sidebar gate applier, global facade.
- **Files depending on it:** AutoPack, PDF export, Settings, sidebar/trial UI, account switcher,
  debugger, auth/org lifecycle.
- **Why extraction could help:** it is the largest coherent non-composition subsystem and needs one
  authoritative owner.
- **Why it is risky:** late-bound accessors currently break runtime cycles; early responses must be
  rejected by user/org/epoch; cross-tab locks/results are security-sensitive; raw payment state and
  entitlement must remain distinct.
- **Recommended destination:** `src/services/billing-runtime.js`, constructed once with explicit
  auth/org authority interfaces.
- **Complexity / risk:** VERY HIGH / VERY HIGH.

### 6.18 Organization/workspace lifecycle controller

- **Current location/functions:** 5130–5434, 5793–7245, and 6367–7041; workspace switch state,
  `setActiveOrgId`, cross-tab sync, lifecycle handlers, bundle selection/application/refresh, no-org
  UI state.
- **Depends on:** Supabase org/profile APIs, user identity, Storage/StateStore hydration, billing,
  Settings/Account UI, screen reset/render, local storage/events.
- **Files depending on it:** auth lifecycle, billing runtime, every org-scoped screen/overlay,
  workspace action callbacks.
- **Why extraction could help:** one authority can expose active org plus readiness/epoch instead of
  the ambient `OrgContext` global.
- **Why it is risky:** optimistic same-tab switching has a full rollback; cross-tab messages are
  freshness/user guarded; partial bundles differ from confirmed no-org;
  editor/preview/member/billing state must reset together.
- **Recommended destination:** `src/core/org-context-controller.js` or
  `src/core/workspace-lifecycle.js`.
- **Complexity / risk:** VERY HIGH / VERY HIGH.

### 6.19 Authentication lifecycle controller

- **Current location/functions:** 5436–5781, 7247–8026, and 8028–8767; auth stability gate, truth
  snapshots, profile checks, user-switch isolation, `renderAuthState`, bootstrap and auth event
  handlers.
- **Depends on:** Supabase client, Auth overlay, StateStore/Storage lifecycle, org lifecycle,
  billing, account bundle, invite handoff, visibility/network/timers.
- **Files depending on it:** every signed-in feature and every cross-user security guard.
- **Why extraction could help:** it should be the single owner of identity truth and publish
  explicit transitions to other controllers.
- **Why it is risky:** transient `SIGNED_OUT` behavior, cached/remote truth, synchronous user
  isolation, callback registration timing, disabled profiles, cross-tab logout, and hidden/offline
  recovery are tightly coupled.
- **Recommended destination:** `src/core/auth-lifecycle-controller.js`, extracted only after
  org/state/billing interfaces and an event-matrix test harness exist.
- **Complexity / risk:** VERY HIGH / VERY HIGH.

### 6.20 Final composition/boot reduction

- **Current location/functions:** 2016–2181, 2181–9904, and 9906–9964; top-level dependency graph,
  `init`, public facade, browser support and ready/fatal handoff.
- **Depends on:** all extracted controller factories and `index.html` boot contracts.
- **Files depending on it:** `index.html` and all dynamic global consumers.
- **Why extraction is the goal:** after controllers own behavior, the remaining code can visibly
  express construction and startup order.
- **Why it is risky:** reducing the root too early hides rather than removes coupling and can change
  module-evaluation side effects, DOM timing, or the public facade.
- **Recommended destination:** remain in `src/app.js`; optionally a separately tested startup
  controller may own lifecycle internals, but the entry/composition root stays here.
- **Complexity / risk:** HIGH / VERY HIGH.

## 7. Risk assessment

| Area                               | Risk      | Reason                                                                                                        | Recommended approach                                                                                           |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Static Updates/Roadmap rendering   | LOW       | Read-only data and local DOM output.                                                                          | First extraction after route/render smoke tests. Preserve no-op `init` contract if screen registry expects it. |
| Connectivity indicator             | LOW       | Narrow browser-event input; no persistent state.                                                              | Extract only indicator/toast behavior; do not combine auth/billing retry listeners.                            |
| Toast/event normalization          | MEDIUM    | Shared severity/error policy and event-listener side effects.                                                 | Factory with injected event bus/UI; assert one listener and message equivalence.                               |
| Debug/helper globals               | MEDIUM    | Dynamic/manual consumers and optional API wrapping are not visible to normal imports.                         | Inventory public names; keep disabled behavior inert and preserve opt-in diagnostics.                          |
| Legacy Settings screen             | MEDIUM    | Duplicates the overlay but remains reachable by direct hash.                                                  | Make a product decision before extracting or deleting; test both overlay and route if retained.                |
| Import/export/help launchers       | MEDIUM    | UI is isolated, but data scope and listener cardinality matter.                                               | Inject current scope/data getters and keep file-format logic in ImportExport.                                  |
| Runtime/browser/fatal guard        | HIGH      | Preboot and runtime error layers overlap, and vendor validation controls whether initialization can continue. | Extract as one singleton guard; snapshot fatal/recoverable classification and overlay behavior.                |
| App shell/router/render            | HIGH      | First-render order, current-screen state, editor activation timing, and recovery UI are coupled.              | Introduce a tested screen registry; preserve subscriber→Router→explicit-render order.                          |
| Keyboard shortcuts                 | HIGH      | Global mutation entry point across selection, history, editor and operation locks.                            | Characterize every shortcut and busy/modal/editable guard; assert one listener.                                |
| Export/preview/PDF                 | HIGH      | Mutates render targets, captures transient scene state, uses feature gates and operation lock.                | Extract as one injected service; test restoration after success/failure and workspace-token staleness.         |
| Account/workspace UI               | HIGH      | UI actions invoke authoritative org and billing transitions.                                                  | Extract presentation separately from org mutation; receive one lifecycle interface.                            |
| Workspace-creation limit hint      | MEDIUM    | Client UI check is helpful but is not authoritative enforcement.                                              | Preserve server-side workspace-limit enforcement and treat the client result only as presentation.             |
| Invite handoff                     | HIGH      | Crosses URL, session, auth identity, invite validity and workspace selection.                                 | Extract only with signed-in/out/wrong-user/expiry recovery matrix.                                             |
| Scene/editor composition           | VERY HIGH | Construction order and shared operation lock protect all editor mutations.                                    | Keep wiring in root until factories expose explicit contracts and full operation tests pass.                   |
| Trailer geometry                   | VERY HIGH | Physical packing/support/capacity rules exist in more than one implementation.                                | Defer consolidation to an approved packing-core task with parity/property tests.                               |
| Scoped state hydration/persistence | VERY HIGH | User/workspace data isolation, autosave scope and unresolved undo-history boundary.                           | Keep cohesive; decide history reset semantics and add cross-scope save/undo tests first.                       |
| Root StateStore reactions          | VERY HIGH | One synchronous subscriber owns persistence, theme, scene, preview and render fanout.                         | Characterize event/effect ordering; provide explicit start/stop; install exactly once.                         |
| Billing presentation/gates         | VERY HIGH | Entitlement is backend truth; owner-only money actions and stale-org UI are P0.                               | Feed only normalized authoritative state and explicit callbacks; never derive truth locally.                   |
| Billing runtime/cross-tab          | VERY HIGH | Async results cross users/orgs/tabs and use late-bound auth/org authority.                                    | One constructed authority; retain epoch/freshness/access-loss guards and raw-vs-entitlement fields.            |
| Workspace/org lifecycle            | VERY HIGH | Optimistic switches, rollback, cross-tab freshness, bundle truth and scoped resets are interdependent.        | Extract late as one controller with explicit readiness and identity epochs.                                    |
| Authentication lifecycle           | VERY HIGH | Controls all identity isolation and startup access; timing affects every subsystem.                           | Extract last among behavior controllers; preserve synchronous isolation and test full auth event matrix.       |
| Boot/composition/public facade     | VERY HIGH | Module-evaluation side effects, vendor/DOM timing and untyped global consumers.                               | Reduce only after dependencies are explicit; snapshot facade and listener/construction order.                  |

## 8. Legacy, duplicate, and possible dead-code candidates

This section records evidence only. None of these items should be removed without a focused
implementation phase and validation.

| Candidate                                                                             | Evidence                                                                                                                                                                                                                                    | Confidence                                 | Classification / caution                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Executable-looking functions inside the opening JSDoc                                 | Lines 1–36 contain old `closeDropdowns`, `openSettingsOverlay`, and `openAccountOverlay` text inside a block comment. The real implementations are later.                                                                                   | HIGH                                       | Dead comment/legacy documentation, not executable code. Safe removal still belongs to a later cleanup diff.                                                              |
| `_openAccountOverlay`                                                                 | Defined at 2684–2697 with no lexical call/reference found. `AccountOverlay` has no other confirmed open path.                                                                                                                               | HIGH                                       | Unused wrapper and possibly dormant overlay entry point. Confirm expected Account UI before removal.                                                                     |
| `_showComingSoon`                                                                     | Defined at 3009–3011 with no reference found.                                                                                                                                                                                               | HIGH                                       | Unused helper.                                                                                                                                                           |
| Ineffective `TruckPackerApp` bridge assignments                                       | Lines 6633–6645 assign `notifyOrgAccessLoss`, `handleWorkspaceLeft`, and `handleOwnershipTransferred` to the object being replaced by the outer IIFE assignment. Final return at 9906–9922 omits them; Settings probes the latter handlers. | HIGH                                       | Unreachable public exposure, but the underlying handlers are intended behavior, not dead implementations. Treat as a known contract defect, not a deletion candidate.    |
| `supabaseInitOk === false` terminal branch                                            | All continuing Supabase paths set it true; config/init failure paths return before the check at 9893–9896.                                                                                                                                  | HIGH                                       | Apparently unreachable/redundant guard. Retain until failure-path tests prove it unnecessary.                                                                            |
| `src/core/state.js` StateStore                                                        | Repository search found no production import; current app and services use `src/core/state-store.js`.                                                                                                                                       | HIGH                                       | Legacy alternate singleton. Removal requires checking tooling/tests/non-module consumers.                                                                                |
| `cssHexToInt` in local `Utils` facade                                                 | Returned on the app-local utility object, but no confirmed static property consumer was found.                                                                                                                                              | MEDIUM–HIGH                                | Possible unused compatibility property; dynamic/debug consumers can evade search.                                                                                        |
| App-local `TrailerGeometry.getTrailerCapacityInches3` and `zonesToSpacesInches`       | Methods are returned, but no confirmed direct consumer of those exact properties was found. Similar geometry exists in PackLibrary.                                                                                                         | MEDIUM–HIGH                                | Possible unused methods, but property injection/dynamic access and physical rules make deletion high risk.                                                               |
| Empty `initUpdatesUI` and `initRoadmapUI`                                             | Both are called and intentionally do no setup before render.                                                                                                                                                                                | HIGH evidence; LOW dead-code confidence    | No-op interface stubs, not unreachable. Preserve until the screen contract changes.                                                                                      |
| Legacy `SettingsUI` screen                                                            | Router and markup support `#/settings`, but normal Settings opens an overlay and no current `[data-nav="settings"]` entry was found.                                                                                                        | MEDIUM                                     | Dormant/legacy presentation, still directly route-reachable. Product decision required.                                                                                  |
| Export/import/help global-button wiring                                               | `initGlobalButtons` looks for `#btn-export-app`, `#btn-import-app`, and `#btn-help`; those IDs were not found in the audited `index.html`, so current wiring no-ops.                                                                        | HIGH evidence; MEDIUM dead-code confidence | Could be compatibility for alternate markup or future UI. Do not remove based on one document alone.                                                                     |
| `auth:changed` internal event emission                                                | App emits it, but no production listener was found.                                                                                                                                                                                         | MEDIUM                                     | Possible extension/debug event; absence of a static consumer is insufficient to remove a public-ish event.                                                               |
| Stale `TP3D_BUILD_STAMP` literals                                                     | Debug metadata at 2016–2019 records commit `52aa4de` and `2026-02-18`; audited HEAD is `eaf5295` on 2026-07-21.                                                                                                                             | HIGH                                       | Live debug metadata, not unreachable code. Decide whether it should be build-generated or removed as a trusted diagnostic; do not hand-update as part of modularization. |
| Plan-picker `_title` / `_continueLabel` parameters and trial-modal snapshot parameter | The underscored picker parameters are declared/passed but not consumed; the supplied snapshot parameter on `upgradeTrialModalToOwner` is also unused.                                                                                       | HIGH                                       | Unused parameters may document a planned interface. Remove only after call-site/API review.                                                                              |
| `window.SettingsOverlay` / `window.AccountOverlay` probes                             | Overlay-open detection probes globals for which no publication assignment was found, then uses live closure fallbacks.                                                                                                                      | MEDIUM                                     | Likely legacy global compatibility checks; dynamic embedders can evade repository search.                                                                                |

### Confirmed duplicate or parallel logic

| Area                                 | Evidence                                                                                                     | Risk of “cleanup”                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Case default-color resolution        | Similar helper logic exists in `app.js` and `case-library.js`.                                               | LOW–MEDIUM, but defaults/import migration behavior must match.                                     |
| Trailer geometry/capacity            | `app.js` has a local `TrailerGeometry`; PackLibrary has related capacity/space/geometry logic.               | VERY HIGH. Similar code may encode intentionally different representations or rounding.            |
| Initial seed versus scoped hydration | `seedIfEmpty` and `loadScopedStateOrSeed` overlap but run at different identity/readiness stages.            | VERY HIGH. The apparent duplication supports two-stage boot and cannot be merged casually.         |
| Billing reset/default blocks         | Several user/org/access-loss paths clear overlapping billing fields.                                         | VERY HIGH. Repetition may deliberately make each security boundary synchronous and self-contained. |
| Workspace invalidation handlers      | Leave, archive, ownership transfer, access loss, and update paths share refresh/reset/render behavior.       | VERY HIGH. Terminal states and rollback semantics differ.                                          |
| Render fanout                        | `renderAll`, root subscriber, and queued org-scoped rendering invoke overlapping screens/overlays.           | HIGH. Calls compensate for initialization and hidden-tab windows.                                  |
| Active-org fallbacks                 | Local hint, profile hint, bundle active ID, membership and first active org are checked in several contexts. | VERY HIGH. Priority and “partial versus confirmed empty” are product/security rules.               |
| Settings presentation                | Dedicated hash screen and modal overlay both edit preferences.                                               | MEDIUM. Resolve supported navigation before consolidation.                                         |
| Annual plan display                  | One app billing display uses `$199/year`; plan-picker copy uses `$199.99/year`.                              | HIGH product risk. Confirm canonical price/backend price IDs before any copy consolidation.        |

All 39 static imports have at least one confirmed use. There is no evidence for removing any current
import. `ensureWorkspaceReadyForUI()` additionally performs a dynamic import of the already
statically imported Supabase module; this may intentionally create an async boundary, so it is not a
mechanical duplicate-removal candidate.

Old support-email TODO comments, legacy billing storage keys, developer billing overrides, and
defensive guards may look stale but have compatibility or operational roles. They are not classified
as dead code here.

## 9. Recommended modularization roadmap

Each phase should be a separate reviewable change. Do not combine extraction with behavior fixes,
public API redesign, store-instance migration, or cosmetic formatting.

### Phase 0 — Inventory (this document)

- **Goal:** establish responsibilities, dependencies, risks, order contracts, and required
  validation.
- **Files affected:** this document only.
- **Risk:** LOW.
- **Validation:** documentation review, diff inspection, and repository baseline checks.

### Phase 1 — Characterize seams before moving code

- **Goal:** add behavior-focused tests for startup order, global facade shape, listener cardinality,
  store reaction effects, cross-scope history, auth events, org switching, billing authority, and
  operation locking.
- **Files affected:** test/audit fixtures only; production behavior remains unchanged.
- **Risk:** LOW–MEDIUM.
- **Validation required:** full suite plus focused tests running against the unmodified app
  implementation. Record current known defects as explicit expectations or quarantined findings
  rather than silently normalizing them.

### Phase 2 — Extract passive leaf screens and connectivity UI

- **Goal:** move static Updates/Roadmap screen data/controllers and the offline indicator behind
  explicit factories.
- **Files affected:** `src/app.js`, recommended screen modules, recommended connectivity controller,
  associated tests.
- **Risk:** LOW.
- **Validation required:** route rendering, unknown/direct hash navigation, online/offline
  transitions, one-listener assertions, full automated baseline.

### Phase 3 — Extract narrow UI/helper controllers

- **Goal:** move toast/event normalization, import/export/help launchers, and debug/helper
  installation; extract the legacy Settings screen only if product confirms it remains supported.
- **Files affected:** `src/app.js`, recommended UI/helper modules, possibly
  `src/screens/legacy-preferences-screen.js`, tests.
- **Risk:** MEDIUM.
- **Validation required:** error/toast matrix, theme/storage events, file-dialog action scope,
  direct Settings route and overlay, public debug/helper facade snapshot, duplicate-init tests.

### Phase 4 — Extract runtime guard, app shell, keyboard, and export service

- **Goal:** isolate browser/vendor/fatal classification, introduce a screen registry/AppShell
  controller, isolate KeyboardManager, and move preview/screenshot/PDF implementation into an
  injected service.
- **Files affected:** `src/app.js`, recommended RuntimeGuard/AppShell/Keyboard/Export modules,
  boot/editor/operation tests.
- **Risk:** HIGH.
- **Validation required:** boot/fatal/recoverable matrix, routing/first render, all keyboard
  operations and guards, editor enter/exit preview capture, screenshot/PDF state restoration,
  AutoPack lazy preview callback, one subscription/listener per owner.

### Phase 5 — Extract account/workspace presentation and invite handoff

- **Goal:** separate visible account/workspace UI and invite flow from the still-inline
  authoritative auth/org lifecycle.
- **Files affected:** `src/app.js`, recommended AccountSwitcher and InviteHandoff modules,
  Settings/Auth integration tests.
- **Risk:** HIGH.
- **Validation required:** create/select workspace, owner/admin/member views, invite outcome matrix,
  explicit logout, overlay closure/reset, no stale members/billing UI.

Trailer geometry consolidation is **not** part of this phase. It should remain deferred to a
separately approved packing-core change after parity tests.

### Phase 6 — Extract StateStore reactions and scoped-state lifecycle

- **Goal:** create one `AppStateLifecycle` owning hydration/scope transitions and one start/stop
  reaction graph while retaining the existing StateStore singleton.
- **Files affected:** `src/app.js`, recommended state lifecycle/reaction module,
  state/storage/auth/org integration tests.
- **Risk:** VERY HIGH.
- **Validation required:** user A→B, org A→B same/cross-tab, autosave target keys, anonymous/no-org
  seed, legacy/missing storage repair, rollback, undo/redo boundary, current
  screen/selection/AutoPack transient resets, exactly one subscriber.

The cross-scope undo-history behavior must have an approved product/engineering decision before this
phase changes code.

### Phase 7 — Extract billing presentation, then billing runtime

- **Goal:** first make billing UI a consumer of normalized snapshots; then move transport,
  entitlement normalization, cross-tab coordination, refresh pump, and money actions into one
  runtime.
- **Files affected:** `src/app.js`, Settings integration, recommended billing UI/runtime modules,
  billing/security tests.
- **Risk:** VERY HIGH.
- **Validation required:** all entitlement states, raw status separation, owner workspace
  inheritance, workspace limits, owner-only checkout/portal, stale user/org/epoch rejection,
  same/cross-tab refresh, hidden/offline resume, 401/403/access-loss behavior, AutoPack/PDF gates.

### Phase 8 — Extract organization/workspace lifecycle

- **Goal:** replace ambient org mutation with one explicit controller exposing active org,
  readiness, epoch, switch, refresh, and lifecycle-event APIs.
- **Files affected:** `src/app.js`, recommended org/workspace lifecycle module,
  Supabase/Settings/Account/State/Billing integrations.
- **Risk:** VERY HIGH.
- **Validation required:** bundle resolution priority, partial versus confirmed-empty state,
  optimistic switch success/rollback, cross-tab user/tab/epoch guards, hidden-tab replay,
  leave/archive/restore/ownership/update/access-loss, all org-scoped UI and storage resets.

### Phase 9 — Extract authentication lifecycle

- **Goal:** make one controller own auth truth, stability, profile enforcement, identity isolation,
  callback sequencing, refresh/rehydration, and sign-out.
- **Files affected:** `src/app.js`, recommended auth lifecycle module,
  Supabase/Auth/Org/State/Billing/Invite integrations.
- **Risk:** VERY HIGH.
- **Validation required:** complete auth event matrix, cached and remote session behavior, explicit
  versus transient sign-out, different-user synchrony, disabled/deleted users, password recovery,
  cross-tab logout, hidden/offline/focus resume, boot timeouts, zero old-user UI/storage/billing
  exposure.

Phases 7–9 are one coordinated identity-runtime initiative, not independent cleanup tickets. Before
starting Phase 7, choose and test either (a) one cohesive identity runtime that owns
billing/auth/org cross-calls internally, or (b) explicit authority interfaces with no
ambient/late-bound defaults. If the current five late-bound bridges cannot be replaced without
timing ambiguity, keep the subsystems together rather than forcing artificial module boundaries.

### Phase 10 — Reduce `app.js` to the composition root

- **Goal:** leave only explicit construction order, dependency injection, startup invocation, public
  facade registration, and boot ready/fatal handoff.
- **Files affected:** `src/app.js`, controller interfaces, facade/startup tests.
- **Risk:** VERY HIGH.
- **Validation required:** full matrix in Section 10, facade compatibility, module-evaluation versus
  init side effects, body-end/DOM timing, vendor fallback/maintenance, one-shot initialization, and
  a final line-by-line behavior comparison.

## 10. Validation checklist for every future extraction

Passing static checks is necessary but not sufficient. Auth, billing, workspace, editor,
persistence, and browser-lifecycle behavior require real browser verification with at least two
users, two workspaces, and two tabs where applicable.

### 10.1 Required automated gate

- [ ] `npm test`
- [ ] `npm run -s typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `git diff --check`
- [ ] `git diff --cached --check`
- [ ] Focused tests for the extracted responsibility pass independently.
- [ ] No test was weakened merely because it referenced the old `app.js` source location.
- [ ] Production import/export/global facade snapshots are unchanged unless the phase explicitly
      approves an API migration.
- [ ] Repeated construction/`init()` tests show exactly one global listener, StateStore
      subscription, timer/pump, and BroadcastChannel owner.
- [ ] No new console errors, unhandled rejections, storage errors, or failed network calls occur in
      the supported flows.

The audit found roughly 115 `src/app.js` source reads/assertions across existing audit tests. They
assert function presence, literal patterns, or relative ordering, notably in:

- `tests/audit/security-and-invariants.spec.mjs`
- `tests/audit/inspector-case-notes.spec.mjs`
- `tests/audit/max-capacity-phase-c-reporting.spec.mjs`

Future extraction will require intentionally relocating those assertions or replacing source-shape
checks with equivalent behavioral/contract tests. Moving code and then deleting the assertions is
not acceptable validation.

Run `npm run test:stress` and `npm run stress:ui` for phases touching editor, keyboard, geometry,
operation lifecycle, AutoPack, ExportService, or the render coordinator. Run local/deployed/Stripe
billing suites only in their documented safe fixture environments; they are not substitutes for the
default suite.

Existing import/export, manual placement, AutoPack results, notes, operation lifecycle, and
maximum-capacity suites should remain in the full baseline. New characterization tests should focus
on observable contracts rather than private function names wherever possible.

### 10.2 Startup and lifecycle

- [ ] Cold load with empty storage reaches the correct signed-out or signed-in state.
- [ ] Warm load with a valid cached session restores the correct user/workspace and data.
- [ ] `TruckPackerApp.init()` called twice creates no duplicate listener/subscriber and no duplicate
      initial fetch/render.
- [ ] Final `window.TruckPackerApp`, `window.__TP3D_BILLING`, `window.OrgContext`,
      `window.__TP3D_WRAPPER_DETECTIVE__`, `window.TP3D.helpers`, and Supabase global facades expose
      the same deliberate property names.
- [ ] Tests inspect the **final** `TruckPackerApp` object, not merely source assignment text,
      including the currently missing workspace-left/ownership/access-loss bridges.
- [ ] Every late-bound billing/auth/org accessor is replaced or assigned before its first possible
      call; no default/no-op bridge silently handles production work.
- [ ] Body-end import and DOM capture remain safe; a missing required node fails through the
      established error UI, not an unhandled exception.
- [ ] Three.js, Supabase, TWEEN, XLSX, and jsPDF normal load and existing fallback paths work.
- [ ] Maintenance mode does not import/start the app.
- [ ] Boot failure versus recoverable runtime error uses the correct overlay and ready/fatal state.
- [ ] Offline cold load and online resume do not hang or create duplicate retries.
- [ ] Hidden-tab boot/resume replays queued auth/org/billing work only when visible/appropriate.
- [ ] Initial hash, direct valid hash, unknown route, and missing/deleted pack routes resolve
      consistently.
- [ ] Browser back/forward navigation updates one active screen and one render cycle.

### 10.3 Authentication and account safety

- [ ] New login, returning login, logout, refresh, and token refresh.
- [ ] User A logout → User B login in the same tab exposes no User A org, pack, case, selection,
      preview, clipboard, member/invite, or billing state.
- [ ] Different-user transition is isolated synchronously before any awaited profile/org call.
- [ ] Transient `SIGNED_OUT` followed by a valid session does not wipe correct org state.
- [ ] Explicit user-initiated sign-out completes through the canonical helper without a competing
      timed reload.
- [ ] Cross-tab logout and re-login settle every tab on the correct identity.
- [ ] Password recovery path and recovery URL cleanup.
- [ ] Disabled/deleted/incomplete profile paths show the expected auth UI and do not continue into
      workspace/billing state.
- [ ] Hidden/offline/focus session revalidation does not duplicate refresh or apply stale truth.

### 10.4 Packs, cases, editor, and history

- [ ] Create a pack, open it, edit metadata/truck settings, save, leave, and reopen it.
- [ ] Create/edit/delete/duplicate/import a case and verify category/default color behavior.
- [ ] Add cases to a pack; select single/multiple; drag, rotate, nudge, delete, duplicate, copy, and
      paste.
- [ ] Undo/redo all supported case/pack/preference mutations in the same workspace.
- [ ] Switch user/workspace, then invoke undo/redo; history must follow the explicitly approved
      scope-boundary contract and must never restore another scope's data.
- [ ] Current pack, screen, selection, and AutoPack results reset/restore according to their
      persistent/transient contract.
- [ ] Theme/unit/grid/label/hidden-opacity preferences apply immediately and persist only in the
      user scope.
- [ ] Autosave writes to the current user/workspace key, including rapid same-tab and cross-tab
      switching.

### 10.5 AutoPack, Unpack, and Truck Change

- [ ] AutoPack works for Standard, Wheel Wells, Front Overhang, Bulkhead/Flatbed and every currently
      supported mode/configuration.
- [ ] AutoPack and PDF gates use normalized entitlement, including owner-inherited workspace
      coverage.
- [ ] Large-load AutoPack (`> 300` placements and the 1200-case stress workflow) shows the
      controlled working state and snaps/saves final state safely.
- [ ] Unpack, including the 1200-case workflow, preserves operation lifecycle and final persistence.
- [ ] AutoPack/Unpack cannot overlap Truck Change, preview capture, or a second mutating operation.
- [ ] Drag/rotate/nudge/delete/add/duplicate/paste and mutating shortcuts are blocked while busy;
      camera orbit/pan/zoom remains usable where currently allowed.
- [ ] Selecting a pending truck preset/mode/shape/config does not alter the committed scene or open
      preview.
- [ ] Clicking **Update truck** opens preview; confirm commits; Cancel/X/Escape restores committed
      scene and form.
- [ ] Wheel Wells shelf/support rules and Front Overhang rear-retention rules remain unchanged.
- [ ] AutoPack's lazy preview callback cannot run before ExportService is ready and captures only
      the current workspace/pack generation.

### 10.6 Import, export, preview, screenshot, and PDF

- [ ] Export/import the full app/workspace data in every supported format/version.
- [ ] Export/import one pack and cases; verify IDs, folders, current pack, defaults, units, notes,
      and repair/migration behavior.
- [ ] Cancel and malformed/unsupported import paths leave current state unchanged and show the
      established error.
- [ ] Screenshot captures the correct scene and restores renderer size, camera, visibility, and
      selection after success/failure.
- [ ] Automatic pack preview captures when expected, never after workspace/pack generation becomes
      stale, and restores scene state.
- [ ] PDF export gate, content, truck/case measurements, statistics, cargo instructions, checklist,
      notes, and file download work.
- [ ] jsPDF/XLSX/vendor fallback failure is handled through the current recoverable/fatal policy.

### 10.7 Settings and general UI

- [ ] Settings overlay opens/closes through button, X, Escape, and any existing backdrop behavior.
- [ ] General, Billing, Members, Invites, and other supported Settings tabs render the active
      organization only.
- [ ] Direct `#/settings` route works if the legacy screen is retained; otherwise its
      removal/redirect is separately approved and tested.
- [ ] Account switcher identity, avatar/name, org name, dropdown, settings, and logout actions stay
      current.
- [ ] Updates and Roadmap direct/navigation routes render once with unchanged content.
- [ ] Online/offline indicators and toasts do not duplicate and do not absorb billing/auth retry
      responsibility.
- [ ] Sidebar collapse/resize and editor left/right panels retain their current behavior.
- [ ] Error and toast messages keep severity, deduplication, action buttons, and recovery behavior.
- [ ] The shared `UIComponents.showToast` normalization still reaches all injected consumers; no
      copied UI object bypasses it.

### 10.8 Workspace and cross-tab behavior

- [ ] Owner with one workspace and owner with multiple workspaces.
- [ ] Admin and member roles in an active workspace.
- [ ] Create workspace success/failure and workspace-limit outcome.
- [ ] Same-tab workspace switch applies active org, storage scope, state, scene, Settings,
      members/invites, previews, and billing in the current order.
- [ ] Failed same-tab switch rolls back org context, local hint, storage scope, state, UI, and
      billing readiness.
- [ ] Cross-tab workspace switch accepts only the current user and a fresh epoch, rejects
      self/stale/wrong-user messages, then reconciles with authoritative bundle truth.
- [ ] Rename/update, archive, restore, leave, ownership transfer, and access-loss flows converge on
      the correct workspace or confirmed no-org state.
- [ ] Partial/error bundle does not masquerade as confirmed no-org; confirmed empty bundle disables
      org-required actions.
- [ ] Hidden-tab workspace messages queue/replay safely.
- [ ] No previous-org members, invites, billing notice, cases, packs, selected instances, clipboard
      state, editor scene, or preview remains visible after the readiness boundary.
- [ ] `tp3d:org-changed`, `tp3d:workspace-switch-state`, `tp3d:org-access-lost`, and
      `tp3d:workspace-ready` carry the expected identity/readiness data once per transition.

### 10.9 Billing and entitlement

- [ ] Backend `/billing-status` remains entitlement truth; UI does not infer from local
      workspace/payment rows.
- [ ] Raw payment `status` remains distinct from normalized `entitlementStatus`.
- [ ] Verify `active`, `trialing`, `trial_expired`, `included_in_plan`, `workspace_limit_reached`,
      `owner_subscription_required`, and `billing_unavailable`.
- [ ] Owner's second/third included workspace inherits coverage even when
      `billingOwnerUserId === currentUserId`.
- [ ] Non-owner members never receive owner money actions; only permitted owner paths can checkout,
      open portal, change plan, or fix payment.
- [ ] AutoPack, PDF, sidebar notice, Settings Billing, plan picker, trial welcome/expiry, and
      payment banner all reflect the same authoritative snapshot.
- [ ] Same-tab org switch cannot display/apply previous-org billing.
- [ ] Cross-tab billing locks/results accept only matching user/org/epoch/freshness and do not
      suppress a needed authoritative fetch indefinitely.
- [ ] User switch rejects all previous-user billing snapshots and clears pending/global projection
      state synchronously.
- [ ] 401 triggers canonical auth handling; 403/access loss reconciles the workspace;
      unavailable/network/timeout states recover without granting access.
- [ ] Checkout/portal return URL handling refreshes once and cleans query/session markers correctly.
- [ ] Canonical annual/monthly price and copy are verified before consolidating the `$199` versus
      `$199.99` display mismatch.

### 10.10 Invite handling

- [ ] Signed-out invite is preserved through authentication and accepted afterward.
- [ ] Existing signed-in invite acceptance refreshes the account bundle and selects the correct org
      when allowed.
- [ ] Wrong-user/email, expired, revoked, already accepted, unauthorized, malformed, and
      network-error outcomes preserve or clear pending data correctly.
- [ ] Invite notices/actions do not duplicate after refresh, back/forward, or repeated
      initialization.
- [ ] Acceptance never leaks the inviter/target org into another signed-in user's context.

### 10.11 Candidate-specific minimum characterization tests

| Candidate                 | Tests required before its first move                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Updates/Roadmap           | Render snapshots/content and direct-route smoke tests.                                                                          |
| Connectivity              | Online/offline transition matrix and one-listener assertion.                                                                    |
| Toast/event bridge        | Event→severity/message/action matrix; subscriber error isolation; no duplicate toast.                                           |
| Debug/helpers             | Enabled/disabled global facade snapshot and wrapper idempotence.                                                                |
| Legacy Settings           | Supported-route decision, preference mutation/persistence/theme/scene tests, overlay coexistence.                               |
| Resource action launchers | Correct current-scope payload, cancel/error behavior, and single listener.                                                      |
| AppShell                  | Initial hash, route change, render order/count, editor two-frame activation, error recovery.                                    |
| ExportService             | Render-state restoration in `finally`, operation lock, stale workspace token, PDF entitlement/content.                          |
| KeyboardManager           | Every shortcut across editor/non-editor, editable target, modal, and operation-busy states.                                     |
| AccountSwitcher           | Identity/org render, create/select/logout actions, late org-context availability, failed switch rollback.                       |
| TrailerGeometry           | Cross-implementation property/parity fixtures for every truck mode, units, boundaries, capacity and support rules.              |
| InviteHandoff             | Full invite/auth/user/org outcome matrix with URL/session cleanup.                                                              |
| State reactions           | Metadata→save/render/capture effect matrix and exactly one synchronous subscriber.                                              |
| Scoped state lifecycle    | Cross-user/org storage keys, autosave suspension, seed/repair, rollback, transient reset, history boundary.                     |
| Billing UI/runtime        | Entitlement/role/action matrix plus stale async/cross-tab/focus/offline/access-loss races.                                      |
| Org/workspace lifecycle   | Resolution priority, optimistic rollback, partial/empty bundles, same/cross-tab freshness and every lifecycle event.            |
| Auth lifecycle            | Ordered event matrix, synchronous different-user isolation, stability timers, recovery/disabled/offline/hidden/cross-tab cases. |
| Composition root          | Construction trace, global facade, import-time side effects, vendor/DOM order, one-shot init, ready/fatal handoff.              |

## 11. Phase 0 boundary

This inventory documents confirmed current behavior, plausible extraction seams, and explicitly
labeled uncertainty. It does not approve any extraction, deletion, public API change,
history-semantics change, billing fix, or workspace/auth refactor. Each future phase requires its
own reviewed scope and validation evidence.

This audit document is the only file created or edited for Phase 0. The pre-existing
`styles/main.css` modification and every other repository file—including files created today—were
left untouched. No branch was created or changed for this audit.

**No production code was changed during this phase.**

**Author:** Audit produced by Codex 5.6 Sl Ultra.
