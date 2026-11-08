import type { App as AppOriginal } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BugReportEnvironment } from './bug-report.ts';

import {
  BUG_REPORT_ISSUE_FORM_TEMPLATE,
  BUG_REPORT_PASTE_INSTRUCTIONS,
  buildBugReportIssueFormLink,
  DEFAULT_BUG_REPORT_MAX_URL_LENGTH,
  formatBugReportEnvironment,
  getBugReportEnvironment,
  getBugReportIssueFormUrl,
  getGitHubIssueFormUrl
} from './bug-report.ts';

interface PlatformState {
  readonly build: unknown;
  readonly isAndroidApp: boolean;
  readonly isDesktopApp: boolean;
  readonly isIosApp: boolean;
  readonly isLinux: boolean;
  readonly isMacOS: boolean;
  readonly isMobileApp: boolean;
  readonly isWin: boolean;
}

const { mockGetMobileAppInfo, platformState } = vi.hoisted(() => ({
  mockGetMobileAppInfo: vi.fn(),
  platformState: {} as PlatformState
}));

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    apiVersion: '1.15.0',
    Platform: platformState
  };
});

vi.mock('./mobile-app-info.ts', () => ({
  getMobileAppInfo: mockGetMobileAppInfo
}));

vi.mock('./desktop-operating-system.ts', () => ({
  getDesktopOperatingSystem: (): string => 'Windows 11 Pro 10.0.26100'
}));

const PLUGIN_ID = 'my-plugin';

function createApp(): AppOriginal {
  return strictProxy<AppOriginal>({
    plugins: strictProxy<AppOriginal['plugins']>({
      // `deleted` is in `community-plugins.json`, but its folder is gone, so Obsidian never loaded it.
      enabledPlugins: new Set(['alpha', 'deleted', PLUGIN_ID, 'zeta']),
      manifests: {
        'alpha': strictProxy({ version: '2.0.0' }),
        'deleted': undefined,
        'not-installed': undefined,
        [PLUGIN_ID]: strictProxy({ version: '1.2.3' }),
        'zeta': strictProxy({ version: '0.1.0' })
      },
      plugins: {
        alpha: strictProxy({}),
        [PLUGIN_ID]: strictProxy({}),
        zeta: strictProxy({})
      }
    })
  });
}

function setPlatform(state: Partial<PlatformState>): void {
  Object.assign(platformState, {
    build: undefined,
    isAndroidApp: false,
    isDesktopApp: false,
    isIosApp: false,
    isLinux: false,
    isMacOS: false,
    isMobileApp: false,
    isWin: false,
    ...state
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setPlatform({ build: '1.8.10', isDesktopApp: true, isWin: true });
});

describe('getBugReportEnvironment', () => {
  it('should read the desktop environment', async () => {
    expect(await getBugReportEnvironment({ app: createApp(), pluginId: PLUGIN_ID })).toEqual({
      enabledPlugins: [
        { id: 'alpha', version: '2.0.0' },
        { id: 'zeta', version: '0.1.0' }
      ],
      installerVersion: '1.8.10',
      obsidianVersion: '1.15.0',
      operatingSystem: 'Windows 11 Pro 10.0.26100',
      platform: 'Windows',
      plugin: { id: PLUGIN_ID, version: '1.2.3' }
    });
  });

  it('should give no version for a plugin whose manifest is not known', async () => {
    const environment = await getBugReportEnvironment({ app: createApp(), pluginId: 'not-installed' });
    expect(environment.plugin).toEqual({ id: 'not-installed', version: null });
  });

  it('should read the installer version as unknown when Platform has no build', async () => {
    setPlatform({ isDesktopApp: true, isLinux: true });
    const environment = await getBugReportEnvironment({ app: createApp(), pluginId: PLUGIN_ID });
    expect(environment.installerVersion).toBe('unknown');
    expect(environment.platform).toBe('Linux');
  });

  it('should name macOS', async () => {
    setPlatform({ build: '1.8.10', isDesktopApp: true, isMacOS: true });
    const environment = await getBugReportEnvironment({ app: createApp(), pluginId: PLUGIN_ID });
    expect(environment.platform).toBe('macOS');
  });

  it('should read the mobile environment from the app info', async () => {
    setPlatform({ isAndroidApp: true, isMobileApp: true });
    mockGetMobileAppInfo.mockResolvedValue({ installerVersion: '1.15.0 (291)', operatingSystem: 'android 15' });
    const environment = await getBugReportEnvironment({ app: createApp(), pluginId: PLUGIN_ID });
    expect(environment).toMatchObject({
      installerVersion: '1.15.0 (291)',
      operatingSystem: 'android 15',
      platform: 'Android'
    });
  });

  it('should fall back to unknown where the mobile app info is missing', async () => {
    setPlatform({ isIosApp: true, isMacOS: true, isMobileApp: true });
    mockGetMobileAppInfo.mockResolvedValue({ installerVersion: null, operatingSystem: null });
    expect(await getBugReportEnvironment({ app: createApp(), pluginId: PLUGIN_ID })).toMatchObject({
      installerVersion: 'unknown',
      operatingSystem: 'unknown',
      platform: 'iOS'
    });

    mockGetMobileAppInfo.mockResolvedValue(null);
    expect(await getBugReportEnvironment({ app: createApp(), pluginId: PLUGIN_ID })).toMatchObject({
      installerVersion: 'unknown',
      operatingSystem: 'unknown'
    });
  });

  it('should answer unknown on a platform that is neither desktop nor mobile', async () => {
    setPlatform({});
    expect(await getBugReportEnvironment({ app: createApp(), pluginId: PLUGIN_ID })).toMatchObject({
      installerVersion: 'unknown',
      operatingSystem: 'unknown',
      platform: 'unknown'
    });
  });
});

describe('formatBugReportEnvironment', () => {
  it('should render the environment as a Markdown list', () => {
    expect(formatBugReportEnvironment({
      enabledPlugins: [{ id: 'alpha', version: '2.0.0' }, { id: 'beta', version: null }],
      installerVersion: '1.8.10',
      obsidianVersion: '1.15.0',
      operatingSystem: 'Windows 11 Pro 10.0.26100',
      platform: 'Windows',
      plugin: { id: PLUGIN_ID, version: '1.2.3' }
    })).toBe(
      '- Plugin: `my-plugin` 1.2.3\n'
        + '- Obsidian: 1.15.0 (installer 1.8.10)\n'
        + '- Platform: Windows\n'
        + '- Operating system: Windows 11 Pro 10.0.26100\n'
        + '- Other enabled plugins: `alpha` 2.0.0, `beta` unknown'
    );
  });

  it('should say none when no other plugin is enabled', () => {
    expect(formatBugReportEnvironment({
      enabledPlugins: [],
      installerVersion: 'unknown',
      obsidianVersion: '1.15.0',
      operatingSystem: 'unknown',
      platform: 'unknown',
      plugin: { id: PLUGIN_ID, version: null }
    })).toContain('- Other enabled plugins: none');
  });
});

describe('getGitHubIssueFormUrl', () => {
  it('should build a link with the template only', () => {
    expect(getGitHubIssueFormUrl({ gitHubRepo: 'owner/repo', template: 'feature_request.yml' }))
      .toBe('https://github.com/owner/repo/issues/new?template=feature_request.yml');
  });

  it('should add the title and the fields, encoded', () => {
    const url = new URL(getGitHubIssueFormUrl({
      fields: { 'plugin-version': '1.2.3', 'steps': 'a & b\nc' },
      gitHubRepo: 'owner/repo',
      template: 'bug_report.yml',
      title: '[BUG] Something'
    }));
    expect(url.searchParams.get('title')).toBe('[BUG] Something');
    expect(url.searchParams.get('plugin-version')).toBe('1.2.3');
    expect(url.searchParams.get('steps')).toBe('a & b\nc');
  });
});

describe('getBugReportIssueFormUrl', () => {
  it('should prefill the bug-report form with the environment', async () => {
    const url = new URL(await getBugReportIssueFormUrl({ app: createApp(), gitHubRepo: 'owner/repo', pluginId: PLUGIN_ID }));
    expect(url.pathname).toBe('/owner/repo/issues/new');
    expect(url.searchParams.get('template')).toBe(BUG_REPORT_ISSUE_FORM_TEMPLATE);
    expect(url.searchParams.has('title')).toBe(false);
    expect(url.searchParams.get('plugin-version')).toBe('1.2.3');
    expect(url.searchParams.get('obsidian-version')).toBe('1.15.0');
    expect(url.searchParams.get('operating-system')).toBe('Windows 11 Pro 10.0.26100');
    expect(url.searchParams.get('environment')).toContain('- Plugin: `my-plugin` 1.2.3');
  });

  it('should pass the title and report an unknown plugin version', async () => {
    const url = new URL(
      await getBugReportIssueFormUrl({
        app: createApp(),
        gitHubRepo: 'owner/repo',
        pluginId: 'not-installed',
        title: 'Broken'
      })
    );
    expect(url.searchParams.get('title')).toBe('Broken');
    expect(url.searchParams.get('plugin-version')).toBe('unknown');
  });

  it('should never fall back to the clipboard, however long the environment', async () => {
    const app = createApp();
    for (let index = 0; index < 400; index++) {
      const id = `plugin-${String(index).padStart(3, '0')}-with-a-long-identifier`;
      app.plugins.plugins[id] = strictProxy<AppOriginal['plugins']['plugins'][string]>({});
      app.plugins.manifests[id] = strictProxy<AppOriginal['plugins']['manifests'][string]>({ version: '1.0.0' });
    }
    const url = await getBugReportIssueFormUrl({ app, gitHubRepo: 'owner/repo', pluginId: PLUGIN_ID });
    expect(url.length).toBeGreaterThan(DEFAULT_BUG_REPORT_MAX_URL_LENGTH);
    expect(new URL(url).searchParams.get('environment')).toContain('plugin-399-with-a-long-identifier');
  });
});

describe('buildBugReportIssueFormLink', () => {
  const environment: BugReportEnvironment = {
    enabledPlugins: [{ id: 'alpha', version: '2.0.0' }],
    installerVersion: '1.8.10',
    obsidianVersion: '1.15.0',
    operatingSystem: 'Windows 11',
    platform: 'Windows',
    plugin: { id: PLUGIN_ID, version: '1.2.3' }
  };

  function getEnvironmentField(url: string): null | string {
    return new URL(url).searchParams.get('environment');
  }

  it('should prefill the environment alone when there are no diagnostics', () => {
    const link = buildBugReportIssueFormLink({ environment, gitHubRepo: 'owner/repo' });
    expect(link.clipboardText).toBeNull();
    expect(getEnvironmentField(link.url)).toBe(formatBugReportEnvironment(environment));
  });

  it('should append the diagnostics to the environment field and keep the other fields', () => {
    const link = buildBugReportIssueFormLink({
      diagnostics: [{ content: 'line 1\nline 2', id: 'logs', title: 'Logs' }],
      environment,
      gitHubRepo: 'owner/repo',
      title: 'Broken'
    });
    expect(link.clipboardText).toBeNull();
    const url = new URL(link.url);
    expect(url.searchParams.get('environment')).toBe(`${formatBugReportEnvironment(environment)}\n\n### Logs\n\n\`\`\`\nline 1\nline 2\n\`\`\``);
    expect(url.searchParams.get('title')).toBe('Broken');
    expect(url.searchParams.get('plugin-version')).toBe('1.2.3');
    expect(url.searchParams.get('obsidian-version')).toBe('1.15.0');
    expect(url.searchParams.get('operating-system')).toBe('Windows 11');
  });

  it('should use the default budget', () => {
    const link = buildBugReportIssueFormLink({
      diagnostics: [{ content: 'x'.repeat(DEFAULT_BUG_REPORT_MAX_URL_LENGTH), id: 'logs', title: 'Logs' }],
      environment,
      gitHubRepo: 'owner/repo'
    });
    expect(link.clipboardText).not.toBeNull();
    expect(link.url.length).toBeLessThanOrEqual(DEFAULT_BUG_REPORT_MAX_URL_LENGTH);
  });

  it('should keep a link exactly at the budget and move one character over it to the clipboard', () => {
    const diagnostics = [{ content: 'abc', id: 'logs', title: 'Logs' }];
    const fullLength = buildBugReportIssueFormLink({ diagnostics, environment, gitHubRepo: 'owner/repo', maxUrlLength: Infinity }).url.length;

    const atBudget = buildBugReportIssueFormLink({ diagnostics, environment, gitHubRepo: 'owner/repo', maxUrlLength: fullLength });
    expect(atBudget.clipboardText).toBeNull();
    expect(atBudget.url.length).toBe(fullLength);

    const overBudget = buildBugReportIssueFormLink({ diagnostics, environment, gitHubRepo: 'owner/repo', maxUrlLength: fullLength - 1 });
    expect(overBudget.clipboardText).not.toBeNull();
  });

  it('should measure the encoded length, so non-ASCII text counts by its percent-encoded UTF-8', () => {
    // 'Ж' is 2 bytes of UTF-8 (6 encoded characters); '😀' is 4 bytes (12 encoded characters).
    const ascii = buildBugReportIssueFormLink({
      diagnostics: [{ content: 'ab', id: 'a', title: 'A' }],
      environment,
      gitHubRepo: 'owner/repo',
      maxUrlLength: Infinity
    }).url.length;
    const cyrillic = buildBugReportIssueFormLink({
      diagnostics: [{ content: 'ЖЖ', id: 'a', title: 'A' }],
      environment,
      gitHubRepo: 'owner/repo',
      maxUrlLength: Infinity
    }).url.length;
    const emoji = buildBugReportIssueFormLink({
      diagnostics: [{ content: '😀', id: 'a', title: 'A' }],
      environment,
      gitHubRepo: 'owner/repo',
      maxUrlLength: Infinity
    }).url.length;
    expect(cyrillic - ascii).toBe(10);
    expect(emoji - ascii).toBe(10);

    const fallback = buildBugReportIssueFormLink({
      diagnostics: [{ content: '😀', id: 'a', title: 'A' }],
      environment,
      gitHubRepo: 'owner/repo',
      maxUrlLength: emoji - 1
    });
    expect(fallback.clipboardText).toContain('😀');
  });

  it('should move an oversized report to the clipboard whole and point the form at it', () => {
    const content = Array.from({ length: 2000 }, (_, index) => `entry ${String(index)} ✓`).join('\n');
    const link = buildBugReportIssueFormLink({
      diagnostics: [{ content, id: 'logs', title: 'Logs' }],
      environment,
      gitHubRepo: 'owner/repo',
      title: 'Broken'
    });
    expect(link.clipboardText).toBe(`${formatBugReportEnvironment(environment)}\n\n### Logs\n\n\`\`\`\n${content}\n\`\`\``);
    const url = new URL(link.url);
    expect(url.searchParams.get('environment')).toBe(BUG_REPORT_PASTE_INSTRUCTIONS);
    expect(url.searchParams.get('title')).toBe('Broken');
    expect(url.searchParams.get('plugin-version')).toBe('1.2.3');
    expect(link.url.length).toBeLessThanOrEqual(DEFAULT_BUG_REPORT_MAX_URL_LENGTH);
  });
});
