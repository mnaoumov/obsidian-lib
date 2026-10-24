/**
 * @file
 *
 * Runs Stryker mutation testing on demand over the named modules, or incrementally over everything; its
 * `test:mutation` script points here.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { testMutation } from '@mnaoumov/typescript-dev-toolkit/test-runners/stryker';
import process from 'node:process';

const [, , ...modulePaths] = process.argv;

await wrapCliTask(async () => {
  await testMutation({ modulePaths });
});
