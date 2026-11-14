/**
 * @file
 *
 * A module for handling data loading and saving to the plugin's data file.
 *
 * {@link PluginDataHandler} bounds the plugin's `data.json` in bytes, in both directions, because Obsidian does
 * not. Read from Obsidian `1.15.1`: `Plugin.loadData` reads the whole file and `JSON.parse`s it with no limit, so an
 * oversized file is fully read and parsed into memory on every startup, and `Plugin.saveData` writes
 * `JSON.stringify(data, undefined, 2)` with no limit either. Obsidian also swallows a failed read or write: its
 * `readJson` logs a parse failure and resolves `undefined`, and its `writeJson` catches every error. So the guard
 * has to decide BEFORE handing the call to Obsidian, which is the only point where refusing still changes the
 * outcome.
 *
 * The same `readJson` makes a `data.json` that EXISTS but does not parse indistinguishable from no file at all: both
 * resolve `undefined`. A settings component reading that as "nothing stored" saves its defaults over the file, and
 * the user's settings are gone. So when Obsidian answers `undefined` or `null`, {@link PluginDataHandler.loadData}
 * reads the file raw and parses it itself; a file that does not parse is copied into the device-local
 * {@link SettingsRecoveryStore} and reported as a {@link PluginDataParseError}, never as missing.
 */

import type { Plugin } from 'obsidian';

import { normalizePath } from 'obsidian';

import type {
  SettingsRecoveryCopy,
  SettingsRecoveryStore
} from './settings-recovery.ts';

import { PluginNoticeComponent } from './components/plugin-notice-component.ts';
import { t } from './i18n/i18n.ts';
import {
  LocalSettingsRecoveryStore,
  SettingsRecoveryReason
} from './settings-recovery.ts';

/**
 * The indentation Obsidian's `Vault.writeJson` passes to `JSON.stringify` for `data.json` (read from `1.15.1`).
 */
const OBSIDIAN_JSON_INDENT = 2;

/**
 * The default maximum size of a plugin's `data.json`, in bytes: 16 MiB.
 *
 * This is a protective budget against startup exhaustion, not a sync quota. Obsidian Sync's own per-file limit
 * depends on the plan and is a separate constraint a plugin may want to stay well under.
 */
export const DEFAULT_PLUGIN_DATA_MAX_SIZE_IN_BYTES = 16_777_216;

/**
 * The operation a {@link PluginDataSizeLimitExceededError} refused.
 */
export enum PluginDataOperation {
  /**
   * Loading the existing `data.json`.
   */
  Load = 'load',

  /**
   * Saving a new `data.json`.
   */
  Save = 'save'
}

/**
 * A handler for loading and saving data to the plugin's data file.
 */
export interface DataHandler {
  /**
   * A function to load data from the plugin's data file.
   *
   * @returns The loaded data.
   */
  readonly loadData: () => Promise<unknown>;

  /**
   * Where a copy of the data file is kept before anything could lose what it held, or `null` (or absent) when the
   * handler keeps none. A settings component keeps a copy here before a first save that would drop or change a
   * stored value, and skips that save when the copy cannot be kept.
   */
  readonly recoveryStore?: null | SettingsRecoveryStore;

  /**
   * A function to save data to the plugin's data file.
   *
   * @param data - The data to save.
   */
  readonly saveData: (data: unknown) => Promise<void>;
}

/**
 * Options for {@link PluginDataHandler}.
 */
export interface PluginDataHandlerConstructorOptions {
  /**
   * The maximum size of `data.json`, in UTF-8 bytes as written to disk. Defaults to
   * {@link DEFAULT_PLUGIN_DATA_MAX_SIZE_IN_BYTES}. Pass `Infinity` to disable the guard.
   */
  readonly maxSizeInBytes?: number;

  /**
   * Where recovery copies of `data.json` are kept. Defaults to a device-local {@link LocalSettingsRecoveryStore}
   * for the plugin. Pass `null` to keep none: an unparseable file is then still reported and never overwritten, so a
   * settings component built on this handler fails its load rather than run on defaults, and a first save that drops
   * or changes a stored value is written with no copy kept, as before recovery copies existed.
   */
  readonly recoveryStore?: null | SettingsRecoveryStore;
}

/**
 * Parameters for {@link PluginDataParseError}.
 */
export interface PluginDataParseErrorConstructorParams {
  /**
   * The error `JSON.parse` threw.
   */
  readonly cause: unknown;

  /**
   * The path of the plugin's `data.json`.
   */
  readonly path: string;

  /**
   * The `manifest.id` of the plugin.
   */
  readonly pluginId: string;

  /**
   * The `manifest.name` of the plugin.
   */
  readonly pluginName: string;

  /**
   * The recovery copy kept of the file, or `null` when none could be kept.
   */
  readonly recoveryCopy: null | SettingsRecoveryCopy;
}

/**
 * Parameters for {@link PluginDataSizeLimitExceededError}.
 */
export interface PluginDataSizeLimitExceededErrorConstructorParams {
  /**
   * The size limit, in bytes.
   */
  readonly maxSizeInBytes: number;

  /**
   * The refused operation.
   */
  readonly operation: PluginDataOperation;

  /**
   * The path of the plugin's `data.json`.
   */
  readonly path: string;

  /**
   * The `manifest.id` of the plugin.
   */
  readonly pluginId: string;

  /**
   * The `manifest.name` of the plugin.
   */
  readonly pluginName: string;

  /**
   * The size of the existing file (load) or of the serialized data (save), in bytes.
   */
  readonly sizeInBytes: number;
}

/**
 * A handler for loading and saving data to the plugin's data file, refusing a `data.json` larger than a byte limit.
 */
export class PluginDataHandler implements DataHandler {
  /**
   * Where recovery copies of `data.json` are kept, or `null` when none are.
   */
  public readonly recoveryStore: null | SettingsRecoveryStore;

  /**
   * The maximum size of `data.json`, in bytes.
   */
  protected readonly maxSizeInBytes: number;

  /**
   * Creates a new plugin data handler.
   *
   * @param plugin - The plugin instance.
   * @param options - The options.
   */
  public constructor(protected readonly plugin: Plugin, options: PluginDataHandlerConstructorOptions = {}) {
    const maxSizeInBytes = options.maxSizeInBytes ?? DEFAULT_PLUGIN_DATA_MAX_SIZE_IN_BYTES;
    if (Number.isNaN(maxSizeInBytes) || maxSizeInBytes < 0) {
      throw new RangeError(`maxSizeInBytes must be a non-negative number, got ${String(maxSizeInBytes)}.`);
    }
    this.maxSizeInBytes = maxSizeInBytes;
    this.recoveryStore = options.recoveryStore === undefined
      ? new LocalSettingsRecoveryStore({ app: plugin.app, pluginId: plugin.manifest.id })
      : options.recoveryStore;
  }

  /**
   * Loads data from the plugin's data file.
   *
   * The file's size is read through the adapter BEFORE Obsidian reads and parses it, so an oversized file is never
   * loaded into memory. When Obsidian answers `undefined` or `null`, the file is read raw and parsed here, because
   * Obsidian answers `undefined` for a file that exists but does not parse too.
   *
   * @returns The loaded data.
   * @throws {@link PluginDataSizeLimitExceededError} If the existing file is larger than the limit.
   * @throws {@link PluginDataParseError} If the existing file is not valid JSON. The file is left untouched, and a
   * recovery copy of it is kept first when the handler has a recovery store.
   */
  public async loadData(): Promise<unknown> {
    const sizeInBytes = await this.getExistingFileSize();
    if (sizeInBytes !== null && sizeInBytes > this.maxSizeInBytes) {
      throw this.createError(PluginDataOperation.Load, sizeInBytes);
    }
    const data: unknown = await this.plugin.loadData();
    if (data !== undefined && data !== null) {
      return data;
    }

    const path = this.getDataFilePath();
    if (path === null) {
      return data;
    }
    const rawText = await this.readRawFile(path);
    if (rawText === null) {
      return data;
    }

    try {
      const parsed: unknown = JSON.parse(rawText);
      return parsed;
    } catch (parseError) {
      const error = new PluginDataParseError({
        cause: parseError,
        path,
        pluginId: this.plugin.manifest.id,
        pluginName: this.plugin.manifest.name,
        recoveryCopy: await this.keepRecoveryCopy(path, rawText)
      });
      this.reportParseError(error);
      throw error;
    }
  }

  /**
   * Saves data to the plugin's data file.
   *
   * The data is serialized exactly as Obsidian writes it, and its UTF-8 byte length is checked before anything is
   * written.
   *
   * @param data - The data to save.
   * @returns A promise that resolves when the data is saved.
   * @throws {@link PluginDataSizeLimitExceededError} If the serialized data is larger than the limit.
   */
  public async saveData(data: unknown): Promise<void> {
    if (this.maxSizeInBytes !== Infinity) {
      // Obsidian's `writeJson` would swallow a serialization failure and write nothing; throwing here instead keeps
      // the disk unchanged too, and tells the caller.
      const serialized = JSON.stringify(data, undefined, OBSIDIAN_JSON_INDENT);
      if (serialized !== undefined) {
        const sizeInBytes = new TextEncoder().encode(serialized).byteLength;
        if (sizeInBytes > this.maxSizeInBytes) {
          throw this.createError(PluginDataOperation.Save, sizeInBytes);
        }
      }
    }
    await this.plugin.saveData(data);
  }

  /**
   * Gets the path of the plugin's `data.json`, as Obsidian's `Plugin.loadData` reads it.
   *
   * @returns The path, or `null` when the manifest has no folder.
   */
  protected getDataFilePath(): null | string {
    const directory = this.plugin.manifest.dir;
    return directory ? normalizePath(`${directory}/data.json`) : null;
  }

  /**
   * Tells the user that `data.json` could not be parsed: a notice naming the plugin and the path, and the error in the
   * console.
   *
   * @param error - The parse error.
   */
  protected reportParseError(error: PluginDataParseError): void {
    console.error(error);
    new PluginNoticeComponent({
      app: this.plugin.app,
      pluginName: this.plugin.manifest.name
    }).showNotice(
      error.recoveryCopy === null
        ? t(($) => $.obsidianLib.notices.dataFileUnparseable, { path: error.path })
        : t(($) => $.obsidianLib.notices.dataFileUnparseableCopyKept, { path: error.path })
    );
  }

  private createError(operation: PluginDataOperation, sizeInBytes: number): PluginDataSizeLimitExceededError {
    return new PluginDataSizeLimitExceededError({
      maxSizeInBytes: this.maxSizeInBytes,
      operation,
      path: this.getDataFilePath() ?? 'data.json',
      pluginId: this.plugin.manifest.id,
      pluginName: this.plugin.manifest.name,
      sizeInBytes
    });
  }

  private async getExistingFileSize(): Promise<null | number> {
    if (this.maxSizeInBytes === Infinity) {
      return null;
    }
    const path = this.getDataFilePath();
    if (path === null) {
      return null;
    }
    try {
      const stat = await this.plugin.app.vault.adapter.stat(path);
      return stat?.size ?? null;
    } catch {
      // The size is unknown, not oversized: Obsidian's own read decides what happens next, as before this guard.
      return null;
    }
  }

  private async keepRecoveryCopy(path: string, rawText: string): Promise<null | SettingsRecoveryCopy> {
    if (this.recoveryStore === null) {
      return null;
    }
    try {
      return await this.recoveryStore.keep({ path, rawText, reason: SettingsRecoveryReason.InvalidJson });
    } catch (error) {
      console.error(new Error(`Could not keep a recovery copy of "${path}"`, { cause: error }));
      return null;
    }
  }

  private async readRawFile(path: string): Promise<null | string> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      return await adapter.exists(path) ? await adapter.read(path) : null;
    } catch {
      // Unreadable is not unparseable: Obsidian's own answer stands, as before this check.
      return null;
    }
  }
}

/**
 * Thrown when a plugin's `data.json` exists but is not valid JSON.
 *
 * The file is never touched when this is thrown. When {@link recoveryCopy} is not `null`, a copy of the file's raw text
 * was kept on this device first, so even a later save over the file loses nothing.
 */
export class PluginDataParseError extends Error {
  /**
   * The path of the plugin's `data.json`.
   */
  public readonly path: string;

  /**
   * The `manifest.id` of the plugin.
   */
  public readonly pluginId: string;

  /**
   * The `manifest.name` of the plugin.
   */
  public readonly pluginName: string;

  /**
   * The recovery copy kept of the file, or `null` when none could be kept.
   */
  public readonly recoveryCopy: null | SettingsRecoveryCopy;

  /**
   * Creates a {@link PluginDataParseError}.
   *
   * @param params - The parameters for the error.
   */
  public constructor(params: PluginDataParseErrorConstructorParams) {
    const copy = params.recoveryCopy === null
      ? 'No recovery copy could be kept.'
      : `A recovery copy was kept on this device as "${params.recoveryCopy.id}".`;
    super(
      `Plugin "${params.pluginName}" (${params.pluginId}): "${params.path}" is not valid JSON, so it could not be loaded. The file was left untouched. ${copy}`,
      { cause: params.cause }
    );
    this.name = 'PluginDataParseError';
    this.path = params.path;
    this.pluginId = params.pluginId;
    this.pluginName = params.pluginName;
    this.recoveryCopy = params.recoveryCopy;
  }
}

/**
 * Thrown when a plugin's `data.json` is, or would become, larger than the configured limit.
 *
 * The file on disk is never touched when this is thrown: an oversized existing file is left intact for the user to
 * inspect or trim, and an oversized save is refused before anything is written, so the last good file remains.
 */
export class PluginDataSizeLimitExceededError extends Error {
  /**
   * The size limit, in bytes.
   */
  public readonly maxSizeInBytes: number;

  /**
   * The refused operation.
   */
  public readonly operation: PluginDataOperation;

  /**
   * The path of the plugin's `data.json`.
   */
  public readonly path: string;

  /**
   * The `manifest.id` of the plugin.
   */
  public readonly pluginId: string;

  /**
   * The `manifest.name` of the plugin.
   */
  public readonly pluginName: string;

  /**
   * The size of the existing file (load) or of the serialized data (save), in bytes.
   */
  public readonly sizeInBytes: number;

  /**
   * Creates a {@link PluginDataSizeLimitExceededError}.
   *
   * @param params - The parameters for the error.
   */
  public constructor(params: PluginDataSizeLimitExceededErrorConstructorParams) {
    const what = params.operation === PluginDataOperation.Load
      ? `Refusing to load "${params.path}": the file is ${String(params.sizeInBytes)} bytes`
      : `Refusing to save "${params.path}": the data would be ${String(params.sizeInBytes)} bytes`;
    const consequence = params.operation === PluginDataOperation.Load
      ? 'The file was left untouched.'
      : 'Nothing was written, so the last saved file remains.';
    super(
      `Plugin "${params.pluginName}" (${params.pluginId}): ${what}, over the ${String(params.maxSizeInBytes)}-byte limit. ${consequence} `
        + 'Keep data.json for small settings, and move large or growing state to LocalDataStore or SharedDataStore.'
    );
    this.name = 'PluginDataSizeLimitExceededError';
    this.maxSizeInBytes = params.maxSizeInBytes;
    this.operation = params.operation;
    this.path = params.path;
    this.pluginId = params.pluginId;
    this.pluginName = params.pluginName;
    this.sizeInBytes = params.sizeInBytes;
  }
}
