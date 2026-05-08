-- Phase 0.6D Batch B: archived workspace listing for restore flow.
-- Mirrors get_user_organizations(), but returns archived workspaces only.

create or replace function public.get_user_archived_organizations()
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
    om.role,
    om.joined_at,
    om.invited_by
  from public.organizations o
  join public.organization_members om
    on om.organization_id = o.id
  where om.user_id = auth.uid()
    and o.archived_at is not null
  order by o.archived_at desc nulls last, o.updated_at desc nulls last, o.created_at desc;
$$;

revoke all on function public.get_user_archived_organizations() from public;
grant execute on function public.get_user_archived_organizations() to authenticated;
