/**
 * @file
 *
 * Editor suggest registrars.
 */

import {
  EditorSuggest,
  Plugin
} from 'obsidian';

import { prioritizeEditorSuggest } from './editor-suggest.ts';

/**
 * Editor suggest registrar.
 */
export interface EditorSuggestRegistrar {
  /**
   * Registers an editor suggest.
   *
   * @param editorSuggest - The editor suggest to register.
   * @param options - The options.
   */
  readonly registerEditorSuggest: (editorSuggest: EditorSuggest<unknown>, options?: RegisterEditorSuggestOptions) => void;
}

/**
 * Options for {@link EditorSuggestRegistrar.registerEditorSuggest}.
 */
export interface RegisterEditorSuggestOptions {
  /**
   * Whether the suggest is asked before the others already registered, Obsidian's own included. Defaults to `false`:
   * registration order decides.
   */
  readonly shouldPrioritize?: boolean;
}

/**
 * Editor suggest registrar in an Obsidian plugin.
 */
export class PluginEditorSuggestRegistrar implements EditorSuggestRegistrar {
  /**
   * Creates a new instance of the {@link PluginEditorSuggestRegistrar} class.
   *
   * @param plugin - The Obsidian plugin instance.
   */
  public constructor(protected readonly plugin: Plugin) {}

  /**
   * Registers an editor suggest.
   *
   * @param editorSuggest - The editor suggest to register.
   * @param options - The options.
   */
  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- It implements `EditorSuggestRegistrar.registerEditorSuggest`, whose options type every registrar shares.
  public registerEditorSuggest(editorSuggest: EditorSuggest<unknown>, options?: RegisterEditorSuggestOptions): void {
    this.plugin.registerEditorSuggest(editorSuggest);
    if (options?.shouldPrioritize) {
      prioritizeEditorSuggest({ app: this.plugin.app, editorSuggest });
    }
  }
}
