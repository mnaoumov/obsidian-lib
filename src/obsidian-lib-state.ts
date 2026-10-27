/**
 * @file
 *
 * Provides access to the process-wide shared-state bag on the `__obsidianLib` global. New generic state belongs in
 * `@mnaoumov/typescript-lib/typescript-lib-state` (the `Symbol.for('@mnaoumov/typescript-lib/state')` slot).
 *
 * The bag is stored on `globalThis.__obsidianLib`, i.e. on the global object of the realm in
 * which this library is loaded. Because a function's `globalThis` resolves to its defining
 * realm (not the caller's), every consumer that bundles the library in the main Obsidian renderer
 * shares the same bag, regardless of which window is currently active, so callers never need to pass an `App`
 * instance.
 */

import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';

import { ValueWrapper } from '@mnaoumov/typescript-lib/value-wrapper';

interface ObsidianLibWrapper {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Initialization and test isolation replace the realm shared-state bag.
  __obsidianLib: GenericObject;
}

const OBSIDIAN_LIB_GLOBAL_NAME = '__obsidianLib';

/**
 * Retrieves or creates a shared-state {@link ValueWrapper} for a given key on `globalThis.__obsidianLib`.
 *
 * @typeParam T - The type of the shared state value.
 * @param key - The key to store or retrieve the shared state under.
 * @param defaultValue - The default value to use if the shared state does not exist yet.
 * @returns The {@link ValueWrapper} that stores the shared state.
 */
export function getObsidianLibState<T>(key: string, defaultValue: T): ValueWrapper<T> {
  return (getObsidianLibBag()[key] ??= ValueWrapper.of(defaultValue)) as ValueWrapper<T>;
}

/**
 * Clears the shared-state bag on `globalThis.__obsidianLib`.
 *
 * Intended for test isolation: call it before each test so accumulated state (queues,
 * registered handlers, etc.) does not leak between tests.
 */
export function resetObsidianLibState(): void {
  // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
  (globalThis as Partial<ObsidianLibWrapper>).__obsidianLib = {};
}

/**
 * Returns the bag, creating it as a plain data property when this realm has none.
 *
 * A copy older than `6.0.0` kept its state under another global and installed `__obsidianLib` as an accessor onto
 * it. Adopting that accessor would make whether this copy shares state with older ones depend on which plugin loaded
 * first, so it is replaced by this copy's own bag. The older copies keep reading their own global, untouched.
 *
 * @returns The shared-state bag.
 */
function getObsidianLibBag(): GenericObject {
  // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
  const wrapper = globalThis as Partial<ObsidianLibWrapper>;
  const descriptor = Object.getOwnPropertyDescriptor(wrapper, OBSIDIAN_LIB_GLOBAL_NAME);
  if (descriptor && !('value' in descriptor)) {
    Object.defineProperty(wrapper, OBSIDIAN_LIB_GLOBAL_NAME, {
      configurable: true,
      enumerable: true,
      value: {},
      writable: true
    });
  }

  wrapper.__obsidianLib ??= {};
  return wrapper.__obsidianLib;
}
