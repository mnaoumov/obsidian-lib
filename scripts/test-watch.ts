/**
 * @file
 *
 * Runs ONE workspace package's unit tests in watch mode; its `test:watch` script points here.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { testWatch } from '@mnaoumov/typescript-dev-toolkit/test-runners/vitest';
import process from 'node:process';

const [, , ...additionalArguments] = process.argv;

await wrapCliTask(async () => {
  await testWatch({
    additionalArguments,
    projects: ['unit-tests']
  });
});
