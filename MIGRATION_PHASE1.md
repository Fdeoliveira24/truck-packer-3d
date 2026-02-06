# Truck Packer 3D — Phase 1 Migration Notes

## What Changed

- The main app script moved out of `index.html` into `src/app.js` (ES modules).
- Styles moved out of `index.html` into `styles/main.css`.
- A SaaS-ready **mock session** was added (Personal + Organizations, role + plan).
- App data is now **namespaced by organization** in localStorage.
- Feature flags were added (e.g. PDF export / AutoPack gated by plan).
- Hash routing added for static-host compatibility: `#/packs`, `#/cases`, `#/editor`, `#/updates`,
  `#/roadmap`, `#/settings`.

## LocalStorage Keys

- `truckPacker3d:v2:session` — user session + orgs + current org
- `truckPacker3d:v2:data` — preferences + org-scoped app data
- `truckPacker3d:v1` — legacy key (auto-migrated on first run; removed on “Reset demo data”)

## How To Run (VSCode Live Server)

- Open `Truck Packer 3D/index.html` with Live Server.
- Navigate directly via hash routes, e.g. `#/packs`.

## Quick Verification Checklist

1. **Session loads**
   - Click the new topbar **Account** button.
   - Confirm it shows `Personal Account (Owner)`.
2. **Org switching (multi-tenant data)**
   - Account menu → **Create Organization** → name it.
   - Switch between Personal ↔ Org and confirm Packs/Cases differ (new org starts empty).
3. **Feature gating**
   - On Trial, **AutoPack** and **PDF** show an “Upgrade required” modal.
   - To test Pro quickly: edit `truckPacker3d:v2:session` → set `currentOrg.plan` to `Pro`, reload.
4. **Legacy migration**
   - If `truckPacker3d:v1` exists, first load migrates it into `truckPacker3d:v2:data` under org
     `personal`.

## 2026-02-05 — Auth Stabilization + Diagnostics

### Summary

- Added a debugger-level single-flight wrapper for `auth.getSession` to prevent re-entrant calls
  from Supabase internals causing `inflight=2` races during modal opens and token refresh.
- Reduced profile lookup noise by fetching profile status via `.limit(1)` instead of `.single()`.
- `checkProfileStatus()` now uses `session.user` fast path and only calls `getUserSingleFlight()`
  when the session user lacks `banned_until`.

### Observed Before / After (from logs)

- **Before**: `TP3D AUTH ERROR` appeared frequently during modal open and cross-tab activity;
  `RACE: getSession` bursts occurred during `_getAccessToken` and modal open flows.
- **After**: `TP3D AUTH ERROR` reduced to **0–1 per tab per run**; `RACE: getSession` reduced to
  **0–1 per run** and no longer cascaded into freezes.

### Notes

- Auth logic was not changed; only scheduling/deduping and diagnostics were tightened.
- Remaining `getSession` calls on modal open are expected (Supabase internal token access), but now
  share a single in-flight promise.

## 2026-02-05 — Org Context Foundation (Phase 1)

### Summary

- Added an in-app Org Context state (no new files) to track `activeOrgId`, active org, org list, and
  role across auth refreshes.
- Active org resolution now prefers `profiles.current_org_id`, then localStorage, then membership,
  then first org (safe fallback).
- Best-effort persistence of `current_org_id` back to the profile row (rate-limited).
- `tp3d:org-changed` emits only on real org changes, with 500ms dedupe and hidden-tab suppression.
- Auth refresh scheduler now triggers Org Context refresh once per pass (single-flight).

### Steps Taken (High-Level)

1. Added Org Context state + resolver in `src/app.js`.
1. Wired Org Context refresh into the existing auth refresh scheduler.
1. Stored the active org in localStorage for cross-tab continuity.
1. Updated the account switcher label to reflect the active org and role.
1. Added a diagnostic warning severity for `getUserSingleFlight` timeouts.
