// @vitest-environment jsdom

import type { App as AppOriginal } from 'obsidian';
import type {
  ButtonComponent,
  ToggleComponent
} from 'obsidian-test-mocks/obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { mockImplementation } from '@mnaoumov/typescript-test-toolkit/mock-implementation';
import {
  ButtonComponent as ButtonComponentOriginal,
  ToggleComponent as ToggleComponentOriginal
} from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BugReportDiagnosticSection } from '../bug-report-diagnostics.ts';

import { reviewBugReportDiagnostics } from './review-bug-report-diagnostics.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

const PUBLIC_SECTION: BugReportDiagnosticSection = { content: 'public text', id: 'public', title: 'Public' };
const PRIVATE_SECTION: BugReportDiagnosticSection = { content: 'token=abc', id: 'private', isPotentiallyPrivate: true, title: 'Private' };
const SECTIONS: readonly BugReportDiagnosticSection[] = [PUBLIC_SECTION, PRIVATE_SECTION];

let app: AppOriginal;
const buttons: ButtonComponent[] = [];
const toggles: ToggleComponent[] = [];
let contentEl: Element | null = null;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
  buttons.length = 0;
  toggles.length = 0;
  contentEl = null;
  mockImplementation({
    $object: ButtonComponentOriginal.prototype,
    impl: function impl(this: ButtonComponentOriginal, originalImplementation, containerEl: HTMLElement): ButtonComponentOriginal {
      originalImplementation.call(this, containerEl);
      // The buttons sit in the modal's button container, inside its content element.
      contentEl = containerEl.parentElement;
      buttons.push(castTo<ButtonComponent>(this));
      return this;
    },
    method: 'constructor2__'
  });
  mockImplementation({
    $object: ToggleComponentOriginal.prototype,
    impl: function impl(this: ToggleComponentOriginal, originalImplementation, containerEl: HTMLElement): ToggleComponentOriginal {
      originalImplementation.call(this, containerEl);
      toggles.push(castTo<ToggleComponent>(this));
      return this;
    },
    method: 'constructor3__'
  });
});

function getPreview(): string {
  return contentEl?.querySelector('pre')?.textContent ?? '';
}

describe('reviewBugReportDiagnostics', () => {
  it('should include a public section and leave a private one out by default', async () => {
    const resultPromise = reviewBugReportDiagnostics({ alwaysIncludedText: '- Plugin: x', app, sections: SECTIONS });
    queueMicrotask(() => {
      expect(toggles.map((toggle) => toggle.getValue())).toEqual([true, false]);
      expect(getPreview()).toBe('- Plugin: x\n\n### Public\n\n```\npublic text\n```');
      buttons[0]?.simulateClick__();
    });
    expect(await resultPromise).toEqual([SECTIONS[0]]);
  });

  it('should include a private section the user switches on, and show it in the preview', async () => {
    const resultPromise = reviewBugReportDiagnostics({ app, sections: SECTIONS });
    queueMicrotask(() => {
      toggles[1]?.onClick();
      toggles[0]?.onClick();
      expect(getPreview()).toBe('### Private\n\n```\ntoken=abc\n```');
      buttons[0]?.simulateClick__();
    });
    expect(await resultPromise).toEqual([SECTIONS[1]]);
  });

  it('should show an empty preview when nothing is included', async () => {
    const resultPromise = reviewBugReportDiagnostics({ app, sections: [PRIVATE_SECTION] });
    queueMicrotask(() => {
      expect(getPreview()).toBe('');
      buttons[0]?.simulateClick__();
    });
    expect(await resultPromise).toEqual([]);
  });

  it('should resolve null when the user cancels', async () => {
    const resultPromise = reviewBugReportDiagnostics({ app, sections: SECTIONS });
    queueMicrotask(() => {
      buttons[1]?.simulateClick__();
    });
    expect(await resultPromise).toBeNull();
  });

  it('should resolve null when the modal is closed without continuing', async () => {
    expect(await reviewBugReportDiagnostics({ app, sections: SECTIONS })).toBeNull();
  });
});
