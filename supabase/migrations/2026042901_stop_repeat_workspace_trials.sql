create index if not exists organizations_owner_id_idx
  on public.organizations using btree (owner_id)
  where owner_id is not null;

create or replace function public.seed_billing_customer_trial_for_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_days constant integer := 7;
  v_trial_ends_at timestamptz := now() + make_interval(days => v_trial_days);
  v_has_other_owned_workspace boolean := false;
  v_inserted_org_id uuid;
begin
  if coalesce(new.organization_id::text, '') = '' then
    return new;
  end if;

  if lower(coalesce(new.role::text, '')) <> 'owner' then
    return new;
  end if;

  select exists (
    select 1
    from public.organizations o
    where o.owner_id = new.user_id
      and o.id <> new.organization_id
  )
  into v_has_other_owned_workspace;

  insert into public.billing_customers (
    organization_id,
    status,
    trial_ends_at,
    created_at,
    updated_at
  )
  values (
    new.organization_id,
    case
      when v_has_other_owned_workspace then null
      else 'trialing'::public.billing_status
    end,
    case
      when v_has_other_owned_workspace then null
      else v_trial_ends_at
    end,
    now(),
    now()
  )
  on conflict (organization_id) do nothing
  returning organization_id into v_inserted_org_id;

  if v_inserted_org_id is not null then
    if v_has_other_owned_workspace then
      raise log 'billing_customer placeholder seeded for repeat-owner org %', new.organization_id;
    else
      raise log 'billing_customer trial seeded for first-owner org %, trial_ends_at %', new.organization_id, v_trial_ends_at;
    end if;
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

with owner_workspace_counts as (
  select
    o.owner_id,
    count(*) as owned_workspace_count
  from public.organizations o
  where o.owner_id is not null
  group by o.owner_id
),
owners_with_subscription as (
  select distinct
    o.owner_id
  from public.organizations o
  join public.billing_customers bc
    on bc.organization_id = o.id
  where o.owner_id is not null
    and bc.stripe_subscription_id is not null
),
ranked_trial_rows as (
  select
    bc.id as billing_customer_id,
    bc.organization_id,
    o.owner_id,
    bc.created_at,
    row_number() over (
      partition by o.owner_id
      order by bc.created_at asc, bc.organization_id asc
    ) as owner_trial_rank
  from public.billing_customers bc
  join public.organizations o
    on o.id = bc.organization_id
  join owner_workspace_counts owc
    on owc.owner_id = o.owner_id
  where owc.owned_workspace_count > 1
    and bc.status = 'trialing'
    and bc.stripe_subscription_id is null
),
rows_to_clear as (
  select
    rtr.billing_customer_id
  from ranked_trial_rows rtr
  left join owners_with_subscription ows
    on ows.owner_id = rtr.owner_id
  where ows.owner_id is not null
     or rtr.owner_trial_rank > 1
)
update public.billing_customers bc
set
  status = null,
  plan_name = null,
  trial_ends_at = null,
  updated_at = now()
from rows_to_clear rtc
where bc.id = rtc.billing_customer_id
  and bc.status = 'trialing'
  and bc.stripe_subscription_id is null;
