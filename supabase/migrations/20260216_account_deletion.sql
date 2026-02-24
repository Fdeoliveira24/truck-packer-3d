-- 20260216_account_deletion.sql
-- Idempotent schema support for request-account-deletion edge function.

alter table public.profiles
  add column if not exists deletion_status text;

alter table public.profiles
  add column if not exists deleted_at timestamptz;

alter table public.profiles
  add column if not exists purge_after timestamptz;

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
