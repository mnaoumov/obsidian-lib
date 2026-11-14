/**
 * @file
 *
 * A component that owns several workers built from the same bundled source and spreads calls over them.
 */

import type {
  WorkerApi,
  WorkerApiHandlers
} from '../worker-protocol.ts';
import type {
  WorkerComponentCallOptions,
  WorkerMethod,
  WorkerMethodResult
} from './worker-component.ts';

import { ComponentEx } from './component-ex.ts';
import { WorkerComponent } from './worker-component.ts';

/**
 * The most workers {@link getDefaultWorkerPoolSize} suggests, so a pool on a many-core desktop does not starve
 * Obsidian's own renderer of memory.
 */
export const MAX_DEFAULT_WORKER_POOL_SIZE = 4;

/**
 * Options of {@link WorkerPoolComponent.call}: the same as {@link WorkerComponent.call}'s.
 */
export type WorkerPoolComponentCallOptions = WorkerComponentCallOptions;

/**
 * Parameters of {@link WorkerPoolComponent}.
 *
 * @typeParam TApi - The API every worker exposes.
 */
export interface WorkerPoolComponentConstructorParams<TApi extends WorkerApi<TApi>> {
  /**
   * The handlers to run on the main thread when no `Worker` can be created. See {@link WorkerComponent}.
   */
  readonly fallbackHandlers?: WorkerApiHandlers<TApi>;

  /**
   * The workers' name prefix, shown by the developer tools; each worker gets `<name> <index>`.
   */
  readonly name?: string;

  /**
   * The number of workers. Defaults to {@link getDefaultWorkerPoolSize}.
   */
  readonly size?: number;

  /**
   * The bundled worker source.
   */
  readonly source: string;
}

/**
 * Owns a fixed number of {@link WorkerComponent} children and sends each call to the one with the fewest pending calls.
 *
 * Use it for CPU-bound jobs that split into independent calls. A job that keeps state in a worker (a loaded corpus, an
 * instantiated module) addresses each worker by index through {@link WorkerPoolComponent.getWorker} instead.
 *
 * @typeParam TApi - The API every worker exposes.
 */
export class WorkerPoolComponent<TApi extends WorkerApi<TApi>> extends ComponentEx {
  /**
   * The number of workers.
   *
   * @returns The size.
   */
  public get size(): number {
    return this.workers.length;
  }

  private readonly workers: WorkerComponent<TApi>[] = [];

  /**
   * Creates the pool.
   *
   * @param params - The parameters.
   */
  public constructor(protected readonly params: WorkerPoolComponentConstructorParams<TApi>) {
    super();
    const size = params.size ?? getDefaultWorkerPoolSize();
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new Error(`A worker pool needs a positive integer size, not ${String(size)}`);
    }
    for (let index = 0; index < size; index++) {
      const workerParams = {
        source: params.source,
        ...(params.fallbackHandlers !== undefined && { fallbackHandlers: params.fallbackHandlers }),
        ...(params.name !== undefined && { name: `${params.name} ${String(index)}` })
      };
      this.workers.push(this.addChild(new WorkerComponent<TApi>(workerParams)));
    }
  }

  /**
   * Calls a method on the least busy worker.
   *
   * @typeParam TMethod - The method.
   * @param method - The method name.
   * @param callArguments - The method's arguments.
   * @param options - The call options.
   * @returns The method's result.
   */
  public async call<TMethod extends WorkerMethod<TApi>>(
    method: TMethod,
    callArguments: Parameters<TApi[TMethod]>,
    options?: WorkerPoolComponentCallOptions
  ): Promise<WorkerMethodResult<TApi, TMethod>> {
    let leastBusy = this.getWorker(0);
    for (const worker of this.workers) {
      if (worker.pendingCallCount < leastBusy.pendingCallCount) {
        leastBusy = worker;
      }
    }
    return await leastBusy.call(method, callArguments, options);
  }

  /**
   * Calls a method on every worker with the same arguments, for instance to configure them all.
   *
   * @typeParam TMethod - The method.
   * @param method - The method name.
   * @param callArguments - The method's arguments, cloned for each worker; nothing can be transferred to all of them.
   * @param abortSignal - Cancels every call.
   * @returns The results, in worker order.
   */
  public async callAll<TMethod extends WorkerMethod<TApi>>(
    method: TMethod,
    callArguments: Parameters<TApi[TMethod]>,
    abortSignal?: AbortSignal
  ): Promise<WorkerMethodResult<TApi, TMethod>[]> {
    const options: WorkerComponentCallOptions = abortSignal === undefined ? {} : { abortSignal };
    return await Promise.all(this.workers.map(async (worker) => await worker.call(method, callArguments, options)));
  }

  /**
   * Gets one worker, for jobs that keep state in a particular worker.
   *
   * @param index - The worker index, from `0` to {@link WorkerPoolComponent.size} minus one.
   * @returns The worker.
   */
  public getWorker(index: number): WorkerComponent<TApi> {
    const worker = this.workers[index];
    if (!worker) {
      throw new Error(`The worker pool has no worker at index ${String(index)}`);
    }
    return worker;
  }
}

/**
 * Suggests a pool size: one fewer than the logical processors, so the main thread keeps one, between `1` and
 * {@link MAX_DEFAULT_WORKER_POOL_SIZE}.
 *
 * @param hardwareConcurrency - The number of logical processors. Defaults to `navigator.hardwareConcurrency`.
 * @returns The suggested size.
 */
export function getDefaultWorkerPoolSize(hardwareConcurrency?: number): number {
  const processorCount = hardwareConcurrency ?? window.navigator.hardwareConcurrency;
  return Math.max(1, Math.min(MAX_DEFAULT_WORKER_POOL_SIZE, processorCount - 1));
}
