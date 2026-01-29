# Pack Preview Thumbnail + Sorting/Filtering - Feature Audit

**Date:** 2025-01-15  
**Purpose:** Focused audit for implementing pack preview thumbnails and sorting/filtering system  
**Target Codebase:** Truck Packer 3D v1.0.0 (single-file architecture in index.html)

---

## 1. Project Entry + Runtime

### Bootstrap Sequence

**Primary entry file:** `index.html` (7898 lines)

**Pre-DOMContentLoaded:**

1. **CDN libraries load** (lines 18-42):
   - Three.js ESM via esm.sh with import map
   - OrbitControls module
   - TWEEN.js for animations
   - jsPDF for PDF export
   - XLSX (SheetJS) for CSV/XLSX import
   - Font Awesome CSS
   - Google Fonts (Inter)

2. **Inline app IIFE executes** (lines 1583-7898):
   - All modules defined as closures inside `window.TruckPackerApp`
   - No external dependencies; pure vanilla JS + Three.js

3. **Three.js boot loader** (lines 7880-7897):
   ```javascript
   (async function () {
     await window.__TP3D_BOOT.threeReady; // Wait for Three.js ESM load
     window.TruckPackerApp.init(); // Bootstrap app (line 7886)
   })();
   ```

**DOMContentLoaded listener:** Line 7890

- Ensures DOM is ready before calling `TruckPackerApp.init()`
- Fallback in case async boot completes before DOM ready

### Initialization Flow (`TruckPackerApp.init()` - line ~7815)

1. **WebGL check** → SystemOverlay if not available
2. **Load persisted data** → `Storage.load()` from localStorage
3. **Normalize data** → `Normalizer.normalizeAppData()` validates + migrates schema
4. **Initialize state** → `StateStore.init()` with normalized data
5. **Apply theme** → `PreferencesManager.applyTheme()`
6. **Subscribe to auto-save** → `StateStore.subscribe()` → `Storage.saveSoon()` (debounced 250ms)
7. **Initialize UI modules** → `PacksUI.init()`, `CasesUI.init()`, `EditorUI.init()`, etc.
8. **Render initial screen** → `AppShell.renderShell()` + screen-specific renders
9. **Global keyboard shortcuts** → `document.addEventListener('keydown', ...)`
10. **Window resize handler** → Debounced `SceneManager.resize()`

**Global object:** `window.TruckPackerApp`

- All modules are properties of this IIFE closure
- No module bundler; no import/export statements

---

## 2. Current File/Layout Map (Feature-Specific)

### A) Pack Data Model + Migration/Normalizer

| File         | Module/Function              | Purpose                                                                       | Line #     |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------- | ---------- |
| `index.html` | `PackLibrary` module         | Pack CRUD operations, instance management, stats computation                  | ~3680-3740 |
| `index.html` | `PackLibrary.create()`       | Creates new pack with default structure (including `createdAt`, `lastEdited`) | ~3474      |
| `index.html` | `PackLibrary.update()`       | Updates pack fields, recalculates stats, sets `lastEdited = Date.now()`       | ~3494      |
| `index.html` | `Normalizer.normalizePack()` | Validates + normalizes pack data on load/import; migration entry point        | ~2650-2680 |
| `index.html` | `Defaults.seedPack()`        | Demo pack factory; shows required pack structure                              | ~2520-2527 |

**Pack model shape (actual structure from code):**

```javascript
{
  id: string,              // UUID
  title: string,           // "Demo Pack"
  client: string,          // "Example Client"
  projectName: string,     // "Envato Preview"
  drawnBy: string,         // "Truck Packer 3D"
  notes: string,           // User notes
  truck: {
    length: number,        // inches (636 = 53ft trailer)
    width: number,         // inches (102)
    height: number         // inches (98)
  },
  cases: CaseInstance[],   // Placed instances
  groups: Group[],         // Future: grouped instances
  stats: {
    totalCases: number,
    packedCases: number,
    volumeUsed: number,
    volumePercent: number,
    totalWeight: number
  },
  createdAt: number,       // timestamp
  lastEdited: number       // timestamp (updated on PackLibrary.update)
}
```

**Critical timestamps:**

- `createdAt`: Set once on pack creation
- `lastEdited`: Updated on every `PackLibrary.update()` call (line 3494)
- **No separate `updatedAt` field** (uses `lastEdited` for all modifications)

### B) Packs List UI Rendering

| File         | Module/Function              | Purpose                                                                             | Line #                 |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| `index.html` | `PacksUI` module             | Packs screen: grid rendering, search, CRUD modals                                   | ~3768-4200             |
| `index.html` | `PacksUI.render()`           | Main render loop: filters packs, builds grid, handles empty state                   | ~3790-3860             |
| `index.html` | `PacksUI.buildPreview(pack)` | **Preview generator** - currently renders colored blocks; **TODO: canvas snapshot** | ~3911-3940             |
| `index.html` | `PacksUI.init()`             | Sets up search input listener, button handlers                                      | ~3775-3788             |
| `index.html` | Pack card HTML generation    | Creates `.pack-card` with preview, title, metadata, kebab menu                      | ~3800-3858             |
| `index.html` | Search input `#packs-search` | Filters by `title` or `client` (lowercase includes)                                 | ~3790 + listener ~3777 |

**Current preview logic (line 3911-3940):**

```javascript
function buildPreview(pack) {
  // TODO: Replace with actual canvas snapshot rendering
  // Should use SceneManager to render pack contents off-screen
  // and capture via canvas.toDataURL() for realistic preview

  const preview = document.createElement('div');
  const items = (pack.cases || []).slice(0, 12); // Max 12 items

  if (!items.length) {
    preview.className = 'pack-preview empty';
    preview.textContent = 'No items yet';
    return preview;
  }

  preview.className = 'pack-preview'; // CSS grid: 6 columns
  items.forEach(inst => {
    const cell = document.createElement('div');
    cell.className = 'pack-preview-cell'; // Colored div
    const meta = CaseLibrary.getById(inst.caseId);
    if (meta && meta.color) cell.style.background = meta.color;
    cell.title = meta ? meta.name : 'Case';
    preview.appendChild(cell);
  });
  return preview;
}
```

**Preview CSS (lines ~980-1040):**

- `.pack-preview`: 120px height, CSS grid (6 columns), 6px gap
- `.pack-preview-cell`: Colored blocks, rounded corners, min-height 30px
- `.pack-preview.empty`: Centers "No items yet" text

### C) Editor Save/Exit Flow

| File         | Module/Function             | Purpose                                                                      | Line #     |
| ------------ | --------------------------- | ---------------------------------------------------------------------------- | ---------- |
| `index.html` | `EditorUI` module           | Editor screen: 3D workspace, case browser, inspector, toolbar                | ~6746-7260 |
| `index.html` | `EditorUI.init()`           | Sets up Three.js scene, raycaster, drag handlers, keyboard shortcuts         | ~6820-6900 |
| `index.html` | `EditorUI.render()`         | Syncs 3D scene with current pack, updates inspector                          | ~6797-6815 |
| `index.html` | `EditorUI` AutoPack handler | Line ~7100-7140 - Auto-placement algorithm; **best hook for auto-thumbnail** | ~7522      |
| `index.html` | Navigation to other screens | `AppShell.navigate()` called on sidebar button click - **implicit save**     | ~3735      |
| `index.html` | Screenshot button handler   | Line ~7160 - Captures PNG via `renderer.domElement.toDataURL()`              | ~7697-7714 |
| `index.html` | PDF export handler          | Line ~7176 - Captures canvas for jsPDF; already has capture logic            | ~7716-7781 |

**Save triggers (where `PackLibrary.update()` is called):**

- AutoPack completion (line 7522)
- Truck dimensions change (line 7057)
- Instance transform change (drag, nudge, rotate) (line 7178)
- Instance visibility toggle (line 7155)
- Delete instances (line 6225)
- Undo/Redo (indirect via StateStore history replay)

**No explicit "Save" or "Exit Editor" button exists**

- Saves happen automatically on every pack modification via `PackLibrary.update()`
- Navigation away from editor does NOT trigger any special save logic
- StateStore subscriber auto-saves to localStorage on data changes

### D) SceneManager / Three.js Renderer Access

| File         | Module/Function                    | Purpose                                                              | Line #                   |
| ------------ | ---------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| `index.html` | `SceneManager` module              | Three.js scene/camera/renderer/controls management                   | ~5800-6400               |
| `index.html` | `SceneManager.init(containerEl)`   | Creates scene, camera, renderer, controls; starts render loop        | ~5850-5950               |
| `index.html` | `SceneManager.getRenderer()`       | **Returns THREE.WebGLRenderer instance** - needed for canvas capture | ~6395 (return statement) |
| `index.html` | `SceneManager.getScene()`          | Returns THREE.Scene for off-screen rendering                         | ~6391 (return statement) |
| `index.html` | `SceneManager.getCamera()`         | Returns THREE.PerspectiveCamera                                      | ~6392 (return statement) |
| `index.html` | `SceneManager.setTruck(truckDims)` | Rebuilds truck wireframe; resets camera target                       | ~6100-6140               |
| `index.html` | `SceneManager.render()`            | Renders frame to canvas; called every RAF tick                       | ~6070-6090               |
| `index.html` | `CaseScene.sync(pack)`             | Syncs 3D instances with pack data; disposes/rebuilds meshes          | ~6430-6520               |

**Existing canvas capture examples:**

1. **Screenshot PNG** (line ~7697-7714):

   ```javascript
   const renderer = SceneManager.getRenderer();
   const dataUrl = renderer.domElement.toDataURL('image/png');
   Utils.downloadText(filename, dataUrl, 'image/png');
   ```

2. **PDF export** (line ~7720-7780):
   ```javascript
   const renderer = SceneManager.getRenderer();
   const imgData = renderer.domElement.toDataURL('image/png');
   pdf.addImage(imgData, 'PNG', x, y, width, height);
   ```

**Coordinate system:**

- `1 world unit = 20 inches` (INCH_TO_WORLD = 0.05)
- Truck at origin: X+ = length, Y+ = height, Z+ = width
- Camera uses OrbitControls; target auto-centers on truck

### E) Storage Read/Write and Save Triggers

| File         | Module/Function               | Purpose                                                           | Line #                   |
| ------------ | ----------------------------- | ----------------------------------------------------------------- | ------------------------ |
| `index.html` | `Storage` module              | localStorage read/write, export/import JSON                       | ~2280-2380               |
| `index.html` | `Storage.load()`              | Reads `localStorage['truckPacker3d:v1']`, parses JSON, sanitizes  | ~2290-2300               |
| `index.html` | `Storage.saveNow()`           | Writes state to localStorage immediately; called after debounce   | ~2330-2345               |
| `index.html` | `Storage.saveSoon()`          | Debounced save (250ms); prevents spam writes                      | ~2320-2325               |
| `index.html` | `StateStore.subscribe()`      | Triggers `Storage.saveSoon()` on state changes (except undo/redo) | ~7858 (subscriber setup) |
| `index.html` | `Storage.exportAppJSON()`     | Serializes full app state as JSON string                          | ~2350-2365               |
| `index.html` | `Storage.importAppJSON(text)` | Parses + validates imported JSON                                  | ~2370-2380               |

**localStorage key:** `truckPacker3d:v1`

**Payload structure (line 2333-2343):**

```javascript
{
  version: "1.0.0",
  savedAt: Date.now(),
  caseLibrary: Case[],
  packLibrary: Pack[],
  preferences: Preferences,
  currentPackId: string | null
}
```

**Save flow:**

```
User modifies pack → PackLibrary.update() → StateStore.set({ packLibrary: [...] })
  → StateStore subscribers notified → Storage.saveSoon() debounces
  → After 250ms → Storage.saveNow() writes to localStorage
```

**Storage limits:**

- localStorage typically 5-10MB per origin
- Data URL images (base64 PNG) are ~133% of binary size
- 512x256 PNG thumbnail ≈ 30-80KB base64 (depends on complexity)
- 100 packs with thumbnails ≈ 3-8MB (approaching limit)

---

## 3. Data Model Reality Check (Packs + Storage Constraints)

### Actual Pack Shape (from Normalizer + PackLibrary)

**Current fields** (line 2660-2680 in `Normalizer.normalizePack()`):

```typescript
interface Pack {
  id: string; // UUID (normalized, never null)
  title: string; // Normalized with fallback "Untitled Pack"
  client: string; // Normalized to empty string if missing
  projectName: string; // Normalized to empty string if missing
  drawnBy: string; // Normalized to empty string if missing
  notes: string; // Normalized to empty string if missing
  truck: {
    length: number; // Positive number, default 636
    width: number; // Positive number, default 102
    height: number; // Positive number, default 98
  };
  cases: CaseInstance[]; // Normalized instances with UUID regeneration
  groups: Group[]; // Always array (empty if missing)
  stats: PackStats; // Computed, never saved (always recalculated)
  createdAt: number; // Timestamp, normalized with fallback to now
  lastEdited: number; // Timestamp, normalized with fallback to now
}
```

**Timestamp usage:**

- `createdAt`: Set once on pack creation (line 3483)
- `lastEdited`: Updated on every `PackLibrary.update()` call (line 3494)
- **Sorting/filtering will use `lastEdited` for "recently edited" sort**

### Safe Fields to Add (Migration Strategy)

**New fields for thumbnail feature:**

```typescript
interface Pack {
  // ... existing fields
  thumbnail?: string | null; // Data URL or null
  thumbnailUpdatedAt?: number; // Timestamp when thumbnail was captured
  thumbnailSource?: 'auto' | 'manual' | 'upload'; // How thumbnail was created
}
```

**Migration entry point:** `Normalizer.normalizePack()` (line ~2660)

```javascript
function normalizePack(p, caseMap, now) {
  const pack = {
    // ... existing normalization
    thumbnail: typeof p.thumbnail === 'string' ? p.thumbnail : null,
    thumbnailUpdatedAt: finiteNumber(p && p.thumbnailUpdatedAt, null),
    thumbnailSource: ['auto', 'manual', 'upload'].includes(p.thumbnailSource)
      ? p.thumbnailSource
      : null,
  };
  // ...
}
```

**Backward compatibility:**

- Optional fields default to `null` if missing
- Old exports without thumbnails will import cleanly
- `Normalizer` ensures type safety (string or null, never undefined)

### localStorage Payload Format (Confirmed)

**Key:** `truckPacker3d:v1`

**Structure (line 2333):**

```javascript
{
  version: APP_VERSION,        // "1.0.0"
  savedAt: Date.now(),         // Last save timestamp
  caseLibrary: [...],
  packLibrary: [...],          // Pack[] with new optional fields
  preferences: {...},
  currentPackId: "uuid" | null
}
```

**Version handling:**

- `version` field exists but not actively enforced (line 2296: "allow older versions if shape
  matches")
- Future: Use version for migration triggers if needed

**Data URL size estimates:**

- 512x256 PNG (basic): ~20-40KB base64
- 512x256 PNG (complex scene): ~50-80KB base64
- 1024x512 PNG: ~100-200KB base64
- **Recommendation:** Use 512x256 to balance quality vs storage

---

## 4. Current Preview Logic (What Exists Today)

### buildPreview() Implementation (Line 3911-3940)

**Location:** `index.html` → `PacksUI` module → `buildPreview(pack)` function

**Current behavior:**

1. **Empty state:** If `pack.cases.length === 0`, shows centered text "No items yet"
2. **Colored blocks:** Slices first 12 instances, renders colored divs in 6-column grid
3. **Color source:** Reads `CaseLibrary.getById(inst.caseId).color` for each instance
4. **Fallback:** Gray background if case not found or color missing

**Code snippet:**

```javascript
function buildPreview(pack) {
  // TODO: Replace with actual canvas snapshot rendering
  // Should use SceneManager to render pack contents off-screen
  // and capture via canvas.toDataURL() for realistic preview

  const preview = document.createElement('div');
  const items = (pack.cases || []).slice(0, 12);

  if (!items.length) {
    preview.className = 'pack-preview empty';
    preview.textContent = 'No items yet';
    return preview;
  }

  preview.className = 'pack-preview';
  items.forEach(inst => {
    const cell = document.createElement('div');
    cell.className = 'pack-preview-cell';
    const meta = CaseLibrary.getById(inst.caseId);
    if (meta && meta.color) cell.style.background = meta.color;
    cell.title = meta ? meta.name : 'Case';
    preview.appendChild(cell);
  });
  return preview;
}
```

### Preview Size/Aspect (CSS)

**Container:** `.pack-preview` (lines ~980-1015 in `<style>`)

```css
.pack-preview {
  position: relative;
  height: 120px; /* Fixed height */
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: linear-gradient(135deg, rgba(255, 159, 28, 0.06), rgba(59, 130, 246, 0.04));
  margin: 0 0 var(--space-3) 0;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr)); /* 6 columns */
  gap: 6px;
  padding: 10px;
  overflow: hidden;
}
```

**Aspect ratio:** ~2.5:1 (varies with pack card width)

- Pack cards are in 3-column grid (2-column on tablet, 1-column on mobile)
- Preview width adapts to container, height fixed at 120px

**Cells:** `.pack-preview-cell`

```css
.pack-preview-cell {
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
  background: var(--bg-hover);
  min-height: 30px;
  border: 1px solid rgba(0, 0, 0, 0.04);
}
```

### Existing TODO Comments

**Line 3912:**

```javascript
// TODO: Replace with actual canvas snapshot rendering
// Should use SceneManager to render pack contents off-screen
// and capture via canvas.toDataURL() for realistic preview
```

**Intent:**

- Use Three.js to render pack contents (truck + instances)
- Capture frame as data URL
- Store in pack model
- Render as `<img>` in pack card

---

## 5. Best Hook Point for "Auto Thumbnail"

### Ranking of Potential Save Flows

#### 1. **BEST: AutoPack Completion** (Line ~7522)

**Location:** `EditorUI` → AutoPack button click handler

**Why best:**

- User explicitly triggered layout operation (intent to finalize arrangement)
- Pack is likely in "final" state after AutoPack
- Single clear hook point
- Already calls `PackLibrary.update()` to save new instance positions

**Code context:**

```javascript
// Line 7515-7525
document.getElementById('btn-autopack').addEventListener('click', () => {
  const packId = StateStore.get('currentPackId');
  const pack = PackLibrary.getById(packId);
  if (!pack) return;

  const nextCases = autoPack(pack);
  PackLibrary.update(packId, { cases: nextCases }); // ← Hook here
  UIComponents.showToast('AutoPack complete', 'success');
});
```

**Implementation hook:**

```javascript
PackLibrary.update(packId, { cases: nextCases });

// Capture thumbnail after AutoPack
const thumbnail = SceneManager.captureThumbnail(pack);
if (thumbnail) {
  PackLibrary.update(packId, {
    thumbnail,
    thumbnailUpdatedAt: Date.now(),
    thumbnailSource: 'auto',
  });
}
```

#### 2. **Manual "Update Preview" Button** (New)

**Location:** Add to viewport toolbar (line ~1430)

**Why useful:**

- User control over when thumbnail is captured
- Avoids automatic captures on every edit
- Clear user intent

**Implementation:**

```html
<!-- Add button to viewport toolbar -->
<button class="toolbar-btn" id="btn-capture-thumbnail" type="button" title="Update preview">
  <i class="fa-solid fa-camera"></i>
  Update Preview
</button>
```

```javascript
// In EditorUI.init()
document.getElementById('btn-capture-thumbnail').addEventListener('click', () => {
  const packId = StateStore.get('currentPackId');
  const pack = PackLibrary.getById(packId);
  if (!pack) return;

  const thumbnail = SceneManager.captureThumbnail(pack);
  PackLibrary.update(packId, {
    thumbnail,
    thumbnailUpdatedAt: Date.now(),
    thumbnailSource: 'manual',
  });
  UIComponents.showToast('Preview updated', 'success');
});
```

#### 3. **Screenshot Button Repurpose** (Line ~7697)

**Location:** `EditorUI` → Screenshot PNG button handler

**Why viable:**

- Already captures canvas as data URL
- Natural user workflow (take screenshot → save as preview)
- Minimal code duplication

**Implementation:** Add checkbox or split button:

```javascript
// Line ~7697-7714
document.getElementById('btn-screenshot').addEventListener('click', () => {
  const renderer = SceneManager.getRenderer();
  if (!renderer) return;

  const dataUrl = renderer.domElement.toDataURL('image/png');

  // Option 1: Always save as thumbnail
  const packId = StateStore.get('currentPackId');
  if (packId) {
    PackLibrary.update(packId, {
      thumbnail: dataUrl,
      thumbnailUpdatedAt: Date.now(),
      thumbnailSource: 'manual',
    });
  }

  // Then download
  Utils.downloadText(filename, dataUrl, 'image/png');
});
```

#### 4. **NOT RECOMMENDED: On Every PackLibrary.update()**

**Why avoid:**

- Called on every drag, nudge, rotation, visibility toggle
- Would capture thumbnails dozens of times per editing session
- Performance impact (rendering off-screen + base64 encoding)
- localStorage churn (250ms debounced saves × many captures)

#### 5. **NOT RECOMMENDED: On Navigation Away from Editor**

**Why avoid:**

- No explicit "exit editor" handler exists
- `AppShell.navigate()` is generic; adding pack-specific logic breaks separation
- User may navigate accidentally (mis-click sidebar)
- Would need state tracking (was editor open? did pack change?)

### Recommended Primary Hook

**Use AutoPack completion (#1) as default auto-capture point**

- Captures final layout state
- User-triggered operation (explicit intent)
- Single, clear hook point
- Minimal performance impact (only once per AutoPack)

**Add manual "Update Preview" button (#2) for user control**

- Allows refinement after manual edits
- Gives users agency over thumbnail quality
- Complements auto-capture

---

## 6. Sorting + Filtering Plan (Date/Client)

### Current Search Implementation (Line 3790-3860)

**Location:** `PacksUI.render()` → search input listener

**Current behavior:**

```javascript
const q = String(searchEl.value || '')
  .trim()
  .toLowerCase();
const packs = allPacks.filter(
  p => !q || (p.title || '').toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q)
);
```

**Filtering:**

- Searches `title` and `client` fields
- Case-insensitive substring match
- Updates grid on input (debounced 200ms)

**Sorting:**

- **Currently sorts by `lastEdited` descending** (line 3792):
  ```javascript
  const allPacks = PackLibrary.getPacks()
    .slice()
    .sort((a, b) => (b.lastEdited || 0) - (a.lastEdited || 0));
  ```
- No UI controls for sort order; always "recently edited first"

### Proposed Sorting/Filtering UI

**Match existing patterns from CasesUI** (line 4205-4650):

- CasesUI uses filter chips for categories
- CasesUI uses table headers for column sorting
- Keep UI minimal; reuse chip/dropdown patterns

**Add to Packs screen (line 1260-1300):**

#### A) Sort Dropdown

**Location:** Next to search input (line ~1280)

**HTML:**

```html
<div class="row">
  <div style="flex: 1; min-width: 220px; position: relative">
    <!-- Existing search input -->
  </div>

  <!-- NEW: Sort dropdown -->
  <select class="select" id="packs-sort" style="width: 180px">
    <option value="lastEdited-desc">Recently Edited</option>
    <option value="lastEdited-asc">Oldest First</option>
    <option value="createdAt-desc">Recently Created</option>
    <option value="createdAt-asc">Oldest Created</option>
    <option value="title-asc">Title A-Z</option>
    <option value="title-desc">Title Z-A</option>
    <option value="client-asc">Client A-Z</option>
  </select>
</div>
```

**JavaScript (in `PacksUI.init()` and `render()`):**

```javascript
let sortBy = 'lastEdited';
let sortDir = 'desc';

function init() {
  // ... existing search listener

  document.getElementById('packs-sort').addEventListener('change', ev => {
    const [field, dir] = ev.target.value.split('-');
    sortBy = field;
    sortDir = dir;
    render();
  });
}

function render() {
  const q = String(searchEl.value || '')
    .trim()
    .toLowerCase();
  let packs = PackLibrary.getPacks().slice();

  // Filter by search
  packs = packs.filter(
    p =>
      !q ||
      (p.title || '').toLowerCase().includes(q) ||
      (p.client || '').toLowerCase().includes(q) ||
      (p.projectName || '').toLowerCase().includes(q)
  );

  // Sort
  packs.sort((a, b) => {
    let valA, valB;

    switch (sortBy) {
      case 'title':
        valA = (a.title || '').toLowerCase();
        valB = (b.title || '').toLowerCase();
        break;
      case 'client':
        valA = (a.client || '').toLowerCase();
        valB = (b.client || '').toLowerCase();
        break;
      case 'lastEdited':
        valA = a.lastEdited || 0;
        valB = b.lastEdited || 0;
        break;
      case 'createdAt':
        valA = a.createdAt || 0;
        valB = b.createdAt || 0;
        break;
      default:
        valA = a.lastEdited || 0;
        valB = b.lastEdited || 0;
    }

    if (typeof valA === 'number') {
      return sortDir === 'asc' ? valA - valB : valB - valA;
    }

    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Render grid...
}
```

#### B) Filter Chips (Optional)

**Location:** Below search/sort row (line ~1295)

**Purpose:** Filter by metadata attributes

**HTML:**

```html
<div class="row" id="packs-filters" style="gap: 8px; display: none">
  <!-- Dynamically generated chips -->
</div>
```

**Chips to add:**

- "Has Thumbnail" / "No Thumbnail"
- Client names (if multiple unique clients exist)
- Date ranges (This Week, This Month, This Year)

**Implementation (optional, low priority):**

```javascript
function renderFilters() {
  const filtersEl = document.getElementById('packs-filters');
  filtersEl.innerHTML = '';

  const packs = PackLibrary.getPacks();
  const hasThumbnails = packs.filter(p => p.thumbnail).length;
  const noThumbnails = packs.length - hasThumbnails;

  if (hasThumbnails > 0) {
    filtersEl.appendChild(
      chip(
        'Has Preview',
        'has-thumbnail',
        activeFilters.has('has-thumbnail'),
        toggleFilter,
        '#10b981',
        hasThumbnails
      )
    );
  }

  if (noThumbnails > 0) {
    filtersEl.appendChild(
      chip(
        'No Preview',
        'no-thumbnail',
        activeFilters.has('no-thumbnail'),
        toggleFilter,
        '#6b7280',
        noThumbnails
      )
    );
  }

  // Show/hide filters row
  filtersEl.style.display = filtersEl.children.length ? 'flex' : 'none';
}
```

**Keep UI minimal:** Only show filters if they add value (multiple clients, mix of
thumbnail/no-thumbnail)

---

## 7. Risks + Limits

### localStorage Size Risk with Data URLs

**Problem:**

- Base64-encoded PNG images are ~133% of binary size
- 512x256 PNG ≈ 30-80KB per thumbnail
- 100 packs × 60KB avg = 6MB
- localStorage quota: 5-10MB (varies by browser)
- Other data (cases, preferences) also stored in same quota

**Mitigation strategies:**

1. **Compress thumbnails:**
   - Use smaller resolution: 400×200 or 320×160
   - Use JPEG instead of PNG (lossy but smaller):
     ```javascript
     renderer.domElement.toDataURL('image/jpeg', 0.7); // 70% quality
     ```
   - Trade-off: JPEG at 70% quality ≈ 50% size of PNG, minimal visual loss

2. **Lazy thumbnail generation:**
   - Don't auto-capture on every AutoPack
   - Only generate on explicit user action ("Update Preview" button)
   - Show colored blocks fallback if thumbnail missing

3. **Quota monitoring:**

   ```javascript
   function checkStorageQuota() {
     try {
       const test = 'x'.repeat(1024 * 1024); // 1MB test
       localStorage.setItem('__quota_test', test);
       localStorage.removeItem('__quota_test');
       return true;
     } catch (e) {
       if (e.name === 'QuotaExceededError') {
         UIComponents.showToast(
           'Storage quota exceeded. Consider removing old pack thumbnails.',
           'warning'
         );
         return false;
       }
     }
   }
   ```

4. **Thumbnail deletion:**
   - Add "Clear Preview" option in pack kebab menu
   - Bulk "Clear All Previews" action in Packs screen
   - Auto-delete thumbnails for packs not edited in >6 months

### Cross-Browser Canvas Capture Pitfalls

**Issue 1: WebGL context loss**

- Problem: Rendering off-screen while main scene is animating
- Solution: Capture during idle frame (after `requestAnimationFrame` cycle)

**Issue 2: `preserveDrawingBuffer`**

- Problem: Three.js default renderer has `preserveDrawingBuffer: false`
- Effect: `toDataURL()` may return blank/black image after render cycle completes
- Solution: **Do NOT modify global renderer settings**; instead:
  1. Render frame synchronously
  2. Call `toDataURL()` immediately after `renderer.render()`
  3. Restore viewport/camera before next frame

**Issue 3: Tainted canvas (CORS)**

- Problem: External textures (images from other domains) taint canvas
- Effect: `toDataURL()` throws SecurityError
- Current codebase: No external textures used; all geometries are programmatic (BoxGeometry,
  LineSegments)
- Risk: **Low** (no image textures currently)

**Issue 4: Browser inconsistencies**

- Safari: May require explicit `canvas.width` × `canvas.height` set before capture
- Firefox: Sometimes needs `canvas.getContext('2d')` before WebGL `toDataURL()`
- Chrome: Most reliable
- Solution: Test across browsers; add fallback error handling

**Implementation safeguards:**

```javascript
function captureThumbnail(pack, options = {}) {
  const renderer = SceneManager.getRenderer();
  if (!renderer) return null;

  try {
    // Render frame
    CaseScene.sync(pack);
    renderer.render(SceneManager.getScene(), SceneManager.getCamera());

    // Capture immediately
    const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.75);

    // Validate result
    if (!dataUrl || dataUrl === 'data:,') {
      console.error('Thumbnail capture failed: blank data URL');
      return null;
    }

    return dataUrl;
  } catch (err) {
    console.error('Thumbnail capture error:', err);
    UIComponents.showToast('Preview capture failed', 'error');
    return null;
  }
}
```

### Performance Risk (Capturing Too Often)

**Problem:**

- Off-screen rendering + base64 encoding is CPU-intensive
- Capturing on every edit (drag, rotate, visibility toggle) causes lag
- StateStore triggers debounced saves; thumbnail capture would add overhead

**Impact analysis:**

- Single capture: ~20-50ms (depends on scene complexity)
- 10 captures/second (rapid editing): ~200-500ms overhead = noticeable lag
- AutoPack captures once: negligible impact

**Mitigation:**

1. **Only capture on explicit triggers** (AutoPack, manual button)
2. **Debounce captures** if adding auto-capture on editor changes:
   ```javascript
   const captureDebounced = Utils.debounce(() => {
     const thumbnail = SceneManager.captureThumbnail(pack);
     PackLibrary.update(packId, { thumbnail });
   }, 2000); // Wait 2s after last edit
   ```
3. **Show loading indicator** during capture (optional):
   ```javascript
   UIComponents.showToast('Generating preview...', 'info', { duration: 500 });
   ```

**Recommended approach:**

- **Default:** Only capture on AutoPack (minimal performance impact)
- **User control:** Add manual "Update Preview" button
- **Avoid:** Auto-capture on every edit (too expensive)

---

## 8. Implementation Checklist

### Phase 1: Data Model + Migration (No UI Changes)

**Step 1: Add thumbnail fields to Pack model**

- File: `index.html` → `PackLibrary` module (line ~3474)
- What: Extend `PackLibrary.create()` to initialize:
  ```javascript
  thumbnail: null,
  thumbnailUpdatedAt: null,
  thumbnailSource: null
  ```

**Step 2: Add thumbnail normalization**

- File: `index.html` → `Normalizer.normalizePack()` (line ~2660)
- What: Validate thumbnail fields on load/import:
  ```javascript
  thumbnail: typeof p.thumbnail === 'string' ? p.thumbnail : null,
  thumbnailUpdatedAt: finiteNumber(p && p.thumbnailUpdatedAt, null),
  thumbnailSource: ['auto', 'manual', 'upload'].includes(p.thumbnailSource) ? p.thumbnailSource : null
  ```

**Step 3: Test data persistence**

- Action: Create pack, manually add thumbnail field via console
- Verify: Reload page, check thumbnail field survives
- Verify: Export/import JSON preserves thumbnail

---

### Phase 2: Thumbnail Capture Function

**Step 4: Add `SceneManager.captureThumbnail(pack, options)`**

- File: `index.html` → `SceneManager` module (line ~6395, add before return statement)
- What: Render pack off-screen, capture as data URL, restore viewport
- Reference: Use existing screenshot code (line ~7697-7714) as template
- Options: `{ width: 512, height: 256, format: 'jpeg', quality: 0.75 }`

**Code skeleton:**

```javascript
function captureThumbnail(pack, options = {}) {
  if (!renderer || !scene || !camera) return null;

  const width = options.width || 512;
  const height = options.height || 256;
  const format = options.format || 'image/jpeg';
  const quality = options.quality || 0.75;

  // Save current state
  const prevWidth = viewSize.width;
  const prevHeight = viewSize.height;
  const prevAspect = camera.aspect;
  const prevPos = camera.position.clone();
  const prevTarget = controls.target.clone();

  try {
    // Set up off-screen render
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Position camera for optimal pack view
    const truckCenter = new THREE.Vector3(
      toWorld(pack.truck.length / 2),
      toWorld(pack.truck.height / 2),
      0
    );
    const distance = Math.max(toWorld(pack.truck.length), toWorld(pack.truck.width)) * 1.4;

    camera.position.set(
      truckCenter.x + distance * 0.6,
      truckCenter.y + distance * 0.5,
      distance * 0.6
    );
    camera.lookAt(truckCenter);

    // Sync scene
    CaseScene.sync(pack);

    // Render + capture
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL(format, quality);

    // Validate
    if (!dataUrl || dataUrl === 'data:,') {
      throw new Error('Blank data URL');
    }

    return dataUrl;
  } catch (err) {
    console.error('Thumbnail capture failed:', err);
    return null;
  } finally {
    // Restore viewport
    renderer.setSize(prevWidth, prevHeight);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    camera.position.copy(prevPos);
    controls.target.copy(prevTarget);
  }
}
```

**Step 5: Test thumbnail capture**

- Action: Call `SceneManager.captureThumbnail(pack)` from console
- Verify: Returns valid data URL string
- Verify: Pasting data URL in browser shows correct image
- Verify: Main viewport unaffected after capture

---

### Phase 3: Auto-Capture Hook

**Step 6: Hook thumbnail capture to AutoPack**

- File: `index.html` → `EditorUI` → AutoPack button handler (line ~7522)
- What: After `PackLibrary.update()`, capture + save thumbnail
- Code:

  ```javascript
  PackLibrary.update(packId, { cases: nextCases });

  // Auto-capture thumbnail
  const pack = PackLibrary.getById(packId);
  const thumbnail = SceneManager.captureThumbnail(pack);
  if (thumbnail) {
    PackLibrary.update(packId, {
      thumbnail,
      thumbnailUpdatedAt: Date.now(),
      thumbnailSource: 'auto',
    });
  }

  UIComponents.showToast('AutoPack complete', 'success');
  ```

**Step 7: Add manual "Update Preview" button**

- File: `index.html` → viewport toolbar HTML (line ~1430)
- HTML: Add button before screenshot button
- File: `index.html` → `EditorUI.init()` (line ~6820)
- JavaScript: Bind click handler
- Code:
  ```javascript
  document.getElementById('btn-capture-thumbnail').addEventListener('click', () => {
    const packId = StateStore.get('currentPackId');
    const pack = PackLibrary.getById(packId);
    if (!pack) return;

    const thumbnail = SceneManager.captureThumbnail(pack);
    if (thumbnail) {
      PackLibrary.update(packId, {
        thumbnail,
        thumbnailUpdatedAt: Date.now(),
        thumbnailSource: 'manual',
      });
      UIComponents.showToast('Preview updated', 'success');
    }
  });
  ```

---

### Phase 4: Pack Card Preview Rendering

**Step 8: Update `PacksUI.buildPreview()` to render thumbnails**

- File: `index.html` → `PacksUI.buildPreview()` (line ~3911)
- What: Check if `pack.thumbnail` exists; render `<img>` instead of colored blocks
- Code:
  ```javascript
  function buildPreview(pack) {
    const preview = document.createElement('div');

    // Use thumbnail if available
    if (pack.thumbnail) {
      preview.className = 'pack-preview pack-preview-image';
      preview.style.padding = '0';

      const img = document.createElement('img');
      img.src = pack.thumbnail;
      img.alt = `Preview of ${pack.title}`;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = 'var(--radius-md)';
      preview.appendChild(img);

      return preview;
    }

    // Fallback to colored blocks
    const items = (pack.cases || []).slice(0, 12);

    if (!items.length) {
      preview.className = 'pack-preview empty';
      preview.textContent = 'No items yet';
      return preview;
    }

    preview.className = 'pack-preview';
    items.forEach(inst => {
      const cell = document.createElement('div');
      cell.className = 'pack-preview-cell';
      const meta = CaseLibrary.getById(inst.caseId);
      if (meta && meta.color) cell.style.background = meta.color;
      cell.title = meta ? meta.name : 'Case';
      preview.appendChild(cell);
    });

    return preview;
  }
  ```

**Step 9: Test preview rendering**

- Action: Create pack, run AutoPack, navigate to Packs screen
- Verify: Pack card shows canvas thumbnail image
- Verify: Packs without thumbnails still show colored blocks
- Verify: Empty packs show "No items yet" text

---

### Phase 5: Sorting + Filtering UI

**Step 10: Add sort dropdown to Packs screen**

- File: `index.html` → Packs screen HTML (line ~1280)
- HTML: Add `<select id="packs-sort">` with options
- File: `index.html` → `PacksUI.init()` (line ~3775)
- JavaScript: Add change listener, store `sortBy` and `sortDir` variables
- File: `index.html` → `PacksUI.render()` (line ~3790)
- JavaScript: Replace hardcoded sort with dynamic sort logic

**Step 11: (Optional) Add filter chips for thumbnail status**

- File: `index.html` → Packs screen HTML (line ~1295)
- HTML: Add `<div id="packs-filters">` below search row
- File: `index.html` → `PacksUI.render()`
- JavaScript: Add `renderFilters()` helper, generate chips for:
  - "Has Preview" (count)
  - "No Preview" (count)
- JavaScript: Filter packs based on active chips

---

### Phase 6: Polish + Extras

**Step 12: Add "Clear Preview" option to pack kebab menu**

- File: `index.html` → `PacksUI.render()` pack card dropdown (line ~3900)
- What: Add menu item after "Duplicate":
  ```javascript
  {
    label: 'Clear Preview',
    icon: 'fa-solid fa-trash',
    disabled: !pack.thumbnail,
    onClick: () => {
      PackLibrary.update(pack.id, {
        thumbnail: null,
        thumbnailUpdatedAt: null,
        thumbnailSource: null
      });
      UIComponents.showToast('Preview cleared', 'info');
    }
  }
  ```

---

**Total Steps:** 12 **Estimated Effort:** 4-6 hours (experienced developer) **Critical Path:** Steps
1-9 (data model → capture → rendering) **Optional Enhancements:** Steps 11-12 (filters, clear
preview)

---

**End of Audit**
