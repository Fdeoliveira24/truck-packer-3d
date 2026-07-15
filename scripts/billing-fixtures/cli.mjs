import { pathToFileURL } from 'node:url';

import {
  createFixtureManifest,
  ManifestValidationError,
  validateFixtureManifest,
} from './manifest.mjs';
import { maskProjectRef, maskUuid } from './mask.mjs';
import { FixtureSafetyError, validateFixtureEnvironment } from './safety.mjs';

const FUTURE_WRITE_COMMANDS = new Set(['seed', 'reset', 'cleanup']);

export function runFixtureCommand({ command, env = process.env, writeLine = console.log } = {}) {
  if (FUTURE_WRITE_COMMANDS.has(command)) {
    throw new FixtureSafetyError(
      'writes_not_implemented',
      'Fixture writes are not implemented in the safety-foundation branch.',
    );
  }
  if (!['plan', 'verify-safety'].includes(command)) {
    throw new FixtureSafetyError(
      'unsupported_command',
      'Refusing fixture operation: supported commands are plan and verify-safety.',
    );
  }

  // Safety is resolved before any future write-capable layer could be loaded.
  // This branch intentionally has no such module or dynamic import.
  const safety = validateFixtureEnvironment(env);
  writeLine('Billing fixture safety foundation — NO WRITES');
  writeLine(`Environment: ${safety.environment}`);
  writeLine(`Supabase project: ${maskProjectRef(safety.projectRef)}`);
  writeLine(`Stripe mode: ${safety.stripeMode}`);

  if (command === 'verify-safety') {
    writeLine('Safety result: future fixture planning would be allowed.');
    writeLine('Network access: not used.');
    return Object.freeze({ command, safety });
  }

  const manifest = createFixtureManifest({
    environment: safety.environment,
    projectRef: safety.projectRef,
  });
  validateFixtureManifest(manifest, safety);
  writeLine(`Fixture run: ${maskUuid(manifest.fixtureRunId)}`);
  writeLine(`Planned scenarios: ${manifest.fixtures.length}`);
  for (const fixture of manifest.fixtures) {
    writeLine(`- ${fixture.fixtureKey} [${fixture.scenarioClassification}]`);
  }
  writeLine('Network access: not used.');
  writeLine('Database/Stripe writes: not implemented.');
  return Object.freeze({ command, safety, manifest });
}

function runFromTerminal() {
  try {
    runFixtureCommand({ command: process.argv[2] });
  } catch (error) {
    const message = error instanceof FixtureSafetyError || error instanceof ManifestValidationError
      ? error.message
      : 'Fixture command failed safely.';
    console.error(message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromTerminal();
}
