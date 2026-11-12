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
            predicate: () => component.hasFocus
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

  // CodeMirror's `EditorView.hasFocus` also requires `document.hasFocus()`, which is the operating system's window focus,
  // so a guard reading it stood down whenever another window was in front, and the workspace took the focus away.
  it('should keep its focus when the workspace activates a leaf while another window has the operating system focus', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { EmbeddableMarkdownEditorComponent, waitUntil } }) {
        const containerEl = activeDocument.body.createDiv();
        const component = new EmbeddableMarkdownEditorComponent({ app, containerEl });
        const { remote } = window.electron;
        const displays = remote.screen.getAllDisplays();
        const maxRight = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
        // Off-screen, like the owned instance itself, so nothing appears on the user's display.
        const otherWindow = new remote.BrowserWindow({ height: 100, show: false, width: 100, x: maxRight + 200, y: 0 });

        try {
          component.load();
          component.focus();
          await waitUntil({
            message: 'the editor takes the focus',
            predicate: () => component.hasFocus
          });

          otherWindow.show();
          otherWindow.focus();
          await waitUntil({
            message: 'the other window takes the operating system focus',
            predicate: () => !activeDocument.hasFocus()
          });

          const leaf = app.workspace.getMostRecentLeaf();
          if (leaf) {
            app.workspace.setActiveLeaf(leaf, { focus: true });
          }

          return {
            hasFocus: component.hasFocus,
            hasLeaf: Boolean(leaf),
            isCodeMirrorFocused: component.editorView.hasFocus
          };
        } finally {
          otherWindow.destroy();
          component.unload();
          containerEl.remove();
        }
      }
    });

    expect(result).toEqual({ hasFocus: true, hasLeaf: true, isCodeMirrorFocused: false });
  });
});
