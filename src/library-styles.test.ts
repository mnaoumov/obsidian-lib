// @vitest-environment jsdom

import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  injectLibraryStyles,
  LAST_LIBRARY_VERSION_KEY,
  LIBRARY_STYLES_ELEMENT_ID
} from './library-styles.ts';
import {
  getObsidianLibState,
  resetObsidianLibState
} from './obsidian-lib-state.ts';

describe('injectLibraryStyles', () => {
  beforeEach(() => {
    resetObsidianLibState();
    document.head.querySelector(`#${LIBRARY_STYLES_ELEMENT_ID}`)?.remove();
  });

  it('should use the obsidian-lib element id', () => {
    expect(LIBRARY_STYLES_ELEMENT_ID).toBe('obsidian-lib-styles');
  });

  it('should inject the styles when no copy did yet', () => {
    injectStyles('1.0.0', '/* lib-1.0.0 */');
    expect(getInjectedStyles()).toEqual(['/* lib-1.0.0 */']);
    expect(getObsidianLibState(LAST_LIBRARY_VERSION_KEY, null).value).toBe('1.0.0');
  });

  it('should let a newer copy replace an older one', () => {
    injectStyles('1.0.0', '/* lib-1.0.0 */');
    injectStyles('1.1.0', '/* lib-1.1.0 */');
    expect(getInjectedStyles()).toEqual(['/* lib-1.1.0 */']);
  });

  it('should keep the styles of a newer copy when an older or equal one loads later', () => {
    injectStyles('1.1.0', '/* lib-1.1.0 */');
    injectStyles('1.0.0', '/* lib-1.0.0 */');
    injectStyles('1.1.0', '/* lib-1.1.0-again */');
    expect(getInjectedStyles()).toEqual(['/* lib-1.1.0 */']);
  });
});

function getInjectedStyles(): string[] {
  return Array.from(document.head.querySelectorAll(`#${LIBRARY_STYLES_ELEMENT_ID}`), (element) => element.textContent);
}

function injectStyles(libraryVersion: string, libraryStyles: string): void {
  injectLibraryStyles({ doc: document, libraryStyles, libraryVersion });
}
