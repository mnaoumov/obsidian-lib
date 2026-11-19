import { homedir } from 'node:os';
import {
  describe,
  expect,
  it
} from 'vitest';

import { getHomeFolderPath } from './desktop-home-folder.ts';

describe('getHomeFolderPath', () => {
  it('should return the home folder', () => {
    expect(getHomeFolderPath()).toBe(homedir());
  });
});
