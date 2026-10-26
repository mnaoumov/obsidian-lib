import {
  getDebugController,
  getDebugger
} from '@mnaoumov/typescript-lib/debug';
import { noop } from '@mnaoumov/typescript-lib/function';
import { Library } from '@mnaoumov/typescript-lib/library';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getObsidianLibDebugger,
  showInitialDebugMessage
} from './debug.ts';

describe('getObsidianLibDebugger', () => {
  it('should keep the library namespace before the plugin context is initialized', () => {
    expect(getObsidianLibDebugger('PluginApi').namespace).toBe('obsidian-lib:PluginApi');
  });

  it('should keep the library namespace when the generic library logs under another one', () => {
    Library.init({ debugNamespace: 'something-else', debugPrefixNamespace: 'my-plugin:', shouldPrintStackTrace: false });
    expect(getObsidianLibDebugger('PluginApi').namespace).toBe('my-plugin:obsidian-lib:PluginApi');
  });

  it('should print under the library namespace when a filter enables it', () => {
    getDebugController().set('obsidian-lib:Logged');
    const log = vi.spyOn(getDebugger('obsidian-lib:Logged'), 'log').mockImplementation(vi.fn());

    getObsidianLibDebugger('Logged')('message');

    expect(log).toHaveBeenCalledOnce();
  });

  it('should print nothing when no filter enables the namespace', () => {
    getDebugController().set('');

    expect(getObsidianLibDebugger('Silent').enabled).toBe(false);
  });
});

describe('showInitialDebugMessage', () => {
  let savedNamespaces: string[];

  beforeEach(() => {
    savedNamespaces = getDebugController().get();
    getDebugController().set('');
  });

  afterEach(() => {
    getDebugController().set(savedNamespaces);
    vi.restoreAllMocks();
  });

  function getDebugOutput(): string {
    // eslint-disable-next-line no-console -- Valid usage.
    return vi.mocked(console.debug).mock.calls.flat().join(' ');
  }

  it('should print the enabled message when the plugin namespace is enabled', () => {
    vi.spyOn(console, 'debug').mockImplementation(noop);
    getDebugController().set('enabled-plugin');
    showInitialDebugMessage('enabled-plugin');
    expect(getDebugOutput()).toContain('Debug messages for plugin enabled-plugin are enabled.');
  });

  it('should print nothing when the plugin namespace is disabled', () => {
    vi.spyOn(console, 'debug').mockImplementation(noop);
    getDebugController().set('other-plugin');
    showInitialDebugMessage('disabled-plugin');
    // eslint-disable-next-line no-console -- Valid usage.
    expect(vi.mocked(console.debug)).not.toHaveBeenCalled();
  });

  it('should leave the namespaces unchanged', () => {
    getDebugController().set('original-ns');
    showInitialDebugMessage('temp-plugin');
    showInitialDebugMessage('original-ns');
    expect(getDebugController().get()).toEqual(['original-ns']);
  });

  it('should point at the debug guide the host supplied', () => {
    Library.init({ debugGuideUrl: 'https://example.com/guide', debugPrefixNamespace: '', shouldPrintStackTrace: false });
    vi.spyOn(console, 'debug').mockImplementation(noop);
    getDebugController().set('guide-plugin');
    showInitialDebugMessage('guide-plugin');
    expect(getDebugOutput()).toContain('Debug messages for plugin guide-plugin are enabled. See https://example.com/guide how to disable them.');
  });

  it('should name no guide when the host supplied none', () => {
    vi.spyOn(console, 'debug').mockImplementation(noop);
    getDebugController().set('no-guide-plugin');
    showInitialDebugMessage('no-guide-plugin');
    expect(getDebugOutput()).toContain('Debug messages for plugin no-guide-plugin are enabled.');
    expect(getDebugOutput()).not.toContain(' See ');
  });
});
