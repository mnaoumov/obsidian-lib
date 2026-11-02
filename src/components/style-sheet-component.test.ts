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
import { Component } from 'obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  registerStyle,
  StyleSheetComponent
} from './style-sheet-component.ts';

interface MockApp {
  readonly app: App;
  readonly trigger: (name: string, win: Window) => void;
}

type WindowEventCallback = (workspaceWindow: WorkspaceWindow, win: Window) => void;

class FakeStyleSheet {
  public text = '';

  public replaceSync(text: string): void {
    this.text = text;
  }
}

function createMockApp(popoutWindows: Window[] = []): MockApp {
  const callbacks = new Map<string, WindowEventCallback>();
  const leaves = popoutWindows.map((win) =>
    strictProxy<WorkspaceLeaf>({
      getContainer: (): WorkspaceContainer => strictProxy<WorkspaceContainer>({ win })
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
        callbacks.set(name, callback);
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's EventRef shape names its emitter `e`, which Component.unload reads.
        return castTo<EventRef>({ e: { offref: vi.fn() } });
      }),
      onLayoutReady: (callback: () => void): void => {
        callback();
      }
    }
  });

  return {
    app,
    trigger: (name, win): void => {
      callbacks.get(name)?.(strictProxy<WorkspaceWindow>({ win }), win);
    }
  };
}

function createPopoutWindow(): Window {
  return strictProxy<typeof window>({
    CSSStyleSheet: FakeStyleSheet,
    document: { adoptedStyleSheets: [] }
  });
}

function getMainWindowSelectors(): string[] {
  return document.adoptedStyleSheets.flatMap((sheet) => Array.from(sheet.cssRules, (rule) => (rule as CSSStyleRule).selectorText));
}

function getSheetTexts(win: Window): string[] {
  return win.document.adoptedStyleSheets.map((sheet) => castTo<FakeStyleSheet>(sheet).text);
}

describe('StyleSheetComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'adoptedStyleSheets', { configurable: true, value: [], writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'adoptedStyleSheets');
  });

  it('should attach the stylesheet to the main window on load', () => {
    const { app } = createMockApp();
    const component = new StyleSheetComponent({ app, css: '.a { color: red; }' });
    component.load();

    expect(getMainWindowSelectors()).toEqual(['.a']);
    expect(component.css).toBe('.a { color: red; }');
  });

  it('should keep stylesheets adopted by others', () => {
    const otherSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [otherSheet];
    const { app } = createMockApp();
    const component = new StyleSheetComponent({ app, css: '.a {}' });
    component.load();
    component.unload();

    expect(document.adoptedStyleSheets).toEqual([otherSheet]);
  });

  it('should attach a sheet built in each existing popout window realm after layout ready', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([activeWindow, popout]);
    new StyleSheetComponent({ app, css: '.b {}' }).load();
    vi.runAllTimers();

    expect(getSheetTexts(popout)).toEqual(['.b {}']);
    expect(document.adoptedStyleSheets).toHaveLength(1);
  });

  it('should attach to popouts opened later', () => {
    const { app, trigger } = createMockApp();
    new StyleSheetComponent({ app, css: '.c {}' }).load();
    vi.runAllTimers();

    const popout = createPopoutWindow();
    trigger('window-open', popout);

    expect(getSheetTexts(popout)).toEqual(['.c {}']);
  });

  it('should not attach twice to the same window', () => {
    const popout = createPopoutWindow();
    const { app, trigger } = createMockApp([popout]);
    new StyleSheetComponent({ app, css: '.d {}' }).load();
    vi.runAllTimers();
    trigger('window-open', popout);

    expect(getSheetTexts(popout)).toEqual(['.d {}']);
  });

  it('should remove the stylesheet from every window on unload', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    const component = new StyleSheetComponent({ app, css: '.e {}' });
    component.load();
    vi.runAllTimers();
    component.unload();

    expect(document.adoptedStyleSheets).toEqual([]);
    expect(popout.document.adoptedStyleSheets).toEqual([]);
  });

  it('should forget a closed popout and not touch its document on unload', () => {
    const popout = createPopoutWindow();
    const { app, trigger } = createMockApp([popout]);
    const component = new StyleSheetComponent({ app, css: '.f {}' });
    component.load();
    vi.runAllTimers();
    trigger('window-close', popout);
    component.unload();

    expect(getSheetTexts(popout)).toEqual(['.f {}']);
  });

  it('should replace the CSS in every window on setCss', () => {
    const popout = createPopoutWindow();
    const { app } = createMockApp([popout]);
    const component = new StyleSheetComponent({ app, css: '.g {}' });
    component.load();
    vi.runAllTimers();
    component.setCss('.h {}');

    expect(component.css).toBe('.h {}');
    expect(getSheetTexts(popout)).toEqual(['.h {}']);
    expect(getMainWindowSelectors()).toEqual(['.h']);
  });

  it('should attach new windows with the CSS set before they opened', () => {
    const { app, trigger } = createMockApp();
    const component = new StyleSheetComponent({ app, css: '.i {}' });
    component.load();
    vi.runAllTimers();
    component.setCss('.j {}');

    const popout = createPopoutWindow();
    trigger('window-open', popout);

    expect(getSheetTexts(popout)).toEqual(['.j {}']);
  });
});

describe('registerStyle', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'adoptedStyleSheets', { configurable: true, value: [], writable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'adoptedStyleSheets');
  });

  it('should attach while the owner is loaded and remove on its unload', () => {
    const { app } = createMockApp();
    const owner = new Component();
    owner.load();

    const styleSheetComponent = registerStyle({ app, component: owner, css: '.k {}' });

    expect(styleSheetComponent).toBeInstanceOf(StyleSheetComponent);
    expect(document.adoptedStyleSheets).toHaveLength(1);

    owner.unload();

    expect(document.adoptedStyleSheets).toEqual([]);
  });
});
