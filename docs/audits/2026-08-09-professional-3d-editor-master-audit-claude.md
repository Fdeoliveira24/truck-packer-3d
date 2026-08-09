> Audit source: Claude Code
> Audit date: 2026-08-09
> Mode: Read-only architecture audit
> Historical snapshot: This file preserves the audit as originally produced. Baseline versions, SHAs, and findings reflect the repository state at audit time and are not automatically updated.

# TRUCK PACKER 3D — Professional 3D Editor Visual Foundation: Master Architecture Audit

**Mode:** Read-only. No files modified, no commits.

## A. Executive Summary

The current 3D editor is built on a clean two-file split — `src/editor/scene-runtime.js` (renderer/scene/camera/lighting/truck visuals) and `src/screens/editor-screen.js` (cargo meshes, interaction, selection/hover/collision state, snapping) — with `src/editor/trailer-geometry.js` and `src/editor/geometry-factory.js` as small, dependency-free geometry helpers. This separation is worth preserving exactly as-is.

The single most important finding: **the authoritative geometry contract is already sound**. Collision, snapping, and packing math all run in inch-space through `oriented-dims.js` / `trailer-geometry.js`, independent of any rendered mesh. `security-and-invariants.spec.mjs` explicitly cross-checks that the *visual* overhang volume and the *collision* overhang zone describe identical bounds. This is the right pattern and the Visual Foundation work should keep extending it, not bypass it.

The biggest gaps are not in geometry safety but in **visual polish infrastructure that doesn't exist yet**: labels are baked into low-resolution (64–512px), DPI-unaware box-face textures rather than a proper typography system; there is no camera-preset system at all (no Front/Rear/Top/Isometric buttons); several schema-defined preferences (`labelFontSize`, `showShadows`, `showBevels`, `renderQuality`, `camera.defaultView`) are **dead — written but never read** by the renderer; and the `CanvasTexture`/label path has **zero test coverage**. The AutoPack-era test suite (`security-and-invariants.spec.mjs`) protects scene-runtime.js almost entirely via source-text regex assertions, not rendered-output checks — useful as a tripwire but brittle to pure refactors.

Roadmap sequencing in `TP3D-MASTER-TODO-V6.md` is already correct: **Visual Foundation → Camera/View System → Heatmap → PDF/Image redesign → GLB spike**, each explicitly depending on the previous. This audit's internal-sequencing recommendation (Section W) refines the *order within* Visual Foundation itself.

## B. Baseline Verified

| Item | Value |
|---|---|
| Repo root | `/Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D` |
| Branch | `main` |
| HEAD SHA | `a129c0aa1213dad4de3c8a4482b5aed7a388dd1b` |
| `git status` | Clean (`## main...origin/main`, nothing to commit) |
| Node | v24.19.0 |
| npm | 11.17.0 |
| Three.js | **0.185.1** (`package.json`) |
| Vite | **8.2.0** |
| `npm test` | **1360 pass / 0 fail / 5 skipped** of 1365 (`node --test tests/audit/*.spec.mjs`) |
| `npm run lint` | **0 errors / 18 warnings** (pre-existing `prefer-native-element` HTML warnings, unrelated to this audit) |

Working tree was clean throughout — safe to proceed read-only, which is what this audit did.

## C. Current 3D Architecture Map

```
src/editor/scene-runtime.js   (1139 lines) — createSceneRuntime({Utils, UIComponents,
    PreferencesManager, TrailerGeometry, StateStore}) → SceneManager singleton
      owns: renderer, scene, camera, OrbitControls, render loop, lighting,
      environment/PMREM, grid, ground, axis-widget, trailer/truck visual mesh,
      CoG marker, resize, disposal, DevOverlay (press "P")

src/editor/trailer-geometry.js (264 lines) — createTrailerGeometry({Utils,
    CorePackLibrary, getSceneManager}) → pure inch-space zone math
      owns: authoritative usable/blocked zones (rect / wheelWells / frontBonus),
      capacity, containment test, inches→world conversion helpers

src/editor/geometry-factory.js (58 lines) — createCaseGeometry(), volumeForShape()
      owns: THREE.BoxGeometry/CylinderGeometry construction from case dims

src/screens/editor-screen.js  (6621 lines) — createCaseScene() [CaseScene,
    L703-1811] + createInteractionManager() [InteractionManager, L1813-6621]
      owns: cargo mesh/material/texture construction, edges, labels (baked into
      face textures), selection/hover/drag/collision visual states, gizmo,
      raycasting/picking, drag/rotate, snapping, AABB+swept collision,
      ResizeObserver, disposal of cargo meshes

src/app.js (6883 lines) — orchestration only
      owns: ExportService (screenshot/PDF/thumbnail capture, L1471-2032),
      StateStore.subscribe main render trigger, KeyboardManager/TruckChangeController
      wiring (logic itself lives in src/ui/*.js), OperationLifecycle instantiation

src/ui/keyboard-manager.js — all keyboard shortcuts (grid/shadow/dev-overlay toggle,
      undo/redo, delete/duplicate/copy/paste, focus-selected, open/save)
src/ui/truck-change-controller.js — confirmation-dialog logic only, no mesh writes
src/services/preferences-manager.js (45 lines) — get()/set()/applyTheme(), UI-free
src/ui/overlays/settings-overlay.js (7434 lines) — single "Preferences" tab holds
      all 3D-adjacent controls (Units, Editor Display, Appearance)
src/core/{defaults.js, normalizer.js} — preference schema + coercion
src/core/{orientation.js, oriented-dims.js} — canonical right-angle rotation math
```

### Ownership table

| Concern | Owner | Notes |
|---|---|---|
| Renderer / WebGLRenderer | `scene-runtime.js` `initScene()` L169-185 | antialias, alpha, ACESFilmic tone mapping, SRGB output |
| Scene / Camera / OrbitControls | `scene-runtime.js` L162-193 | Single perspective camera only |
| Render loop | `scene-runtime.js` `tick()` L424-434 | Gated on `StateStore.get('currentScreen') === 'editor'` |
| Lighting | `scene-runtime.js` `addLighting()` L213-247 | Ambient + key + fill + hemi + rim, all hardcoded |
| Environment/PMREM | `scene-runtime.js` `generateEnvironmentMap()` L249-269 | Best-effort, try/catch swallowed |
| Grid / ground | `scene-runtime.js` `rebuildEnvironment()` L288-321 | CSS-var driven color, hardcoded opacity |
| Axis widget | `scene-runtime.js` `addAxisWidget()` L358-422 | Own mini scene/camera, rendered in a scissor viewport each frame |
| Truck/trailer **visual** geometry | `scene-runtime.js` `setTruck()`/`addTrailerVolume()` L756-1019 | Hardcoded wall/floor/rail colors, not preference-driven |
| Truck/trailer **authoritative** envelope | `trailer-geometry.js` | Inch-space, camera/mesh-independent |
| Case **visual** geometry | `geometry-factory.js` `createCaseGeometry()` | Box or Cylinder only |
| Case **authoritative** geometry | `oriented-dims.js` + `dimensions` on the case model | Right-angle-only math, explicitly documented |
| Case materials / colors / labels | `editor-screen.js` `createInstanceGroup()`/`generateCaseTexture()` L725-949 | Labels baked into face textures, not sprites |
| Edge lines | `editor-screen.js` `acquireEdgeGeometry()` L877-897 | Cached/ref-counted by signature |
| Selection/hover/collision/drag visual state | `editor-screen.js` `resolveCaseVisualState()` L94-131 (exported, pure) | Single-owner priority chain — **already centralized** |
| Drag preview | `editor-screen.js` `updateDrag()`/`applyDragCandidates()` | Live collision check during drag, not just on drop |
| Raycasting/picking | `editor-screen.js` single `THREE.Raycaster` L1831 | No layers; gizmo checked before cargo |
| Object disposal | `editor-screen.js` `disposeGroup()` L951-972; `scene-runtime.js` `disposeObject3D()` L553-559 | Ref-counted geometry/texture caches |
| Resizing / pixel ratio | `scene-runtime.js` `resize()` L513-524, capped `devicePixelRatio ≤ 2` | Triggered by `editor-screen.js` ResizeObserver, L4156-4160 |
| Screenshot/PDF export | `src/app.js` `ExportService` L1471-2032 | **Not** in editor-screen.js or scene-runtime.js |
| Preferences | `preferences-manager.js` + `defaults.js`/`normalizer.js` | Thin wrapper over `StateStore`; **not subscribed to** anywhere |

### Duplicated / ambiguous / dangerously coupled ownership (confirmed)

1. **`PreferencesManager` is injected into `scene-runtime.js` but never called** (`scene-runtime.js:19`, destructured as `_PreferencesManager` — underscore convention for unused). Confirmed dead, not merely under-used. Any future "shadows on/off" or "trailer line color" preference will need a *new* read path into scene-runtime.js — there's no existing wiring to build on despite the parameter suggesting otherwise.
2. **`showShadowControls = false`** in `settings-overlay.js:4774` — dead code block for a shadow toggle UI that was built but is compiled out.
3. **`showShadows`, `showLabels`, `showBevels`, `renderQuality`, `camera.defaultView`, `labelFontSize`** are all defined in the preference schema (`defaults.js`) and normalized (`normalizer.js`), but **have no runtime reader** in `scene-runtime.js` or `editor-screen.js` (confirmed by grep — `labelFontSize` is written by settings-overlay.js and read only by itself). These are schema/UI-only, not wired to the renderer.
4. **Bare `p` = DevOverlay toggle vs. `Cmd/Ctrl+P` = AutoPack** (`keyboard-manager.js`) — not visual-foundation-relevant but a UX collision worth knowing about if new shortcuts are added.
5. **One localStorage bypass**: `editor-screen.js:3534,4034,4736` persists case-browser filter visibility directly via `window.localStorage`, outside `preferences-manager.js`/`StateStore` — not itself risky, but the established anti-pattern to avoid repeating for a new visual preference.

**No renderer rewrite is indicated.** The scene-runtime.js/editor-screen.js split is clean and should be preserved.

## D. Current Visual System Assessment

Rendering pipeline is a competent, if visually generic, direct-Three.js setup: ACESFilmic tone mapping, SRGB output, PCF shadows, a 5-light rig (ambient + key + fill + hemi + rim), and a procedural PMREM environment for subtle reflections. Materials are hardcoded (`MeshStandardMaterial`, wall opacity 0.08, floor `0xa89070`), not preference- or theme-driven beyond grid/background CSS-var colors. This reads as competently lit but visually undifferentiated — closer to a default Three.js demo than a branded logistics product, which matches the roadmap's own framing ("Professional 3D Editor Visual Foundation" is explicitly not-yet-started).

## E. Authoritative Geometry vs Visual Geometry Safety Assessment — **KEEP, this is sound**

Confirmed cleanly separated:
- **Authoritative:** `trailer-geometry.js` (inch-space zones), `oriented-dims.js` (right-angle rotation math, explicitly documents it matches THREE's Euler `'XYZ'` order so stored dims agree with the runtime scene), `orientation.js` (canonical `orientationLock` values). None of these import THREE or touch a mesh.
- **Visual:** `scene-runtime.js` `addTrailerVolume()`/rails, `geometry-factory.js` `createCaseGeometry()`. Both consume inch values via `toWorld()` — they never derive dimensions *from* a rendered mesh.
- **Test-enforced parity**: `security-and-invariants.spec.mjs` explicitly asserts the front-overhang **visual** volume (`getFrontBonusZone`) and the **collision** zone (`getTrailerUsableZones`) share identical x/y/z bounds — this is exactly the invariant a future GLB spike must preserve.
- **Confirmed risk for the future**: collision is **AABB-only**, correct only because rotation is constrained to right angles (`oriented-dims.js` header comment states this explicitly). This is fine today and fine for a future GLB visual model too, *provided* the GLB's authoritative bounding box still comes from the case's stored `dimensions`, never from the loaded mesh's own bounds — this is the exact guardrail V6's "GLB architecture" invariant already states (`TP3D-MASTER-TODO-V6.md` §7).

No confirmed issue here. One improvement opportunity: nothing in the current architecture currently *reads* a mesh's bounding box to drive behavior — good — but there's also no explicit runtime assertion enforcing that a future GLB loader can't do so. Worth a lint-style guard when GLB lands, not now.

## F. Cargo Rendering Assessment

- Box or cylinder only (`geometry-factory.js`), 6 `MeshStandardMaterial`s per case (roughness 0.88, metalness 0.01, `envMapIntensity: 0.3`, unused `bumpScale`), category color drives both face-texture background and (darkened 0.55×) edge-line color.
- Edge geometry is cached/ref-counted by a `caseId:dims:color` signature — **not** rebuilt per-frame or per-drag. Good, no perf concern here.
- **Confirmed issue**: `bumpScale: 0.02` is set with no `bumpMap` assigned — inert, dead material property.
- **Improvement opportunity**: subtle bevels/rounded edges are plausible without changing the authoritative envelope (visual-only geometry on top of the same AABB, same pattern already used for edge lines) — but should be evaluated against the 300-case perf budget (Section Q) before committing to it, since it would multiply geometry per case.
- Selection/hover/collision/staged states are unified through a single exported pure function (`resolveCaseVisualState`) with an explicit priority chain and characterization tests already covering it (`manual-vertical-placement.spec.mjs` "EDITOR-VISUAL" block) — this is the right foundation to extend, not replace.
- **Architectural gap**: no distinct staged-vs-loaded color state — staged/packed distinction today only changes gizmo behavior (Y-handle hidden) and OOG-highlight suppression, not case color. If "clearer staged vs. loaded cargo" is a design goal, it needs a new state added to `resolveCaseVisualState`'s existing priority chain — low risk, well-contained change.

## G. Typography / Label Assessment — **needs redesign, this is the weakest subsystem**

Labels are **baked directly into the box-face `CanvasTexture`s**, not a separate `Sprite`/overlay layer. Confirmed: zero `THREE.Sprite` usage for case labels anywhere in `editor-screen.js` (the only two `Sprite`s in the whole editor are the axis-widget's x/y/z letters in `scene-runtime.js`).

- Texture resolution is derived from **physical case size**, not screen DPI: `Math.min(512, Math.max(64, dims.length * 4))` — a small case can get a 64px-wide texture with case name, weight, stack-warning, and pallet-weight text baked in at `Arial, sans-serif`. No `devicePixelRatio` handling anywhere in this path.
- Text does **not** regenerate on drag (good for perf — texture only rebuilds when the case-type/dims/color signature changes) but also means the same low-res baked text is what a "professional typography" pass has to work with.
- `labelFontSize` preference exists in the schema and is user-editable in Settings, but **is never read** by the label-rendering code — currently a no-op control.
- **Zero test coverage** on `CanvasTexture`/label generation (`generateCaseTexture`) — any typography rework here has no regression net today.

**Recommendation** (per prompt's request for one architecture, not multiple options): move to **screen-space-independent Sprite-based labels** (or a lightweight CSS2DRenderer overlay for text-heavy elements like dimension callouts) decoupled from the box-face material, sized against actual render resolution rather than case dimensions in inches. Baked-into-material labels are the wrong long-term choice specifically because they conflate "case surface color/texture" with "text legibility," which is why a 3-inch pallet leg currently gets a 64px label canvas. This does not touch collision/packing geometry at all — it's a pure `editor-screen.js` change plus, if measurement-tool overlays are wanted later, a shared text-sprite helper both features can use.

## H. Measurement Tool Architecture Recommendation

**Confirmed: does not exist.** No `src/` hits for measurement anywhere; product docs (`truckpacker-comparison-v1-2026-04-19.md` §8) explicitly log it as "❌ Not implemented" versus the reference product's full raycast point-to-point tool.

Given the codebase's existing patterns, the cleanest fit is:
- A new, isolated interaction mode inside `editor-screen.js`'s `InteractionManager` (same raycaster, same pointer-event pipeline already used for drag/gizmo) rather than a separate module — it needs the same picking infrastructure and must respect the existing gizmo-takes-priority raycast order.
- Measurement **endpoints should snap to authoritative geometry** (case AABB corners/edges via the same `getAabbWorld()` used for collision, and trailer wall positions via `TrailerGeometry.getTrailerUsableZones()`), never to a decorative mesh's bounds — this mirrors the existing snap-to-wall/snap-to-case-edge pattern (`snapToNearest()`) almost exactly, so measurement snapping can likely reuse or lightly extend that function rather than invent new snap logic.
- Dimension-line/label rendering should use whatever the Section G typography solution becomes (Sprite/CSS2D), since measurement text has the same DPI/legibility requirements as case labels, just camera-facing rather than surface-mounted.
- Session-only by default (not persisted in a pack), consistent with the "session-only editor state" preference category already established in `preferences-manager.js`'s scoping model.
- **Sequencing dependency**: measurement tool needs both the typography rework (G) and, for full usefulness, the orthographic Top/Front/Side camera views (Section L / roadmap item 2) to be worth shipping — it's listed as a Visual Foundation concern in this audit's brief but its full value is blocked on the Camera/View System milestone. Recommend treating it as **infrastructure-only in this phase** (snap-target helpers, shared label rendering) with the actual UI/tool deferred to align with Camera/View System.

## I. Snapping Architecture Assessment

**Confirmed: two working mechanisms already exist**, both in `editor-screen.js`, both gated by `prefs.snapping.enabled`:
1. **Grid snap** — live during drag, rounds world XZ position to `Math.max(0.25, prefs.snapping.gridSize)` inches.
2. **Edge/wall snap** — applied at drag-finish, `SNAP_DIST = 2 inches`, checks truck usable-zone walls and other cases' AABB edges independently per axis.

Both are XZ-only (no vertical snap — Y is handled by separate surface-following/settle logic) and both share collision infrastructure (`getAabbWorld`, `TrailerGeometry.getTrailerUsableZones`) rather than duplicating it — good.

**Confirmed pre-existing gap** (documented in `truckpacker-comparison-v1-2026-04-19.md` and structurally true from the code): snap uses `halfWorld` derived from a case's *original* dimensions, not a quaternion-correct rotated corner position — for right-angle rotations this is actually fine (this is exactly what `oriented-dims.js` computes correctly), but the comparison doc's concern appears to predate or misdescribe the current `oriented-dims.js`-based `halfWorld` computation confirmed in `editor-screen.js:984-989`. Worth a quick verification pass before trusting the doc's framing, but not a blocker.

**Test coverage**: wall-snap sourcing from usable zones is protected; grid-size snap has no direct test hit — an easy, low-risk test to add before touching this code.

No rewrite indicated — visual snap guides (highlighting the target wall/edge during drag) would be a pure additive UI layer on top of the existing `snapToNearest()`/`getSnapWallCandidatesWorld()` return values, not a snapping-logic change.

## J. Trailer / Floor / Line Visual Assessment

All trailer visual construction is in `scene-runtime.js` `setTruck()`/`addTrailerVolume()`/`addBoxRails()` (L756-1019, ~260 lines). Notable, already-good details:
- Door-end (green) vs. cab-end (red) color coding on both wireframe edges and solid mesh-based exterior rails — the rails exist specifically because `LineBasicMaterial.linewidth` isn't reliably honored by WebGL, so a `BoxGeometry`-per-edge fallback was already built. This is a real, working technique for "confident-looking" outlines and should be the pattern reused for any new visual line elements rather than relying on `linewidth`.
- Front-overhang/wheel-well "seam trimming" (`trimSeamEdges`) already solves the double-outline-at-a-shared-face problem — good prior art if new attached volumes are ever added.
- All wall/floor/rail colors are **hardcoded**, not CSS-var or preference driven (only grid color and scene background use `Utils.getCssVar`). This is the direct architectural gap behind "trailer line color preference" / "floor color preference" as product asks — currently there is no read path for either.

**Raycasting/picking participation**: trailer wall meshes are `depthWrite: false`, low-opacity `MeshStandardMaterial` — confirmed **not** raycast against in `editor-screen.js` (only case meshes and gizmo handles are raycast targets), so trailer visuals are safe to restyle without touching interaction logic.

## K. Lighting / Shadow Assessment

Renderer config (`scene-runtime.js:169-184`): antialias, alpha, `high-performance`, PCF shadow map, ACESFilmic tone mapping (exposure 1.15), SRGB output. Shadow-camera bounds are dynamically recomputed per truck size (`updateShadowBounds()`) — this is already correct and non-trivial to get right; **keep as-is**.

- Shadows have a **working runtime toggle** (`s` key → `SceneManager.toggleShadows()`) and an **auto-perf-mode** that disables shadows after 5s of sub-30fps and shows a toast with a "Restore" action (`updatePerf()` L436-465) — a genuinely good existing UX pattern for the "Shadows: Off/Standard/High" preference model the brief asks about.
- **Confirmed dead code**: the `showShadows` preference and the settings-overlay shadow-status UI (`showShadowControls = false`) are both non-functional — the real toggle bypasses preferences entirely and is pure in-memory scene state, not persisted. A "Shadows on/off" *preference* (as opposed to the existing session-only keyboard toggle) doesn't exist despite the schema field.
- No InstancedMesh or other renderer-level optimization is in place, and per Section Q this isn't a proven bottleneck yet.

**Recommendation**: wire the existing `toggleShadows()`/perf-mode logic into `PreferencesManager` (persist the current session toggle state as a preference) rather than inventing a new lighting-intensity slider system from scratch — this closes the schema-vs-implementation gap with the smallest change.

## L. Camera / View / Crew View Assessment — **architectural gap, biggest sequencing risk**

**Confirmed: no camera-preset system exists anywhere.** Single `THREE.PerspectiveCamera` + `OrbitControls`, `focusOnWorldPoint()` (tween-based recenter, used by "focus selected," `shift+F`) is the only camera-programming beyond user orbit/pan/zoom. No Front/Rear/Top/Side/Isometric buttons, no orthographic camera in the interactive view (orthographic cameras *do* exist, but only inside `app.js`'s PDF export path, built fresh each time via `buildOrthoCameras()` and never exposed to the live viewport).

This is `TP3D-MASTER-TODO-V6.md`'s own roadmap item #2, explicitly scoped for after Visual Foundation, with Crew/Loader view explicitly deferred further still ("Future: crew/loader view" under item #2, not item #1). This audit's own reading of the code confirms that sequencing is correct: building named viewpoints requires a camera-transition system, and the PDF export module already has ad-hoc orthographic-camera code that a real Camera/View System would want to consolidate with, rather than duplicate.

**One live invariant to protect**: `TP3D-MASTER-TODO-V6.md` §7 states "Camera orbit/pan/zoom must remain usable during operations" (i.e. during AutoPack/Unpack/Truck Change) — any camera-system work must preserve this, and it's currently true because `OrbitControls.update()` runs unconditionally in `tick()` regardless of `OperationLifecycle` busy state.

## M. Grid / Spatial Reference Assessment

Single `THREE.GridHelper`, CSS-var-driven color, opacity 0.15, toggled by `g` key and re-sized whenever the truck's environment bounds change. No unit-increment options, no "hide below a certain zoom" logic. This is already appropriately restrained/non-noisy for a default state (KEEP), and is a reasonable base to add precision aids (finer sub-grid, unit labels) onto later without restructuring.

## N. Selection / Hover / Drag Visual-State Assessment — **KEEP, strongest subsystem**

`resolveCaseVisualState()` (`editor-screen.js:94-131`) is a pure, exported, single-owner priority-chain function: `hidden > collision > selected > oog > dragged > hovered > normal`. This is exactly the "centralized visual-state hierarchy" the brief asks whether exists — **it already does**, and it's under characterization tests (`manual-vertical-placement.spec.mjs`, "EDITOR-VISUAL" block) that explicitly assert "one deterministic priority" and "scene lifecycle recomputes instead of conditionally restoring materials." Any Visual Foundation work touching case materials should extend this function's priority chain (e.g. adding a "staged" branch) rather than adding parallel state-tracking.

One real perf-relevant note: `recomputeVisualStates()` re-applies visual state to **every** case instance on any single hover/select/drag/collision change, not just the changed instance — flagged under Performance (Section Q) as a likely-not-yet-a-problem, worth measuring at 300 cases before "fixing."

## O. Preferences Architecture Assessment

Established, mostly good pattern: `defaults.js` (schema + defaults) → `normalizer.js` (coercion/validation, unknown keys dropped, numeric clamps) → `preferences-manager.js` (thin `get()`/`set()`/`applyTheme()` over `StateStore`) → `storage.js` (persists under a **user-scoped** key, separate from the **workspace-scoped** key used for packs/cases). Preferences are included in full "App Backup" export/import but explicitly excluded from Pack and Workspace export — this is a deliberate, tested boundary (`import-export.js:555` actively rejects a pack file that contains a `preferences` key).

**Gap for a new 3D preference**: no `subscribe()` exists on `preferences-manager.js` — consumers (`editor-screen.js`) re-read `StateStore.get('preferences')` directly on each render rather than subscribing to changes, and `scene-runtime.js` has no read path into preferences at all (Section C, point 1). Any new visual preference (trailer line color, floor color, grid appearance) needs: (1) a new key in `defaults.js`, (2) a coercion rule in `normalizer.js`, (3) a **new** read call added to `scene-runtime.js` (there is no existing wiring despite the injected-but-unused parameter), read via `StateStore.get('preferences')` at the point of use, matching the `editor-screen.js` pattern rather than the unused `PreferencesManager.get()` call.

**Global vs. session precedent is clear and should be followed**: global/user-scoped = anything under `defaultPreferences`; session-only = raw `sessionStorage`/`localStorage` outside the preferences system, with one confirmed anti-pattern already in the codebase (`editor-screen.js` case-browser filter flag) not to replicate.

## P. Scene Hierarchy / Resource Lifecycle Assessment

Scene hierarchy is **mostly flat** by design choice, not oversight: each cargo instance is a standalone `THREE.Group` added directly to the scene root (no shared "cargo" parent group), plus one shared `gizmoGroup`, plus truck/grid/ground/lighting objects owned by `scene-runtime.js`. There is no separate "labels," "helpers," or "selection markers" group because those concerns are currently folded into each case's own group (labels baked into materials) or don't exist yet (measurement, snap guides).

Disposal is solid: ref-counted geometry/texture caches (`edgesCache`/`textureCache`) plus a single reconciliation entrypoint (`CaseScene.sync()`) that diffs the pack against live instances and disposes anything removed or signature-changed. **One unverified gap**: `gizmoGroup`/`gizmoMaterials` are created once per `CaseScene` lifetime with no observed `dispose()` call anywhere — low risk (created once, not per-case) but worth a quick check before this becomes a template for new always-on overlay groups (measurement, snap guides) that might be created/destroyed more frequently.

**Recommendation**: introduce lightweight named parent groups (`cargoGroup`, `helpersGroup`, `annotationsGroup`) now, at the start of Visual Foundation work, purely as an organizational scaffold for the label/measurement/snap-guide systems that are about to be added — this is exactly the kind of "minimal organizational improvement with real value" the brief allows, not a refactor of working code.

## Q. Performance Assessment

No load-testing was run as part of this read-only audit (would require a browser session), so all figures below are **from source inspection**, not measurement — flagged accordingly.

| Concern | Classification | Basis |
|---|---|---|
| Auto perf-mode disabling shadows below 30fps for 5s | **Already implemented, working** | `updatePerf()`, `scene-runtime.js:436-465` |
| `recomputeVisualStates()` touches all instances on any single state change | **Likely future bottleneck**, not proven | Confirmed O(n) behavior in code; no measurement exists at 300 cases |
| Unique `LineBasicMaterial` per case instance (edges) | **Likely future bottleneck** | Geometry is shared/cached; materials are not |
| CanvasTexture generation | **Not a bottleneck today** | Only regenerates on signature change, not per-frame/per-drag |
| EdgesGeometry per unique case signature | **Not a bottleneck today** | Cached + ref-counted, not per-instance |
| Raycasting | **Not measured** | Flat array rebuilt each raycast call (`getRaycastMeshes()`) — O(n) rebuild per hover-throttled (50ms) tick; likely fine at current scale, unverified at 300 |
| High devicePixelRatio | **Mitigated already** | Capped at 2 in both `initScene()` and `resize()` |
| Shadow casting at 300+ cases | **Theoretical concern** | No InstancedMesh; each case casts/receives shadows individually; not measured |

Do not introduce InstancedMesh or other structural performance rewrites without first measuring at 1/25/100/300 cases — none of the "likely future bottleneck" items above are confirmed problems today.

## R. Screenshot / PDF Compatibility Assessment

Capture path (`app.js` `ExportService`, L1471-2032) is well-isolated: renders off-screen to a `WebGLRenderTarget` (not the visible canvas), forces `pixelRatio = 1`, hides the grid (`hideGrid: true` at every call site), fully saves/restores viewport/scissor/background state. **No forced white/neutral background** — export uses whatever the current theme's scene background is; **no special handling for shadows or transparent trailer walls** during capture — both render as-is.

`generatePDF()` builds two dedicated orthographic cameras (`buildOrthoCameras()`, L1903-1937) for Top/Side views, separate from the interactive camera — this is exactly the kind of ad-hoc orthographic-camera code the future Camera/View System (Section L) should consolidate with rather than duplicate.

**Risk for Visual Foundation work**: any new visual feature that looks correct interactively but isn't accounted for in `renderCameraToDataUrl()` (e.g. new Sprite-based labels, if they're depth-tested/camera-facing in a way that doesn't render identically from an orthographic angle, or new overlay geometry like snap guides that shouldn't appear in exports) needs an explicit include/exclude decision — currently only the grid has that treatment (`hideGrid`). Labels-as-baked-textures (today) export correctly by construction; Sprite-based labels (Section G's recommendation) will need this decision made explicitly.

## S. GLB Future-Readiness Assessment

No GLB code exists yet (confirmed, and intentionally out of scope for this audit). The existing architecture already satisfies the stated principle — **authoritative packing envelope ≠ optional visual model** — because case geometry construction (`geometry-factory.js`) is a single, swappable function call (`createCaseGeometry(caseData, toWorld)`) that returns a mesh geometry from *authoritative inch dimensions*; nothing downstream depends on the mesh's own bounds. A GLB loader would slot in as an alternative branch inside (or beside) `createCaseGeometry()`/`createInstanceGroup()`, continuing to size/position the *authoritative* AABB from `dimensions`/`oriented-dims.js` regardless of what the loaded model's own geometry reports. No architectural change is needed now to keep this option open — **KEEP** the current factory-function boundary.

## T. Feature Readiness Matrix

| Feature | Status | Owning files | Notes |
|---|---|---|---|
| Professional cargo materials | PARTIAL / NEEDS PREP | `editor-screen.js` L899-949 | Dead `bumpScale`; hardcoded roughness/metalness |
| Cargo edges | READY WITH CURRENT ARCHITECTURE | `editor-screen.js` L877-946 | Cached/ref-counted, extend in place |
| Cargo labels | ARCHITECTURAL GAP | `editor-screen.js` L725-779 | Baked-texture approach; needs Sprite/CSS2D redesign (Section G) |
| Canvas typography (general) | ARCHITECTURAL GAP | n/a | No shared text-rendering helper exists yet |
| Selection styling | ALREADY IMPLEMENTED | `editor-screen.js` L94-131 | Centralized, tested — extend don't replace |
| Hover styling | ALREADY IMPLEMENTED | same | |
| Collision styling | ALREADY IMPLEMENTED | same | |
| Contact cues | ARCHITECTURAL GAP | n/a | No AO/contact-shadow technique in place beyond directional shadow map |
| Trailer visual redesign | READY WITH CURRENT ARCHITECTURE | `scene-runtime.js` L756-1019 | Hardcoded but well-isolated; not raycast-coupled |
| Trailer line-color preference | PARTIAL / NEEDS PREP | `scene-runtime.js` + `defaults.js`/`normalizer.js` | Needs new pref key + new read wiring (none exists) |
| Floor-color preference | PARTIAL / NEEDS PREP | same | Same gap |
| Lighting improvements | READY WITH CURRENT ARCHITECTURE | `scene-runtime.js` L213-247 | Shadow bounds already dynamic/correct |
| Shadow controls | PARTIAL / NEEDS PREP | `scene-runtime.js` + dead `showShadows` pref + dead settings UI | Working runtime toggle exists but unwired to preferences |
| Grid improvements | READY WITH CURRENT ARCHITECTURE | `scene-runtime.js` L288-321 | |
| Measurement tool | ARCHITECTURAL GAP | none | Infra-only this phase (Section H) |
| Box snapping improvements | READY WITH CURRENT ARCHITECTURE | `editor-screen.js` snap functions | Already CAD-like; extend visual guides only |
| Snap guides | ARCHITECTURAL GAP | n/a | Pure additive UI over existing snap return values |
| Camera preset expansion | ARCHITECTURAL GAP | n/a | Deferred to roadmap item #2 by design |
| Orthographic views | PARTIAL / NEEDS PREP | `app.js` `buildOrthoCameras()` | Exists for PDF only, not live viewport |
| Isometric view | ARCHITECTURAL GAP | n/a | Deferred to roadmap item #2 |
| Crew/Loader view | DEFER | n/a | Explicitly future work per V6 roadmap item #2 |
| Cutaway/section view | DEFER | n/a | Not scoped in current roadmap |
| Saved viewpoints | DEFER | n/a | Not scoped in current roadmap |
| Screenshot compatibility | READY WITH CURRENT ARCHITECTURE | `app.js` `ExportService` | Isolated, save/restore pattern already correct |
| PDF visualization compatibility | READY WITH CURRENT ARCHITECTURE | same | Will need updating once Sprite labels/snap guides exist (Section R) |
| GLB visual-model readiness | READY WITH CURRENT ARCHITECTURE | `geometry-factory.js` | Factory-function boundary already supports it |
| Performance readiness | PARTIAL / NEEDS PREP | n/a | No measurement yet at 100/300 cases; do this before optimizing |

## U. Regression Risk Matrix

| Recommendation | Affected subsystem | Why risk exists | Mitigation |
|---|---|---|---|
| Sprite/CSS2D label redesign | Selection raycasting, screenshot/PDF export, scene hierarchy | Labels currently baked into raycast-targeted case meshes; moving to Sprites changes what geometry the raycaster and exporter see | Keep Sprites non-raycast-targeted (don't add to `getRaycastMeshes()`); explicitly test PDF/screenshot capture includes new label layer (Section R) |
| Trailer/floor color preferences | Raycasting (none — confirmed not raycast targets), scene hierarchy | Low risk — trailer visual meshes are already confirmed excluded from picking | None needed beyond the new pref-wiring itself |
| Wiring shadows to preferences | Perf auto-mode (`updatePerf()`), OperationLifecycle | Existing auto-disable-on-low-fps logic must not fight a persisted user preference | Preference sets the *default*/session-restore value; auto-perf-mode's runtime override should remain session-only, not overwrite the stored preference |
| Snap guides UI | Drag/collision interaction, raycasting | New always-on-during-drag geometry must not become a raycast target or interfere with `updateDrag()`'s plane math | Purely additive `LineSegments`/`Sprite` overlay, never added to raycast arrays, driven from existing `snapToNearest()` return values only |
| Extending `resolveCaseVisualState()` (e.g. staged color) | Selection/hover/collision test suite (`manual-vertical-placement.spec.mjs`) | Priority-chain function is under characterization tests asserting exact current behavior | Add the new state as a new priority tier, update/extend existing tests rather than replacing the function |
| Contact-cue / AO-style effects | Depth perception, but risk is *product-level*: implying gaps that aren't real | Brief explicitly warns against this | Prefer shadow/edge-based cues already in place over any new geometry that could misrepresent spacing |
| Camera preset system (future phase) | `focusOnWorldPoint()`, OperationLifecycle invariant ("camera must remain usable during operations") | New transition/preset code must not disable orbit controls during AutoPack/Truck-Change | Keep `controls.update()` unconditional in `tick()`; presets should animate camera/target, never toggle `controls.enabled` during a busy operation |
| Any perf optimization (InstancedMesh etc.) | Selection/hover per-instance material system | InstancedMesh would break per-instance material mutation that `resolveCaseVisualState` depends on | Do not adopt without first measuring 300-case perf (Section Q) and redesigning the visual-state system around it — treat as a separate, larger initiative if ever needed |

**Highest-risk coupling overall**: none of the above touch collision/packing math. The regression surface for Visual Foundation work is entirely contained to rendering/materials/UI — this is the expected, good outcome of the existing authoritative/visual separation (Section E).

## V. Recommended Visual Foundation Architecture

**Stay exactly as-is:**
- `scene-runtime.js` / `editor-screen.js` / `trailer-geometry.js` / `geometry-factory.js` file boundaries and responsibilities.
- `resolveCaseVisualState()` priority-chain pattern — extend, don't replace.
- Edge/texture ref-counted caching pattern in `editor-screen.js`.
- Mesh-based exterior rails technique (solves the `linewidth` WebGL limitation) — reuse for any new confident-looking line/outline work.
- The authoritative-vs-visual geometry boundary (Section E) — this is the one invariant every other recommendation depends on.
- Screenshot/PDF export's save/restore-state pattern in `app.js`.

**Should evolve:**
- Label rendering: baked-texture → Sprite/CSS2D-based system, decoupled from case material, screen/DPI-aware (Section G). This is the one genuinely new subsystem the Foundation phase needs to build, and it should be built once and shared with the future measurement tool.
- Preferences wiring: add the missing `scene-runtime.js` read path (currently absent despite the unused injected parameter) as new preferences are added — don't invent a parallel mechanism.
- Scene hierarchy: introduce named parent groups (`cargoGroup`, `helpersGroup`, `annotationsGroup`) as light scaffolding, ahead of adding labels/snap-guides/measurement — this is additive, not a refactor.
- Dead schema cleanup: either wire up or remove `showShadows`, `showBevels`, `renderQuality`, `camera.defaultView`, and the dead `showShadowControls` block — decide explicitly rather than leaving them as silent no-ops during a phase that's specifically about these controls.

## W. Recommended Implementation Sequence

Internal sequencing for "Professional 3D Editor Visual Foundation" (roadmap item #1), before Camera/View System (item #2):

1. **Rendering/scene-hierarchy scaffolding** — add named parent groups; no visual change, pure organization, de-risks everything after it.
2. **Material/state-system extension** — clean up dead `bumpScale`, decide material response (roughness/metalness) intentionally rather than as leftover defaults; extend `resolveCaseVisualState()` if a staged-vs-loaded color state is wanted. Low risk, builds on the strongest existing subsystem.
3. **Typography system** (Section G) — build the Sprite/CSS2D label renderer. This is the highest-effort, highest-value item and everything downstream (measurement tool infra, snap guides, future dimension callouts) depends on it existing first.
4. **Trailer visual pass + preferences wiring** — restyle trailer/floor/line materials, and simultaneously build the missing `scene-runtime.js` preferences read path so trailer-color/shadow preferences become real. Bundling these avoids wiring the preferences pipe twice.
5. **Contact cues / depth readability** — smallest, most subjective pass; do last since it's pure refinement on top of an already-restyled trailer + cargo.
6. **Screenshot/PDF re-verification** — after 1-5, confirm exports still look correct (Section R) before calling Visual Foundation done, since new label/material work changes what the exporter needs to account for.

Then proceed to Camera/View System (roadmap item #2), which is correctly gated behind this phase because it needs the typography system (view labels, orthographic view UI) and will consolidate the PDF module's ad-hoc `buildOrthoCameras()` into a real live-viewport feature.

## X. First Implementation Pass Recommendation

**One tightly scoped task**: Build the Sprite-based (or CSS2D, decide during implementation) case-label rendering system as a standalone module, wired into `editor-screen.js` in place of the current baked-into-face-material text, with DPI-aware sizing and a disposal path that matches the existing ref-counted texture-cache pattern.

**Likely files to touch:**
- `src/screens/editor-screen.js` — `generateCaseTexture()` (L725-779), `acquireTextures()` (L781-797), `createInstanceGroup()` (L899-949): remove baked label text from face textures, add a new label-Sprite creation/attach step.
- Possibly a new file, e.g. `src/editor/case-labels.js`, if the label system is substantial enough to warrant its own module (matches the existing `geometry-factory.js`/`trailer-geometry.js` extraction pattern).
- `src/core/defaults.js` / `src/core/normalizer.js` — only if `labelFontSize` is being made functional as part of this pass (recommended, since it's already user-facing but currently a no-op).

**Files/subsystems to explicitly avoid touching:**
- `src/editor/trailer-geometry.js`, `src/core/oriented-dims.js`, `src/core/orientation.js` — authoritative geometry, zero reason to touch for a label change.
- `src/services/autopack-engine.js`, `src/services/autopack-solver.js` — packing logic, unrelated.
- Collision functions in `editor-screen.js` (`checkCollision`, `checkSweptCollision`, `getAabbWorld`) — labels must never participate in raycasting or collision.
- `src/app.js` `ExportService` — only revisit *after* the label system lands, to verify screenshot/PDF still render it correctly (Section R), not as part of the same change.

## Y. Decisions Needed From Product Owner

1. **Staged vs. loaded cargo color**: should this be a new distinct visual state (new tier in `resolveCaseVisualState`), or is the current gizmo-only/OOG-suppression distinction sufficient? Not resolved by any existing doc or code.
2. **Shadow preference model**: the brief suggests "Off/Standard/High" — current code only has a binary on/off toggle (with an automatic perf-mode override). Confirm whether a 3-tier model is wanted now or binary is sufficient for this phase, since "High" shadow quality has no existing implementation to build from.
3. **Bevel/rounded-edge cargo geometry**: explicitly flagged in the brief as worth investigating; this audit did not find any existing prior art or decision either way in code or docs — needs an explicit go/no-go given the Section F performance caveat (extra geometry per case at 300-case scale, unmeasured).
4. **Where the typography system also serves measurement tooling**: confirm the product intent that the label-rendering system built in this phase (Section G/X) is meant to be reused by the future measurement tool (Section H), so it's designed generically now rather than case-label-specific — this shapes the first-pass API.

## Z. Final "Do Not Break" Checklist

- [ ] Case dimensions used for collision/packing/snapping must always come from `dimensions`/`oriented-dims.js`, never from a rendered mesh's computed bounding box — including any future GLB model.
- [ ] `security-and-invariants.spec.mjs`'s visual-vs-collision bounds parity assertions (front-overhang, wheel wells) must continue to pass unmodified unless the underlying zone math itself changes.
- [ ] `resolveCaseVisualState()` remains the single owner of case material/emissive/opacity state — no parallel state-setting path.
- [ ] New overlay geometry (labels, snap guides, measurement lines, contact cues) must never be added to `CaseScene.getRaycastMeshes()` or `getGizmoHandleMeshes()`.
- [ ] `OrbitControls.update()` must remain unconditional in the render `tick()` — camera must stay usable during AutoPack/Unpack/Truck-Change (explicit V6 invariant).
- [ ] `renderer.setPixelRatio` stays capped at 2; screenshot/PDF capture continues to force `pixelRatio = 1` and fully save/restore viewport/scissor/background state.
- [ ] Any new preference follows the established `defaults.js` → `normalizer.js` → `preferences-manager.js` → `StateStore`/`storage.js` (user-scoped) path — no new bespoke `localStorage` keys.
- [ ] Screenshot/PDF export (`app.js` `renderCameraToDataUrl`) is explicitly re-verified after any change to labels, materials, or overlay geometry — it does not automatically inherit visual changes correctly by default (only `hideGrid` has special export handling today).
- [ ] No React/R3F, no WebGPU, no renderer-architecture rewrite — direct Three.js r185.1 stays as-is.
- [ ] Right-angle-only rotation assumption in `oriented-dims.js` is not silently violated by any new visual feature (e.g. a "free rotate" gizmo mode) without a corresponding collision-system redesign.

---

**Test/lint baseline confirmed clean for a safe starting point**: 1360/1365 passing, 0 lint errors. Working tree clean at `a129c0a` on `main`. No files were modified during this audit.
