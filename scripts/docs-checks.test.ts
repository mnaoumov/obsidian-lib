import { assertDocsSnippetsCompile } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-snippets';
import { assertNoOutdatedReferences } from '@mnaoumov/typescript-dev-toolkit/docs-site/outdated-references';
import { fileURLToPath } from 'node:url';
import {
  describe,
  it
} from 'vitest';

import { DOCS_SNIPPET_PRELUDE } from './docs-snippet-prelude.ts';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));

// Compiling every guide snippet builds one program over `src/`, which takes tens of seconds.
const FULL_CHECK_TIMEOUT_IN_MILLISECONDS = 180_000;

describe('documentation checks', () => {
  it('should type-check every snippet of the guides', { timeout: FULL_CHECK_TIMEOUT_IN_MILLISECONDS }, async () => {
    await assertDocsSnippetsCompile({ prelude: DOCS_SNIPPET_PRELUDE, rootDirectory: ROOT_DIR });
  });

  it('should find no outdated reference in the package', async () => {
    await assertNoOutdatedReferences(ROOT_DIR);
  });
});
