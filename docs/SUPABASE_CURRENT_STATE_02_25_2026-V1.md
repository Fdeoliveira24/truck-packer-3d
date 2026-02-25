# Truck Packer 3D — Supabase Current State (02-25-2026) — V1

This file is a clean snapshot of the Supabase database + RLS setup as reported on **February 25, 2026**.

It supersedes `SUPABASE_CURRENT_STATE_02_07_2026-V1.md` for the billing tables, triggers, and org-table policies.
Sections not re-queried (profiles, packs, cases, storage buckets, foreign keys, enums) remain as documented in the 02-07-2026 snapshot.

---

## 0) Key facts (high level)

- Schema: `public`
- Core tables with RLS enabled: `profiles`, `organizations`, `organization_members`, `organization_invites`, `packs`, `cases`, `billing_customers`, `stripe_customers`, `subscriptions`, `webhook_events`
- Org roles enum values: `owner`, `admin`, `member`, `viewer`
- New users: `auth.users` INSERT trigger runs `public.create_default_org_for_new_user()` (creates profile + org + membership, sets `profiles.current_organization_id`)
- Trial seeding: new `organization_members` INSERT trigger (`trg_seed_billing_customer_trial`) auto-creates a `billing_customers` row in `trialing` status

---

## 1) RLS enabled — billing + webhook tables

Query:
```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN ('subscriptions','billing_customers','stripe_customers','webhook_events')
ORDER BY relname;
```

Result:

```json
[
  { "relname": "billing_customers",  "relrowsecurity": true, "relforcerowsecurity": false },
  { "relname": "stripe_customers",   "relrowsecurity": true, "relforcerowsecurity": false },
  { "relname": "subscriptions",      "relrowsecurity": true, "relforcerowsecurity": false },
  { "relname": "webhook_events",     "relrowsecurity": true, "relforcerowsecurity": false }
]
```

Notes:
- All four billing/webhook tables have RLS **enabled** (`relrowsecurity = true`).
- `relforcerowsecurity = false` on all — the table owner (service role) bypasses RLS by default. Edge functions using the service key are unaffected.

---

## 2) RLS policies — billing tables

Query:
```sql
SELECT tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('subscriptions','billing_customers','stripe_customers','webhook_events')
ORDER BY tablename, policyname;
```

Result:

```json
[
  {
    "tablename": "billing_customers",
    "policyname": "Organization admins can view billing",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "(EXISTS ( SELECT 1\n   FROM organization_members\n  WHERE ((organization_members.organization_id = billing_customers.organization_id) AND (organization_members.user_id = auth.uid()) AND (organization_members.role = ANY (ARRAY['owner'::org_member_role, 'admin'::org_member_role])))))"
  },
  {
    "tablename": "stripe_customers",
    "policyname": "stripe_customers_read_own",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "(auth.uid() = user_id)"
  },
  {
    "tablename": "subscriptions",
    "policyname": "subscriptions_read_own",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "(auth.uid() = user_id)"
  }
]
```

### Policy notes

| Table | Policy | Summary |
|---|---|---|
| `billing_customers` | `Organization admins can view billing` | SELECT only; allows `owner` or `admin` members of the linked org. No INSERT/UPDATE/DELETE for regular users — edge functions use service role. |
| `stripe_customers` | `stripe_customers_read_own` | SELECT only; user-scoped (`auth.uid() = user_id`). |
| `subscriptions` | `subscriptions_read_own` | SELECT only; user-scoped (`auth.uid() = user_id`). |
| `webhook_events` | *(no client-facing policy listed)* | No SELECT policy for regular users — expected, webhooks are service-role only. |

### Important gaps to note
- `billing_customers` SELECT policy still allows **owner OR admin** to read. App-layer billing management actions (checkout, portal) are now restricted to **owner-only** as of `fix/p0-owner-only-billing-v1` (02-25-2026), but the DB read policy was intentionally left broader so admins can still view billing status.
- `subscriptions` is still user-scoped (legacy). Org-scoped reads are handled by the `organization_id` column + edge function service role. If a client-side query needs org-scoped subscriptions, a new policy would be required.
- No INSERT/UPDATE/DELETE client-facing policies exist on `billing_customers`, `stripe_customers`, or `subscriptions` — all writes go through edge functions with the service key.

---

## 3) RLS policies — org tables (sanity check)

Query:
```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('organizations','organization_members','organization_invites')
ORDER BY tablename, policyname;
```

Result:

```json
[
  { "tablename": "organization_invites", "policyname": "org_invites_delete_admin_owner",          "cmd": "DELETE" },
  { "tablename": "organization_invites", "policyname": "org_invites_insert_admin_owner",          "cmd": "INSERT" },
  { "tablename": "organization_invites", "policyname": "org_invites_select_admin_owner",          "cmd": "SELECT" },
  { "tablename": "organization_invites", "policyname": "org_invites_update_admin_owner",          "cmd": "UPDATE" },
  { "tablename": "organization_members", "policyname": "org_members_delete_owner_admin",          "cmd": "DELETE" },
  { "tablename": "organization_members", "policyname": "org_members_insert_owner_admin_member",   "cmd": "INSERT" },
  { "tablename": "organization_members", "policyname": "org_members_select_org",                  "cmd": "SELECT" },
  { "tablename": "organization_members", "policyname": "org_members_update_owner_admin",          "cmd": "UPDATE" },
  { "tablename": "organizations",        "policyname": "Members can view their organizations",    "cmd": "SELECT" },
  { "tablename": "organizations",        "policyname": "organizations_delete_owner",              "cmd": "DELETE" },
  { "tablename": "organizations",        "policyname": "organizations_update_owner_admin",        "cmd": "UPDATE" },
  { "tablename": "organizations",        "policyname": "orgs_select_if_member",                   "cmd": "SELECT" }
]
```

### Changes since 02-07-2026 snapshot
- `organization_invites` table now has a full CRUD policy set (SELECT/INSERT/UPDATE/DELETE, all scoped to owner/admin). This was not present in the earlier snapshot.
- `org_members_insert_owner_admin_member` — new INSERT policy on `organization_members`.
- The two redundant SELECT policies from the earlier snapshot (`org_members_select_current_user` and `org_members_select_own`) appear to have been replaced/consolidated into `org_members_select_org` (allows any member to see all members within their org).

---

## 4) Triggers (full list, public schema)

Query:
```sql
SELECT trigger_name, event_manipulation, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;
```

Result:

```json
[
  { "trigger_name": "trg_cases_updated_at",             "event_manipulation": "UPDATE", "event_object_table": "cases",                "action_timing": "BEFORE" },
  { "trigger_name": "trg_org_invites_updated_at",       "event_manipulation": "UPDATE", "event_object_table": "organization_invites", "action_timing": "BEFORE" },
  { "trigger_name": "trg_seed_billing_customer_trial",  "event_manipulation": "INSERT", "event_object_table": "organization_members", "action_timing": "AFTER"  },
  { "trigger_name": "trg_set_current_org_on_membership","event_manipulation": "INSERT", "event_object_table": "organization_members", "action_timing": "AFTER"  },
  { "trigger_name": "trg_organizations_updated_at",     "event_manipulation": "UPDATE", "event_object_table": "organizations",        "action_timing": "BEFORE" },
  { "trigger_name": "trg_packs_updated_at",             "event_manipulation": "UPDATE", "event_object_table": "packs",               "action_timing": "BEFORE" },
  { "trigger_name": "trg_profiles_updated_at",          "event_manipulation": "UPDATE", "event_object_table": "profiles",            "action_timing": "BEFORE" },
  { "trigger_name": "set_updated_at_stripe_customers",  "event_manipulation": "UPDATE", "event_object_table": "stripe_customers",    "action_timing": "BEFORE" },
  { "trigger_name": "set_updated_at_subscriptions",     "event_manipulation": "UPDATE", "event_object_table": "subscriptions",       "action_timing": "BEFORE" },
  { "trigger_name": "set_updated_at_webhook_events",    "event_manipulation": "UPDATE", "event_object_table": "webhook_events",      "action_timing": "BEFORE" }
]
```

### Trigger notes

| Trigger | Table | Timing | Purpose |
|---|---|---|---|
| `trg_seed_billing_customer_trial` | `organization_members` | AFTER INSERT | **New (02-25-2026).** Auto-creates a `billing_customers` row in `trialing` status when a new org membership is created (i.e., on new org/user creation). This is why all `billing_customers` rows in the sample show `status = 'trialing'`. |
| `trg_set_current_org_on_membership` | `organization_members` | AFTER INSERT | Sets `profiles.current_organization_id` when a membership is created. Complements `create_default_org_for_new_user()`. |
| `trg_org_invites_updated_at` | `organization_invites` | BEFORE UPDATE | New `updated_at` maintenance trigger on the invites table (not present in 02-07-2026 snapshot). |
| `set_updated_at_stripe_customers` | `stripe_customers` | BEFORE UPDATE | `updated_at` maintenance. |
| `set_updated_at_subscriptions` | `subscriptions` | BEFORE UPDATE | `updated_at` maintenance. |
| `set_updated_at_webhook_events` | `webhook_events` | BEFORE UPDATE | `updated_at` maintenance. |

### Changes since 02-07-2026 snapshot
- `trg_seed_billing_customer_trial` is **new** — trial seeding is now DB-side.
- `trg_set_current_org_on_membership` is **new** — previously `current_organization_id` was set only inside `create_default_org_for_new_user()`.
- `on_auth_user_create_default_org` (fired from `auth.users` INSERT) is **not listed** here because it lives in the `auth` schema trigger, not `public`. It still exists.
- Billing table `updated_at` triggers are new additions.

---

## 5) `billing_customers` table schema

Query:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'billing_customers'
ORDER BY ordinal_position;
```

Result:

| column_name | data_type | is_nullable |
|---|---|---|
| `id` | uuid | NO |
| `organization_id` | uuid | NO |
| `stripe_customer_id` | text | YES |
| `stripe_subscription_id` | text | YES |
| `status` | USER-DEFINED (enum) | YES |
| `plan_name` | text | YES |
| `billing_interval` | USER-DEFINED (enum) | YES |
| `current_period_start` | timestamp with time zone | YES |
| `current_period_end` | timestamp with time zone | YES |
| `cancel_at_period_end` | boolean | YES |
| `trial_ends_at` | timestamp with time zone | YES |
| `created_at` | timestamp with time zone | NO |
| `updated_at` | timestamp with time zone | NO |

Notes:
- `status` is a custom enum (values include at minimum: `trialing`, `active`, `past_due`, `unpaid`, `canceled`, `incomplete`, `incomplete_expired`).
- `billing_interval` is a custom enum (values: `month`, `year`).
- `stripe_customer_id` is **nullable** — new orgs created before Stripe checkout will have `null` here until the first checkout session is created.
- This table is the **primary billing source of truth** for the app (read by `billing-status` edge function).

---

## 6) `subscriptions` table schema

Query:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'subscriptions'
ORDER BY ordinal_position;
```

Result:

| column_name | data_type | is_nullable |
|---|---|---|
| `id` | bigint | NO |
| `user_id` | uuid | NO |
| `stripe_subscription_id` | text | NO |
| `stripe_customer_id` | text | NO |
| `status` | text | NO |
| `price_id` | text | NO |
| `product_id` | text | YES |
| `current_period_start` | timestamp with time zone | YES |
| `current_period_end` | timestamp with time zone | YES |
| `cancel_at_period_end` | boolean | NO |
| `cancel_at` | timestamp with time zone | YES |
| `canceled_at` | timestamp with time zone | YES |
| `trial_start` | timestamp with time zone | YES |
| `trial_end` | timestamp with time zone | YES |
| `ended_at` | timestamp with time zone | YES |
| `latest_invoice_id` | text | YES |
| `latest_invoice_status` | text | YES |
| `metadata` | jsonb | NO |
| `created_at` | timestamp with time zone | NO |
| `updated_at` | timestamp with time zone | NO |
| `interval` | text | YES |
| `last_stripe_event_created` | bigint | YES |

Notes:
- This is the **legacy Stripe-webhook-written** table (written by `stripe-webhook` edge function).
- `user_id`-scoped, not `organization_id`-scoped at the DB level (org linkage is in `metadata.organization_id`).
- `last_stripe_event_created` is used for idempotent event ordering — higher value wins.
- `billing_customers` is preferred for app reads; `subscriptions` is the raw webhook log.

---

## 7) `webhook_events` table — known issue

Query attempted:
```sql
SELECT id, event_type, status, created_at
FROM webhook_events
WHERE status = 'received' AND created_at < NOW() - INTERVAL '10 minutes'
LIMIT 5;
```

**Error:**
```
ERROR: 42703: column "created_at" does not exist
HINT: Perhaps you meant to reference the column "webhook_events.updated_at"
```

Implication: `webhook_events` does **not** have a `created_at` column — only `updated_at`. Use `updated_at` for age-based queries on this table:

```sql
SELECT id, event_type, status, updated_at
FROM webhook_events
WHERE status = 'received' AND updated_at < NOW() - INTERVAL '10 minutes'
LIMIT 5;
```

---

## 8) `billing_customers` sample data

Query:
```sql
SELECT organization_id, status, trial_ends_at, stripe_customer_id
FROM billing_customers
LIMIT 5;
```

Result (as of 02-25-2026):

```json
[
  { "organization_id": "502533ab-9e40-497e-bf51-c34739c737b1", "status": "trialing", "trial_ends_at": "2026-02-26T16:41:14.764771+00:00", "stripe_customer_id": null },
  { "organization_id": "c3008b8a-3286-4a0e-ade6-1e9d8319f80e", "status": "trialing", "trial_ends_at": "2026-02-26T16:41:14.764771+00:00", "stripe_customer_id": null },
  { "organization_id": "e5e8bba5-1201-41ce-943d-42e96f295472", "status": "trialing", "trial_ends_at": "2026-02-26T16:41:14.764771+00:00", "stripe_customer_id": null },
  { "organization_id": "a77f40ae-33fa-41f1-9a60-a7d20c286faf", "status": "trialing", "trial_ends_at": "2026-02-26T16:41:14.764771+00:00", "stripe_customer_id": null },
  { "organization_id": "64ed4c4a-60d8-4838-8fbc-52de0ce26371", "status": "trialing", "trial_ends_at": "2026-02-26T16:41:14.764771+00:00", "stripe_customer_id": null }
]
```

Observations:
- All sampled rows are in `trialing` status — consistent with `trg_seed_billing_customer_trial` auto-seeding on org creation.
- `trial_ends_at` is identical across all rows (`2026-02-26 16:41:14 UTC`), which suggests these were seeded in a batch or the trial window is hardcoded in the trigger function.
- `stripe_customer_id` is `null` for all — no Stripe checkout has been completed yet for these orgs.

---

## 9) Queries still needed (recommended follow-ups)

These were not run in the 02-25-2026 audit. Run them when relevant.

### 9.1) `webhook_events` schema
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'webhook_events'
ORDER BY ordinal_position;
```

### 9.2) `stripe_customers` schema
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stripe_customers'
ORDER BY ordinal_position;
```

### 9.3) `organization_invites` schema
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'organization_invites'
ORDER BY ordinal_position;
```

### 9.4) `trg_seed_billing_customer_trial` function body
```sql
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name ILIKE '%seed%billing%';
```

### 9.5) Confirm trial window is correct (1 row)
```sql
SELECT organization_id, trial_ends_at,
       EXTRACT(EPOCH FROM (trial_ends_at - created_at)) / 86400 AS trial_days
FROM billing_customers
LIMIT 1;
```

### 9.6) Check for orgs without a `billing_customers` row
```sql
SELECT o.id, o.name
FROM organizations o
LEFT JOIN billing_customers bc ON bc.organization_id = o.id
WHERE bc.organization_id IS NULL;
```

### 9.7) Full `billing_customers` RLS policy detail
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'billing_customers';
```

---

## 10) Summary of changes since 02-07-2026

| Area | Change |
|---|---|
| **New tables with RLS** | `billing_customers`, `stripe_customers`, `subscriptions`, `webhook_events` all confirmed RLS-enabled |
| **New triggers** | `trg_seed_billing_customer_trial` (auto-trial on org join), `trg_set_current_org_on_membership`, `trg_org_invites_updated_at`, `updated_at` triggers on billing tables |
| **New org policies** | `organization_invites` full CRUD; `org_members_insert_owner_admin_member`; `org_members_select_org` (consolidated) |
| **App-layer billing gate** | Changed from owner/admin → **owner-only** for checkout + portal (`fix/p0-owner-only-billing-v1`, branch pushed 02-25-2026). DB read policy (`billing_customers` SELECT) still allows owner + admin. |
| **`webhook_events.created_at`** | Column does **not** exist — use `updated_at` |
| **`billing_customers` seed** | All current rows have `status = trialing`, `stripe_customer_id = null` — pre-checkout state |

---

End of file.
