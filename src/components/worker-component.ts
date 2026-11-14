/**
 * @file
 *
 * A component that owns one browser `Worker` built from bundled source and calls it through a typed request/response
 * channel.
 */

import { noop } from '@mnaoumov/typescript-lib/function';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type {
  SerializedWorkerError,
  WorkerApi,
  WorkerApiHandlers,
  WorkerCallMessage,
  WorkerCancelMessage
} from '../worker-protocol.ts';

import {
  invokeWorkerHandler,
  isWorkerResponseMessage,
  unwrapTransferredValue,
  WORKER_PROTOCOL
} from '../worker-protocol.ts';
import { ComponentEx } from './component-ex.ts';

/**
 * Options of {@link WorkerComponent.call}.
 */
export interface WorkerComponentCallOptions {
  /**
   * Cancels the call. The returned promise rejects with the signal's reason at once, and the worker's handler sees its
   * own `this.abortSignal` aborted; whatever it answers afterwards is dropped.
   */
  readonly abortSignal?: AbortSignal;

  /**
   * Objects inside the arguments to transfer rather than copy. They are unusable on the main thread afterwards.
   */
  readonly transfer?: readonly Transferable[];
}

/**
 * Parameters of {@link WorkerComponent}.
 *
 * @typeParam TApi - The API the worker exposes.
 */
export interface WorkerComponentConstructorParams<TApi extends WorkerApi<TApi>> {
  /**
   * The same handlers the worker exposes, run on the main thread when no `Worker` can be created. Without them, a
   * failure to create the worker fails the component's load.
   */
  readonly fallbackHandlers?: WorkerApiHandlers<TApi>;

  /**
   * The worker's name, shown by the developer tools.
   */
  readonly name?: string;

  /**
   * The bundled worker source: the string a `*.worker.ts?worker-source` import gives with
   * `@mnaoumov/obsidian-dev-toolkit`'s `workers` feature.
   */
  readonly source: string;
}

/**
 * The method names of a {@link WorkerApi}.
 *
 * @typeParam TApi - The API type.
 */
export type WorkerMethod<TApi> = Extract<keyof TApi, string>;

/**
 * The resolved result type of a worker method.
 *
 * @typeParam TApi - The API type.
 * @typeParam TMethod - The method.
 */
export type WorkerMethodResult<TApi extends WorkerApi<TApi>, TMethod extends WorkerMethod<TApi>> = Awaited<ReturnType<TApi[TMethod]>>;

interface PendingCall {
  readonly reject: (reason: Error) => void;
  readonly resolve: (value: unknown) => void;
}

/**
 * The error a call rejects with when the worker's handler failed. It carries the worker-side name, message and stack,
 * because an `Error` loses its class across the worker boundary.
 */
export class WorkerCallError extends Error {
  /**
   * The name of the error thrown in the worker.
   */
  public readonly remoteName: string;

  /**
   * The stack of the error thrown in the worker, when there was one.
   */
  public readonly remoteStack: string | undefined;

  /**
   * Creates the error.
   *
   * @param error - The serialized worker-side error.
   */
  public constructor(error: SerializedWorkerError) {
    super(error.message);
    this.name = 'WorkerCallError';
    this.remoteName = error.name;
    this.remoteStack = error.stack;
  }
}

/**
 * Owns one `Worker` for the component's lifetime.
 *
 * On load it turns the bundled source into a Blob URL and starts the worker; on unload it terminates the worker,
 * revokes the URL and rejects every pending call. Add it as a child of the plugin (or of any component), so the worker
 * never outlives what uses it.
 *
 * The worker entry point calls `exposeWorkerApi` from `@mnaoumov/obsidian-lib/worker-protocol`, and
 * {@link WorkerComponent.call} reaches its handlers by name, typed by `TApi`.
 *
 * @typeParam TApi - The API the worker exposes.
 */
export class WorkerComponent<TApi extends WorkerApi<TApi>> extends ComponentEx {
  /**
   * Whether calls run on the main thread, because no `Worker` could be created and fallback handlers were given.
   *
   * @returns Whether the fallback is in use.
   */
  public get isUsingFallback(): boolean {
    return this.activeFallbackHandlers !== null;
  }

  /**
   * The number of calls that have not settled yet.
   *
   * @returns The count.
   */
  public get pendingCallCount(): number {
    return this._pendingCallCount;
  }

  /**
   * The handlers to run on the main thread when no `Worker` can be created, or `null`.
   */
  protected readonly fallbackHandlers: null | WorkerApiHandlers<TApi>;

  /**
   * The worker's name, or `null`.
   */
  protected readonly name: null | string;

  /**
   * The bundled worker source.
   */
  protected readonly source: string;

  private _pendingCallCount = 0;
  private activeFallbackHandlers: null | WorkerApiHandlers<TApi> = null;
  private lastCallId = 0;
  private readonly pendingCalls = new Map<number, PendingCall>();
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- The renderer's Web Worker, not Node's.
  private worker: null | Worker = null;
  private workerUrl: null | string = null;

  /**
   * Creates the component.
   *
   * @param params - The parameters.
   */
  public constructor(params: WorkerComponentConstructorParams<TApi>) {
    super();
    this.fallbackHandlers = params.fallbackHandlers ?? null;
    this.name = params.name ?? null;
    this.source = params.source;
  }

  /**
   * Calls a worker method.
   *
   * @typeParam TMethod - The method.
   * @param method - The method name.
   * @param callArguments - The method's arguments.
   * @param options - The call options.
   * @returns The method's result. Rejects with a {@link WorkerCallError} when the handler failed, with the abort reason
   *   when the call was cancelled, and with an `Error` when the worker failed or the component unloaded first.
   */
  public async call<TMethod extends WorkerMethod<TApi>>(
    method: TMethod,
    callArguments: Parameters<TApi[TMethod]>,
    options: WorkerComponentCallOptions = {}
  ): Promise<WorkerMethodResult<TApi, TMethod>> {
    if (!this._loaded) {
      throw new Error('The worker component is not loaded');
    }
    const abortSignal = options.abortSignal ?? new AbortController().signal;
    abortSignal.throwIfAborted();

    this._pendingCallCount++;
    try {
      const result = this.activeFallbackHandlers === null
        ? await this.callWorker(method, callArguments, abortSignal, options.transfer ?? [])
        : await callFallback(this.activeFallbackHandlers, method, callArguments, abortSignal);
      return result as WorkerMethodResult<TApi, TMethod>;
    } finally {
      this._pendingCallCount--;
    }
  }

  /**
   * Starts the worker.
   */
  public override onload(): void {
    super.onload();
    try {
      this.startWorker();
    } catch (error) {
      this.stopWorker();
      if (this.fallbackHandlers === null) {
        throw error;
      }
      this.activeFallbackHandlers = this.fallbackHandlers;
    }
  }

  /**
   * Terminates the worker and rejects the pending calls.
   */
  public override onunload(): void {
    super.onunload();
    this.stopWorker();
    this.rejectAll(new Error('The worker component was unloaded'));
    this.activeFallbackHandlers = null;
  }

  private async callWorker(
    method: string,
    callArguments: readonly unknown[],
    abortSignal: AbortSignal,
    transfer: readonly Transferable[]
  ): Promise<unknown> {
    // A loaded component without fallback handlers in use always holds its worker.
    const worker = ensureNonNullable(this.worker);

    this.lastCallId++;
    const id = this.lastCallId;
    let onAbort = noop;

    try {
      return await new Promise<unknown>((resolve, reject) => {
        onAbort = (): void => {
          if (!this.pendingCalls.delete(id)) {
            return;
          }
          const cancelMessage: WorkerCancelMessage = { id, kind: 'cancel', protocol: WORKER_PROTOCOL };
          worker.postMessage(cancelMessage);
          reject(getAbortReason(abortSignal));
        };
        this.pendingCalls.set(id, { reject, resolve });
        const callMessage: WorkerCallMessage = { arguments: callArguments, id, kind: 'call', method, protocol: WORKER_PROTOCOL };
        try {
          worker.postMessage(callMessage, [...transfer]);
        } catch (error) {
          this.pendingCalls.delete(id);
          reject(toError(error));
          return;
        }
        abortSignal.addEventListener('abort', onAbort, { once: true });
      });
    } finally {
      abortSignal.removeEventListener('abort', onAbort);
    }
  }

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- The renderer's Web ErrorEvent, not Node's.
  private readonly handleError = ($event: ErrorEvent): void => {
    $event.preventDefault();
    this.rejectAll(new Error(`The worker failed: ${$event.message || 'unknown error'}`));
  };

  private readonly handleMessage = ($event: MessageEvent<unknown>): void => {
    const message = $event.data;
    if (!isWorkerResponseMessage(message)) {
      return;
    }
    const pendingCall = this.pendingCalls.get(message.id);
    if (!pendingCall) {
      return;
    }
    this.pendingCalls.delete(message.id);
    if (message.kind === 'result') {
      pendingCall.resolve(message.value);
    } else {
      pendingCall.reject(new WorkerCallError(message.error));
    }
  };

  private readonly handleMessageError = (): void => {
    this.rejectAll(new Error('The worker sent a message that could not be deserialized'));
  };

  private rejectAll(reason: Error): void {
    const pendingCalls = [...this.pendingCalls.values()];
    this.pendingCalls.clear();
    for (const pendingCall of pendingCalls) {
      pendingCall.reject(reason);
    }
  }

  private revokeWorkerUrl(): void {
    if (this.workerUrl === null) {
      return;
    }
    window.URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
  }

  private startWorker(): void {
    this.workerUrl = window.URL.createObjectURL(new Blob([this.source], { type: 'text/javascript' }));
    const workerOptions: WorkerOptions = this.name === null ? {} : { name: this.name };
    const worker = new window.Worker(this.workerUrl, workerOptions);
    this.worker = worker;
    worker.addEventListener('message', this.handleMessage);
    worker.addEventListener('messageerror', this.handleMessageError);
    worker.addEventListener('error', this.handleError);
  }

  private stopWorker(): void {
    this.terminateWorker();
    this.revokeWorkerUrl();
  }

  private terminateWorker(): void {
    if (!this.worker) {
      return;
    }
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('messageerror', this.handleMessageError);
    this.worker.removeEventListener('error', this.handleError);
    this.worker.terminate();
    this.worker = null;
  }
}

async function callFallback(
  handlers: object,
  method: string,
  callArguments: readonly unknown[],
  callerSignal: AbortSignal
): Promise<unknown> {
  const abortController = new AbortController();
  function onAbort(): void {
    abortController.abort(callerSignal.reason);
  }
  callerSignal.addEventListener('abort', onAbort, { once: true });
  try {
    const handlerPromise = invokeWorkerHandler(handlers, method, callArguments, { abortSignal: abortController.signal });
    // The race below may settle on the abort first; the handler's own later rejection is then nobody's to report.
    handlerPromise.catch(noop);
    const abortPromise = new Promise<never>((_resolve, reject) => {
      abortController.signal.addEventListener('abort', () => {
        reject(getAbortReason(abortController.signal));
      }, { once: true });
    });
    return unwrapTransferredValue(await Promise.race([handlerPromise, abortPromise])).value;
  } finally {
    callerSignal.removeEventListener('abort', onAbort);
  }
}

function getAbortReason(abortSignal: AbortSignal): Error {
  return toError(abortSignal.reason);
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
