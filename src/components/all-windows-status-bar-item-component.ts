/**
 * @file
 *
 * Shows one status-bar item in the main window and in every desktop popout, including popouts opened later, and
 * removes only its own items when a window closes or the component unloads.
 *
 * Read from Obsidian `1.15.1`: the main window builds `body > .app-container > .status-bar`, and
 * `Plugin.addStatusBarItem` is a `.status-bar-item` created in it. A popout builds `body > .app-container` with the
 * workspace only, and **no status bar**. `app.css` styles `.status-bar` without scoping it to a window, so a
 * `.status-bar` created inside a popout's `.app-container` looks and sits exactly like the main one. By default
 * this component creates that bar in a popout that lacks one, and marks it with
 * {@link WINDOW_STATUS_BAR_CSS_CLASS}. The marker is a wire constant shared by every copy of this library: any copy
 * reuses a marked bar, and whichever copy removes the last item from it removes the bar too.
 *
 * Mobile has no popouts, and `app.css` hides `.status-bar` under `.is-mobile`, so on mobile the component creates
 * nothing and never calls the render callback.
 */

import type {
  App,
  Component
} from 'obsidian';

import { Platform } from 'obsidian';

import { AllWindowsEventComponent } from './all-windows-event-component.ts';
import { ComponentEx } from './component-ex.ts';

/**
 * The class that marks a status bar this library created in a window that had none.
 * Other copies of the library match it, so its value must never change.
 */
export const WINDOW_STATUS_BAR_CSS_CLASS = 'obsidian-lib-window-status-bar';

const APP_CONTAINER_CSS_CLASS = 'app-container';
const STATUS_BAR_CSS_CLASS = 'status-bar';
const STATUS_BAR_ITEM_CSS_CLASS = 'status-bar-item';

/**
 * Parameters for the {@link AllWindowsStatusBarItemComponent} constructor.
 */
export interface AllWindowsStatusBarItemComponentConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * Extra CSS classes for each item.
   */
  readonly cls?: readonly string[];

  /**
   * The plugin id. When given, each item gets the `plugin-<id>` class that `Plugin.addStatusBarItem` adds, so
   * themes and CSS snippets that target the plugin's status-bar items match these too.
   */
  readonly pluginId?: string;

  /**
   * Renders the item of one window. Called when the item is created and again by
   * {@link AllWindowsStatusBarItemComponent.refresh}, so it must be safe to call repeatedly on the same element.
   *
   * @param params - The item and its window.
   */
  readonly render: (params: AllWindowsStatusBarItemRenderParams) => void;

  /**
   * Whether to create a status bar in a window that has none, as every popout in Obsidian `1.15.1` does.
   * When `false`, such a window gets no item. Defaults to `true`.
   */
  readonly shouldCreateMissingStatusBar?: boolean;
}

/**
 * Parameters passed to {@link AllWindowsStatusBarItemComponentConstructorParams.render}.
 */
export interface AllWindowsStatusBarItemRenderParams {
  /**
   * The status-bar item owned by this component in {@link win}.
   */
  readonly el: HTMLElement;

  /**
   * The window the item is in. Use its document for anything the render creates outside the item.
   */
  readonly win: Window;
}

/**
 * Parameters for {@link registerAllWindowsStatusBarItem}.
 */
export interface RegisterAllWindowsStatusBarItemParams extends AllWindowsStatusBarItemComponentConstructorParams {
  /**
   * The component that owns the items: they are removed when it unloads.
   */
  readonly component: Component;
}

/**
 * Shows one status-bar item in the main window and in every desktop popout while loaded.
 */
export class AllWindowsStatusBarItemComponent extends ComponentEx {
  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * The CSS classes added to each item.
   */
  protected readonly itemClasses: readonly string[];

  /**
   * Renders the item of one window.
   */
  protected readonly renderItem: (params: AllWindowsStatusBarItemRenderParams) => void;

  /**
   * Whether a status bar is created in a window that has none.
   */
  protected readonly shouldCreateMissingStatusBar: boolean;

  private readonly itemElsByWindow = new Map<Window, HTMLElement>();

  /**
   * Creates a new instance of the `AllWindowsStatusBarItemComponent` class.
   *
   * @param params - The {@link AllWindowsStatusBarItemComponentConstructorParams}.
   */
  public constructor(params: AllWindowsStatusBarItemComponentConstructorParams) {
    super();
    this.app = params.app;
    this.renderItem = params.render;
    this.shouldCreateMissingStatusBar = params.shouldCreateMissingStatusBar ?? true;
    this.itemClasses = [
      STATUS_BAR_ITEM_CSS_CLASS,
      ...params.pluginId === undefined ? [] : [getPluginStatusBarItemCssClass(params.pluginId)],
      ...params.cls ?? []
    ];
  }

  /**
   * Gets the item of a window.
   *
   * @param win - The window.
   * @returns The item, or `null` when the window has none.
   */
  public getItemEl(win: Window): HTMLElement | null {
    return this.itemElsByWindow.get(win) ?? null;
  }

  /**
   * Gets the items of every window that has one.
   *
   * @returns The items.
   */
  public getItemEls(): HTMLElement[] {
    return [...this.itemElsByWindow.values()];
  }

  /**
   * Creates the item in every window, now and as popouts open. A no-op on mobile.
   */
  public override onload(): void {
    super.onload();

    if (Platform.isMobile) {
      return;
    }

    const allWindowsEventComponent = this.addChild(new AllWindowsEventComponent(this.app));
    allWindowsEventComponent.registerAllWindowsHandler((win) => this.attach(win));
  }

  /**
   * Renders the item of every window again.
   */
  public refresh(): void {
    for (const [win, el] of this.itemElsByWindow) {
      this.renderItem({ el, win });
    }
  }

  private attach(win: Window): (() => void) | null {
    const statusBarEl = this.findOrCreateStatusBar(win.document);
    if (!statusBarEl) {
      return null;
    }

    const el = statusBarEl.createDiv({ cls: [...this.itemClasses] });
    this.itemElsByWindow.set(win, el);
    this.renderItem({ el, win });

    return () => {
      this.itemElsByWindow.delete(win);
      el.remove();
      if (statusBarEl.classList.contains(WINDOW_STATUS_BAR_CSS_CLASS) && !statusBarEl.querySelector(`:scope > .${STATUS_BAR_ITEM_CSS_CLASS}`)) {
        statusBarEl.remove();
      }
    };
  }

  private findOrCreateStatusBar(doc: Document): HTMLElement | null {
    const appContainerEl = doc.body.querySelector<HTMLElement>(`:scope > .${APP_CONTAINER_CSS_CLASS}`);
    if (!appContainerEl) {
      return null;
    }

    const statusBarEl = appContainerEl.querySelector<HTMLElement>(`:scope > .${STATUS_BAR_CSS_CLASS}`);
    if (statusBarEl) {
      return statusBarEl;
    }

    if (!this.shouldCreateMissingStatusBar) {
      return null;
    }

    return appContainerEl.createDiv({ cls: [STATUS_BAR_CSS_CLASS, WINDOW_STATUS_BAR_CSS_CLASS] });
  }
}

/**
 * Gets the class `Plugin.addStatusBarItem` adds to a plugin's status-bar items.
 * It copies Obsidian `1.15.1` exactly, including that only the first disallowed character is replaced.
 *
 * @param pluginId - The plugin id.
 * @returns The CSS class.
 */
export function getPluginStatusBarItemCssClass(pluginId: string): string {
  return `plugin-${pluginId.toLowerCase().replace(/[^_a-zA-Z0-9-]/, '-')}`;
}

/**
 * Shows one status-bar item in the main window and in every desktop popout, including popouts opened later, until
 * the owning component unloads.
 *
 * @param params - The {@link RegisterAllWindowsStatusBarItemParams}. The owner must be loaded.
 * @returns The {@link AllWindowsStatusBarItemComponent}. Call its {@link AllWindowsStatusBarItemComponent.refresh} to
 *   render every item again, or remove it from the owner to stop early.
 */
export function registerAllWindowsStatusBarItem(params: RegisterAllWindowsStatusBarItemParams): AllWindowsStatusBarItemComponent {
  const { component, ...constructorParams } = params;
  return component.addChild(new AllWindowsStatusBarItemComponent(constructorParams));
}
