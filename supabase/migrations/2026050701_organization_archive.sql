-- Phase 0.6C: Archive Workspace lifecycle state.
-- Archive is soft state only: memberships, invites, packs, cases, storage,
-- billing rows, and Stripe records are intentionally untouched.

alter table public.organizations
  add column if not exists archived_at timestamptz;

create index if not exists organizations_archived_at_idx
  on public.organizations(archived_at)
  where archived_at is not null;

create or replace function public.tp3d_guard_organizations_archived_at_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_role text;
begin
  if new.archived_at is not distinct from old.archived_at then
    return new;
  end if;

  v_request_role := coalesce(
    nullif(auth.role(), ''),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );

  if v_request_role <> 'service_role' and current_user <> 'service_role' then
    raise exception 'Workspace archive state can only be changed by workspace lifecycle functions.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tp3d_guard_organizations_archived_at_update on public.organizations;

create trigger tp3d_guard_organizations_archived_at_update
  before update of archived_at on public.organizations
  for each row
  execute function public.tp3d_guard_organizations_archived_at_update();

drop function if exists public.get_user_organizations();

create function public.get_user_organizations()
returns table (
  id uuid,
  name text,
  slug text,
  avatar_url text,
  logo_path text,
  owner_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  archived_at timestamptz,
  role public.org_member_role,
  joined_at timestamptz,
  invited_by uuid
)
language sql
security definer
set search_path = public
as $$
  select
    o.id,
    o.name,
    o.slug,
    o.avatar_url,
    o.logo_path,
    o.owner_id,
    o.created_at,
    o.updated_at,
    o.phone,
    o.address_line1,
    o.address_line2,
    o.city,
    o.state,
    o.postal_code,
    o.country,
    o.archived_at,
    m.role,
    m.joined_at,
    m.invited_by
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
    and o.archived_at is null
  order by m.joined_at asc, o.created_at asc;
$$;

grant execute on function public.get_user_organizations() to authenticated;
