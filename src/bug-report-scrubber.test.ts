import type { App as AppOriginal } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { Platform } from 'obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getBugReportScrubbedPaths,
  HOME_PATH_PLACEHOLDER,
  scrubBugReportDiagnosticSections,
  scrubBugReportText,
  VAULT_PATH_PLACEHOLDER
} from './bug-report-scrubber.ts';

const { mockGetHomeFolderPath } = vi.hoisted(() => ({
  mockGetHomeFolderPath: vi.fn()
}));

vi.mock('./desktop-home-folder.ts', () => ({
  getHomeFolderPath: mockGetHomeFolderPath
}));

// Built at runtime, so no secret scanner reads these fixtures as real tokens.
function join(...parts: string[]): string {
  return parts.join('');
}

function repeat(text: string, count: number): string {
  return text.repeat(count);
}

afterEach(() => {
  vi.restoreAllMocks();
  mockGetHomeFolderPath.mockReset();
});

describe('scrubBugReportText', () => {
  it.each([
    ['github-token', join('gh', 'p_', repeat('A1', 18))],
    ['github-token', join('github', '_pat_', repeat('x', 30))],
    ['gitlab-token', join('gl', 'pat-', repeat('y', 20))],
    ['slack-webhook', join('https://hooks.', 'slack.com/services/', repeat('W', 9), '/', repeat('B', 9), '/', repeat('z', 24))],
    ['slack-token', join('xo', 'xb-123456-', repeat('q', 12))],
    ['aws-access-key', join('AK', 'IA', repeat('ABCD', 4))],
    ['google-api-key', join('AI', 'za', repeat('k', 35))],
    ['stripe-key', join('sk', '_live_', repeat('s', 24))],
    ['anthropic-key', join('sk-', 'ant-api03-', repeat('a', 30))],
    ['openai-key', join('sk-', 'proj-', repeat('o', 30))],
    ['npm-token', join('np', 'm_', repeat('n', 36))],
    ['jwt', join('ey', 'JhbGciOiJIUzI1.ey', 'JzdWIiOiIxMjM0.', repeat('c', 12))]
  ])('should mask a %s', (name, token) => {
    expect(scrubBugReportText(`before ${token} after`)).toBe(`before [redacted ${name}] after`);
  });

  it('should mask a private key block, and one cut off at the end of the text', () => {
    const block = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';
    expect(scrubBugReportText(`key: ${block} done`)).toBe('key: [redacted private-key] done');
    expect(scrubBugReportText('key: -----BEGIN PRIVATE KEY-----\nabc')).toBe('key: [redacted private-key]');
  });

  it('should keep the scheme of a bearer token and of URL credentials', () => {
    expect(scrubBugReportText(`Authorization: Bearer ${repeat('t', 20)}==`)).toBe('Authorization: Bearer [redacted bearer-token]');
    expect(scrubBugReportText('https://user:pass@example.com/path')).toBe('https://[redacted url-credentials]@example.com/path');
  });

  it('should leave ordinary text alone', () => {
    const text = 'task-something sk-short https://example.com/a:b Bearer short';
    expect(scrubBugReportText(text)).toBe(text);
  });

  it('should replace paths with either separator, any case, and doubled backslashes', () => {
    const paths = [
      { path: 'C:\\Users\\Alice\\', placeholder: HOME_PATH_PLACEHOLDER },
      { path: 'C:\\Users\\Alice\\Vault', placeholder: VAULT_PATH_PLACEHOLDER }
    ];
    const text = 'C:\\Users\\Alice\\Vault\\a.md c:/users/alice/x.txt {"p":"C:\\\\Users\\\\Alice\\\\Vault\\\\b.md"}';
    expect(scrubBugReportText(text, { paths })).toBe('<vault>\\a.md <home>/x.txt {"p":"<vault>\\\\b.md"}');
  });

  it('should not replace a path that only starts another name', () => {
    expect(scrubBugReportText('/home/alice2/a /home/alice', { paths: [{ path: '/home/alice', placeholder: '<home>' }] }))
      .toBe('/home/alice2/a <home>');
  });

  it('should ignore a path too short to replace safely', () => {
    expect(scrubBugReportText('C:/a/b', { paths: [{ path: 'C:/', placeholder: '<root>' }] })).toBe('C:/a/b');
  });
});

describe('scrubBugReportDiagnosticSections', () => {
  it('should scrub copies of the sections', () => {
    const section = { content: '/vault/x', id: 'logs', title: 'Logs' };
    expect(scrubBugReportDiagnosticSections([section], { paths: [{ path: '/vault', placeholder: '<vault>' }] }))
      .toEqual([{ content: '<vault>/x', id: 'logs', title: 'Logs' }]);
    expect(section.content).toBe('/vault/x');
    expect(scrubBugReportDiagnosticSections([section])).toEqual([section]);
  });
});

describe('getBugReportScrubbedPaths', () => {
  function createApp(adapter: unknown): AppOriginal {
    return strictProxy<AppOriginal>({ vault: strictProxy<AppOriginal['vault']>({ adapter: adapter as AppOriginal['vault']['adapter'] }) });
  }

  it('should read the desktop vault path and the home folder', async () => {
    vi.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(true);
    mockGetHomeFolderPath.mockReturnValue('/home/alice');

    expect(await getBugReportScrubbedPaths(createApp({ getBasePath: (): string => '/home/alice/vault' }))).toEqual([
      { path: '/home/alice/vault', placeholder: VAULT_PATH_PLACEHOLDER },
      { path: '/home/alice', placeholder: HOME_PATH_PLACEHOLDER }
    ]);
  });

  it('should skip the home folder when it cannot be read', async () => {
    vi.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(true);
    mockGetHomeFolderPath.mockImplementation(() => {
      throw new Error('no home');
    });

    expect(await getBugReportScrubbedPaths(createApp({ getBasePath: (): unknown => 42 }))).toEqual([]);
  });

  it('should read the mobile vault path and no home folder', async () => {
    vi.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(false);

    expect(await getBugReportScrubbedPaths(createApp({ basePath: '/storage/emulated/0/Vault' }))).toEqual([
      { path: '/storage/emulated/0/Vault', placeholder: VAULT_PATH_PLACEHOLDER }
    ]);
    expect(mockGetHomeFolderPath).not.toHaveBeenCalled();
  });

  it('should skip an adapter that names no path', async () => {
    vi.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(false);

    expect(await getBugReportScrubbedPaths(createApp({}))).toEqual([]);
    expect(await getBugReportScrubbedPaths(createApp(null))).toEqual([]);
  });
});
