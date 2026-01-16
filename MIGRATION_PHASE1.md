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
