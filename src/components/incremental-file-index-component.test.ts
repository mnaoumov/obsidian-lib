import type {
  App as AppOriginal,
  TFile
} from 'obsidian';

import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { assertNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IndexedFileRecord } from './incremental-file-index-component.ts';

import { IncrementalFileIndexComponent } from './incremental-file-index-component.ts';

let app: AppOriginal;
let component: IncrementalFileIndexComponent<string>;
let saved: Map<string, IndexedFileRecord<string>>;
let secondary: Map<string, string>;
let load: ReturnType<typeof vi.fn<() => Promise<ReadonlyMap<string, IndexedFileRecord<string>>>>>;
let save: ReturnType<typeof vi.fn<(records: ReadonlyMap<string, IndexedFileRecord<string>>) => Promise<void>>>;

beforeEach(() => {
  vi.useFakeTimers();
  app = App.createConfigured__({ files: { 'folder/a.md': 'alpha', 'folder/b.md': 'beta', 'ignored.txt': 'skip' } }).asOriginalType__();
  saved = new Map();
  secondary = new Map();
  load = vi.fn(() => Promise.resolve(saved));
  save = vi.fn((records) => {
    saved = new Map(records);
    return noopAsync();
  });
  component = new IncrementalFileIndexComponent({
    accepts: (candidate): boolean => candidate.extension === 'md',
    app,
    indexFile: ({ content }): string => content.toUpperCase(),
    load,
    onRemove: (path): void => {
      secondary.delete(path);
    },
    onSet: (path, record): void => {
      secondary.set(path, record);
    },
    save
  });
});

afterEach(async () => {
  component.unload();
  await component.flush();
  vi.useRealTimers();
});

function file(path = 'folder/a.md'): TFile {
  const result = app.vault.getFileByPath(path);
  assertNonNullable(result);
  return result;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await noopAsync();
  }
}

describe('IncrementalFileIndexComponent', () => {
  it('should not resurrect a saved file deleted while another startup read is pending', async () => {
    const b = file('folder/b.md');
    saved.set(b.path, { mtime: b.stat.mtime, record: 'OLD', size: b.stat.size });
    const pending = createPending<string>();
    vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(pending.promise);
    const loading = component.loadWithPromises();
    await settle();
    // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file -- Exercise the vault delete event.
    await app.vault.delete(b);
    pending.resolve('alpha');
    await loading;
    expect(component.getRecords().has(b.path)).toBe(false);
    expect(secondary.has(b.path)).toBe(false);
  });

  it('should leave a failed startup incomplete without replacing the saved cache', async () => {
    vi.spyOn(app.vault, 'cachedRead').mockRejectedValueOnce(new Error('read failed'));
    await expect(component.loadWithPromises()).rejects.toThrow('read failed');
    expect(component.isBuilt).toBe(false);
    await component.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('should invalidate pending projections and explicitly rebuild projections for unchanged files', async () => {
    await component.loadWithPromises();
    app.metadataCache.trigger('changed', file(), 'temporary', {});
    expect(secondary.get('folder/a.md')).toBe('TEMPORARY');
    const pending = createPending<string>();
    vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(pending.promise);
    const scan = component.rescan();
    expect(secondary.has('folder/a.md')).toBe(false);
    pending.resolve('refreshed');
    await scan;
    expect(secondary.get('folder/a.md')).toBe('REFRESHED');
    expect(secondary.get('folder/b.md')).toBe('BETA');
    component.unload();
    await component.rescan();
    expect(secondary.get('folder/a.md')).toBe('REFRESHED');
  });

  it('should serialize event reads and skip superseded queued work', async () => {
    await component.loadWithPromises();
    const pending = createPending<string>();
    const read = vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(pending.promise);
    app.vault.trigger('modify', file());
    await settle();
    const b = file('folder/b.md');
    app.vault.trigger('modify', b);
    app.vault.trigger('modify', b);
    expect(read).toHaveBeenCalledTimes(1);
    pending.resolve('new');
    await vi.waitFor(() => {
      expect(secondary.get('folder/a.md')).toBe('NEW');
      expect(read).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(secondary.get(b.path)).toBe('BETA');
  });

  it('should build accepted files, debounce saves and return independent map snapshots', async () => {
    expect(component.isBuilt).toBe(false);
    await component.flush();
    expect(save).not.toHaveBeenCalled();
    await component.loadWithPromises();
    expect(component.isBuilt).toBe(true);
    expect(secondary).toEqual(new Map([['folder/a.md', 'ALPHA'], ['folder/b.md', 'BETA']]));
    const snapshot = component.getRecords();
    expect(snapshot.size).toBe(2);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    app.metadataCache.trigger('changed', file(), 'new', {});
    expect(snapshot.get('folder/a.md')?.record).toBe('ALPHA');
    expect(secondary.get('folder/a.md')).toBe('NEW');
    await component.flush();
    expect(saved.get('folder/a.md')?.record).toBe('NEW');
    await component.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('should restore matching stats and discard deleted or changed saved entries', async () => {
    const a = file();
    saved.set(a.path, { mtime: a.stat.mtime, record: 'RESTORED', size: a.stat.size });
    saved.set('folder/b.md', { mtime: -1, record: 'STALE', size: -1 });
    saved.set('deleted.md', { mtime: 0, record: 'DELETED', size: 0 });
    const read = vi.spyOn(app.vault, 'cachedRead');
    await component.loadWithPromises();
    expect(read).toHaveBeenCalledTimes(1);
    expect(secondary.get(a.path)).toBe('RESTORED');
    expect(secondary.get('folder/b.md')).toBe('BETA');
    await component.flush();
    expect(saved.has('deleted.md')).toBe(false);
  });

  it('should reject saved data whose size changed even when mtime matches', async () => {
    const a = file();
    saved.set(a.path, { mtime: a.stat.mtime, record: 'STALE', size: -1 });
    await component.loadWithPromises();
    expect(secondary.get(a.path)).toBe('ALPHA');
  });

  it('should process create and modify events and ignore folders and rejected files', async () => {
    await component.loadWithPromises();
    await app.vault.createFolder('empty');
    const created = await app.vault.create('new.md', 'created');
    await settle();
    expect(secondary.get(created.path)).toBe('CREATED');
    await app.vault.modify(created, 'modified');
    await settle();
    expect(secondary.get(created.path)).toBe('MODIFIED');
    const ignored = await app.vault.create('new.txt', 'ignored');
    app.metadataCache.trigger('changed', ignored, 'ignored', {});
    await settle();
    expect(component.getRecords().has(ignored.path)).toBe(false);
  });

  it('should remove a folder subtree without removing paths that merely share its prefix', async () => {
    await component.loadWithPromises();
    await app.vault.create('folder-extra.md', 'keep');
    await settle();
    const folder = app.vault.getFolderByPath('folder');
    assertNonNullable(folder);
    app.vault.trigger('delete', folder);
    expect([...secondary.keys()]).toEqual(['folder-extra.md']);
    app.vault.trigger('delete', file());
    expect([...secondary.keys()]).toEqual(['folder-extra.md']);
  });

  it('should reindex renamed files and folders idempotently', async () => {
    await component.loadWithPromises();
    const a = file();
    await app.vault.rename(a, 'folder/renamed.md');
    await settle();
    expect(secondary.has('folder/a.md')).toBe(false);
    expect(secondary.get(a.path)).toBe('ALPHA');
    const folder = app.vault.getFolderByPath('folder');
    assertNonNullable(folder);
    await app.vault.rename(folder, 'moved');
    await settle();
    expect(secondary).toEqual(new Map([['moved/b.md', 'BETA'], ['moved/renamed.md', 'ALPHA']]));
  });

  it('should let metadata changes during restore win over saved entries', async () => {
    const pending = createPending<ReadonlyMap<string, IndexedFileRecord<string>>>();
    load.mockReturnValue(pending.promise);
    const loading = component.loadWithPromises();
    const a = file();
    saved.set(a.path, { mtime: a.stat.mtime, record: 'OLD', size: a.stat.size });
    app.metadataCache.trigger('changed', a, 'latest', {});
    pending.resolve(saved);
    await loading;
    expect(secondary.get(a.path)).toBe('LATEST');
  });

  it('should discard an older text read when a newer metadata event arrives', async () => {
    const pending = createPending<string>();
    vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(pending.promise);
    const loading = component.loadWithPromises();
    await settle();
    app.metadataCache.trigger('changed', file(), 'latest', {});
    pending.resolve('obsolete');
    await loading;
    expect(secondary.get('folder/a.md')).toBe('LATEST');
  });

  it.each(['mtime', 'size', 'path', 'delete'] as const)('should discard a read whose %s changes while awaiting text', async (change) => {
    const a = file();
    const fileB = file('folder/b.md');
    const pending = createPending<string>();
    vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(pending.promise);
    const loading = component.loadWithPromises();
    await settle();
    if (change === 'mtime' || change === 'size') {
      a.stat[change]++;
    } else if (change === 'path') {
      a.path = 'elsewhere.md';
    } else {
      // Simulate a delete notification arriving after the file leaves the vault tree.
      vi.spyOn(app.vault, 'getFileByPath').mockImplementation((path) => path === a.path ? null : fileB);
    }
    pending.resolve('obsolete');
    await loading;
    expect(secondary.has('folder/a.md')).toBe(false);
  });

  it('should abandon loading and pending text reads on unload', async () => {
    const pending = createPending<string>();
    vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(pending.promise);
    const loading = component.loadWithPromises();
    await settle();
    component.unload();
    pending.resolve('obsolete');
    await loading;
    expect(component.isBuilt).toBe(false);
    expect(component.getRecords().size).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  it('should not complete an empty build unloaded while reading the saved cache', async () => {
    const pending = createPending<ReadonlyMap<string, IndexedFileRecord<string>>>();
    load.mockReturnValue(pending.promise);
    vi.spyOn(app.vault, 'getFiles').mockReturnValue([]);
    const loading = component.loadWithPromises();
    component.unload();
    pending.resolve(saved);
    await loading;
    expect(component.isBuilt).toBe(false);
  });

  it('should serialize saves and include edits that arrive during a write', async () => {
    await component.loadWithPromises();
    const pending = createPending<undefined>();
    save.mockImplementationOnce(async () => {
      await pending.promise;
    });
    const first = component.flush();
    app.metadataCache.trigger('changed', file(), 'latest', {});
    const second = component.flush();
    expect(save).toHaveBeenCalledTimes(1);
    pending.resolve(undefined);
    await Promise.all([first, second]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saved.get('folder/a.md')?.record).toBe('LATEST');
  });

  it('should retry a failed save without marking its revision saved', async () => {
    await component.loadWithPromises();
    save.mockRejectedValueOnce(new Error('disk full'));
    await expect(component.flush()).rejects.toThrow('disk full');
    await component.flush();
    expect(saved.size).toBe(2);
  });

  it('should flush built records once more on unload and unregister listeners', async () => {
    await component.loadWithPromises();
    component.unload();
    await component.flush();
    expect(saved.size).toBe(2);
    app.metadataCache.trigger('changed', file(), 'obsolete', {});
    expect(secondary.get('folder/a.md')).toBe('ALPHA');
    expect(vi.getTimerCount()).toBe(0);
  });
});

interface Pending<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createPending<T>(): Pending<T> {
  let resolve: (value: T) => void = noop;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
