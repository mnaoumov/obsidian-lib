/**
 * @file
 *
 * Integration tests for {@link ensureReleaseAsset} against a live Obsidian instance and a local HTTP server.
 *
 * The unit tests run the in-memory mock adapter and a mocked download. What only a real renderer shows is that the
 * real adapter writes, renames and reads the file inside the config folder, that the renderer's `crypto.subtle`
 * verifies it, and that the resource URL the adapter returns serves the downloaded bytes.
 *
 * The local server is not reachable from the Android emulator, so this file runs on desktop only.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

const ASSET_TEXT = 'release asset bytes';
const HTTP_NOT_FOUND = 404;

interface AssetProbe extends InObsidianAssetProbe {
  readonly downloadCount: number;
}

interface InObsidianAssetProbe {
  readonly cachedWasCached: boolean | undefined;
  readonly firstWasCached: boolean | undefined;
  readonly recoveredText: string;
  readonly recoveredWasCached: boolean | undefined;
  readonly resourceText: string;
}

let server: Server;
let baseUrl: string;
let downloadCount = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/asset.bin') {
      downloadCount++;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(ASSET_TEXT);
      return;
    }
    response.writeHead(HTTP_NOT_FOUND);
    response.end();
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

describe('ensureReleaseAsset', () => {
  it('should download, verify, cache, serve and recover a release asset through the real adapter', async () => {
    const sha256 = createHash('sha256').update(ASSET_TEXT).digest('hex');
    const probe = await evalInObsidian({
      async callback({ app, baseUrl: url, lib: { ensureReleaseAsset }, sha256: expectedSha256 }): Promise<InObsidianAssetProbe> {
        const pluginFolderPath = `${app.vault.configDir}/plugins/obsidian-lib-release-asset-test`;
        const cacheFolderPath = `${pluginFolderPath}/assets`;
        const params = {
          app,
          cacheFolderPath,
          fileName: 'asset.bin',
          sha256: expectedSha256,
          shouldDownload: (): Promise<boolean> => Promise.resolve(true),
          url: `${url}/asset.bin`
        };
        try {
          const first = await ensureReleaseAsset(params);
          const response = first ? await window.fetch(first.resourceUrl) : null;
          const resourceText = response ? await response.text() : '';
          const cached = await ensureReleaseAsset(params);
          await app.vault.adapter.write(`${cacheFolderPath}/asset.bin`, 'corrupt');
          const recovered = await ensureReleaseAsset(params);
          const recoveredText = await app.vault.adapter.read(`${cacheFolderPath}/asset.bin`);
          return {
            cachedWasCached: cached?.wasCached,
            firstWasCached: first?.wasCached,
            recoveredText,
            recoveredWasCached: recovered?.wasCached,
            resourceText
          };
        } finally {
          if (await app.vault.adapter.exists(pluginFolderPath)) {
            await app.vault.adapter.rmdir(pluginFolderPath, true);
          }
        }
      },
      input: { baseUrl, sha256 }
    });

    expect({ ...probe, downloadCount }).toEqual(
      {
        cachedWasCached: true,
        downloadCount: 2,
        firstWasCached: false,
        recoveredText: ASSET_TEXT,
        recoveredWasCached: false,
        resourceText: ASSET_TEXT
      } satisfies AssetProbe
    );
  });
});
