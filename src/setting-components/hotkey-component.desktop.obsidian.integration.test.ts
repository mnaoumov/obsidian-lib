/**
 * @file
 *
 * Desktop-only integration test for {@link HotkeyComponent}: a trusted click starts the recording and a trusted key
 * combination is recorded in Obsidian's `hotkeys.json` shape. A phone keyboard has no modifier keys to record.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('HotkeyComponent on desktop', () => {
  it('should record a trusted key combination after a trusted click', async () => {
    const result = await evalInObsidian({
      async callback({ lib: { clickElement, HotkeyComponent, pressKey, waitUntil } }) {
        // Pinned in view and on top, so the trusted click lands on the button.
        const containerEl = activeDocument.body.createDiv({ attr: { style: 'position: fixed; left: 20px; top: 20px; z-index: 10000;' } });
        const component = new HotkeyComponent(containerEl);
        const changes: unknown[] = [];
        component.onChange((value) => {
          changes.push(value);
        });

        try {
          await clickElement({ element: component.buttonEl });
          await waitUntil({
            message: 'the component starts recording',
            predicate: () => component.isRecording
          });
          await pressKey({ key: 'k', modifiers: ['Mod', 'Shift'] });
          await waitUntil({
            message: 'the hotkey is recorded',
            predicate: () => changes.length > 0
          });
          return { changes, text: component.buttonEl.textContent };
        } finally {
          containerEl.remove();
        }
      }
    });

    expect(result.changes).toEqual([{ key: 'K', modifiers: ['Mod', 'Shift'] }]);
    expect(result.text).toMatch(/^(?:Ctrl \+ Shift \+ K|⌘⇧K)$/u);
  });
});
