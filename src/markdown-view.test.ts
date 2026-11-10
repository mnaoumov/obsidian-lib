// @vitest-environment jsdom

import type { RendererSection } from '@obsidian-typings/obsidian-public-latest';
import type {
  App as AppOriginal,
  MarkdownPreviewView as MarkdownPreviewViewOriginal,
  MarkdownView as MarkdownViewOriginal,
  View as ViewOriginal,
  WorkspaceLeaf as WorkspaceLeafOriginal
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { Component } from 'obsidian';
import {
  App,
  MarkdownView,
  WorkspaceLeaf
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getFullContentHtml,
  rerenderPreviews
} from './markdown-view.ts';

function createMockView(html: string): MarkdownViewOriginal {
  const measure = vi.fn();
  return strictProxy<MarkdownViewOriginal>({
    contentEl: { innerHTML: html },
    editor: {
      cm: {
        measure,
        viewState: { printing: false }
      }
    }
  });
}

describe('getFullContentHtml', () => {
  it('should return the innerHTML of contentEl', () => {
    const view = createMockView('<p>Hello</p>');
    expect(getFullContentHtml(view)).toBe('<p>Hello</p>');
  });

  it('should set printing to true then back to false', () => {
    const view = createMockView('<div>content</div>');
    const cm = view.editor.cm;
    getFullContentHtml(view);
    expect(cm.viewState.printing).toBe(false);
  });

  it('should call measure twice', () => {
    const view = createMockView('<div>content</div>');
    const cm = view.editor.cm;
    getFullContentHtml(view);

    expect(cm.measure).toHaveBeenCalledTimes(2);
  });

  it('should return empty string for empty content', () => {
    const view = createMockView('');
    expect(getFullContentHtml(view)).toBe('');
  });
});

interface PreviewElState {
  readonly isConnected: boolean;
  readonly offsetParent: null | object;
  readonly offsetWidth: number;
}

interface PreviewHarness {
  readonly applyScroll: ReturnType<typeof vi.fn>;
  readonly finishRender: () => void;
  readonly onRendered: ReturnType<typeof vi.fn>;
  readonly previewEl: PreviewElState;
  readonly previewMode: Component & MarkdownPreviewViewOriginal;
  readonly queueRender: ReturnType<typeof vi.fn>;
  readonly rerender: ReturnType<typeof vi.fn>;
  readonly sections: RendererSection[];
  readonly view: MarkdownViewOriginal;
}

interface PreviewOptions {
  readonly isShown?: boolean;
  readonly mode?: 'preview' | 'source';
  readonly sectionSources?: readonly string[];
}

const SCROLL = 42.5;

describe('rerenderPreviews', () => {
  let app: AppOriginal;
  let mockApp: App;

  beforeEach(() => {
    mockApp = App.createConfigured__({});
    app = mockApp.asOriginalType__();
  });

  it('should resolve at once when no Markdown view is open', async () => {
    stubLeaves(leafOf(strictProxy<ViewOriginal>({})));

    await expect(rerenderPreviews({ app })).resolves.toBeUndefined();
  });

  it('should render every Markdown view again and wait only for the shown Reading views', async () => {
    const shown = createPreview({});
    const editing = createPreview({ mode: 'source' });
    const background = createPreview({ isShown: false });
    stubLeaves(leafOf(shown.view), leafOf(editing.view), leafOf(background.view));

    let isResolved = false;
    const promise = rerenderPreviews({ app }).then(() => {
      isResolved = true;
    });

    expect(shown.rerender).toHaveBeenCalledWith(true);
    expect(editing.rerender).toHaveBeenCalledWith(true);
    expect(background.rerender).toHaveBeenCalledWith(true);
    expect(editing.onRendered).not.toHaveBeenCalled();
    expect(background.onRendered).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(isResolved).toBe(false);

    shown.finishRender();
    await promise;
    expect(isResolved).toBe(true);
    expect(shown.applyScroll).toHaveBeenCalledWith(SCROLL);
    expect(background.applyScroll).not.toHaveBeenCalled();
    expect(shown.previewMode._children).toEqual([]);
  });

  it('should treat a disconnected preview element as hidden', async () => {
    const preview = createPreview({});
    Object.assign(preview.previewEl, { isConnected: false });
    stubLeaves(leafOf(preview.view));

    await rerenderPreviews({ app });

    expect(preview.onRendered).not.toHaveBeenCalled();
  });

  it('should treat a preview element without width as hidden', async () => {
    const preview = createPreview({});
    Object.assign(preview.previewEl, { offsetWidth: 0 });
    stubLeaves(leafOf(preview.view));

    await rerenderPreviews({ app });

    expect(preview.onRendered).not.toHaveBeenCalled();
  });

  it('should render again only the sections holding a code block of the language', async () => {
    const preview = createPreview({
      sectionSources: [
        '<pre><code class="language-foo">a</code></pre>',
        '<pre><code class="language-foobar">b</code></pre>',
        '<p>text</p>',
        '<blockquote><pre><code class="language-foo">c</code></pre></blockquote>',
        '<pre><code class="language-Foo">d</code></pre>'
      ]
    });
    stubLeaves(leafOf(preview.view));

    const promise = rerenderPreviews({ app, language: 'foo' });
    preview.finishRender();
    await promise;

    expect(preview.rerender).not.toHaveBeenCalled();
    expect(preview.queueRender).toHaveBeenCalledTimes(1);
    expect(preview.sections.map((section) => section.rendered)).toEqual([true, false, true, true, false, true, true]);
    expect(preview.sections.map((section) => section.el.childElementCount)).toEqual([1, 0, 1, 1, 0, 1, 1]);
  });

  it('should escape a language that is not a plain CSS identifier', async () => {
    const preview = createPreview({ sectionSources: ['<pre><code class="language-c++">x</code></pre>'] });
    stubLeaves(leafOf(preview.view));

    const promise = rerenderPreviews({ app, language: 'c++' });
    preview.finishRender();
    await promise;

    expect(preview.sections[1]?.rendered).toBe(false);
  });

  it('should leave a view with no block of the language alone and resolve at once', async () => {
    const preview = createPreview({ sectionSources: ['<p>text</p>', ''] });
    stubLeaves(leafOf(preview.view));

    await rerenderPreviews({ app, language: 'foo' });

    expect(preview.queueRender).not.toHaveBeenCalled();
    expect(preview.onRendered).not.toHaveBeenCalled();
    expect(preview.sections.every((section) => section.rendered)).toBe(true);
  });

  it('should stop waiting for a view hidden while it renders', async () => {
    const preview = createPreview({});
    stubLeaves(leafOf(preview.view));

    let isResolved = false;
    const promise = rerenderPreviews({ app }).then(() => {
      isResolved = true;
    });
    await flushMicrotasks();
    app.workspace.trigger('layout-change');
    await flushMicrotasks();
    expect(isResolved).toBe(false);

    Object.assign(preview.previewEl, { offsetParent: null });
    app.workspace.trigger('active-leaf-change', null);
    await promise;
    expect(preview.applyScroll).not.toHaveBeenCalled();
    expect(preview.previewMode._children).toEqual([]);
  });

  it('should stop waiting for a view switched out of Reading view', async () => {
    const preview = createPreview({});
    stubLeaves(leafOf(preview.view));

    const promise = rerenderPreviews({ app });
    vi.spyOn(preview.view, 'getMode').mockReturnValue('source');
    app.workspace.trigger('layout-change');

    await expect(promise).resolves.toBeUndefined();
  });

  it('should stop waiting for a view closed while it renders', async () => {
    const preview = createPreview({});
    stubLeaves(leafOf(preview.view));

    const promise = rerenderPreviews({ app });
    preview.previewMode.unload();

    await expect(promise).resolves.toBeUndefined();
    expect(preview.applyScroll).not.toHaveBeenCalled();
  });

  it('should ignore a render that finishes after the view stopped being waited for', async () => {
    const preview = createPreview({});
    stubLeaves(leafOf(preview.view));

    const promise = rerenderPreviews({ app });
    preview.previewMode.unload();
    preview.finishRender();

    await expect(promise).resolves.toBeUndefined();
  });

  it('should reject at once when the signal is already aborted', async () => {
    const preview = createPreview({});
    stubLeaves(leafOf(preview.view));
    const reason = new Error('aborted');

    await expect(rerenderPreviews({ abortSignal: AbortSignal.abort(reason), app })).rejects.toBe(reason);
    expect(preview.rerender).not.toHaveBeenCalled();
  });

  it('should reject with the reason when aborted while waiting', async () => {
    const preview = createPreview({});
    stubLeaves(leafOf(preview.view));
    const abortController = new AbortController();
    const reason = new Error('stop');

    const promise = rerenderPreviews({ abortSignal: abortController.signal, app });
    abortController.abort(reason);

    await expect(promise).rejects.toBe(reason);
  });

  it('should resolve with a signal that is never aborted', async () => {
    const preview = createPreview({});
    stubLeaves(leafOf(preview.view));
    const abortController = new AbortController();

    const promise = rerenderPreviews({ abortSignal: abortController.signal, app });
    preview.finishRender();

    await expect(promise).resolves.toBeUndefined();
  });

  it('should resolve at once with a signal when nothing is shown', async () => {
    const preview = createPreview({ isShown: false });
    stubLeaves(leafOf(preview.view));

    await expect(rerenderPreviews({ abortSignal: new AbortController().signal, app })).resolves.toBeUndefined();
  });

  function createPreview(options: PreviewOptions): PreviewHarness {
    const { isShown = true, mode = 'preview', sectionSources = [] } = options;
    const previewEl: PreviewElState = {
      isConnected: isShown,
      offsetParent: isShown ? {} : null,
      offsetWidth: isShown ? 100 : 0
    };
    const header = createSection('');
    const footer = createSection('');
    const sections = [header, ...sectionSources.map((html) => createSection(html)), footer];
    const renderedCallbacks: (() => void)[] = [];
    const onRendered = vi.fn((callback: () => void) => {
      renderedCallbacks.push(callback);
    });
    const queueRender = vi.fn();
    const rerender = vi.fn();
    const applyScroll = vi.fn();
    const previewMode = castTo<Component & MarkdownPreviewViewOriginal>(Object.assign(new Component(), {
      applyScroll,
      getScroll: vi.fn(() => SCROLL),
      renderer: {
        footer,
        header,
        onRendered,
        previewEl,
        queueRender,
        sections
      },
      rerender
    }));
    previewMode.load();

    const view = MarkdownView.create2__(WorkspaceLeaf.create2__(mockApp)).asOriginalType7__();
    Object.defineProperty(view, 'previewMode', { value: previewMode });
    vi.spyOn(view, 'getMode').mockReturnValue(mode);

    return {
      applyScroll,
      finishRender(): void {
        for (const callback of renderedCallbacks.splice(0)) {
          callback();
        }
      },
      onRendered,
      previewEl,
      previewMode,
      queueRender,
      rerender,
      sections,
      view
    };
  }

  function createSection(html: string): RendererSection {
    const el = createDiv();
    el.createEl('p');
    return castTo<RendererSection>({ el, html, rendered: true });
  }

  function leafOf(view: ViewOriginal): WorkspaceLeafOriginal {
    return strictProxy<WorkspaceLeafOriginal>({ view });
  }

  function stubLeaves(...leaves: WorkspaceLeafOriginal[]): void {
    vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((callback) => {
      for (const leaf of leaves) {
        callback(leaf);
      }
    });
  }
});

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
