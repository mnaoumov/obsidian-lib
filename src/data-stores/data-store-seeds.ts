/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 *
 * Optional chunked seeds for expensive derived caches, with per-file validation before reuse.
 */

import type { JsonValue } from 'type-fest';

import type { LocalDataStore } from './local-data-store.ts';

import { isDataStoreJsonValue } from './data-store-replica.ts';
import { DataStoreTransport } from './data-store-transport.ts';

/**
 * A derived record tagged with both cheap statistics and a content hash.
 */
export interface DataStoreSeedEntry extends DataStoreSeedFile {
  /**
   * Content hash, using the same algorithm on every device.
   */
  readonly hash: string;
  /**
   * Consumer-defined JSON cache record.
   */
  readonly value: JsonValue;
}

/**
 * Cheap file identity already available from the vault's file tree.
 */
export interface DataStoreSeedFile {
  /**
   * Last modification time.
   */
  readonly mtime: number;
  /**
   * Vault-relative path.
   */
  readonly path: string;
  /**
   * File size in bytes.
   */
  readonly size: number;
}

/**
 * Parameters for optional cache-seed sharing.
 */
export interface DataStoreSeedsConstructorParams {
  /**
   * Dedicated device-local store that owns the seed publisher identity.
   */
  readonly local: LocalDataStore;
  /**
   * Per-store user setting. Disabled means neither publishing nor adopting seeds.
   */
  readonly share: boolean;
  /**
   * Store-scoped, bounded Markdown transport. Include the consumer schema version in its store id.
   */
  readonly transport: DataStoreTransport;
}

/**
 * Results of validating a shared cache seed against the local vault.
 */
export interface DataStoreSeedValidation {
  /**
   * Files absent from the seed, or with different content.
   */
  readonly rebuild: string[];
  /**
   * Validated seed records, with local file statistics.
   */
  readonly reusable: DataStoreSeedEntry[];
}

/**
 * Parameters for per-file seed validation.
 */
export interface ValidateDataStoreSeedParams {
  /**
   * Seed entries from a recognized consumer schema.
   */
  readonly entries: readonly DataStoreSeedEntry[];
  /**
   * Current file tree, available without reading note text.
   */
  readonly files: readonly DataStoreSeedFile[];
  /**
   * Hashes text only when size matches but mtime differs.
   *
   * @param path - File requiring validation.
   * @returns Its content hash.
   */
  readonly hashFile: (path: string) => Promise<string>;
}

interface Seed {
  readonly entries: DataStoreSeedEntry[];
  readonly format: 1;
  readonly time: number;
}

/**
 * Optional performance hints. Seeds are never authoritative state and must be validated before reuse.
 */
export class DataStoreSeeds {
  /**
   * Device-local identity and serialization boundary.
   */
  protected readonly local: LocalDataStore;
  /**
   * Whether this store shares cache seeds.
   */
  protected readonly share: boolean;
  /**
   * Store-scoped snapshot transport.
   */
  protected readonly transport: DataStoreTransport;
  /**
   * Creates a cache-seed publisher and reader.
   *
   * @param params - Local identity, transport and the per-store sharing setting.
   */
  public constructor(params: DataStoreSeedsConstructorParams) {
    this.local = params.local;
    this.share = params.share;
    this.transport = params.transport;
  }

  /**
   * Publishes a bounded seed, replacing only this device's earlier publications.
   *
   * @param entries - Derived records with file statistics and hashes.
   * @returns Whether sharing was enabled and the seed was published.
   */
  public async publish(entries: readonly DataStoreSeedEntry[]): Promise<boolean> {
    if (!this.share) {
      return false;
    }
    return await this.local.exclusive(async () => {
      const device = await this.local.getOrCreate('seed-device-v1', window.crypto.randomUUID());
      if (typeof device !== 'string' || !/^[\w-]+$/.test(device)) {
        throw new Error('Invalid local seed identity');
      }
      const root = `${this.transport.root}/seeds/${device}`;
      const files = await this.transport.list();
      const base = `${root}/seed-${window.crypto.randomUUID()}-manifest`;
      await this.transport.writeSnapshot({ base, payload: { entries, format: 1, time: Date.now() } });
      for (const path of files) {
        if (path.startsWith(`${root}/seed-`)) {
          await this.transport.remove(path);
        }
      }
      return true;
    });
  }

  /**
   * Reads the newest complete seed for this transport's schema.
   *
   * @returns Seed records, or `undefined` if sharing is disabled or no complete seed is available yet.
   */
  public async readLatest(): Promise<DataStoreSeedEntry[] | undefined> {
    if (!this.share) {
      return undefined;
    }
    const files = await this.transport.list();
    let newest = -Infinity;
    let entries: DataStoreSeedEntry[] | undefined;
    for (const path of files) {
      if (!/\/seed-[\w-]+-manifest\.md$/.test(path)) {
        continue;
      }
      let seed: unknown;
      try {
        seed = await this.transport.readSnapshot(path);
      } catch (error) {
        if (error instanceof SyntaxError) {
          continue;
        }
        throw error;
      }
      if (!(isSeed(seed) && seed.time > newest)) {
        continue;
      }

      newest = seed.time;
      entries = seed.entries;
    }
    return entries;
  }
}

/**
 * Validates a seed using free file statistics first, hashing only size-equal mtime mismatches.
 * Files absent locally are discarded. Consumers index only the returned rebuild paths.
 *
 * @param params - Seed, current file tree and content-hash reader.
 * @returns Reusable records and the paths that still need indexing.
 */
export async function validateDataStoreSeed(params: ValidateDataStoreSeedParams): Promise<DataStoreSeedValidation> {
  const seed = new Map(params.entries.map((entry) => [entry.path, entry]));
  const reusable: DataStoreSeedEntry[] = [];
  const rebuild: string[] = [];
  for (const file of params.files) {
    const entry = seed.get(file.path);
    if (entry?.size === file.size && (entry.mtime === file.mtime || entry.hash === await params.hashFile(file.path))) {
      reusable.push({ ...entry, ...file });
    } else {
      rebuild.push(file.path);
    }
  }
  return { rebuild, reusable };
}

function isSeed(value: unknown): value is Seed {
  return typeof value === 'object' && value !== null && 'format' in value && value.format === 1
    && 'time' in value && typeof value.time === 'number' && Number.isFinite(value.time)
    && 'entries' in value && Array.isArray(value.entries) && value.entries.every((entry: unknown) =>
      typeof entry === 'object' && entry !== null && 'path' in entry && typeof entry.path === 'string'
      && 'mtime' in entry && typeof entry.mtime === 'number' && Number.isFinite(entry.mtime)
      && 'size' in entry && typeof entry.size === 'number' && Number.isFinite(entry.size)
      && 'hash' in entry && typeof entry.hash === 'string' && 'value' in entry && isDataStoreJsonValue(entry.value)
    );
}

/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
