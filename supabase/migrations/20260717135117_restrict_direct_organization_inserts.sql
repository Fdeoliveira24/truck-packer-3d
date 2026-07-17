-- Workspace creation is server-controlled. Remove the obsolete browser INSERT
-- path while preserving authenticated RLS-filtered reads and updates.

revoke insert
on table public.organizations
from authenticated;

drop policy if exists "organizations_insert_owner_self"
on public.organizations;
