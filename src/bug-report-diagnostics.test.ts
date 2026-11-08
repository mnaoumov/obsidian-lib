import {
  describe,
  expect,
  it
} from 'vitest';

import {
  BugReportLogBuffer,
  createSettingsDiagnosticSection,
  DEFAULT_BUG_REPORT_LOG_MAX_ENTRIES,
  DEFAULT_BUG_REPORT_LOG_MAX_ENTRY_LENGTH,
  formatBugReportDiagnostics,
  getMarkdownFence,
  REDACTED_VALUE,
  redactSettings
} from './bug-report-diagnostics.ts';

const FIXED_DATE = new Date('2026-11-07T12:00:00.000Z');

function now(): Date {
  return FIXED_DATE;
}

describe('BugReportLogBuffer', () => {
  it('should stamp entries and keep them oldest first', () => {
    const buffer = new BugReportLogBuffer({ now });
    buffer.add('first');
    buffer.add('second');
    expect(buffer.getEntries()).toEqual([
      '2026-11-07T12:00:00.000Z first',
      '2026-11-07T12:00:00.000Z second'
    ]);
  });

  it('should drop the oldest entries past the bound', () => {
    const buffer = new BugReportLogBuffer({ maxEntries: 2, now });
    buffer.add('a');
    buffer.add('b');
    buffer.add('c');
    expect(buffer.getEntries().map((entry) => entry.split(' ', 2)[1])).toEqual(['b', 'c']);
  });

  it('should cut a long entry and say so', () => {
    const buffer = new BugReportLogBuffer({ maxEntryLength: 3, now });
    buffer.add('abcdef');
    buffer.add('abc');
    expect(buffer.getEntries()).toEqual([
      '2026-11-07T12:00:00.000Z abc [truncated]',
      '2026-11-07T12:00:00.000Z abc'
    ]);
  });

  it('should clamp nonsensical bounds to one', () => {
    const buffer = new BugReportLogBuffer({ maxEntries: 0, maxEntryLength: -5, now });
    buffer.add('ab');
    buffer.add('cd');
    expect(buffer.getEntries()).toEqual(['2026-11-07T12:00:00.000Z c [truncated]']);
  });

  it('should use the default bounds and the real clock', () => {
    const buffer = new BugReportLogBuffer();
    for (let index = 0; index <= DEFAULT_BUG_REPORT_LOG_MAX_ENTRIES; index++) {
      buffer.add(String(index));
    }
    buffer.add('x'.repeat(DEFAULT_BUG_REPORT_LOG_MAX_ENTRY_LENGTH + 1));
    const entries = buffer.getEntries();
    expect(entries).toHaveLength(DEFAULT_BUG_REPORT_LOG_MAX_ENTRIES);
    expect(entries.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T\S+ x+ \[truncated\]$/);
  });

  it('should return a copy of the entries', () => {
    const buffer = new BugReportLogBuffer({ now });
    buffer.add('a');
    const entries = buffer.getEntries();
    buffer.add('b');
    expect(entries).toHaveLength(1);
  });

  it('should clear', () => {
    const buffer = new BugReportLogBuffer({ now });
    buffer.add('a');
    buffer.clear();
    expect(buffer.getEntries()).toEqual([]);
  });

  it('should build a potentially private section', () => {
    const buffer = new BugReportLogBuffer({ now });
    expect(buffer.toSection()).toEqual({ content: '(no log entries)', id: 'logs', isPotentiallyPrivate: true, title: 'Logs' });
    buffer.add('a');
    expect(buffer.toSection({ id: 'sync-log', title: 'Sync log' })).toEqual({
      content: '2026-11-07T12:00:00.000Z a',
      id: 'sync-log',
      isPotentiallyPrivate: true,
      title: 'Sync log'
    });
  });
});

describe('redactSettings', () => {
  it('should redact the declared keys at any depth, ignoring case, without changing the original', () => {
    const settings = {
      apiToken: 'secret-1',
      nested: { list: [{ PASSWORD: 'secret-2', path: 'a.md' }], token: null },
      shown: 1
    };
    expect(redactSettings(settings, ['apiToken', 'password', 'TOKEN'])).toEqual({
      apiToken: REDACTED_VALUE,
      nested: { list: [{ PASSWORD: REDACTED_VALUE, path: 'a.md' }], token: REDACTED_VALUE },
      shown: 1
    });
    expect(settings.apiToken).toBe('secret-1');
  });

  it('should pass primitives through', () => {
    expect(redactSettings('text', ['a'])).toBe('text');
    expect(redactSettings(null, ['a'])).toBeNull();
  });

  it('should mark a cycle rather than recurse forever, but keep a value shared by siblings', () => {
    const shared = { value: 1 };
    const settings: Record<string, unknown> = { first: shared, second: shared };
    settings['self'] = settings;
    const list: unknown[] = [];
    list.push(list);
    settings['list'] = list;
    expect(redactSettings(settings, [])).toEqual({
      first: { value: 1 },
      list: ['[circular]'],
      second: { value: 1 },
      self: '[circular]'
    });
  });
});

describe('createSettingsDiagnosticSection', () => {
  it('should render the redacted settings as JSON in a private section', () => {
    expect(createSettingsDiagnosticSection({ secretKeys: ['token'], settings: { mode: 'fast', token: 'abc' } })).toEqual({
      content: '{\n  "mode": "fast",\n  "token": "[redacted]"\n}',
      id: 'settings',
      isPotentiallyPrivate: true,
      title: 'Plugin settings'
    });
  });

  it('should accept an id, a title and settings JSON cannot represent', () => {
    expect(createSettingsDiagnosticSection({ id: 'data', settings: undefined, title: 'data.json' })).toEqual({
      content: 'undefined',
      id: 'data',
      isPotentiallyPrivate: true,
      title: 'data.json'
    });
  });
});

describe('getMarkdownFence', () => {
  it('should be three backticks for content without a longer run', () => {
    expect(getMarkdownFence('plain `code` and ``two``')).toBe('```');
  });

  it('should outrun the longest run of backticks', () => {
    expect(getMarkdownFence('````\nfenced\n````')).toBe('`````');
  });
});

describe('formatBugReportDiagnostics', () => {
  it('should render nothing for no sections', () => {
    expect(formatBugReportDiagnostics([])).toBe('');
  });

  it('should render a heading and a safe fence per section', () => {
    expect(formatBugReportDiagnostics([
      { content: 'a', id: 'a', title: 'A' },
      { content: '```\nb\n```', id: 'b', title: 'B' }
    ])).toBe('### A\n\n```\na\n```\n\n### B\n\n````\n```\nb\n```\n````');
  });
});
