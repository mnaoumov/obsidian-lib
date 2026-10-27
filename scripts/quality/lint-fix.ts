/**
 * @file
 *
 * Lints the project with ESLint and applies the autofixes.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/eslint';
import process from 'node:process';

const [, , ...paths] = process.argv;

await wrapCliTask(async () => {
  await lint({ paths, shouldFix: true });
});
