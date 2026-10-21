/// <reference types="obsidian-integration-testing/vitest/typings" />

/**
 * @file
 *
 * Proves, against real Obsidian, that the lifecycle broadcast reaches a listener on the real workspace once, and
 * that the shared-state bag lives on the `__obsidianLib` realm global.
 */

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/**
 * The shared-state bag on the realm global.
 */
interface SharedStateGlobals {
  readonly __obsidianLib?: Record<string, unknown>;
}

describe('plugin lifecycle events', () => {
  it('should let a listener on the event name hear a copy once', async () => {
    const calls = await evalInObsidian({
      callback({ app, lib: { PLUGIN_LOADED_EVENT_NAME, triggerPluginLifecycleEvent } }): number {
        let count = 0;
        const ref = app.workspace.on(PLUGIN_LOADED_EVENT_NAME, (payload) => {
          if (payload.pluginId === 'lifecycle-probe') {
            count++;
          }
        });

        try {
          triggerPluginLifecycleEvent({
            app,
            name: PLUGIN_LOADED_EVENT_NAME,
            payload: { apiVersions: [], dependencyPluginIds: [], pluginId: 'lifecycle-probe', pluginName: 'Probe', pluginVersion: '1.0.0' }
          });
          return count;
        } finally {
          app.workspace.offref(ref);
        }
      }
    });

    expect(calls).toBe(1);
  });

  it('should keep the shared-state bag on the __obsidianLib global', async () => {
    const isOnGlobal = await evalInObsidian({
      callback({ lib: { castTo, getObsidianLibState } }): boolean {
        const wrapper = getObsidianLibState('obsidianLibGlobalProbe', true);
        return castTo<SharedStateGlobals>(window).__obsidianLib?.['obsidianLibGlobalProbe'] === wrapper;
      }
    });

    expect(isOnGlobal).toBe(true);
  });
});
