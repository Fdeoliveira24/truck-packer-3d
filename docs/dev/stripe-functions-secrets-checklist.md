# Stripe Edge Functions Secrets Checklist

Use this checklist before testing billing flows in Supabase Edge Functions.

## Required secrets

Set these in Supabase project secrets:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PRO_YEARLY`
- `SUPABASE_URL` (or `URL`)
- `SUPABASE_ANON_KEY` (or `ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`)
- `ALLOWED_ORIGINS` (comma-separated, include app domains and local dev origins as needed)

Quick check:

```bash
supabase secrets list --project-ref <your-project-ref>
```

## Function-level usage

- `stripe-webhook`
  - requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - relies on service-role DB access for idempotency and subscription projection writes
- `stripe-create-checkout-session`
  - requires `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`
- `stripe-create-portal-session`
  - requires `STRIPE_SECRET_KEY`
- `billing-status`
  - requires `SUPABASE_URL`/`URL`, `SUPABASE_ANON_KEY`/`ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`/`SERVICE_ROLE_KEY`

## Debug safety

- Backend debug payloads are disabled by default.
- To allow backend debug payloads for `billing-status`, set `TP3D_DEBUG=true` and call with `?tp3dDebug=1`.
- For normal QA runs, do not use `tp3dDebug=1`.
