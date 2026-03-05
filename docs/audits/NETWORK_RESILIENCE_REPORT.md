# NETWORK_RESILIENCE_REPORT

## PASS E — Network chaos testing (simulated)

## Scope
Primary network paths audited:
- Client-to-edge billing calls (`src/data/services/billing.service.js`)
- Auth/session refresh and user resolution (`src/core/supabase-client.js`)
- App-level timeout wrappers (`src/app.js`)

## Chaos scenario matrix

| Scenario | Code path | Expected behavior | Result |
|---|---|---|---|
| Offline / network unreachable | `fetchBillingStatus()` catch (`src/data/services/billing.service.js:475-482`) | Return `{ok:false,error}` without crash | Pass (static + runtime smoke) |
| DNS/TCP failure | `postFn/getFn` + caller catches (`src/data/services/billing.service.js:130-174`, `497-553`) | Surface user-safe error string | Pass (static) |
| Slow 2G / hung request | Timeout race in app wrappers (`src/app.js:861-891`, `5385-5388`) | Timeout message, app remains interactive | Pass (static) |
| HTTP 500 from edge | `!res.ok` handling in billing calls (`src/data/services/billing.service.js:541-543`, `582-584`) | Return failure object, no throw crash | Pass (static) |
| HTTP 401/403 | Edge functions enforce auth/role and return JSON error (`stripe-* functions`) | App receives structured error and shows toast/modal | Pass (static) |
| Malformed JSON response | guarded `res.json()` catches (`src/data/services/billing.service.js:537`, `578`) | Graceful fallback error | Pass (static) |
| Auth API stall | Supabase single-flight timeout fallback (`src/core/supabase-client.js:734-777`, `867-888`) | cached session/user fallback where safe | Pass (static) |
| Infinite retry risk | Billing throttles/locks (`src/app.js:486-512`) | bounded retries and cooldowns | Pass (static) |

## Multi-tab/network interaction
- Cross-tab billing lock + freshness keys prevent redundant simultaneous billing fetch storms (`src/app.js:147-201`, `486-512`).
- Cross-tab logout sync has BroadcastChannel + localStorage fallback (`src/core/supabase-client.js:282-354`).

## Gaps
- End-to-end browser chaos automation (`tests/stress.spec.js`) now runs successfully against local server baseline (3 clicks, 0 failures in latest run).
- Real packet-level throttling/offline verification across browsers still required before green release.

## Verdict
- Crash-resilience under common network failures: **good by code-path design**.
- Fully validated chaos execution in browser matrix: **not complete**.
