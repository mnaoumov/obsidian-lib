/**
 * @file
 *
 * Helpers for a plugin's bug reports: the environment a report needs, and a link to a GitHub issue form
 * prefilled with it.
 *
 * Cross-platform-loadable: the desktop operating-system lookup reads `node:os`, so it is imported
 * dynamically, on desktop only.
 *
 * The desktop installer version is `Platform.build`, which no public typing declares: Obsidian's desktop
 * startup sets it from Electron's `app.getVersion()` (read from Obsidian `1.15.0`), so it is read
 * structurally here, and reads as `unknown` if a later version drops it.
 */

import type { App } from 'obsidian';

import {
  apiVersion,
  Platform
} from 'obsidian';

import { getMobileAppInfo } from './mobile-app-info.ts';

/**
 * The ids of the bug-report issue form's fields that {@link getBugReportIssueFormUrl} prefills. GitHub
 * prefills a field from a query parameter named after the field's `id`, so a form must give its fields
 * these ids for them to be filled.
 */
export enum BugReportIssueFormFieldId {
  /**
   * The whole environment, as {@link formatBugReportEnvironment} renders it.
   */
  Environment = 'environment',

  /**
   * The Obsidian version.
   */
  ObsidianVersion = 'obsidian-version',

  /**
   * The operating system.
   */
  OperatingSystem = 'operating-system',

  /**
   * The reporting plugin's version.
   */
  PluginVersion = 'plugin-version'
}

/**
 * The file name of the bug-report issue form, under `.github/ISSUE_TEMPLATE`.
 */
export const BUG_REPORT_ISSUE_FORM_TEMPLATE = 'bug_report.yml';

/**
 * The environment a bug report needs.
 */
export interface BugReportEnvironment {
  /**
   * The other enabled plugins, sorted by id.
   */
  readonly enabledPlugins: readonly BugReportPluginInfo[];

  /**
   * The installed app's version, which can lag behind {@link obsidianVersion}.
   */
  readonly installerVersion: string;

  /**
   * The Obsidian version.
   */
  readonly obsidianVersion: string;

  /**
   * The operating system's name and version.
   */
  readonly operatingSystem: string;

  /**
   * The platform: `Android`, `iOS`, `macOS`, `Windows`, `Linux` or `unknown`.
   */
  readonly platform: string;

  /**
   * The reporting plugin.
   */
  readonly plugin: BugReportPluginInfo;
}

/**
 * A plugin, as a bug report names it.
 */
export interface BugReportPluginInfo {
  /**
   * The plugin's id.
   */
  readonly id: string;

  /**
   * The plugin's installed version, or `null` when its manifest is not known.
   */
  readonly version: null | string;
}

/**
 * Parameters for {@link getBugReportEnvironment}.
 */
export interface GetBugReportEnvironmentParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The id of the reporting plugin.
   */
  readonly pluginId: string;
}

/**
 * Parameters for {@link getBugReportIssueFormUrl}.
 */
export interface GetBugReportIssueFormUrlParams extends GetBugReportEnvironmentParams {
  /**
   * The plugin's GitHub repository, as `owner/name`.
   */
  readonly gitHubRepo: string;

  /**
   * The issue's title. Leave it out to keep the form's own default title.
   */
  readonly title?: string;
}

/**
 * Parameters for {@link getGitHubIssueFormUrl}.
 */
export interface GetGitHubIssueFormUrlParams {
  /**
   * The values to prefill, keyed by field `id`.
   */
  readonly fields?: Readonly<Record<string, string>>;

  /**
   * The GitHub repository, as `owner/name`.
   */
  readonly gitHubRepo: string;

  /**
   * The form's file name, under `.github/ISSUE_TEMPLATE`.
   */
  readonly template: string;

  /**
   * The issue's title. Leave it out to keep the form's own default title.
   */
  readonly title?: string;
}

interface AppAndOperatingSystem {
  readonly installerVersion: string;
  readonly operatingSystem: string;
}

interface PlatformWithBuild {
  readonly build?: unknown;
}

const UNKNOWN = 'unknown';

/**
 * Renders a bug report's environment as a Markdown list.
 *
 * @param environment - The environment.
 * @returns The Markdown.
 */
export function formatBugReportEnvironment(environment: BugReportEnvironment): string {
  const enabledPlugins = environment.enabledPlugins.length === 0
    ? 'none'
    : environment.enabledPlugins.map((pluginInfo) => formatPluginInfo(pluginInfo)).join(', ');

  return `- Plugin: ${formatPluginInfo(environment.plugin)}\n`
    + `- Obsidian: ${environment.obsidianVersion} (installer ${environment.installerVersion})\n`
    + `- Platform: ${environment.platform}\n`
    + `- Operating system: ${environment.operatingSystem}\n`
    + `- Other enabled plugins: ${enabledPlugins}`;
}

/**
 * Gets the environment a bug report needs: the plugin's version, the other enabled plugins, the
 * Obsidian and installer versions, the platform and the operating system.
 *
 * @param params - The parameters.
 * @returns The environment.
 */
export async function getBugReportEnvironment(params: GetBugReportEnvironmentParams): Promise<BugReportEnvironment> {
  const { app, pluginId } = params;
  const { installerVersion, operatingSystem } = await getAppAndOperatingSystem();

  return {
    enabledPlugins: [...app.plugins.enabledPlugins]
      .filter((id) => id !== pluginId)
      .sort()
      .map((id) => getPluginInfo(app, id)),
    installerVersion,
    obsidianVersion: apiVersion,
    operatingSystem,
    platform: getPlatformName(),
    plugin: getPluginInfo(app, pluginId)
  };
}

/**
 * Gets a link to a plugin's bug-report issue form ({@link BUG_REPORT_ISSUE_FORM_TEMPLATE}), prefilled with
 * the environment, in the fields {@link BugReportIssueFormFieldId} names.
 *
 * @param params - The parameters.
 * @returns The link.
 */
export async function getBugReportIssueFormUrl(params: GetBugReportIssueFormUrlParams): Promise<string> {
  const environment = await getBugReportEnvironment(params);

  return getGitHubIssueFormUrl({
    fields: {
      [BugReportIssueFormFieldId.Environment]: formatBugReportEnvironment(environment),
      [BugReportIssueFormFieldId.ObsidianVersion]: environment.obsidianVersion,
      [BugReportIssueFormFieldId.OperatingSystem]: environment.operatingSystem,
      [BugReportIssueFormFieldId.PluginVersion]: environment.plugin.version ?? UNKNOWN
    },
    gitHubRepo: params.gitHubRepo,
    template: BUG_REPORT_ISSUE_FORM_TEMPLATE,
    ...params.title !== undefined && { title: params.title }
  });
}

/**
 * Gets a link that opens a GitHub issue form with fields prefilled.
 *
 * @param params - The parameters.
 * @returns The link.
 */
export function getGitHubIssueFormUrl(params: GetGitHubIssueFormUrlParams): string {
  const searchParams = new URLSearchParams({ template: params.template });
  if (params.title !== undefined) {
    searchParams.set('title', params.title);
  }

  for (const [fieldId, value] of Object.entries(params.fields ?? {})) {
    searchParams.set(fieldId, value);
  }

  return `https://github.com/${params.gitHubRepo}/issues/new?${searchParams.toString()}`;
}

function formatPluginInfo(pluginInfo: BugReportPluginInfo): string {
  return `\`${pluginInfo.id}\` ${pluginInfo.version ?? UNKNOWN}`;
}

async function getAppAndOperatingSystem(): Promise<AppAndOperatingSystem> {
  if (Platform.isMobileApp) {
    const mobileAppInfo = await getMobileAppInfo();
    return {
      installerVersion: mobileAppInfo?.installerVersion ?? UNKNOWN,
      operatingSystem: mobileAppInfo?.operatingSystem ?? UNKNOWN
    };
  }

  if (!Platform.isDesktopApp) {
    return { installerVersion: UNKNOWN, operatingSystem: UNKNOWN };
  }

  // Conditional import of the desktop-only lookup, which reads `node:os`; this branch runs only on desktop.
  const { getDesktopOperatingSystem } = await import('./desktop-operating-system.ts');
  const build = (Platform as PlatformWithBuild).build;
  return {
    installerVersion: typeof build === 'string' ? build : UNKNOWN,
    operatingSystem: getDesktopOperatingSystem()
  };
}

function getPlatformName(): string {
  if (Platform.isAndroidApp) {
    return 'Android';
  }
  if (Platform.isIosApp) {
    return 'iOS';
  }
  if (Platform.isMacOS) {
    return 'macOS';
  }
  if (Platform.isWin) {
    return 'Windows';
  }
  return Platform.isLinux ? 'Linux' : UNKNOWN;
}

function getPluginInfo(app: App, pluginId: string): BugReportPluginInfo {
  return {
    id: pluginId,
    version: app.plugins.manifests[pluginId]?.version ?? null
  };
}
