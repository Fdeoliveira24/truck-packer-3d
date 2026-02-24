-- 2026021700_create_billing_schema.sql
-- Base billing schema required before stripe webhook reliability migration.

-- 1) Enums used by billing tables (safe / idempotent)
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'billing_interval'
      and n.nspname = 'public'
  ) then
    create type public.billing_interval as enum ('month', 'year');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'billing_status'
      and n.nspname = 'public'
  ) then
    create type public.billing_status as enum ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused');
  end if;
end $$;

-- 2) Stripe customers mapping (user -> stripe customer)
create table if not exists public.stripe_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Webhook events log (safe create; if already exists, keep it)
create table if not exists public.webhook_events (
  id bigserial primary key,
  event_id text unique not null,
  event_type text,
  livemode boolean,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error text,
  payload jsonb,
  event_created bigint,
  updated_at timestamptz not null default now()
);

-- 4) Subscriptions projection (org + stripe ids)
create table if not exists public.subscriptions (
  id bigserial primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text,
  price_id text,
  product_id text,
  interval public.billing_interval,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  trial_end timestamptz,
  last_stripe_event_created bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_org_id_idx on public.subscriptions(organization_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists subscriptions_customer_id_idx on public.subscriptions(stripe_customer_id);

-- 5) Org billing snapshot (what billing-status reads)
create table if not exists public.billing_customers (
  id bigserial primary key,
  organization_id uuid unique references public.organizations(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status public.billing_status,
  plan_name text,
  billing_interval public.billing_interval,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_customers_org_id_idx on public.billing_customers(organization_id);

-- 6) updated_at triggers (reuse your helper from org schema)
-- If tp3d_set_updated_at() already exists, this is safe.
create or replace function public.tp3d_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tp3d_stripe_customers_set_updated_at on public.stripe_customers;
create trigger tp3d_stripe_customers_set_updated_at
before update on public.stripe_customers
for each row execute function public.tp3d_set_updated_at();

drop trigger if exists tp3d_subscriptions_set_updated_at on public.subscriptions;
create trigger tp3d_subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.tp3d_set_updated_at();

drop trigger if exists tp3d_billing_customers_set_updated_at on public.billing_customers;
create trigger tp3d_billing_customers_set_updated_at
before update on public.billing_customers
for each row execute function public.tp3d_set_updated_at();

drop trigger if exists tp3d_webhook_events_set_updated_at on public.webhook_events;
create trigger tp3d_webhook_events_set_updated_at
before update on public.webhook_events
for each row execute function public.tp3d_set_updated_at();