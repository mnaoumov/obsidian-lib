import { fileURLToPath } from 'node:url';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  findOutdatedReferences,
  findOutdatedReferencesInText,
  formatOutdatedReferences
} from './outdated-references.ts';

const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));

describe('findOutdatedReferencesInText', () => {
  it('should flag the retired package used as an address', () => {
    const text = [
      'See `obsidian-dev-utils/obsidian/markdown`.',
      'import { loop } from \'obsidian-dev-utils\';',
      '__obsidianDevUtils.sharedAbortController.value.abort();',
      'https://github.com/mnaoumov/obsidian-dev-utils/releases/latest/download/styles.css'
    ].join('\n');
    expect(findOutdatedReferencesInText('a.md', text).map((reference) => reference.line)).toEqual([1, 2, 3, 4]);
  });

  it('should not flag the wire names this library keeps', () => {
    const text = [
      'window.DEBUG.enable(\'*:obsidian-dev-utils:*\');',
      '.alpha-bravo.obsidian-dev-utils :invalid {',
      'It replaces [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils).',
      'globalThis.__obsidianDevUtils.pluginApiRegistry.value.records[pluginId]'
    ].join('\n');
    expect(findOutdatedReferencesInText('a.md', text)).toEqual([]);
  });

  it('should honour the allow marker on the same line', () => {
    expect(findOutdatedReferencesInText('a.md', 'Was `obsidian-dev-utils/obsidian/loop`. <!-- outdated-reference-ok -->')).toEqual([]);
  });
});

describe('findOutdatedReferences', () => {
  it('should find no outdated reference in the package', async () => {
    expect(formatOutdatedReferences(await findOutdatedReferences(ROOT_DIR))).toBe('');
  });
});
