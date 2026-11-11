/**
 * @file
 *
 * Tests for {@link EmbedExtensionsComponent}.
 */

import type { EmbedCreator } from '@obsidian-typings/obsidian-public-latest';
import type { App as AppOriginal } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { EmbedExtensionsComponent } from './embed-extensions-component.ts';

interface Mocks {
  readonly app: AppOriginal;
  readonly embedByExtension: Map<string, EmbedCreator>;
  readonly registerExtension: ReturnType<typeof vi.fn>;
  readonly unregisterExtensions: ReturnType<typeof vi.fn>;
}

describe('EmbedExtensionsComponent', () => {
  it('should register each extension with the embed registry after loading', () => {
    const { app, embedByExtension, registerExtension } = createMocks();
    const component = new EmbedExtensionsComponent(app);
    component.load();
    const registerSpy = vi.spyOn(component, 'register');
    const embedCreator = vi.fn<EmbedCreator>();

    component.registerExtensions(['alpha', 'beta'], embedCreator);

    expect(registerExtension).toHaveBeenNthCalledWith(1, 'alpha', embedCreator);
    expect(registerExtension).toHaveBeenNthCalledWith(2, 'beta', embedCreator);
    expect(Object.fromEntries(embedByExtension)).toEqual({ alpha: embedCreator, beta: embedCreator });
    expect(registerSpy).toHaveBeenCalledOnce();
  });

  it('should unregister the extensions when unloaded', () => {
    const { app, embedByExtension, unregisterExtensions } = createMocks();
    const component = new EmbedExtensionsComponent(app);
    component.load();

    component.registerExtensions(['alpha', 'beta'], vi.fn<EmbedCreator>());
    expect(unregisterExtensions).not.toHaveBeenCalled();

    component.unload();

    expect(unregisterExtensions).toHaveBeenCalledWith(['alpha', 'beta']);
    expect(Object.fromEntries(embedByExtension)).toEqual({});
  });

  it('should unregister the extensions it registered and keep the conflicting one when an extension is taken', () => {
    const { app, embedByExtension } = createMocks();
    const ownerCreator = vi.fn<EmbedCreator>();
    embedByExtension.set('taken', ownerCreator);
    const component = new EmbedExtensionsComponent(app);
    component.load();
    const registerSpy = vi.spyOn(component, 'register');

    expect(() => {
      component.registerExtensions(['free', 'taken', 'later'], vi.fn<EmbedCreator>());
    }).toThrow('Attempting to register an embed for an already registered extension "taken"');

    expect(Object.fromEntries(embedByExtension)).toEqual({ taken: ownerCreator });
    expect(registerSpy).not.toHaveBeenCalled();

    component.unload();

    expect(Object.fromEntries(embedByExtension)).toEqual({ taken: ownerCreator });
  });

  it('should throw when registering extensions before the component is loaded', () => {
    const { app, registerExtension } = createMocks();
    const component = new EmbedExtensionsComponent(app);

    expect(() => {
      component.registerExtensions(['alpha'], vi.fn<EmbedCreator>());
    }).toThrow('Component is not loaded');
    expect(registerExtension).not.toHaveBeenCalled();
  });
});

function createMocks(): Mocks {
  const embedByExtension = new Map<string, EmbedCreator>();
  // Mirrors Obsidian 1.15.1's `EmbedRegistry.registerExtension`, which throws for a registered extension.
  const registerExtension = vi.fn((extension: string, embedCreator: EmbedCreator) => {
    if (embedByExtension.has(extension)) {
      throw new Error(`Attempting to register an embed for an already registered extension "${extension}"`);
    }
    embedByExtension.set(extension, embedCreator);
  });
  const unregisterExtensions = vi.fn((extensions: string[]) => {
    for (const extension of extensions) {
      embedByExtension.delete(extension);
    }
  });

  const app = strictProxy<AppOriginal>({
    embedRegistry: {
      registerExtension,
      unregisterExtensions
    }
  });

  return { app, embedByExtension, registerExtension, unregisterExtensions };
}
