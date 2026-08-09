# Truck Packer 3D — Professional 3D Editor Visual Foundation Implementation Contract

**Contract version:** 1.0  
**Date:** 2026-08-09  
**Scope:** V6 Roadmap Item #1 — Professional 3D Editor Visual Foundation  
**Status:** Approved planning baseline; implementation has not started under this contract.

## 1. Purpose

This contract reconciles the original Claude and Codex architecture audits plus both reciprocal cross-reviews. It is the implementation authority for the Professional 3D Editor Visual Foundation phase unless current source/tests prove a specific statement stale.

The goal is to move Truck Packer 3D from a technically sound Three.js logistics editor with basic presentation to a deliberately designed, professional logistics/CAD-style editor while preserving packing, collision, snapping, persistence, Auto-Pack, interaction, export, and performance correctness.

The generated professional UI screenshot is a **visual north star**, not a literal feature checklist for this milestone. By the end of Visual Foundation, procedural boxes and the procedural trailer should already look polished and credible. Full physical realism from detailed trailer chassis, machinery, vehicles, furniture, and other complex objects belongs to the later GLB/Asset work.

## 2. Settled Architecture Decisions

The following are no longer open questions:

- Keep direct Three.js/WebGLRenderer.
- Keep Three.js `0.185.1` unless separately approved dependency work changes it.
- No React Three Fiber rewrite.
- No WebGPU migration.
- Keep the `scene-runtime.js` / `editor-screen.js` responsibility split.
- Keep canonical packing/trailer/case geometry in inch-space services and data.
- Decorative meshes, label planes, Sprites, GLBs, bevels, shadows, lines, and effects must never become logistics truth by default.
- Keep `resolveCaseVisualState()` as the single deterministic owner of case visual-state precedence.
- Keep existing trailer rail/seam construction patterns unless a measured reason requires a local improvement.
- Do not introduce InstancedMesh, postprocessing, or a renderer rewrite without profiling first.
- Keep the technical-box fallback for every future optional 3D visual asset.

## 3. Current Confirmed Risks That Must Shape the Work

The cross-reviews converged on several issues that are more important than pure visual polish:

1. **Cargo visual resource ownership bug.** Cached CanvasTextures can be disposed while another case sharing the same visual signature still uses them. The cache signature is also incomplete for all visual inputs.
2. **Export helper leakage.** The live scene capture path explicitly hides the grid but can capture editor-only helpers such as the gizmo and CoG marker.
3. **Typography architecture is not production-ready.** Current case text is baked into generated whole-face textures, is not sufficiently DPI-aware, and existing `labelFontSize` behavior is effectively unwired.
4. **Visual preferences are partially dormant.** Existing fields such as label/shadow/render-quality/camera settings do not all have a coherent runtime application contract.
5. **Trailer usable-zone calculations have dual operational ownership.** Do not refactor this as part of the visual phase, but do not build future measurements/advanced snapping on top of the duplication without a parity/consolidation task.
6. **Current rendered cargo meshes still participate in picking.** This is acceptable for current technical geometry, but future GLBs must not silently become default pick/collision authority.
7. **Interaction teardown/pointer cancellation needs hardening before adding new measurement/tool modes.** This is not a Visual Foundation blocker unless interaction ownership is changed now.

## 4. Scope Boundary

### Included in this milestone

- cargo resource correctness needed for safe visual work;
- professional cargo material and edge language;
- professional selection/hover/drag/collision/OOG presentation;
- shared WebGL-first typography foundation;
- case-surface label redesign;
- minimal reusable camera-facing annotation capability needed by later features;
- trailer/floor/wall/rail visual treatment;
- visual preference application for the approved subset;
- lighting and shadow refinement using the existing renderer foundation;
- restrained grid/spatial-reference refinement;
- export/screenshot/PDF visual parity and editor-helper exclusion;
- performance characterization at representative load counts.

### Explicitly not included

- live Camera/View System implementation;
- full measurement tool;
- advanced snap-guide/tool system;
- Heatmap implementation;
- PDF document-layout redesign;
- GLB asset loading/library;
- Auto-Pack strategy work;
- collision/packing-engine redesign;
- free-angle rotation;
- project-saved viewpoints;
- Crew/Loader workflow implementation;
- renderer/framework migration.

## 5. Implementation Philosophy

Do not start with the easiest feature and do not start with the hardest feature. Work **dependency-first**.

Each implementation pass must:

- have one primary purpose;
- minimize unrelated file churn;
- preserve current behavior unless a visual/product behavior change is explicitly part of that pass;
- add or strengthen characterization tests before replacing an under-tested mechanism;
- land and stabilize before the next dependent pass begins;
- be independently reviewable and reversible.

Use one active branch at a time. Prefer sequential, tightly scoped branches/PRs rather than one giant long-running visual rewrite.

## 6. Preflight — Clean Reproducible Baseline

This is housekeeping, not the first visual pass.

### Required before implementation

1. Preserve the four audit/cross-review Markdown files in Git as engineering records.
2. Resolve the current Vite installed/declared mismatch so `npm ls vite` is clean. Prefer the already validated exact `8.2.1` dependency-maintenance baseline if that work is still current; otherwise deliberately restore the declared exact version. Do not leave an `invalid` npm tree.
3. Confirm clean `main` after the documentation/dependency baseline is merged/synced.
4. Run and record:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm audit`
   - `git diff --check`
5. Capture baseline editor screenshots for the same repeatable scenarios:
   - empty trailer;
   - light mixed load;
   - dense mixed load;
   - selected case;
   - hovered case;
   - collision state;
   - OOG state;
   - dark and light theme where supported.
6. Define performance fixtures for 1, 25, 100, and 300 cases on the same baseline machine/browser.

### Baseline acceptance

No product implementation begins until the dependency tree and normal validation suite are clean aside from already accepted warnings/skips.

## 7. Pass 1 — Cargo Visual Resource Contract Correction

**Intentional visual change:** none.

### Objective

Fix the confirmed shared-texture lifecycle bug and make cargo visual-resource identity correct before any label/material redesign.

### Required work

- Ensure visual-resource cache signatures include every input that currently changes generated texture or visual geometry identity.
- Make the cache the sole owner of cached CanvasTexture disposal.
- Dispose per-instance materials without disposing shared cached maps still owned by the cache.
- Characterize acquisition, shared reuse, one-instance removal, final release, signature change, and recreation.
- Keep case transforms, AABBs, picking membership, collision, snapping, and pack data unchanged.

### Likely files

- `src/screens/editor-screen.js`
- focused existing audit/characterization tests

### Explicitly avoid

- Auto-Pack engine/solver;
- packing-core;
- trailer geometry;
- PackLibrary geometry behavior;
- scene-runtime lighting/trailer work;
- export/PDF paths;
- preference redesign;
- Sprite/CSS2D/label-plane redesign;
- camera changes.

### Gate

A reproduction test for the confirmed multi-case shared-texture deletion condition must fail before the fix and pass afterward. Normal test/lint/typecheck/build validation must pass.

## 8. Pass 2 — Professional Cargo Visual Language

### Objective

Make plain technical cargo look intentionally designed and highly legible before introducing more complex label/annotation infrastructure.

### Visual direction

- professional industrial/logistics aesthetic;
- restrained category color rather than neon/game-like saturation;
- solid material response, not plastic gloss;
- clear but not overpowering edges;
- strong depth and object separation;
- warnings remain operationally obvious;
- no effect may visually imply a false physical clearance.

### State architecture

Keep `resolveCaseVisualState()` as the only owner of state precedence. Extend it only when necessary and update characterization tests rather than creating parallel material mutation paths.

Recommended product behavior:

- collision remains an unmistakable top-priority error state;
- selection should not completely erase OOG/warning information;
- overlapping states should use more than color alone when necessary (outline/emissive/marker/edge treatment);
- hover must remain clearly subordinate to selection and warnings.

### Category color recommendation

Retain category recognition but move toward a restrained body tint/accent language. Do not make category colors compete with collision, OOG, selection, or future heatmap semantics.

### Bevels

Do not introduce geometry-expanding bevels in this pass. If rounded/bevelled visuals are later desired, they must remain inside the authoritative envelope and survive the 100/300-case performance gate.

### Gate

Manual visual review on empty/light/dense loads plus selected/hover/collision/OOG combinations. Existing collision, drag, snap, and state tests remain green.

## 9. Pass 3 — Shared Typography and Annotation Foundation

### Objective

Replace the current label architecture with a WebGL-first system that is clear on Retina/high-DPI screens, export-safe, reusable for future measurements/snap annotations, and explicit about ownership/disposal.

### Final architecture decision

Use **two WebGL presentation techniques under one shared text/raster ownership contract**:

#### A. Shared raster/text-layout contract

A reusable service/helper accepts semantic content, font/style tokens, maximum lines, alignment, contrast/plate style, resolution bucket, density mode, theme/export presentation, and bounded DPR. It returns cacheable CanvasTextures with explicit lifecycle ownership.

The cache key must include all meaningful visual inputs, including content and resolution/style state.

#### B. Case-surface identity labels

Move case identity away from generated full-face body textures. Prefer one or two shallow WebGL label planes/surface regions attached to the case orientation with a tiny visual offset.

Requirements:

- never alter authoritative dimensions;
- never enter collision/snapping/packing calculations;
- never become a cargo pick target;
- depth-test normally;
- remain captured by WebGL screenshot/PDF export;
- remain readable under perspective and later orthographic cameras.

If 100/300-case profiling proves surface-plane draw cost unacceptable, preserve the shared raster contract and optimize the representation without reverting resource ownership to the old ambiguous model.

#### C. Camera-facing annotations

Use `THREE.Sprite` for future/temporary measurement values, snap feedback, distance callouts, and similar camera-facing 3D annotations where bounded screen readability is important.

#### D. CSS2D

Do not use CSS2DRenderer for export-critical case labels or measurements. CSS2D may be considered later only for editor-only rich DOM UI that is intentionally excluded from exports.

### Existing preferences

Make label visibility real. Reconcile `labelFontSize` with the new density/resolution model rather than blindly applying a raw font pixel value everywhere.

### Default label content

Do not expand information density during the technical migration. Preserve current operational content as much as practical, then make a deliberate product-density decision before adding dimensions/stop/sequence/warnings to every case.

### Gate

Validate repeated and unique labels, rotation, light/dark, 25/100/300 cases, high-DPI display, screenshot/PDF capture, disposal, and occlusion.

## 10. Pass 4 — Trailer, Floor, Spatial Reference, and Visual Preferences

### Objective

Make the procedural trailer and workspace feel like a professional logistics environment without changing trailer geometry authority.

### Preserve

- current trailer construction boundaries;
- front/rear conventions;
- door/cab cues;
- wheel-well/front-overhang geometry behavior;
- rail technique used to avoid WebGL line-width limitations;
- seam trimming.

### Evolve

- trailer line/rail material language;
- floor material/color;
- wall opacity and contrast;
- scene background/grid relationship;
- semantic material ownership so visual preferences can update colors/opacity without rebuilding truck geometry unnecessarily.

### Preference application architecture

Use the existing declared defaults/normalizer/persistence model as schema truth, but avoid scattered ad-hoc reads and new storage keys.

Preferred incremental runtime pattern:

1. defaults + normalizer remain preference truth;
2. `PreferencesManager` remains the normalized write/persistence API;
3. the existing application-level preference/state observer coordinates changes;
4. SceneManager/CaseScene receive explicit normalized visual-preference snapshots through narrow application methods;
5. session-only editor state remains transient and is not persisted as a user preference;
6. project visualization overrides are deferred unless explicitly approved.

Do not create a new general-purpose subscription framework just for this phase.

### Initial scope recommendation

- trailer line/floor appearance: global user preferences first;
- label visibility/density: global user preference;
- active camera/view: session-only later;
- hover/selection/tool mode: session-only editor state;
- measurements: session-only when first implemented.

### Gate

Visual preference changes must update the existing scene without changing truck dimensions or polluting application undo/redo. Truck switching/rebuild/disposal remains stable.

## 11. Pass 5 — Lighting, Shadows, Contact, and Grid Closeout

### Objective

Use the renderer foundation already present to add depth and polish without creating a game-like or GPU-heavy effects stack.

### Preserve

- ACES tone mapping;
- sRGB output;
- current shadow-camera bounds logic;
- current multi-light foundation unless profiling/visual review proves a local change beneficial;
- automatic low-FPS shadow fallback behavior.

### Shadow model

Separate **requested** quality from **effective** quality.

Example:

- user requests `Off` or `Standard` initially;
- `High` is added only if profiling demonstrates a meaningful visual benefit at acceptable cost;
- automatic low-FPS fallback may temporarily reduce/disable effective shadows;
- fallback must not overwrite the user's saved requested preference;
- Restore returns toward the requested setting.

### Lighting controls

Prefer a small number of intentional presets over raw intensity sliders. Candidate presets may include Standard, Bright, and High Contrast, but only ship presets that are visibly useful and tested across themes/cargo colors.

### Contact/depth

Prefer material response, edges, existing shadows, and floor relationships. Do not add fake geometry or aggressive AO/postprocessing that can imply nonexistent gaps or contacts.

### Grid

Keep the default grid restrained. Unit-aware precision-grid behavior belongs with later precision/measurement tooling unless a very small visual refinement is justified now.

### Gate

Test empty/light/dense/tall/stacked loads, multiple trailer types, dark/light, shadow fallback/restore, and 25/100/300 cases.

## 12. Pass 6 — Export Presentation Compatibility and Performance Closeout

### Objective

Make screenshots, thumbnails, and PDF scene captures reflect the professional editor without leaking editor-only helper state and without corrupting live renderer state.

### Helper classification

Introduce semantic grouping only when it now provides concrete behavior. At minimum, create/establish a `helpersGroup` (or equivalent explicit export classification) for editor-only objects such as the gizmo and CoG marker, and future snap/measurement handles.

Do **not** create a deep cargo/helpers/annotations hierarchy merely for architecture aesthetics.

### Export inclusion defaults

For this milestone:

Included by default:

- cargo;
- trailer/floor;
- case identity labels;
- operational warning presentation that belongs on the load plan.

Excluded by default:

- transform gizmo;
- hover-only helper state;
- CoG editor marker unless an explicit export mode asks for it;
- snap guides;
- temporary interaction handles;
- other editor-only helpers.

Grid remains controlled by existing/explicit export policy.

Future measurements get an explicit product-level include/exclude option when that feature is implemented.

### Capture contract

- save/restore every modified scene/renderer/camera state even on failure;
- do not assume CSS2D is captured;
- verify front-overhang/full authoritative extents in PDF camera framing;
- preserve existing capture lifecycle/billing/product guards.

### Performance closeout

Profile 1, 25, 100, and 300 cases on the same baseline hardware/browser.

Record at least:

- practical frame-rate/frame-time behavior;
- draw-call/resource growth where available;
- texture count/memory indicators where available;
- shadow impact;
- label impact;
- capture time/memory.

Acceptance policy: no unexplained material regression versus the established baseline. A sustained sub-30fps condition caused by the new presentation layer is not acceptable as the normal 300-case behavior on the baseline machine; the existing shadow fallback is a safety net, not a substitute for profiling.

## 13. Visual Foundation Exit Criteria

The milestone is complete only when all of the following are true:

- plain procedural boxes look intentionally designed rather than like default Three.js primitives;
- cargo state hierarchy is visually obvious and operational warnings are not accidentally hidden;
- labels are clean, crisp, export-safe, resource-safe, and usable on high-DPI displays;
- trailer/floor/walls/rails have a coherent professional visual language;
- scene depth is strong without glossy/game-like styling;
- shadows improve contact perception and remain performance-aware;
- visual preferences have one coherent normalized application path;
- screenshot/PDF/thumbnail capture does not leak editor-only helpers;
- all normal tests/typecheck/lint/build gates pass;
- representative manual interaction smoke passes;
- 1/25/100/300-case profiling has been recorded and reviewed;
- no authoritative geometry or Auto-Pack behavior changed as an accidental side effect.

### Visual acceptance language

The target should feel:

- modern;
- precise;
- industrial/logistics-specific;
- restrained;
- high-contrast where operationally useful;
- legible at normal working zoom;
- credible as professional software.

It should not feel:

- cartoonish;
- overly glossy;
- neon/game-like;
- noisy;
- dependent on photorealistic GLB assets to look good.

## 14. Standard Validation Gate Per Pass

Use the smallest gate appropriate to the pass, but before merge every pass must at minimum run the relevant subset of:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `git diff --check`

Visual/interaction passes additionally require browser smoke for:

- orbit/pan/zoom;
- select/hover;
- drag;
- rotate;
- collision rejection;
- snap behavior;
- delete/duplicate where affected;
- Auto-Pack smoke;
- screenshot/PDF where affected;
- light/dark theme where affected.

Do not rerun every expensive manual matrix for a tiny isolated code-only fix, but do not merge a visual/interaction pass based only on unit tests.

## 15. Consolidated Do-Not-Break Contract

Every implementation prompt in this phase must preserve these invariants unless a separately approved task explicitly changes one:

1. Authoritative dimensions, oriented dimensions, position, rotation, supports, usable zones, and blocked zones remain canonical logistics data, not rendered-mesh-derived data.
2. `WORLD` conversion remains a presentation/editor boundary; stored packing truth stays in canonical units.
3. Decorative mesh/GLB bounds, labels, Sprite bounds, bevels, shadows, lines, and transparency never become collision, Auto-Pack, containment, support, stacking, snapping, or measurement truth by default.
4. Existing collision-safe validation still decides whether a placement commits.
5. Labels/helpers never enlarge the authoritative envelope.
6. New labels/helpers are excluded from cargo raycast/pick arrays unless intentionally designed as controls.
7. `resolveCaseVisualState()` remains the single deterministic visual-state owner.
8. Cached resources have one explicit owner and are disposed only after their final user releases them.
9. Materials/geometries/textures/render targets/listeners/controls/annotations have explicit cleanup.
10. Trailer styling never changes trailer dimensions, orientation convention, usable zones, wheel wells, front-overhang deck, or cab void.
11. Preferences use declared normalized schema and central application; no new bespoke localStorage keys.
12. Session editor state, global user preferences, and project data remain separate.
13. Preference changes do not silently enter load undo/redo.
14. Editor-only helpers are excluded from exports unless explicitly included.
15. Export restores all mutated renderer/scene/camera state even on error.
16. Orbit/pan/zoom remains available through existing operation lifecycle behavior.
17. Direct Three.js/WebGLRenderer remains.
18. No React/R3F, WebGPU, framework rewrite, or packing-engine rewrite is implied by this phase.
19. Technical-box visual fallback remains available for all future assets.
20. Performance is measured before large rendering optimizations are introduced.

## 16. Deferred Hardening Required Before Later Precision/GLB Work

These are important but should not derail the current Visual Foundation unless current work touches them directly:

### Trailer-zone parity

Before measurement or advanced snapping depends on trailer feature planes, add a focused parity matrix comparing `PackLibrary.getTrailerUsableZones()` and `TrailerGeometry.getTrailerUsableZones()` across supported trailer configurations. If the two implementations diverge, treat that as a separate geometry-hardening issue. Do not casually consolidate operational geometry inside a visual pass.

### Interaction teardown

Before adding measurement/tool arbitration, address missing teardown/pointer-cancel behavior and establish a clear active-tool/input-owner model.

### Picking proxy for GLB

Before future GLB models become interactive visual representations, define a stable pick-proxy/visual-entity contract so detailed visual mesh topology never silently becomes the operational pick/collision envelope.

## 17. Next Milestone — Camera/View System

Camera/View work begins only after Visual Foundation exit criteria are met.

Target scope:

- explicit active-camera ownership;
- named Front/Rear/Left/Right/Top views;
- orthographic live views;
- separate free Perspective view;
- orthographic Isometric as the default CAD-style isometric, with perspective remaining a separate mode;
- Fit Trailer / Fit Load / Fit Selection;
- smooth, reduced-motion-aware transitions;
- consistent resize/raycast/drag behavior under supported projections;
- shared framing math with export where appropriate.

Crew/Loader View is not just another camera preset until workflow semantics are defined. Defer it until loading direction, eye height/FOV, stop/unload behavior, cutaway/clipping, and operator purpose are agreed.

## 18. Later Precision Tooling

After Camera/View and the annotation/export contracts are stable:

- semantic snap results and visible snap guides;
- point-to-point measurements;
- X/Y/Z gap measurements;
- endpoint snapping to authoritative features;
- dimension lines/arrows/labels;
- later persistent measurement policy if product value justifies it.

Initial measurements should be session-only. Persistence, undo behavior, and export inclusion are later explicit product decisions.

## 19. Later GLB / Asset Work

Do not wait for GLBs to achieve professional visual quality. Procedural boxes, crates, drums, pallets, trailer structure, racks, and simple industrial forms can be produced efficiently in-app.

Use GLB for complex forms where silhouette/detail matters. Future model production may use curated assets, conventional modeling, or AI-assisted generation, but every model must be optimized and remain visually subordinate to the authoritative packing envelope.

A representative GLB spike must precede any asset library. Profile simple/medium/complex models at repeated counts and validate scale/orientation/material/texture/compression/disposal/picking behavior before production rollout.

## 20. Product Decisions — Reduced to the Items That Actually Need Product Input

These decisions do **not** block Pass 1. They should be resolved before the pass that consumes them.

### Before Pass 2/3

1. **Default case label density/content.** Recommended starting point: case name plus one operational identifier; add weight/dimensions/stop/sequence only when relevant or at a richer density mode.
2. **Category color intensity.** Recommended: restrained body tint/accent, not saturated full-body color that competes with warnings.
3. **Warning overlap behavior.** Recommended: collision and OOG/warning remain visible even when selected; selection is layered rather than masking warning semantics.

### Before Pass 5

4. **Shadow preference surface.** Recommended: saved requested setting plus automatic effective fallback; start with Off/Standard and only expose High if profiling supports it.

### Before Camera/Precision milestones

5. **Canvas units.** Approve the display-unit set for annotations, especially mm alongside existing inch/foot formatting.
6. **Crew View semantics.** Define actual operator workflow before implementation.

Everything else should be treated as an engineering decision or deferred feature decision rather than blocking the current phase.

## 21. Recommended Branch / Delivery Sequence

Use one active branch at a time and merge sequentially:

1. documentation/dependency baseline cleanup;
2. `fix/editor-visual-resource-ownership`;
3. `feat/editor-cargo-visual-language`;
4. `feat/editor-typography-foundation`;
5. `feat/editor-trailer-visual-foundation`;
6. `feat/editor-lighting-shadow-foundation`;
7. `fix/editor-export-visual-parity`;
8. milestone closeout/performance report;
9. then begin Camera/View System on a new branch.

Names are suggestions; keep the one-active-branch rule more important than exact naming.

## 22. Immediate First Task

The first implementation task under this contract is:

> **Correct Cargo Visual Resource Ownership Without Intended Visual Change**

Acceptance:

- reproduce the current shared-texture premature-disposal condition;
- correct cache identity and ownership;
- ensure deleting one of multiple cases sharing the same visual resource cannot invalidate the remaining case;
- preserve transforms, selection, raycasting membership, collision, snapping, packing, and exports;
- add focused regression coverage;
- pass normal validation;
- no typography redesign, preferences redesign, trailer work, camera work, or visual restyling in the same patch.

Only after this pass is merged and stable does the visible visual transformation begin.

## 23. Final Contract Verdict

The reconciled architecture is **hybrid, Codex-leaning on correctness/sequencing and Claude-leaning on visual-system reuse and existing renderer strengths**.

The phase should proceed in this order:

**resource correctness → cargo visual language → typography/annotations → trailer/floor/preferences → lighting/shadows/grid → export/performance closeout → Camera/View next → precision tooling later → GLB/asset work later.**

This sequence maximizes early visible improvement without building new presentation systems on top of known lifecycle defects, and it preserves the central Truck Packer principle: **visual sophistication may evolve aggressively; logistics truth must remain stable and authoritative.**
