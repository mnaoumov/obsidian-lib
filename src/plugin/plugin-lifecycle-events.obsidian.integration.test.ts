/// <reference types="obsidian-integration-testing/vitest/typings" />

/**
 * @file
 *
 * Proves, against real Obsidian, that the rename of the lifecycle events and of the shared-state global is
 * invisible to either side of a vault: a listener on the legacy name hears a current copy, a listener on the
 * current name hears an older copy through the relay, once, and `__obsidianLib` is the legacy bag itself.
 *
 * An "older copy" is played by triggering only the legacy name on the real workspace, which is exactly and only
 * what such a copy does.
 */

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/**
 * What the lifecycle probe reports back.
 */
interface LifecycleProbe {
  readonly currentNameCallsForCurrentCopy: number;
  readonly currentNameCallsForOlderCopy: number;
  readonly currentNameCallsForOlderCopyAfterUnload: number;
  readonly legacyNameCallsForCurrentCopy: number;
}

/**
 * The two names of the shared-state bag on the realm global.
 */
interface SharedStateGlobals {
  readonly __obsidianDevUtils?: unknown;
  readonly __obsidianLib?: unknown;
}

describe('plugin lifecycle event names', () => {
  it('should let a listener on either name hear a copy on either name, once', async () => {
    const probe = await evalInObsidian({
      callback({ app, lib: { ComponentEx, LEGACY_PLUGIN_LOADED_EVENT_NAME, PLUGIN_LOADED_EVENT_NAME, registerPluginLifecycleEventRelay, triggerPluginLifecycleEvent } }): LifecycleProbe {
        const counts = new Map<string, number>();
        function count(key: string): void {
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        // Two relays, as two plugins on the current library would register.
        const relays = [new ComponentEx(), new ComponentEx()];
        for (const relay of relays) {
          relay.load();
          registerPluginLifecycleEventRelay({ app, component: relay });
        }

        const currentRef = app.workspace.on(PLUGIN_LOADED_EVENT_NAME, (payload) => {
          count(`current:${payload.pluginId}`);
        });
        const legacyRef = app.workspace.on(LEGACY_PLUGIN_LOADED_EVENT_NAME, (payload) => {
          count(`legacy:${payload.pluginId}`);
        });

        try {
          const basePayload = { apiVersions: [], dependencyPluginIds: [], pluginName: 'Probe', pluginVersion: '1.0.0' };
          triggerPluginLifecycleEvent({ app, name: PLUGIN_LOADED_EVENT_NAME, payload: { ...basePayload, pluginId: 'current-copy' } });
          app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, { ...basePayload, pluginId: 'older-copy' });

          for (const relay of relays) {
            relay.unload();
          }

          app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, { ...basePayload, pluginId: 'older-copy-after-unload' });

          return {
            currentNameCallsForCurrentCopy: counts.get('current:current-copy') ?? 0,
            currentNameCallsForOlderCopy: counts.get('current:older-copy') ?? 0,
            currentNameCallsForOlderCopyAfterUnload: counts.get('current:older-copy-after-unload') ?? 0,
            legacyNameCallsForCurrentCopy: counts.get('legacy:current-copy') ?? 0
          };
        } finally {
          app.workspace.offref(currentRef);
          app.workspace.offref(legacyRef);
        }
      }
    });

    expect(probe).toStrictEqual({
      currentNameCallsForCurrentCopy: 1,
      currentNameCallsForOlderCopy: 1,
      currentNameCallsForOlderCopyAfterUnload: 0,
      legacyNameCallsForCurrentCopy: 1
    });
  });

  it('should expose the shared-state bag under both global names as one object', async () => {
    const isSameBag = await evalInObsidian({
      callback({ lib: { castTo, getObsidianDevUtilsState } }): boolean {
        getObsidianDevUtilsState('obsidianLibAliasProbe', true);
        const realmGlobal = castTo<SharedStateGlobals>(window);
        return realmGlobal.__obsidianLib !== undefined && realmGlobal.__obsidianLib === realmGlobal.__obsidianDevUtils;
      }
    });

    expect(isSameBag).toBe(true);
  });
});
