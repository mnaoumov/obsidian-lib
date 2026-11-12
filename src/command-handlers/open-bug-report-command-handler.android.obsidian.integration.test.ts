/// <reference types="obsidian-integration-testing/vitest/typings" />

/**
 * @file
 *
 * The oversized bug report against the REAL Android clipboard. The cross-platform file stubs `writeText`, so it proves
 * the two branches but not which one a phone takes once the review modal's await has spent the user gesture. This
 * file lets the real call run: whether it resolves or rejects, the report must reach the user either through the
 * clipboard or through the manual-copy modal, and the short issue-form link must still open. It runs only on the
 * emulator, whose clipboard is nobody's; on desktop the same call would overwrite the developer's clipboard.
 */

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { BugReportDiagnosticSection } from '../bug-report-diagnostics.ts';

type ClipboardOutcome = 'rejected' | 'resolved';

interface ClipboardState {
  readonly clipboardOutcome: ClipboardOutcome | null;
}

interface RealClipboardRunResult {
  readonly clipboardOutcome: ClipboardOutcome | null;
  readonly clipboardReadBack: null | string;
  readonly manualCopyText: null | string;
  readonly previewText: string;
  readonly urls: readonly string[];
}

describe('OpenBugReportCommandHandler on Android', () => {
  it('should hand an oversized report to the real clipboard or to the manual-copy modal', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickElement, OpenBugReportCommandHandler, pressKey, waitUntil } }): Promise<RealClipboardRunResult> {
        const SETTLE_DELAY_IN_MILLISECONDS = 300;
        const MAX_URL_LENGTH = 400;
        const urls: string[] = [];
        const state: ClipboardState = { clipboardOutcome: null };
        const originalOpen = window.open;
        // Capture the external-navigation boundary, so the test does not leave Obsidian for the browser.
        window.open = (url): null => {
          urls.push(String(url));
          return null;
        };
        // Observe the real clipboard call without replacing it.
        const clipboard = activeWindow.navigator.clipboard;
        const isHadOwnWriteText = Object.hasOwn(clipboard, 'writeText');
        const originalWriteText = clipboard.writeText;
        clipboard.writeText = observeWriteText;

        const handler = new OpenBugReportCommandHandler({
          app,
          getDiagnostics: (): BugReportDiagnosticSection[] => [{ content: 'public diagnostics', id: 'public', title: 'Public' }],
          gitHubRepo: 'owner/repo',
          maxUrlLength: MAX_URL_LENGTH,
          pluginId: 'obsidian-lib-integration-test'
        });

        try {
          const executePromise = handler.execute();
          await waitUntil({
            message: 'The review modal opens',
            predicate: () => activeDocument.querySelector('.bug-report-review-modal') !== null
          });
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          const reviewModal = activeDocument.querySelector('.bug-report-review-modal');
          const previewText = reviewModal?.querySelector('.bug-report-preview')?.textContent ?? '';
          await clickTarget(reviewModal?.querySelector<HTMLElement>('.ok-button'));
          await waitUntil({
            message: 'The clipboard is tried',
            predicate: () => state.clipboardOutcome !== null,
            timeoutInMilliseconds: 5000
          });

          let manualCopyText: null | string = null;
          if (state.clipboardOutcome === 'rejected') {
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
            message: 'The issue form opens',
            predicate: () => urls.length > 0,
            timeoutInMilliseconds: 5000
          });
          await executePromise;

          let clipboardReadBack: null | string = null;
          if (state.clipboardOutcome === 'resolved') {
            try {
              clipboardReadBack = await clipboard.readText();
            } catch {
              // Reading may be refused where writing was not; the write's resolution is then the evidence.
            }
          }

          return { clipboardOutcome: state.clipboardOutcome, clipboardReadBack, manualCopyText, previewText, urls };
        } finally {
          restoreBoundaries();
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
          element.scrollIntoView({ block: 'center' });
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          await clickElement({ element });
        }

        async function observeWriteText(text: string): Promise<void> {
          try {
            await originalWriteText.call(clipboard, text);
            state.clipboardOutcome = 'resolved';
          } catch (error) {
            state.clipboardOutcome = 'rejected';
            throw error;
          }
        }

        function restoreBoundaries(): void {
          window.open = originalOpen;
          if (isHadOwnWriteText) {
            clipboard.writeText = originalWriteText;
          } else {
            Reflect.deleteProperty(clipboard, 'writeText');
          }
        }
      }
    });

    expect(result.clipboardOutcome).not.toBeNull();
    if (result.clipboardOutcome === 'rejected') {
      expect(result.manualCopyText).toBe(result.previewText);
    } else {
      expect(result.manualCopyText).toBeNull();
      if (result.clipboardReadBack !== null) {
        expect(result.clipboardReadBack).toBe(result.previewText);
      }
    }
    expect(result.urls).toHaveLength(1);
    expect(new URL(result.urls[0] ?? '').searchParams.get('environment')).toContain('copied to your clipboard');
  });
});
