/**
 * @file
 *
 * Handles the "Request a feature" command.
 */

import type { GetFeatureRequestIssueFormUrlParams } from '../feature-request.ts';

import { getFeatureRequestIssueFormUrl } from '../feature-request.ts';
import { OpenGitHubCommandHandler } from './open-git-hub-command-handler.ts';

/**
 * Constructor parameters for {@link OpenFeatureRequestCommandHandler}.
 */
export type OpenFeatureRequestCommandHandlerConstructorParams = GetFeatureRequestIssueFormUrlParams;

/**
 * Opens the plugin's feature-request form, prefilling only the plugin version.
 *
 * See the [community commands guide](https://mnaoumov.dev/obsidian-lib/guides/community-commands/)
 * and [behavioral tests](https://github.com/mnaoumov/obsidian-lib/blob/main/src/command-handlers/open-feature-request-command-handler.test.ts).
 */
export class OpenFeatureRequestCommandHandler extends OpenGitHubCommandHandler {
  private readonly params: OpenFeatureRequestCommandHandlerConstructorParams;

  /**
   * Constructs a new instance.
   *
   * @param params - Constructor parameters.
   */
  public constructor(params: OpenFeatureRequestCommandHandlerConstructorParams) {
    super({ gitHubRepo: params.gitHubRepo, icon: 'lightbulb', id: 'request-feature', name: 'Request a feature' });
    this.params = params;
  }

  /**
   * Builds the prefilled feature-request URL.
   *
   * @returns The link.
   */
  protected override getUrl(): string {
    return getFeatureRequestIssueFormUrl(this.params);
  }
}
