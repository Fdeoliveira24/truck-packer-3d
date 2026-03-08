# CROSS_BROWSER_REPORT

## PASS I — Cross-browser + device matrix

## Feature detection coverage in code
- WebGL capability check: `src/core/browser.js:71-77`, used during boot at `src/app.js:3889`.
- BroadcastChannel with fallback to localStorage events:
  - billing channel: `src/app.js:141-145`
  - auth logout sync: `src/core/supabase-client.js:282-325`
- File API checks before import parse: `src/services/import-export.js:109-115`.
- Clipboard optional checks in settings invites: `src/ui/overlays/settings-overlay.js:1347-1348`, `1420-1421`.
- Storage guarded in try/catch across app and supabase client (multiple sites).

## Browser matrix (execution status)

| Browser/device | Boot/load | Auth/session | Billing flows | Import/export | Notes |
|---|---|---|---|---|---|
| Chrome (desktop) | Not executed in this audit run | Not executed | Not executed | Not executed | Expected compatible by feature set |
| Edge (desktop) | Not executed | Not executed | Not executed | Not executed | Expected compatible by Chromium parity |
| Firefox (desktop) | Not executed | Not executed | Not executed | Not executed | checkBrowserSupport warns <88 (`src/app.js:6483-6489`) |
| Safari desktop | Not executed | Not executed | Not executed | Not executed | checkBrowserSupport warns <13.1 (`src/app.js:6475-6481`) |
| Safari iOS | Not executed | Not executed | Not executed | Not executed | Must validate clipboard/storage behavior on device |

## PASS/FAIL summary
- Static feature fallback readiness: **Pass**.
- Empirical cross-browser execution matrix: **Fail (not yet run)**.

## Required follow-up to pass release gate
1. Run manual matrix on Chrome, Edge, Firefox, Safari desktop, Safari iOS.
2. Execute `TEST_PLAN.md` browser-specific cases.
3. Capture console logs and screenshot evidence per browser.
