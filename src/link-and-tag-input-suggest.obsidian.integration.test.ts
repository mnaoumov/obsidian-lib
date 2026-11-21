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

  it('should highlight the matched tag characters past the #', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { LinkAndTagInputSuggest, pressKey, waitUntil } }) {
        const tag = 'tagHighlightProbe';
        const note = await app.vault.create('link-and-tag-input-suggest-tag-probe.md', `#${tag}\n`);
        const inputEl = activeDocument.body.createEl('input');
        const suggest = new LinkAndTagInputSuggest({ app, inputEl });

        try {
          await waitUntil({
            message: 'the metadata cache indexes the probe tag',
            predicate: () => app.metadataCache.getFileCache(note)?.tags?.some((tagCache) => tagCache.tag === `#${tag}`) ?? false
          });
          inputEl.focus();
          for (const key of ['#', 'h', 'i', 'g', 'h']) {
            await pressKey({ key });
          }
          let contentEl: Element | undefined;
          // The popover re-renders after each key, so it can list the tag for a shorter query first.
          await waitUntil({
            message: 'the suggest popover lists the probe tag for the whole query',
            predicate: () => {
              contentEl = [...activeDocument.querySelectorAll('.suggestion-content')].find((el) => el.textContent === `#${tag}`);
              return [...contentEl?.querySelectorAll(':scope .suggestion-highlight') ?? []].map((el) => el.textContent).join('').length === 'high'.length;
            },
            timeoutInMilliseconds: 10_000
          });

          return [...contentEl?.querySelectorAll(':scope .suggestion-highlight') ?? []].map((el) => el.textContent);
        } finally {
          suggest.close();
          inputEl.remove();
          await app.fileManager.trashFile(note);
        }
      }
    });

    expect(result).toEqual(['High']);
  });

  it('should highlight the matched link text characters in the title', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { LinkAndTagInputSuggest, pressKey, waitUntil } }) {
        const note = await app.vault.create('link-and-tag-input-suggest-link-highlight-probe.md', '');
        const inputEl = activeDocument.body.createEl('input');
        const suggest = new LinkAndTagInputSuggest({ app, inputEl });

        try {
          inputEl.focus();
          for (const key of ['[', '[', 'h', 'i', 'g', 'h', 'l', 'i', 'g', 'h', 't']) {
            await pressKey({ key });
          }
          let titleEl: Element | undefined;
          // The popover re-renders after each key, so it can list the note for a shorter query first.
          await waitUntil({
            message: 'the suggest popover lists the probe note for the whole query',
            predicate: () => {
              titleEl = [...activeDocument.querySelectorAll('.suggestion-title')].find((el) => el.textContent === 'link-and-tag-input-suggest-link-highlight-probe');
              return [...titleEl?.querySelectorAll(':scope .suggestion-highlight') ?? []].map((el) => el.textContent).join('').length === 'highlight'.length;
            },
            timeoutInMilliseconds: 10_000
          });

          return [...titleEl?.querySelectorAll(':scope .suggestion-highlight') ?? []].map((el) => el.textContent);
        } finally {
          suggest.close();
          inputEl.remove();
          await app.fileManager.trashFile(note);
        }
      }
    });

    expect(result).toEqual(['highlight']);
  });
});
