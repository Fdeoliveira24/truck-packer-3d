-- 2026021703_organization_invites.sql
-- Adds organization invite tracking with owner/admin-only management.

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.org_member_role not null default 'member'::public.org_member_role,
  status text not null default 'pending',
  token text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invites_status_check check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

alter table public.organization_invites
  add column if not exists organization_id uuid,
  add column if not exists email text,
  add column if not exists role public.org_member_role,
  add column if not exists status text,
  add column if not exists token text,
  add column if not exists invited_by uuid,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.organization_invites
  alter column role set default 'member'::public.org_member_role,
  alter column status set default 'pending',
  alter column invited_at set default now(),
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.organization_invites
set role = 'member'::public.org_member_role
where role is null;

update public.organization_invites
set status = 'pending'
where status is null;

update public.organization_invites
set invited_at = coalesce(invited_at, now())
where invited_at is null;

update public.organization_invites
set created_at = coalesce(created_at, now())
where created_at is null;

update public.organization_invites
set updated_at = coalesce(updated_at, now())
where updated_at is null;

update public.organization_invites
set token = gen_random_uuid()::text
where token is null or btrim(token) = '';

alter table public.organization_invites
  alter column role set not null,
  alter column status set not null,
  alter column token set not null,
  alter column invited_at set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create unique index if not exists organization_invites_token_unique
  on public.organization_invites(token);

create index if not exists organization_invites_org_idx
  on public.organization_invites(organization_id);

create index if not exists organization_invites_org_invited_at_idx
  on public.organization_invites(organization_id, invited_at desc);

create unique index if not exists organization_invites_pending_unique
  on public.organization_invites(organization_id, lower(email))
  where status = 'pending' and revoked_at is null and accepted_at is null;

create or replace function public.tp3d_set_org_invites_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_org_invites_updated_at on public.organization_invites;
create trigger trg_org_invites_updated_at
before update on public.organization_invites
for each row
execute function public.tp3d_set_org_invites_updated_at();

alter table public.organization_invites enable row level security;

drop policy if exists "org_invites_select_admin_owner" on public.organization_invites;
drop policy if exists "org_invites_insert_admin_owner" on public.organization_invites;
drop policy if exists "org_invites_update_admin_owner" on public.organization_invites;
drop policy if exists "org_invites_delete_admin_owner" on public.organization_invites;

create policy "org_invites_select_admin_owner"
on public.organization_invites
for select
using (
  public.tp3d_is_org_admin_or_owner(organization_id)
);

create policy "org_invites_insert_admin_owner"
on public.organization_invites
for insert
with check (
  organization_id is not null
  and email is not null
  and invited_by = auth.uid()
  and status in ('pending', 'accepted', 'revoked', 'expired')
  and public.tp3d_is_org_admin_or_owner(organization_id)
  and (
    public.tp3d_is_org_owner(organization_id)
    or role in ('admin'::public.org_member_role, 'member'::public.org_member_role)
  )
);

create policy "org_invites_update_admin_owner"
on public.organization_invites
for update
using (
  public.tp3d_is_org_admin_or_owner(organization_id)
)
with check (
  organization_id is not null
  and email is not null
  and status in ('pending', 'accepted', 'revoked', 'expired')
  and public.tp3d_is_org_admin_or_owner(organization_id)
  and (
    public.tp3d_is_org_owner(organization_id)
    or role in ('admin'::public.org_member_role, 'member'::public.org_member_role)
  )
);

create policy "org_invites_delete_admin_owner"
on public.organization_invites
for delete
using (
  public.tp3d_is_org_admin_or_owner(organization_id)
);
