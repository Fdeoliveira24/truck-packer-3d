# ARCHITECTURE_DIAGRAM

## Runtime architecture (client + edge)

```mermaid
flowchart TD
  A[index.html boot] --> B[window.__TP3D_BOOT + vendor fallbacks]
  B --> C[src/app.js module]
  C --> D[TruckPackerApp.init()]

  D --> E[Runtime validation]
  E --> F[SupabaseClient.init]
  D --> G[StateStore + Storage]
  D --> H[UIComponents + Overlays]
  D --> I[Editor/Packs/Cases screens]

  F --> J[Auth/session state machine]
  F --> K[Org/account bundle]
  K --> L[window.OrgContext]

  D --> M[Billing runtime API]
  M --> N[billing.service]
  N --> O[Supabase Edge Functions]

  O --> P[billing-status]
  O --> Q[stripe-create-checkout-session]
  O --> R[stripe-create-portal-session]
  O --> S[stripe-webhook]

  S --> T[(Postgres billing tables)]
  P --> T
  Q --> T
  R --> T

  D --> U[Import/Export service]
  U --> G

  D --> V[Custom events]
  V --> W[tp3d:org-changed]
  V --> X[tp3d:workspace-ready]
  V --> Y[tp3d:auth-signed-out]
```

## Boot sequence (authoritative)
1. `index.html` initializes boot globals and vendor loading promises (`index.html:28-136`).
2. `index.html` loads ESM `three` + fallback (`index.html:145-181`).
3. `index.html` sets Supabase/Stripe config (`index.html:1001-1010`).
4. `index.html` loads `src/app.js` (`index.html:1028`).
5. `src/app.js` creates app singleton and executes `boot()` (`src/app.js:956`, `src/app.js:6494-6507`).
6. `init()` runs runtime checks + Supabase init + auth gate + UI wiring (`src/app.js:5254-6457`).

## State ownership
- UI state: `StateStore` + screen modules (`src/app.js`, `src/screens/*`).
- Persistent app data: `core/storage.js` (`truckPacker3d:v1[:scope]`).
- Auth/session/org network state: `core/supabase-client.js` (`_authState`, bundle cache).
- Org context projection for UI: `window.OrgContext` set in `src/app.js:4197`.
- Billing snapshot + gating: `window.__TP3D_BILLING` (`src/app.js:897`) + `applyAccessGateFromBilling`.

## Data-flow boundaries
- Browser only:
  - rendering, editor, local storage, import/export parsing
- Edge functions:
  - billing status, checkout/portal session generation, webhook verification, org membership mutations
- DB consistency layer:
  - Supabase RLS + billing projection tables (`supabase/migrations/*`)

## Failure containment
- Vendor failures surface system overlay, not hard crash (`src/app.js:3898-3939`, `src/ui/system-overlay.js`).
- Auth/network wobble handled with single-flight + timeouts in `supabase-client`.
- Billing calls wrapped in timeout races in `app.js` and guarded in `billing.service`.
