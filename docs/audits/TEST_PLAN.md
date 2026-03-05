# TEST_PLAN

## Test environment prerequisites
1. Start app on local HTTP server at repo root:
   - `python3 -m http.server 5500`
2. Open app URL:
   - `http://127.0.0.1:5500/index.html?tp3dDebug=1`
3. For stress automation:
   - `npm i -D playwright`
   - `npx playwright install chromium`

## Automated baseline tests

### T-001: Audit unit tests
- Browser/device: N/A (Node)
- Steps:
  1. Run `npm test`
- Expected:
  - All tests pass (currently 10 tests).
- Failure signals:
  - Any `not ok` subtest.

### T-002: Type safety
- Browser/device: N/A
- Steps:
  1. Run `npm run -s typecheck`
- Expected:
  - Exit code 0.
- Failure signals:
  - TS diagnostic output.

### T-003: Lint quality
- Browser/device: N/A
- Steps:
  1. Run `npm run lint`
- Expected:
  - No errors (warnings currently known).
- Failure signals:
  - Any ESLint/Stylelint/HTML-validate error.

## Manual end-to-end tests

### T-010: Boot/reload idempotency
- Browser/device: Chrome desktop, Firefox desktop, Safari desktop
- Steps:
  1. Open app.
  2. Hard refresh 5 times quickly.
  3. Observe initialization and event behavior.
- Expected:
  - No duplicate overlays/listeners, no console exceptions.
- Failure signals:
  - Duplicate toasts/modals, repeated event side effects, console errors.

### T-020: Auth sign-in/sign-out + refresh
- Browser/device: Chrome desktop
- Steps:
  1. Sign in with test user.
  2. Refresh page.
  3. Sign out.
  4. Refresh again.
- Expected:
  - Session persists across refresh while signed in; clears after sign-out.
- Failure signals:
  - Signed-out user still sees private state, auth errors, stuck loading state.

### T-021: Multi-tab auth sync
- Browser/device: Chrome desktop
- Steps:
  1. Open two tabs in same user/session.
  2. Sign out in tab A.
  3. Observe tab B within 2s.
- Expected:
  - Tab B receives cross-tab logout and transitions to signed-out UI.
- Failure signals:
  - Tab B remains signed in, or enters crash loop.

### T-030: CRUD packs/cases/editor
- Browser/device: Chrome desktop + Safari desktop
- Steps:
  1. Create case, edit case, delete case.
  2. Create pack, add/remove cases in editor.
  3. Save and reload.
- Expected:
  - State persists correctly, no dead buttons.
- Failure signals:
  - Missing updates after save, broken buttons, console exceptions.

### T-040: Import/export app and cases
- Browser/device: Chrome desktop, Firefox desktop
- Steps:
  1. Export app JSON.
  2. Re-import exported JSON.
  3. Import cases CSV with:
     - valid rows
     - duplicate name row
     - invalid dimension row
     - unsupported extension
     - oversize (>10MB)
- Expected:
  - Valid rows imported; invalid rows rejected with clear errors.
- Failure signals:
  - Partial corrupt writes, uncaught exceptions, broken modal state.

### T-050: Offline mode
- Browser/device: Chrome desktop
- Steps:
  1. Open DevTools Network tab.
  2. Set Offline.
  3. Trigger billing refresh/open portal.
- Expected:
  - Helpful error toast/message, app remains usable.
- Failure signals:
  - Blank UI, hard crash, infinite retries.

### T-051: Slow network / timeout
- Browser/device: Chrome desktop
- Steps:
  1. Set throttling to Slow 3G.
  2. Trigger checkout/portal actions.
- Expected:
  - Timeout fallback message appears; UI remains responsive.
- Failure signals:
  - spinner hangs forever, repeated duplicate requests.

### T-060: Billing role gating
- Browser/device: Chrome desktop
- Steps:
  1. Use non-owner org member account.
  2. Attempt checkout/portal actions.
- Expected:
  - Server returns forbidden; UI shows safe error.
- Failure signals:
  - Non-owner allowed into billing management flow.

### T-070: Editor stress
- Browser/device: Chrome desktop
- Steps:
  1. Run `npm run stress:ui` (after Playwright install).
  2. Review `test-results/` artifacts.
- Expected:
  - No fatal failures under repeated click attempts.
- Failure signals:
  - Any crash screenshot/log entry.

### T-080: Cross-browser matrix
- Browser/device: Chrome, Edge, Firefox, Safari desktop, Safari iOS
- Steps:
  1. Execute T-010, T-020, T-030, T-040 subset per browser.
- Expected:
  - No blocking regressions in core flows.
- Failure signals:
  - Browser-specific runtime exceptions, blocked core actions.

## Current audit run status
- Executed: T-001, T-002, T-003, T-070.
- T-070 result: PASS in current run (3 clicks, 0 failures, 0 console/page errors).
- Pending manual matrix: T-010/T-020/T-021/T-030/T-040/T-050/T-051/T-060/T-080.
