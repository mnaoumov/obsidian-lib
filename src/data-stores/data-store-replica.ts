/* eslint-disable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
/**
 * @file
 *
 * Merge-safe registers and observed-remove sets used by shared data stores.
 */

import type { JsonValue } from 'type-fest';

/**
 * A store fixes its merge rule for its entire lifetime and schema version.
 */
export type DataStoreMergeKind = 'last-write-wins' | 'maximum' | 'minimum' | 'observed-remove-set';

/**
 * A version-one journal operation. These fields form a published wire format.
 */
export interface DataStoreOperation {
  /**
   * Logical counter within the wall-clock millisecond.
   */
  readonly counter: number;
  /**
   * Whether this is a removal.
   */
  readonly deleted: boolean;
  /**
   * Unique writer incarnation, stored locally rather than in plugin settings.
   */
  readonly device: string;
  /**
   * Record key, or set member.
   */
  readonly key: string;
  /**
   * Strictly increasing writer sequence, starting at one.
   */
  readonly sequence: number;
  /**
   * Observed addition tags removed by a set operation.
   */
  readonly tags?: readonly string[];
  /**
   * Hybrid logical clock wall time.
   */
  readonly time: number;
  /**
   * JSON-compatible value; set members use `true`.
   */
  readonly value: unknown;
}

/**
 * In-memory CRDT state. Exported operations can be joined in any order, repeatedly.
 */
export class DataStoreReplica {
  private readonly additions = new Map<string, DataStoreOperation>();
  private readonly registers = new Map<string, DataStoreOperation>();
  private readonly removals = new Map<string, DataStoreOperation>();

  /**
   * Creates an empty replica.
   *
   * @param kind - Immutable merge rule for the store.
   */
  public constructor(protected readonly kind: DataStoreMergeKind) {}

  /**
   * Validates and joins one journal or snapshot operation.
   *
   * @param value - Untrusted parsed operation.
   */
  public apply(value: unknown): void {
    if (!isDataStoreOperation(value)) {
      throw new Error('Invalid data-store operation');
    }
    const operation = window.structuredClone(value);
    if (this.kind === 'observed-remove-set') {
      this.applySet(operation);
      return;
    }
    const previous = this.registers.get(operation.key);
    if (this.kind !== 'last-write-wins' && (operation.deleted || rankOf(operation.value) === undefined)) {
      throw new Error('Min/max stores accept finite numbers or ranked JSON values and do not support deletion');
    }
    if (!previous || this.wins(operation, previous)) {
      this.registers.set(operation.key, operation);
    }
  }

  /**
   * Reads visible records, detached from internal state.
   *
   * @returns Pairs in deterministic key order.
   */
  public entries(): [string, unknown][] {
    if (this.kind === 'observed-remove-set') {
      const keys = new Set(this.activeAdditions().map((operation) => operation.key));
      return [...keys].sort().map((key) => [key, true]);
    }
    return [...this.registers.values()].filter((operation) => !operation.deleted)
      .sort((first, second) => first.key.localeCompare(second.key))
      .map((operation) => [operation.key, window.structuredClone(operation.value)]);
  }

  /**
   * Exports mergeable state, retaining tombstones for late or retired replicas.
   *
   * @returns Deterministically ordered operations sufficient to reconstruct this state.
   */
  public export(): DataStoreOperation[] {
    return [...this.registers.values(), ...this.activeAdditions(), ...this.removals.values()]
      .sort((first, second) => tag(first).localeCompare(tag(second))).map((operation) => window.structuredClone(operation));
  }

  /**
   * Reads a register or set membership without enumerating register keys.
   *
   * @param key - Record key or set member.
   * @returns A detached value, or `undefined` when absent or deleted.
   */
  public get(key: string): unknown {
    if (this.kind === 'observed-remove-set') {
      return this.activeAdditions().some((operation) => operation.key === key) || undefined;
    }
    const operation = this.registers.get(key);
    return operation && !operation.deleted ? window.structuredClone(operation.value) : undefined;
  }

  /**
   * Finds additions observed for a set member, for an observed removal.
   *
   * @param key - Set member.
   * @returns Addition identities. Concurrent unseen additions survive removal.
   */
  public observedTags(key: string): string[] {
    return [...this.additions.values()].filter((operation) => operation.key === key).map((operation) => tag(operation)).sort();
  }

  private activeAdditions(): DataStoreOperation[] {
    return [...this.additions.values()].filter((operation) => {
      const removed = tagVector(this.removals.get(operation.key)?.tags ?? []);
      return operation.sequence > (removed.get(operation.device) ?? 0);
    });
  }

  private applySet(operation: DataStoreOperation): void {
    if (operation.deleted) {
      const previous = this.removals.get(operation.key);
      const vector = tagVector([...(previous?.tags ?? []), ...(operation.tags ?? [])]);
      const winner = previous && this.wins(previous, operation) ? previous : operation;
      this.removals.set(operation.key, { ...winner, tags: [...vector].sort(([first], [second]) => first.localeCompare(second)).map(([device, sequence]) => `${device}:${String(sequence)}`) });
    } else {
      if (operation.value !== true) {
        throw new Error('Set additions use true as their value');
      }
      const key = `${operation.key}:${operation.device}`;
      const previous = this.additions.get(key);
      if (!previous || operation.sequence > previous.sequence) {
        this.additions.set(key, operation);
      }
    }
  }

  private wins(next: DataStoreOperation, previous: DataStoreOperation): boolean {
    const nextRank = rankOf(next.value);
    const previousRank = rankOf(previous.value);
    if (this.kind === 'minimum' && nextRank !== previousRank) {
      return Number(nextRank) < Number(previousRank);
    }
    return this.kind === 'maximum' && nextRank !== previousRank ? Number(nextRank) > Number(previousRank) : next.time > previous.time || (next.time === previous.time && (next.counter > previous.counter
      || (next.counter === previous.counter && next.device > previous.device)));
  }
}

/**
 * Checks that a value survives JSON transport without changing its meaning.
 *
 * @param value - Candidate data-store value.
 * @returns Whether it is finite, acyclic JSON data.
 */
export function isDataStoreJsonValue(value: unknown): value is JsonValue {
  return isJsonValue(value, new Set());
}

/**
 * Checks the version-one operation wire shape.
 *
 * @param value - Parsed JSON.
 * @returns Whether the operation has valid identity and clock fields.
 */
export function isDataStoreOperation(value: unknown): value is DataStoreOperation {
  return typeof value === 'object' && value !== null && 'key' in value && typeof value.key === 'string'
    && 'device' in value && typeof value.device === 'string' && /^[\w-]+$/.test(value.device)
    && 'sequence' in value && isPositiveInteger(value.sequence)
    && 'time' in value && isNonNegativeInteger(value.time)
    && 'counter' in value && isNonNegativeInteger(value.counter)
    && 'deleted' in value && typeof value.deleted === 'boolean' && 'value' in value && isDataStoreJsonValue(value.value)
    && (!('tags' in value) || (Array.isArray(value.tags) && value.tags.every((item: unknown) => typeof item === 'string')));
}

function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    return false;
  }
  if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  ancestors.add(value);
  const values: unknown[] = Array.isArray(value) ? [...value] : Object.values(value);
  const isValid = values.every((child) => isJsonValue(child, ancestors));
  ancestors.delete(value);
  return isValid;
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function rankOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return typeof value === 'object' && value !== null && 'rank' in value && 'value' in value
      && typeof value.rank === 'number' && Number.isFinite(value.rank)
    ? value.rank
    : undefined;
}

function tag(operation: DataStoreOperation): string {
  return `${operation.device}:${String(operation.sequence)}`;
}

function tagVector(tags: readonly string[]): Map<string, number> {
  const vector = new Map<string, number>();
  for (const value of tags) {
    const separator = value.lastIndexOf(':');
    const device = value.slice(0, separator);
    const sequence = Number(value.slice(separator + 1));
    if (!device || !Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new Error('Invalid observed-remove tag');
    }
    vector.set(device, Math.max(sequence, vector.get(device) ?? 0));
  }
  return vector;
}

/* eslint-enable n/no-unsupported-features/node-builtins -- These are Obsidian renderer Web APIs, not Node builtins. */
