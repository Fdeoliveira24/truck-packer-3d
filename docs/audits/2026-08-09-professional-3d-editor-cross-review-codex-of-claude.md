# Truck Packer 3D
# Codex Cross-Review of Claude Professional 3D Editor Audit

## 1. Review Baseline

This is a peer review, not a replacement audit and not an implementation plan. It compares the two preserved audits, tests their consequential claims against the current repository, and recommends a sequencing direction for later reconciliation.

Repository state at review time:

| Item | Verified value |
|---|---|
| Repository root | `/Users/franciscooliveira/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D` |
| Branch | `main` |
| HEAD | `a129c0aa1213dad4de3c8a4482b5aed7a388dd1b` |
| Initial status | `## main...origin/main`, plus the two untracked preserved audit documents |
| Claude audit | `docs/audits/2026-08-09-professional-3d-editor-master-audit-claude.md`, read completely |
| Codex audit | `docs/audits/2026-08-09-professional-3d-editor-master-audit-codex.md`, read completely |

Both original audits existed, so the stop condition did not apply. Neither original audit was modified.

Review authority and method:

1. Current source and tests were treated as implementation truth.
2. `docs/product/TP3D-MASTER-TODO-V6.md` was used for the current phase boundary and approved order.
3. The repository `AGENTS.md` and supplied agent instructions governed scope.
4. Graphify was used selectively for ownership and call relationships; the graph was not loaded wholesale or rebuilt.
5. Historical memory was used only to preserve the context of the original Codex audit, not to override current source.
6. Existing tests were inspected where they characterize geometry, state precedence, trailer rails, and export structure. The test suite was not rerun because this is a documentation-only change.

The V6 roadmap currently places Professional 3D Editor Visual Foundation first, Camera/View System second, heatmap third, PDF/Image Visualization fourth, and the small GLB spike fifth. It also preserves direct Three.js/WebGLRenderer and the authoritative-envelope-versus-optional-model separation.

## 2. Overall Assessment of Claude Audit

Claude's audit is a strong, focused architectural review. It is especially useful where it identifies already-good visual work that should be kept: the exterior mesh rails, trimmed front-overhang seam, restrained default grid, existing shadow/light foundation, deterministic case-state resolver, and the roadmap boundary around interactive camera views.

Its primary weakness is confidence calibration. Several findings described as settled are only partially true:

- trailer-zone ownership is duplicated and operationally split, not cleanly centralized;
- the texture lifecycle is not “solid” because shared maps are disposed outside the cache owner;
- Sprite and CSS2D are not interchangeable label replacements;
- current snapping is useful but lacks the target semantics needed for CAD-quality guides;
- export capture exists, but export presentation policy does not;
- GLB support cannot simply slot into a geometry factory that returns `BufferGeometry`;
- visual work is not an entirely UI-only regression surface because live drag, picking, zone containment, and final placement share the same editor modules.

Claude's typography-first recommendation also begins one dependency too late. The existing cache identity and texture ownership contract should be corrected before changing the label representation. That correction should remain a separate, appearance-preserving pass so a label rewrite does not conceal resource regressions.

Overall verdict on the audit itself: high value, but not safe to adopt verbatim as the sole implementation sequence.

## 3. Confirmed Agreement

The following Claude findings were confirmed against current source/tests. These are the 18 confirmed items referenced in the terminal summary.

| ID | Confirmed finding | Current evidence |
|---|---|---|
| C-01 | Keep direct Three.js and the `scene-runtime` / `editor-screen` separation. | `src/editor/scene-runtime.js` owns renderer/scene/camera/trailer; `src/screens/editor-screen.js` owns cases and editor interactions. V6 explicitly rejects a renderer/framework rewrite. |
| C-02 | Operational case bounds are metadata-driven rather than derived from `Box3` over decorative meshes. | `CaseScene.getAabbWorld()` uses `group.userData.halfWorld`; transforms refresh it from authoritative oriented dimensions. |
| C-03 | `resolveCaseVisualState()` is a real centralized precedence seam. | `src/screens/editor-screen.js:94-131`; tests in `tests/audit/manual-vertical-placement.spec.mjs:113-206` verify precedence and repeated restore behavior. |
| C-04 | Current labels are baked into six per-face `CanvasTexture` objects. | `generateCaseTexture()` and `acquireTextures()` at `src/screens/editor-screen.js:725-797`. |
| C-05 | Label rasterization is not device-pixel-ratio aware and uses hard-coded Arial sizing. | Canvas size derives from case inches times four, clamped to 64-512; font strings are hard-coded in `generateCaseTexture()`. |
| C-06 | The `PreferencesManager` injection into scene runtime is unused. | `_PreferencesManager` is captured by `createSceneManager()`, but scene runtime does not use it. |
| C-07 | Several normalized visual preferences are currently no-ops. | `renderQuality`, `showLabels`, `showShadows`, `showBevels`, `labelFontSize`, and `camera.defaultView` exist in defaults/normalization but are not applied to the live renderer; `hiddenCaseOpacity` is applied. |
| C-08 | A case-filter persistence path bypasses the preference system. | Editor filtering uses a direct local-storage key rather than a declared global/project/session preference model. |
| C-09 | Grid snapping exists during live drag. | `editor-screen.js:3015-3021` reads normalized snapping preferences and rounds the active position. |
| C-10 | A final edge/wall snap is attempted and then validated before commit. | `editor-screen.js:3140-3180`; authoritative placement validation still follows the visual snap candidate. |
| C-11 | Exterior trailer rails are mesh geometry, not line-only decoration. | `addRailEdge()`/`addBoxRails()` and `truckOuterRails` in `scene-runtime.js`; G1.1C tests characterize ownership and open-seam behavior. |
| C-12 | The renderer already has a viable professional lighting/shadow base. | WebGLRenderer antialiasing, color-space/tone configuration, environment map, hemisphere/directional lights, PCF shadows, and cast/receive flags are present. |
| C-13 | A low-FPS shadow fallback exists. | Scene runtime tracks low frame rate and can disable shadow maps at runtime. |
| C-14 | The interactive editor has no camera-preset/orthographic system. | One perspective camera plus OrbitControls and `focusOnWorldPoint()` are exposed; orthographic cameras exist only inside PDF export. |
| C-15 | Main-scene organization is largely flat outside the nested trailer group. | Case roots, gizmo, CoG, grid, and other helpers are added directly to the scene in different owner modules. |
| C-16 | Important visual invariants rely heavily on source-characterization tests. | G1.1B/G1.1C tests match source blocks and regular expressions for rails, seams, materials, and helper ownership. |
| C-17 | Screenshot, thumbnail, and PDF imagery share the WebGL render-target capture path. | `capturePackPreview()`, `captureScreenshot()`, and `generatePDF()` all call `renderCameraToDataUrl()` in `src/app.js`. |
| C-18 | Instancing, postprocessing, and bevel complexity should not be introduced without measurement. | No current measurement proves they are required; source shows more immediate cache, texture, raycast, and shadow costs. |

## 4. Claude Findings Codex Missed

Claude added useful specificity in the following areas:

1. **Trailer rail implementation deserves an explicit KEEP.** Claude correctly recognized that the mesh-based exterior rails, open-seam omission, and `trimSeamEdges()` solve concrete depth/readability problems without changing the packing envelope. Codex discussed trailer styling but did not give this existing implementation enough credit.

2. **Unused `PreferencesManager` injection is a precise ownership smell.** Codex identified partial preference wiring but did not isolate the unused dependency in `createSceneManager()`.

3. **The hidden Settings shadow controls are relevant product evidence.** `showShadowControls = false` demonstrates that the repository already withheld unfinished controls rather than exposing technical knobs. This supports a small preset model.

4. **Direct local-storage case-filter state is a concrete counterexample.** Claude's callout provides a useful “do not copy this pattern” example for future visual preferences.

5. **`bumpScale` has no effect without a bump map.** This is a small but valid rendering observation: it should be removed or remain inert rather than be treated as current surface detail.

6. **Current visual tests are often structural rather than rendered.** Claude was right to distinguish source-regex protection from actual visual output assurance.

7. **The current scene foundation is already credible.** Claude better resisted the temptation to equate “professional” with replacing the renderer, lighting model, or rail construction wholesale.

These strengths should be retained in the final reconciliation.

## 5. Codex Findings Claude Missed

Codex's original audit remains stronger on several operational and resource boundaries:

1. **Incomplete cargo cache identity.** `buildSignature()` includes case id, dimensions, and resolved color only. It excludes label content and presentation inputs such as name, weight, `canFlip`, pallet status, pallet warning limit, label visibility, font size, and any future visual-model identity.

2. **Texture disposal ownership.** `releaseTextures(signature)` is intended to own ref-counted texture disposal, but `disposeGroup()` also traverses each material and calls `m.map.dispose()`. A texture shared by several instances can therefore be disposed when one instance is removed while the cache still holds it.

3. **Rendered-mesh picking is a geometry coupling.** `getRaycastMeshes()` returns the actual cargo mesh, and raycasting is non-recursive. A cylinder already has a visible footprint smaller than its rectangular authoritative envelope; a future multi-mesh GLB would be an even larger mismatch.

4. **Trailer usable-zone formulas are duplicated.** `src/editor/trailer-geometry.js` and `src/services/pack-library.js` calculate their own versions of rect, wheel-well, and front-bonus zones.

5. **Live-scene capture lacks an export presentation layer.** Only the grid has a temporary hide option. Selection, CoG, gizmos, future snap guides, measurements, and heatmap objects need explicit include/exclude policy.

6. **PDF orthographic framing is ad hoc.** `buildOrthoCameras()` uses base trailer length, does not include front-bonus extent, and does not adjust orthographic frustum to output-target aspect.

7. **Preferences participate in undo history.** The StateStore history slice includes preferences. A high-frequency visual control could therefore pollute undo/redo unless the storage/history contract is intentionally separated.

8. **The grid is restrained visually but weak semantically.** Its world spacing is not an inch/foot precision reference, so it should not be presented as a measurement grid.

9. **Snap candidates lack semantic metadata.** `snapToNearest()` returns only position coordinates. It cannot explain target type, axis, source/target face, gap, tolerance, or guide visibility.

10. **GLB needs an entity/pick boundary.** An optional model cannot safely replace the current mesh without a technical-envelope/pick-proxy and resource-lifecycle design.

## 6. Disagreements

### Trailer-zone ownership

Claude position:

`TrailerGeometry` cleanly owns authoritative usable/blocked zones and current visual geometry is safely separated.

Codex original position:

`PackLibrary` is canonical, while `TrailerGeometry` duplicates zone formulas in a visual/editor module and creates drift risk.

Current evidence:

`PackLibrary.getTrailerUsableZones()` and blocked-zone functions are used by packing, warnings, and validation. However, live editor containment calls `TrailerGeometry.getTrailerUsableZones()` at `editor-screen.js:1331-1339`; surface following and wall snapping also consume `TrailerGeometry` zone output. The live editor therefore treats the duplicate as operational, not merely visual.

Cross-review verdict:

Neither audit stated the full current ownership. Claude is incorrect that ownership is clean. Codex correctly identified duplication but understated the editor copy's operational role.

Recommended approach:

Keep current behavior during Visual Foundation. Add parity characterization before precision-tool work. In a dedicated geometry-safety pass, make `PackLibrary`/packing-core the inch-space zone authority and let the editor adapter convert authoritative zone descriptors into world units. Do not mix that consolidation into material, label, or trailer styling work.

### First implementation pass

Claude position:

Replace or rework baked labels early with Sprite or CSS2D.

Codex original position:

Correct CaseScene cache identity, CanvasTexture ownership, preference behavior, disposal, and tests first.

Current evidence:

The texture cache key is incomplete, and `disposeGroup()` can dispose a shared map outside the ref-count owner. A representation change would alter the very lifecycle currently lacking characterization.

Cross-review verdict:

Codex's prerequisite remains better supported. Claude's typography pass should follow immediately, not be merged into the same atomic change.

Recommended approach:

Pass 1 preserves current appearance while fixing cache/disposal contracts and adding tests. Pass 2 or 3 changes label architecture. Do not wire dormant label preferences in Pass 1 unless doing so is necessary to characterize the new cache key; visible preference behavior belongs with typography.

### Sprite versus CSS2D

Claude position:

Use a Sprite-based label, or CSS2D if screen-space independence is preferred.

Codex original position:

Keep WebGL `CanvasTexture` for surface-bound case labels; use Sprite for camera-facing annotations; do not use CSS2D as the primary exportable label path.

Current evidence:

`renderCameraToDataUrl()` renders only the WebGL scene into a render target. CSS2D is a separate DOM renderer and would not appear in screenshots, thumbnails, or PDF views without a separate composition system. Sprite appears in WebGL output but is camera-facing and needs explicit depth, occlusion, scaling, and orthographic behavior. Surface texture/plane labels rotate and occlude with the case.

Cross-review verdict:

Codex is better supported, but the existing six full-face textures should not be kept as the final implementation.

Recommended approach:

Use a shared canvas text-layout/raster/cache service. Render case identity on one or two surface-bound planes/material regions. Use Sprite for transient camera-facing annotations and measurement values. Reserve CSS2D for deliberately editor-only DOM UI that is intentionally absent from WebGL export.

### Measurement ownership

Claude position:

Measurement can share annotation infrastructure and perhaps live inside `InteractionManager`, reusing `getAabbWorld()` and `snapToNearest()`.

Codex original position:

Create a separate measurement controller/model and authoritative geometry-query boundary; integrate with editor input without expanding `editor-screen.js` into the measurement subsystem.

Current evidence:

`InteractionManager` is already a large closure with drag, rotate, nudge, delete, keyboard, and selection responsibilities. `snapToNearest()` is X/Z placement-specific and returns no target metadata. `getAabbWorld()` is useful for current case envelopes but remains owned by CaseScene and expressed in world units.

Cross-review verdict:

Claude is right about shared annotation rendering, but not about placing the feature inside `InteractionManager` or treating the current snap function as a measurement primitive.

Recommended approach:

Prepare only a shared annotation renderer and an inch-space authoritative feature-query interface now. Later add a small measurement controller that receives tool-owned pointer events from the editor interaction broker. Start session-only; persistence and undo remain product decisions.

### Snapping readiness

Claude position:

The current snap system is already CAD-like enough that visual guides are mostly additive.

Codex original position:

Current snapping is useful but needs a richer result/target contract before professional guides, gaps, alignments, and rotation-aware behavior.

Current evidence:

There is live grid snap, final wall/case-edge snap, collision validation, and surface following. But `snapToNearest()` is X/Z only, uses a fixed two-inch threshold, emits only `{x,z}`, does not represent target face/corner/axis, and builds wall candidates from every usable-zone boundary, including internal seams that may not be physical walls.

Cross-review verdict:

Codex is better supported. Claude overstates readiness.

Recommended approach:

Preserve the current solver. Before adding guides, extend the candidate/result data contract so rendering receives semantic snap information without re-solving geometry. Treat guide rendering as additive only after that contract exists.

### Preference ownership and shadow persistence

Claude position:

Editor rendering directly rereads StateStore, and the existing `s` shortcut should be persisted through PreferencesManager.

Codex original position:

Use normalized defaults, PreferencesManager, StateStore/storage, and a central live-application seam; avoid scattered reads and keys.

Current evidence:

CaseScene calls `PreferencesManager.get()`, not StateStore directly. `src/app.js` already observes preference changes and refreshes theme/settings/editor UI. Scene runtime's injected PreferencesManager is unused. Low-FPS fallback can disable shadows independently of saved intent. Preferences are also in undo history.

Cross-review verdict:

Claude's StateStore claim is incorrect, and automatically persisting the shortcut would conflate session control with saved preference.

Recommended approach:

Keep PreferencesManager UI-free. Let the existing app-level preference subscriber pass a normalized snapshot to explicit `SceneManager.applyVisualPreferences()` and `CaseScene.applyVisualPreferences()` APIs. Represent persisted `requestedShadows` separately from runtime `effectiveShadows` if the FPS fallback remains. Decide whether the shortcut changes session state or saved preference before wiring it.

### Semantic scene groups as the first pass

Claude position:

Add `cargoGroup`, `helpersGroup`, and `annotationsGroup` before visible work.

Codex original position:

Semantic roots are useful for lifecycle and export filtering and should be introduced early.

Current evidence:

The flat scene causes real filtering and cleanup problems. But reparenting cargo changes parent-space assumptions, scene removal paths, traversal, and any code using direct scene lookup. A group without an export inclusion contract does not itself solve capture leakage.

Cross-review verdict:

Both audits were too eager to make all three roots a prerequisite.

Recommended approach:

Introduce groups just in time with a named consumer and tests: a cargo entity root when cargo representation/picking changes; an annotation root with the text/annotation service; editor-only/exportable roots when export filtering is implemented. Do not perform a broad no-visible-change reparenting pass solely for architectural neatness.

### Export/PDF readiness

Claude position:

Screenshot and PDF compatibility are effectively ready because the shared render-target path exists, with an include/exclude decision needed for new helpers.

Codex original position:

Capture is available but presentation ownership is partial; live-scene helper leakage and orthographic framing are active risks.

Current evidence:

`renderCameraToDataUrl()` hides only `grid`. It renders the live scene and restores renderer state. PDF top/side cameras use base trailer length and a physical frustum that is not reconciled with fixed output aspect. CSS2D would not be rendered. The separate axis-widget render is absent from capture while main-scene helpers can be present.

Cross-review verdict:

Codex is better supported. The capture mechanism is ready; export visualization compatibility is only partial.

Recommended approach:

Define an export presentation policy and object classification before claiming readiness. Preserve WebGL-only labels for exportable text, explicitly frame total authoritative trailer extent, and validate orthographic aspect.

### GLB readiness

Claude position:

The architecture is already ready and future GLBs can slot into the geometry factory with no architectural change.

Codex original position:

The authoritative envelope separation is conceptually ready, but visual entity roots, proxy picking, asynchronous loading/fallback, state overlays, and disposal need preparation.

Current evidence:

`src/editor/geometry-factory.js` returns a `BufferGeometry`. CaseScene creates one mesh and raycasting uses that mesh with `recursive=false`. A GLB commonly produces an asynchronous multi-mesh `Object3D`, not a substitute BufferGeometry. Current visual state mutates the technical mesh's materials.

Cross-review verdict:

Codex is better supported. The product invariant is ready; the visual asset plumbing is not.

Recommended approach:

Keep technical-envelope metadata and fallback box. Before the GLB spike, add a visual-entity root with optional model child, stable envelope/pick proxy, label anchors, state overlay contract, and scoped resource disposal. Do not make the decorative model the authoritative or default pick shape.

### Regression surface

Claude position:

The proposed visual regression surface is entirely UI/rendering with no packing coupling.

Codex original position:

Visual work crosses picking, CaseScene transforms, live containment, snapping, export, preferences, and disposal; several recommendations are high risk despite being visually motivated.

Current evidence:

Case creation, operational AABB metadata, rendered mesh picking, live drag containment, snapping, and material state all coexist in `editor-screen.js`. Trailer zones used during drag are duplicated in an editor geometry module. Export renders the live scene.

Cross-review verdict:

Claude's statement is rejected. Packing algorithms need not change, but the regression surface is not UI-only.

Recommended approach:

Mark cargo entity/picking, cache lifecycle, zone delegation, snap results, camera replacement, and export filtering as high-risk seams. Keep material constants and trailer colors lower risk only when geometry and raycast targets are unchanged.

### Camera dependency and Crew View timing

Claude position:

Camera/View System correctly follows Visual Foundation; Crew View is further deferred. Camera views are gated in part by typography.

Codex original position:

Camera presets, orthographic views, isometric view, and Crew View were grouped into the next camera pass.

Current evidence:

V6 places camera views second and identifies Crew/Loader as future within that area. Basic camera controllers do not technically require the full typography system, although shared annotations benefit camera preset labels and export views.

Cross-review verdict:

Claude is better on Crew View timing; Codex grouped it too early. Claude overstates typography as a hard gate.

Recommended approach:

Build named perspective/orthographic/isometric views in the next milestone. Defer Crew View until rear/loading semantics, load/unload workflow, and clipping/cutaway behavior are decided. Keep camera APIs compatible with annotations, but do not block controller work on completed case typography.

## 7. Corrections to Codex's Original Audit

These six corrections should be carried into reconciliation.

| ID | Codex correction |
|---|---|
| O-01 | `TrailerGeometry` is not merely a visual duplicate. Current live editor containment, surface following, and wall snapping use it operationally. The correct finding is dual operational ownership. |
| O-02 | Semantic scene roots should not all be created before visible work. Introduce them with the first real lifecycle/export consumer. |
| O-03 | The original first pass included wiring existing label preferences. That broadens an otherwise appearance-preserving resource fix; visible label preference behavior should move to the typography pass. |
| O-04 | Crew View should not be in the initial named-camera delivery by default. It remains a later logistics-workflow preset after the camera foundation. |
| O-05 | Approximate draw-call counts in the original audit are directional, not measured facts. Multi-material meshes, shadow passes, and renderer behavior must be profiled rather than reduced to a fixed count. |
| O-06 | The recommendation to reduce category color to a small accent is a visual-direction option, not an engineering conclusion. Product must decide how much category identity the 3D canvas should carry. |

## 8. Corrections to Claude Audit

These ten corrections correspond to the rejected/corrected count in the terminal summary.

| ID | Claude statement requiring correction | Corrected conclusion |
|---|---|---|
| X-01 | Trailer geometry has a clean authoritative owner. | Zone formulas are duplicated, and both copies are operational in different paths. |
| X-02 | Cache/disposal is solid. | Ref counting exists, but `disposeGroup()` can prematurely dispose shared maps outside the cache owner. |
| X-03 | Sprite or CSS2D is a comparable label replacement. | They have different rendering, depth, export, accessibility, and lifecycle contracts; CSS2D is absent from current WebGL capture. |
| X-04 | Measurement can reasonably live inside InteractionManager and reuse `snapToNearest()`. | Share input and annotations, but use a separate controller and authoritative feature queries; current snap output is not a measurement primitive. |
| X-05 | The current snapping foundation is already CAD-like enough for purely additive guides. | Existing snap behavior is useful, but professional guides require semantic candidate/result data and physical-boundary classification. |
| X-06 | Editor rendering directly rereads StateStore and the shadow shortcut should be persisted. | CaseScene uses PreferencesManager; app already owns propagation; saved shadow intent must be distinct from transient/fallback state. |
| X-07 | Screenshot/PDF compatibility is ready. | Capture infrastructure is ready, but scene filtering, orthographic framing, helper inclusion, and DOM-label composition are unresolved. |
| X-08 | GLB can slot into GeometryFactory with no architectural preparation. | Current factory returns BufferGeometry and current picking expects one mesh; entity/model/proxy/loading/disposal seams are needed. |
| X-09 | Visual Foundation has no packing coupling. | Live picking, drag AABBs, containment, snapping, and final validation share the edited modules. |
| X-10 | Scene groups followed by typography are the best first implementation steps. | Fix resource ownership first; add groups only with their consumer; then rework typography. |

## 9. Third Alternatives

The strongest reconciled choices are not simple compromises between the two audits.

### New cross-review findings

The comparison and source verification produced five findings that were not stated with this precision in either original audit:

| ID | New or materially sharpened finding |
|---|---|
| N-01 | Trailer zones have dual operational ownership: packing/manual validation primarily uses `PackLibrary`, while live editor containment, surface following, and snap-wall candidates use the duplicate `TrailerGeometry` calculations. This is stronger than a visual-code duplication concern. |
| N-02 | The named front-overhang “visual bounds match collision” test does not call `TrailerGeometry.getFrontBonusZone()` to compare the two owners. It reconstructs the expected render formula inside the test, so later drift between the two implementations can escape that parity test. |
| N-03 | Cached texture ownership is a confirmed defect in the source contract, not merely an ambiguous risk: `disposeGroup()` disposes `material.map` even after `releaseTextures()` has retained the same cached texture for other instances. The visible/runtime consequence still needs a reproduction test. |
| N-04 | `InteractionManager` installs pointer/window/keyboard listeners but exposes no destroy/teardown method and does not register `pointercancel`. This is a concrete lifecycle prerequisite before adding measurement or more touch tools. |
| N-05 | Export filtering is currently inconsistent by construction: the axis widget is rendered in a separate viewport pass and therefore does not enter `renderCameraToDataUrl()`, while main-scene helpers can enter it. A deliberate presentation classification is needed rather than relying on current scene placement accidents. |

### Hybrid label architecture

Use one text layout/raster/cache subsystem with two WebGL presentations:

- surface-bound case labels on shallow planes or controlled material regions;
- camera-facing Sprite annotations for measurements, warnings, snap values, and future zone markers.

CSS2D remains optional for editor-only rich DOM overlays and is never assumed to enter screenshots/PDF.

### Explicit preference application

Do not make render modules subscribe to StateStore independently. Preserve the existing app-level change orchestrator and add explicit application APIs to the scene and case owners. This keeps persistence, normalization, UI, runtime fallbacks, and undo policy separable.

### Just-in-time semantic roots

Do not add three empty architectural groups. Add an annotation root with the annotation renderer, a cargo entity root when representation/picking changes, and export classifications with the export policy. Each new root must have a cleanup and inclusion test.

### Authoritative feature queries

Do not make measurement or enhanced snapping depend directly on visual meshes or ad hoc world-coordinate helpers. Expose canonical inch-space features: trailer planes, usable-volume boundary faces, blocked regions, case envelope faces/corners/centers, and support surfaces. Convert at the editor boundary.

### Semantic snap results without a solver rewrite

Preserve current candidate mathematics initially, but return a result descriptor such as axis, source feature, target feature, delta, gap, tolerance, and validity. Guides consume that descriptor; collision validation remains authoritative.

### Requested versus effective quality

Persist what the user asked for, while runtime exposes what the renderer can currently honor. This is especially important for shadows under low-FPS fallback and may later apply to label density or pixel ratio.

## 10. Cargo Visual Resource Verdict

This is the prerequisite first pass.

Confirmed current contract:

- one case instance owns a Group, one visible mesh, six `MeshStandardMaterial` objects, six cached CanvasTextures, and edge lines;
- edge and texture caches are keyed by the same incomplete signature;
- texture acquisition is ref-counted;
- material traversal also disposes maps directly;
- visual-state recomputation mutates current materials but does not create new materials;
- authoritative case AABBs come from metadata, which must stay independent of any presentation change.

Required correction before label replacement:

1. Define one cache identity that includes every input affecting the current generated visual resource.
2. Give the texture cache sole disposal ownership for cached textures.
3. Ensure per-instance material disposal does not dispose shared maps.
4. Add focused tests for shared acquisition/removal, final release, signature invalidation, and unchanged AABB/picking contracts.
5. Preserve current visible appearance, geometry, transform, snapping, and selection semantics.

The resource pass should not yet enable `showLabels`, change fonts, add Sprites, add bevels, replace mesh picking, or restructure the scene.

## 11. Typography / Annotation Verdict

The final architecture should be staged and WebGL-first.

### Stage A: shared raster contract

Create a reusable text-layout service that accepts semantic content, font/style tokens, maximum line count, alignment, background/contrast policy, and target raster density. It should return cacheable CanvasTextures with explicit ownership/disposal.

DevicePixelRatio should be an input bounded by a quality policy, not blindly multiplied into every case texture. The cache key must include content, font/style, resolution bucket, label-density mode, and theme/export presentation where applicable.

### Stage B: case-surface identity

Move case identity away from six whole-face generated textures. Keep labels attached to authoritative case orientation by using one or two shallow surface planes or equivalent surface regions with a tiny depth offset. The label must not change the authoritative envelope or become the raycast target.

Default content should be deliberately sparse. Case name plus one operational identifier is a reasonable technical default; weight, stop number, orientation warning, dimensions, and sequence require a product density decision.

### Stage C: camera-facing annotations

Use Sprite for temporary measurement values, snap feedback, warnings, and future annotation labels when constant or bounded screen readability is needed. Decide `sizeAttenuation`, depth test, render order, and occlusion per annotation type. Measurement labels should not show through cargo by accident.

### Stage D: CSS2D only by exception

CSS2D can be appropriate for editor-only controls, rich hover cards, or accessible DOM detail that is intentionally excluded from export. It is not the primary case-label or load-plan-annotation renderer unless a separate WebGL export representation is also maintained.

Validation must cover perspective and orthographic cameras, light/dark themes, 25/100/300 cases, repeated and unique labels, high-DPI displays, rotation, occlusion, export, and disposal.

## 12. Scene Hierarchy Verdict

Semantic grouping has concrete value only when attached to behavior.

| Proposed root | Concrete benefit | When to add | Main risk |
|---|---|---|---|
| Cargo/entity root | Bulk visibility, entity cleanup, future technical envelope + optional model + labels | When cargo representation/picking is changed | Parent-space assumptions and current `scene.remove(group)` paths |
| Annotation root | Shared label/measurement/snap/zone lifecycle | With annotation renderer | Accidental export inclusion and depth-order ambiguity |
| Editor-only helper root | Hide gizmo, hover guides, snap guides, transient measurements from capture | With export policy or first helper consumer | Hiding user-requested persistent annotations too broadly |
| Exportable annotation root | Include intentional dimensions/labels in selected exports | When export inclusion UX exists | Duplicated scene objects if editor/export ownership is unclear |
| Heatmap root | Toggle, dispose, and capture density overlay independently | With roadmap heatmap work | Transparency/render-order cost |

Do not create a “helpers” bucket with no taxonomy. At minimum distinguish editor-only/transient from exportable/persistent. Scene runtime should own root creation and disposal; feature modules should own their children.

## 13. Preferences Verdict

The smallest clean model is:

1. `DEFAULT_PREFERENCES` and normalizer remain schema/default truth.
2. `PreferencesManager` remains the normalized persistence API.
3. The app-level preference observer remains the coordinator.
4. Scene and CaseScene receive explicit normalized snapshots through application methods.
5. Session-only editor state is not silently added to persisted preferences.
6. Project-specific visualization state is not silently added to global preferences or saved pack schema.

Classification recommendation:

| Candidate | Scope | Notes |
|---|---|---|
| Lighting preset | Global user preference | `Standard`, `Bright`, `High Contrast`; avoid raw light knobs. |
| Shadow intent/quality | Global user preference | `Off`, `Standard`, `High` only if measured; track effective fallback separately. |
| Trailer line/floor colors | Global user preference initially | Reassess project-specific need before adding pack schema. |
| Label visibility/density | Global user preference | Density is more useful than unrestricted font size alone. |
| Grid default/appearance | Global user preference | Current per-pack precision needs are not yet established. |
| Snap enabled/distance/guides | Global user preference | Existing fields can evolve through normalizer; do not add local keys. |
| Active camera/view | Session-only by default | Saved viewpoints are a later project feature. |
| Current measurement set | Session-only first | Persistence and export inclusion require a product decision. |
| Hover/selection/tool mode | Session-only editor state | Never preferences or project data. |

Before adding live sliders, decide whether preference writes belong in undo history. Continuous visual controls should not generate application undo steps by accident.

## 14. Measurement / Snapping Verdict

### Prepare during Visual Foundation

- shared WebGL annotation label renderer;
- annotation lifecycle root with explicit export classification;
- pointer/tool ownership concept so measurement does not fight cargo drag;
- design-only authoritative feature-query interface;
- semantic snap-result shape if snap guides are included in this phase.

### Implement later

- point-to-point and axis measurements;
- endpoint picking/snapping;
- handles, extension lines, arrows/ticks, selection, deletion, and clear-all;
- persistent measurements;
- numeric case placement;
- advanced center/corner/face/gap/stack alignment.

Recommended later module boundary:

```text
Editor input broker
  -> active tool controller
       -> MeasurementController
       -> CargoPlacementController (existing behavior)
  -> AuthoritativeGeometryQueries (inches)
  -> AnnotationLayer (world presentation only)
```

Measurements should store authoritative inch-space endpoints/features and derive display units through the existing unit formatter. A label showing millimeters must not cause geometry to be stored or solved in millimeters.

Existing snap behavior remains KEEP for current workflows. Do not rewrite it for purity. Before guides, add semantic target metadata and exclude nonphysical internal zone seams from “wall” terminology unless the product intentionally treats them as placement planes.

## 15. Trailer / Floor / Lighting Verdict

KEEP:

- technical trailer volumes derived from explicit truck dimensions;
- open front-bonus seam and seam-edge trimming;
- mesh exterior rails and distinct rear/loading-door versus front/cab cues;
- translucent blocked guide volumes for wheel wells/cab void;
- current direct lighting foundation, environment map, shadow camera fitting, and low-FPS fallback;
- restrained default grid density.

EVOLVE:

- centralize visual tokens/material creation for trailer surface, floor, rails, blocked guides, and theme variants;
- expose safe color/opacity inputs through explicit visual preference application;
- make floor readability and cargo contact the primary shadow goal;
- keep rail geometry and zone dimensions unchanged while changing materials;
- make grid meaning explicit before presenting it as a precision scale;
- validate selected/collision colors against trailer cues so green/red direction cues do not compete with status warnings.

Do not add bevel geometry, screen-space ambient occlusion, postprocessing outlines, or high shadow tiers until representative profiles justify them. Subtle edges, existing rails, restrained floor contrast, and standard shadows should be tried first.

## 16. Camera Boundary

| Time | Included | Excluded/deferred |
|---|---|---|
| NOW — Visual Foundation | Camera-agnostic materials/labels; annotations that render correctly under perspective and orthographic cameras; export classification; no camera replacement | Named views, camera switching, Crew View, saved viewpoints, section views |
| NEXT — Camera/View System | Camera controller; active-camera ownership; perspective and reusable orthographic cameras; Home/Fit Trailer/Fit Load/Fit Selection; Front/Rear/Left/Right/Top/Isometric; transitions and reduced-motion behavior; resize/picking compatibility | Workflow-specific Crew View unless separately approved; saved viewpoints; cutaway/section tools |
| LATER | Crew/Loader preset(s), saved viewpoints, cutaway/section views, stop/load workflow integration | Separate renderer/camera framework rewrite |

The camera controller should eventually replace PDF's private ad hoc framing logic with shared fit/framing calculations while keeping export cameras independent enough to render deterministic output. Interactive camera state must not be mutated just to produce a PDF.

Crew View should be a preset within the camera system, not a new renderer. Its shipping definition still needs rear-door position, eye height/FOV, clipping/cutaway behavior, and relationship to loading versus unloading sequence.

## 17. Export/PDF Verdict

The WebGL capture function is a useful foundation, not a finished presentation contract.

Required export classifications:

- **always include:** authoritative cargo presentation, trailer/floor presentation, intentionally enabled case labels;
- **always exclude:** selection gizmo, hover-only state, snap guides, drag preview, transient collision preview, editor axes unless explicitly requested;
- **product-controlled:** measurements, persistent annotations, heatmap/legend, grid, warnings;
- **export-specific:** neutral/white background, exposure/shadow preset, label density, resolution.

Recommended technical policy:

1. Classify objects through semantic roots/layers or an explicit presentation registry.
2. Apply an export presentation snapshot, render, and restore in `finally`.
3. Never infer exportability solely from `visible` at the instant of capture.
4. Include total authoritative trailer extent, including front bonus, in fit calculations.
5. Adjust orthographic frustum to target aspect rather than stretching a physical frustum into a fixed bitmap.
6. Keep exportable text in WebGL or provide an explicit DOM-to-image composition path; do not assume CSS2D capture.
7. Test thumbnail, screenshot, and PDF separately because resolution, camera, MIME, and product intent differ.

Preview capture has an OperationLifecycle guard; screenshot/PDF functions do not independently establish the same capture operation. That distinction should be preserved in risk analysis rather than saying every capture is either guarded or unguarded.

## 18. Performance Verdict

No current source evidence proves a 300-case bottleneck. Sequence work around measured risks, not hypothetical architecture.

### Current confirmed structural costs

- six face materials and six CanvasTextures per unique visual signature;
- a shared texture can be disposed prematurely by current ownership;
- selection/hover/drag changes recompute visual state across all instances;
- raycasting builds an O(N) mesh list and intersects visible cargo meshes;
- every case casts and receives shadows;
- pixel ratio is capped but still materially affects fill cost;
- exports allocate a full render target and CPU pixel buffer for every image.

### Likely future costs

- unique label content defeating cache sharing;
- Sprite annotations at high count;
- higher shadow maps or multiple shadow-casting lights;
- bevelled/rounded geometry and additional material groups;
- transparent trailer surfaces and depth sorting;
- GLB meshes with many children/materials;
- animated camera/material transitions;
- editor helpers accidentally included in raycasts.

### Theoretical only until measured

- InstancedMesh as a required solution;
- postprocessing outlines/AO as necessary or too expensive;
- specialized SDF text as required;
- a worker/offscreen renderer;
- renderer replacement.

Performance gates should use 1, 25, 100, and 300 cases, with both repeated case definitions and mostly unique labels. Capture frame time, draw calls, triangles, texture count/estimated bytes, renderer memory, hover/drag latency, shadow-on/off delta, and screenshot/PDF time. Test at DPR 1 and a representative high-DPI setting. Keep a lower-end GPU/manual profile in the acceptance matrix.

## 19. Recommended Final Implementation Order

This is a cross-review sequence, not the final master implementation plan.

### Pass 0 — Characterization and reproducible visual baseline

- **Objective:** Record current screenshots/metrics and strengthen only high-value contract tests around case resources, geometry independence, and export inclusion.
- **Visible benefit:** None; creates a trustworthy comparison baseline.
- **Dependency:** None.
- **Likely files:** existing audit tests; manual visual fixture/checklist documentation only if separately authorized.
- **Forbidden/unrelated areas:** solver changes, UI redesign, dependency upgrades, generated build output.
- **Regression risk:** Low, except brittle source-regex additions should be avoided.
- **Validation gate:** Existing tests plus manual empty/light/tight/stacked/selected/collision/truck-shape captures.
- **Performance gate:** Record 1/25/100/300 baseline metrics before visual changes.

### Pass 1 — Cargo visual resource contract

- **Objective:** Correct cache identity, cached-texture ownership, final disposal, and focused tests without changing appearance.
- **Visible benefit:** None intended; prevents stale labels and resource invalidation.
- **Dependency:** Pass 0 characterization.
- **Likely files:** `src/screens/editor-screen.js`; focused existing tests such as `tests/audit/manual-vertical-placement.spec.mjs` and only the minimum invariant test owner.
- **Forbidden/unrelated areas:** `src/services/autopack-*`, `src/packing-core/*`, trailer zone formulas, case transforms, picking, persistence schema, export/PDF, dependency changes.
- **Regression risk:** Medium-high because resource ownership affects every case instance.
- **Validation gate:** Shared signature acquisition, one-of-many removal, last-owner disposal, signature invalidation, unchanged visual-state precedence, unchanged AABB/selection/raycast membership.
- **Performance gate:** Texture and renderer-memory counts return to baseline after repeated add/remove/switch cycles.

### Pass 2 — Cargo material and interaction-state language

- **Objective:** Establish professional restrained case materials/edges and a documented compositing hierarchy for normal, hover, selected, dragging, collision, OOG, and hidden states.
- **Visible benefit:** Cleaner cargo, better adjacent-case separation, clearer selection and invalid placement.
- **Dependency:** Pass 1 resource ownership.
- **Likely files:** `src/screens/editor-screen.js`, visual-state tests, limited `styles/main.css` only for matching editor controls/legend if required.
- **Forbidden/unrelated areas:** placement math, snap candidates, geometry dimensions, AutoPack, undo semantics, new postprocessing.
- **Regression risk:** Medium; material changes can obscure warnings and increase draw cost.
- **Validation gate:** State precedence tests and manual stacked/tightly packed/color-blind/light-dark review.
- **Performance gate:** 100/300-case draw time, state-recompute latency, material/texture counts.

### Pass 3 — Shared typography and annotation foundation

- **Objective:** Introduce shared raster/cache/disposal and surface-bound case labels; add the smallest annotation root/service needed for later Sprites.
- **Visible benefit:** Crisp, consistent, legible labels at useful zooms with deliberate density.
- **Dependency:** Passes 1-2 and product label-content/density decision.
- **Likely files:** a small new editor text/annotation module if explicitly approved, `src/screens/editor-screen.js`, `src/core/defaults.js`, `src/core/normalizer.js`, Settings UI owners, focused tests.
- **Forbidden/unrelated areas:** CSS2D as primary export text, camera-system rewrite, measurement tool UI, GLB loader, case envelope changes.
- **Regression risk:** High for texture memory, disposal, export, occlusion, and raycasting if label planes are pickable.
- **Validation gate:** Surface labels rotate/occlude correctly, are excluded from picking, honor label preference/density, and appear in screenshot/PDF.
- **Performance gate:** repeated/unique label profiles at 25/100/300, DPR 1/high-DPI, texture memory and generation time.

### Pass 4 — Trailer/floor visual tokens and preference application

- **Objective:** Centralize safe trailer/floor/rail/blocked-guide materials and apply normalized visual preferences through explicit APIs.
- **Visible benefit:** Coherent trailer/cargo contrast and controlled theme/personalization.
- **Dependency:** Interaction-state palette and preference-scope decisions.
- **Likely files:** `src/editor/scene-runtime.js`, `src/app.js`, `src/services/preferences-manager.js` only if API support is needed, defaults/normalizer, Settings overlay, focused rail/geometry characterization tests.
- **Forbidden/unrelated areas:** rail coordinates, usable/blocked zones, truck form lifecycle, AutoPack, shadow fallback removal.
- **Regression risk:** Medium-high because trailer visuals carry directional and blocked-space meaning.
- **Validation gate:** rect, wheel-well, and front-bonus modes; rear/front cues; no internal seam; light/dark; truck switching; preference persistence and undo policy.
- **Performance gate:** material reuse and truck-switch disposal remain stable.

### Pass 5 — Lighting, shadows, contact, and restrained grid closeout

- **Objective:** Tune the existing renderer foundation through small professional presets and contact readability, without postprocessing.
- **Visible benefit:** Better depth and floor contact without gloss or visual noise.
- **Dependency:** Stable cargo/trailer materials and requested-versus-effective quality model.
- **Likely files:** `src/editor/scene-runtime.js`, preference defaults/normalizer/Settings, focused renderer tests/manual profiles.
- **Forbidden/unrelated areas:** raw technical knobs in normal Settings, multiple new lights without evidence, bevel rollout, postprocessing, InstancedMesh.
- **Regression risk:** Medium for GPU cost, warning-color readability, and low-FPS fallback behavior.
- **Validation gate:** empty/light/tight/stacked loads, different truck shapes, dark/light, lower-end GPU, shadow fallback and restored preference intent.
- **Performance gate:** 25/100/300 cases with Off/Standard/High only if High survives profiling.

### Pass 6 — Export presentation compatibility closeout

- **Objective:** Define helper/annotation inclusion, neutral export presentation, total-envelope framing, and reliable restore behavior.
- **Visible benefit:** Screenshot, PDF, and thumbnail imagery match the professional editor rather than leaking editor-only state.
- **Dependency:** Final Visual Foundation objects/materials/labels.
- **Likely files:** `src/app.js`, scene-root/layer APIs in `src/editor/scene-runtime.js`, annotation owner, export-focused tests.
- **Forbidden/unrelated areas:** billing entitlement changes, PDF document-content redesign, saved pack schema unless separately approved.
- **Regression risk:** High because capture uses live renderer/scene state and has product/billing consumers.
- **Validation gate:** screenshot, thumbnail, PDF perspective/top/side; front bonus; helper inclusion matrix; state restoration after failure.
- **Performance gate:** capture time/memory at 100/300 cases and target export resolutions.

### Pass 7 — Camera/View System (NEXT milestone)

- **Objective:** Introduce active-camera ownership, fit/framing, named perspective/orthographic/isometric views, transitions, and shared export framing math.
- **Visible benefit:** Precise professional inspection from consistent views.
- **Dependency:** Visual Foundation and export/annotation contracts.
- **Likely files:** `src/editor/scene-runtime.js`, a focused camera controller module if approved, `src/screens/editor-screen.js`, `src/app.js` export integration, editor toolbar/CSS, tests.
- **Forbidden/unrelated areas:** Crew workflow, saved viewpoints, measurement UI, solver/packing changes.
- **Regression risk:** High for controls, resize, raycasting, drag plane, screenshot/PDF, and view terminology.
- **Validation gate:** all named views, fit functions, resize, mouse/touch orbit, selection/drag under each supported projection, reduced motion, export framing.
- **Performance gate:** transition/render stability at 300 cases; no per-frame camera object allocation.

### Pass 8 — Precision infrastructure and later features

- **Objective:** Only after dedicated approval, consolidate authoritative geometry queries, add semantic snap results/guides, then measurement UI; continue with heatmap and GLB in roadmap order.
- **Visible benefit:** CAD-like placement/measurement and later richer logistics visualization.
- **Dependency:** camera, annotations, export policy, and trailer-zone parity/consolidation.
- **Likely files:** focused new editor controllers/services plus narrow integration points; packing authority remains in PackLibrary/packing-core.
- **Forbidden/unrelated areas:** deriving measurement/collision from rendered models; embedding all tools in `editor-screen.js`; GLB-before-envelope/pick-proxy contract.
- **Regression risk:** High for interaction arbitration, geometry, undo/persistence, and export.
- **Validation gate:** authoritative inch-space comparisons, all truck shapes/orientations, touch/mouse conflict tests, operation lifecycle, import/export decisions.
- **Performance gate:** guide/measurement raycasts and annotation count at 100/300 cases.

## 20. Safe Parallel Work

The V6 roadmap calls for one active branch, so “parallel” here means independent preparation/review streams that do not land overlapping runtime changes.

Safe parallel preparation:

- product decisions for label content, density, category color, and warning hierarchy;
- baseline screenshot fixture selection and manual acceptance checklist;
- 1/25/100/300 performance scenario definition;
- export inclusion matrix for labels, measurements, grid, heatmap, and warnings;
- professional material/token exploration that does not edit runtime code;
- camera terminology and Crew View workflow research after current repository decisions are exhausted.

Potentially parallel code work only after interfaces are frozen:

- focused resource-contract tests and visual token specification;
- export acceptance tests and camera controller design;
- annotation raster service tests and Settings copy.

Integration must still be serialized where the same `editor-screen.js`, `scene-runtime.js`, or `app.js` ownership seams are touched.

## 21. Must-Remain-Sequential Work

1. Resource cache/disposal contract before label representation changes.
2. Cargo state palette before trailer/rail colors that might compete with warnings.
3. Annotation ownership before measurement labels or snap guides.
4. Export object classification before editor-only helpers proliferate.
5. Requested/effective quality contract before shadow controls are exposed.
6. Camera controller before consolidating PDF orthographic camera logic.
7. Authoritative trailer-zone parity/consolidation before measurement or advanced snap features depend on zone planes.
8. Semantic snap results before visual snap guides claim a target.
9. Visual entity/pick proxy contract before GLB model loading.
10. GLB spike before any asset library or production model pipeline.

## 22. Product Decisions Still Required

Only unresolved product/design decisions are listed here.

1. What minimum information belongs on a case at default label density: name, case number, quantity/sequence, stop, weight, dimensions, orientation warning?
2. Should labels appear on one face, two opposite faces, selected/near-camera faces, or according to a density/LOD policy?
3. How much category color should remain on cargo: full body, restrained tint, stripe/accent, or user-selectable?
4. When selection and collision/OOG overlap, which non-color cues must remain visible?
5. Are shadow changes saved user preferences, session-only quick controls, or both with separate intent/effective state?
6. Are trailer line/floor colors global user preferences only, or can a project override them?
7. Should the default grid remain purely spatial, or should an optional precision grid display unit-aware increments?
8. Which annotations are included by default in screenshots, thumbnails, and PDF: case labels, warnings, measurements, grid, heatmap?
9. Are measurements session-only initially, and if later persistent, are they project data and undoable?
10. Should Isometric be orthographic, perspective, or offer both?
11. What exactly does Crew/Loader View represent: loading from rear, unloading by stop, eye height/FOV, and cutaway/clipping rules?
12. Are rounded/bevelled case visuals desired after profiling, or are clean planar boxes with edges the intended professional language?
13. Which length display units are approved for canvas annotations beyond current inch/foot behavior, particularly mm/cm?

## 23. Recommended First Implementation Pass

**Cargo visual resource contract correction, with no intended visual change.**

Scope:

- make visual-resource cache identity cover all inputs that currently affect generated textures/geometry;
- make the cache the sole owner of cached CanvasTexture disposal;
- dispose per-instance materials without disposing shared maps;
- characterize acquisition, reuse, one-instance removal, final release, and signature invalidation;
- prove case authoritative AABB, transform, selection, and current picking membership are unchanged.

Likely files:

- `src/screens/editor-screen.js`
- `tests/audit/manual-vertical-placement.spec.mjs`
- at most the existing narrow invariant test owner if a lifecycle assertion cannot live in the first test file

Avoid:

- `src/services/autopack-engine.js`
- `src/services/autopack-solver.js`
- `src/packing-core/*`
- `src/editor/trailer-geometry.js`
- `src/services/pack-library.js`
- `src/editor/scene-runtime.js`
- `src/app.js` export/PDF paths
- persistence/schema/import/export changes
- preference behavior changes
- Sprite/CSS2D/label redesign
- cargo geometry, picking, snapping, collision, or camera changes

This pass should precede Claude's typography task. They should not become one patch because a visual replacement would make it harder to determine whether cache/disposal corrections are behavior-preserving.

## 24. Consolidated Do-Not-Break Contract

Every future Visual Foundation or Camera prompt should preserve the following unless an explicitly approved, tested task changes it:

- Authoritative dimensions, oriented dimensions, positions, rotations, supports, usable zones, and blocked zones remain in canonical inch-space data/services.
- Decorative mesh bounds, GLB bounds, bevels, labels, lines, shadows, and transparency never become collision, AutoPack, containment, support, stacking, snapping, or measurement truth by default.
- `WORLD` conversion remains a presentation/editor-boundary conversion, not stored packing data.
- Case transforms and `orientedDims` remain the source of operational AABBs.
- Current collision-safe validation still owns whether a snap/drag placement commits.
- Existing AutoPack, Unpack, Truck Change, and capture lifecycle guards remain intact.
- Camera orbit/pan/zoom remains available unless a proven interaction conflict requires a scoped lock.
- Rendered visual models do not become default pick geometry; pick targets remain stable and explicit.
- Labels and helper geometry do not expand authoritative envelopes.
- Selection/hover/drag/collision/OOG/hidden precedence remains deterministic and tested.
- Cached resources have one owner and are disposed only after their final user releases them.
- Listener, control, material, geometry, texture, render-target, and annotation cleanup is explicit on reload/navigation/destruction.
- Trailer rail/surface styling does not change truck dimensions, front/rear convention, door opening, usable zones, wheel wells, or front-overhang deck/cab void.
- Preferences use normalized declared schema and a central application path; no scattered storage keys.
- Session state, user preferences, and project data remain distinct.
- Preference changes do not silently pollute undo/redo.
- Editor-only helpers are excluded from screenshots/PDF/thumbnails unless product explicitly includes them.
- Export rendering restores all scene/renderer/camera state even on failure.
- PDF/screenshot framing includes the full authoritative truck/load extent and respects target aspect.
- CSS2D content is not assumed to exist in WebGL exports.
- Interactive and export labels remain readable in perspective/orthographic views and at bounded high-DPI settings.
- Visual quality work is profiled at 1, 25, 100, and 300 cases before instancing, postprocessing, or renderer changes.
- Direct Three.js/WebGLRenderer and the scene-runtime/editor-screen separation remain KEEP.
- No React/R3F, WebGPU, renderer, framework, or packing-engine rewrite is implied by professional visual work.
- The technical-box fallback remains available for every future optional visual asset.

## 25. Final Verdict

**C. Hybrid sequencing is superior.**

Codex's resource-contract correction remains the right first implementation pass. Claude's typography proposal should follow it, revised into a staged WebGL-first surface-label/annotation architecture rather than an undifferentiated Sprite-or-CSS2D replacement. Claude's stronger KEEP findings for trailer rails, seam handling, lighting foundation, and Camera/Crew roadmap boundaries should be retained. Codex's stronger geometry, picking, export, preference-history, resource, and GLB cautions should define the regression gates.

The reconciled sequence is therefore:

1. characterize and correct cargo visual-resource ownership;
2. establish cargo material/state language;
3. build shared typography and minimal annotation infrastructure;
4. evolve trailer/floor materials and explicit preference application;
5. tune existing lighting/shadows/contact/grid within measured limits;
6. close export presentation compatibility;
7. build the Camera/View System next, with Crew View deferred pending workflow decisions;
8. add precision measurement/snapping infrastructure and later heatmap/GLB work only after their authoritative and lifecycle prerequisites.

This sequence delivers professional visual impact without allowing decorative presentation to become logistics truth.
