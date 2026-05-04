# Truck Packer 3D — Supabase Current State (02-07-2026) — V1

This file is a clean snapshot of the Supabase database + RLS setup as reported on **February 7, 2026**.

It is meant to be shared with Codex so it can reason about the real schema, policies, triggers, and edge cases (like users with no org).

---

## 0) Key facts (high level)

- Schema: `public`
- Core tables with RLS enabled: `profiles`, `organizations`, `organization_members`, `packs`, `cases`
- Org roles enum values: `owner`, `admin`, `member`, `viewer`
- New users: `auth.users` INSERT trigger runs `public.create_default_org_for_new_user()` (creates profile + org + membership, and sets `profiles.current_organization_id`)

---

## 1) Profiles table: current org column

Query result (profiles column list):

```json
[
  {"column_name":"id"},
  {"column_name":"full_name"},
  {"column_name":"first_name"},
  {"column_name":"last_name"},
  {"column_name":"avatar_url"},
  {"column_name":"bio"},
  {"column_name":"created_at"},
  {"column_name":"updated_at"},
  {"column_name":"display_name"},
  {"column_name":"deleted_at"},
  {"column_name":"purge_after"},
  {"column_name":"deletion_status"},
  {"column_name":"current_organization_id"}
]
```

Notes:
- `current_organization_id` is the server-stored “active workspace” pointer.
- This replaces earlier naming like `current_org_id` in older docs.

---

## 2) RLS enabled (row security on)

Query result:

```json
[
  {"schemaname":"public","tablename":"cases","rowsecurity":true},
  {"schemaname":"public","tablename":"organization_members","rowsecurity":true},
  {"schemaname":"public","tablename":"organizations","rowsecurity":true},
  {"schemaname":"public","tablename":"packs","rowsecurity":true},
  {"schemaname":"public","tablename":"profiles","rowsecurity":true}
]
```

---

## 3) organization_members table shape

Query result:

```json
[
  {"column_name":"id","data_type":"uuid"},
  {"column_name":"organization_id","data_type":"uuid"},
  {"column_name":"user_id","data_type":"uuid"},
  {"column_name":"role","data_type":"USER-DEFINED"},
  {"column_name":"invited_by","data_type":"uuid"},
  {"column_name":"joined_at","data_type":"timestamp with time zone"}
]
```

---

## 4) RLS policies: full list (as provided)

```json
[
  {
    "schemaname": "public",
    "tablename": "cases",
    "policyname": "cases_org_member_delete",
    "cmd": "DELETE",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = cases.organization_id) AND (om.user_id = auth.uid()))))",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "cases",
    "policyname": "cases_org_member_insert",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = cases.organization_id) AND (om.user_id = auth.uid()))))"
  },
  {
    "schemaname": "public",
    "tablename": "cases",
    "policyname": "cases_org_member_select",
    "cmd": "SELECT",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = cases.organization_id) AND (om.user_id = auth.uid()))))",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "cases",
    "policyname": "cases_org_member_update",
    "cmd": "UPDATE",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = cases.organization_id) AND (om.user_id = auth.uid()))))",
    "with_check": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = cases.organization_id) AND (om.user_id = auth.uid()))))"
  },

  {
    "schemaname": "public",
    "tablename": "organization_members",
    "policyname": "org_members_select_current_user",
    "cmd": "SELECT",
    "qual": "(user_id = auth.uid())",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "organization_members",
    "policyname": "org_members_select_own",
    "cmd": "SELECT",
    "qual": "(auth.uid() = user_id)",
    "with_check": null
  },

  {
    "schemaname": "public",
    "tablename": "organizations",
    "policyname": "Members can view their organizations",
    "cmd": "SELECT",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members\n  WHERE ((organization_members.organization_id = organizations.id) AND (organization_members.user_id = auth.uid()))))",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "organizations",
    "policyname": "organizations_delete_owner",
    "cmd": "DELETE",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = organizations.id) AND (om.user_id = auth.uid()) AND (om.role = 'owner'::org_member_role))))",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "organizations",
    "policyname": "organizations_update_owner_admin",
    "cmd": "UPDATE",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = organizations.id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::org_member_role, 'admin'::org_member_role])))))",
    "with_check": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = organizations.id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::org_member_role, 'admin'::org_member_role])))))"
  },
  {
    "schemaname": "public",
    "tablename": "organizations",
    "policyname": "orgs_select_if_member",
    "cmd": "SELECT",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members m\n  WHERE ((m.organization_id = organizations.id) AND (m.user_id = auth.uid()))))",
    "with_check": null
  },

  {
    "schemaname": "public",
    "tablename": "packs",
    "policyname": "packs_org_member_delete",
    "cmd": "DELETE",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = packs.organization_id) AND (om.user_id = auth.uid()))))",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "packs",
    "policyname": "packs_org_member_insert",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = packs.organization_id) AND (om.user_id = auth.uid()))))"
  },
  {
    "schemaname": "public",
    "tablename": "packs",
    "policyname": "packs_org_member_select",
    "cmd": "SELECT",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = packs.organization_id) AND (om.user_id = auth.uid()))))",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "packs",
    "policyname": "packs_org_member_update",
    "cmd": "UPDATE",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = packs.organization_id) AND (om.user_id = auth.uid()))))",
    "with_check": "(EXISTS ( SELECT 1\n   FROM organization_members om\n  WHERE ((om.organization_id = packs.organization_id) AND (om.user_id = auth.uid()))))"
  },

  {
    "schemaname": "public",
    "tablename": "profiles",
    "policyname": "Users can update their own profile",
    "cmd": "UPDATE",
    "qual": "(auth.uid() = id)",
    "with_check": "(auth.uid() = id)"
  },
  {
    "schemaname": "public",
    "tablename": "profiles",
    "policyname": "Users can view their own profile",
    "cmd": "SELECT",
    "qual": "(auth.uid() = id)",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "profiles",
    "policyname": "profiles_insert_self",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "(id = auth.uid())"
  },
  {
    "schemaname": "public",
    "tablename": "profiles",
    "policyname": "profiles_select_own",
    "cmd": "SELECT",
    "qual": "(auth.uid() = id)",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "profiles",
    "policyname": "profiles_update_own",
    "cmd": "UPDATE",
    "qual": "(auth.uid() = id)",
    "with_check": "(auth.uid() = id)"
  }
]
```

### Important gap to note (very likely)
The `organization_members` table currently shows **SELECT-only** policies (two policies, same intent).
If your app now supports:
- listing org members
- changing roles
- removing members

…then you usually also need `SELECT` policies that allow owner/admin to read the org member list for their org, plus `UPDATE` and `DELETE` policies for owner/admin.

If those policies exist, they were not included in the provided policy list. If they do *not* exist, Roles UI will fail in production.

### 4.1) Policies added for Roles UI (02-07-2026)

```sql
-- Allow members to see all members in their org
create policy "org_members_select_org"
on public.organization_members for select
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = organization_members.organization_id
      and om.user_id = auth.uid()
  )
);

-- Allow owners/admins to update roles
create policy "org_members_update_owner_admin"
on public.organization_members for update
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = organization_members.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner','admin')
  )
)
with check (true);

-- Allow owners/admins to remove members
create policy "org_members_delete_owner_admin"
on public.organization_members for delete
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = organization_members.organization_id
      and om.user_id = auth.uid()
      and om.role in ('owner','admin')
  )
);

-- Allow profile reads for users who share an org
create policy "profiles_select_same_org"
on public.profiles for select
using (
  exists (
    select 1
    from public.organization_members om_self
    join public.organization_members om_target
      on om_self.organization_id = om_target.organization_id
    where om_self.user_id = auth.uid()
      and om_target.user_id = profiles.id
  )
);
```

---

## 5) Triggers: auth.users → create default org

Query result:

```json
[
  {
    "trigger_name": "on_auth_user_create_default_org",
    "event_manipulation": "INSERT",
    "action_timing": "AFTER",
    "event_object_table": "users",
    "action_statement": "EXECUTE FUNCTION create_default_org_for_new_user()"
  }
]
```

---

## 6) Functions: definitions (as provided)

### 6.1) create_default_org_for_new_user()

```sql
CREATE OR REPLACE FUNCTION public.create_default_org_for_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  new_org_id uuid;
  base_name text;
  has_membership boolean;
begin
  select exists (
    select 1 from public.organization_members m
    where m.user_id = new.id
  ) into has_membership;

  if has_membership then
    return new;
  end if;

  base_name := split_part(coalesce(new.email, ''), '@', 1);

  -- Ensure profile exists (idempotent)
  insert into public.profiles (id, display_name, full_name, created_at, updated_at)
  values (new.id, nullif(base_name,''), nullif(base_name,''), now(), now())
  on conflict (id) do update set updated_at = now();

  insert into public.organizations (name, owner_id, created_at, updated_at)
  values (coalesce(nullif(base_name, ''), 'New Workspace') || ' Workspace', new.id, now(), now())
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role, joined_at)
  values (new_org_id, new.id, 'owner', now());

  update public.profiles
  set current_organization_id = new_org_id,
      updated_at = now()
  where id = new.id;

  return new;
end;
$function$;
```

### 6.2) get_user_organizations()

```sql
CREATE OR REPLACE FUNCTION public.get_user_organizations()
 RETURNS TABLE(
  id uuid, name text, slug text, avatar_url text, owner_id uuid,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  phone text, address_line1 text, address_line2 text, city text, state text,
  postal_code text, country text,
  role org_member_role, joined_at timestamp with time zone
)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    o.id,
    o.name,
    o.slug,
    o.avatar_url,
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
    om.role,
    om.joined_at
  from public.organizations o
  join public.organization_members om
    on om.organization_id = o.id
  where om.user_id = auth.uid()
  order by o.updated_at desc, o.created_at desc;
$function$;
```

### 6.3) SECURITY DEFINER helpers (added 02-07-2026)

These helpers are used by RLS policies to avoid recursive self-joins and to centralize
org membership checks.

```sql
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = org_id
      and om.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = org_id
      and om.user_id = auth.uid()
      and om.role in ('owner','admin')
  );
$$;

create or replace function public.share_org_with(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om_self
    join public.organization_members om_target
      on om_self.organization_id = om_target.organization_id
    where om_self.user_id = auth.uid()
      and om_target.user_id = target_user_id
  );
$$;
```

### 6.3) handle_new_user()

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  base_name text;
begin
  base_name := split_part(coalesce(new.email, ''), '@', 1);

  insert into public.profiles (
    id, display_name, full_name, created_at, updated_at
  )
  values (
    new.id, nullif(base_name, ''), nullif(base_name, ''), now(), now()
  )
  on conflict (id) do update
    set updated_at = now();

  return new;
end;
$function$;
```

### 6.4) set_updated_at()

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
```

### 6.5) Helper functions for RLS (security definer)

```sql
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = org_id
      and om.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = org_id
      and om.user_id = auth.uid()
      and om.role in ('owner','admin')
  );
$$;

create or replace function public.share_org_with(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om_self
    join public.organization_members om_target
      on om_self.organization_id = om_target.organization_id
    where om_self.user_id = auth.uid()
      and om_target.user_id = target_user_id
  );
$$;
```

---

## 7) Updated-at triggers (as provided)

```json
[
  {"event_object_table":"cases","trigger_name":"trg_cases_updated_at","action_statement":"EXECUTE FUNCTION set_updated_at()"},
  {"event_object_table":"organizations","trigger_name":"trg_organizations_updated_at","action_statement":"EXECUTE FUNCTION set_updated_at()"},
  {"event_object_table":"packs","trigger_name":"trg_packs_updated_at","action_statement":"EXECUTE FUNCTION set_updated_at()"},
  {"event_object_table":"profiles","trigger_name":"trg_profiles_updated_at","action_statement":"EXECUTE FUNCTION set_updated_at()"}
]
```

---

## 8) Storage bucket policies (avatars)

Query result:

```json
[
  {
    "policyname": "avatars_delete_own",
    "cmd": "DELETE",
    "qual": "((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))",
    "with_check": null
  },
  {
    "policyname": "avatars_read_own",
    "cmd": "SELECT",
    "qual": "((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))",
    "with_check": null
  },
  {
    "policyname": "avatars_update_own",
    "cmd": "UPDATE",
    "qual": "((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))",
    "with_check": "((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))"
  },
  {
    "policyname": "avatars_write_own",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))"
  }
]
```

Implication:
- Avatar paths should be `avatars/<user_id>/...` so foldername[1] matches `auth.uid()`.

---

## 9) Foreign keys + constraints (as provided)

### 9.1) organization_members constraints

```json
[
  {
    "conname": "organization_members_invited_by_fkey",
    "def": "FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL"
  },
  {
    "conname": "organization_members_organization_id_fkey",
    "def": "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
  },
  {
    "conname": "organization_members_organization_id_user_id_key",
    "def": "UNIQUE (organization_id, user_id)"
  },
  {
    "conname": "organization_members_pkey",
    "def": "PRIMARY KEY (id)"
  },
  {
    "conname": "organization_members_user_id_fkey",
    "def": "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
  }
]
```

### 9.2) cross-table foreign keys (excerpt)

```json
[
  {"conname":"cases_created_by_fkey","def":"FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL"},
  {"conname":"cases_organization_id_fkey","def":"FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"},
  {"conname":"organization_members_invited_by_fkey","def":"FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL"},
  {"conname":"organization_members_organization_id_fkey","def":"FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"},
  {"conname":"organization_members_user_id_fkey","def":"FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"},
  {"conname":"organizations_owner_id_fkey","def":"FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL"},
  {"conname":"packs_created_by_fkey","def":"FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL"},
  {"conname":"packs_organization_id_fkey","def":"FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"},
  {"conname":"profiles_id_fkey","def":"FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE"}
]
```

---

## 10) Enum values: org_member_role

Query result:

```json
[
  {"enumlabel":"owner"},
  {"enumlabel":"admin"},
  {"enumlabel":"member"},
  {"enumlabel":"viewer"}
]
```

---

## 11) One “success” check

You reported:

> Success. No rows returned

This likely means a validation query returned empty (expected). Keep it in your test log, but include the exact SQL in future so Codex can match it to behavior.

---

## 12) Additional Supabase sanity checks to run (recommended)

These checks help confirm that **Roles UI + org context** work under real RLS, and that Stripe work later will not hit surprises.

### 12.1) Confirm Roles UI policies exist (or add them)

Run:

```sql
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'organization_members'
order by cmd, policyname;
```

What you want to see (minimum):
- `SELECT` that lets owner/admin list members in their org
- `UPDATE` that lets owner/admin change roles in their org (with a `with_check` that keeps org_id stable)
- `DELETE` that lets owner/admin remove members in their org

If those do not exist, Roles UI will only ever see the current user row and will not be able to update/delete.

### 12.2) Confirm `profiles.current_organization_id` can be updated by the user

```sql
-- as an authenticated user (not service role)
update public.profiles
set current_organization_id = current_organization_id
where id = auth.uid()
returning id, current_organization_id;
```

Expected: update succeeds and returns one row.

### 12.3) Confirm `get_user_organizations()` works as an authenticated user

```sql
select * from public.get_user_organizations();
```

Expected:
- if user has an org membership: 1+ rows
- if user has no membership: 0 rows

### 12.4) Confirm default org creation trigger works for new users

Create a new auth user (email+password) and then check:

```sql
select id, current_organization_id from public.profiles where id = '<NEW_USER_UUID>';
select * from public.organization_members where user_id = '<NEW_USER_UUID>';
select * from public.organizations where owner_id = '<NEW_USER_UUID>';
```

Expected:
- profile exists
- one org exists owned by the user
- one membership row exists with role `owner`
- `current_organization_id` is set to that org

### 12.5) Confirm org-scoped reads work (packs/cases)

As an authenticated user:

```sql
select count(*) from public.packs;
select count(*) from public.cases;
```

Expected:
- counts reflect only rows in org(s) where the user is a member

### 12.6) Confirm storage policies: avatar upload path

If your upload path is not `avatars/<user_id>/...`, update the app to match the policy.

Test by uploading an avatar and verifying:
- upload succeeds
- read succeeds
- delete succeeds

---

## 13) What to share with Codex

- This full file (current state snapshot)
- Any missing `organization_members` UPDATE/DELETE policies, if Roles UI is meant to work now
- A short note that you cleaned test users and are now testing with one admin user + fresh users

---

End of file.
