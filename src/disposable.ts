/**
 * @file
 *
 * Ties a {@link Disposable} or an {@link AsyncDisposable} to the lifetime of any Obsidian {@link Component}, a
 * {@link Plugin} included.
 *
 * `ComponentEx.registerDisposable` and `ComponentEx.registerAsyncDisposable` delegate here, so the free functions and
 * the methods cannot diverge. They exist as free functions because no plugin base class extends `ComponentEx`.
 */

import type { Component } from 'obsidian';

import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  dispose,
  disposeAsync
} from '@mnaoumov/typescript-lib/disposable';
import { Plugin } from 'obsidian';

import { registerPluginAsyncCleanup } from './plugin/plugin-async-cleanup.ts';

/**
 * Registers an {@link AsyncDisposable} so its disposal starts when the component unloads, and returns it unchanged.
 *
 * Obsidian's unload is synchronous, so nothing awaits the disposal. When the component is a {@link Plugin}, the
 * disposal is tracked under the plugin id, and the plugin's next instance (a `PluginBase` one) waits for it before it
 * loads, as `PluginBase.registerAsyncCleanup` does. On any other component the disposal runs detached, and a failure
 * is reported, never rethrown.
 *
 * @typeParam TAsyncDisposable - The type of the async disposable.
 * @param component - The component whose unload starts the disposal.
 * @param asyncDisposable - The async disposable to register.
 * @returns The same async disposable, for chaining.
 */
export function registerAsyncDisposable<TAsyncDisposable extends AsyncDisposable>(
  component: Component,
  asyncDisposable: TAsyncDisposable
): TAsyncDisposable {
  if (component instanceof Plugin) {
    registerPluginAsyncCleanup({
      cleanup: () => disposeAsync(asyncDisposable),
      component,
      pluginId: component.manifest.id
    });
  } else {
    component.register(() => {
      invokeAsyncSafely(() => disposeAsync(asyncDisposable));
    });
  }
  return asyncDisposable;
}

/**
 * Registers a {@link Disposable} so it is disposed when the component unloads, and returns it unchanged.
 *
 * The recurring "tie a disposable to the component's lifecycle, then keep using it" idiom, for any component:
 * `registerDisposable(plugin, await registerVirtualFile(...))`. The disposable is disposed on
 * {@link Component.unload}, or earlier if the caller disposes it directly, since disposal is expected to be
 * idempotent. A component that is never loaded never unloads, so its registered disposables are never disposed.
 *
 * @typeParam TDisposable - The type of the disposable.
 * @param component - The component whose unload disposes the disposable.
 * @param disposable - The disposable to register.
 * @returns The same disposable, for chaining.
 */
export function registerDisposable<TDisposable extends Disposable>(component: Component, disposable: TDisposable): TDisposable {
  component.register(() => {
    dispose(disposable);
  });
  return disposable;
}
