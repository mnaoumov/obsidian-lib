/**
 * @file
 *
 * Integration tests for {@link WorkerComponent} and the WebAssembly helpers inside a live Obsidian renderer.
 *
 * The unit tests run both ends of the protocol in one realm. What only a real renderer shows is that a Blob-URL worker
 * starts from bundled source, that the call and cancel messages and a compiled `WebAssembly.Module` survive the
 * structured clone, and which of the off-main-thread APIs the guide weighs Obsidian actually provides.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { build } from 'esbuild';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

interface EnvironmentProbe {
  readonly hasBroadcastChannel: boolean;
  readonly hasOffscreenCanvas: boolean;
  readonly hasRequestIdleCallback: boolean;
  readonly hasSharedArrayBuffer: boolean;
  readonly isCrossOriginIsolated: boolean;
  readonly sharedMemoryResult: string;
  readonly workerProbe: WorkerProbe;
}

interface ProbeInput {
  readonly [key: string]: unknown;
  readonly source: string;
}

interface RoundTripInput {
  readonly hex: string;
  readonly [key: string]: unknown;
  readonly source: string;
}

interface WorkerProbe {
  readonly hasIndexedDatabase: boolean;
  readonly hasOffscreenCanvas: boolean;
}

interface WorkerRoundTrip {
  readonly abortMessage: string;
  readonly doubled: number;
  readonly errorName: string;
  readonly errorRemoteName: string;
  readonly isTerminatedCallRejected: boolean;
  readonly transferredByteLength: number;
  readonly wasCancelSeenByHandler: boolean;
  readonly wasmAnswer: number;
  readonly wasmAnswerOnMainThread: number;
}

// `(module (func (export "answer") (result i32) i32.const 42))`, as hexadecimal bytes.
const ANSWER_MODULE_HEX = '0061736d010000000105016000017f03020100070a0106616e7377657200000a06010400412a0b';

// The worker entry point a plugin would write, bundled the way the toolkit's `workers` feature bundles one.
const WORKER_ENTRY = `
import { exposeWorkerApi, withTransfer } from './src/worker-protocol.ts';
import { instantiateWasmModule } from './src/wasm.ts';

let lastCancelSeen = false;

exposeWorkerApi({
  double: (value) => value * 2,
  fail: () => { throw new RangeError('worker boom'); },
  async hang() {
    await new Promise((resolve) => { this.abortSignal.addEventListener('abort', resolve, { once: true }); });
    lastCancelSeen = this.abortSignal.aborted;
    return 'cancelled';
  },
  makeBuffer: (byteLength) => { const buffer = new ArrayBuffer(byteLength); return withTransfer(buffer, [buffer]); },
  probe: () => ({ hasIndexedDatabase: typeof indexedDB !== 'undefined', hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined' }),
  wasCancelSeen: () => lastCancelSeen,
  async wasmAnswer(compiledModule) { const wasm = await instantiateWasmModule(compiledModule); return wasm.exports.answer(); },
  writeShared: (shared) => { Atomics.store(new Int32Array(shared), 0, 7); return true; }
});
`;

let workerSource = '';

beforeAll(async () => {
  const result = await build({
    bundle: true,
    format: 'iife',
    platform: 'browser',
    // eslint-disable-next-line unicorn/name-replacements -- `resolveDir` is esbuild's option name.
    stdin: { contents: WORKER_ENTRY, loader: 'ts', resolveDir: process.cwd() },
    target: 'es2018',
    write: false
  });
  workerSource = result.outputFiles[0]?.text ?? '';
});

describe('WorkerComponent', () => {
  it('runs calls, errors, transfers, cancellation and a compiled WebAssembly module through a real worker', async () => {
    const result = await evalInObsidian<RoundTripInput, WorkerRoundTrip>({
      async callback({ hex, lib: { compileWasmModule, instantiateWasmModule, WorkerCallError, WorkerComponent }, source }): Promise<WorkerRoundTrip> {
        interface Api {
          readonly double: (value: number) => number;
          readonly fail: () => never;
          readonly hang: () => Promise<string>;
          readonly makeBuffer: (byteLength: number) => ArrayBuffer;
          readonly wasCancelSeen: () => boolean;
          readonly wasmAnswer: (compiledModule: WebAssembly.Module) => number;
        }
        interface AnswerExports extends WebAssembly.Exports {
          readonly answer: () => number;
        }
        const component = new WorkerComponent<Api>({ name: 'integration worker', source });
        component.load();
        try {
          const doubled = await component.call('double', [21]);
          let errorName = '';
          let errorRemoteName = '';
          try {
            await component.call('fail', []);
          } catch (error) {
            if (error instanceof WorkerCallError) {
              errorName = error.name;
              errorRemoteName = error.remoteName;
            }
          }
          const buffer = await component.call('makeBuffer', [16]);

          const abortController = new AbortController();
          const hanging = component.call('hang', [], { abortSignal: abortController.signal });
          abortController.abort(new Error('stop'));
          let abortMessage = '';
          try {
            await hanging;
          } catch (error) {
            abortMessage = (error as Error).message;
          }
          const wasCancelSeenByHandler = await component.call('wasCancelSeen', []);

          const wasmBytes = new Uint8Array((hex.match(/../gu) ?? []).map((pair) => Number.parseInt(pair, 16)));
          const compiledModule = await compileWasmModule(wasmBytes);
          const wasmAnswer = await component.call('wasmAnswer', [compiledModule]);
          const wasm = await instantiateWasmModule<AnswerExports>(wasmBytes);
          const wasmAnswerOnMainThread = wasm.exports.answer();

          const pending = component.call('hang', []);
          component.unload();
          let isTerminatedCallRejected = false;
          try {
            await pending;
          } catch {
            isTerminatedCallRejected = true;
          }

          return {
            abortMessage,
            doubled,
            errorName,
            errorRemoteName,
            isTerminatedCallRejected,
            transferredByteLength: buffer.byteLength,
            wasCancelSeenByHandler,
            wasmAnswer,
            wasmAnswerOnMainThread
          };
        } finally {
          component.unload();
        }
      },
      input: { hex: ANSWER_MODULE_HEX, source: workerSource }
    });

    expect(result).toEqual({
      abortMessage: 'stop',
      doubled: 42,
      errorName: 'WorkerCallError',
      errorRemoteName: 'RangeError',
      isTerminatedCallRejected: true,
      transferredByteLength: 16,
      wasCancelSeenByHandler: true,
      wasmAnswer: 42,
      wasmAnswerOnMainThread: 42
    });
  });

  it('pins the off-main-thread APIs the guide documents', async () => {
    const probe = await evalInObsidian<ProbeInput, EnvironmentProbe>({
      async callback({ lib: { WorkerComponent }, source }): Promise<EnvironmentProbe> {
        interface ProbedWorker {
          readonly hasIndexedDatabase: boolean;
          readonly hasOffscreenCanvas: boolean;
        }
        interface Api {
          readonly probe: () => ProbedWorker;
          readonly writeShared: (shared: SharedArrayBuffer) => boolean;
        }
        const component = new WorkerComponent<Api>({ source });
        component.load();
        try {
          let sharedMemoryResult: string;
          try {
            const shared = new SharedArrayBuffer(4);
            await component.call('writeShared', [shared]);
            sharedMemoryResult = `shared write seen: ${String(Atomics.load(new Int32Array(shared), 0))}`;
          } catch (error) {
            sharedMemoryResult = `refused: ${(error as Error).name}`;
          }
          return {
            hasBroadcastChannel: typeof BroadcastChannel !== 'undefined',
            hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
            hasRequestIdleCallback: typeof window.requestIdleCallback === 'function',
            hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
            isCrossOriginIsolated: window.crossOriginIsolated,
            sharedMemoryResult,
            workerProbe: await component.call('probe', [])
          };
        } finally {
          component.unload();
        }
      },
      input: { source: workerSource }
    });

    expect(probe).toEqual({
      hasBroadcastChannel: true,
      hasOffscreenCanvas: true,
      hasRequestIdleCallback: true,
      hasSharedArrayBuffer: true,
      isCrossOriginIsolated: false,
      sharedMemoryResult: 'shared write seen: 7',
      workerProbe: { hasIndexedDatabase: true, hasOffscreenCanvas: true }
    });
  });
});
