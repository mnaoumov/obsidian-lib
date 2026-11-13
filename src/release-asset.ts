/**
 * @file
 *
 * Downloads an optional data asset of a plugin release on demand: it asks the user first, verifies an expected SHA-256
 * before anything is written or exposed, keeps the verified file in a local cache folder and hands back the adapter
 * resource URL.
 *
 * It uses only cross-platform APIs ({@link requestUrlEx}, the vault adapter and `crypto.subtle`), so it works on desktop
 * and mobile alike.
 *
 * Behavior that is part of the contract:
 *
 * - A cached file is hashed on every call. When its hash matches, it is reused without asking or downloading. When it
 *   does not, it is removed and treated as missing, so a corrupt or truncated cache recovers by itself.
 * - The user is asked only when a download is needed. Declining resolves with `null` and writes nothing.
 * - Downloaded bytes are verified before they are written. A mismatch throws {@link ReleaseAssetChecksumError} and
 *   writes nothing.
 * - The file is written to a temporary sibling and then renamed into place, so an interrupted write never leaves a
 *   partial file under the cached name.
 * - An abort (pass the plugin's abort signal, so a plugin unload counts) rejects with the signal's reason. Once the
 *   download has finished, the signal is checked again before writing, so nothing is written after an unload.
 * - Concurrent calls for the same cache path share one operation, so the user is asked once.
 */

import type { App } from 'obsidian';

import { join } from '@mnaoumov/typescript-lib/path';

import { t } from './i18n/i18n.ts';
import { confirm } from './modals/confirm.ts';
import { requestUrlEx } from './request-url.ts';

const BYTES_IN_KILOBYTE = 1024;
const HEX_BYTE_LENGTH = 2;
const HEX_RADIX = 16;
const SHA_256_HEX_REG_EXP = /^[0-9a-f]{64}$/i;
const TEMPORARY_FILE_SUFFIX = '.download';

/**
 * Parameters for {@link ensureReleaseAsset}.
 */
export interface EnsureReleaseAssetParams {
  /**
   * Aborts the operation. Pass the plugin's abort signal, so an unload stops it.
   */
  readonly abortSignal?: AbortSignal | undefined;

  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The vault-relative folder that holds the cached file, typically `${plugin.manifest.dir}/assets`.
   *
   * A folder inside the config folder is not synced, so each device downloads the asset once.
   */
  readonly cacheFolderPath: string;

  /**
   * The name of the cached file. It must not contain a path separator.
   */
  readonly fileName: string;

  /**
   * The expected SHA-256 of the asset, as 64 hexadecimal digits.
   */
  readonly sha256: string;

  /**
   * Asks the user whether to download the asset. Defaults to a confirmation modal.
   *
   * Pass `() => Promise.resolve(true)` when the user has already agreed, for example through a setting.
   */
  readonly shouldDownload?: ((request: ReleaseAssetConsentRequest) => Promise<boolean>) | undefined;

  /**
   * The size of the asset in bytes, shown to the user when asking.
   */
  readonly sizeInBytes?: number | undefined;

  /**
   * The download timeout in milliseconds.
   */
  readonly timeoutInMilliseconds?: number | undefined;

  /**
   * The URL to download the asset from. Only `http:` and `https:` URLs are accepted.
   */
  readonly url: string;
}

/**
 * Parameters for {@link getGitHubReleaseAssetUrl}.
 */
export interface GetGitHubReleaseAssetUrlParams {
  /**
   * The name of the release asset.
   */
  readonly fileName: string;

  /**
   * The repository, as `<owner>/<name>`.
   */
  readonly repository: string;

  /**
   * The release tag, typically the plugin version.
   */
  readonly tag: string;
}

/**
 * A verified release asset.
 */
export interface ReleaseAsset {
  /**
   * The vault-relative path of the cached file.
   */
  readonly path: string;

  /**
   * The resource URL of the cached file, from the adapter's `getResourcePath`.
   */
  readonly resourceUrl: string;

  /**
   * Whether the file was already cached, so nothing was downloaded.
   */
  readonly wasCached: boolean;
}

/**
 * Parameters for {@link ReleaseAssetChecksumError}.
 */
export interface ReleaseAssetChecksumErrorConstructorParams {
  /**
   * The SHA-256 of the downloaded bytes.
   */
  readonly actualSha256: string;

  /**
   * The expected SHA-256.
   */
  readonly expectedSha256: string;

  /**
   * The URL the asset was downloaded from.
   */
  readonly url: string;
}

/**
 * What the user is asked to agree to.
 */
export interface ReleaseAssetConsentRequest {
  /**
   * The name of the asset.
   */
  readonly fileName: string;

  /**
   * The size of the asset in bytes, when known.
   */
  readonly sizeInBytes?: number | undefined;

  /**
   * The URL the asset is downloaded from.
   */
  readonly url: string;
}

/**
 * Thrown when downloaded bytes do not match the expected SHA-256. Nothing was written.
 */
export class ReleaseAssetChecksumError extends Error {
  /**
   * The SHA-256 of the downloaded bytes.
   */
  public readonly actualSha256: string;

  /**
   * The expected SHA-256.
   */
  public readonly expectedSha256: string;

  /**
   * The URL the asset was downloaded from.
   */
  public readonly url: string;

  /**
   * Creates the error.
   *
   * @param params - The parameters.
   */
  public constructor(params: ReleaseAssetChecksumErrorConstructorParams) {
    super(`The asset downloaded from ${params.url} has SHA-256 ${params.actualSha256}, expected ${params.expectedSha256}.`);
    this.name = 'ReleaseAssetChecksumError';
    this.actualSha256 = params.actualSha256;
    this.expectedSha256 = params.expectedSha256;
    this.url = params.url;
  }
}

const inFlightOperations = new Map<string, Promise<null | ReleaseAsset>>();

/**
 * Computes the SHA-256 of the given bytes.
 *
 * @param data - The bytes.
 * @returns The SHA-256 as 64 lowercase hexadecimal digits.
 */
export async function computeSha256(data: ArrayBuffer): Promise<string> {
  const hash = await window.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_LENGTH, '0')).join('');
}

/**
 * Returns the cached, verified asset, downloading it first, with the user's consent, when it is missing or corrupt.
 *
 * @param params - The parameters.
 * @returns The verified asset, or `null` when the user declined the download.
 */
export async function ensureReleaseAsset(params: EnsureReleaseAssetParams): Promise<null | ReleaseAsset> {
  if (!SHA_256_HEX_REG_EXP.test(params.sha256)) {
    throw new Error(`Invalid SHA-256: ${params.sha256}`);
  }

  if (!params.fileName || /[/\\]/.test(params.fileName) || params.fileName === '.' || params.fileName === '..') {
    throw new Error(`Invalid asset file name: ${params.fileName}`);
  }

  const path = join(params.cacheFolderPath, params.fileName);
  const inFlightOperation = inFlightOperations.get(path);
  if (inFlightOperation) {
    return await inFlightOperation;
  }

  const operation = ensureReleaseAssetImpl(params, path);
  inFlightOperations.set(path, operation);
  try {
    return await operation;
  } finally {
    inFlightOperations.delete(path);
  }
}

/**
 * Formats a byte size for a person to read.
 *
 * @param sizeInBytes - The size in bytes.
 * @returns The formatted size, such as `12.3 MB`.
 */
export function formatByteSize(sizeInBytes: number): string {
  if (sizeInBytes < BYTES_IN_KILOBYTE) {
    return `${String(sizeInBytes)} B`;
  }
  let size = sizeInBytes / BYTES_IN_KILOBYTE;
  let unit = 'KB';
  for (const largerUnit of ['MB', 'GB']) {
    if (size < BYTES_IN_KILOBYTE) {
      break;
    }
    size /= BYTES_IN_KILOBYTE;
    unit = largerUnit;
  }
  return `${size.toFixed(1)} ${unit}`;
}

/**
 * Builds the download URL of a GitHub release asset.
 *
 * @param params - The parameters.
 * @returns The URL.
 */
export function getGitHubReleaseAssetUrl(params: GetGitHubReleaseAssetUrlParams): string {
  return `https://github.com/${params.repository}/releases/download/${encodeURIComponent(params.tag)}/${encodeURIComponent(params.fileName)}`;
}

async function ensureReleaseAssetImpl(params: EnsureReleaseAssetParams, path: string): Promise<null | ReleaseAsset> {
  const { abortSignal, app } = params;
  const adapter = app.vault.adapter;
  const expectedSha256 = params.sha256.toLowerCase();
  abortSignal?.throwIfAborted();

  if (await adapter.exists(path)) {
    const cachedBytes = await adapter.readBinary(path);
    if (await computeSha256(cachedBytes) === expectedSha256) {
      return {
        path,
        resourceUrl: adapter.getResourcePath(path),
        wasCached: true
      };
    }
    await adapter.remove(path);
  }

  const consentRequest: ReleaseAssetConsentRequest = {
    fileName: params.fileName,
    sizeInBytes: params.sizeInBytes,
    url: params.url
  };
  const isDownloadAllowed = params.shouldDownload ? await params.shouldDownload(consentRequest) : await shouldDownloadWithModal(app, consentRequest);
  if (!isDownloadAllowed) {
    return null;
  }
  abortSignal?.throwIfAborted();

  const response = await requestUrlEx({
    abortSignal,
    timeoutInMilliseconds: params.timeoutInMilliseconds,
    url: params.url
  });
  const bytes = response.arrayBuffer;
  const actualSha256 = await computeSha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new ReleaseAssetChecksumError({ actualSha256, expectedSha256, url: params.url });
  }
  abortSignal?.throwIfAborted();

  if (!await adapter.exists(params.cacheFolderPath)) {
    await adapter.mkdir(params.cacheFolderPath);
  }

  const temporaryPath = `${path}${TEMPORARY_FILE_SUFFIX}`;
  try {
    await adapter.writeBinary(temporaryPath, bytes);
    if (await adapter.exists(path)) {
      await adapter.remove(path);
    }
    await adapter.rename(temporaryPath, path);
  } catch (error) {
    if (await adapter.exists(temporaryPath)) {
      await adapter.remove(temporaryPath);
    }
    throw error;
  }

  return {
    path,
    resourceUrl: adapter.getResourcePath(path),
    wasCached: false
  };
}

async function shouldDownloadWithModal(app: App, request: ReleaseAssetConsentRequest): Promise<boolean> {
  const host = new URL(request.url).host;
  const message = request.sizeInBytes === undefined
    ? t(($) => $.obsidianLib.releaseAsset.consentMessageUnknownSize, { fileName: request.fileName, host })
    : t(($) => $.obsidianLib.releaseAsset.consentMessage, { fileName: request.fileName, host, size: formatByteSize(request.sizeInBytes) });
  return await confirm({
    app,
    message,
    okButtonText: t(($) => $.obsidianLib.releaseAsset.download),
    title: t(($) => $.obsidianLib.releaseAsset.consentTitle, { fileName: request.fileName })
  });
}
