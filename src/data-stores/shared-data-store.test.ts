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

import type { SharedDataStoreOpenParams } from './shared-data-store.ts';

import { DataStoreSeeds } from './data-store-seeds.ts';
import { DataStoreTransport } from './data-store-transport.ts';
import { LocalDataStore } from './local-data-store.ts';
import { SharedDataStore } from './shared-data-store.ts';

function createAdapter(files: Map<string, string>): DataAdapter {
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
      return noopAsync();
    },
    write: (path, value) => {
      files.set(path, value);
      return noopAsync();
    }
  });
}

const locals: LocalDataStore[] = [];

async function openDevice(files: Map<string, string>, options: Partial<SharedDataStoreOpenParams> = {}): Promise<SharedDataStore> {
  return await SharedDataStore.open({ adapter: createAdapter(files), kind: 'last-write-wins', local: await openLocal(), pluginId: 'test', storeId: 'shared', ...options });
}

async function openLocal(): Promise<LocalDataStore> {
  const local = await LocalDataStore.open({ factory: new IDBFactory(), pluginId: 'test', storeId: 'shared', vaultId: 'vault' });
  locals.push(local);
  return local;
}

describe('SharedDataStore', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { locks: { request: async <T>(_name: string, callback: () => Promise<T>): Promise<T> => await callback() } });
  });

  afterEach(() => {
    for (const local of locals.splice(0)) {
      local.close();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('merges two writers and bootstraps a new device after trimming', async () => {
    const files = new Map<string, string>();
    const first = await openDevice(files);
    const second = await openDevice(files);
    await Promise.all([first.set('A', 1), second.set('B', 2)]);
    await first.synchronize();
    await second.synchronize();
    expect(first.entries()).toEqual([['A', 1], ['B', 2]]);
    expect(first.get('A')).toBe(1);
    expect(second.entries()).toEqual(first.entries());
    await first.compact();
    await second.compact();
    const third = await openDevice(files);
    expect(third.entries()).toEqual(first.entries());
    expect([...files.keys()].some((path) => path.includes('snapshot-'))).toBe(true);
  });

  it('holds acknowledgements at gaps and ignores a segment copied partway', async () => {
    const source = new Map<string, string>();
    const writer = await openDevice(source);
    await writer.set('first', 1);
    await writer.set('second', 2);
    const first = [...source].find(([path]) => path.endsWith('/log-1.md'));
    const second = [...source].find(([path]) => path.endsWith('/log-2.md'));
    if (!first || !second) {
      throw new Error('Expected two log segments');
    }
    const delivered = new Map<string, string>([[first[0], first[1].slice(0, -4)], second]);
    const reader = await openDevice(delivered);
    expect(reader.entries()).toEqual([]);
    delivered.set(...first);
    await reader.synchronize();
    expect(reader.entries()).toEqual([['first', 1], ['second', 2]]);
  });

  it('waits for every snapshot chunk and verifies its hash before adopting it', async () => {
    const source = new Map<string, string>();
    const writer = await openDevice(source, { maxFileBytes: 1024 });
    await writer.setMany(Array.from({ length: 8 }, (_, index) => [`key-${String(index)}`, 'value'.repeat(20)]));
    await writer.compact();
    const snapshot = [...source].filter(([path]) => path.includes('/snapshot-'));
    const chunk = snapshot.find(([path]) => path.endsWith('-0.md'));
    if (!chunk) {
      throw new Error('Expected a snapshot chunk');
    }
    const delivered = new Map(snapshot.filter(([path]) => path !== chunk[0]));
    const reader = await openDevice(delivered, { maxFileBytes: 1024 });
    expect(reader.entries()).toEqual([]);
    delivered.set(chunk[0], '```json\n"bad hash"\n```\n');
    await reader.synchronize();
    expect(reader.entries()).toEqual([]);
    delivered.set(...chunk);
    await reader.synchronize();
    expect(reader.entries()).toEqual(writer.entries());
    expect([...source.values()].every((text) => new TextEncoder().encode(text).length <= 1024)).toBe(true);
  });

  it('retains unacknowledged history until retirement and rejoins an old device from a snapshot', async () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const files = new Map<string, string>();
    const first = await openDevice(files, { activeDeviceMilliseconds: 10 });
    const second = await openDevice(files, { activeDeviceMilliseconds: 10 });
    await first.set('key', 'value');
    await first.compact();
    expect([...files.keys()].some((path) => path.includes('/log-'))).toBe(true);
    now = 111;
    await first.compact();
    expect([...files.keys()].some((path) => path.includes('/log-'))).toBe(false);
    await second.synchronize();
    expect(second.entries()).toEqual([['key', 'value']]);
    expect([...files.keys()].filter((path) => path.endsWith('-manifest.md'))).toHaveLength(1);
  });

  it('retains history when another device has an incomplete acknowledgement', async () => {
    const files = new Map<string, string>();
    const writer = await openDevice(files);
    files.set('Plugin data/test/shared/devices/offline/have.md', 'partial');
    await writer.set('key', 'value');
    await writer.compact();
    expect([...files.keys()].some((path) => path.includes('/log-'))).toBe(true);
  });

  it('preserves tombstones through compaction and delivery of an old snapshot', async () => {
    const files = new Map<string, string>();
    const first = await openDevice(files);
    await first.set('key', 'old');
    files.set('Plugin data/test/shared/seeds/unrelated/snapshot-unknown-manifest.md', 'unrelated cache');
    await first.compact();
    const old = [...files].filter(([path]) => path.includes('/snapshot-'));
    await first.delete('key');
    await first.compact();
    for (const entry of old) {
      files.set(...entry);
    }
    const second = await openDevice(files);
    expect(second.entries()).toEqual([]);
  });

  it('restores identity and record-level state across restart', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const first = await openDevice(files, { local });
    await first.set('key', 1);
    files.clear();
    const second = await openDevice(files, { local });
    expect(second.entries()).toEqual([['key', 1]]);
    await second.set('key', 2);
    expect([...files.keys()].some((path) => path.endsWith('/log-2.md'))).toBe(true);
    const localEntries = await local.entries();
    expect(localEntries.filter(([key]) => key.startsWith('shared-record-'))).toHaveLength(1);
  });

  it('refuses invalid identity, merge changes, invalid retirement and corrupt journals', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    await local.set('shared-device-v1', '../bad');
    await expect(openDevice(files, { local })).rejects.toThrow('identity');
    await local.clear();
    await expect(openDevice(files, { activeDeviceMilliseconds: 0, local })).rejects.toThrow('interval');
    await openDevice(files, { local });
    await expect(openDevice(files, { kind: 'minimum', local })).rejects.toThrow('merge rule');
    files.set('Plugin data/test/shared/devices/bad/log-1.md', '```json\n[{}]\n```\n');
    await expect(openDevice(files)).rejects.toThrow('journal segment');
  });

  it('rejects foreign writers and refuses a single oversized operation before publishing', async () => {
    const files = new Map<string, string>();
    const writer = await openDevice(files, { maxFileBytes: 1024 });
    await expect(writer.set('large', 'x'.repeat(2000))).rejects.toThrow('file limit');
    expect([...files.keys()].some((path) => path.includes('/log-'))).toBe(false);
    await writer.set('small', true);
    const log = [...files].find(([path]) => path.includes('/log-'));
    if (!log) {
      throw new Error('Expected a log');
    }
    files.set('Plugin data/test/shared/devices/wrong/log-1.md', log[1]);
    await expect(writer.synchronize()).rejects.toThrow('different writer');
  });

  it('converges three offline devices with shuffled and duplicated file delivery', async () => {
    const views = Array.from({ length: 3 }, () => new Map<string, string>());
    const stores = await Promise.all(views.map(async (files) => await openDevice(files)));
    for (const [index, store] of stores.entries()) {
      await store.setMany(Array.from({ length: 12 }, (_, key) => [`key-${String(key)}`, String(index)]));
    }
    const all = views.flatMap((files) => [...files]);
    let seed = 73;
    for (let iteration = 0; iteration < 100; iteration++) {
      seed = (seed * 16_807) % 2_147_483_647;
      const entry = all[seed % all.length];
      const target = views[iteration % views.length];
      if (!entry || !target) {
        throw new Error('Expected delivery');
      }
      target.set(...entry);
    }
    for (const view of views) {
      for (const entry of all) {
        view.set(...entry);
      }
    }
    for (const store of stores) {
      await store.synchronize();
    }
    expect(stores[1]?.entries()).toEqual(stores[0]?.entries());
    expect(stores[2]?.entries()).toEqual(stores[0]?.entries());
    expect(stores[0]?.entries()).toHaveLength(12);
  });

  it('publishes optional cache seeds and replaces only the publishing device files', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const transport = new DataStoreTransport({ adapter: createAdapter(files), pluginId: 'test', storeId: 'seeds' });
    const seeds = new DataStoreSeeds({ local, share: true, transport });
    const entries = [{ hash: 'hash', mtime: 1, path: 'note.md', size: 10, value: { index: [1, 2] } }];
    expect(await seeds.readLatest()).toBeUndefined();
    expect(await seeds.publish(entries)).toBe(true);
    expect(await seeds.readLatest()).toEqual(entries);
    const other = new DataStoreSeeds({ local: await openLocal(), share: true, transport });
    await other.publish(entries);
    await seeds.publish(entries);
    expect([...files.keys()].filter((path) => path.endsWith('-manifest.md'))).toHaveLength(2);
    const disabled = new DataStoreSeeds({ local, share: false, transport });
    expect(await disabled.publish(entries)).toBe(false);
    expect(await disabled.readLatest()).toBeUndefined();
    await local.set('seed-device-v1', '../bad');
    await expect(seeds.publish(entries)).rejects.toThrow('identity');
  });

  it('retains a segment that becomes incomplete while compaction is reading it', async () => {
    const files = new Map<string, string>();
    const adapter = createAdapter(files);
    const writer = await openDevice(files, { adapter });
    await writer.set('key', true);
    const originalRead = adapter.read.bind(adapter);
    let logReads = 0;
    vi.spyOn(adapter, 'read').mockImplementation(async (path) => {
      return path.includes('/log-') && ++logReads > 1 ? 'partial' : (await originalRead(path));
    });
    await writer.compact();
    expect([...files.keys()].some((path) => path.includes('/log-'))).toBe(true);
    expect([...files.keys()].some((path) => path.endsWith('-manifest.md'))).toBe(true);
  });

  it('treats empty writes as no-ops and compacts set records without resurrecting removed members', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const store = await openDevice(files, { kind: 'observed-remove-set', local });
    await store.setMany([]);
    await store.set('member', true);
    await store.delete('member');
    await store.set('member', true);
    await store.delete('member');
    await store.compact();
    expect(store.entries()).toEqual([]);
    const localEntries = await local.entries();
    expect(localEntries.filter(([key]) => key.startsWith('shared-record-'))).toHaveLength(1);
    const reader = await openDevice(files, { kind: 'observed-remove-set' });
    expect(reader.entries()).toEqual([]);
  });

  it('validates transport paths and limits before writing', async () => {
    const files = new Map<string, string>();
    const adapter = createAdapter(files);
    for (const folder of ['', '.hidden', 'a/../b', String.raw`a\b`]) {
      expect(() => new DataStoreTransport({ adapter, folder, pluginId: 'test', storeId: 'test' })).toThrow('folder');
    }
    expect(() => new DataStoreTransport({ adapter, pluginId: '../bad', storeId: 'test' })).toThrow('ids');
    expect(() => new DataStoreTransport({ adapter, maxFileBytes: 0, pluginId: 'test', storeId: 'test' })).toThrow('limit');
    const transport = new DataStoreTransport({ adapter, folder: 'Data', pluginId: 'test', storeId: 'test' });
    await expect(transport.write('outside/file.md', {})).rejects.toThrow('path');
    await expect(transport.write(`${transport.root}/../file.md`, {})).rejects.toThrow('path');
    await expect(transport.write(`${transport.root}/file.md`, undefined)).rejects.toThrow('JSON');
    expect(files.size).toBe(0);
  });

  it('distinguishes incomplete documents, deletion races and adapter failures', async () => {
    const files = new Map<string, string>();
    const adapter = createAdapter(files);
    const transport = new DataStoreTransport({ adapter, pluginId: 'test', storeId: 'test' });
    const path = `${transport.root}/file.md`;
    await transport.write(path, 'value');
    const read = vi.spyOn(adapter, 'read').mockImplementation(() => {
      files.delete(path);
      return Promise.reject(new Error('Gone'));
    });
    expect(await transport.read(path)).toBeUndefined();
    files.set(path, 'partial');
    await expect(transport.read(path)).resolves.toBeUndefined();
    read.mockRejectedValue(new Error('Disk unavailable'));
    files.set(path, 'partial');
    await expect(transport.read(path)).rejects.toThrow('Disk unavailable');
    read.mockRestore();
    expect(await transport.read(path)).toBeUndefined();
    files.set(path, '```json\ninvalid\n```\n');
    await expect(transport.read(path)).rejects.toThrow();
  });

  it('handles concurrent directory creation but propagates a genuine mkdir failure', async () => {
    const files = new Map<string, string>();
    const adapter = createAdapter(files);
    const transport = new DataStoreTransport({ adapter, pluginId: 'test', storeId: 'test' });
    const mkdir = vi.spyOn(adapter, 'mkdir').mockImplementation((path) => {
      files.set(`${path}/concurrent.md`, '');
      return Promise.reject(new Error('Already exists'));
    });
    await transport.write(`${transport.root}/file.md`, true);
    expect(await transport.read(`${transport.root}/file.md`)).toBe(true);
    files.clear();
    mkdir.mockRejectedValue(new Error('Read only'));
    await expect(transport.write(`${transport.root}/file.md`, true)).rejects.toThrow('Read only');
  });

  it('refuses oversize documents, oversize manifests and non-JSON snapshots', async () => {
    const files = new Map<string, string>();
    const transport = new DataStoreTransport({ adapter: createAdapter(files), maxFileBytes: 256, pluginId: 'test', storeId: 'test' });
    const base = `${transport.root}/snapshot`;
    await expect(transport.writeSnapshot({ base, payload: undefined })).rejects.toThrow('JSON');
    await expect(transport.writeSnapshot({ base, payload: 'x'.repeat(5000) })).rejects.toThrow('file limit');
    expect(files.size).toBe(0);
    files.set(`${base}.md`, 'x'.repeat(1000));
    await expect(transport.read(`${base}.md`)).rejects.toThrow('file limit');
  });

  it('skips invalid snapshot manifests and unsupported seed schemas', async () => {
    const files = new Map<string, string>();
    const transport = new DataStoreTransport({ adapter: createAdapter(files), pluginId: 'test', storeId: 'test' });
    const path = `${transport.root}/seed-invalid-manifest.md`;
    for (const value of [null, {}, { format: 2, hashes: [] }, { format: 1, hashes: [] }, { format: 1, hashes: [1] }]) {
      await transport.write(path, value);
      expect(await transport.readSnapshot(path)).toBeUndefined();
    }
    const local = await openLocal();
    const seeds = new DataStoreSeeds({ local, share: true, transport });
    await transport.writeSnapshot({ base: path.slice(0, -3), payload: { entries: [], format: 2, time: 1 } });
    expect(await seeds.readLatest()).toBeUndefined();
    await transport.writeSnapshot({ base: path.slice(0, -3), payload: { entries: [], format: 1, time: 1 } });
    expect(await seeds.readLatest()).toEqual([]);
    files.set(path, '```json\ninvalid json\n```\n');
    expect(await seeds.readLatest()).toBeUndefined();
    vi.spyOn(transport, 'readSnapshot').mockRejectedValue(new Error('Disk unavailable'));
    await expect(seeds.readLatest()).rejects.toThrow('Disk unavailable');
  });
});
