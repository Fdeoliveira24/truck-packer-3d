#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { cleanupStripeFixtures } from './stripe-cleanup.mjs';
import {
  requireStripeFixtureConfirmation,
  validateStripeFixtureEnvironment,
} from './stripe-environment.mjs';
import { createStripeFixtureApis } from './stripe-invoke.mjs';
import {
  readStripeManifest,
  resolveStripeManifestPath,
} from './stripe-manifest.mjs';
import { maskFixtureDiagnostic, maskProjectRef } from './mask.mjs';
import {
  seedStripeFixtures,
  verifyStripeReadOnlyContext,
  verifyStripeSignedWebhookGate,
} from './stripe-seed.mjs';
import {
  verifyStripeCoreLifecycle,
  verifyStripeSafetyLifecycle,
} from './stripe-verify.mjs';
import { FixtureSafetyError } from './safety.mjs';

export async function runStripeFixtureCli({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  fetchImpl = globalThis.fetch,
  apiFactory = createStripeFixtureApis,
  readOnlyVerifier = verifyStripeReadOnlyContext,
} = {}) {
  const [command = 'plan', ...args] = argv;
  const config = validateStripeFixtureEnvironment(env);
  const manifestPath = resolveStripeManifestPath(env);
  const { stripe, supabase } = apiFactory(config, { fetchImpl });

  if (command === 'plan') {
    await readOnlyVerifier({ stripe, config });
    logger.log(`Dry-run only: Stripe test fixture plan for ${maskProjectRef(config.projectRef)}.`);
    logger.log('Validated test account and configured Prices using read-only requests; zero writes were made.');
    return { command, dryRun: true, writes: 0 };
  }

  if (command === 'probe') {
    requireStripeFixtureConfirmation(args, 'probe');
    return verifyStripeSignedWebhookGate({ stripe, supabase, config, manifestPath, logger });
  }

  if (command === 'seed') {
    requireStripeFixtureConfirmation(args, 'seed');
    return seedStripeFixtures({ stripe, supabase, config, manifestPath, logger });
  }

  const context = await readOnlyVerifier({ stripe, config });
  const manifest = await readStripeManifest(manifestPath, {
    environment: config.environment,
    projectRef: config.projectRef,
    stripeAccountId: context.account.id,
  });
  if (command === 'verify') {
    return verifyStripeCoreLifecycle({ stripe, supabase, config, manifest, manifestPath, logger });
  }
  if (command === 'safety') {
    requireStripeFixtureConfirmation(args, 'safety');
    return verifyStripeSafetyLifecycle({ stripe, supabase, config, manifest, manifestPath, logger });
  }
  if (command === 'cleanup') {
    requireStripeFixtureConfirmation(args, 'cleanup');
    return cleanupStripeFixtures({ stripe, supabase, config, manifest, manifestPath, logger });
  }
  throw new FixtureSafetyError('unknown_command', `Unknown Stripe fixture command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runStripeFixtureCli().catch(error => {
    const code = error instanceof FixtureSafetyError ? error.code : 'operation_failed';
    console.error(`Stripe fixture ${code}: ${maskFixtureDiagnostic(error.message)}`);
    process.exitCode = 1;
  });
}
