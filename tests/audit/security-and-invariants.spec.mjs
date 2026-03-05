import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const billingServiceUrl = new URL('../../src/data/services/billing.service.js', import.meta.url);
const accountOverlayPath = new URL('../../src/ui/overlays/account-overlay.js', import.meta.url);
const appPath = new URL('../../src/app.js', import.meta.url);
const corsSharedPath = new URL('../../supabase/functions/_shared/cors.ts', import.meta.url);

test('isAllowedBillingRedirectUrl only allows https stripe origins', async () => {
  const { isAllowedBillingRedirectUrl } = await import(
    `${billingServiceUrl.href}?t=${Date.now()}-${Math.random()}`
  );

  assert.equal(isAllowedBillingRedirectUrl('https://checkout.stripe.com/c/pay_123'), true);
  assert.equal(isAllowedBillingRedirectUrl('https://billing.stripe.com/p/session_123'), true);
  assert.equal(isAllowedBillingRedirectUrl('https://subdomain.stripe.com/path'), true);
  assert.equal(isAllowedBillingRedirectUrl('http://checkout.stripe.com/c/pay_123'), false);
  assert.equal(isAllowedBillingRedirectUrl('https://evil.example.com/stripe'), false);
  assert.equal(isAllowedBillingRedirectUrl('javascript:alert(1)'), false);
});

test('billing service does not depend on legacy auth/session state', async () => {
  const source = await fs.readFile(new URL('../../src/data/services/billing.service.js', import.meta.url), 'utf8');
  assert.equal(source.includes('../../auth/session.js'), false);
});

test('account overlay avoids direct userView template interpolation into innerHTML', async () => {
  const source = await fs.readFile(accountOverlayPath, 'utf8');
  const dangerousPattern = /innerHTML\s*=\s*`[^`]*\$\{\s*userView\./s;
  assert.equal(dangerousPattern.test(source), false);
});

test('shared CORS json helper does not default to wildcard origin', async () => {
  const source = await fs.readFile(corsSharedPath, 'utf8');
  assert.equal(source.includes('const allowOrigin = opts.origin ?? "*";'), false);
  assert.match(source, /const allowOrigin = opts\.origin \?\? "null";/);
});

test('app init keeps explicit single-flight/idempotency guards', async () => {
  const source = await fs.readFile(appPath, 'utf8');
  assert.match(source, /let\s+initInFlightPromise\s*=\s*null/);
  assert.match(source, /let\s+initCompleted\s*=\s*false/);
  assert.match(source, /if\s*\(initInFlightPromise\)\s*return\s+initInFlightPromise/);
});
