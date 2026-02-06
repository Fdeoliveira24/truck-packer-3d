# Auth Session Race Audit — 2026-02-05

Date: 02/05/2026 Scope: Truck Packer 3D auth/session behavior, getSession races, visibility
handlers, and UI rehydrate flow.

## Summary

Observed getSession call bursts and race markers across single-tab and multi-tab usage. Most race
markers are call-level concurrency (multiple callers hitting the wrapper) but can still translate
into UI churn and overlapping rehydrate paths. Two visibility handlers (app + supabase-client) can
overlap and trigger redundant session reads. Several entry points call rehydrate/auth flows around
auth events, visibility changes, and settings/account modal activity.

## Issues and Risks Observed

### 1) Visibility handler does nothing on null session

Location: `Truck Packer 3D/src/app.js:3093` Severity: P3

If `SupabaseClient.getSessionSingleFlightSafe()` returns null, the handler exits without calling
`renderAuthState()`. If an auth event is missed or suppressed (storage race, cross-tab timing), the
UI can remain stale until the next auth event.

### 2) Duplicate visibility handlers trigger redundant session reads

Location: `Truck Packer 3D/src/app.js:3088` and `Truck Packer 3D/src/core/supabase-client.js:862`
Severity: P2

`app.js` installs a `visibilitychange` handler that calls `getSessionSingleFlightSafe()` and then
`rehydrateAuthState`. `supabase-client.js` installs its own `visibilitychange` handler that runs
`validateSessionOrSignOut()` which also calls `getSessionSingleFlightSafe()` and
`getUserSingleFlight()`. This overlap doubles session access and can race with auth updates across
tabs.

### 3) Auth guard visibility handler overlaps with app handler

Location: `Truck Packer 3D/src/core/supabase-client.js:862` Severity: P2

The auth guard’s visibility handler runs `validateSessionOrSignOut()` during visibility changes,
while the app also runs its own visibility handler. The overlapping calls can lead to redundant
session reads and in-flight auth state churn.

### 4) Cooldown is consumed before session existence is known

Location: `Truck Packer 3D/src/app.js:3089` Severity: P3

The visibility handler calls `canStartAuthRehydrate()` before `getSessionSingleFlightSafe()`. This
advances the cooldown even if no session is available or the call fails, suppressing near-term
rehydrate calls that may be needed after real auth events.

### 5) Race markers still occur after auth events and modal opens

Severity: P3

Single-tab logs show bursts of `CALL getSession` + `RACE: getSession` around:

- Auth events (SIGNED_IN / SIGNED_OUT)
- Settings/Account modal opens (MODAL ADDED)

This matches the code paths:

- App-owned: `rehydrateAuthState()` → `getSessionSingleFlight()`
- Supabase internal: `supabase.min.js` → `_getAccessToken()` → `auth.getSession()`

Note: These race markers represent call-level concurrency, not necessarily multiple network
requests, but still indicate overlapping callers.

### 6) UI churn risk during auth rehydrate + settings overlay

Severity: P3

`openSettingsOverlay()` calls `rehydrateAuthState()` immediately. Settings overlay also triggers
account bundle fetches that run parallel Supabase queries, which can trigger internal
`_getAccessToken` reads. Combined with visibility events, this can create overlapping rehydrate and
UI-refresh activity.

## Single-Tab Log Highlights (User2 -> User21)

Observed call bursts:

- ~13478ms: AUTH EVENT → 3 getSession calls + races
- ~17338ms: MODAL ADDED → getSession
- ~51771ms: AUTH EVENT → 3 getSession calls + races
- ~55797ms / ~64130ms: MODAL ADDED → getSession
- ~70621ms: LOGOUT → AUTH EVENT → getSession

No explicit JS error is present in this single-tab log. The visible issue is repeated call bursts
around auth events and modal opens.

## Notes

- Supabase internals (`_getAccessToken`) call `auth.getSession` and are not fully controllable at
  the app layer.
- Current wrapper changes reduce duplicated network fetches, but race markers remain when multiple
  callers are active in the same timeframe.

## Next Test Inputs Requested

For two-tab test follow-up:

- Any JS error stack if a crash occurs
- Output of `window.__TP3D_DIAG__.getEventsByType('RACE: getSession').slice(-10)`
- Settings modal state check:
  - count of settings modals
  - active tab vs visible panel

## Steps Taken (as of 02/05/2026)

1. Added single-flight + cooldown wrappers for `auth.getSession` / `auth.getUser`, and patched
   Supabase auth methods to route through safe wrappers.
1. Added session-hint usage after auth events to avoid extra `getSession` calls and reduce
   `AUTH EVENT → getSession` cascades.
1. Added a shared auth rehydrate cooldown in `app.js` to prevent back-to-back rehydrate bursts.
1. Updated visibility handling to avoid forcing account bundle refresh unless an overlay is open;
   added signed-out UI fallback on null session.
1. Added diagnostics: `SUPABASE WRAP STATUS`, `TP3D AUTH ERROR`, `RUNTIME SNAPSHOT`, and persisted
   event capture for post-freeze inspection.
1. Added cached-first + async refresh behavior in Account/Settings overlays to reduce blocking modal
   opens.
1. Guarded `getAuthedUserId()` to skip `getUserSingleFlight()` when hidden or token missing, and
   emit serialized auth errors.
1. Added a single refresh scheduler (`requestAuthRefresh`) with 350ms debounce and single in-flight
   refresh, using `getAuthState()` once and wiring auth/visibility/storage/org-changed/modal-open
   triggers to it.
