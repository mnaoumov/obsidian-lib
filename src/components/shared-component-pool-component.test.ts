/**
 * @file
 *
 * Tests for {@link SharedComponentPoolComponent}.
 */

import { dispose } from '@mnaoumov/typescript-lib/disposable';
import { SilentError } from '@mnaoumov/typescript-lib/error';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { Component } from 'obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { SharedComponentAcquisition } from './shared-component-pool-component.ts';

import { ComponentEx } from './component-ex.ts';
import { SharedComponentPoolComponent } from './shared-component-pool-component.ts';

interface Deferred {
  readonly promise: Promise<void>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: () => void;
}

interface TestPool {
  readonly owner: Component;
  readonly pool: SharedComponentPoolComponent<unknown, Component>;
}

class FailingLoadComponent extends Component {
  public override onload(): void {
    throw new Error('onload failed');
  }
}

class WatcherComponent extends ComponentEx {
  public loadCount = 0;
  public unloadCount = 0;

  public constructor(public readonly key: unknown, private readonly asyncLoad: Deferred | null = null) {
    super();
  }

  public override onload(): void {
    this.loadCount++;
  }

  public override async onloadAsync(): Promise<void> {
    await this.asyncLoad?.promise;
  }

  public override onunload(): void {
    this.unloadCount++;
  }
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createPool(createComponent: (key: unknown) => Component = (key): Component => new WatcherComponent(key)): TestPool {
  const owner = new Component();
  const pool = owner.addChild(new SharedComponentPoolComponent<unknown, Component>({ createComponent }));
  owner.load();
  return { owner, pool };
}

function watcherOf(acquisition: SharedComponentAcquisition<Component>): WatcherComponent {
  expect(acquisition.component).toBeInstanceOf(WatcherComponent);
  return acquisition.component as WatcherComponent;
}

describe('SharedComponentPoolComponent', () => {
  it('should share one loaded instance among consumers and unload it once after the last release', async () => {
    const createComponent = vi.fn((key: unknown) => new WatcherComponent(key));
    const { pool } = createPool(createComponent);

    const first = await pool.acquire('note.md');
    const second = await pool.acquire('note.md');
    const watcher = watcherOf(first);

    expect(second.component).toBe(watcher);
    expect(createComponent).toHaveBeenCalledOnce();
    expect(watcher.loadCount).toBe(1);
    expect(pool.getConsumerCount('note.md')).toBe(2);

    first.release();
    expect(watcher.unloadCount).toBe(0);
    expect(pool.getConsumerCount('note.md')).toBe(1);

    second.release();
    expect(watcher.unloadCount).toBe(1);
    expect(pool.getConsumerCount('note.md')).toBe(0);
  });

  it('should create a fresh instance after the final release', async () => {
    const { pool } = createPool();

    const first = await pool.acquire('note.md');
    first.release();
    const second = await pool.acquire('note.md');

    expect(second.component).not.toBe(first.component);
    expect(watcherOf(first).unloadCount).toBe(1);
    expect(watcherOf(second).unloadCount).toBe(0);
  });

  it('should keep different keys and equal-looking object keys apart', async () => {
    const { pool } = createPool();
    const keyA = { path: 'note.md' };
    const keyB = { path: 'note.md' };

    const a = await pool.acquire(keyA);
    const b = await pool.acquire(keyB);
    const c = await pool.acquire('other.md');

    expect(a.component).not.toBe(b.component);
    expect(a.component).not.toBe(c.component);

    a.release();
    expect(watcherOf(a).unloadCount).toBe(1);
    expect(watcherOf(b).unloadCount).toBe(0);
    expect(watcherOf(c).unloadCount).toBe(0);
  });

  it('should keep independent pools isolated', async () => {
    const { pool: pool1 } = createPool();
    const { pool: pool2 } = createPool();

    const a = await pool1.acquire('note.md');
    const b = await pool2.acquire('note.md');

    expect(a.component).not.toBe(b.component);
  });

  it('should make release idempotent across release, dispose and Symbol.dispose', async () => {
    const { pool } = createPool();
    const keeper = await pool.acquire('note.md');
    const acquisition = await pool.acquire('note.md');

    acquisition.release();
    acquisition.release();
    acquisition.dispose();
    dispose(acquisition);

    expect(acquisition.isReleased).toBe(true);
    expect(pool.getConsumerCount('note.md')).toBe(1);
    expect(watcherOf(keeper).unloadCount).toBe(0);
  });

  it('should support using declarations', async () => {
    const { pool } = createPool();
    let watcher: WatcherComponent;
    {
      using acquisition = await pool.acquire('note.md');
      watcher = watcherOf(acquisition);
    }
    expect(watcher.unloadCount).toBe(1);
  });

  it('should share a pending async load among concurrent acquisitions', async () => {
    const asyncLoad = createDeferred();
    const createComponent = vi.fn((key: unknown) => new WatcherComponent(key, asyncLoad));
    const { pool } = createPool(createComponent);

    const firstPromise = pool.acquire('note.md');
    const secondPromise = pool.acquire('note.md');
    expect(pool.getConsumerCount('note.md')).toBe(2);

    const bothPromise = Promise.all([firstPromise, secondPromise]);
    const pendingState = await Promise.race([bothPromise.then(() => 'settled'), noopAsync().then(() => 'pending')]);
    expect(pendingState).toBe('pending');

    asyncLoad.resolve();
    const [first, second] = await bothPromise;

    expect(first.component).toBe(second.component);
    expect(createComponent).toHaveBeenCalledOnce();
  });

  it('should reject every waiter on an async load failure, unload once and stay reusable', async () => {
    const asyncLoad = createDeferred();
    const watchers: WatcherComponent[] = [];
    let isFirst = true;
    const { pool } = createPool((key) => {
      const watcher = new WatcherComponent(key, isFirst ? asyncLoad : null);
      isFirst = false;
      watchers.push(watcher);
      return watcher;
    });

    const firstPromise = pool.acquire('note.md');
    const secondPromise = pool.acquire('note.md');
    asyncLoad.reject(new Error('load failed'));

    await expect(firstPromise).rejects.toThrow('load failed');
    await expect(secondPromise).rejects.toThrow('load failed');
    expect(watchers[0]?.unloadCount).toBe(1);
    expect(pool.getConsumerCount('note.md')).toBe(0);

    const retry = await pool.acquire('note.md');
    expect(retry.component).toBe(watchers[1]);
  });

  it('should reject on a synchronous load failure and stay reusable', async () => {
    let shouldFail = true;
    const { pool } = createPool(() => shouldFail ? new FailingLoadComponent() : new Component());

    await expect(pool.acquire('note.md')).rejects.toThrow('onload failed');
    expect(pool.getConsumerCount('note.md')).toBe(0);

    shouldFail = false;
    const acquisition = await pool.acquire('note.md');
    expect(acquisition.component).toBeInstanceOf(Component);
  });

  it('should reject on a factory failure and stay reusable', async () => {
    let shouldFail = true;
    const { pool } = createPool((key) => {
      if (shouldFail) {
        throw new Error('factory failed');
      }
      return new WatcherComponent(key);
    });

    await expect(pool.acquire('note.md')).rejects.toThrow('factory failed');
    expect(pool.getConsumerCount('note.md')).toBe(0);

    shouldFail = false;
    await expect(pool.acquire('note.md')).resolves.toBeDefined();
  });

  it('should unload a pending component once when its only waiter aborts, and not resurrect it after the load', async () => {
    const asyncLoad = createDeferred();
    const watchers: WatcherComponent[] = [];
    const { pool } = createPool((key) => {
      const watcher = new WatcherComponent(key, watchers.length === 0 ? asyncLoad : null);
      watchers.push(watcher);
      return watcher;
    });
    const abortController = new AbortController();

    const acquirePromise = pool.acquire('note.md', { abortSignal: abortController.signal });
    abortController.abort(new Error('cancelled'));

    await expect(acquirePromise).rejects.toThrow('cancelled');
    expect(watchers[0]?.unloadCount).toBe(1);
    expect(pool.getConsumerCount('note.md')).toBe(0);

    asyncLoad.resolve();
    await noopAsync();
    const next = await pool.acquire('note.md');
    expect(next.component).toBe(watchers[1]);
    expect(watchers[0]?.unloadCount).toBe(1);
  });

  it('should keep the component for the remaining waiter when one waiter aborts', async () => {
    const asyncLoad = createDeferred();
    const { pool } = createPool((key) => new WatcherComponent(key, asyncLoad));
    const abortController = new AbortController();

    const abortedPromise = pool.acquire('note.md', { abortSignal: abortController.signal });
    const keptPromise = pool.acquire('note.md');
    abortController.abort(new Error('cancelled'));
    asyncLoad.resolve();

    await expect(abortedPromise).rejects.toThrow('cancelled');
    const kept = await keptPromise;
    expect(watcherOf(kept).unloadCount).toBe(0);
    expect(pool.getConsumerCount('note.md')).toBe(1);
  });

  it('should reject at once for an already aborted signal', async () => {
    const createComponent = vi.fn((key: unknown) => new WatcherComponent(key));
    const { pool } = createPool(createComponent);

    await expect(pool.acquire('note.md', { abortSignal: AbortSignal.abort(new Error('early')) })).rejects.toThrow('early');
    expect(createComponent).not.toHaveBeenCalled();
  });

  it('should ignore an abort after the acquisition resolved', async () => {
    const { pool } = createPool();
    const abortController = new AbortController();

    const acquisition = await pool.acquire('note.md', { abortSignal: abortController.signal });
    abortController.abort();

    expect(acquisition.isReleased).toBe(false);
    expect(pool.getConsumerCount('note.md')).toBe(1);
  });

  it('should reject when released between the load and the resumption of acquire', async () => {
    // A plain component loads synchronously, so the load has completed before the abort below.
    const { pool } = createPool(() => new Component());
    const abortController = new AbortController();

    const acquirePromise = pool.acquire('note.md', { abortSignal: abortController.signal });
    abortController.abort();

    await expect(acquirePromise).rejects.toBeInstanceOf(SilentError);
    expect(pool.getConsumerCount('note.md')).toBe(0);
  });

  it('should release automatically when the consumer unloads', async () => {
    const { pool } = createPool();
    const panel1 = new Component();
    const panel2 = new Component();
    panel1.load();
    panel2.load();

    const first = await pool.acquire('note.md', { consumer: panel1 });
    await pool.acquire('note.md', { consumer: panel2 });
    const watcher = watcherOf(first);

    panel1.unload();
    expect(first.isReleased).toBe(true);
    expect(watcher.unloadCount).toBe(0);

    panel2.unload();
    expect(watcher.unloadCount).toBe(1);
  });

  it('should remove the consumer link when released by hand', async () => {
    const { pool } = createPool();
    const consumer = new ComponentEx();
    consumer.load();

    const acquisition = await pool.acquire('note.md', { consumer });
    expect(consumer._children).toHaveLength(1);

    acquisition.release();
    expect(consumer._children).toHaveLength(0);
    expect(watcherOf(acquisition).unloadCount).toBe(1);

    consumer.unload();
    expect(pool.getConsumerCount('note.md')).toBe(0);
  });

  it('should reject a pending acquisition when its consumer unloads', async () => {
    const asyncLoad = createDeferred();
    const { pool } = createPool((key) => new WatcherComponent(key, asyncLoad));
    const consumer = new Component();
    consumer.load();

    const acquirePromise = pool.acquire('note.md', { consumer });
    consumer.unload();

    await expect(acquirePromise).rejects.toBeInstanceOf(SilentError);
    expect(pool.getConsumerCount('note.md')).toBe(0);
  });

  it('should refuse an already unloaded consumer without keeping a reference', async () => {
    const { pool } = createPool();
    const consumer = new ComponentEx();
    consumer.load();
    consumer.unload();

    await expect(pool.acquire('note.md', { consumer })).rejects.toBeInstanceOf(SilentError);
    expect(pool.getConsumerCount('note.md')).toBe(0);
  });

  it('should unload every entry, reject waiters and refuse new acquisitions when the owner unloads', async () => {
    const asyncLoad = createDeferred();
    const watchers: WatcherComponent[] = [];
    const { owner, pool } = createPool((key) => {
      const watcher = new WatcherComponent(key, key === 'pending.md' ? asyncLoad : null);
      watchers.push(watcher);
      return watcher;
    });

    const held = await pool.acquire('note.md');
    const pendingPromise = pool.acquire('pending.md');

    owner.unload();

    await expect(pendingPromise).rejects.toBeInstanceOf(SilentError);
    expect(watchers.map((watcher) => watcher.unloadCount)).toEqual([1, 1]);
    await expect(pool.acquire('note.md')).rejects.toBeInstanceOf(SilentError);

    held.release();
    asyncLoad.resolve();
    await noopAsync();
    expect(watchers.map((watcher) => watcher.unloadCount)).toEqual([1, 1]);
  });

  it('should refuse acquisitions before the pool is loaded', async () => {
    const pool = new SharedComponentPoolComponent<string, Component>({ createComponent: (): Component => new Component() });

    await expect(pool.acquire('note.md')).rejects.toThrow('Component is not loaded');
  });

  it('should refuse a reentrant acquisition of the key being created, but allow other keys', async () => {
    let reentrantPromise: null | Promise<unknown> = null;
    let otherPromise: null | Promise<SharedComponentAcquisition<Component>> = null;
    const { pool } = createPool((key): Component => {
      if (key === 'outer.md') {
        reentrantPromise = pool.acquire('outer.md');
        otherPromise = pool.acquire('inner.md');
      }
      return new WatcherComponent(key);
    });

    await pool.acquire('outer.md');

    await expect(reentrantPromise).rejects.toThrow('A shared component cannot be acquired from inside its own creation');
    await expect(otherPromise).resolves.toBeDefined();
    expect(pool.getConsumerCount('inner.md')).toBe(1);
  });
});
