import { createHash } from 'node:crypto';

import Stripe from 'stripe';

import { createDevelopmentApi } from './dev-invoke.mjs';

export function createStripeFixtureApis(config, { fetchImpl = globalThis.fetch } = {}) {
  const stripe = new Stripe(config.stripeSecretKey, { apiVersion: '2024-06-20' });
  const supabase = createDevelopmentApi(config, { fetchImpl });
  return { stripe, supabase };
}

function fingerprintIds(ids) {
  const normalized = [...ids].map(String).sort();
  return {
    count: normalized.length,
    sha256: createHash('sha256').update(normalized.join('\n')).digest('hex'),
  };
}

async function collectIds(iterable, excluded) {
  const ids = [];
  for await (const object of iterable) {
    const id = String(object?.id || '');
    if (id && !excluded.has(id)) ids.push(id);
  }
  return ids;
}

export async function captureStripeFingerprints(stripe, { excludedIds = new Set() } = {}) {
  const excluded = excludedIds instanceof Set ? excludedIds : new Set(excludedIds || []);
  const [customers, subscriptions, products, prices, coupons, schedules, clocks] = await Promise.all([
    collectIds(stripe.customers.list({ limit: 100 }), excluded),
    collectIds(stripe.subscriptions.list({ status: 'all', limit: 100 }), excluded),
    collectIds(stripe.products.list({ limit: 100 }), excluded),
    collectIds(stripe.prices.list({ limit: 100 }), excluded),
    collectIds(stripe.coupons.list({ limit: 100 }), excluded),
    collectIds(stripe.subscriptionSchedules.list({ limit: 100 }), excluded),
    collectIds(stripe.testHelpers.testClocks.list({ limit: 100 }), excluded),
  ]);
  return {
    customers: fingerprintIds(customers),
    subscriptions: fingerprintIds(subscriptions),
    products: fingerprintIds(products),
    prices: fingerprintIds(prices),
    coupons: fingerprintIds(coupons),
    schedules: fingerprintIds(schedules),
    test_clocks: fingerprintIds(clocks),
  };
}

export function compareStripeFingerprints(before, after) {
  const differences = [];
  for (const [key, left] of Object.entries(before || {})) {
    const right = after?.[key];
    if (!right || left.count !== right.count || left.sha256 !== right.sha256) differences.push(key);
  }
  return differences;
}

export async function waitFor(
  probe,
  { attempts = 20, delayMs = 750, description = 'condition' } = {},
) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

export async function waitForSignupGraph(supabase, userId) {
  return waitFor(async () => {
    const memberships = await supabase.rest('GET', 'organization_members', {
      query: `select=id,organization_id,user_id,role&user_id=eq.${encodeURIComponent(userId)}&role=eq.owner`,
    });
    const profiles = await supabase.rest('GET', 'profiles', {
      query: `select=id,current_organization_id&id=eq.${encodeURIComponent(userId)}`,
    });
    if (!memberships.ok || !profiles.ok || memberships.body?.length !== 1 || profiles.body?.length !== 1) {
      return null;
    }
    const membership = memberships.body[0];
    const organizationId = String(membership.organization_id || '');
    const organizations = await supabase.rest('GET', 'organizations', {
      query: `select=id,owner_id,created_at,archived_at&id=eq.${encodeURIComponent(organizationId)}`,
    });
    const billing = await supabase.rest('GET', 'billing_customers', {
      query: `select=id,organization_id,status,trial_ends_at,stripe_customer_id,stripe_subscription_id&organization_id=eq.${encodeURIComponent(organizationId)}`,
    });
    if (!organizations.ok || !billing.ok || organizations.body?.length !== 1 || billing.body?.length !== 1) {
      return null;
    }
    return {
      profile: profiles.body[0],
      membership,
      organization: organizations.body[0],
      billing: billing.body[0],
    };
  }, { description: 'the disposable signup graph' });
}
