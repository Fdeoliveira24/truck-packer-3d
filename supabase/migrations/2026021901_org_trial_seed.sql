-- 2026021901_org_trial_seed.sql
-- Seed org-scoped no-card trials in billing_customers for every new organization.
-- No schema changes: trigger/function only.
--
-- Seeding is attached to owner membership inserts (not organizations inserts) so
-- createOrganization() rollback paths remain unaffected if membership creation fails.

create or replace function public.seed_billing_customer_trial_for_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_days constant integer := 7;
  v_trial_ends_at timestamptz := now() + make_interval(days => v_trial_days);
  v_inserted_org_id uuid;
begin
  if coalesce(new.organization_id::text, '') = '' then
    return new;
  end if;

  if lower(coalesce(new.role::text, '')) <> 'owner' then
    return new;
  end if;

  insert into public.billing_customers (
    organization_id,
    status,
    trial_ends_at,
    created_at,
    updated_at
  )
  values (
    new.organization_id,
    'trialing',
    v_trial_ends_at,
    now(),
    now()
  )
  on conflict (organization_id) do nothing
  returning organization_id into v_inserted_org_id;

  if v_inserted_org_id is not null then
    raise log 'billing_customer seeded for org %, trial_ends_at %', new.organization_id, v_trial_ends_at;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_seed_billing_customer_trial on public.organizations;
drop trigger if exists trg_seed_billing_customer_trial on public.organization_members;
create trigger trg_seed_billing_customer_trial
after insert on public.organization_members
for each row
execute function public.seed_billing_customer_trial_for_org();
