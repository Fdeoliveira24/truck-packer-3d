# TP3D Billing Fixes (02/12/2026)

## Summary
Fixed Supabase Edge Function 401s for Stripe checkout/portal by separating gateway auth (anon key) from user auth (access token).

## What Changed
1) Frontend Edge Function headers
- File: src/data/services/billing.service.js
- `Authorization` now uses the Supabase anon key JWT (gateway validation).
- User access token is sent via `x-user-jwt` header.
- `apikey` remains the anon key.

2) Functions auth header handling
- File: supabase/functions/_shared/auth.ts
- `extractBearerToken` reads `x-user-jwt` first, then falls back to `Authorization`.
- Added temporary log: `console.log("[auth] using supabase url:", url);`

3) CORS allowlist update
- File: supabase/functions/_shared/cors.ts
- Added `x-user-jwt` to `Access-Control-Allow-Headers`.

## Deploys Run
- supabase functions deploy stripe-create-checkout-session
- supabase functions deploy stripe-create-portal-session
- supabase functions deploy billing-status

## Notes
- This avoids the gateway rejecting ES256 user JWTs by using the anon key for the gateway check.
- User JWT still validated inside the function via `requireUser`.
- Temporary log in `_shared/auth.ts` should be removed after confirmation.
