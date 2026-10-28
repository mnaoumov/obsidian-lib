/**
 * @file
 *
 * Per-test setup file for the Obsidian integration tests.
 *
 * Injects the built library styles (`dist/styles.css`) into the shared Obsidian instance. In a real
 * plugin `initPluginContext` injects them, but the integration harness plugin only exposes the module
 * on `window`, so the styles must be injected here for tests that rely on the library's CSS. The
 * injection is idempotent (keyed by a style element id), so running it once per test file is safe.
 *
 * The `lib` resolver comes from the PUBLISHED registration the `@mnaoumov/obsidian-dev-toolkit/integration-test-setup`
 * endpoint calls — the very code consumer plugins get — so this repo's own suites exercise the consumer path
 * rather than a private copy of it.
 *
 * It also restores the ACTIVE WINDOW after every test — see the `afterEach` below.
 */

import { registerIntegrationTestLibResolver } from '@mnaoumov/obsidian-dev-toolkit/test-runners/integration-test-plugin';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterEach,
  beforeAll
} from 'vitest';

registerIntegrationTestLibResolver();

const STYLES_CSS_PATH = join(import.meta.dirname, '../dist/styles.css');

beforeAll(async () => {
  const cssContent = await readFile(STYLES_CSS_PATH, 'utf-8');
  await evalInObsidian({
    callback({ css }) {
      const STYLES_ID = 'obsidian-lib-styles';
      activeDocument.head.querySelector(`#${STYLES_ID}`)?.remove();
      activeDocument.head.createEl('style', {
        attr: { id: STYLES_ID },
        text: css
      });
    },
    input: { css: cssContent }
  });
});

/*
 * Every file in this project shares ONE Obsidian instance, and window-sensitive UI — a modal, a popover,
 * a notice — is built inside whatever window the `activeWindow` / `activeDocument` globals point at.
 * Obsidian moves them on window FOCUS, so a test that opens the settings POPOUT leaves them on that
 * popout; and because the owned test window is hidden off-screen, closing the popout never focuses the
 * main window back, so the globals stay pinned to a window that no longer exists. Every later test then
 * renders into that dead window and waits for an element that can never appear — a flat 30 s timeout with
 * no assertion failure, in files that pass perfectly on their own.
 *
 * A test that opens the popout is expected to point the globals home itself; this is the net that keeps
 * one that forgets from failing every unrelated file that happens to run after it.
 */
afterEach(async () => {
  await evalInObsidian({
    callback({ app, lib: { getMainWindow } }): void {
      const mainWindow = getMainWindow(app);
      if (activeWindow === mainWindow) {
        return;
      }

      window.activeWindow = mainWindow;
      window.activeDocument = mainWindow.document;
    }
  });
});

/*
 * A `MinimizableModal` left minimized keeps the app in its peek-only lock, which blocks EVERY later modal open
 * and every keystroke. One `minimizable-modal` case that threw mid-test did exactly that, and the alert, confirm,
 * prompt, select-item and select-option suites behind it then failed on flat 12 s waits for modals that were
 * never allowed to open, a different set each run depending on the file order. A test that minimizes is expected
 * to restore and close in a `finally`; this net closes whatever one leaks, so the leak fails only its own file.
 *
 * The clicks are dispatched rather than trusted on purpose: this is teardown, not the behavior under test, and it
 * must work even when the leaked lock is swallowing input.
 */
afterEach(async () => {
  await evalInObsidian({
    callback(): void {
      for (const restoreButtonEl of document.querySelectorAll<HTMLElement>('.minimized-modal-bar .restore-button')) {
        restoreButtonEl.click();
      }

      for (const closeButtonEl of document.querySelectorAll<HTMLElement>('.minimizable-modal .modal-header-button')) {
        closeButtonEl.click();
      }
    }
  });
});
