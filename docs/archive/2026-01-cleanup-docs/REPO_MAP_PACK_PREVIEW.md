# Truck Packer 3D: Repo Map for Pack Preview Thumbnails + Sorting/Filtering

**Created:** January 15, 2026  
**Purpose:** Quick reference map to add Pack Preview thumbnails and Packs sorting/filtering without
guessing where things live.

---

## A) Repo Map (File Tree)

```
Truck Packer 3D/
├── index.html ⚡ ACTIVE - Entire app (7925 lines, all runtime logic)
├── styles/
│   ├── main.css ⚡ ACTIVE - CSS imports
│   ├── base/ ⚡ ACTIVE - Typography, colors, variables
│   ├── components/ ⚡ ACTIVE - Cards, buttons, toasts, modals
│   ├── layouts/ ⚡ ACTIVE - App shell, navbar, screens
│   ├── screens/ ⚡ ACTIVE - Packs, editor, settings screen styles
│   └── responsive/ ⚡ ACTIVE - Media queries
├── src/
│   ├── app.js 📦 PLANNED - Modular entry point (not used yet)
│   ├── router.js 📦 PLANNED - Screen routing (not used yet)
│   ├── core/
│   │   ├── state.js 📦 PLANNED - State management
│   │   ├── storage.js 📦 PLANNED - localStorage layer
│   │   └── utils.js 📦 PLANNED - Utilities
│   ├── features/
│   │   ├── packs/ 📦 PLANNED - Pack CRUD (empty)
│   │   ├── cases/ 📦 PLANNED - Case CRUD (empty)
│   │   ├── editor/ 📦 PLANNED - Editor screen (empty)
│   │   └── settings/ 📦 PLANNED - Settings screen (empty)
│   └── ui/ 📦 PLANNED - UI components (empty)
├── cleanup/
│   ├── AUDIT_APP_STRUCTURE.md ✅ ACTIVE - Comprehensive architecture audit
│   ├── AUDIT_PACK_PREVIEW_AND_FILTERS.md ✅ ACTIVE - Feature-focused audit
│   └── REPO_MAP_PACK_PREVIEW.md ✅ ACTIVE - This file
├── package.json ⚡ ACTIVE - Dependencies (Prettier, ESLint, etc.)
├── eslint.config.js ⚡ ACTIVE - Linting config
└── .prettierrc ⚡ ACTIVE - Code formatting config

Legend:
⚡ ACTIVE = Currently used in runtime
📦 PLANNED = Folder structure exists but empty/unused
✅ ACTIVE = Documentation
```

**Critical finding:** All app logic lives in `index.html` as IIFE closures inside
`window.TruckPackerApp`. The `/src` folder is a **planned** modular structure but is NOT currently
imported or executed.

---

## B) Where Things Are (Exact Paths + Symbols)

### 1. Packs List Screen UI

**File:** [index.html](../index.html)  
**Module:** `PacksUI` (IIFE closure)  
**Lines:** 3795–3958

| Component           | Symbol/Element                  | Line | Purpose                                                |
| ------------------- | ------------------------------- | ---- | ------------------------------------------------------ |
| Search input        | `#packs-search`                 | 3796 | Filter packs by title/client                           |
| Grid container      | `#packs-grid`                   | 3797 | Holds pack cards                                       |
| Empty state         | `#packs-empty`                  | 3798 | "No packs yet" message                                 |
| Filter empty        | `#packs-filter-empty`           | 3799 | "No matching packs" message                            |
| New pack button     | `#btn-new-pack`                 | 3802 | Opens new pack modal                                   |
| Import button       | `#btn-import-pack`              | 3803 | Opens file picker for JSON/Excel                       |
| **Render function** | `PacksUI.render()`              | 3807 | Main grid render loop                                  |
| **Current sort**    | Sort by `lastEdited` descending | 3825 | `(b.lastEdited \|\| 0) - (a.lastEdited \|\| 0)`        |
| **Card builder**    | Loop starts                     | 3853 | Builds `.pack-card` DOM                                |
| **Preview builder** | `buildPreview(pack)`            | 3925 | **🎯 KEY FUNCTION** - Generates colored blocks preview |
| **TODO comment**    | Line 3926                       | 3926 | "Replace with actual canvas snapshot rendering"        |
| Kebab menu          | `UIComponents.openDropdown()`   | 3897 | Open/duplicate/export/delete actions                   |

**CSS Classes:**

- `.pack-card` - Card wrapper
- `.pack-preview` - Preview container (contains colored blocks)
- `.pack-preview-cell` - Individual colored block
- `.pack-preview.empty` - Empty state ("No items yet")

---

### 2. Pack Data Model

**File:** [index.html](../index.html)  
**Module:** `PackLibrary` (IIFE closure)  
**Lines:** 3690–3690 (module start), 3486–3520 (create/update)

**Pack Shape** (confirmed from code):

```javascript
{
  id: string,              // UUID
  title: string,
  client: string,
  projectName: string,
  drawnBy: string,
  notes: string,
  truck: { length, width, height },
  cases: CaseInstance[],
  groups: [],
  stats: { totalCases, packedCases, volumeUsed, volumePercent, totalWeight },
  createdAt: number,       // Timestamp, set ONCE on creation (line 2539, 3497)
  lastEdited: number       // Timestamp, updated EVERY PackLibrary.update() (line 3508)
  // ❌ NO "updatedAt" field (use lastEdited instead)
  // ❌ NO "thumbnail" field YET (need to add)
}
```

**Key Functions:**

| Function                         | Line | Purpose                                             |
| -------------------------------- | ---- | --------------------------------------------------- |
| `PackLibrary.create(data)`       | 3485 | Creates new pack with timestamps                    |
| `PackLibrary.update(id, patch)`  | 3504 | **🎯 Updates pack, sets `lastEdited = Date.now()`** |
| `PackLibrary.computeStats(pack)` | 3662 | Computes stats from cases                           |
| `PackLibrary.getPacks()`         | 3692 | Returns `state.packLibrary` array                   |

**Important:** `PackLibrary.update()` is the ONLY place where `lastEdited` gets updated. This is the
hook point for auto-thumbnail capture.

---

### 3. Storage/Persistence Layer

**File:** [index.html](../index.html)  
**Module:** `Storage` (IIFE closure)  
**Lines:** 2255–2297

| Symbol               | Line      | Purpose                                                                      |
| -------------------- | --------- | ---------------------------------------------------------------------------- |
| `Storage.KEY`        | 2256      | `'truckPacker3d:v1'` - localStorage key                                      |
| `Storage.load()`     | 2259      | Reads from localStorage, returns parsed object                               |
| `Storage.saveSoon()` | 2270      | Debounced save (250ms)                                                       |
| `Storage.saveNow()`  | 2274      | **🎯 Immediate save to localStorage**                                        |
| **Saved payload**    | 2277–2284 | `{ version, savedAt, caseLibrary, packLibrary, preferences, currentPackId }` |

**Schema Version:** `APP_VERSION` constant (line 2149) - currently `'1.0.0'`

**Flow:**

1. User action → `StateStore.set()` → triggers subscribers
2. Subscriber calls `Storage.saveSoon()` (debounced 250ms)
3. Eventually `Storage.saveNow()` writes to localStorage

**localStorage Key Structure:**

```javascript
{
  version: "1.0.0",
  savedAt: 1737000000000,
  caseLibrary: Case[],
  packLibrary: Pack[],  // ← This is where pack.thumbnail will be stored
  preferences: {...},
  currentPackId: "uuid"
}
```

---

### 4. Pack Create/Update APIs

**File:** [index.html](../index.html)

| API Call                        | Line    | When Called                                        | Sets `lastEdited`?     |
| ------------------------------- | ------- | -------------------------------------------------- | ---------------------- |
| `PackLibrary.create(data)`      | 3485    | New pack created                                   | ✅ Yes (line 3498)     |
| `PackLibrary.update(id, patch)` | 3504    | **Any pack edit**                                  | ✅ **Yes (line 3508)** |
| Specific triggers:              |         |                                                    |                        |
| - AutoPack completion           | 6239    | `PackLibrary.update(packId, { cases: nextCases })` | ✅ Yes                 |
| - Case dragged/moved            | 4820    | Editor case position change                        | ✅ Yes                 |
| - Pack details edited           | Various | Title, client, notes, truck size changes           | ✅ Yes                 |

**🎯 Best Hook Point for Auto-Thumbnail Capture:**  
**Line 6239** - Inside `AutoPackEngine.pack()` after `PackLibrary.update()` is called with new case
positions. This is the ideal moment to capture the 3D scene because:

- All cases are positioned
- Scene is rendered
- User expects a brief delay (AutoPack is already async)

---

### 5. Editor Canvas / Renderer & Screenshot Code

**File:** [index.html](../index.html)

#### SceneManager (Three.js)

| Symbol                       | Line  | Purpose                              |
| ---------------------------- | ----- | ------------------------------------ |
| `SceneManager` module        | 5800  | Three.js scene/renderer wrapper      |
| `SceneManager.init(el)`      | ~5820 | Creates WebGLRenderer, scene, camera |
| `SceneManager.getRenderer()` | ~6395 | **🎯 Returns THREE.WebGLRenderer**   |
| `SceneManager.getCamera()`   | ~6400 | Returns active camera                |
| `SceneManager.getScene()`    | ~6405 | Returns THREE.Scene                  |

#### Existing Screenshot Code (Template for Thumbnails)

| Function                            | Line | Purpose                                         |
| ----------------------------------- | ---- | ----------------------------------------------- |
| `ExportService.captureScreenshot()` | 6391 | Full PNG export (current viewport)              |
| `ExportService.generatePDF()`       | 6410 | PDF with 3 views (perspective + top + side)     |
| **`renderCameraToDataUrl()`**       | 6703 | **🎯 KEY HELPER** - Off-screen render to base64 |

**How `renderCameraToDataUrl()` works (line 6703–6768):**

1. Gets renderer, scene, camera from SceneManager
2. Creates off-screen `WebGLRenderTarget` at specified width/height
3. Saves current renderer state (viewport, scissor, pixel ratio, background)
4. Renders scene to off-screen buffer
5. Reads pixels via `readRenderTargetPixels()`
6. Flips Y-axis, encodes to canvas
7. Returns `canvas.toDataURL(mimeType, quality)` (base64 string)
8. Restores renderer state

**Parameters:**

- `camera` - THREE.Camera to render from
- `width, height` - Output resolution (e.g., 512, 256)
- `options.mimeType` - `'image/png'` or `'image/jpeg'` (default PNG)
- `options.quality` - 0–1 for JPEG quality (default 0.92)
- `options.hideGrid` - Boolean to hide grid in render

**Example usage (from PDF export, line 6474):**

```javascript
const topView = renderCameraToDataUrl(topCam, 960, 520, {
  mimeType: 'image/jpeg',
  quality: 0.85,
  hideGrid: true,
});
```

**🎯 To capture pack thumbnail:**

```javascript
const thumbnailDataUrl = renderCameraToDataUrl(
  SceneManager.getCamera(),
  512, // width
  256, // height
  {
    mimeType: 'image/jpeg',
    quality: 0.7,
    hideGrid: false,
  }
);
```

**Button wiring (line 6805–6806):**

```javascript
btnPng.addEventListener('click', () => ExportService.captureScreenshot());
btnPdf.addEventListener('click', () => ExportService.generatePDF());
```

---

### 6. Toast/Modal Utilities

**File:** [index.html](../index.html)  
**Module:** `UIComponents` (IIFE closure)  
**Lines:** 1867–2131

| Function                      | Line | Signature                  | Purpose                     |
| ----------------------------- | ---- | -------------------------- | --------------------------- |
| `UIComponents.showToast()`    | 1879 | `(message, type, options)` | Shows toast notification    |
| `UIComponents.showModal()`    | 1949 | `(config)`                 | Shows modal dialog          |
| `UIComponents.confirm()`      | 2025 | `(message, onYes)`         | Confirmation dialog         |
| `UIComponents.openDropdown()` | 3246 | `(anchor, items, options)` | Opens dropdown menu (kebab) |

**Toast types:** `'info'`, `'success'`, `'warning'`, `'error'`  
**Toast options:** `{ title, duration }` (default 3500ms)

**Example usage (line 6246):**

```javascript
UIComponents.showToast(
  `Packed ${stats.packedCases} of ${totalPackable} (${stats.volumePercent.toFixed(1)}%)`,
  stats.packedCases === totalPackable ? 'success' : 'warning',
  { title: 'AutoPack' }
);
```

---

### 7. Migration/Normalizer

**File:** [index.html](../index.html)  
**Module:** `Normalizer` (IIFE closure)  
**Lines:** 2547–2800

| Function                     | Line | Purpose                                              |
| ---------------------------- | ---- | ---------------------------------------------------- |
| `Normalizer.normalizePack()` | 2678 | **🎯 Validates/migrates pack fields on load/import** |
| `Normalizer.normalizeCase()` | 2598 | Validates case fields                                |

**When called:**

- `Storage.load()` → normalizes all packs on app boot
- `PackLibrary.importFromFile()` → normalizes imported packs

**What to add in `normalizePack()` (line 2678):**

```javascript
function normalizePack(p, caseMap, now) {
  const pack = {
    id: validString(p && p.id, () => Utils.uuid()),
    title: validString(p && p.title, 'Untitled Pack'),
    // ... existing fields ...
    createdAt: finiteNumber(p && p.createdAt, now),
    lastEdited: finiteNumber(p && p.lastEdited, now),

    // 🎯 ADD THESE 3 NEW FIELDS:
    thumbnail: typeof p?.thumbnail === 'string' ? p.thumbnail : null,
    thumbnailUpdatedAt: finiteNumber(p && p.thumbnailUpdatedAt, null),
    thumbnailSource: ['auto', 'manual'].includes(p?.thumbnailSource) ? p.thumbnailSource : null,
  };
  // ... rest of normalization ...
}
```

---

## C) Current Behavior Summary

### Pack Thumbnail Today

**Status:** ❌ Does NOT exist in data model  
**Preview rendering:** Colored blocks fallback (line 3925–3945)

**How it works now:**

1. `PacksUI.render()` loops over packs (line 3853)
2. For each pack, calls `buildPreview(pack)` (line 3925)
3. `buildPreview()` creates colored blocks based on first 12 cases
4. Uses case metadata `color` property to style each block
5. If pack has no cases, shows "No items yet" text

**Code snippet (line 3925–3945):**

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

**CSS (from inspection - likely in styles/components/):**

- `.pack-preview` - Grid/flex container (12-cell max)
- `.pack-preview-cell` - Colored block with inline `background` style
- `.pack-preview.empty` - Empty state styling

**Future behavior:**

1. Check if `pack.thumbnail` exists (base64 data URL)
2. If yes, render `<img src="${pack.thumbnail}" />` instead of colored blocks
3. If no, fall back to current colored blocks (backwards compatible)

---

### Packs Sorting/Filtering Today

**Current Sort:** `lastEdited` descending (newest first) - **line 3825**

```javascript
const allPacks = PackLibrary.getPacks()
  .slice()
  .sort((a, b) => (b.lastEdited || 0) - (a.lastEdited || 0));
```

**Current Filter:** Text search only (title + client) - **line 3831–3833**

```javascript
const packs = allPacks.filter(
  p => !q || (p.title || '').toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q)
);
```

**No UI controls for:**

- ❌ Sort direction toggle
- ❌ Sort by different fields (createdAt, title, client, volumePercent)
- ❌ Filter by volume range, packed status, etc.

---

## D) Risks / Constraints

### 1. localStorage Size Limits

**Hard limit:** 5–10MB per origin (browser-dependent)

**Thumbnail size estimation:**

- 512×256 JPEG @ 70% quality ≈ 30–60KB per pack
- 100 packs × 50KB ≈ 5MB (near limit)
- PNG would be 3–5× larger (150–300KB each) ❌ NOT RECOMMENDED

**Mitigation:**

- Use JPEG (not PNG) for thumbnails
- Set quality to 0.7 (70%)
- Max resolution: 512×256 (or 400×200 for smaller files)
- Warn user if approaching quota (detect `QuotaExceededError`)

**Current storage size check:**

```javascript
// Measure current localStorage usage
const currentSize = JSON.stringify(localStorage).length;
console.log(`localStorage size: ${(currentSize / 1024 / 1024).toFixed(2)} MB`);
```

---

### 2. Performance Risks

#### Thumbnail Capture Timing

**Risk:** Capturing thumbnails too frequently slows down the app

**Safe capture points:**

1. ✅ **After AutoPack completion** (line 6239) - user expects delay
2. ✅ **Manual "Capture Thumbnail" button** - user-initiated
3. ❌ **NOT after every case drag** - would freeze editor
4. ❌ **NOT on pack create** - no cases yet, no meaningful preview

**Capture performance:**

- Single 512×256 render ≈ 20–50ms (acceptable during AutoPack)
- JPEG encoding ≈ 10–20ms
- Total: ~30–70ms per thumbnail

#### Re-render Performance

**Current grid render:** Loops all visible packs, creates DOM nodes (line 3853)

**Risk:** If 100+ packs, rendering 100 `<img>` tags with base64 sources could be slow

**Mitigation:**

- Use CSS `loading="lazy"` attribute on `<img>` tags
- Or: Decode base64 to Blob URL and use object URLs (prevents base64 parsing lag)

```javascript
// Option A: Lazy loading (simple)
img.loading = 'lazy';
img.src = pack.thumbnail;

// Option B: Blob URL (more performant for large grids)
const blob = await fetch(pack.thumbnail).then(r => r.blob());
const blobUrl = URL.createObjectURL(blob);
img.src = blobUrl;
// Remember to call URL.revokeObjectURL(blobUrl) when card is removed
```

---

### 3. Existing Lint/Validate Rules

**ESLint issues (464 errors reported):**

- Most errors: `Undefined variable 'document'` and `Undefined variable 'window'`
- Root cause: Missing `env: { browser: true }` in `eslint.config.js`
- Fix: Already documented in `AUDIT_APP_STRUCTURE.md` (section 4.2)

**Impact on this feature:**

- No blocking issues for Pack Preview feature
- ESLint won't complain about new code if browser globals are still undefined
- Can ignore or fix browser env before implementing

**html-validate issues:**

- 1 error: `DOCTYPE` should be uppercase (cosmetic)
- 14 warnings: Void element syntax
- No impact on feature implementation

**Prettier:**

- Ran successfully, 19 files formatted
- New code will be auto-formatted on save
- No conflicts with Pack Preview feature

---

### 4. Data Migration Edge Cases

**Risk:** Existing packs in localStorage don't have `thumbnail` field

**Solution:** Normalizer already handles missing fields gracefully

**Test cases:**

1. User with 50 existing packs loads app → all packs get `thumbnail: null`
2. User manually captures thumbnail for 1 pack → only that pack gets base64 string
3. User exports pack to JSON → thumbnail field included (or stripped if null)
4. User imports pack from JSON without thumbnail → normalizer sets `thumbnail: null`

**Backward compatibility:** ✅ 100% safe - new fields are optional, have null fallbacks

---

## E) Change Plan (File-by-File)

### File 1: [index.html](../index.html) - Data Model + Migration

**Location:** `Normalizer.normalizePack()` function (line 2678)

**Changes:**

- Add 3 new optional fields to Pack shape:
  - `thumbnail: string | null` - Base64 data URL (JPEG)
  - `thumbnailUpdatedAt: number | null` - Timestamp of last thumbnail capture
  - `thumbnailSource: 'auto' | 'manual' | null` - How thumbnail was created
- Validate each field in normalizer (use existing helpers `validString()`, `finiteNumber()`)
- Set defaults: `null` for all 3 fields if missing

**Code to add (after line 2694):**

```javascript
thumbnail: typeof p?.thumbnail === 'string' ? p.thumbnail : null,
thumbnailUpdatedAt: finiteNumber(p && p.thumbnailUpdatedAt, null),
thumbnailSource: ['auto', 'manual'].includes(p?.thumbnailSource) ? p.thumbnailSource : null,
```

**Impact:** All packs loaded from storage or imported from files will have these 3 fields.

---

### File 2: [index.html](../index.html) - Thumbnail Capture Function

**Location:** Create new helper function inside `ExportService` module (after line 6770)

**Changes:**

- Add `captureThumbnail()` function that:
  - Calls `renderCameraToDataUrl()` with 512×256 resolution, JPEG @ 70% quality
  - Returns base64 data URL string
  - Handles errors (3D scene not ready, renderer missing, etc.)
- Export function from `ExportService` module

**Code to add (after line 6770):**

```javascript
function captureThumbnail(options = {}) {
  try {
    const width = options.width || 512;
    const height = options.height || 256;
    const quality = options.quality || 0.7;

    const dataUrl = renderCameraToDataUrl(SceneManager.getCamera(), width, height, {
      mimeType: 'image/jpeg',
      quality: quality,
      hideGrid: options.hideGrid !== false,
    });

    return dataUrl;
  } catch (err) {
    console.error('Thumbnail capture failed', err);
    UIComponents.showToast('Thumbnail capture failed', 'error');
    return null;
  }
}

return { captureScreenshot, generatePDF, captureThumbnail };
```

**Impact:** New reusable function for both auto and manual thumbnail capture.

---

### File 3: [index.html](../index.html) - Auto-Capture Hook (AutoPack)

**Location:** Inside `AutoPackEngine.pack()` function (after line 6239)

**Changes:**

- After `PackLibrary.update(packId, { cases: nextCases })` completes
- Call `ExportService.captureThumbnail()`
- If successful, call `PackLibrary.update()` AGAIN to save thumbnail fields
- Use `thumbnailSource: 'auto'` to indicate auto-captured

**Code to add (after line 6239, before line 6241):**

```javascript
// Auto-capture thumbnail after AutoPack completes
try {
  const thumbnail = ExportService.captureThumbnail();
  if (thumbnail) {
    PackLibrary.update(packId, {
      thumbnail: thumbnail,
      thumbnailUpdatedAt: Date.now(),
      thumbnailSource: 'auto',
    });
  }
} catch (err) {
  console.error('AutoPack thumbnail capture failed', err);
}
```

**Impact:** Every AutoPack run automatically updates pack thumbnail.

---

### File 4: [index.html](../index.html) - Manual Capture Button (Viewport Toolbar)

**Location A (HTML):** Add new button in viewport toolbar (after line 1438)

**Changes:**

- Add new button with icon (camera or snapshot icon)
- Label: "Capture Thumbnail"
- ID: `#btn-capture-thumbnail`

**Code to add (after line 1438):**

```html
<button class="toolbar-btn" id="btn-capture-thumbnail" type="button" title="Capture Thumbnail">
  <i class="fa fa-camera"></i>
  Thumbnail
</button>
```

**Location B (JavaScript):** Wire button handler in `EditorUI.init()` (after line 6806)

**Code to add (after line 6806):**

```javascript
const btnCaptureThumbnail = document.getElementById('btn-capture-thumbnail');
btnCaptureThumbnail.addEventListener('click', () => {
  const packId = StateStore.get('currentPackId');
  if (!packId) return;

  const thumbnail = ExportService.captureThumbnail();
  if (thumbnail) {
    PackLibrary.update(packId, {
      thumbnail: thumbnail,
      thumbnailUpdatedAt: Date.now(),
      thumbnailSource: 'manual',
    });
    UIComponents.showToast('Thumbnail captured', 'success');
    PacksUI.render(); // Refresh grid if navigating back
  }
});
```

**Impact:** Users can manually trigger thumbnail capture while in editor.

---

### File 5: [index.html](../index.html) - Update Preview Rendering

**Location:** `PacksUI.buildPreview()` function (line 3925)

**Changes:**

- Check if `pack.thumbnail` exists
- If yes, create `<img>` element with `src = pack.thumbnail`
- If no, fall back to current colored blocks logic (backward compatible)
- Add hover/click to trigger re-capture (optional enhancement)

**Code to replace (line 3925–3945):**

```javascript
function buildPreview(pack) {
  const preview = document.createElement('div');
  preview.className = 'pack-preview';

  // If thumbnail exists, use it
  if (pack.thumbnail) {
    const img = document.createElement('img');
    img.src = pack.thumbnail;
    img.alt = `${pack.title} preview`;
    img.className = 'pack-preview-img';
    img.loading = 'lazy'; // Performance optimization
    preview.appendChild(img);
    return preview;
  }

  // Fallback: colored blocks (existing logic)
  const items = (pack.cases || []).slice(0, 12);
  if (!items.length) {
    preview.className = 'pack-preview empty';
    preview.textContent = 'No items yet';
    return preview;
  }

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

**Impact:** Packs with thumbnails display 3D preview image; others show colored blocks.

---

### File 6: [styles/components/](../styles/components/) - Pack Preview Styles

**Location:** Create new file `pack-preview.css` or add to existing card styles

**Changes:**

- Add styles for `.pack-preview-img`
- Ensure aspect ratio matches 512×256 (2:1)
- Add border-radius, object-fit, transition effects

**Code to add:**

```css
.pack-preview-img {
  width: 100%;
  height: auto;
  aspect-ratio: 2 / 1;
  object-fit: cover;
  border-radius: 4px;
  background: var(--color-gray-100);
  transition: transform 0.2s;
}

.pack-preview-img:hover {
  transform: scale(1.02);
}

.pack-preview.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  background: var(--color-gray-50);
  border: 2px dashed var(--color-gray-300);
  border-radius: 4px;
  color: var(--color-gray-500);
  font-size: 0.9rem;
}
```

**Impact:** Thumbnail images look polished and match existing card design.

---

### File 7: [index.html](../index.html) - Sorting UI (Dropdown)

**Location:** Add dropdown control above packs grid (in PacksUI HTML section, around line 1230)

**Changes:**

- Add `<select>` dropdown with 7 sort options
- Wire `change` event to update sort logic in `PacksUI.render()`
- Store selected sort option in `StateStore` or localStorage preferences

**HTML to add (before `#packs-grid`):**

```html
<div class="packs-controls">
  <select class="form-select" id="packs-sort">
    <option value="lastEdited-desc">Last Edited (Newest First)</option>
    <option value="lastEdited-asc">Last Edited (Oldest First)</option>
    <option value="createdAt-desc">Date Created (Newest First)</option>
    <option value="createdAt-asc">Date Created (Oldest First)</option>
    <option value="title-asc">Title (A-Z)</option>
    <option value="title-desc">Title (Z-A)</option>
    <option value="volumePercent-desc">Volume Used (High to Low)</option>
  </select>
</div>
```

**JavaScript to add in `PacksUI.init()` (after line 3815):**

```javascript
const sortSelect = document.getElementById('packs-sort');
sortSelect.addEventListener('change', () => {
  StateStore.set({ packsSortOption: sortSelect.value });
  render();
});
```

**Update sort logic in `PacksUI.render()` (replace line 3825):**

```javascript
const sortOption = StateStore.get('packsSortOption') || 'lastEdited-desc';
const [field, direction] = sortOption.split('-');

const allPacks = PackLibrary.getPacks()
  .slice()
  .sort((a, b) => {
    let valA, valB;

    if (field === 'title' || field === 'client') {
      valA = (a[field] || '').toLowerCase();
      valB = (b[field] || '').toLowerCase();
    } else if (field === 'volumePercent') {
      valA = a.stats?.volumePercent || 0;
      valB = b.stats?.volumePercent || 0;
    } else {
      valA = a[field] || 0;
      valB = b[field] || 0;
    }

    if (direction === 'asc') {
      return valA > valB ? 1 : valA < valB ? -1 : 0;
    } else {
      return valA < valB ? 1 : valA > valB ? -1 : 0;
    }
  });
```

**Impact:** Users can sort packs by 7 different criteria with asc/desc direction.

---

### File 8: [index.html](../index.html) - Optional: Filter Chips

**Location:** Add filter chips UI below sort dropdown (optional enhancement)

**Changes:**

- Add filter chips for:
  - "Empty packs" (0 cases)
  - "Partially packed" (0% < volumePercent < 100%)
  - "Fully packed" (volumePercent === 100%)
- Update filter logic in `PacksUI.render()`

**HTML to add (optional):**

```html
<div class="packs-filters">
  <label><input id="filter-empty" type="checkbox" /> Empty</label>
  <label><input id="filter-partial" type="checkbox" /> Partial</label>
  <label><input id="filter-full" type="checkbox" /> Full</label>
</div>
```

**JavaScript to add (optional):**

```javascript
// Wire filter checkboxes
['empty', 'partial', 'full'].forEach(type => {
  document.getElementById(`filter-${type}`).addEventListener('change', render);
});

// Update filter logic in render() (before line 3831)
const filters = {
  empty: document.getElementById('filter-empty').checked,
  partial: document.getElementById('filter-partial').checked,
  full: document.getElementById('filter-full').checked,
};

const packs = allPacks.filter(p => {
  // Text search
  const matchesSearch =
    !q || (p.title || '').toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q);

  // Filter chips
  if (filters.empty && (p.cases || []).length > 0) return false;
  if (filters.partial && (p.stats.volumePercent <= 0 || p.stats.volumePercent >= 100)) return false;
  if (filters.full && p.stats.volumePercent < 100) return false;

  return matchesSearch;
});
```

**Impact:** Users can filter packs by packing status (empty/partial/full).

---

## Summary: 8 Files to Edit

| File                                 | Lines to Change | Purpose                                                                |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------- |
| 1. index.html (Normalizer)           | ~2694           | Add 3 new Pack fields (thumbnail, thumbnailUpdatedAt, thumbnailSource) |
| 2. index.html (ExportService)        | ~6770           | Add `captureThumbnail()` function                                      |
| 3. index.html (AutoPackEngine)       | ~6239           | Auto-capture thumbnail after AutoPack                                  |
| 4. index.html (EditorUI HTML)        | ~1438           | Add "Capture Thumbnail" button                                         |
| 5. index.html (EditorUI JS)          | ~6806           | Wire manual capture button handler                                     |
| 6. index.html (PacksUI.buildPreview) | ~3925           | Render `<img>` if thumbnail exists, else colored blocks                |
| 7. styles/components/                | New file        | Add `.pack-preview-img` styles                                         |
| 8. index.html (PacksUI.render)       | ~3825           | Add sort dropdown + logic (7 options)                                  |

**Estimated effort:** 4–6 hours for experienced developer (including testing)

**Testing checklist:**

- [ ] Existing packs without thumbnails show colored blocks
- [ ] AutoPack captures thumbnail automatically
- [ ] Manual button captures thumbnail on click
- [ ] Thumbnail displays in grid with correct aspect ratio
- [ ] Sorting dropdown changes pack order (7 options)
- [ ] localStorage size stays under 5MB (100 packs × 50KB)
- [ ] No performance lag when rendering 50+ packs
- [ ] Export/import pack JSON includes thumbnail field
- [ ] Normalizer handles missing thumbnail gracefully

---

**End of Repo Map**  
See also: `AUDIT_APP_STRUCTURE.md` (full architecture) and `AUDIT_PACK_PREVIEW_AND_FILTERS.md`
(feature-specific deep dive).
