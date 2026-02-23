-- 2026021912_fix_webhook_and_billing_projection.sql
-- Idempotent cleanup for webhook terminal states + billing_customers projection backfill.

-- B1) Mark stale received webhook events as failed.
update public.webhook_events
set status = 'failed',
    error = 'stuck-received cleanup',
    processed_at = now(),
    updated_at = now()
where status = 'received'
  and processed_at is null
  and received_at < now() - interval '10 minutes';

-- B2) Backfill billing_customers projection from subscriptions data.
do $$
declare
  has_subscriptions_org_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'organization_id'
  ) into has_subscriptions_org_id;

  if has_subscriptions_org_id then
    with ranked as (
      select
        s.organization_id,
        s.stripe_customer_id,
        s.stripe_subscription_id,
        s.status,
        case when s.interval in ('month', 'year') then s.interval::public.billing_interval else null end as billing_interval,
        s.current_period_start,
        s.current_period_end,
        coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
        s.trial_end,
        row_number() over (
          partition by s.organization_id
          order by
            case s.status
              when 'active' then 1
              when 'trialing' then 2
              when 'past_due' then 3
              when 'unpaid' then 4
              when 'canceled' then 5
              else 6
            end,
            coalesce(s.current_period_end, s.updated_at, s.created_at) desc
        ) as rn
      from public.subscriptions s
      where s.organization_id is not null
    )
    update public.billing_customers bc
    set stripe_subscription_id = r.stripe_subscription_id,
        status = r.status::public.billing_status,
        plan_name = case when r.status in ('active', 'trialing', 'past_due') then 'pro' else bc.plan_name end,
        billing_interval = coalesce(r.billing_interval, bc.billing_interval),
        current_period_start = r.current_period_start,
        current_period_end = r.current_period_end,
        cancel_at_period_end = r.cancel_at_period_end,
        trial_ends_at = case when r.status = 'trialing' then r.trial_end else null end,
        updated_at = now()
    from ranked r
    where r.rn = 1
      and r.organization_id = bc.organization_id
      and (
        bc.stripe_subscription_id is null
        or bc.billing_interval is null
        or bc.current_period_end is null
      );
  else
    -- Fallback for legacy subscriptions schema without organization_id.
    with ranked as (
      select
        bc.organization_id,
        s.stripe_customer_id,
        s.stripe_subscription_id,
        s.status,
        case when s.interval in ('month', 'year') then s.interval::public.billing_interval else null end as billing_interval,
        s.current_period_start,
        s.current_period_end,
        coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
        s.trial_end,
        row_number() over (
          partition by bc.organization_id
          order by
            case s.status
              when 'active' then 1
              when 'trialing' then 2
              when 'past_due' then 3
              when 'unpaid' then 4
              when 'canceled' then 5
              else 6
            end,
            coalesce(s.current_period_end, s.updated_at, s.created_at) desc
        ) as rn
      from public.billing_customers bc
      join public.organizations o on o.id = bc.organization_id
      join public.subscriptions s on s.user_id = o.owner_id
    )
    update public.billing_customers bc
    set stripe_subscription_id = r.stripe_subscription_id,
        status = r.status::public.billing_status,
        plan_name = case when r.status in ('active', 'trialing', 'past_due') then 'pro' else bc.plan_name end,
        billing_interval = coalesce(r.billing_interval, bc.billing_interval),
        current_period_start = r.current_period_start,
        current_period_end = r.current_period_end,
        cancel_at_period_end = r.cancel_at_period_end,
        trial_ends_at = case when r.status = 'trialing' then r.trial_end else null end,
        updated_at = now()
    from ranked r
    where r.rn = 1
      and r.organization_id = bc.organization_id
      and (
        bc.stripe_subscription_id is null
        or bc.billing_interval is null
        or bc.current_period_end is null
      );
  end if;
end $$;

-- B3) Active subscriptions should not keep trial_ends_at populated.
update public.billing_customers
set trial_ends_at = null,
    updated_at = now()
where status = 'active'
  and trial_ends_at is not null;
