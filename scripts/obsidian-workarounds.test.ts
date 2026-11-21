import { fileURLToPath } from 'node:url';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  findWorkaroundCanaries,
  findWorkaroundMarkers,
  findWorkaroundRegistryProblems,
  readSourceFiles
} from './helpers/obsidian-workarounds.ts';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));

// Reading every file of `src/` takes well under a second alone, but past vitest's 5 s default under the full gate's load.
const REPOSITORY_CHECK_TIMEOUT_IN_MILLISECONDS = 60_000;

const MARKED_MODULE = {
  content: '/**\n * Obsidian workaround `foo-bar`, seen in Obsidian `1.15.1`: its canary is elsewhere.\n */\n',
  path: 'src/foo.ts'
};
const CANARY_FILE = {
  content: 'it(\'workaround canary foo-bar: the bug is still there\', async () => {});\n',
  path: 'src/foo.obsidian.integration.test.ts'
};

describe('Obsidian workaround registry', () => {
  it('should read a marker with its id and version, skipping test files and declarations', () => {
    expect(findWorkaroundMarkers([MARKED_MODULE, { ...MARKED_MODULE, path: 'src/foo.test.ts' }, { ...MARKED_MODULE, path: 'src/foo.d.ts' }])).toEqual([
      { id: 'foo-bar', path: 'src/foo.ts', seenInVersion: '1.15.1' }
    ]);
  });

  it('should read a canary only from an Obsidian integration test file', () => {
    expect(findWorkaroundCanaries([CANARY_FILE, { ...CANARY_FILE, path: 'src/foo.test.ts' }])).toEqual([
      { id: 'foo-bar', path: 'src/foo.obsidian.integration.test.ts' }
    ]);
  });

  it('should accept a marker paired with a canary', () => {
    expect(findWorkaroundRegistryProblems([MARKED_MODULE, CANARY_FILE])).toEqual([]);
  });

  it('should report a marker with no canary, a canary with no marker and a duplicate marker', () => {
    const problems = findWorkaroundRegistryProblems([
      MARKED_MODULE,
      { ...MARKED_MODULE, path: 'src/bar.ts' },
      { ...CANARY_FILE, content: CANARY_FILE.content.replace('foo-bar', 'baz') }
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('marked more than once');
    expect(problems[1]).toContain('has no canary');
    expect(problems[2]).toContain('names no marked workaround');
  });

  it('should find every workaround of this package paired with its canary', { timeout: REPOSITORY_CHECK_TIMEOUT_IN_MILLISECONDS }, async () => {
    const files = await readSourceFiles(ROOT_DIR);
    expect(findWorkaroundRegistryProblems(files)).toEqual([]);
    expect(findWorkaroundMarkers(files).length).toBeGreaterThan(0);
  });
});
