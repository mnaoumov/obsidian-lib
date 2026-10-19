/**
 * @file
 *
 * The lifecycle broadcast every {@link PluginBase} makes: `obsidian-lib:plugin-loaded` when it has
 * finished loading and `obsidian-lib:plugin-unloaded` when it goes away. Each is also triggered under its
 * legacy name, `obsidian-dev-utils:plugin-loaded` / `obsidian-dev-utils:plugin-unloaded`, for good.
 *
 * Obsidian gives a plugin no way to learn that ANOTHER plugin was enabled or disabled — there is no such
 * event on `app.plugins`, and a plugin's own `Events` source cannot help a listener that does not yet hold
 * the instance. So the broadcast goes through `app.workspace`, which is one object every plugin in the
 * vault can reach. Deliberately NOT the `globalThis.__obsidianDevUtils` bag the rest of the library shares
 * its state through: a listener there needs its own copy of this library, and these events are meant to be
 * consumable by any plugin at all.
 *
 * The names are past tense because a broadcast states something that has already happened. `loaded` in
 * particular carries a guarantee: it is triggered only after every API the plugin declares has been
 * published, so a listener may call them immediately.
 *
 * Both the event names and {@link PluginLifecycleEventPayload} are a CROSS-VERSION CONTRACT. Copies of
 * this library at different versions publish and consume them side by side in one vault, so neither may
 * change incompatibly: plain data only, and new payload fields only ever added.
 *
 * That contract is also PUBLISHED, as of the `Plugin API protocol` guide: third-party plugins that will
 * never install this library are told to hardcode these strings and this payload shape. Publishing it
 * added no new constraint — the cross-copy one above already forbade every change an outsider could
 * notice.
 *
 * The rename to `obsidian-lib:` is additive for that reason. Already-released copies emit and hear only the
 * legacy names, so a current copy triggers both, and relays an older copy's legacy event to the current
 * name ({@link registerPluginLifecycleEventRelay}). A listener therefore needs exactly ONE of the two names:
 * the legacy one hears every copy ever released, and the current one hears every copy whenever at least one
 * current copy is loaded to relay. Listening on both hears every current copy twice.
 */

import type {
  App,
  Component
} from 'obsidian';

import { getObsidianDevUtilsState } from '../obsidian-dev-utils-state.ts';

/**
 * The name of either lifecycle event.
 */
export type PluginLifecycleEventName = typeof PLUGIN_LOADED_EVENT_NAME | typeof PLUGIN_UNLOADED_EVENT_NAME;

/**
 * The payload of {@link PLUGIN_LOADED_EVENT_NAME} and {@link PLUGIN_UNLOADED_EVENT_NAME}.
 *
 * Plain data by design — no class instances and no types owned by this library — because it crosses
 * between independently bundled copies of it, and between plugins that do not use it at all.
 */
export interface PluginLifecycleEventPayload {
  /**
   * The contract versions the plugin published, empty when it publishes no API.
   *
   * An array rather than a single version because a provider may publish several contract versions side by
   * side, so consumers pinned to an older range keep working across a breaking change.
   *
   * The API objects themselves are deliberately NOT here. A handle delivered by a one-shot event is a
   * probe: it answers "now" and never says when "now" changed, and one that outlives the provider is
   * exactly the stale handle the plugin-api registry's revocable handles exist to prevent. Reach the API
   * through `watchPluginApi` instead, whose reference stays correct across unload and re-enable.
   */
  readonly apiVersions: readonly string[];

  /**
   * The ids of the plugins this one declares as mandatory dependencies, empty when it declares none.
   *
   * Present so the relationship can be read from the OTHER end: a provider has no way to ask who depends
   * on it — the registry only answers consumer-to-provider — and "which installed plugins need this one"
   * is what lets a provider's settings tab tell the user why it is in their vault at all.
   */
  readonly dependencyPluginIds: readonly string[];

  /**
   * The plugin's `manifest.id`.
   */
  readonly pluginId: string;

  /**
   * The plugin's `manifest.name`, for display.
   */
  readonly pluginName: string;

  /**
   * The plugin's `manifest.version`.
   */
  readonly pluginVersion: string;
}

/**
 * Parameters for {@link registerPluginLifecycleEventRelay}.
 */
export interface RegisterPluginLifecycleEventRelayParams {
  /**
   * The Obsidian app instance whose workspace carries the broadcast.
   */
  readonly app: App;

  /**
   * The component that owns the relay: it relays while the component is loaded.
   */
  readonly component: Component;
}

/**
 * Parameters for {@link triggerPluginLifecycleEvent}.
 */
export interface TriggerPluginLifecycleEventParams {
  /**
   * The Obsidian app instance whose workspace carries the broadcast.
   */
  readonly app: App;

  /**
   * The event to trigger.
   */
  readonly name: PluginLifecycleEventName;

  /**
   * The payload describing the plugin.
   */
  readonly payload: PluginLifecycleEventPayload;
}

type AnnouncedPayloads = Record<PluginLifecycleEventName, WeakSet<object>>;

/**
 * Triggered once a plugin has finished loading AND published every API it declares, so a listener may call
 * those APIs immediately.
 *
 * Namespaced by the package name rather than by an abbreviation of it: the event is global to the vault
 * and aimed at plugin authors who have never heard of this library, so the prefix has to identify itself.
 */
export const PLUGIN_LOADED_EVENT_NAME = 'obsidian-lib:plugin-loaded';

/**
 * Triggered as a plugin unloads — whether the user disabled it, uninstalled it, or Obsidian is shutting
 * down. Its APIs are revoked by the time a listener runs.
 */
export const PLUGIN_UNLOADED_EVENT_NAME = 'obsidian-lib:plugin-unloaded';

/**
 * The legacy name of {@link PLUGIN_LOADED_EVENT_NAME}, from before the library was renamed. It is still
 * triggered, for good, because older copies listen only on it.
 */
export const LEGACY_PLUGIN_LOADED_EVENT_NAME = 'obsidian-dev-utils:plugin-loaded';

/**
 * The legacy name of {@link PLUGIN_UNLOADED_EVENT_NAME}, from before the library was renamed. It is still
 * triggered, for good, because older copies listen only on it.
 */
export const LEGACY_PLUGIN_UNLOADED_EVENT_NAME = 'obsidian-dev-utils:plugin-unloaded';

/**
 * The legacy name of either lifecycle event.
 */
export type LegacyPluginLifecycleEventName = typeof LEGACY_PLUGIN_LOADED_EVENT_NAME | typeof LEGACY_PLUGIN_UNLOADED_EVENT_NAME;

const PLUGIN_LIFECYCLE_EVENT_NAMES: readonly PluginLifecycleEventName[] = [PLUGIN_LOADED_EVENT_NAME, PLUGIN_UNLOADED_EVENT_NAME];

const LEGACY_PLUGIN_LIFECYCLE_EVENT_NAMES: Readonly<Record<PluginLifecycleEventName, LegacyPluginLifecycleEventName>> = {
  [PLUGIN_LOADED_EVENT_NAME]: LEGACY_PLUGIN_LOADED_EVENT_NAME,
  [PLUGIN_UNLOADED_EVENT_NAME]: LEGACY_PLUGIN_UNLOADED_EVENT_NAME
};

/**
 * The shared-state key of the payloads already announced under the current names. Shared between copies of
 * this library, so it is versioned: a change to what it holds takes a new key.
 */
const ANNOUNCED_PAYLOADS_STATE_KEY = 'pluginLifecycleAnnouncedPayloadsV1';

declare module 'obsidian' {
  interface Workspace {
    /**
     * Subscribes to a plugin finishing its load, or to one unloading.
     *
     * @param name - Should be {@link PLUGIN_LOADED_EVENT_NAME} or {@link PLUGIN_UNLOADED_EVENT_NAME}, or one of their
     *   legacy names.
     * @param callback - The callback receiving the plugin's payload.
     * @param context - The context passed as `this` to the `callback` function.
     * @returns The event reference.
     */
    /*
     * An augmentation of an EXISTING overload set has to stay a method signature. A property member does not merge into
     * `Workspace.on`'s overloads, and TypeScript says so nowhere near here: the declaration itself compiles, and every
     * call site loses the signature instead — `on(PLUGIN_LOADED_EVENT_NAME, ...)` fails with "the last overload gave the
     * following error". The rule reports this one without a fix for the same reason, so the disable below is the answer
     * rather than a deferral.
     */
    // eslint-disable-next-line @typescript-eslint/method-signature-style -- A property member does not merge into an existing overload set. See above.
    on(
      name: LegacyPluginLifecycleEventName | PluginLifecycleEventName,
      callback: (payload: PluginLifecycleEventPayload) => unknown,
      context?: unknown
    ): EventRef;
  }
}

/**
 * Relays an older copy's lifecycle events to the current names, for as long as `component` is loaded.
 *
 * An older copy of this library emits only the legacy names, so without a relay a listener on
 * {@link PLUGIN_LOADED_EVENT_NAME} would never hear about it. The relay listens on each legacy name and
 * re-triggers the current one, unless the payload was already announced under it. A current copy announces
 * under both names (see {@link triggerPluginLifecycleEvent}) and marks its payload first, so its own legacy
 * echo is skipped. Every plugin built on this library registers a relay, and they share one set of marks,
 * so the first relay to see an older copy's event re-triggers it and the rest skip it.
 *
 * @param params - The {@link RegisterPluginLifecycleEventRelayParams}.
 */
export function registerPluginLifecycleEventRelay(params: RegisterPluginLifecycleEventRelayParams): void {
  const { app, component } = params;
  for (const name of PLUGIN_LIFECYCLE_EVENT_NAMES) {
    component.registerEvent(app.workspace.on(LEGACY_PLUGIN_LIFECYCLE_EVENT_NAMES[name], (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) {
        return;
      }

      const announcedPayloads = getAnnouncedPayloads(name);
      if (announcedPayloads.has(payload)) {
        return;
      }

      announcedPayloads.add(payload);
      app.workspace.trigger(name, payload);
    }));
  }
}

/**
 * Triggers one of the two lifecycle events on the app's workspace, under its current name and then under
 * its legacy name.
 *
 * Both, so a listener written against either name hears every plugin built on this library: older copies
 * listen only on the legacy name. The current name goes first and the payload is marked before either, so
 * the relays (see {@link registerPluginLifecycleEventRelay}) skip the legacy echo instead of announcing the
 * plugin a second time.
 *
 * Otherwise a thin typed wrapper over `Workspace.trigger`, which accepts any event name and any arguments,
 * so that the one place a payload is constructed is checked against {@link PluginLifecycleEventPayload}.
 *
 * @param params - The {@link TriggerPluginLifecycleEventParams}.
 */
export function triggerPluginLifecycleEvent(params: TriggerPluginLifecycleEventParams): void {
  const { app, name, payload } = params;
  getAnnouncedPayloads(name).add(payload);
  app.workspace.trigger(name, payload);
  app.workspace.trigger(LEGACY_PLUGIN_LIFECYCLE_EVENT_NAMES[name], payload);
}

function getAnnouncedPayloads(name: PluginLifecycleEventName): WeakSet<object> {
  return getObsidianDevUtilsState<AnnouncedPayloads>(ANNOUNCED_PAYLOADS_STATE_KEY, {
    [PLUGIN_LOADED_EVENT_NAME]: new WeakSet(),
    [PLUGIN_UNLOADED_EVENT_NAME]: new WeakSet()
  }).value[name];
}
