# AutoPack Core Engine — Architecture Plan

**Date:** 2026-07-01
**Branch:** `epic/autopack-core-engine`
**Status:** Approved plan for the packing-core migration on this branch.
**Source-of-truth contract:** `docs/engineering/autopack-engine-contract.md` (this plan refines, never weakens, that contract).

---

## 1. Source audit summary (what is actually true today)

Audited at commit `b5cd47b` by direct source read plus Graphify call-path mapping.

### 1.1 Current ownership

| Concern | Owner today | Notes |
|---|---|---|
| Candidate generation, scoring, phases | `src/services/autopack-solver.js` (`solveAutoPack`) | Pure, deterministic, lexicographic tuple scoring |
| Zone generation (all 3 truck modes) | `src/services/pack-library.js` (`getTrailerUsableZones`) | Also blocked zones for wheelWells / frontBonus |
| Wheel-well physical geometry | `src/services/autopack-solver.js` (`getWheelWellGeometry`) | **Duplicates** shapeConfig parsing already done in pack-library |
| Front Overhang retention | `src/services/pack-library.js` (`evaluateFrontOverhangRearRetention`) | Consumed by the solver via import — already shared |
| Solver-side hard rules | `autopack-solver.js` (`supportsCandidate`, `canSupportStack`, `hasStackCapacity`, `canSupportCandidateWeight`, `isAabbContainedInZone`, `collidesPacked`, `validatePackedPlacements`) | One pipeline inside the solver |
| Manual/editor hard rules | `pack-library.js` (`aabbIsFullyValid`, `aabbIsSupported`, `supportCanCarry`, `reconcilePlacementsForTruck`) | **Second, parallel pipeline** with the same intent |
| Item normalization for AutoPack | `src/services/autopack-legacy-solver.js` (`buildLegacyAutoPackItems`) | Live; `solveLegacyAutoPack` is dead code kept intentionally |
| Orchestration, staging, commit, animation | `src/services/autopack-engine.js` (`createAutoPackEngine.pack`) | Already thin orchestration; commits final state before animation |
| Operation locking | `src/core/operation-lifecycle.js` | Single-slot token lock; wired into engine, editor, keyboard, InteractionManager |
| Editor mutations + revalidation | `editor-screen.js` → `PackLibrary.updateCasesWithManualRevalidation` → `revalidateManualPlacements` | Delete reports dependent staging (merged in `b5cd47b`) |
| Oriented dims / rotation math | `src/core/oriented-dims.js` | Already the single source; solver, pack-library, legacy all route through it |

### 1.2 Confirmed duplication (the architectural debt this plan removes)

1. **Wheel-well shapeConfig parsing exists twice** with identical defaults and
   clamps (`0.35*H`, `0.15*W`, `0.35*L`, `0.25*L`): once in
   `pack-library.getTrailerUsableZones` / `getWheelWellsBlockedZones`, once in
   `autopack-solver.getWheelWellGeometry`. A future config change edited in one
   place silently diverges the other.
2. **Support/stacking/weight rules exist twice**: solver
   (`canSupportStack` + `hasStackCapacity` + `canSupportCandidateWeight`) vs
   manual pipeline (`supportCanCarry`). Same product meaning, two code paths,
   two rule-shape conventions (`placement.item.item` vs `node.caseData`).
3. **Containment / collision / support-fraction each have 2–4 implementations**
   (solver, pack-library, legacy solver, editor `computeSettleY`), differing in
   units (inches vs world), tolerance constants, and supporter filtering.
4. **Rejection information is unstructured**: `output.unpacked` is an ID array;
   `output.warnings` are English strings assembled inside the solver. The UI
   cannot explain *why* a case is staged without string parsing.

### 1.3 What is deliberately NOT broken today

- The solver is already one decision authority for AutoPack itself.
- The engine is already orchestration/adaptation, not physics.
- Operation lifecycle guards all mutating paths (buttons, keyboard,
  InteractionManager, panel actions).
- Delete/revalidation UX contract is implemented and reported to the user.
- Hard rules per the engine contract are enforced and re-checked in
  `validatePackedPlacements` with defense-in-depth wheel-well geometry.

The migration therefore **wraps and unifies**; it does not rewrite the solver.

---

## 2. Target module layout

```text
src/packing-core/
  index.js          # public API surface of the core
  domain.js         # type constructors/validators for the shared data model
  space-model.js    # buildSpaceModel(truck) — one geometry authority
  orientation.js    # re-export/adapter over core/oriented-dims + candidate policy
  validation.js     # one hard-rule pipeline (containment/collision/support/…)
  explain.js        # RejectionReason codes + helpers
  solution.js       # PackingSolution / StrategyResult shapes (Phase 9)
```

`autopack-solver.js` keeps candidate generation, scoring, and phase strategy;
it consumes `packing-core` for geometry + hard rules. `pack-library.js` keeps
pack data operations; its reconciliation consumes the same `packing-core`
predicates. `autopack-engine.js` remains orchestration and adapts PackLibrary
instances into `PackingInput`.

---

## 3. Data model

All linear units are **inches**; coordinate convention is the existing
`TRUCK_DIRECTION_MODEL` (X = length with x=0 at the rear door, Y = height with
y=0 at the floor, Z = width centered on 0). All rotations are right-angle
Euler XYZ radians normalized by `core/oriented-dims.js`.

### 3.1 `ItemModel`

Normalized cargo item, superset of what `autopack-engine` already sends to the
solver — the adapter formalizes today's ad-hoc object:

```js
{
  instanceId: string,
  caseId: string,
  dims: { l, w, h },              // base case dims (inches)
  weight: number,                  // lbs, 0 when unknown
  shape: 'box' | 'cylinder' | 'drum',
  canFlip: boolean,
  orientationLock: 'any' | 'upright' | 'onSide',
  orientationLocked: boolean,      // exact instance lock
  lockedRotation: {x,y,z} | null,
  noStackOnTop: boolean,
  stackable: boolean,
  maxStackCount: number,           // 0 = unlimited direct children
  isPallet: boolean,
  laneItem: true | false | null,   // tri-state
  loadPriority: number,
}
```

### 3.2 `Surface`

A horizontal support surface the solver may rest cargo on.

```js
{
  kind: 'floor' | 'raisedFloor' | 'rigidTop',
  y: number,                       // top surface height
  minX, maxX, minZ, maxZ,          // extent
  zoneIndex: number | null,        // usable zone this surface belongs to, if any
  rigid: true | false,             // rigid (floor/well-top) surfaces always bear weight
}
```

`floor` = a usable zone whose `min.y === 0`; `raisedFloor` = a usable zone
floor above 0 (wheel-well shelf zones, overhang deck); `rigidTop` = the
wheel-well top slabs from today's `getWheelWellGeometry().tops`.

### 3.3 `BlockedVolume`

```js
{
  kind: 'wheelWellBody' | 'cabVoid',
  min: {x,y,z}, max: {x,y,z},
}
```

Sourced from `getWheelWellsBlockedZones` / `getFrontBonusBlockedZones`.

### 3.4 `SpaceModel`

The one geometry object every consumer shares:

```js
{
  kind: 'truck',                    // future: 'container' | 'warehouseZone' | 'stagingArea'
  bounds: { min: {x,y,z}, max: {x,y,z} },   // outer box incl. overhang extension
  zones: Zone[],                    // usable zones (existing getTrailerUsableZones output)
  blocked: BlockedVolume[],         // blocked bodies
  surfaces: Surface[],              // derived floor/raised/rigid-top surfaces
  retention: {                       // Front Overhang step geometry or null
    stepX, deckY, deckZone, mainZone,
  } | null,
  wheelWell: {                       // solver wheel-well geometry or null
    wx0, wx1, wellHeight, betweenHalfW, truckBox, blocked, tops, sides,
  } | null,
  loadFrontFirst: boolean,
  meta: { shapeMode, truck },        // original inputs for adapters/diagnostics
}
```

`buildSpaceModel(truck)` is a **pure** function assembled from the existing
pack-library zone/blocked functions and the existing solver
`getWheelWellGeometry` — moved/wrapped, not re-derived, so output is
byte-identical to today's geometry.

### 3.5 `PackingInput`

```js
{
  space: SpaceModel,
  items: ItemModel[],
  fixedPlacements: PlacedItem[],    // hidden packed cargo used as retention/obstacle context
  options: {
    layoutQuality: boolean,
    enableWheelWellBridge: boolean,
    enableWheelWellFrontCompression: boolean | undefined,
    enableWheelWellFloorChannelCompaction: boolean | undefined,
    strategy: string | undefined,   // Phase 9
  },
}
```

### 3.6 `PlacementCandidate`

The unit the validation pipeline judges (formalizes today's solver candidate):

```js
{
  item: ItemModel,
  orientation: { l, w, h, rotation: {x,y,z}, locked: boolean },
  position: { x, y, z },            // center
  aabb: { min, max },
  zone: Zone | null,                // usable zone claim, or null for wheel-well top path
  phase: 'lane' | 'floor' | 'filler' | 'stack' | 'bridge' | 'leftover',
}
```

### 3.7 `PlacedItem`

```js
{
  instanceId: string,
  item: ItemModel,
  pos: {x,y,z},
  dims: { l, w, h },
  aabb: { min, max },
  orientation: { rotation: {x,y,z} },
  phase: string,
  zone: Zone | null,
}
```

(This is exactly the solver's internal `packedPlacement`; naming it is the
change.)

### 3.8 `PackingState`

```js
{
  space: SpaceModel,
  placed: PlacedItem[],
  freeRects: FreeRect[],            // floor state
  remaining: ItemModel[],
  rejections: RejectionReason[],    // accumulated structured reasons
}
```

### 3.9 `RejectionReason`

```js
{
  instanceId: string,
  code: RejectionCode,              // machine-readable — see §6
  phase: 'lane'|'floor'|'filler'|'stack'|'bridge'|'leftover'|'validation',
  detail: string,                   // human-readable sentence (today's warning text)
  context: object | null,           // e.g. { channelWidth, itemWidth } — optional
}
```

### 3.10 `ValidationResult`

```js
{ ok: boolean, code: RejectionCode | null, detail: string | null }
```

Returned by every hard-rule predicate in `packing-core/validation.js`.

### 3.11 `PackingSolution` and `StrategyResult` (Phase 9)

```js
StrategyResult = {
  id: string,                       // e.g. 'default', 'constrained-first'
  strategy: string,
  placements: Map<instanceId, {x,y,z}>,
  rotations: Map<instanceId, {x,y,z}>,
  orientedDims: Map<instanceId, {length,width,height}>,
  retentionDependencies: Map<instanceId, string[]>,
  unpacked: string[],
  rejectionReasons: RejectionReason[],
  warnings: string[],
  stats: { laneCount, floorCount, stackCount, fillerCount, unpackedCount },
}

PackingSolution = {
  solutions: StrategyResult[],
  selected: string,                 // id of the default solution handed to the UI
}
```

The existing solver output object **is** the default `StrategyResult` minus
`id`/`strategy`/`rejectionReasons`; those fields are added additively so every
current consumer keeps working.

---

## 4. The ten design questions

### 4.1 How Standard becomes a `SpaceModel`
`buildSpaceModel({shapeMode:'rect'})`: one zone (the full box) →
`bounds` = that box, `zones` = [box], `blocked` = [], `surfaces` = one `floor`
surface, `retention` = null, `wheelWell` = null.

### 4.2 How Wheel Wells becomes a `SpaceModel`
Zones = the existing 5-zone split (rear, center channel, two raised shelves,
front). `blocked` = the two well bodies. `surfaces` = floor surfaces for the
three y=0 zones, `raisedFloor` for the two shelf zones, plus two `rigidTop`
surfaces from the well tops. `wheelWell` = the solver geometry object
(now built here, from the same parsed config as the zones — killing the
duplication in §1.2-1).

### 4.3 How Front Overhang becomes a `SpaceModel`
Zones = main box + raised deck zone. `blocked` = the cab void.
`surfaces` = main `floor` + deck `raisedFloor`. `retention` = the existing
`getFrontOverhangRetentionGeometry` output. `wheelWell` = null.

### 4.4 How future warehouse/storage areas become a `SpaceModel`
A warehouse zone is `kind:'warehouseZone'` with `bounds` = its footprint box,
one floor surface, optional blocked volumes (columns, racks) and no
retention/wheelWell. Because the solver consumes only
`zones/blocked/surfaces/retention/wheelWell`, any space expressible in those
terms packs with zero solver changes. Staging areas reuse the same model with
`kind:'stagingArea'` (no stacking rules change; hard rules are item-driven).

### 4.5 How hard rules are centralized
`packing-core/validation.js` exports the single set of predicates:
`checkContainment`, `checkBlockedVolumes`, `checkCollision`,
`checkOrientationPolicy`, `checkSupport` (fraction + supporter rules:
`noStackOnTop`/`stackable:false`, `maxStackCount`, child-vs-support weight with
pallet bypass), `checkRetention`, plus the composed
`validateCandidate(candidate, state)` and `validatePlacements(state)`.
The solver's phase finders and `validatePackedPlacements`, and pack-library's
`aabbIsFullyValid`/`supportCanCarry`, all call these. Tolerances stay the
existing exported constants (`CONTAINMENT_EPS_INCHES = 0.05`,
`MIN_SUPPORT_FRACTION = 0.5`, `CONTACT_EPS = 0.05`). **No rule is weakened; no
tolerance changes.** Parity is proven by tests before any call site switches.

### 4.6 How quality scoring is separated from validity
Already structurally true in the solver (hard filters run before scoring;
scoring is lexicographic among valid candidates). The plan makes it explicit:
`validation.js` owns validity and returns `ValidationResult`; scoring functions
(`scoreFreeRectCandidate`, `scoreLaneCandidate`, `scoreStackCandidate`,
`scoreCompactionCandidate`) never call validation and never receive invalid
candidates. Scoring stays in the solver in this migration wave (moving it to
`scoring.js` is optional later; not required for correctness).

### 4.7 How constrained spaces are prioritized or reserved
Constrained space = a usable zone strictly narrower/shorter than the widest
zone in the space (today's `narrowChannelZones` generalized to
`SpaceModel.constrainedZones`). Near-term (this branch): the Wheel Wells
constrained **leftover pass** (Phase 8) retries staged leftovers into remaining
legal holes in constrained zones first, smaller/channel-fitting items
prioritized. Longer-term (strategy work): a `constrained-first` strategy
pre-reserves constrained-zone capacity for items that *only* fit there before
the general floor pass runs. Reservation is a strategy concern, not a validity
concern, so it lives in strategies — never in validation.

### 4.8 How leftover/unplaced cases are retried
Today: floor-failures get one filler-queue retry and then a stack attempt;
validation rejects get one repack pass; wheel-well leftovers get the
build-up/bridge pass. Added (Phase 8): after stack + bridge and before final
validation, a **leftover-fill pass** rebuilds floor state from packed
placements and re-runs `findFloorPlacement` (and, in constrained zones,
smaller-first ordering) over `output.unpacked`. Anything still unplaced gets a
structured `RejectionReason` per §6 instead of only a free-text warning.

### 4.9 How multiple solution strategies will eventually work
`solveAutoPack` is already parameterized (layoutQuality, wheel-well toggles,
loadFrontFirst). Phase 9 introduces `runStrategies(input, strategyIds)` in
`packing-core/solution.js`: each strategy is a named options-preset/pipeline
wrapper over the existing solver (`default`, `constrained-first`,
`floor-first`, `stack-priority`, `leftover-fill`), producing a
`StrategyResult[]`. The engine picks `selected` (today: `'default'`) and hands
exactly today's shape to the UI. Multi-solution UI (prev/next navigation) is a
later branch; the data shape ships first. Determinism per strategy is
preserved.

### 4.10 How the current UI/editor consumes results without a rewrite
No UI change is required in this migration: the engine keeps returning
`placements/rotations/orientedDims/unpacked/warnings/phaseStats` exactly as
today; `rejectionReasons` and the `solutions` envelope are additive fields.
The first UI consumer (later branch) is the staged-items panel showing the
reason text from `RejectionReason.detail`.

---

## 5. Migration order and safety (maps to branch phases)

| Phase | Change | Behavior change? | Proof |
|---|---|---|---|
| 5 | Create `packing-core` (domain, space-model, orientation re-export, index); `buildSpaceModel` built from existing pack-library + solver geometry; engine/solver keep working unchanged; adapter used read-only | None | Parity tests: `buildSpaceModel` zones/blocked/wheelWell byte-equal to `getTrailerUsableZones`/`getWheelWellsBlockedZones`/`getWheelWellGeometry` for representative Standard / Wheel Wells / Front Overhang fixtures incl. degenerate configs |
| 6 | Create `validation.js`; solver predicates delegate to it; pack-library reconciliation predicates delegate to it | None | Existing 745-test suite green; added equivalence tests (solver rule vs manual rule agree on crafted candidates) |
| 7 | `explain.js` reason codes; solver populates `rejectionReasons` alongside existing warnings | None to placement | Tests assert same placements as before + structured reasons present |
| 8 | Wheel Wells constrained leftover pass | Wheel Wells only: staged leftovers may now legally fill remaining floor/channel holes | Tests: placement count non-decreasing, all hard rules pass, Standard/Front Overhang byte-identical |
| 9 | `solution.js` multi-strategy envelope; engine consumes `selected` | None to default output | Tests: default solution identical to direct solver call |

Rules honored throughout: old solver paths are not deleted; each phase is one
commit; the app stays runnable after every commit; `tp3d-autopack-guard`
contract applies to every edit.

---

## 6. RejectionCode registry (Phase 7)

```
NO_FIT_ANY_SURFACE        too large for any usable surface in any orientation
TOO_WIDE_FOR_CHANNEL      fits only the center channel by length/height but too wide
TOO_WIDE_FOR_SHELF        raised wheel-well shelf too narrow for every orientation
BLOCKED_BY_WHEEL_WELL     every candidate pose intersects a blocked well body
UNSUPPORTED               no supporter set reaches MIN_SUPPORT_FRACTION
SUPPORT_FRACTION_LOW      supporters exist but fraction < MIN_SUPPORT_FRACTION
COM_UNSTABLE              wheel-well COM/overhang stability failed
COLLISION                 every candidate pose collides with packed cargo
ORIENTATION_LOCKED        instance/case orientation policy excludes every fitting pose
STACK_LIMIT               all reachable supporters at maxStackCount capacity
NO_STACK_PERMITTED        all reachable supporters are noStackOnTop/stackable:false
WEIGHT_EXCEEDS_SUPPORT    child-vs-support weight rule rejected all supporters
NO_RETENTION              Front Overhang deck pose lacks complete rear retention
NO_FLOOR_CANDIDATE        floor phases produced no valid candidate
NO_RAISED_CANDIDATE       raised/bridge phases produced no valid candidate
NO_STACK_CANDIDATE        stack phase produced no valid candidate
VALIDATION_STAGED         placed earlier, then staged by final validation (with sub-code)
```

A rejection carries the **most specific** code the failing phase can prove;
`NO_FLOOR_CANDIDATE`/`NO_STACK_CANDIDATE` are fallbacks when no finer cause is
measured. Codes are additive; the UI may localize `detail` text later.

---

## 7. Test strategy

- Normal `npm test` excludes the 800-case PHASE-E1/E2A/E2B stress tests
  (opt-in via `TP3D_STRESS=1`; `npm run test:stress`); coverage is reclassified,
  not removed (Phase 3).
- Every migration phase adds parity/equivalence tests to
  `tests/audit/security-and-invariants.spec.mjs` next to the existing
  AutoPack groups.
- Behavior tests over source-pattern tests, per the guard skill.
- Browser acceptance for editor/3D behavior remains mandatory before merge.
