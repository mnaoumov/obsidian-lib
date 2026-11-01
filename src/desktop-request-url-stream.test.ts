import type {
  IncomingMessage,
  Server,
  ServerResponse
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { createServer } from 'node:http';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { EncodedRequestUrlRequest } from './request-url.ts';

import { openDesktopRequestUrlStream } from './desktop-request-url-stream.ts';

interface RecordedRequest {
  readonly body: string;
  readonly headers: IncomingMessage['headers'];
  readonly method: string;
  readonly url: string;
}

type RequestHandler = (request: IncomingMessage, response: ServerResponse, body: string) => void;

let server: Server;
let baseUrl: string;
let handler: RequestHandler;
let recordedRequests: RecordedRequest[];
let closedResponseCount: number;

beforeEach(async () => {
  recordedRequests = [];
  closedResponseCount = 0;
  handler = (_request, response): void => {
    response.end('ok');
  };
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      recordedRequests.push({ body, headers: request.headers, method: String(request.method), url: String(request.url) });
      response.on('close', () => {
        closedResponseCount++;
      });
      handler(request, response, body);
    });
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

function createRequest(overrides: Partial<EncodedRequestUrlRequest> = {}): EncodedRequestUrlRequest {
  return {
    abortSignal: new AbortController().signal,
    headers: {},
    method: 'GET',
    url: `${baseUrl}/path`,
    ...overrides
  };
}

async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  const textDecoder = new TextDecoder();
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      return text;
    }
    text += textDecoder.decode(result.value, { stream: true });
  }
}

async function waitFor(isConditionMet: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!isConditionMet()) {
    if (Date.now() > deadline) {
      throw new Error('Condition not met');
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 10);
    });
  }
}

describe('openDesktopRequestUrlStream', () => {
  it('should stream the body as it arrives', async () => {
    const serverResponses: ServerResponse[] = [];
    handler = (_request, response): void => {
      response.writeHead(200, { 'X-Custom': 'value' });
      response.write('hello ');
      serverResponses.push(response);
    };

    const response = await openDesktopRequestUrlStream(createRequest());
    expect(response.status).toBe(200);
    expect(response.url).toBe(`${baseUrl}/path`);
    expect(response.headers['x-custom']).toBe('value');

    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe('hello ');

    ensureNonNullable(serverResponses[0]).end('world');
    const secondChunk = await reader.read();
    expect(new TextDecoder().decode(secondChunk.value)).toBe('world');
    const lastResult = await reader.read();
    expect(lastResult.done).toBe(true);
  });

  it('should hold back a body nobody reads, then deliver all of it', async () => {
    handler = (_request, response): void => {
      response.write('one ');
      response.write('two ', () => {
        window.setTimeout(() => {
          response.end('three');
        }, 50);
      });
    };
    const response = await openDesktopRequestUrlStream(createRequest());
    await new Promise((resolve) => {
      window.setTimeout(resolve, 200);
    });
    expect(await readText(response.body)).toBe('one two three');
  });

  it('should send a string body with its headers', async () => {
    const response = await openDesktopRequestUrlStream(createRequest({
      body: 'payload',
      headers: { 'Content-Type': 'text/plain' },
      method: 'POST'
    }));
    expect(await readText(response.body)).toBe('ok');
    expect(recordedRequests[0]).toMatchObject({ body: 'payload', method: 'POST' });
    expect(recordedRequests[0]?.headers['content-type']).toBe('text/plain');
    expect(recordedRequests[0]?.headers['content-length']).toBe('7');
  });

  it('should send an ArrayBuffer body', async () => {
    const response = await openDesktopRequestUrlStream(createRequest({
      body: new TextEncoder().encode('bytes').buffer,
      method: 'PUT'
    }));
    await readText(response.body);
    expect(recordedRequests[0]).toMatchObject({ body: 'bytes', method: 'PUT' });
  });

  it('should join a repeated response header', async () => {
    handler = (_request, response): void => {
      response.setHeader('Set-Cookie', ['a=1', 'b=2']);
      response.end();
    };
    const response = await openDesktopRequestUrlStream(createRequest());
    expect(response.headers['set-cookie']).toBe('a=1, b=2');
    expect(await readText(response.body)).toBe('');
  });

  it('should turn a POST redirected with 302 into a GET without a body', async () => {
    handler = (request, response): void => {
      if (request.url === '/path') {
        response.writeHead(302, { Location: '/target' });
        response.end();
        return;
      }
      response.end('target');
    };
    const response = await openDesktopRequestUrlStream(createRequest({
      body: 'payload',
      headers: { 'Content-Type': 'text/plain', 'X-Kept': 'yes' },
      method: 'POST'
    }));
    expect(response.url).toBe(`${baseUrl}/target`);
    expect(await readText(response.body)).toBe('target');
    expect(recordedRequests[1]).toMatchObject({ body: '', method: 'GET', url: '/target' });
    expect(recordedRequests[1]?.headers['content-type']).toBeUndefined();
    expect(recordedRequests[1]?.headers['x-kept']).toBe('yes');
  });

  it('should turn any request redirected with 303 into a GET', async () => {
    handler = (request, response): void => {
      if (request.url === '/path') {
        response.writeHead(303, { Location: '/target' });
        response.end();
        return;
      }
      response.end('target');
    };
    const response = await openDesktopRequestUrlStream(createRequest({ body: 'payload', method: 'PUT' }));
    await readText(response.body);
    expect(recordedRequests[1]).toMatchObject({ body: '', method: 'GET' });
  });

  it('should keep the method and body through a 307 redirect', async () => {
    handler = (request, response): void => {
      if (request.url === '/path') {
        response.writeHead(307, { Location: '/target' });
        response.end();
        return;
      }
      response.end('target');
    };
    const response = await openDesktopRequestUrlStream(createRequest({ body: 'payload', method: 'POST' }));
    await readText(response.body);
    expect(recordedRequests[1]).toMatchObject({ body: 'payload', method: 'POST', url: '/target' });
  });

  it('should keep a GET redirected with 301 a GET', async () => {
    handler = (request, response): void => {
      if (request.url === '/path') {
        response.writeHead(301, { Location: '/target' });
        response.end();
        return;
      }
      response.end('target');
    };
    const response = await openDesktopRequestUrlStream(createRequest());
    expect(await readText(response.body)).toBe('target');
  });

  it('should return a redirect status without a Location as it is', async () => {
    handler = (_request, response): void => {
      response.writeHead(302);
      response.end('no location');
    };
    const response = await openDesktopRequestUrlStream(createRequest());
    expect(response.status).toBe(302);
    expect(await readText(response.body)).toBe('no location');
  });

  it('should give up after too many redirects', async () => {
    handler = (_request, response): void => {
      response.writeHead(302, { Location: '/path' });
      response.end();
    };
    await expect(openDesktopRequestUrlStream(createRequest())).rejects.toThrow(`Too many redirects requesting ${baseUrl}/path`);
  });

  it('should refuse a redirect to an unsupported protocol', async () => {
    handler = (_request, response): void => {
      response.writeHead(302, { Location: 'ftp://example.com/file' });
      response.end();
    };
    await expect(openDesktopRequestUrlStream(createRequest())).rejects.toThrow('Unsupported protocol ftp: in the redirect to ftp://example.com/file');
  });

  it('should reject with the abort reason when aborted before the response', async () => {
    handler = (): void => {
      // Never responds.
    };
    const abortController = new AbortController();
    const promise = openDesktopRequestUrlStream(createRequest({ abortSignal: abortController.signal }));
    await waitFor(() => recordedRequests.length > 0);
    const reason = new Error('stop');
    abortController.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });

  it('should error the stream with the abort reason when aborted mid-body', async () => {
    handler = (_request, response): void => {
      response.write('partial');
    };
    const abortController = new AbortController();
    const response = await openDesktopRequestUrlStream(createRequest({ abortSignal: abortController.signal }));
    const reader = response.body.getReader();
    await reader.read();
    const reason = new Error('stop');
    abortController.abort(reason);
    await expect(reader.read()).rejects.toBe(reason);
    await waitFor(() => closedResponseCount > 0);
  });

  it('should error the stream when the connection drops mid-body', async () => {
    handler = (_request, response): void => {
      response.writeHead(200, { 'Content-Length': '100' });
      response.write('partial', () => {
        response.socket?.destroy();
      });
    };
    const response = await openDesktopRequestUrlStream(createRequest());
    await expect(readText(response.body)).rejects.toThrow();
  });

  it('should close the connection when the stream is cancelled', async () => {
    handler = (_request, response): void => {
      response.write('partial');
    };
    const response = await openDesktopRequestUrlStream(createRequest());
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => closedResponseCount > 0);
  });

  it('should reject with the network error when the connection fails', async () => {
    const unusedServer = createServer();
    await new Promise<void>((resolve) => {
      unusedServer.listen(0, '127.0.0.1', resolve);
    });
    const port = (unusedServer.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      unusedServer.close(() => {
        resolve();
      });
    });
    await expect(openDesktopRequestUrlStream(createRequest({ url: `http://127.0.0.1:${String(port)}/` }))).rejects.toThrow('ECONNREFUSED');
  });
  it('should request an https: URL over TLS', async () => {
    await expect(openDesktopRequestUrlStream(createRequest({ url: baseUrl.replace('http:', 'https:') }))).rejects.toThrow();
  });
});
