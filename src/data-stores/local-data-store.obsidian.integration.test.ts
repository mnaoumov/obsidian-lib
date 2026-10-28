/// <reference types="obsidian-integration-testing/vitest/typings" />

import { randomUUID } from 'node:crypto';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'obsidian-lib-test';
/*
 * The per-key reset is ONE commit, so it runs in one closure under the transport's ~30 s per-eval cap. At 90,000
 * records it took 13 to 21 s on a quiet machine and went over the cap under load, which failed the release
 * preflight (the guide's 90,000-record figures were measured then). At a third of that the comparison below still
 * holds by an order of magnitude, with room left for a loaded machine.
 */
const RECORD_COUNT = 30_000;
const LARGE_STORE_TEST_TIMEOUT_IN_MILLISECONDS = 180_000;

interface ReadMeasurement {
  readonly count: number;
  readonly cursorRead: number;
  readonly entriesRead: number;
  readonly isSameOrder: boolean;
}

interface ResetMeasurement {
  readonly elapsed: number;
  readonly remaining: unknown;
}

describe('LocalDataStore in Obsidian', () => {
  it('replaces a store atomically in one transaction and keeps the old records when that transaction aborts', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { LocalDataStore }, pluginId }) {
        const params = { pluginId, storeId: `integration-${window.crypto.randomUUID()}`, vaultId: app.appId };
        const store = await LocalDataStore.open(params);
        const sibling = await LocalDataStore.open({ ...params, storeId: `${params.storeId}-sibling` });
        try {
          await store.commit({ entries: [['legacy', 'a'], ['marker', 1]] });
          await sibling.set('kept', true);
          const failed = await store.commit({ entries: [['marker', 2], ['bad', (): number => 1]], shouldClear: true })
            .then(() => 'committed')
            .catch(() => 'rejected');
          const afterFailure = await store.entries();
          await store.commit({ entries: [['marker', 2], ['metadata', { reset: true }]], shouldClear: true });
          store.close();
          const restarted = await LocalDataStore.open(params);
          const afterRestart = await restarted.entries();
          await restarted.clear();
          restarted.close();
          return { afterFailure, afterRestart, failed, sibling: await sibling.entries() };
        } finally {
          await sibling.clear();
          sibling.close();
        }
      },
      input: { pluginId: PLUGIN_ID }
    });
    expect(result.failed).toBe('rejected');
    expect(result.afterFailure).toEqual([['legacy', 'a'], ['marker', 1]]);
    expect(result.afterRestart).toEqual([['marker', 2], ['metadata', { reset: true }]]);
    expect(result.sibling).toEqual([['kept', true]]);
  });

  it(`reads and resets ${String(RECORD_COUNT)} records`, { timeout: LARGE_STORE_TEST_TIMEOUT_IN_MILLISECONDS }, async () => {
    // Seeding, each read and each reset run in closures of their own, so no single one approaches the transport's eval cap.
    const largeStoreId = `integration-${randomUUID()}`;
    try {
      await seed(largeStoreId);
      const reads = await measureReads(largeStoreId);
      const perKey = await measureReset(largeStoreId, false);
      await seed(largeStoreId);
      const clearing = await measureReset(largeStoreId, true);

      const timings = {
        clearingReset: Math.round(clearing.elapsed),
        cursorRead: Math.round(reads.cursorRead),
        entriesRead: Math.round(reads.entriesRead),
        perKeyReset: Math.round(perKey.elapsed)
      };
      process.stdout.write(`LocalDataStore at ${String(RECORD_COUNT)} records (ms): ${JSON.stringify(timings)}\n`);

      expect(reads.count).toBe(RECORD_COUNT);
      expect(reads.isSameOrder).toBe(true);
      expect(perKey.remaining).toEqual([['marker', 2]]);
      expect(clearing.remaining).toEqual([['marker', 2]]);
      expect(timings.clearingReset).toBeLessThan(timings.perKeyReset);
    } finally {
      await evalInObsidian({
        async callback({ app, lib: { LocalDataStore }, pluginId, storeId }) {
          const store = await LocalDataStore.open({ pluginId, storeId, vaultId: app.appId });
          await store.clear();
          store.close();
        },
        input: { pluginId: PLUGIN_ID, storeId: largeStoreId }
      });
    }
  });
});

async function measureReads(largeStoreId: string): Promise<ReadMeasurement> {
  return await evalInObsidian({
    async callback({ app, lib: { LocalDataStore }, pluginId, storeId }) {
      const store = await LocalDataStore.open({ pluginId, storeId, vaultId: app.appId });
      try {
        const name = `obsidian-lib:${JSON.stringify([app.appId, pluginId, storeId])}`;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onsuccess = (): void => {
            resolve(request.result);
          };
          request.addEventListener('error', () => {
            reject(new Error('Could not open the store database'));
          });
        });
        // The cursor is what `entries()` used before the bulk reads: one event per record, reading its key and value.
        async function readWithCursor(): Promise<[IDBValidKey, unknown][]> {
          return await new Promise((resolve, reject) => {
            const records: [IDBValidKey, unknown][] = [];
            const request = database.transaction('records', 'readonly').objectStore('records').openCursor();
            request.onsuccess = (): void => {
              const cursor = request.result;
              if (!cursor) {
                resolve(records);
                return;
              }
              records.push([cursor.key, cursor.value]);
              cursor.continue();
            };
            request.addEventListener('error', () => {
              reject(new Error('Cursor read failed'));
            });
          });
        }

        async function time(read: () => Promise<unknown[]>): Promise<number> {
          const start = performance.now();
          await read();
          return performance.now() - start;
        }

        // Alternate the two reads and take the median of three each, so neither always runs against a cold store.
        const cursorTimes: number[] = [];
        const entriesTimes: number[] = [];
        for (let round = 0; round < 3; round++) {
          cursorTimes.push(await time(readWithCursor));
          entriesTimes.push(await time(async () => await store.entries()));
        }
        function median(times: number[]): number {
          return [...times].sort((a, b) => a - b)[1] ?? NaN;
        }

        const entries = await store.entries();
        const cursorRecords = await readWithCursor();
        database.close();
        const isSameOrder = cursorRecords.length === entries.length
          && cursorRecords.every(([key], index) => key === entries[index]?.[0]);
        return { count: entries.length, cursorRead: median(cursorTimes), entriesRead: median(entriesTimes), isSameOrder };
      } finally {
        store.close();
      }
    },
    input: { pluginId: PLUGIN_ID, storeId: largeStoreId }
  });
}

async function measureReset(largeStoreId: string, isClearing: boolean): Promise<ResetMeasurement> {
  return await evalInObsidian({
    async callback({ app, lib: { LocalDataStore }, pluginId, shouldClear, storeId }) {
      const store = await LocalDataStore.open({ pluginId, storeId, vaultId: app.appId });
      try {
        const start = performance.now();
        if (shouldClear) {
          await store.commit({ entries: [['marker', 2]], shouldClear: true });
        } else {
          const existingEntries = await store.entries();
          await store.commit({ entries: [['marker', 2]], removedKeys: existingEntries.map(([key]) => key) });
        }
        const elapsed = performance.now() - start;
        return { elapsed, remaining: await store.entries() };
      } finally {
        store.close();
      }
    },
    input: { pluginId: PLUGIN_ID, shouldClear: isClearing, storeId: largeStoreId }
  });
}

async function seed(largeStoreId: string): Promise<void> {
  await evalInObsidian({
    async callback({ app, count, lib: { LocalDataStore }, pluginId, storeId }) {
      const store = await LocalDataStore.open({ pluginId, storeId, vaultId: app.appId });
      try {
        const entries: [string, unknown][] = [];
        for (let index = 0; index < count; index++) {
          entries.push([`folder-${String(index % 100)}/note-${String(index)}.md`, { hidden: index % 2 === 0, mtime: index }]);
        }
        await store.commit({ entries, shouldClear: true });
      } finally {
        store.close();
      }
    },
    input: { count: RECORD_COUNT, pluginId: PLUGIN_ID, storeId: largeStoreId }
  });
}
