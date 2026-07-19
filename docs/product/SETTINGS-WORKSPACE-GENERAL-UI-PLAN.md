# Settings → Workspace → General — UI Polish Plan
**Phase: UI-2 (docs only) · Created: 2026-05-16**
**Scope: settings-overlay.js view-mode section only (no edit mode, no CSS, no auth/billing)**

**Update 2026-07-18 (Platform UX/UI Compatibility Closeout):** the Slug row described below has been hidden from Card 1 in `settings-overlay.js` — it is a UUID-derived internal identifier with no user-facing meaning until Workspace Slug Phase 2 (friendly slugs). The stored value, import/export, and read-only server contract are unchanged. Every "Slug" reference in this plan is historical; Phase UI-3 must **not** reintroduce the Slug row when executed.

---

## A. Current Problems

### What the tab looks like today

One large `.card.tp3d-settings-card-max` holds everything. Inside it, a single `viewContainer.grid` accumulates:

1. Logo row → Name → ~~Slug~~ (hidden 2026-07-18) → Phone → Address → Role rows (orgRow)
2. **[divider]** Export intro + Export button (owner/admin only)
3. **[divider]** "Remove yourself…" intro
4. Transfer ownership warning + Transfer button (primary owner only) — `btn btn-primary`
5. Leave Workspace button
6. **[divider]** Archive intro + **duplicate export hint text** + Archive button (primary owner only)
7. `appendArchivedWorkspacesSection(viewContainer, …)` — appended inline after everything else

### Specific problems

| # | Problem | Impact |
|---|---|---|
| P1 | All actions at the same visual weight — Export, Leave, Transfer, Archive live in one flat stack divided only by thin `tp3d-settings-org-divider` lines | Hard to scan; risky to misclick |
| P2 | "Transfer Ownership" uses `btn btn-primary` — same style as the primary workspace CTA (Edit Workspace). It is an access-management action, not a confirm/create CTA | Visual hierarchy conflict |
| P3 | Duplicate export hint at the Archive section: "Before archiving or making major workspace changes, you may export a workspace JSON backup" — redundant once a dedicated Backup & Export card exists | Confusing copy |
| P4 | Archived Workspaces section appended inline into the single flat card, making it scroll with the main card content | No clear visual separation from active-workspace actions |
| P5 | No semantic grouping — Identity, Backup, Access, and Danger are not visually distinct to the user | Cognitive overload |

---

## B. Target Card Structure

The view-mode render path is reorganized into **four cards** plus one trailing section. The edit-mode form path is **not touched**.

### Card 1 — Workspace Identity
**Container:** `.card.tp3d-settings-card-max`
**Always visible when org data is loaded**

```
[tp3d-settings-card-title]   "Workspace"
[tp3d-settings-org-divider]
  orgRow: Logo
  orgRow: Name
  (Slug row removed 2026-07-18 — hidden pending Phase 2 friendly slugs; do not re-add)
  orgRow: Phone
  orgRow: Address     (if orgData.address_line1)
  orgRow: Role
[tp3d-account-actions]
  [btn btn-primary]  "Edit Workspace"  ← owner/admin only
  [.muted .tp3d-settings-meta .tp3d-settings-mt-md]  "Only admins can edit…"  ← member only
```

**No change to existing gate:** `isOwnerOrAdmin` check stays identical.

---

### Card 2 — Backup & Export
**Container:** `.card.tp3d-settings-card-max`
**Visible when:** `isOwnerOrAdmin && typeof _onExportWorkspace === 'function'`
(Same gate as current export block. Same function call. Same button.)

```
[tp3d-settings-section-heading]  "Backup & Export"
[.muted .tp3d-settings-meta .tp3d-settings-mt-md]
  "Download a JSON backup of this workspace's packs and cases."
[tp3d-account-actions]
  [btn btn-ghost]  "Export Workspace Data"
```

**Change from current:** Extract from divider-inside-main-card into its own sibling card.
**Archive export hint removal:** The second export hint in the Archive section (`archiveExportHint` element, currently at the `archiveDivider` block) is **removed** — it is redundant once this card is visible to the same audience.

---

### Card 3 — Ownership & Access
**Container:** `.card.tp3d-settings-card-max`
**Visible when:** `leaveOrgId && membershipData` (same gate as current)

```
[tp3d-settings-section-heading]  "Ownership & Access"

[if isPrimaryOwner]
  [tp3d-settings-meta muted tp3d-settings-mt-md]
    "Transfer ownership before leaving. You are the primary owner."
  [tp3d-org-feedback tp3d-org-feedback--warning]
    "Transfer ownership before leaving. You are the primary owner."
  [tp3d-account-actions]
    [btn btn-secondary]  "Transfer Ownership"   ← CHANGED from btn-primary to btn-secondary
    (disabled while _transferOwnershipInFlight)

[tp3d-settings-org-divider]  (only if isPrimaryOwner, to separate transfer from leave)

[.muted .tp3d-settings-meta .tp3d-settings-mt-md]
  "Remove yourself from this workspace. You will need a new invite to rejoin."
[tp3d-account-actions]
  [btn btn-danger]  "Leave Workspace"
  (disabled when isPrimaryOwner OR _leaveWorkspaceInFlight)
```

**Change from current:** Extract from divider-separated inline blocks into its own card.
**Button class change:** Transfer Ownership changes `btn btn-primary` → `btn btn-secondary`. No backend change.

---

### Card 4 — Danger Zone
**Container:** `.card.tp3d-settings-card-max`  
**Visible when:** `isPrimaryOwner` (same gate as current archive block)

Uses the existing danger zone classes throughout:

```
[tp3d-settings-danger]
  [tp3d-settings-danger-title]  "Danger Zone"
  [tp3d-settings-danger-divider]
  [tp3d-settings-danger-row]
    [tp3d-settings-danger-left]
      "Archive Workspace"
    [tp3d-settings-danger-right]
      [.muted .tp3d-settings-meta]
        "Archive this workspace. It will be hidden from normal workspace switching."
      [tp3d-settings-danger-msg]  (optional — can hold warning icon if desired later)
      [btn btn-danger]  "Archive Workspace"
      (disabled while _archiveWorkspaceInFlight)
```

**Change from current:** The archive intro + button moves from inside the flat stack into a proper danger-zone card. The `archiveExportHint` node is removed here (covered by Card 2).
**No gate change:** `isPrimaryOwner` check is identical.

---

### Section 5 — Archived Workspaces
**Container:** new `archivedCard` — `.card.tp3d-settings-card-max`  
**Always appended** (when not loading), replacing the current inline append to `viewContainer`

The `appendArchivedWorkspacesSection` function currently takes `(targetEl, currentUserId)`.  
In Phase UI-3, the call site changes:

```js
// BEFORE
appendArchivedWorkspacesSection(viewContainer, currentUserId);

// AFTER
const archivedCard = doc.createElement('div');
archivedCard.className = 'card tp3d-settings-card-max';
appendArchivedWorkspacesSection(archivedCard, currentUserId);
body.appendChild(archivedCard);
```

The function itself is unchanged. Only the container it receives changes.

**Why below Danger Zone, not inside it:**  
- Archived workspaces is a **recovery** action (Restore), not a destructive action  
- A primary owner with 3 archived workspaces would produce a very long danger zone card  
- The `appendArchivedWorkspacesSection` function itself uses `.tp3d-settings-section-heading` (non-danger styling) — consistent with a neutral card

---

## C. Exact Classes to Reuse

All classes used in the target structure are verified to exist in `styles/main.css`. No new CSS is needed.

| Class | Confirmed line | Usage in target |
|---|---|---|
| `card` | ~148 | All four card containers + archived section wrapper |
| `tp3d-settings-card-max` | 1680 | Constrains width to max-width: 820px on all cards |
| `tp3d-settings-section-heading` | 1768 | Card 2, Card 3 headings |
| `tp3d-settings-meta` | 1786 | All intro/description text |
| `tp3d-settings-mt-md` | 1799 | Spacing above description paragraphs |
| `tp3d-account-actions` | 2059 | All action button rows |
| `tp3d-settings-org-divider` | 1513 | Separator inside Card 3 (between transfer and leave) |
| `tp3d-settings-danger` | 1605 | Card 4 outer wrapper |
| `tp3d-settings-danger-title` | 1609 | "Danger Zone" heading in Card 4 |
| `tp3d-settings-danger-divider` | 1615 | Top rule inside Card 4 danger block |
| `tp3d-settings-danger-row` | 1619 | Archive action row in Card 4 |
| `tp3d-settings-danger-left` | 1627 | Archive label in Card 4 |
| `tp3d-settings-danger-right` | 1632 | Archive description + button container |
| `tp3d-settings-danger-msg` | 1643 | Optional warning message in Card 4 |
| `tp3d-org-feedback--warning` | (existing) | Transfer owner warning notice |
| `muted` | (existing) | All descriptive text |
| `btn`, `btn-primary`, `btn-ghost`, `btn-danger` | (existing) | All buttons |

**No new CSS classes required for Phase UI-3.**

---

## D. Code-Change Risk Map

| Change | File | Lines affected (approx) | Risk | Reason |
|---|---|---|---|---|
| Wrap identity rows in card 1 | settings-overlay.js | ~5462–5475, ~5921–5938 | LOW | Adding wrapper div; not touching gate logic |
| Extract export into card 2 | settings-overlay.js | ~5940–5966 | LOW | Moving DOM construction, no logic |
| Extract transfer+leave into card 3 | settings-overlay.js | ~5968–6050 | **MEDIUM** | Must preserve isPrimaryOwner/owner guards exactly; complex disabled logic |
| Remove archiveExportHint (duplicate) | settings-overlay.js | ~6058–6061 | LOW | Delete 5 lines; no gate logic |
| Wrap archive in danger card 4 | settings-overlay.js | ~6062–6090 | LOW | Moving DOM; isPrimaryOwner gate unchanged |
| Change archived section container | settings-overlay.js | ~6095–6100 | LOW | Pass new container instead of viewContainer |
| Transfer Ownership: `btn-primary` → `btn-secondary` | settings-overlay.js | ~6006 | **VERY LOW** | One className string change; zero backend impact |
| orgCard outer still wraps all | settings-overlay.js | ~5468, ~6105 | LOW | Remove `orgCard.appendChild(viewContainer)`; append cards directly to `body` |

**Highest actual risk:** The transfer+leave block (card 3). It has:  
- `isPrimaryOwner` conditional  
- `_leaveWorkspaceInFlight` in-flight guard  
- `_transferOwnershipInFlight` in-flight guard  
- async `showTransferOwnershipModal` call  
- async `leaveWorkspace` call  

None of these gates change — the DOM reorganization only changes _where_ the elements go, not _when_ they appear.

**Edit mode is not touched.** The `if (isEditingOrg && orgData && isOwnerOrAdmin)` branch is entirely separate and stays unchanged.

---

## E. What Not to Touch

| Item | Why |
|---|---|
| Edit mode form (lines ~5500–5720) | Separate branch. Not part of the visual polish. Working correctly. |
| `showTransferOwnershipModal` function | Internal modal, no UI changes needed |
| `leaveWorkspace` async handler | Backend behavior unchanged |
| `archiveWorkspace` async handler | Backend behavior unchanged |
| `appendArchivedWorkspacesSection` function body | Only the call-site container changes |
| `isOwnerOrAdmin` derivation | Leave exactly as-is |
| `isPrimaryOwner` derivation | Leave exactly as-is |
| `leaveOrgId` derivation | Leave exactly as-is |
| `loadAccountBundle`, `loadArchivedWorkspaces` loading paths | No change to data fetching |
| Grace window / skeleton rendering blocks | No change |
| `org-general:lost-access` branch | No change |
| `styles/main.css` | No changes — all classes already exist |
| `src/app.js` | No changes |
| All billing, auth, invite, test files | No changes |

---

## F. Browser Validation Checklist

After Phase UI-3 is applied, manually verify in the browser (http://localhost:8080) before committing:

### Member user (not owner/admin)
- [ ] Card 1 shows: Logo, Name, Phone, Address, Role rows (no Slug row — hidden 2026-07-18)
- [ ] Card 1 shows: "Only admins can edit workspace details." muted note (no Edit button)
- [ ] Card 2 (Backup & Export) is NOT shown
- [ ] Card 3 (Ownership & Access) is shown — Leave button is enabled
- [ ] Card 3 shows NO Transfer Ownership block
- [ ] Card 4 (Danger Zone) is NOT shown
- [ ] Archived Workspaces section is shown below if user owns any archived workspaces

### Admin user (not owner)
- [ ] Card 1 shows Edit Workspace button (btn-primary)
- [ ] Card 2 (Backup & Export) is shown — Export button works
- [ ] Card 3 shows Leave button enabled, no Transfer Ownership block
- [ ] Card 4 NOT shown

### Primary owner user
- [ ] Card 1 shows Edit Workspace button
- [ ] Card 2 shows Export button and clicking it fires the export
- [ ] Card 3 shows Transfer Ownership block (btn-ghost style), then Leave section
- [ ] Transfer Ownership button is disabled when in-flight
- [ ] Leave Workspace button is **disabled** for primary owner
- [ ] Card 4 (Danger Zone) shows Archive Workspace row with btn-danger
- [ ] Archive button confirms with modal, fires archiveWorkspace on confirm
- [ ] After archive: workspace disappears from switcher, card 4 no longer visible
- [ ] Archived Workspaces section shows the newly archived workspace with Restore button
- [ ] Restore button works

### Visual / layout
- [ ] Cards stack cleanly with consistent spacing (no gap collapses)
- [ ] Dark mode: all card backgrounds, dividers, danger-zone red text correct
- [ ] Mobile (≤768px): cards stack single column, danger-row goes single column (responsive breakpoint already handles `.tp3d-settings-danger-row`)
- [ ] No content duplicated (export hint appears once, not twice)
- [ ] Skeleton states still show in card 1 while loading

### Regression
- [ ] Edit mode (clicking "Edit Workspace") still works and saves correctly
- [ ] Cancel edit returns to view mode
- [ ] Workspace switch mid-edit does not leak stale state

---

## G. Phase UI-3 Implementation Prompt Draft

> **Do not execute this prompt now. Use it verbatim as the Phase UI-3 request.**

---

```
Project: Truck Packer 3D
Phase: UI-3 — Workspace General tab card decomposition

Goal:
Restructure the Settings → Workspace → General tab view-mode DOM from a single flat card with dividers into four semantic cards plus one trailing section. No new CSS. No edit-mode changes. No auth/billing/tests/Production changes.

Reference document: docs/product/SETTINGS-WORKSPACE-GENERAL-UI-PLAN.md

Files allowed:
- src/ui/overlays/settings-overlay.js

Do not change:
- styles/main.css (all required classes already exist)
- src/ui/overlays/account-overlay.js
- src/app.js
- billing, auth, session, invite, workspace-switching logic
- tests
- Production/
- package files
- docs

The exact changes:

1. CARD 1 — Workspace Identity
   Keep the existing orgCard as card 1. It already uses .card.tp3d-settings-card-max.
   Keep its title ("General"), divider, and orgRows (Logo/Name/Phone/Address/Role).
   The Slug row was hidden 2026-07-18 (Platform UX/UI Compatibility Closeout) — do not re-add it.
   Keep the Edit Workspace button block and the "Only admins can edit..." note.
   Remove the export, leave, transfer, and archive blocks from inside orgCard/viewContainer.
   These move to separate cards (below).

2. CARD 2 — Backup & Export (owner/admin only)
   Create a new .card.tp3d-settings-card-max sibling.
   Move the export section (current exportWsDivider + exportWsIntro + exportWsActions).
   Replace the divider with a tp3d-settings-section-heading "Backup & Export".
   Gate: same — isOwnerOrAdmin && typeof _onExportWorkspace === 'function'.
   Append card directly to `body` after card 1.

3. CARD 3 — Ownership & Access (shown when leaveOrgId && membershipData)
   Create a new .card.tp3d-settings-card-max sibling.
   Add a tp3d-settings-section-heading "Ownership & Access".
   Move the isPrimaryOwner warning notice, Transfer Ownership button, the
   leaveDivider, leaveIntro, and Leave Workspace button into this card.
   Change Transfer Ownership button class from "btn btn-primary" to "btn btn-secondary".
   Keep all isPrimaryOwner checks, in-flight guards, and async handlers unchanged.
   Append card to `body` after card 2 (or after card 1 if card 2 not rendered).

4. CARD 4 — Danger Zone (primary owner only)
   Create a new .card.tp3d-settings-card-max sibling.
   Inside it, construct the danger zone using existing classes:
     .tp3d-settings-danger wrapper
       .tp3d-settings-danger-title: "Danger Zone"
       .tp3d-settings-danger-divider
       .tp3d-settings-danger-row
         .tp3d-settings-danger-left: "Archive Workspace"
         .tp3d-settings-danger-right
           .muted.tp3d-settings-meta: "Archive this workspace. It will be hidden from normal workspace switching."
           [btn btn-danger] "Archive Workspace"
   Move the archive button event listener unchanged.
   Remove the `archiveExportHint` element (the duplicate export reminder) — covered by card 2.
   Gate: isPrimaryOwner only.
   Append card to `body` after card 3.

5. ARCHIVED WORKSPACES (separate card)
   Create a new archivedCard div: .card.tp3d-settings-card-max
   Change the call from:
     appendArchivedWorkspacesSection(viewContainer, currentUserId);
   to:
     const archivedCard = doc.createElement('div');
     archivedCard.className = 'card tp3d-settings-card-max';
     appendArchivedWorkspacesSection(archivedCard, currentUserId);
     body.appendChild(archivedCard);
   Do NOT change appendArchivedWorkspacesSection itself.

6. BODY APPEND ORDER
   Final append sequence to `body`:
     body.appendChild(orgCard);           // Card 1 — Identity
     if (exportCard) body.appendChild(exportCard);   // Card 2 — Backup & Export
     if (accessCard) body.appendChild(accessCard);   // Card 3 — Ownership & Access
     if (dangerCard) body.appendChild(dangerCard);   // Card 4 — Danger Zone
     if (archivedCard) body.appendChild(archivedCard); // Archived Workspaces

After the edit-mode branch is entered, it still appends orgCard only. No change there.

Rules:
- One file only.
- No new CSS.
- Do not rewrite the file — make targeted insertions and deletions.
- Preserve all gate logic exactly.
- Preserve all in-flight guards exactly.
- Preserve all async handlers exactly.
- Do not touch lines outside the view-mode block (the else branch starting around line 5717).

Validation:
1. npm test
2. npm run lint
3. npm run -s typecheck
4. git diff --check
5. git diff --cached --check

Show the exact git diff before committing.

Commit message: feat(ui): decompose workspace general tab into semantic cards

Final report:
A. Verdict
B. Exact diff (summarized by section)
C. Validation result
D. Commit hash
E. Browser checklist (from SETTINGS-WORKSPACE-GENERAL-UI-PLAN.md § F)
F. Production/ remains untracked yes/no
```

---

*End of plan. No code changes made in this document.*
