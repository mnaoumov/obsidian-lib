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

interface InferredChain {
  readonly formerFolder: string;
  readonly transitions: readonly Transition[];
}

interface Transition {
  /**
   * The anchor the transition was written at. Absent from transitions written before it was added.
   */
  readonly anchor?: DataStoreLocation;
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
    const locations = this.buildChain(await this.resolveMovedAnchor(transitions));
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
    const value: Transition = { anchor: this.initial, format: 1, from, to: location };
    await this.anchor.write(`${this.anchor.root}/locations-v1/${window.crypto.randomUUID()}.json`, value);
    await this.refresh();
  }

  private buildChain(transitions: readonly Transition[]): DataStoreLocation[] {
    const remaining = [...transitions];
    const locations = [this.initial];
    let currentIdentity = identity(this.initial);
    while (remaining.length > 0) {
      const sourceIdentity = currentIdentity;
      const next = remaining.filter((transition) => identity(transition.from) === sourceIdentity);
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
        remaining.splice(remaining.indexOf(transition), 1);
      }
    }
    return locations;
  }

  private createTransport(location: DataStoreLocation): DataStoreTransport {
    return new DataStoreTransport({ ...this.params, folder: location.folder, format: location.format ?? 'markdown' });
  }

  /**
   * Maps the records of an anchor folder that was moved (or sits under a moved folder) onto the folder the store is open
   * at, because records name absolute folders.
   *
   * A transition that names its `anchor` is remapped from that folder exactly, so several successive moves resolve too.
   * A transition written before that field existed names no anchor, and a moved anchor then looks the same as a chain whose
   * first record has not arrived yet. So the former folder is inferred only when nothing starts at the initial identity,
   * exactly one candidate folder (one the legacy records start from, in the initial format) yields a complete chain, and
   * that folder no longer holds this store. Anything else is left for `buildChain` to reject.
   *
   * @param transitions - The transitions recorded at the anchor.
   * @returns The transitions to build the chain from.
   */
  private async resolveMovedAnchor(transitions: readonly Transition[]): Promise<readonly Transition[]> {
    const anchored = transitions.map((transition) => transition.anchor ? remapTransition(transition, transition.anchor.folder, this.initial.folder) : transition);
    const initialIdentity = identity(this.initial);
    if (anchored.some((transition) => identity(transition.from) === initialIdentity)) {
      return anchored;
    }
    // A candidate that cannot produce a transition from the initial identity fails `buildChain` below.
    const candidates = new Set(anchored.filter((transition) => !transition.anchor).map((transition) => transition.from.folder));
    const resolved: InferredChain[] = [];
    for (const formerFolder of candidates) {
      const remapped = anchored.map((transition) => transition.anchor ? transition : remapTransition(transition, formerFolder, this.initial.folder));
      try {
        this.buildChain(remapped);
      } catch {
        continue;
      }
      resolved.push({ formerFolder, transitions: remapped });
    }
    const match = resolved.length === 1 ? ensureNonNullable(resolved[0]) : null;
    if (!match) {
      return anchored;
    }
    const formerFiles = await this.createTransport({ ...this.initial, folder: match.formerFolder }).list();
    return formerFiles.length > 0 ? anchored : match.transitions;
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
    && 'from' in value && isLocation(value.from) && 'to' in value && isLocation(value.to)
    && (!('anchor' in value) || isLocation(value.anchor));
}

function remapLocation(location: DataStoreLocation, formerFolder: string, folder: string): DataStoreLocation {
  if (location.folder === formerFolder) {
    return { ...location, folder };
  }
  if (location.folder.startsWith(`${formerFolder}/`)) {
    return { ...location, folder: `${folder}${location.folder.slice(formerFolder.length)}` };
  }
  return location;
}

function remapTransition(transition: Transition, formerFolder: string, folder: string): Transition {
  return {
    ...transition,
    from: remapLocation(transition.from, formerFolder, folder),
    to: remapLocation(transition.to, formerFolder, folder)
  };
}
