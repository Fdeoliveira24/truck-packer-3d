-- 2026021501_create_profiles.sql
-- Creates public.profiles for local dev + minimal RLS.
-- Must run before 20260216_account_deletion.sql.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  display_name text,
  first_name text,
  last_name text,
  bio text,
  current_organization_id uuid,

  -- columns used by account deletion flow migration
  deletion_status text,
  deleted_at timestamptz,
  purge_after timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_deletion_status_idx
  on public.profiles(deletion_status);

create index if not exists profiles_purge_after_idx
  on public.profiles(purge_after);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_deletion_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_deletion_status_check
      check (deletion_status is null or deletion_status in ('requested', 'canceled'));
  end if;
end $$;

create or replace function public.tp3d_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tp3d_profiles_set_updated_at on public.profiles;
create trigger tp3d_profiles_set_updated_at
before update on public.profiles
for each row execute function public.tp3d_set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Create profile row on signup (helps local dev)
create or replace function public.tp3d_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists tp3d_on_auth_user_created on auth.users;
create trigger tp3d_on_auth_user_created
after insert on auth.users
for each row execute function public.tp3d_handle_new_user();