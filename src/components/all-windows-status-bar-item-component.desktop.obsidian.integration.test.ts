/**
 * @file
 *
 * Integration tests for {@link AllWindowsStatusBarItemComponent}, against a live Obsidian instance.
 *
 * Only a real app proves the premise the component is built on: a popout has no status bar of its own, and a
 * `.status-bar` created inside its `.app-container` is laid out by Obsidian's own CSS like the main one. Popouts exist
 * on desktop only.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface ProbeResult {
  readonly didPopoutHaveStatusBar: boolean;
  readonly firstAfterOwnUnload: readonly string[];
  readonly mainAfterUnload: readonly string[];
  readonly mainItems: readonly string[];
  readonly mainUpdated: readonly string[];
  readonly popoutAfterUnload: number;
  readonly popoutBarIsMarked: boolean;
  readonly popoutBarIsVisible: boolean;
  readonly popoutBarMatchesMainPosition: boolean;
  readonly popoutItems: readonly string[];
  readonly popoutUpdated: readonly string[];
  readonly secondAfterFirstUnload: readonly string[];
  readonly secondForgotClosedPopout: boolean;
}

describe('AllWindowsStatusBarItemComponent', () => {
  it('should show, update and remove only its own items in the main window and a real popout', async () => {
    const result = await evalInObsidian<Record<string, never>, ProbeResult>({
      async callback({ app, lib: { AllWindowsStatusBarItemComponent, getMainWindow, waitUntil, WINDOW_STATUS_BAR_CSS_CLASS } }) {
        const mainWindow = getMainWindow(app);
        const FIRST_CLASS = 'all-windows-status-bar-item-probe-first';
        const SECOND_CLASS = 'all-windows-status-bar-item-probe-second';

        function readTexts(doc: Document, cls: string): string[] {
          return Array.from(doc.querySelectorAll(`.status-bar > .status-bar-item.${cls}`), (el) => el.textContent);
        }

        function getStatusBar(doc: Document): HTMLElement | null {
          return doc.body.querySelector<HTMLElement>(':scope > .app-container > .status-bar');
        }

        const leaf = app.workspace.openPopoutLeaf();
        const popoutWindow = leaf.getContainer().win;
        const popoutDocument = popoutWindow.document;
        let version = 1;
        const first = new AllWindowsStatusBarItemComponent({
          app,
          cls: [FIRST_CLASS],
          render({ el, win }): void {
            el.setText(`${win === mainWindow ? 'main' : 'popout'} ${String(version)}`);
          }
        });
        const second = new AllWindowsStatusBarItemComponent({
          app,
          cls: [SECOND_CLASS],
          render({ el }): void {
            el.setText('Second');
          }
        });
        let isLeafAttached = true;
        try {
          await waitUntil({ message: 'the popout to load', predicate: () => popoutDocument.readyState === 'complete' });
          const didPopoutHaveStatusBar = getStatusBar(popoutDocument) !== null;

          first.load();
          second.load();
          await waitUntil({ message: 'the popout item', predicate: () => readTexts(popoutDocument, FIRST_CLASS).length === 1 });

          const popoutBarEl = getStatusBar(popoutDocument);
          const isPopoutBarIsMarked = popoutBarEl?.classList.contains(WINDOW_STATUS_BAR_CSS_CLASS) ?? false;
          const isPopoutBarIsVisible = (popoutBarEl?.offsetHeight ?? 0) > 0;
          const mainBarEl = getStatusBar(document);
          const isPopoutBarMatchesMainPosition = popoutBarEl !== null && mainBarEl !== null
            && popoutWindow.getComputedStyle(popoutBarEl).position === window.getComputedStyle(mainBarEl).position;
          const mainItems = readTexts(document, FIRST_CLASS);
          const popoutItems = readTexts(popoutDocument, FIRST_CLASS);

          version = 2;
          first.refresh();
          const mainUpdated = readTexts(document, FIRST_CLASS);
          const popoutUpdated = readTexts(popoutDocument, FIRST_CLASS);

          first.unload();
          const firstAfterOwnUnload = [...readTexts(document, FIRST_CLASS), ...readTexts(popoutDocument, FIRST_CLASS)];
          const secondAfterFirstUnload = [...readTexts(document, SECOND_CLASS), ...readTexts(popoutDocument, SECOND_CLASS)];

          leaf.detach();
          isLeafAttached = false;
          await waitUntil({ message: 'the popout to close', predicate: () => second.getItemEl(popoutWindow) === null });
          const isSecondForgotClosedPopout = second.getItemEls().length === 1;

          second.unload();

          return {
            didPopoutHaveStatusBar,
            firstAfterOwnUnload,
            mainAfterUnload: readTexts(document, SECOND_CLASS),
            mainItems,
            mainUpdated,
            popoutAfterUnload: readTexts(popoutDocument, SECOND_CLASS).length,
            popoutBarIsMarked: isPopoutBarIsMarked,
            popoutBarIsVisible: isPopoutBarIsVisible,
            popoutBarMatchesMainPosition: isPopoutBarMatchesMainPosition,
            popoutItems,
            popoutUpdated,
            secondAfterFirstUnload,
            secondForgotClosedPopout: isSecondForgotClosedPopout
          };
        } finally {
          first.unload();
          second.unload();
          if (isLeafAttached) {
            leaf.detach();
          }
        }
      }
    });

    expect(result).toStrictEqual({
      didPopoutHaveStatusBar: false,
      firstAfterOwnUnload: [],
      mainAfterUnload: [],
      mainItems: ['main 1'],
      mainUpdated: ['main 2'],
      popoutAfterUnload: 0,
      popoutBarIsMarked: true,
      popoutBarIsVisible: true,
      popoutBarMatchesMainPosition: true,
      popoutItems: ['popout 1'],
      popoutUpdated: ['popout 2'],
      secondAfterFirstUnload: ['Second', 'Second'],
      secondForgotClosedPopout: true
    });
  });
});
