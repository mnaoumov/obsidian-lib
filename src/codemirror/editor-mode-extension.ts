/**
 * @file
 *
 * Scopes an editor extension to one editor mode: {@link createLivePreviewOnlyExtension} keeps it in Live Preview only,
 * and {@link createSourceModeOnlyExtension} in Source mode only. The extension is switched on and off as a whole, so its
 * decorations, view plugins and state fields need no mode check of their own.
 *
 * The mode is Obsidian's `editorLivePreviewField`. Read from Obsidian `1.15.1`, a Markdown editor gets the field from
 * `editorLivePreviewField.init()` whenever its state is built, and a mode switch dispatches one transaction carrying a
 * private effect that sets the field, beside the reconfigure of its dynamic extensions. So the field changes only in a
 * transaction with effects, or with a new state.
 *
 * Each call wraps the extension in a {@link Compartment} of its own, which holds the extension or nothing in every
 * editor separately. A transaction extender reconfigures it in the same transaction that changes the mode, so no update
 * ever renders with the wrong content. A new state cannot be read before it exists, so it starts with the content the
 * Live Preview default calls for, and a view plugin corrects it in a microtask, which runs before the browser paints.
 *
 * Outside an Obsidian Markdown editor there is no `editorLivePreviewField`, and the editor counts as Live Preview.
 */

import type {
  Extension,
  StateField
} from '@codemirror/state';
import type {
  EditorView,
  PluginValue
} from '@codemirror/view';

import {
  Compartment,
  EditorState
} from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { editorLivePreviewField } from 'obsidian';

// Obsidian.d.ts reaches @codemirror/state through its CommonJS declarations and this module through the ES ones, and
// StateField has private members, so the two declarations of one runtime class do not type-check against each other.
const editorLivePreviewStateField = castTo<StateField<boolean>>(editorLivePreviewField);

/**
 * Wraps an extension so it is active only while the editor is in Live Preview, and switched off in Source mode.
 *
 * @example
 * ```ts
 * this.registerEditorExtension(createLivePreviewOnlyExtension(myDecorationsPlugin));
 * ```
 *
 * @param extension - The extension to scope.
 * @returns The scoped extension.
 */
export function createLivePreviewOnlyExtension(extension: Extension): Extension {
  return createModeScopedExtension(extension, true);
}

/**
 * Wraps an extension so it is active only while the editor is in Source mode, and switched off in Live Preview.
 *
 * Outside an Obsidian Markdown editor the editor counts as Live Preview, so the extension stays off there.
 *
 * @param extension - The extension to scope.
 * @returns The scoped extension.
 */
export function createSourceModeOnlyExtension(extension: Extension): Extension {
  return createModeScopedExtension(extension, false);
}

/**
 * Tells whether an editor state is in Live Preview.
 *
 * @param state - The editor state.
 * @returns `true` in Live Preview and outside an Obsidian Markdown editor, `false` in Source mode.
 */
export function isLivePreview(state: EditorState): boolean {
  return state.field(editorLivePreviewStateField, false) ?? true;
}

function createModeScopedExtension(extension: Extension, isActiveInLivePreview: boolean): Extension {
  const compartment = new Compartment();
  const emptyExtension: Extension = [];

  return [
    compartment.of(isActiveInLivePreview ? extension : emptyExtension),
    EditorState.transactionExtender.of((transaction) => {
      if (transaction.effects.length === 0) {
        return null;
      }
      const content = getChangedContent(transaction.state);
      return content === null ? null : { effects: compartment.reconfigure(content) };
    }),
    ViewPlugin.define((view) => createInitialContentCorrector(view))
  ];

  function getChangedContent(state: EditorState): Extension | null {
    const content = isLivePreview(state) === isActiveInLivePreview ? extension : emptyExtension;
    return compartment.get(state) === content ? null : content;
  }

  function createInitialContentCorrector(view: EditorView): PluginValue {
    let isDestroyed = false;
    if (getChangedContent(view.state) !== null) {
      queueMicrotask(() => {
        if (isDestroyed) {
          return;
        }
        const content = getChangedContent(view.state);
        if (content !== null) {
          view.dispatch({ effects: compartment.reconfigure(content) });
        }
      });
    }
    return {
      destroy(): void {
        isDestroyed = true;
      }
    };
  }
}
