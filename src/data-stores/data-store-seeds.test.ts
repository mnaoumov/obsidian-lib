import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { validateDataStoreSeed } from './data-store-seeds.ts';

describe('validateDataStoreSeed', () => {
  it('reuses matching stats without reading text, hashes only equal-size changed-mtime files, and rebuilds changed content', async () => {
    const hashFile = vi.fn((path: string) => Promise.resolve(path === 'mtime' ? 'hash' : 'different'));
    const result = await validateDataStoreSeed({
      entries: ['same', 'mtime', 'size', 'changed', 'deleted'].map((path) => ({ hash: 'hash', mtime: 1, path, size: 10, value: path })),
      files: [
        { mtime: 1, path: 'same', size: 10 },
        { mtime: 2, path: 'mtime', size: 10 },
        { mtime: 1, path: 'size', size: 11 },
        { mtime: 2, path: 'changed', size: 10 },
        { mtime: 1, path: 'new', size: 10 }
      ],
      hashFile
    });
    expect(result.reusable.map((entry) => entry.path)).toEqual(['same', 'mtime']);
    expect(result.rebuild).toEqual(['size', 'changed', 'new']);
    expect(hashFile.mock.calls).toEqual([['mtime'], ['changed']]);
  });
});
