# Billing Fixture Safety Foundation

This document defines the shared safety boundary for billing fixtures. The original planning CLI remains no-write. Local Billing Fixture Stage B and the deployed-development fixture layer are complete in separate, environment-bound harnesses documented in [Local Billing Fixtures](./local-billing-fixtures.md) and [Deployed Development Billing Fixtures](./deployed-development-billing-fixtures.md).

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
| Local Supabase integration | Complete. | The Stage B harness runs only against the local CLI stack, invokes the real local Edge functions with local JWTs, uses exact-ID cleanup, and rejects any Stripe key or remote URL. |
| Deployed development integration | Complete. | Disposable hosted-development users and rows exercise deployed Edge Functions and RLS, with manifest-owned exact-ID cleanup and unchanged non-fixture fingerprints. No Stripe key or object is used. |
| External Stripe integration | Missing. | No repeatable Stripe test-mode customer/subscription fixture layer exists yet. |

## Planning safety environment contract

The no-write planning commands refuse to run unless all applicable checks pass:

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

The completed local layer has separate commands and a stricter localhost-only contract:

```sh
npm run local:billing:verify
npm run test:billing:local
```

Those commands must never be pointed at a hosted project and must run with `STRIPE_SECRET_KEY` absent. See [Local Billing Fixtures](./local-billing-fixtures.md) for the explicit operator-owned start/reset/serve sequence and scenario matrix.

The deployed-development layer has separate commands with a stricter approved-project contract:

```sh
npm run billing:fixtures:dev:plan
npm run billing:fixtures:dev:seed -- --confirm
npm run billing:fixtures:dev:verify
npm run test:billing:dev
npm run billing:fixtures:dev:cleanup -- --confirm
```

These commands require `SUPABASE_SERVICE_ROLE_KEY`, refuse every present `STRIPE_SECRET_KEY`, and never run during `npm test`. See [Deployed Development Billing Fixtures](./deployed-development-billing-fixtures.md) for the complete lifecycle and refusal rules. The original no-write CLI still has no seed/reset/cleanup surface.

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

Initial no-write plans contain null/empty identifiers because no objects are created. The deployed-development manifest records each created object by immutable exact ID, environment, project, fixture version, creation state, and cleanup state. Cleanup uses those IDs only. Display names and prefixes are secondary checks. Cross-project and cross-environment reuse is rejected. Manifests contain no emails, passwords, secrets, tokens, authorization headers, or `includedOrgIds` expectation; F12 established that `includedOrgIds` is owner-coverage diagnostics, not requested-workspace direct identity.

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

## Remaining later layers

Each layer remains separate and must preserve these refusal rules. Local Billing Fixture Stage B and deployed-development fixtures are complete. The remaining deferred layers are:

1. `test/billing-stripe-sandbox-fixtures`
2. `ci/billing-integration-gates`

The planning CLI remains no-write. The local Stage B harness is write-capable only inside the operator-started localhost stack. The deployed-development harness is write-capable only in the pinned development project and cleans exact captured IDs. Stripe sandbox creation, CI secrets, commercial catalog/tier/grant work, and production data remain out of scope until separately approved.
