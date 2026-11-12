/**
 * @file
 *
 * Base class for Obsidian plugins using a component-based architecture.
 *
 * PluginBase registers universal components (context, i18n, error handling, abort signal, lifecycle events, debug).
 */

import type {
  Component,
  IconName
} from 'obsidian';
import type { Promisable } from 'type-fest';

import { mixinAsyncEvents } from '@mnaoumov/typescript-lib/async-events';
import {
  printError,
  SilentError
} from '@mnaoumov/typescript-lib/error';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { Plugin } from 'obsidian';

import type {
  PluginConflict,
  PluginDependency
} from '../components/plugin-gate-component.ts';
import type { TranslationsMap } from '../i18n/i18n.ts';
import type { PluginApiDeclaration } from './plugin-api.ts';
import type {
  PluginEventMap,
  PluginEventSource
} from './plugin-event-source.ts';
import type { PluginLifecycleEventPayload } from './plugin-lifecycle-events.ts';

import { AppActiveFileProvider } from '../active-file-provider.ts';
import { CommandHandlerComponent } from '../command-handlers/command-handler-component.ts';
import { UnlockActiveNoteCommandHandler } from '../command-handlers/unlock-active-note-command-handler.ts';
import { PluginCommandRegistrar } from '../command-registrar.ts';
import { PluginEnableRefusedError } from '../community-plugins.ts';
import { AbortSignalComponent } from '../components/abort-signal-component.ts';
import { AsyncErrorHandlerComponent } from '../components/async-error-handler-component.ts';
import { ComponentEx } from '../components/component-ex.ts';
import { ConsoleDebugComponent } from '../components/console-debug-component.ts';
import { MenuEventRegistrarComponent } from '../components/menu-event-registrar-component.ts';
import { NotebookNavigatorMenuEventRegistrarComponent } from '../components/notebook-navigator-menu-event-registrar-component.ts';
import { PluginContextComponent } from '../components/plugin-context-component.ts';
import { PluginGateComponent } from '../components/plugin-gate-component.ts';
import {
  PluginNoticeComponent,
  PluginNoticeMode
} from '../components/plugin-notice-component.ts';
import { PluginSettingsComponentBase } from '../components/plugin-settings-component.ts';
import { PluginDataHandler } from '../data-handler.ts';
import { getObsidianLibDebugger } from '../debug.ts';
import {
  initI18N,
  t
} from '../i18n/i18n.ts';
import { defaultTranslationsMap } from '../i18n/locales/translations-map.ts';
import { ResourceLockComponent } from '../resource-lock.ts';
import { publishPluginApi } from './plugin-api.ts';
import {
  DEFAULT_PLUGIN_ASYNC_CLEANUP_NOTICE_DELAY_IN_MILLISECONDS,
  DEFAULT_PLUGIN_ASYNC_CLEANUP_TIMEOUT_IN_MILLISECONDS,
  didPluginAsyncCleanupsSettle,
  hasPendingPluginAsyncCleanups,
  registerPluginAsyncCleanup
} from './plugin-async-cleanup.ts';
import { PluginEventSourceImpl } from './plugin-event-source.ts';
import {
  PLUGIN_LOADED_EVENT_NAME,
  PLUGIN_UNLOADED_EVENT_NAME,
  triggerPluginLifecycleEvent
} from './plugin-lifecycle-events.ts';

/**
 * The universal components owned by {@link PluginBase}, keyed by the name of the accessor exposing
 * each one. Every member is optional because a component only exists once {@link PluginBase.onload}
 * has created it.
 */
interface PluginBaseComponents {
  readonly abortSignalComponent?: AbortSignalComponent;
  readonly asyncErrorHandlerComponent?: AsyncErrorHandlerComponent;
  readonly commandHandlerComponent?: CommandHandlerComponent;
  readonly consoleDebugComponent?: ConsoleDebugComponent;
  readonly pluginContextComponent?: PluginContextComponent;
  readonly pluginGateComponent?: PluginGateComponent;
  readonly pluginNoticeComponent?: PluginNoticeComponent;
  readonly pluginSettingsComponent?: PluginSettingsComponentBase<object>;
  readonly resourceLockComponent?: ResourceLockComponent;
}

/**
 * Base class for creating Obsidian plugins with a component-based architecture.
 *
 * Registers universal components automatically. Subclasses add or replace components
 * via {@link removeChild} / {@link addChild}.
 */
export abstract class PluginBase extends mixinAsyncEvents<PluginEventMap>()(Plugin) implements PluginEventSource {
  /**
   * Gets abort signal component.
   *
   * @returns abort signal component.
   */
  protected get abortSignalComponent(): AbortSignalComponent {
    return ensureNonNullable(this.components.abortSignalComponent);
  }

  /**
   * Sets abort signal component.
   *
   * @param value - Abort signal component.
   */
  protected set abortSignalComponent(value: AbortSignalComponent) {
    this.setComponent('abortSignalComponent', value);
  }

  /**
   * Gets async error handler component.
   *
   * @returns async error handler component.
   */
  protected get asyncErrorHandlerComponent(): AsyncErrorHandlerComponent {
    return ensureNonNullable(this.components.asyncErrorHandlerComponent);
  }

  /**
   * Sets async error handler component.
   *
   * @param value - Async error handler component.
   */
  protected set asyncErrorHandlerComponent(value: AsyncErrorHandlerComponent) {
    this.setComponent('asyncErrorHandlerComponent', value);
  }

  /**
   * Gets the shared command handler component. Register a plugin's commands on it via
   * {@link CommandHandlerComponent.registerCommandHandlers} rather than constructing your own
   * {@link CommandHandlerComponent} — the app-backed active-file provider, command registrar, menu
   * event registrar, and plugin name are already wired.
   *
   * @returns The command handler component.
   */
  protected get commandHandlerComponent(): CommandHandlerComponent {
    return ensureNonNullable(this.components.commandHandlerComponent);
  }

  /**
   * Sets the command handler component.
   *
   * @param value - The command handler component.
   */
  protected set commandHandlerComponent(value: CommandHandlerComponent) {
    this.setComponent('commandHandlerComponent', value);
  }

  /**
   * Gets console debug component.
   *
   * @returns console debug component.
   */
  protected get consoleDebugComponent(): ConsoleDebugComponent {
    return ensureNonNullable(this.components.consoleDebugComponent);
  }

  /**
   * Sets console debug component.
   *
   * @param value - Console debug component.
   */
  protected set consoleDebugComponent(value: ConsoleDebugComponent) {
    this.setComponent('consoleDebugComponent', value);
  }

  /**
   * Gets plugin context component (plugin ID, debug controller, library styles).
   *
   * @returns plugin context component.
   */
  protected get pluginContextComponent(): PluginContextComponent {
    return ensureNonNullable(this.components.pluginContextComponent);
  }

  /**
   * Sets plugin context component.
   *
   * @param value - Plugin context component.
   */
  protected set pluginContextComponent(value: PluginContextComponent) {
    this.setComponent('pluginContextComponent', value);
  }

  /**
   * Gets the gate holding the plugin's feature surface up or down.
   *
   * Reach for it from a settings tab to render the overlap banner for a
   * {@link components/plugin-gate-component!PluginConflictSeverity.Warn} conflict — the one
   * banner the library cannot place itself, because a running plugin builds its own settings tab.
   *
   * Readable throughout {@link onloadImpl}, including its synchronous prefix, which is where a settings
   * tab is built. That is deliberate rather than incidental: adding the gate is what runs
   * {@link onloadImpl}, so {@link onload} assigns this field before adding it.
   *
   * @returns The plugin gate component.
   */
  protected get pluginGateComponent(): PluginGateComponent {
    return ensureNonNullable(this.components.pluginGateComponent);
  }

  /**
   * Sets the plugin gate component.
   *
   * @param value - The plugin gate component.
   */
  protected set pluginGateComponent(value: PluginGateComponent) {
    this.setComponent('pluginGateComponent', value);
  }

  /**
   * Gets plugin notice component.
   *
   * @returns plugin notice component.
   */
  protected get pluginNoticeComponent(): PluginNoticeComponent {
    return ensureNonNullable(this.components.pluginNoticeComponent);
  }

  /**
   * Sets plugin notice component.
   *
   * @param value - Plugin notice component.
   */
  protected set pluginNoticeComponent(value: PluginNoticeComponent) {
    this.setComponent('pluginNoticeComponent', value);
  }

  /**
   * Gets plugin settings component.
   *
   * @returns plugin settings component.
   */
  protected get pluginSettingsComponent(): PluginSettingsComponentBase<object> {
    return ensureNonNullable(this.components.pluginSettingsComponent);
  }

  /**
   * Sets plugin settings component.
   *
   * @param value - Plugin settings component.
   */
  protected set pluginSettingsComponent(value: PluginSettingsComponentBase<object>) {
    this.setComponent('pluginSettingsComponent', value);
  }

  /**
   * Gets the editor lock component, used to lock notes read-only during long operations. Owned by
   * the plugin, so its locks are released automatically when the plugin unloads.
   *
   * @returns Editor lock component.
   */
  protected get resourceLockComponent(): ResourceLockComponent {
    return ensureNonNullable(this.components.resourceLockComponent);
  }

  /**
   * Sets the editor lock component.
   *
   * @param value - Editor lock component.
   */
  protected set resourceLockComponent(value: ResourceLockComponent) {
    this.setComponent('resourceLockComponent', value);
  }

  private readonly components: PluginBaseComponents = {};

  // Everything the SUBCLASS owns: what `onloadImpl` adds, and what it adds later.
  //
  // A second wrapper rather than one, because the two tiers have opposite lifetimes. The universal
  // components have to OUTLIVE a lost dependency — they are what shows the notice naming the plugin that
  // went away and renders the button that brings it back — while the subclass's surface is exactly what
  // must stop running. Unloading one wrapper holding both would silence the plugin at the moment it most
  // needs to speak.
  //
  // Always present, never null, and REPLACED rather than emptied when the surface is torn down. That keeps
  // `addChild` callable at every point in the plugin's life, exactly as it was before the tiers existed:
  // A child added before the gate opens is queued and loaded when it does, which is what `ComponentEx`
  // already does for any child added to a not-yet-loaded component.
  private gatedWrapperComponent = new ComponentEx();

  // Whether a feature surface of this instance has ever been torn down. Until one has, every cleanup still pending
  // under this plugin id belongs to the PREVIOUS instance, which `onload` has already waited for, so the first surface
  // load must not wait for it a second time. After a timeout it is still pending, and a second wait doubled the
  // timeout and showed its notices twice.
  private hasUnloadedFeatureSurface = false;

  // The payload broadcast when this plugin finished loading, kept so the matching unloaded broadcast
  // describes the same plugin without re-deriving it from a surface that has since been torn down. Null
  // whenever no loaded broadcast is outstanding, which is what keeps the two events paired.
  private lifecycleEventPayload: null | PluginLifecycleEventPayload = null;

  // The library's own components, which outlive any dependency.
  private readonly universalWrapperComponent = new ComponentEx();

  /**
   * Adds a child component.
   *
   * The child is added to the internal wrapper holding the subclass's own surface, which {@link onload}
   * creates and loads before calling {@link onloadImpl}. So a child added during {@link onloadImpl} is
   * loaded immediately, children-first, and is usable by the time this method returns.
   *
   * That wrapper is torn down and rebuilt whenever the gate closes and opens again — a dependency declared
   * by {@link getPluginDependencies} going away and coming back, or a conflict declared by
   * {@link getPluginConflicts} appearing and being resolved — so a child added here lives exactly as long
   * as the plugin's feature surface does. Adding one while the surface is down is still legitimate — it is
   * queued and loaded when the surface next comes up, the way {@link ComponentEx.addChild} already queues
   * a child added to a not-yet-loaded component.
   *
   * This is the SUBCLASS's door, and the only one it has: the universal components {@link onload} registers
   * take a private route onto a different wrapper. So anything observing this method — a test counting its
   * calls, a patch wrapping it — sees exactly the children the subclass added, and none of the library's.
   * Before the two tiers existed one door carried both, and a consumer counting the total is the one thing
   * the split could not keep working.
   *
   * @typeParam TComponent - The type of component to add.
   * @param component - The component instance to add.
   * @returns The added component.
   */
  public override addChild<TComponent extends Component>(component: TComponent): TComponent {
    return this.gatedWrapperComponent.addChild(component);
  }

  /**
   * Called when the external settings change.
   *
   * Override in subclass if needed. Make sure to call `await super.onExternalSettingsChange()` first.
   */
  public override async onExternalSettingsChange(): Promise<void> {
    await super.onExternalSettingsChange?.();
    await this.triggerAsync('externalSettingsChange');
  }

  /**
   * Called when the plugin is loaded.
   *
   * Orchestrates loading: registers the universal components, lets the subclass wire its own
   * components via {@link onloadImpl}, then awaits the async tail of every load.
   * Each component loads as it is added, children-first.
   *
   * Do NOT override this method. Override {@link onloadImpl} instead.
   */
  public override async onload(): Promise<void> {
    let hasLoadedUniversalWrapper = false;
    try {
      // Before anything else: the previous instance of this plugin may still be closing what this one is about to
      // open, because Obsidian runs `onunload` synchronously and awaits nothing it started. Awaited only when some are
      // pending, so a plugin with none attaches its wrapper below without yielding first.
      if (hasPendingPluginAsyncCleanups(this.manifest.id)) {
        await this.waitForPreviousAsyncCleanups();
      }

      // The wrapper is attached and loaded before anything is wired up, so every `addChild` below
      // loads its child straight away rather than queuing it.
      // That is what lets a command handler register its menu events from `onRegistered`, which
      // `registerCommandHandlers` awaits and which a registrar refuses while unloaded.
      // Attaching it up front also registers the wrapper for teardown before anything can throw.
      // The load is explicit rather than left to `addChild`, which loads the child only when the
      // plugin itself is loaded — true when Obsidian calls `load()`, but not when a caller invokes
      // `onload()` directly.
      super.addChild(this.universalWrapperComponent);
      this.universalWrapperComponent.load();
      hasLoadedUniversalWrapper = true;

      await initI18N(this.createTranslationsMap());
      this.pluginContextComponent = this.addUniversalChild(
        new PluginContextComponent({
          app: this.app,
          pluginId: this.manifest.id
        })
      );
      this.pluginNoticeComponent = this.addUniversalChild(
        new PluginNoticeComponent({
          app: this.app,
          pluginName: this.manifest.name
        })
      );
      this.asyncErrorHandlerComponent = this.addUniversalChild(new AsyncErrorHandlerComponent(this.pluginNoticeComponent));
      this.abortSignalComponent = this.addUniversalChild(new AbortSignalComponent(this.manifest.id));
      this.consoleDebugComponent = this.addUniversalChild(new ConsoleDebugComponent(this.manifest.id));
      this.resourceLockComponent = this.addUniversalChild(new ResourceLockComponent(this.app, this.manifest.id));
      // `Notebook Navigator` draws its own file tree and never raises Obsidian's `file-menu` /
      // `files-menu` events, so every plugin's context-menu items would vanish for anyone browsing
      // through it. Wired here rather than per-plugin: the bridge stays dormant when Notebook
      // Navigator is not installed, and a plugin with no file/folder handlers contributes nothing.
      const notebookNavigatorMenuEventRegistrarComponent = this.addUniversalChild(
        new NotebookNavigatorMenuEventRegistrarComponent({
          app: this.app,
          pluginName: this.manifest.name,
          submenuIcon: this.getNotebookNavigatorMenuSubmenuIcon()
        })
      );
      this.commandHandlerComponent = this.addUniversalChild(
        new CommandHandlerComponent({
          activeFileProvider: new AppActiveFileProvider(this.app),
          additionalMenuEventRegistrars: [notebookNavigatorMenuEventRegistrarComponent],
          // The component is universal; the commands registered THROUGH it are not. A subclass registers
          // its own from `onloadImpl`, closing over collaborators that belong to the feature surface — so
          // those commands must go down with the surface when the gate closes, or they sit in the palette
          // calling into torn-down objects, and are registered a second time when the gate reopens and
          // `onloadImpl` runs again.
          // Resolved on every call rather than captured here, because `unloadFeatureSurface` REPLACES the
          // wrapper instead of emptying it: each cycle's commands belong to that cycle's wrapper.
          commandLifetimeOwnerProvider: (): ComponentEx => this.gatedWrapperComponent,
          commandRegistrar: new PluginCommandRegistrar(this),
          menuEventRegistrar: this.addUniversalChild(new MenuEventRegistrarComponent(this.app)),
          pluginName: this.manifest.name
        })
      );
      // Always available; the command's own `canExecute` hides it unless the active note is locked.
      // The one command that names its owner explicitly, opting OUT of the surface-scoped default above:
      // It is the rescue for a note left locked, it closes over nothing but the universal resource-lock
      // component, and a blocked plugin is exactly when a user may need it.
      await this.commandHandlerComponent.registerCommandHandlers(() => [
        new UnlockActiveNoteCommandHandler({
          app: this.app,
          resourceLockComponent: this.resourceLockComponent
        })
      ], { lifetimeOwner: this.commandHandlerComponent });

      this.pluginSettingsComponent = this.addUniversalChild(
        new PluginSettingsComponentBase<object>({
          dataHandler: new PluginDataHandler(this),
          pluginEventSource: new PluginEventSourceImpl(this),
          pluginSettingsClass: Object
        })
      );

      // The gate. It loads the feature surface itself once every declared dependency is satisfied and no
      // declared conflict holds — which for a plugin declaring neither is immediately, synchronously,
      // before this line returns — and unloads it again if a dependency is later disabled or uninstalled,
      // or a conflicting plugin is enabled. A plugin that is blocked therefore reaches `loadWithPromises`
      // below having registered nothing of its own, with only the universal components above running to
      // explain why and to offer the repair.
      // Assigned BEFORE the add, unlike every universal component above, and that order is the whole
      // point. Adding this one is what runs `onloadImpl`, per the paragraph above, so the assignment
      // statement has not returned yet while the subclass is running — and a settings tab built there
      // reads `this.pluginGateComponent` to render the `Warn` banner. Assigning after the add would
      // make that read throw `Value is undefined` out of the getter, which is an opaque way to say
      // "too early". Nothing about child-add order moves: the sequence of `addUniversalChild` calls is
      // unchanged, and `setComponent` is a plain store.
      const pluginGateComponent = new PluginGateComponent({
        conflicts: this.getPluginConflicts(),
        dependencies: this.getPluginDependencies(),
        loadFeatureSurface: (): Promise<void> => this.loadFeatureSurface(),
        plugin: this,
        pluginNoticeComponent: this.pluginNoticeComponent,
        unloadFeatureSurface: (): void => {
          this.unloadFeatureSurface();
        }
      });
      this.pluginGateComponent = pluginGateComponent;
      this.addUniversalChild(pluginGateComponent);

      // Every child has already loaded as it was added; this awaits their accumulated async tails and
      // reports any failure as a single `AggregateError`.
      await this.universalWrapperComponent.loadWithPromises();
    } catch (error) {
      // The plugin was unloaded while its own load was suspended on an await (an update, or Hot Reload, disables and
      // re-enables it), and the resumed load unwound on the `SilentError` an unloaded component throws, which is that
      // error's purpose. Reporting it would make Obsidian log `Plugin failure` and show `Failed to load plugin` for an
      // instance that was torn down correctly and is already replaced. Any other failure in the tree still reports.
      if (hasLoadedUniversalWrapper && !this.universalWrapperComponent._loaded && isSilentErrorTree(error)) {
        getObsidianLibDebugger('PluginBase:onload')(`Plugin ${this.manifest.name} (${this.manifest.id}) was unloaded during its own load`);
        return;
      }

      printError(new Error(`Error loading plugin ${this.manifest.name} (${this.manifest.id})`, { cause: error }));
      throw error;
    }
  }

  /**
   * Called when the plugin is unloaded.
   *
   * Announces the departure on `app.workspace` so anything depending on this plugin learns of it at the
   * moment it happens, rather than discovering it later through behavior that quietly stopped.
   *
   * Do NOT override this method; put teardown on a component instead, which unloads with the plugin.
   */
  public override onunload(): void {
    this.broadcastUnloaded();
    super.onunload();
  }

  /**
   * Removes a child component.
   *
   * @typeParam TComponent - The type of component to remove.
   * @param component - The component instance to remove.
   * @returns The removed component.
   */
  public override removeChild<TComponent extends Component>(component: TComponent): TComponent {
    // Routed by ownership rather than by which tier `addChild` would have chosen, because the two do not
    // always agree: a universal component is parented directly on the universal wrapper, yet a subclass
    // replacing one goes through the same public `removeChild` as it would for its own children.
    return this.gatedWrapperComponent.hasChild(component) ? this.gatedWrapperComponent.removeChild(component) : this.universalWrapperComponent.removeChild(component);
  }

  /**
   * Provides the translations map used to initialize i18n during {@link onload}.
   *
   * Override in subclass to supply plugin-specific translations. The default returns the built-in
   * `@mnaoumov/obsidian-lib` translations. A language may map to a `LocaleLoader` instead of its translations, so
   * only the shown language is initialized; see {@link https://mnaoumov.dev/obsidian-lib/guides/translations/}.
   *
   * @returns The translations map.
   */
  protected createTranslationsMap(): TranslationsMap {
    return defaultTranslationsMap;
  }

  /**
   * Provides how long a new instance waits for the previous instance's async cleanups before it tells the user that
   * its load is paused.
   *
   * Most cleanups settle within milliseconds, so a notice on every reload would only flash. Override in subclass to
   * change it. The default is 500 milliseconds.
   *
   * @returns The delay in milliseconds.
   */
  protected getAsyncCleanupNoticeDelayInMilliseconds(): number {
    return DEFAULT_PLUGIN_ASYNC_CLEANUP_NOTICE_DELAY_IN_MILLISECONDS;
  }

  /**
   * Provides how long a new instance waits for the previous instance's async cleanups before loading anyway.
   *
   * Override in subclass to change it. The default is 10 seconds.
   *
   * @returns The timeout in milliseconds.
   */
  protected getAsyncCleanupTimeoutInMilliseconds(): number {
    return DEFAULT_PLUGIN_ASYNC_CLEANUP_TIMEOUT_IN_MILLISECONDS;
  }

  /**
   * Provides the icon shown on the plugin's parent entry in `Notebook Navigator`'s context menus.
   *
   * Override in subclass to brand that entry; the default leaves it without an icon. The entry is
   * titled with the plugin name and is added automatically — see
   * {@link NotebookNavigatorMenuEventRegistrarComponent}.
   *
   * @returns The icon, or `''` for no icon.
   */
  protected getNotebookNavigatorMenuSubmenuIcon(): IconName {
    return '';
  }

  /**
   * Provides the APIs this plugin exposes to other plugins.
   *
   * Override in subclass to publish one. The default publishes none. Called after {@link onloadImpl}, so a
   * declaration may reference anything it created; the returned declarations are published through
   * `publishPluginApi` and revoked when the plugin's feature surface unloads.
   *
   * Returning a LIST rather than a single API is deliberate: the registry supports several contract
   * versions published side by side, which is how a provider ships a breaking `2.0.0` without stranding
   * consumers still pinned to `^1`.
   *
   * Every declaration here is published BEFORE the `obsidian-lib:plugin-loaded` broadcast, which is
   * what lets a listener call these APIs the moment it hears that event.
   *
   * @returns The API declarations.
   */
  protected getPluginApis(): PluginApiDeclaration[] {
    return [];
  }

  /**
   * Provides the plugins this one refuses, or warns about, running beside.
   *
   * Override in subclass to declare an overlap. The default declares none.
   *
   * A `Block` conflict is the mirror image of a dependency: while a conflicting plugin is enabled at a
   * conflicting version, {@link onloadImpl} does not run at all and the plugin registers nothing. Declare
   * it when both plugins acting on the same operation damages the vault — there is no reliable way to win
   * that race, because whichever plugin loaded first keeps a hand on the wheel, so refusing deterministically
   * beats competing unpredictably. A `Warn` conflict declares an overlap that is merely annoying, such as a
   * duplicated command: both plugins keep running and the user is told.
   *
   * Unlike a dependency, a conflicting plugin need not publish anything — it is detected by reading its
   * installed version, which is the only thing about another plugin that reads the same regardless of load
   * order.
   *
   * @returns The declared conflicts.
   */
  protected getPluginConflicts(): PluginConflict[] {
    return [];
  }

  /**
   * Provides the plugins this one cannot work without.
   *
   * Override in subclass to declare a mandatory dependency. The default declares none, and such a plugin
   * loads exactly as it always has.
   *
   * A declared dependency is MANDATORY, unlike the offer `PluginSuggestionComponent` makes: while one is
   * missing, disabled, or too old, {@link onloadImpl} does not run at all and the plugin registers nothing
   * — no commands, no handlers, no patches. It stays enabled in Obsidian's list rather than disabling
   * itself, because the enabled set is the user's to change, and it explains itself through a notice and a
   * settings banner that installs the missing plugin in one click. The load completes the moment the
   * dependency arrives, with no restart.
   *
   * A dependency must publish an API through `publishPluginApi`, which is what makes its presence,
   * absence, version and departure all observable through one mechanism. A plugin with nothing to expose
   * can publish an empty API purely so it can be depended upon.
   *
   * @returns The declared dependencies.
   */
  protected getPluginDependencies(): PluginDependency[] {
    return [];
  }

  /**
   * Called during {@link onload} to wire plugin-specific child components.
   *
   * Override in subclass to add child components via {@link addChild}. The universal components are
   * available here. Children are loaded sequentially in the order they are added (children-first).
   *
   * @returns A {@link Promise} that resolves when the subclass load logic is complete.
   */
  protected onloadImpl(): Promisable<void> {
    return noopAsync();
  }

  /**
   * Registers an async cleanup that the next instance of this plugin awaits before it starts.
   *
   * Use it for teardown that cannot finish synchronously and must finish before the resource is opened again, such
   * as closing an IndexedDB connection. Obsidian's `onunload` is synchronous and awaits nothing, so without this a
   * reload starts the new instance while the old one still holds the database.
   *
   * Scoped like {@link addChild}: the cleanup starts when the plugin's feature surface unloads, which is on plugin
   * unload and whenever the gate closes. The next load of the plugin, and the next opening of the gate, await it,
   * bounded by {@link getAsyncCleanupTimeoutInMilliseconds}. A cleanup that throws is printed, never rethrown.
   *
   * @param cleanup - The cleanup to run.
   */
  protected registerAsyncCleanup(cleanup: () => Promisable<void>): void {
    registerPluginAsyncCleanup({
      cleanup,
      component: this.gatedWrapperComponent,
      pluginId: this.manifest.id
    });
  }

  /**
   * Stores a universal component, unloading whichever component the key held before.
   *
   * Keyed by name rather than handed the previous value because `keyof this` excludes private
   * members, so the components live in a single {@link PluginBaseComponents} bag whose keys ARE
   * indexable.
   *
   * @typeParam TKey - The key of the component to store.
   * @param key - The key of the component to store.
   * @param value - The component to store.
   */
  /**
   * Adds a component to the universal tier, which outlives any dependency.
   *
   * Private on purpose: only this class decides what is universal. A subclass adding one of its own goes
   * through {@link addChild} and lands in the gated tier, where it belongs.
   *
   * @typeParam TComponent - The type of component to add.
   * @param component - The component instance to add.
   * @returns The added component.
   */
  private addUniversalChild<TComponent extends Component>(component: TComponent): TComponent {
    return this.universalWrapperComponent.addChild(component);
  }

  /**
   * Announces on `app.workspace` that this plugin is loaded and its APIs are callable.
   */
  private broadcastLoaded(): void {
    this.lifecycleEventPayload = {
      apiVersions: this.getPluginApis().map((declaration) => declaration.apiVersion),
      dependencyPluginIds: this.getPluginDependencies().map((dependency) => dependency.pluginId),
      pluginId: this.manifest.id,
      pluginName: this.manifest.name,
      pluginVersion: this.manifest.version
    };

    triggerPluginLifecycleEvent({
      app: this.app,
      name: PLUGIN_LOADED_EVENT_NAME,
      payload: this.lifecycleEventPayload
    });
  }

  /**
   * Announces on `app.workspace` that this plugin's surface has gone away.
   *
   * Silent unless a loaded broadcast is outstanding, so the two events stay paired: a plugin that never
   * got past its dependency gate never announced itself, and must not announce a departure either.
   */
  private broadcastUnloaded(): void {
    const payload = this.lifecycleEventPayload;
    if (!payload) {
      return;
    }

    this.lifecycleEventPayload = null;
    triggerPluginLifecycleEvent({
      app: this.app,
      name: PLUGIN_UNLOADED_EVENT_NAME,
      payload
    });
  }

  /**
   * Provides the notice component for the cleanup wait.
   *
   * The wait in {@link onload} runs before the universal notice component exists, so that path gets a standalone
   * one. It is never unloaded, because unloading hides its notice, and the timeout notice must stay readable after the
   * wait. It holds nothing but the notices it shows, which hide themselves.
   *
   * @returns The notice component.
   */
  private getAsyncCleanupNoticeComponent(): PluginNoticeComponent {
    const pluginNoticeComponent = this.components.pluginNoticeComponent;
    if (pluginNoticeComponent) {
      return pluginNoticeComponent;
    }

    const standalonePluginNoticeComponent = new PluginNoticeComponent({
      app: this.app,
      pluginName: this.manifest.name
    });
    standalonePluginNoticeComponent.load();
    return standalonePluginNoticeComponent;
  }

  /**
   * Checks whether a feature surface whose load is in progress has since been torn down or replaced.
   *
   * @param gatedWrapperComponent - The surface being loaded.
   * @returns `true` when the surface is no longer the plugin's live one.
   */
  private isFeatureSurfaceGone(gatedWrapperComponent: ComponentEx): boolean {
    return !gatedWrapperComponent._loaded || this.gatedWrapperComponent !== gatedWrapperComponent;
  }

  /**
   * Builds and loads the subclass's feature surface, then publishes its APIs and announces itself.
   *
   * NOT idempotent, deliberately. `PluginGateComponent` owns the up/down state machine and calls
   * this only on a real transition; a second guard here would be a second copy of that state, which is the
   * kind of duplicate that drifts.
   *
   * @returns A {@link Promise} that resolves once the surface is loaded and the broadcast has been made.
   */
  private async loadFeatureSurface(): Promise<void> {
    // Loaded explicitly for the same reason the universal wrapper is: `addChild` loads a child only once
    // its parent is loaded, and the surface has to be live before `onloadImpl` starts adding to it.
    const gatedWrapperComponent = this.gatedWrapperComponent;
    this.universalWrapperComponent.addChild(gatedWrapperComponent);
    gatedWrapperComponent.load();

    // A surface reopened after the gate closed waits for the cleanups the previous surface started. Only when some
    // are pending, so a surface with nothing to wait for still runs `onloadImpl` synchronously. Never on the first
    // load, where anything pending is the previous instance's and `onload` already waited for it.
    if (this.hasUnloadedFeatureSurface && hasPendingPluginAsyncCleanups(this.manifest.id)) {
      await this.waitForPreviousAsyncCleanups();
    }

    await this.onloadImpl();

    // The surface may have been torn down while an await was suspended: the plugin unloaded in the middle of its
    // own load (an update, or Hot Reload, disables and re-enables it while `onloadImpl` is still awaiting), or the
    // gate closed. Checked before `loadWithPromises`, which would otherwise LOAD the unloaded surface again, and
    // after it. Publishing then registers each record's revoke on a component that has already unloaded, so the
    // revoke never runs, and the record outlives this instance and blocks the next one from publishing the same API
    // version. Announcing a load that no longer holds would be just as wrong.
    if (this.isFeatureSurfaceGone(gatedWrapperComponent)) {
      return;
    }

    await gatedWrapperComponent.loadWithPromises();

    if (this.isFeatureSurfaceGone(gatedWrapperComponent)) {
      return;
    }

    for (const declaration of this.getPluginApis()) {
      publishPluginApi({
        ...declaration,
        // Revoked with the SURFACE, not with the plugin: a plugin whose dependency goes away keeps running
        // its universal components, and a consumer must not be left holding a handle into the half of it
        // that was just torn down.
        component: gatedWrapperComponent,
        plugin: this
      });
    }

    this.broadcastLoaded();
  }

  private setComponent<TKey extends keyof PluginBaseComponents>(key: TKey, value: NonNullable<PluginBaseComponents[TKey]>): void {
    const oldComponent = this.components[key];
    if (oldComponent) {
      this.removeChild(oldComponent);
    }
    this.components[key] = value;
  }

  /**
   * Tears the subclass's feature surface down, leaving the universal components running.
   */
  private unloadFeatureSurface(): void {
    const gatedWrapperComponent = this.gatedWrapperComponent;

    // Replaced BEFORE the old one is unloaded, so anything that resumes mid-teardown and calls `addChild`
    // parks its child on the fresh surface rather than on the one being torn down — where `ComponentEx`
    // would refuse it outright, since it refuses children added to an already-unloaded component.
    this.gatedWrapperComponent = new ComponentEx();
    this.hasUnloadedFeatureSurface = true;
    this.universalWrapperComponent.removeChild(gatedWrapperComponent);

    this.broadcastUnloaded();
  }

  private async waitForPreviousAsyncCleanups(): Promise<void> {
    const timeoutInMilliseconds = this.getAsyncCleanupTimeoutInMilliseconds();
    const pluginNoticeComponent = this.getAsyncCleanupNoticeComponent();
    // Shown only once the wait outlasts the delay, so the usual wait of a few milliseconds shows nothing. Separate, so
    // it never takes the slot of a notice the gate shows about the same plugin.
    const pausedNotice = pluginNoticeComponent.showNoticeAfterDelay({
      content: () => t(($) => $.obsidianLib.notices.pluginLoadPaused),
      delayInMilliseconds: this.getAsyncCleanupNoticeDelayInMilliseconds(),
      mode: PluginNoticeMode.Separate
    });

    let didSettle: boolean;
    try {
      didSettle = await didPluginAsyncCleanupsSettle({ pluginId: this.manifest.id, timeoutInMilliseconds });
    } finally {
      pausedNotice[Symbol.dispose]();
    }

    if (didSettle) {
      return;
    }

    console.warn(`Plugin ${this.manifest.id}: the previous instance's async cleanups did not finish in ${String(timeoutInMilliseconds)} ms; loading anyway.`);
    pluginNoticeComponent.showNotice(t(($) => $.obsidianLib.notices.pluginLoadPauseTimedOut), { mode: PluginNoticeMode.Separate });
  }
}

/**
 * Reloads the specified plugin by disabling and then re-enabling it.
 *
 * @param plugin - The plugin to reload.
 * @returns A {@link Promise} that resolves when the plugin is reloaded.
 * @throws {@link PluginEnableRefusedError} If Obsidian refused to enable the plugin again, which leaves it
 * disabled.
 */
export async function reloadPlugin(plugin: Plugin): Promise<void> {
  const plugins = plugin.app.plugins;
  const pluginId = plugin.manifest.id;
  await plugins.disablePlugin(pluginId);
  if (!await plugins.enablePlugin(pluginId)) {
    throw new PluginEnableRefusedError(pluginId);
  }
}

/**
 * Displays an error message as a notice, logs it to the console, and disables the specified plugin.
 *
 * @param plugin - The plugin to disable.
 * @param message - The error message to display and log.
 * @returns A {@link Promise} that resolves when the plugin is disabled.
 */
export async function showErrorAndDisablePlugin(plugin: Plugin, message: string): Promise<void> {
  const pluginNoticeComponent = new PluginNoticeComponent({
    app: plugin.app,
    pluginName: plugin.manifest.name
  });
  pluginNoticeComponent.showNotice(message);
  printError(new Error(message));
  await plugin.app.plugins.disablePlugin(plugin.manifest.id);
}

/**
 * Checks whether every failure in an error tree is a {@link SilentError}.
 *
 * Walks `AggregateError.errors` and `cause`, so the `AggregateError` nesting that the component loads wrap a single
 * throw in is seen through. An error that is neither a {@link SilentError}, an aggregate nor a wrapper with a cause is
 * a real failure, and so is an empty aggregate, which says nothing about what went wrong.
 *
 * @param error - The error to check.
 * @returns `true` when the tree holds at least one {@link SilentError} and nothing else.
 */
function isSilentErrorTree(error: unknown): boolean {
  const pendingErrors: unknown[] = [error];

  while (pendingErrors.length > 0) {
    const pendingError = pendingErrors.pop();
    if (pendingError instanceof SilentError) {
      continue;
    }

    if (pendingError instanceof AggregateError) {
      const errors: unknown[] = pendingError.errors;
      if (errors.length === 0) {
        return false;
      }
      pendingErrors.push(...errors);
      continue;
    }

    if (pendingError instanceof Error && pendingError.cause !== undefined) {
      pendingErrors.push(pendingError.cause);
      continue;
    }

    return false;
  }

  // Every leaf was a `SilentError`, and there was at least one, since the walk starts from one error and an empty
  // aggregate returns above.
  return true;
}
