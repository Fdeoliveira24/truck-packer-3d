# TruckPacker Reference AutoPack Audit

Date: 2026-05-24  
Scope: black-box UI and safe network-shape audit of `https://app.truckpacker.com/packs`  
Reference pack used: existing seeded/demo pack, `53' Dry Van - Example`  
Local context used: `docs/product/autopack-logic-v2.md`, `docs/product/truckpacker-comparison-v1-2026-04-19.md`

## Executive Summary

The live reference app is currently authenticated in Chrome and exposes a full editor surface with packs, cases, AutoPack, case browser, selected-item inspector, Weight View, Scale, import/export, and Crew View controls.

The most important live correction to the prior April comparison notes is solution count: the tested `53' Dry Van - Example` pack produced **4 solutions**, not 5. The UI showed a toast, `4 solutions found!`, and a generic `Solution 1 of 4` through `Solution 4 of 4` navigator. No algorithm names, utilization percentages, packed count, unpacked count, or per-solution score were visible in the solution panel.

AutoPack visibly creates dense stacked layouts and each solution variant changes the layout. It appears much stronger than TP3D's current single greedy result. Weight View and Scale are polished, separate visual/accounting tools: Weight View recolors boxes by weight range, while Scale shows arithmetic payload capacity usage. I found no visible evidence that weight affects AutoPack placement.

No new test pack was created. I used the existing `Example Packs / 53' Dry Van - Example` pack to avoid adding account data. The reference app autosaves editor actions, so running AutoPack and inspecting/undoing selected-item edits updated the demo pack timestamp.

## Screenshots

- Packs list: `docs/product/audit-screenshots/truckpacker-packs-list-2026-05-24.png`
- Editor, case browser, and AutoPack panel: `docs/product/audit-screenshots/truckpacker-editor-case-browser-autopack-2026-05-24.png`
- AutoPack result navigation: `docs/product/audit-screenshots/truckpacker-autopack-solution-1-of-4-2026-05-24.png`
- Scale / payload panel: `docs/product/audit-screenshots/truckpacker-scale-payload-panel-2026-05-24.png`
- Weight View heatmap: `docs/product/audit-screenshots/truckpacker-weight-view-range-scale-2026-05-24.png`
- Cases table: `docs/product/audit-screenshots/truckpacker-cases-table-2026-05-24.png`
- Initial Weight View on another existing pack: `docs/product/audit-screenshots/truckpacker-autopack-weight-view-2026-05-24.png`

## Baseline UI

Confirmed login: `https://app.truckpacker.com/packs` loaded the authenticated Packs screen with `Personal Workspace`, pack folders, and a trial/upgrade card.

Packs list:
- Folders: `Container Templates`, `Use Folders to Organize`, `Example Packs`.
- Existing pack: `Check out this pack!`.
- `Example Packs` contained `Stephen Curtis Chapman - 2025 26' Box`, `53' Dry Van - Example`, and `Colony House - 2025 Bus Trailer`.

Editor:
- Left menu: `File`, `Add`, `Edit`, `View`.
- Top toolbar buttons for add/case browser, linking/grouping, scale, measurement, and view/container controls were visible.
- Case Browser supports `Category` and `Manufacturer` tabs.
- AutoPack panel shows only container length, width, height, units, and AutoPack button.
- View menu includes `Shortcuts`, `Case Browser`, `Packing Groups`, `AutoPack`, `Inspector`, `Scale`, `Weight View`, and `Undo History`.

## Test Pack And Case Data

The existing demo case inventory provided enough variety to test large, medium, small, heavy, flippable, and non-flippable behavior. The visible Cases table exposed dimensions, weight, category, and `Flip`; no stackability field was visible in the tested list or selected-item inspector.

| Case | Manufacturer | Size | Weight | Category | Flip / rotate |
|---|---:|---:|---:|---|---|
| 1/2 Pack | Starter Set | 24 x 48 x 32 in | 90 lb | Default | Yes |
| 1/4 Pack | Starter Set | 24 x 24 x 32 in | 40 lb | Default | Yes |
| Amp Head Case | SKB | 36 x 24 x 24 in | 70 lb | Amps | No |
| FOH Rack | EWI | 36 x 24 x 36 in | 95 lb | Control | Yes |
| Guitar Vault | Jan-Al | 48 x 30 x 36 in | 130 lb | Amps | Yes |
| Line Array Case | ProX | 48 x 30 x 36 in | 160 lb | PA | No |
| Load Bar | Starter Set | 5 x 102 x 3 in | 15 lb | Default | Yes |
| Monitor World | Gator Cases | 48 x 24 x 36 in | 140 lb | Control | Yes |
| RF Rack | SKB | 24 x 20 x 24 in | 60 lb | RF | Yes |
| Subwoofer Crate | Calzone | 48 x 30 x 36 in | 180 lb | PA | No |
| Wireless Drawer | Reliable Hardware | 24 x 20 x 24 in | 55 lb | RF | Yes |

Selected-item inspector example:
- `Box Truss`: 118 x 12 x 12 in, 50 lb, category `Default`, `Flippable: Yes`.
- Inspector actions: `Delete`, `Duplicate`, quantity input.

## AutoPack Behavior

Live run:
- Container size: 636 x 102 x 98 in.
- Result: toast `4 solutions found!`.
- Solution panel: `Solution 1 of 4`, previous/next arrow buttons.
- The first solution disabled `Previous`; the fourth solution disabled `Next`.
- No visible algorithm names.
- No visible utilization percentage.
- No visible packed/unpacked count.
- No visible score/ranking.

Solution behavior:
- Each solution changed the visible layout.
- The variants were meaningfully different, not just camera changes.
- The pack layout was dense and stacked; it did not simply spread all items in a single floor layer.
- Some variants loaded deep wall-like stacks; others left visibly different empty regions before/after the packed block.
- The UI did not expose where unpacked items went, and this demo pack appeared packable enough that I could not confirm unplaced-item staging live.

AutoPack controls:
- No visible pre-run algorithm selector.
- No visible loading direction, priority, spacing, or safe-transport option.
- AutoPack can be rerun after a result; the button remains available after closing the solution navigator.

Logic observations:
- Stacking: visibly uses stacked layers.
- Heavy lower: not visibly guaranteed; Weight View showed heavier red/orange items not as an obvious placement constraint.
- Non-stackable / with-like / max-stack: not confirmed in live UI because stackability controls were not visible in the tested screens.
- Rotation: `Flip` field exists per case. AutoPack visibly handled flippable long/thin items differently from non-flippable cases. I could not confirm all six orientations from UI alone.
- Boundaries: all solution variants stayed inside the rectangular container.
- Obstacles/wheel wells: no live UI evidence of real obstacle geometry; this pack used a plain rectangular container.

## Manual Editing After AutoPack

Confirmed selected item behavior:
- Clicking a box selects it.
- A 3D transform gizmo appears with translation handles and rotation arcs.
- Inspector appears with editable size, weight, category, flippable flag, delete, duplicate, and quantity.
- Edit menu exposes `Undo`, `Redo`, `Select All`, `Duplicate`, `Copy`, `Cut`, `Paste`, `Group`, `Rotate`, `Flip`, `Delete`, `Hide Selected`, `Toggle Snapping`, and `Clear All Cases`.
- `Rotate` was tested on a selected item and changed orientation immediately.
- `Undo` restored the rotated item.
- Scale totals did not change after rotation, as expected.

Not fully tested to avoid avoidable persistent changes:
- Delete selected item.
- Duplicate selected item.
- Drag/move selected item.
- Solution switching after a saved manual edit.

Observed implication: editor tooling is present for Phase B parity, but TP3D should treat post-AutoPack edits carefully because switching solution variants can overwrite the visible arrangement.

## Weight View

Location:
- View menu: `View -> Weight View`.
- Toolbar also exposes a scale-like toggle button.

Behavior:
- Opens a left floating panel titled `Weight View`.
- Inputs: `Min` and `Max`, defaulted to `0` and `800` lb in the tested pack.
- Legend: cyan/blue at low weight, then green, yellow, orange, red at high weight.
- Box colors changed from category colors to heatmap colors.
- Labels remained visible in Weight View.
- Weight View can be active at the same time as Scale and AutoPack panels.
- Range is user-editable and appears to be based on the configured min/max values, not automatic current-pack min/max only.
- No visible evidence that Weight View affects AutoPack logic; it appears visual only.

## Scale / Payload Panel

Location:
- View menu: `View -> Scale`.
- Toolbar also exposes a scale button.

Observed values in the tested pack:
- Payload capacity input: `44998.55 lb`.
- Range label: `0 lbs` to `44,999 lbs`.
- Remaining: `23,658 lbs`.
- Current: `21,341 lbs`.
- Excess: `0 lbs`.
- Capacity: `47%`.

Behavior:
- Scale is a floating panel that can be open with Weight View.
- Values reflect arithmetic weight usage against payload capacity.
- Rotation did not change values.
- I did not confirm over-capacity blocking for AutoPack/export/save.
- I did not observe any center-of-gravity or axle-distribution behavior.

## Camera, Views, And Controls

Observed:
- Free orbit 3D view with an axis/view cube indicator in the upper-right.
- Boxes can be selected directly in the 3D scene.
- Transform gizmo supports manual rotate/move affordances.
- View menu exposes `Shortcuts`, `Case Browser`, `Packing Groups`, `AutoPack`, `Inspector`, `Scale`, `Weight View`, and `Undo History`.
- Edit menu exposes snapping toggle with shortcut `S`.

Not confirmed live:
- Top/side/front/rear view switching in the editor UI.
- View thumbnails or saved views.
- Measurement workflow behavior beyond seeing a ruler/measurement toolbar icon.
- Keyboard shortcut list content.

## Export / PDF / Checklist

Quick-confirmed:
- File menu includes `Screenshot`, `Export PDF`, and `Import`.
- `Crew view` button is visible in the editor.
- `Add` menu includes `Case`, `Text`, and `Case Preset`.

Not deep-tested live:
- PDF content.
- Load checklist.
- Crew/share public behavior.
- Front/rear orthographic view in PDF.
- Grouped case list in PDF.
- Weight capacity in PDF.
- Category color chips in PDF.

Prior local notes in `truckpacker-comparison-v1-2026-04-19.md` say the reference PDF has front view, grouped case list, weight capacity in header, category color chips, and page numbers. This audit did not regenerate a PDF to revalidate those details.

## Safe Network / Request-Shape Notes

Network collection was kept header-free and body-free. No cookies, JWTs, auth headers, API keys, or full request headers were written to this report.

Safe visible request classes:
- Next.js page and static chunks from `app.truckpacker.com/_next/static/chunks/*`.
- Clerk public environment/client requests at `clerk.truckpacker.com/v1/environment` and `clerk.truckpacker.com/v1/client`.
- Analytics requests to Google Analytics and Meta/Facebook/CAPI-related scripts.
- HDR asset request to `/hdri/empty_warehouse_01_1k.hdr` returned 404 in the isolated browser session.

AutoPack response shape:
- The live UI confirmed solution count and solution navigation.
- I did not capture raw AutoPack request or response bodies.
- The browser network recorder timed out around AutoPack, and WebSocket/message bodies were not collected to avoid secret-bearing frame capture.
- Therefore algorithm names, placed/unplaced arrays, position format, rotation format, and score/utilization fields were not safely reconfirmed live.

Prior local notes say TruckPacker uses a Convex backend and algorithms named `PLAIN`, `LAFF`, `FAST_LAFF`, `BRUTE`, and `FAST_BRUTE`, with placed/unplaced item arrays and orientation fields. Treat that as historical/local-doc evidence, not newly confirmed live network evidence.

## Feature Comparison Table

| Reference feature | How it works in TruckPacker live | Current TP3D behavior | Gap | Priority | Suggested TP3D file area |
|---|---|---|---|---|---|
| Multiple AutoPack solutions | Live pack returned 4 variants with prev/next UI | One greedy result | Need solution array, scoring diversity, UI navigation | P0 | `src/app.js`, `src/screens/editor-screen.js`, pack model/state |
| Algorithm names | Not visible in UI | N/A | Optional internal labels/debug, not user-visible parity | P2 | AutoPack result model |
| Utilization display | Not visible in solution panel | TP3D has stats but not solution variants | Add per-solution utilization/stats if useful | P1 | `src/services/pack-library.js`, editor stats |
| Dense stacking | Reference visibly stacks dense layouts | TP3D known to spread/under-stack in current docs | Fix stacking score and Z scanning | P0 | `src/app.js` AutoPackEngine |
| Unpacked item handling | Not confirmed live; prior notes say unplaced items remain staged | TP3D reports one unpacked list/toast | Need explicit unplaced panel per solution | P0 | `src/app.js`, `src/screens/editor-screen.js` |
| Rotation/orientation | `Flip` field visible; flippable items can orient differently | TP3D has `canFlip` and orientation locks, but scoring/visual bugs exist | Need robust orientation scoring and renderer sync | P0 | `src/app.js`, `src/screens/editor-screen.js` |
| Non-stack / with-like / max-stack | Not visible in tested live UI; prior docs say stackability exists | `noStackOnTop` and `maxStackCount` exist but not enforced | Enforce constraints in placement checks | P0 | `src/app.js` `findRestingY` / collision |
| Container boundaries | Reference respects rectangular container | TP3D supports rect plus wheel wells/front bonus | TP3D advantage on obstacle geometry; preserve | P1 | `src/core/trailer-geometry.js`, `src/app.js` |
| Obstacles / wheel wells | Not observed live; plain rectangle | TP3D supports real multi-zone geometry | TP3D advantage | P2 | Existing geometry services |
| Manual selected-item tools | Inspector, pivot gizmo, rotate/flip/delete/duplicate/copy/cut/paste/group/hide | TP3D supports selection, rotate/nudge/delete/duplicate | Need stronger post-AutoPack solution state model | P1 | `src/screens/editor-screen.js`, `src/app.js` |
| Rerun AutoPack | Button remains available after result | TP3D can rerun one result | Need rerun semantics with manual edits/solutions | P1 | AutoPack state/result manager |
| Weight View | Heatmap with min/max range, labels remain visible | Not implemented | Add visual heatmap toggle and min/max config | P1 | `src/screens/editor-screen.js`, preferences/pack metadata |
| Scale / payload | Shows current, capacity, remaining, excess, percent | TP3D has total weight stats and PDF total | Add live payload panel and over-capacity warning | P1 | `src/screens/editor-screen.js`, `src/services/pack-library.js` |
| CoG | Not observed; prior notes say absent | TP3D has CoG service | TP3D advantage | P2 | `src/cog-service.js` |
| Case browser grouping | Category and Manufacturer tabs | TP3D has category grouping; manufacturer field exists | Add manufacturer tab | P2 | `src/screens/editor-screen.js` |
| Export PDF | Menu item exists; prior docs show richer PDF | TP3D exports PDF but lacks front view/grouped list/chips/page nums | Close PDF parity gaps | P2 | `src/app.js` export service |
| Crew/share view | Crew View button visible | TP3D lacks share/crew route | Larger feature | P3 | router, Supabase schema/RLS, read-only editor |

## Recommended Implementation Phases

### Phase A - AutoPack Correctness

1. Introduce a result model that can hold multiple solutions: placements, unplaced IDs, stats, score/utilization, and metadata.
2. Generate several deterministic variants rather than one greedy pass: at minimum vary sort order, wall/layer priority, orientation preference, and density scoring.
3. Fix current stacking behavior from `autopack-logic-v2.md`: Z-scanning should continue after a gap, stacking should not be over-penalized, and score should reward dense vertical usage.
4. Enforce `noStackOnTop`, stackability, and `maxStackCount` in `findRestingY`/collision placement checks.
5. Strengthen orientation handling so each allowed orientation is evaluated consistently and renderer dimensions stay in sync.
6. Add explicit unplaced handling: staged location, list, count, and warning per solution.
7. Keep TP3D advantages: wheel well/front bonus geometry, CoG, and configurable snapping.

### Phase B - Editor Controls

1. Add solution previous/next UI with selected solution state.
2. Preserve manual edits separately from solver-generated solutions, or clearly reset solution selection when the user edits.
3. Add selected-item tool parity: remove from load/stage, rotate, flip, duplicate, delete, hide/show, and rerun AutoPack safely.
4. Add Undo/Redo entries for AutoPack runs and solution switches.
5. Ensure stats update immediately after remove/rotate/move/duplicate/delete.

### Phase C - Weight / Scale

1. Add Weight View heatmap toggle with min/max inputs.
2. Recolor boxes by weight while preserving labels and selected-state affordances.
3. Add payload Scale panel: current, capacity, remaining, excess, percent.
4. Add capacity warning when excess is positive; do not block save/export unless product policy requires it.
5. Keep weight visual/accounting separate from solver logic initially; later consider heavy-low scoring and CoG/axle tie-ins.

### Phase D - PDF / Export

1. Add front/rear orthographic render to PDF.
2. Group case list by preset with count, dimensions, and weight.
3. Add weight capacity/current weight in the PDF header.
4. Add category color chips and page numbers.
5. Keep screenshot/export controls available from the editor menu.

## Open Questions

1. Why did the live tested pack return 4 solutions instead of the previously documented 5? Possibilities: one algorithm failed/duplicate-filtered/timed out, server behavior changed, or solution count is data-dependent.
2. Does the backend still run `PLAIN`, `LAFF`, `FAST_LAFF`, `BRUTE`, and `FAST_BRUTE`? Not visible in UI and not safely reconfirmed from network.
3. Are solutions sorted by utilization/score, fixed algorithm order, or first-complete order?
4. Does the live app expose stackability controls in a case edit modal, or only in backend schema?
5. Does AutoPack enforce non-stackable, with-like stacking, or max-stack constraints live?
6. Does over-capacity block AutoPack, export, save, or only warn?
7. Does PDF export still include front view, grouped case list, weight capacity header, category color chips, and page numbers?
8. How are public Crew View links protected or invalidated, if at all?

## Validation

- No credentials, cookies, JWTs, API keys, auth headers, or full request headers are written in this report.
- No TruckPacker proprietary source code is copied.
- No new test pack was created.
- Existing demo pack `53' Dry Van - Example` was used; AutoPack/manual inspection actions caused autosaved timestamp changes.
- Raw network request/response bodies were not persisted.
