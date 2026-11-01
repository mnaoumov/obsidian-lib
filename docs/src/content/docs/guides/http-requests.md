---
title: HTTP requests
description: Request a URL without CORS, with a timeout, an abort signal, FormData bodies, a streamed response and a fetch adapter for SDKs.
---

Obsidian's `requestUrl` reaches any URL without CORS restrictions, but it cannot be aborted, has no timeout, takes only a `string` or `ArrayBuffer` body, buffers the whole response, and hangs on a URL it cannot handle. `@mnaoumov/obsidian-lib/request-url` wraps it with the missing parts, and every helper there works on desktop and mobile.

## `requestUrlEx`

`requestUrlEx` takes the same request as `requestUrl`, plus an `abortSignal` and a `timeoutInMilliseconds`, and a `body` that may be anything `fetch` accepts: a `string`, an `ArrayBuffer`, a typed array, a `Blob` or `File`, `URLSearchParams`, `FormData` or a `ReadableStream`.

```ts
import { requestUrlEx } from '@mnaoumov/obsidian-lib/request-url';

const formData = new FormData();
formData.append('note', new File(['# Title'], 'note.md', { type: 'text/markdown' }));

const response = await requestUrlEx({
  body: formData,
  method: 'POST',
  timeoutInMilliseconds: 10_000,
  url: 'https://example.com/upload'
});
console.log(response.json);
```

A `FormData` body is encoded as `multipart/form-data` and gets the `Content-Type` with its boundary. A `URLSearchParams` body gets `application/x-www-form-urlencoded`, and a `Blob` body its own type. A `Content-Type` header or a `contentType` you pass yourself wins over the derived one.

The URL is checked before anything is sent: one that does not parse, or whose protocol is not `http:` or `https:` (an `app://` resource URL, a missing scheme), rejects at once with a `TypeError`, where `requestUrl` would never settle.

An abort or a timeout rejects the promise at once with the signal's reason, a `TimeoutError` `DOMException` for the timeout. `requestUrl` itself cannot be cancelled, so the request still runs to its end in the background and its result is dropped. Use `requestUrlStream` on desktop when the request itself has to stop.

## `RequestUrlError`

A status of 400 or higher throws a `RequestUrlError`, which carries the `status`, the response `headers`, the body as `text` and a `json()` parser, beside the `method` and the `url`. Its message names all of them, with the body shortened to 200 characters. Pass `shouldThrowOnHttpError: false` to get the response back instead.

```ts
import {
  RequestUrlError,
  requestUrlEx
} from '@mnaoumov/obsidian-lib/request-url';

try {
  await requestUrlEx({ url: 'https://api.example.com/items/42' });
} catch (error) {
  if (error instanceof RequestUrlError && error.status === 404) {
    console.log('Not found:', error.text);
  } else {
    throw error;
  }
}
```

## `requestUrlStream`

`requestUrlStream` takes the same parameters and returns the `status`, the `headers`, the final `url` and the body as a `ReadableStream<Uint8Array>`. Use it for server-sent events, a model's token stream or a large download.

```ts
import { requestUrlStream } from '@mnaoumov/obsidian-lib/request-url';

const response = await requestUrlStream({ url: 'https://example.com/events' });
const reader = response.body.getReader();
const textDecoder = new TextDecoder();
for (;;) {
  const result = await reader.read();
  if (result.done) {
    break;
  }
  console.log(textDecoder.decode(result.value, { stream: true }));
}
```

On desktop the request goes through `node:http` / `node:https`: the body arrives as the server sends it, an abort really closes the connection, and redirects are followed the way `fetch` follows them. Node does not read the system proxy settings or certificate store, so on a machine that reaches the internet only through a proxy, or that intercepts TLS with its own root certificate, use `requestUrlEx` instead.

On mobile there is no way to stream, so it falls back to `requestUrl` and the whole body arrives as one chunk. Code written against the stream works on both.

## `createRequestUrlFetch`

Many SDKs (OpenAI, Anthropic, LangChain, OAuth clients) take a custom `fetch`. `createRequestUrlFetch` returns one built on `requestUrl`, so the SDK's requests skip CORS. Like `fetch`, it resolves with an error status rather than rejecting, honours the request's `signal`, and takes a `Request` or a `URL` as well as a string.

<!-- snippet-check: context declare class ApiClient { public constructor(options: { fetch: typeof fetch }); } -->

```ts
import { createRequestUrlFetch } from '@mnaoumov/obsidian-lib/request-url';

const client = new ApiClient({
  fetch: createRequestUrlFetch({ shouldStream: true, timeoutInMilliseconds: 60_000 })
});
```

`shouldStream: true` builds each response on `requestUrlStream`, which an SDK that streams its answers needs; leave it off to buffer each response through `requestUrlEx`. `timeoutInMilliseconds` applies to every request, on top of the request's own signal.
