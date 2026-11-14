/**
 * @file
 *
 * Tests for the worker message protocol.
 */

import { noop } from '@mnaoumov/typescript-lib/function';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  WorkerCallContext,
  WorkerMessagePort
} from './worker-protocol.ts';

import {
  exposeWorkerApi,
  invokeWorkerHandler,
  isTransferredValue,
  isWorkerRequestMessage,
  isWorkerResponseMessage,
  serializeWorkerError,
  unwrapTransferredValue,
  withTransfer,
  WORKER_PROTOCOL
} from './worker-protocol.ts';

interface CreatePortOptions {
  readonly shouldThrowOnTransfer?: boolean;
}

interface PostedMessage {
  readonly message: unknown;
  readonly transfer: Transferable[];
}

interface PostedSummary {
  readonly error: null | string;
  readonly id: number;
  readonly transfer: Transferable[];
  readonly value: unknown;
}

interface TestApi {
  readonly add: (left: number, right: number) => number;
  readonly bytes: () => ArrayBuffer;
  readonly fail: () => never;
  readonly returnFunction: () => () => void;
  readonly wait: () => Promise<string>;
}

interface TestPort extends WorkerMessagePort {
  readonly posted: unknown[];
  readonly send: (data: unknown) => void;
}

interface ValueMessage {
  readonly value?: unknown;
}

interface WaitApi {
  readonly wait: () => Promise<boolean>;
}

function createPort(options: CreatePortOptions = {}): TestPort {
  const listeners: (($event: MessageEvent<unknown>) => void)[] = [];
  const posted: unknown[] = [];
  return {
    addEventListener: (_type, listener): void => {
      listeners.push(listener);
    },
    posted,
    postMessage: (message, transfer): void => {
      if (options.shouldThrowOnTransfer && typeof (message as ValueMessage).value === 'function') {
        throw new Error('could not be cloned');
      }
      posted.push({ message, transfer });
    },
    send: (data): void => {
      for (const listener of listeners) {
        listener(new MessageEvent('message', { data }));
      }
    }
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function summarizePosted(posted: unknown): PostedSummary {
  const { message, transfer } = posted as PostedMessage;
  if (!isWorkerResponseMessage(message)) {
    throw new Error('Not a response');
  }
  return message.kind === 'error'
    ? { error: `${message.error.name}: ${message.error.message}`, id: message.id, transfer, value: undefined }
    : { error: null, id: message.id, transfer, value: message.value };
}

describe('exposeWorkerApi', () => {
  it('answers calls, errors, transfers and unknown methods', async () => {
    const port = createPort({ shouldThrowOnTransfer: true });
    const buffer = new ArrayBuffer(4);
    exposeWorkerApi<TestApi>({
      add: (left, right) => left + right,
      bytes: () => withTransfer(buffer, [buffer]),
      fail: () => {
        throw new Error('boom');
      },
      returnFunction: () => (): void => undefined,
      wait: async () => {
        await flush();
        return 'done';
      }
    }, port);

    port.send({ arguments: [1, 2], id: 1, kind: 'call', method: 'add', protocol: WORKER_PROTOCOL });
    port.send({ arguments: [], id: 2, kind: 'call', method: 'bytes', protocol: WORKER_PROTOCOL });
    port.send({ arguments: [], id: 3, kind: 'call', method: 'fail', protocol: WORKER_PROTOCOL });
    port.send({ arguments: [], id: 4, kind: 'call', method: 'missing', protocol: WORKER_PROTOCOL });
    port.send({ arguments: [], id: 5, kind: 'call', method: 'returnFunction', protocol: WORKER_PROTOCOL });
    port.send({ arguments: [], id: 6, kind: 'call', method: 'wait', protocol: WORKER_PROTOCOL });
    port.send({ foreign: true });
    await flush();

    const summaries = port.posted.map((posted) => summarizePosted(posted)).sort((left, right) => left.id - right.id);
    expect(summaries).toEqual([
      { error: null, id: 1, transfer: [], value: 3 },
      { error: null, id: 2, transfer: [buffer], value: buffer },
      { error: 'Error: boom', id: 3, transfer: [], value: undefined },
      { error: 'TypeError: The worker exposes no method named \'missing\'', id: 4, transfer: [], value: undefined },
      { error: 'Error: could not be cloned', id: 5, transfer: [], value: undefined },
      { error: null, id: 6, transfer: [], value: 'done' }
    ]);
  });
  it('aborts the handler signal on cancel and ignores a cancel for an unknown call', async () => {
    const port = createPort();
    let signal: AbortSignal | null = null;
    let release = noop;
    exposeWorkerApi<WaitApi>({
      async wait(this: WorkerCallContext): Promise<boolean> {
        signal = this.abortSignal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return this.abortSignal.aborted;
      }
    }, port);

    port.send({ arguments: [], id: 7, kind: 'call', method: 'wait', protocol: WORKER_PROTOCOL });
    port.send({ id: 99, kind: 'cancel', protocol: WORKER_PROTOCOL });
    port.send({ id: 7, kind: 'cancel', protocol: WORKER_PROTOCOL });
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    release();
    await flush();
    expect(port.posted).toEqual([{ message: { id: 7, kind: 'result', protocol: WORKER_PROTOCOL, value: true }, transfer: [] }]);
  });

  it('defaults to the global scope as its port', () => {
    const addEventListener = vi.spyOn(globalThis, 'addEventListener');
    exposeWorkerApi({});
    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    addEventListener.mockRestore();
  });
});

describe('invokeWorkerHandler', () => {
  it('refuses inherited members', async () => {
    await expect(invokeWorkerHandler({}, 'toString', [], { abortSignal: new AbortController().signal })).rejects.toThrow(TypeError);
  });
});

describe('message guards', () => {
  it('recognizes requests', () => {
    expect(isWorkerRequestMessage(null)).toBe(false);
    expect(isWorkerRequestMessage('text')).toBe(false);
    expect(isWorkerRequestMessage({ protocol: 'other' })).toBe(false);
    expect(isWorkerRequestMessage({ id: '1', kind: 'cancel', protocol: WORKER_PROTOCOL })).toBe(false);
    expect(isWorkerRequestMessage({ id: 1, kind: 'cancel', protocol: WORKER_PROTOCOL })).toBe(true);
    expect(isWorkerRequestMessage({ arguments: [], id: 1, kind: 'call', method: 'm', protocol: WORKER_PROTOCOL })).toBe(true);
    expect(isWorkerRequestMessage({ arguments: [], id: 1, kind: 'call', method: 1, protocol: WORKER_PROTOCOL })).toBe(false);
    expect(isWorkerRequestMessage({ arguments: 'x', id: 1, kind: 'call', method: 'm', protocol: WORKER_PROTOCOL })).toBe(false);
    expect(isWorkerRequestMessage({ id: 1, kind: 'other', protocol: WORKER_PROTOCOL })).toBe(false);
  });

  it('recognizes responses', () => {
    expect(isWorkerResponseMessage(undefined)).toBe(false);
    expect(isWorkerResponseMessage({ id: null, kind: 'result', protocol: WORKER_PROTOCOL })).toBe(false);
    expect(isWorkerResponseMessage({ id: 1, kind: 'result', protocol: WORKER_PROTOCOL })).toBe(true);
    expect(isWorkerResponseMessage({ error: {}, id: 1, kind: 'error', protocol: WORKER_PROTOCOL })).toBe(true);
    expect(isWorkerResponseMessage({ error: 'x', id: 1, kind: 'error', protocol: WORKER_PROTOCOL })).toBe(false);
    expect(isWorkerResponseMessage({ id: 1, kind: 'call', protocol: WORKER_PROTOCOL })).toBe(false);
  });
});

describe('serializeWorkerError', () => {
  it('keeps name, message and stack, and stringifies non-errors', () => {
    const error = new RangeError('out');
    expect(serializeWorkerError(error)).toEqual({ message: 'out', name: 'RangeError', stack: error.stack });
    const errorWithoutStack = new Error('plain');
    delete errorWithoutStack.stack;
    expect(serializeWorkerError(errorWithoutStack)).toEqual({ message: 'plain', name: 'Error' });
    expect(serializeWorkerError(42)).toEqual({ message: '42', name: 'Error' });
  });
});

describe('transferred values', () => {
  it('wraps and unwraps', () => {
    const buffer = new ArrayBuffer(1);
    const wrapped = withTransfer(buffer, [buffer]);
    expect(isTransferredValue(wrapped)).toBe(true);
    expect(isTransferredValue(null)).toBe(false);
    expect(isTransferredValue(1)).toBe(false);
    expect(unwrapTransferredValue(wrapped)).toEqual({ transfer: [buffer], value: buffer });
    expect(unwrapTransferredValue(5)).toEqual({ transfer: [], value: 5 });
  });
});
