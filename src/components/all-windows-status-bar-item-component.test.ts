import type {
  App,
  EventRef,
  Workspace,
  WorkspaceContainer,
  WorkspaceLeaf,
  WorkspaceWindow
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  Component,
  Platform
} from 'obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { AllWindowsStatusBarItemRenderParams } from './all-windows-status-bar-item-component.ts';

import {
  AllWindowsStatusBarItemComponent,
  getPluginStatusBarItemCssClass,
  registerAllWindowsStatusBarItem,
  WINDOW_STATUS_BAR_CSS_CLASS
} from './all-windows-status-bar-item-component.ts';

interface MockApp {
  readonly app: App;
  readonly trigger: (name: string, win: Window) => void;
}

function createMainStatusBar(): HTMLElement {
  const appContainerEl = document.body.createDiv({ cls: 'app-container' });
  return appContainerEl.createDiv({ cls: 'status-bar' });
}

function createMockApp(popoutWindows: Window[] = []): MockApp {
  type WindowEventCallback = (workspaceWindow: WorkspaceWindow, win: Window) => void;
  const callbacks = new Map<string, WindowEventCallback[]>();
  const leaves = popoutWindows.map((win) =>
    strictProxy<WorkspaceLeaf>({
      // A strict proxy would wrap `win` in a proxy of its own, which is not the window the test compares against.
      getContainer: (): WorkspaceContainer => castTo<WorkspaceContainer>({ win })
    })
  );

  const app = strictProxy<App>({
    workspace: {
      iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void): void => {
        for (const leaf of leaves) {
          callback(leaf);
        }
      },
      on: castTo<Workspace['on']>((name: string, callback: WindowEventCallback): EventRef => {
        const handlers = callbacks.get(name) ?? [];
        handlers.push(callback);
        callbacks.set(name, handlers);
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's EventRef shape names its emitter `e`, which Component.unload reads.
        return castTo<EventRef>({ e: { offref: vi.fn() } });
      }),
      onLayoutReady: (callback: () => void): void => {
        callback();
      },
      rootSplit: { win: activeWindow }
    }
  });

  return {
    app,
    trigger: (name, win): void => {
      for (const callback of callbacks.get(name) ?? []) {
        callback(castTo<WorkspaceWindow>({ win }), win);
      }
    }
  };
}

function createPopoutWindow(): Window {
  const doc = document.implementation.createHTMLDocument();
  doc.body.createDiv({ cls: 'app-container' }).createDiv({ cls: 'horizontal-main-container' });
  return castTo<Window>({ document: doc });
}

function getStatusBarItemTexts(win: Window): string[] {
  return [...win.document.body.querySelectorAll(':scope > .app-container > .status-bar > .status-bar-item')].map((el) => el.textContent);
}

function getStatusBars(win: Window): HTMLElement[] {
  return [...win.document.body.querySelectorAll<HTMLElement>(':scope > .app-container > .status-bar')];
}

describe('AllWindowsStatusBarItemComponent', () => {
  let mainStatusBarEl: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    mainStatusBarEl = createMainStatusBar();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.empty();
  });

  it('should add an item to the main window status bar on load and render it', () => {
    const { app } = createMockApp();
    const render = vi.fn(({ el }: AllWindowsStatusBarItemRenderParams) => {
      el.setText('Main');
    });
    const component = new AllWindowsStatusBarItemComponent({ app, cls: ['extra'], pluginId: 'my-plugin', render });
    component.load();

    const itemEl = component.getItemEl(activeWindow);
    expect(itemEl?.parentElement).toBe(mainStatusBarEl);
    expect(itemEl?.className).toBe('status-bar-item plugin-my-plugin extra');
    expect(itemEl?.textContent).toBe('Main');
    expect(render).toHaveBeenCalledWith({ el: itemEl, win: activeWindow });
  });

  it('should create a marked status bar in an existing popout after layout ready', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    const component = new AllWindowsStatusBarItemComponent({
      app,
      render({ el, win }): void {
        el.setText(win === popout ? 'popout' : 'main');
      }
    });
    component.load();
    vi.runAllTimers();

    const [statusBarEl] = getStatusBars(popout);
    expect(statusBarEl?.classList.contains(WINDOW_STATUS_BAR_CSS_CLASS)).toBe(true);
    expect(getStatusBarItemTexts(popout)).toEqual(['popout']);
    expect(component.getItemEls()).toHaveLength(2);
  });

  it('should add an item to popouts opened later, once despite duplicate open events', () => {
    const { app, trigger } = createMockApp();
    const render = vi.fn();
    const component = new AllWindowsStatusBarItemComponent({ app, render });
    component.load();
    vi.runAllTimers();

    const popout = createPopoutWindow();
    trigger('window-open', popout);
    trigger('window-open', popout);

    expect(getStatusBars(popout)).toHaveLength(1);
    expect(popout.document.querySelectorAll('.status-bar-item')).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('should reuse a status bar a popout already has, without marking or removing it', () => {
    const popout = createPopoutWindow();
    const existingStatusBarEl = popout.document.body.querySelector('.app-container')?.createDiv({ cls: 'status-bar' });
    const { app } = createMockApp([popout]);
    const component = new AllWindowsStatusBarItemComponent({ app, render: vi.fn() });
    component.load();
    vi.runAllTimers();

    expect(component.getItemEl(popout)?.parentElement).toBe(existingStatusBarEl);
    component.unload();

    expect(getStatusBars(popout)).toEqual([existingStatusBarEl]);
    expect(existingStatusBarEl?.classList.contains(WINDOW_STATUS_BAR_CSS_CLASS)).toBe(false);
  });

  it('should skip a window without a status bar when creating one is disabled', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    const render = vi.fn();
    const component = new AllWindowsStatusBarItemComponent({ app, render, shouldCreateMissingStatusBar: false });
    component.load();
    vi.runAllTimers();

    expect(getStatusBars(popout)).toEqual([]);
    expect(component.getItemEl(popout)).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('should skip a window without an app container', () => {
    const popout = castTo<Window>({ document: document.implementation.createHTMLDocument() });
    const { app } = createMockApp([popout]);
    const component = new AllWindowsStatusBarItemComponent({ app, render: vi.fn() });
    component.load();
    vi.runAllTimers();

    expect(component.getItemEl(popout)).toBeNull();
    expect(popout.document.body.children).toHaveLength(0);
  });

  it('should render every item again on refresh', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    let text = 'First';
    const component = new AllWindowsStatusBarItemComponent({
      app,
      render({ el }): void {
        el.setText(text);
      }
    });
    component.load();
    vi.runAllTimers();

    text = 'Second';
    component.refresh();

    expect(getStatusBarItemTexts(activeWindow)).toEqual(['Second']);
    expect(getStatusBarItemTexts(popout)).toEqual(['Second']);
  });

  it('should remove its items and the status bar it created on unload', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    const component = new AllWindowsStatusBarItemComponent({ app, render: vi.fn() });
    component.load();
    vi.runAllTimers();
    component.unload();

    expect(mainStatusBarEl.children).toHaveLength(0);
    expect(getStatusBars(activeWindow)).toEqual([mainStatusBarEl]);
    expect(getStatusBars(popout)).toEqual([]);
    expect(component.getItemEls()).toEqual([]);
  });

  it('should forget a closed popout and stop refreshing it', () => {
    const popout = createPopoutWindow();
    const { app, trigger } = createMockApp([popout]);
    const render = vi.fn();
    const component = new AllWindowsStatusBarItemComponent({ app, render });
    component.load();
    vi.runAllTimers();
    trigger('window-close', popout);
    render.mockClear();
    component.refresh();

    expect(component.getItemEl(popout)).toBeNull();
    expect(render).toHaveBeenCalledExactlyOnceWith({ el: component.getItemEl(activeWindow), win: activeWindow });
  });

  it('should leave items of other owners alone and keep a shared created bar until the last item goes', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    const first = new AllWindowsStatusBarItemComponent({
      app,
      render: ({ el }): void => {
        el.setText('First');
      }
    });
    const second = new AllWindowsStatusBarItemComponent({
      app,
      render: ({ el }): void => {
        el.setText('Second');
      }
    });
    const plain = mainStatusBarEl.createDiv({ cls: 'status-bar-item', text: 'native' });
    first.load();
    second.load();
    vi.runAllTimers();

    expect(getStatusBars(popout)).toHaveLength(1);
    expect(getStatusBarItemTexts(popout)).toEqual(['First', 'Second']);

    first.unload();

    expect(getStatusBarItemTexts(popout)).toEqual(['Second']);
    expect(getStatusBarItemTexts(activeWindow)).toEqual(['native', 'Second']);
    expect(plain.isConnected).toBe(true);

    second.unload();

    expect(getStatusBars(popout)).toEqual([]);
    expect(getStatusBarItemTexts(activeWindow)).toEqual(['native']);
  });

  it('should do nothing on mobile', () => {
    vi.spyOn(Platform, 'isMobile', 'get').mockReturnValue(true);
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    const render = vi.fn();
    const component = new AllWindowsStatusBarItemComponent({ app, render });
    component.load();
    vi.runAllTimers();

    expect(render).not.toHaveBeenCalled();
    expect(mainStatusBarEl.children).toHaveLength(0);
    expect(getStatusBars(popout)).toEqual([]);
  });
});

describe('getPluginStatusBarItemCssClass', () => {
  it('should lower-case the id and replace only the first disallowed character, as Obsidian does', () => {
    expect(getPluginStatusBarItemCssClass('My.Plugin.Id')).toBe('plugin-my-plugin.id');
  });
});

describe('registerAllWindowsStatusBarItem', () => {
  afterEach(() => {
    document.body.empty();
  });

  it('should show the item while the owner is loaded and remove it on its unload', () => {
    const mainStatusBarEl = createMainStatusBar();
    const { app } = createMockApp();
    const owner = new Component();
    owner.load();

    const component = registerAllWindowsStatusBarItem({
      app,
      component: owner,
      render: ({ el }): void => {
        el.setText('Owned');
      }
    });

    expect(component).toBeInstanceOf(AllWindowsStatusBarItemComponent);
    expect(mainStatusBarEl.textContent).toBe('Owned');

    owner.unload();

    expect(mainStatusBarEl.children).toHaveLength(0);
  });
});
