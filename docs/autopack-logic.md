# AutoPack Engine — Logic & Architecture

## Overview

The AutoPack Engine is a **Wall-Building 3D Bin Packing** algorithm that automatically arranges cargo cases inside a truck trailer. It lives entirely inside `src/app.js` as the `AutoPackEngine` IIFE (Immediately Invoked Function Expression).

The goal: pack boxes tightly from wall to wall, floor to ceiling, with zero gaps — like loading a real truck.

---

## Files Involved

| File | Role |
|------|------|
| `src/app.js` — `AutoPackEngine` IIFE (~lines 1154–1750) | The packing algorithm itself |
| `src/app.js` — `TrailerGeometry` IIFE (~lines 711–920) | Truck shape zones (rect, wheelWells, frontBonus) |
| `src/screens/editor-screen.js` — `createCaseScene()` | 3D rendering of boxes (mesh, position, rotation) |
| `src/screens/editor-screen.js` — `createEditorScreen()` | UI: AutoPack button click handler |
| `src/editor/geometry-factory.js` | Creates `THREE.BoxGeometry` for each case |
| `src/services/pack-library.js` — `computeStats()` | Counts packed vs unpacked, volume percentage |

---

## Coordinate System

All positions are in **inches**, centered:

- **X-axis** = truck length (0 = rear door, L = front wall)
- **Y-axis** = height (0 = floor, H = ceiling)
- **Z-axis** = width (centered: -W/2 = left wall, +W/2 = right wall)

Positions are **center-based** — a box at `{x:50, y:25, z:0}` has its center at that point.

The 3D renderer converts inches to world units using `INCH_TO_WORLD = 0.05`.

---

## How the Algorithm Works

### Step 1: Preparation

1. **Collect all visible cases** from the current pack
2. **Sort by volume descending** (First-Fit Decreasing — largest items first)
3. **Stage all items** outside the truck instantly (no animation flicker)
4. **Get usable zones** from `TrailerGeometry.getTrailerUsableZones(truck)` based on the trailer shape mode

### Step 2: Wall-Building Main Loop

The algorithm builds the truck load as a series of vertical "walls" (slabs along the X-axis):

```
TRUCK (top view, looking down)
┌──────────────────────────────────────┐
│  Wall 1  │  Wall 2  │  Wall 3  │    │
│  (rear)  │          │          │    │
│          │          │          │    │
│ X=0..24  │ X=24..48 │ X=48..96 │    │
└──────────────────────────────────────┘
  rear door                        front
```

For each wall:

1. **Get candidate wall thicknesses** — all unique X-depth dimensions from remaining items, sorted by frequency (most common first, for uniform walls)
2. **Try each thickness** — for each candidate, make a copy of the state and attempt to fill that wall
3. **Pick the best** — the thickness that places the most items wins
4. **Advance the X cursor** by the actual depth used (not the theoretical wall thickness)

### Step 3: Filling a Wall (fillWall)

Each wall is filled with multiple passes. Each pass scans Z from left wall to right wall, and **gravity** determines the Y position:

```
WALL CROSS-SECTION (looking from rear)
┌─────────────────────────┐ ← ceiling
│                         │
│    ┌────┐  ┌────────┐   │
│    │ B  │  │   C    │   │  ← row 2 (on top of row 1)
│    ├────┤  ├────────┤   │
│    │ A  │  │   D    │   │  ← row 1 (on floor)
└────┴────┴──┴────────┴───┘ ← floor
left                    right
```

### Step 4: Gravity (findRestingY)

**This is the physics function.** For each candidate position (X, Z), the box "drops" straight down:

1. Check all already-packed boxes for horizontal overlap (X and Z)
2. Find the highest top surface among overlapping boxes
3. That surface (or the floor at Y=0) becomes the resting point
4. The box center Y = restingY + boxHeight/2

Nothing floats. Every box either sits on the floor or on top of another box.

### Step 5: Orientations (buildOrientations)

Each item can be tried in multiple orientations:

| Orientation | Dims (l, w, h) | Y-Rotation | When Available |
|---|---|---|---|
| Original | L, W, H | 0 | Always |
| Yaw 90deg | W, L, H | 90deg | Always |
| Flat (H→X) | H, W, L | 0 | canFlip only |
| Flat rotated | W, H, L | 90deg | canFlip only |
| Flat (H→Z) | L, H, W | 0 | canFlip only |
| Flat rotated | H, L, W | 90deg | canFlip only |

**Physics constraint:** Only Y-axis rotation is used. This ensures:
- The mesh always renders correctly (rotation around Y just swaps visual L and W)
- `halfWorld.y` (used for floor clamping) stays correct
- No boxes appear to float or clip through the floor

For `canFlip` items, the height axis can change — allowing items to be laid flat.

### Step 6: Scoring

When multiple items could fit at a position, the algorithm scores each candidate:

```
score = -restY * 100          // lower resting = better (fill from floor up)
       + (w / zRemain) * 5000 // tight Z fill (wall-to-wall)
       + (l / wallDepth) * 2000 // use wall depth efficiently
       + (w * h) * 1          // cross-section area
       + volume * 0.0001      // volume tiebreaker
```

The negative `restY` weight means items that rest closer to the floor are preferred — this builds a stable base before stacking.

### Step 7: Zone Containment

Every placed box must fit entirely within at least one usable zone. `TrailerGeometry.isAabbContainedInAnyZone()` checks this with a 0.01-inch tolerance.

### Step 8: Collision Detection

`hasPackingCollision()` checks the candidate box against all already-packed boxes using AABB (Axis-Aligned Bounding Box) overlap with a tiny epsilon to avoid floating-point edge cases.

### Step 9: Persist & Animate

After the algorithm finishes:

1. **Rotation** is applied immediately to each 3D object
2. **Position** is animated with TWEEN.js (smooth slide into place)
3. **State is saved** to `PackLibrary` with both `position` and `rotation` on each instance's `transform`
4. **orientedDims** are stored on each instance for `computeStats()` to use
5. **Stats** are computed and displayed via toast

---

## Trailer Shape Modes

### rect (Standard)
One simple zone: the full interior box.
```
Zone: { x: 0→L, y: 0→H, z: -W/2→+W/2 }
```

### frontBonus (Front Overhang)
Two zones — main body + a narrower front section:
```
Zone 1: { x: 0→splitX, y: 0→H, z: -W/2→+W/2 }           // main
Zone 2: { x: splitX→L, y: 0→bonusH, z: -bonusW/2→+bonusW/2 } // front overhang
```
Loading direction is **front-first** (xCursor starts at L, moves toward 0).

### wheelWells
Five zones — full rear, narrow corridor between wells, above-well zones on each side, full front:
```
Zone 1: rear full-width
Zone 2: center corridor between wells (full height)
Zone 3: left above-well (above wellHeight only)
Zone 4: right above-well (above wellHeight only)
Zone 5: front full-width
```

---

## How the Renderer Works

`createCaseScene()` in `editor-screen.js` manages the 3D representation:

1. **Mesh creation** (`createInstanceGroup`): Creates `THREE.BoxGeometry(L, H, W)` using the **original** case dimensions. The mesh is always this size.

2. **Position** (`applyTransform`): Converts inch position to world coordinates, applies floor clamping using `halfWorld.y`, sets `group.position`.

3. **Rotation** (`applyTransform`): Sets `group.rotation.set(rot.x, rot.y, rot.z)` from the stored transform. A Y-rotation of 90deg visually swaps L and W while keeping H vertical — this is why the algorithm only uses Y-rotation.

4. **Sync cycle**: When `PackLibrary.update()` is called, the editor's state listener triggers `CaseScene.sync(pack)`, which calls `applyTransform()` on every instance.

---

## computeStats (pack-library.js)

`computeStats()` determines how many cases are "packed" (inside the truck) vs "unpacked":

1. Gets usable zones for the truck
2. For each case instance, builds an AABB using `orientedDims` (if available) or original dimensions
3. Checks if the AABB is contained within any usable zone
4. Calculates volume percentage: `(sum of packed case volumes) / (truck capacity)`

---

## Data Flow

```
User clicks AutoPack
    ↓
editor-screen.js: btnAutopack click handler
    ↓
AutoPackEngine.pack()
    ↓
1. Get pack data, truck, zones
2. Sort items by volume (FFD)
3. Stage items outside truck (instant)
4. Wall-building loop:
   for each wall slab along X:
     for each pass:
       for each Z position (left→right):
         for each remaining item + orientation:
           findRestingY() ← GRAVITY
           check zone containment
           check collision
           score and pick best
         place best item
   advance X cursor
5. Animate placements (tween positions, set rotations)
6. Save to PackLibrary (position + rotation + orientedDims)
    ↓
PackLibrary.update() triggers state change
    ↓
editor-screen render() → CaseScene.sync()
    ↓
applyTransform() sets 3D position + rotation on each mesh
    ↓
computeStats() counts packed items, shows toast
```

---

## Key Constraints

- **No inline CSS in JS** (project rule)
- **No new CSS classes** (project rule)
- **No new files** unless absolutely necessary
- **Positions are center-based in inches**
- **Only Y-rotation** is used — ensures visual correctness with the renderer
- **Gravity is enforced** — every box must rest on floor or another box
- **Zone containment** — boxes cannot extend outside the truck or into wheel wells
- **Collision detection** — no two boxes overlap
