/**
 * @file
 *
 * Proves, against real Obsidian, the two seams {@link CommandEditorSuggest} and {@link prioritizeEditorSuggest} read from
 * Obsidian `1.15.0`: a suggest opened from code follows what is typed after it and inserts the pick, and a prioritized
 * suggest wins `[[` from Obsidian's own link suggest.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type {
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('CommandEditorSuggest', () => {
  it('should open at the cursor from code and filter by the typed text', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { CommandEditorSuggest, pressKey, waitUntil } }) {
        class FruitSuggest extends CommandEditorSuggest<string> {
          public getSuggestions(context: EditorSuggestContext): string[] {
            return ['apple', 'banana', 'cherry'].filter((fruit) => fruit.startsWith(context.query));
          }

          public renderSuggestion(value: string, el: HTMLElement): void {
            el.setText(value);
          }

          public selectSuggestion(value: string): void {
            const { context } = this;
            if (context) {
              context.editor.replaceRange(value, context.start, context.end);
            }
            this.close();
          }
        }

        const file = await app.vault.create('command-editor-suggest-note.md', 'x ');
        const leaf = app.workspace.getLeaf('tab');
        const suggest = new FruitSuggest(app);
        app.workspace.editorSuggest.addSuggest(suggest);

        try {
          await leaf.openFile(file, { active: true, state: { mode: 'source', source: false } });
          const editor = app.workspace.activeEditor?.editor;
          if (!editor) {
            throw new Error('no active editor after opening the note');
          }
          editor.focus();
          editor.setCursor({ ch: 2, line: 0 });
          const wasOpened = suggest.openFromCommand({ editor, file });
          await waitUntil({
            message: 'the suggest lists every fruit',
            predicate: () => suggest.suggestEl.querySelectorAll('.suggestion-item').length === 3
          });
          await pressKey({ key: 'b' });
          await waitUntil({
            message: 'the typed text filters the fruits',
            predicate: () => suggest.suggestEl.querySelectorAll('.suggestion-item').length === 1
          });
          await pressKey({ key: 'Enter' });
          await waitUntil({
            message: 'the fruit is inserted',
            predicate: () => editor.getValue().includes('banana')
          });
          return { isOpen: suggest.isOpen, value: editor.getValue(), wasOpened };
        } finally {
          app.workspace.editorSuggest.removeSuggest(suggest);
          leaf.detach();
          await app.fileManager.trashFile(file);
        }
      }
    });

    expect(result).toEqual({ isOpen: false, value: 'x banana', wasOpened: true });
  });
});

describe('prioritizeEditorSuggest', () => {
  it('should open a prioritized suggest ahead of Obsidian\'s link suggest', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { CommandEditorSuggest, pressKey, prioritizeEditorSuggest, waitUntil } }) {
        class BracketSuggest extends CommandEditorSuggest<string> {
          public getSuggestions(): string[] {
            return ['priority-probe-item'];
          }

          public renderSuggestion(value: string, el: HTMLElement): void {
            el.setText(value);
          }

          public selectSuggestion(): void {
            this.close();
          }

          protected override onTextTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
            return editor.getLine(cursor.line).slice(0, cursor.ch).endsWith('[[') ? { end: cursor, query: '', start: { ch: cursor.ch - 2, line: cursor.line } } : null;
          }
        }

        const file = await app.vault.create('prioritize-editor-suggest-note.md', '');
        const leaf = app.workspace.getLeaf('tab');
        const suggest = new BracketSuggest(app);
        app.workspace.editorSuggest.addSuggest(suggest);

        try {
          prioritizeEditorSuggest({ app, editorSuggest: suggest });
          const isFirst = app.workspace.editorSuggest.suggests[0] === suggest;
          await leaf.openFile(file, { active: true, state: { mode: 'source', source: false } });
          const editor = app.workspace.activeEditor?.editor;
          if (!editor) {
            throw new Error('no active editor after opening the note');
          }
          editor.focus();
          await pressKey({ key: '[' });
          await pressKey({ key: '[' });
          await waitUntil({
            message: 'the prioritized suggest opens on [[',
            predicate: () => suggest.isOpen
          });
          return { isCurrent: app.workspace.editorSuggest.currentSuggest === suggest, isFirst };
        } finally {
          suggest.close();
          app.workspace.editorSuggest.removeSuggest(suggest);
          leaf.detach();
          await app.fileManager.trashFile(file);
        }
      }
    });

    expect(result).toEqual({ isCurrent: true, isFirst: true });
  });
});
