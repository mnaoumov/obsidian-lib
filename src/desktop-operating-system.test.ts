import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getDesktopOperatingSystem } from './desktop-operating-system.ts';

vi.mock('node:os', () => ({
  release: (): string => '10.0.26100',
  version: (): string => 'Windows 11 Pro'
}));

describe('getDesktopOperatingSystem', () => {
  it('should join the version name and the release', () => {
    expect(getDesktopOperatingSystem()).toBe('Windows 11 Pro 10.0.26100');
  });
});
