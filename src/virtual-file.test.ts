// @vitest-environment jsdom

import type {
  App as AppOriginal,
  MarkdownView as MarkdownViewOriginal,
  TFile as TFileOriginal
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { CustomArrayDictImpl } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  App,
  MarkdownView,
  WorkspaceLeaf
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { toggleEditorReadOnly } from './editor.ts';
import { parseMetadata } from './metadata-cache.ts';
import { registerVirtualFile } from './virtual-file.ts';

interface CapturedDispatch {
  readonly effects: CapturedEffect;
}

interface CapturedEffect {
  readonly value: CapturedExtension;
}

interface CapturedExtension {
  readonly value: () => boolean;
}

function setViewFile(view: MarkdownViewOriginal, file: null | TFileOriginal): void {
  view.file = file;
}

vi.mock('./editor.ts', () => ({ toggleEditorReadOnly: vi.fn() }));
vi.mock('./metadata-cache.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./metadata-cache.ts')>(),
  parseMetadata: vi.fn(() => Promise.resolve({ features: [] }))
}));

let app: AppOriginal;
let mockApp: App;
const disposables: Disposable[] = [];

beforeEach(() => {
  mockApp = App.createConfigured__({ files: { 'folder/note.md': 'Real', 'real.md': 'Real' } });
  app = mockApp.asOriginalType__();
  app.metadataCache.uniqueFileLookup = new CustomArrayDictImpl<TFileOriginal>();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:virtual');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const disposable of disposables.splice(0).reverse()) {
    disposable[Symbol.dispose]();
  }
  vi.restoreAllMocks();
});

async function register(path = 'memory.md'): Promise<Awaited<ReturnType<typeof registerVirtualFile>>> {
  const result = await registerVirtualFile({ app, content: 'Memory 😀', path });
  disposables.push(result);
  return result;
}

describe('registerVirtualFile', () => {
  it('serves immutable UTF-8 content and resource URLs and removes its registrations idempotently', async () => {
    const registration = await register();
    const { file } = registration;
    expect(registration.content).toBe('Memory 😀');
    expect(file.stat.size).toBe(new TextEncoder().encode(registration.content).byteLength);
    expect(app.vault.getFileByPath(file.path)).toBe(file);
    expect(await app.vault.read(file)).toBe(registration.content);
    expect(await app.vault.cachedRead(file)).toBe(registration.content);
    expect(await app.vault.adapter.read('MEMORY.md')).toBe(registration.content);
    expect(new TextDecoder().decode(await app.vault.readBinary(file))).toBe(registration.content);
    expect(new TextDecoder().decode(await app.vault.adapter.readBinary(file.path))).toBe(registration.content);
    expect(app.vault.getResourcePath(file)).toBe('blob:virtual');
    expect(app.vault.adapter.getResourcePath(file.path)).toBe('blob:virtual');
    expect(app.metadataCache.fileCache[file.path]).toBeDefined();
    registration[Symbol.dispose]();
    registration[Symbol.dispose]();
    expect(app.vault.getFileByPath(file.path)).toBeNull();
    expect(app.metadataCache.fileCache[file.path]).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:virtual');
    const replacement = await register();
    expect(replacement.file).not.toBe(file);
  });

  it.each(['', '/', '/absolute.md', '../escape.md', 'folder/./note.md', 'folder/../escape.md'])(
    'rejects invalid path %s',
    async (path) => {
      await expect(register(path)).rejects.toThrow('vault-relative');
    }
  );

  it('rejects real files, absent parents, disk-only files and concurrent registrations', async () => {
    await expect(register('REAL.md')).rejects.toThrow('already exists');
    await expect(register('missing/memory.md')).rejects.toThrow('Parent folder');
    vi.spyOn(app.vault.adapter, 'exists').mockResolvedValueOnce(true);
    await expect(register()).rejects.toThrow('already exists');
    const first = register();
    await expect(register('MEMORY.md')).rejects.toThrow('already exists');
    await first;
    await expect(register()).rejects.toThrow('already exists');
  });

  it('rechecks collisions after metadata parsing and releases failed reservations', async () => {
    vi.mocked(parseMetadata).mockImplementationOnce(async () => {
      await app.vault.create('memory.md', 'Arrived while parsing');
      return { features: [] };
    });
    await expect(register()).rejects.toThrow('already exists');
    expect(await app.vault.read(castTo<TFileOriginal>(app.vault.getFileByPath('memory.md')))).toBe('Arrived while parsing');
    await app.fileManager.trashFile(castTo<TFileOriginal>(app.vault.getFileByPath('memory.md')));
    const replacement = await register();
    expect(replacement.file.path).toBe('memory.md');
  });

  it('supports other text extensions without Markdown parsing and preserves replacement files on disposal', async () => {
    vi.mocked(parseMetadata).mockClear();
    const registration = await register('folder/manual.txt');
    expect(parseMetadata).not.toHaveBeenCalled();
    const replacement = castTo<TFileOriginal>({ path: registration.file.path });
    app.vault.fileMap[registration.file.path] = replacement;
    registration[Symbol.dispose]();
    expect(app.vault.fileMap[replacement.path]).toBe(replacement);
  });

  it('blocks every vault mutation and ancestor mutations while forwarding unrelated calls', async () => {
    const { vault } = app;
    const { file } = await register('folder/memory.md');
    const real = castTo<TFileOriginal>(app.vault.getFileByPath('real.md'));
    for (const method of ['append', 'appendBinary', 'modify', 'modifyBinary', 'process', 'delete', 'trash'] as const) {
      expect(() => Reflect.apply(castTo<(...arguments_: unknown[]) => unknown>(vault[method]), vault, [file, 'Wrong'])).toThrow('read-only');
    }
    for (const method of ['create', 'createBinary', 'createFolder'] as const) {
      expect(() => Reflect.apply(castTo<(...arguments_: unknown[]) => unknown>(vault[method]), vault, [file.path, 'Wrong'])).toThrow('read-only');
    }
    expect(() => app.vault.rename(file, 'other.md')).toThrow('read-only');
    expect(() => app.vault.rename(real, file.path)).toThrow('read-only');
    expect(() => app.vault.rename(castTo<TFileOriginal>({ path: 'folder' }), 'other')).toThrow('read-only');
    expect(() => app.vault.copy(real, file.path)).toThrow('read-only');
    expect(() => app.fileManager.renameFile(file, 'other.md')).toThrow('read-only');
    expect(() => app.fileManager.renameFile(real, file.path)).toThrow('read-only');
    expect(() => app.fileManager.trashFile(file)).toThrow('read-only');
    await app.vault.modify(real, 'Updated');
    expect(await app.vault.read(real)).toBe('Updated');
  });

  it('blocks adapter mutations and forwards reads and mutations for other paths', async () => {
    const { adapter } = app.vault;
    const { file } = await register('folder/memory.md');
    for (const method of ['write', 'writeBinary', 'append', 'appendBinary', 'process', 'remove', 'rmdir', 'trashLocal', 'trashSystem', 'mkdir'] as const) {
      expect(() => Reflect.apply(castTo<(...arguments_: unknown[]) => unknown>(adapter[method]), adapter, [file.path, 'Wrong'])).toThrow('read-only');
    }
    expect(() => app.vault.adapter.rename(file.path, 'other.md')).toThrow('read-only');
    expect(() => app.vault.adapter.rename('real.md', file.path)).toThrow('read-only');
    expect(() => app.vault.adapter.copy('real.md', file.path)).toThrow('read-only');
    expect(() => app.vault.adapter.remove('/')).toThrow('read-only');
    expect(await app.vault.adapter.read('real.md')).toBe('Real');
    await app.vault.adapter.write('other.md', 'Other');
    expect(await app.vault.adapter.read('other.md')).toBe('Other');
  });

  it('locks Markdown editors after loading and rebuilding them and closes owned leaves', async () => {
    const leaf = WorkspaceLeaf.create2__(mockApp);
    const view = MarkdownView.create2__(leaf).asOriginalType7__();
    const prototype = castTo<MarkdownViewOriginal>(Object.getPrototypeOf(view));
    vi.spyOn(prototype, 'onLoadFile').mockResolvedValue(undefined);
    Object.defineProperty(prototype, 'setMode', { configurable: true, value: vi.fn(() => Promise.resolve(true)), writable: true });
    disposables.push({
      [Symbol.dispose]: (): void => {
        Reflect.deleteProperty(prototype, 'setMode');
      }
    });
    const { file } = await register();
    const dispatch = vi.spyOn(view.editor.cm, 'dispatch');
    view.file = file;
    vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((callback) => {
      callback(castTo<typeof view.leaf>({ detach: vi.fn(), view }));
      callback(castTo<typeof view.leaf>({ view: {} }));
    });
    view.setViewData('Memory', true);
    expect(toggleEditorReadOnly).toHaveBeenCalledWith(view.editor, true);
    const effect = castTo<CapturedDispatch>(dispatch.mock.calls.at(-1)?.[0]);
    expect(effect.effects.value.value()).toBe(false);
    await view.onLoadFile(file);
    const checkSwitchMode = castTo<(mode: Parameters<typeof view.setMode>[0]) => Promise<boolean>>(view.setMode.bind(view));
    expect(await checkSwitchMode(castTo<Parameters<typeof view.setMode>[0]>({}))).toBe(true);
    setViewFile(view, null);
    expect(effect.effects.value.value()).toBe(true);
    view.setViewData('Real', true);
    await view.onLoadFile(file);
    await view.setMode(castTo<Parameters<typeof view.setMode>[0]>({}));
    setViewFile(view, file);
  });

  it('forwards every intercepted operation outside the virtual path', async () => {
    const vaultMethods = ['read', 'cachedRead', 'readBinary', 'getResourcePath', 'append', 'appendBinary', 'modify', 'modifyBinary', 'process', 'delete', 'trash', 'rename', 'create', 'createBinary', 'createFolder', 'copy'] as const;
    const adapterMethods = ['read', 'readBinary', 'getResourcePath', 'write', 'writeBinary', 'append', 'appendBinary', 'process', 'remove', 'rmdir', 'trashLocal', 'trashSystem', 'mkdir', 'rename', 'copy'] as const;
    const vaultSpies = vaultMethods.map((name) => vi.spyOn(app.vault, name).mockImplementation(vi.fn()));
    const adapterSpies = adapterMethods.map((name) => vi.spyOn(app.vault.adapter, name).mockImplementation(vi.fn()));
    const managerSpies = [
      vi.spyOn(app.fileManager, 'renameFile').mockImplementation(vi.fn()),
      vi.spyOn(app.fileManager, 'trashFile').mockImplementation(vi.fn())
    ];
    await register();
    for (const method of vaultMethods) {
      if (method !== 'create' && method !== 'createBinary' && method !== 'createFolder') {
        await Reflect.apply(castTo<(...arguments_: unknown[]) => unknown>(app.vault[method]), app.vault, [castTo<TFileOriginal>({ path: 'real.md' }), 'other.md']);
      }
    }
    // Creation methods receive paths rather than files.
    for (const method of ['create', 'createBinary', 'createFolder'] as const) {
      await Reflect.apply(castTo<(...arguments_: unknown[]) => unknown>(app.vault[method]), app.vault, ['other.md', 'Other']);
    }
    for (const method of adapterMethods) {
      await Reflect.apply(castTo<(...arguments_: unknown[]) => unknown>(app.vault.adapter[method]), app.vault.adapter, ['real.md', 'other.md']);
    }
    await app.fileManager.renameFile(castTo<TFileOriginal>({ path: 'real.md' }), 'other.md');
    await app.fileManager.trashFile(castTo<TFileOriginal>({ path: 'real.md' }));
    for (const spy of [...vaultSpies, ...adapterSpies, ...managerSpies]) {
      expect(spy).toHaveBeenCalled();
    }
  });
});
