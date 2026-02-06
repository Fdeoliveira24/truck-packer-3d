# Truck Packer 3D — Supabase Implementation Record

**Date:** 2026-02-03  
**Project:** Truck Packer 3D  
**Scope:** Auth → Profiles → Orgs/Memberships + RLS + “stale user/org after login” debugging context

---

## 1) Problem we were chasing (app side)

### Symptoms

- After signing in (especially with multiple tabs), UI could show **stale user/org** data (previous
  account) until refresh.
- Some debug noise appeared around session/user reads and single-flight calls.
- In dev console, `getAccountBundleSingleFlight({ force:true })` sometimes looked “pending” or
  mismatched with `getAuthState()`.

### Working theory

This was likely caused by some mix of:

- account/org bundle caching not being reset on auth events,
- async requests finishing after auth changes (race),
- multiple session/user reads in parallel,
- missing org membership for most test users (bundle returns “no orgs”),
- and/or RLS preventing reads (returns empty, can look like “stale”).

---

## 2) What we verified in the app (from console + repo scan)

### Confirmed in browser console

- Supabase wrapper exists globally: `window.SupabaseClient` / `window.__TP3D_SUPABASE_API`
- Wrapper exposes these key functions:
  - `getClient`, `getAuthState`, `getAuthEpoch`
  - `getSessionSingleFlight`, `getUserSingleFlight`
  - `getAccountBundleSingleFlight`, `invalidateAccountCache`
  - `onAuthStateChange`, `signIn`, `signOut`, etc.
- Client wrapper patching is active (`auth.getSession` patched).

### Important code note spotted in `src/core/supabase-client.js`

Inside `updateAuthState()`, there was an editor snippet showing a typo like:

- `_a uthState.user = ...` If that typo exists in your real runtime file, it can break auth state
  updates. **Action:** confirm the current file has no stray `_a` typo and your build is using the
  updated file.

---

## 3) Supabase database work done on 2026-02-03

### 3.1 Profiles table shape (confirmed)

`public.profiles` columns (no `email` column):

- `id uuid`
- `full_name text`
- `first_name text`
- `last_name text`
- `avatar_url text`
- `bio text`
- `created_at timestamptz`
- `updated_at timestamptz`
- `display_name text`
- `deleted_at timestamptz`
- `purge_after timestamptz`
- `deletion_status text`
- `current_organization_id uuid`

This is why earlier SQL using `profiles(email)` failed.

### 3.2 Profiles: auto-create on signup

#### Function updated (final)

`public.handle_new_user()` now inserts a profile with:

- `id = new.id`
- `display_name` and `full_name` derived from email prefix
- timestamps
- **On conflict:** only updates `updated_at`

#### Triggers discovered (problem)

Two triggers exist on `auth.users`, both calling `handle_new_user()`:

- `handle_new_user_trigger`
- `on_auth_user_created`

**Risk:** both fire on signup → double work, noisy debugging, and future side effects.

✅ **Recommendation:** keep ONE and drop the other.

### 3.3 Backfill profiles (for existing users)

A backfill insert was run to create profiles for auth users missing them:

```sql
insert into public.profiles (id, display_name, full_name, created_at, updated_at)
select
  u.id,
  split_part(coalesce(u.email, ''), '@', 1) as display_name,
  split_part(coalesce(u.email, ''), '@', 1) as full_name,
  now(),
  now()
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
```

Result: **Success. No rows returned** (no missing profile rows at that time).

### 3.4 Default org + membership on signup (Option A)

A new trigger function was created and installed:

- Function: `public.create_default_org_for_new_user()`
  - If user already has any membership → do nothing
  - Else:
    - Insert an org named `{email_prefix} Workspace`
    - Insert membership with role `'owner'`
    - Update `profiles.current_organization_id` to that org

- Trigger created:
  - `on_auth_user_create_default_org` (AFTER INSERT on `auth.users`)

#### Important risk: trigger order / profile row existence

Both profile-creation and org-creation triggers are **AFTER INSERT on auth.users**. Trigger
execution order is not guaranteed.

If `create_default_org_for_new_user()` runs before the profile insert:

- `update public.profiles ... where id = new.id` affects 0 rows
- user ends up with org + membership, but **profile.current_organization_id stays null**

✅ **Recommendation:** make `create_default_org_for_new_user()` upsert the profile row (or move
current-org set into a trigger on `public.profiles`).

### 3.5 RLS status and policies

RLS status (confirmed):

- `profiles`: ON
- `organization_members`: ON
- `organizations`: ON

Policies added (select-only baseline):

1. `org_members_select_own` on `public.organization_members`

- allows authenticated users to select rows where `auth.uid() = user_id`

2. `orgs_select_if_member` on `public.organizations`

- allows authenticated users to select orgs where a membership exists for `auth.uid()`

Profiles policies already exist:

- select/update own (`auth.uid() = id`)

---

## 4) Current issues / risks remaining

### A) Duplicate profile triggers (must fix)

You currently have **two** triggers creating a profile:

- `handle_new_user_trigger`
- `on_auth_user_created`

### B) Org trigger may not set `current_organization_id`

Because trigger order is not guaranteed, the profile row might not exist when org trigger runs.

### C) Existing users still have no orgs

Most test users show `organization_members = null`. Unless you backfill org/membership for existing
accounts, the app will keep showing:

- no workspace
- empty org list
- null `current_organization_id`

This is not a frontend bug—just missing data.

---

## 5) Fixes to apply (recommended)

### 5.1 Remove the duplicate profile trigger (pick ONE)

Keep whichever name you prefer, but keep only one.

Example (keep `on_auth_user_created`, drop the other):

```sql
drop trigger if exists handle_new_user_trigger on auth.users;
```

Or (keep `handle_new_user_trigger`, drop the other):

```sql
drop trigger if exists on_auth_user_created on auth.users;
```

### 5.2 Make org creation trigger safe if profile row isn’t there yet

Update `public.create_default_org_for_new_user()` to upsert a profile before updating it:

```sql
create or replace function public.create_default_org_for_new_user()
returns trigger
language plpgsql
security definer
as $$
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
$$;
```

No trigger change needed after this—your existing trigger will use the new function body.

### 5.3 Backfill org + membership for existing users (optional but likely needed)

If you want every user to have a workspace, run a backfill that:

- creates a workspace for users with no membership
- inserts membership
- sets `profiles.current_organization_id` if null

(We can generate this SQL once you confirm whether you want “one org per user” or an invite-based
flow.)

---

## 6) Verification checklist (run after fixes)

### 6.1 Confirm triggers on auth.users

```sql
select t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth'
  and c.relname = 'users'
  and not t.tgisinternal;
```

Expected:

- exactly one trigger calling `handle_new_user()`
- one trigger calling `create_default_org_for_new_user()`

### 6.2 Create a brand new test user and verify

After signup, verify:

```sql
-- profile exists
select * from public.profiles where id = '<new_user_uuid>';

-- org + membership exists
select m.user_id, m.role, o.id as org_id, o.name
from public.organization_members m
join public.organizations o on o.id = m.organization_id
where m.user_id = '<new_user_uuid>';
```

Verify `current_organization_id` is set:

```sql
select id, current_organization_id
from public.profiles
where id = '<new_user_uuid>';
```

### 6.3 Verify RPC returns orgs for authenticated user

```sql
select * from public.get_user_organizations();
```

---

## 7) Notes for future debugging (if this happens again)

If UI shows wrong user/org:

1. Confirm auth state: `SupabaseClient.getAuthState()`
2. Force bundle refresh: `SupabaseClient.getAccountBundleSingleFlight({ force:true })`
3. Confirm org membership exists in DB (most common “empty workspace” cause)
4. Confirm RLS allows selects
5. Confirm epoch bumps on auth events: `SupabaseClient.getAuthEpoch()`

---

## 8) What changed today (quick summary)

- Confirmed `profiles` has no `email` column (fixed trigger function accordingly)
- Installed/updated:
  - `public.handle_new_user()` (profile auto-create)
  - `public.create_default_org_for_new_user()` + trigger
- Added RLS select policies for org/membership tables
- Found duplicate profile triggers (needs cleanup)
