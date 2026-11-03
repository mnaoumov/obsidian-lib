// @vitest-environment jsdom

import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { OpenDiscussionCommandHandler } from './open-discussion-command-handler.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenDiscussionCommandHandler', () => {
  it('should offer Start a discussion and open Q&A by default', async () => {
    const handler = new OpenDiscussionCommandHandler({ gitHubRepo: 'owner/repo', isDiscussionsEnabled: true });
    const command = handler.buildCommand();
    expect(command).toMatchObject({ icon: 'messages-square', id: 'start-discussion', name: 'Start a discussion' });
    expect(command.checkCallback?.(true)).toBe(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await handler.execute();
    expect(open).toHaveBeenCalledWith('https://github.com/owner/repo/discussions/new?category=q-a', '_blank');
  });

  it('should open the chosen category', async () => {
    const handler = new OpenDiscussionCommandHandler({ category: 'ideas', gitHubRepo: 'owner/repo', isDiscussionsEnabled: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await handler.execute();
    expect(open).toHaveBeenCalledWith('https://github.com/owner/repo/discussions/new?category=ideas', '_blank');
  });

  it('should hide the command and avoid navigation when the repository has Discussions disabled', async () => {
    const handler = new OpenDiscussionCommandHandler({ gitHubRepo: 'owner/repo', isDiscussionsEnabled: false });
    const command = handler.buildCommand();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(command.checkCallback?.(true)).toBe(false);
    expect(command.checkCallback?.(false)).toBe(false);
    await handler.execute();
    expect(open).not.toHaveBeenCalled();
  });
});
