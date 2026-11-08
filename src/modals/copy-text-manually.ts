/**
 * @file
 *
 * A modal that shows a text for the user to copy by hand, for when writing it to the clipboard failed.
 */

import {
  ButtonComponent,
  TextAreaComponent
} from 'obsidian';

import type {
  ModalBaseConstructorParams,
  ModalParamsBase
} from './modal.ts';

import { CssClass } from '../css-class.ts';
import { t } from '../i18n/i18n.ts';
import {
  ModalBase,
  showModal
} from './modal.ts';

/**
 * Parameters for {@link copyTextManually}.
 */
export interface CopyTextManuallyParams extends ModalParamsBase {
  /**
   * What the user is asked to do with the text.
   */
  readonly message: string;

  /**
   * A text for the button that continues.
   */
  readonly okButtonText?: string;

  /**
   * The text to copy.
   */
  readonly text: string;

  /**
   * A title of the modal.
   *
   * @default `''`
   */
  readonly title?: string;
}

const TEXT_AREA_ROWS = 12;

type CopyTextManuallyModalConstructorParams = CopyTextManuallyParams & ModalBaseConstructorParams<boolean>;

class CopyTextManuallyModal extends ModalBase<boolean> {
  private isConfirmed = false;
  private readonly message: string;
  private readonly okButtonText: string;
  private readonly text: string;
  private readonly title: string;

  public constructor(params: CopyTextManuallyModalConstructorParams) {
    super(params);
    this.addCssClasses(CssClass.CopyTextManuallyModal);
    this.message = params.message;
    this.okButtonText = params.okButtonText ?? t(($) => $.obsidianLib.buttons.ok);
    this.text = params.text;
    this.title = params.title ?? '';
  }

  public override onClose(): void {
    this.promiseResolve(this.isConfirmed);
  }

  public override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl('p', { text: this.message });

    const textArea = new TextAreaComponent(this.contentEl);
    textArea.setValue(this.text);
    textArea.inputEl.readOnly = true;
    textArea.inputEl.rows = TEXT_AREA_ROWS;
    textArea.inputEl.addClass(CssClass.CopyTextManuallyText);
    textArea.inputEl.addEventListener('focus', () => {
      textArea.inputEl.select();
    });

    const buttonContainerEl = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const okButton = new ButtonComponent(buttonContainerEl);
    okButton.setButtonText(this.okButtonText);
    okButton.setCta();
    okButton.onClick(() => {
      this.isConfirmed = true;
      this.close();
    });
    okButton.setClass(CssClass.OkButton);

    const cancelButton = new ButtonComponent(buttonContainerEl);
    cancelButton.setButtonText(t(($) => $.obsidianLib.buttons.cancel));
    cancelButton.onClick(this.close.bind(this));
    cancelButton.setClass(CssClass.CancelButton);

    textArea.inputEl.focus();
  }
}

/**
 * Shows a read-only text, selected when focused, for the user to copy by hand, with a button that
 * continues and one that cancels.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} that resolves with whether the user continued.
 */
// eslint-disable-next-line unicorn/consistent-boolean-name -- `boolean` gives better DX than enum, as in `confirm`.
export async function copyTextManually(params: CopyTextManuallyParams): Promise<boolean> {
  return await showModal<boolean>((promiseResolve) =>
    new CopyTextManuallyModal({
      ...params,
      promiseResolve
    })
  );
}
