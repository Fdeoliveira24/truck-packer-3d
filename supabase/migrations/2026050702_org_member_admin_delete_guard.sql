-- Phase 0.6D-pre Batch 1B/2: Admins may remove members only.
-- Owners retain existing delete behavior, including last-owner protection.

drop policy if exists "org_members_delete_owner_admin" on public.organization_members;

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
    and role = 'member'::public.org_member_role
  )
);
