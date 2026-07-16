# Stripe Edge Functions Secrets Checklist

Use this checklist before testing billing flows in Supabase Edge Functions.

For price replacement, limit changes, deployment scope, rollback, and masked evidence requirements, follow the [Pricing Operations Runbook](../billing/PRICING-OPERATIONS-RUNBOOK.md). This checklist names configuration only; it does not authorize changing any value.

## Required secrets and optional configuration

Set required values and any approved optional overrides in Supabase project secrets:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PRO_YEARLY`
- `STRIPE_PRICE_BUSINESS_MONTHLY` (optional; currently read for Business limit recognition, not checkout)
- `STRIPE_PRICE_BUSINESS_YEARLY` (optional; currently read for Business limit recognition, not checkout)
- `TP3D_TRIAL_WORKSPACE_LIMIT` (optional; default is applied when unset)
- `TP3D_PRO_WORKSPACE_LIMIT` (optional; default is applied when unset)
- `TP3D_BUSINESS_WORKSPACE_LIMIT` (optional; default is applied when unset)
- `STRIPE_PORTAL_CONFIGURATION_ID` (optional portal configuration)
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
  - requires `STRIPE_SECRET_KEY`; optionally reads `STRIPE_PORTAL_CONFIGURATION_ID`
- `billing-status`
  - requires `SUPABASE_URL`/`URL`, `SUPABASE_ANON_KEY`/`ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`/`SERVICE_ROLE_KEY`
  - reads the Pro and optional Business Price variables for interval/tier recognition
  - reads the trial, Pro, and Business workspace-limit variables
  - uses `STRIPE_SECRET_KEY` when authoritative Stripe reconciliation is required
- `org-restore-workspace`
  - reads the trial, Pro, and Business workspace-limit variables

## Debug safety

- Backend debug payloads are disabled by default.
- To allow backend debug payloads for `billing-status`, set `TP3D_DEBUG=true` and call with `?tp3dDebug=1`.
- For normal QA runs, do not use `tp3dDebug=1`.
