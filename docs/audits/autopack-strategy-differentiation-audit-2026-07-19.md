# AutoPack strategy differentiation audit

Audit date: 2026-07-19

## Repository state

- Production code baseline tested: `99be0776d0070f18b18379bbe1e978a3dec03c43` (`merge: complete Max Capacity Phase C reporting`).
- Audit branch: `audit/autopack-strategy-differentiation`.
- Evidence/audit commit: `e2c44720587496de8705c29a2763437f21703439` (`audit(autopack): measure strategy differentiation`).
- All changes above the production baseline are audit fixtures, harness/tests, evidence, screenshots, and concise documentation only; no production runtime file changed.

## Executive result

The harness measured 90 strategy/fixture cells across 15 deterministic fixtures, with 2 signature-checked solves per cell (180 direct solver calls) plus the production adaptive portfolio. Determinism was **stable**, 0 geometrically invalid packed placements were observed, and 0 strategy results disagreed with canonical application counts.

The adaptive portfolio attempted 77 candidate solutions and exposed 41 unique physical layouts after production-equivalent dedupe (46.8% collapsed). Visible options ranged from 1 to 5 per fixture.

**Decision-grade findings:** Compact fill differed from Balanced only on the dedicated Wheel Wells yaw-control fixture, where both packed all seven cartons but Compact accepted mixed yaw and Balanced preserved row consistency. Max Capacity was distinct in 11/15, but packed fewer cases than Balanced in five fixtures, so its label must not be read as a monotonic maximum. Floor first, Stack priority, and Wheel-Wells-only Constrained space first each produced observable semantic differentiation.

This is characterization evidence only. No production solver, strategy, heuristic, geometry, UI, animation, auth, billing, storage, or lifecycle behavior changed.

## Method

- Inputs are literal, self-generated fixtures; no random or clock-derived values enter a solve.
- Every registered strategy is run directly with the same truck, zones, items, and feature options.
- Identity-aware signatures include item identity, packed/staged state, normalized pose, dimensions, supporters, and Front Overhang retention dependencies when present.
- Physical-layout signatures ignore interchangeable instance IDs, matching the production Results dedupe intent.
- Numbers in signatures are rounded to 0.001 inch/radian. Pairwise near-duplicate means same packed SKU multiset, at most max(1, ceil(10% of the larger packed-item count)) changed physical poses, at most max(1, ceil(5% of the larger packed-item count)) changed orientations, and no more than 1 inch mean displacement.
- Packed count excludes any placement failing containment, blocked-body, overlap, or minimum-support checks. The solver produced no such invalid placements in this run.
- Floor footprint is the exact union of floor/deck/shelf placement rectangles divided by the union of usable surface rectangles at each surface height.
- CoG uses the canonical CoG helper over packed instances only. This avoids staged work-area positions contaminating partial-load balance results.
- Environment-dependent runtime measurements are intentionally omitted from canonical committed evidence and from every determinism, equality, ranking, and recommendation decision.

## Fixture matrix

| Fixture | Cases | Truck mode | Purpose |
|---|---:|---|---|
| control-one-item | 1 | rect | Intentional convergence control: every strategy should return one identical placement. |
| floor-fit-convergence | 10 | rect | All requested cartons fit on the floor; Floor first should not be penalized. |
| layout-quality-yaw-control | 7 | wheelWells | Seven cartons stay below the repeated-grid threshold; Balanced should unify Wheel Wells floor yaw while Compact may mix orientations. |
| identical-over-demand | 80 | rect | Repeated identical cartons exceed one floor layer and exercise stacking and capacity limits. |
| mixed-sku-fragmentation | 56 | rect | Realistic mixed cartons expose ordering, residual-space use, and orientation differences. |
| compact-fill-pressure | 38 | rect | Residual widths make waste-first Compact fill compete with layout-quality row scoring. |
| stack-pressure | 54 | rect | A small floor and generous height make early safe stacking materially relevant. |
| fragile-no-stack | 32 | rect | No-stack handling preferences should constrain normal strategies and distinguish Max Capacity. |
| orientation-locked-tight | 12 | rect | Locked tall poses do not fit while a tipped pose does; Max Capacity must remain isolated and explicit. |
| heavy-on-light | 36 | rect | Mixed weights expose the normal child-versus-support rule and Max Capacity weight neutralization. |
| lane-priority-conflict | 36 | rect | Lane and load-priority preferences compete with deterministic physical density. |
| tall-narrow-mix | 40 | rect | Tall narrow pieces and short boxes exercise permitted face changes and support depth. |
| wheel-wells-channel-shelf | 68 | wheelWells | Narrow center channel and raised shelves make Constrained space first semantically eligible. |
| front-overhang-retention | 56 | frontBonus | Raised overhang use is legal only after the rear-retention contract is satisfied. |
| zero-pack-oversize | 3 | rect | Intentional zero-result control: no strategy can fit the oversize case under physical hard rules. |

## Strategy summary

| Strategy | Complete fixtures | Best packed-count fixtures | Physically differs from Balanced | Identical to Balanced | Aggregate packed |
|---|---:|---:|---:|---:|---:|
| Balanced | 5/15 | 10/15 | 0/15 | 15/15 | 351/529 (66.35%) |
| Compact fill | 5/15 | 10/15 | 1/15 | 14/15 | 351/529 (66.35%) |
| Floor first (no stacking) | 3/15 | 4/15 | 9/15 | 6/15 | 116/529 (21.93%) |
| Stack priority | 4/15 | 9/15 | 3/15 | 12/15 | 344/529 (65.03%) |
| Max Capacity | 5/15 | 10/15 | 11/15 | 4/15 | 404/529 (76.37%) |
| Constrained space first | 5/15 | 10/15 | 2/15 | 13/15 | 363/529 (68.62%) |

## Per-fixture packed-count and dedupe evidence

| Fixture | Balanced | Compact | Floor | Stack | Max C | Constrained | Adaptive attempted → unique | Applied default |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| control-one-item | 1 | 1 | 1 | 1 | 1 | 1 | 5 → 1 | Balanced |
| floor-fit-convergence | 10 | 10 | 10 | 10 | 10 | 10 | 5 → 1 | Balanced |
| layout-quality-yaw-control | 7 | 7 | 7 | 7 | 7 | 7 | 6 → 3 | Balanced |
| identical-over-demand | 60 | 60 | 15 | 60 | 48 | 60 | 5 → 3 | Balanced |
| mixed-sku-fragmentation | 14 | 14 | 6 | 18 | 35 | 14 | 5 → 4 | Stack priority |
| compact-fill-pressure | 38 | 38 | 14 | 38 | 38 | 38 | 5 → 3 | Balanced |
| stack-pressure | 36 | 36 | 6 | 36 | 34 | 36 | 5 → 3 | Balanced |
| fragile-no-stack | 8 | 8 | 8 | 8 | 24 | 8 | 5 → 2 | Balanced |
| orientation-locked-tight | 0 | 0 | 0 | 0 | 3 | 0 | 5 → 2 | Balanced |
| heavy-on-light | 24 | 24 | 6 | 24 | 20 | 24 | 5 → 3 | Balanced |
| lane-priority-conflict | 33 | 33 | 9 | 33 | 32 | 33 | 5 → 3 | Balanced |
| tall-narrow-mix | 24 | 24 | 12 | 24 | 40 | 24 | 5 → 3 | Balanced |
| wheel-wells-channel-shelf | 40 | 40 | 14 | 45 | 63 | 52 | 6 → 5 | Constrained space first |
| front-overhang-retention | 56 | 56 | 8 | 40 | 49 | 56 | 5 → 4 | Balanced |
| zero-pack-oversize | 0 | 0 | 0 | 0 | 0 | 0 | 5 → 1 | Balanced |

## Pairwise similarity

| Pair | Exact physical layouts | Near-duplicates | Packed-count differences | Mean changed poses |
|---|---:|---:|---:|---:|
| Balanced ↔ Compact fill | 14/15 (93.33%) | 0/15 (0%) | 0/15 | 0.2 |
| Balanced ↔ Floor first (no stacking) | 6/15 (40%) | 0/15 (0%) | 9/15 | 15.667 |
| Balanced ↔ Stack priority | 12/15 (80%) | 0/15 (0%) | 3/15 | 3.267 |
| Balanced ↔ Max Capacity | 4/15 (26.67%) | 0/15 (0%) | 10/15 | 26.8 |
| Balanced ↔ Constrained space first | 13/15 (86.67%) | 0/15 (0%) | 1/15 | 1 |
| Compact fill ↔ Floor first (no stacking) | 5/15 (33.33%) | 0/15 (0%) | 9/15 | 15.867 |
| Compact fill ↔ Stack priority | 11/15 (73.33%) | 0/15 (0%) | 3/15 | 3.467 |
| Compact fill ↔ Max Capacity | 3/15 (20%) | 0/15 (0%) | 10/15 | 27 |
| Compact fill ↔ Constrained space first | 13/15 (86.67%) | 0/15 (0%) | 1/15 | 1.067 |
| Floor first (no stacking) ↔ Stack priority | 6/15 (40%) | 0/15 (0%) | 9/15 | 15.2 |
| Floor first (no stacking) ↔ Max Capacity | 4/15 (26.67%) | 0/15 (0%) | 11/15 | 25.6 |
| Floor first (no stacking) ↔ Constrained space first | 5/15 (33.33%) | 0/15 (0%) | 9/15 | 17.067 |
| Stack priority ↔ Max Capacity | 4/15 (26.67%) | 0/15 (0%) | 10/15 | 25.933 |
| Stack priority ↔ Constrained space first | 11/15 (73.33%) | 0/15 (0%) | 3/15 | 5.133 |
| Max Capacity ↔ Constrained space first | 3/15 (20%) | 0/15 (0%) | 10/15 | 27.4 |

## Strategy audit recommendation

- **Balanced:** physically differs from Balanced on 0/15 fixtures; ties the best packed count on 10/15. Keep as the automatic baseline and deterministic tie-break winner.
- **Compact fill:** physically differs from Balanced on 1/15 fixtures; ties the best packed count on 10/15. Keep: the dedicated Wheel Wells yaw control proves the advertised tidy-row versus mixed-orientation tradeoff. Retain dedupe because the other fixtures converge.
- **Floor first (no stacking):** physically differs from Balanced on 9/15 fixtures; ties the best packed count on 4/15. Keep: the no-stacking semantic is explicit even where the physical layout converges.
- **Stack priority:** physically differs from Balanced on 3/15 fixtures; ties the best packed count on 9/15. Keep: it improved packed count on the mixed-SKU and Wheel Wells fixtures, while its Front Overhang regression makes the user-visible tradeoff real.
- **Max Capacity:** physically differs from Balanced on 11/15 fixtures; ties the best packed count on 10/15. Keep manual-only: it is the only profile allowed to relax approved handling preferences and must never auto-apply.
- **Constrained space first:** physically differs from Balanced on 2/15 fixtures; ties the best packed count on 10/15. Keep Wheel-Wells-only. Do not expose it for Standard or Front Overhang, where it is intentionally equivalent to Balanced.

### Max Capacity naming/semantics

The current implementation is a **relaxed-handling physical-fit estimate**, not an optimization proof and not an upper bound on packed count. It beat Balanced on mixed-SKU fragmentation, fragile/no-stack, orientation-locked, tall/narrow, and Wheel Wells fixtures; it lost to Balanced on identical over-demand, stack pressure, heavy/light, lane/priority, and Front Overhang fixtures.

**Recommendation:** preserve the manual-only safety boundary, but refine the user-facing name or adjacent copy in a separately approved product change. “Relaxed fit estimate” is semantically closer than “Max Capacity”; if the label stays, explicitly say that it explores relaxed preferences and may not pack the most cases.

### Portfolio-level recommendation

- Do not merge Floor first, Stack priority, Max Capacity, or Constrained space first into a single generic alternative: their measured failure/success modes differ.
- Keep physical-layout dedupe as the user-facing guard against fake choice. It correctly removed Compact fill in both browser fixtures and collapsed all six conceptual strategies to one option in the convergence controls.
- Keep Compact fill, but broaden its regression corpus: its one measured distinction is meaningful and matches the copy, while broad convergence means dedupe remains essential.
- Continue gating Constrained space first to real Wheel Wells geometry; it improved 40 → 52 packed and increased channel/shelf use in the dedicated fixture.


## Answers to the audit questions

### Balanced

- Exact behavior: registry id `default`, solver strategy `front-first-balanced`, with options `{}`.
- Mechanics: Runs the full front-first production pipeline with layout-quality ranking enabled, Wheel Wells awareness, stacking, and leftover recovery.
- Distinctness: 15/15 fixtures were physically identical to Balanced; 0/15 differed.
- Difference fixtures: baseline by definition.
- Capacity: tied the fixture-best packed count on 10/15; aggregate 351/529 packed.
- Packed-count change versus Balanced: gains — none; losses — none.
- Completion: 5/15 fixtures fully packed.
- Expected convergence: It is the comparison baseline; ties are intentionally retained in its favor for automatic selection.
- Best measurable use: General-purpose first result where tidy rows and a balanced normal-rule solution are preferred.
- Recommendation: Keep as the default and tie-break baseline.

### Compact fill

- Exact behavior: registry id `compact-fill`, solver strategy `front-first-compact`, with options `{"layoutQuality":false}`.
- Mechanics: Runs the same pipeline with `layoutQuality: false`, returning to the original local waste-first candidate order.
- Distinctness: 14/15 fixtures were physically identical to Balanced; 1/15 differed.
- Difference fixtures: layout-quality-yaw-control.
- Capacity: tied the fixture-best packed count on 10/15; aggregate 351/529 packed.
- Packed-count change versus Balanced: gains — none; losses — none.
- Completion: 5/15 fixtures fully packed.
- Expected convergence: Convergence is common when candidate validity and later compaction dominate the local score. It remained identical in the compact-fill-pressure fixture but differed in the sub-grid Wheel Wells yaw control.
- Best measurable use: A denser local-waste-first alternative that accepts mixed yaw where Balanced favors a tidier single-yaw row.
- Recommendation: Keep, but retain production dedupe and expand the corpus because measurable differentiation is currently sparse.

### Floor first (no stacking)

- Exact behavior: registry id `floor-first`, solver strategy `floor-only`, with options `{"enableStackPhase":false}`.
- Mechanics: Sets `enableStackPhase: false`; lane, floor, and filler placement remain available, but no case is lifted onto cargo.
- Distinctness: 6/15 fixtures were physically identical to Balanced; 9/15 differed.
- Difference fixtures: identical-over-demand, mixed-sku-fragmentation, compact-fill-pressure, stack-pressure, heavy-on-light, lane-priority-conflict, tall-narrow-mix, wheel-wells-channel-shelf, front-overhang-retention.
- Capacity: tied the fixture-best packed count on 4/15; aggregate 116/529 packed.
- Packed-count change versus Balanced: gains — none; losses — identical-over-demand (-45), mixed-sku-fragmentation (-8), compact-fill-pressure (-24), stack-pressure (-30), heavy-on-light (-18), lane-priority-conflict (-24), tall-narrow-mix (-12), wheel-wells-channel-shelf (-26), front-overhang-retention (-48).
- Completion: 3/15 fixtures fully packed.
- Expected convergence: Expected for one-item, all-on-floor, physically impossible, and no-stack loads where the normal pipeline also has no useful stacking opportunity.
- Best measurable use: Flat, accessible loads where the user explicitly values no stacking over packed count.
- Recommendation: Keep as a clear semantic option.

### Stack priority

- Exact behavior: registry id `stack-priority`, solver strategy `stack-priority`, with options `{"stackFallbackImmediate":true}`.
- Mechanics: Sets `stackFallbackImmediate: true`, offering a safe supported stack as soon as an item fails floor placement.
- Distinctness: 12/15 fixtures were physically identical to Balanced; 3/15 differed.
- Difference fixtures: mixed-sku-fragmentation, wheel-wells-channel-shelf, front-overhang-retention.
- Capacity: tied the fixture-best packed count on 9/15; aggregate 344/529 packed.
- Packed-count change versus Balanced: gains — mixed-sku-fragmentation (+4), wheel-wells-channel-shelf (+5); losses — front-overhang-retention (-16).
- Completion: 4/15 fixtures fully packed.
- Expected convergence: Expected when the ordinary later stack phase reaches the same final arrangement, or when every item already fits the floor / cannot fit at all.
- Best measurable use: Loads where early vertical use recovers cargo before open-floor choices consume useful support surfaces.
- Recommendation: Keep; its gains and Front Overhang loss prove a real tradeoff rather than an alias.

### Max Capacity

- Exact behavior: registry id `max-capacity`, solver strategy `max-capacity`, with options `{"maxCapacityMode":true}`.
- Mechanics: Runs an isolated solve that clears no-stack/stackable/max-stack, weight, lane, priority, orientation, flip, and exact-lock preferences while retaining physical hard rules.
- Distinctness: 4/15 fixtures were physically identical to Balanced; 11/15 differed.
- Difference fixtures: identical-over-demand, mixed-sku-fragmentation, compact-fill-pressure, stack-pressure, fragile-no-stack, orientation-locked-tight, heavy-on-light, lane-priority-conflict, tall-narrow-mix, wheel-wells-channel-shelf, front-overhang-retention.
- Capacity: tied the fixture-best packed count on 10/15; aggregate 404/529 packed.
- Packed-count change versus Balanced: gains — mixed-sku-fragmentation (+21), fragile-no-stack (+16), orientation-locked-tight (+3), tall-narrow-mix (+16), wheel-wells-channel-shelf (+23); losses — identical-over-demand (-12), stack-pressure (-2), heavy-on-light (-4), lane-priority-conflict (-1), front-overhang-retention (-7).
- Completion: 5/15 fixtures fully packed.
- Expected convergence: Expected when no relaxed preference binds, for trivial/full-floor loads, and where physical dimensions make every strategy fail.
- Best measurable use: A manual what-if estimate for the physical fit available after relaxing approved handling preferences.
- Recommendation: Keep manual-only, and clarify that it is not guaranteed to maximize packed count.

### Constrained space first

- Exact behavior: registry id `constrained-first`, solver strategy `constrained-space-first`, with options `{"constrainedSpaceFirst":true}`.
- Mechanics: Sets `constrainedSpaceFirst: true`, prioritizing narrow Wheel Wells channel cargo before the open-floor phases.
- Distinctness: 13/15 fixtures were physically identical to Balanced; 2/15 differed.
- Difference fixtures: layout-quality-yaw-control, wheel-wells-channel-shelf.
- Capacity: tied the fixture-best packed count on 10/15; aggregate 363/529 packed.
- Packed-count change versus Balanced: gains — wheel-wells-channel-shelf (+12); losses — none.
- Completion: 5/15 fixtures fully packed.
- Expected convergence: Expected and intentional outside real Wheel Wells geometry; production therefore does not run or show it for Standard or Front Overhang.
- Best measurable use: Wheel Wells loads with channel-fitting cargo that would otherwise lose narrow-zone opportunities.
- Recommendation: Keep Wheel-Wells-only.

## Browser validation

Playwright CLI used an isolated Chromium session against the live local app. Authenticated first, then forced offline before injecting fixture state; no auth state saved.

| Scenario | Attempted | Visible after dedupe | Auto-applied | Card/apply evidence |
|---|---:|---:|---|---|
| Standard mixed SKU | 5 | 4: Balanced, Floor, Stack, Max | Stack priority (18) | Max card 35 packed / 21 staged / 12 floor / 23 stacked / 94.6%; Apply changed canonical stats and profile count to 35 |
| Wheel Wells channel/shelf | 6 | 5: Balanced, Floor, Stack, Max, Constrained | Constrained (52) | Constrained card 52 packed / 16 staged / 20 floor / 32 stacked / 70.2% |

The live card counts and order matched the direct harness. Screenshots: [Standard Max Capacity](./autopack-strategy-standard-max-capacity-browser-2026-07-19.png) and [Wheel Wells Constrained](./autopack-strategy-wheel-wells-browser-2026-07-19.png).

No application exception was observed. The isolated offline run logged the existing favicon 404 and expected offline loader-media failures.

## Reliability and scope limits

- Candidate-search counters and internal solver scores are not exposed by the current solver result contract, so this audit does not fabricate them.
- “Distinct stacks” is reported as deterministic support-root count plus max/average support depth; arbitrary bridge geometry prevents a universal human-style column count.
- Browser evidence validates the live selectable order, visible cards/metrics, dedupe count, and Apply path on representative loads; it is not used for broad solver measurement.
- The JSON artifact is the deterministic machine-readable source for every fixture, strategy metric, signature hash, pairwise comparison, warning, and rejection count.

## Reproduction

```sh
node scripts/autopack-strategy-audit.mjs --repeats 2 --json docs/audits/autopack-strategy-differentiation-results-2026-07-19.json --markdown docs/audits/autopack-strategy-differentiation-audit-2026-07-19.md
node --test tests/audit/autopack-strategy-differentiation.spec.mjs
```

Intentional convergence is expected and is not itself a defect. Across all 15 strategy pairs, exact-layout rates range from 20% to 93.33%.
