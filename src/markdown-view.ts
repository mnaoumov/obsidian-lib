/**
 * @file
 *
 * Utilities for working with MarkdownView
 */

import type { RendererSection } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  MarkdownPreviewView
} from 'obsidian';

import { onAbort } from '@mnaoumov/typescript-lib/abort-controller';
import { noop } from '@mnaoumov/typescript-lib/function';
import {
  Component,
  MarkdownView
} from 'obsidian';

/**
 * Options for {@link rerenderPreviews}.
 */
export interface RerenderPreviewsParams {
  /**
   * Stops waiting for the renders when aborted, rejecting with the signal's reason. The renders already requested still
   * happen.
   */
  readonly abortSignal?: AbortSignal;

  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * The code block language whose blocks to render again, matched exactly and case-sensitively, the way Obsidian matches a
   * code block processor's language. Only the sections holding such a block are rendered again, and a view holding none
   * is left alone.
   *
   * @default `null`, which renders every section of every Reading view again
   */
  readonly language?: null | string;
}

/**
 * Get the full HTML content of the current MarkdownView
 *
 * @param view - The MarkdownView to get the HTML from
 * @returns The full HTML of the MarkdownView
 */
export function getFullContentHtml(view: MarkdownView): string {
  const codeMirror = view.editor.cm;
  codeMirror.viewState.printing = true;
  codeMirror.measure();
  const html = view.contentEl.innerHTML;
  codeMirror.viewState.printing = false;
  codeMirror.measure();
  return html;
}

/**
 * Renders the open Reading views again, so a markdown post-processor or code block processor registered or reconfigured
 * since they rendered applies to them.
 *
 * It covers every Markdown view in every window, popouts included. A full refresh is what Obsidian itself does when a
 * post-processor is registered: every section is rendered again, except the header holding the inline title and the
 * properties, and the footer holding the backlinks, which keep their DOM. With a `language`, only the sections holding a
 * code block of that language are rendered again. The note is never written, the view mode never changes, and the
 * scroll position is kept by Obsidian's renderer.
 *
 * The promise settles once every view SHOWN in Reading view has finished rendering, the promises of asynchronous
 * post-processors included. A preview that is not shown (a background tab, a view in editing mode) is marked to render
 * again when it is next shown, and is not waited for, since Obsidian does not render it until then. A view that is closed,
 * hidden or switched out of Reading view while rendering stops being waited for. A post-processor whose promise never
 * settles, or rejects, keeps its view's render open, exactly as it keeps Obsidian's own render open; pass an
 * `abortSignal` to bound the wait.
 *
 * Hover popovers, embeds, canvas cards and Live Preview widgets are not refreshed.
 *
 * @param params - The options.
 * @returns A promise that resolves once the shown Reading views have rendered.
 */
export async function rerenderPreviews(params: RerenderPreviewsParams): Promise<void> {
  const { abortSignal, app, language = null } = params;
  abortSignal?.throwIfAborted();

  const views: MarkdownView[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView) {
      views.push(leaf.view);
    }
  });

  const waits: Promise<void>[] = [];
  for (const view of views) {
    const isShown = isPreviewShown(view);
    // Emptying the sections shrinks the content before the next frame renders it again, which can clamp the scroll.
    const scroll = isShown ? view.previewMode.getScroll() : null;
    if (language === null) {
      view.previewMode.rerender(true);
    } else {
      const sections = getSectionsWithLanguage(view.previewMode, language);
      if (sections.length === 0) {
        continue;
      }
      rerenderSections(view.previewMode, sections);
    }

    if (scroll !== null) {
      waits.push(waitForPreviewRender(app, view, scroll));
    }
  }

  if (waits.length === 0) {
    return;
  }

  const allRendered = Promise.all(waits);
  if (!abortSignal) {
    await allRendered;
    return;
  }

  let resolveAborted = noop;
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve;
  });
  using _abortListener = onAbort(abortSignal, () => {
    resolveAborted();
  });
  await Promise.race([allRendered, aborted]);
  abortSignal.throwIfAborted();
}

function getSectionsWithLanguage(previewMode: MarkdownPreviewView, language: string): RendererSection[] {
  const { renderer } = previewMode;
  const selector = `code.language-${CSS.escape(language)}`;
  const parser = new DOMParser();
  // The header and footer carry no HTML of their own. A section's HTML is parsed into an inert document: nothing runs
  // and nothing loads.
  return renderer.sections.filter((section) =>
    section !== renderer.header && section !== renderer.footer && !!section.html
    && parser.parseFromString(section.html, 'text/html').querySelector(selector) !== null
  );
}

function isPreviewShown(view: MarkdownView): boolean {
  if (view.getMode() !== 'preview') {
    return false;
  }

  // The same visibility test `ReadViewRenderer.onRender` makes before it renders anything.
  const { previewEl } = view.previewMode.renderer;
  return previewEl.isConnected && previewEl.offsetParent !== null && previewEl.offsetWidth > 0;
}

function rerenderSections(previewMode: MarkdownPreviewView, sections: readonly RendererSection[]): void {
  for (const section of sections) {
    section.rendered = false;
    section.el.empty();
  }
  previewMode.renderer.queueRender();
}

async function waitForPreviewRender(app: App, view: MarkdownView, scroll: number): Promise<void> {
  const { previewMode } = view;
  const isRendered = await new Promise<boolean>((resolve) => {
    let isSettled = false;
    const watcher = new Component();

    function settle(isRenderedNow: boolean): void {
      if (isSettled) {
        return;
      }
      isSettled = true;
      // A no-op when the preview is unloading, since it has already taken the watcher off its children.
      previewMode.removeChild(watcher);
      resolve(isRenderedNow);
    }

    function settleIfHidden(): void {
      if (!isPreviewShown(view)) {
        settle(false);
      }
    }

    watcher.register(() => {
      settle(false);
    });
    watcher.registerEvent(app.workspace.on('layout-change', settleIfHidden));
    watcher.registerEvent(app.workspace.on('active-leaf-change', settleIfHidden));
    previewMode.addChild(watcher);
    previewMode.renderer.onRendered(() => {
      settle(true);
    });
  });

  if (isRendered) {
    previewMode.applyScroll(scroll);
  }
}
