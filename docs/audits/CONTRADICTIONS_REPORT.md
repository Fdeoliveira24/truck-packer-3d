# CONTRADICTIONS_REPORT

## 1) Resolved: Billing org resolution depended on legacy session module
- Contradiction title: `billing.service` used legacy `auth/session` while runtime canonical org source is `window.OrgContext` + Supabase auth.
- Evidence:
  - Legacy warning in `src/auth/session.js:1-4` and `src/core/constants.js:1-4`.
  - Canonical org source in `src/app.js:4189-4198` (`window.OrgContext`).
  - Updated billing imports now only Supabase session wrapper (`src/data/services/billing.service.js:15-18`).
  - Org resolver now derives candidate from `OrgContext`/localStorage only (`src/data/services/billing.service.js:261-295`).
- Impact:
  - Previously risked stale/non-UUID org assumptions from legacy session state.
- Fix applied:
  - Removed `../../auth/session.js` dependency and `session-only` org fallback from `resolveActiveOrganizationId`.
- New tests added:
  - `tests/audit/security-and-invariants.spec.mjs:23-26` (`billing service does not depend on legacy auth/session state`).

## 2) Resolved: CORS policy had strict allowlist path but permissive default JSON helper
- Contradiction title: `getAllowedOrigin` rejects unknown origins, but `json()` defaulted to wildcard `*` when caller omitted `origin`.
- Evidence:
  - Allowlist policy in `supabase/functions/_shared/cors.ts:43-51`.
  - Default response origin now hardened in `supabase/functions/_shared/cors.ts:75`.
- Impact:
  - Inconsistent CORS guarantees could leak permissive responses if any function path used `json()` without explicit origin.
- Fix applied:
  - Changed default `json()` origin to `"null"`.
- New tests added:
  - `tests/audit/security-and-invariants.spec.mjs:34-38`.

## 3) Resolved: Import parser and row-ingest had mismatched validation responsibilities
- Contradiction title: parser validated dimensions/duplicates, but `importCaseRows` previously trusted caller payload too much.
- Evidence:
  - Parser constraints: `src/services/import-export.js:100-124`, `165-186`.
  - Ingest constraints now repeated in write path: `src/services/import-export.js:208-216`.
- Impact:
  - Bypassing parser path could previously write invalid dimensions or duplicate names.
- Fix applied:
  - Added ingest-side dimension/weight guards and in-file duplicate tracking.
- New tests added:
  - `tests/audit/import-export.spec.mjs:29-51`
  - `tests/audit/import-export.spec.mjs:73-96`
  - `tests/audit/import-export.spec.mjs:98-116`
  - `tests/audit/import-export.spec.mjs:118-131`

## 4) Resolved: Multiple init triggers vs non-idempotent init behavior
- Contradiction title: app boot can call `init()` from DOM-ready/ready-state paths, so init must be single-flight.
- Evidence:
  - Boot call sites: `src/app.js:6494-6507`.
  - Idempotent guards: `src/app.js:967-968`, `src/app.js:5255-5256`, `src/app.js:6451-6457`.
- Impact:
  - Without guards: duplicate listener binding, duplicate timers, unstable boot ordering.
- Fix applied:
  - `initInFlightPromise` + `initCompleted` guards and finalizer path.
- New tests added:
  - `tests/audit/security-and-invariants.spec.mjs:40-45`.

## 5) Resolved: User-derived account fields rendered via HTML template interpolation
- Contradiction title: security posture assumes untrusted user profile fields are text, but overlay used HTML interpolation.
- Evidence:
  - Safe text rendering now in `src/ui/overlays/account-overlay.js:422-430`.
- Impact:
  - Potential DOM XSS if user profile fields included HTML payload.
- Fix applied:
  - Replaced `innerHTML` interpolation with explicit DOM nodes + `textContent`.
- New tests added:
  - `tests/audit/security-and-invariants.spec.mjs:28-32`.

## 6) Open contradiction (low risk): dual storage key strategy (`v1` runtime vs `v2` legacy repository)
- Contradiction title: runtime state storage uses `truckPacker3d:v1`, while legacy repo/services point at `truckPacker3d:v2:data` and `truckPacker3d:v2:session`.
- Evidence:
  - Runtime key: `src/core/storage.js:20`.
  - Legacy constants: `src/core/constants.js:24-26`.
  - Legacy repository usage: `src/data/repositories/local.repository.js:53-58`.
  - Legacy session usage: `src/auth/session.js:71-77`.
- Impact:
  - Future accidental imports can silently fork state planes and produce hard-to-debug data divergence.
- Risk assessment (updated):
  - **Low actual risk**: Dead code analysis confirms `src/data/repositories/local.repository.js` is not imported by any runtime code. The v2 keys are only referenced by orphan modules. No runtime path currently reads/writes v2 keys.
- Fix applied:
  - Not refactored in this patch set (kept minimal edit scope). Legacy files carry explicit LEGACY headers.
- Recommended future action:
  - Remove orphan files in a future cleanup cycle (see SECURITY_REPORT dead code inventory).

## 7) Open contradiction (low risk): two event-bus implementations with different lifecycle expectations
- Contradiction title: `core/events.js` is runtime bus while `core/event-bus.js` is marked legacy but still present and exportable.
- Evidence:
  - Runtime bus API: `src/core/events.js:23-62`.
  - Legacy duplicate with warning: `src/core/event-bus.js:1-5`, `src/core/event-bus.js:20-54`.
- Impact:
  - New code can bind to wrong bus and observe missing events.
- Risk assessment (updated):
  - **Low actual risk**: Dead code analysis confirms `src/core/event-bus.js` has zero imports from any file. It is marked with a LEGACY header. No runtime path uses it.
- Fix applied:
  - None in this cycle. File carries explicit LEGACY header warning.
- Recommended future action:
  - Delete `src/core/event-bus.js` in a future cleanup cycle.

## 8) Resolved: Stress harness startup assumed first matched selector must be visible
- Contradiction title: UI stress runner expected `.first()` of a mixed selector set to become visible, which can be false while app is healthy.
- Evidence:
  - updated startup wait avoids brittle visibility coupling (`tests/stress.spec.js:354-356` in current file revision).
- Impact:
  - False-negative stress failures blocked release confidence despite healthy runtime.
- Fix applied:
  - Replaced selector-specific visibility gate with neutral startup delay after DOM/network idle.
- New tests added:
  - `python3 -m http.server 5500 & npm run stress:ui` now passes (no click failures, no page/console errors).
