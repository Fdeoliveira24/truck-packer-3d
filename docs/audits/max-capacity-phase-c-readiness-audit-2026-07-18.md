# Max Capacity Phase C — Readiness Audit

**Date:** 2026-07-18
**Type:** Read-only audit. No branch created. No production code changed.
**Baseline:** `main` == `origin/main`, HEAD `e915cc6a4474d1ab79cb39f64e6943f3cac6f1b7`, working tree clean at start and end of this audit.

---

> **SUPERSEDED FINDING — read before acting on Finding F8 below.**
> This document left the within-pack duplicate-inherits-marker behavior (Finding F8, below and in Section D) as an open, unresolved product question, and a since-proposed fix to unconditionally clear `packedProfile` on every packed duplicate was under consideration during this workstream. That question is now **conclusively resolved** by direct behavior-characterization testing against the real code in [Max Capacity Phase C — Packed-Profile Semantics Audit](./max-capacity-phase-c-packed-profile-semantics-audit-2026-07-18.md) (Section E), which is now the authoritative source on this point:
> - `packedProfile` uses **Contract C: active Max Capacity profile membership** — not origin provenance, not proof of individual per-instance necessity.
> - A packed duplicate **may correctly retain the marker** when profile membership is required for the placement to keep validating coherently (proven: a support+child pair replicated through `buildSafeDuplicateInstances()`, where stripping the marker after the fact causes the very next revalidation to silently stage a previously-valid instance).
> - **No duplicate-path production code change is approved for Max Capacity Phase C.** Current behavior is correct as-is.
>
> Finding F8 and the rest of this document remain valid as a historical evidence record of the questions raised and the state of the code at the time. Do not treat F8's "no change recommended without explicit direction" as still open — it is now closed, with the disposition above.

---

## A. Executive conclusion

**APPROVE WITH CONDITIONS.**

Confidence: high on the physical-safety boundary and on the metadata lifecycle (verified by direct source reads plus 15 existing durability tests, `MAX-CAPACITY-B1`–`B15`/`B5A`, and a dedicated solver-level suite, `AUTOPACK-MAX-A`). Medium confidence on scope wording, because one real doc/code gap (Finding F2) directly touches how Phase C should describe what "relaxed" means.

Phase C — "report how many applied cases use relaxed handling rules" — is technically small and low-risk **if** it is implemented as a single **derived** count read from the existing, already-durable, already-tested `packedProfile` marker, surfaced in the existing Editor Stats card (and optionally the PDF summary), with no new persisted field, no solver change, and no UI redesign. That description matches what V5 Section 10 actually authorized.

Conditions before/alongside implementation (see Section D for IDs):
1. Reconcile the V5 document's own internal contradiction about whether Phase C is blocked (F1) — cosmetic, but should not carry into a new branch's commit history.
2. Decide and record the exact counted unit and zero/unknown behavior using the canonical definition in Section C below (no code work needed — a product sign-off on wording).
3. Add the four missing regression tests identified in Section D (F4–F7) before or alongside the Phase C branch, since Phase C makes several previously-invisible code paths (manual mutation, Unpack, Truck Change reconciliation, save/reload) newly user-visible through a persistent count.
4. Get explicit product sign-off on Phase C copy given Finding F2/F3 (the weight/crush relaxation nuance) so the wording neither overstates nor understates what was relaxed.

None of these are architectural blockers. None require touching the solver, the engine, or the relaxation logic itself.

---

## B. Verified current behavior

### Phase A contract — what Max Capacity actually is

Max Capacity is a **named, isolated solver strategy**, never a user toggle and never auto-applied:

- `src/packing-core/solution.js:66-72` defines it as a frozen strategy preset (`id: 'max-capacity'`, `options: { maxCapacityMode: true }`) with a fixed description: `"Physical-fit estimate; handling rules may be relaxed. Not a transport recommendation."`
- `src/packing-core/solution.js:222-233` (`runAdaptiveAutoPack`) runs it as one separate, isolated `solveAutoPack()` call per AutoPack invocation — never merged into the normal portfolio's solve input.
- `src/packing-core/solution.js:274-280` deliberately excludes it from `selectableSolutions` (automatic ranking/best-pick) — comment: *"Phase A must never auto-apply it"* — while including it in `allSolutions` so it appears as one option (fixed order: Balanced, Compact, Floor, Stack, Max, [constrained]) in the Results carousel for the user to manually choose and click **Apply**.
- `src/services/autopack-solver.js:3486-3488` is the **only** place the solver reads `maxCapacityMode`: `rawItems.map(applyMaxCapacityRuleProfile)` when true, otherwise items pass through unmodified. No other conditional in `autopack-solver.js` branches on this flag (confirmed by full-file inspection).

### Phase A contract — exactly which handling preferences are relaxable

`applyMaxCapacityRuleProfile()`, `src/services/autopack-solver.js:406-423`, on a shallow clone of each solver item:

```js
noStackOnTop: false, stackable: true, maxStackCount: 0, weight: 0,
laneItem: false, loadPriority: 0, orientationLock: 'any', canFlip: true,
orientationLocked: false,
```

A second, narrower relaxation applies only during later reconciliation of **already-marked** instances (not during solving): `projectMaxCapacitySupportRecords()`, `src/services/pack-library.js:1170-1185`, relaxes `noStackOnTop`/`stackable`/`maxStackCount`/`isPallet` on a support **only when both** the candidate and the support are independently marked `packedProfile === 'max-capacity'` (`maxCapacitySupportRelationship()`, `pack-library.js:1162-1165`). A one-sided marker relaxes nothing — proven by test `MAX-CAPACITY-B5`.

### Phase A contract — physical hard constraints that are never relaxed

None of the following accept a profile/mode argument, and `maxCapacityMode` never appears near their call sites:

- Collision — `aabbsOverlap()` / `collidesPacked()` (`validation.js:44`, `autopack-solver.js:309`)
- Containment — `isAabbContainedInZone()` / `isAabbContainedInAnyZone()` (`validation.js:60,71`)
- Wheel-well body exclusion, support fraction, CoM stability — `isWheelWellSupportedAndStable()` (`wheel-well-model.js:249`)
- Front Overhang rear retention — `candidateHasRearRetention()` (`autopack-solver.js:696`)
- Final unconditional gate — `validatePackedPlacements()` (`autopack-solver.js:2550`), called from `solveAutoPack()` with no branch on profile between item normalization and validation.

This is proven at the solver level by a dedicated test block, `AUTOPACK-MAX-A` (`tests/audit/security-and-invariants.spec.mjs:20361-20725`), including `'AUTOPACK-MAX-A preserves physical geometry, support, blocked bodies, stability, and retention in all truck modes'`.

**Finding requiring explicit attention (see F2/F3):** the same `AUTOPACK-MAX-A` suite includes `'AUTOPACK-MAX-A relaxes child-vs-support weight without weakening support geometry'` (`security-and-invariants.spec.mjs:20620-20638`), which asserts `Max neutralizes the crushing/weight rule` while `relaxed child still has exact vertical contact` and `relaxed child still has the ordinary minimum footprint support`. Mechanically: `applyMaxCapacityRuleProfile` sets `weight: 0` on the solver item, so `weightAllowsSupport(candidateWeight, supportWeight, isPallet)` (`validation.js:130-133`, `0 <= supportWeight`) is structurally always true. The **geometric** footprint/contact support requirement stays fully enforced; only the **load-bearing capacity** comparison is neutralized. This is deliberate and tested, not a bug — but `docs/engineering/autopack-engine-contract.md` lists "child-vs-support weight check except pallet bypass behavior" as a Hard Rule (line 42) with **zero mention of Max Capacity anywhere in the 164-line document** (confirmed by full-text search). The permanent engineering contract does not currently document this carve-out.

### Phase B contract — the durable relaxed-rule marker

A single string field, **`packedProfile: 'max-capacity'`**, attached only to **applied, packed editor instances** (entries in `pack.cases[]`), never to case-library definitions, requested quantities, solver candidates, or a solution object:

- Set only at Apply time: `buildAppliedAutoPackCases()`, `src/screens/editor-screen.js:53-65` — `if (isMaxCapacity && next.placement === 'packed') next.packedProfile = 'max-capacity'; else delete next.packedProfile;`
- Never set during candidate/result generation: `buildAutoPackNextCases()` (`autopack-engine.js`) unconditionally deletes `packedProfile` on every generated result, even from a marked source (test `MAX-CAPACITY-B2`).
- Read via one guard everywhere: `instanceUsesMaxCapacityProfile(inst)`, `src/services/pack-library.js:1154-1160` — `Boolean(inst && inst.placement === 'packed' && inst.packedProfile === 'max-capacity')`. Absence or any other value defaults to `false` — never a silent true.

### Phase B contract — lifecycle, verified path by path

| Operation | Behavior | Evidence |
|---|---|---|
| AutoPack Apply (Max Capacity option) | Marker set on packed results only | `editor-screen.js:53-65`; `MAX-CAPACITY-B1` |
| Manual drag/rotate/nudge | Marker **unconditionally stripped** via `withoutPackedProfile()` before the manual move is validated/committed under normal rules | `editor-screen.js:67-71`, used by `applyInstancePatches`, `finishDrag`, `moveSelectionVertical`, group-drag fallback — confirmed by source read; **no test** exercises this directly (F4) |
| Undo/Redo | Marker is part of the full deep-cloned history snapshot | `state-store.js:23-30,77-91`; `MAX-CAPACITY-B11` |
| "Reset" | **No distinct operation found.** The only "Reset" in the app is an unrelated "Reset demo data" button (`app.js:4324-4339`) that wipes all local app state via `Storage.clearAll()` — not a pack-scoped concept | Ambiguous — flagged for V5/product clarification, not a code gap |
| Unpack All | Marker **unconditionally stripped** for every touched instance via `withoutPackedProfile` in `buildOrganizedUnpackStagingCases()` | `editor-screen.js:594-695`; confirms staged instances never carry the marker; **no test** in the durability spec exercises Unpack All directly (F5) |
| Save/reload | Plain serializable field; `storage.js` writes the pack straight to `localStorage` via `JSON.stringify`; `normalizer.js:226-229,289` re-derives/validates on load | Confirmed by source read; only the in-isolation normalizer path is tested (`MAX-CAPACITY-B3`), not a true storage round trip (F7) |
| Pack duplicate (`PackLibrary.duplicate`) | Correctly copied by value (primitive string) | `pack-library.js:2153-2168`; `MAX-CAPACITY-B11` |
| Within-pack instance duplicate | Deep-clones source; strips marker only if the duplicate lands `staged`; a duplicate landing `packed` **silently inherits** the marker without independent re-validation | `pack-library.js:901-952` (`buildSafeDuplicateInstances`); intentional-looking, unverified against a written spec (F8) |
| Export (pack/batch/app/workspace JSON) | `buildPackExportPayload()` shallow-spreads the pack, so `packedProfile` rides through unfiltered | `import-export.js:400-429`; confirmed round trip by `tests/audit/import-export.spec.mjs:30` |
| Import (current-format, exact `'max-capacity'` on a `packed` instance) | Preserved | `repairPackInstancePlacements()`, `pack-library.js:1085-1129`; `MAX-CAPACITY-B12` |
| Import (legacy/absent field, or any other value) | Correctly **defaults to not-relaxed** (`false`), never silently true | Same function, same test; genuinely-absent-key legacy case not separately asserted (test uses an explicit `'unsupported'` string, not a truly missing key) — low-risk gap |
| Import first-pass placement | `getSafeImportedPlacement()` checks truck-body intersection, zone containment, and overlap with already-placed imports — it does **not** consult support/stacking rules at all | `pack-library.js:621-632` — means a pre-Phase-B pack that depended on relaxed support relationships imports without immediate failure, but can later fail strict validation (and get staged) on a subsequent Truck Change or manual nudge, once its marker has defaulted to absent. This fails toward the safe/strict direction and is not a defect, but is a real, currently-undocumented behavior worth naming for QA (F9) |
| `reconcilePlacementsForTruck()` | Correctly preserves the marker for kept/adjusted/still-packed survivors (`applyCanonicalInstancePose` never touches `packedProfile`); deletes it only on transition to `staged` | `pack-library.js:1464-1670`; `MAX-CAPACITY-B4/B5/B5A/B10` |
| `repairInvalidPlacementsLocally()` | Same preservation pattern; additionally **reads** `instanceUsesMaxCapacityProfile()` as a repair-eligibility input, not just cosmetic carry-through | `pack-library.js:1846-1916`; `MAX-CAPACITY-B8/B9` |
| `repackInvalidPlacements()` (used by Truck Change, `truck-change-controller.js:317`) | Same code pattern as the two functions above (same `applyCanonicalInstancePose` deep-clone), so marker preservation is **inferred from code symmetry** — but **no test anywhere** (including `security-and-invariants.spec.mjs:9287,9289,9327,10479,11339`, all of which use unmarked fixtures) verifies it directly | (F6) — the one reconciliation path with zero direct proof |
| `canonicalCargoForStorage()` / `cargoComparisonKey()` | Operate exclusively on case-library **definitions** (dimensions, handling rules) — `packedProfile` does not appear anywhere in `cargo-canonical.js`; no interaction, no data-loss risk | Confirmed by grep across `src/` |

No aliasing/shared-reference bug was found anywhere in this chain — every relaxation and metadata-write step goes through a fresh shallow or deep clone (`{ ...item }`, `{ ...support, caseData: {...} }`, `JSON.parse(JSON.stringify(...))`), and this is directly asserted by `MAX-CAPACITY-B1`/`B2` ("generation must not mutate stored source cases") and the `AUTOPACK-MAX-A` suite's `maxAResultBytes`/byte-identity checks.

---

## C. Canonical Phase C definition (recommended)

**Metric:** number of currently **packed** editor instances in the active pack whose `packedProfile === 'max-capacity'`.

**Formally:** `pack.cases.filter(inst => !inst.hidden && instanceUsesMaxCapacityProfile(inst)).length`, computed **live inside the existing `computeStats()`** (`pack-library.js:2320-2390`), which already iterates `pack.cases` once per call and is already the single source every consuming surface (Editor Stats, Packs-screen badges, PDF summary) reads from.

**Why this is the right unit, given what's actually verified above:**

- "Case" = **applied editor instance currently in the `packed` state** (a `pack.cases[]` entry), matching the exact granularity the marker is attached at (Section B). It is not the case-library definition, not a requested quantity, not a solver candidate, and not a solution — none of those carry this metadata.
- **Only currently-applied packed instances count.** Staged, unresolved, hidden, and deleted instances never carry the marker by construction (Unpack, delete-repair-to-staged, and manual mutation all strip it — Section B), so they are naturally excluded with zero extra logic.
- **One instance = one count**, regardless of how many individual preferences were relaxed for it. The current data model stores only a boolean-equivalent marker (`packedProfile === 'max-capacity'` or not) — it does **not** persist which specific rules (stacking, orientation, weight, lane, priority) were relaxed for that instance. A per-rule breakdown ("count by rule," "total relaxed-rule applications") is **not derivable from current persisted data** without adding new metadata, which is out of the "small reporting follow-up" scope V5 Section 10 authorized. **Scope boundary: Phase C reports affected-instance count only, not a per-rule breakdown.**
- **Quantity expansion:** each requested quantity of a SKU already becomes its own independent instance with its own id before solving (confirmed via `autopack-item-builder.js` and the solver's per-`instanceId` placement model) — so multiple units of one case type each count independently if each is individually packed and marked. No double-counting risk: one placement = one instance = at most one count.
- **Manually moved/rotated/duplicated-then-modified instances** correctly fall out of the count automatically, because the existing stripping behavior (`withoutPackedProfile`) already runs on every manual mutation path — this requires zero new Phase C logic, it's inherited for free from Phase B.
- **Manually added cases** can never be marked (only `buildAppliedAutoPackCases` sets the field, only at AutoPack-apply time for the `max-capacity` option) — not a concern.
- **Undo/Redo, save/reload, duplicate, import/export** all already correctly carry or reset the underlying marker (Section B), so the derived count is automatically correct across all of them with no new persistence.

**Zero state:** hide the row/badge entirely rather than showing "0 cases…" — matches the existing conditional-row precedent already used for "Unresolved cases" in the Editor Stats card (`editor-screen.js:5322-5324`).

**Unknown/legacy/malformed state:** does not need a distinct UI state. The normalizer already resolves every case to a clean `true`/`false` via `instanceUsesMaxCapacityProfile()`'s `Boolean(...)` guard — there is no persisted tri-state to represent as "unknown." Absent or malformed data is already, correctly, indistinguishable from "not relaxed" (zero state).

**Derived vs. stored: derived, not stored.** A stored aggregate field would go stale on every manual edit, delete, Truck Change, Undo/Redo, or solution switch unless independently re-synced at each of those sites — exactly the "stale count" failure mode this audit was asked to check for. `computeStats()` is already re-invoked on every render path that needs current numbers, so deriving the count there costs one extra boolean check inside the loop it already runs, with no new persistence, no new export/import compatibility question (the underlying `packedProfile` field already round-trips correctly), and no staleness risk.

---

## D. Findings table

| ID | Severity | Category | Evidence | User impact | Phase C blocker? | Disposition |
|---|---|---|---|---|---|---|
| F1 | Low | Documentation | V5 `TP3D-MASTER-TODO-V5.md` Section 1, rule 12 ("Phase C remains blocked until billing reliability work is explicitly closed") and Section 10 ("Its implementation remains blocked by Section 6") both contradict Section 2 (status snapshot), Section 4 (active work: "Unblocked"), Section 6 (current blockers: "None remaining for Max Capacity Phase C"), and Section 9 (billing reliability formally closed) | None to end users; risk of a future agent/reader mis-reading V5 as still-blocked | No — confirmed unblocked by the document's own authoritative sections | Update Section 1.12 and Section 10 wording (see Section I) |
| F2 | Medium | Documentation / product-definition gap | `docs/engineering/autopack-engine-contract.md` never mentions "Max Capacity" anywhere (0 hits in 164 lines); Hard Rules list (line 42) states "child-vs-support weight check except pallet bypass behavior" with no stated Max Capacity carve-out, while `AUTOPACK-MAX-A` (`security-and-invariants.spec.mjs:20620`) proves this specific check is intentionally neutralized under Max Capacity | Anyone relying on the permanent contract doc alone would misunderstand current, tested, intended behavior | Not a blocker to Phase C's code, but directly affects what Phase C's UI copy should say (see F3) | Recommend adding an explicit "Max Capacity Contract" section to the engineering doc documenting the relaxable list and the weight-check carve-out — separate, small doc change, can land alongside or just before Phase C |
| F3 | Medium | UI/UX wording risk | Weight/crush relaxation between stacked items is functionally different in consequence from orientation/lane/priority relaxation, but both are currently described identically as "handling rules may be relaxed" (`solution.js:70`) | Generic wording could understate (to a logistics user) that load-bearing limits between stacked items were among the relaxed preferences | Ambiguous product decision, not a technical blocker | Get explicit product sign-off on final Phase C copy; recommend a short reassurance clause that physical containment/collision/support-fraction/retention were never relaxed (see Section E) |
| F4 | Low | Missing test | No test exercises manual drag/rotate/nudge stripping `packedProfile` (`withoutPackedProfile()`, `editor-screen.js:67-71`, used by `applyInstancePatches`/`finishDrag`/`moveSelectionVertical`) | Behavior is correct by source read; without a test it can silently regress | Not a blocker, but Phase C makes this path's correctness user-visible for the first time via a persistent count | Add regression test before/alongside Phase C |
| F5 | Low | Missing test | No test in `max-capacity-durability.spec.mjs` exercises Unpack All (`buildOrganizedUnpackStagingCases`) stripping the marker on a mix of relaxed/non-relaxed instances | Same as F4 | Same as F4 | Add regression test before/alongside Phase C |
| F6 | Medium | Missing test | `repackInvalidPlacements()` (`pack-library.js:1997-2057`, used by Truck Change via `truck-change-controller.js:317`) is the one of three reconciliation functions with **zero** test verifying marker preservation — every existing caller in `security-and-invariants.spec.mjs` (lines 9287, 9289, 9327, 10479, 11339) uses unmarked fixtures; preservation is inferred only from code symmetry with the two sibling (tested) functions | Truck Change is a common user action; if this path silently drops the marker, Phase C's count would incorrectly zero out on Truck Change | Not a blocker, but the highest-priority test gap to close given how load-bearing Truck Change is | Add a direct regression test exercising `repackInvalidPlacements` with a marked instance before/alongside Phase C |
| F7 | Low-Medium | Missing test | No test exercises a true `localStorage` save/reload round trip through `core/storage.js`; only the isolated normalizer function (`MAX-CAPACITY-B3`) and in-memory `StateStore` snapshots (`MAX-CAPACITY-B11`) are tested | Low risk (storage.js does a plain unfiltered `JSON.stringify`/normalizer round trip), but literally the scenario Phase C's persistent count depends on across sessions | Not a blocker | Add regression test before/alongside Phase C |
| F8 | Low | **SUPERSEDED — see note at top of document** | A within-pack instance duplicate that lands `packed` silently inherits the source's marker with no independent re-validation (`pack-library.js:901-952`) | Looks correct (identical validated geometry) but was unverified against a written spec at the time this was written | No | **Resolved by [Packed-Profile Semantics Audit](./max-capacity-phase-c-packed-profile-semantics-audit-2026-07-18.md) Section E: current behavior is correct (Contract C). No change approved.** |
| F9 | Low | Non-obvious existing behavior (not a defect) | `getSafeImportedPlacement()` (`pack-library.js:621-632`) never checks support/stacking rules on first-pass import placement, so a legacy pre-Phase-B pack that relied on relaxed support relationships imports without immediate failure but can later be staged by a subsequent Truck Change/manual nudge once its marker defaults to absent | Fails toward the safe/strict direction; could look like "new" staging behavior to QA testing old exported packs | No — reduces, not increases, risk to Phase C's count accuracy | Document as known behavior; no code change needed |
| F10 | — | Confirmed acceptable | V5 Section 4/10 scope for Phase C ("reporting follow-up only... without UI redesign or legal, axle, or DOT claims") maps cleanly onto what the current metadata/architecture actually supports | — | — | No action; confirms scope is realistic |

---

## E. UI/UX recommendation

**Surface:** the existing Editor Stats card (`renderTruckInspector()`, `editor-screen.js:5098+`, stats block ~L5318-5336) — the same `<div class="row space-between"><span class="muted ...">Label</span><b class="...">Value</b></div>` pattern already used for "Cases loaded," "Packed," and the conditional "Unresolved cases" row. This is the smallest compatible surface: it already aggregates from `computeStats()`, already has a precedent for a conditionally-shown advisory row, and requires no new component.

**Proposed wording:**
- Row label: `Relaxed handling` (kept short to match the existing label style, e.g. "Packed," "Volume used").
- Value: the count, e.g. `3`.
- Singular: not needed as separate copy if the row is just `Label: N` (matches existing style, which doesn't special-case "1" elsewhere in this card either — e.g. "Packed: 1" reads fine).
- Zero state: **hide the row entirely** (matches the existing conditional "Unresolved cases" row precedent).
- Unknown state: not applicable — no unknown state exists in the underlying data (Section C).
- Tooltip (reuse the existing `cardHeaderWithInfo()` / `[data-tooltip]` pattern already used elsewhere in this same card, e.g. `editor-screen.js:5111,5360`): short text adapted from the existing Results-panel description, with an explicit safety reassurance given F2/F3, e.g. *"These cases were packed using Max Capacity, which relaxes non-physical handling preferences (like stacking limits and orientation) to fit more cargo. Physical safety rules — containment, collisions, support, and retention — are never relaxed."*

**Reused existing patterns** (no new component invented):
- `.tp3d-handling-chip` / `.tp3d-handling-chip-instance` (`main.css:4664-4682`) is the closest existing precedent for "a fact scoped to this specific applied instance" if a per-instance chip is ever wanted in the Single Inspector (`renderSingleInspector`, `editor-screen.js:5609+`) — optional, not required for the count requirement, but available if V5 wants both an aggregate count and a per-instance marker later.
- `.badge` (`main.css:960-991`) — Packs-screen already has an established "Packed: X/Y"-style count-badge pattern (`packs-screen.js:1279-1307`), gated by a `badgePrefs.show*` toggle, if V5 later wants this surfaced on the Packs list/grid too. Not required for the MVP scope.

**Accessibility:** the existing `.row.space-between` rows and `[data-tooltip]` system already carry appropriate `aria-label`/title attributes elsewhere in this card (e.g. `apply.title`/`aria-label` pattern at `editor-screen.js:3955-3959`) — reuse the same attribute pattern, no new accessibility work needed.

**Mobile/narrow layout:** the stats card already uses the same row pattern at all breakpoints; no additional layout work implied.

**Wording risk to avoid:** do not phrase this as "N cases don't meet handling rules" or anything implying non-compliance — the existing precedent (`solution.js:70`) already threads this correctly ("Not a transport recommendation"). Do not reference weight, crush, DOT, axle, or legal terms at all, consistent with V5's explicit Phase C scope boundary.

---

## F. Implementation recommendation

**Exact likely files (minimal path):**

1. `src/services/pack-library.js` — extend `computeStats()` (`pack-library.js:2320-2390`) to add one derived field, e.g. `relaxedHandlingCount`, incremented inside the existing `(pack.cases || []).forEach(...)` loop alongside `packedCases++` (same branch, same guard conditions — no new iteration). Reuses the existing `instanceUsesMaxCapacityProfile()` guard (`pack-library.js:1154-1160`); may need to export it if not already exported for this use.
2. `src/screens/editor-screen.js` — `renderTruckInspector()` stats block (~L5318-5336): add one conditional row, shown only when `stats.relaxedHandlingCount > 0`, using the existing "Unresolved cases" conditional-row pattern as the template.
3. `src/app.js` — `generatePDF()` SUMMARY block (~L3915-3950, gated by existing `prefs.export.pdfIncludeStats`): optionally add one line reusing the same `stats.relaxedHandlingCount` value, if V5 wants export parity with the live UI. Not required for MVP if V5 wants UI-only for the first pass.

**Data derivation:** live, inside `computeStats()`, from the already-durable `pack.cases[].packedProfile` field. No new persisted field, no schema change, no new solver/engine output.

**Persistence/export implications:** none required. `buildPackExportPayload()` (`import-export.js:400-429`) already carries `packedProfile` through unfiltered (confirmed by `tests/audit/import-export.spec.mjs:30`); a derived-only count needs no export change and creates no new backward-compatibility surface beyond what Phase B already established.

**Regression boundaries — must remain untouched:**
- `src/services/autopack-solver.js` (solver geometry, relaxation logic, hard-rule validation)
- `src/services/autopack-engine.js` (orchestration, candidate/result generation)
- `src/services/pack-library.js`'s actual relaxation/reconciliation logic (`applyMaxCapacityRuleProfile` equivalents, `projectMaxCapacitySupportRecords`, `reconcilePlacementsForTruck`, `repairInvalidPlacementsLocally`, `repackInvalidPlacements`) — Phase C only **reads** their existing output via `instanceUsesMaxCapacityProfile`, no logic change
- `src/services/import-export.js` (no new field needed)
- `src/core/operation-lifecycle.js` (not relevant — this is a derived read, not a mutating operation)
- `src/ui/truck-change-controller.js`, Supabase/billing/workspace files, `src/core/storage.js` internals — no changes needed

**Tests required before merge:** see Section G.

---

## G. Validation plan

**Targeted automated tests (new, closing Section D gaps):**
- Manual drag/rotate/nudge strips `packedProfile` (closes F4)
- Unpack All strips `packedProfile` across a mix of relaxed/non-relaxed instances (closes F5)
- `repackInvalidPlacements()` preserves `packedProfile` for a valid marked survivor through a Truck Change, and strips it for one that becomes staged (closes F6)
- True `localStorage` save/reload round trip preserves `packedProfile` and the derived count (closes F7)

**New tests for the Phase C count itself:**
- Zero relaxed instances → row hidden / count is `0`/absent from stats
- One relaxed instance → count is `1`
- Multiple relaxed instances → count matches exactly
- One instance relaxing multiple underlying preferences → still counted once (not per-rule)
- Mixed strict and relaxed placements in the same pack → count reflects only the relaxed subset
- Multiple quantities of one SKU, some packed/some staged → only packed+marked instances count
- Switching between AutoPack result options before Apply → count does not change until Apply commits
- Applying a non-Max-Capacity solution after previously applying Max Capacity → count reflects the newly-applied (unmarked) state
- Unpack All → count returns to `0`
- Undo/Redo → count follows the restored snapshot exactly
- Save/reload → count is stable across a real persistence round trip
- Duplicate project/pack → duplicate's count is correct and independent of the original
- Import/export round trip → count on reimport matches pre-export count
- Malformed/absent legacy metadata on import → counts as not-relaxed, no crash, no false positive
- Manually moving/rotating/deleting a previously-relaxed instance → count decrements correctly
- Confirm the count derivation never mutates `pack.cases` or solver output (purity, matching the existing `MAX-CAPACITY-B1`/`B2` non-mutation pattern)
- UI: zero-state row is hidden; non-zero renders the exact count; tooltip text renders and matches approved copy

**Full regression gates (per repo standard):** `npm test`, `npm run -s typecheck`, `npm run lint`, `git diff --check`, `git diff --cached --check` when staged.

**Browser/manual checks:** open the Editor Stats card with (a) a pack with zero Max Capacity applies, (b) a pack with a mixed Max Capacity apply, (c) after Unpack All, (d) after Undo following a Max Capacity apply, (e) after a Truck Change that both keeps some relaxed instances and stages others, (f) after reload from `localStorage`, (g) after import of a freshly-exported pack, (h) after import of an older/legacy pack predating Phase B (or a hand-edited fixture simulating one).

**Import/export and persistence checks:** export a pack containing relaxed instances, re-import it, confirm the count matches; confirm a pack with a manually-edited/foreign `packedProfile` value imports without the count incorrectly including it.

---

## H. Proposed branch name and commit plan

*(Not created in this audit run.)*

- Branch: `feat/max-capacity-phase-c-relaxed-handling-report`
- Commit 1: add the four missing regression tests (F4–F7) against current behavior — no production code change, proves the existing lifecycle is correct before building on top of it.
- Commit 2: add `relaxedHandlingCount` (or equivalent) to `computeStats()` plus its dedicated tests (Section G, second bullet list).
- Commit 3: add the Editor Stats card conditional row and its tests/manual verification.
- Commit 4 (optional, only if V5 confirms scope): PDF summary line.
- Separate, small doc-only commit (can land independently, does not need to be on this branch): add the Max Capacity carve-out to `docs/engineering/autopack-engine-contract.md` (closes F2).

---

## I. V5 update recommendation

After this audit is approved, update `docs/product/TP3D-MASTER-TODO-V5.md`:

1. **Section 1, rule 12** — replace *"Max Capacity Phase C remains blocked until billing reliability work is explicitly closed"* with a statement matching the document's own current status (billing reliability is closed; Phase C is unblocked and next in the approved queue), to remove the contradiction with Sections 2/4/6/9 (Finding F1).
2. **Section 10** — replace *"Its implementation remains blocked by Section 6."* with a reference to this audit document and the readiness conclusion above (approve-with-conditions), consistent with Section 6's own current text ("None remaining for Max Capacity Phase C... has no approved active branch yet and has not started").
3. **Section 4 (Active Work table)** — once implementation begins, set Branch to `feat/max-capacity-phase-c-relaxed-handling-report` (or the team's chosen name) and update Outcome/Blocker state per Section 16's update rules (replace stale status, do not append).
4. **Section 7 (Recently Completed Milestones)** — add this audit as a linked evidence row once acted upon, per this document's path.

---

## J. Geometry / space-type compatibility audit (extension, 2026-07-18)

Scope: verify the Phase A/B → Phase C flow behaves identically across every supported space type — standard/default presets, every built-in preset, custom-size spaces, Wheel Wells, Front Overhang, and any combination — with no geometry-specific code path required for Phase C. Read-only; no code changed.

### J.1 The actual space-type model

Confirmed by direct source read across `src/data/trailer-presets.js`, `src/data/models/pack.model.js:22-25`, `src/services/pack-library.js:76-80,2078-2081`, and `src/core/defaults.js:200` — the same three-value guard (`mode === 'wheelWells' || mode === 'frontBonus' || mode === 'rect'`, fallback `'rect'`) is enforced identically at every layer that reads `truck.shapeMode`:

- **`rect`** — Standard/High-Cube/every other length-only preset (the 53' Standard, 53' High Cube, 48'/40'/26'/24'/20' straight trucks, cargo van, etc. in `trailer-presets.js` are all `shapeMode: 'rect'`, differing only in `length`/`width`/`height` numbers).
- **`wheelWells`** — one preset ("53' Wheel Wells") plus any custom truck a user sets this mode on.
- **`frontBonus`** (Front Overhang) — one preset ("53' Front Overhang / Bonus") plus any custom truck a user sets this mode on.

**There is no fourth "combination" mode.** `truck.shapeMode` is a single string field; a truck cannot be Wheel Wells and Front Overhang simultaneously in the current data model or geometry functions (`getTrailerUsableZones()`, `pack-library.js:172-219`, has exactly three `if (mode === ...)` branches, mutually exclusive, with the same function for all three). "Any combination the product supports" therefore reduces to: **one shape mode + arbitrary dimensions**, since dimensions and shape mode are orthogonal, independently-settable fields on the same `truck` object — a user can pick Wheel Wells and then type fully custom length/width/height, or Front Overhang with custom `bonusLength`/`bonusHeight`/well geometry via `shapeConfig`. No separate "custom" code path exists: `getDims(truck)` (`pack-library.js:68-74`) reads raw numbers regardless of whether they came from a preset object or user input, and every geometry function downstream takes those numbers, not a preset reference.

### J.2–J.5 — Findings against the six audit questions

**1. Is Max Capacity metadata generated identically across layouts?**
Yes, verified by exhaustive grep: every one of the 17 `packedProfile` read/write sites in `src/services/autopack-engine.js`, `src/services/pack-library.js`, `src/screens/editor-screen.js`, and `src/core/normalizer.js` branches only on `inst.placement` (`'packed'`/`'staged'`) and the string value itself — none references `shapeMode`, `truck.length/width/height`, wheel-well config, or front-bonus config. The marker-write function (`buildAppliedAutoPackCases`, `editor-screen.js:53-65`) and the marker-read guard (`instanceUsesMaxCapacityProfile`, `pack-library.js:1154-1160`) are pure functions of the instance object, not the truck. Solver-side relaxation (`applyMaxCapacityRuleProfile`, `autopack-solver.js:406-423`) likewise operates per-item and never reads `truck`.

**2. Does relaxed-handling metadata survive the full lifecycle identically across layouts?**
Yes, for the same reason: every lifecycle function audited in Section B (candidate generation, solution generation/selection, Apply, save/load, Undo/Redo, duplication, import/export, Unpack, editor mutations) reads/writes `packedProfile` through the same shape-blind code paths regardless of which `zones`/`wheelWell` geometry was used to place the instance. The one place shape *does* matter — `reconcilePlacementsForTruck()`/`repairInvalidPlacementsLocally()`/`repackInvalidPlacements()` deciding whether a placement is still valid after a Truck Change — correctly re-runs `aabbIsFullyValid()` (`pack-library.js:1247-1263`) with the *new* truck's zones/wheel-well/blocked-body geometry, and only then decides keep-vs-stage; the marker itself is preserved or stripped by the same `placement === 'staged'` branch used for every shape (`pack-library.js:1633-1643`). "Reset" remains an unresolved, non-pack-scoped concept (Section B) independent of shape — not a shape-specific gap, the same open question from the base audit.

**3. Do reporting counts remain correct across every listed geometry scenario?**

| Scenario | Verified behavior |
|---|---|
| Placements above/beside wheel wells | `getTrailerUsableZones()` for `wheelWells` returns 5 zones (rear floor, center channel, raised left/right shelves, front floor) — an instance's "packed" classification (`isAabbInsideTruckGeometry`, `pack-library.js:1242-1245`) is contained-in-any-zone OR inside truck-minus-blocked; this is the same single function used for every shape, so the Phase C count (built on the same packed/staged classification `computeStats()` already uses) needs no wheel-well-specific logic. |
| Bridge-supported placements | `enableWheelWellBridge: mode === 'wheelWells'` (`autopack-engine.js:914`) is a **shape-driven** flag applied uniformly to every AutoPack strategy (not a Max-Capacity-only behavior) — `findWheelWellBridgePlacement()` (`autopack-solver.js:2762`) participates in placement *regardless* of `maxCapacityMode`. Bridging and rule-relaxation are orthogonal axes; a bridge-supported instance is marked `packedProfile: 'max-capacity'` only if it came from the Max Capacity solve, exactly like any other instance — no special interaction found. |
| Wheel-well support rules participating in placement decisions | `aabbIsFullyValid()` routes support validation through `isWheelWellSupportedAndStable()` when `wheelWell` is truthy, else `aabbIsSupported()` — but in both branches the *only* input that changes with Max Capacity is `physicalSupportRecords = projectMaxCapacitySupportRecords(candidate, accepted)` (relaxes `noStackOnTop`/`stackable`/`maxStackCount`/`isPallet` only between two mutually-marked instances); blocked-body exclusion, containment, overlap, and retention checks are ANDed unconditionally in the same expression (`pack-library.js:1257-1262`), independent of shape or profile. |
| Front Overhang retained cargo | `evaluateFrontOverhangRearRetention()` (`pack-library.js:340-389`) is shape-gated (`getFrontOverhangRetentionGeometry` returns `null` for non-`frontBonus` trucks, at which point retention is trivially `retained: true`/not required) but is never gated by `maxCapacityMode`. Test `AUTOPACK-MAX-A ... in all truck modes` explicitly proves a Max Capacity deck placement still records its real `retentionDependencies` entry (`frontResult.retentionDependencies.get('deck') === ['fixed-wall']`). |
| Front Overhang restrictions eliminating candidate placements | Cab-void exclusion (`getFrontBonusBlockedZones`/`aabbIntersectsFrontBonusBlockedBody`) runs unconditionally; an eliminated candidate simply never becomes a placement, so it never reaches the marker-assignment step at all — no count-correctness risk, since the count only ever sums over instances that already exist in `pack.cases`. |
| Custom dimensions significantly changing the solution | Since custom dimensions flow through the identical `getDims()`/zone-building functions as preset dimensions (Section J.1), a "significantly different" solution is just a different set of `pack.cases[]` entries — the counting formula (`filter(instanceUsesMaxCapacityProfile).length`) is dimension-agnostic by construction; nothing in the marker or `computeStats()` path reads absolute size. |
| Same cargo packed into different space geometries | Each AutoPack run is a fresh, independent `solveAutoPack()` call (Section B) with no state carried between geometries; re-applying Max Capacity to the same cargo in a different truck produces an independent `pack.cases[]` set and an independently-correct derived count — confirmed by the existing Truck Change tests (`MAX-CAPACITY-B10`) which already cover a marked pack surviving a truck swap (using `RECT_TRUCK` → a smaller `RECT_TRUCK` variant; not yet a cross-shape-mode swap — see Finding F11 below). |

**4. Does Phase C reporting depend on anything geometry-specific?**
No. The recommended metric (Section C) is `pack.cases.filter(inst => !inst.hidden && instanceUsesMaxCapacityProfile(inst)).length` — a pure function of each instance's `placement` and `packedProfile` string fields. It reads no absolute coordinate, no truck preset name, no `truck.length/width/height`, no wheel-well config, no front-overhang config, no support topology, and no `shapeMode`. The only geometry-touching step in the whole pipeline is the pre-existing, shape-agnostic-by-interface `isAabbInsideTruckGeometry()` call inside `computeStats()` that decides packed-vs-staged in the first place — a decision Phase C inherits for free rather than re-implementing.

**5. Does any layout cause double counting, missing counts, stale counts, metadata loss, inconsistent persistence, or inconsistent UI reporting?**
None found, for the same structural reason: there is exactly one instance object per physical placement (`pack.cases[]`, keyed by `instanceId`), exactly one marker field per instance, and exactly one aggregation point (`computeStats()`) reading it — regardless of shape. Because the marker-lifecycle code (Section B, J.2) never branches on shape, none of the failure modes checked for in the base audit (Findings F4–F9) are shape-dependent; they are lifecycle-dependent (manual mutation, Unpack, Truck Change, save/reload) and apply identically whether the truck is `rect`, `wheelWells`, or `frontBonus`. A stale count after a **shape change** (e.g., switching a truck from `rect` to `wheelWells` mid-pack) is exactly the general "stale count after layout change" case already covered by Truck Change reconciliation (`reconcilePlacementsForTruck`) and Finding F6 (missing direct test for `repackInvalidPlacements()` marker preservation) — no *additional* shape-specific risk beyond F6 was found, but F6 becomes more consequential in light of this extension since a shape-mode change is exactly the kind of Truck Change most likely to invalidate wheel-well/front-overhang-dependent placements.

**6. Do Wheel Wells and Front Overhang remain hard physical constraints under Max Capacity, and does Phase C ever imply otherwise?**
Confirmed hard, for both shapes, by direct code structure and by tests:
- `aabbIntersectsWheelWellBlockedBody()` and `aabbIntersectsFrontBonusBlockedBody()` are ANDed unconditionally in `aabbIsFullyValid()` (`pack-library.js:1257-1259`) — never gated by `candidate`'s max-capacity marker.
- `isWheelWellSupportedAndStable()` (`wheel-well-model.js:249-257`) takes a `candidateItem` only to neutralize the *weight* sub-check (the same weight-zeroing behavior documented in Finding F2 of the base audit) — body-intersection, support-fraction, and CoM/overhang stability are pure geometry, verified unaffected by the dedicated `AUTOPACK-MAX-A ... in all truck modes` test (`security-and-invariants.spec.mjs`), which explicitly asserts `'Max still rejects a half-channel cantilever whose COM/overhang is unsafe'` even under `maxCapacityMode: true`.
- `evaluateFrontOverhangRearRetention()` has no profile parameter anywhere in its signature or call chain; the same `AUTOPACK-MAX-A` test proves a Max Capacity deck placement still requires and records real retention.
- Durability test `MAX-CAPACITY-B7A` (base audit, Section B) independently confirms the *marker itself* (`packedProfile`) never bypasses wheel-well body exclusion or front-overhang retention during reconciliation, not just during solving.
- Phase C's recommended UI copy (Section E of the base audit) already includes an explicit reassurance clause for this reason; this extension reinforces that the clause must not be watered down, since it is now doubly confirmed across all three shapes, not just the default rectangular one.

**Distinguishing the three categories, per the request:**
- **Physical placement constraints (never relaxed, any shape):** containment, collision, wheel-well blocked-body exclusion, front-overhang cab-void exclusion, support *footprint fraction*, CoM/overhang stability, front-overhang rear retention, canonical orientation geometry.
- **Handling preferences (relaxable under Max Capacity, any shape):** `noStackOnTop`/`stackable`, `maxStackCount`, child-vs-support *weight/crush* comparison (see base-audit F2/F3 — this one sits closest to the line and needs the reassurance-copy treatment), `laneItem`, `loadPriority`, `orientationLock`/`canFlip`/`orientationLocked`.
- **Reporting metadata (Phase C):** the single derived count described in Section C — depends only on `placement` + `packedProfile` on each applied instance, never on which of the two categories above produced a given placement's geometry.

### J.6 New/adjusted finding

| ID | Severity | Category | Evidence | User impact | Phase C blocker? | Disposition |
|---|---|---|---|---|---|---|
| F11 | Low | Missing test | `MAX-CAPACITY-B10` (Truck Change preservation) uses a `rect`→smaller-`rect` swap only; no existing durability test swaps a marked pack **across shape modes** (e.g., `rect`→`wheelWells`, or `wheelWells`→`frontBonus`) to directly verify marker survival/correct-stripping through `reconcilePlacementsForTruck`/`repackInvalidPlacements` when the target geometry's blocked zones newly invalidate some marked placements | Cross-shape Truck Change is a realistic user action (e.g., swapping to a Wheel Wells trailer mid-project); if marker handling silently broke only on a shape change, same-shape tests would not catch it | Not a hard blocker (the underlying reconciliation function is shape-parameterized, not shape-specific, and is otherwise well-tested), but raises the priority of closing Finding F6 (`repackInvalidPlacements` marker-preservation) specifically with a cross-shape fixture, not just a same-shape one | Extend the F6 test (or add one alongside it) to cover at least one cross-shape-mode Truck Change with a mix of marked instances that survive and marked instances that must be staged by the new geometry |

### J.7 Conclusion for this extension

**One canonical implementation, no geometry-specific code path required.** The Phase C count (Section C of the base audit) can and should be implemented exactly once, inside the existing shape-agnostic `computeStats()`, with zero branching on `truck.shapeMode`, preset identity, or dimensions. This is not a design choice being recommended for convenience — it is a direct consequence of how Phase A/B already built the marker pipeline: every write, read, and lifecycle-preservation site already ignores geometry entirely, and the one place geometry legitimately matters (packed-vs-staged classification, and hard-rule validity during reconciliation) is a pre-existing shared function Phase C only needs to consume, never re-implement.

The only action items this extension adds to the base audit's conditions are: (a) treat Finding F6 (missing `repackInvalidPlacements` marker-preservation test) as higher priority given it is the exact function a cross-shape Truck Change would exercise, and (b) add the cross-shape-mode test variant captured as Finding F11.

---

## Compatibility matrix — every supported space/layout

| Space / layout | Metadata generated identically | Survives full lifecycle | Reporting count correct | Hard constraints proven intact | Status |
|---|---|---|---|---|---|
| Standard/default preset (53' Standard, `rect`) | Yes | Yes | Yes | Yes | **Verified** |
| Every other `rect` built-in preset (High Cube, 48'/40'/26'/24'/20' straight, cargo van, etc.) | Yes (identical code path, different numbers only) | Yes | Yes | Yes (same geometry functions as Standard) | **Verified** |
| Custom-size space, `shapeMode: 'rect'` | Yes (no code path distinct from presets) | Yes | Yes | Yes | **Verified** |
| Wheel Wells preset (53' Wheel Wells) | Yes | Yes (`MAX-CAPACITY-B7A`, `AUTOPACK-MAX-A` wheel-truck case) | Yes | Yes (`AUTOPACK-MAX-A` cantilever/COM assertion) | **Verified** |
| Wheel Wells, custom dimensions/`shapeConfig` | Yes (same functions, custom numbers) | Yes (same code path as preset Wheel Wells) | Yes | Yes | **Verified by code-path identity; no dedicated custom-dimension Wheel Wells test exists** — **Needs testing** (low priority; not a distinct code path) |
| Wheel-well bridge-supported placements (`enableWheelWellBridge`) | Yes (marker assignment independent of bridge flag) | Yes | Yes | Yes (bridge is a placement-generation detail, not a hard-rule exception) | **Verified** |
| Front Overhang preset (53' Front Overhang/Bonus) | Yes | Yes (`MAX-CAPACITY-B7A`, `AUTOPACK-MAX-A` front-truck case with retaining wall) | Yes | Yes (retention dependency proven recorded under Max Capacity) | **Verified** |
| Front Overhang, custom `bonusLength`/`bonusHeight` | Yes (same functions, custom numbers) | Yes (same code path as preset Front Overhang) | Yes | Yes | **Verified by code-path identity; no dedicated custom-dimension Front Overhang test exists** — **Needs testing** (low priority) |
| Front Overhang cab-void-eliminated candidates | Yes (eliminated candidates never reach the marker step) | N/A (never placed) | Yes (nothing to miscount) | Yes | **Verified** |
| Simultaneous Wheel Wells + Front Overhang ("combination") | N/A — **does not exist as a product state**; `shapeMode` is a single mutually-exclusive field | N/A | N/A | N/A | **Not applicable — confirmed unsupported by the data model, not a gap** |
| Same-shape Truck Change (e.g., `rect` → smaller `rect`) with marked cargo | Yes | Yes | Yes | Yes | **Verified** (`MAX-CAPACITY-B10`) |
| Cross-shape Truck Change (e.g., `rect` → `wheelWells`, or `wheelWells` → `frontBonus`) with marked cargo | Yes (same code path, inferred) | Inferred from code symmetry, **not directly tested** | Inferred, **not directly tested** | Inferred, **not directly tested** | **Needs testing** — Finding F11 |
| `repackInvalidPlacements()` specifically (any shape, used by Truck Change) | Inferred from code symmetry with tested sibling functions | Inferred, **not directly tested for any shape** | Inferred | Inferred | **Needs testing** — Finding F6 (base audit), reinforced by F11 |
| Weight/crush relaxation wording vs. Wheel Wells/Front Overhang geometry (documentation) | N/A | N/A | N/A | Behavior confirmed correct; **documentation** (`autopack-engine-contract.md`) does not currently carve out the exception | **Requires a product decision** — Finding F2/F3 (base audit): approve final Phase C copy and (recommended, separate, small change) update the engineering contract doc |

---

## Scope-control review (explicitly rejected from this audit and from Phase C)

Not touched, not recommended, and out of scope for Phase C: solver strategy changes; additional relaxed rules; AutoPack quality/scoring improvements; UI redesign; CoG/axle calculations; DOT/legal claims; sharing/publishing; friendly slugs; billing; Supabase schema; broad persistence refactors; Web Worker/InstancedMesh/performance architecture. No code path touching any of these was modified or needs to be modified for this feature.

---

## Final recommendation

**APPROVE WITH CONDITIONS.**

Conditions: (1) reconcile V5's internal blocker contradiction (F1) before opening the branch; (2) land the missing regression tests (F4–F7, F11) before or alongside the Phase C branch — F6/F11 (Truck-Change reconciliation marker preservation, including at least one cross-shape-mode swap) is the single highest-priority gap after this extension; (3) get product sign-off on the exact Phase C copy given the weight/crush relaxation nuance (F2/F3), which the geometry extension (Section J) confirms applies identically under Wheel Wells and Front Overhang; (4) implement the count as a **derived**, not stored, field per the canonical definition in Section C, in the three files listed in Section F, touching nothing in the solver/engine/relaxation-logic layers, and with **no geometry-specific branching** — Section J confirms one implementation is correct for every supported space type, including custom dimensions, and that a simultaneous Wheel Wells + Front Overhang "combination" does not exist as a product state.
