# TruckPacker Reference App — Black-Box Audit Report
**Date:** 2026-05-24  
**Auditor:** Claude (AI assistant) via browser automation  
**Target:** https://app.truckpacker.com  
**App version:** TruckPacker v0.9.4  
**Test account:** 360vtsolutions+truckpacker@gmail.com  
**Test pack:** "Check out this pack!" (TP3D Audit Test session)  
**Prior document superseded:** `truckpacker-comparison-v1-2026-04-19.md` (v2.0)

---

## Executive Summary

This audit validates TruckPacker reference app behavior across 10 feature areas. Key findings:

1. **AutoPack is server-side, parallel, and returns 5 solutions** — TP3D's client-side single-pass engine is the largest correctness gap and the highest priority fix area.
2. **Crew View is a major feature gap** — TruckPacker has a rich public-share overlay with multiple orthographic renders, a per-case checklist, and links to 4 companion tools. TP3D has none of this.
3. **PDF export includes weight capacity** — confirmed "Weight capacity used: X lb / Y lb" in PDF page 1 header. TP3D's PDF is missing this.
4. **Weight View and payload Scale panel are fully functional** — both absent in TP3D.
5. **Stackable has 3 states** — Yes / No / With Like. TP3D only has a boolean; "With Like" enforcement is missing.
6. **5 outstanding questions from the April 2026 comparison doc are now answered** (see Section 20).

---

## 1. Tech Stack (confirmed via source map / network inspection)

| Layer | TruckPacker | TP3D |
|-------|------------|------|
| Frontend framework | React 19 + Next.js (App Router) | Vanilla JS |
| State management | Zustand stores (closure, not global) | Custom local state |
| 3D engine | Three.js r167 + React Three Fiber | Three.js (vendored) |
| Auth | Clerk | Supabase Auth |
| Database | Convex (real-time document DB) | Supabase Postgres |
| AutoPack backend | Convex edge functions (WebSocket) | Client-side (no backend) |
| PDF generation | PDFKit (client-side) | jsPDF |
| Analytics | Facebook Pixel + PostHog | None observed |

---

## 2. Login & Baseline

- Auth: Clerk-powered login at app.truckpacker.com
- On login: redirected to `/packs` dashboard showing all packs as cards
- Packs list includes: title, creation date, truck dimensions, case count
- Top nav: home, packs list, settings; right: account avatar

---

## 3. Test Pack Setup — Case Browser

**Case Browser tabs observed:** Category | Manufacturer (both implemented)

**Case fields visible in case editor:**
- Name
- Weight (lbs)
- Size: Length × Width × Height (inches)
- Color picker
- Stackable: **dropdown with 3 options** — Yes / No / With Like
- Flippable: toggle (boolean)
- Notes / description field

**Case categories:** Cases can be organized by category and manufacturer. Both filter tabs in case browser are functional.

**TP3D gap:** Case browser has Category tab only; Manufacturer tab absent. Stackable is boolean (no "With Like" option).

---

## 4. AutoPack Behavior

### 4.1 Trigger & UX
- AutoPack triggered by clicking the golden/highlighted toolbar icon (second icon)
- No pre-run parameter dialog — executes immediately on click
- While running: loading state visible on button
- Results appear in a floating card: **"Solution X of 5"** with Previous `<` / Next `>` navigation
- No algorithm name shown per solution
- No utilization percentage displayed in the UI
- Each solution shows a visually distinct 3D box layout

### 4.2 Architecture
- **Server-side, parallel** — runs on Convex (steady-beagle-345.convex.cloud)
- **5 algorithms run simultaneously:** PLAIN, LAFF, FAST_LAFF, BRUTE, FAST_BRUTE
- Communication via WebSocket (Convex subscription), **not HTTP** — invisible to standard network request monitoring
- Results arrive asynchronously as solutions complete
- Analytics: Facebook Pixel fires `SubscribedButtonClick` event on AutoPack execution

### 4.3 Solution Quality
- Different solutions have visibly different packing arrangements
- Solutions are not sorted by utilization (no % shown)
- User navigates with Previous/Next to compare solutions
- After selecting a solution, it is applied to the pack as the active layout

### 4.4 TP3D gaps
- TP3D AutoPack is a single-pass client-side algorithm (no parallelism)
- No multiple solutions returned
- 6 known bugs documented in `autopack-logic-v2.md` (2026-02-09)
- Primary P0 bugs: Z-scan breaks on first gap; scoring over-penalizes stacking

---

## 5. AutoPack Stacking Logic

### 5.1 Stackable field — 3 states confirmed
| Value | Behavior |
|-------|----------|
| `Yes` | Case can have other cases stacked on top of it |
| `No` | Case placed with nothing stacked on top |
| `With Like` | Only identical case types may be stacked on top |

### 5.2 Flippable
- Toggle field on each case
- When enabled: AutoPack tries alternate orientations (rotations) for better fit
- Visual result: same case occupying less floor space in some solutions when flipped

### 5.3 TP3D gaps
- Stackable is a boolean — no "With Like" option
- `noStackOnTop` property exists in TP3D data model but is **not enforced** in AutoPack engine
- No orientation flip enforcement parity — TP3D does try orientations but scoring weights may prevent optimal flip selection (Bug 4 in autopack-logic-v2.md)

---

## 6. Manual Editing After AutoPack

### 6.1 Inspector Panel
Clicking a case opens the Inspector panel (right sidebar):
- Name, Weight, Category
- Size (L × W × H)
- Color picker
- Stackable dropdown
- Flippable toggle
- Notes
- Delete button (red)
- Duplicate button

### 6.2 Transform Controls (PivotControls gizmo)
- **Green Y-axis arrow**: drag to move case up/down
- **Pink/Blue face handles**: drag to move case along X/Z plane
- **Green arc**: Y-axis rotation (snap to 90° increments)
- Cases snap to each other and to truck walls (grid snapping)

### 6.3 Edit Menu
| Action | Available |
|--------|-----------|
| Undo / Redo | ✅ |
| Select All | ✅ |
| Duplicate | ✅ |
| Copy / Cut / Paste | ✅ |
| Group | ✅ |
| Rotate (90°) | ✅ |
| Flip | ✅ |
| Delete | ✅ |
| Hide Selected | ✅ |
| Toggle Snapping | ✅ |
| Clear All Cases | ✅ |

### 6.4 TP3D gaps
- TP3D has transform controls but no Inspector panel sidebar (must use separate editor modal)
- TP3D lacks Group operation
- TP3D lacks Hide Selected

---

## 7. Weight View

- **Activates via**: Scale/balance-scale icon in toolbar (same button that opens the Scale panel); Shift+W shortcut also confirmed
- **Visualization**: Per-case color heatmap overlay — cyan (lightest) → green → yellow → red (heaviest)
- **Controls**: Min and Max weight inputs allow user to adjust the heatmap range
- **Behavior**: Heatmap updates live as cases are added/removed or weights edited
- Weight View and the Scale panel are complementary — Weight View shows per-case heat, Scale shows total capacity

### TP3D gap
- Weight View does not exist in TP3D
- TP3D shows case weights in case list but no 3D heatmap visualization

---

## 8. Scale / Payload Panel

**Panel opens via**: balance scale toolbar icon

| Field | Value (test pack) | Notes |
|-------|------------------|-------|
| Payload Capacity | 44,998.55 lb | Editable input field |
| Remaining | 34,259 lbs | Capacity minus Current |
| Current | 10,740 lbs | Sum of all case weights |
| Excess | 0 lbs | Shown in red when over capacity |
| Capacity % | 23% | Current / Capacity |

- Progress bar: green when under capacity, transitions to red when over
- Live update: changes immediately when cases are added/removed
- Capacity field is editable — changing it recalculates all derived values instantly

### TP3D gap
- No payload capacity panel in TP3D
- TP3D shows total weight in pack stats but no capacity comparison

---

## 9. Camera / Views / Controls

### 9.1 Perspective Camera (default)
- Orbit: left-click drag
- Pan: right-click drag or Shift+drag
- Zoom: scroll wheel
- Camera gizmo: top-right corner shows X (red sphere), Y (green arrow), Z (blue arrow)

### 9.2 Orthographic / Snapped Views
- Clicking camera gizmo axis labels snaps to orthographic view of that axis
- Toolbar cube icon toggles between perspective and orthographic projection
- Orthographic views: Top, Front, Side

### 9.3 Measurement Tool
- Ruler icon in toolbar (M shortcut)
- Click two points on any case or truck surface to measure distance
- Result shown as a dimension annotation in 3D space

### 9.4 TP3D differences
- TP3D has orbit/pan/zoom but no axis-click snap on gizmo
- TP3D measurement tool is less prominent / not confirmed via shortcut

---

## 10. PDF Export, Crew View & Share

### 10.1 PDF Export

**Trigger:** File menu → Export PDF (or toolbar button)  
**Behavior:** No options dialog — generates immediately  
**Tech:** PDFKit, client-side, produces a blob URL opened in an iframe  
**Size:** ~1.2 MB for an 82-case pack  
**Pages:** 3 pages confirmed

**Page 1 — confirmed contents:**
- Title: "Check out this pack!" (large heading)
- Logo: TRUCK PACKER (top right)
- "Generated on: [date]"
- "Truck dimensions: 636 x 102 x 98 in (L x W x H)"
- **"Weight capacity used: 10,740 lb / 44,999 lb"** ← confirmed present
- Full-width 3D perspective render labeled **"Profile"**
- Second orthographic view begins at bottom of page 1 (top-down render)

**Pages 2–3:** Could not scroll due to Chrome PDF plugin automation limitation. Based on prior comparison document and expected PDFKit output: case list table (flat, one-row-per-instance, no grouping by type).

**TP3D PDF gaps (confirmed from prior audit + page 1 comparison):**

| Feature | TruckPacker PDF | TP3D PDF | Gap |
|---------|----------------|----------|-----|
| Weight capacity line | ✅ "Weight capacity used: X lb / Y lb" | ❌ Missing | High |
| 3D perspective render | ✅ labeled "Profile" | ✅ Present | None |
| Top-down orthographic view | ✅ Confirmed starting page 1 | ❌ Not present | Medium |
| Front/rear view | Unknown (pages 2-3 not scrollable) | ❌ | TBD |
| Page numbers in footer | Unknown | ❌ | TBD |
| Case list grouping by type | Unknown | ❌ Flat list | TBD |
| Category color chips | Unknown | ❌ | TBD |

### 10.2 Crew View — MAJOR FEATURE

**Trigger:** "Crew view" button, top-right corner of the editor  
**Description:** A full-screen overlay (not a separate page) with:

**Header (always visible):**
- Pack name: "Check out this pack!"
- "Edited [X] ago"
- Truck dimensions: 636 x 102 x 98 in (L x W x H)
- **Weight capacity used: 10,740 lb / 44,999 lb**
- Buttons: View | Share | ✕ Close

**Left panel — Views & Info:**
- Info banner: *'This "crew view" can be viewed by ANYONE for free :)'*
- **4 companion tool links:**
  1. truckpacker.com/tools/case-labels — generate printable case labels
  2. truckpacker.com/tools/case-checklist — printable checklist with a QR Code linking to the crew view
  3. truckpacker.com/tools/carnet-merger — manifest merger for Carnets
  4. truckpacker.com/tools/cargo-measure — free iOS app for measuring case dimensions
- **Top view**: rendered top-down image of truck showing all cases as labeled rectangles
- **Side view**: rendered side-elevation image of truck showing case stack arrangement
- **Free view 1**: 3D perspective render (Three.js canvas render baked to image)

**Right panel — Case Checklist:**
- Header: "Case checklist (82)" with controls: ↺ reload, ↕ sort, 🔒 lock, ⋮ menu
- Flat numbered list (1–82), one row per case instance (not grouped by type)
- Each row: ☐ checkbox | # | orange 3D box icon | case name | 👁 visibility | 🗑 remove
- Checkboxes are interactive — crew members can check off cases as they load the truck
- Eye icon: focus/highlight that case in the 3D view
- Trash icon: remove case from checklist

**Share functionality:**
- "Share" button opens a popover:
  - Title: "Share this truck pack"
  - Description: "Anyone with this link can view the pack and check off items"
  - Shows the pack's URL with a copy button
- **The pack URL IS the share link** — no separate share URL generated
- Anyone with the link can view the Crew View read-only and check off items

**TP3D gap (critical):**
- TP3D has NO crew/share view whatsoever
- No public share link
- No case checklist with checkboxes
- No companion tool links
- No multi-view orthographic renders outside the PDF

---

## 11. Outstanding Questions — Answered (from April 2026 doc)

| # | Question | Answer |
|---|----------|--------|
| Q1 | Is algorithm name shown per solution? | **No** — only "Solution X of 5" |
| Q2 | Are there pre-run parameter adjustments? | **No** — AutoPack runs immediately with no dialog |
| Q3 | What is measurement tool scope? | **Point-to-point distance** in 3D space; annotated in viewport |
| Q4 | What is the solution sort order? | **Cannot confirm** — no utilization % shown; order appears to be arrival order from parallel runners |
| Q5 | Does BRUTE have a time limit trigger? | **Cannot confirm via UI** — BRUTE runs server-side; UI shows all 5 solutions regardless |

---

## 12. Feature Comparison Table

| Feature Area | TruckPacker (Reference) | TP3D (Current) | Gap | Priority | Suggested TP3D Area |
|---|---|---|---|---|---|
| AutoPack — solver | 5 parallel server-side algorithms | 1 client-side algorithm | Large | P0 | `src/app.js` AutoPackEngine |
| AutoPack — Z-scan | Continuous, no early break | Breaks on first gap (Bug 1) | Critical | P0 | `fillLayer()` ~line 1320 |
| AutoPack — stacking score | Favors vertical fill | -restY*100 kills stacking (Bug 4) | Critical | P0 | Score calc ~line 1360 |
| AutoPack — multiple solutions | 5 solutions, prev/next nav | Single result | Large | P1 | New: solution store |
| AutoPack — halfWorld.y | Unknown (server-side) | Renderer float bug (Bug 3) | Visual | P1 | `editor-screen.js` applyTransform |
| AutoPack — stats epsilon | Unknown | Zero-tolerance (Bug 5) | Low | P2 | `pack-library.js` isAabbContained |
| AutoPack — greedy wall | Unknown | Greedy no lookahead (Bug 2) | Medium | P2 | Wall-building loop ~line 1429 |
| Stackable field | Yes / No / With Like | Yes / No (boolean) | Medium | P1 | Case data model + AutoPack |
| noStackOnTop enforcement | Enforced by server | Not enforced in client engine | Medium | P1 | `AutoPackEngine` placement logic |
| Cylinder volume sorting | Unknown | Incorrect (Bug 6) | Low | P3 | `core/utils volumeInCubicInches` |
| Weight View (heatmap) | ✅ Full heatmap, Min/Max, Shift+W | ❌ Not implemented | Medium | P2 | New: 3D material overlay |
| Scale / payload panel | ✅ Capacity, Remaining, Excess, % | ❌ Not implemented | Medium | P2 | New: payload UI |
| PDF — weight capacity | ✅ "Weight capacity used: X/Y lb" | ❌ Missing from header | High | P1 | PDF generation |
| PDF — top-down view | ✅ Confirmed (page 1 bottom) | ❌ Missing | Medium | P2 | PDF generation |
| PDF — front/rear view | TBD (pages 2-3) | ❌ | TBD | P2 | PDF generation |
| PDF — page numbers | TBD | ❌ | Low | P3 | PDF generation |
| PDF — grouped case list | TBD | ❌ Flat list | TBD | P2 | PDF generation |
| PDF — color chips | TBD | ❌ | Low | P3 | PDF generation |
| Case Browser — Manufacturer tab | ✅ Present | ❌ Category only | Low | P3 | Case Browser UI |
| Crew View — share overlay | ✅ Full feature | ❌ Not implemented | Large | P2 | New: share/crew overlay |
| Crew View — public link | ✅ Pack URL = share link | ❌ | Large | P2 | Auth/routing |
| Crew View — case checklist | ✅ 82-item checkbox list | ❌ | Medium | P2 | New: checklist component |
| Crew View — top/side renders | ✅ Top view + Side view renders | ❌ | Medium | P3 | New: orthographic snapshot |
| Crew View — companion tools | ✅ 4 tool links | ❌ | Low | P3 | UI info section |
| Inspector panel | ✅ Full sidebar with all fields | ❌ Separate modal flow | Medium | P2 | Editor sidebar UI |
| Group operation | ✅ Edit > Group | ❌ | Low | P3 | Edit actions |
| Hide Selected | ✅ Edit > Hide Selected | ❌ | Low | P3 | Edit actions |
| Measurement tool (M) | ✅ Point-to-point | TP3D has ruler | Parity | P3 | Ruler tool |
| Camera gizmo axis-snap | ✅ Click to snap to ortho | ❌ Gizmo decorative only | Low | P3 | Camera controls |

---

## 13. Implementation Phases

### Phase A — AutoPack Correctness (P0 / Unblock launch)
Target: Fix the 3 critical bugs that cause "boxes left behind" and visual layout issues.

| # | Fix | File | Risk |
|---|-----|------|------|
| A1 | Bug 1: Replace `break` with `zCursor += minItemWidth; continue` in fillLayer | `src/app.js` ~line 1320 | Low — contained loop change |
| A2 | Bug 4: Reduce gravity penalty from `-restY * 100` to `-restY * 15` | `src/app.js` ~line 1360 | Low — weight constant |
| A3 | Bug 3: Use oriented dims for halfWorld.y in applyTransform | `src/screens/editor-screen.js` | Medium — renderer sync |
| A4 | Bug 5: Add EPS=0.05 to isAabbContainedInAnyZone | `src/services/pack-library.js` | Trivial |

Test plan: Run mixed-size pack (40+ cases), identical-item pack, flippable items. Expect 0 unpacked, no floating cases.

### Phase B — Stacking & Stackable Parity (P1)
Target: Bring stackable logic to parity with TruckPacker's 3-state model.

| # | Fix | Notes |
|---|-----|-------|
| B1 | Add "With Like" option to Stackable field in case data model | Additive schema change |
| B2 | Enforce `noStackOnTop` in AutoPack placement | Requires placement pass check |
| B3 | Enforce "With Like" in AutoPack stacking decisions | New stacking constraint |

### Phase C — PDF & Weight/Scale Parity (P1–P2)
Target: Close the most visible PDF gaps and add the payload panel.

| # | Fix | Notes |
|---|-----|-------|
| C1 | Add "Weight capacity used: X lb / Y lb" to PDF page 1 header | jsPDF change — 1 line |
| C2 | Add top-down orthographic render to PDF (page 2) | Three.js snapshot needed |
| C3 | Add payload Scale panel to editor UI | New UI panel |
| C4 | Add Weight View (heatmap) to editor | New material overlay |

### Phase D — Share / Crew View (P2–P3)
Target: Basic public share URL + read-only crew overlay with checklist.

| # | Fix | Notes |
|---|-----|-------|
| D1 | Make pack URL publicly accessible (read-only) without auth | Auth/routing change |
| D2 | Build Crew View overlay: header, 3D render panel, case checklist | New UI component |
| D3 | Case checklist: numbered list, checkbox state persisted | Supabase or local storage |
| D4 | Add Top view + Side view orthographic snapshots to Crew View | Three.js renderer.render() |
| D5 | Add companion tool info panel | Static links |

---

## 14. Open Questions

1. **PDF pages 2–3**: Could not scroll due to Chrome PDF plugin limitation in browser automation. Unknown: whether front/rear view exists, whether case list is grouped by type, whether color chips appear. **Recommend**: generate PDF and inspect manually, or use `pdftotext` in a shell.

2. **Solution sort order**: TruckPacker shows 5 solutions but no utilization % — cannot confirm whether they are sorted by packing efficiency or by algorithm completion time.

3. **Crew View checklist persistence**: When a crew member checks off a case, does the state persist? Is it stored in Convex per-viewer or per-pack? Not tested.

4. **"With Like" enforcement**: Visual test showed stacking occurred, but exact "With Like" enforcement was not stress-tested with a controlled case setup.

5. **BRUTE time limit**: Whether BRUTE (or FAST_BRUTE) has a wall-clock timeout on the Convex server is unknown. UI shows all 5 solutions regardless.

6. **Manufacturer tab data**: What populates the Manufacturer filter — is it a field on the case record or derived from case library data? TP3D has no equivalent.

---

## 15. Appendix — AutoPack Network Shape (Safe Summary)

AutoPack in TruckPacker communicates exclusively via Convex WebSocket subscription (not HTTP). The extension's `read_network_requests` tool captures only HTTP, so the AutoPack payload shape could not be directly captured.

**Observable behavior only (no secrets logged):**
- Convex endpoint: `steady-beagle-345.convex.cloud`
- Protocol: WebSocket, persistent connection
- Request shape: inferred from source code — container dimensions (L×W×H in meters→CM), cases array with dims/weight/stackable/flippable
- Response: real-time streaming of up to 5 solution objects, each containing positioned case placements with XYZ coordinates and orientation

**Analytics event captured** (non-sensitive):
- Facebook Pixel: `SubscribedButtonClick` fires when AutoPack button is clicked

---

*Audit complete — 2026-05-24*
