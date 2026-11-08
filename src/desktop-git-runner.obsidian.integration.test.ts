/**
 * @file
 *
 * Integration tests for {@link createDesktopGitRunner} inside a real Obsidian renderer.
 *
 * The unit tests mock `node:child_process`, so they cannot see how the module reaches Node once bundled. A
 * plugin ships one CommonJS `main.js`, and esbuild keeps a dynamic `import('node:child_process')` of an external
 * module as a native `import()`, which the renderer cannot load: `loadGitRenames` then caught the failure and
 * answered no renames at all. This bundle is built the same way, so the case goes red on that shape. The
 * repository is a temporary one outside the vault, created from the Node side.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { execFileSync } from 'node:child_process';
import {
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

interface RenameEntry {
  readonly newPath: string;
  readonly oldPath: string;
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

describe('createDesktopGitRunner', () => {
  it('should read a committed rename from the Obsidian renderer', async () => {
    const testRepoPath = mkdtempSync(join(tmpdir(), 'obsidian-lib-git-runner-integration-'));
    temporaryFolders.push(testRepoPath);
    git(testRepoPath, 'init', '--quiet', '--initial-branch=main');
    git(testRepoPath, 'config', 'user.name', 'Test');
    git(testRepoPath, 'config', 'user.email', 'test@example.com');
    git(testRepoPath, 'config', 'commit.gpgSign', 'false');
    writeFileSync(join(testRepoPath, 'old.md'), 'The note whose rename the history records.\n');
    git(testRepoPath, 'add', 'old.md');
    git(testRepoPath, 'commit', '--quiet', '--no-verify', '-m', 'add old');
    git(testRepoPath, 'mv', 'old.md', 'new.md');
    git(testRepoPath, 'commit', '--quiet', '--no-verify', '-m', 'rename');

    const renames = await evalInObsidian({
      async callback({ gitRepoPath, lib: { createDesktopGitRunner, loadGitRenames } }): Promise<RenameEntry[]> {
        const gitRenames = await loadGitRenames({ runGit: createDesktopGitRunner(gitRepoPath) });
        return [...gitRenames].map(([oldPath, rename]) => ({ newPath: rename.newPath, oldPath }));
      },
      input: { gitRepoPath: testRepoPath }
    });

    expect(renames).toEqual([{ newPath: 'new.md', oldPath: 'old.md' }]);
  });
});
