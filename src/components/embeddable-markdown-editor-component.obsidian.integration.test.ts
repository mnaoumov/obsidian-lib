/**
 * @file
 *
 * Integration tests for {@link EmbeddableMarkdownEditorComponent} against a live Obsidian instance.
 *
 * The component builds on Obsidian's unexported editor class, which it borrows from a throwaway Markdown embed, so
 * only a running Obsidian can show it works: that the borrowed class renders Live Preview, that the editor commands
 * reach it, that its key handlers run, and that neither the borrowing nor the editor itself moves the user's
 * workspace.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('EmbeddableMarkdownEditorComponent', () => {
  it('should mount a Live Preview editor and leave the workspace as it was', async () => {
    const result = await evalInObsidian({
      callback({ app, lib: { EmbeddableMarkdownEditorComponent } }) {
        const counters = { activeLeafChange: 0, fileOpen: 0 };
        const activeLeafChangeRef = app.workspace.on('active-leaf-change', () => {
          counters.activeLeafChange++;
        });
        const fileOpenRef = app.workspace.on('file-open', () => {
          counters.fileOpen++;
        });

        const containerEl = activeDocument.body.createDiv();
        const siblingEl = containerEl.createDiv({ cls: 'embeddable-editor-test-sibling' });
        const leafCountBefore = countLeaves();
        const activeFileBefore = app.workspace.getActiveFile()?.path ?? null;

        try {
          const component = new EmbeddableMarkdownEditorComponent({
            app,
            cls: 'embeddable-editor-test',
            containerEl,
            value: '**bold** text'
          });
          component.load();

          const editorEl = containerEl.querySelector('.markdown-source-view.embeddable-editor-test');
          const mounted = {
            hasEditorElement: Boolean(editorEl),
            hasLivePreviewBold: Boolean(editorEl?.querySelector('.cm-strong')),
            leafCount: countLeaves(),
            value: component.value
          };

          component.unload();

          return {
            activeFileAfter: app.workspace.getActiveFile()?.path ?? null,
            activeFileBefore,
            counters: { ...counters },
            leafCountAfter: countLeaves(),
            leafCountBefore,
            mounted,
            unmounted: {
              hasEditorElement: Boolean(containerEl.querySelector('.markdown-source-view')),
              isSiblingKept: siblingEl.isConnected
            }
          };
        } finally {
          app.workspace.offref(activeLeafChangeRef);
          app.workspace.offref(fileOpenRef);
          containerEl.remove();
        }

        function countLeaves(): number {
          let count = 0;
          app.workspace.iterateAllLeaves(() => {
            count++;
          });
          return count;
        }
      }
    });

    expect(result.mounted).toEqual({
      hasEditorElement: true,
      hasLivePreviewBold: true,
      leafCount: result.leafCountBefore,
      value: '**bold** text'
    });
    expect(result.unmounted).toEqual({ hasEditorElement: false, isSiblingKept: true });
    expect(result.leafCountAfter).toBe(result.leafCountBefore);
    expect(result.activeFileAfter).toBe(result.activeFileBefore);
    expect(result.counters).toEqual({ activeLeafChange: 0, fileOpen: 0 });
  });

  it('should take typed text, report changes and run editor commands on its own document', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { EmbeddableMarkdownEditorComponent, typeIntoEditor, waitUntil } }) {
        const containerEl = activeDocument.body.createDiv();
        let changeCount = 0;
        const component = new EmbeddableMarkdownEditorComponent({
          app,
          containerEl,
          onChange: (): void => {
            changeCount++;
          }
        });

        try {
          component.load();
          component.focus();
          await waitUntil({
            message: 'the editor takes the focus',
            predicate: () => component.editorView.hasFocus
          });
          await typeIntoEditor({ editor: component.editor, text: 'hello' });
          await waitUntil({
            message: 'typed text reaches the document',
            predicate: () => component.value === 'hello'
          });

          const { editor } = component;
          const isActiveEditor = app.workspace.activeEditor?.editor === editor;

          editor.setSelection({ ch: 0, line: 0 }, { ch: 'hello'.length, line: 0 });
          const isCommandRun = app.commands.executeCommandById('editor:toggle-bold');
          const valueAfterCommand = component.value;

          component.unload();

          return {
            changeCount,
            isActiveEditor,
            isActiveEditorAfterUnload: app.workspace.activeEditor?.editor === editor,
            isCommandRun,
            valueAfterCommand
          };
        } finally {
          component.unload();
          containerEl.remove();
        }
      }
    });

    expect(result.changeCount).toBeGreaterThan(0);
    expect(result.isActiveEditor).toBe(true);
    expect(result.isCommandRun).toBe(true);
    expect(result.valueAfterCommand).toBe('**hello**');
    expect(result.isActiveEditorAfterUnload).toBe(false);
  });

  // `Mod+Enter` is covered by the `.desktop` sibling: a phone's keyboard has no modifier keys.
  it('should route Enter and Escape to its handlers', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { EmbeddableMarkdownEditorComponent, pressKey, waitUntil } }) {
        const containerEl = activeDocument.body.createDiv();
        const enterCalls: string[] = [];
        let escapeCount = 0;
        const component = new EmbeddableMarkdownEditorComponent({
          app,
          containerEl,
          cursorLocation: { anchor: 4, head: 4 },
          onEnter: ({ isModifierPressed, isShiftPressed }): boolean => {
            enterCalls.push(`mod=${String(isModifierPressed)} shift=${String(isShiftPressed)}`);
            // Plain Enter is left to the editor, so the line break proves a `false` return lets it through.
            return isModifierPressed;
          },
          onEscape: (): void => {
            escapeCount++;
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

          await pressKey({ key: 'Enter' });
          await waitUntil({
            message: 'plain Enter reaches onEnter and, refused there, inserts a line break',
            predicate: () => enterCalls.length > 0 && component.value === 'line\n'
          });
          const valueAfterEnter = component.value;

          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'Escape reaches its handler',
            predicate: () => escapeCount > 0
          });

          return { enterCalls, escapeCount, value: component.value, valueAfterEnter };
        } finally {
          component.unload();
          containerEl.remove();
        }
      }
    });

    expect(result.enterCalls).toEqual(['mod=false shift=false']);
    expect(result.valueAfterEnter).toBe('line\n');
    expect(result.escapeCount).toBe(1);
    expect(result.value).toBe('line\n');
  });

  it('should keep its focus when the workspace activates a leaf', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { EmbeddableMarkdownEditorComponent, waitUntil } }) {
        const containerEl = activeDocument.body.createDiv();
        const component = new EmbeddableMarkdownEditorComponent({ app, containerEl });

        try {
          component.load();
          component.focus();
          await waitUntil({
            message: 'the editor takes the focus',
            predicate: () => component.editorView.hasFocus
          });

          const leaf = app.workspace.getMostRecentLeaf();
          if (leaf) {
            app.workspace.setActiveLeaf(leaf, { focus: true });
          }

          return { hasFocus: component.editorView.hasFocus, hasLeaf: Boolean(leaf) };
        } finally {
          component.unload();
          containerEl.remove();
        }
      }
    });

    expect(result).toEqual({ hasFocus: true, hasLeaf: true });
  });
});
