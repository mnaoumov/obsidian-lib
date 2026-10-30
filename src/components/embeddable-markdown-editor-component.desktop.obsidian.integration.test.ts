/**
 * @file
 *
 * Desktop-only integration test for {@link EmbeddableMarkdownEditorComponent}: the `Mod+Enter` handling. A phone's
 * keyboard has no modifier keys, so the cross-platform cases live in the sibling file without the `.desktop` segment.
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

          // Without the component's keymap scope, Obsidian's `Mod+Enter` hotkey takes the key and the editor never
          // sees it, so these calls are what the scope is for.
          await pressKey({ key: 'Enter', modifiers: ['Mod'] });
          await pressKey({ key: 'Enter', modifiers: ['Mod', 'Shift'] });
          await waitUntil({
            message: 'both Mod+Enter presses reach onEnter',
            predicate: () => enterCalls.length >= 2
          });

          return { enterCalls, value: component.value };
        } finally {
          component.unload();
          containerEl.remove();
        }
      }
    });

    expect(result.enterCalls).toEqual(['mod=true shift=false', 'mod=true shift=true']);
    expect(result.value).toBe('line');
  });
});
