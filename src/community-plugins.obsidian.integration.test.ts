/**
 * @file
 *
 * Integration tests for {@link updateCommunityPlugin} against a live Obsidian instance and the real community
 * registry.
 *
 * The unit tests cannot see the one thing the helper relies on: that Obsidian's own `installPlugin`, handed a
 * newer release of a plugin that is installed AND running, overwrites its files and reloads it. So this
 * installs an old release of a real community plugin, enables it, updates it, and reads the version back
 * from both the manifest and the running instance.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { PluginManifest } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

// A small plugin of this library's own author, with a release history that will not be withdrawn.
const PLUGIN_ID = 'fix-tab-size';
const OLD_VERSION = '1.2.18';

interface InstallProbe {
  readonly installedVersion: null | string;
  readonly isEnabled: boolean;
}

interface UpdateProbe {
  readonly installedVersion: null | string;
  readonly isEnabled: boolean;
  readonly latestVersion: string;
  readonly loadedVersion: null | string;
  readonly result: string;
  readonly secondResult: string;
}

describe('updateCommunityPlugin', () => {
  afterAll(async () => {
    await evalInObsidian({
      async callback({ app, lib: { uninstallCommunityPlugin }, pluginId }): Promise<void> {
        if (app.plugins.enabledPlugins.has(pluginId)) {
          await app.plugins.disablePluginAndSave(pluginId);
        }
        await uninstallCommunityPlugin({ app, pluginId });
      },
      input: { pluginId: PLUGIN_ID }
    });
  });

  it('should install the latest release over an enabled older one, and reload it', async () => {
    const installProbe = await evalInObsidian({
      async callback({ app, lib: { getCommunityPluginRepo, uninstallCommunityPlugin }, obsidianModule, oldVersion, pluginId }): Promise<InstallProbe> {
        if (app.plugins.enabledPlugins.has(pluginId)) {
          await app.plugins.disablePluginAndSave(pluginId);
        }
        await uninstallCommunityPlugin({ app, pluginId });

        const repo = await getCommunityPluginRepo(pluginId);
        if (!repo) {
          throw new Error(`${pluginId} is not in the community registry.`);
        }

        const manifestResponse = await obsidianModule.requestUrl(`https://github.com/${repo}/releases/download/${oldVersion}/manifest.json`);
        await app.plugins.installPlugin(repo, oldVersion, manifestResponse.json as PluginManifest);
        await app.plugins.enablePluginAndSave(pluginId);

        return {
          installedVersion: app.plugins.manifests[pluginId]?.version ?? null,
          isEnabled: app.plugins.enabledPlugins.has(pluginId)
        };
      },
      input: { oldVersion: OLD_VERSION, pluginId: PLUGIN_ID }
    });

    expect(installProbe).toStrictEqual({ installedVersion: OLD_VERSION, isEnabled: true });

    const updateProbe = await evalInObsidian({
      async callback({ app, lib: { getCommunityPluginRepo, getLatestReleaseVersion, updateCommunityPlugin }, pluginId }): Promise<UpdateProbe> {
        const repo = await getCommunityPluginRepo(pluginId);
        if (!repo) {
          throw new Error(`${pluginId} is not in the community registry.`);
        }

        const latestVersion = await getLatestReleaseVersion(repo);
        const result = await updateCommunityPlugin({ app, pluginId });
        const secondResult = await updateCommunityPlugin({ app, pluginId });

        return {
          installedVersion: app.plugins.manifests[pluginId]?.version ?? null,
          isEnabled: app.plugins.enabledPlugins.has(pluginId),
          latestVersion,
          loadedVersion: app.plugins.getPlugin(pluginId)?.manifest.version ?? null,
          result,
          secondResult
        };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(updateProbe.latestVersion).not.toBe(OLD_VERSION);
    expect(updateProbe.result).toBe('updated');
    expect(updateProbe.secondResult).toBe('alreadyUpToDate');
    expect(updateProbe.installedVersion).toBe(updateProbe.latestVersion);
    expect(updateProbe.loadedVersion).toBe(updateProbe.latestVersion);
    expect(updateProbe.isEnabled).toBe(true);
  });
});
