/**
 * @file
 *
 * A modal that lists the recovery copies of a plugin's `data.json` kept on this device, and lets the user pick one to
 * restore, or, for a copy that is not valid JSON, to copy its raw text for a repair by hand.
 */

import { ButtonComponent } from 'obsidian';

import type { SettingsRecoveryCopy } from '../settings-recovery.ts';
import type {
  ModalBaseConstructorParams,
  ModalParamsBase
} from './modal.ts';

import { CssClass } from '../css-class.ts';
import { t } from '../i18n/i18n.ts';
import {
  isRestorableSettingsRecoveryCopy,
  SettingsRecoveryReason
} from '../settings-recovery.ts';
import {
  ModalBase,
  showModal
} from './modal.ts';

/**
 * The longest preview of a copy's raw text the modal shows, in characters. The rest is cut off with an ellipsis.
 */
export const SETTINGS_RECOVERY_COPY_PREVIEW_LENGTH = 500;

/**
 * What the user chose to do with a recovery copy.
 */
export enum SettingsRecoveryCopyAction {
  /**
   * Copy the copy's raw text to the clipboard, for a copy that cannot be restored as it is.
   */
  CopyText = 'copy-text',

  /**
   * Restore the copy.
   */
  Restore = 'restore'
}

/**
 * Parameters for {@link selectSettingsRecoveryCopy}.
 */
export interface SelectSettingsRecoveryCopyParams extends ModalParamsBase {
  /**
   * The copies to list, in the order to show them.
   */
  readonly copies: readonly SettingsRecoveryCopy[];
}

/**
 * The user's choice in the recovery copies modal.
 */
export interface SettingsRecoveryCopySelection {
  /**
   * What to do with the copy.
   */
  readonly action: SettingsRecoveryCopyAction;

  /**
   * The chosen copy.
   */
  readonly copy: SettingsRecoveryCopy;
}

type SettingsRecoveryCopiesModalConstructorParams =
  & ModalBaseConstructorParams<null | SettingsRecoveryCopySelection>
  & SelectSettingsRecoveryCopyParams;

class SettingsRecoveryCopiesModal extends ModalBase<null | SettingsRecoveryCopySelection> {
  private chosen: null | SettingsRecoveryCopySelection = null;
  private readonly copies: readonly SettingsRecoveryCopy[];

  public constructor(params: SettingsRecoveryCopiesModalConstructorParams) {
    super(params);
    this.addCssClasses(CssClass.SettingsRecoveryCopiesModal);
    this.copies = params.copies;
  }

  public override onClose(): void {
    this.promiseResolve(this.chosen);
  }

  public override onOpen(): void {
    this.titleEl.setText(t(($) => $.obsidianLib.settingsManagement.recoveryCopiesTitle));
    this.contentEl.createEl('p', { text: t(($) => $.obsidianLib.settingsManagement.recoveryCopiesMessage) });

    for (const copy of this.copies) {
      this.renderCopy(copy);
    }

    const buttonContainerEl = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancelButton = new ButtonComponent(buttonContainerEl);
    cancelButton.setButtonText(t(($) => $.obsidianLib.buttons.cancel));
    cancelButton.onClick(this.close.bind(this));
    cancelButton.setClass(CssClass.CancelButton);
  }

  private renderCopy(copy: SettingsRecoveryCopy): void {
    const copyEl = this.contentEl.createDiv({ cls: CssClass.SettingsRecoveryCopy });
    copyEl.dataset['copyId'] = copy.id;
    copyEl.createEl('h3', {
      text: t(($) => $.obsidianLib.settingsManagement.recoveryCopyHeading, {
        date: formatKeptAt(copy.keptAt),
        reason: formatReason(copy.reason)
      })
    });
    copyEl.createEl('pre', { cls: CssClass.SettingsRecoveryCopyPreview, text: getPreview(copy.rawText) });

    const isRestorable = isRestorableSettingsRecoveryCopy(copy);
    const button = new ButtonComponent(copyEl);
    if (isRestorable) {
      button.setButtonText(t(($) => $.obsidianLib.settingsManagement.recoveryCopyRestore));
      button.setCta();
    } else {
      button.setButtonText(t(($) => $.obsidianLib.settingsManagement.recoveryCopyCopyText));
    }
    button.onClick(() => {
      this.chosen = {
        action: isRestorable ? SettingsRecoveryCopyAction.Restore : SettingsRecoveryCopyAction.CopyText,
        copy
      };
      this.close();
    });
  }
}

/**
 * Formats when a recovery copy was kept, in the user's locale.
 *
 * @param keptAt - When the copy was kept, in milliseconds since the Unix epoch.
 * @returns The formatted date and time.
 */
export function formatKeptAt(keptAt: number): string {
  return new Date(keptAt).toLocaleString();
}

/**
 * Lists recovery copies and lets the user pick one to restore, or one whose text to copy when it cannot be restored as
 * it is.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} that resolves with the user's choice, or `null` when the user closed the modal.
 */
export async function selectSettingsRecoveryCopy(params: SelectSettingsRecoveryCopyParams): Promise<null | SettingsRecoveryCopySelection> {
  return await showModal<null | SettingsRecoveryCopySelection>((promiseResolve) =>
    new SettingsRecoveryCopiesModal({
      ...params,
      promiseResolve
    })
  );
}

function formatReason(reason: SettingsRecoveryReason): string {
  const reasonFormatters: Record<SettingsRecoveryReason, () => string> = {
    [SettingsRecoveryReason.InvalidJson]: () => t(($) => $.obsidianLib.settingsManagement.recoveryCopyReasonInvalidJson),
    [SettingsRecoveryReason.LossyRewrite]: () => t(($) => $.obsidianLib.settingsManagement.recoveryCopyReasonLossyRewrite)
  };
  return reasonFormatters[reason]();
}

function getPreview(rawText: string): string {
  return rawText.length <= SETTINGS_RECOVERY_COPY_PREVIEW_LENGTH ? rawText : `${rawText.slice(0, SETTINGS_RECOVERY_COPY_PREVIEW_LENGTH)}…`;
}
