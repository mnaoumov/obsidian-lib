import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { isInObsidian } from './is-in-obsidian.ts';

describe('isInObsidian', () => {
  it('should return true when global app exists', () => {
    expect(isInObsidian()).toBe(true);
  });

  it('should return false when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(isInObsidian()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should return false when global app does not exist', () => {
    const saved = castTo<Record<string, unknown>>(globalThis)['app'];
    delete castTo<Record<string, unknown>>(globalThis)['app'];
    try {
      expect(isInObsidian()).toBe(false);
    } finally {
      castTo<Record<string, unknown>>(globalThis)['app'] = saved;
    }
  });
});
