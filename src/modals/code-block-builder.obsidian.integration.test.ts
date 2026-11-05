/**
 * @file
 *
 * Integration tests for {@link showCodeBlockBuilder} against a live Obsidian instance.
 *
 * The unit tests drive mock components. This one clicks a real toggle and the real Insert button with trusted input,
 * and reads the note back from a real editor, so it proves the block lands at the cursor on a line of its own.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { MarkdownView } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `showCodeBlockBuilder` to use it in the tsdocs.
import type { showCodeBlockBuilder } from './code-block-builder.ts';

interface InsertResult {
  readonly noteContent: string;
  readonly outputAfterToggle: string;
  readonly result: null | string;
}

describe('showCodeBlockBuilder', () => {
  it('should insert the built code block into the editor at the cursor', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickElement, showCodeBlockBuilder, waitUntil } }): Promise<InsertResult> {
        const file = await app.vault.create(`code-block-builder-${String(Date.now())}.md`, 'Intro');
        const leaf = app.workspace.getLeaf('tab');

        try {
          await leaf.openFile(file, { active: true, state: { mode: 'source', source: false } });
          const editor = (leaf.view as MarkdownView).editor;
          editor.setCursor({ ch: 'Intro'.length, line: 0 });

          const resultPromise = showCodeBlockBuilder({
            app,
            editor,
            fields: [
              { defaultValue: false, key: 'grid', name: 'Grid', type: 'boolean' },
              { defaultValue: 'chart', isRequired: true, key: 'type', name: 'Type', type: 'text' }
            ],
            language: 'demo'
          });

          function getModalEl(): HTMLElement | null {
            return activeDocument.querySelector<HTMLElement>('.obsidian-lib.code-block-builder-modal');
          }

          function getOutput(): string {
            return getModalEl()?.querySelector('textarea')?.value ?? '';
          }

          await waitUntil({
            message: 'code block builder modal renders',
            predicate: () => getModalEl() !== null
          });

          const gridSettingEl = [...getModalEl()?.querySelectorAll<HTMLElement>('.setting-item') ?? []]
            .find((settingEl) => settingEl.querySelector('.setting-item-name')?.textContent === 'Grid');
          const toggleEl = gridSettingEl?.querySelector<HTMLElement>('.checkbox-container');
          if (!toggleEl) {
            throw new Error('Grid toggle not found');
          }

          await clickElement({ element: toggleEl });
          await waitUntil({
            message: 'output shows the toggled value',
            predicate: () => getOutput().includes('grid: true')
          });
          const outputAfterToggle = getOutput();

          const outputButtons = getModalEl()?.querySelectorAll<HTMLElement>(':scope .code-block-builder-output .clickable-icon');
          const insertButtonEl = outputButtons?.[1];
          if (!insertButtonEl) {
            throw new Error('Insert button not found');
          }

          await clickElement({ element: insertButtonEl });
          const builtCodeBlock = await resultPromise;

          return {
            noteContent: editor.getValue(),
            outputAfterToggle,
            result: builtCodeBlock
          };
        } finally {
          leaf.detach();
          await app.fileManager.trashFile(file);
        }
      }
    });

    expect(result.outputAfterToggle).toBe('```demo\ngrid: true\ntype: chart\n```');
    expect(result.result).toBe(result.outputAfterToggle);
    expect(result.noteContent).toBe('Intro\n```demo\ngrid: true\ntype: chart\n```\n');
  });
});
