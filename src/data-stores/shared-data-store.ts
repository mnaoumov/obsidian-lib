/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 *
 * Mergeable plugin data, transported as single-writer journal segments and chunked snapshots.
 */

import type { DataAdapter } from 'obsidian';
import type { JsonValue } from 'type-fest';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type { DataStoreLocation } from './data-store-locations.ts';
import type {
  DataStoreMergeKind,
  DataStoreOperation
} from './data-store-replica.ts';
import type { LocalDataStore } from './local-data-store.ts';

import { DataStoreLocations } from './data-store-locations.ts';
import {
  DataStoreReplica,
  isDataStoreOperation
} from './data-store-replica.ts';
import { DataStoreTransport } from './data-store-transport.ts';

const DEFAULT_ACTIVE_DEVICE_MILLISECONDS = 2_592_000_000;

/**
 * A segment this large is sealed: the next batch opens a new file, so each rewrite of the open one stays small.
 */
const OPEN_SEGMENT_BYTES = 65_536;

/**
 * An unchanged acknowledgement is still rewritten this often, so other devices keep seeing this one as active.
 */
const ACKNOWLEDGEMENT_REFRESH_MILLISECONDS = 86_400_000;
const ACKNOWLEDGEMENT_REFRESHES_PER_RETIREMENT = 4;

const OWNER_PATH_INDEX = -2;

const VECTOR_ENTRY_LENGTH = 2;
const DEVICE_PATH_PARTS = 2;
const DEVICE_ID_REG_EXP = /^[\w-]+$/;
const RECORD_PREFIX = 'shared-record-v1:';

/**
 * Parameters for opening a shared store.
 */
export interface SharedDataStoreOpenParams {
  /**
   * Device retirement interval, measured from its last acknowledgement.
   *
   * @default `2592000000`
   */
  readonly activeDeviceMilliseconds?: number;
  /**
   * Vault adapter.
   */
  readonly adapter: DataAdapter;
  /**
   * Vault-relative folder. Hidden segments are allowed; callers must arrange their synchronization.
   *
   * @default `'Plugin data'`
   */
  readonly folder?: string;
  /**
   * New document encoding at the permanent discovery anchor.
   *
   * @default `'markdown'`
   */
  readonly format?: 'json' | 'markdown';
  /**
   * Enables vault transport. Disabled stores make no adapter calls, including during compaction.
   *
   * @default `true`
   */
  readonly isSyncEnabled?: boolean;
  /**
   * Immutable merge rule; changing it requires a new store id.
   */
  readonly kind: DataStoreMergeKind;
  /**
   * Dedicated local store scoped to THIS vault, plugin and shared-store schema. The caller owns its connection.
   */
  readonly local: LocalDataStore;
  /**
   * Maximum UTF-8 bytes per file, wrapper included.
   *
   * @default `1000000`
   */
  readonly maxFileBytes?: number;
  /**
   * Maximum UTF-8 bytes in a reconstructed snapshot before JSON parsing.
   *
   * @default `64000000`
   */
  readonly maxSnapshotBytes?: number;
  /**
   * Plugin manifest id.
   */
  readonly pluginId: string;
  /**
   * Store id including the consumer's schema version.
   */
  readonly storeId: string;
}

interface Change {
  readonly deleted: boolean;
  readonly key: string;
  readonly value: JsonValue;
}

interface Checkpoint {
  readonly counter: number;
  readonly format: 1;
  readonly kind: DataStoreMergeKind;
  readonly operations: DataStoreOperation[];
  readonly time: number;
  readonly vector: VersionVector;
}

interface JournalSegment extends JournalSegmentFile {
  readonly added: DataStoreOperation[];
}

interface JournalSegmentFile {
  readonly operations: readonly DataStoreOperation[];
  readonly path: string;
}

type VersionVector = [string, number][];

/**
 * A device-local query replica backed by vault files. Call `synchronize` after transport changes or periodically.
 * No timer or event handler outlives the consumer: the consumer schedules synchronization and owns unloading.
 */
export class SharedDataStore {
  /**
  Configured and remembered reader roots, including retained migration sources while disabled.
   *
   * @returns Unique roots suitable for metadata exclusion without adapter access.
   */
  public get transportRoots(): string[] {
    return [...new Set([...this.knownTransportRoots, ...this.locations.transports.map((transport) => transport.root)])];
  }

  private readonly activeDeviceMilliseconds: number;
  private counter = 0;
  private hasUnpublishedChanges = false;
  private isSyncEnabled: boolean;
  private readonly knownTransportRoots = new Set<string>();
  private readonly localRecords = new Map<string, string>();
  private readonly locations: DataStoreLocations;
  private readonly ownSegments = new Map<string, JournalSegmentFile[]>();
  private replica: DataStoreReplica;
  private time = 0;

  private readonly vector = new Map<string, number>();

  private get transport(): DataStoreTransport {
    return ensureNonNullable(this.locations.transports.at(-1));
  }

  private constructor(protected readonly params: SharedDataStoreOpenParams, protected readonly device: string) {
    this.locations = new DataStoreLocations(params);
    this.isSyncEnabled = params.isSyncEnabled ?? true;
    this.replica = new DataStoreReplica(params.kind);
    this.activeDeviceMilliseconds = params.activeDeviceMilliseconds ?? DEFAULT_ACTIVE_DEVICE_MILLISECONDS;
    if (!Number.isFinite(this.activeDeviceMilliseconds) || this.activeDeviceMilliseconds <= 0) {
      throw new Error('Device retirement interval must be positive');
    }
  }

  /**
   * Opens and synchronizes a store, restoring its device identity exclusively from IndexedDB.
   *
   * @param params - Persistence, transport and merge policy.
   * @returns A synchronized query replica.
   */
  public static async open(params: SharedDataStoreOpenParams): Promise<SharedDataStore> {
    const device = await params.local.getOrCreate('shared-device-v1', window.crypto.randomUUID());
    if (typeof device !== 'string' || !DEVICE_ID_REG_EXP.test(device)) {
      throw new Error('Invalid local data-store identity');
    }
    const store = new SharedDataStore(params, device);
    await store.synchronize();
    return store;
  }

  /**
   * Publishes a complete chunked snapshot and trims only this device's acknowledged journal segments.
   * Retired devices rejoin by merging snapshots; tombstones remain in snapshots to prevent resurrection.
   *
   * @returns A promise that resolves when compaction finishes.
   */
  public async compact(): Promise<void> {
    await this.params.local.exclusive(async () => {
      await this.loadLocal();
      await this.mergeFiles();
      await this.persist();
      if (!this.isSyncEnabled) {
        return;
      }
      const files = await this.transport.list();
      const base = `${this.deviceRoot()}/snapshot-${window.crypto.randomUUID()}-manifest`;
      await this.transport.writeSnapshot({ base, payload: this.checkpoint() });
      const acknowledgements = await this.acknowledgements(files);
      for (const path of files) {
        if (!path.startsWith(`${this.deviceRoot()}/log-`)) {
          continue;
        }
        const operations = await this.transport.read(path);
        if (!Array.isArray(operations) || !operations.every(isDataStoreOperation)) {
          continue;
        }
        const last = Math.max(...operations.map((operation) => operation.sequence));
        if (acknowledgements.every((vector) => (vector.get(this.device) ?? 0) >= last)) {
          await this.transport.remove(path);
        }
      }
      // The complete new snapshot covers every earlier snapshot from this writer.
      for (const path of files) {
        if (path.startsWith(`${this.deviceRoot()}/snapshot-`)) {
          await this.transport.remove(path);
        }
      }
    });
  }

  /**
   * Recognizes transport files, roots, and ancestor folder operations for consumer event filters.
   *
   * @param path - Vault-relative file or folder path.
   * @returns Whether the path intersects an active or retained transport root.
   */
  public containsTransportPath(path: string): boolean {
    return this.transportRoots.some((root) => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`));
  }

  /**
   * Deletes a register or removes the currently observed additions of a set member.
   *
   * @param key - Record key or set member. Min/max registers deliberately cannot be deleted.
   * @returns A promise that resolves after journal publication and local commit.
   */
  public async delete(key: string): Promise<void> {
    await this.change([{ deleted: true, key, value: null }]);
  }

  /**
   * Reads the current local query replica.
   *
   * @returns Detached key/value pairs in deterministic order.
   */
  public entries(): [string, unknown][] {
    return this.replica.entries();
  }

  /**
   * Reads a register or set membership from the current local query replica.
   *
   * @param key - Record key or set member.
   * @returns A detached value, or `undefined` when absent or deleted.
   */
  public get(key: string): unknown {
    return this.replica.get(key);
  }

  /**
   * Relocates only this plugin/store subtree; keep opening with the original anchor parameters.
   *
   * @param location - New folder and document format.
   * @returns A promise that resolves after history has been copied and verified.
   */
  public async relocate(location: DataStoreLocation): Promise<void> {
    await this.params.local.exclusive(async () => {
      await this.loadLocal();
      if (!this.isSyncEnabled) {
        throw new Error('Enable data-store synchronization before relocation');
      }
      await this.locations.relocate(location);
      await this.mergeFiles();
      this.hasUnpublishedChanges = true;
      await this.persist();
    });
  }

  /**
   * Writes one register value, or adds a member to an observed-remove set.
   *
   * @param key - Record key or set member.
   * @param value - JSON-compatible value (use `true` for a set).
   * @returns A promise that resolves after journal publication and local commit.
   */
  public async set(key: string, value: JsonValue): Promise<void> {
    await this.setMany([[key, value]]);
  }

  /**
   * Publishes a batch of register writes, appended to this device's open journal segment and split into bounded ones.
   * Segments are individually durable; a failed batch can have a published prefix and can be retried safely.
   *
   * @param entries - Register writes or set additions.
   * @returns A promise that resolves after journal publication and local commit.
   */
  public async setMany(entries: readonly (readonly [string, JsonValue])[]): Promise<void> {
    await this.change(entries.map(([key, value]) => ({ deleted: false, key, value })));
  }

  /**
   * Toggles transport without changing identity or causal state. Persist the preference in consumer settings.
   * Enabling publishes a complete checkpoint so offline sequences cannot leave gaps.
   *
   * @param isEnabled - Whether to use vault transport for subsequent calls on this instance.
   * @returns A promise that resolves after synchronization when enabling.
   */
  public async setSyncEnabled(isEnabled: boolean): Promise<void> {
    await this.params.local.exclusive(async () => {
      await this.loadLocal();
      this.isSyncEnabled = isEnabled;
      await this.mergeFiles();
      await this.persist();
    });
  }

  /**
   * Merges complete snapshots and contiguous journal history, then publishes its durable acknowledgement.
   * Partial deliveries remain pending; a later call retries them. No acknowledgement skips a missing sequence.
   *
   * @returns A promise that resolves after the local checkpoint and acknowledgement commit.
   */
  public async synchronize(): Promise<void> {
    await this.params.local.exclusive(async () => {
      await this.loadLocal();
      await this.mergeFiles();
      await this.persist();
    });
  }

  private async acknowledgements(files: readonly string[]): Promise<Map<string, number>[]> {
    const acknowledgements = [new Map(this.vector)];
    const devicesPrefix = `${this.transport.root}/devices/`;
    const devices = new Set<string>();
    for (const path of files) {
      if (!path.startsWith(devicesPrefix)) {
        continue;
      }
      // Only a folder under `devices/` is a device; a stray file there (such as macOS `.DS_Store`) or a folder whose
      // name is not a valid device id is not one, and counting it would block every trim behind an acknowledgement
      // that never arrives.
      const parts = path.slice(devicesPrefix.length).split('/');
      const device = parts[0];
      if (parts.length >= DEVICE_PATH_PARTS && device !== undefined && DEVICE_ID_REG_EXP.test(device)) {
        devices.add(device);
      }
    }
    for (const device of devices) {
      if (device === this.device) {
        continue;
      }
      const have = await this.transport.read(`${this.transport.root}/devices/${device}/have${this.transport.extension}`);
      if (!isObject(have) || !isVector(have['vector']) || typeof have['time'] !== 'number') {
        acknowledgements.push(new Map());
      } else if (Date.now() - have['time'] <= this.activeDeviceMilliseconds) {
        acknowledgements.push(new Map(have['vector']));
      }
    }
    return acknowledgements;
  }

  private apply(operation: DataStoreOperation): void {
    this.replica.apply(operation);
    this.vector.set(operation.device, operation.sequence);
    this.observeClock(operation.time, operation.counter);
  }

  private async change(changes: readonly Change[]): Promise<void> {
    await this.params.local.exclusive(async () => {
      await this.loadLocal();
      await this.mergeFiles();
      const operations: DataStoreOperation[] = [];
      const candidate = new DataStoreReplica(this.params.kind);
      for (const operation of this.replica.export()) {
        candidate.apply(operation);
      }
      let sequence = this.vector.get(this.device) ?? 0;
      for (const change of changes) {
        const now = Date.now();
        this.counter = now > this.time ? 0 : this.counter + 1;
        this.time = Math.max(now, this.time);
        const operation: DataStoreOperation = {
          ...change,
          counter: this.counter,
          device: this.device,
          sequence: ++sequence,
          tags: candidate.observedTags(change.key),
          time: this.time
        };
        candidate.apply(operation);
        operations.push(operation);
      }
      if (!this.isSyncEnabled) {
        for (const operation of operations) {
          this.apply(operation);
        }
        this.hasUnpublishedChanges = true;
        await this.persist();
        return;
      }
      // Validate every single operation before publishing any prefix of a batch.
      for (const operation of operations) {
        if (!this.transport.fits([operation])) {
          await this.transport.write(this.segmentPath(operation.sequence), [operation]);
        }
      }
      // Grow this device's open segment rather than create a file per batch; a sealed or missing one starts a new file.
      let segment = this.openSegment();
      for (const operation of operations) {
        if (segment && this.transport.fits([...segment.operations, ...segment.added, operation])) {
          segment.added.push(operation);
          continue;
        }
        if (segment && segment.added.length > 0) {
          await this.publish(segment);
        }
        segment = { added: [operation], operations: [], path: this.segmentPath(operation.sequence) };
      }
      if (segment && segment.added.length > 0) {
        await this.publish(segment);
      }
      await this.persist();
    });
  }

  private checkpoint(): Checkpoint {
    return { counter: this.counter, format: 1, kind: this.params.kind, operations: this.replica.export(), time: this.time, vector: [...this.vector] };
  }

  private deviceRoot(): string {
    return `${this.transport.root}/devices/${this.device}`;
  }

  private async loadLocal(): Promise<void> {
    this.replica = new DataStoreReplica(this.params.kind);
    this.vector.clear();
    this.time = 0;
    this.counter = 0;
    this.localRecords.clear();
    this.knownTransportRoots.clear();
    this.hasUnpublishedChanges = false;
    const records = await this.params.local.entries();
    for (const [key, value] of records) {
      switch (key) {
        case 'shared-checkpoint-v1': {
          this.mergeCheckpoint(value);

          break;
        }
        case 'shared-transport-roots-v1': {
          if (!Array.isArray(value)) {
            throw new TypeError('Invalid local data-store transport roots');
          }
          const suffix = `/${this.params.pluginId}/${this.params.storeId}`;
          for (const root of value) {
            if (typeof root !== 'string' || !root.endsWith(suffix)) {
              throw new Error('Invalid local data-store transport roots');
            }
            // Validate remembered paths without reading the adapter or activating a writer.
            const transport = new DataStoreTransport({ ...this.params, folder: root.slice(0, -suffix.length) });
            this.knownTransportRoots.add(transport.root);
          }

          break;
        }
        case 'shared-unpublished-v1': {
          this.hasUnpublishedChanges = value === true;

          break;
        }
        default: {
          if (key.startsWith(RECORD_PREFIX)) {
            this.replica.apply(value);
            this.localRecords.set(key, ensureNonNullable(JSON.stringify(value)));
          }
        }
      }
    }
  }

  private mergeCheckpoint(value: unknown): void {
    if (
      !isObject(value) || value['format'] !== 1 || value['kind'] !== this.params.kind
      || !Array.isArray(value['operations']) || !value['operations'].every(isDataStoreOperation)
      || !isVector(value['vector']) || !Number.isSafeInteger(value['time']) || !Number.isSafeInteger(value['counter'])
    ) {
      throw new Error('Invalid data-store checkpoint or incompatible merge rule');
    }
    for (const operation of value['operations']) {
      this.replica.apply(operation);
    }
    for (const [device, sequence] of value['vector']) {
      this.vector.set(device, Math.max(sequence, this.vector.get(device) ?? 0));
    }
    this.observeClock(Number(value['time']), Number(value['counter']));
  }

  private async mergeFiles(): Promise<void> {
    if (!this.isSyncEnabled) {
      return;
    }
    await this.locations.refresh();
    for (const transport of this.locations.transports) {
      await this.mergeTransport(transport);
    }
  }

  private async mergeTransport(transport: DataStoreTransport): Promise<void> {
    const allFiles = await transport.list();
    const files = allFiles.filter((path) => path.startsWith(`${transport.root}/devices/`));
    const manifests = files.filter((file) => /\/snapshot-[\w-]+-manifest\.(?:md|json)$/.test(file));
    for (const path of manifests) {
      const snapshot = await transport.readSnapshot(path);
      if (snapshot !== undefined) {
        this.mergeCheckpoint(snapshot);
      }
    }
    const operations: DataStoreOperation[] = [];
    const segments = files.filter((file) => /\/log-\d+\.(?:md|json)$/.test(file));
    const ownSegments: [number, JournalSegmentFile][] = [];
    for (const path of segments) {
      const segment = await transport.read(path);
      if (segment === undefined) {
        continue;
      }
      if (!Array.isArray(segment) || !segment.every(isDataStoreOperation)) {
        throw new Error('Invalid data-store journal segment');
      }
      const owner = path.split('/').at(OWNER_PATH_INDEX);
      if (segment.some((operation) => operation.device !== owner)) {
        throw new Error('Journal segment has a different writer');
      }
      const [firstOperation] = segment;
      if (owner === this.device && firstOperation) {
        ownSegments.push([firstOperation.sequence, { operations: segment, path }]);
      }
      operations.push(...segment);
    }
    ownSegments.sort(([first], [second]) => first - second);
    this.ownSegments.set(transport.root, ownSegments.map(([, segment]) => segment));
    operations.sort((first, second) => first.device.localeCompare(second.device) || first.sequence - second.sequence);
    for (const operation of operations) {
      if (operation.sequence === (this.vector.get(operation.device) ?? 0) + 1) {
        this.apply(operation);
      }
    }
  }

  private observeClock(time: number, counter: number): void {
    if (time > this.time) {
      this.time = time;
      this.counter = counter;
    } else if (time === this.time) {
      this.counter = Math.max(this.counter, counter);
    }
  }

  /**
   * Picks the segment the next operation may extend: this device's newest one in the active transport, when it ends
   * exactly at the device's last sequence and is still small enough that rewriting it stays cheap.
   *
   * @returns The open segment, or `null` when the next operation starts a new file.
   */
  private openSegment(): JournalSegment | null {
    const newest = this.ownSegments.get(this.transport.root)?.at(-1);
    if (!newest) {
      return null;
    }
    const last = newest.operations.at(-1);
    return last?.sequence !== this.vector.get(this.device) || this.transport.measure(newest.operations) >= this.openSegmentBytes() ? null : { added: [], operations: newest.operations, path: newest.path };
  }

  private openSegmentBytes(): number {
    return Math.min(OPEN_SEGMENT_BYTES, this.transport.maxFileBytes);
  }

  private async persist(): Promise<void> {
    const checkpoint = this.checkpoint();
    const records = new Map<string, DataStoreOperation>();
    for (const operation of checkpoint.operations) {
      const identity = this.params.kind === 'observed-remove-set' ? `${operation.device}:${String(operation.sequence)}` : operation.key;
      records.set(`${RECORD_PREFIX}${identity}`, operation);
    }
    const entries: [string, unknown][] = [...records].filter(([key, value]) => this.localRecords.get(key) !== JSON.stringify(value));
    const removedKeys = [...this.localRecords.keys()].filter((key) => !records.has(key));
    entries.push(['shared-checkpoint-v1', { ...checkpoint, operations: [] }], ['shared-unpublished-v1', this.hasUnpublishedChanges], ['shared-transport-roots-v1', this.transportRoots]);
    await this.params.local.commit({ entries, removedKeys });
    if (!this.isSyncEnabled) {
      return;
    }
    if (this.hasUnpublishedChanges) {
      await this.transport.writeSnapshot({ base: `${this.deviceRoot()}/snapshot-${window.crypto.randomUUID()}-manifest`, payload: checkpoint });
      await this.params.local.set('shared-unpublished-v1', false);
      this.hasUnpublishedChanges = false;
    }
    await this.publishAcknowledgement();
  }

  private async publish(segment: JournalSegment): Promise<void> {
    await this.transport.writeAppendOnly(segment.path, [...segment.operations, ...segment.added]);
    for (const operation of segment.added) {
      this.apply(operation);
    }
  }

  /**
   * Rewrites `have` only when another device's acknowledged sequence moved, or the stored copy is due a refresh.
   * Other devices read only their own entry from it, so this device's own sequence never forces a write.
   *
   * @returns A promise that resolves once the acknowledgement is current.
   */
  private async publishAcknowledgement(): Promise<void> {
    const path = `${this.deviceRoot()}/have${this.transport.extension}`;
    const acknowledged = JSON.stringify(otherDevices([...this.vector], this.device));
    let stored: unknown;
    try {
      stored = await this.transport.read(path);
    } catch {
      stored = undefined;
    }
    const refreshMilliseconds = Math.min(ACKNOWLEDGEMENT_REFRESH_MILLISECONDS, this.activeDeviceMilliseconds / ACKNOWLEDGEMENT_REFRESHES_PER_RETIREMENT);
    if (
      isObject(stored) && stored['format'] === 1 && isVector(stored['vector']) && typeof stored['time'] === 'number'
      && JSON.stringify(otherDevices(stored['vector'], this.device)) === acknowledged
      && Date.now() - stored['time'] < refreshMilliseconds
    ) {
      return;
    }
    await this.transport.write(path, { format: 1, time: Date.now(), vector: [...this.vector] });
  }

  private segmentPath(firstSequence: number): string {
    return `${this.deviceRoot()}/log-${String(firstSequence)}${this.transport.extension}`;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVector(value: unknown): value is VersionVector {
  return Array.isArray(value) && value.every((entry: unknown) =>
    Array.isArray(entry) && entry.length === VECTOR_ENTRY_LENGTH
    && typeof entry[0] === 'string' && /^[\w-]+$/.test(entry[0]) && Number.isSafeInteger(entry[1]) && Number(entry[1]) >= 0
  );
}

function otherDevices(vector: VersionVector, device: string): VersionVector {
  return vector.filter(([entryDevice]) => entryDevice !== device).sort(([first], [second]) => first.localeCompare(second));
}

/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
