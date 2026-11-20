/**
 * @file
 *
 * Pins the Android answer on shared memory for {@link WorkerComponent}: the Obsidian WebView is not cross-origin
 * isolated and, unlike desktop, does not define `SharedArrayBuffer` at all, in the renderer or in a worker. Desktop
 * answers the opposite, which `worker-component.desktop.obsidian.integration.test.ts` pins.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface SharedMemoryProbe {
  readonly hasAtomics: boolean;
  readonly hasSharedArrayBuffer: boolean;
  readonly hasSharedArrayBufferInWorker: boolean;
  readonly isCrossOriginIsolated: boolean;
}

// A worker that answers whether it sees `SharedArrayBuffer`; it needs no protocol, so it is not bundled.
const WORKER_SOURCE = 'postMessage(typeof SharedArrayBuffer !== \'undefined\');';

describe('WorkerComponent', () => {
  it('has no SharedArrayBuffer on Android, in the renderer or in a worker', async () => {
    const probe = await evalInObsidian({
      async callback({ source }): Promise<SharedMemoryProbe> {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        try {
          const hasSharedArrayBufferInWorker = await new Promise<boolean>((resolve, reject) => {
            worker.addEventListener('message', ($event: MessageEvent<boolean>) => {
              resolve($event.data);
            }, { once: true });
            worker.addEventListener('error', ($event) => {
              reject(new Error($event.message));
            }, { once: true });
          });
          return {
            hasAtomics: typeof Atomics !== 'undefined',
            hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
            hasSharedArrayBufferInWorker,
            isCrossOriginIsolated: window.crossOriginIsolated
          };
        } finally {
          worker.terminate();
          URL.revokeObjectURL(url);
        }
      },
      input: { source: WORKER_SOURCE }
    });

    expect(probe).toEqual({
      hasAtomics: true,
      hasSharedArrayBuffer: false,
      hasSharedArrayBufferInWorker: false,
      isCrossOriginIsolated: false
    });
  });
});
