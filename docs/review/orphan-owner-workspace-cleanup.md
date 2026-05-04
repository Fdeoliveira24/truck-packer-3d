# Orphan Owner Workspace Cleanup Review

This note is review-only. Do not run cleanup SQL until the audit output has been reviewed and each row has been classified.

`billing-status` now ignores orphan `organizations.owner_id` rows for entitlement counting unless the same user also has an `organization_members` row with `role = 'owner'`. The data should still be cleaned for long-term integrity because stale owner rows can confuse diagnostics, reports, and future maintenance.

## Target Users

The current cleanup review should include the test users:

- `test1`
- `test2`
- `test3`
- `test4`
- `test6`

The queries below match by email prefix so they work for addresses such as `test1@test.com`.

## Read-Only Audit Queries

Find the target users:

```sql
select
  u.id as user_id,
  u.email
from auth.users u
where split_part(lower(u.email), '@', 1) in ('test1', 'test2', 'test3', 'test4', 'test6')
order by u.email;
```

Compare `organizations.owner_id` rows against valid owner memberships:

```sql
with target_users as (
  select id, email
  from auth.users
  where split_part(lower(email), '@', 1) in ('test1', 'test2', 'test3', 'test4', 'test6')
),
owned_by_column as (
  select
    tu.email,
    tu.id as user_id,
    count(o.id) as owner_id_org_count
  from target_users tu
  left join public.organizations o on o.owner_id = tu.id
  group by tu.email, tu.id
),
owned_by_membership as (
  select
    tu.email,
    tu.id as user_id,
    count(om.organization_id) as owner_membership_count
  from target_users tu
  left join public.organization_members om
    on om.user_id = tu.id
   and lower(om.role::text) = 'owner'
  group by tu.email, tu.id
)
select
  c.email,
  c.user_id,
  c.owner_id_org_count,
  m.owner_membership_count,
  c.owner_id_org_count - m.owner_membership_count as possible_orphan_count
from owned_by_column c
join owned_by_membership m using (email, user_id)
order by c.email;
```

List orphan owner rows and classify likely phantom/test candidates:

```sql
with target_users as (
  select id, email
  from auth.users
  where split_part(lower(email), '@', 1) in ('test1', 'test2', 'test3', 'test4', 'test6')
),
member_counts as (
  select
    organization_id,
    count(*) as member_count,
    count(*) filter (where lower(role::text) = 'owner') as owner_member_count
  from public.organization_members
  group by organization_id
),
billing_counts as (
  select
    o.id as organization_id,
    bc.status as billing_customer_status,
    bc.stripe_subscription_id,
    count(s.stripe_subscription_id) as subscription_count
  from public.organizations o
  left join public.billing_customers bc on bc.organization_id = o.id
  left join public.subscriptions s on s.organization_id = o.id
  group by o.id, bc.status, bc.stripe_subscription_id
)
select
  tu.email,
  o.id as organization_id,
  o.name,
  o.owner_id,
  o.created_at,
  coalesce(mc.member_count, 0) as member_count,
  coalesce(mc.owner_member_count, 0) as owner_member_count,
  bc.billing_customer_status,
  bc.stripe_subscription_id,
  bc.subscription_count,
  case
    when coalesce(mc.member_count, 0) = 0 then 'phantom_or_test_candidate'
    when coalesce(mc.owner_member_count, 0) = 0 then 'missing_owner_membership_review'
    else 'not_orphan'
  end as review_classification
from target_users tu
join public.organizations o on o.owner_id = tu.id
left join public.organization_members owner_om
  on owner_om.organization_id = o.id
 and owner_om.user_id = tu.id
 and lower(owner_om.role::text) = 'owner'
left join member_counts mc on mc.organization_id = o.id
left join billing_counts bc on bc.organization_id = o.id
where owner_om.organization_id is null
order by tu.email, o.created_at, o.id;
```

List valid billable owned workspaces using the same rule as `billing-status`:

```sql
with target_users as (
  select id, email
  from auth.users
  where split_part(lower(email), '@', 1) in ('test1', 'test2', 'test3', 'test4', 'test6')
)
select
  tu.email,
  o.id as organization_id,
  o.name,
  o.created_at
from target_users tu
join public.organization_members om
  on om.user_id = tu.id
 and lower(om.role::text) = 'owner'
join public.organizations o
  on o.id = om.organization_id
 and o.owner_id = tu.id
order by tu.email, o.created_at, o.id;
```

## Optional Cleanup SQL - Do Not Run Blindly

Do not delete rows in the first pass. Do not blindly insert owner memberships for all orphan rows.

If an org has no owner membership and no members, it is only a phantom/test workspace candidate. After confirming it is not real customer data, prefer a reversible cleanup by clearing `owner_id`:

```sql
-- Replace the UUID list with reviewed phantom/test organization IDs only.
begin;

update public.organizations
set owner_id = null,
    updated_at = now()
where id in (
  '00000000-0000-0000-0000-000000000000'
);

-- Review before commit:
select id, name, owner_id, updated_at
from public.organizations
where id in (
  '00000000-0000-0000-0000-000000000000'
);

-- commit;
-- rollback;
```

If an org is legitimate and the owner membership is missing, review the app/audit history before inserting a membership. Only insert a missing owner membership when the organization is confirmed real and the owner is confirmed correct:

```sql
-- Use only after manual review. Do not bulk apply to every orphan row.
begin;

insert into public.organization_members (organization_id, user_id, role, joined_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'owner',
  now(),
  now()
)
on conflict (organization_id, user_id)
do update set role = 'owner', updated_at = now();

-- commit;
-- rollback;
```

## JWT Warning TODO

The sporadic `InvalidJWTToken` warning during Settings tab switching should be handled in a separate narrow auth hardening pass. Do not refactor Supabase auth/session flow.

Future fix direction:

- Handle `InvalidJWTToken` only after `BootState.appReady`, or inside `getSessionSingleFlight` catch with the same revoked-auth behavior already used by `getUserSingleFlight`.
- Do not silence boot-time auth failures.
- Do not change billing entitlement logic as part of that auth pass.
