/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 *
 * Size-bounded Markdown or JSON transport, with verified chunked snapshots.
 */

import type { DataAdapter } from 'obsidian';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { Notice } from 'obsidian';

import { getObsidianLibDebugger } from '../debug.ts';

const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const MIN_FILE_BYTES = 256;
const MAX_FILE_BYTES = 4_000_000;
const MAX_SNAPSHOT_BYTES = 64_000_000;
const DOCUMENT_PREFIX = '```json\n';
const DOCUMENT_SUFFIX = '\n```\n';
const BISECTION_DIVISOR = 2;
const HEX_RADIX = 16;
const HEX_BYTE_LENGTH = 2;
const JOURNAL_SEGMENT_REG_EXP = /\/log-\d+\.(?:md|json)$/;

/**
 * Parameters for the shared-store vault transport.
 */
export interface DataStoreTransportConstructorParams {
  /**
   * Vault adapter; no desktop filesystem APIs are used.
   */
  readonly adapter: DataAdapter;
  /**
   * Vault-relative folder. Hidden segments are allowed; callers must arrange their synchronization.
   *
   * @default `'Plugin data'`
   */
  readonly folder?: string;
  /**
   * Document encoding. JSON requires a sync tool configured to carry arbitrary files.
   *
   * @default `'markdown'`
   */
  readonly format?: 'json' | 'markdown';
  /**
   * Maximum UTF-8 bytes in any file, including its encoding wrapper.
   *
   * @default `1000000`
   */
  readonly maxFileBytes?: number;
  /**
   * Maximum UTF-8 bytes in the reconstructed snapshot, before JSON parsing.
   *
   * @default `64000000`
   */
  readonly maxSnapshotBytes?: number;
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
   * Vault-relative base path without its extension. Use a fresh unique name for every publication.
   */
  readonly base: string;
  /**
   * JSON-compatible snapshot, including its consumer schema and coverage metadata.
   */
  readonly payload: unknown;
}

/**
 * A store-scoped transport. Every published document is immutable except device acknowledgements and append-only
 * journal segments, which only their own device rewrites and only by extending them.
 */
export class DataStoreTransport {
  /**
  File extension for new documents.
   */
  public readonly extension: string;
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
  private readonly maxSnapshotBytes: number;

  /**
   * Creates a bounded vault transport.
   *
   * @param params - Adapter, identity and file bounds.
   */
  public constructor(protected readonly params: DataStoreTransportConstructorParams) {
    this.adapter = params.adapter;
    this.extension = params.format === 'json' ? '.json' : '.md';
    const folder = params.folder ?? 'Plugin data';
    if (
      !isSafeVaultPath(folder)
      || !/^[\w-]+$/.test(params.pluginId) || !/^[\w-]+$/.test(params.storeId)
    ) {
      throw new Error('Data store requires a safe vault-relative folder and safe plugin/store ids');
    }
    this.root = `${folder}/${params.pluginId}/${params.storeId}`;
    this.maxFileBytes = params.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < MIN_FILE_BYTES || this.maxFileBytes > MAX_FILE_BYTES) {
      throw new Error('Data-store file limit must be between 256 and 4000000 bytes');
    }
    this.maxSnapshotBytes = params.maxSnapshotBytes ?? MAX_SNAPSHOT_BYTES;
    if (!Number.isSafeInteger(this.maxSnapshotBytes) || this.maxSnapshotBytes < MIN_FILE_BYTES || this.maxSnapshotBytes > MAX_SNAPSHOT_BYTES) {
      throw new Error('Data-store snapshot limit must be between 256 and 64000000 bytes');
    }
  }

  /**
   * Copies history byte for byte, preserving source files and refusing conflicting immutable destinations.
   * Acknowledgements are local to each location and are not copied.
   *
   * @param target - Destination for this same plugin and store.
   * @returns A promise that resolves after every copied file has been verified.
   */
  public async copyHistoryTo(target: DataStoreTransport): Promise<void> {
    if (this.params.pluginId !== target.params.pluginId || this.params.storeId !== target.params.storeId) {
      throw new Error('Cannot copy data-store history to a different store');
    }
    const allFiles = await this.list();
    const files = allFiles.filter((path) => path.startsWith(`${this.root}/devices/`));
    const complete = new Set<string>();
    for (const path of files) {
      if (JOURNAL_SEGMENT_REG_EXP.test(path) && await this.read(path) !== undefined) {
        complete.add(path);
      }
      if (!/\/snapshot-[\w-]+-manifest\.(?:md|json)$/.test(path) || await this.readSnapshot(path) === undefined) {
        continue;
      }
      const extension = path.endsWith('.json') ? '.json' : '.md';
      const base = path.slice(0, -extension.length);
      for (const chunk of files) {
        if (chunk.startsWith(`${base}-`) && chunk.endsWith(extension)) {
          complete.add(chunk);
        }
      }
      complete.add(path);
    }
    for (const path of complete) {
      this.checkPath(path);
      const text = await this.adapter.read(path);
      this.checkSize(text);
      target.checkSize(text);
      const destination = target.root + path.slice(this.root.length);
      target.checkPath(destination);
      if (await target.adapter.exists(destination)) {
        if (await target.adapter.read(destination) !== text && !await this.copyOverDifferentHistory(target, path, destination, text)) {
          continue;
        }
      } else {
        await target.ensureParent(destination);
        await target.adapter.write(destination, text);
      }
      if (await target.adapter.read(destination) !== text) {
        throw new Error('Data-store history copy failed verification');
      }
    }
  }

  /**
   * Tests the complete encoded size without writing.
   *
   * @param value - JSON payload.
   * @returns Whether its document fits the configured cap.
   */
  public fits(value: unknown): boolean {
    return this.measure(value) <= this.maxFileBytes;
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
   * Measures the complete encoded size of a new document without writing.
   *
   * @param value - JSON payload.
   * @returns UTF-8 bytes, encoding wrapper included.
   */
  public measure(value: unknown): number {
    return new TextEncoder().encode(this.encode(value)).length;
  }

  /**
   * Reads complete fenced Markdown JSON or a version-one JSON envelope. Partial documents remain pending.
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
    if (path.endsWith('.json')) {
      let document: unknown;
      try {
        document = JSON.parse(text);
      } catch {
        return undefined;
      }
      if (typeof document !== 'object' || document === null || !('format' in document) || document.format !== 1 || !('payload' in document)) {
        throw new Error('Invalid JSON data-store document');
      }
      return document.payload;
    }
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
    let bytes = 0;
    for (const [index, hash] of manifest.hashes.entries()) {
      const extension = path.endsWith('.json') ? '.json' : '.md';
      const chunk = await this.read(`${path.slice(0, -extension.length)}-${String(index)}${extension}`);
      if (typeof chunk !== 'string' || await digest(chunk) !== hash) {
        return undefined;
      }
      bytes += new TextEncoder().encode(chunk).length;
      if (bytes > this.maxSnapshotBytes) {
        throw new Error('Data-store snapshot exceeds decoded byte limit');
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
    const text = this.encode(value, path.endsWith('.json'));
    this.checkSize(text);
    await this.ensureParent(path);
    await this.adapter.write(path, text);
  }

  /**
   * Publishes an append-only document: an occupied path is rewritten only when the new list strictly extends the stored one.
   * A reader that sees an older copy sees a prefix, so it applies fewer entries and never a different one.
   *
   * @param path - Vault-relative destination within this store.
   * @param values - JSON-compatible entries; the stored entries must be their prefix.
   * @returns A promise that resolves after publication, or at once when the stored list is already identical.
   */
  public async writeAppendOnly(path: string, values: readonly unknown[]): Promise<void> {
    this.checkPath(path);
    const text = this.encode(values, path.endsWith('.json'));
    this.checkSize(text);
    if (await this.adapter.exists(path)) {
      const stored = await this.readStoredList(path);
      if (stored === undefined || !isListPrefix(stored, values)) {
        throw new Error('Conflicting immutable data-store document');
      }
      if (stored.length === values.length) {
        return;
      }
      await this.adapter.write(path, text);
      return;
    }
    await this.ensureParent(path);
    await this.adapter.write(path, text);
  }

  /**
   * Publishes an immutable document, accepting only byte-identical retries at an occupied path.
   *
   * @param path - Vault-relative destination within this store.
   * @param value - JSON-compatible payload.
   * @returns A promise that resolves after publication or an identical retry.
   */
  public async writeImmutable(path: string, value: unknown): Promise<void> {
    this.checkPath(path);
    const text = this.encode(value, path.endsWith('.json'));
    this.checkSize(text);
    if (await this.adapter.exists(path)) {
      if (await this.adapter.read(path) !== text) {
        throw new Error('Conflicting immutable data-store document');
      }
      return;
    }
    await this.ensureParent(path);
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
    if (new TextEncoder().encode(payload).length > this.maxSnapshotBytes) {
      throw new Error('Data-store snapshot exceeds decoded byte limit');
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
      await this.write(`${params.base}-${String(index)}${this.extension}`, chunk);
    }
    await this.write(`${params.base}${this.extension}`, manifest);
  }

  private checkPath(path: string): void {
    if (!path.startsWith(`${this.root}/`) || !isSafeVaultPath(path)) {
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

  /**
   * Reconciles a destination whose bytes differ from the source. Only a journal segment may differ, because it grows
   * while its device writes it, so either copy may be the older prefix of the other; anything else is a conflict.
   *
   * @param target - Destination transport.
   * @param path - Source path.
   * @param destination - Destination path.
   * @param text - Source bytes.
   * @returns Whether the source was written over the destination, which must then be verified.
   */
  private async copyOverDifferentHistory(target: DataStoreTransport, path: string, destination: string, text: string): Promise<boolean> {
    const source = JOURNAL_SEGMENT_REG_EXP.test(path) ? await this.readStoredList(path) : undefined;
    const copied = source === undefined ? undefined : await target.readStoredList(destination);
    if (source === undefined || copied === undefined) {
      throw new Error('Conflicting immutable data-store history');
    }
    if (isListPrefix(source, copied)) {
      return false;
    }
    if (!isListPrefix(copied, source)) {
      throw new Error('Conflicting immutable data-store history');
    }
    await target.adapter.write(destination, text);
    return true;
  }

  private encode(value: unknown, isJson = this.extension === '.json'): string {
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new Error('Data-store payload must be JSON-compatible');
    }
    return isJson ? JSON.stringify({ format: 1, payload: value }) : `${DOCUMENT_PREFIX}${json}${DOCUMENT_SUFFIX}`;
  }

  private async ensureParent(path: string): Promise<void> {
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
  }

  private async readStoredList(path: string): Promise<undefined | unknown[]> {
    let value: unknown;
    try {
      value = await this.read(path);
    } catch {
      return undefined;
    }
    return Array.isArray(value) ? value : undefined;
  }
}

async function digest(text: string): Promise<string> {
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_LENGTH, '0')).join('');
}

function isListPrefix(prefix: readonly unknown[], list: readonly unknown[]): boolean {
  return prefix.length <= list.length && prefix.every((value, index) => JSON.stringify(value) === JSON.stringify(list[index]));
}

function isSafeVaultPath(path: string): boolean {
  return path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..' && !/[<>:"\\|?*\p{Control}]|[. ]$/u.test(part));
}

/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
