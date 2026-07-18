-- Packet 3: Workspace slug Phase 1 integrity foundation.
--
-- Every legitimate write path (the auth.users signup trigger
-- tp3d_handle_new_user() and the service_role-only RPC
-- tp3d_create_workspace()) already sets slug = <organization's own id>::text
-- inside an insert-then-update within one transaction. This migration keeps
-- that exact UUID-derived convention, backfills/normalizes every historical
-- row to satisfy the new constraints, and adds a database-level guard so
-- authenticated owners/admins can no longer mutate slug directly. It does not
-- modify tp3d_handle_new_user() at all: its INSERT already writes a non-null
-- placeholder (new.id::text, the auth user's own id) before the follow-up
-- UPDATE, so it is unaffected by the new NOT NULL constraint.

-- 0) tp3d_create_workspace() is the one exception: its existing INSERT
-- deliberately writes slug = null as a placeholder before a follow-up UPDATE
-- sets the real value in the same transaction. Once slug is NOT NULL (step 2
-- below), that literal null INSERT would fail before the UPDATE ever runs,
-- breaking every server-controlled workspace creation. This redefinition
-- changes only the creation tail: it pre-generates the organization id so the
-- canonical UUID-derived slug can be written directly in one INSERT, removing
-- the null placeholder and the follow-up UPDATE. Every other line (entitlement
-- resolution, locking, counting, limit checks, membership/profile writes,
-- and the returned jsonb shape) is unchanged from
-- 20260717142844_enforce_server_workspace_limits.sql.
create or replace function public.tp3d_create_workspace(
  p_actor_id uuid,
  p_name text,
  p_entitlement_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_org_id uuid;
  v_org_slug text;
  v_membership_id uuid;
  v_locked_actor_id uuid;
  v_profile_rows integer := 0;
  v_workspace_count integer := 0;
  v_canonical_workspace_count integer := 0;
  v_workspace_limit integer;
  v_trial_limit integer;
  v_pro_limit integer;
  v_business_limit integer;
  v_business_price_ids text[] := array[]::text[];
  v_best_status text;
  v_best_price_id text;
  v_has_unsafe_identity boolean := false;
begin
  if p_actor_id is null then
    raise exception 'TP3D_CREATE_ACTOR_REQUIRED';
  end if;

  if p_name is null or p_name ~ '[[:cntrl:]]' then
    raise exception 'TP3D_CREATE_INVALID_NAME';
  end if;

  v_name := pg_catalog.regexp_replace(pg_catalog.btrim(p_name), '[[:space:]]+', ' ', 'g');
  if pg_catalog.char_length(v_name) < 1 or pg_catalog.char_length(v_name) > 120 then
    raise exception 'TP3D_CREATE_INVALID_NAME';
  end if;

  if p_entitlement_config is null
     or pg_catalog.jsonb_typeof(p_entitlement_config) <> 'object'
     or p_entitlement_config ->> 'version' <> '1'
     or pg_catalog.jsonb_typeof(p_entitlement_config -> 'business_price_ids') <> 'array'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_entitlement_config -> 'business_price_ids') as item(value)
       where pg_catalog.jsonb_typeof(item.value) <> 'string'
     ) then
    raise exception 'TP3D_CREATE_ENTITLEMENT_CONFIG_INVALID';
  end if;

  begin
    v_trial_limit := (p_entitlement_config ->> 'trial_limit')::integer;
    v_pro_limit := (p_entitlement_config ->> 'pro_limit')::integer;
    v_business_limit := (p_entitlement_config ->> 'business_limit')::integer;
  exception
    when others then
      raise exception 'TP3D_CREATE_ENTITLEMENT_CONFIG_INVALID';
  end;

  if v_trial_limit is null or v_trial_limit < 1 or v_trial_limit > 100000
     or v_pro_limit is null or v_pro_limit < 1 or v_pro_limit > 100000
     or v_business_limit is null or v_business_limit < 1 or v_business_limit > 100000 then
    raise exception 'TP3D_CREATE_ENTITLEMENT_CONFIG_INVALID';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct pg_catalog.btrim(item.value))
      filter (where pg_catalog.btrim(item.value) <> ''),
    array[]::text[]
  )
  into v_business_price_ids
  from pg_catalog.jsonb_array_elements_text(
    p_entitlement_config -> 'business_price_ids'
  ) as item(value);

  -- The profile row is the stable owner-associated serialization point. A row
  -- lock is owner-specific, transaction-scoped, and acquired before entitlement
  -- resolution, counting, comparison, or mutation.
  select p.id
  into v_locked_actor_id
  from public.profiles p
  where p.id = p_actor_id
  for update;

  if v_locked_actor_id is null then
    raise exception 'TP3D_CREATE_PROFILE_MISSING';
  end if;

  select pg_catalog.count(*)::integer
  into v_workspace_count
  from public.organizations o
  where o.owner_id = p_actor_id;

  -- Canonical owner identity must agree across organizations and memberships.
  -- This count deliberately has no archived_at predicate: archived workspaces
  -- consume owner-plan capacity under the approved product contract.
  select pg_catalog.count(*)::integer
  into v_canonical_workspace_count
  from public.organizations o
  join public.organization_members m
    on m.organization_id = o.id
   and m.user_id = p_actor_id
   and m.role = 'owner'::public.org_member_role
  where o.owner_id = p_actor_id;

  select (
    v_workspace_count < 1
    or v_canonical_workspace_count <> v_workspace_count
    or exists (
      select 1
      from public.organizations o
      join public.organization_members m
        on m.organization_id = o.id
       and m.role = 'owner'::public.org_member_role
      where o.owner_id = p_actor_id
        and m.user_id <> p_actor_id
    )
  )
  into v_has_unsafe_identity;

  if v_has_unsafe_identity then
    raise exception 'TP3D_CREATE_BILLING_IDENTITY_UNSAFE';
  end if;

  -- Usable subscription projections must have one explicit owner-workspace
  -- binding and at most one usable subscription per owner workspace. Legacy
  -- user-scoped rows are accepted only when billing_customers maps their
  -- subscription ID to exactly one canonical owner workspace.
  with mapped_subscriptions as (
    select
      s.id,
      s.status,
      s.price_id,
      s.current_period_end,
      s.trial_end,
      s.created_at,
      s.stripe_subscription_id,
      case
        when s.organization_id is not null then s.organization_id
        else mapping.organization_id
      end as resolved_organization_id,
      case
        when s.organization_id is not null then 1
        else coalesce(mapping.mapping_count, 0)
      end as mapping_count
    from public.subscriptions s
    left join lateral (
      select
        pg_catalog.min(bc.organization_id::text)::uuid as organization_id,
        pg_catalog.count(distinct bc.organization_id)::integer as mapping_count
      from public.billing_customers bc
      join public.organizations mapped_org
        on mapped_org.id = bc.organization_id
       and mapped_org.owner_id = p_actor_id
      where bc.stripe_subscription_id = s.stripe_subscription_id
    ) mapping on true
    where (
      s.organization_id in (
        select owner_org.id
        from public.organizations owner_org
        where owner_org.owner_id = p_actor_id
      )
      or (s.organization_id is null and s.user_id = p_actor_id)
    )
  ), usable_subscriptions as (
    select *
    from mapped_subscriptions s
    where s.status = 'active'
       or s.status = 'trialing'
       or (
         s.status = 'past_due'
         and s.current_period_end is not null
         and pg_catalog.now() < s.current_period_end + pg_catalog.make_interval(days => 7)
       )
       or (
         s.status = 'unpaid'
         and s.current_period_end is not null
         and pg_catalog.now() < s.current_period_end + pg_catalog.make_interval(days => 3)
       )
  )
  select (
    exists (
      select 1
      from usable_subscriptions u
      where u.resolved_organization_id is null
         or u.mapping_count <> 1
         or pg_catalog.btrim(coalesce(u.stripe_subscription_id, '')) = ''
    )
    or exists (
      select 1
      from usable_subscriptions u
      group by u.resolved_organization_id
      having pg_catalog.count(*) > 1
    )
    or exists (
      select 1
      from usable_subscriptions u
      join public.billing_customers bc
        on bc.stripe_subscription_id = u.stripe_subscription_id
      join public.organizations mapped_org
        on mapped_org.id = bc.organization_id
       and mapped_org.owner_id = p_actor_id
      where bc.organization_id <> u.resolved_organization_id
    )
    or exists (
      select 1
      from public.billing_customers bc
      join public.organizations owner_org
        on owner_org.id = bc.organization_id
       and owner_org.owner_id = p_actor_id
      where pg_catalog.btrim(coalesce(bc.stripe_subscription_id, '')) <> ''
        and (
          bc.status = 'active'::public.billing_status
          or (
            bc.status = 'trialing'::public.billing_status
            and (bc.trial_ends_at is null or bc.trial_ends_at > pg_catalog.now())
          )
          or (
            bc.status = 'past_due'::public.billing_status
            and bc.current_period_end is not null
            and pg_catalog.now() < bc.current_period_end + pg_catalog.make_interval(days => 7)
          )
          or (
            bc.status = 'unpaid'::public.billing_status
            and bc.current_period_end is not null
            and pg_catalog.now() < bc.current_period_end + pg_catalog.make_interval(days => 3)
          )
        )
      group by bc.stripe_subscription_id
      having pg_catalog.count(distinct bc.organization_id) > 1
    )
    or exists (
      select 1
      from public.subscriptions s
      where (
        s.organization_id in (
          select owner_org.id
          from public.organizations owner_org
          where owner_org.owner_id = p_actor_id
        )
        or (s.organization_id is null and s.user_id = p_actor_id)
      )
        and pg_catalog.btrim(coalesce(s.status, '')) <> ''
        and s.status not in (
          'active',
          'trialing',
          'past_due',
          'unpaid',
          'canceled',
          'incomplete',
          'incomplete_expired',
          'paused',
          'none'
        )
    )
  )
  into v_has_unsafe_identity;

  if v_has_unsafe_identity then
    raise exception 'TP3D_CREATE_BILLING_IDENTITY_UNSAFE';
  end if;

  -- Match billing-status owner-candidate ordering: payment-state priority,
  -- latest applicable period, latest creation time, and subscription projection
  -- before its billing_customers mirror on an exact tie.
  with mapped_subscriptions as (
    select
      s.status,
      coalesce(s.price_id, '') as price_id,
      s.current_period_end,
      s.trial_end,
      s.created_at,
      case
        when s.organization_id is not null then s.organization_id
        else mapping.organization_id
      end as resolved_organization_id
    from public.subscriptions s
    left join lateral (
      select pg_catalog.min(bc.organization_id::text)::uuid as organization_id
      from public.billing_customers bc
      join public.organizations mapped_org
        on mapped_org.id = bc.organization_id
       and mapped_org.owner_id = p_actor_id
      where bc.stripe_subscription_id = s.stripe_subscription_id
    ) mapping on true
    where (
      s.organization_id in (
        select owner_org.id
        from public.organizations owner_org
        where owner_org.owner_id = p_actor_id
      )
      or (s.organization_id is null and s.user_id = p_actor_id)
    )
  ), candidates as (
    select
      s.status,
      s.price_id,
      s.current_period_end,
      s.trial_end,
      s.created_at,
      0 as source_rank
    from mapped_subscriptions s
    where s.resolved_organization_id is not null
      and (
        s.status = 'active'
        or s.status = 'trialing'
        or (
          s.status = 'past_due'
          and s.current_period_end is not null
          and pg_catalog.now() < s.current_period_end + pg_catalog.make_interval(days => 7)
        )
        or (
          s.status = 'unpaid'
          and s.current_period_end is not null
          and pg_catalog.now() < s.current_period_end + pg_catalog.make_interval(days => 3)
        )
      )
    union all
    select
      bc.status::text,
      ''::text,
      bc.current_period_end,
      bc.trial_ends_at,
      bc.created_at,
      1 as source_rank
    from public.billing_customers bc
    join public.organizations owner_org
      on owner_org.id = bc.organization_id
     and owner_org.owner_id = p_actor_id
    where bc.status = 'active'::public.billing_status
       or (
         bc.status = 'trialing'::public.billing_status
         and (bc.trial_ends_at is null or bc.trial_ends_at > pg_catalog.now())
       )
       or (
         bc.status = 'past_due'::public.billing_status
         and bc.current_period_end is not null
         and pg_catalog.now() < bc.current_period_end + pg_catalog.make_interval(days => 7)
       )
       or (
         bc.status = 'unpaid'::public.billing_status
         and bc.current_period_end is not null
         and pg_catalog.now() < bc.current_period_end + pg_catalog.make_interval(days => 3)
       )
  )
  select c.status, c.price_id
  into v_best_status, v_best_price_id
  from candidates c
  order by
    case c.status
      when 'active' then 6
      when 'trialing' then 5
      when 'past_due' then 4
      when 'unpaid' then 3
      else -1
    end desc,
    c.current_period_end desc nulls last,
    c.created_at desc nulls last,
    c.source_rank asc
  limit 1;

  if v_best_status is null then
    raise exception 'TP3D_CREATE_ENTITLEMENT_UNAVAILABLE';
  end if;

  if v_best_status = 'trialing' then
    v_workspace_limit := v_trial_limit;
  elsif coalesce(v_best_price_id, '') = any(v_business_price_ids) then
    v_workspace_limit := v_business_limit;
  else
    -- Active/grace rows with an unknown or replaced Price retain the existing
    -- conservative paid fallback used by billing-status.
    v_workspace_limit := v_pro_limit;
  end if;

  if v_workspace_count >= v_workspace_limit then
    raise exception 'TP3D_CREATE_WORKSPACE_LIMIT_REACHED';
  end if;

  -- Pre-generate the id so the canonical UUID-derived slug can be written in
  -- the same INSERT. slug is NOT NULL as of this migration, so the previous
  -- insert-null-then-update pattern would violate that constraint before the
  -- follow-up UPDATE ever ran.
  v_org_id := pg_catalog.gen_random_uuid();
  v_org_slug := v_org_id::text;
  insert into public.organizations (id, name, slug, owner_id, created_at, updated_at)
  values (v_org_id, v_name, v_org_slug, p_actor_id, pg_catalog.now(), pg_catalog.now());

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    joined_at,
    updated_at
  )
  values (
    v_org_id,
    p_actor_id,
    'owner'::public.org_member_role,
    pg_catalog.now(),
    pg_catalog.now()
  )
  returning id into v_membership_id;

  update public.profiles
  set current_organization_id = v_org_id,
      updated_at = pg_catalog.now()
  where id = p_actor_id;

  get diagnostics v_profile_rows = row_count;
  if v_profile_rows <> 1 then
    raise exception 'TP3D_CREATE_PROFILE_MISSING';
  end if;

  return pg_catalog.jsonb_build_object(
    'organization_id', v_org_id,
    'name', v_name,
    'slug', v_org_slug,
    'owner_id', p_actor_id,
    'membership_id', v_membership_id,
    'workspace_count', v_workspace_count + 1,
    'workspace_limit', v_workspace_limit
  );
end;
$$;

-- 1) Backfill/converge: any null, blank, whitespace-only, malformed
-- (format-invalid), or duplicate/case-variant-duplicate slug is replaced with
-- the canonical lower(id::text) for that row. id is the primary key, so
-- lower(id::text) is guaranteed globally unique and cannot introduce a new
-- collision. Rows that are already valid, unique, and correctly formatted
-- (including non-canonical fixture-generated slugs used by local test
-- infrastructure) are left untouched.
with ranked as (
  select
    id,
    slug,
    row_number() over (
      partition by lower(slug)
      order by created_at asc, id asc
    ) as rn
  from public.organizations
)
update public.organizations o
set slug = lower(o.id::text)
from ranked r
where o.id = r.id
  and (
    o.slug is null
    or btrim(o.slug) = ''
    or o.slug !~ '^[a-z0-9-]{1,100}$'
    or r.rn > 1
  );

-- 2) Non-null.
alter table public.organizations
  alter column slug set not null;

-- 3) Bounded, safe-character format. Wide enough to cover both the canonical
-- 36-character UUID-derived shape and existing local-fixture slugs (up to
-- ~71 characters today; scripts/local-fixtures/harness.mjs createOwnedWorkspace)
-- without requiring any fixture change.
alter table public.organizations
  add constraint organizations_slug_format_check
  check (slug ~ '^[a-z0-9-]{1,100}$');

-- 4) Case-insensitive uniqueness.
create unique index organizations_slug_lower_idx
  on public.organizations (lower(slug));

-- 5) Block direct authenticated/anon mutation of slug while preserving the
-- one remaining internal write: tp3d_handle_new_user()'s follow-up UPDATE
-- that replaces its temporary insert-time placeholder (the auth user's own
-- id) with the organization's own id once known (tp3d_create_workspace(),
-- redefined above, now writes its final slug directly in one INSERT and no
-- longer performs an UPDATE OF slug at all). tp3d_handle_new_user() is a
-- SECURITY DEFINER function owned by the `postgres` role (no ALTER FUNCTION
-- ... OWNER TO exists for it), so current_user during its execution --
-- including this nested UPDATE -- is `postgres`, not `service_role`.
-- Mirroring the archived_at guard (2026050701_organization_archive.sql,
-- which is itself SECURITY DEFINER) verbatim would make its current_user
-- fallback branch dead code and would reject this update, breaking signup.
-- Instead this reuses the already-shipped, invoker-rights pattern from
-- tp3d_guard_profile_deletion_fields() (2026061301_guard_profile_deletion_fields.sql),
-- which correctly distinguishes trusted internal/service execution from
-- authenticated/anon PostgREST requests without requiring any change to
-- tp3d_handle_new_user() itself.
create or replace function public.tp3d_guard_organizations_slug_update()
returns trigger
language plpgsql
-- Runs with invoker rights (the default) so current_user reflects the real
-- caller's role, exactly like tp3d_guard_profile_deletion_fields(). Do not
-- change it to run with definer rights.
--
-- search_path is locked to '' so name resolution can never be redirected by a
-- caller-controlled search_path. The body only uses pg_catalog built-ins
-- (current_setting, nullif, the jsonb cast and ->> operator, current_user),
-- which still resolve under an empty search_path.
set search_path = ''
as $$
declare
  claim_role text;
begin
  -- Fast path: if slug is not actually changing, allow the update. Normal
  -- organization edits (name, phone, address, city, ...) are never affected.
  if new.slug is not distinct from old.slug then
    return new;
  end if;

  -- Resolve the caller's role from the PostgREST JWT claims when present.
  begin
    claim_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception
    when others then
      claim_role := null;
  end;
  if claim_role is null then
    claim_role := nullif(current_setting('request.jwt.claim.role', true), '');
  end if;

  -- Allow the service role (Edge Functions using the service-role key) and
  -- privileged database roles (migrations, Studio SQL editor, admin tasks,
  -- and the postgres-owned signup trigger / workspace-creation RPC).
  if claim_role = 'service_role'
     or current_user in ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;

  -- Everyone else (authenticated end users, anon) is blocked from touching
  -- slug directly. They must go through approved workspace lifecycle
  -- functions, which never accept a client-supplied slug.
  raise exception
    'Workspace slug can only be changed by workspace lifecycle functions.'
    using errcode = '42501'; -- insufficient_privilege
end;
$$;

drop trigger if exists tp3d_guard_organizations_slug_update on public.organizations;
create trigger tp3d_guard_organizations_slug_update
  before update of slug on public.organizations
  for each row
  execute function public.tp3d_guard_organizations_slug_update();

-- Defense in depth: this is a trigger function and cannot be invoked directly
-- (PostgreSQL rejects direct calls to trigger-returning functions and
-- PostgREST never exposes them as RPC). Revoke EXECUTE from client-reachable
-- roles anyway so it can never appear on any callable surface. Trigger
-- execution does NOT depend on the caller holding EXECUTE on the function, so
-- the guard keeps firing for every UPDATE OF slug regardless of these
-- revokes.
revoke execute on function public.tp3d_guard_organizations_slug_update() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.tp3d_guard_organizations_slug_update() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.tp3d_guard_organizations_slug_update() from authenticated';
  end if;
end $$;
