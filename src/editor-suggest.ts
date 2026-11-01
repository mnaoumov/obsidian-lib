/**
 * @file
 *
 * Helpers for `EditorSuggest`: giving one priority over the others, and opening one from a command.
 *
 * Read from Obsidian `1.15.0`: the editor asks each suggest in `app.workspace.editorSuggest.suggests` in order, and the
 * first whose `trigger` accepts the cursor wins, so registration order decides which suggest opens. A suggest shows its
 * list only when the trigger is explicit (the user typed) or it is already open.
 */

import type {
  App,
  Editor,
  EditorPosition,
  EditorSuggestTriggerInfo,
  TFile
} from 'obsidian';

import { EditorSuggest } from 'obsidian';

/**
 * Parameters for {@link CommandEditorSuggest.openFromCommand}.
 */
export interface CommandEditorSuggestOpenFromCommandParams {
  /**
   * The editor to open the suggest in.
   */
  readonly editor: Editor;

  /**
   * The file open in the editor.
   */
  readonly file: null | TFile;
}

/**
 * Parameters for {@link prioritizeEditorSuggest}.
 */
export interface PrioritizeEditorSuggestParams {
  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * The registered editor suggest.
   */
  readonly editorSuggest: EditorSuggest<unknown>;
}

/**
 * An editor suggest that a command can open at the cursor, without a trigger character.
 *
 * {@link CommandEditorSuggest.openFromCommand} opens it at the cursor; the text typed after that point, on the same
 * line, is the query, and moving the cursor before that point or off the line closes it. A subclass may still open on
 * typed text by overriding {@link CommandEditorSuggest.onTextTrigger}.
 *
 * Register it as usual, so the editor keeps it updated while the user types:
 *
 * ```ts
 * const suggest = new EmojiSuggest(this.app);
 * this.registerEditorSuggest(suggest);
 * this.addCommand({
 *   editorCallback: (editor, ctx) => {
 *     suggest.openFromCommand({ editor, file: ctx.file });
 *   },
 *   id: 'insert-emoji',
 *   name: 'Insert emoji'
 * });
 * ```
 *
 * @typeParam T - The type of a suggestion.
 */
export abstract class CommandEditorSuggest<T> extends EditorSuggest<T> {
  private commandStart: EditorPosition | null = null;

  /**
   * Closes the suggest, ending a command-opened session.
   */
  public override close(): void {
    this.commandStart = null;
    super.close();
  }

  /**
   * Decides whether the suggest opens. While a command-opened session lasts, the query is the text from where it was
   * opened to the cursor; otherwise {@link CommandEditorSuggest.onTextTrigger} decides.
   *
   * @param cursor - The cursor.
   * @param editor - The editor.
   * @param file - The file open in the editor.
   * @returns The trigger info, or `null` to stay closed.
   */
  public override onTrigger(cursor: EditorPosition, editor: Editor, file: null | TFile): EditorSuggestTriggerInfo | null {
    const start = this.commandStart;
    if (start) {
      if (cursor.line === start.line && cursor.ch >= start.ch) {
        return {
          end: cursor,
          query: editor.getLine(cursor.line).slice(start.ch, cursor.ch),
          start
        };
      }
      this.commandStart = null;
    }
    return this.onTextTrigger(cursor, editor, file);
  }

  /**
   * Opens the suggest at the cursor of an editor, typically from a command's `editorCallback`.
   *
   * @param params - The parameters.
   * @returns Whether the suggest accepted the cursor: `false` when text is selected.
   */
  public openFromCommand(params: CommandEditorSuggestOpenFromCommandParams): boolean {
    const { editor, file } = params;
    this.commandStart = editor.getCursor();
    if (!this.trigger(editor, file, true)) {
      this.commandStart = null;
      return false;
    }
    this.app.workspace.editorSuggest.setCurrentSuggest(this);
    return true;
  }

  /**
   * Decides whether the suggest opens on typed text, outside a command-opened session. Never, by default.
   *
   * @param _cursor - The cursor.
   * @param _editor - The editor.
   * @param _file - The file open in the editor.
   * @returns The trigger info, or `null` to stay closed.
   */
  protected onTextTrigger(_cursor: EditorPosition, _editor: Editor, _file: null | TFile): EditorSuggestTriggerInfo | null {
    return null;
  }
}

/**
 * Moves a registered editor suggest to the front of the list the editor asks, so it opens ahead of every other suggest
 * whose trigger accepts the same text, Obsidian's own `[[` and `#` suggests included. A suggest prioritized later goes
 * ahead of it in turn.
 *
 * @param params - The parameters.
 * @throws If the editor suggest is not registered.
 */
export function prioritizeEditorSuggest(params: PrioritizeEditorSuggestParams): void {
  const { app, editorSuggest } = params;
  const suggests = app.workspace.editorSuggest.suggests;
  const index = suggests.indexOf(editorSuggest);
  if (index === -1) {
    throw new Error('The editor suggest is not registered. Register it before prioritizing it.');
  }
  suggests.splice(index, 1);
  suggests.unshift(editorSuggest);
}
