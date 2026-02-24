-- 2026021601_create_org_schema.sql
-- Base org/workspace schema required before RLS hardening + invites.

-- 1) Enum for roles
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'org_member_role'
      and n.nspname = 'public'
  ) then
    create type public.org_member_role as enum ('owner', 'admin', 'member');
  end if;
end $$;

-- 2) Organizations table
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  owner_id uuid,
  avatar_url text,
  logo_path text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Members table
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_member_role not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists organization_members_org_id_idx
  on public.organization_members(organization_id);

create index if not exists organization_members_user_id_idx
  on public.organization_members(user_id);

-- 4) updated_at trigger helper (if you already created it elsewhere, this won't hurt)
create or replace function public.tp3d_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tp3d_orgs_set_updated_at on public.organizations;
create trigger tp3d_orgs_set_updated_at
before update on public.organizations
for each row execute function public.tp3d_set_updated_at();

drop trigger if exists tp3d_org_members_set_updated_at on public.organization_members;
create trigger tp3d_org_members_set_updated_at
before update on public.organization_members
for each row execute function public.tp3d_set_updated_at();


