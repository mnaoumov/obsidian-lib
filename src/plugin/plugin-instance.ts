/**
 * @file
 *
 * Another plugin's INSTANCE: whether it is there, waiting for it, and asking the user to bring it in.
 *
 * This is the path for a plugin that publishes nothing through the library's registry, which is most of
 * them. A provider that does publish is better reached through `watchPluginApi` (`./plugin-api.ts`): its
 * reference is live, version-negotiated and revoked when the provider goes away, none of which a bare
 * instance offers. And a plugin that must STOP running when another one goes away declares it through
 * `PluginBase.getPluginDependencies()`, whose gate owns that teardown — {@link requirePlugin} is a one-shot
 * wait, not a second dependency system.
 *
 * What "loaded" can and cannot mean, read from Obsidian `1.15.1`:
 *
 * - `Plugins.loadPlugin` stores the instance in `app.plugins.plugins` BEFORE it awaits `plugin.load()`, and
 *   `Plugin.load` sets `_loaded` before it awaits `onload()`. So `app.plugins.getPlugin(id)` can return a
 *   plugin whose `onload` is still running, and `_loaded` cannot tell the two apart.
 *   `Plugins.enablePlugin` brackets the load with `loadingPluginId`, which is the one signal that does, so
 *   an instance whose id is `loadingPluginId` reads as {@link PluginAvailability.Loading}.
 * - `onload` having settled is the most anything can promise. A plugin that starts further work from
 *   `onload` without awaiting it, or waits for layout-ready, is "loaded" before that work is done, and
 *   Obsidian has no hook saying every plugin has finished initializing. A plugin built on this library
 *   says more through the `obsidian-lib:plugin-loaded` broadcast, which follows its published APIs.
 * - `app.plugins` is an `Events` source that triggers `changed`, debounced by one macrotask, after every
 *   enable, disable, install, uninstall and manifest reload. That is what a wait subscribes to, so nothing
 *   here polls. It fires after `enablePlugin` returned, when `loadingPluginId` is `null` again.
 *
 * A type argument alone is a caller's ASSERTION about the instance, not a check: nothing at runtime knows
 * what `TPlugin` is. Pass `isPlugin` to have the shape verified; an instance failing it reads as
 * {@link PluginAvailability.ShapeMismatch}, the usual sign of a release that renamed what the caller uses.
 */

import type {
  App,
  EventRef,
  Events,
  Plugin
} from 'obsidian';

import { convertAsyncToSync } from '@mnaoumov/typescript-lib/async';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  ButtonComponent,
  Component
} from 'obsidian';

import type { PluginNoticeComponent } from '../components/plugin-notice-component.ts';

import { PluginEnableRefusedError } from '../community-plugins.ts';
import { PluginNoticeMode } from '../components/plugin-notice-component.ts';
import { CssClass } from '../css-class.ts';
import {
  asCodeBlock,
  createFragmentWithCodeBlocks
} from '../html-element.ts';
import { t } from '../i18n/i18n.ts';
import { openSettingTab } from '../settings-modal.ts';
import {
  comparePluginVersionWithMinimum,
  installAndEnablePlugin,
  PluginVersionComparison,
  updatePlugin
} from './plugin-install-state.ts';
import { PLUGIN_LOADED_EVENT_NAME } from './plugin-lifecycle-events.ts';

/**
 * How long {@link waitForPlugin} waits by default before giving up.
 */
const DEFAULT_WAIT_FOR_PLUGIN_TIMEOUT_IN_MILLISECONDS = 10_000;

/**
 * The event `app.plugins` triggers after every enable, disable, install, uninstall and manifest reload.
 */
const PLUGINS_CHANGED_EVENT_NAME = 'changed';

/**
 * The id of Obsidian's community plugins settings tab.
 */
const COMMUNITY_PLUGINS_SETTING_TAB_ID = 'community-plugins';

/**
 * Whether another plugin's instance can be used right now, and if not, why.
 */
export enum PluginAvailability {
  /**
   * Loaded, `onload` settled, and every declared requirement met.
   */
  Available = 'available',

  /**
   * Running at a release whose `manifest.version` cannot be parsed, while the caller declared a
   * {@link GetPluginAvailabilityParams.minPluginVersion}. Counts as unavailable, because failing closed is the
   * safe direction.
   */
  InvalidVersion = 'invalidVersion',

  /**
   * The instance exists but its `onload` has not settled yet.
   */
  Loading = 'loading',

  /**
   * Installed but neither enabled nor running.
   */
  NotEnabled = 'notEnabled',

  /**
   * Not installed in this vault.
   */
  NotInstalled = 'notInstalled',

  /**
   * Installed and enabled in the configuration, but no instance is running. At startup that is a plugin
   * Obsidian has not reached yet; later it is one that failed to load, or one switched off by a disable that
   * does not touch the configuration.
   */
  NotLoaded = 'notLoaded',

  /**
   * Running at a release older than the caller's {@link GetPluginAvailabilityParams.minPluginVersion}.
   */
  Outdated = 'outdated',

  /**
   * Running, but the caller's {@link GetPluginAvailabilityParams.isPlugin} rejected the instance.
   */
  ShapeMismatch = 'shapeMismatch'
}

/**
 * Parameters for {@link getLoadedPlugin}.
 *
 * @typeParam TPlugin - The plugin type the caller expects.
 */
export type GetLoadedPluginParams<TPlugin extends Plugin = Plugin> = GetPluginAvailabilityParams<TPlugin>;

/**
 * Parameters for {@link getPluginAvailability}.
 *
 * @typeParam TPlugin - The plugin type the caller expects.
 */
export interface GetPluginAvailabilityParams<TPlugin extends Plugin = Plugin> {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * Verifies that the running instance is the shape the caller uses. Without it, `TPlugin` is an
   * assertion nothing checks.
   *
   * @param plugin - The running instance.
   * @returns Whether the instance is a `TPlugin`.
   */
  readonly isPlugin?: (plugin: Plugin) => plugin is TPlugin;

  /**
   * The oldest release of the plugin the caller works with, compared with its `manifest.version`. This is
   * a plugin RELEASE, never an API contract version: a provider publishing a versioned contract is reached
   * through `watchPluginApi`'s `apiVersionRange` instead.
   */
  readonly minPluginVersion?: string;

  /**
   * The `manifest.id` of the plugin.
   */
  readonly pluginId: string;
}

/**
 * Parameters for the {@link PluginInstanceUnavailableError} constructor.
 */
export interface PluginInstanceUnavailableErrorConstructorParams {
  /**
   * Why the plugin was unavailable when the wait gave up.
   */
  readonly availability: PluginAvailability;

  /**
   * The `manifest.id` of the plugin.
   */
  readonly pluginId: string;
}

/**
 * Parameters for {@link requirePlugin}.
 *
 * @typeParam TPlugin - The plugin type the caller expects.
 */
export interface RequirePluginParams<TPlugin extends Plugin = Plugin> extends GetPluginAvailabilityParams<TPlugin> {
  /**
   * Ends the wait early; the promise rejects with the signal's reason.
   */
  readonly abortSignal?: AbortSignal;

  /**
   * The component owning the wait and its notice. Its unload ends both, rejecting the promise.
   */
  readonly component: Component;

  /**
   * The display name of the required plugin, shown to the user.
   */
  readonly pluginName: string;

  /**
   * The asking plugin's notice component, which shows what is missing and the button that fixes it.
   */
  readonly pluginNoticeComponent: PluginNoticeComponent;

  /**
   * The display name of the asking plugin, named in the notice.
   */
  readonly requestingPluginName: string;

  /**
   * How long to wait before giving up. By default the wait lasts until the user repairs the plugin, the
   * {@link RequirePluginParams.abortSignal} aborts or the {@link RequirePluginParams.component} unloads.
   */
  readonly timeoutInMilliseconds?: number;
}

/**
 * Parameters for {@link waitForPlugin}.
 *
 * @typeParam TPlugin - The plugin type the caller expects.
 */
export interface WaitForPluginParams<TPlugin extends Plugin = Plugin> extends GetPluginAvailabilityParams<TPlugin> {
  /**
   * Ends the wait early; the promise rejects with the signal's reason.
   */
  readonly abortSignal?: AbortSignal;

  /**
   * A component whose unload ends the wait, rejecting the promise. Pass the waiting plugin, or the
   * component that will use the instance, so a wait never outlives its consumer.
   */
  readonly component?: Component;

  /**
   * How long to wait before rejecting with a {@link PluginInstanceUnavailableError}.
   *
   * @default 10000
   */
  readonly timeoutInMilliseconds?: number;
}

/**
 * Parameters for the internal wait both public waits share.
 *
 * @typeParam TPlugin - The plugin type the caller expects.
 */
interface WaitForAvailabilityParams<TPlugin extends Plugin> extends WaitForPluginParams<TPlugin> {
  /**
   * Called once when the wait settles, either way, after every listener has been removed.
   */
  readonly onSettled?: () => void;

  /**
   * Called on every re-evaluation while the plugin is still unavailable, including the first.
   *
   * @param availability - The availability just read.
   */
  readonly onUnavailable?: (availability: PluginAvailability) => void;

  /**
   * The timeout, or `null` for none.
   */
  readonly resolvedTimeoutInMilliseconds: null | number;
}

/**
 * Thrown when a plugin did not become available before a wait gave up.
 */
export class PluginInstanceUnavailableError extends Error {
  /**
   * Why the plugin was unavailable when the wait gave up.
   */
  public readonly availability: PluginAvailability;

  /**
   * The `manifest.id` of the plugin.
   */
  public readonly pluginId: string;

  /**
   * Creates an instance of {@link PluginInstanceUnavailableError}.
   *
   * @param params - The constructor parameters.
   */
  public constructor(params: PluginInstanceUnavailableErrorConstructorParams) {
    super(`Plugin "${params.pluginId}" is not available: ${params.availability}.`);
    this.name = 'PluginInstanceUnavailableError';
    this.availability = params.availability;
    this.pluginId = params.pluginId;
  }
}

/**
 * Returns another plugin's instance when it is {@link PluginAvailability.Available}, and `null` otherwise.
 *
 * Unlike `app.plugins.getPlugin`, it never returns an instance whose `onload` is still running.
 *
 * @typeParam TPlugin - The plugin type the caller expects; checked only through `isPlugin`.
 * @param params - The {@link GetPluginAvailabilityParams}.
 * @returns The instance, or `null`.
 */
export function getLoadedPlugin<TPlugin extends Plugin = Plugin>(params: GetLoadedPluginParams<NoInfer<TPlugin>>): null | TPlugin {
  return getPluginAvailability(params) === PluginAvailability.Available ? (params.app.plugins.getPlugin(params.pluginId) as TPlugin) : null;
}

/**
 * Reads whether another plugin's instance can be used right now, and if not, why.
 *
 * @typeParam TPlugin - The plugin type the caller expects.
 * @param params - The {@link GetPluginAvailabilityParams}.
 * @returns The {@link PluginAvailability}.
 */
export function getPluginAvailability<TPlugin extends Plugin = Plugin>(params: GetPluginAvailabilityParams<NoInfer<TPlugin>>): PluginAvailability {
  const {
    app,
    isPlugin,
    minPluginVersion,
    pluginId
  } = params;
  const plugin = app.plugins.getPlugin(pluginId);

  if (plugin === null) {
    if (!Object.hasOwn(app.plugins.manifests, pluginId)) {
      return PluginAvailability.NotInstalled;
    }

    return app.plugins.enabledPlugins.has(pluginId) ? PluginAvailability.NotLoaded : PluginAvailability.NotEnabled;
  }

  if (app.plugins.loadingPluginId === pluginId) {
    return PluginAvailability.Loading;
  }

  if (minPluginVersion !== undefined) {
    const comparison = comparePluginVersionWithMinimum(plugin.manifest.version, minPluginVersion);
    if (comparison === PluginVersionComparison.BelowMinimum) {
      return PluginAvailability.Outdated;
    }

    if (comparison === PluginVersionComparison.Invalid) {
      return PluginAvailability.InvalidVersion;
    }
  }

  return isPlugin && !isPlugin(plugin) ? PluginAvailability.ShapeMismatch : PluginAvailability.Available;
}

/**
 * Waits for another plugin to become {@link PluginAvailability.Available}, asking the user to repair it
 * while it is not.
 *
 * Resolves at once when it already is. Otherwise, once the workspace layout is ready — before that, a
 * plugin Obsidian has not loaded yet is indistinguishable from a missing one — a notice says what is wrong
 * and offers the matching repair: install, enable, or update, plus a way to the community plugins list.
 * The notice follows the state as it changes and goes away when the wait settles. A repair that fails is
 * reported and leaves the wait running, so the user can try again or fix it by hand.
 *
 * The promise settles ONCE. It does not watch the plugin afterwards: a consumer that must stop when the
 * plugin goes away declares a dependency through `PluginBase.getPluginDependencies()` instead.
 *
 * @typeParam TPlugin - The plugin type the caller expects; checked only through `isPlugin`.
 * @param params - The {@link RequirePluginParams}.
 * @returns A {@link Promise} resolving with the instance.
 * @throws The abort reason, or an error naming the unloaded component, when the wait is ended early.
 * @throws {@link PluginInstanceUnavailableError} When {@link RequirePluginParams.timeoutInMilliseconds} elapses.
 */
export async function requirePlugin<TPlugin extends Plugin = Plugin>(params: RequirePluginParams<NoInfer<TPlugin>>): Promise<TPlugin> {
  const { app } = params;
  let shownAvailability: null | PluginAvailability = null;
  // `Loading` is never shown, so it stands in for "not read yet".
  let latestAvailability = PluginAvailability.Loading;
  let hideNotice: (() => void) | null = null;
  let isSettled = false;

  function show(availability: PluginAvailability): void {
    if (isSettled || !app.workspace.layoutReady || availability === shownAvailability || availability === PluginAvailability.Loading) {
      return;
    }

    hideNotice?.();
    shownAvailability = availability;
    const notice = params.pluginNoticeComponent.showNotice(createRequirementFragment(params, availability), {
      mode: PluginNoticeMode.Separate,
      shouldHideOnClick: false
    });
    hideNotice = (): void => {
      notice.hide();
    };
  }

  if (!app.workspace.layoutReady) {
    app.workspace.onLayoutReady(() => {
      show(latestAvailability);
    });
  }

  return await waitForAvailability({
    ...params,
    onSettled: () => {
      isSettled = true;
      hideNotice?.();
    },
    onUnavailable: (availability) => {
      latestAvailability = availability;
      show(availability);
    },
    resolvedTimeoutInMilliseconds: params.timeoutInMilliseconds ?? null
  });
}

/**
 * Waits for another plugin to become {@link PluginAvailability.Available}.
 *
 * Resolves at once when it already is, which covers a consumer reloaded after its dependency. Otherwise it
 * re-reads the state on every `app.plugins` `changed` and every `obsidian-lib:plugin-loaded` broadcast, so a
 * plugin enabled, updated or reloaded later is picked up with no polling. It subscribes before its first
 * read, so a change landing in between cannot be missed. Every listener and timer is removed when it settles.
 *
 * @typeParam TPlugin - The plugin type the caller expects; checked only through `isPlugin`.
 * @param params - The {@link WaitForPluginParams}.
 * @returns A {@link Promise} resolving with the instance.
 * @throws The abort reason, or an error naming the unloaded component, when the wait is ended early.
 * @throws {@link PluginInstanceUnavailableError} When the timeout elapses, carrying the availability at that moment.
 */
export async function waitForPlugin<TPlugin extends Plugin = Plugin>(params: WaitForPluginParams<NoInfer<TPlugin>>): Promise<TPlugin> {
  return await waitForAvailability({
    ...params,
    resolvedTimeoutInMilliseconds: params.timeoutInMilliseconds ?? DEFAULT_WAIT_FOR_PLUGIN_TIMEOUT_IN_MILLISECONDS
  });
}

function createRequirementFragment<TPlugin extends Plugin>(params: RequirePluginParams<TPlugin>, availability: PluginAvailability): DocumentFragment {
  const {
    app,
    minPluginVersion = '',
    pluginId,
    pluginName,
    pluginNoticeComponent,
    requestingPluginName
  } = params;
  const interpolation = {
    minPluginVersion,
    pluginName: asCodeBlock(requestingPluginName),
    requiredPluginName: asCodeBlock(pluginName)
  };

  return createFragment((fragmentEl) => {
    fragmentEl.append(createFragmentWithCodeBlocks(t(($) => {
      switch (availability) {
        case PluginAvailability.InvalidVersion: {
          return $.obsidianLib.pluginRequirement.invalidVersionNotice;
        }
        case PluginAvailability.NotEnabled: {
          return $.obsidianLib.pluginRequirement.notEnabledNotice;
        }
        case PluginAvailability.NotInstalled: {
          return $.obsidianLib.pluginRequirement.notInstalledNotice;
        }
        case PluginAvailability.NotLoaded: {
          return $.obsidianLib.pluginRequirement.notLoadedNotice;
        }
        case PluginAvailability.Outdated: {
          return $.obsidianLib.pluginRequirement.outdatedNotice;
        }
        default: {
          return $.obsidianLib.pluginRequirement.shapeMismatchNotice;
        }
      }
    }, interpolation)));

    const buttonsEl = fragmentEl.createDiv({
      cls: [CssClass.LibraryName, CssClass.PluginSuggestionNoticeButtons]
    });

    switch (availability) {
      case PluginAvailability.NotEnabled:
      case PluginAvailability.NotInstalled: {
        new ButtonComponent(buttonsEl)
          .setButtonText(t(($) =>
            availability === PluginAvailability.NotEnabled
              ? $.obsidianLib.pluginSuggestion.enable
              : $.obsidianLib.pluginSuggestion.install
          ))
          .setCta()
          .onClick(convertAsyncToSync(async () => {
            await runRepair(async () => {
              await installAndEnablePlugin({
                app,
                pluginId,
                pluginName,
                pluginNoticeComponent
              });
            });
          }));
        break;
      }
      case PluginAvailability.NotLoaded: {
        new ButtonComponent(buttonsEl)
          .setButtonText(t(($) => $.obsidianLib.pluginRequirement.enable, { requiredPluginName: pluginName }))
          .setCta()
          .onClick(convertAsyncToSync(async () => {
            await runRepair(async () => {
              await loadEnabledPlugin(params);
            });
          }));
        break;
      }
      default: {
        new ButtonComponent(buttonsEl)
          .setButtonText(t(($) => $.obsidianLib.pluginDependency.update, { dependencyPluginName: pluginName }))
          .setCta()
          .onClick(convertAsyncToSync(async () => {
            await runRepair(async () => {
              await updatePlugin({
                app,
                pluginId,
                pluginName,
                pluginNoticeComponent,
                requestingPluginName
              });
            });
          }));
        break;
      }
    }

    new ButtonComponent(buttonsEl)
      .setButtonText(t(($) => $.obsidianLib.pluginRequirement.openCommunityPlugins))
      .onClick(() => {
        openSettingTab({
          app,
          tabId: COMMUNITY_PLUGINS_SETTING_TAB_ID
        });
      });
  });
}

/**
 * Loads a plugin that is enabled in the configuration but not running, the one case
 * `installAndEnablePlugin` treats as already done.
 *
 * @typeParam TPlugin - The plugin type the caller expects.
 * @param params - The requirement.
 * @returns A {@link Promise} that resolves once the plugin is loaded.
 */
async function loadEnabledPlugin<TPlugin extends Plugin>(params: RequirePluginParams<TPlugin>): Promise<void> {
  const {
    app,
    pluginId,
    pluginName,
    pluginNoticeComponent
  } = params;

  try {
    if (!await app.plugins.enablePluginAndSave(pluginId)) {
      throw new PluginEnableRefusedError(pluginId);
    }
  } catch (error) {
    pluginNoticeComponent.showNotice(createFragmentWithCodeBlocks(
      t(($) => $.obsidianLib.pluginRequirement.enableFailed, { requiredPluginName: asCodeBlock(pluginName) })
    ));
    throw error;
  }
}

/**
 * Runs a repair the user clicked. Its failure has already been shown as a notice, and the wait it belongs to
 * keeps running so the user can try again, so it is logged rather than rethrown into the click handler.
 *
 * @param repair - The repair.
 * @returns A {@link Promise} that resolves once the repair has run.
 */
async function runRepair(repair: () => Promise<void>): Promise<void> {
  try {
    await repair();
  } catch (error) {
    console.error(error);
  }
}

async function waitForAvailability<TPlugin extends Plugin>(params: WaitForAvailabilityParams<TPlugin>): Promise<TPlugin> {
  const {
    abortSignal,
    app,
    component,
    onSettled,
    onUnavailable,
    pluginId,
    resolvedTimeoutInMilliseconds
  } = params;

  abortSignal?.throwIfAborted();

  return await new Promise<TPlugin>((resolve, reject) => {
    let isSettled = false;
    let timeoutId: null | number = null;
    let removeWaitComponent: (() => void) | null = null;
    const eventRefs: [Events, EventRef][] = [];

    function cleanUp(): void {
      isSettled = true;
      removeWaitComponent?.();
      removeWaitComponent = null;
      for (const [source, eventRef] of eventRefs) {
        source.offref(eventRef);
      }
      eventRefs.length = 0;
      abortSignal?.removeEventListener('abort', handleAbort);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      onSettled?.();
    }

    function fail(error: Error): void {
      if (isSettled) {
        return;
      }

      cleanUp();
      reject(error);
    }

    function handleAbort($event: Event): void {
      const reason: unknown = castTo<AbortSignal>($event.target).reason;
      fail(reason instanceof Error ? reason : new Error(String(reason), { cause: reason }));
    }

    // No settled guard: settling removes both listeners, and nothing else calls this.
    function check(): void {
      const availability = getPluginAvailability(params);
      if (availability === PluginAvailability.Available) {
        const plugin = app.plugins.getPlugin(pluginId) as TPlugin;
        cleanUp();
        resolve(plugin);
        return;
      }

      onUnavailable?.(availability);
    }

    // Subscribe BEFORE the first read, so a change landing between the read and the subscription cannot be
    // missed.
    eventRefs.push(
      [app.plugins, app.plugins.on(PLUGINS_CHANGED_EVENT_NAME, check)],
      [app.workspace, app.workspace.on(PLUGIN_LOADED_EVENT_NAME, check)]
    );
    abortSignal?.addEventListener('abort', handleAbort);

    if (component) {
      // A child rather than `component.register`, because a component cannot forget a registered callback:
      // removing the child on settle is what keeps a long-lived consumer from collecting one per wait.
      const waitComponent = new Component();
      waitComponent.register(() => {
        fail(new Error(`The wait for plugin "${pluginId}" ended because its component unloaded.`));
      });
      component.addChild(waitComponent);
      removeWaitComponent = (): void => {
        component.removeChild(waitComponent);
      };
    }

    if (resolvedTimeoutInMilliseconds !== null) {
      timeoutId = window.setTimeout(() => {
        fail(
          new PluginInstanceUnavailableError({
            availability: getPluginAvailability(params),
            pluginId
          })
        );
      }, resolvedTimeoutInMilliseconds);
    }

    check();
  });
}
