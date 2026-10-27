import type { ViteUserConfig } from 'vitest/config';

import { getStrykerTestInclude } from '@mnaoumov/typescript-dev-toolkit/test-runners/stryker-config';
import { DEFAULT_VITEST_TEST_EXCLUDE } from '@mnaoumov/typescript-dev-toolkit/test-runners/vitest-config';

import { selfSourcePlugin } from './scripts/vitest-self-source.ts';

// The mutation run's vitest configuration: the `unit-tests` and `unit-tests:global-stubs` projects flattened into one,
// since Stryker's vitest runner forces its own pool anyway. It keeps everything those projects need to load a
// module the way `npm test` does: the self-source plugin, the `obsidian-test-mocks` alias, the inlined test-support
// packages and both setup files.
const config: ViteUserConfig = {
  plugins: [selfSourcePlugin('@mnaoumov/obsidian-lib')],
  resolve: {
    alias: {
      obsidian: 'obsidian-test-mocks/obsidian'
    },
    dedupe: ['@mnaoumov/typescript-lib']
  },
  test: {
    environment: 'jsdom',
    exclude: [...DEFAULT_VITEST_TEST_EXCLUDE, 'src/**/*.integration.test.ts'],
    globals: false,
    include: getStrykerTestInclude(['src/**/*.test.ts']),
    server: {
      // eslint-disable-next-line unicorn/name-replacements -- `deps` is a Vitest config key.
      deps: {
        inline: ['@obsidian-typings', '@mnaoumov/obsidian-dev-toolkit', '@mnaoumov/typescript-test-toolkit']
      }
    },
    setupFiles: ['obsidian-test-mocks/vitest-setup', '@mnaoumov/obsidian-dev-toolkit/vitest-setup']
  }
};

export default config;
