/**
 * @file
 *
 * Proves, against real Obsidian, that {@link PluginMarkdownCodeBlockProcessorRegistrar} leaves nothing behind
 * when a plugin instance that is already unloaded registers a code block processor, so the next instance of the
 * same plugin can register the same language. Obsidian's `Component.register` keeps a cleanup handed to an
 * unloaded component without ever running it, which is how an update that unloads a plugin mid-load used to
 * leave its processor in core's global language map.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface RegistrarProbe {
  readonly didDeadInstanceThrow: boolean;
  readonly liveInstanceError: string;
  readonly secondLiveInstanceError: string;
}

describe('PluginMarkdownCodeBlockProcessorRegistrar', () => {
  it('should let the next instance register a language that an unloaded instance tried to register', async () => {
    const probe = await evalInObsidian({
      callback({ app, lib: { PluginMarkdownCodeBlockProcessorRegistrar }, obsidianModule }): RegistrarProbe {
        // `Plugin` is declared abstract; a bare subclass is a plugin instance with nothing of its own.
        class ProbePlugin extends obsidianModule.Plugin {
          public override onload(): void {
            // Nothing: the probe only needs the instance's load state.
          }
        }
        const language = 'obsidian-lib-registrar-probe';
        const manifest = {
          author: '',
          description: '',
          id: 'obsidian-lib-registrar-probe',
          minAppVersion: '0.0.0',
          name: 'Registrar probe',
          version: '1.0.0'
        };
        function tryRegister(): string {
          const instance = new ProbePlugin(app, manifest);
          instance.load();
          try {
            new PluginMarkdownCodeBlockProcessorRegistrar(instance).registerMarkdownCodeBlockProcessor({ handler: () => undefined, language });
            return '';
          } catch (error) {
            return String(error);
          } finally {
            instance.unload();
          }
        }

        // The old instance: loaded, then unloaded, and only then reaching its registration, as a load resumed after an update does.
        const deadInstance = new ProbePlugin(app, manifest);
        deadInstance.load();
        deadInstance.unload();
        let didDeadInstanceThrow = false;
        try {
          new PluginMarkdownCodeBlockProcessorRegistrar(deadInstance).registerMarkdownCodeBlockProcessor({ handler: () => undefined, language });
        } catch {
          didDeadInstanceThrow = true;
        }

        // The next instance, as the update loads it, then one more to prove that instance's unload released the language.
        return {
          didDeadInstanceThrow,
          liveInstanceError: tryRegister(),
          secondLiveInstanceError: tryRegister()
        };
      }
    });

    expect(probe.didDeadInstanceThrow).toBe(false);
    expect(probe.liveInstanceError).toBe('');
    expect(probe.secondLiveInstanceError).toBe('');
  });
});
