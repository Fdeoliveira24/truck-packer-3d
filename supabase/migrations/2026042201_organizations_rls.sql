-- 2026042201_organizations_rls.sql
-- Add row-level security policies for public.organizations so authenticated
-- clients can create and manage workspaces without bypassing the shared modal flow.

alter table public.organizations enable row level security;

create or replace function public.tp3d_org_owner_id(org_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select o.owner_id
  from public.organizations o
  where o.id = org_id
  limit 1;
$$;

drop policy if exists "organizations_select_member" on public.organizations;
drop policy if exists "organizations_insert_owner_self" on public.organizations;
drop policy if exists "organizations_update_admin_owner" on public.organizations;

create policy "organizations_select_member"
on public.organizations
for select
using (
  owner_id = auth.uid()
  or public.tp3d_org_actor_role(id) is not null
);

create policy "organizations_insert_owner_self"
on public.organizations
for insert
with check (
  auth.uid() is not null
  and owner_id = auth.uid()
);

create policy "organizations_update_admin_owner"
on public.organizations
for update
using (
  public.tp3d_is_org_admin_or_owner(id)
)
with check (
  public.tp3d_is_org_admin_or_owner(id)
  and owner_id = public.tp3d_org_owner_id(id)
);
