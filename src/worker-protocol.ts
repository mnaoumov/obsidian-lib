/**
 * @file
 *
 * The message protocol between `WorkerComponent` on the main thread and {@link exposeWorkerApi} inside a worker.
 *
 * This module imports nothing, so a worker entry point bundled by `@mnaoumov/obsidian-dev-toolkit`'s `workers` feature
 * can import it: a worker has no `obsidian` module and no Node builtins. Its message shapes are a wire format between
 * the plugin's main bundle and its worker bundle, which may come from different copies of this library, so fields are
 * only ever added and a change of meaning moves to a new {@link WORKER_PROTOCOL} value.
 */

/**
 * The tag every message of this protocol carries. Messages without it are ignored on both sides, so a worker can
 * exchange its own messages too.
 */
export const WORKER_PROTOCOL = 'obsidian-lib-worker-v1';

/**
 * An error reduced to plain data, because an `Error` loses its class across the worker boundary.
 */
export interface SerializedWorkerError {
  /**
   * The error message.
   */
  readonly message: string;

  /**
   * The error name.
   */
  readonly name: string;

  /**
   * The stack in the worker, when there was one.
   */
  readonly stack?: string;
}

/**
 * A result marked to transfer some of its objects rather than copy them. Build it with {@link withTransfer}.
 *
 * @typeParam TValue - The value type.
 */
export interface TransferredValue<TValue> {
  /**
   * The marker that identifies the wrapper structurally, so a wrapper built by another copy of this library is
   * recognized too.
   */
  readonly __obsidianLibTransferredValue: true;

  /**
   * The objects to transfer.
   */
  readonly transfer: readonly Transferable[];

  /**
   * The value.
   */
  readonly value: TValue;
}

/**
 * A value split from its transfer list, ready to post.
 */
export interface UnwrappedTransferredValue {
  /**
   * The objects to transfer.
   */
  readonly transfer: Transferable[];

  /**
   * The value to post.
   */
  readonly value: unknown;
}

/**
 * An API a worker exposes: an object whose every member is a function.
 *
 * @typeParam TApi - The API type.
 */
export type WorkerApi<TApi> = { readonly [TMethod in keyof TApi]: (...parameters: never[]) => unknown };

/**
 * The handlers implementing a {@link WorkerApi}, with the {@link WorkerCallContext} as `this`.
 *
 * Each handler takes the method's arguments and returns its result, or a promise of it, or the result wrapped by
 * {@link withTransfer} to transfer buffers back instead of copying them. Declare the handlers as methods or `function`
 * expressions, not arrow functions, when they need `this`.
 *
 * @typeParam TApi - The API type.
 */
export type WorkerApiHandlers<TApi extends WorkerApi<TApi>> = {
  readonly [TMethod in keyof TApi]: (
    this: WorkerCallContext,
    ...parameters: Parameters<TApi[TMethod]>
  ) => WorkerHandlerResult<Awaited<ReturnType<TApi[TMethod]>>>;
};

/**
 * The context of one call, passed to a handler as `this`.
 */
export interface WorkerCallContext {
  /**
   * Aborted when the caller cancels the call. A long handler checks it between steps; nothing interrupts a synchronous
   * loop, so a job that cannot check it is stopped only by terminating the worker.
   */
  readonly abortSignal: AbortSignal;
}

/**
 * A call from the main thread.
 */
export interface WorkerCallMessage {
  /**
   * The method's arguments.
   */
  readonly arguments: readonly unknown[];

  /**
   * The call id, unique per `WorkerComponent`.
   */
  readonly id: number;

  /**
   * The message kind.
   */
  readonly kind: 'call';

  /**
   * The method name.
   */
  readonly method: string;

  /**
   * The protocol tag.
   */
  readonly protocol: typeof WORKER_PROTOCOL;
}

/**
 * A cancellation of a call from the main thread.
 */
export interface WorkerCancelMessage {
  /**
   * The id of the call to cancel.
   */
  readonly id: number;

  /**
   * The message kind.
   */
  readonly kind: 'cancel';

  /**
   * The protocol tag.
   */
  readonly protocol: typeof WORKER_PROTOCOL;
}

/**
 * A failed call, answered by the worker.
 */
export interface WorkerErrorMessage {
  /**
   * The error, reduced to plain data.
   */
  readonly error: SerializedWorkerError;

  /**
   * The id of the call.
   */
  readonly id: number;

  /**
   * The message kind.
   */
  readonly kind: 'error';

  /**
   * The protocol tag.
   */
  readonly protocol: typeof WORKER_PROTOCOL;
}

/**
 * What a handler may return.
 *
 * @typeParam TResult - The method's result type.
 */
export type WorkerHandlerResult<TResult> = Promise<TransferredValue<TResult> | TResult> | TransferredValue<TResult> | TResult;

/**
 * The port a worker talks through: the worker's global scope, or a test double.
 */
export interface WorkerMessagePort {
  /**
   * Subscribes to messages.
   *
   * @param type - Always `message`.
   * @param listener - The listener.
   */
  readonly addEventListener: (type: 'message', listener: ($event: MessageEvent<unknown>) => void) => void;

  /**
   * Posts a message.
   *
   * @param message - The message.
   * @param transfer - The objects to transfer.
   */
  readonly postMessage: (message: unknown, transfer: Transferable[]) => void;
}

/**
 * Any message sent to the worker.
 */
export type WorkerRequestMessage = WorkerCallMessage | WorkerCancelMessage;

/**
 * Any message sent by the worker.
 */
export type WorkerResponseMessage = WorkerErrorMessage | WorkerResultMessage;

/**
 * A successful call, answered by the worker.
 */
export interface WorkerResultMessage {
  /**
   * The id of the call.
   */
  readonly id: number;

  /**
   * The message kind.
   */
  readonly kind: 'result';

  /**
   * The protocol tag.
   */
  readonly protocol: typeof WORKER_PROTOCOL;

  /**
   * The result.
   */
  readonly value: unknown;
}

interface ProtocolTaggedMessage {
  readonly protocol?: unknown;
}

/**
 * Exposes handlers to the main thread. Call it once, at the top level of a worker entry point.
 *
 * A handler that throws or rejects answers with a {@link SerializedWorkerError}, which the caller receives as a
 * `WorkerCallError`. An unknown method answers with an error too, so a caller never waits for nothing.
 *
 * @typeParam TApi - The API type.
 * @param handlers - The handlers.
 * @param port - The port to talk through. Defaults to the worker's global scope.
 */
export function exposeWorkerApi<TApi extends WorkerApi<TApi>>(handlers: WorkerApiHandlers<TApi>, port?: WorkerMessagePort): void {
  const messagePort = port ?? getWorkerGlobalScope();
  const abortControllers = new Map<number, AbortController>();

  messagePort.addEventListener('message', ($event): void => {
    const message = $event.data;
    if (!isWorkerRequestMessage(message)) {
      return;
    }

    if (message.kind === 'cancel') {
      abortControllers.get(message.id)?.abort(new Error('The call was cancelled'));
      return;
    }

    const abortController = new AbortController();
    abortControllers.set(message.id, abortController);
    // eslint-disable-next-line no-void -- `answerCall` never rejects: it answers every failure as a message.
    void answerCall(message, abortController.signal);
  });

  async function answerCall(message: WorkerCallMessage, abortSignal: AbortSignal): Promise<void> {
    let response: WorkerResponseMessage;
    try {
      const value = await invokeWorkerHandler(handlers, message.method, message.arguments, { abortSignal });
      response = { id: message.id, kind: 'result', protocol: WORKER_PROTOCOL, value };
    } catch (error) {
      response = { error: serializeWorkerError(error), id: message.id, kind: 'error', protocol: WORKER_PROTOCOL };
    }
    abortControllers.delete(message.id);
    postResponse(messagePort, response);
  }
}

/**
 * Calls one handler by name, as the worker does. `WorkerComponent` uses it for its main-thread fallback, so both paths
 * behave alike.
 *
 * @param handlers - The handlers.
 * @param method - The method name.
 * @param callArguments - The arguments.
 * @param context - The call context.
 * @returns The result, or a {@link TransferredValue} wrapping it.
 */
export async function invokeWorkerHandler(
  handlers: object,
  method: string,
  callArguments: readonly unknown[],
  context: WorkerCallContext
): Promise<unknown> {
  const handler = Object.hasOwn(handlers, method) ? (handlers as Record<string, unknown>)[method] : undefined;
  if (typeof handler !== 'function') {
    throw new TypeError(`The worker exposes no method named '${method}'`);
  }
  return await (handler as (this: WorkerCallContext, ...handlerArguments: unknown[]) => unknown).apply(context, [...callArguments]);
}

/**
 * Tells whether a value is a {@link TransferredValue}.
 *
 * @param value - The value.
 * @returns Whether it is one.
 */
export function isTransferredValue(value: unknown): value is TransferredValue<unknown> {
  return typeof value === 'object' && value !== null && (value as Partial<TransferredValue<unknown>>).__obsidianLibTransferredValue === true;
}

/**
 * Tells whether a message is a request of this protocol.
 *
 * @param message - The message.
 * @returns Whether it is one.
 */
export function isWorkerRequestMessage(message: unknown): message is WorkerRequestMessage {
  if (!hasProtocol(message)) {
    return false;
  }
  const candidate = message as Partial<WorkerCallMessage> | Partial<WorkerCancelMessage>;
  if (typeof candidate.id !== 'number') {
    return false;
  }
  if (candidate.kind === 'cancel') {
    return true;
  }
  return candidate.kind === 'call' && typeof candidate.method === 'string' && Array.isArray(candidate.arguments);
}

/**
 * Tells whether a message is a response of this protocol.
 *
 * @param message - The message.
 * @returns Whether it is one.
 */
export function isWorkerResponseMessage(message: unknown): message is WorkerResponseMessage {
  if (!hasProtocol(message)) {
    return false;
  }
  const candidate = message as Partial<WorkerErrorMessage> | Partial<WorkerResultMessage>;
  if (typeof candidate.id !== 'number') {
    return false;
  }
  if (candidate.kind === 'result') {
    return true;
  }
  return candidate.kind === 'error' && typeof candidate.error === 'object';
}

/**
 * Reduces a thrown value to plain data.
 *
 * @param error - The thrown value.
 * @returns The serialized error.
 */
export function serializeWorkerError(error: unknown): SerializedWorkerError {
  if (!(error instanceof Error)) {
    return { message: String(error), name: 'Error' };
  }
  return error.stack === undefined
    ? { message: error.message, name: error.name }
    : { message: error.message, name: error.name, stack: error.stack };
}

/**
 * Splits a result into the value to post and the objects to transfer.
 *
 * @param result - A result, possibly wrapped by {@link withTransfer}.
 * @returns The value and its transfer list.
 */
export function unwrapTransferredValue(result: unknown): UnwrappedTransferredValue {
  return isTransferredValue(result)
    ? { transfer: [...result.transfer], value: result.value }
    : { transfer: [], value: result };
}

/**
 * Marks a result to transfer some of its objects (an `ArrayBuffer`, a `MessagePort`, an `OffscreenCanvas`...) instead
 * of copying them. A transferred object is unusable on the sending side afterwards.
 *
 * @typeParam TValue - The value type.
 * @param value - The value.
 * @param transfer - The objects inside it to transfer.
 * @returns The wrapped value.
 */
export function withTransfer<TValue>(value: TValue, transfer: readonly Transferable[]): TransferredValue<TValue> {
  return { __obsidianLibTransferredValue: true, transfer, value };
}

function getWorkerGlobalScope(): WorkerMessagePort {
  // eslint-disable-next-line obsidianmd/no-global-this -- A worker has no `window`: its global scope is the port.
  const scope: unknown = globalThis;
  return scope as WorkerMessagePort;
}

function hasProtocol(message: unknown): boolean {
  return typeof message === 'object' && message !== null && (message as ProtocolTaggedMessage).protocol === WORKER_PROTOCOL;
}

function postResponse(port: WorkerMessagePort, response: WorkerResponseMessage): void {
  if (response.kind === 'error') {
    port.postMessage(response, []);
    return;
  }
  const { transfer, value } = unwrapTransferredValue(response.value);
  try {
    port.postMessage({ ...response, value }, transfer);
  } catch (error) {
    // A result that cannot be cloned (a function, a DOM node) still answers, so the caller is never left waiting.
    port.postMessage({ error: serializeWorkerError(error), id: response.id, kind: 'error', protocol: WORKER_PROTOCOL }, []);
  }
}
