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

## Max Capacity Search and Assessment

C5 materializes every candidate as the complete Pack that Apply would commit,
then uses the shared C2/C4 assessment and separate operational eligibility.
Only VALID + eligible candidates count as valid solutions or qualify for initial
automatic adoption. Acceptable INCOMPLETE candidates require explicit Apply;
INVALID and operationally blocked candidates cannot be adopted. A complete or
partial packing population does not determine physical validity.

Max Capacity uses the same no-top, stack-count, mass, support and operational
contracts as Standard. Its search may relax lane/load-priority ordering and try
all permitted signed orientations. It cannot clear exact instance targets or
change physical Case permission or mass. Equivalent quality favors Standard.

Case physical orientation is always `orientationLock: any | upright | onSide`, enforced through the signed `isCasePhysicalOrientationAllowed` predicate. Upright means authored +Y remains world +Y, and onSide means an authored side face is down. `canFlip` is retired and has no runtime authority. Instance fields and `packedProfile` cannot expand Case permission.

Standard and the default-family strategies deliberately search two upright yaws for `any`/`upright`, or the existing two selected side poses for `onSide`. Max Capacity searches all 24 distinct signed authored-axis orientations, filtered by Case permission (24 for `any`, 4 for `upright`, 16 for `onSide`). Equivalent signed-axis mappings deduplicate; equal envelope dimensions alone do not imply Case symmetry.

An active exact instance target narrows either search to the intersection of Case permission and that target. Malformed or conflicting targets produce no candidate and remain stored. Actual Case geometry always follows authored dimensions plus actual rotation; the exact target is planning data only.

`packedProfile: 'max-capacity'` is search provenance only, never physical
assessment authority. Legacy profile-aware reconciliation does not replace C2/C4.
Candidate assessments, identities, evidence and Results remain transient.

## Quality Scoring

Quality scoring chooses among already-valid candidates only. Scoring must never create validity.

Quality priorities:

- lower before higher;
- front-first when `loadFrontFirst` is true;
- avoid wasting constrained spaces;
- center channel and other constrained openings may need special reservation or leftover passes;
- tighter side/contact fit is quality only, not a hard rule;
- deterministic output matters: each strategy's output must stay deterministic (multiple solution strategies are implemented in `src/packing-core/solution.js`).

## Wheel Wells Contract

Wheel Wells geometry has these conceptual areas:

- rear full-width floor;
- center channel floor between wheel wells;
- left/right raised wheel-well shelf surfaces;
- front full-width floor;
- blocked wheel-well bodies.

Rules:

- The center channel is continuous floor across rear/channel/front computational seams. Its shared floor region participates in ordinary lane, floor, repeated, filler, recovery and quality passes; occupancy subtracts every intersected region at the same floor height.
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
- AutoPack may move cargo into the load space. Source-staged cargo that remains staged retains its exact pose and metadata. New packed-to-staged leftovers reserve all source staging footprints first; Unpack owns staging organization.
- Hidden packed cases may be retained as physical blockers/support context depending on current engine behavior.
- AutoPack must not leave stale selected IDs after solve.
- Unpack is currently whole-pack staging.
- Unpack should not be confused with partial unpack unless a future feature explicitly adds selected unpack behavior.
- Organized Unpack is implemented: Unpack stages Cases grouped by case type (`groupInstancesForUnpackStaging`) in contiguous bands laid out by `buildOrganizedUnpackStagingCases` (`src/screens/editor-screen.js`). It remains whole-pack staging and must not change solver behavior.
- If AutoPack/Unpack movement surprises users, fix the UX/copy/selection contract before changing solver behavior.

## AutoPack Results Authority

- Results browsing is non-authoritative. Viewing an option does not mutate the committed Pack.
- Applied state is derived from the current Pack/layout plus current Case physical source. Fresh unapplied Results may still match their captured Pack source; not-yet-applied does not mean stale. Any staging, physical Case or target-space edit invalidates that captured context.
- Ambiguous result/layout matching fails closed.
- All Results UI mutation belonging to a run must be guarded by that run's `runId`; stale run UI must never overwrite newer Results state.
- Apply must respect `OperationLifecycle` busy ownership.
- Apply rechecks freshness and reassesses the exact selected materialized layout before committing through canonical Pack mutation authority. Explicit incomplete Apply remains INCOMPLETE; it creates no persisted certificate.
- Browsing must not mutate history, `lastEdited`, export authority, or saved Pack state.
- The transient live 3D Results preview is implemented and remains presentation-only until Apply: browsing an option may transiently preview that solution in the 3D scene without mutating the committed Pack, history, export authority, `lastEdited`, or saved preview. Returning to the Applied option or closing Results restores the committed scene; Apply commits the selected option through canonical Pack authority.

## Manual Vertical Placement Authority

- `PackLibrary.findManualVerticalPlacement` is the authority for vertical Case moves.
- Keyboard, gizmo, drag-release, and Inspector vertical placement paths must route through that authority.
- Staged Cases are not eligible for vertical moves.
- Existing support, Wheel Wells, Front Overhang, and handling-rule validation remain authoritative.

## Known Deferred / Non-Features

Do not expose or claim these as completed solver behavior unless implemented and tested:

- hard heavy-on-bottom / cumulative tower crush;
- legal axle claims;
- CoG scoring;
- fragile top-layer behavior;
- delivery sequence / stop groups / keep together;
- true Wheel Wells bridge/spanning;
- Front Overhang retaining-wall strategy;
- Web Worker / InstancedMesh performance rewrite.

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
- Keep any future persistence/Supabase/NCB migration work strictly separate from solver/editor packets.
