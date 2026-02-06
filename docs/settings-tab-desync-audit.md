# Settings Overlay Tab Desync Audit

Date: 2026-02-04
Updated: 2026-02-05

## 1) Symptom summary (observed)

- Console checks occasionally show **2 dialogs in DOM** and **0 settings tablists**.
- Debug logs show `dialogCount: 2` while `settingsModalCount: 1`.
- The Settings overlay sometimes **re-renders multiple times** after open (auth rehydrate + bundle load), and can be **closed on auth events**.

Key point: multiple `.modal` elements can be expected (auth overlay, confirm modals, import modals). The *correct Settings overlay instance* is the element with `data-tp3d-settings-modal="1"`.

---

## 2) Inventory: overlays / modals (with DOM markers)

### Settings overlay (the one we care about)
- **File:** `src/ui/overlays/settings-overlay.js`
- **Create function:** `createSettingsOverlay(...)` (line 38)
- **Open creates:** `div.modal-overlay` + `div.modal.tp3d-settings-modal` (lines 2143–2164)
- **Markers:**
  - `SETTINGS_MODAL_ATTR = 'data-tp3d-settings-modal'` (line 71)
  - `SETTINGS_INSTANCE_ATTR = 'data-tp3d-settings-instance'` (line 72)
  - `settingsModal.setAttribute(SETTINGS_MODAL_ATTR, '1')` (line 2150)
  - `settingsModal.setAttribute(SETTINGS_INSTANCE_ATTR, String(instanceId))` (line 2151)
- **Role:** `role="dialog"` + `aria-modal="true"` (lines 2152–2153)
- **Append:** `#modal-root` or `document.body` (lines 2201–2209)

### Account overlay (potentially confusing)
- **File:** `src/ui/overlays/account-overlay.js`
- **Open creates:** `div.modal-overlay` + `div.modal tp3d-settings-modal` (lines 538–549)
- **Delete confirm modal also uses `modal tp3d-settings-modal`** (line 113)
- **Role:** `role="dialog"` + `aria-modal="true"` (lines 117–118, 545–546)

**Important overlap:** Account overlay reuses the **same class** `tp3d-settings-modal` but **does NOT set** `data-tp3d-settings-modal="1"`. This makes `.tp3d-settings-modal` an unreliable selector for “Settings overlay”.

### Auth overlay
- **File:** `src/ui/overlays/auth-overlay.js`
- **Mounts:** `div.modal-overlay` + `div.modal` (lines 129–144)
- **Markers:** `data-auth-overlay="1"` (line 131)
- **Role:** `role="dialog"` + `aria-modal="true"` (lines 137–138)

### Help modal
- **File:** `src/ui/overlays/help-modal.js`
- **Creates:** via `UIComponents.showModal(...)` (lines 34–52)
- **Markers:** `UIComponents.showModal` creates `.modal-overlay` + `.modal` (see below)

### Import dialogs (all use `UIComponents.showModal`)
- **File:** `src/ui/overlays/import-app-dialog.js` (line 172)
- **File:** `src/ui/overlays/import-pack-dialog.js` (line 129)
- **File:** `src/ui/overlays/import-cases-dialog.js` (line 129)

### Generic modal builder
- **File:** `src/ui/ui-components.js`
- **Function:** `showModal(config)` (lines 99–175)
- **Creates:** `div.modal-overlay` + `div.modal` (lines 99–104)

### Screens using `showModal`
- **Packs:** `src/screens/packs-screen.js` (lines 983, 1160, 1215)
- **Cases:** `src/screens/cases-screen.js` (lines 909, 1055, 1203)
- **App:** `src/app.js` (lines 1983, 2268, 2341)
- **Account switcher:** `src/ui/components/account-switcher.js` (lines 69–74)

### Non-modal overlays
- **System overlay:** `src/ui/system-overlay.js` uses `#system-overlay` with `.active` class (lines 14–40)
- **Card display overlay:** `src/ui/overlays/card-display-overlay.js` uses dropdowns (`data-dropdown`) (lines 36–63)

**Conclusion:** Multiple `.modal` elements in DOM are *normal* (auth overlay, confirm modals, import dialogs, etc.). Only `[data-tp3d-settings-modal="1"]` uniquely identifies the Settings overlay.

---

## 3) The correct Settings overlay root marker (single source of truth)

- **Attribute name:** `data-tp3d-settings-modal` (settings-overlay.js line 71)
- **Instance attribute:** `data-tp3d-settings-instance` (line 72)
- **Set on open:** lines 2150–2151

**Correct selector:**
```
[data-tp3d-settings-modal="1"]
```

**Avoid:** `.tp3d-settings-modal` alone, because Account overlay uses that class too (account-overlay.js lines 113, 542).

---

## 4) Tab system call graph (real map with file/line references)

### Tab state mutators (Settings overlay)
- `setActiveTab(tabId, meta)` — **line 580**
  - Updates `_tabState.activeTabId`, calls `persistTab`, triggers `render()`.
- `setActive(tab)` — **line 605**
  - Public wrapper -> `setActiveTab`.
- `bindTabsOnce()` click handler — **line 609**
  - Increments `_tabState.lastActionId` and calls `setActiveTab` (line 621).
- `open(tab)` — **lines 2122–2229**
  - Calls `setActiveTab(nextTab, { source: 'open' })` (lines 2126 & 2221).

### Tab persistence
- `TAB_STORAGE_KEY = 'tp3d:settings:activeTab'` — line 70
- `readSavedTab()` — lines 544–553
- `persistTab()` — lines 556–564
- `resolveInitialTab()` — lines 566–569

### DOM markers for tabs
- Nav wrapper: `navWrap.dataset.settingsTabs = '1'` + `role="tablist"` — lines 1054–1058
- Tab buttons: `btn.dataset.tab = key` — line 1095
- Panel: `body.setAttribute('data-tab-panel', _tabState.activeTabId)` — line 1234

### Entry points into Settings overlay
- `openSettingsOverlay(tab)` in `src/app.js` — lines 440–452
  - Calls `SettingsOverlay.open(tab)` (line 448)
  - Immediately triggers `rehydrateAuthState({ reason: 'settings-open' })` (line 452)
- Account switcher menu triggers Settings overlay:
  - `src/ui/components/account-switcher.js` line 85–87

### Auth-driven flows that affect overlay
- `SettingsOverlay.handleAuthChange(event)` is called from `renderAuthState` — `src/app.js` lines 2662–2663
- `SettingsOverlay.handleAuthChange(reason)` is called in `rehydrateAuthState` — `src/app.js` lines 2600–2601
- **SettingsOverlay is closed on ANY auth change** — `src/app.js` line 3025

**Implication:** A tab click can be followed by a render or close triggered by auth rehydration or auth change events.

---

## 5) Binding + duplicate instance risks

### Binding lifecycle
- `bindTabsOnce()` attaches **one** delegated click handler to `settingsLeftPane` (lines 609–624).
- Guard: `_tabState.didBind` prevents re-binding (line 610–612).
- `_tabState.didBind` reset on close (line 513) and when stale overlay is detected (lines 2131–2138).

**Conclusion:** within a single overlay instance, tab bindings should not duplicate. New instance -> new binding, which is expected.

### Modal instance lifecycle
- `cleanupStaleSettingsModals('open')` removes any stale roots that match `[data-tp3d-settings-modal="1"]` (lines 143–165).
- Account overlay uses `.tp3d-settings-modal` but **does not** set data attribute; it will **not** be removed by cleanup.

**Risk:** If a Settings overlay instance is created without `data-tp3d-settings-modal="1"` (e.g., partial DOM construction before attr set), cleanup may not find it. No evidence of this currently, but it’s a potential gap.

### Multiple modals in DOM are normal
- Auth overlay (`data-auth-overlay`) always uses `.modal` with role=dialog (auth-overlay.js lines 129–138).
- `UIComponents.showModal()` creates `.modal` with no settings-specific marker (ui-components.js lines 99–104).
- Delete account confirmation inside Settings overlay calls `UIComponents.showModal` (settings-overlay.js line 1668).

**Result:** `document.querySelectorAll('.modal')` or `[role="dialog"]` can return >1 even without duplicate Settings overlays.

---

## 6) Most likely overwrite sequences (ranked hypotheses)

### Hypothesis 1 — Auth rehydrate closes/reopens Settings overlay
**Evidence:**
- `openSettingsOverlay()` calls `rehydrateAuthState({ reason: 'settings-open' })` immediately after `SettingsOverlay.open` (app.js lines 440–452).
- `renderAuthState` closes Settings overlay on **any** auth change (app.js line 3025).

**Impact:** Token refresh / auth change events (especially in multi-tab) can close the Settings overlay right after a tab click, which looks like tab state reset.

**Suggested debug log location (if needed):**
- app.js around `openSettingsOverlay` and auth change handler (lines 440–452, 3023–3026):
  - log `{ reason, event, overlayOpen, activeTab }`.

### Hypothesis 2 — Wrong modal is being inspected / manipulated
**Evidence:**
- Account overlay uses `.tp3d-settings-modal` class (account-overlay.js lines 113 & 542).
- Settings overlay uses `data-tp3d-settings-modal="1"` (settings-overlay.js line 2150).

**Impact:** Console or debug tools using `.tp3d-settings-modal` may target account overlay or confirmation modal, not Settings overlay. This can make “tablist not found” or “buttons=0” look like a desync when it’s just the wrong root.

**Suggested debug log location:**
- settings-overlay.js `debugSettingsModalSnapshot` already logs dialogCount and settingsModalCount (line 101–119). The critical selector should be `[data-tp3d-settings-modal="1"]` only.

### Hypothesis 3 — Async loadAccountBundle triggers render after click
**Evidence:**
- `loadAccountBundle()` is called inside `render()` for account and org tabs (lines 1366–1370, 1832–1838).
- `renderIfFresh` does guard stale actionId, but **`refreshAccountUI()` calls `render()` directly** (line 2235).
- `refreshAccountUI()` is called from `handleAuthChange` (line 2260–2264) and from `rehydrateAuthState` (app.js lines 2593–2601).

**Impact:** a post-click auth rehydrate can trigger `render()` without actionId guard. It doesn’t change `_tabState`, but can re-render nav/panel in the middle of user interaction.

**Suggested debug log location:**
- settings-overlay.js `refreshAccountUI()` (line 2235) to log `activeTabId` and `lastActionId`.

### Hypothesis 4 — Multiple modal overlays are created by other flows
**Evidence:**
- Many screens use `UIComponents.showModal` (packs-screen.js lines 983, 1160, 1215; cases-screen.js lines 909, 1055, 1203; app.js lines 1983, 2268, 2341; account-switcher.js lines 69–74).

**Impact:** `.modal` count >1 is expected. If tooling assumes modal count means duplicate Settings overlays, that’s a false positive.

---

## 7) Existing debug hooks & missing call sites

### Existing debug calls (settings-overlay.js)
- `debugSettingsModalSnapshot(...)`:
  - bindTabsOnce (line 633)
  - render (line 2118)
  - open:created / open:reuse (lines 2222, 2127)
  - close (line 521)
- `debugTabSnapshot(...)`:
  - setActiveTab (line 602)
  - render (line 2117)
  - open:created / open:reuse (lines 2223, 2128)

### Missing or weak call sites
- No debug log when `SettingsOverlay.close()` is triggered by auth changes in app.js. This hides the “overlay closed by auth event” sequence.
- No tab snapshot on `refreshAccountUI()` (line 2235) or `handleAuthChange()` (line 2259).

---

## 8) Repro checklist + console checks

### Repro checklist
1. Open Settings overlay.
2. Click tabs rapidly (Account → Preferences → Organization).
3. Close overlay.
4. Reopen overlay.
5. Trigger auth event (sign out/in, token refresh, or open in second tab).
6. Confirm nav highlight matches visible panel.

### Console checks (correct selectors)
```js
// count Settings overlay roots (single source of truth)
document.querySelectorAll('[data-tp3d-settings-modal="1"]').length;

// inspect current Settings overlay instance
(() => {
  const root = document.querySelector('[data-tp3d-settings-modal="1"]');
  if (!root) return 'no settings modal';
  return {
    instance: root.getAttribute('data-tp3d-settings-instance'),
    buttons: root.querySelectorAll('[data-tab]').length,
    panels: root.querySelectorAll('[data-tab-panel]').length,
    activeBtn: root.querySelector('[data-tab].active')?.getAttribute('data-tab'),
    activePanel: root.querySelector('[data-tab-panel]:not([hidden])')?.getAttribute('data-tab-panel'),
  };
})();
```

---

## 9) Next action recommendation (smallest likely fix)

**Smallest likely fix to test first (no refactor):**
1. **Stop closing Settings overlay for token refresh events** (app.js line 3025): only close on user-initiated SIGNED_OUT or user switch. This prevents the overlay from being torn down mid-click.
2. **Use the correct root selector** (`[data-tp3d-settings-modal="1"]`) in all debugging tools and any cleanup routines; avoid `.tp3d-settings-modal` alone.
3. **Rename the Account overlay class** from `tp3d-settings-modal` to `tp3d-account-modal` to eliminate selector ambiguity, or add a unique data attribute (e.g., `data-tp3d-account-modal="1"`).

These changes are minimal, should reduce tab desync reports, and remove confusion caused by multiple modal instances.
