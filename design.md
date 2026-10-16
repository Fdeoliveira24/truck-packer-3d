# Cargo Planner 3D — UI/UX Design System Contract

**Status: DRAFT — AWAITING OWNER REVIEW**

**Scope:** Application UI around Cases, Load Plans, Editor, Settings, and dialogs. Documentation only; no styling or behavior change is approved by this draft.

**Source baseline:** `origin/main` at `2c4f0f0` (2026-10-15). The shipped UI still uses **Truck Packer 3D** in `index.html`; product naming is a separate decision.

## 1. Purpose and product direction

Cargo Planner 3D is a professional, data-dense logistics workspace. Its visual language should be modern, clean, practical, and consistent: readable operational data, clear action priority, predictable controls, and efficient use of space. A premium feel comes from disciplined typography, alignment, surfaces, and feedback rather than decoration. Cases, Load Plans, Editor, Settings, and dialogs should look related without erasing their task-specific layouts.

Preserve the recognizable orange-accent identity and current interaction contracts until a separate design change is approved. This document describes the current source, proposes standards for owner review, and records open decisions. It does not certify accessibility, declare every existing screen consistent, or authorize a redesign.

**Status key:** **Current** means verified in production source. **Proposed** means guidance for a later approved implementation. **Unresolved** means a product/design choice or audit finding still needs a decision. A proposed rule is not an existing token or feature.

## 2. Visual foundations

### 2.1 Color and theme — Current

`styles/main.css` defines the following CSS custom properties. Values below are the light (`:root`) values and, where present, the `[data-theme='dark']` override. An inherited value in dark mode is not a new dark token.

| Role | Light | Dark override |
|---|---|---|
| Canvas `--bg-primary` | `#f6f7fb` | `#121318` |
| Main surface `--bg-secondary` | `#ffffff` | `#1c1e26` |
| Elevated surface `--bg-elevated` | `#ffffff` | `#25252d` |
| Hover surface `--bg-hover` | `#f0f1f5` | `#2a2d39` |
| Primary / secondary / muted text | `--text-primary: #1a1a1f`; `--text-secondary: #6b6b78`; `--text-muted: #9b9ba8` | `#ffffff`; `#a0a0ab`; `#6b6b78` |
| Inverse text `--text-inverse` | `#ffffff` | `#1a1a1f` |
| Subtle / strong borders | `--border-subtle: #e6e8ef`; `--border-strong: #d1d3dd` | `#2a2d39`; `#3a3a47` |
| Brand accent | `--accent-primary: #ff9f1c`; hover `#ffb547`; pressed `#e88c0c` | Inherited from `:root` |
| On-accent text and readable accent | `--accent-foreground: #ffffff`; `--accent-readable: #9a5100` | On-accent inherited; readable `#ffbd66` |
| Accent overlays | `--accent-primary-12`, `--accent-primary-14`, `--accent-primary-25` use `rgb(255, 159, 28, alpha)` | Inherited |
| Success / warning / error / info | `--success: #10b981`; `--warning: #f59e0b`; `--error: #ef4444`; `--info: #3b82f6` | Inherited |
| Readable state text | `--success-readable: #047857`; `--warning-readable: #e87500`; `--danger-text: #b42318` | `#6ee7b7`; `#ffbd66`; `#ff7777` |
| Error interaction | `--error-hover: #dc2626`; `--error-pressed: #b91c1c` | Inherited |
| Focus | `--focus-ring: var(--accent-primary)` | Inherited |

The same stylesheet has separate `--util-*` colors for Space Utilization density and diagnostic display. Those are capacity-analysis semantics, not a safety or compliance rating. Brand orange and warning amber are distinct roles even where their hues are close; choose by meaning. Light/dark themes are selected through Preferences (`src/services/preferences-manager.js`, `src/core/normalizer.js`, and Settings). Current preference values are `light` and `dark`; automatic/system theme and user-selected accent colors are not present.

**Accessibility concern for the CSS audit:** Current primary buttons pair white `--accent-foreground` text with `--accent-primary: #ff9f1c`, approximately `2.05:1` contrast. Treat this as an unresolved accessibility issue in the upcoming CSS audit; this contract does not prescribe or implement the correction.

**Proposed:** Use existing semantic properties before adding a color; check readable text, borders, hover, disabled, and focus in both themes for any later change. **Unresolved:** Some rules refer to `--bg-tertiary` or `--accent`, neither defined in the inspected root/dark token blocks (`styles/main.css`). The CSS audit should determine their intended replacement or definition; this draft assigns no value.

### 2.2 Type, space, shape, and depth — Current

| Foundation | Verified values / usage |
|---|---|
| Family | `--font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`; `index.html` requests Inter weights 400/500/600/700. |
| Sizes | `--text-xs: .75rem`, `--text-sm: .875rem`, `--text-base: 1rem`, `--text-lg: 1.125rem`, `--text-xl: 1.25rem`, `--text-2xl: 1.5rem`, `--text-3xl: 2rem`. |
| Weights / line height | `--font-normal/medium/semibold/bold: 400/500/600/700`; `--leading-tight/normal/relaxed: 1.25/1.5/1.75`. |
| Space | `--space-1/2/3/4: .25/.5/.75/1rem`; `--space-5/6/8/10/12: 1.5/2/3/4/6rem`. |
| Corners | `--radius-sm/md/lg: 6/10/14px`; pills/chips and Editor toolbar also use literal `999px`. |
| Elevation | `--shadow-sm/md/lg` are three defined shadow levels; dark theme overrides their opacity. |
| Separators | Cards, panels, inputs, menus, and modal header/footer use `1px` borders with `--border-subtle`; stronger boundaries use `--border-strong`. |
| Interaction | Global `:focus-visible` uses a `2px` `--focus-ring` outline with `2px` offset. `.tp3d-pointer-focus` suppresses that outline after pointer focus; keyboard focus remains visible. |

The stylesheet also contains local pixel values for toolbar controls, cards, import previews, and responsive layouts. There is no verified global density, motion, disabled, or loading token scale. `.btn:disabled` uses reduced opacity and a blocked cursor; `.tp3d-select[aria-disabled='true']` does likewise. Import parsing has `.tp3d-ic-spinner` and `.tp3d-ic-progress`; other loading patterns are scoped. **Proposed:** Prefer the existing type/space/radius/shadow tokens for repeated static styling, while retaining task-specific dimensions when they protect usable data space. **Unresolved:** Whether to add shared motion, density, and loading tokens requires audit evidence and owner approval.

## 3. Component contracts

The contracts below describe visual anatomy and expected interaction without creating components. Keep existing behavior, semantics, and source ownership.

| Component | Current implementation | Proposed consistency rule |
|---|---|---|
| Buttons | `.btn` is the neutral/secondary action; `.btn-primary` is filled orange; `.btn-ghost` is quiet; `.btn-danger` is a red-tinted action and becomes solid red inside `.modal` and the scoped danger context. `.toolbar-btn` is the Editor toolbar variant. | Use one visually dominant action per decision area where practical. Keep labels verb-first and specific. Icon-only controls need an accessible name. Preserve scoped danger overrides. Do not invent a `.btn-secondary` implementation. |
| Inputs and search | `.field`, `.label`, `.input`, `.search-input`, `.search-icon`, and `.tp3d-search-clear` appear across library screens; `.tp3d-field-error` is an inline error style. | Pair labels and help/errors with their field; keep clear/search actions distinct from filter state. Show units and valid ranges next to numeric controls. |
| Dropdowns and selectors | `UIComponents.createSelect()` renders the shared `.tp3d-select` combobox/listbox; `.dropdown-menu` and `.dropdown-item` serve contextual menus. Popup ownership and keyboard selection are already handled by the UI layer. | Reuse the shared select for comparable selection tasks. Preserve open/selected/active/disabled semantics and popup ownership rather than adding local menus. |
| Checkbox, switch, radio, numeric | Cases/Load Plans use native checkboxes for selection. Settings uses `.tp3d-pref-switch`, `.tp3d-pref-segmented`, range, and `.input[type='number']`. No shared radio visual class was found in this baseline inspection. | Keep the control's visible state and programmatic state aligned. Use native or existing semantic controls where appropriate; a future radio style needs its own review. |
| Dialogs and confirmations | `UIComponents.showModal()` owns `.modal-overlay`, `.modal-header`, `.modal-body`, `.modal-footer`, accessible dialog naming, and dismissal/focus lifecycle. Default modal width is `min(580px, 100%)`; import variants are wider. | Keep a clear title, concise consequence, scrollable body, and persistent action footer. Preserve the existing owner/focus lifecycle, dismissal policy, and action order for each approved workflow. |
| Upload/drop areas | Import Cases and Import Load Plan use `.tp3d-ic-drop`, `.is-dragover`, a Browse button, parsing state, preview, and confirmation. A separate `.tp3d-import-drop` pattern exists for application import. | Communicate accepted file type, pending/parsed/error state, and that nothing is saved until confirmation. Keep browse usable without drag-and-drop. Do not unify distinct import workflows by appearance alone. |
| Tabs and segmented controls | Settings navigation has `role='tablist'`/`role='tab'`; `.tp3d-pref-segmented` displays compact options. Filter chips use `.chip.active`. | Make selected state visible and accessible; distinguish navigation tabs, value selectors, and filters by purpose. |
| Tables, grids, filters, sorting | Cases and Load Plans have table/card modes, `.pack-grid`/`.pack-card`, `.table-wrap`, sticky table headers, `.th-sort`, filter chips, and scoped menus. | Keep columns and numeric data scannable; sorting needs a visible direction and keyboard access. Maintain selection state across view changes as the current screen contract requires. |
| Cards, empty/loading states | `.card` is the shared surface; `.pack-card` adds hover and selected states; `.pack-preview` shows a thumbnail or empty view. Settings has `.tp3d-settings-empty`; import parsing has a scoped progress card. | Reserve card emphasis for selectable/actionable surfaces; use neutral empty copy with the next available action. Do not present placeholder content as real cargo or analysis. |
| Badges, tags, statuses | `.badge`, `.chip`, handling chips, import status dots, toast types, and Editor validation status have distinct uses. | Use text with color for operational state; keep warning, error, success, and informational meanings stable. Avoid making capacity density look like a safety grade. |
| Toasts and validation | `UIComponents.showToast()` has success/error/warning/info types; inline `.tp3d-field-error` and import row reasons/warnings give local detail. | Use a toast for short outcome feedback and local messages for fields/rows that need repair. Preserve the difference between non-blocking warning and blocking error. |
| Navigation and headers | `.sidebar`, `.nav-btn`, `.topbar`, screen headings, Settings left navigation/right header form the shell. | Keep page identity and active location clear. Avoid competing page titles inside one task view. |
| Inspector and toolbars | `.editor-shell` surrounds Case Browser, `#viewport`, and Inspector; `.viewport-toolbar` and `.toolbar-btn` provide compact actions over the scene. | Keep controls legible against the viewport, avoid obscuring cargo, and make toggled panel/selection state visible. Do not make visual restyling alter edit or camera behavior. |
| Tooltips, popovers, menus | `[data-tooltip]`, Editor validation popover, `.dropdown-menu`, and contextual menus are current patterns. | Use concise supplemental text, never the sole carrier of a required action or warning; maintain focus and ownership when floating above dialogs. |

### Import dialog consistency checkpoint — Current / Unresolved

`src/ui/overlays/import-cases-dialog.js` and `import-pack-dialog.js` both use `showModal()`, `.tp3d-ic-*` drop/parse/preview patterns, Cancel then one primary import action, and a left footer note stating that import is pending confirmation. They also differ visibly: the Case modal is capped at `740px` while the Load Plan variant is `700px`; `.tp3d-ip-modal` gives summary/preview surfaces a different background; Cases can show an error-report footer action, while Load Plans presents different preflight/repair information. Their headings, file-format copy, summary density, and action labels differ by task.

**Proposed:** During the later CSS audit, compare header/body/footer rhythm, note placement, button alignment, status colors, and narrow-screen wrapping using the existing modal classes. **Unresolved:** Decide which differences reflect real import content needs and which should converge. Preserve validation, conflict handling, file acceptance, and Cancel behavior; this draft makes no modal redesign decision.

## 4. Interaction and accessibility rules

- **Current:** `.btn` hover/active/disabled, `.toolbar-btn.active`, `.chip.active`, `.pack-card.selected`, and `.tp3d-select` active/selected/disabled rules exist. **Proposed:** Every actionable state should be visibly distinguishable in light and dark themes without using color alone. Disabled controls should explain the unavailable path where the task needs it; loading should identify work in progress without implying completion.
- **Current:** Keyboard focus uses `:focus-visible`; the shared select supports keyboard opening/navigation; modal focus and dropdown ownership are implemented in `src/ui/modal-focus.js` and `src/ui/ui-components.js`. **Proposed:** Preserve logical tab order, visible keyboard focus, Escape/dismiss behavior where allowed, and focus return to a valid opener. Never let a tooltip or portalled menu trap focus behind its owner.
- **Current:** Import row warnings and errors are distinct, and shared toasts carry outcome messages. **Proposed:** Validate next to the affected field/row, give a clear correction, and keep summaries concise. Confirm destructive operations with the current scoped modal pattern and explicit consequence. For the existing two-action import and Truck Change dialogs, Cancel is left and the affirmative action is right; other flows keep their approved order until reviewed.
- **Current:** Import drop areas change styling on `.is-dragover`; the Editor supports drag and selection feedback. **Proposed:** Show the legal drop target and outcome, keep keyboard/browse alternatives for file upload, and preserve hard physical placement safeguards and manual Editor authority. No design rule here changes cargo validation or AutoPack policy.
- **Current:** Responsive rules include a desktop three-column Editor, narrower columns below `1280px`, and panel drawers/sidebar below `900px`; other components have scoped rules near `768px`, `600px`, `520px`, and `480px`. Compact controls already vary in hit area (for example, the shared select is at least `36px` high). **Proposed:** Keep actions reachable and readable as panels collapse; enlarge effective touch targets where needed without sacrificing dense desktop workflows. **Unresolved:** A universal numeric target size and a formal density mode require owner review and device-specific verification.

## 5. CSS architecture principles for the later audit

1. Start with the existing semantic tokens in `styles/main.css` for repeated static values. A new token needs a repeated need and light/dark semantics; do not rename existing tokens without a compatible migration.
2. Reuse `.btn`, `.card`, `.input`, `.tp3d-select`, `.modal-*`, and scoped component classes. Keep selectors as local as practical; avoid specificity escalation, duplicate declarations, and unnecessary `!important`.
3. Use semantic color properties for status and interaction. Keep hardcoded or computed values only where the present token set cannot express the design. Check both themes before declaring a hardcoded value safe.
4. Put static/repeated visual rules in CSS. Runtime-computed layout, measured popup placement, category color, or live geometry may remain inline when justified. Existing inline styles are migration candidates, not proof that removal is safe.
5. Preserve current class names, JS hooks, focus ownership, scoped overrides, and responsive behavior until a migration is approved and verified. A global rule must not silently restyle another screen or dialog.
6. Review contrast, overflow, keyboard focus, pointer targets, reduced motion, and loading/disabled appearance in context. The next audit should identify concrete conflicts; this document is the standard to compare against, not the audit result.

## 6. Future customization — Proposed, not authorized

The current Settings Preferences UI exposes light/dark theme and other task preferences. Future accent selection, system theme, UI density, and typography/accessibility preferences could use the token and component boundaries above. Each needs an explicit owner decision about scope, persistence, contrast, dark-mode behavior, and interaction with the 3D viewport before code work. Do not imply that these controls or saved settings already exist.

## 7. 3D Editor boundary

The application UI should frame the viewport as the primary planning surface: Case Browser and Inspector are readable side panels; toolbar and navigation controls remain legible against the scene; validation/status feedback has a clear owner and does not obscure cargo; spacing and responsive drawers preserve a useful viewport. Viewport focus and existing orbit/pan/zoom behavior remain usable. CSS can govern surrounding panels, overlays, typography, and control states.

This contract does **not** define case/trailer materials, physical geometry, camera framing or controls, collision, packing, lighting, renderer architecture, visual-resource ownership, or the separate Claude 3D visual project. The professional 3D visual foundation contract and current technical source remain the relevant boundaries for that work. The previously rejected 3D visual implementation, reverted in PR #34, is not authorized or revived by this design contract. A visual treatment must never imply physical validation or override logistics truth.

## 8. Cargo Planner 3D examples

| Do | Don't |
|---|---|
| In an Import Cases or Import Load Plan footer, keep Cancel and the task-specific primary import action clear, with the pending-confirmation note legible. | Make the note look like a second action or silently change import validation while aligning the footer. |
| In Case Library filters, reuse chips/search/menu states and show the active filter. | Use brand orange alone to mean warning, selection, and a primary action at once. |
| In Load Plan cards, use the existing title, metadata badges, thumbnail/empty preview, and selected state. | Show a placeholder as if it were a captured Pack view. |
| In the Editor toolbar, use compact labeled actions and visible keyboard focus while keeping cargo unobscured. | Move the viewport, reset the camera, or change placement authority as a side effect of styling. |
| In Settings rows, align label, control, helper, and error text using existing scoped classes. | Treat a planned Settings-contract target as already shipped or remove a runtime-dependent inline style without verification. |
| In destructive confirmations, state the consequence and use the existing danger variant in its modal context. | Make a destructive action look like an ordinary neutral operation or bypass the established focus/dismissal lifecycle. |

## 9. Authority and change policy

`design.md` is the draft cross-application UI/UX baseline. Current source and tests define what exists today. Domain behavior and safety contracts retain authority in their scope; `docs/product/SETTINGS-VISUAL-SYSTEM-CONTRACT.md` remains the scoped Settings visual contract, and `docs/product/TP3D-PROFESSIONAL-3D-EDITOR-VISUAL-FOUNDATION-IMPLEMENTATION-CONTRACT.md` remains a separate 3D visual architecture boundary. Reconcile any overlap explicitly rather than silently replacing either document. The V6 roadmap records operational status, but this task's C5 pause and C6 deferral govern this draft; no roadmap file is changed here.

Before implementing a proposed standard, obtain owner approval, compare current source and relevant scoped contracts, make a focused change, and verify the affected screen in both themes and relevant viewport sizes. Record unresolved choices instead of inventing requirements. C5 AutoPack development remains paused; C6 Reporting + Integrated Closure remains deferred.

**DRAFT — AWAITING OWNER REVIEW**
