import {
  IDBDatabase,
  IDBFactory,
  IDBObjectStore
} from 'fake-indexeddb';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { LocalDataStore } from './local-data-store.ts';

describe('LocalDataStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('persists records across connections and separates vaults and stores', async () => {
    const factory = new IDBFactory();
    const params = { factory, pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' };
    const first = await LocalDataStore.open(params);
    await first.set('a', { count: 1 });
    await first.set('b', [2]);
    first.close();
    const second = await LocalDataStore.open(params);
    expect(await second.get('a')).toEqual({ count: 1 });
    expect(await second.entries()).toEqual([['a', { count: 1 }], ['b', [2]]]);
    const other = await LocalDataStore.open({ ...params, vaultId: 'other' });
    expect(await other.get('a')).toBeUndefined();
    await second.delete('a');
    expect(await second.get('a')).toBeUndefined();
    await second.clear();
    expect(await second.entries()).toEqual([]);
    second.close();
    other.close();
  });

  it('atomically initializes a device identity across connections', async () => {
    const factory = new IDBFactory();
    const params = { factory, pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' };
    const first = await LocalDataStore.open(params);
    const second = await LocalDataStore.open(params);
    const values = await Promise.all([first.getOrCreate('identity', 'A'), second.getOrCreate('identity', 'B')]);
    expect(values).toEqual(['A', 'A']);
    first.close();
    second.close();
  });

  it('commits records and deletions atomically and preserves existing null values', async () => {
    const store = await LocalDataStore.open({ factory: new IDBFactory(), pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' });
    await store.set('old', 1);
    await store.commit({ entries: [['a', null], ['b', [2]]], removedKeys: ['old'] });
    expect(await store.getOrCreate('a', 'replacement')).toBeNull();
    expect(await store.get('old')).toBeUndefined();
    await expect(store.commit({ entries: [['would-be-committed', true], ['bad', (): number => 1]] })).rejects.toThrow();
    expect(await store.get('would-be-committed')).toBeUndefined();
    store.close();
  });

  it('clears and reseeds a store in one transaction, durably and only for that store', async () => {
    const factory = new IDBFactory();
    const params = { factory, pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' };
    const empty = await LocalDataStore.open(params);
    await empty.commit({ entries: [['marker', 1]], shouldClear: true });
    expect(await empty.entries()).toEqual([['marker', 1]]);
    await empty.commit({ entries: [['legacy', 'a'], ['marker', 1], ['other', 'b']] });
    const sibling = await LocalDataStore.open({ ...params, storeId: 'sibling' });
    await sibling.set('kept', true);
    await empty.commit({ entries: [['marker', 2], ['metadata', { reset: true }]], removedKeys: ['absent'], shouldClear: true });
    empty.close();
    const restarted = await LocalDataStore.open(params);
    expect(await restarted.entries()).toEqual([['marker', 2], ['metadata', { reset: true }]]);
    expect(await sibling.entries()).toEqual([['kept', true]]);
    await restarted.commit({ entries: [], shouldClear: true });
    expect(await restarted.entries()).toEqual([]);
    restarted.close();
    sibling.close();
  });

  it('keeps every previous record when a clearing commit fails', async () => {
    const factory = new IDBFactory();
    const params = { factory, pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' };
    const store = await LocalDataStore.open(params);
    const previous = [['legacy', 'a'], ['marker', 1]] as [string, unknown][];
    await store.commit({ entries: previous });
    await expect(store.commit({ entries: [['marker', 2], ['bad', (): number => 1]], shouldClear: true })).rejects.toThrow();
    expect(await store.entries()).toEqual(previous);

    const originalPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function abortAfterLastPut(this: IDBObjectStore, ...arguments_) {
      const request = originalPut.apply(this, arguments_);
      if (arguments_[1] === 'metadata') {
        request.addEventListener('success', () => {
          this.transaction.abort();
        });
      }
      return request;
    });
    await expect(store.commit({ entries: [['marker', 2], ['metadata', true]], shouldClear: true })).rejects.toThrow('transaction aborted');
    putSpy.mockRestore();
    store.close();
    const restarted = await LocalDataStore.open(params);
    expect(await restarted.entries()).toEqual(previous);
    restarted.close();
  });

  it('closes on a schema upgrade and reports opening an incompatible newer database', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const params = { pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' };
    const store = await LocalDataStore.open(params);
    const name = `obsidian-lib:${JSON.stringify(['vault', 'plugin', 'cache'])}`;
    const request = factory.open(name, 2);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = (): void => {
        resolve(request.result);
      };
      request.addEventListener('error', (): void => {
        reject(new Error('Upgrade failed'));
      });
    });
    database.close();
    await expect(store.get('key')).rejects.toThrow();
    await expect(LocalDataStore.open(params)).rejects.toThrow('Could not open');
  });

  it('does not report a request as committed when its transaction aborts', async () => {
    const store = await LocalDataStore.open({ factory: new IDBFactory(), pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' });
    const original = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function abortTransaction(this: IDBDatabase, ...arguments_) {
      const transaction = original.apply(this, arguments_);
      queueMicrotask(() => {
        transaction.abort();
      });
      return transaction;
    });
    await expect(store.set('key', true)).rejects.toThrow('transaction aborted');
    store.close();
  });

  it('propagates synchronous write errors and rejects corrupted non-string keys', async () => {
    const factory = new IDBFactory();
    const store = await LocalDataStore.open({ factory, pluginId: 'plugin', storeId: 'cache', vaultId: 'vault' });
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('Quota');
    });
    await expect(store.set('key', true)).rejects.toThrow('Quota');
    put.mockRestore();
    const request = factory.open(`obsidian-lib:${JSON.stringify(['vault', 'plugin', 'cache'])}`, 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = (): void => {
        resolve(request.result);
      };
    });
    const transaction = database.transaction('records', 'readwrite');
    transaction.objectStore('records').put('bad key', 1);
    await new Promise<void>((resolve) => {
      transaction.oncomplete = (): void => {
        resolve();
      };
    });
    await expect(store.entries()).rejects.toThrow('transaction aborted');
    database.close();
    store.close();
  });
});
