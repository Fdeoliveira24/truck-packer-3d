# Settings Visual System Contract
**Truck Packer 3D — Phase UI-DESIGN-CONTRACT**
**Created: 2026-05-16 — No code changes in this document**

This document is the authoritative reference for every UI implementation phase that touches the Settings overlay, Account overlay, Auth overlay, or their shared CSS. Implementation agents must read this before touching any file.

---

## 0. Ground Rules for Implementation

- **Additive first.** Add new classes before removing old ones. Deprecated classes become aliases that point to the new rule.
- **CSS-only phases are zero-risk only if** the selector is already correctly applied by the JS. Verify JS class assignments before assuming a CSS rule has effect.
- **Never remove `.modal .btn-danger` or `.tp3d-settings-danger-right .btn-danger` overrides.** Both are intentional context-scoped overrides that promote `.btn-danger` from ghost-red to solid red inside modals and danger zones. The CSS comment explaining them must be preserved and expanded on any edit.
- **Phase 10 (inline style migration) is last.** It is the highest regression risk in the plan. Do not batch-remove inline styles. One property at a time, browser-verified after each.
- **Do not modularize `settings-overlay.js` yet.** All JS changes are `className` additions only, not structural rewrites.
- **`Production/` stays untracked throughout.**

---

## A. Final Design Rules

### A1. Settings Modal Shell

| Property | Current | Target |
|---|---|---|
| Modal max-width | `min(1100px, 94vw)` | Keep |
| Modal height | `min(760px, 92vh)` | Keep |
| Grid columns | `280px 1fr` | Keep |
| Left pane background | `var(--bg-secondary)` (same as right) | `var(--bg-primary)` — one step darker, separates panes without a heavy border |
| Right pane background | `var(--bg-secondary)` | Keep |
| Right header padding | `space-5 space-6` (24px / 32px) | `space-4 space-5` (16px / 24px) — tighter, less wasted vertical space |
| Right body padding | `space-6` all sides | Keep horizontal `space-6`; reduce top/bottom to `space-5` |
| Close button position | Inside right-pane header (current) | Keep for now — moving it to overlay level is a layout change deferred to a later pass |
| Modal open/close animation | None | Deferred — not a contract item for Phase 1–6 |

### A2. Left Navigation

| Element | Current | Target |
|---|---|---|
| Nav item font size | `--text-base` (16px) | `--text-sm` (14px) |
| Nav item font weight | inherited (400) | `var(--font-medium)` (500) |
| Nav group headers | `--text-sm` semibold | `--text-xs` uppercase + `letter-spacing: 0.06em` + `var(--text-secondary)` |
| Nav icon font-size | Not set (inherits) | `var(--text-base)` (16px) explicit |
| Nav icon container line-height | Not set | `1` — prevents vertical icon drift |
| Active nav item | Background `--accent-primary-14` | Add left-border accent: `border-left: 2px solid var(--accent-primary)` + existing background |
| Account block (top of left pane) | `.btn.tp3d-settings-account-btn` (button with hover lift, border) | New `.tp3d-settings-profile-card` — static block, no button hover, remove interactive affordance. **JS click handler must be preserved on the same element — CSS class rename only.** |

### A3. Typography Scale Usage

The token values are correct. The problem is wrong application. This table is the source of truth for all settings tabs:

| Element | Token | Weight | Notes |
|---|---|---|---|
| Right-pane tab title | `--text-xl` (20px) | semibold | Reduce from `--text-2xl`. Use `.tp3d-settings-right-title` |
| Right-pane subtitle | `--text-sm` (14px) | normal | `--text-secondary`. Use `.tp3d-settings-right-subtitle` |
| Section heading (all tabs) | `--text-xs` (12px) | semibold | Uppercase + `letter-spacing: 0.07em` + `--text-secondary`. Use `.tp3d-prefs-heading` (extend to all tabs) |
| Row label | `--text-base` (16px) via `.tp3d-settings-row` | **medium** (500) — not semibold | **Browser-test first on all six tabs; commit only if it improves readability.** This is not a guaranteed Phase 1 change. |
| Row value | `--text-base` | normal | |
| Card/section title (Billing, Org) | `--text-xl` | semibold | Use new `.tp3d-settings-section-title` — replaces the duplicate `org-title` / `billing-title` rules |
| Nav items | `--text-sm` | medium | See A2 |
| Nav group labels | `--text-xs` | semibold + uppercase | See A2 |
| Meta / helper text | `--text-sm` | normal | `--text-secondary` or `--text-muted`. Use `.tp3d-settings-meta` or `.muted` |
| Danger zone label | `--text-base` | semibold | `--error` color via `.tp3d-settings-danger-left` — keep current |
| Badge text | `--text-xs` | semibold | Keep current |

### A4. Card Pattern

`.card` base rule is unchanged:
```
background: var(--bg-secondary)
border: 1px solid var(--border-subtle)
border-radius: var(--radius-md)
padding: var(--space-4)
box-shadow: var(--shadow-sm)
```

Two new modifier classes (additive, no existing class changes):

**`.card--interactive`** — for clickable card surfaces (Resource items):
```
cursor: pointer
transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease
:hover → background: var(--bg-hover), border-color: var(--border-strong), box-shadow: var(--shadow-md)
:focus-visible → outline: 2px solid var(--accent-primary), outline-offset: 2px
```

**`.card--flush`** — for cards hosting full-bleed tables or lists:
```
padding: 0
overflow: hidden
```

### A5. Interactive Card Pattern

Resource root cards use `.tp3d-resources-card-btn`, `.tp3d-resources-card-row`, `.tp3d-resources-card-icon`, and `.tp3d-resources-card-copy`. These classes already carry their own hover/focus/transition rules in `main.css`. **Do not add `.card--interactive` to resources root items** — it would create a specificity conflict with the existing hover rules.

The correct fix for UI-4B is a JS-only className swap to this existing system. `.card--interactive` is reserved for future generic clickable cards that do not have a dedicated button class.

- Remove any JS-applied `style.background` on resource card hover — JS inline hover styles on static elements are forbidden by this contract.
- Resource card icon `font-size`: **20px** fixed (not a token) — FA icons at this size optically align across all five resource items.

### A6. Form Row Pattern

`.tp3d-settings-row` stays:
```
display: grid
grid-template-columns: 220px 1fr
gap: 16px
align-items: center
padding: 16px 0
border-bottom: 1px solid var(--border-subtle)
```

`.tp3d-settings-row-label` change: `font-weight: var(--font-medium)` (from `semibold`).
**Test-first:** Browser-test on all six tabs before committing. Commit only if the change improves readability. This is not a guaranteed Phase 1 change — if the lighter weight makes rows feel less scannable, defer this item.

New modifier (additive):

**`.tp3d-settings-row--readonly`** — for display-only rows (Email, join date, read-only org data):
```
.tp3d-settings-row--readonly .tp3d-settings-row-label {
  color: var(--text-secondary);
  font-weight: var(--font-normal);
}
```
Apply in JS with `classList.add('tp3d-settings-row--readonly')` on the row element — one-line change per read-only row.

### A7. Section Heading Pattern

`.tp3d-prefs-heading` is the canonical pattern and must be used (or the same rule applied) across every section heading in every settings tab. This is not Preferences-specific — it is the settings section heading standard.

Rule:
```css
.tp3d-prefs-heading {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-top: var(--space-3);
}
.tp3d-prefs-card > .tp3d-prefs-heading:first-child {
  margin-top: 0;
}
```

Every section title that currently uses `tp3d-settings-card-title`, `tp3d-settings-org-title`, or `tp3d-settings-billing-title` for a within-tab group header should eventually migrate to `.tp3d-prefs-heading`. Top-level tab titles (one per tab, displayed in the right-pane header) use `.tp3d-settings-section-title` (see A3).

### A8. Button Hierarchy

Five tiers. The existing CSS already implements most of this — the contract just makes it explicit.

| Context | Class | Visual | Notes |
|---|---|---|---|
| Primary action (Save, Subscribe) | `.btn.btn-primary` | Filled orange | One per view maximum |
| Standard action (Edit, Export, Transfer) | `.btn` | Outlined neutral | Default state with border |
| Quiet / navigation action | `.btn.btn-ghost` | Transparent | No border, no background |
| Danger (outside modal) | `.btn.btn-danger` | Ghost-red text | Background: `rgba(239,68,68,0.12)`, color: `var(--error)` — current out-of-modal behavior |
| Danger (inside `.modal` or `.tp3d-settings-danger-right`) | `.btn.btn-danger` | Solid red | Overridden by `.modal .btn-danger` and `.tp3d-settings-danger-right .btn-danger` scoped rules — **do not remove either override** |

**Text-link actions are forbidden.** Any clickable text that triggers an action (download, transfer, leave, export) must be a `.btn` or `.btn.btn-ghost`. No naked `<a>` or unstyled `<span>` as action triggers.

### A9. Danger Zone Pattern

Current `.tp3d-settings-danger` only provides `margin-top: 26px`. The danger zone needs a visual container to clearly separate destructive actions from the rest of the page.

New class `.tp3d-settings-danger-zone` (additive — does not replace `.tp3d-settings-danger`):
```css
.tp3d-settings-danger-zone {
  margin-top: var(--space-5);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid rgba(239, 68, 68, 0.18);
  background: rgba(239, 68, 68, 0.04);
}
```

Apply to the outer danger zone container in `settings-overlay.js` — `classList.add('tp3d-settings-danger-zone')` on the `dangerCard` element. The existing `.tp3d-settings-danger` + `.tp3d-settings-danger-row` internal structure stays unchanged.

Dark mode note: The `rgba(239,68,68,0.04)` background is dark-mode-safe since it's a translucent overlay on whatever surface it sits on.

### A10. Empty State Pattern

New class `.tp3d-settings-empty` for no-content states (no members, no archived workspaces, no pending invites):
```css
.tp3d-settings-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-4);
  color: var(--text-muted);
  text-align: center;
  font-size: var(--text-sm);
}
.tp3d-settings-empty-icon {
  font-size: 28px;
  opacity: 0.45;
}
```

Apply to: Members empty state, Billing no-data fallback, Archived Workspaces empty card, Pending Invites "No pending invites" text. Replace the current `tp3d-org-feedback--warning` usage for "No pending invites" (which is not a warning — it's a neutral empty state).

### A11. Resources Tab Pattern

**Root view cards:** Use `.tp3d-resources-card-btn` (already implemented with hover/focus/transition in `main.css`). Do not add `.card--interactive` — not needed and would conflict. Remove any JS inline `style.background` on hover.

**Icon standardization:** Resource card icons — bell, map, file-export, file-import, circle-question — render at different optical sizes in FA6. Fix by setting `font-size: 20px` explicitly on `.tp3d-resources-card-icon`. This is a CSS-only change.

**Sub-views (Updates, Roadmap, Export, Import, Help):** No structural changes in this contract phase. These render well.

### A12. Workspace Action Pattern

Actions within Workspace General follow this rule:

| Action | Button class | Position |
|---|---|---|
| Edit Workspace | `.btn.btn-primary` | Right-aligned via `.tp3d-account-actions` |
| Export Workspace Data | `.btn.btn-ghost` | Right-aligned via `.tp3d-account-actions` |
| Transfer Ownership | `.btn.btn-ghost` | Right-aligned via `.tp3d-account-actions` |
| Leave Workspace | `.btn.btn-danger` | Right-aligned via `.tp3d-account-actions` |
| Archive Workspace | `.btn.btn-danger` | Inside danger zone, right column |

**Warning color check:** The ownership warning currently uses `tp3d-org-feedback tp3d-org-feedback--warning` which applies `color: var(--warning)` (#f59e0b). Verify this is still the case after Phase UI-3 changes. If any code path applies `--accent-primary` (brand orange) to a warning message, correct it to `--warning`.

### A13. Members Table / List Pattern

**Table:** `.tp3d-org-members-table` with `border-collapse: collapse` — keep.

**Member row actions:**
- Role `<select>`: `disabled` attribute on the whole element when role change is not permitted (not just individual options).
- Remove button: Hidden (not just disabled) when `canRemove === false && isOwnerMember === true`. The owner row should show "—" or nothing, not a disabled red button.
- Pending invite empty state: Replace `tp3d-org-feedback--warning` with `.tp3d-settings-empty` (neutral — no invites is not a warning).

**Avatar sizes:** All member avatars in the table use `.tp3d-settings-avatar--sm` (28px). Verify JS applies this class consistently — do not mix inline width/height with the CSS class.

**Badge normalization:** `.tp3d-org-member-role-badge` — keep existing styles. No changes in this contract phase.

### A14. Billing Visual-Only Pattern

The Billing tab has the most complex state machine — this contract imposes visual-only rules with zero logic changes.

| Element | Rule |
|---|---|
| Section title | Apply `.tp3d-settings-section-title` (replaces `.tp3d-settings-billing-title`) |
| Pro CTA card | `.tp3d-billing-pro-cta` — keep as-is, it's well-designed |
| Payment warning card | `.tp3d-billing-payment-warning` — keep |
| Billing action buttons | `.btn` (outlined neutral — `.btn-secondary` does not exist) — keep |
| Skeleton states | Keep all `tp3d-skeleton-*` and `tp3d-skel-*` classes — do not touch |

`tp3d-settings-billing-title` and `tp3d-settings-org-title` are identical CSS rules. Phase 8 creates `.tp3d-settings-section-title` as a unified replacement and marks the two originals as deprecated aliases (the rule stays, the class name is phased out in future JS passes).

### A15. Account / Auth Alignment Pattern

**Account tab:**
- Email row: Apply `.tp3d-settings-row--readonly` — label becomes `--text-secondary` / normal weight.
- Avatar section: Keep `.tp3d-account-avatar-upload-container` structure.
- Edit form nesting: The edit form currently wraps in a `.card` creating double-card nesting (`card > card`). This is deferred to a post-Phase 9 pass — do not attempt to fix until all other phases are stable.

**Auth overlay:**
- Form group spacing: `--space-3` minimum gap between fields — verify current gap is not less.
- Footer links (`.auth-footer-links`): Keep current — acceptable for the auth overlay's simpler layout context.
- Auth overlay does not need to match settings modal card pattern — it is a standalone modal with its own valid visual system.

**No changes to auth flow logic, Supabase calls, or session handling.**

### A16. Inline Style Policy

This policy applies to all overlays: `settings-overlay.js`, `account-overlay.js`, `auth-overlay.js`, `src/ui/ui-components.js`.

#### Must stay inline (dynamic / runtime-computed)

| Location | Property | Reason |
|---|---|---|
| Avatar elements | `background-color` | Computed per-user from initials hash at render time |
| Avatar elements | `background-image: url(...)` | Uploaded avatar URL is user data |
| Roadmap badge | `background` | Dynamic status color per roadmap item from data |
| All dropdowns | `top`, `left`, `right`, `width`, `minWidth`, `visibility` | Viewport-calculated at open time |
| Toast icon | `background` | Maps to semantic token per toast type; config-driven |
| Modal overlay nested | `zIndex` | Stacking context for nested modals (e.g. delete-confirm above account modal) |
| `display: flex` on modal/overlay containers | `display` | Modal containers rely on `.tp3d-settings-modal` grid layout. Moving `display` to CSS is only safe if the same commit adds **and** applies a tested modal modifier class that explicitly handles the grid override. Never move the `display` property in isolation. |

#### Must move to CSS (static / repeated)

| Location | Property | Target CSS class |
|---|---|---|
| `settings-overlay.js:5777–5778` | `display: flex; justify-content: flex-end` on retry row | Already fixed (UI-1B): use `.tp3d-account-actions` |
| `settings-overlay.js:2441, 5270–5271` | `color: var(--danger, #dc2626)` on error messages | `.tp3d-error-inline { color: var(--error); min-height: 18px }` |
| `account-overlay.js:162–164` | `maxWidth: 560px; display: flex; flexDirection: column` on delete-confirm modal | `.tp3d-settings-modal--confirm { max-width: 560px; display: flex; flex-direction: column }` — **only move if the same commit adds and applies a tested modal modifier class that safely replaces the `.tp3d-settings-modal` grid behavior; never move `display` alone** |
| `account-overlay.js:239–242` | `display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px` on footer | `.tp3d-confirm-modal-footer` |
| `account-overlay.js:445–447` | `display: flex; flex-direction: column; gap: 6px` on avatarRight | `.tp3d-avatar-col` |
| Any `style.fontWeight = 'var(--font-semibold)'` on static elements | `fontWeight` | Use `.tp3d-settings-card-title` or a utility class |
| Any `style.fontSize = 'var(--text-sm)'` on static elements | `fontSize` | Use `.tp3d-settings-meta` or `.muted` |

**Migration rule:** For each inline style to migrate: (1) add the CSS class to `main.css`, (2) add `classList.add(...)` in JS, (3) verify in browser, (4) only then remove the `style.*` assignment. Never remove before adding.

#### Hold for avatar/logo image pass

| Location | Property | Note |
|---|---|---|
| `settings-overlay.js:5555, 5802` | `background: var(--accent-primary)` on logo placeholder | The placeholder background interacts with the avatar/logo upload flow — the placeholder may be replaced by a user image. Verify placeholder-vs-image render states visually before moving to a static CSS class. |

---

## B. Class Map

### Keep — do not rename or remove

```
.modal                          .modal-overlay
.modal-header                   .modal-body
.modal-footer                   .modal .btn-danger  ← override, must never be removed
.btn                            .btn-primary
.btn-ghost                      .btn-danger
.input                          .select
.card                           .tp3d-settings-modal
.tp3d-settings-left-pane        .tp3d-settings-right-pane
.tp3d-settings-right-header     .tp3d-settings-right-body
.tp3d-settings-right-title      .tp3d-settings-right-subtitle
.tp3d-settings-right-text       .tp3d-settings-row
.tp3d-settings-row-label        .tp3d-settings-nav-item
.tp3d-settings-nav-wrap         .tp3d-settings-nav-header
.tp3d-settings-nav-icon         .tp3d-settings-nav-label
.tp3d-settings-account-btn      .tp3d-settings-account-inner
.tp3d-settings-account-avatar   .tp3d-settings-account-text
.tp3d-settings-account-name     .tp3d-settings-account-sub
.tp3d-settings-danger           .tp3d-settings-danger-title
.tp3d-settings-danger-divider   .tp3d-settings-danger-row
.tp3d-settings-danger-left      .tp3d-settings-danger-right
.tp3d-settings-danger-msg       .tp3d-settings-danger-warn-icon
.tp3d-settings-org-divider      .tp3d-settings-actions-row
.tp3d-settings-stack            .tp3d-settings-stack--tight
.tp3d-settings-stack--loose     .tp3d-settings-meta
.tp3d-settings-mt-xs            .tp3d-settings-mt-sm
.tp3d-settings-mt-md            .tp3d-prefs-heading
.tp3d-prefs-card                .tp3d-prefs-number-input
.tp3d-account-actions           .tp3d-account-profile-form
.tp3d-account-field             .tp3d-account-field-label
.tp3d-account-field-row         .tp3d-account-avatar-upload-container
.tp3d-account-avatar-preview    .tp3d-account-avatar-buttons
.tp3d-account-delete-form       .tp3d-account-delete-input-row
.tp3d-account-delete-input      .tp3d-org-members-table
.tp3d-org-members-table-wrap    .tp3d-org-member-actions
.tp3d-org-members-actions-cell  .tp3d-org-invite-section
.tp3d-org-invite-form           .tp3d-org-feedback
.tp3d-org-feedback--error       .tp3d-org-feedback--warning
.tp3d-org-feedback--success     .tp3d-billing-pro-cta (and __* variants)
.tp3d-billing-payment-warning   .tp3d-billing-actions
.tp3d-resources-view            .tp3d-resources-card
.tp3d-resources-card-btn        .tp3d-resources-card-row
.tp3d-resources-card-icon       .tp3d-resources-card-copy
.tp3d-resources-card-title      .tp3d-resources-card-sub
.tp3d-settings-card--clickable  .tp3d-settings-section-heading
.tp3d-settings-card-title
```

### Add — new classes, Phase by Phase

| Phase | Class | Type | Purpose |
|---|---|---|---|
| 1 | `.tp3d-settings-section-title` | CSS-only | Replaces `org-title` + `billing-title` (same rule, unified name) |
| 2 | Left pane `--bg-primary` | CSS-only | Background change on `.tp3d-settings-left-pane` |
| 3 | `.tp3d-settings-profile-card` | CSS-only + JS rename | Static account block — no button affordance |
| 4 | `.card--interactive` | CSS-only | Hover state for clickable cards |
| 4 | `.card--flush` | CSS-only | Zero-padding card variant |
| 4 | `.tp3d-settings-row--readonly` | CSS-only + JS classList.add | Muted read-only row label |
| 5 | Apply `.tp3d-prefs-heading` to all tabs | JS classList change | Section heading consistency across all six tabs |
| 6 | `.tp3d-settings-danger-zone` | CSS-only + JS classList.add | Soft red-tinted danger container |
| 7 | `.tp3d-settings-empty` | CSS-only | Neutral empty state pattern |
| 7 | `.tp3d-settings-empty-icon` | CSS-only | Icon inside empty state |
| 8 | (apply `.tp3d-settings-section-title` to billing) | JS classList change | Replace `tp3d-settings-billing-title` in render |
| 10 | `.tp3d-settings-modal--confirm` | CSS-only | Narrow modal for delete-confirm |
| 10 | `.tp3d-confirm-modal-footer` | CSS-only | Footer in confirm modal |
| 10 | `.tp3d-avatar-placeholder` | CSS-only | Logo/avatar placeholder background |
| 10 | `.tp3d-error-inline` | CSS-only | Error message color + min-height |
| 10 | `.tp3d-avatar-col` | CSS-only | Column layout for avatar right-side area |

### Deprecated — keep the CSS rule, stop using the class in new JS code

| Class | Replaced by | When |
|---|---|---|
| `.tp3d-settings-org-title` | `.tp3d-settings-section-title` | Phase 1 (CSS alias added; JS updated in Phase 5/8) |
| `.tp3d-settings-billing-title` | `.tp3d-settings-section-title` | Phase 8 |

### Avoid — do not add new usages of these patterns

| Pattern | Problem | Alternative |
|---|---|---|
| Naked `<a>` or `<span>` as action trigger | No keyboard affordance, no button semantics | `.btn.btn-ghost` |
| `style.background` for hover state | Cannot be themed; breaks dark mode | `.card--interactive:hover` CSS |
| `style.fontWeight` on static elements | Repeated inline, not themeable | Named CSS class |
| `style.fontSize` on static elements | Same | Named CSS class |
| `tp3d-org-feedback--warning` for neutral empty state | Visually implies a problem exists | `.tp3d-settings-empty` |

---

## C. Phase Order

| Phase | Name | Files | CSS-only? | Risk |
|---|---|---|---|---|
| 1 | Typography pass | `main.css` | Yes | Low — must verify no nav text wrapping at any width |
| 2 | Modal shell pass | `main.css` | Yes | Low — verify header/body height budget on all 6 tabs |
| 3 | Navigation pass | `main.css` + `settings-overlay.js` (className only) | Partial — JS renames 1 class | Medium — verify `.is-active` selector matches JS exactly before touching |
| 4 | Card and row system | `main.css` | Yes | Low |
| 5 | Section heading consistency | `settings-overlay.js` (classList.add) | No | Low-Medium — visual only, no logic |
| 6 | Workspace General | `main.css` + `settings-overlay.js` (classList.add, color fix) | Partial | Medium — verify warning color, export/transfer handlers still fire |
| 7 | Members pass | `main.css` + `settings-overlay.js` (hide logic) | Partial | Low-Medium — owner row Remove button hide changes DOM conditionally |
| 8 | Billing visual | `main.css` + `settings-overlay.js` (className) | Partial | Low |
| 9 | Account / Auth | `main.css` + `account-overlay.js` | Partial | Medium — no auth flow changes; CSS-only for auth overlay |
| 10 | Inline style migration | `settings-overlay.js` + `account-overlay.js` | No | High — one property at a time, browser-verified each |

---

## D. Risk Map

| Phase | Must Not Change | Validation Required |
|---|---|---|
| 1 | Nav text must not wrap at 280px left pane width; Billing/Org section titles must still look proportionate | All 6 tabs at desktop + 768px; dark mode |
| 2 | Right-pane height budget stays intact; close button position stays | All 6 tabs; confirm modal; dark mode |
| 3 | Active tab `.is-active` class name — verify JS applies exactly this class before changing CSS selector; click handler on account block must survive the className change | Tab switching; keyboard nav; mobile tab strip; account switcher dropdown |
| 4 | `.card` base rule unchanged; existing card padding stays for non-interactive cards | Resources tab hover; Account rows; all card usages across tabs |
| 5 | Section headings must not visually conflict with tab titles; `tp3d-prefs-card` scoping must not leak to other tabs | All 6 tabs; Preferences save still works; Resources sub-views |
| 6 | Export and Transfer click handlers; Leave Workspace confirmation; Archive confirmation; warning color must be `--warning` not `--accent-primary` | Full Workspace General flow for owner, admin, member |
| 7 | Member list layout; invite form; role change; remove member; pending invite table | Invite send, role change, remove member, revoke invite |
| 8 | Pro CTA click target; Billing state machine rendering (skeleton, pending, error, active states) | Billing tab on Free, Trial, and Pro plan states |
| 9 | Auth flow must complete end-to-end (sign-in, sign-up, reset); avatar upload/remove must work | Full auth session with real user; avatar upload; delete account confirmation |
| 10 | Dynamic color/size values must not be removed; roadmap badge data-driven colors must stay inline; dropdown positioning must stay inline | Full auth session; dark mode; avatar with image; roadmap view; all dropdowns |

---

## E. Browser Validation Checklist

Run this checklist after each phase before committing.

### Per-phase minimum

- [ ] Open Settings on a logged-in test1 session
- [ ] Click through all 6 left-nav tabs: Preferences, Resources, General, Members, Billing, Account
- [ ] Verify the changed elements render correctly at full desktop width
- [ ] Verify at 768px viewport (settings goes full-screen — left nav becomes horizontal strip)
- [ ] Toggle dark mode (Theme: Dark in Preferences → Save) — verify changed elements in dark mode
- [ ] Open and close the settings modal — confirm no layout shift on open, no remnant DOM on close
- [ ] Run `npm test` — 296/296 pass, 0 fail (or more if new tests added)
- [ ] Run `npm run lint` — 0 errors
- [ ] `git diff --check` — clean

### After Phase 3 (navigation)

- [ ] Click every left nav item — active state highlights correctly
- [ ] Click account block — account switcher dropdown opens
- [ ] Mobile (768px): tab strip shows all tabs, active tab is identifiable

### After Phase 6 (Workspace General)

- [ ] Owner view: all 4 cards visible (Identity, Backup, Ownership, Danger Zone)
- [ ] Non-owner member view: Backup card hidden, Danger Zone hidden, Leave Workspace enabled
- [ ] Transfer Ownership modal opens on click
- [ ] Leave Workspace confirmation dialog appears and executes correctly
- [ ] Archive Workspace confirmation dialog appears and executes correctly
- [ ] Export Workspace Data button triggers download action

### After Phase 7 (Members)

- [ ] Owner row: no Remove button visible
- [ ] Non-owner row: Remove button visible and functional
- [ ] Role dropdown: disabled when current user cannot change role
- [ ] Invite send, revoke, resend all functional
- [ ] Pending invites empty state shows neutral empty state (not orange warning)

### After Phase 10 (Inline styles)

- [ ] Avatar with uploaded image renders correctly (no broken background)
- [ ] Avatar initials render with correct background color for the user
- [ ] Roadmap items show correct badge colors
- [ ] All 5 dropdown menus open and position correctly
- [ ] Toast notifications appear, position correctly, and dismiss
- [ ] Delete account confirmation modal opens above account modal
- [ ] Dark mode: all elements in Settings and Auth overlays

---

*This document is the single source of truth for settings UI implementation. Any deviation from these rules must be explicitly noted in the commit message with a justification.*
