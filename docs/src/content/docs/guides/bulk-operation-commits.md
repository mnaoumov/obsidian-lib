---
title: Bulk operation commits
description: Wrap a plugin's bulk operations in git commits, so one revert undoes one operation.
---

When a vault lives in a git repository, a plugin can record each bulk operation it runs (a mass rename, a link rewrite, an attachment collection) as one commit. Undoing the operation is then `git revert` of that commit, with git's own conflict handling and no custom journal. `BulkOperationCommitComponent` from `@mnaoumov/obsidian-lib/components/bulk-operation-commit-component` does the wrapping, and `UndoBulkOperationCommandHandler` from `@mnaoumov/obsidian-lib/command-handlers/undo-bulk-operation-command-handler` gives the user the undo command.

## Adopting it

The feature is opt-in. The plugin adds a setting of its own and hands the component a callback that reads it, so a change applies to the next operation. Wrap each user-triggered bulk command in `runBulkOperation`, with a one-line summary that becomes the commit subject.

<!-- snippet-check: context declare const plugin: import('obsidian').Plugin & { settings: { shouldCommitBulkOperations: boolean } }; -->
<!-- snippet-check: context declare const pluginNoticeComponent: import('@mnaoumov/obsidian-lib/components/plugin-notice-component').PluginNoticeComponent; -->
<!-- snippet-check: context declare function collectAttachments(folderPath: string): Promise<void>; -->

```ts
import { UndoBulkOperationCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/undo-bulk-operation-command-handler';
import { BulkOperationCommitComponent } from '@mnaoumov/obsidian-lib/components/bulk-operation-commit-component';

const isEnabled = (): boolean => plugin.settings.shouldCommitBulkOperations;
const bulkOperationCommitComponent = plugin.addChild(
  new BulkOperationCommitComponent({ app: plugin.app, isEnabled, pluginId: plugin.manifest.id, pluginNoticeComponent })
);
const undoCommandHandler = new UndoBulkOperationCommandHandler({ bulkOperationCommitComponent, isEnabled });

await bulkOperationCommitComponent.runBulkOperation({
  operation: () => collectAttachments('Notes'),
  summary: 'Collect attachments in Notes'
});
```

Register `undoCommandHandler` with the plugin's other command handlers. It offers "Undo a bulk operation..." on desktop while the setting is on.

## What lands in the repository

The component is active only on desktop, for a vault inside a git work tree, while the setting is on. Otherwise `runBulkOperation` just runs the operation. When it is active, an operation produces:

1. `chore: before OP<n>`, holding whatever was pending, so the operation's own commit holds nothing else. It is skipped when the tree is clean.
2. `OP<n>: <summary>`, holding everything the operation changed, including the follow-ups it set off. Its body carries the timestamp, the number of changed files and two trailers, `Obsidian-Plugin: <plugin id>` and `Obsidian-Bulk-Operation: OP<n>`, so `git log --grep OP<n>` finds it. An operation that changes nothing makes no commit.
3. `OP<n> interrupted` instead, when the operation throws: its partial changes are committed so they can still be reverted, and the error is rethrown.

Every command runs in the vault folder with `.` as its pathspec, so when the vault is a subfolder of a larger repository only the vault's changes are committed. The system `git` CLI is used, so the repository's own config, hooks and filters apply.

`OP<n>` numbers come from the history: one past the highest `OP<n>` in `git log --all`, taken under the lock below. Two machines can mint the same number before they sync; the undo command then lists both commits, each with its date and short hash, and the user picks one.

## Settling

Before the `OP<n>` commit, the component waits for what the operation set off: the library's operation queue, Obsidian's pending link updates, the metadata cache, and then a quiet period with no vault create, modify, delete or rename events (`quietPeriodInMilliseconds`, 2 s by default, bounded by `maxSettleTimeInMilliseconds`, 60 s). A change the user makes in that window lands in the operation's commit.

## The lease lock

While an operation runs, `.git/obsidian-bulk-operation.json` holds its `OP<n>`, plugin id, host, start time and a heartbeat, plus the Obsidian process id and start time. It lives in the git directory, so it is never committed or synced. Another plugin's operation waits for it, and the scheduled vault autocommit skips its tick while it is fresh, so neither splits the operation across two commits.

The heartbeat is refreshed by the operation's own progress, never by a timer, so a hung operation goes stale like a crashed one. Every `loop()` item reports progress, so a command built on `loop()` needs nothing more. A command that iterates on its own calls `reportBulkOperationProgress()` from `@mnaoumov/obsidian-lib/bulk-operation-progress` after each item.

A lock is stale after 2 minutes without a heartbeat. On this machine it is stale sooner when its heartbeat predates the last boot or its process is gone. Whoever finds a stale lock first, the component when the plugin loads or another operation waiting for it, commits the leftovers as `OP<n> interrupted` and removes the lock. The threshold errs long on purpose: holding a dead lock too long only delays an autocommit, while dropping a live one splits an operation.

The lock record is a wire format shared with the autocommit script and with other copies of this library: fields may be added, never renamed or reinterpreted.

## Undoing

The undo command lists the plugin's `OP<n>` commits on the current branch, newest first. The picked commit is reverted with `git revert --no-edit`, after whatever is pending has been committed as `chore: before revert of OP<n>`. A conflict is never aborted: the repository is left mid-revert, and a notice tells the user to resolve it and run `git revert --continue`, or `git revert --abort`. `undoBulkOperation('OP12')` reverts one named operation directly.

## git-annex

A repository whose `.gitattributes` routes files through git-annex's clean filter needs nothing special: `git add` already sends large files to the annex. When such a repository is configured (`filter.annex.*`) but `git-annex` cannot be run, the component refuses to commit, because the large files would otherwise go into git itself.
