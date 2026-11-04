import { printError } from '@mnaoumov/typescript-lib/error';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { Component } from 'obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  didPluginAsyncCleanupsSettle,
  hasPendingPluginAsyncCleanups,
  registerPluginAsyncCleanup,
  trackPluginAsyncCleanup
} from './plugin-async-cleanup.ts';

vi.mock('@mnaoumov/typescript-lib/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mnaoumov/typescript-lib/error')>();
  return {
    ...actual,
    printError: vi.fn()
  };
});

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('plugin async cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve at once when nothing is pending', async () => {
    expect(hasPendingPluginAsyncCleanups('idle-plugin')).toBe(false);
    await expect(didPluginAsyncCleanupsSettle({ pluginId: 'idle-plugin' })).resolves.toBe(true);
  });

  it('should start the cleanup only when the component unloads, and let the next instance await it', async () => {
    const deferred = createDeferred();
    const cleanup = vi.fn(() => deferred.promise);
    const component = new Component();
    component.load();
    registerPluginAsyncCleanup({ cleanup, component, pluginId: 'db-plugin' });

    expect(cleanup).not.toHaveBeenCalled();
    component.unload();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(hasPendingPluginAsyncCleanups('db-plugin')).toBe(true);

    let isSettled = false;
    const waitPromise = didPluginAsyncCleanupsSettle({ pluginId: 'db-plugin' }).then((result) => {
      isSettled = true;
      return result;
    });
    await noopAsync();
    expect(isSettled).toBe(false);

    deferred.resolve();
    await expect(waitPromise).resolves.toBe(true);
    await noopAsync();
    expect(hasPendingPluginAsyncCleanups('db-plugin')).toBe(false);
  });

  it('should wait for every cleanup tracked under the same plugin id', async () => {
    const first = createDeferred();
    const second = createDeferred();
    trackPluginAsyncCleanup({ cleanup: () => first.promise, pluginId: 'two-cleanups' });
    trackPluginAsyncCleanup({ cleanup: () => second.promise, pluginId: 'two-cleanups' });

    second.resolve();
    let isSettled = false;
    const waitPromise = didPluginAsyncCleanupsSettle({ pluginId: 'two-cleanups' }).then(() => {
      isSettled = true;
    });
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    expect(isSettled).toBe(false);

    first.resolve();
    await waitPromise;
    expect(hasPendingPluginAsyncCleanups('two-cleanups')).toBe(false);
  });

  it('should keep plugins apart', async () => {
    const deferred = createDeferred();
    trackPluginAsyncCleanup({ cleanup: () => deferred.promise, pluginId: 'busy-plugin' });

    await expect(didPluginAsyncCleanupsSettle({ pluginId: 'other-plugin' })).resolves.toBe(true);
    deferred.resolve();
    await didPluginAsyncCleanupsSettle({ pluginId: 'busy-plugin' });
  });

  it('should print a failing cleanup and count it as settled', async () => {
    trackPluginAsyncCleanup({
      cleanup: () => Promise.reject(new Error('close failed')),
      pluginId: 'failing-plugin'
    });
    trackPluginAsyncCleanup({
      cleanup: () => {
        throw new Error('sync failure');
      },
      pluginId: 'failing-plugin'
    });

    await expect(didPluginAsyncCleanupsSettle({ pluginId: 'failing-plugin' })).resolves.toBe(true);
    expect(vi.mocked(printError)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(printError).mock.calls[0]?.[0]).toHaveProperty('message', 'Async cleanup of plugin failing-plugin failed');
  });

  it('should give up after the timeout and leave the cleanup tracked', async () => {
    vi.useFakeTimers();
    const deferred = createDeferred();
    trackPluginAsyncCleanup({ cleanup: () => deferred.promise, pluginId: 'slow-plugin' });

    const waitPromise = didPluginAsyncCleanupsSettle({ pluginId: 'slow-plugin', timeoutInMilliseconds: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(waitPromise).resolves.toBe(false);
    expect(hasPendingPluginAsyncCleanups('slow-plugin')).toBe(true);

    deferred.resolve();
    await expect(didPluginAsyncCleanupsSettle({ pluginId: 'slow-plugin' })).resolves.toBe(true);
  });
});
