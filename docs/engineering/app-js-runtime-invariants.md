# App.js Runtime Invariants

**Status:** PREP-3 controlling reference

**Scope:** Current runtime behavior of `src/app.js` and its directly owned lifecycle collaborators

**Behavioral baseline:** PREP-1 behavioral characterization, PREP-2 public facade and compatibility contract (`docs/engineering/app-js-public-facade-and-compatibility-contract.md`), DEF-009, DEF-010, DEF-011, and the completed TRIAGE-3A through TRIAGE-3D investigations

**Change policy:** `docs/engineering/app-js-preparation-change-policy.md`

## 1. Purpose and scope

A runtime invariant, in this document, is a condition that current code and/or current tests actually enforce at execution time — not a design goal, not an intended future behavior, and not an inference from naming. Every invariant below is traceable to a specific guard in `src/app.js` (or a directly owned collaborator such as `src/core/supabase-client.js`) and, where applicable, to a characterization or regression test that exercises it.

This document covers App.js's own runtime responsibilities:

- application initialization lifecycle and readiness signaling;
- the guards App.js applies to auth-derived results it consumes;
- workspace/organization readiness state that App.js owns;
- billing refresh and billing-action (checkout/portal) protections that App.js owns;
- cross-tab coordination App.js participates in;
- listener, timer, subscription, and module-initializer ownership during App.js's own lifecycle.

Deliberately outside scope:

- the Supabase client's internal session/token refresh mechanics beyond the guards App.js relies on;
- Stripe/webhook server-side behavior (Supabase Edge Functions), except where it changes what a stale browser-side result means;
- AutoPack/Unpack/Truck Change operation-lifecycle guards (`src/core/operation-lifecycle.js`), which are a separate, already-documented subsystem;
- Leave Workspace and Ownership Transfer facade behavior, which PREP-2 already leaves unresolved;
- any UI/visual/wording behavior not tied to a runtime guard.

This document describes current behavior before modularization. It is not a specification for a future rewrite, and identifying a hazard here is not authorization to fix it. Section 13 is the only place future risk is discussed; all other sections describe what the running code does today.

## 2. Initialization lifecycle invariants

`src/app.js` defines the initialization state with two module-scoped variables and one shared boot-state object:

- `initInFlightPromise` (`src/app.js:8273`) — the in-progress attempt's promise, or `null` when no attempt is running.
- `initCompleted` (`src/app.js:8274`) — `true` once an attempt has **settled**, by any outcome.
- `BootState.appReady` (`window.__TP3D_BOOT.appReady`, set by `markAppReady()` at `src/app.js:2162-2168`) — the actual user-facing readiness signal.

### 2.1 Single-flight and repeated calls

- `initInFlightPromise` currently provides initialization single-flight: `init()` (`src/app.js:8276`) returns the same in-flight promise to every caller while an attempt is running (`src/app.js:8277`), so concurrent `init()` callers share the current attempt rather than starting a second one.
- A second `init()` call after any settled attempt — success, expected degraded settlement, or unexpected failure — currently returns `undefined` immediately (`src/app.js:8278`) and performs no work: no module is re-invoked, no listener is re-installed, no network call is repeated. This is a silent no-op, not an error and not a retry.
- `initCompleted` currently means **terminal settlement of the current attempt**, not successful initialization. It is set unconditionally inside a `.finally()` on the attempt's promise (`src/app.js:10179-10182`), so it becomes `true` whether the attempt resolved normally or rejected. Do not read `initCompleted === true` as "the app initialized successfully."

### 2.2 Distinct lifecycle states

The following states are distinct and must not be collapsed:

| State | Meaning | Current signal |
|---|---|---|
| In flight | An attempt is currently running. | `initInFlightPromise` is non-null; `initCompleted` is still `false`. |
| Successfully ready | The attempt ran to completion through the normal path, including the auth gate. | `markAppReady()` called at `src/app.js:10178`; `BootState.appReady === true`. |
| Degraded but ready | An expected, recoverable condition (see 2.3) ended the attempt early, but the app still shows itself as ready for the relevant fallback UI. | `markAppReady()` called at one of the expected-degraded return points; `BootState.appReady === true`; no fatal overlay. |
| Fatally settled | An unexpected exception propagated out of the attempt. | `initCompleted === true`; `BootState.appReady` stays falsy; `BootState.fatalOverlayShown === true`. |
| Reload recovery | The only currently wired recovery action for a fatal settlement. | `window.location.reload()`, triggered by the fatal overlay's "Reload" button (`src/ui/error-overlay.js:65`). |

### 2.3 Expected degraded settlement vs. unexpected failure

- Expected, currently-handled degraded conditions — missing WebGL, missing/slow vendor libraries (`validateRuntime()`, `src/app.js:5150-5204`), and a misconfigured or invalid Supabase configuration (`src/app.js:8305-8355`, including the Stripe-publishable-key-instead-of-JWT case) — call `markAppReady()` and return, so `BootState.appReady` becomes `true` even though the app is only usable for its fallback/error UI in that state. This is current, intentional behavior, not a bug: it lets the pre-boot `error`/`unhandledrejection` handlers in `index.html` (guarded by `boot.appReady`) hand off responsibility to the app's own runtime handlers once a stable state exists.
- The block `AppShell.init(); PacksUI.init(); CasesUI.init(); EditorUI.init(); UpdatesUI.init(); RoadmapUI.init(); SettingsUI.init(); AccountSwitcher.init(); wireGlobalButtons(); KeyboardManager.init();` (`src/app.js:9049-9058`) is currently **not** wrapped in a local try/catch. An exception thrown by any call in this block (or by any other unguarded statement between the start of `init()`'s inner attempt and its final `markAppReady()` call) propagates out of the attempt's promise, which rejects.
- On that rejection path, `markAppReady()` is not reached, so `BootState.appReady` currently remains falsy. `boot()`'s `.catch()` (`src/app.js:10233-10236`) then calls `showFatalOverlay()`, which sets `BootState.fatalOverlayShown = true` and renders the fatal overlay. Dynamic characterization (TRIAGE-3D-B) confirms this: an injected, deterministic throw at `EditorUI.init()` produces `appReady === false` and `fatalOverlayShown === true`, with the facade otherwise intact.

### 2.4 Recovery and retry

- Recovery after an unexpected (fatal) failure is currently reload-only. The fatal overlay's sole action is `window.location.reload()` (`src/ui/error-overlay.js:65`); no other production code path clears `fatalOverlayShown` or re-attempts initialization.
- In-process retry — calling `TruckPackerApp.init()` again on the same page, on the same `window.TruckPackerApp` instance, after a fatal settlement — is currently unsupported. Because `initCompleted` is already `true`, the second call is the same silent no-op described in 2.1: it returns `undefined`, does not re-invoke any of the modules in the unguarded block, and does not clear the fatal overlay or set `appReady`. This is confirmed dynamically: after restoring a working `EditorUI.init`, a second `init()` call never invokes it, `appReady` stays `false`, and `fatalOverlayShown` stays `true`.
- Partial initialization currently has no general teardown contract. Whatever ran before the throw point (for example, the Supabase auth listener installed at `src/app.js:8719-8721`, or `AppShell.init()`/`PacksUI.init()`/`CasesUI.init()` when the throw originates later in the unguarded block) is not unwound. A full page reload is what currently clears this state, by discarding the JS module instance entirely.
- No future Retry control may call `TruckPackerApp.init()` directly in place of `window.location.reload()` without first proving, for every module invoked in the unguarded block, that a second real invocation is idempotent, and separately proving that the fatal overlay can be correctly cleared or transitioned. Neither has been established (see Section 13).

## 3. Authentication identity invariants

These invariants are enforced in `src/core/supabase-client.js` and were established by DEF-009.

- Server-backed user responses are bound to the auth context that initiated the request. `captureAuthRequestContext()` snapshots `{ epoch, status, userId, sessionUserId, authKey, accessToken }` at request start; `isAuthRequestContextCurrent(context)` re-checks all of those fields against live state before a response is committed.
- `getUserRawSingleFlight()`, `getUserSingleFlight()`, and `validateSessionRevocation()` each capture this context before their underlying request and re-validate it both on success and in their `catch` blocks, before the result is used.
- A stale response — one whose captured context no longer matches current state — currently cannot restore or overwrite a different user's state. `getUserRawSingleFlight()`/`getUserSingleFlight()` return the current authoritative user (via `getCurrentAuthoritativeUser()`) instead of the stale payload when the context has moved on.
- A stale `validateSessionRevocation()` result currently cannot sign out the current, still-valid user: when its captured context is no longer current, it returns `{ ok: true, skipped: true, reason: 'stale-auth-context' }` rather than acting on a result that may belong to a different identity.
- Stale results are quarantined at the point of use (they are simply not applied), and stale caches are invalidated proactively: `bumpAuthEpoch()` resets `_getUserRawLastResult`/`_getUserRawLastAt` in addition to incrementing `_authEpoch`, clearing the in-flight-account cache, and clearing the account cache.
- The current authoritative-user fallback (`getCurrentAuthoritativeUser()`) is preserved for every guarded path: it returns `null` for a signed-out state, otherwise prefers `session.user` over `_authState.user` when their IDs disagree, and otherwise falls back to whichever of the two is present.

Relationship among the moving parts:

- **Auth epoch** (`_authEpoch`) is the coarse-grained "has identity possibly changed" counter, bumped on sign-out and other identity-affecting transitions.
- **Authenticated user ID** and **session state** are the finer-grained identity the epoch check is protecting; both `userId` and `sessionUserId` are compared independently because they can diverge (for example, a session update that has not yet been reflected in stored auth state).
- **Single-flight user requests** (`getUserRawSingleFlight`, `getUserSingleFlight`) share the pattern above: capture-before-await, re-validate-before-commit.
- **Session-revocation validation** uses the same capture/re-validate pattern but has a different failure mode: instead of substituting a fallback value, a stale result is simply skipped, because the only unsafe action it could otherwise take is signing the user out.

An async response's validity is not implied merely because its request was valid when it was sent. The request's originating context must still be current at the point the response is consumed; if it is not, the response is discarded or downgraded to a skip, never applied as-is.

## 4. Workspace readiness invariants

These invariants are enforced in `src/app.js` and were established by DEF-010.

- Workspace readiness (`workspaceSwitchState`, dispatched via `tp3d:workspace-switch-state`) is ephemeral UI/lifecycle state describing an in-progress or recently-finished workspace switch. It is not the canonical organization record. Canonical active-organization authority is owned separately (`window.OrgContext`, per the PREP-2 facade contract) and is not mutated by readiness events.
- Cross-tab readiness messages currently carry a globally comparable ordering tuple, computed by `normalizeWorkspaceSwitchOrder()` and compared by `compareWorkspaceSwitchOrder()`:

  `(transitionAt, stateAt, tabId)`

  Comparison is lexicographic: `transitionAt` decides first, `stateAt` breaks a `transitionAt` tie, and `tabId` (string comparison) deterministically breaks a tie on both timestamps.
- The per-tab `version` field is currently **not** the ordering authority for accept/reject decisions. `handleIncomingWorkspaceSwitchSync()` gates every incoming cross-tab payload on `compareWorkspaceSwitchOrder(incomingOrder) <= 0` before applying anything; `version` is only merged afterward as `Math.max(currentVersion, incomingVersion)` for display/bookkeeping.
- A stale "active" (in-progress) transition currently cannot overwrite a newer, already-completed readiness state, and a stale completion currently cannot regress newer state: both the active-transition branch and the completion branch of the incoming-sync handler are behind the same single ordering gate (`src/app.js`, inside `handleIncomingWorkspaceSwitchSync`).
- Same-target progress (a later message about the same switch) may still advance local state when its order tuple is genuinely newer than the last-applied order — the gate compares order, not target identity alone.
- Equal-timestamp messages are resolved deterministically by `tabId` string comparison, so two tabs dispatching at the exact same millisecond do not produce nondeterministic acceptance.
- Workspace-readiness events cannot change canonical organization truth: the handler updates `workspaceSwitchState` and dispatches UI-facing events only; it does not write `window.OrgContext`'s active organization.

Residual risk: `transitionAt`/`stateAt` are wall-clock (`Date.now()`-derived) timestamps, not a logical clock. The risk is bounded because (a) the `tabId` tie-break makes exact-timestamp collisions deterministic rather than racy, and (b) `nextWorkspaceSwitchDispatchTimestamp()` forces each locally-dispatched timestamp to be strictly greater than the last-applied `stateAt`, so a single tab cannot regress its own ordering even under clock coarsening. Cross-machine clock skew is not addressed by this mechanism; it is not currently a concern because all tabs participating in cross-tab sync share one browser/device clock.

## 5. Billing refresh invariants

This section covers `refreshBilling()` and its supporting state — billing **state refresh**, kept separate from the checkout/portal **action** guards in Section 6.

- `_billingEpoch` (`src/app.js:157`) is incremented on sign-out and other identity/access-loss transitions (via `clearBillingState()`, `src/app.js:1113-1145`, which also resets every field of `_billingState` and re-applies the access gate with reason `'clear'`).
- `refreshBilling()` captures `_epochAtStart = _billingEpoch` before issuing its request and, on completion, discards the result if `_billingEpoch !== _epochAtStart` (`src/app.js:1484-1489`, logged as `refresh:discard-epoch`) — a sign-out (or other epoch-bumping event) that happened while the fetch was in flight prevents that stale result from re-hydrating billing state.
- `refreshBilling()` is additionally bound to the requested organization: it captures `requestedOrgId` before the request and, on completion, discards the result if the active organization has since changed (`src/app.js:1491-1505`, logged as `refresh:discard-stale-org`), and re-queues a fresh refresh for the now-current organization instead of applying the stale one.
- Authoritative-generation handling exists for a narrower "must not be skipped" refresh path (`authoritativeRefresh`/`currentAuthoritativeRefresh`, `src/app.js:1234-1237`, `1373-1383`), which forces `force = true` and single-flights per generation via `isBillingAuthoritativeRefreshInFlight`/`beginBillingAuthoritativeRefreshAttempt`.
- Access-loss clearing is `clearBillingState()`: it zeroes every billing field, clears queued-refresh waiters, bumps `_billingEpoch`, notifies subscribers, and re-applies the access gate. `applyAccessGateFromBilling()` (`src/app.js:950-957`) delegates to a late-bound `_billingGateApplier` callback and is defensive against gate-applier exceptions.
- Management authority (`canManageBilling`) is one of the normalized fields returned by `getBillingState()` (`src/app.js:964-994`), alongside `entitlementStatus`, `workspaceIncluded`, `workspaceCount`, `workspaceLimit`, and `billingOwnerUserId`. `refreshBilling()`/`clearBillingState()` treat these as regular state fields subject to the epoch/org guards above; they do not carry a separate freshness mechanism from the rest of `_billingState`.

Billing state refresh answers "is `_billingState` allowed to be updated by this response," gated by epoch and organization. It is a different question from, and must not be merged with, whether a specific checkout/portal action is still allowed to navigate the browser — that is Section 6.

## 6. Checkout and portal action invariants

These invariants are enforced in `src/app.js` and were established by DEF-011.

Each checkout (`startCheckout()`) or portal (`openPortal()`) action currently captures its own context snapshot via `captureBillingActionContext(action)` (`src/app.js:1914-2012`) before issuing its network request:

- shared action generation (`_billingActionGeneration`, incremented on every call to `captureBillingActionContext`, from either function);
- signed-in status (`signedIn`, requiring matching `status === 'signed_in'`, a non-empty `userId`, `sessionUserId === userId`, and a present `access_token`);
- auth epoch (`SupabaseClient.getAuthEpoch()` at capture time);
- user ID;
- active organization ID (`getActiveOrgIdForBilling()`);
- billing epoch (`_billingEpoch`);
- billing organization (`normalizeOrgIdForBilling(_billingState.orgId)`);
- confirmed management authority (`authorityConfirmed`, requiring `_billingState.ok === true`, not loading, not pending, no error, and `canManageBilling === true`).

If the snapshot is not valid at capture time (`validAtStart` false), the action returns immediately without issuing any request:

```text
{ ok: false, error: 'Billing context changed. Please try again.' }
```

If the snapshot was valid at capture time, the action proceeds with its network request. Immediately before consuming a returned checkout/portal URL for navigation, the action calls `actionContext.isCurrent()`, which re-reads the same fields and requires every one of them to still match the captured snapshot, in this check order: generation superseded, signed-out, auth-epoch changed, user changed, active-organization changed, billing-organization changed, billing-epoch changed, management authority lost. If `isCurrent()` fails, the action returns the same `{ ok: false, error: 'Billing context changed. Please try again.' }` result and does **not** navigate.

Documented behavior:

- Checkout and portal currently share one supersession generation (`_billingActionGeneration` is a single module-scoped counter incremented by both `startCheckout()` and `openPortal()`), so a newer checkout call supersedes an older, still-pending portal call, and a newer portal call supersedes an older, still-pending checkout call — either ordering is currently possible.
- Switching user, signing out, switching active organization, losing access, and losing (or not yet resolving) management authority each independently invalidate an in-flight action's result at the pre-navigation check, per the `isCurrent()` reason list above.
- A stale result causes no navigation (`window.location.href` is never assigned) and no auth, billing, organization, storage, or routing mutation — the function returns the error result and nothing else.
- Service-layer Stripe-origin validation remains independently required; the guard described here is a browser-side context check, not a substitute for server-side verification of the Stripe session/customer relationship.
- A stale server request may still have created a real, unused Stripe Checkout or portal session (the server-side call already completed before the pre-navigation check runs), but its URL is never consumed by the browser in that case — the browser simply discards it.

## 7. Cross-tab invariants

App.js participates in cross-tab coordination through the mechanisms already fully catalogued in `docs/engineering/app-js-public-facade-and-compatibility-contract.md` (Sections 10-12: the `tp3d:*` custom events, the `tp3d-billing` and `tp3d-auth` BroadcastChannels, and the associated storage-key families). This section states only the acceptance rules App.js currently applies to what arrives over those channels.

- **Identity changes** and **sign-out propagation**: cross-tab sign-out (`tp3d-auth` channel, `LOGOUT` message, and the `tp3d-logout-trigger` localStorage fallback) is owned by `src/core/supabase-client.js`; App.js reacts to the resulting `tp3d:auth-signed-out` event rather than re-deriving sign-out from raw storage events.
- **Organization/workspace state**: `tp3d:org-changed` and the `tp3d:org-context-sync` storage transport carry organization ID, reason, user ID, timestamp, epoch, and tab ID; App.js's incoming-sync handling is guarded by user, organization, tab, and freshness checks (Section 9 of the facade contract) before it is allowed to change local state.
- **Billing state invalidation**: the `tp3d-billing` channel and its `billing:*`/`tp3d:billing:*` storage mirrors carry a sanitized snapshot; receivers apply type, tab, organization, freshness, epoch, and generation checks (Section 5 above, plus the facade contract's Section 11.1) before accepting a cross-tab billing result.
- **Readiness propagation**: `tp3d:workspace-switch-state` and the `tp3d:workspace-switch-state-sync` storage transport carry the `(transitionAt, stateAt, tabId)` ordering tuple described in Section 4; incoming messages are accepted or rejected by `compareWorkspaceSwitchOrder()` before any local state changes.
- **Source tab identity**: each coordination surface currently uses its own separately-owned tab identifier (`__tp3d_tab` for Supabase/auth, `__tp3d_billing_tab` for billing, `tp3d:org-context-tab-id` for organization context) — per the facade contract, these are not unified into one identifier merely because their values are similar in shape.
- **Timestamp/generation ordering**: each of the three categories above (organization, billing, readiness) has its own ordering/freshness mechanism; there is no single cross-cutting cross-tab clock.
- **Stale event rejection**: in every category above, the currently observed behavior is reject-and-discard (the incoming message is ignored) rather than reject-and-correct (there is no attempt to reconcile or merge a rejected message into local state).

Separation to keep distinct:

- **Canonical persisted authority** — the actual data of record (auth session, active organization membership/role, billing subscription state) lives in Supabase/Stripe and is fetched or refreshed through the guarded paths in Sections 3, 5, and 6.
- **Cross-tab notification** — the BroadcastChannel/storage messages described here are a delivery mechanism for telling other tabs that something changed; they are not themselves the source of truth.
- **Ephemeral readiness** — `workspaceSwitchState` and similar in-flight UI state exist only to drive loading/transition UI and are explicitly not canonical (Section 4).
- **UI reconciliation** — what a given tab's UI does in response to an accepted message (re-render, re-fetch, show a toast) is a further, separate step after the message has already passed its acceptance guard.

BroadcastChannel delivery is not presented here as guaranteed or globally ordered. The localStorage-event fallback paths documented in the facade contract exist precisely because BroadcastChannel delivery cannot be assumed in every browser/tab configuration, and the ordering guards in Sections 4-6 exist precisely because message arrival order across tabs is not guaranteed either.

## 8. Listener and ownership invariants

This section documents only what current code and tests establish; it does not infer cleanup behavior that has not been observed.

- Initialization single-flight (Section 2.1) currently prevents concurrent duplicate installation: while `initInFlightPromise` is set, a second caller receives the same promise instead of triggering a second pass through the module-initializer block.
- A successful repeated `init()` call is currently a no-op with no additional resource acquisition. This is directly covered by the existing behavioral test `repeated init preserves first-init listener, timer, channel, network, and auth ownership` (`tests/behavioral/app-js-characterization.spec.mjs`), which asserts identical instrumentation snapshots and an unchanged Supabase auth-subscriber count across a first and second post-boot `init()` call.
- Auth listener installation has an explicit idempotency guard: `if (!authListenerInstalled) { authListenerInstalled = true; SupabaseClient.onAuthStateChange(...); }` (`src/app.js:8719-8721`). This is the one listener-installation guard in the unguarded module-initializer region that has been directly confirmed, both by inspection and by dynamic characterization (TRIAGE-3D-B): the Supabase auth-subscriber count is unchanged across an unexpected-failure-then-suppressed-retry sequence.
- Some partial initialization ownership currently can remain after a fatal failure. Whatever ran before the throw point in the unguarded block (`src/app.js:9049-9058`) — for example `AppShell.init()`, `PacksUI.init()`, `CasesUI.init()` when the throw originates at `EditorUI.init()` or later — is not unwound; nothing downstream of the throw point ever runs. This was confirmed dynamically: after an injected failure at `EditorUI.init()`, the earlier-installed auth subscription remained registered and no additional BroadcastChannel ownership was acquired by the failure itself.
- No general rollback exists for listeners or module initialization on a failed attempt. There is no teardown routine invoked between the throw and the fatal overlay being shown.
- A full page reload currently clears all of this module-owned state, because it discards the JS module instance entirely and re-runs the module from a clean slate. This is the mechanism, not a designed "cleanup routine."
- Module-level idempotency for every UI initializer in the unguarded block has **not been established**. Only the auth-listener guard above has been directly confirmed. Whether `AppShell.init()`, `PacksUI.init()`, `CasesUI.init()`, `EditorUI.init()`, `UpdatesUI.init()`, `RoadmapUI.init()`, `SettingsUI.init()`, `AccountSwitcher.init()`, `wireGlobalButtons()`, and `KeyboardManager.init()` are individually safe to invoke a second time on an already-partially-initialized page has not been characterized.
- This gap is a direct constraint on future retry support and on modularization: any change that either (a) allows in-process retry of `init()`, or (b) extracts these initializers into separately-invokable modules, must first prove each one's idempotency, per Section 2.4 and Section 13.

Known ownership categories, with current confirmation status:

| Category | Current status |
|---|---|
| Window listeners | Partially confirmed. The `installPrebootInstrumentation()` test harness observes `addEventListener` calls on `window`/`document` and shows a stable set across repeated successful `init()` and across a failure-then-retry sequence; individual production listener installation is not further guarded beyond what is observed. |
| Storage listeners | Not separately characterized beyond the `storage` event's role in the cross-tab mechanisms in Section 7. |
| Auth subscriptions | Confirmed idempotent via the explicit `authListenerInstalled` guard (above). |
| Event bus subscriptions | Not separately characterized for idempotency; the internal event-bus names themselves are catalogued in the facade contract. |
| Timers | Observed via the same test-harness instrumentation as window listeners; not independently guarded beyond that observation. |
| BroadcastChannels | The `tp3d-billing` and `tp3d-auth` channels are each created once during module evaluation, not inside `init()`'s unguarded block, so repeated `init()` calls do not touch them. |
| UI module initializers | Not established (see above); this is the primary open item for future retry/modularization work. |
| Runtime fatal handlers | `installRuntimeFatalHandlers()` (`src/app.js:2230-2232`) has its own explicit guard (`if (BootState.runtimeFatalHandlersInstalled) return;`) and is called once during the outer boot IIFE, not from inside `init()`'s unguarded block. |

Uncertain ownership is marked as such above rather than assumed safe.

## 9. State authority hierarchy

Where currently supported by the guards in Sections 3-7, the authority hierarchy is:

1. Current authenticated identity and auth epoch (`src/core/supabase-client.js` auth state, `_authEpoch`).
2. Canonical active organization and membership/role state (`window.OrgContext`, per the PREP-2 facade contract).
3. Organization-bound billing authority (`_billingState`, `_billingEpoch`, gated on the active organization matching the billing organization).
4. Async operation context and generation (per-call context captures such as `captureAuthRequestContext()` and `captureBillingActionContext()`, and the shared `_billingActionGeneration` counter).
5. Cross-tab readiness and UI reconciliation state (`workspaceSwitchState` and its ordering tuple).

Lower-level asynchronous or cross-tab data currently cannot overwrite newer higher-level authority: an auth result is discarded rather than allowed to override current identity (Section 3); a billing refresh is discarded rather than allowed to override current organization binding (Section 5); a checkout/portal result is discarded rather than allowed to navigate once identity, organization, or authority has moved on (Section 6); a cross-tab readiness message is discarded rather than allowed to regress already-applied ordering (Section 4). In every case, the guard is applied at the point of consuming the async result, not at the point of issuing the request.

## 10. Async result acceptance rule

Based on the guards documented in Sections 3, 5, and 6:

> An asynchronous result may be consumed only when the identity, organization, authority, epoch, and operation generation that authorized or initiated it remain current at its consumption boundary.

This is a description of the pattern already implemented independently in three places (auth results, billing refresh, checkout/portal actions) — it is not a new universal framework, and PREP-3 does not introduce a shared implementation of it. Each of the three call sites keeps its own capture/compare logic.

Examples of the rule as currently applied:

| Async result | What is checked at consumption | Current outcome when stale |
|---|---|---|
| Supabase user result (`getUserSingleFlight`) | epoch, status, userId, sessionUserId, authKey, accessToken | Discarded; current authoritative user returned instead. |
| Session revocation result (`validateSessionRevocation`) | same context fields as above | Discarded; treated as `{ ok: true, skipped: true }`, never signs out. |
| Billing refresh (`refreshBilling`) | billing epoch, active organization ID | Discarded; a fresh refresh is re-queued for the current organization. |
| Checkout URL (`startCheckout`) | action generation, signed-in status, auth epoch, user ID, active org, billing org, billing epoch, management authority | Discarded; no navigation; returns the context-changed error. |
| Portal URL (`openPortal`) | same as checkout, shares the same generation counter | Discarded; no navigation; returns the context-changed error. |
| Workspace readiness message | `(transitionAt, stateAt, tabId)` order versus last-applied order | Discarded; local state unchanged. |

## 11. Fatal, degraded, and recoverable states

Only claims directly supported by the code paths in Sections 2-6 are included.

| State | `BootState.appReady` | User-visible state | Normal interaction allowed | Recovery mechanism | Reload required |
|---|---|---|---|---|---|
| Normal ready | `true` | Application UI | Yes | N/A | No |
| Degraded ready (expected) | `true` | Fallback UI for the specific degraded condition (WebGL/vendor-library message, "can't connect" auth phase) | Only within that fallback UI | User-driven retry action already offered by that fallback UI (for example, reload/retry buttons tied to the specific failure) | Depends on which degraded path; several currently trigger `window.location.reload()` on their own retry action |
| Fatal not-ready | falsy | Fatal overlay ("Something went wrong") | No | Reload button only | Yes |
| Stale async result (auth/billing/action) | Unaffected by this event alone | No visible change; the specific action returns an error or is silently discarded | Yes, app remains interactive | Caller may retry the specific action (for example, re-attempt checkout) | No |
| Access loss (billing) | Unaffected by this event alone | Billing state cleared; access gate re-applied via `applyAccessGateFromBilling` | Yes, for non-gated functionality | Re-authorization (regaining access) triggers a fresh refresh | No |
| Organization transition (workspace switch) | Unaffected by this event alone | Transition UI while `workspaceSwitchState.active === true`, normal UI once finished | Largely yes; specific org-scoped UI may show a transition state | Switch completes normally, or times out via the existing `WORKSPACE_SWITCH_MAX_MS` bound | No |
| Cross-tab readiness update | Unaffected by this event alone | Local readiness UI updates only if the incoming message passes the ordering gate | Yes | N/A (accepted messages just update state; rejected ones are silently discarded) | No |

## 12. Compatibility constraints for modularization

Later App.js extraction work must preserve all of the following, in addition to the modularization preservation gates already stated in `docs/engineering/app-js-public-facade-and-compatibility-contract.md` (Section 16):

- public facade behavior documented in the PREP-2 facade contract (`window.TruckPackerApp`, `window.OrgContext`, `window.__TP3D_BILLING`, their member sets, classifications, and assignment timing);
- event names and timing for every event catalogued in the facade contract and in Section 7 above;
- storage keys and families catalogued in the facade contract;
- BroadcastChannel payload compatibility for `tp3d-billing` and `tp3d-auth`;
- initialization single-flight (`initInFlightPromise`) and the settled-attempt no-op guard (`initCompleted`), as currently implemented — including the fact that `initCompleted` currently represents settlement, not success;
- reload-only fatal recovery, unless a separately approved and characterized redesign changes it;
- the auth-result freshness checks in Section 3 (context capture and re-validation before every guarded auth-derived result is consumed);
- the workspace-readiness ordering in Section 4 (`(transitionAt, stateAt, tabId)` and the single acceptance gate it feeds);
- the billing refresh guards in Section 5 (epoch and organization binding, independent of the action guards in Section 6);
- the checkout/portal action supersession and context validation in Section 6, including the shared generation counter and the exact pre-navigation `isCurrent()` check order;
- the absence of duplicate listener ownership across repeated `init()` calls, as currently observed and tested;
- existing degraded-mode behavior (Section 2.3), including which conditions are treated as expected-and-ready versus unexpected-and-fatal.

## 13. Known hazards and unresolved questions

- `initCompleted`'s naming does not communicate its actual settlement semantics ("this attempt has ended," not "this attempt succeeded"). Any code or future contributor reading the name in isolation is likely to misinterpret it, as PREP-3's own trigger report (the "PREP-3 finding") did for the `markAppReady()` half of its claim.
- In-process retry of `init()` is unsupported today and would be unsafe to introduce without first completing the module-initializer idempotency audit described in Section 8. This is not merely a naming issue; it is a real gap in verified behavior.
- Partial initialization has no rollback contract. A future change that makes retry possible without also adding teardown (or proving idempotency covers its absence) risks duplicated listeners, duplicated subscriptions, or duplicated module state.
- Workspace-switch ordering (Section 4) relies on wall-clock timestamps, bounded only by the `tabId` tie-break and the local monotonicity forced by `nextWorkspaceSwitchDispatchTimestamp()`. It is not a vector-clock or server-authoritative ordering scheme.
- A stale checkout/portal server request (Section 6) may leave behind a real, unused Stripe Checkout or portal session, created before the browser-side pre-navigation check discarded the result. This document does not assert that anything currently reconciles or expires that unused session from the browser side.
- Leave Workspace and Ownership Transfer lifecycle behavior remains outside this document, matching the unresolved facade members already flagged in the PREP-2 facade contract (`handleWorkspaceLeft`, `handleOwnershipTransferred`).
- Not every UI module initializer in the unguarded `init()` block (`src/app.js:9049-9058`) has proven idempotency; only the Supabase auth listener does. This is the single largest open question standing between current behavior and any future retry or modularization work touching that block.
- This document does not itself establish a new public API, change any runtime behavior, or authorize a fix for any hazard listed here. It is a record of current behavior for future preparation work to preserve or deliberately change, one decision at a time.

## 14. Characterization and enforcement references

- App.js behavioral characterization: the PREP-1 real-browser harness and its scenario suite (`tests/behavioral/app-js-browser-harness.mjs`, `tests/behavioral/app-js-characterization.spec.mjs`), covering signed-out boot, repeated-initialization ownership, signed-in boot, token refresh, user switching, same-tab and cross-tab workspace switching, workspace readiness, failed organization-bundle recovery, stale billing results, authoritative generation ownership, offline/online recovery, unexpected initialization failure and reload-only recovery characterization, and expected-degraded initialization.
- Auth/security audits: the repository's audit test suite covering auth, session, and organization-security invariants.
- Billing audits: the repository's billing-focused audit and integration test suites.
- DEF-009 (stale auth-user result protection): enforced in `src/core/supabase-client.js`, characterized in the behavioral test suite referenced above.
- DEF-010 (cross-tab workspace-readiness ordering): enforced in `src/app.js`, characterized in the behavioral test suite referenced above.
- DEF-011 (billing-action redirect context protection): enforced in `src/app.js`, characterized in the behavioral test suite referenced above.
- TRIAGE-3D reload-only recovery tests: the dynamic characterization tests covering unexpected initialization failure, suppressed in-process retry, ownership remaining after failure, and expected-degraded initialization, in the behavioral test suite referenced above.
