---
title: Workers and WebAssembly
description: Run CPU-bound work in a Web Worker and load inlined WebAssembly modules, with typed calls, cancellation and cleanup on unload.
---

`@mnaoumov/obsidian-dev-toolkit` already handles the build half. With its `workers` feature on, `import source from './search.worker.ts?worker-source'` gives the bundled worker as a string, and with `wasm` on, `import bytes from './module.wasm'` gives the module's bytes as a `Uint8Array`. Both are inlined into `main.js`, because a community plugin installs no other script. This library supplies the runtime half: it starts the worker, calls it with types, cancels calls, compiles the module, and cleans everything up when the plugin unloads.

## The worker side

The worker entry point exposes its handlers with `exposeWorkerApi` from `@mnaoumov/obsidian-lib/worker-protocol`. That module imports nothing, so it bundles into a worker, which has no `obsidian` module and no Node builtins. Declare the API once as a type that both sides share:

```ts
import type { WorkerApiHandlers } from '@mnaoumov/obsidian-lib/worker-protocol';

import {
  exposeWorkerApi,
  withTransfer
} from '@mnaoumov/obsidian-lib/worker-protocol';

export interface SearchApi {
  readonly count: (text: string, needle: string) => number;
  readonly encode: (text: string) => ArrayBuffer;
}

const handlers: WorkerApiHandlers<SearchApi> = {
  count(text, needle) {
    let total = 0;
    for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
      this.abortSignal.throwIfAborted();
      total++;
    }
    return total;
  },
  encode(text) {
    const buffer = new TextEncoder().encode(text).buffer;
    return withTransfer(buffer, [buffer]);
  }
};

exposeWorkerApi(handlers);
```

A handler receives the call's arguments and returns its result, a promise of it, or the result wrapped by `withTransfer` to move a buffer back instead of copying it. Its `this` is the call context, whose `abortSignal` aborts when the caller cancels, so write the handlers as methods rather than arrow functions when they need it. Nothing can interrupt a synchronous loop that does not check the signal: only terminating the worker stops it.

## The main thread: `WorkerComponent`

<!-- snippet-check: context declare const plugin: import('obsidian').Plugin; declare const source: string; interface SearchApi { readonly count: (text: string, needle: string) => number; readonly encode: (text: string) => ArrayBuffer; } declare const handlers: import('@mnaoumov/obsidian-lib/worker-protocol').WorkerApiHandlers<SearchApi>; declare const abortSignal: AbortSignal; -->

```ts
import { WorkerComponent } from '@mnaoumov/obsidian-lib/components/worker-component';

const searchWorker = plugin.addChild(new WorkerComponent<SearchApi>({
  fallbackHandlers: handlers,
  name: 'search',
  source
}));

const total = await searchWorker.call('count', ['some long text', 'o'], { abortSignal });
```

On load the component turns the source into a Blob URL and starts the worker. On unload it terminates the worker, revokes the URL and rejects every pending call, so add it as a child of whatever uses it and the worker never outlives that. `call` is typed by the API: the method name, its argument tuple and its awaited result.

- **Errors.** A handler that throws rejects the call with a `WorkerCallError` carrying the worker-side `remoteName`, message and `remoteStack`, because an `Error` loses its class on the way across. An unknown method is an error too. A worker whose script fails, or throws uncaught, rejects every pending call, and so does a message the main thread cannot deserialize.
- **Cancellation.** An aborted `abortSignal` rejects the call at once with the signal's reason, and the worker's handler sees its own `this.abortSignal` aborted. Whatever the handler answers afterwards is dropped.
- **Transfers.** `transfer` in the call options moves buffers into the worker rather than copying them. They are detached on the main thread afterwards.
- **Fallback.** `fallbackHandlers` are the same handlers run on the main thread when no `Worker` can be created. `isUsingFallback` says which path is in use. Without them, a failure to create the worker fails the component's load.

A worker built from a Blob URL is not tied to a window, so one created in the main window keeps serving after a popout opens or closes.

## Pools: `WorkerPoolComponent`

<!-- snippet-check: context declare const plugin: import('obsidian').Plugin; declare const source: string; interface SearchApi { readonly count: (text: string, needle: string) => number; } declare const chunks: readonly string[]; -->

```ts
import { WorkerPoolComponent } from '@mnaoumov/obsidian-lib/components/worker-pool-component';

const pool = plugin.addChild(new WorkerPoolComponent<SearchApi>({ name: 'search', source }));
const totals = await Promise.all(chunks.map(async (chunk) => await pool.call('count', [chunk, 'o'])));
```

The pool owns `size` workers and sends each call to the worker with the fewest pending calls. By default the size is one fewer than the logical processors, between 1 and 4, from `getDefaultWorkerPoolSize`. `callAll` calls every worker with the same arguments, for instance to configure them. A job that keeps state in a particular worker, such as a share of a corpus, addresses it with `getWorker(index)`.

## WebAssembly

`@mnaoumov/obsidian-lib/wasm` also imports nothing, so the same helpers work on the main thread and inside a worker.

<!-- snippet-check: context declare const bytes: Uint8Array; -->

```ts
import {
  compileWasmModule,
  instantiateWasmModule
} from '@mnaoumov/obsidian-lib/wasm';

interface AnswerExports extends WebAssembly.Exports {
  readonly answer: () => number;
}

const compiledModule = await compileWasmModule(bytes);
const { exports } = await instantiateWasmModule<AnswerExports>(compiledModule);
const answer = exports.answer();
```

`compileWasmModule` compiles once per bytes object. The constant an inlined `.wasm` import gives is therefore compiled once however often it is asked for, and the compiled module goes with that constant when the plugin unloads. A failed compilation is not cached. `instantiateWasmModule` takes the bytes or a compiled module and makes a new instance with its own memory each time. The exports type is not checked against the module.

A compiled `WebAssembly.Module` survives the structured clone, so compile once on the main thread and pass the module to a worker as a call argument. The worker then instantiates it with the same `instantiateWasmModule`, and no worker compiles the bytes again.

Nothing frees a WebAssembly instance's memory explicitly. It goes once nothing references the instance, so keep instances in fields that are cleared on unload, not at module scope. A worker's instances go with the worker when its component unloads.

## Other off-main-thread APIs

These were weighed for helpers of their own. `worker-component.obsidian.integration.test.ts` checks each answer below in a real renderer, so a change in Obsidian turns that test red.

- **`SharedArrayBuffer` and `Atomics`** work on desktop even though the renderer is not cross-origin isolated (`crossOriginIsolated` is `false`): Electron turns the feature on, and a worker's `Atomics.store` into a shared buffer passed as a call argument is visible on the main thread. That is a desktop fact only, because a mobile WebView without cross-origin isolation is not known to provide it. A plugin that also runs on mobile checks `typeof SharedArrayBuffer` and falls back to transferring buffers.
- **`OffscreenCanvas`** exists on the main thread and in workers, so a canvas can be drawn in a worker with no wrapper: transfer it with the call's `transfer`.
- **`indexedDB`** is available inside a worker. For plugin data, prefer this library's data stores, which own their schema and lifetime.
- **`requestIdleCallback`** is available. For background indexing that should yield to the user, schedule with it, or run the work in a worker.
- **`BroadcastChannel`** exists. Popouts share one `App`, so plain events on `app.workspace` usually do the same job between windows without a channel.

None of these has a helper yet, because no two plugins built on this library need the same one.
