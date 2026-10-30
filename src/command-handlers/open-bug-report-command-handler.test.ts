// @vitest-environment jsdom

import type { App as AppOriginal } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { OpenBugReportCommandHandler } from './open-bug-report-command-handler.ts';

const { mockGetBugReportIssueFormUrl } = vi.hoisted(() => ({
  mockGetBugReportIssueFormUrl: vi.fn()
}));

vi.mock('../bug-report.ts', () => ({
  getBugReportIssueFormUrl: mockGetBugReportIssueFormUrl
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenBugReportCommandHandler', () => {
  const app = strictProxy<AppOriginal>({});

  function createHandler(): OpenBugReportCommandHandler {
    return new OpenBugReportCommandHandler({
      app,
      gitHubRepo: 'owner/repo',
      pluginId: 'my-plugin'
    });
  }

  it('should build the command', () => {
    const command = createHandler().buildCommand();
    expect(command.id).toBe('report-bug');
    expect(command.name).toBe('Report a bug');
    expect(command.icon).toBe('bug');
  });

  it('should open the prefilled issue form', async () => {
    mockGetBugReportIssueFormUrl.mockResolvedValue('https://github.com/owner/repo/issues/new?template=bug_report.yml');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await createHandler().execute();

    expect(mockGetBugReportIssueFormUrl).toHaveBeenCalledWith({
      app,
      gitHubRepo: 'owner/repo',
      pluginId: 'my-plugin'
    });
    expect(open).toHaveBeenCalledWith('https://github.com/owner/repo/issues/new?template=bug_report.yml', '_blank');
  });
});
