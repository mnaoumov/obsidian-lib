/**
 * @file
 *
 * Integration tests for the window-switching helpers in `workspace.ts`.
 *
 * Obsidian opens Settings in a POPOUT WINDOW and points the `activeWindow` / `activeDocument` globals at
 * it while it is open, so window-sensitive UI built then lands in the settings window and disappears
 * with it. Only a real Obsidian has that popout — jsdom has a single window — so `switchToMainWindow` is
 * verified here, against a real settings window and a real `Notice`.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import {
  evalInObsidian,
  withAppConfig
} from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// Where each of the two notices was built, plus the settings-window state the answers only mean
// something against.
interface NoticeWindowsResult {
  readonly isPinnedNoticeInMainWindow: boolean;
  readonly isPlainNoticeInSettingsWindow: boolean;
  readonly isSettingsWindowSeparate: boolean;
  readonly wasMainWindowRestored: boolean;
}

// What the library did with the workspace in its startup state, before the layout loads.
interface StartupMainWindowResult {
  readonly error: null | string;
  readonly isMainWindowAttached: boolean;
  readonly isMainWindowReturned: boolean;
  readonly isRootSplitRestored: boolean;
}

const TEST_TIMEOUT_IN_MILLISECONDS = 60_000;

describe('switchToMainWindow', () => {
  it('should build a notice in the main window while the settings window is active', async () => {
    /*
     * The harness writes `settingsPopoutWindow: false` into every vault it provisions, so Settings stays
     * in the driven window. A SECOND window is this test's entire premise — `switchToMainWindow` exists
     * because Obsidian moves `activeWindow` to the settings popout — so the popout is switched back on
     * for the length of the eval, and `withAppConfig` puts the key back exactly as it found it (deleting
     * it again where the vault never carried it) rather than leaving it on for the rest of the run.
     */
    const result = await withAppConfig({
      async callback(): Promise<NoticeWindowsResult> {
        return await evalInObsidian<Record<string, never>, NoticeWindowsResult>({
          async callback({ app, lib: { getMainWindow, switchToMainWindow, waitUntil }, obsidianModule: { Notice } }): Promise<NoticeWindowsResult> {
            const SETTINGS_WINDOW_TIMEOUT_IN_MILLISECONDS = 15_000;
            // `0` keeps a notice up until it is clicked; both probes are hidden explicitly below.
            const PERMANENT_NOTICE_DURATION_IN_MILLISECONDS = 0;

            app.setting.open();
            try {
              // Obsidian builds the popout and focuses it asynchronously, and the focus is what moves
              // `activeWindow` — which is the whole condition under test.
              await waitUntil({
                message: 'the settings window to become the active window',
                predicate: (): boolean => activeWindow !== window,
                timeoutInMilliseconds: SETTINGS_WINDOW_TIMEOUT_IN_MILLISECONDS
              });
              const settingsWindow = activeWindow;

              // The control: a plain notice goes wherever Obsidian is pointing, which is what put the
              // demo-vault sandbox notice in the settings window. Without it a passing test could mean the
              // settings window was never active in the first place.
              const plainNotice = new Notice('Plain probe', PERMANENT_NOTICE_DURATION_IN_MILLISECONDS);
              const plainNoticeDocument = plainNotice.containerEl.ownerDocument;
              plainNotice.hide();

              const mainWindowSwitch = switchToMainWindow(app);
              let pinnedNoticeDocument: Document;
              try {
                const pinnedNotice = new Notice('Pinned probe', PERMANENT_NOTICE_DURATION_IN_MILLISECONDS);
                pinnedNoticeDocument = pinnedNotice.containerEl.ownerDocument;
                pinnedNotice.hide();
              } finally {
                mainWindowSwitch.dispose();
              }

              return {
                isPinnedNoticeInMainWindow: pinnedNoticeDocument === document,
                isPlainNoticeInSettingsWindow: plainNoticeDocument === settingsWindow.document,
                isSettingsWindowSeparate: settingsWindow !== window,
                wasMainWindowRestored: activeWindow === settingsWindow
              };
            } finally {
              app.setting.close();
              // Closing the popout is NOT enough. Obsidian moves the `activeWindow` / `activeDocument`
              // globals on window FOCUS, and this owned test window is hidden off-screen — so nothing ever
              // focuses it back and the globals stay pinned to the settings window that was just destroyed.
              // Every later test in this SHARED instance builds its UI in `activeDocument`, so leaving them
              // there makes unrelated modal and popover files render into a dead window and time out.
              const mainWindow = getMainWindow(app);
              window.activeWindow = mainWindow;
              window.activeDocument = mainWindow.document;
            }
          }
        });
      },
      configKey: 'settingsPopoutWindow',
      value: true
    });

    expect(result.isSettingsWindowSeparate).toBe(true);
    expect(result.isPlainNoticeInSettingsWindow).toBe(true);
    expect(result.isPinnedNoticeInMainWindow).toBe(true);
    // The switch is scoped to what it wraps: the settings window is active again once it is disposed.
    expect(result.wasMainWindowRestored).toBe(true);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

describe('getMainWindow', () => {
  it('should return the main window to a plugin loaded at startup, before the layout builds the root split', async () => {
    /*
     * Obsidian `1.15.1` loads the community plugins enabled at startup (`app.plugins.initialize()`) before
     * `workspace.loadLayout()` sets `rootSplit`, so such a plugin's `onload` sees `rootSplit === null`.
     * The harness cannot load a plugin at that point on desktop: a fresh profile starts in restricted
     * mode, so `Plugins.initialize` returns before loading anything and the harness enables its plugin
     * after the layout. So the closure puts the live workspace back into the startup state for one
     * synchronous span, restoring it before anything else can run, and drives the path every `PluginBase`
     * takes first there: `PluginContextComponent` registers an all-windows handler.
     */
    const result = await evalInObsidian<Record<string, never>, StartupMainWindowResult>({
      callback({ app, lib: { forEachWindow, getMainWindow }, obsidianModule: { Component } }): StartupMainWindowResult {
        const rootSplit: unknown = Reflect.get(app.workspace, 'rootSplit');
        let error: null | string = null;
        let isMainWindowAttached = false;
        let isMainWindowReturned = false;
        const owner = new Component();
        owner.load();
        Reflect.set(app.workspace, 'rootSplit', null);
        try {
          isMainWindowReturned = getMainWindow(app) === window;
          forEachWindow({
            app,
            callback: (win) => {
              if (win === window) {
                isMainWindowAttached = true;
              }
            },
            component: owner
          });
        } catch (error_) {
          error = String(error_);
        } finally {
          Reflect.set(app.workspace, 'rootSplit', rootSplit);
          owner.unload();
        }

        return {
          error,
          isMainWindowAttached,
          isMainWindowReturned,
          isRootSplitRestored: app.workspace.rootSplit === rootSplit
        };
      }
    });

    expect(result.error).toBeNull();
    expect(result.isMainWindowReturned).toBe(true);
    expect(result.isMainWindowAttached).toBe(true);
    expect(result.isRootSplitRestored).toBe(true);
  });
});
