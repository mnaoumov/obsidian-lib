import type { DataAdapter } from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { IDBFactory } from 'fake-indexeddb';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { DataStoreTransport } from './data-store-transport.ts';
import { LocalDataStore } from './local-data-store.ts';
import { SharedDataStore } from './shared-data-store.ts';

const BATCH_INTERVAL_IN_MILLISECONDS = 5000;
const BATCHES_PER_HOUR = 720;
const COMPACT_AFTER_WRITES = 120;
const HOUR_IN_MILLISECONDS = 3_600_000;
const DAY_IN_MILLISECONDS = 86_400_000;
// 720 batches through fake IndexedDB take a few seconds alone and far longer under coverage on a loaded machine.
const HOUR_TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

/* eslint-disable typescript-dev-toolkit/readonly-interface-members -- The counting adapter increments these as it writes. */
interface FileEvents {
  create: number;
  delete: number;
  modify: number;
}
/* eslint-enable typescript-dev-toolkit/readonly-interface-members -- The counting adapter increments these as it writes. */

function createCountingAdapter(files: Map<string, string>, events: FileEvents): DataAdapter {
  const directories = new Set<string>();
  return strictProxy<DataAdapter>({
    exists: (path) => Promise.resolve(files.has(path) || directories.has(path) || [...files.keys()].some((file) => file.startsWith(`${path}/`))),
    list: (path) => {
      const prefix = `${path}/`;
      const descendants = [...files.keys()].filter((file) => file.startsWith(prefix));
      return Promise.resolve({
        files: descendants.filter((file) => !file.slice(prefix.length).includes('/')),
        folders: [
          ...new Set([
            ...directories,
            ...descendants.filter((file) => file.slice(prefix.length).includes('/'))
              .map((file) => prefix + (file.slice(prefix.length).split('/', 1)[0] ?? ''))
          ])
        ]
          .filter((folder) => folder.startsWith(prefix) && !folder.slice(prefix.length).includes('/'))
      });
    },
    mkdir: (path) => {
      directories.add(path);
      return noopAsync();
    },
    read: (path) => {
      const value = files.get(path);
      return value === undefined ? Promise.reject(new Error('Missing file')) : Promise.resolve(value);
    },
    remove: (path) => {
      files.delete(path);
      events.delete++;
      return noopAsync();
    },
    write: (path, value) => {
      if (files.has(path)) {
        events.modify++;
      } else {
        events.create++;
      }
      files.set(path, value);
      return noopAsync();
    }
  });
}

const locals: LocalDataStore[] = [];

beforeEach(() => {
  vi.stubGlobal('navigator', { locks: { request: async <T>(_name: string, callback: () => Promise<T>): Promise<T> => await callback() } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const local of locals.splice(0)) {
    local.close();
  }
});

async function measureHour(deviceCount: number): Promise<FileEvents> {
  vi.useFakeTimers({ now: 1_800_000_000_000, toFake: ['Date'] });
  const files = new Map<string, string>();
  const events: FileEvents = { create: 0, delete: 0, modify: 0 };
  const stores: SharedDataStore[] = [];
  for (let index = 0; index < deviceCount; index++) {
    stores.push(await openStore(files, events));
  }
  const [writer, ...readers] = stores;
  if (!writer) {
    throw new Error('Expected a writer');
  }
  events.create = 0;
  events.delete = 0;
  events.modify = 0;
  for (let batch = 1; batch <= BATCHES_PER_HOUR; batch++) {
    vi.advanceTimersByTime(BATCH_INTERVAL_IN_MILLISECONDS);
    await writer.set(`heading-${String(batch % 40)}`, batch);
    for (const reader of readers) {
      await reader.synchronize();
    }
    if (batch % COMPACT_AFTER_WRITES === 0) {
      await writer.compact();
    }
  }
  for (const reader of readers) {
    expect(reader.get('heading-0')).toBe(BATCHES_PER_HOUR);
  }
  return events;
}

async function openStore(files: Map<string, string>, events: FileEvents): Promise<SharedDataStore> {
  const local = await LocalDataStore.open({ factory: new IDBFactory(), pluginId: 'test', storeId: 'shared', vaultId: 'vault' });
  locals.push(local);
  return await SharedDataStore.open({ adapter: createCountingAdapter(files, events), kind: 'last-write-wins', local, pluginId: 'test', storeId: 'shared' });
}

describe('SharedDataStore file churn', () => {
  // One small batch every 5 s for an hour, compacting every 120 writes. Before the growing segment and the
  // acknowledgement check, one device made 732 creates, 726 modifies and 730 deletes; a second device synchronizing
  // after every batch made 720 more modifies, of its acknowledgement.
  it('creates a file per sealed segment and compaction, not per batch', async () => {
    expect(await measureHour(1)).toEqual({ create: 18, delete: 16, modify: 714 });
  }, HOUR_TEST_TIMEOUT_IN_MILLISECONDS);

  it('rewrites a reader acknowledgement only when the writer moved', async () => {
    expect(await measureHour(2)).toEqual({ create: 18, delete: 16, modify: 1434 });
  }, HOUR_TEST_TIMEOUT_IN_MILLISECONDS);

  it('leaves an unchanged acknowledgement alone until it is due a refresh', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000, toFake: ['Date'] });
    const files = new Map<string, string>();
    const events: FileEvents = { create: 0, delete: 0, modify: 0 };
    const store = await openStore(files, events);
    await store.set('key', 1);
    const have = [...files.keys()].find((path) => path.endsWith('/have.md'));
    if (!have) {
      throw new Error('Expected an acknowledgement');
    }
    const written = files.get(have);
    vi.advanceTimersByTime(HOUR_IN_MILLISECONDS);
    await store.synchronize();
    await store.set('key', 2);
    expect(files.get(have)).toBe(written);
    vi.advanceTimersByTime(DAY_IN_MILLISECONDS);
    await store.synchronize();
    expect(files.get(have)).not.toBe(written);
    files.set(have, '```json\nnot json\n```\n');
    await store.synchronize();
    expect(files.get(have)).toContain('"vector"');
  });

  it('seals a segment once it outgrows the open-segment size and opens the next file', async () => {
    const files = new Map<string, string>();
    const store = await openStore(files, { create: 0, delete: 0, modify: 0 });
    for (let batch = 0; batch < 80; batch++) {
      await store.set(`key-${String(batch)}`, 'x'.repeat(1000));
    }
    const segments = [...files.keys()].filter((path) => path.includes('/log-'));
    expect(segments.length).toBe(2);
    const reader = await openStore(new Map(files), { create: 0, delete: 0, modify: 0 });
    expect(reader.entries()).toEqual(store.entries());
  });

  it('grows a segment only by extension and refuses any other rewrite', async () => {
    const files = new Map<string, string>();
    const events: FileEvents = { create: 0, delete: 0, modify: 0 };
    const transport = new DataStoreTransport({ adapter: createCountingAdapter(files, events), pluginId: 'test', storeId: 'test' });
    const path = `${transport.root}/devices/a/log-1.md`;
    await transport.writeAppendOnly(path, [1]);
    await transport.writeAppendOnly(path, [1, 2]);
    await transport.writeAppendOnly(path, [1, 2]);
    expect(events).toEqual({ create: 1, delete: 0, modify: 1 });
    await expect(transport.writeAppendOnly(path, [1])).rejects.toThrow('Conflicting immutable');
    await expect(transport.writeAppendOnly(path, [1, 3, 4])).rejects.toThrow('Conflicting immutable');
    files.set(path, '```json\n[1, 2');
    await expect(transport.writeAppendOnly(path, [1, 2, 3])).rejects.toThrow('Conflicting immutable');
    files.set(path, '```json\n{"value": 1}\n```\n');
    await expect(transport.writeAppendOnly(path, [1, 2, 3])).rejects.toThrow('Conflicting immutable');
  });

  it('copies whichever copy of a growing segment is longer and refuses diverging ones', async () => {
    const files = new Map<string, string>();
    const adapter = createCountingAdapter(files, { create: 0, delete: 0, modify: 0 });
    const source = new DataStoreTransport({ adapter, pluginId: 'test', storeId: 'test' });
    const target = new DataStoreTransport({ adapter, folder: 'Moved', pluginId: 'test', storeId: 'test' });
    const path = `${source.root}/devices/a/log-1.md`;
    const destination = `${target.root}/devices/a/log-1.md`;
    await source.writeAppendOnly(path, [1]);
    await source.copyHistoryTo(target);
    await source.writeAppendOnly(path, [1, 2]);
    await source.copyHistoryTo(target);
    expect(await target.read(destination)).toEqual([1, 2]);
    await target.writeAppendOnly(destination, [1, 2, 3]);
    await source.copyHistoryTo(target);
    expect(await target.read(destination)).toEqual([1, 2, 3]);
    files.set(destination, '```json\n[1, 4]\n```\n');
    await expect(source.copyHistoryTo(target)).rejects.toThrow('Conflicting immutable');
    files.set(destination, '```json\nnot json\n```\n');
    await expect(source.copyHistoryTo(target)).rejects.toThrow('Conflicting immutable');
  });
});
