-- 20260418_auto_org_on_signup.sql
-- Extend tp3d_handle_new_user to auto-create a "My Workspace" organization
-- for every new user. The trg_seed_billing_customer_trial trigger fires on
-- organization_members insert, so the 7-day trial starts automatically.

create or replace function public.tp3d_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_display_name text;
begin
  -- Upsert profile row
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;

  -- Derive a workspace name from the email (before the @)
  v_display_name := split_part(coalesce(new.email, ''), '@', 1);
  if v_display_name = '' then
    v_display_name := 'My Workspace';
  end if;

  -- Create default personal workspace
  v_org_id := gen_random_uuid();
  insert into public.organizations (id, name, slug, owner_id, created_at, updated_at)
  values (
    v_org_id,
    v_display_name || '''s Workspace',
    v_org_id::text,  -- slug = org UUID (unique, can be renamed later)
    new.id,
    now(),
    now()
  );

  -- Add user as owner (this fires trg_seed_billing_customer_trial → 7-day trial starts)
  insert into public.organization_members (organization_id, user_id, role, joined_at, updated_at)
  values (v_org_id, new.id, 'owner', now(), now());

  -- Set as current org on the profile
  update public.profiles
  set current_organization_id = v_org_id
  where id = new.id;

  return new;
end;
$$;

-- Trigger already exists from the profiles migration; replacing the function is sufficient.
-- Idempotent: re-running this migration just replaces the function body.
