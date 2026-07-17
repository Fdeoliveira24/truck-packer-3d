# Deployed Development Billing Fixtures

This operator guide covers the write-capable billing fixture layer for the approved hosted development Supabase project. It exercises deployed Edge Functions and deployed PostgREST/RLS with disposable development-only users and exact-ID cleanup. It is not a Stripe sandbox, production, customer-data, or live-payment test.

## Safety boundary

Every command refuses to run unless all of these conditions hold:

- `TP3D_FIXTURE_ENV=dev`.
- `SUPABASE_URL` is a hosted Supabase project URL.
- the parsed project reference is explicitly allowlisted and matches the development reference pinned in `dev-environment.mjs`;
- `SUPABASE_SERVICE_ROLE_KEY` is present;
- `STRIPE_SECRET_KEY` is absent;
- the manifest environment and project match the current command;
- seed and cleanup include `--confirm`;
- cleanup targets only immutable IDs captured by the current manifest.

The tooling never links a project, deploys a function, applies a migration, resets a remote database, imports the Stripe SDK, or calls Stripe. Normal logs mask project references, run IDs, user IDs, and email addresses. Passwords and JWTs exist only in memory long enough to create and authenticate disposable users; they are never logged or stored in the manifest.

## Required local secrets

Provide these through the operator shell or an approved local secret store:

```sh
export TP3D_FIXTURE_ENV=dev
export SUPABASE_URL='https://<approved-development-project-ref>.supabase.co'
export TP3D_FIXTURE_ALLOWED_PROJECT_REFS='<approved-development-project-ref>'
export SUPABASE_SERVICE_ROLE_KEY='<development-service-role-key>'
unset STRIPE_SECRET_KEY
```

Do not commit an environment file containing these values. Do not use a browser customer account, personal email address, production project, production key, or hosted Stripe secret.

## Commands and lifecycle

Planning is always the first step and performs zero network writes:

```sh
npm run billing:fixtures:dev:plan
```

The normal write lifecycle is explicit:

```sh
npm run billing:fixtures:dev:seed -- --confirm
npm run billing:fixtures:dev:verify
npm run test:billing:dev
npm run billing:fixtures:dev:cleanup -- --confirm
```

`test:billing:dev` requires an existing verified manifest and never seeds fixtures silently. Run cleanup even when verification or integration tests fail. A second confirmed cleanup is safe and should report the already-absent objects without broad deletion.

For the smaller D1 lifecycle proof, seed only the owner graph:

```sh
npm run billing:fixtures:dev:seed -- --confirm --gate-d1-owner-only
```

Use a separate `TP3D_FIXTURE_MANIFEST_PATH` when D1 and D2 evidence must coexist locally. Manifest files belong under the ignored `.tp3d-fixtures/` directory and must remain permission-restricted.

## Gate D1: safety and lifecycle

The static/runtime safety suite proves environment, allowlist, production-refusal, service-key, Stripe-key, confirmation, manifest-binding, masking, and no-default-test-execution rules:

```sh
node --test \
  tests/audit/billing-fixture-safety.spec.mjs \
  tests/audit/deployed-billing-fixture-safety.spec.mjs
```

The hosted D1 lifecycle then proves a real disposable owner user, trigger-created profile/workspace/owner membership/no-card trial, exact-ID verification, exact cleanup, idempotent second cleanup, and unchanged non-fixture fingerprints.

## Gate D2: deployed development matrix

The integration suite uses real disposable JWTs against deployed development functions and PostgREST/RLS. It covers:

- signup trigger and server-controlled workspace creation;
- direct no-card trial, expired trial, missing mapping, omitted organization fallback, malformed organization rejection, unknown-active-Price fallback, and eligible sibling coverage;
- valid organization authorization and unrelated-user denial;
- member/admin role changes, dedicated ownership transfer, active-billing transfer blocking, direct membership-DML denial, member removal, and member leave;
- invite creation, acceptance, and revocation;
- archive/restore behavior and workspace-limit preservation;
- checkout and portal rejection paths that complete before Stripe access;
- missing and invalid JWT rejection;
- sanitized responses with no SQL, PostgREST details, stack traces, JWTs, service-role keys, or full Stripe identifiers.

Cases that require real Stripe Products, Prices, Customers, Subscriptions, Checkout Sessions, Portal Sessions, payments, or coupons remain outside this layer. Duplicate/conflicting billing shapes that are unsafe on the shared development project remain localhost-only.

## Manifest and cleanup contract

The manifest records the fixture version, run, project, object type, exact immutable ID, cleanup ownership, creation state, and cleanup state. It may own disposable auth users, profiles, organizations, memberships, invitations, and approved billing projection rows created only for fixture organizations.

Cleanup:

1. validates environment/project binding;
2. checks each exact manifest ID;
3. removes only manifest-owned rows and auth users;
4. verifies absence;
5. re-captures non-fixture fingerprints;
6. exits non-zero if any owned object remains or a collateral fingerprint changes.

Names, prefixes, timestamps, and fixture email patterns are secondary evidence only. They are never deletion authority.

## Difference from localhost Stage B

[Local Billing Fixtures](./local-billing-fixtures.md) run against the operator-owned local Supabase stack and may use rollback-isolated adversarial database shapes. This deployed layer uses the real hosted development functions and RLS, but it refuses shared-project conflict scenarios and never modifies schema or migrations.

## Difference from Stripe test-mode fixtures

This layer supplies no Stripe secret and creates zero Stripe objects. The separately bounded [Stripe Test-Mode Billing Fixtures](./stripe-test-billing-fixtures.md) use Stripe test mode only, capture Stripe object IDs in their own manifest, and prove independent exact cleanup. Passing this development layer is not Stripe sandbox evidence; each layer retains its own environment and refusal contract.

## Troubleshooting

- **Environment refused:** confirm the exact `dev` environment, hosted URL, approved allowlist, and pinned development project.
- **Stripe-key refusal:** remove the variable entirely; even a test key is forbidden here.
- **Manifest mismatch:** do not edit IDs or reuse a manifest across projects/environments. Start a new run after the prior manifest is clean.
- **401 with a disposable JWT:** verify the deployed Auth/function environment; do not weaken JWT verification or mock the production user check.
- **Malformed organization returns 200:** verify the current `billing-status` deployment; supplied non-empty malformed values must return sanitized 400 without profile fallback.
- **Cleanup failure:** stop. Inspect only the masked manifest keys and exact owned IDs through approved tooling. Never use a broad prefix or timestamp delete.
- **Collateral fingerprint change:** treat the run as failed and investigate before retrying; do not normalize the baseline to hide the difference.
