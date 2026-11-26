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
 *
 * The runtime line reads `process.versions` (Electron, Chromium) only behind `Platform.isDesktopApp`, since
 * `process` exists only in the desktop renderer, and falls back to the user agent's `Electron/`, `Chrome/`
 * and `AppleWebKit/` tokens. On mobile it also names the Capacitor platform, read structurally from the
 * `Capacitor` bridge's `getPlatform`, and takes the web view from Capacitor's device info: the Android
 * System WebView's version, and on iOS the iOS version, since WKWebView ships with the OS and its
 * `AppleWebKit/605.1.15` token is frozen.
 *
 * The device line holds only coarse values: the model and whether it is a phone, a tablet or a virtual
 * device on mobile, the screen size in CSS pixels and the pixel ratio, and `navigator.deviceMemory`, which
 * Chromium rounds to a power of two. Nothing is read before the user invokes the report, and nothing is
 * sent anywhere: the report only becomes an issue-form link the user reviews.
 */

import type { App } from 'obsidian';

import {
  apiVersion,
  Platform
} from 'obsidian';

import type { BugReportDiagnosticSection } from './bug-report-diagnostics.ts';
import type { MobileAppInfo } from './mobile-app-info.ts';

import { formatBugReportDiagnostics } from './bug-report-diagnostics.ts';
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
 * The default budget, in characters of the encoded URL, of a prefilled bug-report link.
 *
 * Measured against `github.com` on 2026-11-07, signed out: an issue-form URL up to about 6,540 characters
 * was answered with the usual redirect to the form, about 8,088 with a 502, and 8,288 and more with a 414.
 * 6,000 leaves room for a longer repository name and for a signed-in session's own limits.
 */
export const DEFAULT_BUG_REPORT_MAX_URL_LENGTH = 6000;

/**
 * A link to a bug-report issue form, as {@link buildBugReportIssueFormLink} builds it.
 */
export interface BugReportIssueFormLink {
  /**
   * The text the user must paste into the form's environment field, when the full report did not fit the
   * URL budget; `null` when the URL carries the whole report.
   */
  readonly clipboardText: null | string;

  /**
   * The link.
   */
  readonly url: string;
}

/**
 * Parameters for {@link buildBugReportIssueFormLink}.
 */
export interface BuildBugReportIssueFormLinkParams {
  /**
   * The diagnostics the user agreed to include, appended to the environment field.
   */
  readonly diagnostics?: readonly BugReportDiagnosticSection[];

  /**
   * The environment, from {@link getBugReportEnvironment}.
   */
  readonly environment: BugReportEnvironment;

  /**
   * The plugin's GitHub repository, as `owner/name`.
   */
  readonly gitHubRepo: string;

  /**
   * The most characters the encoded URL may have before the report moves to the clipboard.
   *
   * @default {@link DEFAULT_BUG_REPORT_MAX_URL_LENGTH}
   */
  readonly maxUrlLength?: number;

  /**
   * The issue's title. Leave it out to keep the form's own default title.
   */
  readonly title?: string;
}

/**
 * The text the environment field holds when the report moved to the clipboard.
 */
export const BUG_REPORT_PASTE_INSTRUCTIONS = 'The full environment and diagnostics were copied to your clipboard because they are too long for a link. Replace this text by pasting them here.';

/**
 * The environment a bug report needs.
 */
export interface BugReportEnvironment {
  /**
   * The device, from coarse values only: the model, `phone` or `tablet`, and `emulator` or `simulator` on
   * mobile, then the screen size in CSS pixels with the pixel ratio and the approximate memory, such as
   * `Google Pixel 8, phone, screen 412x915 at 2.625x, about 8 GB memory`. `unknown` when nothing says.
   *
   * Optional, so an environment built by hand before it existed still type-checks;
   * {@link getBugReportEnvironment} always sets it.
   */
  readonly device?: string;

  /**
   * The other loaded plugins, sorted by id.
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

  /**
   * The runtime under Obsidian: the Electron and Chromium versions on desktop, such as
   * `Electron 37.2.0, Chromium 138.0.7204.100`, or the Capacitor platform and its web view on mobile, such
   * as `Capacitor android, Chromium 140.0.7339.51` or `Capacitor ios, WebKit of iOS 18.1`. `unknown` when
   * nothing says.
   *
   * Optional, so an environment built by hand before it existed still type-checks;
   * {@link getBugReportEnvironment} always sets it.
   */
  readonly runtime?: string;
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

interface CapacitorWithPlatform {
  readonly getPlatform?: unknown;
}

interface NavigatorWithDeviceInfo {
  readonly deviceMemory?: unknown;
  readonly userAgent?: unknown;
}

interface PlatformWithBuild {
  readonly build?: unknown;
}

interface ProcessWithVersions {
  readonly versions?: Readonly<Record<string, unknown>>;
}

interface WindowWithRuntime {
  readonly Capacitor?: CapacitorWithPlatform;
  readonly process?: ProcessWithVersions;
}

const UNKNOWN = 'unknown';

/**
 * Builds a link to a plugin's bug-report issue form, prefilled with the environment and the given
 * diagnostics. When the encoded link would be longer than
 * {@link BuildBugReportIssueFormLinkParams.maxUrlLength}, the environment field gets
 * {@link BUG_REPORT_PASTE_INSTRUCTIONS} instead, and the full text is returned as
 * {@link BugReportIssueFormLink.clipboardText} for the caller to copy. Nothing is cut.
 *
 * @param params - The parameters.
 * @returns The link, and the text to paste when it did not fit.
 */
export function buildBugReportIssueFormLink(params: BuildBugReportIssueFormLinkParams): BugReportIssueFormLink {
  const { environment } = params;
  const diagnosticsMarkdown = formatBugReportDiagnostics(params.diagnostics ?? []);
  const environmentText = diagnosticsMarkdown === ''
    ? formatBugReportEnvironment(environment)
    : `${formatBugReportEnvironment(environment)}\n\n${diagnosticsMarkdown}`;

  function buildUrl(environmentFieldValue: string): string {
    return getGitHubIssueFormUrl({
      fields: {
        [BugReportIssueFormFieldId.Environment]: environmentFieldValue,
        [BugReportIssueFormFieldId.ObsidianVersion]: environment.obsidianVersion,
        [BugReportIssueFormFieldId.OperatingSystem]: environment.operatingSystem,
        [BugReportIssueFormFieldId.PluginVersion]: environment.plugin.version ?? UNKNOWN
      },
      gitHubRepo: params.gitHubRepo,
      template: BUG_REPORT_ISSUE_FORM_TEMPLATE,
      ...(params.title !== undefined && { title: params.title })
    });
  }

  const fullUrl = buildUrl(environmentText);
  return fullUrl.length <= (params.maxUrlLength ?? DEFAULT_BUG_REPORT_MAX_URL_LENGTH) ? { clipboardText: null, url: fullUrl } : { clipboardText: environmentText, url: buildUrl(BUG_REPORT_PASTE_INSTRUCTIONS) };
}

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
  const lines = [
    `- Plugin: ${formatPluginInfo(environment.plugin)}`,
    `- Obsidian: ${environment.obsidianVersion} (installer ${environment.installerVersion})`,
    `- Platform: ${environment.platform}`,
    `- Operating system: ${environment.operatingSystem}`
  ];
  if (environment.runtime !== undefined) {
    lines.push(`- Runtime: ${environment.runtime}`);
  }
  if (environment.device !== undefined) {
    lines.push(`- Device: ${environment.device}`);
  }
  lines.push(`- Other enabled plugins: ${enabledPlugins}`);
  return lines.join('\n');
}

/**
 * Gets the environment a bug report needs: the plugin's version, the other enabled plugins, the
 * Obsidian and installer versions, the platform, the operating system, the runtime and the device.
 *
 * @param params - The parameters.
 * @returns The environment.
 */
export async function getBugReportEnvironment(params: GetBugReportEnvironmentParams): Promise<BugReportEnvironment> {
  const { app, pluginId } = params;
  const mobileAppInfo = Platform.isMobileApp ? await getMobileAppInfo() : null;
  const { installerVersion, operatingSystem } = await getAppAndOperatingSystem(mobileAppInfo);

  return {
    device: getDevice(mobileAppInfo),
    // The loaded plugins, as Obsidian's Show debug info lists them: `enabledPlugins` also holds an id
    // whose folder was deleted, or whose load failed.
    enabledPlugins: Object.keys(app.plugins.plugins)
      .filter((id) => id !== pluginId)
      .sort()
      .map((id) => getPluginInfo(app, id)),
    installerVersion,
    obsidianVersion: apiVersion,
    operatingSystem,
    platform: getPlatformName(),
    plugin: getPluginInfo(app, pluginId),
    runtime: getRuntime(mobileAppInfo)
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

  return buildBugReportIssueFormLink({
    environment,
    gitHubRepo: params.gitHubRepo,
    maxUrlLength: Infinity,
    ...(params.title !== undefined && { title: params.title })
  }).url;
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

async function getAppAndOperatingSystem(mobileAppInfo: MobileAppInfo | null): Promise<AppAndOperatingSystem> {
  if (Platform.isMobileApp) {
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

function getDevice(mobileAppInfo: MobileAppInfo | null): string {
  const parts: string[] = [];
  if (Platform.isMobileApp) {
    if (mobileAppInfo?.device) {
      parts.push(mobileAppInfo.device);
    }
    parts.push(Platform.isTablet ? 'tablet' : 'phone');
  }

  const { devicePixelRatio, screen } = window;
  if (screen.width > 0 && screen.height > 0) {
    parts.push(`screen ${String(screen.width)}x${String(screen.height)} at ${String(devicePixelRatio)}x`);
  }

  // eslint-disable-next-line obsidian-dev-toolkit/prefer-active-window -- the navigator reports the same device and browser in every window
  const { deviceMemory } = window.navigator as NavigatorWithDeviceInfo;
  if (typeof deviceMemory === 'number' && deviceMemory > 0) {
    parts.push(`about ${String(deviceMemory)} GB memory`);
  }

  return parts.length === 0 ? UNKNOWN : parts.join(', ');
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

function getRuntime(mobileAppInfo: MobileAppInfo | null): string {
  const windowWithRuntime = window as WindowWithRuntime;
  // The user agent is read for the engine versions only; the platform itself comes from `Platform`.
  // eslint-disable-next-line obsidian-dev-toolkit/prefer-active-window -- the navigator reports the same device and browser in every window
  const { userAgent } = window.navigator as NavigatorWithDeviceInfo;
  const userAgentText = typeof userAgent === 'string' ? userAgent : '';

  function readVersion(processVersionKey: string, userAgentToken: string): null | string {
    // `process` exists only in the desktop renderer, so it is read only there; the user agent is the fallback.
    const processVersion = Platform.isDesktopApp ? windowWithRuntime.process?.versions?.[processVersionKey] : undefined;
    return typeof processVersion === 'string'
      ? processVersion
      : new RegExp(String.raw`\b${userAgentToken}/([\d.]+)`).exec(userAgentText)?.[1] ?? null;
  }

  const parts: string[] = [];
  const capacitor = windowWithRuntime.Capacitor;
  const getCapacitorPlatform = capacitor?.getPlatform;
  if (Platform.isMobileApp && typeof getCapacitorPlatform === 'function') {
    const capacitorPlatform: unknown = getCapacitorPlatform.call(capacitor);
    parts.push(`Capacitor ${typeof capacitorPlatform === 'string' ? capacitorPlatform : UNKNOWN}`);
  }

  const electronVersion = readVersion('electron', 'Electron');
  if (electronVersion !== null) {
    parts.push(`Electron ${electronVersion}`);
  }

  const webViewVersion = mobileAppInfo?.webViewVersion ?? null;
  if (Platform.isIosApp) {
    // WKWebView ships with iOS, and its `AppleWebKit/605.1.15` token is frozen, so the iOS version is the
    // engine's version. Capacitor's device info answers it as the web view version on iOS.
    const iosVersion = webViewVersion ?? readIosVersionFromUserAgent(userAgentText);
    if (iosVersion !== null) {
      parts.push(`WebKit of iOS ${iosVersion}`);
      return parts.join(', ');
    }
  }

  // On Android the device's own answer is the System WebView's version: the user agent's `Chrome/` token
  // carries the same number unless the web view reports a reduced or frozen one.
  const chromiumVersion = (Platform.isAndroidApp ? webViewVersion : null) ?? readVersion('chrome', 'Chrome');
  const webKitVersion = readVersion('webkit', 'AppleWebKit');
  if (chromiumVersion !== null) {
    parts.push(`Chromium ${chromiumVersion}`);
  } else if (webKitVersion !== null) {
    parts.push(`WebKit ${webKitVersion}`);
  }

  return parts.length === 0 ? UNKNOWN : parts.join(', ');
}

function readIosVersionFromUserAgent(userAgentText: string): null | string {
  return /\bOS (?<iosVersion>\d+(?:_\d+)*) like Mac OS X\b/.exec(userAgentText)?.groups?.['iosVersion']?.replaceAll('_', '.') ?? null;
}
