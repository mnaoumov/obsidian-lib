/**
 * @file
 *
 * The desktop half of bulk-operation git commits: drives the system `git` CLI to wrap a bulk operation in commits,
 * guarded by a lease lock in the repo's git directory.
 *
 * The system CLI is used rather than a bundled implementation because it honors the repo's own config, hooks
 * and clean/smudge filters, git-annex's among them, and because `git revert` is the whole undo story.
 *
 * Every command runs with the vault folder as its working directory and `.` as its pathspec, so when the vault is a
 * subfolder of a larger repo only the vault's changes are committed.
 *
 * Desktop-only (`node:child_process`, `node:fs`, `node:os`), but inert to import on mobile: nothing here touches a
 * Node builtin until a function is called.
 */

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { execFile } from 'node:child_process';
import {
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import {
  hostname,
  uptime
} from 'node:os';
import { join } from 'node:path';

import type {
  BulkOperationCommit,
  BulkOperationLock
} from './bulk-operation.ts';

import { registerBulkOperationProgressListener } from './bulk-operation-progress.ts';
import {
  buildBeforeOperationCommitSubject,
  buildOperationCommitMessage,
  BULK_OPERATION_LOCK_FILE_NAME,
  getNextOperationId,
  isBulkOperationLock,
  isBulkOperationLockStale,
  parseBulkOperationCommit,
  PLUGIN_TRAILER_KEY
} from './bulk-operation.ts';

/**
 * Constructor parameters for {@link BulkOperationGitRepo}.
 */
export interface BulkOperationGitRepoConstructorParams {
  /**
   * The absolute path of the repo's git directory, where the lease lock lives.
   */
  readonly gitDirectory: string;

  /**
   * How long to wait for another operation's lock before giving up.
   *
   * @default `600_000`
   */
  readonly lockWaitTimeoutInMilliseconds?: number;

  /**
   * The absolute path of the folder whose changes are committed: the vault root.
   */
  readonly workingDirectory: string;
}

/**
 * Parameters for {@link BulkOperationGitRepo.runBulkOperation}.
 *
 * @typeParam T - The type of the operation's result.
 */
export interface BulkOperationGitRepoRunBulkOperationParams<T> {
  /**
   * Runs the bulk operation.
   *
   * @returns The operation's result.
   */
  readonly operation: () => Promise<T>;

  /**
   * The id of the plugin running the operation.
   */
  readonly pluginId: string;

  /**
   * Waits for the follow-ups the operation set off (rename handlers, link updates, the metadata cache) to finish, so
   * their changes land in the operation's commit.
   */
  readonly settle: () => Promise<void>;

  /**
   * A one-line description of the operation, used in the commit subject.
   */
  readonly summary: string;
}

/**
 * The result of {@link BulkOperationGitRepo.runBulkOperation}.
 *
 * @typeParam T - The type of the operation's result.
 */
export interface GitBulkOperationResult<T> {
  /**
   * The hash of the commit recording the operation, or `null` when the operation changed nothing.
   */
  readonly commitSha: null | string;

  /**
   * The operation id, such as `OP12`.
   */
  readonly operationId: string;

  /**
   * The operation's result.
   */
  readonly result: T;
}

/**
 * The result of {@link BulkOperationGitRepo.revertBulkOperationCommit}.
 */
export interface GitRevertResult {
  /**
   * Whether the revert stopped on a conflict, leaving the repo mid-revert for the user to resolve.
   */
  readonly isConflict: boolean;

  /**
   * What git printed.
   */
  readonly output: string;
}

interface BulkOperationGitRepoRunGitParams {
  readonly allowedExitCodes?: readonly number[];
  readonly gitArguments: readonly string[];
}

interface GitCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const DEFAULT_LOCK_WAIT_TIMEOUT_IN_MILLISECONDS = 600_000;
const HEARTBEAT_THROTTLE_IN_MILLISECONDS = 5000;
const INDEX_LOCK_RETRY_COUNT = 20;
const INDEX_LOCK_RETRY_DELAY_IN_MILLISECONDS = 500;
const LOCK_POLL_INTERVAL_IN_MILLISECONDS = 1000;
const MAX_BUFFER_IN_BYTES = 268_435_456;
const MILLISECONDS_IN_SECOND = 1000;
const GIT_FATAL_EXIT_CODE = 128;
const REV_PARSE_OUTPUT_LINE_COUNT = 2;
const UNIT_SEPARATOR = '\u{1F}';

interface BulkOperationGitRepoCommitOperationParams {
  readonly isInterrupted?: boolean;
  readonly operationId: string;
  readonly pluginId: string;
  readonly summary?: string;
}

interface CommitMessage {
  readonly body: string;
  readonly subject: string;
}

interface ExecGitParams {
  readonly cwd: string;
  readonly gitArguments: readonly string[];
}

/**
 * A git repo holding a vault, driven to wrap bulk operations in commits.
 */
export class BulkOperationGitRepo {
  /**
   * The absolute path of the repo's git directory.
   */
  public readonly gitDirectory: string;

  /**
   * The absolute path of the folder whose changes are committed.
   */
  public readonly workingDirectory: string;

  private readonly lockFilePath: string;
  private readonly lockWaitTimeoutInMilliseconds: number;
  private ownLock: BulkOperationLock | null = null;

  /**
   * Creates a new instance. Use {@link BulkOperationGitRepo.open} to find the repo of a folder.
   *
   * @param params - The constructor parameters.
   */
  public constructor(params: BulkOperationGitRepoConstructorParams) {
    this.gitDirectory = params.gitDirectory;
    this.workingDirectory = params.workingDirectory;
    this.lockWaitTimeoutInMilliseconds = params.lockWaitTimeoutInMilliseconds ?? DEFAULT_LOCK_WAIT_TIMEOUT_IN_MILLISECONDS;
    this.lockFilePath = join(this.gitDirectory, BULK_OPERATION_LOCK_FILE_NAME);
  }

  /**
   * Finds the git repo a folder belongs to.
   *
   * @param workingDirectory - The folder, normally the vault root.
   * @returns The repo, or `null` when the folder is not inside a git work tree or `git` cannot be run.
   */
  public static async open(workingDirectory: string): Promise<BulkOperationGitRepo | null> {
    let result: GitCommandResult;
    try {
      result = await execGit({ cwd: workingDirectory, gitArguments: ['rev-parse', '--is-inside-work-tree', '--absolute-git-dir'] });
    } catch {
      return null;
    }
    const [isInsideWorkTree, gitDirectory] = result.stdout.split(/\r?\n/, REV_PARSE_OUTPUT_LINE_COUNT);
    return result.exitCode !== 0 || isInsideWorkTree !== 'true' || !gitDirectory ? null : new BulkOperationGitRepo({ gitDirectory, workingDirectory });
  }

  /**
   * Refuses to go on when the repo routes files through git-annex but `git-annex` cannot be run, since a
   * plain `git add` would then put the large files into git itself.
   */
  public async assertCanCommitLargeFiles(): Promise<void> {
    const annexFilters = await this.runGit({ allowedExitCodes: [0, 1], gitArguments: ['config', '--get-regexp', String.raw`^filter\.annex\.`] });
    if (!annexFilters.stdout.trim()) {
      return;
    }
    const annexVersion = await this.runGit({ gitArguments: ['annex', 'version', '--raw'] }).catch(() => null);
    if (annexVersion === null) {
      throw new Error(
        'The vault repository routes files through git-annex, but git-annex is not on PATH. Bulk operation commits are refused, because they would add large files to git itself.'
      );
    }
  }

  /**
   * Lists the bulk-operation commits a plugin made on the current branch, newest first.
   *
   * @param pluginId - The plugin id.
   * @returns The commits.
   */
  public async listBulkOperationCommits(pluginId: string): Promise<BulkOperationCommit[]> {
    const result = await this.runGit({
      allowedExitCodes: [0, GIT_FATAL_EXIT_CODE],
      gitArguments: [
        'log',
        `--format=%H${UNIT_SEPARATOR}%aI${UNIT_SEPARATOR}%s`,
        '--extended-regexp',
        `--grep=^${PLUGIN_TRAILER_KEY}: ${escapeRegExp(pluginId)}$`
      ]
    });
    if (result.exitCode !== 0) {
      return [];
    }
    const commits: BulkOperationCommit[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const [sha = '', date = '', ...subjectParts] = line.split(UNIT_SEPARATOR);
      const commit = parseBulkOperationCommit({ date, sha, subject: subjectParts.join(UNIT_SEPARATOR) });
      if (commit) {
        commits.push(commit);
      }
    }
    return commits;
  }

  /**
   * Commits whatever a stale lock's operation left behind as `OP<n> interrupted` and removes the lock.
   *
   * @returns The id of the recovered operation, or `null` when there was no stale lock.
   */
  public async recoverStaleLock(): Promise<null | string> {
    const lock = await this.readLock();
    return !lock || !this.isStale(lock) ? null : (await this.recover(lock));
  }

  /**
   * Reverts a bulk-operation commit with `git revert --no-edit`.
   *
   * Whatever is pending is committed first, so the revert starts from a clean tree. A conflict is NOT aborted: the
   * repo is left mid-revert for the user to resolve.
   *
   * @param commit - The commit to revert.
   * @returns Whether the revert stopped on a conflict, and what git printed.
   */
  public async revertBulkOperationCommit(commit: BulkOperationCommit): Promise<GitRevertResult> {
    await this.assertCanCommitLargeFiles();
    await this.acquireLock();
    try {
      await this.commitPending({ body: '', subject: `chore: before revert of ${commit.operationId}` });
      const result = await this.runGit({ allowedExitCodes: [0, 1], gitArguments: ['revert', '--no-edit', commit.sha] });
      return { isConflict: result.exitCode !== 0, output: `${result.stdout}${result.stderr}`.trim() };
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Runs a bulk operation between two commits.
   *
   * Takes the lease lock, commits whatever is pending as `chore: before OP<n>`, runs the operation, waits for its
   * follow-ups to settle, commits the result as `OP<n>: <summary>` and releases the lock. An operation that throws
   * still gets its partial changes committed, as `OP<n> interrupted`, before the error is rethrown.
   *
   * @typeParam T - The type of the operation's result.
   * @param params - The parameters.
   * @returns The operation's result, its id and the hash of its commit.
   */
  public async runBulkOperation<T>(params: BulkOperationGitRepoRunBulkOperationParams<T>): Promise<GitBulkOperationResult<T>> {
    await this.assertCanCommitLargeFiles();
    await this.acquireLock();
    let unregisterProgressListener: (() => void) | null = null;
    try {
      const operationId = await this.allocateOperationId(params.pluginId);
      await this.commitPending({ body: '', subject: buildBeforeOperationCommitSubject(operationId) });

      unregisterProgressListener = registerBulkOperationProgressListener(this.createThrottledHeartbeat());

      let result: T;
      try {
        result = await params.operation();
        await params.settle();
      } catch (error) {
        await this.heartbeat();
        await this.commitOperation({ isInterrupted: true, operationId, pluginId: params.pluginId });
        throw error;
      }

      await this.heartbeat();
      const commitSha = await this.commitOperation({ operationId, pluginId: params.pluginId, summary: params.summary });
      return { commitSha, operationId, result };
    } finally {
      unregisterProgressListener?.();
      await this.releaseLock();
    }
  }

  private async acquireLock(): Promise<void> {
    const deadline = Date.now() + this.lockWaitTimeoutInMilliseconds;
    for (;;) {
      if (await this.tryCreateLock()) {
        return;
      }

      const lock = await this.readLock();
      if (!lock) {
        // Released between the two calls: try to take it again at once.
        continue;
      }

      if (this.isStale(lock)) {
        await this.recover(lock);
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${lock.operationId || 'an operation'} of ${lock.pluginId} on ${lock.host} to release the bulk operation lock ${this.lockFilePath}.`
        );
      }

      await setTimeoutAsync(LOCK_POLL_INTERVAL_IN_MILLISECONDS);
    }
  }

  private async allocateOperationId(pluginId: string): Promise<string> {
    const operationId = await this.findNextOperationId();
    const ownLock = ensureNonNullable(this.ownLock);
    this.ownLock = { ...ownLock, heartbeatAt: Date.now(), operationId, pluginId };
    await this.writeLock(this.ownLock);
    return operationId;
  }

  private async commitOperation(params: BulkOperationGitRepoCommitOperationParams): Promise<null | string> {
    const changedFileCount = await this.stageAll();
    if (changedFileCount === 0) {
      return null;
    }
    const message = buildOperationCommitMessage({ ...params, changedFileCount, timestamp: new Date() });
    await this.commitStaged(message);
    const headResult = await this.runGit({ gitArguments: ['rev-parse', 'HEAD'] });
    return headResult.stdout.trim();
  }

  private async commitPending(message: CommitMessage): Promise<void> {
    if (await this.stageAll() === 0) {
      return;
    }
    await this.commitStaged(message);
  }

  private async commitStaged(message: CommitMessage): Promise<void> {
    const gitArguments = ['commit', '--quiet', '-m', message.subject];
    if (message.body) {
      gitArguments.push('-m', message.body);
    }
    gitArguments.push('--', '.');
    await this.runGit({ gitArguments });
  }

  private createThrottledHeartbeat(): () => void {
    let lastHeartbeatAt = Date.now();
    let pendingHeartbeat: Promise<void> = noopAsync();
    return () => {
      const now = Date.now();
      if (now - lastHeartbeatAt < HEARTBEAT_THROTTLE_IN_MILLISECONDS) {
        return;
      }
      lastHeartbeatAt = now;
      pendingHeartbeat = pendingHeartbeat.then(() => this.heartbeat()).catch((error: unknown) => {
        console.error('Failed to refresh the bulk operation lock heartbeat', error);
      });
    };
  }

  private async findNextOperationId(): Promise<string> {
    // `--all` also reads a repository with no commit yet, where a plain `git log` fails.
    const result = await this.runGit({
      gitArguments: ['log', '--all', '--format=%s', '--extended-regexp', '--grep=^(chore: before )?OP[0-9]+']
    });
    return getNextOperationId(result.stdout.split(/\r?\n/));
  }

  private async heartbeat(): Promise<void> {
    const lock = await this.readLock();
    if (!lock || !this.isOwnLock(lock)) {
      return;
    }
    await this.writeLock({ ...lock, heartbeatAt: Date.now() });
  }

  private isOwnLock(lock: BulkOperationLock): boolean {
    return this.ownLock !== null
      && lock.host === this.ownLock.host
      && lock.processId === this.ownLock.processId
      && lock.startedAt === this.ownLock.startedAt;
  }

  private isStale(lock: BulkOperationLock): boolean {
    return isBulkOperationLockStale(lock, {
      bootedAt: Date.now() - uptime() * MILLISECONDS_IN_SECOND,
      host: hostname(),
      isProcessAlive,
      now: Date.now()
    });
  }

  private async readLock(): Promise<BulkOperationLock | null> {
    let text: string;
    try {
      text = await readFile(this.lockFilePath, 'utf-8');
    } catch (error) {
      if (isErrorWithCode(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }

    try {
      const value: unknown = JSON.parse(text);
      if (isBulkOperationLock(value)) {
        return value;
      }
    } catch {
      // Updates are atomic, but a lock being created can be read before its content is written. The file's age
      // stands in for the heartbeat, so such a lock reads as fresh and a corrupt one goes stale like any other.
    }
    const fileStats = await stat(this.lockFilePath);
    return {
      heartbeatAt: fileStats.mtimeMs,
      host: '',
      operationId: '',
      pluginId: '',
      processId: 0,
      processStartedAt: 0,
      startedAt: 0
    };
  }

  private async recover(lock: BulkOperationLock): Promise<string> {
    const operationId = lock.operationId || await this.findNextOperationId();
    await this.commitOperation({ isInterrupted: true, operationId, pluginId: lock.pluginId || 'unknown' });
    await unlink(this.lockFilePath).catch((error: unknown) => {
      if (!isErrorWithCode(error, 'ENOENT')) {
        throw error;
      }
    });
    return operationId;
  }

  private async releaseLock(): Promise<void> {
    const lock = await this.readLock();
    const isOwnLock = lock !== null && this.isOwnLock(lock);
    this.ownLock = null;
    if (!isOwnLock) {
      return;
    }
    await unlink(this.lockFilePath).catch((error: unknown) => {
      if (!isErrorWithCode(error, 'ENOENT')) {
        throw error;
      }
    });
  }

  private async runGit(params: BulkOperationGitRepoRunGitParams): Promise<GitCommandResult> {
    const allowedExitCodes = params.allowedExitCodes ?? [0];
    for (let attempt = 1;; attempt++) {
      const result = await execGit({ cwd: this.workingDirectory, gitArguments: params.gitArguments });
      if (allowedExitCodes.includes(result.exitCode)) {
        return result;
      }
      if (attempt < INDEX_LOCK_RETRY_COUNT && result.stderr.includes('index.lock')) {
        await setTimeoutAsync(INDEX_LOCK_RETRY_DELAY_IN_MILLISECONDS);
        continue;
      }
      throw new GitCommandError(params.gitArguments, result.exitCode, result.stderr);
    }
  }

  private async stageAll(): Promise<number> {
    await this.runGit({ gitArguments: ['add', '--all', '--', '.'] });
    const result = await this.runGit({ gitArguments: ['diff', '--cached', '--name-only', '-z', '--', '.'] });
    return result.stdout.split('\0').filter(Boolean).length;
  }

  private async tryCreateLock(): Promise<boolean> {
    const lock = createLockRecord();
    try {
      await writeFile(this.lockFilePath, JSON.stringify(lock), { flag: 'wx' });
      this.ownLock = lock;
      return true;
    } catch (error) {
      if (isErrorWithCode(error, 'EEXIST')) {
        return false;
      }
      throw error;
    }
  }

  private async writeLock(lock: BulkOperationLock): Promise<void> {
    // Written beside the lock and renamed over it, so a reader never sees a half-written heartbeat.
    const temporaryPath = `${this.lockFilePath}.${String(lock.processId)}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(lock));
    await rename(temporaryPath, this.lockFilePath);
  }
}

/**
 * An error thrown when a `git` command fails.
 */
export class GitCommandError extends Error {
  /**
   * Creates a new instance.
   *
   * @param gitArguments - The arguments `git` was run with.
   * @param exitCode - The exit code.
   * @param stderr - What `git` printed to stderr.
   */
  public constructor(public readonly gitArguments: readonly string[], public readonly exitCode: number, public readonly stderr: string) {
    super(`git ${gitArguments.join(' ')} failed with exit code ${String(exitCode)}: ${stderr.trim()}`);
    this.name = 'GitCommandError';
  }
}

function createLockRecord(): BulkOperationLock {
  const now = Date.now();
  return {
    heartbeatAt: now,
    host: hostname(),
    operationId: '',
    pluginId: '',
    processId: process.pid,
    processStartedAt: getProcessStartedAt(),
    startedAt: now
  };
}

async function execGit(params: ExecGitParams): Promise<GitCommandResult> {
  return await new Promise((resolve, reject) => {
    execFile('git', [...params.gitArguments], { cwd: params.cwd, maxBuffer: MAX_BUFFER_IN_BYTES, windowsHide: true }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(new Error(`Failed to run git ${params.gitArguments.join(' ')}`, { cause: error }));
        return;
      }
      resolve({ exitCode: typeof error?.code === 'number' ? error.code : 0, stderr, stdout });
    });
  });
}

function getProcessStartedAt(): number {
  return Math.round(performance.timeOrigin);
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isProcessAlive(processId: number): boolean | null {
  if (processId <= 0) {
    return false;
  }
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !isErrorWithCode(error, 'ESRCH') && (isErrorWithCode(error, 'EPERM') || null);
  }
}
