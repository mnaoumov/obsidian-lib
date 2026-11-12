/**
 * @file
 *
 * Async cleanup that outlives a plugin instance, so the next instance of the same plugin can await it.
 *
 * Obsidian's `onunload` is synchronous and nothing awaits what it starts. Read from Obsidian `1.15.1`:
 * `Plugins.unloadPlugin` calls the old instance's `unload()` and returns, and `enablePlugin` then constructs the new
 * instance and awaits its `load()`. So on a disable / enable, a reload or an update while enabled, work like closing
 * an IndexedDB connection is still in flight when the new instance starts, and the new instance can open a database
 * the old one still holds.
 *
 * The registry here closes that gap without owning the reload lifecycle: a cleanup starts when the component it is
 * registered on unloads, its promise is kept realm-wide under the plugin id, and the next instance awaits it, bounded
 * by a timeout, before it starts. `PluginBase` does both halves itself.
 *
 * The registry lives in the realm-global shared-state bag under the versioned key `pluginAsyncCleanupsV1`, because the
 * old instance and the new one may bundle different copies of this library. It is a wire format between those copies:
 * a plain `Map` from plugin id to a `Promise<void>` that never rejects. A change of meaning moves to a new key.
 */

import type { Component } from 'obsidian';
import type { Promisable } from 'type-fest';

import { printError } from '@mnaoumov/typescript-lib/error';

import { getObsidianLibState } from '../obsidian-lib-state.ts';

/**
 * The shared-state key of the pending cleanups. Versioned, because it is a wire format between copies of this library.
 */
export const PLUGIN_ASYNC_CLEANUPS_STATE_KEY = 'pluginAsyncCleanupsV1';

/**
 * How long a new plugin instance waits for the previous instance's cleanups by default.
 */
export const DEFAULT_PLUGIN_ASYNC_CLEANUP_TIMEOUT_IN_MILLISECONDS = 10_000;

/**
 * How long a new plugin instance waits for the previous instance's cleanups, by default, before it shows a notice that
 * its load is paused. Shorter waits show nothing, so the usual few milliseconds never flash a notice.
 */
export const DEFAULT_PLUGIN_ASYNC_CLEANUP_NOTICE_DELAY_IN_MILLISECONDS = 500;

/**
 * Parameters for {@link didPluginAsyncCleanupsSettle}.
 */
export interface DidPluginAsyncCleanupsSettleParams {
  /**
   * The id of the plugin whose pending cleanups to await.
   */
  readonly pluginId: string;

  /**
   * How long to wait before giving up. Defaults to {@link DEFAULT_PLUGIN_ASYNC_CLEANUP_TIMEOUT_IN_MILLISECONDS}.
   */
  readonly timeoutInMilliseconds?: number;
}

/**
 * An async cleanup.
 */
export type PluginAsyncCleanup = () => Promisable<void>;

/**
 * Parameters for {@link registerPluginAsyncCleanup}.
 */
export interface RegisterPluginAsyncCleanupParams {
  /**
   * The cleanup to run.
   */
  readonly cleanup: PluginAsyncCleanup;

  /**
   * The component whose unload starts the cleanup.
   */
  readonly component: Component;

  /**
   * The id of the plugin the cleanup belongs to, which the next instance waits under.
   */
  readonly pluginId: string;
}

/**
 * Parameters for {@link trackPluginAsyncCleanup}.
 */
export interface TrackPluginAsyncCleanupParams {
  /**
   * The cleanup to run now.
   */
  readonly cleanup: PluginAsyncCleanup;

  /**
   * The id of the plugin the cleanup belongs to.
   */
  readonly pluginId: string;
}

interface TrackedCleanupEntry {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Assigned once the self-removing promise exists.
  promise?: Promise<void>;
}

/**
 * Awaits every cleanup still in flight for the plugin, bounded by a timeout.
 *
 * Resolves at once when nothing is pending. Never rejects.
 *
 * @param params - The parameters.
 * @returns `true` if every pending cleanup settled in time, `false` if the timeout was reached first.
 */
export async function didPluginAsyncCleanupsSettle(params: DidPluginAsyncCleanupsSettleParams): Promise<boolean> {
  const promise = getPendingCleanups().get(params.pluginId);
  if (!promise) {
    return true;
  }

  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<false>((resolve) => {
    timeoutId = window.setTimeout(() => {
      resolve(false);
    }, params.timeoutInMilliseconds ?? DEFAULT_PLUGIN_ASYNC_CLEANUP_TIMEOUT_IN_MILLISECONDS);
  });

  try {
    return await Promise.race([promise.then(() => true), timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Checks whether a plugin has cleanups still in flight.
 *
 * @param pluginId - The plugin id.
 * @returns Whether any cleanup registered under the id has not settled yet.
 */
export function hasPendingPluginAsyncCleanups(pluginId: string): boolean {
  return getPendingCleanups().has(pluginId);
}

/**
 * Registers an async cleanup that starts when the component unloads and that the next instance of the plugin awaits.
 *
 * The cleanup runs exactly once, on the component's unload. Register it on the component whose lifetime matches the
 * resource: a `PluginBase` subclass calls `registerAsyncCleanup` instead, which scopes it to the feature surface.
 *
 * @param params - The parameters.
 */
export function registerPluginAsyncCleanup(params: RegisterPluginAsyncCleanupParams): void {
  params.component.register(() => {
    trackPluginAsyncCleanup({
      cleanup: params.cleanup,
      pluginId: params.pluginId
    });
  });
}

/**
 * Runs an async cleanup now and tracks it under the plugin id until it settles.
 *
 * A cleanup that throws or rejects is printed and counts as settled, so a failing cleanup never stops the next
 * instance from loading.
 *
 * @param params - The parameters.
 */
export function trackPluginAsyncCleanup(params: TrackPluginAsyncCleanupParams): void {
  const pendingCleanups = getPendingCleanups();
  const previousPromise = pendingCleanups.get(params.pluginId);
  const cleanupPromise = runCleanupSafely(params);
  // Never rejects: `runCleanupSafely` catches, and so did whichever call tracked `previousPromise`.
  const entry: TrackedCleanupEntry = {};
  entry.promise = (async (): Promise<void> => {
    await Promise.all([previousPromise, cleanupPromise]);
    // A later call may have chained onto this entry already; only the latest entry removes itself.
    if (pendingCleanups.get(params.pluginId) === entry.promise) {
      pendingCleanups.delete(params.pluginId);
    }
  })();
  pendingCleanups.set(params.pluginId, entry.promise);
}

function getPendingCleanups(): Map<string, Promise<void>> {
  return getObsidianLibState(PLUGIN_ASYNC_CLEANUPS_STATE_KEY, new Map<string, Promise<void>>()).value;
}

async function runCleanupSafely(params: TrackPluginAsyncCleanupParams): Promise<void> {
  try {
    await params.cleanup();
  } catch (error) {
    printError(new Error(`Async cleanup of plugin ${params.pluginId} failed`, { cause: error }));
  }
}
