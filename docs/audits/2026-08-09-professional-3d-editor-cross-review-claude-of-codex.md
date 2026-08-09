> Audit source: Claude Code
> Audit date: 2026-08-09
> Mode: Read-only cross-review of a peer audit (Codex). No product code, tests, or dependencies modified.
> Historical snapshot: This file preserves the cross-review as originally produced. Baseline versions, SHAs, and findings reflect the repository state at review time and are not automatically updated.

# Truck Packer 3D
# Claude Cross-Review of Codex Professional 3D Editor Audit

## 1. Review Baseline

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `a129c0aa1213dad4de3c8a4482b5aed7a388dd1b` (unchanged since both original audits) |
| Working tree | Clean (`## main...origin/main`); only the two prior audit files plus this new file are untracked |
| Files reviewed in full | `docs/audits/2026-08-09-professional-3d-editor-master-audit-codex.md` (1,292 lines), `docs/audits/2026-08-09-professional-3d-editor-master-audit-claude.md` (365 lines, my own prior audit, already in-session context) |
| Roadmap re-checked | `docs/product/TP3D-MASTER-TODO-V6.md` lines 55-107 — wording unchanged from both original audits |
| Queries used | `bash tools/project-memory query "why does trailer-geometry.js duplicate pack-library.js zone calculations"` — returned only a same-day generic "visual models stay separate from authoritative geometry" decision note, no prior rationale for the specific duplication found below |
| Graphify | Not used for this review. Both prior audits already produced detailed, source-cited architecture maps; the open questions here were falsifiable claims (does X exist at path Y, does function Z do W) best resolved by direct `grep`/`Read` against current source, not graph traversal |
| Direct source verification performed | `buildSignature()`, `acquireTextures()`/`releaseTextures()`, `disposeGroup()`, `src/packing-core/orientation.js`, `pack-library.js` `getTrailerUsableZones()` vs `src/editor/trailer-geometry.js` `getTrailerUsableZones()`, `renderCameraToDataUrl()`, `showLabels` grep, `npm ls vite` |
| Tests/lint | Not re-run — no source changed since my original audit's run (1360/1365 pass, 0 lint errors), and Codex's own baseline table reports the same test result plus a lint/typecheck pass I hadn't separately run |

## 2. Overall Assessment of Codex Audit

Codex's audit is **materially stronger on resource-lifecycle correctness and export-integrity analysis**, and weaker on file-path precision. It found — and I verified as real — a correctness class of bug (incomplete cache signature, ambiguous texture disposal) that my own audit characterized as sound ("ref-counted... consistently applied," Section P of my original audit). Codex was also more careful about the CSS2D-vs-Sprite distinction and about export-leakage of live scene helpers (gizmo, CoG marker), both of which I under-specified.

Where Codex is weaker: several of its file citations point to paths that don't exist (`src/services/packing-core/*.js` — the real path is `src/packing-core/*.js`, no `services/` segment), and its Section C ownership table lists "Orientation-aware dimensions" as owned by `packing-core/orientation.js`, which is accurate as a *consumer-facing entry point* but undersells that the file is an 18-line re-export shim — the actual math still lives in `src/core/oriented-dims.js`, exactly as my original audit stated. A reader following only Codex's citations would be misdirected on both counts.

Net assessment: Codex's *sequencing instinct* (fix the resource contract before restyling) is more defensible than mine turned out to be, and this review's own verification work strengthens that case further than Codex's own audit did — see Section 6 and the disposal bug in Section 4.

## 3. Confirmed Agreement

| Finding | Source evidence | Confidence | Recommended treatment |
|---|---|---|---|
| Authoritative packing geometry (inches, `PackLibrary`/`packing-core`) is correctly separated from visual/rendered geometry | Both audits traced this independently; confirmed again in this review via `pack-library.js` and `trailer-geometry.js` reads | High | KEEP as the foundational invariant |
| No renderer rewrite, no React/R3F, no WebGPU is warranted | Both audits state this explicitly and independently | High | Accept as settled |
| `resolveCaseVisualState()` central precedence resolver is the right pattern to extend, not replace | Both audits cite the same function (`editor-screen.js:94-131` per my audit / `:89` per Codex's — off-by-a-few-lines citation, same function) | High | Extend the priority chain; do not add parallel state-setting paths |
| No camera-preset system exists; PDF's `buildOrthoCameras()` is export-only and not reusable as-is for a live editor camera | Both audits independently confirmed via `app.js` reads | High | Camera/View System stays roadmap item #2, after Visual Foundation |
| `labelFontSize` is a confirmed no-op — written by Settings, read nowhere in the renderer | Both audits found this independently via grep | High | Wire it up or remove it explicitly during the resource-contract fix |
| Trailer visual meshes are not raycast targets, so trailer restyling is picking-safe | Both audits confirmed this | High | Proceed with trailer visual work without interaction-layer risk |
| Screenshot/PDF capture shares one renderer path (`renderCameraToDataUrl()`), forces DPR 1, and restores state | Both audits cite the same function | High | KEEP the save/restore pattern; extend its inclusion/exclusion policy (Section 16) |
| Measurement tool and Crew/Loader view do not exist in code today — planning-doc only | Both audits confirmed via grep across `src/` | High | Treat as architectural gaps, not partial implementations |

## 4. Codex Findings Claude Missed

1. **Vite version drift is real and currently live.** `npm ls vite` reports `vite@8.2.1 invalid: "8.2.0" from the root project` — the installed version does not match the exact pin in `package.json`. I reported "Vite 8.2.0" in my baseline table as if it were both declared and installed; it is only declared. This is a legitimate, verifiable finding I missed entirely.
2. **The cargo visual-resource cache signature is incomplete**, and I verified this is worse than Codex's own framing suggests — see Section 6. Codex's instinct to flag this ahead of any label-architecture redesign is now strongly evidenced.
3. **CSS2DRenderer is not viable for export-critical labels** because the current WebGLRenderTarget-based screenshot/PDF path only captures WebGL scene content — a DOM-based CSS2D label would never appear in a screenshot or PDF. My original audit's Section G recommendation ("Sprite-based ... or a lightweight CSS2DRenderer overlay") treated these as roughly interchangeable options; Codex is right that they are not, and this materially changes the typography recommendation (Section 10).
4. **Export can leak live editor-only scene state (gizmo, CoG marker, selection).** I confirmed this by reading `renderCameraToDataUrl()` in full: it only special-cases `grid` (`options.hideGrid`). Nothing in the export path hides the gizmo group or the CoG marker, both of which are real children of the main `scene` object (`gizmoGroup` added once in `editor-screen.js`; `cogMarker` added via `scene.add(cogMarker)` in `scene-runtime.js`'s `updateCoG()`). If a case is selected or CoG display is on when a screenshot/PDF is generated, those helper objects would render into the export. My original Section R only discussed grid handling and did not extend the observation to other helpers.
5. **Trailer-zone calculations are genuinely duplicated**, not just conceptually similar — see Section 6 for the verified detail. My original audit treated `trailer-geometry.js` as simply "the" authoritative-adjacent visual module without checking whether another independent implementation existed elsewhere.
6. **`renderQuality` and `showShadows` need reconciliation before adding more quality/preset preferences** — Codex explicitly calls out the risk of three overlapping "quality" concepts (`renderQuality`, shadow quality, lighting preset) with unclear ownership. My audit flagged these as individually dead but didn't flag the *combinatorial* naming-collision risk if all three get wired up independently later.
7. **Existing `resolveCaseVisualState()` precedence makes selection outrank out-of-gauge visibility**, which Codex correctly flags as a product decision (a safety/placement warning could become invisible once a case is selected), not just an implementation note. My audit mentioned the precedence chain but did not flag the safety implication as a decision the product owner should explicitly confirm.
8. **Millimeters have real unit-conversion support in display helpers but are excluded from the preference allow-list/UI.** I didn't check this; Codex's framing (adding mm is a preference/UI change, not new geometry-conversion work) is a useful, narrow scoping note worth keeping.

## 5. Claude Findings Codex Missed

1. **`PreferencesManager` is dead code inside `scene-runtime.js`.** It's injected as a constructor parameter (`PreferencesManager: _PreferencesManager`, underscore-prefixed per this codebase's unused-parameter convention) and never called anywhere in the file — confirmed by grep, zero other references. Codex's Section O treats `PreferencesManager` as the correct pattern to route new preferences through (which is right for the *write* side and for `editor-screen.js` consumers) but doesn't note that `scene-runtime.js` specifically has no working read path today despite looking like it does. Any new trailer/lighting preference needs this wiring built from scratch in `scene-runtime.js`, not merely "used."
2. **A specific settings-overlay dead-code block**: `settings-overlay.js:4774` sets `const showShadowControls = false;`, permanently disabling an already-built shadow-status UI block. Codex's audit discusses the `showShadows` preference being unwired but doesn't call out that a corresponding UI was actually built and then explicitly turned off — useful context for anyone deciding whether to resurrect or delete it.
3. **One confirmed `localStorage` bypass precedent to avoid repeating**: `editor-screen.js` persists the case-browser filter-panel visibility directly via `window.localStorage`, completely outside `PreferencesManager`/`StateStore`/normalization/export. This is a concrete existing anti-pattern; Codex's Section O recommends "do not create individual localStorage keys" in the abstract but doesn't cite that one already exists as a caution against following it as precedent.
4. **The perf-mode/shadow-toggle interaction has an existing, working UX pattern worth reusing**: `scene-runtime.js`'s `updatePerf()` already auto-disables shadows after 5s of sub-30fps and shows a toast with a "Restore" action. Codex's Section K recommendation (session-only fallback that must not overwrite the saved preference) is the right requirement, and this existing mechanism is very close to already satisfying it — it just isn't yet connected to a persisted preference. Worth citing as the concrete piece of code to extend rather than design from scratch.
5. **Test-coverage classification by area** (from my original audit, Section T's antecedent research): collision, snap-wall-sourcing, and the selection/hover/OOG/collision material-ownership state machine are under strong characterization-test coverage; `CanvasTexture`/label generation has **zero** test coverage; camera has almost no coverage. Codex's audit discusses risks per-subsystem but doesn't give this concrete a picture of which subsystems already have a regression net and which don't — this materially affects how cautiously each pass in Section 18 below should proceed.
6. **The specific roadmap-quoted dependency chain**: `TP3D-MASTER-TODO-V6.md` explicitly states Camera/View System depends on Visual Foundation landing first, and Heatmap/PDF-redesign explicitly depend on Camera/View landing first — I quoted this chain directly from the roadmap doc in my original audit. Codex's Section W sequencing is compatible with this but doesn't cite the roadmap's own dependency language as corroboration.

## 6. Disagreements

### Topic: Severity of the cargo visual-resource/cache-signature issue

**Codex position:** "Cargo visual resource identity is incomplete: the cache signature omits visual inputs such as shape and label content, allowing stale geometry or labels" (Executive Summary, risk #3) — framed as a correctness issue requiring fixing before further label work, but not further diagnosed beyond the signature itself.

**Claude original position:** My audit's Section F said texture regeneration was "good for perf... only rebuilds when the case-type/dims/color signature changes" and Section P said disposal was "solid," "ref-counted," with "no console/lint-detectable leaks... appear consistently applied." I treated the caching system as sound.

**Current source evidence:**
```js
// editor-screen.js — buildSignature()
function buildSignature(inst, caseData) {
  const d = caseData.dimensions || { length: 0, width: 0, height: 0 };
  const catColor = CategoryService.meta(caseData.category).color;
  const color = String(catColor || caseData.color || '#ff9f1c');
  return `${caseData.id}:${d.length}x${d.width}x${d.height}:${color}`;
}
```
Confirmed: shape (`box` vs `cylinder`), the case name/weight text baked into the label textures, and any future label-affecting preference are **not** part of the signature. A case-name edit with unchanged id/dims/color will not regenerate its texture.

More importantly, I traced the *disposal* path, which neither audit's original text fully diagnosed:
```js
// acquireTextures(): cache HIT returns the SAME array object by reference
if (cached) { cached.count += 1; return cached.textures; }

// disposeGroup():
releaseEdgeGeometry(group.userData.signature);
releaseTextures(group.userData.signature);   // ref-counted: only disposes at count 0
scene.remove(group);
group.traverse(obj => {
  ...
  if (obj.material) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => {
      if (m.map && m.map.dispose) m.map.dispose();   // UNCONDITIONAL — ignores the refcount just checked above
      if (m.dispose) m.dispose();
    });
  }
});
```
Because `acquireTextures` hands out the *same* six `CanvasTexture` objects (by reference) to every instance sharing a signature, and `disposeGroup`'s traversal unconditionally calls `.dispose()` on every material's `.map`, **deleting one of two-or-more identical-signature case instances disposes the shared WebGL texture out from under the instance(s) that remain** — even though `releaseTextures()` just correctly decided the resource should stay alive. The remaining case(s) keep a reference to a disposed texture and will render with broken/blank face textures. This reproduces with nothing more exotic than: add two identical cases (same case id, same dimensions, same/no override color), delete one.

**Cross-review verdict:** Codex is right that this is a correctness issue and right to sequence a fix ahead of label-architecture replacement. My original audit's "KEEP, solid" verdict on disposal was wrong and is corrected in Section 7 below. The bug is more specific and more severe than either audit's prose captured: it is not merely "ambiguous ownership," it is an unconditional double-release that only manifests when two or more cases share a signature — a very common real-world case (duplicate case types are routine in a load plan).

**Recommended approach:** Fix `disposeGroup()`'s traversal to mirror the pattern it already uses for cached edge geometry (`if (!cachedKey) obj.geometry.dispose()`): skip `.dispose()` on any material `.map` whose disposal is already owned by the ref-counted `textureCache` (i.e., materials created from `acquireTextures()`), and rely solely on `releaseTextures()` for that resource class. Extend `buildSignature()` to include shape and any label-affecting field before or alongside this fix — both are small, targeted, and should land together as the very first implementation pass (Section 22).

### Topic: Trailer-zone formula duplication — how serious, and where exactly

**Codex position:** "Trailer-zone calculations are duplicated between visual/trailer helpers and authoritative packing code" (Executive Summary, risk #2), citing `trailer-geometry.js:53` and `pack-library.js:179`, calling it a "drift hazard," recommending the visual module eventually consume authoritative zone descriptions instead of reproducing them, as a dedicated compatibility change.

**Claude original position:** My audit treated `src/editor/trailer-geometry.js` as *the* authoritative-adjacent zone-math module (Section E: "Authoritative: `trailer-geometry.js` (inch-space zones)... None of these import THREE or touch a mesh") without checking whether a second, independent implementation existed elsewhere. I did not identify this as a duplication risk at all.

**Current source evidence:** Both are real, independently written functions, not one importing the other:
- `pack-library.js:179` — module-private `function getTrailerUsableZones(truck) { ... }`, exported later in the file's returned object, extensively covered by `security-and-invariants.spec.mjs` (20+ call sites, always via `PackLibrary.getTrailerUsableZones(...)`).
- `src/editor/trailer-geometry.js:53` — `createTrailerGeometry({...})`'s `getTrailerUsableZones(truck)`, a separately-written function with near-identical comments and logic (same `rect`/`wheelWells`/`frontBonus` branches, same formulas), consumed by `AutoPackEngine` (`autopack-engine.js:830`, `TrailerGeometry.getTrailerUsableZones(truck)`), `scene-runtime.js` (visual rendering), and `editor-screen.js` (live drag/collision/snap checks) — all via one shared `TrailerGeometry` instance injected from `app.js:1347`.

This means **AutoPack's own packing validation, live drag-collision, and snap-wall sourcing all run through the `trailer-geometry.js` copy**, not the `pack-library.js` copy — while `pack-library.js`'s manual-revalidation and import/normalize logic use its *own* internal copy. `security-and-invariants.spec.mjs` line 7437 explicitly asserts (via source-text regex) "`A1-R6 must continue using TrailerGeometry as the single usable-zone source`" for `autopack-engine.js` — i.e., the test suite is aware there are two possible sources and deliberately locks AutoPack to one of them, but nothing in the test suite cross-validates that the two implementations agree for arbitrary truck configs. One test fixture (`security-and-invariants.spec.mjs:8660`) even passes `TrailerGeometry: PackLibrary` as a stand-in, confirming the two are treated as duck-type-interchangeable by the test authors, not as one delegating to the other.

**Cross-review verdict:** Codex found a real issue and I initially missed it, but Codex's own citations (`src/services/packing-core/...`) are wrong paths (correct path is `src/packing-core/...`, no `services/` segment), and Codex didn't identify *which* consumers use which copy — a materially important detail, since it means the copy consumed by AutoPack/live-interaction is the one that would need to change first if a bug fix only touched `pack-library.js`, or vice versa. This duplication is a data-integrity risk that predates Visual Foundation and is somewhat orthogonal to it, but Visual Foundation work that touches zone-derived features (grid/spatial reference, snap guides, future measurement anchoring) will build directly on top of whichever copy it reads from, making now the right time to at least document (if not yet consolidate) which copy is authoritative for which caller.

**Recommended approach:** Do not attempt consolidation as part of Visual Foundation (too large, too risky, orthogonal to visual work, no test currently proves they've diverged). Instead: (1) add one cross-parity test that runs both `PackLibrary.getTrailerUsableZones()` and `TrailerGeometry.getTrailerUsableZones()` against the same matrix of truck configs (`rect`/`wheelWells`/`frontBonus`, several dimension sets) and asserts identical output — cheap, fast, closes the drift-detection gap immediately. (2) File the actual consolidation as a separate, explicitly-scoped technical-debt item outside this roadmap phase, per the project's own working rule against mixing refactors with feature work.

### Topic: Typography architecture — Sprite vs CSS2D vs staying with baked face textures

**Codex position:** Reject CSS2D as the primary architecture for export-critical labels (WebGL-only capture can't see DOM). Keep CanvasTexture as the rasterization mechanism. Split by *purpose*: physically-mounted surface labels stay as depth-tested CanvasTexture planes/face materials; camera-facing measurements/annotations use Sprites. Both share one cache/resource service with a much richer cache key (content, semantic type, font, units/value, plate style, resolution tier, DPR, color mode, orientation/face, density preference).

**Claude original position:** My audit's Section G recommended "screen-space-independent Sprite-based labels (or a lightweight CSS2DRenderer overlay for text-heavy elements like dimension callouts), decoupled from the box-face material" — treating Sprite and CSS2D as roughly interchangeable alternative implementations of the same idea, and recommending case-identity labels themselves move to this Sprite/CSS2D layer.

**Current source evidence:** `renderCameraToDataUrl()` renders via `renderer.readRenderTargetPixels()` against a `THREE.WebGLRenderTarget` — this only contains whatever `renderer.render(scene, camera)` draws, i.e., WebGL scene graph content. A `CSS2DRenderer` label is a `<div>` positioned over the canvas by a separate DOM-manipulation renderer entirely outside the WebGL pipeline; it would never appear in a `WebGLRenderTarget` capture. Since case identity labels currently *do* appear in exported screenshots/PDFs (by construction, since they're baked into WebGL face materials), moving them to CSS2D would silently break export parity — a regression neither this feature nor Section R of my own audit would have caught if implemented as originally worded.

**Cross-review verdict:** Codex is right, and more precisely right than "reject CSS2D" alone — Codex's finer split (surface-mounted vs. camera-facing, both WebGL) is better architecture than my original binary Sprite-or-CSS2D framing. However, Codex doesn't fully resolve *whether the current case-identity labels should move off the box body material* — it says surface labels "remain depth-tested CanvasTexture planes **or** face materials," without deciding between staying baked into the box's own material (today's approach) versus becoming a separate, dedicated label-plane mesh mounted on the case surface.

**Recommended approach (third option, converging both):** Move case-identity labels off the box *body* material onto a dedicated, thin label-plane mesh (still `CanvasTexture`-backed, still depth-tested, still physically mounted on the case surface, still WebGL and therefore still export-safe) — decoupling "what color/texture is this box's body" from "what text identifies this box," which also directly resolves the double-free bug's most likely future recurrence site (a shared body-material texture that also carries text would keep tangling body-color caching with text-content caching). Camera-facing elements that are inherently not physically mounted — measurement dimension text, distance callouts, future stop/sequence emphasis — use Sprites, per Codex. Do not introduce CSS2D into this codebase for anything that must appear in an export; if a future, purely-interactive-only overlay (e.g., a debug HUD) ever wants CSS2D, that's a separate, explicitly export-excluded decision, not part of Visual Foundation.

### Topic: Implementation sequencing — visual-first vs. resource-contract-first

**Codex position:** Pass 0 (baseline/acceptance) → Pass 1 (cargo visual-resource contract: fix cache/signature, texture ownership, wire `showLabels`/`labelFontSize`) → Pass 2 (professional cargo visual language) → Pass 3 (typography foundation) → Pass 4 (trailer/spatial) → Pass 5 (lighting/shadows/contact) → Pass 6 (camera foundation) → Pass 7 (export parity) → Pass 8 (precision overlays).

**Claude original position:** Scene-hierarchy scaffolding → material/state extension → typography system (full Sprite/CSS2D redesign) → trailer visuals + preferences wiring → contact/depth cues → export re-verification → (then Camera/View System as a separate roadmap phase).

**Current source evidence:** The verified double-free disposal bug (Section 6, topic 1) sits directly underneath *any* work that touches case materials/textures — including my own Section F "material/state extension" pass (step 2) and Section G "typography system" pass (step 3). Building a new Sprite-based label cache (my original Pass 3) on top of an un-fixed `disposeGroup()` would very likely reproduce the same double-free pattern in the new label cache, just with different resource names. This is concrete, not speculative — I traced the exact code path.

**Cross-review verdict:** Codex's sequencing is better supported by evidence than mine, specifically on the question of *what comes first*. My sequencing's error was starting substantive material/typography work before validating the resource-lifecycle primitives (signature completeness, disposal correctness) those passes will inherit and multiply. That said, Codex's own 9-pass sequence is more granular than the evidence requires — Section U of Codex's audit and my own reading agree the disposal/signature bug is narrowly scoped (`buildSignature()` + `disposeGroup()`, both in `editor-screen.js`, no geometry/collision/AutoPack involvement), so it does not need a full "Pass 1" the size Codex describes (which also folds in wiring `showLabels`/`labelFontSize` and "establish one clear owner" as a broader ownership audit).

**Recommended approach:** Split Codex's Pass 1 into two: a tiny, mechanical **Pass 0.5** (fix `buildSignature()` completeness + `disposeGroup()`'s double-free — a well-bounded bug fix, hours not days) done *before* any visual/material work, and fold "wire `showLabels`/`labelFontSize`" into whichever later pass actually changes label rendering (my original Pass 3 / Codex's Pass 3), since wiring a preference that controls behavior which is about to be rebuilt is wasted effort if done twice. See Section 18 for the full converged sequence.

### Topic: Scene hierarchy — is a semantic-roots refactor worth doing now?

**Codex position:** Recommends a fairly deep hierarchy (`scene → environmentRoot/trailerRoot/cargoRoot → cargoEntity → {interactionProxy, visualRoot, labelRoot, stateOverlayRoot} / helperRoot → {gizmoRoot, snapGuideRoot, measurementRoot, annotationRoot} / exportOverlayRoot`), explicitly framed as introducible gradually.

**Claude original position:** Recommended three light parent groups (`cargoGroup`, `helpersGroup`, `annotationsGroup`) as "organizational scaffold," explicitly not urgent — "if the benefit is too small, say not to add it yet" was the framing this review was asked to re-apply.

**Current source evidence:** The confirmed export-leakage risk (Section 4, item 4 — gizmo and CoG marker are un-hidden `scene` children with no export exclusion) is a concrete, present-day bug class that a single `helpersGroup` (gizmo + CoG + future snap-guides/measurement handles) would directly fix with one `helpersGroup.visible = false` call inside `renderCameraToDataUrl()`, mirroring the existing `hideGrid` pattern exactly.

**Cross-review verdict:** Neither original depth is quite right. Codex's full nested tree is over-engineered for what's actually blocking anything right now — most of its nodes (`interactionProxy`, `labelRoot`, `stateOverlayRoot` per-cargo-entity) presuppose architecture decisions (label redesign, GLB proxy) that haven't been made yet, and building the scaffold before those decisions risks having to restructure it again. My original "too small to bother yet" verdict undersold the concrete, already-diagnosable export-leakage value.

**Recommended approach:** Add exactly one new group now — `helpersGroup` (gizmo + CoG marker, and later snap-guides/measurement handles) — parented at the scene root, with `renderCameraToDataUrl()` extended to hide it alongside `grid` during capture. Do not build `cargoGroup`/`annotationsGroup`/the full cargo-entity nested tree yet; defer those specifically until the label-plane decision (Section 10) and any GLB-proxy decision are made, since those decisions determine what actually needs to nest under a cargo entity.

## 7. Corrections to Claude's Original Audit

1. **Section P ("Resource disposal... no console/lint-detectable leaks... consistently applied") was wrong.** There is a verified double-free/premature-dispose bug in `disposeGroup()` affecting any two or more case instances sharing a signature. Corrected in Section 6 above.
2. **Section G's "Sprite-based labels (or a lightweight CSS2DRenderer overlay)" framing was imprecise.** CSS2D is not export-compatible with the current WebGL-only capture path and should not have been offered as an interchangeable option for anything that needs to appear in a screenshot or PDF — which today includes case identity labels themselves. Corrected in Section 6/10.
3. **Section B's baseline table reported "Vite 8.2.0" without checking installed-vs-declared drift.** The installed version (`8.2.1`) is flagged invalid by npm relative to the exact pin. This should have been caught and wasn't.
4. **Section R implicitly under-scoped export leakage to grid-only.** I documented that `hideGrid` is the only special-cased export exclusion but did not extend that observation to the gizmo/CoG marker, which are equally un-excluded and equally real `scene` children. Corrected in Section 4/16.
5. **Section E did not check for a duplicate `getTrailerUsableZones()` implementation.** I described `trailer-geometry.js` as the authoritative-adjacent zone module without verifying whether `pack-library.js` (or elsewhere) independently reimplements the same math. It does. Corrected in Section 6.
6. **Minor:** my Section C line-number citations for `resolveCaseVisualState()` (L94-131) and Codex's (L89) both point at the same function; the discrepancy is citation drift, not disagreement — worth reconciling to one number before this material becomes an implementation prompt.

## 8. Corrections to Codex Audit

1. **File-path errors**: `src/services/packing-core/wheel-well-model.js`, `src/services/packing-core/orientation.js`, `src/services/packing-core/validation.js` do not exist at those paths. The correct path is `src/packing-core/*.js` — no `services/` segment. All three files do exist and are correctly described in substance; only the path prefix is wrong. This matters because these citations would be pasted directly into implementation prompts per this project's stated downstream use.
2. **`packing-core/orientation.js` is a barrel/re-export shim, not an independent implementation.** Its entire content is `export { canonicalOrientationLock } from '../core/orientation.js'`, `export { RIGHT_ANGLE_RAD, normalizeRightAngle, normalizeRightAngleRotation, getOrientedDimsForRotation } from '../core/oriented-dims.js'`, and `export { buildOrientationCandidates } from '../services/autopack-solver.js'` — 18 lines total, explicitly documented in its own header comment as existing so "packing-core consumers never reach into services/core modules directly." Codex's Section C ownership table lists it as if it were a primary owner of "orientation-aware dimensions," which could mislead a reader into thinking there are two independently-maintained orientation systems. There is one; this file only re-points to it.
3. **The trailer-zone duplication claim (Executive Summary risk #2) is under-specified relative to what's actually there** — it names both files correctly but doesn't identify that different runtime consumers (AutoPack + live interaction vs. `pack-library.js`'s own internal manual-revalidation/import logic) use different copies, which is the detail that determines what "consolidate" would actually require and who it would affect. See Section 6.
4. **Section T marks "Cargo edges" and "Selection styling"/"Hover styling"/"Collision styling" as `ALREADY IMPLEMENTED` without qualifying test-coverage depth.** My original audit's underlying research (not fully carried into the audit's own prose, but confirmed again in this review) found selection/hover/OOG/collision state-machine behavior is under strong characterization-test coverage, while `CanvasTexture`/label generation has zero test coverage — a materially different regression-risk profile between "already implemented, well-tested" and "already implemented, wire-it-and-hope." Worth folding into the readiness matrix rather than treating "ALREADY IMPLEMENTED" as a single confidence tier.
5. **The Executive Summary's mermaid-style architecture diagram** (`Canonical pack data → collision/validation → authoritative interaction proxy → decorative visual root / labels / overlays / export policy`) presents "authoritative interaction proxy" as if it already exists as a distinct architectural layer. It does not yet — today, `getRaycastMeshes()` returns the decorative visual mesh directly (Codex's own Section E correctly says this elsewhere: "Rendered mesh as picking truth... already semantically imperfect for cylinders"). The Executive Summary diagram should be labeled as the *target* architecture, not read as a description of current state; as written it's slightly inconsistent with Codex's own Section E.

## 9. Third Alternatives

1. **Neither audit's disposal fix scope is exactly right.** Codex bundles the fix into a broader "Pass 1" (cache signature + ownership + preference wiring); my own original audit didn't identify the bug at all. Better: a standalone, minimal Pass 0.5 (Section 6, sequencing topic; Section 18).
2. **Neither audit fully resolves whether case-identity labels stay on the box body material or move to a dedicated label-plane mesh** — Codex leaves it as an "or," my original audit incorrectly grouped it with screen-space Sprites. Better: dedicated label-plane mesh, still WebGL/CanvasTexture, still physically mounted (Section 6, typography topic; Section 10).
3. **Neither audit's scene-hierarchy depth is right** — Codex's is too deep for present decisions, mine was too shallow given the confirmed export-leakage bug. Better: exactly one new `helpersGroup` now, defer the rest (Section 6, hierarchy topic; Section 11).
4. **Neither audit proposes a concrete guard against the trailer-zone duplication actually diverging silently.** Better: one cheap cross-parity test between `PackLibrary.getTrailerUsableZones()` and `TrailerGeometry.getTrailerUsableZones()` across a config matrix, landed independently of the Visual Foundation phase (Section 6, duplication topic).

## 10. Typography / Annotation Verdict

Converged recommendation (supersedes both originals): **two techniques, one owner, no CSS2D for anything export-visible.**

- Physically-mounted case-identity labels move off the box body material onto a dedicated, thin `CanvasTexture`-backed label-plane mesh per case face that needs one — depth-tested, physically mounted, WebGL, therefore export-safe by construction. This also structurally prevents the double-free bug's likely recurrence site (a body material that also carries text content).
- Camera-facing, non-physically-mounted elements (measurement dimension text, future stop/sequence emphasis, distance callouts) use `THREE.Sprite`, per Codex's correct distinction.
- CSS2DRenderer is excluded entirely from anything that must appear in a screenshot or PDF — i.e., excluded from this phase's scope altogether, since every labeling need identified so far (case identity, measurements) is export-relevant.
- One shared cache/resource service for both, keyed on Codex's richer signature (content, semantic type, font, units/value, plate style, resolution tier, DPR, color mode, orientation/face, density preference) rather than the current `caseId:dims:color` signature.
- DPI-aware sizing (screen/render resolution, not physical case size in inches) — this was my original audit's one clearly-right, undisputed finding on labels, and both audits agree the current `Math.min(512, Math.max(64, dims.length * 4))` approach is wrong for legibility.

## 11. Scene Hierarchy Verdict

Add one new group now: `helpersGroup` (gizmo + CoG marker today; snap-guides and measurement handles later), parented at scene root. Wire `renderCameraToDataUrl()` to hide it during capture, mirroring the existing `hideGrid` pattern. Do not build Codex's full nested cargo-entity/annotation/export-overlay tree yet — those nodes presuppose the label-plane and future GLB-proxy decisions, which haven't been made. Do not leave the hierarchy as flat as my original audit implicitly endorsed, given the now-confirmed, concretely-fixable export-leakage risk.

## 12. Preferences Verdict

Use `StateStore.get('preferences')` for reads (matching the pattern already established in `editor-screen.js`, since `PreferencesManager.get()` is a correct but currently-bypassed convenience wrapper) and `PreferencesManager.set()` for writes (the pattern `settings-overlay.js` already uses). Any new visual preference needs: a key in `defaults.js`, a coercion rule in `normalizer.js`, and — specific to `scene-runtime.js` — a **new** read call, since the file's injected `PreferencesManager` parameter is confirmed dead and provides no existing wiring to build on despite appearances. Do not introduce a `subscribe()` mechanism; nothing in either audit's scope requires live cross-component reactivity beyond the existing render-on-state-change pattern. Reconcile `renderQuality`/`showShadows`/any future "shadow quality"/"lighting preset" naming into one non-overlapping preference model before wiring any of them, per Codex's Section O warning — this is a naming-collision risk worth resolving on paper before writing code, not during.

## 13. Measurement / Precision Tool Verdict

Separated per the requested A/B/C/D framing:

- **(A) Architecture needed now:** None beyond what already exists. Snap-to-authoritative-geometry (case AABB corners/edges via `getAabbWorld()`, trailer planes via `TrailerGeometry.getTrailerUsableZones()`) is already available and requires no new dependency.
- **(B) Implementation that can wait:** The full `MeasurementController`/`MeasurementQueryAdapter`/`MeasurementModel`/`MeasurementPresentation` subsystem Codex describes — this is genuinely new work, correctly scoped by Codex, and correctly deferred by the roadmap.
- **(C) Actual hard dependencies:** None on typography-the-full-service or on orthographic camera views. Measurement lines/labels need *some* line-rendering and *some* text-rendering technique, which can be built minimally for this feature and folded into the shared label service once it exists (Section 10) — not the reverse.
- **(D) Nice-to-have dependencies:** Orthographic Top/Front/Side views make measurement meaningfully more usable (precision work is easier without perspective distortion) and the shared label/Sprite service (once built per Section 10) avoids building a second, throwaway text-rendering path. Both are real quality improvements, neither is a blocker.

Net: the roadmap's deferral of measurement until after Camera/View System is a **product/scope decision**, not one architecture forces. Both audits' instinct to keep it deferred is still the right call for team-bandwidth and risk-sequencing reasons (Section 19-20), just not for the reason either audit stated (a hard technical dependency).

## 14. Trailer / Floor / Lighting Verdict

Both audits agree the trailer visual construction (`scene-runtime.js` `setTruck()`/`addTrailerVolume()`/`addBoxRails()`) is a solid, keep-as-is foundation, not raycast-coupled, safe to restyle. Confirmed again in this review. Codex's addition — that `setTruck()` uses an early-signature-exit, so live preference-driven color/opacity changes need a retained named-material registry rather than forcing a full geometry rebuild on every preference tweak — is correct and is a genuine gap my original audit didn't flag (I noted colors were hardcoded but didn't check whether the existing signature-exit path would silently no-op a color-only preference change). Adopt Codex's recommendation: identify and retain named semantic materials (floor, walls, rails, door/cab cues) so a future preference update can mutate `.color`/`.opacity` in place without going through `setTruck()`'s full rebuild path. Lighting/shadow pipeline: both audits agree KEEP the current renderer/lighting config as the baseline; converge on wiring the existing `toggleShadows()`/low-FPS-fallback mechanism (Finding 5, Section 5) into a persisted preference rather than building new preset infrastructure from scratch, consistent with both audits' "measure before adding InstancedMesh/postprocessing" caution.

## 15. Camera Boundary

Both audits agree, and this review confirms via source: **no live camera-preset system exists today.** Everything camera-related beyond the single `PerspectiveCamera` + `OrbitControls` + `focusOnWorldPoint()` tween belongs to roadmap item #2 (Camera/View System), not to Visual Foundation. The one exception both audits and the roadmap agree on: Visual Foundation should *not* build new camera code, but its export-parity work (Section 16) will touch the *existing* `buildOrthoCameras()` PDF-only cameras enough to fix their aspect/front-bonus framing risk — that fix is export-hygiene, not camera-system work, and should not be read as starting Camera/View System early.

## 16. Export/PDF Verdict

Converged findings, both confirmed via source in this review:
- `hideGrid` is the only existing export-exclusion mechanism. Gizmo and CoG marker are un-hidden, real `scene` children and can leak into a capture taken while a case is selected or CoG display is active.
- Orthographic PDF cameras (`buildOrthoCameras()`) may not correctly account for front-bonus/overhang extents in their framing (Codex's finding, not independently re-verified line-by-line in this review but consistent with the front-bonus visual-volume logic traced in my original Section J/E).
- Neither labels (today, baked into face materials) nor a future label-plane mesh (Section 10) need special export handling — both are WebGL scene content, captured by construction.
- Any future snap-guide or measurement overlay **does** need explicit export handling, via the new `helpersGroup` (Section 11).
Recommended fix, small and immediate: extend `renderCameraToDataUrl()`'s existing hide/restore pattern to include `helpersGroup.visible = false` alongside `grid`, in the same `try`/`finally`-style save-restore block that already exists for viewport/scissor/background state.

## 17. Performance Verdict

Both audits agree: no GPU/rendering bottleneck has been proven, all current concerns are structural estimates or theoretical, and neither InstancedMesh nor postprocessing should be adopted without a measured 1/25/100/300-case benchmark first. This review did not re-run or newly perform such a benchmark (would require a live browser session, out of scope for a read-only source audit). Adopt Codex's more detailed benchmark matrix (Section Q of the Codex audit: median/p95 frame time, draw calls, triangles, geometry/texture counts, JS heap, input-to-frame latency, export time, context-loss events, across shadows on/off, light/dark theme, perspective/orthographic, and interaction states) as the concrete measurement plan — it's more actionable than my original audit's looser "measure before optimizing" framing.

## 18. Recommended Final Implementation Order

**Pass 0 — Baseline lock** *(Codex's Pass 0, adopted as-is)*
- Objective: establish a measured, reproducible starting point.
- Visible user benefit: none directly; risk-reduction for every later pass.
- Architecture dependency: none.
- Likely files: none changed; new fixture/benchmark scripts only.
- Avoid: any product code change.
- Regression risk: none (read-only).
- Validation gate: fixtures for 1/25/100/300 cases exist and produce a recorded baseline (draw calls, frame time, texture count).
- Performance gate: this pass *is* the performance gate for everything after it.

**Pass 0.5 — Cargo visual-resource correctness fix** *(new — split out of Codex's Pass 1, based on the verified bug in Section 6)*
- Objective: fix `buildSignature()` completeness (shape, label-affecting content) and `disposeGroup()`'s unconditional texture disposal (the confirmed double-free).
- Visible user benefit: none visually new, but eliminates a real, reproducible bug (broken textures on duplicate cases after deletion).
- Architecture dependency: none — purely internal to `editor-screen.js`'s existing cache/disposal functions.
- Likely files: `src/screens/editor-screen.js` (`buildSignature`, `acquireTextures`, `disposeGroup`).
- Avoid: `geometry-factory.js`, `trailer-geometry.js`, `pack-library.js`, any collision/AutoPack code, any material/visual-language changes.
- Regression risk: low if scoped exactly to these two functions; add a targeted repro test (two same-signature instances, delete one, assert the other's texture is not disposed) before changing anything.
- Validation gate: new disposal test passes; existing `manual-vertical-placement.spec.mjs`/`security-and-invariants.spec.mjs` suites unaffected.

**Pass 1 — Cargo professional visual language** *(Codex's Pass 2, my original Pass 2, now correctly sequenced after 0.5)*
- Objective: restrained material tokens, category color as controlled accent rather than full-face color, refined structural edges, valid/invalid drag feedback without changing placement rules.
- Visible user benefit: immediately visible, high — this is the first pass that changes how the editor looks.
- Architecture dependency: Pass 0.5 (must not build new material handling on the unfixed cache/disposal path).
- Likely files: `src/screens/editor-screen.js` (`createInstanceGroup`, `resolveCaseVisualState`, material construction).
- Avoid: `trailer-geometry.js`, `geometry-factory.js`, collision functions, `autopack-*`.
- Regression risk: medium — touches the test-protected `resolveCaseVisualState()` precedence chain; extend its characterization tests for any new state channel rather than changing existing assertions.
- Validation gate: tightly-touching and stacked-load manual checks (per both audits' Section 21/Q); existing selection/hover/collision tests pass unmodified unless intentionally extended.

**Pass 2 — Typography foundation** *(converged per Section 10)*
- Objective: dedicated label-plane mesh for case identity, Sprite-based camera-facing annotation primitive, shared cache/resource service with the richer signature.
- Visible user benefit: high — legible, DPI-correct labels at all camera distances.
- Architecture dependency: Pass 0.5 (correct disposal ownership pattern to extend, not copy the bug into a new cache).
- Likely files: new `src/editor/case-labels.js` (or similar), `src/screens/editor-screen.js` (remove baked-in label text from face-texture generation, wire the new label-plane mesh), `src/core/defaults.js`/`normalizer.js` if `labelFontSize` is made functional here.
- Avoid: `trailer-geometry.js`, `oriented-dims.js`, `orientation.js`, collision functions, `app.js` `ExportService` (verify after, not during).
- Regression risk: medium — must not add label-plane meshes to `getRaycastMeshes()`/`getGizmoHandleMeshes()`.
- Validation gate: texture memory measured at 25/100/300 (Pass 0 baseline comparison); zero-coverage `CanvasTexture` test gap (Section 8, item 4) closed with at least cache-invalidation and disposal tests.

**Pass 3 — Semantic trailer and spatial-reference visuals** *(converged, incorporating Codex's named-material-registry finding, Section 14)*
- Objective: named/retained trailer materials (floor, walls, rails, cues) so preferences can mutate appearance without a full rebuild; restrained trailer-local grid; the one new `helpersGroup` (Section 11).
- Visible user benefit: high — trailer/floor/grid is a large fraction of perceived "generic demo vs. professional" quality.
- Architecture dependency: none new; independent of Pass 1/2, could run in parallel (Section 19).
- Likely files: `src/editor/scene-runtime.js` (`setTruck`, `addTrailerVolume`, `rebuildEnvironment`), `src/editor/trailer-geometry.js` untouched (zone math, not visuals).
- Avoid: `trailer-geometry.js`'s zone functions, `pack-library.js`, collision/snap logic.
- Regression risk: low — trailer meshes confirmed not raycast targets.
- Validation gate: truck-switch and all three shape modes (`rect`/`wheelWells`/`frontBonus`) visually re-verified; the cross-parity test from Section 6 (duplication topic) should exist by this point as an independent, small task.

**Pass 4 — Lighting, shadows, contact cues** *(Codex's Pass 5, my original Pass 5, largely unchanged)*
- Objective: wire the existing shadow toggle/perf-fallback into a persisted preference; refine contact/depth cues without implying false gaps between touching cases.
- Visible user benefit: medium-high, subtler than Pass 1/3.
- Architecture dependency: Pass 3 (named material registry makes lighting-preset wiring cleaner) but not strictly blocking.
- Likely files: `src/editor/scene-runtime.js` (`addLighting`, `updatePerf`, `toggleShadows`), `src/core/defaults.js`/`normalizer.js`, `src/ui/overlays/settings-overlay.js` (resurrect or replace the dead `showShadowControls` block — explicit decision, not silent).
- Avoid: geometry/collision code entirely.
- Regression risk: low.
- Validation gate: dark/light theme, lower-end-GPU manual check; confirm the auto-perf-mode override remains session-only and never overwrites the saved preference (Codex's explicit requirement).

**Pass 5 — Export parity** *(pulled earlier than both originals' placement, given the confirmed leakage bug)*
- Objective: extend `renderCameraToDataUrl()`'s hide/restore pattern to `helpersGroup`; fix orthographic PDF framing for front-bonus extents.
- Visible user benefit: medium — mostly a correctness fix (no more accidental gizmo-in-PDF), not a new visible feature.
- Architecture dependency: Pass 0.5 (label-plane meshes must already be WebGL-only, no CSS2D) and Pass 3 (`helpersGroup` must exist).
- Likely files: `src/app.js` (`ExportService`, `renderCameraToDataUrl`, `buildOrthoCameras`).
- Avoid: any change to what the *interactive* viewport renders — this pass only changes what capture excludes.
- Regression risk: low-medium — must verify existing PDF text-content tests (`quantity-controls-phase-1.spec.mjs`) still pass.
- Validation gate: screenshot/PDF re-verified for empty/light/dense/stacked loads with a case selected (the exact scenario that currently leaks).

**Pass 6 — Camera/View System** *(explicit roadmap item #2, not part of Visual Foundation; listed for sequencing completeness)*
- Objective: per both audits' Section L, live camera/view controller, preset family, Crew/Loader view.
- Architecture dependency: Passes 0-5 complete (typography and export-hide patterns are consumed by camera-preset framing and Crew view).
- Everything else per Codex's Section L/W Pass 6, which this review does not materially dispute.

**Pass 7 — Precision overlay infrastructure (snap guides, measurement)** *(Codex's Pass 8; deferred per roadmap, not architecture-forced per Section 13)*
- Runs after Pass 6 per current roadmap sequencing, though Section 13 notes this is a scope choice, not a hard dependency.

## 19. Items Safe to Parallelize

- Pass 0.5 (resource-contract fix) and Pass 0 (baseline benchmark harness) — independent, can run concurrently.
- Pass 3 (trailer/spatial visuals) and Pass 1 (cargo material language) — different files (`scene-runtime.js` vs. `editor-screen.js`), no shared state, both only depend on Pass 0.5.
- The cross-parity test for `getTrailerUsableZones()` duplication (Section 6) — fully independent of every visual pass, can be added at any point, ideally early.
- Preference-schema cleanup (reconciling `renderQuality`/`showShadows`/dead settings UI, Section 12/14) — independent of any single visual pass, though its *consumers* (Pass 3, Pass 4) should land after the schema is settled to avoid rework.

## 20. Items That Must Stay Sequential

- Pass 0.5 → Pass 1 and Pass 0.5 → Pass 2: both build directly on the resource/cache correctness the fix establishes.
- Pass 2 (typography) → Pass 5 (export parity): export-hide logic and label-plane export-safety must be verified only after the label architecture is real, not before.
- Pass 3 (`helpersGroup` introduced) → Pass 5 (export parity references it).
- Every pass → its own listed test suites: none of these should be batched into one PR/commit given the project's own "one focused change per commit" / "no refactor mixed with behavior" working rules (`CLAUDE.md`).
- Passes 0-5 (Visual Foundation) → Pass 6 (Camera/View System): explicit roadmap dependency, confirmed unchanged in this review.

## 21. Product-Owner Decisions Still Actually Needed

(Filtered to exclude anything answerable from current architecture or already-stated product requirements — most of both audits' Section Y/decisions lists were reasonable; the list below is what remains genuinely unresolved after this review's verification pass.)

1. **Should selection continue to visually mask an out-of-gauge/collision warning**, or must the warning remain visible even while a case is selected? This is now a confirmed, test-protected behavior (Section 4, item 7) — changing it requires an explicit decision, not just an implementation choice.
2. **Is the `trailer-geometry.js` / `pack-library.js` zone-duplication worth consolidating now, or tracked as separate technical debt?** This review recommends deferring consolidation but adding a cheap parity test immediately (Section 6) — product/eng leadership should confirm that sequencing choice, since it affects planning outside this roadmap phase.
3. **Should case-identity labels' new label-plane mesh support future stop/load-sequence emphasis in this phase**, or is that explicitly out of scope until a load-sequence workflow exists? Affects the label cache-key/service's initial API surface (Section 10).
4. **Is the `showShadowControls` dead settings-UI block worth resurrecting as real shadow-preference UI in Pass 4, or should it be deleted** and rebuilt fresh alongside the reconciled `renderQuality`/shadow/lighting preference model? Both audits agree the naming needs reconciling; which existing UI (if any) survives is a product call.
5. **Should millimeters become a selectable display unit in this phase**, given conversion support already exists in display helpers but is excluded from the preference allow-list? Small, but explicitly unresolved by either audit.

## 22. Recommended First Implementation Pass

**Fix the cargo visual-resource cache signature and disposal ownership bug (Pass 0.5, Section 18) — nothing else.**

Scope:
- `buildSignature()` in `src/screens/editor-screen.js`: include case shape and any label-affecting field (name/weight text or whatever the label content source is) so a content-only change busts the cache correctly.
- `disposeGroup()` in the same file: stop unconditionally disposing `obj.material.map` during the traversal; skip disposal for any resource already owned by the ref-counted `textureCache` (mirror the existing `edgeCacheKey` skip-pattern used for edge geometry), and rely solely on `releaseTextures()` for that resource class.
- Add one focused regression test: create two case instances with an identical signature, delete one, assert the remaining instance's texture is not disposed (`texture.image` still readable / no WebGL warning / whatever the test harness can assert without a live GL context — a `dispose()` spy/call-count assertion is sufficient given this is a `node --test` suite, not a browser test).

Likely files: `src/screens/editor-screen.js`, one new or extended test in `tests/audit/` (e.g. alongside `manual-vertical-placement.spec.mjs`'s existing `EDITOR-VISUAL` block, or a new focused spec file).

Avoid: `geometry-factory.js`, `trailer-geometry.js`, `pack-library.js`, `packing-core/*`, `autopack-engine.js`, `autopack-solver.js`, `operation-lifecycle.js`, any material *appearance* change (roughness/metalness/color — that's Pass 1), `app.js` `ExportService`, persisted pack schema, dependencies.

This is smaller and more tightly bounded than Codex's own "Pass 1" (which also folds in preference wiring and a broader "establish one clear owner" ownership audit) and smaller than my original audit's first-pass recommendation (which jumped straight to the full label-rendering redesign). It fixes a real, verified, currently-reproducible bug before any visual restyling inherits it.

## 23. Do-Not-Break Contract

Consolidated from both audits' Section Z, deduplicated, with this review's additions marked `[new]`:

- Canonical dimensions/placement stay in inches; `X` = length, `Y` = height, `Z` = width; `X = 0` is the rear loading opening.
- Never derive collision, containment, support, snapping, or measurement from decorative/rendered mesh bounds — including any future GLB model.
- `PackLibrary`/`packing-core` remain validation truth; `resolveCaseVisualState()` remains the single owner of case material/emissive/opacity state.
- No overlay geometry (labels, snap guides, measurement lines, contact cues, `helpersGroup` contents) may be added to `getRaycastMeshes()` or `getGizmoHandleMeshes()`.
- `OrbitControls.update()` stays unconditional in the render loop; camera remains usable during AutoPack/Unpack/Truck-Change.
- `renderer.setPixelRatio` stays capped at 2; export capture keeps forcing `pixelRatio = 1` with full state save/restore.
- New preferences go through `defaults.js` → `normalizer.js` → `StateStore`/`PreferencesManager` (read via `StateStore.get('preferences')`, write via `PreferencesManager.set()`) — no new bespoke `localStorage` keys.
- No React/R3F, no WebGPU, no renderer-architecture rewrite.
- Right-angle-only rotation assumption in `oriented-dims.js` is not silently violated by any new visual feature.
- **`[new]`** Any resource cache (textures, geometries, materials) must have exactly one disposal owner; a ref-counted `release*()` function and an unconditional `traverse()`-based dispose must never both claim the same resource — this is the exact bug fixed in Pass 0.5, and the pattern must not be reintroduced in the new label-plane/Sprite cache.
- **`[new]`** No label technique that isn't WebGL-rendered (i.e., no CSS2D) may be used for anything that must appear in a screenshot or PDF.
- **`[new]`** Any new helper/overlay object added directly to the main `scene` (not via `helpersGroup`) must get its own explicit export-hide entry in `renderCameraToDataUrl()` — the grid-only precedent must not be assumed to cover new object types automatically.
- **`[new]`** `TrailerGeometry.getTrailerUsableZones()` and `PackLibrary.getTrailerUsableZones()` must be kept in parity by an explicit test; a fix to one without the matching fix (or an explicit, documented divergence) to the other is a regression.

## 24. Final Verdict

**C. A hybrid sequence is better** — closer to Codex's shape than to my original audit's, but not identical to either.

Codex's core instinct — validate and fix the underlying visual-resource contract before building new material/typography systems on top of it — is now backed by a concretely verified bug (Section 6) that neither audit's original text fully captured, which is stronger evidence than Codex's own audit presented for the same conclusion. My original sequencing's error was starting cosmetic/typography work before that validation. However, Codex's sequence is more granular than the evidence justifies (a full "Pass 1" where a narrowly-scoped "Pass 0.5" bug fix suffices), and several of my original audit's sequencing choices survive intact once reordered — trailer/spatial visuals genuinely can run in parallel with cargo material work (Section 19), and export-parity verification is correctly treated by both audits as something to check repeatedly, not just once at the end.

The converged order in Section 18 — baseline lock, then a small resource-contract bug fix, then cargo visual language, then typography (now correctly export-safe), then trailer/spatial (parallelizable with cargo work), then lighting/shadows, then export-parity (pulled earlier than either original due to the confirmed leakage risk), then Camera/View System as its own roadmap phase — is what this review recommends carrying into the final reconciled plan.
