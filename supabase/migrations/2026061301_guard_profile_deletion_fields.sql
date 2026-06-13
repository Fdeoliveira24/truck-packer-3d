-- 2026061301_guard_profile_deletion_fields.sql
-- Server-side protection for the account-deletion lifecycle fields on
-- public.profiles: deletion_status, deleted_at, purge_after.
--
-- Background
-- ----------
-- The `profiles_update_own` RLS policy allows any authenticated user to UPDATE
-- their own profile row (id = auth.uid()). Until now, the only thing stopping a
-- user from directly writing the deletion fields (e.g. flipping
-- deletion_status back to 'canceled' to defeat the login block, or clearing
-- purge_after to dodge the purge job) was a client-side check in
-- src/core/supabase-client.js (updateProfile). That guard is trivially bypassed
-- by calling the Supabase REST API directly with a valid user token.
--
-- This migration moves the guard into the database. A BEFORE UPDATE trigger
-- rejects any change to the three deletion fields unless the caller is the
-- service role (the Edge Functions request-account-deletion,
-- cancel-account-deletion, and purge-deleted-accounts all use serviceClient())
-- or a privileged maintenance role (migrations / admin).
--
-- Safe to run once and idempotent (create or replace + drop trigger if exists).

create or replace function public.tp3d_guard_profile_deletion_fields()
returns trigger
language plpgsql
-- Runs with invoker rights (the default) so current_user reflects the real
-- caller's role and service-role / authenticated can be distinguished. Do not
-- change it to run with definer rights.
--
-- search_path is locked to '' so name resolution can never be redirected by a
-- caller-controlled search_path. The body only uses pg_catalog built-ins
-- (current_setting, nullif, the jsonb cast and ->> operator, current_user),
-- which still resolve under an empty search_path.
set search_path = ''
as $$
declare
  claim_role text;
begin
  -- Fast path: if none of the protected fields are changing, allow the update.
  -- Normal profile edits (name, bio, display_name, current_organization_id, ...)
  -- are never affected by this guard.
  if new.deletion_status is not distinct from old.deletion_status
     and new.deleted_at is not distinct from old.deleted_at
     and new.purge_after is not distinct from old.purge_after then
    return new;
  end if;

  -- Resolve the caller's role from the PostgREST JWT claims when present.
  begin
    claim_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception
    when others then
      claim_role := null;
  end;
  if claim_role is null then
    claim_role := nullif(current_setting('request.jwt.claim.role', true), '');
  end if;

  -- Allow the service role (Edge Functions using the service-role key) and
  -- privileged database roles (migrations, Studio SQL editor, admin tasks).
  if claim_role = 'service_role'
     or current_user in ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;

  -- Everyone else (authenticated end users, anon) is blocked from touching the
  -- deletion lifecycle fields. They must go through the account deletion flow.
  raise exception
    'Account deletion fields (deletion_status, deleted_at, purge_after) can only be changed by the account deletion service'
    using errcode = '42501'; -- insufficient_privilege
end;
$$;

drop trigger if exists tp3d_profiles_guard_deletion_fields on public.profiles;
create trigger tp3d_profiles_guard_deletion_fields
before update on public.profiles
for each row execute function public.tp3d_guard_profile_deletion_fields();

-- Defense in depth: this is a trigger function and cannot be invoked directly
-- (PostgreSQL rejects direct calls to trigger-returning functions and PostgREST
-- never exposes them as RPC). Revoke EXECUTE from client-reachable roles anyway
-- so it can never appear on any callable surface. Trigger execution does NOT
-- depend on the caller holding EXECUTE on the function, so the guard keeps
-- firing for every UPDATE regardless of these revokes.
revoke execute on function public.tp3d_guard_profile_deletion_fields() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.tp3d_guard_profile_deletion_fields() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.tp3d_guard_profile_deletion_fields() from authenticated';
  end if;
end $$;
