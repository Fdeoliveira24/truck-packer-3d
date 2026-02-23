-- 2026022201_rpc_create_organization.sql
-- Adds an RPC to safely create a new organization and assign the caller as the owner.
-- This bypasses RLS on organizations for the creation step, since clients cannot natively insert.

create or replace function public.create_organization(org_name text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations;
  safe_slug text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if trim(org_name) = '' then
    raise exception 'Organization name cannot be empty';
  end if;

  -- Generate a slug with a random suffix to avoid unique constraint violations
  safe_slug := lower(regexp_replace(trim(org_name), '[^a-zA-Z0-9]+', '-', 'g'));
  safe_slug := trim(both '-' from safe_slug);
  if safe_slug = '' then
    safe_slug := 'org';
  end if;
  safe_slug := safe_slug || '-' || substr(md5(random()::text), 1, 6);

  -- Insert the new organization
  insert into public.organizations (name, slug, owner_id)
  values (trim(org_name), safe_slug, auth.uid())
  returning * into new_org;

  -- Insert the caller as the owner
  insert into public.organization_members (organization_id, user_id, role)
  values (new_org.id, auth.uid(), 'owner'::public.org_member_role);

  return new_org;
end;
$$;
