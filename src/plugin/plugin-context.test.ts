import type { Component } from 'obsidian';

import { ResettableAbortController } from '@mnaoumov/typescript-lib/abort-controller';
import { Library } from '@mnaoumov/typescript-lib/library';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureGenericObject } from '@mnaoumov/typescript-lib/type-guards';
import {
  getTypescriptLibStateSlot,
  resetTypescriptLibState,
  TYPESCRIPT_LIB_STATE_KEY
} from '@mnaoumov/typescript-lib/typescript-lib-state';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { ObsidianLibrary } from '../library.ts';
import {
  addPluginCssClasses,
  initDebugController,
  initPluginContext
} from './plugin-context.ts';

const mocks = vi.hoisted(() => ({
  getDebugController: vi.fn(() => ({})),
  injectLibraryStyles: vi.fn(),
  showInitialDebugMessage: vi.fn()
}));

vi.mock('../library-styles.ts', () => ({
  injectLibraryStyles: mocks.injectLibraryStyles
}));

vi.mock('@mnaoumov/typescript-lib/debug-controller', () => ({}));

vi.mock('../ui/css-class.ts', () => ({
  CssClass: { LibraryName: 'obsidian-lib' }
}));

vi.mock('@mnaoumov/typescript-lib/debug', () => ({
  getDebugController: mocks.getDebugController
}));

vi.mock('../diagnostics/debug.ts', () => ({
  showInitialDebugMessage: mocks.showInitialDebugMessage
}));

vi.mock('../generated-during-build.ts', () => ({
  LIBRARY_STYLES: '.test { color: red; }',
  LIBRARY_VERSION: '1.0.0'
}));

describe('addPluginCssClasses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ObsidianLibrary.init({ cssClassScope: 'test-plugin' });
  });

  it('should add library name, plugin id, and custom css class string', () => {
    const addClass = vi.fn();
    const element = strictProxy<HTMLElement>({ addClass });
    addPluginCssClasses(element, 'custom-class');
    expect(addClass).toHaveBeenCalledWith('obsidian-lib', 'test-plugin', 'custom-class');
  });

  it('should add library name, plugin id, and custom css classes array', () => {
    const addClass = vi.fn();
    const element = strictProxy<HTMLElement>({ addClass });
    addPluginCssClasses(element, ['class-a', 'class-b']);
    expect(addClass).toHaveBeenCalledWith('obsidian-lib', 'test-plugin', 'class-a', 'class-b');
  });

  it('should add only library name and plugin id when no css classes provided', () => {
    const addClass = vi.fn();
    const element = strictProxy<HTMLElement>({ addClass });
    addPluginCssClasses(element);
    expect(addClass).toHaveBeenCalledWith('obsidian-lib', 'test-plugin');
  });

  it('should omit the scope class when the css class scope is empty', () => {
    ObsidianLibrary.resetToDefault();
    const addClass = vi.fn();
    const element = strictProxy<HTMLElement>({ addClass });
    addPluginCssClasses(element, 'custom-class');
    expect(addClass).toHaveBeenCalledWith('obsidian-lib', 'custom-class');
  });
});

describe('initDebugController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set DEBUG on window', () => {
    const win = {} as Window;
    const registerFunction = vi.fn();
    const mockComponent = strictProxy<Component>({
      register: registerFunction
    });
    initDebugController(win, mockComponent);
    expect(ensureGenericObject(win)['DEBUG']).toBeDefined();
    expect(registerFunction).toHaveBeenCalled();
    expect(mocks.getDebugController).toHaveBeenCalled();
  });

  it('should restore old DEBUG on cleanup when DEBUG is still ours', () => {
    const oldDebug = { old: true };
    const win = castTo<Window>({ DEBUG: oldDebug });
    const registerFunction = vi.fn();
    const mockComponent = strictProxy<Component>({
      register: registerFunction
    });
    initDebugController(win, mockComponent);
    const winObject = ensureGenericObject(win);

    // The cleanup function was registered
    const cleanupFunction = registerFunction.mock.calls[0]?.[0] as () => void;

    // DEBUG is still ours, so cleanup should restore old value
    cleanupFunction();
    expect(winObject['DEBUG']).toBe(oldDebug);
  });

  it('should not restore old DEBUG on cleanup when DEBUG was changed by another plugin', () => {
    const win = {} as Window;
    const registerFunction = vi.fn();
    const mockComponent = strictProxy<Component>({
      register: registerFunction
    });
    initDebugController(win, mockComponent);
    const winObject = ensureGenericObject(win);

    const cleanupFunction = registerFunction.mock.calls[0]?.[0] as () => void;

    // Simulate another plugin changing DEBUG
    const anotherDebug = { another: true };
    winObject['DEBUG'] = anotherDebug;

    cleanupFunction();
    // Should NOT restore, since DEBUG was changed by someone else
    expect(winObject['DEBUG']).toBe(anotherDebug);
  });
});

describe('initPluginContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize the Library and show debug message', () => {
    initPluginContext('my-plugin');
    expect(ObsidianLibrary.cssClassScope).toBe('my-plugin');
    expect(Library.debugNamespace).toBe('obsidian-lib');
    expect(Library.debugNamespaceAliases).toEqual([]);
    expect(Library.debugPrefixNamespace).toBe('my-plugin:');
    expect(Library.shouldPrintStackTrace).toBe(true);
    expect(Library.debugGuideUrl).toBe('https://mnaoumov.dev/obsidian-lib/guides/debugging/');
    expect(mocks.showInitialDebugMessage).toHaveBeenCalledWith('my-plugin');
  });

  it('should inject the library styles of this copy', () => {
    initPluginContext('my-plugin');
    expect(mocks.injectLibraryStyles).toHaveBeenCalledWith({
      doc: document,
      libraryStyles: '.test { color: red; }',
      libraryVersion: '1.0.0'
    });
  });

  // The shared abort controller is documented as callable straight from the devtools console, through the generic
  // shared-state slot. Nothing else in the library touches it, so without this eager call the key would be absent until
  // a consumer plugin happened to start an operation, and the documented console line would throw instead of aborting.
  it('should create the shared abort controller so the console call always resolves', () => {
    resetTypescriptLibState();

    initPluginContext('my-plugin');

    expect(getTypescriptLibStateSlot().values['sharedAbortController']?.value).toBeInstanceOf(ResettableAbortController);
    // eslint-disable-next-line obsidianmd/no-global-this -- The documented console call reaches the realm global.
    expect(castTo<Record<symbol, unknown>>(globalThis)[TYPESCRIPT_LIB_STATE_KEY]).toBe(getTypescriptLibStateSlot());
  });
});
