/**
 * @file
 *
 * Contains a component that edits the path of one vault file, with a file suggest.
 */

import type {
  App,
  TFile
} from 'obsidian';

import { normalizePath } from 'obsidian';

import type { FileInputSuggestConstructorOptions } from '../file-input-suggest.ts';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `initPluginContext` to use it in the tsdocs.
import type { initPluginContext } from '../plugin/plugin-context.ts';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `SettingEx` to use it in the tsdocs.
import type { SettingEx } from '../setting-ex.ts';
import type { TextBasedComponent } from './text-based-component.ts';

import { CssClass } from '../css-class.ts';
import { FileInputSuggest } from '../file-input-suggest.ts';
import { TypedTextComponent } from './typed-text-component.ts';

/**
 * The optional parameters of a {@link FilePathComponent}: those of its {@link FileInputSuggest}.
 */
export type FilePathComponentConstructorOptions = FileInputSuggestConstructorOptions;

/**
 * A component that edits the path of one vault file: a text input whose suggest offers the vault's files, showing
 * each file's name and path with the matched characters highlighted. The value is the typed text; a path need not
 * exist yet, and {@link FilePathComponent.getFile} resolves it.
 *
 * You can add this component using {@link SettingEx.addFilePath}.
 *
 * In order to add the styles for the component, use {@link initPluginContext} in your plugin's `onload()` function.
 */
export class FilePathComponent extends TypedTextComponent<string> implements TextBasedComponent<string> {
  /**
   * The file suggest attached to {@link TypedTextComponent.inputEl}.
   */
  public readonly suggest: FileInputSuggest;

  /**
   * Creates a new file path component.
   *
   * @param containerEl - The container element of the component.
   * @param app - The Obsidian app.
   * @param options - The optional file suggest parameters, such as a file filter.
   */
  public constructor(containerEl: HTMLElement, protected readonly app: App, options?: FilePathComponentConstructorOptions) {
    super({
      containerEl,
      cssClass: CssClass.FilePathComponent,
      type: 'text'
    });
    this.suggest = new FileInputSuggest(app, this.inputEl, options);
  }

  /**
   * Empties the component.
   */
  public empty(): void {
    this.setValue('');
  }

  /**
   * Resolves the typed path, normalized with Obsidian's `normalizePath`, to a vault file.
   *
   * @returns The file, or `null` when the input is empty or names no file.
   */
  public getFile(): null | TFile {
    const path = this.getValue().trim();
    return path ? this.app.vault.getFileByPath(normalizePath(path)) : null;
  }

  /**
   * Checks if the component is empty.
   *
   * @returns `true` if the component is empty, `false` otherwise.
   */
  public isEmpty(): boolean {
    return this.getValue() === '';
  }

  /**
   * Sets the placeholder value of the component.
   *
   * @param placeholderValue - The placeholder value to set.
   * @returns The component.
   */
  public setPlaceholderValue(placeholderValue: string): this {
    this.textComponent.setPlaceholder(placeholderValue);
    return this;
  }

  /**
   * Converts a string to a file path.
   *
   * @param $string - The string to convert.
   * @returns The file path.
   */
  public override valueFromString($string: string): string {
    return $string;
  }
}
