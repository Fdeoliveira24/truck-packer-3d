# Truck Packer 3D — Supabase Current State (as of 2026-01-27)

This document captures the Supabase database + storage setup based on the SQL you ran and the
outputs you pasted in chat.

---

## 1) Database objects in scope

### Tables (public schema)

- `profiles`
- `organizations`
- `organization_members`
- `packs`
- `cases`
- `billing_customers` (seen only via trigger query)

### Functions (public schema)

- `public.handle_new_user()` (trigger on `auth.users` insert)
- `public.set_updated_at()` (generic updated_at helper)
- `public.handle_updated_at()` (older helper you removed triggers for)

### Triggers

- `auth.users`:
  - `auth_user_after_insert` → `EXECUTE FUNCTION handle_new_user()`

- `public` tables (after your latest trigger changes):
  - `profiles`: `trg_profiles_updated_at` → `EXECUTE FUNCTION set_updated_at()`
  - `packs`: `trg_packs_updated_at` → `EXECUTE FUNCTION set_updated_at()`
  - `cases`: `trg_cases_updated_at` → `EXECUTE FUNCTION set_updated_at()`

You also removed older triggers:

- `on_profile_updated` on `public.profiles` (used `handle_updated_at()`)
- `on_organization_updated` on `public.organizations` (used `handle_updated_at()`)
- `on_billing_updated` on `public.billing_customers` (used `handle_updated_at()`)

---

## 2) `public.profiles` table

### Columns (in order)

- `id` (uuid)
- `full_name` (text)
- `first_name` (text)
- `last_name` (text)
- `avatar_url` (text)
- `bio` (text)
- `created_at` (timestamp with time zone)
- `updated_at` (timestamp with time zone)
- `display_name` (text) ✅ added

### Notes

- You confirmed `display_name` exists.
- `avatar_url` already existed, but you also ran an `add column if not exists avatar_url text;`
  which returned success (no change when it already exists).

---

## 3) Row Level Security (RLS)

You confirmed `relrowsecurity = true` for:

- `profiles`
- `organizations`
- `organization_members`
- `packs`
- `cases`

### `public.profiles` policies (current)

From your query output, you have at least:

- **SELECT**: “Users can view their own profile”
- **UPDATE**: “Users can update their own profile” And you added:
- **INSERT**: `profiles_insert_self`
  - `with check (id = auth.uid())`

**Meaning**

- Signed-in users can read/update their own profile row.
- Signed-in users can insert a profile row only if `id = auth.uid()`.

### `public.organization_members` policies (current)

- **SELECT**: `org_members_select_current_user`
- You also removed any non-SELECT policies on this table.

**Meaning**

- Members can read the membership rows that the policy allows.
- Inserts/updates/deletes are currently _not_ allowed by RLS policies (unless you have other
  policies not shown in the output).

### `public.organizations` policies (current)

From your output:

- **SELECT**: “Members can view their organizations”
- **UPDATE**: “Owners can update their organizations”

### `public.packs` and `public.cases` policies (current)

From your output:

- `packs_org_member_select` / insert / update / delete
- `cases_org_member_select` / insert / update / delete

**Meaning**

- Packs and cases are protected and should only be accessible based on membership logic (whatever
  each policy’s `using` / `with check` rules are).

---

## 4) `public.handle_new_user()` (auth trigger)

You inspected the function definition. Summary of what it does when a new user signs up (insert into
`auth.users`):

1. **Builds a default display name**
   - Uses `raw_user_meta_data.full_name`, else uses the email local-part, else “Personal Workspace”.

2. **Creates a profile row**
   - If `profiles.display_name` exists: inserts `(id, display_name)`
   - Else if `profiles.full_name` exists: inserts `(id, full_name)`
   - Else inserts `(id)` only
   - Uses `ON CONFLICT (id) DO NOTHING`

3. **Ensures an organization exists**
   - Looks for an existing org where `organizations.owner_id = new.id`
   - If none: inserts into `organizations (name, slug, owner_id, created_at, updated_at)` and stores
     the new org id

4. **Ensures an org membership row exists**
   - Inserts into `organization_members` with role `owner` (supports enum `public.org_member_role`
     if it exists)

---

## 5) Storage: `avatars` bucket policies

You created (or confirmed) storage RLS policies on `storage.objects` for the `avatars` bucket:

### Existing policies you mentioned

- `avatars_read_own` (SELECT)
- `avatars_write_own` (INSERT)
- `avatars_update_own` (UPDATE)
- `avatars_delete_own` (DELETE)

Your attempt to create `avatars_delete_own` returned:

- `ERROR: policy "avatars_delete_own" for table "objects" already exists`

**Meaning**

- That delete policy is already present (good). If you need to confirm it, run:

```sql
select policyname, cmd, qual, with_check
from pg_policies
where schemaname='storage' and tablename='objects'
  and policyname like 'avatars_%'
order by policyname;
```

### Folder rule

All these policies use the same ownership rule:

- `bucket_id = 'avatars'`
- `(storage.foldername(name))[1] = auth.uid()::text`

This means each user can only access objects inside:

- `avatars/<their-user-id>/...`

---

## 6) Known issues and cleanup checks

### A) Make sure you do not have duplicate updated_at triggers

Earlier you had both `trg_*_set_updated_at` and then created `trg_*_updated_at`. Right now, your
last output shows only:

- `trg_cases_updated_at`
- `trg_packs_updated_at`
- `trg_profiles_updated_at`

If you want to double-check there are no duplicates left:

```sql
select event_object_table, trigger_name, action_statement
from information_schema.triggers
where event_object_schema='public'
  and event_object_table in ('profiles','packs','cases')
order by event_object_table, trigger_name;
```

### B) Organization triggers

You dropped `on_organization_updated` and `on_billing_updated` which used `handle_updated_at()`. If
your app depends on `organizations.updated_at` being maintained automatically, you should either:

- add a `set_updated_at()` trigger to `organizations`, or
- update `updated_at` in app code when you update the row.

If you want the trigger approach (same pattern as packs/cases/profiles), you can add:

```sql
drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();
```

(Only run if `organizations` has an `updated_at` column and you want automatic updates.)

---

## 7) Front-end notes (high-level)

You said you uploaded the current:

- `src/ui/overlays/settings-overlay.js`
- `src/styles/main.css`

Current UI goals you described:

- Account, Updates, Roadmap, Export/Import/Help should render inside the same Settings modal “right
  pane” (not separate popups).
- Escape should close the settings modal reliably.
- No inline styles inside JS where possible (move styles into CSS).
- Add user avatar/profile management (upload avatar to `avatars/<uid>/...`, store
  `profiles.avatar_url`, and show display name).

This doc does **not** fully describe the UI state because only two files were shared here. Once you
provide the other related UI files (see next section), we can extend this document with a complete
“UI architecture” section.

---

## 8) What else I need from you (to finish the docs and to keep regressions away)

If you want this documentation to be complete and also help you keep Copilot from breaking things
again, please share:

1. **SQL definitions for the key tables** (copy/paste outputs)
   - `\d public.organizations` (or the “Table editor → SQL” text)
   - `\d public.organization_members`
   - `\d public.packs`
   - `\d public.cases`

2. **All policies bodies** (not just names)
   - For each of these tables: `profiles`, `organizations`, `organization_members`, `packs`,
     `cases`  
     Run:

   ```sql
   select tablename, policyname, cmd, qual, with_check
   from pg_policies
   where schemaname='public'
     and tablename in ('profiles','organizations','organization_members','packs','cases')
   order by tablename, policyname;
   ```

3. **Storage policies bodies** for avatars

   ```sql
   select policyname, cmd, qual, with_check
   from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname like 'avatars_%'
   order by policyname;
   ```

4. **Edge Functions list + code**
   - Especially `delete-account` (and any others)
   - Also your project “Auth settings” if you changed JWT verification or CORS.

5. **Front-end auth/session entry points**
   - `src/app.js` (or at least the parts that open Settings and wire callbacks)
   - Any overlay modules that Settings calls into (account overlay, export/import modals, etc.)
   - Any “UIComponents.showModal” or modal manager file

---

## Appendix: Quick “current state” checklist

- [x] `profiles.display_name` exists
- [x] RLS enabled on `profiles`, `organizations`, `organization_members`, `packs`, `cases`
- [x] `profiles_insert_self` policy exists
- [x] `handle_new_user()` inserts `profiles` row and creates org + membership
- [x] `avatars_*_own` storage policies exist (delete already existed)
- [x] Old `handle_updated_at()` triggers removed
- [x] `set_updated_at()` triggers exist for `profiles/packs/cases`
- [ ] Decide whether `organizations` should also have a `set_updated_at()` trigger
