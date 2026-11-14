/**
 * @file
 *
 * Device-local recovery copies of a plugin's `data.json`, kept BEFORE anything could lose what the file held.
 *
 * Two cases lose a user's settings for good without one. A `data.json` that does not parse (truncated by a sync tool,
 * a crash mid-write, a hand edit) reads as missing, because Obsidian's `Vault.readJson` swallows the parse error
 * (read from `1.15.1`); and a record that parses but holds values the plugin drops or rewrites (an unknown key from a
 * newer plugin version, a legacy migration) is normalized and saved back over the file on the initial load. A copy of
 * the raw text is kept first, in a {@link LocalDataStore}, so no sync tool carries it to other devices and nothing is
 * added to the vault.
 */

import type { App } from 'obsidian';

import { LocalDataStore } from './data-stores/local-data-store.ts';

/**
 * How many recovery copies a {@link LocalSettingsRecoveryStore} keeps per plugin by default. The oldest is dropped
 * first.
 */
export const DEFAULT_MAX_SETTINGS_RECOVERY_COPIES = 5;

/**
 * The {@link LocalDataStore} store id the recovery copies live under. The `-v1` names the record shape below.
 */
export const SETTINGS_RECOVERY_STORE_ID = 'settings-recovery-v1';

/**
 * Why a recovery copy was kept.
 */
export enum SettingsRecoveryReason {
  /**
   * The file did not parse as JSON, so it could not be loaded at all.
   */
  InvalidJson = 'invalid-json',

  /**
   * The file parsed, but saving the normalized settings would have dropped or changed a stored value.
   */
  LossyRewrite = 'lossy-rewrite'
}

/**
 * Constructor parameters for {@link LocalSettingsRecoveryStore}.
 */
export interface LocalSettingsRecoveryStoreConstructorParams {
  /**
   * The Obsidian app; its device-local `appId` scopes the store to this vault.
   */
  readonly app: App;

  /**
   * IndexedDB implementation, injectable for tests.
   */
  readonly factory?: IDBFactory;

  /**
   * How many copies to keep. Defaults to {@link DEFAULT_MAX_SETTINGS_RECOVERY_COPIES}.
   */
  readonly maxCopies?: number;

  /**
   * The clock, injectable for tests. Defaults to {@link Date.now}.
   */
  readonly now?: () => number;

  /**
   * The `manifest.id` of the plugin.
   */
  readonly pluginId: string;
}

/**
 * One kept copy of a plugin's `data.json`.
 */
export interface SettingsRecoveryCopy {
  /**
   * The copy's id, unique within the plugin's store.
   */
  readonly id: string;

  /**
   * When the copy was kept, in milliseconds since the Unix epoch.
   */
  readonly keptAt: number;

  /**
   * The vault-relative path of the file the copy was taken from.
   */
  readonly path: string;

  /**
   * The file's raw text, byte for byte as it was read.
   */
  readonly rawText: string;

  /**
   * Why the copy was kept.
   */
  readonly reason: SettingsRecoveryReason;
}

/**
 * Where recovery copies of a plugin's `data.json` are kept.
 */
export interface SettingsRecoveryStore {
  /**
   * Keeps a copy. A copy whose raw text is already kept is not duplicated; the existing one is returned.
   *
   * @param params - What to keep.
   * @returns The kept copy.
   */
  readonly keep: (params: SettingsRecoveryStoreKeepParams) => Promise<SettingsRecoveryCopy>;

  /**
   * Lists the kept copies.
   *
   * @returns The copies, newest first.
   */
  readonly list: () => Promise<SettingsRecoveryCopy[]>;

  /**
   * Removes a kept copy. Removing an id that is not kept does nothing.
   *
   * @param id - The copy's id.
   * @returns A promise that resolves when the copy is removed.
   */
  readonly remove: (id: string) => Promise<void>;
}

/**
 * Parameters for {@link SettingsRecoveryStore.keep}.
 */
export interface SettingsRecoveryStoreKeepParams {
  /**
   * The vault-relative path of the file the copy was taken from.
   */
  readonly path: string;

  /**
   * The file's raw text, byte for byte as it was read.
   */
  readonly rawText: string;

  /**
   * Why the copy is kept.
   */
  readonly reason: SettingsRecoveryReason;
}

/**
 * A {@link SettingsRecoveryStore} in a device-local {@link LocalDataStore}, keeping the newest few copies.
 *
 * It opens its database per call and closes it again: copies are kept and read rarely (a load that found a damaged
 * file, a lossy first save, the user asking for the list), so holding a connection for the plugin's lifetime would
 * only add a resource to tie to an unload.
 */
export class LocalSettingsRecoveryStore implements SettingsRecoveryStore {
  private readonly factory: IDBFactory | undefined;
  private readonly maxCopies: number;
  private readonly now: () => number;
  private readonly pluginId: string;
  private readonly vaultId: string;

  /**
   * Creates a new store.
   *
   * @param params - The constructor parameters.
   */
  public constructor(params: LocalSettingsRecoveryStoreConstructorParams) {
    const maxCopies = params.maxCopies ?? DEFAULT_MAX_SETTINGS_RECOVERY_COPIES;
    if (!Number.isSafeInteger(maxCopies) || maxCopies < 1) {
      throw new RangeError(`maxCopies must be a positive integer, got ${String(maxCopies)}.`);
    }
    this.factory = params.factory;
    this.maxCopies = maxCopies;
    this.now = params.now ?? Date.now;
    this.pluginId = params.pluginId;
    this.vaultId = params.app.appId;
  }

  /**
   * Keeps a copy, dropping the oldest ones beyond the limit in the same transaction.
   *
   * @param params - What to keep.
   * @returns The kept copy, or the already kept one with the same raw text.
   */
  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Implements SettingsRecoveryStore.keep, whose params type it shares.
  public async keep(params: SettingsRecoveryStoreKeepParams): Promise<SettingsRecoveryCopy> {
    return await this.withStore(async (store) => {
      const copies = readCopies(await store.entries());
      const duplicate = copies.find((copy) => copy.rawText === params.rawText);
      if (duplicate) {
        return duplicate;
      }

      const keptAt = this.now();
      const copy: SettingsRecoveryCopy = {
        id: createCopyId(keptAt, copies),
        keptAt,
        path: params.path,
        rawText: params.rawText,
        reason: params.reason
      };
      const removedKeys = copies.slice(this.maxCopies - 1).map((oldCopy) => oldCopy.id);
      await store.commit({ entries: [[copy.id, copy]], removedKeys });
      return copy;
    });
  }

  /**
   * Lists the kept copies.
   *
   * @returns The copies, newest first.
   */
  public async list(): Promise<SettingsRecoveryCopy[]> {
    return await this.withStore(async (store) => readCopies(await store.entries()));
  }

  /**
   * Removes a kept copy.
   *
   * @param id - The copy's id.
   * @returns A promise that resolves when the copy is removed.
   */
  public async remove(id: string): Promise<void> {
    await this.withStore(async (store) => {
      await store.delete(id);
    });
  }

  private async withStore<T>(action: (store: LocalDataStore) => Promise<T>): Promise<T> {
    const store = await LocalDataStore.open({
      ...(this.factory && { factory: this.factory }),
      pluginId: this.pluginId,
      storeId: SETTINGS_RECOVERY_STORE_ID,
      vaultId: this.vaultId
    });
    try {
      return await action(store);
    } finally {
      store.close();
    }
  }
}

/**
 * Checks whether a value is a {@link SettingsRecoveryCopy}. A record of another shape (a later version's, or a damaged
 * one) is ignored rather than trusted.
 *
 * @param value - The value to check.
 * @returns Whether the value is a recovery copy.
 */
export function isSettingsRecoveryCopy(value: unknown): value is SettingsRecoveryCopy {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<Record<keyof SettingsRecoveryCopy, unknown>>;
  return typeof record.id === 'string'
    && typeof record.keptAt === 'number'
    && typeof record.path === 'string'
    && typeof record.rawText === 'string'
    && (record.reason === SettingsRecoveryReason.InvalidJson || record.reason === SettingsRecoveryReason.LossyRewrite);
}

function compareNewestFirst(a: SettingsRecoveryCopy, b: SettingsRecoveryCopy): number {
  return b.keptAt - a.keptAt || b.id.localeCompare(a.id);
}

function createCopyId(keptAt: number, copies: readonly SettingsRecoveryCopy[]): string {
  const ids = new Set(copies.map((copy) => copy.id));
  const base = new Date(keptAt).toISOString();
  let id = base;
  for (let suffix = 1; ids.has(id); suffix++) {
    id = `${base}-${String(suffix)}`;
  }
  return id;
}

function readCopies(entries: readonly (readonly [string, unknown])[]): SettingsRecoveryCopy[] {
  return entries
    .map(([, value]) => value)
    .filter(isSettingsRecoveryCopy)
    .sort(compareNewestFirst);
}
