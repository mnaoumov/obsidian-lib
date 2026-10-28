/**
 * @file
 *
 * Incremental per-file projections with stat-based restoration and injected persistence.
 */

import type {
  App,
  Debouncer,
  TAbstractFile
} from 'obsidian';

import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import {
  debounce,
  TFile,
  TFolder,
  Vault
} from 'obsidian';

import { ComponentEx } from './component-ex.ts';

const SAVE_DEBOUNCE_IN_MILLISECONDS = 5000;

/**
 * Dependencies of an incremental index. Persistence must validate its own schema.
 *
 * @typeParam T - The immutable per-file projection.
 */
export interface IncrementalFileIndexComponentConstructorParams<T> {
  /**
   * Files accepted by this index, for example Markdown files only.
   */
  readonly accepts: (file: TFile) => boolean;
  /**
   * The application owning the vault.
   */
  readonly app: App;
  /**
   * Builds an immutable record synchronously; text is never retained by this component.
   */
  readonly indexFile: (params: IndexFileParams) => T;
  /**
   * Reads validated records, or an empty map for a missing/incompatible cache.
   */
  readonly load: () => Promise<ReadonlyMap<string, IndexedFileRecord<T>>>;
  /**
   * Removes a record from a consumer's secondary index. Called for known records only.
   */
  readonly onRemove: (path: string) => void;
  /**
   * Updates a consumer's secondary index, including restored records.
   */
  readonly onSet: (path: string, record: T) => void;
  /**
   * Persists a snapshot; writes are serialized and retried by the next flush after failure.
   */
  readonly save: (records: ReadonlyMap<string, IndexedFileRecord<T>>) => Promise<void>;
  /**
   * Whether a create or modify of the file is followed by a metadata-cache `changed` event carrying its text, as for
   * Markdown notes. Such a file drops its stale projection and is not read; its record returns with that event, or
   * with the next startup or {@link IncrementalFileIndexComponent.rescan} when Obsidian raises none (a modify that left
   * the content unchanged). Consumers must treat a file without a record as unknown. Defaults to never.
   */
  readonly shouldAwaitMetadataChange?: (file: TFile) => boolean;
  /**
   * Whether a projection depends on text alone, so a rename moves it with its stats instead of reading the file again.
   * A file renamed to a path {@link accepts} rejects loses its record either way. Defaults to `false`.
   */
  readonly shouldMoveRecordsOnRename?: boolean;
}

/**
 * A projection and the file stats observed before reading its text.
 *
 * @typeParam T - The immutable per-file projection.
 */
export interface IndexedFileRecord<T> {
  /**
   * Last modification time, in milliseconds.
   */
  readonly mtime: number;
  /**
   * The consumer's immutable projection.
   */
  readonly record: T;
  /**
   * File size in bytes.
   */
  readonly size: number;
}

/**
 * Inputs to a per-file projection.
 */
export interface IndexFileParams {
  /**
   * Text read from the vault, or supplied by a metadata-cache event.
   */
  readonly content: string;
  /**
   * The file being indexed.
   */
  readonly file: TFile;
}

/**
 * Keeps per-file projections current while loaded. Call loadWithPromises after metadata readiness if the
 * projection needs cached metadata. Listeners are installed before restoration, and events win over older reads.
 * Reads are sequential, bounding memory and I/O; consumers own schema, storage location and secondary indexes.
 * Unchanged records are reused by mtime and size, which cannot detect a same-stat external rewrite.
 *
 * @typeParam T - The immutable per-file projection.
 */
export class IncrementalFileIndexComponent<T> extends ComponentEx {
  /**
   * Whether startup reconciliation has completed.
   *
   * @returns Whether the index completed its first reconciliation.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  /**
   * Projection, notifications and persistence supplied by the consumer.
   */
  protected readonly options: Required<IncrementalFileIndexComponentConstructorParams<T>>;

  private isBuiltValue = false;
  private readTail: Promise<void> = noopAsync();
  private readonly records = new Map<string, IndexedFileRecord<T>>();
  private readonly requestSave: Debouncer<[], void>;
  private revision = 0;
  private readonly revisions = new WeakMap<TFile, object>();
  private savedRevision = 0;
  private savePromise: null | Promise<void> = null;

  /**
   * Creates an index with consumer-owned projection and persistence.
   *
   * @param params - The index dependencies.
   */
  public constructor(params: IncrementalFileIndexComponentConstructorParams<T>) {
    super();
    this.options = {
      accepts: params.accepts,
      app: params.app,
      indexFile: params.indexFile,
      load: params.load,
      onRemove: params.onRemove,
      onSet: params.onSet,
      save: params.save,
      shouldAwaitMetadataChange: params.shouldAwaitMetadataChange ?? ((): boolean => false),
      shouldMoveRecordsOnRename: params.shouldMoveRecordsOnRename ?? false
    };
    this.requestSave = debounce(
      () => {
        invokeAsyncSafely(() => this.flush());
      },
      SAVE_DEBOUNCE_IN_MILLISECONDS,
      false
    );
  }

  /**
   * Saves a snapshot after previous writes finish, including changes arriving during a write.
   *
   * @returns Completion of the serialized writes; rejects on persistence failure without marking it saved.
   */
  public async flush(): Promise<void> {
    if (this.savePromise) {
      await this.savePromise;
      return;
    }
    this.savePromise = this.saveChanges();
    try {
      await this.savePromise;
    } finally {
      this.savePromise = null;
    }
  }

  /**
   * Returns a shallow snapshot; consumers must treat records as immutable.
   *
   * @returns Current records by vault-relative path.
   */
  public getRecords(): ReadonlyMap<string, IndexedFileRecord<T>> {
    return new Map(this.records);
  }

  /**
   * Registers changes before startup restoration.
   */
  public override onload(): void {
    const { app } = this.options;
    this.registerEvent(app.metadataCache.on('changed', (file, content) => {
      this.setText(file, content);
    }));

    this.registerEvent(app.vault.on('create', this.handleContentEvent.bind(this)));
    this.registerEvent(app.vault.on('modify', this.handleContentEvent.bind(this)));
    this.registerEvent(app.vault.on('delete', (file) => {
      if (file instanceof TFile) {
        this.removeRecord(file.path);
      } else {
        this.removeTree(file.path);
      }
    }));
    this.registerEvent(app.vault.on('rename', (file, oldPath) => {
      this.rename(file, oldPath);
    }));
  }

  /**
   * Reuses unchanged saved records and reads other files one at a time.
   *
   * @returns Completion of startup reconciliation.
   */
  public override async onloadAsync(): Promise<void> {
    const saved = await this.options.load();
    for (const file of this.options.app.vault.getFiles()) {
      if (this.isUnloaded()) {
        return;
      }
      if (!this.options.accepts(file) || this.revisions.has(file) || this.options.app.vault.getFileByPath(file.path) !== file) {
        continue;
      }
      const entry = saved.get(file.path);
      if (entry?.mtime === file.stat.mtime && entry.size === file.stat.size) {
        this.setRecord(file.path, entry);
      } else {
        await this.scanFile(file);
      }
    }
    await this.readTail;
    if (this.isUnloaded()) {
      return;
    }

    this.isBuiltValue = true;
    this.markDirty();
  }

  /**
   * Cancels the debounce and flushes completed indexes before disposing event listeners.
   */
  public override onunload(): void {
    this.requestSave.cancel();
    if (this.isBuiltValue) {
      invokeAsyncSafely(() => this.flush());
    }
    super.onunload();
  }

  /**
   * Rebuilds projections for every accepted file, for example after a consumer learns new names to find in text.
   * Events arriving during the scan supersede its older reads. Consumers coordinate any domain scan markers.
   *
   * @returns Completion of the bounded full scan.
   */
  public async rescan(): Promise<void> {
    for (const file of this.options.app.vault.getFiles()) {
      await this.scanFile(file);
    }
  }

  private handleContentEvent(file: TAbstractFile): void {
    if (!(file instanceof TFile)) {
      return;
    }
    if (!this.options.shouldAwaitMetadataChange(file)) {
      this.queueScan(file);
      return;
    }
    if (!this.options.accepts(file)) {
      return;
    }
    this.removeRecord(file.path);
    // A fresh token supersedes queued reads, and startup leaves the saved entry to the coming `changed` event.
    this.revisions.set(file, {});
  }

  private markDirty(): void {
    this.revision++;
    if (this.isBuiltValue && !this.isUnloaded()) {
      this.requestSave();
    }
  }

  private moveRecord(file: TFile, oldPath: string): void {
    const entry = this.records.get(oldPath);
    if (entry) {
      this.removeRecord(oldPath);
      if (this.options.accepts(file)) {
        this.setRecord(file.path, entry);
      }
      return;
    }
    // A record already at the new path means another event for this rename moved it first.
    if (!this.records.has(file.path)) {
      this.queueScan(file);
    }
  }

  private queueScan(file: TAbstractFile): void {
    if (file instanceof TFile) {
      invokeAsyncSafely(() => this.scanFile(file));
    }
  }

  private removeRecord(path: string): void {
    if (!this.records.delete(path)) {
      return;
    }

    this.options.onRemove(path);
    this.markDirty();
  }

  private removeTree(path: string): void {
    for (const key of this.records.keys()) {
      if (!(key === path || key.startsWith(`${path}/`))) {
        continue;
      }

      this.removeRecord(key);
    }
  }

  private rename(file: TAbstractFile, oldPath: string): void {
    if (this.options.shouldMoveRecordsOnRename) {
      this.renameMovingRecords(file, oldPath);
      return;
    }
    if (file instanceof TFile) {
      this.removeRecord(oldPath);
    } else {
      this.removeTree(oldPath);
    }
    this.queueScan(file);
    if (file instanceof TFolder) {
      Vault.recurseChildren(file, this.queueScan.bind(this));
    }
  }

  private renameMovingRecords(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      this.moveRecord(file, oldPath);
      return;
    }
    if (!(file instanceof TFolder)) {
      return;
    }
    // Obsidian may also raise a rename per descendant, in either order; moving is idempotent across both.
    Vault.recurseChildren(file, (child) => {
      if (child instanceof TFile) {
        this.moveRecord(child, `${oldPath}${child.path.slice(file.path.length)}`);
      }
    });
    this.removeTree(oldPath);
  }

  private async saveChanges(): Promise<void> {
    while (this.isBuiltValue && this.savedRevision !== this.revision) {
      const revision = this.revision;
      await this.options.save(new Map(this.records));
      this.savedRevision = revision;
    }
  }

  private async scanFile(file: TFile): Promise<void> {
    if (this.isUnloaded() || !this.options.accepts(file)) {
      return;
    }
    this.removeRecord(file.path);
    const token = {};
    this.revisions.set(file, token);
    const { path } = file;
    const { mtime, size } = file.stat;
    const isCurrent = (): boolean =>
      !this.isUnloaded() && this.revisions.get(file) === token && file.path === path
      && file.stat.mtime === mtime && file.stat.size === size && this.options.app.vault.getFileByPath(path) === file;
    const read = this.readTail.then(async () => {
      if (!isCurrent()) {
        return;
      }
      let content: string;
      try {
        content = await this.options.app.vault.cachedRead(file);
      } catch (error) {
        // A file deleted or renamed during its read is the event handlers' to account for.
        if (isCurrent()) {
          throw error;
        }
        return;
      }
      if (!isCurrent()) {
        return;
      }
      this.setText(file, content);
    });
    this.readTail = read.catch(noop);
    await read;
  }

  private setRecord(path: string, entry: IndexedFileRecord<T>): void {
    this.records.set(path, entry);
    this.options.onSet(path, entry.record);
    this.markDirty();
  }

  private setText(file: TFile, content: string): void {
    this.revisions.set(file, {});
    if (!this.isUnloaded() && this.options.accepts(file)) {
      this.setRecord(file.path, { mtime: file.stat.mtime, record: this.options.indexFile({ content, file }), size: file.stat.size });
    }
  }
}
