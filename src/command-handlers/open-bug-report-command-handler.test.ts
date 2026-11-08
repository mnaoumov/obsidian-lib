// @vitest-environment jsdom

import type { App as AppOriginal } from 'obsidian';
import type { Mock } from 'vitest';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BugReportDiagnosticSection } from '../bug-report-diagnostics.ts';
import type { BugReportEnvironment } from '../bug-report.ts';

import { OpenBugReportCommandHandler } from './open-bug-report-command-handler.ts';

const {
  mockBuildBugReportIssueFormLink,
  mockCopyTextManually,
  mockGetBugReportEnvironment,
  mockGetBugReportIssueFormUrl,
  mockNotice,
  mockReviewBugReportDiagnostics
} = vi.hoisted(() => ({
  mockBuildBugReportIssueFormLink: vi.fn(),
  mockCopyTextManually: vi.fn(),
  mockGetBugReportEnvironment: vi.fn(),
  mockGetBugReportIssueFormUrl: vi.fn(),
  mockNotice: vi.fn(),
  mockReviewBugReportDiagnostics: vi.fn()
}));

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  Notice: mockNotice
}));

vi.mock('../bug-report.ts', () => ({
  buildBugReportIssueFormLink: mockBuildBugReportIssueFormLink,
  formatBugReportEnvironment: (): string => '- Plugin: `my-plugin` 1.2.3',
  getBugReportEnvironment: mockGetBugReportEnvironment,
  getBugReportIssueFormUrl: mockGetBugReportIssueFormUrl
}));

vi.mock('../modals/copy-text-manually.ts', () => ({
  copyTextManually: mockCopyTextManually
}));

vi.mock('../modals/review-bug-report-diagnostics.ts', () => ({
  reviewBugReportDiagnostics: mockReviewBugReportDiagnostics
}));

const ENVIRONMENT = strictProxy<BugReportEnvironment>({});
const FULL_URL = 'https://github.com/owner/repo/issues/new?template=bug_report.yml&environment=full';
const SHORT_URL = 'https://github.com/owner/repo/issues/new?template=bug_report.yml&environment=paste';
const SECTIONS: readonly BugReportDiagnosticSection[] = [
  { content: 'a', id: 'public', title: 'Public' },
  { content: 'b', id: 'private', isPotentiallyPrivate: true, title: 'Private' }
];

let open: Mock<typeof window.open>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBugReportEnvironment.mockResolvedValue(ENVIRONMENT);
  mockBuildBugReportIssueFormLink.mockReturnValue({ clipboardText: null, url: FULL_URL });
  open = vi.fn<typeof window.open>().mockReturnValue(null);
  vi.spyOn(window, 'open').mockImplementation(open);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenBugReportCommandHandler', () => {
  const app = strictProxy<AppOriginal>({});

  function createHandler(params: Partial<ConstructorParameters<typeof OpenBugReportCommandHandler>[0]> = {}): OpenBugReportCommandHandler {
    return new OpenBugReportCommandHandler({
      app,
      gitHubRepo: 'owner/repo',
      pluginId: 'my-plugin',
      ...params
    });
  }

  it('should build the command', () => {
    const command = createHandler().buildCommand();
    expect(command.id).toBe('report-bug');
    expect(command.name).toBe('Report a bug');
    expect(command.icon).toBe('bug');
  });

  it('should open the environment-only form without a review when there are no diagnostics', async () => {
    await createHandler().execute();

    expect(mockGetBugReportEnvironment).toHaveBeenCalledWith({ app, pluginId: 'my-plugin' });
    expect(mockReviewBugReportDiagnostics).not.toHaveBeenCalled();
    expect(mockBuildBugReportIssueFormLink).toHaveBeenCalledWith({ diagnostics: [], environment: ENVIRONMENT, gitHubRepo: 'owner/repo' });
    expect(open).toHaveBeenCalledWith(FULL_URL, '_blank');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('should do nothing when the command is unavailable', async () => {
    const handler = createHandler();
    vi.spyOn(handler, 'canExecute').mockReturnValue(false);

    await handler.execute();

    expect(mockGetBugReportEnvironment).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('should skip the review when the provider returns no sections', async () => {
    await createHandler({ getDiagnostics: () => [] }).execute();
    expect(mockReviewBugReportDiagnostics).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(FULL_URL, '_blank');
  });

  it('should send only the sections the user chose, with the configured budget', async () => {
    mockReviewBugReportDiagnostics.mockResolvedValue([SECTIONS[1]]);

    await createHandler({
      getDiagnostics: async () => {
        await noopAsync();
        return SECTIONS;
      },
      maxUrlLength: 1234
    }).execute();

    expect(mockReviewBugReportDiagnostics).toHaveBeenCalledWith({ alwaysIncludedText: '- Plugin: `my-plugin` 1.2.3', app, sections: SECTIONS });
    expect(mockBuildBugReportIssueFormLink).toHaveBeenCalledWith({
      diagnostics: [SECTIONS[1]],
      environment: ENVIRONMENT,
      gitHubRepo: 'owner/repo',
      maxUrlLength: 1234
    });
    expect(open).toHaveBeenCalledWith(FULL_URL, '_blank');
  });

  it('should open nothing when the user cancels the review', async () => {
    mockReviewBugReportDiagnostics.mockResolvedValue(null);

    await createHandler({ getDiagnostics: () => SECTIONS }).execute();

    expect(mockBuildBugReportIssueFormLink).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('should copy an oversized report to the clipboard, say so, then open the short form', async () => {
    mockBuildBugReportIssueFormLink.mockReturnValue({ clipboardText: 'the whole report', url: SHORT_URL });

    await createHandler().execute();

    expect(writeText).toHaveBeenCalledWith('the whole report');
    expect(mockNotice).toHaveBeenCalledOnce();
    expect(mockCopyTextManually).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(SHORT_URL, '_blank');
  });

  it('should show the report for copying by hand when the clipboard refuses it', async () => {
    mockBuildBugReportIssueFormLink.mockReturnValue({ clipboardText: 'the whole report', url: SHORT_URL });
    writeText.mockRejectedValue(new Error('Document is not focused'));
    mockCopyTextManually.mockResolvedValue(true);

    await createHandler().execute();

    expect(mockCopyTextManually).toHaveBeenCalledWith(expect.objectContaining({ app, text: 'the whole report' }));
    expect(mockNotice).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(SHORT_URL, '_blank');
  });

  it('should open nothing when the user cancels copying by hand', async () => {
    mockBuildBugReportIssueFormLink.mockReturnValue({ clipboardText: 'the whole report', url: SHORT_URL });
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
    mockCopyTextManually.mockResolvedValue(false);

    await createHandler().execute();

    expect(mockCopyTextManually).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('should keep the environment-only URL builder for subclasses', async () => {
    mockGetBugReportIssueFormUrl.mockResolvedValue(FULL_URL);

    class TestHandler extends OpenBugReportCommandHandler {
      public async readUrl(): Promise<string> {
        return await this.getUrl();
      }
    }

    expect(await new TestHandler({ app, gitHubRepo: 'owner/repo', pluginId: 'my-plugin' }).readUrl()).toBe(FULL_URL);
    expect(mockGetBugReportIssueFormUrl).toHaveBeenCalledWith({ app, gitHubRepo: 'owner/repo', pluginId: 'my-plugin' });
  });
});
