/**
 * @file
 *
 * A Vite plugin that resolves this package's own name onto its sources.
 *
 * The test-support packages this repository's tests load depend on this very package. Installed from npm, they
 * would import its PUBLISHED copy while the tests import the sources, so a test-setup reset of shared module state
 * would reach a different module instance than the code under test. Resolving the name onto `src/` gives the run
 * one copy. The test-support packages must be listed in `server.deps.inline` for their imports to go through this
 * plugin.
 */

import type { Plugin } from 'vitest/config';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_FOLDER = join(import.meta.dirname, '..', 'src');

/**
 * Creates the plugin.
 *
 * @param packageName - This package's name, e.g. `@mnaoumov/typescript-lib`.
 * @returns The plugin.
 */
export function selfSourcePlugin(packageName: string): Plugin {
  const prefix = `${packageName}/`;
  return {
    enforce: 'pre',
    name: 'self-source',
    resolveId(source: string): null | string {
      if (source !== packageName && !source.startsWith(prefix)) {
        return null;
      }

      const subpath = source === packageName ? undefined : source.slice(prefix.length);
      const candidates = subpath === undefined
        ? [join(SOURCE_FOLDER, 'index.ts')]
        : [join(SOURCE_FOLDER, `${subpath}.ts`), join(SOURCE_FOLDER, subpath, 'index.ts')];
      return candidates.find((candidate) => existsSync(candidate)) ?? null;
    }
  };
}
