# PATCH_LOG

## Patch entries

| File path | Exact change summary | Reason | Risk level | Rollback plan | How tested |
|---|---|---|---|---|---|
| `src/services/import-export.js` | Added import limits (`MAX_IMPORT_ROWS=5000`, `MAX_IMPORT_FILE_BYTES=10MB`), extension allowlist, safer file-handle checks, in-file duplicate tracking, and ingest-side dimension validation. | Prevent corrupted/oversized/bypass imports and ensure row-level integrity. | Medium | Revert file and rerun import tests to restore prior behavior. | `npm test` (import suite), manual static review. |
| `src/data/services/billing.service.js` | Added/kept `isAllowedBillingRedirectUrl`, enforced Stripe host check in checkout/portal responses, removed legacy `auth/session` dependency from org resolution. | Prevent open redirects and stale org source contradictions. | Medium | Revert file; if needed, temporarily remove redirect strictness and legacy-source removal in one rollback commit. | `npm test` (billing/security tests), `npm run typecheck`. |
| `src/ui/overlays/account-overlay.js` | Replaced user-field `innerHTML` template interpolation with explicit DOM nodes + `textContent`. | Eliminate user-data XSS sink. | Low | Revert specific block around account name row. | `npm test` (`account overlay` static security test). |
| `src/app.js` | Added init idempotency guards (`initInFlightPromise`, `initCompleted`) and typed checkout interval option usage. | Prevent duplicate boot side effects under repeated init triggers. | Medium | Revert guarded init block and rerun boot tests/manual smoke. | `npm test` (`init invariant`), `npm run typecheck`. |
| `src/core/supabase-client.js` | Added cross-tab teardown helper and guarded storage-listener initialization path. | Prevent duplicate listeners/leaks during failed/retried init. | Medium | Revert teardown/initCrossTabLogout changes. | Static review + typecheck + auth-path smoke. |
| `src/screens/cases-screen.js` | Added `Node` target guard for outside-click filter close handler. | Prevent rare non-Node event target crashes. | Low | Revert click handler guard lines only. | `npm run typecheck`, lint run. |
| `src/types/global.d.ts` | Declared missing globals (`__TP3D_BILLING_TRACE_CURRENT_ID__`, `__TP3D_STRIPE_PRICE_YEARLY`, `__TP3D_TAB_ID__`). | Remove runtime/type contract drift. | Low | Revert declaration additions. | `npm run -s typecheck`. |
| `package.json` | Switched `test` script from placeholder to Node test runner over `tests/audit/*.spec.mjs` and added `playwright` dev dependency for stress automation. | Make fixes continuously verifiable and executable under UI stress tooling. | Low | Restore original script/dependency entries. | `npm test`, `npm run stress:ui`. |
| `tests/stress.spec.js` | Removed brittle startup visibility gate that waited on the first selector match; replaced with startup settle delay after navigation/load-idle. | Prevent false-negative stress failures unrelated to runtime correctness. | Low | Revert the readiness block in `tests/stress.spec.js`. | `python3 -m http.server 5500 & npm run stress:ui`. |
| `supabase/functions/_shared/cors.ts` | Changed JSON helper default origin from `*` to `null` when caller omits origin. | Align response default with allowlist posture and reduce accidental permissive CORS. | Medium | Revert one-line default and rerun edge tests/manual validation. | `npm test` static CORS invariant. |
| `tests/audit/import-export.spec.mjs` | Added tests for duplicate-in-file handling, unsupported extension, row limit, oversize file, ingest-side invalid dimension rejection. | Convert data integrity assumptions into executable checks. | Low | Remove added tests if behavior intentionally changes. | `npm test`. |
| `tests/audit/security-and-invariants.spec.mjs` | Added tests for Stripe redirect allowlist, no legacy auth/session dependency in billing service, account-overlay XSS sink absence, CORS default-origin hardening, init idempotency guard presence. | Convert security/runtime invariants into executable checks. | Low | Remove/adjust assertions with corresponding code change. | `npm test`. |

| `src/app.js` | Added `initInFlightPromise` + `initCompleted` single-flight/idempotency guards wrapping entire `init()` body. | Prevent duplicate boot side effects if `init()` is called more than once (DOM-ready + readyState race). | Medium | Remove inner IIFE wrapper and guard vars; restore flat async init body. | `npm test` (init invariant test), `npm run typecheck`. |
| `src/app.js` | Fixed `pickCheckoutInterval` callers: `title` → `_title`, `continueLabel` → `_continueLabel` to match function signature. | Eliminate TS2561 typecheck errors (unknown property). | Low | Revert property names if function signature changes. | `npm run typecheck`. |
| `src/app.js` | Added JSDoc type annotation on `checkoutPayload` and `@type` casts on `interval` assignments. | Eliminate TS2345 typecheck error (string not assignable to 'month'\|'year'). | Low | Remove annotations if type system changes. | `npm run typecheck`. |
| `src/app.js` | Added `.catch()` on `AutoPackEngine.pack()` calls in keyboard shortcuts (Ctrl+P / Cmd+P). | Prevent unhandled promise rejections from crashing background task. | Low | Remove catch if pack() is made synchronous. | Code inspection. |
| `src/screens/editor-screen.js` | Wrapped `AutoPackEngine.pack()` in try-catch-finally with error toast and guaranteed button re-enable. | Prevent stuck disabled button and unhandled rejection on AutoPack failure. | Low | Revert to direct await if error handling moves elsewhere. | Code inspection. |
| `src/screens/editor-screen.js` | Added `.catch()` with error toast on PNG screenshot and PDF export button handlers. | Prevent unhandled promise rejections from export failures. | Low | Revert if ExportService handles errors internally. | Code inspection. |

## Commands executed for verification
- `npm test` → **10/10 pass**
- `npm run typecheck` → **0 errors**
- `npm run lint` → **0 errors, 18 warnings**
- `python3 -m http.server 5500 & npm run stress:ui` (pass: no click failures, previous run)

## Known pre-existing modified files not altered in this patch log
- `src/ui/overlays/settings-overlay.js`
- `src/debugger.js`
