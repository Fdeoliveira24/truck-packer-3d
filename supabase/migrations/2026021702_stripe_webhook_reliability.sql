-- 20260216_stripe_webhook_reliability.sql
-- Idempotent hardening for Stripe webhook retry safety and event ordering.

-- Keep/define shared updated_at trigger function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Ensure webhook_events table exists (safe no-op when already present).
create table if not exists public.webhook_events (
  id bigserial primary key,
  event_id text not null unique,
  event_type text not null,
  livemode boolean not null default false,
  event_created bigint,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Add any missing reliability columns.
alter table public.webhook_events
  add column if not exists event_created bigint;
alter table public.webhook_events
  add column if not exists received_at timestamptz not null default now();
alter table public.webhook_events
  add column if not exists processed_at timestamptz;
alter table public.webhook_events
  add column if not exists status text not null default 'received';
alter table public.webhook_events
  add column if not exists error text;
alter table public.webhook_events
  add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.webhook_events
  add column if not exists event_type text;
alter table public.webhook_events
  add column if not exists livemode boolean not null default false;
alter table public.webhook_events
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists webhook_events_event_id_unique
  on public.webhook_events(event_id);

create index if not exists webhook_events_status_idx
  on public.webhook_events(status);

create index if not exists webhook_events_event_created_idx
  on public.webhook_events(event_created);

-- Enforce valid processing states.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'webhook_events_status_check'
      and conrelid = 'public.webhook_events'::regclass
  ) then
    alter table public.webhook_events
      add constraint webhook_events_status_check
      check (status in ('received', 'processed', 'failed'));
  end if;
end $$;

drop trigger if exists set_updated_at_webhook_events on public.webhook_events;
create trigger set_updated_at_webhook_events
before update on public.webhook_events
for each row execute function public.set_updated_at();

update public.webhook_events
set status = 'received'
where status is null;

update public.webhook_events
set updated_at = coalesce(updated_at, received_at, now())
where updated_at is null;

-- Monotonic ordering marker per Stripe subscription.
alter table public.subscriptions
  add column if not exists last_stripe_event_created bigint;

create index if not exists subscriptions_last_stripe_event_created_idx
  on public.subscriptions(stripe_subscription_id, last_stripe_event_created desc);
