# CSS Audit — main.css (PHASE 1)

Scope: `styles/main.css` (only). This is an audit-only report; no CSS changes applied yet.

## 1) Summary — key risks + quick wins
- **Key risks:** multiple selectors are duplicated across base and responsive sections (e.g. `.tp3d-settings-modal`, `.modal`, `.modal-body`), which creates order-dependent overrides; a handful of stateful selectors (`.active`, `.open`, `.is-hidden`, `[data-*]`) are JS-driven and must be preserved.
- **Quick wins:** consolidate repeated typography blocks (`font-size: var(--text-sm)` and variants), normalize repeated layout blocks (`display: grid; gap: X`), and merge duplicate selectors that differ only in media queries into structured overrides.
- **Lint note:** stylelint currently flags duplicate selectors (e.g. `.tp3d-settings-modal`). This is purely organization/duplication risk, not necessarily a visual bug.

## 2) Unused selector candidates (grouped by component/area)
Heuristic scan (CSS selectors vs. JS/HTML usage). These are **candidates only** and must be confirmed before deletion. Some may be dynamically generated.

### Account-related
- `.account-*`: `account-avatar`, `account-chevron`, `account-email`, `account-info`, `account-item`, `account-item-avatar`, `account-item-check`, `account-item-info`, `account-item-name`, `account-item-role`, `account-menu`, `account-name`, `account-section`, `account-toggle`
- `.tp3d-account-*`: `tp3d-account-delete-form`, `tp3d-account-delete-input`, `tp3d-account-delete-input-row`

### Settings-related
- `.tp3d-settings-*`: `tp3d-settings-delete-confirm-label`, `tp3d-settings-delete-confirm-row`, `tp3d-settings-delete-desc`, `tp3d-settings-org`, `tp3d-settings-org-divider`, `tp3d-settings-org-logo`, `tp3d-settings-org-rows`, `tp3d-settings-org-title`, `tp3d-settings-tab`, `tp3d-settings-tabs`

### Search / Nav / Misc
- `.search-*`: `search-hint`, `search-icon`
- `.brand-*`: `brand-sub`
- `.btn-*`: `btn-create`
- `.editor-*`: `editor-mode`
- State classes: `is-asc`, `is-desc`, `is-hidden`, `open`

### Trial-related
- `.trial-*`: `trial-card`, `trial-row`, `trial-sub`, `trial-title`

### Data-* selectors
- `[data-variant]` was flagged as unused by the scanner **but is set via `dataset.variant` in JS**, so treat as **used/high‑risk**.

## 3) Duplication list (exact selectors + repeated blocks)
Below are repeated declaration blocks (identical property/value sets), which can be consolidated into shared utilities or grouped selectors:

- **Small text block** (10 selectors share `font-size: var(--text-sm)` or equivalent):
  - `#packs-selected-count`, `#cases-selected-count`, `.tp3d-organization-notice-text`, `.tp3d-delete-confirm-label`, `.tp3d-pack-dialog-empty`, `.tp3d-export-app-blurb`, `.tp3d-export-app-meta-file`, `.tp3d-import-summary-meta`, `.tp3d-cases-muted-sm`, `.tp3d-editor-sub-sm`, `.tp3d-editor-fs-sm`

- **Hover background for interactive items**:
  - `.account-toggle:hover`, `.account-menu .btn.btn-create:hover`, `.table-footer .tf-btn:hover:not(:disabled)`, `.dropdown-item.is-active`, `.dropdown-item:hover`, `.toast-btn:hover`, `.toolbar-btn:hover`

- **Full-width control patterns**:
  - `.tp3d-editor-select-full`, `.tp3d-editor-field-wrap-full`, `.tp3d-editor-btn-full`, `.tp3d-cases-catmgr-add-full`, `.modal-footer .btn`, `.tp3d-account-actions .btn`

- **Grid/gap patterns**:
  - `.grid`, `.tp3d-organization-grid`, `.tp3d-updates-wrap`, `.tp3d-delete-modal-content`

- **Row gap 10 patterns**:
  - `#editor-case-list`, `.tp3d-roadmap-card-header`, `.tp3d-pack-dialog-content`, `.tp3d-editor-row-gap-10`

- **Danger color / icon emphasis**:
  - `.dropdown-item[data-variant='danger']`, `.dropdown-item[data-variant='danger'] i`, `.tp3d-import-warning i`, `.tp3d-cases-catmgr-del-color`

## 4) Specificity & conflict list
### Top 20 highest-specificity selectors (and what they override)
(Highest specificity tends to “win” in conflicts.)
1) `#screen-packs.active` — controls active screen state (likely display/visibility)
2) `#screen-cases.active` — same as above
3) `#screen-packs > .table-footer` — overrides `.table-footer` within packs screen
4) `#screen-cases > .table-footer` — overrides `.table-footer` within cases screen
5) `#packs-filter-chip-partial .chip-dot` — overrides `.chip-dot` in packs filter
6) `#packs-filter-chip-full .chip-dot` — overrides `.chip-dot` in packs filter
7) `#btn-account-switcher` — account switcher button style override
8) `#screen-packs` — base packs screen layout overrides
9) `#screen-cases` — base cases screen layout overrides
10) `#screen-editor` — base editor screen layout overrides
11) `#packs-selected-count` — selected count style override
12) `#cases-selected-count` — selected count style override
13) `#cases-filters` — filters area overrides
14) `#editor-case-chips` — chips container overrides
15) `#editor-case-list` — list container overrides
16) `#updates-list` — updates list layout overrides
17) `#roadmap-list` — roadmap list layout overrides
18) `#toast-container` — toast container layout overrides
19) `#viewport` — canvas viewport base rules
20) `.table-footer .tf-btn:hover:not(:disabled)` — high‑specificity hover state

### Conflicting rules for the same selectors (order-dependent)
These selectors have multiple definitions with different values (often due to responsive overrides):
- `.app` (grid-template-columns changes between desktop and collapsed)
- `.pack-grid` (grid-template-columns changes for different layouts)
- `.table-footer`, `.table-footer .tf-mid`, `.table-footer .tf-right` (gap/justify-content vary)
- `.modal` (width/max-width/border-radius/margin vary across responsive rules)
- `.modal-body` (max-height varies across responsive rules)
- `.tp3d-settings-modal` (width/height/grid-template-columns differ across breakpoints; duplicate selector inside same media block)
- `.tp3d-settings-left-pane`, `.tp3d-settings-right-body` (padding/borders change on mobile)
- `.tp3d-settings-danger-*` (grid-template-columns and alignments change on mobile)
- `.editor-shell` (grid-template and custom properties shift at breakpoints)
- `.viewport-toolbar` (background changes in @supports block)
- `.panel.right` (transform differs between open/closed states)

### !important usage
- **None found.**

### Risky order-dependent patterns
- Responsive overrides for `.modal`, `.modal-body`, `.tp3d-settings-modal` are scattered in multiple media queries. Functionally correct, but the duplicate selectors create fragile ordering.

## 5) Layout/scroll/overflow risks
Potential clipping or scroll issues:
- `.panel { overflow: hidden; }` with `.panel-body { overflow: auto; }` — safe if `.panel-body` is always present; otherwise panel content may clip.
- `.modal { overflow: hidden; }` with `.modal-body` max-height rules in responsive sections — safe but order-dependent across breakpoints.
- `.editor-shell { height: calc(100vh - 58px); }` — fixed-height layout can clip if inner panels don’t allow overflow.
- `.tp3d-settings-modal` uses fixed height with `overflow: hidden` — relies on inner panes to scroll.
- `.viewport-toolbar` is `position: absolute` and uses `backdrop-filter`; ok but can overlay content.

Selectors controlling overlay/panel scroll:
- `.panel-body` (overflow: auto)
- `.modal-body` (max-height in responsive rules)
- `.tp3d-settings-right-pane` (overflow: hidden) + `.tp3d-settings-right-body` (scrollable content)

## 6) Performance flags
- **Universal selector:** `* { box-sizing: border-box; }` is standard; acceptable.
- **Deep descendant selectors:** limited; examples include `.table-footer .tf-btn:hover:not(:disabled)` and `#packs-filter-chip-full .chip-dot`.
- **Heavy box-shadow:** multiple components use shadows (`var(--shadow-lg)`, `var(--shadow-md)`), but applied to limited containers (cards/modals/toasts), not in large lists.
- **Layout-affecting transitions:** none detected (no width/height/top/left transitions).

## 7) Security sanity check (CSS-only)
- **url() usage:** none found.
- **javascript: / expression():** none found.
- **Security theater:** `.visually-hidden` hides content but is conventional; no “security by CSS” patterns observed.

## 8) Proposed refactor plan (low risk)
1) **Deduplicate selectors:** merge repeated blocks into grouped selectors (e.g. text size utilities, hover backgrounds, grid/gap utilities).
2) **Normalize responsive overrides:** consolidate `.modal` and `.tp3d-settings-modal` overrides into a single, clearly ordered responsive section to reduce conflicts.
3) **Extract common utilities:** introduce small utility classes for frequent patterns (`.text-sm`, `.grid-gap-10`, `.row-gap-10`, `.fw-semibold`) and replace repeated blocks where already in use.
4) **Remove verified unused selectors:** only after manual confirmation in JS/HTML/runtime (especially for dynamic class names).
5) **Reorder sections:** group by component (Base > Layout > Components > Utilities > TP3D-specific > Responsive), keeping overrides localized.

---
End of PHASE 1. Awaiting approval to proceed with PHASE 2 (apply fixes).

## PHASE 2 — Changes Applied

1) **Restructured file order with top-level section headers** to match the requested sequence (01–07), and regrouped existing sections under those headers without changing selector names.
2) **Consolidated hover background styles** into a single grouped rule.
   - Before: `.account-toggle:hover`, `.account-menu .btn.btn-create:hover`, `.table-footer .tf-btn:hover:not(:disabled)`, `.dropdown-item.is-active`, `.dropdown-item:hover`, `.toast-btn:hover`, `.toolbar-btn:hover`
   - After: one grouped block in **06 Utilities** setting `background: var(--bg-hover);`
3) **Consolidated repeated “small text” font-size rules** into a single grouped rule.
   - Before: `#packs-selected-count`, `#cases-selected-count`, `.tp3d-organization-notice-text`, `.tp3d-delete-confirm-label`, `.tp3d-pack-dialog-empty`, `.tp3d-export-app-blurb`, `.tp3d-export-app-meta-file`, `.tp3d-import-summary-meta`, `.tp3d-cases-muted-sm`, `.tp3d-editor-sub-sm`, `.tp3d-editor-fs-sm`
   - After: one grouped block in **06 Utilities** setting `font-size: var(--text-sm);`
4) **Consolidated repeated grid/gap patterns** for identical layout blocks.
   - Before: `.grid`, `.tp3d-organization-grid`, `.tp3d-updates-wrap`, `.tp3d-delete-modal-content` each defined separately
   - After: one grouped block in **06 Utilities** setting `display: grid; gap: var(--space-4);`
5) **Consolidated repeated `gap: 10px` rules**.
   - Before: `#editor-case-list`, `.tp3d-roadmap-card-header`, `.tp3d-pack-dialog-content`, `.tp3d-editor-row-gap-10` each defined separately
   - After: one grouped block in **06 Utilities** setting `gap: 10px;`
6) **Consolidated full‑width control rules** for the editor form helpers.
   - Before: `.tp3d-editor-select-full`, `.tp3d-editor-field-wrap-full`, `.tp3d-editor-btn-full` each defined separately
   - After: one grouped block in **06 Utilities** setting `width: 100%;`
7) **Moved generic utilities into the Utilities section**: `.row`, `.row.space-between`, `.muted`, `.grid`, `.tp3d-grid-span-full`, `.tp3d-flex-1`, `.tp3d-textarea-minh-48`, `.tp3d-textarea-minh-60`.
8) **Removed duplicate selector block inside the same breakpoint**.
   - Before: `.tp3d-settings-modal` appeared twice under `@media (max-width: 1024px)`
   - After: combined into a single block in that breakpoint.

Selectors considered for removal but kept:
- **Account / Trial / Search / Settings helper selectors** flagged as unused by the static scan (e.g., `.account-*`, `.trial-*`, `.search-*`, `.tp3d-settings-*`). Kept due to possible runtime usage or planned UI states.
- **`[data-variant]`** kept because it is set dynamically by JS (`dataset.variant`).

Risk notes / rollback hints:
- If any spacing or hover behavior changes, revert the grouped rules in `styles/main.css` under **06 Utilities**.
- If responsive behavior changes, revert the **07 Responsive Overrides** ordering and compare with the previous layout blocks in `styles/main.css`.
- The safest rollback is to revert `styles/main.css` and keep the audit additions in `docs/css-audit-main-css.md`.
