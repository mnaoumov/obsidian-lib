/**
 * @file
 *
 * Integration tests for {@link PluginGateComponent} conflicts against a live Obsidian.
 *
 * The unit tests fire a fake `app.plugins` `changed`. What only a real Obsidian can prove is the premise:
 * that enabling and disabling a plugin NOT built on this library, which makes no lifecycle broadcast, still
 * reaches the gate at once. The conflicting plugin is a plain `Plugin` written into the vault's plugins
 * folder, so nothing but Obsidian's own event can tell the gate about it.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginLifecycleEventPayload } from '../plugin/plugin-lifecycle-events.ts';

const CONFLICTING_PLUGIN_ID = 'obsidian-lib-gate-conflict-probe';

interface ToggleProbe {
  readonly broadcastCount: number;
  readonly loadCountAfterDisable: number;
  readonly loadCountAtStart: number;
  readonly unloadCountAfterEnable: number;
}

describe('PluginGateComponent conflicts', () => {
  beforeAll(async () => {
    await evalInObsidian({
      async callback({ app, pluginId }): Promise<void> {
        const folderPath = `${app.vault.configDir}/plugins/${pluginId}`;
        if (!await app.vault.adapter.exists(folderPath)) {
          await app.vault.adapter.mkdir(folderPath);
        }
        await app.vault.adapter.write(
          `${folderPath}/manifest.json`,
          JSON.stringify({
            author: 'obsidian-lib tests',
            description: 'A plain plugin that is not built on obsidian-lib.',
            id: pluginId,
            minAppVersion: '1.0.0',
            name: 'Gate conflict probe',
            version: '1.0.0'
          })
        );
        await app.vault.adapter.write(
          `${folderPath}/main.js`,
          'const { Plugin } = require(\'obsidian\');\nmodule.exports = class GateConflictProbePlugin extends Plugin {};\n'
        );
        await app.plugins.loadManifests();
      },
      input: { pluginId: CONFLICTING_PLUGIN_ID }
    });
  });

  afterAll(async () => {
    await evalInObsidian({
      async callback({ app, pluginId }): Promise<void> {
        if (app.plugins.enabledPlugins.has(pluginId)) {
          await app.plugins.disablePluginAndSave(pluginId);
        }
        await app.plugins.uninstallPlugin(pluginId);
      },
      input: { pluginId: CONFLICTING_PLUGIN_ID }
    });
  });

  it('should come down when a plugin not built on this library is enabled, and back up when it is disabled', async () => {
    const probe = await evalInObsidian({
      async callback({ app, lib: { castTo, noopAsync, PLUGIN_LOADED_EVENT_NAME, PluginConflictSeverity, PluginGateComponent, PluginNoticeComponent, waitUntil }, obsidianModule, pluginId }): Promise<ToggleProbe> {
        const hostPluginId = 'obsidian-lib-gate-host-probe';
        let loadCount = 0;
        let unloadCount = 0;
        let broadcastCount = 0;

        const broadcastRef = app.workspace.on(PLUGIN_LOADED_EVENT_NAME, (payload: PluginLifecycleEventPayload) => {
          if (payload.pluginId === pluginId) {
            broadcastCount++;
          }
        });

        const parent = new obsidianModule.Component();
        parent.load();
        const pluginNoticeComponent = new PluginNoticeComponent({ app, pluginName: 'Gate host probe' });
        parent.addChild(pluginNoticeComponent);

        // A stand-in host: the gate reads only `app` and `manifest` off its plugin.
        const hostPlugin = castTo<InstanceType<typeof obsidianModule.Plugin>>({ app, manifest: { id: hostPluginId, name: 'Gate host probe' } });

        const gate = new PluginGateComponent({
          conflicts: [{
            conflictingVersionRange: '>=0.0.0',
            pluginId,
            pluginName: 'Gate conflict probe',
            reason: 'The integration test declares it.',
            severity: PluginConflictSeverity.Block
          }],
          dependencies: [],
          loadFeatureSurface: async (): Promise<void> => {
            loadCount++;
            await noopAsync();
          },
          plugin: hostPlugin,
          pluginNoticeComponent,
          unloadFeatureSurface: (): void => {
            unloadCount++;
          }
        });

        try {
          gate.load();
          await gate.loadWithPromises();
          const loadCountAtStart = loadCount;

          await app.plugins.enablePluginAndSave(pluginId);
          await waitUntil({
            message: 'The gate takes the feature surface down once the conflicting plugin is enabled',
            predicate: () => unloadCount > 0,
            timeoutInMilliseconds: 5000
          });
          const unloadCountAfterEnable = unloadCount;

          await app.plugins.disablePluginAndSave(pluginId);
          await waitUntil({
            message: 'The gate brings the feature surface back once the conflicting plugin is disabled',
            predicate: () => loadCount > loadCountAtStart,
            timeoutInMilliseconds: 5000
          });

          return {
            broadcastCount,
            loadCountAfterDisable: loadCount,
            loadCountAtStart,
            unloadCountAfterEnable
          };
        } finally {
          gate.unload();
          parent.unload();
          app.workspace.offref(broadcastRef);
          if (app.plugins.enabledPlugins.has(pluginId)) {
            await app.plugins.disablePluginAndSave(pluginId);
          }
        }
      },
      input: { pluginId: CONFLICTING_PLUGIN_ID }
    });

    expect(probe).toStrictEqual({
      // The probe makes no lifecycle broadcast, so only `app.plugins` `changed` can have reached the gate.
      broadcastCount: 0,
      loadCountAfterDisable: 2,
      loadCountAtStart: 1,
      unloadCountAfterEnable: 1
    });
  });
});
