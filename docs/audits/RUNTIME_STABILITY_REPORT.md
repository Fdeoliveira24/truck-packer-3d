# RUNTIME_STABILITY_REPORT

## PASS B — Boot + initialization idempotency

### Findings
- `init()` is now single-flight and idempotent:
  - guard vars: `src/app.js:5410-5411` (`let initInFlightPromise = null; let initCompleted = false;`)
  - guard checks: `src/app.js:5414-5415` (`if (initInFlightPromise) return; if (initCompleted) return;`)
  - inner IIFE wrapper with `.finally()` sets `initCompleted = true` and clears in-flight promise
- Cross-tab auth listener setup has explicit teardown path on init failure:
  - setup: `src/core/supabase-client.js:282-325`
  - teardown: `src/core/supabase-client.js:262-280`
  - failure path invokes teardown: `src/core/supabase-client.js:1494-1499`
- Settings overlay re-open path reuses a single live instance instead of recreating listeners:
  - `src/ui/overlays/settings-overlay.js:5123-5132`

## PASS D — Async + race condition forensics

### Checked patterns
- `Promise.race` timeout wrappers around billing and auth bootstrap:
  - billing timeout: `src/app.js:861-891`
  - auth bootstrap timeout: `src/app.js:5385-5388`
- Cross-tab billing de-dup lock/freshness windows:
  - lock/fresh keys: `src/app.js:147-148`
  - lock acquire/release: `src/app.js:154-183`
  - freshness checks: `src/app.js:188-201`
- Supabase single-flight wrappers + cooldown logic:
  - `src/core/supabase-client.js:886`, `src/core/supabase-client.js:1080`, `src/core/supabase-client.js:1527`

### Residual race risk
- High churn area remains `src/app.js` (graph churn score 98); keep regression focus on auth/org/billing transitions.

## INVARIANTS

| Invariant | Guard in code | Validation method | Status |
|---|---|---|---|
| App boot must be idempotent | `initInFlightPromise`/`initCompleted` (`src/app.js:5410-5415`) | Automated static test (`tests/audit/security-and-invariants.spec.mjs:40-45`) | Pass |
| No duplicate cross-tab logout listeners survive failed init | `teardownCrossTabLogout()` and init catch (`src/core/supabase-client.js:262-280`, `1494-1499`) | Code inspection + repeated init path review | Pass |
| Billing gate application must never crash UI | try/catch around gate applier (`src/app.js:311-318`) | Code inspection + smoke boot | Pass |
| Billing refresh must not spam network across tabs | lock/fresh throttles (`src/app.js:147-201`, `486-512`) | Code inspection + debug traces | Pass (static) |
| Sign-out clears auth-related local/session storage | `clearLocalAuthStorage()` (`src/core/supabase-client.js:1740+`) | Code inspection | Pass |
| Import failures must not partially ingest invalid rows | row guard in parser + ingest (`src/services/import-export.js:165-186`, `208-216`) | Automated tests (`tests/audit/import-export.spec.mjs`) | Pass |
| Billing redirects must be origin-validated | allowlist check (`src/data/services/billing.service.js:242-253`, `544-547`, `585-588`) | Automated test (`tests/audit/security-and-invariants.spec.mjs:10-21`) | Pass |
| Overlay close must restore keyboard trap/listeners | settings close cleanup (`src/ui/overlays/settings-overlay.js:1531-1548`, `1550-1562`) | Code inspection + manual checklist | Pass |
| CORS helper must not default to wildcard allow-origin | `allowOrigin = opts.origin ?? "null"` (`supabase/functions/_shared/cors.ts:75`) | Automated static test (`tests/audit/security-and-invariants.spec.mjs:34-38`) | Pass |
| Unhandled promise failures should degrade to user-visible errors, not crash | try-catch in AutoPack button (`src/screens/editor-screen.js:1330-1339`), `.catch()` on export handlers (`src/screens/editor-screen.js:1339-1348`), `.catch()` on keyboard shortcuts (`src/app.js:3819,3823`) | Code inspection + lint/runtime smoke | Pass |

## PASS J — Final regression run
- `npm test`: pass (`10/10`)
- `npm run -s typecheck`: pass (`TYPECHECK_EXIT:0`)
- `npm run lint`: pass with warnings only (`0 errors`)
- `python3 -m http.server 5500 & npm run stress:ui`: pass (summary emitted, no click failures).
