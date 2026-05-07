-- 2026050601_fix_signup_auto_org_uuid.sql
-- Keep signup workspace seeding independent from extension search_path and
-- prevent optional billing trial seed failures from aborting Auth signup.
--
-- The previous trigger body called gen_random_uuid() while the function's
-- search_path was pinned to public. In hosted Supabase, gen_random_uuid() can
-- resolve from the extensions schema, causing Auth signup to fail with
-- "Database error saving new user". Let organizations.id use its table default
-- instead, then normalize slug after the generated id is known.
--
-- The owner membership insert also fires trg_seed_billing_customer_trial. That
-- billing snapshot is optional setup data; if a live billing_customers table has
-- a legacy column shape/constraint mismatch, it must not roll back auth.users.

create or replace function public.seed_billing_customer_trial_for_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_days constant integer := 7;
  v_trial_ends_at timestamptz := now() + make_interval(days => v_trial_days);
  v_has_other_owned_workspace boolean := false;
  v_has_user_id_column boolean := false;
  v_inserted_org_id uuid;
begin
  if coalesce(new.organization_id::text, '') = '' then
    return new;
  end if;

  if lower(coalesce(new.role::text, '')) <> 'owner' then
    return new;
  end if;

  select exists (
    select 1
    from public.organizations o
    where o.owner_id = new.user_id
      and o.id <> new.organization_id
  )
  into v_has_other_owned_workspace;

  select exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c
      on c.oid = a.attrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'billing_customers'
      and a.attname = 'user_id'
      and a.attnum > 0
      and not a.attisdropped
  )
  into v_has_user_id_column;

  if v_has_user_id_column then
    execute
      'insert into public.billing_customers (
         organization_id,
         user_id,
         status,
         trial_ends_at,
         created_at,
         updated_at
       )
       values (
         $1,
         $2,
         case when $3 then null else ''trialing''::public.billing_status end,
         case when $3 then null else $4 end,
         now(),
         now()
       )
       on conflict (organization_id) do nothing
       returning organization_id'
    into v_inserted_org_id
    using new.organization_id, new.user_id, v_has_other_owned_workspace, v_trial_ends_at;
  else
    insert into public.billing_customers (
      organization_id,
      status,
      trial_ends_at,
      created_at,
      updated_at
    )
    values (
      new.organization_id,
      case
        when v_has_other_owned_workspace then null
        else 'trialing'::public.billing_status
      end,
      case
        when v_has_other_owned_workspace then null
        else v_trial_ends_at
      end,
      now(),
      now()
    )
    on conflict (organization_id) do nothing
    returning organization_id into v_inserted_org_id;
  end if;

  if v_inserted_org_id is not null then
    if v_has_other_owned_workspace then
      raise log 'billing_customer placeholder seeded for repeat-owner org %', new.organization_id;
    else
      raise log 'billing_customer trial seeded for first-owner org %, trial_ends_at %', new.organization_id, v_trial_ends_at;
    end if;
  end if;

  return new;
exception
  when others then
    raise warning 'billing_customer trial seed skipped for org %, SQLSTATE %, message %',
      new.organization_id,
      SQLSTATE,
      SQLERRM;
    return new;
end;
$$;

drop trigger if exists trg_seed_billing_customer_trial on public.organizations;
drop trigger if exists trg_seed_billing_customer_trial on public.organization_members;

create trigger trg_seed_billing_customer_trial
after insert on public.organization_members
for each row
execute function public.seed_billing_customer_trial_for_org();

-- Remove the older default-org signup trigger if it exists. Running two auth
-- signup triggers can create duplicate workspaces or make the second trigger
-- fail against a schema variant the first trigger already partially populated.
drop trigger if exists on_auth_user_create_default_org on auth.users;

create or replace function public.tp3d_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_display_name text;
  v_profile_name text;
  v_has_membership boolean := false;
  v_has_profile_email_column boolean := false;
  v_has_member_updated_at_column boolean := false;
begin
  -- Derive a workspace name from the email (before the @).
  v_display_name := split_part(coalesce(new.email, ''), '@', 1);
  if v_display_name = '' then
    v_display_name := 'My Workspace';
  end if;
  v_profile_name := nullif(v_display_name, '');

  -- If a legacy trigger already created membership, avoid creating a duplicate
  -- workspace. The migration drops that trigger, but this keeps the function
  -- safe while deployments converge.
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = new.id
  )
  into v_has_membership;

  select exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c
      on c.oid = a.attrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and a.attname = 'email'
      and a.attnum > 0
      and not a.attisdropped
  )
  into v_has_profile_email_column;

  -- Upsert profile row. Some deployed profile schemas intentionally do not
  -- expose public.profiles.email, so only write it when that column exists.
  if v_has_profile_email_column then
    execute
      'insert into public.profiles (id, email, display_name, full_name, created_at, updated_at)
       values ($1, $2, $3, $3, now(), now())
       on conflict (id) do update
       set email = excluded.email,
           updated_at = now()'
    using new.id, new.email, v_profile_name;
  else
    insert into public.profiles (id, display_name, full_name, created_at, updated_at)
    values (new.id, v_profile_name, v_profile_name, now(), now())
    on conflict (id) do update set updated_at = now();
  end if;

  if v_has_membership then
    return new;
  end if;

  -- Create the default personal workspace. Use the organizations.id default so
  -- the trigger body does not depend on extension functions in search_path.
  insert into public.organizations (name, slug, owner_id, created_at, updated_at)
  values (
    v_display_name || '''s Workspace',
    new.id::text,
    new.id,
    now(),
    now()
  )
  returning id into v_org_id;

  -- Keep the historical slug shape of org UUIDs once the generated id is known.
  update public.organizations
  set slug = v_org_id::text
  where id = v_org_id;

  select exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c
      on c.oid = a.attrelid
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'organization_members'
      and a.attname = 'updated_at'
      and a.attnum > 0
      and not a.attisdropped
  )
  into v_has_member_updated_at_column;

  -- Add user as owner (this fires trg_seed_billing_customer_trial). Some older
  -- organization_members schemas do not have updated_at.
  if v_has_member_updated_at_column then
    execute
      'insert into public.organization_members (organization_id, user_id, role, joined_at, updated_at)
       values ($1, $2, ''owner''::public.org_member_role, now(), now())'
    using v_org_id, new.id;
  else
    insert into public.organization_members (organization_id, user_id, role, joined_at)
    values (v_org_id, new.id, 'owner'::public.org_member_role, now());
  end if;

  -- Set as current org on the profile.
  update public.profiles
  set current_organization_id = v_org_id
  where id = new.id;

  return new;
end;
$$;
