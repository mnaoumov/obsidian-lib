import {
  describe,
  expect,
  it
} from 'vitest';

import {
  LEGACY_OBSIDIAN_LIBRARY_NAME,
  OBSIDIAN_LIBRARY_NAME,
  ObsidianLibrary
} from './library.ts';

describe('ObsidianLibrary', () => {
  it('should name the library by its package', () => {
    expect(OBSIDIAN_LIBRARY_NAME).toBe('obsidian-lib');
  });

  it('should keep the user-visible name the library was published under as the legacy name', () => {
    expect(LEGACY_OBSIDIAN_LIBRARY_NAME).toBe('obsidian-dev-utils');
  });

  it('should default to an empty css class scope before init', () => {
    expect(ObsidianLibrary.cssClassScope).toBe('');
  });

  it('should expose the injected css class scope after init', () => {
    ObsidianLibrary.init({ cssClassScope: 'my-plugin' });
    expect(ObsidianLibrary.cssClassScope).toBe('my-plugin');
  });

  it('should throw when init is called twice without a reset', () => {
    ObsidianLibrary.init({ cssClassScope: 'a' });
    expect(() => {
      ObsidianLibrary.init({ cssClassScope: 'b' });
    }).toThrow('already initialized');
  });

  it('should allow re-init after resetToDefault', () => {
    ObsidianLibrary.init({ cssClassScope: 'a' });
    ObsidianLibrary.resetToDefault();
    expect(ObsidianLibrary.cssClassScope).toBe('');
    ObsidianLibrary.init({ cssClassScope: 'c' });
    expect(ObsidianLibrary.cssClassScope).toBe('c');
  });
});
