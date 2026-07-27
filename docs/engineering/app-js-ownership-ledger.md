# App.js Ownership Ledger

**Status:** PREP-4 controlling reference

**Scope:** Every major runtime responsibility currently owned or orchestrated by `src/app.js`

**Behavioral baseline:** PREP-1 behavioral characterization, PREP-2 public facade and compatibility contract (`docs/engineering/app-js-public-facade-and-compatibility-contract.md`), PREP-3 runtime invariants (`docs/engineering/app-js-runtime-invariants.md`), DEF-009, DEF-010, DEF-011, TRIAGE-3A through TRIAGE-3D

**Change policy:** `docs/engineering/app-js-preparation-change-policy.md`

## Purpose

This is a documentation-only inventory. It records who currently owns each responsibility that touches `src/app.js` — either directly (logic defined inside the `src/app.js` IIFE) or by orchestration (a factory imported from another file, instantiated and wired together by `src/app.js`). It does not invent ownership boundaries that do not exist in the code today, does not propose an extraction order, and does not recommend architecture changes. Every entry is traceable to a specific function, variable, or line range in the current source.

Two ownership shapes recur throughout this ledger and are called out explicitly per area:

- **Exclusive to `src/app.js`** — the responsibility's logic is defined inside the `src/app.js` IIFE itself (for example, `AppShell`, `KeyboardManager`, billing refresh, auth-epoch coordination). Moving it later means moving code, not just moving a wiring call.
- **Shared / orchestrated** — the responsibility's logic lives in another module (imported via a factory function), and `src/app.js` owns only the instance, its wiring into other App.js-owned state, and its lifecycle timing. Moving it later is mostly a wiring change, but the wiring itself is often where cross-cutting assumptions (readiness order, guard checks, event fan-out) live.

## 1. Initialization / boot

- **Responsibility:** Application boot sequence — vendor readiness wait, facade construction, `init()` single-flight/settlement, degraded-vs-fatal branching, boot invocation.
- **Current owner/module:** Exclusive to `src/app.js`. Boot orchestration also depends on `index.html`'s pre-module boot script (`window.__TP3D_BOOT`, vendor loader, preboot error handlers) and on `src/core/supabase-client.js` for `SupabaseClient.init()`.
- **Initialization entry point:** The outer boot IIFE (`src/app.js:2144`); `TruckPackerApp.init()` (`src/app.js:8276`); `boot()` (`src/app.js:10225-10243`), invoked on `DOMContentLoaded` or immediately if the document has already loaded.
- **Public or private:** `init()` is public (facade member). `boot()`, `markAppReady()`, `validateRuntime()`, `bootstrapAuthGate` are private to the module.
- **Dependencies:** `window.__TP3D_BOOT.threeReady`, `window.__tp3dVendorAllReady`, `window.__TP3D_SUPABASE`, `SupabaseClient.init()`, `Router.init()`, every module-level UI initializer described in Section 12.
- **Internal state owned:** `initInFlightPromise`, `initCompleted`, `BootState` (`window.__TP3D_BOOT`) fields `appReady`, `fatalOverlayShown`, `maintenanceMode`, `runtimeFatalHandlersInstalled`.
- **Events consumed:** None directly gate boot start; `window` `error`/`unhandledrejection` are consumed by `installRuntimeFatalHandlers()` once boot reaches that point.
- **Events emitted:** None custom; boot success/failure is signaled only through `BootState` fields, not a dispatched event.
- **Storage touched:** Clears the stale auth-reload session-storage latch (`authReloadKey`) early in `init()`.
- **BroadcastChannel usage:** None directly (billing/auth channels are created earlier, during module evaluation, before `init()` runs — see Sections 6 and 3).
- **Cross-tab responsibilities:** None directly; boot does not coordinate across tabs.
- **Auth responsibilities:** Initiates `SupabaseClient.init()` and, on success, calls `bootstrapAuthGate` once (`src/app.js:10177`) as part of the normal-completion path.
- **Billing responsibilities:** None directly during boot; billing coordination (`window.__TP3D_BILLING`) is created earlier during module evaluation, independent of `init()`.
- **Workspace responsibilities:** None directly during boot.
- **UI responsibilities:** Shows `AuthOverlay`/`SystemOverlay`/`ErrorOverlay` states for degraded paths; calls `renderAll()` and `Router.init()` on the way to readiness.
- **Cleanup/teardown behavior:** None. No teardown exists for a partially-completed or fatally-failed attempt (see `docs/engineering/app-js-runtime-invariants.md`, Section 2.4 and Section 8).
- **Extraction difficulty:** **High.** This is the single most cross-cutting responsibility in the file — nearly every other area in this ledger is instantiated or gated from inside `init()`.
- **Known coupling:** Tightly coupled to every module-initializer call in Section 12, to `SupabaseClient`, and to `index.html`'s preboot script contract (`window.__TP3D_BOOT`).
- **Known assumptions:** That the unguarded module-initializer block (`src/app.js:9049-9058`) either all succeeds or the whole attempt is abandoned; that a fatal failure is always recovered by a full page reload, never by a second `init()` call.
- **Unknowns:** Whether every module invoked in the unguarded block would tolerate a second real invocation (idempotency not established — see `app-js-runtime-invariants.md` Section 8/13).

## 2. Runtime state

- **Responsibility:** Application-wide reactive state (current screen, current pack, selection, undo/redo history, preferences) via the shared `StateStore`.
- **Current owner/module:** Shared/orchestrated. `StateStore` itself is owned by `src/core/state-store.js` / `src/core/state.js`; `src/app.js` is its primary consumer and the module that subscribes to it for rendering and cross-module coordination (`state-store.js` exposed as `StateStore` inside `src/app.js`).
- **Initialization entry point:** `StateStore` is constructed as part of module-level imports/wiring before `init()` runs; `renderAll()` (`src/app.js:5206-5215`) is the primary consumer entry point, called once during `init()` and again after relevant state changes.
- **Public or private:** Private; `StateStore` is not on the `TruckPackerApp` facade, though `_debug.StateStore` exposes it diagnostically.
- **Dependencies:** `AppShell`, `PacksUI`, `CasesUI`, `EditorUI`, `UpdatesUI`, `RoadmapUI`, `SettingsUI` all read from and/or write to `StateStore`.
- **Internal state owned by App.js's usage:** `currentScreen`, `currentPackId`, `selectedInstanceIds`, undo/redo history (through `StateStore.undo()`/`redo()`), preferences (via `PreferencesManager`).
- **Events consumed:** `StateStore` subscription (`src/app.js`, near the `renderAll`/`syncRecoverableErrorOverlay` wiring around `src/app.js:10120-10149`) drives `syncRecoverableErrorOverlay()` on relevant field changes.
- **Events emitted:** None custom beyond `StateStore`'s own subscription mechanism.
- **Storage touched:** Indirectly, through `Storage.saveNow()`/autosave, which persists `StateStore`-derived application data.
- **BroadcastChannel usage:** None directly.
- **Cross-tab responsibilities:** None directly; cross-tab sync operates on organization/billing/workspace state (Sections 3-5), not on general `StateStore` fields.
- **Auth responsibilities:** None.
- **Billing responsibilities:** None.
- **Workspace responsibilities:** `currentScreen`/`currentPackId` are workspace-scoped indirectly through storage scoping (Section 8), but `StateStore` itself does not know about organizations.
- **UI responsibilities:** Drives `renderAll()` and per-screen `.render()` calls.
- **Cleanup/teardown behavior:** `resetAppStateToEmpty()` is called during signed-out cleanup (`src/app.js`, inside `_executeSignedOutCleanup`) to reset state when switching to an anonymous storage scope.
- **Extraction difficulty:** **Medium.** `StateStore` itself already lives outside `app.js`; what remains in `app.js` is the wiring between state changes and UI re-render, which is spread across many call sites.
- **Known coupling:** Every screen module reads `StateStore` directly rather than through an App.js-owned abstraction.
- **Known assumptions:** That `StateStore` subscriptions installed during `init()` are not duplicated on a second `init()` call (covered by the single-flight/no-op guard, not by an explicit unsubscribe).
- **Unknowns:** None beyond the general module-idempotency gap already recorded in `app-js-runtime-invariants.md`.

## 3. Auth

- **Responsibility:** Auth-state rendering, sign-in/sign-out UI flow, auth listener installation, profile-status/ban/deletion checks, auth-refresh scheduling, and consumption of Supabase auth results.
- **Current owner/module:** Shared. Auth session/token mechanics and the DEF-009 stale-result guards are owned by `src/core/supabase-client.js`. `src/app.js` owns the auth-state UI reaction (`renderAuthState()`, `src/app.js:7686`), the auth listener installation call site, profile-status checks (`checkProfileStatus()`, `src/app.js:8161-8271`), and auth-refresh scheduling (`requestAuthRefresh()`, `runAuthRefresh()`, `rehydrateAuthState()`).
- **Initialization entry point:** `SupabaseClient.onAuthStateChange(...)` installed once, guarded by `authListenerInstalled` (`src/app.js:8719-8721`), inside `init()`.
- **Public or private:** Private. No auth function is on the `TruckPackerApp` facade; `window.SupabaseClient`/`window.__TP3D_SUPABASE_API` are the public auth surfaces (owned by `supabase-client.js`, per the facade contract).
- **Dependencies:** `SupabaseClient` (session/user/epoch), `AuthOverlay`, `StateStore` (for storage-scope reset), `Storage` (scope switching).
- **Internal state owned:** `lastAuthUserId`, `orgContextResolved`, `authBlockState`, `lastProfileCheckUserId`/`lastProfileCheckAt`, `_authGate` settlement bookkeeping, `readyToastShown`.
- **Events consumed:** Supabase `onAuthStateChange` callback events (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `INITIAL_SESSION`, `USER_UPDATED`, `PASSWORD_RECOVERY`, and related); `document`/`window` `visibilitychange`/`focus` for auth refresh scheduling.
- **Events emitted:** `tp3d:auth-signed-out` and `tp3d:auth-error` are emitted by `supabase-client.js`, not by `app.js`; `app.js` is a consumer.
- **Storage touched:** `Storage.setStorageScope('anon')` / `setWorkspaceStorageScope(null)` on signed-out cleanup; clears `authReloadKey` from `sessionStorage` during `init()`.
- **BroadcastChannel usage:** None directly; cross-tab logout uses the `tp3d-auth` channel owned by `supabase-client.js`.
- **Cross-tab responsibilities:** Reacts to the `tp3d-auth` logout broadcast indirectly through the `tp3d:auth-signed-out` event, but does not itself broadcast.
- **Auth responsibilities:** Primary owner of the app-facing auth-state reaction: overlay phase transitions, profile-ban/deletion enforcement, storage-scope reset on sign-out, and the DEF-009 stale-result consumption points inside `getUserSingleFlight`/`validateSessionRevocation` (owned by `supabase-client.js`, consumed here).
- **Billing responsibilities:** None directly, though sign-out triggers `clearBillingState()` (Section 5) as part of the same cleanup path.
- **Workspace responsibilities:** Clears organization context (`clearOrgContext()`) as part of signed-out cleanup; does not own organization state itself (Section 4).
- **UI responsibilities:** `AuthOverlay` phase management (`checking`, `form`, `cantconnect`, account-disabled), toast on sign-out.
- **Cleanup/teardown behavior:** `_executeSignedOutCleanup()` (`src/app.js:7879`) is the explicit teardown path for a confirmed sign-out: resets `StateStore`, storage scope, org context, billing state, the user-switch guard, and settings/account overlay auth-change handlers.
- **Extraction difficulty:** **High.** Auth-state rendering fans out into billing, organization, storage-scope, and overlay state in the same functions.
- **Known coupling:** Tightly coupled to billing (Section 5, via `clearBillingState()`/`markBillingAuthoritativeRefreshForNextSignIn()`), to organization context (Section 4, via `clearOrgContext()`), and to storage scoping (Section 8).
- **Known assumptions:** That `authListenerInstalled` correctly prevents duplicate `onAuthStateChange` subscriptions across repeated `init()` calls (confirmed dynamically per `app-js-runtime-invariants.md` Section 8).
- **Unknowns:** None beyond the general DEF-009 guard behavior already documented.

## 4. Organization / Workspace

Organization (canonical active-workspace identity) and workspace (switch-in-progress lifecycle/readiness) are documented together because their code is interleaved in `src/app.js`, but they are functionally distinct — see the authority-vs-readiness separation in `app-js-runtime-invariants.md` Section 4.

- **Responsibility:** Active-organization resolution and persistence (`window.OrgContext`), organization-change fan-out, workspace-switch lifecycle/readiness state and its DEF-010 cross-tab ordering guard.
- **Current owner/module:** Exclusive to `src/app.js`. `window.OrgContext` is defined and assigned entirely within `src/app.js` (per the PREP-2 facade contract, Section 6).
- **Initialization entry point:** `window.OrgContext` is assigned near `src/app.js:5825` (facade-contract line reference), before the final `window.TruckPackerApp` assignment; workspace-switch state (`workspaceSwitchState`) is initialized at module-scope inside the same IIFE (`src/app.js:5259-5286` area).
- **Public or private:** `window.OrgContext` is public (its own preserved facade, per PREP-2). `getWorkspaceSwitchState()` is public on `TruckPackerApp`; the rest of the workspace-switch machinery is private.
- **Dependencies:** `SupabaseClient` (account bundle, membership/role), `StateStore`, `Storage` (workspace-scoped keys), billing (Section 5, for org-bound billing reconciliation).
- **Internal state owned:** `orgContext` (`activeOrgId`, `activeOrg`, `orgs`, `role`, `updatedAt`), `orgContextVersion`, `lastAppliedOrgContextVersion`/`lastAppliedOrgContextTabId`, `orgContextTabId`, `workspaceSwitchState`, `lastAppliedWorkspaceSwitchOrder`, `workspaceSwitchTimer`, `orgContextMetrics` (exposed diagnostically as `window.__TP3D_ORG_METRICS__`).
- **Events consumed:** `storage` events for `tp3d:org-context-sync` and `tp3d:workspace-switch-state-sync`; internally dispatches and re-consumes `tp3d:workspace-switch-state`, `tp3d:org-changed`, `tp3d:workspace-ready`.
- **Events emitted:** `tp3d:org-changed`, `tp3d:org-access-lost`, `tp3d:workspace-ready`, `tp3d:workspace-switch-state` (all owned/produced by `src/app.js`, per the facade contract Section 10.1).
- **Storage touched:** `tp3d:active-org-id`, `tp3d:org-context-sync`, `tp3d:workspace-switch-state-sync`, `tp3d:org-context-tab-id` (session-scoped tab identifier), plus workspace-scoped application storage keys (`truckPacker3d:v1:workspace:{orgScope}`) via `Storage`/`setWorkspaceStorageScope`.
- **BroadcastChannel usage:** None directly; organization/workspace cross-tab sync uses `localStorage` `storage` events, not a BroadcastChannel.
- **Cross-tab responsibilities:** Full owner of the DEF-010 ordering guard (`normalizeWorkspaceSwitchOrder`, `compareWorkspaceSwitchOrder`, `recordWorkspaceSwitchOrder`) and of organization-change cross-tab dedup/freshness handling.
- **Auth responsibilities:** Reads `getSignedInUserIdStrict()` to scope organization/workspace state to the current user; does not itself manage auth session state.
- **Billing responsibilities:** Triggers `maybeScheduleBillingRefresh()` on organization change; does not own billing state.
- **Workspace responsibilities:** Full owner (see above).
- **UI responsibilities:** `applyOrgRequiredUi()`, `queueOrgScopedRender()`, transition UI during an active workspace switch.
- **Cleanup/teardown behavior:** `clearOrgContext()` (`src/app.js:6753` area) on sign-out or confirmed no-org state; `clearWorkspaceSwitchTimer()` bounds an in-progress switch to `WORKSPACE_SWITCH_MAX_MS`.
- **Extraction difficulty:** **High.** `window.OrgContext` is a separately preserved facade already, but its implementation is deeply interleaved with billing reconciliation, storage scoping, and auth-user checks inside the same file.
- **Known coupling:** Tightly coupled to billing (org-bound billing authority, Section 5), to storage scoping (Section 8), and to auth (Section 3).
- **Known assumptions:** That `version` is not the ordering authority for cross-tab acceptance (DEF-010; the `(transitionAt, stateAt, tabId)` tuple is) — see `app-js-runtime-invariants.md` Section 4.
- **Unknowns:** None beyond the residual wall-clock-timestamp risk already documented in Section 4 of the invariants doc.

## 5. Billing (state refresh)

- **Responsibility:** Billing status fetch/refresh, epoch- and organization-bound staleness rejection, cross-tab billing freshness/locking, access-gate application.
- **Current owner/module:** Exclusive to `src/app.js`. `window.__TP3D_BILLING` is created and populated entirely within `src/app.js` (per PREP-2 facade contract Section 7).
- **Initialization entry point:** `window.__TP3D_BILLING` is created during module evaluation (`src/app.js:1989` area), before `window.TruckPackerApp` and before `init()`; `pickCheckoutInterval` is added later, during `init()` (`src/app.js:9230` area).
- **Public or private:** Public (`window.__TP3D_BILLING`, its own preserved facade). `TruckPackerApp.maybeScheduleBillingRefresh()` is a thin public scheduling entry point, not the billing authority itself.
- **Dependencies:** `window.OrgContext` (active organization binding), `SupabaseClient` (auth state for `canManageBilling`/authority), Stripe-facing Edge Functions (via `refreshBilling`'s network call, not directly imported).
- **Internal state owned:** `_billingState` (the full field set returned by `getBillingState()`), `_billingEpoch`, `_lastBillingKey`/`_lastBillingKeyAt`, `_billingRefreshQueued` and its waiters, cross-tab lock/freshness bookkeeping (`_tryAcquireBillingLock`, `_getSharedBillingFreshness`, etc.), `_billingSubscribers`.
- **Events consumed:** `storage` events for the billing storage-key families (Section 6.2/12.3 of the facade contract); `online`/`offline` and `focus`/`visibilitychange` for recovery/refresh scheduling.
- **Events emitted:** None as custom `CustomEvent`s beyond the `_notifyBilling()` subscriber callback mechanism (not a browser event).
- **Storage touched:** Primary keys `billing:inflight:{orgId}`, `billing:lastFetchedAt:{orgId}`, `billing:lastState:{orgId}`; legacy mirrors `tp3d:billing:lock:{orgId}`, `tp3d:billing:fresh:{orgId}`, `tp3d:billing:result:{orgId}`; session key `tp3d:billing:status:{orgId}`.
- **BroadcastChannel usage:** Owns and creates the `tp3d-billing` channel during module evaluation (`src/app.js:801` area); message shape `{ type: "billing-result", orgId, state, tabId }`.
- **Cross-tab responsibilities:** Full owner of cross-tab billing-fetch locking and shared-freshness reuse (Section 5 of `app-js-runtime-invariants.md`).
- **Auth responsibilities:** Reads auth state (via `SupabaseClient`) only to determine `canManageBilling`/authority context; does not manage auth session state itself.
- **Billing responsibilities:** Full owner of billing state refresh, distinct from the checkout/portal action guards (Section 6 below).
- **Workspace responsibilities:** Binds every refresh to `getActiveOrgIdForBilling()`; discards a result if the active organization changed during the fetch (Section 5 of the invariants doc).
- **UI responsibilities:** `applyAccessGateFromBilling()` delegates to a late-bound `_billingGateApplier` callback that drives feature-gating UI (AutoPack/PDF gates, sidebar notices) — the gate gets to *apply* UI consequences, but does not decide entitlement itself.
- **Cleanup/teardown behavior:** `clearBillingState()` (`src/app.js:1113-1145`) resets every `_billingState` field, clears queued-refresh waiters, bumps `_billingEpoch`, and re-applies the access gate. Called on sign-out and access loss.
- **Extraction difficulty:** **High.** Deeply coupled to organization context, cross-tab locking primitives, and the auth-derived authority check; also the single largest concentration of retry/throttle/cross-tab special-case branches in the file (`refreshBilling()` alone spans well over 150 lines of guard conditions).
- **Known coupling:** Tightly coupled to Section 4 (organization binding) and Section 3 (auth-derived authority).
- **Known assumptions:** That epoch and organization binding are sufficient staleness guards for a refresh result; that legacy storage-key mirrors remain necessary for compatibility with already-open older tabs (per the facade contract).
- **Unknowns:** None beyond what is already flagged in `app-js-runtime-invariants.md` Section 13.

## 6. Checkout / Portal

- **Responsibility:** Initiating Stripe Checkout and Billing Portal navigation, with the DEF-011 action-context supersession/staleness guard.
- **Current owner/module:** Exclusive to `src/app.js`. `startCheckout()` and `openPortal()` are both defined and exposed through `window.__TP3D_BILLING`.
- **Initialization entry point:** No separate initialization; both functions are defined during module evaluation and are called on demand (Settings billing tab, upgrade prompts).
- **Public or private:** Public (`window.__TP3D_BILLING.startCheckout`, `window.__TP3D_BILLING.openPortal`).
- **Dependencies:** `SupabaseClient.getAuthState()`/`getAuthEpoch()`, `getActiveOrgIdForBilling()`, `_billingState`/`_billingEpoch` (Section 5), the Stripe-facing Edge Functions invoked by `createCheckoutSession()`/`createPortalSession()` (not directly imported; called through the billing service layer).
- **Internal state owned:** `_billingActionGeneration` (shared module-scope counter across both functions), `BILLING_ACTION_CONTEXT_CHANGED_ERROR` constant.
- **Events consumed:** None directly; relies on the live `SupabaseClient`/`_billingState` snapshot at capture and re-check time rather than listening for events.
- **Events emitted:** None.
- **Storage touched:** None directly by the action functions themselves (they read, but do not write, billing/org storage).
- **BroadcastChannel usage:** None directly (the created Stripe session is not broadcast; only refreshed billing state is, via Section 5's channel).
- **Cross-tab responsibilities:** None directly — this is a single-tab, single-action guard (generation-based supersession within one tab), not a cross-tab mechanism.
- **Auth responsibilities:** Captures and re-validates signed-in status, auth epoch, and user ID as part of the action context (DEF-011).
- **Billing responsibilities:** Captures and re-validates billing epoch, billing-organization binding, and confirmed management authority (`canManageBilling`) as part of the action context.
- **Workspace responsibilities:** Captures and re-validates active organization ID as part of the action context.
- **UI responsibilities:** On success, performs the actual browser navigation (`window.location.href = result.url`); on a stale/invalid context, returns an error object for the caller (typically Settings) to display.
- **Cleanup/teardown behavior:** None needed — each call is self-contained; there is no persistent subscription or listener to tear down.
- **Extraction difficulty:** **Low-Medium.** The DEF-011 guard logic is self-contained (`captureBillingActionContext`, `startCheckout`, `openPortal`) and depends only on already-exposed read APIs (`SupabaseClient`, `getActiveOrgIdForBilling()`, `_billingState`); it does not own long-lived state or listeners the way Section 5 does.
- **Known coupling:** Reads from Section 3 (auth), Section 4 (organization), and Section 5 (billing state) but does not mutate any of them; coupling is read-only and narrow.
- **Known assumptions:** That a single shared `_billingActionGeneration` counter is correct for expressing "checkout supersedes portal and vice versa" (DEF-011); that a stale server-created Stripe session left unconsumed by the browser is an acceptable outcome (documented as a known hazard in `app-js-runtime-invariants.md` Section 13).
- **Unknowns:** None beyond that documented hazard.

## 7. Storage

- **Responsibility:** Orchestration of when/how the shared `Storage` module persists application data, including storage-scope switching (anonymous vs. user vs. workspace) and autosave suspension during identity transitions.
- **Current owner/module:** Shared. Persistence mechanics, key naming, and read/write primitives are owned by `src/core/storage.js`; `src/app.js` owns the scope-switching orchestration (`Storage.setStorageScope`, `setWorkspaceStorageScope`) and autosave suspension (`suspendAutoSave`, `flushPendingStorageSave()`).
- **Initialization entry point:** Storage scope is established during `init()`'s early sequence and re-established on every sign-out/sign-in/workspace-switch transition.
- **Public or private:** Private; `Storage` itself is exposed diagnostically via `_debug.Storage`, not as a supported API.
- **Dependencies:** `StateStore` (source of data to persist), `SupabaseClient` (for user-scope identity), `OrgContext` (for workspace scope).
- **Internal state owned:** `suspendAutoSave`, `hasLoadedScopedState`, `lastLoadedWorkspaceStorageKey`.
- **Events consumed:** None directly; storage scope changes are driven by auth/organization transitions, not by listening to a storage event.
- **Events emitted:** `storage:load_error`, `storage:read_error`, `storage:write_error`, `storage:remove_error`, `storage:saved`, `storage:save_error`, `storage:import_error` are emitted by `src/core/storage.js` on the internal event bus, consumed where relevant by `app.js`.
- **Storage touched:** The full key family catalogued in the facade contract, Section 12.1: `truckPacker3d:v1`, `truckPacker3d:v1:{userScope}`, `truckPacker3d:v1:workspace:{orgScope}`, plus the diagnostic/legacy keys in Section 12.4.
- **BroadcastChannel usage:** None directly.
- **Cross-tab responsibilities:** None directly beyond the `storage` event fallback paths already covered under auth (Section 3), organization (Section 4), and billing (Section 5).
- **Auth responsibilities:** Resets to anonymous scope on sign-out (`Storage.setStorageScope('anon')`) as part of `_executeSignedOutCleanup()`.
- **Billing responsibilities:** None.
- **Workspace responsibilities:** `setWorkspaceStorageScope()` binds persisted data to the active organization.
- **UI responsibilities:** None directly.
- **Cleanup/teardown behavior:** `flushPendingStorageSave()` before scope changes; `resetAppStateToEmpty()` alongside scope resets to avoid writing the old scope's in-memory state into the new scope's key.
- **Extraction difficulty:** **Medium.** `Storage` itself is already a separate module; the scope-switching orchestration in `app.js` is the coupled part, and it is entangled with the auth/organization cleanup sequence (Sections 3-4).
- **Known coupling:** Tightly coupled to the sign-out/sign-in and workspace-switch cleanup sequences.
- **Known assumptions:** That flushing before a scope switch is sufficient to prevent cross-scope data leakage; this is an existing P0-risk area per `CLAUDE.md`, not newly identified here.
- **Unknowns:** None identified beyond general storage-key ownership already catalogued in the facade contract.

## 8. BroadcastChannel

- **Responsibility:** Direct BroadcastChannel ownership by `src/app.js`.
- **Current owner/module:** Exclusive to `src/app.js` for `tp3d-billing` (created at `src/app.js:801` area, per Section 5 above). The `tp3d-auth` channel is owned by `src/core/supabase-client.js`, not `src/app.js` — `app.js` is a downstream consumer of its effects (the `tp3d:auth-signed-out` event) only.
- **Initialization entry point:** `tp3d-billing` channel construction happens during module evaluation, before `init()` runs.
- **Public or private:** Private implementation detail; not exposed on any facade.
- **Dependencies:** None beyond the browser `BroadcastChannel` API and, where unavailable, the `localStorage`-based fallback paths documented in the facade contract Section 11.
- **Internal state owned:** The channel instance itself and its message handler closures (folded into the billing module state in Section 5).
- **Events consumed:** Incoming `billing-result` messages on `tp3d-billing`.
- **Events emitted:** Outgoing `billing-result` messages on `tp3d-billing`, sanitized per Section 5.
- **Storage touched:** N/A directly (see Section 5 for the associated storage-key mirrors).
- **BroadcastChannel usage:** Full owner of `tp3d-billing`; consumer only of `tp3d-auth`.
- **Cross-tab responsibilities:** See Section 5.
- **Auth/Billing/Workspace/UI responsibilities:** See Sections 3-5 respectively; this section exists only to isolate the channel-ownership fact itself.
- **Cleanup/teardown behavior:** None observed; the channel is created once per page load and not explicitly closed.
- **Extraction difficulty:** **Low** for the channel-ownership fact in isolation; **High** if extracted together with the billing state it carries (Section 5).
- **Known coupling:** Coupled to Section 5's billing state and its staleness/organization guards.
- **Known assumptions:** That BroadcastChannel delivery is not guaranteed or globally ordered (explicitly documented, not assumed reliable, per `app-js-runtime-invariants.md` Section 7).
- **Unknowns:** None.

## 9. Window events

- **Responsibility:** Direct `window`/`document` listener installation for cross-cutting runtime concerns not already covered by a more specific section (resize, storage, online/offline, visibility/focus, runtime error/rejection handling, hashchange routing hookup).
- **Current owner/module:** Exclusive to `src/app.js` for the listeners it installs directly (for example, `AppShell`'s `resize` listener at `src/app.js:3583-3587`, `installRuntimeFatalHandlers()`'s `error`/`unhandledrejection` listeners at `src/app.js:2230-2279`); shared with `Router` (`hashchange`, owned by `src/router.js`) and with `src/core/supabase-client.js`/`src/core/storage.js` for their own listener installation.
- **Initialization entry point:** Scattered across `init()` and module-level setup (`installRuntimeFatalHandlers()` is called once, guarded by `BootState.runtimeFatalHandlersInstalled`).
- **Public or private:** Private.
- **Dependencies:** `BootState`, `UIComponents` (for the post-boot background-error toast), `ErrorOverlay`.
- **Internal state owned:** `BootState.runtimeFatalHandlersInstalled`, `_postBootRejectionToastAt`.
- **Events consumed:** `error`, `unhandledrejection` (post-boot handling, distinct from the preboot handlers in `index.html`), `resize`, `online`, `offline`, `focus`/`visibilitychange` (for auth/billing recovery, Sections 3/5), `storage` (Sections 3-5).
- **Events emitted:** None new; this section only installs listeners for already-covered custom events (Sections 3-5) plus native browser events.
- **Storage touched:** None directly.
- **BroadcastChannel usage:** None directly.
- **Cross-tab responsibilities:** None directly beyond enabling the `storage`-event-based mechanisms in Sections 3-5.
- **Auth/Billing/Workspace responsibilities:** None owned here; this section is the generic listener-installation layer those sections build on.
- **UI responsibilities:** Post-boot runtime error handling shows either the fatal overlay (for a genuine runtime error) or a background-error toast (for an unhandled rejection after `appReady`), per the `BootState.appReady` gate documented in `app-js-runtime-invariants.md` Section 2.3.
- **Cleanup/teardown behavior:** `installRuntimeFatalHandlers()` has an explicit "install once" guard but no corresponding teardown; listeners persist for the page's lifetime.
- **Extraction difficulty:** **Medium.** The listener installation itself is simple, but several of the handlers (fatal-error handling, in particular) depend on `BootState` timing that is entangled with Section 1 (Initialization/boot).
- **Known coupling:** Coupled to Section 1 (the `appReady` gate) and to Sections 3/5 (the `storage`-event consumers).
- **Known assumptions:** That repeated `init()` calls do not duplicate any of these listeners — confirmed only for the auth listener specifically (Section 3); not independently confirmed for every listener in this category (see `app-js-runtime-invariants.md` Section 8).
- **Unknowns:** Whether every listener installed in this category is guarded against duplicate installation on a hypothetical future retry; not established.

## 10. Keyboard

- **Responsibility:** Global keyboard-shortcut handling for editor and app-wide actions (save, undo/redo, select/deselect all, delete, duplicate, copy/paste, AutoPack, open-pack dialog, grid/shadow toggles, camera focus, dev overlay).
- **Current owner/module:** Exclusive to `src/app.js` (`KeyboardManager`, `src/app.js:4542-4802`).
- **Initialization entry point:** `KeyboardManager.init()` (`initKeyboardManager`, installs the single `document` `keydown` listener) inside the unguarded module-initializer block, `src/app.js:9058`.
- **Public or private:** Private; not on the `TruckPackerApp` facade.
- **Dependencies:** `StateStore`, `CaseScene`, `SceneManager`, `InteractionManager`, `PackLibrary`, `CaseLibrary`, `AutoPackEngine`, `OperationLifecycle`, `UIComponents`, `AppShell`, `Storage`.
- **Internal state owned:** `clipboard` (in-memory copy buffer), the `shortcuts` key-to-handler map.
- **Events consumed:** `keydown` on `document`.
- **Events emitted:** None custom; toasts via `UIComponents.showToast`.
- **Storage touched:** `Storage.saveNow()` on the save shortcut.
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None.
- **Auth responsibilities:** None.
- **Billing responsibilities:** None directly (indirectly gated by whatever `AutoPackEngine.pack()` itself enforces for entitlement, not by `KeyboardManager`).
- **Workspace responsibilities:** None directly.
- **UI responsibilities:** Full owner of shortcut-triggered UI actions (toasts, modal open for "Open Pack", grid/shadow/dev-overlay toggles).
- **Cleanup/teardown behavior:** `clearClipboard()` exists but is not automatically called on any lifecycle transition observed in this file; the `keydown` listener itself has no corresponding removal.
- **Extraction difficulty:** **Medium.** Self-contained as a module (`KeyboardManager` is already a single IIFE-scoped object), but its handler bodies reach directly into editor internals (`CaseScene`, `InteractionManager`, `SceneManager`) rather than going through an editor-owned API, and it directly checks `OperationLifecycle.isBusy()` per the AutoPack/Unpack/Truck-Change mutation-guard contract in `CLAUDE.md`.
- **Known coupling:** Tightly coupled to editor internals (`CaseScene`, `InteractionManager`, `SceneManager`) despite `EditorUI` itself being owned by `src/screens/editor-screen.js`.
- **Known assumptions:** That `mutationBlockedWhileBusy()` correctly gates every mutating shortcut per the operation-lifecycle contract (undo, redo, duplicate, paste are gated; copy, select, deselect, camera focus, and view toggles are intentionally not, per the code comment at `src/app.js:4584-4587`).
- **Unknowns:** Whether a second `initKeyboardManager()` call (hypothetical retry) would install a duplicate `keydown` listener — not established; no explicit guard was found for this specific listener.

## 11. Navigation

- **Responsibility:** Screen routing (hash-based) and screen-transition side effects (sidebar collapse, editor-mode class toggling, screen-specific title/subtitle).
- **Current owner/module:** Shared. Hash-based routing mechanics (`hashchange` listener, route parsing) are owned by `src/router.js` (`Router`). Screen-transition rendering and navigation triggering are owned by `AppShell`, defined inside `src/app.js` (`src/app.js:3544-3651`).
- **Initialization entry point:** `Router.init({...})` (`src/app.js:10151-10167`), called near the end of `init()`; `AppShell.init()` (`initShell`) inside the unguarded module-initializer block (`src/app.js:9049`).
- **Public or private:** Private; `AppShell.navigate` is used internally (for example, by `KeyboardManager`'s "Open Pack" dialog) but is not on the public facade. `Router` itself is a plain module export, not part of `TruckPackerApp`.
- **Dependencies:** `StateStore` (`currentScreen`), `ErrorOverlay` (404/not-found handling), `PackLibrary` (for the "missing pack" check).
- **Internal state owned:** `routeNotFoundActive` (module-scope in `app.js`); `AppShell`'s captured DOM references (`appRoot`, `sidebar`, `navButtons`, etc.).
- **Events consumed:** `hashchange` (owned by `Router`, not `app.js` directly); `resize` (owned by `AppShell`, for sidebar-collapse behavior).
- **Events emitted:** None custom.
- **Storage touched:** None directly.
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None.
- **Auth responsibilities:** None directly.
- **Billing responsibilities:** None directly.
- **Workspace responsibilities:** None directly; `hasMissingEditorPack()` checks `StateStore`/`PackLibrary`, not organization state.
- **UI responsibilities:** Full owner of screen show/hide, sidebar collapse behavior, and route-not-found/missing-pack fallback UI (`syncRecoverableErrorOverlay()`).
- **Cleanup/teardown behavior:** None observed; `Router.init()` is called once per `init()` attempt with no explicit teardown of the previous route state on a hypothetical retry.
- **Extraction difficulty:** **Low-Medium** for `Router` itself (already a separate module); **Medium** for `AppShell`, since it directly captures DOM element references at construction time and is entangled with editor-activation timing (`EditorUI.onActivated` callback, per the facade contract Section 5.2).
- **Known coupling:** `AppShell.renderShell()` directly calls `window.TruckPackerApp.EditorUI.onActivated()` (facade contract Section 5.2), coupling navigation to the editor module's readiness.
- **Known assumptions:** That `AppShell`'s DOM element references, captured once at IIFE construction time, remain valid for the page's lifetime (no re-query on retry).
- **Unknowns:** None beyond the general module-idempotency gap already noted.

## 12. UI orchestration

- **Responsibility:** Coordinating which screen-level UI modules exist, when they are constructed, and when they are initialized/rendered, plus generic UI primitives (toast, modal, confirm, AutoPack loading overlay, dropdowns).
- **Current owner/module:** Shared. `UIComponents` (toast/modal/confirm/etc.) is created via `createUIComponents()` (`src/ui/ui-components.js`) and instantiated by `app.js`. `PacksUI`, `CasesUI` are created via `createPacksScreen()`/`createCasesScreen()` (owned by `src/screens/packs-screen.js`/`src/screens/cases-screen.js`) and instantiated/wired by `app.js`. `UpdatesUI`, `RoadmapUI`, `SettingsUI`, `AppShell` are defined directly inside `app.js`.
- **Initialization entry point:** The block at `src/app.js:9049-9058` (`AppShell.init()` through `KeyboardManager.init()`), inside `init()`'s unguarded region (see `app-js-runtime-invariants.md` Section 2.3 for the significance of that being unguarded).
- **Public or private:** Private, except `TruckPackerApp.ui` (`showToast`, `showModal`, `confirm`) which is a public/compatibility proxy surface (facade contract Section 5.2).
- **Dependencies:** `StateStore`, `PackLibrary`, `CaseLibrary`, `Utils`, `PreferencesManager`.
- **Internal state owned:** Per-module local state (for example, `SettingsUI`'s captured form-element references; `KeyboardManager`'s clipboard).
- **Events consumed:** None uniformly; each module wires its own DOM listeners during its own `.init()`.
- **Events emitted:** None custom at this orchestration layer.
- **Storage touched:** None directly at the orchestration layer (individual screen modules touch storage through their own owned services).
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None directly.
- **Auth responsibilities:** None directly.
- **Billing responsibilities:** None directly (Settings' billing tab consumes `window.__TP3D_BILLING` directly, per the facade contract Section 7.2).
- **Workspace responsibilities:** None directly at this layer.
- **UI responsibilities:** Full owner of which screens exist and their init/render ordering.
- **Cleanup/teardown behavior:** None. This is the exact block whose lack of a local try/catch and lack of teardown is the subject of `app-js-runtime-invariants.md` Sections 2 and 8.
- **Extraction difficulty:** **High**, specifically *because* it is unguarded and uncharacterized for idempotency — this is the block any future retry or modularization work must audit first, per `app-js-runtime-invariants.md` Section 13.
- **Known coupling:** This is the highest-coupling area in the file for extraction purposes: it sits directly in the path between Section 1 (boot/init) and every screen module, and a failure anywhere in it currently aborts the entire boot attempt (Section 1).
- **Known assumptions:** That each `.init()` call in this block is safe to run exactly once per page load; not verified for a second call.
- **Unknowns:** Per-module idempotency for `AppShell`, `PacksUI`, `CasesUI`, `EditorUI`, `UpdatesUI`, `RoadmapUI`, `SettingsUI`, `AccountSwitcher`, `wireGlobalButtons()`, `KeyboardManager` — none of these has confirmed second-call safety. This is the single largest unknown-ownership area in this ledger.

## 13. Scene startup

- **Responsibility:** Three.js scene/runtime construction (camera, renderer, controls, lighting, grid) and the case-instance scene layer built on top of it.
- **Current owner/module:** Shared. `SceneManager` is created via `createSceneRuntime()` (owned by `src/editor/scene-runtime.js`); `CaseScene` is created via `createCaseScene()` (owned by `src/screens/editor-screen.js`). `src/app.js` owns only the instantiation call sites and the wiring of their dependencies (`Utils`, `UIComponents`, `PreferencesManager`, `TrailerGeometry`, `StateStore`, `CaseLibrary`, `PackLibrary`).
- **Initialization entry point:** `SceneManager = createSceneRuntime({...})` (`src/app.js:3656` area) and `CaseScene = createCaseScene({...})` (`src/app.js:3661` area) — both constructed during the synchronous IIFE build, before `init()` is called; actual scene mounting/render-loop start happens later, tied to `EditorUI`'s own activation (owned by `src/screens/editor-screen.js`).
- **Public or private:** Private; neither `SceneManager` nor `CaseScene` is on the `TruckPackerApp` facade.
- **Dependencies:** `THREE`/`OrbitControls` vendor globals (facade contract Section 8.2), `Utils`, `UIComponents`, `PreferencesManager`, `TrailerGeometry`, `StateStore`, `CaseLibrary`, `PackLibrary`.
- **Internal state owned by app.js's usage:** None beyond holding the constructed instances; the scene's own internal state (camera position, render loop) is owned by `scene-runtime.js`/`editor-screen.js`.
- **Events consumed:** None directly by `app.js`; `KeyboardManager` calls into `SceneManager` (grid/shadow toggle, focus, dev overlay) rather than the scene listening for events itself.
- **Events emitted:** None directly by `app.js`.
- **Storage touched:** None directly.
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None.
- **Auth/Billing/Workspace responsibilities:** None directly.
- **UI responsibilities:** None beyond providing the scene surface that `EditorUI`/`AppShell` render into.
- **Cleanup/teardown behavior:** None observed at the `app.js` orchestration layer; teardown, if any, would be internal to `scene-runtime.js`.
- **Extraction difficulty:** **Low** for the `app.js` portion specifically (it is a thin factory call with a dependency-injection object), since the substantial logic already lives outside `app.js`.
- **Known coupling:** `KeyboardManager` (Section 10) reaches directly into `SceneManager`/`CaseScene`, which is the main coupling risk if `app.js`'s wiring were extracted without also addressing that reach-through.
- **Known assumptions:** That constructing `SceneManager`/`CaseScene` once at module-load time (not per `init()` call) is safe and does not need to be repeated on retry.
- **Unknowns:** None identified at the `app.js` orchestration layer.

## 14. Editor startup

- **Responsibility:** The `EditorUI` screen module — case placement UI, AutoPack/Unpack/Truck-Change controls, editor activation/deactivation lifecycle.
- **Current owner/module:** Owned by `src/screens/editor-screen.js` (`createEditorScreen`, `createInteractionManager`, `createCaseScene`). `src/app.js` owns only the instantiation call site, the facade exposure (`TruckPackerApp.EditorUI`), and the activation trigger from `AppShell.renderShell()`.
- **Initialization entry point:** `EditorUI.init()` inside the unguarded module-initializer block (`src/app.js:9052`); `EditorUI.onActivated()`/`onDeactivated()` triggered by `AppShell.renderShell()` on screen transitions (facade contract Section 5.2).
- **Public or private:** Public/compatibility (`TruckPackerApp.EditorUI`, per the facade contract — current surface: `init`, `render`, `onActivated`, `onDeactivated`).
- **Dependencies:** `SceneManager`, `CaseScene`, `InteractionManager` (Section 13), `StateStore`, `PackLibrary`, `CaseLibrary`, `OperationLifecycle`, `AutoPackEngine`, `TruckChangeController`.
- **Internal state owned by app.js's usage:** None beyond holding the instance and exposing it on the facade; `EditorUI`'s own internal state is owned by `editor-screen.js`.
- **Events consumed:** None directly by `app.js`'s wiring beyond the activation trigger above.
- **Events emitted:** None directly by `app.js`'s wiring.
- **Storage touched:** None directly at the `app.js` orchestration layer.
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None directly.
- **Auth responsibilities:** None directly.
- **Billing responsibilities:** None directly at this layer (AutoPack's own entitlement check is inside `src/services/autopack-engine.js`, per the facade contract Section 7.2).
- **Workspace responsibilities:** None directly at this layer.
- **UI responsibilities:** This is *the* editor UI; `app.js` only orchestrates its lifecycle timing relative to navigation (Section 11).
- **Cleanup/teardown behavior:** None owned by `app.js`; any teardown on deactivation is internal to `editor-screen.js`'s `onDeactivated()`.
- **Extraction difficulty:** **Low** for the `app.js` portion (already a thin factory instantiation and facade pass-through); the substantial logic already lives in `editor-screen.js`.
- **Known coupling:** `EditorUI` is the one screen-level dependency explicitly called out as a "live compatibility dependency" in the PREP-2 facade contract (Section 5.2), because `AppShell` calls into it directly rather than through an abstraction.
- **Known assumptions:** That `EditorUI.init()` is safe to call exactly once; per the TRIAGE-3D-B dynamic characterization, `EditorUI.init` is specifically the point used to inject and observe an unexpected-failure scenario, precisely because it is externally reachable via the facade — its own idempotency on a genuine second call was not established by that characterization (only that the *suppressed* retry never calls it again).
- **Unknowns:** Whether `EditorUI.init()` (the real implementation, not a test double) is idempotent — not established.

## 15. Settings

- **Responsibility:** Preferences form (units, theme, label size, hidden-case opacity, snapping, screenshot resolution, PDF stats) and the broader Settings overlay (organization/members/invites/billing tabs).
- **Current owner/module:** Shared. The preferences mini-form (`SettingsUI`) is defined directly inside `src/app.js` (`src/app.js:4470-4537`). The full Settings overlay (org-scoped rendering, members, invites, billing tab UI) is owned by `src/ui/overlays/settings-overlay.js` (`createSettingsOverlay`), instantiated and wired by `app.js`.
- **Initialization entry point:** `SettingsUI.init()` inside the unguarded module-initializer block (`src/app.js:9055`); `SettingsOverlay` instantiation happens earlier, during the synchronous IIFE build; `SettingsUI.loadForm()` is called both during `init()`'s `renderAll()` and separately when the preferences tab is opened.
- **Public or private:** Private; neither `SettingsUI` nor `SettingsOverlay` is on the `TruckPackerApp` facade (Settings communicates with `app.js` via feature-detected callback members like `handleWorkspaceArchived`/`handleWorkspaceRestored`/`handleWorkspaceUpdated`/`openCreateWorkspaceFlow`, per the facade contract Section 5.2).
- **Dependencies:** `PreferencesManager`, `Storage`, `UIComponents`, `window.__TP3D_BILLING` (Settings' own billing tab, per facade contract Section 7.2), `OrgContext`.
- **Internal state owned:** `SettingsUI`'s captured form-element references; `SettingsOverlay`'s own internal state (owned by `settings-overlay.js`, not `app.js`).
- **Events consumed:** `tp3d:profile-updated` is produced by `settings-overlay.js`, not consumed by `app.js` (no confirmed repository consumer, per the facade contract Section 10.1).
- **Events emitted:** None by `SettingsUI` itself; `SettingsOverlay` (owned elsewhere) is the producer of `tp3d:profile-updated`.
- **Storage touched:** `tp3d:settings:activeTab` (owned by Settings, per the facade contract Section 12.1); `SettingsUI.save()` persists preferences via `PreferencesManager.set()`.
- **BroadcastChannel usage:** None directly by `SettingsUI`.
- **Cross-tab responsibilities:** None owned by the `app.js` portion.
- **Auth responsibilities:** `SettingsOverlay.handleAuthChange()` is called from `app.js`'s auth-state rendering (Section 3) so Settings can react to sign-out.
- **Billing responsibilities:** None owned by the `app.js` portion of Settings; the overlay reads `window.__TP3D_BILLING` directly.
- **Workspace responsibilities:** `SettingsOverlay` renders org-scoped member/invite/billing UI; `app.js` exposes `handleWorkspaceArchived`/`handleWorkspaceRestored`/`handleWorkspaceUpdated` as feature-detected callbacks Settings uses after workspace lifecycle operations (facade contract Section 5.4).
- **UI responsibilities:** `SettingsUI` is the preferences-form UI; `SettingsOverlay` is the larger overlay UI (owned elsewhere).
- **Cleanup/teardown behavior:** None owned by `app.js` beyond the reset-demo-data path (`Storage.clearAll()` + `window.location.reload()`).
- **Extraction difficulty:** **Low** for `SettingsUI` (small, self-contained, only touches `PreferencesManager`/`Storage`/`UIComponents`); **not applicable** for `SettingsOverlay` since its implementation already lives outside `app.js` — only its wiring/feature-detected callbacks are in scope here.
- **Known coupling:** The unresolved facade members `handleWorkspaceLeft` and `handleOwnershipTransferred` (PREP-2 facade contract Section 5.4) are specifically Settings-adjacent — Settings feature-detects them and falls back to a generic refresh when absent.
- **Known assumptions:** None beyond what PREP-2 already documents for the unresolved facade members.
- **Unknowns:** None beyond the PREP-2-documented unresolved facade members.

## 16. Account switching

- **Responsibility:** The account/workspace switcher UI (listing available organizations, initiating a workspace switch, refreshing its own display on auth/org changes).
- **Current owner/module:** Exclusive to `src/app.js` (`AccountSwitcher`, `src/app.js:3050-3230`).
- **Initialization entry point:** `AccountSwitcher.init()` (`initAccountSwitcher`) inside the unguarded module-initializer block (`src/app.js:9056`).
- **Public or private:** Private; not on the `TruckPackerApp` facade. Exposed diagnostically via `getAccountSwitcher()` (`src/app.js:2541`).
- **Dependencies:** `OrgContext`/organization state (Section 4), `SupabaseClient` (account bundle), `UIComponents`.
- **Internal state owned:** Its own bound-UI state (dropdown open/closed, rendered org list); scoped inside its own IIFE.
- **Events consumed:** Reacts to organization-change signals (called from the same code paths that dispatch `tp3d:org-changed`, per Section 4) via its `refresh()` method, invoked at several call sites (`src/app.js:2790-2791`, `7233-7234`, and the signed-out cleanup path).
- **Events emitted:** None custom.
- **Storage touched:** None directly.
- **BroadcastChannel usage:** None directly.
- **Cross-tab responsibilities:** None directly; it reflects organization state that Section 4 already synchronized.
- **Auth responsibilities:** `refresh()` is called as part of the auth-state rendering path (`renderAuthState()`, Section 3) and signed-out cleanup.
- **Billing responsibilities:** None directly.
- **Workspace responsibilities:** Initiates workspace switches; does not own the switch-ordering guard itself (that is Section 4).
- **UI responsibilities:** Full owner of its own dropdown/list UI and the "switch workspace" error toast (`console.error('[AccountSwitcher] Failed to switch workspace:', err)`).
- **Cleanup/teardown behavior:** None observed beyond being re-refreshed (not re-initialized) on relevant transitions.
- **Extraction difficulty:** **Medium.** Self-contained as a module, but its `refresh()` calls are threaded through multiple unrelated call sites (auth rendering, org-change handling, signed-out cleanup) rather than being driven by a single subscription.
- **Known coupling:** Coupled to Section 4 (organization state) and Section 3 (auth-state rendering) as a consumer of both.
- **Known assumptions:** That calling `refresh()` multiple times from different call paths is safe (implied by the current fan-out pattern, not separately guarded).
- **Unknowns:** Whether `initAccountSwitcher()` itself is safe to call a second time — not established (same category as the rest of Section 12's unguarded block).

## 17. Error handling

- **Responsibility:** Non-fatal recoverable-error UI (404/route-not-found, missing-pack) and post-boot runtime error/rejection handling (distinct from the pre-boot handlers and from the fatal-overlay path in Section 18).
- **Current owner/module:** Shared. `ErrorOverlay` itself (`showNotFound`, `showFatal`, `showMaintenance`, `hide`) is owned by `src/ui/error-overlay.js`; `src/app.js` owns the decision logic for *when* to show which state (`syncRecoverableErrorOverlay()`, `src/app.js:5226-5237`) and the post-boot runtime handlers (`installRuntimeFatalHandlers()`, Section 9).
- **Initialization entry point:** `syncRecoverableErrorOverlay()` is called from `renderAll()` and from the `StateStore` subscription (Section 2); `installRuntimeFatalHandlers()` is called once during the outer boot IIFE, guarded by `BootState.runtimeFatalHandlersInstalled`.
- **Public or private:** Private.
- **Dependencies:** `ErrorOverlay`, `StateStore`, `PackLibrary`, `Router` (route-not-found signal), `BootState`.
- **Internal state owned:** `routeNotFoundActive`.
- **Events consumed:** `window` `error`/`unhandledrejection` (post-boot); `Router`'s `onNotFound`/`onNeutral` callbacks (Section 11).
- **Events emitted:** None custom.
- **Storage touched:** None directly.
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None.
- **Auth/Billing/Workspace responsibilities:** None directly.
- **UI responsibilities:** Full owner of when the recoverable (non-fatal) error overlay states are shown or hidden.
- **Cleanup/teardown behavior:** `ErrorOverlay.hide()` is the "clear" path, called whenever neither `routeNotFoundActive` nor `hasMissingEditorPack()` applies; guarded from firing while `BootState.fatalOverlayShown` or `BootState.maintenanceMode` is true.
- **Extraction difficulty:** **Medium.** The decision function itself is small and self-contained, but it depends on `Router`, `PackLibrary`, and `StateStore` state simultaneously.
- **Known coupling:** Coupled to Section 11 (navigation, for route-not-found) and Section 2 (runtime state, for missing-pack detection).
- **Known assumptions:** That `BootState.fatalOverlayShown`/`maintenanceMode` correctly suppress recoverable-error UI so the two overlay systems never fight for visibility.
- **Unknowns:** None identified.

## 18. Fatal overlay coordination

- **Responsibility:** Deciding when an unexpected condition is fatal, and driving the single "Something went wrong" fatal overlay to visibility exactly once.
- **Current owner/module:** Shared. The overlay rendering itself (`showFatal`) is owned by `src/ui/error-overlay.js`; `src/app.js` owns the fatal-decision logic (`showFatalOverlay()`, `src/app.js:2170-2177`) and every call site that triggers it: `boot()`'s `.catch()` (`src/app.js:10233-10236`), the preboot-adjacent post-boot runtime handlers (Section 9), and the Supabase-config-invalid early-return paths inside `init()` (`app-js-runtime-invariants.md` Section 2.3).
- **Initialization entry point:** No separate initialization; `showFatalOverlay()` is a plain function called reactively from the sites above.
- **Public or private:** Private.
- **Dependencies:** `BootState`, `ErrorOverlay`.
- **Internal state owned:** `BootState.fatalOverlayShown` (also readable/writable from `index.html`'s preboot script, per the facade contract Section 8.2 — this is genuinely shared state, not exclusive to `app.js`).
- **Events consumed:** The rejection from `TruckPackerApp.init()`'s promise (via `boot()`'s `.catch()`); post-boot `error`/`unhandledrejection` events (Section 9).
- **Events emitted:** None custom.
- **Storage touched:** None directly.
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None; the fatal overlay is a single-tab, single-page concern.
- **Auth/Billing/Workspace responsibilities:** None directly.
- **UI responsibilities:** Full owner of triggering the fatal overlay's *appearance*; the overlay's own rendering and "Reload" action are owned by `src/ui/error-overlay.js`.
- **Cleanup/teardown behavior:** **None.** There is no code path that clears `BootState.fatalOverlayShown` other than a full page reload (which resets the module instance entirely). This is documented as an explicit hazard in `app-js-runtime-invariants.md` (Sections 2.4 and 13).
- **Extraction difficulty:** **Medium.** Small in code size, but its correctness depends on the exact `BootState.appReady` timing established by Section 1 — extracting it without Section 1 risks breaking the pre-boot/post-boot handoff documented in the facade contract Section 8.2.
- **Known coupling:** Tightly coupled to Section 1 (initialization) and Section 9 (window events); also to `index.html`'s preboot script, which reads/writes the same `BootState.fatalOverlayShown` field.
- **Known assumptions:** That `BootState.fatalOverlayShown` being read/written from two different script contexts (preboot `index.html` script and the `app.js` module) never races in a way that shows two conflicting overlays — not stress-tested, but the guard (`if (variant === 'fatal') { if (boot.fatalOverlayShown) return; ... }` in the preboot script, and the equivalent check in `showFatalOverlay()`) is symmetric on both sides.
- **Unknowns:** None beyond the already-documented reload-only recovery hazard.

## 19. Recovery

- **Responsibility:** What happens after a degraded or fatal state — the actual recovery mechanisms available to the user or to code.
- **Current owner/module:** Shared, and thin. `src/app.js` provides `onRetry` callbacks for its own degraded auth/config states (`bootstrapAuthGate`, the Supabase-config-invalid paths); the only recovery mechanism for a fatal state is `window.location.reload()`, wired from `src/ui/error-overlay.js`'s `showFatal()` button and, identically, from `index.html`'s preboot `showAppStatusOverlay()`.
- **Initialization entry point:** N/A — recovery is user-triggered (button click) or, for degraded-auth retry, re-entrant through `bootstrapAuthGate` itself.
- **Public or private:** Private.
- **Dependencies:** `ErrorOverlay`/`SystemOverlay`, `AuthOverlay`.
- **Internal state owned:** None beyond what Sections 1 and 18 already own.
- **Events consumed:** DOM `click` on the relevant overlay's action button.
- **Events emitted:** None.
- **Storage touched:** None directly (a reload naturally re-reads whatever storage state already exists).
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None.
- **Auth/Billing/Workspace responsibilities:** None directly; degraded-auth retry (`bootstrapAuthGate`'s `onRetry`) is the one recovery path that re-attempts a specific subsystem rather than reloading the whole page.
- **UI responsibilities:** Presents the retry/reload action; does not itself decide when to show it (Sections 17-18 own that decision).
- **Cleanup/teardown behavior:** **None**, other than what a full reload provides for free. This is the central fact `app-js-runtime-invariants.md` records as an intentional reload-only contract, not an accidental gap, for the fatal case specifically.
- **Extraction difficulty:** **Low** for the mechanism itself (a single `window.location.reload()` call, duplicated in two places); **High** if the goal were ever to replace it with in-process retry, because that would require the module-idempotency audit flagged throughout Sections 12/14/16.
- **Known coupling:** Directly coupled to Section 18 (what counts as fatal) and Section 1 (what state a reload resets).
- **Known assumptions:** That reload-only recovery is acceptable for the fatal case; PREP-3/TRIAGE-3D-B examined and did not overturn this assumption.
- **Unknowns:** None beyond what Sections 1/12/14/16/18 already flag.

## 20. Global facade

- **Responsibility:** The three preserved browser-global facades App.js is responsible for assembling: `window.TruckPackerApp`, `window.OrgContext`, `window.__TP3D_BILLING`.
- **Current owner/module:** Exclusive to `src/app.js` for construction and assignment; already fully catalogued (members, classification, timing, mutation rules) in the PREP-2 facade contract, which this ledger does not duplicate.
- **Initialization entry point:** See PREP-2 facade contract Section 13 (initialization sequence contract) for exact ordering.
- **Public or private:** Public (all three are the "Public"/"Compatibility" classifications defined in the facade contract).
- **Dependencies:** Effectively all other sections in this ledger feed into one of these three facades.
- **Internal state owned:** N/A — see the facade contract for the authoritative member-by-member listing.
- **Events consumed / emitted / Storage touched / BroadcastChannel usage:** See the facade contract Sections 10-12 for the full catalogue; not repeated here to avoid drift between two documents describing the same surface.
- **Cross-tab / Auth / Billing / Workspace / UI responsibilities:** Distributed across Sections 3-6, 11-16 above; the facade itself is an assembly point, not an independent responsibility owner.
- **Cleanup/teardown behavior:** None; see Section 1 for the initialization-attempt-level teardown gap.
- **Extraction difficulty:** **High.** By definition, extracting any facade member changes a browser-visible compatibility surface — see the PREP-2 facade contract's explicit non-goals (Section 2) and modularization preservation gates (Section 16) before any change here.
- **Known coupling:** Maximal — this is the aggregation point for nearly every other section in this ledger.
- **Known assumptions / Unknowns:** See the facade contract Section 5.4 for the two explicitly unresolved facade members (`handleWorkspaceLeft`, `handleOwnershipTransferred`) and Section 9.3 for unresolved legacy probes.

## 21. Diagnostics

- **Responsibility:** Debug tooling (`window.__TP3D_DIAG__`), developer helpers (`window.TP3D.helpers`, `installDevHelpers`), and diagnostic-only globals (`window.__TP3D_WRAPPER_DETECTIVE__`, `window.__TP3D_ORG_METRICS__`, `window.__TP3D_BILLING_TRACE_CURRENT_ID__`, `window.getBillingState` debug alias).
- **Current owner/module:** Shared. `initTP3DDebugger()` is owned by `src/debugger.js`, called once at module top-level (`src/app.js:100`) before the outer boot IIFE even starts. `installDevHelpers` is owned by `src/core/dev/dev-helpers.js`, called inside `init()` (`src/app.js:8285`). `window.TP3D.helpers` is owned by `src/core/app-helpers.js`. The diagnostic globals themselves (`__TP3D_ORG_METRICS__`, `__TP3D_BILLING_TRACE_CURRENT_ID__`, `getBillingState` alias) are set directly by `src/app.js`.
- **Initialization entry point:** `initTP3DDebugger()` (module top-level, before boot); `installDevHelpers(...)` (inside `init()`, `src/app.js:8285`, immediately after the `validateRuntime()` gate).
- **Public or private:** Diagnostic classification throughout (per the facade contract Section 9.2) — visible but explicitly not product authority.
- **Dependencies:** Varies by surface; `installDevHelpers` receives `{ app: window.TruckPackerApp, stateStore: StateStore, Utils, documentRef: document }`.
- **Internal state owned:** `window.__TP3D_ORG_METRICS__` (live counters, `src/app.js:5652` area), `window.__TP3D_BILLING_TRACE_CURRENT_ID__`, debug-only `window.getBillingState` alias (`src/app.js:2023` area).
- **Events consumed:** `src/debugger.js`'s own diagnostic event recording (owned there, not by `app.js`).
- **Events emitted:** None new by `app.js`'s diagnostic wiring itself.
- **Storage touched:** `tp3dDebug`, `tp3dForceTrial`, `tp3dDevUserPlanOverride`, `tp3dDiagPersist` (per the facade contract Section 12.4); `window.__TP3D_DIAG_PERSIST_KEY__` when diagnostic persistence is enabled.
- **BroadcastChannel usage:** None directly.
- **Cross-tab responsibilities:** None.
- **Auth/Billing/Workspace responsibilities:** None owned; diagnostics may *observe* these (billing trace wrapping, org metrics) but must remain non-authoritative per the facade contract Section 9.2.
- **UI responsibilities:** None beyond optional debug toasts gated by `tp3dDebug`/`debugEnabled()` checks scattered through `init()`.
- **Cleanup/teardown behavior:** None observed.
- **Extraction difficulty:** **Low** for the diagnostic surfaces already owned elsewhere (`debugger.js`, `app-helpers.js`, `dev-helpers.js`); **Medium** for the App.js-local diagnostic globals (`__TP3D_ORG_METRICS__`, billing trace ID), since they are read from inside otherwise-exclusive App.js logic (Sections 4-5).
- **Known coupling:** Diagnostic wrappers may wrap `maybeScheduleBillingRefresh()` and `refreshBilling` in place (facade contract Sections 5.3, 7.3); any future extraction must preserve wrapper transparency (`this`, arguments, return value, async behavior, errors).
- **Known assumptions:** That diagnostic wrapping never becomes authoritative — an explicit rule in the facade contract, not merely an assumption of this ledger.
- **Unknowns:** None beyond what the facade contract's Section 9.3 (legacy/unresolved probes) already flags.

## 22. Feature flags

- **Responsibility:** Maintenance-mode gating and the small set of localStorage-based behavioral flags read directly by `app.js`.
- **Current owner/module:** Shared. `window.__TP3D_FLAGS__` (`{ maintenanceMode }`) is created by `index.html`; `src/app.js` reads it once, in `boot()` (`src/app.js:10226`), to skip normal boot entirely when maintenance mode is active. `localStorage.tp3dDebug` and related debug-flag reads (Section 21) are scattered through `app.js` at the individual functions that consult them (for example, `debugEnabled()` inside `init()`, `src/app.js:8296-8302`).
- **Initialization entry point:** Checked at the very start of `boot()`, before `TruckPackerApp.init()` is even called.
- **Public or private:** `window.__TP3D_FLAGS__` itself is set by `index.html`, outside `app.js`'s ownership; `app.js` is a read-only consumer.
- **Dependencies:** None beyond the global itself.
- **Internal state owned:** None; `app.js` does not own or mutate `window.__TP3D_FLAGS__`.
- **Events consumed:** None.
- **Events emitted:** None.
- **Storage touched:** `localStorage.tp3dDebug` (read, not written, by `app.js`'s own `debugEnabled()`/`isTp3dDebugEnabled()` helpers).
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** None; maintenance mode is not synchronized across tabs by `app.js`.
- **Auth/Billing/Workspace responsibilities:** None.
- **UI responsibilities:** When maintenance mode is active, `boot()` returns immediately without ever showing the app's own UI — the maintenance UI itself is shown by `index.html`'s own preboot script (`boot.showAppStatusOverlay('maintenance')`), not by `app.js`.
- **Cleanup/teardown behavior:** N/A.
- **Extraction difficulty:** **Low.** A single read at a single call site for maintenance mode; the debug-flag reads are simple, repeated, read-only checks with no shared mutable state.
- **Known coupling:** Minimal; this is one of the least-coupled areas in the ledger.
- **Known assumptions:** That `window.__TP3D_FLAGS__.maintenanceMode` does not change after page load (it is read once, at boot, not subscribed to).
- **Unknowns:** None identified.

## 23. Timers

- **Responsibility:** `setTimeout`/`setInterval` usage for retry backoff, debounce/throttle-style gating, and bounded wait windows (billing lock retry, workspace-switch timeout, org-persist cooldown, invite-handoff notice scheduling, background-error toast dedup window).
- **Current owner/module:** Exclusive to `src/app.js` for the timers it schedules directly; the underlying `window.setTimeout`/`setInterval` primitives are native.
- **Initialization entry point:** Scattered — each timer is scheduled at the point its owning responsibility needs it (for example, the billing cross-tab-lock retry timer inside `refreshBilling()`, Section 5; the `workspaceSwitchTimer` bound inside the workspace-switch handler, Section 4).
- **Public or private:** Private in every case observed.
- **Dependencies:** Whatever state the specific timer is protecting (billing epoch, workspace-switch version, etc.).
- **Internal state owned:** `workspaceSwitchTimer` (Section 4), the retry `setTimeout` inside `refreshBilling()`'s cross-tab-lock path (Section 5), `_postBootRejectionToastAt` (Section 9), `scheduleInviteHandoffNoticeRender()`'s fixed-delay schedule (`[0, 250, 1000, 2500]`, inside `init()`'s invite-token handling).
- **Events consumed:** None directly; timers are scheduled, not event-driven.
- **Events emitted:** None directly.
- **Storage touched:** None directly by the timer mechanism itself.
- **BroadcastChannel usage:** None.
- **Cross-tab responsibilities:** The billing cross-tab-lock retry timer (Section 5) and the workspace-switch timeout (Section 4) both exist specifically to bound cross-tab coordination windows.
- **Auth/Billing/Workspace responsibilities:** Distributed across Sections 3-5 depending on which timer.
- **UI responsibilities:** None directly; timers trigger state changes that other sections render.
- **Cleanup/teardown behavior:** `clearWorkspaceSwitchTimer()` exists for the workspace-switch timer (Section 4); the billing retry timer and the invite-notice schedule are self-terminating (fire-once) rather than explicitly cleared. No global "clear all timers" teardown exists for a failed `init()` attempt — timers scheduled before a fatal failure continue to fire afterward.
- **Extraction difficulty:** **Low** individually (each timer is local to the responsibility that owns it); **Medium** in aggregate, because there is no single timer registry to audit — confirming "no orphaned timers after a failure" requires checking each owning section individually.
- **Known coupling:** Coupled 1:1 to whichever section owns each timer (Sections 4, 5, 9).
- **Known assumptions:** That timers scheduled before a fatal `init()` failure are harmless to let fire (they check current state, such as `_billingEpoch`, before acting) rather than needing explicit cancellation.
- **Unknowns:** Whether every timer in the file follows the same "check current state before acting" safety pattern was not exhaustively verified for this ledger; only the ones cited above were directly confirmed.

## 24. Async coordination

- **Responsibility:** General async-safety patterns used across the file beyond the specific single-flight cases in Section 25 — epoch/generation-style staleness checks, `Promise.race` timeout wrapping, and queued-waiter resolution.
- **Current owner/module:** Exclusive to `src/app.js` for its own coordination code; the pattern itself (capture context, re-validate before commit) is also used independently inside `src/core/supabase-client.js` (Section 3, DEF-009).
- **Initialization entry point:** N/A — this is a cross-cutting pattern, not a single initialized subsystem.
- **Public or private:** Private.
- **Dependencies:** Whatever state each instance of the pattern protects (Sections 3-6).
- **Internal state owned:** `_authEpoch`-equivalent for App.js's own domains: `_billingEpoch` (Section 5), `_billingActionGeneration` (Section 6), `orgContextVersion`/`lastAppliedOrgContextVersion` and `lastAppliedWorkspaceSwitchOrder` (Section 4).
- **Events consumed:** None uniformly.
- **Events emitted:** None uniformly.
- **Storage touched:** None directly by the coordination pattern itself.
- **BroadcastChannel usage:** None directly.
- **Cross-tab responsibilities:** The epoch/generation pattern is what makes the cross-tab guards in Sections 4-6 possible.
- **Auth/Billing/Workspace responsibilities:** Distributed; this section documents the shared *pattern*, not a fourth independent subsystem.
- **UI responsibilities:** None directly.
- **Cleanup/teardown behavior:** Epoch/generation counters are never reset to zero (only incremented); this is intentional — a monotonically increasing counter is what makes "is this still current" comparisons safe without needing to clear anything.
- **Extraction difficulty:** **Not independently extractable** — this is a pattern repeated across Sections 3-6, not a standalone module. Extracting it as a shared utility (as opposed to leaving each instance local to its owning section) would be an architecture change, which this ledger does not recommend.
- **Known coupling:** By nature, coupled to every section that uses the pattern (3, 4, 5, 6).
- **Known assumptions:** That each instance of the pattern is implemented consistently enough to reason about together, even though there is currently no shared implementation (each of Sections 3, 5, and 6 has its own separate capture/compare code, confirmed by direct reading of each).
- **Unknowns:** None beyond what is already noted per-section.

## 25. Single-flight operations

- **Responsibility:** Preventing duplicate concurrent work for the same logical operation.
- **Current owner/module:** Exclusive to `src/app.js` for `initInFlightPromise` (Section 1) and the billing cross-tab lock/in-flight-authoritative-refresh checks (Section 5); shared with `src/core/supabase-client.js` for the auth-side single-flight primitives (`getUserRawSingleFlight`, `getUserSingleFlight`, `getSessionSingleFlight`, `getAccountBundleSingleFlight`) that `app.js` consumes but does not implement.
- **Initialization entry point:** N/A — single-flight guards are checked at the start of each guarded function, not separately initialized.
- **Public or private:** Private in every `app.js`-owned instance.
- **Dependencies:** Whatever state each single-flight guard protects.
- **Internal state owned:** `initInFlightPromise` (Section 1); `_acquiredCrossTabLock`/lock bookkeeping and `isBillingAuthoritativeRefreshInFlight`/`beginBillingAuthoritativeRefreshAttempt` state (Section 5); `inviteAcceptInFlight` (invite-token acceptance, inside `init()`).
- **Events consumed:** None directly.
- **Events emitted:** None directly.
- **Storage touched:** `billing:inflight:{orgId}` (Section 5) is the one single-flight indicator that is itself persisted to storage, so other tabs can observe it.
- **BroadcastChannel usage:** None directly (the billing in-flight indicator is storage-based, not broadcast).
- **Cross-tab responsibilities:** The billing in-flight lock (Section 5) is explicitly cross-tab; `initInFlightPromise` (Section 1) is explicitly single-tab/single-page.
- **Auth/Billing/Workspace responsibilities:** Distributed; see Sections 3-5.
- **UI responsibilities:** None directly.
- **Cleanup/teardown behavior:** `initInFlightPromise` is reset to `null` unconditionally in `init()`'s `.finally()` (Section 1); the billing in-flight lock has its own release path inside `refreshBilling()`'s completion handling. `inviteAcceptInFlight` is reset in a `finally` block (`src/app.js:8714-8716`).
- **Extraction difficulty:** **Low** for the pattern itself (each guard is a simple boolean/promise check); **High** for `initInFlightPromise` specifically, because it is entangled with the unresolved retry-safety question in Sections 1/12.
- **Known coupling:** `initInFlightPromise` is coupled to Section 12's unguarded module-initializer block; the billing in-flight lock is coupled to Section 5's broader refresh logic.
- **Known assumptions:** That `initInFlightPromise` correctly prevents concurrent duplicate `init()` execution (confirmed) but does not, and is not intended to, prevent a *sequential* second call after settlement (that is `initCompleted`'s job, per Section 1 and `app-js-runtime-invariants.md`).
- **Unknowns:** None beyond what Section 1 already documents.

## Summary: shared vs. exclusive ownership

**Exclusive to `src/app.js`** (logic, not just wiring, lives in the file): initialization/boot orchestration (Section 1), auth-state UI reaction and profile checks (Section 3, though session/token mechanics are `supabase-client.js`'s), organization/workspace context and its DEF-010 guard (Section 4), billing state refresh (Section 5), checkout/portal action guards (Section 6, DEF-011), `tp3d-billing` BroadcastChannel (Section 8), keyboard shortcuts (Section 10), `AppShell`/navigation-transition logic (Section 11, though `Router` itself is separate), the `SettingsUI` preferences mini-form (Section 15), account switching (Section 16), fatal-overlay trigger logic (Section 18), the three global facades' assembly (Section 20), and the async-coordination/single-flight patterns local to the above (Sections 24-25).

**Shared / orchestrated** (implementation lives elsewhere; `src/app.js` instantiates, wires, and times it): runtime state via `StateStore` (Section 2), Supabase session/token mechanics (Section 3), general storage persistence mechanics (Section 7), most window-event listener installation for already-externally-owned mechanisms (Section 9), `Router`'s hash-routing mechanics (Section 11), most UI screen modules — `PacksUI`, `CasesUI`, `EditorUI`, and the `UIComponents` primitives (Section 12), scene/case-scene construction (Section 13), `EditorUI` itself (Section 14), the full `SettingsOverlay` (Section 15), the fatal overlay's own rendering (Section 18), diagnostics tooling (Section 21), and feature-flag state itself (`window.__TP3D_FLAGS__`, owned by `index.html`, Section 22).

## Highest-coupling areas likely to require coordinated extraction

1. **Section 12 (UI orchestration) together with Section 1 (Initialization/boot).** This is the single riskiest coupling in the file: the unguarded module-initializer block (`src/app.js:9049-9058`) sits directly inside the boot attempt, so a failure in any one screen module currently aborts the entire boot, and none of the individual initializers has confirmed second-call idempotency. Any future work touching either area must treat them as one unit.
2. **Section 5 (Billing refresh) together with Section 4 (Organization/Workspace).** Every billing refresh is bound to the active organization; extracting billing without also carrying its organization-binding guard (or vice versa) would silently break the DEF-010/Section-5 staleness protections.
3. **Section 3 (Auth) together with Sections 4, 5, and 7 (Organization, Billing, Storage).** Sign-out cleanup (`_executeSignedOutCleanup()`) is a single function that reaches into all four areas at once; it is the clearest example in the file of one responsibility's teardown needing to coordinate several others' state simultaneously.
4. **Section 10 (Keyboard) reaching into Section 13/14 (Scene/Editor startup).** `KeyboardManager` calls `CaseScene`/`SceneManager`/`InteractionManager` methods directly rather than through `EditorUI`'s own facade surface, even though `EditorUI` is the module that actually owns editor lifecycle.
5. **Section 18 (Fatal overlay) together with Section 1 (Initialization/boot) and `index.html`'s preboot script.** `BootState.fatalOverlayShown`/`appReady` are read and written from two separate script contexts (the `index.html` preboot script and the `app.js` module); their symmetric guards must stay in lockstep across any future change to either side.
6. **Section 6 (Checkout/Portal) sharing its generation counter across two functions.** Lower coupling risk than the above, but still notable: `startCheckout()` and `openPortal()` are independent call sites unified only by one shared module-scope variable (`_billingActionGeneration`); any extraction must keep them together or explicitly redesign the shared-generation contract.

## Unknown ownership areas

- **Per-module idempotency for the entire unguarded initializer block** (Section 12): `AppShell`, `PacksUI`, `CasesUI`, `EditorUI`, `UpdatesUI`, `RoadmapUI`, `SettingsUI`, `AccountSwitcher`, `wireGlobalButtons()`, `KeyboardManager` — whether any of these is safe to invoke a second time on an already-partially-initialized page is not established by current code or tests, beyond the one confirmed exception (the Supabase auth listener's explicit `authListenerInstalled` guard, which is not itself one of these ten calls).
- **Whether every listener installed under Section 9 (Window events) is guarded against duplicate installation** — only the auth listener (Section 3) and the runtime-fatal-handler installation (`BootState.runtimeFatalHandlersInstalled`, Section 9) have confirmed explicit guards; the rest were not individually audited for this ledger.
- **Whether every timer (Section 23) follows the "check current state before acting" safety pattern** — confirmed for the ones cited (billing retry, workspace-switch timeout) but not exhaustively verified across the whole file.
