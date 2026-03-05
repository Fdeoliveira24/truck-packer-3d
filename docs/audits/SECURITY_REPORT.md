# SECURITY_REPORT

## PASS G — Security forensics scope
Checked:
- XSS sinks (`innerHTML`, template strings)
- redirect safety in billing flows
- token exposure patterns
- webhook signature validation
- CORS behavior
- org/billing authorization checks in edge functions

## Fixed issues

### [High] Potential XSS in account overlay profile block
- Evidence:
  - Safe implementation now uses `textContent` nodes: `src/ui/overlays/account-overlay.js:422-430`.
- Risk:
  - Prior HTML interpolation of user profile strings could execute injected markup/scripts.
- Fix:
  - Replaced interpolation with explicit DOM node construction.
- Verification:
  - `tests/audit/security-and-invariants.spec.mjs:28-32`.

### [High] Billing redirect origin trust was implicit
- Evidence:
  - URL allowlist validator: `src/data/services/billing.service.js:242-253`.
  - Enforced for checkout: `src/data/services/billing.service.js:544-547`.
  - Enforced for portal: `src/data/services/billing.service.js:585-588`.
- Risk:
  - Malicious/compromised backend response could redirect users to attacker-controlled URL.
- Fix:
  - Require `https` and host `stripe.com` or subdomain.
- Verification:
  - `tests/audit/security-and-invariants.spec.mjs:10-21`.

### [Medium] CORS helper default did not match allowlist intent
- Evidence:
  - Allowlist logic in `supabase/functions/_shared/cors.ts:43-51`.
  - Hardened `json` default in `supabase/functions/_shared/cors.ts:75`.
- Risk:
  - Paths that forgot to pass `origin` to `json()` could emit permissive origin.
- Fix:
  - Default response origin changed to `"null"`.
- Verification:
  - `tests/audit/security-and-invariants.spec.mjs:34-38`.

## Authorization/RLS checks (validated)
- Stripe checkout function enforces authenticated user + org owner role:
  - `supabase/functions/stripe-create-checkout-session/index.ts:131-134`, `162-172`.
- Stripe portal function enforces same owner role:
  - `supabase/functions/stripe-create-portal-session/index.ts:37-40`, `69-80`.
- Webhook signature verification enforced:
  - `supabase/functions/stripe-webhook/index.ts:819-837`.

## Token handling findings
- Client billing API uses anon bearer + `x-user-jwt` transport (`src/data/services/billing.service.js:108-120`).
- Debug logs can include token prefixes in debug mode (`src/data/services/billing.service.js:102-106`).
  - Residual risk: avoid enabling `tp3dDebug=1` in production sessions.

## innerHTML audit (comprehensive, pass 2)
Full static analysis of all `innerHTML` assignments in `src/`:
- **~70 SAFE** (static HTML only, icon buttons, layout templates)
- **10 NEEDS_REVIEW** (template literals with internal data — all verified safe):
  1. `src/app.js:3441` — `u.version`, `u.date` from hardcoded `updatesData` constant
  2. `src/app.js:3497-3502` — roadmap items from hardcoded `roadmapData` constant
  3. `src/app.js:3507` — `item.details` in modal content from internal constant
  4. `src/ui/ui-components.js:131` — `config.content` string → innerHTML (documented as trusted-only API)
  5. `src/ui/overlays/import-app-dialog.js:112` — `Utils.escapeHtml(file.name)` with fallback
  6. `src/ui/overlays/import-cases-dialog.js:42` — `Utils.escapeHtml(file.name)` properly escaped
  7. `src/ui/overlays/import-pack-dialog.js:80` — conditional escaping with local file picker source
  8. `src/editor/scene-runtime.js:105` — internal numeric performance stats
  9. `src/screens/editor-screen.js:1829` — `p.label` from TrailerPresets internal constant
  10. `src/ui/overlays/auth-overlay.js:151` — generic `el()` helper used only internally
- **0 DANGEROUS** — no user-controlled or API-response data flows into innerHTML without escaping

## Dead code inventory (13 orphan files)
Files with no incoming imports in the runtime graph (safe to remove in future cleanup):
1. `src/core/event-bus.js` — legacy duplicate of `src/core/events.js`
2. `src/core/state.js` — legacy duplicate of `src/core/state-store.js`
3. `src/auth/permissions.js` — unused permission helpers
4. `src/debugger-old.js` — replaced by `src/debugger.js`
5. `src/data/services/analytics.service.js` — stub, never called
6. `src/data/services/cases.service.js` — stub, never called
7. `src/data/services/collaboration.service.js` — Phase 2 stub
8. `src/data/services/maps.service.js` — stub, throws "not implemented"
9. `src/data/services/packs.service.js` — stub, never called
10. `src/data/services/users.service.js` — stub, never called
11. `src/data/models/org.model.js` — unused normalizer
12. `src/data/models/user.model.js` — unused normalizer
13. `src/features/editor/model-loader.js` — Phase 2 placeholder

## Residual risks (not fully eliminated in this pass)
1. Legacy modules (`src/auth/session.js`, `src/core/event-bus.js`) remain in repo and can be reintroduced accidentally.
2. Browser-side config includes public anon key and Stripe publishable key in `index.html` (expected for public clients; not a secret leak).
3. `src/ui/ui-components.js:131` showModal accepts raw HTML string content — callers must ensure safety.

## Security regression verdict
- Blocking vulnerabilities fixed in this pass: **Yes**.
- innerHTML XSS audit: **Clean** (no dangerous sinks found).
- Residual medium/maintenance risks: **Yes** (tracked in contradiction and release-gate reports).
