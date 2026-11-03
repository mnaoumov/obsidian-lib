/**
 * @file
 *
 * Shared browser-opening behavior for GitHub commands.
 */

import type { Promisable } from 'type-fest';

import type { CommandHandlerConstructorParams } from './command-handler.ts';

import { GlobalCommandHandler } from './global-command-handler.ts';

/**
 * Constructor parameters for {@link OpenGitHubCommandHandler}.
 */
export interface OpenGitHubCommandHandlerConstructorParams extends CommandHandlerConstructorParams {
  /**
   * The plugin's repository, as `owner/name`.
   */
  readonly gitHubRepo: string;
}

/**
 * Base class for commands that open a page in the plugin's GitHub repository.
 */
export abstract class OpenGitHubCommandHandler extends GlobalCommandHandler {
  /**
   * The plugin's repository, as `owner/name`.
   */
  protected readonly gitHubRepo: string;

  /**
   * Constructs a new instance.
   *
   * @param params - Constructor parameters.
   */
  public constructor(params: OpenGitHubCommandHandlerConstructorParams) {
    super(params);
    this.gitHubRepo = params.gitHubRepo;
  }

  /**
   * Opens the page in the browser when the command is available.
   */
  public override async execute(): Promise<void> {
    if (this.canExecute()) {
      window.open(await this.getUrl(), '_blank');
    }
  }

  /**
   * Builds the destination URL.
   *
   * @returns The link.
   */
  protected abstract getUrl(): Promisable<string>;
}
