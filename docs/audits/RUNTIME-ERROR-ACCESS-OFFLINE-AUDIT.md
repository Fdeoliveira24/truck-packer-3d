# RUNTIME / ACCESS / OFFLINE AUDIT

Date: 07/07/2026  
Project: Truck Packer 3D  
Branch context: harden/app-failure-states  
Audit type: Side audit (failure states only, no feature changes)

## Executive verdict

Overall status: **WARN**

The app already has solid primitives for failure handling (404/fatal/maintenance overlays, router not-found pathing, runtime error hooks, and offline/online notifications). The main risks are gaps in scenario coverage and inconsistent user recovery paths, especially after app boot and under degraded network/auth conditions.

## Scope

This audit focused on runtime/access/offline robustness for these scenarios:

- 404 routes and broken deep links
- 401/403 auth and entitlement failures
- post-boot runtime crashes and unhandled promise rejections
- maintenance mode behavior
- offline/online transitions and retriable flows
- startup dependency failures and recovery UX

## Files reviewed

- src/app.js
- src/router.js
- src/ui/error-overlay.js
- src/ui/system-overlay.js
- src/core/browser.js
- index.html

## Findings (ordered by severity)

### 1) High: Post-boot promise failures can degrade without a deterministic fatal path

What is confirmed:

- Global runtime listeners are present (`window.error`, `unhandledrejection`).
- Fatal UI paths exist and can render overlays.

Risk:

- Some asynchronous failures after initial boot can surface as toast/log behavior instead of a deterministic blocker when state integrity is no longer safe.

Impact:

- User may continue in a partially broken state, increasing risk of follow-on errors and corrupted session assumptions.

Recommendation:

- Standardize a clear escalation contract for post-boot unhandled rejections: recoverable vs non-recoverable classification and one authoritative path to a blocking system/fatal overlay when integrity is uncertain.

### 2) High: 401/403 handling exists but recovery UX is inconsistent across flows

What is confirmed:

- Auth/billing branches handle unauthorized/forbidden states.
- Signed-out and billing-related handling is present in app runtime paths.

Risk:

- Different entry points can show different recovery quality (silent retry, toast-only, or partial UI staleness).

Impact:

- Confusing user experience and possible stale state exposure under role/org transitions.

Recommendation:

- Enforce a unified access-failure policy:
  - 401: clear re-auth path and state-safe cleanup.
  - 403: explicit permission context and scoped fallback UI.
  - Ensure all guarded fetch/update flows route through the same handler contract.

### 3) Medium-High: Offline handling communicates status but lacks a resilient operation strategy

What is confirmed:

- Online/offline events are wired.
- User-visible notices are present.

Risk:

- Mutating operations during intermittent connectivity may fail inconsistently without durable retry semantics.

Impact:

- User actions can appear lost or randomly fail, especially during reconnect flapping.

Recommendation:

- Define operation-level offline policy:
  - idempotent retries where safe,
  - explicit "not saved" state where retries are unsafe,
  - reconnect reconciliation for critical writes.

### 4) Medium: Maintenance mode primitives exist but should be treated as a first-class operational mode

What is confirmed:

- Maintenance overlays and boot flags are present.

Risk:

- Behavior can diverge between initial boot and runtime transitions if mode changes mid-session.

Impact:

- Users may remain in interactive state during maintenance windows.

Recommendation:

- Centralize maintenance gating so all critical actions respect maintenance state both at boot and during runtime.

### 5) Medium: Startup dependency failure UX could be more deterministic

What is confirmed:

- Boot checks and multiple overlays exist.
- Browser capability checks (including WebGL) are present.

Risk:

- Vendor/config/bootstrap failures may not always map to one consistent user decision tree.

Impact:

- User may see mixed signals (toast + partial shell + non-actionable errors).

Recommendation:

- Define a startup failure matrix with deterministic outcomes:
  - hard-stop with recovery CTA,
  - safe degraded mode,
  - retry with bounded backoff and explicit messaging.

## Priority implementation phases

## Phase 0 (immediate hardening)

- Add a single post-boot fatal escalation policy for unhandled async failures that threaten state integrity.
- Normalize 401/403 handling through one shared access-failure contract.
- Ensure every privileged or org-scoped request path uses that shared contract.

## Phase 1 (resilience consistency)

- Implement operation-level offline/reconnect policy for mutating flows.
- Add explicit user-state messaging for unsaved/pending operations.
- Align maintenance behavior across boot and runtime transitions.

## Phase 2 (operability and confidence)

- Build a startup dependency failure matrix and map each class to deterministic UX.
- Add lightweight telemetry tags for failure class, overlay type, and recovery action.
- Add failure-mode regression tests for 404, 401, 403, offline-flap, maintenance-on-runtime, and post-boot unhandled rejection.

## Suggested regression checklist

- 404 deep link shows Not Found overlay with clear navigation recovery.
- 401 during active session forces safe re-auth flow and clears stale privileged state.
- 403 shows permission-scoped UI and prevents unsafe action retries.
- Offline during mutating action yields explicit pending/failed state and consistent reconnect behavior.
- Maintenance flag enabled mid-session blocks critical mutations and presents deterministic system state.
- Post-boot unhandled rejection in a critical path triggers deterministic fatal/system overlay.

## Risk summary

Current risk level: **Moderate to High** for production robustness under degraded conditions.

Primary gap is not missing infrastructure, but inconsistent orchestration of existing infrastructure under non-happy paths.

## Final note

This audit intentionally avoids implementation changes and focuses on actionable hardening priorities. The recommended order above reduces user-facing ambiguity first, then improves resilience depth and long-term observability.
