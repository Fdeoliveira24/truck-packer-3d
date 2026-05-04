# Local Supabase Setup (Truck Packer 3D)

Last updated: 2026-02-23

This doc records the exact steps and commands used to bring up the local Supabase stack for Truck Packer 3D, including the migrations needed so Edge Functions and schema dependencies exist locally.

---

## 1) Why we needed this

We needed a working local Supabase environment to:

- Run Edge Functions locally (fast dev loop)
- Test Stripe webhooks locally using Stripe CLI forwarding
- Apply and validate schema migrations in correct order
- Avoid production-only assumptions while developing workspace/org flows and billing

---

## 2) Initial blocker we hit

`supabase start` failed because required base tables did not exist locally yet, starting with:

- `public.profiles` (migration tried to ALTER it, but it wasn’t created)
- later: `public.organization_members`
- later: `public.subscriptions`

So we added missing “create schema first” migrations so later migrations (RLS, billing reliability, projections) can run.

---

## 3) Migrations that must exist (and order)

These migrations are now present in `supabase/migrations/` and must run in this order:

1. `2026021501_create_profiles.sql`
   - Creates `public.profiles`
   - Adds RLS/policies/triggers as needed for local
   - Ensures later migrations that ALTER profiles will not fail

2. `2026021601_create_org_schema.sql`
   - Creates org tables needed before org RLS:
     - `public.organizations`
     - `public.organization_members`
   - Adds timestamps / updated_at triggers (where applicable)

3. `20260216_account_deletion.sql`
   - Adds columns to `public.profiles`:
     - `deletion_status`
     - `deleted_at`
     - `purge_after`
   - Adds indexes + constraint

4. `2026021700_create_billing_schema.sql`
   - Creates billing tables needed before billing reliability migration:
     - `public.stripe_customers`
     - `public.subscriptions`
     - `public.billing_customers`
     - `public.webhook_events`

5. `2026021701_org_member_rls_hardening.sql`
   - Enables RLS + helper functions + policies on `organization_members`

6. `2026021702_stripe_webhook_reliability.sql`
   - Adds webhook reliability columns (like `last_stripe_event_created`)
   - Adds webhook_events triggers/columns if needed

7. `2026021703_organization_invites.sql`
   - Creates `public.organization_invites` + RLS/policies/triggers

8. `2026021901_org_trial_seed.sql`
   - Seeds trial billing state for new orgs (triggers)

9. `2026021912_fix_webhook_and_billing_projection.sql`
   - Projection cleanup/backfill for billing/subscription views

10. `2026022201_rpc_create_organization.sql`
   - Adds RPC:
     - `public.create_organization(org_name text)`
   - Used to create an org + owner membership safely

Note: Many migrations are written to be idempotent. During local startup you may see NOTICE logs like “already exists, skipping”. That’s expected.

---

## 4) Start / Stop commands used

### Stop (clean local stack)

```bash
supabase stop --no-backup
```

### Start local Supabase (applies migrations)

```bash
supabase start
```

### Check status (prints local endpoints)

```bash
supabase status
```

⸻

## 5) What “supabase start” output means

When local stack is running, Supabase prints:

Dev Tools
- Studio: http://127.0.0.1:54323
- Mailpit: http://127.0.0.1:54324
- MCP: http://127.0.0.1:54321/mcp

APIs
- Project URL: http://127.0.0.1:54321
- REST: http://127.0.0.1:54321/rest/v1
- GraphQL: http://127.0.0.1:54321/graphql/v1
- Edge Functions: http://127.0.0.1:54321/functions/v1

Database
- DB URL:  
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`

Auth Keys

Supabase prints local dev keys like:
- Publishable: `sb_publishable_...`
- Secret: `sb_secret_...`

These keys are LOCAL ONLY for the local stack.

Storage (S3)

Local storage endpoint + local S3 credentials are shown.  
These are for local testing only.

Warnings that are OK
- “analytics requires mounting default docker socket”
- “Stopped services: imgproxy / pooler”
These do not block Edge Functions or DB for our use cases.

⸻

## 6) Sanity check (Edge Functions reachable)

This confirms Kong routing + Edge Functions runtime is reachable:

```bash
curl -i http://127.0.0.1:54321/functions/v1/billing-status
```

Expected result:
- HTTP/1.1 401 Unauthorized
- Body: `{"error":"Missing authorization"}`

401 is correct because billing-status expects auth.

⸻

## 7) Running Edge Functions locally

Run the local functions server:

```bash
supabase functions serve stripe-webhook --no-verify-jwt
```

You should see output like:
- “Serving functions on http://127.0.0.1:54321/functions/v1/”
- A list of available local endpoints

Leave this terminal running during webhook testing.

⸻

## 8) Stripe CLI local webhook forwarding (Option B)

### Start Stripe listener forwarding to local Edge Function

Open another terminal and run:

```bash
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
```

Stripe CLI prints a webhook signing secret like:

`whsec_...`

Example:  
`whsec_0e07b333c7604ef25dcb45cbfe8c402408a69397392b9e43dbb4eafa826316b4`

This `whsec_...` value must be placed into local env for functions.

⸻

## 9) Local Edge Function env file (for Stripe webhooks)

Create or update:

`supabase/functions/.env.local`

Recommended values for local:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<keep your existing value>

STRIPE_SECRET_KEY=<your Stripe test secret key>
STRIPE_WEBHOOK_SECRET=<paste whsec_from_stripe_listen_here>

STRIPE_PRICE_PRO_MONTHLY=<price_id>
STRIPE_PRICE_PRO_YEARLY=<price_id>
```

Important:
- `STRIPE_WEBHOOK_SECRET` must match what Stripe CLI prints when you run `stripe listen`.
- The placeholder `will_set_from_stripe_cli` should be replaced with the real `whsec_...`.

⸻

## 10) Quick webhook test

Once both are running:
1. `supabase functions serve stripe-webhook --no-verify-jwt`
2. `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook`

Then in Stripe Dashboard:
- Developers → Webhooks → “Send test event”
- Pick an event type (ex: `customer.subscription.updated`)

Validate in DB:
- `public.webhook_events` should show new events arriving and being processed/failed with helpful error text.

⸻

## 11) Troubleshooting notes

### If `supabase start` fails

It usually means a migration references a table that doesn’t exist yet.  
Fix: add a “create table schema” migration earlier in order, then restart with:

```bash
supabase stop --no-backup
supabase start
```

### If Stripe events hit local endpoint but get 400

Most common causes:
- Wrong `STRIPE_WEBHOOK_SECRET` value
- Webhook signature mismatch
- Forwarding to wrong URL/port
- Functions server not running

⸻

## 12) Current confirmed working state (as of 2026-02-23)
- Local Supabase stack starts successfully
- Edge Functions are reachable (billing-status returns 401 without auth)
- Functions serve command lists endpoints successfully
- Stripe CLI forwarding prints webhook secret and is ready for event forwarding

⸻
