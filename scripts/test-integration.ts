/**
 * @file
 *
 * Runs this package's integration tests; its `test:integration` script points here, naming the vitest projects that
 * hold them (`integration-tests` and `obsidian-integration-tests`). Each name also selects its `<name>:*` siblings.
 *
 * Every selected project runs in a vitest invocation of its own, one after another, so at most one Obsidian instance
 * is alive at a time. See `scripts/helpers/integration-test-runs.ts`.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { execFromRoot } from '@mnaoumov/typescript-dev-toolkit/root';
import process from 'node:process';

import vitestConfig from '../vitest.config.ts';
import {
  buildIntegrationTestVitestArguments,
  getProjectNames,
  selectIntegrationTestProjects
} from './helpers/integration-test-runs.ts';

const [, , ...requestedProjects] = process.argv;

await wrapCliTask(async () => {
  const projectNames = selectIntegrationTestProjects({
    availableProjectNames: getProjectNames(vitestConfig.test?.projects ?? []),
    requestedProjects
  });

  for (const projectName of projectNames) {
    await execFromRoot(['vitest', ...buildIntegrationTestVitestArguments({ env: process.env, projectName })]);
  }
});
