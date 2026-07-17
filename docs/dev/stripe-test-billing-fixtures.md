# Stripe Test-Mode Billing Fixtures

This operator guide covers the write-capable Stripe sandbox fixture layer for Truck Packer 3D. It combines Stripe test mode with the approved development Supabase project and its deployed Edge Functions. It is not a live-payment, production, customer-data, or commercial-pricing test.

## Safety boundary

The runner refuses to write unless all of these conditions hold:

- `TP3D_FIXTURE_ENV` is exactly `stripe-test`.
- `SUPABASE_URL` resolves to the approved development project `yduzbvijzwczjapanxbd`.
- that project reference is present in `TP3D_FIXTURE_ALLOWED_PROJECT_REFS`.
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` are present.
- `STRIPE_SECRET_KEY` is a Stripe test-mode key; live and non-test keys are refused.
- `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_PRO_YEARLY` are valid configured Price IDs.
- write commands include the explicit `--confirm` flag.
- the manifest belongs to the same environment, Supabase project, Stripe account, and fixture version.

The local runner does not request, retain, construct, or log `STRIPE_WEBHOOK_SECRET`. Stripe creates and signs the safety event through the configured test-mode destination. Secrets, JWTs, passwords, authorization headers, email addresses, and complete identifiers must never appear in normal logs or the manifest.

The exact deployed development webhook is:

```text
https://yduzbvijzwczjapanxbd.supabase.co/functions/v1/stripe-webhook
```

Do not commit an environment file containing credentials. Do not use a live Stripe key, production Supabase project, customer account, personal email address, or commercial catalog experiment.

## Required webhook events

The Stripe test-mode destination must cover:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.deleted`
- `customer.subscription.updated`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

Gate S1 temporarily adds `test_helpers.test_clock.created`, creates one disposable test clock, waits for Stripe's signed delivery, removes the stored webhook row and test clock by exact ID, and removes the temporary event subscription. A failed probe restores the original destination event list. The fixture tooling must not redeploy the Edge Function or weaken signature verification.

## Operator lifecycle

Prepare the required variables in a protected local shell, then run the lifecycle in order:

```sh
npm run billing:fixtures:stripe:plan
npm run billing:fixtures:stripe:probe -- --confirm
npm run billing:fixtures:stripe:seed -- --confirm
npm run billing:fixtures:stripe:verify
npm run billing:fixtures:stripe:safety -- --confirm
npm run billing:fixtures:stripe:cleanup -- --confirm
```

`plan` performs read-only Stripe account and configured-Price checks. `probe` is Gate S1 and must pass before `seed` can create S2 objects. `verify` completes the S2 direct-monthly lifecycle. `safety` completes S3. Always run confirmed cleanup after success or failure. A second cleanup is supported and should report already-absent objects rather than broad-delete anything.

The static safety suite is separate and never writes:

```sh
npm run test:billing:stripe
node --test tests/audit/billing-fixture-safety.spec.mjs \
  tests/audit/deployed-billing-fixture-safety.spec.mjs
```

None of these integration commands runs during the default `npm test` command.

## Gate S1 — environment and signed delivery

S1 proves:

- exact environment, project, Stripe account, and Price binding;
- production-project and live-key refusal;
- dry-run separation and explicit confirmation;
- one enabled Stripe destination at the exact development URL;
- complete required event coverage;
- a Stripe-signed webhook is accepted by the deployed function;
- missing or stale local signing-secret state is irrelevant;
- the temporary test clock, temporary event subscription, and stored webhook row are absent afterward;
- Supabase and Stripe fingerprints are unchanged after the probe.

Stop at S1 on any signature, event-coverage, cleanup, or collateral-fingerprint failure.

## Gate S2 — direct monthly lifecycle

S2 creates one manifest-owned disposable owner/workspace graph, Stripe test Customer, test Payment Method, and monthly test Subscription. It records the automatically generated test Invoice, PaymentIntent, charge, and balance transaction by exact ID. It verifies the real Stripe-signed creation event reaches the deployed webhook, projections resolve to the exact workspace, `/billing-status` reports direct active monthly entitlement, and the owner can open a Billing Portal session.

The subscription is then canceled in Stripe test mode. S2 waits for the real signed deletion event, verifies the projection becomes canceled, and confirms `/billing-status` revokes direct entitlement with the existing fail-closed result. This gate does not define new prices, limits, trial policy, sibling coverage, coupons, or commercial behavior.

## Gate S3 — failure and replay safety

S3 proves:

- missing webhook signature returns sanitized HTTP 400 and creates no row;
- an invalid signature returns sanitized HTTP 400 and creates no row;
- rejected responses expose no supplied ID, SQL, PostgREST detail, stack, JWT, or secret-like value;
- replaying the exact previously processed signed cancellation event leaves one processed row;
- the replay changes no Supabase or Stripe fingerprint.

The Stripe CLI is used only to ask Stripe to resend an existing test-mode event to the exact manifest-owned destination. The API key remains in the child process environment and captured command output is not printed.

## Manifest and cleanup

The ignored, permission-restricted manifest records the fixture version, run, environment, Supabase project, Stripe account, object type, exact immutable ID, cleanup action, creation state, and cleanup state. It stores no passwords, JWTs, service-role keys, webhook secrets, authorization headers, or emails.

Cleanup may act only on exact manifest-owned IDs or exact relationships rooted in a manifest-owned user, organization, Stripe Customer, or Subscription. Names, prefixes, timestamps, and orphan guesses are never deletion authority. Cleanup removes Supabase projections, webhook rows, memberships, workspace, profile, and auth user; deletes the test Customer and test clock; detaches the Payment Method; and confirms the Subscription is canceled. Stripe invoices, PaymentIntents, charges, balance transactions, events, and Portal sessions are immutable test evidence and are recorded as not applicable for deletion.

After cleanup:

- every deletable manifest-owned Supabase and Stripe object is absent;
- terminal Stripe objects are canceled, detached, or otherwise non-active;
- no temporary webhook event remains enabled;
- non-fixture Supabase and Stripe fingerprints match the pre-seed baseline;
- any cleanup failure exits non-zero with masked diagnostics.

## Relationship to the other fixture layers

[Local Billing Fixtures](./local-billing-fixtures.md) exercise the local Supabase stack and rollback-isolated adversarial database shapes with no remote or Stripe access. [Deployed Development Billing Fixtures](./deployed-development-billing-fixtures.md) exercise hosted Edge Functions and RLS using disposable Supabase data while refusing every Stripe key. This Stripe layer is the only one approved to create Stripe test-mode objects, and it remains pinned to the same development Supabase project.

Passing this layer is not production payment evidence and does not authorize live Stripe configuration, migrations, commercial price changes, billing redesign, AutoPack changes, or Max Capacity Phase C.

## Troubleshooting

- **Environment refusal:** verify the environment name, allowlist, exact development URL, and presence of required protected variables. Never substitute a production reference.
- **Signed probe rejected:** first verify the development project's `STRIPE_WEBHOOK_SECRET` matches the exact test-mode destination. Do not print the value or add a verification bypass. Redeploy only if a separately proven deployed-code defect requires it.
- **Missing event:** report the missing event before changing the destination. Keep only the seven required events after S1 removes its temporary probe event.
- **Manifest mismatch:** do not reuse a manifest across environment, project, Stripe account, or fixture version.
- **Cleanup failure:** keep the manifest, rerun exact cleanup, and investigate the named masked fixture key. Never replace exact cleanup with a prefix, timestamp, or global reset.
