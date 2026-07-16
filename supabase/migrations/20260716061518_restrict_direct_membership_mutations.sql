-- Membership mutation is server-controlled. Authenticated clients retain
-- RLS-filtered reads, while service-role Edge paths keep their existing access.

revoke insert, update, delete
on table public.organization_members
from authenticated;

grant select
on table public.organization_members
to authenticated;

grant select, insert, update, delete
on table public.organization_members
to service_role;
