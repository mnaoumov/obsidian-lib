/**
 * @file
 *
 * Typed access to the API of a THIRD-PARTY plugin: one that publishes nothing through this library's registry.
 *
 * A plugin built on this library publishes a versioned contract (`getPluginApis()`), and a consumer reaches it
 * through `watchPluginApi` (`./plugin-api.ts`). Most plugins a consumer wants to talk to — `Dataview`,
 * `Templater`, `Notebook Navigator` — are not built on it, so their API hangs off the plugin instance under a
 * name of their own choosing, and every consumer used to reach it by hand through `app.plugins` with a cast.
 *
 * A {@link ThirdPartyPluginAdapter} says ONCE, for one plugin, how to get from its instance to its typed API,
 * and VERIFIES the shape on the way, so a release that renamed what the adapter reads is "not there" rather
 * than a `Cannot read properties of undefined` from inside a callback. Everything else here is generic:
 *
 * - {@link getThirdPartyPluginApi} answers "now", for a one-shot use.
 * - {@link watchThirdPartyPluginApi} answers "now" for as long as a component lives: its ref re-reads on every
 *   `app.plugins` `changed` and every `obsidian-lib:plugin-loaded` / `-unloaded` broadcast, so an OPTIONAL
 *   dependency is a ref whose `value` is `null` while the plugin is absent, and becomes the API the moment it
 *   is enabled.
 * - {@link waitForThirdPartyPluginApi} and {@link requireThirdPartyPluginApi} are the one-shot waits, built on
 *   `waitForPlugin` / `requirePlugin` (`./plugin-instance.ts`), so they share that module's availability
 *   classification, its notice and its repair buttons.
 * - A REQUIRED dependency is declared through `PluginBase.getPluginDependencies()` as a
 *   {@link ThirdPartyPluginDependency} (built by {@link createThirdPartyPluginDependency}), and the plugin gate
 *   keeps `onloadImpl` from running while it is missing, too old or the wrong shape — the same treatment an
 *   own-plugin dependency gets.
 *
 * Availability is {@link PluginAvailability}, read from Obsidian `1.15.1` as `plugin-instance.ts` documents:
 * an instance whose `onload` is still running reads as `loading`, never as available. An adapter's
 * `getApi` returning `null` reads as {@link PluginAvailability.ShapeMismatch}.
 */

import type { AsyncEventSource } from '@mnaoumov/typescript-lib/async-events';
import type {
  App,
  Component,
  Plugin
} from 'obsidian';
import type { Except } from 'type-fest';

import { mixinAsyncEvents } from '@mnaoumov/typescript-lib/async-events';

import type { PluginDependencyBase } from '../components/plugin-gate-component.ts';
import type {
  GetPluginAvailabilityParams,
  RequirePluginParams,
  WaitForPluginParams
} from './plugin-instance.ts';

import {
  getLoadedPlugin,
  getPluginAvailability,
  PluginAvailability,
  PLUGINS_CHANGED_EVENT_NAME,
  requirePlugin,
  waitForPlugin
} from './plugin-instance.ts';
import {
  PLUGIN_LOADED_EVENT_NAME,
  PLUGIN_UNLOADED_EVENT_NAME
} from './plugin-lifecycle-events.ts';

/**
 * Parameters for {@link createThirdPartyPluginDependency}.
 *
 * @typeParam TApi - The adapter's API type.
 */
export interface CreateThirdPartyPluginDependencyParams<TApi extends object> {
  /**
   * The adapter of the required plugin.
   */
  readonly adapter: ThirdPartyPluginAdapter<TApi>;

  /**
   * The oldest release the dependent works with. Defaults to the adapter's own
   * {@link ThirdPartyPluginAdapter.minPluginVersion}; a dependent may only raise it.
   */
  readonly minPluginVersion?: string;

  /**
   * A localized sentence saying what the dependent does with the plugin, shown in the settings banner.
   */
  readonly reason: DocumentFragment | string;
}

/**
 * Parameters for {@link getThirdPartyPluginApi} and {@link getThirdPartyPluginAvailability}.
 *
 * @typeParam TApi - The adapter's API type.
 */
export interface GetThirdPartyPluginApiParams<TApi extends object> {
  /**
   * The adapter of the plugin.
   */
  readonly adapter: ThirdPartyPluginAdapter<TApi>;

  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The oldest release the caller works with. Defaults to the adapter's own
   * {@link ThirdPartyPluginAdapter.minPluginVersion}.
   */
  readonly minPluginVersion?: string;
}

/**
 * Parameters for {@link getThirdPartyPluginAvailability}.
 *
 * @typeParam TApi - The adapter's API type.
 */
export type GetThirdPartyPluginAvailabilityParams<TApi extends object> = GetThirdPartyPluginApiParams<TApi>;

/**
 * Parameters for {@link requireThirdPartyPluginApi}.
 *
 * @typeParam TApi - The adapter's API type.
 */
export interface RequireThirdPartyPluginApiParams<TApi extends object> extends Except<RequirePluginParams, 'app' | 'isPlugin' | 'minPluginVersion' | 'pluginId' | 'pluginName'>, GetThirdPartyPluginApiParams<TApi> {}

/**
 * How to get from one third-party plugin's instance to its typed API.
 *
 * An adapter is plain data plus one function, so it can be a module-level constant shared by every consumer,
 * and adding a plugin means adding one adapter.
 *
 * @typeParam TApi - The plugin's API, typed by the adapter's author and verified by {@link getApi}.
 */
export interface ThirdPartyPluginAdapter<TApi extends object> {
  /**
   * Reads the typed API off a running instance of the plugin, VERIFYING its shape.
   *
   * Return `null` when the instance does not carry the members the adapter types, which is what a release
   * that renamed or reshaped them looks like. Never cast: a cast asserts a shape nothing checked.
   *
   * @param plugin - The running instance, whose `onload` has settled.
   * @returns The API, or `null` when the instance is not the shape the adapter expects.
   */
  readonly getApi: (plugin: Plugin) => null | TApi;

  /**
   * The oldest release of the plugin the adapter was verified against, compared with its `manifest.version`.
   * A release below it reads as {@link PluginAvailability.Outdated}.
   */
  readonly minPluginVersion?: string;

  /**
   * The `manifest.id` of the plugin.
   */
  readonly pluginId: string;

  /**
   * The display name of the plugin, shown to the user.
   */
  readonly pluginName: string;
}

/**
 * A live reference to a third-party plugin's API.
 *
 * @typeParam TApi - The adapter's API type.
 */
export interface ThirdPartyPluginApiRef<TApi extends object> extends AsyncEventSource<ThirdPartyPluginApiRefEventMap> {
  /**
   * Whether the API can be used right now, and if not, why. Read at the moment of reading.
   */
  readonly availability: PluginAvailability;

  /**
   * The API, or `null` when it is not available right now. `null` during the consumer's `onload` may only
   * mean the plugin has not loaded yet; the value becomes the API on its own once it has.
   */
  readonly value: null | TApi;
}

/**
 * The events a {@link ThirdPartyPluginApiRef} fires.
 */
export interface ThirdPartyPluginApiRefEventMap {
  /**
   * Fired whenever {@link ThirdPartyPluginApiRef.value} changes, including when it becomes `null` because the
   * plugin was disabled or reloaded.
   */
  readonly change: [];
}

/**
 * A third-party plugin another plugin cannot work without, declared through
 * `PluginBase.getPluginDependencies()`.
 *
 * Built by {@link createThirdPartyPluginDependency}, which copies the adapter's id and name.
 */
export interface ThirdPartyPluginDependency extends PluginDependencyBase {
  /**
   * The adapter the gate reads the dependency's API through.
   */
  readonly adapter: ThirdPartyPluginAdapter<object>;
}

/**
 * Parameters for {@link waitForThirdPartyPluginApi}.
 *
 * @typeParam TApi - The adapter's API type.
 */
export interface WaitForThirdPartyPluginApiParams<TApi extends object> extends Except<WaitForPluginParams, 'app' | 'isPlugin' | 'minPluginVersion' | 'pluginId'>, GetThirdPartyPluginApiParams<TApi> {}

/**
 * Parameters for {@link watchThirdPartyPluginApi}.
 *
 * @typeParam TApi - The adapter's API type.
 */
export interface WatchThirdPartyPluginApiParams<TApi extends object> extends GetThirdPartyPluginApiParams<TApi> {
  /**
   * The component owning the watch. Its unload stops it.
   */
  readonly component: Component;
}

/**
 * Holds the parameters, so the {@link mixinAsyncEvents} mixin has a real base to extend.
 */
abstract class ThirdPartyPluginApiWatchBase {
  // A `protected` constructor is not assignable to `AbstractConstructor<object>`, which is what
  // `mixinAsyncEvents` accepts, so this stays public even though only the subclass below calls it.
  public constructor(protected readonly params: GetThirdPartyPluginApiParams<object>) {}
}

class ThirdPartyPluginApiRefImpl<TApi extends object> extends mixinAsyncEvents<ThirdPartyPluginApiRefEventMap>()(ThirdPartyPluginApiWatchBase) implements ThirdPartyPluginApiRef<TApi> {
  public get availability(): PluginAvailability {
    return getThirdPartyPluginAvailability(this.params);
  }

  public get value(): null | TApi {
    return this.currentValue;
  }

  private currentValue: null | TApi = null;

  /**
   * Re-reads the API, firing `change` only when it actually changed.
   */
  public refresh(): void {
    const value = getThirdPartyPluginApi(this.params) as null | TApi;
    if (value === this.currentValue) {
      return;
    }

    this.currentValue = value;
    this.trigger('change');
  }
}

/**
 * Builds the declaration of a required third-party plugin, for `PluginBase.getPluginDependencies()`.
 *
 * @typeParam TApi - The adapter's API type.
 * @param params - The {@link CreateThirdPartyPluginDependencyParams}.
 * @returns The dependency.
 */
export function createThirdPartyPluginDependency<TApi extends object>(params: CreateThirdPartyPluginDependencyParams<TApi>): ThirdPartyPluginDependency {
  const minPluginVersion = params.minPluginVersion ?? params.adapter.minPluginVersion;
  return {
    adapter: params.adapter,
    pluginId: params.adapter.pluginId,
    pluginName: params.adapter.pluginName,
    reason: params.reason,
    ...(minPluginVersion !== undefined && { minPluginVersion })
  };
}

/**
 * Returns a third-party plugin's typed API when the plugin is {@link PluginAvailability.Available}, and `null`
 * otherwise.
 *
 * @typeParam TApi - The adapter's API type.
 * @param params - The {@link GetThirdPartyPluginApiParams}.
 * @returns The API, or `null`.
 */
export function getThirdPartyPluginApi<TApi extends object>(params: GetThirdPartyPluginApiParams<TApi>): null | TApi {
  const plugin = getLoadedPlugin(toPluginAvailabilityParams(params));
  return plugin === null ? null : params.adapter.getApi(plugin);
}

/**
 * Reads whether a third-party plugin's API can be used right now, and if not, why.
 *
 * @typeParam TApi - The adapter's API type.
 * @param params - The {@link GetThirdPartyPluginApiParams}.
 * @returns The {@link PluginAvailability}; {@link PluginAvailability.ShapeMismatch} when the adapter does not
 * recognize the running instance.
 */
export function getThirdPartyPluginAvailability<TApi extends object>(params: GetThirdPartyPluginAvailabilityParams<TApi>): PluginAvailability {
  return getPluginAvailability(toPluginAvailabilityParams(params));
}

/**
 * Checks whether a dependency declared through `PluginBase.getPluginDependencies()` is a third-party one.
 *
 * @param dependency - The declared dependency.
 * @returns Whether it carries an adapter.
 */
export function isThirdPartyPluginDependency(dependency: PluginDependencyBase): dependency is ThirdPartyPluginDependency {
  return 'adapter' in dependency;
}

/**
 * Waits for a third-party plugin's API, asking the user to install, enable or update the plugin while it is
 * not available. Settles once; see `requirePlugin`.
 *
 * @typeParam TApi - The adapter's API type.
 * @param params - The {@link RequireThirdPartyPluginApiParams}.
 * @returns A {@link Promise} resolving with the API.
 */
export async function requireThirdPartyPluginApi<TApi extends object>(params: RequireThirdPartyPluginApiParams<TApi>): Promise<TApi> {
  const plugin = await requirePlugin({
    ...params,
    ...toPluginAvailabilityParams(params),
    pluginName: params.adapter.pluginName
  });
  return getVerifiedApi(params.adapter, plugin);
}

/**
 * Waits for a third-party plugin's API to become available. Settles once; see `waitForPlugin`.
 *
 * @typeParam TApi - The adapter's API type.
 * @param params - The {@link WaitForThirdPartyPluginApiParams}.
 * @returns A {@link Promise} resolving with the API.
 * @throws `PluginInstanceUnavailableError` when the timeout elapses.
 */
export async function waitForThirdPartyPluginApi<TApi extends object>(params: WaitForThirdPartyPluginApiParams<TApi>): Promise<TApi> {
  const plugin = await waitForPlugin({
    ...params,
    ...toPluginAvailabilityParams(params)
  });
  return getVerifiedApi(params.adapter, plugin);
}

/**
 * Watches a third-party plugin's API and returns a live {@link ThirdPartyPluginApiRef}.
 *
 * The ref re-reads on every `app.plugins` `changed` and every library lifecycle broadcast, so it follows the
 * plugin through enable, disable, update and reload with no polling. This is the shape of an OPTIONAL
 * dependency: read `ref.value` where the integration is used, and treat `null` as "not there".
 *
 * @typeParam TApi - The adapter's API type.
 * @param params - The {@link WatchThirdPartyPluginApiParams}.
 * @returns The live reference.
 */
export function watchThirdPartyPluginApi<TApi extends object>(params: WatchThirdPartyPluginApiParams<TApi>): ThirdPartyPluginApiRef<TApi> {
  const { app, component } = params;
  const ref = new ThirdPartyPluginApiRefImpl<TApi>(params);
  function refresh(): void {
    ref.refresh();
  }
  component.registerEvent(app.plugins.on(PLUGINS_CHANGED_EVENT_NAME, refresh));
  component.registerEvent(app.workspace.on(PLUGIN_LOADED_EVENT_NAME, refresh));
  component.registerEvent(app.workspace.on(PLUGIN_UNLOADED_EVENT_NAME, refresh));
  ref.refresh();
  return ref;
}

function getVerifiedApi<TApi extends object>(adapter: ThirdPartyPluginAdapter<TApi>, plugin: Plugin): TApi {
  const api = adapter.getApi(plugin);
  if (api === null) {
    // Unreachable through the waits, whose availability check already ran `getApi`; kept so a wrong adapter
    // fails here by name rather than handing back `null` typed as the API.
    throw new Error(`The plugin "${adapter.pluginId}" does not expose the API its adapter expects.`);
  }

  return api;
}

function toPluginAvailabilityParams<TApi extends object>(params: GetThirdPartyPluginApiParams<TApi>): GetPluginAvailabilityParams {
  const { adapter, app } = params;
  const minPluginVersion = params.minPluginVersion ?? adapter.minPluginVersion;
  return {
    app,
    isPlugin: (plugin: Plugin): plugin is Plugin => adapter.getApi(plugin) !== null,
    pluginId: adapter.pluginId,
    ...(minPluginVersion !== undefined && { minPluginVersion })
  };
}
