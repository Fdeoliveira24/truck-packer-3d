import {
  FixtureSafetyError,
  parseAllowedProjectRefs,
  parseSupabaseProjectRef,
} from './safety.mjs';

export const APPROVED_DEVELOPMENT_PROJECT_REF = 'yduzbvijzwczjapanxbd';

function refuse(code, message) {
  throw new FixtureSafetyError(code, `Refusing development fixture operation: ${message}`);
}

export function validateDevelopmentFixtureEnvironment(
  env = {},
  {
    approvedProjectRef = APPROVED_DEVELOPMENT_PROJECT_REF,
    knownProductionProjectRefs = [],
  } = {},
) {
  if (env.TP3D_FIXTURE_ENV !== 'dev') {
    refuse('invalid_fixture_environment', 'TP3D_FIXTURE_ENV must equal dev.');
  }

  const projectRef = parseSupabaseProjectRef(env.SUPABASE_URL);
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

  const serviceRoleKey = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string'
    ? env.SUPABASE_SERVICE_ROLE_KEY.trim()
    : '';
  if (!serviceRoleKey) {
    refuse('missing_service_role_key', 'SUPABASE_SERVICE_ROLE_KEY is required.');
  }

  const stripeKey = typeof env.STRIPE_SECRET_KEY === 'string'
    ? env.STRIPE_SECRET_KEY.trim()
    : '';
  if (stripeKey) {
    refuse('stripe_key_forbidden', 'STRIPE_SECRET_KEY must be absent for this fixture layer.');
  }

  return Object.freeze({
    environment: 'dev',
    projectRef,
    supabaseUrl: String(env.SUPABASE_URL).trim(),
    serviceRoleKey,
  });
}

export function requireExplicitConfirmation(args, operation) {
  if (!Array.isArray(args) || !args.includes('--confirm')) {
    refuse('confirmation_required', `${operation} requires an explicit --confirm flag.`);
  }
}
