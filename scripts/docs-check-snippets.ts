/**
 * @file
 *
 * Type-checks every code snippet of the documentation guides; its `docs:check-snippets` script points here. The
 * same check runs in the gate, as `scripts/docs-checks.test.ts`.
 */

import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { assertDocsSnippetsCompile } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-snippets';
import process from 'node:process';

import { DOCS_SNIPPET_PRELUDE } from './docs-snippet-prelude.ts';

await wrapCliTask(async () => {
  await assertDocsSnippetsCompile({ prelude: DOCS_SNIPPET_PRELUDE, rootDirectory: process.cwd() });
});
