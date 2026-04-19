-- 20260418_billing_rls.sql
-- Add Row-Level Security to billing tables.
-- Edge functions use service_role (bypasses RLS), so server-side operations are unaffected.
-- These policies prevent anon-key clients from ever cross-reading billing data.

-- stripe_customers: users can only see their own Stripe customer record
alter table public.stripe_customers enable row level security;

drop policy if exists "stripe_customers_select_own" on public.stripe_customers;
create policy "stripe_customers_select_own"
  on public.stripe_customers
  for select
  using (user_id = auth.uid());

-- billing_customers: org members can read their org's billing snapshot
alter table public.billing_customers enable row level security;

drop policy if exists "billing_customers_select_member" on public.billing_customers;
create policy "billing_customers_select_member"
  on public.billing_customers
  for select
  using (public.tp3d_org_actor_role(organization_id) is not null);

-- subscriptions: users can only see their own subscription rows
-- (production schema uses user_id, not organization_id, on this table)
alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_member" on public.subscriptions;
create policy "subscriptions_select_member"
  on public.subscriptions
  for select
  using (user_id = auth.uid());

-- webhook_events: no client access — service_role only
alter table public.webhook_events enable row level security;

-- No policies = DENY ALL for anon/authenticated roles (service_role bypasses RLS)
