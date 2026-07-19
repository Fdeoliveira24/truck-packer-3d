# Max Capacity Phase C — Packed-Profile Semantics Audit

**Date:** 2026-07-18
**Branch:** `audit/max-capacity-phase-c-profile-semantics`
**Type:** Audit, product-contract decision, documentation correction, and behavior-characterization plan. No Phase C UI implemented. No solver, geometry, or physical-validity change. No merge.

This audit supersedes the semantics conclusions of the earlier [Max Capacity Phase C — Readiness Audit](./max-capacity-phase-c-readiness-audit-2026-07-18.md) on the single question of what `packedProfile: 'max-capacity'` means and whether the duplicate-inherits-marker behavior is a defect. That document's geometry-independence findings, physical-safety findings, and general lifecycle trace remain valid and are not repeated in full here except where this audit adds or corrects them.

---

## A. Executive decision

**APPROVE WITH CONDITIONS** — approve the packed-profile contract, wording, and count-source decisions below now; gate the `feat/max-capacity-phase-c-reporting` implementation branch on the conditions in Section L.

Confidence: high. The central open question from prior audit rounds — whether an unconditional "strip `packedProfile` on every duplicate" fix is safe — is no longer a judgment call. It was tested directly against the real `pack-library.js` code (not simulated), and the answer is **no, it is not safe as a blanket rule**. Section E has the evidence. This changes the recommended fix from "one line, always delete" to "no fix — current behavior is correct and must not be changed."

---

## B. Recommended permanent `packedProfile` contract

**`packedProfile: 'max-capacity'` means: this applied, currently-packed instance is a member of the Max Capacity handling profile, and must be evaluated under that profile's relaxed cargo-handling preferences wherever relaxed evaluation is relevant (support/stacking checks, orientation-policy checks).** It is not a claim that this specific instance's specific placement individually required every — or any — relaxed preference. It is set only at Max Capacity Apply time and is revoked exactly by three triggers: (1) the instance transitions to `staged` for any reason, (2) the instance is deliberately re-validated under strict/normal rules by a manual edit (drag, rotate, nudge, flip, Inspector position Apply — all route through `withoutPackedProfile()`/`buildNormalHandlingPack()`), or (3) a non-Max-Capacity solution is applied. It is otherwise carried forward unconditionally and mechanically (never re-derived from a live "is this still needed" check) through duplication, Truck Change reconciliation, repair, repack, save/reload, Undo/Redo, and import of packs that already carry it.

This is **Contract C (Active profile membership), with an explicit, exhaustive revocation-trigger list**, not Contract A or Contract B in their pure forms. See Section C for why.

---

## C. Comparison of Contracts A, B, and C

**Contract A — Origin provenance.** Falsified by direct evidence. A within-pack duplicate was never itself "applied from a Max Capacity AutoPack result" — it was created by a manual Duplicate action — yet a packed duplicate of a marked instance inherits the marker (Section E, scenarios A/B/C, all reproduced against real code). "Origin provenance" undersells what the field does: it isn't a historical record, it's actively consumed at validation time to change pass/fail outcomes (Section E, scenario C). Pure provenance framing would also fail to explain why the marker is *revoked* by a manual edit that doesn't change "origin" in any sense.

**Contract B — Current relaxed-validation requirement.** Falsified by direct evidence in the *other* direction. Scenarios A and B (Section E) prove the system routinely carries the marker on instances whose current placement needs no relaxation at all — an open-floor duplicate and a duplicate resting on a fully permissive support both keep the marker, and stripping it changes nothing about their validity. If Contract B were the real rule, the system would need to *prove* necessity per instance before marking it, and *continuously re-verify* that necessity on every operation. No code path does this anywhere in the trace (`applyMaxCapacityRuleProfile()` relaxes every item in a solve uniformly, not selectively; nothing re-derives the marker from a live strict-vs-relaxed check). Building Contract B as new behavior would also be materially more invasive than what exists today.

**Contract C — Active profile membership.** Matches actual, tested behavior with no gaps found: the marker is set at one clear moment (Apply), consumed at validation time by `supportCanCarry()`/`maxCapacitySupportRelationship()` and `projectMaxCapacitySupportRecords()` (proven load-bearing in Section E scenario C), and cleared by a short, explicit, already-implemented list of triggers rather than by continuous re-derivation. This is also the framing the owner's preferred UI copy already assumes — "This result used the more permissive Max Capacity handling profile" is a membership statement, not an individual-necessity claim.

**Is `packedProfile` serving two incompatible purposes (reporting provenance vs. permission for relaxed revalidation)?** No. Under Contract C these are the same purpose observed from two call sites: the field means "current profile membership," and both the Phase C count (a *report* of current membership) and `supportCanCarry()` (a *consumer* of current membership, to decide whether relaxed rules apply) read the identical, single fact. The apparent conflict only exists if you first assume Contract A (pure provenance, no live permission implication) or Contract B (pure current-need) and then notice the code doesn't cleanly fit either — it fits Contract C cleanly. **No new persisted field, no split into separate provenance/validation metadata, is needed.** One clarified field, under Contract C, is sufficient — confirmed by exhaustively tracing every set/read/preserve/delete site (Section D) and finding no site that needs a second, different fact.

---

## D. Current behavior matrix

All rows confirmed by direct source read this session, several corrected from prior audit rounds' assumptions (marked *corrected*).

| Operation | packedProfile outcome | Mechanism |
|---|---|---|
| Max Capacity Apply | Set on packed results only | `buildAppliedAutoPackCases()`, `editor-screen.js:53-65` |
| Normal-strategy Apply | Deleted from all instances | Same function, `isMaxCapacity` false branch |
| Preview/result generation (before Apply) | Never set | `buildAutoPackNextCases()` unconditionally deletes it, `autopack-engine.js` |
| Manual drag / rotate / nudge / flip / Inspector position Apply | Deleted | `withoutPackedProfile()` / `buildNormalHandlingPack()`, all manual-mutation call sites (`editor-screen.js:67-81,612,692,1920,2127,2302,2736,3193,3329,5721`); **Flip has no separate code path — it is a 180° rotation and goes through the same rotate mutation, confirmed by source read** |
| Duplicate within the current pack, lands packed | **Preserved unconditionally**, and *correctly so* — see Section E | `buildSafeDuplicateInstances()`, `pack-library.js:901-952` |
| Duplicate within the current pack, lands staged | Deleted | Same function, `placementState === 'staged'` branch |
| Whole-pack duplication | Preserved (value-copy, no aliasing risk — primitive string) | `PackLibrary.duplicate()`, `pack-library.js:2153-2168` |
| Unpack (all) | Deleted for every touched instance | `buildOrganizedUnpackStagingCases()`, `editor-screen.js:594-695` |
| "Reset" | **No pack-scoped Reset operation exists.** Only an unrelated "Reset demo data" button (`app.js:4324-4339`) that wipes all local app state via `Storage.clearAll()` | Confirmed by source search; this remains an open naming/product question, not a code gap |
| Undo/Redo | Preserved exactly (full deep-cloned snapshot) | `state-store.js:23-30,77-91` |
| Repair (`repairInvalidPlacementsLocally`) | Preserved for successfully repaired/still-packed instances; actively **read** as a repair-eligibility input, not just carried | `pack-library.js:1846-1916` |
| `repackInvalidPlacements()` | *Corrected this session.* Preserved unconditionally for both success and failure paths — **never re-derived, never cleared by this function under any outcome.** The floor-only search (`findRepackFloorPosition`) can only place items at zone-floor level; it can never reconstruct a stacked/support-dependent relationship. See Section F. | `pack-library.js:1997-2057`, `1978-1995` |
| Truck Change, same shape mode | Preserved for kept/adjusted survivors; cleared on transition to staged | `reconcilePlacementsForTruck()`, `pack-library.js:1464-1670` |
| Truck Change, cross-shape mode (rect↔Wheel Wells↔Front Overhang) | *Newly tested this session, previously untested.* Identical lifecycle to same-shape — no shape-specific branching in the marker logic anywhere. Preserved when the placement remains legal in the new geometry, cleared when it becomes invalid (e.g. lands in a wheel-well blocked body) and is then staged. See Section F. | Same function; geometry differences are fully contained in `getTrailerUsableZones()`/`getWheelWellGeometry()`, which the marker code never touches |
| Custom dimensions within the same shape mode | Identical lifecycle to preset dimensions — confirmed with non-preset numeric dimensions in this session's tests | Same function; dimensions are plain numbers with no special-casing |
| `saveNow()` / localStorage reload | Preserved (plain serializable field, unfiltered `JSON.stringify`, normalizer re-validates on load) | `core/storage.js`, `core/normalizer.js:226-289` |
| Normalization | Preserved only for `placement === 'packed' && packedProfile === 'max-capacity'`; any other value or state normalizes to absent (never a silent default-to-true) | `normalizer.js:226-229,289` |
| Pack / batch / app / workspace export-import | Preserved — export uses an unfiltered shallow spread; import (`repairPackInstancePlacements`) preserves only the exact packed+`'max-capacity'` combination, defaulting anything else (including genuinely absent legacy fields) to not-relaxed | `import-export.js:400-429`; `pack-library.js:1085-1129`; round-trip confirmed by `tests/audit/import-export.spec.mjs:30` |

---

## E. Duplicate characterization results

Empirically tested against real `pack-library.js` code this session — `tests/audit/max-capacity-duplicate-characterization.spec.mjs`, 4/4 passing. This is the decisive evidence for Section C.

**Scenario A — marked instance duplicated onto open floor (strict rules sufficient).** Duplication permitted; lands packed; **current behavior retains `packedProfile`**. Immediate revalidation agrees. Simulating the previously-proposed "always strip" fix and re-validating: **nothing changes — the duplicate stays packed either way.** The marker is present but functionally inert here (floor rest never consults it).

**Scenario B — marked instance duplicated onto/near another case, valid under strict rules alone (permissive support: stackable, no cap, support outweighs child).** Duplication permitted; lands packed; marker retained. Simulating the strip: **nothing changes.** Inert here too, for the same reason as A — the support relationship doesn't need relaxation, so `supportCanCarry()`'s early-return on `maxCapacitySupportRelationship()` was never the reason it passed.

**Scenario C — marked instance duplicated into a placement valid *only* because Max Capacity support relaxation is active** (support with `noStackOnTop:true`/`stackable:false`/`maxStackCount:1`, heavy child exceeding the support's own weight — the exact fixture recipe used by the existing `MAX-CAPACITY-B4` test, run through Duplicate instead of Truck Change). Duplication is permitted and lands packed **precisely because the duplicate-eligibility check (`duplicatePackedGroupIsFullyValid()`) validates the group using the original source instances, which are still marked, before the clone's own `packedProfile` is ever assigned.** Current behavior retains the marker on the packed duplicate, and immediate revalidation agrees it is valid. **Simulating the previously-proposed "always strip" fix and then running the same revalidation the next Truck Change would run: the duplicate is flagged invalid (`result.invalid`), and the production two-step pipeline (`reconcilePlacementsForTruck` + `stagePlacementIds`, the exact pattern `src/ui/truck-change-controller.js` uses) silently moves a previously-packed, previously-valid instance into staging with no explanation to the user.**

**Scenario C-partial** — stripping the marker from only one side of a dependent pair produces the identical failure (matches the existing `MAX-CAPACITY-B5` one-sided-marker semantics, now confirmed for the duplicate path too).

**Conclusion: do not implement the previously-proposed one-line "always delete `packedProfile` on duplicate" fix. It is empirically unsafe for scenario C and would silently corrupt a real, valid placement on the very next Truck Change or repair pass. Current behavior (retain the marker, per Contract C) is correct as-is and requires no change.** Scenarios A and B do mean the Phase C *count* will occasionally include a duplicate that didn't strictly need relaxation — this is the same, already-acknowledged, mode-level imprecision that exists for every Max Capacity Apply (Section B/G), not a new defect introduced by duplication.

---

## F. Truck Change and repair characterization results

Empirically tested — `tests/audit/max-capacity-truck-change-characterization.spec.mjs`, 6/6 passing.

**`repackInvalidPlacements()` — previously untested anywhere in the suite for `packedProfile`, now characterized:**
- **Success path:** a marked instance repacked into a brand-new floor position that plainly needs no relaxation **keeps the marker anyway** — the function unconditionally carries it forward via `applyCanonicalInstancePose()`'s deep clone, with zero re-derivation logic. This is consistent with, and further confirms, Contract C.
- **The repack search is floor-only.** `findRepackFloorPosition()` only ever tries `y = zone floor` — it has no code path that attempts an elevated/stacked candidate position. **A relaxation-dependent stacked relationship can never be reconstructed by "Repack invalid"; it can only be preserved (if the truck change doesn't disturb it) or lost to staging (if it does).** This meaningfully narrows the risk surface: the marker's load-bearing role during repack is limited to whether an *already-intact* dependent relationship survives, never to *creating* a new one.
- **Failure path:** an instance that can't be repacked is returned completely untouched — same placement, same marker — and reported via `failedIds` for the caller/UI to resolve separately. `repackInvalidPlacements()` never stages anything itself (`stagedIds` is hardcoded empty in its return value); staging invalid or failed instances is always a separate, explicit caller action (`stagePlacementIds()`), mirroring `reconcilePlacementsForTruck()`'s own two-step design.

**Cross-shape Truck Change (rect → Wheel Wells, Wheel Wells → Front Overhang, Front Overhang → custom-dimension rect) — previously untested, now characterized:** identical marker lifecycle to same-shape Truck Change in every case tested. A placement that becomes illegal under the new shape's geometry (e.g., falls inside a Wheel Wells blocked body) is correctly flagged invalid and, once staged, correctly loses the marker. A placement unaffected by the shape change keeps its marker across the transition. No shape-specific code exists anywhere in the marker logic — confirmed both by this session's tests and by the exhaustive `packedProfile` grep in Section D, which shows zero references to `shapeMode`/dimensions/wheel-well/front-overhang config across all 17 touch points.

---

## G. Canonical Phase C metric

**Unit:** currently-packed applied instances (`pack.cases[]` entries with `placement === 'packed'`) carrying `packedProfile === 'max-capacity'`. Same unit as the base readiness audit; unchanged by this session's findings.

**Two distinct numbers, both shown, never conflated:**
- **Pre-application candidate count** (Results option card, Max Capacity option only): `viewedOption.packedCount` for that option. Correct without new derivation, because `applyMaxCapacityRuleProfile()` relaxes every item in a Max Capacity solve uniformly — 100% of that option's packed placements used the profile. This is a *preview of what would happen*, shown in a context (an unapplied option card in the Results carousel) that already signals "candidate," reinforced by tooltip wording that says "this result" rather than "these packed cases."
- **Post-application live count** (Stats card, after Apply): number of currently packed, non-hidden, case-resolved instances with the marker, computed live. This is the number that persists, changes with manual edits/Truck Change/Unpack/etc., and is what Section H's Stats-card copy describes.

**Do not call the candidate count an applied count**, and do not word either one as proof that every counted instance individually required a relaxed rule — Section B's mode-level-metadata framing applies to both.

**Canonical count source — resolved by tracing `computeStats()` directly this session:** `computeStats()`'s existing "packed vs. staged" split (`packedCases++`) is **not** a read of `inst.placement`. It is a **live geometric recomputation** — `isAabbInsideTruckGeometry(aabb, zonesInches, statsWheelWell)` against the instance's *current* transform and the *current* `pack.truck` geometry, inside a loop that already skips hidden and unresolved instances before reaching that check. A raw `pack.cases.filter(inst => inst.placement === 'packed' && ...)` filter computed anywhere else is a **second, independent classification** that could in principle disagree with "Packed in truck" if the stored `placement` field and live geometry ever diverged. **The Phase C count must therefore be computed inside `computeStats()`, in the same loop, gated by the same `insideTruck` check, immediately alongside `packedCases++`** — not as a separate raw filter, and not as a separately-invoked helper duplicating the classification. This is the one design point on which this audit revises the base readiness audit's "add it to `computeStats()`" recommendation from a preference into a requirement backed by a specific, traced failure mode.

Hidden and unresolved-case instances are excluded automatically, for free, by reusing the existing loop's early-`return`s — no new logic needed for either.

---

## H. Approved UI/tooltip/PDF copy recommendation

**Visible label (both surfaces, identical, per the owner's direction):**
> Max Capacity profile · N case{s} packed

Using the exact singular/plural convention already established elsewhere in this codebase (`import-pack-dialog.js`: `N + ' case' + (N !== 1 ? 's' : '')`), e.g. "Max Capacity profile · 1 case packed" / "Max Capacity profile · 12 cases packed." The `·` middot separator is an existing, repo-wide convention (`packs-screen.js`, `import-cases-dialog.js`, `import-pack-dialog.js`) — no new visual pattern introduced.

**Tooltip — Results option card (pre-application, Max Capacity option only):**
> This result used the more permissive Max Capacity handling profile. Review these placements before treating the plan as transport-ready.

(Owner's copy, used verbatim — "this result" is already correctly scoped to a not-yet-applied candidate.)

**Tooltip — applied Stats card (post-application, live):**
> These N packed cases are currently associated with the Max Capacity handling profile. Review these placements before treating the plan as transport-ready.

(Minimally reworded from the owner's copy — "This result used" → "These packed cases are currently associated with" — solely to avoid describing an already-committed, live pack state with language that implies a not-yet-applied candidate, per the explicit instruction not to call an applied count a candidate count. Everything else, including the safety-review sentence, is unchanged.)

**Zero state:** hide the row/chip entirely on both surfaces (no "0 cases" text) — matches the existing conditional-row precedent already used for "Unresolved cases" in the Stats card.

**Unavailable/inconsistent state:** none needed. The underlying field always normalizes to a clean present/absent boolean (Section D); there is no tri-state "unknown" to represent.

**PDF:** optional for MVP. If included, add one line to the existing gated `SUMMARY` block (`app.js generatePDF()`, `prefs.export.pdfIncludeStats`) reusing the same `computeStats()`-derived value and the applied-Stats-card wording pattern.

---

## I. Documentation corrections made

Both made directly in this audit run (not deferred as a recommendation):

1. **`docs/product/TP3D-MASTER-TODO-V5.md`** — corrected the internal contradiction the owner flagged. Section 1 rule 12 no longer says Phase C is blocked; it states billing reliability and the UX/UI closeout are closed and Phase C is unblocked at the roadmap level, with production implementation gated by audit approval. The "Last verified repository state" line, the Status Snapshot table row, Section 4 (Active Work — task/branch/outcome/blocker all updated to this audit), Section 5 (queue), and Section 10 (removed the stale "blocked by Section 6" statement, replaced with a link to this document) were all updated to match.
2. **`docs/engineering/autopack-engine-contract.md`** — the Hard Rules list previously included "child-vs-support weight check except pallet bypass behavior" and "`noStackOnTop`/`stackable:false`" and "`maxStackCount`" with no stated Max Capacity exception, contradicting the code and tests, which prove these are intentionally relaxed. Split into a genuine Hard Rules section (geometry/physics only — containment, collision, wheel-well/front-overhang exclusion and stability, support *footprint fraction*, retention) and a new "Relaxable Cargo-Handling Preferences (Max Capacity only)" section documenting exactly what's relaxed, the solver-weight-neutralization mechanism (temporary, solve-scoped, never touching canonical stored case weight or final reporting), and the mode-level nature of `packedProfile`.

---

## J. Implementation plan (not implemented in this run)

- **Approved `packedProfile` definition:** Contract C, per Section B — no code change required to the field's meaning or lifecycle; current behavior is already correct.
- **Approved duplicate behavior:** no change. The existing "preserve on packed, clear on staged" logic in `buildSafeDuplicateInstances()` (`pack-library.js:901-952`) is correct and must not be touched.
- **Approved Truck Change / repair behavior:** no change. `reconcilePlacementsForTruck()`, `repairInvalidPlacementsLocally()`, and `repackInvalidPlacements()` all already handle the marker correctly under Contract C.
- **Approved manual-edit behavior:** no change. `withoutPackedProfile()`/`buildNormalHandlingPack()` already strip the marker correctly on every manual-mutation path, including Flip (which has no separate code path from Rotate).
- **Approved count source:** inside `computeStats()` (`pack-library.js:2320-2390`), as a new field (e.g. `relaxedHandlingCount`) computed in the existing per-instance loop alongside `packedCases++`, using the same `insideTruck`/hidden/unresolved gating already there. **Do not** compute it via a separate raw filter elsewhere.
- **Exact Results-card wording:** "Max Capacity profile · N case{s} packed" chip on the Max Capacity option card only, using `viewedOption.packedCount`, reusing the existing `makeAutoPackResultChip()` helper (same helper that already renders "Floor"/"Stacked").
- **Exact Stats wording:** same visible label, added as one conditional row (hidden at zero) in `renderTruckInspector()`'s stats block, following the existing "Unresolved cases" conditional-row pattern.
- **Exact tooltip:** per Section H, two variants (Results-card vs. Stats-card), reusing whatever existing tooltip mechanism (`cardHeaderWithInfo()` / `[data-tooltip]`) is already used elsewhere in each of those two components.
- **PDF decision:** optional for MVP; if included, one line in the existing gated `SUMMARY` block in `app.js generatePDF()`.
- **Exact files likely to change:** `src/services/pack-library.js` (`computeStats()`), `src/screens/editor-screen.js` (Results-card chip + Stats-card row), `src/app.js` (optional PDF line).
- **Explicit no-change files:** `src/services/autopack-solver.js`, `src/packing-core/solution.js`, `src/services/autopack-engine.js` (metadata logic), `pack-library.js`'s duplicate/reconcile/repair/repack functions (read-only consumption of `instanceUsesMaxCapacityProfile` is fine; no logic change), `src/services/import-export.js`, `src/ui/truck-change-controller.js`, `src/core/operation-lifecycle.js`, all Supabase/billing/workspace code.
- **Migration or compatibility impact:** none. No schema change, no new persisted field, no new export/import format — the underlying `packedProfile` field already round-trips correctly through every path (Section D).
- **Recommended branch:** yes, a separate implementation branch, `feat/max-capacity-phase-c-reporting`, opened only after this audit is approved. This audit branch (`audit/max-capacity-phase-c-profile-semantics`) should not carry the implementation commits.

---

## K. Tests that must pass before implementation and before merge

**Already written and passing in this audit branch (must be kept in the permanent suite, not deleted as "throwaway audit scripts" — they are the evidence base for Sections C, E, and F):**
- `tests/audit/max-capacity-duplicate-characterization.spec.mjs` — 4/4 passing (`DUP-CHAR-A`, `DUP-CHAR-B`, `DUP-CHAR-C`, `DUP-CHAR-C-partial`).
- `tests/audit/max-capacity-truck-change-characterization.spec.mjs` — 6/6 passing (`TC-CHAR-repack-1/2/3`, `TC-CHAR-shape-1/2/3`).
- Existing `tests/audit/max-capacity-durability.spec.mjs` (15 tests) and the `AUTOPACK-MAX-A` solver-level suite in `tests/audit/security-and-invariants.spec.mjs` remain the baseline and must continue passing unchanged — nothing in this audit required modifying them.

**New tests required once the `feat/max-capacity-phase-c-reporting` branch begins (unchanged in substance from the base readiness audit's Section G, restated here for completeness):**
- Zero / one / multiple relaxed instances → `computeStats()` field is correct.
- One instance relaxing multiple underlying preferences still counts once (mode-level, not per-rule).
- Mixed strict and relaxed placements in the same pack.
- Applying a non-Max-Capacity solution after Max Capacity → count returns to the new, unmarked state.
- Unpack → count returns to 0.
- Undo/Redo → count follows the restored snapshot.
- Save/reload round trip preserves the count.
- Duplicate project/pack → correct, independent count on the copy.
- Import/export round trip → count matches.
- Malformed/absent legacy metadata on import → counts as not-relaxed, no crash.
- Switching between Results options before Apply → the Results-card candidate count updates per option; the Stats-card applied count does not change until Apply commits.
- UI: zero-state hides the row/chip on both surfaces; singular/plural render correctly; tooltip text matches the approved copy in Section H exactly.

**Full regression gates (per repo standard):** `npm test`, `npm run -s typecheck`, `npm run lint`, `git diff --check`, `git diff --cached --check`.

---

## L. Final recommendation

**APPROVE PHASE C IMPLEMENTATION, WITH CONDITIONS.**

Conditions:
1. Open a separate `feat/max-capacity-phase-c-reporting` branch — do not implement on this audit branch.
2. Do not apply any duplicate-path code change. This audit's Section E is the definitive resolution: the previously-proposed "always strip `packedProfile` on duplicate" fix is confirmed unsafe and must not be implemented. Current duplicate behavior is correct under Contract C and ships as-is.
3. Implement the count strictly inside `computeStats()` per Section G — not as a separate derivation — to guarantee it can never disagree with "Packed in truck."
4. Use the exact wording in Section H for both surfaces, including the deliberately different tooltip phrasing between the pre-application Results card and the post-application Stats card.
5. Keep `max-capacity-duplicate-characterization.spec.mjs` and `max-capacity-truck-change-characterization.spec.mjs` in the permanent suite and passing; add the Section K implementation-specific tests before merge.
