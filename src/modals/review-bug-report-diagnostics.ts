/**
 * @file
 *
 * A modal where the user reviews, and chooses, the diagnostics a bug report will carry, before anything
 * leaves Obsidian.
 */

import {
  ButtonComponent,
  Setting
} from 'obsidian';

import type { BugReportDiagnosticSection } from '../bug-report-diagnostics.ts';
import type {
  ModalBaseConstructorParams,
  ModalParamsBase
} from './modal.ts';

import { formatBugReportDiagnostics } from '../bug-report-diagnostics.ts';
import { CssClass } from '../css-class.ts';
import { t } from '../i18n/i18n.ts';
import {
  ModalBase,
  showModal
} from './modal.ts';

/**
 * Parameters for {@link reviewBugReportDiagnostics}.
 */
export interface ReviewBugReportDiagnosticsParams extends ModalParamsBase {
  /**
   * The text the report always carries, shown first in the preview, such as the formatted environment.
   */
  readonly alwaysIncludedText?: string;

  /**
   * The sections the user may include. A potentially private section starts excluded.
   */
  readonly sections: readonly BugReportDiagnosticSection[];
}

type ReviewBugReportDiagnosticsModalConstructorParams =
  & ModalBaseConstructorParams<null | readonly BugReportDiagnosticSection[]>
  & ReviewBugReportDiagnosticsParams;

class ReviewBugReportDiagnosticsModal extends ModalBase<null | readonly BugReportDiagnosticSection[]> {
  private readonly alwaysIncludedText: string;
  private readonly includedSectionIds = new Set<string>();
  private isContinued = false;
  private previewEl: HTMLElement | null = null;
  private readonly sections: readonly BugReportDiagnosticSection[];

  public constructor(params: ReviewBugReportDiagnosticsModalConstructorParams) {
    super(params);
    this.addCssClasses(CssClass.BugReportReviewModal);
    this.alwaysIncludedText = params.alwaysIncludedText ?? '';
    this.sections = params.sections;
    for (const section of this.sections) {
      if (!section.isPotentiallyPrivate) {
        this.includedSectionIds.add(section.id);
      }
    }
  }

  public override onClose(): void {
    this.promiseResolve(this.isContinued ? this.getIncludedSections() : null);
  }

  public override onOpen(): void {
    this.titleEl.setText(t(($) => $.obsidianLib.bugReport.reviewTitle));
    this.contentEl.createEl('p', { text: t(($) => $.obsidianLib.bugReport.reviewMessage) });

    for (const section of this.sections) {
      const setting = new Setting(this.contentEl)
        .setName(section.title)
        .addToggle((toggle) => {
          toggle.setValue(this.includedSectionIds.has(section.id));
          toggle.onChange((value) => {
            if (value) {
              this.includedSectionIds.add(section.id);
            } else {
              this.includedSectionIds.delete(section.id);
            }
            this.updatePreview();
          });
        });
      if (section.isPotentiallyPrivate) {
        setting.setDesc(t(($) => $.obsidianLib.bugReport.potentiallyPrivate));
      }
    }

    this.contentEl.createEl('p', { text: t(($) => $.obsidianLib.bugReport.previewHeading) });
    this.previewEl = this.contentEl.createEl('pre', { cls: CssClass.BugReportPreview });
    this.updatePreview();

    const buttonContainerEl = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const continueButton = new ButtonComponent(buttonContainerEl);
    continueButton.setButtonText(t(($) => $.obsidianLib.bugReport.continue));
    continueButton.setCta();
    continueButton.onClick(() => {
      this.isContinued = true;
      this.close();
    });
    continueButton.setClass(CssClass.OkButton);

    const cancelButton = new ButtonComponent(buttonContainerEl);
    cancelButton.setButtonText(t(($) => $.obsidianLib.buttons.cancel));
    cancelButton.onClick(this.close.bind(this));
    cancelButton.setClass(CssClass.CancelButton);
  }

  private getIncludedSections(): readonly BugReportDiagnosticSection[] {
    return this.sections.filter((section) => this.includedSectionIds.has(section.id));
  }

  private updatePreview(): void {
    const diagnostics = formatBugReportDiagnostics(this.getIncludedSections());
    const parts = [this.alwaysIncludedText, diagnostics].filter((part) => part !== '');
    this.previewEl?.setText(parts.join('\n\n'));
  }
}

/**
 * Shows the user the diagnostics a bug report can carry, with a switch per section and a preview of the
 * exact text, and lets them continue or cancel. A potentially private section starts switched off.
 *
 * @param params - The parameters.
 * @returns The sections the user chose, in their original order, or `null` when the user cancelled.
 */
export async function reviewBugReportDiagnostics(params: ReviewBugReportDiagnosticsParams): Promise<null | readonly BugReportDiagnosticSection[]> {
  return await showModal<null | readonly BugReportDiagnosticSection[]>((promiseResolve) =>
    new ReviewBugReportDiagnosticsModal({
      ...params,
      promiseResolve
    })
  );
}
