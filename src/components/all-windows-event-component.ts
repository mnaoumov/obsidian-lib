/**
 * @file
 *
 * Handles registering DOM events and handlers for all windows (main window and all existing/future popup windows) and their documents.
 */

import type { App } from 'obsidian';

import { isFunction } from '@mnaoumov/typescript-lib/type-guards';
import { Component } from 'obsidian';

import {
  getAllDomWindows,
  getMainWindow
} from '../workspace.ts';
import { ComponentEx } from './component-ex.ts';
import { CallbackLayoutReadyComponent } from './layout-ready-component.ts';

/**
 * Parameters for {@link AllWindowsEventComponent.registerAllDocumentsDomEvent}.
 *
 * @typeParam DocumentEventType - The type of the event.
 */
export interface AllWindowsEventComponentRegisterAllDocumentsDomEventParams<DocumentEventType extends keyof DocumentEventMap> {
  /**
   * The callback to execute.
   *
   * @param $event - The event.
   * @returns The result of the callback.
   */
  readonly callback: (this: HTMLElement, $event: DocumentEventMap[DocumentEventType]) => unknown;

  /**
   * The options for the event.
   */
  readonly options?: AddEventListenerOptions | boolean;

  /**
   * The type of the event.
   */
  readonly type: DocumentEventType;
}

/**
 * Parameters for {@link AllWindowsEventComponent.registerAllWindowsDomEvent}.
 *
 * @typeParam WindowEventType - The type of the event.
 */
export interface AllWindowsEventComponentRegisterAllWindowsDomEventParams<WindowEventType extends keyof WindowEventMap> {
  /**
   * The callback to execute.
   *
   * @param $event - The event.
   * @returns The result of the callback.
   */
  readonly callback: (this: HTMLElement, $event: WindowEventMap[WindowEventType]) => unknown;

  /**
   * The options for the event.
   */
  readonly options?: AddEventListenerOptions | boolean;

  /**
   * The type of the event.
   */
  readonly type: WindowEventType;
}

/**
 * Parameters for {@link forEachWindow}.
 */
export interface ForEachWindowParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;
  /**
   * The handler, optionally returning cleanup for that window.
   */
  readonly callback: (win: Window) => unknown;
  /**
   * The component that owns the registration and its cleanup.
   */
  readonly component: Component;
}

/**
 * Parameters for {@link registerBodyClass}.
 */
export interface RegisterBodyClassParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;
  /**
   * One CSS class to add to each window's body. Use a plugin-specific name.
   */
  readonly className: string;
  /**
   * The component that owns the body class.
   */
  readonly component: Component;
}

/**
 * Handles registering DOM events and handlers for all windows (main window and all existing/future popup windows) and their documents.
 */
export class AllWindowsEventComponent extends ComponentEx {
  /**
   * Creates a new instance of the `AllWindowsEventComponent` class.
   *
   * @param app - The Obsidian app instance.
   */
  public constructor(protected readonly app: App) {
    super();
  }

  /**
   * Registers a DOM event for all documents (main window document and all existing/future popup window documents).
   *
   * @typeParam DocumentEventType - The type of the event.
   * @param params - The parameters for registering the DOM event.
   */
  public registerAllDocumentsDomEvent<DocumentEventType extends keyof DocumentEventMap>(
    params: AllWindowsEventComponentRegisterAllDocumentsDomEventParams<DocumentEventType>
  ): void {
    const {
      callback,
      options,
      type
    } = params;
    this.ensureLoaded();

    this.registerAllWindowsHandler((win) => {
      this.registerDomEvent(win.document, type, callback, options);
    });
  }

  /**
   * Registers a DOM event for all windows (main window and all existing/future popup windows).
   *
   * @typeParam WindowEventType - The type of the event.
   * @param params - The parameters for registering the DOM event.
   */
  public registerAllWindowsDomEvent<WindowEventType extends keyof WindowEventMap>(
    params: AllWindowsEventComponentRegisterAllWindowsDomEventParams<WindowEventType>
  ): void {
    const {
      callback,
      options,
      type
    } = params;
    this.ensureLoaded();

    this.registerAllWindowsHandler((win) => {
      this.registerDomEvent(win, type, callback, options);
    });
  }

  /**
   * Registers a handler once for each window, including popouts opened later.
   *
   * @param allWindowsHandler - The handler. Its optional cleanup runs when the window closes or this component unloads.
   */
  public registerAllWindowsHandler(allWindowsHandler: (win: Window) => unknown): void {
    this.ensureLoaded();

    const componentsByWindow = new Map<Window, Component>();
    this.register(() => {
      componentsByWindow.clear();
    });

    const attach = (win: Window): void => {
      if (componentsByWindow.has(win)) {
        return;
      }

      const component = this.addChild(new Component());
      componentsByWindow.set(win, component);
      const cleanup = allWindowsHandler(win);
      if (isFunction(cleanup)) {
        component.register(cleanup);
      }
    };

    this.registerEvent(this.app.workspace.on('window-close', (_workspaceWindow, win) => {
      const component = componentsByWindow.get(win);
      if (!component) {
        return;
      }

      componentsByWindow.delete(win);
      this.removeChild(component);
    }));

    attach(getMainWindow(this.app));

    this.addChild(
      new CallbackLayoutReadyComponent(this.app, () => {
        this.registerEvent(this.app.workspace.on('window-open', (workspaceWindow) => {
          attach(workspaceWindow.win);
        }));

        for (const win of getAllDomWindows(this.app)) {
          attach(win);
        }
      })
    );
  }
}

/**
 * Applies a handler to the main window immediately and to existing and future popouts after layout ready.
 * Cleanup runs when each window closes or the owning component unloads.
 *
 * @param params - The registration parameters. The owner must be loaded.
 * @returns The child component; remove it from the owner to stop early.
 */
export function forEachWindow(params: ForEachWindowParams): AllWindowsEventComponent {
  const { app, callback, component } = params;
  const allWindowsComponent = component.addChild(new AllWindowsEventComponent(app));
  allWindowsComponent.registerAllWindowsHandler(callback);
  return allWindowsComponent;
}

/**
 * Adds a body class to the main window and every existing or future popout until the owner unloads.
 * Use a plugin-specific class owned exclusively by this registration.
 *
 * @param params - The registration parameters. The owner must be loaded.
 * @returns The child component; remove it from the owner to stop early.
 */
export function registerBodyClass(params: RegisterBodyClassParams): AllWindowsEventComponent {
  const { app, className, component } = params;
  return forEachWindow({
    app,
    callback(win) {
      const { classList } = win.document.body;
      classList.add(className);
      return () => {
        classList.remove(className);
      };
    },
    component
  });
}
