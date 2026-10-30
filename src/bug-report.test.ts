import type { App as AppOriginal } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  BUG_REPORT_ISSUE_FORM_TEMPLATE,
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
      enabledPlugins: new Set(['alpha', 'no-manifest', PLUGIN_ID, 'zeta']),
      manifests: {
        'alpha': strictProxy({ version: '2.0.0' }),
        'no-manifest': undefined,
        'not-installed': undefined,
        [PLUGIN_ID]: strictProxy({ version: '1.2.3' }),
        'zeta': strictProxy({ version: '0.1.0' })
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
        { id: 'no-manifest', version: null },
        { id: 'zeta', version: '0.1.0' }
      ],
      installerVersion: '1.8.10',
      obsidianVersion: '1.15.0',
      operatingSystem: 'Windows 11 Pro 10.0.26100',
      platform: 'Windows',
      plugin: { id: PLUGIN_ID, version: '1.2.3' }
    });
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
});
