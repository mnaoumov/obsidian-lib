// @vitest-environment jsdom

import type { App as AppOriginal } from 'obsidian';

import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { confirm } from './modals/confirm.ts';
import {
  computeSha256,
  ensureReleaseAsset,
  formatByteSize,
  getGitHubReleaseAssetUrl,
  ReleaseAssetChecksumError
} from './release-asset.ts';
import { requestUrlEx } from './request-url.ts';

vi.mock('./modals/confirm.ts', () => ({ confirm: vi.fn() }));
vi.mock('./request-url.ts', () => ({ requestUrlEx: vi.fn() }));
vi.mock('./i18n/i18n.ts', () => ({
  t: vi.fn((selector: (root: unknown) => unknown, options?: Record<string, unknown>) => {
    const path: string[] = [];
    const proxy: unknown = new Proxy({}, {
      get: (_target, key): unknown => {
        path.push(String(key));
        return proxy;
      }
    });
    selector(proxy);
    return `${path.join('.')}${options ? JSON.stringify(options) : ''}`;
  })
}));

const CACHE_FOLDER = 'config/plugins/test/assets';
const PATH = `${CACHE_FOLDER}/data.bin`;
const URL_ = 'https://example.com/releases/data.bin';

let app: AppOriginal;
let bytes: ArrayBuffer;
let sha256: string;

function mockDownload(data: ArrayBuffer): void {
  vi.mocked(requestUrlEx).mockResolvedValue({ arrayBuffer: data } as Awaited<ReturnType<typeof requestUrlEx>>);
}

function toArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

beforeEach(async () => {
  vi.clearAllMocks();
  app = App.createConfigured__().asOriginalType__();
  bytes = toArrayBuffer('asset bytes');
  sha256 = await computeSha256(bytes);
  mockDownload(bytes);
  vi.mocked(confirm).mockResolvedValue(true);
});

describe('computeSha256', () => {
  it('returns lowercase hex', async () => {
    expect(await computeSha256(toArrayBuffer('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('formatByteSize', () => {
  it('formats bytes and larger units', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(1536)).toBe('1.5 KB');
    expect(formatByteSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatByteSize(3 * 1024 ** 4)).toBe('3072.0 GB');
  });
});

describe('getGitHubReleaseAssetUrl', () => {
  it('builds an encoded release download URL', () => {
    expect(getGitHubReleaseAssetUrl({ fileName: 'a b.wasm', repository: 'owner/repo', tag: '1.2.3' }))
      .toBe('https://github.com/owner/repo/releases/download/1.2.3/a%20b.wasm');
  });
});

describe('ensureReleaseAsset', () => {
  it('asks, downloads, verifies, caches and returns the resource URL', async () => {
    const asset = await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256: sha256.toUpperCase(), sizeInBytes: 2048, url: URL_ });
    expect(asset).toEqual({ path: PATH, resourceUrl: app.vault.adapter.getResourcePath(PATH), wasCached: false });
    expect(new TextDecoder().decode(await app.vault.adapter.readBinary(PATH))).toBe('asset bytes');
    expect(await app.vault.adapter.exists(`${PATH}.download`)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    const [confirmParams] = vi.mocked(confirm).mock.calls[0] ?? [];
    expect(confirmParams?.message).toContain('"size":"2.0 KB"');
    expect(confirmParams?.message).toContain('"host":"example.com"');
    expect(requestUrlEx).toHaveBeenCalledWith({ abortSignal: undefined, timeoutInMilliseconds: undefined, url: URL_ });
  });

  it('reuses a verified cached file without asking or downloading', async () => {
    await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ });
    vi.clearAllMocks();
    const asset = await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ });
    expect(asset?.wasCached).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(requestUrlEx).not.toHaveBeenCalled();
  });

  it('replaces a corrupt cached file', async () => {
    await app.vault.adapter.mkdir(CACHE_FOLDER);
    await app.vault.adapter.writeBinary(PATH, toArrayBuffer('corrupt'));
    const asset = await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ });
    expect(asset?.wasCached).toBe(false);
    expect(new TextDecoder().decode(await app.vault.adapter.readBinary(PATH))).toBe('asset bytes');
  });

  it('uses the unknown-size message when no size is given', async () => {
    await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ });
    const [confirmParams] = vi.mocked(confirm).mock.calls[0] ?? [];
    expect(confirmParams?.message).toContain('consentMessageUnknownSize');
  });

  it('returns null and writes nothing when the user declines', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    expect(await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ })).toBeNull();
    expect(requestUrlEx).not.toHaveBeenCalled();
    expect(await app.vault.adapter.exists(PATH)).toBe(false);
  });

  it('uses a custom consent callback', async () => {
    const shouldDownload = vi.fn(() => Promise.resolve(true));
    await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, shouldDownload, sizeInBytes: 11, url: URL_ });
    expect(shouldDownload).toHaveBeenCalledWith({ fileName: 'data.bin', sizeInBytes: 11, url: URL_ });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('throws on a checksum mismatch and writes nothing', async () => {
    mockDownload(toArrayBuffer('tampered'));
    const promise = ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ });
    await expect(promise).rejects.toBeInstanceOf(ReleaseAssetChecksumError);
    await expect(promise).rejects.toMatchObject({ expectedSha256: sha256, url: URL_ });
    expect(await app.vault.adapter.exists(PATH)).toBe(false);
  });

  it('propagates a download failure', async () => {
    vi.mocked(requestUrlEx).mockRejectedValue(new Error('offline'));
    await expect(ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ })).rejects.toThrow('offline');
  });

  it('does not write when aborted during the download', async () => {
    const controller = new AbortController();
    vi.mocked(requestUrlEx).mockImplementation(() => {
      controller.abort(new Error('unloaded'));
      return Promise.resolve({ arrayBuffer: bytes } as Awaited<ReturnType<typeof requestUrlEx>>);
    });
    await expect(ensureReleaseAsset({ abortSignal: controller.signal, app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ }))
      .rejects.toThrow('unloaded');
    expect(await app.vault.adapter.exists(PATH)).toBe(false);
  });

  it('does not download when aborted while asking', async () => {
    const controller = new AbortController();
    const shouldDownload = vi.fn(() => {
      controller.abort(new Error('unloaded'));
      return Promise.resolve(true);
    });
    await expect(ensureReleaseAsset({ abortSignal: controller.signal, app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, shouldDownload, url: URL_ }))
      .rejects.toThrow('unloaded');
    expect(requestUrlEx).not.toHaveBeenCalled();
  });

  it('rejects at once when already aborted', async () => {
    await expect(ensureReleaseAsset({ abortSignal: AbortSignal.abort(new Error('gone')), app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ }))
      .rejects.toThrow('gone');
  });

  it('removes the temporary file when the write fails', async () => {
    vi.spyOn(app.vault.adapter, 'rename').mockRejectedValue(new Error('disk full'));
    await expect(ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ })).rejects.toThrow('disk full');
    expect(await app.vault.adapter.exists(`${PATH}.download`)).toBe(false);
    expect(await app.vault.adapter.exists(PATH)).toBe(false);
  });

  it('rethrows when the write fails before the temporary file exists', async () => {
    vi.spyOn(app.vault.adapter, 'writeBinary').mockRejectedValue(new Error('read-only'));
    await expect(ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ })).rejects.toThrow('read-only');
  });

  it('replaces a file that appeared at the target path during the download', async () => {
    vi.mocked(requestUrlEx).mockImplementation(async () => {
      await app.vault.adapter.mkdir(CACHE_FOLDER);
      await app.vault.adapter.writeBinary(PATH, toArrayBuffer('stale'));
      return { arrayBuffer: bytes } as Awaited<ReturnType<typeof requestUrlEx>>;
    });
    await ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ });
    expect(new TextDecoder().decode(await app.vault.adapter.readBinary(PATH))).toBe('asset bytes');
  });

  it('shares one operation between concurrent calls', async () => {
    const params = { app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256, url: URL_ };
    const [first, second] = await Promise.all([ensureReleaseAsset(params), ensureReleaseAsset(params)]);
    expect(first).toBe(second);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(requestUrlEx).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'a/b', 'a\\b', '.', '..'])('rejects the file name %j', async (fileName) => {
    await expect(ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName, sha256, url: URL_ })).rejects.toThrow('Invalid asset file name');
  });

  it('rejects an invalid SHA-256', async () => {
    await expect(ensureReleaseAsset({ app, cacheFolderPath: CACHE_FOLDER, fileName: 'data.bin', sha256: 'abc', url: URL_ })).rejects.toThrow('Invalid SHA-256');
  });
});
