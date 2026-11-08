/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { BugReportDiagnosticSection } from '../bug-report-diagnostics.ts';

interface BugReportRunResult {
  readonly clipboardWrites: readonly string[];
  readonly manualCopyText: null | string;
  readonly previewText: string;
  readonly urls: readonly string[];
}

interface RunParams {
  readonly isClipboardDenied: boolean;
  readonly maxUrlLength: number;
}

async function runBugReport(input: RunParams): Promise<BugReportRunResult> {
  return await evalInObsidian({
    async callback({ app, isClipboardDenied, lib: { clickElement, noopAsync, OpenBugReportCommandHandler, pressKey, waitUntil }, maxUrlLength }) {
      const pluginId = 'obsidian-lib-integration-test';
      const SETTLE_DELAY_IN_MILLISECONDS = 300;
      const urls: string[] = [];
      const clipboardWrites: string[] = [];
      const originalOpen = window.open;
      // Capture the external-navigation boundary so the test does not launch the user's browser.
      window.open = (url): null => {
        urls.push(String(url));
        return null;
      };
      // Capture the clipboard so the test neither reads nor overwrites the user's clipboard.
      const clipboard = activeWindow.navigator.clipboard;
      const isHadOwnWriteText = Object.hasOwn(clipboard, 'writeText');
      const originalWriteText = clipboard.writeText;
      clipboard.writeText = async (text: string): Promise<void> => {
        await noopAsync();
        if (isClipboardDenied) {
          throw new DOMException('Write permission denied.', 'NotAllowedError');
        }
        clipboardWrites.push(text);
      };

      const handler = new OpenBugReportCommandHandler({
        app,
        getDiagnostics: (): BugReportDiagnosticSection[] => [
          { content: 'public diagnostics', id: 'public', title: 'Public' },
          { content: 'apiToken=[redacted]', id: 'private', isPotentiallyPrivate: true, title: 'Private settings' }
        ],
        gitHubRepo: 'owner/repo',
        maxUrlLength,
        pluginId
      });

      try {
        const executePromise = handler.execute();
        await waitUntil({
          message: 'The review modal opens',
          predicate: () => activeDocument.querySelector('.bug-report-review-modal') !== null
        });
        // Let the modal's open animation finish, so the trusted clicks land on settled elements.
        await sleep(SETTLE_DELAY_IN_MILLISECONDS);
        const reviewModal = activeDocument.querySelector('.bug-report-review-modal');
        // Switch on the private section, which starts off.
        const toggles = reviewModal?.querySelectorAll<HTMLElement>('.checkbox-container') ?? [];
        await clickTarget(toggles[1]);
        await waitUntil({
          message: `The private section switches on; modals open: ${String(activeDocument.querySelectorAll('.modal-container').length)}`,
          predicate: () => toggles[1]?.classList.contains('is-enabled') === true,
          timeoutInMilliseconds: 3000
        });
        const previewText = reviewModal?.querySelector('.bug-report-preview')?.textContent ?? '';
        await clickTarget(reviewModal?.querySelector<HTMLElement>('.ok-button'));
        await waitUntil({
          message: 'The review modal closes',
          predicate: () => activeDocument.querySelector('.bug-report-review-modal') === null,
          timeoutInMilliseconds: 5000
        });

        let manualCopyText: null | string = null;
        if (isClipboardDenied) {
          await waitUntil({
            message: 'The manual-copy modal opens',
            predicate: () => activeDocument.querySelector('.copy-text-manually-modal') !== null
          });
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          const copyModal = activeDocument.querySelector('.copy-text-manually-modal');
          manualCopyText = copyModal?.querySelector('textarea')?.value ?? null;
          await clickTarget(copyModal?.querySelector<HTMLElement>('.ok-button'));
        }

        await waitUntil({
          message: `The issue form opens; clipboard writes: ${String(clipboardWrites.length)}, modals open: ${String(activeDocument.querySelectorAll('.modal-container').length)}`,
          predicate: () => urls.length > 0,
          timeoutInMilliseconds: 5000
        });
        await executePromise;
        return { clipboardWrites, manualCopyText, previewText, urls };
      } finally {
        restoreOpen();
        if (isHadOwnWriteText) {
          clipboard.writeText = originalWriteText;
        } else {
          Reflect.deleteProperty(clipboard, 'writeText');
        }
        for (let attempt = 0; attempt < 2 && activeDocument.querySelector('.bug-report-review-modal, .copy-text-manually-modal'); attempt++) {
          await pressKey({ key: 'Escape' });
        }
        for (const notice of activeDocument.querySelectorAll('.notice')) {
          notice.remove();
        }
      }

      async function clickTarget(element: HTMLElement | null | undefined): Promise<void> {
        if (!element) {
          throw new Error('The element to click is missing');
        }
        // The preview can push the buttons below the modal's scroll area, where a pointer cannot reach them.
        element.scrollIntoView({ block: 'center' });
        await sleep(SETTLE_DELAY_IN_MILLISECONDS);
        const rect = element.getBoundingClientRect();
        const hit = activeDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit || !element.contains(hit)) {
          throw new Error(`The click target is covered by ${hit?.outerHTML.slice(0, 300) ?? 'nothing'}`);
        }
        await clickElement({ element });
      }

      function restoreOpen(): void {
        window.open = originalOpen;
      }
    },
    input: { isClipboardDenied: input.isClipboardDenied, maxUrlLength: input.maxUrlLength }
  });
}

describe('OpenBugReportCommandHandler', () => {
  it('should send the reviewed diagnostics in the link when they fit', async () => {
    const result = await runBugReport({ isClipboardDenied: false, maxUrlLength: 6000 });
    expect(result.previewText).toContain('### Private settings');
    expect(result.previewText).toContain('### Public');
    expect(result.clipboardWrites).toEqual([]);
    expect(result.urls).toHaveLength(1);
    const environment = new URL(result.urls[0] ?? '').searchParams.get('environment') ?? '';
    expect(environment).toBe(result.previewText);
  });

  it('should copy an oversized report to the clipboard and open the short link', async () => {
    const result = await runBugReport({ isClipboardDenied: false, maxUrlLength: 400 });
    expect(result.clipboardWrites).toEqual([result.previewText]);
    expect(result.urls).toHaveLength(1);
    const url = result.urls[0] ?? '';
    expect(url.length).toBeLessThanOrEqual(400);
    expect(new URL(url).searchParams.get('environment')).toContain('copied to your clipboard');
  });

  it('should show the report for copying by hand when the clipboard refuses it', async () => {
    const result = await runBugReport({ isClipboardDenied: true, maxUrlLength: 400 });
    expect(result.clipboardWrites).toEqual([]);
    expect(result.manualCopyText).toBe(result.previewText);
    expect(result.urls).toHaveLength(1);
  });
});
