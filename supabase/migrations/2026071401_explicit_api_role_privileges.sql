-- Declare the minimum Data API privileges required by current application paths.
-- Row-level access remains governed by the existing RLS policies.

grant select, update
on table public.profiles
to authenticated;

grant select, insert, update
on table public.organizations
to authenticated;

grant select, insert, update, delete
on table public.organization_members
to authenticated;

grant select
on table public.organization_invites
to authenticated;

grant select, insert, update
on table public.profiles
to service_role;

grant select, update
on table public.organizations
to service_role;

grant select, insert, update, delete
on table public.organization_members
to service_role;

grant select, insert, update
on table public.organization_invites
to service_role;

grant select, insert
on table public.stripe_customers
to service_role;

grant select, insert, update
on table public.subscriptions
to service_role;

grant select, insert, update
on table public.billing_customers
to service_role;

grant select, insert, update
on table public.webhook_events
to service_role;

grant usage, select
on sequence public.billing_customers_id_seq
to service_role;

grant usage, select
on sequence public.subscriptions_id_seq
to service_role;

grant usage, select
on sequence public.webhook_events_id_seq
to service_role;
