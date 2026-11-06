/**
 * @file
 *
 * Integration tests for {@link createLivePreviewOnlyExtension} and {@link createSourceModeOnlyExtension} against a live
 * Obsidian instance.
 *
 * The unit tests can only move the mock field in and out of the state, so only a real Markdown view shows the helpers
 * meeting Obsidian's own mode switch, which sets `editorLivePreviewField` through Obsidian's private effect: on an open
 * editor, on a new leaf opened in Source mode, and on a note opened into a leaf already in Source mode. Obsidian `1.15.1`
 * reaches the mode through a transaction with effects in all three, so these cases pin the transaction path; the
 * microtask correction of a state built in the other mode is covered by the unit tests.
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

interface EditorClasses {
  readonly hasLivePreviewOnlyClass: boolean;
  readonly hasSourceModeOnlyClass: boolean;
}

interface ModeResult {
  readonly afterSwitchBack: EditorClasses;
  readonly inLivePreview: EditorClasses;
  readonly inNewSourceLeaf: EditorClasses;
  readonly inReusedSourceLeaf: EditorClasses;
  readonly inSource: EditorClasses;
}

describe('editor mode extensions', () => {
  it('should follow the Source / Live Preview switch of a real Markdown editor', async () => {
    const result = await evalInObsidian<Record<string, never>, ModeResult>({
      async callback({ app, lib: { createLivePreviewOnlyExtension, createSourceModeOnlyExtension, noopAsync } }) {
        const LIVE_PREVIEW_CLASS = 'obsidian-lib-live-preview-only-integration';
        const SOURCE_CLASS = 'obsidian-lib-source-mode-only-integration';
        const registered: Extension[] = [];
        const firstFile = await app.vault.create('editor-mode-extension-first.md', 'first');
        const secondFile = await app.vault.create('editor-mode-extension-second.md', 'second');
        const thirdFile = await app.vault.create('editor-mode-extension-third.md', 'third');
        const firstLeaf = app.workspace.getLeaf(true);
        const secondLeaf = app.workspace.getLeaf(true);
        try {
          await firstLeaf.openFile(firstFile, { state: { mode: 'source', source: false } });
          const firstView = activeEditorView();
          const editorViewClass = firstView.constructor as typeof EditorView;
          register(createLivePreviewOnlyExtension(editorViewClass.editorAttributes.of({ class: LIVE_PREVIEW_CLASS })));
          register(createSourceModeOnlyExtension(editorViewClass.editorAttributes.of({ class: SOURCE_CLASS })));

          const inLivePreview = readClasses(firstView);

          await setFirstLeafSourceMode(true);
          const inSource = readClasses(firstView);

          await setFirstLeafSourceMode(false);
          const afterSwitchBack = readClasses(firstView);

          await secondLeaf.openFile(secondFile, { state: { mode: 'source', source: true } });
          await noopAsync();
          const inNewSourceLeaf = readClasses(activeEditorView());

          await secondLeaf.openFile(thirdFile, { state: { mode: 'source', source: true } });
          await noopAsync();
          const inReusedSourceLeaf = readClasses(activeEditorView());

          return {
            afterSwitchBack,
            inLivePreview,
            inNewSourceLeaf,
            inReusedSourceLeaf,
            inSource
          };
        } finally {
          for (const extension of registered) {
            app.workspace.unregisterEditorExtension(extension);
          }
          firstLeaf.detach();
          secondLeaf.detach();
          await app.fileManager.trashFile(firstFile);
          await app.fileManager.trashFile(secondFile);
          await app.fileManager.trashFile(thirdFile);
        }

        function register(extension: Extension): void {
          registered.push(extension);
          app.workspace.registerEditorExtension(extension);
        }

        async function setFirstLeafSourceMode(isSource: boolean): Promise<void> {
          const viewState = firstLeaf.getViewState();
          await firstLeaf.setViewState({ ...viewState, state: { ...viewState.state, mode: 'source', source: isSource } });
        }

        function readClasses(view: EditorView): EditorClasses {
          return {
            hasLivePreviewOnlyClass: view.dom.classList.contains(LIVE_PREVIEW_CLASS),
            hasSourceModeOnlyClass: view.dom.classList.contains(SOURCE_CLASS)
          };
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

    const livePreviewClasses: EditorClasses = { hasLivePreviewOnlyClass: true, hasSourceModeOnlyClass: false };
    const sourceClasses: EditorClasses = { hasLivePreviewOnlyClass: false, hasSourceModeOnlyClass: true };
    expect(result).toEqual({
      afterSwitchBack: livePreviewClasses,
      inLivePreview: livePreviewClasses,
      inNewSourceLeaf: sourceClasses,
      inReusedSourceLeaf: sourceClasses,
      inSource: sourceClasses
    });
  });
});
