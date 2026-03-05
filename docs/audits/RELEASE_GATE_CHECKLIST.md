# RELEASE_GATE_CHECKLIST

## Gate summary
- Overall gate status: **CONDITIONAL PASS**
- Condition: manual browser matrix (TEST_PLAN.md T-010 through T-080) not yet executed in live browsers. All automated checks and code-level analysis pass.

## Required checks

| Check | Requirement | Evidence | Status |
|---|---|---|---|
| Clean build | Static app release process completes without missing assets | No `build` script by design; static release procedure documented below | PASS |
| Tests pass | All automated test suites pass | `npm test` → 10/10 pass | PASS |
| Type safety | TypeScript checker reports zero errors | `npm run typecheck` → 0 errors | PASS |
| Lint clean | No lint errors | `npm run lint` → 0 errors, 18 warnings (HTML-validate `prefer-native-element` only) | PASS |
| Stable data import/export | Invalid inputs rejected safely | Unit tests pass (`tests/audit/import-export.spec.mjs`) | PASS |
| Security issues resolved | No known high-severity unresolved issue | Redirect/XSS/CORS fixed; innerHTML audit clean (0 dangerous sinks); dead code documented | PASS |
| Boot idempotency | App init is single-flight and crash-safe | `initInFlightPromise`/`initCompleted` guards + automated test | PASS |
| Unhandled promise rejections | All async user-facing actions have error handling | AutoPack, export, keyboard shortcuts wrapped in try-catch/.catch() | PASS |
| No unhandled rejections/crashes in automated stress | Stress harness passes | `npm run stress:ui` passes (0 failures, 0 pageErrors, 0 consoleErrors) | PASS |
| Network failure resilience | Offline/slow/error cases don't crash | Code-path static analysis confirms timeout wrappers, error returns, no crash paths | PASS (static) |
| Performance baseline | No obvious regressions/leaks | Static hotspot analysis clean; RAF loop has off-screen short-circuit | PASS (static) |
| Open contradictions assessed | All contradictions resolved or formally accepted | #6 dual storage keys: low risk (orphan files only); #7 dual event bus: low risk (orphan file) | PASS (accepted) |
| Cross-browser matrix | Chrome/Edge/Firefox/Safari desktop+iOS validated | Feature detection fallbacks verified in code; empirical matrix pending | CONDITIONAL |
| Manual E2E flows | Sign-in/out, CRUD, import/export, billing tested in browser | Code-level paths verified; manual execution pending | CONDITIONAL |

## Command evidence (latest audit run — 2026-03-05)
- `npm test` → **PASS (10/10)**
- `npm run typecheck` → **PASS (0 errors)**
- `npm run lint` → **PASS (0 errors, 18 warnings)**
- `npm run stress:ui` → **PASS** (previous run: 3 clicks, 0 failures, 0 pageErrors, 0 consoleErrors)

## Fixes applied in this audit cycle
1. **Init idempotency guard** — `src/app.js`: `initInFlightPromise`/`initCompleted` single-flight wrapper
2. **Typecheck fixes** — `src/app.js`: checkout interval type annotations, `_title`/`_continueLabel` property names
3. **Unhandled promise fixes** — `src/screens/editor-screen.js`: AutoPack try-catch-finally, export .catch(); `src/app.js`: keyboard shortcut .catch()
4. **Prior session fixes** — billing redirect validation, CORS default hardening, import limits, account overlay XSS, import-export validation

## No-build static release procedure
1. Run locally as static app:
   - `python3 -m http.server 5500`
   - Open `http://localhost:5500/index.html`
2. Pre-release validation commands:
   - `npm test`
   - `npm run -s typecheck`
   - `npm run lint`
   - Optional UI stress check: `npm run stress:ui` (while local server is running)
3. Expected console/runtime state:
   - No blocking runtime exceptions in normal flows.
   - No unhandled promise rejections.
   - In non-debug mode, no auth/token/billing sensitive values should be printed.
   - Ignore expected non-blocking favicon 404 if present.
4. Required files/directories for release package:
   - `index.html`
   - `src/`
   - `styles/`
   - `vendor/`
   - `package.json` and `package-lock.json` (for reproducible audit/test environment)
   - `docs/audits/` reports included with release evidence.

## Exit criteria to turn gate fully GREEN
1. Execute TEST_PLAN.md manual matrix (T-010 through T-080) across Chrome, Firefox, Safari desktop, Safari iOS.
2. Record browser console logs and screenshot evidence per browser.
