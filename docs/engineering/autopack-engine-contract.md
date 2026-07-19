# Truck Packer 3D AutoPack Engine Contract

## Purpose

This document defines the permanent engineering contract for Truck Packer 3D AutoPack, editor placement, packing geometry, support validation, and load-plan mutation behavior. It must be read before changing AutoPack, Wheel Wells, Front Overhang, stacking, support, manual placement, delete/revalidation, AutoPack/Unpack, or editor selection behavior.

## Coordinate System

- X = trailer/space length.
- x = 0 = rear/loading door.
- x = length = front/cab/nose.
- Y = height.
- y = 0 = floor.
- Z = width.
- Positive/negative Z are left/right width directions depending on camera view; do not infer truck front/back from screen orientation.

## Module Ownership

- `src/services/autopack-solver.js`: geometry evaluation, candidate generation, scoring, support validation, containment/collision checks, stacking behavior, Wheel Wells / Front Overhang solver details.
- `src/services/autopack-engine.js`: AutoPack orchestration, pack-to-solver item building, staging handoff, operation flow, animation handoff, final pack mutation.
- `src/services/autopack-item-builder.js`: pre-solve item normalization and orientation-candidate preparation (`buildLegacyAutoPackItems`), consumed directly by `autopack-engine.js`.
- `src/services/pack-library.js`: canonical pack/case data operations, usable zones, blocked zones, manual revalidation, delete/update/add/duplicate mutation contracts.
- `src/screens/editor-screen.js`: editor interactions, Inspector actions, selection behavior, manual operations, UI event wiring.
- `src/editor/scene-runtime.js`: scene object representation, 3D object sync, visual selection/runtime scene behavior.
- `src/core/operation-lifecycle.js`: operation locks, busy-state behavior, lifecycle safety.

## Hard Rules

Scoring must never weaken or bypass hard rules. A candidate is valid only if all relevant hard rules pass. Hard rules are geometry/physics rules and are the same for every AutoPack strategy, including Max Capacity.

Hard rules include:

- containment using the canonical tolerance, currently `CONTAINMENT_EPS_INCHES = 0.05`;
- no overlaps;
- wheel-well blocked-body exclusion;
- wheel-well cantilever/overhang and center-of-mass stability limits (`MAX_WHEELWELL_OVERHANG_FRACTION`, COM checks);
- cab/front-overhang void exclusion;
- support **footprint fraction** (`MIN_SUPPORT_FRACTION`) — geometric contact area, always enforced;
- rear/front retention rules where applicable;
- no unsupported floating cases;
- no invalid seam-crossing placements.

## Relaxable Cargo-Handling Preferences (Max Capacity only)

Max Capacity is a distinct, never-auto-selected AutoPack strategy (`src/packing-core/solution.js`, `applyMaxCapacityRuleProfile()` in `src/services/autopack-solver.js`) that may relax the following cargo-handling **preferences** — not physical rules — for every item in the solve, uniformly:

- orientation lock and `canFlip` (all orientations become permitted);
- `noStackOnTop` / `stackable:false` support-side behavior;
- `maxStackCount` as a direct-child support cap (treated as unlimited);
- load priority and lane (`loadPriority`, `laneItem`) solver ordering behavior;
- the **child-vs-support weight comparison** used to decide whether a support can carry a candidate's weight. This is intentionally relaxed and is proven by a dedicated test (`AUTOPACK-MAX-A relaxes child-vs-support weight without weakening support geometry`), which also proves the support **footprint fraction** hard rule stays enforced for the same relaxed pair — Max Capacity relaxes whether a lighter item may carry a heavier one, never whether there is real geometric contact area.

Mechanism note: the solver neutralizes this comparison by evaluating each solved item with its weight temporarily set to 0 for the duration of the solve only (`applyMaxCapacityRuleProfile()`'s shallow clone). This never erases or overwrites the canonical stored case weight — case-library weight data, `computeStats()` totals, and final weight/PDF reporting always read the real, canonical case weight. The same relaxation, applied at reconciliation time (Truck Change, repair) rather than solve time, is implemented separately via `supportCanCarry()`'s `maxCapacitySupportRelationship()` check (both sides of a support pair must currently carry `packedProfile: 'max-capacity'`) and, for Wheel Wells support validation specifically, `projectMaxCapacitySupportRecords()`.

`packedProfile: 'max-capacity'` is **mode-level metadata**: the solver relaxes preferences for every item in a Max Capacity solve uniformly, so an applied instance carrying this marker is not proof that its specific placement individually required any particular relaxed rule — only that it belongs to a Max Capacity result and is evaluated under that profile wherever relevant. See [Max Capacity Phase C — Packed-Profile Semantics Audit](../audits/max-capacity-phase-c-packed-profile-semantics-audit-2026-07-18.md) for the full contract.

## Quality Scoring

Quality scoring chooses among already-valid candidates only. Scoring must never create validity.

Quality priorities:

- lower before higher;
- front-first when `loadFrontFirst` is true;
- avoid wasting constrained spaces;
- center channel and other constrained openings may need special reservation or leftover passes;
- tighter side/contact fit is quality only, not a hard rule;
- deterministic output matters unless a future multi-solution strategy explicitly changes this.

## Wheel Wells Contract

Wheel Wells geometry has these conceptual areas:

- rear full-width floor;
- center channel floor between wheel wells;
- left/right raised wheel-well shelf surfaces;
- front full-width floor;
- blocked wheel-well bodies.

Rules:

- The center channel is valid floor.
- Raised wheel-well shelf use is valid only where actual support/span rules pass.
- Do not fake a full-width raised floor.
- Do not force boxes wider than the shelf into shelf space.
- Do not enter blocked wheel-well bodies.
- Channel lane alignment matters visually and operationally.
- The current quality stack improves front compression, floor/channel compaction, raised-support ordering, and channel lane alignment.
- Remaining raised shelf/bridge gaps require a future explicit bridge/spanning strategy.
- Wheel Wells still needs a future constrained leftover pass that tries staged leftovers into remaining legal floor/channel holes, prioritizing smaller/channel-fitting cartons, while preserving hard rules.

## Front Overhang Contract

- Cab void is blocked.
- Raised deck is usable only when footprint and height fit.
- Cases must not be placed into the cab void below the deck.
- True retaining-wall strategy is future work: build retaining wall first, then load the raised deck only when retained/support-safe.
- Do not blur Front Overhang work with Wheel Wells work.

## Editor State and Mutation Contract

- Selection must be instanceId-based.
- Never delete by caseId unless explicitly deleting a case definition from the case library.
- Deleting one selected instance deletes only that one selected instance.
- Multi-delete deletes only the selected instance IDs.
- Manual revalidation may move non-selected dependent cases to staging if their support becomes invalid.
- Revalidation-staged dependents must not be silently deleted.
- Any non-selected items moved by revalidation must be reported to the user with clear copy.
- Unsupported dependents should be staged or the operation should be blocked with a warning; they must not be left floating.
- AutoPack/Unpack must clear or rebase selection after whole-pack mutations.
- Scene selection and app selection must stay synchronized.
- Keyboard shortcuts must route through the same safe mutation paths as UI buttons.

## AutoPack and Unpack Product Contract

- AutoPack is currently a whole-pack re-solve of eligible non-hidden cases.
- AutoPack may move existing packed and staged cases because it generates a new load plan.
- Hidden packed cases may be retained as physical blockers/support context depending on current engine behavior.
- AutoPack must not leave stale selected IDs after solve.
- Unpack is currently whole-pack staging.
- Unpack should not be confused with partial unpack unless a future feature explicitly adds selected/organized unpack behavior.
- Organized Unpack is future work.
- If AutoPack/Unpack movement surprises users, fix the UX/copy/selection contract before changing solver behavior.

## Known Deferred / Non-Features

Do not expose or claim these as completed solver behavior unless implemented and tested:

- hard heavy-on-bottom / cumulative tower crush;
- legal axle claims;
- CoG scoring;
- fragile top-layer behavior;
- delivery sequence / stop groups / keep together;
- true Wheel Wells bridge/spanning;
- Front Overhang retaining-wall strategy;
- multi-solution AutoPack strategies;
- Web Worker / InstancedMesh performance rewrite;
- organized Unpack;
- manual vertical snap / snap-on-top placement.

## Validation Expectations

Before implementation:

- perform source-depth audit first;
- identify whether the change affects hard rules, quality scoring, editor state, or UI explanation;
- do not hardcode one screenshot size;
- do not weaken hard rules to improve visuals.

During implementation:

- keep the packet small and isolated;
- prefer behavior tests over brittle source-pattern tests;
- run targeted tests during development.

Before commit:

- run targeted tests for the changed area;
- run `npm test` for code changes unless explicitly docs-only;
- run `npm run -s typecheck`;
- run `npm run lint`;
- run `git diff --check`;
- run `git diff --cached --check` when staged;
- browser verification is required for editor/3D behavior.

## Current Known Follow-Ups

- Delete/revalidation UX contract: deleting a support can stage dependents; the user must be told what moved and why.
- Wheel Wells constrained leftover pass: after floor/filler/stack, try staged leftovers into remaining legal floor/channel holes with smaller/channel-fitting cartons prioritized.
- Front Overhang retaining-wall strategy.
- Organized Unpack.
- Manual vertical placement.
- AutoPack Results / Case Browser counts.
- Persistence Track B must stay separate from solver/editor packets.
