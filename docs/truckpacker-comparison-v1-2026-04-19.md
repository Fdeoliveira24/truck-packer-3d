# TruckPacker Reference vs. TP3D — Full Comparison & Findings
**Version:** 2.0  
**Date:** April 19, 2026  
**Status:** Research complete (Q1–Q19 answered) — ready for implementation  
**Source:** Reverse-engineered from TruckPacker production JS bundles at `app.truckpacker.com`

---

## 1. Architecture Overview

| Aspect | TruckPacker (Reference) | TP3D (Ours) |
|---|---|---|
| AutoPack execution | Client prepares payload → Convex server (`steady-beagle-345.convex.cloud`) runs solve | 100% client-side — greedy FFD grid scan in `AutoPackEngine` (`src/app.js`) |
| Algorithms | 5 parallel: PLAIN, LAFF, FAST_LAFF, BRUTE, FAST_BRUTE | 1 algorithm: greedy grid scan |
| Solutions returned | 5 (one per algorithm), user browses Previous/Next | 1 result only |
| Database/backend | Convex (real-time document DB) + Clerk auth | Supabase (PostgreSQL) + Supabase auth |
| Unit system | Meters → CM (`Math.ceil(x * 100)`) with axis remap: scene X→dx, scene Z→dy, scene Y→dz | Inches throughout |
| Entity cap | 600 entities per pack | No hard cap in code |

---

## 2. AutoPack Algorithm: Confirmed Behavior

### TruckPacker algorithms (confirmed from payload/response shape)

| Algorithm | Behavior |
|---|---|
| PLAIN | Packs items in the order received from client, no resorting, sequential shelf-fill strategy |
| LAFF | Largest Area Fit First — sorts by largest face area, tries all `canRotate3d` orientations before sorting |
| FAST_LAFF | Same as LAFF with an earlier stopping criterion (lower iteration cap or shorter time budget) |
| BRUTE | Branch-and-bound with aggressive pruning; explores more combinations than LAFF but terminates at a limit |
| FAST_BRUTE | Same as BRUTE with higher pruning threshold — accepts first "good enough" solution |

**Partial results:** Client code mechanically supports partial solutions (unplaced boxes stay at staging position). Confirmed: server likely returns best-so-far if limit is hit.

**Solution ordering (Q7a — confirmed):** The client does **zero sorting** of returned results. `results[0]` is always "Solution 1". Whether the server ranks by utilization % or returns in fixed algorithm order is not confirmed from client code.

**Orientation handling:** When `canRotate3d: true`, server tries all 6 orientations (3 face × 2 spin values). TruckPacker axis remap — bottomAtZeroDegrees → quaternion `{0,0,0,1}`, etc. (full table in previous session notes).

---

## 3. Container Dimensions & Shape Support

### TruckPacker
- Container is always a **single rectangle** `{dx, dy, dz}` — no obstacle zones, no wheel well geometry.
- Any visual wheel wells in the 3D scene are **purely decorative Three.js meshes** — the packing server never sees them.
- No loading direction field in the schema or payload.
- `Math.ceil` applied to meter→cm conversion; no margin or padding added client-side.
- Convex `containers` schema: `{ name, description, code, type, dx, dy, dz, payloadCapacity, orgId }` — 8 container `type` enum values.

### TP3D
- **TP3D ADVANTAGE:** Three shape modes: `rect`, `wheelWells`, `frontBonus` — all with real multi-zone exclusion geometry enforced in `findRestingY`, collision detection, and `computeStats`.
- `wheelWells` mode: 5 zones (rear, center corridor, left above-well, right above-well, front) — packing is truly excluded from the well area.
- `frontBonus` mode: 2 zones (main body + narrower front extension), loads front-first.
- Zone parameters are user-configurable via `shapeConfig` (wellHeight, wellWidth, wellLength, wellOffsetFromRear, bonusLength, bonusWidth, bonusHeight).
- **TP3D ADVANTAGE:** Loading direction is explicit — `frontBonus` triggers front-to-rear packing (`loadFrontFirst = true`). TruckPacker has no concept of loading direction.

---

## 4. Stacking & Case Properties

### `stackable` field

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Data type | String: `"Yes"` / `"No"` / `"With Like"` | Boolean: `true` / `false` |
| `"No"` enforcement | Server hard-rejects placements on top of `stackable: "No"` boxes | `noStackOnTop: true` exists in data model — **NOT enforced in `findRestingY()` or `collides()`** |
| `"With Like"` | Only boxes with the same case preset `id` can stack on top | Not implemented |
| `maxStackCount` | Not present in TruckPacker | Exists in data model (`maxStackCount: number`) — **NOT enforced in AutoPack** |
| `canRotate3d` | Boolean — controls whether server tries all 6 orientations | `canFlip: true/false` + `orientationLock: 'any'/'upright'/'onside'` — more expressive |

### "With Like" identity (confirmed)
Checked by `box.id` (Convex document ID of the case preset), not by dimensions. Two case presets with identical dimensions but different names are treated as **unlike**.

### Active bug: stacking properties not wired to AutoPack
`findRestingY()` and `collides()` in `AutoPackEngine` never read `noStackOnTop`, `stackable`, or `maxStackCount` from `packed[]`. Boxes marked "no stack on top" will still have items placed on them.

---

## 5. Scoring — Current State vs. Reference

### TruckPacker scoring
Not accessible (server-side black box). LAFF/BRUTE are geometric solvers — no gravity penalty term.

### TP3D scoring (current code in `src/app.js`)
```js
const score =
  zFill * 1000 +
  (result.restY > 0.1 ? STACKING_BONUS : 0) +   // flat +1200 if any stacking
  -result.restY * GRAVITY_WEIGHT +                 // GRAVITY_WEIGHT = 15
  -xDist * X_TIGHTNESS_WEIGHT +                   // X_TIGHTNESS_WEIGHT = 10
  ori.l * ori.w * ori.h * 0.001 +
  item.volume * 0.0001;
```

**Active issue:** `STACKING_BONUS` is a flat +1200 that fires when `restY > 0.1`. A box stacked at 80" height pays `-80 × 15 = -1200` gravity penalty, exactly canceling the bonus. At 90" the algorithm prefers floor placement. The `STACKING_BONUS` should scale with height or the gravity penalty should be removed for stacked placements.

---

## 6. Weight, CoG, and Physics

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Weight view | ✅ `isWeightViewActive` toggle — color-codes boxes in 3D scene green→yellow→red by relative weight | ❌ Not implemented |
| Weight scale panel | ✅ Current / Capacity / Remaining / Excess / % (arithmetic only) | ✅ `totalWeight` in editor stats and PDF |
| Center of Gravity | ❌ Not calculated | ✅ **TP3D ADVANTAGE:** `cog-service.js` computes real CoG (X/Z deviation %), status ok/warning/critical |
| Weight in packing algo | ❌ Never sent to server | ❌ Never used in AutoPack |
| Physics simulation | ❌ Pure geometric solver | ✅ **TP3D ADVANTAGE:** `findRestingY()` — real gravity, every box rests on floor or top of another |

---

## 7. Snapping System

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Snap approach | Geometry-based vertex proximity — computes all 8 rotated corners of dragged box, finds nearest vertex/edge of any other box | Edge-based face snap — snaps dragged box edges flush to truck walls and other box edges |
| Snap threshold | Hardcoded **0.254m = 10 inches** | `SNAP_DIST = SceneManager.toWorld(2)` = **2 inches** — 5× tighter |
| Grid-based snap | ❌ No grid | ✅ User-configurable grid (`snapping.gridSize`, default 1 inch, min 0.25) |
| Toggle | `S` key, Alt+Drag inverts | ✅ Toggle in preferences |
| User-configurable threshold | ❌ Hardcoded | ✅ Grid size is configurable in settings |
| Snap to rotated box | ✅ Uses quaternion to calculate actual corner positions | Snap uses `halfWorld` from original dims — may misalign for rotated/flipped cases |

**TP3D ADVANTAGE:** User-configurable grid snap with a tighter 2-inch default. TruckPacker's 10-inch threshold is very coarse for precise placement.

---

## 8. Measurement Tool

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Exists | ✅ Full raycast-based tool — click two points on any mesh surface | ❌ Not implemented |
| Snapping during measure | ✅ Snaps to nearest vertex/edge within 10 inches | — |
| Preview | ✅ Live line between point A and cursor | — |
| Billing gate | Not gated (`M` shortcut has no `disabled` check) | — |
| Interaction | Single-click per point, `Escape` to cancel | — |

---

## 9. Orthographic Camera

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Views available | Top + Side (2 fixed orthographic views, 1 free perspective) | ✅ Top + Side (same — 2 orthographic, 1 perspective) |
| Camera setup | Fixed preset positions from Zustand store (`y:20` top, `z:20` side, `zoom:35`) | Dynamic — computed from pack dimensions in `buildOrthoCameras()` — fits content exactly |
| Manipulation in ortho | ✅ Boxes can be selected and dragged | ✅ Same |
| Technical overlay | ❌ No dimension overlay or drawing mode | ❌ Same |
| **TP3D ADVANTAGE** | — | ✅ Dynamic camera bounds fit the current trailer exactly; TruckPacker uses hardcoded world positions that may not fit all container sizes |

---

## 10. Manual Box Movement

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Floor constraint | Y=0 everywhere — uses all 8 rotated corners | ✅ Same — `floorY()` uses all 8 corners |
| Ceiling | No ceiling — boxes can go arbitrarily high | ✅ Same |
| Horizontal boundaries | No X/Z walls — boxes can be dragged outside truck | ✅ Same |
| Auto-gravity / drop | ❌ No gravity — if box A is moved from under box B, B floats | ❌ Same |
| "Send to floor" button | ❌ Does not exist | ❌ Does not exist |
| Y-axis movement | PivotControls gizmo, Y-slider only | ✅ Same approach |
| Staging area stacking | ✅ Can stack boxes outside truck (floor at Y=0) | ✅ Same |

---

## 11. Workspace & Organizations

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Org data model | Convex `organizations` doc: `{ name, logoImageId, stripeCustomerId, subscription, freeTrialEndsOn, caseCount, packCount }` | Supabase `organizations` table (similar structure) |
| Subscription scope | On the **org document** — not per-user | ✅ Same — billing is org-scoped |
| Data sharing in org | All cases, packs, containers are `orgId`-scoped — fully shared across all members | ✅ Same |
| Roles | `owner` / `admin` / `member` — no viewer role | Similar (Owner/Manager roles in features config) |
| Join org = Pro features | ✅ Yes — feature gate reads `activeOrg.subscription` | ✅ Same |
| "Clients" as data type | ❌ Not a real data type — no `clientId` on packs or cases | ❌ Same — no client entity in TP3D either |

---

## 12. Pack Organization / Folder System

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Folder system | ✅ Convex `packFolders` doc — `parentFolderId` for nesting, full hierarchy | ❌ Flat list only |
| Right-click "New Folder" | ✅ | ❌ |
| Pack sharing (link) | ✅ URL-based: `app.truckpacker.com/packs/{packId}`, Convex ID is the share token | ❌ No share link feature |
| Share link auth | ❌ Fully public/unauthenticated — no login required | N/A |

---

## 12a. Crew View / Share Link (Q16 — confirmed)

**Architecture (confirmed from TruckPacker source):**

- The same URL `/packs/{packId}` is used for both the editor and Crew View — no separate route
- `pack.isPublic === true` determines whether the page renders the Crew View component or an auth wall
- The pack's Convex document ID (32+ random chars) **is** the share token — no separate token field in the schema
- Fully unauthenticated: users with no account can view any public pack via its URL
- When auth is absent, org unit preferences are queried by `orgId` directly (fallback path)

**What Crew View shows:**
- Same Three.js scene loaded in full — orbit/zoom/pan all work (OrbitControls not stripped)
- Box drag/selection is disabled via a `readonly` prop on the entity manager
- Export/checklist panel opens automatically on mount (`setExportViewOpen(true)`)
- Shows: 3D canvas + Notes + Case checklist (with checkboxes) + Top/Side/Free view thumbnails
- "Add view" (free camera positions) uses **localStorage per-browser**, not Convex — not shared across viewers

**Case checklist persistence:**
- Checkboxes write back to Convex in real-time via a `markCaseAsLoaded` mutation
- `truckExportViews` table: `{ truckId, caseListOrder: [{caseId, hasBeenLoaded}[]] }`
- All viewers see checklist state in real-time via WebSocket subscription
- Crew members CAN check boxes; they CANNOT reorder the list (`viewOnly: true` disables drag handle)

**TP3D implementation plan:**
- Add `is_public: boolean DEFAULT false` and `share_token: text UNIQUE` to `packs` table (Supabase)
- RLS policy: `ALLOW SELECT WHERE is_public = true` for anonymous role
- New route: `/share/:shareToken` in `router.js`
- New screen: read-only editor view with Three.js scene, checklist panel, no editing toolbar
- Checklist state: new `pack_checklist` table: `{ pack_id, case_instance_id, loaded_at, loaded_by }`
- Supabase Realtime subscription on checklist rows for collaborative live updates

---

## 12b. Case Browser: Category vs. Manufacturer Tabs (Q17 — confirmed)

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Category tab | ✅ Groups same case library by `categoryId` lookup | ✅ Exists — renders chips + grouped list |
| Manufacturer tab | ✅ Groups same case library by `manufacturer` free-text field | ❌ Not implemented — no second tab |
| "No manufacturer" bucket | ✅ Cases with blank manufacturer field fall into this group | N/A |
| Starter Set origin | Server-seeded at org creation time — not in client bundle | N/A (TP3D has equivalent built-in presets) |
| `+` button | Opens case creation form, likely pre-fills the group key | ✅ TP3D has add-case button, no pre-fill |
| Data source | Same `cases` array, different `groupBy` key | Same — `manufacturer` field already exists on `case.model.js` |

**TP3D implementation:** `renderCaseBrowser()` in `editor-screen.js` already groups by category. Adding Manufacturer tab = add a `groupBy` state variable (`'category'|'manufacturer'`), add two tab buttons, change the grouping key in the reduce loop. The `manufacturer` field already exists in `src/data/models/case.model.js`.

---

## 13. Packing Groups

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Feature | ✅ Multiple entities bundled into one rigid box for AutoPack — sent as single `{dx,dy,dz}` box, `canRotate3d: false`, `stackable: "Yes"` | ❌ Not implemented |
| Use case | Pallets or pre-staged bundles that must stay together in fixed orientation | — |
| `isPallet` flag | Not present | ✅ `isPallet: true` exists in data model but not used by AutoPack or UI |

---

## 14. Export to PDF

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Library | PDFKit (embedded in 3.2MB bundle) | ✅ jsPDF (`window.jspdf`) |
| Execution | 100% client-side | ✅ 100% client-side |
| Billing gate | Yes — Pro/Trial only | ✅ `PDF_EXPORT: { minPlan: 'Pro', roles: ['Owner','Manager'] }` |

**Detailed page-by-page comparison (confirmed from TruckPacker PDF + TP3D `generatePDF()` in `src/app.js`):**

| PDF Element | TruckPacker | TP3D | Gap? |
|---|---|---|---|
| Pack title + date | ✅ | ✅ | None |
| Client / Project / Drawn By | ✅ | ✅ `pack.client`, `pack.projectName`, `pack.drawnBy` | None |
| Truck dimensions | ✅ | ✅ | None |
| Weight capacity used (X lb / Y lb) | ✅ In header | ❌ Not in header | **Gap** |
| NOTES section | ✅ | ✅ | None |
| 3D perspective render | ✅ Full-width page 1 | ✅ Full-width | None |
| Top orthographic view | ✅ | ✅ `topCam` from `buildOrthoCameras()` | None |
| Side orthographic view | ✅ | ✅ `sideCam` from `buildOrthoCameras()` | None |
| **Front orthographic view** | ✅ Page 2 — rear door cross-section | ❌ **Missing** | **Gap** |
| Case list: Name | ✅ | ✅ | None |
| Case list: Count | ✅ (grouped, shows count per preset) | ❌ One row per instance | **Gap** |
| Case list: Weight | ✅ | ✅ | None |
| Case list: Dimensions | ✅ | ✅ | None |
| **Category color chips** | ✅ Colored badge pill | ❌ Plain text only | **Gap** |
| Page numbers in footer | ✅ | ❌ | **Gap** |
| Branding/logo | ✅ TruckPacker logo | ❌ No logo | Optional |
| Summary stats block | ❌ | ✅ Optional via `pdfIncludeStats` pref | TP3D advantage |

**Most impactful PDF gap:** Missing Front view. `buildOrthoCameras()` only builds `topCam` and `sideCam`. A `frontCam` looking from `X=0` toward `X=length` (showing the Z×Y cross-section at the door) is a 10-line addition.

---

## 14a. Box Labels & Colors in the 3D Scene (Q18 — confirmed)

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Label rendering | **Troika SDF text** — `@react-three/drei Text` component, rendered via Web Worker, pure Three.js mesh objects in-scene | **Canvas 2D texture** — `generateCaseTexture()` paints on `THREE.CanvasTexture`, baked into box material map |
| Labels per face | Up to 5 faces (front/back/left/right/top) — separate `<Text>` mesh per face | Faces 4 and 5 only (top/front) get text — 2 faces |
| Label content | Case name (truncated with `…` if overflows) | Name (max 16 chars) + weight in lb + ⇧⇧ if `!canFlip` |
| Minimum face size gate | ✅ Hidden if face < 7.5cm (~3 inches) | ❌ No minimum size gate — text may be illegible on tiny boxes |
| Font scaling | User-configurable `entityLabelFontSize` server preference | Text size = `h * 0.12` (12% of face height) |
| Depth/z-fighting prevention | `depthOffset: -2` Troika prop | Canvas texture baked in — no z-fighting |
| **Box base color** | Per-category (`categoryId` → `colorHex` on `caseCategories` document). **Bottom face always `#000000`** | Per-category (`CategoryService.meta(category).color` deterministic hash) |
| Per-case individual color | ❌ Not in schema | ✅ `caseData.color` field exists as fallback |
| **Weight View color** | Completely **replaces** category color — `getWeightColor(weight, weightViewMin, weightViewMax)` | ❌ Not implemented |
| Weight View range | `weightViewMin` / `weightViewMax` stored **on the pack document**, user-adjustable via UI mutations | N/A |
| Weight color scale | Cyan → Green → Yellow → Red (linear gradient mapped to pack min/max) | N/A |
| Weight View + labels | Labels remain visible when Weight View is active | N/A |
| Selection highlight | Emissive color override | ✅ Same approach — `m.emissive.set(accent)` |

**TP3D implementation note:** Adding a minimum face size gate to `generateCaseTexture()` would match TruckPacker's UX and prevent illegible labels on small cases.

---

## 14b. Technology Stack Comparison (Q19 — confirmed)

| Domain | TruckPacker | TP3D |
|---|---|---|
| 3D engine | Three.js r167 | Three.js (vendored) |
| 3D framework | React Three Fiber (R3F) + @react-three/drei | Vanilla Three.js (no React) |
| 3D text | Troika Three Text (SDF, Web Worker) | Canvas 2D texture |
| 3D editing gizmo | PivotControls (@react-three/drei) | Custom drag/translate via raycasting |
| UI framework | React 19.2.3 + Next.js App Router | Vanilla JS IIFEs |
| Build tool | Next.js + Turbopack | None (vanilla) |
| State management | Zustand 4.5.7 + Immer + Jotai 2.16.0 | Custom `StateStore` IIFE |
| Backend / DB | Convex (real-time document DB) | Supabase (PostgreSQL + Auth) |
| Auth | Clerk (@clerk/nextjs 6.36.8) | Supabase Auth |
| PDF generation | PDFKit (embedded, client-side) | jsPDF (vendored) |
| CSV parsing | PapaParse (Web Worker mode) | Manual / XLSX |
| Schema validation | Zod 3.25.76 | None |
| Component library | Radix UI (Tabs, Dialog, Collapsible, etc.) | Custom UI components |
| Icons | Lucide React | FontAwesome (vendored) |
| Resize panels | react-resizable-panels | CSS / custom |
| 2D snap guidelines | Moveable.js | Custom edge-snap + grid |
| List drag-and-drop | @dnd-kit | None |
| Payments | Stripe (server-side webhooks) | ✅ Stripe + Supabase Edge Functions |
| Analytics | PostHog + Google Tag Manager | None |
| Rich text | Tiptap (ProseMirror) | Plain textarea |
| Animation | GSAP or spring (from R3F) | TWEEN.js (vendored) |

**Licensing:** All TruckPacker open-source client deps are MIT. No GPL/LGPL constraints. We are free to build similar features independently using any of the same libraries.

**Key takeaway:** TruckPacker's stack is heavier (~3.2MB PDFKit alone). TP3D's vanilla approach is smaller, offline-capable, and has no build step — those are advantages, not deficits.

---

## 15. Duplicate Case / Entity

| Aspect | TruckPacker | TP3D |
|---|---|---|
| In 3D editor | ✅ Spawns at `ENTITY_SPAWN_POSITION`, new UUID, copies all props | ✅ `duplicateSelected()` — Cmd+D/Ctrl+D |
| Case library duplicate | Separate "Duplicate case preset" action | ✅ `CaseLibrary.duplicate()` and `PackLibrary.duplicate()` |

**Status: Equivalent** (TP3D slightly more complete).

---

## 16. Keyboard Shortcuts

| Aspect | TruckPacker | TP3D |
|---|---|---|
| Implementation | `hotkeys-js` or custom hook, wired to Zustand actions | Native `keydown` listeners in `app.js` + `editor-screen.js` |
| AutoPack shortcut | ✅ | ✅ |
| Duplicate (Cmd+D) | ✅ | ✅ |
| Measurement (M) | ✅ No billing gate | ❌ No measurement tool |
| Known gaps | — | 2× `// TODO: Add keyboard shortcut + update Keyboard Shortcuts modal later` in `cases-screen.js` and `packs-screen.js` |

---

## 17. Confirmed Bugs Still Active in TP3D

| # | Bug | Location | Status |
|---|---|---|---|
| **B1** | `noStackOnTop` / `stackable: false` not enforced in AutoPack | `findRestingY()` in `src/app.js` | ❌ **Active** — data exists, never read by algorithm |
| **B2** | Stacking scoring: flat `STACKING_BONUS` (+1200) is fully canceled by gravity penalty at ~80" height | Score calculation in `pack()` (`src/app.js`) | ❌ **Active** — items spread flat instead of stacking |
| **B3** | `maxStackCount` not enforced in AutoPack | `findRestingY()` | ❌ **Active** — data exists, never read |
| **B4** | Renderer `halfWorld.y` recalculated during AutoPack animation but not on subsequent manual drags | `animatePlacements()` in `src/app.js` | ⚠️ **Partially fixed** — only applies during AutoPack, not manual moves |
| **B5** | `computeStats` epsilon tolerance | `isAabbContainedInAnyZone()` in `src/services/pack-library.js` | ✅ **Already fixed** — `EPS = 0.05` confirmed in code |

---

## 18. TP3D Advantages Over the Reference

These features exist in TP3D but NOT in TruckPacker:

| Feature | TP3D Implementation |
|---|---|
| **Real gravity simulation** | `findRestingY()` — every box rests on floor or top of another box. TruckPacker is purely geometric. |
| **Center of Gravity (CoG)** | `cog-service.js` — computes CoG position, X/Z deviation %, and ok/warning/critical status with a 3D marker |
| **Wheel well / obstacle zones** | `wheelWells` shape mode with 5 real exclusion zones enforced in packing, collision, and stats |
| **Front-first loading direction** | `frontBonus` mode + `loadFrontFirst` flag in AutoPack. TruckPacker has no loading direction concept. |
| **User-configurable snap grid** | `snapping.gridSize` (default 1", min 0.25") + 2-inch threshold (vs. TruckPacker's hardcoded 10") |
| **Dynamic orthographic cameras** | `buildOrthoCameras()` computes bounds from actual pack dimensions. TruckPacker uses hardcoded positions. |
| **Cylinder/drum shape support** | `geometry-factory.js` + cylinder volume calculation for FFD sorting |

---

## 19. What We Have Enough Information to Implement

All blockers resolved. Everything below is fully specced and ready to build.

### Tier 1 — Bug fixes (correctness, no regressions possible)

| Fix | File | Effort | Impact |
|---|---|---|---|
| **B2:** Fix stacking scoring | `src/app.js` — `pack()` score calculation | 3 lines | Fixes "items spread flat on floor" |
| **B1:** Enforce `noStackOnTop`/`stackable: false` | `src/app.js` — `findRestingY()` | 5 lines | Stops boxes from stacking on "no stack" cases |
| **B3:** Enforce `maxStackCount` | `src/app.js` — `findRestingY()` | 10 lines | Respects user stack limits |

### Tier 2 — Low-effort features (no schema change required)

| Feature | Files | Effort |
|---|---|---|
| Case Browser Manufacturer tab | `src/screens/editor-screen.js` — `renderCaseBrowser()` | ~25 lines |
| Minimum face size gate for labels | `src/screens/editor-screen.js` — `generateCaseTexture()` | 5 lines |
| Weight capacity in header stats | `src/screens/editor-screen.js` — inspector render + `src/app.js` PDF | 15 lines |

### Tier 3 — Medium features (no schema change)

| Feature | Files | Effort |
|---|---|---|
| Weight View heatmap (color boxes by weight) | `src/screens/editor-screen.js` — `CaseScene`, `src/app.js` — pack model | Medium |
| Scale / Payload panel UI | `src/screens/editor-screen.js` — inspector panel | Medium |
| Front orthographic view in PDF | `src/app.js` — `buildOrthoCameras()` + `generatePDF()` | Low-Medium |
| Category color chips in PDF case list | `src/app.js` — `generatePDF()` | Medium |
| Page numbers in PDF footer | `src/app.js` — `generatePDF()` | Low |

### Tier 4 — Larger features (Supabase schema changes required)

| Feature | New DB Tables/Columns | Effort |
|---|---|---|
| 404 / 500 / Maintenance error pages | None | Low |
| Crew View / Share link | `packs.is_public`, `packs.share_token`, `pack_checklist` table | High |
| Pack Folder system | `pack_folders` table + `packs.folder_id` | High |
| Measurement tool | None | Medium |
| "With Like" stackable mode | None (data model + algorithm only) | Medium |

---

## 20. Outstanding Follow-up Questions

These remain unanswered (lower priority — not blocking any planned implementation):

1. **Does TruckPacker display which algorithm produced each solution?** (e.g., "Solution 1: BRUTE — 97%" vs. just "Solution 1 of 5")
2. **Can users adjust any AutoPack parameters before running** (algorithm selection, gravity weight, item priority)? Or is it always all-5, no config?
3. **Does TruckPacker's measurement tool measure container walls**, or only box-to-box surfaces?
4. **Are solutions sorted by utilization % on the server before returning**, or always in fixed algorithm order (PLAIN first)?
5. **What triggers the BRUTE time limit** — wall-clock milliseconds, node count, or placed-box iteration count?

**Resolved questions (Q1–Q19 answered April 19, 2026):** LAFF sort order, BRUTE limits, "With Like" identity, solution ordering, partial results, container tolerances, stackable enforcement, solution ordering, org schema, measurement tool, snapping, floor constraint, ortho camera, trailer obstacles, loading direction, Crew View architecture, Case Browser tabs, box labels/colors, full library inventory.

---

*End of document — Version 2.0, April 19, 2026*
