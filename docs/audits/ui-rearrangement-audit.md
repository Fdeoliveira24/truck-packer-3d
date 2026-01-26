# UI Rearrangement Audit - Account, Settings, Export/Import/Help, Updates, Roadmap

**Project:** Truck Packer 3D  
**Audit Date:** January 24, 2026  
**Purpose:** Identify all UI components, dependencies, and risks before rearranging Account vs Settings separation, moving Export/Import/Help into Settings, and demoting Updates/Roadmap  
**Status:** ✅ AUDIT COMPLETE - NO CODE CHANGES MADE

---

## 1. Feature Map (High-Level)

### Account Dropdown (Sidebar Footer)
- **Files Involved:**
  - `index.html` lines 267-283 (button HTML: `#btn-account-switcher`)
  - `src/app.js` lines 220-342 (AccountSwitcher module)
  - `src/ui/overlays/settings-overlay.js` lines 150-162 (duplicate button in Settings left pane)
  - `styles/main.css` lines 202-415 (account button + dropdown styles)

### Account Modal/Tab (Inside Settings Overlay)
- **Files Involved:**
  - `src/ui/overlays/settings-overlay.js` lines 1-465 (entire Settings overlay with tabs)
  - Tab key: `'account'` (lines 246-281)
  - Renders user info, email, danger zone (delete account)
  - Uses shared Settings modal shell

### Settings Modal
- **Files Involved:**
  - `src/ui/overlays/settings-overlay.js` lines 1-465 (factory function)
  - `src/app.js` lines 185-192 (instantiation + wiring)
  - `styles/main.css` lines 1276-1388 (Settings overlay specific styles)
  - `styles/main.css` lines 1226-1274 (shared `.modal`, `.modal-overlay`)
  - Tab key: `'preferences'` (lines 282-338)
  - Also includes tabs: `'org-general'`, `'org-billing'` (lines 339-408)

### Export / Import / Help (Top Bar Buttons)
- **Files Involved:**
  - `index.html` lines 299-309 (topbar-right buttons: `#btn-export-app`, `#btn-import-app`, `#btn-help`)
  - `src/app.js` lines 2026-2078 (wireGlobalButtons + event handlers)
  - `src/ui/overlays/help-modal.js` lines 1-60 (Help modal factory)
  - `src/ui/overlays/import-app-dialog.js` lines 1-185 (Import dialog factory)
  - `src/services/import-export.js` lines 1-236 (data processing)

### Updates Screen
- **Files Involved:**
  - `index.html` lines 253-254 (nav button: `data-nav="updates"`)
  - `index.html` lines 664-668 (screen container: `#screen-updates`, `#updates-list`)
  - `src/app.js` lines 634-654 (static updates array)
  - `src/app.js` lines 1612-1658 (UpdatesUI rendering logic)
  - `src/app.js` lines 727 (screenTitles metadata)

### Roadmap Screen
- **Files Involved:**
  - `index.html` lines 255-258 (nav button: `data-nav="roadmap"`)
  - `index.html` lines 672-676 (screen container: `#screen-roadmap`, `#roadmap-list`)
  - `src/app.js` lines 655-707 (static roadmap array)
  - `src/app.js` lines 1661-1707 (RoadmapUI rendering logic)
  - `src/app.js` lines 728 (screenTitles metadata)

---

## 2. Detailed Findings

### `index.html`
**Responsibilities:**
- HTML structure for sidebar, topbar, screens, modals
- Contains all static DOM nodes referenced by JS

**Key Selectors:**
- `#btn-account-switcher` (line 267) - Sidebar footer account button
- `#btn-export-app` (line 299) - Topbar Export button
- `#btn-import-app` (line 303) - Topbar Import button
- `#btn-help` (line 307) - Topbar Help button
- `[data-nav="updates"]` (line 253) - Updates nav button
- `[data-nav="roadmap"]` (line 257) - Roadmap nav button
- `#screen-updates` (line 664) - Updates screen container
- `#screen-roadmap` (line 672) - Roadmap screen container
- `#modal-root` (line 920) - Modal mount point
- `#system-overlay` (line 924) - System error overlay

**Event Listeners:**
- None (all wired in JS)

---

### `src/app.js`
**Responsibilities:**
- Main bootstrap file
- Instantiates all UI components, services, screens
- Wires global button handlers
- Navigation logic (AppShell module)
- Contains static Updates/Roadmap data arrays

**Key Functions:**

#### AccountSwitcher Module (lines 220-342)
- `bind(buttonEl, options)` - Attaches dropdown to account button
- `initAccountSwitcher()` - Wires sidebar button click handler
- Opens dropdown with workspace switcher + Settings link
- Settings link calls `SettingsOverlay.open('preferences')` (line 299)

#### AppShell Module (lines 714-822)
- `navigate(screenKey)` - Changes currentScreen state
- `renderShell()` - Shows/hides screens, updates topbar, manages sidebar collapse
- `screenTitles` object (lines 724-730) - Metadata for Packs, Cases, Editor, Updates, Roadmap, Settings

#### wireGlobalButtons() (lines 2026-2078)
- `btnExport.addEventListener('click', ...)` - Opens modal with export confirmation, downloads JSON via `ImportExport.buildAppExportJSON()`
- `btnImport.addEventListener('click', ...)` - Opens `ImportAppDialog.open()`
- `btnHelp.addEventListener('click', ...)` - Opens `HelpModal.open()`

#### Static Data Arrays
- `updates` array (lines 634-654) - Release notes, rendered by UpdatesUI
- `roadmap` array (lines 655-707) - Product roadmap, rendered by RoadmapUI

#### UpdatesUI Module (lines 1614-1658)
- `render()` - Populates `#updates-list` with update cards
- No state dependency

#### RoadmapUI Module (lines 1661-1707)
- `render()` - Populates `#roadmap-list` with roadmap cards
- No state dependency

**Dependencies:**
- `createSettingsOverlay` (line 43)
- `createHelpModal` (line 45)
- `createImportAppDialog` (line 46)
- `ImportExport` service (line 41)

---

### `src/ui/overlays/settings-overlay.js`
**Responsibilities:**
- Renders Settings modal with left nav tabs + right content pane
- Tabs: Account, Preferences, Org General, Org Billing
- Account tab shows user info, email, danger zone
- Preferences tab shows units/theme settings
- Uses shared modal shell (`.modal-overlay`, `.modal`)

**Key Functions:**
- `open(tab)` - Creates overlay, mounts to `#modal-root`, renders specified tab
- `close()` - Removes overlay, calls cleanup
- `setActive(tab)` - Switches active tab, re-renders
- `render()` - Re-renders left nav + right pane based on `settingsActiveTab`
- `getCurrentUserView(profile)` - Computes user display data (name, initials, email)

**Key Selectors/Classes:**
- `.modal-overlay` - Full-screen overlay background
- `.modal` - Modal container
- `.tp3d-settings-modal` - Settings-specific modal wrapper
- `.tp3d-settings-left-pane` - Left navigation pane
- `.tp3d-settings-right-pane` - Right content pane
- `.tp3d-settings-account-btn` - Account button (duplicate of sidebar button)
- `.tp3d-settings-nav-wrap` - Nav items container
- `.tp3d-settings-nav-item` - Individual nav button (styled as `.nav-btn`)
- `.tp3d-settings-nav-header` - Section headers ("Account", "Organization")
- `.tp3d-settings-right-header` - Header with title + close button
- `.tp3d-settings-right-body` - Scrollable content area
- `.tp3d-settings-row` - Form row (label + value)
- `.tp3d-settings-danger` - Danger zone section
- `.tp3d-settings-card-max` - Full-width card in right pane

**Event Listeners:**
- `settingsOverlay.addEventListener('click', ...)` - Click outside to close
- `doc.addEventListener('keydown', onKeyDown)` - ESC to close
- `closeBtn.addEventListener('click', ...)` - Close button
- Each nav item: `btn.addEventListener('click', () => setActive(key))`
- Account button: Uses `getAccountSwitcher().bind(accountBtn, { align: 'left' })`

**Inline Styles Found:**
- ⚠️ **YES** - Lines 150-408 contain many inline `style=""` attributes in `innerHTML`
- Used for spacing, layout, flex, grid, colors
- Examples:
  - `style="display:flex;align-items:center;gap:var(--space-3);min-width:0"` (line 152)
  - `style="font-weight:var(--font-semibold);line-height:1.1"` (line 150)
  - `style="font-size:var(--text-sm);line-height:1.1"` (line 151)
  - Grid layouts, padding, borders in org/billing cards (lines 370-408)

**Shared Components:**
- AccountSwitcher (via `getAccountSwitcher()`) - dropdown bound to account button in left pane

---

### `src/ui/overlays/help-modal.js`
**Responsibilities:**
- Opens modal with Help content (export/import documentation)
- No state, purely informational

**Key Functions:**
- `open()` - Calls `UIComponents.showModal({ title, content, actions })`
- `close()` - Closes modal
- `isOpen()` - Returns modal state

**Key Selectors:**
- None (uses UIComponents modal factory)

**Event Listeners:**
- Modal close button via UIComponents actions

**Inline Styles:**
- ✅ None in JS (uses `innerHTML` with semantic CSS classes)

---

### `src/ui/overlays/import-app-dialog.js`
**Responsibilities:**
- Opens modal with file picker/drag-drop for app JSON import
- Validates JSON, confirms destructive operation, replaces StateStore data

**Key Functions:**
- `open()` - Creates modal with file input UI
- `handleFile(file, resultsEl, modal)` - Processes uploaded JSON
- Calls `ImportExport.parseAppImportJSON(text)`
- Calls `StateStore.replace(nextState)`
- Calls `Storage.saveNow()`

**Key Selectors:**
- None (uses UIComponents modal factory)

**Event Listeners:**
- File input change
- Drag/drop events on drop zone
- Modal action buttons

**Inline Styles Found:**
- ⚠️ **YES** - Lines 113-141 contain `.style.*` assignments
- Examples:
  - `content.style.display = 'grid'` (line 113)
  - `content.style.gap = '14px'` (line 114)
  - `drop.style.borderStyle = 'dashed'` (line 118)
  - `drop.style.background = 'var(--bg-elevated)'` (line 119)
  - `drop.style.textAlign = 'center'` (line 120)
  - `drop.style.padding = '22px'` (line 121)
  - `hint.style.fontSize = 'var(--text-sm)'` (line 136)
  - `results.style.display = 'none'` (line 141)
  - Dynamic border color changes on drag events (lines 161, 164, 168)

**Dependencies:**
- `ImportExport.parseAppImportJSON()`
- `StateStore.replace()`
- `Storage.saveNow()`
- `PreferencesManager.applyTheme()`

---

### `src/ui/overlays/import-pack-dialog.js` & `import-cases-dialog.js`
**Responsibilities:**
- Similar to import-app-dialog but for individual packs/cases
- Not directly involved in top bar, but share import patterns

**Inline Styles:**
- ⚠️ **YES** - Both files contain similar `.style.*` patterns for drop zones, results

---

### `src/services/import-export.js`
**Responsibilities:**
- UI-free service for import/export data processing
- `buildAppExportJSON()` - Serializes full app state to JSON
- `parseAppImportJSON(text)` - Validates and parses app JSON
- `buildCasesTemplateCSV()` - Generates CSV template
- `parseAndValidateSpreadsheet(file, existingCases)` - Parses CSV/XLSX for cases

**Key Functions:**
- `buildAppExportJSON()` - Returns JSON string with packLibrary, caseLibrary, preferences
- `parseAppImportJSON(text)` - Returns { packLibrary, caseLibrary, preferences }
- No DOM manipulation

**Dependencies:**
- `window.XLSX` (for spreadsheet parsing)
- `CaseLibrary.getCases()`
- `Utils.downloadText()`

---

### `src/ui/system-overlay.js`
**Responsibilities:**
- Fatal error overlay (CDN failures, boot errors)
- Pre-built HTML in index.html, controlled by JS
- Not part of Settings/Account, but shares overlay pattern

**Key Functions:**
- `show({ title, message, items })` - Displays error overlay
- `hide()` - Hides overlay

**Key Selectors:**
- `#system-overlay` - Overlay container
- `#system-title`, `#system-message`, `#system-list` - Content elements
- `#system-retry` - Retry button

**Event Listeners:**
- `retryBtn.addEventListener('click', () => window.location.reload())`

**Inline Styles:**
- ✅ None

---

### `styles/main.css`
**Responsibilities:**
- All CSS for app (single-file architecture)

**Account/Settings Related CSS:**

#### Account Dropdown (lines 202-415)
- `#btn-account-switcher` - Sidebar footer button
- `.account-section`, `.account-toggle` - Account UI wrappers
- `.account-avatar`, `.account-info`, `.account-name`, `.account-email` - Account button internals
- `.account-menu` - Dropdown menu
- `.account-item`, `.account-item-avatar`, `.account-item-info` - Dropdown items
- `.account-menu .btn`, `.account-menu hr` - Dropdown actions + dividers

#### Modal Shell (lines 1226-1274)
- `.modal-overlay` - Full-screen backdrop
- `.modal` - Modal container
- `.modal-header`, `.modal-title`, `.modal-body`, `.modal-footer` - Modal structure

#### Settings Overlay (lines 1276-1388)
- `.tp3d-settings-account-btn` - Account button in left pane
- `.tp3d-settings-nav-wrap` - Left nav container
- `.tp3d-settings-nav-header` - Nav section headers
- `.tp3d-settings-nav-item` - Nav buttons
- `.tp3d-settings-nav-icon` - Nav icons
- `.tp3d-settings-right-header` - Right pane header
- `.tp3d-settings-right-title` - Right pane title
- `.tp3d-settings-right-body` - Right pane scrollable content
- `.tp3d-settings-row` - Form row layout
- `.tp3d-settings-row-label` - Form labels
- `.tp3d-settings-danger`, `.tp3d-settings-danger-row`, `.tp3d-settings-danger-left`, `.tp3d-settings-danger-right` - Danger zone layout
- `.tp3d-settings-danger-msg`, `.tp3d-settings-danger-warn-icon` - Warning messages
- `.tp3d-settings-card-max` - Full-width card
- `.tp3d-settings-modal` - Settings-specific modal wrapper
- `.tp3d-settings-left-pane`, `.tp3d-settings-right-pane` - Two-column layout

#### System Overlay (lines 1620-1680)
- `.system-overlay` - Error overlay container
- `.system-overlay.active` - Visible state
- `.system-content`, `.system-icon`, `.system-title`, `.system-message`, `.system-list` - Error UI elements

**No Duplicates Found:**
- ✅ All Settings/Account CSS exists only in main.css
- ✅ No conflicting selectors
- ✅ No leftover inline styles in main.css itself

---

## 3. Dependencies / Risk Notes

### What Could Break If Moved

#### Moving Export/Import/Help into Settings
**Risks:**
- ⚠️ **Button HTML removal** - If `#btn-export-app`, `#btn-import-app`, `#btn-help` are removed from topbar, `wireGlobalButtons()` will fail (lines 2026-2028)
  - **Mitigation:** Move button wiring into Settings overlay render, create new buttons inside Settings right pane
- ⚠️ **Deep linking** - No evidence of URL-based deep links, but users may expect topbar buttons
  - **Mitigation:** Add "⋮" overflow menu in topbar, move buttons there
- ✅ **No state dependencies** - Export/Import/Help are stateless, can be moved safely
- ✅ **No shared components** - Each uses independent modal factories

#### Moving Updates/Roadmap to Secondary Area
**Risks:**
- ⚠️ **Nav button removal** - If `[data-nav="updates"]`, `[data-nav="roadmap"]` are removed, AppShell nav wiring breaks (lines 741-750)
  - **Mitigation:** Keep nav buttons but move to footer, or create new "Resources" dropdown
- ⚠️ **Screen visibility** - `#screen-updates`, `#screen-roadmap` must remain in DOM for AppShell.renderShell() (lines 765-792)
  - **Mitigation:** Keep screens, just hide nav buttons from primary sidebar
- ✅ **No state dependencies** - Static data arrays, no user interaction beyond viewing
- ✅ **No API calls** - Static content only

#### Account vs Settings Separation
**Risks:**
- ⚠️ **Duplicate account button** - Settings left pane has account button (lines 150-162), sidebar footer has account button (index.html line 267)
  - **Shared logic:** Both use `getAccountSwitcher().bind(buttonEl)` pattern
  - **Risk:** If Account becomes separate modal, AccountSwitcher dropdown must work in both contexts
  - **Mitigation:** Keep AccountSwitcher as shared component, bind to both buttons
- ⚠️ **Tab navigation** - Settings overlay uses `settingsActiveTab` state (lines 30, 121)
  - **Risk:** If Account becomes separate overlay, tab system must be refactored or removed
  - **Mitigation:** Make Account a top-level modal (no tabs), keep Preferences as Settings with tabs
- ✅ **No cross-tab dependencies** - Account tab doesn't reference Preferences data

### Event Listener Duplication Risks
**Current State:**
- ✅ Settings overlay cleanup properly removes `keydown` listener (line 451)
- ✅ AccountSwitcher uses single instance, binds to multiple buttons safely
- ✅ No evidence of duplicate modal mounts (modal-root cleared before append)

**Potential Issues:**
- ⚠️ If Account becomes separate modal, both Account + Settings must handle ESC key without conflict
  - **Mitigation:** Use modal stack pattern (close most recent first)
- ⚠️ Account button in Settings left pane opens dropdown, not Account modal
  - **Current behavior:** Opens AccountSwitcher dropdown (workspace switcher)
  - **Expected behavior:** May conflict if Account becomes separate modal trigger

### Shared Components Between Account/Settings
**Shared:**
- ✅ AccountSwitcher dropdown (workspace switcher) - bound to both sidebar button and Settings account button
- ✅ Modal shell (`.modal-overlay`, `.modal`) - used by all modals

**Isolated:**
- ✅ Account tab content (user info, email, danger zone) - isolated to Settings overlay
- ✅ Preferences tab content (units, theme) - isolated to Settings overlay
- ✅ No shared form state between tabs

**Must Stay Stable:**
- ✅ AccountSwitcher module (lines 220-342) - must continue working with multiple button instances
- ✅ `UIComponents.showModal()` factory - must handle multiple modals without conflict
- ✅ `#modal-root` container - must support stacking or sequential modals

---

## 4. Recommended Minimal Change Plan

**Phase 0: Isolate Modal Shell**
- ✅ **Already isolated** - `.modal-overlay`, `.modal` in main.css (lines 1226-1274)
- ✅ **UIComponents.showModal()** factory handles all modals
- ✅ **No action required** - modal infrastructure is stable

**Phase 1: Move Topbar Buttons into Settings (Recommended First Step)**
1. **Keep topbar buttons for now** - Add "Resources" dropdown in topbar (⋮ icon)
2. **Duplicate buttons in Settings** - Add "Export", "Import", "Help" to Settings right pane as new tab
3. **Test both paths** - Ensure export/import work from both topbar and Settings
4. **Remove topbar buttons** - Once Settings path is validated, remove topbar buttons
5. **Update wireGlobalButtons()** - Move button wiring into Settings overlay render

**Files to Modify (Phase 1):**
- `src/ui/overlays/settings-overlay.js` - Add new "Resources" tab with Export/Import/Help buttons
- `src/app.js` - Remove `wireGlobalButtons()` calls, move logic into Settings overlay
- `index.html` - Remove topbar buttons OR wrap in "⋮" dropdown
- `styles/main.css` - No changes required (reuse existing button styles)

**Risk Level: LOW** - Export/Import/Help are stateless, can coexist in both locations during migration

---

**Phase 2: Separate Account from Settings**
1. **Create new `account-overlay.js`** - Extract Account tab logic from settings-overlay.js
2. **Update AccountSwitcher** - Add "Account" link to dropdown (currently shows "Settings")
3. **Test both modals** - Ensure Account + Settings can open independently
4. **Remove Account tab from Settings** - Delete Account nav item, keep only Preferences/Org tabs
5. **Rename "Settings" to "Preferences"** - Update UI labels for clarity

**Files to Modify (Phase 2):**
- `src/ui/overlays/account-overlay.js` - **NEW FILE** - Extract Account tab logic
- `src/ui/overlays/settings-overlay.js` - Remove Account tab, rename to Preferences
- `src/app.js` - Instantiate both Account + Settings overlays
- `index.html` - No changes (modals mount to `#modal-root`)
- `styles/main.css` - Rename `.tp3d-settings-*` classes to `.tp3d-preferences-*`, add `.tp3d-account-*`

**Risk Level: MEDIUM** - Requires modal stacking logic, ESC key handling, duplicate button management

---

**Phase 3: Demote Updates/Roadmap to Secondary Area**
1. **Move nav buttons to footer** - Relocate Updates/Roadmap nav buttons below account switcher
2. **OR: Create "Resources" dropdown** - Add "Resources" dropdown in topbar, include Updates/Roadmap links
3. **Keep screens in DOM** - No changes to `#screen-updates`, `#screen-roadmap`
4. **Update AppShell nav wiring** - Handle new button locations

**Files to Modify (Phase 3):**
- `index.html` - Move nav buttons to sidebar footer OR topbar dropdown
- `src/app.js` - Update AppShell nav button selector (currently `[data-nav]`)
- `styles/main.css` - Add footer nav styles OR dropdown styles

**Risk Level: LOW** - No state dependencies, purely UI reorganization

---

## 5. CSS Inline Styles Audit

**Inline Styles Found in JS:**

### High Priority (Import/Export Dialogs)
- `src/ui/overlays/import-app-dialog.js` - Lines 113-141, 161-168 (`.style.*` for drop zone, results)
- `src/ui/overlays/import-pack-dialog.js` - Similar pattern
- `src/ui/overlays/import-cases-dialog.js` - Lines 26, 44-45, 67-69, 90-91 (`.style.*` for layout)

**Recommendation:**
- ✅ **Extract to main.css** - Create `.tp3d-drop-zone`, `.tp3d-import-results`, `.tp3d-import-hint` classes
- ✅ **Use CSS classes for state** - Replace `drop.style.borderColor` with `.tp3d-drop-zone.is-dragover`

### Medium Priority (Settings Overlay)
- `src/ui/overlays/settings-overlay.js` - Lines 150-408 (inline `style=""` in `innerHTML`)

**Recommendation:**
- ⚠️ **Low impact** - Uses design tokens (`var(--space-3)`, `var(--font-semibold)`)
- ⚠️ **Template-based** - Inline styles in `innerHTML` strings, not `.style.*`
- ✅ **Consider extracting** - Create `.tp3d-settings-account-btn-content`, `.tp3d-settings-org-card` classes
- ✅ **Not blocking** - Can be refactored after Phase 2

### Clean Files
- ✅ `src/ui/system-overlay.js` - No inline styles
- ✅ `src/ui/overlays/help-modal.js` - No inline styles (uses `innerHTML` with CSS classes only)

---

## 6. Summary

**Audit Status:** ✅ COMPLETE - NO CODE CHANGES MADE

**Files Audited:** 11 files (5 JS modules, 1 HTML, 1 CSS, 4 import dialogs)

**Inline Styles Found:**
- ⚠️ **3 files** - import-app-dialog.js, import-cases-dialog.js, settings-overlay.js
- **Recommendation:** Extract to main.css before Phase 1

**Safe to Proceed:**
- ✅ All features isolated (no circular dependencies)
- ✅ Modal infrastructure stable
- ✅ AccountSwitcher reusable across multiple buttons
- ✅ Export/Import/Help stateless (can move safely)
- ✅ Updates/Roadmap static (can demote safely)

**Recommended Order:**
1. ✅ **Inline styles cleanup** (1-2 hours)
2. ✅ **Phase 1: Move Export/Import/Help** (3-4 hours)
3. ✅ **Phase 2: Separate Account from Settings** (4-6 hours)
4. ✅ **Phase 3: Demote Updates/Roadmap** (1-2 hours)

**Total Estimated Effort:** 10-15 hours

---

**End of Audit Report**
