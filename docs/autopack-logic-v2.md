# AutoPack Engine v2 — Bug Analysis & Fix Plan

> **Date:** 2026-02-09
> **Status:** Analysis complete — no code changes yet
> **Branch:** `feature/editor-case-browser-filter-toggle`

---

## Executive Summary

The current AutoPack engine has **6 bugs** that together cause:
- Boxes left unpacked ("could not fit") when they clearly should fit
- Visual layout broken — boxes float, overlap visually, or don't fill space logically
- Stats misreport packed counts (e.g., "Packed 35 of 39" when all are inside)
- Vertical space underutilized — items spread on the floor instead of stacking

The algorithm's "wall-building" approach is sound in concept, but the implementation has critical flaws in Z-scanning, stacking, scoring, and renderer synchronization.

---

## Bug Inventory

### Bug 1: Single Z-Position Scanning (Critical — boxes left behind)

**Location:** `fillLayer()` in `AutoPackEngine` (~line 1320 of `src/app.js`)

**Problem:**
`fillLayer` scans Z from left wall to right wall using a `zCursor`. For each cursor position, it finds the best item to place. If **no item fits** at the current `zCursor`, the loop **breaks immediately**:

```js
if (bestIdx === -1) { break; }
```

This means:
1. If there's a narrow gap at one Z position, the entire layer pass ends
2. Items that could fit at later Z positions (further right) are never tried
3. Space to the right of an unfillable gap is completely wasted

Additionally, `fillWall` calls `getUsableZRanges(xMid, 0, zones)` with **`yFloor = 0` hardcoded** — the Z-ranges never reflect the actual stacked height. Each pass gets identical ranges, so passes are redundant unless gravity happens to create a viable spot.

**Impact:** 20-40% of packable items may be skipped depending on size variety.

**Fix:**
- Replace `break` with `zCursor += minItemWidth; continue;` to skip past unfillable gaps
- Or: collect all candidate (z, item) pairs across the full Z range, then greedily assign the best non-overlapping set
- Pass actual Y-heights to `getUsableZRanges` to get height-aware ranges per pass

---

### Bug 2: Greedy Wall Thickness Selection (Medium — suboptimal packing)

**Location:** Wall-building main loop in `pack()` (~line 1429 of `src/app.js`)

**Problem:**
For each wall iteration, the algorithm tries every unique item thickness as a candidate wall depth. It picks the thickness that places the **most items** in that single wall. But this greedy choice can be globally suboptimal:

- A wall depth of 48" might pack 5 items tightly
- A wall depth of 24" might only pack 3 items, but leaves room for 10 more items in the next wall
- The greedy pick (5 > 3) wastes the remaining items

The algorithm has no lookahead — it commits to the locally best wall without considering downstream effects.

**Impact:** Layout has random-looking wall choices; some walls are half-empty while boxes sit unpacked.

**Fix:**
- Add 1-wall lookahead: for top-2 thickness candidates, simulate the next wall too, pick the combo that places the most items total
- Or: weight the score by `placed / wallDepth` (density) rather than raw count, so thin efficient walls beat thick sparse walls

---

### Bug 3: Renderer halfWorld.y Doesn't Account for Rotation (Medium — visual bugs)

**Location:** `createInstanceGroup()` in `createCaseScene()` (~line 198 of `src/screens/editor-screen.js`)

**Problem:**
When a 3D mesh is created, `halfWorld` is computed from the **original, unrotated** dimensions:

```js
const lengthW = SceneManager.toWorld(dims.length);
const widthW = SceneManager.toWorld(dims.width);
const heightW = SceneManager.toWorld(dims.height);
group.userData.halfWorld = { x: lengthW / 2, y: heightW / 2, z: widthW / 2 };
```

Then `applyTransform` uses `halfWorld.y` for floor clamping:

```js
const halfY = group.userData.halfWorld ? group.userData.halfWorld.y : 0;
worldPos.y = Math.max(halfY || 0.01, worldPos.y);
```

When AutoPack flips a case (canFlip), the oriented height changes. Example:
- Original dims: 48×24×32 (H=32 → halfWorld.y = toWorld(16))
- Flipped orientation: `tryOri(H, W, L, 0)` → oriented dims = 32×24×48 (new H=48)
- AutoPack sets position.y based on oriented height (48/2 = 24)
- But the renderer's floor clamp still uses original halfWorld.y = toWorld(16)

If the AutoPack Y is correct (24 inches), the renderer converts to world and compares with halfWorld.y based on 16 — this works because `Math.max(halfY, worldPos.y)` picks the higher value. But if AutoPack places a box at Y=16 (oriented height 32 → 32/2=16), and the renderer has halfWorld.y based on original height 32 → 16, the clamp matches — also fine.

**The real problem** occurs when the box is flipped so the **new height is smaller** than the original:
- Original: 48×24×32 (H=32), halfWorld.y = toWorld(16) = 0.8
- Flipped to: `tryOri(L, H, W, 0)` → 48×32×24 (new H=24), AutoPack sets Y=12
- Renderer: worldPos.y = toWorld(12) = 0.6, halfY = 0.8
- Floor clamp: `Math.max(0.8, 0.6)` = 0.8 → box is pushed UP to 0.8 instead of 0.6
- **Box floats above its correct position by the difference**

**Impact:** Flipped cases appear to float above where they should be. Collision detection in the algorithm was correct, but the visual doesn't match.

**Fix:**
- After applying rotation in `applyTransform`, recalculate `halfWorld` based on the **effective** vertical axis:
  ```js
  // If rotated 90° around Y, swap X and Z in halfWorld
  // If flipped (X or Z rotation), swap Y with the affected axis
  ```
- Or: store `orientedDims` on the instance and use it for halfWorld calculation in `sync()`

---

### Bug 4: Scoring Over-Penalizes Stacking (Medium — wastes vertical space)

**Location:** Score calculation in `fillLayer()` (~line 1360 of `src/app.js`)

**Problem:**
```js
const score =
  -restY * 100 +                       // lower is better (gravity)
  (ori.w / zRemain) * 5000 +           // fill width tightly
  (ori.l / wallDepth) * 2000 +         // use depth efficiently
  (ori.w * ori.h) * 1 +                // cross-section area
  item.volume * 0.0001;                // volume tiebreaker
```

The `-restY * 100` term creates a massive penalty for stacking:
- Floor placement (restY=0): penalty = 0
- Stacking at 48" (restY=48): penalty = -4800
- Maximum Z-fill bonus: 5000
- Maximum depth bonus: 2000

At typical stacking heights (24-48"), the gravity penalty almost cancels the Z-fill bonus entirely. The algorithm strongly prefers placing **any** small item on the floor over stacking a large item on top of a solid base.

In real truck loading, you **want** to stack — fill floor-to-ceiling, then advance to the next wall section. The current scoring discourages this.

**Impact:** Items spread across the floor in a thin layer instead of stacking wall-to-wall floor-to-ceiling. Truck length is consumed quickly, leaving items "unpacked."

**Fix:**
- Reduce gravity weight to `-restY * 10` or `-restY * 20`
- Add a "flush stacking" bonus: if the item's footprint aligns closely with items below it, add +2000
- Add a "ceiling utilization" factor: `(cy + ori.h/2) / truckH * 1000` to reward using vertical space

---

### Bug 5: computeStats Zone Containment Has Zero Tolerance (Low — misreports)

**Location:** `isAabbContainedInAnyZone()` in `src/services/pack-library.js` (~line 140)

**Problem:**
```js
if (aabb.min.x >= z.min.x && aabb.max.x <= z.max.x && ...)
```

This is exact comparison with no epsilon. AutoPack places items using floating-point arithmetic, so a box at x=0.0000000001 will fail the `>= 0` check. The algorithm considers it packed (it passed the `TrailerGeometry.isAabbContainedInAnyZone` check with a tolerance), but `computeStats` disagrees.

**Impact:** Toast says fewer packed items than actually placed. Confusing to users.

**Fix:**
Add a small epsilon (0.05 inches) to `isAabbContainedInAnyZone` in `pack-library.js`:
```js
const EPS = 0.05;
if (aabb.min.x >= z.min.x - EPS && aabb.max.x <= z.max.x + EPS && ...)
```

---

### Bug 6: Cylinder/Drum Shape Not Handled in AutoPack (Low — edge case)

**Location:** `buildOrientations()`, `hasPackingCollision()`, `findRestingY()` in `AutoPackEngine`

**Problem:**
`geometry-factory.js` supports cylinder shapes (`shape === 'cylinder' || shape === 'drum'`), but AutoPack treats everything as axis-aligned bounding boxes. Cylinders get their bounding box used for packing — this wastes ~21% of the cylinder's footprint area (π/4 vs 1.0). More importantly, `volumeForShape()` in geometry-factory.js computes cylinder volume correctly, but `volumeInCubicInches()` in `core/utils` doesn't — it always uses `L×W×H`. This causes a volume discrepancy between the case library and AutoPack sorting.

**Impact:** Cylinders are sorted by incorrect volume and waste significant packing space. This only matters if users have cylinder-shaped cases.

**Fix:**
- For packing purposes, AABB is acceptable (real cylinders in cases are usually in rectangular crates)
- But volume sorting should use `volumeForShape(dims, shape)` instead of `volumeInCubicInches(dims)` for accurate FFD sorting

---

## Priority Order for Fixes

| Priority | Bug | Effort | Impact |
|----------|-----|--------|--------|
| 🔴 P0 | Bug 1: Z-scanning breaks on first gap | Medium | Fixes most "boxes left behind" |
| 🔴 P0 | Bug 4: Scoring kills stacking | Low | Fixes "wasted vertical space" |
| 🟠 P1 | Bug 3: Renderer halfWorld.y mismatch | Medium | Fixes "boxes float" visual |
| 🟡 P2 | Bug 5: Stats zero-tolerance | Trivial | Fixes count mismatch |
| 🟡 P2 | Bug 2: Greedy wall selection | High | Improves overall density |
| ⚪ P3 | Bug 6: Cylinder volume sorting | Trivial | Edge case |

---

## Recommended Fix Strategy

### Phase 1 (Critical — should fix "boxes left behind" + "broken layout")

1. **Fix `fillLayer` Z-scanning** — don't `break` on first failure; advance cursor and keep trying
2. **Reduce gravity penalty** in scoring from `-restY * 100` to `-restY * 15` and add stacking bonus
3. **Fix `halfWorld.y`** floor clamp in renderer to use oriented dims when rotation is present

### Phase 2 (Polish — improves density + accuracy)

4. **Add epsilon** to `computeStats` zone containment
5. **Add 1-wall lookahead** to thickness selection
6. **Use shape-aware volume** for FFD sorting

### Phase 3 (Future — advanced)

- Consider implementing "layer-based" packing: define horizontal layers at fixed Y heights, fill each layer 2D, then stack layers
- Add rotation trial in `fillLayer`: for each (z, item) pair, try all orientations and pick the best — the current code already does this, but the scoring prevents it from being effective

---

## Data Flow (Current vs Fixed)

### Current (buggy):
```
for each wall:
  try each thickness → pick most items placed
  fillWall:
    for each pass:
      fillLayer:
        zCursor left→right
        find best item at zCursor
        if none fits → BREAK (❌ skips rest of row)
        place item, advance zCursor
```

### Fixed (proposed):
```
for each wall:
  try top-2 thicknesses + 1-wall lookahead → pick best total
  fillWall:
    for each pass:
      fillLayer:
        zCursor left→right
        find best item at zCursor
        if none fits → advance zCursor by min-item-width, CONTINUE (✅)
        place item, advance zCursor
      (reduced gravity penalty allows stacking in subsequent passes ✅)
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/app.js` — `AutoPackEngine` | Fix fillLayer break logic, adjust scoring weights, optional lookahead |
| `src/screens/editor-screen.js` — `applyTransform()` | Use oriented dims for halfWorld.y floor clamp |
| `src/services/pack-library.js` — `isAabbContainedInAnyZone()` | Add epsilon tolerance |

---

## Test Plan

After applying fixes, verify with these scenarios:

1. **Mixed sizes** — 5 large + 10 medium + 20 small cases → expect 0 unpacked
2. **Identical items** — 30 identical boxes → expect uniform wall-to-wall stacking
3. **Flippable items** — Cases with `canFlip=true` → expect correct visual height, no floating
4. **Tight fit** — Cases that exactly fill the truck volume → expect near-100% utilization
5. **WheelWells mode** — Cases in a wheel-well trailer → expect no items in blocked zones
6. **FrontBonus mode** — Loading from front → expect correct direction + bonus zone usage

---

## Reference Notes

The two Turbopack JS files (`323d3112d8db20bd.js`, `99ad5be0428457f4.js`) in the `truckpacker/scripts/` folder are React/Next.js runtime bundles (React DOM internals, scheduler, CSS modules for a tweet embed component). They contain **no packing algorithm code** and are not relevant to the AutoPack bugs. They appear to be from a separate Next.js marketing/docs site build.
