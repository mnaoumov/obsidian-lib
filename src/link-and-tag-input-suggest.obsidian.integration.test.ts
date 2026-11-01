/**
 * @file
 *
 * Proves, against real Obsidian, that {@link LinkAndTagInputSuggest} drives Obsidian's own suggest popover from a
 * `<textarea>`, which Obsidian's `AbstractInputSuggest` does not accept by type, and that a trusted Enter inserts the
 * chosen link at the caret.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('LinkAndTagInputSuggest', () => {
  it('should complete a link typed into a textarea', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { LinkAndTagInputSuggest, pressKey, waitUntil } }) {
        const notePath = 'link-and-tag-input-suggest-probe.md';
        const note = await app.vault.create(notePath, '');
        const textAreaEl = activeDocument.body.createEl('textarea');
        const suggest = new LinkAndTagInputSuggest({ app, inputEl: textAreaEl });

        try {
          textAreaEl.focus();
          for (const key of ['a', ' ', '[', '[', 'p', 'r', 'o', 'b', 'e']) {
            await pressKey({ key });
          }
          await waitUntil({
            message: 'the suggest popover lists the probe note',
            predicate: () => [...activeDocument.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes('link-and-tag-input-suggest-probe')),
            timeoutInMilliseconds: 10_000
          });
          await pressKey({ key: 'Enter' });
          await waitUntil({
            message: 'the link is inserted',
            predicate: () => textAreaEl.value.includes(']]')
          });

          return { caret: textAreaEl.selectionStart, value: textAreaEl.value };
        } finally {
          suggest.close();
          textAreaEl.remove();
          await app.fileManager.trashFile(note);
        }
      }
    });

    expect(result.value).toBe('a [[link-and-tag-input-suggest-probe]]');
    expect(result.caret).toBe(result.value.length);
  });
});
