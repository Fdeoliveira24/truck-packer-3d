import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { captureDevelopmentFingerprints, compareDevelopmentFingerprints } from './dev-invoke.mjs';
import { fixtureEmail, generateFixturePassword } from './dev-seed.mjs';
import { maskProjectRef, maskUuid } from './mask.mjs';
import {
  addStripeManifestObject,
  findStripeManifestObject,
  stripeFixtureObject,
  writeStripeManifest,
} from './stripe-manifest.mjs';
import { findStripeEvent, recordAndWaitForStripeEvent } from './stripe-webhook.mjs';
import {
  captureStripeFingerprints,
  compareStripeFingerprints,
  waitFor,
} from './stripe-invoke.mjs';

const execFileAsync = promisify(execFile);

function objectId(manifest, key) {
  const object = findStripeManifestObject(manifest, key);
  if (!object) throw new Error(`Missing Stripe fixture manifest object: ${key}`);
  return object.exactId;
}

async function issueOwnerJwt(supabase, manifest) {
  const userId = objectId(manifest, 'owner.auth_user');
  const password = generateFixturePassword();
  const email = fixtureEmail(manifest.runId, 'stripe-owner');
  return supabase.getUserJwt(userId, email, password);
}

async function requireSingleRow(supabase, table, query, context) {
  const result = await supabase.rest('GET', table, { query });
  if (!result.ok || !Array.isArray(result.body) || result.body.length !== 1) {
    throw new Error(`${context} expected one row and received HTTP ${result.status}.`);
  }
  return result.body[0];
}

export async function verifyStripeCoreLifecycle({
  stripe,
  supabase,
  config,
  manifest,
  manifestPath,
  logger = console,
}) {
  if (manifest.phase !== 'seeded') {
    throw new Error('Stripe core verification requires a seeded manifest.');
  }
  const organizationId = objectId(manifest, 'owner.organization');
  const customerId = objectId(manifest, 's2.customer');
  const subscriptionId = objectId(manifest, 's2.subscription');
  const ownerJwt = await issueOwnerJwt(supabase, manifest);

  const [stripeCustomerRow, subscriptionRow, billingCustomerRow] = await Promise.all([
    requireSingleRow(
      supabase,
      'stripe_customers',
      `select=id,user_id,stripe_customer_id&id=eq.${encodeURIComponent(objectId(manifest, 's2.stripe_customer_projection'))}`,
      'stripe_customers projection',
    ),
    requireSingleRow(
      supabase,
      'subscriptions',
      `select=id,organization_id,status,price_id,interval,current_period_end,stripe_customer_id,stripe_subscription_id&stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
      'subscriptions projection',
    ),
    requireSingleRow(
      supabase,
      'billing_customers',
      `select=id,organization_id,status,billing_interval,current_period_end,stripe_customer_id,stripe_subscription_id&organization_id=eq.${encodeURIComponent(organizationId)}`,
      'billing_customers projection',
    ),
  ]);

  if (stripeCustomerRow.stripe_customer_id !== customerId) throw new Error('stripe_customers customer binding mismatch.');
  if (subscriptionRow.organization_id !== organizationId) throw new Error('Subscription organization binding mismatch.');
  if (subscriptionRow.stripe_subscription_id !== subscriptionId) throw new Error('Subscription ID binding mismatch.');
  if (subscriptionRow.stripe_customer_id !== customerId) throw new Error('Subscription customer binding mismatch.');
  if (subscriptionRow.price_id !== config.monthlyPriceId) throw new Error('Subscription Price binding mismatch.');
  if (subscriptionRow.interval !== 'month' || subscriptionRow.status !== 'active') {
    throw new Error('Subscription interval/status projection mismatch.');
  }
  if (!subscriptionRow.current_period_end) throw new Error('Subscription period projection is missing.');
  if (
    billingCustomerRow.organization_id !== organizationId ||
    billingCustomerRow.stripe_customer_id !== customerId ||
    billingCustomerRow.stripe_subscription_id !== subscriptionId ||
    billingCustomerRow.status !== 'active' ||
    billingCustomerRow.billing_interval !== 'month'
  ) {
    throw new Error('billing_customers projection mismatch.');
  }

  const billing = await supabase.invoke('billing-status', {
    jwt: ownerJwt,
    method: 'GET',
    query: `organization_id=${encodeURIComponent(organizationId)}`,
  });
  if (
    billing.status !== 200 ||
    billing.body?.orgId !== organizationId ||
    billing.body?.entitlementStatus !== 'active' ||
    billing.body?.status !== 'active' ||
    billing.body?.interval !== 'month' ||
    billing.body?.unknownPriceId !== false ||
    billing.body?.workspaceIncluded !== true
  ) {
    throw new Error('Deployed billing-status did not return the direct active monthly entitlement.');
  }

  const portal = await supabase.invoke('stripe-create-portal-session', {
    jwt: ownerJwt,
    body: { organization_id: organizationId },
  });
  if (portal.status !== 200 || !/^https:\/\//.test(String(portal.body?.url || ''))) {
    throw new Error(`Deployed portal verification failed with HTTP ${portal.status}.`);
  }
  const portalEvent = await findStripeEvent(stripe, {
    type: 'billing_portal.session.created',
    objectId: customerId,
    createdGte: Math.floor(new Date(manifest.createdAt).getTime() / 1000) - 10,
  });
  const portalSessionId = String(portalEvent?.data?.object?.id || '');
  if (!portalSessionId.startsWith('bps_')) {
    throw new Error('Billing Portal verification did not expose an exact test session ID.');
  }
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(
      's2.portal_session',
      'stripe',
      'stripe_portal_session',
      portalSessionId,
      'none',
      'created',
      'not_applicable',
    ),
  );
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(
      's2.portal_session_event',
      'stripe',
      'stripe_event',
      portalEvent.id,
      'none',
      'created',
      'not_applicable',
    ),
  );
  await writeStripeManifest(manifestPath, manifest);

  await stripe.subscriptions.cancel(subscriptionId);
  const deletedEvent = await findStripeEvent(stripe, {
    type: 'customer.subscription.deleted',
    objectId: subscriptionId,
    createdGte: Math.floor(new Date(manifest.createdAt).getTime() / 1000) - 10,
  });
  await recordAndWaitForStripeEvent({
    supabase,
    manifest,
    manifestPath,
    event: deletedEvent,
    fixtureKey: 's2.subscription_deleted_event',
  });

  await waitFor(async () => {
    const row = await requireSingleRow(
      supabase,
      'subscriptions',
      `select=status&stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
      'canceled subscriptions projection',
    );
    return row.status === 'canceled' ? row : null;
  }, { description: 'the canceled subscription projection' });

  const canceledBilling = await supabase.invoke('billing-status', {
    jwt: ownerJwt,
    method: 'GET',
    query: `organization_id=${encodeURIComponent(organizationId)}`,
  });
  if (
    canceledBilling.status !== 200 ||
    canceledBilling.body?.status !== 'canceled' ||
    canceledBilling.body?.entitlementStatus !== 'owner_subscription_required' ||
    canceledBilling.body?.workspaceIncluded !== false
  ) {
    throw new Error('Canceled Stripe subscription did not revoke direct entitlement safely.');
  }

  manifest.phase = 's2_verified';
  manifest.evidence.s2 = {
    directMonthly: true,
    webhookCreated: true,
    billingStatusActive: true,
    portalOpened: true,
    webhookCanceled: true,
    billingStatusCanceled: true,
  };
  await writeStripeManifest(manifestPath, manifest);
  logger.log(
    `Verified Stripe S2 core lifecycle in ${maskProjectRef(config.projectRef)} ` +
    `(run ${maskUuid(manifest.runId)}).`,
  );
  return manifest.evidence.s2;
}

async function invokeUnsignedWebhook(config, event, signature) {
  const response = await fetch(`${config.functionsUrl}/stripe-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'stripe-signature': signature } : {}),
    },
    body: JSON.stringify(event),
  });
  return { status: response.status, text: await response.text() };
}

function assertSanitizedWebhookRejection(result, eventId) {
  if (result.status !== 400) throw new Error(`Expected sanitized webhook rejection, received HTTP ${result.status}.`);
  if (result.text.includes(eventId)) throw new Error('Webhook rejection echoed the supplied event ID.');
  if (/\b(?:sk|rk)_(?:test|live)_|\bwhsec_|\beyJ[A-Za-z0-9_-]+\.|stack|postgres|postgrest|sql/i.test(result.text)) {
    throw new Error('Webhook rejection exposed internal or secret-like details.');
  }
}

async function requireWebhookRow(supabase, eventId) {
  const result = await supabase.rest('GET', 'webhook_events', {
    query: `select=event_id,status&event_id=eq.${encodeURIComponent(eventId)}`,
  });
  if (!result.ok || !Array.isArray(result.body)) {
    throw new Error(`Webhook row verification failed with HTTP ${result.status}.`);
  }
  return result.body;
}

export async function verifyStripeSafetyLifecycle({
  stripe,
  supabase,
  config,
  manifest,
  manifestPath,
  logger = console,
}) {
  if (manifest.phase !== 's2_verified') {
    throw new Error('Stripe S3 safety verification requires a completed S2 lifecycle.');
  }
  const compactRunId = manifest.runId.replaceAll('-', '');
  const missingSignatureId = `evt_tp3dmissing${compactRunId}`;
  const invalidSignatureId = `evt_tp3dinvalid${compactRunId}`;
  const missingSignature = await invokeUnsignedWebhook(config, {
    id: missingSignatureId,
    object: 'event',
    type: 'tp3d.fixture.missing_signature',
    livemode: false,
    data: { object: { id: `obj_tp3dmissing${compactRunId}` } },
  });
  assertSanitizedWebhookRejection(missingSignature, missingSignatureId);

  const invalidSignature = await invokeUnsignedWebhook(config, {
    id: invalidSignatureId,
    object: 'event',
    type: 'tp3d.fixture.invalid_signature',
    livemode: false,
    data: { object: { id: `obj_tp3dinvalid${compactRunId}` } },
  }, `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`);
  assertSanitizedWebhookRejection(invalidSignature, invalidSignatureId);
  if ((await requireWebhookRow(supabase, missingSignatureId)).length !== 0) {
    throw new Error('Missing-signature probe created a webhook row.');
  }
  if ((await requireWebhookRow(supabase, invalidSignatureId)).length !== 0) {
    throw new Error('Invalid-signature probe created a webhook row.');
  }

  const replayEventId = objectId(manifest, 's2.subscription_deleted_event.stripe');
  const endpointId = objectId(manifest, 's1.webhook_endpoint');
  const replayBefore = await requireWebhookRow(supabase, replayEventId);
  if (replayBefore.length !== 1 || replayBefore[0].status !== 'processed') {
    throw new Error('S3 replay requires one previously processed webhook row.');
  }
  const before = {
    supabase: await captureDevelopmentFingerprints(supabase),
    stripe: await captureStripeFingerprints(stripe),
  };
  await execFileAsync('stripe', [
    'events',
    'resend',
    replayEventId,
    '--webhook-endpoint',
    endpointId,
    '--confirm',
    '--color',
    'off',
  ], {
    env: { ...process.env, STRIPE_API_KEY: config.stripeSecretKey },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  await waitFor(async () => {
    const rows = await requireWebhookRow(supabase, replayEventId);
    return rows.length === 1 && rows[0].status === 'processed' ? rows[0] : null;
  }, { attempts: 20, delayMs: 750, description: 'idempotent Stripe webhook replay' });
  const after = {
    supabase: await captureDevelopmentFingerprints(supabase),
    stripe: await captureStripeFingerprints(stripe),
  };
  const collateralDifferences = {
    supabase: compareDevelopmentFingerprints(before.supabase, after.supabase),
    stripe: compareStripeFingerprints(before.stripe, after.stripe),
  };
  if (collateralDifferences.supabase.length || collateralDifferences.stripe.length) {
    throw new Error('Stripe S3 safety checks changed fixture or non-fixture fingerprints.');
  }

  manifest.phase = 's3_verified';
  manifest.evidence.s3 = {
    missingSignatureRejected: true,
    invalidSignatureRejected: true,
    sanitizedErrors: true,
    rejectedEventsStored: false,
    signedReplayIdempotent: true,
    collateralDifferences,
  };
  await writeStripeManifest(manifestPath, manifest);
  logger.log(
    `Verified Stripe S3 safety lifecycle in ${maskProjectRef(config.projectRef)} ` +
    `(run ${maskUuid(manifest.runId)}).`,
  );
  return manifest.evidence.s3;
}
