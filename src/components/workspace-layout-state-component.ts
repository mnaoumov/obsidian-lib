/**
 * @file
 *
 * Keeps a plugin's layout-scoped state in the workspace layout itself, so each saved workspace remembers its own value
 * and switching workspaces restores it, instead of one global value in `data.json`.
 *
 * Read from Obsidian `1.15.1`: `Workspace.getLayout()` builds a fresh object (`main`, `left`, `right`, `left-ribbon`,
 * `floating`, `active`) and `Workspace.setLayout()` ignores every other top-level key. `deserializeLayout` keeps each
 * item's `id`, popout leaves included. The Workspaces core plugin saves through `getLayout()` and loads through
 * `changeLayout()`, which calls `setLayout()`. Startup goes through `loadLayout()`, `readWorkspaceFile()` and
 * `setLayout()`, after the plugins enabled at startup have loaded. So two patches on the `app.workspace` instance carry
 * the whole thing: `getLayout` writes the records under {@link WORKSPACE_LAYOUT_STATE_LAYOUT_KEY}, and `setLayout`
 * replaces them from the layout it is handed before any view is restored. Per-leaf state is keyed by leaf id at the
 * layout level, so no `WorkspaceItem.serialize` or `deserializeLayout` patch is needed.
 *
 * A view the plugin owns needs none of this: `View.getState` / `setState` already ride in each leaf's state. This
 * component is for the scope those methods cannot represent: the whole layout, and leaves of views the plugin does not
 * own.
 *
 * Every plugin bundles its own copy of this library, so the records, the subscriptions and ONE installation of the
 * patches live in the shared-state bag under a versioned key, owned by one subscriber. When the owner unloads while
 * others remain, the next subscriber installs again from its own copy. What crosses that boundary is a wire format
 * between copies of different versions: plain objects and plain functions only, fields only ever added, and a change of
 * meaning moves to a new key. The layout record is a wire format too, persisted in `workspace.json` and in every saved
 * workspace.
 */

import type {
  App,
  Workspace,
  WorkspaceLeaf
} from 'obsidian';
import type {
  JsonObject,
  JsonValue
} from 'type-fest';

import { snapshot } from '@mnaoumov/typescript-lib/array';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';

import { isDataStoreJsonValue } from '../data-stores/data-store-replica.ts';
import { getObsidianLibState } from '../obsidian-lib-state.ts';
import { ComponentEx } from './component-ex.ts';
import { around } from './monkey-around-component.ts';

/**
 * The top-level key of a serialized layout that holds the records.
 */
export const WORKSPACE_LAYOUT_STATE_LAYOUT_KEY = 'obsidianLibLayoutStateV1';

const SHARED_STATE_KEY = 'workspaceLayoutStateV1';

/**
 * The fields of a plugin record this version knows: `leaves` and `workspace`.
 */
const KNOWN_PLUGIN_RECORD_FIELD_COUNT = 2;

/**
 * A change of one key's value, in one scope.
 *
 * @typeParam T - The value type.
 */
export interface WorkspaceLayoutStateChange<T> {
  /**
   * The leaf whose value changed, or `null` for the workspace scope or a leaf no longer in the layout.
   */
  readonly leaf: null | WorkspaceLeaf;

  /**
   * The id of the leaf whose value changed, or `null` for the workspace scope.
   */
  readonly leafId: null | string;

  /**
   * The value before the change, as {@link WorkspaceLayoutStateKey.get} read it.
   */
  readonly oldValue: T;

  /**
   * The value after the change, as {@link WorkspaceLayoutStateKey.get} reads it.
   */
  readonly value: T;
}

/**
 * Parameters for {@link WorkspaceLayoutStateComponent}.
 */
export interface WorkspaceLayoutStateComponentConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The id of the plugin the values belong to. Every value is namespaced by it.
   */
  readonly pluginId: string;
}

/**
 * A typed handle to one layout-scoped key.
 *
 * Every method takes an optional leaf. Without one, the value belongs to the whole layout (the workspace scope).
 *
 * @typeParam T - The value type.
 */
export interface WorkspaceLayoutStateKey<T> {
  /**
   * Reads the value: a clone of the stored one, or of the default when nothing is stored or the stored value fails the
   * key's guard.
   *
   * @param leaf - The leaf, or nothing for the workspace scope.
   * @returns The value.
   */
  readonly get: (leaf?: WorkspaceLeaf) => T;

  /**
   * Checks whether a value is stored, valid or not.
   *
   * @param leaf - The leaf, or nothing for the workspace scope.
   * @returns Whether a value is stored.
   */
  readonly has: (leaf?: WorkspaceLeaf) => boolean;

  /**
   * The key name, unique within the plugin.
   */
  readonly key: string;

  /**
   * Subscribes to changes of this key made through `set` or `unset`, in any scope and from any copy of the library. A
   * layout load is reported through {@link WorkspaceLayoutStateComponent.onLayoutLoad} instead.
   *
   * @param callback - Called after each change.
   * @returns A function that unsubscribes. Unloading the component unsubscribes too.
   */
  readonly onChange: (callback: (change: WorkspaceLayoutStateChange<T>) => void) => () => void;

  /**
   * Stores a clone of the value and requests a layout save. Storing a value equal to the stored one does nothing.
   *
   * @param value - The value. It must be JSON-safe; `null` is stored as `null`.
   * @param leaf - The leaf, or nothing for the workspace scope.
   * @throws A `TypeError` if the value is not JSON-safe.
   */
  readonly set: (value: T, leaf?: WorkspaceLeaf) => void;

  /**
   * Removes the stored value, so `get` reads the default again, and requests a layout save.
   *
   * @param leaf - The leaf, or nothing for the workspace scope.
   */
  readonly unset: (leaf?: WorkspaceLeaf) => void;
}

/**
 * Defines a layout-scoped key.
 *
 * @typeParam T - The value type.
 */
export interface WorkspaceLayoutStateKeyDefinition<T> {
  /**
   * The value read when nothing valid is stored.
   */
  readonly defaultValue: T;

  /**
   * Checks a stored value. A value that fails reads as the default and stays stored until it is replaced or unset.
   *
   * @default Accepts every JSON value.
   */
  readonly isValid?: (value: unknown) => value is T;

  /**
   * The key name, unique within the plugin.
   */
  readonly key: string;
}

/**
 * One plugin's records. Fields a newer copy adds are preserved.
 */
export interface WorkspaceLayoutStatePluginRecord {
  /**
   * The values by leaf id, then by key.
   */
  readonly leaves: Record<string, JsonRecord>;

  /**
   * Fields a newer copy of the library added.
   */
  readonly [field: string]: unknown;

  /**
   * The workspace-scope values by key.
   */
  readonly workspace: JsonRecord;
}

/**
 * The record persisted under {@link WORKSPACE_LAYOUT_STATE_LAYOUT_KEY}. Fields a newer copy adds are preserved.
 */
export interface WorkspaceLayoutStateRecord {
  /**
   * The records by plugin id.
   */
  readonly plugins: Record<string, WorkspaceLayoutStatePluginRecord>;

  /**
   * Fields a newer copy of the library added.
   */
  readonly [field: string]: unknown;
}

type JsonRecord = Record<string, JsonValue>;

interface RecordChange {
  readonly key: string;
  readonly leafId: null | string;
  readonly newValue: JsonValue | undefined;
  readonly oldValue: JsonValue | undefined;
  readonly pluginId: string;
}

interface WorkspaceLayoutStateInstallation {
  readonly owner: WorkspaceLayoutStateSubscription;
  readonly uninstall: () => void;
}

interface WorkspaceLayoutStateKeyImplParams<T> {
  readonly app: App;
  readonly defaultValue: T;
  readonly isValid: (value: unknown) => value is T;
  readonly key: string;
  readonly pluginId: string;
  readonly subscribe: (listener: (change: RecordChange) => void) => () => void;
}

interface WorkspaceLayoutStateSharedState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Subscriber changes replace or clear the shared installation.
  installation: null | WorkspaceLayoutStateInstallation;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Set once a layout or the saved layout file has been read.
  isHydrated: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- A layout load replaces the records.
  record: WorkspaceLayoutStateRecord;
  readonly subscriptions: WorkspaceLayoutStateSubscription[];
}

/**
 * A subscriber in the shared state. The shape is part of the wire format between copies: fields are only ever added.
 */
interface WorkspaceLayoutStateSubscription {
  readonly install: () => () => void;
  readonly onLayoutLoad: () => void;
  readonly onRecordChange: (change: RecordChange) => void;
}

class WorkspaceLayoutStateKeyImpl<T> implements WorkspaceLayoutStateKey<T> {
  public readonly key: string;

  private readonly app: App;
  private readonly defaultValue: T;
  private readonly isValid: (value: unknown) => value is T;
  private readonly pluginId: string;
  private readonly subscribe: (listener: (change: RecordChange) => void) => () => void;

  public constructor(params: WorkspaceLayoutStateKeyImplParams<T>) {
    this.app = params.app;
    this.defaultValue = params.defaultValue;
    this.isValid = params.isValid;
    this.key = params.key;
    this.pluginId = params.pluginId;
    this.subscribe = params.subscribe;
  }

  public get(leaf?: WorkspaceLeaf): T {
    return this.resolve(readRawValue(getSharedState(), this.pluginId, this.key, getLeafId(leaf)));
  }

  public has(leaf?: WorkspaceLeaf): boolean {
    return readRawValue(getSharedState(), this.pluginId, this.key, getLeafId(leaf)) !== undefined;
  }

  public onChange(callback: (change: WorkspaceLayoutStateChange<T>) => void): () => void {
    return this.subscribe((change) => {
      if (change.key !== this.key) {
        return;
      }
      callback({
        leaf: change.leafId === null ? null : this.app.workspace.getLeafById(change.leafId),
        leafId: change.leafId,
        oldValue: this.resolve(change.oldValue),
        value: this.resolve(change.newValue)
      });
    });
  }

  public set(value: T, leaf?: WorkspaceLeaf): void {
    assertJsonValue(value);
    this.write(cloneJson(value), getLeafId(leaf));
  }

  public unset(leaf?: WorkspaceLeaf): void {
    this.write(undefined, getLeafId(leaf));
  }

  private resolve(rawValue: JsonValue | undefined): T {
    return cloneJson(rawValue !== undefined && this.isValid(rawValue) ? rawValue : this.defaultValue);
  }

  private write(newValue: JsonValue | undefined, leafId: null | string): void {
    const state = getSharedState();
    const oldValue = readRawValue(state, this.pluginId, this.key, leafId);
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      return;
    }

    if (newValue === undefined) {
      // A stored old value means the bucket exists, so this creates nothing.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- The bucket is a plain record keyed by user-chosen names.
      delete ensureBucket(state, this.pluginId, leafId)[this.key];
    } else {
      ensureBucket(state, this.pluginId, leafId)[this.key] = newValue;
    }

    this.app.workspace.requestSaveLayout();
    const change: RecordChange = { key: this.key, leafId, newValue, oldValue, pluginId: this.pluginId };
    for (const subscription of snapshot(state.subscriptions)) {
      subscription.onRecordChange(change);
    }
  }
}

/**
 * Keeps a plugin's layout-scoped values in the workspace layout, so saved workspaces each restore their own.
 *
 * Any number of these, in any number of plugins, share one installation per {@link App}. Values are restored when a
 * layout loads, which REPLACES every value: write them after {@link Workspace.onLayoutReady}, and re-read them in
 * {@link onLayoutLoad}.
 */
export class WorkspaceLayoutStateComponent extends ComponentEx {
  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * The id of the plugin the values belong to.
   */
  protected readonly pluginId: string;

  private readonly layoutLoadListeners = new Set<() => void>();
  private readonly recordChangeListeners = new Set<(change: RecordChange) => void>();

  /**
   * Creates a new workspace layout state component.
   *
   * @param params - The parameters.
   * @throws A `TypeError` if the plugin id is empty.
   */
  public constructor(params: WorkspaceLayoutStateComponentConstructorParams) {
    super();
    if (!params.pluginId) {
      throw new TypeError('The plugin id must not be empty');
    }
    this.app = params.app;
    this.pluginId = params.pluginId;
  }

  /**
   * Defines a typed key.
   *
   * @typeParam T - The value type.
   * @param definition - The key definition.
   * @returns The key handle.
   * @throws A `TypeError` if the key is empty or the default value is not JSON-safe.
   */
  public defineKey<T>(definition: WorkspaceLayoutStateKeyDefinition<T>): WorkspaceLayoutStateKey<T> {
    if (!definition.key) {
      throw new TypeError('The key must not be empty');
    }
    assertJsonValue(definition.defaultValue);
    return new WorkspaceLayoutStateKeyImpl<T>({
      app: this.app,
      defaultValue: cloneJson(definition.defaultValue),
      isValid: definition.isValid ?? ((_value): _value is T => true),
      key: definition.key,
      pluginId: this.pluginId,
      subscribe: (listener) => this.subscribeToRecordChanges(listener)
    });
  }

  /**
   * Subscribes to layout loads: a saved workspace loaded, the layout restored at startup, or the saved layout read when
   * the component is first loaded after layout-ready. Every value may have changed.
   *
   * @param callback - Called after the layout is loaded, once its leaves exist.
   * @returns A function that unsubscribes. Unloading the component unsubscribes too.
   */
  public onLayoutLoad(callback: () => void): () => void {
    this.layoutLoadListeners.add(callback);
    return () => {
      this.layoutLoadListeners.delete(callback);
    };
  }

  /**
   * Subscribes to the shared installation, installing it when nobody has yet.
   */
  public override onload(): void {
    super.onload();

    const state = getSharedState();
    const subscription: WorkspaceLayoutStateSubscription = {
      install: () => installLayoutState(this.app, state),
      onLayoutLoad: () => {
        for (const listener of snapshot(this.layoutLoadListeners)) {
          invokeListener(listener);
        }
      },
      onRecordChange: (change) => {
        if (change.pluginId !== this.pluginId) {
          return;
        }
        for (const listener of snapshot(this.recordChangeListeners)) {
          invokeListener(() => {
            listener(change);
          });
        }
      }
    };
    state.subscriptions.push(subscription);
    state.installation ??= { owner: subscription, uninstall: subscription.install() };

    this.register(() => {
      this.layoutLoadListeners.clear();
      this.recordChangeListeners.clear();
      state.subscriptions.splice(state.subscriptions.indexOf(subscription), 1);
      if (state.installation?.owner !== subscription) {
        return;
      }

      state.installation.uninstall();
      const nextOwner = state.subscriptions[0];
      state.installation = nextOwner ? { owner: nextOwner, uninstall: nextOwner.install() } : null;
    });
  }

  private subscribeToRecordChanges(listener: (change: RecordChange) => void): () => void {
    this.recordChangeListeners.add(listener);
    return () => {
      this.recordChangeListeners.delete(listener);
    };
  }
}

/**
 * Parses a persisted record. A part that is malformed is dropped one level at a time: a malformed record reads as
 * empty, a malformed plugin record drops only that plugin, and a malformed leaf bucket drops only that leaf. Fields this
 * copy does not know are kept.
 *
 * @param value - The value found under {@link WORKSPACE_LAYOUT_STATE_LAYOUT_KEY}.
 * @returns The parsed record, sharing nothing with the input.
 */
export function parseWorkspaceLayoutStateRecord(value: unknown): WorkspaceLayoutStateRecord {
  if (!isJsonObject(value)) {
    return { plugins: {} };
  }

  const plugins: Record<string, WorkspaceLayoutStatePluginRecord> = {};
  const rawPlugins = value['plugins'];
  if (isJsonObject(rawPlugins)) {
    for (const [pluginId, rawPluginRecord] of Object.entries(rawPlugins)) {
      const pluginRecord = parsePluginRecord(rawPluginRecord);
      if (pluginRecord) {
        plugins[pluginId] = pluginRecord;
      }
    }
  }

  return { ...cloneJson(value), plugins };
}

/**
 * Builds the record to persist into a serialized layout: leaf buckets for leaves absent from the layout are left out,
 * and so are plugins with nothing left.
 *
 * @param record - The current record.
 * @param layout - The serialized layout.
 * @returns The record to persist, or `null` when there is nothing to persist.
 */
export function serializeWorkspaceLayoutStateRecord(record: WorkspaceLayoutStateRecord, layout: unknown): null | WorkspaceLayoutStateRecord {
  const leafIds = collectLeafIds(layout);
  const serialized = cloneJson(record);
  const plugins = serialized.plugins;
  for (const [pluginId, pluginRecord] of Object.entries(plugins)) {
    for (const [leafId, bucket] of Object.entries(pluginRecord.leaves)) {
      if (!leafIds.has(leafId) || Object.keys(bucket).length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Leaf ids are record keys.
        delete pluginRecord.leaves[leafId];
      }
    }
    const isEmpty = Object.keys(pluginRecord.workspace).length === 0 && Object.keys(pluginRecord.leaves).length === 0
      && Object.keys(pluginRecord).length === KNOWN_PLUGIN_RECORD_FIELD_COUNT;
    if (isEmpty) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Plugin ids are record keys.
      delete plugins[pluginId];
    }
  }

  return Object.keys(plugins).length === 0 && Object.keys(serialized).length === 1 ? null : serialized;
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isDataStoreJsonValue(value)) {
    throw new TypeError('A workspace layout state value must be JSON-safe');
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value) as string) as T;
}

function collectLeafIds(layout: unknown): Set<string> {
  const leafIds = new Set<string>();
  function visit(item: unknown): void {
    if (!isPlainRecord(item)) {
      return;
    }
    const id = item['id'];
    if (item['type'] === 'leaf' && typeof id === 'string') {
      leafIds.add(id);
    }
    const children = item['children'];
    if (Array.isArray(children)) {
      for (const child of children) {
        visit(child);
      }
    }
  }

  if (isPlainRecord(layout)) {
    for (const rootKey of ['main', 'left', 'right', 'floating']) {
      visit(layout[rootKey]);
    }
  }
  return leafIds;
}

function ensureBucket(state: WorkspaceLayoutStateSharedState, pluginId: string, leafId: null | string): JsonRecord {
  const pluginRecord = state.record.plugins[pluginId] ?? { leaves: {}, workspace: {} };
  state.record.plugins[pluginId] = pluginRecord;
  if (leafId === null) {
    return pluginRecord.workspace;
  }

  const bucket = pluginRecord.leaves[leafId] ?? {};
  pluginRecord.leaves[leafId] = bucket;
  return bucket;
}

function getBucket(state: WorkspaceLayoutStateSharedState, pluginId: string, leafId: null | string): JsonRecord | null {
  const pluginRecord = state.record.plugins[pluginId];
  if (!pluginRecord) {
    return null;
  }
  return leafId === null ? pluginRecord.workspace : pluginRecord.leaves[leafId] ?? null;
}

function getLayoutRecordValue(layout: unknown): unknown {
  return isPlainRecord(layout) ? layout[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY] : undefined;
}

function getLeafId(leaf: undefined | WorkspaceLeaf): null | string {
  return leaf ? leaf.id : null;
}

function getSharedState(): WorkspaceLayoutStateSharedState {
  return getObsidianLibState<WorkspaceLayoutStateSharedState>(SHARED_STATE_KEY, {
    installation: null,
    isHydrated: false,
    record: { plugins: {} },
    subscriptions: []
  }).value;
}

function installLayoutState(app: App, state: WorkspaceLayoutStateSharedState): () => void {
  let isUninstalled = false;
  const uninstallPatch = around(app.workspace, {
    getLayout: (next) =>
      function patchedGetLayout(this: Workspace): Record<string, unknown> {
        const layout = next.call(this);
        const record = serializeWorkspaceLayoutStateRecord(state.record, layout);
        if (record) {
          layout[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY] = record;
        }
        return layout;
      },
    setLayout: (next) =>
      async function patchedSetLayout(this: Workspace, layout: Parameters<Workspace['setLayout']>[0]): Promise<void> {
        state.record = parseWorkspaceLayoutStateRecord(getLayoutRecordValue(layout));
        state.isHydrated = true;
        try {
          await next.call(this, layout);
        } finally {
          notifyLayoutLoad(state);
        }
      }
  });

  if (!state.isHydrated && app.workspace.layoutReady) {
    // Loaded after the layout: read the layout the last installation saved, once, keeping what was set meanwhile.
    invokeAsyncSafely(async () => {
      const saved = await app.workspace.readWorkspaceFile();
      if (isUninstalled || state.isHydrated) {
        return;
      }
      mergeMissing(state.record, parseWorkspaceLayoutStateRecord(getLayoutRecordValue(saved)));
      state.isHydrated = true;
      notifyLayoutLoad(state);
    });
  }

  return () => {
    isUninstalled = true;
    uninstallPatch();
  };
}

function invokeListener(listener: () => void): void {
  try {
    listener();
  } catch (error) {
    console.error('A workspace layout state listener failed', error);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return isPlainRecord(value) && isDataStoreJsonValue(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeMissing(target: WorkspaceLayoutStateRecord, source: WorkspaceLayoutStateRecord): void {
  for (const [pluginId, sourcePlugin] of Object.entries(source.plugins)) {
    const targetPlugin = target.plugins[pluginId];
    if (!targetPlugin) {
      target.plugins[pluginId] = sourcePlugin;
      continue;
    }
    for (const [key, value] of Object.entries(sourcePlugin.workspace)) {
      targetPlugin.workspace[key] ??= value;
    }
    for (const [leafId, bucket] of Object.entries(sourcePlugin.leaves)) {
      targetPlugin.leaves[leafId] ??= bucket;
    }
  }
}

function notifyLayoutLoad(state: WorkspaceLayoutStateSharedState): void {
  for (const subscription of snapshot(state.subscriptions)) {
    subscription.onLayoutLoad();
  }
}

function parsePluginRecord(value: unknown): null | WorkspaceLayoutStatePluginRecord {
  if (!isJsonObject(value)) {
    return null;
  }

  const leaves: Record<string, JsonRecord> = {};
  const rawLeaves = value['leaves'];
  if (isJsonObject(rawLeaves)) {
    for (const [leafId, bucket] of Object.entries(rawLeaves)) {
      if (isJsonObject(bucket)) {
        leaves[leafId] = cloneJson<JsonRecord>(bucket);
      }
    }
  }

  const rawWorkspace = value['workspace'];
  return {
    ...cloneJson(value),
    leaves,
    workspace: isJsonObject(rawWorkspace) ? cloneJson<JsonRecord>(rawWorkspace) : {}
  };
}

function readRawValue(state: WorkspaceLayoutStateSharedState, pluginId: string, key: string, leafId: null | string): JsonValue | undefined {
  return getBucket(state, pluginId, leafId)?.[key];
}
