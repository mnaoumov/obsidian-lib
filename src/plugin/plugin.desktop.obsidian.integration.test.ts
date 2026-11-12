/**
 * @file
 *
 * Integration test for a {@link PluginBase} plugin that Obsidian disables and enables again while its first enable is
 * still loading, which is what an update or Hot Reload does.
 *
 * Obsidian's `loadPlugin` stores the new instance before it awaits the instance's load, so a `disablePlugin` arriving
 * mid-load unloads it there. Its resumed `onloadImpl` then meets an unloaded feature surface, whose `SilentError` used
 * to surface as `Plugin failure` and a `Failed to load plugin` notice for an instance that was already replaced. The
 * unit tests drive Obsidian's mock; only a real `app.plugins` shows the real ordering of the load, the unload and the
 * logging.
 *
 * The plugin is written into the vault at run time and reaches `PluginBase` through the harness plugin's published
 * copy of this library. Desktop only: one ordering on one platform proves the catch, and the emulator adds nothing.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginBase } from './plugin.ts';

const PLUGIN_ID = 'obsidian-lib-reload-mid-load-test';
const WAIT_TIMEOUT_IN_MILLISECONDS = 10_000;

/**
 * What the probe reports back.
 */
interface ReloadProbe {
  readonly completedLoadCount: number;
  readonly failureMessages: readonly string[];
  readonly isLiveInstanceLoaded: boolean;
  readonly startedLoadCount: number;
}

/**
 * The window state the written plugin and the probe share.
 */
interface ReloadTestState {
  readonly completedLoadCount: number;
  readonly gate: Promise<void>;
  readonly startedLoadCount: number;
}

/**
 * The window, carrying the shared state while the test runs.
 */
interface ReloadTestWindow {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Set at the start of the test and deleted at its end.
  __obsidianLibReloadMidLoadTest?: ReloadTestState;
}

describe('PluginBase reloaded during its own load', () => {
  it('should end with one loaded instance and no Plugin failure when disabled and enabled mid-load', async () => {
    const probe = await evalInObsidian({
      async callback({
        app,
        lib: { castTo, getObsidianLibState, LAST_LIBRARY_VERSION_KEY, waitUntil },
        pluginId,
        waitTimeoutInMilliseconds
      }): Promise<ReloadProbe> {
        // The harness bundles this package's unstamped sources, so every instance records the version placeholder,
        // which the next instance's style injection cannot compare as semver. A released copy is stamped; here the
        // record is cleared before each enable, so the injection has nothing to compare against.
        function forgetLibraryStylesVersion(): void {
          getObsidianLibState<null | string>(LAST_LIBRARY_VERSION_KEY, null).value = null;
        }

        // Under the transport's ~30s per-closure cap, not at it: two waits of 10 s at most, each of which settles in
        // milliseconds on an idle machine.
        const testWindow = castTo<ReloadTestWindow>(window);
        let resolveGate: (() => void) | null = null;
        const gate = new Promise<void>((resolve) => {
          resolveGate = resolve;
        });
        function releaseGate(): void {
          resolveGate?.();
        }
        testWindow.__obsidianLibReloadMidLoadTest = {
          completedLoadCount: 0,
          gate,
          startedLoadCount: 0
        };

        // Each instance awaits the shared gate inside `onloadImpl`, then adds a child: the first instance does so after
        // the `disablePlugin` below has unloaded it, which is the throw under test.
        const mainJs = `
const { Component } = require('obsidian');
const { PluginBase } = window.__obsidianLibModule.__merged;
const state = window.__obsidianLibReloadMidLoadTest;
class ReloadMidLoadTestPlugin extends PluginBase {
  async onloadImpl() {
    state.startedLoadCount++;
    await state.gate;
    this.addChild(new Component());
    state.completedLoadCount++;
  }
}
module.exports = ReloadMidLoadTestPlugin;
module.exports.default = ReloadMidLoadTestPlugin;
`;
        const pluginFolderPath = `${app.vault.configDir}/plugins/${pluginId}`;
        const manifest = {
          author: 'obsidian-lib',
          description: 'Integration-test plugin.',
          id: pluginId,
          minAppVersion: '0.0.0',
          name: 'Reload mid-load test',
          version: '1.0.0'
        };

        const failureMessages: string[] = [];
        // Obsidian reports `Plugin failure`, and this library `Error loading plugin`, through `console.error`.
        const originalConsoleError = console.error;
        console.error = (...arguments_: unknown[]): void => {
          failureMessages.push(arguments_.map(String).join(' '));
          originalConsoleError(...arguments_);
        };
        // Synchronous, so the restore reads no state an await could have outdated.
        function restoreConsoleError(): void {
          console.error = originalConsoleError;
        }

        try {
          if (!(await app.vault.adapter.exists(pluginFolderPath))) {
            await app.vault.adapter.mkdir(pluginFolderPath);
          }
          await app.vault.adapter.write(`${pluginFolderPath}/manifest.json`, JSON.stringify(manifest));
          await app.vault.adapter.write(`${pluginFolderPath}/main.js`, mainJs);
          await app.plugins.loadManifests();

          const state = testWindow.__obsidianLibReloadMidLoadTest;
          forgetLibraryStylesVersion();
          const firstEnablePromise = app.plugins.enablePlugin(pluginId);
          await waitUntil({
            message: 'the first instance to reach onloadImpl',
            predicate: () => state.startedLoadCount === 1,
            timeoutInMilliseconds: waitTimeoutInMilliseconds
          });

          // What an update or Hot Reload does while the first enable is still loading.
          await app.plugins.disablePlugin(pluginId);
          forgetLibraryStylesVersion();
          const secondEnablePromise = app.plugins.enablePlugin(pluginId);
          // Released without waiting for the second instance to reach `onloadImpl`: its `onload` first waits for the
          // async cleanups of the instance it replaces, which may themselves wait for that instance's suspended load.
          releaseGate();
          await firstEnablePromise;
          await secondEnablePromise;
          await waitUntil({
            message: 'the second instance to finish its load',
            predicate: () => state.completedLoadCount === 1,
            timeoutInMilliseconds: waitTimeoutInMilliseconds
          });

          const liveInstance = castTo<PluginBase | undefined>(app.plugins.getPlugin(pluginId));
          return {
            completedLoadCount: state.completedLoadCount,
            failureMessages: failureMessages.filter((message) => message.includes(pluginId) || message.includes('Plugin failure')),
            isLiveInstanceLoaded: liveInstance?._loaded ?? false,
            startedLoadCount: state.startedLoadCount
          };
        } finally {
          releaseGate();
          restoreConsoleError();
          await app.plugins.disablePluginAndSave(pluginId);
          await app.vault.adapter.rmdir(pluginFolderPath, true);
          await app.plugins.loadManifests();
          delete testWindow.__obsidianLibReloadMidLoadTest;
        }
      },
      input: {
        pluginId: PLUGIN_ID,
        waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      }
    });

    // Both instances started; only the live one finished, and the torn-down one unwound without a report.
    expect(probe.startedLoadCount).toBe(2);
    expect(probe.completedLoadCount).toBe(1);
    expect(probe.isLiveInstanceLoaded).toBe(true);
    expect(probe.failureMessages).toEqual([]);
  });
});
