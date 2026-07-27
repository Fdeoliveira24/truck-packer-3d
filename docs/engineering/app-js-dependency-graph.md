# App.js Dependency Graph

**Status:** PREP-5 controlling reference

**Scope:** Every significant dependency `src/app.js` relies on — internal modules, external/vendor libraries, browser APIs, browser globals, and runtime singletons

**Behavioral baseline:** PREP-1 behavioral characterization, PREP-2 public facade and compatibility contract, PREP-3 runtime invariants, PREP-4 ownership ledger (`docs/engineering/app-js-ownership-ledger.md`), DEF-009, DEF-010, DEF-011, TRIAGE-3A through TRIAGE-3D

**Change policy:** `docs/engineering/app-js-preparation-change-policy.md`

## Purpose and how to read this document

This is a documentation-only dependency inventory. Where PREP-4 (the ownership ledger) organized `src/app.js` by *responsibility* ("who owns X"), this document organizes it by *dependency edge* ("what does X rely on, and in which direction"). The two documents describe the same code from two angles and are meant to be read together; this one does not repeat PREP-4's per-responsibility teardown/coupling detail except where a dependency's direction or lifetime needs it.

Per-dependency fields, where applicable:

- **Dependency name**
- **Type** — Internal module / External library / Browser API / Global / Runtime singleton
- **Imported from**
- **Used by** (which App.js areas, referencing PREP-4 section numbers where useful)
- **Initialized by**
- **Lifetime** — module-load-once, per-`init()`-attempt, per-call, page-lifetime
- **Direction of dependency** — App.js depends on it / it depends on App.js / mutual
- **Required or optional**
- **Public API used**
- **Events exchanged**
- **Shared state**
- **Storage interaction**
- **Cross-tab interaction**
- **Circular dependency risk**
- **Coupling level** — Low / Medium / High
- **Notes**

Homogeneous, low-significance dependencies that share an identical profile (for example, several single-purpose modal-dialog factories) are grouped into one entry rather than repeated five times with identical answers; each grouped member is still named explicitly.

---

## 1. Internal module dependencies

### 1.1 Boot, error, and system UI

**`./debugger.js` → `initTP3DDebugger`**

- Type: Internal module.
- Used by: Diagnostics (PREP-4 §21).
- Initialized by: Called once at module top level (`src/app.js:100`), before the outer boot IIFE.
- Lifetime: Module-load-once; installs `window.__TP3D_DIAG__` for the page's lifetime.
- Direction: App.js depends on it; it does not call back into App.js at import time.
- Required or optional: Optional to app function (diagnostic only), but unconditionally invoked.
- Public API used: `initTP3DDebugger()` only.
- Events exchanged: None at the App.js boundary; internal diagnostic event recording is owned entirely inside `debugger.js`.
- Shared state: None owned by App.js.
- Storage interaction: `tp3dDebug`, `tp3dDiagPersist`-family keys, read/written by `debugger.js` itself.
- Cross-tab interaction: None known.
- Circular dependency risk: None — `debugger.js` does not import `app.js`.
- Coupling level: Low.
- Notes: Called before the boot IIFE even begins awaiting `threeReady`, so it exists independent of whether boot later succeeds or fails.

**`./ui/system-overlay.js` → `createSystemOverlay`**

- Type: Internal module.
- Used by: Initialization/boot (PREP-4 §1), specifically `validateRuntime()`'s WebGL/vendor-library degraded path.
- Initialized by: `SystemOverlay = createSystemOverlay()`, synchronously during the outer boot IIFE, before `init()` is defined.
- Lifetime: Page-lifetime singleton instance.
- Direction: App.js depends on it.
- Required or optional: Required for the WebGL/vendor-missing degraded path to render anything.
- Public API used: `.show({...})`.
- Events exchanged: None.
- Shared state: None.
- Storage interaction: None directly.
- Cross-tab interaction: None.
- Circular dependency risk: None.
- Coupling level: Low.
- Notes: Distinct from `ErrorOverlay` — this handles vendor/platform support failures specifically, per its own file header comment.

**`./ui/error-overlay.js` → `createErrorOverlay`**

- Type: Internal module.
- Used by: Error handling (PREP-4 §17), Fatal overlay coordination (PREP-4 §18).
- Initialized by: `ErrorOverlay = createErrorOverlay()`, synchronously during the outer boot IIFE.
- Lifetime: Page-lifetime singleton instance.
- Direction: App.js depends on it. Mutual in effect: `index.html`'s own preboot script independently renders into the same DOM nodes (`#error-overlay` etc.) through its own `showAppStatusOverlay()` implementation, so both `app.js` and `index.html` are "producers" of the same visual surface, coordinated only by the shared `BootState.fatalOverlayShown` flag.
- Required or optional: Required — this is the only fatal-recovery UI in the app.
- Public API used: `showNotFound`, `showFatal`, `showMaintenance`, `hide`, `isVisible`, `setOnBackToPacks`.
- Events exchanged: None (DOM click on its own "Reload"/"Back to Packs" buttons).
- Shared state: `BootState.fatalOverlayShown` is read by `showFatal()` implicitly through App.js's own `showFatalOverlay()` wrapper, not by `error-overlay.js` itself.
- Storage interaction: None.
- Cross-tab interaction: None.
- Circular dependency risk: None.
- Coupling level: Medium — its correctness depends on `BootState` timing owned by App.js/`index.html` together (PREP-4 §18).
- Notes: Binds to static DOM roots in `index.html`; safe to call before or after app boot, per its own file header.

### 1.2 Routing and shell

**`./router.js` → `Router`**

- Type: Internal module (exported as a plain object, not a factory).
- Used by: Navigation (PREP-4 §11).
- Initialized by: `Router.init({ onScreen, onNotFound, onNeutral })` inside `init()` (`src/app.js:10151-10167`).
- Lifetime: Module-level singleton for the page's lifetime (ES modules are cached); `Router.init()` (re)installs its `hashchange` listener.
- Direction: App.js depends on it; `Router` calls back into App.js via the callbacks passed to `.init()`.
- Required or optional: Required for screen navigation.
- Public API used: `.init()`, `.replaceScreen()` (used by `ErrorOverlay`'s "Back to Packs" handler, PREP-4 §17).
- Events exchanged: `hashchange` (native, owned by `Router`).
- Shared state: None owned by App.js; `Router` tracks its own current-route state internally.
- Storage interaction: None known.
- Cross-tab interaction: None.
- Circular dependency risk: None — `Router` does not import `app.js`.
- Coupling level: Low-Medium.
- Notes: `Router.init()` is called unconditionally on every `init()` attempt that reaches that point; whether calling it a second time (on a hypothetical retry) duplicates its `hashchange` listener is not established (PREP-4 §11, §12 unknowns).

### 1.3 UI primitives and overlays

**`./ui/ui-components.js` → `createUIComponents`**

- Type: Internal module.
- Used by: Nearly every UI-facing area (PREP-4 §12 and throughout).
- Initialized by: `UIComponents = createUIComponents()`, synchronously during the outer boot IIFE, before `SystemOverlay`/`ErrorOverlay`.
- Lifetime: Page-lifetime singleton.
- Direction: App.js depends on it.
- Required or optional: Required — this is the sole source of toast/modal/confirm primitives.
- Public API used: `showToast`, `showModal`, `confirm`; a subset (`showToast`, `showModal`, `confirm`) is re-exposed publicly as `TruckPackerApp.ui` (PREP-2 facade contract §5.2).
- Events exchanged: None.
- Shared state: None owned by App.js beyond holding the instance.
- Storage interaction: None known.
- Cross-tab interaction: None.
- Circular dependency risk: None.
- Coupling level: High by breadth (used everywhere) but Low by depth (each call site is a simple, stateless invocation).
- Notes: One of the earliest-constructed dependencies, before the auth/billing/organization machinery exists — many degraded-path branches in `init()` depend on it being available immediately.

**`./ui/overlays/settings-overlay.js` → `createSettingsOverlay`** — see PREP-4 §15.

- Type: Internal module. Direction: App.js depends on it; it calls back into App.js through the feature-detected facade members (`handleWorkspaceArchived`/`Restored`/`Updated`, `openCreateWorkspaceFlow`) and reads `window.__TP3D_BILLING`/`window.OrgContext` directly (Globals, §4 below).
- Required: Yes. Public API used: `.handleAuthChange()`, `.open()`, `.close()`, plus its own internal rendering (opaque to App.js).
- Events exchanged: Produces `tp3d:profile-updated` (no confirmed App.js consumer, per PREP-2 §10.1).
- Storage: `tp3d:settings:activeTab`, owned by Settings itself.
- Cross-tab: Consumes organization/billing cross-tab state indirectly through `OrgContext`/`window.__TP3D_BILLING`, not directly.
- Circular dependency risk: **Present in effect, not in the module graph.** `settings-overlay.js` does not `import` `app.js` (no static circular import), but it reads `window.OrgContext` and `window.__TP3D_BILLING` — globals that only exist once App.js has run far enough to create them — and calls back into App.js through the facade members above. This is a runtime circular *coupling* mediated entirely through browser globals rather than a build-time circular import.
- Coupling level: High.
- Notes: The two unresolved facade members (`handleWorkspaceLeft`, `handleOwnershipTransferred`, PREP-2 §5.4) are specifically at this boundary.

**`./ui/overlays/account-overlay.js` → `createAccountOverlay`**

- Type: Internal module. Used by: Auth (PREP-4 §3), Account switching (PREP-4 §16) — `AccountOverlay.handleAuthChange()` is called alongside `SettingsOverlay.handleAuthChange()`.
- Initialized by: Synchronous IIFE construction. Lifetime: Page-lifetime singleton. Direction: App.js depends on it. Required: Yes, for the account overlay UI.
- Public API used: `.handleAuthChange()` (the only call site confirmed in this graph).
- Events exchanged: None confirmed. Storage: Not established beyond what Settings/Auth already own. Cross-tab: None directly.
- Circular dependency risk: None confirmed (no evidence of it reading App.js globals the way `settings-overlay.js` does).
- Coupling level: Low-Medium.
- Notes: Narrower confirmed surface than `SettingsOverlay`; this graph does not assert it has no further coupling, only that none beyond `.handleAuthChange()` was found in the App.js call sites examined.

**`./ui/overlays/auth-overlay.js` → `createAuthOverlay`**

- Type: Internal module. Used by: Auth (PREP-4 §3), Initialization/boot (PREP-4 §1) degraded-path rendering.
- Initialized by: Synchronous IIFE construction, before `init()`. Lifetime: Page-lifetime singleton. Direction: App.js depends on it; `AuthOverlay` calls back into App.js via `onRetry` callbacks passed into `.setPhase()`.
- Required or optional: Required — this is the sole sign-in/checking/cantconnect/account-disabled UI.
- Public API used: `.setPhase()`, `.show()`, `.hide()`, `.showAccountDisabled()`, `.showResetPassword()`.
- Events exchanged: None directly; DOM interaction inside the overlay triggers the `onRetry` callback closures App.js supplies.
- Shared state: `_authGate` settlement bookkeeping is owned by App.js (PREP-4 §3), read/mutated around calls into `AuthOverlay`, not owned by the overlay itself.
- Storage interaction: None directly.
- Cross-tab interaction: None directly.
- Circular dependency risk: None — callbacks are passed as plain function arguments, not a static import cycle.
- Coupling level: High — nearly every branch in `init()`'s degraded/expected paths (PREP-3 §2.3) drives this overlay.
- Notes: The `onRetry` callback pattern is the general mechanism by which several dependencies in this document "call back" into App.js without a static circular import.

**Minor modal-dialog factories** (grouped — identical profile): `./ui/overlays/card-display-overlay.js` (`createCardDisplayOverlay`), `./ui/overlays/help-modal.js` (`createHelpModal`), `./ui/overlays/import-app-dialog.js` (`createImportAppDialog`), `./ui/overlays/import-pack-dialog.js` (`createImportPackDialog`), `./ui/overlays/import-cases-dialog.js` (`createImportCasesDialog`).

- Type: Internal module (×5). Used by: UI orchestration (PREP-4 §12) — opened on demand from button handlers (`wireGlobalButtons()`, `openHelpModal()`, `openImportAppDialog()`).
- Initialized by: Synchronous IIFE construction; each exposes an `.open()`-style entry point called later, on user action.
- Lifetime: Page-lifetime singleton instance per dialog; no per-open/close lifecycle tracked by App.js.
- Direction: App.js depends on each; none is known to call back into App.js beyond returning control after close.
- Required or optional: Each optional to core app function (import/export/help convenience), required for its own specific feature.
- Public API used: `.open()` (and closely related methods specific to each; not individually enumerated here as none is a load-bearing dependency for another area).
- Events exchanged: None confirmed.
- Shared state: None confirmed.
- Storage interaction: `ImportExport`/`Storage` (a separate dependency, §1.5 below) is what these dialogs actually read/write through, not the dialog shells themselves.
- Cross-tab interaction: None.
- Circular dependency risk: None.
- Coupling level: Low, individually and in aggregate.
- Notes: Grouped here because each is a small, self-contained "open a modal, do one job, close" dependency with no further fan-out into other PREP-4 areas.

**`./ui/table-footer.js` → `createTableFooter`**

- Type: Internal module. Used by: UI orchestration (PREP-4 §12), a small formatting/summary helper.
- Initialized by: Synchronous construction. Lifetime: Page-lifetime singleton. Direction: App.js depends on it. Required or optional: Optional (presentation helper).
- Public API used: Not individually traced beyond instantiation; no further App.js area depends on its output.
- Events/Shared state/Storage/Cross-tab: None confirmed.
- Circular dependency risk: None. Coupling level: Low.
- Notes: Smallest-footprint dependency in this graph.

**`./ui/truck-change-controller.js` → `createTruckChangeController`**

- Type: Internal module. Used by: UI orchestration / Editor startup (PREP-4 §12, §14) — the Truck Change preview/reconciliation flow described in `CLAUDE.md` §7 ("Pending truck vs committed truck").
- Initialized by: Synchronous construction during the outer boot IIFE.
- Lifetime: Page-lifetime singleton. Direction: App.js depends on it; it depends on `OperationLifecycle` (§1.4) and editor state to reconcile a truck change.
- Required or optional: Required for the Truck Change feature specifically.
- Public API used: Not individually enumerated in this graph; treated as an editor-adjacent controller instance passed to `EditorUI`'s construction, per PREP-4 §14.
- Events/Storage/Cross-tab: None confirmed at the App.js boundary.
- Circular dependency risk: None confirmed.
- Coupling level: Medium — depends on `OperationLifecycle` and interacts with committed-vs-pending truck state that `EditorUI`/`AppShell` also touch.
- Notes: Governed additionally by the AutoPack/Truck-Change operation-lifecycle rules in `CLAUDE.md` §6-7, which this graph does not restate.

### 1.4 Operation lifecycle

**`./core/operation-lifecycle.js` → `createOperationLifecycle`**

- Type: Internal module. Used by: Keyboard (PREP-4 §10, `mutationBlockedWhileBusy()`), Editor startup / Truck Change (PREP-4 §14), and, per `CLAUDE.md` §6, AutoPack/Unpack/preview-capture guarding generally.
- Initialized by: `OperationLifecycle = createOperationLifecycle()` (`src/app.js:3680`), synchronously during the outer boot IIFE.
- Lifetime: Page-lifetime singleton.
- Direction: App.js depends on it (queries `.isBusy()`); it does not call back into App.js.
- Required or optional: Required — this is the single authoritative mutation-lock referenced by `CLAUDE.md` §6.
- Public API used: `.isBusy()` (confirmed at `KeyboardManager`'s `mutationBlockedWhileBusy()`); other members (`OPERATION_KINDS`, `MUTATING_KINDS`) exist per the graphify-catalogued node structure but were not individually traced to an App.js call site in this pass.
- Events exchanged: None confirmed.
- Shared state: The lock/busy state itself, owned entirely by `operation-lifecycle.js`; App.js only reads it.
- Storage interaction: None known.
- Cross-tab interaction: None — this is an in-page, in-tab lock.
- Circular dependency risk: None.
- Coupling level: Medium — narrow API surface, but its correctness is load-bearing for the P0 safety rules in `CLAUDE.md` §6.
- Notes: `src/core/operation-lifecycle.js` is called out in `CLAUDE.md` as intentionally kept small and pure; this graph does not propose changing that.

### 1.5 Data, state, and storage core

**`./core/state-store.js` → `CoreStateStore` (used as `StateStore`)**

- Type: Internal module (namespace import). Used by: Runtime state (PREP-4 §2) and effectively every screen/UI area.
- Initialized by: Module import; App.js does not call a separate `.init()` on it beyond using its exported functions directly.
- Lifetime: Module-singleton for the page's lifetime (ES module caching).
- Direction: App.js depends on it; it does not import `app.js`.
- Required or optional: Required — this is the application's central reactive state store.
- Public API used: `.get()`, `.set()`, `.undo()`, `.redo()`, subscription registration (exact subscribe method name not individually re-verified in this pass beyond what PREP-4 §2 already documents).
- Events exchanged: Its own internal subscription mechanism, not a browser/custom event.
- Shared state: `currentScreen`, `currentPackId`, `selectedInstanceIds`, undo/redo history — all owned by this module, consumed by nearly every screen (§4, State dependency graph, below).
- Storage interaction: Not directly; persistence is via `Storage` (`core/storage.js`) reading `StateStore`-derived data.
- Cross-tab interaction: None directly by `StateStore` itself.
- Circular dependency risk: None.
- Coupling level: High by breadth — see §4 below for the full consumer list.
- Notes: Also exposed diagnostically as `_debug.StateStore` (PREP-2 §5.2).

**`./core/storage.js` → `CoreStorage` (used as `Storage`)**

- Type: Internal module (namespace import). Used by: Storage (PREP-4 §7), Auth (§3), Organization/Workspace (§4).
- Initialized by: Module import; scope is established/switched by App.js calls (`setStorageScope`, `setWorkspaceStorageScope`) during `init()` and lifecycle transitions.
- Lifetime: Module-singleton for the page's lifetime; its *scope* changes per identity/workspace transition.
- Direction: App.js depends on it.
- Required or optional: Required.
- Public API used: `.setStorageScope()`, `.saveNow()`, `.clearAll()`, plus autosave-related internals (`flushPendingStorageSave`-style calls, owned partly by App.js's own wrapper functions per PREP-4 §7).
- Events exchanged: Emits `storage:load_error`, `storage:read_error`, `storage:write_error`, `storage:remove_error`, `storage:saved`, `storage:save_error`, `storage:import_error` on the internal event bus (§1.8 below), consumed where relevant by App.js.
- Shared state: `hasLoadedScopedState`, `lastLoadedWorkspaceStorageKey`, `suspendAutoSave` — owned by App.js's usage of `Storage`, not by `Storage` itself.
- Storage interaction: This *is* the storage interaction layer; see PREP-2 §12 and PREP-4 §7 for the full key catalogue.
- Cross-tab interaction: `storage` native events are the transport several other dependencies (§3-5) build cross-tab sync on top of; `Storage` itself does not interpret them.
- Circular dependency risk: None.
- Coupling level: High — entangled with the sign-out/sign-in/workspace-switch cleanup sequence (PREP-4 §3-4, §7).
- Notes: Explicitly called out in `CLAUDE.md` as a P0-risk file.

**`./core/session.js` → `CoreSession`**

- Type: Internal module (namespace import). Used by: Not individually traced to a specific PREP-4 area beyond general session-singleton support; imported alongside `Storage`/`StateStore`.
- Lifetime: Module-singleton. Direction: App.js depends on it. Required or optional: Not established from this pass whether App.js has a hard runtime dependency on it beyond import — flagged as an **unknown** (see §9).
- Storage interaction: `truckPacker3d:session:v1` (per PREP-2 §12.1), owned by this module.
- Circular dependency risk: None confirmed. Coupling level: Low (as far as directly confirmed).
- Notes: See §9, Unknowns.

**`./core/utils/index.js` → `CoreUtils` (used as `Utils`)**

- Type: Internal module (namespace import). Used by: Nearly every area — formatting, cloning, escaping, WebGL detection (`validateRuntime()`, PREP-4 §1), math/clamp helpers used throughout Keyboard (§10) and elsewhere.
- Lifetime: Module-singleton. Direction: App.js depends on it. Required or optional: Required.
- Public API used: `hasWebGL()`, `deepClone()`, `escapeHtml()`, `clamp()`, `formatRelativeTime()`, `downloadText()`, and others not individually enumerated.
- Events/Storage/Cross-tab: None — this is a pure-function utility namespace.
- Circular dependency risk: None. Coupling level: High by breadth, Low by depth (stateless functions).
- Notes: Also exposed diagnostically as `_debug.Utils`.

**`./core/browser.js` → `BrowserUtils`**

- Type: Internal module (namespace import). Used by: Not individually traced to a confirmed call site beyond import in this pass — flagged as an **unknown** for its specific consumer(s) within App.js (see §9).
- Lifetime: Module-singleton. Direction: App.js depends on it.
- Coupling level: Low (unconfirmed breadth). Notes: Likely browser-capability/feature-detection helpers, consistent with its name and with `validateRuntime()`'s neighboring checks, but not individually verified line-by-line in this pass.

**`./core/defaults.js` → `CoreDefaults` (used as `Defaults`)**

- Type: Internal module (namespace import). Used by: Seed/default-data paths (`seedIfEmpty()`, called during `init()`, PREP-4 §1) and exposed diagnostically as `_debug.Defaults`.
- Lifetime: Module-singleton. Direction: App.js depends on it. Required or optional: Required for first-run/demo seeding.
- Storage interaction: Indirectly, via whatever `seedIfEmpty()` writes through `Storage`/`PackLibrary`/`CaseLibrary`.
- Circular dependency risk: None. Coupling level: Low-Medium.

**`./services/category-service.js` → `CategoryService`**

- Type: Internal module (namespace import). Used by: Not individually traced to a specific confirmed App.js call site in this pass beyond import — flagged as an **unknown** (see §9), consistent with case/pack-library category tagging being the likely consumer.
- Lifetime: Module-singleton. Coupling level: Low (unconfirmed breadth).

**`./services/case-library.js` → `CoreCaseLibrary` (used as `CaseLibrary`)**

- Type: Internal module (namespace import). Used by: Keyboard (§10, copy/paste/duplicate), UI orchestration (§12, `CasesUI`), Editor startup (§14).
- Lifetime: Module-singleton. Direction: App.js depends on it. Required or optional: Required.
- Public API used: `.getCases()`, plus whatever `CasesUI`/`EditorUI` call directly (not exhaustively re-traced here; already covered from the ownership angle in PREP-4).
- Storage interaction: Persisted through `Storage`, scoped per-workspace.
- Circular dependency risk: None. Coupling level: Medium-High (data layer for two major screens).

**`./services/pack-library.js` → `CorePackLibrary` (used as `PackLibrary`)**

- Type: Internal module (namespace import). Used by: Keyboard (§10), Navigation/route-not-found detection (§11, `hasMissingEditorPack()`), Error handling (§17), Editor startup (§14), UI orchestration (§12, `PacksUI`).
- Lifetime: Module-singleton. Direction: App.js depends on it. Required or optional: Required.
- Public API used: `.getById()`, `.getPacks()`, `.open()`, `.duplicateInstancesSafely()`.
- Storage interaction: Persisted through `Storage`, scoped per-workspace.
- Circular dependency risk: None. Coupling level: High — one of the most cross-referenced dependencies in the file (Keyboard, Navigation, Error handling, UI orchestration all read from it directly).

**`./services/import-export.js` → `ImportExport`**

- Type: Internal module (namespace import). Used by: UI orchestration (§12, App/Workspace export-backup modals).
- Lifetime: Module-singleton. Direction: App.js depends on it. Required or optional: Required for the export/backup feature specifically.
- Public API used: `.buildAppExportJSON()`, `.buildWorkspaceExportJSON()`.
- Storage interaction: Reads whatever `Storage`/`PackLibrary`/`CaseLibrary`/`PreferencesManager` state it serializes; does not write storage itself (produces a downloadable JSON string).
- Circular dependency risk: None. Coupling level: Medium.

**`./services/preferences-manager.js` → `CorePreferencesManager` (used as `PreferencesManager`)**

- Type: Internal module (namespace import). Used by: Settings (§15), Initialization/boot (§1, theme applied early in `init()`).
- Lifetime: Module-singleton. Direction: App.js depends on it. Required or optional: Required.
- Public API used: `.get()`, `.set()`, `.applyTheme()`.
- Storage interaction: Owns preference persistence (exact key not individually re-verified here; covered by the general `truckPacker3d:v1` family in PREP-2 §12.1).
- Circular dependency risk: None. Coupling level: Medium.

**`./data/trailer-presets.js` → `TrailerPresets`**

- Type: Internal module (static data export, not a factory). Used by: Truck/trailer configuration paths (not individually re-traced to every call site in this pass).
- Lifetime: Static, module-load-once. Direction: App.js depends on it. Required or optional: Required for truck preset selection.
- Circular dependency risk: None. Coupling level: Low (data, not behavior).

**`./data/services/billing.service.js` → `fetchBillingStatus`, `createCheckoutSession`, `createPortalSession`, `acceptOrgInvite`**

- Type: Internal module. Used by: Billing state refresh (§5), Checkout/Portal (§6), the invite-token acceptance flow inside `init()`.
- Lifetime: Module-singleton functions, called per-request (not held as long-lived instances).
- Direction: App.js depends on it; this module itself calls the Supabase Edge Functions (network boundary, outside this graph's scope) and returns a plain result to App.js.
- Required or optional: Required.
- Public API used: All four named exports.
- Events exchanged: None directly; results are consumed synchronously by the caller.
- Shared state: None owned by this module; App.js owns all the epoch/generation guards around its results (§5-6, and PREP-3 §5-6).
- Storage interaction: None directly by this module (App.js's own billing-state code, §5, is what persists results to storage).
- Cross-tab interaction: None directly by this module.
- Circular dependency risk: None.
- Coupling level: High — this is the compatibility adapter also referenced by the PREP-2 facade contract (§7.2, "`src/data/services/billing.service.js:337`").
- Notes: Also referenced directly by `src/services/autopack-engine.js` for entitlement checks (PREP-2 §7.2), making it a shared dependency between App.js and AutoPack, not exclusive to either.

### 1.6 Auth

**`./core/supabase-client.js` → `SupabaseClient`**

- Type: Internal module (namespace import). Used by: Auth (§3 above/PREP-4 §3), Billing (§5, `getAuthState`/`getAuthEpoch`), Checkout/Portal (§6, `captureBillingActionContext`), Organization (§4, `getSignedInUserIdStrict`).
- Initialized by: `SupabaseClient.init({ url, anonKey })`, awaited inside `init()` (`src/app.js:8358`).
- Lifetime: Module-singleton; its *auth state* is mutable and epoch-versioned for the page's lifetime.
- Direction: App.js depends on it; it calls back into App.js indirectly by dispatching `tp3d:auth-signed-out`/`tp3d:auth-error` (native `CustomEvent`s on `window`/`document`, consumed by App.js) and via the `onAuthStateChange` callback App.js registers.
- Required or optional: Required — Auth is not optional in this app.
- Public API used: `.init()`, `.onAuthStateChange()`, `.getUserSingleFlight()`, `.getUser()`, `.getAuthState()`, `.getAuthEpoch()`, `.refreshSession()`, `.awaitAuthReady()`, `.signOut()`, `.getMyProfileStatus()`, `.resetAccountBundleCache()`, `.getSession()`, `.getSessionSingleFlight()`, `.getAccountBundleSingleFlight()`, `.getProfile()`, and others per the PREP-2 facade contract §8.1.
- Events exchanged: Emits `tp3d:auth-signed-out`, `tp3d:auth-error` (consumed by App.js); the internal `onAuthStateChange` callback is a direct function-call channel, not a `CustomEvent`.
- Shared state: `window.supabase`, `window.__TP3D_SUPABASE`, `window.__TP3D_SUPABASE_API`, `window.SupabaseClient` — all owned by `supabase-client.js`, not App.js (PREP-2 §8.1); App.js owns only its own auth-epoch-adjacent state (`lastAuthUserId`, `_authGate`, etc., PREP-4 §3).
- Storage interaction: `sb-{projectRef}-auth-token` (Supabase-owned); App.js's own storage scope reset is a *reaction* to this module's auth state, not a storage key this module itself defines.
- Cross-tab interaction: Owns the `tp3d-auth` BroadcastChannel and the `tp3d-logout-trigger` localStorage fallback (PREP-2 §11.2) — this is the one BroadcastChannel/cross-tab mechanism in the app that App.js does **not** own (contrast with `tp3d-billing`, §5/§8 below, which App.js does own).
- Circular dependency risk: None — a static import cycle was not found; the "calls back into App.js" relationship is entirely through the `onAuthStateChange` callback argument and dispatched `CustomEvent`s, not a module import.
- Coupling level: High.
- Notes: The DEF-009 stale-result guards (`captureAuthRequestContext`/`isAuthRequestContextCurrent`) live entirely inside this module; App.js is a consumer of their already-guarded return values, not a co-implementer.

### 1.7 Screens

**`./screens/editor-screen.js` → `createCaseScene`, `createInteractionManager`, `createEditorScreen`**

- Type: Internal module (3 named factory exports from one file). Used by: Editor startup (§14/PREP-4 §14), Keyboard (§10, `CaseScene`/`InteractionManager` calls), Navigation (§11, `AppShell.renderShell()` → `EditorUI.onActivated()`).
- Initialized by: All three factories are called synchronously during the outer boot IIFE (`CaseScene`, `InteractionManager`, and the `EditorUI` instance itself, exposed on the facade as `TruckPackerApp.EditorUI`).
- Lifetime: Page-lifetime singletons (constructed once, not per-`init()`-attempt or per-navigation).
- Direction: App.js depends on it directly; `AppShell` (App.js-owned) calls into `EditorUI.onActivated()`, making this the one screen module App.js reaches into on every screen transition rather than only at boot.
- Required or optional: Required.
- Public API used: `EditorUI`: `init`, `render`, `onActivated`, `onDeactivated` (PREP-2 §5.2, the full confirmed surface). `CaseScene`/`InteractionManager`: various methods called directly from `KeyboardManager` (`setSelected`, `getObject`, `selectAllInPack`, `deleteSelection`), per PREP-4 §10.
- Events exchanged: None confirmed as `CustomEvent`s at this boundary.
- Shared state: None owned by App.js; `EditorUI`'s facade exposure is the one place its internal object becomes externally mutable (the TRIAGE-3D-B failure-injection point, PREP-3 §2.3).
- Storage interaction: Not directly by App.js's wiring; internal to `editor-screen.js`.
- Cross-tab interaction: None directly.
- Circular dependency risk: None confirmed as a static import cycle.
- Coupling level: High — this is the dependency `KeyboardManager` reaches through to `CaseScene`/`SceneManager` rather than going through `EditorUI`'s own facade surface (PREP-4 §10, tight-coupling summary).
- Notes: `EditorUI` is explicitly flagged in the PREP-2 facade contract (§5.2) as a "live compatibility dependency" precisely because `AppShell` calls into it directly.

**`./screens/packs-screen.js` → `createPacksScreen`**

- Type: Internal module. Used by: UI orchestration (§12), Navigation (§11).
- Initialized by: Synchronous construction during the outer boot IIFE; `.init()` called inside the unguarded module-initializer block (`src/app.js:9050`).
- Lifetime: Page-lifetime singleton.
- Direction: App.js depends on it.
- Required or optional: Required.
- Public API used: `.init()`, `.render()`.
- Events/Storage/Cross-tab: None confirmed directly at this boundary; its data layer is `PackLibrary` (§1.5).
- Circular dependency risk: None. Coupling level: Medium.

**`./screens/cases-screen.js` → `createCasesScreen`**

- Type: Internal module. Used by: UI orchestration (§12), Navigation (§11).
- Initialized by: Synchronous construction during the outer boot IIFE; `.init()` called inside the unguarded module-initializer block (`src/app.js:9051`).
- Lifetime: Page-lifetime singleton.
- Direction: App.js depends on it.
- Required or optional: Required.
- Public API used: `.init()`, `.render()`.
- Events/Storage/Cross-tab: None confirmed directly at this boundary; its data layer is `CaseLibrary` (§1.5).
- Circular dependency risk: None. Coupling level: Medium.

**`./editor/scene-runtime.js` → `createSceneRuntime`**

- Type: Internal module. Used by: Scene startup (PREP-4 §13), Keyboard (§10, grid/shadow/focus/dev-overlay toggles).
- Initialized by: `SceneManager = createSceneRuntime({ Utils, UIComponents, PreferencesManager, TrailerGeometry, StateStore })` (`src/app.js:3656`), synchronously during the outer boot IIFE.
- Lifetime: Page-lifetime singleton.
- Direction: App.js depends on it.
- Required or optional: Required.
- Public API used: `.focusOnWorldPoint()`, `.toggleGrid()`, `.toggleShadows()`, `.toggleDevOverlay()` (all confirmed via `KeyboardManager`, PREP-4 §10).
- Events/Storage/Cross-tab: None confirmed directly.
- Circular dependency risk: None. Coupling level: Medium-High (reached into directly by `KeyboardManager`, bypassing `EditorUI`).
- Notes: Receives `TrailerGeometry` (§1.9 below) as one of its constructor dependencies — this is the one place a dependency *internal to App.js* is threaded into an *imported* factory.

**`./services/autopack-engine.js` → `createAutoPackEngine`**

- Type: Internal module. Used by: Keyboard (§10, `meta+p`/`ctrl+p` shortcut), Editor startup (§14, AutoPack/Unpack orchestration per `CLAUDE.md` §5-6).
- Initialized by: Synchronous construction during the outer boot IIFE.
- Lifetime: Page-lifetime singleton.
- Direction: App.js depends on it; it depends independently on `billing.service.js` (§1.5) for its own entitlement check and on `OperationLifecycle` (§1.4) for its mutation guard, per the PREP-2 facade contract §7.2 and `CLAUDE.md` §6.
- Required or optional: Required for the AutoPack feature.
- Public API used: `.pack()` (confirmed at the keyboard shortcut call site).
- Events/Storage: Not individually re-traced in this pass beyond what `CLAUDE.md`/PREP-2 already document.
- Cross-tab interaction: None known at this boundary.
- Circular dependency risk: None confirmed.
- Coupling level: High, though most of that coupling is internal to `autopack-engine.js`/`autopack-solver.js` rather than to App.js specifically.
- Notes: Governed by the AutoPack safety rules in `CLAUDE.md` §5-6, out of scope for this graph to restate.

### 1.8 Events and versioning

**`./core/events.js` → `on`, `emit`**

- Type: Internal module. Used by: Storage (§1.5, `storage:*` events), Session (`session:changed`, `session:error`), Auth (`auth:changed`), general `app:error`/`theme:apply` fan-out per PREP-2 §10.2.
- Initialized by: Module import; no separate `.init()`.
- Lifetime: Module-singleton event bus for the page's lifetime.
- Direction: App.js both depends on it (`on`) and drives it (`emit`); other internal modules (`Storage`, `Session`) also `emit` into the same bus.
- Required or optional: Required for the internal event-bus contract catalogued in PREP-2 §10.2.
- Public API used: `on(eventName, handler)`, `emit(eventName, payload)`.
- Events exchanged: The full internal-bus name list in PREP-2 §10.2 (`app:error`, `theme:apply`, `storage:*`, `session:changed`, `session:error`, `auth:changed`).
- Shared state: None owned directly; it is the transport for other modules' state-change notifications.
- Storage interaction: None directly.
- Cross-tab interaction: None — this is an in-page event bus, not a cross-tab mechanism.
- Circular dependency risk: None as a static import; multiple modules importing the same singleton bus is the intended pattern here, not a cycle.
- Coupling level: Medium — narrow API, but every listed event name is a cross-module contract per PREP-2 §10.2.
- Notes: Distinct from both the native `CustomEvent`s on `window` (§6 below) and the BroadcastChannels (§8 below); this is a same-page, same-tab, in-memory bus only.

**`./core/version.js` → `APP_VERSION`**

- Type: Internal module (static constant export). Used by: Diagnostics/build-stamp logging (`TP3D_BUILD_STAMP`).
- Lifetime: Static, module-load-once. Direction: App.js depends on it. Required or optional: Optional (informational).
- Circular dependency risk: None. Coupling level: Low.

### 1.9 App.js-local dependencies (not imported, but structurally significant)

These are defined *inside* `src/app.js`'s own IIFE, not imported from another file — they are not, strictly, external dependencies of App.js. They are listed here because other **imported** dependencies above (§1.3, §1.7) depend on *them*, which matters for reading the dependency direction correctly.

- **`TrailerGeometry`** (`src/app.js:3257`) — constructed locally, then passed as a constructor argument into `createSceneRuntime` (§1.7) and `createCaseScene`/`createEditorScreen` (§1.7). Direction here is inverted from every other entry in this section: an *imported* factory depends on *App.js-local* code, not the other way around.
- **`AppShell`, `KeyboardManager`, `UpdatesUI`, `RoadmapUI`, `SettingsUI`, `AccountSwitcher`** — all App.js-local (PREP-4 §10-11, §15-16); listed here only to make explicit that they are not part of the *import* dependency map in §2 below, even though PREP-4 documents them as ownership areas.

---

## 2. External library / vendor dependencies

**`three` (via `esm.sh`/`cdn.skypack.dev`, local fallback `vendor/three.min.js` / `vendor/three.module.js`) → `window.THREE`**

- Type: External library (ESM, loaded outside the `src/app.js` module graph, via `index.html`).
- Imported from: Not a static `import` in `app.js`; consumed as the global `window.THREE` after `index.html` awaits its own loader and App.js awaits `window.__TP3D_BOOT.threeReady`.
- Used by: Scene startup (§1.7 above), `validateRuntime()`'s missing-library check (PREP-4 §1).
- Initialized by: `index.html`'s ESM loader script (`index.html:144-181` area).
- Lifetime: Page-lifetime, loaded once before App.js's boot IIFE proceeds past its first `await`.
- Direction: App.js depends on it.
- Required or optional: Required — `validateRuntime()` treats its absence as a missing-library degraded-boot condition.
- Public API used: `THREE.*` (full 3D engine surface, consumed inside `scene-runtime.js`/`editor-screen.js`, not directly by `app.js` itself beyond the presence check) and `THREE.OrbitControls`.
- Events exchanged: None.
- Shared state: `window.THREE` is the shared global itself.
- Storage interaction: None.
- Cross-tab interaction: None.
- Circular dependency risk: None — a vendor library, not part of the app's module graph.
- Coupling level: High by necessity (the whole editor depends on it) but the dependency edge itself (App.js → THREE) is a simple presence check plus pass-through to `scene-runtime.js`.
- Notes: Per PREP-2 §8.2, no standalone `window.OrbitControls` assignment was confirmed — it is expected to arrive as `window.THREE.OrbitControls`.

**`@tweenjs/tween.js` (classic script, local fallback `vendor/tween.umd.js`) → `window.TWEEN`**

- Type: External library. Used by: Scene/animation code (not individually re-traced to a specific `app.js` call site beyond the `validateRuntime()` presence check).
- Initialized by: `index.html`'s classic vendor `<script>` tag, before App.js's module import.
- Lifetime: Page-lifetime. Direction: App.js depends on it (presence check only, at this boundary). Required or optional: Required per `validateRuntime()`.
- Circular dependency risk: None. Coupling level: Low at the App.js boundary specifically (deeper coupling exists inside `scene-runtime.js`, outside this file's scope).

**`jspdf` (classic script, local fallback `vendor/jspdf.umd.min.js`) → `window.jspdf`**

- Type: External library. Used by: PDF export/generation (`generatePDF()`, referenced in PREP-2 §7.2 and PREP-4's billing/PDF-gating mentions).
- Initialized by: `index.html`'s classic vendor `<script>` tag.
- Lifetime: Page-lifetime. Direction: App.js depends on it. Required or optional: Required for PDF export specifically; `validateRuntime()` treats its absence as a missing-library degraded-boot condition.
- Circular dependency risk: None. Coupling level: Low-Medium at the App.js boundary (App.js gates PDF export on entitlement via `window.__TP3D_BILLING`, §5, then delegates to `jspdf`).

**`xlsx` (classic script, local fallback `vendor/xlsx.full.min.js`) → `window.XLSX`**

- Type: External library. Used by: Spreadsheet import/export (not individually re-traced to a specific call site beyond the `validateRuntime()` presence check).
- Initialized by: `index.html`'s classic vendor `<script>` tag.
- Lifetime: Page-lifetime. Direction: App.js depends on it. Required or optional: Required per `validateRuntime()`.
- Circular dependency risk: None. Coupling level: Low at the App.js boundary.

**`@supabase/supabase-js` (classic script, local fallback `vendor/supabase.min.js`) → `window.supabase`**

- Type: External library. Used by: `core/supabase-client.js` (§1.6) exclusively — `app.js` does not call `window.supabase` directly.
- Initialized by: `index.html`'s classic vendor `<script>` tag; `window.supabase.createClient` is consumed by `supabase-client.js`.
- Lifetime: Page-lifetime. Direction: `core/supabase-client.js` depends on it; App.js's dependency on it is transitive, through `SupabaseClient`.
- Required or optional: Required.
- Circular dependency risk: None. Coupling level: Low at the direct App.js boundary (mediated entirely through `SupabaseClient`, §1.6).
- Notes: The one vendor library App.js never touches directly, per PREP-2 §8.1.

**Font Awesome (CSS, classic `<link>`/fallback), Google Fonts (CSS)**

- Type: External library (styling only, no JS API surface consumed by `app.js`).
- Used by: Presentation only; no functional dependency edge into `app.js` logic.
- Coupling level: Low. Notes: Included for completeness; not a behavioral dependency.

---

## 3. Browser API dependencies

| API | Used by (PREP-4 area) | Required/optional | Cross-tab role | Coupling |
|---|---|---|---|---|
| `localStorage` | Storage (§7), Auth (§3, Supabase auth-token family), Organization (§4, `tp3d:active-org-id` and sync keys), Billing (§5, primary + legacy key families), Diagnostics (§21, debug flags) | Required | Primary cross-tab transport when BroadcastChannel is unavailable or for data that is not channel-based (org/workspace sync uses `storage` events, not a channel) | High |
| `sessionStorage` | Auth (§3, `authReloadKey` cleanup), Organization (§4, `tp3d:org-context-tab-id` per-tab identifier), invite-token continuation (`tp3d:pending_invite_token`) | Required | None — session storage is explicitly tab-scoped and is used here *because* it is not shared across tabs | Low-Medium |
| `BroadcastChannel` | Billing (§5/§8, `tp3d-billing`, owned by App.js); Auth (`tp3d-auth`, owned by `supabase-client.js`, consumed indirectly) | Optional at the API level (both channels have `localStorage`-based fallback paths per PREP-2 §11) but required for the primary cross-tab delivery path | Primary cross-tab transport for billing results and auth logout | High |
| `window.history` | Navigation (§11, indirectly through `Router`'s hash-based routing) | Required | None | Low |
| `window.location` | Navigation (`window.location.href` for Stripe redirects, §6), Recovery (`window.location.reload()`, §19), degraded-config retry paths (§1) | Required | None | Medium |
| `window` (global object) | Everywhere — event target for `error`, `unhandledrejection`, `resize`, `online`, `offline`, `storage`, `hashchange`; holds every Global in §4 below | Required | Indirect — `window` itself is per-tab, but it is where every cross-tab-relevant global and listener lives | High |
| `document` | Everywhere — DOM element capture (`AppShell`, `SettingsUI`, `KeyboardManager`'s `keydown` target), `document.hidden`/`visibilitychange` for auth/billing recovery gating | Required | None directly | High |
| `document.visibilityState` / `visibilitychange` | Auth (§3, `checkProfileStatus()`'s hidden-tab skip), Billing (§5, focus/visibility-driven refresh scheduling) | Required for the specific recovery behaviors that depend on it | None directly, but interacts with cross-tab freshness decisions (a hidden tab is treated differently when reconciling shared billing state) | Medium |
| `resize` (window event) | Navigation/UI (`AppShell`'s sidebar-collapse behavior, PREP-4 §11) | Optional (presentation only) | None | Low |
| `keydown` (document event) | Keyboard (§10) | Required for the keyboard-shortcut feature | None | Medium |
| `online` / `offline` (window events) | Billing (§5, offline/online recovery), general connectivity-aware recovery paths | Required for the documented offline-recovery behavior | None directly | Medium |
| `setTimeout` / `clearTimeout` | Timers (PREP-4 §23) — billing lock retry, workspace-switch timeout, invite-notice scheduling, background-error toast dedup | Required | Indirect — several of these timers exist specifically to bound cross-tab coordination windows (§4-5) | Medium |
| `setInterval` | Not confirmed as directly used by `app.js` in this pass beyond what the browser test-harness instrumentation observes generically — flagged as an **unknown** for a specific production call site (see §9) | N/A | N/A | N/A |
| `fetch` | Not called directly by `app.js`; network requests are made through `SupabaseClient` (§1.6) and `billing.service.js` (§1.5), which themselves may use `fetch` internally (outside this file's scope) | N/A at the direct `app.js` boundary | N/A | Low (indirect) |
| `URLSearchParams` / `URL` | Invite-token handling inside `init()` (parsing `invite_token` from the query string) | Required for the invite-link feature | None | Low |
| `matchMedia` | `AppShell`'s mobile/desktop sidebar behavior (`window.matchMedia('(max-width: 899px)')`) | Optional (presentation only) | None | Low |
| `requestAnimationFrame` | `AppShell.renderShell()`'s double-`rAF` deferral before calling `EditorUI.onActivated()` | Required for that specific timing | None | Low |
| `CustomEvent` / `dispatchEvent` / `addEventListener` | The entire custom-event contract in PREP-2 §10.1 and PREP-4 throughout | Required | Indirect — this is how in-tab consumers react to state that cross-tab mechanisms (§4-5, §8) already updated | High |

---

## 4. Global dependencies

| Global | Type | Owner | App.js relationship | Cross-tab role | Coupling |
|---|---|---|---|---|---|
| `window.TruckPackerApp` | Global / Runtime singleton | `src/app.js` (assembled) | Exclusive owner; assigned twice (temporary stub at `src/app.js:6851`, final facade at `src/app.js:2304`/`10186-10201`) | None directly — not a cross-tab surface | High |
| `window.OrgContext` | Global / Runtime singleton | `src/app.js` (assembled) | Exclusive owner | Indirectly, via the storage/event mechanisms it drives (§4/PREP-4 §4) | High |
| `window.__TP3D_BILLING` | Global / Runtime singleton | `src/app.js` (assembled) | Exclusive owner | Indirectly, via `tp3d-billing` (§2/§8) and its storage-key families | High |
| `window.__TP3D_BOOT` | Global | `index.html` (created), mutated by both `index.html`'s preboot script and `src/app.js` | Shared, bidirectional — `appReady`/`fatalOverlayShown` are written by `app.js` and read by `index.html`'s preboot handlers, and vice versa for `threeReady`/`cdnFailures` | None (single-tab boot state) | High |
| `window.__TP3D_SUPABASE` | Global | `index.html` (created), augmented by `src/core/supabase-client.js` | App.js reads it only indirectly, through `SupabaseClient` | None | Medium |
| `window.supabase` | Global (vendor) | Vendor script (`index.html`) | Consumed only by `supabase-client.js`, per §1.6/§2 | None | Low (at the App.js boundary) |
| `window.THREE`, `window.TWEEN`, `window.jspdf`, `window.XLSX` | Global (vendor) | Vendor scripts (`index.html`) | See §2 | None | Varies, see §2 |
| `window.__TP3D_FLAGS__` | Global | `index.html` (created) | App.js reads `maintenanceMode` once, at the very start of `boot()` (PREP-4 §22); does not mutate it | None — not synchronized across tabs by App.js | Low |
| `window.__TP3D_UI` | Global / Internal | `src/app.js` | Exclusive owner (PREP-2 §9.1) | None | Medium |
| `window.TP3D.helpers` | Global / Diagnostic | `src/core/app-helpers.js`, installed by App.js's call to `createAppHelpers()` | App.js instantiates it; the module itself owns the namespace contents | None | Low |
| `window.__TP3D_LAST_ACCOUNT_BUNDLE` | Global / Internal | `src/app.js` | Exclusive owner; P0-sensitive across auth/organization changes (PREP-2 §9.1) | Not itself a cross-tab transport, but its correctness depends on the same identity/epoch guards as §3-4 | High |
| `window.__TP3D_USER_SWITCH_PENDING` | Global / Internal | `src/app.js` | Exclusive owner; cross-module user-switch synchronization flag | Single-tab only | Medium |
| `window.__TP3D_ORG_METRICS__` | Global / Diagnostic | `src/app.js` | Exclusive owner (read-only for consumers) | None | Low |
| `window.__TP3D_BILLING_TRACE_CURRENT_ID__` | Global / Diagnostic | `src/app.js` | Exclusive owner | None | Low |
| `window.getBillingState` | Global / Diagnostic alias | `src/app.js` | Exclusive owner; debug-only alias for `window.__TP3D_BILLING.getBillingState` | None | Low |
| `window.__TP3D_DIAG__`, `window.__TP3D_WRAPPER_DETECTIVE__`, `window.__TP3D_FORCE_DEBUG__`, `window.__tp3dAssertCore` | Global / Diagnostic | `src/debugger.js` / `src/core/dev/dev-helpers.js` | App.js triggers their creation (`initTP3DDebugger()`, `installDevHelpers()`) but does not own their contents | None | Low |
| `window.SettingsOverlay`, `window.AccountOverlay` | Global (probed, not assigned) | Unconfirmed | App.js probes for these near `src/app.js:5683` but no current assignment was confirmed (PREP-2 §9.3) | N/A | N/A |

---

## Import dependency map

Grouped by category, matching the import order in `src/app.js:51-94`.

**Boot/error/system UI:** `./debugger.js`, `./ui/system-overlay.js`, `./ui/error-overlay.js`

**Routing:** `./router.js`

**UI primitives and overlays:** `./ui/ui-components.js`, `./ui/truck-change-controller.js`, `./ui/table-footer.js`, `./ui/overlays/settings-overlay.js`, `./ui/overlays/account-overlay.js`, `./ui/overlays/card-display-overlay.js`, `./ui/overlays/help-modal.js`, `./ui/overlays/import-app-dialog.js`, `./ui/overlays/import-pack-dialog.js`, `./ui/overlays/import-cases-dialog.js`, `./ui/overlays/auth-overlay.js`

**Operation lifecycle:** `./core/operation-lifecycle.js`

**Data/state/storage core:** `./core/utils/index.js`, `./core/browser.js`, `./core/defaults.js`, `./core/state-store.js`, `./core/storage.js`, `./core/session.js`, `./services/category-service.js`, `./services/case-library.js`, `./services/pack-library.js`, `./services/import-export.js`, `./services/preferences-manager.js`, `./data/trailer-presets.js`, `./data/services/billing.service.js`

**Auth:** `./core/supabase-client.js`

**Screens and scene:** `./editor/scene-runtime.js`, `./screens/editor-screen.js`, `./screens/packs-screen.js`, `./screens/cases-screen.js`, `./services/autopack-engine.js`

**Events and versioning:** `./core/events.js`, `./core/version.js`

**Dev-only:** `./core/dev/dev-helpers.js`

Total: 36 static `import` statements resolving 39 distinct exported bindings (three exports come from the single `./screens/editor-screen.js` import). Every import target is under `src/`; `src/app.js` has no direct `import` of anything outside the repository (vendor libraries arrive as globals, per §2).

---

## Runtime dependency graph

Boot order, from `index.html` parsing through `TruckPackerApp.init()`'s normal-completion path (see also PREP-2 §13, which this restates from the dependency-ordering angle rather than the facade-timing angle):

1. `index.html` creates `window.__TP3D_BOOT` and the vendor-readiness helper functions (`__tp3dVendorOk`, `__tp3dVendorFail`, `__tp3dVendorAllReady`).
2. Classic vendor `<script>` tags load, blocking HTML parsing in document order: `TWEEN`, `jspdf`, `XLSX`, `supabase-js` (§2) — each populates its `window.*` global and resolves its vendor-readiness promise via `onload`/`onerror`.
3. The Three.js ESM loader (`type="module"` script, non-blocking) begins loading `THREE`, populating `window.__TP3D_BOOT.threeReady`.
4. `index.html` creates `window.__TP3D_SUPABASE` (configuration) and `window.__TP3D_FLAGS__`.
5. Preboot `error`/`unhandledrejection` handlers are installed, gated on `window.__TP3D_BOOT.appReady`.
6. `src/app.js` is dynamically imported (`import('./src/app.js?...')`), triggering module evaluation: every static import in §2 above resolves and each imported module's own top-level code runs (for example, `initTP3DDebugger()` at `src/app.js:100`, which runs *before* the outer boot IIFE's own `await`).
7. The outer boot IIFE (`src/app.js:2144`) begins; its first action is `await window.__TP3D_BOOT.threeReady`.
8. Once `threeReady` resolves, `UIComponents`, `SystemOverlay`, `ErrorOverlay`, and `BootState` are constructed synchronously (§1.3).
9. The inner IIFE that builds `window.TruckPackerApp` (§1.1/PREP-2 §5.1) runs synchronously to completion: every §1.3-§1.9 dependency above is constructed, in source order, including `window.OrgContext` and `window.__TP3D_BILLING` (§4) — this is a single, uninterrupted synchronous JavaScript turn with no `await` inside it.
10. `window.TruckPackerApp` is assigned the final facade.
11. `boot()` is defined and invoked (synchronously, in the same turn as step 10, unless `document.readyState === 'loading'`, in which case it waits for `DOMContentLoaded`).
12. `boot()` calls `window.TruckPackerApp.init()`, whose own internal `await`s (`validateRuntime()`'s vendor-readiness wait, `SupabaseClient.init()`, `bootstrapAuthGate()`) are the first points after step 7 where the JavaScript event loop actually yields.
13. `init()`'s normal-completion path calls `Router.init()`, `renderAll()`, and the unguarded module-initializer block (`AppShell.init()` through `KeyboardManager.init()`, §1.3/§1.7), then `bootstrapAuthGate()`, then `markAppReady()`.

**Initialization-order dependency rule (confirmed by direct reading, not inferred):** every dependency in §1.1-§1.9 that is constructed via the *synchronous* IIFE body (step 9) exists in full before `init()` (step 12) ever runs — meaning `init()` never has to worry about a §1 dependency being partially constructed. The only dependencies whose *readiness* (not construction) `init()` explicitly waits on are `window.__TP3D_BOOT.threeReady` (step 7, already resolved by the time `init()` runs) and, inside `init()` itself, `window.__tp3dVendorAllReady()` (re-checked via `validateRuntime()`) and `SupabaseClient.init()`.

---

## Event dependency graph

**Native `CustomEvent`s on `window` (cross-module, same-tab; also the basis for `storage`-event cross-tab sync)**

| Event | Producer | Consumers |
|---|---|---|
| `tp3d:auth-signed-out` | `SupabaseClient` (§1.6) | `src/app.js` (Auth, §3), diagnostics |
| `tp3d:auth-error` | `SupabaseClient` | Diagnostics |
| `tp3d:workspace-switch-state` | `src/app.js` (Organization/Workspace, §4) | `SettingsOverlay` (§1.3), browser-characterization test harness |
| `tp3d:org-changed` | `src/app.js` | `src/app.js` itself (self-consumed for cross-tab reconciliation), `SettingsOverlay`, diagnostics |
| `tp3d:org-access-lost` | `src/app.js` | `SettingsOverlay` |
| `tp3d:workspace-ready` | `src/app.js` | `src/app.js` itself |
| `tp3d:profile-updated` | `SettingsOverlay` | No confirmed consumer (PREP-2 §10.1) |

**Internal event bus (`./core/events.js`, §1.8; in-page, in-memory, not a browser event)**

| Event name | Producer | Consumer |
|---|---|---|
| `app:error` | Not individually re-traced to a single producer in this pass | `src/app.js` (general error surfacing) |
| `theme:apply` | `PreferencesManager` (§1.5) | `src/app.js` (theme application at boot and on save, §15) |
| `storage:load_error`, `storage:read_error`, `storage:write_error`, `storage:remove_error`, `storage:saved`, `storage:save_error`, `storage:import_error` | `Storage` (§1.5) | `src/app.js` |
| `session:changed`, `session:error` | `Session` (§1.5, `core/session.js`) | Not individually re-traced to a confirmed `src/app.js` consumer in this pass — flagged in §9 |
| `auth:changed` | Not individually re-traced to a single confirmed producer (possibly `Session` or `SupabaseClient`) | Not individually re-traced to a confirmed consumer — flagged in §9 |

**Native browser events consumed directly**

`error`, `unhandledrejection` (preboot, in `index.html`, and post-boot, in `installRuntimeFatalHandlers()`), `resize`, `keydown`, `online`, `offline`, `focus`, `visibilitychange`, `hashchange` (via `Router`), `storage` (the cross-tab transport underlying §4-5's sync keys), `DOMContentLoaded` (boot trigger).

**Direction summary:** every custom event in the first table is both produced *and* consumed inside `src/app.js` itself for at least one purpose (self-notification for cross-tab reconciliation, per PREP-2 §10.1's own framing), except `tp3d:auth-signed-out`/`tp3d:auth-error` (consumed only, produced by `SupabaseClient`) and `tp3d:profile-updated` (produced only, by `SettingsOverlay`, with no confirmed consumer).

---

## State dependency graph

Ownership vs. consumers, cross-referencing PREP-4's "Internal state owned" fields:

| State | Owner | Consumers |
|---|---|---|
| `StateStore` fields (`currentScreen`, `currentPackId`, `selectedInstanceIds`, undo/redo history) | `core/state-store.js` (module), driven by `src/app.js` | `AppShell`, `PacksUI`, `CasesUI`, `EditorUI`, `KeyboardManager`, `UpdatesUI`, `RoadmapUI`, error-handling (`hasMissingEditorPack()`) |
| `_billingState` (full field set) | `src/app.js` exclusively | `window.__TP3D_BILLING` consumers: `SettingsOverlay`, `AutoPackEngine` (entitlement), App.js's own PDF-gating code, `AccountSwitcher` indirectly (via access-gate application) |
| `orgContext` (`activeOrgId`, `activeOrg`, `orgs`, `role`) | `src/app.js` exclusively, exposed via `window.OrgContext` | `SettingsOverlay`, `AutoPackEngine`, `billing.service.js` call sites, `src/debugger.js`, browser-characterization harness (PREP-2 §6.1) |
| `workspaceSwitchState` | `src/app.js` exclusively | `SettingsOverlay`, browser-readiness test helpers (via `TruckPackerApp.getWorkspaceSwitchState()`) |
| `_authGate` settlement state, `lastAuthUserId`, `authBlockState` | `src/app.js` exclusively | `AuthOverlay` (indirectly, via the phase/callback App.js supplies) |
| Supabase auth state/session/epoch | `core/supabase-client.js` exclusively | `src/app.js` (Auth §3, Billing §5, Checkout/Portal §6), `SettingsOverlay`/`AccountOverlay` (via `.handleAuthChange()`) |
| `initInFlightPromise`, `initCompleted`, `BootState` fields | `src/app.js` (and, for `BootState`, jointly with `index.html`'s preboot script) | `boot()`, `index.html`'s preboot handlers, the behavioral test harness |
| `_billingActionGeneration` | `src/app.js` exclusively (shared between `startCheckout`/`openPortal`, §6) | `startCheckout()`, `openPortal()` only |
| `PackLibrary`/`CaseLibrary` data | `services/pack-library.js`/`services/case-library.js` (module), persisted via `Storage` | `PacksUI`, `CasesUI`, `EditorUI`, `KeyboardManager`, error-handling, `ImportExport` |
| `PreferencesManager` state | `services/preferences-manager.js` (module), persisted via `Storage` | `SettingsUI`, `SceneManager` (constructor dependency), boot-time theme application |
| `TrailerGeometry` | `src/app.js`-local (§1.9) | `SceneManager`, `CaseScene`/`EditorUI` (constructor dependency) |

**Cross-cutting rule confirmed by this pass:** no state in the table above has more than one *owner* — every case examined has exactly one module or one App.js-local closure responsible for mutation, with all other listed modules being read-only consumers (or, for `window.OrgContext`/`window.__TP3D_BILLING`, consumers of a guarded mutation API rather than direct state mutators). This matches the "state authority hierarchy" already established in `app-js-runtime-invariants.md` §9, restated here from the dependency-graph angle.

---

## Browser API dependency graph

See §3 above (table) for the full per-API breakdown. Cross-cutting notes not captured in that table:

- **`localStorage` is the single most cross-cutting Browser API dependency in the file** — it underlies the cross-tab transport for all three of Organization (§4), Billing (§5), and (indirectly, via `tp3d-logout-trigger`) Auth (§3), in addition to being the persistence layer `Storage` (§1.5) is built on.
- **`BroadcastChannel` and `localStorage` are deliberately redundant for the same logical messages** (billing results, auth logout) — the `localStorage` fallback paths exist specifically for browsers/tabs where `BroadcastChannel` delivery cannot be assumed, per PREP-2 §11 and `app-js-runtime-invariants.md` §7.
- **`document`/`window` as event targets are the substrate every other dependency category in this document ultimately sits on** — every custom event, every native event, and every global in §4 is reached through one of these two objects.

---

## Global dependency graph

See §4 above (table) for the full per-global breakdown. Cross-cutting notes:

- **Three preserved facades** (`window.TruckPackerApp`, `window.OrgContext`, `window.__TP3D_BILLING`) are the only globals in this document classified "Public"/"Compatibility" at the top level, per PREP-2 §4; every other global in §4 is Internal, Diagnostic, or Vendor.
- **`window.__TP3D_BOOT` is the one global with genuinely bidirectional read/write between `index.html` and `src/app.js`** — every other global in §4 has a single clear owner that only the other side reads.
- **No global in §4 is written by more than one *module* (as opposed to script context)** — the `index.html`/`app.js` split for `window.__TP3D_BOOT` is a script-context split within what is conceptually one boot sequence, not two independent modules racing to own the same state.

---

## Tight coupling summary

Restated from the dependency-edge angle (see PREP-4's "Highest-coupling areas" for the responsibility-ownership framing of the same facts):

1. **`SupabaseClient` (§1.6) is the highest-fan-in internal-module dependency in the file.** Auth (§3), Billing (§5), Checkout/Portal (§6), and Organization (§4) all read from it directly, and its own DEF-009 staleness guards are load-bearing for correctness in all four areas simultaneously.
2. **`Storage` (§1.5) and `localStorage` (§3 table) together form the widest dependency surface by breadth.** Nearly every cross-tab mechanism in the app (§4, §5, and indirectly §3) is built on top of this pair.
3. **`editor-screen.js`'s three exports (§1.7) are reached from two directions at once:** App.js constructs and exposes `EditorUI` on the public facade (a "goes down" dependency, App.js → editor-screen.js), while `KeyboardManager` (App.js-local) reaches *through* the facade into `CaseScene`/`InteractionManager` directly rather than through `EditorUI`'s own surface — this is the clearest example in the graph of a dependency edge that bypasses the module boundary its own owner already established.
4. **`PackLibrary`/`CaseLibrary` (§1.5) are consumed from more distinct App.js areas than any other data-layer dependency** — Keyboard, Navigation, Error handling, and UI orchestration all read from them directly, none through a shared intermediary.
5. **`billing.service.js` (§1.5) is a dependency shared between App.js and `autopack-engine.js` independently** — both call it directly for entitlement/checkout purposes rather than one depending on the other, per PREP-2 §7.2. A change to this service's contract has two independent blast radii.
6. **`window.__TP3D_BOOT` (§4) is the one genuinely bidirectional dependency edge in the entire graph** — every other "shared" relationship in this document is one-directional-with-a-callback (App.js passes a callback into a dependency, which calls it later) rather than two separate script contexts writing the same object.

---

## Unknowns

Dependency relationships that could not be confirmed to a specific `src/app.js` call site within the scope of this pass, and are recorded here rather than asserted:

- **`./core/browser.js` (`BrowserUtils`):** imported, but no specific consuming call site inside `src/app.js` was individually confirmed in this pass. Likely a browser-capability/feature-detection helper consistent with its name, but not verified line-by-line.
- **`./core/session.js` (`CoreSession`):** imported, and its storage key (`truckPacker3d:session:v1`) is documented in PREP-2, but a specific `src/app.js` runtime dependency on its exported functions was not individually re-confirmed in this pass beyond the import itself.
- **`./services/category-service.js` (`CategoryService`):** imported, but no specific consuming call site inside `src/app.js` was individually confirmed in this pass.
- **The internal event bus's `session:changed`, `session:error`, and `auth:changed` events (§1.8, Event dependency graph):** their producer(s) and consumer(s) inside `src/app.js` specifically were not individually traced to confirmed call sites in this pass, though the event names themselves are already catalogued as an existing contract in PREP-2 §10.2.
- **`setInterval` (Browser API, §3):** no specific production call site inside `src/app.js` was confirmed in this pass; if one exists, it was not located by the greps and reads performed for this document.
- **Whether any dependency in §1-§2 has an undetected circular relationship mediated through dynamic (non-static) access** — this graph traced static `import` statements exhaustively and traced global-mediated "circular in effect" relationships (`settings-overlay.js` ↔ `app.js` via `window.OrgContext`/`window.__TP3D_BILLING`, §1.3) where evidence was found, but cannot rule out an equivalent pattern in a module not individually re-examined for this property (for example, `account-overlay.js`, `packs-screen.js`, `cases-screen.js` were not each individually checked for reading App.js-created globals the way `settings-overlay.js` was).
