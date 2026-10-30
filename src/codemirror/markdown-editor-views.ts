/**
 * @file
 *
 * Reaches the CodeMirror {@link EditorView} of every open Markdown view, in every window.
 *
 * A Markdown view in Reading mode is included on purpose: it keeps its source editor alive while hidden, and a
 * reconfigure or state change that skipped it would leave that editor stale when the user switches back.
 *
 * Only editors that live in a workspace leaf are reached. An editor Obsidian builds elsewhere (a canvas card, an
 * editable embed, a hover popover) has no leaf, so it picks up registered extensions when it is created rather
 * than through these helpers.
 */

import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';

import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';
import { MarkdownView } from 'obsidian';

/**
 * Dispatches the given transaction specs to the editor of every open Markdown view, in every window.
 *
 * Each editor receives its own transaction built from the same specs, so a spec must not carry positions that
 * only make sense in one document. Annotations and state effects (such as a compartment reconfigure) are the
 * intended payload.
 *
 * @param app - The Obsidian app instance.
 * @param specs - The transaction specs to dispatch to every editor.
 */
export function dispatchToAllMarkdownEditorViews(app: App, ...specs: TransactionSpec[]): void {
  for (const editorView of getAllMarkdownEditorViews(app)) {
    editorView.dispatch(...specs);
  }
}

/**
 * Gets the editor of every open Markdown view, in every window, Reading mode included.
 *
 * @param app - The Obsidian app instance.
 * @returns The CodeMirror editor views.
 */
export function getAllMarkdownEditorViews(app: App): EditorView[] {
  const editorViews: EditorView[] = [];
  for (const leaf of app.workspace.getLeavesOfType(ViewType.Markdown)) {
    if (leaf.view instanceof MarkdownView) {
      editorViews.push(leaf.view.editor.cm);
    }
  }
  return editorViews;
}
