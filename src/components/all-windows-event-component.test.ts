import type {
  App,
  EventRef,
  Workspace,
  WorkspaceContainer,
  WorkspaceLeaf,
  WorkspaceWindow
} from 'obsidian';

import { SilentError } from '@mnaoumov/typescript-lib/error';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { Component } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  AllWindowsEventComponent,
  forEachWindow,
  registerBodyClass
} from './all-windows-event-component.ts';

interface CreateMockAppParams {
  readonly domWindows?: Window[];
  readonly mainWindow?: Window;
  readonly onLayoutReady?: (callback: () => void) => void;
  readonly onWindowOpen?: Workspace['on'];
}

function createEventRef(): EventRef {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's EventRef shape names its emitter `e`, which Component.unload reads.
  return castTo<EventRef>({ e: { offref: vi.fn() } });
}

function createLoadedComponent(app: App): AllWindowsEventComponent {
  const component = new AllWindowsEventComponent(app);
  component.load();
  return component;
}

function createMockApp(params: CreateMockAppParams): App {
  const {
    domWindows = [],
    mainWindow = activeWindow,
    onLayoutReady = (callback: () => void): void => {
      callback();
    },
    onWindowOpen = vi.fn().mockReturnValue(createEventRef())
  } = params;

  const containers = domWindows.map((win) => strictProxy<WorkspaceContainer>({ win }));
  const leaves = containers.map((container) =>
    strictProxy<WorkspaceLeaf>({
      getContainer: (): WorkspaceContainer => container
    })
  );

  return strictProxy<App>({
    workspace: {
      iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void): void => {
        for (const leaf of leaves) {
          callback(leaf);
        }
      },
      on: onWindowOpen,
      onLayoutReady,
      rootSplit: { win: mainWindow }
    }
  });
}

describe('AllWindowsEventComponent', () => {
  type WindowOpenCallback = (workspaceWindow: WorkspaceWindow) => void;
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with the app main window even when another window is active', () => {
    const mainWindow = strictProxy<Window>({});
    const app = createMockApp({ mainWindow });
    const handler = vi.fn();

    createLoadedComponent(app).registerAllWindowsHandler(handler);

    expect(handler).toHaveBeenCalledExactlyOnceWith(mainWindow);
  });

  it('should visit each window once and release closed-window resources before owner unload', () => {
    const popupWin = strictProxy<Window>({});
    let open: null | WindowOpenCallback = null;
    let close: ((workspaceWindow: WorkspaceWindow, win: Window) => void) | null = null;
    const onWindowOpen = castTo<Workspace['on']>(vi.fn((name: string, callback: WindowOpenCallback & ((workspaceWindow: WorkspaceWindow, win: Window) => void)) => {
      if (name === 'window-open') {
        open = callback;
      } else {
        close = callback;
      }
      return createEventRef();
    }));
    const app = createMockApp({ domWindows: [activeWindow, popupWin, popupWin], onWindowOpen });
    const owner = new Component().asOriginalType__();
    owner.load();
    const cleanup = vi.fn();
    const handler = vi.fn(() => cleanup);
    forEachWindow({ app, callback: handler, component: owner });
    vi.runAllTimers();
    const workspaceWindow = strictProxy<WorkspaceWindow>({ win: popupWin });
    // These callbacks are installed synchronously by the fake layout-ready clock above.
    emitOpen();
    expect(handler).toHaveBeenCalledTimes(2);

    emitClose();
    emitClose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    owner.unload();
    expect(cleanup).toHaveBeenCalledTimes(2);

    function emitOpen(): void {
      open?.(workspaceWindow);
    }

    function emitClose(): void {
      close?.(workspaceWindow, popupWin);
    }
  });

  it('should remove body classes from every window when the registration is removed early', () => {
    const popupDoc = document.implementation.createHTMLDocument('popout');
    const popupWin = strictProxy<Window>({ document: popupDoc });
    const app = createMockApp({ domWindows: [activeWindow, popupWin] });
    const owner = new Component().asOriginalType__();
    owner.load();
    const className = 'window-registration-test';
    // A popout can inherit the main body's class before its registration callback runs.
    popupDoc.body.classList.add(className);
    const registration = registerBodyClass({ app, className, component: owner });
    vi.runAllTimers();
    expect(document.body.classList.contains(className)).toBe(true);
    expect(popupDoc.body.classList.contains(className)).toBe(true);

    owner.removeChild(registration);

    expect(document.body.classList.contains(className)).toBe(false);
    expect(popupDoc.body.classList.contains(className)).toBe(false);
    owner.unload();
  });

  describe('registerAllWindowsHandler', () => {
    it('should undo each window exactly once when the owner unloads', () => {
      const app = createMockApp({});
      const component = createLoadedComponent(app);
      const cleanup = vi.fn();
      component.registerAllWindowsHandler(() => cleanup);

      component.unload();
      component.unload();

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('should call handler immediately with main window', () => {
      const app = createMockApp({});
      const handler = vi.fn();

      createLoadedComponent(app).registerAllWindowsHandler(handler);

      expect(handler).toHaveBeenCalledWith(activeWindow);
    });

    it('should throw when registering a handler before the component is loaded', () => {
      const app = createMockApp({});
      const handler = vi.fn();

      expect(() => {
        new AllWindowsEventComponent(app).registerAllWindowsHandler(handler);
      }).toThrow('Component is not loaded');
    });

    it('should throw a SilentError when registering a handler after the component is unloaded', () => {
      const app = createMockApp({});
      const handler = vi.fn();
      const component = createLoadedComponent(app);
      component.unload();

      expect(() => {
        component.registerAllWindowsHandler(handler);
      }).toThrow(SilentError);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should call handler for existing popup windows after layout ready', () => {
      const popupWin = strictProxy<Window>({});
      const app = createMockApp({ domWindows: [activeWindow, popupWin] });
      const handler = vi.fn();

      createLoadedComponent(app).registerAllWindowsHandler(handler);
      vi.runAllTimers();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(popupWin);
    });

    it('should skip main window in popup windows iteration', () => {
      const app = createMockApp({ domWindows: [activeWindow] });
      const handler = vi.fn();

      createLoadedComponent(app).registerAllWindowsHandler(handler);
      vi.runAllTimers();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(activeWindow);
    });

    it('should call handler for future popup windows on window-open event', () => {
      let windowOpenCallback: undefined | WindowOpenCallback;
      const onWindowOpen = vi.fn().mockImplementation((_event: string, callback: WindowOpenCallback) => {
        windowOpenCallback = callback;
        return strictProxy<EventRef>({});
      }) as Workspace['on'];
      const app = createMockApp({ onWindowOpen });
      const handler = vi.fn();

      createLoadedComponent(app).registerAllWindowsHandler(handler);
      vi.runAllTimers();

      expect(windowOpenCallback).toBeDefined();
      const newWin = strictProxy<Window>({});
      const workspaceWindow = strictProxy<WorkspaceWindow>({ win: newWin });
      windowOpenCallback?.(workspaceWindow);
      expect(handler).toHaveBeenCalledWith(newWin);
    });

    it('should hand the window-open subscription to registerEvent so it is cleaned up on unload', () => {
      const eventRef = strictProxy<EventRef>({});
      const onWindowOpen = vi.fn().mockReturnValue(eventRef) as Workspace['on'];
      const app = createMockApp({ onWindowOpen });
      const component = createLoadedComponent(app);
      const registerEventSpy = vi.spyOn(component, 'registerEvent');
      const handler = vi.fn();

      component.registerAllWindowsHandler(handler);
      vi.runAllTimers();

      expect(registerEventSpy).toHaveBeenCalledWith(eventRef);
    });

    it('should register window-open event on the component', () => {
      const app = createMockApp({});
      const component = createLoadedComponent(app);
      const registerEventSpy = vi.spyOn(component, 'registerEvent');
      const handler = vi.fn();

      component.registerAllWindowsHandler(handler);
      vi.runAllTimers();

      expect(registerEventSpy).toHaveBeenCalled();
    });

    it('should defer popup window handling until layout is ready', () => {
      let layoutReadyCallback: (() => void) | undefined;
      const popupWin = strictProxy<Window>({});
      const app = createMockApp({
        domWindows: [activeWindow, popupWin],
        onLayoutReady: (callback: () => void): void => {
          layoutReadyCallback = callback;
        }
      });
      const handler = vi.fn();

      createLoadedComponent(app).registerAllWindowsHandler(handler);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(activeWindow);

      layoutReadyCallback?.();
      vi.runAllTimers();
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(popupWin);
    });

    it('should skip deferred handler if component is unloaded before layout ready', () => {
      let layoutReadyCallback: (() => void) | undefined;
      const popupWin = strictProxy<Window>({});
      const app = createMockApp({
        domWindows: [activeWindow, popupWin],
        onLayoutReady: (callback: () => void): void => {
          layoutReadyCallback = callback;
        }
      });
      const component = createLoadedComponent(app);
      const handler = vi.fn();

      component.registerAllWindowsHandler(handler);

      expect(handler).toHaveBeenCalledTimes(1);

      component.unload();
      layoutReadyCallback?.();
      vi.runAllTimers();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerAllWindowsDomEvent', () => {
    it('should register DOM event on all windows', () => {
      const app = createMockApp({});
      const component = createLoadedComponent(app);
      const registerDomEventSpy = vi.spyOn(component, 'registerDomEvent');
      const callback = vi.fn();

      component.registerAllWindowsDomEvent({
        callback,
        type: 'click'
      });

      expect(registerDomEventSpy).toHaveBeenCalledWith(activeWindow, 'click', callback, undefined);
    });

    it('should pass options to registerDomEvent', () => {
      const app = createMockApp({});
      const component = createLoadedComponent(app);
      const registerDomEventSpy = vi.spyOn(component, 'registerDomEvent');
      const callback = vi.fn();
      const options = { capture: true };

      component.registerAllWindowsDomEvent({
        callback,
        options,
        type: 'click'
      });

      expect(registerDomEventSpy).toHaveBeenCalledWith(activeWindow, 'click', callback, options);
    });
  });

  describe('registerAllDocumentsDomEvent', () => {
    it('should register DOM event on all documents', () => {
      const app = createMockApp({});
      const component = createLoadedComponent(app);
      const registerDomEventSpy = vi.spyOn(component, 'registerDomEvent');
      const callback = vi.fn();

      component.registerAllDocumentsDomEvent({
        callback,
        type: 'click'
      });

      expect(registerDomEventSpy).toHaveBeenCalledWith(activeWindow.document, 'click', callback, undefined);
    });

    it('should pass options to registerDomEvent', () => {
      const app = createMockApp({});
      const component = createLoadedComponent(app);
      const registerDomEventSpy = vi.spyOn(component, 'registerDomEvent');
      const callback = vi.fn();
      const options = { passive: true };

      component.registerAllDocumentsDomEvent({
        callback,
        options,
        type: 'click'
      });

      expect(registerDomEventSpy).toHaveBeenCalledWith(activeWindow.document, 'click', callback, options);
    });
  });
});
