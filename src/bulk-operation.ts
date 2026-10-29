/**
 * @file
 *
 * The platform-neutral half of bulk-operation git commits: the lease-lock record, the `OP<n>` ids and the commit
 * messages that carry them.
 *
 * A bulk operation wrapped by `BulkOperationCommitComponent` lands in the vault's git repo as one commit whose
 * subject is `OP<n>: <summary>`, preceded (when the tree was dirty) by a `chore: before OP<n>` commit holding
 * whatever was pending, so `git revert` of the `OP<n>` commit undoes exactly that operation. Everything in this
 * module is pure, so it is shared by the desktop git layer and by the scheduled autocommit that reads the same lock.
 *
 * The lock record and the commit message trailers are a wire format between plugins built on different copies of
 * this library and the vault autocommit script: fields may be added, never renamed or reinterpreted.
 */

import { getMandatoryNamedGroup } from '@mnaoumov/typescript-lib/reg-exp';
import {
  isNumber,
  isString,
  objectTypeGuard
} from '@mnaoumov/typescript-lib/type-guards';

/**
 * The name of the lease-lock file, created inside the repo's git directory so it is never committed or
 * synced.
 */
export const BULK_OPERATION_LOCK_FILE_NAME = 'obsidian-bulk-operation.json';

/**
 * How long a lock may go without a heartbeat before it counts as stale.
 *
 * It errs long on purpose: holding a dead lock too long only makes an autocommit skip a tick, while declaring a
 * live one stale splits its operation across two commits.
 */
export const BULK_OPERATION_LOCK_STALE_AFTER_IN_MILLISECONDS = 120_000;

/**
 * The trailer key naming the operation id in a bulk-operation commit body.
 */
export const OPERATION_TRAILER_KEY = 'Obsidian-Bulk-Operation';

/**
 * The trailer key naming the plugin in a bulk-operation commit body.
 */
export const PLUGIN_TRAILER_KEY = 'Obsidian-Plugin';

const OPERATION_ID_PREFIX = 'OP';

const isBulkOperationLockImpl = objectTypeGuard<BulkOperationLock>({
  heartbeatAt: isNumber,
  host: isString,
  operationId: isString,
  pluginId: isString,
  processId: isNumber,
  processStartedAt: isNumber,
  startedAt: isNumber
});

/**
 * Parameters for {@link buildOperationCommitMessage}.
 */
export interface BuildOperationCommitMessageParams {
  /**
   * The number of files the commit changes.
   */
  readonly changedFileCount: number;

  /**
   * Whether the operation was interrupted.
   */
  readonly isInterrupted?: boolean;

  /**
   * The operation id, such as `OP12`.
   */
  readonly operationId: string;

  /**
   * The id of the plugin that ran the operation.
   */
  readonly pluginId: string;

  /**
   * A one-line description of the operation. Ignored for an interrupted operation.
   */
  readonly summary?: string;

  /**
   * When the operation ran.
   */
  readonly timestamp: Date;
}

/**
 * A bulk-operation commit found in the repo history.
 */
export interface BulkOperationCommit {
  /**
   * The commit date, as an ISO 8601 string.
   */
  readonly date: string;

  /**
   * Whether the commit records an interrupted operation rather than a completed one.
   */
  readonly isInterrupted: boolean;

  /**
   * The operation id, such as `OP12`.
   */
  readonly operationId: string;

  /**
   * The full commit hash.
   */
  readonly sha: string;

  /**
   * The commit subject.
   */
  readonly subject: string;
}

/**
 * The lease-lock record stored in `.git/obsidian-bulk-operation.json` while a bulk operation runs.
 */
export interface BulkOperationLock {
  /**
   * When the lock was last refreshed by the operation's progress, as epoch milliseconds.
   */
  readonly heartbeatAt: number;

  /**
   * The host name of the machine running the operation.
   */
  readonly host: string;

  /**
   * The operation id, such as `OP12`.
   */
  readonly operationId: string;

  /**
   * The id of the plugin running the operation.
   */
  readonly pluginId: string;

  /**
   * The id of the process running Obsidian. Only a fast path for an app crash; staleness never depends on it.
   */
  readonly processId: number;

  /**
   * When the process running Obsidian started, as epoch milliseconds, so a recycled process id is not mistaken for
   * the original one.
   */
  readonly processStartedAt: number;

  /**
   * When the operation started, as epoch milliseconds.
   */
  readonly startedAt: number;
}

/**
 * The facts {@link isBulkOperationLockStale} weighs besides the heartbeat.
 */
export interface BulkOperationLockStalenessContext {
  /**
   * When this machine last booted, as epoch milliseconds, or `null` when unknown.
   */
  readonly bootedAt: null | number;

  /**
   * The host name of this machine.
   */
  readonly host: string;

  /**
   * Whether the process recorded in the lock is still running on this machine, or `null` when it cannot be told.
   */
  readonly isProcessAlive: (processId: number) => boolean | null;

  /**
   * The current time, as epoch milliseconds.
   */
  readonly now: number;
}

/**
 * The commit message of one bulk-operation commit.
 */
export interface OperationCommitMessage {
  /**
   * The commit body: the timestamp, the plugin and the counts, as git trailers.
   */
  readonly body: string;

  /**
   * The commit subject.
   */
  readonly subject: string;
}

/**
 * Parameters for {@link parseBulkOperationCommit}.
 */
export interface ParseBulkOperationCommitParams {
  /**
   * The commit date, as an ISO 8601 string.
   */
  readonly date: string;

  /**
   * The full commit hash.
   */
  readonly sha: string;

  /**
   * The commit subject.
   */
  readonly subject: string;
}

/**
 * Builds the subject of the commit that saves whatever was pending before an operation.
 *
 * @param operationId - The operation id, such as `OP12`.
 * @returns The commit subject.
 */
export function buildBeforeOperationCommitSubject(operationId: string): string {
  return `chore: before ${operationId}`;
}

/**
 * Builds the message of the commit recording a bulk operation, or an interrupted one.
 *
 * @param params - The parameters.
 * @returns The commit subject and body.
 */
export function buildOperationCommitMessage(params: BuildOperationCommitMessageParams): OperationCommitMessage {
  const subject = params.isInterrupted
    ? `${params.operationId} interrupted`
    : `${params.operationId}: ${normalizeSummary(params.summary ?? '')}`;
  // Git trailers, one per line, so `git log --grep` and `git interpret-trailers` both read them.
  const body = `Timestamp: ${params.timestamp.toISOString()}\nChanged-Files: ${String(params.changedFileCount)}\n`
    + `${PLUGIN_TRAILER_KEY}: ${params.pluginId}\n${OPERATION_TRAILER_KEY}: ${params.operationId}`;
  return { body, subject };
}

/**
 * Formats an operation id from its number.
 *
 * @param operationNumber - The operation number.
 * @returns The operation id, such as `OP12`.
 */
export function formatOperationId(operationNumber: number): string {
  return `${OPERATION_ID_PREFIX}${String(operationNumber)}`;
}

/**
 * Finds the next operation id from the subjects of the bulk-operation commits already in the history.
 *
 * @param subjects - Commit subjects; anything that is not a bulk-operation subject is ignored.
 * @returns `OP<n>` with n one past the highest number found, or `OP1` when there is none.
 */
export function getNextOperationId(subjects: readonly string[]): string {
  let maxOperationNumber = 0;
  for (const subject of subjects) {
    const operationNumber = parseOperationNumber(subject);
    if (operationNumber !== null && operationNumber > maxOperationNumber) {
      maxOperationNumber = operationNumber;
    }
  }
  return formatOperationId(maxOperationNumber + 1);
}

/**
 * Checks whether a value has the shape of a {@link BulkOperationLock}.
 *
 * @param value - The value read from the lock file.
 * @returns Whether it is a lock record.
 */
export function isBulkOperationLock(value: unknown): value is BulkOperationLock {
  return isBulkOperationLockImpl(value);
}

/**
 * Decides whether a lease lock is stale, so whoever finds it may commit the leftovers and remove it.
 *
 * The heartbeat is the rule; the reboot and crashed-process checks are only fast paths that shorten the wait, and
 * neither can make a lock with a fresh heartbeat on another machine stale.
 *
 * @param lock - The lock record.
 * @param context - The facts about this machine.
 * @returns Whether the lock is stale.
 */
export function isBulkOperationLockStale(lock: BulkOperationLock, context: BulkOperationLockStalenessContext): boolean {
  if (context.now - lock.heartbeatAt >= BULK_OPERATION_LOCK_STALE_AFTER_IN_MILLISECONDS) {
    return true;
  }

  if (lock.host !== context.host) {
    return false;
  }

  const wasHeartbeatBeforeBoot = context.bootedAt !== null && lock.heartbeatAt < context.bootedAt;
  return wasHeartbeatBeforeBoot || context.isProcessAlive(lock.processId) === false;
}

/**
 * Parses a bulk-operation commit subject into the commit it describes, skipping the `chore: before` commits, which
 * are not operations.
 *
 * @param params - The commit's hash, date and subject.
 * @returns The bulk-operation commit, or `null` when the subject is not one.
 */
export function parseBulkOperationCommit(params: ParseBulkOperationCommitParams): BulkOperationCommit | null {
  const match = /^OP(?<operationNumber>\d+)(?<kind>:| interrupted$)/.exec(params.subject);
  if (!match) {
    return null;
  }
  return {
    date: params.date,
    isInterrupted: getMandatoryNamedGroup(match, 'kind') !== ':',
    operationId: formatOperationId(Number(getMandatoryNamedGroup(match, 'operationNumber'))),
    sha: params.sha,
    subject: params.subject
  };
}

/**
 * Parses the operation number out of a bulk-operation commit subject.
 *
 * Recognizes `OP<n>: <summary>`, `OP<n> interrupted` and `chore: before OP<n>`.
 *
 * @param subject - The commit subject.
 * @returns The operation number, or `null` when the subject is not a bulk-operation subject.
 */
export function parseOperationNumber(subject: string): null | number {
  const match = /^(?:chore: before )?OP(?<operationNumber>\d+)(?::| interrupted$|$)/.exec(subject);
  return match ? Number(getMandatoryNamedGroup(match, 'operationNumber')) : null;
}

function normalizeSummary(summary: string): string {
  const normalized = summary.replaceAll(/\s+/g, ' ').trim();
  return normalized || 'bulk operation';
}
