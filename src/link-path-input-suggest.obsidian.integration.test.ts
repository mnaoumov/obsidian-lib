/**
 * @file
 *
 * Proves, against real Obsidian, that {@link LinkPathInputSuggest} attached to an {@link editFieldsInPopover} field
 * through its `onCreate` hook completes a note and then one of its headings, with trusted input: a click picks the
 * note without dismissing the popover, Enter picks the heading without confirming it, and only the next Enter
 * confirms the popover with the completed link path.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { LinkPathInputSuggest } from './link-path-input-suggest.ts';

interface PickResult {
  readonly afterHeadingPick: string;
  readonly afterNotePick: string;
  readonly isPopoverOpenAfterHeadingPick: boolean;
  readonly isPopoverOpenAfterNotePick: boolean;
  readonly resolved: null | Record<string, string>;
}

describe('LinkPathInputSuggest', () => {
  it('should complete a note and then its heading inside a field popover', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { clickElement, createAnchorFromPoint, editFieldsInPopover, LinkPathInputSuggest, pressKey, waitUntil }
      }): Promise<PickResult> {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 4000;
        const ANCHOR_X_IN_PIXELS = 60;
        const ANCHOR_Y_IN_PIXELS = 60;
        const noteBaseName = 'link-path-input-suggest-probe';
        const note = await app.vault.create(`${noteBaseName}.md`, '# First heading\n\ntext\n\n## Second heading\n\nmore\n');
        const suggests: LinkPathInputSuggest[] = [];

        try {
          await waitUntil({
            message: 'the metadata cache indexes the probe headings',
            predicate: () => app.metadataCache.getFileCache(note)?.headings?.length === 2,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const resultPromise = editFieldsInPopover({
            anchor: createAnchorFromPoint(ANCHOR_X_IN_PIXELS, ANCHOR_Y_IN_PIXELS, activeDocument),
            fields: [{
              key: 'target',
              name: 'Target',
              onCreate(textComponent): void {
                suggests.push(new LinkPathInputSuggest({ app, inputEl: textComponent.inputEl }));
              }
            }]
          });

          await waitUntil({
            message: 'the popover renders its field',
            predicate: () => Boolean(getInputEl()),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          for (const key of 'path-input-suggest-pro') {
            await pressKey({ key });
          }

          let noteItemEl: HTMLElement | undefined;
          await waitUntil({
            message: 'the suggest lists the probe note',
            predicate: () => {
              noteItemEl = getSuggestionItems().find((el) => el.querySelector('.suggestion-title')?.textContent === noteBaseName);
              return Boolean(noteItemEl);
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          if (!noteItemEl) {
            throw new Error('The probe note is not suggested');
          }
          // The suggest list overlaps the popover, so it must paint above it, or the click lands on the popover's buttons.
          const itemRect = noteItemEl.getBoundingClientRect();
          const hitEl = activeDocument.elementFromPoint(itemRect.left + itemRect.width / 2, itemRect.top + itemRect.height / 2);
          if (!noteItemEl.contains(hitEl)) {
            throw new Error(`The suggestion is covered by ${hitEl?.className ?? 'nothing'}`);
          }
          await clickElement({ element: noteItemEl });
          await waitUntil({
            message: 'the click picks the probe note',
            predicate: () => getInputEl()?.value === noteBaseName,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const afterNotePick = getInputEl()?.value ?? '';
          const isPopoverOpenAfterNotePick = Boolean(getPopoverEl());

          for (const key of '#second') {
            await pressKey({ key });
          }
          await waitUntil({
            message: 'the suggest lists the second heading alone',
            predicate: () => {
              const titles = getSuggestionItems().map((el) => el.querySelector('.suggestion-title')?.textContent);
              return titles.length === 1 && titles[0] === 'Second heading';
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await pressKey({ key: 'Enter' });
          await waitUntil({
            message: 'Enter picks the heading',
            predicate: () => getInputEl()?.value === `${noteBaseName}#Second heading`,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const afterHeadingPick = getInputEl()?.value ?? '';
          const isPopoverOpenAfterHeadingPick = Boolean(getPopoverEl());

          await pressKey({ key: 'Enter' });
          const resolved = await resultPromise;

          return { afterHeadingPick, afterNotePick, isPopoverOpenAfterHeadingPick, isPopoverOpenAfterNotePick, resolved };
        } finally {
          for (const suggest of suggests) {
            suggest.close();
          }
          getPopoverEl()?.querySelector<HTMLButtonElement>('.cancel-button')?.click();
          await app.fileManager.trashFile(note);
        }

        function getInputEl(): HTMLInputElement | null {
          return getPopoverEl()?.querySelector('input') ?? null;
        }

        function getPopoverEl(): HTMLElement | null {
          return activeDocument.body.querySelector<HTMLElement>('.obsidian-lib.popover');
        }

        function getSuggestionItems(): HTMLElement[] {
          return [...activeDocument.body.querySelectorAll<HTMLElement>(':scope > .suggestion-container .suggestion-item')];
        }
      }
    });

    expect(result.afterNotePick).toBe('link-path-input-suggest-probe');
    expect(result.isPopoverOpenAfterNotePick).toBe(true);
    expect(result.afterHeadingPick).toBe('link-path-input-suggest-probe#Second heading');
    expect(result.isPopoverOpenAfterHeadingPick).toBe(true);
    expect(result.resolved).toStrictEqual({ target: 'link-path-input-suggest-probe#Second heading' });
  });
});
