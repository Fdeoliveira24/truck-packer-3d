# FORENSIC_CODEBASE_MAP

## Audit Scope
- Project root: `/Users/franciscooliveira/Library/CloudStorage/Dropbox/360Virtual Tour Solutions/Projects/Truck Packer 3D`
- Audit date: 2026-03-04 (America/New_York)
- Method: static code forensics + dependency graph + local quality gates (`npm test`, `npm run typecheck`, `npm run lint`, `npm run stress:ui`)

## PASS A — Full Repo Index + Graph

### Repro commands
```bash
git ls-files | sort
node tools/app-graph.js
node -e "const g=require('./tools/tp3d-graph.json'); console.log(g.summary)"
```

### Index summary
- Tracked files: `174` (`git ls-files`)
- Working-tree untracked files relevant to runtime/audit: `src/debugger-old.js`, `tests/audit/*`, `tools/*`
- Import graph (`tools/tp3d-graph.json`):
  - Nodes: `68`
  - Edges: `109`
  - Cycles: `0`
  - Orphans (excluding known entrypoints `src/app.js`, `src/debugger.js`): `15`

### Orphan modules (no incoming imports in runtime graph)
- `src/auth/permissions.js`
- `src/core/event-bus.js`
- `src/core/state.js`
- `src/data/models/org.model.js`
- `src/data/models/user.model.js`
- `src/data/services/analytics.service.js`
- `src/data/services/cases.service.js`
- `src/data/services/collaboration.service.js`
- `src/data/services/maps.service.js`
- `src/data/services/packs.service.js`
- `src/data/services/users.service.js`
- `src/debugger-old.js`
- `src/features/editor/model-loader.js`
- `src/router.js`
- `src/types/global.d.ts`

### Runtime ownership map (who boots what)
1. `index.html` bootstraps `window.__TP3D_BOOT` and vendor fallback machinery (`index.html:28`, `index.html:131`, `index.html:145`).
2. `index.html` sets runtime config globals (`window.__TP3D_SUPABASE`, Stripe price IDs) (`index.html:1001-1010`).
3. `index.html` loads `src/app.js` as module (`index.html:1028`).
4. `src/app.js` creates `window.TruckPackerApp` (`src/app.js:956`) and calls `window.TruckPackerApp.init()` from `boot()` (`src/app.js:6494-6507`).
5. `init()` validates runtime, initializes Supabase wrapper, binds app events/UI, renders screens (`src/app.js:5254-6457`).

## SINGLE SOURCE OF TRUTH LISTS

### 1) Boot / init sequence
1. Vendor readiness + fallback: `index.html:23-235`, `src/app.js:3898-3905`.
2. Browser capability check + boot dispatch: `src/app.js:6473-6508`.
3. Idempotent app init guard:
   - `let initInFlightPromise = null` (`src/app.js:5410`)
   - `let initCompleted = false` (`src/app.js:5411`)
   - guard checks (`src/app.js:5414-5415`)
   - finalization via `.finally()` (`src/app.js:6624-6627`)
4. Supabase init and retry-on-vendor-ready (`src/app.js:5280-5378`).
5. Auth gate bootstrap + invite recovery (`src/app.js:5380-5499`).

### 2) Auth state + session state
- Canonical runtime auth store: `_authState` in `src/core/supabase-client.js:57`.
- Auth epoch invalidation: `_authEpoch` (`src/core/supabase-client.js:70`) and `updateAuthState` (`src/core/supabase-client.js:576`).
- Public auth/session getters:
  - `getSession()` (`src/core/supabase-client.js:1513`)
  - `getUser()` (`src/core/supabase-client.js:1518`)
  - `awaitAuthReady()` (`src/core/supabase-client.js:1527`)
- Cross-tab logout propagation:
  - BroadcastChannel + localStorage fallback (`src/core/supabase-client.js:282-354`)
  - teardown on init failure (`src/core/supabase-client.js:1498`)

### 3) Org/workspace context
- Canonical org API surface: `window.OrgContext` (`src/app.js:4189-4198`).
- Active org writer + event emitter: `setActiveOrgId` (`src/app.js:4142-4187`) emits `tp3d:org-changed` (`src/app.js:4179`).
- Local org hint key owner: `ORG_CONTEXT_LS_KEY='tp3d:active-org-id'` (`src/app.js:3963`, `src/app.js:4217`).
- Workspace ready event: `tp3d:workspace-ready` dispatch/listen (`src/app.js:4535`, `src/app.js:4553`).

### 4) Billing/subscription gating
- Canonical billing snapshot API: `window.__TP3D_BILLING` (`src/app.js:897`).
- Gate hook + safe invocation: `applyAccessGateFromBilling` (`src/app.js:311-318`).
- Billing refresh owner: `refreshBilling` (`src/app.js:412`), including cross-tab lock/freshness.
- Checkout/portal dispatch with timeout wrappers: `startCheckout`/`openBillingPortal` (`src/app.js:823-891`).
- Edge-client layer: `src/data/services/billing.service.js`.

### 5) Import/export schemas and versioning
- App version constant: `APP_VERSION='1.0.0'` (`src/core/version.js:14`).
- Persistent app payload schema includes `{version,savedAt,caseLibrary,packLibrary,preferences,currentPackId}` (`src/core/storage.js:134-141`).
- App export schema includes `{app,version,exportedAt,data}` (`src/core/storage.js:166-179`).
- App import validation requires `caseLibrary`, `packLibrary`, `preferences` (`src/core/storage.js:181-191`).
- Pack export schema includes `{app,version,exportedAt,pack,bundledCases}` (`src/services/import-export.js:244-251`).
- Spreadsheet import contract:
  - required columns: `name,length,width,height` (`src/services/import-export.js:130-133`)
  - max rows `5000` (`src/services/import-export.js:20`, `src/services/import-export.js:122-124`)
  - max file size `10MB` (`src/services/import-export.js:21`, `src/services/import-export.js:103-106`)

### 6) UI overlay/modal management rules
- Global modal root: `#modal-root` (`index.html:981`).
- Generic modal primitive owner: `createUIComponents().showModal` (`src/ui/ui-components.js:99-179`).
- Settings overlay singleton/idempotent open-reuse:
  - open reuse path (`src/ui/overlays/settings-overlay.js:5123-5132`)
  - close cleanup path (`src/ui/overlays/settings-overlay.js:1503-1562`)
  - focus trap + escape close (`src/ui/overlays/settings-overlay.js:5172-5201`)
- System overlay owner: `createSystemOverlay` (`src/ui/system-overlay.js:14-42`).

### 7) Storage keys

#### localStorage keys
- `truckPacker3d:v1` (core app state base key): `src/core/storage.js:20`
- `truckPacker3d:v1:<userId>` scoped variant: `src/core/storage.js:40`
- `truckPacker3d:session:v1` legacy core session: `src/core/session.js:17`
- `tp3d:active-org-id`: `src/app.js:3963`, `src/app.js:4217`
- `tp3d:billing:lock:<orgId|none>`: `src/app.js:147`
- `tp3d:billing:fresh:<orgId|none>`: `src/app.js:148`
- `tp3d-logout-trigger`: `src/core/supabase-client.js:341`
- `tp3d_trial_modal_shown_<orgId>`: `src/ui/overlays/settings-overlay.js:2226`
- `tp3dDebug`: multiple readers/writers (example `src/app.js:5274`, `src/debugger.js:1303`)

#### sessionStorage keys
- `__tp3d_tab` tab id: `src/core/supabase-client.js:157`, `src/ui/overlays/settings-overlay.js:189`
- `tp3d:auth-user-switch-reload`: `src/app.js:4004`
- `tp3d:pending_invite_token`: `src/app.js:5421`
- `tp3d:billing:status:<orgId>`: `src/app.js:6197-6201`
- `tp3d:settings:activeTab`: `src/ui/overlays/settings-overlay.js:88`

#### indexedDB
- No indexedDB usage found in source scan.

### 8) Global objects on `window`
- Boot/config/runtime globals:
  - `__TP3D_BOOT` (`index.html:28`)
  - `__TP3D_SUPABASE` (`index.html:1001`, augmented at `src/core/supabase-client.js:3167`)
  - `__TP3D_STRIPE_PRICE_MONTHLY` (`index.html:1009`)
  - `__TP3D_STRIPE_PRICE_YEARLY` (`index.html:1010`)
  - `__TP3D_BILLING` (`src/app.js:897`)
  - `__TP3D_UI` (`src/app.js:936`)
  - `OrgContext` (`src/app.js:4197`)
  - `TruckPackerApp` (`src/app.js:956`)
- Diagnostics globals:
  - `__TP3D_DIAG__` (`src/debugger.js:1326`)
  - `__TP3D_SUPABASE_API` (`src/core/supabase-client.js:3163`)
  - `__TP3D_SUPABASE_CLIENT` (`src/core/supabase-client.js:1398`)

### 9) Events: names, emitters, listeners

#### Internal event bus (`core/events`)
- API: `on/off/emit/once` (`src/core/events.js:23-54`)
- emitted event names found:
  - `app:error` (`src/core/app-helpers.js:43`)
  - `auth:changed` (`src/app.js:5600`)
  - `theme:apply` (`src/services/preferences-manager.js:23`)
  - `preferences:changed` (`src/services/preferences-manager.js:36`)
  - `session:changed`, `session:error` (`src/core/session.js:50`, `src/core/session.js:54`)
  - storage events (`src/core/storage.js:52-193`)

#### DOM custom events (`window.dispatchEvent(new CustomEvent(...))`)
- `tp3d:auth-signed-out` emitter: `src/core/supabase-client.js:401`, `src/core/supabase-client.js:545`, `src/core/supabase-client.js:1848`
- `tp3d:auth-error` emitter: `src/core/supabase-client.js:454`
- `tp3d:org-changed` emitter: `src/app.js:4179`, `src/app.js:4650`
- `tp3d:workspace-ready` emitter: `src/app.js:4535`

#### Key listeners
- `tp3d:auth-signed-out`: `src/app.js:1220`, debugger listeners (`src/debugger.js:1088`)
- `tp3d:org-changed`: `src/app.js:5672`, settings overlay (`src/ui/overlays/settings-overlay.js:846`), debugger
- `tp3d:workspace-ready`: `src/app.js:4553`
- `storage`: `src/app.js:5647`, `src/core/supabase-client.js:319`

## PASS C — UI Interaction Checklist (forensic table)

| Area | Entry point | Handler presence | Double-fire guard | Cleanup/focus behavior | Status |
|---|---|---|---|---|---|
| App boot | `src/app.js:6494` | Yes | Idempotent `initInFlightPromise` guard | N/A | Pass |
| Settings overlay | `src/ui/overlays/settings-overlay.js:5114` | Yes | Open-reuse and epoch guards (`5123`, `106+`) | Escape/focus trap + cleanup (`5172-5221`, `1503-1562`) | Pass |
| Auth signed-out handling | `src/app.js:1220` | Yes | Single listener in init chain | Calls `renderAuthState` + safe signout path | Pass |
| Cases filter popup close | `src/screens/cases-screen.js:88-95` | Yes | Node-typed target guard | Outside-click close persists prefs | Pass (fixed guard) |
| Account overlay close | `src/ui/overlays/account-overlay.js:405-410` | Yes | N/A | close callback removes overlay | Pass |
| System overlay retry | `src/ui/system-overlay.js:20` | Yes | N/A | Reload only | Pass |
| Stress-click matrix | `tests/stress.spec.js` | Script exists | Candidate de-dup + max click cap | Executes with local server and records no click failures | Pass |

## PASS J — Final regression scan (post-fix)
- Re-ran dependency graph (`node tools/app-graph.js`): no cycles introduced.
- Re-ran tests: `10/10` passing.
- Re-ran typecheck: pass.
- Re-ran lint: no errors, warnings remain.

## Full Tracked File Index
Generated with `git ls-files | sort` at audit time.

```text
.depcheckrc
.editorconfig
.gitignore
.htmlvalidate.json
.prettierignore
.prettierrc
.stylelintignore
.stylelintrc.cjs
MIGRATION_PHASE1.md
README.md
cleanup-docs/AUDIT_APP_STRUCTURE.md
cleanup-docs/AUDIT_PACK_PREVIEW_AND_FILTERS.md
cleanup-docs/ESLINT_WARNINGS_SUMMARY.md
cleanup-docs/QUICKSTART.md
cleanup-docs/README.md
cleanup-docs/REPO_MAP_PACK_PREVIEW.md
cleanup-docs/SETUP_SUMMARY.md
cleanup-docs/github-raw-urls.md
cleanup-docs/reports/.gitkeep
cleanup-docs/scripts/eslint-report.mjs
docs/P0.6-DB-HEALTH-CHECKLIST.md
docs/PROJECT_TREE.md
docs/SUPABASE_CURRENT_STATE_02_07_2026-V1.md
docs/Supabase SQL migrations Stripe Setup v1 - 02-09-2026.md
docs/Supabase SQL migrations Stripe Setup v2 - 02-11-2026.md
docs/TP3D-MASTER-TODO-V2.md
docs/TP3D-MASTER-TODO-V3.md
docs/TP3D_BILLING_FIXES_02_12_2026.md
docs/account-deletion-audit.md
docs/audits/P0_OWNER_ONLY_BILLING_AUDIT.md
docs/audits/css-audit-footer-overlay.md
docs/audits/phase1-resources-audit.md
docs/audits/ui-rearrangement-audit.md
docs/auth-session-race-audit-2026-02-05.md
docs/autopack-logic-v2.md
docs/autopack-logic.md
docs/billing-status-curl.md
docs/browser-diagnostics.md
docs/local-supabase-setup.md
docs/settings-tab-desync-audit.md
docs/stripe-functions-secrets-checklist.md
docs/tp3d-supabase-infra-record-2026-02-03.md
docs/tp3d-supabase-issue-summary-2026-02-03.md
docs/truck-packer-supabase-current-state.md
docs/truck-packer3d-supabase-billing-status-setup.md
docs/ui-bug-fixes-2026-01-29.md
eslint-report.json
eslint.config.js
grep_createClient.txt
grep_getClientAuth.txt
grep_getSession.txt
grep_getUser.txt
grep_windowSupabase.txt
index.html
knip.json
package.json
src/CLAUDE.md
src/app.js
src/auth/permissions.js
src/auth/session.js
src/config/features.js
src/config/plans.js
src/config/roles.js
src/core/app-helpers.js
src/core/browser.js
src/core/constants.js
src/core/defaults.js
src/core/dev/dev-helpers.js
src/core/event-bus.js
src/core/events.js
src/core/normalizer.js
src/core/session.js
src/core/state-store.js
src/core/state.js
src/core/storage.js
src/core/supabase-client.js
src/core/utils.js
src/core/utils/index.js
src/core/version.js
src/data/models/case.model.js
src/data/models/org.model.js
src/data/models/pack.model.js
src/data/models/user.model.js
src/data/repositories/base.repository.js
src/data/repositories/local.repository.js
src/data/services/analytics.service.js
src/data/services/billing.service.js
src/data/services/cases.service.js
src/data/services/collaboration.service.js
src/data/services/maps.service.js
src/data/services/packs.service.js
src/data/services/users.service.js
src/data/trailer-presets.js
src/debugger.js
src/editor/geometry-factory.js
src/editor/scene-runtime.js
src/features/editor/model-loader.js
src/router.js
src/screens/cases-screen.js
src/screens/editor-screen.js
src/screens/packs-screen.js
src/services/case-library.js
src/services/category-service.js
src/services/cog-service.js
src/services/import-export.js
src/services/oog-service.js
src/services/pack-library.js
src/services/preferences-manager.js
src/types/global.d.ts
src/ui/helpers/import-dialog-utils.js
src/ui/overlays/account-overlay.js
src/ui/overlays/auth-overlay.js
src/ui/overlays/card-display-overlay.js
src/ui/overlays/help-modal.js
src/ui/overlays/import-app-dialog.js
src/ui/overlays/import-cases-dialog.js
src/ui/overlays/import-pack-dialog.js
src/ui/overlays/settings-overlay.js
src/ui/system-overlay.js
src/ui/table-footer.js
src/ui/ui-components.js
src/utils/debounce.js
src/utils/json.js
src/utils/uuid.js
src/vendor/loader.js
styles/main.css
supabase/.gitignore
supabase/config.toml
supabase/edge-function/cancel-account-deletion.js
supabase/edge-function/delete-account.js
supabase/edge-function/purge-deleted-users.js
supabase/edge-function/request-account-deletion.js
supabase/functions/_shared/auth.ts
supabase/functions/_shared/cors.ts
supabase/functions/_shared/stripe.ts
supabase/functions/ban-user/deno.json
supabase/functions/ban-user/index.ts
supabase/functions/billing-status/index.ts
supabase/functions/delete-account/.npmrc
supabase/functions/delete-account/deno.json
supabase/functions/delete-account/index.ts
supabase/functions/org-invite-accept/index.ts
supabase/functions/org-invite/index.ts
supabase/functions/org-member-remove/index.ts
supabase/functions/org-member-role-update/index.ts
supabase/functions/request-account-deletion/index.ts
supabase/functions/stripe-create-checkout-session/index.ts
supabase/functions/stripe-create-portal-session/index.ts
supabase/functions/stripe-webhook/index.ts
supabase/functions/unban-user/deno.json
supabase/functions/unban-user/index.ts
supabase/migrations/2026021501_create_profiles.sql
supabase/migrations/2026021601_create_org_schema.sql
supabase/migrations/20260216_account_deletion.sql
supabase/migrations/2026021700_create_billing_schema.sql
supabase/migrations/2026021701_org_member_rls_hardening.sql
supabase/migrations/2026021702_stripe_webhook_reliability.sql
supabase/migrations/2026021703_organization_invites.sql
supabase/migrations/2026021901_org_trial_seed.sql
supabase/migrations/2026021912_fix_webhook_and_billing_projection.sql
supabase_push_error.txt
tests/stress.spec.js
tsconfig.json
vendor/OrbitControls.js
vendor/OrbitControls.module.js
vendor/README.md
vendor/fa-brands-400.woff2
vendor/fa-solid-900.woff2
vendor/jspdf.umd.min.js
vendor/supabase.min.js
vendor/three.min.js
vendor/three.module.js
vendor/tween.umd.js
vendor/xlsx.full.min.js
```

Untracked at audit time:
- `src/debugger-old.js`
- `tests/audit/import-export.spec.mjs`
- `tests/audit/security-and-invariants.spec.mjs`
- `tools/app-graph.js`
- `tools/tp3d-graph.json`
