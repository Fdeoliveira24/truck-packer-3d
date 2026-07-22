# App.js Public Facade and Compatibility Contract

**Status:** PREP-2 controlling contract

**Scope:** Current browser-global, event, messaging, and storage compatibility surfaces

**Behavioral baseline:** DEF-001 through DEF-008 completed before PREP-2

**Change policy:** `docs/engineering/app-js-preparation-change-policy.md`

## 1. Purpose

This document defines the browser-visible contracts that future `src/app.js` preparation and modularization work must preserve. It records the current runtime boundaries, their ownership and timing, and the compatibility obligations that exist outside ordinary module imports.

This is a preservation contract. It does not authorize a facade correction, runtime change, module extraction, initialization reorder, global rename, or consolidation of independently owned facades.

The approved PREP-2 investigation established that the application does not expose one unified browser API. It exposes several intentionally separate facades, plus compatibility, internal, diagnostic, vendor, and test-only surfaces. Events, storage keys, and BroadcastChannel messages are also cross-module or cross-tab contracts.

## 2. Non-goals

This document does not:

- change or reinterpret current behavior;
- define a module extraction order;
- authorize moving code out of `src/app.js`;
- add or remove any facade member;
- merge billing into `window.TruckPackerApp`;
- rename or merge browser globals;
- change script or initialization order;
- promote internal, diagnostic, or test-only surfaces to public APIs;
- remove legacy storage or messaging compatibility;
- resolve the known Leave Workspace or Ownership Transfer facade question.

## 3. Contract classifications

Every surface in this document has one of the following classifications:

| Classification | Meaning |
|---|---|
| **Public** | A supported browser entry point intentionally exposed for application boot or cross-component use. |
| **Compatibility** | An externally visible boundary that current code depends on, even if it is not intended as a long-term product API. It must remain compatible until a separately approved migration and deprecation period are complete. |
| **Internal** | Application implementation state that is globally visible because current components coordinate through it. Visibility does not make it a supported API. |
| **Diagnostic** | A debugging, inspection, tracing, or development surface. It must not become product logic or authority. |
| **Vendor** | A global created by or for a third-party browser library. Its name, shape, and load timing are runtime dependencies. |
| **Test-only** | A surface installed by the behavioral harness before production scripts execute. Production code must not depend on it. |

Classification does not imply permission to modify a surface. All changes remain subject to `docs/engineering/app-js-preparation-change-policy.md`.

## 4. Preserved facade boundaries

The following are separate preserved facades:

1. `window.TruckPackerApp` — top-level application boot and compatibility facade.
2. `window.OrgContext` — authoritative active-workspace context facade.
3. `window.__TP3D_BILLING` — billing, subscription, and entitlement subsystem facade.

Future work must not merge these objects, duplicate their state authority, or make one a replacement proxy for another. Their implementations may later move only under an approved modularization plan, while their browser-visible timing and behavior remain compatible.

## 5. `window.TruckPackerApp`

### 5.1 Definition and assignment timing

`src/app.js` assigns a temporary `window.TruckPackerApp` object during the main application IIFE at `src/app.js:6664`. The IIFE's final return replaces that object with the final facade at `src/app.js:10001`.

The final facade becomes available only after the IIFE has completed. Application boot calls its `init()` method at `src/app.js:10040`, with `DOMContentLoaded` handling at `src/app.js:10054`.

Compatibility requirements:

- Consumers must use the final facade and must not retain the temporary object identity.
- The temporary assignment must not be treated as a list of approved final members.
- The final assignment timing must not move later without characterization proving all early consumers remain safe.
- `init()` must retain its current single-flight and repeated-call behavior defined near `src/app.js:8088`.
- Debug mode may wrap an existing facade method in place; method reassignment must preserve call semantics.

### 5.2 Current final surface

The final runtime surface is:

| Member | Classification | Owner and consumers | Contract |
|---|---|---|---|
| `init()` | Public | Owned by `src/app.js`; invoked by App boot. | Starts the application once and returns the current single-flight result for repeated initialization. |
| `maybeScheduleBillingRefresh()` | Compatibility | Owned by App billing coordination; consumed by Settings and diagnostic wrappers. | Schedules billing reconciliation. It is not the billing state or entitlement authority. |
| `getWorkspaceSwitchState()` | Public/compatibility | Owned by App workspace lifecycle; consumed by Settings and browser characterization. | Returns the current workspace-switch state without creating a second state authority. |
| `handleWorkspaceArchived()` | Compatibility | Owned by App workspace lifecycle; invoked conditionally by Settings. | Performs the current post-archive reconciliation behavior. |
| `handleWorkspaceRestored()` | Compatibility | Owned by App workspace lifecycle; invoked conditionally by Settings. | Performs the current post-restore reconciliation behavior. |
| `handleWorkspaceUpdated()` | Compatibility | Owned by App workspace lifecycle; invoked conditionally by Settings. | Performs the current post-update reconciliation behavior. |
| `openCreateWorkspaceFlow()` | Public/compatibility | Owned by App; consumed by Settings at `src/ui/overlays/settings-overlay.js:5724`. | Opens the existing create-workspace workflow. |
| `EditorUI` | Compatibility | Owned by `src/screens/editor-screen.js`; AppShell consumes it. | Current surface: `init`, `render`, `onActivated`, and `onDeactivated`, returned at `src/screens/editor-screen.js:6325`. It is not authorization to expose more editor internals. |
| `ui` | Compatibility | Owned by App/UI composition. | Current proxy surface: `showToast`, `showModal`, and `confirm`. It must not become a second complete UI facade without a separate decision. |
| `_debug` | Diagnostic | Owned by App and intended for inspection. | Current surface: `Utils`, `StateStore`, `Storage`, `CaseLibrary`, `PackLibrary`, and `Defaults`. It is not a supported product integration API. |

AppShell currently consumes `TruckPackerApp.EditorUI.onActivated` after activation scheduling at `src/app.js:3494`. This makes `EditorUI` a live compatibility dependency even though it is not classified as a general public API.

### 5.3 Mutation rules

- The final facade is assigned after the temporary facade; replacement is current behavior.
- Production components may feature-detect compatibility members.
- Diagnostic code may wrap `maybeScheduleBillingRefresh()` in place. A wrapper must preserve `this`, arguments, return value, asynchronous behavior, and errors.
- No component may copy facade-owned mutable state into a competing global authority.
- New members require a separately approved contract and behavior decision.
- Removing or renaming a member requires consumer characterization and a compatibility period.

### 5.4 Unresolved facade members

#### `handleWorkspaceLeft`

`handleWorkspaceLeft` is defined at `src/app.js:6463` and appears on the temporary facade at `src/app.js:6667`, but it is not returned on the final facade.

Settings feature-detects this method after a Leave Workspace operation at `src/ui/overlays/settings-overlay.js:1994`. When it is absent, Settings executes the existing generic account-bundle refresh fallback. The specialized handler would additionally perform its current billing, cache, organization, and UI reconciliation behavior.

**Contract decision:** unresolved pending a separately approved behavior decision.

Adding this member to the final facade would change the path executed after Leave Workspace. It is not authorized as a documentation-only compatibility correction. The current omission also must not be asserted as the desired permanent contract.

#### `handleOwnershipTransferred`

`handleOwnershipTransferred` is defined at `src/app.js:6581` and appears on the temporary facade at `src/app.js:6670`, but it is not returned on the final facade.

Settings feature-detects this method after Ownership Transfer at `src/ui/overlays/settings-overlay.js:2292`. When it is absent, Settings executes the existing generic refresh fallback. The specialized handler would additionally perform its current billing, cache, organization, UI, and refresh scheduling behavior.

**Contract decision:** unresolved pending a separately approved behavior decision.

Adding this member would alter current post-transfer behavior and potentially network and reconciliation ordering. It requires standalone approval and behavior-level characterization.

#### `notifyOrgAccessLoss`

The underlying access-loss handler is defined at `src/app.js:6398` and appears on the temporary facade at `src/app.js:6666`, but it is not returned on the final facade.

The current billing path reaches the behavior through a private late-bound callback. No concrete production external caller requiring a public member has been identified.

**Contract decision:** keep `notifyOrgAccessLoss` private unless a future concrete external caller is identified and a separate public-contract decision approves exposure.

The public coordination surface for this behavior is the `tp3d:org-access-lost` event documented below.

## 6. `window.OrgContext`

### 6.1 Definition, owner, and timing

`window.OrgContext` is assigned by `src/app.js` at `src/app.js:5931`, after its methods are defined near `src/app.js:5923` and before the final `window.TruckPackerApp` assignment.

It is the preserved browser facade for active organization/workspace context. Current consumers include:

- App billing and PDF gating;
- `src/data/services/billing.service.js`;
- `src/services/autopack-engine.js`;
- `src/ui/overlays/settings-overlay.js`;
- `src/debugger.js`;
- the PREP-1 browser characterization harness.

### 6.2 Surface

| Member | Contract |
|---|---|
| `getActiveOrgId()` | Returns the current active organization identifier. |
| `setActiveOrgId()` | Applies the current guarded active-organization update behavior. |
| `hydrateActiveOrgId()` | Restores active organization context using current auth, storage, and organization rules. |
| `getActiveRole()` | Returns the current role for the active organization context. |

### 6.3 Classification and mutation rules

`window.OrgContext` is an intentional compatibility facade and must remain separate from both `window.TruckPackerApp` and `window.__TP3D_BILLING`.

- Active organization mutation must continue through its owned lifecycle and guards.
- Consumers must not establish a second active-organization authority from local storage, billing state, or UI state.
- Assignment must remain early enough for billing, Settings, AutoPack, debugger, and readiness consumers.
- Moving, renaming, or delaying the facade risks stale organization, billing, member, invite, editor, or cross-tab state.
- Its browser-visible shape must remain compatible during future implementation movement.

## 7. `window.__TP3D_BILLING`

### 7.1 Definition, owner, and timing

`window.__TP3D_BILLING` is created by `src/app.js` during module evaluation at `src/app.js:1989`, before `window.TruckPackerApp` and before application `init()`.

Its initial surface is:

- `refreshBilling`
- `getBillingState`
- `clearBillingState`
- `subscribeBilling`
- `getProRuleSet`
- `canUseProFeatures`
- `startCheckout`
- `openPortal`
- `getCheckoutPlanOptions`
- `selfTest`

`pickCheckoutInterval` is added later during application initialization at `src/app.js:9230`. Consumers must not assume that late-added member exists before initialization reaches that point.

### 7.2 Consumers

Direct consumers include:

- Settings through `getBillingApiSafely()` at `src/ui/overlays/settings-overlay.js:3366`;
- AutoPack entitlement checks at `src/services/autopack-engine.js:727`;
- compatibility adapters in `src/data/services/billing.service.js:337`;
- App PDF and feature gating near `src/app.js:3720`;
- billing diagnostics and wrappers in `src/debugger.js`;
- PREP-1 billing, stale-response, generation, and recovery scenarios.

`window.TruckPackerApp` does not proxy this facade. `TruckPackerApp.maybeScheduleBillingRefresh()` is a scheduling entry point only; it is not a replacement for billing state, subscriptions, entitlement rules, checkout, or portal functions.

### 7.3 Classification and mutation rules

`window.__TP3D_BILLING` is an intentional, separate subsystem facade.

- Preserve the global name and object boundary.
- Preserve its early base availability.
- Preserve the late addition timing of `pickCheckoutInterval` unless a separately approved behavior change proves an equivalent contract.
- Preserve subscription semantics and billing state authority.
- Preserve organization, auth-epoch, billing-epoch, generation, and stale-result guards.
- Debugger code may wrap `refreshBilling` in place at `src/debugger.js:397`; wrappers must preserve identity-sensitive behavior, `this`, arguments, return values, asynchronous results, and errors.
- Do not merge this facade into `window.TruckPackerApp`.
- Do not duplicate billing state into another facade.
- Do not rename the global during App.js modularization.

Merging or renaming this surface would risk Settings, AutoPack, PDF gates, legacy billing adapters, debugger instrumentation, browser characterization, and cross-tab entitlement correctness.

## 8. Supabase and vendor contracts

### 8.1 Supabase surfaces

| Surface | Classification | Contract |
|---|---|---|
| `window.supabase` | Vendor | Created by the Supabase browser library. `window.supabase.createClient` is consumed by `src/core/supabase-client.js:1517`. It must exist before Supabase client initialization. |
| `window.__TP3D_SUPABASE` | Compatibility | Created as configuration in `index.html:1009` with `url`, `anonKey`, and `publishableKey`. `src/core/supabase-client.js` later augments the existing object with the application API near `src/core/supabase-client.js:3468`. The configuration object must not be replaced. |
| `window.__TP3D_SUPABASE_API` | Compatibility | Alias to the Supabase application API. Preserve until an approved caller audit and deprecation period are complete. |
| `window.SupabaseClient` | Compatibility | Human-readable alias to the same application API. Preserve under the same rule. |
| Raw Supabase client global | Internal/diagnostic | Published after client creation near `src/core/supabase-client.js:1540`. Do not expand its use. Internalize only after operational/debug consumers are ruled out. |

The Supabase application API currently includes session/auth state, auth-epoch and user identity, single-flight requests, account-bundle cache control, auth actions, profile access, organization/member/invite operations, and organization asset management. Future modularization must preserve the aliases and merge semantics even if internal ownership changes later.

The PREP-1 fake replaces only the vendor boundary at `window.supabase.createClient` before production scripts execute. That replacement is test-only and does not authorize production changes to `src/core/supabase-client.js`.

### 8.2 Boot and vendor surfaces

| Surface | Classification | Timing and contract |
|---|---|---|
| `window.__TP3D_BOOT` | Compatibility | Created at `index.html:28`. Owns CDN failure and vendor readiness state. `threeReady` is added near `index.html:145`, and App.js awaits it before composing the application. |
| `window.__tp3dCdnFail` | Compatibility | Boot-loader failure callback. Preserve name and error reporting behavior. |
| `window.__tp3dVendorOk` | Compatibility | Boot-loader success callback. Preserve vendor readiness bookkeeping. |
| `window.__tp3dVendorFail` | Compatibility | Boot-loader failure callback. Preserve failure bookkeeping. |
| `window.__tp3dVendorAllReady` | Compatibility | Promise/coordination surface awaited by App startup near `src/app.js:5055`. |
| `window.THREE` | Vendor | Assigned after Three ESM imports complete. Includes `OrbitControls` as `window.THREE.OrbitControls`. Preserve name, shape, and readiness ordering. |
| `window.TWEEN` | Vendor | Created by its classic vendor script before App startup validation. |
| `window.jspdf` | Vendor | Created by the jsPDF vendor script; current code expects its nested constructor surface. |
| `window.XLSX` | Vendor | Created by the spreadsheet vendor script before App startup validation. |

No current standalone `window.OrbitControls` assignment has been confirmed. `window.jsPDF` is present in ambient types at `src/types/global.d.ts:28`, but no current runtime producer or consumer was confirmed. These names are unresolved compatibility declarations and must not be promoted or removed without runtime evidence.

## 9. Other application-visible surfaces

### 9.1 Compatibility and internal surfaces

| Surface | Classification | Owner, mutation, and preservation rule |
|---|---|---|
| `window.__TP3D_UI` | Internal/compatibility | Created after Three readiness and before the main App IIFE near `src/app.js:2047`. Current UI-components surface includes toast, modal, AutoPack loading overlay, confirmation, and dropdown helpers. Preserve during preparation; do not promote it as the primary app facade. |
| `window.TP3D.helpers` | Diagnostic/compatibility | Installed by `src/core/app-helpers.js:101`. Current helpers include version, diagnostics, error reporting, environment, and time helpers. Extend its namespace without replacing unrelated properties. |
| `window.__TP3D_LAST_ACCOUNT_BUNDLE` | Internal | Mutable account/organization bundle consumed across App and Settings. It is P0-sensitive across auth and organization changes. Preserve current cleanup and ownership until consumers receive an approved replacement. |
| `window.__TP3D_USER_SWITCH_PENDING` | Internal | Cross-module user-switch synchronization flag consumed by billing code. Preserve auth-epoch/user isolation and guaranteed cleanup. It is not a public API. |
| `window.__TP3D_ORG_METRICS__` | Diagnostic | Live organization lifecycle counters created near `src/app.js:5652`. Consumers must not mutate them. |
| `window.__TP3D_BILLING_TRACE_CURRENT_ID__` | Diagnostic | Billing trace correlation value shared with billing services. It is not billing authority. |
| `window.__TP3D_BUILD_STAMP_LOGGED__` | Diagnostic/internal | One-time build logging latch. Do not treat it as product state. |

These internal globals are candidates for eventual internalization only after a separately approved compatibility period. Their current consumers and cleanup semantics must be characterized before any movement.

### 9.2 Diagnostic surfaces

| Surface | Contract |
|---|---|
| `window.__TP3D_DIAG__` | Created by `src/debugger.js` even when diagnostics are disabled. Provides enable/disable/configuration, event recording, persistence, summaries/downloads, state snapshots, billing wrapping, and AutoPack tracing. It is diagnostic, not product authority. |
| `window.__TP3D_DIAG_PERSIST_KEY__` | Exists only when diagnostic persistence is enabled. Diagnostic only. |
| `window.__TP3D_FORCE_DEBUG__` | External debug input consumed by `src/debugger.js`. No production assignment is required. |
| `window.__TP3D_WRAPPER_DETECTIVE__` | Optional diagnostics created by App.js with wrapper-usage and smoke-test helpers. |
| `window.__tp3dAssertCore` | Development health-check helper installed after initialization by `src/core/dev/dev-helpers.js`. It must not be assumed available before `init()`. |
| `window.getBillingState` | Debug-only convenience alias installed near `src/app.js:2023`. The canonical surface remains `window.__TP3D_BILLING.getBillingState`. |

When enabled, diagnostic code may wrap `console.error`, `console.warn`, `window.fetch`, storage mutation methods, History mutation methods, and facade methods. All wrappers must preserve native/application semantics and must remain observational rather than authoritative.

### 9.3 Legacy or unresolved probes

`window.SettingsOverlay` and `window.AccountOverlay` are probed by App.js near `src/app.js:5683`, but no current assignment was confirmed. `window.__TP3D_TAB_ID__` is read by diagnostic code, but the current Supabase tab identifier is session-backed and exposed by the Supabase API.

These are compatibility probes, not approved new APIs. They may be deprecated later only after external-build and operational consumers are ruled out.

## 10. Global event contracts

### 10.1 Custom events

| Event | Producer and payload | Consumers and preservation rules |
|---|---|---|
| `tp3d:auth-signed-out` | Produced by `src/core/supabase-client.js`. Payload variants include cross-tab/source context, offline/global intent, and forced-revocation reason/status. | App.js and diagnostics consume it. Preserve the name and existing fields; future fields must be additive. Do not weaken user, tab, or auth guards. |
| `tp3d:auth-error` | Produced by Supabase client with source, type, severity, error, and cached-user diagnostic context. | Diagnostic contract. Preserve safe payload handling and never include secrets. |
| `tp3d:workspace-switch-state` | Produced by App.js near `src/app.js:5197`. Current detail includes active/from/to organization IDs, source, start/finish times, version, local/org/billing readiness, remote state, and reason. | Consumed by Settings and browser readiness helpers. Preserve event timing, readiness meanings, and additive payload compatibility. |
| `tp3d:org-changed` | Produced by App.js near `src/app.js:6000`. Current detail includes org ID, reason, user ID, optional confirmed-no-org state, timestamps, epoch, tab ID, and source. | Consumed by App, Settings, diagnostics, and cross-tab coordination. Preserve user/org/tab/epoch/freshness guards. |
| `tp3d:org-access-lost` | Produced by the access-loss lifecycle near `src/app.js:6421` with organization, user, and timestamp context. | Consumed by Settings. This event remains the public coordination surface while `notifyOrgAccessLoss` stays private. |
| `tp3d:workspace-ready` | Produced by App.js near `src/app.js:7015` with the active organization ID. App also consumes it internally. | Preserve dispatch timing and current readiness semantics. |
| `tp3d:profile-updated` | Produced by Settings after avatar/profile updates near `src/ui/overlays/settings-overlay.js:2656`. | No repository consumer is confirmed. Preserve as unresolved compatibility until external consumers are ruled out. |

Custom event payloads may be extended additively only when existing consumers continue to work. Renaming an event, removing a field, changing dispatch timing, or changing its target requires a separate compatibility decision.

### 10.2 Internal application event bus

The internal event bus is not a browser-global API, but its event names are cross-module contracts. Current names include:

- `app:error`
- `theme:apply`
- `storage:load_error`
- `storage:read_error`
- `storage:write_error`
- `storage:remove_error`
- `storage:saved`
- `storage:save_error`
- `storage:import_error`
- `session:changed`
- `session:error`
- `auth:changed`

Future work must preserve producers, consumers, error isolation, and payload meanings until each owner is explicitly changed. These names must not be promoted to browser `CustomEvent` contracts without a separate decision.

### 10.3 Native window and document events

Current coordination depends on native events including:

- `DOMContentLoaded` for boot;
- `error` and `unhandledrejection` for preboot/runtime diagnostics;
- `storage` for auth, billing, organization, and workspace synchronization;
- `focus` and `visibilitychange` for auth validation and billing recovery;
- `online` and `offline` for connectivity state and recovery;
- `hashchange` for routing;
- `keydown`, pointer, resize, orientation, and visual viewport events for UI/editor coordination.

Modularization must preserve event target, capture/options, handler identity, removal semantics, and listener cardinality. Repeated initialization must not duplicate listeners.

## 11. BroadcastChannel contracts

### 11.1 `tp3d-billing`

App.js creates the billing channel during module evaluation near `src/app.js:801`.

Current message shape:

```text
{
  type: "billing-result",
  orgId,
  state,
  tabId
}
```

The state is a sanitized billing snapshot. Receivers apply type, tab, organization, freshness, epoch, and generation protections before accepting a result.

Preserve:

- channel name;
- message type;
- organization binding;
- sender tab identity;
- sanitized state semantics;
- stale-result and wrong-org rejection;
- localStorage compatibility paths used by older tabs.

### 11.2 `tp3d-auth`

The Supabase client creates the auth channel during initialization near `src/core/supabase-client.js:318`.

Current logout message shape:

```text
{
  type: "LOGOUT",
  timestamp,
  tabId
}
```

The `tp3d-logout-trigger` localStorage path is the fallback when BroadcastChannel is unavailable and uses the same logical payload.

Preserve the channel name, logout message type, timestamp/tab semantics, same-tab avoidance, and fallback equivalence.

## 12. Storage compatibility contracts

### 12.1 Application data and session storage

| Key or family | Owner and contract | Preservation rule |
|---|---|---|
| `truckPacker3d:v1` | Base application storage key defined by `src/core/storage.js`. | Preserve persisted data compatibility. |
| `truckPacker3d:v1:{userScope}` | User-scoped storage family. | Preserve signed-in user isolation. |
| `truckPacker3d:v1:workspace:{orgScope}` | Workspace-scoped storage family. | Preserve organization isolation and switch cleanup. |
| `truckPacker3d:session:v1` | Session singleton key defined by `src/core/session.js`. | Preserve pending a separately approved migration. |
| `tp3d:pending_invite_token` | Session continuation for invite processing. | Preserve lifecycle and cleanup semantics. |
| `tp3d:settings:activeTab` | Session preference owned by Settings. | Preserve current UI compatibility. |
| `tp3d:billing:status:{orgId}` | Session billing transition memory. | Preserve organization scoping. |
| `tp3d_trial_modal_shown_{orgId}` | Per-organization trial-modal suppression. | Preserve exact organization suffix semantics. |
| `tp3d.editor.caseBrowser.showFilters` | Editor UI preference. | Preserve as editor compatibility state. |

### 12.2 Auth and organization coordination

| Key or family | Contract |
|---|---|
| `sb-{projectRef}-auth-token` | Supabase-owned auth persistence. App storage coordination recognizes the Supabase auth-token family. Preserve vendor ownership and event behavior. |
| `tp3d:active-org-id` | Active organization compatibility key defined near `src/app.js:5140`. Preserve auth/user checks and authoritative organization reconciliation. |
| `tp3d:org-context-sync` | Ephemeral localStorage transport for organization-change coordination. Preserve payload parity with `tp3d:org-changed`. |
| `tp3d:workspace-switch-state-sync` | Ephemeral cross-tab switch state with user, tab, and timestamp context. Preserve freshness and user isolation. |
| `tp3d-logout-trigger` | LocalStorage fallback for cross-tab auth logout. Preserve parity with the `tp3d-auth` message. |
| `__tp3d_tab` | Supabase/auth per-tab identifier. |
| `__tp3d_billing_tab` | Billing per-tab identifier. |
| `tp3d:org-context-tab-id` | Organization-context per-tab identifier. |

The three tab identifiers have separate current owners. They must not be unified merely because they contain similar values.

### 12.3 Billing coordination

Primary billing keys:

- `billing:inflight:{orgId}`
- `billing:lastFetchedAt:{orgId}`
- `billing:lastState:{orgId}`

Legacy compatibility mirrors:

- `tp3d:billing:lock:{orgId}`
- `tp3d:billing:fresh:{orgId}`
- `tp3d:billing:result:{orgId}`

The primary and legacy families are defined near `src/app.js:408`. They coordinate refresh ownership, freshness, and state between tabs. Legacy mirrors must remain during modularization so an already-open older tab does not become incompatible with a newer tab.

Preserve:

- exact organization scoping;
- lock ownership and expiration semantics;
- tab identity;
- freshness timestamps;
- serialized billing result compatibility;
- stale, wrong-org, and wrong-user rejection;
- primary/legacy mirroring until a separately approved compatibility window expires.

### 12.4 Diagnostic and legacy keys

Current diagnostic keys include:

- `tp3dDebug`
- `tp3dForceTrial`
- `tp3dDevUserPlanOverride`
- `tp3dDiagPersist`

`tp3d:auth-user-switch-reload` is currently removed during initialization, but no current writer was confirmed. It is a legacy cleanup contract and must not be removed solely because its writer is absent from the present source graph.

Dormant `v2` constants in modules outside the confirmed App runtime chain are not automatically part of this contract. They require runtime evidence before promotion, migration, or removal.

## 13. Initialization sequence contract

The following ordering is part of current behavior:

1. `index.html` creates `window.__TP3D_BOOT` and vendor readiness helpers.
2. Three.js modules load and populate `window.THREE`.
3. Classic vendor scripts populate `window.TWEEN`, `window.jspdf`, `window.XLSX`, and `window.supabase`.
4. `index.html` creates the `window.__TP3D_SUPABASE` configuration object.
5. Preboot error handlers are installed.
6. `src/app.js` is dynamically imported.
7. ESM dependencies evaluate and Supabase compatibility aliases are installed.
8. App.js establishes billing coordination, its BroadcastChannel/storage listeners, and `window.__TP3D_BILLING`.
9. App.js waits for `window.__TP3D_BOOT.threeReady`.
10. App.js creates `window.__TP3D_UI`.
11. The main App IIFE creates helpers, optional diagnostics, overlay bindings, `window.OrgContext`, late-bound callbacks, and the temporary `window.TruckPackerApp`.
12. The IIFE's final return replaces the temporary object with the final `window.TruckPackerApp` facade.
13. Boot invokes `window.TruckPackerApp.init()`.
14. `init()` initializes Supabase/auth, controllers, listeners, billing subscription, router, and development helpers, and later augments `window.__TP3D_BILLING`.

Future work must preserve all externally observable ordering unless a separately approved behavior change and browser characterization prove an equivalent contract.

In particular:

- do not delay the base billing facade until after App initialization;
- do not use billing before auth/organization readiness as authoritative entitlement;
- do not replace Supabase configuration when installing the Supabase API;
- do not use the temporary App facade as the final facade;
- do not assume diagnostic helpers exist before initialization;
- do not register duplicate listeners, timers, subscriptions, or channels during repeated initialization.

## 14. Test-only surfaces

The PREP-1 real-browser harness installs the following test-only globals before production scripts execute:

- `window.__TP3D_FAKE_SUPABASE_SCENARIO__`
- `window.__TP3D_FAKE_SUPABASE_CONTROL__`
- `window.__TP3D_TEST_INSTRUMENTATION__`

Individual scenarios may also install temporary probes such as:

- `window.__TP3D_TEST_WORKSPACE_READY__`
- `window.__TP3D_TEST_WINDOW_EVENTS__`
- `window.__TP3D_TEST_BILLING_STATE__`
- `window.__TP3D_TEST_ORG_FAILURE__`

These surfaces are test-only. They must:

- be installed before production scripts when required;
- remain transport, scenario, observation, or synchronization controls;
- not reproduce App auth, organization, billing, or lifecycle logic;
- be isolated by a fresh BrowserContext;
- never become a production dependency or supported browser API.

The test-only storage family `tp3d:test:fake-profile:{userId}` follows the same rule.

## 15. Behavioral characterization obligations

The PREP-1 browser harness currently characterizes signed-out boot, repeated initialization ownership, signed-in boot, token refresh, A-to-B-to-A user switching, same-tab and cross-tab workspace switching, workspace readiness, failed organization-bundle recovery, stale billing results, authoritative generation ownership, and offline/online recovery.

The harness also observes facade keys diagnostically. It does not define the accidental absence of `handleWorkspaceLeft` or `handleOwnershipTransferred` as the desired contract.

Before any future change to these contracts, characterization must cover the affected surface, including as applicable:

- final facade availability and member timing;
- repeated-init object, listener, timer, channel, subscription, and network ownership;
- organization/user/tab/epoch/generation guards;
- same-tab and cross-tab behavior;
- storage and BroadcastChannel payload compatibility;
- stale response rejection;
- failure and offline recovery;
- feature-detected fallback behavior;
- diagnostic wrapper transparency.

If a future decision approves exposing `handleWorkspaceLeft` or `handleOwnershipTransferred`, tests must first preserve evidence of the current fallback and then verify the separately approved specialized behavior. A test must not permanently assert that the current omission is the intended contract.

## 16. Modularization preservation gates

Any future App.js modularization work affecting a surface in this document must satisfy all of the following:

1. The surface retains its documented classification; internal or diagnostic visibility is not silently promoted to public API.
2. `window.TruckPackerApp`, `window.OrgContext`, and `window.__TP3D_BILLING` remain separate preserved facades.
3. Public and compatibility names, method semantics, assignment timing, and mutation rules remain compatible.
4. Events retain their names, targets, timing, payload compatibility, and listener cardinality.
5. Storage keys retain scope, serialization, cleanup, freshness, and old-tab compatibility.
6. BroadcastChannel names, message shapes, sender identity, and rejection guards remain compatible.
7. Vendor and boot globals remain available before their current consumers.
8. Diagnostic wrappers remain transparent and non-authoritative.
9. Test-only globals remain isolated from production.
10. No unresolved facade member is added or removed without a separate behavior decision.

## 17. Controlling decisions

The approved PREP-2 decisions are:

- Preserve `window.TruckPackerApp` as the top-level application facade.
- Preserve `window.OrgContext` as a separate active-workspace facade.
- Preserve `window.__TP3D_BILLING` as a separate billing and entitlement facade.
- Do not merge or rename these facades during modularization preparation.
- Treat `EditorUI` and `ui` as compatibility surfaces, not authorization to expand public API.
- Treat `_debug`, helpers, metrics, traces, and debugger globals as diagnostic surfaces.
- Treat globally visible account-bundle and user-switch state as internal implementation leaks that must remain compatible until separately internalized.
- Preserve Supabase aliases, configuration merge semantics, boot globals, and vendor timing.
- Preserve documented event names, storage families, BroadcastChannels, payloads, and guards.
- Keep `notifyOrgAccessLoss` private unless a future concrete external caller is identified.
- Leave `handleWorkspaceLeft` unresolved pending a separately approved behavior decision.
- Leave `handleOwnershipTransferred` unresolved pending a separately approved behavior decision.
- Do not implement a facade correction under this documentation contract.
