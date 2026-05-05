-- 2026050501_organization_invites_expiration.sql
-- Adds bounded lifetime for pending organization invite links.

alter table public.organization_invites
  add column if not exists expires_at timestamptz;

update public.organization_invites
set expires_at = coalesce(invited_at, created_at, now()) + interval '7 days'
where status = 'pending'
  and accepted_at is null
  and revoked_at is null
  and expires_at is null;

create index if not exists organization_invites_pending_expires_at_idx
  on public.organization_invites(expires_at)
  where status = 'pending'
    and accepted_at is null
    and revoked_at is null;
