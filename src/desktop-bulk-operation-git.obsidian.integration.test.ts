/**
 * @file
 *
 * Integration tests for {@link BulkOperationGitRepo} inside a real Obsidian renderer.
 *
 * The unit tests already drive the real git CLI from Node. What only Obsidian can answer is whether the same
 * calls work from its renderer: that `node:child_process` reaches the system `git` there, and that a `loop()`
 * running in the app refreshes the lease-lock heartbeat. The repository is a temporary one outside the vault,
 * created and inspected from the Node side, so the shared test vault never becomes a git work tree.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

interface NodeFileSystem {
  readonly appendFileSync: (path: string, data: string) => void;
}

interface RunResult {
  readonly commitSha: null | string;
  readonly heartbeatCount: number;
  readonly operationId: string;
  readonly undoneOperationIds: readonly string[];
}

interface WindowWithRequire {
  readonly require: (id: 'node:fs') => NodeFileSystem;
}

const temporaryFolders: string[] = [];

function git(cwd: string, ...gitArguments: string[]): string {
  return execFileSync('git', gitArguments, { cwd, encoding: 'utf-8' }).trim();
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { force: true, recursive: true });
  }
});

describe('BulkOperationGitRepo', () => {
  it('should commit a bulk operation run from the Obsidian renderer, and list it for undo', async () => {
    const testRepoPath = mkdtempSync(join(tmpdir(), 'obsidian-lib-bulk-operation-integration-'));
    temporaryFolders.push(testRepoPath);
    git(testRepoPath, 'init', '--quiet', '--initial-branch=main');
    const hooksPath = join(testRepoPath, '.git', 'test-hooks');
    mkdirSync(hooksPath);
    git(testRepoPath, 'config', 'user.name', 'Test');
    git(testRepoPath, 'config', 'user.email', 'test@example.com');
    git(testRepoPath, 'config', 'commit.gpgSign', 'false');
    git(testRepoPath, 'config', 'core.hooksPath', hooksPath);
    writeFileSync(join(testRepoPath, 'pending.md'), 'pending');

    const result = await evalInObsidian({
      async callback({ gitRepoPath, lib: { BulkOperationGitRepo, castTo, loop, noopAsync, registerBulkOperationProgressListener }, notePath }): Promise<RunResult> {
        const repo = await BulkOperationGitRepo.open(gitRepoPath);
        if (!repo) {
          throw new Error(`${gitRepoPath} was not found as a git work tree`);
        }

        let heartbeatCount = 0;
        const unregister = registerBulkOperationProgressListener(() => {
          heartbeatCount++;
        });
        try {
          const { commitSha, operationId } = await repo.runBulkOperation({
            async operation() {
              await loop({
                buildNoticeMessage: ({ iterationString }) => iterationString,
                items: ['first', 'second'],
                pluginNoticeComponent: null,
                processItem(item) {
                  castTo<WindowWithRequire>(window).require('node:fs').appendFileSync(notePath, `${item}\n`);
                }
              });
            },
            pluginId: 'integration-test-plugin',
            settle: () => noopAsync(),
            summary: 'Write two lines'
          });
          const commits = await repo.listBulkOperationCommits('integration-test-plugin');
          return {
            commitSha,
            heartbeatCount,
            operationId,
            undoneOperationIds: commits.map((commit) => commit.operationId)
          };
        } finally {
          unregister();
        }
      },
      input: { gitRepoPath: testRepoPath, notePath: join(testRepoPath, 'note.md') }
    });

    expect(result.operationId).toBe('OP1');
    expect(result.heartbeatCount).toBe(2);
    expect(result.commitSha).toBe(git(testRepoPath, 'rev-parse', 'HEAD'));
    expect(git(testRepoPath, 'log', '--format=%s').split('\n')).toEqual(['OP1: Write two lines', 'chore: before OP1']);
    expect(git(testRepoPath, 'show', '--name-only', '--format=', 'HEAD')).toBe('note.md');
    expect(git(testRepoPath, 'status', '--porcelain')).toBe('');
    expect(result.undoneOperationIds).toEqual(['OP1']);
  });
});
