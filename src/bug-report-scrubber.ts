/**
 * @file
 *
 * Masks secrets that a bug report's diagnostics may carry by accident: token shapes of well-known services and
 * the vault and home folder paths, which name the user. It is a second wall behind the caller-declared keys
 * `redactSettings` replaces, and it covers text no key names, such as a `BugReportLogBuffer`'s entries.
 *
 * It recognizes shapes, so it is not a promise to find every secret: the user still reviews every section. No
 * pattern uses a lookbehind, which iOS before 16.4 cannot parse.
 */

import type { App } from 'obsidian';

import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';
import { Platform } from 'obsidian';

import type { BugReportDiagnosticSection } from './bug-report-diagnostics.ts';

/**
 * A folder path the scrubber replaces with a placeholder.
 */
export interface BugReportScrubbedPath {
  /**
   * The absolute path, as the platform writes it.
   */
  readonly path: string;

  /**
   * The text that replaces it, such as `<vault>`.
   */
  readonly placeholder: string;
}

/**
 * Parameters for {@link scrubBugReportDiagnosticSections}.
 */
export type ScrubBugReportDiagnosticSectionsOptions = ScrubBugReportTextOptions;

/**
 * Parameters for {@link scrubBugReportText}.
 */
export interface ScrubBugReportTextOptions {
  /**
   * The folder paths to replace. A longer path is replaced first, so a vault inside the home folder reads as
   * `<vault>`, not `<home>/...`. Paths shorter than {@link MIN_SCRUBBED_PATH_LENGTH} characters are ignored,
   * because replacing `/` or `C:` would mangle every path in the text.
   */
  readonly paths?: readonly BugReportScrubbedPath[];
}

/**
 * A token shape the scrubber masks.
 */
interface TokenPattern {
  readonly name: string;
  /**
   * A pattern whose group 1 is a prefix kept in front of the mask, such as `Bearer `.
   */
  readonly regExp: RegExp;
  /**
   * Text kept after the mask, such as the `@` that ends URL credentials.
   */
  readonly suffix?: string;
}

interface WithGetBasePath {
  readonly getBasePath: () => unknown;
}

/**
 * The shortest folder path the scrubber replaces.
 */
export const MIN_SCRUBBED_PATH_LENGTH = 4;

/**
 * The placeholder of the vault folder.
 */
export const VAULT_PATH_PLACEHOLDER = '<vault>';

/**
 * The placeholder of the user's home folder.
 */
export const HOME_PATH_PLACEHOLDER = '<home>';

const TOKEN_PATTERNS: readonly TokenPattern[] = [
  { name: 'private-key', regExp: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { name: 'github-token', regExp: /\b(?:gh[oprsu]_[A-Za-z0-9]{36,255}|github_pat_\w{22,255})\b/g },
  { name: 'gitlab-token', regExp: /\bglpat-[\w-]{20,}/g },
  { name: 'slack-webhook', regExp: /https:\/\/hooks\.slack\.com\/services\/[\w/]+/g },
  { name: 'slack-token', regExp: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'aws-access-key', regExp: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { name: 'google-api-key', regExp: /\bAIza[\w-]{35}/g },
  { name: 'stripe-key', regExp: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'anthropic-key', regExp: /\bsk-ant-[\w-]{20,}/g },
  { name: 'openai-key', regExp: /\bsk-(?:proj-|svcacct-|admin-)?[\w-]{20,}/g },
  { name: 'npm-token', regExp: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'jwt', regExp: /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g },
  { name: 'bearer-token', regExp: /\b(?<prefix>Bearer\s+)[\w.~+/-]{16,}=*/gi },
  { name: 'url-credentials', regExp: /\b(?<prefix>[a-z][\w+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, suffix: '@' }
];

// Either separator, and the doubled backslash JSON writes.
const PATH_SEPARATOR_PATTERN = String.raw`(?:\\{1,2}|/)`;
// Keeps `/home/al` from matching the start of `/home/alice`.
const PATH_END_PATTERN = String.raw`(?![\w-])`;

/**
 * Gets the folder paths a bug report from this device should not name: the vault folder, read from the vault
 * adapter, and on desktop the user's home folder. A path that cannot be read is left out.
 *
 * @param app - The Obsidian app instance.
 * @returns The paths, with {@link VAULT_PATH_PLACEHOLDER} and {@link HOME_PATH_PLACEHOLDER}.
 */
export async function getBugReportScrubbedPaths(app: App): Promise<BugReportScrubbedPath[]> {
  const paths: BugReportScrubbedPath[] = [];
  const vaultPath = getVaultBasePath(app);
  if (vaultPath !== null) {
    paths.push({ path: vaultPath, placeholder: VAULT_PATH_PLACEHOLDER });
  }

  if (Platform.isDesktopApp) {
    try {
      const { getHomeFolderPath } = await import('./desktop-home-folder.ts');
      paths.push({ path: getHomeFolderPath(), placeholder: HOME_PATH_PLACEHOLDER });
    } catch {
      // No home folder to scrub: the vault path and the token shapes still apply.
    }
  }

  return paths;
}

/**
 * Scrubs the content of each section with {@link scrubBugReportText}. The sections are not changed.
 *
 * @param sections - The sections.
 * @param options - The options.
 * @returns The scrubbed copies.
 */
export function scrubBugReportDiagnosticSections(
  sections: readonly BugReportDiagnosticSection[],
  options: ScrubBugReportDiagnosticSectionsOptions = {}
): BugReportDiagnosticSection[] {
  return sections.map((section) => ({ ...section, content: scrubBugReportText(section.content, options) }));
}

/**
 * Masks token shapes and the given folder paths in a bug report's text. A token becomes `[redacted <kind>]`;
 * a path becomes its placeholder, whichever separator or letter case the text writes it with.
 *
 * @param text - The text.
 * @param options - The options.
 * @returns The scrubbed text.
 */
export function scrubBugReportText(text: string, options: ScrubBugReportTextOptions = {}): string {
  let result = text;
  for (const pattern of TOKEN_PATTERNS) {
    // Without a group, the second argument is the match offset, a number.
    result = result.replace(pattern.regExp, (_match: string, prefix: unknown) => {
      const keptPrefix = typeof prefix === 'string' ? prefix : '';
      return `${keptPrefix}[redacted ${pattern.name}]${pattern.suffix ?? ''}`;
    });
  }

  const paths = [...(options.paths ?? [])]
    .map((scrubbedPath) => ({ path: trimTrailingSeparators(scrubbedPath.path), placeholder: scrubbedPath.placeholder }))
    .filter((scrubbedPath) => scrubbedPath.path.length >= MIN_SCRUBBED_PATH_LENGTH)
    .sort((a, b) => b.path.length - a.path.length);

  for (const scrubbedPath of paths) {
    result = result.replace(getPathRegExp(scrubbedPath.path), () => scrubbedPath.placeholder);
  }

  return result;
}

function getPathRegExp(path: string): RegExp {
  const segments = path.split(/[\\/]+/).map((segment) => escapeRegExp(segment));
  return new RegExp(segments.join(PATH_SEPARATOR_PATTERN) + PATH_END_PATTERN, 'gi');
}

function getVaultBasePath(app: App): null | string {
  // Desktop's `FileSystemAdapter` declares `getBasePath()`; the mobile adapter keeps an undeclared `basePath`.
  const adapter: unknown = app.vault.adapter;
  if (typeof adapter !== 'object' || adapter === null) {
    return null;
  }
  if (hasGetBasePath(adapter)) {
    const basePath = adapter.getBasePath();
    return typeof basePath === 'string' ? basePath : null;
  }
  return 'basePath' in adapter && typeof adapter.basePath === 'string' ? adapter.basePath : null;
}

function hasGetBasePath(adapter: object): adapter is WithGetBasePath {
  return 'getBasePath' in adapter && typeof adapter.getBasePath === 'function';
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}
