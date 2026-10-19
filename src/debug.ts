/**
 * @file
 *
 * The debuggers of `@mnaoumov/obsidian-lib`'s own modules.
 */

import { getDebugger } from '@mnaoumov/typescript-lib/debug';
import { Library } from '@mnaoumov/typescript-lib/library';

import {
  LEGACY_OBSIDIAN_LIBRARY_NAME,
  OBSIDIAN_LIBRARY_NAME
} from './library.ts';

type Debugger = ReturnType<typeof getDebugger>;

/**
 * The debugger's own frame between the caller and the `debug` package: the `apply` trap of the alias.
 */
const ALIAS_FRAMES_TO_SKIP = 1;

/**
 * Returns a debugger for one of this library's own modules.
 *
 * The namespace is always under {@link OBSIDIAN_LIBRARY_NAME}, whether or not `initPluginContext` has run yet, so
 * a namespace a guide tells users to enable (`obsidian-lib:PluginApi`) means the same thing in a test, in a
 * script and in a plugin. The generic modules of `@mnaoumov/typescript-lib` log under the namespace
 * `initPluginContext` injects into the generic `Library`.
 *
 * A filter written for the legacy namespace, under {@link LEGACY_OBSIDIAN_LIBRARY_NAME}
 * (`obsidian-dev-utils:PluginApi`), still shows the messages. Each message prints ONCE: under the current
 * namespace when a filter enables it, otherwise under the legacy one when a filter enables that. Printing under both
 * would double every message under the most common filter of all, `<plugin-id>:*`, which enables both.
 *
 * @param namespace - The namespace within the library's.
 * @returns The debugger.
 */
export function getObsidianLibDebugger(namespace: string): Debugger {
  // Both debuggers come from the shared cache `getDebugger` keeps, so only the cheap proxy is new on each call, and a
  // spy installed on one call's `log` is the one the next call reaches.
  const currentDebugger = getDebugger(`${Library.debugPrefixNamespace}${OBSIDIAN_LIBRARY_NAME}:${namespace}`, ALIAS_FRAMES_TO_SKIP);
  const legacyDebugger = getDebugger(`${Library.debugPrefixNamespace}${LEGACY_OBSIDIAN_LIBRARY_NAME}:${namespace}`, ALIAS_FRAMES_TO_SKIP);
  return new Proxy(currentDebugger, {
    apply(target, _thisArgument, $arguments: Parameters<Debugger>): void {
      if (target.enabled) {
        target(...$arguments);
        return;
      }

      if (legacyDebugger.enabled) {
        legacyDebugger(...$arguments);
      }
    },
    get(target, property, receiver): unknown {
      if (property === 'enabled') {
        return target.enabled || legacyDebugger.enabled;
      }

      const value: unknown = Reflect.get(target, property, receiver);
      return value;
    }
  });
}
