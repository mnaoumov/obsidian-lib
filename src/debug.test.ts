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

  it('should print under the current namespace when a filter enables it', () => {
    getDebugController().set('obsidian-lib:Alias');
    const logged = captureLogs();

    getObsidianLibDebugger('Alias')('message');

    expect(logged).toStrictEqual(['obsidian-lib:Alias']);
  });

  it('should still print when only a filter on the legacy namespace enables it', () => {
    getDebugController().set('obsidian-dev-utils:Alias');
    const logged = captureLogs();

    expect(getObsidianLibDebugger('Alias').enabled).toBe(true);
    getObsidianLibDebugger('Alias')('message');

    expect(logged).toStrictEqual(['obsidian-dev-utils:Alias']);
  });

  it('should print once when a filter enables both namespaces', () => {
    getDebugController().set('*');
    const logged = captureLogs();

    getObsidianLibDebugger('Alias')('message');

    expect(logged).toStrictEqual(['obsidian-lib:Alias']);
  });

  it('should print nothing when no filter enables either namespace', () => {
    getDebugController().set('');
    const logged = captureLogs();

    expect(getObsidianLibDebugger('Alias').enabled).toBe(false);
    getObsidianLibDebugger('Alias')('message');

    expect(logged).toStrictEqual([]);
  });
});

/**
 * Redirects both underlying debuggers' output into an array of the namespaces that printed.
 *
 * @returns The array the namespaces accumulate into.
 */
function captureLogs(): string[] {
  const logged: string[] = [];
  for (const namespace of ['obsidian-lib:Alias', 'obsidian-dev-utils:Alias']) {
    // The same cached instance the alias wraps: `getDebugger` caches by namespace and frames to skip.
    vi.spyOn(getDebugger(namespace, 1), 'log').mockImplementation(() => {
      logged.push(namespace);
    });
  }

  return logged;
}
