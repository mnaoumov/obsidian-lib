import type {
  Notice,
  Plugin
} from 'obsidian';

import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  SettingsRecoveryCopy,
  SettingsRecoveryStore,
  SettingsRecoveryStoreKeepParams
} from './settings-recovery.ts';

import { PluginNoticeComponent } from './components/plugin-notice-component.ts';
import {
  DEFAULT_PLUGIN_DATA_MAX_SIZE_IN_BYTES,
  PluginDataHandler,
  PluginDataOperation,
  PluginDataParseError,
  PluginDataSizeLimitExceededError
} from './data-handler.ts';
import {
  LocalSettingsRecoveryStore,
  SettingsRecoveryReason
} from './settings-recovery.ts';

interface FakePluginParams {
  readonly fileSize?: null | number;
  readonly fileText?: null | string;
  readonly loadedData?: unknown;
  readonly manifestFolder?: string | undefined;
  readonly statError?: Error;
}

interface FakePluginResult {
  readonly plugin: Plugin;
  readonly stat: ReturnType<typeof vi.fn>;
  readonly written: unknown[];
}

class MemoryRecoveryStore implements SettingsRecoveryStore {
  public readonly copies: SettingsRecoveryCopy[] = [];
  public keepError: Error | null = null;

  public keep(params: SettingsRecoveryStoreKeepParams): Promise<SettingsRecoveryCopy> {
    if (this.keepError) {
      return Promise.reject(this.keepError);
    }
    const copy = { ...params, id: String(this.copies.length), keptAt: this.copies.length };
    this.copies.push(copy);
    return Promise.resolve(copy);
  }

  public list(): Promise<SettingsRecoveryCopy[]> {
    return Promise.resolve([...this.copies].reverse());
  }

  public remove(): Promise<void> {
    return noopAsync();
  }
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
  const fileText = params.fileText ?? null;
  const plugin = castTo<Plugin>({
    app: {
      appId: 'vault-id',
      vault: {
        adapter: {
          exists: vi.fn(() => Promise.resolve(fileText !== null)),
          read: vi.fn(() => fileText === null ? Promise.reject(new Error('ENOENT')) : Promise.resolve(fileText)),
          stat
        }
      }
    },
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

  describe('unparseable data.json', () => {
    class QuietPluginDataHandler extends PluginDataHandler {
      public readonly reported: PluginDataParseError[] = [];

      protected override reportParseError(error: PluginDataParseError): void {
        this.reported.push(error);
      }
    }

    it('should keep a recovery copy and throw, instead of answering "missing"', async () => {
      const { plugin, written } = createPlugin({ fileSize: 9, fileText: '{"a": 1,', loadedData: undefined });
      const recoveryStore = new MemoryRecoveryStore();
      const handler = new QuietPluginDataHandler(plugin, { recoveryStore });

      const promise = handler.loadData();

      await expect(promise).rejects.toBeInstanceOf(PluginDataParseError);
      await expect(promise).rejects.toThrow(/Foo.*foo.*config-folder\/plugins\/foo\/data\.json.*not valid JSON.*left untouched.*recovery copy was kept/u);
      expect(recoveryStore.copies).toStrictEqual([
        expect.objectContaining({ path: 'config-folder/plugins/foo/data.json', rawText: '{"a": 1,', reason: SettingsRecoveryReason.InvalidJson })
      ]);
      expect(handler.reported).toHaveLength(1);
      expect(handler.reported[0]?.recoveryCopy).toBe(recoveryStore.copies[0]);
      expect(handler.reported[0]?.cause).toBeInstanceOf(SyntaxError);
      expect(written).toStrictEqual([]);
    });

    it('should still throw when no recovery copy can be kept', async () => {
      const { plugin } = createPlugin({ fileSize: 1, fileText: '{', loadedData: undefined });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(noop);
      const recoveryStore = new MemoryRecoveryStore();
      recoveryStore.keepError = new Error('quota');

      const promise = new QuietPluginDataHandler(plugin, { recoveryStore }).loadData();

      await expect(promise).rejects.toMatchObject({ name: 'PluginDataParseError', recoveryCopy: null });
      await expect(promise).rejects.toThrow(/No recovery copy could be kept/u);
      expect(consoleError).toHaveBeenCalledOnce();
    });

    it('should keep no copy when the handler keeps none', async () => {
      const { plugin } = createPlugin({ fileSize: 1, fileText: '{', loadedData: undefined });
      const handler = new QuietPluginDataHandler(plugin, { recoveryStore: null });

      await expect(handler.loadData()).rejects.toMatchObject({ recoveryCopy: null });
      expect(handler.recoveryStore).toBeNull();
    });

    it('should parse the file itself when Obsidian answers null for a file that parses', async () => {
      const { plugin } = createPlugin({ fileSize: 8, fileText: '{"a": 1}', loadedData: null });
      await expect(new PluginDataHandler(plugin).loadData()).resolves.toStrictEqual({ a: 1 });
    });

    it('should answer as Obsidian did when the file cannot be read', async () => {
      const { plugin } = createPlugin({ loadedData: undefined });
      vi.mocked(plugin.app.vault.adapter.exists).mockRejectedValue(new Error('EACCES'));
      await expect(new PluginDataHandler(plugin).loadData()).resolves.toBeUndefined();
    });

    it('should answer as Obsidian did when the manifest has no folder', async () => {
      const { plugin } = createPlugin({ fileText: '{', loadedData: undefined, manifestFolder: undefined });
      await expect(new PluginDataHandler(plugin).loadData()).resolves.toBeUndefined();
    });

    it('should default to a device-local recovery store', () => {
      const { plugin } = createPlugin();
      expect(new PluginDataHandler(plugin).recoveryStore).toBeInstanceOf(LocalSettingsRecoveryStore);
    });

    it('should report the failure in a notice and the console', () => {
      const { plugin } = createPlugin();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(noop);
      const showNotice = vi.spyOn(PluginNoticeComponent.prototype, 'showNotice').mockImplementation(() => castTo<Notice>({}));

      class ReportingPluginDataHandler extends PluginDataHandler {
        public report(error: PluginDataParseError): void {
          this.reportParseError(error);
        }
      }

      const handler = new ReportingPluginDataHandler(plugin, { recoveryStore: null });
      const params = { cause: new SyntaxError('x'), path: 'p/data.json', pluginId: 'foo', pluginName: 'Foo' };
      handler.report(new PluginDataParseError({ ...params, recoveryCopy: null }));
      handler.report(
        new PluginDataParseError({
          ...params,
          recoveryCopy: { id: 'c', keptAt: 0, path: 'p/data.json', rawText: '{', reason: SettingsRecoveryReason.InvalidJson }
        })
      );

      expect(consoleError).toHaveBeenCalledTimes(2);
      expect(showNotice).toHaveBeenNthCalledWith(1, expect.stringMatching(/p\/data\.json.*left untouched\.$/u));
      expect(showNotice).toHaveBeenNthCalledWith(2, expect.stringMatching(/p\/data\.json.*copy of it was kept on this device/u));
    });
  });
});
