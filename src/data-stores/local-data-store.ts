/**
 * @file
 *
 * Record-based device-local persistence, isolated by vault, plugin and store.
 */

/**
 * Why a {@link LocalDataStore} connection stopped accepting operations.
 */
export enum LocalDataStoreCloseReason {
  /**
   * The browser closed the connection on its own, for example because the database was deleted or the storage was
   * cleared.
   */
  ClosedByBrowser = 'closedByBrowser',
  /**
   * The owner called {@link LocalDataStore.close}, usually because it unloaded.
   */
  ClosedByOwner = 'closedByOwner',
  /**
   * Another connection asked for a newer schema version, so this one closed to let it upgrade.
   */
  VersionChange = 'versionChange'
}

/**
 * Options of a {@link LocalDataStoreClosedError}.
 */
export interface LocalDataStoreClosedErrorConstructorOptions {
  /**
   * The IndexedDB error the closed-store error replaces.
   */
  readonly cause?: unknown;
}

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
  /**
   * Whether the connection is closed or closing, so no further operation can run.
   *
   * @returns `true` once {@link LocalDataStore.close} was called, or the browser or a schema upgrade closed the
   *   connection.
   */
  public get isClosed(): boolean {
    return this.closeReason !== null;
  }

  private closeReason: LocalDataStoreCloseReason | null = null;

  private constructor(private readonly database: IDBDatabase) {
    database.onversionchange = (): void => {
      this.markClosed(LocalDataStoreCloseReason.VersionChange);
      database.close();
    };
    // Fired only when the browser closes the connection abnormally, never after `close()`.
    database.addEventListener('close', (): void => {
      this.markClosed(LocalDataStoreCloseReason.ClosedByBrowser);
    });
  }

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
        resolve(new LocalDataStore(request.result));
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
   * Closes this connection without deleting its records. Every later operation rejects with
   * {@link LocalDataStoreClosedError}. Closing twice is harmless.
   */
  public close(): void {
    this.markClosed(LocalDataStoreCloseReason.ClosedByOwner);
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
    // eslint-disable-next-line obsidian-dev-toolkit/prefer-active-window -- Web Locks are per origin, the same from any window, and the main window outlives every popout
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

  private markClosed(reason: LocalDataStoreCloseReason): void {
    this.closeReason ??= reason;
  }

  // eslint-disable-next-line typescript-dev-toolkit/no-undefined-return-type -- Mirrors IndexedDB: a missing record reads as `undefined`, which a stored `null` must stay distinct from.
  private async run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | undefined): Promise<T | undefined> {
    return await new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        if (this.closeReason !== null) {
          throw new LocalDataStoreClosedError(this.database.name, this.closeReason);
        }
        transaction = this.database.transaction('records', mode);
      } catch (error) {
        reject(this.toClosedError(error));
        return;
      }
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

  private toClosedError(error: unknown): Error {
    if (error instanceof LocalDataStoreClosedError) {
      return error;
    }
    // A closing connection makes `transaction()` throw `InvalidStateError` synchronously.
    if (error instanceof Error && error.name === 'InvalidStateError') {
      return new LocalDataStoreClosedError(this.database.name, this.closeReason ?? LocalDataStoreCloseReason.ClosedByBrowser, { cause: error });
    }
    return error instanceof Error ? error : new Error('Local data-store transaction failed', { cause: error });
  }
}

/**
 * Thrown by every operation of a {@link LocalDataStore} whose connection is closed or closing.
 *
 * It replaces IndexedDB's raw `InvalidStateError` ("The database connection is closing"), which names neither the
 * store nor the cause. The usual cause is work that outlived its owner: a debounced or scheduled save that runs after
 * the plugin unloaded and closed its store.
 */
export class LocalDataStoreClosedError extends Error {
  /**
   * Creates a {@link LocalDataStoreClosedError}.
   *
   * @param databaseName - The IndexedDB database name of the store.
   * @param reason - Why the connection closed.
   * @param options - The IndexedDB error this one replaces, as its `cause`.
   */
  public constructor(
    public readonly databaseName: string,
    public readonly reason: LocalDataStoreCloseReason,
    options?: LocalDataStoreClosedErrorConstructorOptions
  ) {
    super(`The local data store "${databaseName}" is closed (${reason}), so the operation was not run.`, options);
    this.name = 'LocalDataStoreClosedError';
  }
}
