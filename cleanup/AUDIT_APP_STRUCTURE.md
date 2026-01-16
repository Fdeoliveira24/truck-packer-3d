# Truck Packer 3D - Application Architecture Audit

**Date:** 2025-01-17  
**Purpose:** Comprehensive codebase structure documentation to support feature requests without sharing 30+ files  
**Version:** 1.0.0

---

## 1. File Tree (Current State)

```
Truck Packer 3D/
├── index.html                    # 7898 lines - Main app (single-file architecture)
├── index-backup.html             # Backup of main file
├── package.json                  # Dependencies: prettier, eslint, html-validate
├── package-lock.json
├── .prettierrc.js                # Code formatting config
├── .eslintrc.js                  # Linting config
├── .htmlvalidate.json            # HTML validation rules
├── cleanup/                      # Project documentation
│   ├── AUDIT_APP_STRUCTURE.md    # This file
│   ├── QUICKSTART.md             # Quick reference guide
│   ├── README.md                 # Setup instructions
│   ├── SETUP_SUMMARY.md          # Environment summary
│   └── reports/                  # Linting/validation reports
├── public/                       # Empty (future static assets)
├── styles/                       # External CSS (currently unused - styles inline in index.html)
└── src/                          # Modular architecture (partial migration)
    ├── app.js                    # App entry point (future modular bootstrap)
    ├── router.js                 # Screen routing logic (future)
    ├── core/
    │   ├── constants.js          # App constants
    │   ├── event-bus.js          # Event system
    │   ├── state.js              # Reactive state store with undo/redo
    │   └── storage.js            # localStorage persistence
    ├── auth/
    │   ├── session.js            # Demo session + account switching
    │   └── permissions.js        # Role-based access (placeholder)
    ├── data/
    │   ├── models/               # Data model definitions
    │   │   ├── user.model.js
    │   │   ├── organization.model.js
    │   │   ├── case.model.js
    │   │   └── pack.model.js
    │   ├── repositories/         # Repository pattern
    │   │   ├── base.repository.js
    │   │   └── local.repository.js
    │   └── services/             # Business logic services (mostly stubs)
    │       ├── cases.service.js
    │       ├── packs.service.js
    │       ├── organizations.service.js
    │       ├── users.service.js
    │       ├── billing.service.js
    │       ├── analytics.service.js
    │       ├── maps.service.js
    │       └── collaboration.service.js
    ├── features/                 # Feature-specific implementations (placeholder folders)
    │   ├── account/
    │   ├── cases/
    │   ├── editor/
    │   ├── organization/
    │   ├── packs/
    │   ├── roadmap/
    │   ├── settings/
    │   └── updates/
    ├── ui/
    │   ├── components/
    │   │   └── account-switcher.js
    │   └── utils/
    ├── utils/                    # Helper functions
    ├── vendor/                   # Third-party code
    ├── config/                   # Configuration files
    └── legacy/                   # Old code backups
```

**Key Observations:**
- **Single-file app:** Entire application logic lives in `index.html` as inline JavaScript modules (IIFE pattern)
- **Partial migration:** `/src` structure exists with core infrastructure (state, storage, auth) implemented, but screen UI logic still in `index.html`
- **Empty feature folders:** `/src/features/*` are placeholders; actual screens (`PacksUI`, `CasesUI`, `EditorUI`, etc.) are in `index.html`
- **No bundler:** App loaded directly in browser; CDN libraries via `<script>` tags

---

## 2. App Entry Points & Bootstrap Sequence

### 2.1 Bootstrap Flow

1. **Browser loads `index.html`**
2. **CDN libraries load** (lines 18-42):
   - Three.js (ESM via esm.sh)
   - OrbitControls
   - TWEEN.js
   - jsPDF
   - XLSX (SheetJS)
   - Font Awesome CSS
   - Google Fonts (Inter)

3. **Inline app code executes** (lines 1583-7898):
   - All modules defined as closures inside `window.TruckPackerApp` IIFE

4. **Bootstrap IIFE** (lines 7880-7897):
   ```javascript
   (async function () {
     // Wait for Three.js to load
     await window.__TP3D_BOOT.threeReady;
     
     // Initialize app
     window.TruckPackerApp.init(); // Line 7886
   })();
   ```

5. **`DOMContentLoaded` listener** (line 7890):
   - Ensures DOM ready before initialization

### 2.2 Initialization Sequence (`TruckPackerApp.init()` - line ~7815)

```javascript
function init() {
  // 1. Check WebGL support
  if (!Utils.hasWebGL()) {
    SystemOverlay.show({ /* error */ });
    return;
  }

  // 2. Load persisted data from localStorage
  const stored = Storage.load();
  const appData = stored || {
    caseLibrary: Defaults.seedCases(),
    packLibrary: [Defaults.seedPack(seedCases)],
    preferences: Defaults.defaultPreferences,
    currentPackId: null
  };

  // 3. Normalize and validate data
  const normalized = Normalizer.normalizeAppData(appData);

  // 4. Initialize reactive state store
  StateStore.init({
    ...normalized,
    currentScreen: 'packs',
    selectedInstanceIds: [],
    cameraView: 'perspective'
  });

  // 5. Apply theme
  PreferencesManager.applyTheme(normalized.preferences.theme);

  // 6. Subscribe to state changes → auto-save
  StateStore.subscribe((changes) => {
    if (!changes._undo && !changes._redo) {
      Storage.saveSoon(); // Debounced save
    }
  });

  // 7. Initialize UI components
  AppShell.init();          // Navigation + topbar
  AccountSwitcher.init();   // Account menu
  SettingsOverlay (bound dynamically when opened)
  PacksUI.init();           // Packs screen
  CasesUI.init();           // Cases screen
  EditorUI.init();          // Editor screen
  UpdatesUI.init();         // Updates screen
  RoadmapUI.init();         // Roadmap screen

  // 8. Render initial screen
  AppShell.renderShell();
  PacksUI.render();
  CasesUI.render();
  EditorUI.render(); // Sets up 3D scene if needed
  // ... other screens

  // 9. Set up keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeydown);

  // 10. Window resize handler
  window.addEventListener('resize', Utils.debounce(() => {
    SceneManager.resize();
  }, 150));
}
```

**Key modules (all in `index.html`):**
- `Utils` (line ~1590): Helper functions (uuid, formatting, conversions, etc.)
- `UIComponents` (line ~1830): Toast/modal/dropdown system
- `SystemOverlay` (line ~2090): Full-screen error messages
- `StateStore` (line ~2130): Reactive state with undo/redo
- `Storage` (line ~2280): localStorage persistence
- `SessionManager` (line ~2380): Mock session + account switching
- `Defaults` (line ~2500): Seed data (demo cases, packs, preferences, categories)
- `Normalizer` (line ~2650): Data validation and migration
- `PreferencesManager` (line ~2850): Theme + unit preferences
- `SettingsOverlay` (line ~2900): Full-screen settings modal
- `AccountSwitcher` (line ~3350): Account dropdown
- `CategoryService` (line ~3480): Category CRUD + color generation
- `CaseLibrary` (line ~3600): Case CRUD operations
- `PackLibrary` (line ~3680): Pack CRUD + instance management
- `Data` (line ~3740): Hardcoded updates + roadmap content
- `AppShell` (line ~3690): Screen switching + topbar
- `PacksUI` (line ~3768): Packs screen (grid of pack cards)
- `CasesUI` (line ~4205): Cases screen (sortable table)
- `SceneManager` (line ~5800): Three.js scene/camera/renderer setup
- `CaseScene` (line ~6400): 3D instance mesh management
- `EditorUI` (line ~6746): Editor screen (3D workspace)
- `UpdatesUI` (line ~7260): Updates screen
- `RoadmapUI` (line ~7310): Roadmap screen

---

## 3. UI Layout Map

### 3.1 HTML Structure (lines 1170-1620)

```
<div class="app" id="app">
  ├── <aside class="sidebar" id="sidebar">
  │   ├── .sidebar-header (brand logo + name)
  │   ├── <nav class="nav"> (primary navigation buttons)
  │   │   ├── button[data-nav="packs"]
  │   │   ├── button[data-nav="cases"]
  │   │   ├── button[data-nav="editor"]
  │   │   ├── button[data-nav="updates"]
  │   │   └── button[data-nav="roadmap"]
  │   ├── #btn-account-switcher (account dropdown trigger)
  │   └── .sidebar-bottom (#btn-theme)
  │
  └── <main class="main">
      ├── <header class="topbar">
      │   ├── .topbar-left
      │   │   ├── #btn-sidebar (mobile hamburger menu)
      │   │   └── #topbar-title + #topbar-subtitle
      │   └── .topbar-right
      │       ├── #btn-export-app
      │       ├── #btn-import-app
      │       └── #btn-help
      │
      └── <div class="content">
          ├── <section class="screen" id="screen-packs">       (Packs grid)
          ├── <section class="screen" id="screen-cases">       (Cases table)
          ├── <section class="screen" id="screen-editor">      (3D editor)
          ├── <section class="screen" id="screen-updates">     (Release notes)
          ├── <section class="screen" id="screen-roadmap">     (Roadmap)
          └── <section class="screen" id="screen-settings">    (Preferences - deprecated, now uses SettingsOverlay)

Overlays (rendered dynamically):
├── #modal-root (UIComponents.showModal)
├── #toast-container (UIComponents.showToast)
└── #system-overlay (SystemOverlay.show for critical errors)
```

### 3.2 Screen Switching (`AppShell.navigate()` - line ~3735)

```javascript
function navigate(screenKey) {
  StateStore.set({ currentScreen: screenKey }, { skipHistory: true });
}
```

- **State-driven:** `StateStore.set()` triggers subscribers
- **Subscriber in `AppShell`:** Calls `renderShell()` on state change
- **`renderShell()` logic (line ~3742):**
  1. Reads `StateStore.get('currentScreen')`
  2. Toggles `.active` class on `.screen` elements
  3. Updates topbar title/subtitle
  4. Adds `.editor-mode` class to `.content` if screen is `editor` (removes padding, hides grid pattern)
  5. Re-renders nav buttons with `.active` state

**Available screens:**
- `packs`: Pack library grid (default)
- `cases`: Case inventory table
- `editor`: 3D workspace (Three.js)
- `updates`: Release notes
- `roadmap`: Feature roadmap
- `settings`: ~~(deprecated, now uses `SettingsOverlay.open()` instead)~~

### 3.3 Topbar Context

**Topbar updates dynamically** based on screen:

| Screen    | Title             | Subtitle                                      |
|-----------|-------------------|-----------------------------------------------|
| packs     | "Packs"           | "Project library"                             |
| cases     | "Cases"           | "Inventory management"                        |
| editor    | `pack.title`      | `"Edited " + formatRelativeTime(lastEdited)`  |
| updates   | "Updates"         | "Release notes"                               |
| roadmap   | "Roadmap"         | "Product direction"                           |

**Buttons (always visible):**
- Export App JSON
- Import App JSON
- Help

---

## 4. Data Model + Storage Map

### 4.1 localStorage Schema

**Key:** `truckPacker3d:v1`

**Payload structure:**
```javascript
{
  version: "1.0.0",
  savedAt: 1737158400000, // timestamp
  caseLibrary: [ /* Case objects */ ],
  packLibrary: [ /* Pack objects */ ],
  preferences: { /* Preferences object */ },
  currentPackId: "uuid-here" // or null
}
```

**Session storage key:** `truckPacker3d:session:v1`
```javascript
{
  user: { name: "Demo User", email: "info@pxl360.com" },
  currentAccount: { type: "personal", name: "Personal Account", role: "Owner" }
}
```

### 4.2 Case Model (lines ~3600-3680 in `CaseLibrary`)

```typescript
interface Case {
  id: string;              // UUID
  name: string;            // "Line Array Case"
  manufacturer: string;    // "L-Acoustics"
  category: string;        // "audio" (lowercase key)
  dimensions: {
    length: number;        // inches
    width: number;         // inches
    height: number;        // inches
  };
  weight: number;          // pounds
  volume: number;          // cubic inches (computed)
  canFlip: boolean;        // Rotation allowed?
  notes: string;           // User notes
  color: string;           // Hex color: "#ff9f1c"
  createdAt: number;       // timestamp
  updatedAt: number;       // timestamp
}
```

**Operations (in `CaseLibrary`):**
- `getCases()`: Returns all cases
- `getById(caseId)`: Find one case
- `upsert(caseData)`: Create or update (recalculates `volume`, sets `updatedAt`)
- `remove(caseId)`: Delete case + remove from all packs
- `duplicate(caseId)`: Clone case with new UUID and "(Copy)" suffix
- `search(query, categoryKeys)`: Filter by name/manufacturer + category
- `reassignCategory(oldKey, newKey)`: Bulk category rename

### 4.3 Pack Model (lines ~3680-3740 in `PackLibrary`)

```typescript
interface Pack {
  id: string;              // UUID
  title: string;           // "Demo Pack"
  client: string;          // "Example Client"
  projectName: string;     // "Envato Preview"
  drawnBy: string;         // "Truck Packer 3D"
  notes: string;           // User notes
  truck: {
    length: number;        // inches (636 = 53ft trailer)
    width: number;         // inches (102)
    height: number;        // inches (98)
  };
  cases: CaseInstance[];   // Array of placed instances
  groups: Group[];         // Future: grouped instances
  stats: {
    totalCases: number;    // Total instances
    packedCases: number;   // Instances inside truck bounds
    volumeUsed: number;    // cubic inches used
    volumePercent: number; // % of truck filled
    totalWeight: number;   // pounds
  };
  createdAt: number;       // timestamp
  lastEdited: number;      // timestamp
}

interface CaseInstance {
  id: string;              // UUID (unique per instance)
  caseId: string;          // Reference to Case.id
  transform: {
    position: { x: number, y: number, z: number }; // inches
    rotation: { x: number, y: number, z: number }; // radians
    scale: { x: number, y: number, z: number };    // 1 = normal
  };
  hidden: boolean;         // Visibility toggle
  groupId: string | null;  // Future: group membership
}
```

**Operations (in `PackLibrary`):**
- `getPacks()`: Returns all packs
- `getById(packId)`: Find one pack
- `create(packData)`: New pack with empty case array
- `update(packId, patch)`: Merge changes, recalculate `stats`, set `lastEdited`
- `remove(packId)`: Delete pack + clear `currentPackId` if active
- `duplicate(packId)`: Clone with new UUIDs for pack + all instances
- `open(packId)`: Set as active pack (`currentPackId` in state)
- `addInstance(packId, caseId, position)`: Add case to pack
- `updateInstance(packId, instanceId, patch)`: Update transform/hidden
- `removeInstances(packId, instanceIds[])`: Delete instances
- `computeStats(pack, caseLibraryOverride?)`: Recalculate volume/weight (counts only visible instances inside truck bounds)

### 4.4 Preferences Model (lines ~2500 in `Defaults`)

```typescript
interface Preferences {
  units: {
    length: "in" | "ft" | "mm" | "cm" | "m";
    weight: "lb" | "kg";
  };
  theme: "light" | "dark";
  labelFontSize: number;           // 8-24px
  hiddenCaseOpacity: number;       // 0-1
  snapping: {
    enabled: boolean;
    gridSize: number;              // inches
  };
  camera: {
    defaultView: "perspective" | "orthographic";
  };
  export: {
    screenshotResolution: string;  // "1920x1080" | "2560x1440" | "3840x2160"
    pdfIncludeStats: boolean;
  };
  categories: Category[];          // User-defined categories
}

interface Category {
  key: string;        // "audio" (lowercase, unique)
  name: string;       // "Audio"
  color: string;      // "#f59e0b"
}
```

**Default categories (line ~2510):**
- `audio` (orange)
- `lighting` (blue)
- `stage` (green)
- `backline` (pink)
- `default` (gray)

### 4.5 State Store Architecture (lines ~2130-2280)

**Reactive store** with history management:

```javascript
StateStore.init(initialState);  // Set up state + history
StateStore.get(key);            // Read state
StateStore.set(patch);          // Merge patch → notify subscribers
StateStore.replace(newState);   // Full replace
StateStore.snapshot();          // Deep clone current state
StateStore.undo();              // Restore previous history entry
StateStore.redo();              // Restore next history entry
StateStore.subscribe(fn);       // Listen to changes
```

**History tracking:**
- Max 50 snapshots
- Only tracks "significant" changes: `caseLibrary`, `packLibrary`, `preferences`
- Skip history for UI state changes (`currentScreen`, `selectedInstanceIds`, `cameraView`)

**Global state shape:**
```typescript
interface AppState {
  // Data
  caseLibrary: Case[];
  packLibrary: Pack[];
  preferences: Preferences;
  currentPackId: string | null;
  
  // UI state (not persisted to localStorage)
  currentScreen: "packs" | "cases" | "editor" | "updates" | "roadmap";
  selectedInstanceIds: string[];
  cameraView: "perspective" | "orthographic";
}
```

### 4.6 Persistence Flow

1. **User makes change** → `StateStore.set({ caseLibrary: [...] })`
2. **State update** → Triggers subscriber
3. **Subscriber calls** → `Storage.saveSoon()` (debounced 250ms)
4. **After debounce** → `Storage.saveNow()` writes to `localStorage`

**Export/Import:**
- `Storage.exportAppJSON()`: Full app data as JSON string
- `Storage.importAppJSON(text)`: Parse + validate + merge into state

---

## 5. Editor / Three.js Map

### 5.1 SceneManager Initialization (lines ~5800-6400)

**Lifecycle:**
```javascript
SceneManager.init(containerEl); // Called once on app bootstrap
SceneManager.resize();           // Called on window resize
SceneManager.setTruck(truckDims); // Called when pack changes
SceneManager.refreshTheme();     // Called when theme toggles
```

**Setup flow (line ~5850):**
1. Create Three.js scene
2. Create perspective camera (FOV 50°, near 0.01, far 5000)
3. Create WebGL renderer (antialias, high-performance, shadows enabled)
4. Create OrbitControls (damping, min/max distance, max polar angle)
5. Add lighting (ambient + directional + hemisphere)
6. Add environment (ground plane + grid helper)
7. Create axis widget (mini scene for top-right corner)
8. Start render loop (`requestAnimationFrame`)

**Coordinate system:**
- `1 world unit = 20 inches` (INCH_TO_WORLD = 0.05)
- Truck positioned at origin: X+ = length, Y+ = height, Z+ = width
- Truck bounds: `{ min: (0, 0, -width/2), max: (length, height, width/2) }`

**Utilities:**
- `toWorld(inches)`: Convert inches → world units
- `toInches(worldUnits)`: Convert world units → inches
- `vecInchesToWorld(pos)`: Convert position object → THREE.Vector3
- `vecWorldToInches(vec)`: Convert THREE.Vector3 → position object

### 5.2 Truck Rendering (line ~6100)

```javascript
function setTruck(truckInches) {
  // Remove old truck mesh if exists
  // Create new truck group:
  //   - Box mesh (transparent, opacity 0.09)
  //   - Edge geometry (wireframe)
  // Update truckBoundsWorld for collision detection
  // Move camera target to truck center
}
```

**Truck signature:** `"${length}x${width}x${height}"` (prevents unnecessary rebuilds)

### 5.3 CaseScene Management (lines ~6400-6746)

**Instance tracking:**
```javascript
const instances = new Map(); // instanceId -> THREE.Group
```

**Sync flow (line ~6430):**
```javascript
function sync(pack) {
  // 1. Build signature for each instance (caseId + dimensions + color)
  // 2. Reuse existing meshes if signature matches
  // 3. Dispose + rebuild if signature changed
  // 4. Remove instances not in pack.cases
  // 5. Apply transforms, visibility, selection, hover
}
```

**Instance mesh structure:**
```
THREE.Group (instance.id)
├── THREE.Mesh (main box)
├── THREE.LineSegments (edges)
└── Sprite (label) - if enabled
```

**Materials:**
- Main: `MeshStandardMaterial` (color from case.color, metalness 0.3, roughness 0.7)
- Edges: `LineBasicMaterial` (darker shade of case.color)
- Selection outline: `LineBasicMaterial` (accent color, thicker)
- Hover: Brightness boost via `material.emissive`

**Transform application (line ~6520):**
```javascript
function applyTransform(group, instance) {
  const pos = instance.transform.position; // inches
  const posWorld = SceneManager.vecInchesToWorld(pos);
  group.position.copy(posWorld);
  
  const rot = instance.transform.rotation; // radians
  group.rotation.set(rot.x, rot.y, rot.z);
  
  const scale = instance.transform.scale;
  group.scale.set(scale.x, scale.y, scale.z);
}
```

### 5.4 Editor Interaction (lines ~6746-7260 in `EditorUI`)

**Mouse/touch handling:**
- **Click:** Select instance
- **Shift+Click:** Multi-select
- **Drag:** Move selected instances (raycasting to ground plane)
- **Delete key:** Remove selected instances
- **Arrow keys:** Nudge selected instances
- **Ctrl/Cmd+Z:** Undo
- **Ctrl/Cmd+Shift+Z:** Redo
- **Ctrl/Cmd+P:** AutoPack (automatic placement algorithm)

**AutoPack algorithm (line ~7100):**
1. Sort cases by volume (largest first)
2. Place each case at lowest available position
3. Check collision with existing instances using AABB
4. Snap to grid if snapping enabled
5. Skip if no valid position found

**Camera controls:**
- Orbit: Left mouse drag
- Pan: Right mouse drag
- Zoom: Scroll wheel

**Viewport toolbar (line ~1430):**
- Toggle case browser (left panel)
- Toggle inspector (right panel)
- AutoPack button
- Screenshot PNG export
- PDF export

### 5.5 Performance Features (line ~6050)

**DevOverlay (press P):**
- FPS counter
- Frame time
- Memory usage (if available)
- Renderer stats (draw calls, triangles, geometries, textures)
- Console logging every 10s

**Performance mode:**
- Auto-enables if FPS < 30 for > 5 seconds
- Disables shadows
- Shows toast with "Restore" action

**Optimizations:**
- Pixel ratio capped at 2
- Geometry/material disposal on mesh rebuild
- Debounced resize handler (150ms)
- Damped controls (reduces render calls)
- Instance mesh reuse (signature-based caching)

---

## 6. Navigation / Screen Switching

### 6.1 Navigation Flow

```
User clicks sidebar button[data-nav="packs"]
   ↓
AppShell.navigate("packs")
   ↓
StateStore.set({ currentScreen: "packs" })
   ↓
StateStore.subscribers triggered
   ↓
AppShell.renderShell()
   ↓
1. Update nav buttons (.active class)
2. Toggle .screen visibility
3. Update topbar title/subtitle
4. Add/remove .editor-mode class on .content
   ↓
(Screen-specific rendering already done via init)
```

### 6.2 Screen Lifecycle

**Initialization (once):**
```javascript
PacksUI.init();   // Set up event listeners, search input
CasesUI.init();   // Set up table sorting, category chips
EditorUI.init();  // Initialize Three.js scene, raycaster, controls
// etc.
```

**Rendering (on data change):**
```javascript
PacksUI.render();   // Build pack grid from PackLibrary.getPacks()
CasesUI.render();   // Build cases table from CaseLibrary.getCases()
EditorUI.render();  // Sync 3D scene with current pack
// etc.
```

**Screens subscribe to state changes:**
```javascript
StateStore.subscribe((changes, nextState) => {
  if (changes.caseLibrary || changes.packLibrary) {
    PacksUI.render();
    CasesUI.render();
  }
  if (changes.currentPackId || changes.packLibrary) {
    EditorUI.render(); // Re-sync 3D scene
  }
  if (changes.currentScreen) {
    AppShell.renderShell();
  }
});
```

### 6.3 Modal / Overlay Navigation

**Settings Overlay:**
- `SettingsOverlay.open("preferences")` → Full-screen modal with left nav
- Tabs: account, preferences, org-general, org-billing
- Does NOT use screen system (z-index 17000, above main app)

**UIComponents Modals:**
- `UIComponents.showModal({ title, content, actions })` → Centered modal (z-index 10000)
- Used for: New Pack, Edit Case, Rename Pack, Category Manager, Import CSV, etc.

**Toast Notifications:**
- `UIComponents.showToast(message, type, options)` → Bottom-right toasts (z-index 20000)
- Auto-dismiss after 3.2s (configurable)
- Max 3 toasts visible

**System Overlay:**
- `SystemOverlay.show({ title, message, items })` → Full-screen error (z-index 30000)
- Used for: WebGL not available, critical boot failures

---

## 7. Pack Card Preview - Current State

### 7.1 Current Implementation (line ~3850 in `PacksUI.buildPreview()`)

**Placeholder blocks:**
```javascript
function buildPreview(pack) {
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

**CSS structure (lines ~980-1040):**
```css
.pack-preview {
  height: 120px;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  padding: 10px;
  background: linear-gradient(135deg, rgba(255, 159, 28, 0.06), rgba(59, 130, 246, 0.04));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.pack-preview-cell {
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
  background: var(--bg-hover);
  min-height: 30px;
  border: 1px solid rgba(0, 0, 0, 0.04);
}
```

**Current behavior:**
- ✅ Shows up to 12 colored blocks (case colors)
- ✅ Empty state for packs with no items
- ❌ **TODO:** Replace with actual canvas snapshot rendering (see comment line ~3850)
- ❌ No 3D perspective
- ❌ No truck context
- ❌ No rotation/camera angle

### 7.2 TODO Comment (line ~3850)

```javascript
// TODO: Replace with actual canvas snapshot rendering
// Should use SceneManager to render pack contents off-screen
// and capture via canvas.toDataURL() for realistic preview
```

**Intended approach:**
1. Create off-screen renderer (same aspect ratio as preview)
2. Render pack contents (truck + instances) using `SceneManager` + `CaseScene.sync(pack)`
3. Capture frame via `renderer.domElement.toDataURL('image/png')`
4. Store as pack field: `pack.thumbnail = "data:image/png;base64,..."`
5. Render `<img>` in pack card instead of colored blocks

### 7.3 Pack Card Rendering (line ~3800)

```javascript
packs.forEach(pack => {
  const card = document.createElement('div');
  card.className = 'card pack-card';
  
  const preview = buildPreview(pack); // ← Current placeholder
  const title = document.createElement('h3');
  title.textContent = pack.title;
  
  // ... metadata badges, kebab menu
  
  card.appendChild(preview);
  card.appendChild(title);
  // ...
  gridEl.appendChild(card);
});
```

**Preview placement:**
- First child of `.pack-card`
- Fixed height: 120px
- Aspect ratio: ~2.5:1 (grid width varies)

---

## 8. Where to Implement Pack Thumbnail Feature

### 8.1 Recommended Implementation Plan

#### Phase 1: Add Thumbnail Field to Pack Model

**File:** `index.html` (lines ~3680-3740 in `PackLibrary`)

**Change pack model:**
```typescript
interface Pack {
  // ... existing fields
  thumbnail?: string;  // NEW: Data URL or null
  thumbnailUpdatedAt?: number; // NEW: Timestamp for cache invalidation
}
```

**Update `PackLibrary.create()`:**
```javascript
function create(packData) {
  const pack = {
    // ... existing fields
    thumbnail: null,
    thumbnailUpdatedAt: null,
  };
  // ...
}
```

**Update `Normalizer.normalizePack()` (line ~2760):**
```javascript
function normalizePack(p, caseMap, now) {
  const pack = {
    // ... existing fields
    thumbnail: typeof p.thumbnail === 'string' ? p.thumbnail : null,
    thumbnailUpdatedAt: finiteNumber(p.thumbnailUpdatedAt, null),
  };
  // ...
}
```

#### Phase 2: Thumbnail Capture Function

**File:** `index.html` (add to `SceneManager` module, line ~6400)

```javascript
const SceneManager = (() => {
  // ... existing code

  function captureThumbnail(pack, options = {}) {
    if (!renderer || !scene || !camera) return null;

    const width = options.width || 512;
    const height = options.height || 256;
    
    // Save current viewport
    const prevWidth = viewSize.width;
    const prevHeight = viewSize.height;
    const prevAspect = camera.aspect;
    const prevPosition = camera.position.clone();
    const prevTarget = controls.target.clone();

    try {
      // Set up off-screen rendering
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      // Position camera for optimal pack view
      const truckCenter = new THREE.Vector3(
        toWorld(pack.truck.length / 2),
        toWorld(pack.truck.height / 2),
        0
      );
      const distance = Math.max(
        toWorld(pack.truck.length),
        toWorld(pack.truck.width)
      ) * 1.2;
      
      camera.position.set(
        truckCenter.x + distance * 0.7,
        truckCenter.y + distance * 0.5,
        distance * 0.7
      );
      controls.target.copy(truckCenter);
      camera.lookAt(truckCenter);

      // Sync scene with pack contents
      CaseScene.sync(pack);

      // Render frame
      renderer.render(scene, camera);

      // Capture as data URL
      const dataUrl = renderer.domElement.toDataURL('image/png');

      return dataUrl;

    } finally {
      // Restore viewport
      renderer.setSize(prevWidth, prevHeight);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      camera.position.copy(prevPosition);
      controls.target.copy(prevTarget);
    }
  }

  return {
    // ... existing exports
    captureThumbnail,
  };
})();
```

#### Phase 3: Thumbnail Generation Hooks

**Hook 1: After AutoPack** (line ~7100 in `EditorUI`)

```javascript
function autoPack() {
  // ... existing AutoPack logic
  
  const packId = StateStore.get('currentPackId');
  const pack = PackLibrary.getById(packId);
  if (pack) {
    const thumbnail = SceneManager.captureThumbnail(pack);
    PackLibrary.update(packId, { thumbnail, thumbnailUpdatedAt: Date.now() });
  }
  
  UIComponents.showToast('AutoPack complete', 'success');
}
```

**Hook 2: Editor Exit/Save** (line ~6900 in `EditorUI`)

```javascript
function exitEditor() {
  const packId = StateStore.get('currentPackId');
  const pack = PackLibrary.getById(packId);
  
  // Ask user if they want to update thumbnail
  const shouldCapture = pack && (pack.cases || []).length > 0 && !pack.thumbnail;
  
  if (shouldCapture) {
    const thumbnail = SceneManager.captureThumbnail(pack);
    PackLibrary.update(packId, { thumbnail, thumbnailUpdatedAt: Date.now() });
  }
  
  AppShell.navigate('packs');
}
```

**Hook 3: Manual "Capture Thumbnail" Button** (add to viewport toolbar)

```html
<!-- Add to line ~1430 in index.html -->
<button class="toolbar-btn" id="btn-capture-thumbnail" type="button" title="Update preview">
  <i class="fa-solid fa-camera"></i>
  Update Preview
</button>
```

```javascript
// In EditorUI.init() (line ~6820):
document.getElementById('btn-capture-thumbnail').addEventListener('click', () => {
  const packId = StateStore.get('currentPackId');
  const pack = PackLibrary.getById(packId);
  if (!pack) return;
  
  const thumbnail = SceneManager.captureThumbnail(pack);
  PackLibrary.update(packId, { thumbnail, thumbnailUpdatedAt: Date.now() });
  UIComponents.showToast('Preview updated', 'success');
});
```

#### Phase 4: Update Pack Card Rendering

**File:** `index.html` (line ~3850 in `PacksUI.buildPreview()`)

```javascript
function buildPreview(pack) {
  const preview = document.createElement('div');
  
  // Use thumbnail if available
  if (pack.thumbnail) {
    preview.className = 'pack-preview pack-preview-image';
    const img = document.createElement('img');
    img.src = pack.thumbnail;
    img.alt = `Preview of ${pack.title}`;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = 'var(--radius-md)';
    preview.appendChild(img);
    
    // Add "Edit Preview" button overlay
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-ghost';
    editBtn.style.position = 'absolute';
    editBtn.style.top = '8px';
    editBtn.style.right = '8px';
    editBtn.style.padding = '4px 8px';
    editBtn.style.fontSize = 'var(--text-xs)';
    editBtn.innerHTML = '<i class="fa-solid fa-camera"></i>';
    editBtn.title = 'Update preview';
    editBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openThumbnailEditor(pack.id);
    });
    preview.appendChild(editBtn);
    
    return preview;
  }
  
  // Fallback to colored blocks if no thumbnail
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

**Add CSS for image preview (line ~1040):**
```css
.pack-preview-image {
  position: relative;
  padding: 0;
  overflow: hidden;
}

.pack-preview-image img {
  display: block;
}
```

#### Phase 5: Thumbnail Editor Modal

**File:** `index.html` (add to `PacksUI` module, line ~4200)

```javascript
function openThumbnailEditor(packId) {
  const pack = PackLibrary.getById(packId);
  if (!pack) return;
  
  const content = document.createElement('div');
  content.style.display = 'grid';
  content.style.gap = '14px';
  
  const previewWrap = document.createElement('div');
  previewWrap.style.width = '100%';
  previewWrap.style.height = '300px';
  previewWrap.style.background = 'var(--bg-elevated)';
  previewWrap.style.borderRadius = 'var(--radius-md)';
  previewWrap.style.overflow = 'hidden';
  previewWrap.style.display = 'flex';
  previewWrap.style.alignItems = 'center';
  previewWrap.style.justifyContent = 'center';
  
  const img = document.createElement('img');
  img.style.maxWidth = '100%';
  img.style.maxHeight = '100%';
  img.src = pack.thumbnail || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
  previewWrap.appendChild(img);
  
  content.appendChild(previewWrap);
  
  UIComponents.showModal({
    title: 'Edit Pack Preview',
    content,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Capture New',
        variant: 'primary',
        onClick: () => {
          // Open editor + auto-capture
          PackLibrary.open(packId);
          AppShell.navigate('editor');
          window.setTimeout(() => {
            const thumbnail = SceneManager.captureThumbnail(pack);
            PackLibrary.update(packId, { thumbnail, thumbnailUpdatedAt: Date.now() });
            UIComponents.showToast('Preview captured', 'success');
            AppShell.navigate('packs');
          }, 500); // Wait for editor to render
        }
      },
      {
        label: 'Remove',
        onClick: () => {
          PackLibrary.update(packId, { thumbnail: null, thumbnailUpdatedAt: null });
          UIComponents.showToast('Preview removed', 'info');
        }
      }
    ]
  });
}
```

### 8.2 Implementation Checklist

- [ ] **Step 1:** Add `thumbnail` and `thumbnailUpdatedAt` fields to Pack model
- [ ] **Step 2:** Update `Normalizer.normalizePack()` to handle new fields
- [ ] **Step 3:** Add `SceneManager.captureThumbnail(pack, options)` function
- [ ] **Step 4:** Add thumbnail capture hooks:
  - [ ] After AutoPack completion
  - [ ] On editor exit (if no thumbnail exists)
  - [ ] Manual "Update Preview" button in viewport toolbar
- [ ] **Step 5:** Update `PacksUI.buildPreview()` to render `<img>` if thumbnail exists
- [ ] **Step 6:** Add CSS for `.pack-preview-image`
- [ ] **Step 7:** Add `openThumbnailEditor(packId)` modal
- [ ] **Step 8:** Add "Edit Preview" button overlay on pack cards with thumbnails
- [ ] **Step 9:** Test thumbnail persistence (localStorage save/load)
- [ ] **Step 10:** Add thumbnail to export/import JSON payloads

---

## 9. Quick Sanity Checklist

Use this to verify app functionality without running extensive tests:

### Core Features
- [ ] **Packs Screen**
  - [ ] Grid loads with demo pack visible
  - [ ] Click "New Pack" → modal opens → create → redirects to editor
  - [ ] Search filters packs by title/client
  - [ ] Kebab menu: Open, Rename, Duplicate, Export, Delete
  - [ ] Pack card shows case count + truck dimensions
  - [ ] Double-click pack card → navigates to editor

- [ ] **Cases Screen**
  - [ ] Table loads with 5 demo cases
  - [ ] Click column headers → sorts by name/manufacturer/volume/weight/category
  - [ ] Category chips filter cases
  - [ ] Search filters by name/manufacturer
  - [ ] Click "New Case" → modal → create → table updates
  - [ ] Click "Import" → CSV/XLSX upload → parses + validates
  - [ ] Click "Template" → downloads `cases_template.csv`
  - [ ] Kebab menu: Edit, Duplicate, Delete
  - [ ] Click "Categories" → category manager modal

- [ ] **Editor Screen**
  - [ ] 3D scene renders (truck wireframe visible)
  - [ ] Left panel: Case browser with search + category chips
  - [ ] Right panel: Inspector (empty if no selection)
  - [ ] Click case in browser → adds to scene
  - [ ] Click instance in scene → highlights + shows in inspector
  - [ ] Drag instance → moves in 3D space
  - [ ] Shift+Click → multi-select
  - [ ] Delete key → removes selected instances
  - [ ] Arrow keys → nudges selected instances
  - [ ] Ctrl/Cmd+Z → undo
  - [ ] AutoPack button → arranges cases automatically
  - [ ] Screenshot button → downloads PNG
  - [ ] PDF button → downloads plan sheet

- [ ] **Settings Overlay**
  - [ ] Click account button → dropdown → "Settings" → opens overlay
  - [ ] Tabs: Account, Preferences, Org General, Org Billing
  - [ ] Change units → save → values update throughout app
  - [ ] Toggle theme → background/colors update immediately

### Data Persistence
- [ ] **localStorage**
  - [ ] Create case → reload page → case still exists
  - [ ] Create pack → reload page → pack still exists
  - [ ] Change preferences → reload → preferences retained
  - [ ] Open pack in editor → reload → pack still active (but screen resets to packs)

- [ ] **Export/Import**
  - [ ] Export app JSON → download → re-import → data restored
  - [ ] Export pack JSON → download → import in fresh session → pack + bundled cases imported

### UI State
- [ ] **Navigation**
  - [ ] Sidebar buttons highlight active screen
  - [ ] Topbar title/subtitle updates per screen
  - [ ] Sidebar collapses on mobile (<899px)
  - [ ] Settings overlay displays over all screens

- [ ] **Toasts**
  - [ ] Success toast: green icon, auto-dismisses
  - [ ] Error toast: red icon, longer duration
  - [ ] Click toast → dismisses immediately
  - [ ] Max 3 toasts visible at once

### Performance
- [ ] **3D Rendering**
  - [ ] Scene renders at 55+ FPS (check DevOverlay: press P)
  - [ ] Dragging instances is smooth (no stuttering)
  - [ ] AutoPack with 50+ cases completes in <2s
  - [ ] Shadows disabled if FPS < 30 for >5s (performance mode)

### Edge Cases
- [ ] **Empty states**
  - [ ] No packs → shows "No packs yet" card
  - [ ] No cases → shows "No cases found" card
  - [ ] Pack with no items → preview shows "No items yet"
  - [ ] Editor with no selection → inspector shows "No selection"

- [ ] **Validation**
  - [ ] Create case with empty name → shows warning toast
  - [ ] Create case with 0 dimensions → shows warning
  - [ ] Import CSV with missing columns → shows error list
  - [ ] Import invalid JSON → shows error toast

---

## 10. Feature Implementation Hook Map

This table maps common feature requests to the exact file/function where implementation should occur.

| Feature Area | File Path | Function/Module Name | Why This Is The Hook Point |
|--------------|-----------|----------------------|----------------------------|
| **Add Pack Thumbnail Field** | `index.html` | `PackLibrary` module (line ~3680) | Pack model definition + CRUD operations live here |
| **Normalize Thumbnail on Load** | `index.html` | `Normalizer.normalizePack()` (line ~2760) | All imported/loaded pack data passes through this validator |
| **Capture Thumbnail (New Function)** | `index.html` | `SceneManager` module (line ~5800) | SceneManager owns Three.js renderer; add `captureThumbnail()` here |
| **Auto-Capture After AutoPack** | `index.html` | `EditorUI.autoPack()` (line ~7100) | Called after AutoPack algorithm completes; add capture + update here |
| **Capture on Editor Exit** | `index.html` | `EditorUI` exit handler (line ~6900) | Fires when user navigates away from editor; check if thumbnail exists |
| **Manual Thumbnail Capture Button** | `index.html` | Viewport toolbar (line ~1430) + `EditorUI.init()` (line ~6820) | Add button HTML in toolbar, bind click handler in EditorUI.init() |
| **Render Thumbnail in Pack Card** | `index.html` | `PacksUI.buildPreview()` (line ~3850) | Generates preview HTML for each pack card; replace colored blocks with `<img>` |
| **Thumbnail Editor Modal** | `index.html` | `PacksUI` module (add new function) | Add `openThumbnailEditor(packId)` modal function here |
| **Pack Card "Edit Preview" Button** | `index.html` | `PacksUI.buildPreview()` (line ~3850) | Add overlay button when thumbnail exists |
| **Add Case Color Picker** | `index.html` | `CasesUI.openCaseModal()` (line ~4450) | Modal form for case creation/editing; add color input field |
| **Custom Category Colors** | `index.html` | `CategoryService.upsert()` (line ~3540) | Category CRUD; color already supported, just expose in UI |
| **Category Manager UI** | `index.html` | `CasesUI.openCategoryManager()` (line ~4650) | Already exists! Modal with color pickers per category |
| **Export Pack Thumbnail to JSON** | `index.html` | `PackLibrary.update()` (line ~3690) + `Storage.exportAppJSON()` (line ~2360) | Thumbnail auto-included in pack object; no extra work needed |
| **Import Pack Thumbnail from JSON** | `index.html` | `PacksUI.importPackPayload()` (line ~4090) | Already handles full pack object; thumbnail preserved |
| **Add Custom Truck Preset** | `index.html` | `PacksUI.openNewPackModal()` (line ~3900) | Modal has preset dropdown; add new option to `truckPresets` array |
| **Add Unit Conversion for Metric** | `index.html` | `Utils` module (line ~1700) | Contains `inchesToUnit()`, `unitToInches()`, etc.; extend as needed |
| **Add Weight Balance Visualization** | `index.html` | `EditorUI` module (add new panel) | Create new right-panel section showing center-of-gravity calculation |
| **Add Instance Rotation UI** | `index.html` | `EditorUI` inspector panel (line ~7200) | Inspector shows transform inputs; add rotation X/Y/Z sliders |
| **Add Pack Duplicate Shortcut** | `index.html` | `PacksUI` pack card click handler (line ~3800) | Add Ctrl/Cmd+Click detection → call `PackLibrary.duplicate()` |
| **Add Case Quick-Add from Editor** | `index.html` | `EditorUI` left panel (line ~6850) | Case browser already exists; add "+" button next to search |
| **Add Keyboard Shortcut Reference** | `index.html` | `EditorUI` help button (line ~1210) | Button already exists in topbar; add modal with shortcut table |
| **Add Undo/Redo UI Indicators** | `index.html` | `EditorUI` toolbar (line ~1430) | Add undo/redo buttons; enable/disable based on `StateStore` history |
| **Add Multi-Pack View** | `index.html` | New `PacksUI.openCompareModal()` function | Create modal with side-by-side pack comparison (stats, previews) |
| **Add CSV Export for Packs** | `index.html` | `PacksUI` pack card kebab menu (line ~3900) | Add "Export CSV" option → generate CSV with case list |
| **Add Dark Mode Auto-Detect** | `index.html` | `PreferencesManager.applyTheme()` (line ~2880) | Check `window.matchMedia('(prefers-color-scheme: dark)')` |
| **Add Mobile Gestures** | `index.html` | `EditorUI` touch event handlers (line ~6950) | Already has basic touch; extend with pinch-zoom, two-finger rotate |
| **Add Screenshot Auto-Save** | `index.html` | `EditorUI` screenshot button (line ~7160) | Modify to save to pack.thumbnail instead of downloading |
| **Add Pack Search by Client** | `index.html` | `PacksUI.render()` search filter (line ~3790) | Already searches title/client; extend to search projectName, notes |
| **Add Case Library Stats** | `index.html` | `CasesUI` screen header (line ~1322) | Add stats card: total cases, avg volume, total weight |
| **Add Pack Timeline View** | `index.html` | New `PacksUI.renderTimeline()` function | Create vertical timeline sorted by `lastEdited` |
| **Add AutoPack Settings** | `index.html` | `EditorUI.autoPack()` (line ~7100) + Settings modal | Add options: sort by volume/weight, fill strategy (tight/loose) |

---

## Notes

- **No bundler:** App loaded directly in browser; all modules are IIFEs in `index.html`
- **Partial modularization:** `/src` structure exists but most code still in main file
- **Future refactor:** Migrate screen modules (`PacksUI`, `CasesUI`, `EditorUI`) to `/src/features/`
- **localStorage limits:** ~5-10MB depending on browser; large thumbnails may exceed quota
- **Data URL size:** Base64-encoded PNG thumbnails ~50-200KB each; monitor total storage usage
- **Migration strategy:** Add `version` field to localStorage schema; handle upgrades in `Normalizer`

---

**End of Audit**
