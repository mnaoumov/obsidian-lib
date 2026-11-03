/**
 * @file
 * Disposable, read-only files backed by memory instead of the vault adapter.
 */

import type {
  App,
  TFile
} from 'obsidian';

import {
  EditorState,
  StateEffect
} from '@codemirror/state';
import {
  CallbackDisposable,
  MultipleDisposeBehavior
} from '@mnaoumov/typescript-lib/disposable';
import { parentFolderPath } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  MarkdownView,
  normalizePath
} from 'obsidian';

import { MonkeyAroundComponent } from './components/monkey-around-component.ts';
import { toggleEditorReadOnly } from './editor.ts';
import { getFile } from './file-system.ts';
import {
  parseMetadata,
  registerFileCacheForNonExistingFile
} from './metadata-cache.ts';
import { getObsidianLibState } from './obsidian-lib-state.ts';

/**
Parameters for {@link registerVirtualFile}.
 */
export interface RegisterVirtualFileParams {
  /**
  The app whose resolver and read methods serve the file.
   */
  readonly app: App;
  /**
  Immutable UTF-8 text, also available synchronously on the registration.
   */
  readonly content: string;
  /**
  Unoccupied vault-relative file path in an existing folder.
   */
  readonly path: string;
}

/**
A memory file and its lifetime. Dispose it before its owning plugin unloads.
 */
export interface VirtualFile extends Disposable {
  /**
  The immutable text; accessing it requires no asynchronous read.
   */
  readonly content: string;
  /**
  The file accepted by Obsidian's link resolver and file views.
   */
  readonly file: TFile;
}

interface InstallVirtualFileParams extends RegisterVirtualFileParams {
  readonly cache: Awaited<ReturnType<typeof parseMetadata>> | Record<string, never>;
  readonly reservations: Set<string>;
}

/**
 * Registers immutable text as a file without writing to the adapter.
 *
 * The parent folder must exist. Markdown views are read-only; vault and adapter mutations of the
 * path or its ancestors throw. Raw filesystem access and third-party views are outside this contract.
 * Resource URLs use UTF-8 blobs. Disposing closes views of this file and revokes its URL. No create
 * or delete events are emitted, so indexers and synchronization never treat it as a persisted file.
 *
 * @param params - The app, path and immutable text.
 * @returns The registered file, synchronous content and idempotent disposal callback.
 */
export async function registerVirtualFile(params: RegisterVirtualFileParams): Promise<VirtualFile> {
  const { app, content } = params;
  const path = normalizePath(params.path);
  if (!path || path === '/' || params.path.split(/[\\/]/).some((part) => part === '.' || part === '..') || /^[\\/]|:/.test(params.path)) {
    throw new Error('A virtual file requires a vault-relative file path');
  }
  const reservations = getObsidianLibState('virtualFilePathsV1', new Set<string>()).value;
  const key = path.toLowerCase();
  if (reservations.has(key) || app.vault.getAbstractFileByPathInsensitive(path)) {
    throw new Error(`File already exists: ${path}`);
  }
  const parent = parentFolderPath(path);
  if (parent && parent !== '/' && !app.vault.getFolderByPath(parent)) {
    throw new Error(`Parent folder does not exist: ${parent}`);
  }
  reservations.add(key);
  try {
    if (await app.vault.adapter.exists(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    const cache = path.endsWith('.md') ? await parseMetadata(app, content) : {};
    // Recheck after asynchronous work, before publishing anything to the resolver.
    if (app.vault.getAbstractFileByPathInsensitive(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    return installVirtualFile({ app, cache, content, path, reservations });
  } catch (error) {
    reservations.delete(key);
    throw error;
  }
}

function installVirtualFile(params: InstallVirtualFileParams): VirtualFile {
  const { app, cache, content, path, reservations } = params;
  const file = getFile({ app, pathOrFile: path, shouldIncludeNonExisting: true });
  const bytes = new TextEncoder().encode(content);
  file.stat = { ctime: Date.now(), mtime: Date.now(), size: bytes.byteLength };
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- This is the browser's Blob URL API in Obsidian, not Node's implementation.
  const url = window.URL.createObjectURL(new Blob([bytes], { type: path.endsWith('.md') ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const patches = new MonkeyAroundComponent();
  patches.load();
  const metadata = registerFileCacheForNonExistingFile({ app, cache, pathOrFile: file });
  app.vault.fileMap[path] = file;
  app.metadataCache.uniqueFileLookup.add(file.name.toLowerCase(), file);

  patches.registerMethodPatch({ $object: app.vault, methodName: 'read', patchHandler: ({ fallback, originalArguments: [target] }) => target === file ? Promise.resolve(content) : fallback() });
  patches.registerMethodPatch({ $object: app.vault, methodName: 'cachedRead', patchHandler: ({ fallback, originalArguments: [target] }) => target === file ? Promise.resolve(content) : fallback() });
  patches.registerMethodPatch({ $object: app.vault, methodName: 'readBinary', patchHandler: ({ fallback, originalArguments: [target] }) => target === file ? Promise.resolve(new Uint8Array(bytes).buffer) : fallback() });
  patches.registerMethodPatch({ $object: app.vault, methodName: 'getResourcePath', patchHandler: ({ fallback, originalArguments: [target] }) => target === file ? url : fallback() });
  patches.registerMethodPatch({ $object: app.vault.adapter, methodName: 'read', patchHandler: ({ fallback, originalArguments: [target] }) => isMatching(target) ? Promise.resolve(content) : fallback() });
  patches.registerMethodPatch({ $object: app.vault.adapter, methodName: 'readBinary', patchHandler: ({ fallback, originalArguments: [target] }) => isMatching(target) ? Promise.resolve(new Uint8Array(bytes).buffer) : fallback() });
  patches.registerMethodPatch({ $object: app.vault.adapter, methodName: 'getResourcePath', patchHandler: ({ fallback, originalArguments: [target] }) => isMatching(target) ? url : fallback() });

  for (const methodName of ['append', 'appendBinary', 'modify', 'modifyBinary', 'process', 'delete', 'trash'] as const) {
    patches.registerMethodPatch({
      $object: app.vault,
      methodName,
      patchHandler: ({ fallback, originalArguments: [target] }) => {
        assertWritable(target.path);
        return fallback();
      }
    });
  }
  patches.registerMethodPatch({
    $object: app.vault,
    methodName: 'rename',
    patchHandler: ({ fallback, originalArguments: [target, destination] }) => {
      assertWritable(target.path);
      assertWritable(destination);
      return fallback();
    }
  });
  for (const methodName of ['create', 'createBinary', 'createFolder'] as const) {
    patches.registerMethodPatch({
      $object: app.vault,
      methodName,
      patchHandler: ({ fallback, originalArguments: [target] }) => {
        assertWritable(target);
        return fallback();
      }
    });
  }
  patches.registerMethodPatch({
    $object: app.vault,
    methodName: 'copy',
    patchHandler: ({ fallback, originalArguments: [, destination] }) => {
      assertWritable(destination);
      return fallback();
    }
  });
  for (const methodName of ['write', 'writeBinary', 'append', 'appendBinary', 'process', 'remove', 'rmdir', 'trashLocal', 'trashSystem', 'mkdir'] as const) {
    patches.registerMethodPatch({
      $object: app.vault.adapter,
      methodName,
      patchHandler: ({ fallback, originalArguments: [target] }) => {
        assertWritable(target);
        return fallback();
      }
    });
  }
  patches.registerMethodPatch({
    $object: app.vault.adapter,
    methodName: 'rename',
    patchHandler: ({ fallback, originalArguments: [target, destination] }) => {
      assertWritable(target);
      assertWritable(destination);
      return fallback();
    }
  });
  patches.registerMethodPatch({
    $object: app.vault.adapter,
    methodName: 'copy',
    patchHandler: ({ fallback, originalArguments: [, destination] }) => {
      assertWritable(destination);
      return fallback();
    }
  });
  patches.registerMethodPatch({
    $object: app.fileManager,
    methodName: 'renameFile',
    patchHandler: ({ fallback, originalArguments: [target, destination] }) => {
      assertWritable(target.path);
      assertWritable(destination);
      return fallback();
    }
  });
  patches.registerMethodPatch({
    $object: app.fileManager,
    methodName: 'trashFile',
    patchHandler: ({ fallback, originalArguments: [target] }) => {
      assertWritable(target.path);
      return fallback();
    }
  });
  patches.registerMethodPatch({
    $object: MarkdownView.prototype,
    methodName: 'setViewData',
    patchHandler: ({ fallback, originalThis }) => {
      fallback();
      if (originalThis.file === file) {
        protectEditor(originalThis);
      }
    }
  });
  patches.registerMethodPatch({
    $object: MarkdownView.prototype,
    methodName: 'onLoadFile',
    patchHandler: async ({ fallback, originalThis }) => {
      await fallback();
      if (originalThis.file === file) {
        protectEditor(originalThis);
      }
    }
  });
  patches.registerMethodPatch({
    $object: MarkdownView.prototype,
    methodName: 'setMode',
    patchHandler: async ({ fallback, originalThis }) => {
      // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- Obsidian returns a boolean despite its void declaration; setState consumes that result.
      const result = await fallback();
      if (originalThis.file === file) {
        protectEditor(originalThis);
      }
      return result;
    }
  });

  const disposable = new CallbackDisposable({
    callback: (): void => {
      app.workspace.iterateAllLeaves((leaf) => {
        if ('file' in leaf.view && leaf.view.file === file) {
          leaf.detach();
        }
      });
      app.metadataCache.uniqueFileLookup.remove(file.name.toLowerCase(), file);
      if (app.vault.fileMap[path] === file) {
        Reflect.deleteProperty(app.vault.fileMap, path);
        metadata[Symbol.dispose]();
      }
      patches.unload();
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- The URL belongs to the browser realm that created it.
      window.URL.revokeObjectURL(url);
      reservations.delete(path.toLowerCase());
    },
    multipleDisposeBehavior: MultipleDisposeBehavior.Ignore
  });
  return {
    content,
    file,
    [Symbol.dispose]: (): void => {
      disposable[Symbol.dispose]();
    }
  };

  function isMatching(target: string): boolean {
    return normalizePath(target).toLowerCase() === path.toLowerCase();
  }

  function protectEditor(view: MarkdownView): void {
    toggleEditorReadOnly(view.editor, true);
    // A virtual file is immutable even to programmatic editor transactions. The ordinary resource
    // lock permits those for rollback; this registration has no writable buffer to roll back.
    view.editor.cm.dispatch({
      effects: StateEffect.appendConfig.of(EditorState.changeFilter.of(() => view.file !== file))
    });
  }

  function assertWritable(target: string): void {
    const normalized = normalizePath(target).toLowerCase();
    if (isMatching(target) || path.toLowerCase().startsWith(`${normalized}/`) || normalized === '/') {
      throw new Error(`Virtual file is read-only: ${path}`);
    }
  }
}
