/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 * Append-only, anchored discovery of history-preserving transport transitions.
 */

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type { DataStoreTransportConstructorParams } from './data-store-transport.ts';

import { DataStoreTransport } from './data-store-transport.ts';

const MAX_LOCATIONS = 32;

/**
A transport destination. Keep the original open parameters as the discovery anchor.
 */
export interface DataStoreLocation {
  /**
  Vault-relative parent of the plugin/store subtree.
   */
  readonly folder: string;
  /**
   * New document encoding.
   *
   * @default `'markdown'`
   */
  readonly format?: 'json' | 'markdown';
}

interface Transition {
  readonly format: 1;
  readonly from: DataStoreLocation;
  readonly to: DataStoreLocation;
}

/**
Anchored relocation coordinator; source histories are never removed.
 */
export class DataStoreLocations {
  /**
  All readers, oldest first; the last transport is the active writer.
   *
   * @returns All retained reader transports in transition order.
   */
  public get transports(): DataStoreTransport[] {
    return this.locations.map((location) => this.createTransport(location));
  }

  private readonly anchor: DataStoreTransport;
  private readonly initial: DataStoreLocation;

  private locations: DataStoreLocation[];

  /**
   * Creates a coordinator without adapter calls.
   *
   * @param params - Permanent discovery anchor and store identity.
   */
  public constructor(private readonly params: DataStoreTransportConstructorParams) {
    this.anchor = new DataStoreTransport(params);
    this.initial = { folder: params.folder ?? 'Plugin data', format: params.format ?? 'markdown' };
    this.locations = [this.initial];
  }

  /**
   * Discovers and finishes pending copies before allowing a writer to switch destinations.
   * Conflicting branches and reordered incomplete chains fail closed until delivery is complete.
   *
   * @returns A promise that resolves after discovery and verification.
   */
  public async refresh(): Promise<void> {
    const transitions: Transition[] = [];
    for (const path of await this.anchor.list()) {
      if (!path.startsWith(`${this.anchor.root}/locations-v1/`) || !path.endsWith('.json')) {
        continue;
      }
      const value = await this.anchor.read(path);
      if (!isTransition(value)) {
        throw new Error('Incomplete or invalid data-store transition');
      }
      this.validateLocation(value.from);
      this.validateLocation(value.to);
      transitions.push(value);
    }
    const locations = [this.initial];
    let currentIdentity = identity(this.initial);
    while (transitions.length > 0) {
      const sourceIdentity = currentIdentity;
      const next = transitions.filter((transition) => identity(transition.from) === sourceIdentity);
      const targets = new Set(next.map((transition) => identity(transition.to)));
      if (targets.size !== 1) {
        throw new Error('Conflicting or incomplete data-store relocation chain');
      }
      const target = ensureNonNullable(next[0]);
      if (locations.some((location) => identity(location) === identity(target.to)) || locations.length >= MAX_LOCATIONS) {
        throw new Error('Data-store relocation loop or location limit');
      }
      locations.push(target.to);
      currentIdentity = identity(target.to);
      for (const transition of next) {
        transitions.splice(transitions.indexOf(transition), 1);
      }
    }
    // Validate the entire chain before making any copies or activating a writer.
    for (const location of locations) {
      this.validateLocation(location, locations);
    }
    for (const location of locations.slice(1)) {
      const target = this.createTransport(location);
      for (const source of locations.slice(0, locations.indexOf(location))) {
        const transport = this.createTransport(source);
        if (transport.root !== target.root) {
          await transport.copyHistoryTo(target);
        }
      }
    }
    this.locations = locations;
  }

  /**
   * Announces a transition durably at the anchor, then copies and verifies before activation.
   * Retrying the same destination finishes an interrupted copy.
   *
   * @param location - Requested destination.
   * @returns A promise that resolves when the new writer is ready.
   */
  public async relocate(location: DataStoreLocation): Promise<void> {
    this.validateLocation(location);
    await this.refresh();
    this.validateLocation(location);
    const from = ensureNonNullable(this.locations.at(-1));
    if (identity(from) === identity(location)) {
      return;
    }
    if (this.locations.some((previous) => identity(previous) === identity(location)) || this.locations.length >= MAX_LOCATIONS) {
      throw new Error('Data-store relocation loop or location limit');
    }
    const value: Transition = { format: 1, from, to: location };
    await this.anchor.write(`${this.anchor.root}/locations-v1/${window.crypto.randomUUID()}.json`, value);
    await this.refresh();
  }

  private createTransport(location: DataStoreLocation): DataStoreTransport {
    return new DataStoreTransport({ ...this.params, folder: location.folder, format: location.format ?? 'markdown' });
  }

  private validateLocation(location: DataStoreLocation, locations: readonly DataStoreLocation[] = this.locations): void {
    const transport = this.createTransport(location);
    for (const previous of locations) {
      const root = this.createTransport(previous).root;
      if (transport.root !== root && (transport.root.startsWith(`${root}/`) || root.startsWith(`${transport.root}/`))) {
        throw new Error('Overlapping data-store relocation roots');
      }
    }
  }
}

/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */

function identity(location: DataStoreLocation): string {
  return `${location.folder}:${location.format ?? 'markdown'}`;
}

function isLocation(value: unknown): value is DataStoreLocation {
  return typeof value === 'object' && value !== null && 'folder' in value && typeof value.folder === 'string'
    && (!('format' in value) || value.format === 'json' || value.format === 'markdown');
}

function isTransition(value: unknown): value is Transition {
  return typeof value === 'object' && value !== null && 'format' in value && value.format === 1
    && 'from' in value && isLocation(value.from) && 'to' in value && isLocation(value.to);
}
