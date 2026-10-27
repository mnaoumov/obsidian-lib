/**
 * @file
 *
 * Tests for {@link FileExplorerRootMenuComponent}.
 */

import type {
  App as AppOriginal,
  Menu as MenuOriginal,
  TAbstractFile,
  View as ViewOriginal,
  WorkspaceLeaf as WorkspaceLeafOriginal
} from 'obsidian';
import type { Mock } from 'vitest';

import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  App,
  Menu,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  FileExplorerRootMenuHandler,
  FileExplorerRootMenuHandlerParams
} from './file-explorer-root-menu-component.ts';

import {
  FileExplorerRootMenuComponent,
  FileExplorerRootMenuSpot
} from './file-explorer-root-menu-component.ts';

interface LoadParams {
  readonly handler: FileExplorerRootMenuHandler;
  readonly shouldPresentRootAsFolder?: boolean;
}

interface VaultMenuRecord {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The menu probe records when showing the menu is requested.
  isShowRequested: boolean;
  readonly menu: Menu;
  readonly show: Mock<() => Menu>;
}

interface ViewWithoutContextMenu extends ViewOriginal {
  readonly onFileContextMenu?: undefined;
}

const TITLES_BY_KEY: Record<string, string> = {
  'plugins.file-explorer.action-move-folder': 'Move folder to...',
  'plugins.file-explorer.menu-opt-delete': 'Delete',
  'plugins.file-explorer.menu-opt-make-copy': 'Make a copy',
  'plugins.file-explorer.menu-opt-rename': 'Rename...',
  'plugins.search.menu-opt-search-in-folder': 'Search in folder'
};

/**
 * Stands in for the core File Explorer view: builds a menu, triggers `file-menu` and shows it, as Obsidian `1.15.0`
 * does in `onFileContextMenu`.
 */
class FakeFileExplorerView {
  public shouldTriggerStrayFileMenu = false;
  public readonly shownMenus: MenuOriginal[] = [];
  public readonly tree = { clearSelectedDoms: vi.fn() };

  public constructor(private readonly app: AppOriginal) {}

  public onFileContextMenu(mouseEvent: MouseEvent, file: TAbstractFile): void {
    const menu = Menu.create2__().asOriginalType2__();
    addTitledItem(menu, 'New note');
    if (!(file instanceof TFolder) || !file.isRoot()) {
      addTitledItem(menu, 'Rename...');
      addTitledItem(menu, 'Delete');
    }
    if (this.shouldTriggerStrayFileMenu) {
      this.app.workspace.trigger('file-menu', menu, file, 'some-other-source', null);
      this.app.workspace.trigger('file-menu', menu, this.app.vault.getAbstractFileByPath('note.md'), 'file-explorer-context-menu', null);
    }
    this.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);
    menu.showAtMouseEvent(mouseEvent);
    this.shownMenus.push(menu);
  }
}

const originalOnFileContextMenu = FakeFileExplorerView.prototype.onFileContextMenu;

let app: AppOriginal;
let components: FileExplorerRootMenuComponent[];
let leaves: WorkspaceLeafOriginal[];
let vaultMenusByEvent: WeakMap<Event, VaultMenuRecord>;
let view: FakeFileExplorerView;

beforeEach(async () => {
  app = App.createConfigured__().asOriginalType__();
  await app.vault.create('note.md', '');
  view = new FakeFileExplorerView(app);
  leaves = [createLeaf(view)];
  vi.spyOn(app.workspace, 'getLeavesOfType').mockImplementation(() => leaves);
  vi.stubGlobal('i18next', { t: (key: string): string => TITLES_BY_KEY[key] ?? key });
  components = [];
  vaultMenusByEvent = new WeakMap();
  vi.spyOn(Menu, 'forEvent').mockImplementation(forEvent);
});

afterEach(() => {
  for (const component of components) {
    component.unload();
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('FileExplorerRootMenuComponent', () => {
  it('should hand the empty-area menu to the handler just before it is shown', () => {
    const handler = vi.fn((params: FileExplorerRootMenuHandlerParams) => {
      addTitledItem(params.menu, 'Custom');
    });
    load({ handler });

    const mouseEvent = new MouseEvent('contextmenu');
    view.onFileContextMenu(mouseEvent, app.vault.getRoot());

    expect(handler).toHaveBeenCalledOnce();
    const [params] = handler.mock.calls[0] ?? [];
    expect(params?.menu).toBe(view.shownMenus[0]);
    expect(params?.mouseEvent).toBe(mouseEvent);
    expect(params?.rootFolder).toBe(app.vault.getRoot());
    expect(params?.spot).toBe(FileExplorerRootMenuSpot.EmptyArea);
    expect(getTitles(view.shownMenus[0])).toEqual(['New note', 'Custom']);
  });

  it('should leave the menu of any other file alone', () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    load({ handler });

    view.onFileContextMenu(new MouseEvent('contextmenu'), getNote());

    expect(handler).not.toHaveBeenCalled();
    expect(getTitles(view.shownMenus[0])).toEqual(['New note', 'Rename...', 'Delete']);
  });

  it('should ignore a file-menu event from another source or for another file', () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    load({ handler });
    view.shouldTriggerStrayFileMenu = true;

    view.onFileContextMenu(new MouseEvent('contextmenu'), app.vault.getRoot());

    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([
    '.workspace-drawer-vault-switcher',
    '.workspace-drawer-header-name'
  ])('should hand the vault menu of %s to the handler, opening no second menu', async (selector) => {
    const handler = vi.fn((params: FileExplorerRootMenuHandlerParams) => {
      addTitledItem(params.menu, 'Custom');
    });
    load({ handler });
    const childEl = createVaultNameEl(selector, ['Copy path']).createSpan();

    const mouseEvent = dispatchContextMenu(childEl);

    expect(mouseEvent.defaultPrevented).toBe(true);
    const vaultMenu = getVaultMenu(mouseEvent);
    await vi.waitFor(() => {
      expect(vaultMenu.show).toHaveBeenCalledOnce();
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ mouseEvent, rootFolder: app.vault.getRoot(), spot: FileExplorerRootMenuSpot.VaultName });
    expect(handler.mock.calls[0]?.[0].menu).toBe(vaultMenu.menu);
    expect(getTitles(vaultMenu.menu)).toEqual(['Copy path', 'Custom']);
    expect(view.shownMenus).toHaveLength(0);
  });

  it('should hand over the vault menu while there is no File Explorer', async () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    load({ handler, shouldPresentRootAsFolder: true });
    leaves = [];

    const vaultMenu = getVaultMenu(dispatchContextMenu(createVaultNameEl('.workspace-drawer-vault-switcher', ['Copy path'])));

    await vi.waitFor(() => {
      expect(vaultMenu.show).toHaveBeenCalledOnce();
    });
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ spot: FileExplorerRootMenuSpot.VaultName });
  });

  it('should not show a vault menu that is still empty after every handler', async () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    load({ handler });

    const vaultMenu = getVaultMenu(dispatchContextMenu(createVaultNameEl('.workspace-drawer-header-name', [])));

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledOnce();
    });
    expect(vaultMenu.show).not.toHaveBeenCalled();
  });

  it('should replace the vault menu with the root folder menu when the root is presented as a folder', async () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    load({ handler, shouldPresentRootAsFolder: true });

    const mouseEvent = dispatchContextMenu(createVaultNameEl('.workspace-drawer-vault-switcher', ['Copy path']));
    const vaultMenu = getVaultMenu(mouseEvent);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledOnce();
      expect(vaultMenu.isShowRequested).toBe(true);
    });
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ mouseEvent, spot: FileExplorerRootMenuSpot.VaultName });
    expect(handler.mock.calls[0]?.[0].menu).toBe(view.shownMenus[0]);
    expect(view.tree.clearSelectedDoms).toHaveBeenCalledOnce();
    expect(vaultMenu.show).not.toHaveBeenCalled();
  });

  it('should report the empty area again after a vault-name menu', async () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    load({ handler, shouldPresentRootAsFolder: true });

    dispatchContextMenu(createVaultNameEl('.workspace-drawer-vault-switcher', []));
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledOnce();
    });
    view.onFileContextMenu(new MouseEvent('contextmenu'), app.vault.getRoot());

    expect(handler.mock.calls[1]?.[0]).toMatchObject({ spot: FileExplorerRootMenuSpot.EmptyArea });
  });

  it('should ignore a right-click anywhere else', () => {
    load({ handler: vi.fn() });

    const mouseEvent = dispatchContextMenu(document.body.createDiv('nav-file-title'));

    expect(mouseEvent.defaultPrevented).toBe(false);
  });

  it('should open nothing when the loaded leaf does not hold a File Explorer view', async () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    const loadIfDeferred = vi.fn(async () => {
      await noopAsync();
    });
    leaves = [strictProxy<WorkspaceLeafOriginal>({ loadIfDeferred, view: strictProxy<ViewWithoutContextMenu>({ onFileContextMenu: undefined }) })];
    load({ handler, shouldPresentRootAsFolder: true });

    const vaultMenu = getVaultMenu(dispatchContextMenu(createVaultNameEl('.workspace-drawer-vault-switcher', ['Copy path'])));

    await vi.waitFor(() => {
      expect(loadIfDeferred).toHaveBeenCalledOnce();
      expect(vaultMenu.isShowRequested).toBe(true);
    });
    await noopAsync();
    expect(handler).not.toHaveBeenCalled();
  });

  it('should open nothing when it was uninstalled while the leaf was loading', async () => {
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    let resolveLoad = noop;
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    leaves = [strictProxy<WorkspaceLeafOriginal>({ loadIfDeferred: () => loadPromise, view: castTo<ViewOriginal>(view) })];
    const component = load({ handler, shouldPresentRootAsFolder: true });

    dispatchContextMenu(createVaultNameEl('.workspace-drawer-vault-switcher', []));
    component.unload();
    resolveLoad();
    await loadPromise;
    await noopAsync();

    expect(handler).not.toHaveBeenCalled();
    expect(view.shownMenus).toHaveLength(0);
  });
  it('should patch once the File Explorer view appears in the layout', () => {
    leaves = [];
    const handler = vi.fn<FileExplorerRootMenuHandler>();
    load({ handler });
    expect(FakeFileExplorerView.prototype.onFileContextMenu).toBe(originalOnFileContextMenu);

    leaves = [createLeaf(view)];
    app.workspace.trigger('layout-change');

    view.onFileContextMenu(new MouseEvent('contextmenu'), app.vault.getRoot());
    expect(handler).toHaveBeenCalledOnce();
  });

  it('should not patch once uninstalled, even when the layout becomes ready afterwards', () => {
    leaves = [];
    load({ handler: vi.fn() }).unload();

    leaves = [createLeaf(view)];
    App.fromOriginalType__(app).workspace.setLayoutReady__();

    expect(FakeFileExplorerView.prototype.onFileContextMenu).toBe(originalOnFileContextMenu);
  });

  it('should share one installation between subscribers and hand it over when its owner unloads', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const thirdHandler = vi.fn();
    const first = load({ handler: firstHandler });
    const second = load({ handler: secondHandler });
    const third = load({ handler: thirdHandler });
    const patchedOnFileContextMenu = FakeFileExplorerView.prototype.onFileContextMenu;

    view.onFileContextMenu(new MouseEvent('contextmenu'), app.vault.getRoot());
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();
    expect(thirdHandler).toHaveBeenCalledOnce();

    second.unload();
    expect(FakeFileExplorerView.prototype.onFileContextMenu).toBe(patchedOnFileContextMenu);

    first.unload();
    view.onFileContextMenu(new MouseEvent('contextmenu'), app.vault.getRoot());
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();
    expect(thirdHandler).toHaveBeenCalledTimes(2);

    third.unload();
    expect(FakeFileExplorerView.prototype.onFileContextMenu).toBe(originalOnFileContextMenu);
  });

  it('should present the root as a folder while any subscriber asks, without its unsafe items', () => {
    const handler = vi.fn((params: FileExplorerRootMenuHandlerParams) => {
      expect(params.rootFolder.isRoot()).toBe(false);
    });
    load({ handler });
    load({ handler: vi.fn(), shouldPresentRootAsFolder: true });
    const root = app.vault.getRoot();

    view.onFileContextMenu(new MouseEvent('contextmenu'), root);

    expect(handler).toHaveBeenCalledOnce();
    expect(getTitles(view.shownMenus[0])).toEqual(['New note']);
    expect(root.isRoot()).toBe(true);
    expect(Object.hasOwn(root, 'isRoot')).toBe(false);
  });

  it('should keep a separator and restore an isRoot the folder already owned', () => {
    load({
      handler: (params) => {
        params.menu.addSeparator();
      },
      shouldPresentRootAsFolder: true
    });
    const root = app.vault.getRoot();
    root.isRoot = isRootOwnOverride;

    view.onFileContextMenu(new MouseEvent('contextmenu'), root);

    expect(view.shownMenus[0]?.items).toHaveLength(2);
    expect(root.isRoot).toBe(isRootOwnOverride);
  });

  it('should report a failing handler and still run the others', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const error = new Error('handler failed');
    const secondHandler = vi.fn();
    load({
      handler: () => {
        throw error;
      }
    });
    load({ handler: secondHandler });

    view.onFileContextMenu(new MouseEvent('contextmenu'), app.vault.getRoot());

    expect(consoleError).toHaveBeenCalledWith('A file explorer root menu handler failed', error);
    expect(secondHandler).toHaveBeenCalledOnce();
  });
});

function addTitledItem(menu: MenuOriginal, title: string): void {
  menu.addItem((item) => {
    item.setTitle(title);
    Object.assign(item, { titleEl: createDiv({ text: title }) });
  });
}

function createLeaf(fileExplorerView: FakeFileExplorerView): WorkspaceLeafOriginal {
  return strictProxy<WorkspaceLeafOriginal>({
    loadIfDeferred: async () => {
      await noopAsync();
    },
    view: castTo<ViewOriginal>(fileExplorerView)
  });
}

function createVaultNameEl(selector: string, nativeItemTitles: readonly string[]): HTMLElement {
  const el = document.body.createDiv(selector.slice(1));
  // Stands in for Obsidian's own listener, which adds its vault items to the menu `Menu.forEvent` hands out.
  el.addEventListener('contextmenu', (mouseEvent) => {
    const menu = Menu.forEvent(mouseEvent).asOriginalType2__();
    for (const title of nativeItemTitles) {
      addTitledItem(menu, title);
    }
  });
  return el;
}

function dispatchContextMenu(el: HTMLElement): MouseEvent {
  const mouseEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  el.dispatchEvent(mouseEvent);
  return mouseEvent;
}

/**
 * Stands in for Obsidian's `Menu.forEvent`: one menu per event, shown on the next task.
 *
 * @param mouseEvent - The event.
 * @returns The event's menu.
 */
function forEvent(mouseEvent: MouseEvent | PointerEvent): Menu {
  mouseEvent.preventDefault();
  let record = vaultMenusByEvent.get(mouseEvent);
  if (!record) {
    const menu = Menu.create2__();
    const show = vi.fn(() => menu);
    Object.assign(menu, { showAtMouseEvent: show });
    const newRecord: VaultMenuRecord = { isShowRequested: false, menu, show };
    record = newRecord;
    vaultMenusByEvent.set(mouseEvent, newRecord);
    window.setTimeout(() => {
      newRecord.isShowRequested = true;
      menu.showAtMouseEvent(mouseEvent);
    }, 0);
  }
  return record.menu;
}

function getNote(): TAbstractFile {
  const note = app.vault.getAbstractFileByPath('note.md');
  if (!note) {
    throw new Error('note.md is missing');
  }
  return note;
}

function getTitles(menu: Menu | MenuOriginal | undefined): string[] {
  if (!menu) {
    throw new Error('No menu was shown');
  }
  return (menu instanceof Menu ? menu : Menu.fromOriginalType2__(menu)).menuItems__.map((item) => typeof item.title__ === 'string' ? item.title__ : '');
}

function getVaultMenu(mouseEvent: MouseEvent): VaultMenuRecord {
  const record = vaultMenusByEvent.get(mouseEvent);
  if (!record) {
    throw new Error('No vault menu was built for the event');
  }
  return record;
}

function isRootOwnOverride(): boolean {
  return true;
}

function load(params: LoadParams): FileExplorerRootMenuComponent {
  const component = new FileExplorerRootMenuComponent({ app, ...params });
  component.load();
  components.push(component);
  return component;
}
