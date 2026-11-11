/**
 * @file
 *
 * Integration tests for {@link PluginDataHandler}'s size guard against a live Obsidian, on the harness plugin's real
 * `data.json`. A unit test can only show that a mocked `stat` was consulted; these show that the real adapter
 * reports the size before Obsidian's own `loadData` runs, that a refused load or save leaves the bytes on disk
 * exactly as they were, and that the settings component built on the handler keeps its last saved settings.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface GuardResult {
  readonly contentAfterRefusedLoad: null | string;
  readonly contentAfterRefusedSave: null | string;
  readonly contentAfterSettingsRefusal: null | string;
  readonly loadErrorName: string;
  readonly loadOperation: string;
  readonly loadSizeInBytes: number;
  readonly oversizedContent: string;
  readonly saveErrorName: string;
  readonly settingsErrorName: string;
  readonly settingsNameAfterRefusal: string;
  readonly smallContent: string;
}

describe('PluginDataHandler size guard', () => {
  it('should refuse an oversized data.json and an oversized save, leaving the file and the settings intact', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { AsyncEvents, PluginDataHandler, PluginDataSizeLimitExceededError, PluginSettingsComponentBase } }): Promise<GuardResult> {
        const HARNESS_PLUGIN_ID = 'obsidian-lib-integration-test';
        const harnessPlugin = app.plugins.getPlugin(HARNESS_PLUGIN_ID);
        if (!harnessPlugin) {
          throw new Error(`Harness plugin "${HARNESS_PLUGIN_ID}" is not loaded`);
        }

        const adapter = app.vault.adapter;
        const path = `${harnessPlugin.manifest.dir ?? ''}/data.json`;
        const original = await adapter.exists(path) ? await adapter.read(path) : null;

        async function readOrNull(): Promise<null | string> {
          return await adapter.exists(path) ? await adapter.read(path) : null;
        }

        function errorName(error: unknown): string {
          return error instanceof Error ? error.name : String(error);
        }

        try {
          // Multi-byte text: 300 code units, 600 UTF-8 bytes.
          const oversizedContent = `{\n  "name": "${'é'.repeat(300)}"\n}`;
          await adapter.write(path, oversizedContent);
          const handler = new PluginDataHandler(harnessPlugin, { maxSizeInBytes: 400 });

          let loadErrorName = '';
          let loadOperation = '';
          let loadSizeInBytes = 0;
          try {
            await handler.loadData();
          } catch (error) {
            loadErrorName = errorName(error);
            if (error instanceof PluginDataSizeLimitExceededError) {
              loadOperation = error.operation;
              loadSizeInBytes = error.sizeInBytes;
            }
          }
          const contentAfterRefusedLoad = await readOrNull();

          const smallContent = '{\n  "name": "saved"\n}';
          await adapter.write(path, smallContent);
          let saveErrorName = '';
          try {
            await handler.saveData({ name: 'é'.repeat(300) });
          } catch (error) {
            saveErrorName = errorName(error);
          }
          const contentAfterRefusedSave = await readOrNull();

          class Settings {
            public name = 'default';
          }

          const settingsComponent = new PluginSettingsComponentBase<Settings>({
            dataHandler: handler,
            // The harness plugin is a plain `Plugin`, so it raises no `externalSettingsChange`; nothing here needs one.
            pluginEventSource: new AsyncEvents(),
            pluginSettingsClass: Settings
          });
          await settingsComponent.loadWithPromises();
          let settingsErrorName = '';
          try {
            await settingsComponent.editAndSave((settings) => {
              settings.name = 'é'.repeat(300);
            });
          } catch (error) {
            settingsErrorName = errorName(error);
          }
          const settingsNameAfterRefusal = settingsComponent.settings.name;
          const contentAfterSettingsRefusal = await readOrNull();
          settingsComponent.unload();

          return {
            contentAfterRefusedLoad,
            contentAfterRefusedSave,
            contentAfterSettingsRefusal,
            loadErrorName,
            loadOperation,
            loadSizeInBytes,
            oversizedContent,
            saveErrorName,
            settingsErrorName,
            settingsNameAfterRefusal,
            smallContent
          };
        } finally {
          if (original === null) {
            if (await adapter.exists(path)) {
              await adapter.remove(path);
            }
          } else {
            await adapter.write(path, original);
          }
        }
      }
    });

    expect(result.loadErrorName).toBe('PluginDataSizeLimitExceededError');
    expect(result.loadOperation).toBe('load');
    expect(result.loadSizeInBytes).toBe(new TextEncoder().encode(result.oversizedContent).byteLength);
    expect(result.contentAfterRefusedLoad).toBe(result.oversizedContent);

    expect(result.saveErrorName).toBe('PluginDataSizeLimitExceededError');
    expect(result.contentAfterRefusedSave).toBe(result.smallContent);

    expect(result.settingsErrorName).toBe('PluginDataSizeLimitExceededError');
    expect(result.settingsNameAfterRefusal).toBe('saved');
    expect(result.contentAfterSettingsRefusal).toBe(result.smallContent);
  });
});
