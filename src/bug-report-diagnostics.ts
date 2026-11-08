/**
 * @file
 *
 * Optional diagnostics a plugin can attach to a bug report: sections of text the user reviews before
 * anything leaves Obsidian, a bounded log buffer, and redaction of a plugin's own settings.
 *
 * Nothing here reads logs or settings by itself. A log buffer holds only what the plugin wrote to it since
 * the buffer was created, never the console's history, and a settings section holds only the object the
 * plugin hands over. Redaction replaces the values of caller-declared keys; it is not a promise to find
 * every secret, which is why every section is shown to the user, and a potentially private one is left
 * out unless the user includes it.
 */

/**
 * A section of diagnostics for a bug report.
 */
export interface BugReportDiagnosticSection {
  /**
   * The section's text, shown to the user and sent as written.
   */
  readonly content: string;

  /**
   * A stable id, unique among the sections of one report.
   */
  readonly id: string;

  /**
   * Whether the section can hold private data, such as logs or settings. A potentially private section is
   * left out of the report unless the user includes it.
   *
   * @default `false`
   */
  readonly isPotentiallyPrivate?: boolean;

  /**
   * The section's title.
   */
  readonly title: string;
}

/**
 * Constructor parameters for {@link BugReportLogBuffer}.
 */
export interface BugReportLogBufferConstructorOptions {
  /**
   * The most entries kept. Older entries are dropped first.
   *
   * @default {@link DEFAULT_BUG_REPORT_LOG_MAX_ENTRIES}
   */
  readonly maxEntries?: number;

  /**
   * The most characters kept of one entry. A longer entry is cut, and says so.
   *
   * @default {@link DEFAULT_BUG_REPORT_LOG_MAX_ENTRY_LENGTH}
   */
  readonly maxEntryLength?: number;

  /**
   * Gets the current time. For tests.
   *
   * @default `() => new Date()`
   */
  readonly now?: () => Date;
}

/**
 * Parameters for {@link BugReportLogBuffer.toSection}.
 */
export interface BugReportLogBufferToSectionOptions {
  /**
   * The section's id.
   *
   * @default `'logs'`
   */
  readonly id?: string;

  /**
   * The section's title.
   *
   * @default `'Logs'`
   */
  readonly title?: string;
}

/**
 * Parameters for {@link createSettingsDiagnosticSection}.
 */
export interface CreateSettingsDiagnosticSectionParams {
  /**
   * The section's id.
   *
   * @default `'settings'`
   */
  readonly id?: string;

  /**
   * The keys whose values are replaced with {@link REDACTED_VALUE}, at any depth, compared without case.
   */
  readonly secretKeys?: readonly string[];

  /**
   * The reporting plugin's own settings, such as its `data.json`.
   */
  readonly settings: unknown;

  /**
   * The section's title.
   *
   * @default `'Plugin settings'`
   */
  readonly title?: string;
}

/**
 * The value that replaces a redacted setting.
 */
export const REDACTED_VALUE = '[redacted]';

/**
 * The default number of entries a {@link BugReportLogBuffer} keeps.
 */
export const DEFAULT_BUG_REPORT_LOG_MAX_ENTRIES = 200;

/**
 * The default number of characters a {@link BugReportLogBuffer} keeps of one entry.
 */
export const DEFAULT_BUG_REPORT_LOG_MAX_ENTRY_LENGTH = 2000;

const JSON_INDENT = 2;
const MIN_FENCE_LENGTH = 3;
const TRUNCATION_MARKER = ' [truncated]';

/**
 * A bounded buffer of log entries a plugin writes for its bug reports. It keeps only what the plugin adds
 * after creating it, at most {@link BugReportLogBufferConstructorOptions.maxEntries} entries, each cut to
 * {@link BugReportLogBufferConstructorOptions.maxEntryLength} characters.
 */
export class BugReportLogBuffer {
  private readonly entries: string[] = [];
  private readonly maxEntries: number;
  private readonly maxEntryLength: number;
  private readonly now: () => Date;

  /**
   * Constructs a new instance.
   *
   * @param options - Constructor options.
   */
  public constructor(options: BugReportLogBufferConstructorOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_BUG_REPORT_LOG_MAX_ENTRIES));
    this.maxEntryLength = Math.max(1, Math.floor(options.maxEntryLength ?? DEFAULT_BUG_REPORT_LOG_MAX_ENTRY_LENGTH));
    this.now = options.now ?? ((): Date => new Date());
  }

  /**
   * Adds an entry, stamped with the current time.
   *
   * @param message - The entry's text.
   */
  public add(message: string): void {
    const text = message.length > this.maxEntryLength
      ? message.slice(0, this.maxEntryLength) + TRUNCATION_MARKER
      : message;
    this.entries.push(`${this.now().toISOString()} ${text}`);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  /**
   * Removes every entry.
   */
  public clear(): void {
    this.entries.length = 0;
  }

  /**
   * Gets the entries, oldest first.
   *
   * @returns The entries.
   */
  public getEntries(): readonly string[] {
    return [...this.entries];
  }

  /**
   * Builds a potentially private diagnostic section holding the entries.
   *
   * @param options - The options.
   * @returns The section.
   */
  public toSection(options: BugReportLogBufferToSectionOptions = {}): BugReportDiagnosticSection {
    return {
      content: this.entries.length === 0 ? '(no log entries)' : this.entries.join('\n'),
      id: options.id ?? 'logs',
      isPotentiallyPrivate: true,
      title: options.title ?? 'Logs'
    };
  }
}

/**
 * Builds a potentially private diagnostic section holding the plugin's settings as JSON, with the values
 * of {@link CreateSettingsDiagnosticSectionParams.secretKeys} redacted.
 *
 * @param params - The parameters.
 * @returns The section.
 */
export function createSettingsDiagnosticSection(params: CreateSettingsDiagnosticSectionParams): BugReportDiagnosticSection {
  return {
    content: JSON.stringify(redactSettings(params.settings, params.secretKeys ?? []), null, JSON_INDENT) ?? 'undefined',
    id: params.id ?? 'settings',
    isPotentiallyPrivate: true,
    title: params.title ?? 'Plugin settings'
  };
}

/**
 * Renders diagnostic sections as Markdown: a level-3 heading and a fenced code block per section. The
 * fence is longer than any run of backticks in the content, so no content can close it.
 *
 * @param sections - The sections.
 * @returns The Markdown, or an empty string when there are no sections.
 */
export function formatBugReportDiagnostics(sections: readonly BugReportDiagnosticSection[]): string {
  return sections.map((section) => {
    const fence = getMarkdownFence(section.content);
    return `### ${section.title}\n\n${fence}\n${section.content}\n${fence}`;
  }).join('\n\n');
}

/**
 * Gets a Markdown code fence that the given content cannot close.
 *
 * @param content - The content to fence.
 * @returns A run of backticks longer than the longest run in the content, and at least three long.
 */
export function getMarkdownFence(content: string): string {
  let longestRun = 0;
  for (const match of content.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  return '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
}

/**
 * Copies settings, replacing the value of every key in `secretKeys`, at any depth and compared without
 * case, with {@link REDACTED_VALUE}. The original is not changed.
 *
 * @param settings - The settings.
 * @param secretKeys - The keys to redact.
 * @returns The redacted copy.
 */
export function redactSettings(settings: unknown, secretKeys: readonly string[]): unknown {
  const lowerCaseSecretKeys = new Set(secretKeys.map((key) => key.toLowerCase()));
  return redactValue(settings, lowerCaseSecretKeys, new WeakSet());
}

function redactValue(value: unknown, lowerCaseSecretKeys: ReadonlySet<string>, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item: unknown) => redactValue(item, lowerCaseSecretKeys, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = lowerCaseSecretKeys.has(key.toLowerCase()) ? REDACTED_VALUE : redactValue(child, lowerCaseSecretKeys, seen);
  }
  seen.delete(value);
  return result;
}
