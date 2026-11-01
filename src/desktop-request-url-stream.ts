/**
 * @file
 *
 * The desktop arm of {@link ./request-url.ts | requestUrlStream}: requests a URL through `node:http` /
 * `node:https`, so the response body streams as it arrives and an abort really cancels the request.
 *
 * Desktop only: it reads `node:http` and `node:https`. Reach it through `requestUrlStream`, which imports it
 * dynamically on desktop.
 *
 * Unlike Chromium's network stack, Node does not read the system proxy settings or certificate store, so a machine
 * that reaches the internet only through a proxy, or that intercepts TLS with its own root certificate, needs the
 * buffered `requestUrlEx` instead.
 */

/* eslint-disable n/no-unsupported-features/node-builtins -- ReadableStream is the Obsidian renderer's Web API, not a Node builtin. */

import type {
  IncomingHttpHeaders,
  IncomingMessage
} from 'node:http';

import { onAbort } from '@mnaoumov/typescript-lib/abort-controller';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';

import type {
  EncodedRequestUrlRequest,
  RequestUrlStreamResponse
} from './request-url.ts';

const MAX_REDIRECT_COUNT = 20;
const HTTP_MOVED_PERMANENTLY_STATUS = 301;
const HTTP_FOUND_STATUS = 302;
const HTTP_SEE_OTHER_STATUS = 303;
const HTTP_TEMPORARY_REDIRECT_STATUS = 307;
const HTTP_PERMANENT_REDIRECT_STATUS = 308;
const REDIRECT_STATUSES = new Set([
  HTTP_FOUND_STATUS,
  HTTP_MOVED_PERMANENTLY_STATUS,
  HTTP_PERMANENT_REDIRECT_STATUS,
  HTTP_SEE_OTHER_STATUS,
  HTTP_TEMPORARY_REDIRECT_STATUS
]);
const BODY_HEADERS = new Set(['content-length', 'content-type']);

interface SendRequestParams {
  readonly abortSignal: AbortSignal;
  readonly body: ArrayBuffer | string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly url: string;
}

/**
 * Requests a URL through `node:http` / `node:https` and returns its body as a stream, following redirects.
 *
 * @param request - The encoded request.
 * @returns The response, with a streamed body.
 */
export async function openDesktopRequestUrlStream(request: EncodedRequestUrlRequest): Promise<RequestUrlStreamResponse> {
  let currentRequest: SendRequestParams = {
    abortSignal: request.abortSignal,
    body: request.body,
    headers: request.headers,
    method: request.method,
    url: request.url
  };

  for (let redirectCount = 0;; redirectCount++) {
    const incomingMessage = await sendRequest(currentRequest);
    // A response to a client request always carries its status code.
    const status = ensureNonNullable(incomingMessage.statusCode);
    const location = incomingMessage.headers.location;
    if (!REDIRECT_STATUSES.has(status) || location === undefined) {
      return {
        body: createIncomingMessageStream(incomingMessage, request.abortSignal),
        headers: flattenHeaders(incomingMessage.headers),
        status,
        url: currentRequest.url
      };
    }

    incomingMessage.resume();
    if (redirectCount >= MAX_REDIRECT_COUNT) {
      throw new TypeError(`Too many redirects requesting ${request.url}`);
    }
    const nextUrl = new URL(location, currentRequest.url);
    if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
      throw new TypeError(`Unsupported protocol ${nextUrl.protocol} in the redirect to ${nextUrl.href}`);
    }
    currentRequest = getRedirectedRequest(currentRequest, status, nextUrl.href);
  }
}

function createIncomingMessageStream(incomingMessage: IncomingMessage, abortSignal: AbortSignal): ReadableStream<Uint8Array> {
  let isSettled = false;
  // Assigned in `start`, which runs inside the constructor, so it is in place before `cancel` can run.
  let abortListener: Disposable;
  return new ReadableStream<Uint8Array>({
    cancel(): void {
      isSettled = true;
      abortListener[Symbol.dispose]();
      incomingMessage.destroy();
    },
    pull(): void {
      incomingMessage.resume();
    },
    start(controller): void {
      function settle(error?: unknown): void {
        if (isSettled) {
          return;
        }
        isSettled = true;
        if (error === undefined) {
          controller.close();
        } else {
          controller.error(error);
        }
      }

      incomingMessage.on('data', (chunk: Buffer) => {
        // A copy, so the chunk belongs to the renderer's realm whatever Node does with its buffer afterwards.
        controller.enqueue(new Uint8Array(chunk));
        if (Number(controller.desiredSize) <= 0) {
          incomingMessage.pause();
        }
      });
      incomingMessage.on('end', () => {
        abortListener[Symbol.dispose]();
        settle();
      });
      incomingMessage.on('error', (error) => {
        abortListener[Symbol.dispose]();
        settle(error);
      });
      abortListener = onAbort(abortSignal, () => {
        settle(abortSignal.reason);
        // The `error` event this raises finds the stream settled already.
        incomingMessage.destroy(abortSignal.reason as Error);
      });
    }
  });
}
function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flatHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    // Node joins every repeated header but `set-cookie`, which arrives as an array.
    flatHeaders[name] = [value].flat().join(', ');
  }
  return flatHeaders;
}

function getRedirectedRequest(request: SendRequestParams, status: number, url: string): SendRequestParams {
  // What `fetch` does: a 303, and a 301 or 302 answering a POST, become a GET without a body.
  const shouldSwitchToGet = status === HTTP_SEE_OTHER_STATUS
    || (request.method === 'POST' && (status === HTTP_MOVED_PERMANENTLY_STATUS || status === HTTP_FOUND_STATUS));
  if (!shouldSwitchToGet) {
    return { ...request, url };
  }
  return {
    abortSignal: request.abortSignal,
    body: undefined,
    headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => !BODY_HEADERS.has(name.toLowerCase()))),
    method: 'GET',
    url
  };
}

async function sendRequest(params: SendRequestParams): Promise<IncomingMessage> {
  const request = params.url.startsWith('https:') ? requestHttps : requestHttp;
  return await new Promise((resolve, reject) => {
    const clientRequest = request(params.url, {
      headers: { ...params.headers },
      method: params.method,
      signal: params.abortSignal
    }, resolve);
    clientRequest.on('error', (error) => {
      reject(params.abortSignal.aborted ? params.abortSignal.reason as Error : error);
    });
    clientRequest.end(typeof params.body === 'string' ? params.body : params.body && new Uint8Array(params.body));
  });
}
/* eslint-enable n/no-unsupported-features/node-builtins -- ReadableStream is the Obsidian renderer's Web API, not a Node builtin. */
