import { captureDevelopmentFingerprints, compareDevelopmentFingerprints } from './dev-invoke.mjs';
import { maskProjectRef, maskUuid } from './mask.mjs';
import {
  captureStripeFingerprints,
  compareStripeFingerprints,
  waitFor,
} from './stripe-invoke.mjs';
import {
  addStripeManifestObject,
  findStripeManifestObjects,
  stripeFixtureObject,
  writeStripeManifest,
} from './stripe-manifest.mjs';

const SUPABASE_CLEANUP_ORDER = Object.freeze([
  ['webhook_event', 'webhook_events', 'event_id'],
  ['subscription_projection', 'subscriptions', 'id'],
  ['billing_customer_projection', 'billing_customers', 'id'],
  ['stripe_customer_projection', 'stripe_customers', 'id'],
  ['organization_membership', 'organization_members', 'id'],
  ['organization', 'organizations', 'id'],
  ['profile', 'profiles', 'id'],
]);

function resourceMissing(error) {
  return error?.statusCode === 404 || error?.code === 'resource_missing';
}

function ownedStripeIds(manifest) {
  return new Set(
    manifest.objects
      .filter(object => object.system === 'stripe' && object.objectType !== 'stripe_account')
      .map(object => object.exactId),
  );
}

function eventBelongsToRun(event, manifest, ids) {
  const object = event?.data?.object || {};
  const metadata = object.metadata || {};
  if (metadata.tp3d_fixture_run_id === manifest.runId) return true;
  const candidates = [
    object.id,
    object.customer,
    object.subscription,
    object.payment_method,
    object.schedule,
    object.price?.id,
    object.plan?.id,
    object.lines?.data?.[0]?.price?.id,
  ];
  return candidates.some(id => id && ids.has(String(id)));
}

function hasManifestObject(manifest, system, objectType, exactId) {
  return manifest.objects.some(object =>
    object.system === system && object.objectType === objectType && object.exactId === String(exactId));
}

function captureSupabaseObject(manifest, fixtureKey, objectType, exactId) {
  if (!exactId || hasManifestObject(manifest, 'supabase', objectType, exactId)) return false;
  addStripeManifestObject(
    manifest,
    stripeFixtureObject(fixtureKey, 'supabase', objectType, exactId, 'delete'),
  );
  return true;
}

async function captureOwnedSupabaseGraph({ supabase, manifest, manifestPath }) {
  let captured = 0;
  for (const user of manifest.objects.filter(object =>
    object.system === 'supabase' && object.objectType === 'auth_user')) {
    const userId = user.exactId;
    const [profiles, memberships, ownedOrganizations, stripeCustomers] = await Promise.all([
      supabase.rest('GET', 'profiles', {
        query: `select=id,current_organization_id&id=eq.${encodeURIComponent(userId)}`,
      }),
      supabase.rest('GET', 'organization_members', {
        query: `select=id,organization_id&user_id=eq.${encodeURIComponent(userId)}`,
      }),
      supabase.rest('GET', 'organizations', {
        query: `select=id&owner_id=eq.${encodeURIComponent(userId)}`,
      }),
      supabase.rest('GET', 'stripe_customers', {
        query: `select=id&user_id=eq.${encodeURIComponent(userId)}`,
      }),
    ]);
    for (const result of [profiles, memberships, ownedOrganizations, stripeCustomers]) {
      if (!result.ok || !Array.isArray(result.body)) {
        throw new Error('Exact fixture graph recovery query failed.');
      }
    }
    for (const profile of profiles.body) {
      captured += Number(captureSupabaseObject(
        manifest,
        `recovery.profile.${profile.id}`,
        'profile',
        profile.id,
      ));
    }
    for (const membership of memberships.body) {
      captured += Number(captureSupabaseObject(
        manifest,
        `recovery.membership.${membership.id}`,
        'organization_membership',
        membership.id,
      ));
    }
    for (const customer of stripeCustomers.body) {
      captured += Number(captureSupabaseObject(
        manifest,
        `recovery.stripe_customer.${customer.id}`,
        'stripe_customer_projection',
        customer.id,
      ));
    }
    const organizationIds = new Set([
      ...profiles.body.map(profile => profile.current_organization_id),
      ...memberships.body.map(membership => membership.organization_id),
      ...ownedOrganizations.body.map(organization => organization.id),
    ].filter(Boolean).map(String));
    for (const organizationId of organizationIds) {
      const [organizations, billingCustomers, subscriptions] = await Promise.all([
        supabase.rest('GET', 'organizations', {
          query: `select=id&id=eq.${encodeURIComponent(organizationId)}`,
        }),
        supabase.rest('GET', 'billing_customers', {
          query: `select=id&organization_id=eq.${encodeURIComponent(organizationId)}`,
        }),
        supabase.rest('GET', 'subscriptions', {
          query: `select=id&organization_id=eq.${encodeURIComponent(organizationId)}`,
        }),
      ]);
      for (const result of [organizations, billingCustomers, subscriptions]) {
        if (!result.ok || !Array.isArray(result.body)) {
          throw new Error('Exact fixture organization recovery query failed.');
        }
      }
      for (const organization of organizations.body) {
        captured += Number(captureSupabaseObject(
          manifest,
          `recovery.organization.${organization.id}`,
          'organization',
          organization.id,
        ));
      }
      for (const billing of billingCustomers.body) {
        captured += Number(captureSupabaseObject(
          manifest,
          `recovery.billing_customer.${billing.id}`,
          'billing_customer_projection',
          billing.id,
        ));
      }
      for (const subscription of subscriptions.body) {
        captured += Number(captureSupabaseObject(
          manifest,
          `recovery.subscription.${subscription.id}`,
          'subscription_projection',
          subscription.id,
        ));
      }
    }
  }
  if (captured) await writeStripeManifest(manifestPath, manifest);
  return captured;
}

async function captureOwnedStripeEvents({ stripe, manifest, manifestPath }) {
  const ids = ownedStripeIds(manifest);
  const created = Math.floor(new Date(manifest.createdAt).getTime() / 1000) - 10;
  let captured = 0;
  for await (const event of stripe.events.list({ created: { gte: created }, limit: 100 })) {
    if (!eventBelongsToRun(event, manifest, ids)) continue;
    const existingStripe = manifest.objects.some(
      object => object.system === 'stripe' && object.objectType === 'stripe_event' && object.exactId === event.id,
    );
    if (!existingStripe) {
      addStripeManifestObject(
        manifest,
        stripeFixtureObject(
          `event.${event.id}.stripe`,
          'stripe',
          'stripe_event',
          event.id,
          'none',
          'created',
          'not_applicable',
        ),
      );
      captured += 1;
    }
    const existingSupabase = manifest.objects.some(
      object => object.system === 'supabase' && object.objectType === 'webhook_event' && object.exactId === event.id,
    );
    if (!existingSupabase) {
      addStripeManifestObject(
        manifest,
        stripeFixtureObject(`event.${event.id}.supabase`, 'supabase', 'webhook_event', event.id, 'delete'),
      );
      captured += 1;
    }
  }
  if (captured) await writeStripeManifest(manifestPath, manifest);
  return captured;
}

async function settleOwnedStripeEvents({ stripe, manifest, manifestPath }) {
  let previousCount = -1;
  let stablePolls = 0;
  await waitFor(async () => {
    await captureOwnedStripeEvents({ stripe, manifest, manifestPath });
    const count = findStripeManifestObjects(manifest, 'stripe_event').length;
    stablePolls = count === previousCount ? stablePolls + 1 : 0;
    previousCount = count;
    return stablePolls >= 2 ? true : null;
  }, { attempts: 10, delayMs: 500, description: 'fixture-owned Stripe events to settle' });
}

async function cleanupStripeObject(stripe, object) {
  try {
    if (object.objectType === 'stripe_schedule') {
      const schedule = await stripe.subscriptionSchedules.retrieve(object.exactId);
      if (!['canceled', 'completed', 'released'].includes(schedule.status)) {
        await stripe.subscriptionSchedules.cancel(object.exactId);
      }
      return 'terminal';
    }
    if (object.objectType === 'stripe_subscription') {
      const subscription = await stripe.subscriptions.retrieve(object.exactId);
      if (subscription.status !== 'canceled') await stripe.subscriptions.cancel(object.exactId);
      return 'terminal';
    }
    if (object.objectType === 'stripe_payment_method') {
      const paymentMethod = await stripe.paymentMethods.retrieve(object.exactId);
      if (paymentMethod.customer) await stripe.paymentMethods.detach(object.exactId);
      return 'detached';
    }
    if (object.objectType === 'stripe_checkout_session') {
      const session = await stripe.checkout.sessions.retrieve(object.exactId);
      if (session.status === 'open') await stripe.checkout.sessions.expire(object.exactId);
      return 'terminal';
    }
    if (object.objectType === 'stripe_customer') {
      const customer = await stripe.customers.retrieve(object.exactId);
      if (!customer.deleted) await stripe.customers.del(object.exactId);
      return 'absent';
    }
    if (object.objectType === 'stripe_coupon') {
      await stripe.coupons.del(object.exactId);
      return 'absent';
    }
    if (object.objectType === 'stripe_price') {
      const price = await stripe.prices.retrieve(object.exactId);
      if (price.active) await stripe.prices.update(object.exactId, { active: false });
      return 'archived';
    }
    if (object.objectType === 'stripe_product') {
      const product = await stripe.products.retrieve(object.exactId);
      if (product.active) await stripe.products.update(object.exactId, { active: false });
      return 'archived';
    }
    if (object.objectType === 'stripe_test_clock') {
      await stripe.testHelpers.testClocks.del(object.exactId);
      return 'absent';
    }
    if (['stripe_event', 'stripe_portal_session'].includes(object.objectType)) return 'not_applicable';
    return object.cleanupState;
  } catch (error) {
    if (resourceMissing(error)) return 'absent';
    throw error;
  }
}

async function supabaseObjectExists(supabase, table, column, exactId) {
  const result = await supabase.rest('GET', table, {
    query: `select=${column}&${column}=eq.${encodeURIComponent(exactId)}`,
  });
  return result.ok && Array.isArray(result.body) && result.body.length > 0;
}

async function deleteSupabaseObject(supabase, table, column, exactId) {
  if (!(await supabaseObjectExists(supabase, table, column, exactId))) return 'absent';
  const result = await supabase.rest('DELETE', table, {
    query: `${column}=eq.${encodeURIComponent(exactId)}`,
    prefer: 'return=minimal',
  });
  if (!result.ok || await supabaseObjectExists(supabase, table, column, exactId)) {
    throw new Error(`Exact-ID cleanup failed for ${table}.`);
  }
  return 'absent';
}

export async function cleanupStripeFixtures({
  stripe,
  supabase,
  config,
  manifest,
  manifestPath,
  logger = console,
}) {
  const failures = [];
  let alreadyAbsent = 0;

  await captureOwnedSupabaseGraph({ supabase, manifest, manifestPath });

  const stripeOrder = [
    'stripe_schedule',
    'stripe_subscription',
    'stripe_payment_method',
    'stripe_checkout_session',
    'stripe_customer',
    'stripe_coupon',
    'stripe_price',
    'stripe_product',
    'stripe_test_clock',
    'stripe_portal_session',
    'stripe_event',
  ];
  for (const objectType of stripeOrder) {
    for (const object of manifest.objects.filter(
      entry => entry.system === 'stripe' && entry.objectType === objectType,
    )) {
      try {
        const previous = object.cleanupState;
        object.cleanupState = await cleanupStripeObject(stripe, object);
        if (previous === 'absent' && object.cleanupState === 'absent') alreadyAbsent += 1;
      } catch {
        object.cleanupState = 'failed';
        failures.push(object.fixtureKey);
      }
      await writeStripeManifest(manifestPath, manifest);
    }
  }

  await settleOwnedStripeEvents({ stripe, manifest, manifestPath });

  for (const [objectType, table, column] of SUPABASE_CLEANUP_ORDER) {
    for (const object of manifest.objects.filter(
      entry => entry.system === 'supabase' && entry.objectType === objectType,
    )) {
      try {
        const existed = await supabaseObjectExists(supabase, table, column, object.exactId);
        object.cleanupState = await deleteSupabaseObject(supabase, table, column, object.exactId);
        if (!existed) alreadyAbsent += 1;
      } catch {
        object.cleanupState = 'failed';
        failures.push(object.fixtureKey);
      }
      await writeStripeManifest(manifestPath, manifest);
    }
  }

  for (const object of manifest.objects.filter(
    entry => entry.system === 'supabase' && entry.objectType === 'auth_user',
  )) {
    const result = await supabase.adminDeleteUser(object.exactId);
    if (result.ok || result.status === 404 || result.status === 422) {
      object.cleanupState = 'absent';
      if (!result.ok) alreadyAbsent += 1;
    } else {
      object.cleanupState = 'failed';
      failures.push(object.fixtureKey);
    }
    await writeStripeManifest(manifestPath, manifest);
  }

  const excludedIds = ownedStripeIds(manifest);
  const after = {
    supabase: await captureDevelopmentFingerprints(supabase),
    stripe: await captureStripeFingerprints(stripe, { excludedIds }),
  };
  const collateralDifferences = {
    supabase: compareDevelopmentFingerprints(manifest.baseline?.supabase, after.supabase),
    stripe: compareStripeFingerprints(manifest.baseline?.stripe, after.stripe),
  };
  manifest.evidence.cleanup = {
    alreadyAbsent,
    failures: failures.length,
    collateralDifferences,
    after,
  };
  manifest.phase = failures.length || collateralDifferences.supabase.length || collateralDifferences.stripe.length
    ? 'cleanup_failed'
    : 'cleaned';
  await writeStripeManifest(manifestPath, manifest);

  if (manifest.phase !== 'cleaned') {
    throw new Error(
      `Cleanup failed: ${failures.length} exact-ID removal failure(s), ` +
      `${collateralDifferences.supabase.length} Supabase and ` +
      `${collateralDifferences.stripe.length} Stripe collateral fingerprint difference(s).`,
    );
  }
  logger.log(
    `Cleaned exact Stripe fixture IDs in ${maskProjectRef(config.projectRef)} ` +
    `(run ${maskUuid(manifest.runId)}; already absent ${alreadyAbsent}).`,
  );
  return { cleaned: true, alreadyAbsent, collateralDifferences };
}
