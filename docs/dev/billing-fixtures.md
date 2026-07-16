# Billing Fixture Safety Foundation

This document defines the no-write foundation for future durable billing fixtures. The current fixture-safety foundation is complete and plans and validates fixture intent only. It does not connect to Supabase or Stripe, create users, create billing objects, change database rows, or provide cleanup commands.

## Why durable fixtures are needed

The billing safety work has runtime coverage for direct subscriptions, owner-plan coverage, ambiguous mappings, ownership transfer, and role invariants. Several external combinations remain unavailable in the shared development project, including two directly paid siblings, active/trialing siblings, coupon subscriptions, duplicate mappings, and conflicting organization metadata. Durable fixtures will eventually make those scenarios repeatable without borrowing customer or production data.

## Current test layers

| Layer | Current coverage | Boundary |
|---|---|---|
| Production function runtime with mocked dependencies | The real `billing-status` handler executes with mocked database/Stripe boundaries, including F12 direct identity cases. | Production control flow runs; no external Supabase or Stripe service is contacted. |
| Extracted production-helper runtime | Production billing/ownership predicates and client error mappers execute directly. | The exact helper runs outside its full Edge Function. |
| Synthetic runtime | Billing-pump, cross-user isolation, and shared-snapshot models exercise race and authority invariants. | Models behavior without executing a complete external service flow. |
| Source-contract/static | Function ordering, organization scoping, sanitization, and forbidden fallback checks inspect source structure. | Useful invariant evidence; not runtime or integration proof. |
| Manual browser/sandbox | Authenticated browser and safe deployed-function checks are summarized in [Master TODO V5](../product/TP3D-MASTER-TODO-V5.md), with detailed historical evidence retained in its archive links. | Limited to fixtures already present; unavailable rows are never marked passed. |
| External Supabase integration | Missing. | No durable local/dev database fixture creator or verifier exists yet. |
| External Stripe integration | Missing. | No repeatable Stripe test-mode customer/subscription fixture layer exists yet. |

## Safety environment contract

Both supported commands refuse to run unless all applicable checks pass:

- `TP3D_FIXTURE_ENV` is exactly `dev`.
- `SUPABASE_URL` is a hosted `https://<20-character-project-ref>.supabase.co` project URL.
- The parsed project reference appears in `TP3D_FIXTURE_ALLOWED_PROJECT_REFS`.
- A known production project reference is refused even if accidentally allowlisted. No authoritative production ref is currently recorded in live project documentation; add it to `KNOWN_PRODUCTION_PROJECT_REFS` as soon as one exists.
- Safety never depends on a project display name.
- If `STRIPE_SECRET_KEY` is present, it must begin with `sk_test_`. Live and other key types are refused.
- Keys, JWTs, authorization headers, and raw identifiers are never printed.

Example shell setup uses placeholders intentionally:

```sh
export TP3D_FIXTURE_ENV=dev
export TP3D_FIXTURE_ALLOWED_PROJECT_REFS='<allowlisted-dev-project-ref>'
export SUPABASE_URL='https://<allowlisted-dev-project-ref>.supabase.co'
# Optional for later Stripe-aware planning only:
export STRIPE_SECRET_KEY='sk_test_replace_me'
```

Secrets belong in local or CI secret stores, never source control. This foundation does not add CI secrets.

## Commands

```sh
npm run billing:fixtures:verify-safety
npm run billing:fixtures:plan
```

`billing:fixtures:verify-safety` validates the environment and reports only masked project/mode information. `billing:fixtures:plan` additionally creates and validates an in-memory immutable manifest and lists stable scenario keys. Both commands make zero network calls and zero database or Stripe writes.

There are deliberately no `seed`, `reset`, or `cleanup` package commands. Invoking those names directly against the CLI hard-fails with:

```text
Fixture writes are not implemented in the safety-foundation branch.
```

## Manifest ownership and immutability

Manifest schema version 1 binds every run and fixture entry to:

- stable `fixtureKey` and positive `fixtureVersion`
- exact `environment` and `supabaseProjectRef`
- unique UUID `fixtureRunId`
- ISO creation timestamp
- nullable immutable organization UUID
- immutable arrays of user UUIDs, Stripe customer IDs, and Stripe subscription IDs
- fixture type and scenario classification
- `expectedCleanupOwnership: "manifest-ids-only"`

Initial plans contain null/empty identifiers because no objects are created. Future cleanup must use immutable manifest IDs plus matching environment/project bindings. Display names and prefixes may only be secondary checks. Cross-project and cross-environment manifest reuse is rejected. The manifest contains no emails, secrets, tokens, authorization headers, or `includedOrgIds` expectation; F12 established that `includedOrgIds` is owner-coverage diagnostics, not requested-workspace direct identity.

## Masking policy

Normal output preserves only enough prefix/suffix characters to distinguish fixture objects:

- project refs: first 4 and last 4 characters
- UUID/user IDs: first 8 and last 4 characters
- Stripe IDs: object prefix plus partial identifier edges
- email addresses: first local/domain character plus final domain suffix

Null, short, and malformed inputs produce fixed invalid markers rather than echoing input. Secrets always render as `[redacted]`. Raw IDs may exist only in the in-memory manifest or a future protected machine-readable manifest; normal console output must remain masked.

## Test-user email policy

- Use non-routable addresses only for programmatically confirmed users that do not need a real email flow.
- Use controlled plus-alias mailboxes for invite, confirmation, password-reset, or other real delivery flows.
- Never use customer or production email addresses.

## Planned later branches

Each later layer remains separate and must preserve these refusal rules:

1. `test/billing-local-db-fixtures`
2. `test/billing-dev-function-smoke`
3. `test/billing-stripe-sandbox-fixtures`
4. `ci/billing-integration-gates`

Local billing fixture Stage B (`test/billing-local-db-fixtures`) is unblocked but incomplete. It must be reviewed independently before any write-capable module is added. External Supabase and Stripe fixture integration remains missing; no write-capable fixture command exists. Stripe sandbox creation, cleanup/reset behavior, CI secrets, catalog/tier/grant work, and production data remain out of scope.
