import {
  FixtureSafetyError,
  parseAllowedProjectRefs,
  parseSupabaseProjectRef,
} from './safety.mjs';

export const STRIPE_FIXTURE_ENVIRONMENT = 'stripe-test';
export const APPROVED_STRIPE_FIXTURE_PROJECT_REF = 'yduzbvijzwczjapanxbd';

function refuse(code, message) {
  throw new FixtureSafetyError(code, `Refusing Stripe fixture operation: ${message}`);
}

function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) refuse(`missing_${name.toLowerCase()}`, `${name} is required.`);
  return value;
}

export function validateStripeFixtureEnvironment(
  env = {},
  {
    approvedProjectRef = APPROVED_STRIPE_FIXTURE_PROJECT_REF,
    knownProductionProjectRefs = [],
  } = {},
) {
  if (env.TP3D_FIXTURE_ENV !== STRIPE_FIXTURE_ENVIRONMENT) {
    refuse('invalid_fixture_environment', 'TP3D_FIXTURE_ENV must equal stripe-test.');
  }

  const supabaseUrl = required(env, 'SUPABASE_URL');
  const projectRef = parseSupabaseProjectRef(supabaseUrl);
  if (new Set(knownProductionProjectRefs).has(projectRef)) {
    refuse('production_project', 'Known production Supabase projects are never allowed.');
  }
  const allowed = parseAllowedProjectRefs(env.TP3D_FIXTURE_ALLOWED_PROJECT_REFS);
  if (!allowed.has(projectRef)) {
    refuse('project_not_allowlisted', 'Supabase project is not allowlisted.');
  }
  if (projectRef !== approvedProjectRef) {
    refuse('unapproved_development_project', 'Only the approved development project is allowed.');
  }

  const serviceRoleKey = required(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = String(env.SUPABASE_ANON_KEY || env.ANON_KEY || '').trim();
  if (!anonKey) refuse('missing_supabase_anon_key', 'SUPABASE_ANON_KEY is required.');

  const stripeSecretKey = required(env, 'STRIPE_SECRET_KEY');
  if (stripeSecretKey.startsWith('sk_live_')) {
    refuse('live_stripe_key', 'Live Stripe keys are never allowed.');
  }
  if (!stripeSecretKey.startsWith('sk_test_')) {
    refuse('stripe_not_test_mode', 'STRIPE_SECRET_KEY must be a test-mode secret key.');
  }
  const monthlyPriceId = required(env, 'STRIPE_PRICE_PRO_MONTHLY');
  const yearlyPriceId = required(env, 'STRIPE_PRICE_PRO_YEARLY');
  if (!monthlyPriceId.startsWith('price_') || !yearlyPriceId.startsWith('price_')) {
    refuse('invalid_configured_price', 'Configured Pro Prices must be Stripe Price IDs.');
  }

  return Object.freeze({
    environment: STRIPE_FIXTURE_ENVIRONMENT,
    projectRef,
    supabaseUrl,
    serviceRoleKey,
    anonKey,
    stripeSecretKey,
    monthlyPriceId,
    yearlyPriceId,
    functionsUrl: `https://${projectRef}.supabase.co/functions/v1`,
  });
}

export function requireStripeFixtureConfirmation(args, operation) {
  if (!Array.isArray(args) || !args.includes('--confirm')) {
    refuse('confirmation_required', `${operation} requires an explicit --confirm flag.`);
  }
}
