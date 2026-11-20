/**
 * @file
 *
 * Desktop-only integration test for {@link loop} in a hidden window. Hiding the window needs Electron's
 * `BrowserWindow`, which a phone does not have.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

const FRAME_WAIT_COUNT = 5;
const ITEM_COUNT = 20;

describe('loop on desktop', () => {
  // `requestAnimationFrame` never fires in a hidden window, so a yield that waits for a frame waits out the 100 ms
  // fallback of `requestAnimationFrameAsync` instead. The loop yields one macrotask there.
  it('should not wait for animation frames while the window is hidden', async () => {
    const result = await evalInObsidian({
      async callback({ frameWaitCount, itemCount, lib: { loop, requestAnimationFrameAsync, waitUntil } }) {
        const browserWindow = window.electron.remote.getCurrentWindow();
        browserWindow.hide();
        try {
          await waitUntil({
            message: 'the hidden window reports its document hidden',
            predicate: () => document.hidden
          });

          // The premise: each frame wait runs into the fallback timeout. Goes red if a hidden window starts painting.
          const frameStart = performance.now();
          for (let index = 0; index < frameWaitCount; index++) {
            await requestAnimationFrameAsync();
          }
          const frameWaitsInMilliseconds = performance.now() - frameStart;

          const processedItems: number[] = [];
          const loopStart = performance.now();
          await loop({
            buildNoticeMessage: ({ iterationString }) => iterationString,
            items: Array.from({ length: itemCount }, (_, index) => index),
            pluginNoticeComponent: null,
            processItem: (item) => {
              processedItems.push(item);
            },
            shouldShowNotice: false,
            // A negative threshold yields before every item.
            uiUpdateThresholdInMilliseconds: -1
          });
          const loopInMilliseconds = performance.now() - loopStart;

          return { frameWaitsInMilliseconds, loopInMilliseconds, processedItemCount: processedItems.length };
        } finally {
          browserWindow.showInactive();
          await waitUntil({
            message: 'the window is shown again',
            predicate: () => !document.hidden
          });
        }
      },
      input: { frameWaitCount: FRAME_WAIT_COUNT, itemCount: ITEM_COUNT }
    });

    expect(result.processedItemCount).toBe(ITEM_COUNT);
    // Each hidden frame wait runs into the 100 ms fallback. Waiting for frames, the same loop took 3.7 s (2026-11-20).
    expect(result.frameWaitsInMilliseconds).toBeGreaterThan(FRAME_WAIT_COUNT * 50);
    expect(result.loopInMilliseconds).toBeLessThan(500);
  });
});
