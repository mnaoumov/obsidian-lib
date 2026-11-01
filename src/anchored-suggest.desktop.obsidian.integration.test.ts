/**
 * @file
 *
 * Desktop-only integration test proving, against real Obsidian, that {@link AnchoredSuggest} drives Obsidian's own suggest
 * popover with no input behind it: it opens below its anchor, the trusted arrow keys and Enter pick from it, and Escape
 * closes it. A phone keyboard has no arrow keys.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('AnchoredSuggest', () => {
  it('should open at an element and pick with the keyboard', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { AnchoredSuggest, pressKey, waitUntil } }) {
        class ColorSuggest extends AnchoredSuggest<string> {
          public readonly chosen: string[] = [];

          public renderSuggestion(value: string, el: HTMLElement): void {
            el.setText(value);
          }

          protected getSuggestions(query: string): string[] {
            return ['red', 'green', 'blue'].filter((color) => color.includes(query));
          }

          protected onChooseSuggestion(value: string): void {
            this.chosen.push(value);
          }
        }

        const anchorEl = activeDocument.body.createEl('button', { attr: { style: 'position: fixed; left: 40px; top: 40px;' }, text: 'Pick' });
        const suggest = new ColorSuggest(app);

        try {
          const wasOpened = await suggest.openAt({ anchor: anchorEl });
          await waitUntil({
            message: 'the popover lists the colors',
            predicate: () => suggest.suggestEl.querySelectorAll('.suggestion-item').length === 3
          });
          const isBelowAnchor = suggest.suggestEl.getBoundingClientRect().top >= anchorEl.getBoundingClientRect().bottom;
          // Electron names the arrow keys by their accelerator names.
          await pressKey({ key: 'Down' });
          await pressKey({ key: 'Enter' });
          await waitUntil({
            message: 'a color is chosen',
            predicate: () => suggest.chosen.length > 0
          });
          const isOpenAfterChoice = suggest.isOpen;

          await suggest.openAt({ anchor: anchorEl, query: 'r' });
          const itemCount = suggest.suggestEl.querySelectorAll('.suggestion-item').length;
          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'Escape closes the popover',
            predicate: () => !suggest.isOpen
          });

          return { chosen: suggest.chosen, isBelowAnchor, isOpenAfterChoice, itemCount, wasOpened };
        } finally {
          suggest.close();
          anchorEl.remove();
        }
      }
    });

    expect(result).toEqual({ chosen: ['green'], isBelowAnchor: true, isOpenAfterChoice: false, itemCount: 2, wasOpened: true });
  });
});
