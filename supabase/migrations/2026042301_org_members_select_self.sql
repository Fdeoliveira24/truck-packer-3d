drop policy if exists "org_members_select_org" on public.organization_members;

create policy "org_members_select_org"
on public.organization_members
for select
using (
  user_id = auth.uid()
  or public.tp3d_org_actor_role(organization_id) is not null
);
