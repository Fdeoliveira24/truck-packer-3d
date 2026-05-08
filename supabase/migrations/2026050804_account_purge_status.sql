alter table public.profiles
  drop constraint if exists profiles_deletion_status_check;

alter table public.profiles
  add constraint profiles_deletion_status_check
  check (
    deletion_status is null
    or deletion_status in ('requested', 'canceled', 'purged')
  );
