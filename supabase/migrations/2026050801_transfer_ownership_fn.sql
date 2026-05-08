-- Phase 0.6D Batch C: atomic workspace ownership transfer.
-- Only service-role Edge Functions may execute this RPC.

create or replace function public.tp3d_transfer_workspace_ownership(
  p_org_id uuid,
  p_new_owner_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org record;
  v_target_member record;
  v_actor_member record;
begin
  select o.id, o.owner_id
    into v_org
  from public.organizations o
  where o.id = p_org_id
  for update;

  if not found then
    raise exception 'TP3D_TRANSFER_ORG_NOT_FOUND';
  end if;

  if v_org.owner_id is null or v_org.owner_id <> p_actor_id then
    raise exception 'TP3D_TRANSFER_NOT_PRIMARY_OWNER';
  end if;

  if p_new_owner_id = p_actor_id then
    raise exception 'TP3D_TRANSFER_TARGET_IS_ACTOR';
  end if;

  select m.id, m.role
    into v_target_member
  from public.organization_members m
  where m.organization_id = p_org_id
    and m.user_id = p_new_owner_id
  for update;

  if not found then
    raise exception 'TP3D_TRANSFER_TARGET_NOT_MEMBER';
  end if;

  select m.id, m.role
    into v_actor_member
  from public.organization_members m
  where m.organization_id = p_org_id
    and m.user_id = p_actor_id
  for update;

  if not found then
    raise exception 'TP3D_TRANSFER_ACTOR_MEMBERSHIP_MISSING';
  end if;

  update public.organizations
  set owner_id = p_new_owner_id,
      updated_at = now()
  where id = p_org_id;

  update public.organization_members
  set role = 'owner'::public.org_member_role,
      updated_at = now()
  where organization_id = p_org_id
    and user_id = p_new_owner_id;

  update public.organization_members
  set role = 'admin'::public.org_member_role,
      updated_at = now()
  where organization_id = p_org_id
    and user_id = p_actor_id;

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_org_id,
    'old_owner_id', p_actor_id,
    'new_owner_id', p_new_owner_id
  );
end;
$$;

revoke execute on function public.tp3d_transfer_workspace_ownership(uuid, uuid, uuid) from public;
revoke execute on function public.tp3d_transfer_workspace_ownership(uuid, uuid, uuid) from anon;
revoke execute on function public.tp3d_transfer_workspace_ownership(uuid, uuid, uuid) from authenticated;
grant execute on function public.tp3d_transfer_workspace_ownership(uuid, uuid, uuid) to service_role;
