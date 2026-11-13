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
  it('makes no adapter calls while disabled and publishes offline history when enabled', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const adapter = strictProxy<DataAdapter>({});
    const first = await openDevice(files, { adapter, isSyncEnabled: false, local });
    await first.set('deleted', 1);
    await first.delete('deleted');
    await first.set('offline', 2);
    await first.compact();
    await first.synchronize();
    const reopened = await openDevice(files, { adapter, isSyncEnabled: false, local });
    expect(reopened.entries()).toEqual([['offline', 2]]);
    expect(reopened.transportRoots).toEqual(['Plugin data/test/shared']);
    const online = await openDevice(files, { format: 'json', local });
    const reader = await openDevice(files, { format: 'json' });
    expect(reader.entries()).toEqual(reopened.entries());
    await online.setSyncEnabled(false);
    await online.set('after-disable', 3);
    await online.setSyncEnabled(true);
    await reader.synchronize();
    expect(reader.entries()).toEqual(online.entries());
    expect([...files.keys()].every((path) => path.endsWith('.json'))).toBe(true);
  });

  it('retains old-root readers through relocation, restart, and late old-client writes', async () => {
    const files = new Map<string, string>();
    const first = await openDevice(files);
    const secondFiles = new Map<string, string>();
    const second = await openDevice(secondFiles);
    await first.set('old', 1);
    await second.set('other', 2);
    for (const entry of secondFiles) {
      files.set(...entry);
    }
    await first.relocate({ folder: 'New data', format: 'json' });
    expect(first.transportRoots).toEqual(['Plugin data/test/shared', 'New data/test/shared']);
    expect(first.containsTransportPath('New data')).toBe(true);
    expect(first.containsTransportPath('New data/test/shared-sibling')).toBe(false);
    await first.set('new', 3);
    const reopened = await openDevice(files);
    expect(reopened.entries()).toEqual(first.entries());
    await second.set('late', 4);
    for (const entry of secondFiles) {
      files.set(...entry);
    }
    await reopened.synchronize();
    expect(reopened.get('late')).toBe(4);
    expect([...files.keys()].some((path) => path.startsWith('New data/') && path.endsWith('.json'))).toBe(true);
    expect([...files.keys()].some((path) => path.startsWith('Plugin data/') && path.includes('/log-'))).toBe(true);
  });

  it('retains migration exclusions across disabled restarts without touching the adapter', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const store = await openDevice(files, { local });
    await store.set('key', 1);
    await store.relocate({ folder: 'Moved', format: 'json' });
    await store.setSyncEnabled(false);
    const disabled = await openDevice(files, { adapter: strictProxy<DataAdapter>({}), isSyncEnabled: false, local });
    expect(disabled.transportRoots).toEqual(['Plugin data/test/shared', 'Moved/test/shared']);
    expect(disabled.containsTransportPath('Moved/test')).toBe(true);
    expect(disabled.containsTransportPath('Moved/test/shared-sibling')).toBe(false);
    expect(disabled.get('key')).toBe(1);
    for (const roots of [null, [1], ['wrong/plugin/store'], ['../test/shared']]) {
      await local.set('shared-transport-roots-v1', roots);
      await expect(openDevice(files, { adapter: strictProxy<DataAdapter>({}), isSyncEnabled: false, local })).rejects.toThrow();
    }
  });

  it('retries an interrupted enable from its durable unpublished checkpoint', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const adapter = createAdapter(files);
    const store = await openDevice(files, { adapter, format: 'json', isSyncEnabled: false, local });
    await store.set('key', 'offline');
    const write = vi.spyOn(adapter, 'write').mockRejectedValueOnce(new Error('Offline disk'));
    await expect(store.setSyncEnabled(true)).rejects.toThrow('Offline disk');
    write.mockRestore();
    await openDevice(files, { format: 'json', local });
    const reader = await openDevice(files, { format: 'json' });
    expect(reader.get('key')).toBe('offline');
    expect(await local.get('shared-unpublished-v1')).toBe(false);
  });

  it('retries partial relocation without overwriting conflicting history or deleting siblings', async () => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const adapter = createAdapter(files);
    const store = await openDevice(files, { adapter, local });
    await store.set('first', 1);
    await store.set('second', 2);
    await store.compact();
    files.set('Plugin data/sibling/shared/keep.md', 'sibling');
    const original = adapter.write.bind(adapter);
    const write = vi.spyOn(adapter, 'write').mockImplementation(async (path, text) => {
      if (path.startsWith('Moved/') && path.includes('-manifest.md')) {
        throw new Error('Interrupted transfer');
      }
      await original(path, text);
    });
    await expect(store.relocate({ folder: 'Moved', format: 'json' })).rejects.toThrow('Interrupted transfer');
    write.mockRestore();
    await store.relocate({ folder: 'Moved', format: 'json' });
    await store.relocate({ folder: 'Moved', format: 'json' });
    expect(files.get('Plugin data/sibling/shared/keep.md')).toBe('sibling');
    expect([...files.keys()].some((path) => path.startsWith('Moved/sibling/'))).toBe(false);
    const copy = [...files.keys()].find((path) => path.startsWith('Moved/') && path.endsWith('-manifest.md'));
    if (!copy) {
      throw new Error('Expected copied manifest');
    }
    const correct = files.get(copy);
    files.set(copy, 'different bytes');
    await expect(store.synchronize()).rejects.toThrow('Conflicting immutable');
    files.set(copy, correct ?? '');
    const reopened = await openDevice(files, { local });
    expect(reopened.entries()).toEqual([['first', 1], ['second', 2]]);
  });

  it('retains incomplete old-root deliveries until complete and verifies destination bytes', async () => {
    const files = new Map<string, string>();
    const adapter = createAdapter(files);
    const store = await openDevice(files, { adapter });
    await store.set('first', 1);
    const log = [...files].find(([path]) => path.includes('/log-'));
    if (!log) {
      throw new Error('Expected journal');
    }
    files.set(log[0], 'partial');
    await store.relocate({ folder: 'Moved' });
    const destination = log[0].replace('Plugin data/', 'Moved/');
    expect(files.has(destination)).toBe(false);
    files.set(...log);
    const write = vi.spyOn(adapter, 'write').mockImplementation((path, text) => {
      files.set(path, path === destination ? 'torn' : text);
      return noopAsync();
    });
    await expect(store.synchronize()).rejects.toThrow('verification');
    files.delete(destination);
    write.mockRestore();
    await store.synchronize();
    expect(files.get(destination)).toBe(log[1]);
  });

  it('changes format in place, preserves deletions and compacts JSON snapshots', async () => {
    const files = new Map<string, string>();
    const store = await openDevice(files);
    await store.set('deleted', 1);
    await store.relocate({ folder: 'Plugin data', format: 'json' });
    await store.delete('deleted');
    await store.set('kept', 2);
    await store.compact();
    const reader = await openDevice(files);
    expect(reader.entries()).toEqual([['kept', 2]]);
    expect(store.transportRoots).toEqual(['Plugin data/test/shared']);
    await expect(store.relocate({ folder: 'Plugin data' })).rejects.toThrow('loop');
    await store.setSyncEnabled(false);
    await expect(store.relocate({ folder: 'Elsewhere' })).rejects.toThrow('Enable');
  });

  it('fails closed on concurrent conflicting destinations and reordered transition delivery', async () => {
    const firstFiles = new Map<string, string>();
    const secondFiles = new Map<string, string>();
    const first = await openDevice(firstFiles);
    const second = await openDevice(secondFiles);
    await first.set('A', 1);
    await second.set('B', 2);
    await first.relocate({ folder: 'First' });
    await second.relocate({ folder: 'Second' });
    for (const entry of secondFiles) {
      firstFiles.set(...entry);
    }
    await expect(first.synchronize()).rejects.toThrow('Conflicting');
    expect(first.get('A')).toBe(1);
    const transport = new DataStoreTransport({ adapter: createAdapter(new Map()), pluginId: 'test', storeId: 'shared' });
    await expect(transport.readSnapshot(`${transport.root}/missing.md`)).resolves.toBeUndefined();
    const reordered = new Map<string, string>();
    const control = new DataStoreTransport({ adapter: createAdapter(reordered), pluginId: 'test', storeId: 'shared' });
    const path = `${control.root}/locations-v1/later.json`;
    await control.write(path, { format: 1, from: { folder: 'First' }, to: { folder: 'Last' } });
    await expect(openDevice(reordered)).rejects.toThrow('incomplete');
    await control.write(`${control.root}/locations-v1/earlier.json`, { format: 1, from: { folder: 'Plugin data' }, to: { folder: 'First' } });
    const reader = await openDevice(reordered);
    expect(reader.transportRoots).toEqual(['Plugin data/test/shared', 'First/test/shared', 'Last/test/shared']);
  });

  it('validates transition documents, containment, duplicate destinations and loops', async () => {
    const files = new Map<string, string>();
    const store = await openDevice(files);
    const control = new DataStoreTransport({ adapter: createAdapter(files), pluginId: 'test', storeId: 'shared' });
    const path = `${control.root}/locations-v1/request.json`;
    for (const value of [null, {}, { format: 2 }, { format: 1, from: {}, to: {} }, { format: 1, from: { folder: 'Plugin data' }, to: { folder: 'Bad', format: 'bad' } }]) {
      await control.write(path, value);
      await expect(store.synchronize()).rejects.toThrow('invalid');
    }
    files.set(path, '{');
    await expect(store.synchronize()).rejects.toThrow('Incomplete');
    files.delete(path);
    await expect(store.relocate({ folder: '../outside' })).rejects.toThrow('folder');
    await expect(store.relocate({ folder: 'Plugin data/test/shared/nested' })).rejects.toThrow('Overlapping');
    const transition = { format: 1, from: { folder: 'Plugin data' }, to: { folder: 'Moved' } };
    await control.write(path, transition);
    await control.write(`${control.root}/locations-v1/duplicate.json`, transition);
    await store.synchronize();
    expect(store.transportRoots).toEqual(['Plugin data/test/shared', 'Moved/test/shared']);
    await control.write(`${control.root}/locations-v1/loop.json`, { format: 1, from: { folder: 'Moved' }, to: { folder: 'Plugin data' } });
    await expect(store.synchronize()).rejects.toThrow('loop');
  });

  it('ignores unknown location metadata without changing adapter, limits or store identity', async () => {
    const files = new Map<string, string>();
    const store = await openDevice(files);
    await store.set('key', 1);
    const control = new DataStoreTransport({ adapter: createAdapter(files), pluginId: 'test', storeId: 'shared' });
    await control.write(`${control.root}/locations-v1/request.json`, {
      format: 1,
      from: { folder: 'Plugin data' },
      to: { adapter: {}, folder: 'Moved', format: 'json', maxFileBytes: 1, maxSnapshotBytes: 1, pluginId: 'sibling', storeId: 'other' }
    });
    await store.synchronize();
    await store.set('after', 2);
    expect(store.transportRoots).toEqual(['Plugin data/test/shared', 'Moved/test/shared']);
    expect(store.entries()).toEqual([['after', 2], ['key', 1]]);
    expect([...files.keys()].some((path) => path.startsWith('Moved/sibling/'))).toBe(false);
  });

  it('bounds JSON envelopes and reconstructed snapshots, and refuses immutable rewrites', async () => {
    const files = new Map<string, string>();
    const params = { adapter: createAdapter(files), format: 'json' as const, pluginId: 'test', storeId: 'shared' };
    const transport = new DataStoreTransport(params);
    const path = `${transport.root}/value.json`;
    await transport.writeImmutable(path, { value: 1 });
    await transport.writeImmutable(path, { value: 1 });
    await expect(transport.writeImmutable(path, { value: 2 })).rejects.toThrow('Conflicting immutable');
    files.set(path, '{');
    expect(await transport.read(path)).toBeUndefined();
    for (const text of ['null', '{}', '{"format":2,"payload":1}', '{"format":1}']) {
      files.set(path, text);
      await expect(transport.read(path)).rejects.toThrow('Invalid JSON');
    }
    expect(() => new DataStoreTransport({ ...params, maxSnapshotBytes: 0 })).toThrow('snapshot limit');
    const bounded = new DataStoreTransport({ ...params, maxFileBytes: 256, maxSnapshotBytes: 256 });
    await expect(bounded.writeSnapshot({ base: `${transport.root}/oversize`, payload: 'x'.repeat(300) })).rejects.toThrow('decoded byte limit');
    await transport.writeSnapshot({ base: `${transport.root}/snapshot`, payload: 'x'.repeat(300) });
    await expect(bounded.readSnapshot(`${transport.root}/snapshot.json`)).rejects.toThrow('file limit');
    const decodedBound = new DataStoreTransport({ ...params, maxSnapshotBytes: 256 });
    await expect(decodedBound.readSnapshot(`${transport.root}/snapshot.json`)).rejects.toThrow('decoded byte limit');
    const seeds = new DataStoreSeeds({ local: await openLocal(), share: true, transport });
    await seeds.publish([]);
    expect(await seeds.readLatest()).toEqual([]);
    await expect(transport.copyHistoryTo(new DataStoreTransport({ ...params, storeId: 'other' }))).rejects.toThrow('different store');
    const store = await openDevice(files, { format: 'json', storeId: 'move-json' });
    await store.set('JSON source', 1);
    await store.compact();
    await store.relocate({ folder: 'JSON destination', format: 'json' });
    expect(store.entries()).toEqual([['JSON source', 1]]);
  });

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

  it.each(['.plugin-data', '.config/plugins/test/shared-data'])('persists, synchronizes and reopens a hidden store in %s', async (folder) => {
    const files = new Map<string, string>();
    const local = await openLocal();
    const first = await openDevice(files, { folder, local });
    const second = await openDevice(files, { folder });
    await first.set('key', 'value');
    await second.synchronize();
    expect(second.entries()).toEqual([['key', 'value']]);
    await first.compact();
    const reopened = await openDevice(files, { folder, local });
    const fresh = await openDevice(files, { folder });
    expect(reopened.entries()).toEqual(second.entries());
    expect(fresh.entries()).toEqual(second.entries());
    expect([...files.keys()].every((path) => path.startsWith(`${folder}/test/shared/`))).toBe(true);
  });

  it('holds acknowledgements at gaps and ignores a segment copied partway', async () => {
    const source = new Map<string, string>();
    // A file limit below two operations seals each segment, so the second write opens a second file.
    const writer = await openDevice(source, { maxFileBytes: 256 });
    await writer.set('first', 1);
    await writer.set('second', 2);
    const first = [...source].find(([path]) => path.endsWith('/log-1.md'));
    const second = [...source].find(([path]) => path.endsWith('/log-2.md'));
    if (!first || !second) {
      throw new Error('Expected two log segments');
    }
    const delivered = new Map<string, string>([[first[0], first[1].slice(0, -4)], second]);
    const reader = await openDevice(delivered, { maxFileBytes: 256 });
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

  it('ignores stray files and invalid device folders under devices when trimming', async () => {
    const files = new Map<string, string>();
    const writer = await openDevice(files);
    files.set('Plugin data/test/shared/devices/.DS_Store', 'finder metadata');
    files.set('Plugin data/test/shared/devices/.hidden/have.md', 'partial');
    files.set('Plugin data/test/shared/devices/bad.name/have.md', 'partial');
    await writer.set('key', 'value');
    await writer.compact();
    expect([...files.keys()].some((path) => path.includes('/log-'))).toBe(false);
    expect([...files.keys()].filter((path) => path.endsWith('-manifest.md'))).toHaveLength(1);
    expect(files.has('Plugin data/test/shared/devices/.DS_Store')).toBe(true);
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
    for (
      const folder of [
        '',
        '/',
        '/absolute',
        'a/',
        'a//b',
        '.',
        '..',
        'a/./b',
        'a/../b',
        String.raw`a\b`,
        'C:/data',
        'C:data',
        'a<b',
        'a>b',
        'a"b',
        'a|b',
        'a?b',
        'a*b',
        'a\0b',
        'a\nb',
        'a.',
        'a '
      ]
    ) {
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

  it.each(['.plugin-data', '.config/plugins/test/shared-data'])('contains all adapter reads, writes and removals within %s', async (folder) => {
    const files = new Map<string, string>();
    const adapter = createAdapter(files);
    const transport = new DataStoreTransport({ adapter, folder, pluginId: 'test', storeId: 'shared' });
    const path = `${transport.root}/.nested/value.md`;
    await transport.write(path, { value: 1 });
    expect(await transport.read(path)).toEqual({ value: 1 });
    expect(await transport.list()).toEqual([path]);
    for (
      const invalid of [
        'outside/file.md',
        `${transport.root}-sibling/file.md`,
        transport.root,
        `${transport.root}/../file.md`,
        `${transport.root}/./file.md`,
        `${transport.root}//file.md`,
        `${transport.root}/`,
        String.raw`${transport.root}/a\b.md`,
        `${transport.root}/C:file.md`,
        `${transport.root}/a?b.md`,
        `${transport.root}/a\0b.md`,
        `${transport.root}/a.`
      ]
    ) {
      await expect(transport.write(invalid, true)).rejects.toThrow('path');
      await expect(transport.read(invalid)).rejects.toThrow('path');
      await expect(transport.remove(invalid)).rejects.toThrow('path');
    }
    expect([...files.keys()]).toEqual([path]);
    await transport.remove(path);
    expect(await transport.list()).toEqual([]);
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
