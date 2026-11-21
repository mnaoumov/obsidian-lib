/**
 * @file
 *
 * Proves, against real Obsidian, that {@link PluginMarkdownCodeBlockProcessorRegistrar} leaves nothing behind
 * when a plugin instance that is already unloaded registers a code block processor, so the next instance of the
 * same plugin can register the same language. Obsidian's `Component.register` keeps a cleanup handed to an
 * unloaded component without ever running it, which is how an update that unloads a plugin mid-load used to
 * leave its processor in core's global language map. It also proves that a processor registered with a lifetime
 * owner goes away when that owner unloads while the plugin stays loaded, so the language can be registered again.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { Component } from 'obsidian';

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

  it('should unregister a processor when its lifetime owner unloads while the plugin stays loaded', async () => {
    const probe = await evalInObsidian({
      callback({ app, lib: { PluginMarkdownCodeBlockProcessorRegistrar }, obsidianModule }): OwnerProbe {
        class ProbePlugin extends obsidianModule.Plugin {
          public override onload(): void {
            // Nothing: the probe only needs a loaded instance.
          }
        }
        const language = 'obsidian-lib-registrar-owner-probe';
        const plugin = new ProbePlugin(app, {
          author: '',
          description: '',
          id: 'obsidian-lib-registrar-owner-probe',
          minAppVersion: '0.0.0',
          name: 'Registrar owner probe',
          version: '1.0.0'
        });
        plugin.load();
        let currentOwner = new obsidianModule.Component();
        const registrar = new PluginMarkdownCodeBlockProcessorRegistrar(plugin, { lifetimeOwnerProvider: (): Component => currentOwner });
        function isRegistered(): boolean {
          return Object.hasOwn(obsidianModule.MarkdownPreviewRenderer.codeBlockPostProcessors, language);
        }
        const errors: string[] = [];
        const registeredAfterRegister: boolean[] = [];
        const registeredAfterOwnerUnload: boolean[] = [];
        try {
          for (let cycle = 0; cycle < 3; cycle++) {
            currentOwner = new obsidianModule.Component();
            plugin.addChild(currentOwner);
            try {
              registrar.registerMarkdownCodeBlockProcessor({ handler: () => undefined, language });
            } catch (error) {
              errors.push(String(error));
            }
            registeredAfterRegister.push(isRegistered());
            plugin.removeChild(currentOwner);
            registeredAfterOwnerUnload.push(isRegistered());
          }
        } finally {
          plugin.unload();
        }
        return {
          errors,
          registeredAfterOwnerUnload,
          registeredAfterPluginUnload: isRegistered(),
          registeredAfterRegister
        };
      }
    });

    expect(probe.errors).toEqual([]);
    expect(probe.registeredAfterRegister).toEqual([true, true, true]);
    expect(probe.registeredAfterOwnerUnload).toEqual([false, false, false]);
    expect(probe.registeredAfterPluginUnload).toBe(false);
  });
});

interface OwnerProbe {
  readonly errors: readonly string[];
  readonly registeredAfterOwnerUnload: readonly boolean[];
  readonly registeredAfterPluginUnload: boolean;
  readonly registeredAfterRegister: readonly boolean[];
}
