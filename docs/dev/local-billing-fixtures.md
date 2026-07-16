# Local Billing Fixtures

Local Billing Fixture Stage B provides repeatable integration proof against an operator-owned local Supabase stack. It exercises current billing, ownership, role, RPC, RLS, and constraint behavior without contacting a hosted Supabase project or Stripe.

## Safety boundary

The local commands:

- accept only localhost or `127.0.0.1` Supabase endpoints reported by `supabase status`;
- reject hosted and other non-local URLs;
- reject any present `STRIPE_SECRET_KEY`, including test-mode keys;
- never link, deploy, push, reset, start, or stop Supabase automatically;
- use one unique run UUID in fixture emails and names;
- capture immutable row IDs as cleanup authority;
- clean only the exact users and rows created by that run;
- mask identifiers in normal output;
- fail when cleanup or temporary-resource removal is incomplete.

The hosted fixture CLI in [Billing Fixture Safety Foundation](./billing-fixtures.md) remains no-write and separate. These local tests are not Stripe sandbox evidence and must not be described as hosted-development proof.

## Prerequisites

- Docker is running.
- Supabase CLI is installed.
- Node dependencies are installed.
- No `STRIPE_SECRET_KEY` is exported in the test shell.
- The repository is not linked or redirected to a hosted target for these commands.

The harness uses the local credentials returned by `supabase status`. Because a local Edge container cannot reach the host gateway through its own `127.0.0.1`, each fixture run creates a disposable Docker loopback proxy to the internal local Supabase gateway. The proxy is removed in `finally` cleanup and is never a remote route or an authentication bypass.

## Explicit operator flow

Start and reset the local stack explicitly:

```sh
supabase start
supabase db reset --local --no-seed
```

If the local Edge runtime is not already serving the repository functions, run this in a separate terminal:

```sh
env -u STRIPE_SECRET_KEY supabase functions serve
```

Then verify the environment and run the serial matrix:

```sh
env -u STRIPE_SECRET_KEY npm run local:billing:verify
env -u STRIPE_SECRET_KEY npm run test:billing:local
```

The commands do not perform the start, reset, or serve steps. If the local stack is unavailable, verification fails and the tests skip loudly with the exact reason; that is not a passing integration result.

## Fixture classifications

### Gate B1 — harness and core proof

- Signup creates a profile, default organization, exact owner membership, and no-card trial.
- A direct active monthly subscription returns the requested workspace's direct identity and the configured base-paid workspace limit.
- Active direct billing blocks ownership transfer with `workspace_has_active_billing` and no mutation.
- Generic owner promotion is rejected with `ownership_change_requires_transfer`.
- A real local JWT reaches the production Edge handlers; missing authentication remains `401`.

### Gate B2 — billing status

- no usable billing mapping;
- no-card and expired no-card trials;
- direct monthly and annual subscriptions, including two directly paid siblings;
- unpaid siblings inside and outside the derived limit;
- canceled direct billing and archived organizations;
- current unknown-price fallback behavior;
- duplicate active rows for one organization;
- the smallest locally representable cross-organization customer/subscription conflict;
- stale subscription identity fallback.

The matrix records current production behavior rather than inventing new response fields or commercial rules. An unknown active price currently keeps the base-plan fallback. Duplicate active rows for one organization fail closed. A conflicting sibling projection currently resolves through owner-plan coverage as `included_in_plan`, while a stale local billing-customer subscription identity retains the existing local projection fallback. Those observations are candidates for the later billing-integrity reassessment, not changes made by Stage B.

### Gate B2 — ownership, role, RPC, RLS, and constraints

- Ownership transfer succeeds without direct billing, blocks with direct billing, and does not treat sibling coverage as direct billing.
- Non-owners and missing targets fail safely.
- Approved member/admin changes and no-op updates pass; owner creation, replacement, demotion, and admin escalation paths are rejected.
- The ownership RPC updates the organization owner and both membership roles atomically.
- Authenticated users can read allowed profile/workspace/membership rows and cannot read unrelated workspace or billing projection data.
- Anonymous access and authenticated direct membership mutation are denied.
- Unique constraints reject duplicate subscription IDs, billing-customer organizations, and membership pairs.
- Currently permitted adversarial billing shapes are proven only inside rollback transactions.
- A true no-workspace fixture removes only its captured auto-created graph and leaves no residual row.

## Cleanup behavior

Each run tracks the exact auth user, organization, membership, billing, and subscription identifiers it creates. Cleanup removes only those captured IDs, checks both tracked IDs and the run tag for residual rows, and reports zero-residual proof. Display names and prefixes are never deletion authority.

Temporary Docker proxy containers use the `tp3d-local-auth-<masked-run>` naming pattern and must be removed after every pass or failure. A leftover proxy or fixture row is a failed run that must be investigated before retrying.

## Troubleshooting

- **Local Supabase unavailable:** run `supabase start`, then rerun environment verification.
- **Migration count or grants differ:** run the explicit local reset and inspect the named missing migration or privilege; do not patch the test to accept drift.
- **Edge returns `401` with a valid local JWT:** confirm the disposable loopback proxy can reach the internal local Auth gateway and that no hosted URL override is present.
- **Stripe refusal:** remove the environment variable entirely; an empty or test key is not accepted by the local harness.
- **Cleanup failure:** do not use broad deletes. Inspect the captured run IDs and remove only proven fixture-owned rows before rerunning.
- **Proxy remains:** remove only the named `tp3d-local-auth-*` container for that failed run, then verify no fixture process is still using it.
- **Hosted endpoint detected:** stop. These commands are localhost-only; use the future deployed-development fixture layer after it is separately approved.
