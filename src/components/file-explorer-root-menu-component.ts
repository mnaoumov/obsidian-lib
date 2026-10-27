/**
 * @file
 *
 * Opens and extends the core File Explorer's context menu for the vault root, at the two spots that stand for it: the
 * vault name at the top of the left sidebar, and the empty area below the file list.
 *
 * Obsidian already opens a menu for the empty area: the view's own `contextmenu` listener on its files container calls
 * `onFileContextMenu(evt, vault.getRoot())`, which builds a {@link Menu}, triggers `file-menu` with the root folder and
 * the source `file-explorer-context-menu`, and shows it. The vault name (`.workspace-drawer-vault-switcher` on desktop,
 * `.workspace-drawer-header-name` on mobile, where Obsidian builds no switcher) opens a different menu: on desktop
 * Obsidian adds `Show in system explorer` and `Copy path` to the per-event menu `Menu.forEvent` hands out. The handlers
 * get that menu, so a right-click there never opens a second one. A subscriber that presents the root as a folder
 * replaces it with the root's folder menu instead. Read from Obsidian `1.15.0`.
 *
 * Every plugin bundles its own copy of this library, and several of them may want this menu. Two copies patching the
 * same prototype and listening on the same element would open it twice, so there is ONE installation per {@link App},
 * kept in the shared-state bag under a versioned key and owned by one subscriber. When the owner unloads while others
 * remain, the next subscriber installs it again from its own copy. What crosses that boundary is a wire format between
 * copies of different versions: plain objects and plain functions only, read structurally, and a change to what a field
 * means moves to a new key rather than reinterpreting the old one.
 */

import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  TAbstractFile,
  WorkspaceLeaf
} from 'obsidian';

import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { getPrototypeOf } from '@mnaoumov/typescript-lib/object-utils';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  Menu,
  MenuItem,
  TFolder
} from 'obsidian';

import { getObsidianLibState } from '../obsidian-lib-state.ts';
import { ComponentEx } from './component-ex.ts';
import { around } from './monkey-around-component.ts';

/**
 * The elements that stand for the vault root at the top of the left sidebar, in priority order. Obsidian builds
 * `.workspace-drawer-vault-switcher` only on desktop; on mobile the vault name is the drawer header instead.
 */
export const VAULT_NAME_SELECTORS = [
  '.workspace-drawer-vault-switcher',
  '.workspace-drawer-header-name'
] as const;

/**
 * The `source` Obsidian passes with `file-menu` when the File Explorer opens a menu.
 */
const FILE_EXPLORER_MENU_SOURCE = 'file-explorer-context-menu';

/**
 * The menu items that must not act on the vault root, by the localization key of their title. They appear only when
 * the root is presented as an ordinary folder, from Obsidian itself or from another plugin's `file-menu` handler.
 */
const ROOT_UNSAFE_ITEM_TITLE_KEYS = [
  'plugins.file-explorer.action-move-folder',
  'plugins.file-explorer.menu-opt-delete',
  'plugins.file-explorer.menu-opt-make-copy',
  'plugins.file-explorer.menu-opt-rename',
  'plugins.search.menu-opt-search-in-folder'
] as const;

const SHARED_STATE_KEY = 'fileExplorerRootMenuV1';

/**
 * Which spot of the File Explorer the vault-root menu was opened from.
 */
export enum FileExplorerRootMenuSpot {
  /**
   * The empty area below the file list.
   */
  EmptyArea = 'empty-area',

  /**
   * The vault name at the top of the left sidebar.
   */
  VaultName = 'vault-name'
}

/**
 * Parameters for {@link FileExplorerRootMenuComponent}.
 */
export interface FileExplorerRootMenuComponentConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * Called each time the vault-root menu is about to be shown.
   */
  readonly handler: FileExplorerRootMenuHandler;

  /**
   * Whether the root is presented as an ordinary folder while its menu is built, so that Obsidian and other plugins add
   * the items they add to any folder. The items that must not act on the root (rename, delete, move, make a copy and
   * search in folder) are removed again before the menu is shown. On the vault name, the root's folder menu then replaces
   * Obsidian's vault menu. It holds while any subscriber asks for it.
   *
   * @default `false`
   */
  readonly shouldPresentRootAsFolder?: boolean;
}

/**
 * A handler of the vault-root menu.
 *
 * @param params - The parameters.
 */
export type FileExplorerRootMenuHandler = (params: FileExplorerRootMenuHandlerParams) => void;

/**
 * Parameters for a {@link FileExplorerRootMenuHandler}.
 *
 * The shape is part of the wire format between copies of this library: fields are only ever added.
 */
export interface FileExplorerRootMenuHandlerParams {
  /**
   * The menu, about to be shown: the root's folder menu, after every `file-menu` handler has run, or on the vault name the
   * vault menu Obsidian builds there. A menu still empty after every handler is not shown.
   */
  readonly menu: Menu;

  /**
   * The right-click or long-press that opened the menu.
   */
  readonly mouseEvent: MouseEvent;

  /**
   * The vault root.
   */
  readonly rootFolder: TFolder;

  /**
   * Which spot the menu was opened from.
   */
  readonly spot: FileExplorerRootMenuSpot;
}

interface FileExplorerRootMenuInstallation {
  readonly owner: FileExplorerRootMenuSubscription;
  readonly uninstall: () => void;
}

interface FileExplorerRootMenuSharedState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Subscriber changes replace or clear the shared menu installation.
  installation: FileExplorerRootMenuInstallation | null;
  readonly subscriptions: FileExplorerRootMenuSubscription[];
}

interface FileExplorerRootMenuSubscription {
  readonly handler: (params: FileExplorerRootMenuHandlerParams) => void;
  readonly install: () => () => void;
  readonly shouldPresentRootAsFolder: boolean;
}

interface FileExplorerViewWithContextMenu extends FileExplorerView {
  readonly onFileContextMenu: (mouseEvent: MouseEvent, file: TAbstractFile) => void;
}

interface OpenRootMenuParams {
  readonly mouseEvent: MouseEvent;
  readonly openNative: () => void;
  readonly rootFolder: TFolder;
  readonly spot: FileExplorerRootMenuSpot;
}

/**
 * Hands the core File Explorer's vault-root menu to a handler, and opens that menu from the vault name too.
 *
 * Any number of these, in any number of plugins, share one installation per {@link App}.
 */
export class FileExplorerRootMenuComponent extends ComponentEx {
  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * Called each time the vault-root menu is about to be shown.
   */
  protected readonly handler: FileExplorerRootMenuHandler;

  /**
   * Whether the root is presented as an ordinary folder while its menu is built.
   */
  protected readonly shouldPresentRootAsFolder: boolean;

  /**
   * Creates a new file explorer root menu component.
   *
   * @param params - The parameters.
   */
  public constructor(params: FileExplorerRootMenuComponentConstructorParams) {
    super();
    this.app = params.app;
    this.handler = params.handler;
    this.shouldPresentRootAsFolder = params.shouldPresentRootAsFolder ?? false;
  }

  /**
   * Subscribes to the shared installation, installing it when nobody has yet.
   */
  public override onload(): void {
    super.onload();

    const state = getSharedState();
    const subscription: FileExplorerRootMenuSubscription = {
      handler: this.handler,
      install: () => installRootMenu(this.app, state),
      shouldPresentRootAsFolder: this.shouldPresentRootAsFolder
    };
    state.subscriptions.push(subscription);
    state.installation ??= { owner: subscription, uninstall: subscription.install() };

    this.register(() => {
      state.subscriptions.splice(state.subscriptions.indexOf(subscription), 1);
      if (state.installation?.owner !== subscription) {
        return;
      }

      state.installation.uninstall();
      const nextOwner = state.subscriptions[0];
      state.installation = nextOwner ? { owner: nextOwner, uninstall: nextOwner.install() } : null;
    });
  }
}

function dispatch(state: FileExplorerRootMenuSharedState, params: FileExplorerRootMenuHandlerParams): void {
  if (state.subscriptions.some((subscription) => subscription.shouldPresentRootAsFolder)) {
    removeRootUnsafeItems(params.menu);
  }

  // A snapshot: a handler may unload its own component, or another one, while the menu is dispatched.
  // eslint-disable-next-line unicorn/no-useless-spread -- The copy is the point: the list may change during the loop.
  for (const subscription of [...state.subscriptions]) {
    try {
      subscription.handler(params);
    } catch (error) {
      console.error('A file explorer root menu handler failed', error);
    }
  }
}

function dispatchBeforeShow(state: FileExplorerRootMenuSharedState, params: FileExplorerRootMenuHandlerParams): void {
  const uninstallShowPatch = around(params.menu, {
    showAtMouseEvent: (next) =>
      function patchedShowAtMouseEvent(this: Menu, showMouseEvent: MouseEvent): Menu {
        uninstallShowPatch();
        dispatch(state, params);
        return params.menu.items.length === 0 ? this : next.call(this, showMouseEvent);
      }
  });
}

function getFileExplorerLeaf(app: App): null | WorkspaceLeaf {
  return app.workspace.getLeavesOfType(ViewType.FileExplorer)[0] ?? null;
}

function getSharedState(): FileExplorerRootMenuSharedState {
  return getObsidianLibState<FileExplorerRootMenuSharedState>(SHARED_STATE_KEY, {
    installation: null,
    subscriptions: []
  }).value;
}
function installRootMenu(app: App, state: FileExplorerRootMenuSharedState): () => void {
  let isUninstalled = false;
  let pendingSpot: FileExplorerRootMenuSpot | null = null;
  let uninstallPatch: (() => void) | null = null;

  function tryPatch(): void {
    if (isUninstalled || uninstallPatch) {
      return;
    }

    const view = getFileExplorerLeaf(app)?.view;
    if (!isFileExplorerView(view)) {
      return;
    }

    uninstallPatch = around(getPrototypeOf(view), {
      onFileContextMenu: (next) =>
        function patchedOnFileContextMenu(this: FileExplorerViewWithContextMenu, mouseEvent: MouseEvent, file: TAbstractFile): void {
          if (!(file instanceof TFolder) || !file.isRoot()) {
            next.call(this, mouseEvent, file);
            return;
          }

          openRootMenu({
            mouseEvent,
            openNative: () => {
              next.call(this, mouseEvent, file);
            },
            rootFolder: file,
            spot: pendingSpot ?? FileExplorerRootMenuSpot.EmptyArea
          });
        }
    });
  }

  function openRootMenu(params: OpenRootMenuParams): void {
    const { mouseEvent, openNative, rootFolder, spot } = params;
    const eventRef = app.workspace.on('file-menu', (menu, file, source) => {
      if (file !== rootFolder || source !== FILE_EXPLORER_MENU_SOURCE) {
        return;
      }

      app.workspace.offref(eventRef);
      dispatchBeforeShow(state, { menu, mouseEvent, rootFolder, spot });
    });

    const restoreIsRoot = state.subscriptions.some((subscription) => subscription.shouldPresentRootAsFolder)
      ? presentAsFolder(rootFolder)
      : null;

    try {
      openNative();
    } finally {
      restoreIsRoot?.();
      app.workspace.offref(eventRef);
    }
  }

  function openFromVaultName(mouseEvent: MouseEvent): void {
    const isOnVaultName = mouseEvent.composedPath().some((target) => target instanceof HTMLElement && VAULT_NAME_SELECTORS.some((selector) => target.matches(selector)));
    if (!isOnVaultName) {
      return;
    }

    // `Menu.forEvent` hands every listener of one event the same menu and shows it on the next task. Obsidian's own
    // listener on the vault name adds its vault items to it after this capture-phase one has run.
    const vaultMenu = Menu.forEvent(mouseEvent);
    const rootFolder = app.vault.getRoot();
    const leaf = getFileExplorerLeaf(app);
    if (!leaf || state.subscriptions.every((subscription) => !subscription.shouldPresentRootAsFolder)) {
      dispatchBeforeShow(state, { menu: vaultMenu, mouseEvent, rootFolder, spot: FileExplorerRootMenuSpot.VaultName });
      return;
    }

    // Presented as a folder, the root's folder menu replaces the vault menu rather than opening on top of it.
    function suppressVaultMenuShow(): Menu {
      uninstallVaultMenuShowPatch();
      return vaultMenu;
    }
    const uninstallVaultMenuShowPatch = around(vaultMenu, { showAtMouseEvent: () => suppressVaultMenuShow });
    invokeAsyncSafely(async () => {
      await leaf.loadIfDeferred();
      const view = leaf.view;
      if (isUninstalled || !isFileExplorerView(view)) {
        return;
      }

      tryPatch();
      view.tree.clearSelectedDoms();
      pendingSpot = FileExplorerRootMenuSpot.VaultName;
      try {
        view.onFileContextMenu(mouseEvent, rootFolder);
      } finally {
        pendingSpot = null;
      }
    });
  }

  tryPatch();
  const layoutChangeEventRef = app.workspace.on('layout-change', tryPatch);
  app.workspace.onLayoutReady(tryPatch);
  const doc = app.workspace.containerEl.doc;
  doc.addEventListener('contextmenu', openFromVaultName, { capture: true });

  return () => {
    isUninstalled = true;
    uninstallPatch?.();
    app.workspace.offref(layoutChangeEventRef);
    doc.removeEventListener('contextmenu', openFromVaultName, { capture: true });
  };
}

function isFileExplorerView(view: unknown): view is FileExplorerViewWithContextMenu {
  return typeof (view as Partial<FileExplorerViewWithContextMenu> | undefined)?.onFileContextMenu === 'function';
}

function presentAsFolder(rootFolder: TFolder): () => void {
  const ownIsRootDescriptor = Object.getOwnPropertyDescriptor(rootFolder, 'isRoot');
  rootFolder.isRoot = (): boolean => false;
  return () => {
    if (ownIsRootDescriptor) {
      Object.defineProperty(rootFolder, 'isRoot', ownIsRootDescriptor);
    } else {
      delete (rootFolder as Partial<TFolder>).isRoot;
    }
  };
}

function removeRootUnsafeItems(menu: Menu): void {
  const unsafeTitles = new Set<null | string>(ROOT_UNSAFE_ITEM_TITLE_KEYS.map((key) => activeWindow.i18next.t(key)));
  menu.items = menu.items.filter((item) => !(item instanceof MenuItem) || !unsafeTitles.has(item.titleEl.textContent));
}
