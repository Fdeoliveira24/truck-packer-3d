import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { captureDevelopmentFingerprints } from './dev-invoke.mjs';
import { fixtureEmail, generateFixturePassword } from './dev-seed.mjs';
import { maskProjectRef, maskStripeId, maskUuid } from './mask.mjs';
import {
  captureStripeFingerprints,
  resolveStripeSubscriptionPaymentGraph,
  waitFor,
  waitForSignupGraph,
} from './stripe-invoke.mjs';
import {
  addStripeManifestObject,
  createStripeManifest,
  readStripeManifest,
  stripeFixtureObject,
  writeStripeManifest,
} from './stripe-manifest.mjs';
import {
  findStripeEvent,
  recordAndWaitForStripeEvent,
  runStripeSignedWebhookProbe,
} from './stripe-webhook.mjs';
import { FixtureSafetyError } from './safety.mjs';

async function assertNoActiveManifest(manifestPath, config) {
  try {
    await access(manifestPath);
  } catch {
    return;
  }
  const existing = await readStripeManifest(manifestPath, {
    environment: config.environment,
    projectRef: config.projectRef,
  });
  if (existing.phase !== 'cleaned') {
    throw new FixtureSafetyError(
      'active_manifest_exists',
      'Refusing Stripe fixture operation: the existing manifest must be cleaned before a new seed.',
    );
  }
}

export async function verifyStripeReadOnlyContext({ stripe, config }) {
  const [account, monthlyPrice, yearlyPrice] = await Promise.all([
    stripe.accounts.retrieve(),
    stripe.prices.retrieve(config.monthlyPriceId),
    stripe.prices.retrieve(config.yearlyPriceId),
  ]);
  if (!String(account?.id || '').startsWith('acct_')) {
    throw new FixtureSafetyError('stripe_account_unavailable', 'Stripe test account could not be resolved.');
  }
  if (monthlyPrice.livemode !== false || yearlyPrice.livemode !== false) {
    throw new FixtureSafetyError('stripe_not_test_mode', 'Configured Stripe Prices are not test-mode objects.');
  }
  if (monthlyPrice.recurring?.interval !== 'month' || yearlyPrice.recurring?.interval !== 'year') {
    throw new FixtureSafetyError('stripe_interval_mismatch', 'Configured Stripe Price intervals do not match.');
  }
  if (!monthlyPrice.active || !yearlyPrice.active) {
    throw new FixtureSafetyError('inactive_configured_price', 'Configured Stripe Prices must be active.');
  }
  return { account, monthlyPrice, yearlyPrice };
}

async function createSupabaseFixtureGraph({ supabase, manifest, manifestPath }) {
  const email = fixtureEmail(manifest.runId, 'stripe-owner');
  const password = generateFixturePassword();
  const created = await supabase.adminCreateUser({ email, password });
  const userId = String(created?.id || created?.user?.id || '');
  if (!userId) throw new Error('Stripe fixture Auth user creation returned no ID.');
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('owner.auth_user', 'supabase', 'auth_user', userId, 'delete'),
  );
  await writeStripeManifest(manifestPath, manifest);

  const graph = await waitForSignupGraph(supabase, userId);
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('owner.profile', 'supabase', 'profile', graph.profile.id, 'delete'),
  );
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('owner.organization', 'supabase', 'organization', graph.organization.id, 'delete'),
  );
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('owner.membership', 'supabase', 'organization_membership', graph.membership.id, 'delete'),
  );
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('owner.billing_customer', 'supabase', 'billing_customer_projection', graph.billing.id, 'delete'),
  );
  await writeStripeManifest(manifestPath, manifest);
  const jwt = await supabase.signInWithPassword(email, password);
  return { userId, organizationId: String(graph.organization.id), email, jwt };
}

async function createStripeMoneyGraph({ stripe, supabase, config, manifest, manifestPath, owner }) {
  const metadata = {
    tp3d_fixture_run_id: manifest.runId,
    tp3d_fixture_key: 's2-core-monthly',
    organization_id: owner.organizationId,
    supabase_user_id: owner.userId,
  };
  const customer = await stripe.customers.create({
    email: owner.email,
    metadata,
  }, { idempotencyKey: `tp3d-fixture-customer-${manifest.runId}` });
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('s2.customer', 'stripe', 'stripe_customer', customer.id, 'delete'),
  );
  await writeStripeManifest(manifestPath, manifest);

  const customerProjection = await supabase.rest('POST', 'stripe_customers', {
    body: {
      user_id: owner.userId,
      stripe_customer_id: customer.id,
      email: owner.email,
    },
    prefer: 'return=representation',
  });
  if (!customerProjection.ok || customerProjection.body?.length !== 1) {
    throw new Error(`Stripe customer projection creation failed with HTTP ${customerProjection.status}.`);
  }
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(
      's2.stripe_customer_projection',
      'supabase',
      'stripe_customer_projection',
      customerProjection.body[0].id,
      'delete',
    ),
  );
  await writeStripeManifest(manifestPath, manifest);

  const billingProjection = await supabase.rest('PATCH', 'billing_customers', {
    query: `organization_id=eq.${encodeURIComponent(owner.organizationId)}`,
    body: { stripe_customer_id: customer.id },
    prefer: 'return=representation',
  });
  if (!billingProjection.ok || billingProjection.body?.length !== 1) {
    throw new Error(`Billing customer binding failed with HTTP ${billingProjection.status}.`);
  }

  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
    metadata,
  });
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('s2.payment_method', 'stripe', 'stripe_payment_method', paymentMethod.id, 'detach'),
  );
  await writeStripeManifest(manifestPath, manifest);
  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: config.monthlyPriceId }],
    default_payment_method: paymentMethod.id,
    payment_behavior: 'error_if_incomplete',
    metadata,
    expand: ['items.data.price', 'latest_invoice.payment_intent'],
  }, { idempotencyKey: `tp3d-fixture-subscription-${manifest.runId}` });
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('s2.subscription', 'stripe', 'stripe_subscription', subscription.id, 'cancel'),
  );
  await writeStripeManifest(manifestPath, manifest);

  const paymentGraph = await resolveStripeSubscriptionPaymentGraph(stripe, {
    customerId: customer.id,
    subscriptionId: subscription.id,
  });
  for (const [fixtureKey, objectType, exactId] of [
    ['s2.invoice', 'stripe_invoice', paymentGraph.invoiceId],
    ['s2.payment_intent', 'stripe_payment_intent', paymentGraph.paymentIntentId],
    ['s2.charge', 'stripe_charge', paymentGraph.chargeId],
    ['s2.balance_transaction', 'stripe_balance_transaction', paymentGraph.balanceTransactionId],
  ]) {
    addStripeManifestObject(
      manifest,
      stripeFixtureObject(fixtureKey, 'stripe', objectType, exactId, 'none', 'created', 'not_applicable'),
    );
  }
  await writeStripeManifest(manifestPath, manifest);

  const createdEvent = await findStripeEvent(stripe, {
    type: 'customer.subscription.created',
    objectId: subscription.id,
    createdGte: Math.floor(new Date(manifest.createdAt).getTime() / 1000) - 10,
  });
  await recordAndWaitForStripeEvent({
    supabase,
    manifest,
    manifestPath,
    event: createdEvent,
    fixtureKey: 's2.subscription_created_event',
  });

  const projected = await waitFor(async () => {
    const result = await supabase.rest('GET', 'subscriptions', {
      query: `select=id,organization_id,status,price_id,interval,current_period_end,stripe_customer_id,stripe_subscription_id&stripe_subscription_id=eq.${encodeURIComponent(subscription.id)}`,
    });
    if (!result.ok || result.body?.length !== 1) return null;
    return result.body[0].status === 'active' ? result.body[0] : null;
  }, { description: 'the active Stripe subscription projection' });
  addStripeManifestObject(
    manifest,
    stripeFixtureObject('s2.subscription_projection', 'supabase', 'subscription_projection', projected.id, 'delete'),
  );
  await writeStripeManifest(manifestPath, manifest);

  return { customer, paymentMethod, subscription, projected, createdEvent };
}

export async function seedStripeFixtures({
  stripe,
  supabase,
  config,
  manifestPath,
  logger = console,
}) {
  const context = await verifyStripeReadOnlyContext({ stripe, config });
  const manifest = await readStripeManifest(manifestPath, {
    environment: config.environment,
    projectRef: config.projectRef,
    stripeAccountId: context.account.id,
  });
  if (manifest.phase !== 's1_verified') {
    throw new FixtureSafetyError(
      's1_not_verified',
      'Stripe S1 must pass before any S2 billing fixture objects are created.',
    );
  }

  const owner = await createSupabaseFixtureGraph({ supabase, manifest, manifestPath });
  const money = await createStripeMoneyGraph({ stripe, supabase, config, manifest, manifestPath, owner });
  manifest.phase = 'seeded';
  manifest.evidence.seed = {
    ownerCount: 1,
    workspaceCount: 1,
    customerCount: 1,
    subscriptionCount: 1,
    webhookDeliveryStatus: 200,
  };
  await writeStripeManifest(manifestPath, manifest);
  logger.log(
    `Seeded Stripe test fixture in ${maskProjectRef(config.projectRef)} ` +
    `(run ${maskUuid(manifest.runId)}, customer ${maskStripeId(money.customer.id)}, subscription ${maskStripeId(money.subscription.id)}).`,
  );
  return manifest;
}

export async function verifyStripeSignedWebhookGate({
  stripe,
  supabase,
  config,
  manifestPath,
  logger = console,
}) {
  await assertNoActiveManifest(manifestPath, config);
  const context = await verifyStripeReadOnlyContext({ stripe, config });
  const manifest = createStripeManifest({
    runId: randomUUID(),
    projectRef: config.projectRef,
    stripeAccountId: context.account.id,
  });
  manifest.baseline = {
    supabase: await captureDevelopmentFingerprints(supabase),
    stripe: await captureStripeFingerprints(stripe),
  };
  await writeStripeManifest(manifestPath, manifest);

  const signingProbe = await runStripeSignedWebhookProbe({
    stripe,
    supabase,
    config,
    manifest,
    manifestPath,
  });

  manifest.phase = 's1_verified';
  manifest.evidence.s1 = {
    environment: config.environment,
    projectBound: true,
    stripeAccountBound: true,
    stripeTestMode: true,
    webhookTestEventAccepted: signingProbe.accepted,
    webhookProbeResidue: signingProbe.collateralDifferences,
    requiredWebhookEventsAdded: signingProbe.requiredEventsAdded,
    configuredPricesVerified: true,
    dryRunSeparated: true,
  };
  await writeStripeManifest(manifestPath, manifest);
  logger.log(
    `Verified Stripe S1 signed webhook gate in ${maskProjectRef(config.projectRef)} ` +
    `(run ${maskUuid(manifest.runId)}; no persistent fixture residue).`,
  );
  return manifest;
}
