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
- Active org resolution now prefers `profiles.current_organization_id`, then localStorage, then membership,
  then first org (safe fallback).
- Best-effort persistence of `current_organization_id` back to the profile row (rate-limited).
- `tp3d:org-changed` emits only on real org changes, with 500ms dedupe and hidden-tab suppression.
- Auth refresh scheduler now triggers Org Context refresh once per pass (single-flight).

### Steps Taken (High-Level)

1. Added Org Context state + resolver in `src/app.js`.
1. Wired Org Context refresh into the existing auth refresh scheduler.
1. Stored the active org in localStorage for cross-tab continuity.
1. Updated the account switcher label to reflect the active org and role.
1. Added a diagnostic warning severity for `getUserSingleFlight` timeouts.

## 2026-02-06 — Org Context (DB + RLS) + Roles UI (Phase 1–2)

### DB Schema (Profiles)

Add a current org pointer to profiles so the app can persist active workspace.

```sql
alter table public.profiles
  add column if not exists current_organization_id uuid;
```

### RLS (Profiles)

Ensure users can read and update only their own profile row:

```sql
-- Read own profile
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

-- Update own profile (includes current_organization_id)
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);
```

### RLS (Organization Members)

Roles UI expects these rules to hold:

- Members can **read** membership list for their org.
- Only **owner/admin** can update roles.
- Only **owner/admin** can remove members.
- Prevent removing the last owner (enforced in UI + DB recommended).

Example policy outline (adjust to your schema helpers):

```sql
-- Members can read their org members
create policy "org_members_read"
on public.organization_members for select
using (exists (
  select 1 from public.organization_members m
  where m.organization_id = organization_members.organization_id
    and m.user_id = auth.uid()
));

-- Owners/admins can update roles
create policy "org_members_update_role"
on public.organization_members for update
using (exists (
  select 1 from public.organization_members m
  where m.organization_id = organization_members.organization_id
    and m.user_id = auth.uid()
    and m.role in ('owner','admin')
))
with check (true);

-- Owners/admins can remove members
create policy "org_members_delete"
on public.organization_members for delete
using (exists (
  select 1 from public.organization_members m
  where m.organization_id = organization_members.organization_id
    and m.user_id = auth.uid()
    and m.role in ('owner','admin')
));
```

### App Notes

- Active org is resolved from `profiles.current_organization_id`, localStorage, membership, or first org.
- Active org persists back to profiles (best-effort).
- Members UI shows list, role editing (owner/admin only), and remove (owner/admin only).
