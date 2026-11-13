/**
 * @file
 * Checks virtual files against Obsidian's real resolver, adapter and Markdown editor.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('registerVirtualFile', () => {
  it('keeps mode switches read-only and allows editing after the leaf opens a real note', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { registerVirtualFile, typeIntoEditor }, obsidianModule: { MarkdownView } }) {
        const registration = await registerVirtualFile({ app, content: 'Immutable', path: 'virtual-file-modes.md' });
        const real = await app.vault.create('virtual-file-real-note.md', 'Real');
        const leaf = app.workspace.getLeaf('tab');
        try {
          await leaf.openFile(registration.file);
          await leaf.setViewState({ state: { file: registration.file.path, mode: 'preview' }, type: 'markdown' });
          await leaf.setViewState({ state: { file: registration.file.path, mode: 'source' }, type: 'markdown' });
          if (!(leaf.view instanceof MarkdownView)) {
            throw new TypeError('Expected a Markdown view');
          }
          await typeIntoEditor({ editor: leaf.view.editor, text: 'Rejected' });
          const virtualContent = leaf.view.getViewData();
          await leaf.openFile(real);
          if (!(leaf.view instanceof MarkdownView)) {
            throw new TypeError('Expected a Markdown view');
          }
          await typeIntoEditor({ editor: leaf.view.editor, text: 'Allowed' });
          return { realContent: leaf.view.getViewData(), virtualContent };
        } finally {
          leaf.detach();
          registration.dispose();
          await app.fileManager.trashFile(real);
        }
      }
    });
    expect(result.virtualContent).toBe('Immutable');
    expect(result.realContent).toContain('Allowed');
  });

  it('resolves and opens memory content read-only without creating a disk file, then disposes it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { registerVirtualFile }, obsidianModule: { MarkdownView } }) {
        const path = 'virtual-file-integration.md';
        const content = '# Memory only\n\nA virtual note.';
        const registration = await registerVirtualFile({ app, content, path });
        const leaf = app.workspace.getLeaf('tab');
        try {
          const resolved = app.metadataCache.getFirstLinkpathDest('virtual-file-integration', '');
          await leaf.openFile(registration.file);
          const view = leaf.view;
          const isOpened = view instanceof MarkdownView && view.getViewData() === content;
          if (view instanceof MarkdownView) {
            view.editor.replaceRange('Rejected', { ch: 0, line: 0 });
          }
          const isUnchanged = view instanceof MarkdownView && view.getViewData() === content;
          const rejected: string[] = [];
          for (
            const [name, operation] of [
              ['modify', (): Promise<void> => app.vault.modify(registration.file, 'Wrong')],
              ['rename', (): Promise<void> => app.fileManager.renameFile(registration.file, 'wrong.md')],
              // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file -- This test exercises the deletion primitive itself.
              ['delete', (): Promise<void> => app.vault.delete(registration.file)],
              ['adapter write', (): Promise<void> => app.vault.adapter.write(path, 'Wrong')]
            ] as const
          ) {
            try {
              await operation();
            } catch {
              rejected.push(name);
            }
          }
          const response = await window.fetch(app.vault.getResourcePath(registration.file));
          const observations = {
            adapterRead: await app.vault.adapter.read(path),
            cachedRead: await app.vault.cachedRead(registration.file),
            diskExists: await app.vault.adapter.exists(path),
            metadata: app.metadataCache.getFileCache(registration.file)?.headings?.[0]?.heading,
            opened: isOpened,
            read: await app.vault.read(registration.file),
            rejected,
            resolved: resolved === registration.file,
            resourceContent: await response.text(),
            unchanged: isUnchanged
          };
          registration.dispose();
          return { ...observations, disposed: !app.vault.getAbstractFileByPath(path) && !app.metadataCache.getFirstLinkpathDest('virtual-file-integration', '') };
        } finally {
          registration.dispose();
        }
      }
    });
    expect(result).toEqual({
      adapterRead: '# Memory only\n\nA virtual note.',
      cachedRead: '# Memory only\n\nA virtual note.',
      diskExists: false,
      disposed: true,
      metadata: 'Memory only',
      opened: true,
      read: '# Memory only\n\nA virtual note.',
      rejected: ['modify', 'rename', 'delete', 'adapter write'],
      resolved: true,
      resourceContent: '# Memory only\n\nA virtual note.',
      unchanged: true
    });
  });
});
