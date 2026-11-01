/**
 * @file
 *
 * Integration tests for the code block render handoff: a code block that rewrites its own source gets its state and
 * focus back in the render Obsidian makes from the new source, in Reading view and in Live Preview.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface HandoffResult {
  readonly isNewInputFocused: boolean;
  readonly isOldElementDetached: boolean;
  readonly isRestored: boolean | null;
  readonly renderCount: number;
  readonly selection: readonly (null | number)[];
  readonly state: unknown;
}

describe('code-block-render-handoff', () => {
  it.each([
    { isLivePreview: false, name: 'Reading view' },
    { isLivePreview: true, name: 'Live Preview' }
  ])('should carry state and focus to the next render in $name', async ({ isLivePreview }) => {
    const suffix = isLivePreview ? 'live-preview' : 'reading-view';
    const result = await evalInObsidian({
      // Under the transport's ~30s per-closure cap, not at it. Three waits of 5 s each, one per render step.
      async callback({ app, isLivePreview: shouldUseLivePreview, language, lib: { castTo, claimCodeBlockRenderHandoff, replaceCodeBlock, waitUntil }, notePath, obsidianModule }): Promise<HandoffResult> {
        const { MarkdownPreviewRenderer, MarkdownView } = obsidianModule;
        const plugin = app.plugins.getPlugin('obsidian-lib-integration-test');
        if (!plugin) {
          throw new Error('The harness plugin is not loaded.');
        }

        interface Render {
          readonly el: HTMLElement;
          readonly source: string;
        }

        interface Claim {
          readonly isRestored: boolean;
          readonly state: unknown;
        }

        const renders: Render[] = [];
        const claims = new Map<HTMLElement, Claim>();
        const processor = plugin.registerMarkdownCodeBlockProcessor(language, async (source, el, context) => {
          el.createDiv().createEl('input', { type: 'text', value: source });
          renders.push({ el, source });
          const handoff = claimCodeBlockRenderHandoff({ context, el, source });
          if (!handoff) {
            return;
          }

          claims.set(el, { isRestored: await handoff.restoreFocus(), state: handoff.state });
        });

        const file = await app.vault.create(notePath, `# Note\n\n\`\`\`${language}\ncount: 1\n\`\`\`\n`);
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

          // A view in Reading mode still keeps its hidden editor, which renders the block too: only the copy in the
          // shown mode can hold the focus.
          const shownModeSelector = shouldUseLivePreview ? '.markdown-source-view' : '.markdown-reading-view';
          function isShown(render: Render): boolean {
            return render.el.isConnected && render.el.closest(shownModeSelector) !== null && view.containerEl.contains(render.el);
          }

          await waitUntil({
            message: 'The code block was not rendered.',
            predicate: () => renders.some((render) => isShown(render))
          });
          const oldRender = renders.find((render) => isShown(render));
          if (!oldRender) {
            throw new Error('No connected render.');
          }
          const oldInput = oldRender.el.querySelector('input');
          if (!oldInput) {
            throw new Error('No input in the render.');
          }
          oldInput.focus();
          oldInput.setSelectionRange(2, 5);
          const renderCountBefore = renders.length;

          await replaceCodeBlock({
            app,
            codeBlockProvider: `\`\`\`${language}\ncount: 2\n\`\`\``,
            context: castTo<Parameters<typeof replaceCodeBlock>[0]['context']>({ sourcePath: notePath }),
            el: oldRender.el,
            nextRenderState: { clicks: 1 },
            resourceLockComponent: null,
            shouldCarryFocusToNextRender: true,
            source: oldRender.source
          });

          await waitUntil({
            message: 'The new render did not claim the handoff.',
            predicate: () => renders.slice(renderCountBefore).some((render) => claims.has(render.el))
          });
          const newRender = renders.slice(renderCountBefore).find((render) => claims.has(render.el));
          const newClaim = newRender ? claims.get(newRender.el) : undefined;
          const newInput = newRender?.el.querySelector('input') ?? null;

          return {
            isNewInputFocused: newInput !== null && newInput.ownerDocument.activeElement === newInput,
            isOldElementDetached: !oldRender.el.isConnected,
            isRestored: newClaim?.isRestored ?? null,
            renderCount: renders.length - renderCountBefore,
            selection: [newInput?.selectionStart ?? null, newInput?.selectionEnd ?? null],
            state: newClaim?.state
          };
        } finally {
          leaf.detach();
          MarkdownPreviewRenderer.unregisterPostProcessor(processor);
          if (await app.vault.adapter.exists(notePath)) {
            await app.vault.adapter.trashLocal(notePath);
          }
        }
      },
      input: {
        isLivePreview,
        language: `handoff-test-${suffix}`,
        notePath: `code-block-render-handoff-${suffix}.md`
      }
    });

    expect(result.isOldElementDetached).toBe(true);
    expect(result.state).toEqual({ clicks: 1 });
    expect(result.isRestored).toBe(true);
    expect(result.isNewInputFocused).toBe(true);
    expect(result.selection).toEqual([2, 5]);
    expect(result.renderCount).toBeGreaterThanOrEqual(1);
  });
});
