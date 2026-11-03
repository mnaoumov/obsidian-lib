/**
 * @file
 *
 * Links to GitHub's new-discussion page.
 */

/**
 * Parameters for {@link getGitHubDiscussionUrl}.
 */
export interface GetGitHubDiscussionUrlParams {
  /**
   * The category slug, such as `q-a` or `ideas`. The repository must have this category.
   *
   * @default `'q-a'`
   */
  readonly category?: string;
  /**
   * The repository, as `owner/name`.
   */
  readonly gitHubRepo: string;
}

/**
 * Gets a new-discussion URL with a category selected. Callers must enable Discussions in the repository.
 *
 * @param params - The parameters.
 * @returns The link.
 */
export function getGitHubDiscussionUrl(params: GetGitHubDiscussionUrlParams): string {
  const searchParams = new URLSearchParams({ category: params.category ?? 'q-a' });
  return `https://github.com/${params.gitHubRepo}/discussions/new?${searchParams.toString()}`;
}
