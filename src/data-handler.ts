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
 */

import type { Plugin } from 'obsidian';

import { normalizePath } from 'obsidian';

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
  }

  /**
   * Loads data from the plugin's data file.
   *
   * The file's size is read through the adapter BEFORE Obsidian reads and parses it, so an oversized file is never
   * loaded into memory.
   *
   * @returns The loaded data.
   * @throws {@link PluginDataSizeLimitExceededError} If the existing file is larger than the limit.
   */
  public async loadData(): Promise<unknown> {
    const sizeInBytes = await this.getExistingFileSize();
    if (sizeInBytes !== null && sizeInBytes > this.maxSizeInBytes) {
      throw this.createError(PluginDataOperation.Load, sizeInBytes);
    }
    return this.plugin.loadData();
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
