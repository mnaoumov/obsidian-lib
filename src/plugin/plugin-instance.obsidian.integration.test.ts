/**
 * @file
 *
 * Integration tests for the plugin instance helpers against a live Obsidian and a real community plugin.
 *
 * The unit tests drive a fake `app.plugins`. What only a real Obsidian can prove is the premise they rest on:
 * that `app.plugins` triggers `changed` after an enable, so a wait wakes up without polling, and that a plain
 * `disablePlugin` leaves a plugin enabled in the configuration with no instance. The repair case clicks the
 * notice's own button with trusted input, which is the flow a user sees.
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

// A small plugin of this library's own author, also used by the community-plugins integration test.
const PLUGIN_ID = 'fix-tab-size';
const NOTICE_SETTLE_DELAY_IN_MILLISECONDS = 300;

interface AvailabilityProbe {
  readonly afterEnable: string;
  readonly afterPlainDisable: string;
  readonly afterSavedDisable: string;
  readonly resolvedPluginId: string;
}

interface RepairProbe {
  readonly before: string;
  readonly isNoticeGone: boolean;
  readonly resolvedPluginId: string;
}

describe('plugin instance helpers', () => {
  beforeAll(async () => {
    await evalInObsidian({
      async callback({ app, lib: { installConfigureEnableCommunityPlugin }, pluginId }): Promise<void> {
        if (!Object.hasOwn(app.plugins.manifests, pluginId)) {
          await installConfigureEnableCommunityPlugin({ app, pluginId });
        }
        await app.plugins.disablePluginAndSave(pluginId);
      },
      input: { pluginId: PLUGIN_ID }
    });
  });

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

  it('should classify a real plugin and wake a wait when it is enabled', async () => {
    const probe = await evalInObsidian({
      async callback({ app, lib: { getPluginAvailability, waitForPlugin }, pluginId }): Promise<AvailabilityProbe> {
        const afterSavedDisable = getPluginAvailability({ app, pluginId });
        const promise = waitForPlugin({ app, pluginId, timeoutInMilliseconds: 10_000 });
        await app.plugins.enablePluginAndSave(pluginId);
        const plugin = await promise;
        const afterEnable = getPluginAvailability({ app, pluginId });

        await app.plugins.disablePlugin(pluginId);
        const afterPlainDisable = getPluginAvailability({ app, pluginId });
        await app.plugins.disablePluginAndSave(pluginId);

        return {
          afterEnable,
          afterPlainDisable,
          afterSavedDisable,
          resolvedPluginId: plugin.manifest.id
        };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(probe).toStrictEqual({
      afterEnable: 'available',
      afterPlainDisable: 'notLoaded',
      afterSavedDisable: 'notEnabled',
      resolvedPluginId: PLUGIN_ID
    });
  });

  it('should resolve a requirement once the user clicks Enable in its notice', async () => {
    const probe = await evalInObsidian({
      async callback({ app, lib: { clickElement, getPluginAvailability, PluginNoticeComponent, requirePlugin, sleep, waitUntil }, noticeSettleDelayInMilliseconds, obsidianModule, pluginId }): Promise<RepairProbe> {
        const component = new obsidianModule.Component();
        component.load();
        const pluginNoticeComponent = new PluginNoticeComponent({ app, pluginName: 'Requirement probe' });
        component.addChild(pluginNoticeComponent);

        function describeHit(el: HTMLElement): string {
          const rect = el.getBoundingClientRect();
          const hitEl = activeDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return `${hitEl?.tagName ?? 'none'}.${hitEl?.className ?? ''} at (${String(rect.left)}, ${String(rect.top)}) window ${String(window.innerWidth)}x${String(window.innerHeight)}`;
        }

        function findNotice(): HTMLElement | null {
          return [...activeDocument.querySelectorAll<HTMLElement>('.notice')]
            .find((noticeEl) => noticeEl.textContent.includes('which is installed but not enabled')) ?? null;
        }

        try {
          const before = getPluginAvailability({ app, pluginId });
          const promise = requirePlugin({
            app,
            component,
            pluginId,
            pluginName: 'Fix Tab Size',
            pluginNoticeComponent,
            requestingPluginName: 'Requirement probe',
            timeoutInMilliseconds: 15_000
          });

          await waitUntil({ message: 'The requirement notice appears', predicate: () => findNotice() !== null, timeoutInMilliseconds: 5000 });
          const buttonEl = [...findNotice()?.querySelectorAll('button') ?? []].find((el) => el.textContent === 'Enable');
          if (!buttonEl) {
            throw new Error('The notice has no Enable button.');
          }
          // Let the notice's slide-in finish, so the trusted click lands on the settled button.
          await sleep({ milliseconds: noticeSettleDelayInMilliseconds });
          let clickCount = 0;
          buttonEl.addEventListener('click', () => {
            clickCount++;
          });
          const hitBeforeClick = describeHit(buttonEl);
          await clickElement({ element: buttonEl });
          try {
            await waitUntil({
              message: 'The plugin is enabled after the click',
              predicate: () => app.plugins.enabledPlugins.has(pluginId),
              timeoutInMilliseconds: 8000
            });
          } catch (error) {
            throw new Error(`${String(error)}; clicks seen: ${String(clickCount)}; at the button's center: ${hitBeforeClick}`, { cause: error });
          }

          const plugin = await promise;
          // The notice animates out before it leaves the DOM.
          await waitUntil({ message: 'The requirement notice goes away', predicate: () => findNotice() === null, timeoutInMilliseconds: 3000 });
          return {
            before,
            isNoticeGone: findNotice() === null,
            resolvedPluginId: plugin.manifest.id
          };
        } finally {
          component.unload();
          await app.plugins.disablePluginAndSave(pluginId);
        }
      },
      input: { noticeSettleDelayInMilliseconds: NOTICE_SETTLE_DELAY_IN_MILLISECONDS, pluginId: PLUGIN_ID }
    });

    expect(probe).toStrictEqual({
      before: 'notEnabled',
      isNoticeGone: true,
      resolvedPluginId: PLUGIN_ID
    });
  });
});
