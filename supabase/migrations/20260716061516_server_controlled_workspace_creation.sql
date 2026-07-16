-- Create workspaces through one server-only transaction. The owner membership
-- insert intentionally remains the single source of the existing trial trigger.

create or replace function public.tp3d_create_workspace(
  p_actor_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_org_id uuid;
  v_org_slug text;
  v_membership_id uuid;
  v_profile_rows integer := 0;
begin
  if p_actor_id is null then
    raise exception 'TP3D_CREATE_ACTOR_REQUIRED';
  end if;

  if p_name is null or p_name ~ '[[:cntrl:]]' then
    raise exception 'TP3D_CREATE_INVALID_NAME';
  end if;

  v_name := pg_catalog.regexp_replace(pg_catalog.btrim(p_name), '[[:space:]]+', ' ', 'g');
  if pg_catalog.char_length(v_name) < 1 or pg_catalog.char_length(v_name) > 120 then
    raise exception 'TP3D_CREATE_INVALID_NAME';
  end if;

  insert into public.organizations (name, slug, owner_id, created_at, updated_at)
  values (v_name, null, p_actor_id, pg_catalog.now(), pg_catalog.now())
  returning id into v_org_id;

  -- Match the stable UUID-based slug shape already used by signup-created
  -- workspaces. Slugs are not accepted from the browser.
  v_org_slug := v_org_id::text;
  update public.organizations
  set slug = v_org_slug
  where id = v_org_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    joined_at,
    updated_at
  )
  values (
    v_org_id,
    p_actor_id,
    'owner'::public.org_member_role,
    pg_catalog.now(),
    pg_catalog.now()
  )
  returning id into v_membership_id;

  update public.profiles
  set current_organization_id = v_org_id,
      updated_at = pg_catalog.now()
  where id = p_actor_id;

  get diagnostics v_profile_rows = row_count;
  if v_profile_rows <> 1 then
    raise exception 'TP3D_CREATE_PROFILE_MISSING';
  end if;

  return pg_catalog.jsonb_build_object(
    'organization_id', v_org_id,
    'name', v_name,
    'slug', v_org_slug,
    'owner_id', p_actor_id,
    'membership_id', v_membership_id
  );
end;
$$;

revoke execute on function public.tp3d_create_workspace(uuid, text) from public;
revoke execute on function public.tp3d_create_workspace(uuid, text) from anon;
revoke execute on function public.tp3d_create_workspace(uuid, text) from authenticated;
grant execute on function public.tp3d_create_workspace(uuid, text) to service_role;
