/**
 * @file
 *
 * Tests for {@link registerDisposable} and {@link registerAsyncDisposable}.
 */

import type { PluginManifest } from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import {
  Component,
  Plugin
} from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  registerAsyncDisposable,
  registerDisposable
} from './disposable.ts';
import {
  didPluginAsyncCleanupsSettle,
  hasPendingPluginAsyncCleanups
} from './plugin/plugin-async-cleanup.ts';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

class TestPlugin extends Plugin {}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createPlugin(id: string): Plugin {
  const manifest: PluginManifest = {
    author: 'author',
    description: 'description',
    id,
    minAppVersion: '1.0.0',
    name: id,
    version: '1.0.0'
  };
  return new TestPlugin(App.createConfigured__().asOriginalType__(), manifest);
}

describe('registerDisposable', () => {
  it('should return the same disposable and dispose it on unload', () => {
    const component = new Component();
    component.load();
    const disposeMock = vi.fn();
    const disposable: Disposable = { [Symbol.dispose]: disposeMock };

    expect(registerDisposable(component, disposable)).toBe(disposable);
    expect(disposeMock).not.toHaveBeenCalled();

    component.unload();
    expect(disposeMock).toHaveBeenCalledOnce();
  });
});

describe('registerAsyncDisposable', () => {
  it('should return the same disposable and start its disposal on unload of a plain component', async () => {
    const component = new Component();
    component.load();
    const asyncDisposeMock = vi.fn(noopAsync);
    const asyncDisposable: AsyncDisposable = { [Symbol.asyncDispose]: asyncDisposeMock };

    expect(registerAsyncDisposable(component, asyncDisposable)).toBe(asyncDisposable);
    expect(asyncDisposeMock).not.toHaveBeenCalled();

    component.unload();
    await noopAsync();
    expect(asyncDisposeMock).toHaveBeenCalledOnce();
  });

  it('should track the disposal of a plugin under its id, so its next instance can await it', async () => {
    const plugin = createPlugin('async-disposable-plugin');
    plugin.load();
    const deferred = createDeferred();
    const asyncDisposeMock = vi.fn(() => deferred.promise);

    registerAsyncDisposable(plugin, { [Symbol.asyncDispose]: asyncDisposeMock });
    expect(hasPendingPluginAsyncCleanups('async-disposable-plugin')).toBe(false);

    plugin.unload();
    expect(asyncDisposeMock).toHaveBeenCalledOnce();
    expect(hasPendingPluginAsyncCleanups('async-disposable-plugin')).toBe(true);

    deferred.resolve();
    await expect(didPluginAsyncCleanupsSettle({ pluginId: 'async-disposable-plugin' })).resolves.toBe(true);
  });
});
