#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { FixtureSafetyError } from './safety.mjs';
import {
  requireExplicitConfirmation,
  validateDevelopmentFixtureEnvironment,
} from './dev-environment.mjs';
import {
  createDevelopmentManifest,
  readDevelopmentManifest,
  resolveDevManifestPath,
} from './dev-manifest.mjs';
import { createDevelopmentApi } from './dev-invoke.mjs';
import { cleanupDevelopmentFixtures } from './dev-cleanup.mjs';
import { seedDevelopmentFixtures } from './dev-seed.mjs';
import { verifyDevelopmentFixtures } from './dev-verify.mjs';
import { maskProjectRef, maskUuid } from './mask.mjs';

export async function runDevelopmentFixtureCli({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  fetchImpl = globalThis.fetch,
} = {}) {
  const [command = 'plan', ...args] = argv;
  const config = validateDevelopmentFixtureEnvironment(env);
  const manifestPath = resolveDevManifestPath(env);

  if (command === 'plan') {
    const plan = createDevelopmentManifest({ runId: randomUUID(), projectRef: config.projectRef });
    logger.log(`Dry-run only: development fixture plan for ${maskProjectRef(config.projectRef)} (run ${maskUuid(plan.runId)}).`);
    logger.log('No network request or write was made.');
    return { command, dryRun: true };
  }

  const api = createDevelopmentApi(config, { fetchImpl });
  if (command === 'seed') {
    requireExplicitConfirmation(args, 'seed');
    const roles = args.includes('--gate-d1-owner-only') ? ['owner'] : undefined;
    return seedDevelopmentFixtures({ api, config, manifestPath, ...(roles ? { roles } : {}), logger });
  }

  const manifest = await readDevelopmentManifest(manifestPath, {
    projectRef: config.projectRef,
    environment: config.environment,
  });
  if (command === 'verify') {
    return verifyDevelopmentFixtures({ api, config, manifest, manifestPath, logger });
  }
  if (command === 'cleanup') {
    requireExplicitConfirmation(args, 'cleanup');
    return cleanupDevelopmentFixtures({ api, config, manifest, manifestPath, logger });
  }
  throw new FixtureSafetyError('unknown_command', `Unknown development fixture command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDevelopmentFixtureCli().catch(error => {
    const code = error instanceof FixtureSafetyError ? error.code : 'operation_failed';
    console.error(`Development fixture ${code}: ${error.message}`);
    process.exitCode = 1;
  });
}
