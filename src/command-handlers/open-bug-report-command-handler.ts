/**
 * @file
 *
 * Handles the "Report a bug" command.
 */

import type { App } from 'obsidian';
import type { Promisable } from 'type-fest';

import { Notice } from 'obsidian';

import type { BugReportDiagnosticSection } from '../bug-report-diagnostics.ts';

import {
  buildBugReportIssueFormLink,
  formatBugReportEnvironment,
  getBugReportEnvironment,
  getBugReportIssueFormUrl
} from '../bug-report.ts';
import { t } from '../i18n/i18n.ts';
import { copyTextManually } from '../modals/copy-text-manually.ts';
import { reviewBugReportDiagnostics } from '../modals/review-bug-report-diagnostics.ts';
import { OpenGitHubCommandHandler } from './open-git-hub-command-handler.ts';

/**
 * Constructor parameters for {@link OpenBugReportCommandHandler}.
 */
export interface OpenBugReportCommandHandlerConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * Gets the optional diagnostics the report can carry, such as a `BugReportLogBuffer`'s section or the
   * plugin's own redacted settings. Called each time the command runs. When it returns any section, the
   * user reviews them and chooses which to include before the form opens; a potentially private section
   * starts excluded. Leave it out to open the form with the environment only, as before.
   */
  readonly getDiagnostics?: () => Promisable<readonly BugReportDiagnosticSection[]>;

  /**
   * The plugin's GitHub repository, as `owner/name`.
   */
  readonly gitHubRepo: string;

  /**
   * The most characters the encoded link may have before the report moves to the clipboard.
   *
   * @default `DEFAULT_BUG_REPORT_MAX_URL_LENGTH`
   */
  readonly maxUrlLength?: number;

  /**
   * The id of the reporting plugin.
   */
  readonly pluginId: string;
}

// Long enough to read the paste instruction while the browser opens.
const CLIPBOARD_NOTICE_DURATION_IN_MILLISECONDS = 15_000;

/**
 * A command handler that opens the plugin's bug-report issue form on GitHub, prefilled with the
 * environment and any diagnostics the user agreed to include. See {@link getBugReportIssueFormUrl} for the
 * field ids the form must use, and {@link buildBugReportIssueFormLink} for what happens to a report too long
 * for a link.
 */
export class OpenBugReportCommandHandler extends OpenGitHubCommandHandler {
  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * Gets the optional diagnostics the report can carry.
   */
  protected readonly getDiagnostics: (() => Promisable<readonly BugReportDiagnosticSection[]>) | undefined;

  /**
   * The most characters the encoded link may have before the report moves to the clipboard.
   */
  protected readonly maxUrlLength: number | undefined;

  /**
   * The id of the reporting plugin.
   */
  protected readonly pluginId: string;

  /**
   * Constructs a new instance.
   *
   * @param params - Constructor parameters.
   */
  public constructor(params: OpenBugReportCommandHandlerConstructorParams) {
    super({
      gitHubRepo: params.gitHubRepo,
      icon: 'bug',
      id: 'report-bug',
      name: 'Report a bug'
    });

    this.app = params.app;
    this.getDiagnostics = params.getDiagnostics;
    this.maxUrlLength = params.maxUrlLength;
    this.pluginId = params.pluginId;
  }

  /**
   * Lets the user review the diagnostics, if any, then opens the issue form. When the report is too long
   * for a link, it is copied to the clipboard first, or shown for copying by hand when the clipboard
   * refuses it.
   */
  public override async execute(): Promise<void> {
    if (!this.canExecute()) {
      return;
    }

    const environment = await getBugReportEnvironment({ app: this.app, pluginId: this.pluginId });
    const sections = await this.getDiagnostics?.() ?? [];
    let diagnostics: readonly BugReportDiagnosticSection[] = [];
    if (sections.length > 0) {
      const reviewedSections = await reviewBugReportDiagnostics({
        alwaysIncludedText: formatBugReportEnvironment(environment),
        app: this.app,
        sections
      });
      if (reviewedSections === null) {
        return;
      }
      diagnostics = reviewedSections;
    }

    const link = buildBugReportIssueFormLink({
      diagnostics,
      environment,
      gitHubRepo: this.gitHubRepo,
      ...this.maxUrlLength !== undefined && { maxUrlLength: this.maxUrlLength }
    });

    if (link.clipboardText !== null && !await this.copyReport(link.clipboardText)) {
      return;
    }

    window.open(link.url, '_blank');
  }

  /**
   * Builds the prefilled bug-report URL, with the environment only.
   *
   * @returns The link.
   */
  protected override async getUrl(): Promise<string> {
    return getBugReportIssueFormUrl({
      app: this.app,
      gitHubRepo: this.gitHubRepo,
      pluginId: this.pluginId
    });
  }

  private async copyReport(text: string): Promise<boolean> {
    try {
      // The clipboard of the focused window: a popout's document is the one that holds the focus.
      await activeWindow.navigator.clipboard.writeText(text);
      new Notice(t(($) => $.obsidianLib.bugReport.clipboardCopied), CLIPBOARD_NOTICE_DURATION_IN_MILLISECONDS);
      return true;
    } catch {
      return await copyTextManually({
        app: this.app,
        message: t(($) => $.obsidianLib.bugReport.copyManuallyMessage),
        okButtonText: t(($) => $.obsidianLib.bugReport.openIssueForm),
        text,
        title: t(($) => $.obsidianLib.bugReport.copyManuallyTitle)
      });
    }
  }
}
