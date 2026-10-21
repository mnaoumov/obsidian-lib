import {
  getDebugController,
  getDebugger
} from '@mnaoumov/typescript-lib/debug';
import { Library } from '@mnaoumov/typescript-lib/library';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getObsidianLibDebugger } from './debug.ts';

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
