/**
 * @file
 *
 * Handles the "Start a discussion" command.
 */

import type { GetGitHubDiscussionUrlParams } from '../git-hub-discussion.ts';

import { getGitHubDiscussionUrl } from '../git-hub-discussion.ts';
import { OpenGitHubCommandHandler } from './open-git-hub-command-handler.ts';

/**
 * Constructor parameters for {@link OpenDiscussionCommandHandler}.
 */
export interface OpenDiscussionCommandHandlerConstructorParams extends GetGitHubDiscussionUrlParams {
  /**
   * Whether the repository has Discussions enabled. When `false`, the command is unavailable and
   * execution does not open a browser. Prefer omitting registration altogether in that case.
   */
  readonly isDiscussionsEnabled: boolean;
}

/**
 * Opens a new discussion in the plugin's repository. Unavailable when Discussions is disabled.
 *
 * See the [community commands guide](https://mnaoumov.dev/obsidian-lib/guides/community-commands/)
 * and [behavioral tests](https://github.com/mnaoumov/obsidian-lib/blob/main/src/command-handlers/open-discussion-command-handler.test.ts).
 */
export class OpenDiscussionCommandHandler extends OpenGitHubCommandHandler {
  private readonly params: OpenDiscussionCommandHandlerConstructorParams;

  /**
   * Constructs a new instance.
   *
   * @param params - Constructor parameters.
   */
  public constructor(params: OpenDiscussionCommandHandlerConstructorParams) {
    super({ gitHubRepo: params.gitHubRepo, icon: 'messages-square', id: 'start-discussion', name: 'Start a discussion' });
    this.params = params;
  }

  /**
   * Checks the repository's declared Discussions capability.
   *
   * @returns Whether the command is available.
   */
  protected override canExecute(): boolean {
    return this.params.isDiscussionsEnabled;
  }

  /**
   * Builds the new-discussion URL.
   *
   * @returns The link.
   */
  protected override getUrl(): string {
    return getGitHubDiscussionUrl(this.params);
  }
}
