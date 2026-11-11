import type { Plugin } from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  DEFAULT_PLUGIN_DATA_MAX_SIZE_IN_BYTES,
  PluginDataHandler,
  PluginDataOperation,
  PluginDataSizeLimitExceededError
} from './data-handler.ts';

interface FakePluginParams {
  readonly fileSize?: null | number;
  readonly loadedData?: unknown;
  readonly manifestFolder?: string | undefined;
  readonly statError?: Error;
}

interface FakePluginResult {
  readonly plugin: Plugin;
  readonly stat: ReturnType<typeof vi.fn>;
  readonly written: unknown[];
}

function createPlugin(params: FakePluginParams = {}): FakePluginResult {
  const written: unknown[] = [];
  const stat = vi.fn((): Promise<unknown> => {
    if (params.statError) {
      return Promise.reject(params.statError);
    }
    const fileSize = params.fileSize ?? null;
    return Promise.resolve(fileSize === null ? null : { ctime: 0, mtime: 0, size: fileSize, type: 'file' });
  });
  const plugin = castTo<Plugin>({
    app: { vault: { adapter: { stat } } },
    loadData: vi.fn(() => Promise.resolve(params.loadedData)),
    manifest: {
      // eslint-disable-next-line unicorn/name-replacements -- dir is the name Obsidian's PluginManifest declares.
      dir: 'manifestFolder' in params ? params.manifestFolder : 'config-folder/plugins/foo',
      id: 'foo',
      name: 'Foo'
    },
    saveData: vi.fn((data: unknown) => {
      written.push(data);
      return noopAsync();
    })
  });
  return { plugin, stat, written };
}

function serializedSize(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data, undefined, 2)).byteLength;
}

describe('PluginDataHandler', () => {
  it('should delegate loadData to plugin', async () => {
    const mockData = { foo: 'bar' };
    const { plugin, stat } = createPlugin({ fileSize: 20, loadedData: mockData });

    const result = await new PluginDataHandler(plugin).loadData();

    expect(stat).toHaveBeenCalledWith('config-folder/plugins/foo/data.json');
    expect(plugin.loadData).toHaveBeenCalled();
    expect(result).toBe(mockData);
  });

  it('should delegate saveData to plugin', async () => {
    const { plugin } = createPlugin();
    const data = { count: 42 };

    await new PluginDataHandler(plugin).saveData(data);

    expect(plugin.saveData).toHaveBeenCalledWith(data);
  });

  it('should default to 16 MiB', () => {
    expect(DEFAULT_PLUGIN_DATA_MAX_SIZE_IN_BYTES).toBe(16_777_216);
  });

  it('should reject a negative or NaN limit', () => {
    const { plugin } = createPlugin();
    expect(() => new PluginDataHandler(plugin, { maxSizeInBytes: -1 })).toThrow(RangeError);
    expect(() => new PluginDataHandler(plugin, { maxSizeInBytes: NaN })).toThrow(RangeError);
  });

  describe('loadData', () => {
    it('should load a file exactly at the limit', async () => {
      const { plugin } = createPlugin({ fileSize: 100, loadedData: {} });
      await expect(new PluginDataHandler(plugin, { maxSizeInBytes: 100 }).loadData()).resolves.toStrictEqual({});
    });

    it('should refuse a file one byte over the limit without parsing it', async () => {
      const { plugin } = createPlugin({ fileSize: 101, loadedData: {} });

      const promise = new PluginDataHandler(plugin, { maxSizeInBytes: 100 }).loadData();

      await expect(promise).rejects.toBeInstanceOf(PluginDataSizeLimitExceededError);
      await expect(promise).rejects.toMatchObject({
        maxSizeInBytes: 100,
        operation: PluginDataOperation.Load,
        path: 'config-folder/plugins/foo/data.json',
        pluginId: 'foo',
        pluginName: 'Foo',
        sizeInBytes: 101
      });
      await expect(promise).rejects.toThrow(/Foo.*foo.*101 bytes.*100-byte limit.*left untouched.*LocalDataStore or SharedDataStore/u);
      expect(plugin.loadData).not.toHaveBeenCalled();
    });

    it('should delegate when the file does not exist', async () => {
      const { plugin } = createPlugin({ fileSize: null, loadedData: null });
      await expect(new PluginDataHandler(plugin, { maxSizeInBytes: 0 }).loadData()).resolves.toBeNull();
    });

    it('should delegate when stat fails', async () => {
      const { plugin } = createPlugin({ loadedData: { a: 1 }, statError: new Error('EACCES') });
      await expect(new PluginDataHandler(plugin, { maxSizeInBytes: 0 }).loadData()).resolves.toStrictEqual({ a: 1 });
    });

    it('should delegate when the manifest has no folder', async () => {
      const { plugin, stat } = createPlugin({ loadedData: { a: 1 }, manifestFolder: undefined });
      await expect(new PluginDataHandler(plugin, { maxSizeInBytes: 0 }).loadData()).resolves.toStrictEqual({ a: 1 });
      expect(stat).not.toHaveBeenCalled();
    });

    it('should not stat at all when the guard is disabled', async () => {
      const { plugin, stat } = createPlugin({ fileSize: Number.MAX_SAFE_INTEGER, loadedData: {} });
      await new PluginDataHandler(plugin, { maxSizeInBytes: Infinity }).loadData();
      expect(stat).not.toHaveBeenCalled();
    });
  });

  describe('saveData', () => {
    it('should count Obsidian\'s two-space indentation', async () => {
      const data = { a: 1, b: [1, 2] };
      const indentedSize = serializedSize(data);
      expect(indentedSize).toBeGreaterThan(JSON.stringify(data).length);

      const { plugin: atLimit, written } = createPlugin();
      await new PluginDataHandler(atLimit, { maxSizeInBytes: indentedSize }).saveData(data);
      expect(written).toStrictEqual([data]);

      const { plugin: overLimit } = createPlugin();
      await expect(new PluginDataHandler(overLimit, { maxSizeInBytes: indentedSize - 1 }).saveData(data)).rejects
        .toMatchObject({ operation: PluginDataOperation.Save, sizeInBytes: indentedSize });
      expect(overLimit.saveData).not.toHaveBeenCalled();
    });

    it('should count UTF-8 bytes, not UTF-16 code units', async () => {
      // `é` is 2 bytes, `😀` is 4 bytes and 2 code units: the string length counts both too low.
      const data = { text: 'é😀' };
      const byteSize = serializedSize(data);
      expect(byteSize).toBe(JSON.stringify(data, undefined, 2).length + 3);

      const { plugin } = createPlugin();
      await expect(new PluginDataHandler(plugin, { maxSizeInBytes: byteSize - 1 }).saveData(data)).rejects
        .toThrow(/Nothing was written/u);
      expect(plugin.saveData).not.toHaveBeenCalled();

      const { plugin: fits, written } = createPlugin();
      await new PluginDataHandler(fits, { maxSizeInBytes: byteSize }).saveData(data);
      expect(written).toStrictEqual([data]);
    });

    it('should name a bare data.json when the manifest has no folder', async () => {
      const { plugin } = createPlugin({ manifestFolder: undefined });
      await expect(new PluginDataHandler(plugin, { maxSizeInBytes: 0 }).saveData({ a: 1 })).rejects
        .toMatchObject({ path: 'data.json' });
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it('should throw a serialization failure instead of writing', async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic['self'] = cyclic;
      const { plugin } = createPlugin();

      await expect(new PluginDataHandler(plugin).saveData(cyclic)).rejects.toThrow(TypeError);
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it('should delegate data JSON cannot represent', async () => {
      const { plugin } = createPlugin();
      await new PluginDataHandler(plugin, { maxSizeInBytes: 0 }).saveData(undefined);
      expect(plugin.saveData).toHaveBeenCalledWith(undefined);
    });

    it('should not serialize when the guard is disabled', async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic['self'] = cyclic;
      const { plugin } = createPlugin();
      await new PluginDataHandler(plugin, { maxSizeInBytes: Infinity }).saveData(cyclic);
      expect(plugin.saveData).toHaveBeenCalledWith(cyclic);
    });
  });
});
