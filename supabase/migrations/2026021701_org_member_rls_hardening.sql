-- 20260216_org_member_rls_hardening.sql
-- Idempotent role hardening for organization_members.
-- Role model enforced for write operations: owner / admin / member.

alter table public.organization_members enable row level security;

-- Keep one row per (organization_id, user_id) before adding unique index.
-- Prefer the highest-privilege role when duplicates exist.
with ranked as (
  select
    ctid,
    row_number() over (
      partition by organization_id, user_id
      order by
        case role
          when 'owner'::public.org_member_role then 3
          when 'admin'::public.org_member_role then 2
          when 'member'::public.org_member_role then 1
          else 0
        end desc,
        id asc
    ) as rn
  from public.organization_members
)
delete from public.organization_members om
using ranked r
where om.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists organization_members_org_user_unique
  on public.organization_members(organization_id, user_id);

-- --- Helper functions (SECURITY DEFINER to avoid recursive RLS lookups) ---

create or replace function public.tp3d_org_actor_role(org_id uuid)
returns public.org_member_role
language sql
security definer
set search_path = public
as $$
  select om.role
  from public.organization_members om
  where om.organization_id = org_id
    and om.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.tp3d_org_owner_count(org_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.organization_members om
  where om.organization_id = org_id
    and om.role = 'owner'::public.org_member_role;
$$;

create or replace function public.tp3d_org_owner_count_excluding(org_id uuid, target_user_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.organization_members om
  where om.organization_id = org_id
    and om.role = 'owner'::public.org_member_role
    and om.user_id <> target_user_id;
$$;

create or replace function public.tp3d_is_org_owner(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(public.tp3d_org_actor_role(org_id) = 'owner'::public.org_member_role, false);
$$;

create or replace function public.tp3d_is_org_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(public.tp3d_org_actor_role(org_id) = 'admin'::public.org_member_role, false);
$$;

create or replace function public.tp3d_is_org_admin_or_owner(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    public.tp3d_org_actor_role(org_id) in ('owner'::public.org_member_role, 'admin'::public.org_member_role),
    false
  );
$$;

-- --- Policies ---
drop policy if exists "org_members_select_current_user" on public.organization_members;
drop policy if exists "org_members_select_own" on public.organization_members;
drop policy if exists "org_members_select_org" on public.organization_members;
drop policy if exists "org_members_insert_owner_admin_member" on public.organization_members;
drop policy if exists "org_members_update_owner_admin" on public.organization_members;
drop policy if exists "org_members_delete_owner_admin" on public.organization_members;

create policy "org_members_select_org"
on public.organization_members
for select
using (
  public.tp3d_org_actor_role(organization_id) is not null
);

create policy "org_members_insert_owner_admin_member"
on public.organization_members
for insert
with check (
  organization_id is not null
  and user_id is not null
  and (
    (
      -- Allow bootstrap owner row when creator just made the organization.
      role = 'owner'::public.org_member_role
      and user_id = auth.uid()
      and exists (
        select 1
        from public.organizations o
        where o.id = organization_members.organization_id
          and o.owner_id = auth.uid()
      )
    )
    or
    (
      public.tp3d_is_org_owner(organization_id)
      and role in ('owner'::public.org_member_role, 'admin'::public.org_member_role, 'member'::public.org_member_role)
    )
    or
    (
      public.tp3d_is_org_admin(organization_id)
      and role in ('admin'::public.org_member_role, 'member'::public.org_member_role)
    )
  )
);

create policy "org_members_update_owner_admin"
on public.organization_members
for update
using (
  -- Admins can manage non-owner rows. Owners can manage any row.
  public.tp3d_is_org_owner(organization_id)
  or (
    public.tp3d_is_org_admin(organization_id)
    and role <> 'owner'::public.org_member_role
  )
)
with check (
  organization_id is not null
  and user_id is not null
  and (
    (
      public.tp3d_is_org_owner(organization_id)
      and role in ('owner'::public.org_member_role, 'admin'::public.org_member_role, 'member'::public.org_member_role)
    )
    or
    (
      public.tp3d_is_org_admin(organization_id)
      and role in ('admin'::public.org_member_role, 'member'::public.org_member_role)
    )
  )
  and (
    -- Prevent demoting/removing the last owner.
    role = 'owner'::public.org_member_role
    or public.tp3d_org_owner_count_excluding(organization_id, user_id) >= 1
  )
);

create policy "org_members_delete_owner_admin"
on public.organization_members
for delete
using (
  (
    public.tp3d_is_org_owner(organization_id)
    and (
      role <> 'owner'::public.org_member_role
      or public.tp3d_org_owner_count_excluding(organization_id, user_id) >= 1
    )
  )
  or
  (
    public.tp3d_is_org_admin(organization_id)
    and role <> 'owner'::public.org_member_role
  )
);

-- Minimal verification SQL (run manually as owner/admin/member users):
-- 1) Admin trying to promote someone to owner should fail:
--    update public.organization_members set role='owner' where organization_id='<org>' and user_id='<target>';
-- 2) Owner demoting the last owner should fail:
--    update public.organization_members set role='member' where organization_id='<org>' and user_id='<only_owner>';
-- 3) Admin deleting an owner should fail:
--    delete from public.organization_members where organization_id='<org>' and user_id='<owner_user>';
-- 4) Owner deleting a non-last owner should pass:
--    delete from public.organization_members where organization_id='<org>' and user_id='<other_owner>';
