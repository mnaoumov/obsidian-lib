/**
 * @file
 *
 * Integration tests for {@link rerenderPreviews} in a real Reading view: a processor whose setting changed is applied by
 * the time the promise settles, a language refresh renders only that language's blocks, and the note, the inline title,
 * the properties and the scroll position survive.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface RerenderResult {
  readonly callsAfter: Readonly<Record<string, number>>;
  readonly callsBefore: Readonly<Record<string, number>>;
  readonly contentAfter: string;
  readonly contentBefore: string;
  readonly isInlineTitleKept: boolean;
  readonly isPropertiesKept: boolean;
  readonly mode: string;
  readonly renderedTexts: readonly string[];
  readonly scrollAfter: number;
  readonly scrollBefore: number;
  readonly unknownLanguageCalls: Readonly<Record<string, number>>;
}

describe('rerenderPreviews', () => {
  it.each([
    { expectedTexts: ['alpha:two', 'beta:two'], language: null, name: 'every block' },
    { expectedTexts: ['alpha:two', 'beta:one'], language: 'rerender-alpha', name: 'one language' }
  ])('should render $name again and keep the note, its header and its scroll', async ({ expectedTexts, language }) => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Two waits of 5 s each: the first render and the scroll.
      async callback({ app, language: languageToRender, lib: { rerenderPreviews, waitUntil }, obsidianModule }): Promise<RerenderResult> {
        const { MarkdownPreviewRenderer, MarkdownView } = obsidianModule;
        const plugin = app.plugins.getPlugin('obsidian-lib-integration-test');
        if (!plugin) {
          throw new Error('The harness plugin is not loaded.');
        }

        const LANGUAGES = ['rerender-alpha', 'rerender-beta'];
        const suffix = languageToRender ?? 'all';
        const notePath = `rerender-previews-${suffix}.md`;
        let setting = 'one';
        const calls: Record<string, number> = { 'rerender-alpha': 0, 'rerender-beta': 0 };
        const processors = LANGUAGES.map((lang) =>
          plugin.registerMarkdownCodeBlockProcessor(lang, (_source, el) => {
            calls[lang] = (calls[lang] ?? 0) + 1;
            el.createDiv({ cls: 'rerender-probe', text: `${lang.replace('rerender-', '')}:${setting}` });
          })
        );

        const paragraphs = Array.from({ length: 150 }, (_, index) => `Paragraph ${String(index)} with some words to wrap.`);
        const content = [
          '---',
          'status: draft',
          '---',
          '',
          '```rerender-alpha',
          'a',
          '```',
          '',
          '```rerender-beta',
          'b',
          '```',
          '',
          ...paragraphs,
          ''
        ].join('\n');
        const file = await app.vault.create(notePath, content);
        const leaf = app.workspace.getLeaf(true);
        try {
          await leaf.openFile(file, { active: true, state: { mode: 'preview' } });
          const view = leaf.view;
          if (!(view instanceof MarkdownView)) {
            throw new TypeError('expected a MarkdownView');
          }
          const { renderer } = view.previewMode;

          function readTexts(): string[] {
            return renderer.sections.flatMap((section) => Array.from(section.el.querySelectorAll('.rerender-probe'), (el) => el.textContent));
          }

          await waitUntil({
            message: 'The note did not render its code blocks.',
            predicate: () => readTexts().length === 2 && renderer.rendered === null
          });

          const SCROLL_TOP = 600;
          renderer.previewEl.scrollTop = SCROLL_TOP;
          await waitUntil({
            message: 'The Reading view did not scroll.',
            predicate: () => renderer.previewEl.scrollTop === SCROLL_TOP
          });

          const inlineTitleEl = view.inlineTitleEl;
          const propertiesEl = view.metadataEditor.containerEl;
          const callsBefore = { ...calls };
          const contentBefore = view.editor.getValue();
          const scrollBefore = renderer.previewEl.scrollTop;

          setting = 'two';
          await rerenderPreviews({ app, language: languageToRender });
          const renderedTexts = readTexts();
          const callsAfter = { ...calls };

          await rerenderPreviews({ app, language: 'rerender-unknown' });

          return {
            callsAfter,
            callsBefore,
            contentAfter: await app.vault.read(file),
            contentBefore,
            isInlineTitleKept: view.inlineTitleEl === inlineTitleEl && inlineTitleEl.isConnected,
            isPropertiesKept: view.metadataEditor.containerEl === propertiesEl && propertiesEl.isConnected,
            mode: view.getMode(),
            renderedTexts,
            scrollAfter: renderer.previewEl.scrollTop,
            scrollBefore,
            unknownLanguageCalls: { ...calls }
          };
        } finally {
          leaf.detach();
          for (const processor of processors) {
            MarkdownPreviewRenderer.unregisterPostProcessor(processor);
          }
          // The harness plugin stays loaded, so the language would stay taken for the next case.
          for (const lang of LANGUAGES) {
            MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor(lang);
          }
          if (await app.vault.adapter.exists(notePath)) {
            await app.vault.adapter.trashLocal(notePath);
          }
        }
      },
      input: { language }
    });

    expect(result.renderedTexts, 'the setting changed before the call is applied by the time it settles').toEqual(expectedTexts);
    expect(result.callsAfter['rerender-alpha']).toBe((result.callsBefore['rerender-alpha'] ?? 0) + 1);
    expect(result.callsAfter['rerender-beta'], 'a language refresh leaves other processors alone').toBe(
      (result.callsBefore['rerender-beta'] ?? 0) + (language === null ? 1 : 0)
    );
    expect(result.unknownLanguageCalls, 'a language no block uses renders nothing').toEqual(result.callsAfter);
    expect(result.contentAfter, 'the note is never written').toBe(result.contentBefore);
    expect(result.mode).toBe('preview');
    expect(result.isInlineTitleKept, 'the inline title keeps its element').toBe(true);
    expect(result.isPropertiesKept, 'the properties keep their element').toBe(true);
    expect(Math.abs(result.scrollAfter - result.scrollBefore), 'the scroll position is kept').toBeLessThanOrEqual(1);
  });
});
