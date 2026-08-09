> Audit source: OpenAI Codex
> Audit date: 2026-08-09
> Mode: Read-only architecture audit
> Historical snapshot: This file preserves the audit as originally produced. Baseline versions, SHAs, and findings reflect the repository state at audit time and are not automatically updated.

# A. Executive Summary

Truck Packer 3D already has a sound base for a professional visual foundation. The correct architectural decision is to **KEEP direct Three.js/WebGLRenderer, the scene-runtime/editor-screen separation, canonical inch-space packing geometry, PackLibrary validation, and OperationLifecycle protections**. A renderer rewrite, React/R3F conversion, WebGPU migration, or geometry-driven GLB system is neither necessary nor advisable.

The editor’s strongest current property is that most operational behavior uses canonical dimensions and placement metadata rather than rendered mesh bounds. Collision, containment, stacking, rotation, Auto-Pack, and persisted placement are not generally derived from decorative geometry.

The principal pre-implementation risks are:

1. Cargo picking raycasts the rendered mesh itself. That works for exact boxes, but it will become unsafe for cylinders, bevels, GLBs, or multi-mesh visuals.
2. Trailer-zone calculations are duplicated between visual/trailer helpers and authoritative packing code.
3. Cargo visual resource identity is incomplete: the cache signature omits visual inputs such as shape and label content, allowing stale geometry or labels.
4. Label texture ownership/disposal is ambiguous, and the label system is not ready for dense professional loads.
5. The scene lacks semantic roots for overlays, annotations, labels, measurements, and export-only visibility policy.
6. Screenshot/PDF capture renders the live scene. Selection, gizmos, CoG, future measurements, and other helpers can leak into exports unless individually hidden.
7. Orthographic cameras exist only for PDF generation; they are not an editor camera system.
8. Several existing visual preferences are normalized or displayed but not wired to rendering.
9. No measured 1/25/100/300 visual benchmark exists. Current performance concerns should therefore be classified as likely or theoretical, not proven bugs.

The best internal direction is an incremental visual architecture:

```text
Canonical pack data in inches
        |
        +--> collision / support / snapping validation / Auto-Pack
        |
        +--> authoritative interaction proxy
                    |
                    +--> decorative visual root
                    +--> labels
                    +--> state overlays
                    +--> export visibility policy
```

Decorative meshes should never become packing truth.

# B. Baseline Verified

| Item | Verified result |
|---|---|
| Repository root | `/Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D` |
| Branch | `main` |
| HEAD | `a129c0aa1213dad4de3c8a4482b5aed7a388dd1b` |
| Working tree | Clean before and after audit; `main...origin/main` |
| Node | `v24.19.0` |
| npm | `11.17.0` |
| Declared Three.js | Exact `0.185.1` |
| Installed Three.js | `0.185.1` |
| Declared/locked Vite | Exact `8.2.0` |
| Installed Vite | `8.2.1`; npm reports this as invalid relative to the exact pin |
| Test result | 1,365 tests discovered; 1,360 passed; 5 stress-gated skips; 0 failures |
| Lint | Passed with existing warnings: 19 JS, 18 HTML, no CSS errors |
| Typecheck | Passed |
| `git diff --check` | Passed |
| Build | Not run because the Vite build empties/recreates `dist`, which would violate the no-modification instruction |
| Stress suite | Not run; explicitly gated through `TP3D_STRESS` |

The applicable repository instructions, current V6 roadmap, AutoPack contract, billing contract, targeted project history, current source, tests, and Graphify index were consulted in the required authority order.

Configuration references:

- [package.json](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/package.json:7>)
- [vite.config.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/vite.config.js:33>)
- [TP3D-MASTER-TODO-V6.md](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/docs/product/TP3D-MASTER-TODO-V6.md:55>)
- [autopack-engine-contract.md](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/docs/engineering/autopack-engine-contract.md:7>)

The installed Vite drift should be corrected separately before implementation so everyone evaluates the same renderer/build baseline. It did not invalidate the audit tests.

# C. Current 3D Architecture Map

## Primary ownership

| Responsibility | Current owner |
|---|---|
| Renderer, scene, perspective camera, OrbitControls | `createSceneRuntime()` in [scene-runtime.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/editor/scene-runtime.js:16>) |
| Render loop, resize, DPR, shadows, background | `scene-runtime.js` |
| Lighting/environment/ground/grid/axis widget | `scene-runtime.js` |
| Trailer visual mesh construction | `setTruck()` and helpers in `scene-runtime.js` |
| Cargo mesh, materials, edges, labels | `createCaseScene()` in [editor-screen.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/screens/editor-screen.js:703>) |
| Cargo visual-state precedence | `resolveCaseVisualState()` in [editor-screen.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/screens/editor-screen.js:89>) |
| Drag, selection, picking, gizmo, snapping | `createInteractionManager()` in [editor-screen.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/screens/editor-screen.js:1813>) |
| Cargo primitive geometry | [geometry-factory.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/editor/geometry-factory.js:19>) |
| Canonical trailer zones and placement validation | [pack-library.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/services/pack-library.js:179>) |
| Wheel-well physical model | [wheel-well-model.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/services/packing-core/wheel-well-model.js:62>) |
| Orientation-aware dimensions | [orientation.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/services/packing-core/orientation.js:21>) |
| Canonical AABB validation | [validation.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/services/packing-core/validation.js:27>) |
| Auto-Pack orchestration | [autopack-engine.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/services/autopack-engine.js:959>) |
| Operation tokens and mutation exclusion | [operation-lifecycle.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/core/operation-lifecycle.js:17>) |
| Application wiring and shortcuts | [app.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/app.js:1406>) |
| Screenshot/PDF/preview capture | `app.js`, principally `renderCameraToDataUrl()` at [app.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/app.js:1965>) |
| Preference defaults and normalization | [defaults.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/core/defaults.js:17>) and [normalizer.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/core/normalizer.js:170>) |
| Settings UI | [settings-overlay.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/ui/overlays/settings-overlay.js>) |
| Editor responsive layout | [main.css](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/styles/main.css:3931>) |

## Important call relationships

Graphify and current source show the application wiring as:

```text
app.js
  ├─ createSceneRuntime()
  ├─ createCaseScene(scene runtime)
  ├─ createInteractionManager(scene runtime, case scene, state)
  ├─ createOperationLifecycle()
  └─ createAutoPackEngine(...)
```

Export paths converge on one renderer helper:

```text
Pack preview ─┐
Screenshot ───┼─> renderCameraToDataUrl(scene, camera, ...)
PDF views ────┘
```

PDF orthographic cameras are currently private export cameras constructed by `buildOrthoCameras()`. They do not participate in normal editor interaction.

## Current scene hierarchy

The hierarchy is operational but flat:

```text
THREE.Scene
  lights
  environment
  ground
  grid
  trailer root
    walls/floor/rails/guides
  cargo groups
  transform gizmo
  CoG/helper objects
```

The axis widget is correctly separated into its own scene and camera.

Missing semantic roots include:

- editor-only overlays
- export-visible annotations
- labels
- measurements
- snap guides
- selection outlines
- heatmap visualization
- GLB visual-model children

This is an organizational gap, not a reason to rewrite the renderer.

# D. Current Visual System Assessment

## What should be kept

- Direct Three.js with WebGLRenderer.
- ACES tone mapping and sRGB output.
- Matte PBR-based cargo and trailer materials.
- A restrained translucent trailer rather than an opaque “game vehicle.”
- Floor shadow reception and cargo shadow casting.
- Dynamic shadow-camera fitting.
- Category identity and front/rear color cues.
- The separate axis widget.
- DPR capped at 2.
- The low-FPS shadow fallback.
- Continuous rendering while the editor is active, given current tween/control behavior.
- Central `resolveCaseVisualState()` precedence rather than scattered material writes.

## Confirmed weaknesses

1. Labels are hardcoded, low-information canvas textures using Arial, black text, `lb`, and truncation rather than a coherent in-canvas type system.
2. Cargo category color occupies most of the visible face area, producing a more generic/demo-like appearance than a restrained industrial system.
3. Selection and collision are mainly material/emissive changes. They do not always preserve semantic status when states overlap.
4. The current global grid is visually and semantically disconnected from the one-inch snapping system.
5. The camera has no professional preset/view family.
6. Export framing and presentation are not deterministic.
7. Existing label, bevel, shadow, and quality preferences are only partially wired.
8. Dense boxes can visually merge because edge, contact, status, and depth cues all compete at the same level.

## Ranked professional-impact opportunities

1. Professional cargo visual-state/material language.
2. Legible, scalable typography and label density rules.
3. Camera presets, orthographic views, fit behavior, and Crew view.
4. Restrained trailer/floor/grid presentation.
5. Consistent export presentation mode.
6. Contact/depth cues that preserve exact physical contact.
7. Simple lighting/shadow presets.
8. Measurement and precision-guide overlays.
9. GLB visual-model support after the envelope/proxy boundary exists.
10. Postprocessing only if subsequent measurements justify it.

“Professional” should mean controlled hierarchy and trustworthy information, not additional gloss, bloom, animation, or surface detail.

# E. Authoritative Geometry vs Visual Geometry Safety Assessment

## Current contract

The authoritative coordinate system is:

- X: trailer length.
- Y: elevation/height.
- Z: trailer width.
- X = 0: rear loading opening.
- Increasing X: toward the front/cab.
- Floor: Y = 0 unless an authoritative raised zone applies.
- Canonical distances: inches.
- Render conversion: `0.05` world units per inch.

`scene-runtime.js` defines `INCH_TO_WORLD = 0.05` and its inverse. Display helpers support inch/feet/centimeter/meter and contain millimeter conversion support, although millimeters are not currently accepted by the preference normalizer/UI.

## Safe current behavior

- Cargo collision AABBs are built from instance metadata and canonical effective dimensions.
- Orientation handling is explicitly derived from saved rotation and case dimensions.
- Containment, overlap, support, wheel-well, front-bonus/deck, and retention behavior live in packing services.
- Saved packs persist placement and rotation, not arbitrary Three.js transforms as physical truth.
- No operational `Box3.setFromObject()` path was found.
- The broad truck bounds in the scene runtime are calculated from configured dimensions, not inferred from decorative wall meshes.
- Auto-Pack final state is committed independently from visual animation completion.

## High-risk couplings

### Rendered mesh as picking truth

`getRaycastMeshes()` exposes cargo visual meshes directly. This is already semantically imperfect for cylinders: the rendered cylinder occupies less volume than the authoritative rectangular packing envelope. It will become substantially riskier for:

- bevels
- rounded cases
- inset shells
- GLBs
- pallets with gaps
- furniture or machines
- multi-mesh visual models
- transparent or hidden visual components

Future picking should use a dedicated interaction proxy tied to the authoritative envelope, with the decorative visual below it.

### Duplicated trailer-zone formulas

[trailer-geometry.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/editor/trailer-geometry.js:53>) duplicates usable-zone and blocked-region calculations also owned by PackLibrary. Tests currently reduce immediate risk, but this duplication is a drift hazard for:

- wheel wells
- front overhang/deck
- containment
- snap targets
- camera framing
- measurement
- truck switching

The visual module should eventually consume authoritative zone descriptions instead of independently reproducing them. This should be a dedicated compatibility change, not bundled with visual restyling.

## Visual changes that must not modify operational dimensions

- bevel/rounded edge geometry
- edge-line thickness
- wall opacity or cutaway
- floor thickness
- transparent roof/walls
- door, rail, frame, wheel, or cab visuals
- contact shadow
- label plane offset
- GLB scale and bounding boxes
- selection outline
- hover halo
- invalid-placement overlay
- measurement handles
- snap-guide thickness

A subtle bevel is possible, but it should be a shading/inset visual treatment inside the exact envelope. It must not redefine the interaction proxy, collision box, support surface, or displayed physical dimensions. It must also not create the visual impression of real clearance between physically touching cases.

# F. Cargo Rendering Assessment

## Present implementation

Each cargo instance generally has:

- a geometry from `geometry-factory.js`
- six `MeshStandardMaterial` face groups
- edge lines
- cast and receive shadows
- surface label textures
- metadata containing authoritative half extents
- a single visual mesh used for raycasting

Box geometry follows the exact rendered dimensions. Cylinder geometry uses a radius based on the smaller cross-section while operational geometry remains rectangular.

## Materials and edges

Current roughness/metalness values are appropriately restrained. They are closer to logistics software than a glossy game renderer. The issue is not the use of PBR; it is the visual hierarchy:

- full-face category color is too dominant
- edge color does not encode a consistent hierarchy
- selection/hover/collision modify the same material channels
- status can become ambiguous when cases touch
- face labels do not create a stable front/identity system

Recommended direction:

- neutral or lightly category-tinted matte body
- category color as a controlled band, face accent, edge accent, or label plate
- a consistent dark structural edge
- selection as an outline/silhouette plus modest face treatment
- hover as a lighter, transient outline
- collision as red edge/pattern/overlay, not color alone
- Auto-Pack animation using motion/state overlays without redefining the base material

Do not create physical gaps between boxes to improve readability. Use contrast, edges, contact shading, and selective outlines.

## Visual states

Currently supported:

- hidden
- collision
- selected
- out-of-gauge/staged
- dragging
- hovered
- normal

Current precedence is approximately:

```text
hidden > collision > selected > out-of-gauge > dragged > hover > normal
```

Not independently represented:

- primary versus secondary multi-selection
- rotation-in-progress
- valid drag placement
- locked
- Auto-Pack candidate/result
- filtered
- snap target
- load-sequence/stop emphasis

Selected currently masks out-of-gauge styling. That behavior is test-protected but deserves a product decision because a safety/placement warning may need to remain visible alongside selection.

## Cache correctness

The visual signature currently does not include all values that influence geometry or labels. Shape, changed label content, weight, and potential preference inputs can become stale when the case ID and dimensions remain unchanged. This is a confirmed correctness issue in the visual layer.

# G. Typography / Label Assessment

## Current system

The label path creates CanvasTextures in `createCaseScene()`:

- fixed Arial font
- black text
- label content tied primarily to case name/weight
- simple truncation
- limited face placement
- no devicePixelRatio-aware rasterization
- no wrapping/layout engine
- no explicit mipmap or anisotropy strategy
- no label density modes
- no camera-distance LOD
- no professional background plate
- cache/refcounting, but ambiguous disposal ownership

Six canvas textures may be created per cached signature even though only a subset of faces carry useful content.

## Architectural recommendation

Use one dedicated WebGL label service within the current renderer:

1. CanvasTexture remains the rasterization mechanism.
2. Surface labels remain depth-tested CanvasTexture planes or face materials when physical association matters.
3. Camera-facing measurements, warnings, dimension text, and annotations use Sprite-based labels.
4. Both forms share a layout/cache/resource service.
5. CSS2D should not be the primary architecture for export-critical labels because current screenshots and PDFs capture WebGL only.
6. A specialized text package is not justified yet.

The label cache key should include:

- text content
- semantic label type
- font family/weight/size
- units and formatted value
- plate/background style
- resolution tier and DPR
- color/contrast mode
- orientation/face
- label-density preference

Resources should be refcounted and disposed by one owner only.

## Density strategy

- 1–25 cases: full identity labels where visible.
- Around 100 cases: case number/name plus selected/hover details.
- Around 300 cases: density reduction or distance LOD; always retain selected, warning, and critical stop/sequence labels.

This is a policy recommendation, not a measured threshold.

## Occlusion

- Surface labels should occlude normally with their case.
- Measurement labels should generally depth-test or use deliberate occlusion rules.
- Always-on-top labels should be limited to active interaction/warning cases.
- Two-sided text should not create misleading backwards labels.
- Orthographic views need constant screen-size typography, not world-size-only scaling.

# H. Measurement Tool Architecture Recommendation

The editor does not currently have a measurement subsystem. This is a missing subsystem, but it fits the existing architecture without a renderer rewrite.

## Recommended division

```text
MeasurementController
  owns mode, pointer state, selection, deletion, raycast priority
       |
MeasurementQueryAdapter
  reads canonical case AABBs, usable zones, blocked zones, floor planes
       |
MeasurementModel
  stores canonical references/endpoints in inches
       |
MeasurementPresentation
  renders handles, lines, ticks, extension lines, and Sprite labels
```

## Authoritative measurement model

A measurement endpoint should reference one of:

- a canonical case face/edge/corner
- a trailer usable-zone plane
- a blocked-zone surface
- floor or raised-deck plane
- a free canonical point in inch space

For case-relative measurements, save an instance ID plus face/axis/local coordinate where practical. This lets a measurement update if the case moves.

Decorative GLB vertices or bevel extents should never be the default source of reported dimensions.

## Interaction priorities

While measurement mode is active:

```text
active measurement handle
  > authoritative case/trailer snap proxy
  > cargo gizmo
  > cargo selection
  > camera background
```

Measurement mode should suppress cargo drag when a measuring gesture begins but leave orbit/pan/zoom available where gestures are unambiguous.

## Supported progression

First useful version:

- point-to-point
- X/Y/Z-constrained measurement
- case dimensions
- wall/case and case/case gaps
- trailer interior length/width/height
- clear current measurement
- unit-aware labels
- temporary/session-only measurements

Later:

- multiple selected measurements
- persistent project annotations
- available-space dimensions
- editable endpoints
- touch handles
- export/PDF inclusion
- measurement lists

Persistent measurements must be a product decision. If adopted, they become versioned project data with undo/redo, import/export, deletion, stale-reference behavior, and workspace-switch testing. Temporary measurements should remain session-only.

# I. Snapping Architecture Assessment

## Current behavior

The editor currently provides:

- live grid snapping in X/Z
- configurable grid size, with one inch as the default
- a final nearest-edge/wall snap using a fixed two-inch threshold
- case edge candidates
- usable-zone boundary candidates
- floor/vertical placement through canonical support logic
- final canonical containment/collision validation
- rotation-aware canonical dimensions
- numeric X/Y/Z inspector placement

The vertical path correctly delegates support and blocked-zone rules to PackLibrary.

## Limitations

- All usable-zone boundaries can become wall candidates, including internal seams that are not necessarily physical walls.
- Case-edge snapping lacks strong orthogonal-overlap eligibility and target semantics.
- There is no snap hysteresis or stable priority.
- No center, corner, exact-gap, face, or alignment modes.
- No visual guides or target highlighting.
- No modifier-key temporary disable/enable.
- No touch-specific precision interaction.
- Snap tolerance is physical-distance based, not screen/zoom aware.
- Visual snap results and canonical validation are not represented as a reusable result object.

## Recommended evolution

Introduce a pure authoritative `SnapResolver`, not a new solver:

```text
candidate pose + authoritative zones/AABBs
        |
SnapResolver
        ├─ selected candidate pose
        ├─ target semantic type
        ├─ guide descriptors
        └─ rejection/validation reason
        |
PackLibrary canonical validation
```

It should remain separate from Auto-Pack. It may share canonical dimension/AABB utilities, but should not copy solver rules.

Professional behavior should include:

- target priority and hysteresis
- orthogonal-overlap eligibility
- grid/wall/face/edge/corner/center candidates
- exact configurable gap
- axis constraints
- rotation-aware dimensions
- support/stacking checks
- blocked-region and retention validation
- screen-aware tolerance converted to canonical inches
- modifier override
- clear visual guides

No snap may bypass collision, support, containment, wheel-well, or front-retention rules.

# J. Trailer / Floor / Line Visual Assessment

The current trailer is visually decomposed into:

- floor
- translucent walls
- front/rear cues
- structural rails
- dimension/guide boxes
- wheel/front-bonus-related shapes
- line outlines

The current low-opacity blue shell, green rear, red front, and matte plywood-like floor are reasonable foundations. Rails use box geometry rather than relying on unsupported wide WebGL line widths, which is correct.

## Safe future preferences

These are visual-only if implemented through retained material references:

- trailer line color
- floor color
- surface tint
- wall opacity
- grid visibility/color
- cutaway visibility
- roof visibility
- front/rear cue intensity

The trailer meshes are not currently returned as cargo raycast targets. That makes color/opacity configuration relatively safe. However, replacement geometry must not alter canonical zone calculations or become measurement/snap truth.

## Needed preparation

`setTruck()` currently uses an early signature exit. Live preference changes need a semantic material registry or explicit appearance update method; rebuilding geometry simply to change color is unnecessary and risks coupling.

Trailer construction should identify named semantic components:

- floor
- left/right wall
- bulkhead/front
- rear opening/door guide
- roof
- rails
- blocked-zone visuals
- raised-deck/front-bonus visual
- outline
- measurement/snap proxy

This enables cutaways and export policy without changing physical geometry.

# K. Lighting / Shadow Assessment

## Current quality pipeline

The runtime currently uses:

- WebGLRenderer with antialiasing, alpha, and high-performance preference
- DPR capped at 2
- sRGB output
- ACES tone mapping
- exposure around 1.15
- ambient, directional, hemisphere/fill/rim-style lighting
- PCF shadow mapping
- 2048 directional shadow map
- bias and normalBias
- dynamic shadow-camera fitting
- cargo cast/receive shadows
- a transparent shadow-receiving ground
- automatic shadow disabling after sustained low FPS

This is a solid baseline. KEEP it.

## Preference recommendation

Expose only product-level presets:

**Lighting**

- Standard
- Bright
- High Contrast

**Shadows**

- Off
- Standard
- High

Internally, the preset can control light intensities, exposure, shadow-map size, and perhaps which lights cast. Users should not see tone-mapping or bias controls.

Existing `renderQuality` and `showShadows` preferences must be reconciled first. Do not add overlapping “quality,” “shadow quality,” and “render quality” controls with unclear ownership.

The performance fallback should be session-only and must not overwrite the saved preference.

## Performance qualification

No visual GPU benchmark was performed during this read-only audit. Therefore:

- the low-FPS fallback is evidence that shadows can be costly
- 2048 shadows at DPR 2 are plausible costs
- neither is proven to be the present dominant bottleneck

Measure before lowering quality or introducing InstancedMesh.

# L. Camera / View / Crew View Assessment

## Current state

There is one live PerspectiveCamera:

- FOV 40
- OrbitControls
- damping
- constrained polar angle
- focus tween
- no editor orthographic camera
- no preset controller
- no camera transition cancellation
- no reduced-motion integration
- resize logic assumes the live camera is perspective

PDF generation creates private top/side orthographic cameras. Those cannot simply be reused as the interactive camera family without a controller and resize/picking changes.

## Recommended architecture

Add a camera/view controller within or adjacent to the scene runtime:

- one live perspective camera
- one reusable orthographic camera
- common active-camera getter
- one authoritative framing service based on trailer/cargo extents
- shared OrbitControls target
- preset descriptors rather than separate camera implementations
- transition cancellation
- reduced-motion behavior
- fit trailer/load/selection operations
- resize handling for both projection types

## Preset family

Recommended initial family:

- Free Perspective
- Rear
- Front
- Left
- Right
- Top Orthographic
- Front Orthographic
- Side Orthographic
- Isometric
- Home/Fit Trailer
- Crew/Loader

Perspective top/front/side duplicates should only be added if real workflows justify them.

## Crew/Loader view

Crew view should be a preset on the perspective camera:

- positioned just outside the rear opening
- looking along +X toward the cab
- target centered in the loading aisle
- moderate field of view, likely wider than the standard camera
- rear wall/door visual hidden or opened through a cutaway preset
- near plane chosen to avoid doorway clipping
- camera target kept inside the authoritative trailer centerline

It should not be a new renderer or special gameplay camera.

One rear loading viewpoint is enough initially. Stop-aware or unloading viewpoints can follow after actual sequence workflows are defined.

## Export camera concerns

Current PDF orthographic framing:

- uses base trailer length and may omit front-bonus extents
- does not clearly match render-target aspect ratio to the orthographic frustum
- risks distortion/cropping
- is independent from future editor presets

The future view controller should become the single source for both editor and export framing.

# M. Grid / Spatial Reference Assessment

The current GridHelper is:

- global rather than trailer-local
- centered on the world origin
- on Y = 0
- visually subtle
- approximately 100 inches between major world-grid intervals
- not synchronized with one-inch snapping

This can confuse the distinction between a visual scale reference and the actual snap increment.

Recommended default:

- restrained trailer-local floor grid
- major divisions at a meaningful logistics interval, such as one foot
- minor divisions hidden by default or zoom-adaptive
- optional centerline
- optional rear-origin indicator
- optional X/Y/Z axis aid
- clear front/rear labels or shapes, not color alone
- precision grid mode for orthographic work

Snapping must remain canonical and independent of the grid’s rendered geometry.

# N. Selection / Hover / Drag Visual-State Assessment

The central state resolver is worth preserving, but its semantic vocabulary should grow.

Recommended hierarchy:

```text
visibility/filtered
  > invalid or collision safety overlay
  > operation overlay
  > selection outline
  > hover outline
  > staged/out-of-gauge marker
  > base category/material
```

Safety and selection should be composable rather than mutually replacing the whole material.

Suggested channels:

- Base material: cargo identity/category.
- Structural edge: exact physical silhouette.
- State overlay: collision/invalid/staged.
- Selection outline: selected/primary/secondary.
- Hover outline: transient.
- Label plate: identity/sequence/warnings.
- Motion guide: dragging/rotation/snapping.

This avoids multiple states repeatedly overwriting material color, emissive, opacity, and edge color.

Interaction findings:

- gizmo hit proxies correctly get raycast priority
- cargo picking is throttled
- object drag disables OrbitControls while dragging
- camera remains available during broader operations
- normal picking raycasts actual visual cargo meshes
- there is no pointer-cancel cleanup path
- no explicit touch precision design exists
- keyboard responsibilities are split between the interaction manager and application manager; this is an existing architectural ambiguity, but shortcut consolidation is outside this visual phase

# O. Preferences Architecture Assessment

Existing preference infrastructure is suitable. Use the normalized defaults → PreferencesManager → StateStore/storage flow. Do not create individual localStorage keys.

## Confirmed partially or non-wired preferences

- `renderQuality`
- `showLabels`
- `showShadows`
- `showBevels`
- `labelFontSize`
- `camera.defaultView`

Some appear in defaults or Settings but do not consistently change the renderer. `labelFontSize`, in particular, is currently effectively a no-op for canvas labels.

## Proposed classification

| Preference | Scope |
|---|---|
| Trailer line/surface palette | Global user |
| Floor color | Global user |
| Grid visibility/style | Global user |
| Labels on/off and density | Global user |
| Lighting preset | Global user |
| Shadow mode/quality | Global user |
| Measurement display units | Global user |
| Snapping behavior/guides | Global user |
| Camera transition/reduced motion | Global user |
| Background preference | Global user |
| Current active camera/view | Session-only |
| Temporary cutaway state | Session-only |
| Temporary measurements | Session-only |
| Modifier-based snap override | Session-only |
| Persistent measurements | Project-specific, if approved |
| Saved shared viewpoints | Project-specific, if approved |
| Personal saved viewpoints | Global user, if approved |
| Export annotation inclusion | Project/export-specific policy |

Preference changes currently participate in the broad state/history system alongside pack state. Before adding many live visual preferences, confirm whether ordinary preference edits should consume undo/redo history entries.

Millimeter conversion exists but millimeters are excluded by current preference allowlists. Adding mm requires an explicit normalized preference/UI change, not new geometry conversion logic.

# P. Scene Hierarchy / Resource Lifecycle Assessment

## Current resource strengths

- Cached label resources have refcounting.
- Mesh cleanup traverses child resources.
- renderer and OrbitControls have disposal paths.
- render targets used by export are disposed.
- cargo scene synchronization removes missing instances.
- the axis widget is isolated.

## Risks

1. Shared label maps are released through cache logic and may also be encountered during mesh traversal, making texture ownership ambiguous.
2. Case geometry and materials are largely per-instance.
3. The visual signature can reuse stale resources.
4. Orbit-control and pointer listeners do not have a fully obvious teardown boundary.
5. PMREM environment render-target ownership is not retained for explicit lifetime disposal.
6. There are no WebGL context-loss/restoration handlers.
7. Future helper visibility cannot be controlled by semantic group.
8. Live material preference changes lack retained semantic references.

## Minimal hierarchy evolution

```text
scene
  environmentRoot
  trailerRoot
  cargoRoot
    cargoEntity
      interactionProxy
      visualRoot
      labelRoot
      stateOverlayRoot
  helperRoot
    gizmoRoot
    snapGuideRoot
    measurementRoot
    annotationRoot
  exportOverlayRoot
```

This can be introduced gradually. It does not require moving every function into a new framework.

Each resource should have one explicit owner:

- shared geometry cache
- shared material/style cache
- label texture cache
- per-entity visual resources
- per-runtime environment resources
- per-export render targets

# Q. Performance Assessment

## Current proven behavior

- Auto-Pack avoids placement animation when more than 300 placements are packed.
- Final saved state does not depend on animation completion.
- The renderer can disable shadows after sustained low FPS.
- The development overlay already exposes FPS, frame timing, calls, triangles, geometries, textures, and memory-oriented metrics.

No current GPU-rendering bottleneck was proven during this audit.

## Likely future bottlenecks

- Six face materials plus edge lines can approach roughly seven main-pass draw calls per box before shadow passes.
- At 300 boxes, that structure can approach roughly 2,100 cargo draw calls before trailer, helpers, and shadows.
- Six CanvasTextures per unique case signature can consume substantial GPU memory.
- Worst-case 512×512 RGBA textures are about 1 MiB each before mipmaps; six per unique signature is potentially large.
- Every case generally has unique material instances and geometry.
- All cases cast and receive shadows.
- Raycasting is O(N) over cargo meshes, albeit throttled.
- Hover/selection changes can revisit every cargo visual state.
- Transparent trailer surfaces add sorting/overdraw.
- DPR 2 and 2048 shadows amplify fill cost.

These are structural estimates, not runtime measurements.

## Theoretical concerns

- outline postprocessing
- SSAO
- multiple GLB assets
- dense measurement overlays
- animated camera transitions
- hundreds of active Sprite labels
- InstancedMesh conversion complexity
- CSS2D overlays
- context loss under extreme texture pressure

Do not classify these as bugs before measurement.

## Required benchmark matrix

Measure:

- empty, 1, 25, 100, and 300 cases
- repeated versus unique case definitions
- labels on/off and density levels
- shadows off/standard/high
- light and dark theme
- perspective and orthographic
- hover, selection, drag, rotate, and snap-guide activity
- screenshot and PDF capture time
- high-DPI and lower-end GPU
- camera transitions and cutaway state

Collect:

- median and p95 frame time
- draw calls
- triangles
- geometry/texture counts
- JS heap where available
- input-to-frame latency
- export time
- context-loss events

Do not introduce InstancedMesh until these measurements demonstrate need and the selection/material/GLB implications are understood.

# R. Screenshot / PDF Compatibility Assessment

`renderCameraToDataUrl()` is a useful shared foundation:

- one renderer and scene
- explicit render target
- DPR 1 for deterministic dimensions
- state restoration
- target disposal
- vertical buffer correction

KEEP that pattern.

## Current compatibility risks

1. It captures the live scene. Direct scene children such as gizmos, CoG, selection state, collision state, or future measurements can appear unintentionally.
2. Only the grid has an explicit export-hide path.
3. CSS2D labels would not be captured.
4. Current perspective exports depend on the user’s camera pose.
5. Current background/theme colors carry into export; there is no neutral print presentation.
6. Transparent walls and shadows can look different against light PDF surfaces.
7. Private orthographic camera aspect/framing may distort or crop.
8. Front-bonus/deck extents are not clearly included in the PDF framing computation.
9. Screenshot/PDF functions do not all enforce the operation lifecycle internally, even if their UI buttons are guarded.
10. Persisted thumbnails capture current preferences and camera state, making visual results inconsistent across saves.

## Recommendation

Add an export presentation mode:

- semantic inclusion/exclusion policy
- deterministic camera preset
- neutral or configured background
- explicit selection/warning policy
- explicit annotation/measurement inclusion
- stable lighting/shadows
- temporary cutaway state
- full state restoration in `finally`

WebGL CanvasTextures and Sprites are the safest shared typography technology for editor and export parity.

# S. GLB Future-Readiness Assessment

The product direction is correct:

```text
authoritative envelope != optional visual model
```

The current data and packing layers are largely ready. The visual entity structure is only partially ready because picking still depends on the visual mesh.

Recommended future cargo entity:

```text
cargoEntity
  authoritative interaction proxy
  visual model
    technical box fallback
    optional GLB
  labels
  selection/collision overlays
```

Rules for the GLB spike:

- units and scale are presentation metadata
- GLB bounds do not redefine case dimensions
- GLB origin/pivot corrections are visual transforms
- collision remains the canonical AABB/envelope
- Auto-Pack never traverses GLB geometry
- picking defaults to the proxy, not arbitrary GLB children
- screenshots/PDF use the same model/fallback policy
- missing/failed GLBs retain technical-box fallback
- performance is measured at 1/25/100/300
- asset materials cannot silently overwrite semantic collision/selection styling
- disposal accounts for shared geometry, textures, and materials

# T. Feature Readiness Matrix

| Feature | Status | Owner/dependencies |
|---|---|---|
| Professional cargo materials | PARTIAL / NEEDS PREPARATION | `editor-screen.js`; central style/state tokens |
| Cargo edges | ALREADY IMPLEMENTED | `editor-screen.js`; professional refinement is safe |
| Cargo labels | ALREADY IMPLEMENTED, BASIC | `editor-screen.js`; cache/signature/disposal need work |
| Canvas typography | PARTIAL / NEEDS PREPARATION | Dedicated label service, DPR/LOD/export policy |
| Selection styling | ALREADY IMPLEMENTED, BASIC | `resolveCaseVisualState()` |
| Hover styling | ALREADY IMPLEMENTED, BASIC | Interaction manager and state resolver |
| Collision styling | ALREADY IMPLEMENTED, BASIC | Canonical validation plus state resolver |
| Contact cues | PARTIAL / NEEDS PREPARATION | Edges, shadows, materials; no fake gaps |
| Trailer visual redesign | READY WITH CURRENT ARCHITECTURE | `scene-runtime.js`; keep canonical zones independent |
| Trailer line-color preference | PARTIAL / NEEDS PREPARATION | Semantic trailer material registry |
| Floor-color preference | PARTIAL / NEEDS PREPARATION | Retained floor material reference |
| Lighting improvements | READY WITH CURRENT ARCHITECTURE | `scene-runtime.js` |
| Shadow controls | PARTIAL / NEEDS PREPARATION | Existing prefs plus runtime wiring |
| Grid improvements | PARTIAL / NEEDS PREPARATION | Trailer-local grid and unit policy |
| Measurement tool | ARCHITECTURAL GAP | New controller/model/query/presentation subsystem |
| Box snapping improvements | PARTIAL / NEEDS PREPARATION | Existing drag + canonical PackLibrary validation |
| Snap guides | PARTIAL / NEEDS PREPARATION | SnapResolver result and helper layer missing |
| Camera preset expansion | PARTIAL / NEEDS PREPARATION | Live camera/view controller |
| Orthographic views | PARTIAL / NEEDS PREPARATION | Export-only cameras already exist |
| Isometric view | READY WITH CURRENT ARCHITECTURE | Camera preset/controller |
| Crew/Loader view | READY WITH CURRENT ARCHITECTURE | Perspective preset plus rear cutaway |
| Cutaway/section view | PARTIAL / NEEDS PREPARATION | Named trailer components and visibility policy |
| Saved viewpoints | DEFER | Persistence/sharing decisions needed |
| Screenshot compatibility | PARTIAL / NEEDS PREPARATION | Capture works; presentation policy missing |
| PDF visualization compatibility | PARTIAL / NEEDS PREPARATION | Shared capture exists; framing/aspect risks |
| GLB visual-model readiness | PARTIAL / NEEDS PREPARATION | Entity visual root and pick proxy missing |
| Performance readiness | PARTIAL / NEEDS PREPARATION | Metrics/fallback exist; scenario baseline absent |
| Locked-state visuals | DEFER | No clear current cargo-lock contract |
| Auto-Pack result styling | READY WITH CURRENT ARCHITECTURE | Must not delay final state commitment |
| Real heatmap compatibility | PARTIAL / NEEDS PREPARATION | Needs its own overlay channel, not base material overwrite |
| Responsive/touch precision | PARTIAL / NEEDS PREPARATION | Pointer cancellation, hit sizes, gesture policy |

# U. Regression Risk Matrix

| High-risk recommendation | Affected subsystem | Why risk exists | Required mitigation |
|---|---|---|---|
| Add authoritative pick proxies | Raycasting, selection, drag, GLB | Current visual mesh is the hit target | Preserve IDs/transforms; test box/cylinder/hidden/rotated selection parity |
| Bevel or rounded cargo visuals | Collision, support, contact, picking | Rendered silhouette could be mistaken for clearance | Keep exact canonical proxy and AABB; inset decorative geometry only |
| Centralize visual-state channels | Selection, collision, OOG, Auto-Pack | Current precedence is test-protected | Add state-combination tests before changing precedence |
| Refine trailer visuals | Zones, snapping, truck switch, camera fit | Trailer formulas are duplicated | Never derive operational zones from new meshes; parity-test every truck type |
| Add trailer color/opacity preferences | Picking, exports, theme, persistence | Materials are created inside `setTruck()` and cached by truck signature | Retain named materials and update appearance without rebuilding geometry |
| Introduce camera controller | Picking, resize, OrbitControls, screenshots, PDFs | Current runtime assumes one perspective camera | Central active-camera API; projection-specific resize and raycasting tests |
| Replace/expand labels | Memory, disposal, export, DPI | Shared texture ownership is ambiguous | One cache owner, complete signature, refcount/disposal tests |
| Add lighting/shadow presets | Performance, theme, exports | Current fallback mutates runtime shadow state | Separate saved intent from effective session state; benchmark all tiers |
| Add SnapResolver | Collision, support, orientation, drag | Snap can move a valid pose into an invalid one | PackLibrary remains final validator; test rotated/stacked/well/deck cases |
| Add measurement persistence | Undo/redo, imports, workspace switch | Persistent references can become stale | Start session-only; version schema before project persistence |
| Add export presentation mode | PDF, preview, screenshots, operation lifecycle | Live scene state currently leaks into capture | Semantic visibility groups and full try/finally restoration |
| Add semantic scene roots | Removal, disposal, screen navigation | Existing code adds some objects directly to the scene | Migrate incrementally; assert no duplicate objects/listeners/resources |
| Add cutaways | Picking, measurements, exports | Hidden walls may still be hit or measured | Separate visual visibility from analytic wall planes and pick layers |
| Add GLB models | Collision, picking, memory, orientation | GLB bounds/pivots differ from canonical case | Proxy/envelope is authoritative; technical-box fallback; asset lifecycle tests |
| Add professional category palette | Case identity, accessibility, imports | Users may depend on category color recognition | Preserve category metadata; combine color with text/shape cues |
| Change grid/reference system | Snapping, origin interpretation | Users may assume visible grid equals snap spacing | Label increments; keep snap calculation independent and canonical |
| Add touch measurement/snapping | Drag, orbit, selection | Gesture ownership is currently ambiguous | Pointer capture/cancel handling, movement threshold, explicit active tool |

# V. Recommended Visual Foundation Architecture

## Keep exactly as-is in principle

- direct Three.js/WebGLRenderer
- current Three.js version during this phase
- Vite-based application architecture
- scene-runtime/editor-screen separation
- canonical inch-space geometry
- `INCH_TO_WORLD`
- PackLibrary and packing-core as operational truth
- wheel-well/front-bonus contracts
- OperationLifecycle tokens
- final Auto-Pack state independent of animation
- StateStore and normalized persistence
- technical box fallback
- camera orbit/pan/zoom availability during operations
- shared WebGL export renderer pattern
- measured optimization rather than speculative InstancedMesh conversion

## Evolve incrementally

1. Semantic scene roots and export layers.
2. Cargo entity boundary: authoritative proxy versus decorative visual.
3. Central visual-state descriptor with composable channels.
4. Resource-safe label/material caches.
5. One in-canvas typography service.
6. Named trailer component/material registry.
7. Camera/view controller with perspective and orthographic projections.
8. Pure authoritative SnapResolver with guide output.
9. Measurement controller/query/presentation subsystem.
10. Export presentation mode.
11. Simple normalized visual preferences.
12. Scenario-based performance acceptance gates.

The heatmap should eventually be its own visualization overlay/channel. It should not rewrite the same base cargo materials used for selection, collision, and category identity.

# W. Recommended Implementation Sequence

## Pass 0 — Lock the acceptance baseline

- Correct the Vite installation drift separately.
- Define the 1/25/100/300 visual fixtures without production data.
- Record current draw calls, textures, frame timing, and export results.
- Establish manual screenshots for empty, light, dense, and stacked loads.

## Pass 1 — Cargo visual resource contract

- Correct visual cache/signature dependencies.
- Make texture/material ownership unambiguous.
- Wire existing label visibility/font preferences.
- Preserve exact geometry, transforms, picking, and state precedence.

## Pass 2 — Cargo professional visual language

- Introduce restrained material tokens.
- Separate base category identity from selection/collision overlays.
- Refine structural edges.
- Add valid/invalid drag feedback without changing placement rules.
- Verify tightly touching and stacked loads.

## Pass 3 — Typography foundation

- Add the shared CanvasTexture/Sprite label service.
- Introduce plate, wrapping, scaling, DPR, LOD, and density policy.
- Preserve WebGL export compatibility.
- Measure texture memory at 25/100/300.

## Pass 4 — Semantic trailer and spatial-reference visuals

- Retain named trailer materials/components.
- Improve floor, walls, outlines, cutaway support, and front/rear cues.
- Replace the global engineering-style grid with a restrained trailer-local reference system.
- Keep PackLibrary zones authoritative.

## Pass 5 — Lighting, shadows, and contact cues

- Wire simple lighting/shadow presets.
- Refine floor/contact shadows and depth.
- Validate dark/light themes and lower-end GPUs.
- Defer SSAO/postprocessing unless measurement shows sufficient headroom.

## Pass 6 — Camera/view foundation

- Add active-camera abstraction.
- Implement Home/Fit, directional, orthographic, isometric, and Crew presets.
- Add transition cancellation and reduced-motion behavior.
- Validate picking, gizmo sizing, labels, grid, cutaways, and resize in each projection.

## Pass 7 — Export parity

- Make camera framing shared between editor and PDF.
- Add semantic export presentation mode.
- Fix orthographic aspect/front-bonus framing.
- Define inclusion policy for labels, selection, measurements, CoG, grid, and shadows.

## Pass 8 — Precision overlay infrastructure

- Add helper/picking layers used by snap guides and measurements.
- Introduce SnapResolver result descriptors.
- Implement measurement mode only after interaction priority is explicit.
- Start measurements as session-only.

Each pass should repeat the relevant geometry tests and a focused 1/25/100/300 visual/performance check. Do not wait until the end to evaluate export parity.

# X. First Implementation Pass Recommendation

The first implementation task should be:

**Make CaseScene’s existing cargo visual resources correct and preference-aware without changing geometry or interaction semantics.**

Scope:

- complete the visual resource signature so shape, label content, weight, and relevant preferences cannot become stale
- establish one clear owner for cached CanvasTextures
- wire the existing `showLabels` and `labelFontSize` preferences
- preserve current case dimensions, placement, rotation, mesh hit target, colors, and visual-state precedence
- add focused tests for cache invalidation, preference updates, and disposal

Likely files:

- [src/screens/editor-screen.js](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/src/screens/editor-screen.js:703>)
- [tests/audit/manual-vertical-placement.spec.mjs](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/tests/audit/manual-vertical-placement.spec.mjs>)
- [tests/audit/security-and-invariants.spec.mjs](</Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D/tests/audit/security-and-invariants.spec.mjs>)

Avoid:

- `geometry-factory.js`
- `pack-library.js`
- `packing-core/*`
- `autopack-engine.js`
- `autopack-solver.js`
- `trailer-geometry.js`
- `operation-lifecycle.js`
- persisted pack schema
- screenshot/PDF behavior
- dependencies
- broad scene hierarchy refactoring

This pass removes a confirmed visual correctness/resource risk before professional styling builds on top of it.

# Y. Decisions Needed From Product Owner

1. Should category color remain the full cargo body color, or become a restrained accent?
2. What is the primary label hierarchy: case name, number, stop, dimensions, weight, or a configurable combination?
3. At dense loads, which labels must always remain visible?
4. Should collision/out-of-gauge remain visibly active while an object is selected?
5. Should the default grid be off, a one-foot major grid, or another logistics increment?
6. Should `renderQuality` become the umbrella visual preset, or be replaced by separate Lighting and Shadows controls?
7. Should Isometric be orthographic, perspective, or offer both?
8. What should “Front” and “Rear” view names mean: camera location or direction being viewed?
9. Should the first Crew view represent loading from the rear, unloading toward the rear, or both?
10. Are persistent measurements required, or are session-only measurements sufficient initially?
11. Should measurements and annotations appear in screenshots/PDF by default?
12. Are saved viewpoints personal preferences or shared project data?
13. Should normal screenshots represent the current editor exactly, while PDF uses a clean presentation mode?
14. Should millimeters become a selectable display unit?
15. Is a subtle inset bevel acceptable if the exact envelope remains visibly legible?
16. Are trailer/floor colors personal preferences or properties of a shared load plan?

# Z. Final “Do Not Break” Checklist

- Keep canonical dimensions and placement in inches.
- Keep X length, Y height, Z width.
- Keep X = 0 at the rear loading opening.
- Never derive collision or measurements from decorative meshes.
- Never let bevels, labels, edges, GLBs, doors, rails, or shadows change the envelope.
- Keep PackLibrary and packing-core as validation truth.
- Preserve wheel-well, deck, overhang, support, and retention rules.
- Preserve rotation-aware effective dimensions.
- Preserve final Auto-Pack state independently from animation.
- Preserve stale-operation token protection.
- Keep all mutation paths guarded while operations are busy.
- Keep camera orbit/pan/zoom available unless a proven conflict requires otherwise.
- Keep pending versus committed truck behavior.
- Keep saved packs and imports independent from Three.js object structure.
- Keep selection/picking IDs stable.
- Validate every snapped pose canonically.
- Treat the visible grid as a reference, not physical truth.
- Use authoritative interaction proxies for future decorative models.
- Keep temporary visual preferences out of project data.
- Version any persistent measurement or viewpoint schema.
- Hide editor-only helpers through semantic export policy.
- Restore renderer, camera, visibility, grid, and material state after export.
- Keep WebGL-captured typography for PDF-critical labels.
- Test light/dark theme and non-color status cues.
- Measure 1/25/100/300 before introducing instancing or postprocessing.
- Run geometry, operation, import/export, screenshot/PDF, disposal, and focused manual visual checks after every pass.

No files were modified, created, committed, or pushed.

<oai-mem-citation>
<citation_entries>
MEMORY.md:57-62|note=[authoritative geometry and utilization architecture history]
rollout_summaries/2026-08-06T15-12-49-Z76X-generic_space_utilization_engine_v1.md:21-36|note=[prior geometry seams and validation evidence]
</citation_entries>
<rollout_ids>
019fd7a2-5c72-7541-a769-c0fdbf1b8d63
</rollout_ids>
</oai-mem-citation>
