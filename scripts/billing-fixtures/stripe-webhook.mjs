import {
  addStripeManifestObject,
  stripeFixtureObject,
  writeStripeManifest,
} from './stripe-manifest.mjs';
import {
  captureStripeFingerprints,
  compareStripeFingerprints,
  waitFor,
} from './stripe-invoke.mjs';
import {
  captureDevelopmentFingerprints,
  compareDevelopmentFingerprints,
} from './dev-invoke.mjs';

export const REQUIRED_STRIPE_WEBHOOK_EVENTS = Object.freeze([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.deleted',
  'customer.subscription.updated',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
]);

export const STRIPE_SIGNED_PROBE_EVENT = 'test_helpers.test_clock.created';

function eventMatchesObject(event, objectId) {
  const object = event?.data?.object || {};
  return [object.id, object.subscription, object.customer].map(String).includes(String(objectId));
}

export async function findStripeEvent(stripe, { type, objectId, createdGte }) {
  return waitFor(async () => {
    const events = await stripe.events.list({ type, created: { gte: createdGte }, limit: 100 });
    return events.data.find(event => eventMatchesObject(event, objectId)) || null;
  }, { attempts: 24, delayMs: 750, description: `${type} Stripe event` });
}

async function findDevelopmentWebhookEndpoint(stripe, expectedUrl) {
  const matches = [];
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === expectedUrl) matches.push(endpoint);
  }
  if (matches.length !== 1 || matches[0].status !== 'enabled') {
    throw new Error('Expected exactly one enabled Stripe test webhook destination for development.');
  }
  return matches[0];
}

function normalizedEvents(events) {
  return [...new Set(events)].sort();
}

async function waitForEnabledEvents(stripe, endpointId, expectedEvents) {
  const expected = normalizedEvents(expectedEvents);
  return waitFor(async () => {
    const endpoint = await stripe.webhookEndpoints.retrieve(endpointId);
    const actual = normalizedEvents(endpoint.enabled_events || []);
    return JSON.stringify(actual) === JSON.stringify(expected) ? endpoint : null;
  }, { attempts: 20, delayMs: 500, description: 'Stripe webhook event configuration' });
}

async function findStoredWebhookEvent(supabase, eventId) {
  const result = await supabase.rest('GET', 'webhook_events', {
    query: `select=event_id,status&event_id=eq.${encodeURIComponent(eventId)}`,
  });
  if (!result.ok || !Array.isArray(result.body)) return null;
  return result.body.length === 1 ? result.body[0] : null;
}

async function deleteStoredWebhookEvent(supabase, eventId) {
  const result = await supabase.rest('DELETE', 'webhook_events', {
    query: `event_id=eq.${encodeURIComponent(eventId)}`,
    prefer: 'return=minimal',
  });
  if (!result.ok) throw new Error(`Exact webhook-event cleanup failed with HTTP ${result.status}.`);
  if (await findStoredWebhookEvent(supabase, eventId)) {
    throw new Error('Exact webhook-event cleanup did not remove the stored event.');
  }
}

export async function recordAndWaitForStripeEvent({
  supabase,
  manifest,
  manifestPath,
  event,
  fixtureKey,
}) {
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(`${fixtureKey}.stripe`, 'stripe', 'stripe_event', event.id, 'none', 'created', 'not_applicable'),
  );
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(`${fixtureKey}.supabase`, 'supabase', 'webhook_event', event.id, 'delete'),
  );
  await writeStripeManifest(manifestPath, manifest);
  return waitFor(async () => {
    const stored = await findStoredWebhookEvent(supabase, event.id);
    return stored?.status === 'processed' ? stored : null;
  }, { attempts: 40, delayMs: 750, description: `${event.type} development webhook delivery` });
}

async function recordAndWaitForIgnoredStripeEvent({
  stripe,
  supabase,
  manifest,
  manifestPath,
  event,
  fixtureKey,
}) {
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(
      `${fixtureKey}.stripe`,
      'stripe',
      'stripe_event',
      event.id,
      'none',
      'created',
      'not_applicable',
    ),
  );
  await writeStripeManifest(manifestPath, manifest);

  const stored = await waitFor(async () => {
    const row = await findStoredWebhookEvent(supabase, event.id);
    return row?.status === 'processed' ? row : null;
  }, { attempts: 40, delayMs: 750, description: `${event.type} accepted development webhook delivery` });
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(`${fixtureKey}.supabase`, 'supabase', 'webhook_event', event.id, 'delete'),
  );
  await writeStripeManifest(manifestPath, manifest);
  return stored;
}

export async function runStripeSignedWebhookProbe({
  stripe,
  supabase,
  config,
  manifest,
  manifestPath,
}) {
  const expectedUrl = `${config.functionsUrl}/stripe-webhook`;
  const endpoint = await findDevelopmentWebhookEndpoint(stripe, expectedUrl);
  const originalEvents = normalizedEvents(endpoint.enabled_events || []);
  const requiredEvents = normalizedEvents([...originalEvents, ...REQUIRED_STRIPE_WEBHOOK_EVENTS]);
  const temporaryEvents = normalizedEvents([...requiredEvents, STRIPE_SIGNED_PROBE_EVENT]);
  const before = {
    supabase: await captureDevelopmentFingerprints(supabase),
    stripe: await captureStripeFingerprints(stripe),
  };

  addStripeManifestObject(
    manifest,
    stripeFixtureObject(
      's1.webhook_endpoint',
      'stripe',
      'stripe_webhook_endpoint',
      endpoint.id,
      'none',
      'verified',
      'not_applicable',
    ),
  );
  await writeStripeManifest(manifestPath, manifest);

  let clock = null;
  let event = null;
  let accepted = false;
  let primaryError = null;
  const cleanupErrors = [];
  try {
    await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: temporaryEvents });
    await waitForEnabledEvents(stripe, endpoint.id, temporaryEvents);

    clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: `tp3d-s1-${manifest.runId.slice(0, 8)}`,
    });
    addStripeManifestObject(
      manifest,
      stripeFixtureObject('s1.test_clock', 'stripe', 'stripe_test_clock', clock.id, 'delete'),
    );
    await writeStripeManifest(manifestPath, manifest);

    event = await findStripeEvent(stripe, {
      type: STRIPE_SIGNED_PROBE_EVENT,
      objectId: clock.id,
      createdGte: Math.floor(new Date(manifest.createdAt).getTime() / 1000) - 10,
    });
    await recordAndWaitForIgnoredStripeEvent({
      stripe,
      supabase,
      manifest,
      manifestPath,
      event,
      fixtureKey: 's1.webhook_signing_probe',
    });
    accepted = true;
  } catch (error) {
    primaryError = error;
  } finally {
    if (event) {
      try {
        if (await findStoredWebhookEvent(supabase, event.id)) {
          await deleteStoredWebhookEvent(supabase, event.id);
          const storedObject = manifest.objects.find(object =>
            object.fixtureKey === 's1.webhook_signing_probe.supabase');
          if (storedObject) storedObject.cleanupState = 'absent';
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (clock) {
      try {
        await stripe.testHelpers.testClocks.del(clock.id);
        const clockObject = manifest.objects.find(object => object.fixtureKey === 's1.test_clock');
        if (clockObject) clockObject.cleanupState = 'absent';
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      const finalEvents = accepted ? requiredEvents : originalEvents;
      await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: finalEvents });
      await waitForEnabledEvents(stripe, endpoint.id, finalEvents);
    } catch (error) {
      cleanupErrors.push(error);
    }
    await writeStripeManifest(manifestPath, manifest);
  }

  if (primaryError || cleanupErrors.length) {
    throw new Error(
      `Stripe-signed webhook probe failed with ${primaryError ? 1 : 0} delivery ` +
      `and ${cleanupErrors.length} cleanup/configuration error(s).`,
      { cause: primaryError || cleanupErrors[0] },
    );
  }

  const after = {
    supabase: await captureDevelopmentFingerprints(supabase),
    stripe: await captureStripeFingerprints(stripe),
  };
  const collateralDifferences = {
    supabase: compareDevelopmentFingerprints(before.supabase, after.supabase),
    stripe: compareStripeFingerprints(before.stripe, after.stripe),
  };
  if (collateralDifferences.supabase.length || collateralDifferences.stripe.length) {
    throw new Error('Stripe-signed webhook probe left unexpected persistent residue.');
  }

  return {
    accepted: true,
    eventId: event.id,
    endpointId: endpoint.id,
    requiredEventsAdded: requiredEvents.filter(type => !originalEvents.includes(type)),
    collateralDifferences,
  };
}
