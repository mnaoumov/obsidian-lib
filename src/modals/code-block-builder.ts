/**
 * @file
 *
 * Contains {@link showCodeBlockBuilder}, a modal that builds a plugin's code block from a declarative list of fields, and
 * {@link formatCodeBlock}, the pure formatter behind it.
 *
 * Every field renders as one settings row. A field whose value differs from its default writes one `key: value` line
 * into the block (a required field always does), the block is shown live with an optional preview the plugin draws, and
 * the user copies it or inserts it into the note being edited.
 *
 * Adapted from the code block creator modal of altarok's `obsidian-dev-utils`
 * (https://github.com/altarok/obsidian-dev-utils, `src/code-block-creator/`), under the MIT license below. The port
 * takes the app from the caller, moves the styles into the library stylesheet, reuses this library's setting
 * components, and picks a fence longer than any backtick run in the values.
 *
 * Copyright (c) 2026 Altarok
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// cspell:words altarok Altarok rrggbb -- The author's handle, as the license notice above names it, and the hex color notation.

import type {
  Editor,
  ExtraButtonComponent
} from 'obsidian';

import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  assertNever,
  ensureNonNullable
} from '@mnaoumov/typescript-lib/type-guards';
import {
  DropdownComponent,
  Notice,
  Setting,
  TextAreaComponent
} from 'obsidian';

import type {
  ModalBaseConstructorParams,
  ModalParamsBase
} from './modal.ts';

import { CssClass } from '../css-class.ts';
import { t } from '../i18n/i18n.ts';
import { MultipleDropdownComponent } from '../setting-components/multiple-dropdown-component.ts';
import {
  ModalBase,
  showModal
} from './modal.ts';

/**
 * A boolean field, rendered as a toggle.
 */
export interface CodeBlockBuilderBooleanField extends CodeBlockBuilderFieldBase<boolean> {
  /**
   * The kind of the field.
   */
  readonly type: 'boolean';
}

/**
 * A color field, rendered as a color picker. The value is the color as `#rrggbb`.
 */
export interface CodeBlockBuilderColorField extends CodeBlockBuilderFieldBase<string> {
  /**
   * The kind of the field.
   */
  readonly type: 'color';
}

/**
 * A pair of cascading dropdowns: the first picks a group, the second one of that group's options. Only the second
 * dropdown's value is written into the code block.
 */
export interface CodeBlockBuilderConditionalDropdownField extends CodeBlockBuilderFieldBase<string> {
  /**
   * The groups of options. The group containing {@link CodeBlockBuilderFieldBase.defaultValue} is selected first, else
   * the first group.
   */
  readonly groups: readonly CodeBlockBuilderOptionGroup[];

  /**
   * The kind of the field.
   */
  readonly type: 'conditionalDropdown';
}

/**
 * A single-choice dropdown field.
 */
export interface CodeBlockBuilderDropdownField extends CodeBlockBuilderFieldBase<string> {
  /**
   * The options of the dropdown.
   */
  readonly options: CodeBlockBuilderOptions;

  /**
   * The kind of the field.
   */
  readonly type: 'dropdown';
}

/**
 * A field of the code block builder, other than a {@link CodeBlockBuilderGroup}.
 */
export type CodeBlockBuilderField =
  | CodeBlockBuilderBooleanField
  | CodeBlockBuilderColorField
  | CodeBlockBuilderConditionalDropdownField
  | CodeBlockBuilderDropdownField
  | CodeBlockBuilderFolderField
  | CodeBlockBuilderMultipleDropdownField
  | CodeBlockBuilderSliderField
  | CodeBlockBuilderTextField;

/**
 * The members every {@link CodeBlockBuilderField} has.
 *
 * @typeParam Value - The type of the field's value.
 */
export interface CodeBlockBuilderFieldBase<Value extends CodeBlockBuilderValue> {
  /**
   * The value the field starts with. While the field holds it, the field writes nothing into the code block, unless it
   * is {@link CodeBlockBuilderFieldBase.isRequired}.
   */
  readonly defaultValue: Value;

  /**
   * A description shown under the field's name.
   */
  readonly description?: string;

  /**
   * Whether the field is always written into the code block. A required field is shown above the optional ones and has
   * no reset button.
   *
   * @default `false`
   */
  readonly isRequired?: boolean;

  /**
   * The key the field's line is written with, and the key of its value in the values the preview receives. Unique across
   * all fields.
   */
  readonly key: string;

  /**
   * The name of the field, shown to the user.
   */
  readonly name: string;

  /**
   * Whether the field's line holds its value alone, without the `key: ` prefix.
   *
   * @default `false`
   */
  readonly shouldOmitKey?: boolean;
}

/**
 * A folder field: a dropdown of every folder of the vault. The value is the folder path, `/` for the vault root.
 */
export interface CodeBlockBuilderFolderField extends CodeBlockBuilderFieldBase<string> {
  /**
   * The kind of the field.
   */
  readonly type: 'folder';
}

/**
 * A collapsible group of fields. One group is expanded at a time: expanding a group collapses the others.
 */
export interface CodeBlockBuilderGroup {
  /**
   * The fields of the group. A required field inside a group is still written into the code block.
   */
  readonly fields: readonly CodeBlockBuilderField[];

  /**
   * Whether the group starts expanded.
   *
   * @default `false`
   */
  readonly isInitiallyExpanded?: boolean;

  /**
   * The heading of the group.
   */
  readonly name: string;

  /**
   * The kind of the entry.
   */
  readonly type: 'group';
}

/**
 * An entry of {@link ShowCodeBlockBuilderParams.fields}: a field, or a group of fields.
 */
export type CodeBlockBuilderInput = CodeBlockBuilderField | CodeBlockBuilderGroup;

/**
 * A multiple-choice dropdown field. Its line holds the selected options joined by
 * {@link CodeBlockBuilderMultipleDropdownField.separator}.
 */
export interface CodeBlockBuilderMultipleDropdownField extends CodeBlockBuilderFieldBase<readonly string[]> {
  /**
   * The options of the dropdown.
   */
  readonly options: CodeBlockBuilderOptions;

  /**
   * The text the selected options are joined with.
   *
   * @default `','`
   */
  readonly separator?: string;

  /**
   * The kind of the field.
   */
  readonly type: 'multipleDropdown';
}

/**
 * A named group of options of a {@link CodeBlockBuilderConditionalDropdownField}.
 */
export interface CodeBlockBuilderOptionGroup {
  /**
   * The name of the group, shown in the first dropdown.
   */
  readonly name: string;

  /**
   * The options of the group, shown in the second dropdown.
   */
  readonly options: CodeBlockBuilderOptions;
}

/**
 * The options of a dropdown: a list of values shown as they are, or a map from each value to its display text.
 */
export type CodeBlockBuilderOptions = Readonly<Record<string, string>> | readonly string[];

/**
 * The parameters of {@link ShowCodeBlockBuilderParams.onUpdatePreview}.
 */
export interface CodeBlockBuilderPreviewParams {
  /**
   * The code block as it stands.
   */
  readonly codeBlock: string;

  /**
   * The element to draw the preview into. The modal never clears it.
   */
  readonly previewEl: HTMLElement;

  /**
   * The current value of every field, by its key.
   */
  readonly values: ReadonlyMap<string, CodeBlockBuilderValue>;
}

/**
 * A slider field. A {@link CodeBlockBuilderFieldBase.defaultValue} outside the bounds widens them.
 */
export interface CodeBlockBuilderSliderField extends CodeBlockBuilderFieldBase<number> {
  /**
   * The upper bound.
   */
  readonly max: number;

  /**
   * The lower bound.
   */
  readonly min: number;

  /**
   * The step.
   */
  readonly step: number;

  /**
   * The kind of the field.
   */
  readonly type: 'slider';
}

/**
 * A text field.
 */
export interface CodeBlockBuilderTextField extends CodeBlockBuilderFieldBase<string> {
  /**
   * A placeholder shown while the field is empty.
   */
  readonly placeholder?: string;

  /**
   * The kind of the field.
   */
  readonly type: 'text';

  /**
   * A pattern the value must match. While it does not, the field is marked invalid and keeps its last valid value.
   */
  readonly validationPattern?: RegExp;
}

/**
 * The value of a {@link CodeBlockBuilderField}.
 */
export type CodeBlockBuilderValue = boolean | number | readonly string[] | string;

/**
 * The parameters of {@link formatCodeBlock}.
 */
export interface FormatCodeBlockParams {
  /**
   * The fields of the code block.
   */
  readonly fields: readonly CodeBlockBuilderInput[];

  /**
   * The language of the code block.
   */
  readonly language: string;

  /**
   * The value of each field, by its key. A field missing from it holds its default value.
   */
  readonly values: ReadonlyMap<string, CodeBlockBuilderValue>;
}

/**
 * The parameters of {@link showCodeBlockBuilder}.
 */
export interface ShowCodeBlockBuilderParams extends ModalParamsBase {
  /**
   * The editor the Insert button writes into.
   *
   * @default The active editor when the modal opens.
   */
  readonly editor?: Editor | null;

  /**
   * The fields of the code block, in the order they are written into it. Required fields are shown first.
   */
  readonly fields: readonly CodeBlockBuilderInput[];

  /**
   * The language of the code block: the text after its opening fence.
   */
  readonly language: string;

  /**
   * Draws a live preview of the code block. Called once when the modal opens and again after every change.
   *
   * @param params - The preview element, the code block and the current values.
   */
  readonly onUpdatePreview?: (params: CodeBlockBuilderPreviewParams) => void;

  /**
   * The title of the modal.
   *
   * @default `'Code block builder'`
   */
  readonly title?: string;
}

const DEFAULT_SEPARATOR = ',';
const MIN_FENCE_LENGTH = 3;
const ROOT_FOLDER_PATH = '/';

type CodeBlockBuilderModalConstructorParams = ModalBaseConstructorParams<null | string> & ShowCodeBlockBuilderParams;

interface GroupState {
  readonly button: ExtraButtonComponent;
  readonly groupEl: HTMLElement;
}

class CodeBlockBuilderModal extends ModalBase<null | string> {
  private codeBlock = '';
  private readonly editor: Editor | null;
  private readonly fields: readonly CodeBlockBuilderInput[];
  private readonly groupStates: GroupState[] = [];
  private insertedCodeBlock: null | string = null;
  private readonly language: string;
  private readonly onUpdatePreview: ((params: CodeBlockBuilderPreviewParams) => void) | undefined;
  private outputComponent: null | TextAreaComponent = null;
  private previewEl: HTMLElement | null = null;
  private readonly title: string;
  private readonly values = new Map<string, CodeBlockBuilderValue>();

  public constructor(params: CodeBlockBuilderModalConstructorParams) {
    super(params);
    this.addCssClasses(CssClass.CodeBlockBuilderModal);
    this.editor = params.editor === undefined ? params.app.workspace.activeEditor?.editor ?? null : params.editor;
    this.fields = params.fields;
    this.language = params.language;
    this.onUpdatePreview = params.onUpdatePreview;
    this.title = params.title ?? t(($) => $.obsidianLib.codeBlockBuilder.title);
    for (const field of flattenFields(this.fields)) {
      this.values.set(field.key, field.defaultValue);
    }
  }

  public override onClose(): void {
    this.promiseResolve(this.insertedCodeBlock);
  }

  public override onOpen(): void {
    this.titleEl.setText(this.title);

    for (const input of this.fields) {
      if (input.type !== 'group' && input.isRequired) {
        this.renderField(this.contentEl, input);
      }
    }

    for (const input of this.fields) {
      if (input.type === 'group') {
        this.renderGroup(input);
      } else if (!input.isRequired) {
        this.renderField(this.contentEl, input);
      }
    }

    this.previewEl = this.contentEl.createDiv({ cls: CssClass.CodeBlockBuilderPreview });
    this.renderOutput();
    this.update();
  }

  private addResetButton(setting: Setting, field: CodeBlockBuilderField, reset: () => void): void {
    if (field.isRequired) {
      return;
    }

    setting.addExtraButton((button) => {
      button
        .setIcon('lucide-rotate-ccw')
        .setTooltip(t(($) => $.obsidianLib.codeBlockBuilder.reset, { value: formatValue(field, field.defaultValue) || '""' }))
        .onClick(() => {
          reset();
          this.setValue(field.key, field.defaultValue);
        });
    });
  }

  private async copy(): Promise<void> {
    try {
      await this.containerEl.win.navigator.clipboard.writeText(this.codeBlock);
      new Notice(t(($) => $.obsidianLib.codeBlockBuilder.copied));
    } catch {
      new Notice(t(($) => $.obsidianLib.codeBlockBuilder.copyFailed));
    }
  }

  private insert(): void {
    if (!this.editor) {
      new Notice(t(($) => $.obsidianLib.codeBlockBuilder.insertUnavailable));
      return;
    }

    const cursor = this.editor.getCursor('from');
    const textBeforeCursor = this.editor.getLine(cursor.line).slice(0, cursor.ch);
    const prefix = textBeforeCursor === '' ? '' : '\n';
    this.editor.replaceSelection(`${prefix}${this.codeBlock}\n`);
    this.insertedCodeBlock = this.codeBlock;
    this.close();
  }

  private renderBooleanField(setting: Setting, field: CodeBlockBuilderBooleanField): void {
    setting.addToggle((toggle) => {
      toggle
        .setValue(field.defaultValue)
        .onChange((value) => {
          this.setValue(field.key, value);
        });
      this.addResetButton(setting, field, () => {
        toggle.setValue(field.defaultValue);
      });
    });
  }

  private renderColorField(setting: Setting, field: CodeBlockBuilderColorField): void {
    setting.addColorPicker((colorPicker) => {
      colorPicker
        .setValue(field.defaultValue)
        .onChange((value) => {
          this.setValue(field.key, value);
        });
      this.addResetButton(setting, field, () => {
        colorPicker.setValue(field.defaultValue);
      });
    });
  }

  private renderConditionalDropdownField(setting: Setting, field: CodeBlockBuilderConditionalDropdownField): void {
    const initialGroupIndex = Math.max(0, field.groups.findIndex((group) => Object.hasOwn(toRecord(group.options), field.defaultValue)));
    const groupDropdown = new DropdownComponent(setting.controlEl);
    for (const [index, group] of field.groups.entries()) {
      groupDropdown.addOption(String(index), group.name);
    }
    groupDropdown.setValue(String(initialGroupIndex));

    const optionDropdown = new DropdownComponent(setting.controlEl);

    function fillOptions(groupIndex: number, value?: string): string {
      const options = toRecord(field.groups[groupIndex]?.options ?? []);
      const selectedValue = value ?? Object.keys(options)[0] ?? '';
      optionDropdown.selectEl.empty();
      optionDropdown.addOptions(options);
      optionDropdown.setValue(selectedValue);
      return selectedValue;
    }

    fillOptions(initialGroupIndex, field.defaultValue);
    optionDropdown.onChange((value) => {
      this.setValue(field.key, value);
    });

    groupDropdown.onChange((value) => {
      this.setValue(field.key, fillOptions(Number(value)));
    });

    this.addResetButton(setting, field, () => {
      groupDropdown.setValue(String(initialGroupIndex));
      fillOptions(initialGroupIndex, field.defaultValue);
    });
  }

  private renderDropdownField(setting: Setting, field: CodeBlockBuilderDropdownField): void {
    setting.addDropdown((dropdown) => {
      dropdown
        .addOptions(toRecord(field.options))
        .setValue(field.defaultValue)
        .onChange((value) => {
          this.setValue(field.key, value);
        });
      this.addResetButton(setting, field, () => {
        dropdown.setValue(field.defaultValue);
      });
    });
  }

  private renderField(containerEl: HTMLElement, field: CodeBlockBuilderField): void {
    const setting = new Setting(containerEl).setName(field.name);
    if (field.description !== undefined) {
      setting.setDesc(field.description);
    }

    switch (field.type) {
      case 'boolean': {
        this.renderBooleanField(setting, field);
        break;
      }
      case 'color': {
        this.renderColorField(setting, field);
        break;
      }
      case 'conditionalDropdown': {
        this.renderConditionalDropdownField(setting, field);
        break;
      }
      case 'dropdown': {
        this.renderDropdownField(setting, field);
        break;
      }
      case 'folder': {
        this.renderFolderField(setting, field);
        break;
      }
      case 'multipleDropdown': {
        this.renderMultipleDropdownField(setting, field);
        break;
      }
      case 'slider': {
        this.renderSliderField(setting, field);
        break;
      }
      case 'text': {
        this.renderTextField(setting, field);
        break;
      }
      default: {
        assertNever(field);
      }
    }
  }

  private renderFolderField(setting: Setting, field: CodeBlockBuilderFolderField): void {
    const options: Record<string, string> = {
      [ROOT_FOLDER_PATH]: t(($) => $.obsidianLib.codeBlockBuilder.rootFolder)
    };
    const folderPaths = this.app.vault.getAllFolders(false).map((folder) => folder.path).sort((a, b) => a.localeCompare(b));
    for (const folderPath of folderPaths) {
      options[folderPath] = folderPath;
    }

    options[field.defaultValue] ??= field.defaultValue;

    setting.addDropdown((dropdown) => {
      dropdown
        .addOptions(options)
        .setValue(field.defaultValue)
        .onChange((value) => {
          this.setValue(field.key, value);
        });
      this.addResetButton(setting, field, () => {
        dropdown.setValue(field.defaultValue);
      });
    });
  }

  private renderGroup(group: CodeBlockBuilderGroup): void {
    const groupEl = this.contentEl.createDiv({ cls: CssClass.CodeBlockBuilderGroup });
    const headingSetting = new Setting(groupEl).setName(group.name).setHeading();
    const bodyEl = groupEl.createDiv({ cls: CssClass.CodeBlockBuilderGroupBody });

    groupEl.addClass(CssClass.IsCollapsed);
    headingSetting.addExtraButton((button) => {
      const groupState = { button, groupEl };
      this.groupStates.push(groupState);
      updateGroupIcon(groupState);
      button.onClick(() => {
        this.setGroupExpanded(groupEl, groupEl.hasClass(CssClass.IsCollapsed));
      });
    });

    for (const field of group.fields) {
      this.renderField(bodyEl, field);
    }

    if (group.isInitiallyExpanded) {
      this.setGroupExpanded(groupEl, true);
    }
  }

  private renderMultipleDropdownField(setting: Setting, field: CodeBlockBuilderMultipleDropdownField): void {
    const dropdown = new MultipleDropdownComponent(setting.controlEl)
      .addOptions(toRecord(field.options))
      .setValue(field.defaultValue)
      .onChange((value) => {
        this.setValue(field.key, value);
      });
    setting.addComponent(() => dropdown);
    this.addResetButton(setting, field, () => {
      dropdown.setValue(field.defaultValue);
    });
  }

  private renderOutput(): void {
    const setting = new Setting(this.contentEl).setName(t(($) => $.obsidianLib.codeBlockBuilder.output));
    setting.settingEl.addClass(CssClass.CodeBlockBuilderOutput);
    setting.addTextArea((textArea) => {
      this.outputComponent = textArea;
      textArea.inputEl.readOnly = true;
    });
    setting.addExtraButton((button) => {
      button
        .setIcon('lucide-copy')
        .setTooltip(t(($) => $.obsidianLib.codeBlockBuilder.copy))
        .onClick(() => {
          invokeAsyncSafely(() => this.copy());
        });
    });
    setting.addExtraButton((button) => {
      button
        .setIcon('lucide-file-input')
        .setTooltip(t(($) => this.editor ? $.obsidianLib.codeBlockBuilder.insert : $.obsidianLib.codeBlockBuilder.insertUnavailable))
        .onClick(() => {
          this.insert();
        });
    });
  }

  private renderSliderField(setting: Setting, field: CodeBlockBuilderSliderField): void {
    setting.addSlider((slider) => {
      slider
        .setLimits(Math.min(field.min, field.defaultValue), Math.max(field.max, field.defaultValue), field.step)
        .setValue(field.defaultValue)
        .onChange((value) => {
          this.setValue(field.key, value);
        });
      this.addResetButton(setting, field, () => {
        slider.setValue(field.defaultValue);
      });
    });
  }

  private renderTextField(setting: Setting, field: CodeBlockBuilderTextField): void {
    setting.addText((text) => {
      text
        .setPlaceholder(field.placeholder ?? '')
        .setValue(field.defaultValue)
        .onChange((value) => {
          if (field.validationPattern && !doesMatchPattern(field.validationPattern, value)) {
            text.inputEl.setCustomValidity(t(($) => $.obsidianLib.codeBlockBuilder.invalidValue));
            return;
          }

          text.inputEl.setCustomValidity('');
          this.setValue(field.key, value);
        });
      this.addResetButton(setting, field, () => {
        text.setValue(field.defaultValue);
        text.inputEl.setCustomValidity('');
      });
    });
  }

  private setGroupExpanded(groupEl: HTMLElement, isExpanded: boolean): void {
    for (const groupState of this.groupStates) {
      const shouldExpand = isExpanded && groupState.groupEl === groupEl;
      groupState.groupEl.toggleClass(CssClass.IsCollapsed, !shouldExpand);
      updateGroupIcon(groupState);
    }
  }

  private setValue(key: string, value: CodeBlockBuilderValue): void {
    this.values.set(key, value);
    this.update();
  }

  private update(): void {
    this.codeBlock = formatCodeBlock({
      fields: this.fields,
      language: this.language,
      values: this.values
    });

    // Only reached once `onOpen` has rendered the output and the preview element.
    const outputComponent = ensureNonNullable(this.outputComponent);
    outputComponent.setValue(this.codeBlock);
    outputComponent.inputEl.rows = this.codeBlock.split('\n').length;

    if (this.onUpdatePreview) {
      this.onUpdatePreview({
        codeBlock: this.codeBlock,
        previewEl: ensureNonNullable(this.previewEl),
        values: this.values
      });
    }
  }
}

/**
 * Formats a code block from its fields and their values.
 *
 * Each field holding a value other than its default, or marked {@link CodeBlockBuilderFieldBase.isRequired}, writes one
 * line, in the order of the fields; an empty value writes nothing. The fence is one backtick longer than the longest
 * backtick run in the lines, and never shorter than three.
 *
 * @param params - The fields, the language and the values.
 * @returns The code block, without a trailing newline.
 */
export function formatCodeBlock(params: FormatCodeBlockParams): string {
  const lines: string[] = [];
  for (const field of flattenFields(params.fields)) {
    const value = params.values.get(field.key) ?? field.defaultValue;
    const formattedValue = formatValue(field, value);
    if (formattedValue === '') {
      continue;
    }

    if (!field.isRequired && isSameValue(value, field.defaultValue)) {
      continue;
    }

    lines.push(field.shouldOmitKey ? formattedValue : `${field.key}: ${formattedValue}`);
  }

  const body = lines.join('\n');
  const longestBacktickRun = Math.max(0, ...Array.from(body.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestBacktickRun + 1));
  return lines.length === 0 ? `${fence}${params.language}\n${fence}` : `${fence}${params.language}\n${body}\n${fence}`;
}

/**
 * Opens the code block builder modal.
 *
 * @param params - The fields of the code block and how to present them.
 * @returns A {@link Promise} that resolves with the code block when the user inserted it into the note, or with `null`
 * when the modal was closed otherwise.
 */
export async function showCodeBlockBuilder(params: ShowCodeBlockBuilderParams): Promise<null | string> {
  return await showModal<null | string>((promiseResolve) =>
    new CodeBlockBuilderModal({
      ...params,
      promiseResolve
    })
  );
}

function doesMatchPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function flattenFields(inputs: readonly CodeBlockBuilderInput[]): CodeBlockBuilderField[] {
  return inputs.flatMap((input) => input.type === 'group' ? input.fields : [input]);
}

function formatValue(field: CodeBlockBuilderField, value: CodeBlockBuilderValue): string {
  const separator = field.type === 'multipleDropdown' ? field.separator ?? DEFAULT_SEPARATOR : DEFAULT_SEPARATOR;
  return isStringArray(value) ? value.join(separator) : String(value);
}

function isSameValue(a: CodeBlockBuilderValue, b: CodeBlockBuilderValue): boolean {
  return isStringArray(a) && isStringArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

function toRecord(options: CodeBlockBuilderOptions): Record<string, string> {
  return isStringArray(options) ? Object.fromEntries(options.map((option) => [option, option])) : { ...options };
}

function updateGroupIcon(groupState: GroupState): void {
  groupState.button.setIcon(groupState.groupEl.hasClass(CssClass.IsCollapsed) ? 'lucide-chevron-down' : 'lucide-chevron-up');
}
