/**
 * @file
 *
 * Tests for {@link WorkerComponent} and {@link WorkerPoolComponent}, against an in-memory worker running the real
 * {@link exposeWorkerApi}.
 */

import { noop } from '@mnaoumov/typescript-lib/function';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  WorkerApiHandlers,
  WorkerCallContext,
  WorkerMessagePort
} from '../worker-protocol.ts';

import {
  exposeWorkerApi,
  withTransfer,
  WORKER_PROTOCOL
} from '../worker-protocol.ts';
import {
  WorkerCallError,
  WorkerComponent
} from './worker-component.ts';
import {
  getDefaultWorkerPoolSize,
  MAX_DEFAULT_WORKER_POOL_SIZE,
  WorkerPoolComponent
} from './worker-pool-component.ts';

interface TestApi {
  readonly double: (value: number) => number;
  readonly fail: () => never;
  readonly hang: () => Promise<string>;
  readonly slow: (value: number) => Promise<number>;
  readonly transferBack: () => ArrayBuffer;
}

let hangRelease = noop;

const HANDLERS: WorkerApiHandlers<TestApi> = {
  double: (value) => value * 2,
  fail: () => {
    throw new RangeError('worker boom');
  },
  async hang(this: WorkerCallContext): Promise<string> {
    await new Promise<void>((resolve) => {
      hangRelease = resolve;
    });
    return this.abortSignal.aborted ? 'aborted' : 'released';
  },
  slow: async (value) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    return value;
  },
  transferBack: () => {
    const buffer = new ArrayBuffer(2);
    return withTransfer(buffer, [buffer]);
  }
};

class FakeWorker extends EventTarget {
  public static instances: FakeWorker[] = [];
  public static shouldThrow = false;
  public isTerminated = false;
  public lastTransfer: Transferable[] = [];
  public readonly posted: unknown[] = [];
  public shouldThrowOnPost = false;
  private readonly workerListeners: (($event: MessageEvent<unknown>) => void)[] = [];

  public constructor(public readonly url: string, public readonly options: WorkerOptions) {
    super();
    if (FakeWorker.shouldThrow) {
      throw new Error('Workers are not supported');
    }
    FakeWorker.instances.push(this);
    const port: WorkerMessagePort = {
      addEventListener: (_type, listener): void => {
        this.workerListeners.push(listener);
      },
      postMessage: (message): void => {
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent('message', { data: message }));
        }, 0);
      }
    };
    exposeWorkerApi(HANDLERS, port);
  }

  public postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.shouldThrowOnPost) {
      throw new Error('could not clone');
    }
    this.posted.push(message);
    this.lastTransfer = transfer;
    for (const listener of this.workerListeners) {
      listener(new MessageEvent('message', { data: message }));
    }
  }

  public terminate(): void {
    this.isTerminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.shouldThrow = false;
  vi.stubGlobal('Worker', FakeWorker);
  window.URL.createObjectURL = vi.fn(() => 'blob:worker');
  window.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function getOnlyWorker(): FakeWorker {
  const [worker] = FakeWorker.instances;
  if (!worker) {
    throw new Error('No worker was created');
  }
  return worker;
}

describe('WorkerComponent', () => {
  it('starts the worker from a Blob URL and calls it', async () => {
    const component = new WorkerComponent<TestApi>({ name: 'test worker', source: 'self.onmessage = null;' });
    component.load();
    const worker = getOnlyWorker();
    expect(worker.url).toBe('blob:worker');
    expect(worker.options).toEqual({ name: 'test worker' });
    expect(component.isUsingFallback).toBe(false);

    const promise = component.call('double', [21]);
    expect(component.pendingCallCount).toBe(1);
    await expect(promise).resolves.toBe(42);
    expect(component.pendingCallCount).toBe(0);
    await expect(component.call('transferBack', [])).resolves.toBeInstanceOf(ArrayBuffer);

    component.unload();
    expect(worker.isTerminated).toBe(true);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:worker');
  });

  it('passes the transfer list and omits an absent name', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const worker = getOnlyWorker();
    expect(worker.options).toEqual({});
    const buffer = new ArrayBuffer(1);
    await component.call('double', [1], { transfer: [buffer] });
    expect(worker.lastTransfer).toEqual([buffer]);
    component.unload();
  });

  it('rejects with a WorkerCallError carrying the worker-side error', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const error = await component.call('fail', []).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(WorkerCallError);
    expect(error).toMatchObject({ message: 'worker boom', name: 'WorkerCallError', remoteName: 'RangeError' });
    expect((error as WorkerCallError).remoteStack).toContain('worker boom');
    component.unload();
  });

  it('cancels a call: rejects at once and aborts the handler signal', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const abortController = new AbortController();
    const promise = component.call('hang', [], { abortSignal: abortController.signal });
    abortController.abort(new Error('stop'));
    await expect(promise).rejects.toThrow('stop');
    expect(getOnlyWorker().posted).toContainEqual({ id: 1, kind: 'cancel', protocol: WORKER_PROTOCOL });
    hangRelease();
    component.unload();
  });

  it('turns a non-error abort reason into an error', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const abortController = new AbortController();
    const promise = component.call('hang', [], { abortSignal: abortController.signal });
    abortController.abort('plain reason');
    await expect(promise).rejects.toThrow('plain reason');
    hangRelease();
    component.unload();
  });

  it('refuses an already aborted signal and an unloaded component', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    await expect(component.call('double', [1])).rejects.toThrow('not loaded');
    component.load();
    await expect(component.call('double', [1], { abortSignal: AbortSignal.abort(new Error('early')) })).rejects.toThrow('early');
    component.unload();
  });

  it('rejects pending calls on unload', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const promise = component.call('hang', []);
    component.unload();
    await expect(promise).rejects.toThrow('The worker component was unloaded');
    hangRelease();
  });

  it('sends no cancel for a call already rejected by the unload', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const worker = getOnlyWorker();
    const abortController = new AbortController();
    const promise = component.call('hang', [], { abortSignal: abortController.signal });
    component.unload();
    abortController.abort();
    await expect(promise).rejects.toThrow('The worker component was unloaded');
    expect(worker.posted).toHaveLength(1);
    hangRelease();
  });

  it('rejects pending calls when the worker fails or sends an unreadable message', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const worker = getOnlyWorker();

    const first = component.call('hang', []);
    worker.dispatchEvent(new ErrorEvent('error', { message: 'syntax error' }));
    await expect(first).rejects.toThrow('The worker failed: syntax error');

    const second = component.call('hang', []);
    worker.dispatchEvent(new ErrorEvent('error'));
    await expect(second).rejects.toThrow('The worker failed: unknown error');

    const third = component.call('hang', []);
    worker.dispatchEvent(new MessageEvent('messageerror'));
    await expect(third).rejects.toThrow('could not be deserialized');
    hangRelease();
    component.unload();
  });

  it('ignores foreign and unmatched messages', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    const worker = getOnlyWorker();
    worker.dispatchEvent(new MessageEvent('message', { data: { foreign: true } }));
    worker.dispatchEvent(new MessageEvent('message', { data: { id: 404, kind: 'result', protocol: WORKER_PROTOCOL, value: 1 } }));
    await expect(component.call('double', [2])).resolves.toBe(4);
    component.unload();
  });

  it('rejects a call whose message cannot be posted', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    getOnlyWorker().shouldThrowOnPost = true;
    await expect(component.call('double', [1])).rejects.toThrow('could not clone');
    component.unload();
  });

  it('turns a non-error post failure into an error', async () => {
    const component = new WorkerComponent<TestApi>({ source: '' });
    component.load();
    vi.spyOn(getOnlyWorker(), 'postMessage').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- The case under test.
      throw 'not an error';
    });
    await expect(component.call('double', [1])).rejects.toThrow('not an error');
    component.unload();
  });

  it('fails its load when no worker can be created and no fallback is given', () => {
    FakeWorker.shouldThrow = true;
    const component = new WorkerComponent<TestApi>({ source: '' });
    expect(() => {
      component.load();
    }).toThrow('Workers are not supported');
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:worker');
  });

  it('runs the fallback handlers on the main thread when no worker can be created', async () => {
    FakeWorker.shouldThrow = true;
    const component = new WorkerComponent<TestApi>({ fallbackHandlers: HANDLERS, source: '' });
    component.load();
    expect(component.isUsingFallback).toBe(true);
    await expect(component.call('double', [4])).resolves.toBe(8);
    await expect(component.call('transferBack', [])).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(component.call('fail', [])).rejects.toThrow('worker boom');

    const abortController = new AbortController();
    const promise = component.call('hang', [], { abortSignal: abortController.signal });
    abortController.abort(new Error('fallback stop'));
    await expect(promise).rejects.toThrow('fallback stop');
    hangRelease();

    component.unload();
    expect(component.isUsingFallback).toBe(false);
  });
});

describe('WorkerPoolComponent', () => {
  it('spreads calls over the least busy workers and calls them all', async () => {
    const pool = new WorkerPoolComponent<TestApi>({ name: 'pool', size: 2, source: '' });
    pool.load();
    expect(pool.size).toBe(2);
    expect(FakeWorker.instances.map((worker) => worker.options.name)).toEqual(['pool 0', 'pool 1']);

    const first = pool.call('slow', [1]);
    const second = pool.call('slow', [2]);
    expect(pool.getWorker(0).pendingCallCount).toBe(1);
    expect(pool.getWorker(1).pendingCallCount).toBe(1);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);

    await expect(pool.callAll('double', [3])).resolves.toEqual([6, 6]);
    await expect(pool.callAll('double', [3], new AbortController().signal)).resolves.toEqual([6, 6]);
    expect(() => pool.getWorker(2)).toThrow('no worker at index 2');

    pool.unload();
    expect(FakeWorker.instances.every((worker) => worker.isTerminated)).toBe(true);
  });

  it('passes the fallback handlers to every worker', async () => {
    FakeWorker.shouldThrow = true;
    const pool = new WorkerPoolComponent<TestApi>({ fallbackHandlers: HANDLERS, size: 1, source: '' });
    pool.load();
    expect(pool.getWorker(0).isUsingFallback).toBe(true);
    await expect(pool.call('double', [5])).resolves.toBe(10);
    pool.unload();
  });

  it('defaults its size and refuses a bad one', () => {
    expect(new WorkerPoolComponent<TestApi>({ source: '' }).size).toBe(getDefaultWorkerPoolSize());
    expect(() => new WorkerPoolComponent<TestApi>({ size: 0, source: '' })).toThrow('positive integer size, not 0');
    expect(() => new WorkerPoolComponent<TestApi>({ size: 1.5, source: '' })).toThrow('not 1.5');
  });
});

describe('getDefaultWorkerPoolSize', () => {
  it('keeps one processor for the main thread, within bounds', () => {
    expect(getDefaultWorkerPoolSize(1)).toBe(1);
    expect(getDefaultWorkerPoolSize(3)).toBe(2);
    expect(getDefaultWorkerPoolSize(64)).toBe(MAX_DEFAULT_WORKER_POOL_SIZE);
  });
});
