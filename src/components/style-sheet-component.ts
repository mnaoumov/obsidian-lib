/**
 * @file
 *
 * Attaches a plugin stylesheet to the main window and every popout window, including popouts opened later, and
 * removes it on unload.
 *
 * The stylesheet is a constructed `CSSStyleSheet` adopted through `document.adoptedStyleSheets`, so the plugin
 * creates no `<style>` element (which the community review flags) and adds no CSS snippet to the user's list.
 * A constructed sheet can be adopted only by a document of the realm that constructed it, so each window gets its
 * own sheet, built with that window's `CSSStyleSheet` constructor. Constructable stylesheets need Electron 28 or
 * iOS 16.4, both below the oldest runtime Obsidian supports.
 */

import type {
  App,
  Component
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';

import { AllWindowsEventComponent } from './all-windows-event-component.ts';
import { ComponentEx } from './component-ex.ts';

/**
 * Parameters for {@link registerStyle}.
 */
export interface RegisterStyleParams extends StyleSheetComponentConstructorParams {
  /**
   * The component that owns the stylesheet: the stylesheet is removed when it unloads.
   */
  readonly component: Component;
}

/**
 * Parameters for the {@link StyleSheetComponent} constructor.
 */
export interface StyleSheetComponentConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The CSS to attach.
   */
  readonly css: string;
}

/**
 * Attaches a stylesheet to the main window and every popout window while loaded.
 */
export class StyleSheetComponent extends ComponentEx {
  /**
   * The CSS currently attached.
   *
   * @returns The CSS.
   */
  public get css(): string {
    return this._css;
  }

  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  private _css: string;
  private readonly styleSheetsByWindow = new Map<Window, CSSStyleSheet>();

  /**
   * Creates a new instance of the `StyleSheetComponent` class.
   *
   * @param params - The {@link StyleSheetComponentConstructorParams}.
   */
  public constructor(params: StyleSheetComponentConstructorParams) {
    super();
    this.app = params.app;
    this._css = params.css;
  }

  /**
   * Attaches the stylesheet to every window, now and as popouts open.
   */
  public override onload(): void {
    super.onload();

    this.register(() => {
      for (const [win, styleSheet] of this.styleSheetsByWindow) {
        win.document.adoptedStyleSheets = win.document.adoptedStyleSheets.filter((sheet) => sheet !== styleSheet);
      }
      this.styleSheetsByWindow.clear();
    });

    this.registerEvent(this.app.workspace.on('window-close', (_workspaceWindow, win) => {
      this.styleSheetsByWindow.delete(win);
    }));

    const allWindowsEventComponent = this.addChild(new AllWindowsEventComponent(this.app));
    allWindowsEventComponent.registerAllWindowsHandler((win) => {
      this.attach(win);
    });
  }

  /**
   * Replaces the attached CSS in every window.
   *
   * @param css - The new CSS.
   */
  public setCss(css: string): void {
    this._css = css;
    for (const styleSheet of this.styleSheetsByWindow.values()) {
      styleSheet.replaceSync(css);
    }
  }

  private attach(win: Window): void {
    if (this.styleSheetsByWindow.has(win)) {
      return;
    }

    const styleSheet = new (castTo<typeof window>(win).CSSStyleSheet)();
    styleSheet.replaceSync(this._css);
    win.document.adoptedStyleSheets = [...win.document.adoptedStyleSheets, styleSheet];
    this.styleSheetsByWindow.set(win, styleSheet);
  }
}

/**
 * Attaches a stylesheet to the main window and every popout window, including popouts opened later, until the
 * owning component unloads.
 *
 * @param params - The {@link RegisterStyleParams}.
 * @returns The {@link StyleSheetComponent}, whose {@link StyleSheetComponent.setCss} replaces the CSS.
 */
export function registerStyle(params: RegisterStyleParams): StyleSheetComponent {
  const { app, component, css } = params;
  return component.addChild(new StyleSheetComponent({ app, css }));
}
