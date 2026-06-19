# Truck Geometry Change Reconciliation Status — 2026-06-18

## Result

PASS for the implemented reconciliation service, shared confirmation controller, routing guards, and automated runtime fixtures.

Starting SHA: `6206afffcb3abfb2b0c1f5377cba6b7b73885ce2`

Branch: `fix/truck-geometry-change-reconciliation`

## Production routing

One `TruckChangeController` instance is created in `src/app.js` and injected into both production screens.

All Editor writers call `applyTruckGeometryChange`, which delegates to the shared controller:

- trailer preset
- shape mode
- length, width, and height
- Wheel Wells Update and Reset
- Front Overhang Update and Reset

Both Packs writers call the same controller:

- Packs toolbar trailer preset
- Edit Pack Save when geometry changes

The controller owns the default atomic `truck + cases` update. Edit Pack supplies an atomic commit callback so metadata, truck, and reconciled cases remain one history entry. Packs screen code contains no truck-only update path.

## Reconciliation contract

- Every real geometry change with cases opens a preview, including all-kept and adjusted-only results.
- Preview is pure. It does not update the pack, Stats, history, autosave, or scene.
- Hidden packed instances remain physical collision and support geometry.
- Existing staged instances stay staged and unmoved when floor-contacting, collision-free, outside the truck, and inside the reachable work area. Unsafe staging poses are repaired deterministically.
- Missing case references and malformed dimensions are preserved, reported by ID, and block confirmation.
- Effective dimensions come from validated case dimensions plus normalized rotation through the shared oriented-dimensions helper. Missing or stale `orientedDims` are recomputed; fake fallback dimensions are not used.
- Kept and adjusted packed instances pass containment, overlap, floor/deck/support, support fraction, `stackable`, `noStackOnTop`, direct-child `maxStackCount`, weight, orientation policy, and exact instance-lock checks.
- Repack keeps accepted placements fixed and returns explicit `repackedIds`, `stagedIds`, `failedIds`, and `warnings`. Failures are never silently staged.
- Partial repack opens a second decision and commits only after the user explicitly accepts staging the remaining IDs.
- Staging center Y is exactly `dims.height / 2`.
- Cancel, close, overlay dismissal, and Escape share the restoration path. Action buttons are single-flight and failures keep the modal open.

## Automated evidence

- Full suite: 662 passed, 0 failed.
- Focused reconciliation suite: 17 passed, including a 24-fixture Standard/Wheel Wells/Front Overhang and dimension-change matrix.
- Real THREE `Box3` bounds agree with canonical rotated dimensions.
- Fixtures cover hidden packed cargo, existing staged cargo, unresolved references, stale/missing oriented dimensions, exact locks, upright-policy rejection, support movement, `noStackOnTop`, direct-child `maxStackCount`, partial and complete repack failure, one-inch staging, deterministic staging/repack, and stage/repack undo/redo.
- `npm run -s typecheck`: pass.
- `npm run lint`: pass with 28 existing JavaScript warnings and 18 existing HTML warnings; 0 errors.
- `git diff --check` and `git diff --cached --check`: pass.
- Safety constants remain `CONTAINMENT_EPS_INCHES = 0.05` and `MIN_SUPPORT_FRACTION = 0.5`.

## Remaining limits

- An authenticated end-to-end browser click-through of the Packs toolbar and Edit Pack modal was not completed because the local app stopped at the Authentication overlay and no test credentials were available. Production source reachability guards plus runtime controller behavior cover those routes, but this is not a substitute for an authenticated browser smoke test.
- Graphify navigation was used before implementation. Its incremental rebuild did not complete: the skill's documented `graphify --update` syntax is unsupported by the installed CLI, and `graphify update .` subsequently hit a filesystem permission/lock failure and then hung when retried with permission. The temporary rebuild lock was removed; existing graph output was not changed.
- This repair does not change AutoPack scoring, truck-zone definitions, Unpack grouping/layout, orientation-lock UI, or unrelated styling.

## Commits

- `f5cb5d2` — `fix: enforce canonical truck reconciliation`
- `f28da32` — `fix: route truck changes through shared confirmation`
- `399d861` — `test: cover truck reconciliation runtime outcomes`
