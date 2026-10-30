/**
 * @file
 *
 * Handles the "Report a bug" command.
 */

import type { App } from 'obsidian';

import { getBugReportIssueFormUrl } from '../bug-report.ts';
import { GlobalCommandHandler } from './global-command-handler.ts';

/**
 * Constructor parameters for {@link OpenBugReportCommandHandler}.
 */
export interface OpenBugReportCommandHandlerConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The plugin's GitHub repository, as `owner/name`.
   */
  readonly gitHubRepo: string;

  /**
   * The id of the reporting plugin.
   */
  readonly pluginId: string;
}

/**
 * A command handler that opens the plugin's bug-report issue form on GitHub, prefilled with the
 * environment. See {@link getBugReportIssueFormUrl} for the field ids the form must use.
 */
export class OpenBugReportCommandHandler extends GlobalCommandHandler {
  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * The plugin's GitHub repository, as `owner/name`.
   */
  protected readonly gitHubRepo: string;

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
      icon: 'bug',
      id: 'report-bug',
      name: 'Report a bug'
    });

    this.app = params.app;
    this.pluginId = params.pluginId;
    this.gitHubRepo = params.gitHubRepo;
  }

  /**
   * Executes the command, opening the prefilled issue form in the browser.
   */
  public override async execute(): Promise<void> {
    const url = await getBugReportIssueFormUrl({
      app: this.app,
      gitHubRepo: this.gitHubRepo,
      pluginId: this.pluginId
    });
    window.open(url, '_blank');
  }
}
