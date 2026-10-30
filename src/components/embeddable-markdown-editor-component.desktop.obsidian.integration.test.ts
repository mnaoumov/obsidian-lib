/**
 * @file
 *
 * Desktop-only integration test for {@link EmbeddableMarkdownEditorComponent}: the `Mod+Enter` handling and the exact
 * line-break count of a plain Enter. A phone's keyboard has no modifier keys, and on the Android emulator one Enter from
 * the harness can reach CodeMirror's Android key path twice, so the cross-platform cases live in the sibling file
 * without the `.desktop` segment.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('EmbeddableMarkdownEditorComponent on desktop', () => {
  it('should hand Mod+Enter to onEnter rather than to the Obsidian hotkey bound to it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { EmbeddableMarkdownEditorComponent, pressKey, waitUntil } }) {
        const containerEl = activeDocument.body.createDiv();
        const enterCalls: string[] = [];
        const component = new EmbeddableMarkdownEditorComponent({
          app,
          containerEl,
          cursorLocation: { anchor: 4, head: 4 },
          onEnter: ({ isModifierPressed, isShiftPressed }): boolean => {
            enterCalls.push(`mod=${String(isModifierPressed)} shift=${String(isShiftPressed)}`);
            // Plain Enter is left to the editor, so the line break proves a `false` return lets it through.
            return isModifierPressed;
          },
          value: 'line'
        });

        try {
          component.load();
          component.focus();
          await waitUntil({
            message: 'the editor takes the focus',
            predicate: () => component.editorView.hasFocus
          });

          // One plain Enter, refused by `onEnter`, inserts exactly one line break.
          enterCalls.length = 0;
          await pressKey({ key: 'Enter' });
          await waitUntil({
            message: 'plain Enter inserts a line break',
            predicate: () => component.value === 'line\n'
          });
          const valueAfterPlainEnter = component.value;
          const plainEnterCalls = [...enterCalls];
          enterCalls.length = 0;
          component.setValue('line');
          component.editor.setCursor({ ch: 4, line: 0 });

          // Without the component's keymap scope, Obsidian's `Mod+Enter` hotkey takes the key and the editor never
          // sees it, so these calls are what the scope is for.
          await pressKey({ key: 'Enter', modifiers: ['Mod'] });
          await pressKey({ key: 'Enter', modifiers: ['Mod', 'Shift'] });
          await waitUntil({
            message: 'both Mod+Enter presses reach onEnter',
            predicate: () => enterCalls.length >= 2
          });

          return { enterCalls, plainEnterCalls, value: component.value, valueAfterPlainEnter };
        } finally {
          component.unload();
          containerEl.remove();
        }
      }
    });

    expect(result.plainEnterCalls).toEqual(['mod=false shift=false']);
    expect(result.valueAfterPlainEnter).toBe('line\n');
    expect(result.enterCalls).toEqual(['mod=true shift=false', 'mod=true shift=true']);
    expect(result.value).toBe('line');
  });
});
