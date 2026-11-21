/**
 * @file
 *
 * Runs only the Obsidian workaround canaries: the integration tests whose title starts with
 * `workaround canary`. A red canary means the Obsidian under test fixed a bug a workaround here covers, and its
 * title names that workaround. See `scripts/helpers/obsidian-workarounds.ts`.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { execFromRoot } from '@mnaoumov/typescript-dev-toolkit/root';
import process from 'node:process';

import {
  buildIntegrationTestVitestArguments,
  buildIntegrationTestVitestEnv
} from './helpers/integration-test-runs.ts';
import { WORKAROUND_CANARY_TEST_NAME_PREFIX } from './helpers/obsidian-workarounds.ts';

await wrapCliTask(async () => {
  await execFromRoot(
    [
      'vitest',
      ...buildIntegrationTestVitestArguments({ env: process.env, projectName: 'obsidian-integration-tests' }),
      '--testNamePattern',
      WORKAROUND_CANARY_TEST_NAME_PREFIX
    ],
    { env: buildIntegrationTestVitestEnv() }
  );
});
