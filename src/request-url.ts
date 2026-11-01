/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 *
 * A wrapper over Obsidian's {@link requestUrl} that fills the gaps plugins keep hand-rolling: an abort signal and a
 * timeout, request bodies beyond `string | ArrayBuffer` (`FormData`, `URLSearchParams`, `Blob`, typed arrays and
 * streams), an error that carries the status and the body, an up-front protocol check, a streamed response body, and
 * a `fetch`-compatible adapter that third-party SDKs can take.
 *
 * `requestUrl` itself cannot be cancelled: an abort or a timeout settles the returned promise at once, while the
 * underlying request runs to completion and its result is dropped. The streamed variant really cancels on desktop,
 * where it goes through `node:http` / `node:https`; that module is imported dynamically, so this one stays
 * cross-platform-loadable. On mobile the streamed variant falls back to `requestUrl` and delivers the whole body as a
 * single chunk.
 */

import type {
  RequestUrlParam,
  RequestUrlResponse
} from 'obsidian';

import {
  abortSignalAny,
  abortSignalTimeout,
  onAbort
} from '@mnaoumov/typescript-lib/abort-controller';
import { noop } from '@mnaoumov/typescript-lib/function';
import { normalizeOptionalProperties } from '@mnaoumov/typescript-lib/object-utils';
import {
  Platform,
  requestUrl
} from 'obsidian';

/**
 * Options for {@link createRequestUrlFetch}.
 */
export interface CreateRequestUrlFetchOptions {
  /**
   * Whether to stream the response body through {@link requestUrlStream} rather than buffer it. Streaming is real on
   * desktop only; on mobile the body still arrives as one chunk. Defaults to `false`.
   */
  readonly shouldStream?: boolean;

  /**
   * The timeout in milliseconds applied to every request, on top of the request's own `signal`.
   */
  readonly timeoutInMilliseconds?: number;
}

/**
 * The request in the form the transports take: validated, with the body encoded.
 */
export interface EncodedRequestUrlRequest {
  /**
   * Aborts the request.
   */
  readonly abortSignal: AbortSignal;

  /**
   * The encoded body.
   */
  readonly body?: ArrayBuffer | string;

  /**
   * The request headers, including the content type.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * The HTTP method, uppercase.
   */
  readonly method: string;

  /**
   * The URL.
   */
  readonly url: string;
}

/**
 * Parameters for {@link encodeRequestUrlRequest}.
 */
export type EncodeRequestUrlRequestParams = RequestUrlExParams;

/**
 * Parameters for the {@link RequestUrlError} constructor.
 */
export interface RequestUrlErrorConstructorParams {
  /**
   * The response headers.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * The HTTP method.
   */
  readonly method: string;

  /**
   * The status code.
   */
  readonly status: number;

  /**
   * The response body as text.
   */
  readonly text: string;

  /**
   * The URL.
   */
  readonly url: string;
}

/**
 * A request body {@link requestUrlEx} accepts: everything `fetch` accepts.
 */
export type RequestUrlExBody = ArrayBuffer | ArrayBufferView | Blob | FormData | ReadableStream<Uint8Array> | string | URLSearchParams;

/**
 * Parameters for {@link requestUrlEx}.
 */
export interface RequestUrlExParams {
  /**
   * Aborts the request. The promise rejects with the signal's reason.
   */
  readonly abortSignal?: AbortSignal | undefined;

  /**
   * The request body.
   */
  readonly body?: RequestUrlExBody | undefined;

  /**
   * The content type. When omitted, it is derived from the body: a `FormData` body gets `multipart/form-data` with its
   * boundary, a `URLSearchParams` body `application/x-www-form-urlencoded` and a `Blob` body its own type — unless
   * {@link RequestUrlExParams.headers} already carries a `Content-Type`.
   */
  readonly contentType?: string | undefined;

  /**
   * The request headers.
   */
  readonly headers?: Readonly<Record<string, string>> | undefined;

  /**
   * The HTTP method. Defaults to `GET`.
   */
  readonly method?: string | undefined;

  /**
   * Whether to throw a {@link RequestUrlError} when the status code is 400 or higher. Defaults to `true`.
   */
  readonly shouldThrowOnHttpError?: boolean | undefined;

  /**
   * The timeout in milliseconds. The promise rejects with a `TimeoutError` {@link DOMException} once it elapses.
   */
  readonly timeoutInMilliseconds?: number | undefined;

  /**
   * The URL. Only `http:` and `https:` URLs are accepted.
   */
  readonly url: string;
}

/**
 * A `fetch`-compatible function built on {@link requestUrl}.
 */
export type RequestUrlFetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Parameters for {@link requestUrlStream}.
 */
export type RequestUrlStreamParams = RequestUrlExParams;

/**
 * The response of {@link requestUrlStream}.
 */
export interface RequestUrlStreamResponse {
  /**
   * The response body.
   */
  readonly body: ReadableStream<Uint8Array>;

  /**
   * The response headers, with lowercase names.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * The status code.
   */
  readonly status: number;

  /**
   * The final URL, after any redirects.
   */
  readonly url: string;
}

interface EncodedBody {
  readonly body?: ArrayBuffer | string;
  readonly contentType?: string;
}

const HTTP_ERROR_STATUS_MIN = 400;
const ERROR_MESSAGE_BODY_LENGTH = 200;
const HTTP_SWITCHING_PROTOCOLS_STATUS = 101;
const HTTP_EARLY_HINTS_STATUS = 103;
const HTTP_NO_CONTENT_STATUS = 204;
const HTTP_RESET_CONTENT_STATUS = 205;
const HTTP_NOT_MODIFIED_STATUS = 304;
// The statuses a Response refuses a body for.
const NULL_BODY_STATUSES = new Set([
  HTTP_EARLY_HINTS_STATUS,
  HTTP_NO_CONTENT_STATUS,
  HTTP_NOT_MODIFIED_STATUS,
  HTTP_RESET_CONTENT_STATUS,
  HTTP_SWITCHING_PROTOCOLS_STATUS
]);
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);
const CONTENT_TYPE_HEADER = 'content-type';
const HEX_RADIX = 16;
const BOUNDARY_RANDOM_PART_COUNT = 2;
const RANDOM_PART_START = 2;

/**
 * The error {@link requestUrlEx} and {@link requestUrlStream} throw for a status code of 400 or higher.
 */
export class RequestUrlError extends Error {
  /**
   * The response headers.
   */
  public readonly headers: Readonly<Record<string, string>>;

  /**
   * The HTTP method.
   */
  public readonly method: string;

  /**
   * The status code.
   */
  public readonly status: number;

  /**
   * The response body as text.
   */
  public readonly text: string;

  /**
   * The URL.
   */
  public readonly url: string;

  /**
   * Creates a {@link RequestUrlError}.
   *
   * @param params - The failed request and its response.
   */
  public constructor(params: RequestUrlErrorConstructorParams) {
    const bodyExcerpt = params.text.length > ERROR_MESSAGE_BODY_LENGTH ? `${params.text.slice(0, ERROR_MESSAGE_BODY_LENGTH)}…` : params.text;
    super(`${params.method} ${params.url} failed with status ${String(params.status)}${bodyExcerpt ? `: ${bodyExcerpt}` : ''}`);
    this.name = 'RequestUrlError';
    this.headers = params.headers;
    this.method = params.method;
    this.status = params.status;
    this.text = params.text;
    this.url = params.url;
  }

  /**
   * Parses the response body as JSON.
   *
   * @returns The parsed body.
   */
  public json(): unknown {
    return JSON.parse(this.text);
  }
}

/**
 * Creates a `fetch`-compatible function built on {@link requestUrl}, for SDKs that take a custom `fetch` (OpenAI,
 * LangChain, OAuth clients) and would otherwise hit CORS.
 *
 * Unlike `fetch`, it never rejects on an HTTP error status: it resolves with a {@link Response} carrying that status,
 * exactly as `fetch` does. It rejects with a `TypeError` for a URL that is not `http:` or `https:`.
 *
 * @param options - The options.
 * @returns The `fetch`-compatible function.
 */
export function createRequestUrlFetch(options: CreateRequestUrlFetchOptions = {}): RequestUrlFetch {
  return async (input, init = {}) => {
    let request: null | Request = null;
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if ('method' in input) {
      // A `URL` has no `method`; `instanceof` would fail across windows.
      request = input;
      url = input.url;
    } else {
      url = input.href;
    }
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = toHeaderRecord(request?.headers, init.headers);
    let body: RequestUrlExBody | undefined = init.body ?? undefined;
    if (body === undefined && request && method !== 'GET' && method !== 'HEAD') {
      body = await request.arrayBuffer();
    }
    const params: RequestUrlExParams = {
      abortSignal: init.signal ?? request?.signal ?? undefined,
      body,
      headers,
      method,
      shouldThrowOnHttpError: false,
      timeoutInMilliseconds: options.timeoutInMilliseconds,
      url
    };

    if (options.shouldStream) {
      const streamResponse = await requestUrlStream(params);
      return createResponse(streamResponse.status, streamResponse.headers, streamResponse.body, streamResponse.url);
    }

    const response = await requestUrlEx(params);
    return createResponse(response.status, response.headers, response.arrayBuffer, url);
  };
}

/**
 * Encodes a request for a transport: validates the URL, combines the abort signal with the timeout, encodes the body
 * and settles the content type.
 *
 * @param params - The request.
 * @returns The encoded request.
 */
export async function encodeRequestUrlRequest(params: EncodeRequestUrlRequestParams): Promise<EncodedRequestUrlRequest> {
  const url = assertHttpUrl(params.url);
  const abortSignal = abortSignalAny(
    params.abortSignal,
    params.timeoutInMilliseconds === undefined ? undefined : abortSignalTimeout(params.timeoutInMilliseconds)
  );
  abortSignal.throwIfAborted();

  const encodedBody = await encodeBody(params.body);
  abortSignal.throwIfAborted();

  const headers: Record<string, string> = { ...params.headers };
  const hasContentTypeHeader = Object.keys(headers).some((name) => name.toLowerCase() === CONTENT_TYPE_HEADER);
  const contentType = params.contentType ?? (hasContentTypeHeader ? undefined : encodedBody.contentType);
  if (contentType !== undefined) {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === CONTENT_TYPE_HEADER) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- A header record is keyed by name.
        delete headers[name];
      }
    }
    headers['Content-Type'] = contentType;
  }

  return normalizeOptionalProperties<EncodedRequestUrlRequest>({
    abortSignal,
    body: encodedBody.body,
    headers,
    method: (params.method ?? 'GET').toUpperCase(),
    url
  });
}

/**
 * Requests a URL through {@link requestUrl}, with an abort signal, a timeout, richer bodies, a protocol check and a
 * {@link RequestUrlError} for an HTTP error status.
 *
 * @param params - The request.
 * @returns The response.
 */
export async function requestUrlEx(params: RequestUrlExParams): Promise<RequestUrlResponse> {
  const request = await encodeRequestUrlRequest(params);
  const obsidianRequest: RequestUrlParam = normalizeOptionalProperties<RequestUrlParam>({
    body: request.body,
    headers: { ...request.headers },
    method: request.method,
    throw: false,
    url: request.url
  });
  const response = await raceWithAbort(Promise.resolve(requestUrl(obsidianRequest)), request.abortSignal);
  if ((params.shouldThrowOnHttpError ?? true) && response.status >= HTTP_ERROR_STATUS_MIN) {
    throw new RequestUrlError({
      headers: response.headers,
      method: request.method,
      status: response.status,
      text: response.text,
      url: request.url
    });
  }
  return response;
}

/**
 * Requests a URL and returns its body as a stream.
 *
 * On desktop the request goes through `node:http` / `node:https`, so the body streams as it arrives, an abort really
 * cancels the request, and redirects are followed. On mobile it falls back to {@link requestUrl}, and the whole body
 * arrives as a single chunk.
 *
 * @param params - The request.
 * @returns The response, with a streamed body.
 */
export async function requestUrlStream(params: RequestUrlStreamParams): Promise<RequestUrlStreamResponse> {
  const request = await encodeRequestUrlRequest(params);
  let response: RequestUrlStreamResponse;
  if (Platform.isDesktopApp) {
    const { openDesktopRequestUrlStream } = await import('./desktop-request-url-stream.ts');
    response = await openDesktopRequestUrlStream(request);
  } else {
    const bufferedResponse = await requestUrlEx({
      abortSignal: request.abortSignal,
      body: request.body,
      headers: request.headers,
      method: request.method,
      shouldThrowOnHttpError: false,
      url: request.url
    });
    response = {
      body: createSingleChunkStream(bufferedResponse.arrayBuffer),
      headers: bufferedResponse.headers,
      status: bufferedResponse.status,
      url: request.url
    };
  }

  if ((params.shouldThrowOnHttpError ?? true) && response.status >= HTTP_ERROR_STATUS_MIN) {
    const text = new TextDecoder().decode(await readStream(response.body));
    throw new RequestUrlError({
      headers: response.headers,
      method: request.method,
      status: response.status,
      text,
      url: response.url
    });
  }
  return response;
}

function assertHttpUrl(url: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TypeError(`Invalid URL: ${url}`);
  }
  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new TypeError(`Unsupported protocol ${parsedUrl.protocol} in ${url}: only http: and https: URLs can be requested`);
  }
  return url;
}

function concatBytes(chunks: readonly Uint8Array[]): ArrayBuffer {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function createResponse(status: number, headers: Readonly<Record<string, string>>, body: ArrayBuffer | ReadableStream<Uint8Array>, url: string): Response {
  const response = new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
    headers: new Headers({ ...headers }),
    status
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function createSingleChunkStream(arrayBuffer: ArrayBuffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      if (arrayBuffer.byteLength > 0) {
        controller.enqueue(new Uint8Array(arrayBuffer));
      }
      controller.close();
    }
  });
}

async function encodeBody(body: RequestUrlExBody | undefined): Promise<EncodedBody> {
  if (body === undefined || typeof body === 'string') {
    return normalizeOptionalProperties<EncodedBody>({ body });
  }

  // `instanceof` fails across windows, so the body kinds are told apart by their built-in tags.
  switch (Object.prototype.toString.call(body)) {
    case '[object ArrayBuffer]': {
      return { body: body as ArrayBuffer };
    }
    case '[object Blob]':
    case '[object File]': {
      const blob = body as Blob;
      return normalizeOptionalProperties<EncodedBody>({ body: await blob.arrayBuffer(), contentType: blob.type || undefined });
    }
    case '[object FormData]': {
      return await encodeFormData(body as FormData);
    }
    case '[object ReadableStream]': {
      return { body: await readStream(body as ReadableStream<Uint8Array>) };
    }
    case '[object URLSearchParams]': {
      return { body: (body as URLSearchParams).toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
    }
    default: {
      if (ArrayBuffer.isView(body)) {
        return { body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice().buffer };
      }
      throw new TypeError(`Unsupported request body: ${Object.prototype.toString.call(body)}`);
    }
  }
}

async function encodeFormData(formData: FormData): Promise<EncodedBody> {
  const boundary = `----ObsidianLibFormBoundary${generateRandomHex()}`;
  const textEncoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: [string, FormDataEntryValue][] = [];
  formData.forEach((value, name) => {
    entries.push([name, value]);
  });

  for (const [name, value] of entries) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartName(name)}"`;
    if (typeof value === 'string') {
      chunks.push(textEncoder.encode(`${header}\r\n\r\n${value}\r\n`));
      continue;
    }
    header += `; filename="${escapeMultipartName(value.name)}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`;
    chunks.push(textEncoder.encode(header), new Uint8Array(await value.arrayBuffer()), textEncoder.encode('\r\n'));
  }

  chunks.push(textEncoder.encode(`--${boundary}--\r\n`));
  return { body: concatBytes(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function escapeMultipartName(name: string): string {
  // The escaping the HTML standard prescribes for multipart/form-data names and file names.
  return name.replaceAll('"', '%22').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function generateRandomHex(): string {
  return Array.from({ length: BOUNDARY_RANDOM_PART_COUNT }, () => Math.random().toString(HEX_RADIX).slice(RANDOM_PART_START)).join('');
}

async function raceWithAbort<T>(promise: Promise<T>, abortSignal: AbortSignal): Promise<T> {
  let rejectOnAbort: (reason: Error) => void = noop;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  using _abortListener = onAbort(abortSignal, () => {
    // The reason is whatever the caller aborted with, an `AbortError` or `TimeoutError` by default.
    rejectOnAbort(abortSignal.reason as Error);
  });
  return await Promise.race([promise, abortPromise]);
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
  }
  return concatBytes(chunks);
}

function toHeaderRecord(requestHeaders: Headers | undefined, initHeaders: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(requestHeaders);
  new Headers(initHeaders).forEach((value, name) => {
    headers.set(name, value);
  });
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return record;
}
/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
