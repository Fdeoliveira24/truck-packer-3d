-- 20260418_storage_buckets_and_rls.sql
-- 1) Create storage buckets if they don't exist.
-- 2) Add RLS to org-logos bucket (avatars bucket already has correct policies).

-- ── Bucket creation ──────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152,  -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos',
  'org-logos',
  true,
  2097152,  -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

-- ── org-logos RLS policies ───────────────────────────────────────────────────
-- Path pattern enforced by client: orgs/{orgId}/logo.{ext}
-- We extract the org UUID from position 2 of the path (storage.foldername returns 1-indexed array).

-- Public read — logos are display assets shown to anyone
drop policy if exists "org_logos_read_public" on storage.objects;
create policy "org_logos_read_public"
  on storage.objects
  for select
  using (bucket_id = 'org-logos');

-- Only org admins/owners can upload or replace a logo
drop policy if exists "org_logos_insert_admin" on storage.objects;
create policy "org_logos_insert_admin"
  on storage.objects
  for insert
  with check (
    bucket_id = 'org-logos'
    and public.tp3d_is_org_admin_or_owner(
      (storage.foldername(name))[2]::uuid
    )
  );

drop policy if exists "org_logos_update_admin" on storage.objects;
create policy "org_logos_update_admin"
  on storage.objects
  for update
  using (
    bucket_id = 'org-logos'
    and public.tp3d_is_org_admin_or_owner(
      (storage.foldername(name))[2]::uuid
    )
  );

-- Only org owners can delete a logo
drop policy if exists "org_logos_delete_owner" on storage.objects;
create policy "org_logos_delete_owner"
  on storage.objects
  for delete
  using (
    bucket_id = 'org-logos'
    and public.tp3d_is_org_owner(
      (storage.foldername(name))[2]::uuid
    )
  );

-- ── avatars RLS policies (idempotent re-apply) ───────────────────────────────
-- Client path: {userId}/avatar.{ext}
-- storage.foldername(name)[1] is the first path segment = userId

drop policy if exists "avatars_read_own" on storage.objects;
create policy "avatars_read_own"
  on storage.objects
  for select
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects
  for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
