import {
  describe,
  expect,
  it
} from 'vitest';

import { getGitHubDiscussionUrl } from './git-hub-discussion.ts';

describe('getGitHubDiscussionUrl', () => {
  it('should select the Q&A category by default', () => {
    expect(getGitHubDiscussionUrl({ gitHubRepo: 'owner/repo' })).toBe('https://github.com/owner/repo/discussions/new?category=q-a');
  });

  it('should encode a custom category', () => {
    const url = new URL(getGitHubDiscussionUrl({ category: 'ideas & feedback', gitHubRepo: 'owner/repo' }));
    expect(url.searchParams.get('category')).toBe('ideas & feedback');
  });
});
