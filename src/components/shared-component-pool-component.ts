/**
 * @file
 *
 * A pool that shares one loaded component per caller-defined key among several consumers, and unloads it when the
 * last consumer releases it.
 */

import type { DisposableEx } from '@mnaoumov/typescript-lib/disposable';

import { onAbort } from '@mnaoumov/typescript-lib/abort-controller';
import { snapshot } from '@mnaoumov/typescript-lib/array';
import { SilentError } from '@mnaoumov/typescript-lib/error';
import { noop } from '@mnaoumov/typescript-lib/function';
import { Component } from 'obsidian';

import { ComponentEx } from './component-ex.ts';

/**
 * One consumer's hold on a shared component.
 *
 * Releasing it is idempotent: the first call drops the hold, and every later call — including the one the consumer
 * link makes when the consumer unloads — does nothing.
 *
 * @typeParam TComponent - The type of the shared component.
 */
export interface SharedComponentAcquisition<TComponent extends Component> extends DisposableEx {
  /**
   * The shared component, loaded. Every consumer of the same key receives the same instance.
   */
  readonly component: TComponent;

  /**
   * Whether this acquisition has been released.
   */
  readonly isReleased: boolean;

  /**
   * Releases this acquisition. The shared component is unloaded when its last acquisition is released.
   */
  readonly release: () => void;
}

/**
 * Options of {@link SharedComponentPoolComponent.acquire}.
 */
export interface SharedComponentPoolComponentAcquireOptions {
  /**
   * Cancels the acquisition while the shared component is still loading. An abort after the acquisition resolved does
   * nothing; release the acquisition instead.
   */
  readonly abortSignal?: AbortSignal;

  /**
   * A component whose unload releases the acquisition automatically.
   *
   * The link is a child component added to the consumer, so it follows Obsidian's own rules: a consumer that is not
   * loaded yet starts holding the link when it loads, and a {@link ComponentEx} consumer that is already unloaded
   * refuses it with a {@link SilentError}. Releasing the acquisition by hand removes the link again, so a long-lived
   * consumer that acquires and releases many times accumulates nothing.
   */
  readonly consumer?: Component;
}

/**
 * Parameters of {@link SharedComponentPoolComponent}.
 *
 * @typeParam TKey - The type of the resource key.
 * @typeParam TComponent - The type of the shared component.
 */
export interface SharedComponentPoolComponentConstructorParams<TKey, TComponent extends Component> {
  /**
   * Creates the component shared under a key. Called once per key each time the key goes from no consumer to one; the
   * pool loads the component itself, so the factory must return it unloaded.
   *
   * @param key - The resource key.
   * @returns The new, not yet loaded component.
   */
  readonly createComponent: (key: TKey) => TComponent;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: () => void;
}

interface PoolEntry<TKey, TComponent extends Component> {
  readonly component: TComponent;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Mutable bookkeeping of the pool.
  consumerCount: number;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Mutable bookkeeping of the pool.
  isUnloaded: boolean;
  readonly key: TKey;
  readonly ready: Deferred;
}

class SharedComponentAcquisitionImpl<TComponent extends Component> implements SharedComponentAcquisition<TComponent> {
  public get isReleased(): boolean {
    return this._isReleased;
  }

  private _isReleased = false;
  private unlinkConsumer: (() => void) | null = null;

  public constructor(public readonly component: TComponent, private readonly onRelease: () => void) {}

  public dispose(): void {
    this.release();
  }

  public linkConsumer(consumer: Component): void {
    const consumerLink = new Component();
    consumerLink.register(() => {
      this.unlinkConsumer = null;
      this.release();
    });
    consumer.addChild(consumerLink);
    this.unlinkConsumer = (): void => {
      consumer.removeChild(consumerLink);
    };
  }

  public release(): void {
    if (this._isReleased) {
      return;
    }

    this._isReleased = true;
    const unlinkConsumer = this.unlinkConsumer;
    this.unlinkConsumer = null;
    unlinkConsumer?.();
    this.onRelease();
  }

  public [Symbol.dispose](): void {
    this.release();
  }
}

/**
 * Shares one loaded component per caller-defined key among several consumers.
 *
 * The first {@link acquire} of a key creates the component through the factory and loads it; every further acquire of
 * the same key, concurrent or later, receives the same instance; the release of the last acquisition unloads it, and
 * the next acquire creates a fresh one. A {@link ComponentEx} is loaded through {@link ComponentEx.loadWithPromises}, so
 * an acquire resolves only once its `onloadAsync` and children have settled, and a failed load rejects every waiting
 * acquire, unloads the component and leaves the key free for a fresh attempt.
 *
 * The pool is itself a component, and its parent is the owner of every shared instance: add it with `addChild` to the
 * plugin (or any longer-lived component). Unloading the owner unloads every shared component still held, rejects
 * every acquire still waiting with a {@link SilentError}, and refuses later acquires. Keys are compared the way a
 * {@link Map} compares them, so two equal-looking object keys are two resources. The instances live on the pool
 * object only, never in the shared-state bag, so two plugins — or two pools of one plugin — never share anything.
 *
 * Reach for it only when SEVERAL independent consumers want the same expensive component and none of them owns it.
 * A component with a single owner is that owner's child: `addChild` is simpler and already unloads it with its owner.
 *
 * @typeParam TKey - The type of the resource key.
 * @typeParam TComponent - The type of the shared component.
 */
export class SharedComponentPoolComponent<TKey, TComponent extends Component> extends ComponentEx {
  /**
   * Creates the component shared under a key; see {@link SharedComponentPoolComponentConstructorParams.createComponent}.
   */
  protected readonly createComponent: (key: TKey) => TComponent;

  private readonly creatingKeys = new Set<TKey>();
  private readonly entries = new Map<TKey, PoolEntry<TKey, TComponent>>();

  /**
   * Creates a new pool.
   *
   * @param params - The pool parameters.
   */
  public constructor(params: SharedComponentPoolComponentConstructorParams<TKey, TComponent>) {
    super();
    this.createComponent = params.createComponent;
  }

  /**
   * Acquires the component shared under a key, creating and loading it when the key has no consumer yet.
   *
   * @param key - The resource key.
   * @param options - The acquisition options.
   * @returns The acquisition, once the shared component has loaded.
   * @throws An {@link Error} when the pool was never loaded, when the factory or the load fails, or when called for a
   *   key from inside that key's own factory or synchronous load; a {@link SilentError} when the pool is unloaded, or
   *   when the consumer unloads or the acquisition is released before the load completes; the abort reason when
   *   `abortSignal` aborts first.
   */
  public async acquire(key: TKey, options: SharedComponentPoolComponentAcquireOptions = {}): Promise<SharedComponentAcquisition<TComponent>> {
    this.ensureLoaded();
    options.abortSignal?.throwIfAborted();

    if (this.creatingKeys.has(key)) {
      throw new Error('A shared component cannot be acquired from inside its own creation');
    }

    const entry = this.entries.get(key) ?? this.createEntry(key);
    entry.consumerCount++;

    const cancellation = createDeferred();
    const acquisition = new SharedComponentAcquisitionImpl(entry.component, () => {
      cancellation.reject(new SilentError('The shared component acquisition was released'));
      this.releaseReference(entry);
    });

    using _abortListener = options.abortSignal
      ? onAbort(options.abortSignal, (abortSignal) => {
        cancellation.reject(abortSignal.reason);
        acquisition.release();
      })
      : null;

    try {
      if (options.consumer) {
        acquisition.linkConsumer(options.consumer);
      }
      await Promise.race([entry.ready.promise, cancellation.promise]);
    } catch (error) {
      acquisition.release();
      throw error;
    }

    if (acquisition.isReleased) {
      throw new SilentError('The shared component acquisition was released');
    }

    return acquisition;
  }

  /**
   * Returns how many acquisitions currently hold the component shared under a key, pending ones included.
   *
   * @param key - The resource key.
   * @returns The number of consumers, `0` when the key has no shared component.
   */
  public getConsumerCount(key: TKey): number {
    return this.entries.get(key)?.consumerCount ?? 0;
  }

  /**
   * Registers the teardown that unloads every shared component when the pool unloads.
   */
  public override onload(): void {
    this.register(() => {
      for (const entry of snapshot([...this.entries.values()])) {
        this.unloadEntry(entry, new SilentError('The shared component pool is unloaded'));
      }
    });
  }

  private createEntry(key: TKey): PoolEntry<TKey, TComponent> {
    this.creatingKeys.add(key);
    try {
      const component = this.createComponent(key);
      const entry: PoolEntry<TKey, TComponent> = {
        component,
        consumerCount: 0,
        isUnloaded: false,
        key,
        ready: createDeferred()
      };
      this.entries.set(key, entry);

      let loadPromise: null | Promise<void> = null;
      try {
        if (component instanceof ComponentEx) {
          loadPromise = component.loadWithPromises();
        } else {
          component.load();
        }
      } catch (error) {
        this.unloadEntry(entry, error);
        throw error;
      }

      if (loadPromise) {
        loadPromise.then(() => {
          entry.ready.resolve();
        }).catch((error: unknown) => {
          this.unloadEntry(entry, error);
        });
      } else {
        entry.ready.resolve();
      }

      return entry;
    } finally {
      this.creatingKeys.delete(key);
    }
  }

  private releaseReference(entry: PoolEntry<TKey, TComponent>): void {
    entry.consumerCount--;
    if (entry.consumerCount <= 0) {
      this.unloadEntry(entry, new SilentError('The last consumer released the shared component before it loaded'));
    }
  }

  private unloadEntry(entry: PoolEntry<TKey, TComponent>, reason: unknown): void {
    if (entry.isUnloaded) {
      return;
    }

    entry.isUnloaded = true;
    // An entry stays in the map until it is unloaded, and only once, so the key still maps to this entry.
    this.entries.delete(entry.key);
    entry.ready.reject(reason);
    entry.component.unload();
  }
}

function createDeferred(): Deferred {
  let resolve: () => void = noop;
  let reject: (reason: unknown) => void = noop;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // A deferred may be rejected while nobody awaits it; mark it handled so that is not an unhandled rejection.
  promise.catch(noop);
  return { promise, reject, resolve };
}
