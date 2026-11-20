/**
 * @file
 *
 * Pins the desktop answer on shared memory for {@link WorkerComponent}: the renderer is not cross-origin isolated, yet
 * `SharedArrayBuffer` exists and a write from a worker is seen on the main thread. Android answers the opposite, which
 * `worker-component.android.obsidian.integration.test.ts` pins.
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

interface SharedMemoryInput {
  readonly [key: string]: unknown;
  readonly source: string;
}

interface SharedMemoryProbe {
  readonly hasSharedArrayBuffer: boolean;
  readonly isCrossOriginIsolated: boolean;
  readonly sharedMemoryResult: string;
}

const WORKER_ENTRY = `
import { exposeWorkerApi } from './src/worker-protocol.ts';

exposeWorkerApi({
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
  it('shares a SharedArrayBuffer with a worker though the renderer is not cross-origin isolated', async () => {
    const probe = await evalInObsidian<SharedMemoryInput, SharedMemoryProbe>({
      async callback({ lib: { WorkerComponent }, source }): Promise<SharedMemoryProbe> {
        interface Api {
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
            hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
            isCrossOriginIsolated: window.crossOriginIsolated,
            sharedMemoryResult
          };
        } finally {
          component.unload();
        }
      },
      input: { source: workerSource }
    });

    expect(probe).toEqual({
      hasSharedArrayBuffer: true,
      isCrossOriginIsolated: false,
      sharedMemoryResult: 'shared write seen: 7'
    });
  });
});
