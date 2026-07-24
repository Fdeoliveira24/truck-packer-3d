# P0 Domain Module Contract

**Status:** Authoritative pre-implementation contract for the coordinated P0 extraction
**Branch:** `refactor/app-js-p0-domain-cluster`
**Date:** 2026-07-23
**Scope:** EU-09 Organization/Workspace, EU-10 Billing (state/refresh/cross-tab/channel), EU-11 Checkout/Portal guards, EU-12 Auth-state reaction + profile enforcement, EU-14 diagnostics absorbed by owners
**Baseline:** `faaba81`-era app.js as merged through `4f83c32` (M1/M2/M4). All line numbers are current-branch anchors and drift; the behavioral contract, not the line number, governs.
**Governing prior docs:** PREP-2 facade contract, PREP-3 runtime invariants, PREP-4 ownership ledger, PREP-5 dependency graph, `app-js-modularization-master-execution-plan.md`. This contract does not restate them; it resolves the concrete module boundaries they left open.

**Principle:** Preservation over elegance. This is a nine-month-stabilized P0 surface (money + identity). Every ambiguity is resolved toward *no observable change*. Where the source is genuinely ambiguous, the item is marked **UNRESOLVED** rather than assigned.

---

## Audit 1 — Authoritative state ownership

Legend for access mechanism: **live** = same object reference returned; **copy** = fresh object per call; **scalar** = primitive accessor; **setter** = narrow named mutator; **internal** = never leaves owning module.

### Organization / Workspace (all currently inside the main IIFE)

| Symbol | Init | Reassigned/Mutated | Persisted | Cross-tab | Facade/global | Owner (proposed) | Root still needs | Access mechanism |
|---|---|---|---|---|---|---|---|---|
| `orgContext` | `{ activeOrgId, activeOrg, orgs, role, updatedAt }` (app.js:4525-area) | reassigned (6 sites: 5299,5319,5588,6088,6206,6589) | via `tp3d:active-org-id` | via `tp3d:org-context-sync` | drives `window.OrgContext` | **Org** | read (AccountSwitcher, `init`, `renderAuthState`) | `getActiveOrgId()` scalar; `getActiveRole()` scalar; **new root/inter-module-private** `getOrgContextSnapshot()` → **copy** (see Audit 16) |
| `orgContextVersion` | `0` (4552) | incremented | no | no (compared, not persisted) | no | **Org** | no | internal |
| `lastAppliedOrgContextVersion` | `0` (4553) | reassigned | no | reflects cross-tab | no | **Org** | no | internal |
| `lastAppliedOrgContextTabId` | `''` (4554) | reassigned | no | yes | no | **Org** | no | internal |
| `orgContextTabId` | session `tp3d:org-context-tab-id` (4555) | const | sessionStorage | tab identity | no | **Org** | no | internal |
| `orgContextResolved` | `false` | reassigned (incl. root cleanup 7408) | no | no | no | **Org** | **write** (signed-out cleanup sets `false`) | **setter** `markOrgContextUnresolved()` |
| `orgContextInFlight` | `null` | reassigned | no | no | no | **Org** | read (AccountSwitcher loading state) | scalar `isOrgContextInFlight()` |
| `workspaceSwitchState` | 11 fields (4534): `active,fromOrgId,toOrgId,source,startedAt,finishedAt,version,localStateReady,orgReady,billingReady,remote` | reassigned (4709,4734,4745,...) | no | via `tp3d:workspace-switch-state-sync` | via `getWorkspaceSwitchState()` on `TruckPackerApp` | **Org** | read (`TruckPackerApp.getWorkspaceSwitchState`) | **copy** via `getWorkspaceSwitchState()` |
| `lastAppliedWorkspaceSwitchOrder` | `{transitionAt:0,stateAt:0,tabId:''}` (4547) | reassigned | no | DEF-010 ordering | no | **Org** | no | internal |
| `workspaceSwitchTimer` | timer handle | reassigned | no | no | no | **Org** | no | internal |
| `orgContextMetrics` | counters | mutated | no | no | `window.__TP3D_ORG_METRICS__` (diagnostic) | **Org** | no | diagnostic global, read-only for consumers |

### Billing (all currently at module top level, 113–2140)

| Symbol | Init | Reassigned/Mutated | Persisted | Cross-tab | Facade/global | Owner | Root needs | Access |
|---|---|---|---|---|---|---|---|---|
| `_billingState` | full object (113) | **mutated in place** (fields) | via `billing:lastState:{org}` + legacy mirror | via `tp3d-billing` channel | drives `window.__TP3D_BILLING` | **Billing** | read (`init` role/snapshot; org readiness) | **copy** via `getBillingState()` (already returns a fresh literal, app.js:971) |
| `_billingEpoch` | `0` (164) | incremented on sign-out/access-loss | no | epoch guard | no | **Billing** | no | internal |
| `_billingSubscribers` | `new Set()` (142) | mutated | no | no | no | **Billing** | no | internal (`subscribeBilling`) |
| `_billingRefreshQueued` / `_billingRefreshQueuedWaiters` | `false` / `[]` (157-158) | mutated | no | no | no | **Billing** | no | internal |
| `_billingPendingRetry` | `{orgId,count,timer}` (159) | mutated | no | no | no | **Billing** | no | internal (timer) |
| `_billingLastFocusRefreshAt` | `0` (160) | reassigned | no | no | no | **Billing** | no | internal |
| `_billingTraceSeq` / trace ids | `0` (163) | incremented | no | no | `__TP3D_BILLING_TRACE_CURRENT_ID__` (diag) | **Billing** | no | diagnostic |
| `_billingAuthoritativeRefreshGeneration` / `_billingAuthoritativeRefreshRequired` / `_billingAuthoritativeRefreshInFlight` / `_billingRequireAuthoritativeOnNextSignIn` | `0`/`null`/`null`/`false` (165-170) | mutated | no | no | no | **Billing** | **call** (cleanup calls `clearBillingAuthoritativeRefreshRequirement`, `markBillingAuthoritativeRefreshForNextSignIn`) | named APIs |
| `_billingGateApplier` | `null` (177) | set once | no | no | no | **Billing** | **bind** (root supplies gate applier) | **late-bind setter** `setBillingGateApplier(fn)` |
| `_billingTabId` | `''` (397) | set | `__tp3d_billing_tab` | tab identity | no | **Billing** | no | internal |
| `_billingBroadcast` | `null` (399) | `new BroadcastChannel('tp3d-billing')` (811) | no | channel | no | **Billing** | no | internal |
| `_billingActionGeneration` | `0` (1925) | incremented by BOTH `startCheckout`/`openPortal` | no | no | no | **Billing** | no | internal (DEF-011; must stay shared — Audit 7) |
| checkout/portal in-flight | (no long-lived var; per-call context) | — | no | no | no | **Billing** | no | internal |

### Auth reaction (inside IIFE)

| Symbol | Owner | Root needs | Access |
|---|---|---|---|
| `lastAuthUserId` | **Auth** | **write** (cleanup sets `null`) | **setter** `setLastAuthUserId(v)` |
| `lastAuthEventSnapshot` | **Auth** | write (cleanup) | **setter** or move cleanup's snapshot write into Auth API |
| `authRehydratePromise` | **Auth** | read (AccountSwitcher hydrating state) | scalar `isAuthRehydrating()` |
| `authGate*` settlement state (`_authGate`, `authBlockState`, `authListenerInstalled`, `authUiBound`) | **Auth** for gate/block; **Root** for `authListenerInstalled` (see Audit 12) | mixed | see Audit 5/12 |
| `lastProfileCheckUserId` / `lastProfileCheckAt` / `PROFILE_CHECK_TTL_MS` | **Auth** | no | internal |
| `readyToastShown`, `canShowToast` dedupe state | **Auth** | no | internal |

### Composition root (stays in app.js)

| Symbol | Owner | Notes |
|---|---|---|
| `suspendAutoSave` | **Root** | storage-scope orchestration; read by autosave |
| `hasLoadedScopedState` | **Root** | scoped-load tracking |
| `lastLoadedWorkspaceStorageKey` | **Root** | workspace-scope tracking |
| `BootState` (`window.__TP3D_BOOT`) | **Root** (shared with index.html) | `appReady`, `fatalOverlayShown`, `maintenanceMode` — unchanged |
| `initInFlightPromise` / `initCompleted` | **Root** | init single-flight (PREP-3 §2) — unchanged |
| `shortcuts` (removed in M2) / editor singletons | **Root** | n/a to this phase |

**UNRESOLVED (Audit 1):** `authBlockState` is written by profile enforcement (Auth) but read by `_executeSignedOutCleanup` (root) to choose overlay phase. Proposed: Auth owns it; root reads via `getAuthBlockState()` scalar. Confirm no other writer before implementation.

---

## Audit 2 — Function ownership

Interleaved 4525–6900 band resolved (66 functions). Classification of the explicitly-listed functions:

| Function | Owner | Reason | Invariant |
|---|---|---|---|
| `markWorkspaceSwitchReady` | **Org** | mutates `workspaceSwitchState`, calls `finishWorkspaceSwitch` | DEF-010 readiness |
| `markWorkspaceSwitchOrgReadyIfResolved` | **Org** | reads `orgContext`, marks orgReady | DEF-010 |
| `markWorkspaceSwitchBillingReadyIfSettled` | **Org** | mutates `workspaceSwitchState`; reads billing **via injected `getBillingState`** | DEF-010; billing read is a synchronous accessor, no async indirection |
| `beginWorkspaceSwitch` / `finishWorkspaceSwitch` | **Org** | own the switch lifecycle + timer + dispatch | DEF-010 |
| `dispatchWorkspaceSwitchStateChanged` | **Org** | dispatches `tp3d:workspace-switch-state` + sync storage | event owner |
| `normalize/compare/recordWorkspaceSwitchOrder`, `nextWorkspaceSwitchDispatchTimestamp` | **Org** | DEF-010 tuple math (pure/near-pure) | DEF-010 |
| `handleIncomingWorkspaceSwitchState` / `parseWorkspaceSwitchSyncPayload` | **Org** | cross-tab switch sync | DEF-010 |
| `handleIncomingOrgContextSync` / `parseOrgContextSyncPayload` / `parseOrgContextVersion` | **Org** | cross-tab org sync | org freshness |
| `setActiveOrgId`, `hydrateActiveOrgId`, `getActiveOrgId`, `getActiveOrgIdNow`, `refreshOrgContext`, `resolveOrgContextFromBundle`, `applyOrgContextFromBundle`, `clearOrgContext`, `dispatchOrgContextChanged`, `mark/next/parseOrgContextVersion`, `persistActiveOrgSelection`, `readLocalOrgId`, `handleOrgAccessLoss`, `applyOrgRequiredUi`, `queueOrgScopedRender`, `resetWorkspaceScopedUiState`, `isConfirmedNoActiveOrgContext`, `refreshConfirmedNoActiveOrgUi`, `ensureOrgRequiredBanner` | **Org** | org state + UI-required gating | org events |
| `clearBillingState`, `refreshBilling`, `startCheckout`, `openPortal`, `captureBillingActionContext`, `getBillingState`, `subscribeBilling`, `getProRuleSet`, `canUseProFeatures`, `getCheckoutPlanOptions`, `applyAccessGateFromBilling`, `clearBillingAuthoritativeRefreshRequirement`, `markBillingAuthoritativeRefreshForNextSignIn`, all `_billing*` refresh/epoch/action/cross-tab helpers (**excluding** the IIFE-local `_billingPump*` state) | **Billing** | billing-private state | DEF-011, epoch/generation guards |
| `maybeScheduleBillingRefresh`, `resetBillingPumpForUserSwitch`, all `_billingPump*` state, `pickCheckoutInterval` | **Root/IIFE** | billing **pump** + checkout-interval picker are IIFE-local runtime/UI, **not** billing-module — defined in the IIFE, close over IIFE scope, exposed via `window.TruckPackerApp` / late-added to `window.__TP3D_BILLING`; they *call* `BillingService.*` after Stage 1 but are not owned by it | RETAIN — IIFE-local (Stage 1 Amendment move map) |
| `authGateInitialSession/IsSettled/SignedIn/SignedOutCandidate`, `canStartAuthRehydrate`, `clearAuthBlocked`, `getAuthTruthSnapshot`, `getCurrentAuthSnapshot`, `requestAuthRefresh`, `runAuthRefresh`, `rehydrateAuthState` | **Auth** | auth settlement + refresh scheduling | DEF-009 |
| `renderAuthState`, `checkProfileStatus` | **Auth** | auth-state reaction + profile enforcement | DEF-009, profile disabled/deleted |
| `handleWorkspaceArchived/Restored/Updated`, `getWorkspaceSwitchState` | **Org** (on `TruckPackerApp` facade) | workspace lifecycle reconciliation | facade compat |
| `handleWorkspaceLeft`, `handleOwnershipTransferred` | **Org (implementation) — UNRESOLVED facade status** | present in org band; **must remain feature-detected/not-on-final-facade** (PREP-2 §5.4) | see Audit 10 |
| `handleOrgAccessLoss` / `notifyOrgAccessLoss` | **Org**; `notifyOrgAccessLoss` **stays private** (PREP-2 §5.4) | — | dispatches `tp3d:org-access-lost` |
| `_executeSignedOutCleanup` | **Root** | cross-domain ordered orchestration (Audit 6) | signed-out ordering |
| `setWorkspaceStorageScope`, `flushPendingStorageSave`, `resetAppStateToEmpty` (usage), autosave suspend | **Root** (EU-13 retained) | storage-scope orchestration | cross-user/workspace isolation |

**Cross-domain callers that STAY at root and call module APIs:** `init` (reads org snapshot + billing snapshot for role resolution), `_executeSignedOutCleanup`, storage-scope transitions, `bootstrapAuthGate`. `renderAuthState` (Auth module) calls the root `_executeSignedOutCleanup` via an injected `onSignedOutCleanup` callback.

---

## Audit 3 — Permanent module contracts

All methods below are the *permanent* surface. Naming is behavior-specific (no `updateState`/`handleChange`). "Pre-init safe" = callable before `init()` completes. "Post-signout safe" = callable when signed out.

### Organization module — `createOrgContext({ ... }) → OrgContextModule`

Injected: `StateStore`, `SupabaseClient`, `UIComponents`, `getBillingState` (billing accessor), `maybeScheduleBillingRefresh` (**root/IIFE billing pump — retained root callback, not billing-owned**; Org calls it directly today and, after Org extraction, receives it as a retained root callback), `subscribeBilling` (billing — org registers its readiness marker as a billing subscriber, the existing mechanism), `setWorkspaceStorageScope`/`flushPendingStorageSave`/`markLocalStateReady` (root storage), `getSignedInUserIdStrict` (auth), `dispatchEvent` (window).

> **Gate-2 correction (verified):** the billing→org readiness path is the **existing `subscribeBilling` subscription** (app.js:9241 registers `subscribeBilling(s => markWorkspaceSwitchBillingReadyIfSettled(s, 'billing-subscriber'))`), plus three direct synchronous `markWorkspaceSwitchBillingReadyIfSettled(getBillingState(), …)` calls inside org functions (5315/5347/5602). There is **no new `onBillingSettled` callback**; org subscribes to `BillingService.subscribeBilling`, exactly as today.

| Method | Args | Returns | Sync | Side effects / events | Order / guard | Visibility |
|---|---|---|---|---|---|---|
| `getActiveOrgId()` | — | string\|null | sync | none | — | **public** (`window.OrgContext`) |
| `setActiveOrgId(id, {source})` | id, opts | Promise<string> | async | mutates orgContext, dispatches `tp3d:org-changed`, schedules billing | guarded org switch; rejects → rollback | **public** |
| `hydrateActiveOrgId()` | — | Promise | async | restores from storage/auth | pre-init safe | **public** |
| `getActiveRole()` | — | string | sync | none | — | **public** |
| `getOrgContextSnapshot()` | — | **copy** `{activeOrgId,activeOrg,orgs,role,updatedAt}` | sync | none | — | **root/inter-module private** (for AccountSwitcher-later, `init`, `renderAuthState`) |
| `getWorkspaceSwitchState()` | — | **copy** of 11-field state | sync | none | DEF-010 | **public via `TruckPackerApp`** |
| `isOrgContextInFlight()` / `isOrgContextResolved()` | — | bool | sync | none | — | inter-module (AccountSwitcher-later, cleanup) |
| `markOrgContextUnresolved()` | — | void | sync | sets `orgContextResolved=false` | — | root-private (cleanup) |
| `clearOrgContext({clearLocalOrgHint,confirmedNoOrg})` | opts | void | sync | resets orgContext, cancels switch, may dispatch | signed-out ordering | root-private |
| `markWorkspaceSwitchBillingReady(snapshot?)` | snapshot | void | sync | may finish switch + dispatch | DEF-010; billing→org readiness bridge | **inter-module** (billing calls on settle) |
| `handleIncomingOrgContextSync(payload)` / `handleIncomingWorkspaceSwitchState(payload)` | payload | void | sync | may update state/dispatch | freshness/DEF-010 | root-private (storage listener) |
| `handleWorkspaceArchived/Restored/Updated()` | — | (current) | — | reconciliation | facade compat | **public via `TruckPackerApp`** |
| `installOrgContextGlobals()` | — | void | sync | assigns `window.OrgContext`, `window.__TP3D_ORG_METRICS__` | must run at current point (5382) | root calls once |

### Billing module — `createBillingService({ ... }) → BillingService`

Injected (frozen — see **Stage 1 Amendment · A1** for the full per-dependency contract): `SupabaseClient`; billing network fns `fetchBillingStatus`/`createCheckoutSession`/`createPortalSession`; and the five **root-owned shared utilities** `isTp3dDebugEnabled`/`normalizeOrgIdForBilling`/`normalizeBillingEntitlementStatus`/`billingDebugLog`/`billingAuthLifecycleDebugLog` (defined in app.js, injected by reference, captured once, never on the facade). **Not injected:** `dispatchEvent` (verified: billing dispatches no window `CustomEvent` — dropped, zero behavior change), `acceptOrgInvite` (used only at root, 7933), `window.OrgContext` (`getActiveOrgIdForBilling` keeps its verbatim global read — Gate-1).

> **Gate-1 correction (verified):** `getActiveOrgIdForBilling` is **NOT injected**. It is a billing-region function (app.js:936) that reads the **`window.OrgContext` global** (`window.OrgContext.getActiveOrgId()`, normalized) with a `localStorage['tp3d:active-org-id']` fallback. Defined at module top level but only *called* after init (post-5382), so the global is always present when read; the localStorage fallback is a deliberate resilience/compatibility behavior, not an implementation detail. **Decision: preserve the `window.OrgContext` global read verbatim** — do not introduce an injected replacement. It becomes a billing-module-internal function reading the global. There is **no readiness callback injected into Billing** (Gate-2); org subscribes to `BillingService.subscribeBilling`.

| Method | Args | Returns | Sync | Guard | Visibility |
|---|---|---|---|---|---|
| `getBillingState()` | — | **copy** (fresh literal) | sync | — | **public** (`window.__TP3D_BILLING`) |
| `subscribeBilling(fn)` | fn | unsubscribe | sync | — | **public** |
| `refreshBilling({force,reason,authoritativeRefresh})` | opts | Promise | async | epoch+org capture/discard/requeue (DEF-011/PREP-3 §5); single-flight; lock; freshness reuse; **must remain wrappable in place** (Audit 10) | **public** |
| `clearBillingState()` | — | void | sync | bumps `_billingEpoch`, resets fields, re-applies gate | post-signout safe | **public** |
| `canUseProFeatures(snapshot?)` / `getProRuleSet()` / `getCheckoutPlanOptions()` | — | (current) | sync | — | **public** |
| `startCheckout(input)` / `openPortal()` | — | Promise<result> | async | DEF-011 capture + pre-nav `isCurrent()` (Audit 7); **shared `_billingActionGeneration`** | **public** |
| `setBillingGateApplier(fn)` | fn | void | sync | binds `_billingGateApplier` once | **root late-bind** |
| `clearBillingAuthoritativeRefreshRequirement(x,reason)` / `markBillingAuthoritativeRefreshForNextSignIn()` | — | void | sync | authoritative-generation lifecycle (billing-region state 165–170) | root-private (cleanup/user-switch) |
| `installBillingGlobals()` | — | void | sync | assigns `window.__TP3D_BILLING` at 2103 point; installs `tp3d-billing` channel + storage listeners | must preserve timing (before init) | root calls once at current point |

> **Root/IIFE — NOT `BillingService` (Stage 1 Amendment):** `maybeScheduleBillingRefresh`, `resetBillingPumpForUserSwitch`, all `_billingPump*` state, and `pickCheckoutInterval` are **IIFE-local root runtime/UI**. They stay in app.js, are exposed via `window.TruckPackerApp` and (for `pickCheckoutInterval`) late-added to `window.__TP3D_BILLING`, and after Stage 1 they *call* `BillingService.*` (e.g. `BillingService.refreshBilling`) but are not owned by it. `pickCheckoutInterval` remains defined inside the IIFE and is added to the facade later at its existing init point (8682), preserving current timing.

### Auth-reaction module — `createAuthReaction({ ... }) → AuthModule`

Injected: `SupabaseClient`, `AuthOverlay`, `getOrgContextSnapshot`/`isOrgContextResolved`/`markOrgContextUnresolved`/`clearOrgContext` (org), `getBillingState`/`clearBillingState`/authoritative markers (billing), `onSignedOutCleanup` (root orchestrator), `renderSidebarBrandMarks`/`AccountSwitcher.refresh` (root UI), `UIComponents`.

| Method | Args | Returns | Guard | Visibility |
|---|---|---|---|---|
| `renderAuthState(authEvent)` | event | Promise | DEF-009 truth checks; calls `onSignedOutCleanup` for signed-out | inter-module (auth listener callback at root) |
| `checkProfileStatus()` | — | Promise | disabled/deleted enforcement; TTL dedupe | root-private (visibility/focus) |
| `requestAuthRefresh()` / `runAuthRefresh()` / `rehydrateAuthState()` | — | Promise | single-flight; DEF-009 freshness | root-private (visibility/focus) |
| `getAuthTruthSnapshot()` / `getCurrentAuthSnapshot()` / `authGateIsSettled()` | — | (current) | — | inter-module (org readiness, root) |
| `isAuthRehydrating()` | — | bool | — | inter-module (AccountSwitcher-later) |
| `setLastAuthUserId(v)` / `setLastAuthEventSnapshot(v)` | v | void | — | root-private (cleanup) |
| `getAuthBlockState()` | — | object\|null | — | root-private (cleanup overlay-phase decision) |

### Composition-root wiring API (app.js)

`markLocalStateReady()` (feeds `workspaceSwitchState.localStateReady` via `OrgContextModule.markWorkspaceSwitchReady({localStateReady:true})`), `getActiveOrgIdForBilling()` (already exists, routes through `window.OrgContext`), `_executeSignedOutCleanup` (retained), storage-scope orchestration (retained).

### AccountSwitcher (deferred) access — resolved

AccountSwitcher will later consume: `getOrgContextSnapshot()` (activeOrg, orgs, role, activeOrgId — **copy**), `isOrgContextResolved()`, `isOrgContextInFlight()`, `isAuthRehydrating()`. **Do not expand `window.OrgContext`** — these are inter-module/root-private accessors on the returned module object, not new browser globals. This resolves the EU-06 blocker permanently.

---

## Audit 4 — Tri-domain readiness state machine

**Fields** (init at 4534): `active(false)`, `fromOrgId(null)`, `toOrgId(null)`, `source(null)`, `startedAt(0)`, `finishedAt(0)`, `version(0)`, `localStateReady(false)`, `orgReady(false)`, `billingReady(false)`, `remote(false)`.

**Completion rule** (app.js:4743 `markWorkspaceSwitchReady`): when `localStateReady && orgReady && billingReady` → `finishWorkspaceSwitch` → `dispatchWorkspaceSwitchStateChanged`. Otherwise dispatch progress.

- **localStateReady** → set by **root** storage orchestration once workspace-scoped state is loaded.
- **orgReady** → `markWorkspaceSwitchOrgReadyIfResolved` (4773): true when `hasWorkspaceSwitchOrgContextReady(toOrgId)` (active org id matches AND named org present).
- **billingReady** → `markWorkspaceSwitchBillingReadyIfSettled` (4780): reads billing snapshot; true when billing org matches `toOrgId` AND settled (`!loading && !pending && (ok+entitlement | error | (!ok && lastFetchedAt))`) or a usable target snapshot exists.
- **auth-gate** supplies identity truth feeding org readiness (via `getSignedInUserIdStrict`); it is a precondition, not a fourth flag.

**DEF-010 ordering:** `lastAppliedWorkspaceSwitchOrder = (transitionAt, stateAt, tabId)`, compared lexicographically (`compareWorkspaceSwitchOrder`); incoming cross-tab payload accepted only when `compareWorkspaceSwitchOrder(incoming) <= 0`; `version` merged as `Math.max` for display only (PREP-3 §4). `nextWorkspaceSwitchDispatchTimestamp` forces local monotonicity.

**Timeout:** `scheduleWorkspaceSwitchTimeout` / `WORKSPACE_SWITCH_MAX_MS` bounds the switch; `clearWorkspaceSwitchTimer` on finish.

**Transition table (current behavior — must be preserved):**

| Scenario | Behavior |
|---|---|
| same-tab switch | begin → org/billing/local marks arrive in any order → finish when all 3 true |
| cross-tab switch | incoming payload gated by `compareWorkspaceSwitchOrder <= 0`; else discarded |
| org resolves first | orgReady set; waits for billing+local |
| billing settles first | billingReady set; waits for org+local |
| storage ready first | localStateReady set; waits for org+billing |
| auth wobble during switch | org readiness re-derives from auth truth; switch not falsely completed |
| stale cross-tab message | rejected by order tuple; local state unchanged |
| failed org bundle | orgReady not set; switch times out via `WORKSPACE_SWITCH_MAX_MS` |
| billing failure | `settled` includes `error` → billingReady set (error is a settled state); switch can complete |
| sign-out during switch | `clearOrgContext` cancels switch (`finishWorkspaceSwitch`/timer clear) |
| user A→B→A | order tuple + version monotonicity prevent regression |
| superseded switch | newer `beginWorkspaceSwitch` supersedes; order tuple gates |

**Ownership model — VALIDATED (candidate confirmed; mechanism corrected by Gate 2):** Org owns `workspaceSwitchState` + all transition methods + event dispatch; root supplies `localStateReady`; **billing readiness reaches org through the existing `subscribeBilling` subscription** — org registers `markWorkspaceSwitchBillingReadyIfSettled` as a billing subscriber (app.js:9241), and `_notifyBilling()` invokes it **synchronously after `_billingState` mutation** (and before the direct gate re-application at the refresh tail, app.js:1737). Stale results are discarded before `_notifyBilling`, so no readiness marking fires for them. Auth supplies identity truth via injected accessor. This keeps the completion rule synchronous and single-owner and requires **no new inter-module callback** — only the existing subscription API. `_billingGateApplier` is a *separate* mechanism: root sets it once to `updateSidebarNotice` (app.js:9239) via `setBillingGateApplier`; `applyAccessGateFromBilling` early-returns when it is absent (app.js:957), so it is safe before binding and never repeatedly rebound.

---

## Audit 5 — Initialization and evaluation order

**Current (must preserve; PREP-2 §13, PREP-5 runtime graph):**
1. `index.html` boot globals + vendors → `__TP3D_BOOT`, `__TP3D_SUPABASE`, `__TP3D_FLAGS__`.
2. `src/app.js` module evaluation: static imports resolve; `initTP3DDebugger()` (line 100); **billing state + `tp3d-billing` channel + `window.__TP3D_BILLING` created at 2103** (module top level, before the IIFE).
3. IIFE builds UIComponents/overlays; constructs editor/scene; **`window.OrgContext` assigned at 5382**; late-bound callbacks; temporary then final `window.TruckPackerApp`.
4. `boot()` → `TruckPackerApp.init()`.
5. `init()`: Supabase init → auth-listener install (guarded `authListenerInstalled`) → unguarded initializer block → `Router.init` → `bootstrapAuthGate` → `markAppReady`; **`pickCheckoutInterval` added to `__TP3D_BILLING` at 8682**.

**After extraction — two-step construction (required):**
- **Step A (construct):** root calls `createBillingService(...)` at the **current 2103 point** and immediately `installBillingGlobals()` (creates channel, storage listeners, assigns `window.__TP3D_BILLING`) — preserving pre-IIFE timing. Root calls `createOrgContext(...)` and `createAuthReaction(...)` inside the IIFE at their current points; `installOrgContextGlobals()` at the **current 5382 point**.
- **Step B (bind late collaborators, after all three exist):** `Billing.setBillingGateApplier(rootGateApplier)`; org receives billing accessors; billing receives `onBillingSettled = OrgContextModule.markWorkspaceSwitchBillingReady`; auth receives org+billing+root callbacks. All bindings are **synchronous, callable once, cannot throw, do not change observable timing**.

**Methods callable before all three connected:** none may fire cross-module before Step B. Billing's channel/storage listeners are installed at Step A but their handlers only *read* billing-private state until a message arrives (post-init); `onBillingSettled` is null-guarded until bound. Org dispatch and readiness are inert until `beginWorkspaceSwitch` (post-init). **Rule:** every late-bound callback is null-checked at call site (existing `_billingGateApplier` pattern).

**Prohibited:** import cycles (none — modules import nothing from app.js; app.js imports the three factories); temporary window globals; duplicate listeners/channels/timers; changed facade timing; changed first-init ownership. `pickCheckoutInterval` stays added at the current init point (8682).

---

## Audit 6 — Auth and sign-out sequencing

**`_executeSignedOutCleanup` exact order (app.js:7330-7416) — RETAINED AT ROOT, preserved verbatim:**
1. compute `hadAuthenticatedSession`; debug log; `document.body[data-auth]='signed_out'`; `stopVisibleAuthRevocationCheck()`; set `lastAuthEventSnapshot` signed-out.
2. **Storage block (P0.9, ordered):** `flushPendingStorageSave()` → `suspendAutoSave=true` → `resetAppStateToEmpty()` → `Storage.setStorageScope('anon')` → `setWorkspaceStorageScope(null)` → `hasLoadedScopedState=false` → `lastLoadedWorkspaceStorageKey=''` → `finally suspendAutoSave=false`.
3. AuthOverlay phase (account-disabled | form | checking) from `authBlockState`/flags.
4. `SupabaseClient.resetAccountBundleCache('SIGNED_OUT')`; `window.__TP3D_LAST_ACCOUNT_BUNDLE=null`.
5. **`clearOrgContext(...)`** (org module call) with `clearLocalOrgHint`/`confirmedNoOrg`.
6. **`clearBillingState()`** (billing) → `clearBillingAuthoritativeRefreshRequirement(null,...)` → conditional `markBillingAuthoritativeRefreshForNextSignIn()`.
7. `window.__TP3D_USER_SWITCH_PENDING=false` (BUG-01 guard release).
8. conditional signed-out toast.
9. `SettingsOverlay.handleAuthChange(event)` → `AccountOverlay.handleAuthChange(event)`.
10. `setLastAuthUserId(null)` (was `lastAuthUserId=null`); `markOrgContextUnresolved()` (was `orgContextResolved=false`); `renderSidebarBrandMarks()`; `AccountSwitcher.refresh()`; clear logout-in-progress.

**Rule:** this sequence stays a single explicitly-ordered function at root. It must NOT be distributed across independent event subscribers. Steps 5/6/10 become module calls (`clearOrgContext`, `clearBillingState`, `markOrgContextUnresolved`) but the *order* is unchanged. DEF-009 A→B→A freshness lives in `src/core/supabase-client.js` (out of scope, unchanged); Auth module consumes its already-guarded results.

---

## Audit 7 — Billing and money-action safety

**Refresh lifecycle (`refreshBilling`, 1239; PREP-3 §5):** capture `_epochAtStart=_billingEpoch` (1393) and `requestedOrgId`; single-flight + cross-tab lock (`billing:inflight:{org}`) + freshness reuse; authoritative-generation force-path; on completion discard if `_billingEpoch !== _epochAtStart` (`refresh:discard-epoch`, 1493) or active org changed (`refresh:discard-stale-org`) and **requeue** for current org; apply state → access gate (`_billingGateApplier`) → storage mirrors (primary `billing:*` + legacy `tp3d:billing:*`) → channel broadcast → diagnostic trace.

**Checkout/portal (DEF-011, `captureBillingActionContext` 1927, PREP-3 §6):** capture shared `_billingActionGeneration` (incremented by both), signed-in status, auth epoch, userId, active org, billing epoch, billing org, `authorityConfirmed` (canManageBilling). If `validAtStart` false → immediate `{ok:false,error:'Billing context changed. Please try again.'}` (no request). Pre-navigation `isCurrent()` re-checks **in this exact order:** generation superseded → signed-out → auth-epoch changed → user changed → active-org changed → billing-org changed → billing-epoch changed → management-authority lost. Failure → same error, **no `window.location.href` assignment**, no state mutation.

**CONFIRMED:** `startCheckout` and `openPortal` **must stay in the same (Billing) module and share the single `_billingActionGeneration` counter.** Every behavior above is DEF-011-protected and unchanged.

---

## Audit 8 — Cross-tab compatibility (no unification, no mirror retirement)

| Surface | Owner | Preserve |
|---|---|---|
| `tp3d-billing` BroadcastChannel; msg `{type:'billing-result',orgId,state,tabId}` | Billing | name, shape, created at 811 (module-eval), stale/wrong-org rejection |
| billing primary keys `billing:inflight/lastFetchedAt/lastState:{org}` | Billing | scope, semantics |
| legacy mirrors `tp3d:billing:lock/fresh/result:{org}` | Billing | **retain** for old tabs |
| `tp3d:org-context-sync` storage transport | Org | payload parity with `tp3d:org-changed` |
| `tp3d:workspace-switch-state-sync` storage transport | Org | `(transitionAt,stateAt,tabId)` + version |
| `tp3d:active-org-id` | Org | auth/user checks |
| tab ids `__tp3d_billing_tab` / `tp3d:org-context-tab-id` / `__tp3d_tab` | Billing / Org / SupabaseClient | **do NOT unify** |
| `window.__TP3D_USER_SWITCH_PENDING` | Root/Billing coordination | preserve cleanup semantics |

Storage `storage`-event listeners for these transports are installed by their owning module's `install*Globals()` at the current timing.

---

## Audit 9 — Events and observable contracts

| Event | Producer (after) | Consumers | Dispatch timing | Preserve |
|---|---|---|---|---|
| `tp3d:org-changed` | Org | app self, Settings, diagnostics, cross-tab | after org state update | name, payload (orgId, reason, userId, confirmedNoOrg?, ts, epoch, tabId, source) |
| `tp3d:org-access-lost` | Org | Settings | on access loss | payload; `notifyOrgAccessLoss` stays private |
| `tp3d:workspace-ready` | Org | app self | at readiness | timing |
| `tp3d:workspace-switch-state` | Org | Settings, browser harness | on switch state change | full detail + order tuple |
| `tp3d:auth-signed-out` / `tp3d:auth-error` | SupabaseClient (unchanged) | Auth module, diagnostics | — | consumed, not produced here |
| `tp3d:profile-updated` | Settings overlay (unchanged) | none confirmed | — | preserve unchanged |
| internal bus `auth:changed`, `session:*`, `storage:*`, `theme:apply`, `app:error` | existing owners | app | — | unchanged |

Dispatch occurs after state/storage updates and before/independent of facade reassignment, per current code — preserved.

---

## Audit 10 — Facade and global compatibility

**`window.__TP3D_BILLING`** (assigned 2103) members — preserve exactly, plus `pickCheckoutInterval` late-added (8682): `getBillingState, subscribeBilling, refreshBilling, clearBillingState, canUseProFeatures, getProRuleSet, getCheckoutPlanOptions, startCheckout, openPortal, selfTest`. All **authoritative/compatibility**. `refreshBilling` **must remain wrappable in place** by diagnostics (debugger wraps it, PREP-2 §7.3) — the module must expose the same live function reference on the facade object, not a bound proxy that defeats wrapping.

**`window.OrgContext`** (assigned 5382) members: `getActiveOrgId, setActiveOrgId, hydrateActiveOrgId, getActiveRole`. **Authoritative.** Do NOT add members.

**`window.TruckPackerApp`** relevant: `maybeScheduleBillingRefresh`, `getWorkspaceSwitchState`, `handleWorkspaceArchived/Restored/Updated` — preserve. **`handleWorkspaceLeft`, `handleOwnershipTransferred`, `notifyOrgAccessLoss` — remain UNRESOLVED / not on final facade / feature-detected (PREP-2 §5.4). The org module return object MUST NOT surface them onto the final `TruckPackerApp` facade.**

**Diagnostic:** `window.__TP3D_ORG_METRICS__` (read-only counters), `__TP3D_BILLING_TRACE_CURRENT_ID__`, debug-only `window.getBillingState` alias (installed when `tp3dDebug`) — preserve as non-authoritative.

---

## Audit 11 — Storage-scope safety (EU-13 stays at root)

Scopes: anon / user / workspace. Transitions on sign-in, sign-out, workspace switch. Root owns `suspendAutoSave`, `hasLoadedScopedState`, `lastLoadedWorkspaceStorageKey`, and the exact P0.9 flush→suspend→reset→scope→clear order (Audit 6). **New module calls from the storage sequence:** `clearOrgContext` (org) and `clearBillingState` (billing) in signed-out cleanup; `markLocalStateReady`→`OrgContextModule.markWorkspaceSwitchReady({localStateReady:true})` after workspace-scoped load. **No module changes storage scope itself** — scope changes stay exclusively at root. This prevents cross-user/workspace leakage.

---

## Audit 12 — Listeners, timers, channels

| Surface | Install timing | Guard | Owner (after) | Static-eval? |
|---|---|---|---|---|
| Supabase `onAuthStateChange` | in `init()` | `authListenerInstalled` (root) | Root installs; callback = `AuthModule.renderAuthState` | no |
| `tp3d-billing` BroadcastChannel | module-eval (811) via `installBillingGlobals` | once | Billing | **created at eval today — preserved (not new)** |
| billing storage listeners | `installBillingGlobals` | once | Billing | preserve current timing |
| org storage listeners (`tp3d:org-context-sync`, switch-state-sync, active-org) | `installOrgContextGlobals` | once | Org | preserve |
| `online`/`offline`, `focus`/`visibilitychange` | `init()` | once | Root installs; handlers call Billing.refresh / Auth.checkProfileStatus | no |
| `workspaceSwitchTimer` (setTimeout) | on `beginWorkspaceSwitch` | cleared on finish | Org | no |
| billing retry/pump timers | inside refresh | self-terminating | Billing | no |

**Rule:** extraction must not create any listener/timer/channel at *static import evaluation* of the new module files. The `tp3d-billing` channel is created today at module-eval of app.js; the billing module's `installBillingGlobals()` is *called by root* at that same point — the module file itself must be side-effect-free on import.

---

## Audit 13 — Failure matrix (owner after extraction; must-not-change)

| Failure | Current behavior | Owner | Invariant |
|---|---|---|---|
| Supabase unavailable | degraded boot, fatal/auth overlay | Root/Auth | reload-only recovery |
| auth refresh failure | ret/skip per DEF-009 | Auth | no wrongful sign-out |
| transient signed-out wobble | org state not wiped | Auth/Org | wobble guard |
| deleted/disabled profile | sign out + disabled overlay | Auth | `checkProfileStatus` enforcement |
| org bundle failure | orgReady not set; switch times out | Org | readiness timeout |
| active org unavailable | confirmed-no-org UI | Org | banner |
| workspace switch timeout | `WORKSPACE_SWITCH_MAX_MS` finish | Org | bound |
| billing fetch failure | error state = settled | Billing | requeue/gate |
| stale billing result | discard (epoch/org) + requeue | Billing | PREP-3 §5 |
| checkout/portal context change | error, no navigation | Billing | DEF-011 |
| BroadcastChannel/localStorage unavailable | localStorage fallback / silent | Billing/Org | fallback parity |
| malformed cross-tab payload | parse guard returns null | Org/Billing | reject |
| unexpected exception (init block) | fatal overlay, reload-only | Root | PREP-3 §2.3 |

---

## Audit 14 — Test coverage gap analysis

**Well-covered (PREP-1 behavioral browser suite `tests/behavioral/app-js-characterization.spec.mjs`, 37 scenarios):** signed-out/signed-in boot, repeated-init ownership, token refresh, A→B→A user switch, same-tab + cross-tab workspace switch, workspace readiness ordering, failed org-bundle recovery, stale billing discard, authoritative generation ownership, offline/online, DEF-009/010/011 (PREP-3 §14). **Source-pattern (audit spec):** DEF-011 guard structure, readiness structure, facade members.

**Gaps / re-points:**
- **Source-location re-points (mandatory before final merge):** audit-spec assertions that read `appPath` for moved functions (billing refresh/checkout guards, org readiness, renderAuthState/checkProfileStatus, `_billingActionGeneration`, `markWorkspaceSwitch*`) → re-point to the three module paths, regexes unchanged.
- **Mandatory before Stage 1:** a small characterization test pinning (a) `window.__TP3D_BILLING` member set + that `getBillingState()` returns a **fresh copy** (identity), and (b) `refreshBilling` remains wrappable in place. These pin the two identity/wrapper contracts the extraction most easily breaks and are currently only implicitly covered.
- **Mandatory before final merge:** full browser matrix green after each stage (owner + non-owner checkout/portal, stale-context no-nav, cross-tab billing freshness, storage isolation, disabled/deleted profile) — the browser gate that has been deferred through M4 **must be re-enabled for this phase**.
- **Deferrable:** unit tests for `compareWorkspaceSwitchOrder` tuple math (nice-to-have; behavior already browser-covered).

No behavior is *entirely* uncharacterized, so a separate characterization-only commit is **not** strictly required — but the two "mandatory before Stage 1" pins should be added as the first commit on this branch.

---

## Audit 15 — Implementation staging and rollback

**Revised order — Billing first is confirmed safest** (state-ownership + dependency-direction rationale — **corrected**; see **Stage 1 Amendment · Corrected Billing-first rationale**. Billing is *not* the fewest-external-reads domain — the move-map found a **large** external surface, ≈48 mechanical retargets across ≈43 lines. Billing is first because its authoritative mutable state and its cross-tab channel + storage mirrors are already concentrated behind an established, characterized facade, Organization depends on Billing settlement, and the large call-site surface is purely mechanical and requires no Organization/Auth ownership transfer):

| Stage | Symbols | Allowed files | APIs needed present | Browser subset | Rollback | Stop condition |
|---|---|---|---|---|---|---|
| **1 Billing+Checkout/Portal+diag** | all `_billing*`, `refreshBilling`, `startCheckout`, `openPortal`, `captureBillingActionContext`, `applyAccessGateFromBilling`, `getActiveOrgIdForBilling` (reads `window.OrgContext` global — Gate-1, **not** injected), facade, channel | app.js, `src/services/billing-service.js`, audit spec | 5 root shared utils injected (A1); `window.OrgContext` global read preserved; `maybeScheduleBillingRefresh`/`updateSidebarNotice`/`pickCheckoutInterval` stay at root | billing refresh, stale discard, cross-tab freshness, owner+non-owner checkout/portal, stale-context no-nav | revert stage commit | any DEF-011/epoch regression |
| **2 Org+readiness+diag** | orgContext, switch state, DEF-010, sync, events, metrics, `window.OrgContext` | app.js, `src/core/org-context.js`, audit spec | billing settle callback bound | same/cross-tab switch, readiness ordering, failed bundle, A→B→A | revert | DEF-010 ordering change |
| **3 Auth reaction+profile** | renderAuthState, checkProfileStatus, refresh scheduling, authGate | app.js, `src/core/auth-reaction.js`, audit spec | org+billing+root callbacks bound | sign-in/out, disabled/deleted, wobble | revert | DEF-009 / wrongful sign-out |
| **4 Integration** | wiring verify, `_executeSignedOutCleanup` calls confirmed ordered | app.js | — | full matrix + repeated-init + storage isolation | revert to pre-stage-1 | any red |

**Temporary state permitted on branch:** partially-moved code between stages (each stage green before next). **Forbidden:** temporary window globals, temporary bridges, cross-stage TODO shims. No stage merges to canonical independently; single `refactor: extract p0 domain coordination` at Stage 4 (or a natural per-stage split, all ff-merged together).

---

## Audit 16 — Hidden-consumer and identity risks (RESOLVED)

- **`getBillingState()` returns a fresh shallow copy every call** (app.js:971) → consumers never hold `_billingState` identity through it. **Decision: `getBillingState()` stays copy-returning; identity preserved.**
- **`getOrgContextSnapshot()` → SHALLOW COPY** of `{activeOrgId,activeOrg,orgs,role,updatedAt}`. Rationale: current direct readers (`orgContext.activeOrg`, `.orgs`, `.role`, `.activeOrgId` in AccountSwitcher/`init`/`renderAuthState`) read fields, not identity; a copy prevents external mutation of live org state. **BUT** verify no reader mutates the returned object or relies on `===` identity across calls (none found in the ~23 external reads — all field reads). `getActiveOrgId()`/`getActiveRole()` remain scalar accessors (already the facade shape).
- **`getWorkspaceSwitchState()` → copy** (already the current shape).
- Direct `_billingState`/`orgContext` variable reads outside owning code (6 + 23 respectively) → re-pointed to accessors; because reads are field/scalar, replacing them does **not** change identity, truthiness, undefined/null behavior, or serialization. Root `init` role-resolution reads `orgContext.role`/`.activeOrgId` → use `getOrgContextSnapshot()`/`getActiveOrgId()`.
- **`refreshBilling` wrapping:** the facade must hold the module's actual function so `window.__TP3D_BILLING.refreshBilling = wrapper(orig)` still works (debugger). **No bound/proxied indirection.**
- Settings/Account overlay feature-detection of `handleWorkspaceLeft`/`handleOwnershipTransferred` → unchanged (absent members stay absent).

---

## Audit 17 — Contract freeze

1. **Ownership:** Billing = all `_billing*` + refresh/checkout/portal/channel/mirrors/diag; Org = orgContext + switch/readiness/DEF-010/sync/events/metrics + `window.OrgContext`; Auth = renderAuthState/checkProfileStatus/refresh-scheduling/authGate; Root = construction+wiring, `_executeSignedOutCleanup` (ordered), storage-scope, boot/init/fatal, auth-listener install, cross-domain sequencing.
2. **APIs:** per Audit 3 (frozen signatures).
3. **Wiring order:** two-step (construct at current points → bind late collaborators), Audit 5.
4. **Retained app.js:** Audit 2/6/11 root rows.
5. **Preserved surfaces:** `window.OrgContext` (4 members), `window.__TP3D_BILLING` (10 + late `pickCheckoutInterval`), events (Audit 9), channels/keys/mirrors (Audit 8), unresolved facade members (Audit 10).
6. **Prohibited:** new globals, facade expansion, unified tab ids, retired mirrors, distributed cleanup, async indirection in the readiness gate, proxied `refreshBilling`, import cycles, static-eval side effects, behavior/storage/format changes.
7. **Unresolved risks:** `authBlockState` sole-writer confirmation; `getOrgContextSnapshot` copy-vs-live final confirmation against every reader; the deferred browser gate must be re-enabled.
8. **Validation matrix:** git diff --check, node --check, eslint new modules, lint, typecheck, full audit (1,140/0/5), **browser matrix after every stage** (13 scenarios listed).
9. **Stop conditions:** any DEF-009/010/011 regression, ordering change, facade drift, or red browser matrix halts the stage.
10. **Approval:**

> **SAFE TO BEGIN**
>
> All four mandatory gates are closed (see Gate Closure below): the `getActiveOrgIdForBilling` contradiction is resolved (preserve global read); the billing→readiness call direction is verified (existing `subscribeBilling` subscription, synchronous); the current-HEAD browser baseline is green (37/37); and the four characterization pins are added and passing (audit 1,144/0/5). Stage 1 (Billing) may proceed under the frozen contract above, with the Stage-1 browser subset (Audit 15) — including live owner/non-owner checkout+portal and stale-context-no-navigation — required before the phase merges.
>
> **Stage 1 (Billing): SAFE TO BEGIN STAGE 1.** The three move-map ownership decisions are now frozen in the **Stage 1 Amendment** (below): shared-utility injection (A1), `applyAccessGateFromBilling`/`setBillingGateApplier` ownership (A2), and the ≈48-site external retarget surface (A3). No production ownership decision remains open; Stage 1 is *move + inject + wire + mechanical retarget*. The live owner/non-owner checkout+portal browser exercise remains a **pre-merge** gate (Stage 1 does not merge; integration merges at Stage 4), not a pre-begin blocker.

---

## Gate Closure (post-review)

**Gate 1 — `getActiveOrgIdForBilling`:** RESOLVED. Defined app.js:936 (billing region, module top level); reads `window.OrgContext.getActiveOrgId()` (normalized) with `localStorage['tp3d:active-org-id']` fallback; 17 callers; only invoked post-init (after the 5382 `window.OrgContext` assignment), so no facade-timing hazard; the fallback is a deliberate resilience/compat behavior. **Rule: preserve the global read; do not inject.** It MOVES into `BillingService` (a module-instance method, off the `window.__TP3D_BILLING` facade) and continues reading the `window.OrgContext` global; its 4 external callers + 1 AutoPackEngine injection retarget to `BillingService.getActiveOrgIdForBilling` (Stage 1 Amendment · A3). Recorded under Billing dependencies (Audit 3), construction/wiring (Audit 5), and prohibited changes (Audit 17).

**Gate 2 — billing→readiness:** VERIFIED. (1) Callers of `markWorkspaceSwitchBillingReadyIfSettled`: the init-registered billing subscriber (9241) plus three direct in-org calls (5315/5347/5602). (2)/(3) Fires on every billing state change via `_notifyBilling` — after success, failure (error is a settled state), clear, cached/freshness reuse, and cross-tab application; **not** after stale-result rejection (discarded before notify). (4) Inspects a `getBillingState()` copy. (5) Synchronous. (6) `_notifyBilling()` runs after `_billingState` mutation; in `refreshBilling` it precedes the direct `applyAccessGateFromBilling` re-call (1737). (7) `_billingGateApplier` set once to `updateSidebarNotice` (9239). (8)/(9) Absent (`null`) from module-eval until init; `applyAccessGateFromBilling` early-returns when absent (957). (10) No repeated binding. **Ownership model confirmed; mechanism corrected to the existing subscription — no new callback.**

**Gate 3 — current-HEAD browser baseline:** GREEN. `node --test tests/behavioral/app-js-characterization.spec.mjs` (via PTY), node v22.23.1, Playwright/Chromium 1.61.1, on this branch HEAD (`c188550` + these gate changes; production code identical to `4f83c32`). **37 passed / 0 failed / 0 skipped**, ~52.9s. Covers DEF-009/010/011-adjacent scenarios: signed-out/signed-in boot, repeated-init ownership, token refresh, A→B→A user switch, same-tab + cross-tab workspace switch, workspace readiness ordering (incl. equal-time tab-ID convergence, newer-remote-progress acceptance), failed org-bundle recovery, stale-auth-epoch billing rejection + authoritative-generation ownership, offline/online billing recovery. **Coverage note (non-blocking):** the suite does not individually script owner/non-owner **checkout/portal** money-action flows; DEF-011 is covered structurally in the audit suite and must be added to the Stage-1 browser subset before Billing merges (Audit 15). No result is non-green.

**Gate 4 — characterization pins:** ADDED (4 tests, `tests/audit/security-and-invariants.spec.mjs`, `P0-CONTRACT …`): (1) `window.__TP3D_BILLING` exactly 10 members + `pickCheckoutInterval` added at init; (2) `getBillingState` returns a fresh object literal, not the live `_billingState`; (3) `refreshBilling` is a writable facade member and the debugger wraps it in place; (4) `window.OrgContext` exactly 4 members with `handleWorkspaceLeft`/`handleOwnershipTransferred`/`notifyOrgAccessLoss` absent. Audit total **1,144 passed / 0 failed / 5 skipped** (was 1,140).

---

## Cited-symbol existence (validation)

All symbols in this contract were confirmed present in `src/app.js` at audit time: `_billingState`(113), `_billingEpoch`(164), `_billingActionGeneration`(1925), `getBillingState`(971), `refreshBilling`(1239), `captureBillingActionContext`(1927), `startCheckout`(2022), `openPortal`(2078), `window.__TP3D_BILLING`(2103), `pickCheckoutInterval`(8682), `workspaceSwitchState`(4534), `markWorkspaceSwitchReady`(4743), `markWorkspaceSwitchBillingReadyIfSettled`(4780), `finishWorkspaceSwitch`(4727), `OrgContext`/`window.OrgContext`(5378/5382), `setActiveOrgId`(5276), `clearOrgContext`(6204), `renderAuthState`(7137), `_executeSignedOutCleanup`(7330), `checkProfileStatus`(~7422). Line numbers are point-in-time anchors.

---

## Stage 1 Amendment — Billing extraction move contract (authoritative)

**Added:** 2026-07-23 · **Verified against** `src/app.js` @ `60bf00b` (9,510 lines; the `window.TruckPackerApp` IIFE begins at **L2311**). Documentation-only. Resolves the three implementation-level ownership decisions the Stage-1 move-map exposed but the base contract left implicit. **Where this section and Audits 3/5/15 conflict for Stage 1, this section governs.**

**Frozen naming.** Module file `src/services/billing-service.js`; factory `createBillingService(deps) → BillingService`; the composition root holds the instance as `BillingService`. This is the billing **domain/state** module and is distinct from the existing **network** layer `src/data/services/billing.service.js` (whose `fetchBillingStatus`/`createCheckoutSession`/`createPortalSession` it consumes). Earlier provisional labels `createBilling`/`BillingModule`/`src/core/billing.js` denote this same module.

**Region shape (verified).** The billing implementation is **module-top-level, before the IIFE**, spanning roughly **L113–L2144** (state at 113; `window.__TP3D_BILLING` facade at 2103–2134; tp3dDebug `getBillingState` window alias at 2137–2144). It is **not a contiguous block**: shared root utilities (`isTp3dDebugEnabled` 828, `billingDebugLog` 841, `normalizeOrgIdForBilling` 929) and unrelated root/auth helpers (e.g. the visible-auth-revocation check ~875) are physically interleaved. **The extraction is therefore symbol-defined, not a line-range cut** — the move set below is authoritative; anything not in it stays at root even when it sits between billing lines.

### A1 — Shared root-utility ownership + Billing injection (frozen)

The five helpers **remain defined in `src/app.js`** as shared root utilities. They are **not** moved into `billing-service.js`; **no** shared-utility module is created in Stage 1. Verified caller distribution (non-billing = callers in the IIFE/root, outside the billing region):

| Helper | Def | Billing-internal callers | Non-billing callers | Reassigned/wrapped? | On facade? | Stage-1 disposition |
|---|---|---|---|---|---|---|
| `isTp3dDebugEnabled` | 828 | 7 | **41** | no | no | RETAIN @ root; inject into Billing |
| `normalizeOrgIdForBilling` | 929 | 19 | **28** (+1 injection ref @3372) | no | no | RETAIN @ root; inject into Billing |
| `billingDebugLog` | 841 | ~34 | **16** | no | no | RETAIN @ root; inject into Billing |
| `billingAuthLifecycleDebugLog` | 202 | 7 | **8** | no | no | RETAIN @ root; inject into Billing |
| `normalizeBillingEntitlementStatus` | 355 | 6 | **3** | no | no | RETAIN @ root; inject into Billing |

Non-billing callers keep calling the root definitions unchanged. Billing's own references to these helpers are satisfied by construction-time injection. **None is reassigned, monkey-patched, wrapped, or rebound anywhere** (verified — only `refreshBilling` is wrapped, and only on the facade object). None appears on `window.__TP3D_BILLING`.

**Frozen `createBillingService` dependency shape** (exact; no duplicate aliases):

| Prop | Source symbol | Owner | Why Billing needs it | Req? | Absent → | Sync? | May throw? | Identity matters? | Rebindable? | Captured | On facade? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `SupabaseClient` | `import * as SupabaseClient` (92) | core import | `getAuthState`/`getAuthEpoch` (captureBillingActionContext 1932–1936), `signOut` (refresh 401 path 1623) | yes | throw at construction | namespace | methods may throw (caught today) | n/a | no | once | no |
| `fetchBillingStatus` | billing.service.js (97) | data/service | refresh fetch (1473) | yes | throw | async fn | yes (caught) | no | no | once | no |
| `createCheckoutSession` | billing.service.js (98) | data/service | startCheckout (2058) | yes | throw | async fn | yes (caught) | no | no | once | no |
| `createPortalSession` | billing.service.js (99) | data/service | openPortal (2085) | yes | throw | async fn | yes (caught) | no | no | once | no |
| `isTp3dDebugEnabled` | app.js root util (828) | **root (RETAIN)** | debug gating in billing logs/trace | yes | throw | sync | no | no | no | once | no |
| `normalizeOrgIdForBilling` | app.js root util (929) | **root (RETAIN)** | org-id normalization in refresh/cross-tab/action guards | yes | throw | sync | no | no | no | once | no |
| `normalizeBillingEntitlementStatus` | app.js root util (355) | **root (RETAIN)** | entitlement normalization in state-apply + pro-rules | yes | throw | sync | no | no | no | once | no |
| `billingDebugLog` | app.js root util (841) | **root (RETAIN)** | billing debug logging | yes | throw | sync | no | no | no | once | no |
| `billingAuthLifecycleDebugLog` | app.js root util (202) | **root (RETAIN)** | auth-lifecycle debug logging | yes | throw | sync | no | no | no | once | no |

**Not injected:** `dispatchEvent` (verified — billing dispatches **no** window `CustomEvent`; communicates only via the `tp3d-billing` channel + storage mirrors; the base-contract `dispatchEvent` entry is dropped, zero behavior change); `acceptOrgInvite` (used only at root, 7933); `window.OrgContext` (**not** injected — `getActiveOrgIdForBilling` keeps its verbatim `window.OrgContext.getActiveOrgId()` read + localStorage fallback, Gate-1). **Rules:** required deps fail loudly at construction; each reference is captured once; **no dynamic rebinding** after construction; **no bind/wrap/clone/memoize/normalize** of any injected reference (none is wrapped today).

### A2 — `applyAccessGateFromBilling` final ownership + gate-applier setter (frozen)

**Traced (verified).** `applyAccessGateFromBilling(billingSnapshot, meta = {})` (957) guards `if (typeof _billingGateApplier !== 'function') return;` then calls `_billingGateApplier(billingSnapshot || getBillingState(), meta)` (960). It reads `_billingGateApplier` (+ fallback `getBillingState()`); it mutates nothing itself. **Internal callers (9):** 642, 684, 1084, 1151, 1320, 1448, 1562, 1612, 1737. **External callers (5):** 6691 (Org), 8256/8300 (Auth/init), 9240 (init subscriber cb), 9242 (init gate-init). `_billingGateApplier` inits `null` (177), is **set once** to `updateSidebarNotice` at 9239, and is never re-nulled. Refresh-tail order (preserve verbatim): `_notifyBilling()` (1736) → direct `applyAccessGateFromBilling(getBillingState(),'refreshed:')` (1737); the subscriber path (registered at 9240) and this direct call **double-apply** the gate by design. Stale results are discarded before `_notifyBilling`. Before binding, all calls are safe no-ops. Cross-tab/init call sites already wrap in try/catch, so an applier throw stays contained as today.

**Decision.** `applyAccessGateFromBilling` is **Billing-owned**; `_billingGateApplier` is **Billing-private state**. `applyAccessGateFromBilling` is exposed as a **module-instance method (PRIVATE MODULE API)** — reachable by the root/other domains as `BillingService.applyAccessGateFromBilling`, but **NOT** added to `window.__TP3D_BILLING`. The 9 internal calls move with the module (order preserved, including the 1736→1737 double-apply). The 5 external calls retarget to `BillingService.applyAccessGateFromBilling(...)`. Access-gate application stays **separate** from the `subscribeBilling` workspace-readiness bridge (Gate-2); no Billing→Org callback, event, Promise, timer, or microtask is introduced.

**Setter — one exact API:** `setBillingGateApplier(fn)`.

| Aspect | Contract |
|---|---|
| Argument | the root gate applier (`updateSidebarNotice`) |
| null / undefined | not passed today; setter stores the reference as-is (the `typeof … === 'function'` guard at 957 remains the sole gate) |
| repeated calls | replace prior (init calls exactly once, 9239) |
| returns | void |
| applies state immediately? | **No** — assignment only; the explicit `applyAccessGateFromBilling(getBillingState(),'gate-init')` at 9242 stays the immediate application |
| may throw? | no |
| before init / after signout / after clear | inert until called; unaffected afterward (never re-nulled today) |
| identity observed? | no (invoked directly, never compared) |
| visibility | **module-instance / root-private — NOT on `window.__TP3D_BILLING`** |

Root wiring 9239–9242 becomes, in order: `BillingService.setBillingGateApplier(updateSidebarNotice)` → `BillingService.subscribeBilling(s => BillingService.applyAccessGateFromBilling(s, { reason: 'billing-subscriber' }))` → `BillingService.subscribeBilling(s => markWorkspaceSwitchBillingReadyIfSettled(s, 'billing-subscriber'))` → `BillingService.applyAccessGateFromBilling(BillingService.getBillingState(), { reason: 'gate-init' })`. (`updateSidebarNotice` and `markWorkspaceSwitchBillingReadyIfSettled` stay at root.) This supersedes Audit-5 Step-B's stale `onBillingSettled` phrasing — there is no such callback (Gate-2).

### A3 — External Billing call-site retarget surface (authoritative inventory)

Every external Stage-1 change is a **mechanical retarget** of a bare symbol to the `BillingService` instance — no change to arguments, await-ness, guards, order, catch behavior, or return handling. Verified inventory (external = outside the moved billing region):

| Symbol | Disposition | External call sites (lines) | Domains | Await / return | Callback identity / `this`? |
|---|---|---|---|---|---|
| `getBillingState` | MOVE (facade) | **10** direct: 2820, 2822, 4782, 5315, 5347, 5602, 6691, 8256, 8300, 9242 | Org (4782, 5315, 5347, 5602, 6691), Auth/init (8256, 8300), root/init (2820, 2822, 9242) | return consumed (sync copy) | invoked, not passed |
| `subscribeBilling` | MOVE (facade) | **2**: 9240, 9241 | root/init | returns unsubscribe (unused) | arg is an arrow (safe) |
| `refreshBilling` | MOVE (facade; debugger-wrapped) | **9**: 2969, 5842, 9297, 9320, 9322, 9323, 9326, 9329, 9330 | Org (2969), root/init (rest) | awaited @2969; else `.catch`/`.then` | invoked, not passed |
| `clearBillingState` | MOVE (facade) | **8**: 5869, 5925, 5961, 5996, 6039, 7107, 7385, 8075 | Org (5869–6039), Auth/root (7107, 7385, 8075) | void | invoked |
| `applyAccessGateFromBilling` | MOVE (**PRIVATE module API**) | **5**: 6691, 8256, 8300, 9240, 9242 | Org, Auth/init, root/init | void | 9240 inside arrow (safe) |
| `getActiveOrgIdForBilling` | MOVE (off-facade method; reads `window.OrgContext`) | **4** direct: 2826, 5637, 7266, 9257 **+1 injection @3367** | root/diag, Auth/root, AutoPackEngine deps | return consumed | **3367 stored bare ref → safe as closure** |
| `getProRuleSet` | MOVE (facade) | **1** direct: 3502 **+1 injection @3369** | diag/UI, AutoPackEngine deps | return consumed | **3369 stored bare ref → safe as closure** |
| `getCheckoutPlanOptions` | MOVE (facade) | **1**: 8490 | UI | return consumed | invoked |
| `startCheckout` | MOVE (facade; money) | **3**: 8724, 8806, 9222 | UI | `.then` | invoked inside arrow |
| `openPortal` | MOVE (facade; money) | **2**: 2862, 9082 | UI | `.then` / void | invoked inside arrow |
| `setBillingGateApplier` (new) | PRIVATE module API | **1** call site: 9239 | root/init | void | n/a |
| `canUseProFeatures`, `_notifyBilling`, `captureBillingActionContext`, `selfTest` | MOVE | **0 external** | — | — | — |
| `maybeScheduleBillingRefresh` | **RETAIN — IIFE-local root** (def 5678; exposed on `window.TruckPackerApp` at 6118/9454) | not moved; ~12 callers stay internal | root/Org/UI | — | itself becomes a `refreshBilling` retargeter (its 5842 call) |
| `normalizeBillingEntitlementStatus` (+ 4 shared utils, A1) | RETAIN @ root | non-billing callers **unchanged** | — | — | — |

**Retained facade-reads (NOT retargeted).** Four pre-existing **defensive** reads via `window.__TP3D_BILLING.getBillingState()` with `typeof … === 'function' ? … : null` fallbacks — 2818–2819, 3496–3497, 5724–5726, 7257–7259 — stay verbatim. Converting them to `BillingService.getBillingState()` would drop the guard/null-fallback semantics, so it is **out of Stage-1 scope** (not a mechanical retarget). The "don't route internal calls through the facade" rule targets *new* facade routing, not these existing guarded reads.

**Verified total: ≈48 mechanical symbol-retargets across ≈43 external lines** (five lines carry two symbols: 6691, 8256, 8300, 9240, 9242), plus 4 retained facade-reads. The earlier "~55" estimate was the right order of magnitude. A fumbled retarget surfaces **loudly** — eslint `no-undef` on the now-moved symbol, plus a runtime `ReferenceError` → red browser suite — not silently.

**Callback/identity resolution (frozen).** The only stored function-reference retargets are the AutoPackEngine deps `getActiveOrgIdForBilling` (3367) and `getProRuleSet` (3369), passed as bare references into a deps object that stores and later calls them. `BillingService.getProRuleSet` / `BillingService.getActiveOrgIdForBilling` passed **bare** are safe because `BillingService`'s methods are **closures over module state and use no `this`** (the same property that makes `getBillingState`'s copy safe). No `(...args) => BillingService.method(...args)` wrapper is needed or permitted. The debugger's `billing.refreshBilling.bind(billing)` is `this`-agnostic (`refreshBilling` ignores `this`), so facade wrapping is preserved. AutoPackEngine is constructed inside the IIFE (3362), after `BillingService` exists at module-eval, so the references resolve.

### Authoritative Stage 1 move map

No `UNRESOLVED BLOCKER` entries remain. Legend: **MOVE** = into `billing-service.js`; **RETAIN** = stays in app.js; **RETARGET** = external caller re-points to `BillingService.*`; **PUBLIC FACADE** = on `window.__TP3D_BILLING`; **PRIVATE API** = module-instance method, off the facade.

| Symbol / surface | Class | Notes |
|---|---|---|
| `_billingState`, `_billingEpoch`, `_billingSubscribers` | MOVE | billing-private state |
| refresh single-flight / queue+requeue / authoritative-generation / lock+freshness / offline-online state | MOVE | billing-private (PREP-3 §5) |
| `_billingActionGeneration` (1925) | MOVE | shared DEF-011 counter; stays single (Audit 7) |
| `_billingTabId` (`__tp3d_billing_tab`) | MOVE | do not unify (Audit 8) |
| `_billingBroadcast` + `tp3d-billing` BroadcastChannel (811) | MOVE | created via `installBillingGlobals()` at current eval point |
| billing storage mirrors `billing:*` + legacy `tp3d:billing:*` | MOVE | retain both (Audit 8) |
| `_billingGateApplier` (177) | MOVE (PRIVATE state) | set via `setBillingGateApplier` |
| `getBillingState`, `subscribeBilling`, `refreshBilling`, `clearBillingState`, `canUseProFeatures`, `getProRuleSet`, `getCheckoutPlanOptions`, `startCheckout`, `openPortal`, `selfTest` | MOVE + **PUBLIC FACADE** | exact 10-member facade preserved |
| `pickCheckoutInterval` | **RETAIN — IIFE-local**; PUBLIC FACADE (late-added @8682) | root defines it; root augments the facade at init |
| `_notifyBilling`, `captureBillingActionContext`, all `_billing*` refresh/lock/freshness/cross-tab helpers | MOVE (private) | billing-internal |
| `applyAccessGateFromBilling` (957) | MOVE — **PRIVATE API** | not on facade; 5 external retargets (A3) |
| `setBillingGateApplier` | **PRIVATE API** (new) | root binds `updateSidebarNotice` once (A2) |
| `getActiveOrgIdForBilling` (936) | MOVE — off-facade method | reads `window.OrgContext` global (Gate-1); 4+1 retargets |
| `clearBillingAuthoritativeRefreshRequirement`, `markBillingAuthoritativeRefreshForNextSignIn` | MOVE — PRIVATE API | mutate billing-authoritative-refresh state (165–170); root cleanup calls them |
| Billing diagnostics/trace (`__TP3D_BILLING_TRACE_CURRENT_ID__`) | MOVE | non-authoritative diagnostic |
| `isTp3dDebugEnabled`, `normalizeOrgIdForBilling`, `normalizeBillingEntitlementStatus`, `billingDebugLog`, `billingAuthLifecycleDebugLog` | **RETAIN — shared root utility** | injected into Billing (A1) |
| `maybeScheduleBillingRefresh` (5678), `resetBillingPumpForUserSwitch` (5667), and all `_billingPump*` state (5661–5665) | **RETAIN — IIFE-local root (billing pump)** | **correction to Audit 2/3:** the billing pump is app-runtime, not billing-module — defined in the IIFE, closes over IIFE scope, exposed on `window.TruckPackerApp` (6118/9454), and only *calls* billing (`refreshBilling` @5842 retargets; `billingDebugLog`/`billingAuthLifecycleDebugLog` are injected root utils). `resetBillingPumpForUserSwitch` is called from Auth cleanup (7106) as a root-internal call (no retarget). Base-contract Audit 2 (line ~93) / Audit 3 (line ~149) listed these under Billing; that is corrected here. |
| `updateSidebarNotice` (gate applier) | **RETAIN — IIFE-local root** | supplied to `setBillingGateApplier` |
| facade assignment timing (2103) + `pickCheckoutInterval` augmentation (8682) | **RETAIN — root composition** | preserve pre-IIFE + init timing (Audit 5/12) |
| `subscribeBilling` readiness registration (9240/9241) | **RETAIN — root composition** (RETARGET to `BillingService.subscribeBilling`) | the callbacks stay at root; the call re-points |
| auth-listener ownership, signed-out cleanup orchestration, Org readiness interpretation, storage-scope orchestration | **RETAIN — root** | Audits 6/11 |
| `window.__TP3D_BILLING` (10 members + late `pickCheckoutInterval`) | **PUBLIC FACADE** | no new member added |
| `window.__TP3D_USER_SWITCH_PENDING`, `localStorage`, `BroadcastChannel`, `document`, `navigator` | platform/root globals | accessed directly by moved code; unchanged |

**MOVE closure-dependency summary:** every MOVE function closes over (a) billing-private state — **moves with it**; (b) the A1 injected dependencies — **provided at construction**; (c) for `getActiveOrgIdForBilling` only, the `window.OrgContext` global — **retained global read**; (d) platform globals (`localStorage`/`BroadcastChannel`/`document`/`navigator`/`window.__TP3D_USER_SWITCH_PENDING`) — **accessed directly, unchanged**. No MOVE function depends on an IIFE-local root symbol except through the retargeted public/private `BillingService` surface.

### Corrected Billing-first rationale

The base contract (Audit 15) described Billing as "most self-contained… fewest external reads." **That is false** and is retracted: the verified external surface is **large** (≈48 mechanical retargets across ≈43 lines). Billing is nonetheless the correct first stage on **state-ownership and dependency-direction** grounds:

- its authoritative mutable state (`_billingState`, epoch/generation, action-generation) is already concentrated at module top level;
- its facade `window.__TP3D_BILLING` is already established and now characterized (4 P0-CONTRACT pins);
- checkout/portal money-action safety (DEF-011) belongs with Billing and must not be split;
- its `tp3d-billing` cross-tab channel and its `billing:*`/legacy storage mirrors are domain-specific;
- Organization depends on Billing **settlement** (readiness `billingReady`), so extracting Billing first gives Organization a stable dependency to bind against;
- the large call-site surface is **purely mechanical** (bare-symbol → `BillingService.*`) and needs **no** Organization/Auth ownership transfer;
- the shared utilities Billing happens to sit beside stay at root via explicit injection (A1), so no non-billing code is disturbed.

**Billing-first is justified by state ownership and dependency direction, not by a small number of call sites.**

### Stage 1 approval

**SAFE TO BEGIN STAGE 1.** All gating items are satisfied: the five shared helpers have permanent ownership (RETAIN @ root + inject, A1); the `createBillingService` dependency shape is exact (A1); `applyAccessGateFromBilling` and `_billingGateApplier` have final Billing ownership with one exact setter `setBillingGateApplier(fn)` (A2); the external retarget surface is fully enumerated with callback/identity cases resolved (A3); no import cycle is required (Billing receives root utilities by injection, imports only `core`/`services`); no new public-facade member is added (`applyAccessGateFromBilling`/`setBillingGateApplier`/`getActiveOrgIdForBilling` are off-facade); and no production behavior decision remains open. Stage 1 is *move + inject + wire + mechanical retarget*.

**Characterization tests:** no new pin is mandatory before writing code — the four existing P0-CONTRACT pins, the full audit suite (1,144/0/5), and the green 37/37 browser baseline cover the pre-begin surface, and a fumbled retarget fails loudly (eslint `no-undef` + browser red). **Recommended (add during Stage 1, before it merges — not in this docs-only run):** (1) a pin that `AutoPackEngine` receives `getProRuleSet`/`getActiveOrgIdForBilling` as callable closures after retarget; (2) the live owner/non-owner **checkout+portal** action-generation exercise already retained as the Stage-1 pre-merge browser gate (Audit 14/15, Gate 3). These are pre-merge, not pre-begin, blockers — Stage 1 does not merge (integration merges at Stage 4).
