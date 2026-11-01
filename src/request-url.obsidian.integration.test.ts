/**
 * @file
 *
 * Integration tests for {@link requestUrlEx}, {@link requestUrlStream} and {@link createRequestUrlFetch} against a
 * live Obsidian instance and a local HTTP server.
 *
 * The unit tests replace Obsidian's `requestUrl` and run Node's stream classes. What only a real renderer shows is
 * that Obsidian's own `requestUrl` carries the encoded multipart body and the derived content type, that the
 * desktop stream reaches `node:http` from the renderer, and that the stream it returns is one Chromium's own
 * `Response` accepts.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createServer } from 'node:http';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

const HTTP_NOT_FOUND = 404;
const STREAM_CHUNK_DELAY_IN_MILLISECONDS = 300;

interface EchoedRequest {
  readonly body: string;
  readonly contentType: string;
  readonly method: string;
}

interface FetchProbe {
  readonly bufferedJson: unknown;
  readonly isNotFoundOk: boolean;
  readonly streamedText: string;
}

interface RequestUrlFailure {
  readonly isRequestUrlError: boolean;
  readonly status: number;
  readonly text: string;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      switch (request.url) {
        case '/echo': {
          const echoedRequest: EchoedRequest = {
            body: Buffer.concat(chunks).toString('utf-8'),
            contentType: request.headers['content-type'] ?? '',
            method: String(request.method)
          };
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(echoedRequest));
          break;
        }
        case '/hang': {
          // Never answers.
          break;
        }
        case '/stream': {
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.write('first ');
          window.setTimeout(() => {
            response.end('second');
          }, STREAM_CHUNK_DELAY_IN_MILLISECONDS);
          break;
        }
        default: {
          response.writeHead(HTTP_NOT_FOUND, { 'Content-Type': 'text/plain' });
          response.end('nothing here');
          break;
        }
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('requestUrlEx', () => {
  it('should send a FormData body through Obsidian\'s requestUrl as multipart', async () => {
    const echoedRequest = await evalInObsidian({
      async callback({ baseUrl: url, lib: { requestUrlEx } }): Promise<EchoedRequest> {
        const formData = new FormData();
        formData.append('field', 'value');
        formData.append('file', new File(['file content'], 'note.md', { type: 'text/markdown' }));
        const response = await requestUrlEx({ body: formData, method: 'POST', url: `${url}/echo` });
        return response.json as EchoedRequest;
      },
      input: { baseUrl }
    });

    expect(echoedRequest.method).toBe('POST');
    const boundary = /^multipart\/form-data; boundary=(?<boundary>.+)$/.exec(echoedRequest.contentType)?.groups?.['boundary'];
    expect(boundary).toBeDefined();
    expect(echoedRequest.body).toContain('Content-Disposition: form-data; name="field"\r\n\r\nvalue\r\n');
    expect(echoedRequest.body).toContain('filename="note.md"\r\nContent-Type: text/markdown\r\n\r\nfile content\r\n');
    expect(echoedRequest.body.endsWith(`--${String(boundary)}--\r\n`)).toBe(true);
  });

  it('should throw a RequestUrlError carrying the status and the body', async () => {
    const failure = await evalInObsidian({
      async callback({ baseUrl: url, lib: { RequestUrlError, requestUrlEx } }): Promise<null | RequestUrlFailure> {
        try {
          await requestUrlEx({ url: `${url}/missing` });
          return null;
        } catch (error) {
          const requestUrlError = error as InstanceType<typeof RequestUrlError>;
          return { isRequestUrlError: error instanceof RequestUrlError, status: requestUrlError.status, text: requestUrlError.text };
        }
      },
      input: { baseUrl }
    });

    expect(failure).toStrictEqual({ isRequestUrlError: true, status: HTTP_NOT_FOUND, text: 'nothing here' });
  });

  it('should time out a request that never answers', async () => {
    const errorName = await evalInObsidian({
      async callback({ baseUrl: url, lib: { requestUrlEx } }): Promise<string> {
        try {
          await requestUrlEx({ timeoutInMilliseconds: 500, url: `${url}/hang` });
          return 'resolved';
        } catch (error) {
          return (error as Error).name;
        }
      },
      input: { baseUrl }
    });

    expect(errorName).toBe('TimeoutError');
  });
});

describe('requestUrlStream', () => {
  it('should deliver the body in the chunks the server sent', async () => {
    const chunks = await evalInObsidian({
      async callback({ baseUrl: url, lib: { requestUrlStream } }): Promise<string[]> {
        const response = await requestUrlStream({ url: `${url}/stream` });
        const reader = response.body.getReader();
        const textDecoder = new TextDecoder();
        const texts: string[] = [];
        for (;;) {
          const result = await reader.read();
          if (result.done) {
            return texts;
          }
          texts.push(textDecoder.decode(result.value));
        }
      },
      input: { baseUrl }
    });

    expect(chunks).toStrictEqual(['first ', 'second']);
  });
});

describe('createRequestUrlFetch', () => {
  it('should answer like fetch, buffered and streamed', async () => {
    const result = await evalInObsidian({
      async callback({ baseUrl: url, lib: { createRequestUrlFetch } }): Promise<FetchProbe> {
        const bufferedResponse = await createRequestUrlFetch()(`${url}/echo`, {
          body: JSON.stringify({ a: 1 }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST'
        });
        const notFoundResponse = await createRequestUrlFetch()(`${url}/missing`);
        const streamedResponse = await createRequestUrlFetch({ shouldStream: true })(`${url}/stream`);
        return {
          bufferedJson: await bufferedResponse.json(),
          isNotFoundOk: notFoundResponse.ok,
          streamedText: await streamedResponse.text()
        };
      },
      input: { baseUrl }
    });

    expect(result).toStrictEqual({
      bufferedJson: { body: '{"a":1}', contentType: 'application/json', method: 'POST' },
      isNotFoundOk: false,
      streamedText: 'first second'
    });
  });
});
