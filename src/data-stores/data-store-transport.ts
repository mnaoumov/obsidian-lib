/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 *
 * Size-bounded Markdown transport carried by vault synchronization with default file types.
 */

import type { DataAdapter } from 'obsidian';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { Notice } from 'obsidian';

import { getObsidianLibDebugger } from '../debug.ts';

const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const MIN_FILE_BYTES = 256;
const MAX_FILE_BYTES = 4_000_000;
const DOCUMENT_PREFIX = '```json\n';
const DOCUMENT_SUFFIX = '\n```\n';
const BISECTION_DIVISOR = 2;
const HEX_RADIX = 16;
const HEX_BYTE_LENGTH = 2;

/**
 * Parameters for the shared-store vault transport.
 */
export interface DataStoreTransportConstructorParams {
  /**
   * Vault adapter; no desktop filesystem APIs are used.
   */
  readonly adapter: DataAdapter;
  /**
   * Configurable non-dot vault folder.
   *
   * @default `'Plugin data'`
   */
  readonly folder?: string;
  /**
   * Maximum UTF-8 bytes in any file, including its Markdown wrapper.
   *
   * @default `1000000`
   */
  readonly maxFileBytes?: number;
  /**
   * Plugin manifest id.
   */
  readonly pluginId: string;
  /**
   * Store name including its consumer schema version.
   */
  readonly storeId: string;
}

/**
 * Parameters for publishing a chunked snapshot.
 */
export interface DataStoreTransportWriteSnapshotParams {
  /**
   * Vault-relative base path without the `.md` extension. Use a fresh unique name for every publication.
   */
  readonly base: string;
  /**
   * JSON-compatible snapshot, including its consumer schema and coverage metadata.
   */
  readonly payload: unknown;
}

/**
 * A store-scoped transport. Every published document is immutable except device acknowledgements.
 */
export class DataStoreTransport {
  /**
   * Maximum encoded bytes per document.
   */
  public readonly maxFileBytes: number;
  /**
   * Full vault-relative store root.
   */
  public readonly root: string;
  /**
   * Vault adapter used by this transport.
   */
  protected readonly adapter: DataAdapter;

  /**
   * Creates a bounded vault transport.
   *
   * @param params - Adapter, identity and file bounds.
   */
  public constructor(protected readonly params: DataStoreTransportConstructorParams) {
    this.adapter = params.adapter;
    const folder = params.folder ?? 'Plugin data';
    if (
      !folder || folder.split('/').some((part) => !part || part.startsWith('.') || part.includes('\\'))
      || !/^[\w-]+$/.test(params.pluginId) || !/^[\w-]+$/.test(params.storeId)
    ) {
      throw new Error('Data store requires a non-dot vault folder and safe plugin/store ids');
    }
    this.root = `${folder}/${params.pluginId}/${params.storeId}`;
    this.maxFileBytes = params.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < MIN_FILE_BYTES || this.maxFileBytes > MAX_FILE_BYTES) {
      throw new Error('Data-store file limit must be between 256 and 4000000 bytes');
    }
  }

  /**
   * Tests the complete encoded size without writing.
   *
   * @param value - JSON payload.
   * @returns Whether its document fits the configured cap.
   */
  public fits(value: unknown): boolean {
    return new TextEncoder().encode(this.encode(value)).length <= this.maxFileBytes;
  }

  /**
   * Lists the store's files recursively, never leaving its folder.
   *
   * @returns Vault-relative paths.
   */
  public async list(): Promise<string[]> {
    if (!await this.adapter.exists(this.root)) {
      return [];
    }
    const pending = [this.root];
    const files: string[] = [];
    while (pending.length > 0) {
      const folder = ensureNonNullable(pending.shift());
      const children = await this.adapter.list(folder);
      files.push(...children.files.filter((path) => path.startsWith(`${folder}/`)));
      pending.push(...children.folders.filter((path) => path.startsWith(`${folder}/`)));
    }
    return files.sort();
  }

  /**
   * Reads a complete fenced JSON document. Partial or not-yet-delivered documents are ignored.
   *
   * @param path - Vault-relative file within this store.
   * @returns Parsed JSON, or `undefined` for an incomplete document.
   */
  public async read(path: string): Promise<unknown> {
    this.checkPath(path);
    if (!await this.adapter.exists(path)) {
      return undefined;
    }
    let text: string;
    try {
      text = await this.adapter.read(path);
    } catch (error) {
      if (!await this.adapter.exists(path)) {
        return undefined;
      }
      throw error;
    }
    this.checkSize(text);
    if (!text.startsWith(DOCUMENT_PREFIX) || !text.endsWith(DOCUMENT_SUFFIX)) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(text.slice(DOCUMENT_PREFIX.length, -DOCUMENT_SUFFIX.length));
    return parsed;
  }

  /**
   * Reads a snapshot only after every numbered chunk arrives and passes its SHA-256 check.
   *
   * @param path - Vault-relative manifest path.
   * @returns Its payload, or `undefined` while delivery is incomplete.
   */
  public async readSnapshot(path: string): Promise<unknown> {
    const manifest = await this.read(path);
    if (
      typeof manifest !== 'object' || manifest === null || !('format' in manifest) || manifest.format !== 1
      || !('hashes' in manifest) || !Array.isArray(manifest.hashes)
      || manifest.hashes.length === 0 || manifest.hashes.some((hash: unknown) => typeof hash !== 'string')
    ) {
      return undefined;
    }
    const chunks: string[] = [];
    for (const [index, hash] of manifest.hashes.entries()) {
      const chunk = await this.read(`${path.slice(0, -'.md'.length)}-${String(index)}.md`);
      if (typeof chunk !== 'string' || await digest(chunk) !== hash) {
        return undefined;
      }
      chunks.push(chunk);
    }
    const parsed: unknown = JSON.parse(chunks.join(''));
    return parsed;
  }

  /**
   * Removes a document owned by the caller's device.
   *
   * @param path - Vault-relative file within this store.
   * @returns A promise that resolves after removal.
   */
  public async remove(path: string): Promise<void> {
    this.checkPath(path);
    await this.adapter.remove(path);
  }

  /**
   * Writes a complete document, refusing an oversized write before adapter mutation.
   *
   * @param path - Vault-relative file within this store.
   * @param value - JSON-compatible payload.
   * @returns A promise that resolves once the adapter finishes writing.
   */
  public async write(path: string, value: unknown): Promise<void> {
    this.checkPath(path);
    const text = this.encode(value);
    this.checkSize(text);
    const parts = path.split('/');
    parts.pop();
    let folder = '';
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      if (!await this.adapter.exists(folder)) {
        try {
          await this.adapter.mkdir(folder);
        } catch (error) {
          if (!await this.adapter.exists(folder)) {
            throw error;
          }
        }
      }
    }
    await this.adapter.write(path, text);
  }

  /**
   * Publishes bounded immutable chunks before their manifest. Readers verify delivery completeness.
   *
   * @param params - Unique base path and snapshot payload.
   * @returns A promise that resolves when the manifest has been published.
   */
  public async writeSnapshot(params: DataStoreTransportWriteSnapshotParams): Promise<void> {
    const payload = JSON.stringify(params.payload);
    if (payload === undefined) {
      throw new Error('Snapshot must be JSON-compatible');
    }
    const chunks: string[] = [];
    let offset = 0;
    while (offset < payload.length) {
      let low = 1;
      let high = Math.min(payload.length - offset, this.maxFileBytes);
      while (low < high) {
        const middle = Math.ceil((low + high) / BISECTION_DIVISOR);
        if (this.fits(payload.slice(offset, offset + middle))) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      chunks.push(payload.slice(offset, offset + low));
      offset += low;
    }
    const hashes: string[] = [];
    for (const chunk of chunks) {
      hashes.push(await digest(chunk));
    }
    const manifest = { format: 1, hashes };
    this.checkSize(this.encode(manifest));
    for (const [index, chunk] of chunks.entries()) {
      await this.write(`${params.base}-${String(index)}.md`, chunk);
    }
    await this.write(`${params.base}.md`, manifest);
  }

  private checkPath(path: string): void {
    if (!path.startsWith(`${this.root}/`) || path.split('/').some((part) => !part || part.startsWith('.') || part.includes('\\'))) {
      throw new Error('Data-store path leaves its configured folder');
    }
  }

  private checkSize(text: string): void {
    const size = new TextEncoder().encode(text).length;
    if (size <= this.maxFileBytes) {
      return;
    }
    const message = `Plugin data store: ${String(size)} bytes exceeds the ${String(this.maxFileBytes)} byte file limit.`;
    new Notice(message);
    getObsidianLibDebugger('DataStore')(message);
    throw new Error(message);
  }

  private encode(value: unknown): string {
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new Error('Data-store payload must be JSON-compatible');
    }
    return `${DOCUMENT_PREFIX}${json}${DOCUMENT_SUFFIX}`;
  }
}

async function digest(text: string): Promise<string> {
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_LENGTH, '0')).join('');
}

/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
