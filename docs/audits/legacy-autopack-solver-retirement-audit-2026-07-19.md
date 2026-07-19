# Legacy AutoPack Solver Retirement Audit — 2026-07-19

**Branch:** `audit/legacy-autopack-solver-retirement` (evidence-only, cut from `main` at `ecb6d83`)
**Scope:** Prove or disprove production reachability of `src/services/autopack-legacy-solver.js` and produce a safe-removal recommendation. No production code, tests, or docs were changed on this branch.

---

## 1. Executive conclusion

**SAFE TO REMOVE AFTER SMALL DEPENDENCY CLEANUP.**

`src/services/autopack-legacy-solver.js` has **zero production reachability**. No production file imports it, no static or dynamic import chain from `index.html` ever loads it in the browser, no error/fallback path routes to it, and no strategy in the current six-strategy portfolio (`default`, `compact-fill`, `floor-first`, `stack-priority`, `max-capacity`, `constrained-first`) ever calls it. Its only symbol with a real production consumer, `buildLegacyAutoPackItems`, already lives in `src/services/autopack-item-builder.js` — the legacy file just re-exports it, and `autopack-engine.js` imports the real implementation directly from `autopack-item-builder.js`, bypassing the legacy file entirely.

The file is reachable **only** from `tests/audit/security-and-invariants.spec.mjs` (12 tests, all evidence documented in Section 4/7 below). Nothing else in the repository — no script, no doc-generation tool, no persisted data format, no browser global — depends on it.

The "small dependency cleanup" is entirely test- and doc-side, not production-side:
- Redirect 4 genuine behavior tests that call `Legacy.buildLegacyAutoPackItems(...)` to import from `autopack-item-builder.js` directly (trivial swap — same function, same export).
- Delete or rewrite 4 tests that are source-pattern assertions against the **dead** `solveLegacyAutoPack` internals (they test the retiring file's internal structure, not any live AutoPack behavior, despite test names like "AutoPack runs a floor pass...").
- Delete 2 explicit "do not delete yet" guard tests (`AUTO-PACK-A1-R6`, `AUTO-PACK-A1-CLEAN-1`) whose own assertion text says they exist to block deletion "until the dead solver deletion branch" — this audit is that trigger.
- Update 2 stale doc lines (`docs/engineering/autopack-engine-contract.md` line 22, `docs/engineering/autopack-core-engine-plan.md` line 24) that still describe the file as "referenced by AutoPack engine" — it is not, and has not been since `buildLegacyAutoPackItems` moved to `autopack-item-builder.js`.

No production behavior changes as a result of removal. Historical behavior remains available through git history (commit `4cf3ce4` extracted the legacy solver from `app.js`; commit `7ef6421` extracted the live item builder from the legacy solver).

---

## 2. Current production AutoPack call chain

```
index.html:1135
  import('./src/app.js?v=...')
    app.js:74      import { createAutoPackEngine } from './services/autopack-engine.js'
    app.js: const AutoPackEngine = createAutoPackEngine({ ... })

User action:
  editor-screen.js:4047   await AutoPackEngine.pack()      (AutoPack button)
  app.js:4631 / 4635      AutoPackEngine.pack()             (keyboard shortcuts)

AutoPackEngine.pack()  [src/services/autopack-engine.js]
  1. buildLegacyAutoPackItems({...})     ← imported at line 1 FROM './autopack-item-builder.js'
                                            (NOT from autopack-legacy-solver.js)
  2. runAdaptiveAutoPack({...})          [src/packing-core/solution.js]
       → runPackingStrategies(input, ['default'], solve=solveAutoPack)
       → runPackingStrategies(secondaryInput, ['compact-fill','floor-first','stack-priority'], solve=solveAutoPack)
       → runPackingStrategies({...}, ['max-capacity'], solve=solveAutoPack)
       → runPackingStrategies(secondaryInput, ['constrained-first'], solve=solveAutoPack)   (Wheel Wells only)
       → optional bounded recovery pass, also solve=solveAutoPack
       (every strategy's `solve` parameter defaults to, and is always called with,
        solveAutoPack from src/services/autopack-solver.js — solveLegacyAutoPack is
        never referenced anywhere in this file)
  3. PackLibrary.update(packId, { cases: nextCases })   ← commits the result
  4. catch (err): console.error + toast('AutoPack failed') — no solver fallback
```

`solveLegacyAutoPack` does not appear anywhere in this chain, confirmed both by static reading of `autopack-engine.js` / `packing-core/solution.js` and by the repository's own guard test (`G2-SHAPE-CONTRACT`, Section 4).

---

## 3. Legacy file and symbol inventory

`src/services/autopack-legacy-solver.js` — 549 lines, 17,066 bytes.

| Symbol | Kind | Status |
|---|---|---|
| `export { buildLegacyAutoPackItems } from './autopack-item-builder.js'` (line 1) | re-export | Compatibility shim only — real implementation and all production consumption live in `autopack-item-builder.js`; nothing in production imports this re-export |
| `MIN_STACK_SUPPORT_RATIO` (const) | internal | Used only by `findRestingY`/`hasPlacementSupport` below — dead, no production caller |
| `getXzOverlapArea()` | internal fn | Dead — used only by `findRestingY`/`hasPlacementSupport` |
| `findRestingY()` | internal fn | Dead — used only by `solveLegacyAutoPack` |
| `collides()` | internal fn | Dead — used only by `tryPlace`/`validatePackedPlacements` in this file |
| `tryPlace()` | internal fn | Dead — used only by `solveLegacyAutoPack` |
| `getPlacementAabb()` | internal fn | Dead — used only within this file |
| `isXzContainedInZone()` | internal fn | Dead — used only within this file |
| `hasPlacementSupport()` | internal fn | Dead — used only within this file |
| `validatePackedPlacements()` | internal fn | Dead — name-collides with, but is textually distinct from, the active solver's own `validatePackedPlacements(output, packed, zones)` in `autopack-solver.js:2550` |
| `solveLegacyAutoPack()` (exported, line 164) | exported fn | Dead in production. Only ever invoked directly by tests via dynamic `import()` |

`buildLegacyAutoPackItems`'s real body (orientation candidate generation, cargo-rule merge, volume calc) lives entirely in `src/services/autopack-item-builder.js` (126 lines) and is unaffected by any removal of `autopack-legacy-solver.js`.

---

## 4. Complete reference classification table

Every match for `autopack-legacy-solver`, `solveLegacyAutoPack`, and `buildLegacyAutoPackItems` repo-wide (excluding `node_modules`, `graphify-out`):

| # | File | Symbol/context | Direction | Reachable from production entry path? | Category |
|---|---|---|---|---|---|
| 1 | `src/services/autopack-engine.js:1` | `import { buildLegacyAutoPackItems } from './autopack-item-builder.js'` | import | Yes | **Active production dependency** — but the import target is `autopack-item-builder.js`, not the legacy-solver file |
| 2 | `src/services/autopack-engine.js:842` | `buildLegacyAutoPackItems({...})` call | call | Yes | Active production dependency (same, item-builder-owned) |
| 3 | `src/services/autopack-legacy-solver.js:1` | `export { buildLegacyAutoPackItems } from './autopack-item-builder.js'` | re-export | No production importer of this specific re-export | **Re-export with no live consumer** |
| 4 | `src/services/autopack-legacy-solver.js:164-549` | `solveLegacyAutoPack` + all internal helpers | definition | No | **Dead/unreachable code** |
| 5 | `tests/audit/security-and-invariants.spec.mjs:57` | `autoPackLegacySolverPath` constant | path decl | test-only | Test-only dependency |
| 6 | `tests/audit/security-and-invariants.spec.mjs:1821-1842` (`CARGO-RULE-V5 export reports unresolved refs...`) | `Legacy.buildLegacyAutoPackItems(...)` | dynamic import + call | test-only | **Test-only dependency** (genuine behavior test — redirectable to `autopack-item-builder.js`) |
| 7 | `tests/audit/security-and-invariants.spec.mjs:4443-4448` (`G2-SHAPE-CONTRACT solveLegacyAutoPack remains unused...`) | `assert.doesNotMatch(engineSrc, /solveLegacyAutoPack/)` | source-pattern | test-only | **Test-only dependency** — guard proving zero usage; becomes unconditionally true once the file is deleted |
| 8 | `tests/audit/security-and-invariants.spec.mjs:5036-5054` (`AUTO-PACK-A1-2 AutoPack runs a floor pass...`) | reads `autopack-legacy-solver.js` source, asserts on dead `solveLegacyAutoPack` internals | source-pattern | test-only | **Dead/unreachable code coverage** — validates the retiring file's own internals, not live `autopack-solver.js` behavior, despite the test name |
| 9 | `tests/audit/security-and-invariants.spec.mjs:5056-5080` (`AUTO-PACK-A1-3 AutoPack validates support...`) | same pattern as #8, against `MIN_STACK_SUPPORT_RATIO`/`validatePackedPlacements` in the legacy file | source-pattern | test-only | **Dead/unreachable code coverage** |
| 10 | `tests/audit/security-and-invariants.spec.mjs:5176-5188` (`AUTO-PACK-A1-3 X anchor cap...`) | same pattern, against `capXAnchorsSorted` in the legacy file | source-pattern | test-only | **Dead/unreachable code coverage** |
| 11 | `tests/audit/security-and-invariants.spec.mjs:5632-5659` (`CARGO-RULE-V4 live item preparation (buildLegacyAutoPackItems) is alias-invariant`) | `Legacy.buildLegacyAutoPackItems(...)` | dynamic import + call | test-only | **Test-only dependency** (genuine behavior test — redirectable) |
| 12 | `tests/audit/security-and-invariants.spec.mjs:7436-7464` (`AUTO-PACK-A1-R6 live AutoPack routes through the logistics solver...`) | reads legacy file source; asserts specific dead snippets (`X_TIGHTNESS_WEIGHT`, `capXAnchorsSorted`, the pass loop) **must still exist** "before A1-R7 cleanup approval" | source-pattern (deletion-blocking guard) | test-only | **Compatibility layer / deletion-blocking guard** — its own assertion text identifies it as provisional pending exactly this audit |
| 13 | `tests/audit/security-and-invariants.spec.mjs:7466-7487` (`AUTO-PACK-A1-R6 live adapter preserves runtime gates...`) | asserts on `autopack-engine.js` only, no legacy-file assertions | n/a | n/a | Not a legacy-solver dependency (listed for completeness; safe, no change needed) |
| 14 | `tests/audit/security-and-invariants.spec.mjs:7489-7517` (`AUTO-PACK-A1-CLEAN-1 app keeps legacy scanner isolated...`) | asserts the re-export **must** stay, `X_TIGHTNESS_WEIGHT` **must** stay "until the dead solver deletion branch", plus an isolation check (no billing/auth/UI symbols in the legacy file) | source-pattern (deletion-blocking guard + isolation contract) | test-only | **Compatibility layer / deletion-blocking guard** |
| 15 | `tests/audit/security-and-invariants.spec.mjs:7519-7539` (`AUTO-PACK-A1-CLEAN-2 app delegates AutoPack runtime...`) | `assert.doesNotMatch(appSrc, /const legacyResult = await solveLegacyAutoPack\(\{/)` | source-pattern | test-only | Test-only dependency — passes regardless of file existence (app.js never had this pattern); no change required |
| 16 | `tests/audit/security-and-invariants.spec.mjs:8220-8268` (`REPAIR-1 D: active solver and live legacy item-prep agree...`) | `Legacy.buildLegacyAutoPackItems(...)` vs `Solver.buildOrientationCandidates(...)` cross-consistency | dynamic import + call | test-only | **Test-only dependency** (genuine shared-invariant test — redirectable) |
| 17 | `tests/audit/security-and-invariants.spec.mjs:8270-8345` (`REPAIR-1 E: candidate deduplication...`) | `Legacy.buildLegacyAutoPackItems(...)` (line 8305) | dynamic import + call | test-only | **Test-only dependency** (genuine behavior test — redirectable) |
| 18 | `tests/audit/security-and-invariants.spec.mjs:12890-12907` (`AUTO-PACK-A0 AutoPack keeps zone containment and stacking guards wired`) | reads legacy file source, asserts on dead `tryPlace`/`findRestingY` internals | source-pattern | test-only | **Dead/unreachable code coverage** |
| 19 | `docs/engineering/autopack-engine-contract.md:22` | "legacy item normalization / legacy solver helpers still referenced by AutoPack engine, including `buildLegacyAutoPackItems`; do not remove until production callers are eliminated" | prose | n/a | **Documentation/comment-only reference — stale.** Production callers were already eliminated when `buildLegacyAutoPackItems` moved to `autopack-item-builder.js` (commit `7ef6421`); this line was never updated |
| 20 | `docs/engineering/autopack-core-engine-plan.md:24` | "Item normalization for AutoPack \| `autopack-legacy-solver.js` (`buildLegacyAutoPackItems`) \| Live; `solveLegacyAutoPack` is dead code kept intentionally" | prose/table | n/a | **Documentation/comment-only reference — stale** (same reason) |
| 21 | `docs/product/PROJECT_TREE.md:262` | file listing in a generated snapshot | prose | n/a | Documentation-only, already flagged non-authoritative (V5 §13) |
| 22 | `docs/archive/master-todos/TP3D-MASTER-TODO-V4.md` (multiple lines) | historical narrative of the extraction work | prose | n/a | Documentation-only, archival — no update needed |

No matches exist for: `fallback solver`, `old solver` (as a symbol — only prose), dynamic `import()` of the legacy file from any production file, `window.TruckPackerApp`/global exposure of any legacy-solver symbol, `CustomEvent`/`postMessage` invocation, Web Worker references, feature flags, `localStorage` flags, or query-string flags gating legacy-solver use. Grep evidence for each category is in Section 8 of this audit's working notes (repo-wide `rg` searches; zero hits beyond what is tabulated above).

---

## 5. Fallback-path findings

**No fallback to the legacy solver exists anywhere in the codebase.**

Traced explicitly:
- **Solver throws:** `autopack-engine.js`'s `pack()` wraps the entire solve in one `try { ... } catch (err) { console.error(...); toast('AutoPack failed', 'error', ...); }` (lines 821–1092). The catch block does not call any solver, legacy or otherwise — it only logs and shows an error toast.
- **No result / partial result:** `runAdaptiveAutoPack` (Section 2) already has its own bounded, in-family recovery: it retries with `stack-priority` and (Wheel-Wells-only) `constrained-first`, both via `solveAutoPack`. It never falls through to `solveLegacyAutoPack`.
- **Unsupported strategy:** `getPackingStrategy(id)` in `packing-core/solution.js` returns `null` for an unknown id, and `runPackingStrategies` throws `Unknown packing strategy: ${id}` — no legacy fallback.
- **Unsupported space type:** all three truck modes (Standard, Wheel Wells, Front Overhang) route through the same `solveAutoPack`/`runAdaptiveAutoPack` path; there is no space-type branch that selects a different solver.
- **Old imported packs:** placement data (`position`, `rotation`, per-instance dims) is solver-agnostic — nothing in `import-export.js`, `normalizer.js`, or `cargo-canonical.js` references the legacy solver or requires its presence to read old packs (Section 6).
- **Test flags / dev/debug mode:** exhaustive search for `localStorage`, query-string, and in-code flags near AutoPack/solver code found none that select the legacy solver. The only "legacy"-named identifiers in `app.js` are unrelated billing-storage-key and org-sync-hint helpers (`_billingLegacyLockKey`, `org-sync-legacy`, etc.) — a naming coincidence, not a code path.

**Conclusion:** the fallback does not exist, is not "unreachable" in some theoretical corner case — it was never wired at all in the current architecture. There is nothing to preserve "for theoretical safety."

---

## 6. Data/persistence compatibility findings

The legacy solver owns **no unique compatibility behavior**. Specifically checked and found clear:

- **Old case/pack records, rotation formats, dimension normalization, orientation rules:** all owned by `src/core/oriented-dims.js`, `src/core/orientation.js`, and `src/core/cargo-canonical.js` — none of which import from or reference the legacy solver.
- **Packed instance format / imported JSON / restored workspace data:** `src/services/import-export.js` and `src/core/normalizer.js` contain zero references to the legacy solver (the only "legacy" hits in those files are unrelated: a `showPackedStatLine` UI-badge variable named `legacy` in `normalizer.js`, and an unrelated staging-path comment in `pack-library.js`).
- **Duplicate/copy operations, unpack/repack behavior:** owned by `pack-library.js`, independent of the legacy solver.
- **Result signatures:** `buildAutoPackResultSignature`/`buildAutoPackLayoutSignature` (in `autopack-engine.js`) hash placement/rotation/dims data — solver-agnostic, no legacy-solver dependency.

**`buildLegacyAutoPackItems` specifically:**
- It is **not obsolete** — it is the live, current-production item-normalization step (orientation candidate generation feeding both the pre-solve staging pose and, indirectly via `packItems`, the solver input mapping in `autopack-engine.js`).
- It is **still used by current code** — `autopack-engine.js:842`, imported from `autopack-item-builder.js`.
- It is **not** "a generic helper incorrectly housed in the legacy file" — it was already correctly relocated to `autopack-item-builder.js` in commit `7ef6421` ("refactor(autopack): extract live item builder from legacy solver"). The legacy file's one-line re-export is the only remaining tie, and it is unused in production.
- **No move is required on any future removal branch** — the helper already lives in its permanent home. Only the now-redundant re-export line in `autopack-legacy-solver.js` goes away with the rest of the file.

---

## 7. Test and tooling dependency findings

12 tests in `tests/audit/security-and-invariants.spec.mjs` reference the legacy solver (full detail in Section 4, table rows 6–18). Summarized by disposition:

**Genuine behavior tests — redirectable, not deletable** (4 tests): `CARGO-RULE-V5` (1821), `CARGO-RULE-V4` (5632), `REPAIR-1 D` (8220), `REPAIR-1 E` (8270). All call `Legacy.buildLegacyAutoPackItems(...)` via the dynamic import of `autopack-legacy-solver.js`. Because that is a pure one-line re-export of the identical function in `autopack-item-builder.js`, these tests validate real, live production behavior (orientation-candidate alias invariance, cross-consistency with the active solver's own candidate generator, dedup behavior) — they must be **redirected to import `autopack-item-builder.js` directly**, not deleted, on the removal branch.

**Dead-code source-pattern tests — deletable with the solver** (4 tests): `AUTO-PACK-A1-2` (5036), `AUTO-PACK-A1-3` (5056), `AUTO-PACK-A1-3 X anchor cap` (5176), `AUTO-PACK-A0 zone containment and stacking guards` (12890). These read `autopack-legacy-solver.js`'s raw source text and assert on internal implementation details of the dead `solveLegacyAutoPack` (`FLOOR_REST_EPS`, `MIN_STACK_SUPPORT_RATIO`, `capXAnchorsSorted`, `tryPlace`, `findRestingY`). Despite test names that read as live "AutoPack" behavior protection, they exercise **only** the retiring file's own text — the active solver (`autopack-solver.js`) has independent, differently-named equivalents (its own `validatePackedPlacements(output, packed, zones)`, its own floor/stack phase logic) that these tests never touch. They protect nothing live and can be deleted with the file.

**Deletion-blocking guard tests — delete, this audit is their trigger** (2 tests): `AUTO-PACK-A1-R6` (7436) and `AUTO-PACK-A1-CLEAN-1` (7489). Both contain assertions whose own failure messages say they exist to prevent deletion "before A1-R7 cleanup approval" / "until the dead solver deletion branch." They also assert the zero-usage invariant (`engineSrc` never matches `solveLegacyAutoPack(`), which is worth preserving in spirit — but as a positive assertion that the *replacement* path is used, not as a guard over dead code. Recommend collapsing their non-dead-code assertions (billing/auth isolation would be moot post-deletion; the "must route through `runAdaptiveAutoPack`" assertions are already duplicated by `AUTO-PACK-A1-R6 live adapter preserves runtime gates...`, table row 13, which has no legacy-file dependency and should be kept as-is).

**Zero-usage guard — trivially satisfied post-deletion, safe to delete** (1 test): `G2-SHAPE-CONTRACT` (4443) simply asserts `autopack-engine.js` never matches `/solveLegacyAutoPack/`. True by construction once the file no longer exists to be imported; low value to keep, no harm either way.

**No dependency, no change needed** (1 test): `AUTO-PACK-A1-CLEAN-2` (7519) — its one legacy-related assertion (line 7531) checks for a pattern that never existed in `app.js`; it will continue to pass with or without the legacy file present.

No script, benchmark, Graphify artifact, or documentation-generation tool depends on the legacy solver. `scripts/autopack-strategy-audit.mjs` and its fixtures (surfaced by the graphify orientation query) exercise only `solveAutoPack`/`runAdaptiveAutoPack`, confirmed by the earlier, separate strategy-differentiation audit (merged `ec1cf4a`) — no legacy-solver reference found there.

---

## 8. Bundle/static inclusion findings

This is a static, unbundled ESM app (`package.json` has no `build`/`bundle` script; `index.html` loads `./src/app.js` directly via a native `import()`, and vendor libraries via CDN `<script>` tags or local `/vendor` fallbacks — no webpack/vite/rollup config exists in the repo root). "Bundle inclusion" therefore reduces to: **is this module ever fetched by the browser at all?**

- `index.html:1135` → `import('./src/app.js?v=...')` is the sole application entry point.
- `app.js` imports `createAutoPackEngine` from `autopack-engine.js`.
- `autopack-engine.js` imports `buildLegacyAutoPackItems` from `./autopack-item-builder.js` — never from `./autopack-legacy-solver.js`.
- No other production file (`src/**`, excluding `tests/**`) contains any import of `autopack-legacy-solver.js` (confirmed by repo-wide `rg` for the exact filename).

**Conclusion: `autopack-legacy-solver.js` is never fetched, parsed, or executed by the browser in production.** Deleting it has:
- **Bundle size / parse cost:** N/A (no bundler) — but it does remove one 17 KB file from the repository and from any future bundling effort's dependency graph.
- **Runtime initialization:** none — the module has no side effects at import time beyond the re-export statement, and it is never imported at runtime regardless.
- **Browser globals:** none — no `window.*` exposure of any legacy-solver symbol exists (confirmed by repo-wide search of `window.TruckPackerApp` and related global-exposure patterns; all hits are unrelated app/billing/workspace code).
- **Source-map size:** removes one file's worth of source-map entries; not quantified further as no source-map build step exists in this repo.
- **Startup behavior:** no change — the file is not on the startup import graph today.

These are structural (import-graph) claims, not measured performance numbers; no unsupported performance claim is made here.

---

## 9. Current-solver replacement coverage

Comparison is for retirement-safety purposes only — not a general solver quality audit.

| Responsibility | Current path (`autopack-solver.js` / `packing-core`) | Legacy (`autopack-legacy-solver.js`) | Disposition |
|---|---|---|---|
| Item normalization | `buildLegacyAutoPackItems` (owned by `autopack-item-builder.js`, imported directly — misleadingly named but current) | Same function, reached only via dead re-export | Fully replaced (same code, correct owner file) |
| Orientation generation | `buildOrientationCandidates()` (`autopack-solver.js:111`); proven byte-consistent with item-builder's `buildOrientations()` by `REPAIR-1 D` | `buildOrientations()` (now in item-builder, not legacy) / dead `solveLegacyAutoPack` had none of its own beyond orientation array | Fully replaced |
| Containment | `isAabbContainedInZone()` etc. in `autopack-solver.js` / `packing-core/validation.js` | `geometry.isAabbContainedInAnyZone` (passed-in dependency) used by dead `tryPlace`/`validatePackedPlacements` | Fully replaced |
| Overlap prevention | Solver's own collision checks (`collidesPacked`, per contract doc) | `collides()` (dead, internal) | Fully replaced |
| Floor support | Solver's phase/scoring pipeline (`placementPassesCompressionRules`, `scoreStackCandidate`, etc.) | Floor/stack `placementPasses` loop (dead) | Fully replaced, with stronger behavior (multi-strategy, layout-quality ranking, leftover recovery) |
| Stack support | `canSupportStack`, `hasStackCapacity`, `canSupportCandidateWeight` (per engine contract §Module Ownership) | `hasPlacementSupport()`/`MIN_STACK_SUPPORT_RATIO` (dead) | Fully replaced, with stronger behavior (max-stack-count, weight rules) |
| Fragile/heavy rules | Not implemented in either (documented as a "Known Deferred / Non-Feature" in the engine contract) | Not implemented | Intentionally obsolete in both — no regression |
| Wheel Wells | `getWheelWellGeometry()`, wheel-well blocked-body/cantilever/COM rules (`autopack-solver.js`) | Not implemented at all in the legacy file | Current-only capability; legacy never had this |
| Front Overhang | Retention geometry via `pack-library.js`, consumed by the solver | Not implemented at all in the legacy file | Current-only capability; legacy never had this |
| Strategy handling | Six-strategy portfolio (`PACKING_STRATEGIES` in `packing-core/solution.js`) with adaptive recovery | Single fixed algorithm, no strategy concept | Current-only capability |
| Multiple-solution generation | `runPackingStrategies`/`runAdaptiveAutoPack` returns a `solutions[]` envelope | Single result only | Current-only capability |
| Dedupe | Handled at the strategy-portfolio layer (per V5: "production physical-layout dedupe remains required") | Not implemented | Current-only |
| Max Capacity | `applyMaxCapacityRuleProfile()` (per engine contract §5) | Not implemented | Current-only capability |
| Result metadata | `phaseStats`, `solveStatus`, `warnings`, `rejectionReasons` | Only a flat `warnings`-free result shape (`placements`, `rotations`, `unpacked`, `finalValidation`) | Fully replaced with richer metadata |
| Cancellation/progress | Cooperative yield via `sleep(0)`/`shouldAbort()` inside `solveAutoPack`'s own loop (per engine contract, "true cancel is not available without later architecture work" for either path) | Same cooperative-yield pattern existed in `solveLegacyAutoPack` too | Equivalent limitation in both; not a regression |
| Editor integration | `autopack-engine.js` orchestration, operation-lifecycle locking, animation/staging handoff — all built around `runAdaptiveAutoPack`'s output shape | `solveLegacyAutoPack` was never wired into the current `autopack-engine.js` orchestration (it predates the current engine/operation-lifecycle architecture) | Fully replaced; legacy result shape is not even consumed by the current engine |

**No responsibility exists where the legacy solver has behavior the current path lacks.** Every row is either fully replaced, replaced with strictly more capability, or an intentional non-feature shared by both.

---

## 10. Exact files expected to change during removal

On the future `cleanup/remove-legacy-autopack-solver` branch (not this branch):

- **Delete:** `src/services/autopack-legacy-solver.js` (whole file).
- **Edit — test redirection (behavior tests kept, import source changed):**
  - `tests/audit/security-and-invariants.spec.mjs` — change 4 tests (`CARGO-RULE-V5`, `CARGO-RULE-V4`, `REPAIR-1 D`, `REPAIR-1 E`) to `await import(autoPackItemBuilderPath...)` instead of `autoPackLegacySolverPath`, and remove the now-unused `autoPackLegacySolverPath` constant (line 57) once no test references it.
- **Edit — test deletion (dead-code/guard tests):**
  - Same file — delete `G2-SHAPE-CONTRACT` (4443), `AUTO-PACK-A1-2` (5036), `AUTO-PACK-A1-3` (5056), `AUTO-PACK-A1-3 X anchor cap` (5176), `AUTO-PACK-A1-R6 live AutoPack routes...` (7436, or trim to only its non-legacy-file assertions — it duplicates coverage already in the retained `AUTO-PACK-A1-R6 live adapter preserves runtime gates...`), `AUTO-PACK-A1-CLEAN-1` (7489, or trim to its non-legacy-file isolation assertions if any are judged worth keeping in another form), `AUTO-PACK-A0 zone containment and stacking guards` (12890).
  - `AUTO-PACK-A1-CLEAN-2` (7519) needs no change — its assertion never depended on the file's existence.
- **Edit — doc corrections:**
  - `docs/engineering/autopack-engine-contract.md` line 22 — remove the `autopack-legacy-solver.js` bullet from Module Ownership (or replace with a one-line historical note if the contract's authors want a paper trail).
  - `docs/engineering/autopack-core-engine-plan.md` line 24 — update the ownership table row to point to `autopack-item-builder.js` only.
- **No production code changes** — `autopack-engine.js`, `autopack-solver.js`, `autopack-item-builder.js`, `packing-core/solution.js`, `app.js`, and `editor-screen.js` require zero edits; none of them reference the file being deleted.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A future contributor re-adds a legacy-solver fallback without realizing it was removed on purpose | Git history preserves the original file and both extraction commits (`4cf3ce4`, `7ef6421`); the removal-branch commit message should cite this audit |
| The 4 redirected behavior tests silently lose coverage if the redirect is done incorrectly | Redirect is a mechanical one-line import-path swap calling the identical exported function; run the 4 tests before/after redirect and diff pass/fail to confirm identical assertions still pass |
| Deleting the 2 "deletion-blocking guard" tests removes their zero-usage invariant coverage | The two non-legacy-dependent tests already covering the live routing contract (`AUTO-PACK-A1-R6 live adapter preserves runtime gates...`, `AUTO-PACK-A1-CLEAN-2`) remain in place and continue to assert `autopack-engine.js` routes only through `runAdaptiveAutoPack`/`solveAutoPack` |
| Stale doc references confuse a future auditor | Section 10 lists the exact two doc lines to correct on the removal branch |
| `npm test` full-suite count drops by up to 7 tests (4 deleted dead-code tests + up to 2 trimmed guard tests + the trivial zero-usage test), which could look like an unexplained coverage regression in CI history | The removal-branch PR description should state the before/after test count and reference this audit's Section 7/10 classification |

No risk was found that blocks removal outright — hence "after small dependency cleanup" rather than "not safe yet."

---

## 12. Final disposition

**SAFE TO REMOVE AFTER SMALL DEPENDENCY CLEANUP.**

- **Exact file to delete:** `src/services/autopack-legacy-solver.js`.
- **Imports/re-exports to remove:** none in production code (there are none to begin with); the test file's `autoPackLegacySolverPath` constant once no longer referenced.
- **Tests to redirect (not delete):** `CARGO-RULE-V5` (1821), `CARGO-RULE-V4` (5632), `REPAIR-1 D` (8220), `REPAIR-1 E` (8270) → point at `autoPackItemBuilderPath` instead of `autoPackLegacySolverPath`.
- **Tests to delete:** `G2-SHAPE-CONTRACT` (4443), `AUTO-PACK-A1-2` (5036), `AUTO-PACK-A1-3` (5056), `AUTO-PACK-A1-3 X anchor cap` (5176), `AUTO-PACK-A0 zone containment and stacking guards` (12890), and the legacy-file-specific assertions inside `AUTO-PACK-A1-R6 live AutoPack routes...` (7436) and `AUTO-PACK-A1-CLEAN-1` (7489) (or the whole tests, since their remaining non-legacy assertions duplicate other retained tests — final call belongs to the removal-branch author).
- **Helper that must remain:** `buildLegacyAutoPackItems` — already correctly owned by `autopack-item-builder.js`; nothing to move.
- **Comments/docs to update:** `docs/engineering/autopack-engine-contract.md:22`, `docs/engineering/autopack-core-engine-plan.md:24`.
- **Expected production behavior impact: none.** No production file imports the deleted file today; the browser never fetches it; no strategy, error path, or persisted-data format depends on it.

This audit branch changed no production code, no test code, and no docs — only this report was added.

---

## 13. Recommended removal-branch validation plan

On `cleanup/remove-legacy-autopack-solver`, after deleting the file and making the test/doc edits in Sections 10/12:

1. `rg -n "autopack-legacy-solver|solveLegacyAutoPack" --hidden -g '!node_modules' -g '!graphify-out'` — expect zero hits outside archived V4/audit docs (which are historical evidence, left untouched per V5 documentation rules).
2. `npm test` — full suite green, with the expected reduced test count from Section 11 documented in the PR description.
3. `npm run -s typecheck` — clean (`tsc --noEmit --allowJs --checkJs`).
4. `npm run lint` — clean.
5. Focused AutoPack tests: re-run the 4 redirected tests (`CARGO-RULE-V5`, `CARGO-RULE-V4`, `REPAIR-1 D`, `REPAIR-1 E`) individually and confirm identical assertions pass against `autopack-item-builder.js`.
6. `git diff --check` and `git diff --cached --check`.
7. Manual browser verification (per `tp3d-autopack-guard`): run AutoPack in Standard, Wheel Wells, and Front Overhang modes and confirm identical packed/staged counts and layout to a pre-removal run on the same fixture pack (the production call chain never touched the deleted file, so no behavior difference is expected — this step proves it empirically, not just structurally).
8. Update `docs/product/TP3D-MASTER-TODO-V5.md` at removal-branch closeout, per the same pattern used to close this audit.
