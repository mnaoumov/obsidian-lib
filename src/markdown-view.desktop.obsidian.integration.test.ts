/**
 * @file
 *
 * Desktop integration tests for {@link rerenderPreviews}: Reading views open side by side and in a popout window are all
 * rendered again by the time the promise settles, and a Reading view in a background tab renders the change once it is
 * shown. Popout windows and splits exist on desktop only.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface WindowsResult {
  readonly backgroundTextAfterShown: null | string;
  readonly backgroundTextWhenSettled: null | string;
  readonly mainTexts: readonly (null | string)[];
  readonly popoutText: null | string;
  readonly popoutWindowIsSeparate: boolean;
}

describe('rerenderPreviews', () => {
  it('should render side-by-side and popout Reading views before settling, and a background tab once shown', async () => {
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Three waits of 5 s each: first render, popout, background tab.
      async callback({ app, lib: { rerenderPreviews, waitUntil }, obsidianModule }): Promise<WindowsResult> {
        const { MarkdownPreviewRenderer, MarkdownView } = obsidianModule;
        const plugin = app.plugins.getPlugin('obsidian-lib-integration-test');
        if (!plugin) {
          throw new Error('The harness plugin is not loaded.');
        }

        const LANGUAGE = 'rerender-windows';
        const notePath = 'rerender-previews-windows.md';
        let setting = 'one';
        const processor = plugin.registerMarkdownCodeBlockProcessor(LANGUAGE, (_source, el) => {
          el.createDiv({ cls: 'rerender-probe', text: setting });
        });

        const file = await app.vault.create(notePath, `# Note\n\n\`\`\`${LANGUAGE}\nx\n\`\`\`\n`);
        const leaves = [app.workspace.getLeaf('tab'), app.workspace.getLeaf('split'), app.workspace.openPopoutLeaf()];
        try {
          const views: InstanceType<typeof MarkdownView>[] = [];
          for (const leaf of leaves) {
            await leaf.openFile(file, { active: true, state: { mode: 'preview' } });
            if (!(leaf.view instanceof MarkdownView)) {
              throw new TypeError('expected a MarkdownView');
            }
            views.push(leaf.view);
          }
          const [first, second, popout] = views;
          if (!first || !second || !popout) {
            throw new Error('expected three views');
          }

          function readText(view: InstanceType<typeof MarkdownView>): null | string {
            for (const section of view.previewMode.renderer.sections) {
              const probe = section.el.querySelector('.rerender-probe');
              if (probe) {
                return probe.textContent;
              }
            }
            return null;
          }

          await waitUntil({
            message: 'The views did not render the block.',
            predicate: () => views.every((view) => readText(view) === 'one' && view.previewMode.renderer.rendered === null)
          });

          // A background tab beside the first view: its preview is hidden, so it renders only once it is shown again.
          app.workspace.setActiveLeaf(first.leaf, { focus: false });
          const backgroundLeaf = app.workspace.getLeaf('tab');
          leaves.push(backgroundLeaf);
          await backgroundLeaf.openFile(file, { active: true, state: { mode: 'preview' } });
          const background = backgroundLeaf.view;
          if (!(background instanceof MarkdownView)) {
            throw new TypeError('expected a MarkdownView');
          }
          await waitUntil({
            message: 'The background view did not render the block.',
            predicate: () => readText(background) === 'one' && background.previewMode.renderer.rendered === null
          });
          app.workspace.setActiveLeaf(first.leaf, { focus: false });

          setting = 'two';
          await rerenderPreviews({ app });

          const mainTexts = [readText(first), readText(second)];
          const popoutText = readText(popout);
          const backgroundTextWhenSettled = readText(background);

          app.workspace.setActiveLeaf(backgroundLeaf, { focus: false });
          await waitUntil({
            message: 'The background view did not render again once shown.',
            predicate: () => readText(background) === 'two'
          });

          return {
            backgroundTextAfterShown: readText(background),
            backgroundTextWhenSettled,
            mainTexts,
            popoutText,
            popoutWindowIsSeparate: popout.containerEl.win !== window
          };
        } finally {
          for (const leaf of leaves) {
            leaf.detach();
          }
          MarkdownPreviewRenderer.unregisterPostProcessor(processor);
          // The harness plugin stays loaded, so the language would stay taken for the next run.
          MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor(LANGUAGE);
          if (await app.vault.adapter.exists(notePath)) {
            await app.vault.adapter.trashLocal(notePath);
          }
        }
      }
    });

    expect(result.popoutWindowIsSeparate).toBe(true);
    expect(result.mainTexts, 'side-by-side views render before the promise settles').toEqual(['two', 'two']);
    expect(result.popoutText, 'a popout view renders before the promise settles').toBe('two');
    expect(result.backgroundTextWhenSettled, 'a hidden view is not rendered while hidden').toBeNull();
    expect(result.backgroundTextAfterShown, 'a hidden view renders the change once shown').toBe('two');
  });
});
