# `src/app.js` Modularization Inventory

**Author:** Audit produced by Claude Sonnet 5
**Phase:** 0 — audit only  
**Audit date:** 2026-07-21  
**Primary file:** `src/app.js` (9,964 lines at audit time)  
**Scope:** architecture, dependencies, state lifecycle, startup order, extraction seams, risks, and validation requirements

> No production code was changed during this phase.

> **Provenance note:** This file is one author's independent completion of the Phase 0 inventory. Sections 1–5 below were inherited unmodified from a prior, partial pass at this same document found on disk at the start of this session (already present in the repository, itself apparently produced by an earlier session of the same model). Sections 6–11 were authored independently in this session, then verified against the source (`src/app.js`, `index.html`) via targeted greps before being finalized. Do not treat this file as the project's canonical inventory — `docs/engineering/app-js-modularization-inventory.md` is canonical and reflects a separate, more thorough completion of sections 6–11 produced concurrently by another session. This file is preserved for provenance/comparison only, per explicit instruction not to let this session's authored content be silently discarded.

## 1. Executive summary

`src/app.js` is not only an entry point. It is the application's composition root, a billing runtime, an authentication and workspace lifecycle coordinator, a state hydration and persistence coordinator, a router/screen renderer, and the owner of several UI controllers. Its highest-risk behavior is concentrated around user identity, organization selection, scoped storage, billing entitlement, cross-tab synchronization, and startup timing.

The file can eventually become a small orchestration root, but extraction must proceed from passive leaf code toward lifecycle code. The first implementation phases should move static screen data and isolated UI helpers only after seam-characterization tests exist. Authentication, workspace switching, scoped state hydration, the root store subscriber, and billing synchronization must remain late-stage work.

The most important confirmed constraints are:

- There is no static ESM import cycle back into `src/app.js`; no source module imports it. Reverse dependencies nevertheless exist through `window.TruckPackerApp`, `window.OrgContext`, `window.__TP3D_BILLING`, and other globals.
- Importing `src/app.js` has side effects before `init()` runs: debugger setup, billing globals, a `storage` listener, and a `BroadcastChannel` are installed during module evaluation.
- Many factories capture DOM elements before the guarded `DOMContentLoaded` boot callback. This is safe today because `index.html` imports the module at the end of `<body>`, and it is an order dependency that modularization must preserve or remove deliberately.
- The app uses one module-level `CoreStateStore` singleton through both direct imports and injected facades. A piecemeal conversion to instance state would create split-brain state.
- User/workspace changes synchronously isolate identity and replace scoped state under an autosave suspension guard. The precise ordering is a security boundary.
- `StateStore.replace(..., { skipHistory: true })` does not clear or rebase undo history. Old-scope history can therefore survive a user/workspace replacement and be reached by the global undo shortcut. This is a pre-existing P0 hazard to characterize before state-lifecycle extraction, not a Phase 0 fix.
- Several methods are assigned to a temporary `window.TruckPackerApp` object while its IIFE is evaluating. The final IIFE assignment replaces that object and omits `notifyOrgAccessLoss`, `handleWorkspaceLeft`, and `handleOwnershipTransferred`. Their intended public bridges are therefore ineffective after composition completes.
- `AutoPackEngine` is constructed before `ExportService`; its preview callback safely closes over the later mutable binding. Reordering those constructions can introduce a temporal-dead-zone or undefined-service failure.
- `OperationLifecycle` is constructed before editor interaction, AutoPack, truck-change, preview, and keyboard consumers. That order protects mutually disruptive editor mutations.
- The exact startup flow, listener cardinality, public global facade, storage scope, and cross-tab freshness rules are contracts even where they are not expressed as types.

### Recommended end state

Keep `src/app.js` as the composition and boot root. It should import factories, create shared runtime objects in an explicit order, inject dependencies, start one authoritative application lifecycle, expose a deliberately versioned public facade, and hand fatal/ready state back to the preboot shell. Domain behavior, screen controllers, and lifecycle coordinators should live in owner modules, but only after their current contracts are protected by tests.

### Evidence used

- A complete line-by-line read of `src/app.js` and its imported lifecycle owners.
- Graphify queries against `graphify-out/graph.json`, followed by targeted source/reference tracing.
- `graphify-out/wiki/index.md` and the Core App Runtime community summary for broad navigation.
- Static searches for imports, function/property consumers, DOM access, StateStore reads/writes, event listeners, and global objects.
- Current product constraints in `docs/product/TP3D-MASTER-TODO-V5.md`, `docs/product/BILLING_ENTITLEMENT_RULES.md`, and the current repository tests.

Line ranges below describe the audited revision and will drift after future edits.

## 2. Current `app.js` responsibility map

Risk meanings used throughout this document:

- **LOW:** isolated presentation/static behavior with narrow inputs and observable output.
- **MEDIUM:** multiple UI or service dependencies, but limited identity/persistence impact.
- **HIGH:** shared editor, routing, persistence, or timing behavior; regression affects a major workflow.
- **VERY HIGH:** authentication, billing, workspace identity, cross-tab state, scoped storage, or boot-order behavior; regression can expose or corrupt the wrong user's/workspace's state.

| Responsibility | Location | Purpose and current behavior | Dependencies | Risk |
|---|---:|---|---|---|
| Imports and debugger bootstrap | 51–100 | Loads every factory/service used by the composition root and immediately calls `initTP3DDebugger()` during module evaluation. | All imported modules; browser global used by debugger. | MEDIUM |
| Billing authority state | 103–382 | Owns `_billingState`, entitlement defaults, authoritative/non-authoritative freshness, user-switch guards, state reset, and billing-state application. | `fetchBillingStatus`, app-local auth/org accessors, `window.__TP3D_BILLING`, timers. | VERY HIGH |
| Cross-tab billing coordination | 383–808 | Serializes billing snapshots through local storage, `BroadcastChannel`, lock/result records, freshness/version checks, and a top-level `storage` listener. | `localStorage`, `BroadcastChannel`, `storage` event, tab/user/org identity. | VERY HIGH |
| Auth-revocation and workspace-ready billing helpers | 810–1219 | Classifies auth failures, coordinates forced sign-out/access loss, waits for authoritative workspace context, and gates billing reads until auth settles. | Supabase wrapper, late-bound auth truth accessors, org access-loss callback, `CustomEvent`. | VERY HIGH |
| Billing fetch and entitlement normalization | 1221–1872 | Throttles and single-flights `/billing-status`, shares work cross-tab, rejects stale epoch/user/org results, handles 401/access-loss states, applies developer overrides, and derives Pro rules. | Billing service, auth/org accessors, cross-tab layer, UI gate callback, URL/time APIs. | VERY HIGH |
| Checkout, portal, and billing global facade | 1874–2014 | Enforces owner/manage-billing rules, opens checkout/portal, and exposes selected billing methods/state through `window.__TP3D_BILLING`. | Billing service, browser navigation, toasts, Settings overlay, global consumers. | VERY HIGH |
| Pre-composition boot and fatal errors | 2016–2181 | Records build metadata, waits for Three.js readiness, creates system/error overlays, tracks boot phases, and installs fatal runtime handlers. | `window.__TP3D_BOOT`, Three.js loader, DOM, `error`, `unhandledrejection`. | HIGH |
| Core facades, toast normalization, event bridge, and session | 2184–2405 | Adapts imported singletons, normalizes notifications, bridges error/theme events, creates session helpers, installs app/dev helper globals. | Core utilities/defaults/store/storage/session/events, UI components, debugger globals. | MEDIUM |
| Overlays and authentication UI | 2407–2513 | Constructs Settings, Account, Card, Help, and Auth overlays and wires overlay callbacks. | State, preferences, Supabase, billing functions, org getters, DOM. | HIGH |
| Canonical logout flow | 2515–2574 | Coordinates user-initiated sign-out, billing reset, UI state, and auth fallback handling. | Supabase, billing state, Auth overlay, account switcher, timers/location. | VERY HIGH |
| Connectivity and offline indicator | 2576–2647 | Responds to online/offline state and shows or hides an offline banner. | `navigator.onLine`, DOM, `online`/`offline` listeners. | LOW |
| Import-app dialog composition | 2649–2659 | Injects storage, state, preferences, libraries, and refresh callbacks into the app-import dialog. | Import dialog factory, state/storage/libraries, render callbacks. | MEDIUM |
| Dropdown/settings/account helpers | 2661–2697 | Closes dropdowns, opens Settings, and contains an unused Account-overlay wrapper. | DOM, Settings/Account overlay objects. | LOW |
| Workspace creation and account switcher | 2699–3142 | Renders identity/workspace UI, creates workspaces, selects organizations, opens settings, logs out, and reflects org/billing state. | Supabase org APIs, Session, org context, billing refresh, storage, DOM. | HIGH |
| Case defaults and application-local trailer geometry | 3144–3409 | Resolves case colors and provides container-space/capacity/zone conversions used by injected pack/editor logic. | Defaults, trailer presets, unit conversion utilities. | VERY HIGH for geometry; LOW for color helper |
| Pack library facade and static Updates/Roadmap data | 3411–3450 | Aliases the pack-library singleton and defines static screen content. | Pack library; no runtime service for static data. | LOW |
| Application shell and screen routing UI | 3452–3562 | Captures shell DOM, binds navigation, shows the active screen, updates topbar/sidebar state, and delegates screen renders. | Router, StateStore, all screen controllers, DOM. | HIGH |
| Scene runtime and case-scene adapter | 3564–3581 | Creates the Three.js runtime and the case-scene integration. | `window.THREE`, DOM/editor roots, preferences, state. | HIGH |
| Operation lifecycle and interaction manager | 3583–3602 | Creates the authoritative mutation lock before interaction consumers and routes busy-state feedback. | Operation lifecycle, editor screen factory, scene, state, toasts. | VERY HIGH |
| AutoPack composition | 3604–3627 | Constructs AutoPack with state, libraries, geometry, operation lifecycle, entitlement gate, persistence, and preview callback. | AutoPack service, ExportService late binding, Scene/CaseScene, billing, storage. | VERY HIGH |
| Export, preview, screenshot, and PDF service | 3629–4188 | Captures workspace-safe previews, screenshots the renderer, gates/render PDFs, and builds cargo instructions/checklists. | Scene, state/libraries, operation lifecycle, billing, `THREE`, `jspdf`, canvas/DOM. | HIGH |
| Import dialogs, truck-change controller, and screens | 4190–4274 | Constructs pack/case import UI, truck reconciliation, packs/cases/editor screens, and injects shared services. | State, libraries, scene, AutoPack, operation lifecycle, overlays, DOM. | HIGH to VERY HIGH |
| Updates and Roadmap screen controllers | 4276–4368 | Renders static cards into the existing screen containers; their `init` methods are intentional no-ops. | Static data, DOM. | LOW |
| Legacy hash Settings screen | 4370–4440 | Reads/writes preferences in the dedicated `#/settings` screen, separate from the Settings overlay. | Preferences manager, storage, scene, DOM. | MEDIUM |
| Keyboard manager | 4442–4705 | Handles undo/redo, delete, duplicate/copy/paste, nudge/rotate and editor shortcuts while respecting operation locks and editable targets. | State, PackLibrary, EditorUI, InteractionManager, OperationLifecycle, browser events. | HIGH |
| Export/import/help button launchers | 4707–4826 | Opens app/workspace/pack/case import/export flows and Help from global buttons. | ImportExport, dialogs, overlays, Storage, StateStore, DOM. | MEDIUM |
| Scoped state bootstrap and hydration | 4828–5036 | Owns autosave suspension, user/workspace storage scopes, anonymous seeding, scope reset/reload, library repair, and transient state reset. | StateStore singleton, Storage singleton, defaults, libraries, Preferences, identity/org getters. | VERY HIGH |
| Runtime validation, render fanout, recoverable errors | 5038–5128 | Validates browser/vendor requirements, renders all screens and shell, and routes recoverable errors without tearing down boot. | Browser utilities, vendor globals, every screen, overlays. | HIGH |
| Workspace-switch state and cross-tab metadata | 5130–5434 | Tracks readiness/reasons/epochs, records switch metrics, broadcasts state, and resets transient UI around workspace transitions. | Org identity, storage, DOM/events, billing pump, screen controllers. | VERY HIGH |
| Auth refresh state and stability gate | 5436–5781 | Owns auth single-flight/queue state, stabilizes transient signed-out events, snapshots auth truth, and times boot/post-boot gates. | Supabase session APIs, timers, document visibility, user-switch epoch. | VERY HIGH |
| Active organization and `OrgContext` | 5793–6170 | Resolves and changes the active org, swaps storage/state, persists profile hints, rolls back failed changes, and applies guarded cross-tab org messages. | Supabase org APIs, Storage/StateStore, local storage events, billing, settings/screens. | VERY HIGH |
| Billing refresh pump | 6171–6365 | Coalesces and retries refresh triggers based on visibility, online state, auth truth, org readiness, and user/workspace epochs. | Billing runtime, auth/org state, timers, `visibilitychange`, online/focus. | VERY HIGH |
| Workspace lifecycle and global bridges | 6367–6645 | Handles access loss, leave/archive/restore/ownership/update events and attempts to expose handlers on `window.TruckPackerApp`. | Supabase, org bundle refresh, billing/state reset, Settings overlay, global facade. | VERY HIGH |
| Account bundle resolution and no-org UI | 6647–7041 | Selects the best active org from hints/memberships, distinguishes partial from confirmed-empty bundles, and disables org-required controls. | Supabase bundle, profile/local hints, AppShell/screens, DOM. | VERY HIGH |
| Org bundle application and refresh | 7043–7245 | Applies bundle truth, changes workspace scope only when needed, schedules rendering/billing, and queues hidden/single-flight refreshes. | Supabase, org context, storage/state, Settings/Account switcher, billing. | VERY HIGH |
| Auth rendering, profile enforcement, and user isolation | 7247–8026 | Refreshes identity, synchronously isolates different users, handles signed-in/signed-out UI, hydrates scoped state/org data, and enforces profile status. | Supabase, Auth overlay, storage/state, org/billing, all UI controllers. | VERY HIGH |
| Main `init()` — Supabase, invite, and auth listeners | 8028–8767 | Guards one-shot initialization, validates vendors/config, initializes Supabase, installs auth/invite/cross-tab/visibility listeners, and defines bootstrap sequencing. | Nearly every app subsystem plus `index.html` globals. | VERY HIGH |
| Component initialization | 8769–8787 | Initializes shell/screens/overlays/switcher/global buttons/keyboard and installs component error boundaries. | All composed UI controllers. | HIGH |
| Billing UI, trial, plan, role hydration, and resume hooks | 8789–9787 | Renders upgrade/payment states, derives role-gated CTAs, coordinates trial dialogs/plan picker, hydrates org roles, and refreshes on focus/Stripe return. | Billing state/service, Settings, account bundle, URL/session storage, DOM. | VERY HIGH |
| Root StateStore subscriber | 9797–9869 | Performs autosave, theme/scene/settings updates, preview capture on editor exit, and shell/screen/error render fanout for every state change. | StateStore, Storage, Scene, ExportService, every screen/overlay. | VERY HIGH |
| Router, initial render, auth gate, public facade, and final boot | 9871–9964 | Initializes hash routing, renders once, awaits auth bootstrap, marks ready, returns the public app API, checks browser support, and invokes `init()` after DOM readiness. | Router, BootState, Auth lifecycle, `window.TruckPackerApp`, DOM. | VERY HIGH |

### Responsibilities that should remain in `app.js`

The eventual composition root should continue to own only:

1. Static imports of factories and deliberately shared singletons.
2. Construction/injection order for the top-level dependency graph.
3. One guarded call into the authoritative startup lifecycle.
4. Registration of the intentionally public application facade.
5. Preboot fatal/ready handoff needed by `index.html`.
6. High-level orchestration between lifecycle controllers; no domain implementation.

The current inline implementations of billing, authentication, workspace handling, state hydration, rendering, and UI controllers should not remain permanently, but they must not be extracted until their implicit contracts are explicit and tested.

## 3. Dependency map

### 3.1 Static imports

| Category | Imports | Current use |
|---|---|---|
| Boot/debug | `./debugger.js`, `./core/dev/dev-helpers.js`, `./core/app-helpers.js`, `./core/version.js` | Debugger side effects, opt-in dev helpers, public helper facade, build/version reporting. |
| Core runtime | `./core/utils/index.js`, `./core/browser.js`, `./core/defaults.js`, `./core/events.js` | Units/IDs/cloning, capability checks, default state, and the internal event bus. |
| State and persistence | `./core/state-store.js`, `./core/storage.js`, `./core/session.js`, `./services/preferences-manager.js` | Shared state/history, scoped local persistence, separate session state, and preference mutations/theme events. |
| Auth/backend | `./core/supabase-client.js`, `./data/services/billing.service.js` | Client/session/org/invite APIs and billing-status/checkout/portal/invite calls. |
| Domain services | `./services/category-service.js`, `./services/case-library.js`, `./services/pack-library.js`, `./services/import-export.js`, `./services/autopack-engine.js` | Case/pack/category mutation, file interchange, and packing orchestration. |
| 3D/editor | `./data/trailer-presets.js`, `./editor/scene-runtime.js`, `./screens/editor-screen.js`, `./core/operation-lifecycle.js`, `./ui/truck-change-controller.js` | Trailer definitions, renderer/scene, interaction/editor controllers, operation locking, and truck reconciliation. |
| Screens | `./router.js`, `./screens/packs-screen.js`, `./screens/cases-screen.js` | Hash routing and primary screen rendering. Updates, Roadmap, and the legacy Settings screen are still inline. |
| Shared UI | `./ui/system-overlay.js`, `./ui/error-overlay.js`, `./ui/ui-components.js`, `./ui/table-footer.js` | Boot/fatal/recoverable feedback and reusable UI primitives. |
| Overlays/dialogs | `./ui/overlays/settings-overlay.js`, `account-overlay.js`, `card-display-overlay.js`, `help-modal.js`, `auth-overlay.js`, `import-app-dialog.js`, `import-pack-dialog.js`, `import-cases-dialog.js` | Modal UI and import/auth/settings workflows. |

No module under `src/` was found to statically import `src/app.js`. Therefore, no ESM circular dependency involving `app.js` is currently confirmed. This does **not** mean the graph is acyclic at runtime.

### 3.2 Runtime reverse dependencies and hidden coupling

| Producer/global | Consumers found | Coupling concern |
|---|---|---|
| `window.TruckPackerApp` | `settings-overlay.js`, debugger code, inline AppShell/editor lookups | Consumers feature-detect methods rather than import an interface. Temporary-object assignments during IIFE evaluation are later overwritten by the final facade. |
| `window.OrgContext` | Settings overlay, billing service, AutoPack, debugger, other org-aware UI | Active-org identity is ambient. A caller can read it at the wrong point in a workspace transition unless readiness/epoch checks travel with it. |
| `window.__TP3D_BILLING` | Settings overlay, billing service, AutoPack, debugger, sidebar/trial UI | Combines state access, feature gates, refresh, checkout/portal, and debug behavior. Module extraction can accidentally create two billing authorities. |
| `window.__TP3D_LAST_ACCOUNT_BUNDLE` | Settings and diagnostic paths | Mutable cache is not an API; partial/confirmed-empty semantics must be preserved. |
| `window.__TP3D_USER_SWITCH_PENDING` | Billing service and auth/billing guards | Security-sensitive synchrony: it prevents old-user billing state from being accepted during an identity transition. |
| `window.SupabaseClient` / `window.__TP3D_SUPABASE_CLIENT` | `app.js` profile-status check and diagnostics | `app.js` imports the namespace but one path calls the global facade, creating an avoidable hidden dependency. Preserve behavior until explicitly migrated/tested. |
| `window.__TP3D_UI`, `window.TP3D.helpers`, debug globals | Debugger, development tooling, console/manual diagnostics | Public/developer surface may not appear in production reference searches. Treat as compatibility API until catalogued. |

The outer billing runtime also reaches into the inner application IIFE through late-bound placeholders:

- `_billingGateApplier` is assigned after the billing UI is built.
- `_orgAccessLossHandler` is assigned after workspace lifecycle handlers exist.
- `_authGateIsSettledAccessor` and `_authTruthSnapshotAccessor` are assigned after auth lifecycle state exists.
- `_getOrgRoleHydrationStateAccessor` is assigned after role hydration is defined.

These bridges avoid a static cycle but create an initialization-time cycle. Moving either side independently can cause early calls to use default/no-op accessors or stale authority.

### 3.3 Platform and vendor globals

`app.js` depends on values installed by `index.html` or classic scripts:

- `window.__TP3D_BOOT` and its `threeReady`/vendor/fatal/ready hooks.
- `window.__TP3D_FLAGS__` and `window.__TP3D_SUPABASE`.
- `window.__tp3dVendorAllReady`.
- `window.THREE`, `window.OrbitControls`, `window.TWEEN`, `window.XLSX`, `window.jspdf`, and the Supabase UMD global.
- Browser APIs: `window`, `document`, `navigator`, `location`, `history`, `localStorage`, `sessionStorage`, `BroadcastChannel`, `CustomEvent`, `DOMException`, `URL`, `URLSearchParams`, canvas/WebGL, `requestAnimationFrame`, timers, `matchMedia`, and the Page Visibility API.

Runtime validation checks the required browser/vendor capabilities, but some globals are already read or captured during composition. Delaying or reordering vendor promises is therefore not equivalent to extracting a pure module.

### 3.4 DOM ownership

DOM references are captured by inline controllers for:

- the application root, sidebar, topbar, content root, route buttons, and screen nodes;
- account/workspace switcher controls and dropdowns;
- Updates, Roadmap, and legacy Settings controls;
- import/export/help buttons;
- org-required and billing/payment/trial banners/modals;
- editor panels and feature-action buttons;
- invite handoff UI and auth-page branding.

Several captures occur when the composition IIFE evaluates, before `init()` and before the bottom `DOMContentLoaded` guard. The current body-end dynamic import makes those nodes available. A future extraction must either preserve body-end evaluation or move DOM lookup into explicit `init()` methods and test missing/late DOM conditions.

### 3.5 Event/listener inventory

| Channel | Current behavior and order concern |
|---|---|
| `window.storage` | Billing coordination installs a listener at module evaluation. Auth/org cross-tab listeners are installed later in `init()`. Records must remain user-, org-, tab-, epoch-, and freshness-guarded. |
| `BroadcastChannel` | Billing channel is created at module evaluation when supported. Duplicate module/controller creation would create competing responders. |
| `window.error` / `unhandledrejection` | Preboot and runtime layers both participate. Extraction must preserve which errors are fatal versus recoverable. |
| `online`, `offline`, `focus`, `visibilitychange` | Drive connectivity UI, auth refresh, billing resume, and hidden-tab queues. They are not presentation-only listeners. |
| `hashchange` | Owned by `Router.init()`; its returned unsubscribe is currently not retained. App init idempotence prevents duplicate installation. |
| `keydown` | Owned by KeyboardManager and guarded by active screen, editable targets, modal/busy state, and operation lifecycle. |
| `DOMContentLoaded` | Bottom boot guard calls `TruckPackerApp.init()`; it does not protect earlier module-evaluation DOM capture. |
| Custom window events | `tp3d:auth-signed-out`, `tp3d:workspace-ready`, `tp3d:org-changed`, `tp3d:org-access-lost`, and `tp3d:workspace-switch-state` connect lifecycle layers. Payload identity and dispatch order are part of the contract. |
| Internal event bus | `app:error`, `theme:apply`, storage errors, and `auth:changed` connect state/services/UI. Listener errors are isolated by the event implementation. |

Most global listeners do not have a retained teardown path. This is acceptable only while application initialization and controller construction remain singleton/one-shot. Future modules should expose teardown for tests and hot/repeated initialization, while preserving one production installation.

### 3.6 Initialization-order dependencies

1. Three.js readiness must resolve before the outer composition starts.
2. Body DOM must exist before current factory construction captures elements.
3. Billing module-evaluation state/listeners currently exist before auth and UI initialization.
4. `OperationLifecycle` must exist before InteractionManager, AutoPack, Truck Change, editor mutation paths, preview, and shortcuts.
5. `AutoPackEngine` is built before `ExportService`; its callback must remain lazy and must not run before `ExportService` assignment.
6. Auth/user-switch accessors are late-bound into the already-created billing runtime.
7. Supabase's internal auth listener is installed during `SupabaseClient.init()`; the app listener is installed afterward.
8. The app auth listener is installed before component initialization and before the root StateStore subscriber. Explicit `renderAll()` calls currently compensate for state changes that can occur before the subscriber exists.
9. The StateStore subscriber is installed before `Router.init()`. The initial hash can mutate `currentScreen`; a later explicit `renderAll()` establishes the final initial view.
10. `init()` is single-flight and marks itself completed in `finally`, including early failure paths whose retry UX reloads the page.

These dependencies should be captured as tests before moving constructors or listeners.

## 4. State lifecycle analysis

### 4.1 Current architecture

`app.js` does **not** create a store instance. It imports the singleton module `src/core/state-store.js` as `CoreStateStore` and builds a local facade whose methods are references to that singleton. Other modules either import the same singleton directly or receive the facade through a factory. This hybrid access pattern still reaches one state object today.

The StateStore owns module-level state, undo history, a history pointer, and subscribers. Its relevant semantics are:

- `init(initialState)` replaces live state and resets history.
- `set(patch, meta)` shallow-merges a patch, records a history snapshot for significant keys, and notifies synchronously.
- `replace(nextState, meta)` deep-clones a whole state and notifies; `skipHistory` prevents a new snapshot but does not reset old history.
- `undo()` and `redo()` restore only the history slice.
- subscriber failures are caught so one listener cannot stop the others.

The only production runtime StateStore subscription found is installed in `app.js` at 9797–9869. Several modules write directly to the singleton, while other writers receive it through composition. Extraction must preserve that they are the same authority.

### 4.2 State keys and ownership

| Key | Meaning | Persistent? | Principal writers/readers |
|---|---|---|---|
| `caseLibrary` | Case definitions and categories | Workspace-scoped | Case/category services, Cases screen, import dialogs, app hydration. |
| `packLibrary` | Packs, truck/case placement state, notes/metadata | Workspace-scoped | Pack library, Packs/Editor screens, AutoPack through library APIs, imports, app hydration. |
| `folderLibrary` | Pack-folder hierarchy | Workspace-scoped | Folder/pack services, imports, hydration. |
| `preferences` | Units, theme, labels, grid, screenshot/PDF preferences | User-scoped | Preferences manager, Settings overlay/screen, imports, app hydration. |
| `currentPackId` | Active pack | Workspace-scoped | PackLibrary/app hydration and reset, screens. |
| `currentScreen` | Current hash-backed screen | No | AppShell/Router and workspace/auth reset. |
| `selectedInstanceIds` | Current editor selection | No | Interaction/Editor/Keyboard/PackLibrary and workspace reset. |
| `autoPackResults` | Transient AutoPack result set/carousel state | No | AutoPack engine and Editor screen. |

State history intentionally snapshots only `caseLibrary`, `packLibrary`, `folderLibrary`, and `preferences`. Screen, current pack, selection, and AutoPack-result state are not restored by undo/redo.

### 4.3 Persistence and scope lifecycle

`src/core/storage.js` independently imports the same StateStore singleton. It separates:

- **user scope:** preferences;
- **workspace scope:** case library, pack library, folder library, and current pack;
- **transient state:** current screen, selection, and AutoPack results are not persisted.

The actual lifecycle is:

1. Before auth is known, `init()` applies the anonymous/no-org storage scopes, loads or seeds local state, and applies theme.
2. When a signed-in user is established, the user storage scope changes first.
3. A hinted workspace scope is applied and loaded so the UI can resume promptly.
4. The authoritative account bundle resolves the final valid organization.
5. If the final workspace differs, workspace storage scope and live state are replaced again.
6. `suspendAutoSave` prevents the root StateStore subscriber from writing freshly replaced state into the previous identity/workspace scope.
7. Explicit render calls compensate for hydration that can occur before the root subscriber is installed.
8. Later persistent state mutations call `Storage.saveSoon()` through the root subscriber; storage reads the singleton at flush time.

Workspace switching also resets transient UI/editor state so selection, previews, clipboard-like state, pack visibility, members/invites, and billing UI cannot leak from the previous org.

### 4.4 State consumers and mutation style

Direct singleton imports include `category-service.js`, `case-library.js`, `folder-library.js`, `pack-library.js`, `preferences-manager.js`, `storage.js`, and `settings-overlay.js`. Injected readers/writers include Scene Runtime, AutoPack, Editor, Packs/Cases screens, truck-change, and import dialogs. A later refactor must not introduce a new store instance for only one side.

`src/core/session.js` owns a separate session singleton and AccountSwitcher subscribes to it. It is not a view of the main StateStore. `src/core/state.js` defines another StateStore-like singleton but has no confirmed production importer; it is catalogued as a legacy candidate rather than treated as current state authority.

### 4.5 Confirmed state hazards

| Hazard | Evidence | Consequence | Required pre-extraction action |
|---|---|---|---|
| History crosses state replacement | Scope changes use `StateStore.replace(..., { skipHistory: true })`; `replace` does not clear existing history; global undo remains active. | Undo after user/org switching can merge a prior scope's history slice into the new scope. | Decide and test the history boundary for identity/workspace replacement before moving hydration code. Do not obscure the issue with modularization. |
| Hybrid direct/injected access | Production modules use both direct singleton imports and injected facades. | Partial instance migration can create split-brain reads/writes and divergent persistence. | Retain the singleton during extraction; migrate access style only as a separate, all-consumer change. |
| Synchronous user isolation | `applyUserSwitchIsolation()` clears old identity/org/billing/state before any awaited work for a new user. | An inserted `await` or reordered lookup can expose old user's local state or billing truth. | Preserve synchronous ordering and existing security invariant tests. |
| Autosave scope race | Storage flush reads current singleton and current scope; scope swaps suppress subscriber saves. | Removing or narrowing `suspendAutoSave` can write old/new state under the wrong key. | Add scope-specific save-spy tests and keep loader/scope/suspension as one unit. |
| Subscriber is an implicit coordinator | One callback combines persistence, theme, scene, preview, and rendering. | Splitting it without an order contract can duplicate saves/renders or capture a preview after scene teardown. | Characterize the exact change→effect matrix before extracting the coordinator. |

### 4.6 Future recommended state architecture

For the initial modularization, retain `CoreStateStore` as the single authority. Extract a domain-aware `AppStateLifecycle` only after tests exist. That controller should be injected with:

- the existing StateStore and Storage facades;
- Defaults and library-repair functions;
- authoritative user and org accessors;
- render/theme/scene callbacks;
- preview and AutoPack transient reset callbacks;
- workspace-switch state and autosave-suspension controls.

It should expose explicit operations such as `loadInitialAnonymousState`, `switchUserScope`, `switchWorkspaceScope`, `resetTransientEditorState`, `startStateReactions`, and `stopStateReactions`. Hydration should **not** move into generic `state-store.js`: choosing a user/org scope, repairing pack data, and resetting editor state are application-domain responsibilities.

Changing from a singleton to an instance store, changing history semantics, and splitting persistence are separate architectural projects. They should not be folded into file extraction.

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
- Billing cross-tab listeners exist before the app auth listener; any early billing result still needs user/org authority checks.
- Supabase internal initialization precedes the app's auth callback registration.
- Different-user isolation stays synchronous and precedes old-org hints or awaited fetches.
- UI components and the StateStore subscriber can currently be installed after an auth callback is registered; explicit rendering is required to cover that window.
- OperationLifecycle construction and guard injection precede every mutating editor controller.
- Router initialization occurs after the StateStore subscriber and before the final explicit render.
- Only one production init/listener graph is installed. Repeated `init()` calls return the same in-flight result or no-op after completion.
- The final global facade assignment must happen before the bottom boot invokes `init()`.

## 6. Extraction candidates

For each candidate: current location, functions involved, files it depends on, files depending on it, why extraction is safe, why extraction could be risky, recommended destination, complexity, risk.

### 6.1 Static content (`Data` — updates/roadmap arrays)
- **Current location:** L3419–3450.
- **Functions/data involved:** the `updates` and `roadmap` array literals only; no logic.
- **Depends on:** nothing.
- **Depended on by:** `UpdatesUI.render()`, `RoadmapUI.render()` (both inside `app.js` itself).
- **Why safe:** Pure data, zero side effects, zero external references.
- **Why risky:** Essentially none — the only care needed is keeping the same shape (`{version,date,features,bugFixes,breakingChanges}[]` / `{quarter,items:[{title,status,badge,color,details}]}[]`).
- **Recommended destination:** `src/data/release-notes.js` and `src/data/roadmap.js` (or one `src/data/static-content.js`), matching the existing `src/data/trailer-presets.js` pattern already imported by `app.js`.
- **Estimated complexity:** TRIVIAL.
- **Risk:** LOW.

### 6.2 Debug wrapper-detective installer
- **Current location:** L2299–2405 (`installWrapperDetective` IIFE).
- **Functions involved:** `safeFnInfo`, `getSupabaseClient` (local), `globalThis.__TP3D_WRAPPER_DETECTIVE__.getWrapperUsage/.smokeTest`.
- **Depends on:** `SupabaseClient` (imported), `isTp3dDebugEnabled`-equivalent gate (re-implemented inline here rather than reusing the module-scope `isTp3dDebugEnabled`, worth normalizing during extraction).
- **Depended on by:** nothing else in `app.js`; purely a dev-console surface.
- **Why safe:** Self-contained, opt-in (only runs when `tp3dDebug=1`), no other code reads its output programmatically.
- **Why risky:** Low — the only risk is accidentally changing when/how it re-installs (`globalThis.__TP3D_WRAPPER_DETECTIVE__` presence check) if the extraction changes module-load timing relative to when `tp3dDebug` is read.
- **Recommended destination:** `src/core/dev/wrapper-detective.js`, invoked from `src/core/dev/dev-helpers.js` (which `app.js` already imports and calls via `installDevHelpers`).
- **Estimated complexity:** LOW.
- **Risk:** LOW.

### 6.3 `TrailerGeometry` (rect/wheelWells/frontBonus zone math)
- **Current location:** L3168–3409.
- **Functions involved:** `getDims`, `getMode`, `getConfig`, `zone`, `sanitizeZones`, `getTrailerUsableZones`, `getTrailerCapacityInches3`, `isAabbContainedInAnyZone`, `zonesInchesToWorld`, `zonesToSpacesInches`, `getWheelWellsBlockedZones`, `getFrontBonusZone`, `getFrontBonusBlockedZones`.
- **Depends on:** `Utils.clamp`, `SceneManager.toWorld` (for the two `zonesInches→World`/`zonesToSpaces` converters only), `CorePackLibrary.CONTAINMENT_EPS_INCHES`.
- **Depended on by:** `ExportService` (`isInsideTruckInstance`, `buildOrthoCameras`-adjacent PDF logic), `AutoPackEngine` (constructed with `TrailerGeometry` injected), `EditorUI` (constructed with `TrailerGeometry` injected) — i.e. genuinely shared across three of `app.js`'s biggest constructed modules, not just used locally.
- **Why extraction is safe (technically):** It's pure functions over plain objects/numbers (apart from the two `SceneManager.toWorld`-dependent converters), already tested indirectly via `tests/audit/security-and-invariants.spec.mjs` (which asserts on the literal source text of several of these functions), and has no dependency on any `app.js`-local closure state.
- **Why it could be risky:** This is **packing-safety geometry** explicitly covered by the AutoPack "Permanent Safety Reminders" in both CLAUDE.md files (Wheel Wells shelf-support contract, Front Overhang rear-retention contract). CLAUDE.md is explicit that this class of change needs V5 product approval regardless of how mechanically safe the extraction is. The existing tests also assert on **exact source-text patterns** referencing "app.js TrailerGeometry" by name, so extraction would require updating those test assertions in lockstep, not just moving code.
- **Recommended destination:** `src/editor/trailer-geometry.js` (sibling to the already-imported `src/editor/scene-runtime.js`), or as a new export from `src/data/trailer-presets.js` if product prefers geometry co-located with truck data.
- **Estimated complexity:** MEDIUM (pure-function move) but HIGH in practice due to the test-text coupling.
- **Risk:** HIGH — not for the code motion itself, but for the required product approval and the coordinated test-file updates. **Do not extract without explicit V5 sign-off**, per CLAUDE.md AutoPack safety rules.

### 6.4 Export/capture pipeline (`ExportService`)
- **Current location:** L3632–4188.
- **Functions involved:** `estimateDataUrlBytes`, `capturePackPreview`, `clearPackPreview`, `captureScreenshot`, `generatePDF`, `getCurrentPack`, `safeName`, `downloadDataUrl`, `buildOrthoCameras`, `buildChecklist`, `isInsideTruckInstance`, `renderCameraToDataUrl`.
- **Depends on:** `SceneManager` (camera/renderer/scene + `toWorld`), `PackLibrary`, `CaseLibrary`, `CategoryService`, `TrailerGeometry` (§6.3), `OperationLifecycle`, `PreferencesManager`, `Utils`, `ImportExport.buildCargoInstructionsManifest`, `getProRuleSet`/billing state (Pro-gate check inside `generatePDF`), globals `window.jspdf`/`THREE`.
- **Depended on by:** `AutoPackEngine` (injected `capturePackPreview` callback — a forward reference), `PacksUI` (injected `ExportService`), `EditorUI` (injected `ExportService`), the `StateStore.subscribe` auto-thumbnail-capture branch.
- **Why safe:** Cohesive single responsibility ("turn the 3D scene into pixels/files"); already exposes a clean 4-method public surface (`{captureScreenshot, generatePDF, capturePackPreview, clearPackPreview}`).
- **Why risky:** `generatePDF` embeds a billing/Pro-gate check inline (would need `getProRuleSet` + billing-state access injected, i.e. cannot be a zero-dependency module); `renderCameraToDataUrl` mutates live renderer state (viewport/scissor/pixelRatio/background/grid visibility) and must keep its `finally`-based restore intact; the auto-thumbnail-capture call site lives in `app.js`'s `StateStore.subscribe`, so extraction doesn't remove *all* `app.js`-side coupling, just the implementation.
- **Recommended destination:** `src/services/export-service.js` (factory `createExportService({SceneManager, PackLibrary, CaseLibrary, CategoryService, TrailerGeometry, OperationLifecycle, PreferencesManager, Utils, ImportExport, getProRuleSet, getBillingState, UIComponents})`), matching the existing `createAutoPackEngine`/`createEditorScreen` factory pattern already used elsewhere in this same file.
- **Estimated complexity:** MEDIUM–HIGH.
- **Risk:** MEDIUM.

### 6.5 `UpdatesUI` / `RoadmapUI` (presentational screens)
- **Current location:** L4279–4368.
- **Functions involved:** `initUpdatesUI`/`render`, `initRoadmapUI`/`render`.
- **Depends on:** `Data` (§6.1), DOM ids `#updates-list`/`#roadmap-list`, `UIComponents.showModal` (roadmap item click).
- **Depended on by:** `AppShell`'s screen-title map (loosely, by screen key), `renderAll()`, `queueOrgScopedRender()`.
- **Why safe:** Small, presentational, already follow the `{init, render}` shape used by every other screen module `app.js` imports.
- **Why risky:** DOM-element lookup happens at IIFE-construction time — extraction must preserve "construct after DOM ready."
- **Recommended destination:** `src/screens/updates-screen.js`, `src/screens/roadmap-screen.js` (sibling to the already-imported `packs-screen.js`/`cases-screen.js`).
- **Estimated complexity:** LOW.
- **Risk:** LOW.

### 6.6 `SettingsUI` (top-of-app preferences panel — NOT the `SettingsOverlay` modal)
- **Current location:** L4373–4440.
- **Functions involved:** `initSettingsUI`, `syncHiddenOpacityValue`, `loadForm`, `save`.
- **Depends on:** `PreferencesManager`, `Utils.deepClone`/`.clamp`, `Storage.clearAll`, DOM ids (`#pref-*`, `#btn-save-prefs`, `#btn-reset-demo`), `UIComponents.confirm`.
- **Depended on by:** `renderAll()`, the `StateStore.subscribe` theme-change branch.
- **Why safe:** Small, single responsibility, already isolated behind `{init, loadForm}`.
- **Why risky:** **Naming collision** — this module is also informally called "Settings" while a completely different, much larger `SettingsOverlay` (imported from `ui/overlays/settings-overlay.js`) exists in the same file. Any extraction should rename this to something unambiguous (e.g. `PreferencesPanel`) rather than perpetuate the collision into a new file name.
- **Recommended destination:** `src/screens/preferences-panel.js` (deliberately not `settings-*.js`, to avoid colliding with the existing `ui/overlays/settings-overlay.js`).
- **Estimated complexity:** LOW.
- **Risk:** LOW–MEDIUM (naming hazard only).

### 6.7 Auth/org/billing/workspace-switch core (§2.3, §2.4, §2.5)
- **Current location:** L102–2019, L5133–5434, L5476–7905, plus the `init()`-internal listener installation and the sidebar-notice block (L8789–9697).
- **Functions involved:** ~120 functions across the billing state machine, the Auth Stability Gate, the org-context/workspace-switch state machine, and the auth-refresh pipeline.
- **Depends on:** `core/supabase-client.js` heavily, `core/storage.js`, `core/session.js`, `data/services/billing.service.js`, `SettingsOverlay`/`AccountOverlay` (`.handleAuthChange`), every screen module (for re-render), `StateStore`.
- **Depended on by:** effectively everything else in the file, plus `settings-overlay.js` externally via `window.TruckPackerApp.*`/`window.OrgContext`/`window.__TP3D_BILLING`.
- **Why extraction *could* be safe, eventually:** The three subsystems already have reasonably clean internal boundaries (their own state objects, their own function-name prefixes: `_billing*`/`authGate*`/`orgContext*`/`workspaceSwitch*`), and CLAUDE.md's own suggested file structure (`src/core/operation-lifecycle.js` as a precedent) shows the codebase already extracts exactly this kind of "single authoritative lock/lifecycle" concept successfully elsewhere.
- **Why extraction is risky right now:** This is the single highest-risk block in the file by a wide margin. It is entangled with: the three module-scope accessor variables, the `window.TruckPackerApp.*` dual-assignment pattern relied on by `settings-overlay.js`, the synchronous-before-`await` ordering requirement in `applyUserSwitchIsolation`, and dozens of magic timing constants tuned against real cross-tab races. It is also the subject of essentially every P0 rule in both CLAUDE.md files (auth correctness, no silent sign-outs, cross-tab logout, workspace-switch safety). A partial or careless extraction is the single most likely way to reintroduce the exact bugs (BUG-01, BUG-07, etc.) referenced by name in the existing comments.
- **Recommended destination (future, not now):** A single new module, e.g. `src/core/identity-runtime.js` or `src/core/auth-org-billing-runtime.js`, that owns all three subsystems together (not three separate modules) specifically so the accessor-indirection pattern can collapse into normal same-file function calls instead of cross-module accessor plumbing. `app.js` would call one `createIdentityRuntime({...})` factory and use its returned surface, mirroring the `createOperationLifecycle()` precedent.
- **Estimated complexity:** VERY HIGH.
- **Risk:** VERY HIGH. **Not recommended for any near-term phase.** If ever attempted, it should be its own dedicated, heavily-tested initiative — not bundled with any other extraction work — and should ship with new integration tests that actually exercise cross-tab/auth-race scenarios in a browser, not just source-text assertions.

## 7. Risk assessment

| Area | Risk | Reason | Recommended approach |
|---|---|---|---|
| Billing state machine | VERY HIGH | Cross-tab locking, throttle windows, authoritative-refresh epoch/generation tokens, three accessor-indirection dependencies | Leave in place this phase; if ever extracted, bundle with auth/org (§6.7) |
| Authentication / Auth Stability Gate | VERY HIGH | Startup-timing-sensitive (8s vs 2s), P0 per both CLAUDE.md files, `applyUserSwitchIsolation` ordering constraint | Leave in place; extract only as part of §6.7, with new integration tests |
| Org context / workspace switching | VERY HIGH | Explicit P0 area per CLAUDE.md §9; three-way readiness handshake, cross-tab versioned sync | Leave in place; same as above |
| Persistence / storage-scope switching | VERY HIGH | `suspendAutoSave`/`hasLoadedScopedState` entangled with user/workspace isolation; a bug here leaks data across users | Leave in place this phase |
| `StateStore.subscribe` reactive wiring | VERY HIGH | Single point of failure for both re-render and autosave; zero dedicated tests found | Leave in place; if ever extracted, add a direct test first |
| Keyboard shortcuts / operation-lifecycle gating | HIGH | Bypass risk would defeat the AutoPack/Unpack/Truck-Change mutual-exclusion contract | Leave in place; safe to extract only alongside the screens it dispatches into |
| Export/capture pipeline (§6.4) | MEDIUM | Cohesive, already factory-shaped, but touches live Three.js renderer state and an inline billing gate | Good candidate for a later, low-priority phase |
| TrailerGeometry (§6.3) | HIGH (product, not technical) | Packing-safety geometry under explicit V5-approval rules; tests assert on its literal source text | Do not extract without V5 approval, independent of technical ease |
| Workspace-creation limit gate | MEDIUM | Client-side only; server (`org-create-workspace`) is the real enforcement point per CLAUDE.md §8.5 | Safe to extract; low product risk |
| Modal management | LOW–MEDIUM | Mostly self-contained; plan-picker has drifted pricing copy | Fine to extract; fix the pricing-copy drift in the same pass (see §8) |
| Toast/notification handling | LOW (usage) / MEDIUM (extraction) | Trivial in isolation, but the `UIComponents.showToast` monkey-patch must survive extraction exactly | Extract carefully, verify the monkey-patch still applies globally |
| Static content (`Data`) (§6.1) | LOW | Pure data | Safe first-phase candidate |
| Debug utilities (§6.2) | LOW | Opt-in, self-contained | Safe first-phase candidate |
| Theme handling | LOW | Trivial event subscription | Safe to leave or extract, low priority either way |
| Dead JSDoc-comment code (§8) | LOW (no behavior impact) | Confusing to readers, zero runtime effect | Fix independently of any extraction phase — pure cleanup |

## 8. Dead code candidates

**Possible dead code:**
1. **Duplicate function bodies pasted inside the top-of-file JSDoc comment (L1–36).**
   - **Evidence:** Lines 6–32 contain full, syntactically valid copies of `closeDropdowns()`, `openSettingsOverlay(tab = 'preferences')`, and `openAccountOverlay()`, sitting between the opening `/**` (L1) and the closing `*/` (L36) of the file's header docblock — i.e. they are comment *text*, never parsed as executable JavaScript. Real, currently-executing versions of the same three functions exist later in the file: `closeDropdowns()` at L2661, `openSettingsOverlay(tab)` at L2669 (note: the real version's signature has no default value for `tab`, unlike the dead copy — the two have already drifted), and `_openAccountOverlay()` at L2684 (renamed with a leading underscore in the real version; the dead copy is named `openAccountOverlay` with no underscore). **Verified independently:** `_openAccountOverlay()` itself has zero call sites anywhere in `app.js` — a `grep -n "_openAccountOverlay"` finds only its own `function _openAccountOverlay() {` definition line. So not only is the JSDoc copy dead, the *real* implementation is currently unreferenced too.
   - **Confidence:** HIGH — directly confirmed by reading the exact byte range; no execution path can reach comment text; the zero-call-site finding for `_openAccountOverlay` was confirmed via grep.
   - **Recommendation:** Delete lines 6–32 from the header comment as a pure-cleanup, zero-behavior-impact change. Separately flag `_openAccountOverlay()` for a decision on whether Account overlay's open path was supposed to route through it.

2. **`_showComingSoon()` (around L3009–3011) — defined, never called.**
   - **Evidence:** `grep -n "_showComingSoon"` finds only the function definition, no call sites.
   - **Confidence:** HIGH.
   - **Recommendation:** Confirm intent before removing; may be a stub for a still-planned menu item.

3. **Redundant dynamic `import('./core/supabase-client.js')` inside `ensureWorkspaceReadyForUI` (L1158).**
   - **Evidence:** `core/supabase-client.js` is already statically imported at the top of the file as `SupabaseClient` (L85). The dynamic `import()` resolves to the exact same module instance (ES modules are singletons), so this is functionally harmless but redundant.
   - **Confidence:** MEDIUM — confirmed the import target is identical; not confirmed whether this was intentional or left over from an earlier version.
   - **Recommendation:** Worth a follow-up question; not a behavior bug either way.

4. **Pricing-copy drift between `getCheckoutPlanOptions()` and the inline `pickCheckoutInterval` plan-picker modal.**
   - **Evidence:** `getCheckoutPlanOptions()` (L1883–1899) describes the yearly plan as `'$199/yr'`. The plan-picker modal built inside `init()` (L9042–9058) independently hardcodes `'Billed at $199.99/yr'`. These are two separate hardcoded strings for the same product, and they disagree by $0.99/yr.
   - **Confidence:** HIGH that the two strings disagree.
   - **Recommendation:** Flag for product/billing owner. Per CLAUDE.md §5.1, Stripe is the actual billing truth, so this is cosmetic, not a security or billing-correctness issue.

5. **`TP3D_BUILD_STAMP`** (L2016–2019): a frozen object with a hardcoded `gitCommitShort: '52aa4de'` and `buildTimeISO: '2026-02-18T03:32:00Z'`, logged once at boot when `tp3dDebug=1`. Already visibly stale relative to this audit's date and the branch's actual recent commits.
   - **Confidence:** HIGH that it's stale as a value; not "dead code" in the traditional sense.
   - **Recommendation:** Not a removal candidate; flag as a maintenance item if build-stamp accuracy matters.

6. **The `window.TruckPackerApp` bridge assignments for `notifyOrgAccessLoss`, `handleWorkspaceLeft`, and `handleOwnershipTransferred` are silently ineffective.**
   - **Evidence:** L6633–6645 runs `window.TruckPackerApp = window.TruckPackerApp || {}` and assigns eight properties onto whatever object that resolves to. At the point this line executes, the outer `window.TruckPackerApp = (function(){...})()` (L2181) has not yet completed — its right-hand IIFE is still running — so `window.TruckPackerApp` is still its pre-statement value (undefined at first boot), meaning `|| {}` creates a **new, temporary object** and the assignments land on that temporary object. When the IIFE eventually finishes and returns its own object (L9906–9921: `{init, maybeScheduleBillingRefresh, getWorkspaceSwitchState, handleWorkspaceArchived, handleWorkspaceRestored, handleWorkspaceUpdated, openCreateWorkspaceFlow, EditorUI, ui, _debug}`), that return value becomes the final value assigned to `window.TruckPackerApp`, discarding the temporary object entirely. Five of the eight properties assigned at L6633–6645 (`maybeScheduleBillingRefresh`, `getWorkspaceSwitchState`, `handleWorkspaceArchived`, `handleWorkspaceRestored`, `handleWorkspaceUpdated`) also appear in the final return object, so they survive — redundantly, via two different mechanisms. The other three (`notifyOrgAccessLoss`, `handleWorkspaceLeft`, `handleOwnershipTransferred`) do **not** appear in the final return object, so `window.TruckPackerApp.notifyOrgAccessLoss`, `.handleWorkspaceLeft`, and `.handleOwnershipTransferred` are all `undefined` once boot completes, even though the source code appears to assign them.
   - **Confidence:** HIGH — confirmed by direct comparison of the two exact code blocks (L6633–6645 vs. L9906–9921) and standard JavaScript assignment-evaluation-order semantics (the right-hand side of `a = f()` fully evaluates, including any writes `f` makes to `a` itself, before the final assignment to `a` occurs).
   - **Classification:** Not traditional dead code (the assignment statements execute every boot) — this is closer to a **silent-no-op defect**: code that runs but has no lasting effect because its target is discarded. `tests/audit/security-and-invariants.spec.mjs` (around line 14419) asserts that the *source text* `window.TruckPackerApp.handleWorkspaceLeft = handleWorkspaceLeft` exists — a test that would pass today even though the runtime property does not survive. If Settings' "Leave Workspace" UI (or any other caller) actually invokes `window.TruckPackerApp.handleWorkspaceLeft` at runtime, it would find it undefined.
   - **Recommendation:** Not a Phase 0 fix, but worth flagging as a real, verifiable defect for a dedicated follow-up — distinct from and more consequential than the other items in this list.

No other unreachable branches or unused imports were found in `app.js` itself during this read. `Router` (imported at L54) is used (`Router.init` at L9872, `Router.replaceScreen` at L8782) — confirmed **not** dead. `installDevHelpers` (imported at L84) is used at L8040.

## 9. Recommended modularization roadmap

**Phase 1 — Extract isolated, zero-coupling content (§6.1, §6.2)**
- **Goal:** Prove the extraction workflow (new file, import, factory/namespace call, no behavior change) on the lowest-possible-risk pieces before touching anything with state.
- **Files affected:** `src/app.js` (removals + new imports), new `src/data/release-notes.js`, `src/data/roadmap.js` (or combined), new `src/core/dev/wrapper-detective.js`.
- **Risk:** LOW.
- **Validation required:** `npm test`, `npm run lint`, `npm run -s typecheck`, manual: Release Notes screen renders, Roadmap screen renders and its item-click modal opens, `tp3dDebug=1` still installs `__TP3D_WRAPPER_DETECTIVE__` and both its methods still work from the dev console.

**Phase 2 — Extract presentational screens (§6.5, §6.6)**
- **Goal:** Move `UpdatesUI`, `RoadmapUI`, and the renamed preferences panel (formerly `SettingsUI`) into `src/screens/`, matching the existing `packs-screen.js`/`cases-screen.js` module shape.
- **Files affected:** `src/app.js`, new `src/screens/updates-screen.js`, `src/screens/roadmap-screen.js`, `src/screens/preferences-panel.js`.
- **Risk:** LOW–MEDIUM (DOM-reference-at-construction-time timing must be preserved; the `SettingsUI`→`PreferencesPanel` rename must be threaded through every call site including `renderAll()` and the `StateStore.subscribe` theme branch).
- **Validation required:** `npm test`, lint, typecheck; manual: Release Notes/Roadmap screens unchanged, Settings→Preferences tab loads/saves correctly, theme toggle still applies from both the top preferences panel and the Settings overlay.

**Phase 3 — Extract the export/capture pipeline (§6.4)**
- **Goal:** Move `ExportService` into `src/services/export-service.js` as a `createExportService({...})` factory, with the billing/Pro-gate check and `capturePackPreview`'s operation-lifecycle gating explicitly injected rather than closed over.
- **Files affected:** `src/app.js`, new `src/services/export-service.js`. `AutoPackEngine`'s injected `capturePackPreview` callback must be re-pointed at the new module's instance, constructed *before* `AutoPackEngine` this time.
- **Risk:** MEDIUM.
- **Validation required:** `npm test`, lint, typecheck; manual: Screenshot export, PDF export (including the Cargo Instructions manifest section), pack-preview auto-capture on leaving the editor, and the `OperationLifecycle`-busy "Finish the current operation before capturing a preview" toast all still work exactly as before.

**Phase 4 — Reduce keyboard-shortcut and modal-management surface**
- **Goal:** Move `KeyboardManager` and the standalone modal builders (workspace creation, app/workspace export, pack-open dialog) into dedicated modules, keeping the `OperationLifecycle`-gating logic (`mutationBlockedWhileBusy`) intact and unit-testable in isolation for the first time.
- **Files affected:** `src/app.js`, new `src/ui/keyboard-manager.js`, new modal modules under `src/ui/`.
- **Risk:** MEDIUM–HIGH (keyboard shortcuts are exactly the surface CLAUDE.md's operation-lifecycle safety rules are most worried about).
- **Validation required:** Full CLAUDE.md §14 operation-lifecycle manual checklist, plus `npm test`, lint, typecheck.

**Phase 5 — Auth/org/billing/workspace-switch core (§6.7) — separate initiative, not part of this roadmap's near-term execution**
- **Goal:** If and when product/engineering explicitly approves it, consolidate the three tightly-coupled subsystems into one new `createIdentityRuntime(...)`-style module, eliminating the module-scope accessor-indirection pattern, and fixing the confirmed `window.TruckPackerApp` bridge defect (§8, item 6) as part of the same change.
- **Files affected:** `src/app.js` (large removal), new `src/core/identity-runtime.js` (or similar), plus `src/ui/overlays/settings-overlay.js` if its call sites need updating.
- **Risk:** VERY HIGH.
- **Validation required:** Everything in CLAUDE.md's billing/workspace manual-check list, **plus** new automated tests that did not exist before this phase — the current suite validates this area almost entirely via source-text pattern matching, which would not have caught the confirmed `window.TruckPackerApp` defect.

`app.js`'s remaining shape after Phases 1–4 would still include the entire auth/org/billing/workspace-switch core, screen-routing coordination, feature/overlay construction wiring, and `init()` itself — i.e. it would shrink meaningfully but would **not** become a thin orchestrator without Phase 5.

## 10. Validation checklist

Before any future app.js extraction (any phase above), at minimum:

- `npm test` (runs `tests/audit/*.spec.mjs` — **note:** confirmed by this audit that a large fraction of the `app.js`-relevant assertions in `tests/audit/security-and-invariants.spec.mjs` check the **literal source text** of `app.js` via regex/string matching, not runtime DOM behavior. Any extraction that moves a matched pattern to a different file, changes its exact wording, or changes surrounding context that a regex anchors to **will fail these tests even if behavior is 100% preserved** — and, per §8 item 6, the reverse also holds: a source-text test can pass while the runtime behavior it's meant to guarantee is already broken. Every extraction phase must grep the target function/pattern names against this spec file first and update the assertions in the same commit, and must not treat a passing `npm test` alone as proof of preserved behavior.)
- `npm run lint`
- `npm run -s typecheck`
- `git diff --check` / `git diff --cached --check`
- Browser login test (sign-in, sign-out, session persistence across reload)
- Create/open pack; create/edit case
- AutoPack; Truck Change (per CLAUDE.md §14's operation-lifecycle checklist if the touched phase is anywhere near KeyboardManager/OperationLifecycle/screens)
- Import/export (app backup, workspace backup, PDF, screenshot)
- Undo/redo
- Settings: Preferences tab, Billing tab, Members tab (if org-scoped code was touched) — specifically including the "Leave Workspace" action, given the confirmed `handleWorkspaceLeft` bridge defect (§8, item 6)
- Workspace behavior: owner with 1 workspace, owner with multiple workspaces, non-owner member, same-tab workspace switch, cross-tab workspace switch (mandatory whenever Phase 5 is ever attempted; recommended even for earlier phases if they touch anything under §2's VERY HIGH rows)
- Additional items surfaced by this audit specifically:
  - Confirm `window.__TP3D_WRAPPER_DETECTIVE__`, `window.__TP3D_BILLING`, `window.OrgContext`, `window.TruckPackerApp.*` all still expose the exact same property names after extraction — and explicitly check whether `notifyOrgAccessLoss`/`handleWorkspaceLeft`/`handleOwnershipTransferred` are present on the *final* object, not just whether the assignment line exists in source.
  - Confirm the `UIComponents.showToast` ASCII-sanitizing monkey-patch still applies globally after any extraction that touches `UIComponents` construction order.
  - Confirm the three module-scope accessor variables are still assigned before anything reads them (no error is thrown if this silently regresses — it must be checked manually or via a new test, not assumed from "no crash").
  - Confirm cross-tab behavior specifically (open two tabs, sign in on one, switch workspace on one, sign out on one) if Phase 5, or any earlier phase that happens to touch billing/org cross-tab code, is ever attempted.

## 11. Explicit statement

**No production code was changed during this phase.** This document is the only artifact produced by this session's work. `src/app.js` and every other file in the repository were read but not modified. `styles/main.css`, which showed as modified in `git status` at the start of this session, was **not** touched by this audit — that pre-existing modification is unrelated and was left as-is.

**Note on branch:** `docs/product/TP3D-MASTER-TODO-V5.md` §4 records this task's "Branch" field as "Not yet created." This audit was performed and its output written on the current branch, `feat/inspector-case-notes` (which already holds unrelated, unpushed Cargo Instructions Phase 1/2 commits per the same document). No new branch was created; branching, committing, and pushing are left to explicit direction.

**Note on this file specifically:** per explicit instruction, this file was saved as a distinctly-named, attributed copy rather than overwriting `docs/engineering/app-js-modularization-inventory.md`, which was found to already contain a more thorough, independently-completed version of sections 6–11 (produced concurrently, apparently by another session of this same model). No existing file was deleted or overwritten in the process of saving this one.
