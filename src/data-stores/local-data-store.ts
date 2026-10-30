/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 *
 * Record-based device-local persistence, isolated by vault, plugin and store.
 */

/**
 * Atomic mutations of a local record store.
 */
export interface LocalDataStoreCommitParams {
  /**
   * Key/value pairs to write.
   */
  readonly entries: readonly (readonly [string, unknown])[];
  /**
   * Keys removed in the same transaction as the writes.
   *
   * @default `[]`
   */
  readonly removedKeys?: readonly string[];
  /**
   * Deletes every record of this store first, in the same transaction as the writes.
   *
   * Either the store is replaced by `entries` as a whole, or, when the transaction fails, every previous record survives.
   *
   * @default `false`
   */
  readonly shouldClear?: boolean;
}

/**
 * Parameters for opening a local store.
 */
export interface LocalDataStoreOpenParams {
  /**
   * IndexedDB implementation, injectable for tests.
   */
  readonly factory?: IDBFactory;
  /**
   * Plugin manifest id.
   */
  readonly pluginId: string;
  /**
   * Store name and schema version chosen by the consumer.
   */
  readonly storeId: string;
  /**
   * Stable, device-local vault identity; never the vault display name.
   */
  readonly vaultId: string;
}

/**
 * A local store holds structured-cloneable values; it never writes to the vault.
 */
export class LocalDataStore {
  private constructor(private readonly database: IDBDatabase) {}

  /**
   * Opens an isolated database. Writes resolve only once their transaction commits.
   *
   * @param params - Store identity and optional IndexedDB implementation.
   * @returns The connected store; close it when its owner unloads.
   */
  public static async open(params: LocalDataStoreOpenParams): Promise<LocalDataStore> {
    const name = `obsidian-lib:${JSON.stringify([params.vaultId, params.pluginId, params.storeId])}`;
    const request = (params.factory ?? indexedDB).open(name, 1);
    return await new Promise((resolve, reject) => {
      request.onupgradeneeded = (): void => {
        request.result.createObjectStore('records');
      };
      request.addEventListener('error', (): void => {
        reject(new Error('Could not open local data store', { cause: request.error }));
      });
      request.onsuccess = (): void => {
        const database = request.result;
        database.onversionchange = (): void => {
          database.close();
        };
        resolve(new LocalDataStore(database));
      };
    });
  }

  /**
   * Deletes every record in this store only.
   *
   * @returns A promise that resolves after commit.
   */
  public async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.clear());
  }

  /**
   * Closes this connection without deleting its records.
   */
  public close(): void {
    this.database.close();
  }

  /**
   * Commits several record changes atomically without serializing the rest of the database.
   *
   * @param params - Writes and deletions in one transaction, optionally after clearing the store.
   * @returns A promise that resolves only after all changes commit.
   */
  public async commit(params: LocalDataStoreCommitParams): Promise<void> {
    await this.run('readwrite', (store) => {
      if (params.shouldClear) {
        store.clear();
      }
      for (const key of params.removedKeys ?? []) {
        store.delete(key);
      }
      for (const [key, value] of params.entries) {
        store.put(value, key);
      }
      // No request to resolve with: a closing `store.count()` would walk every record of the store on each commit.
    });
  }

  /**
   * Deletes a record.
   *
   * @param key - Record key.
   * @returns A promise that resolves after commit.
   */
  public async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key));
  }

  /**
   * Reads all records in key order.
   *
   * @returns Detached key/value pairs.
   */
  public async entries(): Promise<[string, unknown][]> {
    const records: [string, unknown][] = [];
    // Two bulk reads in one transaction see the same snapshot in the same key order, so they pair up by index.
    // A cursor dispatches one event per record instead; at 90,000 records in Obsidian it took 1.5 to 2 times as long.
    await this.run('readonly', (store) => {
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      valuesRequest.onsuccess = (): void => {
        const keys = keysRequest.result;
        const values = valuesRequest.result;
        for (const [index, key] of keys.entries()) {
          if (typeof key !== 'string') {
            throw new TypeError('Local data-store key is not a string');
          }
          records.push([key, values[index]]);
        }
      };
      return valuesRequest;
    });
    return records;
  }

  /**
   * Serializes a shared-store operation across connections, windows and bundled library copies.
   *
   * @typeParam T - Callback result.
   * @param callback - Work performed while holding this database's Web Lock.
   * @returns The callback result after releasing the lock.
   */
  public async exclusive<T>(callback: () => Promise<T>): Promise<T> {
    return await window.navigator.locks.request(this.database.name, callback);
  }

  /**
   * Reads a record.
   *
   * @param key - Record key.
   * @returns Its value, or `undefined` when absent.
   */
  public async get(key: string): Promise<unknown> {
    return await this.run<unknown>('readonly', (store) => store.get(key));
  }

  /**
   * Initializes a record once, atomically across connections.
   *
   * @param key - Record key.
   * @param value - Value used only when the key is absent.
   * @returns The existing or newly committed value.
   */
  public async getOrCreate(key: string, value: unknown): Promise<unknown> {
    return await this.run<unknown>('readwrite', (store) => {
      const request = store.get(key);
      request.onsuccess = (): void => {
        if (request.result === undefined) {
          store.put(value, key);
        }
      };
      return request;
    }).then((existing) => existing === undefined ? value : existing);
  }

  /**
   * Writes a structured-cloneable value.
   *
   * @param key - Record key.
   * @param value - Value to persist.
   * @returns A promise that resolves after commit.
   */
  public async set(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (store) => store.put(value, key));
  }

  private async run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | undefined): Promise<T | undefined> {
    return await new Promise((resolve, reject) => {
      const transaction = this.database.transaction('records', mode);
      let request: IDBRequest<T> | undefined;
      try {
        request = action(transaction.objectStore('records'));
      } catch (error) {
        transaction.abort();
        reject(error instanceof Error ? error : new Error('Local data-store transaction failed', { cause: error }));
        return;
      }
      transaction.oncomplete = (): void => {
        // An action that issued no request of its own resolves with `undefined` once its writes commit.
        resolve(request?.result);
      };
      transaction.addEventListener('abort', (): void => {
        reject(new Error('Local data-store transaction aborted', { cause: transaction.error }));
      });
    });
  }
}

/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
