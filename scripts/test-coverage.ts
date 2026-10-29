/**
 * @file
 *
 * Runs ONE workspace package's unit tests under the 100% coverage gate; its `test:coverage` script points here.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { testCoverage } from '@mnaoumov/typescript-dev-toolkit/test-runners/vitest';
import process from 'node:process';

const [, , ...additionalArguments] = process.argv;

await wrapCliTask(async () => {
  const FULL_COVERAGE_IN_PERCENTS = 100;
  await testCoverage({
    additionalArguments,
    minCoverageInPercents: FULL_COVERAGE_IN_PERCENTS,
    projects: ['unit-tests']
  });
});
