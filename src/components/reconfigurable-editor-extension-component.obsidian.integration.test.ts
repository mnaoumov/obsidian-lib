/**
 * @file
 *
 * Integration tests for {@link ReconfigurableEditorExtensionComponent} against a live Obsidian instance.
 *
 * The unit tests mock the dispatch to open editors, so only a real workspace shows the two halves meeting: a
 * reconfigure reaching an editor that is already open, and an editor opened afterwards starting with the new
 * extension because Obsidian re-reads the registered array.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface ReconfigureResult {
  readonly hasClassAfterUnload: boolean;
  readonly hasClassBeforeReconfigure: boolean;
  readonly hasClassInLaterEditor: boolean;
  readonly hasClassInOpenEditor: boolean;
  readonly hasOtherClassInOpenEditor: boolean;
}

describe('ReconfigurableEditorExtensionComponent', () => {
  it('should swap the extension in an open editor and in an editor opened later', async () => {
    const result = await evalInObsidian<Record<string, never>, ReconfigureResult>({
      async callback({ app, lib: { ReconfigurableEditorExtensionComponent } }) {
        const CLASS_NAME = 'obsidian-lib-reconfigure-integration';
        const OTHER_CLASS_NAME = 'obsidian-lib-reconfigure-integration-other';
        const registered: Extension[] = [];
        const firstFile = await app.vault.create('reconfigurable-extension-first.md', 'first');
        const secondFile = await app.vault.create('reconfigurable-extension-second.md', 'second');
        const firstLeaf = app.workspace.getLeaf(true);
        await firstLeaf.openFile(firstFile);
        const firstView = activeEditorView();
        const editorViewClass = firstView.constructor as typeof EditorView;

        const component = new ReconfigurableEditorExtensionComponent({
          app,
          editorExtensionRegistrar: {
            registerEditorExtension(extension): void {
              // The call `Plugin.registerEditorExtension` makes: it pushes the extension and runs `updateOptions()`.
              registered.push(extension);
              app.workspace.registerEditorExtension(extension);
            }
          },
          extension: editorViewClass.editorAttributes.of({ class: OTHER_CLASS_NAME })
        });
        const secondLeaf = app.workspace.getLeaf(true);
        try {
          component.load();
          const hasClassBeforeReconfigure = firstView.dom.classList.contains(CLASS_NAME);

          component.reconfigure([
            editorViewClass.editorAttributes.of({ class: CLASS_NAME }),
            editorViewClass.editorAttributes.of({ class: OTHER_CLASS_NAME })
          ]);
          const hasClassInOpenEditor = firstView.dom.classList.contains(CLASS_NAME);
          const hasOtherClassInOpenEditor = firstView.dom.classList.contains(OTHER_CLASS_NAME);

          await secondLeaf.openFile(secondFile);
          const hasClassInLaterEditor = activeEditorView().dom.classList.contains(CLASS_NAME);

          component.unload();
          const hasClassAfterUnload = firstView.dom.classList.contains(CLASS_NAME);

          return {
            hasClassAfterUnload,
            hasClassBeforeReconfigure,
            hasClassInLaterEditor,
            hasClassInOpenEditor,
            hasOtherClassInOpenEditor
          };
        } finally {
          component.unload();
          for (const extension of registered) {
            app.workspace.unregisterEditorExtension(extension);
          }
          firstLeaf.detach();
          secondLeaf.detach();
          await app.fileManager.trashFile(firstFile);
          await app.fileManager.trashFile(secondFile);
        }

        function activeEditorView(): EditorView {
          const editor = app.workspace.activeEditor?.editor;
          if (!editor) {
            throw new Error('no active editor after opening the note');
          }
          return editor.cm;
        }
      }
    });

    expect(result.hasClassBeforeReconfigure).toBe(false);
    expect(result.hasClassInOpenEditor).toBe(true);
    expect(result.hasOtherClassInOpenEditor).toBe(true);
    expect(result.hasClassInLaterEditor).toBe(true);
    expect(result.hasClassAfterUnload).toBe(false);
  });
});
