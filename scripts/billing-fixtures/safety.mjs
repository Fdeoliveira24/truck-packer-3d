const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const HOSTED_SUPABASE_HOST_RE = /^([a-z0-9]{20})\.supabase\.co$/;

// No authoritative production project reference is currently recorded in the
// live project documentation. Add a confirmed production ref here before any
// future fixture write layer is introduced.
export const KNOWN_PRODUCTION_PROJECT_REFS = Object.freeze([]);

export class FixtureSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FixtureSafetyError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new FixtureSafetyError(code, `Refusing fixture operation: ${message}`);
}

export function parseSupabaseProjectRef(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    refuse('missing_supabase_url', 'SUPABASE_URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    refuse('malformed_supabase_url', 'SUPABASE_URL must be a hosted Supabase project URL.');
  }

  const hostMatch = parsed.hostname.match(HOSTED_SUPABASE_HOST_RE);
  const cleanPath = parsed.pathname === '' || parsed.pathname === '/';
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !cleanPath ||
    parsed.search ||
    parsed.hash ||
    !hostMatch
  ) {
    refuse('malformed_supabase_url', 'SUPABASE_URL must be a hosted Supabase project URL.');
  }

  return hostMatch[1];
}

export function parseAllowedProjectRefs(rawAllowlist) {
  const refs = typeof rawAllowlist === 'string'
    ? rawAllowlist.split(',').map(value => value.trim()).filter(Boolean)
    : [];
  if (refs.length === 0) {
    refuse('project_not_allowlisted', 'Supabase project is not allowlisted.');
  }
  if (refs.some(ref => !PROJECT_REF_RE.test(ref))) {
    refuse('malformed_project_allowlist', 'Supabase project allowlist is malformed.');
  }
  return new Set(refs);
}

export function validateFixtureEnvironment(
  env = {},
  { knownProductionProjectRefs = KNOWN_PRODUCTION_PROJECT_REFS } = {},
) {
  if (env.TP3D_FIXTURE_ENV !== 'dev') {
    refuse('invalid_fixture_environment', 'TP3D_FIXTURE_ENV must equal dev.');
  }

  const projectRef = parseSupabaseProjectRef(env.SUPABASE_URL);
  const productionRefs = new Set(knownProductionProjectRefs || []);
  if (productionRefs.has(projectRef)) {
    refuse('production_project', 'Known production Supabase projects are never allowed.');
  }

  const allowlistedRefs = parseAllowedProjectRefs(env.TP3D_FIXTURE_ALLOWED_PROJECT_REFS);
  if (!allowlistedRefs.has(projectRef)) {
    refuse('project_not_allowlisted', 'Supabase project is not allowlisted.');
  }

  const stripeKey = typeof env.STRIPE_SECRET_KEY === 'string'
    ? env.STRIPE_SECRET_KEY.trim()
    : '';
  if (stripeKey && !stripeKey.startsWith('sk_test_')) {
    refuse('stripe_not_test_mode', 'Stripe key is not test mode.');
  }

  return Object.freeze({
    environment: 'dev',
    projectRef,
    stripeMode: stripeKey ? 'test' : 'not-configured',
  });
}
