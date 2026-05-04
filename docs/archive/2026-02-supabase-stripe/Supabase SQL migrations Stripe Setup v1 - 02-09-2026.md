# Supabase SQL migrations Stripe Setup v1 — 02/09/2026

This file contains the SQL used for the Stripe + Supabase subscription setup (v1).

**Scope**
- Maps each Supabase user to a Stripe Customer
- Stores a subscription snapshot for app access control / UI
- Stores webhook event payloads with dedupe + processing status
- Uses RLS so users can only read their own billing rows
- No client-side writes to billing tables (server/service-role only)

---

## 1) Tables + indexes + triggers

Run this in **Supabase Dashboard → SQL Editor → New query**.

```sql
-- 0) Extensions (usually already enabled, but safe)
create extension if not exists pgcrypto;

-- 1) Stripe customer mapping (one Stripe customer per Supabase user for v1)
create table if not exists public.stripe_customers (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists stripe_customers_user_id_unique
  on public.stripe_customers(user_id);

-- 2) Subscription snapshot table (source of truth in your app)
create table if not exists public.subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,

  status text not null, -- active, trialing, past_due, canceled, unpaid, incomplete, incomplete_expired
  price_id text not null,
  product_id text,

  current_period_start timestamptz,
  current_period_end timestamptz,

  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,

  trial_start timestamptz,
  trial_end timestamptz,

  ended_at timestamptz,

  latest_invoice_id text,
  latest_invoice_status text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx
  on public.subscriptions(user_id);

create index if not exists subscriptions_status_idx
  on public.subscriptions(status);

create index if not exists subscriptions_price_id_idx
  on public.subscriptions(price_id);

-- 3) Webhook event dedupe + processing log (server-only)
create table if not exists public.webhook_events (
  id bigserial primary key,
  event_id text not null unique,          -- Stripe event.id
  event_type text not null,
  livemode boolean not null default false,
  received_at timestamptz not null default now(),

  processed_at timestamptz,
  status text not null default 'received', -- received | processed | failed
  error text,

  payload jsonb not null
);

create index if not exists webhook_events_status_idx
  on public.webhook_events(status);

-- 4) Simple updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_stripe_customers on public.stripe_customers;
create trigger set_updated_at_stripe_customers
before update on public.stripe_customers
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_subscriptions on public.subscriptions;
create trigger set_updated_at_subscriptions
before update on public.subscriptions
for each row execute function public.set_updated_at();
```

---

## 2) RLS policies (secure by default)

Run this after the tables exist.

```sql
-- Enable RLS
alter table public.stripe_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;

-- stripe_customers policies
drop policy if exists "stripe_customers_read_own" on public.stripe_customers;
create policy "stripe_customers_read_own"
on public.stripe_customers
for select
using (auth.uid() = user_id);

-- No insert/update/delete policies for users (server will use service role)

-- subscriptions policies
drop policy if exists "subscriptions_read_own" on public.subscriptions;
create policy "subscriptions_read_own"
on public.subscriptions
for select
using (auth.uid() = user_id);

-- No insert/update/delete policies for users (server will use service role)

-- webhook_events: no user access at all
-- (No select/insert/update/delete policies)
```

---

## 3) Quick verification SQL (optional)

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('stripe_customers', 'subscriptions', 'webhook_events')
order by table_name;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('stripe_customers', 'subscriptions', 'webhook_events')
order by tablename;
```

---

## 4) Notes on access

**Client (browser / anon key)**
- Can only `select` their own rows from:
  - `stripe_customers`
  - `subscriptions`
- Cannot write to these tables
- Cannot read or write `webhook_events`

**Server (Edge Functions using Service Role key)**
- Full read/write for all tables

---

## 5) Next phase

Phase 4 adds Supabase Edge Functions:
- POST `/stripe/create-checkout-session`
- POST `/stripe/create-portal-session`
- POST `/stripe/webhook` (raw body signature check)
- GET `/billing/status`

Each will enforce Bearer token auth and will be safe to retry (idempotency + webhook dedupe).
