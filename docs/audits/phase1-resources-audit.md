# Phase 1 – Resources Audit (Export / Import / Help)

## 1) Topbar buttons

- Export
  - Selector: #btn-export-app in topbar grid ([index.html](index.html#L312-L335)).
  - Binding: wireGlobalButtons in [src/app.js](src/app.js#L2020-L2074) attaches click listener.
  - Action: opens UIComponents.showModal with export details; on confirm builds JSON via
    ImportExport.buildAppExportJSON and downloads via Utils.downloadText.
- Import
  - Selector: #btn-import-app in topbar grid ([index.html](index.html#L312-L335)).
  - Binding: wireGlobalButtons in [src/app.js](src/app.js#L2020-L2074) attaches click listener.
  - Action: calls ImportAppDialog.open() (imports full app JSON via existing dialog).
- Help
  - Selector: #btn-help in topbar grid ([index.html](index.html#L312-L335)).
  - Binding: wireGlobalButtons in [src/app.js](src/app.js#L2075-L2086)).
  - Action: calls HelpModal.open() (existing help modal from createHelpModal).

## 2) Settings modal structure

- Files: [src/ui/overlays/settings-overlay.js](src/ui/overlays/settings-overlay.js).
- Tabs defined in render(): navWrap is populated with makeItem calls for account, preferences,
  org-general, org-billing ([settings-overlay.js](src/ui/overlays/settings-overlay.js#L74-L123)).
- Content is switched in render() branches: account, preferences, org-general, else => billing
  ([settings-overlay.js](src/ui/overlays/settings-overlay.js#L129-L322)).
- Entry/open: SettingsOverlay created in [src/app.js](src/app.js#L185-L211); opened from Account
  Switcher menu item “Settings” in openMenu ([src/app.js](src/app.js#L233-L275)).
- Where to add “Resources” tab: add nav item after preferences in the navWrap block, and add a
  render branch after the preferences branch in settings-overlay.js.

## 3) Reuse notes (for Resources tab buttons)

- Export: reuse ImportExport.buildAppExportJSON + Utils.downloadText (same flow as topbar Export
  modal) from [src/app.js](src/app.js#L2036-L2067).
- Import: reuse ImportAppDialog.open from [src/app.js](src/app.js#L2069-L2071).
- Help: reuse HelpModal.open from [src/app.js](src/app.js#L2075-L2086).
- Modal UI helpers: UIComponents.showModal and UIComponents.showToast already used in export flow.
