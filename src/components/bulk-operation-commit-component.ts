/**
 * @file
 *
 * Contains class {@link BulkOperationCommitComponent} that wraps a plugin's bulk operations in git commits, so
 * `git revert` undoes one.
 */

import type {
  App,
  EventRef
} from 'obsidian';
import type { Promisable } from 'type-fest';

import {
  invokeAsyncSafely,
  setTimeoutAsync
} from '@mnaoumov/typescript-lib/async';
import { errorToString } from '@mnaoumov/typescript-lib/error';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  FileSystemAdapter,
  Platform
} from 'obsidian';

import type { BulkOperationCommit } from '../bulk-operation.ts';
import type { BulkOperationGitRepo } from '../desktop-bulk-operation-git.ts';
import type { PluginNoticeComponent } from './plugin-notice-component.ts';

import { reportBulkOperationProgress } from '../bulk-operation-progress.ts';
import { getObsidianLibDebugger } from '../debug.ts';
import { waitForPendingLinkUpdates } from '../file-manager.ts';
import { t } from '../i18n/i18n.ts';
import { ensureMetadataCacheReady } from '../metadata-cache.ts';
import { selectItem } from '../modals/select-item.ts';
import { flushQueue } from '../queue.ts';
import { ComponentEx } from './component-ex.ts';

/**
 * Constructor parameters for {@link BulkOperationCommitComponent}.
 */
export interface BulkOperationCommitComponentConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * Whether the plugin's opt-in setting for bulk-operation commits is on. Read on every operation, so a settings
   * change applies to the next one.
   */
  readonly isEnabled: () => boolean;

  /**
   * The longest the settle step waits for the vault to go quiet after an operation.
   *
   * @default `60_000`
   */
  readonly maxSettleTimeInMilliseconds?: number;

  /**
   * The id of the plugin whose operations are committed.
   */
  readonly pluginId: string;

  /**
   * The notice component used to report problems.
   */
  readonly pluginNoticeComponent: PluginNoticeComponent;

  /**
   * How long the vault must go without a change after an operation before its commit is made.
   *
   * @default `2000`
   */
  readonly quietPeriodInMilliseconds?: number;
}

/**
 * Parameters for {@link BulkOperationCommitComponent.runBulkOperation}.
 *
 * @typeParam T - The type of the operation's result.
 */
export interface BulkOperationCommitComponentRunBulkOperationParams<T> {
  /**
   * Runs the bulk operation.
   *
   * @returns The operation's result.
   */
  readonly operation: () => Promisable<T>;

  /**
   * A one-line description of the operation, used in the commit subject, such as `Collect attachments in Notes`.
   */
  readonly summary: string;
}

const DEFAULT_MAX_SETTLE_TIME_IN_MILLISECONDS = 60_000;
const DEFAULT_QUIET_PERIOD_IN_MILLISECONDS = 2000;
const SHORT_SHA_LENGTH = 8;

/**
 * Wraps a plugin's bulk operations in git commits, so `git revert` of one commit undoes one operation.
 *
 * @remarks
 * Opt-in through the plugin's own setting, and active only on desktop, for a vault inside a git work tree. When it
 * is not active, {@link runBulkOperation} simply runs the operation. When it is, the operation runs between a
 * `chore: before OP<n>` commit of whatever was pending and an `OP<n>: <summary>` commit of what it changed, under
 * a lease lock in the repo's git directory that the scheduled vault autocommit honors. The lock's heartbeat
 * is refreshed by the operation's progress: every `loop()` item, or an explicit `reportBulkOperationProgress()`.
 *
 * On load it recovers a lock left stale by a crash, committing the leftovers as `OP<n> interrupted`.
 *
 * Pair it with `UndoBulkOperationCommandHandler`, which lists the plugin's operations and reverts one.
 *
 * @example
 * ```ts
 * this.bulkOperationCommitComponent = this.addChild(new BulkOperationCommitComponent({
 *   app: this.app,
 *   isEnabled: () => this.settings.shouldCommitBulkOperations,
 *   pluginId: this.manifest.id,
 *   pluginNoticeComponent: this.pluginNoticeComponent
 * }));
 *
 * await this.bulkOperationCommitComponent.runBulkOperation({
 *   operation: () => collectAttachmentsInFolder(folder),
 *   summary: `Collect attachments in ${folder.path}`
 * });
 * ```
 */
export class BulkOperationCommitComponent extends ComponentEx {
  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * Whether the plugin's opt-in setting is on.
   */
  protected readonly isEnabled: () => boolean;

  /**
   * The id of the plugin whose operations are committed.
   */
  protected readonly pluginId: string;

  /**
   * The notice component used to report problems.
   */
  protected readonly pluginNoticeComponent: PluginNoticeComponent;

  private readonly maxSettleTimeInMilliseconds: number;
  private readonly quietPeriodInMilliseconds: number;
  private repoPromise: null | Promise<BulkOperationGitRepo | null> = null;

  /**
   * Creates a new instance.
   *
   * @param params - The constructor parameters.
   */
  public constructor(params: BulkOperationCommitComponentConstructorParams) {
    super();
    this.app = params.app;
    this.isEnabled = params.isEnabled;
    this.pluginId = params.pluginId;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.maxSettleTimeInMilliseconds = params.maxSettleTimeInMilliseconds ?? DEFAULT_MAX_SETTLE_TIME_IN_MILLISECONDS;
    this.quietPeriodInMilliseconds = params.quietPeriodInMilliseconds ?? DEFAULT_QUIET_PERIOD_IN_MILLISECONDS;
  }

  /**
   * Checks whether bulk operations are currently committed: the setting is on, the app is desktop and the vault is
   * inside a git work tree.
   *
   * @returns Whether bulk operations are committed.
   */
  public async checkActive(): Promise<boolean> {
    return await this.getRepo() !== null;
  }

  /**
   * Recovers a stale lock left by a crashed operation once the component loads.
   */
  public override onload(): void {
    super.onload();
    invokeAsyncSafely(() => this.recoverStaleLock());
  }

  /**
   * Runs a bulk operation, wrapped in git commits when bulk-operation commits are active.
   *
   * @typeParam T - The type of the operation's result.
   * @param params - The parameters.
   * @returns The operation's result.
   */
  public async runBulkOperation<T>(params: BulkOperationCommitComponentRunBulkOperationParams<T>): Promise<T> {
    const repo = await this.getRepo();
    if (!repo) {
      return await params.operation();
    }

    const { commitSha, operationId, result } = await repo.runBulkOperation({
      operation: async () => await params.operation(),
      pluginId: this.pluginId,
      settle: () => this.settle(),
      summary: params.summary
    });
    getObsidianLibDebugger('BulkOperationCommitComponent')(
      commitSha === null ? `${operationId} changed nothing` : `${operationId} committed as ${commitSha}`
    );
    return result;
  }

  /**
   * Lets the user pick one of the plugin's bulk operations and reverts its commit.
   *
   * A conflict is reported and left for the user to resolve; the revert is never aborted.
   *
   * @param operationId - The operation to undo, such as `OP12`. When omitted, the user picks from every operation
   * of the plugin. When two commits share the id (two machines minted it before syncing), the user picks between
   * them.
   */
  public async undoBulkOperation(operationId?: string): Promise<void> {
    const repo = await this.getRepo();
    if (!repo) {
      this.pluginNoticeComponent.showNotice(t(($) => $.obsidianLib.bulkOperation.notActive));
      return;
    }

    let commits = await repo.listBulkOperationCommits(this.pluginId);
    if (operationId !== undefined) {
      commits = commits.filter((commit) => commit.operationId === operationId);
    }

    if (commits.length === 0) {
      this.pluginNoticeComponent.showNotice(t(($) => $.obsidianLib.bulkOperation.noOperations));
      return;
    }

    const commit = commits.length === 1 && operationId !== undefined
      ? ensureNonNullable(commits[0])
      : await selectItem({
        app: this.app,
        items: commits,
        itemTextFunction: formatCommit,
        placeholder: t(($) => $.obsidianLib.bulkOperation.selectOperation)
      });
    if (!commit) {
      return;
    }

    let revertResult;
    try {
      revertResult = await repo.revertBulkOperationCommit(commit);
    } catch (error) {
      this.pluginNoticeComponent.showNotice(
        t(($) => $.obsidianLib.bulkOperation.revertFailed, { error: errorToString(error), operationId: commit.operationId })
      );
      return;
    }

    if (revertResult.isConflict) {
      this.pluginNoticeComponent.showNotice(t(($) => $.obsidianLib.bulkOperation.revertConflict, { operationId: commit.operationId }), {
        isPermanent: true
      });
      return;
    }

    this.pluginNoticeComponent.showNotice(t(($) => $.obsidianLib.bulkOperation.reverted, { operationId: commit.operationId }));
  }

  private async findRepo(): Promise<BulkOperationGitRepo | null> {
    if (!Platform.isDesktopApp) {
      return null;
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    // Conditional import of the desktop-only git layer; this runs only on desktop, keeping its Node builtins off
    // the mobile load path.
    const { BulkOperationGitRepo: GitRepo } = await import('../desktop-bulk-operation-git.ts');
    return await GitRepo.open(adapter.getBasePath());
  }

  private async getRepo(): Promise<BulkOperationGitRepo | null> {
    if (!this.isEnabled()) {
      return null;
    }
    this.repoPromise ??= this.findRepo();
    return await this.repoPromise;
  }

  private async recoverStaleLock(): Promise<void> {
    const repo = await this.getRepo();
    if (!repo) {
      return;
    }
    const operationId = await repo.recoverStaleLock();
    if (operationId !== null) {
      this.pluginNoticeComponent.showNotice(t(($) => $.obsidianLib.bulkOperation.recoveredInterrupted, { operationId }));
    }
  }

  private async settle(): Promise<void> {
    await flushQueue();
    await waitForPendingLinkUpdates(this.app);
    await ensureMetadataCacheReady(this.app);
    await this.waitForQuietVault();
  }

  private async waitForQuietVault(): Promise<void> {
    let lastChangeAt = performance.now();
    const deadline = lastChangeAt + this.maxSettleTimeInMilliseconds;
    function onChange(): void {
      lastChangeAt = performance.now();
    }
    const eventRefs: EventRef[] = [
      this.app.vault.on('create', onChange),
      this.app.vault.on('delete', onChange),
      this.app.vault.on('modify', onChange),
      this.app.vault.on('rename', onChange)
    ];
    try {
      for (;;) {
        const now = performance.now();
        const quietRemaining = lastChangeAt + this.quietPeriodInMilliseconds - now;
        if (quietRemaining <= 0 || now >= deadline) {
          return;
        }
        reportBulkOperationProgress();
        await setTimeoutAsync(Math.min(quietRemaining, deadline - now));
      }
    } finally {
      for (const eventRef of eventRefs) {
        this.app.vault.offref(eventRef);
      }
    }
  }
}

function formatCommit(commit: BulkOperationCommit): string {
  return `${commit.subject} (${commit.date}, ${commit.sha.slice(0, SHORT_SHA_LENGTH)})`;
}
