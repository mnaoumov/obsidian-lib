/**
 * @file
 *
 * Integration tests for {@link registerInlineTokenRenderer}: one definition renders a token in Reading view through
 * Obsidian's post processor pipeline, and in Live Preview through a real editor, where the cursor reveals it.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface InlineTokenResult {
  readonly renderedTexts: readonly string[];
  readonly revealedTexts: null | readonly string[];
  readonly sourcePaths: readonly string[];
}

describe('registerInlineTokenRenderer', () => {
  it.each([
    { isLivePreview: false, name: 'Reading view' },
    { isLivePreview: true, name: 'Live Preview' }
  ])('should render the tokens in $name', async ({ isLivePreview }) => {
    const suffix = isLivePreview ? 'live-preview' : 'reading-view';
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Two waits of 5 s each.
      async callback({ app, isLivePreview: shouldUseLivePreview, lib: { registerInlineTokenRenderer, waitUntil }, notePath, obsidianModule }): Promise<InlineTokenResult> {
        const { MarkdownPreviewRenderer, MarkdownView } = obsidianModule;
        const postProcessors: Parameters<typeof MarkdownPreviewRenderer.unregisterPostProcessor>[0][] = [];
        const extensions: Parameters<typeof app.workspace.unregisterEditorExtension>[0][] = [];
        const sourcePaths: string[] = [];

        registerInlineTokenRenderer({
          editorExtensionRegistrar: {
            registerEditorExtension(extension): void {
              extensions.push(extension);
              app.workspace.registerEditorExtension(extension);
            }
          },
          markdownPostProcessorRegistrar: {
            registerMarkdownPostProcessor({ postProcessor }): void {
              async function processor(element: HTMLElement, context: Parameters<typeof postProcessor>[1]): Promise<void> {
                await postProcessor(element, context);
              }
              postProcessors.push(processor);
              MarkdownPreviewRenderer.registerPostProcessor(processor);
            }
          },
          regExp: /::tok-(?<name>\w+)::/,
          render({ containerEl, match, sourcePath }): void {
            sourcePaths.push(sourcePath);
            containerEl.setText(`[${match[1] ?? ''}]`);
          }
        });

        const file = await app.vault.create(notePath, '# Note\n\nfirst ::tok-alpha:: and ::tok-beta::\n\n`::tok-code::`\n');
        const leaf = app.workspace.getLeaf(true);
        try {
          await leaf.openFile(file, {
            active: true,
            state: shouldUseLivePreview ? { mode: 'source', source: false } : { mode: 'preview' }
          });
          const view = leaf.view;
          if (!(view instanceof MarkdownView)) {
            throw new TypeError('expected a MarkdownView');
          }
          if (shouldUseLivePreview) {
            view.editor.setCursor({ ch: 0, line: 0 });
          }

          const shownModeSelector = shouldUseLivePreview ? '.markdown-source-view' : '.markdown-reading-view';
          function tokenTexts(): string[] {
            return Array.from(view.containerEl.querySelectorAll(`${shownModeSelector} .obsidian-lib.inline-token`), (el) => el.textContent);
          }

          await waitUntil({
            message: 'The tokens were not rendered.',
            predicate: () => tokenTexts().length >= 2
          });
          const renderedTexts = tokenTexts();

          let revealedTexts: null | string[] = null;
          if (shouldUseLivePreview) {
            view.editor.setCursor({ ch: 'first ::tok-'.length, line: 2 });
            await waitUntil({
              message: 'The token under the cursor was not revealed.',
              predicate: () => !tokenTexts().includes('[alpha]')
            });
            revealedTexts = tokenTexts();
          }

          return { renderedTexts, revealedTexts, sourcePaths: [...new Set(sourcePaths)] };
        } finally {
          leaf.detach();
          for (const processor of postProcessors) {
            MarkdownPreviewRenderer.unregisterPostProcessor(processor);
          }
          for (const extension of extensions) {
            app.workspace.unregisterEditorExtension(extension);
          }
          if (await app.vault.adapter.exists(notePath)) {
            await app.vault.adapter.trashLocal(notePath);
          }
        }
      },
      input: {
        isLivePreview,
        notePath: `inline-token-renderer-${suffix}.md`
      }
    });

    // In Reading view the inline code is skipped; Live Preview matches the source text, inline code included.
    expect(result.renderedTexts.slice(0, 2)).toEqual(['[alpha]', '[beta]']);
    if (!isLivePreview) {
      expect(result.renderedTexts).toEqual(['[alpha]', '[beta]']);
    }
    expect(result.sourcePaths).toEqual([`inline-token-renderer-${suffix}.md`]);
    if (!isLivePreview) {
      return;
    }

    expect(result.revealedTexts).not.toContain('[alpha]');
    expect(result.revealedTexts).toContain('[beta]');
  });
});
