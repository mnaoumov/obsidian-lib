import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  RequestUrlParam,
  RequestUrlResponse
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { createServer } from 'node:http';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  createRequestUrlFetch,
  encodeRequestUrlRequest,
  RequestUrlError,
  requestUrlEx,
  requestUrlStream
} from './request-url.ts';

const { mockRequestUrl, platformState } = vi.hoisted(() => ({
  mockRequestUrl: vi.fn(),
  platformState: { isDesktopApp: false }
}));

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    Platform: platformState,
    requestUrl: mockRequestUrl
  };
});

const URL_STRING = 'https://example.com/api';
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;

function createResponse(status: number, text: string, headers: Record<string, string> = {}): RequestUrlResponse {
  const arrayBuffer = new TextEncoder().encode(text).buffer;
  return {
    arrayBuffer,
    headers,
    get json(): unknown {
      return JSON.parse(text);
    },
    status,
    text
  };
}

function getRequestUrlParameter(): RequestUrlParam {
  return mockRequestUrl.mock.calls[0]?.[0] as RequestUrlParam;
}

function getSentText(): string {
  const body = getRequestUrlParameter().body;
  return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

beforeEach(() => {
  mockRequestUrl.mockReset();
  mockRequestUrl.mockResolvedValue(createResponse(HTTP_OK, 'ok', { 'content-type': 'text/plain' }));
  platformState.isDesktopApp = false;
});

describe('RequestUrlError', () => {
  it('should carry the response and name it in the message', () => {
    const error = new RequestUrlError({
      headers: { 'content-type': 'application/json' },
      method: 'GET',
      status: HTTP_NOT_FOUND,
      text: '{"error":"missing"}',
      url: URL_STRING
    });
    expect(error.name).toBe('RequestUrlError');
    expect(error.message).toBe(`GET ${URL_STRING} failed with status 404: {"error":"missing"}`);
    expect(error.status).toBe(HTTP_NOT_FOUND);
    expect(error.headers).toEqual({ 'content-type': 'application/json' });
    expect(error.json()).toEqual({ error: 'missing' });
  });

  it('should leave an empty body out of the message', () => {
    const error = new RequestUrlError({ headers: {}, method: 'POST', status: 500, text: '', url: URL_STRING });
    expect(error.message).toBe(`POST ${URL_STRING} failed with status 500`);
  });

  it('should shorten a long body in the message but keep it whole', () => {
    const text = 'x'.repeat(300);
    const error = new RequestUrlError({ headers: {}, method: 'GET', status: 500, text, url: URL_STRING });
    expect(error.message).toBe(`GET ${URL_STRING} failed with status 500: ${'x'.repeat(200)}…`);
    expect(error.text).toBe(text);
  });
});

describe('requestUrlEx', () => {
  it('should request through requestUrl and return its response', async () => {
    const response = await requestUrlEx({ headers: { Accept: 'text/plain' }, url: URL_STRING });
    expect(response.text).toBe('ok');
    expect(getRequestUrlParameter()).toEqual({
      headers: { Accept: 'text/plain' },
      method: 'GET',
      throw: false,
      url: URL_STRING
    });
  });

  it('should uppercase the method', async () => {
    await requestUrlEx({ method: 'post', url: URL_STRING });
    expect(getRequestUrlParameter().method).toBe('POST');
  });

  it('should throw a RequestUrlError for an error status', async () => {
    mockRequestUrl.mockResolvedValue(createResponse(HTTP_NOT_FOUND, 'missing'));
    const promise = requestUrlEx({ url: URL_STRING });
    await expect(promise).rejects.toBeInstanceOf(RequestUrlError);
    await expect(promise).rejects.toMatchObject({ method: 'GET', status: HTTP_NOT_FOUND, text: 'missing', url: URL_STRING });
  });

  it('should return an error status when asked not to throw', async () => {
    mockRequestUrl.mockResolvedValue(createResponse(HTTP_NOT_FOUND, 'missing'));
    const response = await requestUrlEx({ shouldThrowOnHttpError: false, url: URL_STRING });
    expect(response.status).toBe(HTTP_NOT_FOUND);
  });

  it('should refuse an unsupported protocol before requesting', async () => {
    await expect(requestUrlEx({ url: 'app://local/file' })).rejects.toThrow(
      new TypeError('Unsupported protocol app: in app://local/file: only http: and https: URLs can be requested')
    );
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it('should refuse an invalid URL before requesting', async () => {
    await expect(requestUrlEx({ url: 'example.com' })).rejects.toThrow(new TypeError('Invalid URL: example.com'));
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it('should reject with the abort reason when aborted mid-request', async () => {
    mockRequestUrl.mockReturnValue(
      new Promise(() => {
        // Never settles.
      })
    );
    const abortController = new AbortController();
    const promise = requestUrlEx({ abortSignal: abortController.signal, url: URL_STRING });
    await vi.waitFor(() => {
      expect(mockRequestUrl).toHaveBeenCalled();
    });
    const reason = new Error('stop');
    abortController.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });

  it('should reject at once when already aborted', async () => {
    const reason = new Error('stop');
    await expect(requestUrlEx({ abortSignal: AbortSignal.abort(reason), url: URL_STRING })).rejects.toBe(reason);
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it('should reject with a TimeoutError once the timeout elapses', async () => {
    mockRequestUrl.mockReturnValue(
      new Promise(() => {
        // Never settles.
      })
    );
    await expect(requestUrlEx({ timeoutInMilliseconds: 10, url: URL_STRING })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('should not time out a request that finishes in time', async () => {
    const response = await requestUrlEx({ timeoutInMilliseconds: 10_000, url: URL_STRING });
    expect(response.status).toBe(HTTP_OK);
  });
});

describe('encodeRequestUrlRequest', () => {
  it('should leave a string body without a content type', async () => {
    const request = await encodeRequestUrlRequest({ body: 'text', method: 'POST', url: URL_STRING });
    expect(request.body).toBe('text');
    expect(request.headers).toEqual({});
  });

  it('should pass an ArrayBuffer body through', async () => {
    const arrayBuffer = new ArrayBuffer(3);
    const request = await encodeRequestUrlRequest({ body: arrayBuffer, url: URL_STRING });
    expect(request.body).toBe(arrayBuffer);
  });

  it('should copy only the viewed bytes of a typed array', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const request = await encodeRequestUrlRequest({ body: bytes.subarray(1, 3), url: URL_STRING });
    expect([...new Uint8Array(request.body as ArrayBuffer)]).toEqual([2, 3]);
  });

  it('should read a Blob body and take its type', async () => {
    const request = await encodeRequestUrlRequest({ body: new Blob(['blob'], { type: 'text/csv' }), url: URL_STRING });
    expect(new TextDecoder().decode(request.body as ArrayBuffer)).toBe('blob');
    expect(request.headers).toEqual({ 'Content-Type': 'text/csv' });
  });

  it('should read an untyped Blob body without a content type', async () => {
    const request = await encodeRequestUrlRequest({ body: new Blob(['blob']), url: URL_STRING });
    expect(request.headers).toEqual({});
  });

  it('should read a File body', async () => {
    const request = await encodeRequestUrlRequest({ body: new File(['file'], 'a.txt', { type: 'text/plain' }), url: URL_STRING });
    expect(new TextDecoder().decode(request.body as ArrayBuffer)).toBe('file');
  });

  it('should encode a URLSearchParams body as a form', async () => {
    const request = await encodeRequestUrlRequest({ body: new URLSearchParams({ a: '1', b: 'x y' }), url: URL_STRING });
    expect(request.body).toBe('a=1&b=x+y');
    expect(request.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' });
  });

  it('should read a ReadableStream body', async () => {
    const textEncoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(textEncoder.encode('one '));
        controller.enqueue(textEncoder.encode('two'));
        controller.close();
      }
    });
    const request = await encodeRequestUrlRequest({ body: stream, url: URL_STRING });
    expect(new TextDecoder().decode(request.body as ArrayBuffer)).toBe('one two');
  });

  it('should encode a FormData body as multipart', async () => {
    const formData = new FormData();
    formData.append('field', 'value');
    formData.append('quote"d\r\n x', 'x');
    formData.append('typed', new File(['typed content'], 'typed.txt', { type: 'text/plain' }));
    formData.append('untyped', new File(['raw'], 'raw.bin'));
    const request = await encodeRequestUrlRequest({ body: formData, method: 'POST', url: URL_STRING });

    const contentType = request.headers['Content-Type'] ?? '';
    const boundary = /^multipart\/form-data; boundary=(?<boundary>.+)$/.exec(contentType)?.groups?.['boundary'] ?? '';
    expect(boundary).toMatch(/^----ObsidianLibFormBoundary[0-9a-f]+$/);
    expect(new TextDecoder().decode(request.body as ArrayBuffer)).toBe(
      `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n`
        + `--${boundary}\r\nContent-Disposition: form-data; name="quote%22d%0D%0A x"\r\n\r\nx\r\n`
        + `--${boundary}\r\nContent-Disposition: form-data; name="typed"; filename="typed.txt"\r\nContent-Type: text/plain\r\n\r\ntyped content\r\n`
        + `--${boundary}\r\nContent-Disposition: form-data; name="untyped"; filename="raw.bin"\r\nContent-Type: application/octet-stream\r\n\r\nraw\r\n`
        + `--${boundary}--\r\n`
    );
  });

  it('should keep a Content-Type header the caller set over the derived one', async () => {
    const request = await encodeRequestUrlRequest({
      body: new URLSearchParams({ a: '1' }),
      headers: { 'content-type': 'text/plain' },
      url: URL_STRING
    });
    expect(request.headers).toEqual({ 'content-type': 'text/plain' });
  });

  it('should let an explicit content type replace a Content-Type header', async () => {
    const request = await encodeRequestUrlRequest({
      body: 'text',
      contentType: 'application/json',
      headers: { 'Accept': '*/*', 'CONTENT-TYPE': 'text/plain' },
      url: URL_STRING
    });
    expect(request.headers).toEqual({ 'Accept': '*/*', 'Content-Type': 'application/json' });
  });

  it('should refuse an unsupported body', async () => {
    await expect(encodeRequestUrlRequest({ body: castTo<string>(42), url: URL_STRING })).rejects.toThrow(
      new TypeError('Unsupported request body: [object Number]')
    );
  });

  it('should reject when aborted while the body is read', async () => {
    const abortController = new AbortController();
    const reason = new Error('stop');
    const stream = new ReadableStream<Uint8Array>({
      pull(controller): void {
        abortController.abort(reason);
        controller.close();
      }
    });
    await expect(encodeRequestUrlRequest({ abortSignal: abortController.signal, body: stream, url: URL_STRING })).rejects.toBe(reason);
  });
});

describe('requestUrlStream', () => {
  describe('on mobile', () => {
    it('should deliver the buffered body as one chunk', async () => {
      const response = await requestUrlStream({ url: URL_STRING });
      expect(response).toMatchObject({ headers: { 'content-type': 'text/plain' }, status: HTTP_OK, url: URL_STRING });
      const reader = response.body.getReader();
      const firstResult = await reader.read();
      expect(new TextDecoder().decode(firstResult.value)).toBe('ok');
      const secondResult = await reader.read();
      expect(secondResult.done).toBe(true);
    });

    it('should deliver an empty body as an empty stream', async () => {
      mockRequestUrl.mockResolvedValue(createResponse(HTTP_NO_CONTENT, ''));
      const response = await requestUrlStream({ url: URL_STRING });
      const result = await response.body.getReader().read();
      expect(result.done).toBe(true);
    });

    it('should throw a RequestUrlError carrying the body for an error status', async () => {
      mockRequestUrl.mockResolvedValue(createResponse(HTTP_NOT_FOUND, 'missing'));
      await expect(requestUrlStream({ url: URL_STRING })).rejects.toMatchObject({ status: HTTP_NOT_FOUND, text: 'missing' });
    });

    it('should return an error status when asked not to throw', async () => {
      mockRequestUrl.mockResolvedValue(createResponse(HTTP_NOT_FOUND, 'missing'));
      const response = await requestUrlStream({ shouldThrowOnHttpError: false, url: URL_STRING });
      expect(response.status).toBe(HTTP_NOT_FOUND);
      expect(await readText(response.body)).toBe('missing');
    });
  });

  describe('on desktop', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
      platformState.isDesktopApp = true;
      server = createServer((request, response) => {
        if (request.url === '/missing') {
          response.writeHead(HTTP_NOT_FOUND);
          response.end('not here');
          return;
        }
        response.end(`streamed ${String(request.method)}`);
      });
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    });

    afterEach(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    });

    it('should stream through node:http', async () => {
      const response = await requestUrlStream({ method: 'POST', url: `${baseUrl}/` });
      expect(response.status).toBe(HTTP_OK);
      expect(await readText(response.body)).toBe('streamed POST');
      expect(mockRequestUrl).not.toHaveBeenCalled();
    });

    it('should throw a RequestUrlError carrying the body for an error status', async () => {
      await expect(requestUrlStream({ url: `${baseUrl}/missing` })).rejects.toMatchObject({
        status: HTTP_NOT_FOUND,
        text: 'not here',
        url: `${baseUrl}/missing`
      });
    });

    it('should stream the response of the fetch adapter when asked to', async () => {
      const fetch = createRequestUrlFetch({ shouldStream: true });
      const response = await fetch(`${baseUrl}/`);
      expect(response.status).toBe(HTTP_OK);
      expect(response.url).toBe(`${baseUrl}/`);
      expect(await response.text()).toBe('streamed GET');
    });
  });
});

describe('createRequestUrlFetch', () => {
  it('should answer like fetch for a string URL', async () => {
    const fetch = createRequestUrlFetch();
    const response = await fetch(URL_STRING);
    expect(response.status).toBe(HTTP_OK);
    expect(response.ok).toBe(true);
    expect(response.url).toBe(URL_STRING);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(await response.text()).toBe('ok');
    expect(getRequestUrlParameter().method).toBe('GET');
  });

  it('should resolve, not reject, with an error status', async () => {
    mockRequestUrl.mockResolvedValue(createResponse(HTTP_NOT_FOUND, 'missing'));
    const response = await createRequestUrlFetch()(URL_STRING);
    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(response.ok).toBe(false);
    expect(await response.text()).toBe('missing');
  });

  it('should give a no-content status a null body', async () => {
    mockRequestUrl.mockResolvedValue(createResponse(HTTP_NO_CONTENT, ''));
    const response = await createRequestUrlFetch()(URL_STRING);
    expect(response.status).toBe(HTTP_NO_CONTENT);
    expect(response.body).toBeNull();
  });

  it('should take a URL object', async () => {
    await createRequestUrlFetch()(new URL(URL_STRING));
    expect(getRequestUrlParameter().url).toBe(URL_STRING);
  });

  it('should send the init method, headers and body', async () => {
    await createRequestUrlFetch()(URL_STRING, {
      body: JSON.stringify({ a: 1 }),
      headers: [['Content-Type', 'application/json'], ['X-Extra', 'yes']],
      method: 'post'
    });
    expect(getRequestUrlParameter()).toMatchObject({
      headers: { 'content-type': 'application/json', 'x-extra': 'yes' },
      method: 'POST'
    });
    expect(getSentText()).toBe('{"a":1}');
  });

  it('should take the method, headers and body of a Request, with init overriding them', async () => {
    const request = new Request(URL_STRING, {
      body: 'request body',
      headers: { 'X-From': 'request', 'X-Kept': 'request' },
      method: 'PUT'
    });
    await createRequestUrlFetch()(request, { headers: { 'X-From': 'init' } });
    expect(getRequestUrlParameter()).toMatchObject({
      headers: { 'x-from': 'init', 'x-kept': 'request' },
      method: 'PUT',
      url: URL_STRING
    });
    expect(getSentText()).toBe('request body');
  });

  it('should read the empty body of a Request sent with another method', async () => {
    await createRequestUrlFetch()(new Request(URL_STRING), { body: null, method: 'DELETE' });
    expect(getRequestUrlParameter().method).toBe('DELETE');
    expect(getSentText()).toBe('');
  });

  it('should leave a GET Request without a body', async () => {
    await createRequestUrlFetch()(new Request(URL_STRING));
    expect(getRequestUrlParameter().body).toBeUndefined();
  });

  it('should honour the signal of a Request', async () => {
    const reason = new Error('stop');
    const request = new Request(URL_STRING, { signal: AbortSignal.abort(reason) });
    await expect(createRequestUrlFetch()(request)).rejects.toBe(reason);
  });

  it('should honour the init signal', async () => {
    const reason = new Error('stop');
    await expect(createRequestUrlFetch()(URL_STRING, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });

  it('should apply its timeout', async () => {
    mockRequestUrl.mockReturnValue(
      new Promise(() => {
        // Never settles.
      })
    );
    await expect(createRequestUrlFetch({ timeoutInMilliseconds: 10 })(URL_STRING)).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('should reject an unsupported protocol with a TypeError, as fetch does', async () => {
    await expect(createRequestUrlFetch()('file:///etc/hosts')).rejects.toBeInstanceOf(TypeError);
  });
});
