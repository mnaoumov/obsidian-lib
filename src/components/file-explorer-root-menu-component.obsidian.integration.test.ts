/**
 * @file
 *
 * Integration tests for {@link FileExplorerRootMenuComponent}, run against a live Obsidian instance.
 *
 * What a mock cannot show is the real File Explorer: that its own empty-area listener reaches the patched
 * `onFileContextMenu`, that the vault name opens the same root menu, that the menu captured from `file-menu` is the one
 * Obsidian shows, and which items Obsidian adds once the root is presented as an ordinary folder.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { Menu } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { FileExplorerRootMenuSpot } from './file-explorer-root-menu-component.ts';

interface RootMenuResult {
  readonly copyPathTitle: string;
  readonly isRootAfter: boolean;
  readonly menuTitles: string[];
  readonly newNoteTitle: string;
  readonly openMenuCount: number;
  readonly spotsByHandler: FileExplorerRootMenuSpot[][];
}

type RootMenuTrigger = 'empty-area' | 'vault-name';

describe('FileExplorerRootMenuComponent', () => {
  it.each<RootMenuTrigger>(['empty-area', 'vault-name'])(
    'should hand the %s menu to every subscriber exactly once, in one menu',
    async (trigger) => {
      const result = await openRootMenu({ shouldPresentRootAsFolder: false, trigger });

      expect(result.spotsByHandler).toEqual([[trigger], [trigger]]);
      expect(result.openMenuCount).toBe(1);
      expect(result.menuTitles).toEqual(expect.arrayContaining(['Root menu item 0', 'Root menu item 1']));
      // Obsidian's own items: `New note` on the root folder menu, `Copy path` on the vault menu.
      expect(result.menuTitles).toContain(trigger === 'empty-area' ? result.newNoteTitle : result.copyPathTitle);
      expect(result.isRootAfter).toBe(true);
    }
  );

  it.each<RootMenuTrigger>(['empty-area', 'vault-name'])(
    'should present the root as a folder on the %s, without the items that must not act on it',
    async (trigger) => {
      const result = await openRootMenu({ shouldPresentRootAsFolder: true, trigger });

      expect(result.spotsByHandler).toEqual([[trigger], [trigger]]);
      expect(result.openMenuCount).toBe(1);
      expect(result.menuTitles).toContain(result.newNoteTitle);
      expect(result.menuTitles).toContain('Folder-only item');
      expect(result.menuTitles).not.toContain('UNSAFE');
      expect(result.isRootAfter).toBe(true);
    }
  );
});
interface OpenRootMenuParams {
  readonly shouldPresentRootAsFolder: boolean;
  readonly trigger: RootMenuTrigger;
}

async function openRootMenu(params: OpenRootMenuParams): Promise<RootMenuResult> {
  return evalInObsidian({
    async callback({
      app,
      lib: { clickElement, clickMouse, FileExplorerRootMenuComponent, waitUntil },
      obsidianModule,
      shouldPresentRootAsFolder,
      trigger
    }): Promise<RootMenuResult> {
      // Under the transport's ~30s per-closure cap, not at it. Two 10 s waits: the click point clearing, then the menu.
      const WAIT_TIMEOUT_IN_MILLISECONDS = 10_000;
      const UNSAFE_TITLE_KEYS = [
        'plugins.file-explorer.action-move-folder',
        'plugins.file-explorer.menu-opt-delete',
        'plugins.file-explorer.menu-opt-make-copy',
        'plugins.file-explorer.menu-opt-rename',
        'plugins.search.menu-opt-search-in-folder'
      ];

      const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
      if (!leaf) {
        throw new Error('No File Explorer leaf');
      }
      await leaf.loadIfDeferred();
      const navFilesContainerEl = leaf.view.containerEl.querySelector<HTMLElement>('.nav-files-container');
      if (!navFilesContainerEl) {
        throw new Error('No .nav-files-container');
      }

      const spotsByHandler: FileExplorerRootMenuSpot[][] = [[], []];
      let shownMenu: Menu | null = null;
      const components = spotsByHandler.map((spots, index) =>
        new FileExplorerRootMenuComponent({
          app,
          handler: ({ menu, spot }): void => {
            spots.push(spot);
            menu.addItem((item) => item.setTitle(`Root menu item ${String(index)}`));
            shownMenu = menu;
          },
          shouldPresentRootAsFolder: shouldPresentRootAsFolder && index === 1
        })
      );
      // Stands in for another plugin's folder menu items: one it offers any folder but the root.
      const fileMenuEventRef = app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof obsidianModule.TFolder && !file.isRoot()) {
          menu.addItem((item) => item.setTitle('Folder-only item'));
        }
      });

      for (const component of components) {
        component.load();
      }

      try {
        if (trigger === 'empty-area') {
          const rect = navFilesContainerEl.getBoundingClientRect();
          const x = Math.round(rect.left + rect.width / 2);
          const y = Math.round(rect.bottom - 4);
          // A menu an earlier case closed may still be leaving the screen above that point.
          await waitUntil({
            message: 'the bottom of .nav-files-container is empty and uncovered',
            predicate: (): boolean => activeDocument.elementFromPoint(x, y) === navFilesContainerEl,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await clickMouse({ button: 'right', x, y });
        } else {
          const vaultNameEl = activeDocument.querySelector<HTMLElement>('.workspace-drawer-vault-switcher');
          if (!vaultNameEl) {
            throw new Error('No .workspace-drawer-vault-switcher');
          }
          await clickElement({ button: 'right', element: vaultNameEl });
        }

        await waitUntil({
          message: 'the root menu reached the handlers',
          predicate: (): boolean => shownMenu !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const openMenuCount = activeDocument.body.querySelectorAll(':scope > .menu').length;
        const menuTitles = Array.from(activeDocument.body.querySelectorAll(':scope .menu .menu-item-title'), (el) => el.textContent);
        const unsafeTitles = new Set(UNSAFE_TITLE_KEYS.map((key) => activeWindow.i18next.t(key)));
        (shownMenu as Menu | null)?.hide();
        return {
          copyPathTitle: activeWindow.i18next.t('interface.menu.copy-path'),
          isRootAfter: app.vault.getRoot().isRoot(),
          menuTitles: menuTitles.map((title) => unsafeTitles.has(title) ? 'UNSAFE' : title),
          newNoteTitle: activeWindow.i18next.t('plugins.file-explorer.menu-opt-new-note'),
          openMenuCount,
          spotsByHandler
        };
      } finally {
        app.workspace.offref(fileMenuEventRef);
        for (const component of components) {
          component.unload();
        }
      }
    },
    input: { shouldPresentRootAsFolder: params.shouldPresentRootAsFolder, trigger: params.trigger }
  });
}
