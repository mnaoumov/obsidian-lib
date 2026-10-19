/**
 * @file
 *
 * LEGACY: provides access to the process-wide shared-state bag on the `__obsidianDevUtils` global, also reachable as
 * `__obsidianLib`. The legacy name is the retired `obsidian-dev-utils` package's; it stays, and stays the authority,
 * because plugins bundling an older copy read and write the same bag, so it is a wire format rather than a name to
 * copy. `__obsidianLib` is an accessor onto it, never a second object. New generic state belongs in
 * `@mnaoumov/typescript-lib/typescript-lib-state` (the `Symbol.for('@mnaoumov/typescript-lib/state')` slot).
 *
 * The bag is stored on `globalThis.__obsidianDevUtils`, i.e. on the global object of the realm in
 * which this library is loaded. Because a function's `globalThis` resolves to its defining
 * realm (not the caller's), every consumer that bundles the library in the main Obsidian renderer
 * shares the same bag, regardless of which window is currently active. This intentionally replaces
 * the previous `App`-scoped storage, so callers no longer need to pass an `App` instance.
 *
 * The generic, non-Obsidian state (the debuggers, the `debug` instance and the shared abort controller) lives in
 * `typescript-lib-state.ts` instead. {@link shareTypescriptLibStateWithObsidianDevUtilsState} links the two, so
 * plugins bundling an older copy of this library, which still keep that state here, share it with newer ones.
 */

import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';

import { getTypescriptLibStateSlot } from '@mnaoumov/typescript-lib/typescript-lib-state';
import { ValueWrapper } from '@mnaoumov/typescript-lib/value-wrapper';

interface ObsidianDevUtilsWrapper {
  __obsidianDevUtils: GenericObject;
}

/**
 * The name of the global through which the shared-state bag is also reachable, an alias of `__obsidianDevUtils`.
 */
export const OBSIDIAN_LIB_GLOBAL_NAME = '__obsidianLib';

/**
 * The keys whose state moved from `__obsidianDevUtils` to the generic shared state, and which older copies of
 * this library still keep under `__obsidianDevUtils`.
 */
const SHARED_WITH_TYPESCRIPT_LIB_STATE_KEYS = ['debug', 'debuggers', 'sharedAbortController'] as const;

/**
 * Retrieves or creates a shared-state {@link ValueWrapper} for a given key on `globalThis.__obsidianDevUtils`.
 *
 * @typeParam T - The type of the shared state value.
 * @param key - The key to store or retrieve the shared state under.
 * @param defaultValue - The default value to use if the shared state does not exist yet.
 * @returns The {@link ValueWrapper} that stores the shared state.
 */
export function getObsidianDevUtilsState<T>(key: string, defaultValue: T): ValueWrapper<T> {
  return (getObsidianDevUtilsBag()[key] ??= ValueWrapper.of(defaultValue)) as ValueWrapper<T>;
}

/**
 * Clears the shared-state bag on `globalThis.__obsidianDevUtils`.
 *
 * Intended for test isolation: call it before each test so accumulated state (debuggers, queues,
 * registered handlers, etc.) does not leak between tests.
 */
export function resetObsidianDevUtilsState(): void {
  // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
  (globalThis as Partial<ObsidianDevUtilsWrapper>).__obsidianDevUtils = {};
}

/**
 * Makes the generic shared state and `__obsidianDevUtils` hold the same {@link ValueWrapper} for each key that
 * moved between them.
 *
 * A wrapper already under `__obsidianDevUtils` wins, because an older copy of this library loaded first and its
 * callers already hold that instance. Otherwise the generic wrapper is published under `__obsidianDevUtils`, for
 * older copies loaded later and for the devtools console.
 */
export function shareTypescriptLibStateWithObsidianDevUtilsState(): void {
  const bag = getObsidianDevUtilsBag();
  const values = getTypescriptLibStateSlot().values;
  for (const key of SHARED_WITH_TYPESCRIPT_LIB_STATE_KEYS) {
    const legacyWrapper = bag[key] as undefined | ValueWrapper;
    if (legacyWrapper) {
      values[key] = legacyWrapper;
      continue;
    }

    const wrapper = values[key];
    if (wrapper) {
      bag[key] = wrapper;
    }
  }
}

function getObsidianDevUtilsBag(): GenericObject {
  // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
  const wrapper = globalThis as Partial<ObsidianDevUtilsWrapper>;
  wrapper.__obsidianDevUtils ??= {};
  installObsidianLibAlias();
  return wrapper.__obsidianDevUtils;
}

/**
 * Makes `globalThis.__obsidianLib` an accessor onto `globalThis.__obsidianDevUtils`, so the two names are always the
 * same object.
 *
 * The legacy name stays the authority, because every older copy of this library only ever sees it, and code outside
 * the library assigns it directly. An accessor follows such an assignment, where a second data property would drift.
 * Another copy may already have installed the alias; any copy's accessor behaves the same, so it is left as it is.
 */
function installObsidianLibAlias(): void {
  // eslint-disable-next-line obsidianmd/no-global-this -- The shared state intentionally lives on the realm global.
  const realmGlobal = globalThis as Partial<ObsidianDevUtilsWrapper>;
  if (Object.hasOwn(realmGlobal, OBSIDIAN_LIB_GLOBAL_NAME)) {
    return;
  }

  Object.defineProperty(realmGlobal, OBSIDIAN_LIB_GLOBAL_NAME, {
    configurable: true,
    enumerable: false,
    get(): GenericObject | undefined {
      return realmGlobal.__obsidianDevUtils;
    },
    set(value: GenericObject): void {
      realmGlobal.__obsidianDevUtils = value;
    }
  });
}
