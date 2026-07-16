import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

const catalogPath = new URL('../../supabase/functions/_shared/billing-catalog.ts', import.meta.url);
const billingStatusPath = new URL('../../supabase/functions/billing-status/index.ts', import.meta.url);
const restorePath = new URL('../../supabase/functions/org-restore-workspace/index.ts', import.meta.url);
const checkoutPath = new URL('../../supabase/functions/stripe-create-checkout-session/index.ts', import.meta.url);
const portalPath = new URL('../../supabase/functions/stripe-create-portal-session/index.ts', import.meta.url);
const webhookPath = new URL('../../supabase/functions/stripe-webhook/index.ts', import.meta.url);
const stripeSharedPath = new URL('../../supabase/functions/_shared/stripe.ts', import.meta.url);

const DEFAULT_ENV = {
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_month',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_year',
  STRIPE_PRICE_BUSINESS_MONTHLY: 'price_business_month',
  STRIPE_PRICE_BUSINESS_YEARLY: 'price_business_year',
  STRIPE_PRICE_PRO_MONTHLY_LEGACY: 'price_pro_legacy_month, price_pro_legacy_month_2',
  STRIPE_PRICE_PRO_YEARLY_LEGACY: 'price_pro_legacy_year',
  STRIPE_PRICE_BUSINESS_MONTHLY_LEGACY: 'price_business_legacy_month',
  STRIPE_PRICE_BUSINESS_YEARLY_LEGACY: 'price_business_legacy_year',
  TP3D_TRIAL_WORKSPACE_LIMIT: '1',
  TP3D_PRO_WORKSPACE_LIMIT: '3',
  TP3D_BUSINESS_WORKSPACE_LIMIT: '10',
};

async function loadCatalog(overrides = {}) {
  const source = await fs.readFile(catalogPath, 'utf8');
  const env = new Map(Object.entries({ ...DEFAULT_ENV, ...overrides }));
  const exportedNames = [
    'getBillingCatalog',
    'workspaceLimitForTier',
    'configuredBusinessPriceIds',
    'resolveRecognizedTierByPriceId',
    'isKnownPriceId',
    'isLegacyPriceId',
    'isCheckoutEnabledPriceId',
    'workspaceLimitForPrice',
    'workspaceLimitForEntitlement',
    'workspaceLimitForRestoreCandidate',
    'normalizeBillingInterval',
    'normalizeCheckoutInterval',
    'resolveConfiguredPriceInterval',
    'allowedCheckoutPriceIds',
    'resolveCheckoutPrice',
    'assertAllowedCheckoutPrice',
  ];
  const executable = `${source.replace(/^export\s+/gm, '')}\n` +
    `globalThis.__catalog = { ${exportedNames.join(', ')} };`;
  const sandbox = {
    Deno: { env: { get: key => env.get(key) } },
    Array,
    Error,
    Map,
    Number,
    Set,
    String,
  };
  vm.runInNewContext(stripTypeScriptTypes(executable, { mode: 'strip' }), sandbox);
  return {
    ...sandbox.__catalog,
    setEnv(name, value) {
      if (typeof value === 'undefined') env.delete(name);
      else env.set(name, value);
    },
  };
}

test('BILLING-CATALOG-1 configured Pro and Business prices keep their current workspace limits', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.workspaceLimitForPrice('price_pro_month'), 3);
  assert.equal(catalog.workspaceLimitForPrice('price_pro_year'), 3);
  assert.equal(catalog.workspaceLimitForPrice('price_business_month'), 10);
  assert.equal(catalog.workspaceLimitForPrice('price_business_year'), 10);
  assert.deepEqual(Array.from(catalog.configuredBusinessPriceIds()), [
    'price_business_month',
    'price_business_year',
  ]);
  assert.equal(catalog.isKnownPriceId('price_pro_month'), true);
  assert.equal(catalog.isKnownPriceId('price_pro_year'), true);
  assert.equal(catalog.isKnownPriceId('price_business_month'), true);
  assert.equal(catalog.isKnownPriceId('price_business_year'), true);
  assert.equal(catalog.isLegacyPriceId('price_business_month'), false);
});

test('BILLING-CATALOG-2 unknown active prices keep the Pro/base-paid fallback and trial keeps its limit', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.workspaceLimitForPrice('price_unknown_active'), 3);
  assert.equal(catalog.workspaceLimitForEntitlement('active', 'price_unknown_active'), 3);
  assert.equal(catalog.workspaceLimitForEntitlement('trialing', 'price_unknown_active'), 1);
  assert.equal(catalog.isKnownPriceId('price_unknown_active'), false);
  assert.equal(catalog.resolveRecognizedTierByPriceId('price_unknown_active'), null);
});

test('BILLING-CATALOG-3 empty price variables are ignored and environment reads stay lazy', async () => {
  const catalog = await loadCatalog({
    STRIPE_PRICE_PRO_MONTHLY: '',
    STRIPE_PRICE_BUSINESS_MONTHLY: '   ',
    STRIPE_PRICE_BUSINESS_YEARLY: '',
  });
  assert.deepEqual(Array.from(catalog.allowedCheckoutPriceIds()), ['price_pro_year']);
  assert.deepEqual(Array.from(catalog.configuredBusinessPriceIds()), []);
  catalog.setEnv('STRIPE_PRICE_PRO_MONTHLY', 'price_pro_month_late');
  assert.equal(catalog.resolveCheckoutPrice('pro', 'month'), 'price_pro_month_late');
});

test('BILLING-CATALOG-4 missing Pro checkout configuration preserves the empty resolution used by the current 400 response', async () => {
  const monthlyMissing = await loadCatalog({ STRIPE_PRICE_PRO_MONTHLY: '' });
  const yearlyMissing = await loadCatalog({ STRIPE_PRICE_PRO_YEARLY: '' });
  assert.equal(monthlyMissing.resolveCheckoutPrice('pro', 'month'), '');
  assert.equal(yearlyMissing.resolveCheckoutPrice('pro', 'year'), '');
  assert.throws(
    () => monthlyMissing.assertAllowedCheckoutPrice(''),
    error => error?.message === 'Invalid price_id' && error?.status === 400,
  );
});

test('BILLING-CATALOG-5 checkout allow-list contains only configured Pro prices', async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(Array.from(catalog.allowedCheckoutPriceIds()), [
    'price_pro_month',
    'price_pro_year',
  ]);
  assert.equal(catalog.resolveCheckoutPrice('pro', 'month'), 'price_pro_month');
  assert.equal(catalog.resolveCheckoutPrice('pro', 'year'), 'price_pro_year');
  assert.equal(catalog.resolveCheckoutPrice('business', 'month'), '');
  assert.doesNotThrow(() => catalog.assertAllowedCheckoutPrice('price_pro_month'));
  assert.doesNotThrow(() => catalog.assertAllowedCheckoutPrice('price_pro_year'));
  assert.throws(() => catalog.assertAllowedCheckoutPrice('price_business_month'));
  assert.throws(() => catalog.assertAllowedCheckoutPrice('price_pro_legacy_month'));
  assert.throws(() => catalog.assertAllowedCheckoutPrice('price_business_legacy_year'));
  assert.throws(() => catalog.assertAllowedCheckoutPrice('price_unknown'));
  assert.equal(catalog.isCheckoutEnabledPriceId('price_pro_month'), true);
  assert.equal(catalog.isCheckoutEnabledPriceId('price_pro_legacy_month'), false);
});

test('BILLING-CATALOG-6 invalid workspace-limit environment values retain current defaults', async () => {
  const catalog = await loadCatalog({
    TP3D_TRIAL_WORKSPACE_LIMIT: '0',
    TP3D_PRO_WORKSPACE_LIMIT: '-2',
    TP3D_BUSINESS_WORKSPACE_LIMIT: 'not-a-number',
  });
  assert.equal(catalog.workspaceLimitForTier('trial'), 1);
  assert.equal(catalog.workspaceLimitForTier('pro'), 3);
  assert.equal(catalog.workspaceLimitForTier('business'), 10);
});

test('BILLING-CATALOG-7 duplicate configured prices are deterministic without opening a new checkout tier', async () => {
  const catalog = await loadCatalog({
    STRIPE_PRICE_PRO_MONTHLY: 'price_duplicate',
    STRIPE_PRICE_PRO_YEARLY: 'price_duplicate',
    STRIPE_PRICE_BUSINESS_MONTHLY: 'price_duplicate',
    STRIPE_PRICE_BUSINESS_YEARLY: 'price_duplicate',
  });
  assert.deepEqual(Array.from(catalog.allowedCheckoutPriceIds()), ['price_duplicate']);
  assert.equal(catalog.resolveConfiguredPriceInterval('price_duplicate'), 'month');
  assert.equal(catalog.workspaceLimitForPrice('price_duplicate'), 10,
    'billing-status exact Business recognition remains independent from checkout eligibility');
  assert.equal(catalog.resolveCheckoutPrice('business', 'month'), '');
});

test('BILLING-CATALOG-8 billing and checkout interval normalization retain their caller-specific behavior', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.normalizeBillingInterval('month'), 'month');
  assert.equal(catalog.normalizeBillingInterval('year'), 'year');
  assert.equal(catalog.normalizeBillingInterval(' MONTH '), null);
  assert.equal(catalog.normalizeCheckoutInterval(' MONTH '), 'month');
  assert.equal(catalog.normalizeCheckoutInterval('Year'), 'year');
  assert.equal(catalog.normalizeCheckoutInterval('weekly'), null);
  assert.equal(catalog.normalizeCheckoutInterval(''), null);
});

test('BILLING-CATALOG-9 restore resolver preserves its broader Business detection drift', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.workspaceLimitForRestoreCandidate('price_pro_month', 'pro', 'active'), 3);
  assert.equal(catalog.workspaceLimitForRestoreCandidate('legacy_business_price', 'pro', 'active'), 10);
  assert.equal(catalog.workspaceLimitForRestoreCandidate('legacy_price', 'Business Legacy', 'active'), 10);
  assert.equal(catalog.workspaceLimitForRestoreCandidate('legacy_business_price', 'business', 'trialing'), 1);
  assert.equal(catalog.workspaceLimitForRestoreCandidate('price_pro_legacy_year', 'business', 'active'), 3,
    'explicit legacy Pro recognition wins over broader plan-name drift');
  assert.equal(catalog.workspaceLimitForRestoreCandidate('price_business_legacy_month', 'pro', 'active'), 10);
  assert.equal(catalog.workspaceLimitForRestoreCandidate('price_unknown_plain', 'pro', 'active'), 3);
});

test('BILLING-CATALOG-10 legacy recognition is tiered, interval-aware, lazy, and separate from checkout', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.resolveRecognizedTierByPriceId('price_pro_legacy_month'), 'pro');
  assert.equal(catalog.resolveRecognizedTierByPriceId('price_business_legacy_year'), 'business');
  assert.equal(catalog.workspaceLimitForPrice('price_pro_legacy_year'), 3);
  assert.equal(catalog.workspaceLimitForPrice('price_business_legacy_month'), 10);
  assert.equal(catalog.resolveConfiguredPriceInterval('price_pro_legacy_month_2'), 'month');
  assert.equal(catalog.resolveConfiguredPriceInterval('price_pro_legacy_year'), 'year');
  assert.equal(catalog.isLegacyPriceId('price_pro_legacy_month'), true);
  assert.equal(catalog.isLegacyPriceId('price_business_legacy_year'), true);

  catalog.setEnv('STRIPE_PRICE_BUSINESS_MONTHLY_LEGACY', 'price_pro_month');
  assert.equal(catalog.resolveRecognizedTierByPriceId('price_pro_month'), 'pro',
    'a recognition-only legacy list cannot steal a current Price from its active tier');
  assert.equal(catalog.isLegacyPriceId('price_pro_month'), false);

  catalog.setEnv('STRIPE_PRICE_PRO_MONTHLY_LEGACY', ' price_late_legacy,price_late_legacy ');
  assert.equal(catalog.isKnownPriceId('price_late_legacy'), true, 'legacy environment reads stay lazy');
  assert.equal(catalog.isCheckoutEnabledPriceId('price_late_legacy'), false);
});

test('BILLING-CATALOG-11 consumers own no direct catalog environment reads and billing adds only the safe diagnostic', async () => {
  const [catalogSource, billingSource, restoreSource, checkoutSource] = await Promise.all([
    fs.readFile(catalogPath, 'utf8'),
    fs.readFile(billingStatusPath, 'utf8'),
    fs.readFile(restorePath, 'utf8'),
    fs.readFile(checkoutPath, 'utf8'),
  ]);
  const catalogEnvNames = [
    'STRIPE_PRICE_PRO_MONTHLY',
    'STRIPE_PRICE_PRO_YEARLY',
    'STRIPE_PRICE_BUSINESS_MONTHLY',
    'STRIPE_PRICE_BUSINESS_YEARLY',
    'STRIPE_PRICE_PRO_MONTHLY_LEGACY',
    'STRIPE_PRICE_PRO_YEARLY_LEGACY',
    'STRIPE_PRICE_BUSINESS_MONTHLY_LEGACY',
    'STRIPE_PRICE_BUSINESS_YEARLY_LEGACY',
    'TP3D_TRIAL_WORKSPACE_LIMIT',
    'TP3D_PRO_WORKSPACE_LIMIT',
    'TP3D_BUSINESS_WORKSPACE_LIMIT',
  ];
  for (const name of catalogEnvNames) {
    assert.match(catalogSource, new RegExp(`Deno\\.env\\.get\\(name\\)|${name}`), `${name} is catalog-owned`);
    const directRead = new RegExp(`Deno\\.env\\.get\\(["']${name}["']\\)`);
    assert.doesNotMatch(billingSource, directRead, `billing-status must not read ${name} directly`);
    assert.doesNotMatch(restoreSource, directRead, `restore must not read ${name} directly`);
    assert.doesNotMatch(checkoutSource, directRead, `checkout must not read ${name} directly`);
  }
  assert.match(billingSource, /unknownPriceId/);
  assert.match(billingSource, /billing:unknown-price-fallback/);
  assert.match(checkoutSource, /Price not configured for interval: \$\{interval\}/,
    'missing configured checkout Price response is unchanged');
  assert.match(checkoutSource, /assertAllowedCheckoutPrice\(price_id\)/,
    'invalid checkout Price still passes through an explicit allow-list guard');
});

test('BILLING-CATALOG-12 webhook stores Stripe Price truth and portal remains catalog-independent', async () => {
  const [webhookSource, portalSource] = await Promise.all([
    fs.readFile(webhookPath, 'utf8'),
    fs.readFile(portalPath, 'utf8'),
  ]);
  assert.match(webhookSource, /price_id: priceId/,
    'webhook projection stores the Stripe Price without a catalog entitlement decision');
  assert.doesNotMatch(webhookSource, /billing-catalog|isKnownPriceId|resolveRecognizedTierByPriceId/,
    'webhook does not reject or promote unknown Prices');
  assert.doesNotMatch(portalSource, /billing-catalog|isKnownPriceId|resolveRecognizedTierByPriceId/,
    'portal does not require Price recognition');
  assert.match(portalSource, /organization_id", organizationId/,
    'portal remains explicitly organization-scoped');
});

test('BILLING-CATALOG-13 shared Stripe helpers remain byte-for-byte unchanged', async () => {
  const source = await fs.readFile(stripeSharedPath);
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    '927b3b35d8b7e5186716bb99a2de708e90ec1eeb27256f9e293fa3666c8decf4',
  );
});
