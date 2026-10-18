/**
 * @file
 *
 * Type-checks every code snippet of the documentation guides; its `docs:check-snippets` script points here. The
 * same check runs in the gate, as `scripts/docs-snippets.test.ts`.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import process from 'node:process';

import {
  findDocsSnippetProblems,
  formatDocsSnippetProblems
} from './helpers/docs-snippets.ts';

await wrapCliTask(async () => {
  const problems = await findDocsSnippetProblems({ rootDirectory: process.cwd() });
  if (problems.length > 0) {
    throw new Error(`${String(problems.length)} problem(s) in the documentation snippets:\n${formatDocsSnippetProblems(problems)}`);
  }
});
